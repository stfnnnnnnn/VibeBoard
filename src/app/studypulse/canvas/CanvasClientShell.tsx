'use client';

import { Suspense, useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { GraduationCap, Home, ArrowLeft } from 'lucide-react';
import CanvasConnectPanel, { type ConnectionStatus } from '@/components/studypulse/CanvasConnectPanel';
import CanvasCourseMapping from '@/components/studypulse/CanvasCourseMapping';
import CanvasActivityBank from '@/components/studypulse/CanvasActivityBank';
import CanvasAnnouncementBank, { type AnnouncementItem } from '@/components/studypulse/CanvasAnnouncementBank';

export default function CanvasClientShell(props: {
  initialConnection: ConnectionStatus;
  existingSubjects: { user_subject_id: number; subject_name: string }[];
}) {
  return (
    <Suspense fallback={<div className="vb-bg" style={{ minHeight: '100vh' }} />}>
      <CanvasClientShellInner {...props} />
    </Suspense>
  );
}

function CanvasClientShellInner({
  initialConnection, existingSubjects,
}: {
  initialConnection: ConnectionStatus;
  existingSubjects: { user_subject_id: number; subject_name: string }[];
}) {
  const router = useRouter();
  const [connection] = useState(initialConnection);
  const [courses, setCourses]     = useState<never[]>([]);
  const [bankItems, setBankItems] = useState<never[]>([]);
  const [announcementItems, setAnnouncementItems] = useState<AnnouncementItem[]>([]);

  const searchParams = useSearchParams();
  const subjectParam = searchParams.get('subject');
  const subjectId    = subjectParam && /^\d+$/.test(subjectParam) ? subjectParam : null;
  const subjectName  = subjectId
    ? existingSubjects.find(s => String(s.user_subject_id) === subjectId)?.subject_name ?? null
    : null;

  // Task/announcement review only happens per-subject, via a subject page's dedicated
  // "Activity Bank" / "Announcements" button — each shows only its own panel. The general,
  // un-scoped page (no subjectId) shows neither: it's just Connect Canvas + New Canvas
  // Courses, so dumping every pending item from every subject doesn't clutter it.
  const viewParam         = searchParams.get('view');
  const showActivityBank  = subjectId != null && viewParam !== 'announcements';
  const showAnnouncements = subjectId != null && viewParam === 'announcements';

  const refresh = useCallback(async () => {
    try {
      const bankUrl = subjectId
        ? `/api/canvas/bank?status=pending&user_subject_id=${subjectId}`
        : '/api/canvas/bank?status=pending';
      const announcementsUrl = subjectId
        ? `/api/canvas/announcements?user_subject_id=${subjectId}`
        : '/api/canvas/announcements';
      // Skip fetching whichever panel this view won't render at all.
      const [coursesRes, bankRes, announcementsRes] = await Promise.all([
        subjectId ? Promise.resolve(null) : fetch('/api/canvas/courses'),
        showActivityBank ? fetch(bankUrl) : Promise.resolve(null),
        showAnnouncements ? fetch(announcementsUrl) : Promise.resolve(null),
      ]);
      if (coursesRes?.ok) setCourses((await coursesRes.json()).courses);
      if (bankRes?.ok) setBankItems((await bankRes.json()).items);
      if (announcementsRes?.ok) setAnnouncementItems((await announcementsRes.json()).items);
    } catch (err) {
      console.error('Failed to refresh Canvas data:', err);
    }
  }, [subjectId, showActivityBank, showAnnouncements]);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div className="vb-bg" style={{ margin: 0, fontFamily: "'Inter', sans-serif", minHeight: '100vh', color: '#333' }}>
      <style jsx>{`
        .cvs-pill:hover { background: rgba(255,255,255,0.85) !important; }
      `}</style>
      <div style={{ maxWidth: '900px', padding: '32px', width: '100%', margin: '0 auto' }}>

        {/* ── Header ── */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 14px', marginBottom: '20px' }}>
          <h1 className="gradient-text" style={{
            fontSize: 'clamp(1.5rem, 3vw, 2rem)', fontWeight: 800, margin: 0,
            fontFamily: "'DM Sans', 'Segoe UI', sans-serif", letterSpacing: '-0.01em',
            display: 'flex', alignItems: 'center', gap: '10px',
          }}>
            <GraduationCap size={24} strokeWidth={2.4} /> Canvas Integration
          </h1>
          <button
            className="cvs-pill"
            onClick={() => router.push('/studypulse')}
            style={{
              marginLeft: 'auto', background: 'rgba(255,255,255,0.55)', border: '1px solid rgba(255,255,255,0.45)',
              borderRadius: '999px', padding: '8px 15px', cursor: 'pointer', display: 'flex', alignItems: 'center',
              gap: '6px', fontSize: '0.82rem', fontWeight: 700, color: '#5c6b80',
            }}
          >
            <Home size={14} color="#74bcd9" strokeWidth={2.2} /> Study Pulse
          </button>
        </div>

        {subjectId && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px',
            background: 'rgba(116,188,217,0.14)', border: '1px solid rgba(116,188,217,0.3)',
            borderRadius: '16px', padding: '11px 18px', marginBottom: '20px',
            fontSize: '0.84rem', color: '#2a7fa8', fontWeight: 600,
          }}>
            <span>
              Showing {showAnnouncements && !showActivityBank ? 'announcements' : 'pending items'} for {subjectName ?? 'this subject'}
            </span>
            <button
              className="cvs-pill"
              onClick={() => router.push('/studypulse/canvas')}
              style={{
                background: 'transparent', border: 'none', color: '#2a7fa8', fontSize: '0.8rem', fontWeight: 700,
                cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '4px 8px', borderRadius: '999px',
              }}
            >
              <ArrowLeft size={13} /> View all subjects
            </button>
          </div>
        )}

        <CanvasConnectPanel connection={connection} onChange={refresh} />
        {connection.connected && (
          <>
            {/* Scoped to one subject, this view shows only the panel its entry button asked
                for — the New Canvas Courses mapping list is unrelated once you're already
                inside a subject, regardless of which panel is showing. */}
            {!subjectId && <CanvasCourseMapping courses={courses} existingSubjects={existingSubjects} onChange={refresh} />}
            {showActivityBank && <CanvasActivityBank items={bankItems} onChange={refresh} />}
            {showAnnouncements && <CanvasAnnouncementBank items={announcementItems} onChange={refresh} />}
          </>
        )}
      </div>
    </div>
  );
}
