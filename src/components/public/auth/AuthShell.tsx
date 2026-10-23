import Link from 'next/link';

/* Sky + top bar + centred card (spec §6). The sky follows <html data-daypart> via public.css. */
export default function AuthShell({ topRight, children }: { topRight: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="pub-root">
      <div className="auth-shell">
        <div className="auth-sky" aria-hidden="true">
          <div className="auth-stars" />
          <div className="auth-glow auth-glow--a" />
          <div className="auth-glow auth-glow--b" />
          <div className="auth-glow auth-glow--c" />
        </div>
        <header className="auth-top">
          <Link href="/" className="pub-logo" aria-label="VibeBoard home"><b>Vibe</b><i>Board</i></Link>
          {topRight}
        </header>
        <main className="auth-main">
          <div className="auth-card">{children}</div>
        </main>
      </div>
    </div>
  );
}
