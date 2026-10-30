import { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q');
  if (!q) return Response.json({ error: 'Missing q parameter' }, { status: 400 });

  const key = process.env.WEATHER_API_KEY;
  if (!key) return Response.json({ error: 'Missing API key' }, { status: 500 });

  // forecast.json returns the same `location` + `current` blocks as current.json, plus today's
  // hourly chance_of_rain for the "rain later" tip. Still one request.
  const res = await fetch(
    `https://api.weatherapi.com/v1/forecast.json?key=${key}&q=${encodeURIComponent(q)}&days=1&aqi=no&alerts=no`,
    { next: { revalidate: 300 } },
  );

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return Response.json({ error: body?.error?.message ?? 'Weather API error' }, { status: res.status });
  }

  return Response.json(await res.json());
}
