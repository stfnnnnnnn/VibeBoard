'use client';

export interface WbCheckboxProps {
  checked: boolean | 'mixed';
  onChange: (next: boolean, e: React.MouseEvent | React.KeyboardEvent) => void;
  shape: 'round' | 'square';
  /** High-priority ring (spec 6). */
  ring?: boolean;
  label: string;
  disabled?: boolean;
  className?: string;
  /** Box size in px. Omitted, the box keeps the stylesheet's size (16px in a 24px target). */
  size?: number;
}

export default function WbCheckbox({ checked, onChange, shape, ring, label, disabled, className, size }: WbCheckboxProps) {
  const next = checked !== true;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`wb-check wb-check--${shape}${ring ? ' wb-check--ring' : ''} wb-focus-ring${className ? ` ${className}` : ''}`}
      onClick={e => { e.stopPropagation(); onChange(next, e); }}
    >
      <span className="wb-check__box" aria-hidden style={size ? { width: size, height: size } : undefined}>
        {checked === 'mixed' ? (
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 5h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ color: 'var(--wb-inverse-text)' }} /></svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path className="wb-check__mark" d="M1.5 5.2 4 7.5 8.5 2.5" stroke="var(--wb-inverse-text)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
    </button>
  );
}
