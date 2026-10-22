'use client';

import type { WorkItem, WorkCategory } from '@/lib/workboard/workItems';
import type { WorkStage } from '@/lib/workboard/workContexts';

export function writeUrl(item: WorkItem): string {
  return item.source === 'owned'
    ? `/api/workboard/work-items/${item.id}`
    : `/api/workboard/academic/${item.source}/${item.id}`;
}

export function patchItem(item: WorkItem, body: Record<string, unknown>): Promise<Response> {
  return fetch(writeUrl(item), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export interface CreateOwnedBody {
  category: WorkCategory;
  title: string;
  user_subject_id?: number | null;
  due_at?: string | null;
  work_stage?: WorkStage;
}

export async function createOwnedItem(
  body: CreateOwnedBody,
): Promise<{ ok: true; itemId: number } | { ok: false; error: string }> {
  try {
    const res = await fetch('/api/workboard/work-items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: typeof data.error === 'string' ? data.error : 'Could not save' };
    return { ok: true, itemId: data.item_id };
  } catch {
    return { ok: false, error: 'Network error' };
  }
}

export function deleteOwnedItem(id: number, opts: { keepalive?: boolean } = {}): Promise<Response> {
  return fetch(`/api/workboard/work-items/${id}`, { method: 'DELETE', keepalive: opts.keepalive });
}
