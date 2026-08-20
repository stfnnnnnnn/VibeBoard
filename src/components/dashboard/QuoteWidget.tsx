'use client';

import { useState, useEffect } from 'react';

interface Quote {
  quote:  string;
  author: string;
}

export default function QuoteWidget() {
  const [quote,   setQuote]   = useState<Quote | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/quote')
      .then((r) => r.json())
      .then((data: Quote | null) => { if (data?.quote) setQuote(data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <p className="text-gray-400 text-sm italic">Loading inspirational quote…</p>;
  }

  if (!quote) {
    return <p className="text-gray-400 text-sm">No quote available at the moment.</p>;
  }

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif" }}>
      <p className="text-[15px] leading-[1.65] text-[#333] text-left font-medium">
        &ldquo;{quote.quote}&rdquo;
      </p>
      <p className="text-[15px] text-[#888] mt-3 text-left">
        — {quote.author}
      </p>
    </div>
  );
}
