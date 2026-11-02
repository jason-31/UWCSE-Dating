-- Avatar upload attempts, counted per email in a rolling 30-day window (src/platform/avatars.js).
-- Kept apart from the avatars table so that deleting an upload or the account never restores
-- attempts. Only HMAC(ACCOUNT_KEY, email) is stored, and rows older than the window are deleted.
CREATE TABLE avatar_upload_attempts (
  email_mac TEXT NOT NULL,
  attempted_at INTEGER NOT NULL
);
CREATE INDEX avatar_upload_attempts_mac ON avatar_upload_attempts (email_mac, attempted_at);
CREATE INDEX avatar_upload_attempts_time ON avatar_upload_attempts (attempted_at);

-- 0005 kept pruned avatar rows for an hour so the old hourly limit could count them; uploads are
-- now counted above, so that column is no longer used.
ALTER TABLE avatars DROP COLUMN deleted_at;
