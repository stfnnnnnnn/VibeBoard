import { VibeBoardLogo } from '@/components/brand/VibeBoardLogo';

export default function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <div className="pub-root lp lp-legal">
      <header className="lp-nav"><VibeBoardLogo size="md" href="/" /></header>
      <main className="lp-legal__body">
        <h1 className="lp-h2">{title}</h1>
        <p className="lp-mute">Last updated {updated}</p>
        {children}
      </main>
    </div>
  );
}
