'use client';
import { Check } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface FieldProps {
  id: string;
  label: string;
  icon?: LucideIcon;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  error?: React.ReactNode;
  hint?: React.ReactNode;
  /** Announce hint changes (default). Off for hints that change on every keystroke, like the password meter. */
  hintLive?: boolean;
  warn?: boolean;
  valid?: boolean;
  autoComplete?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  placeholder?: string;
  labelAside?: React.ReactNode;
  readOnly?: boolean;
  required?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
  trailing?: React.ReactNode;
}

/* Labelled input with icon, inline hint/error wired via aria-describedby (spec §6.2, §10). Both message regions stay
   mounted (empty when there is nothing to say), so the first error is announced: a live region that appears together
   with its text is often missed by screen readers. The error replaces the hint visually, as before. */
export default function Field(p: FieldProps) {
  const hint = p.error ? null : p.hint;
  const describedBy = [p.error && `${p.id}-msg`, hint && `${p.id}-hint`].filter(Boolean).join(' ') || undefined;
  const state = p.error ? 'is-invalid' : p.warn ? 'is-warn' : p.valid ? 'is-valid' : '';
  const Icon = p.icon;
  return (
    <div className="auth-field">
      <div className="auth-label">
        <label htmlFor={p.id}>{p.label}</label>
        {p.labelAside}
      </div>
      <div className={`auth-control ${state} ${p.readOnly ? 'is-readonly' : ''}`}>
        {Icon && <Icon size={17} aria-hidden="true" />}
        <input
          id={p.id}
          ref={p.inputRef}
          type={p.type ?? 'text'}
          value={p.value}
          onChange={e => p.onChange(e.target.value)}
          onBlur={p.onBlur}
          autoComplete={p.autoComplete}
          inputMode={p.inputMode}
          placeholder={p.placeholder}
          readOnly={p.readOnly}
          required={p.required}
          aria-invalid={p.error ? true : undefined}
          aria-describedby={describedBy}
          spellCheck={false}
        />
        {p.trailing}
        {p.valid && !p.error && !p.trailing && <Check size={17} className="auth-ok" aria-hidden="true" />}
      </div>
      <p id={`${p.id}-msg`} className="auth-hint is-error" aria-live="polite">{p.error}</p>
      <p id={`${p.id}-hint`} className={`auth-hint ${p.warn ? 'is-warn' : ''}`} aria-live={p.hintLive === false ? 'off' : 'polite'}>{hint}</p>
    </div>
  );
}
