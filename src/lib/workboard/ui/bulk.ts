/** Runs one request per item with allSettled semantics (spec 12): every item is attempted,
 *  and the result says which succeeded, failed or were skipped (op returned null). */
export interface BulkResult<T> { ok: T[]; failed: T[]; skipped: T[] }

export async function runBulk<T>(items: T[], op: (item: T) => Promise<Response> | null): Promise<BulkResult<T>> {
  const result: BulkResult<T> = { ok: [], failed: [], skipped: [] };
  const attempts = items.map(item => {
    let req: Promise<Response> | null;
    try { req = op(item); } catch { req = Promise.reject(new Error('op threw')); }
    return { item, req };
  });
  for (const a of attempts) if (a.req === null) result.skipped.push(a.item);
  const live = attempts.filter((a): a is { item: T; req: Promise<Response> } => a.req !== null);
  const settled = await Promise.allSettled(live.map(a => a.req));
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled' && s.value.ok) result.ok.push(live[i].item);
    else result.failed.push(live[i].item);
  });
  return result;
}

/** "3 items updated", "2 of 3 updated", "2 items deleted · 1 academic item skipped". */
export function summariseBulk(verb: string, r: BulkResult<unknown>, skippedNoun = 'item'): string {
  const attempted = r.ok.length + r.failed.length;
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  let head = r.failed.length === 0
    ? `${plural(r.ok.length, 'item')} ${verb}`
    : `${r.ok.length} of ${attempted} ${verb}`;
  if (r.skipped.length > 0) head += ` · ${plural(r.skipped.length, skippedNoun)} skipped`;
  return head;
}
