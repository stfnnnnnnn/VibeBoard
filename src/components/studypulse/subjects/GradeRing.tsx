import type { CSSProperties } from 'react';

/** The subject card's ring (spec D6): fill = current grade %, centre = rounded grade. */
export default function GradeRing({ grade }: { grade: number | null }) {
  const p = grade === null ? 0 : Math.max(0, Math.min(100, grade));
  return (
    <div className={`sp-ring${grade === null ? ' sp-ring--empty' : ''}`} style={{ '--p': p } as CSSProperties} aria-hidden="true">
      <span className="sp-ring__in sp-num">{grade === null ? '—' : Math.round(grade)}</span>
    </div>
  );
}
