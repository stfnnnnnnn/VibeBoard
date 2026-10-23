import Link from 'next/link';

export default function LandingFooter() {
  return (
    <footer className="lp-foot">
      <span>© 2026 VibeBoard · Made by students, for students</span>
      <nav aria-label="Legal"><Link href="/privacy">Privacy</Link> · <Link href="/terms">Terms</Link></nav>
    </footer>
  );
}
