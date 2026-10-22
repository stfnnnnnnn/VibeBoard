'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, Link2, Pencil, Plus, Trash2, X } from 'lucide-react';
// Type-only imports from three modules that reach `pool` (mysql2) at module scope. `import type`
// is erased entirely by TypeScript, so no driver reaches this client bundle. A *value* import
// from any of the three would 500 the page.
import type { WorkItem } from '@/lib/workboard/workItems';
import type { Subtask } from '@/lib/workboard/subtasks';
import type { WorkLink } from '@/lib/workboard/links';
// Pool-free by construction, so these are safe as runtime imports from a client component.
import {
  CONTEXT_LABELS, LIFE_AREA_LABELS, STAGES_BY_CONTEXT, STAGE_LABELS, isWaitingStage, waitingLabel,
  type WorkStage,
} from '@/lib/workboard/workContexts';
import { daysSince } from '@/lib/workboard/dates';
// `setWorkStage` is the single place owned-vs-academic endpoint routing lives. Imported, never
// re-derived — this drawer must not know that academic items patch a different route.
import { setWorkStage } from './WorkItemRow';
import { patchItem } from './workApi';
import { messageFrom, offerStageUndo, reportStageFailure, waitingPrompt } from './stageChange';
// Deadline wording for the whole module, reused so the drawer cannot word a date differently
// from the row underneath it.
import { dueStateOf, formatDeadline, formatDeadlineTime } from '@/lib/workboard/dueSemantics';
import { DUE_ACCENT, DUE_SR_SUFFIX } from '@/lib/workboard/ui/dueColors';
// The links editor, plus the shared owner-links store `LinksCell` and the phone card both read.
// The LINKS section renders that store's contents as a plain inline list and hands every
// *mutation* to this same popover — nothing about add/delete is re-implemented here.
import LinksPopover, { linkTypeMeta, loadOwnerLinks, useOwnerLinks } from './LinksPopover';
import { reportTableCellError } from './table/tableCellError';
import WbOverlay from './ui/WbOverlay';
import WbCheckbox from './ui/WbCheckbox';
import WaitingPopover from './ui/WaitingPopover';
import { toastError } from './ui/WbToaster';
import { contextChip } from './views/FocusRow';

const DASH = '—';

const NETWORK_ERROR        = 'Could not reach the server. Check your connection and try again.';
const STATUS_ERROR         = 'Could not change the status. Please try again.';
const SUBTASK_LIST_ERROR   = 'Could not load the subtasks. Please try again.';
const SUBTASK_ADD_ERROR    = 'Could not add the subtask. Please try again.';
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

/** The 11px uppercase 800-weight micro-label: this drawer's section headings. */
const SECTION_LABEL_STYLE: React.CSSProperties = {
  display: 'block', font: '800 var(--wb-fs-11) var(--wb-font-ui)',
  letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--wb-text-muted)',
};

const CONTROL_STYLE: React.CSSProperties = {
  boxSizing: 'border-box', minHeight: '32px', borderRadius: 'var(--wb-r-md)',
  padding: '5px 9px', background: 'var(--wb-surface)',
  border: '1px solid var(--wb-border)', font: '500 var(--wb-fs-13) var(--wb-font-ui)',
  color: 'var(--wb-text)',
};

const NOTE_STYLE: React.CSSProperties = {
  margin: 0, font: '500 var(--wb-fs-13) var(--wb-font-ui)',
  color: 'var(--wb-text-muted)', lineHeight: 1.45,
};

const DT_STYLE: React.CSSProperties = {
  margin: 0, font: '600 var(--wb-fs-12) var(--wb-font-ui)', color: 'var(--wb-text-muted)',
  alignSelf: 'center',
};

const DD_STYLE: React.CSSProperties = {
  margin: 0, minWidth: 0, font: '500 var(--wb-fs-13) var(--wb-font-ui)', color: 'var(--wb-text)',
  overflowWrap: 'anywhere',
};

const SECTION_STYLE: React.CSSProperties = {
  borderTop: '1px solid var(--wb-hairline)', paddingTop: '14px',
};

/** `work_stage` is stored in a free-form VARCHAR, so the type is a compile-time assertion over
 *  DB text. Falling back to `work_status` keeps an unrecognised stage showing a real label;
 *  every `WorkStatus` is itself a legal stage in every context. `StatusCell`'s helper. */
