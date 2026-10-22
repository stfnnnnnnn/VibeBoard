-- Finance revamp, What-if D wishlist (spec §10.2). Applied automatically by
-- ensureFinanceWishlistSchema() in src/lib/migrate.ts; kept here as a record. Local DB only.
CREATE TABLE IF NOT EXISTS finance_wishlist (
  wish_id     INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NOT NULL,
  name        VARCHAR(120) NOT NULL,
  amount      DECIMAL(12,2) NOT NULL,
  category    VARCHAR(40) NOT NULL DEFAULT 'leisure',
  status      ENUM('open','bought','goal') NOT NULL DEFAULT 'open',
  goal_id     INT NULL,
  expense_id  INT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_wishlist_user_status (user_id, status)
);
