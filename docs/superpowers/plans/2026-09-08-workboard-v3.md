# Workboard v3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine Workboard from a flat four-context task list into a preconfigured, context-aware work system — each context carrying its real hierarchy, a structured Table view replacing Calendar in the primary navigation, multi-link resources, first-class deadline time, and corrected completion semantics.

**Architecture:** Everything remains a projection over one Work Item domain. `category` stays the database column and becomes `context` at the domain layer. Three new tables (organizations, links, subtasks) attach to either a Workboard-owned item or a Study Pulse entry via the four-nullable-FK-plus-CHECK pattern already used by `canvas_entry_links` and `workboard_entry_meta`. Per-context status vocabularies live in a new `work_stage` column while the existing `work_status` is retained as its normalised value, so every v2 read path keeps working unchanged.

**Tech Stack:** Next.js 15 App Router, TypeScript, mysql2/promise, lucide-react, React 19. No test framework installed — verification is `npx tsc --noEmit` plus real curl/mysql calls against the local dev DB using a locally-signed session token. No browser-automation tool exists in this environment; visual aspects are verified by code reading and rendered-HTML inspection, and that limit must be stated rather than implied away.

**Spec:** `docs/superpowers/specs/2026-09-08-workboard-v3-design.md` — read it before Task 1. Its "What the inspection found" and "Decisions taken during scoping" sections explain why several tasks deliberately contradict the source refinement document.

## Global Constraints

- **`my_work` is never persisted.** The `category` enum has no such member; My Work is an aggregate projection only.
- **The database column stays `category`.** `context` is the domain/UI term; one mapping point owns the translation. No destructive rename.
- **Study Pulse's schema is never altered.** Anything Workboard needs that Study Pulse has no column for lives in `workboard_entry_meta`.
- **The done-ness derivation rule stands:** for academic items, `entry.status === 'Done'` is checked FIRST, before anything in the overlay. A stale `work_stage` must never mask a genuinely completed item.
- **`work_status` is retained as the normalised value** and kept in sync whenever `work_stage` changes. Every v2 consumer (`groupByTimeframe`, `computeStats`, `computeWorkloadChart`, `getWorkItems`'s 14-day cutoff) continues reading it untouched.
- **Deadline is a date plus an optional time**, never a datetime with an invented midnight. Both owned and academic items store the date at `00:00:00` and the optional time in a separate `deadline_time` column. An absent time renders as `—`.
- **Client-bundle hazard:** `src/lib/workboard/aggregate.ts` and `workItems.ts` import `pool` (mysql2) at module top level. Any *runtime* (non-`import type`) import from either into a `'use client'` component 500s the entire `/workboard` page. This has already bitten twice. Pool-free modules for client use: `dates.ts`, `color.ts`, `workContexts.ts`, and the new `dueSemantics.ts` and `tableColumns.ts`.
- **Ownership verified before every write**, including client-supplied `project_id`, `user_subject_id`, `organization_id`, and link/subtask owners. A manipulated ID must never reach another user's data.
- **Wire shapes are snake_case**; internal function-input types are camelCase.
- **No new npm dependencies. No Tailwind.** Pseudo-classes and media queries via `<style jsx>` blocks alongside inline styles.
- **Route convention:** `auth()` → 401 if absent → `ensureWorkboardV3Schema()` → `parseInt(session.user.id)` → parameterized queries.
- **A stage must be legal for its context.** Service-layer validation rejects an Academic item stored as `backlog` or a Life item as `review` with a 400.

---

# PHASE 1 — DOMAIN

Tasks 1–12 establish the data model. Nothing in later phases is meaningful until this lands.

---

### Task 1: Schema migration

**Files:**
- Modify: `src/lib/migrate.ts` (add a new function at the bottom, following `ensureWorkboardV2Schema`'s pattern)

**Interfaces:**
- Produces: `ensureWorkboardV3Schema(): Promise<void>` — idempotent, safe on every request and across restarts. Consumed by every route in Phases 1–5.

- [ ] **Step 1: Add the migration function**

Add `let _ranWorkboardV3 = false;` alongside the other `_ran*` flags at the top of the file. The file already has `columnExists`, `constraintExists`, and `indexExists` helpers from v1 — reuse them, do not redefine.

```ts
/** Workboard v3: per-context hierarchy (organizations, scoped projects, Life areas),
 *  multi-link resources, flat subtasks, first-class deadline time, and per-context
 *  status stages. Study Pulse's own tables are never altered — academic deadline time
 *  and stage live on the workboard_entry_meta overlay. */
export async function ensureWorkboardV3Schema(): Promise<void> {
  if (_ranWorkboardV3) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS workboard_organizations (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      user_id     INT NOT NULL,
      name        VARCHAR(120) NOT NULL,
      status      ENUM('active','archived') NOT NULL DEFAULT 'active',
      created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_user_org_name (user_id, name),
      FOREIGN KEY (user_id) REFERENCES user_login(user_id) ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS workboard_item_links (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      user_id         INT NOT NULL,
      work_item_id    INT NULL,
      activity_id     INT NULL,
      quiz_id         INT NULL,
      exam_id         INT NULL,
      grade_entry_id  INT NULL,
      label           VARCHAR(120) NOT NULL,
      url             VARCHAR(2048) NOT NULL,
      link_type       ENUM('canvas','drive','docs','github','figma','website','portal','form','other')
                        NOT NULL DEFAULT 'other',
      position        SMALLINT NOT NULL DEFAULT 0,
      created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_link_work_item (work_item_id),
      KEY idx_link_user (user_id),
      FOREIGN KEY (user_id) REFERENCES user_login(user_id) ON DELETE CASCADE,
      FOREIGN KEY (work_item_id) REFERENCES workboard_work_items(id) ON DELETE CASCADE,
      FOREIGN KEY (activity_id) REFERENCES activities(activity_id) ON DELETE CASCADE,
      FOREIGN KEY (quiz_id) REFERENCES quizzes(quiz_id) ON DELETE CASCADE,
      FOREIGN KEY (exam_id) REFERENCES exams(exam_id) ON DELETE CASCADE,
      FOREIGN KEY (grade_entry_id) REFERENCES grade_entries(entry_id) ON DELETE CASCADE,
      CONSTRAINT chk_link_one_owner CHECK (
        (work_item_id IS NOT NULL) + (activity_id IS NOT NULL) + (quiz_id IS NOT NULL) +
        (exam_id IS NOT NULL) + (grade_entry_id IS NOT NULL) = 1
      )
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS workboard_subtasks (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      user_id         INT NOT NULL,
      work_item_id    INT NULL,
      activity_id     INT NULL,
      quiz_id         INT NULL,
      exam_id         INT NULL,
      grade_entry_id  INT NULL,
      title           VARCHAR(255) NOT NULL,
      is_done         TINYINT(1) NOT NULL DEFAULT 0,
      position        SMALLINT NOT NULL DEFAULT 0,
      created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_subtask_work_item (work_item_id),
      KEY idx_subtask_user (user_id),
      FOREIGN KEY (user_id) REFERENCES user_login(user_id) ON DELETE CASCADE,
      FOREIGN KEY (work_item_id) REFERENCES workboard_work_items(id) ON DELETE CASCADE,
      FOREIGN KEY (activity_id) REFERENCES activities(activity_id) ON DELETE CASCADE,
      FOREIGN KEY (quiz_id) REFERENCES quizzes(quiz_id) ON DELETE CASCADE,
      FOREIGN KEY (exam_id) REFERENCES exams(exam_id) ON DELETE CASCADE,
      FOREIGN KEY (grade_entry_id) REFERENCES grade_entries(entry_id) ON DELETE CASCADE,
      CONSTRAINT chk_subtask_one_owner CHECK (
        (work_item_id IS NOT NULL) + (activity_id IS NOT NULL) + (quiz_id IS NOT NULL) +
        (exam_id IS NOT NULL) + (grade_entry_id IS NOT NULL) = 1
      )
    )
  `);

  // --- workboard_projects: context scoping + optional parent ---
  const projectCols: [string, string][] = [
    ['context', `ADD COLUMN context ENUM('academic','project','organization') NOT NULL DEFAULT 'project'`],
    ['user_subject_id', `ADD COLUMN user_subject_id INT NULL`],
    ['organization_id', `ADD COLUMN organization_id INT NULL`],
  ];
  for (const [col, clause] of projectCols) {
    if (!(await columnExists('workboard_projects', col))) {
      await pool.query(`ALTER TABLE workboard_projects ${clause}`);
    }
  }
  if (!(await constraintExists('workboard_projects', 'fk_project_subject'))) {
    await pool.query(`ALTER TABLE workboard_projects
      ADD CONSTRAINT fk_project_subject FOREIGN KEY (user_subject_id)
      REFERENCES user_subjects(user_subject_id) ON DELETE CASCADE`);
  }
  if (!(await constraintExists('workboard_projects', 'fk_project_org'))) {
    await pool.query(`ALTER TABLE workboard_projects
      ADD CONSTRAINT fk_project_org FOREIGN KEY (organization_id)
      REFERENCES workboard_organizations(id) ON DELETE CASCADE`);
  }

  // --- workboard_work_items: life area, organization, deadline time, stage ---
  const itemCols: [string, string][] = [
    ['life_area', `ADD COLUMN life_area ENUM('personal','household','errands','finance','health','other') NULL`],
    ['organization_id', `ADD COLUMN organization_id INT NULL`],
    ['deadline_time', `ADD COLUMN deadline_time TIME NULL`],
    ['work_stage', `ADD COLUMN work_stage VARCHAR(24) NULL`],
  ];
  for (const [col, clause] of itemCols) {
    if (!(await columnExists('workboard_work_items', col))) {
      await pool.query(`ALTER TABLE workboard_work_items ${clause}`);
    }
  }
  if (!(await constraintExists('workboard_work_items', 'fk_item_org'))) {
    await pool.query(`ALTER TABLE workboard_work_items
      ADD CONSTRAINT fk_item_org FOREIGN KEY (organization_id)
      REFERENCES workboard_organizations(id) ON DELETE SET NULL`);
  }

  // --- workboard_entry_meta: academic deadline time + stage ---
  for (const [col, clause] of [
    ['deadline_time', `ADD COLUMN deadline_time TIME NULL`],
    ['work_stage', `ADD COLUMN work_stage VARCHAR(24) NULL`],
  ] as [string, string][]) {
    if (!(await columnExists('workboard_entry_meta', col))) {
      await pool.query(`ALTER TABLE workboard_entry_meta ${clause}`);
    }
  }

  // --- One-time data migrations, each idempotent by construction ---

  // 1. Existing overlay in_progress flags become the equivalent stage.
  //    `in_progress` is retained and kept in sync for one release (see the spec's
  //    Migration section) so a rollback loses nothing.
  await pool.query(`
    UPDATE workboard_entry_meta
    SET work_stage = 'in_progress'
    WHERE in_progress = 1 AND work_stage IS NULL
  `);

  // 2. Owned items get a stage derived from their existing normalised status.
  await pool.query(`
    UPDATE workboard_work_items
    SET work_stage = work_status
    WHERE work_stage IS NULL
  `);

  // 3. Any owned item whose due_at carries a non-midnight time moves that time into
  //    deadline_time and zeroes the time component, so "due at midnight" and "no time
  //    set" stop being indistinguishable. Guarded on deadline_time IS NULL so a second
  //    run cannot clobber a time the user has since edited.
  await pool.query(`
    UPDATE workboard_work_items
    SET deadline_time = TIME(due_at), due_at = DATE(due_at)
    WHERE due_at IS NOT NULL AND TIME(due_at) <> '00:00:00' AND deadline_time IS NULL
  `);

  _ranWorkboardV3 = true;
}
```

- [ ] **Step 2: Run `tsc`**

```bash
npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 3: Verify against the real local dev DB**

Same standalone-script style as v1/v2's schema tasks — `mysql2/promise` is already a dependency, so plain `node -e` drives it. Ensure XAMPP's MySQL is running first.

```bash
node -e "
const mysql = require('mysql2/promise');
(async () => {
  const c = await mysql.createConnection({ host:'localhost', user:'root', database:'vibeboard' });
  for (const t of ['workboard_organizations','workboard_item_links','workboard_subtasks']) {
    const [r] = await c.query('SHOW TABLES LIKE ?', [t]);
    console.log(t + ':', r.length ? 'exists' : 'MISSING');
  }
  for (const [t, cols] of [
    ['workboard_projects', ['context','user_subject_id','organization_id']],
    ['workboard_work_items', ['life_area','organization_id','deadline_time','work_stage']],
    ['workboard_entry_meta', ['deadline_time','work_stage']],
  ]) {
    const [r] = await c.query('SHOW COLUMNS FROM ' + t);
    const have = r.map(x => x.Field);
    console.log(t + ':', cols.map(x => x + (have.includes(x) ? '=ok' : '=MISSING')).join(' '));
  }
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
"
```

Run the app's own migration by hitting any Workboard route once the dev server is up (`curl -s http://localhost:3000/api/workboard/work` with the `user_id 6` cookie — see Task 5's recipe), then run the script above. Expected: all three tables `exists`, all nine columns `=ok`.

Then confirm the CHECK constraints landed and the data migrations are correct:
```bash
"C:\xampp\mysql\bin\mysql.exe" -u root vibeboard -e "
SHOW CREATE TABLE workboard_item_links\G
SELECT COUNT(*) AS stage_backfilled FROM workboard_work_items WHERE work_stage IS NOT NULL;
SELECT COUNT(*) AS midnight_due FROM workboard_work_items WHERE due_at IS NOT NULL AND TIME(due_at) <> '00:00:00';
"
```
Expected: `chk_link_one_owner` present; `stage_backfilled` equals the total owned-item count; `midnight_due` is 0. If the CHECK is absent (some MariaDB builds ignore it silently), report that as a concern rather than proceeding as if it worked — it is the only thing preventing a link that points at two owners.

Hit the migration a second time and re-run the script: identical output, no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/migrate.ts
git commit -m "Add Workboard v3 schema: organizations, links, subtasks, context hierarchy, deadline time, stages"
```

---

### Task 2: Context terminology and stage vocabularies

**Files:**
- Create: `src/lib/workboard/workContexts.ts`
- Modify: `src/lib/workboard/workCategories.ts` (becomes a thin re-export for one release)

**Interfaces:**
- Produces: `WorkContext`, `WORK_CONTEXTS`, `CONTEXT_LABELS`, `WorkStage`, `STAGES_BY_CONTEXT`, `STAGE_LABELS`, `normaliseStage`, `isStageLegal`, `LIFE_AREAS`, `LifeArea`. Consumed by nearly every later task.
- **Must remain pool-free** — client components import it at runtime.

- [ ] **Step 1: Write the module**

```ts
/** The domain term is "context". The database column is still `category` (spec: no
 *  destructive rename) — this module is the single translation point. */
export type WorkContext = 'academic' | 'project' | 'organization' | 'life';

