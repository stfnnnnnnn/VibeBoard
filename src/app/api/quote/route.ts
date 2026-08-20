export const dynamic = 'force-dynamic';

export async function GET() {
  const key = process.env.QUOTES_API_KEY;
  if (!key) return Response.json({ error: 'Missing API key' }, { status: 500 });

  const res = await fetch('https://api.api-ninjas.com/v1/quotes', {
    headers: { 'X-Api-Key': key },
    next: { revalidate: 0 },
  });

  if (!res.ok) return Response.json({ error: 'Quote API error' }, { status: res.status });

  const data = await res.json();
  return Response.json(data[0] ?? null);
}
