'use client';

import type { CSSProperties, MouseEvent } from 'react';
import Link from 'next/link';
import { ArrowRight, Pencil, Trash2 } from 'lucide-react';
import { toGradeInfo } from '@/lib/gradeScale';
import { gradeTone } from '@/lib/studypulse/ui/format';
import type { SubjectCardData } from '@/lib/studypulse/types';
import GradeRing from './GradeRing';

type CardFields = Pick<SubjectCardData, 'course_code' | 'subject_name' | 'section' | 'year_level' | 'trimester' | 'units' | 'current_grade' | 'grade_scale'>
  & Partial<Pick<SubjectCardData, 'completed_tasks' | 'total_tasks'>>;

const TONE_CLASS = { success: 'sp-tone-success', warn: 'sp-tone-warn', danger: 'sp-tone-danger', none: 'sp-tone-muted' } as const;

/** Letter and meaning only, never the number beside it (spec D6). */
function gradeLine(grade: number | null, scale: SubjectCardData['grade_scale']): string {
  if (grade === null) return 'No grades yet';
  if (!scale) return '';
  const gi = toGradeInfo(grade, scale);
  return `${gi.letter} · ${gi.description}`;
}

/** A subject card. The name is a real link stretched over the card (::after), so the card is one tab stop
    that opens the subject, and the Edit/Delete buttons sit above the stretched link as separate controls. */
export default function SubjectCard({
  sub, preview = false, index = 0, href, onEdit, onDelete,
}: {
  sub: CardFields;
  preview?: boolean;
  index?: number;
  href?: string;
  onEdit?: (e: MouseEvent) => void;
  onDelete?: (e: MouseEvent) => void;
}) {
  const units = `${sub.units} unit${Number(sub.units) !== 1 ? 's' : ''}`;
  const line = gradeLine(sub.current_grade, sub.grade_scale);
  const name = sub.subject_name || 'Subject name';

  return (
    <div
      className={`sp-item sp-card${preview ? ' sp-card--preview' : ' sp-card--enter'}`}
      style={preview ? undefined : ({ animationDelay: `${Math.min(index, 12) * 45}ms` } as CSSProperties)}
      onContextMenu={preview || !onDelete ? undefined : e => { e.preventDefault(); onDelete(e); }}
    >
      <div className="sp-card__top">
        <div style={{ minWidth: 0 }}>
          <div className="sp-card__code" title={sub.course_code || undefined}>{sub.course_code || 'Course code'}</div>
          <div className="sp-card__name" title={preview ? undefined : name}>
            {preview || !href ? name : <Link href={href} className="sp-card__link">{name}</Link>}
          </div>
          {line && <div className={`sp-card__grade ${TONE_CLASS[gradeTone(sub.current_grade)]}`}>{line}</div>}
        </div>
        <GradeRing grade={sub.current_grade} />
      </div>
      <div className="sp-card__meta">
        {sub.year_level && <span className="sp-chip sp-chip--pink">{sub.year_level}</span>}
        {sub.trimester && <span className="sp-chip sp-chip--blue">{sub.trimester}</span>}
        {sub.section && <span className="sp-chip sp-chip--neutral">Block {sub.section}</span>}
      </div>
      <div className="sp-card__foot sp-num">
        <span>
          {preview || !sub.total_tasks ? (preview ? units : `No entries yet · ${units}`) : `${sub.completed_tasks} / ${sub.total_tasks} done · ${units}`}
        </span>
        {preview ? <ArrowRight size={15} className="sp-tone-muted" aria-hidden /> : (
          <span className="sp-card__actions">
            <button type="button" className="sp-icon-btn sp-focus-ring" aria-label={`Edit ${sub.subject_name}`} onClick={e => onEdit?.(e)}>
              <Pencil size={14} aria-hidden />
            </button>
            <button type="button" className="sp-icon-btn sp-icon-btn--danger sp-focus-ring" aria-label={`Delete ${sub.subject_name}`} onClick={e => onDelete?.(e)}>
              <Trash2 size={14} aria-hidden />
            </button>
          </span>
        )}
      </div>
    </div>
  );
}
