'use client';

import { useCallback, useMemo, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BookOpen, GraduationCap, Home, Plus } from 'lucide-react';
import type { SubjectCardData } from '@/lib/studypulse/types';
import SubjectCard from './subjects/SubjectCard';
import SubjectForm, { BLANK_FORM, type SubjectFormValues } from './subjects/SubjectForm';

export type SubjectCard = SubjectCardData;

const mode = (xs: string[]) => {
  const c = new Map<string, number>();
  xs.filter(Boolean).forEach(x => c.set(x, (c.get(x) ?? 0) + 1));
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
};

export default function SubjectsGrid({ initialSubjects }: { initialSubjects: SubjectCardData[] }) {
  const router = useRouter();
  const [subjects, setSubjects] = useState(initialSubjects);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [form, setForm] = useState<SubjectFormValues>(BLANK_FORM);
  const toggleRef = useRef<HTMLButtonElement>(null);

  const set = (k: keyof SubjectFormValues, v: string) => setForm(p => ({ ...p, [k]: v }));
  const closeForm = useCallback(() => { setShowForm(false); setEditingId(null); setForm(BLANK_FORM); setMessage(''); }, []);
  const openForCreate = () => { setEditingId(null); setForm(BLANK_FORM); setMessage(''); setShowForm(true); };
  const openForEdit = (sub: SubjectCardData) => {
    setEditingId(sub.user_subject_id);
    setForm({ course_code: sub.course_code, section: sub.section ?? '', subject_name: sub.subject_name, year_level: sub.year_level, term: '', semester: sub.trimester, units: String(sub.units) });
    setMessage('');
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const stats = useMemo(() => ({
    units: subjects.reduce((s, x) => s + (Number(x.units) || 0), 0),
    tri: mode(subjects.map(s => s.trimester)),
    year: mode(subjects.map(s => s.year_level)),
  }), [subjects]);

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.course_code || !form.subject_name || !form.year_level || !form.semester) {
      setMessage('Course code, subject name, year level and trimester are required.');
      return;
    }
    setSubmitting(true);
    setMessage('');
    try {
      const body = JSON.stringify({
        course_code: form.course_code, section: form.section || null, subject_name: form.subject_name,
        year_level: form.year_level, trimester: form.semester, units: form.units,
      });
      if (editingId) {
        const res = await fetch(`/api/studypulse/subjects/${editingId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body });
        const data = await res.json();
        if (data.status !== 'success') throw new Error(data.error);
        setSubjects(prev => prev.map(s => s.user_subject_id === editingId ? {
          ...s, course_code: form.course_code, section: form.section || null, subject_name: form.subject_name,
          year_level: form.year_level, trimester: form.semester, units: Number(form.units) || 0,
        } : s));
        closeForm();
        return;
      }
      const res = await fetch('/api/studypulse/subjects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      const data = await res.json();
      if (data.status !== 'success') throw new Error(data.error);
      // SubjectCardView consumes ?new=1 to auto-open the grading setup wizard.
      router.push(`/studypulse/${data.user_subject_id}?new=1`);
    } catch (err) {
      setMessage((err as Error).message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (_e: MouseEvent, id: number) => {
    if (!confirm('Delete this subject? This cannot be undone.')) return;
    await fetch(`/api/studypulse/subjects/${id}`, { method: 'DELETE' });
    setSubjects(prev => prev.filter(s => s.user_subject_id !== id));
    if (editingId === id) closeForm();
  };

  return (
    <div className="vb-bg sp-page">
      <div className="sp-wrap">
        <header className="sp-ms-head">
          <div>
            <h1 className="sp-ms-title">My <em>Subjects</em></h1>
            {/* Each stat is its own span; CSS draws the "·" between them, so nothing leads with a separator. */}
            <div className="sp-ms-sub sp-num">
              <span><BookOpen size={15} aria-hidden /> {subjects.length} subject{subjects.length !== 1 ? 's' : ''}</span>
              {stats.units > 0 && <span>{stats.units} units</span>}
              {stats.tri && <span>{stats.tri}</span>}
              {stats.year && <span>{stats.year}</span>}
            </div>
          </div>
          <div className="sp-ms-actions">
            <Link href="/studypulse" className="sp-btn sp-btn--ghost sp-focus-ring"><Home size={15} aria-hidden /> Dashboard</Link>
            <button ref={toggleRef} type="button" className={`sp-btn sp-btn--primary sp-focus-ring${showForm ? ' is-open' : ''}`} aria-expanded={showForm} onClick={() => (showForm ? closeForm() : openForCreate())}>
              <Plus size={16} aria-hidden /> {showForm ? 'Close' : 'Add subject'}
            </button>
          </div>
        </header>

        <SubjectForm open={showForm} editing={editingId !== null} form={form} set={set} submitting={submitting} message={message} onSubmit={handleAdd} onCancel={closeForm} returnFocusRef={toggleRef} />

        {subjects.length > 0 ? (
          <div className="sp-cards">
            {subjects.map((sub, idx) => (
              <SubjectCard
                key={sub.user_subject_id}
                sub={sub}
                index={idx}
                href={`/studypulse/${sub.user_subject_id}`}
                onEdit={() => openForEdit(sub)}
                onDelete={e => handleDelete(e, sub.user_subject_id)}
              />
            ))}
          </div>
        ) : !showForm && (
          <div className="sp-panel sp-empty">
            <span className="sp-badge sp-badge--xl"><GraduationCap size={26} aria-hidden /></span>
            <h3>No subjects yet</h3>
            <p>Add your first subject to start tracking grades and tasks.</p>
            <button type="button" className="sp-btn sp-btn--primary sp-focus-ring" onClick={openForCreate}><Plus size={16} /> Add subject</button>
          </div>
        )}
      </div>
    </div>
  );
}
