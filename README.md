# UWCSE.date

A small social site for the UW Allen School community. Members take part in daily challenges: a check-in, or one LeetCode problem that is the same for everyone. Everyone on a day's list who is looking for the same kind of relationship (friendship, a study buddy, or a long-term romantic relationship; the site does not support looking for short-term ones) can see each other's cards, with the contact details each person chose to share.

UWCSE.date is an unofficial site run independently by an individual. It is not a service of the Paul G. Allen School or the University of Washington and is not managed or endorsed by them.

The site is in a closed beta at https://uwcse.date. Contact: chines_cells_9s@icloud.com.

## How it works

- **Sign-in.** Google accounts in the `cs.washington.edu` Workspace only. The sign-in email is the account and is shown on every card, so people stay accountable for what they post.
- **One profile for the whole site.** Nickname, gender, program, avatar, what you are looking for, optional per-relation filters on gender and program, a note per relation, WeChat and Discord (shown only to the relations you choose), research interests and a bio. What you are looking for and your filters can change once a week; nickname, gender, program and avatar once a month.
- **Challenges and lists.** Each challenge has one task per day, the same for everyone. Doing it (for LeetCode, an Accepted submission the server confirms on your verified account; for the check-in, checking in) puts you on that day's list if you agreed to be listed. Only people on today's list can browse it, and they only see people who seek a relation they also seek and who pass each other's filters for it.
- **Home page.** Everyone you can see today, across all challenges, grouped by relation. It never says which challenge or list someone came from.
- **No messaging.** There are no messages, likes, matches or view records, on the site or in the database. People reach each other through the contact details they share.

The full product rules and acceptance scenarios are in [docs/product.md](docs/product.md).

## Privacy

- Everything that identifies or describes a person is encrypted at rest, under keys derived from the `DATA_KEY` Worker secret, and rows are found by keyed hashes. Reading the database or the avatar bucket directly yields ciphertext, hashes and metadata only.
- There is no admin UI or endpoint that lists or shows profiles, and logs never contain personal data (both are tested).
- The privacy notice shown on the site (`/#/privacy`, source in `public/privacy.js`) tells users what is stored, who can see it, how long it is kept and what is not protected yet.
- [docs/oversight.md](docs/oversight.md) sets out the goal and the rules: open source, deployment only from public CI, a key nobody holds, a published operator audit log and a verifiable front end. Several rules are not implemented yet; that document says which, and the site makes no claims based on them until they are.

## Stack

Cloudflare Workers serves the API and the static front end, with D1 (SQLite) for data, R2 for uploaded avatars, Workers Rate Limiting bindings and Cron Triggers. The front end is plain ES modules in `public/`, served as-is with no build step, so the live files can be compared with this repository (`scripts/check-frontend.mjs`).

## Repository layout

| Path | Contents |
|---|---|
| `src/index.js` | Worker entry: routing, the platform API, scheduled jobs |
| `src/platform/` | sign-in and sessions, profiles and matching, encryption (`vault.js`), avatars, caches, rate limits, bans, clean-up |
| `src/modules/` | challenge modules: `leetcode` and `checkin` |
| `src/site.config.js`, `src/challenges.config.js` | site and challenge configuration |
| `public/` | the front end |
| `migrations/` | D1 migrations (append-only) |
| `scripts/` | `ban.mjs` (moderation), `check-frontend.mjs` (compare the live front end with a commit) |
| `test/` | unit and integration tests; the integration tests run the Worker against an in-memory SQLite stand-in for D1 |
| `docs/` | product rules, the challenge module guide, oversight rules, the deployment checklist |

## Development

Requires Node.js 22.13 or later.

```sh
npm install
cp .dev.vars.example .dev.vars   # DEV_MODE=1 and a mock LeetCode data source
npm run migrate:local            # applies migrations to the local D1 copy in .wrangler/
npm run dev                      # http://localhost:8787
npm test
```

With `DEV_MODE=1`, a request to localhost may choose who it is (use the bar at the top of the page), and encryption falls back to a fixed development key. Neither works anywhere else: on any other host `DEV_MODE` is ignored, and without `DATA_KEY` the API refuses to handle personal data.

To add a challenge, start with [docs/challenge.md](docs/challenge.md).

## Deployment and operations

[docs/deploy.md](docs/deploy.md) is the checklist for setting up an environment (bindings, secrets, migrations, rate limits, Google OAuth, Cloudflare Access, CI) and for day-to-day operation. To ban someone, run `npm run ban -- add someone@cs.washington.edu "reason" --remote`; the Worker applies the ban within five minutes.

## License

[GNU Affero General Public License v3.0](LICENSE). Anyone may use, change and run this code, but whoever runs a modified version as a service must publish their source too.
