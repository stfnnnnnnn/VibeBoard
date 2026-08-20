'use client';

import { useState, useEffect, useCallback } from 'react';
import CanvasConnectPanel, { type ConnectionStatus } from '@/components/studypulse/CanvasConnectPanel';
import CanvasCourseMapping from '@/components/studypulse/CanvasCourseMapping';
import CanvasActivityBank from '@/components/studypulse/CanvasActivityBank';

export default function CanvasClientShell({
  initialConnection, existingSubjects,
}: {
  initialConnection: ConnectionStatus;
  existingSubjects: { user_subject_id: number; subject_name: string }[];
}) {
  const [connection] = useState(initialConnection);
  const [courses, setCourses]     = useState<never[]>([]);
  const [bankItems, setBankItems] = useState<never[]>([]);

  const refresh = useCallback(async () => {
    try {
      const [coursesRes, bankRes] = await Promise.all([
        fetch('/api/canvas/courses'),
        fetch('/api/canvas/bank?status=pending'),
      ]);
      if (coursesRes.ok) setCourses((await coursesRes.json()).courses);
      if (bankRes.ok) setBankItems((await bankRes.json()).items);
    } catch (err) {
      console.error('Failed to refresh Canvas data:', err);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div style={{ padding: '24px', maxWidth: '900px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 900, marginBottom: '18px' }}>Canvas Integration</h1>
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
