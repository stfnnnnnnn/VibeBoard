/* The rule the old trg_update_{activity,quiz,exam}_status triggers enforced, now in app code so the
   schema runs on hosts without triggers (TiDB): a fully scored entry (score, items and grade all set)
   is Done, whatever status was sent. Every write to activities/quizzes/exams that sets these columns
   must pass its status through here. */
export function statusFor(
  status: string, score: number | null, items: number | null, grade: number | null,
): string {
  return score != null && items != null && grade != null ? 'Done' : status;
}
