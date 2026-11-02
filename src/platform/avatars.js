import { HttpError, L, readBody, pacificTime } from "./http.js";
import { vault, emailHash } from "./vault.js";

// Uploaded avatars live in R2 under avatars/<id>, sealed (src/platform/vault.js) and bound to
// "avatar:<id>"; the avatars table records who uploaded each one by the "email" lookup hash.
// Ownership is keyed by the sign-in email because people pick an avatar while registering,
// before they have a user id. A profile refers to an upload as "upload:<id>"; preset avatars are
// static files under /avatars/.

// Avatars are exactly AVATAR_SIZE_PX square. The browser crops, resizes and re-encodes; the
// server reads the dimensions from the image header and rejects anything else.
export const AVATAR_SIZE_PX = 256;
export const AVATAR_MAX_BYTES = 512_000;

// Upload attempts per verified email in any rolling AVATAR_UPLOAD_WINDOW_DAYS. Every upload request
// counts, whether or not the image is accepted, and the count is kept apart from the images:
// deleting an upload, deleting the account or signing in again does not restore attempts.
// Choosing an avatar is not limited: presets, the upload in use and the latest upload (kept even
// while unused) can be switched between at any time.
export const AVATAR_UPLOAD_ATTEMPTS = 5;
export const AVATAR_UPLOAD_WINDOW_DAYS = 30;
const UPLOAD_WINDOW_MS = AVATAR_UPLOAD_WINDOW_DAYS * 86400_000;
const UPLOAD_PURPOSE = "avatar-upload";

const UPLOAD_RE = /^upload:([0-9a-f]{32})$/;

export function uploadId(avatar) {
  return typeof avatar === "string" ? (UPLOAD_RE.exec(avatar)?.[1] ?? null) : null;
}

export function isUploadRef(avatar) {
  return uploadId(avatar) !== null;
}

export function avatarUrl(avatar) {
  const id = uploadId(avatar);
  return id ? `/api/avatars/${id}` : `/avatars/${avatar}.png`;
}

// Identify the image format from its first bytes; the declared content type is not trusted.
// SVG and anything else that could carry script is rejected.
export function sniffImageType(bytes) {
  const b = (i) => bytes[i];
  if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47) return "image/png";
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return "image/jpeg";
  const ascii = (from, to) => String.fromCharCode(...bytes.slice(from, to));
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

// Width and height from the image header, or null if they can't be read.
export function imageSize(bytes, type) {
  const u16be = (i) => (bytes[i] << 8) | bytes[i + 1];
  const u24le = (i) => bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16);
  if (type === "image/png") {
    // Signature (8) + IHDR length (4) + "IHDR" (4), then width and height as big-endian u32.
    if (bytes.length < 24 || String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR") return null;
    const u32 = (i) => ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0;
    return { width: u32(16), height: u32(20) };
  }
  if (type === "image/jpeg") {
    // Walk the marker segments to the first start-of-frame (SOF0–SOF15 except DHT/JPG/DAC).
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1];
      if (marker === 0xff) {
        i++;
        continue;
      }
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { width: u16be(i + 7), height: u16be(i + 5) };
      }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      i += 2 + u16be(i + 2);
    }
    return null;
  }
  if (type === "image/webp") {
    const chunk = String.fromCharCode(...bytes.slice(12, 16));
    if (chunk === "VP8 " && bytes.length >= 30) {
      // Lossy: 14-bit little-endian width and height after the frame tag and start code.
      const u14le = (i) => ((bytes[i + 1] << 8) | bytes[i]) & 0x3fff;
      return { width: u14le(26), height: u14le(28) };
    }
    if (chunk === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
      const [b1, b2, b3, b4] = [bytes[21], bytes[22], bytes[23], bytes[24]];
      return { width: 1 + (((b2 & 0x3f) << 8) | b1), height: 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6)) };
    }
    if (chunk === "VP8X" && bytes.length >= 30) return { width: 1 + u24le(24), height: 1 + u24le(27) };
    return null;
  }
  return null;
}

function randomId() {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return Array.from(buf, (x) => x.toString(16).padStart(2, "0")).join("");
}

async function inUse(db, owner) {
  const row = await db
    .prepare("SELECT p.avatar_upload FROM profiles p JOIN users u ON u.id = p.user_id WHERE u.email_hash = ?")
    .bind(owner)
    .first();
  return row?.avatar_upload ?? null;
}

