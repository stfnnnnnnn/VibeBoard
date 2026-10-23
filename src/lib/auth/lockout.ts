export const MAX_ATTEMPTS = 5;
export const LOCK_SECONDS = 600;

/** Seconds until a locked account can try again. `sinceLastAttemptSec` comes from
 *  TIMESTAMPDIFF(SECOND, last_attempt, NOW()) so it is time-zone independent. */
export function lockSecondsLeft(failed: number, sinceLastAttemptSec: number | null): number {
  if (failed < MAX_ATTEMPTS || sinceLastAttemptSec === null) return 0;
  const since = Math.max(0, sinceLastAttemptSec);
  return since >= LOCK_SECONDS ? 0 : LOCK_SECONDS - since;
}
