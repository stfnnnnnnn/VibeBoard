'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ExternalLink, Link2, Plus, Trash2, X } from 'lucide-react';
// Type-only imports from three modules that reach `pool` (mysql2) at module scope. `import type`
// is erased entirely by TypeScript, so no driver reaches this client bundle — the same shape
// `LinksPopover`, `StatusCell`, `WorkItemRow` and `WorkTableView` all use for `WorkItem`. A
// *value* import from any of the three would 500 the page.
import type { WorkItem } from '@/lib/workboard/workItems';
import type { Subtask } from '@/lib/workboard/subtasks';
import type { WorkLink } from '@/lib/workboard/links';
// Pool-free by construction (`workContexts.ts` has no imports at all), so these are safe as
// runtime imports from a client component.
import {
  CONTEXT_LABELS, LIFE_AREA_LABELS, STAGES_BY_CONTEXT, STAGE_LABELS, type WorkStage,
} from '@/lib/workboard/workContexts';
// `setWorkStage` is the single place owned-vs-academic endpoint routing lives (Tasks 11/16).
// Imported, never re-derived — this drawer must not know that academic items patch a different
// route from owned ones, for exactly the reason `StatusCell` must not.
import { setWorkStage } from './WorkItemRow';
// Deadline wording for the whole module. Reused rather than re-formatted so the drawer cannot
// word a date differently from the row underneath it.
import { dueStateOf, formatDeadline, formatDeadlineTime, type DueState } from '@/lib/workboard/dueSemantics';
// The links editor, plus the shared owner-links store `LinksCell` and the phone card both read.
// The LINKS section below renders that store's contents as a plain inline list and hands every
// *mutation* to this same standalone popover — nothing about add/delete is re-implemented here.
import LinksPopover, { linkTypeMeta, loadOwnerLinks, useOwnerLinks } from './LinksPopover';
// The module's one failure surface, shared with the four Table cells and `LinksPopover`.
import { reportTableCellError } from './table/tableCellError';

const FONT        = "'Inter','DM Sans','Segoe UI',sans-serif";
const HEADER_FONT = "'DM Sans','Segoe UI',sans-serif";

const DASH = '—';

const NETWORK_ERROR       = 'Could not reach the server. Check your connection and try again.';
const STATUS_ERROR        = 'Could not change the status. Please try again.';
const SUBTASK_LIST_ERROR  = 'Could not load the subtasks. Please try again.';
const SUBTASK_ADD_ERROR   = 'Could not add the subtask. Please try again.';
const SUBTASK_TOGGLE_ERROR = 'Could not update the subtask. Please try again.';
const SUBTASK_DELETE_ERROR = 'Could not remove the subtask. Please try again.';

const VISUALLY_HIDDEN: React.CSSProperties = {
  position: 'absolute', width: '1px', height: '1px', padding: 0, margin: '-1px',
  overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
};

/** `PriorityCell`'s three labels. */
const PRIORITY_LABEL: Record<WorkItem['priority'], string> = {
  high: 'High', normal: 'Normal', low: 'Low',
};

/** `DeadlineCell`'s `DEADLINE_COLOR`, value for value, so a date that reads late in the Table
 *  reads late here. Keyed by `DueState` so a seventh state fails the build. */
const DUE_COLOR: Record<DueState, string> = {
  none:           '#5c6b80',
  upcoming:       '#5c6b80',
  due_today:      '#5c6b80',
  completed:      '#5c6b80',
  completed_late: '#8a5010',
  overdue:        '#922e48',
};

/** `DeadlineCell`'s `DEADLINE_SR_SUFFIX`. The drawer shows a bare date, so without this the
 *  lateness would be conveyed by colour alone. */
const DUE_SR_SUFFIX: Partial<Record<DueState, string>> = {
  overdue:        ' (overdue)',
  completed_late: ' (completed late)',
};

/** §1's micro-label, the same type treatment `LinksPopover`'s header and the Table's column
 *  headers use — this drawer's three section headings (SUBTASKS / LINKS / NOTES). */
const SECTION_LABEL_STYLE: React.CSSProperties = {
  display: 'block', fontFamily: FONT, fontSize: '0.7rem', fontWeight: 800,
  letterSpacing: '0.04em', textTransform: 'uppercase', color: '#5c6b80',
};

/** The dialog's `CONTROL_STYLE`, compressed one notch for a 400px-wide panel. Same background,
 *  same border, same text colour — the module's one control language. */
const CONTROL_STYLE: React.CSSProperties = {
  boxSizing: 'border-box', minHeight: '32px', borderRadius: '10px',
  padding: '5px 9px', background: 'rgba(255,255,255,0.6)',
  border: '1px solid rgba(200,210,230,0.6)', fontFamily: FONT, fontSize: '0.82rem',
  fontWeight: 500, color: '#2d3748',
};

