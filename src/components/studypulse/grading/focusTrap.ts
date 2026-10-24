/* Focus handling for the grading setup sheet. The two decision functions are pure and unit-tested; the DOM helpers
   only call them. */

/** Where Tab (or Shift+Tab) should go inside the sheet, or null to let the browser move focus natively.
    `order` is the sheet's focus cycle (title first, then every tabbable control in DOM order). When focus is not on
    one of them (on body, the panel itself, or anything outside), the cycle restarts at the first or last stop. */
export function tabTarget<T>(order: T[], active: T | null, shift: boolean): T | null {
  if (order.length === 0) return null;
  const first = order[0], last = order[order.length - 1];
  const i = active == null ? -1 : order.indexOf(active);
  if (i < 0) return shift ? last : first;
  if (shift && i === 0) return last;
  if (!shift && i === order.length - 1) return first;
  return null;
}

/** The item to move focus to when item `i` of `len` is removed: the next one, else the previous one, else none. */
export function neighbourIndex(len: number, i: number): number | null {
  if (i + 1 < len) return i + 1;
  if (i - 1 >= 0) return i - 1;
  return null;
}

const TABBABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** The sheet's Tab cycle: the title (tabIndex -1, so the browser skips it) then every visible tabbable control. */
export function focusOrder(panel: HTMLElement, title: HTMLElement | null): HTMLElement[] {
  const nodes = [...panel.querySelectorAll<HTMLElement>(TABBABLE)].filter(n => n.offsetParent !== null);
  return title ? [title, ...nodes] : nodes;
}

/** Marks everything outside `el` inert (siblings of `el` and of each ancestor up to <body>). Returns the undo. */
export function inertOthers(el: HTMLElement): () => void {
  const touched: HTMLElement[] = [];
  let node: HTMLElement = el;
  while (node.parentElement && node !== document.body) {
    const parent: HTMLElement = node.parentElement;
    for (const sib of Array.from(parent.children)) {
      if (sib !== node && sib instanceof HTMLElement && !sib.inert && sib.tagName !== 'SCRIPT') { sib.inert = true; touched.push(sib); }
    }
    node = parent;
  }
  return () => { for (const s of touched) s.inert = false; };
}

/** Before removing `item` (one of its parent's `itemSelector` children), focus the matching control in the next or
    previous sibling item, else `fallback`. The neighbour keeps its DOM node (keyed rows), so focus survives the removal. */
export function focusNeighbour(item: Element | null, itemSelector: string, controlSelector: string, fallback: HTMLElement | null) {
  const parent = item?.parentElement;
  const items = parent ? [...parent.children].filter(c => c.matches(itemSelector)) : [];
  const n = item ? neighbourIndex(items.length, items.indexOf(item)) : null;
  const target = n != null ? items[n].querySelector<HTMLElement>(controlSelector) : fallback;
  target?.focus();
}
