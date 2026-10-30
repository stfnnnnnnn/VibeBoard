'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { remainingRainChances, weatherTip } from '@/lib/dashboard/weatherTip';

const LS_KEY = 'vb_weather_city';   // same key the old WeatherWidget used, so saved cities carry over

interface WeatherData {
  location: { name: string };
  current: { temp_c: number; feelslike_c: number; condition: { text: string; icon: string } };
  forecast?: { forecastday?: { hour?: { time_epoch: number; chance_of_rain: number }[] }[] };
}
type State = { kind: 'loading' } | { kind: 'ask'; error?: string } | { kind: 'ready'; data: WeatherData };

/** Slim weather row + condition tip (spec §5.3, D11). */
export default function WeatherRow() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [city, setCity] = useState('');

  async function load(q: string) {
    setState({ kind: 'loading' });
    try {
      const r = await fetch(`/api/weather?q=${encodeURIComponent(q)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'Weather unavailable');
      setState({ kind: 'ready', data: d });
    } catch (e) {
      setState({ kind: 'ask', error: (e as Error).message });
    }
  }

  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(LS_KEY); } catch { /* storage blocked */ }
    if (saved) { load(saved); return; }
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        p => load(`${p.coords.latitude},${p.coords.longitude}`),
        () => setState({ kind: 'ask' }),
        { timeout: 8000 },
      );
    } else setState({ kind: 'ask' });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submit(e: FormEvent) {
    e.preventDefault();
    const c = city.trim();
    if (!c) return;
    try { localStorage.setItem(LS_KEY, c); } catch { /* still loads this once */ }
    load(c);
  }
  function changeCity() {
    try { localStorage.removeItem(LS_KEY); } catch { /* nothing saved */ }
    setCity('');
    setState({ kind: 'ask' });
  }

  if (state.kind === 'loading') {
    return <div className="db-panel db-weather" aria-busy="true"><span className="db-skel" style={{ flex: 1 }} /></div>;
  }
  if (state.kind === 'ask') {
    return (
      <div className="db-panel db-weather">
        <form onSubmit={submit} aria-label="Set your city for weather">
          <input value={city} onChange={e => setCity(e.target.value)} placeholder={state.error ? `${state.error} · enter a city` : 'Your city, e.g. Makati'} aria-label="City" />
          <button type="submit" className="db-pill" style={{ padding: '4px 12px', fontSize: 12 }}>Go</button>
        </form>
      </div>
    );
  }

  const { current: cur, location: loc, forecast } = state.data;
  const condition = cur.condition.text.trim();
  const tip = weatherTip({
    conditionText: condition, tempC: cur.temp_c, feelsLikeC: cur.feelslike_c,
    upcomingRainChances: remainingRainChances(forecast?.forecastday?.[0]?.hour, Date.now() / 1000),
  });

  return (
    <div className="db-panel db-weather">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`https:${cur.condition.icon}`} alt="" width={28} height={28} />
      <span className="db-wtemp">{Math.round(cur.temp_c)}°</span>
      <button type="button" className="db-wcond" onClick={changeCity} title={`${loc.name} · change city`}>
        {condition} · Feels {Math.round(cur.feelslike_c)}°
      </button>
      <span className={`db-tip db-tip-${tip.tone}`} title={tip.text}><span aria-hidden="true">{tip.icon}</span> {tip.text}</span>
    </div>
  );
}
