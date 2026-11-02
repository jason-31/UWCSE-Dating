import { HttpError, L } from "./http.js";

// Request rate limits, using Workers Rate Limiting bindings (wrangler.jsonc "ratelimits"). The
// counters live in Cloudflare's rate limiter, not in D1, so checking them costs no D1 quota. Each
// binding has its own limit and period (10 or 60 s); counts are per Cloudflare location and
// approximate, which is fine for stopping scripts.
//
//   RL_AUTH    per client IP, /auth/* (starting and finishing a Google sign-in)
//   RL_API     per signed-in email, every other /api/* request
//   RL_LIST    per signed-in email, member lists and the home page's people
//   RL_AVATAR  per signed-in email, uploaded avatar images (one request per card shown)
//
// A missing binding (unit tests, or a plan where the binding is unavailable) or a limiter error
// lets the request through: limits protect quotas and must never take the site down themselves.

export const RATE_LIMITED = L("操作太频繁，请稍等片刻再试", "Too many requests; please wait a moment and try again");

// Resolves when the request may proceed; throws HttpError 429 when `key` is over its limit.
export async function enforceRateLimit(limiter, key) {
  if (!limiter || typeof limiter.limit !== "function") return;
  let outcome;
  try {
    outcome = await limiter.limit({ key });
  } catch (err) {
    console.error("rate limiter unavailable:", err?.message); // never log the key: it holds an email
    return;
  }
  if (outcome?.success === false) throw new HttpError(429, "rate_limited", RATE_LIMITED);
}

// Which limiter an authenticated /api request counts against.
export function apiLimiter(env, method, parts) {
  if (method === "GET" && parts[1] === "avatars" && parts.length === 3) return env.RL_AVATAR;
  if (method === "GET" && parts.length === 2 && parts[1] === "people") return env.RL_LIST;
  // /api/challenges/<id>/periods/<period>/members
  if (method === "GET" && parts.length === 6 && parts[1] === "challenges" && parts[3] === "periods" && parts[5] === "members") {
    return env.RL_LIST;
  }
  return env.RL_API;
}

// The client's IP as Cloudflare reports it; a fixed key elsewhere (local development).
export function clientIp(request) {
  return request.headers.get("cf-connecting-ip") || "local";
}
