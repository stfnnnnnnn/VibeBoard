import pool from '@/lib/db';

let _ranAc = false;
let _ranGs = false;
let _ranFg = false;
let _ranCl = false;
let _ranCanvas = false;
let _ranSs = false;
let _ranHabitsV2 = false;

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
      habit_urgency ENUM('Urgent','Priority','Important','Not Important','Not Urgent') NOT NULL,
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
