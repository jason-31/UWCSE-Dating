import { vault, emailHash } from "./vault.js";

// Sign in with Google (OpenID Connect, authorization-code flow with PKCE), restricted to the
// Google Workspace domains in ALLOWED_EMAIL_DOMAINS via the `hd` claim. Enabled when
// GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set; otherwise identity falls back to
// Cloudflare Access (see auth.js).
//
// A login attempt is kept only in a short-lived signed cookie, so starting a login costs no
// database work (anyone on the internet can request /auth/login). A successful login creates a
// session row; the browser holds the random token in an HttpOnly cookie and the database stores
// only its SHA-256 hash, the email's lookup hash, and the email and expiry sealed to that token
// hash (src/platform/vault.js). A session row written without DATA_KEY therefore does not open,
// so write access to D1 is not enough to sign in as someone.

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const STATE_COOKIE = "uwcse_oauth";
const SESSION_COOKIE = "uwcse_session";
const STATE_TTL_MS = 10 * 60_000;
const SESSION_TTL_MS = 30 * 86400_000;

export function googleEnabled(env) {
  return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

function randomToken(bytes = 32) {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return b64url(buf);
}

function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(text) {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))));
}

function b64urlBytes(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "="));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

// HMAC key for login-attempt cookies, derived from the client secret so no extra secret is
// needed. Rotating GOOGLE_CLIENT_SECRET only invalidates logins that are in progress.
async function stateKey(env) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.GOOGLE_CLIENT_SECRET), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: new TextEncoder().encode("uwcse.date oauth state v1") },
    base,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign", "verify"],
  );
}

async function mac(key, text) {
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text))));
}

// The PKCE verifier and the OIDC nonce are derived from the random state, so the cookie only
// has to carry the state and its expiry: "<state>.<expires_ms>.<hmac>".
async function attemptSecrets(key, state) {
  return { verifier: await mac(key, `pkce|${state}`), nonce: await mac(key, `nonce|${state}`) };
}

export async function makeStateCookieValue(env, state, expiresAt) {
  const key = await stateKey(env);
  return `${state}.${expiresAt}.${await mac(key, `state|${state}.${expiresAt}`)}`;
}

// Returns { state, verifier, nonce } for a valid, unexpired cookie value, else null.
export async function readStateCookieValue(env, value, now) {
  const parts = (value || "").split(".");
  if (parts.length !== 3) return null;
  const [state, expires, sig] = parts;
  if (!/^[A-Za-z0-9_-]{43}$/.test(state) || !/^\d{1,16}$/.test(expires) || !/^[A-Za-z0-9_-]{43}$/.test(sig)) return null;
  if (now > Number(expires)) return null;
  const key = await stateKey(env);
  const ok = await crypto.subtle.verify("HMAC", key, b64urlBytes(sig), new TextEncoder().encode(`state|${state}.${expires}`));
  return ok ? { state, ...(await attemptSecrets(key, state)) } : null;
}

