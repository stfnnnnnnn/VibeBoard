'use client';
import { useEffect, useState } from 'react';

interface Quote { quote: string; author: string }

/** One-line quote (spec §5.3). The full text is in the title tooltip. */
export default function QuoteRow() {
  const [q, setQ] = useState<Quote | null | undefined>(undefined);
  useEffect(() => {
    fetch('/api/quote')
      .then(r => r.json())
      .then((d: Quote | null) => setQ(d?.quote ? d : null))
      .catch(() => setQ(null));
  }, []);

  return (
    <div className="db-panel db-quote" title={q ? `“${q.quote}” — ${q.author}` : undefined}>
      <span className="db-qmark" aria-hidden="true">“</span>
      {q === undefined && <span className="db-skel" style={{ flex: 1 }} />}
      {q === null && <p>Make today count.</p>}
      {q && <><p>{q.quote}</p><span className="db-qby">— {q.author}</span></>}
    </div>
  );
}
