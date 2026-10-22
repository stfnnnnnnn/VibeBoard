// src/components/finance/ui/PesoField.tsx
'use client';

import type { RefObject } from 'react';

/* Labelled amount input with a ₱ (or %) prefix; decimal keypad on phones, 16px on phones
   so iOS never zooms (spec §7.1). */
export default function PesoField({ id, label, value, onChange, placeholder = '0.00', prefix = '₱', autoFocus, inputRef, error }: {
  id: string; label: string; value: string; onChange: (v: string) => void; placeholder?: string; prefix?: string;
  autoFocus?: boolean; inputRef?: RefObject<HTMLInputElement | null>; error?: string;
}) {
  return (
    <div>
      <label className="fin-field-label" htmlFor={id}>{label}</label>
      <div className="fin-field">
        <span className="fin-field__prefix" aria-hidden>{prefix}</span>
        <input
          id={id} ref={inputRef} inputMode="decimal" autoComplete="off" placeholder={placeholder} value={value}
          autoFocus={autoFocus} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-err` : undefined}
          onChange={e => onChange(e.target.value)}
        />
      </div>
      {error && <p className="fin-error" id={`${id}-err`} role="alert">{error}</p>}
    </div>
  );
}
