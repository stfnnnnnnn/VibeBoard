import pool from '@/lib/db';
import type { RowDataPacket } from 'mysql2/promise';

let _ranAc = false;
let _ranGs = false;
let _ranFg = false;
let _ranCl = false;
let _ranCanvas = false;
let _ranSs = false;
let _ranHabitsV2 = false;
let _ranHabitsV3 = false;
let _ranHabitsV7 = false;
let _ranHabitsV8 = false;
let _ranWorkboard = false;
let _ranWorkboardV2 = false;
let _ranWorkboardV3 = false;

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

/** Add section (block, e.g. "TN37") column to subjects if not already present. */
export async function ensureSubjectSection(): Promise<void> {
  if (_ranSs) return;
  try {
    await pool.query(`ALTER TABLE subjects ADD COLUMN section VARCHAR(20) NULL`);
  } catch (err: unknown) {
    if ((err as { code?: string }).code !== 'ER_DUP_FIELDNAME') throw err;
  }
  _ranSs = true;
}

/** Create the Canvas integration tables if they don't already exist. */
export async function ensureCanvasSchema(): Promise<void> {
  if (_ranCanvas) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS canvas_connections (
      id                 INT AUTO_INCREMENT PRIMARY KEY,
      user_id            INT NOT NULL,
      base_url           VARCHAR(255) NOT NULL,
      canvas_user_id     BIGINT NOT NULL,
      canvas_user_name   VARCHAR(255) NULL,
      access_token_enc   VARBINARY(1024) NULL,
      token_iv           VARBINARY(16) NULL,
      token_tag          VARBINARY(16) NULL,
      status             ENUM('active','invalid','disconnected') NOT NULL DEFAULT 'active',
      last_sync_at       DATETIME NULL,
      last_sync_status   ENUM('success','partial','failed') NULL,
      last_error         TEXT NULL,
      created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_user (user_id),
      FOREIGN KEY (user_id) REFERENCES user_login(user_id) ON DELETE CASCADE
    )
  `);

  try {
    await pool.query(`ALTER TABLE canvas_connections ADD COLUMN token_expires_at DATETIME NULL AFTER last_error`);
  } catch (err: unknown) {
    if ((err as { code?: string }).code !== 'ER_DUP_FIELDNAME') throw err;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS canvas_courses (
      id                 INT AUTO_INCREMENT PRIMARY KEY,
      connection_id      INT NOT NULL,
      canvas_course_id   BIGINT NOT NULL,
      name               VARCHAR(255) NOT NULL,
      course_code        VARCHAR(100) NULL,
      term               VARCHAR(100) NULL,
      workflow_state     VARCHAR(30) NULL,
      start_at           DATETIME NULL,
      end_at             DATETIME NULL,
      mapping_status     ENUM('pending','linked','created','ignored') NOT NULL DEFAULT 'pending',
      user_subject_id    INT NULL,
      first_seen_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at       DATETIME NOT NULL,
      UNIQUE KEY uniq_conn_course (connection_id, canvas_course_id),
      FOREIGN KEY (connection_id) REFERENCES canvas_connections(id) ON DELETE CASCADE,
      FOREIGN KEY (user_subject_id) REFERENCES user_subjects(user_subject_id) ON DELETE SET NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS canvas_activity_bank (
      id                       INT AUTO_INCREMENT PRIMARY KEY,
      connection_id            INT NOT NULL,
      course_id                INT NOT NULL,
      canvas_assignment_id     BIGINT NOT NULL,
      name                     VARCHAR(255) NOT NULL,
      due_at                   DATETIME NULL,
      points_possible          DECIMAL(8,2) NULL,
      html_url                 VARCHAR(500) NULL,
      submission_status        VARCHAR(50) NULL,
      submission_score         DECIMAL(8,2) NULL,
      submission_submitted_at  DATETIME NULL,
      canvas_updated_at        DATETIME NOT NULL,
      bank_status              ENUM('pending','included','ignored','removed_upstream') NOT NULL DEFAULT 'pending',
      first_seen_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_synced_at           DATETIME NOT NULL,
      last_change_at           DATETIME NULL,
      last_seen_sync_run_id    INT NULL,
      UNIQUE KEY uniq_conn_assignment (connection_id, canvas_assignment_id),
      FOREIGN KEY (connection_id) REFERENCES canvas_connections(id) ON DELETE CASCADE,
      FOREIGN KEY (course_id) REFERENCES canvas_courses(id) ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS canvas_entry_links (
      id               INT AUTO_INCREMENT PRIMARY KEY,
      bank_item_id     INT NOT NULL,
      activity_id      INT NULL,
      quiz_id          INT NULL,
      exam_id          INT NULL,
      grade_entry_id   INT NULL,
      created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_bank_item (bank_item_id),
      FOREIGN KEY (bank_item_id) REFERENCES canvas_activity_bank(id) ON DELETE CASCADE,
      FOREIGN KEY (activity_id) REFERENCES activities(activity_id) ON DELETE CASCADE,
      FOREIGN KEY (quiz_id) REFERENCES quizzes(quiz_id) ON DELETE CASCADE,
      FOREIGN KEY (exam_id) REFERENCES exams(exam_id) ON DELETE CASCADE,
      FOREIGN KEY (grade_entry_id) REFERENCES grade_entries(entry_id) ON DELETE CASCADE,
      CHECK (
        (activity_id IS NOT NULL) + (quiz_id IS NOT NULL) +
        (exam_id IS NOT NULL) + (grade_entry_id IS NOT NULL) = 1
      )
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS canvas_sync_events (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      connection_id  INT NOT NULL,
      bank_item_id   INT NULL,
      event_type     ENUM('course_discovered','assignment_created','due_date_changed',
                           'score_changed','submission_status_changed','assignment_removed') NOT NULL,
      old_data       JSON NULL,
      new_data       JSON NULL,
      created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (connection_id) REFERENCES canvas_connections(id) ON DELETE CASCADE,
      FOREIGN KEY (bank_item_id) REFERENCES canvas_activity_bank(id) ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS canvas_sync_runs (
      id               INT AUTO_INCREMENT PRIMARY KEY,
      connection_id    INT NOT NULL,
      trigger_source   ENUM('cron','manual') NOT NULL,
      started_at       DATETIME NOT NULL,
      finished_at      DATETIME NULL,
      status           ENUM('running','success','partial','failed') NOT NULL DEFAULT 'running',
      courses_synced   INT NOT NULL DEFAULT 0,
      items_fetched    INT NOT NULL DEFAULT 0,
      items_changed    INT NOT NULL DEFAULT 0,
      errors_json      JSON NULL,
      FOREIGN KEY (connection_id) REFERENCES canvas_connections(id) ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS canvas_announcement_bank (
      id                       INT AUTO_INCREMENT PRIMARY KEY,
      connection_id            INT NOT NULL,
      course_id                INT NOT NULL,
      canvas_announcement_id   BIGINT NOT NULL,
      title                    VARCHAR(255) NOT NULL,
      message                  TEXT NULL,
      html_url                 VARCHAR(500) NULL,
      posted_at                DATETIME NULL,
      canvas_updated_at        DATETIME NOT NULL,
      bank_status              ENUM('pending','included','ignored','removed_upstream') NOT NULL DEFAULT 'pending',
      first_seen_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_synced_at           DATETIME NOT NULL,
      last_seen_sync_run_id    INT NULL,
      UNIQUE KEY uniq_conn_announcement (connection_id, canvas_announcement_id),
      FOREIGN KEY (connection_id) REFERENCES canvas_connections(id) ON DELETE CASCADE,
      FOREIGN KEY (course_id) REFERENCES canvas_courses(id) ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS canvas_announcement_links (
      id               INT AUTO_INCREMENT PRIMARY KEY,
      announcement_id  INT NOT NULL,
      activity_id      INT NULL,
      quiz_id          INT NULL,
      exam_id          INT NULL,
      grade_entry_id   INT NULL,
      created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_announcement (announcement_id),
      FOREIGN KEY (announcement_id) REFERENCES canvas_announcement_bank(id) ON DELETE CASCADE,
      FOREIGN KEY (activity_id) REFERENCES activities(activity_id) ON DELETE CASCADE,
      FOREIGN KEY (quiz_id) REFERENCES quizzes(quiz_id) ON DELETE CASCADE,
      FOREIGN KEY (exam_id) REFERENCES exams(exam_id) ON DELETE CASCADE,
      FOREIGN KEY (grade_entry_id) REFERENCES grade_entries(entry_id) ON DELETE CASCADE,
      CHECK (
        (activity_id IS NOT NULL) + (quiz_id IS NOT NULL) +
        (exam_id IS NOT NULL) + (grade_entry_id IS NOT NULL) = 1
      )
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS canvas_pairing_codes (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      user_id     INT NOT NULL,
      code        CHAR(43) NOT NULL,
      expires_at  DATETIME NOT NULL,
      used_at     DATETIME NULL,
      created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_code (code),
      FOREIGN KEY (user_id) REFERENCES user_login(user_id) ON DELETE CASCADE
    )
  `);

  _ranCanvas = true;
}

