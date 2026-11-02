import { HttpError, L } from "./http.js";
import { avatarUrl, isUploadRef, uploadId, AVATAR_MAX_BYTES, AVATAR_SIZE_PX, AVATAR_UPLOAD_ATTEMPTS, AVATAR_UPLOAD_WINDOW_DAYS } from "./avatars.js";
import { cached, versionBumpStatement } from "./cache.js";
import { textWeight } from "../../public/text-weight.js";
import { vault } from "./vault.js";

// Site-wide personal profile, shared by every challenge. Challenge modules never read raw profile
// rows: they get completeness and server-filtered cards through profileService().

export const RELATION_LABELS = {
  FRIENDSHIP: L("朋友", "Friendship"),
  STUDY: L("学习搭子", "Study buddy"),
  // Long-term relationships only; the site does not support looking for short-term ones.
  ROMANCE: L("恋爱", "Romantic relationship"),
};
// Preset avatars (static files). A profile may instead use its own upload ("upload:<id>").
export const AVATARS = [
  "uw", "female", "male", "rainbow", "mystery1", "mystery2",
  "graduate", "raincoat", "blossom", "coffee", "construction", "wizard", "banana",
  "astronaut", "crab", "mushroom", "king", "nightcap", "froghat",
];

// Fields whose visibility the owner controls per relation: the contact apps, which may be
// opened to any relation but default to ROMANCE only. The login email is basic info and is
// always on the card, so people stay accountable for what they post.
const ALL = ["FRIENDSHIP", "STUDY", "ROMANCE"];
export const VISIBILITY_RULES = {
  wechat: { allowed: ALL, default: ["ROMANCE"] },
  discord: { allowed: ALL, default: ["ROMANCE"] },
};

const FIELD_LABELS = {
  nickname: L("昵称", "Nickname"),
  gender: L("性别", "Gender"),
  avatar: L("头像", "Avatar"),
  relations: L("寻找的关系", "Looking for"),
  relation_notes: L("对关系的期待", "What you hope for"),
  wechat: L("微信", "WeChat"),
  discord: L("Discord", "Discord"),
  bio: L("简介", "Bio"),
  program: L("项目", "Program"),
  research: L("研究兴趣", "Research interests"),
};
// Free-text limits are weighted (public/text-weight.js): a Chinese character counts 2, so 400
// allows 200 Chinese characters or 400 letters.
const RELATION_NOTE_MAX = 400;

// Only WeChat and Discord have per-relation visibility. Basic info (nickname, gender, program,
// avatar, login email) and "about me" (research, bio) are always shown on a visible card.

// Fields a person may filter each sought relation by. Both are basic info, so every member has
// a visible value; PREFER_NOT_TO_SAY is an ordinary gender value here. Filters are two-way.
export const FILTER_FIELDS = ["gender", "program"];

function filterOptions(cfg) {
  return { gender: cfg.gender_options, program: cfg.program_options };
}

export function profileSchema(cfg) {
  return {
    schema_version: cfg.schema_version,
    relation_options: cfg.relation_options.map((v) => ({ value: v, label: RELATION_LABELS[v] })),
    avatars: AVATARS.map((id) => ({ id, url: avatarUrl(id) })),
    avatar_upload: {
      max_bytes: AVATAR_MAX_BYTES,
      size_px: AVATAR_SIZE_PX,
      max_attempts: AVATAR_UPLOAD_ATTEMPTS,
      window_days: AVATAR_UPLOAD_WINDOW_DAYS,
    },
    allowed_email_domains: cfg.allowed_email_domains,
    matching_change_cooldown_days: cfg.matching_change_cooldown_days,
    basic_change_cooldown_days: cfg.basic_change_cooldown_days,
    filter_options: filterOptions(cfg),
    fields: [
      { name: "nickname", label: FIELD_LABELS.nickname, required: true, max: 30 },
      { name: "gender", label: FIELD_LABELS.gender, required: true, options: cfg.gender_options },
      { name: "avatar", label: FIELD_LABELS.avatar, required: true },
      { name: "relations", label: FIELD_LABELS.relations, required: true },
      { name: "relation_notes", label: FIELD_LABELS.relation_notes, required: false, max: RELATION_NOTE_MAX, weighted: true },
      { name: "wechat", label: FIELD_LABELS.wechat, required: false, max: 64 },
      { name: "discord", label: FIELD_LABELS.discord, required: false, max: 64 },
      { name: "bio", label: FIELD_LABELS.bio, required: false, max: 600, weighted: true },
      { name: "program", label: FIELD_LABELS.program, required: true, options: cfg.program_options },
      { name: "research", label: FIELD_LABELS.research, required: false, max: 240, weighted: true },
    ],
    visibility_rules: VISIBILITY_RULES,
  };
}

