# Product rules

What UWCSE.date does and must keep doing. The module guide ([challenge.md](challenge.md)) covers how a challenge is built; the oversight rules ([oversight.md](oversight.md)) cover who can see what behind the scenes. Where this document and the code disagree, one of them has a bug.

UWCSE.date is an unofficial site run independently by an individual; it is not a service of the Paul G. Allen School or the University of Washington, and the About page says so first. The site lets people who completed the same task on the same day, and who want the same kind of relationship, find each other and reach out through contact details they chose to share. It does not host conversations.

## Accounts

- **Sign-in** is with Google, limited to Workspace accounts of the configured domains (`cs.washington.edu`); the `hd` claim is checked, so personal Google accounts that use a school address are refused. (Cloudflare Access can be used instead when Google sign-in is not configured.)
- **Registration.** A signed-in email that has not registered sees the About page, then registers by filling in the profile and accepting the site rules. The account's email is always the sign-in email; it cannot be chosen.
- **Deleting the account** removes every challenge's data, uploaded avatars, the profile, the identity and all sessions. If a profile change lock is still running, the same email cannot register again until it would have expired, so deleting and re-registering cannot reset the locks.
- **Bans** are permanent and keyed by email, so deleting the account does not lift them. A banned person can only sign out and delete their data, and their card disappears from every list at once.
- Someone who signed in but never registered can delete what they uploaded; uploads no profile uses are deleted after a day anyway.

## Profile

One profile per person, shared by every challenge. Challenges never collect personal details of their own.

| Field | Rules | Shown on a visible card |
|---|---|---|
| Email | The sign-in email; cannot be changed | Always, so people stay accountable for what they post |
| Nickname | Required, at most 30 characters; basic info | Always |
| Gender | Required: male, female, non-binary or prefer not to say; basic info | Always. "Prefer not to say" is an ordinary value, shown as such and usable in filters |
| Program | Required, one Allen School program: BS in Computer Science, BS in Computer Engineering, BS/MS, PMP, PhD, Staff; basic info | Always |
| Avatar | Required: a preset or one's own upload; basic info | Always |
| Looking for | Required, one or more of friendship, study buddy, dating or romance | As the relations both people share |
| Filters | Optional, per relation sought, by gender and program. Everything ticked means no restriction; each filter keeps at least one value | Never; they decide who sees whom (below) |
| What you hope for | Optional, one note per relation sought, length at most 400 | Only to people who share that relation |
| WeChat, Discord | Optional, at most 64 characters each | Only to the relations the owner opens them to; dating only by default |
| Research interests, bio | Optional, length at most 240 and 600 | Always, when filled in |

- **Length** of the free-text fields is weighted: letters and digits count 1, Chinese and other full-width characters (and emoji) count 2. A Chinese and an English text at the limit say about as much and take about as much room on a card.
- **Change locks.** What you are looking for and your filters share one lock: after either changes, neither can change again for 7 days. Nickname, gender, program and avatar share another lock of 30 days. Both start at registration, and a lock only restarts when a field in its group actually changes. Other fields can change at any time.
- **Avatar uploads.** The browser crops the image to a centred square, scales it to 256×256 and re-encodes it, which also strips metadata such as location. The server identifies the format from the bytes (PNG, JPEG or WebP; never SVG), requires exactly 256×256 and at most 512 KB, and allows 5 upload attempts per email in any 30 days, failed ones included. Uploads are refused while the 30-day lock runs, since they could not be saved. A profile can only use its owner's upload; only the upload in use and the latest unsaved one are kept.
- Profiles persist until changed or deleted. Nobody is asked to confirm anything daily.

## Who sees whom

