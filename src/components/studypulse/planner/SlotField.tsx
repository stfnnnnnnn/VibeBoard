'use client';

import { useState } from 'react';

/** One sandbox slot: a decimal text field and a slider kept in sync (spec §6.5.5). */
export default function SlotField({ name, planned, dirty, value, onChange }: {
  name: string; planned: boolean; dirty: boolean; value: number; onChange: (v: number) => void;
}) {
  // A draft exists only while typing. The field otherwise renders `value` directly, so dragging the slider
  // updates the number in the same render (a synced-by-effect draft trailed the thumb by a frame).
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (s: string) => {
    const v = parseFloat(s);
    if (Number.isFinite(v)) onChange(Math.max(0, Math.min(100, Math.round(v * 10) / 10)));
  };
  const label = `${name}${planned ? ' (planned)' : ''} score`;
  return (
    <div className={`sp-slot${planned ? ' sp-slot--planned' : ''}${dirty ? ' sp-slot--dirty' : ''}`}>
      <div className="sp-slot__name" title={name}>{name}{planned ? ' · planned' : ''}</div>
      <div className="sp-slot__val sp-num">
        <input type="text" inputMode="decimal" enterKeyHint="done" aria-label={label} value={draft ?? String(value)}
          onChange={e => { setDraft(e.target.value); commit(e.target.value); }}
          onBlur={() => setDraft(null)} />
        <span>%</span>
      </div>
      <input type="range" min={0} max={100} step={0.1} value={value} aria-label={label} aria-valuetext={`${value} percent`}
        onChange={e => onChange(parseFloat(e.target.value))} />
    </div>
  );
}
