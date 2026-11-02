-- Every account was deleted by 0009, so the challenge modules' rows go too. Problem periods
-- (lc_periods) stay: they hold no personal data and keep the recent-problem exclusion working.
DELETE FROM ci_checkins;
DELETE FROM ci_settings;
DELETE FROM lc_badges;
DELETE FROM lc_memberships;
DELETE FROM lc_completions;
DELETE FROM lc_attempts;
DELETE FROM lc_period_locks;
DELETE FROM lc_binding_tokens;
DELETE FROM lc_bindings;
DELETE FROM lc_enrollments;

-- LeetCode usernames identify people, so they are sealed through ctx.vault (bound to
-- "leetcode-daily:leetcode-username:<user_id>" and the like), and uniqueness is checked on a
-- lookup hash. lc_binding_tokens.username and .token, lc_period_locks.username and
-- lc_attempts.evidence hold sealed values from now on.
ALTER TABLE lc_binding_tokens RENAME COLUMN username_norm TO username;
ALTER TABLE lc_bindings DROP COLUMN username;
ALTER TABLE lc_bindings RENAME COLUMN username_norm TO username_hash;
ALTER TABLE lc_bindings ADD COLUMN username TEXT NOT NULL DEFAULT '';
