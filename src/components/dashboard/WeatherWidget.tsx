'use client';

import { useState, useEffect, FormEvent } from 'react';

interface WeatherData {
  location: { name: string; region: string; country: string };
  current: {
    temp_c:      number;
    feelslike_c: number;
    humidity:    number;
    wind_kph:    number;
    uv:          number;
    condition:   { text: string; icon: string };
  };
}

const LS_KEY = 'vb_weather_city';

export default function WeatherWidget() {
  const [weather,   setWeather]   = useState<WeatherData | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [showInput, setShowInput] = useState(false);
  const [cityInput, setCityInput] = useState('');

  async function fetchWeather(q: string) {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/weather?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed');
      setWeather(data);
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Could not load weather.');
      setShowInput(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const saved = localStorage.getItem(LS_KEY);
    if (saved) {
      fetchWeather(saved);
      return;
    }

    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => fetchWeather(`${pos.coords.latitude},${pos.coords.longitude}`),
        () => { setLoading(false); setShowInput(true); },
      );
    } else {
      setLoading(false);
      setShowInput(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleCitySubmit(e: FormEvent) {
    e.preventDefault();
    const city = cityInput.trim();
    if (!city) return;
    localStorage.setItem(LS_KEY, city);
    setShowInput(false);
    fetchWeather(city);
  }

  function changeCity() {
    localStorage.removeItem(LS_KEY);
    setWeather(null);
    setCityInput('');
    setShowInput(true);
  }

  /* ── States ── */

  if (loading) {
    return <div id="weather-location"><strong>Detecting…</strong></div>;
  }

  if (showInput && !weather) {
    return (
      <form onSubmit={handleCitySubmit} className="space-y-3">
        {error && <p className="text-red-500 text-sm">{error}</p>}
        <p className="text-sm text-gray-600 font-medium">Enter your city for weather updates:</p>
        <input
          type="text"
          value={cityInput}
          onChange={(e) => setCityInput(e.target.value)}
          placeholder="e.g. Quezon City"
          className="vb-input"
          autoFocus
        />
        <button type="submit" className="vb-btn-blue">Get Weather</button>
      </form>
    );
  }

  if (!weather) return null;

  const { location: loc, current: cur } = weather;

  return (
    <div className="text-[0.95rem] space-y-3">
      {/* Location */}
      <div id="weather-location">
        <strong className="uppercase tracking-wide text-gray-800">
          {loc.name}
        </strong>
        <br />
        <span className="text-gray-500 text-[0.8rem]">
          {loc.region}, {loc.country}
        </span>
      </div>

      {/* Icon + temp + condition */}
      <div className="flex items-center gap-2.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`https:${cur.condition.icon}`}
          alt={cur.condition.text}
          width={36}
          height={36}
        />
        <span className="text-[1.3rem] font-semibold text-gray-800">{cur.temp_c} °C</span>
        <span className="text-gray-500">{cur.condition.text}</span>
      </div>

      {/* Extra details */}
      <div className="flex justify-between flex-wrap gap-x-4 gap-y-1 mt-3 text-gray-600">
        <span>Feels like: {cur.feelslike_c} °C</span>
        <span>Humidity: {cur.humidity}%</span>
        <span>Wind: {cur.wind_kph} kph</span>
        <span>UV Index: {cur.uv}</span>
      </div>

      <button
        onClick={changeCity}
        className="text-xs text-gray-400 hover:text-gray-600 underline cursor-pointer"
      >
        Change city
      </button>
    </div>
  );
}