export function emailAllowed(email, domains) {
  return domains.includes(email.split("@")[1] || "");
}

// field is the schema entry: its max, and whether the length is weighted (textWeight) or plain.
function str(v, field, label, required) {
  const requiredErr = () => new HttpError(400, "invalid_request", L(`${label.zh}为必填项`, `${label.en} is required`));
  if (v == null || v === "") {
    if (required) throw requiredErr();
    return null;
  }
  if (typeof v !== "string") throw new HttpError(400, "invalid_request", L(`${label.zh}格式不正确`, `${label.en} is invalid`));
  const s = v.trim();
  if (!s && required) throw requiredErr();
  const { max, weighted } = field;
  if (weighted && textWeight(s) > max) {
    throw new HttpError(
      400,
      "invalid_request",
      L(
        `${label.zh}超出长度上限 ${max}（字母、数字算 1，汉字等全角字符算 2）`,
        `${label.en} is over its length limit of ${max} (letters and digits count 1, Chinese and other full-width characters count 2)`,
      ),
    );
  }
  if (!weighted && s.length > max) {
    throw new HttpError(400, "invalid_request", L(`${label.zh}最多 ${max} 个字符`, `${label.en} is limited to ${max} characters`));
  }
  return s || null;
}

// Validates a submitted profile. There is no email field: the login email is always used.
export function validateProfile(body, cfg) {
  const field = Object.fromEntries(profileSchema(cfg).fields.map((f) => [f.name, f]));
  const p = {
    nickname: str(body.nickname, field.nickname, FIELD_LABELS.nickname, true),
    avatar: typeof body.avatar === "string" ? body.avatar : null,
    wechat: str(body.wechat, field.wechat, FIELD_LABELS.wechat, false),
    discord: str(body.discord, field.discord, FIELD_LABELS.discord, false),
    bio: str(body.bio, field.bio, FIELD_LABELS.bio, false),
    research: str(body.research, field.research, FIELD_LABELS.research, false),
  };
  if (!cfg.gender_options.includes(body.gender)) {
    throw new HttpError(400, "invalid_request", L("请选择性别", "Please choose a gender option"));
  }
  p.gender = body.gender;
  if (!cfg.program_options.includes(body.program)) {
    throw new HttpError(400, "invalid_request", L("请选择项目", "Please choose a program"));
  }
  p.program = body.program;
  // Ownership of an upload is checked separately (assertAvatarOwned), since it needs the database.
  if (!AVATARS.includes(p.avatar) && !isUploadRef(p.avatar)) throw new HttpError(400, "invalid_request", L("请选择一个头像", "Please choose an avatar"));

  const rel = Array.isArray(body.relations) ? [...new Set(body.relations)] : [];
  if (!rel.length || rel.some((r) => !cfg.relation_options.includes(r))) {
    throw new HttpError(400, "invalid_request", L("请至少选择一种寻找的关系", "Choose at least one kind of relationship"));
  }
  p.relations = cfg.relation_options.filter((r) => rel.includes(r));

  // One optional note per sought relation; notes for relations not sought are dropped.
  const notes = body.relation_notes && typeof body.relation_notes === "object" ? body.relation_notes : {};
  p.relation_notes = {};
  for (const r of p.relations) {
    const label = L(`对“${RELATION_LABELS[r].zh}”的期待`, `What you hope for (${RELATION_LABELS[r].en})`);
    const note = str(notes[r], field.relation_notes, label, false);
    if (note) p.relation_notes[r] = note;
  }

  // Filters per sought relation. Selecting every value of a field means no restriction and is
  // stored as absent; an empty selection would match nobody and is rejected. Values keep the
  // configured order so equal filters serialize identically (the change lock compares the JSON).
  const rawFilters = body.relation_filters && typeof body.relation_filters === "object" ? body.relation_filters : {};
  const allowed = filterOptions(cfg);
  p.relation_filters = {};
  for (const r of p.relations) {
    const f = rawFilters[r] && typeof rawFilters[r] === "object" ? rawFilters[r] : {};
    if (Object.keys(f).some((k) => !FILTER_FIELDS.includes(k))) {
      throw new HttpError(400, "invalid_request", L("只能按性别和项目筛选", "You can only filter by gender and program"));
    }
    const out = {};
    for (const field of FILTER_FIELDS) {
      if (f[field] == null) continue;
      if (!Array.isArray(f[field]) || f[field].some((v) => !allowed[field].includes(v))) {
        throw new HttpError(400, "invalid_request", L("筛选条件不合法", "Invalid filter"));
      }
      const values = allowed[field].filter((v) => f[field].includes(v));
      if (!values.length) {
        throw new HttpError(400, "invalid_request", L("每项筛选至少保留一个选项", "Keep at least one option ticked in each filter"));
      }
      if (values.length < allowed[field].length) out[field] = values;
    }
    if (Object.keys(out).length) p.relation_filters[r] = out;
  }

  const vis = body.visibility && typeof body.visibility === "object" ? body.visibility : {};
  p.visibility = {};
  for (const [field, rule] of Object.entries(VISIBILITY_RULES)) {
    const want = Array.isArray(vis[field]) ? vis[field] : rule.default;
    const bad = want.filter((r) => !rule.allowed.includes(r));
    if (bad.length) {
      throw new HttpError(
        400,
        "invalid_request",
        L(
          `${FIELD_LABELS[field]?.zh ?? field}只能对${rule.allowed.map((r) => RELATION_LABELS[r].zh).join("、")}开放`,
          `${FIELD_LABELS[field]?.en ?? field} can only be shown to: ${rule.allowed.map((r) => RELATION_LABELS[r].en).join(", ")}`,
        ),
      );
    }
    p.visibility[field] = rule.allowed.filter((r) => want.includes(r));
  }
  return p;
}

