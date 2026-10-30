import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weatherTip, remainingRainChances } from '../weatherTip';

const w = (conditionText: string, tempC = 28, feelsLikeC = 30, upcomingRainChances: number[] = []) =>
  weatherTip({ conditionText, tempC, feelsLikeC, upcomingRainChances });

test('1 thunder beats everything', () => {
  assert.equal(w('Moderate or heavy rain with thunder', 36, 40).text, 'Storm out, stay in if you can');
});
test('2 raining now', () => {
  for (const c of ['Light rain', 'Patchy light drizzle', 'Moderate rain shower']) {
    const t = w(c);
    assert.equal(t.text, "Bring an umbrella, it's raining", c);
    assert.equal(t.tone, 'rain');
  }
});
test('3 rain later today, or "possible/nearby" rain wording', () => {
  assert.equal(w('Partly cloudy', 30, 33, [10, 65]).text, 'Pack an umbrella just in case');
  assert.equal(w('Patchy rain nearby').text, 'Pack an umbrella just in case');
  assert.equal(w('Patchy rain possible').text, 'Pack an umbrella just in case');
});
test('4 scorching feels-like', () => {
  const t = w('Sunny', 33, 36);
  assert.equal(t.text, 'Scorching out: umbrella + water');
  assert.equal(t.tone, 'heat');
});
test('5 hot and sunny', () => {
  assert.equal(w('Sunny', 31, 34).text, 'Hot outside, stay hydrated');
  assert.equal(w('Clear', 30, 33).text, 'Hot outside, stay hydrated');
});
test('6 cloudy is a good time to head out', () => {
  for (const c of ['Partly cloudy', 'Cloudy', 'Overcast']) assert.equal(w(c, 29, 31).text, 'Shady skies, good time to head out', c);
});
test('7 haze', () => {
  for (const c of ['Mist', 'Fog', 'Haze']) assert.equal(w(c).text, 'Hazy out, take it slow', c);
});
test('8 default', () => {
  const t = w('Sunny', 26, 27);
  assert.equal(t.text, 'Nice out, enjoy a walk');
  assert.equal(t.tone, 'calm');
});
test('order: 60% rain later beats heat', () => {
  assert.equal(w('Sunny', 34, 38, [70]).text, 'Pack an umbrella just in case');
});
test('remainingRainChances keeps only hours after now', () => {
  const hours = [{ time_epoch: 100, chance_of_rain: 90 }, { time_epoch: 200, chance_of_rain: 20 }, { time_epoch: 300, chance_of_rain: 70 }];
  assert.deepEqual(remainingRainChances(hours, 150), [20, 70]);
  assert.deepEqual(remainingRainChances(undefined, 150), []);
});
