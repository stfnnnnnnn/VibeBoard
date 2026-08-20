'use client';

import { Suspense, useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import CanvasConnectPanel, { type ConnectionStatus } from '@/components/studypulse/CanvasConnectPanel';
import CanvasCourseMapping from '@/components/studypulse/CanvasCourseMapping';
import CanvasActivityBank from '@/components/studypulse/CanvasActivityBank';

export default function CanvasClientShell(props: {
  initialConnection: ConnectionStatus;
  existingSubjects: { user_subject_id: number; subject_name: string }[];
}) {
  return (
    <Suspense fallback={<div style={{ padding: '24px', maxWidth: '900px', margin: '0 auto' }} />}>
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
  const [connection] = useState(initialConnection);
  const [courses, setCourses]     = useState<never[]>([]);
  const [bankItems, setBankItems] = useState<never[]>([]);

  const searchParams = useSearchParams();
  const subjectParam = searchParams.get('subject');
  const subjectId    = subjectParam && /^\d+$/.test(subjectParam) ? subjectParam : null;
  const subjectName  = subjectId
    ? existingSubjects.find(s => String(s.user_subject_id) === subjectId)?.subject_name ?? null
    : null;

  const refresh = useCallback(async () => {
    try {
      const bankUrl = subjectId
        ? `/api/canvas/bank?status=pending&user_subject_id=${subjectId}`
        : '/api/canvas/bank?status=pending';
      const [coursesRes, bankRes] = await Promise.all([
        fetch('/api/canvas/courses'),
        fetch(bankUrl),
      ]);
      if (coursesRes.ok) setCourses((await coursesRes.json()).courses);
      if (bankRes.ok) setBankItems((await bankRes.json()).items);
    } catch (err) {
      console.error('Failed to refresh Canvas data:', err);
    }
  }, [subjectId]);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div style={{ padding: '24px', maxWidth: '900px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 900, marginBottom: '18px' }}>Canvas Integration</h1>
      {subjectId && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px',
          background: 'rgba(116,188,217,0.14)', border: '1px solid rgba(116,188,217,0.3)',
          borderRadius: '12px', padding: '10px 16px', marginBottom: '18px',
          fontSize: '0.85rem', color: '#3a8dba', fontWeight: 600,
        }}>
          <span>Showing pending items for {subjectName ?? 'this subject'}</span>
          <Link href="/studypulse/canvas" style={{ color: '#3a8dba', fontSize: '0.8rem', fontWeight: 700, textDecoration: 'underline' }}>
            View all subjects
          </Link>
        </div>
      )}
      <CanvasConnectPanel connection={connection} onChange={refresh} />
      {connection.connected && (
        <>
          <CanvasCourseMapping courses={courses} existingSubjects={existingSubjects} onChange={refresh} />
          <CanvasActivityBank items={bankItems} onChange={refresh} />
        </>
      )}
    </div>
  );
}
