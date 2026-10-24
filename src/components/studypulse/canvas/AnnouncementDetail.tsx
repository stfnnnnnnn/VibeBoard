'use client';

import { forwardRef, type ReactNode } from 'react';
import { ArrowLeft, Check, ExternalLink, Loader2 } from 'lucide-react';
import { stripHtml } from '@/lib/canvas/classify';
import ConvertPanel, { type DestinationPayload } from './ConvertPanel';
import type { AnnouncementItem, PickerPeriod, ScheduleBlockOption } from './types';

/**
 * The body with the extra-detail sentences marked (spec §6.1). The text is stripHtml(message), the same function the
 * server ran before computing note_spans, so the ranges index into exactly this string. Built as React text nodes and
 * <mark>s; never as HTML. Ranges that don't fit (out of order, overlapping, out of bounds) are skipped, not trusted.
 */
export function markedBody(text: string, spans: Array<[number, number]>): ReactNode[] {
  const out: ReactNode[] = [];
  let at = 0;
  for (const [s, e] of spans) {
    if (!Number.isInteger(s) || !Number.isInteger(e) || s < at || e <= s || e > text.length) continue;
    if (s > at) out.push(text.slice(at, s));
    out.push(<mark key={s} className="sp-ann-pick">{text.slice(s, e)}</mark>);
    at = e;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

/**
 * The reading pane (spec §6 C4, mockup v1c annView() right side): subject chip, "Posted …", Open in Canvas, the title,
 * the scrollable body, then "Turn this into" for an item to review, or its status (Converted / Dismissed + Restore).
 * On a phone it replaces the list, with a back button.
 */
const AnnouncementDetail = forwardRef<HTMLHeadingElement, {
  item: AnnouncementItem;
  code: { label: string; mapped: boolean };
  posted: { label: string; title: string };
  busy: 'convert' | 'dismiss' | 'restore' | null;
  error: string | null;
  loadPeriods: (subjectId: number) => Promise<PickerPeriod[]>;
  loadBlocks: () => Promise<ScheduleBlockOption[]>;
  onBack: () => void;
  onConvert: (destinations: DestinationPayload[]) => void;
  onDismiss: () => void;
  onRestore: () => void;
}>(function AnnouncementDetail({ item, code, posted, busy, error, loadPeriods, loadBlocks, onBack, onConvert, onDismiss, onRestore }, headRef) {
  const body = stripHtml(item.message);
  const status = item.bank_status;

  return (
    <article className="sp-ann__detail" aria-labelledby={`sp-ann-${item.id}-title`}>
      <button type="button" className="sp-btn sp-btn--quiet sp-btn--sm sp-focus-ring sp-ann__back" onClick={onBack}>
        <ArrowLeft size={16} aria-hidden /> All announcements
      </button>
      <div className="sp-ann__meta sp-num">
        <span className={`sp-chip ${code.mapped ? 'sp-chip--blue' : 'sp-chip--neutral'} sp-ann__code`} title={code.label}>{code.label}</span>
        <span title={posted.title}>Posted {posted.label}</span>
        {item.html_url && (
          <a className="sp-ann__open sp-focus-ring" href={item.html_url} target="_blank" rel="noreferrer">
            Open in Canvas <ExternalLink size={14} aria-hidden /><span className="sp-sr-only"> (opens in a new tab)</span>
          </a>
        )}
      </div>
      <h2 ref={headRef} tabIndex={-1} id={`sp-ann-${item.id}-title`} className="sp-ann__title">{item.title}</h2>
      {body
        ? <div className="sp-ann__body" tabIndex={0} role="region" aria-label="Announcement text">{markedBody(body, item.note_spans ?? [])}</div>
        : <p className="sp-ann__body sp-ann__body--empty">This announcement has no text.</p>}

      {status === 'pending' ? (
        item.user_subject_id ? (
          <ConvertPanel key={item.id} item={item} loadPeriods={loadPeriods} loadBlocks={loadBlocks}
            busy={busy === 'convert' || busy === 'dismiss' ? busy : null} serverError={error}
            onConvert={onConvert} onDismiss={onDismiss} />
        ) : (
          <div className="sp-ann__status">
            <p className="sp-ann__unmapped">Link this course to a subject on the Overview first, then you can turn this into a task, event or reminder.</p>
            <button type="button" className="sp-btn sp-btn--quiet sp-btn--sm sp-focus-ring" disabled={busy !== null} onClick={onDismiss}>
              {busy === 'dismiss' && <Loader2 size={14} className="sp-spin" aria-hidden />} Dismiss
            </button>
            {error && <p className="sp-turn__err" role="alert">{error}</p>}
          </div>
        )
      ) : status === 'included' ? (
        <div className="sp-ann__status">
          <span className="sp-chip sp-chip--success"><Check size={12} aria-hidden /> Converted</span>
        </div>
      ) : (
        <div className="sp-ann__status">
          <span className="sp-chip sp-chip--neutral">Dismissed</span>
          <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm sp-focus-ring" disabled={busy !== null} onClick={onRestore}>
            {busy === 'restore' && <Loader2 size={14} className="sp-spin" aria-hidden />} Restore
          </button>
          {error && <p className="sp-turn__err" role="alert">{error}</p>}
        </div>
      )}
    </article>
  );
});

export default AnnouncementDetail;
