export type TransmutationTable = Record<number, Record<number, number>>;

let _cached: TransmutationTable | null = null;
let _promise: Promise<TransmutationTable> | null = null;

/** Fetch and parse the transmutation table (cached after first load). */
export async function loadTransmutationTable(): Promise<TransmutationTable> {
  if (_cached) return _cached;
  if (_promise) return _promise;

  _promise = fetch('/data/transmutation_table.csv')
    .then(async res => {
      if (!res.ok) throw new Error(
        `Transmutation table not found (HTTP ${res.status}). ` +
        `Ensure public/data/transmutation_table.csv exists.`
      );
      const text = await res.text();
      _cached   = parseCSV(text);
      _promise  = null;
      return _cached;
    })
    .catch(err => {
      _promise = null;
      throw err;
    });

  return _promise;
}

function parseCSV(text: string): TransmutationTable {
  const clean = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = clean.trim().split('\n');
  if (lines.length < 2) throw new Error('Transmutation table CSV is empty or malformed.');

  const cols     = lines[0].split(',');
  const maxVals: number[] = cols.slice(1)
    .map(h => parseInt(h.trim()))
    .filter(v => !isNaN(v));
  if (maxVals.length === 0) throw new Error('Transmutation CSV: no valid column headers found.');

  const table: TransmutationTable = {};
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',');
    const score = parseInt(cells[0].trim());
    if (isNaN(score)) continue;
    table[score] = {};
    for (let j = 0; j < maxVals.length; j++) {
      const raw = cells[j + 1]?.trim();
      if (raw !== undefined && raw !== '') {
        const v = parseInt(raw);
        if (!isNaN(v)) table[score][maxVals[j]] = v;
      }
    }
  }
  return table;
}

/**
 * Look up the transmuted grade for a (score, max) pair.
 * Returns null if either value is missing/invalid.
 * Returns 0 if score ≤ 0; returns 100 if score ≥ max.
 * Rounds max to nearest multiple of 5 (clamped to [5, 200]).
 */
export function transmute(
  score: number | string | null | undefined,
  max:   number | string | null | undefined,
  table: TransmutationTable
): number | null {
  const s = typeof score === 'string' ? parseFloat(score) : Number(score);
  const m = typeof max   === 'string' ? parseFloat(max)   : Number(max);

  if (!isFinite(s) || !isFinite(m) || m <= 0 || isNaN(s) || isNaN(m)) return null;
  if (s <= 0) return 0;
  if (s >= m) return 100;

  const colMax   = Math.min(200, Math.max(5, Math.round(m / 5) * 5));
  const rowScore = Math.min(200, Math.max(0, Math.round(s)));

  return table[rowScore]?.[colMax] ?? null;
}

/** Average transmuted grades across an array of {score, items} entries. */
export function avgTransmuted(
  entries: Array<{ score: string; items: string }>,
  table:   TransmutationTable
): number {
  const vals = entries
    .map(e => transmute(e.score, e.items, table))
    .filter((v): v is number => v !== null);
  if (!vals.length) return 0;
  return parseFloat((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2));
}