export function missingRequired(profile, cfg) {
  if (!profile) return ["profile"];
  const missing = [];
  if (profile.schema_version < cfg.schema_version) missing.push("schema_version");
  for (const f of profileSchema(cfg).fields.filter((f) => f.required)) {
    const v = profile[f.name];
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) missing.push(f.name);
  }
  return missing;
}

export function intersect(a, b) {
  return a.filter((x) => b.includes(x));
}

// Whether owner shows a (non-basic) field to people sharing relation r.
function shows(owner, field, r) {
  return !!owner[field] && VISIBILITY_RULES[field].allowed.includes(r) && (owner.visibility[field] || []).includes(r);
}

// Whether target meets seeker's filters for relation r. Filters only use basic info, which is
// always shown, so matching never depends on anything hidden.
export function meetsFilters(seeker, target, r) {
  const filters = seeker.relation_filters?.[r] || {};
  return Object.entries(filters).every(([field, values]) => values.includes(target[field]));
}

// The relations a person seeks in a challenge: those of their profile that they also chose for
// that challenge (profile.challenge_relations[challengeId]; no choice means all of them). With no
// challenge, the profile's relations. The choice can only narrow the profile, never widen it.
export function relationsIn(profile, challengeId = null) {
  const chosen = challengeId === null ? undefined : profile.challenge_relations?.[challengeId];
  return chosen ? intersect(profile.relations, chosen) : profile.relations;
}

// Relations under which viewer and owner see each other (in a challenge, if given): both seek
// it there, and each meets the other's filters for it.
export function matchingRelations(viewer, owner, challengeId = null) {
  return intersect(relationsIn(viewer, challengeId), relationsIn(owner, challengeId)).filter(
    (r) => meetsFilters(viewer, owner, r) && meetsFilters(owner, viewer, r),
  );
}

// The card a viewer may see under the common relations given (by default, those of their
// profiles), or null when there are none. Runs server-side; nothing outside the returned object
// is sent to the browser.
export function buildCard(viewer, owner, common = matchingRelations(viewer, owner)) {
  if (!common.length) return null;
  const fields = {};
  for (const field of Object.keys(VISIBILITY_RULES)) {
    if (common.some((r) => shows(owner, field, r))) fields[field] = owner[field];
  }
  // A relation note is shown only to people who share that relation.
  const relationNotes = {};
  for (const r of common) if (owner.relation_notes?.[r]) relationNotes[r] = owner.relation_notes[r];
  return {
    nickname: owner.nickname,
    email: owner.email,
    gender: owner.gender,
    program: owner.program,
    research: owner.research,
    bio: owner.bio,
    avatar_url: avatarUrl(owner.avatar),
    common_relations: common,
    relation_notes: relationNotes,
    fields,
  };
}

