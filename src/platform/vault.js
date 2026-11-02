import { HttpError, L } from "./http.js";

// Encryption at rest (docs/oversight.md rules 5-7). Every personal value is stored either sealed
// (AES-256-GCM) or as a keyed lookup hash (HMAC-SHA-256), under keys derived by HKDF from the
// DATA_KEY Worker secret. Cloudflare never shows a secret again once set, so only the running
// Worker can read these values: D1 and R2 on their own hold ciphertext and hashes.
//
// A sealed value names where it belongs (its context, such as "profile:<user_id>"), which goes
// into the AES-GCM additional data: copied into another row it no longer decrypts, and a row
// written without the key is rejected. Text is padded to a power-of-two size of at least 256
// bytes before sealing, so the ciphertext length does not give away short values such as a
// gender. Stored form: "v1:" + base64(iv || ciphertext).
//
// Lookup hashes let the database find a row by email (or another identifier) without storing
// it. Each use has its own purpose, so hashes from different tables cannot be matched.
//
// Without DATA_KEY, local development (DEV_MODE, localhost only) uses a fixed key; anywhere else
// every operation fails with 503 rather than store anything unprotected.

const DEV_ONLY_KEY = "uwcse.date local development only";
const VERSION = "v1:";
const MIN_PADDED = 256;

const keyCache = new Map(); // secret -> Promise<{ seal, lookup }>

function secretBytes(env) {
  if (env.DATA_KEY) {
    let bytes;
    try {
      bytes = Uint8Array.from(atob(env.DATA_KEY.trim()), (c) => c.charCodeAt(0));
    } catch {
      bytes = null;
    }
    if (bytes && bytes.length >= 32) return { id: env.DATA_KEY, bytes };
    console.error("DATA_KEY must be the base64 of at least 32 random bytes");
  } else if (env.DEV_MODE === "1") {
    return { id: DEV_ONLY_KEY, bytes: new TextEncoder().encode(DEV_ONLY_KEY) };
  }
  throw new HttpError(
    503,
    "server_misconfigured",
    L("服务器缺少必要配置，暂时无法完成这个操作", "The server is missing required configuration, so this action is unavailable"),
  );
}

async function deriveKeys(bytes) {
  const base = await crypto.subtle.importKey("raw", bytes, "HKDF", false, ["deriveKey"]);
  const derive = (info, algorithm, usages) =>
    crypto.subtle.deriveKey(
      { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: new TextEncoder().encode(info) },
      base,
      algorithm,
      false,
      usages,
    );
  return {
    seal: await derive("uwcse.date seal v1", { name: "AES-GCM", length: 256 }, ["encrypt", "decrypt"]),
    lookup: await derive("uwcse.date lookup v1", { name: "HMAC", hash: "SHA-256", length: 256 }, ["sign"]),
  };
}

function keys(env) {
  const { id, bytes } = secretBytes(env);
  if (!keyCache.has(id)) {
    const p = deriveKeys(bytes);
    p.catch(() => keyCache.delete(id));
    keyCache.set(id, p);
  }
  return keyCache.get(id);
}

const utf8 = new TextEncoder();
const fromUtf8 = new TextDecoder();

function b64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function unb64(s) {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

function padded(bytes) {
  let size = MIN_PADDED;
  while (size < bytes.length) size *= 2;
  const out = new Uint8Array(size).fill(0x20); // trailing spaces; JSON.parse ignores them
  out.set(bytes);
  return out;
}

async function encrypt(key, context, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: utf8.encode(context) }, key, bytes));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return out;
}

// Throws when the bytes were not sealed for this context with this key.
async function decrypt(key, context, sealed) {
  const iv = sealed.subarray(0, 12);
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: utf8.encode(context) }, key, sealed.subarray(12)));
}

export function vault(env) {
  return {
    // Any JSON value -> "v1:..." text bound to context.
    async seal(context, value) {
      const { seal } = await keys(env);
      return VERSION + b64(await encrypt(seal, context, padded(utf8.encode(JSON.stringify(value)))));
    },
    // The value sealed for context; throws if the text was not sealed for it (tampered, copied
    // from another row, or written without the key).
    async open(context, text) {
      if (typeof text !== "string" || !text.startsWith(VERSION)) throw new Error("not a sealed value");
      const { seal } = await keys(env);
      return JSON.parse(fromUtf8.decode(await decrypt(seal, context, unb64(text.slice(VERSION.length)))));
    },
    // Binary content (uploaded images), not padded: its size is stored anyway.
    async sealBytes(context, bytes) {
      const { seal } = await keys(env);
      return encrypt(seal, context, bytes);
    },
    async openBytes(context, bytes) {
      const { seal } = await keys(env);
      return decrypt(seal, context, bytes);
    },
    // Keyed hash of text for purpose, as 64 hex characters.
    async lookup(purpose, text) {
      const { lookup } = await keys(env);
      const sig = new Uint8Array(await crypto.subtle.sign("HMAC", lookup, utf8.encode(`${purpose}|${text}`)));
      return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
    },
  };
}

// The lookup hash every table uses to find a person by sign-in email (users, sessions, bans,
// avatars), so that these tables can be joined with each other but with nothing else.
export function emailHash(env, email) {
  return vault(env).lookup("email", email);
}
