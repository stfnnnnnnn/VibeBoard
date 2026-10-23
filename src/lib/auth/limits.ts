/* Auth timing limits. Client-safe (no imports) so UI code can read them without pulling node:crypto. */
export const RESET_TTL_MIN = 30;
export const VERIFY_TTL_MIN = 1440;
export const RESEND_COOLDOWN_SEC = 60;
