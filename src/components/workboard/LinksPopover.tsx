'use client';

import {
  useCallback, useEffect, useId, useRef, useState, useSyncExternalStore,
} from 'react';
import {
  ClipboardList, Code2, ExternalLink, FileText, Globe, GraduationCap, HardDrive, Link2,
  LogIn, PenTool, Plus, Trash2, X, type LucideIcon,
} from 'lucide-react';
// Type-only imports from two modules that reach `pool` (mysql2) at module scope. `import type`
// is erased entirely by TypeScript, so no driver reaches this client bundle — the same shape
// `StatusCell`, `PriorityCell`, `DeadlineCell`, `WorkItemRow` and `WorkTableView` all use for
// `WorkItem`. A *value* import from either would 500 the page.
import type { WorkSource } from '@/lib/workboard/workItems';
import type { LinkType, WorkLink } from '@/lib/workboard/links';
// The module's one failure surface, shared with the three sibling Table cells.
import { reportTableCellError } from './table/tableCellError';
import WbPopover from './ui/WbPopover';

const FONT = 'var(--wb-font-ui)';

const NETWORK_ERROR = 'Could not reach the server. Check your connection and try again.';
const LIST_ERROR    = 'Could not load the links. Please try again.';
const ADD_ERROR     = 'Could not add the link. Please try again.';
const DELETE_ERROR  = 'Could not remove the link. Please try again.';

/**
 * A link's owner: an item's own `source` and `id`, with no translation.
 *
 * `LinkOwner['kind']` in `ownership.ts` is exactly `WorkSource`, so a `WorkItem`'s `source` is
 * already a legal `owner_kind` and its `id` already the matching `owner_id`. Naming the alias
 * here rather than importing `LinkOwner` keeps this file's only `@/lib` imports type-only and
 * pointed at modules the client already depends on.
 */
export type LinkOwnerKind = WorkSource;

/* ─── Type vocabulary ───────────────────────────────────────────────────────────────────
 * `LINK_TYPES` itself is a *value* in `links.ts`, which imports `pool` — so it cannot be
 * imported here. This `Record` is the client-side mirror, and being a `Record<LinkType, …>`
 * is what keeps it honest: adding a tenth member to `LINK_TYPES` fails the build here rather
 * than silently producing a select with a missing option and a link with no icon.
 *
 * Every icon is one of `lucide-react`'s generic glyphs (§25). None of them is a provider's
 * brand mark, and nothing here loads an external image: `github` gets a generic code glyph and
 * `figma` a generic pen, because shipping either company's logo would mean either bundling
 * their trademark or fetching an asset from a third-party host on every render.
 */
const LINK_TYPE_META: Record<LinkType, { label: string; Icon: LucideIcon }> = {
  canvas:  { label: 'Canvas',  Icon: GraduationCap },
  drive:   { label: 'Drive',   Icon: HardDrive },
  docs:    { label: 'Doc',     Icon: FileText },
  github:  { label: 'Repo',    Icon: Code2 },
  figma:   { label: 'Design',  Icon: PenTool },
  website: { label: 'Website', Icon: Globe },
  portal:  { label: 'Portal',  Icon: LogIn },
  form:    { label: 'Form',    Icon: ClipboardList },
  other:   { label: 'Other',   Icon: Link2 },
};

/** Declaration order above is the order the add form offers them. */
const LINK_TYPE_ORDER = Object.keys(LINK_TYPE_META) as LinkType[];

/** `link_type` is a VARCHAR the write routes whitelist, so an out-of-union value needs a
 *  hand-edited row — but a missing icon and an `undefined` label would be a crash, not a
 *  cosmetic slip, so an unrecognised value reads as `'other'`. */
export function asLinkType(value: unknown): LinkType {
  return typeof value === 'string' && value in LINK_TYPE_META ? (value as LinkType) : 'other';
}

