'use client';

import { useState, useEffect, useCallback } from 'react';
import CanvasActivityBank from '@/components/studypulse/CanvasActivityBank';

interface BankItem {
  id: number;
  name: string;
  due_at: string | null;
  points_possible: number | null;
  submission_status: string | null;
  submission_score: number | null;
  course_name: string;
  user_subject_id: number | null;
  subject_mode?: 'legacy' | 'custom';
}

export default function SubjectActivityBankPanel({ userSubjectId }: { userSubjectId: number }) {
  const [items, setItems] = useState<BankItem[]>([]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/canvas/bank?status=pending&user_subject_id=${userSubjectId}`);
      if (res.ok) setItems((await res.json()).items);
      else setItems([]);
    } catch (err) {
      // No Canvas connection (or a transient failure) — treat the same as "nothing pending"
      // so this stays a quiet, optional panel rather than an error state.
      console.error('Failed to load subject Canvas bank:', err);
      setItems([]);
    }
  }, [userSubjectId]);

  useEffect(() => { refresh(); }, [refresh]);

  if (items.length === 0) return null;

  return <CanvasActivityBank items={items} onChange={refresh} />;
}
