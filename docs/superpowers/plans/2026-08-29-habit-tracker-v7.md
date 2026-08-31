# Habit Tracker v7 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drop the `habit_type` (Habit/Routine) field entirely from the schema, API, and UI, and rename the required `purpose` field to an optional `note` — data preserved, column renamed, no longer mandatory.

**Architecture:** A schema migration (drop + rename column) in `src/lib/migrate.ts`, wired into all 6 API route files that already call the two prior habit-schema migrations; a backend type/logic update in `src/lib/habits.ts`; a frontend update in `src/components/habits/HabitsDashboard.tsx` removing the Type selector and relabeling Purpose to an optional Note.

**Tech Stack:** Next.js 15 App Router, TypeScript, mysql2/promise, no test framework installed (verification is `tsc --noEmit` plus real API/DB calls via a locally-signed session token).

**Spec:** `docs/superpowers/specs/2026-08-29-habit-tracker-v7-design.md` — read it before Task 1.

## Global Constraints

- `DROP COLUMN habit_type` is intentionally destructive (explicitly approved) — every habit's current Habit/Routine value is permanently discarded. `CHANGE COLUMN purpose note ... NULL` is a rename, not a delete — existing purpose text must survive as note text.
- No change to `habit_urgency` or any other column — this plan touches exactly `habit_type` (removed) and `purpose`→`note` (renamed, made nullable).
- No API route path, method, or status-code behavior changes — only request/response body shape (`habit_type` gone, `purpose`→`note`, `note` optional) and the addition of one new migration call per route handler, matching the existing two-call pattern already in each file.
- Both new `ALTER TABLE` statements must be idempotent (safe to run again after a process restart resets the module-level "ran" flag) — catch "column already gone" / "old column doesn't exist" errors by their MySQL error codes, exactly like the existing `ER_DUP_FIELDNAME` catches in this file.

---

### Task 1: Schema migration and backend logic

**Files:**
- Modify: `src/lib/migrate.ts`
- Modify: `src/lib/habits.ts`
- Modify: `src/app/api/habits/route.ts`
- Modify: `src/app/api/habits/[id]/route.ts`
- Modify: `src/app/api/habits/[id]/amount/route.ts`
- Modify: `src/app/api/habits/[id]/history/route.ts`
- Modify: `src/app/api/habits/[id]/checkin/route.ts`
- Modify: `src/app/api/habits/summary/route.ts`

**Interfaces:**
- Produces (consumed by Task 2): `HabitWithComputed` and `HabitInput` (from `src/lib/habits.ts`) no longer have `habit_type`/`HabitType`; `purpose: string` becomes `note: string | null`. `HabitType` and `TYPE_OPTIONS` are no longer exported from this file at all.

- [ ] **Step 1: Add the new migration function to `src/lib/migrate.ts`**

Find the flag declarations near the top of the file:
```ts
let _ranHabitsV2 = false;
let _ranHabitsV3 = false;
```
Replace with:
```ts
let _ranHabitsV2 = false;
let _ranHabitsV3 = false;
let _ranHabitsV7 = false;
```

Find `ensureHabitPriorityAndMinimumSchema`'s closing brace (the function ends with `_ranHabitsV3 = true; }`). Immediately after that function, add:
```ts

/** Drop the (now-unused) habit_type column and rename purpose -> note, making it
 * optional. Both statements are idempotent: DROP tolerates the column already being
 * gone, and the rename tolerates "purpose" already being renamed, so a process
 * restart (which resets the module-level flag below) can safely re-run this. */
export async function ensureHabitTypeRemovedAndNoteRenamedSchema(): Promise<void> {
  if (_ranHabitsV7) return;

  try {
    await pool.query(`ALTER TABLE habit_tasks DROP COLUMN habit_type`);
  } catch (err: unknown) {
    if ((err as { code?: string }).code !== 'ER_CANT_DROP_FIELD_OR_KEY') throw err;
  }

  try {
    await pool.query(`ALTER TABLE habit_tasks CHANGE COLUMN purpose note TEXT NULL`);
  } catch (err: unknown) {
    if ((err as { code?: string }).code !== 'ER_BAD_FIELD_ERROR') throw err;
  }

  _ranHabitsV7 = true;
}
```

- [ ] **Step 2: Update types and logic in `src/lib/habits.ts`**

Delete these two lines entirely:
```ts
export type HabitType = 'routine' | 'habit';
```
and
```ts
export const TYPE_OPTIONS: HabitType[] = ['habit', 'routine'];
```

