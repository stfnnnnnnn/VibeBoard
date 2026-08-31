# Habit Tracker v7 — Data-Model Cleanup: Drop Type, Rename Purpose to Note — Design

**Status:** Approved for planning
**Date:** 2026-08-29
**Depends on:** Habit Tracker v6 (visual revamp), shipped and reviewed the same day.
**Origin:** user request, first of four sub-projects decomposed from a larger follow-up ask (data-model cleanup → Pause lifecycle → pace-wording fix → visual/motion round 2). This spec covers only the data-model cleanup: removing the Habit/Routine "Type" field entirely, and turning the required "Purpose" field into an optional "Note", renaming its column. Both choices (drop the column rather than deprecate it in place; rename the column rather than keep the internal name) were made explicitly by the user after being shown the tradeoffs, including that dropping `habit_type` permanently discards every habit's current value and is the first genuinely destructive migration in this project.

## Problem

Two fields in the ritual model no longer earn their place:

1. **`habit_type` (Habit vs. Routine)** — a required field, set once at creation via a dropdown, that has had no visible effect on the UI since v5/v6 replaced its display string with schedule-mode wording ("Fixed"/"Flexible"). It's dead weight in the create/edit form: a mandatory choice with no downstream consequence anywhere in the app.
2. **`purpose` (required free-text "why does this matter")** — forces every ritual to have a stated purpose before it can be created, which is friction for the common case of a quick, low-ceremony habit ("drink water," "stretch") that doesn't need a stated rationale. An optional note serves the same "add context if you want" need without the friction.

## Goals

- Remove `habit_type`, `HabitType`, and `TYPE_OPTIONS` entirely from the TypeScript surface (`src/lib/habits.ts`, `src/components/habits/HabitsDashboard.tsx`) and drop the underlying `habit_type` column from `habit_tasks`.
- Rename `purpose` → `note` throughout (column, interfaces, SQL, form state, UI label/placeholder), and make it optional: no longer validated as required in `validateInput`, no longer marked "required" in the create/edit form, and the ritual card only renders its note paragraph when a note is actually present.
- Existing `purpose` text is preserved as each habit's `note` value — this is a column rename, not a data-clearing operation.

## Non-goals