// Profiles are stored sealed (src/platform/vault.js): one value per user holding every field,
// the email shown on cards and the change-lock timers, bound to "profile:<user_id>".
const profileContext = (userId) => `profile:${userId}`;

export async function getProfile(env, userId) {
  const row = await env.DB.prepare("SELECT data FROM profiles WHERE user_id = ?").bind(userId).first();
  return row && { user_id: userId, ...(await vault(env).open(profileContext(userId), row.data)) };
}

// Field groups that may only change after a cooldown. Each group has its own timer, reset only
// when a field in the group actually changes. Relations and filters are normalized to the
// configured order, so comparing JSON is exact.
const LOCKS = {
  matching: {
    column: "matching_changed_at", // the timer's name in the sealed profile
    days: "matching_change_cooldown_days",
    fields: ["relations", "relation_filters"],
    message: (d) => L(`寻找的关系和筛选条件每 ${d} 天只能修改一次`, `What you're looking for and your filters can only be changed once every ${d} days`),
  },
  // The avatar is basic info (always on the card) but not locked: choosing one is free, and only
  // uploads are limited (avatars.js).
  basic: {
    column: "basic_changed_at",
    days: "basic_change_cooldown_days",
    fields: ["nickname", "gender", "program"],
    message: (d) => L(`昵称、性别和项目每 ${d} 天只能修改一次`, `Nickname, gender and program can only be changed once every ${d} days`),
  },
};

// When each locked group may next be changed: { matching: ms, basic: ms } (0 = now).
export function lockedUntil(profile, cfg) {
  return Object.fromEntries(
    Object.entries(LOCKS).map(([name, lock]) => [name, profile ? profile[lock.column] + cfg[lock.days] * 86400_000 : 0]),
  );
}

// Rejects a change to any locked group within its cooldown; other fields can always be edited.
// Error code "<group>_locked" with "<group>_locked_until".
export function checkLockedChanges(current, next, cfg, now) {
  if (!current) return;
  const until = lockedUntil(current, cfg);
  for (const [name, lock] of Object.entries(LOCKS)) {
    const same = lock.fields.every((f) => JSON.stringify(current[f]) === JSON.stringify(next[f]));
    if (!same && now < until[name]) {
      throw new HttpError(409, `${name}_locked`, lock.message(cfg[lock.days]), { [`${name}_locked_until`]: until[name] });
    }
  }
}

// The statement storing profile p for userId (registering, or saving over current). A lock
// timer moves to now only when a field in its group changed.
export async function upsertProfileStatement(env, userId, email, p, current, cfg, now) {
  const timers = {};
  for (const lock of Object.values(LOCKS)) {
    const same = current && lock.fields.every((f) => JSON.stringify(current[f]) === JSON.stringify(p[f]));
    timers[lock.column] = same ? current[lock.column] : now;
  }
  // Per-challenge choices are kept; they are changed through challengeRelationsStatement.
  const data = { ...p, email, challenge_relations: current?.challenge_relations ?? {}, schema_version: cfg.schema_version, ...timers, updated_at: now };
  return env.DB.prepare(
    `INSERT INTO profiles (user_id, data, avatar_upload) VALUES (?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET data = excluded.data, avatar_upload = excluded.avatar_upload`,
  ).bind(userId, await vault(env).seal(profileContext(userId), data), uploadId(p.avatar));
}

// The statement storing which of their profile's relations a person seeks in one challenge.
// relations must already be validated (challengeRelationsFrom). No change lock: the choice only
// narrows relations and filters that are themselves locked, so changing it cannot show anyone a
// person they could not already see.
export async function challengeRelationsStatement(env, current, challengeId, relations) {
  const data = { ...current, challenge_relations: { ...current.challenge_relations, [challengeId]: relations } };
  delete data.user_id;
  return env.DB.prepare("UPDATE profiles SET data = ? WHERE user_id = ?").bind(
    await vault(env).seal(profileContext(current.user_id), data),
    current.user_id,
  );
}

