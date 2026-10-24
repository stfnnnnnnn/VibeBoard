import type { CategoryInput } from '@/lib/studypulse/projection';
import { f1 } from '@/lib/studypulse/ui/format';
import InfoTip from '../ui/InfoTip';

const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** The ⓘ beside a category name that explains earlier periods' work counted here (spec G2, G3). Null otherwise.
    Shared by the category headers in the period panels and the grade summary. */
export default function CategoryInfo({ cat }: { cat: Pick<CategoryInput, 'name' | 'weight' | 'graded' | 'carried' | 'reused'> }) {
  if (cat.carried) {
    const { count, from, avg } = cat.carried;
    const own = cat.graded.slice(0, Math.max(0, cat.graded.length - count));
    const where = list(from);
    return (
      <InfoTip label={`About ${cat.name}: includes earlier work`}>
        <b>Includes earlier work:</b> {own.length} own graded{own.length ? ` (avg ${f1(mean(own))})` : ''} plus{' '}
        <b>{count} graded from {where}</b> (avg {f1(avg)}). Those rows stay in the {where} table{from.length > 1 ? 's' : ''}.
      </InfoTip>
    );
  }
  if (cat.reused) {
    const { score, items, from, weight } = cat.reused;
    // A source entry with only a grade (no score/items) reuses that grade (Task 3 review).
    const what = score && items ? `score: ${score}/${items}` : `grade ${cat.graded.length ? f1(cat.graded[0]) : '—'}`;
    return (
      <InfoTip label={`About ${cat.name}: reused from ${from}`} tone="pink">
        <b>Reused {what}</b> from {from} (weighted {weight}% there), weighted {cat.weight}% here. Enter a score in this period to override it.
      </InfoTip>
    );
  }
  return null;
}
