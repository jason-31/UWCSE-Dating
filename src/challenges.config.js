// Challenge registry. Each entry is an independent business space backed by a module.
// Enabling/disabling a challenge or changing future-period parameters is done here; bump
// config_version so new periods snapshot the change while published periods keep theirs.
export const CHALLENGES = [
  {
    challenge_id: "leetcode-daily",
    module_id: "leetcode",
    config_version: 1,
    enabled: true,

    schedule: {
      kind: "calendar_day",
      timezone: "America/Los_Angeles",
    },

    problem_pool: {
      version: "pool-v1",
      site: "leetcode.com",
      paid_only: false,
      difficulties: ["Easy", "Medium"],
      exclude_recent_periods: 30,
    },

    completion: {
      require_account_ownership: true,
      require_accepted_in_current_period: true,
      auto_join_after_verified_with_consent: true,
    },

    members: {
      page_size: 20,
    },

    badges: {
      enabled: false,
      milestones: [5, 20],
    },

    verification: {
      // true stops every request to LeetCode (ownership and daily checks) while lists, history
      // and everything else keep working.
      paused: false,
      cooldown_seconds: 60,
      upstream_timeout_seconds: 8,
      max_upstream_requests_per_attempt: 2,
      closing_settlement_seconds: 60,
      challenge_attempts_per_minute: 120,
      binding_token_ttl_minutes: 30,
    },
  },

  {
    challenge_id: "daily-checkin",
    module_id: "checkin",
    config_version: 1,
    enabled: true,
    schedule: {
      kind: "calendar_day",
      timezone: "America/Los_Angeles",
    },
    members: {
      page_size: 20,
    },
  },
];
