const CLAIMS = [
  "Weighted grades per subject, on your school's 1.0 or 4.0 scale",
  "The average you need on what's left to hit your target",
  'GWA calculator that can read a screenshot of your grades',
  'Pulls deadlines from Canvas, if your school uses it',
];
// Sample GWA: (1.25·3 + 1.50·3 + 1.75·2) / 8 = 1.469 → 1.47 (spec §5.3)
const ROWS = [
  { name: 'Data Structures', units: 3, grade: '1.25' },
  { name: 'Discrete Math', units: 3, grade: '1.50' },
  { name: 'Ethics', units: 2, grade: '1.75' },
];

export default function StudyPulseSection() {
  return (
    <section className="lp-sp" aria-labelledby="lp-sp-title">
      <div>
        <p className="lp-eyebrow">StudyPulse</p>
        <h2 id="lp-sp-title" className="lp-h2">Know your grade<br /><em>before finals do.</em></h2>
        <ul className="lp-claims">{CLAIMS.map(c => <li key={c}>{c}</li>)}</ul>
      </div>
      <div className="lp-card lp-card--gwa" role="img" aria-label="Example GWA calculation (sample data): 1.47">
        <div className="lp-k">GWA calculator</div>
        {ROWS.map((r, i) => (
          <div key={r.name} className={`lp-row ${i === 0 ? 'lp-row--first' : ''}`}><span>{r.name} <small>{r.units} units</small></span><b className="lp-num">{r.grade}</b></div>
        ))}
        <div className="lp-row"><span><b>GWA</b></span><b className="lp-num lp-num--lg">1.47</b></div>
        <span className="pub-sample">Sample data</span>
      </div>
    </section>
  );
}
