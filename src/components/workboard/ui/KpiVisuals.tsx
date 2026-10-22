'use client';

/** dataviz micro-visuals for the KPI tiles (spec 5). Each graphic is aria-hidden and has a
 *  text equivalent in an sr-only span. No chart library. */

export function ProgressBar({ value, label }: { value: number; label: string }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div>
      <span className="wb-sr-only">{label}</span>
      <div aria-hidden style={{ height: 4, borderRadius: 2, background: 'var(--wb-hairline)', overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: '100%', background: 'var(--wb-blue)',
          transform: `scaleX(${v})`, transformOrigin: 'left center',
        }} />
      </div>
    </div>
  );
}

export function DueDots({ counts, labels, alertFirst }: {
  counts: [number, number, number, number];
  labels: [string, string, string, string];
  alertFirst?: boolean;
}) {
  const max = Math.max(1, ...counts);
  return (
    <div>
      <span className="wb-sr-only">{labels.map((l, i) => `${l}: ${counts[i]}`).join(', ')}</span>
      <div aria-hidden style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
        {counts.map((n, i) => {
          const size = n === 0 ? 6 : 8 + Math.round((n / max) * 6);
          const color = n === 0 ? 'var(--wb-hairline)' : i === 0 && alertFirst ? 'var(--wb-danger)' : 'var(--wb-blue-strong)';
          return (
            <div key={labels[i]} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
              <span style={{ width: size, height: size, borderRadius: '50%', background: color }} />
              <span style={{ font: '600 var(--wb-fs-12) var(--wb-font-ui)', color: 'var(--wb-text-muted)' }}>{labels[i]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Sparkline({ values, todayIndex, label }: { values: number[]; todayIndex: number | null; label: string }) {
  const W = 96;
  const H = 26;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? W / (values.length - 1) : W;
  const pts = values.map((v, i) => [i * step, H - 2 - (v / max) * (H - 6)] as const);
  return (
    <div>
      <span className="wb-sr-only">{label}</span>
      <svg aria-hidden width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ overflow: 'visible', display: 'block' }}>
        <polyline
          points={pts.map(p => p.join(',')).join(' ')}
          fill="none" stroke="var(--wb-blue)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
        />
        {todayIndex !== null && pts[todayIndex] && (
          <circle cx={pts[todayIndex][0]} cy={pts[todayIndex][1]} r={3} fill="var(--wb-blue-strong)" />
        )}
      </svg>
    </div>
  );
}
