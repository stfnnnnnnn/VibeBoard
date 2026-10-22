'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { CONTEXT_LABELS, type WorkContext } from '@/lib/workboard/workContexts';
import { createOwnedItem } from '../workApi';
import {
  defaultQuickAddContext, quickAddContexts, rememberQuickAddContext, stageFor,
  type CourseOption, type QuickAddDefaults,
} from '@/lib/workboard/ui/quickAdd';

interface Draft {
  id: number;
  title: string;
  ctx: WorkContext;
  courseId: number | null;
  state: 'pending' | 'error';
  error?: string;
}

export interface WbQuickAddProps {
  open: boolean;
  onClose: () => void;
  /** e.g. "Add to Today"; used as placeholder and accessible name. */
  label: string;
  defaults: QuickAddDefaults;
  filter: WorkContext | 'all';
  courses: CourseOption[];
  onCreated: () => Promise<void> | void;
}

let draftSeq = 0;

/** The shell's "New item" dialog, pre-filled with a title. Quick add on the Academic tab with
 *  no known courses hands off to it: there is no course to attach the item to, and falling back
 *  to Projects would file it somewhere the user is not looking. */
export const QuickAddFullDialogContext = createContext<((title: string) => void) | null>(null);

export default function WbQuickAdd({ open, onClose, label, defaults, filter, courses, onCreated }: WbQuickAddProps) {
  const hasCourses = courses.length > 0;
  const openFullDialog = useContext(QuickAddFullDialogContext);
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [ctx, setCtx] = useState<WorkContext>(() => defaultQuickAddContext(filter, hasCourses));
  const [courseId, setCourseId] = useState<number | null>(
    () => defaults.preferredCourseId ?? courses[0]?.userSubjectId ?? null,
  );
  const [drafts, setDrafts] = useState<Draft[]>([]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else setText('');
  }, [open]);
  useEffect(() => { setCtx(defaultQuickAddContext(filter, hasCourses)); }, [filter, hasCourses]);
  // Courses can arrive after mount; never leave an academic draft pointing at no (or a stale) course.
  useEffect(() => {
    setCourseId(c => (c != null && courses.some(x => x.userSubjectId === c)
      ? c
      : defaults.preferredCourseId ?? courses[0]?.userSubjectId ?? null));
  }, [courses, defaults.preferredCourseId]);

  const submit = async (draft: Draft) => {
    setDrafts(ds => ds.map(d => (d.id === draft.id ? { ...d, state: 'pending', error: undefined } : d)));
    const res = await createOwnedItem({
      category: draft.ctx,
      title: draft.title,
      user_subject_id: draft.ctx === 'academic' ? draft.courseId : null,
      due_at: defaults.dueAt,
      work_stage: stageFor(draft.ctx, defaults.stage),
    });
    if (!res.ok) {
      setDrafts(ds => ds.map(d => (d.id === draft.id ? { ...d, state: 'error', error: res.error } : d)));
      return;
    }
    // The item exists either way; a failed refresh must not leave a stuck pending row.
    try {
      await onCreated();
    } finally {
      setDrafts(ds => ds.filter(d => d.id !== draft.id));
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setText(''); onClose(); return; }
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    e.preventDefault();
    const title = text.trim();
    if (!title) return;
    if (filter === 'academic' && !hasCourses && openFullDialog) {
      setText('');
      onClose();
      openFullDialog(title);
      return;
    }
    rememberQuickAddContext(ctx);
    const draft: Draft = { id: ++draftSeq, title, ctx, courseId, state: 'pending' };
    setDrafts(ds => [...ds, draft]);
    setText('');
    void submit(draft);
  };

  return (
    <div>
      {drafts.map(d => (
        <div key={d.id} className={`wb-qa-draft ${d.state === 'pending' ? 'wb-is-pending' : 'wb-is-error'}`} role="status">
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title}</span>
          {d.state === 'error' && (
            <>
              <span className="wb-qa-draft__msg">{d.error ?? 'Could not save'}</span>
              <button type="button" className="wb-qa-draft__btn wb-focus-ring" onClick={() => void submit(d)}>Retry</button>
              <button type="button" className="wb-qa-draft__btn wb-focus-ring" onClick={() => setDrafts(ds => ds.filter(x => x.id !== d.id))}>Discard</button>
            </>
          )}
        </div>
      ))}
      {open && (
        <div
          className="wb-qa"
          onBlur={e => {
            // Focus leaving the whole row (from the input or either select) closes an empty quick add.
            if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget as Node)) return;
            if (!text.trim()) onClose();
          }}
        >
          <input
            ref={inputRef}
            className="wb-qa__input"
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={`${label}…`}
            aria-label={label}
          />
          {filter === 'all' && (
            <select className="wb-qa__select wb-focus-ring" aria-label="Context" value={ctx}
              onChange={e => setCtx(e.target.value as WorkContext)}>
              {quickAddContexts(hasCourses).map(c => <option key={c} value={c}>{CONTEXT_LABELS[c]}</option>)}
            </select>
          )}
          {ctx === 'academic' && (
            <select className="wb-qa__select wb-focus-ring" aria-label="Course" value={courseId ?? ''}
              onChange={e => setCourseId(Number(e.target.value))}>
              {courses.map(c => <option key={c.userSubjectId} value={c.userSubjectId}>{c.code}</option>)}
            </select>
          )}
          <span className="wb-qa__hint">Enter to save · Esc</span>
        </div>
      )}
    </div>
  );
}
