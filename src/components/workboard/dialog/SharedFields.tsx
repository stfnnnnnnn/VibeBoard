'use client';

import type { CSSProperties, ReactNode, RefObject } from 'react';
// Types only — `workItems.ts` and `organizations.ts` import `@/lib/db` (mysql2) at module scope.
import type { WorkItem, WorkPriority, WorkStatus, ProjectSummary } from '@/lib/workboard/workItems';
import type { OrganizationSummary } from '@/lib/workboard/organizations';
import {
  WORK_CONTEXTS, CONTEXT_LABELS, LIFE_AREAS, LIFE_AREA_LABELS,
  type WorkContext, type LifeArea,
} from '@/lib/workboard/workContexts';
import { FIELD_LABEL, FIELD_INPUT, FIELD_ERROR, FIELD_HINT } from './dialogStyles';
import { STATUS_LABEL, PRIORITY_LABEL } from './dialogTypes';

/** Sentinel value for the project select's inline "＋ New project…" option — the only picker
 *  in this dialog that offers inline project creation. */
const NEW_PROJECT_SENTINEL = '__new__';

/** The Organization select's own inline "＋ New organization…" option, and deliberately a
 *  *different* string from `NEW_PROJECT_SENTINEL`: the two pickers can end up side by side
 *  in one branch, and a shared sentinel would make "new project" and "new organization"
 *  indistinguishable to whichever `onChange` read it. */
const NEW_ORG_SENTINEL = '__new_org__';

export const HINT_P: CSSProperties = { ...FIELD_HINT, marginBottom: 0 };
export const ERROR_P: CSSProperties = { ...FIELD_ERROR, marginBottom: 0 };
const ROW: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 };
const INLINE_ROW: CSSProperties = { display: 'flex', gap: 6 };
const ADD_BTN: CSSProperties = {
  ...FIELD_INPUT, width: 'auto', padding: '8px 14px', font: '700 var(--wb-fs-14) var(--wb-font-ui)',
  background: 'var(--wb-blue-ink)', color: 'var(--wb-inverse-text)', border: 'none', cursor: 'pointer',
};
const CANCEL_BTN: CSSProperties = {
  ...FIELD_INPUT, width: 'auto', padding: '8px 14px', background: 'transparent',
  color: 'var(--wb-text-muted)', cursor: 'pointer',
};
export const INFO_CARD: CSSProperties = {
  padding: '12px 14px', borderRadius: 'var(--wb-r-lg)',
  background: 'var(--wb-selected)', border: '1px solid var(--wb-border)',
};
export const INFO_TITLE: CSSProperties = { margin: '0 0 4px', font: '700 var(--wb-fs-14) var(--wb-font-head)', color: 'var(--wb-text)' };
export const INFO_BODY: CSSProperties = { margin: 0, font: '500 var(--wb-fs-12) var(--wb-font-ui)', color: 'var(--wb-text-muted)' };
export const INFO_LINK: CSSProperties = { display: 'inline-block', marginTop: 8, font: '700 var(--wb-fs-13) var(--wb-font-ui)', color: 'var(--wb-blue-ink)' };
export const RETRY_BTN: CSSProperties = {
  background: 'none', border: 'none', padding: 0, font: 'inherit',
  color: 'inherit', cursor: 'pointer',
};

/** Label above the control, then the hint, then an inline validation error (spec 10.1). */
export function Field({ label, children, hint, error }: { label: string; children: ReactNode; hint?: string; error?: string | null }) {
  return (
    <div>
      <label style={FIELD_LABEL}>{label}</label>
      {children}
      {hint && <p style={HINT_P}>{hint}</p>}
      {error && <p role="alert" data-field-error="" style={ERROR_P}>{error}</p>}
    </div>
  );
}

/** The academic overlay's `note` cap (`ENTRY_NOTE_MAX` in academicWrites.ts, which this
 *  client file cannot import: that module imports `@/lib/db`). Both routes 400 past it. */
