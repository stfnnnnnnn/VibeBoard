-- Auth v2 (docs/superpowers/specs/2026-10-23-public-pages-auth-revamp-design.md §3.5).
-- The app applies the same change idempotently via ensureAuthV2Schema() in src/lib/migrate.ts.
-- Run this file once by hand only on a database the app has not touched yet.
ALTER TABLE user_login
  MODIFY middle_name VARCHAR(100) NULL,
  MODIFY year_level  ENUM('1st Year','2nd Year','3rd Year','4th Year','5th Year') NULL,
  MODIFY status      ENUM('Regular','Irregular') NULL,
  MODIFY program     INT(11) NULL,
  MODIFY password    VARCHAR(255) NULL,
  ADD COLUMN google_sub        VARCHAR(255) NULL,
  -- Existing accounts predate verification; the temporary default stamps them as verified in this
  -- same statement (accepted risk, spec §3.5). The default is removed right after.
  ADD COLUMN email_verified_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN session_version   INT NOT NULL DEFAULT 0,
  ADD COLUMN created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD UNIQUE KEY google_sub_unique (google_sub);

-- New accounts get NULL unless verified (createUser writes the column explicitly). MODIFY rather than
-- ALTER COLUMN ... DROP DEFAULT, which MariaDB 10.4 silently ignores for a CURRENT_TIMESTAMP default.
ALTER TABLE user_login MODIFY email_verified_at DATETIME NULL DEFAULT NULL;

CREATE TABLE IF NOT EXISTS auth_tokens (
  token_id   INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT NOT NULL,
  purpose    ENUM('reset','verify') NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at    DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY token_hash_unique (token_hash),
  KEY user_purpose (user_id, purpose, created_at),
  CONSTRAINT auth_tokens_user FOREIGN KEY (user_id) REFERENCES user_login(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
