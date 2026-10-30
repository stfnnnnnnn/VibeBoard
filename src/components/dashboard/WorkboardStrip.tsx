'use client';
import Link from 'next/link';
import { useState, type CSSProperties } from 'react';
import type { DigestItem, WorkboardDigest } from '@/lib/workboard/dashboardDigest';
import type { Section } from '@/lib/dashboard/types';
import { CONTEXT_FILL, CONTEXT_TEXT } from '@/lib/workboard/ui/tokens';

const DAY_LETTER = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const dayName = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });

function Item({ item }: { item: DigestItem }) {
  const meta = item.subtasks ? `◔ ${item.subtasks.done}/${item.subtasks.total} subtasks`
    : item.estimatedHours ? `~${item.estimatedHours}h` : null;
  return (
    <Link href={item.href} className="db-item db-witem"
      aria-label={`${item.title}, ${item.stageLabel}${item.due ? `, due ${item.due.top}` : ''}`}>
      <span className="db-gdot" style={{ '--d': item.priority === 'high' ? '#e0607e' : '#9aa5b8' } as CSSProperties} />
      <span className="db-wt">{item.title}</span>
      <span className="db-wmeta">
        <span className="db-ctx" style={{ '--d': CONTEXT_FILL[item.context], '--t': CONTEXT_TEXT[item.context] } as CSSProperties}>{item.contextLabel}</span>
        <span className="db-stage" data-tone={item.stageTone}>{item.stageLabel}</span>
        {meta && <span>{meta}</span>}
      </span>
      {item.due && (
        <span className="db-due" data-late={item.due.late || undefined}>
          {item.due.top}{item.due.bottom && <small>{item.due.bottom}</small>}
        </span>
      )}
    </Link>
  );
}

/** Read-only Workboard strip (spec §5.5). The day filter is the dashboard's only non-link control. */
export default function WorkboardStrip({ sec, onRetry, retrying }: {
  sec: Section<WorkboardDigest> | undefined; onRetry: () => void; retrying: boolean;
}) {
  const [day, setDay] = useState<string | null>(null);

  if (!sec || !sec.ok) {
    return (
      <section className="db-panel db-wb db-enter" style={{ '--i': 4 } as CSSProperties} aria-labelledby="db-wb-h" aria-busy={!sec}>
        <div className="db-wbh">
          <h2 id="db-wb-h">Workboard</h2>
          {!sec ? <span className="db-skel" style={{ width: 220 }} /> : <>
            <span className="db-err">Couldn&apos;t load your work</span>
            <button type="button" className="db-stat" onClick={onRetry} disabled={retrying}>↻ Retry</button>
          </>}
          <Link href="/workboard" className="db-pill" style={{ marginLeft: 'auto', fontSize: 12, padding: '6px 14px' }}>Open Workboard →</Link>
        </div>
        {!sec && <div className="db-list">{[0, 1, 2, 3].map(i => <span key={i} className="db-item db-skel" style={{ height: 52 }} />)}</div>}
      </section>
    );
  }

  const d = sec.data;
  const selected = day ? d.week.find(w => w.date === day) ?? null : null;
  const items = selected ? selected.items : d.upNext;
  // Client-side Manila date; it only drives the today dot, so the buttons suppress a midnight hydration diff.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const pct = d.totalThisWeek ? Math.round((d.doneThisWeek / d.totalThisWeek) * 100) : 0;

  return (
    <section className="db-panel db-wb db-enter" style={{ '--i': 4 } as CSSProperties} aria-labelledby="db-wb-h">
      <div className="db-wbh">
        <h2 id="db-wb-h">Workboard</h2>
        {d.overdue > 0 && <Link href="/workboard" className="db-stat db-stat-late"><span className="db-gdot" style={{ '--d': '#e0607e', width: 6, height: 6 } as CSSProperties} />{d.overdue} overdue</Link>}
        {d.inProgress > 0 && <Link href="/workboard" className="db-stat db-stat-prog"><span className="db-gdot" style={{ '--d': '#3b8fe0', width: 6, height: 6 } as CSSProperties} />{d.inProgress} in progress</Link>}
        <Link href="/workboard" className="db-stat">{d.dueThisWeek} due this week</Link>
        <div className="db-wprog">
          <span><b style={{ color: 'var(--db-ink)' }}>{d.doneThisWeek} of {d.totalThisWeek}</b> done this week</span>
          <span className="db-bar" role="img" aria-label={`${pct}% of this week's work done`}><i style={{ width: `${pct}%` }} /></span>
          <Link href="/workboard" className="db-pill" style={{ fontSize: 12, padding: '6px 14px' }}>Open Workboard →</Link>
        </div>
      </div>

      <div className="db-wbb">
        <div className="db-list db-fade" key={day ?? 'up-next'} aria-live={day ? 'polite' : undefined}>
          {items.map(i => <Item key={i.key} item={i} />)}
          {items.length === 0 && (
            <div className="db-list-empty">
              {!d.hasAnyItems ? <>Nothing on your plate. <Link href="/workboard" style={{ fontWeight: 700 }}>Add work in Workboard →</Link></>
                : selected ? `Nothing due ${dayName(selected.date)}` : 'Nothing due in the next 7 days.'}
            </div>
          )}
        </div>

        <div className="db-item db-week">
          <div className="db-weekh">
            <span className="db-k">{selected ? `${dayName(selected.date)} · ${selected.total} item${selected.total === 1 ? '' : 's'}` : 'This week'}</span>
            {selected
              ? <button type="button" onClick={() => setDay(null)} aria-label="Clear day filter">✕ Clear</button>
              : <span className="db-sub">tap a day to filter</span>}
          </div>
          <div className="db-wk" role="radiogroup" aria-label="Filter Up next by day">
            {d.week.map((w, i) => (
              <button
                key={w.date} type="button" role="radio" className="db-dcol" suppressHydrationWarning
                aria-checked={day === w.date} data-today={w.date === today || undefined}
                aria-label={`${dayName(w.date)}: ${w.total} due`}
                onClick={() => setDay(day === w.date ? null : w.date)}
              >
                <span className="db-stack" aria-hidden="true">
                  {(['academic', 'project', 'organization', 'life'] as const).flatMap(c =>
                    Array.from({ length: Math.min(w.counts[c], 4) }, (_, k) => <i key={`${c}${k}`} style={{ '--d': CONTEXT_FILL[c] } as CSSProperties} />))}
                </span>
                <span className="db-dn">{DAY_LETTER[i]}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
