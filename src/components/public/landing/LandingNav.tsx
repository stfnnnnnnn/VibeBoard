import Link from 'next/link';

export default function LandingNav() {
  return (
    <header className="lp-nav">
      <Link href="/" className="pub-logo" aria-label="VibeBoard home"><b>Vibe</b><i>Board</i></Link>
      <nav aria-label="Account" className="lp-nav__actions">
        <Link href="/login" className="lp-btn">Log in</Link>
        <Link href="/signup" className="lp-btn lp-btn--dark">Get started</Link>
      </nav>
    </header>
  );
}
