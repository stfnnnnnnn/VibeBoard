'use client';

import { useRef, type KeyboardEvent } from 'react';

export interface SegOption<T extends string | number> { value: T; label: string }

/** Single-select segmented control: role=radiogroup with roving tabindex and arrow keys (spec §8). */
export default function SpSegmented<T extends string | number>({
  options, value, onChange, label, size = 'md',
}: {
  options: SegOption<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  size?: 'md' | 'sm';
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const active = options.findIndex(o => o.value === value);

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const next = (i + dir + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div role="radiogroup" aria-label={label} className={`sp-seg${size === 'sm' ? ' sp-seg--sm' : ''}`}>
      {options.map((o, i) => (
        <button
          key={String(o.value)}
          ref={el => { refs.current[i] = el; }}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={(active < 0 ? i === 0 : i === active) ? 0 : -1}
          className="sp-seg__opt sp-focus-ring"
          onClick={() => onChange(o.value)}
          onKeyDown={e => onKey(e, i)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
