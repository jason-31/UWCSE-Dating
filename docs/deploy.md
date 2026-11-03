# Deployment checklist

Steps that cannot live in code and must be done (or checked) when deploying to Cloudflare. Tick them off per environment. The reasons behind most of them are in [oversight.md](oversight.md).

## Before the first production deploy

- [x] **wrangler.jsonc bindings.** The code uses the `DB` and `BUCKET` bindings. Put the real `database_id` (from `wrangler d1 create`) on `DB` and remove the duplicate `uwcse_date_db` / `uwcse_date_bucket` entries that `wrangler d1 create` and `wrangler r2 bucket create` appended.
- [x] **D1 location.** (Checked 2026-11-01: `running_in_region` WNAM.) Check `wrangler d1 info uwcse-date-db`. If the primary is not in `wnam` (western North America), recreate the database with `--location=wnam` while it is still empty; every request makes several sequential D1 round trips.
- [x] **Hostnames.** (2026-11-01: served only at `uwcse.date`, behind Cloudflare Access; workers.dev and preview URLs off.) Add the custom domain as `"routes": [{ "pattern": "<domain>", "custom_domain": true }]` and set `"workers_dev": false` and `"preview_urls": false`, so no second hostname bypasses zone rules or runs preview versions against production data.
- [x] **Secrets.** (Set 2026-11-01.) `wrangler secret put GOOGLE_CLIENT_SECRET`. `GOOGLE_CLIENT_ID` can be a plain var.
- [x] **DATA_KEY** (2026-11-01: created by the Provision DATA_KEY workflow, run 41380593119; encryption at rest, `src/platform/vault.js`). Without it every API request that touches personal data answers 503 `server_misconfigured`. Create it only with the Provision DATA_KEY workflow (below), so that nobody ever sees it. Never change or delete it afterwards: every account, session and avatar would become unreadable. `ACCOUNT_KEY` is no longer used.
- [x] **Migrations.** (0001-0010 applied 2026-11-01; 0009 and 0010 by the first CI deployment.) The deploy workflow applies the rest before each deployment. **0009 and 0010 delete every account and its data** (they could not be converted to the encrypted form in SQL), so everyone registers again; old avatar images left in R2 are deleted by the next daily clean-up. Migrations are append-only: never edit or rename an applied file.
- [ ] **Rate limiting bindings.** The `ratelimits` entries in wrangler.jsonc need no setup, but confirm they are active on the deployed plan. Signed in on the site, run this in the browser console; the home-page list allows 30 requests a minute, so 429s should appear by the end (counts are per location and approximate):

  ```js
  const codes = [];
  for (let i = 0; i < 40; i++) codes.push((await fetch("/api/people", { headers: { "x-uwcse-csrf": "1" } })).status);
  console.log(codes.join(" "));
  ```

  If every request returns 200, the plan does not support the bindings and the code lets every request through (it never fails closed).
- [x] **WAF rate-limiting rule** (2026-11-01: rule `api-auth-flood` on uwcse.date with the expression below, 60 requests per 10 seconds; a burst of 75 requests from one IP got 61 through and 14 answered 429. Free plan: one rule, counted per IP over 10 seconds, blocks for 10 seconds). In the dashboard: the zone → Security → WAF → Rate limiting rules → Create rule. Match "URI Path" "starts with" `/api/` or "URI Path" "starts with" `/auth/`; as an expression:

  ```
  (starts_with(http.request.uri.path, "/api/") or starts_with(http.request.uri.path, "/auth/"))
  ```

  Rate: 60 requests per 10 seconds; action Block. If the Free editor offers no "starts with", use "wildcard" with `/api/*` and `/auth/*`. If it offers neither, match every path at about 150 per 10 seconds instead (a page view also fetches about 30 static files, which are free but still counted). This is the only protection that stops a flood before it counts against the Workers request quota.
- [x] **Google OAuth client.** (2026-11-01: sign-in confirmed working.) (2026-11-01: redirect URIs are `https://uwcse.date/auth/callback` and `http://localhost:8799/auth/callback` for local development. The client stays in Testing during the closed beta, so every tester must be listed under Google Auth Platform → Audience → Test users as well as in the Access policy.) Before the public launch: publish the app (Audience → Publish app; openid and email need no verification, but adding a logo triggers brand verification). Sign in with 3-5 ordinary CSE accounts that are not listed as test users. Ask CSE support whether third-party Sign in with Google is allowed for cs.washington.edu accounts.
- [ ] **Scheduled runs.** After deploying, the Worker's Settings → Trigger events should list `*/5 * * * *` (queued ban requests) and `17 8 * * *` (daily clean-up). A run's outcome shows under the Worker's Cron events; a failed step is logged by name.
- [ ] **Accounts.** Hardware-key 2FA on the Cloudflare, Google Cloud and GitHub accounts. Once continuous deployment works (below), deploy only through it and run `wrangler logout` on every machine.
- [x] **Plan for launch day.** (2026-11-01: staying on the Free plan for now.) Decide whether to run Workers Paid (about $5/month) at least for the launch month; on Free, a busy launch day can exhaust the daily D1 read and Worker request quotas until 00:00 UTC.

