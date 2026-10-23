const MOMENTS = [
  { time: '7:30 AM', tag: 'Study', tone: 'pink', lead: 'Quiz today.', rest: 'Already on your board.' },
  { time: '12:10 PM', tag: 'Money', tone: 'blue', lead: '₱95 lunch', rest: 'logged in seconds.' },
  { time: '4:00 PM', tag: 'Work', tone: 'lav', lead: 'Org deck', rest: 'moved to Thursday.' },
  { time: '10:00 PM', tag: 'Habits', tone: 'green', lead: 'Day 12', rest: 'of your reading streak.' },
] as const;

export default function DayArc() {
  return (
    <section className="lp-day" aria-labelledby="lp-day-title">
      <p className="lp-eyebrow">A day with VibeBoard</p>
      <h2 id="lp-day-title" className="lp-h2">Every part of your day, <em>a few seconds each.</em></h2>
      <div className="lp-arc" data-arc>
        <svg className="lp-arc__svg" viewBox="0 0 400 200" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="lp-arc-grad" x1="0" x2="1"><stop offset="0" stopColor="#f2a7c0" /><stop offset=".5" stopColor="#91cbe6" /><stop offset="1" stopColor="#a99ad8" /></linearGradient>
          </defs>
          <path d="M0,180 C90,20 310,20 400,180" fill="none" stroke="url(#lp-arc-grad)" strokeWidth="3" strokeDasharray="2 6" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
        <span className="lp-arc__sun" aria-hidden="true" />
        <ol className="lp-moments">
          {MOMENTS.map(m => (
            <li key={m.time} className="lp-moment">
              <span className="lp-time">{m.time}</span>
              <div className="lp-card lp-card--moment">
                <span className={`lp-tag lp-tag--${m.tone}`}>{m.tag}</span>
                <p><b>{m.lead}</b> {m.rest}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
