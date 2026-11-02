import { identify, findUser, effectiveEnv } from "./platform/auth.js";
import { googleEnabled, startLogin, finishLogin, logout, deleteSessions } from "./platform/google-auth.js";
import { HttpError, L, json, localize, requestLang, errorResponse, asHttpError, checkCsrf, readJson } from "./platform/http.js";
import { scopedDb } from "./platform/scoped-db.js";
import {
  profileSchema,
  validateProfile,
  missingRequired,
  getProfile,
  upsertProfileStatement,
  checkLockedChanges,
  lockedUntil,
  profileService,
  profilesChangedStatement,
  emailAllowed,
} from "./platform/profile.js";
import { listCache } from "./platform/cache.js";
import { enforceRateLimit, apiLimiter, clientIp } from "./platform/rate-limit.js";
import { assertMayRegister, tombstoneStatements } from "./platform/deletions.js";
import { pruneExpired } from "./platform/retention.js";
import { isBanned, applyBanRequests } from "./platform/bans.js";
import { vault, emailHash } from "./platform/vault.js";
import { uploadAvatar, serveAvatar, assertAvatarOwned, pruneAvatars, deleteAllAvatars, avatarUrl } from "./platform/avatars.js";
import { SITE } from "./site.config.js";
import { CHALLENGES } from "./challenges.config.js";
import leetcode from "./modules/leetcode/index.js";
import checkin from "./modules/checkin/index.js";

const MODULES = Object.fromEntries([leetcode, checkin].map((m) => [m.manifest.module_id, m]));
const PLATFORM_API_VERSION = 1;
// People per relation section on the home page, and per "show more" request.
const PEOPLE_PAGE_SIZE = 24;

function loadChallenges() {
  const out = new Map();
  for (const cfg of CHALLENGES) {
    const mod = MODULES[cfg.module_id];
    if (!mod) throw new Error(`challenge ${cfg.challenge_id}: unknown module ${cfg.module_id}`);
    if (mod.manifest.api_version !== PLATFORM_API_VERSION) {
      throw new Error(`module ${cfg.module_id} targets api_version ${mod.manifest.api_version}`);
    }
    out.set(cfg.challenge_id, { config: mod.validateConfig(cfg), module: mod });
  }
  return out;
}

const challenges = loadChallenges();

export default {
  async fetch(request, rawEnv) {
    const env = effectiveEnv(request, rawEnv);
    const url = new URL(request.url);
    const lang = requestLang(request);
    if (url.pathname === "/auth/login" || url.pathname === "/auth/callback") {
      if (!googleEnabled(env) || request.method !== "GET") return new Response("Not found", { status: 404 });
      try {
        await enforceRateLimit(env.RL_AUTH, `ip:${clientIp(request)}`);
        return await (url.pathname === "/auth/login" ? startLogin : finishLogin)(request, env, url, Date.now());
      } catch (err) {
        // Sign-in pages are navigations: send the browser back to the site with a message.
        const code = asHttpError(err)?.code;
        if (code === "rate_limited" || code === "daily_capacity") {
          return new Response(null, { status: 302, headers: { location: `/?login_error=${code}#/`, "cache-control": "no-store" } });
        }
        return errorResponse(err, lang);
      }
    }
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      return await handleApi(request, env, url, lang);
    } catch (err) {
      return errorResponse(err, lang);
    }
  },

  // Cron Triggers (wrangler.jsonc): every BAN_REQUESTS_CRON run applies queued ban requests; the
  // daily run also does the clean-up (platform tables, then each challenge's own prune).
  async scheduled(controller, env) {
    const now = Date.now();
    const steps = [["bans", () => applyBanRequests(env, now)]];
    if (controller.cron !== BAN_REQUESTS_CRON) {
      steps.push(["platform", () => pruneExpired(env, now)]);
      for (const entry of challenges.values()) {
        const prune = entry.module.dataLifecycle.prune;
        if (prune) steps.push([entry.config.challenge_id, () => prune(moduleContext(entry, env, { userId: null, now, lang: "en", profiles: null }))]);
      }
    }
    await runSteps(steps);
  },
};

