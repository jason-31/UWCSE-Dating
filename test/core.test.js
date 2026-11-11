import { test } from "node:test";
import assert from "node:assert/strict";
import { periodAt, periodBounds, localMidnightUtc } from "../src/platform/period.js";
import { buildCard, validateProfile, emailAllowed, checkLockedChanges, matchingRelations } from "../src/platform/profile.js";
import { findEvidence } from "../src/modules/leetcode/provider.js";
import { pickProblem } from "../src/modules/leetcode/index.js";
import { scopedDb } from "../src/platform/scoped-db.js";
import { HttpError, L, localize, asHttpError, errorResponse } from "../src/platform/http.js";
import { textWeight } from "../public/text-weight.js";
import { SITE } from "../src/site.config.js";

const TZ = "America/Los_Angeles";
const cfg = SITE.profile;
const H = 3600_000;

test("period boundaries follow LA local midnight", () => {
  assert.equal(localMidnightUtc("2026-10-31", TZ), Date.UTC(2026, 9, 31, 7)); // PDT
  assert.equal(localMidnightUtc("2026-12-01", TZ), Date.UTC(2026, 11, 1, 8)); // PST
  const p = periodAt(Date.UTC(2026, 10, 1, 6, 59), TZ); // 23:59 PDT Oct 31
  assert.equal(p.period_id, "2026-10-31");
});

test("DST days are 25h and 23h", () => {
  const fall = periodBounds("2026-11-01", TZ);
  assert.equal(fall.ends_at - fall.starts_at, 25 * H);
  const spring = periodBounds("2026-03-08", TZ);
  assert.equal(spring.ends_at - spring.starts_at, 23 * H);
});

const mk = (member_id, relations, visibility = {}, extra = {}) => ({
  member_id,
  nickname: member_id,
  gender: "FEMALE",
  avatar: "female",
  relations,
  email: `${member_id}@cs.washington.edu`,
  wechat: `${member_id}-wx`,
  discord: null,
  bio: "hi",
  program: "PHD",
  research: null,
  relation_notes: {},
  relation_filters: {},
  visibility: {
    email: ["FRIENDSHIP", "STUDY", "ROMANCE"],
    wechat: [],
    discord: [],
    ...visibility,
  },
  ...extra,
});

test("A/B/C visibility example from docs/product.md", () => {
  const A = mk("A", ["FRIENDSHIP", "ROMANCE"], { wechat: ["ROMANCE"] });
  const B = mk("B", ["FRIENDSHIP"]);
  const C = mk("C", ["ROMANCE"]);
  const ab = buildCard(B, A);
  assert.deepEqual(ab.common_relations, ["FRIENDSHIP"]);
  assert.equal(ab.fields.wechat, undefined);
  assert.equal(buildCard(C, A).fields.wechat, "A-wx");
  assert.equal(buildCard(B, C), null);
  assert.equal(buildCard(C, B), null);
});

test("wechat may be opened to any relation, defaults to ROMANCE only", () => {
  const A = mk("A", ["FRIENDSHIP"], { wechat: ["FRIENDSHIP"] });
  const B = mk("B", ["FRIENDSHIP"]);
  assert.equal(buildCard(B, A).fields.wechat, "A-wx");
  const p = validateProfile({ nickname: "x", gender: "FEMALE", program: "PHD", avatar: "female", relations: ["FRIENDSHIP"], visibility: { wechat: ["FRIENDSHIP"] } }, cfg);
  assert.deepEqual(p.visibility.wechat, ["FRIENDSHIP"]);
  const d = validateProfile({ nickname: "x", gender: "FEMALE", program: "PHD", avatar: "female", relations: ["FRIENDSHIP"] }, cfg);
  assert.deepEqual(d.visibility.wechat, ["ROMANCE"]);
  assert.deepEqual(d.visibility.discord, ["ROMANCE"]);
  assert.throws(() => validateProfile({ nickname: "x", gender: "FEMALE", program: "PHD", avatar: "female", relations: ["STUDY"], visibility: { wechat: ["NOPE"] } }, cfg));
});

