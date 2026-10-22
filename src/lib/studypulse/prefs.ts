/* Saved planner preferences (spec §3.3): extra projected items per category and a target per period. */
export interface ProjectionPrefs {
  extras: Record<string, number>;   // catKey -> extra count
  targets: Record<string, number>;  // periodKey -> target %
}
export const EMPTY_PREFS: ProjectionPrefs = { extras: {}, targets: {} };
export const DEFAULT_TARGET = 85;

export type PrefKind = 'extra' | 'target';
const KEY_RE = /^(extra|target):([a-z0-9-]{1,40})$/;

export const extraKey = (catKey: string) => `extra:${catKey}`;
export const targetKey = (periodKey: string) => `target:${periodKey}`;

export function parsePrefKey(key: unknown): { kind: PrefKind; id: string } | null {
  if (typeof key !== 'string') return null;
  const m = KEY_RE.exec(key);
  return m ? { kind: m[1] as PrefKind, id: m[2] } : null;
}

export function clampPrefValue(kind: PrefKind, v: number): number | null {
  if (!Number.isFinite(v)) return null;
  if (kind === 'extra') return Math.min(50, Math.max(0, Math.round(v)));
  return Math.min(100, Math.max(0, Math.round(v * 10) / 10));
}

export function rowsToPrefs(rows: Array<{ key: string; value: number }>): ProjectionPrefs {
  const out: ProjectionPrefs = { extras: {}, targets: {} };
  for (const r of rows) {
    const p = parsePrefKey(r.key);
    if (!p) continue;
    if (p.kind === 'extra') out.extras[p.id] = r.value;
    else out.targets[p.id] = r.value;
  }
  return out;
}
