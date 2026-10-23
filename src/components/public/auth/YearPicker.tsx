'use client';
import { useRef } from 'react';
import { YEAR_OPTIONS, type YearOption } from '@/lib/auth/validate';

/* Radiogroup with roving focus. Tapping the selected year again clears it (the question is optional). */
export default function YearPicker({ value, onChange }: { value: YearOption | null; onChange: (v: YearOption | null) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = value ? YEAR_OPTIONS.indexOf(value) : -1;
  const move = (i: number) => {
    const n = (i + YEAR_OPTIONS.length) % YEAR_OPTIONS.length;
    onChange(YEAR_OPTIONS[n]);
    refs.current[n]?.focus();
  };
  return (
    <div className="auth-years" role="radiogroup" aria-labelledby="year-label">
      {YEAR_OPTIONS.map((y, i) => (
        <button
          key={y} type="button" role="radio" ref={el => { refs.current[i] = el; }}
          aria-checked={value === y}
          tabIndex={current === -1 ? (i === 0 ? 0 : -1) : (current === i ? 0 : -1)}
          onClick={() => onChange(value === y ? null : y)}
          onKeyDown={e => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(i + 1); }
            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(i - 1); }
          }}
        >
          {y}
        </button>
      ))}
    </div>
  );
}