function cookies(request) {
  const out = {};
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

// Secure cookies work on https and on http://localhost in current browsers.
function cookie(name, value, maxAgeSeconds) {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

function redirect(location, setCookies = []) {
  const headers = new Headers({ location, "cache-control": "no-store" });
  for (const c of setCookies) headers.append("set-cookie", c);
  return new Response(null, { status: 302, headers });
}

function callbackUrl(url) {
  return `${url.origin}/auth/callback`;
}

// GET /auth/login: start a login attempt and send the browser to Google.
export async function startLogin(request, env, url, now) {
  const state = randomToken();
  const { verifier, nonce } = await attemptSecrets(await stateKey(env), state);
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  const stateCookie = await makeStateCookieValue(env, state, now + STATE_TTL_MS);
  const domains = allowedDomains(env);
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: callbackUrl(url),
    response_type: "code",
    scope: "openid email", // only identity, verified email and the hd claim; no name or photo
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  // A hint for Google's account chooser; the hd claim is still checked on return.
  if (domains.length === 1) params.set("hd", domains[0]);
  return redirect(`${AUTH_URL}?${params}`, [cookie(STATE_COOKIE, stateCookie, STATE_TTL_MS / 1000)]);
}

// GET /auth/callback: finish the login. Errors return to the site with ?login_error=<code>.
export async function finishLogin(request, env, url, now) {
  const fail = (code) => redirect(`/?login_error=${code}#/`, [cookie(STATE_COOKIE, "", 0)]);
  if (url.searchParams.get("error")) return fail("cancelled");
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  // The state must match this browser's signed, unexpired cookie (stops login CSRF). The cookie
  // is cleared on every outcome, and Google accepts each authorization code only once.
  if (!state || !code) return fail("state");
  const row = await readStateCookieValue(env, cookies(request)[STATE_COOKIE], now);
  if (!row || row.state !== state) return fail("state");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: callbackUrl(url),
      grant_type: "authorization_code",
      code_verifier: row.verifier,
    }),
  });
  if (!res.ok) return fail("google");
  const { id_token: idToken } = await res.json();
  // The ID token came straight from Google's token endpoint over TLS, authenticated with our
  // client secret, so its signature need not be re-verified (OpenID Connect Core 3.1.3.7);
  // its claims are still checked.
  let claims;
  try {
    const payload = idToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payload), (c) => c.charCodeAt(0))));
  } catch {
    return fail("google");
  }
  const problem = checkIdTokenClaims(claims, { clientId: env.GOOGLE_CLIENT_ID, nonce: row.nonce, now, domains: allowedDomains(env) });
  if (problem) return fail(problem);
  // Banned emails get a session too: the API lets them do nothing but sign out and delete their
  // data (src/index.js), and the session lookup reports the ban at no extra cost.
  const email = claims.email.toLowerCase();
  const token = randomToken();
  const tokenHash = await sha256(token);
  const expiresAt = now + SESSION_TTL_MS;
  await env.DB.batch([
    expiredSessionsStatement(env.DB, now),
    env.DB.prepare("INSERT INTO sessions (token_hash, email_hash, data, expires_at) VALUES (?, ?, ?, ?)").bind(
      tokenHash,
      await emailHash(env, email),
      await vault(env).seal(`session:${tokenHash}`, { email, expires_at: expiresAt }),
      expiresAt,
    ),
  ]);
  return redirect("/#/", [cookie(STATE_COOKIE, "", 0), cookie(SESSION_COOKIE, token, SESSION_TTL_MS / 1000)]);
}

// Removes expired sessions (also run by the daily clean-up, src/platform/retention.js).
export function expiredSessionsStatement(db, now) {
  return db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now);
}

// Returns null when the ID token is acceptable, else a short error code.
export function checkIdTokenClaims(claims, { clientId, nonce, now, domains }) {
  if (!ISSUERS.includes(claims.iss)) return "token";
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(clientId)) return "token";
  if (!(claims.exp * 1000 > now)) return "token";
  if (claims.nonce !== nonce) return "token";
  if (claims.email_verified !== true || typeof claims.email !== "string") return "email";
  // hd is only present for Google Workspace accounts, so personal Google accounts that merely
  // use a school address are rejected along with every other domain.
  const domain = claims.email.toLowerCase().split("@")[1];
  if (!domains.includes(claims.hd) || domain !== claims.hd) return "domain";
  return null;
}

function allowedDomains(env) {
  return (env.ALLOWED_EMAIL_DOMAINS || "cs.washington.edu")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

// The signed-in email for this request's session cookie and whether it is banned, or null.
// The ban check rides along in the same query, so it costs no extra read. A row that does not
// open for its token hash, or whose sealed expiry differs from the stored one, is not a session.
export async function sessionIdentity(request, env, now) {
  const token = cookies(request)[SESSION_COOKIE];
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(
    `SELECT s.data, s.expires_at, EXISTS (SELECT 1 FROM bans b WHERE b.email_hash = s.email_hash) AS banned
     FROM sessions s WHERE s.token_hash = ?`,
  )
    .bind(tokenHash)
    .first();
  if (!row || row.expires_at <= now) return null;
  let sealed;
  try {
    sealed = await vault(env).open(`session:${tokenHash}`, row.data);
  } catch (err) {
    if (err?.code === "server_misconfigured") throw err;
    return null;
  }
  return sealed.expires_at === row.expires_at ? { email: sealed.email, banned: row.banned === 1 } : null;
}

// POST /api/logout
export async function logout(request, env) {
  const token = cookies(request)[SESSION_COOKIE];
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json", "cache-control": "no-store", "set-cookie": cookie(SESSION_COOKIE, "", 0) },
  });
}

export async function deleteSessions(env, email) {
  await env.DB.prepare("DELETE FROM sessions WHERE email_hash = ?").bind(await emailHash(env, email)).run();
}
