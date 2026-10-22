'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, CalendarDays, Flag, GraduationCap, Hash, Layers } from 'lucide-react';
import { toGradeInfo, type GradeScale } from '@/lib/gradeScale';
import { f1, gradeTone } from '@/lib/studypulse/ui/format';
import SpSegmented from '../ui/SpSegmented';

type Unit = 'gwa' | 'pct' | 'letter';
const UNIT_KEY = 'sp-grade-unit';
const TONE = { success: 'sp-tone-success', warn: 'sp-tone-warn', danger: 'sp-tone-danger', none: 'sp-tone-muted' } as const;

export interface HeaderTile { key: string; label: string; value: number | null; final?: boolean }

function display(v: number | null, unit: Unit, scale: GradeScale | null): { big: string; sub: string } {
  if (v === null) return { big: '—', sub: 'No grades yet' };
  if (!scale) return { big: f1(v), sub: '' };
  const gi = toGradeInfo(v, scale);
  const lt = scale === '4pt' ? `${gi.letter} · ${gi.description}` : gi.description;
  if (unit === 'gwa') return { big: gi.point.toFixed(2), sub: lt };
  if (unit === 'pct') return { big: f1(v), sub: lt };
  return { big: gi.letter, sub: gi.description };
}

export default function SubjectHeader({ subject, presetName, tiles, scale, transError }: {
  subject: { subject_name: string; course_code: string; section?: string | null; units: number; year_level: string; trimester: string };
  presetName: string | null;
  tiles: HeaderTile[];
  scale: GradeScale | null;
  transError: string | null;
}) {
  const [unit, setUnit] = useState<Unit>('gwa');
  useEffect(() => {
    try { const v = localStorage.getItem(UNIT_KEY); if (v === 'gwa' || v === 'pct' || v === 'letter') setUnit(v); } catch { /* storage blocked */ }
  }, []);
  const pick = (u: Unit) => { setUnit(u); try { localStorage.setItem(UNIT_KEY, u); } catch { /* storage blocked */ } };
  const effective: Unit = scale ? unit : 'pct';

  return (
    <header className="sp-panel sp-sh">
      <Link href="/studypulse/subjects" className="sp-crumb sp-focus-ring"><ArrowLeft size={14} aria-hidden /> My Subjects</Link>
      <div className="sp-sh__grid">
        <div className="sp-sh__main">
          <h1 className="sp-sh__title">{subject.subject_name}</h1>
          <div className="sp-sh__code"><span className="sp-code-tag">{subject.course_code}</span>{subject.section && <span>Block {subject.section}</span>}</div>
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
              const d = display(t.value, effective, scale);
              return (
                <div key={t.key} className={`sp-item sp-tile${t.final ? ' sp-tile--final' : ''}`}>
                  <div className="sp-tile__head"><span className="sp-eyebrow">{t.label}</span>{t.final && <Flag size={13} className="sp-tone-muted" aria-hidden />}</div>
                  <div className={t.final ? 'sp-tile__big' : `sp-tile__big ${TONE[gradeTone(t.value)]}`}>{d.big}</div>
                  {d.sub && <div className="sp-tile__sub">{d.sub}</div>}
                </div>
              );
            })}
          </div>
          {scale && (
            <div className="sp-unit-switch">
              <SpSegmented size="sm" label="Grade display" value={unit} onChange={pick}
                options={[{ value: 'gwa', label: 'Grade pt' }, { value: 'pct', label: 'Percent' }, { value: 'letter', label: scale === '4pt' ? 'Letter' : 'Meaning' }]} />
            </div>
          )}
        </div>
      </div>
      {transError && <div className="sp-sh__error" role="alert">{transError}</div>}
    </header>
  );
}