test("relation notes are kept only for sought relations and shown only for shared ones", () => {
  const p = validateProfile(
    { nickname: "x", gender: "FEMALE", program: "PHD", avatar: "female", relations: ["FRIENDSHIP", "ROMANCE"], relation_notes: { FRIENDSHIP: " hike ", STUDY: "dropped", ROMANCE: "" } },
    cfg,
  );
  assert.deepEqual(p.relation_notes, { FRIENDSHIP: "hike" });
  // Note limits are weighted: 400 letters or 200 Chinese characters.
  const withNote = (note) =>
    validateProfile({ nickname: "x", gender: "FEMALE", program: "PHD", avatar: "female", relations: ["STUDY"], relation_notes: { STUDY: note } }, cfg);
  assert.equal(withNote("x".repeat(400)).relation_notes.STUDY.length, 400);
  assert.throws(() => withNote("x".repeat(401)));
  assert.equal(withNote("中".repeat(200)).relation_notes.STUDY.length, 200);
  assert.throws(() => withNote("中".repeat(201)));
  const A = mk("A", ["FRIENDSHIP", "ROMANCE"], {}, { relation_notes: { FRIENDSHIP: "f-note", ROMANCE: "r-note" } });
  assert.deepEqual(buildCard(mk("B", ["FRIENDSHIP"]), A).relation_notes, { FRIENDSHIP: "f-note" });
  assert.deepEqual(buildCard(mk("C", ["ROMANCE", "FRIENDSHIP"]), A).relation_notes, { FRIENDSHIP: "f-note", ROMANCE: "r-note" });
});

test("messages are localized per request", () => {
  const data = { message: L("你好", "hi"), list: [L("一", "one")], notes: { zh: "user text" } };
  assert.deepEqual(localize(data, "en"), { message: "hi", list: ["one"], notes: { zh: "user text" } });
  assert.equal(localize(data, "zh").message, "你好");
  const err = new HttpError(400, "x", L("错", "wrong"));
  assert.equal(err.message, "wrong");
  assert.throws(() => validateProfile({ avatar: "female", relations: ["STUDY"] }, cfg), (e) => localize(e.messageL, "en") === "Nickname is required");
});

test("text weight: alphabetic characters count 1, CJK and emoji 2", () => {
  assert.equal(textWeight("Hello, world"), 12);
  assert.equal(textWeight("你好，世界"), 10); // the full-width comma is wide too
  assert.equal(textWeight("Café — “ok”"), 11);
  assert.equal(textWeight("こんにちは안녕"), 14);
  assert.equal(textWeight("🙂"), 2);
  assert.equal(textWeight(""), 0);
});

test("D1's daily-limit error becomes a 503 daily_capacity answer; other errors stay internal", async () => {
  for (const msg of [
    "D1_ERROR: Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue.",
    "Your account has reached its daily D1 Free tier row write limit.",
  ]) {
    const e = asHttpError(new Error(msg));
    assert.equal(e.code, "daily_capacity");
    assert.equal(e.status, 503);
    assert.equal(e.extra.resumes_at % 86400_000, 0); // 00:00 UTC
    assert.ok(e.extra.resumes_at > Date.now());
  }
  assert.equal(asHttpError(new Error("D1_ERROR: no such table: x")), null);
  const res = errorResponse(new Error("Your account has reached its daily D1 Free tier row read limit."), "en");
  assert.equal(res.status, 503);
  assert.equal((await res.json()).code, "daily_capacity");
});

test("profile has no editable email; login email domain is checked", () => {
  const ok = validateProfile({ nickname: "x", gender: "FEMALE", program: "PHD", avatar: "female", relations: ["STUDY"], email: "evil@x.com" }, cfg);
  assert.equal(ok.email, undefined);
  assert.deepEqual(ok.visibility.wechat, ["ROMANCE"]);
  assert.ok(emailAllowed("a@cs.washington.edu", cfg.allowed_email_domains));
  assert.ok(!emailAllowed("a@gmail.com", cfg.allowed_email_domains));
});

test("evidence must match slug and period window", () => {
  const period = { problem: { slug: "two-sum" }, starts_at: 1000, ends_at: 2000 };
  const ac = (slug, t) => ({ slug, accepted_at: t, status: "Accepted", submission_id: "1" });
  assert.equal(findEvidence([ac("two-sum", 999)], period), null);
  assert.equal(findEvidence([ac("two-sum", 2000)], period), null);
  assert.equal(findEvidence([ac("3sum", 1500)], period), null);
  assert.ok(findEvidence([ac("3sum", 1500), ac("two-sum", 1500)], period));
});

