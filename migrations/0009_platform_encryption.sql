-- Encryption at rest (src/platform/vault.js). Personal values are now stored sealed with keys
-- derived from the DATA_KEY secret, or as keyed hashes, and SQL cannot convert the old plaintext
-- rows without that key. So this migration deletes every account and its data (the closed
-- beta's) and recreates the platform tables; 0010 does the same for the challenge modules.
-- Uploaded images left in R2 are deleted by the daily clean-up once no row refers to them.

DROP TABLE profiles;
DROP TABLE users;
DROP TABLE sessions;
DROP TABLE bans;
DROP TABLE avatars;

-- email_hash is the "email" lookup hash, shared by users, sessions, bans and avatars.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  terms_accepted_at INTEGER NOT NULL
);

-- The whole profile, including the email shown on cards and the change-lock timers, sealed as
-- one value bound to "profile:<user_id>". avatar_upload is the id of the uploaded avatar in use
-- (NULL for a preset), kept apart so the clean-up can find unused uploads.
CREATE TABLE profiles (
  user_id TEXT PRIMARY KEY REFERENCES users (id),
  data TEXT NOT NULL,
  avatar_upload TEXT
);

-- data seals { email, expires_at } bound to "session:<token_hash>", so a row inserted or edited
-- without DATA_KEY is not a valid session.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  email_hash TEXT NOT NULL,
  data TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_email ON sessions (email_hash);
CREATE INDEX sessions_expires ON sessions (expires_at);

-- reason is sealed, bound to "ban:<email_hash>".
CREATE TABLE bans (
  email_hash TEXT PRIMARY KEY,
  reason TEXT,
  banned_at INTEGER NOT NULL
);

-- Ban and unban requests from scripts/ban.mjs. The operator cannot compute email hashes, so the
-- script queues the email here and the Worker's scheduled run (every few minutes) applies and
-- deletes the request.
CREATE TABLE ban_requests (
  email TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('add', 'remove')),
  reason TEXT,
  requested_at INTEGER NOT NULL
);

-- The image in R2 is sealed, bound to "avatar:<id>".
CREATE TABLE avatars (
  id TEXT PRIMARY KEY,
  owner_hash TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX avatars_owner ON avatars (owner_hash, created_at);

-- Tombstones and upload counts were keyed with ACCOUNT_KEY; they are now keyed with DATA_KEY,
-- so the old rows can never match again.
DELETE FROM deleted_accounts;
DELETE FROM avatar_upload_attempts;
DELETE FROM cache_versions;
