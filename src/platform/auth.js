import { HttpError, L } from "./http.js";
import { googleEnabled, sessionIdentity } from "./google-auth.js";
import { emailHash } from "./vault.js";

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
// Dev mode's "signed out": an x-dev-user value that means nobody (DEV_SIGNED_OUT in public/lib.js).
const DEV_SIGNED_OUT = "signed-out";

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
// 1. DEV_MODE (local only, see effectiveEnv) and an x-dev-user header: that email, or nobody for
//    DEV_SIGNED_OUT.
// 2. Google sign-in configured: the session cookie's email, or nobody.
// 3. DEV_MODE: DEV_USER_EMAIL.
// Production identity comes from the site's Google session.
// Returns { email, banned }; banned is null when the identity source didn't check it.
export async function identify(request, env, now = Date.now()) {
  let email;
  let banned = null;
  const devOverride = env.DEV_MODE === "1" && request.headers.get("x-dev-user");
  if (devOverride === DEV_SIGNED_OUT) {
    email = null;
  } else if (devOverride) {
    email = devOverride;
  } else if (googleEnabled(env)) {
    const session = await sessionIdentity(request, env, now);
    email = session?.email;
    banned = session?.banned ?? null;
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
