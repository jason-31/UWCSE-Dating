import { HttpError, L, json, localize, readJson } from "../../platform/http.js";
import { periodAt, addDays, isPeriodId } from "../../platform/period.js";
import { joinModeFrom } from "../../platform/join-mode.js";

// Daily check-in: the period's task is simply to check in; there is no external evidence to
// verify. Whether checking in also puts you on that period's list is a per-user setting
// (join_mode, src/platform/join-mode.js; "always" by default, shown before you check in): with
// "ask" the check-in itself carries the answer, with "never" you can still join by hand.
// Lists are per period and close when the period ends. Check-ins (ci_checkins) are the user's
// history and streak; who is on a list (ci_lists) is kept only while that list is open.

const MODULE_VERSION = 1;

const manifest = {
  module_id: "checkin",
  module_version: MODULE_VERSION,
  api_version: 1,
  name: L("每日签到", "Daily Check-in"),
  description: L(
    "每天签到一次，签到后就进入当天名单，看看今天还有谁也来了。",
    "Check in once a day to join that day's list and see who else showed up.",
  ),
  frontend: "/modules/checkin/app.js",
  table_prefix: "ci_",
  env: [],
};

const RULES_TEXT = [
  L(
    "每天（按本挑战时区 0 点起）为一期。“自动进入本期 list”可选总是加入（默认）、每次询问或总是不加入。进入名单表示你愿意出现在当期名单里，并会按你的个人资料展示；不进入时只记录签到，之后可以手动加入。",
    "Each day (from midnight in this challenge's time zone) is one period. \"Join this period's list automatically\" can be always (the default), ask each time, or never. Being on the list means you want to appear on it, shown according to your profile; otherwise only the check-in is recorded and you can join by hand later.",
  ),
  L(
    "只有当期已签到并在名单中的人能浏览名单，且只能看到与自己寻找相同关系的成员。",
    "Only people checked in and on the current list can browse it, and only members looking for a relationship type you share are shown.",
  ),
  L(
    "每期名单独立，不继承前一天的签到；这一期结束，名单就关闭。",
    "Each period's list is separate and doesn't carry over; it closes when the period ends.",
  ),
  L(
    "你可以随时退出当期名单，同一期内也可以再次加入。",
    "You can leave the current list at any time and rejoin during the same period.",
  ),
];

function reply(ctx, data, status) {
  return json(localize(data, ctx.lang), status);
}

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
  if (!(cfg.members?.page_size > 0)) fail("members.page_size must be positive");
  return Object.freeze(cfg);
}

function describeSchedule(cfg) {
  const tz = cfg.schedule.timezone;
  return L(`每天 0 点（${tz}）刷新`, `Refreshes daily at midnight (${tz})`);
}

function currentPeriod(ctx) {
  return periodAt(ctx.now, ctx.config.schedule.timezone);
}

function requirePeriodId(pid) {
  if (!isPeriodId(pid)) throw new HttpError(400, "invalid_request", L("周期标识不合法", "Invalid period id"));
  return pid;
}

// The user's check-in preferences, with defaults for anyone who never changed them.
async function getSettings(ctx) {
  const row = await ctx.db.prepare("SELECT join_mode FROM ci_settings WHERE challenge_id = ?1 AND user_id = ?2", ctx.userId).first();
  return { join_mode: row?.join_mode ?? "always" };
}

async function putSettings(ctx, request) {
  const body = await readJson(request);
  const mode = joinModeFrom(body.join_mode);
  await ctx.db
    .prepare(
      `INSERT INTO ci_settings (challenge_id, user_id, join_mode, updated_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (challenge_id, user_id) DO UPDATE SET join_mode = excluded.join_mode, updated_at = excluded.updated_at`,
      ctx.userId,
      mode,
      ctx.now,
    )
    .run();
  return reply(ctx, { ok: true, settings: await getSettings(ctx) });
}

// status "left" means checked in but not on the list: the user left it, or chose not to join.
async function myCheckin(ctx, periodId) {
  return ctx.db
    .prepare(
      `SELECT c.checked_in_at, COALESCE(l.status, 'left') AS status
       FROM ci_checkins c
       LEFT JOIN ci_lists l ON l.challenge_id = c.challenge_id AND l.period_id = c.period_id AND l.user_id = c.user_id
       WHERE c.challenge_id = ?1 AND c.period_id = ?2 AND c.user_id = ?3`,
      periodId,
      ctx.userId,
    )
    .first();
}

// Only the current period's list is open, and only to people actively on it.
async function canBrowse(ctx, periodId) {
  if (periodId !== currentPeriod(ctx).period_id) return false;
  if (!(await ctx.profiles.status(ctx.userId)).complete) return false;
  return (await myCheckin(ctx, periodId))?.status === "active";
}

