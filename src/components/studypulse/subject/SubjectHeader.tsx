'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, CalendarDays, GraduationCap, Hash, Layers, Link2 } from 'lucide-react';
import { toGradeInfo, type GradeScale } from '@/lib/gradeScale';
import { f1, gradeTone } from '@/lib/studypulse/ui/format';
import SpSegmented from '../ui/SpSegmented';
import LetterGrade from '../ui/LetterGrade';

type Unit = 'pct' | 'pt' | 'letter';
const UNIT_KEY = 'sp-grade-unit';
const TONE = { success: 'sp-tone-success', warn: 'sp-tone-warn', danger: 'sp-tone-danger', none: 'sp-tone-muted' } as const;

/** `final`: the separate Final grade tile ('average' rule). `finalTag`: the designated period's tile ('period' rule). */
export interface HeaderTile { key: string; label: string; value: number | null; final?: boolean; finalTag?: boolean }
export interface HeaderLabChip { role: 'lecture' | 'lab'; partnerId: number; partnerCode: string; partnerName: string; lectureWeight: number }

/** The tile shows the value only (spec §5.2): 86.7 · 2.5 · C+ · Good. */
function TileValue({ v, unit, scale }: { v: number; unit: Unit; scale: GradeScale | null }) {
  if (!scale || unit === 'pct') return <>{f1(v)}</>;
  const gi = toGradeInfo(v, scale);
  if (unit === 'pt') return <>{gi.point.toFixed(scale === '4pt' ? 1 : 2)}</>;
  return <LetterGrade letter={gi.letter} description={gi.description} />;
}

export default function SubjectHeader({ subject, presetName, tiles, scale, transError, lab }: {
  subject: { subject_name: string; course_code: string; section?: string | null; units: number; year_level: string; trimester: string };
  presetName: string | null;
  tiles: HeaderTile[];
  scale: GradeScale | null;
  transError: string | null;
  lab?: HeaderLabChip | null;
}) {
  const [unit, setUnit] = useState<Unit>('pt');
  useEffect(() => {
    try {
      const v = localStorage.getItem(UNIT_KEY);
      if (v === 'pct' || v === 'pt' || v === 'letter') setUnit(v);
      else if (v === 'gwa') setUnit('pt'); // the old "Grade pt" choice
    } catch { /* storage blocked */ }
  }, []);
  const pick = (u: Unit) => { setUnit(u); try { localStorage.setItem(UNIT_KEY, u); } catch { /* storage blocked */ } };
  const effective: Unit = scale ? unit : 'pct';

  return (
    <header className="sp-panel sp-sh">
      <Link href="/studypulse/subjects" className="sp-crumb sp-focus-ring"><ArrowLeft size={14} aria-hidden /> My Subjects</Link>
      <div className="sp-sh__grid">
        <div className="sp-sh__main">
          <h1 className="sp-sh__title">{subject.subject_name}</h1>
          <div className="sp-sh__code">
            <span className="sp-code-tag">{subject.course_code}</span>
            {subject.section && <span>Block {subject.section}</span>}
            {lab && (
              <Link href={`/studypulse/${lab.partnerId}`} className="sp-chip sp-chip--blue sp-chip-link sp-focus-ring sp-num" title={lab.partnerName}>
                <Link2 size={13} aria-hidden />
                {lab.role === 'lecture'
                  ? `Linked lab: ${lab.partnerCode} (${100 - lab.lectureWeight}%)`
                  : `Linked lecture: ${lab.partnerCode} (${lab.lectureWeight}%)`}
              </Link>
            )}
          </div>
          <div className="sp-metas">
            <span className="sp-meta"><Hash size={13} aria-hidden />{subject.units} unit{subject.units !== 1 ? 's' : ''}</span>
            {subject.year_level && <span className="sp-meta"><GraduationCap size={13} aria-hidden />{subject.year_level}</span>}
            {subject.trimester && <span className="sp-meta"><CalendarDays size={13} aria-hidden />{subject.trimester}</span>}
            {presetName && <span className="sp-meta sp-meta--preset"><Layers size={13} aria-hidden />{presetName}{scale ? ` (${scale === '4pt' ? '4.0' : '1.0'})` : ''}</span>}
          </div>
        </div>
        <div>
          <div className="sp-tiles sp-num">
            {tiles.map(t => {
              const cls = t.final ? ' sp-tile--final sp-tile--total' : t.finalTag ? ' sp-tile--final' : '';
              return (
                <div key={t.key} className={`sp-item sp-tile${cls}`}>
                  {t.finalTag && <span className="sp-tile__tag">Final grade</span>}
                  <div className="sp-eyebrow">{t.label}</div>
                  <div className={t.final ? 'sp-tile__big' : `sp-tile__big ${TONE[gradeTone(t.value)]}`}>
                    {t.value === null ? '—' : <TileValue v={t.value} unit={effective} scale={scale} />}
                  </div>
                  {t.value === null && <div className="sp-tile__sub">No grades yet</div>}
                </div>
              );
            })}
          </div>
          {scale && (
            <div className="sp-unit-switch">
              <SpSegmented size="sm" label="Grade display" value={unit} onChange={pick}
                options={[{ value: 'pct', label: 'Percent' }, { value: 'pt', label: 'Point' }, { value: 'letter', label: 'Letter' }]} />
            </div>
          )}
        </div>
      </div>
      {transError && <div className="sp-sh__error" role="alert">{transError}</div>}
    </header>
  );
}
