// A user-facing message in both site languages; resolved per request by localize().
export const L = (zh, en) => ({ zh, en });

const isL = (v) => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 2 && "zh" in v && "en" in v;

export function localize(v, lang) {
  if (isL(v)) return v[lang] ?? v.zh;
  if (Array.isArray(v)) return v.map((x) => localize(x, lang));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, localize(x, lang)]));
  return v;
}

// The client sends its chosen language; otherwise fall back to Accept-Language.
export function requestLang(request) {
  const h = request.headers.get("x-uwcse-lang") || request.headers.get("accept-language") || "";
  return /^zh/i.test(h) ? "zh" : "en";
}

export class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(isL(message) ? message.en : message);
    this.messageL = message;
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

// Business responses are per-user; never let shared caches keep them.
export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}

// A time for user-facing messages, in the site's time zone (Seattle).
export function pacificTime(ts, locale) {
  return new Intl.DateTimeFormat(locale, { timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: "short" }).format(new Date(ts));
}

// On the Free plan D1 refuses every query once the account's daily row reads or writes are used
// up, until 00:00 UTC. Its message is the only marker (there is no error code), so match loosely.
const D1_DAILY_LIMIT = /free tier\b[^.]*\brow (read|write) limit/i;

// err as an HttpError: itself, a "daily capacity reached" answer for D1's daily-limit error, or
// null for anything else.
export function asHttpError(err) {
  if (err instanceof HttpError) return err;
  if (!D1_DAILY_LIMIT.test(`${err?.message} ${err?.cause?.message}`)) return null;
  const resumesAt = (Math.floor(Date.now() / 86400_000) + 1) * 86400_000; // next 00:00 UTC
  return new HttpError(
    503,
    "daily_capacity",
    L(
      `本站今天的免费额度已经用完，${pacificTime(resumesAt, "zh-CN")}（太平洋时间）自动恢复。`,
      `The site has used up today's free capacity. It comes back at ${pacificTime(resumesAt, "en-US")} (Pacific time).`,
    ),
    { resumes_at: resumesAt },
  );
}

export function errorResponse(err, lang = "zh") {
  const known = asHttpError(err);
  if (known) {
    return json({ ok: false, code: known.code, message: localize(known.messageL, lang), ...known.extra }, known.status);
  }
  // Only the error's type and stack frames, not its message: messages can quote input or
  // upstream data, and logs must never contain personal data (docs/oversight.md rule 8).
  console.error("unhandled error", err?.name, String(err?.stack ?? "").split("\n").slice(1).join("\n"));
  return json({ ok: false, code: "internal_error", message: localize(L("服务器内部错误", "Internal server error"), lang) }, 500);
}

// Largest JSON body any endpoint accepts. A full profile is about 2 KB.
export const JSON_BODY_MAX_BYTES = 64 * 1024;

// Reads the body into memory, giving up as soon as it passes maxBytes. The declared
// Content-Length is checked first, but chunked bodies have none, so the stream is counted too.
export async function readBody(request, maxBytes, tooLarge) {
  if (Number(request.headers.get("content-length") || 0) > maxBytes) throw tooLarge();
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

export async function readJson(request) {
  if (!request.headers.get("content-type")?.includes("application/json")) return {};
  const bytes = await readBody(
    request,
    JSON_BODY_MAX_BYTES,
    () => new HttpError(413, "body_too_large", L("请求体太大", "The request body is too large"), { max_bytes: JSON_BODY_MAX_BYTES }),
  );
  try {
    const body = JSON.parse(new TextDecoder().decode(bytes));
    return body && typeof body === "object" ? body : {};
  } catch {
    throw new HttpError(400, "invalid_request", L("请求体不是合法的 JSON", "Request body is not valid JSON"));
  }
}

// State-changing requests must carry a custom header (forces a CORS preflight cross-origin)
// and, when the browser sends Origin, it must match this site.
export function checkCsrf(request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  if (request.headers.get("x-uwcse-csrf") !== "1") {
    throw new HttpError(403, "csrf_rejected", L("缺少请求伪造防护头", "Missing CSRF protection header"));
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    throw new HttpError(403, "csrf_rejected", L("跨站请求被拒绝", "Cross-site request rejected"));
  }
}
