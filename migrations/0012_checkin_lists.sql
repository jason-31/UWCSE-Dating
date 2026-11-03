-- No past lists (docs/product.md): who was on a list is kept only while that list is open. The
-- daily clean-up deletes the rows of closed periods, so the list moves out of ci_checkins into its
-- own table; ci_checkins keeps only the check-in itself (history and streak).
CREATE TABLE ci_lists (
  challenge_id TEXT NOT NULL,
  period_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  member_id TEXT NOT NULL,              -- opaque id shown on cards instead of user_id
  status TEXT NOT NULL CHECK (status IN ('active', 'left')),
  joined_at INTEGER NOT NULL,
  left_at INTEGER,
  PRIMARY KEY (challenge_id, period_id, user_id)
);
CREATE INDEX ci_lists_list ON ci_lists (challenge_id, period_id, status, joined_at);

-- A period still open somewhere is never older than yesterday in UTC; older lists are dropped
-- here, and the next clean-up drops the rest.
INSERT INTO ci_lists (challenge_id, period_id, user_id, member_id, status, joined_at, left_at)
  SELECT challenge_id, period_id, user_id, member_id, status, checked_in_at, left_at FROM ci_checkins
  WHERE period_id >= date('now', '-1 day');
DROP INDEX ci_checkins_list;
ALTER TABLE ci_checkins DROP COLUMN member_id;
ALTER TABLE ci_checkins DROP COLUMN status;
ALTER TABLE ci_checkins DROP COLUMN left_at;

DELETE FROM lc_memberships WHERE period_id < date('now', '-1 day');