test("problem pick respects difficulty and shrinks exclusion window", () => {
  const pool = {
    problems: [
      { slug: "a", difficulty: "Easy", paid_only: false },
      { slug: "b", difficulty: "Hard", paid_only: false },
      { slug: "c", difficulty: "Medium", paid_only: true },
    ],
  };
  const pc = { difficulties: ["Easy", "Medium"], paid_only: false, exclude_recent_periods: 30 };
  assert.equal(pickProblem(pool, pc, []).slug, "a");
  assert.equal(pickProblem(pool, pc, ["a"]).slug, "a"); // window shrinks to 0
  assert.equal(pickProblem({ problems: [] }, pc, []), null);
});

test("scoped db rejects foreign tables and unscoped queries", () => {
  const fake = { prepare: () => ({ bind: (...a) => a }) };
  const db = scopedDb(fake, "s1", "lc_");
  assert.deepEqual(db.prepare("SELECT * FROM lc_x WHERE challenge_id = ?1 AND a = ?2", 5), ["s1", 5]);
  db.prepare("INSERT INTO lc_x (challenge_id) VALUES (?1) ON CONFLICT (challenge_id) DO UPDATE SET a = 1");
  assert.throws(() => db.prepare("UPDATE users SET a = 1 WHERE challenge_id = ?1"));
  assert.throws(() => db.prepare("SELECT * FROM users WHERE challenge_id = ?1"));
  assert.throws(() => db.prepare("SELECT * FROM lc_x WHERE a = ?1"));
  assert.throws(() => db.prepare("SELECT * FROM lc_x x JOIN other_y y ON 1 WHERE challenge_id = ?1"));
});

test("avatar uploads: type sniffing, references and urls", async () => {
  const { sniffImageType, avatarUrl, uploadId } = await import("../src/platform/avatars.js");
  assert.equal(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0])), "image/png");
  assert.equal(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(sniffImageType(new TextEncoder().encode("RIFF0000WEBPVP8 ")), "image/webp");
  assert.equal(sniffImageType(new TextEncoder().encode("<svg onload=alert(1)>")), null);
  const id = "a".repeat(32);
  assert.equal(avatarUrl(`upload:${id}`), `/api/avatars/${id}`);
  assert.equal(avatarUrl("female"), "/avatars/female.png");
  assert.equal(uploadId("upload:../x"), null);
  const base = { nickname: "x", gender: "FEMALE", program: "PHD", relations: ["STUDY"] };
  assert.equal(validateProfile({ ...base, avatar: `upload:${id}` }, cfg).avatar, `upload:${id}`);
  assert.throws(() => validateProfile({ ...base, avatar: "upload:nothex" }, cfg));
  assert.throws(() => validateProfile({ ...base, avatar: "https://evil/x.png" }, cfg));
});

test("gender and program are required basic info, always on the card", () => {
  const base = { nickname: "x", avatar: "female", relations: ["STUDY"] };
  assert.equal(validateProfile({ ...base, gender: "NON_BINARY", program: "PMP" }, cfg).program, "PMP");
  assert.throws(() => validateProfile({ ...base, program: "PHD" }, cfg)); // no gender
  assert.throws(() => validateProfile({ ...base, gender: "other", program: "PHD" }, cfg));
  assert.throws(() => validateProfile({ ...base, gender: "MALE" }, cfg)); // no program
  assert.throws(() => validateProfile({ ...base, gender: "MALE", program: "" }, cfg));
  assert.throws(() => validateProfile({ ...base, gender: "MALE", program: "2nd-year PhD" }, cfg));
  // Shown regardless of any visibility setting; prefer-not-to-say is shown as a value.
  const card = buildCard(mk("V", ["STUDY"]), mk("A", ["STUDY"], { gender: [], program: [] }, { gender: "PREFER_NOT_TO_SAY", program: "STAFF" }));
  assert.equal(card.gender, "PREFER_NOT_TO_SAY");
  assert.equal(card.program, "STAFF");
  assert.equal(card.fields.gender, undefined);
});