const BAN_REQUESTS_CRON = "*/5 * * * *";

// Every step runs even if an earlier one failed; failures are logged by step name only and fail
// the run, so they show in the Cron log.
async function runSteps(steps) {
  const failed = [];
  for (const [name, run] of steps) {
    try {
      await run();
    } catch (err) {
      console.error(`scheduled step ${name} failed:`, err?.message);
      failed.push(name);
    }
  }
  if (failed.length) throw new Error(`scheduled run failed: ${failed.join(", ")}`);
}

function profileConfig(env) {
  const domains = env.ALLOWED_EMAIL_DOMAINS
    ? env.ALLOWED_EMAIL_DOMAINS.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
    : SITE.profile.allowed_email_domains;
  return { ...SITE.profile, allowed_email_domains: domains };
}

// Restricted context for one challenge: its own config and namespace, profile access that only
// yields completeness and filtered cards (one service per request, shared by every module), the
// versioned cache for its member lists, and sealing under purposes prefixed with its id.
function moduleContext(entry, env, { userId, now, lang, profiles }) {
  const { module, config } = entry;
  return {
    challengeId: config.challenge_id,
    config,
    userId,
    now,
    lang, // "zh" | "en"; modules localize their own messages
    db: scopedDb(env.DB, config.challenge_id, module.manifest.table_prefix),
    profiles,
    lists: listCache(env.DB, config.challenge_id),
    vault: moduleVault(env, config.challenge_id),
    // Only the env entries this module declared.
    env: Object.fromEntries(module.manifest.env.map((k) => [k, env[k]])),
  };
}

// A module's view of src/platform/vault.js: contexts and purposes are prefixed with the challenge
// id, so a module can neither open another one's values nor produce matching hashes.
function moduleVault(env, challengeId) {
  const v = vault(env);
  return {
    seal: (context, value) => v.seal(`${challengeId}:${context}`, value),
    open: (context, text) => v.open(`${challengeId}:${context}`, text),
    lookup: (purpose, text) => v.lookup(`${challengeId}:${purpose}`, text),
  };
}

function publicProfile(p) {
  return (
    p && {
      email: p.email,
      nickname: p.nickname,
      gender: p.gender,
      avatar: p.avatar,
      avatar_url: avatarUrl(p.avatar),
      relations: p.relations,
      relation_filters: p.relation_filters,
      relation_notes: p.relation_notes,
      wechat: p.wechat,
      discord: p.discord,
      bio: p.bio,
      program: p.program,
      research: p.research,
      visibility: p.visibility,
      schema_version: p.schema_version,
      updated_at: p.updated_at,
    }
  );
}