## Continuous deployment (GitHub Actions)

Production is deployed only by the public CI workflow from the protected `main` branch (oversight.md rule 2):

- `.github/workflows/deploy.yml` runs on every push to `main` (or by hand): tests, then, in the `production` environment, a check that the Worker has `DATA_KEY`, the D1 migrations and `wrangler deploy`, whose log shows the deployed Version ID.
- `.github/workflows/provision-key.yml`, run once by hand, creates `DATA_KEY` inside the run and pipes it into `wrangler secret put` without printing it. It refuses to run if the key already exists. In a new account it also creates the Worker.
- `.github/workflows/set-google-secret.yml`, run by hand, puts the production environment's `GOOGLE_CLIENT_SECRET` secret on the Worker. Worker secrets are only ever changed by these workflows, never in the dashboard: in the audit log a dashboard secret change looks the same as a dashboard code change.

- [x] **Public repository.** (2026-11-01: https://github.com/jason-31/UWCSE-Dating.)
- [ ] **Protect `main`.** Repository → Settings → Rules → Rulesets (or Branches): for `main`, block force pushes and deletions and require changes through pull requests.
- [x] **Environment.** Repository → Settings → Environments → New environment `production`. Under "Deployment branches and tags", allow only `main`, so workflows on other branches and pull requests cannot read its secrets. Add the environment variable `CLOUDFLARE_ACCOUNT_ID` (the account ID is not a secret).
- [x] **Deploy token.** Cloudflare dashboard → Manage account → Account API tokens → Create Token, starting from the "Edit Cloudflare Workers" template. An account token does not depend on any one person's login. Keep exactly these permissions:

  | Scope | Permission | Needed for |
  |---|---|---|
  | Account | Workers Scripts: Edit | code, static assets, secrets, cron triggers |
  | Account | D1: Edit | migrations |
  | Account | Account Settings: Read | wrangler's account lookups |
  | Zone `uwcse.date` | Workers Routes: Edit | the custom domain |

  Remove the template's KV, R2, Pages and Tail permissions. Account resources: this account only; zone resources: `uwcse.date` only; no IP filter (GitHub's runners have no fixed addresses); no expiry. Paste the token straight into the `production` environment as the secret `CLOUDFLARE_API_TOKEN` and keep no other copy. The D1 permission can also read the database, which is why only CI may hold this token; any workflow change that uses it is a public commit.
- [x] **First run.** (2026-11-01: Deploy run 41380715346 deployed version `f490c79a-161e-4565-beb4-774dd702f584`.) Actions → Provision DATA_KEY → Run workflow, then Actions → Deploy → Run workflow. The deploy applies migrations 0009 and 0010, which delete every account from before encryption. If a permission is missing, the failing step names it. Afterwards delete the unused `ACCOUNT_KEY` secret (Worker → Settings → Variables and secrets) and run `wrangler logout` locally.

## Operating

- **Bans.** `npm run ban -- add someone@cs.washington.edu "reason" --remote` (or `remove`) queues the request; the Worker applies it within five minutes. `npm run ban -- status --remote` shows how many bans exist and how many requests are waiting. There is no list of banned emails: only the Worker can compute the hashes.
- **Manual SQL.** Profiles, sessions and bans are sealed, so they cannot be edited by hand. The Worker caches profiles and member lists in memory and reloads them when a version token changes; a manual change to list rows should end with:

  ```sql
  INSERT INTO cache_versions (name, version) VALUES ('list:<challenge_id>:<period_id>', random() % 1000000000000)
  ON CONFLICT (name) DO UPDATE SET version = random() % 1000000000000;
  ```

  Otherwise the change shows up within an hour, when the cached copy expires.
- **Quotas.** Make sure the Cloudflare account email (which receives the D1 daily-limit notices) reaches someone who will act on it. When a daily limit is reached, the site shows a "daily capacity reached" message until 00:00 UTC.
- **Front-end check.** `node scripts/check-frontend.mjs https://uwcse.date <commit>` confirms the live static files match a commit. Behind Access it needs an Access service token in `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET`.