/** Create the habit-tracking tables (v1 shape) if they don't already exist. A fresh
 * deploy target has none of these — the legacy PHP module originally created them, so
 * there was never a CREATE TABLE anywhere in this codebase until now. */
async function ensureHabitTablesExist(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS habit_tasks (
      habit_id INT NOT NULL AUTO_INCREMENT,
      user_id INT NOT NULL,
      task_name VARCHAR(255) NOT NULL,
      purpose TEXT NOT NULL,
      habit_urgency ENUM('Urgent','Priority','Important','Not Important','Not Urgent') NOT NULL DEFAULT 'Not Urgent',
      task_category ENUM('academic','household','health','social','organizational','life goals') NOT NULL,
      habit_type ENUM('routine','habit') NOT NULL,
      days_of_week SET('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday') NOT NULL,
      times_per_week TINYINT(4) NOT NULL,
      date_created TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      task_status ENUM('active','archived') DEFAULT 'active',
      PRIMARY KEY (habit_id),
      KEY user_id (user_id),
      CONSTRAINT fk_habit_user FOREIGN KEY (user_id) REFERENCES user_login (user_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS habit_checkins (
      checkin_id INT NOT NULL AUTO_INCREMENT,
      habit_id INT NOT NULL,
      checkin_date DATE NOT NULL,
      is_completed TINYINT(1) DEFAULT 0,
      PRIMARY KEY (checkin_id),
      UNIQUE KEY unique_checkin (habit_id, checkin_date),
      CONSTRAINT fk_checkin_habit FOREIGN KEY (habit_id) REFERENCES habit_tasks (habit_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS habit_streaks (
      streak_id INT NOT NULL AUTO_INCREMENT,
      user_id INT NOT NULL,
      habit_id INT NOT NULL,
      streak_start DATE NOT NULL,
      streak_end DATE DEFAULT NULL,
      current_streak_days INT DEFAULT 1,
      longest_streak INT DEFAULT 1,
      PRIMARY KEY (streak_id),
      KEY user_id (user_id),
      KEY habit_id (habit_id),
      CONSTRAINT habit_streaks_ibfk_1 FOREIGN KEY (user_id) REFERENCES user_login (user_id) ON DELETE CASCADE,
      CONSTRAINT habit_streaks_ibfk_2 FOREIGN KEY (habit_id) REFERENCES habit_tasks (habit_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  `);
}

/** Add flexible-scheduling / numeric-tracking columns to the habit tables if not already present. */
export async function ensureHabitTrackingSchema(): Promise<void> {
  if (_ranHabitsV2) return;

  await ensureHabitTablesExist();

  const alterations: [string, string][] = [
    ['habit_tasks', `ADD COLUMN schedule_mode ENUM('fixed','flexible') NOT NULL DEFAULT 'fixed'`],
    ['habit_tasks', `ADD COLUMN tracking_type ENUM('boolean','numeric') NOT NULL DEFAULT 'boolean'`],
    ['habit_tasks', `ADD COLUMN target_value DECIMAL(6,1) NULL`],
    ['habit_tasks', `ADD COLUMN unit_label VARCHAR(24) NULL`],
    ['habit_tasks', `ADD COLUMN step_value DECIMAL(6,1) NULL DEFAULT 1`],
    ['habit_checkins', `ADD COLUMN amount DECIMAL(6,1) NULL`],
  ];

  for (const [table, clause] of alterations) {
    try {
      await pool.query(`ALTER TABLE \`${table}\` ${clause}`);
    } catch (err: unknown) {
      if ((err as { code?: string }).code !== 'ER_DUP_FIELDNAME') throw err;
    }
  }

  _ranHabitsV2 = true;
}

/** Add priority + minimum_value columns to habit_tasks if not already present,
 * backfilling priority from the legacy habit_urgency values exactly once
 * (only on the run that actually adds the column, never on a later no-op call). */
export async function ensureHabitPriorityAndMinimumSchema(): Promise<void> {
  if (_ranHabitsV3) return;

  await pool.query(`ALTER TABLE habit_tasks MODIFY habit_urgency ENUM('Urgent','Priority','Important','Not Important','Not Urgent') NOT NULL DEFAULT 'Not Urgent'`);

  let priorityColumnAdded = false;
  try {
    await pool.query(`ALTER TABLE habit_tasks ADD COLUMN priority ENUM('core','normal','optional') NOT NULL DEFAULT 'normal'`);
    priorityColumnAdded = true;
  } catch (err: unknown) {
    if ((err as { code?: string }).code !== 'ER_DUP_FIELDNAME') throw err;
  }

  try {
    await pool.query(`ALTER TABLE habit_tasks ADD COLUMN minimum_value DECIMAL(6,1) NULL`);
  } catch (err: unknown) {
    if ((err as { code?: string }).code !== 'ER_DUP_FIELDNAME') throw err;
  }

  if (priorityColumnAdded) {
    await pool.query(`
      UPDATE habit_tasks SET priority = CASE
        WHEN habit_urgency IN ('Urgent','Priority') THEN 'core'
        WHEN habit_urgency = 'Important' THEN 'normal'
        ELSE 'optional'
      END
    `);
  }

  _ranHabitsV3 = true;
}

/** Drop the (now-unused) habit_type column and rename purpose -> note, making it
 * optional. Both statements are idempotent: DROP tolerates the column already being
 * gone, and the rename tolerates "purpose" already being renamed, so a process
 * restart (which resets the module-level flag below) can safely re-run this. */
export async function ensureHabitTypeRemovedAndNoteRenamedSchema(): Promise<void> {
  if (_ranHabitsV7) return;

  try {
    await pool.query(`ALTER TABLE habit_tasks DROP COLUMN habit_type`);
  } catch (err: unknown) {
    if ((err as { code?: string }).code !== 'ER_CANT_DROP_FIELD_OR_KEY') throw err;
  }

  try {
    await pool.query(`ALTER TABLE habit_tasks CHANGE COLUMN purpose note TEXT NULL`);
  } catch (err: unknown) {
    if ((err as { code?: string }).code !== 'ER_BAD_FIELD_ERROR') throw err;
  }

  _ranHabitsV7 = true;
}

/** Add the 'paused' status value (reusing the pre-existing, previously-unused
 * task_status column from the legacy schema) and a habit_pauses history table
 * recording every pause/resume cycle permanently — the streak walk in habits.ts
 * needs that permanent record to correctly skip paused date ranges forever,
 * not just while a pause is currently active. Both statements are naturally
 * idempotent on their own (MODIFY on an identical enum, and CREATE TABLE IF NOT
 * EXISTS) — no error-code-catch guard is needed here. */
export async function ensureHabitPauseSchema(): Promise<void> {
  if (_ranHabitsV8) return;

  await pool.query(`ALTER TABLE habit_tasks MODIFY task_status ENUM('active','archived','paused') NOT NULL DEFAULT 'active'`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS habit_pauses (
      pause_id INT NOT NULL AUTO_INCREMENT,
      habit_id INT NOT NULL,
      paused_at DATE NOT NULL,
      resumed_at DATE NULL,
      PRIMARY KEY (pause_id),
      KEY habit_id (habit_id),
      CONSTRAINT fk_pause_habit FOREIGN KEY (habit_id) REFERENCES habit_tasks (habit_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  `);

  _ranHabitsV8 = true;
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column],
  );
  return rows.length > 0;
}

async function constraintExists(table: string, name: string): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?`,
    [table, name],
  );
  return rows.length > 0;
}

async function indexExists(table: string, name: string): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, name],
  );
  return rows.length > 0;
}

/** Create the Workboard tables and extend canvas_announcement_links for multi-destination
 *  announcements, if not already done. */
export async function ensureWorkboardSchema(): Promise<void> {
  if (_ranWorkboard) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS workboard_items (
      id                       INT AUTO_INCREMENT PRIMARY KEY,
      user_id                  INT NOT NULL,
      user_subject_id          INT NULL,
      item_type                ENUM('event','reminder') NOT NULL,
      title                    VARCHAR(255) NOT NULL,
      location                 VARCHAR(255) NULL,
      starts_at                DATETIME NULL,
      ends_at                  DATETIME NULL,
      remind_at                DATETIME NULL,
      note                     TEXT NULL,
      source_type              ENUM('manual','canvas_announcement') NOT NULL DEFAULT 'manual',
      source_announcement_id   INT NULL,
      status                   ENUM('active','dismissed','done') NOT NULL DEFAULT 'active',
      created_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES user_login(user_id) ON DELETE CASCADE,
      FOREIGN KEY (user_subject_id) REFERENCES user_subjects(user_subject_id) ON DELETE SET NULL,
      FOREIGN KEY (source_announcement_id) REFERENCES canvas_announcement_bank(id) ON DELETE SET NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schedule_overrides (
      id                       INT AUTO_INCREMENT PRIMARY KEY,
      block_id                 INT NOT NULL,
      override_date            DATE NOT NULL,
      modality                 ENUM('online','cancelled') NULL,
      note                     TEXT NULL,
      source_type              ENUM('manual','canvas_announcement') NOT NULL DEFAULT 'manual',
      source_announcement_id   INT NULL,
      created_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_block_date (block_id, override_date),
      FOREIGN KEY (block_id) REFERENCES schedule_blocks(block_id) ON DELETE CASCADE,
      FOREIGN KEY (source_announcement_id) REFERENCES canvas_announcement_bank(id) ON DELETE SET NULL
    )
  `);

  if (!(await columnExists('canvas_announcement_links', 'workboard_item_id'))) {
    await pool.query(`
      ALTER TABLE canvas_announcement_links
        ADD COLUMN workboard_item_id INT NULL,
        ADD FOREIGN KEY (workboard_item_id) REFERENCES workboard_items(id) ON DELETE CASCADE
    `);
  }
  if (!(await columnExists('canvas_announcement_links', 'schedule_override_id'))) {
    await pool.query(`
      ALTER TABLE canvas_announcement_links
        ADD COLUMN schedule_override_id INT NULL,
        ADD FOREIGN KEY (schedule_override_id) REFERENCES schedule_overrides(id) ON DELETE CASCADE
    `);
  }

  // The original table was created with a single-destination UNIQUE index and an unnamed
  // CHECK constraint (MySQL auto-names those). Both must go before Workboard can insert a
  // second row for the same announcement_id with a different destination column set.
  if (await indexExists('canvas_announcement_links', 'uniq_announcement')) {
    // Look up the FK constraint name dynamically (don't assume ibfk_1)
    const [fkRows] = await pool.query<RowDataPacket[]>(`
      SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'canvas_announcement_links'
        AND COLUMN_NAME = 'announcement_id' AND REFERENCED_TABLE_NAME = 'canvas_announcement_bank'
    `);
    if (fkRows.length > 0) {
      const fkName = fkRows[0].CONSTRAINT_NAME;
      await pool.query(`ALTER TABLE canvas_announcement_links DROP FOREIGN KEY \`${fkName}\``);
    }
    await pool.query(`ALTER TABLE canvas_announcement_links DROP INDEX uniq_announcement`);
  }

  // Re-add the FK on announcement_id if it's missing (independent of the index handling above).
  // This ensures idempotency and handles crash-recovery scenarios where the index was dropped
  // but the FK re-add was interrupted.
  const [fkExists] = await pool.query<RowDataPacket[]>(`
    SELECT 1 FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'canvas_announcement_links'
      AND COLUMN_NAME = 'announcement_id' AND REFERENCED_TABLE_NAME = 'canvas_announcement_bank'
  `);
  if (fkExists.length === 0) {
    await pool.query(`ALTER TABLE canvas_announcement_links ADD FOREIGN KEY (announcement_id) REFERENCES canvas_announcement_bank(id) ON DELETE CASCADE`);
  }

  const [oldChecks] = await pool.query<RowDataPacket[]>(`
    SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'canvas_announcement_links' AND CONSTRAINT_TYPE = 'CHECK'
      AND CONSTRAINT_NAME != 'chk_one_destination'
  `);
  for (const row of oldChecks) {
    await pool.query(`ALTER TABLE canvas_announcement_links DROP CONSTRAINT \`${row.CONSTRAINT_NAME}\``);
  }

  if (!(await constraintExists('canvas_announcement_links', 'chk_one_destination'))) {
    await pool.query(`
      ALTER TABLE canvas_announcement_links ADD CONSTRAINT chk_one_destination CHECK (
        (activity_id IS NOT NULL) + (quiz_id IS NOT NULL) + (exam_id IS NOT NULL) +
        (grade_entry_id IS NOT NULL) + (workboard_item_id IS NOT NULL) + (schedule_override_id IS NOT NULL) = 1
      )
    `);
  }

  _ranWorkboard = true;
}