test("avatar dimensions are read from image headers", async () => {
  const { imageSize } = await import("../src/platform/avatars.js");
  const png = new Uint8Array(24);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 1, 0, 0, 0, 1, 0]);
  assert.deepEqual(imageSize(png, "image/png"), { width: 256, height: 256 });
  // SOI, an APP0 segment of length 4, then SOF0 with height 200, width 300.
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 0, 200, 1, 44, 3, 0, 0]);
  assert.deepEqual(imageSize(jpg, "image/jpeg"), { width: 300, height: 200 });
  const vp8x = new Uint8Array(30);
  vp8x.set(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8X"));
  vp8x.set([255, 0, 0, 255, 0, 0], 24); // (w-1, h-1) as 24-bit LE
  assert.deepEqual(imageSize(vp8x, "image/webp"), { width: 256, height: 256 });
  const vp8 = new Uint8Array(30);
  vp8.set(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "));
  vp8.set([0, 1, 0, 1], 26);
  assert.deepEqual(imageSize(vp8, "image/webp"), { width: 256, height: 256 });
  assert.equal(imageSize(new Uint8Array(10), "image/png"), null);
});

test("filters are two-way on gender and program", () => {
  const all = ["FRIENDSHIP", "STUDY", "ROMANCE"];
  // A wants friendship and romance; for romance only women in BS CS/CE or BS/MS.
  const A = mk("A", ["FRIENDSHIP", "ROMANCE"], {}, {
    gender: "MALE",
    program: "BS_CS",
    relation_filters: { ROMANCE: { gender: ["FEMALE"], program: ["BS_CS", "BS_CE", "BS_MS"] } },
  });
  const fem = (id, extra = {}) => mk(id, all, {}, { gender: "FEMALE", program: "BS_MS", ...extra });
  assert.deepEqual(matchingRelations(A, fem("B")), ["FRIENDSHIP", "ROMANCE"]);
  assert.deepEqual(matchingRelations(fem("B"), A), ["FRIENDSHIP", "ROMANCE"]); // symmetric
  // Fails A's program filter: still friends, not romance — in both directions.
  assert.deepEqual(matchingRelations(A, fem("C", { program: "PHD" })), ["FRIENDSHIP"]);
  assert.deepEqual(buildCard(fem("C", { program: "PHD" }), A).common_relations, ["FRIENDSHIP"]);
  // Prefer-not-to-say is an ordinary value: excluded unless ticked.
  assert.deepEqual(matchingRelations(A, fem("E", { gender: "PREFER_NOT_TO_SAY" })), ["FRIENDSHIP"]);
  const A2 = { ...A, relation_filters: { ROMANCE: { gender: ["FEMALE", "PREFER_NOT_TO_SAY"] } } };
  assert.deepEqual(matchingRelations(A2, fem("E", { gender: "PREFER_NOT_TO_SAY" })), ["FRIENDSHIP", "ROMANCE"]);
  // The other side's filter applies to A too.
  const G = fem("G", { relation_filters: { ROMANCE: { gender: ["NON_BINARY"] }, FRIENDSHIP: { program: ["PHD"] } } });
  assert.equal(buildCard(A, G), null);
  assert.equal(buildCard(G, A), null);
});

test("filters are validated, normalized and share the 7-day lock with relations", () => {
  const base = { nickname: "x", gender: "MALE", program: "PHD", avatar: "female", relations: ["ROMANCE"] };
  const p = validateProfile(
    { ...base, relation_filters: { ROMANCE: { program: ["PHD", "BS_CS"], gender: ["NON_BINARY", "FEMALE", "MALE", "PREFER_NOT_TO_SAY"] }, STUDY: { gender: ["MALE"] } } },
    cfg,
  );
  // Ordered; a fully selected field means no restriction and is dropped; unsought relations dropped.
  assert.deepEqual(p.relation_filters, { ROMANCE: { program: ["BS_CS", "PHD"] } });
  assert.throws(() => validateProfile({ ...base, relation_filters: { ROMANCE: { gender: [] } } }, cfg), (e) => e.code === "invalid_request");
  assert.deepEqual(validateProfile({ ...base, relation_filters: { ROMANCE: { gender: ["PREFER_NOT_TO_SAY"] } } }, cfg).relation_filters, { ROMANCE: { gender: ["PREFER_NOT_TO_SAY"] } });
  assert.throws(() => validateProfile({ ...base, relation_filters: { ROMANCE: { bio: ["x"] } } }, cfg), (e) => e.code === "invalid_request");
  assert.throws(() => validateProfile({ ...base, relation_filters: { ROMANCE: { program: "PHD" } } }, cfg));

  const now = Date.UTC(2026, 10, 1);
  const day = 86400_000;
  const current = { ...p, matching_changed_at: now - day, basic_changed_at: now - 60 * day };
  checkLockedChanges(current, { ...p, bio: "new" }, cfg, now); // other fields: fine
  const filtersChanged = { ...p, relation_filters: { ROMANCE: { program: ["PHD"] } } };
  assert.throws(() => checkLockedChanges(current, filtersChanged, cfg, now), (e) => e.code === "matching_locked");
  checkLockedChanges({ ...current, matching_changed_at: now - 8 * day }, filtersChanged, cfg, now);
});