In `HabitWithComputed`, change:
```ts
  purpose: string;
  priority: HabitPriority;
  task_category: HabitCategory;
  habit_type: HabitType;
```
to:
```ts
  note: string | null;
  priority: HabitPriority;
  task_category: HabitCategory;
```

In `HabitInput`, change:
```ts
export interface HabitInput {
  task_name: string;
  purpose: string;
  priority?: HabitPriority;
  task_category: HabitCategory;
  habit_type: HabitType;
  schedule_mode?: ScheduleMode;
```
to:
```ts
export interface HabitInput {
  task_name: string;
  note?: string | null;
  priority?: HabitPriority;
  task_category: HabitCategory;
  schedule_mode?: ScheduleMode;
```

In `HabitRow`, change:
```ts
interface HabitRow extends RowDataPacket {
  habit_id: number; user_id: number; task_name: string; purpose: string;
  priority: HabitPriority; task_category: HabitCategory; habit_type: HabitType;
  days_of_week: string; times_per_week: number; date_created: string;
```
to:
```ts
interface HabitRow extends RowDataPacket {
  habit_id: number; user_id: number; task_name: string; note: string | null;
  priority: HabitPriority; task_category: HabitCategory;
  days_of_week: string; times_per_week: number; date_created: string;
```

In `validateInput`, delete these two lines:
```ts
  if (!input.purpose?.trim()) throw new Error('Purpose is required.');
```
and
```ts
  if (!TYPE_OPTIONS.includes(input.habit_type)) throw new Error('Invalid type.');
```
(Leave every other line of `validateInput` — the task_name check, priority/category validation, schedule-mode branching, tracking-type validation — exactly as-is.)

In `getHabitsForUser`'s `result` map, in the `base` object, change:
```ts
      task_name: row.task_name,
      purpose: row.purpose,
      priority: row.priority,
      task_category: row.task_category,
      habit_type: row.habit_type,
      schedule_mode: row.schedule_mode,
```
to:
```ts
      task_name: row.task_name,
      note: row.note,
      priority: row.priority,
      task_category: row.task_category,
      schedule_mode: row.schedule_mode,
```

