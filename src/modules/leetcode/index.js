import { HttpError, L, json, localize, readJson } from "../../platform/http.js";
import { periodAt, periodBounds, isPeriodId } from "../../platform/period.js";
import { getProvider, findEvidence, aboutContainsToken, ProviderError } from "./provider.js";
import { joinModeFrom } from "../../platform/join-mode.js";
import poolV1 from "./pool-v1.js";

const MODULE_VERSION = 1;
const POOLS = { [poolV1.version]: poolV1 };
const SITE = "leetcode.com";
// Verification attempts are deleted by the daily clean-up after this many days.
const ATTEMPT_RETENTION_DAYS = 7;

// LeetCode usernames identify people, so every stored copy is sealed through ctx.vault, bound to
// the user; uniqueness across users is checked on a lookup hash of the lower-cased name. Binding
// tokens and attempt evidence (which names the account) are sealed too.
const usernameContext = (userId) => `username:${userId}`;
const tokenContext = (userId) => `binding-token:${userId}`;
const evidenceContext = (userId, attemptId) => `attempt:${userId}:${attemptId}`;
const usernameHash = (ctx, norm) => ctx.vault.lookup("username", norm);

const manifest = {
  module_id: "leetcode",
  module_version: MODULE_VERSION,
  api_version: 1,
  name: L("LeetCode 每日挑战", "LeetCode Daily"),
  description: L(
    "每天随机一道 LeetCode 题，所有人同一道。用已验证的账号在当天 AC，服务器核对后进入当天名单。",
    "One random LeetCode problem a day, the same for everyone. Get it Accepted on your verified account that day; once the server confirms it, you join that day's list.",
  ),
  frontend: "/modules/leetcode/app.js",
  table_prefix: "lc_",
  env: ["DEV_MODE", "LEETCODE_PROVIDER"],
};

const RULES_TEXT = [
  L(
    "每天（洛杉矶时间 0 点起）本挑战只有一道随机题目，所有人相同，不会为个人换题。",
    "Each day (starting at midnight Los Angeles time) the challenge has exactly one random problem, the same for everyone; it is never re-rolled for an individual.",
  ),
  L(
    "必须用已验证归属的 LeetCode 账号，在当期内对指定题目获得 Accepted；以前 AC 过的也要当期重新提交。",
    "You must get Accepted on that problem during the period with a LeetCode account you have verified; if you solved it before, submit it again this period.",
  ),
  L(
    "完成由服务器向数据源核对，截图、自报或上传记录都不算。",
    "Completion is checked by the server against the data source. Screenshots, self-reports and uploads do not count.",
  ),
  L(
    "“自动进入本期 list”可选总是加入、每次询问或总是不加入；选总是加入时，验证通过即按你的个人资料进入当期名单。只有在名单里的人能浏览名单，且只能看到与自己寻找相同关系的成员。",
    "\"Join this period's list automatically\" can be always, ask each time, or never; with always, a verified completion puts you on that period's list using your profile. Only people on the list can browse it, and only members looking for a relationship type you share are shown.",
  ),
  L(
    "本站不提供站内消息，只展示你主动开放的联系方式。你可以随时退出当期展示或退出本挑战。",
    "There is no messaging on this site; only the contact details you choose to share are shown. You can leave the current list or the challenge at any time.",
  ),
];

// Answer to an ownership or daily check while verification.paused is set: no request reaches
// LeetCode.
const PAUSED = L(
  "LeetCode 验证暂时停用，本站目前不向 LeetCode 查询。已有的完成记录、名单和历史不受影响。",
  "LeetCode checks are paused: the site is not querying LeetCode for now. Existing completions, lists and history are not affected.",
);

// Module responses carry bilingual messages; resolve them for the requester.
function reply(ctx, data, status) {
  return json(localize(data, ctx.lang), status);
}

// ---------- config ----------

function validateConfig(cfg) {
  const fail = (m) => {
    throw new Error(`challenge ${cfg.challenge_id}: ${m}`);
  };
  if (cfg.schedule?.kind !== "calendar_day") fail("schedule.kind must be calendar_day");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: cfg.schedule.timezone });
  } catch {
    fail(`invalid timezone ${cfg.schedule.timezone}`);
  }
  // Past lists can never be browsed (docs/product.md, "No past lists"), so there is nothing to set.
  if (cfg.history !== undefined) fail("history (a look-back at past lists) is not allowed");
  if (!POOLS[cfg.problem_pool?.version]) fail(`unknown problem pool ${cfg.problem_pool?.version}`);
  if (cfg.problem_pool.site !== SITE) fail(`only ${SITE} is supported`);
  // Ownership and server-side evidence cannot be configured away.
  if (cfg.completion?.require_account_ownership !== true) fail("require_account_ownership must be true");
  if (cfg.completion?.require_accepted_in_current_period !== true) fail("require_accepted_in_current_period must be true");
  if (typeof cfg.verification?.paused !== "boolean") fail("verification.paused must be true or false");
  return Object.freeze(cfg);
}

function describeSchedule(cfg) {
  const tz = cfg.schedule.timezone;
  return L(`每天 0 点（${tz}）刷新`, `Refreshes daily at midnight (${tz})`);
}

// ---------- state ----------