const NOTE_STYLE: React.CSSProperties = {
  margin: 0, fontFamily: FONT, fontSize: '0.78rem', fontWeight: 500,
  color: '#5c6b80', lineHeight: 1.45,
};

/** `work_stage` is typed `WorkStage` but stored in a free-form `VARCHAR(24)`, so the type is a
 *  compile-time assertion over DB text rather than a runtime guarantee. Falling back to
 *  `work_status` keeps a row with an unrecognised stage showing a real label instead of a blank
 *  control; every `WorkStatus` is itself a legal stage in every context. `StatusCell`'s helper,
 *  same reasoning — neither is exported. */
function stageOf(item: WorkItem): WorkStage {
  const raw: string = item.work_stage;
  return raw in STAGE_LABELS ? (raw as WorkStage) : item.work_status;
}

/** `StatusCell`'s `FALLBACK_STAGES`: `context` is read straight from the free-form `category`
 *  column, so the vocabulary lookup can miss on a legacy or hand-edited row. These three are
 *  legal in every context, so such a row still gets a usable select rather than an empty one. */
const FALLBACK_STAGES: readonly WorkStage[] = ['todo', 'in_progress', 'done'];

/**
 * `"Academic · CS0061"`, `"Projects · Final System"`, `"Academic · CS0061 · Final System"`.
 *
 * Built from the *same* first-class fields the Table's own columns project — `course_code`,
 * `organization_name`, `project_name`, `life_area` — in the order the contexts nest, so the
 * drawer and the row underneath it can never disagree about where a work item lives. Nothing
 * here re-derives a name from an id or re-reads `chip_label`'s collapsed chain, with one
 * exception: `chip_label` is the *last* resort, used only when none of the four produced a
 * second part (a shape today's payload does not produce, since `chip_label` is itself derived
 * from exactly these fields — it is here so a future source that populates only the chip still
 * says something rather than nothing).
 *
 * The context word comes from `CONTEXT_LABELS`, so it reads identically to the Table's Context
 * column and the dialog's Context select — "Projects", never a second spelling of it.
 */
export function hierarchyLine(item: WorkItem): string {
  const parts: string[] = [CONTEXT_LABELS[item.context] ?? item.context];
  if (item.course_code)       parts.push(item.course_code);
  if (item.organization_name) parts.push(item.organization_name);
  if (item.project_name)      parts.push(item.project_name);
  if (item.life_area)         parts.push(LIFE_AREA_LABELS[item.life_area] ?? item.life_area);
  if (parts.length === 1 && item.chip_label) parts.push(item.chip_label);
  return parts.join(' · ');
}

/** The server's answer, validated rather than trusted: this is JSON off the wire, and a shape
 *  mismatch must read as a failed load, not as a render-time crash inside a `.map`.
 *  `LinksPopover`'s `parseLinks`, one collection over. */
function parseSubtasks(body: unknown): Subtask[] | null {
  if (typeof body !== 'object' || body === null) return null;
  const raw = (body as { subtasks?: unknown }).subtasks;
  if (!Array.isArray(raw)) return null;

  const parsed: Subtask[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) return null;
    const row = entry as Record<string, unknown>;
    if (typeof row.id !== 'number' || typeof row.title !== 'string') return null;
    parsed.push({
      id:       row.id,
      title:    row.title,
      // The route maps TINYINT(1) to a real boolean, but a `1` off an older deployment must
      // still read as done rather than as a type error at the checkbox.
      is_done:  row.is_done === true || row.is_done === 1,
      position: typeof row.position === 'number' ? row.position : 0,
    });
  }
  return parsed;
}

/** The sibling cells' message extraction, verbatim: report what the server said when it said
 *  something, and a generic sentence when the body is an HTML error page or an empty 500. */
async function messageFrom(res: Response, fallback: string): Promise<string> {
  const body: unknown = await res.json().catch(() => null);
  return typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
    ? (body as { error: string }).error
    : fallback;
}

export interface WorkItemDetailProps {
  item:      WorkItem;
  /** "YYYY-MM-DD" — `work.generated_at`, so the drawer agrees with every row about "today". */
  todayStr:  string;
  onClose:   () => void;
  /** Re-pulls the whole work payload after a successful write, so the row underneath — its
   *  `subtask_done`/`subtask_total` counts and its `link_count` included — agrees with what was
   *  just written. The shell wires this to the same `refreshWork` the edit dialog's `onSaved`
   *  gets. */
  onChanged: () => void | Promise<void>;
}