export function linkTypeMeta(type: LinkType): { label: string; Icon: LucideIcon } {
  return LINK_TYPE_META[type];
}

/* ─── The owner-links store ─────────────────────────────────────────────────────────────
 * One cache, shared by every `LinksCell` and every `LinksPopover` in the page, keyed by owner.
 *
 * It exists because the work payload carries `link_count` and nothing else — deliberately, so
 * the table can render a Links column without a query per row — while both the popover's list
 * and the cell's `"Canvas · GitHub · +2"` summary need the labels. Reading them is therefore
 * lazy (nobody fetches until a user shows interest in a particular row) and cached (the second
 * reader of an owner pays nothing, and opening the popover on a row the user has already
 * hovered is instant).
 *
 * Deliberately a module-level store rather than React state or a context: the cell and the
 * popover are siblings in the tree that must agree, an add or a delete inside the popover has
 * to move the cell's summary immediately, and the cache has to outlive a popover that is
 * unmounted every time it closes.
 */

type OwnerKey = string;

const ownerKey = (kind: LinkOwnerKind, id: number): OwnerKey => `${kind}:${id}`;

const cache     = new Map<OwnerKey, WorkLink[]>();
const listeners = new Map<OwnerKey, Set<() => void>>();
/** In-flight loads, so a hover-prefetch and the open that follows it share one request. */
const inflight  = new Map<OwnerKey, Promise<LoadResult>>();

function subscribe(key: OwnerKey, notify: () => void): () => void {
  const set = listeners.get(key) ?? new Set<() => void>();
  set.add(notify);
  listeners.set(key, set);
  return () => {
    set.delete(notify);
    if (set.size === 0) listeners.delete(key);
  };
}

function publish(key: OwnerKey, links: WorkLink[]): void {
  cache.set(key, links);
  // A copy, because a listener that unsubscribes during the walk would otherwise mutate the
  // set being iterated.
  for (const notify of [...(listeners.get(key) ?? [])]) notify();
}

export type LoadResult =
  | { ok: true;  links: WorkLink[] }
  | { ok: false; message: string };

/** The server's answer, validated rather than trusted: this is JSON off the wire, and a shape
 *  mismatch must read as a failed load, not as a render-time crash inside a `.map`. */
