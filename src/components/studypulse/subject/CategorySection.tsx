'use client';

import { useState } from 'react';
import { ChevronDown, Link2, Plus } from 'lucide-react';
import type { TransmutationTable } from '@/lib/transmutation';
import type { EntryRow } from '@/lib/studypulse/types';
import { averageOf, entryHasGrade } from '@/lib/studypulse/periodModel';
import { f1, gradeTone } from '@/lib/studypulse/ui/format';
import EntryTable, { newRowKey, type EntryPersistence, type EntryRowsChange, type TypeColumn } from './EntryTable';
import SingletonScore from './SingletonScore';

export interface CategorySectionProps {
  name: string;
  weight: number | null;
  color: string;
  noun: string;
  singleton: boolean;
  entries: EntryRow[];
  onChange: EntryRowsChange;
  persistence: EntryPersistence;
  typeColumn?: TypeColumn;
  defaultType?: string;
  transTable: TransmutationTable | null;
  transmutationOn: boolean;
  sharedFrom?: { periodName: string; grade: number } | null;
}

export default function CategorySection(p: CategorySectionProps) {
  const [open, setOpen] = useState(true);
  const table = p.transmutationOn ? p.transTable : null;
  const avg = averageOf(p.entries, table);
  const graded = p.entries.filter(entryHasGrade).length;
  const tone = gradeTone(avg);

  const addRow = () => {
    setOpen(true);
    p.onChange(prev => [...prev, {
      id: 0, _key: newRowKey(), name: '', specificType: p.defaultType ?? '', urgency: 'Low', status: 'Pending',
      deadline: '', accomplished_at: '', score: '', items: '', grade: null,
    }]);
  };

  return (
    <section className="sp-item sp-cat" aria-label={p.name}>
      <div className="sp-cat__head">
        <span className="sp-cat__name"><span className="sp-cat__swatch" style={{ background: p.color }} aria-hidden />{p.name}</span>
        {p.weight !== null && <span className="sp-chip sp-chip--blue sp-num">{p.weight}%</span>}
        <span className="sp-cat__prog sp-num">{p.singleton ? 'single score' : `${graded} of ${p.entries.length} graded`}</span>
        <div className="sp-cat__right">
          <span className={`sp-avg sp-avg--${tone} sp-num`}>{avg === null ? 'Not yet' : <>{f1(avg)}<small>avg</small></>}</span>
          {!p.singleton && <button type="button" className="sp-add sp-focus-ring" onClick={addRow}><Plus size={14} /> Add {p.noun.toLowerCase()}</button>}
          {!p.singleton && (
            <button type="button" className="sp-icon-btn sp-focus-ring" aria-expanded={open} aria-label={open ? `Collapse ${p.name}` : `Expand ${p.name}`} onClick={() => setOpen(o => !o)}>
              <ChevronDown size={16} className={`sp-chev${open ? ' is-open' : ''}`} />
            </button>
          )}
        </div>
      </div>
      {p.sharedFrom && !p.entries.some(entryHasGrade) && (
        <div className="sp-shared"><Link2 size={14} aria-hidden /> Using {p.sharedFrom.periodName}&apos;s score ({f1(p.sharedFrom.grade)}). Add your own to override it for this period.</div>
      )}
      {p.singleton ? (
        <SingletonScore name={p.name} entries={p.entries} onChange={p.onChange} persistence={p.persistence} transTable={p.transTable} transmutationOn={p.transmutationOn} />
      ) : (
        <div className={`sp-collapse${open ? ' is-open' : ''}`}>
          <div className="sp-collapse__inner">
            {p.entries.length === 0
              ? <p className="sp-cat__empty">No {p.noun.toLowerCase()} entries yet.</p>
              : <EntryTable entries={p.entries} onChange={p.onChange} persistence={p.persistence} typeColumn={p.typeColumn} transTable={p.transTable} transmutationOn={p.transmutationOn} />}
          </div>
        </div>
      )}
    </section>
  );
}