export const ACADEMIC_NOTE_MAX = 1000;

/** Only fields this endpoint accepts: PATCH /api/workboard/academic/[source]/[id] rejects
 *  any other field's source. It cannot rename an academic item, so no title input is
 *  rendered for one — a title field that silently fails to save must not exist. */
export function AcademicEditFields({
  item, workStatus, setWorkStatus, dueAt, setDueAt, deadlineTime, setDeadlineTime,
  priority, setPriority,
  estimatedHours, setEstimatedHours, startDate, setStartDate, note, setNote, firstFieldRef,
}: {
  item: WorkItem;
  workStatus: WorkStatus; setWorkStatus: (v: WorkStatus) => void;
  dueAt: string; setDueAt: (v: string) => void;
  deadlineTime: string; setDeadlineTime: (v: string) => void;
  priority: WorkPriority; setPriority: (v: WorkPriority) => void;
  estimatedHours: string; setEstimatedHours: (v: string) => void;
  startDate: string; setStartDate: (v: string) => void;
  note: string; setNote: (v: string) => void;
  firstFieldRef: RefObject<HTMLSelectElement | null>;
}) {
  return (
    <>
      <div style={INFO_CARD}>
        <p style={INFO_TITLE}>{item.title}</p>
        <p style={INFO_BODY}>
          Title and scores are managed in Study Pulse — this dialog only edits how it shows up on Workboard.
        </p>
        {item.user_subject_id !== null && (
          <a href={`/studypulse/${item.user_subject_id}`} className="wb-focus-ring wb-dialog-link" style={INFO_LINK}>
            Open in Study Pulse →
          </a>
        )}
      </div>

      <Field label="Status">
        <select
          ref={firstFieldRef}
          className="wb-focus-ring"
          style={FIELD_INPUT}
          value={workStatus}
          onChange={e => setWorkStatus(e.target.value as WorkStatus)}
        >
          {(Object.keys(STATUS_LABEL) as WorkStatus[]).map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
      </Field>

      <div style={ROW}>
        <Field label="Due date">
          <input type="date" className="wb-focus-ring" style={FIELD_INPUT} value={dueAt} onChange={e => setDueAt(e.target.value)} />
        </Field>
        {/* Beside Due date, not under it: the two are one deadline split across two columns
            (spec §16's DEADLINE | TIME). Left blank it stays blank — the submit body sends
            null rather than the "00:00" an empty time input would otherwise imply. */}
        <Field label="Deadline time" hint="Optional. Blank means any time that day.">
          <input type="time" className="wb-focus-ring" style={FIELD_INPUT} value={deadlineTime} onChange={e => setDeadlineTime(e.target.value)} />
        </Field>
        <Field label="Start date" hint="Adds a bar on the Timeline view.">
          <input type="date" className="wb-focus-ring" style={FIELD_INPUT} value={startDate} onChange={e => setStartDate(e.target.value)} />
        </Field>
      </div>

      <div style={ROW}>
        <Field label="Priority">
          <select className="wb-focus-ring" style={FIELD_INPUT} value={priority} onChange={e => setPriority(e.target.value as WorkPriority)}>
            {(Object.keys(PRIORITY_LABEL) as WorkPriority[]).map(p => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
          </select>
        </Field>
        <Field label="Estimated hours">
          <input
            type="number" min="0" step="0.25" className="wb-focus-ring" style={FIELD_INPUT}
            value={estimatedHours} onChange={e => setEstimatedHours(e.target.value)} placeholder="e.g. 2"
          />
        </Field>
      </div>

      {/* Lives on the Workboard overlay, like Estimated hours; Study Pulse shows it read-only
          on the entry (spec 2026-10-24 §6.1). */}
      <Field label="Note" hint="Shown on the entry in Study Pulse.">
        <textarea
          className="wb-focus-ring"
          style={{ ...FIELD_INPUT, minHeight: 72, resize: 'vertical' }}
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Optional details…"
          maxLength={ACADEMIC_NOTE_MAX}
        />
      </Field>
    </>
  );
}

export function TitleContextFields({
  title, setTitle, titleRequired, titleError, context, onContextChange, contextError, firstFieldRef,
}: {
  title: string; setTitle: (v: string) => void;
  /** false on the "Link an existing item" path — see the note on the input. */
  titleRequired: boolean;
  titleError: string | null;
  context: WorkContext | ''; onContextChange: (v: WorkContext | '') => void;
  contextError: string | null;
  firstFieldRef: RefObject<HTMLInputElement | null>;
}) {
  return (
    <>
      <Field label="Title" error={titleError}>
        <input
          ref={firstFieldRef}
          type="text"
          className="wb-focus-ring"
          style={FIELD_INPUT}
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="What needs doing?"
          // Not required on path 1: nothing here is submitted (the item already exists), so
          // native constraint validation would block the "Done" button on an empty Title the
          // form never reads.
          required={titleRequired}
        />
      </Field>

      <Field label="Context" hint="Pick a context to see the fields that only apply to it." error={contextError}>
        <select
          className="wb-focus-ring"
          style={FIELD_INPUT}
          value={context}
          onChange={e => onContextChange(e.target.value as WorkContext | '')}
        >
          {/* An explicit placeholder so "no context yet" is a visible, selectable state rather
              than an invisible default that silently means Projects. Disabled once a real
              context is set: re-selecting it would run the context-change reset, silently
              clearing `projectId`/`subjectId` on an item that already had a good context. */}
          <option value="" disabled={context !== ''}>Choose a context…</option>
          {WORK_CONTEXTS.map(c => <option key={c} value={c}>{CONTEXT_LABELS[c]}</option>)}
        </select>
      </Field>
    </>
  );
}

/**
 * The Organization branch. Course is not merely hidden here, it is absent: nothing in this
 * component reads a course (spec §13 — an organization item hangs off an organization, never
 * off a course).
 */
export function OrganizationFields({
  projects, projectId, setProjectId,
  organizationId, organizations, orgsLoading, orgsError, onOrganizationChange,
  showNewOrg, setShowNewOrg, newOrgName, setNewOrgName, creatingOrg, orgError,
  onCreateOrganization, onCancelNewOrg,
}: {
  projects: ProjectSummary[];
  projectId: number | ''; setProjectId: (v: number | '') => void;
  organizationId: number | '';
  organizations: OrganizationSummary[] | null;
  orgsLoading: boolean; orgsError: string | null;
  onOrganizationChange: (v: number | '') => void;
  showNewOrg: boolean; setShowNewOrg: (v: boolean) => void;
  newOrgName: string; setNewOrgName: (v: string) => void;
  creatingOrg: boolean; orgError: string | null;
  onCreateOrganization: () => void;
  onCancelNewOrg: () => void;
}) {
  const chosenOrgId = organizationId === '' ? null : organizationId;
  // Without `context` and both parent ids on `ProjectSummary` this list would offer another
  // organization's initiatives — or a personal project — under this one.
  const orgProjects = chosenOrgId === null
    ? []
    : projects.filter(p => p.context === 'organization' && p.organization_id === chosenOrgId);
  // An item being edited can hold a `project_id` this filter would never offer. A `<select
  // value>` matching no `<option>` displays the first one — "No project" — which would
  // misreport a value still about to be submitted. Surfaced as its own disabled option instead.
  const outOfScope = projectId !== '' && !orgProjects.some(p => p.id === projectId)
    ? projects.find(p => p.id === projectId)
    : undefined;

  return (
    <>
      <Field
        label="Organization"
        hint={showNewOrg ? undefined : 'Optional. The club, org, or team this belongs to.'}
      >
        {!showNewOrg ? (
          <select
            className="wb-focus-ring"
            style={FIELD_INPUT}
            value={organizationId === '' ? '' : String(organizationId)}
            disabled={orgsLoading}
            onChange={e => {
              if (e.target.value === NEW_ORG_SENTINEL) { setShowNewOrg(true); return; }
              onOrganizationChange(e.target.value === '' ? '' : Number(e.target.value));
            }}
          >
            {/* Optional, so the empty state is a real choice ("No organization") rather than
                an unfillable placeholder — unlike Academic's required Course. */}
            <option value="">{orgsLoading ? 'Loading organizations…' : 'No organization'}</option>
            {(organizations ?? []).map(o => (
              <option key={o.id} value={o.id}>
                {o.name}{o.status === 'archived' ? ' (archived)' : ''}
              </option>
            ))}
            <option value={NEW_ORG_SENTINEL}>＋ New organization…</option>
          </select>
        ) : (
          <div>
            <div style={INLINE_ROW}>
              <input
                type="text"
                className="wb-focus-ring"
                style={FIELD_INPUT}
                value={newOrgName}
                onChange={e => setNewOrgName(e.target.value)}
                // Enter inside a form fires the form's submit button, so without this,
                // finishing the organization name would submit the whole work item instead.
                onKeyDown={e => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  if (!creatingOrg && newOrgName.trim()) onCreateOrganization();
                }}
                placeholder="Organization name"
                autoFocus
              />
              <button
                type="button"
                className="wb-focus-ring wb-pressable"
                onClick={onCreateOrganization}
                disabled={creatingOrg || !newOrgName.trim()}
                style={ADD_BTN}
              >
                {creatingOrg ? 'Adding…' : 'Add'}
              </button>
              <button type="button" className="wb-focus-ring wb-pressable" onClick={onCancelNewOrg} style={CANCEL_BTN}>
                Cancel
              </button>
            </div>
            {/* Whatever the route said, verbatim — "You already have an organization with that
                name" is already the sentence a user needs. */}
            {orgError && <p role="alert" style={ERROR_P}>{orgError}</p>}
          </div>
        )}
        {orgsError && <p role="alert" style={ERROR_P}>{orgsError}</p>}
      </Field>

      <Field
        label="Project / Initiative"
        hint={
          outOfScope
            ? 'This project isn’t part of the chosen organization. Pick “No project” to clear it.'
            : chosenOrgId === null
              ? 'Optional. Choose an organization first — initiatives are listed per organization.'
              : orgProjects.length === 0
                ? 'Optional. This organization has no initiatives yet.'
                : 'Optional. Only this organization’s initiatives are listed.'
        }
      >
        <select
          className="wb-focus-ring"
          style={FIELD_INPUT}
          value={projectId === '' ? '' : String(projectId)}
          disabled={chosenOrgId === null || (orgProjects.length === 0 && !outOfScope)}
          onChange={e => setProjectId(e.target.value === '' ? '' : Number(e.target.value))}
        >
          <option value="">No project</option>
          {outOfScope && (
            <option value={outOfScope.id} disabled>{outOfScope.name} (not in this organization)</option>
          )}
          {orgProjects.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </Field>
    </>
  );
}

/**
 * The Projects branch — the one branch whose per-context field is genuinely REQUIRED (spec
 * §14: one-off work with no project belongs in Life). There is no "No project" option; the
 * placeholder is a prompt, and `requiresProject` in the dialog's submit is the guard.
 * Projects have no parent (`validateProjectParent`), so filtering on the context is exact.
 */
export function ProjectFields({
  projects, projectId, setProjectId,
  showNewProject, setShowNewProject, newProjectName, setNewProjectName,
  creatingProject, projectError, onCreateProject, onCancelNewProject, error,
}: {
  projects: ProjectSummary[];
  projectId: number | ''; setProjectId: (v: number | '') => void;
  showNewProject: boolean; setShowNewProject: (v: boolean) => void;
  newProjectName: string; setNewProjectName: (v: string) => void;
  creatingProject: boolean; projectError: string | null;
  onCreateProject: () => void;
  onCancelNewProject: () => void;
  error: string | null;
}) {
  const standaloneProjects = projects.filter(p => p.context === 'project');
  // An item being edited can hold a `project_id` this filter does not offer, because the
  // project was re-parented onto a course or organization after the item was linked to it.
  // Surfaced as its own disabled option so what is about to be saved stays visible.
  const outOfScope = projectId !== '' && !standaloneProjects.some(p => p.id === projectId)
    ? projects.find(p => p.id === projectId)
    : undefined;

  return (
    <Field
      label="Project"
      error={error}
      hint={
        showNewProject
          ? undefined
          : outOfScope
            ? 'This project now belongs to a course or organization. Choose one of your projects instead.'
            : standaloneProjects.length === 0
              // A required field with nothing to choose is a dead end, so the empty state
              // names both ways out.
              ? 'No projects yet — add one with “＋ New project…”, or switch to Life if this is one-off work.'
              : 'Required. One-off work with no project belongs in Life.'
      }
    >
      {!showNewProject ? (
        <select
          className="wb-focus-ring"
          style={FIELD_INPUT}
          value={projectId === '' ? '' : String(projectId)}
          onChange={e => {
            if (e.target.value === NEW_PROJECT_SENTINEL) { setShowNewProject(true); return; }
            setProjectId(e.target.value === '' ? '' : Number(e.target.value));
          }}
        >
          {/* Disabled once a real project is picked: reachable as the initial state, never as
              a way back out of a valid choice ("no project" is not an answer here). */}
          <option value="" disabled={projectId !== ''}>Choose a project…</option>
          {outOfScope && (
            <option value={outOfScope.id} disabled>{outOfScope.name} (no longer a standalone project)</option>
          )}
          {standaloneProjects.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
          {/* Never disabled and never hidden: with no projects yet this is the only way out
              of a required field. */}
          <option value={NEW_PROJECT_SENTINEL}>＋ New project…</option>
        </select>
      ) : (
        <div>
          <div style={INLINE_ROW}>
            <input
              type="text"
              className="wb-focus-ring"
              style={FIELD_INPUT}
              value={newProjectName}
              onChange={e => setNewProjectName(e.target.value)}
              // Inside a form, Enter fires the submit button, so finishing the project name
              // would otherwise submit the whole work item.
              onKeyDown={e => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                if (!creatingProject && newProjectName.trim()) onCreateProject();
              }}
              placeholder="Project name"
              autoFocus
            />
            <button
              type="button"
              className="wb-focus-ring wb-pressable"
              onClick={onCreateProject}
              disabled={creatingProject || !newProjectName.trim()}
              style={ADD_BTN}
            >
              {creatingProject ? 'Adding…' : 'Add'}
            </button>
            <button type="button" className="wb-focus-ring wb-pressable" onClick={onCancelNewProject} style={CANCEL_BTN}>
              Cancel
            </button>
          </div>
          {projectError && <p role="alert" style={ERROR_P}>{projectError}</p>}
        </div>
      )}
    </Field>
  );
}

/** The Life branch: one optional area (spec §15 keeps Life lightweight). "No area" stays
 *  selectable because it is a legitimate final answer. */
export function LifeFields({ lifeArea, setLifeArea }: { lifeArea: LifeArea | ''; setLifeArea: (v: LifeArea | '') => void }) {
  return (
    <Field label="Area" hint="Optional. Groups personal work so it reads at a glance in the Table.">
      <select
        className="wb-focus-ring"
        style={FIELD_INPUT}
        value={lifeArea}
        onChange={e => setLifeArea(e.target.value as LifeArea | '')}
      >
        <option value="">No area</option>
        {LIFE_AREAS.map(a => <option key={a} value={a}>{LIFE_AREA_LABELS[a]}</option>)}
      </select>
    </Field>
  );
}

/** Due/time/start, priority/estimate, status (edit only) and note for an owned item. */
export function ScheduleFields({
  isNewGradedPath, showStatus,
  dueAt, setDueAt, dueError, deadlineTime, setDeadlineTime, startDate, setStartDate,
  priority, setPriority, estimatedHours, setEstimatedHours,
  workStatus, setWorkStatus, note, setNote,
}: {
  isNewGradedPath: boolean;
  showStatus: boolean;
  dueAt: string; setDueAt: (v: string) => void; dueError: string | null;
  deadlineTime: string; setDeadlineTime: (v: string) => void;
  startDate: string; setStartDate: (v: string) => void;
  priority: WorkPriority; setPriority: (v: WorkPriority) => void;
  estimatedHours: string; setEstimatedHours: (v: string) => void;
  workStatus: WorkStatus; setWorkStatus: (v: WorkStatus) => void;
  note: string; setNote: (v: string) => void;
}) {
  return (
    <>
      {/* POST /api/workboard/academic/create takes only { title, target_type, cat_id?,
          period_id?, deadline, priority, note? } — Deadline time, Start date and Estimated
          hours have no column on that path, so they are disabled and this says why. Note is
          written to the overlay row for the new entry (spec 2026-10-24 §6.1). */}
      {isNewGradedPath && (
        <p style={{ ...HINT_P, marginTop: 0 }}>
          Study Pulse doesn’t have a place for Deadline time, Start date, or Estimated
          hours yet — only Due date, Priority and Note are saved for graded work.
        </p>
      )}

      <div style={ROW}>
        <Field label="Due date" error={dueError}>
          <input type="date" className="wb-focus-ring" style={FIELD_INPUT} value={dueAt} onChange={e => setDueAt(e.target.value)} />
        </Field>
        {/* One deadline split into date and time (spec §16), the time optional and sent as
            null when blank rather than as a midnight nobody chose. */}
        <Field label="Deadline time" hint="Optional. Blank means any time that day.">
          <input
            type="time" className="wb-focus-ring" style={FIELD_INPUT}
            value={deadlineTime} onChange={e => setDeadlineTime(e.target.value)}
            disabled={isNewGradedPath}
          />
        </Field>
        <Field label="Start date" hint="Adds a bar on the Timeline view.">
          <input
            type="date" className="wb-focus-ring" style={FIELD_INPUT}
            value={startDate} onChange={e => setStartDate(e.target.value)} disabled={isNewGradedPath}
          />
        </Field>
      </div>

      <div style={ROW}>
        <Field label="Priority">
          <select className="wb-focus-ring" style={FIELD_INPUT} value={priority} onChange={e => setPriority(e.target.value as WorkPriority)}>
            {(Object.keys(PRIORITY_LABEL) as WorkPriority[]).map(p => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
          </select>
        </Field>
        <Field label="Estimated hours">
          <input
            type="number" min="0" step="0.25" className="wb-focus-ring" style={FIELD_INPUT}
            value={estimatedHours} onChange={e => setEstimatedHours(e.target.value)}
            placeholder="e.g. 2" disabled={isNewGradedPath}
          />
        </Field>
      </div>

      {showStatus && (
        <Field label="Status">
          <select className="wb-focus-ring" style={FIELD_INPUT} value={workStatus} onChange={e => setWorkStatus(e.target.value as WorkStatus)}>
            {(Object.keys(STATUS_LABEL) as WorkStatus[]).map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </Field>
      )}

      <Field label="Note">
        <textarea
          className="wb-focus-ring"
          style={{ ...FIELD_INPUT, minHeight: 72, resize: 'vertical' }}
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Optional details…"
          // Owned notes are TEXT with no cap; the graded path's overlay note has one.
          maxLength={isNewGradedPath ? ACADEMIC_NOTE_MAX : undefined}
        />
      </Field>
    </>
  );
}