// Everyone on the period's list, in join order. Read through ctx.lists, so it is reloaded from
// D1 only after a write to this list (each write below includes ctx.lists.changed(periodId)).
function activeRows(ctx, periodId) {
  return ctx.lists.cached(periodId, async () => {
    const rows = await ctx.db
      .prepare(
        `SELECT member_id, user_id FROM ci_lists
         WHERE challenge_id = ?1 AND period_id = ?2 AND status = 'active'
         ORDER BY joined_at ASC`,
        periodId,
      )
      .all();
    return rows.results;
  });
}

// The other active members of the period, in join order.
async function memberRows(ctx, periodId) {
  return (await activeRows(ctx, periodId)).filter((r) => r.user_id !== ctx.userId);
}

// ---------- handlers ----------

async function getCurrent(ctx) {
  const cur = currentPeriod(ctx);
  const [profile, mine, active, rows, settings] = await Promise.all([
    ctx.profiles.status(ctx.userId),
    myCheckin(ctx, cur.period_id),
    activeRows(ctx, cur.period_id),
    checkinRows(ctx),
    getSettings(ctx),
  ]);
  return reply(ctx, {
    ok: true,
    rules: RULES_TEXT,
    profile_complete: profile.complete,
    period: { period_id: cur.period_id, starts_at: cur.starts_at, ends_at: cur.ends_at, timezone: ctx.config.schedule.timezone },
    checkin: mine,
    checked_in_count: active.length,
    streak: streakFrom(rows.map((r) => r.period_id), cur.period_id),
    settings,
  });
}

async function requireCurrentAndProfile(ctx, periodId) {
  if (periodId !== currentPeriod(ctx).period_id) {
    throw new HttpError(400, "invalid_request", L("只能操作当期", "Only the current period can be changed"));
  }
  if (!(await ctx.profiles.status(ctx.userId)).complete) {
    throw new HttpError(400, "profile_incomplete", L("请先补齐个人资料", "Please complete your profile first"));
  }
}

// Check in for the current period. Joins the list with join_mode "always", or with "ask" when
// the request says { join: true }; "ask" without an answer is refused, so nobody is listed (or
// left off) by accident. Checking in again changes nothing.
async function checkIn(ctx, periodId, request) {
  await requireCurrentAndProfile(ctx, periodId);
  const body = await readJson(request);
  const { join_mode: mode } = await getSettings(ctx);
  if (mode === "ask" && typeof body.join !== "boolean") {
    throw new HttpError(400, "invalid_request", L("请选择是否进入本期 list", "Choose whether to join this period's list"));
  }
  const listed = mode === "always" || (mode === "ask" && body.join);
  await ctx.db.batch([
    // Runs before the check-in insert, so only a first check-in joins the list.
    ...(listed
      ? [
          ctx.db.prepare(
            `INSERT INTO ci_lists (challenge_id, period_id, user_id, member_id, status, joined_at)
             SELECT ?1, ?2, ?3, ?4, 'active', ?5
             WHERE NOT EXISTS (SELECT 1 FROM ci_checkins WHERE challenge_id = ?1 AND period_id = ?2 AND user_id = ?3)`,
            periodId,
            ctx.userId,
            crypto.randomUUID(),
            ctx.now,
          ),
        ]
      : []),
    ctx.db.prepare(
      `INSERT INTO ci_checkins (challenge_id, period_id, user_id, checked_in_at)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (challenge_id, period_id, user_id) DO NOTHING`,
      periodId,
      ctx.userId,
      ctx.now,
    ),
    ctx.lists.changed(periodId),
  ]);
  return reply(ctx, {
    ok: true,
    message: listed
      ? L("签到成功，已进入本期 list！", "Checked in and added to this period's list!")
      : L("签到成功！", "Checked in!"),
  });
}

// Join the current period's list after checking in (not joined at check-in, or after leaving).
async function join(ctx, periodId) {
  await requireCurrentAndProfile(ctx, periodId);
  const [res] = await ctx.db.batch([
    ctx.db.prepare(
      `INSERT INTO ci_lists (challenge_id, period_id, user_id, member_id, status, joined_at)
       SELECT ?1, ?2, ?3, ?4, 'active', ?5
       WHERE EXISTS (SELECT 1 FROM ci_checkins WHERE challenge_id = ?1 AND period_id = ?2 AND user_id = ?3)
       ON CONFLICT (challenge_id, period_id, user_id) DO UPDATE SET status = 'active', left_at = NULL`,
      periodId,
      ctx.userId,
      crypto.randomUUID(),
      ctx.now,
    ),
    ctx.lists.changed(periodId),
  ]);
  if (!res.meta.changes) throw new HttpError(400, "not_checked_in", L("请先签到", "Please check in first"));
  return reply(ctx, { ok: true, status: "active", message: L("已加入本期名单", "You joined this period's list") });
}