test("only WeChat and Discord have per-relation visibility; email and about-me are always shown", () => {
  const p = validateProfile(
    { nickname: "x", gender: "MALE", program: "PHD", avatar: "male", relations: ["STUDY"], bio: "b", research: "r", visibility: { bio: [], research: [] } },
    cfg,
  );
  assert.deepEqual(Object.keys(p.visibility).sort(), ["discord", "wechat"]);
  const owner = mk("A", ["STUDY"], { email: [], wechat: [] }, { bio: "about", research: "PL" });
  const card = buildCard(mk("V", ["STUDY"]), owner);
  assert.equal(card.bio, "about");
  assert.equal(card.research, "PL");
  assert.equal(card.email, "A@cs.washington.edu"); // even with email visibility set to nobody
  assert.deepEqual(card.fields, {});
});

test("nickname, gender and program share a 30-day lock; the avatar is not locked", () => {
  const p = validateProfile({ nickname: "x", gender: "MALE", program: "PHD", avatar: "male", relations: ["STUDY"] }, cfg);
  const day = 86400_000;
  const now = Date.UTC(2026, 10, 1);
  const current = { ...p, matching_changed_at: now - 60 * day, basic_changed_at: now - 10 * day };
  for (const change of [{ nickname: "y" }, { gender: "FEMALE" }, { program: "PMP" }]) {
    assert.throws(
      () => checkLockedChanges(current, { ...p, ...change }, cfg, now),
      (e) => e.code === "basic_locked" && e.extra.basic_locked_until === now + 20 * day,
    );
  }
  checkLockedChanges(current, { ...p, avatar: "female" }, cfg, now); // the avatar can change any time
  checkLockedChanges(current, { ...p, relations: ["FRIENDSHIP"] }, cfg, now); // matching lock expired
  checkLockedChanges({ ...current, basic_changed_at: now - 31 * day }, { ...p, nickname: "y" }, cfg, now);
});

test("Google ID token claims: issuer, audience, expiry, nonce, verified email and Workspace domain", async () => {
  const { checkIdTokenClaims } = await import("../src/platform/google-auth.js");
  const now = Date.UTC(2026, 10, 1);
  const opts = { clientId: "cid", nonce: "n1", now, domains: ["cs.washington.edu"] };
  const ok = {
    iss: "https://accounts.google.com",
    aud: "cid",
    exp: now / 1000 + 600,
    nonce: "n1",
    email: "Renjiz2@cs.washington.edu",
    email_verified: true,
    hd: "cs.washington.edu",
  };
  assert.equal(checkIdTokenClaims(ok, opts), null);
  assert.equal(checkIdTokenClaims({ ...ok, iss: "https://evil" }, opts), "token");
  assert.equal(checkIdTokenClaims({ ...ok, aud: "other" }, opts), "token");
  assert.equal(checkIdTokenClaims({ ...ok, exp: now / 1000 - 1 }, opts), "token");
  assert.equal(checkIdTokenClaims({ ...ok, nonce: "n2" }, opts), "token");
  assert.equal(checkIdTokenClaims({ ...ok, email_verified: false }, opts), "email");
  // Personal Google account using a school address: no hd.
  assert.equal(checkIdTokenClaims({ ...ok, hd: undefined }, opts), "domain");
  assert.equal(checkIdTokenClaims({ ...ok, hd: "uw.edu", email: "a@uw.edu" }, opts), "domain");
  assert.equal(checkIdTokenClaims({ ...ok, email: "a@gmail.com" }, opts), "domain");
});

