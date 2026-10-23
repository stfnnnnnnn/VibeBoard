const BARS: { code: string; pct: number; best?: boolean }[] = [
  { code: 'ETHICS', pct: 62 }, { code: 'DISCMATH', pct: 74 }, { code: 'CALC2', pct: 58 }, { code: 'OOP', pct: 80 }, { code: 'DSA', pct: 94, best: true },
];

export default function HeroStudyCard() {
  return (
    <div className="lp-hero-visual" aria-label="Example of a StudyPulse grade summary (sample data)" role="img">
      <div className="lp-card lp-card--hero" data-reveal="card">
        <div className="lp-k">StudyPulse · 2nd Trimester</div>
        <div className="lp-big"><span data-countup="1.42">1.42</span></div>
        <div className="lp-mute">Midterm GWA estimate</div>
        <div className="lp-bars" aria-hidden="true">
          {BARS.map(b => (
            <div key={b.code}><i className={b.best ? 'is-best' : ''} style={{ height: `${b.pct}%` }} /><span>{b.code}</span></div>
          ))}
        </div>
        <div className="lp-row"><span>Calc 2 · need on what&apos;s left</span><span><b className="lp-num">78%</b> <span className="lp-tag lp-tag--green">Achievable</span></span></div>
        <span className="pub-sample">Sample data</span>
      </div>
      <span className="lp-chip lp-chip--float" style={{ right: 0, top: -10 }}><span className="dot" style={{ background: 'var(--pub-pink)' }} />Quiz 4 · Fri</span>
      <span className="lp-chip lp-chip--float" style={{ left: -18, bottom: 54 }}><span className="dot" style={{ background: 'var(--pub-blue)' }} />₱420 safe to spend</span>
      <span className="lp-chip lp-chip--float" style={{ right: 8, bottom: -2 }}><span className="dot" style={{ background: 'var(--pub-green)' }} />Reading · day 12</span>
    </div>
  );
}
