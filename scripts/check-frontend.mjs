#!/usr/bin/env node
// Checks that the live site serves the front end of a given commit unchanged (docs/oversight.md
// rule 11). Every file under public/ at that commit is fetched from the site and compared byte
// for byte; the exit status is 1 if any differs or is missing.
//
//   node scripts/check-frontend.mjs https://uwcse.date [commit]
//
// The commit defaults to HEAD. While the site is behind Cloudflare Access, pass an Access service
// token in CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET (the Access policy needs a Service Auth
// rule for it). Zone features that rewrite responses, such as Email Address Obfuscation or Rocket
// Loader, show up here as differences.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const [site, ref = "HEAD"] = process.argv.slice(2);
if (!site) {
  console.error("usage: node scripts/check-frontend.mjs <site url> [commit]");
  process.exit(2);
}

const root = fileURLToPath(new URL("..", import.meta.url));
const git = (...args) => execFileSync("git", args, { cwd: root, maxBuffer: 64 << 20 });
const commit = git("rev-parse", "--verify", `${ref}^{commit}`).toString().trim();
// Files Cloudflare reads as configuration instead of serving.
const NOT_SERVED = new Set(["public/_headers", "public/_redirects", "public/.assetsignore"]);
const files = git("ls-tree", "-r", "--name-only", commit, "public/")
  .toString()
  .split("\n")
  .filter((f) => f && !NOT_SERVED.has(f));

const headers = {};
if (process.env.CF_ACCESS_CLIENT_ID) {
  headers["CF-Access-Client-Id"] = process.env.CF_ACCESS_CLIENT_ID;
  headers["CF-Access-Client-Secret"] = process.env.CF_ACCESS_CLIENT_SECRET;
}
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

let differing = 0;
for (const file of files) {
  const path = file.slice("public".length); // "/app.js"
  const want = sha256(git("show", `${commit}:${file}`));
  // Redirects are followed: the asset server sends /index.html to /, for example.
  const res = await fetch(new URL(path, site), { headers, redirect: "follow" });
  const got = res.ok ? sha256(Buffer.from(await res.arrayBuffer())) : null;
  if (got !== want) differing++;
  console.log(`${got === want ? "same" : "DIFF"}  ${path}${res.ok ? "" : `  (HTTP ${res.status})`}`);
}
console.log(`\n${files.length - differing} of ${files.length} files match commit ${commit.slice(0, 12)}`);
process.exit(differing ? 1 : 0);
