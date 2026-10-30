import type { Section } from './types';

/** Runs one dashboard query in isolation: a failure is logged and becomes `{ ok: false }` so
 *  the other sections still render (spec §4.1, fail-open like the verify-banner lookup). */
export async function section<T>(label: string, run: () => Promise<T>): Promise<Section<T>> {
  try {
    return { ok: true, data: await run() };
  } catch (err) {
    console.error(`[dashboard] ${label}`, err);
    return { ok: false };
  }
}
