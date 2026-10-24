'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Link2, Loader2 } from 'lucide-react';
import { parseCanvasCourseCode } from '@/lib/canvas/normalize';
import { subjectCode, type CanvasCourse, type HubSubject, type PendingCounts } from './types';
import type { ToastInput } from './useUndoToast';

/**
 * The Overview's courses panel (spec §6 C2, mockup v1c .sec): new Canvas courses to map, then the mapped subjects with
 * their pending counts. The map calls (link / create / ignore) are the old CanvasCourseMapping's, unchanged, except
 * that a failure now shows on its row instead of in an alert().
 */
export default function CourseMapping({ courses, subjects, counts, onChange, toast }: {
  courses: CanvasCourse[];
  subjects: HubSubject[];
  counts: PendingCounts;
  onChange: () => void;
  toast: (t: ToastInput) => void;
}) {
  const router = useRouter();
  const pending = courses.filter(c => c.mapping_status === 'pending');
  const [linkChoice, setLinkChoice] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<number, string>>({});

  const subjectName = (id: number) => subjects.find(s => s.user_subject_id === id)?.subject_name ?? 'that subject';

  const act = async (courseId: number, body: { mode: 'link' | 'create' | 'ignore' } & Record<string, unknown>) => {
    setBusy(courseId);
    setErrors(prev => { const next = { ...prev }; delete next[courseId]; return next; });
    try {
      const res  = await fetch(`/api/canvas/courses/${courseId}/map`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setErrors(prev => ({ ...prev, [courseId]: data.error ?? 'Failed' })); return; }
      /* 'create' just made a brand-new, ungraded subject — take the student
         straight to it with the ?new=1 signal so the grading setup wizard opens.
         'link' and 'ignore' create nothing, so they keep refreshing in place. */
      if (body.mode === 'create' && data.user_subject_id) {
        router.push(`/studypulse/${data.user_subject_id}?new=1`);
        return;
      }
      onChange();
      const course = courses.find(c => c.id === courseId);
      if (body.mode === 'link') toast({ message: `Linked ${course?.name ?? 'the course'} to ${subjectName(Number(body.user_subject_id))}` });
      if (body.mode === 'ignore') toast({ message: `Ignored ${course?.name ?? 'the course'}` });
    } catch (err) {
      setErrors(prev => ({ ...prev, [courseId]: 'Map failed: ' + (err as Error).message }));
    } finally {
      setBusy(null);
    }
  };

  const createSubject = (course: CanvasCourse) => {
    const parsed = parseCanvasCourseCode(course.course_code);
    act(course.id, {
      mode: 'create',
      subject_name: course.name,
      course_code:  parsed.courseCode || course.course_code || course.name,
      section:      parsed.section,
      units: 3, year_level: '1st Year', trimester: parsed.termLabel ?? '1st Trimester',
    });
  };

  // One Mapped row per subject, even when two Canvas courses feed the same subject.
  const mappedIds = [...new Set(courses
    .filter(c => (c.mapping_status === 'linked' || c.mapping_status === 'created') && c.user_subject_id !== null)
    .map(c => c.user_subject_id as number))];
  const mapped = mappedIds.map(id => subjects.find(s => s.user_subject_id === id)).filter((s): s is HubSubject => !!s);

  return (
    <section className="sp-panel sp-cm" aria-labelledby="sp-cm-title">
      <div className="sp-cm__head">
        <h2 id="sp-cm-title">New Canvas courses</h2>
        {pending.length > 0 && <span className="sp-chip sp-chip--pink sp-num">{pending.length} to map</span>}
      </div>
      {pending.length > 0 ? (
        <>
          <p className="sp-cm__lead">Map each course to a subject so its assignments and announcements land in the right place.</p>
          <ul className="sp-cm__list">
            {pending.map(course => {
              const parsed = parseCanvasCourseCode(course.course_code);
              const choice = linkChoice[course.id] ?? '';
              const rowBusy = busy === course.id;
              const term = parsed.termLabel ? `${parsed.termLabel}${parsed.schoolYear ? ` · SY ${parsed.schoolYear}` : ''}` : null;
              return (
                <li key={course.id} className="sp-item sp-course">
                  <div className="sp-course__info">
                    <div className="sp-course__name">{course.name}</div>
                    <div className="sp-course__meta">
                      {parsed.courseCode && <span className="sp-chip sp-chip--blue">{parsed.courseCode}</span>}
                      {term && <span className="sp-chip sp-chip--neutral">{term}</span>}
                      {parsed.section && <span className="sp-chip sp-chip--neutral">Block {parsed.section}</span>}
                      {!parsed.termLabel && course.course_code && !parsed.courseCode && (
                        <span className="sp-course__raw">{course.course_code}</span>
                      )}
                    </div>
                  </div>
                  <div className="sp-course__acts">
                    <select className="sp-input sp-input--sm sp-course__select" aria-label={`Link ${course.name} to a subject`}
                      value={choice} disabled={rowBusy}
                      onChange={e => setLinkChoice(prev => ({ ...prev, [course.id]: e.target.value }))}>
                      <option value="">Link to subject…</option>
                      {subjects.map(s => (
                        <option key={s.user_subject_id} value={s.user_subject_id}>
                          {s.course_code ? `${s.course_code} · ${s.subject_name}` : s.subject_name}
                        </option>
                      ))}
                    </select>
                    {choice ? (
                      <button type="button" className="sp-btn sp-btn--primary sp-btn--sm sp-focus-ring" disabled={rowBusy}
                        onClick={() => act(course.id, { mode: 'link', user_subject_id: Number(choice) })}>
                        {rowBusy ? <Loader2 size={14} className="sp-spin" aria-hidden /> : <Link2 size={14} aria-hidden />} Link
                      </button>
                    ) : (
                      <>
                        <span className="sp-course__or">or</span>
                        <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm sp-focus-ring" disabled={rowBusy}
                          onClick={() => createSubject(course)}>
                          {rowBusy && <Loader2 size={14} className="sp-spin" aria-hidden />} Create subject
                        </button>
                      </>
                    )}
                    <button type="button" className="sp-btn sp-btn--quiet sp-btn--sm sp-focus-ring" disabled={rowBusy}
                      onClick={() => act(course.id, { mode: 'ignore' })}>
                      Ignore
                    </button>
                  </div>
                  {errors[course.id] && <p className="sp-course__err" role="alert">{errors[course.id]}</p>}
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <p className="sp-cm__lead">
          {courses.length === 0 ? 'Your Canvas courses appear here after the first sync.' : 'Every Canvas course is mapped. New ones show up here after a sync.'}
        </p>
      )}

      <div className="sp-cm__mapped">
        <div className="sp-eyebrow">Mapped</div>
        {mapped.length > 0 ? (
          <ul>
            {mapped.map(s => {
              const p = counts.bank[String(s.user_subject_id)] ?? 0;
              const r = counts.announcements[String(s.user_subject_id)] ?? 0;
              return (
                <li key={s.user_subject_id} className="sp-mapped sp-num">
                  <span className="sp-chip sp-chip--blue">{subjectCode(s)}</span>
                  <ArrowRight size={14} className="sp-mapped__arrow" aria-hidden />
                  <b className="sp-mapped__name">{s.subject_name}</b>
                  <span className="sp-mapped__counts">{p} pending · {r} to review</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="sp-cm__lead">No courses are mapped yet.</p>
        )}
      </div>
    </section>
  );
}
