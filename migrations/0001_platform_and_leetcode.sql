-- Platform layer: identity mapping and the site-wide profile. No site-wide lists or scores.
-- A row exists only after the Access-authenticated email explicitly registers.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  terms_accepted_at INTEGER NOT NULL
);

-- Google sign-in. A login attempt lives in oauth_states for a few minutes; a session row
-- stores only the SHA-256 of the browser's random session token.
CREATE TABLE oauth_states (
  state TEXT PRIMARY KEY,
  nonce TEXT NOT NULL,
  verifier TEXT NOT NULL,               -- PKCE code verifier
  created_at INTEGER NOT NULL
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,                  -- may sign in before registering, so keyed by email
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_email ON sessions (email);

-- Site-wide personal profile, one per user. Challenges keep only challenge-specific data. The email
-- is always the Access login email in users.email, so profiles has no email column.
CREATE TABLE profiles (
  user_id TEXT PRIMARY KEY REFERENCES users (id),
  schema_version INTEGER NOT NULL,
  nickname TEXT NOT NULL,
  gender TEXT NOT NULL,                 -- one of site profile.gender_options; basic info, always shown
  avatar TEXT NOT NULL,
  relations TEXT NOT NULL,              -- JSON array
  relation_filters TEXT NOT NULL,       -- JSON {relation: {gender: [...], program: [...]}}; two-way
  matching_changed_at INTEGER NOT NULL, -- relations/filters may change again only after a cooldown
  basic_changed_at INTEGER NOT NULL,    -- nickname/gender/program/avatar likewise, with their own timer
  relation_notes TEXT NOT NULL,         -- JSON {relation: note}, shown only to that relation
  wechat TEXT,
  discord TEXT,
  bio TEXT,
  program TEXT NOT NULL,                -- one of site profile.program_options; basic info, always shown
  research TEXT,
  visibility TEXT NOT NULL,             -- JSON {field: [relation...]}
  updated_at INTEGER NOT NULL
);

-- Uploaded avatars. The image is in R2 at avatars/<id>; a profile refers to it as "upload:<id>".
-- Keyed by the Access email because people may upload while registering, before users has a row.
CREATE TABLE avatars (
  id TEXT PRIMARY KEY,                  -- random 128-bit hex; also the R2 object name
  owner_email TEXT NOT NULL,
  content_type TEXT NOT NULL,           -- sniffed from the bytes: image/png | image/jpeg | image/webp
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX avatars_owner ON avatars (owner_email, created_at);

-- LeetCode module tables. Every row carries challenge_id; period-scoped rows also carry period_id.
-- Timestamps are UTC epoch milliseconds.

CREATE TABLE lc_enrollments (
  challenge_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  member_id TEXT NOT NULL,              -- challenge-local identifier shown on cards
  status TEXT NOT NULL CHECK (status IN ('active', 'withdrawn')),
  consent_auto_join INTEGER NOT NULL DEFAULT 0,
  consent_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (challenge_id, user_id),
  UNIQUE (challenge_id, member_id)
);

CREATE TABLE lc_binding_tokens (
  challenge_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  site TEXT NOT NULL,
  username_norm TEXT NOT NULL,
  token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (challenge_id, user_id)
);

CREATE TABLE lc_bindings (
  challenge_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  site TEXT NOT NULL,
  username TEXT NOT NULL,
  username_norm TEXT NOT NULL,
  version INTEGER NOT NULL,
  verified_at INTEGER NOT NULL,
  PRIMARY KEY (challenge_id, user_id),
  UNIQUE (challenge_id, site, username_norm)
);

CREATE TABLE lc_periods (
  challenge_id TEXT NOT NULL,
  period_id TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  timezone TEXT NOT NULL,
  problem TEXT NOT NULL,                -- JSON snapshot
  pool_version TEXT NOT NULL,
  config_version INTEGER NOT NULL,
  module_version INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (challenge_id, period_id)
);

-- Binding used for a period, fixed at the user's first verification attempt in it.
CREATE TABLE lc_period_locks (
  challenge_id TEXT NOT NULL,
  period_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  site TEXT NOT NULL,
  username TEXT NOT NULL,
  binding_version INTEGER NOT NULL,
  locked_at INTEGER NOT NULL,
  PRIMARY KEY (challenge_id, period_id, user_id),
  FOREIGN KEY (challenge_id, period_id) REFERENCES lc_periods (challenge_id, period_id)
);

CREATE TABLE lc_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  challenge_id TEXT NOT NULL,
  period_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  binding_version INTEGER NOT NULL,
  requested_at INTEGER NOT NULL,
  finished_at INTEGER,
  result TEXT,                          -- verified | not_found | unverifiable | provider_unavailable | invalid_request
  source TEXT NOT NULL,
  source_version TEXT NOT NULL,
  error TEXT,
  evidence TEXT                         -- JSON minimal evidence summary
);
CREATE INDEX lc_attempts_user ON lc_attempts (challenge_id, user_id, requested_at);
CREATE INDEX lc_attempts_challenge ON lc_attempts (challenge_id, requested_at);

CREATE TABLE lc_completions (
  challenge_id TEXT NOT NULL,
  period_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  problem_slug TEXT NOT NULL,
  accepted_at INTEGER NOT NULL,
  submission_id TEXT NOT NULL,
  source TEXT NOT NULL,
  attempt_id INTEGER NOT NULL,
  verified_at INTEGER NOT NULL,
  PRIMARY KEY (challenge_id, period_id, user_id),
  FOREIGN KEY (challenge_id, period_id) REFERENCES lc_periods (challenge_id, period_id)
);

CREATE TABLE lc_memberships (
  challenge_id TEXT NOT NULL,
  period_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'left')),
  joined_at INTEGER NOT NULL,
  left_at INTEGER,
  PRIMARY KEY (challenge_id, period_id, user_id),
  FOREIGN KEY (challenge_id, period_id, user_id) REFERENCES lc_completions (challenge_id, period_id, user_id)
);
CREATE INDEX lc_memberships_list ON lc_memberships (challenge_id, period_id, status, joined_at);

CREATE TABLE lc_badges (
  challenge_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  rule TEXT NOT NULL,
  period_id TEXT NOT NULL,
  awarded_at INTEGER NOT NULL,
  PRIMARY KEY (challenge_id, user_id, rule, period_id),
  FOREIGN KEY (challenge_id, period_id, user_id) REFERENCES lc_completions (challenge_id, period_id, user_id)
);
