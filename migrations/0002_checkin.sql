-- Daily check-in module. One row per user per period; checking in puts the user on that
-- period's list (status active) and leaving keeps the row with status left.
CREATE TABLE ci_checkins (
  challenge_id TEXT NOT NULL,
  period_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  member_id TEXT NOT NULL,              -- opaque id shown on cards instead of user_id
  status TEXT NOT NULL CHECK (status IN ('active', 'left')),
  checked_in_at INTEGER NOT NULL,
  left_at INTEGER,
  PRIMARY KEY (challenge_id, period_id, user_id)
);
CREATE INDEX ci_checkins_list ON ci_checkins (challenge_id, period_id, status, checked_in_at);
CREATE INDEX ci_checkins_user ON ci_checkins (challenge_id, user_id, period_id);
