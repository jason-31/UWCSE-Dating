import { vault, emailHash } from "./vault.js";
import { profilesChangedStatement } from "./profile.js";

// Permanent bans, keyed by the "email" lookup hash so deleting the account and registering again
// doesn't lift them; the reason is sealed to that hash. Only the Worker holds DATA_KEY, so the
// operator cannot compute the hash: scripts/ban.mjs queues the email in ban_requests and the
// Worker's scheduled run applies and deletes each request (src/index.js). A banned person can
// then only sign out and delete their data, and their card disappears from every list.

export async function isBanned(env, email) {
  return !!(await env.DB.prepare("SELECT 1 FROM bans WHERE email_hash = ?").bind(await emailHash(env, email)).first());
}

export async function applyBanRequests(env, now) {
  const rows = await env.DB.prepare("SELECT rowid, email, action, reason FROM ban_requests ORDER BY requested_at LIMIT 50").all();
  for (const r of rows.results) {
    const hash = await emailHash(env, String(r.email).trim().toLowerCase());
    const change =
      r.action === "add"
        ? env.DB.prepare(
            `INSERT INTO bans (email_hash, reason, banned_at) VALUES (?, ?, ?)
             ON CONFLICT (email_hash) DO UPDATE SET reason = excluded.reason`,
          ).bind(hash, r.reason ? await vault(env).seal(`ban:${hash}`, r.reason) : null, now)
        : env.DB.prepare("DELETE FROM bans WHERE email_hash = ?").bind(hash);
    await env.DB.batch([change, env.DB.prepare("DELETE FROM ban_requests WHERE rowid = ?").bind(r.rowid), profilesChangedStatement(env.DB)]);
  }
}