function parseLinks(body: unknown): WorkLink[] | null {
  if (typeof body !== 'object' || body === null) return null;
  const raw = (body as { links?: unknown }).links;
  if (!Array.isArray(raw)) return null;

  const parsed: WorkLink[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) return null;
    const row = entry as Record<string, unknown>;
    if (typeof row.id !== 'number' || typeof row.label !== 'string' || typeof row.url !== 'string') {
      return null;
    }
    parsed.push({
      id:        row.id,
      label:     row.label,
      url:       row.url,
      link_type: asLinkType(row.link_type),
      position:  typeof row.position === 'number' ? row.position : 0,
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

/** What the cache holds for this owner right now, or `undefined` if nobody has loaded it. */
export function cachedOwnerLinks(kind: LinkOwnerKind, id: number): WorkLink[] | undefined {
  return cache.get(ownerKey(kind, id));
}

/**
 * Loads one owner's links through `GET /api/workboard/links`, de-duplicated and cached.
 *
 * Returns the cached value without a request unless `force` is set; `force` is what an add or
 * a delete uses to re-read the list it just changed, because the server assigns both the new
 * row's id and its position and neither can be guessed locally.
 *
 * Never reports failure itself — the caller decides. A user who opened the popover asked for
 * this list and is told when it fails (ruling 6); a speculative prefetch behind a hover did
 * not ask for anything, and an `alert` on mouse-over would be noise rather than information.
 */
export async function loadOwnerLinks(
  kind: LinkOwnerKind, id: number, options?: { force?: boolean },
): Promise<LoadResult> {
  const key = ownerKey(kind, id);

  if (options?.force !== true) {
    const hit = cache.get(key);
    if (hit !== undefined) return { ok: true, links: hit };
    const running = inflight.get(key);
    if (running !== undefined) return running;
  }

  const run = (async (): Promise<LoadResult> => {
    const query = `owner_kind=${encodeURIComponent(kind)}&owner_id=${encodeURIComponent(String(id))}`;
    // `.catch(() => null)` rather than a `try` around the body: only `fetch` itself rejecting
    // is a network failure. A 404 or a 500 is an answer, and gets the server's own words.
    const res = await fetch(`/api/workboard/links?${query}`).catch(() => null);
    if (res === null) return { ok: false, message: NETWORK_ERROR };
    if (!res.ok) return { ok: false, message: await messageFrom(res, LIST_ERROR) };

    const links = parseLinks(await res.json().catch(() => null));
    if (links === null) return { ok: false, message: LIST_ERROR };

    publish(key, links);
    return { ok: true, links };
  })();

  inflight.set(key, run);
  try {
    return await run;
  } finally {
    inflight.delete(key);
  }
}

/**
 * Subscribes to one owner's cached links. `undefined` means "not loaded", which is different
 * from `[]` ("loaded, and there are none") — the cell needs to tell those apart to know
 * whether it may render labels or must fall back to the payload's count.
 */
export function useOwnerLinks(kind: LinkOwnerKind, id: number): WorkLink[] | undefined {
  const key = ownerKey(kind, id);
  const sub  = useCallback((notify: () => void) => subscribe(key, notify), [key]);
  // `cache.get` returns the *same* array reference until `publish` replaces it, which is the
  // referential stability `useSyncExternalStore` requires of a snapshot.
  const snap = useCallback(() => cache.get(key), [key]);
  // Nothing is ever cached during SSR — the store is populated by `fetch`, which only runs in
  // the browser — so the server snapshot is a stable `undefined` rather than a fresh value
  // that would trip React's hydration comparison.
  return useSyncExternalStore(sub, snap, () => undefined);
}

/* ─── The popover ──────────────────────────────────────────────────────────────────────── */

const PANEL_WIDTH = 300;

const INPUT_STYLE: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', minHeight: '30px', borderRadius: 'var(--wb-r-md)',
  padding: '4px 8px', background: 'var(--wb-surface)',
  border: '1px solid var(--wb-border)', font: '500 var(--wb-fs-13) var(--wb-font-ui)',
  color: 'var(--wb-text)',
};

const LABEL_STYLE: React.CSSProperties = {
  display: 'block', font: '700 var(--wb-fs-12) var(--wb-font-ui)',
  color: 'var(--wb-text-muted)', marginBottom: '3px',
};

/** The panel's own layout inside `WbPopover`. */
const BODY_STYLE: React.CSSProperties = {
  boxSizing: 'border-box', padding: '12px',
  display: 'flex', flexDirection: 'column', gap: '10px',
  textAlign: 'left', whiteSpace: 'normal', fontFamily: FONT, color: 'var(--wb-text)',
};

/** The host, shown under the label as a muted second line. §10 forbids the raw URL as a link's
 *  *primary* text; it does not forbid saying where a link goes, and "which of my three
 *  Submission links is the Canvas one" is exactly the question a label alone cannot answer.
 *  Null for anything unparseable, which cannot reach storage through `isValidUrl` but can
 *  through a hand-edited row. */
function hostOf(url: string): string | null {
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
}

/** The client half of the server's rule. `isValidUrl` in `links.ts` is the authority and stays
 *  the authority — this is the same test, run early, so a typo comes back as a sentence under
 *  the field instead of as a modal after a round trip. It rejects `javascript:` for the same
 *  reason the server does, but the server rejecting it is what makes that a security control;
 *  this is a courtesy. */
function looksLikeHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export interface LinksPopoverProps {
  /** The item's own `source`. */
  ownerKind:  LinkOwnerKind;
  /** The item's own `id`. */
  ownerId:    number;
  /** The owning item's title — names the dialog, so a screen-reader user knows whose links
   *  these are. */
  title:      string;
  /** What the caller currently believes the count to be. Used only for the copy shown while
   *  the real list is still loading; once it arrives, the list is the truth. */
  linkCount:  number;
  /** The control that opened this: `WbPopover` anchors to it and ignores clicks on it, and the
   *  close button returns focus to it. */
  triggerRef: React.RefObject<HTMLElement | null>;
  onClose:    () => void;
  /** Re-pulls the work payload after a successful add or delete, so `link_count` everywhere —
   *  this cell's own summary included — agrees with what was just written. */
  onChanged:  () => void | Promise<void>;
  /** Appear without animating (opened from the keyboard, spec 4.3). */
  instant?:   boolean;
}

/**
 * The links editor: a list, an add form, and a per-row delete.
 *
 * **Standalone and prop-driven on purpose.** It takes an owner and a count, fetches its own
 * list lazily on open, and knows nothing about tables, rows or columns — which is what lets
 * the detail panel (Task 32) render the same component with no changes. Everything it needs
 * from a caller is in `LinksPopoverProps`.
 *
 * Always rendered through `WbPopover`, which owns the portal, placement, outside-click, scroll
 * and Esc dismissal — for the Table cell, the phone card and the detail drawer alike.
 */
export default function LinksPopover({
  ownerKind, ownerId, title, linkCount, triggerRef, onClose, onChanged, instant = false,
}: LinksPopoverProps) {
  const ids     = useId();
  const labelId = `${ids}-label`;
  const urlId   = `${ids}-url`;
  const typeId  = `${ids}-type`;
  const errorId = `${ids}-error`;

  const panelRef = useRef<HTMLDivElement>(null);

  const links = useOwnerLinks(ownerKind, ownerId);

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    () => (cachedOwnerLinks(ownerKind, ownerId) !== undefined ? 'ready' : 'loading'),
  );

  const [draftLabel, setDraftLabel] = useState('');
  const [draftUrl, setDraftUrl]     = useState('');
  const [draftType, setDraftType]   = useState<LinkType>('other');
  const [formError, setFormError]   = useState<string | null>(null);
  const [adding, setAdding]         = useState(false);
  /** Keyed by link id, exactly as `DeadlineCell` keys its in-flight writes by row: one link's
   *  delete must not disable the delete button on every other row of the list. */
  const [deleting, setDeleting]     = useState<ReadonlySet<number>>(() => new Set());

  /** The close button: dismiss and hand focus back to the trigger. */
  const dismiss = useCallback(() => {
    onClose();
    triggerRef.current?.focus();
  }, [onClose, triggerRef]);

  /* Load on open. A hover-prefetch already in flight is joined rather than duplicated
   * (`loadOwnerLinks` de-dupes), and a failure is reported here even when the prefetch that
   * actually issued the request swallowed its own — this is the fetch the user asked for. */
  const load = useCallback(async (force: boolean) => {
    setStatus('loading');
    const result = await loadOwnerLinks(ownerKind, ownerId, { force });
    if (!result.ok) {
      setStatus('error');
      // No toast Retry: the panel's inline "Try again" is the retry for a failed load.
      reportTableCellError(result.message);
      return false;
    }
    setStatus('ready');
    return true;
  }, [ownerKind, ownerId]);

  useEffect(() => {
    if (cachedOwnerLinks(ownerKind, ownerId) !== undefined) { setStatus('ready'); return; }
    void load(false);
    // `load` is stable for a given owner, and the owner cannot change without this popover
    // being torn down and rebuilt by its caller, so this runs exactly once per opening.
  }, [ownerKind, ownerId, load]);

  const submitAdd = async () => {
    if (adding) return;

    // Pre-flight only. These three messages render under the form because a validation error
    // is about the field the user is looking at; a *request* that fails goes to
    // `reportTableCellError` like every other Table write.
    const label = draftLabel.trim();
    const url   = draftUrl.trim();
    if (label === '')       { setFormError('A label is required.'); return; }
    if (label.length > 120) { setFormError('Keep the label to 120 characters or fewer.'); return; }
    if (!looksLikeHttpUrl(url)) { setFormError('Enter a full http:// or https:// address.'); return; }
    setFormError(null);

    setAdding(true);
    try {
      const res = await fetch('/api/workboard/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner_kind: ownerKind, owner_id: ownerId, label, url, link_type: draftType,
        }),
      }).catch(() => null);

      if (res === null) { reportTableCellError(NETWORK_ERROR, submitAdd); return; }
      if (!res.ok) {
        // The server's own words when it has any: "A valid http or https URL is required",
        // "Not found" for an owner that is not this user's. Far more use than a generic
        // failure, and the only place a client-side check can be wrong.
        reportTableCellError(await messageFrom(res, ADD_ERROR), submitAdd);
        return;
      }

      // Re-read rather than appending locally: the server assigns both the id and the
      // position, and `position` is what the list is ordered by.
      if (!(await load(true))) return;
      setDraftLabel('');
      setDraftUrl('');
      // `draftType` is deliberately kept — attaching three Canvas links in a row is the common
      // case, and resetting the select every time would tax it.
      await onChanged();
    } finally {
      setAdding(false);
    }
  };

  const removeLink = async (link: WorkLink) => {
    if (deleting.has(link.id)) return;
    setDeleting(current => new Set(current).add(link.id));
    try {
      const res = await fetch(`/api/workboard/links/${link.id}`, { method: 'DELETE' }).catch(() => null);
      if (res === null) { reportTableCellError(NETWORK_ERROR, () => removeLink(link)); return; }
      if (!res.ok) { reportTableCellError(await messageFrom(res, DELETE_ERROR), () => removeLink(link)); return; }

      if (!(await load(true))) return;
      // The row that held focus has just been removed from the DOM, which would otherwise drop
      // the user to `document.body` and restart the next Tab at the top of the page.
      panelRef.current?.focus();
      await onChanged();
    } finally {
      setDeleting(current => {
        const next = new Set(current);
        next.delete(link.id);
        return next;
      });
    }
  };

  const showing = links ?? [];
  const isEmpty = status === 'ready' && showing.length === 0;

  // The dialog role, name, Esc and placement belong to `WbPopover`.
  return (
    <WbPopover
      open
      anchor={triggerRef.current}
      onClose={onClose}
      ariaLabel={`Links for "${title}"`}
      width={PANEL_WIDTH}
      instant={instant}
    >
      <div
        ref={panelRef}
        // Focusable so the panel can take focus back after a delete removes the focused row;
        // -1 keeps it out of the sequential Tab order.
        tabIndex={-1}
        className="vb-links-pop"
        style={BODY_STYLE}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
          <span style={{
            font: '800 var(--wb-fs-11) var(--wb-font-ui)', letterSpacing: '0.04em',
            textTransform: 'uppercase', color: 'var(--wb-text-muted)',
          }}>
            Links
          </span>
          <button
            type="button"
            className="vb-links-icon-btn"
            aria-label="Close links"
            onClick={dismiss}
            style={ICON_BUTTON_STYLE}
          >
            <X size={13} aria-hidden />
          </button>
        </div>

        {status === 'loading' && (
          <p style={NOTE_STYLE}>
            {linkCount === 1 ? 'Loading 1 link…' : `Loading ${linkCount} links…`}
          </p>
        )}

        {status === 'error' && (
          <div>
            <p style={{ ...NOTE_STYLE, color: 'var(--wb-danger)' }}>Could not load the links.</p>
            <button
              type="button"
              className="vb-links-btn"
              onClick={() => { void load(true); }}
              style={SECONDARY_BUTTON_STYLE}
            >
              Try again
            </button>
          </div>
        )}

        {isEmpty && <p style={NOTE_STYLE}>No links yet.</p>}

        {showing.length > 0 && (
          // `max-height` plus its own scrollbar: a dozen links must not grow a fixed-position
          // panel past the viewport.
          <ul style={{
            listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column',
            gap: '2px', maxHeight: '172px', overflowY: 'auto',
          }}>
            {showing.map(link => {
              const { label: typeLabel, Icon } = linkTypeMeta(link.link_type);
              const host = hostOf(link.url);
              const busy = deleting.has(link.id);
              return (
                <li key={link.id} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <a
                    className="vb-links-item"
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
                      minHeight: '30px', padding: '3px 6px', borderRadius: 'var(--wb-r-md)',
                      textDecoration: 'none', color: 'var(--wb-text)',
                    }}
                  >
                    <Icon size={14} aria-hidden style={{ flexShrink: 0, color: 'var(--wb-text-muted)' }} />
                    <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                      <span style={{
                        font: '600 var(--wb-fs-13) var(--wb-font-ui)', color: 'var(--wb-text)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {link.label}
                      </span>
                      {host !== null && (
                        <span style={{
                          font: '500 var(--wb-fs-12) var(--wb-font-ui)', color: 'var(--wb-text-muted)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {host}
                        </span>
                      )}
                    </span>
                    {/* Part of the link's accessible name, not a stray string beside it: a
                        screen-reader user hears "Canvas, Canvas link, opens in a new tab". */}
                    <span style={VISUALLY_HIDDEN}>{` ${typeLabel} link, opens in a new tab.`}</span>
                    <ExternalLink size={12} aria-hidden style={{ flexShrink: 0, color: 'var(--wb-text-faint)' }} />
                  </a>
                  <button
                    type="button"
                    className="vb-links-icon-btn"
                    aria-label={`Remove link "${link.label}"`}
                    disabled={busy}
                    onClick={() => { void removeLink(link); }}
                    style={{
                      ...ICON_BUTTON_STYLE,
                      cursor: busy ? 'progress' : 'pointer',
                      // Opacity, not a colour swap: the UA's own disabled rendering greys this
                      // below §8's contrast floor, and it is a transient in-flight state.
                      opacity: busy ? 0.55 : 1,
                    }}
                  >
                    <Trash2 size={13} aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <form
          onSubmit={e => { e.preventDefault(); void submitAdd(); }}
          style={{
            display: 'flex', flexDirection: 'column', gap: '7px',
            borderTop: '1px solid var(--wb-hairline)', paddingTop: '10px',
          }}
        >
          <div>
            <label htmlFor={labelId} style={LABEL_STYLE}>Label</label>
            <input
              id={labelId}
              className="vb-links-input"
              value={draftLabel}
              maxLength={120}
              placeholder="Submission page"
              aria-describedby={formError === null ? undefined : errorId}
              onChange={e => setDraftLabel(e.target.value)}
              style={INPUT_STYLE}
            />
          </div>
          <div>
            <label htmlFor={urlId} style={LABEL_STYLE}>URL</label>
            <input
              id={urlId}
              className="vb-links-input"
              // `type="url"` for the mobile keyboard and the browser's own hint. The real gate is
              // `isValidUrl` on the server; `looksLikeHttpUrl` above is the middle step, and this
              // attribute is the least of the three — it accepts any scheme, `javascript:`
              // included, which is exactly why it is not relied on.
              type="url"
              inputMode="url"
              value={draftUrl}
              placeholder="https://…"
              aria-describedby={formError === null ? undefined : errorId}
              onChange={e => setDraftUrl(e.target.value)}
              style={INPUT_STYLE}
            />
          </div>
          <div>
            <label htmlFor={typeId} style={LABEL_STYLE}>Type</label>
            <select
              id={typeId}
              className="vb-links-input"
              value={draftType}
              onChange={e => setDraftType(asLinkType(e.target.value))}
              style={INPUT_STYLE}
            >
              {LINK_TYPE_ORDER.map(type => (
                <option key={type} value={type}>{LINK_TYPE_META[type].label}</option>
              ))}
            </select>
          </div>

          {formError !== null && (
            // `role="alert"` so a screen-reader user hears the reason their submit did nothing.
            // §8's AA-passing alert red, not a lighter decorative shade.
            <p id={errorId} role="alert" style={{ ...NOTE_STYLE, color: 'var(--wb-danger)' }}>
              {formError}
            </p>
          )}

          <button
            type="submit"
            className="vb-links-btn"
            disabled={adding}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '5px',
              minHeight: '30px', padding: '6px 14px', borderRadius: 'var(--wb-r-md)',
              background: 'var(--wb-blue-strong)', border: '1px solid var(--wb-blue-strong)',
              font: '700 var(--wb-fs-13) var(--wb-font-ui)', color: 'var(--wb-inverse-text)',
              cursor: adding ? 'progress' : 'pointer', opacity: adding ? 0.7 : 1,
            }}
          >
            <Plus size={13} aria-hidden />
            {adding ? 'Adding…' : 'Add link'}
          </button>
        </form>

        {/* These rules MUST live in the component that renders the elements they target. Each
            component gets its own styled-jsx scope hash, so a `.vb-links-input` rule written in
            `LinksCell` or in `WorkTableView` would compile cleanly and match nothing — the trap
            several tasks in this plan have hit. */}
        <style jsx>{`
          /* §9's ring, on the darker blue. :focus-visible so a mouse click does not leave a ring
             nobody asked for, while keyboard arrival always does. */
          .vb-links-input:focus-visible,
          .vb-links-icon-btn:focus-visible,
          .vb-links-btn:focus-visible,
          .vb-links-item:focus-visible,
          .vb-links-pop:focus-visible {
            outline: 2px solid var(--wb-blue-strong);
            outline-offset: 2px;
          }
          @media (hover: hover) and (pointer: fine) {
            .vb-links-input:hover:not(:disabled),
            .vb-links-icon-btn:hover:not(:disabled) {
              border-color: var(--wb-text-faint);
            }
            .vb-links-btn:hover:not(:disabled) {
              filter: brightness(0.97);
            }
            /* Underline on hover as well as the background shift: "it is a link" must not be
               carried by colour or background alone. */
            .vb-links-item:hover {
              background: var(--wb-selected);
              text-decoration: underline;
            }
          }
        `}</style>
      </div>
    </WbPopover>
  );
}

const VISUALLY_HIDDEN: React.CSSProperties = {
  position: 'absolute', width: '1px', height: '1px', padding: 0, margin: '-1px',
  overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
};

const NOTE_STYLE: React.CSSProperties = {
  margin: 0, font: '500 var(--wb-fs-12) var(--wb-font-ui)',
  color: 'var(--wb-text-muted)', lineHeight: 1.4,
};

/** 26×26 clears the WCAG 2.2 Target Size (Minimum) floor of 24px with a little margin — the
 *  right bar for a secondary control inside an already-open editor, and the same size
 *  `DeadlineCell`'s clear buttons use. */
const ICON_BUTTON_STYLE: React.CSSProperties = {
  flex: '0 0 26px', width: '26px', height: '26px', display: 'inline-flex',
  alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--wb-r-md)',
  background: 'var(--wb-surface)', border: '1px solid var(--wb-border)',
  color: 'var(--wb-text-muted)', cursor: 'pointer', padding: 0,
};

const SECONDARY_BUTTON_STYLE: React.CSSProperties = {
  minHeight: '30px', padding: '6px 12px', borderRadius: 'var(--wb-r-md)', marginTop: '6px',
  background: 'var(--wb-surface)', border: '1px solid var(--wb-border)',
  font: '600 var(--wb-fs-13) var(--wb-font-ui)', color: 'var(--wb-text-muted)',
  cursor: 'pointer',
};
