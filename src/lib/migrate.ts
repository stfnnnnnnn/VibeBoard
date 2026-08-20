import pool from '@/lib/db';

let _ranAc = false;
let _ranGs = false;
let _ranFg = false;
let _ranCl = false;

/** Add accomplished_at column to entry tables if not already present. */
export async function ensureAccomplishedAt(): Promise<void> {
  if (_ranAc) return;
  const tables = ['activities', 'quizzes', 'exams', 'grade_entries'];
  for (const table of tables) {
    try {
      await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN accomplished_at DATE NULL`);
    } catch (err: unknown) {
      if ((err as { code?: string }).code !== 'ER_DUP_FIELDNAME') throw err;
    }
  }
  _ranAc = true;
}

/** Add grade_scale column to grading_presets if not already present. */
export async function ensureGradeScale(): Promise<void> {
  if (_ranGs) return;
  try {
    await pool.query(`ALTER TABLE grading_presets ADD COLUMN grade_scale VARCHAR(10) NOT NULL DEFAULT '4pt'`);
  } catch (err: unknown) {
    if ((err as { code?: string }).code !== 'ER_DUP_FIELDNAME') throw err;
  }
  _ranGs = true;
}

/** Add final_period_id / final_mode columns to grading_presets if not already present. */
export async function ensureFinalGrade(): Promise<void> {
  if (_ranFg) return;
  try {
    await pool.query(`ALTER TABLE grading_presets ADD COLUMN final_period_id INT NULL`);
  } catch (err: unknown) {
    if ((err as { code?: string }).code !== 'ER_DUP_FIELDNAME') throw err;
  }
  try {
    await pool.query(`ALTER TABLE grading_presets ADD COLUMN final_mode VARCHAR(20) NULL`);
  } catch (err: unknown) {
    if ((err as { code?: string }).code !== 'ER_DUP_FIELDNAME') throw err;
  }
  _ranFg = true;
}

/** Add link_group / collective_weight columns to grading_categories if not already present. */
export async function ensureCategoryLinking(): Promise<void> {
  if (_ranCl) return;
  try {
    await pool.query(`ALTER TABLE grading_categories ADD COLUMN link_group VARCHAR(40) NULL`);
  } catch (err: unknown) {
    if ((err as { code?: string }).code !== 'ER_DUP_FIELDNAME') throw err;
  }
  try {
    await pool.query(`ALTER TABLE grading_categories ADD COLUMN collective_weight DECIMAL(5,2) NULL`);
  } catch (err: unknown) {
    if ((err as { code?: string }).code !== 'ER_DUP_FIELDNAME') throw err;
  }
  try {
    await pool.query(`ALTER TABLE grading_categories ADD COLUMN carry_score TINYINT(1) NOT NULL DEFAULT 1`);
  } catch (err: unknown) {
    if ((err as { code?: string }).code !== 'ER_DUP_FIELDNAME') throw err;
  }
  _ranCl = true;
}
