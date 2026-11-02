# Implementing a challenge

A **challenge** is an independent activity on UWCSE.date: it has its own task per period, its own way of deciding who completed it, and its own per-period member lists. Each challenge is backed by a **module**, which is a server part plus a browser part. The platform handles sign-in, the site-wide profile, relation matching and the home page, and gives each module a restricted context.

Two modules exist today and serve as references:

| Module | Server | Browser | Tables |
|---|---|---|---|
| `leetcode` (LeetCode Daily) | `src/modules/leetcode/index.js` | `public/modules/leetcode/app.js` | `lc_*` |
| `checkin` (Daily Check-in) | `src/modules/checkin/index.js` | `public/modules/checkin/app.js` | `ci_*` |

`checkin` is the smallest complete example; start there.

## Checklist

1. Server module: `src/modules/<module_id>/index.js`, default-exporting the object described in [Server module](#server-module).
2. Browser module: `public/modules/<module_id>/app.js`, exporting `mount()` (see [Browser module](#browser-module)).
3. Migration: `migrations/NNNN_<module_id>.sql`, creating tables that all start with the module's `table_prefix` (see [Database](#database)).
4. Register the module in `src/index.js`:
   ```js
   import mymodule from "./modules/mymodule/index.js";
   const MODULES = Object.fromEntries([leetcode, checkin, mymodule].map((m) => [m.manifest.module_id, m]));
   ```
5. Add one or more challenge entries to `src/challenges.config.js` (see [Challenge config](#challenge-config)).
6. Apply the migration locally: `npx wrangler d1 migrations apply uwcse-date-db --local`.

## Server module

The default export must have exactly this shape:

```js
export default {
  manifest,            // object
  validateConfig,      // (cfg) => frozen cfg; throws on invalid config
  describeSchedule,    // (cfg) => Localized string
  handleRequest,       // async (request, ctx, parts) => Response
  browsableUserIds,    // async (ctx) => string[]
  dataLifecycle,       // { data_version, purgeUser(ctx), prune(ctx)?, onDisable }
};
```

At startup the platform calls `validateConfig` for every config entry and rejects modules whose `api_version` doesn't match. A failure stops the Worker from starting.

### `manifest`

```js
const manifest = {
  module_id: "checkin",                  // unique; matches `module_id` in challenge configs
  module_version: 1,                     // bump when behaviour changes
  api_version: 1,                        // platform contract version; must equal the platform's (currently 1)
  name: L("每日签到", "Daily Check-in"),  // Localized; shown on the home page and challenge header
  description: L("…", "…"),              // Localized; shown on the home page card
  frontend: "/modules/checkin/app.js",   // URL of the browser module (served from public/)
  table_prefix: "ci_",                   // every table this module touches must start with this
  env: [],                               // names of Worker env vars/secrets the module may read
};
```

### `validateConfig(cfg) → cfg`

- Receives one entry from `CHALLENGES` (see [Challenge config](#challenge-config)).
- Throw an `Error` with a clear message if anything is missing or invalid. Use the message format `` `challenge ${cfg.challenge_id}: …` ``.
- Return the config, ideally `Object.freeze(cfg)`. The returned object becomes `ctx.config`.
- Enforce any rules the challenge must never be configured out of here. For example, LeetCode requires `require_account_ownership: true`.

### `describeSchedule(cfg) → Localized`

Return the refresh rule shown on the home page and under the challenge title, e.g.

```js
return L(`每天 0 点（${tz}）刷新`, `Refreshes daily at midnight (${tz})`);
```

### `handleRequest(request, ctx, parts) → Promise<Response>`

The platform routes every request under `/api/challenges/{challenge_id}/…` here, after it has:

- checked CSRF (non-GET requests need the header `x-uwcse-csrf: 1` and a same-origin `Origin`),
- authenticated the user through Cloudflare Access,
- confirmed the user is registered,
- confirmed the challenge exists and is `enabled`.

Arguments:

| Argument | Value |
|---|---|
| `request` | The original `Request`. Read JSON bodies with `readJson(request)`; it returns `{}` for a missing or non-JSON body and throws 400 on malformed JSON. |
| `ctx` | The module context (see [The context object](#the-context-object)). |
| `parts` | Path segments after the challenge id. `GET /api/challenges/daily-checkin/periods/2026-10-31/members` gives `["periods", "2026-10-31", "members"]`. |

Routes are entirely up to the module. Throw `HttpError(404, "not_found", L("接口不存在", "Not found"))` for anything unmatched.

**Response format.** Return JSON through a helper that resolves localized messages for the requester:

```js
function reply(ctx, data, status) {
  return json(localize(data, ctx.lang), status);
}
```

Successful responses are objects with `ok: true` plus whatever the module needs. For errors, throw an `HttpError` and the platform turns it into:

```json
{ "ok": false, "code": "not_member", "message": "<localized text>", "...extra": "..." }
```

with the HTTP status you gave. Error codes are `snake_case` and stable; the browser should branch on `code`, never on `message`. Codes used so far: `invalid_request`, `not_found`, `not_member`, `list_closed`, `profile_incomplete`, `cooldown` (with `retry_after`), `account_taken`, `token_expired`, `not_completed`.

Recommended routes, which both existing modules follow so the platform and users see consistent behaviour:

| Route | Purpose |
|---|---|
| `GET periods/current` | Current period, the task, and the user's own status |
| `GET periods/{pid}/members?page=N` | Filtered member cards for one period (see [Member lists](#member-lists)) |
| `DELETE …` / `POST …` | Leave and rejoin the current period's list |
| `GET history` | The user's own past completions |
| `DELETE data` (or `DELETE enrollment?purge=1`) | Delete all of the user's data in this challenge |

### `browsableUserIds(ctx) → Promise<string[]>`

Returns the **user ids** that `ctx.userId` may browse *right now* through any of this challenge's lists.

- Use exactly the same rules as your members endpoint: the list is still open, the viewer is an active member of that period, and the viewer's profile is complete.
- Include the members of every list the viewer can open, e.g. the current period plus a look-back period if you support one.
- Don't filter by relations. The platform does that.
- Don't include `ctx.userId`. Duplicates are fine.

The platform calls this for every enabled challenge when it serves `GET /api/people`. It merges and de-duplicates the ids, builds filtered cards through the profile service, groups them by relation on the home page, and never sends user ids or the source challenge to the browser. This function runs on the server only.

### `dataLifecycle`

```js
const dataLifecycle = {
  data_version: 1,
  async purgeUser(ctx) { /* delete every row for ctx.userId in this module's tables */ },
  async prune(ctx) { /* optional: delete rows no request needs any more */ },
  onDisable: "retain",   // what happens to data when the challenge is disabled
};
```

`purgeUser` is called for every challenge when a user deletes their account, before the platform deletes the profile and identity. It must remove **all** of the user's rows in this module, for example with `ctx.db.batch([...])`.

`prune` is optional. The platform's daily clean-up (a Cron Trigger) calls it for every challenge, enabled or not, with `ctx.userId` set to `null`, `ctx.profiles` set to `null` and `ctx.now` set to the run time. It should delete what no request reads any more, such as expired tokens and the details of closed periods, and end with `ctx.lists.forgetBefore(oldestOpenPeriodId)`. It must keep what users see as their history. A failing `prune` is logged and fails the run without stopping the other challenges.

## The context object

`ctx` is the only thing a module gets from the platform:

```js
{
  challengeId: "daily-checkin",   // this challenge's id
  config,                          // the object returned by validateConfig
  userId: "uuid",                  // the signed-in, registered user; never send it to the browser
  now: 1793506653505,              // request time, UTC epoch ms; use instead of Date.now()
  lang: "zh" | "en",               // the requester's language
  db,                              // scoped database, see below
  profiles,                        // profile service, see below
  lists,                           // cache for this challenge's member lists, see below
  vault,                           // encryption for personal values, see below
  env: { /* only the keys listed in manifest.env */ },
}
```

### `ctx.db` (scoped D1)

```js
ctx.db.prepare(sql, ...params)   // → D1PreparedStatement, already bound
ctx.db.batch([stmt, ...])        // → atomic batch (D1 transaction)
```

- `?1` is always bound to `ctx.challengeId`. Your own parameters start at `?2`, in the order you pass them.
- Every statement must mention `challenge_id` and use `?1`. Otherwise `prepare` throws.
- Every table after `FROM`, `INTO`, `UPDATE` or `JOIN` must start with `manifest.table_prefix`. Otherwise `prepare` throws. (`ON CONFLICT … DO UPDATE SET` is fine.)
- The result is a normal D1 statement: use `.first()`, `.all()` (rows in `.results`) or `.run()`.

```js
const row = await ctx.db
  .prepare("SELECT status FROM ci_checkins WHERE challenge_id = ?1 AND period_id = ?2 AND user_id = ?3", periodId, ctx.userId)
  .first();
```

This guard keeps trusted code inside its namespace by construction. It is not a security sandbox.

### `ctx.profiles` (profile service)

Modules never read or store personal information such as nickname, contacts or relations. They only get these two methods:

```js
await ctx.profiles.status(userId)
// → { complete: boolean, missing_fields: string[] }

await ctx.profiles.cards(viewerId, ownerIds)
// → Map<ownerId, Card | null>   (null = the two share no relation; never show that person)
```

`Card` has already been filtered by shared relations, both people's per-relation filters (two-way, on gender and program), and the owner's per-relation visibility of contact fields. A card is `null` when no relation matches both ways:

```js
{
  nickname: "A",                                // basic info: nickname, email, gender, program are always present
  email: "a@cs.washington.edu",
  gender: "FEMALE",                             // MALE | FEMALE | NON_BINARY | PREFER_NOT_TO_SAY
  program: "PHD",                               // BS_CS | BS_CE | BS_MS | PMP | PHD | STAFF
  research: "PL, systems" | null,               // "about me": always shown when set
  bio: "…" | null,
  avatar_url: "/avatars/male.png",             // a preset, or /api/avatars/<id> for an upload; use as-is
  common_relations: ["FRIENDSHIP"],            // relations sought by both and passing both filters
  relation_notes: { FRIENDSHIP: "…" },          // only for common relations
  fields: {                                     // contact fields open to a common relation; any may be absent
    wechat, discord
  }
}
```

Cards always reflect the profile as it is now, so edits and tightened permissions apply on the next request. The platform builds them from an in-memory copy of all profiles that is reloaded whenever a profile, account or ban changes (`src/platform/cache.js`); modules must not keep cards themselves. Banned accounts never get a card, so a module needs no ban handling of its own: banned members drop out of lists and counts automatically, and a banned user's own requests are rejected before reaching the module.

### `ctx.lists` (member list cache)

D1 bills every row a query scans, and member lists are read on every page view, so a module reads its list through a per-period cache instead of querying it each time:

```js
ctx.lists.cached(periodId, async () => rows)   // → the value load() returned, reused while the list is unchanged
ctx.lists.changed(periodId)                    // → D1 statement; put it in the batch of every write to that list
ctx.lists.forgetBefore(periodId)               // → D1 statement for prune(): drops the version rows of earlier lists
```

- The cached value is shared by every request in the isolate. Treat it as read-only, and cache the whole list (including the viewer); filter per request.
- **Every write that can change who is on a list** (joining, leaving, completing, withdrawing, purging) must include `ctx.lists.changed(periodId)` in the same `ctx.db.batch([...])`, for every period the write can affect. A write that forgets it shows up only when the cached copy expires (1 hour).
- A cache miss costs one full read of the list, so keep the list query to the columns you need.
- Period ids must sort by time (the `YYYY-MM-DD` ids from `platform/period.js` do), since `forgetBefore` compares them as strings.

### `ctx.vault` (encryption at rest)

The database must hold nothing that identifies a person in the clear (docs/oversight.md rule 5). Rows refer to people by `ctx.userId`, which is random; anything else that identifies or describes someone, such as an account name on another site, a token they post publicly or evidence that names them, is stored sealed:

```js
await ctx.vault.seal(context, value)   // → "v1:…" text; value is any JSON value
await ctx.vault.open(context, text)    // → the value; throws if text was not sealed for this context
await ctx.vault.lookup(purpose, text)  // → 64 hex characters, the same for the same text
```

- The context binds the value to its row: use one that names the owner, such as `` `username:${ctx.userId}` ``. A value copied into another user's row then no longer opens. The same context may be used for copies of a value within one user's rows.
- Use `lookup` when the database must find or compare a value (uniqueness of an account name, say): store the hash, never the value.
- Contexts and purposes are prefixed with the challenge id, so a challenge cannot open another's values or match its hashes.
- Each call costs a little CPU (tens of microseconds). Seal and open only the rows a request needs.

## Platform helpers

Import these from `src/platform/`; modules must not import from each other.

| Import | Signature | Notes |
|---|---|---|
| `http.js` → `L` | `L(zh, en) → { zh, en }` | A localized value. Use for every user-facing string. |
| `http.js` → `localize` | `localize(value, lang)` | Deep-resolves every `L(...)` inside objects and arrays. |
| `http.js` → `json` | `json(data, status = 200)` | JSON response with `cache-control: private, no-store`. |
| `http.js` → `HttpError` | `new HttpError(status, code, message, extra = {})` | `message` may be an `L(...)`; `extra` is merged into the error body. |
| `http.js` → `readJson` | `await readJson(request) → object` | |
| `period.js` → `periodAt` | `periodAt(ts, tz) → { period_id, starts_at, ends_at }` | Calendar-day period containing `ts`; `period_id` is `YYYY-MM-DD` local date. |
| `period.js` → `periodBounds` | `periodBounds(periodId, tz) → { period_id, starts_at, ends_at }` | `[local midnight, next local midnight)`, UTC ms; DST days are 23 or 25 h. |
| `period.js` → `addDays` | `addDays("2026-10-31", -1) → "2026-10-30"` | |
| `period.js` → `isPeriodId` | `isPeriodId(s) → boolean` | Validate period ids taken from URLs. |

A module with a non-daily schedule (e.g. weekly) can define its own period ids and boundaries. Keep ids stable strings and store UTC ms timestamps.

## Rules every challenge must follow

- **Same task for everyone in a period.** The task is derived only from the challenge config and the period. Nothing about the requesting user may change it, and nobody can re-roll it. If it is generated, persist it once per period using a primary key and `INSERT OR IGNORE`, then re-read it (see `ensurePeriod` in the LeetCode module).
- **Server-side completion.** Decide completion on the server. Never accept screenshots or client claims as proof.
- **Explicit consent to be listed.** Store each person's "Join this period's list automatically" choice (`always`, `ask`, `never`; validate with `joinModeFrom` from `platform/join-mode.js`) and list them on completion only as it says. With `ask`, take the answer with the completing action or offer joining right after it; with `never`, keep joining by hand possible. Show the choice with `joinModeField` from `public/join-mode.js`, so it reads the same in every challenge.
- **Browsing requires membership.** Only active members of a period may browse that period's list, and the list closes when its period ends. An optional look-back must be limited to members of that period.
- **Cards only from `ctx.profiles.cards`.** Drop `null` results, never return `user_id` to the browser, and use a per-challenge opaque `member_id` instead.
- **Lists through `ctx.lists`.** Read member lists with `ctx.lists.cached`, and bump them with `ctx.lists.changed` in the same batch as every write to list rows.
- **Nothing identifying in the clear.** Store anything that identifies or describes a person through `ctx.vault`, and never put such values in logs.
- **Deletion.** Leaving a list must be possible at any time. Deleting the module's data or the account must remove every row.
- **No cross-challenge reads.** A challenge must never read or react to another challenge's data.

## Member lists

The members endpoint of both modules follows this pattern:

```js
async function getMembers(ctx, periodId, url) {
  // 1. Is this period's list open? Otherwise 403 list_closed.
  // 2. Is the viewer an active member of this period with a complete profile? Otherwise 403 not_member.
  // 3. Load the other active members in join order (through ctx.lists.cached), then filter
  //    through the profile service:
  const cards = await ctx.profiles.cards(ctx.userId, rows.map((r) => r.user_id));
  const visible = rows.flatMap((r) => (cards.get(r.user_id) ? [{ member_id: r.member_id, ...cards.get(r.user_id) }] : []));
  // 4. Paginate.
  return reply(ctx, { ok: true, period_id, total: visible.length, page, page_size, members: visible.slice(…) });
}
```

`total`, pagination and every count are computed on the filtered list, so people a viewer cannot see never leak through numbers.

## Database

- Migrations live under `migrations/` and are applied in filename order. Keep each file to one module's tables.
- Migrations are append-only: never edit or rename a file once it has been applied to any shared database. Wrangler tracks migrations by filename only, so an edited file is silently treated as already applied. Every change is a new `NNNN_<module>_<change>.sql` file.
- Index every column combination a query filters on without the leading primary-key columns (for example `(challenge_id, user_id)` for per-user history). D1 bills rows scanned, so a missing index turns a per-user query into a scan of the whole table.
- Every table name starts with `table_prefix`, and every table has a `challenge_id TEXT NOT NULL` column that leads its primary key or unique keys. The same module can back several challenges.
- Store timestamps as UTC epoch milliseconds (`INTEGER`).
- Use a random `member_id` (e.g. `crypto.randomUUID()`) wherever another user sees a person.

Example (`migrations/0003_checkin.sql`):

```sql
CREATE TABLE ci_checkins (
  challenge_id TEXT NOT NULL,
  period_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'left')),
  checked_in_at INTEGER NOT NULL,
  left_at INTEGER,
  PRIMARY KEY (challenge_id, period_id, user_id)
);
```

## Challenge config

Each entry in `CHALLENGES` (`src/challenges.config.js`) is one challenge:

```js
{
  challenge_id: "daily-checkin",   // URL-safe, unique; appears in /api/challenges/{id} and #/c/{id}
  module_id: "checkin",            // which module backs it
  config_version: 1,               // bump when changing parameters that affect future periods
  enabled: true,                   // false hides it and rejects its API; data is kept
  // …anything else the module's validateConfig expects, e.g.
  schedule: { kind: "calendar_day", timezone: "America/Los_Angeles" },
  members: { page_size: 20 },
}
```

## Browser module

`public/modules/<module_id>/app.js` is an ES module loaded with `import(manifest.frontend)` when the user opens `#/c/{challenge_id}`:

```js
export async function mount(root, { challengeId, challenge }) {
  // root: an empty <div> you own; render everything into it
  // challengeId: "daily-checkin"
  // challenge: { challenge_id, module_id, name, description, refresh_rule, frontend }  (already localized)
}
```

- The platform calls `mount` again on every hash change, so read the current tab from `location.hash`. Both modules use `#/c/{challengeId}/{tab}` and `location.hash.split("/")[3]`.
- Call your API under `` `/api/challenges/${encodeURIComponent(challengeId)}` ``.

Shared browser helpers (absolute imports):

| Import | Use |
|---|---|
| `/lib.js` → `h(tag, attrs, ...children)` | Build DOM. Children are inserted as text, so user content is never parsed as HTML. Handlers via `onclick` etc. |
| `/lib.js` → `api(path, { method, body })` | Fetch JSON with the CSRF and language headers. Throws `ApiError` (`.status`, `.body.code`, `.message`) on non-2xx. |
| `/lib.js` → `fmtTime(ts, tz)`, `toast(msg, kind)` | Format a timestamp in the user's language; show a transient message (`"ok" \| "warn" \| "error"`). |
| `/i18n.js` → `makeT({ zh: {...}, en: {...} })` | Returns `t(key, vars)`; values may contain `{name}` placeholders. Each module keeps its own strings. |
| `/i18n.js` → `lang`, `RELATIONS`, `FIELDS` | Current language; localized relation and profile field labels. |
| `/card.js` → `personCard(card)`, `openCard(card)` | Render a member card (same look everywhere), or open it in a dialog. |

Reuse the existing CSS classes (`panel`, `tabs`, `cards`, `pager`, `history`, `rules`, `muted`, `small`, `primary`, `danger`) so every challenge looks like part of the site.

## Testing

- Unit tests live in `test/` and run with `npm test` (`node --test`). Pure functions such as task selection, period maths and evidence matching should be tested there. The scoped-DB guard has its own test.
- With `.dev.vars` containing `DEV_MODE=1`, `npx wrangler dev` accepts an `x-dev-user: someone@cs.washington.edu` header (or the dev bar in the page) to act as different users. That's how the end-to-end checks for both modules were run.