function stageOf(item: WorkItem): WorkStage {
  const raw: string = item.work_stage;
  return raw in STAGE_LABELS ? (raw as WorkStage) : item.work_status;
}

/** `StatusCell`'s `FALLBACK_STAGES`: legal in every context, so a legacy row whose context
 *  misses the vocabulary lookup still gets a usable select. */
const FALLBACK_STAGES: readonly WorkStage[] = ['todo', 'in_progress', 'done'];

/** The context-dependent "where does this live" row: Course for Academic, Organization,
 *  Area for Life, Project otherwise. */
function placeRow(item: WorkItem): { label: string; value: string | null } {
  switch (item.context) {
    case 'academic':     return { label: 'Course', value: item.course_code };
    case 'organization': return { label: 'Organization', value: item.organization_name };
    case 'life':         return { label: 'Area', value: item.life_area ? (LIFE_AREA_LABELS[item.life_area] ?? item.life_area) : null };
    default:             return { label: 'Project', value: item.project_name };
  }
}

/** The server's answer, validated rather than trusted: a shape mismatch must read as a failed
 *  load, not as a render-time crash inside a `.map`. */
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
      // A `1` off an older deployment must still read as done.
      is_done:  row.is_done === true || row.is_done === 1,
      position: typeof row.position === 'number' ? row.position : 0,
    });
  }
  return parsed;
}

export interface WorkItemDetailProps {
  /** Drives the overlay's enter/exit; the shell keeps the drawer mounted through the exit via
   *  `usePresence`. */
  open:      boolean;
  /** Opened from the keyboard: no enter animation (spec 4.3). */
  instant?:  boolean;
  item:      WorkItem;
  /** "YYYY-MM-DD" — `work.generated_at`, so the drawer agrees with every row about "today". */
  todayStr:  string;
  onClose:   () => void;
  /** Re-pulls the whole work payload after a successful write, so the row underneath agrees
   *  with what was just written. */
  onChanged: () => void | Promise<void>;
  /** Owned items only: the shell's deferred delete (hide, Undo toast, DELETE on expiry). */
  onDelete?: (item: WorkItem) => void;
  /** Opens the full edit dialog for this item; the drawer closes itself first. */
  onEdit?:   (item: WorkItem) => void;
}

type WaitingAsk = { mode: 'move'; next: WorkStage } | { mode: 'edit' };

/**
 * The work-item detail drawer (spec 10.2) on `WbOverlay`'s `drawer` variant: a right-hand panel
 * at 768px and up, a bottom sheet below. The overlay owns the focus trap, Esc, the scrim and
 * opener-focus restoration.
 *
 * Owned items get an inline-editable title and a Delete button. Academic (Study Pulse) items
 * show a plain title — Study Pulse owns it — and cannot be deleted here. Subtasks and links
 * attach to a polymorphic owner (`item.source` is the `owner_kind`), so both sections work for
 * either source without a special case.
 */
