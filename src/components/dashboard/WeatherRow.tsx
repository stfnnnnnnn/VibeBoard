'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { remainingRainChances, weatherTip } from '@/lib/dashboard/weatherTip';

const LS_KEY = 'vb_weather_city';   // same key the old WeatherWidget used, so saved cities carry over

interface WeatherData {
  location: { name: string };
  current: { temp_c: number; feelslike_c: number; humidity: number; wind_kph: number; condition: { text: string; icon: string } };
  forecast?: { forecastday?: { hour?: { time_epoch: number; chance_of_rain: number }[] }[] };
}
type State = { kind: 'loading' } | { kind: 'ask'; error?: string } | { kind: 'ready'; data: WeatherData };

/** Weather card filling the band's right column + condition tip (spec §5.3, D11; v9). */
export default function WeatherRow() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [city, setCity] = useState('');

  async function load(q: string) {
    setState({ kind: 'loading' });
    let r: Response, d: unknown;
    try {
      r = await fetch(`/api/weather?q=${encodeURIComponent(q)}`);
      d = await r.json();
    } catch {
      // Network failure or a non-JSON body: never surface the raw exception text.
      setState({ kind: 'ask', error: 'Weather unavailable' });
      return;
    }
    if (!r.ok) {
      const msg = (d as { error?: unknown } | null)?.error;
      setState({ kind: 'ask', error: typeof msg === 'string' && msg ? msg : 'Weather unavailable' });
      return;
    }
    setState({ kind: 'ready', data: d as WeatherData });
  }

  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(LS_KEY); } catch { /* storage blocked */ }
    if (saved) { load(saved); return; }
    if (!('geolocation' in navigator)) { setState({ kind: 'ask' }); return; }
    // The geolocation timeout only starts once permission is granted, so an ignored prompt would
    // shimmer forever. After ~10s, fall back to the city form; a late success still loads weather.
    let fellBack = false;
    const fallback = window.setTimeout(() => {
      fellBack = true;
      setState(s => (s.kind === 'loading' ? { kind: 'ask' } : s));
    }, 10000);
    navigator.geolocation.getCurrentPosition(
      p => { window.clearTimeout(fallback); load(`${p.coords.latitude},${p.coords.longitude}`); },
      // After the fallback the form is already up (and may be mid-load on a typed city): leave it be.
      () => { window.clearTimeout(fallback); if (!fellBack) setState({ kind: 'ask' }); },
      { timeout: 8000 },
    );
    return () => window.clearTimeout(fallback);
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
    return (
      <div className="db-panel db-weather" aria-busy="true">
        <span className="db-skel" style={{ width: '60%', height: 30 }} />
        <span className="db-skel" style={{ height: 26, borderRadius: 12 }} />
      </div>
    );
  }
  if (state.kind === 'ask') {
    return (
      <div className="db-panel db-weather">
        <form onSubmit={submit} aria-label="Set your city for weather">
          <input value={city} onChange={e => setCity(e.target.value)} placeholder={state.error ? `${state.error} · enter a city` : 'Your city, e.g. Makati'} aria-label="City" />
          <button type="submit" className="db-btn">Go</button>
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
      <div className="db-wtop">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`https:${cur.condition.icon}`} alt="" width={40} height={40} />
        <span className="db-wtemp">{Math.round(cur.temp_c)}°</span>
        <div className="db-wdesc">
          <button type="button" className="db-wcond" onClick={changeCity} title={`${loc.name} · change city`}
            aria-label={`${condition}, feels ${Math.round(cur.feelslike_c)}°. Change city (${loc.name})`}>
            {condition}
          </button>
          <span>{loc.name} · Feels {Math.round(cur.feelslike_c)}°</span>
        </div>
        <div className="db-wmeta">
          <span><span aria-hidden="true">💧</span> {cur.humidity}%</span>
          <span><span aria-hidden="true">🌬</span> {Math.round(cur.wind_kph)} km/h</span>
        </div>
      </div>
      <div className={`db-tip db-tip-${tip.tone}`} title={tip.text}>
        <span aria-hidden="true">{tip.icon}</span><span className="db-tip-t">{tip.text}</span>
      </div>
    </div>
  );
}