export const WORK_CONTEXTS: WorkContext[] = ['academic', 'project', 'organization', 'life'];

export const CONTEXT_LABELS: Record<WorkContext, string> = {
  academic:     'Academic',
  project:      'Projects',
  organization: 'Organization',
  life:         'Life',
};

export type LifeArea = 'personal' | 'household' | 'errands' | 'finance' | 'health' | 'other';
export const LIFE_AREAS: LifeArea[] = ['personal', 'household', 'errands', 'finance', 'health', 'other'];
export const LIFE_AREA_LABELS: Record<LifeArea, string> = {
  personal: 'Personal', household: 'Household', errands: 'Errands',
  finance: 'Finance', health: 'Health', other: 'Other',
};

/** The normalised three-value status every v2 consumer still reads. */
export type WorkStatus = 'todo' | 'in_progress' | 'done';

/** Per-context vocabularies. Stored as VARCHAR(24) so adding a state later is not a
 *  migration — which is exactly why the service layer must validate legality. */
export type WorkStage =
  | 'backlog' | 'todo' | 'in_progress' | 'ready_to_submit'
  | 'submitted' | 'review' | 'blocked' | 'done';

export const STAGES_BY_CONTEXT: Record<WorkContext, WorkStage[]> = {
  academic:     ['todo', 'in_progress', 'ready_to_submit', 'submitted', 'done'],
  project:      ['backlog', 'todo', 'in_progress', 'review', 'blocked', 'done'],
  organization: ['todo', 'in_progress', 'review', 'blocked', 'done'],
  life:         ['todo', 'in_progress', 'done'],
};

export const STAGE_LABELS: Record<WorkStage, string> = {
  backlog:         'Backlog',
  todo:            'To Do',
  in_progress:     'In Progress',
  ready_to_submit: 'Ready to Submit',
  submitted:       'Submitted',
  review:          'Review',
  blocked:         'Blocked',
  done:            'Done',
};

/**
 * Collapses a per-context stage to the normalised three-value status that
 * `work_status` stores and every v2 consumer reads. My Work's Board uses these three
 * columns directly (spec §17); `blocked` additionally renders a badge so the state is
 * not lost in the normalised view.
 */
export function normaliseStage(stage: WorkStage): WorkStatus {
  switch (stage) {
    case 'backlog':
    case 'todo':
      return 'todo';
    case 'in_progress':
    case 'ready_to_submit':
    case 'review':
    case 'blocked':
      return 'in_progress';
    case 'submitted':
    case 'done':
      return 'done';
  }
}

/** A stage must belong to its context's vocabulary. Callers reject with 400 rather than
 *  storing a nonsense state — the column is a free string, so this is the only guard. */
export function isStageLegal(context: WorkContext, stage: string): stage is WorkStage {
  return (STAGES_BY_CONTEXT[context] as string[]).includes(stage);
}

/** The default stage for a newly-created item in a given context. */
export function defaultStage(context: WorkContext): WorkStage {
  return 'todo';
}
```

- [ ] **Step 2: Turn the old module into a re-export**

`workCategories.ts` is imported by several v2 files. Rather than editing every call site in this task (which would balloon the diff and mix concerns), replace its contents with a re-export so both names resolve during the transition. Later tasks migrate call sites as they touch them.

```ts
/** @deprecated Use `@/lib/workboard/workContexts`. The domain term is "context"; this
 *  module remains for one release so v2 call sites keep resolving. */
export type { WorkContext as WorkCategory } from '@/lib/workboard/workContexts';
export { WORK_CONTEXTS as WORK_CATEGORIES } from '@/lib/workboard/workContexts';
```

- [ ] **Step 3: Run `tsc`**

```bash
npx tsc --noEmit
```
Expected: zero errors. If a call site breaks on the type-only re-export, fix that call site to import from `workContexts` directly rather than widening the shim.

- [ ] **Step 4: Verify the normalisation by tracing cases**

No test framework; these are pure functions. Trace each against the code and write the results into your report:
- `normaliseStage('backlog')` → `'todo'`; `normaliseStage('ready_to_submit')` → `'in_progress'`; `normaliseStage('submitted')` → `'done'`; `normaliseStage('blocked')` → `'in_progress'`.
- `isStageLegal('academic', 'backlog')` → `false` (Academic has no backlog); `isStageLegal('project', 'backlog')` → `true`; `isStageLegal('life', 'review')` → `false`; `isStageLegal('organization', 'review')` → `true`.
- Every value in every `STAGES_BY_CONTEXT` array is a member of `WorkStage` — confirm by inspection, since a typo here is a runtime-only bug the compiler will catch through the `Record<WorkContext, WorkStage[]>` annotation.

- [ ] **Step 5: Commit**

```bash
git add src/lib/workboard/workContexts.ts src/lib/workboard/workCategories.ts
git commit -m "Add Workboard context terminology and per-context stage vocabularies"
```

---

### Task 3: Ownership helpers

**Files:**
- Create: `src/lib/workboard/ownership.ts`
- Modify: `src/app/api/workboard/work-items/route.ts` (move `checkReferences` out, import it back)
- Modify: `src/app/api/workboard/work-items/[id]/route.ts` (import from the new module)

**Interfaces:**
- Produces: `checkReferences(userId, refs): Promise<string | null>`, `resolveOwner(userId, owner): Promise<OwnerColumns | null>`, type `LinkOwner`. Consumed by Tasks 4–11.
- Server-only (imports `pool`) — never import at runtime from a client component.

This task also resolves a v2 review note: `checkReferences` currently lives in a route file and is imported across routes, which is legal but unconventional. Moving it to `src/lib/workboard/` is the tidy-up that note asked for, done now because this task extends it anyway.

- [ ] **Step 1: Write the module**

```ts
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';

export interface ReferenceCheck {
  projectId?:      unknown;
  userSubjectId?:  unknown;
  organizationId?: unknown;
}

/** Returns null when every supplied reference is absent or genuinely the user's;
 *  returns a message when a supplied id is not theirs. Never trust an id from a
 *  request body — this is the guard v1's final review found missing. */
export async function checkReferences(userId: number, refs: ReferenceCheck): Promise<string | null> {
  const checks: [unknown, string, string, string][] = [
    [refs.projectId,      'workboard_projects',      'id',              'That project was not found'],
    [refs.userSubjectId,  'user_subjects',           'user_subject_id', 'That subject was not found'],
    [refs.organizationId, 'workboard_organizations', 'id',              'That organization was not found'],
  ];

  for (const [value, table, idCol, message] of checks) {
    if (value === null || value === undefined) continue;
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT 1 FROM \`${table}\` WHERE \`${idCol}\` = ? AND user_id = ?`,
      [value as string | number, userId],
    );
    if (!rows.length) return message;
  }
  return null;
}

/** Links and subtasks attach to exactly one owner: a Workboard item or one of the four
 *  Study Pulse entry tables. */
export type LinkOwner =
  | { kind: 'owned';          id: number }
  | { kind: 'activities';     id: number }
  | { kind: 'quizzes';        id: number }
  | { kind: 'exams';          id: number }
  | { kind: 'grade_entries';  id: number };

export interface OwnerColumns {
  column: 'work_item_id' | 'activity_id' | 'quiz_id' | 'exam_id' | 'grade_entry_id';
  id:     number;
}

const OWNER_SPECS: Record<LinkOwner['kind'], { table: string; pk: string; column: OwnerColumns['column'] }> = {
  owned:         { table: 'workboard_work_items', pk: 'id',          column: 'work_item_id' },
  activities:    { table: 'activities',           pk: 'activity_id', column: 'activity_id' },
  quizzes:       { table: 'quizzes',              pk: 'quiz_id',     column: 'quiz_id' },
  exams:         { table: 'exams',                pk: 'exam_id',     column: 'exam_id' },
  grade_entries: { table: 'grade_entries',        pk: 'entry_id',    column: 'grade_entry_id' },
};

/**
 * Confirms the owner belongs to this user and returns which column to write.
 * Owned items carry their own `user_id`; Study Pulse entries have none, so ownership
 * is established by joining `user_subjects` — the same rule every academic path uses.
 * Returns null when the owner is not the user's, which callers turn into a 404.
 */
export async function resolveOwner(userId: number, owner: LinkOwner): Promise<OwnerColumns | null> {
  const spec = OWNER_SPECS[owner.kind];
  if (!spec) return null;

  const sql = owner.kind === 'owned'
    ? `SELECT 1 FROM \`${spec.table}\` WHERE \`${spec.pk}\` = ? AND user_id = ?`
    : `SELECT 1 FROM \`${spec.table}\` t
       JOIN user_subjects us ON us.user_subject_id = t.user_subject_id
       WHERE t.\`${spec.pk}\` = ? AND us.user_id = ?`;

  const [rows] = await pool.execute<RowDataPacket[]>(sql, [owner.id, userId]);
  if (!rows.length) return null;
  return { column: spec.column, id: owner.id };
}
```

- [ ] **Step 2: Point the two work-items routes at the new module**

In `src/app/api/workboard/work-items/route.ts`, delete the local `checkReferences` definition and its export, and import instead:
```ts
import { checkReferences } from '@/lib/workboard/ownership';
```
Update its two call sites to the new object-argument shape:
```ts
const refError = await checkReferences(userId, {
  projectId: project_id, userSubjectId: user_subject_id, organizationId: organization_id,
});
```
In `src/app/api/workboard/work-items/[id]/route.ts`, replace `import { checkReferences } from '../route';` with the same `@/lib/workboard/ownership` import and update its call site the same way, passing `undefined` for keys absent from the body:
```ts
const refError = await checkReferences(userId, {
  projectId:      'project_id' in body ? body.project_id : undefined,
  userSubjectId:  'user_subject_id' in body ? body.user_subject_id : undefined,
  organizationId: 'organization_id' in body ? body.organization_id : undefined,
});
```

- [ ] **Step 3: Run `tsc`**

```bash
npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 4: Verify the existing behaviour still holds**

The v2 cross-user rejection must still work after the move. Generate a `user_id 6` token (recipe in Task 5), create a project as a *different* user (`sub: '1'`), then confirm user 6 cannot attach it:

```bash
curl -s -X POST -H "Cookie: authjs.session-token=<token6>" -H "Content-Type: application/json" \
  -d '{"category":"project","title":"ownership probe","project_id":<P1>}' \
  "http://localhost:3000/api/workboard/work-items"
```
Expected: `400 {"error":"That project was not found"}` — unchanged from v2. Confirm via `mysql.exe` that no row was written. Clean up the probe project.

- [ ] **Step 5: Commit**

```bash
git add src/lib/workboard/ownership.ts src/app/api/workboard/work-items
git commit -m "Extract and extend ownership checks into a shared module"
```

---

### Task 4: Organizations service and routes

**Files:**
- Create: `src/lib/workboard/organizations.ts`
- Create: `src/app/api/workboard/organizations/route.ts` (GET, POST)
- Create: `src/app/api/workboard/organizations/[id]/route.ts` (PATCH, DELETE)

**Interfaces:**
- Consumes: `ensureWorkboardV3Schema` (Task 1).
- Produces: `OrganizationSummary { id, name, status }`, `listOrganizations(userId)`, `createOrganization(userId, name)`. Consumed by Tasks 8, 12, 28.

- [ ] **Step 1: Write the service**

```ts
import pool from '@/lib/db';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export interface OrganizationSummary {
  id:     number;
  name:   string;
  status: 'active' | 'archived';
}

export async function listOrganizations(userId: number): Promise<OrganizationSummary[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, name, status FROM workboard_organizations
     WHERE user_id = ? ORDER BY status ASC, name ASC`,
    [userId],
  );
  return rows.map(r => ({ id: r.id, name: r.name, status: r.status }));
}

export async function createOrganization(userId: number, name: string): Promise<number> {
  const [res] = await pool.execute<ResultSetHeader>(
    `INSERT INTO workboard_organizations (user_id, name) VALUES (?, ?)`,
    [userId, name.trim()],
  );
  return res.insertId;
}
```

- [ ] **Step 2: Write GET/POST**

Mirrors the projects routes exactly, including the `ER_DUP_ENTRY` → clean 400 handling the unique key requires.

```ts
import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { ensureWorkboardV3Schema } from '@/lib/migrate';
import { listOrganizations, createOrganization } from '@/lib/workboard/organizations';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureWorkboardV3Schema();
  return Response.json({ organizations: await listOrganizations(parseInt(session.user.id)) });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureWorkboardV3Schema();

  const body = await req.json();
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return Response.json({ error: 'Body must be an object' }, { status: 400 });
  }
  const { name } = body;
  if (typeof name !== 'string' || !name.trim()) {
    return Response.json({ error: 'An organization name is required' }, { status: 400 });
  }

  try {
    return Response.json({ status: 'success', organization_id: await createOrganization(parseInt(session.user.id), name) });
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'ER_DUP_ENTRY') {
      return Response.json({ error: 'You already have an organization with that name' }, { status: 400 });
    }
    throw err;
  }
}
```

- [ ] **Step 3: Write PATCH/DELETE**

```ts
import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

const PATCHABLE = ['name', 'status'] as const;

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = parseInt(session.user.id);
  const { id } = await props.params;
  const orgId = parseInt(id);

  const [owns] = await pool.execute<RowDataPacket[]>(
    'SELECT id FROM workboard_organizations WHERE id = ? AND user_id = ?', [orgId, userId],
  );
  if (!owns.length) return Response.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return Response.json({ error: 'Body must be an object' }, { status: 400 });
  }
  if ('name' in body && (typeof body.name !== 'string' || !body.name.trim())) {
    return Response.json({ error: 'An organization name is required' }, { status: 400 });
  }
  if ('status' in body && body.status !== 'active' && body.status !== 'archived') {
    return Response.json({ error: 'status must be "active" or "archived"' }, { status: 400 });
  }

  const sets: string[] = [];
  const values: (string | null)[] = [];
  for (const field of PATCHABLE) {
    if (field in body) { sets.push(`${field} = ?`); values.push(body[field] ?? null); }
  }
  if (!sets.length) return Response.json({ error: 'No fields to update' }, { status: 400 });

  try {
    await pool.execute(`UPDATE workboard_organizations SET ${sets.join(', ')} WHERE id = ?`, [...values, orgId]);
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'ER_DUP_ENTRY') {
      return Response.json({ error: 'You already have an organization with that name' }, { status: 400 });
    }
    throw err;
  }
  return Response.json({ status: 'success' });
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await props.params;

  const [res] = await pool.execute<ResultSetHeader>(
    'DELETE FROM workboard_organizations WHERE id = ? AND user_id = ?',
    [parseInt(id), parseInt(session.user.id)],
  );
  if (res.affectedRows === 0) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json({ status: 'success' });
}
```

Deleting an organization sets `workboard_work_items.organization_id` to NULL (`ON DELETE SET NULL`) so its work survives, and cascades to its projects (`ON DELETE CASCADE` on `workboard_projects.organization_id`) because an initiative without its organization is meaningless. Note this asymmetry in your report — it is deliberate.

- [ ] **Step 4: Run `tsc`, then verify**

```bash
npx tsc --noEmit
```
Then, with a `user_id 6` token (Task 5's recipe): create an organization; create a duplicate and confirm the clean 400; list; rename; archive; confirm a `sub: '1'` token gets 404 on both PATCH and DELETE; delete; confirm re-delete is 404. Confirm `workboard_organizations` returns to zero rows.

- [ ] **Step 5: Commit**

```bash
git add src/lib/workboard/organizations.ts src/app/api/workboard/organizations
git commit -m "Add Workboard organizations service and routes"
```

---

### Task 5: Links service and routes

**Files:**
- Create: `src/lib/workboard/links.ts`
- Create: `src/app/api/workboard/links/route.ts` (POST)
- Create: `src/app/api/workboard/links/[id]/route.ts` (PATCH, DELETE)

**Interfaces:**
- Consumes: `resolveOwner`, `LinkOwner` (Task 3); `ensureWorkboardV3Schema` (Task 1).
- Produces: `WorkLink { id, label, url, link_type, position }`, `LINK_TYPES`, `listLinksForOwners`, `createLink`. Consumed by Tasks 8, 23, 32.

**Session-token recipe** (used by every verification step from here on):
```bash
node -e "
const { encode } = require('next-auth/jwt');
(async () => {
  console.log(await encode({
    token: { sub: '6', name: 'Test User' },
    secret: 'vibeboard-dev-secret-replace-in-production',
    salt: 'authjs.session-token',
  }));
})();
"
```
`.env.local` carries `AUTH_SECRET=vibeboard-dev-secret-replace-in-production` and `AUTH_URL=http://localhost:3000`. `user_id 6` is the fixture account (subjects 11/12/13/15, real Study Pulse entries). Start the dev server with `npm run dev` if it isn't running; it must bind port 3000 to match `AUTH_URL`.

