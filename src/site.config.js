// Site-wide configuration. The personal profile (relations, contacts, avatar...) is shared by
// every challenge; challenges only collect what is specific to them (e.g. a LeetCode account).
export const SITE = {
  profile: {
    schema_version: 1,
    relation_options: ["FRIENDSHIP", "STUDY", "ROMANCE"],
    // Basic info (always shown on cards): gender and program are required single choices.
    // PREFER_NOT_TO_SAY is an ordinary gender value, shown as such and usable in filters.
    gender_options: ["MALE", "FEMALE", "NON_BINARY", "PREFER_NOT_TO_SAY"],
    // Allen School programs. Labels live in the UI.
    program_options: ["BS_CS", "BS_CE", "BS_MS", "PMP", "PHD", "STAFF"],
    // Relations sought and per-relation filters share one lock: after changing either, a user
    // must wait this long before changing either again.
    matching_change_cooldown_days: 7,
    // Nickname, gender and program share one lock as well (the avatar can change any time).
    basic_change_cooldown_days: 30,
    // Deployment-specific; overridable with the ALLOWED_EMAIL_DOMAINS env var.
    allowed_email_domains: ["cs.washington.edu"],
  },
};
