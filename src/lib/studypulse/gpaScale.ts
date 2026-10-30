/** Percentage grade -> 4.0-scale GPA band, shared by the Study Pulse stats route and the dashboard. Pool-free. */
export function convertToGPA(grade: number): number {
  if (grade < 70) return 0.5;
  if (grade < 75) return 1.0;
  if (grade < 80) return 1.5;
  if (grade < 85) return 2.0;
  if (grade < 89) return 2.5;
  if (grade <= 92) return 3.0;
  if (grade <= 96) return 3.5;
  return 4.0;
}
