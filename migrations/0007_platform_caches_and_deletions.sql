-- Version tokens for the in-memory caches in src/platform/cache.js: "profiles" and one
-- "list:<challenge_id>:<period_id>" per member list. Every write that changes the cached data
-- replaces the token in the same batch. Manual SQL that changes profiles, users, bans or list
-- rows should do the same, or the change shows up only when the cached copy expires (1 hour).
CREATE TABLE cache_versions (
  name TEXT PRIMARY KEY,
  version INTEGER NOT NULL
) WITHOUT ROWID;

-- Deleted accounts whose profile change locks had not expired yet. Registration with the same
-- email is refused until reregister_after, so deleting and re-registering cannot reset the locks.
-- Only HMAC(ACCOUNT_KEY, email) is stored, never the email.
CREATE TABLE deleted_accounts (
  email_mac TEXT PRIMARY KEY,
  reregister_after INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX deleted_accounts_expiry ON deleted_accounts (reregister_after);
