/** @deprecated Use `@/lib/workboard/workContexts`. The domain term is "context"; this
 *  module remains for one release so v2 call sites keep resolving. */
export type { WorkContext as WorkCategory } from '@/lib/workboard/workContexts';
export { WORK_CONTEXTS as WORK_CATEGORIES } from '@/lib/workboard/workContexts';
