import { transmute, type TransmutationTable } from '@/lib/transmutation';
import { f1, gradeTone } from '@/lib/studypulse/ui/format';
import type { EntryRow } from '@/lib/studypulse/types';

/** Grade pill: raw %, or "raw → transmuted" when transmutation is on; dashed "Pending" when ungraded. */
export default function GradePill({ row, transTable, transmutationOn }: {
  row: Pick<EntryRow, 'grade' | 'score' | 'items'>; transTable: TransmutationTable | null; transmutationOn: boolean;
}) {
  const tg = transmutationOn && transTable ? transmute(row.score, row.items, transTable) : null;
  const shown = tg ?? row.grade;
  if (shown === null) return <span className="sp-gp sp-gp--pending">Pending</span>;
  const tone = gradeTone(shown);
  const pill = <span className={`sp-gp sp-gp--${tone === 'none' ? 'pending' : tone} sp-num`}>{tg !== null ? tg : f1(shown)}</span>;
  if (tg === null || row.grade === null) return pill;
  return <span className="sp-gp-trans sp-num"><span className="sp-gp-trans__raw">{f1(row.grade)} →</span>{pill}</span>;
}