async function leave(ctx, periodId) {
  await ctx.db.batch([
    ctx.db.prepare(
      `UPDATE ci_lists SET status = 'left', left_at = ?4
       WHERE challenge_id = ?1 AND period_id = ?2 AND user_id = ?3 AND status = 'active'`,
      periodId,
      ctx.userId,
      ctx.now,
    ),
    ctx.lists.changed(periodId),
  ]);
  return reply(ctx, {
    ok: true,
    status: "left",
    message: L("已退出本期名单；本期内可以再次加入", "You left this period's list; you can rejoin this period"),
  });
}

async function getMembers(ctx, periodId, url) {
  if (periodId !== currentPeriod(ctx).period_id) {
    throw new HttpError(403, "list_closed", L("该期名单已关闭", "This period's list is closed"));
  }
  if (!(await canBrowse(ctx, periodId))) {
    throw new HttpError(403, "not_member", L("你不在该期名单中，无法浏览", "You are not on this period's list, so you cannot browse it"));
  }
  const rows = await memberRows(ctx, periodId);
  const cards = await ctx.profiles.cards(ctx.userId, rows.map((r) => r.user_id));
  const visible = rows.flatMap((r) => (cards.get(r.user_id) ? [{ member_id: r.member_id, ...cards.get(r.user_id) }] : []));
  const pageSize = ctx.config.members.page_size;
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  return reply(ctx, {
    ok: true,
    period_id: periodId,
    total: visible.length,
    page,
    page_size: pageSize,
    members: visible.slice((page - 1) * pageSize, page * pageSize),
  });
}

// Consecutive check-in days ending today, or ending yesterday if today isn't checked in yet
// (the streak isn't broken until the day is over). Checking in without being on the list counts.
export function streakFrom(periodIds, today) {
  const days = new Set(periodIds);
  let day = days.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (days.has(day)) {
    streak++;
    day = addDays(day, -1);
  }
  return streak;
}

async function checkinRows(ctx) {
  const rows = await ctx.db
    .prepare(
      `SELECT period_id, checked_in_at FROM ci_checkins
       WHERE challenge_id = ?1 AND user_id = ?2 ORDER BY period_id DESC LIMIT 366`,
      ctx.userId,
    )
    .all();
  return rows.results;
}

// Check-in days, newest first, with the current streak.
async function getHistory(ctx) {
  const rows = await checkinRows(ctx);
  const streak = streakFrom(rows.map((r) => r.period_id), currentPeriod(ctx).period_id);
  return reply(ctx, { ok: true, total: rows.length, streak, checkins: rows });
}

async function handleRequest(request, ctx, parts) {
  const url = new URL(request.url);
  const m = request.method;
  const [a, b, c] = parts;
  if (a === "periods" && b === "current" && !c && m === "GET") return getCurrent(ctx);
  if (a === "history" && !b && m === "GET") return getHistory(ctx);
  if (a === "settings" && !b && m === "GET") return reply(ctx, { ok: true, settings: await getSettings(ctx) });
  if (a === "settings" && !b && m === "PUT") return putSettings(ctx, request);
  if (a === "data" && !b && m === "DELETE") {
    await dataLifecycle.purgeUser(ctx);
    return reply(ctx, { ok: true, purged: true });
  }
  if (a === "periods" && b && parts.length === 3) {
    const pid = requirePeriodId(b);
    if (c === "checkin" && m === "POST") return checkIn(ctx, pid, request);
    if (c === "membership" && m === "POST") return join(ctx, pid);
    if (c === "membership" && m === "DELETE") return leave(ctx, pid);
    if (c === "members" && m === "GET") return getMembers(ctx, pid, url);
  }
  throw new HttpError(404, "not_found", L("接口不存在", "Not found"));
}

// Server-side only; merged by the platform for the home page.
async function browsableUserIds(ctx) {
  const pid = currentPeriod(ctx).period_id;
  if (!(await canBrowse(ctx, pid))) return [];
  return (await memberRows(ctx, pid)).map((r) => r.user_id);
}

const dataLifecycle = {
  data_version: 1,
  async purgeUser(ctx) {
    await ctx.db.batch([
      ...["ci_lists", "ci_checkins", "ci_settings"].map((t) => ctx.db.prepare(`DELETE FROM ${t} WHERE challenge_id = ?1 AND user_id = ?2`, ctx.userId)),
      // Only the current period's list can be browsed.
      ctx.lists.changed(currentPeriod(ctx).period_id),
    ]);
  },
  // Daily clean-up (Cron Trigger): closed lists, with their cache version rows; nothing may return
  // them anyway (docs/product.md, "No past lists"). Check-ins stay: they are the user's history
  // and streak.
  async prune(ctx) {
    const open = currentPeriod(ctx).period_id;
    await ctx.db.batch([
      ctx.db.prepare("DELETE FROM ci_lists WHERE challenge_id = ?1 AND period_id < ?2", open),
      ctx.lists.forgetBefore(open),
    ]);
  },
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
