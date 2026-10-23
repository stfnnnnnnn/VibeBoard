import Link from 'next/link';
import GoogleButton from '@/components/public/auth/GoogleButton';

const OLD_WAY = ['Grades in a spreadsheet', 'Deadlines in 3 group chats', 'Budget in your head', 'Habits on sticky notes'];

export default function ProblemCta() {
  return (
    <section className="lp-problem" aria-labelledby="lp-problem-title">
      <p className="lp-eyebrow lp-eyebrow--mute">Sound familiar?</p>
      <h2 id="lp-problem-title" className="lp-h2">Five apps for one semester.</h2>
      <ul className="lp-xchips" data-xchips>
        {OLD_WAY.map(t => <li key={t} className="lp-chip lp-x"><span aria-hidden="true" className="lp-xmark">✕</span>{t}</li>)}
      </ul>
      <div className="lp-cta">
        <h2 className="lp-h2 lp-h2--big">Make this your <em>calmest semester.</em></h2>
        <p className="lp-mute lp-mute--lg">One board for grades, deadlines, money and habits.</p>
        <div className="lp-cta__buttons">
          <Link href="/signup" className="lp-btn lp-btn--dark lp-btn--lg">Create free account</Link>
          <div className="lp-cta__google"><GoogleButton /></div>
        </div>
        <p className="lp-reassure"><span>Free for students</span><span>Sign up in under a minute</span></p>
      </div>
    </section>
  );
}
