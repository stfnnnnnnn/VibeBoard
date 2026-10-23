import Link from 'next/link';

export default function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <div className="pub-root lp lp-legal">
      <header className="lp-nav"><Link href="/" className="pub-logo" aria-label="VibeBoard home"><b>Vibe</b><i>Board</i></Link></header>
      <main className="lp-legal__body">
        <h1 className="lp-h2">{title}</h1>
        <p className="lp-mute">Last updated {updated}</p>
        {children}
      </main>
    </div>
  );
}