In `createHabit`, change:
```ts
export async function createHabit(userId: number, input: HabitInput) {
  const v = validateInput(input);
  const [res] = await pool.execute<ResultSetHeader>(
    `INSERT INTO habit_tasks
       (user_id, task_name, purpose, priority, task_category, habit_type,
        days_of_week, times_per_week, schedule_mode, tracking_type, target_value, minimum_value, unit_label, step_value)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, input.task_name.trim(), input.purpose.trim(), v.priority, input.task_category,
     input.habit_type, v.daysStr, v.weeklyTarget, v.scheduleMode, v.trackingType, v.targetValue, v.minimumValue, v.unitLabel, v.stepValue]
  );
  return res.insertId;
}
```
to:
```ts
export async function createHabit(userId: number, input: HabitInput) {
  const v = validateInput(input);
  const [res] = await pool.execute<ResultSetHeader>(
    `INSERT INTO habit_tasks
       (user_id, task_name, note, priority, task_category,
        days_of_week, times_per_week, schedule_mode, tracking_type, target_value, minimum_value, unit_label, step_value)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, input.task_name.trim(), input.note?.trim() || null, v.priority, input.task_category,
     v.daysStr, v.weeklyTarget, v.scheduleMode, v.trackingType, v.targetValue, v.minimumValue, v.unitLabel, v.stepValue]
  );
  return res.insertId;
}
```

In `updateHabit`, change:
```ts
  await pool.execute(
    `UPDATE habit_tasks
     SET task_name=?, purpose=?, priority=?, task_category=?, habit_type=?, days_of_week=?, times_per_week=?,
         schedule_mode=?, tracking_type=?, target_value=?, minimum_value=?, unit_label=?, step_value=?
     WHERE habit_id=? AND user_id=?`,
    [input.task_name.trim(), input.purpose.trim(), v.priority, input.task_category,
     input.habit_type, v.daysStr, v.weeklyTarget, v.scheduleMode, v.trackingType, v.targetValue, v.minimumValue, v.unitLabel, v.stepValue,
     habitId, userId]
  );
```
to:
```ts
  await pool.execute(
    `UPDATE habit_tasks
     SET task_name=?, note=?, priority=?, task_category=?, days_of_week=?, times_per_week=?,
         schedule_mode=?, tracking_type=?, target_value=?, minimum_value=?, unit_label=?, step_value=?
     WHERE habit_id=? AND user_id=?`,
    [input.task_name.trim(), input.note?.trim() || null, v.priority, input.task_category,
     v.daysStr, v.weeklyTarget, v.scheduleMode, v.trackingType, v.targetValue, v.minimumValue, v.unitLabel, v.stepValue,
     habitId, userId]
  );
```

- [ ] **Step 3: Wire the new migration call into all 6 API route files**

In each file below, add `ensureHabitTypeRemovedAndNoteRenamedSchema` to the existing `import { ensureHabitTrackingSchema, ensureHabitPriorityAndMinimumSchema } from '@/lib/migrate';` line (becoming `import { ensureHabitTrackingSchema, ensureHabitPriorityAndMinimumSchema, ensureHabitTypeRemovedAndNoteRenamedSchema } from '@/lib/migrate';`), and add `await ensureHabitTypeRemovedAndNoteRenamedSchema();` immediately after EVERY existing `await ensureHabitPriorityAndMinimumSchema();` call in that file (some files have this call once, some twice — add it after each occurrence):

- `src/app/api/habits/route.ts` — 2 call sites (in `GET` and in `POST`)
- `src/app/api/habits/[id]/route.ts` — 2 call sites
- `src/app/api/habits/[id]/amount/route.ts` — 1 call site
- `src/app/api/habits/[id]/history/route.ts` — 1 call site
- `src/app/api/habits/[id]/checkin/route.ts` — 2 call sites
- `src/app/api/habits/summary/route.ts` — 1 call site

Example (from `src/app/api/habits/summary/route.ts`, showing the exact before/after pattern to replicate in every file listed above):
```ts
// before
import { ensureHabitTrackingSchema, ensureHabitPriorityAndMinimumSchema } from '@/lib/migrate';
import { getSummaryForUser } from '@/lib/habits';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureHabitTrackingSchema();
  await ensureHabitPriorityAndMinimumSchema();

  const summary = await getSummaryForUser(parseInt(session.user.id));
  return Response.json(summary);
}
```
```ts
// after
import { ensureHabitTrackingSchema, ensureHabitPriorityAndMinimumSchema, ensureHabitTypeRemovedAndNoteRenamedSchema } from '@/lib/migrate';
import { getSummaryForUser } from '@/lib/habits';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureHabitTrackingSchema();
  await ensureHabitPriorityAndMinimumSchema();
  await ensureHabitTypeRemovedAndNoteRenamedSchema();

  const summary = await getSummaryForUser(parseInt(session.user.id));
  return Response.json(summary);
}
```
Apply the same shape of edit (import line + one new `await` line after each existing `ensureHabitPriorityAndMinimumSchema()` call) to the other 5 files.

- [ ] **Step 4: Run tsc**

```bash
npx tsc --noEmit
```
Expected: errors ONLY in `src/components/habits/HabitsDashboard.tsx` (it still references the removed `HabitType`/`TYPE_OPTIONS`/`habit_type`/`purpose` — Task 2 fixes it). Confirm **zero errors** in `src/lib/habits.ts`, `src/lib/migrate.ts`, and every file under `src/app/api/habits/**`.

- [ ] **Step 5: Verify against the real local dev DB**

Using a locally-signed session token (recipe: `next-auth/jwt`'s `encode({ token: { sub: '<user_id>', name }, secret: 'vibeboard-dev-secret-replace-in-production', salt: 'authjs.session-token' })`, cookie `authjs.session-token`, run from repo root; `user_id` 2 owns real habit data locally; ensure XAMPP's MySQL service is running; make sure the dev server binds to port 3000 to match `.env.local`'s `AUTH_URL`, since a port mismatch has caused auth failures in prior passes on this project):
1. Hit `GET /api/habits` once BEFORE making any change to trigger nothing (this step is backend-only; the frontend still references the old fields, so don't run the dev server against a browser yet — API-level curl/fetch calls are fine).
2. After the migration runs (triggered automatically by any route handler call), inspect the actual `habit_tasks` table schema (e.g. via phpMyAdmin or a raw `DESCRIBE habit_tasks` query through a small script) — confirm `habit_type` is gone and `note` exists (nullable) where `purpose` used to be.
3. Confirm an existing habit's previously-stored `purpose` text now reads correctly as `note` in the `GET /api/habits` response.
4. `POST /api/habits` a new habit with no `note` field in the body at all — confirm it's created successfully (no "Purpose is required" error) with `note: null` in the response.
5. `POST /api/habits` a new habit WITH a `note` field — confirm it's stored and returned correctly.
6. Clean up any test habits created during this verification pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/migrate.ts src/lib/habits.ts src/app/api/habits/route.ts src/app/api/habits/[id]/route.ts src/app/api/habits/[id]/amount/route.ts src/app/api/habits/[id]/history/route.ts src/app/api/habits/[id]/checkin/route.ts src/app/api/habits/summary/route.ts
git commit -m "Drop habit_type column and rename purpose to optional note (schema + backend)" -- src/lib/migrate.ts src/lib/habits.ts src/app/api/habits/route.ts "src/app/api/habits/[id]/route.ts" "src/app/api/habits/[id]/amount/route.ts" "src/app/api/habits/[id]/history/route.ts" "src/app/api/habits/[id]/checkin/route.ts" src/app/api/habits/summary/route.ts
```

---

### Task 2: Remove the Type field and rename Purpose to Note in the UI

**Files:**
- Modify: `src/components/habits/HabitsDashboard.tsx`

**Interfaces:**
- Consumes: `HabitWithComputed`/`HabitInput` from `@/lib/habits` (Task 1's new shape — `note: string | null` instead of `purpose: string`, no `habit_type`/`HabitType`). `HabitType` is no longer exported from `@/lib/habits` at all, so its import must be removed.

- [ ] **Step 1: Update the type import**

Find:
```ts
import type {
  HabitWithComputed, HabitsSummary, HabitCategory, HabitPriority, HabitType,
  ScheduleMode, TrackingType, WeekProgress, HabitHistoryResponse, HabitHistoryWeek,
} from '@/lib/habits';
```
Replace with:
```ts
import type {
  HabitWithComputed, HabitsSummary, HabitCategory, HabitPriority,
  ScheduleMode, TrackingType, WeekProgress, HabitHistoryResponse, HabitHistoryWeek,
} from '@/lib/habits';
```

- [ ] **Step 2: Remove the local `TYPE_OPTIONS` constant**

Delete this line entirely (it has no replacement — nothing else in the file should reference `TYPE_OPTIONS` or `HabitType` after this task):
```ts
const TYPE_OPTIONS: HabitType[] = ['habit', 'routine'];
```

- [ ] **Step 3: Update `FormState` and `EMPTY_FORM`**

Find:
```ts
interface FormState {
  habit_id: number | null;
  task_name: string;
  purpose: string;
  priority: HabitPriority;
  task_category: HabitCategory | '';
  habit_type: HabitType | '';
  schedule_mode: ScheduleMode;
  days_of_week: string[];
  weekly_target: string;
  tracking_type: TrackingType;
  target_value: string;
  minimum_value: string;
  unit_label: string;
  step_value: string;
}
const EMPTY_FORM: FormState = {
  habit_id: null, task_name: '', purpose: '', priority: 'normal', task_category: '', habit_type: '',
  schedule_mode: 'fixed', days_of_week: [], weekly_target: '3',
  tracking_type: 'boolean', target_value: '', minimum_value: '', unit_label: '', step_value: '1',
};
```
Replace with:
```ts
interface FormState {
  habit_id: number | null;
  task_name: string;
  note: string;
  priority: HabitPriority;
  task_category: HabitCategory | '';
  schedule_mode: ScheduleMode;
  days_of_week: string[];
  weekly_target: string;
  tracking_type: TrackingType;
  target_value: string;
  minimum_value: string;
  unit_label: string;
  step_value: string;
}
const EMPTY_FORM: FormState = {
  habit_id: null, task_name: '', note: '', priority: 'normal', task_category: '',
  schedule_mode: 'fixed', days_of_week: [], weekly_target: '3',
  tracking_type: 'boolean', target_value: '', minimum_value: '', unit_label: '', step_value: '1',
};
```

- [ ] **Step 4: Update `openEdit`**

Find:
```ts
  const openEdit = (h: HabitWithComputed) => {
    setForm({
      habit_id: h.habit_id, task_name: h.task_name, purpose: h.purpose,
      priority: h.priority, task_category: h.task_category, habit_type: h.habit_type,
      schedule_mode: h.schedule_mode, days_of_week: h.days_of_week, weekly_target: String(h.times_per_week),
```
Replace with:
```ts
  const openEdit = (h: HabitWithComputed) => {
    setForm({
      habit_id: h.habit_id, task_name: h.task_name, note: h.note ?? '',
      priority: h.priority, task_category: h.task_category,
      schedule_mode: h.schedule_mode, days_of_week: h.days_of_week, weekly_target: String(h.times_per_week),
```
(The remaining lines of the object — `tracking_type`, `target_value`, `minimum_value`, `unit_label`, `step_value` — are unchanged.)

- [ ] **Step 5: Update `submitForm`'s validation and request body**

Find:
```ts
  const submitForm = async () => {
    if (!form.task_name.trim() || !form.purpose.trim() || !form.task_category || !form.habit_type) {
      setFormError('Fill in every field before saving.');
      return;
    }
```
Replace with:
```ts
  const submitForm = async () => {
    if (!form.task_name.trim() || !form.task_category) {
      setFormError('Fill in every field before saving.');
      return;
    }
```

Find:
```ts
    const body: Record<string, unknown> = {
      task_name: form.task_name, purpose: form.purpose, priority: form.priority,
      task_category: form.task_category, habit_type: form.habit_type,
      schedule_mode: form.schedule_mode, tracking_type: form.tracking_type,
    };
```
Replace with:
```ts
    const body: Record<string, unknown> = {
      task_name: form.task_name, note: form.note.trim() || undefined, priority: form.priority,
      task_category: form.task_category,
      schedule_mode: form.schedule_mode, tracking_type: form.tracking_type,
    };
```

- [ ] **Step 6: Remove the Type field and relabel Purpose to Note in the modal JSX**

Find:
```tsx
            <label className="ht-label">Purpose</label>
            <textarea className="vb-input" rows={2} style={{ resize: 'none' }} value={form.purpose} onChange={e => setForm(f => ({ ...f, purpose: e.target.value }))} placeholder="Why does this matter to you?" />
```
Replace with:
```tsx
            <label className="ht-label">Note (optional)</label>
            <textarea className="vb-input" rows={2} style={{ resize: 'none' }} value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} placeholder="Add a note, if you'd like" />
```

Find and delete entirely (the whole Type label + select block, including its blank line before "Schedule"):
```tsx
            <label className="ht-label">Type</label>
            <select className="vb-input" value={form.habit_type} onChange={e => setForm(f => ({ ...f, habit_type: e.target.value as HabitType }))}>
              <option value="" disabled>Choose</option>
              {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
            </select>

```
(So the "Category" field's closing `</div>` is immediately followed by the "Schedule" label — no Type field in between.)

- [ ] **Step 7: Make the card's note paragraph conditional**

Find, inside `HabitCard`:
```tsx
      <p style={{
        margin: 0, fontSize: '0.83rem', color: '#555', lineHeight: 1.4,
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
      }}>
        {habit.purpose}
      </p>
```
Replace with:
```tsx
      {habit.note && (
        <p style={{
          margin: 0, fontSize: '0.83rem', color: '#555', lineHeight: 1.4,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {habit.note}
        </p>
      )}
```

- [ ] **Step 8: Run tsc**

```bash
npx tsc --noEmit
```
Expected: zero errors, project-wide.

- [ ] **Step 9: Verify by reading**

1. Repo-wide grep for `habit_type`, `HabitType`, `TYPE_OPTIONS`, and `\.purpose\b` across `src/` — confirm zero remaining occurrences anywhere (both files from Task 1 and this task).
2. Confirm the modal no longer renders a "Type" field between Category and Schedule.
3. Confirm a habit with no note renders no paragraph at all on its card (not an empty one), and a habit with a note renders it exactly as before.

- [ ] **Step 10: Verify against the real local dev DB**

Using the same session-token approach as Task 1: load the dashboard, confirm the create/edit modal has no Type field, confirm creating a habit with an empty note works and shows no note paragraph on its card, confirm editing an existing pre-migration habit (whose `note` now holds its old `purpose` text) shows that text correctly in both the form and the card.

- [ ] **Step 11: Commit**

```bash
git add src/components/habits/HabitsDashboard.tsx
git commit -m "Remove Type field and rename Purpose to optional Note in the UI" -- src/components/habits/HabitsDashboard.tsx
```

---

### Task 3: Update the migration log

**Files:**
- Modify: `habittracker-log.md`

- [ ] **Step 1: Append a new section**

Read the current file first to match its exact heading/tone/detail-level conventions. Append a new `## Habit Tracker v7 — Data-model cleanup: drop Type, rename Purpose to Note` section covering: the removal of `habit_type` (explicitly a destructive `DROP COLUMN`, approved by the user with the tradeoff stated plainly — the first genuinely destructive migration in this project's history, unlike every prior additive-only change), the `purpose`→`note` rename (non-destructive, existing text preserved, field made optional), the UI changes (Type selector removed from the create/edit form, Purpose relabeled "Note (optional)", the card's note paragraph now conditional on a note actually being present), and confirmation this was verified by real API/DB calls against the local dev database, including confirming existing habits' purpose text survived the rename as note text.

- [ ] **Step 2: Commit**

```bash
git add habittracker-log.md
git commit -m "Document Habit Tracker v7 shipment in the migration log" -- habittracker-log.md
```
