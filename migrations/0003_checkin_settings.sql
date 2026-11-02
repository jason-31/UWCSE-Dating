-- Per-user check-in preferences. auto_join: whether checking in also puts you on that
-- period's list. A missing row means the default (on).
CREATE TABLE ci_settings (
  challenge_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  auto_join INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (challenge_id, user_id)
);
