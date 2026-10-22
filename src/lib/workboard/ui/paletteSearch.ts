/** Pure result builder for the Ctrl+K palette (spec 13). Pool-free. */
import type { WorkItem } from '@/lib/workboard/workItems';
import type { WorkContext } from '@/lib/workboard/workContexts';
import { itemKey } from '@/lib/workboard/ui/itemKey';

export type PaletteScope = 'all' | 'items' | 'goto' | 'create';
export type PaletteViewKey = 'list' | 'table' | 'board' | 'timeline';

export type PaletteRow =
  | { kind: 'item'; item: WorkItem; matchStart: number; matchLen: number }
  | { kind: 'goto-view'; view: PaletteViewKey; label: string }
  | { kind: 'goto-context'; context: WorkContext | 'all'; label: string }
  | { kind: 'create'; type: 'task' | 'event' | 'reminder'; title: string }
  | { kind: 'show-all'; count: number };

export interface PaletteGroup { heading: string; count?: number; rows: PaletteRow[] }

const VIEWS: { view: PaletteViewKey; label: string }[] = [
  { view: 'list', label: 'Focus view' }, { view: 'table', label: 'Table view' },
  { view: 'board', label: 'Board view' }, { view: 'timeline', label: 'Timeline view' },
];
const CONTEXTS: { context: WorkContext | 'all'; label: string }[] = [
  { context: 'all', label: 'My Work' }, { context: 'academic', label: 'Academic' },
  { context: 'project', label: 'Projects' }, { context: 'organization', label: 'Organization' },
  { context: 'life', label: 'Life' },
];
export const MAX_ITEMS = 6;

export function buildPaletteGroups({ query, scope, items, recentKeys }: {
  query: string; scope: PaletteScope; items: WorkItem[]; recentKeys: string[];
}): PaletteGroup[] {
  const q = query.trim().toLowerCase();
  const groups: PaletteGroup[] = [];
  const want = (s: PaletteScope) => scope === 'all' || scope === s;

  if (want('items')) {
    if (q === '') {
      const byKey = new Map(items.map(i => [itemKey(i), i]));
      const recent = recentKeys.map(k => byKey.get(k)).filter((i): i is WorkItem => i !== undefined).slice(0, 5);
      if (recent.length) groups.push({ heading: 'Recent', rows: recent.map(item => ({ kind: 'item', item, matchStart: -1, matchLen: 0 })) });
    } else {
      const matches = items
        .map(item => ({ item, at: item.title.toLowerCase().indexOf(q) }))
        .filter(m => m.at >= 0)
        .sort((a, b) => (a.at === 0 ? 0 : 1) - (b.at === 0 ? 0 : 1) || a.item.title.localeCompare(b.item.title));
      if (matches.length) {
        const rows: PaletteRow[] = matches.slice(0, MAX_ITEMS).map(m => ({ kind: 'item', item: m.item, matchStart: m.at, matchLen: q.length }));
        if (matches.length > MAX_ITEMS) rows.push({ kind: 'show-all', count: matches.length });
        groups.push({ heading: 'Items', count: matches.length, rows });
      }
    }
  }

  if (want('goto')) {
    const rows: PaletteRow[] = [
      ...VIEWS.filter(v => !q || v.label.toLowerCase().includes(q)).map(v => ({ kind: 'goto-view' as const, ...v })),
      ...CONTEXTS.filter(c => !q || c.label.toLowerCase().includes(q)).map(c => ({ kind: 'goto-context' as const, ...c })),
    ];
    if (rows.length) groups.push({ heading: 'Go to', count: q ? rows.length : undefined, rows });
  }

  if (want('create')) {
    const title = query.trim();
    const rows: PaletteRow[] = title
      ? [{ kind: 'create', type: 'task', title }, { kind: 'create', type: 'event', title }]
      : [{ kind: 'create', type: 'task', title: '' }, { kind: 'create', type: 'event', title: '' }, { kind: 'create', type: 'reminder', title: '' }];
    groups.push({ heading: 'Create', rows });
  }

  return groups;
}
