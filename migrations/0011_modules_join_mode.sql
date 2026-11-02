-- "Join this period's list automatically" becomes a three-way choice (src/platform/join-mode.js):
-- always, ask (each time the task is done) or never. Existing on/off settings map to always/never.

ALTER TABLE ci_settings ADD COLUMN join_mode TEXT NOT NULL DEFAULT 'always' CHECK (join_mode IN ('always', 'ask', 'never'));
UPDATE ci_settings SET join_mode = CASE WHEN auto_join = 1 THEN 'always' ELSE 'never' END;
ALTER TABLE ci_settings DROP COLUMN auto_join;

ALTER TABLE lc_enrollments ADD COLUMN join_mode TEXT NOT NULL DEFAULT 'never' CHECK (join_mode IN ('always', 'ask', 'never'));
UPDATE lc_enrollments SET join_mode = CASE WHEN consent_auto_join = 1 THEN 'always' ELSE 'never' END;
ALTER TABLE lc_enrollments DROP COLUMN consent_auto_join;
-- When the person last made that choice.
ALTER TABLE lc_enrollments RENAME COLUMN consent_at TO join_mode_at;