// This email's latest upload, which is kept even while the profile uses something else, so that
// switching back to it costs no upload. Null if there is none.
export async function latestUpload(env, email) {
  const row = await env.DB.prepare("SELECT id FROM avatars WHERE owner_hash = ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
    .bind(await emailHash(env, email))
    .first();
  return row ? { avatar: `upload:${row.id}`, url: avatarUrl(`upload:${row.id}`) } : null;
}

// Deletes this email's uploads except the one its profile uses, the latest one, and any listed in
// keep. (Upload limits are counted in avatar_upload_attempts, so deleting rows restores nothing.)
export async function pruneAvatars(env, email, { keep = [] } = {}) {
  const owner = await emailHash(env, email);
  const current = await inUse(env.DB, owner);
  const rows = await env.DB.prepare("SELECT id FROM avatars WHERE owner_hash = ? ORDER BY created_at DESC, rowid DESC").bind(owner).all();
  const latest = rows.results[0]?.id;
  const stale = rows.results.map((r) => r.id).filter((id) => id !== current && id !== latest && !keep.includes(id));
  if (!stale.length) return;
  await env.BUCKET.delete(stale.map((id) => `avatars/${id}`));
  await env.DB.batch(stale.map((id) => env.DB.prepare("DELETE FROM avatars WHERE id = ?").bind(id)));
}

// An upload no profile uses is kept this long, so whoever is registering or editing their
// profile with it can still save it. After that the daily clean-up deletes it, except a
// registered person's latest upload (kept so they can switch back to it): uploads by people who
// never finished registering, older uploads a failed prune left behind, and images in R2 that no
// row refers to at all.
export const UNUSED_UPLOAD_TTL_MS = 86400_000;

export async function pruneUnusedUploads(env, now) {
  const cutoff = now - UNUSED_UPLOAD_TTL_MS;
  const rows = await env.DB.prepare(
    `SELECT id FROM avatars WHERE created_at < ?
     EXCEPT SELECT avatar_upload FROM profiles WHERE avatar_upload IS NOT NULL
     EXCEPT SELECT (SELECT b.id FROM avatars b WHERE b.owner_hash = u.email_hash ORDER BY b.created_at DESC, b.rowid DESC LIMIT 1) FROM users u`,
  )
    .bind(cutoff)
    .all();
  const ids = rows.results.map((r) => r.id);
  // 100 ids per round keeps each statement under D1's bound-parameter limit.
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    await env.BUCKET.delete(chunk.map((id) => `avatars/${id}`));
    await env.DB.prepare(`DELETE FROM avatars WHERE id IN (${chunk.map(() => "?").join(",")})`).bind(...chunk).run();
  }
  // Objects without a row (an upload whose row insert failed, or images from before a reset).
  let cursor;
  do {
    const page = await env.BUCKET.list({ prefix: "avatars/", cursor });
    const old = page.objects.filter((o) => o.uploaded.getTime() < cutoff).map((o) => o.key.slice("avatars/".length));
    for (let i = 0; i < old.length; i += 100) {
      const chunk = old.slice(i, i + 100);
      const known = await env.DB.prepare(`SELECT id FROM avatars WHERE id IN (${chunk.map(() => "?").join(",")})`).bind(...chunk).all();
      const kept = new Set(known.results.map((r) => r.id));
      const orphans = chunk.filter((id) => !kept.has(id));
      if (orphans.length) await env.BUCKET.delete(orphans.map((id) => `avatars/${id}`));
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

export async function deleteAllAvatars(env, email) {
  const owner = await emailHash(env, email);
  const rows = await env.DB.prepare("SELECT id FROM avatars WHERE owner_hash = ?").bind(owner).all();
  const ids = rows.results.map((r) => r.id);
  if (!ids.length) return;
  await env.BUCKET.delete(ids.map((id) => `avatars/${id}`));
  await env.DB.prepare("DELETE FROM avatars WHERE owner_hash = ?").bind(owner).run();
}

// Removes attempts that left every window (also run by the daily clean-up).
export function expiredAttemptsStatement(db, now) {
  return db.prepare("DELETE FROM avatar_upload_attempts WHERE attempted_at <= ?").bind(now - UPLOAD_WINDOW_MS);
}

// Takes one upload attempt for this email, or throws 429 when the window is used up. One statement
// both checks and records the attempt (D1 runs statements one at a time), so concurrent uploads
// cannot all slip past the count. The same batch drops attempts that left every window.
async function takeUploadAttempt(env, email, now) {
  const mac = await vault(env).lookup(UPLOAD_PURPOSE, email);
  const [, claim] = await env.DB.batch([
    expiredAttemptsStatement(env.DB, now),
    env.DB.prepare(
      `INSERT INTO avatar_upload_attempts (email_mac, attempted_at)
       SELECT ?1, ?2 WHERE (SELECT COUNT(*) FROM avatar_upload_attempts WHERE email_mac = ?1) < ?3
       RETURNING attempted_at`,
    ).bind(mac, now, AVATAR_UPLOAD_ATTEMPTS),
  ]);
  if (claim.results.length) return;
  const oldest = await env.DB.prepare("SELECT MIN(attempted_at) AS t FROM avatar_upload_attempts WHERE email_mac = ?").bind(mac).first();
  const next = (oldest?.t ?? now) + UPLOAD_WINDOW_MS;
  throw new HttpError(
    429,
    "upload_limit",
    L(
      `每 ${AVATAR_UPLOAD_WINDOW_DAYS} 天最多上传 ${AVATAR_UPLOAD_ATTEMPTS} 次头像，上传失败也算一次。下次可以上传的时间是 ${pacificTime(next, "zh-CN")}（太平洋时间）；在此之前仍可随时换成预设头像或你最近上传的头像。`,
      `Avatars can be uploaded at most ${AVATAR_UPLOAD_ATTEMPTS} times every ${AVATAR_UPLOAD_WINDOW_DAYS} days, failed uploads included. You can upload again after ${pacificTime(next, "en-US")} (Pacific time); until then you can still switch to a preset or your latest upload.`,
    ),
    { next_upload_at: next },
  );
}

export async function uploadAvatar(env, request, email, now) {
  await takeUploadAttempt(env, email, now); // from here on, a failure still uses the attempt
  const bytes = await readBody(request, AVATAR_MAX_BYTES, tooLarge);
  if (!bytes.length) throw new HttpError(400, "invalid_request", L("没有收到图片", "No image received"));
  const type = sniffImageType(bytes);
  if (!type) {
    throw new HttpError(400, "invalid_image", L("只支持 PNG、JPEG 或 WebP 图片", "Only PNG, JPEG or WebP images are supported"));
  }

  const size = imageSize(bytes, type);
  if (!size || size.width !== AVATAR_SIZE_PX || size.height !== AVATAR_SIZE_PX) {
    throw new HttpError(
      400,
      "invalid_image_size",
      L(`头像必须是 ${AVATAR_SIZE_PX}×${AVATAR_SIZE_PX} 像素`, `Avatars must be exactly ${AVATAR_SIZE_PX}×${AVATAR_SIZE_PX} pixels`),
      { width: size?.width ?? null, height: size?.height ?? null, required_px: AVATAR_SIZE_PX },
    );
  }

  // The row goes in before the image, so an image is never stored without a row that lets
  // pruning and account deletion find it.
  const id = randomId();
  await env.DB.prepare("INSERT INTO avatars (id, owner_hash, content_type, size, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, await emailHash(env, email), type, bytes.length, now)
    .run();
  try {
    const sealed = await vault(env).sealBytes(`avatar:${id}`, bytes);
    await env.BUCKET.put(`avatars/${id}`, sealed, { customMetadata: { contentType: type } });
  } catch (err) {
    await env.DB.prepare("DELETE FROM avatars WHERE id = ?").bind(id).run();
    throw err;
  }
  // Keep at most the avatar in use plus this new one.
  await pruneAvatars(env, email, { keep: [id] });
  const avatar = `upload:${id}`;
  return { avatar, url: avatarUrl(avatar) };
}

function tooLarge() {
  return new HttpError(413, "image_too_large", L("图片太大", "The image is too large"), { max_bytes: AVATAR_MAX_BYTES });
}

// A profile may only use an upload made by the same email.
export async function assertAvatarOwned(env, email, avatar) {
  const id = uploadId(avatar);
  if (!id) return;
  const row = await env.DB.prepare("SELECT 1 FROM avatars WHERE id = ? AND owner_hash = ?").bind(id, await emailHash(env, email)).first();
  if (!row) throw new HttpError(400, "invalid_request", L("头像不存在，请重新上传", "That avatar no longer exists; please upload again"));
}

// Upload ids are unguessable and only reach people allowed to see the card, so any signed-in
// visitor may fetch one; the response is never shared between users by caches.
export async function serveAvatar(env, id) {
  if (!/^[0-9a-f]{32}$/.test(id)) throw new HttpError(404, "not_found", L("头像不存在", "Avatar not found"));
  const obj = await env.BUCKET.get(`avatars/${id}`);
  if (!obj) throw new HttpError(404, "not_found", L("头像不存在", "Avatar not found"));
  let bytes;
  try {
    bytes = await vault(env).openBytes(`avatar:${id}`, new Uint8Array(await obj.arrayBuffer()));
  } catch (err) {
    if (err instanceof HttpError) throw err; // DATA_KEY missing
    throw new HttpError(404, "not_found", L("头像不存在", "Avatar not found")); // not sealed for this id
  }
  return new Response(bytes, {
    headers: {
      "content-type": obj.customMetadata?.contentType || "application/octet-stream",
      "cache-control": "private, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'",
    },
  });
}