- Two people see each other under a relation when **both seek it** and **each passes the other's filters** for it. These are their common relations. With no common relation, the API returns nothing about the other person: no card, avatar or count.
- A visible card shows the basic info, research interests and bio; WeChat and Discord when the owner opened them to one of the common relations; and the notes for the common relations.
- Filters only use gender and program, which every card shows anyway, so matching never depends on hidden information.
- Because filters are two-way, someone who can see you under a relation learns that you accept their gender (and program) for it. For dating this can reveal sexual orientation. The profile form and the About page say so.
- All filtering happens on the server; nothing is sent to the browser to be hidden there.

Examples: A seeks friendship and dating, B only friendship, C only dating. A and B see each other under friendship, A and C under dating, B and C not at all. If A opens WeChat to dating only (the default), C sees it and B does not; A's friendship note is shown to B and not to C.

## Challenges

Rules every challenge follows:

- **The same task for everyone in a period.** The task depends only on the challenge's configuration and the period, is fixed once drawn, and is never re-drawn for anyone.
- **Completion is decided by the server** from evidence it obtains itself. Screenshots, self-reports and client-supplied data prove nothing.
- **Explicit consent to be listed.** Every challenge offers the same per-person choice, "Join this period's list automatically": always, ask each time, or never. Joining by hand stays possible with never.
- **Browsing a list requires being on it**, actively, with a complete profile. A list closes when its period ends (a challenge may allow a short look-back for that period's members).
- Leaving a list is always possible. Challenges never read each other's data, and nothing earned in one counts in another.

The **home page** shows, on the left, the open challenges; on the right, everyone the viewer can browse right now through any list, de-duplicated and grouped by the viewer's relations. Someone sharing several relations with the viewer appears under each. Each group shows its first 24 people, with "Show more" for the rest. Where someone was met is never shown.

### LeetCode Daily

- **Period**: a calendar day in Los Angeles time. **Problem**: drawn once per period at random from the free Easy and Medium problems of the configured pool, avoiding the last 30 periods' problems.
- **Joining**: accept the challenge rules and choose whether a verified completion joins that day's list: always, ask each time (the page asks right after verifying), or never.
- **Account ownership**: the person adds a one-time token (valid 30 minutes) to their LeetCode profile ReadMe and the server reads it. One LeetCode account per person per challenge. No LeetCode password, cookie or code is ever collected. The account used for a period is locked at that period's first check.
- **Completion**: the server looks for an Accepted submission of the period's exact problem, made during the period, among the locked account's recent Accepted submissions. A submission from before the period does not count. Results: verified, not found yet, cannot verify, data source unavailable, invalid request. "Not found" never means "did not solve it".
- Checks are user-triggered, with a 60-second cooldown per person and a per-minute cap for the challenge. A check accepted before the period ends may finish up to 60 seconds after, for the old period only.
- Verifying proves that an Accepted submission exists on that account. It does not prove the person solved the problem alone.
- Leaving today's list is possible at any time; checking again does not put someone back, rejoining is a separate, explicit action.
- **Data source**: LeetCode's GraphQL endpoint. Verification can be paused (`verification.paused`) without affecting lists and history.
- Badges and a look-back at yesterday's list are implemented but switched off.

### Daily Check-in

- Check in once per day (Los Angeles time). With "Join this period's list automatically" set to always (the default), checking in also joins that day's list; with ask, the page offers "check in and join" and "just check in", and the server refuses a check-in without an answer; with never, it only records the check-in, and joining is a separate action.
- Leave and rejoin as often as wanted within the day. The list closes at midnight.
- Each person sees their own history and current streak; a day not yet checked in does not break the streak.

## Moderation

- Bans are made from the command line (`scripts/ban.mjs`) and applied by the Worker within five minutes. There is no admin UI, and no list of banned emails can be read back.
- Contact for questions, reports and data requests: chines_cells_9s@icloud.com (in the privacy notice). Still to come: a per-viewer block list.

## Data kept and for how long

- Everything personal is encrypted at rest (see [oversight.md](oversight.md), rule 5).
- History that people see as theirs (check-ins, completions, list memberships) is kept until they delete it.
- The daily clean-up deletes: expired sessions (30 days after sign-in); uploads no profile uses, after a day; LeetCode verification attempts after 7 days; binding tokens once expired; upload-attempt counts after 30 days; deletion tombstones once the locks they protect have expired.

## Deliberately not built

Messages, likes, connection requests, matches, "who viewed me" or any record of who looked at whom; an admin interface that lists or shows profiles; site-wide search of members.

## Acceptance scenarios

| # | Scenario | Expected |
|---|---|---|
| A00 | An unregistered email signs in | Asked to register; the account email is the sign-in email, any other email in the request is ignored; other domains cannot sign in |
| A01 | First participation | Register with a full profile, then verify the LeetCode account and accept the challenge rules, before any check or listing |
| A02 | The next day | The profile and challenge settings carry over; nothing is asked again |
| A03 | Many people open the challenge at once, or the first request of a day races | Everyone gets the same problem, stored once |
| A04 | Someone solved today's problem before this period | It does not count until submitted and Accepted again this period |
| A05 | The client claims completion, a time or a problem | Ignored; only server-obtained evidence counts |
| A06 | Someone enters another person's LeetCode username | No listing before ownership is verified |
| A07 | The right account gets the problem Accepted this period | Exactly one completion and one list membership |
| A08 | Accepted on another problem, or outside the period | Not verified |
| A09 | No matching submission among the recent ones | "Not found yet" or "cannot verify", never "did not solve" |
| A10 | The data source times out, rate-limits or changes shape | Reported as unavailable; no completion or badge granted |
| A11 | Repeated or concurrent checks | Completion, membership and badges stay single |
| A12 | Two people share only friendship | Cards and friendship notes visible; WeChat or Discord opened to dating only, and dating notes, are not |
| A13 | Both seek dating and the owner opened a contact field to it | That field is shown |
| A14 | No common relation, or the viewer is not on the list | List and card endpoints reveal nothing about the other person |
| A15 | Someone leaves today's list and checks again | They stay off the list until they rejoin explicitly |
| A16 | A new day, including a daylight-saving change | A new period by Los Angeles midnight; yesterday's membership does not carry over |
| A17 | A check in flight when the period ends | Finishes within 60 seconds for the old period only |
| A18 | Look-back off or expired | Other people's cards for that period are unavailable; one's own history remains |
| A19 | Someone narrows a contact field or leaves a challenge | Every list that still shows them reflects it on the next request |
| A20 | Another challenge or a test module is configured | It cannot read this challenge's data; the profile is shared |
| A21 | Configuration or module changes | Published periods keep their problem and rules; other challenges are unaffected |
| A22 | Relations or filters changed again within 7 days | Refused with the time they can change; other fields still save |
| A23 | A's dating filter: women, BS or BS/MS; B: a woman in the PhD program; both seek friendship and dating | They see each other under friendship only |
| A24 | B chose "prefer not to say"; A's dating filter has only women | Not visible to each other under dating until A also ticks "prefer not to say" |
| A25 | Avatar changed, then nickname, gender or program within 30 days | Refused with the time it can change; relations, contacts and "about me" still save |
| A26 | Upload attempts beyond 5 in 30 days, or deleting the upload or account in between | Refused with the date of the next allowed upload; deleting restores nothing |
| A27 | An account is deleted and registered again with the same email | Refused until the deleted profile's locks would have expired |
| A28 | Someone is banned | Within five minutes they can only sign out or delete their data, and their card is gone from every list |
| A29 | The database and avatar bucket are read directly | No email, profile field, contact, note, LeetCode username, ban reason or image appears in the clear |
| A30 | A session row is inserted or edited without `DATA_KEY` | It signs no one in |
| A31 | "Join this period's list automatically" is ask, never or always | Ask: nobody is listed or left off without an answer; never: completing the task never lists anyone, joining by hand still works; always: completing the task lists them |

A LeetCode-backed launch also needs the positive and failure cases above run against the real data source; mocks alone do not show that completions can be verified.
