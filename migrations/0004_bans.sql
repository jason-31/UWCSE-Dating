-- Permanent bans, keyed by sign-in email so deleting the account and registering again
-- doesn't lift them. Managed with scripts/ban.mjs; there is no admin UI.
CREATE TABLE bans (
  email TEXT PRIMARY KEY,
  reason TEXT,
  banned_at INTEGER NOT NULL
);