// Validates a per-challenge choice: one or more of the profile's relations, in configured order.
export function challengeRelationsFrom(value, profile, cfg) {
  if (!Array.isArray(value) || !value.length || value.some((r) => !profile.relations.includes(r))) {
    throw new HttpError(
      400,
      "invalid_request",
      L("请在个人资料里寻找的关系中至少选择一种", "Choose at least one of the relationship types in your profile"),
    );
  }
  return cfg.relation_options.filter((r) => value.includes(r));
}

// Every profile row (still sealed) with its ban flag, from the versioned cache (see cache.js).
// Every write that changes a profile, a users row or a ban must include
// profilesChangedStatement(db) in its batch.
export const PROFILES_CACHE = "profiles";

export function profilesChangedStatement(db) {
  return versionBumpStatement(db, PROFILES_CACHE);
}

function loadAllProfiles(db) {
  return cached(db, PROFILES_CACHE, async () => {
    const rows = await db
      .prepare(
        `SELECT p.user_id, p.data, EXISTS (SELECT 1 FROM bans b WHERE b.email_hash = u.email_hash) AS banned
         FROM profiles p JOIN users u ON u.id = p.user_id`,
      )
      .all();
    return new Map(rows.results.map((row) => [row.user_id, { data: row.data, banned: row.banned === 1 }]));
  });
}

// Profiles are decrypted only when a request needs them, and kept decrypted in this isolate until
// their sealed value changes, so a list view decrypts the people on it once instead of every
// profile on every cache reload. Callers must treat the objects as read-only. A row that does not
// open (written or swapped without DATA_KEY) counts as no profile, so it cannot break lists.
const opened = new Map(); // user_id -> { data, profile }

async function openCached(env, userId, data) {
  const hit = opened.get(userId);
  if (hit?.data === data) return hit.profile;
  let profile;
  try {
    profile = { user_id: userId, ...(await vault(env).open(profileContext(userId), data)) };
  } catch (err) {
    if (err instanceof HttpError) throw err; // DATA_KEY missing
    console.error("a stored profile does not open; it is treated as missing");
    profile = null;
  }
  opened.set(userId, { data, profile });
  return profile;
}

// The only profile access handed to challenge modules. Create one per request: the profile
// snapshot is looked up once and reused by every call made through this object.
export function profileService(env, cfg) {
  let snapshot;
  const all = () => (snapshot ??= loadAllProfiles(env.DB));
  // The decrypted profile of userId, or null.
  async function get(userId) {
    const row = (await all()).get(userId);
    return row ? openCached(env, userId, row.data) : null;
  }
  return {
    async status(userId) {
      const missing = missingRequired(await get(userId), cfg);
      return { complete: missing.length === 0, missing_fields: missing };
    },
    // The relations a user seeks, in configured order: in a challenge, if given (relationsIn).
    async relations(userId, challengeId = null) {
      const profile = await get(userId);
      return profile ? relationsIn(profile, challengeId) : [];
    },
    // Map ownerId -> card (or null) as seen by viewerId in a challenge (or by profiles alone),
    // built from the current profiles. Banned and unknown owners are left out of the map, so they
    // disappear from every list.
    cards: (viewerId, ownerIds, challengeId = null) => cardsAcross(viewerId, new Map([[challengeId, ownerIds]])),
    cardsAcross,
  };

  // Like cards, for people met in several challenges at once (the home page): a card's common
  // relations are those matching in any challenge the two share a list in, in configured order.
  // idsByChallenge: Map challengeId -> owner ids.
  async function cardsAcross(viewerId, idsByChallenge) {
    const out = new Map();
    const viewer = await get(viewerId);
    if (!viewer) return out;
    const profiles = await all();
    const common = new Map(); // ownerId -> { owner, relations: Set }
    for (const [challengeId, ownerIds] of idsByChallenge) {
      for (const id of ownerIds) {
        const row = profiles.get(id);
        if (!row || row.banned) continue;
        const owner = await openCached(env, id, row.data);
        if (!owner) continue;
        const entry = common.get(id) ?? { owner, relations: new Set() };
        common.set(id, entry);
        if (missingRequired(owner, cfg).length) continue;
        for (const r of matchingRelations(viewer, owner, challengeId)) entry.relations.add(r);
      }
    }
    for (const [id, { owner, relations }] of common) {
      const card = missingRequired(owner, cfg).length ? null : buildCard(viewer, owner, cfg.relation_options.filter((r) => relations.has(r)));
      out.set(id, card);
    }
    return out;
  }
}
