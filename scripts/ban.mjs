// Permanent bans, managed from the command line (there is deliberately no admin UI).
//
//   npm run ban -- add someone@cs.washington.edu "reason"  [--remote]
//   npm run ban -- remove someone@cs.washington.edu       [--remote]
//   npm run ban -- status                                  [--remote]
//
// Without --remote it changes the local development database. Bans are stored by a keyed hash of
// the email that only the Worker can compute (src/platform/bans.js), so this script only queues
// the request; the Worker's scheduled run applies it within about five minutes. From then on the
// person can only sign out and delete their data, and their card disappears from all lists.
// There is no list of banned emails: the database holds hashes and sealed reasons only.
import { spawnSync } from "node:child_process";

const DB = "uwcse-date-db";
const args = process.argv.slice(2);
const remote = args.includes("--remote");
const [command, email, reason] = args.filter((a) => a !== "--remote");

function usage(message) {
  if (message) console.error(message);
  console.error('usage: npm run ban -- add <email> ["reason"] | remove <email> | status  [--remote]');
  process.exit(1);
}

// wrangler d1 execute takes no bound parameters, so values are validated and quoted here.
const quote = (s) => `'${String(s).replace(/'/g, "''")}'`;

function run(sql) {
  const res = spawnSync("npx", ["wrangler", "d1", "execute", DB, remote ? "--remote" : "--local", "--command", sql], {
    stdio: "inherit",
  });
  process.exit(res.status ?? 1);
}

if (command === "status") {
  run("SELECT (SELECT COUNT(*) FROM bans) AS bans, (SELECT COUNT(*) FROM ban_requests) AS pending_requests");
}
if (command !== "add" && command !== "remove") usage();
const normalized = (email || "").trim().toLowerCase();
if (!/^[^@\s']+@[^@\s']+\.[^@\s']+$/.test(normalized)) usage("a valid email is required");

run(
  `INSERT INTO ban_requests (email, action, reason, requested_at)
   VALUES (${quote(normalized)}, '${command}', ${command === "add" && reason ? quote(reason) : "NULL"}, ${Date.now()})`,
);
