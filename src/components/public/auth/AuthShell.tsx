import { VibeBoardLogo } from '@/components/brand/VibeBoardLogo';

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
          <VibeBoardLogo size="md" href="/" />
          {topRight}
        </header>
        <main className="auth-main">
          <div className="auth-card">{children}</div>
        </main>
      </div>
    </div>
  );
}