- [ ] **Step 1: Write the service**

```ts
import pool from '@/lib/db';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import type { OwnerColumns } from '@/lib/workboard/ownership';

export const LINK_TYPES = [
  'canvas', 'drive', 'docs', 'github', 'figma', 'website', 'portal', 'form', 'other',
] as const;
export type LinkType = typeof LINK_TYPES[number];

export interface WorkLink {
  id:        number;
  label:     string;
  url:       string;
  link_type: LinkType;
  position:  number;
}

/** URLs are validated before storage and rendered by label, never as raw URLs (spec §10).
 *  Only http/https are accepted — a `javascript:` URL rendered as a link would be an
 *  injection vector, so the scheme allow-list is a security control, not a nicety. */
export function isValidUrl(url: unknown): url is string {
  if (typeof url !== 'string' || url.length > 2048) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function createLink(
  userId: number, owner: OwnerColumns,
  link: { label: string; url: string; link_type: LinkType },
): Promise<number> {
  const [maxRow] = await pool.execute<RowDataPacket[]>(
    `SELECT COALESCE(MAX(position), -1) + 1 AS next FROM workboard_item_links
     WHERE \`${owner.column}\` = ?`,
    [owner.id],
  );
  const [res] = await pool.execute<ResultSetHeader>(
    `INSERT INTO workboard_item_links (user_id, \`${owner.column}\`, label, url, link_type, position)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, owner.id, link.label.trim(), link.url, link.link_type, maxRow[0].next],
  );
  return res.insertId;
}
```

The `owner.column` interpolation is safe: it comes only from `OWNER_SPECS` in Task 3's module, never from request input — the same pattern `academicWrites.ts` already uses for `ACADEMIC_TABLES`.

- [ ] **Step 2: Write POST**

```ts
import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { ensureWorkboardV3Schema } from '@/lib/migrate';
import { resolveOwner, type LinkOwner } from '@/lib/workboard/ownership';
import { createLink, isValidUrl, LINK_TYPES, type LinkType } from '@/lib/workboard/links';

const OWNER_KINDS = ['owned', 'activities', 'quizzes', 'exams', 'grade_entries'];

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureWorkboardV3Schema();
  const userId = parseInt(session.user.id);

  const body = await req.json();
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return Response.json({ error: 'Body must be an object' }, { status: 400 });
  }
  const { owner_kind, owner_id, label, url, link_type } = body;

  if (!OWNER_KINDS.includes(owner_kind)) {
    return Response.json({ error: 'Invalid owner_kind' }, { status: 400 });
  }
  if (typeof label !== 'string' || !label.trim() || label.length > 120) {
    return Response.json({ error: 'A label between 1 and 120 characters is required' }, { status: 400 });
  }
  if (!isValidUrl(url)) {
    return Response.json({ error: 'A valid http or https URL is required' }, { status: 400 });
  }
  if (link_type !== undefined && !LINK_TYPES.includes(link_type)) {
    return Response.json({ error: 'Invalid link_type' }, { status: 400 });
  }

  const owner = await resolveOwner(userId, { kind: owner_kind, id: parseInt(owner_id) } as LinkOwner);
  if (!owner) return Response.json({ error: 'Not found' }, { status: 404 });

  const id = await createLink(userId, owner, {
    label, url, link_type: (link_type ?? 'other') as LinkType,
  });
  return Response.json({ status: 'success', link_id: id });
}
```

- [ ] **Step 3: Write PATCH/DELETE**

Both scope by `user_id` directly, since `workboard_item_links` carries its own — no owner join needed for the mutation itself.

```ts
import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { isValidUrl, LINK_TYPES } from '@/lib/workboard/links';

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = parseInt(session.user.id);
  const { id } = await props.params;
  const linkId = parseInt(id);

  const [owns] = await pool.execute<RowDataPacket[]>(
    'SELECT id FROM workboard_item_links WHERE id = ? AND user_id = ?', [linkId, userId],
  );
  if (!owns.length) return Response.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return Response.json({ error: 'Body must be an object' }, { status: 400 });
  }
  if ('label' in body && (typeof body.label !== 'string' || !body.label.trim() || body.label.length > 120)) {
    return Response.json({ error: 'A label between 1 and 120 characters is required' }, { status: 400 });
  }
  if ('url' in body && !isValidUrl(body.url)) {
    return Response.json({ error: 'A valid http or https URL is required' }, { status: 400 });
  }
  if ('link_type' in body && !LINK_TYPES.includes(body.link_type)) {
    return Response.json({ error: 'Invalid link_type' }, { status: 400 });
  }

  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  for (const field of ['label', 'url', 'link_type', 'position'] as const) {
    if (field in body) { sets.push(`${field} = ?`); values.push(body[field]); }
  }
  if (!sets.length) return Response.json({ error: 'No fields to update' }, { status: 400 });

  await pool.execute(`UPDATE workboard_item_links SET ${sets.join(', ')} WHERE id = ?`, [...values, linkId]);
  return Response.json({ status: 'success' });
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await props.params;

  const [res] = await pool.execute<ResultSetHeader>(
    'DELETE FROM workboard_item_links WHERE id = ? AND user_id = ?',
    [parseInt(id), parseInt(session.user.id)],
  );
  if (res.affectedRows === 0) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json({ status: 'success' });
}
```

- [ ] **Step 4: Run `tsc`, then verify against the real dev DB**

```bash
npx tsc --noEmit
```

With the `user_id 6` token, exercise **both owner kinds** — that duality is the whole point of the polymorphic design:
1. Create an owned work item, attach two links to it, confirm `position` increments 0 then 1.
2. Attach a link to a real **academic** entry (`owner_kind: 'activities'`, a real `activity_id` belonging to user 6 — find one with `SELECT a.activity_id FROM activities a JOIN user_subjects us ON us.user_subject_id = a.user_subject_id WHERE us.user_id = 6 LIMIT 1`). Confirm via `mysql.exe` that the row landed with `activity_id` set and `work_item_id` NULL, and that Study Pulse's own row is untouched.
3. Reject a `javascript:alert(1)` URL — expect 400, no row written.
4. Reject an owner that isn't the user's: attach to an `activity_id` belonging to a different user — expect 404.
5. PATCH a label; DELETE; confirm re-delete is 404.
6. Delete the owned work item and confirm its links cascaded away (`SELECT COUNT(*)` on the link table for that id → 0).

Clean up every test row and confirm baseline counts.

- [ ] **Step 5: Commit**

```bash
git add src/lib/workboard/links.ts src/app/api/workboard/links
git commit -m "Add Workboard multi-link resources with URL validation and polymorphic owners"
```

---

### Task 6: Subtasks service and routes

**Files:**
- Create: `src/lib/workboard/subtasks.ts`
- Create: `src/app/api/workboard/subtasks/route.ts` (POST)
- Create: `src/app/api/workboard/subtasks/[id]/route.ts` (PATCH, DELETE)

**Interfaces:**
- Consumes: `resolveOwner`, `OwnerColumns` (Task 3); `ensureWorkboardV3Schema` (Task 1).
- Produces: `Subtask { id, title, is_done, position }`, `createSubtask`. Consumed by Tasks 8, 32.

- [ ] **Step 1: Write the service**

Structurally identical to `links.ts` — same polymorphic owner, same position sequencing.

```ts
import pool from '@/lib/db';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import type { OwnerColumns } from '@/lib/workboard/ownership';

export interface Subtask {
  id:       number;
  title:    string;
  is_done:  boolean;
  position: number;
}

export async function createSubtask(
  userId: number, owner: OwnerColumns, title: string,
): Promise<number> {
  const [maxRow] = await pool.execute<RowDataPacket[]>(
    `SELECT COALESCE(MAX(position), -1) + 1 AS next FROM workboard_subtasks
     WHERE \`${owner.column}\` = ?`,
    [owner.id],
  );
  const [res] = await pool.execute<ResultSetHeader>(
    `INSERT INTO workboard_subtasks (user_id, \`${owner.column}\`, title, position)
     VALUES (?, ?, ?, ?)`,
    [userId, owner.id, title.trim(), maxRow[0].next],
  );
  return res.insertId;
}
```

- [ ] **Step 2: Write POST**

Same shape as the links POST: validate `owner_kind` against the five kinds, validate `title` (1–255 chars), `resolveOwner` → 404 if not the user's, then insert.

```ts
import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import { ensureWorkboardV3Schema } from '@/lib/migrate';
import { resolveOwner, type LinkOwner } from '@/lib/workboard/ownership';
import { createSubtask } from '@/lib/workboard/subtasks';

const OWNER_KINDS = ['owned', 'activities', 'quizzes', 'exams', 'grade_entries'];

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureWorkboardV3Schema();
  const userId = parseInt(session.user.id);

  const body = await req.json();
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return Response.json({ error: 'Body must be an object' }, { status: 400 });
  }
  const { owner_kind, owner_id, title } = body;

  if (!OWNER_KINDS.includes(owner_kind)) {
    return Response.json({ error: 'Invalid owner_kind' }, { status: 400 });
  }
  if (typeof title !== 'string' || !title.trim() || title.length > 255) {
    return Response.json({ error: 'A title between 1 and 255 characters is required' }, { status: 400 });
  }

  const owner = await resolveOwner(userId, { kind: owner_kind, id: parseInt(owner_id) } as LinkOwner);
  if (!owner) return Response.json({ error: 'Not found' }, { status: 404 });

  return Response.json({ status: 'success', subtask_id: await createSubtask(userId, owner, title) });
}
```

- [ ] **Step 3: Write PATCH/DELETE**

PATCH accepts `title`, `is_done`, and `position`, scoped by `WHERE id = ? AND user_id = ?` with a prior ownership SELECT, exactly as the links route does. `is_done` is coerced to 0/1:

```ts
for (const field of ['title', 'is_done', 'position'] as const) {
  if (field in body) {
    sets.push(`${field} = ?`);
    values.push(field === 'is_done' ? (body.is_done ? 1 : 0) : body[field]);
  }
}
```
DELETE is a single `DELETE FROM workboard_subtasks WHERE id = ? AND user_id = ?` checking `affectedRows`.

- [ ] **Step 4: Run `tsc`, then verify**

```bash
npx tsc --noEmit
```
With the `user_id 6` token: add two subtasks to an owned item (confirm positions 0, 1); add one to a real academic entry and confirm it lands on `activity_id` with Study Pulse untouched; toggle `is_done` and confirm it persists; cross-user 404 on PATCH and DELETE; delete the parent work item and confirm subtasks cascade. Clean up and confirm baseline.

- [ ] **Step 5: Commit**

```bash
git add src/lib/workboard/subtasks.ts src/app/api/workboard/subtasks
git commit -m "Add Workboard flat subtasks with polymorphic owners"
```

---

### Task 7: Context-scoped projects

**Files:**
- Modify: `src/app/api/workboard/projects/route.ts` (GET returns context/parent; POST accepts and validates them)
- Modify: `src/app/api/workboard/projects/[id]/route.ts` (PATCH accepts them)

**Interfaces:**
- Consumes: `checkReferences` (Task 3); `WorkContext` (Task 2).
- Produces: `ProjectSummary` gains `context`, `user_subject_id`, `organization_id`. Consumed by Tasks 8, 12, 26–29.

- [ ] **Step 1: Extend GET and POST**

GET selects the new columns:
```ts
`SELECT id, name, color, status, context, user_subject_id, organization_id
 FROM workboard_projects WHERE user_id = ? ORDER BY status ASC, name ASC`
```

POST validates the conditional parent rule. This is the service-layer check the spec calls for, since MySQL's CHECK support for a conditional constraint of this shape is inconsistent:

```ts
const PROJECT_CONTEXTS = ['academic', 'project', 'organization'];

// ...after the name check:
const context = body.context ?? 'project';
if (!PROJECT_CONTEXTS.includes(context)) {
  return Response.json({ error: 'context must be academic, project, or organization' }, { status: 400 });
}
if (context === 'academic' && !body.user_subject_id) {
  return Response.json({ error: 'An academic project requires a course' }, { status: 400 });
}
if (context === 'organization' && !body.organization_id) {
  return Response.json({ error: 'An organization project requires an organization' }, { status: 400 });
}
if (context === 'project' && (body.user_subject_id || body.organization_id)) {
  return Response.json({ error: 'A standalone project cannot have a course or organization parent' }, { status: 400 });
}
if (context === 'academic' && body.organization_id) {
  return Response.json({ error: 'An academic project cannot have an organization parent' }, { status: 400 });
}
if (context === 'organization' && body.user_subject_id) {
  return Response.json({ error: 'An organization project cannot have a course parent' }, { status: 400 });
}

