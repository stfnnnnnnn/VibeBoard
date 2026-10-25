import Link from 'next/link';
import { VibeBoardLogo } from '@/components/brand/VibeBoardLogo';

export default function LandingNav() {
  return (
    <header className="lp-nav">
      <VibeBoardLogo size="md" href="/" />
      <nav aria-label="Account" className="lp-nav__actions">
        <Link href="/login" className="lp-btn">Log in</Link>
        <Link href="/signup" className="lp-btn lp-btn--dark">Get started</Link>
      </nav>
    </header>
  );
}
