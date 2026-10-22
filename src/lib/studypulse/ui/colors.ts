/* Category colour cycle (spec §5). The same colour is used for the weight bar, the category swatch
   and the planner dot. The only hex literals StudyPulse TS may contain live here. */
export const CATEGORY_COLORS = ['#8b7fd6', '#74bcd9', '#f2a7c0', '#f0a35c', '#6bb58a', '#8a94a6'] as const;
export const categoryColor = (i: number): string => CATEGORY_COLORS[((i % CATEGORY_COLORS.length) + CATEGORY_COLORS.length) % CATEGORY_COLORS.length];