const refError = await checkReferences(userId, {
  userSubjectId:  body.user_subject_id,
  organizationId: body.organization_id,
});
if (refError) return Response.json({ error: refError }, { status: 400 });
```

Then insert `context`, `user_subject_id ?? null`, `organization_id ?? null` alongside the existing columns.

- [ ] **Step 2: Extend PATCH**

Add `context`, `user_subject_id`, and `organization_id` to `PATCHABLE`, run the same parent-rule validation against the *resulting* state (merge the body over the current row before validating, so changing only `context` is still checked against the existing parent), and run `checkReferences` on any supplied parent.

- [ ] **Step 3: Run `tsc`, then verify**

```bash
npx tsc --noEmit
```
With the `user_id 6` token: create a standalone project (no parent) and confirm `context='project'`; create an academic project with `user_subject_id: 11` and confirm it succeeds; attempt an academic project with no course → 400; attempt a standalone project with a course → 400; attempt an academic project with another user's `user_subject_id` → 400 "That subject was not found"; create an organization then an org project under it. Confirm the defaulted `context='project'` on rows created before this task. Clean up.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/workboard/projects
git commit -m "Scope Workboard projects to a context with an optional parent"
```

---

### Task 8: Extend the WorkItem shape and `getWorkItems`

**Files:**
- Modify: `src/lib/workboard/workItems.ts`

**Interfaces:**
- Consumes: `WorkContext`, `WorkStage`, `normaliseStage` (Task 2); `OrganizationSummary` (Task 4); `WorkLink` (Task 5); `Subtask` (Task 6).
- Produces: `WorkItem` gains `context`, `work_stage`, `deadline_time`, `life_area`, `organization_id`, `organization_name`, `project_context`, `link_count`, `subtask_total`, `subtask_done`. `WorkItemsPayload` gains `organizations`. Consumed by every view and every later task.

- [ ] **Step 1: Extend the type**

Add to `WorkItem`, keeping every existing field (removing one would break v2 consumers):

```ts
  /** Domain term for the DB's `category` column. */
  context:          WorkContext;
  /** Per-context stage. `work_status` remains its normalised value. */
  work_stage:       WorkStage;
  /** "HH:MM:SS" or null. The date lives in `due_at`; an absent time renders as an em dash. */
  deadline_time:    string | null;
  life_area:        LifeArea | null;
  organization_id:  number | null;
  organization_name: string | null;
  /** The parent context of the linked project, when there is one — lets the Table view
   *  label the column "Project" vs "Initiative" without a second query. */
  project_context:  WorkContext | null;
  link_count:       number;
  subtask_total:    number;
  subtask_done:     number;
```

`category` stays on the type as a deprecated alias equal to `context`, so v2 call sites keep compiling while later tasks migrate them:
```ts
  /** @deprecated Use `context`. Retained for one release. */
  category:         WorkContext;
```

- [ ] **Step 2: Extend the owned-items query**

Add the new columns and two correlated aggregate subqueries. Subqueries are used rather than `LEFT JOIN … GROUP BY` because the latter would multiply rows across two independent one-to-many relations and silently double the counts:

```sql
SELECT wi.id, wi.category, wi.project_id, wi.user_subject_id, wi.title, wi.note,
       wi.priority, wi.work_status, wi.work_stage, wi.due_at, wi.deadline_time,
       wi.start_date, wi.estimated_hours, wi.completed_at,
       wi.life_area, wi.organization_id,
       p.name AS project_name, p.context AS project_context,
       o.name AS organization_name,
       s.course_code,
       (SELECT COUNT(*) FROM workboard_item_links l WHERE l.work_item_id = wi.id) AS link_count,
       (SELECT COUNT(*) FROM workboard_subtasks t WHERE t.work_item_id = wi.id) AS subtask_total,
       (SELECT COUNT(*) FROM workboard_subtasks t WHERE t.work_item_id = wi.id AND t.is_done = 1) AS subtask_done
FROM workboard_work_items wi
LEFT JOIN workboard_projects p ON p.id = wi.project_id
LEFT JOIN workboard_organizations o ON o.id = wi.organization_id
LEFT JOIN user_subjects us ON us.user_subject_id = wi.user_subject_id
LEFT JOIN subjects s ON s.subject_id = us.subject_id
WHERE wi.user_id = ?
  AND (wi.work_status != 'done' OR DATE(wi.completed_at) >= ?)
```

`chip_label` resolution is unchanged (project name, then course code, then null), but Organization items now prefer the organization name when no project is set — add `?? r.organization_name` to that chain, after the project and before the course code.

- [ ] **Step 3: Extend the academic query**

Add `m.deadline_time`, `m.work_stage`, and the same two aggregate subqueries keyed on the source's `metaCol`. Because `ACADEMIC_TABLES` already carries `metaCol` per source, the subquery interpolates it the same way the overlay join does:

```sql
       (SELECT COUNT(*) FROM workboard_item_links l WHERE l.`${spec.metaCol}` = t.`${spec.pk}`) AS link_count,
       (SELECT COUNT(*) FROM workboard_subtasks st WHERE st.`${spec.metaCol}` = t.`${spec.pk}`) AS subtask_total,
       (SELECT COUNT(*) FROM workboard_subtasks st WHERE st.`${spec.metaCol}` = t.`${spec.pk}` AND st.is_done = 1) AS subtask_done
```

Academic rows map `context: 'academic'`, `life_area: null`, `organization_id: null`, `project_context: null`.

- [ ] **Step 4: Extend the stage derivation**

Add alongside the existing `deriveAcademicStatus`, keeping that function unchanged so its v2 consumers are unaffected:

```ts
/**
 * The stage-level companion to `deriveAcademicStatus`. Study Pulse's `'Done'` is still
 * checked FIRST — a stale overlay stage can never mask a genuinely completed item. When
 * the entry is done, the overlay only decides *which* done-ish label to show.
 */
export function deriveAcademicStage(
  entryStatus: string | null | undefined,
  metaStage: string | null | undefined,
): WorkStage {
  if (entryStatus === 'Done') return metaStage === 'submitted' ? 'submitted' : 'done';
  if (metaStage && isStageLegal('academic', metaStage)) return metaStage;
  return 'todo';
}
```

Use it for the academic rows' `work_stage`, and keep `work_status` coming from `deriveAcademicStatus` as before — the two must agree, which they do by construction since `normaliseStage('submitted') === 'done'` and `deriveAcademicStatus` returns `'done'` for the same input.

- [ ] **Step 5: Add organizations to the payload**

`WorkItemsPayload` gains `organizations: OrganizationSummary[]`, populated by `listOrganizations(userId)`.

- [ ] **Step 6: Run `tsc`, then verify**

```bash
npx tsc --noEmit
```
Then `curl` `GET /api/workboard/work` with the `user_id 6` token and confirm: every item carries `context` and `work_stage`; academic items' `work_stage` and `work_status` agree per the normalisation; `link_count`/`subtask_total`/`subtask_done` are present and zero for untouched items. Attach a link and a subtask to one item, re-fetch, and confirm the counts move to 1 without any other item's counts changing — that is the check that catches a row-multiplying join. Clean up.

- [ ] **Step 7: Commit**

```bash
git add src/lib/workboard/workItems.ts
git commit -m "Extend WorkItem with context, stage, deadline time, hierarchy, and link/subtask counts"
```

---

### Task 9: Work-items routes — new fields and stage validation

**Files:**
- Modify: `src/app/api/workboard/work-items/route.ts` (POST)
- Modify: `src/app/api/workboard/work-items/[id]/route.ts` (PATCH)

**Interfaces:**
- Consumes: `isStageLegal`, `normaliseStage`, `LIFE_AREAS` (Task 2); `checkReferences` (Task 3).

- [ ] **Step 1: Accept and validate the new fields in POST**

Add `life_area`, `organization_id`, `deadline_time`, and `work_stage` to the accepted body. Validate:

```ts
if (life_area !== undefined && life_area !== null && !LIFE_AREAS.includes(life_area)) {
  return Response.json({ error: 'Invalid life_area' }, { status: 400 });
}
if (deadline_time !== undefined && deadline_time !== null &&
    !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(deadline_time)) {
  return Response.json({ error: 'deadline_time must be HH:MM or HH:MM:SS' }, { status: 400 });
}
const stage = work_stage ?? 'todo';
if (!isStageLegal(category, stage)) {
  return Response.json({ error: `"${stage}" is not a valid stage for ${category} work` }, { status: 400 });
}
```

Insert `work_stage: stage` and `work_status: normaliseStage(stage)` together — they must never diverge. The existing `completed_at` stamping keys off the *normalised* status, so its logic is unchanged.

Pass `organizationId: organization_id` into `checkReferences`.

- [ ] **Step 2: Handle stage in PATCH**

`work_stage` joins `PATCHABLE`. When it changes, `work_status` is recomputed and written in the same statement, and the existing change-gated `completed_at` logic runs against the *normalised* value — so it still only re-stamps on a real transition, preserving the v2 final-review fix:

```ts
if ('work_stage' in body) {
  if (!isStageLegal(currentContext, body.work_stage)) {
    return Response.json({ error: `"${body.work_stage}" is not a valid stage for ${currentContext} work` }, { status: 400 });
  }
  const nextStatus = normaliseStage(body.work_stage);
  sets.push('work_stage = ?', 'work_status = ?');
  values.push(body.work_stage, nextStatus);
  if (nextStatus !== currentStatus) {
    sets.push('completed_at = ?');
    values.push(nextStatus === 'done' ? manilaNowDatetime() : null);
  }
}
```

`currentContext` and `currentStatus` both come from the ownership SELECT, which already fetches `work_status` — extend it to also select `category`. A `work_status` sent directly (without `work_stage`) keeps working for v2 compatibility, but sets `work_stage` to match.

- [ ] **Step 3: Run `tsc`, then verify**

```bash
npx tsc --noEmit
```
With the `user_id 6` token: create a Projects item with `work_stage: 'backlog'` and confirm `work_status` stored as `'todo'`; attempt `work_stage: 'backlog'` on an Academic item → 400; PATCH an item `todo → review → done → todo` and confirm `work_status` tracks and `completed_at` stamps only on the real transitions (re-sending the same stage must not re-stamp — the v2 regression this must not reintroduce); create a Life item with `life_area: 'household'`; reject `life_area: 'nonsense'`; reject `deadline_time: '25:00'`. Clean up and confirm baseline.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/workboard/work-items
git commit -m "Accept life area, organization, deadline time, and validated stages on work items"
```

---

### Task 10: Academic PATCH — stage and deadline time

**Files:**
- Modify: `src/lib/workboard/academicWrites.ts`
- Modify: `src/app/api/workboard/academic/[source]/[id]/route.ts`

**Interfaces:**
- Consumes: `isStageLegal`, `normaliseStage` (Task 2).
- Produces: `AcademicPatch` gains `work_stage` and `deadline_time`.

- [ ] **Step 1: Extend the patch router**

`work_stage` routes to the overlay and *also* drives the Study Pulse write-back, replacing `work_status` as the primary input while `work_status` remains accepted for compatibility:

```ts
export interface AcademicPatch {
  work_status?:     WorkStatus;
  work_stage?:      WorkStage;
  due_at?:          string | null;
  deadline_time?:   string | null;
  priority?:        WorkPriority;
  estimated_hours?: number | null;
  start_date?:      string | null;
}
```

Inside `patchAcademicItem`, derive the effective stage and status once:
```ts
// A stage implies its status; a bare status (v2 callers) implies the matching stage.
const stage  = patch.work_stage ?? (patch.work_status ? patch.work_status as WorkStage : undefined);
const status = stage ? normaliseStage(stage) : patch.work_status;
```
Then: `status` drives the existing change-gated `status`/`accomplished_at` write to Study Pulse (unchanged logic — `submitted` and `done` both normalise to `'done'`, so both write `status='Done'`). `stage` is written to the overlay's `work_stage`, and `in_progress` is kept in sync (`stage === 'in_progress' ? 1 : 0`) for the one-release retention the spec describes. `deadline_time` writes to the overlay alongside `estimated_hours` and `start_date`.

- [ ] **Step 2: Validate in the route**

```ts
if ('work_stage' in body && !isStageLegal('academic', body.work_stage)) {
  return Response.json({ error: `"${body.work_stage}" is not a valid stage for academic work` }, { status: 400 });
}
if ('deadline_time' in body && body.deadline_time !== null &&
    !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(body.deadline_time)) {
  return Response.json({ error: 'deadline_time must be HH:MM or HH:MM:SS' }, { status: 400 });
}
```

- [ ] **Step 3: Run `tsc`, then verify**

```bash
npx tsc --noEmit
```
Pick a real **non-graded** activity belonging to user 6 and record its original `status`/`urgency`/`deadline`/`accomplished_at` before touching it.

- PATCH `work_stage: 'ready_to_submit'` → overlay `work_stage` set, `in_progress` = 0, Study Pulse `status` still `'Pending'`.
- PATCH `work_stage: 'submitted'` → Study Pulse `status='Done'` with `accomplished_at` set, overlay `work_stage='submitted'`.
- Re-fetch `GET /api/workboard/work` and confirm the item reads `work_stage: 'submitted'`, `work_status: 'done'`.
- **The derivation test:** with `status='Done'` still in place, force the overlay to `work_stage='in_progress'` directly in SQL, re-fetch, and confirm the item still reads `work_stage: 'done'` and `work_status: 'done'` — Study Pulse must win.
- PATCH `deadline_time: '23:59'` → lands on the overlay only; Study Pulse's row byte-identical.
- Reject `work_stage: 'backlog'` → 400.
- Cross-user PATCH → 404, row unchanged.

Restore every original value and delete the overlay row. Confirm `workboard_entry_meta` is back to its pre-test state.

- [ ] **Step 4: Commit**

```bash
git add src/lib/workboard/academicWrites.ts src/app/api/workboard/academic
git commit -m "Route academic stage and deadline time to the overlay, preserving Study Pulse as source of truth"
```

---

### Task 11: Academic graded-creation route

**Files:**
- Create: `src/app/api/workboard/academic/create/route.ts`

**Interfaces:**
- Consumes: `insertActivityEntry`, `insertQuizEntry`, `insertExamEntry`, `insertGradeEntry` from `@/lib/studypulseEntries` (existing, unchanged); `checkReferences` (Task 3).
- Produces: the "new graded work" path of the three-path academic creation flow. Consumed by Task 27.

This is the only new write path into Study Pulse. It deliberately mirrors the Canvas announcement Include route's target-picking so the user meets one flow, not two.

- [ ] **Step 1: Write the route**

```ts
import { NextRequest } from 'next/server';
import { auth } from '@/auth';
import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2';
import { ensureWorkboardV3Schema } from '@/lib/migrate';
import { checkReferences } from '@/lib/workboard/ownership';
import {
  insertActivityEntry, insertQuizEntry, insertExamEntry, insertGradeEntry,
} from '@/lib/studypulseEntries';

const LEGACY_TARGETS = ['activities', 'quizzes', 'exams'] as const;

/** Same check the Canvas Include route uses: a subject is "custom" mode when it has a
 *  subject_grading row pointing at a real grading preset. */
