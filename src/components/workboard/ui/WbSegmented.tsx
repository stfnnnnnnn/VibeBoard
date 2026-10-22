'use client';

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export interface SegOption<K extends string> { key: K; label: string; icon?: ReactNode }

export interface WbSegmentedProps<K extends string> {
  options: SegOption<K>[];
  value: K;
  onChange: (k: K) => void;
  ariaLabel: string;
  /** Button ids become `${idPrefix}-${key}` (the shell keeps its existing vb-view-tab ids). */
  idPrefix?: string;
  /** id of the tabpanel the tabs control. */
  controls?: string;
  /** Hide text labels below this viewport width (icon-only, aria-label keeps the name). */
  hideLabelsBelow?: number;
  /** 'view' is the Workboard view switcher's sunken track and raised pill; other uses keep the default. */
  variant?: 'default' | 'view';
}

export default function WbSegmented<K extends string>({
  options, value, onChange, ariaLabel, idPrefix = 'wb-seg', controls, hideLabelsBelow, variant = 'default',
}: WbSegmentedProps<K>) {
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);
  const [animate, setAnimate] = useState(false);

  useLayoutEffect(() => {
    const measure = () => {
      const idx = options.findIndex(o => o.key === value);
      const el = btnRefs.current[idx];
      if (el) setPill({ x: el.offsetLeft, w: el.offsetWidth });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [value, options]);

  const select = (idx: number) => {
    setAnimate(true);
    onChange(options[idx].key);
    btnRefs.current[idx]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent, idx: number) => {
    const n = options.length;
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1) % n;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (idx - 1 + n) % n;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    if (next === null) return;
    e.preventDefault();
    // Keyboard-initiated: no slide (spec 4.3 rule 3).
    setAnimate(false);
    onChange(options[next].key);
    btnRefs.current[next]?.focus();
  };

  return (
    <div role="tablist" aria-label={ariaLabel} className={variant === 'view' ? 'wb-seg wb-seg--view' : 'wb-seg'}>
      {pill && (
        <span
          aria-hidden
          className="wb-seg__pill"
          data-animate={animate ? 'true' : undefined}
          style={{ width: pill.w, transform: `translateX(${pill.x - 3}px)`, left: 3 }}
        />
      )}
      {options.map((o, idx) => {
        const selected = o.key === value;
        return (
          <button
            key={o.key}
            ref={el => { btnRefs.current[idx] = el; }}
            id={`${idPrefix}-${o.key}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={controls}
            aria-label={o.label}
            title={o.label}
            tabIndex={selected ? 0 : -1}
            className="wb-seg__btn wb-focus-ring"
            onClick={() => select(idx)}
            onKeyDown={e => onKeyDown(e, idx)}
          >
            {o.icon}
            <span className="wb-seg__label" data-label={o.label}>{o.label}</span>
          </button>
        );
      })}
      {/* Always rendered (a conditional styled-jsx block is a compile risk); max-width 0 never matches. */}
      <style jsx>{`
        @media (max-width: ${hideLabelsBelow === undefined ? 0 : hideLabelsBelow - 1}px) {
          .wb-seg__label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); }
        }
      `}</style>
    </div>
  );
}
