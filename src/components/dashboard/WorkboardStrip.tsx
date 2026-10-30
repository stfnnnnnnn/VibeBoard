'use client';
import Link from 'next/link';
import { useState, type CSSProperties } from 'react';
import { ArrowRight } from 'lucide-react';
import type { DigestItem, WorkboardDigest } from '@/lib/workboard/dashboardDigest';
import type { Section } from '@/lib/dashboard/types';
import { CONTEXT_FILL, CONTEXT_TEXT } from '@/lib/workboard/ui/tokens';

const DAY_LETTER = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const dayName = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });

type SlotKind = 'real' | 'later' | 'done';

function Item({ item, kind = 'real', style }: { item: DigestItem; kind?: SlotKind; style?: CSSProperties }) {
  const meta = item.subtasks ? `◔ ${item.subtasks.done}/${item.subtasks.total} subtasks`
    : item.estimatedHours ? `~${item.estimatedHours}h` : null;
  const done = kind === 'done';
  const label = done
    ? `${item.title}${item.doneOn ? `, ${item.doneOn}` : ''}, done`
    : `${item.title}${kind === 'later' ? ', later' : ''}, ${item.stageLabel}${item.due ? `, due ${item.due.top}` : ''}`;
  const dot = done ? '#2fb47a' : item.priority === 'high' ? '#e0607e' : '#9aa5b8';
  return (
    <Link href={item.href} className={`db-item db-witem${done ? ' db-witem-done' : ''}`} style={style} aria-label={label}>
      <span className="db-gdot" style={{ '--d': dot } as CSSProperties} />
      <span className="db-wt">{item.title}</span>
      {done ? (
        <span className="db-wmeta">
          <span className="db-tag db-tag-done">Done ✓</span>
          {item.doneOn && <span>{item.doneOn}</span>}
        </span>
      ) : (
        <span className="db-wmeta">
          {kind === 'later' && <span className="db-tag">Later</span>}
          <span className="db-ctx" style={{ '--d': CONTEXT_FILL[item.context], '--t': CONTEXT_TEXT[item.context] } as CSSProperties}>{item.contextLabel}</span>
          <span className="db-stage" data-tone={item.stageTone}>{item.stageLabel}</span>
          {meta && <span>{meta}</span>}
        </span>
      )}
      {done ? <span className="db-due db-due-done" aria-hidden="true">✓</span> : item.due && (
        <span className="db-due" data-late={item.due.late || undefined}>
          {item.due.top}{item.due.bottom && <small>{item.due.bottom}</small>}
        </span>
      )}
    </Link>
  );
}

const SLOTS = 4;
const FULL_ROW: CSSProperties = { gridColumn: '1 / -1' };

/** Unfiltered Up next: real items first, then Later and Done-this-week fillers, then one summary
 *  card sized so the 2x2 box never shows an empty cell (task 14, §3b). */
function UpNextSlots({ d }: { d: WorkboardDigest }) {
  const fill = [
    ...d.later.map(item => ({ item, kind: 'later' as const })),
    ...d.doneRecent.map(item => ({ item, kind: 'done' as const })),
  ];
  const shown = [...d.upNext.map(item => ({ item, kind: 'real' as const })), ...fill].slice(0, SLOTS);
  const remaining = SLOTS - shown.length;

  const clear = d.upNext.length === 0;
  const title = clear ? 'All clear this week' : 'Light week ahead';
  const sub = clear
    ? (d.nextDueAfterWeek ? `Next deadline ${d.nextDueAfterWeek}` : 'No upcoming deadlines')
    : (d.nextDueAfterWeek ? `Nothing else due until ${d.nextDueAfterWeek}` : 'Nothing else due soon');
  // 1 left: one cell. 2 left: the second row. 3 left: the lone item and the card each take a full
  // row. 4 left (only older done work exists): the card fills the box.
  const cardStyle: CSSProperties | undefined = remaining === 4 ? { gridColumn: '1 / -1', gridRow: '1 / -1' }
    : remaining === 2 || remaining === 3 ? FULL_ROW : undefined;

  return (
    <>
      {shown.map(({ item, kind }) => (
        <Item key={item.key} item={item} kind={kind} style={remaining === 3 ? FULL_ROW : undefined} />
      ))}
      {remaining > 0 && (
        <div className="db-clear" style={cardStyle}>
          <span className="db-clear-ic" aria-hidden="true">🌿</span>
          <div style={{ minWidth: 0 }}>
            <b>{title}</b>
            <div className="db-sub">{sub}</div>
          </div>
        </div>
      )}
    </>
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
          <Link href="/workboard" className="db-btn db-iconbtn" style={{ marginLeft: 'auto' }} aria-label="Open Workboard"><ArrowRight size={16} strokeWidth={2.4} aria-hidden="true" /></Link>
        </div>
        {!sec && <div className="db-list">{[0, 1, 2, 3].map(i => <span key={i} className="db-item db-skel" style={{ height: 52 }} />)}</div>}
      </section>
    );
  }

  const d = sec.data;
  const selected = day ? d.week.find(w => w.date === day) ?? null : null;
  const activeDay = selected?.date ?? null;
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
          <Link href="/workboard" className="db-btn db-iconbtn" aria-label="Open Workboard"><ArrowRight size={16} strokeWidth={2.4} aria-hidden="true" /></Link>
        </div>
      </div>

      <div className="db-wbb">
        <div aria-live="polite" aria-atomic="false" style={{ minWidth: 0 }}>
          <div className="db-list db-fade" key={activeDay ?? 'up-next'}>
            {!d.hasAnyItems ? (
              <div className="db-list-empty">
                Nothing on your plate. <Link href="/workboard" style={{ fontWeight: 700 }}>Add work in Workboard →</Link>
              </div>
            ) : selected ? <>
              {selected.items.map(i => <Item key={i.key} item={i} />)}
              {selected.items.length === 0 && <div className="db-list-empty">Nothing due {dayName(selected.date)}</div>}
            </> : <UpNextSlots d={d} />}
          </div>
        </div>

        <div className="db-item db-week">
          <div className="db-weekh">
            <span className="db-k">{activeDay && selected ? `${dayName(selected.date)} · ${selected.total} item${selected.total === 1 ? '' : 's'}` : 'This week'}</span>
            {activeDay
              ? <button type="button" onClick={() => setDay(null)} aria-label="Clear day filter">✕ Clear</button>
              : <span className="db-sub">tap a day to filter</span>}
          </div>
          <div className="db-wk" role="group" aria-label="Filter Up next by day">
            {d.week.map((w, i) => (
              <button
                key={w.date} type="button" className="db-dcol" suppressHydrationWarning
                aria-pressed={activeDay === w.date} data-today={w.date === today || undefined}
                aria-label={`${dayName(w.date)}: ${w.total} due`}
                onClick={() => setDay(activeDay === w.date ? null : w.date)}
              >
                <span className="db-stack" aria-hidden="true">
                  {(['academic', 'project', 'organization', 'life'] as const)
                    .flatMap(c => Array.from({ length: w.counts[c] }, (_, k) => ({ c, k })))
                    .slice(0, 6)
                    .map(({ c, k }) => <i key={`${c}${k}`} style={{ '--d': CONTEXT_FILL[c] } as CSSProperties} />)}
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
