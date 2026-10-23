import HeroStudyCard from './HeroStudyCard';

export default function Hero() {
  return (
    <section className="lp-hero" aria-labelledby="lp-title">
      <div className="lp-hero__copy">
        <p className="lp-triad" data-reveal>Plan it. <b>Track it.</b> Ace it.</p>
        <h1 id="lp-title" className="lp-h1" data-reveal>Ace the semester.<br /><em>Keep the rest in check.</em></h1>
        <p className="lp-lede" data-reveal>Your grades come first. Deadlines, money and habits sit right beside them, each one a few taps away.</p>
      </div>
      <HeroStudyCard />
    </section>
  );
}