/**
 * The work-item detail drawer (§26): every field that would otherwise have to be crammed into
 * the main views gets a home here, so List/Table/Board can stay concise.
 *
 * **A right-hand drawer, not a centered modal — but the same dialog.** The container differs
 * (full-height panel pinned to the right edge rather than a centered card), and nothing else
 * does: the focus trap, the Escape handling, the backdrop click, the opener-focus restoration
 * and the `role="dialog"`/`aria-modal`/`aria-labelledby` wiring are `WorkItemDialog`'s, reused
 * line for line. A second modal implementation with its own keyboard behaviour would be a
 * regression in consistency, not a feature.
 *
 * **Read-mostly, with two exceptions.** Status is a real control here (the same `setWorkStage`
 * write, through the same endpoint routing, in the same tagged-optimistic shape `StatusCell`
 * uses) and the SUBTASKS section is fully editable. Everything else — title, priority, deadline,
 * time, estimate, notes — is displayed and edited through the edit dialog, which the row's
 * overflow "Edit" action still opens. The two entry points are complementary: the title opens
 * *this*, the overflow menu opens *that*.
 *
 * **The title is never editable here.** Renaming an owned item goes through the edit dialog;
 * an academic-sourced item cannot be renamed at all (its title lives in Study Pulse, and
 * `AcademicFieldSet` renders no title input for exactly that reason).
 *
 * **Nothing branches on `isAcademic`.** Subtasks and links attach to a polymorphic owner —
 * `item.source` *is* the `owner_kind` and `item.id` the `owner_id` — so both sections work
 * identically for an owned row and a Study Pulse one with no special case on either side of the
 * wire. Status keys off `item.context` generically, which is what gives an academic item its
 * five stages and a Life item its three without an `if` anywhere.
 *
 * Solid `#fbfbfd` rather than §11's glass recipe: it matches `WorkItemDialog` (the surface this
 * is a variant of), and — load-bearing — `backdrop-filter` on this panel would make it the
 * containing block for `position: fixed` descendants, which is precisely how `LinksPopover`
 * escapes scroll containers. A glass drawer would break the popover it hosts.
 */
