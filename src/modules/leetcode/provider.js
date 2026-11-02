// Evidence providers. The GraphQL adapter reads leetcode.com public profile data and validates
// every response it uses. The mock provider exists only for local development (DEV_MODE=1) and
// never counts as acceptance.

export class ProviderError extends Error {
  // kind: "unavailable" (timeout, rate limit, 5xx, blocked) | "unverifiable" (bad shape).
  // The message is a short technical detail shown in parentheses in either language.
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

const RECENT_AC_LIMIT = 20;

function graphqlProvider({ timeoutMs }) {
  async function query(operationName, q, variables) {
    let res;
    try {
      res = await fetch("https://leetcode.com/graphql/", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          referer: "https://leetcode.com/",
          "user-agent": "uwcse.date verifier",
        },
        body: JSON.stringify({ operationName, query: q, variables }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new ProviderError("unavailable", err.name === "TimeoutError" ? "upstream timeout" : "upstream connection failed");
    }
    if (res.status === 429) throw new ProviderError("unavailable", "upstream rate limited");
    if (!res.ok) throw new ProviderError("unavailable", `upstream returned ${res.status}`);
    let body;
    try {
      body = await res.json();
    } catch {
      throw new ProviderError("unavailable", "upstream response is not JSON");
    }
    if (body.errors?.length && !body.data) throw new ProviderError("unverifiable", "upstream returned errors");
    if (!body.data || typeof body.data !== "object") throw new ProviderError("unverifiable", "upstream response has no data");
    return body.data;
  }

  return {
    id: "leetcode.com/graphql",
    version: "graphql-v1",
    upstreamCallsPerAttempt: 1,

    async profile(username) {
      const data = await query(
        "userPublicProfile",
        `query userPublicProfile($username: String!) {
          matchedUser(username: $username) { username profile { aboutMe } }
        }`,
        { username },
      );
      const u = data.matchedUser;
      if (u === null) return null;
      if (typeof u?.username !== "string") throw new ProviderError("unverifiable", "profile fields missing");
      return { username: u.username, about: typeof u.profile?.aboutMe === "string" ? u.profile.aboutMe : "" };
    },

    // recentAcSubmissionList only lists Accepted submissions, newest first.
    async recentAccepted(username) {
      const data = await query(
        "recentAcSubmissions",
        `query recentAcSubmissions($username: String!, $limit: Int!) {
          recentAcSubmissionList(username: $username, limit: $limit) { id titleSlug timestamp }
        }`,
        { username, limit: RECENT_AC_LIMIT },
      );
      const list = data.recentAcSubmissionList;
      if (!Array.isArray(list)) throw new ProviderError("unverifiable", "recent AC list missing");
      const items = list.map((s) => {
        const ts = Number(s?.timestamp);
        if (typeof s?.titleSlug !== "string" || s?.id == null || !Number.isFinite(ts)) {
          throw new ProviderError("unverifiable", "recent AC entry incomplete");
        }
        return { submission_id: String(s.id), slug: s.titleSlug, accepted_at: ts * 1000, status: "Accepted" };
      });
      return { items, limit: RECENT_AC_LIMIT };
    },
  };
}

// Dev-only: any username's profile "contains" the token; usernames ending in "_ac" have an
// Accepted submission for the requested slug one minute ago.
function mockProvider({ now, problemSlug }) {
  return {
    id: "mock",
    version: "mock-v1",
    upstreamCallsPerAttempt: 1,
    async profile(username) {
      return { username, about: "__MOCK_CONTAINS_ANY_TOKEN__" };
    },
    async recentAccepted(username) {
      const items = username.endsWith("_ac") && problemSlug
        ? [{ submission_id: `mock-${now}`, slug: problemSlug, accepted_at: now - 60_000, status: "Accepted" }]
        : [];
      return { items, limit: RECENT_AC_LIMIT };
    },
  };
}

export function getProvider(ctx, problemSlug) {
  const timeoutMs = ctx.config.verification.upstream_timeout_seconds * 1000;
  if (ctx.env.LEETCODE_PROVIDER === "mock") {
    if (ctx.env.DEV_MODE !== "1") throw new Error("mock provider is only allowed with DEV_MODE=1");
    return mockProvider({ now: ctx.now, problemSlug });
  }
  return graphqlProvider({ timeoutMs });
}

export function aboutContainsToken(provider, about, token) {
  return provider.id === "mock" || about.includes(token);
}

// Pure evidence check against the period snapshot: the exact problem, Accepted, submitted within
// the period (docs/product.md, LeetCode Daily).
export function findEvidence(items, period) {
  return (
    items.find(
      (s) =>
        s.status === "Accepted" &&
        s.slug === period.problem.slug &&
        s.accepted_at >= period.starts_at &&
        s.accepted_at < period.ends_at,
    ) || null
  );
}