/** Create the Workboard v2 tables (projects, owned work items, and the academic overlay)
 *  if they don't already exist. Study Pulse's own tables are never modified — the overlay
 *  holds the only three Workboard-specific facts about an academic entry. */
export async function ensureWorkboardV2Schema(): Promise<void> {
  if (_ranWorkboardV2) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS workboard_projects (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      user_id     INT NOT NULL,
      name        VARCHAR(120) NOT NULL,
      color       VARCHAR(16) NULL,
      status      ENUM('active','archived') NOT NULL DEFAULT 'active',
      created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_user_project_name (user_id, name),
      FOREIGN KEY (user_id) REFERENCES user_login(user_id) ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS workboard_work_items (
      id               INT AUTO_INCREMENT PRIMARY KEY,
      user_id          INT NOT NULL,
      category         ENUM('academic','project','organization','life') NOT NULL,
      project_id       INT NULL,
      user_subject_id  INT NULL,
      title            VARCHAR(255) NOT NULL,
      note             TEXT NULL,
      priority         ENUM('high','normal','low') NOT NULL DEFAULT 'normal',
      work_status      ENUM('todo','in_progress','done') NOT NULL DEFAULT 'todo',
      due_at           DATETIME NULL,
      start_date       DATE NULL,
      estimated_hours  DECIMAL(5,2) NULL,
      completed_at     DATETIME NULL,
      created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_user_status (user_id, work_status),
      FOREIGN KEY (user_id) REFERENCES user_login(user_id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES workboard_projects(id) ON DELETE SET NULL,
      FOREIGN KEY (user_subject_id) REFERENCES user_subjects(user_subject_id) ON DELETE SET NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS workboard_entry_meta (
      id               INT AUTO_INCREMENT PRIMARY KEY,
      user_id          INT NOT NULL,
      activity_id      INT NULL,
      quiz_id          INT NULL,
      exam_id          INT NULL,
      grade_entry_id   INT NULL,
      in_progress      TINYINT(1) NOT NULL DEFAULT 0,
      estimated_hours  DECIMAL(5,2) NULL,
      start_date       DATE NULL,
      created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_activity (activity_id),
      UNIQUE KEY uniq_quiz (quiz_id),
      UNIQUE KEY uniq_exam (exam_id),
      UNIQUE KEY uniq_grade_entry (grade_entry_id),
      FOREIGN KEY (user_id) REFERENCES user_login(user_id) ON DELETE CASCADE,
      FOREIGN KEY (activity_id) REFERENCES activities(activity_id) ON DELETE CASCADE,
      FOREIGN KEY (quiz_id) REFERENCES quizzes(quiz_id) ON DELETE CASCADE,
      FOREIGN KEY (exam_id) REFERENCES exams(exam_id) ON DELETE CASCADE,
      FOREIGN KEY (grade_entry_id) REFERENCES grade_entries(entry_id) ON DELETE CASCADE,
      CONSTRAINT chk_meta_one_entry CHECK (
        (activity_id IS NOT NULL) + (quiz_id IS NOT NULL) +
        (exam_id IS NOT NULL) + (grade_entry_id IS NOT NULL) = 1
      )
    )
  `);

  _ranWorkboardV2 = true;
}

/** Workboard v3: per-context hierarchy (organizations, scoped projects, Life areas),
 *  multi-link resources, flat subtasks, first-class deadline time, and per-context
 *  status stages. Study Pulse's own tables are never altered — academic deadline time
 *  and stage live on the workboard_entry_meta overlay. */
export async function ensureWorkboardV3Schema(): Promise<void> {
  if (_ranWorkboardV3) return;

  // v3 is an extension of v2, never a standalone schema: it ALTERs workboard_entry_meta
  // and workboard_work_items, and its new tables carry foreign keys into
  // workboard_work_items -- all v2 objects. Chaining here makes that ordering hold by
  // construction, so a caller can ask for v3 alone and still get a coherent schema.
  await ensureWorkboardV2Schema();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS workboard_organizations (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      user_id     INT NOT NULL,
      name        VARCHAR(120) NOT NULL,
      status      ENUM('active','archived') NOT NULL DEFAULT 'active',
      created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_user_org_name (user_id, name),
      FOREIGN KEY (user_id) REFERENCES user_login(user_id) ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS workboard_item_links (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      user_id         INT NOT NULL,
      work_item_id    INT NULL,
      activity_id     INT NULL,
      quiz_id         INT NULL,
      exam_id         INT NULL,
      grade_entry_id  INT NULL,
      label           VARCHAR(120) NOT NULL,
      url             VARCHAR(2048) NOT NULL,
      link_type       ENUM('canvas','drive','docs','github','figma','website','portal','form','other')
                        NOT NULL DEFAULT 'other',
      position        SMALLINT NOT NULL DEFAULT 0,
      created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_link_work_item (work_item_id),
      KEY idx_link_user (user_id),
      FOREIGN KEY (user_id) REFERENCES user_login(user_id) ON DELETE CASCADE,
      FOREIGN KEY (work_item_id) REFERENCES workboard_work_items(id) ON DELETE CASCADE,
      FOREIGN KEY (activity_id) REFERENCES activities(activity_id) ON DELETE CASCADE,
      FOREIGN KEY (quiz_id) REFERENCES quizzes(quiz_id) ON DELETE CASCADE,
      FOREIGN KEY (exam_id) REFERENCES exams(exam_id) ON DELETE CASCADE,
      FOREIGN KEY (grade_entry_id) REFERENCES grade_entries(entry_id) ON DELETE CASCADE,
      CONSTRAINT chk_link_one_owner CHECK (
        (work_item_id IS NOT NULL) + (activity_id IS NOT NULL) + (quiz_id IS NOT NULL) +
        (exam_id IS NOT NULL) + (grade_entry_id IS NOT NULL) = 1
      )
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS workboard_subtasks (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      user_id         INT NOT NULL,
      work_item_id    INT NULL,
      activity_id     INT NULL,
      quiz_id         INT NULL,
      exam_id         INT NULL,
      grade_entry_id  INT NULL,
      title           VARCHAR(255) NOT NULL,
      is_done         TINYINT(1) NOT NULL DEFAULT 0,
      position        SMALLINT NOT NULL DEFAULT 0,
      created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_subtask_work_item (work_item_id),
      KEY idx_subtask_user (user_id),
      FOREIGN KEY (user_id) REFERENCES user_login(user_id) ON DELETE CASCADE,
      FOREIGN KEY (work_item_id) REFERENCES workboard_work_items(id) ON DELETE CASCADE,
      FOREIGN KEY (activity_id) REFERENCES activities(activity_id) ON DELETE CASCADE,
      FOREIGN KEY (quiz_id) REFERENCES quizzes(quiz_id) ON DELETE CASCADE,
      FOREIGN KEY (exam_id) REFERENCES exams(exam_id) ON DELETE CASCADE,
      FOREIGN KEY (grade_entry_id) REFERENCES grade_entries(entry_id) ON DELETE CASCADE,
      CONSTRAINT chk_subtask_one_owner CHECK (
        (work_item_id IS NOT NULL) + (activity_id IS NOT NULL) + (quiz_id IS NOT NULL) +
        (exam_id IS NOT NULL) + (grade_entry_id IS NOT NULL) = 1
      )
    )
  `);

  // --- workboard_projects: context scoping + optional parent ---
  const projectCols: [string, string][] = [
    ['context', `ADD COLUMN context ENUM('academic','project','organization') NOT NULL DEFAULT 'project'`],
    ['user_subject_id', `ADD COLUMN user_subject_id INT NULL`],
    ['organization_id', `ADD COLUMN organization_id INT NULL`],
  ];
  for (const [col, clause] of projectCols) {
    if (!(await columnExists('workboard_projects', col))) {
      await pool.query(`ALTER TABLE workboard_projects ${clause}`);
    }
  }
  if (!(await constraintExists('workboard_projects', 'fk_project_subject'))) {
    await pool.query(`ALTER TABLE workboard_projects
      ADD CONSTRAINT fk_project_subject FOREIGN KEY (user_subject_id)
      REFERENCES user_subjects(user_subject_id) ON DELETE CASCADE`);
  }
  if (!(await constraintExists('workboard_projects', 'fk_project_org'))) {
    await pool.query(`ALTER TABLE workboard_projects
      ADD CONSTRAINT fk_project_org FOREIGN KEY (organization_id)
      REFERENCES workboard_organizations(id) ON DELETE CASCADE`);
  }

  // --- workboard_work_items: life area, organization, deadline time, stage ---
  const itemCols: [string, string][] = [
    ['life_area', `ADD COLUMN life_area ENUM('personal','household','errands','finance','health','other') NULL`],
    ['organization_id', `ADD COLUMN organization_id INT NULL`],
    ['deadline_time', `ADD COLUMN deadline_time TIME NULL`],
    ['work_stage', `ADD COLUMN work_stage VARCHAR(24) NULL`],
  ];
  for (const [col, clause] of itemCols) {
    if (!(await columnExists('workboard_work_items', col))) {
      await pool.query(`ALTER TABLE workboard_work_items ${clause}`);
    }
  }
  if (!(await constraintExists('workboard_work_items', 'fk_item_org'))) {
    await pool.query(`ALTER TABLE workboard_work_items
      ADD CONSTRAINT fk_item_org FOREIGN KEY (organization_id)
      REFERENCES workboard_organizations(id) ON DELETE SET NULL`);
  }

  // --- workboard_entry_meta: academic deadline time + stage ---
  for (const [col, clause] of [
    ['deadline_time', `ADD COLUMN deadline_time TIME NULL`],
    ['work_stage', `ADD COLUMN work_stage VARCHAR(24) NULL`],
  ] as [string, string][]) {
    if (!(await columnExists('workboard_entry_meta', col))) {
      await pool.query(`ALTER TABLE workboard_entry_meta ${clause}`);
    }
  }

  // --- One-time data migrations, each idempotent by construction ---

  // 1. Existing overlay in_progress flags become the equivalent stage.
  //    `in_progress` is retained and kept in sync for one release (see the spec's
  //    Migration section) so a rollback loses nothing.
  await pool.query(`
    UPDATE workboard_entry_meta
    SET work_stage = 'in_progress'
    WHERE in_progress = 1 AND work_stage IS NULL
  `);

  // 2. Owned items get a stage derived from their existing normalised status.
  await pool.query(`
    UPDATE workboard_work_items
    SET work_stage = work_status
    WHERE work_stage IS NULL
  `);

  // 3. Any owned item whose due_at carries a non-midnight time moves that time into
  //    deadline_time and zeroes the time component, so "due at midnight" and "no time
  //    set" stop being indistinguishable. Guarded on deadline_time IS NULL so a second
  //    run cannot clobber a time the user has since edited.
  await pool.query(`
    UPDATE workboard_work_items
    SET deadline_time = TIME(due_at), due_at = DATE(due_at)
    WHERE due_at IS NOT NULL AND TIME(due_at) <> '00:00:00' AND deadline_time IS NULL
  `);

  _ranWorkboardV3 = true;
}
