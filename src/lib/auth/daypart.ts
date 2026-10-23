/* Time-of-day "daypart" for the public auth pages (spec §6.1). Pure: no DOM access except inside the
   script string, which runs inline before first paint. */
export type Daypart = 'morning' | 'afternoon' | 'evening' | 'night';

export function daypartFor(hour: number): Daypart {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

export function isDaypart(v: unknown): v is Daypart {
  return v === 'morning' || v === 'afternoon' || v === 'evening' || v === 'night';
}

export const DAYPART_COPY: Record<Daypart, { greeting: string; login: string; signup: string }> = {
  morning:   { greeting: 'Good morning.',   login: "Let's set up the day.",                   signup: 'Free for students. Takes under a minute.' },
  afternoon: { greeting: 'Good afternoon.', login: 'Pick up where you left off.',             signup: 'Free for students. Takes under a minute.' },
  evening:   { greeting: 'Good evening.',   login: 'Time to wrap up the day.',                signup: 'Free for students. Takes under a minute.' },
  night:     { greeting: 'Still up?',       login: "Your board's ready. Don't stay too late.", signup: 'Free for students. Takes under a minute.' },
};

/** Source of the inline script that sets <html data-daypart> before first paint. Keep the hour rule in
 *  sync with daypartFor (a test enforces it). The ?daypart= override is for QA screenshots only. */
export function daypartScript(allowOverride: boolean): string {
  const override = allowOverride
    ? "var q=new URLSearchParams(location.search).get('daypart');if(q==='morning'||q==='afternoon'||q==='evening'||q==='night')d=q;"
    : '';
  return "(function(){try{var h=new Date().getHours();var d=h>=5&&h<12?'morning':h>=12&&h<17?'afternoon':h>=17&&h<21?'evening':'night';"
    + override + 'document.documentElement.dataset.daypart=d;}catch(e){}})();';
}

/** "Thursday · 2:40 PM" in the visitor's local time. */
export function formatWhen(d: Date): string {
  const day = d.toLocaleDateString('en-US', { weekday: 'long' });
  // ICU emits U+202F (narrow no-break space) before AM/PM; normalise to a plain space.
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\s+/g, ' ');
  return `${day} · ${time}`;
}
