-- Sign-in keeps a login attempt in a signed cookie instead of a row (src/platform/google-auth.js),
-- so an anonymous GET /auth/login no longer reads or writes D1.
DROP TABLE IF EXISTS oauth_states;

-- The expired-session sweep that runs on each login searches this index instead of scanning
-- every session.
CREATE INDEX sessions_expires ON sessions (expires_at);

-- Pruned avatar uploads keep their row for an hour, with deleted_at set, so the hourly upload
-- limit can still count them. The image itself is deleted from R2 immediately.
ALTER TABLE avatars ADD COLUMN deleted_at INTEGER;