async function loadState(ctx) {
  const [enrollment, profile, binding, pendingToken] = await Promise.all([
    ctx.db.prepare("SELECT * FROM lc_enrollments WHERE challenge_id = ?1 AND user_id = ?2", ctx.userId).first(),
    ctx.profiles.status(ctx.userId),
    ctx.db.prepare("SELECT * FROM lc_bindings WHERE challenge_id = ?1 AND user_id = ?2", ctx.userId).first(),
    ctx.db.prepare("SELECT * FROM lc_binding_tokens WHERE challenge_id = ?1 AND user_id = ?2", ctx.userId).first(),
  ]);
  return { enrollment, profile, binding, pendingToken };
}

function readiness(ctx, state) {
  const enrolled = state.enrollment?.status === "active";
  const bindingVerified = !!state.binding;
  return {
    // Site-wide profile; this challenge only learns whether it is complete.
    profile_complete: state.profile.complete,
    enrolled,
    join_mode: enrolled ? state.enrollment.join_mode : null,
    binding_verified: bindingVerified,
    can_verify: enrolled && state.profile.complete && bindingVerified,
  };
}

// ---------- periods ----------

function parsePeriod(row) {
  return row && { ...row, problem: JSON.parse(row.problem) };
}

async function getPeriod(ctx, periodId) {
  return parsePeriod(
    await ctx.db.prepare("SELECT * FROM lc_periods WHERE challenge_id = ?1 AND period_id = ?2", periodId).first(),
  );
}

function randomIndex(n) {
  // Rejection sampling for an unbiased index.
  const limit = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf);
  while (buf[0] >= limit);
  return buf[0] % n;
}

export function pickProblem(pool, poolCfg, recentSlugs) {
  const eligible = pool.problems.filter(
    (p) => (poolCfg.paid_only || !p.paid_only) && poolCfg.difficulties.includes(p.difficulty),
  );
  // Shrink the exclusion window until something is left.
  for (let w = poolCfg.exclude_recent_periods; ; w = Math.floor(w / 2)) {
    const excluded = new Set(recentSlugs.slice(0, w));
    const candidates = eligible.filter((p) => !excluded.has(p.slug));
    if (candidates.length) return candidates[randomIndex(candidates.length)];
    if (w === 0) return null;
  }
}

