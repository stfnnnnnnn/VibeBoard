'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import HubHeader, { panelId, tabId } from '@/components/studypulse/canvas/HubHeader';
import CanvasOverview from '@/components/studypulse/canvas/CanvasOverview';
import ActivityBank from '@/components/studypulse/canvas/ActivityBank';
import Announcements from '@/components/studypulse/canvas/Announcements';
import UndoToast from '@/components/studypulse/canvas/UndoToast';
import { useUndoToast } from '@/components/studypulse/canvas/useUndoToast';
import {
  subjectCode, sumCounts,
  type CanvasCourse, type ConnectionStatus, type HubSubject, type HubTab, type PendingCounts,
} from '@/components/studypulse/canvas/types';

/**
 * The Canvas hub (spec §6): one header row, then the active view's panel. The view and the subject filter live in the
 * URL (?tab=, ?subject=) via router.replace without scrolling, so a reload or a link from a subject page lands on the
 * same view. Counts come from the server; every change calls router.refresh() so they stay current.
 */
export default function CanvasClientShell({ connection, subjects, initialCourses, counts, initialTab, initialSubject }: {
  connection: ConnectionStatus;
  subjects: HubSubject[];
  initialCourses: CanvasCourse[];
  counts: PendingCounts;
  initialTab: HubTab;
  initialSubject: number | null;
}) {
  const router = useRouter();
  const toast = useUndoToast();
  const [tab, setTab] = useState<HubTab>(initialTab);
  const [subject, setSubject] = useState<number | null>(initialSubject);
  const [courses, setCourses] = useState<CanvasCourse[]>(initialCourses);

  const syncUrl = (t: HubTab, s: number | null) => {
    const q = new URLSearchParams({ tab: t });
    if (s !== null) q.set('subject', String(s));
    router.replace(`/studypulse/canvas?${q.toString()}`, { scroll: false });
  };
  const changeTab = (t: HubTab) => { if (t === tab) return; setTab(t); syncUrl(t, subject); };
  const changeSubject = (s: number | null) => { setSubject(s); syncUrl(tab, s); };

  // The Overview's courses arrive with the page and are refetched after its changes; the Activity Bank and
  // Announcements load their own lists.
  const refresh = useCallback(async () => {
    if (tab !== 'overview') return;
    try {
      const res = await fetch('/api/canvas/courses');
      if (res.ok) setCourses((await res.json()).courses);
    } catch (err) {
      console.error('Failed to refresh Canvas data:', err);
    }
  }, [tab]);

  const onChange = useCallback(() => {
    refresh();
    router.refresh();
  }, [refresh, router]);

  const refreshCounts = useCallback(() => router.refresh(), [router]);

  const scoped = subject !== null ? subjects.find(s => s.user_subject_id === subject) ?? null : null;
  const inSubject = (m: Record<string, number>) => (subject === null ? sumCounts(m) : m[String(subject)] ?? 0);
  const tabCounts = { bank: inSubject(counts.bank), announcements: inSubject(counts.announcements) };
  const showTabs = connection.connected;
  const view: HubTab = showTabs ? tab : 'overview';

  return (
    <div className="vb-bg sp-page">
      <div className="sp-wrap">
        <HubHeader tab={view} onTab={changeTab} counts={tabCounts} showTabs={showTabs}
          subjects={subjects} subject={subject} onSubject={changeSubject} />

        {scoped && view !== 'overview' && (
          <div className="sp-scoped" role="note">
            <span>Showing <ScopedCode subject={scoped} /> only</span>
            <button type="button" className="sp-btn sp-btn--quiet sp-btn--sm sp-focus-ring" onClick={() => changeSubject(null)}>
              Show all subjects
            </button>
          </div>
        )}

        <div id={panelId(view)} role={showTabs ? 'tabpanel' : undefined} aria-labelledby={showTabs ? tabId(view) : undefined}
          className="sp-hub-panel">
          {view === 'overview' && (
            <CanvasOverview connection={connection} courses={courses} subjects={subjects} counts={counts}
              onChange={onChange} toast={toast.show} />
          )}
          {view === 'bank' && (
            <ActivityBank subject={subject} subjects={subjects} toast={toast.show} onCountsChange={refreshCounts} />
          )}
          {view === 'announcements' && (
            <Announcements subject={subject} subjects={subjects} toast={toast.show} onCountsChange={refreshCounts} />
          )}
        </div>
      </div>
      <UndoToast api={toast} />
    </div>
  );
}

/** The scoped subject's code, linking back to its page (the old bar's "Back to subject"). */
function ScopedCode({ subject }: { subject: HubSubject }) {
  return (
    <Link className="sp-scoped__code sp-focus-ring" href={`/studypulse/${subject.user_subject_id}`} title={`Open ${subject.subject_name}`}>
      {subjectCode(subject)}
    </Link>
  );
}
