// End-to-end tests of the Worker against an in-memory SQLite database with every migration
// applied (a small D1 stand-in built on node:sqlite), fake R2/assets bindings and DEV_MODE
// identities. They cover the paths that read through the versioned caches, so each test starts
// with resetCaches(): every test gets a fresh database whose version tokens start at 0 again.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import worker from "../src/index.js";
import { resetCaches, cachedValue, MAX_AGE_MS } from "../src/platform/cache.js";
import { profileService, getProfile, missingRequired, buildCard } from "../src/platform/profile.js";
import { vault, emailHash } from "../src/platform/vault.js";
import { findUser } from "../src/platform/auth.js";
import { assertMayRegister } from "../src/platform/deletions.js";
import { apiLimiter } from "../src/platform/rate-limit.js";
import { periodAt } from "../src/platform/period.js";
import { SITE } from "../src/site.config.js";
import { CHALLENGES } from "../src/challenges.config.js";
import leetcode from "../src/modules/leetcode/index.js";

const TZ = "America/Los_Angeles";
const today = () => periodAt(Date.now(), TZ).period_id;
const cfg = SITE.profile;

// ---------- a D1 stand-in on node:sqlite ----------

function createD1() {
  const sqlite = new DatabaseSync(":memory:");
  const dir = new URL("../migrations/", import.meta.url);
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(f, dir), "utf8"));
  sqlite.exec("PRAGMA foreign_keys = ON");
  const exec = (sql, params) => {
    const results = sqlite.prepare(sql).all(...params).map((r) => ({ ...r }));
    const { c } = sqlite.prepare("SELECT changes() AS c").get();
    return { results, meta: { changes: c }, success: true };
  };
  const statement = (sql, params = []) => ({
    bind: (...p) => statement(sql, p),
    first: async (col) => {
      const row = exec(sql, params).results[0];
      return row === undefined ? null : col ? row[col] : row;
    },
    all: async () => exec(sql, params),
    run: async () => exec(sql, params),
    _exec: () => exec(sql, params),
  });
  return {
    sqlite,
    prepare: (sql) => statement(sql),
    async batch(stmts) {
      sqlite.exec("BEGIN");
      try {
        const out = stmts.map((s) => s._exec());
        sqlite.exec("COMMIT");
        return out;
      } catch (err) {
        sqlite.exec("ROLLBACK");
        throw err;
      }
    },
  };
}

function createEnv(extra = {}) {
  const objects = new Map();
  return {
    DB: createD1(),
    BUCKET: {
      objects, // tests read and age objects directly
      async put(key, bytes, opts) {
        objects.set(key, { bytes: new Uint8Array(bytes), customMetadata: opts?.customMetadata, uploaded: new Date() });
      },
      async get(key) {
        const o = objects.get(key);
        return o ? { arrayBuffer: async () => o.bytes.slice().buffer, customMetadata: o.customMetadata } : null;
      },
      async delete(keys) {
        for (const k of [].concat(keys)) objects.delete(k);
      },
      async list({ prefix = "" } = {}) {
        const matching = [...objects].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, uploaded: o.uploaded }));
        return { objects: matching, truncated: false };
      },
    },
    ASSETS: { fetch: async () => new Response("asset", { status: 404 }) },
    DEV_MODE: "1",
    LEETCODE_PROVIDER: "mock",
    ALLOWED_EMAIL_DOMAINS: "cs.washington.edu",
    ...extra,
  };
}

