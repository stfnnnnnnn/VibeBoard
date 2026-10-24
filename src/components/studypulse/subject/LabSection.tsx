import Link from 'next/link';
import { FlaskConical } from 'lucide-react';
import { f1, gradeTone } from '@/lib/studypulse/ui/format';
import InfoTip from '../ui/InfoTip';

const TONE = { success: 'sp-tone-success', warn: 'sp-tone-warn', danger: 'sp-tone-danger', none: 'sp-tone-muted' } as const;
const show = (v: number | null) => (v === null ? '—' : f1(v));

export interface LabSectionProps {
  /** This subject's side of the link. */
  role: 'lecture' | 'lab';
  partner: { id: number; code: string; name: string };
  lectureWeight: number;
  /** Combined units of the pair, when known (the GWA counts the pair as one grade). */
  units: number | null;
  /** Both columns transmuted (Transmute is on). */
  transmuted?: boolean;
  /** False when the two subjects' period names no longer line up: nothing is combined then. */
  matched: boolean;
  rows: Array<{ key: string; name: string; lecture: number | null; lab: number | null; combined: number | null }>;
}

/** Linked lecture + lab (spec §3.5, mockup v8 "Linked lab"): per period, Lecture · Lab · Combined. The header tiles, the
    period tabs and the final view show the combined values; the summary and the entry tables stay this subject's own. */
export default function LabSection({ role, partner, lectureWeight, units, transmuted = false, matched, rows }: LabSectionProps) {
  const labWeight = 100 - lectureWeight;
  return (
    <section className="sp-panel sp-lab" aria-labelledby="sp-lab-title">
      <div className="sp-lab__head">
        <h2 id="sp-lab-title" className="sp-lab__title"><FlaskConical size={17} className="sp-tone-muted" aria-hidden /> {role === 'lecture' ? 'Linked lab' : 'Linked lecture'}</h2>
        {/* The "Linked lab: CODE (30%)" chip lives in the subject header (mockup v8); here the partner is named plainly. */}
        <Link href={`/studypulse/${partner.id}`} className="sp-lab__partner sp-focus-ring"><span className="sp-code-tag">{partner.code}</span> {partner.name}</Link>
        {transmuted && <span className="sp-chip sp-chip--blue">both transmuted</span>}
        <span className="sp-lab__rule sp-num">
          Per period: Lecture × {lectureWeight}% + Lab × {labWeight}%
          <InfoTip label="How the lecture and lab combine">
            Both subjects keep their own categories and entries. Each period combines the two period grades: Lecture × {lectureWeight}% + Lab × {labWeight}%.
            If one side has no grades yet, the other is shown alone. In the GWA the pair counts as <b>one {units ? `${units}-unit ` : ''}grade</b>.
          </InfoTip>
        </span>
      </div>
      {matched ? (
        <div className="sp-table-wrap">
          <table className="sp-lab__tbl sp-num">
            <thead>
              <tr><th scope="col">Period</th><th scope="col" className="r">Lecture</th><th scope="col" className="r">Lab</th><th scope="col" className="r">Combined</th></tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.key}>
                  <th scope="row">{r.name}</th>
                  <td className="r">{show(r.lecture)}</td>
                  <td className="r">{show(r.lab)}</td>
                  <td className="r"><b className={`sp-lab__comb ${TONE[gradeTone(r.combined)]}`}>{show(r.combined)}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="sp-lab__note">The period names of {partner.code} no longer match this subject&apos;s, so the grades aren&apos;t combined. Rename the periods in Grading to combine them again.</p>
      )}
    </section>
  );
}
