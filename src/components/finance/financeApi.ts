// src/components/finance/financeApi.ts
/* Client fetch helpers. Every Finance write goes through requestJson so errors surface as
   ApiError with the route's own message (routes answer { error } on failure). */
export class ApiError extends Error {}

export async function requestJson<T = Record<string, unknown>>(
  url: string,
  init: { method?: string; body?: unknown; keepalive?: boolean } = {},
): Promise<T> {
  const hasBody = init.body !== undefined;
  const res = await fetch(url, {
    method: init.method ?? (hasBody ? 'POST' : 'GET'),
    headers: hasBody ? { 'Content-Type': 'application/json' } : undefined,
    body: hasBody ? JSON.stringify(init.body) : undefined,
    keepalive: init.keepalive,
  });
  let data: unknown = null;
  try { data = await res.json(); } catch { /* empty body */ }
  const message = (data as { error?: string } | null)?.error;
  if (!res.ok || message) throw new ApiError(message ?? `Request failed (${res.status})`);
  return data as T;
}

export type TxType = 'allowance' | 'expense' | 'savings';

export function createTransaction(input: { type: TxType; amount: number; entry_date: string; category?: string; goal_id?: number }) {
  return requestJson<{ id: number }>('/api/finance/transactions', { body: input });
}

export function deleteTransaction(type: TxType, id: number, keepalive = false) {
  return requestJson('/api/finance/transactions', { method: 'DELETE', body: { type, id }, keepalive });
}

/* Plain amounts only: digits with optional thousands commas in valid positions and an
   optional decimal part ("2,500.50", "2500"). Number() alone would also accept "1e3",
   "0x1A" and "1,0,0". Rounds to centavos before the > 0 check, so "0.004" is rejected. */
const AMOUNT_RE = /^(\d{1,3}(,\d{3})+|\d+)(\.\d*)?$/; // "2500." mid-typing still parses

export function parseAmount(raw: string): number | null {
  const t = raw.trim();
  if (!AMOUNT_RE.test(t)) return null;
  const n = Math.round(Number(t.replace(/,/g, '')) * 100) / 100;
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}
