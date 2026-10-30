/** Condition-based weather tip (spec §5.3, D11). Pool-free; runs in the client WeatherRow. */
export type TipTone = 'heat' | 'rain' | 'calm';
export interface WeatherTip { icon: string; text: string; tone: TipTone }
export interface TipInput {
  conditionText:       string;
  tempC:               number;
  feelsLikeC:          number;
  /** chance_of_rain (0-100) for each remaining hour today; [] when no forecast. */
  upcomingRainChances: number[];
}

const RULES: Array<{ when: (w: TipInput, c: string) => boolean; tip: WeatherTip }> = [
  { when: (_, c) => /thunder/.test(c),
    tip: { icon: '⛈', text: 'Storm out, stay in if you can', tone: 'rain' } },
  { when: (_, c) => /rain|drizzle|shower|sleet/.test(c) && !/possible|nearby/.test(c),
    tip: { icon: '☔', text: "Bring an umbrella, it's raining", tone: 'rain' } },
  { when: (w, c) => /possible|nearby/.test(c) || w.upcomingRainChances.some(p => p >= 60),
    tip: { icon: '🌂', text: 'Pack an umbrella just in case', tone: 'rain' } },
  { when: w => w.feelsLikeC >= 35,
    tip: { icon: '🥵', text: 'Scorching out: umbrella + water', tone: 'heat' } },
  { when: (w, c) => /sunny|clear/.test(c) && w.tempC >= 30,
    tip: { icon: '☀️', text: 'Hot outside, stay hydrated', tone: 'heat' } },
  { when: (_, c) => /cloud|overcast/.test(c),
    tip: { icon: '☁️', text: 'Shady skies, good time to head out', tone: 'calm' } },
  { when: (_, c) => /fog|mist|haze/.test(c),
    tip: { icon: '🌫', text: 'Hazy out, take it slow', tone: 'calm' } },
];
const FALLBACK: WeatherTip = { icon: '🌤', text: 'Nice out, enjoy a walk', tone: 'calm' };

export function weatherTip(w: TipInput): WeatherTip {
  const c = w.conditionText.trim().toLowerCase();
  return RULES.find(r => r.when(w, c))?.tip ?? FALLBACK;
}

export function remainingRainChances(
  hours: { time_epoch: number; chance_of_rain: number }[] | undefined,
  nowEpochSec: number,
): number[] {
  return (hours ?? []).filter(h => h.time_epoch > nowEpochSec).map(h => Number(h.chance_of_rain));
}
