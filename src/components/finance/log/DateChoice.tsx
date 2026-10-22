'use client';

import { useRef, useState } from 'react';
import WbPopover from '@/components/workboard/ui/WbPopover';
import { addDays, formatDay } from '@/lib/finance/dates';

/* "Today ▾" chip in the composer: Today / Yesterday / a picked date. A future date is fine;
   the server files it under Upcoming (spec §7.2). */
export default function DateChoice({ value, onChange, today }: { value: string; onChange: (d: string) => void; today: string }) {
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const pick = (d: string) => { onChange(d); setOpen(false); btn.current?.focus(); };
  return (
    <>
      <button ref={btn} type="button" className="fin-chip is-on-blue" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        {formatDay(value, today)} ▾
      </button>
      <WbPopover open={open} anchor={btn.current} onClose={() => setOpen(false)} width={220} ariaLabel="When did this happen?">
        <div className="fin-datechoice">
          <button type="button" className="fin-datechoice__opt" onClick={() => pick(today)}>Today</button>
          <button type="button" className="fin-datechoice__opt" onClick={() => pick(addDays(today, -1))}>Yesterday</button>
          <label className="fin-field-label" htmlFor="fin-date-pick">Pick a date</label>
          <div className="fin-field"><input id="fin-date-pick" type="date" value={value} onChange={e => e.target.value && pick(e.target.value)} /></div>
        </div>
      </WbPopover>
    </>
  );
}
