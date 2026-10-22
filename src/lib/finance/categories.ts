// src/lib/finance/categories.ts
/* Expense categories as stored in expenses.category, with display label and emoji. */
export const EXPENSE_CATEGORIES = [
  ['food', 'Food', '🍜'], ['transportation', 'Transportation', '🚌'], ['academic', 'Academic', '📚'],
  ['grocery', 'Grocery', '🛒'], ['leisure', 'Leisure', '🎮'], ['family', 'Family', '👪'],
  ['healthcare', 'Healthcare', '💊'], ['utilities', 'Utilities', '💡'], ['emergency', 'Emergency', '🚨'],
  ['donation', 'Donation', '🎁'], ['miscellaneous', 'Miscellaneous', '📦'],
] as const;

export const ALLOC_CATEGORIES = [...EXPENSE_CATEGORIES, ['savings', 'Savings', '◎']] as const;

export function categoryLabel(key: string): string {
  return ALLOC_CATEGORIES.find(c => c[0] === key)?.[1] ?? key;
}

export function categoryEmoji(key: string): string {
  return ALLOC_CATEGORIES.find(c => c[0] === key)?.[2] ?? '•';
}

export function isExpenseCategory(key: string): boolean {
  return EXPENSE_CATEGORIES.some(c => c[0] === key);
}