async function getSubjectMode(userSubjectId: number): Promise<'legacy' | 'custom'> {
  try {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT 1 FROM subject_grading sg
       JOIN grading_presets gp ON gp.preset_id = sg.preset_id
       WHERE sg.user_subject_id = ?`,
      [userSubjectId],
    );
    return rows.length ? 'custom' : 'legacy';
  } catch (err) {
    console.error('Workboard academic create: grading-mode lookup failed, assuming legacy:', err);
    return 'legacy';
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  await ensureWorkboardV3Schema();
  const userId = parseInt(session.user.id);

  const body = await req.json();
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return Response.json({ error: 'Body must be an object' }, { status: 400 });
  }
  const { user_subject_id, title, target_type, cat_id, period_id, deadline, priority } = body;

  if (typeof title !== 'string' || !title.trim()) {
    return Response.json({ error: 'A title is required' }, { status: 400 });
  }
  if (typeof deadline !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) {
    return Response.json({ error: 'A deadline (YYYY-MM-DD) is required' }, { status: 400 });
  }
  const refError = await checkReferences(userId, { userSubjectId: user_subject_id });
  if (refError) return Response.json({ error: refError }, { status: 400 });

  const mode = await getSubjectMode(user_subject_id);
  if (mode === 'custom' && LEGACY_TARGETS.includes(target_type)) {
    return Response.json(
      { error: 'This subject uses custom grading. Choose a period and category instead.' },
      { status: 400 },
    );
  }
  if (mode === 'legacy' && target_type === 'grade_entries') {
    return Response.json(
      { error: 'This subject uses the standard Activity/Quiz/Exam categories.' },
      { status: 400 },
    );
  }
  if (target_type !== 'grade_entries' && !LEGACY_TARGETS.includes(target_type)) {
    return Response.json({ error: 'Invalid target_type' }, { status: 400 });
  }
  if (target_type === 'grade_entries') {
    if (!cat_id || !period_id) {
      return Response.json({ error: 'cat_id and period_id are required for grade_entries' }, { status: 400 });
    }
    const [owns] = await pool.execute<RowDataPacket[]>(
      `SELECT 1 FROM grading_categories gc
       JOIN grading_periods gp ON gp.period_id = gc.period_id
       JOIN subject_grading sg ON sg.preset_id = gp.preset_id
       WHERE gc.cat_id = ? AND gc.period_id = ? AND sg.user_subject_id = ?`,
      [cat_id, period_id, user_subject_id],
    );
    if (!owns.length) {
      return Response.json({ error: 'That category/period does not belong to this subject' }, { status: 400 });
    }
  }

  const urgency = priority === 'high' ? 'High' : priority === 'low' ? 'Low' : 'Medium';
  const common = {
    entryId: null, userSubjectId: user_subject_id, name: title.trim(),
    specificType: '', urgency, status: 'Pending', deadline,
    score: null, items: null, grade: null, accomplishedAt: null,
  };

  let entryId: number;
  if (target_type === 'activities')     entryId = (await insertActivityEntry(common)).entryId;
  else if (target_type === 'quizzes')   entryId = (await insertQuizEntry(common)).entryId;
  else if (target_type === 'exams')     entryId = (await insertExamEntry(common)).entryId;
  else entryId = (await insertGradeEntry({ ...common, catId: cat_id, periodId: period_id, isLab: false })).entryId;

  return Response.json({ status: 'success', source: target_type, entry_id: entryId });
}
```

The row is created with `score`, `items`, and `grade` all null — ungraded. That matters: the `BEFORE UPDATE` trigger that forces `status='Done'` fires only on graded rows, so a freshly-created item is safe to un-complete. Once a grade is entered in Study Pulse it becomes subject to that pre-existing trigger, which is a known Study Pulse behaviour recorded at the end of v2 and out of scope here.

- [ ] **Step 2: Run `tsc`, then verify**

```bash
npx tsc --noEmit
```
With the `user_id 6` token:
- Create graded work against a **legacy-mode** subject with `target_type: 'activities'` — confirm via `mysql.exe` that a real `activities` row appeared with `status='Pending'`, the right `user_subject_id`, and null score/items/grade.
- Confirm it now appears in `GET /api/workboard/work` as an academic item with `source: 'activities'`.
- Attempt `target_type: 'grade_entries'` on that legacy subject → 400.
- If user 6 has a custom-mode subject, create against it with a real `cat_id`/`period_id` and confirm the `grade_entries` row; attempt a mismatched `cat_id` → 400.
- Attempt creation with another user's `user_subject_id` → 400 "That subject was not found".
- **Delete every row you created from Study Pulse** and confirm the tables return to baseline counts. This task writes real Study Pulse data — leaving test rows behind pollutes a module outside Workboard.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/workboard/academic/create
git commit -m "Add the graded academic creation path writing real Study Pulse entries"
```

---

### Task 12: Extend the work payload

**Files:**
- Modify: `src/app/api/workboard/work/route.ts`

**Interfaces:**
- Consumes: `getWorkItems` (Task 8), `listOrganizations` (Task 4).
- Produces: the payload every view reads, now carrying `organizations`.

- [ ] **Step 1: Include organizations and switch the schema call**

`getWorkItems` already returns `organizations` after Task 8, so the route only needs its schema call updated from `ensureWorkboardV2Schema()` to also run `ensureWorkboardV3Schema()`:

```ts
await ensureWorkboardV2Schema();
await ensureWorkboardV3Schema();
```

Both are idempotent and cheap after the first call per process. v2's is retained because v3's migration assumes v2's tables exist.

- [ ] **Step 2: Run `tsc`, then verify**

```bash
npx tsc --noEmit
```
`curl` the endpoint with the `user_id 6` token and confirm the response now carries `organizations` (an empty array until some are created), that every item has `context`/`work_stage`/`deadline_time`/`link_count`/`subtask_total`/`subtask_done`, and that `stats` and `workload` are unchanged from v2 — the normalised `work_status` keeps those calculations identical.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/workboard/work/route.ts
git commit -m "Surface organizations and v3 schema on the work payload"
```

---

# PHASE 2 — SEMANTICS

Tasks 13–16 correct what v2 got wrong or left implicit: overdue's placement, the completed-item label bug, and the Board's status vocabulary.

---

### Task 13: Due semantics module

**Files:**
- Create: `src/lib/workboard/dueSemantics.ts`

**Interfaces:**
- Consumes: `dueDateOf` from `@/lib/workboard/dates` (pool-free, existing).
- Produces: `DueState`, `dueStateOf`, `formatDeadline`, `formatDeadlineTime`, `formatDueLabel`. Consumed by Tasks 15, 16, 18, 22, 23, 32.
- **Must remain pool-free** — every view imports it at runtime.

This task fixes the bug the inspection found: `formatDueLabel` in `WorkItemRow.tsx` returns the literal string `'Overdue'` from the date alone, with no status check, so a completed item displays the word. It also introduces COMPLETED LATE, which exists nowhere today.

- [ ] **Step 1: Write the module**

```ts
import { dueDateOf } from '@/lib/workboard/dates';
import type { WorkItem } from '@/lib/workboard/workItems';

export type DueState = 'none' | 'upcoming' | 'due_today' | 'overdue' | 'completed' | 'completed_late';

/**
 * The spec's rules, in order:
 *   not done AND deadline < now        -> overdue
 *   done     AND completed <= deadline -> completed
 *   done     AND completed >  deadline -> completed late
 * A completed item with no recorded completion timestamp reads `completed`, never
 * `completed_late` — guessing lateness from missing data would be a lie, not a default.
 */
export function dueStateOf(item: WorkItem, todayStr: string): DueState {
  const due = dueDateOf(item);
  const done = item.work_status === 'done';

  if (done) {
    if (due === null || item.completed_at === null) return 'completed';
    return item.completed_at.slice(0, 10) > due ? 'completed_late' : 'completed';
  }
  if (due === null) return 'none';
  if (due < todayStr) return 'overdue';
  if (due === todayStr) return 'due_today';
  return 'upcoming';
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/** "Sep 8" — the date half of a deadline. Null when the item has no deadline. */
export function formatDeadline(item: WorkItem): string | null {
  const due = dueDateOf(item);
  if (due === null) return null;
  const [, m, d] = due.split('-');
  return MONTHS[parseInt(m, 10) - 1] + ' ' + parseInt(d, 10);
}

/**
 * "11:59 PM", or an em dash when no time is set. The spec is explicit that an absent
 * time must never render as midnight — which is exactly why the time lives in its own
 * column rather than inside a DATETIME.
 */
export function formatDeadlineTime(item: WorkItem): string {
  if (!item.deadline_time) return '—';
  const [hRaw, min] = item.deadline_time.split(':');
  const h = parseInt(hRaw, 10);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const display = h % 12 === 0 ? 12 : h % 12;
  return display + ':' + min + ' ' + suffix;
}

/** The human label a row or card shows for its deadline. */
export function formatDueLabel(item: WorkItem, todayStr: string): string | null {
  const state = dueStateOf(item, todayStr);
  const date = formatDeadline(item);

  switch (state) {
    case 'none':           return null;
    case 'completed':      return date ? 'Completed · ' + date : 'Completed';
    case 'completed_late': return date ? 'Completed late · ' + date : 'Completed late';
    case 'overdue':        return date ? 'Overdue · ' + date : 'Overdue';
    case 'due_today':      return 'Due today';
    case 'upcoming':       return date ? 'Due ' + date : null;
  }
}
```

`formatDueLabel` now carries the date on an overdue item rather than collapsing to a bare "Overdue" — a deferred v2 minor, closed here because the function is being rewritten anyway.

- [ ] **Step 2: Run `tsc`, then verify by tracing cases**

```bash
npx tsc --noEmit
```

Trace each against the code and write the results into your report:
- Not done, due yesterday → `overdue`, label "Overdue · <date>".
- Not done, due today → `due_today`, label "Due today".
- **Done, due yesterday, completed before it was due** → `completed`. The old code returned the word "Overdue" here; this is the bug the task exists to fix.
- Done, due Sep 5, `completed_at` Sep 8 → `completed_late`.
- Done, `completed_at` null → `completed`, never `completed_late`.
- No deadline, not done → `none`, label null.
- `deadline_time` "23:59:00" → "11:59 PM"; "00:00:00" → "12:00 AM"; null → "—".

- [ ] **Step 3: Commit**

```bash
git add src/lib/workboard/dueSemantics.ts
git commit -m "Add due-state semantics with completed and completed-late states"
```

---

### Task 14: Split Overdue out of Today

**Files:**
- Modify: `src/lib/workboard/workStats.ts`

**Interfaces:**
- Produces: `TimeframeGroups` gains `overdue`. Consumed by Task 15.

v2 deliberately folded overdue items into Today, and `workStats.ts` documents why in a comment. The spec reverses that. Replace the comment as well as the code, so the file stops arguing for the old behaviour.

- [ ] **Step 1: Add the group**

```ts
export interface TimeframeGroups {
  overdue:   WorkItem[];
  today:     WorkItem[];
  upcoming:  WorkItem[];
  later:     WorkItem[];
}

/**
 * Overdue is its own section (spec §6). v2 folded overdue items into Today on the
 * reasoning that a past section "doesn't exist"; v3 gives it one, because burying a
 * late item among today's work hides exactly the thing that most needs attention.
 * Today = due today. Upcoming = due in the 7 days after today, inclusive of day 7.
 * Later = everything else, including every undated item. Done items appear in none.
 */
export function groupByTimeframe(items: WorkItem[], todayStr: string): TimeframeGroups {
  const horizon = addDays(todayStr, 7);
  const groups: TimeframeGroups = { overdue: [], today: [], upcoming: [], later: [] };

  for (const item of items) {
    if (item.work_status === 'done') continue;
    const due = dueDateOf(item);
    if (due === null)          groups.later.push(item);
    else if (due < todayStr)   groups.overdue.push(item);
    else if (due === todayStr) groups.today.push(item);
    else if (due <= horizon)   groups.upcoming.push(item);
    else                       groups.later.push(item);
  }
  return groups;
}
```

`computeStats` and `computeWorkloadChart` are untouched — their overdue and due-soon definitions already match and are independent of this grouping.

- [ ] **Step 2: Run `tsc`, then trace**

```bash
npx tsc --noEmit
```

Expected: an error in `WorkListView.tsx`, which destructures the old three-group shape. That break is deliberate and Task 15 resolves it — confirm there are no *other* errors.

Trace: an item due yesterday now lands in `overdue`, not `today`; due exactly today → `today`; `todayStr + 7` → `upcoming`; `+8` → `later`; undated → `later`; done → nowhere.

- [ ] **Step 3: Commit**

```bash
git add src/lib/workboard/workStats.ts
git commit -m "Give overdue work its own Focus group"
```

---

### Task 15: Focus view — four sections

**Files:**
- Modify: `src/components/workboard/views/WorkListView.tsx`
- Modify: `src/components/workboard/WorkItemRow.tsx`
- Modify: `src/components/workboard/WorkboardStats.tsx`

**Interfaces:**
- Consumes: `groupByTimeframe` (Task 14); `formatDueLabel`, `dueStateOf` (Task 13).

- [ ] **Step 1: Render the fourth section**

Add an OVERDUE section above TODAY, using the existing collapsible-section component and count badge. Its heading carries the restrained red accent the direction doc specifies for Overdue — not a saturated surface — plus an `AlertTriangle` icon.

When `overdue.length === 0` the section is **not rendered at all**, rather than showing an empty state. A permanently-visible "no overdue work" row would be noise on the common path.

- [ ] **Step 2: Replace the row's due label**

`WorkItemRow.tsx` has a local `formatDueLabel` carrying the status-check bug, and a local `buildMeta`. Delete the local function and import from `@/lib/workboard/dueSemantics`. Drive the meta line's colour from `dueStateOf` rather than the ad-hoc `overdue` boolean: `overdue` → `#922e48`, `completed_late` → the direction doc's warning amber, everything else → `#5c6b80`.

This removes a second copy of due-label logic — the same drift the v2 review flagged when `addDays` reached four copies.

- [ ] **Step 3: Link the Overdue metric to the section**

Give the OVERDUE section a stable `id`. Make the Overdue stat card a button that switches to Focus if another view is active, then scrolls the section into view. At zero it is not interactive.

- [ ] **Step 4: Run `tsc`, then verify**

```bash
npx tsc --noEmit
```

Expected: zero errors — this task resolves Task 14's deliberate break.

With the `user_id 6` token: create an item due yesterday and one due today; `curl` `/workboard` and confirm the HTML contains an OVERDUE heading with the overdue item beneath it and a separate TODAY heading. Then mark the overdue item done and confirm it leaves both sections and its label reads "Completed", not "Overdue" — the bug fix verified end to end. Clean up.

State plainly that section collapse and scroll behaviour were not observed in a browser.

- [ ] **Step 5: Commit**

```bash
git add src/components/workboard/views/WorkListView.tsx src/components/workboard/WorkItemRow.tsx src/components/workboard/WorkboardStats.tsx
git commit -m "Split Overdue into its own Focus section and fix the completed-item due label"
```

---

### Task 16: Board — per-context stage columns

**Files:**
- Modify: `src/components/workboard/views/WorkBoardView.tsx`
- Modify: `src/components/workboard/WorkItemRow.tsx`

**Interfaces:**
- Consumes: `STAGES_BY_CONTEXT`, `STAGE_LABELS`, `normaliseStage` (Task 2); `dueSemantics` (Task 13).
- Produces: `setWorkStage(item, stage)` beside the existing `setWorkStatus`. Consumed by Tasks 20, 32.

- [ ] **Step 1: Add the stage setter**

Next to `setWorkStatus` in `WorkItemRow.tsx`, keeping endpoint routing in exactly one place so the Board never builds a URL itself:

```ts
export async function setWorkStage(item: WorkItem, next: WorkStage): Promise<Response> {
  const url = item.source === 'owned'
    ? '/api/workboard/work-items/' + item.id
    : '/api/workboard/academic/' + item.source + '/' + item.id;
  return fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ work_stage: next }),
  });
}
```

- [ ] **Step 2: Make the columns context-aware**

The Board receives the active context. For a specific context, columns are `STAGES_BY_CONTEXT[context]` and cards move by stage. For **My Work**, columns are the three normalised statuses (spec §17 is explicit), each holding every item whose `normaliseStage(work_stage)` matches; a drop sets that column's canonical stage — `todo`, `in_progress`, `done`.

A `blocked` item in My Work renders in In Progress with a Blocked badge, so the state survives normalisation rather than vanishing.

- [ ] **Step 3: Keep drag and the keyboard menu in step**

Both the drop handler and the per-card "Move to" menu call `setWorkStage`, and the menu lists the other stages of the current column set — five entries under Academic, two under My Work. It remains the guaranteed keyboard path the v2 review verified.

- [ ] **Step 4: Use the corrected due labels**

Replace the card's local due-label logic with `formatDueLabel`/`dueStateOf`, so a completed card in Done reads "Completed", not "Overdue".

- [ ] **Step 5: Run `tsc`, then verify**

```bash
npx tsc --noEmit
```

Drag cannot be simulated without a browser — verify the transitions through the endpoints the handlers call, as v2 did:
- Move an owned Projects item backlog → todo → in_progress → review → done → todo, confirming each stage and its normalised `work_status` in `GET /api/workboard/work`.
- Move an academic item todo → ready_to_submit → submitted, confirming the overlay stage and Study Pulse's `status='Done'` at the last step.
- `curl` `/workboard` and confirm five column headings under Academic, three under My Work.
- Confirm a `blocked` Projects item appears under In Progress when My Work is selected.

State plainly that the drag interaction itself was not exercised. Clean up and restore any Study Pulse row touched.

- [ ] **Step 6: Commit**

```bash
git add src/components/workboard/views/WorkBoardView.tsx src/components/workboard/WorkItemRow.tsx
git commit -m "Give the Board per-context stage columns with My Work normalisation"
```

---

# PHASE 3 — TABLE VIEW

Tasks 17–24 build the spec's central new feature. The value proposition is that the user never configures a column — the system already knows which fields matter per context.

---

### Task 17: Column projections

**Files:**
- Create: `src/lib/workboard/tableColumns.ts`

**Interfaces:**
- Consumes: `WorkContext` (Task 2), `WorkItem` (Task 8), `dueSemantics` (Task 13).
- Produces: `ColumnKey`, `TableColumn`, `COLUMNS_BY_CONTEXT`, `cellValue`. Consumed by Tasks 18–24.
- **Must remain pool-free.**

- [ ] **Step 1: Write the module**

```ts
import type { WorkContext } from '@/lib/workboard/workContexts';
import { LIFE_AREA_LABELS, CONTEXT_LABELS } from '@/lib/workboard/workContexts';
import type { WorkItem } from '@/lib/workboard/workItems';
import { formatDeadline, formatDeadlineTime } from '@/lib/workboard/dueSemantics';

export type ColumnKey =
  | 'context' | 'course' | 'organization' | 'area' | 'project'
  | 'work' | 'status' | 'priority' | 'deadline' | 'time' | 'estimate' | 'links';

export interface TableColumn {
  key:      ColumnKey;
  label:    string;
  /** Columns dropped first when width is short. Spec §29 keeps Work, Status, Deadline. */
  priority: 'essential' | 'high' | 'low';
  align?:   'right';
}

const WORK:     TableColumn = { key: 'work',     label: 'Work',     priority: 'essential' };
const STATUS:   TableColumn = { key: 'status',   label: 'Status',   priority: 'essential' };
const DEADLINE: TableColumn = { key: 'deadline', label: 'Deadline', priority: 'essential' };
const TIME:     TableColumn = { key: 'time',     label: 'Time',     priority: 'low' };
const LINKS:    TableColumn = { key: 'links',    label: 'Links',    priority: 'low' };
const PRIORITY: TableColumn = { key: 'priority', label: 'Priority', priority: 'high' };

/** Fixed per context — the user never configures these (spec §7, §34). */
export const COLUMNS_BY_CONTEXT: Record<WorkContext | 'all', TableColumn[]> = {
  all: [
    { key: 'context', label: 'Context', priority: 'high' },
    WORK, STATUS, PRIORITY, DEADLINE, TIME, LINKS,
  ],
  academic: [
    { key: 'course',  label: 'Course',  priority: 'high' },
    { key: 'project', label: 'Project', priority: 'low' },
    { ...WORK, label: 'Activity' },
    STATUS, DEADLINE, TIME, LINKS,
  ],
  organization: [
    { key: 'organization', label: 'Organization',         priority: 'high' },
    { key: 'project',      label: 'Project / Initiative', priority: 'low' },
    WORK, STATUS, DEADLINE, TIME, LINKS,
  ],
  project: [
    { key: 'project', label: 'Project', priority: 'high' },
    WORK, STATUS, PRIORITY, DEADLINE,
    { key: 'estimate', label: 'Estimate', priority: 'low', align: 'right' },
    LINKS,
  ],
  life: [
    { key: 'area', label: 'Area', priority: 'high' },
    WORK, STATUS, PRIORITY, DEADLINE, TIME, LINKS,
  ],
};

const DASH = '—';

/**
 * The display string for a non-interactive cell. Returns null for the four columns
 * rendered by dedicated components (work, status, priority, links) so the row branches.
 * Every absent optional value renders an em dash — the spec is explicit that a cell must
 * never be blank.
 */
export function cellValue(item: WorkItem, key: ColumnKey): string | null {
  switch (key) {
    case 'context':      return CONTEXT_LABELS[item.context];
    case 'course':       return item.chip_label ?? DASH;
    case 'organization': return item.organization_name ?? DASH;
    case 'area':         return item.life_area ? LIFE_AREA_LABELS[item.life_area] : DASH;
    case 'project':      return item.project_id ? (item.chip_label ?? DASH) : DASH;
    case 'deadline':     return formatDeadline(item) ?? DASH;
    case 'time':         return formatDeadlineTime(item);
    case 'estimate':     return item.estimated_hours === null ? DASH : item.estimated_hours + 'h';
    default:             return null;
  }
}
```

Note the `course` and `project` cases both read `chip_label` today, which resolves project-then-course. Task 8 gives the item both `organization_name` and `project_context`; if `chip_label` proves ambiguous for the Academic table (where Course and Project are separate columns), extend `WorkItem` with an explicit `course_code` in that task rather than guessing here — and report it, because it is a real interface gap rather than a styling choice.

- [ ] **Step 2: Run `tsc`, then trace**

```bash
npx tsc --noEmit
```

Trace: Academic columns are Course, Project, Activity, Status, Deadline, Time, Links — matching spec §8 exactly. Organization never includes Course. Projects includes Estimate and not Time. My Work leads with Context. An academic item with no project yields the em dash for `project`, not an empty string.

- [ ] **Step 3: Commit**

```bash
git add src/lib/workboard/tableColumns.ts
git commit -m "Add context-aware table column projections"
```

---

### Task 18: Table view — structure and rendering

**Files:**
- Create: `src/components/workboard/views/WorkTableView.tsx`
- Modify: `src/components/workboard/WorkboardShell.tsx`

**Interfaces:**
- Consumes: `COLUMNS_BY_CONTEXT`, `cellValue` (Task 17); `dueSemantics` (Task 13).
- Produces: `WorkTableView`. Modified by Tasks 19–24.

- [ ] **Step 1: Build the table**

A real `<table>` with `<thead>`/`<tbody>` — semantic markup, not a div grid, so assistive technology announces row and column relationships. Columns come from `COLUMNS_BY_CONTEXT[context]`, where `context` is the shell's active context, `'all'` for My Work.

Density per the direction doc: this is the module's densest surface. Rows are divider-separated with no per-row card, a compact row height, and the priority left-edge treatment already used in Focus. Sticky header on vertical scroll.

The whole table sits inside the shell's existing GLASS panel, so it reads as one surface rather than a stack of floating cards.

- [ ] **Step 2: Handle the empty states**

Three distinct cases, matching sibling views' wording rather than inventing copy: nothing at all; nothing matching the current filter or search (`isFiltered`); and — new to Table — a context with no work yet, which offers the New Work button.

- [ ] **Step 3: Wire it into the shell**

Add `table` to the view keys and render:

```tsx
<WorkTableView
  items={visibleItems}
  context={category}
  todayStr={work.generated_at}
  isFiltered={isFiltered}
  onChanged={refreshWork}
/>
```

Read the current shell file first — it changed across seven v2 tasks and again in Phase 2.

- [ ] **Step 4: Run `tsc`, then verify**

```bash
npx tsc --noEmit
```

`curl` `/workboard` and confirm a 200. Because the shell defaults to Focus, also confirm the Table markup is reachable: temporarily default the view state to `'table'`, capture the HTML, confirm the `<table>`, the expected `<th>` labels for My Work, and your items' titles appear — then revert the default. State that no layout was seen rendered.

- [ ] **Step 5: Commit**

```bash
git add src/components/workboard/views/WorkTableView.tsx src/components/workboard/WorkboardShell.tsx
git commit -m "Add the context-aware Table view"
```

---

### Task 19: Table sorting

**Files:**
- Modify: `src/components/workboard/views/WorkTableView.tsx`

- [ ] **Step 1: Add sort state and comparators**

Clicking a header sorts by that column; clicking again reverses; a third click returns to the default order. The active column shows a direction caret and carries `aria-sort="ascending"` or `"descending"` — that attribute is what makes the sort perceivable rather than merely visible.

Comparators are per column key, not generic:
- `deadline` sorts undated items **last regardless of direction** — an item with no deadline is not "earliest".
- `status` sorts by the context's stage order, not alphabetically.
- `priority` sorts high → normal → low.
- `estimate` sorts numerically with nulls last.
- Text columns use `localeCompare`.

Default order matches Focus's intuition: overdue first, then deadline ascending, undated last.

- [ ] **Step 2: Run `tsc`, then verify**

```bash
npx tsc --noEmit
```

Create four items spanning past/today/future/no deadline with differing priorities. Capture the rendered HTML with the table defaulted on and confirm the default order, that sorting by priority puts `high` first, and that undated items sit last in **both** deadline directions. Clean up.

- [ ] **Step 3: Commit**

```bash
git add src/components/workboard/views/WorkTableView.tsx
git commit -m "Add context-aware table sorting"
```

---

### Task 20: Inline status editing

**Files:**
- Create: `src/components/workboard/table/StatusCell.tsx`
- Modify: `src/components/workboard/views/WorkTableView.tsx`

**Interfaces:**
- Consumes: `setWorkStage` (Task 16); `STAGES_BY_CONTEXT`, `STAGE_LABELS` (Task 2).

- [ ] **Step 1: Build the cell**

A `<select>` bound to the item's stage, offering that item's **own context's** stages — an Academic row offers five and a Life row three, even inside the My Work table where rows of different contexts sit side by side. That is the point of a context-aware table: the vocabulary follows the work, not the view.

On change: call `setWorkStage`; on failure revert the select to its previous value **and surface the error**. Silent failure is the thing to avoid — the v2 review flagged mutations that only `console.error`, and a table where a status springs back with no explanation is worse than one that says why.

Use the existing select styling from the direction doc. No contenteditable, per §9.

- [ ] **Step 2: Run `tsc`, then verify**

```bash
npx tsc --noEmit
```

Verify through the endpoint the cell calls: PATCH stages for an owned item and an academic item, confirming persistence and normalisation. Confirm the rendered HTML shows five `<option>`s for an academic row and three for a Life row. State that the select interaction was not exercised in a browser.

- [ ] **Step 3: Commit**

```bash
git add src/components/workboard/table/StatusCell.tsx src/components/workboard/views/WorkTableView.tsx
git commit -m "Add inline status editing to the Table view"
```

---

### Task 21: Inline priority editing

**Files:**
- Create: `src/components/workboard/table/PriorityCell.tsx`
- Modify: `src/components/workboard/WorkItemRow.tsx`
- Modify: `src/components/workboard/views/WorkTableView.tsx`

- [ ] **Step 1: Build the cell**

Same shape as StatusCell: a `<select>` over high/normal/low, PATCHing `priority` to the item's source-appropriate endpoint. Add a `setPriority(item, priority)` export beside `setWorkStatus`/`setWorkStage` in `WorkItemRow.tsx` rather than building a third URL in a third place.

Academic priority writes back to Study Pulse's `urgency` through the existing mapping, so a change here is visible in Study Pulse too. Note that in your report — it is the only inline table edit that leaves Workboard.

- [ ] **Step 2: Run `tsc`, then verify**

```bash
npx tsc --noEmit
```

PATCH priority on an owned item and on an academic item; for the academic one confirm via `mysql.exe` that `urgency` changed to the mapped value (`normal` → `Medium`). Restore the original. Clean up.

- [ ] **Step 3: Commit**

```bash
git add src/components/workboard/table/PriorityCell.tsx src/components/workboard/WorkItemRow.tsx src/components/workboard/views/WorkTableView.tsx
git commit -m "Add inline priority editing to the Table view"
```

---

### Task 22: Inline deadline and time editing

**Files:**
- Create: `src/components/workboard/table/DeadlineCell.tsx`
- Modify: `src/components/workboard/views/WorkTableView.tsx`

- [ ] **Step 1: Build the cell**

The Deadline cell shows the date and opens a small popover holding a native `<input type="date">` and an optional `<input type="time">` — two controls, because the domain models them separately. Clearing the time sends `deadline_time: null`; clearing the date sends `due_at: null`.

The Time column, where the context has one, renders `formatDeadlineTime` and opens the **same** popover — two views of one editor rather than two editors that can disagree.

Saving PATCHes `due_at` and `deadline_time` together to the source-appropriate endpoint.

- [ ] **Step 2: Run `tsc`, then verify**

```bash
npx tsc --noEmit
```

PATCH a date-only deadline and confirm the Time cell renders the em dash, not a midnight. Add a time and confirm "11:59 PM". Clear the time and confirm it returns to the em dash. Do all three for both an owned and an academic item — the academic one must land on the overlay with Study Pulse's `deadline` holding only the date. Clean up and restore.

- [ ] **Step 3: Commit**

```bash
git add src/components/workboard/table/DeadlineCell.tsx src/components/workboard/views/WorkTableView.tsx
git commit -m "Add inline deadline and time editing to the Table view"
```

---

### Task 23: Links cell and popover

**Files:**
- Create: `src/components/workboard/LinksPopover.tsx`
- Create: `src/components/workboard/table/LinksCell.tsx`
- Modify: `src/app/api/workboard/links/route.ts` (add GET)
- Modify: `src/components/workboard/views/WorkTableView.tsx`

**Interfaces:**
- Consumes: the links routes (Task 5); `link_count` on `WorkItem` (Task 8).
- Produces: `LinksPopover`, reused by the detail view in Task 32.

- [ ] **Step 1: Add the GET endpoint**

The payload carries only counts, so the popover fetches the list lazily. `GET /api/workboard/links?owner_kind=…&owner_id=…` resolves the owner through `resolveOwner` (404 if not the user's) and returns links ordered by `position`.

- [ ] **Step 2: Build the popover**

Lists links by **label** with an external-link affordance — never the raw URL as primary text (§10). Each opens in a new tab with `rel="noopener noreferrer"`. Includes an add form (label, URL, type) and per-row delete.

Type icons come from `lucide-react`'s generic set — no external brand assets, per §25.

- [ ] **Step 3: Build the cell**

Renders the em dash at zero links, a single label at one, and `Canvas · GitHub · +2` truncation beyond. Clicking opens the popover.

- [ ] **Step 4: Run `tsc`, then verify**

```bash
npx tsc --noEmit
```

Attach three links to an item; `curl` the table HTML and confirm the truncated summary; confirm the GET returns them ordered by `position`; delete one and confirm the count drops. Confirm the same works on an academic item. Confirm the GET 404s for another user's owner id. Clean up.

- [ ] **Step 5: Commit**

```bash
git add src/components/workboard/LinksPopover.tsx src/components/workboard/table/LinksCell.tsx src/app/api/workboard/links src/components/workboard/views/WorkTableView.tsx
git commit -m "Add the Links cell and popover"
```

---

### Task 24: Table responsive transformation

**Files:**
- Modify: `src/components/workboard/views/WorkTableView.tsx`

- [ ] **Step 1: Degrade by width**

Per §29 and the direction doc's breakpoint table:
- **Desktop:** every column.
- **Tablet:** drop the `priority: 'low'` columns (Time, Links, Project, Estimate); keep Work, Status, Deadline and the context's lead column. Horizontal scroll only if the remainder still overflows.
- **Phone:** stop being a table. Each row becomes a compact card — title, context and its lead value, status, deadline with time, priority, and a links affordance — matching §29's example. The `<table>` is **replaced**, not restyled: a seven-column grid squeezed to phone width is unusable and CSS alone cannot fix it.

Use the `matchMedia` hook already established in `WorkListView.tsx` rather than inventing a second mechanism, with the same SSR default so server and first client render agree.

- [ ] **Step 2: Run `tsc`, then verify**

```bash
npx tsc --noEmit
```

No breakpoint can be observed without a browser. Verify by reading that the card branch renders every field §29's example lists, that the media query and the JS breakpoint use the same pixel value, and that **no column-hiding rule depends on beating an inline style** — the specificity trap that left Board's snap-scroll dead in v2. State explicitly which breakpoints were reasoned about rather than seen.

- [ ] **Step 3: Commit**

```bash
git add src/components/workboard/views/WorkTableView.tsx
git commit -m "Add Table responsive degradation and phone card transformation"
```

---

# PHASE 4 — CREATION AND DETAIL

Tasks 25–32 make the New Work modal context-aware. This is where §34's product principle becomes visible: the system already knows which fields each context needs, so the user is never asked to design the structure.

---

### Task 25: Context-aware modal skeleton

**Files:**
- Modify: `src/components/workboard/WorkItemDialog.tsx`

**Interfaces:**
- Consumes: `WORK_CONTEXTS`, `CONTEXT_LABELS`, `STAGES_BY_CONTEXT` (Task 2).
- Produces: the branching structure Tasks 26–31 fill in.

Read the current file first — v2 built it with focus trapping, Escape handling, opener-focus restoration, and an academic field-set restriction. All of that stays; this task changes what the branches contain, not how the dialog behaves.

- [ ] **Step 1: Restructure around context**

Replace the flat field list with a common section plus a per-context section chosen by the selected context. Common to every context (§11): Title, Context, Due date, Deadline time, Start date, Priority, Estimated effort, Notes, Links.

The per-context section renders `null` until a context is picked, so the modal opens short and grows — progressive disclosure, not a wall of fields. Changing context clears the previous context's fields rather than carrying a stale `project_id` across, which would otherwise persist an invalid combination the service layer would then reject.

- [ ] **Step 2: Rename Category to Context in the UI**

Every visible "Category" string in this dialog becomes "Context". Keep the request body key as `category` — the endpoint still expects it (the DB column is unchanged) and Task 2's module owns the translation.

- [ ] **Step 3: Run `tsc`, then verify**

```bash
npx tsc --noEmit
```

`curl` `/workboard` and confirm the page still returns 200 and the dialog's markup contains "Context" rather than "Category". Confirm creating an item still works end to end through the endpoint the dialog calls. State that the dialog was not opened in a browser.

- [ ] **Step 4: Commit**

```bash
git add src/components/workboard/WorkItemDialog.tsx
git commit -m "Restructure the work-item dialog around context with progressive disclosure"
```

---

### Task 26: Academic branch — source selector

**Files:**
- Modify: `src/components/workboard/WorkItemDialog.tsx`

**Interfaces:**
- Consumes: `GET /api/studypulse/subjects` (existing).

- [ ] **Step 1: Add the three-path source selector**

When Context is Academic, offer three mutually exclusive sources (§12, extended by the user's scoping decision):

1. **Link an existing item** — a picker over the user's current Study Pulse entries for the chosen course. Creates nothing; the item already exists and already appears in Workboard. This makes explicit what v2 did implicitly.
2. **New graded work** — writes a real Study Pulse row (Task 27 wires the target picker).
3. **New independent activity** — Workboard-owned, for study work that is not a graded deliverable: revision, reading, practice.

The selector's copy must make the difference legible, because it is the one place the user has to understand a real domain distinction. Something in the spirit of: *"Graded work appears in Study Pulse and counts toward your grade. An independent activity is study work that only lives here."*

- [ ] **Step 2: Show Course, and Academic Project when the source creates something**

Course is required for paths 2 and 3, and pre-filled from the picker on path 1. Academic Project is optional and lists only projects with `context='academic'` whose `user_subject_id` matches the chosen course — filtering by parent is what stops a course's project list showing another course's projects.

- [ ] **Step 3: Run `tsc`, then verify**

```bash
npx tsc --noEmit
```

Confirm the rendered markup shows the three source options under Academic and none of them under Life. Confirm the course list matches `GET /api/studypulse/subjects` for user 6. State that no interaction was exercised.

- [ ] **Step 4: Commit**

```bash
git add src/components/workboard/WorkItemDialog.tsx
git commit -m "Add the three-path academic source selector"
```

---

### Task 27: Academic graded-creation wiring

**Files:**
- Modify: `src/components/workboard/WorkItemDialog.tsx`

**Interfaces:**
- Consumes: `POST /api/workboard/academic/create` (Task 11); `GET /api/studypulse/subjects/[id]/grading` (existing).

- [ ] **Step 1: Add the target picker**

On the "new graded work" path, mirror the Canvas announcement Include flow exactly, because the user should meet one pattern rather than two:
- **Legacy-mode subject:** a select over Activity / Quiz / Exam.
- **Custom-mode subject:** a grading-period select, then a category select scoped to that period.

Determine the mode the way the announcement bank does — fetch the subject's grading config and treat a real preset as custom mode. Fetch lazily on course selection and cache per subject, matching `CanvasAnnouncementBank.tsx`'s existing approach.

- [ ] **Step 2: Submit to the create route**

POST `{ user_subject_id, title, target_type, cat_id?, period_id?, deadline, priority }`. On success the item appears in the work payload on the next refresh as an academic item with that `source` — so call `onChanged()` and close, exactly as the other paths do.

Surface the route's 400s inline rather than as a generic failure: "This subject uses custom grading" is actionable, "Failed" is not.

- [ ] **Step 3: Run `tsc`, then verify**

```bash
npx tsc --noEmit
```

Through the endpoint the dialog calls: create graded work against a legacy-mode subject and confirm a real `activities` row with `status='Pending'` and null score/items/grade; confirm it appears in `GET /api/workboard/work`. Repeat for a custom-mode subject if user 6 has one. **Delete every Study Pulse row created** and confirm the tables return to baseline — this path writes into a module outside Workboard.

- [ ] **Step 4: Commit**

```bash
git add src/components/workboard/WorkItemDialog.tsx
git commit -m "Wire graded academic creation through the Study Pulse target picker"
```

---

### Task 28: Organization branch

**Files:**
- Modify: `src/components/workboard/WorkItemDialog.tsx`

**Interfaces:**
- Consumes: the organizations routes (Task 4); the projects routes (Task 7).

- [ ] **Step 1: Add the branch**

When Context is Organization: an Organization select over `work.organizations`, with an inline "＋ New organization" that POSTs and selects the result — the same pattern the project picker already uses. Then an optional Project / Initiative, listing only projects with `context='organization'` whose `organization_id` matches.

**Course is never shown here** (§13 is explicit).

- [ ] **Step 2: Handle the duplicate-name 400**

Inline organization creation surfaces "You already have an organization with that name" in the form, not as a silent failure.

- [ ] **Step 3: Run `tsc`, then verify**

```bash
npx tsc --noEmit
```

Create an organization inline through its endpoint; create an org project under it; create an org work item referencing both; confirm the payload returns the right `organization_name` and `chip_label`. Confirm a duplicate org name yields the inline 400. Confirm no Course field appears in the Organization branch's markup. Clean up.

- [ ] **Step 4: Commit**

```bash
git add src/components/workboard/WorkItemDialog.tsx
git commit -m "Add the organization branch with inline organization creation"
```

---

### Task 29: Projects branch

**Files:**
- Modify: `src/components/workboard/WorkItemDialog.tsx`

- [ ] **Step 1: Require a project**

When Context is Projects, the Project select lists only projects with `context='project'` and is **required** — §14's reasoning is adopted: independent one-off work with no project belongs in Life. Removing the "No project" option is the point of this task, so the invalid state v2 allowed (`Context = Projects, Project = No project`) can no longer be produced.

Inline "＋ New project" creates with `context: 'project'` and no parent.

- [ ] **Step 2: Guide rather than block**

When the user picks Projects with no projects yet, the empty select carries a short hint pointing at Life for one-off work — the alternative to a required field with nothing to choose is a dead end.

- [ ] **Step 3: Run `tsc`, then verify**

```bash
npx tsc --noEmit
```

Confirm the Projects branch's markup contains no "No project" option. Create a project inline and an item under it; confirm `chip_label` resolves to the project name. Clean up.

- [ ] **Step 4: Commit**

```bash
git add src/components/workboard/WorkItemDialog.tsx
git commit -m "Require a project for Projects work and drop the No-project option"
```

---

### Task 30: Life branch

**Files:**
- Modify: `src/components/workboard/WorkItemDialog.tsx`

- [ ] **Step 1: Add the branch**

When Context is Life: an Area select over `LIFE_AREAS` with the labels from Task 2. **No project field** (§15 — Life stays deliberately lightweight). Area is optional; an item with no area shows the em dash in the Table's Area column.

- [ ] **Step 2: Run `tsc`, then verify**

```bash
npx tsc --noEmit
```

Create a Life item with `life_area: 'household'` and one without; confirm both persist and the Table's Area column renders the label and the em dash respectively. Confirm no project field appears in the Life branch's markup. Clean up.

- [ ] **Step 3: Commit**

```bash
git add src/components/workboard/WorkItemDialog.tsx
git commit -m "Add the Life branch with areas and no project field"
```

---

### Task 31: Deadline time across the modal

**Files:**
- Modify: `src/components/workboard/WorkItemDialog.tsx`

- [ ] **Step 1: Add the paired fields**

Due date and Deadline time sit side by side in the common section, mirroring the original spreadsheet's `DEADLINE | TIME` split (§16). The time is optional and **omitted from the request when blank** rather than sent as `"00:00"` — sending midnight would destroy the very distinction the separate column exists to preserve.

For an academic item this routes to the overlay; for an owned item to `deadline_time`. Both are handled by the endpoints from Tasks 9 and 10, so the dialog only has to send the field.

- [ ] **Step 2: Run `tsc`, then verify**

```bash
npx tsc --noEmit
```

Create items with a date and no time, and with both, through the endpoints the dialog calls — for an owned item and an academic one. Confirm via `mysql.exe` that the no-time cases store `deadline_time` NULL rather than `00:00:00`, and that owned items' `due_at` carries a zeroed time component. Clean up and restore.

- [ ] **Step 3: Commit**

```bash
git add src/components/workboard/WorkItemDialog.tsx
git commit -m "Add paired deadline date and optional time to the work-item dialog"
```

---

### Task 32: Detail view

**Files:**
- Create: `src/components/workboard/WorkItemDetail.tsx`
- Modify: `src/components/workboard/WorkItemRow.tsx` (title opens the detail)
- Modify: `src/components/workboard/views/WorkTableView.tsx` (title opens the detail)
- Modify: `src/components/workboard/WorkboardShell.tsx` (hosts the detail drawer)

**Interfaces:**
- Consumes: the subtasks routes (Task 6); `LinksPopover` (Task 23); `setWorkStage` (Task 16).
- Produces: `WorkItemDetail`.

§26 keeps the main views concise by giving every field a home here instead.

- [ ] **Step 1: Build the drawer**

A right-hand drawer showing: title; context and its hierarchy line (`Academic · CS0061` / `Project · Final System`); status, priority, deadline with time, estimate; a **SUBTASKS** section with checkable items, an add field, and a progress count; a **LINKS** section rendering `LinksPopover`'s list inline; and notes.

Reuse the dialog's focus trap, Escape handling, and opener-focus restoration — v2 built all three and a second drawer with different behaviour would be a regression in consistency, not a new feature.

- [ ] **Step 2: Wire subtasks**

Checking a subtask PATCHes `is_done`; adding POSTs; deleting DELETEs. Each mutation refreshes the item so the row's `subtask_done`/`subtask_total` counts stay accurate. Subtasks work identically for owned and academic items — the polymorphic owner from Task 6 is what makes that possible without touching Study Pulse.

- [ ] **Step 3: Open it from both views**

The work title in Focus rows and Table rows becomes a button opening the detail. This replaces Task 13-era plans for the overflow-menu Edit action being the only route in — the title is the obvious affordance, and the overflow Edit still opens the edit dialog.

- [ ] **Step 4: Run `tsc`, then verify**

```bash
npx tsc --noEmit
```

Add two subtasks to an owned item and one to an academic item; toggle one done; confirm `subtask_total`/`subtask_done` in `GET /api/workboard/work` move correctly and that no other item's counts change. Confirm the detail markup contains the hierarchy line, the subtask list, and the links list. Clean up. State that the drawer was not opened in a browser.

- [ ] **Step 5: Commit**

```bash
git add src/components/workboard/WorkItemDetail.tsx src/components/workboard/WorkItemRow.tsx src/components/workboard/views/WorkTableView.tsx src/components/workboard/WorkboardShell.tsx
git commit -m "Add the work-item detail drawer with subtasks and links"
```

---

# PHASE 5 — SHELL AND POLISH

Tasks 33–40 finish the navigation restructure and the visual pass.

---

### Task 33: Design direction addendum

**Files:**
- Create: `docs/design/workboard-v3-direction.md`

**Interfaces:**
- Produces: the written direction Tasks 34–40 build against.

`docs/design/workboard-v2-direction.md` covers rows, chips, priority, stat cards, the rail, and the breakpoint table. v3 adds surfaces it does not describe. Rather than editing a reviewed document in place, this is an addendum that references it and specifies only what is new.

- [ ] **Step 1: Invoke the design skills**

Per `.agents/skills/design-guidelines/SKILL.md`, and its rule to use the minimum specialists necessary: `frontend-design` for the direction of the new surfaces, then `ui-ux-pro-max` to systemise spacing, density, and accessibility. The `impeccable` gate runs in Task 40.

Give them the v2 direction doc, the v3 spec's Shell section, and the existing token set.

- [ ] **Step 2: Write the addendum**

Every value concrete — a number, hex code, or named token. Cover:
- **Header context navigation** vs the view selector: how the two rows are made visually distinct (§1 says they must not both read as identical pill groups), with exact treatments for each.
- **Table density:** row height, cell padding, divider, sticky-header treatment, zebra or no zebra, and the inline-control sizing so a `<select>` in a cell does not inflate the row.
- **Context colour accents** (§28): the four hues as small dots, thin edges, and compact labels — never saturating a row, and never overriding semantic red/amber/green.
- **New states:** completed-late styling, the Blocked badge, the three Table empty states, and the detail drawer's panel treatment.
- **Restrained Overdue** (§22): what "clearly cautionary but not dominating" is, in exact values.
- Reconcile the residual v2 contradiction between §1's table and §5a's prose on Board column headers, noted at the end of the v2 plan.

- [ ] **Step 3: Commit**

```bash
git add docs/design/workboard-v3-direction.md
git commit -m "Add Workboard v3 visual direction addendum"
```

---

### Task 34: Header context navigation

**Files:**
- Modify: `src/components/workboard/WorkboardShell.tsx`

- [ ] **Step 1: Move the contexts into the header**

Per §1's target structure: the back link, then the title and subtitle on the left with the context navigation on the upper right, horizontally aligned where desktop width allows. The stat row follows, then the toolbar row with the view selector on the left and New Work plus Search on the right.

The context row is *where am I working*; the view row is *how do I want to see it*. Task 33's addendum specifies the visual distinction; implement it rather than reusing the view selector's pill treatment.

Keep the `radiogroup`/`radio` semantics v2 landed on — the contexts filter one panel rather than switching between panels, so tabs would be the wrong role.

- [ ] **Step 2: Run `tsc`, then verify**

```bash
npx tsc --noEmit
```

`curl` `/workboard` and confirm the five context labels now appear before the stat cards in document order, and that the view selector still renders separately below. Confirm switching context still filters (the state wiring is unchanged; only its placement moved). State that alignment was not seen rendered.

- [ ] **Step 3: Commit**

```bash
git add src/components/workboard/WorkboardShell.tsx
git commit -m "Move context navigation into the Workboard header"
```

---

### Task 35: View selector — Focus, Table, Board, Timeline

**Files:**
- Modify: `src/components/workboard/WorkboardShell.tsx`

- [ ] **Step 1: Rename and reorder**

The view set becomes `Focus | Table | Board | Timeline` (§5, §6). "List" becomes "Focus" everywhere in the UI; the internal view key may stay `list` to avoid a needless rename cascade, provided the label and any user-visible copy read "Focus".

Remove Calendar from this selector. Task 36 gives it its secondary home first, so ordering matters: do Task 36 before merging this if you are executing out of order.

- [ ] **Step 2: Run `tsc`, then verify**

```bash
npx tsc --noEmit
```

`curl` and confirm exactly four view buttons with the labels Focus, Table, Board, Timeline, and that "Calendar" no longer appears in the selector. Confirm each still renders its view.

- [ ] **Step 3: Commit**

```bash
git add src/components/workboard/WorkboardShell.tsx
git commit -m "Rename List to Focus and drop Calendar from the primary view selector"
```

---

### Task 36: Calendar secondary entry point

**Files:**
- Create: `src/app/workboard/calendar/page.tsx`
- Modify: `src/components/workboard/WorkboardShell.tsx`

**Interfaces:**
- Consumes: `getWorkboardWeek`, `mondayOf`, `todayInManilaAsUtcDate` (v1); `WorkboardWeekView` (v1).

§21 removes Calendar from the primary navigation because it overlaps Schedule. It does **not** delete v1's conflict detection, workload heatmap, or the Canvas announcement → schedule-override flow, which live only in that component and have no other home.

- [ ] **Step 1: Give it its own route**

A server page at `/workboard/calendar` mirroring the current `/workboard` page's data loading for the week, rendering `WorkboardWeekView` inside a minimal shell with a back link to `/workboard`. The component itself is unchanged.

- [ ] **Step 2: Link it discreetly**

A small secondary link in the Workboard toolbar — not a fifth view button. Wording that names what it is rather than reintroducing it as a peer view: something like "Week calendar ↗".

- [ ] **Step 3: Run `tsc`, then verify**

```bash
npx tsc --noEmit
```

`curl` `/workboard/calendar` with the `user_id 6` cookie and confirm a 200 carrying the week grid's markup — the class blocks, heatmap, and deadline strip that v1 shipped. Confirm `/workboard` still renders its four views. Confirm the announcement-driven schedule-override flow still reaches this view by checking that a `schedule_overrides` row created via its API is reflected here.

- [ ] **Step 4: Commit**

```bash
git add src/app/workboard/calendar src/components/workboard/WorkboardShell.tsx
git commit -m "Give the week calendar a secondary route outside the primary view selector"
```

---

### Task 37: Metric copy and restraint

**Files:**
- Modify: `src/components/workboard/WorkboardStats.tsx`

- [ ] **Step 1: Fix the Active card's sub-line**

§22 objects to pairing "Active = 3" with "1 completed in last 7 days" — different concepts stacked as if related. Replace it with something that describes the same number: `N currently in progress`, computed from items whose normalised status is `in_progress`. That is honest, derivable from the payload, and about the count above it.

This supersedes the v2 ruling that rendered the sub-line as a completion count; that phrasing existed only because the net-change figure it replaced was uncomputable. A directly-related figure is available now, so use it.

- [ ] **Step 2: Restrain Overdue**

Per §22 and Task 33's addendum: keep it clearly cautionary — a red accent or left edge — but drop the saturated warning surface so a single overdue item does not dominate the header. Zero state stays quiet, as v2 established.

- [ ] **Step 3: Run `tsc`, then verify**

```bash
npx tsc --noEmit
```

Create two in-progress items and confirm the Active card's sub-line reads "2 currently in progress" and matches the payload. Create one overdue item and confirm the Overdue card's markup changes to its cautionary treatment without the saturated background. Clean up.

- [ ] **Step 4: Commit**

```bash
git add src/components/workboard/WorkboardStats.tsx
git commit -m "Correct the Active card's sub-line and restrain the Overdue treatment"
```

---

### Task 38: Filters popover

**Files:**
- Create: `src/components/workboard/WorkboardFilters.tsx`
- Modify: `src/components/workboard/WorkboardShell.tsx`

- [ ] **Step 1: Build the popover**

A compact Filter control beside Search (§23), never a permanently-expanded form. Filters: status (by the active context's stages), priority, project, deadline range, and an overdue-only toggle. Active filters show a count badge on the trigger so a filtered board is never silently filtered.

- [ ] **Step 2: Apply consistently**

Filters compose with search and the context selector into the single `visibleItems` memo the shell already owns, so every view — Focus, Table, Board, Timeline — filters identically without each implementing its own logic. Stats and the rail continue reading the unfiltered payload, as v2 established: they describe the whole board.

- [ ] **Step 3: Run `tsc`, then verify**

```bash
npx tsc --noEmit
```

Create items spanning two priorities and two statuses. Confirm through the rendered HTML that filtering to `high` shows only the high-priority item in Focus, and that switching to Table with the same filter shows the same single row — that cross-view consistency is the property worth checking. Confirm the stat cards do **not** change when a filter is applied. Clean up.

- [ ] **Step 4: Commit**

```bash
git add src/components/workboard/WorkboardFilters.tsx src/components/workboard/WorkboardShell.tsx
git commit -m "Add the Workboard filters popover applying across all views"
```

---

### Task 39: Timeline context lanes

**Files:**
- Modify: `src/components/workboard/views/WorkTimelineView.tsx`

- [ ] **Step 1: Make lanes follow the context**

§20: for My Work, lanes stay the four contexts. For a specific context, lanes become that context's own grouping — courses under Academic, projects under Projects, organizations under Organization, areas under Life. Items with no group value fall into a trailing "Unassigned" lane rather than disappearing.

Plotting rules are unchanged (bar for start+due, marker for due-only, omitted for neither, clipped not clamped outside the window) — this task only changes how rows are grouped.

- [ ] **Step 2: Run `tsc`, then verify**

```bash
npx tsc --noEmit
```

With items across two courses and two projects, confirm the rendered HTML shows course-code lanes under Academic and project-name lanes under Projects, and the four context lanes under My Work. Confirm an item with no project still appears, in the Unassigned lane. Clean up.

- [ ] **Step 3: Commit**

```bash
git add src/components/workboard/views/WorkTimelineView.tsx
git commit -m "Make Timeline lanes follow the selected context"
```

---

### Task 40: Responsive pass and quality gate

**Files:**
- Modify: `src/components/workboard/WorkboardShell.tsx`, `WorkboardStats.tsx`, `WorkboardFilters.tsx`, `WorkItemDetail.tsx`, and the four view components as needed

- [ ] **Step 1: Responsive treatment for the new surfaces**

Per §1 and §29, and Task 33's addendum:
- **Context navigation:** in the header on desktop; compact horizontal on tablet; horizontally scrolling tabs or a selector on mobile. Never a cramped five-item row.
- **Table:** already handled in Task 24 — verify it still holds after the shell changes.
- **Detail drawer:** full-width sheet on phone rather than a narrow side panel.
- **Filters popover:** anchored on desktop, bottom sheet on phone.

Apply the specificity discipline v2 learned the hard way: any property a media query must override does not get an inline style. That is the bug that left Board's mobile snap-scroll silently dead.

- [ ] **Step 2: Run the quality gate**

Invoke `impeccable` per `.agents/skills/design-guidelines/SKILL.md` against the finished Workboard surfaces. Fix what it raises that is real; **record anything you decline and why**. A declined finding with a reason is a fine outcome; a silently dropped one is not.

Give it the accumulated deferred minors from v2 as context — several are still open and this is the natural moment to triage them: the disabled `.vb-btn-pink` hover bleed, the overflow menu's missing arrow-key navigation, the Board's focus loss after a keyboard move, and the missing `aria-controls` on Focus section toggles.

- [ ] **Step 3: Run `tsc`, then verify**

```bash
npx tsc --noEmit
```

`curl` every route — `/workboard` in each of the four views and `/workboard/calendar` — and confirm 200s with expected markup after the responsive changes. No breakpoint can be confirmed by eye here; say so explicitly and list which ones were reasoned about rather than observed.

- [ ] **Step 4: Commit**

```bash
git add src/components/workboard docs/design
git commit -m "Add Workboard v3 responsive treatment and polish pass"
```

---

## Self-Review

**Spec coverage.** Walked each spec section against the task list:

- §1 header navigation → Task 34; §2 My Work as projection → Task 1 (enum) + Task 2; §3 project semantics → Tasks 1, 7; §4 Context rename → Task 2, 25.
- §5 view set → Task 35; §6 Focus + overdue → Tasks 13, 14, 15; §7–§9 Table → Tasks 17–24; §10 Links → Tasks 5, 23.
- §11–§15 creation → Tasks 25–30; §16 time → Tasks 1, 9, 10, 22, 31; §17 Board → Tasks 2, 16; §18 completed/overdue → Task 13.
- §19–§20 Timeline → Task 39; §21 Calendar → Tasks 35, 36; §22 metrics → Task 37; §23 filters → Task 38; §24 project management → Tasks 7, 28, 29; §25 Links UX → Task 23; §26 detail view → Task 32.
- §27–§29 visual and responsive → Tasks 33, 40 (Table's own responsive work is Task 24); §30 one domain → structural, enforced by every view consuming `visibleItems` from one payload; §31 isolation → Tasks 3–7, verified per task; §34 product principle → Tasks 17, 25–30 collectively.

No spec section is unrepresented.

**Placeholder scan.** No TBD/TODO markers. Every code step carries real code; every UI step names the files, the data, and the verification.

**Type consistency.** `WorkContext`/`WorkStage`/`WorkStatus`/`LifeArea` are defined once in Task 2 and imported unchanged thereafter. `LinkOwner`/`OwnerColumns` are defined in Task 3 and consumed by Tasks 5 and 6. `WorkItem`'s new fields are defined in Task 8 and consumed by Tasks 13, 17, and every view. `setWorkStatus`/`setWorkStage`/`setPriority` all live in `WorkItemRow.tsx` (Tasks 16, 21) so endpoint routing stays in one place, as v2 established.

**Known risks carried into execution:**

1. **Task 17 flags a possible interface gap.** `cellValue` reads `chip_label` for both Course and Project, but the Academic table needs them as separate columns and `chip_label` resolves project-then-course. If that proves ambiguous, `WorkItem` needs an explicit `course_code` added in Task 8 rather than a guess in Task 17. Called out in-task with an instruction to report rather than paper over.

2. **Task 11 writes real Study Pulse rows.** Its verification must delete them; leaving test rows pollutes a module outside Workboard. Stated in the task.

3. **The graded-row trigger remains.** A newly created graded item is safe to un-complete until a grade lands on it, after which Study Pulse's pre-existing `BEFORE UPDATE` trigger forces `status='Done'`. Out of scope here and recorded in the spec, but implementers of Tasks 10, 11, 16, and 20 should choose non-graded rows for status round-trip testing, as v2's final fix wave learned.

4. **Task 35 depends on Task 36.** Removing Calendar from the selector before its secondary route exists would orphan it, briefly. Execute in order, or do 36 first.