export default function WorkItemDetail({ item, todayStr, onClose, onChanged }: WorkItemDetailProps) {
  const panelRef     = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLSelectElement>(null);
  const linksTriggerRef = useRef<HTMLButtonElement>(null);

  /* ─── Status ─────────────────────────────────────────────────────────────────────────── */
  const stage = stageOf(item);
  const [statusPending, setStatusPending] = useState(false);
  /** `StatusCell`'s tagged optimistic override: reconciliation is pure — once the refreshed
   *  payload arrives with a different `stage` the tag no longer matches and the override falls
   *  away on its own, with no frame in which the old value flashes back. */
  const [optimistic, setOptimistic] = useState<{ over: WorkStage; value: WorkStage } | null>(null);
  const shownStage = optimistic !== null && optimistic.over === stage ? optimistic.value : stage;
  const stages = STAGES_BY_CONTEXT[item.context] ?? FALLBACK_STAGES;
  // A stored stage outside its context's vocabulary is possible (free-form column; an item moved
  // between contexts by a hand-edit). A `<select>` whose `value` matches no `<option>` renders
  // the *first* one, which would report the item's status as something it is not — so the stray
  // value gets an option of its own, disabled, honest but unchoosable.
  const strayStage = stages.includes(shownStage) ? null : shownStage;

  /* ─── Subtasks ───────────────────────────────────────────────────────────────────────── */
  const [subtasks, setSubtasks]           = useState<Subtask[] | null>(null);
  const [subtaskStatus, setSubtaskStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [draftTitle, setDraftTitle]       = useState('');
  const [addError, setAddError]           = useState<string | null>(null);
  const [adding, setAdding]               = useState(false);
  /** Keyed by subtask id, exactly as `LinksPopover` keys its deletes: one row's write must not
   *  disable every other row's controls. */
  const [busyIds, setBusyIds]             = useState<ReadonlySet<number>>(() => new Set());

  /* ─── Links ──────────────────────────────────────────────────────────────────────────── */
  const links = useOwnerLinks(item.source, item.id);
  const [linksStatus, setLinksStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [linksOpen, setLinksOpen]     = useState(false);

  // Both loaders key on the owner pair, never on the `item` object: `onChanged` re-pulls the
  // whole work payload, so a *new* `WorkItem` object for the same row arrives after every
  // mutation. An effect keyed on identity would refetch on each of them.
  const ownerKind = item.source;
  const ownerId   = item.id;

  const loadSubtasks = useCallback(async (): Promise<boolean> => {
    setSubtaskStatus('loading');
    const query = `owner_kind=${encodeURIComponent(ownerKind)}&owner_id=${encodeURIComponent(String(ownerId))}`;
    // `.catch(() => null)` rather than a `try` around the body: only `fetch` itself rejecting is
    // a network failure. A 404 or a 500 is an answer, and gets the server's own words.
    const res = await fetch(`/api/workboard/subtasks?${query}`).catch(() => null);
    if (res === null || !res.ok) { setSubtaskStatus('error'); return false; }
    const parsed = parseSubtasks(await res.json().catch(() => null));
    if (parsed === null) { setSubtaskStatus('error'); return false; }
    setSubtasks(parsed);
    setSubtaskStatus('ready');
    return true;
  }, [ownerKind, ownerId]);

  useEffect(() => { void loadSubtasks(); }, [loadSubtasks]);

  /* The links list. The drawer shows it unprompted — unlike the Table, where it sits behind a
   * trigger — so the fetch fires on open. A failure is reported inline with a retry rather than
   * through `reportTableCellError`: an `alert` the instant a drawer opens would be an ambush,
   * and this is a read the user can simply retry. Every *mutation* still alerts (ruling: every
   * mutating action needs a visible failure path), which `LinksPopover` already does. */
  const loadLinks = useCallback(async () => {
    setLinksStatus('loading');
    const result = await loadOwnerLinks(ownerKind, ownerId, { force: true });
    setLinksStatus(result.ok ? 'ready' : 'error');
  }, [ownerKind, ownerId]);

  useEffect(() => { void loadLinks(); }, [loadLinks]);

  /* ─── The dialog mechanics, from `WorkItemDialog` ────────────────────────────────────── */

  useEffect(() => {
    // Restore focus to whatever opened this drawer (a row's or a table cell's title button) once
    // it closes — otherwise a keyboard user lands back on `document.body` and has to re-tab from
    // the top of the page.
    const opener = document.activeElement as HTMLElement | null;
    firstFieldRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
      // The opener can be gone by the time this runs (e.g. the row it belonged to was filtered
      // out by a search change while the drawer was open) — guard with `isConnected` rather than
      // letting a stale-element `.focus()` throw.
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  function handleBackdropMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const root = panelRef.current;
    if (!root) return;
    const focusables = Array.from(
      root.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'),
    ).filter(el => el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0];
    const last  = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  /* ─── Writes ─────────────────────────────────────────────────────────────────────────── */

  const handleStageChange = async (next: WorkStage) => {
    // Belt-and-braces behind `disabled={statusPending}`: a fast double change must not produce
    // two racing PATCHes whose responses land out of order.
    if (statusPending || next === shownStage) return;
    setOptimistic({ over: stage, value: next });
    setStatusPending(true);
    try {
      const res = await setWorkStage(item, next).catch(() => null);
      if (res === null) { setOptimistic(null); reportTableCellError(NETWORK_ERROR); return; }
      if (!res.ok) {
        // Revert AND say why. Both PATCH routes answer a rejected stage with a sentence naming
        // the offending value, which is far more use than a generic failure.
        setOptimistic(null);
        reportTableCellError(await messageFrom(res, STATUS_ERROR));
        return;
      }
      await onChanged();
    } finally {
      setStatusPending(false);
    }
  };

  /** Every subtask write ends the same way: re-read the list (the server owns ids and positions,
   *  neither of which can be guessed locally) and re-pull the work payload so the row underneath
   *  the drawer shows the new `subtask_done`/`subtask_total`. */
  const afterSubtaskWrite = async () => {
    if (!(await loadSubtasks())) { reportTableCellError(SUBTASK_LIST_ERROR); return; }
    await onChanged();
  };

  const addSubtask = async () => {
    if (adding) return;
    const title = draftTitle.trim();
    // Pre-flight only, and it mirrors the route's own rule. A validation message renders under
    // the field because it is about the field the user is looking at; a *request* that fails
    // goes to `reportTableCellError` like every other write in this module.
    if (title === '')       { setAddError('A title is required.'); return; }
    if (title.length > 255) { setAddError('Keep the subtask to 255 characters or fewer.'); return; }
    setAddError(null);

    setAdding(true);
    try {
      const res = await fetch('/api/workboard/subtasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // `source`/`id` *are* the owner pair — `LinkOwner['kind']` is exactly `WorkSource`, so an
        // academic item resolves through the academic path with no translation on either side.
        body: JSON.stringify({ owner_kind: ownerKind, owner_id: ownerId, title }),
      }).catch(() => null);
      if (res === null) { reportTableCellError(NETWORK_ERROR); return; }
      if (!res.ok) { reportTableCellError(await messageFrom(res, SUBTASK_ADD_ERROR)); return; }
      setDraftTitle('');
      await afterSubtaskWrite();
    } finally {
      setAdding(false);
    }
  };

  const toggleSubtask = async (subtask: Subtask) => {
    if (busyIds.has(subtask.id)) return;
    setBusyIds(current => new Set(current).add(subtask.id));
    try {
      const res = await fetch(`/api/workboard/subtasks/${subtask.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_done: !subtask.is_done }),
      }).catch(() => null);
      if (res === null) { reportTableCellError(NETWORK_ERROR); return; }
      if (!res.ok) { reportTableCellError(await messageFrom(res, SUBTASK_TOGGLE_ERROR)); return; }
      await afterSubtaskWrite();
    } finally {
      setBusyIds(current => {
        const next = new Set(current);
        next.delete(subtask.id);
        return next;
      });
    }
  };

  const removeSubtask = async (subtask: Subtask) => {
    if (busyIds.has(subtask.id)) return;
    setBusyIds(current => new Set(current).add(subtask.id));
    try {
      const res = await fetch(`/api/workboard/subtasks/${subtask.id}`, { method: 'DELETE' })
        .catch(() => null);
      if (res === null) { reportTableCellError(NETWORK_ERROR); return; }
      if (!res.ok) { reportTableCellError(await messageFrom(res, SUBTASK_DELETE_ERROR)); return; }
      await afterSubtaskWrite();
      // The row that held focus has just been removed from the DOM, which would otherwise drop
      // the user to `document.body` and restart the next Tab at the top of the page.
      panelRef.current?.focus();
    } finally {
      setBusyIds(current => {
        const next = new Set(current);
        next.delete(subtask.id);
        return next;
      });
    }
  };

  /* ─── Derived display values ─────────────────────────────────────────────────────────── */

  const dueState   = dueStateOf(item, todayStr);
  const dateLabel  = formatDeadline(item) ?? DASH;
  const timeLabel  = formatDeadlineTime(item);
  const estimate   = item.estimated_hours !== null ? `${item.estimated_hours}h` : DASH;
  const showing    = subtasks ?? [];
  const doneCount  = showing.filter(s => s.is_done).length;
  const shownLinks: readonly WorkLink[] = links ?? [];
  const linkCount  = links?.length ?? item.link_count;

  return (
    <div
      className="vb-detail-backdrop"
      onMouseDown={handleBackdropMouseDown}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(20,24,38,0.45)', zIndex: 1000,
        display: 'flex', alignItems: 'stretch', justifyContent: 'flex-end',
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="workItemDetailHeading"
        // Focusable so the panel can take focus back after a delete removes the row that had it.
        // -1 keeps it out of the sequential Tab order.
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="vb-detail-panel"
        style={{
          width: 'min(420px, 100%)', height: '100%', overflowY: 'auto', boxSizing: 'border-box',
          background: '#fbfbfd', borderLeft: '1px solid rgba(200,210,230,0.6)',
          boxShadow: '-20px 0 60px rgba(31,38,68,0.28)', padding: '22px',
          display: 'flex', flexDirection: 'column', gap: '18px', fontFamily: FONT,
        }}
      >
        {/* ── Header: title (read-only) and the hierarchy line ── */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px' }}>
          <div style={{ minWidth: 0 }}>
            <h2
              id="workItemDetailHeading"
              style={{
                margin: '0 0 4px', fontFamily: HEADER_FONT, fontSize: '1.05rem', fontWeight: 800,
                color: '#2d3748', lineHeight: 1.3, overflowWrap: 'anywhere',
              }}
            >
              {item.title}
            </h2>
            <p style={{ margin: 0, fontFamily: FONT, fontSize: '0.76rem', fontWeight: 600, color: '#5c6b80' }}>
              {hierarchyLine(item)}
            </p>
          </div>
          <button
            type="button"
            className="vb-detail-icon-btn"
            aria-label="Close details"
            onClick={onClose}
            style={{
              flex: '0 0 32px', width: '32px', height: '32px', display: 'inline-flex',
              alignItems: 'center', justifyContent: 'center', background: 'transparent',
              border: 'none', borderRadius: '8px', color: '#5c6b80', cursor: 'pointer', padding: 0,
            }}
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        {/* ── Status: the one always-live field control ── */}
        <div>
          <label htmlFor="vb-detail-status" style={{ ...SECTION_LABEL_STYLE, marginBottom: '6px' }}>
            Status
          </label>
          <select
            id="vb-detail-status"
            ref={firstFieldRef}
            className="vb-detail-control"
            value={shownStage}
            disabled={statusPending}
            onChange={e => { void handleStageChange(e.target.value as WorkStage); }}
            style={{
              ...CONTROL_STYLE, width: '100%', fontWeight: 600,
              cursor: statusPending ? 'progress' : 'pointer',
              // Opacity, not a colour swap: the UA's own disabled rendering greys the text below
              // §8's contrast floor, and this is a transient in-flight state.
              opacity: statusPending ? 0.65 : 1,
            }}
          >
            {strayStage !== null && (
              <option value={strayStage} disabled>{STAGE_LABELS[strayStage]}</option>
            )}
            {stages.map(s => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
          </select>
        </div>

        {/* ── Priority, deadline, time, estimate — read here, edited in the dialog ── */}
        <dl
          style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 14px', margin: 0,
          }}
        >
          <div>
            <dt style={SECTION_LABEL_STYLE}>Priority</dt>
            <dd style={{
              margin: '4px 0 0', fontFamily: FONT, fontSize: '0.84rem', fontWeight: 700,
              // §6's alert red for High, §1's meta colour otherwise — and the word still reads
              // "High", so colour carries nothing on its own.
              color: item.priority === 'high' ? '#922e48' : '#2d3748',
            }}>
              {PRIORITY_LABEL[item.priority] ?? item.priority}
            </dd>
          </div>
          <div>
            <dt style={SECTION_LABEL_STYLE}>Deadline</dt>
            <dd style={{
              margin: '4px 0 0', fontFamily: FONT, fontSize: '0.84rem', fontWeight: 700,
              color: DUE_COLOR[dueState],
            }}>
              {dateLabel}
              {/* Without this the lateness would be carried by the colour alone. */}
              <span style={VISUALLY_HIDDEN}>
                {dateLabel === DASH ? ' No deadline set.' : (DUE_SR_SUFFIX[dueState] ?? '')}
              </span>
            </dd>
          </div>
          <div>
            <dt style={SECTION_LABEL_STYLE}>Deadline time</dt>
            <dd style={{ margin: '4px 0 0', fontFamily: FONT, fontSize: '0.84rem', fontWeight: 700, color: '#2d3748' }}>
              {timeLabel}
              <span style={VISUALLY_HIDDEN}>{timeLabel === DASH ? ' No time set.' : ''}</span>
            </dd>
          </div>
          <div>
            <dt style={SECTION_LABEL_STYLE}>Estimate</dt>
            <dd style={{ margin: '4px 0 0', fontFamily: FONT, fontSize: '0.84rem', fontWeight: 700, color: '#2d3748' }}>
              {estimate}
              <span style={VISUALLY_HIDDEN}>{estimate === DASH ? ' No estimate set.' : ''}</span>
            </dd>
          </div>
        </dl>

        {/* ── SUBTASKS ── */}
        <section aria-labelledby="vb-detail-subtasks-heading" style={{ borderTop: '1px solid rgba(200,210,230,0.5)', paddingTop: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px', marginBottom: '8px' }}>
            <h3 id="vb-detail-subtasks-heading" style={{ ...SECTION_LABEL_STYLE, margin: 0 }}>Subtasks</h3>
            {/* The progress count reads off the *live* list rather than the payload's
                `subtask_done`/`subtask_total`, which are a snapshot taken before this drawer's
                own writes. The payload's pair is what the row underneath shows, and `onChanged`
                is what keeps the two in step. */}
            {subtaskStatus === 'ready' && showing.length > 0 && (
              <span style={{ fontFamily: FONT, fontSize: '0.74rem', fontWeight: 600, color: '#5c6b80' }}>
                {doneCount} of {showing.length} done
              </span>
            )}
          </div>

          {subtaskStatus === 'loading' && <p style={NOTE_STYLE}>Loading subtasks…</p>}

          {subtaskStatus === 'error' && (
            <div>
              <p style={{ ...NOTE_STYLE, color: '#922e48' }}>Could not load the subtasks.</p>
              <button
                type="button"
                className="vb-detail-btn"
                onClick={() => { void loadSubtasks(); }}
                style={SECONDARY_BUTTON_STYLE}
              >
                Try again
              </button>
            </div>
          )}

          {subtaskStatus === 'ready' && showing.length === 0 && <p style={NOTE_STYLE}>No subtasks yet.</p>}

          {showing.length > 0 && (
            <ul style={{ listStyle: 'none', margin: '0 0 10px', padding: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {showing.map(subtask => {
                const busy = busyIds.has(subtask.id);
                return (
                  <li key={subtask.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', minHeight: '32px' }}>
                    <input
                      type="checkbox"
                      className="vb-detail-checkbox"
                      checked={subtask.is_done}
                      disabled={busy}
                      onChange={() => { void toggleSubtask(subtask); }}
                      aria-label={subtask.is_done
                        ? `Mark "${subtask.title}" as not done`
                        : `Mark "${subtask.title}" as done`}
                      style={{
                        flexShrink: 0, width: '17px', height: '17px', accentColor: '#256f92',
                        cursor: busy ? 'progress' : 'pointer',
                      }}
                    />
                    <span style={{
                      flex: 1, minWidth: 0, fontFamily: FONT, fontSize: '0.82rem', fontWeight: 500,
                      color: subtask.is_done ? '#9aa4b5' : '#2d3748',
                      textDecoration: subtask.is_done ? 'line-through' : 'none',
                      overflowWrap: 'anywhere',
                    }}>
                      {subtask.title}
                    </span>
                    <button
                      type="button"
                      className="vb-detail-icon-btn"
                      aria-label={`Remove subtask "${subtask.title}"`}
                      disabled={busy}
                      onClick={() => { void removeSubtask(subtask); }}
                      style={{ ...ICON_BUTTON_STYLE, cursor: busy ? 'progress' : 'pointer', opacity: busy ? 0.55 : 1 }}
                    >
                      <Trash2 size={13} aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <form
            onSubmit={e => { e.preventDefault(); void addSubtask(); }}
            style={{ display: 'flex', gap: '6px', alignItems: 'flex-start' }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <label htmlFor="vb-detail-subtask-input" style={VISUALLY_HIDDEN}>
                {`New subtask for "${item.title}"`}
              </label>
              <input
                id="vb-detail-subtask-input"
                className="vb-detail-control"
                value={draftTitle}
                maxLength={255}
                placeholder="Add a subtask…"
                aria-describedby={addError === null ? undefined : 'vb-detail-subtask-error'}
                onChange={e => setDraftTitle(e.target.value)}
                style={{ ...CONTROL_STYLE, width: '100%' }}
              />
            </div>
            <button
              type="submit"
              className="vb-detail-btn"
              disabled={adding}
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '5px',
                flexShrink: 0, minHeight: '32px', padding: '6px 12px', borderRadius: '10px',
                background: '#2a7fa8', border: '1px solid #2a7fa8', fontFamily: FONT,
                fontSize: '0.78rem', fontWeight: 700, color: '#fff',
                cursor: adding ? 'progress' : 'pointer', opacity: adding ? 0.7 : 1,
              }}
            >
              <Plus size={13} aria-hidden />
              {adding ? 'Adding…' : 'Add'}
            </button>
          </form>

          {addError !== null && (
            // `role="alert"` so a screen-reader user hears the reason their submit did nothing.
            <p id="vb-detail-subtask-error" role="alert" style={{ ...NOTE_STYLE, marginTop: '6px', color: '#922e48' }}>
              {addError}
            </p>
          )}
        </section>

        {/* ── LINKS ── */}
        <section aria-labelledby="vb-detail-links-heading" style={{ borderTop: '1px solid rgba(200,210,230,0.5)', paddingTop: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '8px' }}>
            <h3 id="vb-detail-links-heading" style={{ ...SECTION_LABEL_STYLE, margin: 0 }}>Links</h3>
            {/* The editor, not a second implementation of it. `LinksPopover` is a `position:
                fixed` `role="dialog"` panel — it cannot be embedded inline — so the drawer shows
                the list itself and opens the shipped popover for every add and delete, exactly
                as `LinksCell` and the Table's phone card do. */}
            <div style={{ position: 'relative', display: 'inline-flex' }}>
              <button
                ref={linksTriggerRef}
                type="button"
                className="vb-detail-btn"
                aria-haspopup="dialog"
                aria-expanded={linksOpen}
                onClick={() => setLinksOpen(current => !current)}
                style={SECONDARY_BUTTON_STYLE}
              >
                <Link2 size={12} aria-hidden style={{ flexShrink: 0, opacity: 0.75 }} />
                Edit
                <span style={VISUALLY_HIDDEN}>{` links for "${item.title}".`}</span>
              </button>
              {linksOpen && (
                <LinksPopover
                  ownerKind={ownerKind}
                  ownerId={ownerId}
                  title={item.title}
                  linkCount={linkCount}
                  triggerRef={linksTriggerRef}
                  onClose={() => setLinksOpen(false)}
                  onChanged={onChanged}
                />
              )}
            </div>
          </div>

          {linksStatus === 'loading' && shownLinks.length === 0 && <p style={NOTE_STYLE}>Loading links…</p>}

          {linksStatus === 'error' && (
            <div>
              <p style={{ ...NOTE_STYLE, color: '#922e48' }}>Could not load the links.</p>
              <button
                type="button"
                className="vb-detail-btn"
                onClick={() => { void loadLinks(); }}
                style={SECONDARY_BUTTON_STYLE}
              >
                Try again
              </button>
            </div>
          )}

          {linksStatus === 'ready' && shownLinks.length === 0 && <p style={NOTE_STYLE}>No links yet.</p>}

          {shownLinks.length > 0 && (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {shownLinks.map(link => {
                const { label: typeLabel, Icon } = linkTypeMeta(link.link_type);
                return (
                  <li key={link.id} style={{ display: 'flex', alignItems: 'center' }}>
                    <a
                      className="vb-detail-link"
                      href={link.url}
                      // `noreferrer` as well as `noopener`: `noopener` alone stops the new tab
                      // reaching `window.opener`, but the referrer header would still hand the
                      // destination the URL of the page the student was on.
                      target="_blank"
                      rel="noopener noreferrer"
                      // The full URL lives here and in `href` — never as the link's visible
                      // primary text (§10).
                      title={link.url}
                      style={{
                        flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '7px',
                        minHeight: '32px', padding: '4px 6px', borderRadius: '8px',
                        textDecoration: 'none', color: '#2d3748',
                      }}
                    >
                      <Icon size={14} aria-hidden style={{ flexShrink: 0, color: '#5c6b80' }} />
                      <span style={{
                        flex: 1, minWidth: 0, fontFamily: FONT, fontSize: '0.82rem', fontWeight: 600,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {link.label}
                      </span>
                      {/* Part of the link's accessible name, not a stray string beside it: a
                          screen-reader user hears "Canvas, Canvas link, opens in a new tab". */}
                      <span style={VISUALLY_HIDDEN}>{` ${typeLabel} link, opens in a new tab.`}</span>
                      <ExternalLink size={12} aria-hidden style={{ flexShrink: 0, color: '#9aa4b5' }} />
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* ── NOTES ── */}
        <section aria-labelledby="vb-detail-note-heading" style={{ borderTop: '1px solid rgba(200,210,230,0.5)', paddingTop: '14px' }}>
          <h3 id="vb-detail-note-heading" style={{ ...SECTION_LABEL_STYLE, marginBottom: '6px' }}>Notes</h3>
          {item.note === null || item.note.trim() === '' ? (
            <p style={NOTE_STYLE}>No notes yet.</p>
          ) : (
            // `pre-wrap`: a note is typed into a `<textarea>`, so the line breaks the user put in
            // are part of what they wrote and must survive the round trip to this panel.
            <p style={{ ...NOTE_STYLE, whiteSpace: 'pre-wrap', color: '#2d3748', overflowWrap: 'anywhere' }}>
              {item.note}
            </p>
          )}
        </section>

        {/* A dead-end marker for the eye, not for a screen reader: the drawer ends here and the
            rest of the item is edited elsewhere. */}
        <p style={{ ...NOTE_STYLE, display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.72rem' }}>
          <Check size={12} aria-hidden style={{ flexShrink: 0, opacity: 0.7 }} />
          Title, deadline and the rest are edited from the row’s Edit action.
        </p>
      </div>

      {/* These rules MUST live in the component that renders their target elements. Each
          component gets its own styled-jsx scope hash, so a `.vb-detail-control` rule written in
          `WorkboardShell` would compile cleanly and match nothing — the trap several tasks in
          this plan have hit. */}
      <style jsx>{`
        /* §9's ring, on the darker blue. :focus-visible so a mouse click does not leave a ring
           nobody asked for, while keyboard arrival always does. */
        .vb-detail-control:focus-visible,
        .vb-detail-btn:focus-visible,
        .vb-detail-icon-btn:focus-visible,
        .vb-detail-link:focus-visible,
        .vb-detail-checkbox:focus-visible,
        .vb-detail-panel:focus-visible {
          outline: 2px solid #2a7fa8;
          outline-offset: 2px;
          border-radius: inherit;
        }
        .vb-detail-control:hover:not(:disabled),
        .vb-detail-icon-btn:hover:not(:disabled) {
          border-color: rgba(140,160,190,0.75);
        }
        .vb-detail-btn:hover:not(:disabled) {
          filter: brightness(0.97);
        }
        /* Underline on hover as well as the background shift: "it is a link" must not be carried
           by colour or background alone. */
        .vb-detail-link:hover {
          background: rgba(116,188,217,0.14);
          text-decoration: underline;
        }
      `}</style>
    </div>
  );
}

/** 26×26 clears the WCAG 2.2 Target Size (Minimum) floor of 24px with a little margin — the same
 *  bar, and the same size, `LinksPopover`'s per-row controls use. */
const ICON_BUTTON_STYLE: React.CSSProperties = {
  flex: '0 0 26px', width: '26px', height: '26px', display: 'inline-flex',
  alignItems: 'center', justifyContent: 'center', borderRadius: '8px',
  background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(200,210,230,0.6)',
  color: '#5c6b80', cursor: 'pointer', padding: 0,
};

const SECONDARY_BUTTON_STYLE: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: '5px',
  minHeight: '30px', padding: '6px 12px', borderRadius: '8px',
  background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(200,210,230,0.6)',
  fontFamily: FONT, fontSize: '0.76rem', fontWeight: 600, color: '#5c6b80',
  cursor: 'pointer',
};
