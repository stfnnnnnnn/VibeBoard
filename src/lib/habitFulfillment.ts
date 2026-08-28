// The one place completion is derived for both tracking types. Numeric
// check-ins never store a trusted is_completed (see the spec's
// "completion-derivation rule") — amount is the only fact, and completion
// is recomputed here every time, against whatever target_value currently
// is. Boolean check-ins have no amount to derive from, so is_completed
// stays authoritative for them, and this function reduces to reading it.

export interface FulfillmentHabit {
  tracking_type: 'boolean' | 'numeric';
  target_value: number | null;
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
  return occurrenceFulfillment(habit, row) >= 1;
}
