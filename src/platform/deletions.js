import { HttpError, L, pacificTime } from "./http.js";
import { lockedUntil } from "./profile.js";
import { vault } from "./vault.js";

// Deleting an account and registering again must not reset the profile change locks (relations
// and filters: 7 days; nickname, gender, program: 30 days). Otherwise one member could
// register as each gender in turn and, through the two-way ROMANCE filters, learn which genders
// every member seeking romance accepts. So deleting an account records a tombstone until its locks would
// have expired, and registration with that email is refused until then.
//
// A tombstone holds only a keyed hash of the email (src/platform/vault.js, its own purpose, so it
// matches no other table), never the email itself, so the table cannot be read back as a list
// of people who left.

const PURPOSE = "deleted-account";

// Removes tombstones that have expired (also run by the daily clean-up, src/platform/retention.js).
export function expiredTombstonesStatement(db, now) {
  return db.prepare("DELETE FROM deleted_accounts WHERE reregister_after <= ?").bind(now);
}

// Statements to add to the account-deletion batch: the tombstone (when a lock is still running)
// and removal of tombstones that have expired.
export async function tombstoneStatements(env, email, profile, cfg, now) {
  const stmts = [expiredTombstonesStatement(env.DB, now)];
  const until = profile ? Math.max(...Object.values(lockedUntil(profile, cfg))) : 0;
  if (until <= now) return stmts;
  const mac = await vault(env).lookup(PURPOSE, email);
  stmts.push(
    env.DB.prepare(
      `INSERT INTO deleted_accounts (email_mac, reregister_after) VALUES (?, ?)
       ON CONFLICT (email_mac) DO UPDATE SET reregister_after = MAX(deleted_accounts.reregister_after, excluded.reregister_after)`,
    ).bind(mac, until),
  );
  return stmts;
}

// Throws unless this email may register now.
export async function assertMayRegister(env, email, now) {
  const mac = await vault(env).lookup(PURPOSE, email);
  const row = await env.DB.prepare("SELECT reregister_after FROM deleted_accounts WHERE email_mac = ?").bind(mac).first();
  if (row && now < row.reregister_after) {
    throw new HttpError(
      409,
      "recently_deleted",
      L(
        `这个邮箱的账号不久前已删除。为防止删号重注册绕过资料修改限制，${pacificTime(row.reregister_after, "zh-CN")}（太平洋时间）之后才能重新注册。`,
        `An account with this email was deleted recently. So that deleting and registering again cannot get around the profile change limits, you can register again after ${pacificTime(row.reregister_after, "en-US")} (Pacific time).`,
      ),
      { reregister_after: row.reregister_after },
    );
  }
}
