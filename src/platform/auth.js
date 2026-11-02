import { HttpError, L } from "./http.js";
import { googleEnabled, sessionIdentity } from "./google-auth.js";
import { emailHash } from "./vault.js";

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

// DEV_MODE lets a request pick its own identity and enables fake data sources, so it only
// counts for requests to a local host. Anywhere else the env is returned with DEV_MODE
// cleared, so a stray DEV_MODE=1 in production config does nothing. Applied once per request
// before anything reads env.
export function effectiveEnv(request, env) {
  if (env.DEV_MODE !== "1") return env;
  if (LOCAL_HOSTS.includes(new URL(request.url).hostname)) return env;
  return { ...env, DEV_MODE: undefined };
}

// Who is making the request, in order:
// 1. DEV_MODE (local only, see effectiveEnv) and an x-dev-user header: that email.
// 2. Google sign-in configured: the session cookie's email, or nobody.
// 3. Cloudflare Access with ACCESS_TEAM_DOMAIN and ACCESS_AUD: the verified Access JWT.
// 4. DEV_MODE: DEV_USER_EMAIL.
// Otherwise the server refuses: identity is never taken from an unverified header, since with
// Access off anyone could send one.
// Returns { email, banned }; banned is null when the identity source didn't check it.
export async function identify(request, env, now = Date.now()) {
  let email;
  let banned = null;
  const devOverride = env.DEV_MODE === "1" && request.headers.get("x-dev-user");
  if (devOverride) {
    email = devOverride;
  } else if (googleEnabled(env)) {
    const session = await sessionIdentity(request, env, now);
    email = session?.email;
    banned = session?.banned ?? null;
  } else if (env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD) {
    email = await verifyAccessJwt(request.headers.get("cf-access-jwt-assertion"), env);
  } else if (env.DEV_MODE === "1") {
    email = env.DEV_USER_EMAIL;
  } else {
    throw new HttpError(
      503,
      "auth_not_configured",
      L("服务器未配置登录方式", "Sign-in is not configured on this server"),
    );
  }
  if (!email) throw new HttpError(401, "unauthenticated", L("请先登录", "Please sign in first"));
  return { email: email.trim().toLowerCase(), banned };
}

// Returns the site user id for a sign-in email, or null if this email has not registered yet.
export async function findUser(env, email) {
  const row = await env.DB.prepare("SELECT id FROM users WHERE email_hash = ?").bind(await emailHash(env, email)).first();
  return row?.id ?? null;
}

let jwksCache = { at: 0, keys: null };

async function verifyAccessJwt(token, env) {
  if (!token) return null;
  const [h, p, s] = token.split(".");
  if (!s) return null;
  // A malformed header is an invalid token (401), not a server error.
  let header, payload, signature;
  try {
    header = JSON.parse(b64urlText(h));
    payload = JSON.parse(b64urlText(p));
    signature = b64urlBytes(s);
  } catch {
    return null;
  }
  if (header?.alg !== "RS256" || !payload || typeof payload !== "object") return null;
  let keys = await accessKeys(env.ACCESS_TEAM_DOMAIN);
  let jwk = keys.find((k) => k.kid === header.kid);
  // Access rotates its signing keys; refetch once when the kid is new to this isolate's cache.
  if (!jwk) {
    keys = await accessKeys(env.ACCESS_TEAM_DOMAIN, { refresh: true });
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) return null;
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, new TextEncoder().encode(`${h}.${p}`));
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  // A token without a numeric exp is rejected rather than treated as never expiring.
  if (!ok || !aud.includes(env.ACCESS_AUD) || !(payload.exp * 1000 > Date.now())) return null;
  return typeof payload.email === "string" && payload.email ? payload.email : null;
}

async function accessKeys(teamDomain, { refresh = false } = {}) {
  const age = Date.now() - jwksCache.at;
  // A forced refresh is allowed at most once a minute, so unknown kids cannot flood the endpoint.
  if (jwksCache.keys && age < (refresh ? 60_000 : 3600_000)) return jwksCache.keys;
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new HttpError(503, "auth_unavailable", L("身份服务暂不可用", "Identity service is temporarily unavailable"));
  jwksCache = { at: Date.now(), keys: (await res.json()).keys };
  return jwksCache.keys;
}

function b64urlBytes(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "="));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function b64urlText(s) {
  return new TextDecoder().decode(b64urlBytes(s));
}
