import { expiredSessionsStatement } from "./google-auth.js";
import { expiredTombstonesStatement } from "./deletions.js";
import { expiredAttemptsStatement, pruneUnusedUploads } from "./avatars.js";

// Daily clean-up of platform tables (the Cron Trigger in wrangler.jsonc; src/index.js also runs
// each challenge module's dataLifecycle.prune). It deletes only rows that no request reads any
// more: expired sessions and deletion tombstones, upload attempts outside their window, and
// uploads that no profile uses. Request paths already drop some of these as they go; this catches
// the rest, so nothing stays in the database just because nobody came back.
export async function pruneExpired(env, now) {
  await env.DB.batch([
    expiredSessionsStatement(env.DB, now),
    expiredTombstonesStatement(env.DB, now),
    expiredAttemptsStatement(env.DB, now),
  ]);
  await pruneUnusedUploads(env, now);
}