test("identity never comes from an unverified header; DEV_MODE only counts on localhost", async () => {
  const { identify, effectiveEnv } = await import("../src/platform/auth.js");
  const req = (url, headers = {}) => new Request(url, { headers });
  const spoof = { "cf-access-authenticated-user-email": "victim@cs.washington.edu", "x-dev-user": "victim@cs.washington.edu" };

  // No sign-in configured and not local: refuse, even with an Access-looking header.
  const prod = req("https://uwcse.date/api/me", spoof);
  await assert.rejects(identify(prod, effectiveEnv(prod, {})), (e) => e.code === "auth_not_configured");

  // Legacy Access configuration cannot supply the site's identity.
  const accessOnly = { ACCESS_TEAM_DOMAIN: "example.cloudflareaccess.com", ACCESS_AUD: "legacy-app" };
  const accessRequest = req("https://uwcse.date/api/me", { ...spoof, "cf-access-jwt-assertion": "ignored" });
  await assert.rejects(identify(accessRequest, accessOnly), (e) => e.code === "auth_not_configured");

  // A stray DEV_MODE=1 in production is ignored, so x-dev-user can't pick an identity.
  const devEnv = { DEV_MODE: "1", DEV_USER_EMAIL: "dev@cs.washington.edu" };
  assert.equal(effectiveEnv(prod, devEnv).DEV_MODE, undefined);
  await assert.rejects(identify(prod, effectiveEnv(prod, devEnv)), (e) => e.code === "auth_not_configured");

  // Locally DEV_MODE works as before.
  for (const host of ["http://localhost:8799/api/me", "http://127.0.0.1:8799/api/me"]) {
    const local = req(host, { "x-dev-user": "Someone@cs.washington.edu" });
    assert.equal((await identify(local, effectiveEnv(local, devEnv))).email, "someone@cs.washington.edu");
    const plain = req(host);
    assert.equal((await identify(plain, effectiveEnv(plain, devEnv))).email, "dev@cs.washington.edu");
  }
});

test("check-in streak counts back from today, or from yesterday if today is not done yet", async () => {
  const { streakFrom } = await import("../src/modules/checkin/index.js");
  assert.equal(streakFrom([], "2026-11-01"), 0);
  assert.equal(streakFrom(["2026-11-01", "2026-10-31", "2026-10-30"], "2026-11-01"), 3);
  assert.equal(streakFrom(["2026-10-31", "2026-10-30"], "2026-11-01"), 2); // today still open
  assert.equal(streakFrom(["2026-10-30"], "2026-11-01"), 0); // missed yesterday
  assert.equal(streakFrom(["2026-11-01", "2026-10-30"], "2026-11-01"), 1); // gap
  assert.equal(streakFrom(["2026-03-01", "2026-02-28"], "2026-03-01"), 2); // month boundary
});

test("login attempt cookie: round trip, tampering, other key and expiry are rejected", async () => {
  const { makeStateCookieValue, readStateCookieValue } = await import("../src/platform/google-auth.js");
  const env = { GOOGLE_CLIENT_SECRET: "secret-1" };
  const state = "A".repeat(43);
  const value = await makeStateCookieValue(env, state, 2_000);
  const ok = await readStateCookieValue(env, value, 1_999);
  assert.equal(ok.state, state);
  assert.match(ok.verifier, /^[A-Za-z0-9_-]{43}$/); // a valid PKCE code_verifier
  assert.notEqual(ok.verifier, ok.nonce);
  assert.deepEqual(await readStateCookieValue(env, value, 1_999), ok); // derived, so stable
  assert.equal(await readStateCookieValue(env, value, 2_001), null); // expired
  assert.equal(await readStateCookieValue({ GOOGLE_CLIENT_SECRET: "secret-2" }, value, 1_999), null);
  const [s, exp, sig] = value.split(".");
  assert.equal(await readStateCookieValue(env, `${s}.${Number(exp) + 60_000}.${sig}`, 1_999), null); // extended expiry
  assert.equal(await readStateCookieValue(env, `${"B".repeat(43)}.${exp}.${sig}`, 1_999), null); // swapped state
  for (const junk of [undefined, "", "a.b", "a.b.c", `${s}.${exp}`]) assert.equal(await readStateCookieValue(env, junk, 0), null);
});

test("a non-string avatar is a validation error, not a server error", async () => {
  const { uploadId } = await import("../src/platform/avatars.js");
  const id = "0123456789abcdef0123456789abcdef";
  assert.equal(uploadId([`upload:${id}`]), null);
  const base = { nickname: "x", gender: "FEMALE", program: "PHD", relations: ["STUDY"] };
  assert.throws(() => validateProfile({ ...base, avatar: [`upload:${id}`] }, cfg), (e) => e.code === "invalid_request");
});