export default function WorkItemDetail({ open, instant = false, item, todayStr, onClose, onChanged, onDelete, onEdit }: WorkItemDetailProps) {
  const statusRef       = useRef<HTMLSelectElement>(null);
  const closeRef        = useRef<HTMLButtonElement>(null);
  const linksTriggerRef = useRef<HTMLButtonElement>(null);
  const reasonEditRef   = useRef<HTMLButtonElement>(null);

  const isOwned = item.source === 'owned';

  /* ─── Title ──────────────────────────────────────────────────────────────────────────── */
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  /** Tagged like the status override: once the refreshed payload carries a different title the
   *  tag no longer matches and the override falls away. */
  const [titleOverride, setTitleOverride] = useState<{ over: string; value: string } | null>(null);
  const shownTitle = titleOverride !== null && titleOverride.over === item.title ? titleOverride.value : item.title;

  const commitTitle = async () => {
    if (titleDraft === null) return;
    const next = titleDraft.trim();
    setTitleDraft(null);
    if (next === '' || next === shownTitle) return;
    setTitleOverride({ over: item.title, value: next });
    const res = await patchItem(item, { title: next }).catch(() => null);
    if (!res || !res.ok) {
      setTitleOverride(null);
      toastError(res ? await messageFrom(res, `Couldn't rename "${item.title}"`) : NETWORK_ERROR);
      return;
    }
    await onChanged();
  };

  /* ─── Status ─────────────────────────────────────────────────────────────────────────── */
  const stage = stageOf(item);
  const [statusPending, setStatusPending] = useState(false);
  // A browser blurs an element the instant it disables; restore focus to the select once the
  // request settles if it held focus when it disabled, so Esc and Tab keep working.
  const statusWasFocused = useRef(false);
  useEffect(() => {
    if (!statusPending && statusWasFocused.current) {
      statusRef.current?.focus();
      statusWasFocused.current = false;
    }
  }, [statusPending]);
  /** `StatusCell`'s tagged optimistic override. */
  const [optimistic, setOptimistic] = useState<{ over: WorkStage; value: WorkStage } | null>(null);
  const shownStage = optimistic !== null && optimistic.over === stage ? optimistic.value : stage;
  const stages = STAGES_BY_CONTEXT[item.context] ?? FALLBACK_STAGES;
  // A stored stage outside its context's vocabulary gets a disabled option of its own, so the
  // select never reports the item's status as its first option instead.
  const strayStage = stages.includes(shownStage) ? null : shownStage;

  /** A move into a waiting stage, or an edit of the reason, waiting on the popover. */
  const [waitingAsk, setWaitingAsk] = useState<WaitingAsk | null>(null);

  /* ─── Subtasks ───────────────────────────────────────────────────────────────────────── */
  const [subtasks, setSubtasks]           = useState<Subtask[] | null>(null);
  const [subtaskStatus, setSubtaskStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [draftTitle, setDraftTitle]       = useState('');
  const [addError, setAddError]           = useState<string | null>(null);
  const [adding, setAdding]               = useState(false);
  /** Keyed by subtask id: one row's write must not disable every other row's controls. */
  const [busyIds, setBusyIds]             = useState<ReadonlySet<number>>(() => new Set());

  /* ─── Links ──────────────────────────────────────────────────────────────────────────── */
  const links = useOwnerLinks(item.source, item.id);
  const [linksStatus, setLinksStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [linksOpen, setLinksOpen]     = useState(false);

  // Loaders key on the owner pair, never on the `item` object: every refresh hands over a new
  // `WorkItem` for the same row, and an identity-keyed effect would refetch on each.
  const ownerKind = item.source;
  const ownerId   = item.id;

  const loadSubtasks = useCallback(async (): Promise<boolean> => {
    setSubtaskStatus('loading');
    const query = `owner_kind=${encodeURIComponent(ownerKind)}&owner_id=${encodeURIComponent(String(ownerId))}`;
    const res = await fetch(`/api/workboard/subtasks?${query}`).catch(() => null);
    if (res === null || !res.ok) { setSubtaskStatus('error'); return false; }
    const parsed = parseSubtasks(await res.json().catch(() => null));
    if (parsed === null) { setSubtaskStatus('error'); return false; }
    setSubtasks(parsed);
    setSubtaskStatus('ready');
    return true;
  }, [ownerKind, ownerId]);

  useEffect(() => { void loadSubtasks(); }, [loadSubtasks]);

  /* Shown unprompted, so the fetch fires on open. A failed read is reported inline with a retry
   * rather than toasted the instant the drawer opens; mutations report through `LinksPopover`'s
   * error toast. */
  const loadLinks = useCallback(async () => {
    setLinksStatus('loading');
    const result = await loadOwnerLinks(ownerKind, ownerId, { force: true });
    setLinksStatus(result.ok ? 'ready' : 'error');
  }, [ownerKind, ownerId]);

  useEffect(() => { void loadLinks(); }, [loadLinks]);

  /* ─── Writes ─────────────────────────────────────────────────────────────────────────── */

  const commitStage = async (next: WorkStage, reason?: string | null) => {
    // Belt-and-braces behind `disabled={statusPending}`: no two racing PATCHes.
    if (statusPending || next === shownStage) return;
    statusWasFocused.current = document.activeElement === statusRef.current;
    setOptimistic({ over: stage, value: next });
    setStatusPending(true);
    try {
      const prev = stage;
      const prevReason = item.blocked_reason;
      const res = await setWorkStage(item, next, reason).catch(() => null);
      if (res === null || !res.ok) {
        // Revert AND say why. A 4xx gets the server's reason and no Retry (`reportStageFailure`).
        setOptimistic(null);
        await reportStageFailure(res, {
          fallback: STATUS_ERROR, network: NETWORK_ERROR,
          retry: () => commitStage(next, reason), report: reportTableCellError,
        });
        return;
      }
      await onChanged();
      // The override is tagged with `prev`, so it would match again once Undo restores it.
      offerStageUndo(item, prev, prevReason, next, onChanged, {
        report: reportTableCellError, beforeUndo: () => setOptimistic(null),
      });
    } finally {
      setStatusPending(false);
    }
  };

  const handleStageChange = (next: WorkStage) => {
    if (statusPending || next === shownStage) return;
    // Waiting stages ask for their reason first (spec 10.3); cancelling cancels the move.
    if (isWaitingStage(next)) { setWaitingAsk({ mode: 'move', next }); return; }
    void commitStage(next);
  };

  const saveReason = async (reason: string | null) => {
    const res = await patchItem(item, { blocked_reason: reason }).catch(() => null);
    if (!res || !res.ok) {
      toastError(res ? await messageFrom(res, `Couldn't save the reason for "${item.title}"`) : NETWORK_ERROR);
      return;
    }
    await onChanged();
  };

  /** Re-read the list (the server owns ids and positions) and re-pull the work payload so the
   *  row underneath shows the new counts. */
  const afterSubtaskWrite = async () => {
    if (!(await loadSubtasks())) { reportTableCellError(SUBTASK_LIST_ERROR, afterSubtaskWrite); return; }
    await onChanged();
  };

  /** A disabled control blurs to `document.body`, which sits outside the overlay's trap; land
   *  focus somewhere safe inside the drawer instead. */
  const refocusIfLost = () => {
    if (document.activeElement === document.body) closeRef.current?.focus();
  };

  const addSubtask = async () => {
    if (adding) return;
    const title = draftTitle.trim();
    if (title === '')       { setAddError('A title is required.'); return; }
    if (title.length > 255) { setAddError('Keep the subtask to 255 characters or fewer.'); return; }
    setAddError(null);

    setAdding(true);
    try {
      const res = await fetch('/api/workboard/subtasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner_kind: ownerKind, owner_id: ownerId, title }),
      }).catch(() => null);
      if (res === null) { reportTableCellError(NETWORK_ERROR, addSubtask); return; }
      if (!res.ok) { reportTableCellError(await messageFrom(res, SUBTASK_ADD_ERROR), addSubtask); return; }
      setDraftTitle('');
      await afterSubtaskWrite();
    } finally {
      setAdding(false);
      refocusIfLost();
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
      if (res === null) { reportTableCellError(NETWORK_ERROR, () => toggleSubtask(subtask)); return; }
      if (!res.ok) { reportTableCellError(await messageFrom(res, SUBTASK_TOGGLE_ERROR), () => toggleSubtask(subtask)); return; }
      await afterSubtaskWrite();
    } finally {
      setBusyIds(current => {
        const next = new Set(current);
        next.delete(subtask.id);
        return next;
      });
      refocusIfLost();
    }
  };

  const removeSubtask = async (subtask: Subtask) => {
    if (busyIds.has(subtask.id)) return;
    setBusyIds(current => new Set(current).add(subtask.id));
    try {
      const res = await fetch(`/api/workboard/subtasks/${subtask.id}`, { method: 'DELETE' })
        .catch(() => null);
      if (res === null) { reportTableCellError(NETWORK_ERROR, () => removeSubtask(subtask)); return; }
      if (!res.ok) { reportTableCellError(await messageFrom(res, SUBTASK_DELETE_ERROR), () => removeSubtask(subtask)); return; }
      await afterSubtaskWrite();
    } finally {
      setBusyIds(current => {
        const next = new Set(current);
        next.delete(subtask.id);
        return next;
      });
      refocusIfLost();
    }
  };

  /* ─── Derived display values ─────────────────────────────────────────────────────────── */

  const chip       = contextChip(item);
  const place      = placeRow(item);
  const dueState   = dueStateOf(item, todayStr);
  const dateLabel  = formatDeadline(item);
  const timeLabel  = formatDeadlineTime(item);
  const deadline   = dateLabel === null ? null : timeLabel === DASH ? dateLabel : `${dateLabel} · ${timeLabel}`;
  const estimate   = item.estimated_hours !== null ? `${Number(item.estimated_hours)}h` : null;
  const waitingText = item.blocked_since === null
    ? null
    : `${waitingLabel(stage, item.blocked_reason)} · ${daysSince(item.blocked_since, todayStr)}d`;
  const showing    = subtasks ?? [];
  const doneCount  = showing.filter(s => s.is_done).length;
  const shownLinks: readonly WorkLink[] = links ?? [];
  const linkCount  = links?.length ?? item.link_count;

  const revisionAsk = waitingAsk !== null && (waitingAsk.mode === 'move' ? waitingAsk.next === 'submitted' : stage === 'submitted');
  const waitingAnchor = waitingAsk?.mode === 'edit' ? reasonEditRef.current : statusRef.current;

  return (
    <WbOverlay
      open={open}
      instant={instant}
      onClose={onClose}
      variant="drawer"
      labelledBy="vb-detail-title"
      initialFocusRef={statusRef}
      panelStyle={{ padding: 20 }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* ── Header: title, close, status ── */}
        <div>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px' }}>
            {isOwned ? (
              <input
                id="vb-detail-title"
                aria-label="Title"
                className="vb-detail-title"
                value={titleDraft ?? shownTitle}
                maxLength={255}
                onFocus={() => setTitleDraft(current => current ?? shownTitle)}
                onChange={e => setTitleDraft(e.target.value)}
                onBlur={() => { void commitTitle(); }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    // Enter that confirms an IME composition is not a commit.
                    if (e.nativeEvent.isComposing) return;
                    e.preventDefault();
                    e.currentTarget.blur();
                  } else if (e.key === 'Escape' && titleDraft !== null && titleDraft !== shownTitle) {
                    // First Esc reverts an edit; an unedited title lets Esc close the drawer.
                    e.stopPropagation();
                    setTitleDraft(shownTitle);
                  }
                }}
              />
            ) : (
              <h2
                id="vb-detail-title"
                style={{
                  flex: 1, minWidth: 0, margin: 0, padding: '2px 0',
                  font: '800 var(--wb-fs-20) var(--wb-font-head)', color: 'var(--wb-text)',
                  lineHeight: 1.3, overflowWrap: 'anywhere',
                }}
              >
                {item.title}
              </h2>
            )}
            <button
              ref={closeRef}
              type="button"
              className="vb-detail-icon-btn wb-focus-ring"
              aria-label="Close details"
              onClick={onClose}
              style={{ ...ICON_BUTTON_STYLE, flex: '0 0 32px', width: '32px', height: '32px', border: 'none', background: 'transparent' }}
            >
              <X size={18} aria-hidden />
            </button>
          </div>

          <select
            ref={statusRef}
            aria-label="Status"
            className="vb-detail-status"
            value={shownStage}
            disabled={statusPending}
            onChange={e => handleStageChange(e.target.value as WorkStage)}
            style={{
              marginTop: '6px',
              cursor: statusPending ? 'progress' : 'pointer',
              // Opacity, not a colour swap: the UA's disabled text falls below contrast.
              opacity: statusPending ? 0.65 : 1,
            }}
          >
            {strayStage !== null && (
              <option value={strayStage} disabled>{STAGE_LABELS[strayStage]}</option>
            )}
            {stages.map(s => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
          </select>
        </div>

        {/* ── Properties ── */}
        <dl style={{ display: 'grid', gridTemplateColumns: '96px 1fr', rowGap: 10, columnGap: 12, margin: 0 }}>
          <dt style={DT_STYLE}>Context</dt>
          <dd style={{ ...DD_STYLE, display: 'flex', alignItems: 'center', gap: '7px' }}>
            <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: chip.fill }} />
            {CONTEXT_LABELS[item.context] ?? item.context}
          </dd>

          <dt style={DT_STYLE}>{place.label}</dt>
          <dd style={DD_STYLE}>{place.value || DASH}</dd>

          {item.context !== 'project' && item.project_name && (
            <>
              <dt style={DT_STYLE}>Project</dt>
              <dd style={DD_STYLE}>{item.project_name}</dd>
            </>
          )}

          <dt style={DT_STYLE}>Priority</dt>
          <dd style={{
            ...DD_STYLE,
            // The word still reads "High", so colour carries nothing on its own.
            color: item.priority === 'high' ? 'var(--wb-danger)' : 'var(--wb-text)',
            fontWeight: item.priority === 'high' ? 700 : 500,
          }}>
            {PRIORITY_LABEL[item.priority] ?? item.priority}
          </dd>

          <dt style={DT_STYLE}>Deadline</dt>
          <dd style={{ ...DD_STYLE, color: DUE_ACCENT[dueState] ?? 'var(--wb-text)' }}>
            {deadline ?? DASH}
            <span style={VISUALLY_HIDDEN}>
              {deadline === null ? ' No deadline set.' : (DUE_SR_SUFFIX[dueState] ?? '')}
            </span>
          </dd>

          <dt style={DT_STYLE}>Estimate</dt>
          <dd style={DD_STYLE}>
            {estimate ?? DASH}
            <span style={VISUALLY_HIDDEN}>{estimate === null ? ' No estimate set.' : ''}</span>
          </dd>

          {waitingText !== null && (
            <>
              <dt style={DT_STYLE}>Waiting</dt>
              <dd style={{ ...DD_STYLE, display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--wb-warn)' }}>
                <span style={{ flex: 1, minWidth: 0 }}>{waitingText}</span>
                <button
                  ref={reasonEditRef}
                  type="button"
                  className="wb-add-trigger wb-focus-ring"
                  onClick={() => setWaitingAsk({ mode: 'edit' })}
                >
                  Edit
                  <span style={VISUALLY_HIDDEN}>{` waiting reason for "${item.title}"`}</span>
                </button>
              </dd>
            </>
          )}
        </dl>

        {/* ── LINKS ── */}
        <section aria-labelledby="vb-detail-links-heading" style={SECTION_STYLE}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '8px' }}>
            <h3 id="vb-detail-links-heading" style={{ ...SECTION_LABEL_STYLE, margin: 0 }}>Links</h3>
            {/* The editor, not a second implementation of it: every add and delete goes through
                the same popover `LinksCell` and the Table's phone card open. */}
            <button
              ref={linksTriggerRef}
              type="button"
              className="vb-detail-btn wb-focus-ring"
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

          {linksStatus === 'loading' && shownLinks.length === 0 && <p style={NOTE_STYLE}>Loading links…</p>}

          {linksStatus === 'error' && (
            <div>
              <p style={{ ...NOTE_STYLE, color: 'var(--wb-danger)' }}>Could not load the links.</p>
              <button
                type="button"
                className="vb-detail-btn wb-focus-ring"
                onClick={() => { void loadLinks(); }}
                style={{ ...SECONDARY_BUTTON_STYLE, marginTop: '6px' }}
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
                      className="vb-detail-link wb-focus-ring"
                      href={link.url}
                      // `noreferrer` too, so the destination is not handed the page URL.
                      target="_blank"
                      rel="noopener noreferrer"
                      // The full URL lives here and in `href`, never as the visible text.
                      title={link.url}
                      style={{
                        flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '7px',
                        minHeight: '32px', padding: '4px 6px', borderRadius: 'var(--wb-r-md)',
                        textDecoration: 'none', color: 'var(--wb-text)',
                      }}
                    >
                      <Icon size={14} aria-hidden style={{ flexShrink: 0, color: 'var(--wb-text-muted)' }} />
                      <span style={{
                        flex: 1, minWidth: 0, font: '600 var(--wb-fs-13) var(--wb-font-ui)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {link.label}
                      </span>
                      <span style={VISUALLY_HIDDEN}>{` ${typeLabel} link, opens in a new tab.`}</span>
                      <ExternalLink size={12} aria-hidden style={{ flexShrink: 0, color: 'var(--wb-text-faint)' }} />
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* ── SUBTASKS ── */}
        <section aria-labelledby="vb-detail-subtasks-heading" style={SECTION_STYLE}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px', marginBottom: '8px' }}>
            <h3 id="vb-detail-subtasks-heading" style={{ ...SECTION_LABEL_STYLE, margin: 0 }}>Subtasks</h3>
            {/* Off the live list, which survives a background refetch, so the count never
                blinks out on a toggle. */}
            {showing.length > 0 && (
              <span style={{ font: '600 var(--wb-fs-12) var(--wb-font-ui)', color: 'var(--wb-text-muted)' }}>
                {doneCount} of {showing.length} done
              </span>
            )}
          </div>

          {subtaskStatus === 'loading' && showing.length === 0 && <p style={NOTE_STYLE}>Loading subtasks…</p>}

          {subtaskStatus === 'error' && (
            <div>
              <p style={{ ...NOTE_STYLE, color: 'var(--wb-danger)' }}>Could not load the subtasks.</p>
              <button
                type="button"
                className="vb-detail-btn wb-focus-ring"
                onClick={() => { void loadSubtasks(); }}
                style={{ ...SECONDARY_BUTTON_STYLE, marginTop: '6px' }}
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
                  <li key={subtask.id} style={{ display: 'flex', alignItems: 'center', gap: '4px', minHeight: '32px' }}>
                    <WbCheckbox
                      shape="square"
                      checked={subtask.is_done}
                      disabled={busy}
                      label={subtask.is_done
                        ? `Mark "${subtask.title}" as not done`
                        : `Mark "${subtask.title}" as done`}
                      onChange={() => { void toggleSubtask(subtask); }}
                      className="vb-detail-check"
                    />
                    <span style={{
                      flex: 1, minWidth: 0, font: '500 var(--wb-fs-13) var(--wb-font-ui)',
                      color: subtask.is_done ? 'var(--wb-text-faint)' : 'var(--wb-text)',
                      textDecoration: subtask.is_done ? 'line-through' : 'none',
                      overflowWrap: 'anywhere',
                    }}>
                      {subtask.title}
                    </span>
                    <button
                      type="button"
                      className="vb-detail-icon-btn wb-focus-ring"
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
                className="vb-detail-control wb-focus-ring"
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
              className="vb-detail-btn wb-focus-ring"
              disabled={adding}
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '5px',
                flexShrink: 0, minHeight: '32px', padding: '6px 12px', borderRadius: 'var(--wb-r-md)',
                background: 'var(--wb-blue-strong)', border: '1px solid var(--wb-blue-strong)',
                font: '700 var(--wb-fs-13) var(--wb-font-ui)', color: 'var(--wb-inverse-text)',
                cursor: adding ? 'progress' : 'pointer', opacity: adding ? 0.7 : 1,
              }}
            >
              <Plus size={13} aria-hidden />
              {adding ? 'Adding…' : 'Add'}
            </button>
          </form>

          {addError !== null && (
            <p id="vb-detail-subtask-error" role="alert" style={{ ...NOTE_STYLE, marginTop: '6px', color: 'var(--wb-danger)' }}>
              {addError}
            </p>
          )}
        </section>

        {/* ── NOTES ── */}
        <section aria-labelledby="vb-detail-note-heading" style={SECTION_STYLE}>
          <h3 id="vb-detail-note-heading" style={{ ...SECTION_LABEL_STYLE, margin: '0 0 6px' }}>Notes</h3>
          {item.note === null || item.note.trim() === '' ? (
            <p style={NOTE_STYLE}>No notes yet.</p>
          ) : (
            // `pre-wrap`: the line breaks typed into the textarea are part of the note.
            <p style={{ ...NOTE_STYLE, whiteSpace: 'pre-wrap', color: 'var(--wb-text)', overflowWrap: 'anywhere' }}>
              {item.note}
            </p>
          )}
        </section>

        {(onEdit || (isOwned && onDelete)) && (
          <div style={{ ...SECTION_STYLE, display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
            {onEdit ? (
              <button
                type="button"
                className="wb-add-trigger wb-focus-ring"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                onClick={() => { setTitleDraft(null); onClose(); onEdit({ ...item, title: shownTitle }); }}
              >
                <Pencil size={13} aria-hidden />
                Edit
                <span style={VISUALLY_HIDDEN}>{` all fields of "${item.title}"`}</span>
              </button>
            ) : <span />}
            {isOwned && onDelete && (
              <button
                type="button"
                className="wb-add-trigger wb-focus-ring"
                style={{ color: 'var(--wb-danger)', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                // A mouse press would blur the title field and commit its draft before the click.
                onMouseDown={e => e.preventDefault()}
                onClick={() => {
                  // Drop a pending rename so no PATCH reaches an item being deleted.
                  setTitleDraft(null);
                  onDelete(item);
                  onClose();
                }}
              >
                <Trash2 size={13} aria-hidden />
                Delete
              </button>
            )}
          </div>
        )}
      </div>

      <WaitingPopover
        open={waitingAsk !== null}
        anchor={waitingAnchor}
        title={item.title}
        prompt={revisionAsk ? waitingPrompt('submitted', item.title) : undefined}
        initial={waitingAsk?.mode === 'edit' ? (item.blocked_reason ?? '') : ''}
        confirmLabel="Save"
        onCancel={() => {
          const a = waitingAnchor;
          setWaitingAsk(null);
          if (a?.isConnected) a.focus({ preventScroll: true });
        }}
        onConfirm={reason => {
          const ask = waitingAsk;
          const a = waitingAnchor;
          setWaitingAsk(null);
          // Back into the drawer before the popover unmounts, so focus never drops to body.
          if (a?.isConnected) a.focus({ preventScroll: true });
          if (ask === null) return;
          if (ask.mode === 'move') void commitStage(ask.next, reason);
          else void saveReason(reason);
        }}
      />

      {/* These rules MUST live in the component that renders their targets: styled-jsx scopes
          each component separately. */}
      <style jsx>{`
        .vb-detail-title {
          flex: 1;
          min-width: 0;
          box-sizing: border-box;
          margin: 0 0 0 -6px;
          padding: 2px 6px;
          border: 1px solid transparent;
          border-radius: var(--wb-r-md);
          background: transparent;
          font: 800 var(--wb-fs-20) var(--wb-font-head);
          line-height: 1.3;
          color: var(--wb-text);
        }
        .vb-detail-title:focus {
          outline: none;
          border-color: var(--wb-border);
          background: var(--wb-surface);
        }
        .vb-detail-title:focus-visible {
          border-color: var(--wb-blue-strong);
        }
        /* Task 20's quiet select: reads as text, border on hover or focus. The caret stays
           visible here because the drawer has no row hover to reveal it. */
        .vb-detail-status {
          appearance: none;
          -webkit-appearance: none;
          box-sizing: border-box;
          min-height: 28px;
          max-width: 100%;
          margin-left: -6px;
          border: 1px solid transparent;
          border-radius: var(--wb-r-sm);
          padding: 3px 22px 3px 6px;
          font: 600 var(--wb-fs-13) var(--wb-font-ui);
          line-height: 1.2;
          color: var(--wb-text-muted);
          background-color: transparent;
          background-image:
            linear-gradient(45deg, transparent 50%, var(--wb-text-subtle) 50%),
            linear-gradient(135deg, var(--wb-text-subtle) 50%, transparent 50%);
          background-position: calc(100% - 13px) 55%, calc(100% - 8px) 55%;
          background-repeat: no-repeat;
          background-size: 5px 5px, 5px 5px;
        }
        .vb-detail-status:focus-visible {
          border-color: var(--wb-blue-strong);
          outline: 2px solid var(--wb-blue-strong);
          outline-offset: 1px;
          background-color: var(--wb-surface);
        }
        @media (hover: none) {
          .vb-detail-status { border-color: var(--wb-hairline); }
        }
        @media (hover: hover) and (pointer: fine) {
          .vb-detail-title:hover {
            border-color: var(--wb-border);
          }
          .vb-detail-status:hover:not(:disabled) {
            border-color: var(--wb-border);
            background-color: var(--wb-surface);
          }
          .vb-detail-control:hover:not(:disabled),
          .vb-detail-icon-btn:hover:not(:disabled) {
            border-color: var(--wb-text-faint);
          }
          .vb-detail-btn:hover:not(:disabled) {
            filter: brightness(0.97);
          }
          /* Underline as well as the background: "it is a link" is not carried by colour alone. */
          .vb-detail-link:hover {
            background: var(--wb-selected);
            text-decoration: underline;
          }
        }
        :global(.vb-detail-check.wb-check) {
          padding: 0 6px;
          height: 32px;
        }
      `}</style>
    </WbOverlay>
  );
}

/** 26×26 clears the WCAG 2.2 Target Size (Minimum) floor of 24px, the size `LinksPopover`'s
 *  per-row controls use. */
const ICON_BUTTON_STYLE: React.CSSProperties = {
  flex: '0 0 26px', width: '26px', height: '26px', display: 'inline-flex',
  alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--wb-r-md)',
  background: 'var(--wb-surface)', border: '1px solid var(--wb-border)',
  color: 'var(--wb-text-muted)', cursor: 'pointer', padding: 0,
};

const SECONDARY_BUTTON_STYLE: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: '5px',
  minHeight: '30px', padding: '6px 12px', borderRadius: 'var(--wb-r-md)',
  background: 'var(--wb-surface)', border: '1px solid var(--wb-border)',
  font: '600 var(--wb-fs-12) var(--wb-font-ui)', color: 'var(--wb-text-muted)',
  cursor: 'pointer',
};