async function call(env, user, method, path, body) {
  const headers = { "x-uwcse-csrf": "1", "x-uwcse-lang": "en" };
  if (user) headers["x-dev-user"] = `${user}@cs.washington.edu`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await worker.fetch(new Request(`http://localhost${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {}
  return { status: res.status, data, headers: res.headers };
}

function profile({ gender = "FEMALE", program = "PHD", relations = ["FRIENDSHIP"], ...rest } = {}) {
  return { nickname: "n", gender, program, avatar: "female", relations, ...rest };
}

async function register(env, user, p = {}) {
  const r = await call(env, user, "POST", "/api/register", { accept_terms: true, profile: profile(p) });
  assert.equal(r.status, 200, JSON.stringify(r.data));
}

const email = (user) => `${user}@cs.washington.edu`;

// Bans the way scripts/ban.mjs does: queue a request, then let the scheduled run apply it.
async function ban(env, user, reason = null) {
  env.DB.sqlite.prepare("INSERT INTO ban_requests (email, action, reason, requested_at) VALUES (?, 'add', ?, ?)").run(email(user), reason, Date.now());
  await worker.scheduled({ cron: "*/5 * * * *" }, env);
}

// Changes a stored profile the way only code holding DATA_KEY can: open, edit, seal again.
async function editProfile(env, user, edit) {
  const id = await findUser(env, email(user));
  const p = await getProfile(env, id);
  edit(p);
  env.DB.sqlite.prepare("UPDATE profiles SET data = ? WHERE user_id = ?").run(await vault(env).seal(`profile:${id}`, p), id);
  env.DB.sqlite.exec("UPDATE cache_versions SET version = version + 1 WHERE name = 'profiles'");
}

const checkin = (env, user) => call(env, user, "POST", `/api/challenges/daily-checkin/periods/${today()}/checkin`, {});
const ciMembers = async (env, user, page = 1) => (await call(env, user, "GET", `/api/challenges/daily-checkin/periods/${today()}/members?page=${page}`)).data;
const emails = (members) => members.map((m) => m.email.split("@")[0]).sort();

beforeEach(() => resetCaches());

// ---------- tests ----------

test("check-in list and home page reflect every write on the next request", async () => {
  const env = createEnv();
  await register(env, "a", { gender: "FEMALE", relations: ["FRIENDSHIP", "ROMANCE"] });
  await register(env, "b", { gender: "MALE", relations: ["FRIENDSHIP", "ROMANCE"] });
  await register(env, "c", { gender: "FEMALE", relations: ["STUDY"] });

  assert.equal((await checkin(env, "a")).status, 200);
  assert.equal((await ciMembers(env, "a")).total, 0); // caches the list with only a on it

  await checkin(env, "b");
  let list = await ciMembers(env, "a");
  assert.deepEqual(emails(list.members), ["b"]);
  assert.deepEqual(list.members[0].common_relations, ["FRIENDSHIP", "ROMANCE"]);

  // A profile edit (contact visibility is not locked) shows on the next read of the cached cards.
  const put = await call(env, "b", "PUT", "/api/profile", {
    ...profile({ gender: "MALE", relations: ["FRIENDSHIP", "ROMANCE"] }),
    wechat: "b-wx",
    visibility: { wechat: ["FRIENDSHIP"], discord: ["ROMANCE"] },
  });
  assert.equal(put.status, 200, JSON.stringify(put.data));
  assert.equal((await ciMembers(env, "a")).members[0].fields.wechat, "b-wx");

  // c shares no relation with a: counted as checked in, never shown.
  await checkin(env, "c");
  assert.deepEqual(emails((await ciMembers(env, "a")).members), ["b"]);
  const cur = (await call(env, "a", "GET", "/api/challenges/daily-checkin/periods/current")).data;
  assert.equal(cur.checked_in_count, 3);

  const home = (await call(env, "a", "GET", "/api/people")).data;
  assert.deepEqual(
    home.sections.map((s) => [s.relation, s.total]),
    [["FRIENDSHIP", 1], ["ROMANCE", 1]],
  );

  // Leaving and rejoining the list.
  assert.equal((await call(env, "b", "DELETE", `/api/challenges/daily-checkin/periods/${today()}/membership`)).status, 200);
  assert.equal((await ciMembers(env, "a")).total, 0);
  assert.equal((await call(env, "b", "POST", `/api/challenges/daily-checkin/periods/${today()}/membership`, {})).status, 200);
  assert.equal((await ciMembers(env, "a")).total, 1);

  // A ban hides b as soon as the scheduled run has applied it.
  await ban(env, "b", "test");
  assert.equal((await ciMembers(env, "a")).total, 0);
  assert.equal((await call(env, "a", "GET", "/api/people")).data.sections[0].total, 0);
});

test("LeetCode list follows verification, leaving and withdrawal", async () => {
  const env = createEnv();
  const base = "/api/challenges/leetcode-daily";
  for (const u of ["a", "b"]) {
    await register(env, u);
    assert.equal((await call(env, u, "POST", `${base}/enrollment`, { accept_rules: true, join_mode: "always" })).status, 200);
    assert.equal((await call(env, u, "POST", `${base}/binding/start`, { username: `${u}_ac` })).status, 200);
    assert.equal((await call(env, u, "POST", `${base}/binding/verify`, {})).data.result, "verified");
  }
  const members = async (u) => (await call(env, u, "GET", `${base}/periods/${today()}/members`)).data;
  assert.equal((await call(env, "a", "POST", `${base}/periods/${today()}/verify`, {})).data.result, "verified");
  assert.equal((await members("a")).total, 0);
  assert.equal((await call(env, "b", "POST", `${base}/periods/${today()}/verify`, {})).data.result, "verified");
  assert.deepEqual(emails((await members("a")).members), ["b"]);
  await call(env, "b", "DELETE", `${base}/periods/${today()}/membership`);
  assert.equal((await members("a")).total, 0);
  await call(env, "b", "POST", `${base}/periods/${today()}/membership`, { confirm: true });
  assert.equal((await members("a")).total, 1);
  await call(env, "b", "DELETE", `${base}/enrollment`);
  assert.equal((await members("a")).total, 0);
});

test("join this period's list automatically: always, ask or never, in both challenges", async () => {
  const env = createEnv();
  const ci = "/api/challenges/daily-checkin";
  const lc = "/api/challenges/leetcode-daily";
  for (const u of ["v", "a", "k", "n"]) await register(env, u);
  await checkin(env, "v");
  const listed = async () => emails((await ciMembers(env, "v")).members);

  // Check-in: "always" (the default) lists you; "never" does not, but joining by hand works.
  await checkin(env, "a");
  assert.equal((await call(env, "n", "PUT", `${ci}/settings`, { join_mode: "never" })).status, 200);
  await checkin(env, "n");
  assert.deepEqual(await listed(), ["a"]);
  assert.equal((await call(env, "n", "POST", `${ci}/periods/${today()}/membership`, {})).status, 200);
  assert.deepEqual(await listed(), ["a", "n"]);
  // "ask": a check-in without an answer is refused; the answer decides.
  await call(env, "k", "PUT", `${ci}/settings`, { join_mode: "ask" });
  assert.equal((await checkin(env, "k")).status, 400);
  assert.equal((await call(env, "k", "POST", `${ci}/periods/${today()}/checkin`, { join: false })).status, 200);
  assert.deepEqual(await listed(), ["a", "n"]);
  assert.equal((await call(env, "k", "PUT", `${ci}/settings`, { join_mode: "sometimes" })).status, 400);

  // LeetCode: only "always" joins on verification; "ask" says so in the answer.
  const lcMembers = async (u) => emails((await call(env, u, "GET", `${lc}/periods/${today()}/members`)).data.members);
  for (const [u, mode] of [["a", "always"], ["k", "ask"], ["n", "never"]]) {
    assert.equal((await call(env, u, "POST", `${lc}/enrollment`, { accept_rules: true, join_mode: mode })).status, 200);
    await call(env, u, "POST", `${lc}/binding/start`, { username: `${u}_ac` });
    await call(env, u, "POST", `${lc}/binding/verify`, {});
    const res = (await call(env, u, "POST", `${lc}/periods/${today()}/verify`, {})).data;
    assert.equal(res.result, "verified");
    assert.equal(res.ask_to_join, mode === "ask");
  }
  assert.equal((await call(env, "v", "POST", `${lc}/enrollment`, { accept_rules: true })).status, 400); // a choice is required
  assert.equal((await call(env, "k", "POST", `${lc}/periods/${today()}/membership`, { confirm: true })).status, 200);
  assert.deepEqual(await lcMembers("a"), ["k"]);
  assert.equal((await call(env, "a", "GET", `${lc}/enrollment`)).data.enrollment.join_mode, "always");
});

test("home page returns a first page per relation and the rest through offset", async () => {
  const env = createEnv();
  await register(env, "viewer", { relations: ["FRIENDSHIP", "STUDY"] });
  await checkin(env, "viewer");
  for (let i = 0; i < 30; i++) {
    await register(env, `p${i}`, { relations: i < 5 ? ["FRIENDSHIP", "STUDY"] : ["FRIENDSHIP"] });
    await checkin(env, `p${i}`);
  }
  const home = (await call(env, "viewer", "GET", "/api/people")).data;
  assert.equal(home.page_size, 24);
  const friends = home.sections.find((s) => s.relation === "FRIENDSHIP");
  assert.equal(friends.total, 30);
  assert.equal(friends.people.length, 24);
  assert.equal(home.sections.find((s) => s.relation === "STUDY").total, 5);
  const rest = (await call(env, "viewer", "GET", "/api/people?relation=FRIENDSHIP&offset=24")).data;
  assert.equal(rest.total, 30);
  const all = new Set([...friends.people, ...rest.people].map((m) => m.email));
  assert.equal(all.size, 30);
  assert.equal((await call(env, "viewer", "GET", "/api/people?relation=ROMANCE")).status, 400); // not sought
});

test("deleting an account blocks re-registration until its change locks expire", async () => {
  const env = createEnv();
  await register(env, "d");
  assert.equal((await call(env, "d", "DELETE", "/api/account")).status, 200);
  const row = env.DB.sqlite.prepare("SELECT email_mac, reregister_after FROM deleted_accounts").get();
  assert.match(row.email_mac, /^[0-9a-f]{64}$/); // a keyed hash, not the email
  assert.ok(row.reregister_after > Date.now() + 29 * 86400_000); // the 30-day basic-info lock

  const again = await call(env, "d", "POST", "/api/register", { accept_terms: true, profile: profile({ gender: "MALE" }) });
  assert.equal(again.status, 409);
  assert.equal(again.data.code, "recently_deleted");

  env.DB.sqlite.exec("UPDATE deleted_accounts SET reregister_after = 0");
  await register(env, "d", { gender: "MALE" });
  // A later deletion sweeps expired tombstones.
  await call(env, "d", "DELETE", "/api/account");
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM deleted_accounts WHERE reregister_after = 0").get().n, 0);
});

test("outside local development, nothing runs without a valid DATA_KEY", async () => {
  const env = createEnv({ DEV_MODE: undefined });
  await assert.rejects(assertMayRegister(env, "x@cs.washington.edu", Date.now()), (e) => e.code === "server_misconfigured");
  await assert.rejects(assertMayRegister({ ...env, DATA_KEY: btoa("too short") }, "x@cs.washington.edu", Date.now()), (e) => e.code === "server_misconfigured");
  await assertMayRegister({ ...env, DATA_KEY: btoa("k".repeat(32)) }, "x@cs.washington.edu", Date.now());
});

test("rate limits: 429 when a limiter says no, no effect without bindings", async () => {
  const deny = { limit: async () => ({ success: false }) };
  const allow = { limit: async () => ({ success: true }) };
  const env = createEnv({ RL_LIST: deny, RL_API: allow });
  await register(env, "a");
  const people = await call(env, "a", "GET", "/api/people");
  assert.equal(people.status, 429);
  assert.equal(people.data.code, "rate_limited");
  assert.equal((await call(env, "a", "GET", "/api/profile")).status, 200);
  // A limiter that throws lets requests through.
  const broken = createEnv({ RL_API: { limit: async () => { throw new Error("down"); } } });
  await register(broken, "a");
  assert.equal((await call(broken, "a", "GET", "/api/profile")).status, 200);

  const e = { RL_API: "api", RL_LIST: "list", RL_AVATAR: "avatar" };
  assert.equal(apiLimiter(e, "GET", ["api", "people"]), "list");
  assert.equal(apiLimiter(e, "GET", ["api", "challenges", "daily-checkin", "periods", "2026-11-01", "members"]), "list");
  assert.equal(apiLimiter(e, "GET", ["api", "avatars", "0123"]), "avatar");
  assert.equal(apiLimiter(e, "POST", ["api", "people"]), "api");
  assert.equal(apiLimiter(e, "GET", ["api", "profile"]), "api");
});

test("cached cards equal cards built row by row from the database", async () => {
  const env = createEnv();
  const genders = cfg.gender_options;
  const programs = cfg.program_options;
  const rels = cfg.relation_options;
  let seed = 7;
  const rnd = (n) => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % n);
  const pick = (arr) => arr.filter(() => rnd(2)).concat(arr.slice(0, 0));
  for (let i = 0; i < 60; i++) {
    const relations = pick(rels);
    const p = {
      gender: genders[rnd(genders.length)],
      program: programs[rnd(programs.length)],
      relations: relations.length ? relations : ["FRIENDSHIP"],
      wechat: rnd(2) ? `wx${i}` : "",
      discord: rnd(2) ? `dc${i}` : "",
      visibility: { wechat: pick(rels), discord: pick(rels) },
      relation_filters: {},
    };
    for (const r of p.relations) {
      if (rnd(3)) continue;
      const g = pick(genders);
      if (g.length) p.relation_filters[r] = { gender: g };
    }
    await register(env, `u${i}`, p);
  }
  await ban(env, "u3");
  await ban(env, "u17");
  await editProfile(env, "u5", (p) => (p.schema_version = 0));
  const ids = env.DB.sqlite.prepare("SELECT id FROM users ORDER BY id").all().map((r) => r.id);
  const banned = new Set([await findUser(env, email("u3")), await findUser(env, email("u17"))]);
  for (const viewerId of ids.slice(0, 15)) {
    const got = await profileService(env, cfg).cards(viewerId, ids);
    const viewer = await getProfile(env, viewerId);
    for (const id of ids) {
      const owner = await getProfile(env, id);
      const want = banned.has(id) ? undefined : missingRequired(owner, cfg).length ? null : buildCard(viewer, owner);
      assert.deepEqual(got.get(id), want, `viewer ${viewerId}, owner ${id}`);
    }
  }
});

test("banned or unregistered: the only things left to do are signing out and deleting data", async () => {
  const env = createEnv();
  const count = (table) => env.DB.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  await register(env, "bad");
  await ban(env, "bad");
  await ban(env, "gone");
  assert.equal((await call(env, "bad", "GET", "/api/me")).data.banned, true);
  assert.equal((await call(env, "bad", "GET", "/api/profile")).status, 403);
  assert.equal((await call(env, "bad", "DELETE", "/api/account")).status, 200);
  assert.equal(count("users"), 0);

  // Signed in but never registered: deleting removes the uploads, but not the attempts used.
  assert.equal((await upload(env, "new")).status, 200);
  env.DB.sqlite.prepare("INSERT INTO sessions (token_hash, email_hash, data, expires_at) VALUES ('t', ?, 'x', ?)").run(await emailHash(env, email("new")), Date.now() + 86400_000);
  assert.equal((await call(env, "new", "DELETE", "/api/account")).status, 200);
  assert.equal(count("avatars"), 0);
  assert.equal(count("sessions"), 0);
  assert.equal(attempts(env).length, 1);
  // Banned without ever registering.
  assert.equal((await call(env, "gone", "DELETE", "/api/account")).status, 200);
});

test("daily clean-up deletes only rows no request needs any more", async () => {
  const env = createEnv();
  const now = Date.now();
  const day = 86400_000;
  const old = "2026-01-01";
  const id = (r) => r.data.avatar.slice("upload:".length);
  const fresh = await upload(env, "fresh"); // never registered, uploaded just now: kept
  const stale = await upload(env, "stale"); // never registered, two days ago: deleted
  const used = await upload(env, "user"); // two days ago, but the profile uses it: kept
  await register(env, "user", { avatar: used.data.avatar });
  const period = (pid) => `('leetcode-daily', '${pid}', 0, 1, 'America/Los_Angeles', '{}', 'pool-v1', 1, 1, 0)`;
  env.DB.sqlite.exec(`
    UPDATE avatars SET created_at = ${now - 2 * day} WHERE id IN ('${id(stale)}', '${id(used)}');
    INSERT INTO sessions (token_hash, email_hash, data, expires_at) VALUES ('old', 'x', 'x', ${now - 1}), ('live', 'y', 'y', ${now + day});
    INSERT INTO deleted_accounts (email_mac, reregister_after) VALUES ('m-old', ${now - 1}), ('m-live', ${now + day});
    INSERT INTO avatar_upload_attempts (email_mac, attempted_at) VALUES ('a-old', ${now - 31 * day});
    INSERT INTO lc_binding_tokens (challenge_id, user_id, site, username, token, expires_at, created_at)
      VALUES ('leetcode-daily', 'u1', 'leetcode.com', 'a', 't1', ${now - 1}, 0), ('leetcode-daily', 'u2', 'leetcode.com', 'b', 't2', ${now + day}, 0);
    INSERT INTO lc_attempts (challenge_id, period_id, user_id, binding_version, requested_at, source, source_version)
      VALUES ('leetcode-daily', '${old}', 'u1', 1, ${now - 8 * day}, 'mock', '1'), ('leetcode-daily', '${today()}', 'u1', 1, ${now}, 'mock', '1');
    INSERT INTO lc_periods (challenge_id, period_id, starts_at, ends_at, timezone, problem, pool_version, config_version, module_version, created_at)
      VALUES ${period(old)}, ${period(today())};
    INSERT INTO lc_period_locks (challenge_id, period_id, user_id, site, username, binding_version, locked_at)
      VALUES ('leetcode-daily', '${old}', 'u1', 'leetcode.com', 'a', 1, 0), ('leetcode-daily', '${today()}', 'u1', 'leetcode.com', 'a', 1, 0);
    INSERT INTO cache_versions (name, version) VALUES
      ('list:leetcode-daily:${old}', 1), ('list:leetcode-daily:${today()}', 1), ('list:daily-checkin:${old}', 1), ('list:daily-checkin:${today()}', 1);`);

  // Images in R2 without a row: an old one goes, a recent one (an upload in progress) stays.
  env.BUCKET.objects.set("avatars/orphan-old", { bytes: new Uint8Array(1), uploaded: new Date(now - 2 * day) });
  env.BUCKET.objects.set("avatars/orphan-new", { bytes: new Uint8Array(1), uploaded: new Date(now) });

  await worker.scheduled({ cron: "17 11 * * *" }, env);
  const col = (sql) => env.DB.sqlite.prepare(sql).all().map((r) => Object.values(r)[0]);
  assert.deepEqual(col("SELECT id FROM avatars ORDER BY id"), [id(fresh), id(used)].sort());
  assert.deepEqual([...env.BUCKET.objects.keys()].sort(), [`avatars/${id(fresh)}`, `avatars/${id(used)}`, "avatars/orphan-new"].sort());
  assert.equal((await env.BUCKET.get(`avatars/${id(stale)}`)), null);
  assert.ok(await env.BUCKET.get(`avatars/${id(used)}`));
  assert.deepEqual(col("SELECT token_hash FROM sessions"), ["live"]);
  assert.deepEqual(col("SELECT email_mac FROM deleted_accounts"), ["m-live"]);
  assert.equal(col("SELECT email_mac FROM avatar_upload_attempts WHERE email_mac = 'a-old'").length, 0);
  assert.deepEqual(col("SELECT user_id FROM lc_binding_tokens"), ["u2"]);
  assert.deepEqual(col("SELECT period_id FROM lc_attempts"), [today()]);
  assert.deepEqual(col("SELECT period_id FROM lc_period_locks"), [today()]);
  assert.deepEqual(col("SELECT period_id FROM lc_periods ORDER BY period_id"), [old, today()]); // history stays
  assert.deepEqual(col("SELECT name FROM cache_versions WHERE name LIKE 'list:%' ORDER BY name"), [
    `list:daily-checkin:${today()}`,
    `list:leetcode-daily:${today()}`,
  ]);
});

test("LeetCode checks answer without contacting LeetCode while verification is paused", async () => {
  const base = CHALLENGES.find((c) => c.challenge_id === "leetcode-daily");
  const config = leetcode.validateConfig({ ...base, verification: { ...base.verification, paused: true } });
  const ctx = { config, challengeId: config.challenge_id, lang: "en" }; // no db: nothing may be queried
  for (const parts of [["binding", "verify"], ["periods", today(), "verify"]]) {
    const req = new Request("http://localhost/", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const data = await (await leetcode.handleRequest(req, ctx, parts)).json();
    assert.equal(data.paused, true);
    assert.equal(data.result, "provider_unavailable");
  }
});

// ---------- encryption at rest (src/platform/vault.js) ----------

test("the database and R2 hold no personal data in the clear", async () => {
  const env = createEnv();
  const base = "/api/challenges/leetcode-daily";
  const up = await upload(env, "zz-secret-person");
  await register(env, "zz-secret-person", {
    nickname: "Nick-SECRET",
    gender: "NON_BINARY",
    relations: ["FRIENDSHIP", "ROMANCE"],
    relation_filters: { ROMANCE: { gender: ["NON_BINARY"] } },
    relation_notes: { ROMANCE: "note-SECRET" },
    wechat: "wx-SECRET",
    discord: "dc-SECRET",
    bio: "bio-SECRET",
    research: "res-SECRET",
    avatar: up.data.avatar,
  });
  await checkin(env, "zz-secret-person");
  await call(env, "zz-secret-person", "POST", `${base}/enrollment`, { accept_rules: true, join_mode: "always" });
  await call(env, "zz-secret-person", "POST", `${base}/binding/start`, { username: "lcsecret_ac" });
  assert.equal((await call(env, "zz-secret-person", "POST", `${base}/binding/verify`, {})).data.result, "verified");
  assert.equal((await call(env, "zz-secret-person", "POST", `${base}/periods/${today()}/verify`, {})).data.result, "verified");
  await call(env, "zz-secret-person", "POST", `${base}/binding/start`, { username: "lcpending_ac" }); // a pending token too
  await register(env, "banned-person");
  await ban(env, "banned-person", "reason-SECRET");
  await call(env, "zz-secret-person", "GET", "/api/people"); // fills the caches

  const tables = env.DB.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
  const dump = tables.map((t) => JSON.stringify(env.DB.sqlite.prepare(`SELECT * FROM ${t}`).all())).join("\n");
  for (const s of ["zz-secret-person", "banned-person", "@cs.washington.edu", "Nick-SECRET", "NON_BINARY", "ROMANCE", "note-SECRET", "wx-SECRET", "dc-SECRET", "bio-SECRET", "res-SECRET", "lcsecret", "lcpending", "reason-SECRET", "uwcse-"]) {
    assert.ok(!dump.includes(s), `the database contains ${s}`);
  }
  for (const [, o] of env.BUCKET.objects) assert.ok(!new TextDecoder("latin1").decode(o.bytes).includes("IHDR"), "an image is stored unsealed");
  // Everything still works through the API.
  const me = (await call(env, "zz-secret-person", "GET", "/api/profile")).data.profile;
  assert.equal(me.wechat, "wx-SECRET");
  assert.equal((await call(env, "zz-secret-person", "GET", `/api/avatars/${up.data.avatar.slice(7)}`)).status, 200);
  assert.equal((await call(env, "zz-secret-person", "GET", `${base}/enrollment`)).data.binding.username, "lcsecret_ac");
});

test("a session row written without DATA_KEY signs no one in", async () => {
  const env = createEnv({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" });
  const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const tokenHash = async (t) => b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t))));
  const me = async (token) => {
    const res = await worker.fetch(new Request("http://localhost/api/me", { headers: { cookie: `uwcse_session=${token}` } }), env);
    return res.json();
  };
  const insert = async (token, data, expires) =>
    env.DB.sqlite.prepare("INSERT INTO sessions (token_hash, email_hash, data, expires_at) VALUES (?, ?, ?, ?)").run(await tokenHash(token), await emailHash(env, email("v")), data, expires);
  const expires = Date.now() + 86400_000;

  // What the Worker writes at sign-in works.
  const real = await vault(env).seal(`session:${await tokenHash("real")}`, { email: email("v"), expires_at: expires });
  await insert("real", real, expires);
  assert.equal((await me("real")).email, email("v"));
  // A made-up row, a real row's data copied under another token, and an extended expiry do not.
  await insert("forged", "v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", expires);
  assert.equal((await me("forged")).signed_in, false);
  await insert("copied", real, expires);
  assert.equal((await me("copied")).signed_in, false);
  env.DB.sqlite.prepare("UPDATE sessions SET expires_at = ? WHERE token_hash = ?").run(expires + 86400_000, await tokenHash("real"));
  assert.equal((await me("real")).signed_in, false);
});

test("a profile row swapped between users stops opening and drops out of lists", async () => {
  const env = createEnv();
  for (const u of ["a", "b", "c"]) {
    await register(env, u);
    await checkin(env, u);
  }
  assert.equal((await ciMembers(env, "c")).total, 2);
  const [a, b] = [await findUser(env, email("a")), await findUser(env, email("b"))];
  const errors = console.error;
  console.error = () => {};
  try {
    env.DB.sqlite.prepare("UPDATE profiles SET data = (SELECT data FROM profiles WHERE user_id = ?) WHERE user_id = ?").run(b, a);
    env.DB.sqlite.exec("UPDATE cache_versions SET version = version + 1 WHERE name = 'profiles'");
    assert.deepEqual(emails((await ciMembers(env, "c")).members), ["b"]);
  } finally {
    console.error = errors;
  }
});

test("versioned cache: reuse, reload on a new version, expiry and failed loads", async () => {
  let loads = 0;
  const load = async () => ++loads;
  assert.equal(await cachedValue("k", 1, load, 0), 1);
  assert.equal(await cachedValue("k", 1, load, 10), 1); // same version: no reload
  assert.equal(await cachedValue("k", 2, load, 20), 2); // version moved
  assert.equal(await cachedValue("k", 2, load, 20 + MAX_AGE_MS), 3); // expired
  await assert.rejects(cachedValue("bad", 1, async () => { throw new Error("x"); }, 0));
  assert.equal(await cachedValue("bad", 1, async () => "ok", 0), "ok"); // a failed load is not kept
  // Concurrent readers share one load.
  let n = 0;
  const slow = () => new Promise((r) => setTimeout(() => r(++n), 5));
  const [x, y] = await Promise.all([cachedValue("s", 1, slow, 0), cachedValue("s", 1, slow, 0)]);
  assert.equal(x, 1);
  assert.equal(y, 1);
});

// ---------- avatar uploads ----------

// The server only reads the PNG signature and IHDR header, so this is enough to pass validation.
function png256() {
  const b = new Uint8Array(64);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 1, 0, 0, 0, 1, 0]);
  return b;
}

async function upload(env, user, bytes = png256()) {
  const res = await worker.fetch(
    new Request("http://localhost/api/avatars", {
      method: "POST",
      headers: { "x-uwcse-csrf": "1", "x-dev-user": `${user}@cs.washington.edu`, "content-type": "image/png" },
      body: bytes,
    }),
    env,
  );
  return { status: res.status, data: await res.json() };
}

const attempts = (env) => env.DB.sqlite.prepare("SELECT email_mac, attempted_at FROM avatar_upload_attempts").all();

test("avatar uploads: 5 attempts per rolling 30 days, failed ones included", async () => {
  const env = createEnv();
  for (let i = 0; i < 4; i++) assert.equal((await upload(env, "u")).status, 200);
  const bad = await upload(env, "u", new TextEncoder().encode("not an image"));
  assert.equal(bad.data.code, "invalid_image"); // the 5th attempt fails, and still counts
  const sixth = await upload(env, "u");
  assert.equal(sixth.status, 429);
  assert.equal(sixth.data.code, "upload_limit");
  const first = Math.min(...attempts(env).map((r) => r.attempted_at));
  assert.equal(sixth.data.next_upload_at, first + 30 * 86400_000);
  assert.equal(attempts(env).length, 5); // a refused attempt is not recorded
  assert.ok(attempts(env).every((r) => /^[0-9a-f]{64}$/.test(r.email_mac))); // hashes, no emails
  // Another email has its own count.
  assert.equal((await upload(env, "other")).status, 200);
  // Once the oldest attempt leaves the window, one more upload is allowed.
  // (Several attempts can share a millisecond here, so move exactly the first row inserted.)
  env.DB.sqlite.exec(`UPDATE avatar_upload_attempts SET attempted_at = attempted_at - 31 * 86400000
    WHERE rowid = (SELECT rowid FROM avatar_upload_attempts ORDER BY attempted_at, rowid LIMIT 1)`);
  assert.equal((await upload(env, "u")).status, 200);
  assert.equal((await upload(env, "u")).status, 429);
});

test("avatar uploads: concurrent requests cannot exceed the limit", async () => {
  const env = createEnv();
  const results = await Promise.all(Array.from({ length: 9 }, () => upload(env, "c")));
  assert.equal(results.filter((r) => r.status === 200).length, 5);
  assert.equal(results.filter((r) => r.status === 429).length, 4);
});

test("avatar uploads: refused during the basic-info lock, and deleting the account restores nothing", async () => {
  const env = createEnv();
  await register(env, "w"); // registering starts the 30-day basic-info lock
  const locked = await upload(env, "w");
  assert.equal(locked.status, 409);
  assert.equal(locked.data.code, "basic_locked");
  assert.equal(attempts(env).length, 0); // costs no attempt

  await editProfile(env, "w", (p) => (p.basic_changed_at -= 31 * 86400_000));
  const up = await upload(env, "w");
  assert.equal(up.status, 200);
  // Uploading alone does not start the lock; saving the new avatar does.
  assert.equal((await upload(env, "w")).status, 200);
  const save = await call(env, "w", "PUT", "/api/profile", { ...profile(), avatar: up.data.avatar });
  assert.equal(save.status, 400); // the upload replaced by the second one was pruned
  const latest = env.DB.sqlite.prepare("SELECT id FROM avatars").get().id;
  assert.equal((await call(env, "w", "PUT", "/api/profile", { ...profile(), avatar: `upload:${latest}` })).status, 200);
  assert.equal((await upload(env, "w")).data.code, "basic_locked");

  assert.equal((await call(env, "w", "DELETE", "/api/account")).status, 200);
  assert.equal(attempts(env).length, 2); // the count survives account deletion
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM avatars").get().n, 0);
});

test("outside local development, uploads refuse to run without ACCOUNT_KEY", async () => {
  const env = createEnv();
  const prod = { ...env, DEV_MODE: undefined };
  // DEV_MODE off means no x-dev-user identity, so call the upload function directly.
  const { uploadAvatar } = await import("../src/platform/avatars.js");
  const req = new Request("http://x/api/avatars", { method: "POST", body: png256() });
  await assert.rejects(uploadAvatar(prod, req, "x@cs.washington.edu", Date.now()), (e) => e.code === "server_misconfigured");
});

// ---------- logs (docs/oversight.md rule 8) ----------

test("logs carry no personal data, even when requests and the clean-up fail", async () => {
  const lines = [];
  const saved = {};
  for (const k of ["log", "info", "warn", "error", "debug"]) {
    saved[k] = console[k];
    console[k] = (...args) => lines.push(args.map(String).join(" "));
  }
  const secret = { wechat: "wx-SECRET-1", discord: "dc-SECRET-2", bio: "bio-SECRET-3", research: "res-SECRET-4" };
  try {
    // A limiter that throws is logged, and the requests go through.
    const env = createEnv({ RL_API: { limit: async () => { throw new Error("limiter down"); } } });
    await register(env, "logme", { ...secret, relation_notes: { FRIENDSHIP: "note-SECRET-5" } });
    await call(env, "logme", "PUT", "/api/profile", { nickname: 5 });
    await checkin(env, "logme");
    await call(env, "logme", "GET", "/api/people");

    // An unhandled error whose message quotes personal data.
    const failing = createEnv();
    await register(failing, "boom", secret);
    const prepare = failing.DB.prepare;
    failing.DB.prepare = (sql) => {
      if (/FROM profiles/.test(sql)) throw new Error(`exploded near boom@cs.washington.edu ${secret.wechat}`);
      return prepare(sql);
    };
    assert.equal((await call(failing, "boom", "GET", "/api/profile")).status, 500);
    failing.DB.prepare = prepare;

    // A clean-up step that fails.
    failing.DB.sqlite.exec(`INSERT INTO avatars (id, owner_hash, content_type, size, created_at) VALUES ('${"0".repeat(32)}', 'h', 'image/png', 1, 0)`);
    failing.BUCKET.delete = async () => { throw new Error("r2 down"); };
    await assert.rejects(worker.scheduled({ cron: "17 11 * * *" }, failing), /scheduled run failed: platform/);
  } finally {
    Object.assign(console, saved);
  }
  assert.ok(lines.length >= 3, lines.join("\n")); // the limiter, the unhandled error and the clean-up
  const all = lines.join("\n");
  for (const s of ["logme", "boom", "@cs.washington.edu", "exploded", "note-SECRET-5", ...Object.values(secret)]) {
    assert.ok(!all.includes(s), `log contains ${s}:\n${all}`);
  }
});
