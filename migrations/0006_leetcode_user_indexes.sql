-- Per-user LeetCode queries that have no period (history, withdraw, purge) filter by
-- (challenge_id, user_id). The primary keys start with (challenge_id, period_id), so without
-- these indexes each of those queries scans the challenge's whole history.
CREATE INDEX lc_completions_user ON lc_completions (challenge_id, user_id, period_id);
CREATE INDEX lc_memberships_user ON lc_memberships (challenge_id, user_id, period_id);
CREATE INDEX lc_period_locks_user ON lc_period_locks (challenge_id, user_id, period_id);
