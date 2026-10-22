/** The one identity for a Workboard row: ids repeat across the four Study Pulse tables, so
 *  neither `source` nor `id` is a key on its own. */
export function itemKey(item: { source: string; id: number }): string {
  return `${item.source}-${item.id}`;
}