// Draws the period's problem once. The input is only the challenge config and the period, never
// the requesting user. Concurrent first requests race on the primary key; all read the winner.
async function ensurePeriod(ctx, periodId) {
  const existing = await getPeriod(ctx, periodId);
  if (existing) return existing;

  const cfg = ctx.config;
  const recent = await ctx.db
    .prepare(
      "SELECT problem FROM lc_periods WHERE challenge_id = ?1 AND period_id < ?2 ORDER BY period_id DESC LIMIT ?3",
      periodId,
      cfg.problem_pool.exclude_recent_periods,
    )
    .all();
  const recentSlugs = recent.results.map((r) => JSON.parse(r.problem).slug);
  const problem = pickProblem(POOLS[cfg.problem_pool.version], cfg.problem_pool, recentSlugs);
  if (!problem) return null;

  const b = periodBounds(periodId, cfg.schedule.timezone);
  await ctx.db
    .prepare(
      `INSERT OR IGNORE INTO lc_periods
        (challenge_id, period_id, starts_at, ends_at, timezone, problem, pool_version, config_version, module_version, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
      periodId,
      b.starts_at,
      b.ends_at,
      cfg.schedule.timezone,
      JSON.stringify({
        frontend_id: problem.frontend_id,
        slug: problem.slug,
        title: problem.title,
        difficulty: problem.difficulty,
        url: problem.url,
        site: SITE,
      }),
      cfg.problem_pool.version,
      cfg.config_version,
      MODULE_VERSION,
      ctx.now,
    )
    .run();
  return getPeriod(ctx, periodId);
}

function publicPeriod(p) {
  return {
    period_id: p.period_id,
    starts_at: p.starts_at,
    ends_at: p.ends_at,
    timezone: p.timezone,
    problem: p.problem,
    pool_version: p.pool_version,
    config_version: p.config_version,
  };
}

// The only period whose list can be browsed: the current one. A list closes for good when its
// period ends; nothing returns the members of a past period to anyone, that period's members
// included (docs/product.md, "No past lists").
function currentPeriodId(ctx) {
  return periodAt(ctx.now, ctx.config.schedule.timezone).period_id;
}

function listOpen(ctx, periodId) {
  return periodId === currentPeriodId(ctx);
}

// Statement marking the open list as changed, for writes that can affect it.
function openListsChanged(ctx) {
  return [ctx.lists.changed(currentPeriodId(ctx))];
}

function requirePeriodId(pid) {
  if (!isPeriodId(pid)) throw new HttpError(400, "invalid_request", L("周期标识不合法", "Invalid period id"));
  return pid;
}

// ---------- handlers ----------

async function getEnrollment(ctx) {
  const state = await loadState(ctx);
  const pending = state.pendingToken && state.pendingToken.expires_at > ctx.now ? state.pendingToken : null;
  return reply(ctx, {
    ok: true,
    challenge_id: ctx.challengeId,
    rules: RULES_TEXT,
    enrollment: state.enrollment && {
      status: state.enrollment.status,
      join_mode: state.enrollment.join_mode,
      join_mode_at: state.enrollment.join_mode_at,
    },
    binding: state.binding && {
      site: state.binding.site,
      username: await ctx.vault.open(usernameContext(ctx.userId), state.binding.username),
      version: state.binding.version,
      verified_at: state.binding.verified_at,
    },
    pending_binding: pending && {
      username: await ctx.vault.open(usernameContext(ctx.userId), pending.username),
      token: await ctx.vault.open(tokenContext(ctx.userId), pending.token),
      expires_at: pending.expires_at,
    },
    readiness: readiness(ctx, state),
    verification_paused: ctx.config.verification.paused,
  });
}

async function postEnrollment(ctx, request) {
  const body = await readJson(request);
  if (body.accept_rules !== true) throw new HttpError(400, "invalid_request", L("请先阅读并同意本挑战规则", "Please read and accept the challenge rules"));
  const state = await loadState(ctx);
  if (!state.profile.complete) {
    throw new HttpError(400, "profile_incomplete", L("请先补齐个人资料", "Please complete your profile first"), { missing_fields: state.profile.missing_fields });
  }
  const mode = joinModeFrom(body.join_mode);
  await ctx.db.batch([
    ctx.db.prepare(
      `INSERT INTO lc_enrollments (challenge_id, user_id, member_id, status, join_mode, join_mode_at, created_at, updated_at)
       VALUES (?1, ?2, ?3, 'active', ?4, ?5, ?5, ?5)
       ON CONFLICT (challenge_id, user_id) DO UPDATE SET
         status = 'active', join_mode = excluded.join_mode,
         join_mode_at = excluded.join_mode_at, updated_at = excluded.updated_at`,
      ctx.userId,
      crypto.randomUUID(),
      mode,
      ctx.now,
    ),
    // The lists only show members whose enrollment is active.
    ...openListsChanged(ctx),
  ]);
  return getEnrollment(ctx);
}

async function deleteEnrollment(ctx, url) {
  if (url.searchParams.get("purge") === "1") {
    await dataLifecycle.purgeUser(ctx);
    return reply(ctx, { ok: true, purged: true });
  }
  await ctx.db.batch([
    ctx.db.prepare(
      `UPDATE lc_enrollments SET status = 'withdrawn', join_mode = 'never', updated_at = ?3
       WHERE challenge_id = ?1 AND user_id = ?2`,
      ctx.userId,
      ctx.now,
    ),
    ctx.db.prepare(
      `UPDATE lc_memberships SET status = 'left', left_at = ?3
       WHERE challenge_id = ?1 AND user_id = ?2 AND status = 'active'`,
      ctx.userId,
      ctx.now,
    ),
    ...openListsChanged(ctx),
  ]);
  return getEnrollment(ctx);
}

const USERNAME_RE = /^[A-Za-z0-9_.-]{1,40}$/;

function bindingToken() {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const buf = new Uint8Array(10);
  crypto.getRandomValues(buf);
  return "uwcse-" + Array.from(buf, (b) => alphabet[b % alphabet.length]).join("");
}

async function startBinding(ctx, request) {
  const body = await readJson(request);
  const username = typeof body.username === "string" ? body.username.trim() : "";
  if (!USERNAME_RE.test(username)) throw new HttpError(400, "invalid_request", L("LeetCode 用户名格式不正确", "Invalid LeetCode username"));
  const norm = username.toLowerCase();
  const taken = await ctx.db
    .prepare(
      "SELECT 1 FROM lc_bindings WHERE challenge_id = ?1 AND site = ?2 AND username_hash = ?3 AND user_id != ?4",
      SITE,
      await usernameHash(ctx, norm),
      ctx.userId,
    )
    .first();
  if (taken) throw new HttpError(409, "account_taken", L("该 LeetCode 账号已被本挑战其他用户绑定", "That LeetCode account is already bound by another user in this challenge"));

  const token = bindingToken();
  const expires = ctx.now + ctx.config.verification.binding_token_ttl_minutes * 60_000;
  await ctx.db
    .prepare(
      `INSERT INTO lc_binding_tokens (challenge_id, user_id, site, username, token, expires_at, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT (challenge_id, user_id) DO UPDATE SET
         site = excluded.site, username = excluded.username, token = excluded.token,
         expires_at = excluded.expires_at, created_at = excluded.created_at`,
      ctx.userId,
      SITE,
      await ctx.vault.seal(usernameContext(ctx.userId), norm),
      await ctx.vault.seal(tokenContext(ctx.userId), token),
      expires,
      ctx.now,
    )
    .run();
  return reply(ctx, {
    ok: true,
    username: norm,
    token,
    expires_at: expires,
    instructions: L(
      `请登录 leetcode.com，在个人资料设置的 General 里打开 ReadMe（旧版叫 Summary），把 ${token} 加到任意位置并保存，然后点击“检查归属”。验证通过后可以把 ReadMe 改回原来的内容。`,
      `Sign in to leetcode.com, open ReadMe under General in your profile settings (Summary in the old layout), add ${token} anywhere in it, save, then click "Check ownership". Once verified you can put your ReadMe back the way it was.`,
    ),
  });
}

async function verifyBinding(ctx) {
  if (ctx.config.verification.paused) return reply(ctx, { ok: false, result: "provider_unavailable", paused: true, message: PAUSED });
  const ch = await ctx.db
    .prepare("SELECT * FROM lc_binding_tokens WHERE challenge_id = ?1 AND user_id = ?2", ctx.userId)
    .first();
  if (!ch || ch.expires_at <= ctx.now) {
    throw new HttpError(400, "token_expired", L("验证令牌不存在或已过期，请重新发起绑定", "The verification token is missing or expired; please start again"));
  }
  const norm = await ctx.vault.open(usernameContext(ctx.userId), ch.username);
  const token = await ctx.vault.open(tokenContext(ctx.userId), ch.token);
  const provider = getProvider(ctx, null);
  let prof;
  try {
    prof = await provider.profile(norm);
  } catch (err) {
    if (err instanceof ProviderError) {
      return reply(ctx, { ok: false, result: err.kind === "unavailable" ? "provider_unavailable" : "unverifiable", message: L(`暂时无法读取 LeetCode 资料：${err.message}`, `Cannot read the LeetCode profile right now: ${err.message}`) });
    }
    throw err;
  }
  if (!prof) return reply(ctx, { ok: false, result: "invalid_request", message: L("LeetCode 上找不到这个用户名", "No such LeetCode username") });
  if (prof.username.toLowerCase() !== norm) {
    return reply(ctx, { ok: false, result: "unverifiable", message: L("数据源返回的用户名与申请绑定的不一致", "The data source returned a different username than requested") });
  }
  if (!aboutContainsToken(provider, prof.about, token)) {
    return reply(ctx, { ok: false, result: "not_found", message: L("还没有在该账号的 ReadMe（个人简介）中找到验证令牌，保存后稍等片刻再试", "The token was not found in that account's ReadMe yet. Save it, wait a moment and try again.") });
  }

  try {
    await ctx.db.batch([
      ctx.db.prepare(
        `INSERT INTO lc_bindings (challenge_id, user_id, site, username, username_hash, version, verified_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6)
         ON CONFLICT (challenge_id, user_id) DO UPDATE SET
           site = excluded.site, username = excluded.username, username_hash = excluded.username_hash,
           version = lc_bindings.version + 1, verified_at = excluded.verified_at`,
        ctx.userId,
        SITE,
        await ctx.vault.seal(usernameContext(ctx.userId), prof.username),
        await usernameHash(ctx, norm),
        ctx.now,
      ),
      ctx.db.prepare("DELETE FROM lc_binding_tokens WHERE challenge_id = ?1 AND user_id = ?2", ctx.userId),
    ]);
  } catch (err) {
    if (/UNIQUE/i.test(String(err?.message))) {
      throw new HttpError(409, "account_taken", L("该 LeetCode 账号已被本挑战其他用户绑定", "That LeetCode account is already bound by another user in this challenge"));
    }
    throw err;
  }
  return reply(ctx, { ok: true, result: "verified", message: L("账号归属验证成功，现在可以把 ReadMe 改回原来的内容了", "Ownership verified. You can put your ReadMe back the way it was now.") });
}

async function myPeriodStatus(ctx, period) {
  const [completion, membership, lastAttempt] = await Promise.all([
    ctx.db
      .prepare(
        "SELECT accepted_at, verified_at FROM lc_completions WHERE challenge_id = ?1 AND period_id = ?2 AND user_id = ?3",
        period.period_id,
        ctx.userId,
      )
      .first(),
    ctx.db
      .prepare(
        "SELECT status, joined_at, left_at FROM lc_memberships WHERE challenge_id = ?1 AND period_id = ?2 AND user_id = ?3",
        period.period_id,
        ctx.userId,
      )
      .first(),
    ctx.db
      .prepare(
        `SELECT requested_at, result FROM lc_attempts
         WHERE challenge_id = ?1 AND period_id = ?2 AND user_id = ?3 ORDER BY requested_at DESC LIMIT 1`,
        period.period_id,
        ctx.userId,
      )
      .first(),
  ]);
  const cooldown = ctx.config.verification.cooldown_seconds * 1000;
  return {
    completion,
    membership,
    last_attempt: lastAttempt,
    cooldown_until: lastAttempt && !completion ? lastAttempt.requested_at + cooldown : 0,
  };
}

async function getCurrentPeriod(ctx) {
  const tz = ctx.config.schedule.timezone;
  const cur = periodAt(ctx.now, tz);
  const period = await ensurePeriod(ctx, cur.period_id);
  const state = await loadState(ctx);
  const ready = readiness(ctx, state);
  if (!period) {
    return reply(ctx, {
      ok: true,
      available: false,
      message: L("题库暂时没有可用题目，本挑战暂不可用", "No problems are available in the pool, so this challenge is unavailable"),
      period: { period_id: cur.period_id, starts_at: cur.starts_at, ends_at: cur.ends_at, timezone: tz },
      readiness: ready,
    });
  }
  const mine = await myPeriodStatus(ctx, period);
  return reply(ctx, {
    ok: true,
    available: true,
    server_time: ctx.now,
    period: publicPeriod(period),
    me: mine,
    readiness: ready,
    verification_paused: ctx.config.verification.paused,
  });
}

function verifyResult(ctx, result, message, extra = {}) {
  return reply(ctx, { ok: result === "verified", result, message, ...extra });
}

// Limits on starting a verification attempt: a per-user cooldown (thrown as 429) and a
// challenge-wide cap per minute (answered as provider_unavailable). Null when an attempt may start.
async function attemptLimitResponse(ctx, cooldownMs) {
  const last = await ctx.db
    .prepare("SELECT requested_at FROM lc_attempts WHERE challenge_id = ?1 AND user_id = ?2 ORDER BY requested_at DESC LIMIT 1", ctx.userId)
    .first();
  if (last && ctx.now - last.requested_at < cooldownMs) {
    const retryAfter = Math.max(1, Math.ceil((last.requested_at + cooldownMs - ctx.now) / 1000));
    throw new HttpError(429, "cooldown", L(`请 ${retryAfter} 秒后再检查`, `Please wait ${retryAfter} s before checking again`), { retry_after: retryAfter });
  }
  const recentChallenge = await ctx.db
    .prepare("SELECT COUNT(*) AS n FROM lc_attempts WHERE challenge_id = ?1 AND requested_at > ?2", ctx.now - 60_000)
    .first();
  if (recentChallenge.n >= ctx.config.verification.challenge_attempts_per_minute) {
    return verifyResult(ctx, "provider_unavailable", L("当前验证请求较多，请稍后再试", "Too many checks right now; please try again shortly"));
  }
  return null;
}

async function verifyPeriod(ctx, periodId, request) {
  await readJson(request); // a submission id may be passed as a hint; it proves nothing and is ignored
  const cfg = ctx.config;
  if (cfg.verification.paused) return verifyResult(ctx, "provider_unavailable", PAUSED, { paused: true });
  const state = await loadState(ctx);
  const ready = readiness(ctx, state);
  if (!ready.can_verify) {
    return verifyResult(ctx, "invalid_request", L("请先完成报名、补齐资料并验证 LeetCode 账号归属", "Enroll, complete your profile and verify your LeetCode account first"), { readiness: ready });
  }

  // Only the period that is current at request time accepts new verification requests.
  const cur = periodAt(ctx.now, cfg.schedule.timezone);
  if (periodId !== cur.period_id) return verifyResult(ctx, "invalid_request", L("该周期已关闭，不再接收新的验证请求", "This period is closed and no longer accepts checks"));
  const period = await ensurePeriod(ctx, periodId);
  if (!period) return verifyResult(ctx, "invalid_request", L("本挑战暂不可用", "This challenge is unavailable"));

  const done = await ctx.db
    .prepare(
      "SELECT accepted_at, verified_at FROM lc_completions WHERE challenge_id = ?1 AND period_id = ?2 AND user_id = ?3",
      periodId,
      ctx.userId,
    )
    .first();
  if (done) return verifyResult(ctx, "verified", L("本期已经验证完成", "Already verified for this period"), { completion: done, already: true });

  const cooldownMs = cfg.verification.cooldown_seconds * 1000;
  const busy = await attemptLimitResponse(ctx, cooldownMs);
  if (busy) return busy;

  // Lock the binding used for this period at the first attempt; later rebinds apply next period.
  // The username is sealed to this user, so the lock keeps the same sealed value.
  await ctx.db
    .prepare(
      `INSERT OR IGNORE INTO lc_period_locks (challenge_id, period_id, user_id, site, username, binding_version, locked_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      periodId,
      ctx.userId,
      state.binding.site,
      state.binding.username,
      state.binding.version,
      ctx.now,
    )
    .run();
  const lock = await ctx.db
    .prepare("SELECT * FROM lc_period_locks WHERE challenge_id = ?1 AND period_id = ?2 AND user_id = ?3", periodId, ctx.userId)
    .first();

  const provider = getProvider(ctx, period.problem.slug);
  if (provider.upstreamCallsPerAttempt > cfg.verification.max_upstream_requests_per_attempt) {
    throw new Error("provider exceeds max_upstream_requests_per_attempt");
  }
  // The checks above give friendly answers; this insert enforces the same limits atomically
  // (D1 runs statements one at a time), so concurrent requests cannot all slip past them.
  const attempt = await ctx.db
    .prepare(
      `INSERT INTO lc_attempts (challenge_id, period_id, user_id, binding_version, requested_at, source, source_version)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
       WHERE NOT EXISTS (SELECT 1 FROM lc_attempts WHERE challenge_id = ?1 AND user_id = ?3 AND requested_at > ?8)
         AND (SELECT COUNT(*) FROM lc_attempts WHERE challenge_id = ?1 AND requested_at > ?9) < ?10
       RETURNING id`,
      periodId,
      ctx.userId,
      lock.binding_version,
      ctx.now,
      provider.id,
      provider.version,
      ctx.now - cooldownMs,
      ctx.now - 60_000,
      cfg.verification.challenge_attempts_per_minute,
    )
    .first();
  if (!attempt) {
    // Another request claimed the slot between the checks above and this insert.
    return (
      (await attemptLimitResponse(ctx, cooldownMs)) ??
      verifyResult(ctx, "provider_unavailable", L("当前验证请求较多，请稍后再试", "Too many checks right now; please try again shortly"))
    );
  }

  // Evidence names the LeetCode account, so it is stored sealed.
  const finish = async (result, error, evidence = null) =>
    ctx.db.prepare(
      "UPDATE lc_attempts SET result = ?3, error = ?4, evidence = ?5, finished_at = ?6 WHERE challenge_id = ?1 AND id = ?2",
      attempt.id,
      result,
      error,
      evidence && (await ctx.vault.seal(evidenceContext(ctx.userId, attempt.id), evidence)),
      Date.now(),
    );
  const account = await ctx.vault.open(usernameContext(ctx.userId), lock.username);

  let items;
  try {
    ({ items } = await provider.recentAccepted(account));
  } catch (err) {
    if (!(err instanceof ProviderError)) throw err;
    const result = err.kind === "unavailable" ? "provider_unavailable" : "unverifiable";
    await (await finish(result, err.message)).run();
    return verifyResult(
      ctx,
      result,
      result === "provider_unavailable"
        ? L(
            `数据源暂时不可用（${err.message}），这不代表你没有完成，请稍后重试`,
            `The data source is unavailable (${err.message}). This does not mean you haven't finished; please try again later.`,
          )
        : L(
            `数据源返回的信息不足以判断（${err.message}），暂无法验证`,
            `The data source did not return enough to decide (${err.message}); cannot verify for now.`,
          ),
    );
  }

  // Settlement: an attempt accepted before the period closed may finish shortly after, but
  // only within the configured window, and only ever for the original period.
  if (Date.now() > period.ends_at + cfg.verification.closing_settlement_seconds * 1000) {
    await (await finish("invalid_request", "settlement window exceeded")).run();
    return verifyResult(ctx, "invalid_request", L("周期已结束且超过收尾时限，本次检查已终止", "The period ended and the settlement window passed; this check was stopped"));
  }

  const ev = findEvidence(items, period);
  if (!ev) {
    await (await finish("not_found", null, { checked: items.length })).run();
    return verifyResult(
      ctx,
      "not_found",
      L(
        "在该账号最近的 AC 记录中还没查到本期题目的当期提交。刚提交的话稍等一会儿再试；这不代表你一定没有做。",
        "No Accepted submission for this period's problem was found in the account's recent ACs yet. If you just submitted, wait a bit and retry; this doesn't necessarily mean you haven't solved it.",
      ),
    );
  }

  const evidence = {
    source: provider.id,
    source_version: provider.version,
    submission_id: ev.submission_id,
    account,
    problem_slug: ev.slug,
    status: ev.status,
    accepted_at: ev.accepted_at,
    fetched_at: Date.now(),
  };
  const stmts = [
    await finish("verified", null, evidence),
    ctx.db.prepare(
      `INSERT OR IGNORE INTO lc_completions
        (challenge_id, period_id, user_id, problem_slug, accepted_at, submission_id, source, attempt_id, verified_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
      periodId,
      ctx.userId,
      ev.slug,
      ev.accepted_at,
      ev.submission_id,
      provider.id,
      attempt.id,
      ctx.now,
    ),
    // Joins only with join_mode "always"; an existing row (including one the user left) is kept as
    // is. With "ask", the response below asks the client to offer joining.
    ctx.db.prepare(
      `INSERT OR IGNORE INTO lc_memberships (challenge_id, period_id, user_id, status, joined_at)
       SELECT ?1, ?2, ?3, 'active', ?4
       WHERE ?5 = 1 AND EXISTS (
         SELECT 1 FROM lc_enrollments WHERE challenge_id = ?1 AND user_id = ?3 AND status = 'active' AND join_mode = 'always')`,
      periodId,
      ctx.userId,
      ctx.now,
      cfg.completion.auto_join_after_verified_with_consent ? 1 : 0,
    ),
  ];
  if (cfg.badges.enabled) stmts.push(...badgeStatements(ctx, periodId));
  stmts.push(ctx.lists.changed(periodId));
  await ctx.db.batch(stmts);
  return verifyResult(ctx, "verified", L("验证通过！", "Verified!"), {
    evidence: { accepted_at: ev.accepted_at, source: provider.id },
    ask_to_join: state.enrollment.join_mode === "ask",
  });
}

function badgeStatements(ctx, periodId) {
  const stmts = [
    ctx.db.prepare(
      `INSERT OR IGNORE INTO lc_badges (challenge_id, user_id, rule, period_id, awarded_at)
       SELECT ?1, ?2, 'period_complete', ?3, ?4
       WHERE EXISTS (SELECT 1 FROM lc_completions WHERE challenge_id = ?1 AND period_id = ?3 AND user_id = ?2)`,
      ctx.userId,
      periodId,
      ctx.now,
    ),
  ];
  for (const n of ctx.config.badges.milestones) {
    stmts.push(
      ctx.db.prepare(
        `INSERT OR IGNORE INTO lc_badges (challenge_id, user_id, rule, period_id, awarded_at)
         SELECT ?1, ?2, ?3, ?4, ?5
         WHERE EXISTS (SELECT 1 FROM lc_completions WHERE challenge_id = ?1 AND period_id = ?4 AND user_id = ?2)
           AND (SELECT COUNT(*) FROM lc_completions WHERE challenge_id = ?1 AND user_id = ?2) >= ?6
           AND NOT EXISTS (SELECT 1 FROM lc_badges WHERE challenge_id = ?1 AND user_id = ?2 AND rule = ?3)`,
        ctx.userId,
        `milestone_${n}`,
        periodId,
        ctx.now,
        n,
      ),
    );
  }
  return stmts;
}

const NOT_MEMBER = L("你不在该期名单中，无法浏览", "You are not on this period's list, so you cannot browse it");

// Whether the user may browse this period's list: it is still open, they are enrolled with a
// complete profile, and they are an active member of that period themselves.
async function canBrowse(ctx, periodId, state) {
  if (!listOpen(ctx, periodId)) return false;
  if (state.enrollment?.status !== "active" || !state.profile.complete) return false;
  const mine = await ctx.db
    .prepare(
      "SELECT status FROM lc_memberships WHERE challenge_id = ?1 AND period_id = ?2 AND user_id = ?3",
      periodId,
      ctx.userId,
    )
    .first();
  return mine?.status === "active";
}

// Every active member of the period, in join order. Read through ctx.lists, so it is reloaded from
// D1 only after a write to this list (each such write includes ctx.lists.changed).
function activeRows(ctx, periodId) {
  return ctx.lists.cached(periodId, async () => {
    const rows = await ctx.db
      .prepare(
        `SELECT e.member_id, m.user_id
         FROM lc_memberships m
         JOIN lc_enrollments e ON e.challenge_id = m.challenge_id AND e.user_id = m.user_id
         WHERE m.challenge_id = ?1 AND m.period_id = ?2 AND m.status = 'active' AND e.status = 'active'
         ORDER BY m.joined_at ASC`,
        periodId,
      )
      .all();
    return rows.results;
  });
}

// Other active members of the period, in join order. Not yet filtered by relations.
async function memberRows(ctx, periodId) {
  return (await activeRows(ctx, periodId)).filter((r) => r.user_id !== ctx.userId);
}

// Members whose cards this user may see, filtered by shared relations and field settings.
async function visibleMembers(ctx, periodId) {
  const rows = await memberRows(ctx, periodId);
  const cards = await ctx.profiles.cards(ctx.userId, rows.map((r) => r.user_id));
  const visible = [];
  for (const row of rows) {
    const card = cards.get(row.user_id);
    if (card) visible.push({ card: { member_id: row.member_id, ...card }, user_id: row.user_id });
  }
  return visible;
}

async function getMembers(ctx, periodId, url) {
  if (!listOpen(ctx, periodId)) throw new HttpError(403, "list_closed", L("该期名单已关闭，只能查看自己的历史", "This period's list is closed; only your own history is available"));
  if (!(await canBrowse(ctx, periodId, await loadState(ctx)))) throw new HttpError(403, "not_member", NOT_MEMBER);
  const visible = await visibleMembers(ctx, periodId);

  const pageSize = ctx.config.members.page_size;
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const slice = visible.slice((page - 1) * pageSize, page * pageSize);

  if (ctx.config.badges.enabled && slice.length) {
    const ids = slice.map((v) => v.user_id);
    const badges = await ctx.db
      .prepare(
        `SELECT user_id, rule, COUNT(*) AS n FROM lc_badges
         WHERE challenge_id = ?1 AND user_id IN (${ids.map((_, i) => `?${i + 2}`).join(",")})
         GROUP BY user_id, rule`,
        ...ids,
      )
      .all();
    for (const v of slice) {
      v.card.badges = badges.results.filter((b) => b.user_id === v.user_id).map((b) => ({ rule: b.rule, count: b.n }));
    }
  }

  return reply(ctx, {
    ok: true,
    period_id: periodId,
    total: visible.length,
    page,
    page_size: pageSize,
    members: slice.map((v) => v.card), // user_id never leaves the server
  });
}

async function leaveMembership(ctx, periodId) {
  await ctx.db.batch([
    ctx.db.prepare(
      `UPDATE lc_memberships SET status = 'left', left_at = ?4
       WHERE challenge_id = ?1 AND period_id = ?2 AND user_id = ?3 AND status = 'active'`,
      periodId,
      ctx.userId,
      ctx.now,
    ),
    ctx.lists.changed(periodId),
  ]);
  return reply(ctx, { ok: true, status: "left", message: L("已退出本期展示；再次验证不会自动恢复", "You left this period's list; verifying again will not re-add you") });
}

async function rejoinMembership(ctx, periodId, request) {
  const body = await readJson(request);
  if (body.confirm !== true) throw new HttpError(400, "invalid_request", L("需要明确确认恢复展示", "Explicit confirmation is required to rejoin"));
  const cur = periodAt(ctx.now, ctx.config.schedule.timezone);
  if (periodId !== cur.period_id) throw new HttpError(400, "invalid_request", L("只能在当期恢复展示", "You can only rejoin the current period"));
  const state = await loadState(ctx);
  const ready = readiness(ctx, state);
  if (!ready.enrolled || !ready.profile_complete) {
    throw new HttpError(400, "profile_incomplete", L("请先完成报名并补齐个人资料", "Enroll and complete your profile first"));
  }
  const done = await ctx.db
    .prepare("SELECT 1 FROM lc_completions WHERE challenge_id = ?1 AND period_id = ?2 AND user_id = ?3", periodId, ctx.userId)
    .first();
  if (!done) throw new HttpError(400, "not_completed", L("本期尚未验证完成", "Not verified for this period yet"));
  await ctx.db.batch([
    ctx.db.prepare(
      `INSERT INTO lc_memberships (challenge_id, period_id, user_id, status, joined_at)
       VALUES (?1, ?2, ?3, 'active', ?4)
       ON CONFLICT (challenge_id, period_id, user_id) DO UPDATE SET status = 'active', left_at = NULL`,
      periodId,
      ctx.userId,
      ctx.now,
    ),
    ctx.lists.changed(periodId),
  ]);
  return reply(ctx, { ok: true, status: "active", message: L("已恢复本期展示", "You are back on this period's list") });
}

async function getHistory(ctx) {
  const rows = await ctx.db
    .prepare(
      `SELECT c.period_id, c.accepted_at, c.verified_at, p.problem
       FROM lc_completions c
       JOIN lc_periods p ON p.challenge_id = c.challenge_id AND p.period_id = c.period_id
       WHERE c.challenge_id = ?1 AND c.user_id = ?2
       ORDER BY c.period_id DESC LIMIT 100`,
      ctx.userId,
    )
    .all();
  const badges = ctx.config.badges.enabled
    ? (await ctx.db.prepare("SELECT rule, period_id, awarded_at FROM lc_badges WHERE challenge_id = ?1 AND user_id = ?2 ORDER BY awarded_at DESC", ctx.userId).all()).results
    : null;
  return reply(ctx, {
    ok: true,
    completions: rows.results.map((r) => ({ ...r, problem: JSON.parse(r.problem) })),
    badges,
  });
}

// ---------- people for the home page ----------

// Users this viewer may browse right now through this module's open list (the current period
// only). Server-side only: the platform merges these across challenges and builds the filtered
// cards, so user ids never reach the browser.
async function browsableUserIds(ctx) {
  const periodId = currentPeriodId(ctx);
  if (!(await canBrowse(ctx, periodId, await loadState(ctx)))) return [];
  return (await memberRows(ctx, periodId)).map((r) => r.user_id);
}

// ---------- routing ----------

async function handleRequest(request, ctx, parts) {
  const url = new URL(request.url);
  const m = request.method;
  const [a, b, c] = parts;

  if (a === "enrollment" && !b) {
    if (m === "GET") return getEnrollment(ctx);
    if (m === "POST") return postEnrollment(ctx, request);
    if (m === "DELETE") return deleteEnrollment(ctx, url);
  }
  if (a === "binding" && b === "start" && m === "POST") return startBinding(ctx, request);
  if (a === "binding" && b === "verify" && m === "POST") return verifyBinding(ctx);
  if (a === "history" && !b && m === "GET") return getHistory(ctx);
  if (a === "periods" && b === "current" && !c && m === "GET") return getCurrentPeriod(ctx);
  if (a === "periods" && b && parts.length === 3) {
    const pid = requirePeriodId(b);
    if (c === "verify" && m === "POST") return verifyPeriod(ctx, pid, request);
    if (c === "members" && m === "GET") return getMembers(ctx, pid, url);
    if (c === "membership" && m === "DELETE") return leaveMembership(ctx, pid);
    if (c === "membership" && m === "POST") return rejoinMembership(ctx, pid, request);
  }
  throw new HttpError(404, "not_found", L("接口不存在", "Not found"));
}

// ---------- data lifecycle ----------

const dataLifecycle = {
  data_version: 1,
  // Removes this user's business data in this challenge only.
  async purgeUser(ctx) {
    const tables = [
      "lc_badges",
      "lc_memberships",
      "lc_completions",
      "lc_attempts",
      "lc_period_locks",
      "lc_binding_tokens",
      "lc_bindings",
      "lc_enrollments",
    ];
    await ctx.db.batch([
      ...tables.map((t) => ctx.db.prepare(`DELETE FROM ${t} WHERE challenge_id = ?1 AND user_id = ?2`, ctx.userId)),
      ...openListsChanged(ctx),
    ]);
  },
  // Daily clean-up (Cron Trigger): rows no request reads once their time is over. Expired binding
  // tokens; closed lists (docs/product.md, "No past lists"); the binding locks of periods whose
  // list has closed (they only serve that period's checks); and attempts, which only the
  // cooldown, the per-minute cap and the current period's status read, kept
  // ATTEMPT_RETENTION_DAYS so a disputed check can still be looked into. Completions, badges and
  // periods are the user's history and stay.
  async prune(ctx) {
    const oldestOpen = currentPeriodId(ctx);
    await ctx.db.batch([
      ctx.db.prepare("DELETE FROM lc_binding_tokens WHERE challenge_id = ?1 AND expires_at <= ?2", ctx.now),
      ctx.db.prepare("DELETE FROM lc_memberships WHERE challenge_id = ?1 AND period_id < ?2", oldestOpen),
      ctx.db.prepare("DELETE FROM lc_period_locks WHERE challenge_id = ?1 AND period_id < ?2", oldestOpen),
      ctx.db.prepare("DELETE FROM lc_attempts WHERE challenge_id = ?1 AND requested_at < ?2", ctx.now - ATTEMPT_RETENTION_DAYS * 86400_000),
      ctx.lists.forgetBefore(oldestOpen),
    ]);
  },
  // Disabling a challenge (enabled: false) stops new participation; data is retained until purged.
  onDisable: "retain",
};

export default {
  manifest,
  validateConfig,
  describeSchedule,
  handleRequest,
  browsableUserIds,
  dataLifecycle,
};