- No change to any other field, to the analytics aggregation, to the chain/week-dots visuals, or to any other part of the page's layout — this spec is confined to the Type and Purpose/Note fields.
- No change to `habit_urgency` (already superseded by `priority` in v3, deliberately never dropped per this project's established additive-only convention for THAT column — that decision stands; `habit_type` is a separate, new decision the user made explicitly for this pass).

## Design

### 1. Schema migration

New function in `src/lib/migrate.ts`, following the existing `ensureHabitTrackingSchema`/`ensureHabitPriorityAndMinimumSchema` pattern (a module-level "ran" flag plus idempotent `ALTER TABLE` calls that tolerate being re-run after a process restart):

```ts
async function ensureHabitTypeRemovedAndNoteRenamedSchema(): Promise<void> {
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
- `DROP COLUMN habit_type` is genuinely destructive — every habit's current Habit/Routine value is permanently discarded. This is intentional and explicitly approved; no backup/soft-delete mechanism is in scope.
- `CHANGE COLUMN purpose note TEXT NULL` renames the column AND drops its implicit `NOT NULL` in one statement — existing text is preserved as-is under the new name, exactly like a plain rename.
- Both statements are individually idempotent (safe to re-run after the module-level flag resets on a process restart): the first tolerates "column doesn't exist" (already dropped), the second tolerates "column `purpose` doesn't exist" (already renamed).
- `CREATE TABLE IF NOT EXISTS habit_tasks` in `ensureHabitTablesExist()` still creates `habit_type ENUM(...) NOT NULL` and `purpose TEXT NOT NULL` for a genuinely fresh database (matching this file's own established convention of never rewriting the original `CREATE TABLE` statement, only layering `ALTER TABLE` calls after it) — a brand-new deploy target runs `ensureHabitTablesExist()` then immediately `ensureHabitTypeRemovedAndNoteRenamedSchema()` (both already called together at the top of every route handler, alongside the two existing `ensureHabit*Schema` calls), so it ends up in the same final shape as an upgraded existing database.
- Export the new function and add its call (with its import) to all 7 files that currently call `ensureHabitTrackingSchema`/`ensureHabitPriorityAndMinimumSchema` together: `src/app/api/habits/route.ts`, `src/app/api/habits/[id]/route.ts`, `src/app/api/habits/[id]/amount/route.ts`, `src/app/api/habits/[id]/history/route.ts`, `src/app/api/habits/[id]/checkin/route.ts`, `src/app/api/habits/summary/route.ts` — matching the exact existing call-site pattern in each (same placement, same style).

### 2. Backend types and logic (`src/lib/habits.ts`)

- Delete `export type HabitType = 'routine' | 'habit';` and `export const TYPE_OPTIONS: HabitType[] = ['habit', 'routine'];`.
- `HabitWithComputed`, `HabitInput`, `HabitRow`: remove the `habit_type: HabitType;` field from each; rename `purpose: string;` to `note: string | null;` in each (nullable, since it's now optional).
- `validateInput`: delete the `if (!input.purpose?.trim()) throw new Error('Purpose is required.');` line and the `if (!TYPE_OPTIONS.includes(input.habit_type)) throw new Error('Invalid type.');` line. `input.note` needs no presence validation (it's allowed to be absent/empty).
- Every SQL touching `purpose`/`habit_type` (the `getOwnedHabitRow`/`getHabitsForUser` `SELECT *` calls need no change since they already select all columns generically; the explicit column lists in `createHabit`'s `INSERT INTO habit_tasks (... purpose ... habit_type ...)` and `updateHabit`'s `SET ... purpose=? ... habit_type=? ...`) need `purpose`/`habit_type` removed from the column list and `note` substituted where `purpose` was, with its value now `input.note?.trim() || null` instead of the unconditional `input.purpose.trim()` (so an empty/whitespace-only note is stored as `NULL`, not an empty string).
- Every place that reads `row.purpose`/`row.habit_type` into `HabitWithComputed` (the `base` object in `getHabitsForUser`'s map) drops `habit_type: row.habit_type,` and changes `purpose: row.purpose,` to `note: row.note,`.

### 3. Frontend (`src/components/habits/HabitsDashboard.tsx`)

- Remove the `HabitType` import from `@/lib/habits`'s type import list, and the local `const TYPE_OPTIONS: HabitType[] = ['habit', 'routine'];` constant.
- `FormState`: remove `habit_type: HabitType | '';`; rename `purpose: string;` to `note: string;` (the form always works with a plain string internally — an empty string means "no note," converted to `undefined`/omitted at submit time rather than sent as `''`).
- `EMPTY_FORM`: remove `habit_type: ''`; rename `purpose: ''` to `note: ''`.
- `openEdit`: remove `habit_type: h.habit_type` from the object built for `setForm`; change `purpose: h.purpose` to `note: h.note ?? ''`.
- `submitForm`: delete the validation branch that requires `habit_type`/`purpose` together with `task_name` (the combined check `!form.task_name.trim() || !form.purpose.trim() || !form.task_category || !form.habit_type` becomes `!form.task_name.trim() || !form.task_category`); in the request body construction, remove `habit_type: form.habit_type` and change `purpose: form.purpose` to `note: form.note.trim() || undefined` (so a blank note isn't sent as an empty string — `undefined` on a JSON body simply omits the key).
- Modal JSX: delete the entire "Type" label + `<select>` block (the one populated from `TYPE_OPTIONS`). Change the "Purpose" label to "Note (optional)" and its `<textarea>`'s placeholder from `"Why does this matter to you?"` to something reflecting optionality, e.g. `"Add a note, if you'd like"` — bound to `form.note` instead of `form.purpose`.
- `HabitCard`: the purpose paragraph (`<p>{habit.purpose}</p>`, with its line-clamp styling) becomes conditional — only rendered when `habit.note` is truthy, so a habit with no note doesn't leave a blank gap on the card: `{habit.note && (<p style={{...}}>{habit.note}</p>)}`.
- Nowhere else in this file references `habit_type`/`purpose`/`HabitType`/`TYPE_OPTIONS` (confirmed via repo-wide search during design) — the add/edit modal's Type selector and the card's purpose paragraph are the only two UI touchpoints.

## Migration & compatibility

This is the first destructive schema change in the Habit Tracker's history (every prior migration in this project — `habit_urgency`→`priority`, the v2 flexible-scheduling columns, the v3 priority/minimum columns — was purely additive, old columns left in place even when superseded). `DROP COLUMN habit_type` permanently discards data with no rollback path; this was an explicit, informed choice, not an oversight. `CHANGE COLUMN purpose note` is non-destructive (a rename, not a delete) — every habit's existing purpose text survives as its note text.

No API route signature changes (the request/response body shape changes — `habit_type` disappears, `purpose` becomes `note`, `note` is optional — but no route path, method, or status-code behavior changes). No changes to `src/app/api/habits/**` route handler logic beyond adding the new migration call at the top of each, matching the existing two-call pattern already there.

## Testing / verification plan

Same standing approach as v1–v6 (no test framework in this repo): `tsc --noEmit`, then real calls against the local dev DB via a locally-signed session token —
- Confirm a fresh `DESCRIBE habit_tasks` (or equivalent) after the migration runs shows no `habit_type` column and a `note` column (nullable) where `purpose` used to be.
- Confirm an existing habit's previously-stored `purpose` text is readable as `note` after the migration (a rename preserves data — verify with a real row, not just schema shape).
- Create a new habit with no note filled in — confirm the API accepts it (no "Purpose is required" error) and the created habit's `note` is `null`, and its card shows no note paragraph (no blank gap).
- Create a new habit WITH a note — confirm it's stored, returned, and displayed correctly.
- Confirm the add/edit modal no longer shows a "Type" field anywhere, and confirm editing a pre-existing habit (created before this migration, so its `habit_type` value is gone) still opens and saves correctly with no error referencing the missing field.
- Confirm `tsc --noEmit` is clean — this change touches real type shapes (`HabitWithComputed`, `HabitInput`, `FormState`), so a stray reference to the removed `habit_type`/`HabitType`/`TYPE_OPTIONS` anywhere would now be a compile error, which is a meaningful confirmation the removal was complete.