async function handleApi(request, env, url, lang) {
  checkCsrf(request);
  const now = Date.now();
  // Logging out must work even when the session is already gone.
  if (request.method === "POST" && url.pathname === "/api/logout") return logout(request, env);
  const parts = url.pathname.split("/").filter(Boolean); // ["api", ...]
  const route = `${request.method} /${parts.slice(1).join("/")}`;
  const auth = googleEnabled(env) ? "google" : "access";
  const devMode = env.DEV_MODE === "1";
  let email, knownBan;
  try {
    ({ email, banned: knownBan } = await identify(request, env, now));
  } catch (err) {
    // /api/me answers "not signed in" instead of failing, so the page can offer sign-in.
    if (route === "GET /me" && err.code === "unauthenticated") return json({ ok: true, signed_in: false, auth, dev_mode: devMode });
    throw err;
  }
  // Per-user request limits, checked before any further database work.
  await enforceRateLimit(apiLimiter(env, request.method, parts), `user:${email}`);
  const profileCfg = profileConfig(env);
  const profiles = profileService(env, profileCfg);

  // Google sessions report the ban with the session lookup; other identity sources need a query.
  const banned = knownBan ?? (await isBanned(env, email));

  // Uploaded avatars are the most frequent request (one per card image) and need no user row,
  // so they are answered before the user lookup.
  if (request.method === "GET" && parts[1] === "avatars" && parts.length === 3) {
    if (banned) throw new HttpError(403, "banned", L("此账号已被封禁", "This account has been banned"));
    return serveAvatar(env, parts[2]);
  }

  const userId = await findUser(env, email);

  if (route === "GET /me") {
    const missing = userId ? missingRequired(await getProfile(env, userId), profileCfg) : null;
    return json({
      ok: true,
      signed_in: true,
      banned,
      email,
      registered: !!userId,
      email_allowed: emailAllowed(email, profileCfg.allowed_email_domains),
      profile_complete: !!userId && missing.length === 0,
      dev_mode: devMode,
      auth,
      server_time: now,
    });
  }

  // A banned email can only sign out (handled above) or delete its account and data.
  if (banned && route !== "DELETE /account") {
    throw new HttpError(403, "banned", L("此账号已被封禁", "This account has been banned"));
  }

  if (route === "GET /profile/schema") {
    return json({ ok: true, schema: localize(profileSchema(profileCfg), lang) });
  }

  // Avatar uploads come before registration so people can pick one while registering. The body
  // is the image itself, already cropped and re-encoded by the browser.
  if (route === "POST /avatars") {
    if (!emailAllowed(email, profileCfg.allowed_email_domains)) {
      throw new HttpError(403, "email_not_allowed", L("该邮箱不能上传头像", "This email cannot upload avatars"));
    }
    // The avatar is basic info: while its 30-day change lock runs, an upload could never be saved.
    const basicLockedUntil = userId ? lockedUntil(await getProfile(env, userId), profileCfg).basic : 0;
    return json({ ok: true, ...(await uploadAvatar(env, request, email, now, { basicLockedUntil })) });
  }

  // Registration creates the identity and the site-wide profile together. The email is the
  // Access login email and cannot be chosen.
  if (route === "POST /register") {
    if (userId) throw new HttpError(409, "already_registered", L("该邮箱已经注册", "This email is already registered"));
    if (!emailAllowed(email, profileCfg.allowed_email_domains)) {
      const domains = profileCfg.allowed_email_domains;
      throw new HttpError(
        403,
        "email_not_allowed",
        L(`只接受以下域名的邮箱注册：${domains.join("、")}`, `Only emails from these domains can register: ${domains.join(", ")}`),
      );
    }
    const body = await readJson(request);
    if (body.accept_terms !== true) throw new HttpError(400, "invalid_request", L("请先阅读并同意网站规则", "Please read and accept the site rules"));
    const p = validateProfile(body.profile || {}, profileCfg);
    await assertMayRegister(env, email, now); // a recently deleted account must wait out its locks
    await assertAvatarOwned(env, email, p.avatar);
    const id = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO users (id, email_hash, created_at, terms_accepted_at) VALUES (?, ?, ?, ?)").bind(id, await emailHash(env, email), now, now),
      await upsertProfileStatement(env, id, email, p, null, profileCfg, now),
      profilesChangedStatement(env.DB),
    ]);
    await pruneAvatars(env, email);
    return json({ ok: true, profile: publicProfile(await getProfile(env, id)) });
  }

  // Deletes the account: every challenge purges its own data, then avatars, then the profile and
  // identity, then sessions. The users row goes last but one, so if any step fails the person is
  // still registered and can simply retry. While a profile change lock is still running, a
  // tombstone keeps the same email from registering again until it would have expired.
  if (route === "DELETE /account") {
    // A signed-in email that never registered (banned or not) has only uploads and sessions.
    if (!userId) {
      await deleteAllAvatars(env, email);
      await deleteSessions(env, email);
      return json({ ok: true, deleted: true });
    }
    const profile = await getProfile(env, userId);
    for (const entry of challenges.values()) {
      await entry.module.dataLifecycle.purgeUser(moduleContext(entry, env, { userId, now, lang, profiles }));
    }
    await deleteAllAvatars(env, email);
    await env.DB.batch([
      ...(await tombstoneStatements(env, email, profile, profileCfg, now)),
      env.DB.prepare("DELETE FROM profiles WHERE user_id = ?").bind(userId),
      env.DB.prepare("DELETE FROM users WHERE id = ?").bind(userId),
      profilesChangedStatement(env.DB),
    ]);
    await deleteSessions(env, email);
    return json({ ok: true, deleted: true });
  }

  if (!userId) throw new HttpError(403, "not_registered", L("该邮箱尚未注册，请先完成注册", "This email is not registered yet; please register first"));

  if (route === "GET /profile") {
    const p = await getProfile(env, userId);
    return json({
      ok: true,
      schema: localize(profileSchema(profileCfg), lang),
      profile: publicProfile(p),
      missing_fields: missingRequired(p, profileCfg),
      locked_until: lockedUntil(p, profileCfg),
    });
  }

  if (route === "PUT /profile") {
    const p = validateProfile(await readJson(request), profileCfg);
    await assertAvatarOwned(env, email, p.avatar);
    const current = await getProfile(env, userId);
    checkLockedChanges(current, p, profileCfg, now);
    await env.DB.batch([await upsertProfileStatement(env, userId, email, p, current, profileCfg, now), profilesChangedStatement(env.DB)]);
    await pruneAvatars(env, email); // drop an upload the profile no longer uses
    return json({ ok: true, profile: publicProfile(await getProfile(env, userId)) });
  }

  if (route === "GET /challenges") {
    const list = [...challenges.values()]
      .filter((s) => s.config.enabled)
      .map((s) => ({
        challenge_id: s.config.challenge_id,
        module_id: s.module.manifest.module_id,
        name: s.module.manifest.name,
        description: s.module.manifest.description,
        refresh_rule: s.module.describeSchedule(s.config),
        frontend: s.module.manifest.frontend,
      }));
    return json({ ok: true, challenges: localize(list, lang) });
  }

  // Everyone this user can browse right now, merged across all challenges' open lists and
  // de-duplicated, in one section per relation the viewer seeks. Which challenge or list made
  // someone visible is deliberately not returned. Each section returns its first
  // PEOPLE_PAGE_SIZE people; ?relation=<R>&offset=<n> returns the next ones of one section.
  if (route === "GET /people") {
    const ids = [];
    for (const entry of challenges.values()) {
      if (!entry.config.enabled || !entry.module.browsableUserIds) continue;
      ids.push(...(await entry.module.browsableUserIds(moduleContext(entry, env, { userId, now, lang, profiles }))));
    }
    const unique = [...new Set(ids)].filter((id) => id !== userId);
    const cards = await profiles.cards(userId, unique);
    const people = unique.map((id) => cards.get(id)).filter(Boolean);
    const relations = await profiles.relations(userId);
    const inRelation = (rel) => people.filter((m) => m.common_relations.includes(rel));
    const relation = url.searchParams.get("relation");
    if (relation !== null) {
      if (!relations.includes(relation)) throw new HttpError(400, "invalid_request", L("关系参数不合法", "Invalid relation"));
      const offset = Math.max(0, parseInt(url.searchParams.get("offset") || "0", 10) || 0);
      const group = inRelation(relation);
      return json({ ok: true, relation, total: group.length, offset, people: group.slice(offset, offset + PEOPLE_PAGE_SIZE) });
    }
    return json({
      ok: true,
      viewer_relations: relations,
      page_size: PEOPLE_PAGE_SIZE,
      sections: relations.map((rel) => {
        const group = inRelation(rel);
        return { relation: rel, total: group.length, people: group.slice(0, PEOPLE_PAGE_SIZE) };
      }),
    });
  }

  if (parts[1] === "challenges" && parts.length >= 3) {
    const entry = challenges.get(parts[2]);
    if (!entry || !entry.config.enabled) throw new HttpError(404, "challenge_not_found", L("该挑战不存在或未启用", "This challenge does not exist or is disabled"));
    return entry.module.handleRequest(request, moduleContext(entry, env, { userId, now, lang, profiles }), parts.slice(3));
  }

  throw new HttpError(404, "not_found", L("接口不存在", "Not found"));
}
