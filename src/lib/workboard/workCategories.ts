/** `WorkCategory` and `WORK_CATEGORIES` live in their own module, separate from
 *  `workItems.ts`, specifically so client components (e.g. `WorkboardShell.tsx`'s category
 *  tabs) can import the runtime constant without pulling in `workItems.ts`'s module graph —
 *  which imports `@/lib/db` (mysql2) and cannot be bundled for the browser. `workItems.ts`
 *  re-exports both so existing server-side imports are unaffected. */
export type WorkCategory = 'academic' | 'project' | 'organization' | 'life';

export const WORK_CATEGORIES: WorkCategory[] = ['academic', 'project', 'organization', 'life'];
