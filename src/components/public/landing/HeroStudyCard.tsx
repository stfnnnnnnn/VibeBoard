const BARS: { code: string; pct: number; best?: boolean }[] = [
  { code: 'ETHICS', pct: 62 }, { code: 'DISCMATH', pct: 74 }, { code: 'CALC2', pct: 58 }, { code: 'OOP', pct: 80 }, { code: 'DSA', pct: 94, best: true },
];

export default function HeroStudyCard() {
  return (
    <div className="lp-hero-visual" aria-label="Example StudyPulse grade summary with reminders: quiz 4 on Friday, reading day 12. Calc 2 is 60% graded and needs a 79% average on its 3 remaining items to finish at 2.50 (sample data)" role="img">
      <div className="lp-card lp-card--hero" data-reveal="card">
        <div className="lp-k">StudyPulse · 2nd Trimester</div>
        <div className="lp-big"><span data-countup="1.42">1.42</span></div>
        <div className="lp-mute">Midterm GPA estimate</div>
        <div className="lp-bars" aria-hidden="true">
          {BARS.map(b => (
            <div key={b.code}><i className={b.best ? 'is-best' : ''} style={{ height: `${b.pct}%` }} /><span>{b.code}</span></div>
          ))}
        </div>
        {/* Mirrors the subject page's "% of grade in" and the Target planner's sentence: 0.6 × 84 + 0.4 × 79 = 82.0 → 2.50. */}
        <div className="lp-need">
          <div className="lp-need__top"><span><b>Calc 2</b> · <span className="lp-num">60%</span> of grade in</span><span className="lp-tag lp-tag--green">Achievable</span></div>
          <div className="lp-need__bar" aria-hidden="true"><i /></div>
          <p>Average <b className="lp-num">79%</b> on your <b>3 items</b> to finish at <b className="lp-num">2.50</b></p>
        </div>
      </div>
      <span className="lp-chip lp-chip--float lp-chip--quiz"><span className="dot" style={{ background: 'var(--pub-pink)' }} />Quiz 4 · Fri</span>      <span className="lp-chip lp-chip--float lp-chip--habit"><span className="dot" style={{ background: 'var(--pub-green)' }} />Reading · day 12</span>
    </div>
  );
}
