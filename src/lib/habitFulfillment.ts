// The one place completion is derived for both tracking types. Numeric
// check-ins never store a trusted is_completed (see the spec's
// "completion-derivation rule") — amount is the only fact, and completion
// is recomputed here every time, against whatever target_value (and, since
// v3, minimum_value) currently is. Boolean check-ins have no amount to
// derive from, so is_completed stays authoritative for them.
//
// v3 note: occurrenceCompleted and occurrenceFulfillment are no longer the
// same threshold. occurrenceFulfillment always measures progress toward the
// TARGET (the "how much of your goal" number Rhythm analytics consume).
// occurrenceCompleted measures against the MINIMUM when one is set (the
// lower, streak-preserving bar) — reaching only the minimum keeps the chain
// filled and the streak alive without counting as full fulfillment. A habit
// with no minimum_value behaves exactly as v2: the bar reduces to
// target_value, so occurrenceCompleted and "fulfillment >= 1" agree again.

export interface FulfillmentHabit {
  tracking_type: 'boolean' | 'numeric';
  target_value: number | null;
  minimum_value?: number | null;
}

export interface FulfillmentRow {
  is_completed?: number | null;
  amount?: number | null;
}

export function occurrenceFulfillment(habit: FulfillmentHabit, row: FulfillmentRow): number {
  if (habit.tracking_type === 'boolean') return row.is_completed ? 1 : 0;
  if (row.amount == null || !habit.target_value) return 0;
  return Math.min(row.amount / habit.target_value, 1);
}

export function occurrenceCompleted(habit: FulfillmentHabit, row: FulfillmentRow): boolean {
  if (habit.tracking_type === 'boolean') return !!row.is_completed;
  if (row.amount == null) return false;
  const bar = habit.minimum_value ?? habit.target_value;
  if (!bar) return false;
  return row.amount >= bar;
}
