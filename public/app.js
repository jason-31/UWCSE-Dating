import { h, fill, api, devUser, setDevUser, toast } from "/lib.js";
import { openCard } from "/card.js";
import { profileForm } from "/profile.js";
import { aboutPage } from "/about.js";
import { privacyPage } from "/privacy.js";
import { t, lang, setLang, RELATIONS } from "/i18n.js";

const app = document.getElementById("app");
let me = null;

async function boot() {
  try {
    me = await api("/api/me");
  } catch (err) {
    renderLangSwitch();
    app.replaceChildren(h("div", { class: "panel" }, h("h2", {}, t("cannot_sign_in")), h("p", {}, err.message)));
    return;
  }
  renderDevBar();
  renderHeader();
  route();
}

// A banned account can only sign out or delete its data.
function renderBanned() {
  const del = h("button", { class: "danger", type: "button" }, t("delete_account"));
  del.onclick = async () => {
    if (!confirm(t("delete_account_confirm"))) return;
    await api("/api/account", { method: "DELETE" });
    location.href = "/";
  };
  fill(
    app,
    h(
      "section",
      { class: "panel narrow" },
      h("h1", {}, t("banned_title")),
      h("p", {}, t("banned_body")),
      del,
    ),
  );
}

// Signed out (Google sign-in): the About page with a sign-in button, plus why a sign-in failed.
function renderSignedOut() {
  if (me.auth !== "google") {
    // Behind Cloudflare Access a missing identity means Access isn't in front of this request.
    app.replaceChildren(h("div", { class: "panel" }, h("h2", {}, t("cannot_sign_in"))));
    return;
  }
  const err = new URLSearchParams(location.search).get("login_error");
  if (err) history.replaceState(null, "", location.pathname + location.hash);
  const key =
    {
      domain: "login_error_domain",
      cancelled: "login_error_cancelled",
      rate_limited: "login_error_rate_limited",
      daily_capacity: "login_error_daily_capacity",
    }[err] || "login_error_other";
  const notice = err && h("p", { class: "panel warn-text" }, t(key));
  app.replaceChildren(aboutPage({ registered: false, signedIn: false, notice }));
}

function renderHeader() {
  const signOut = h("a", { href: "#" }, t("sign_out"));
  signOut.onclick = async (e) => {
    e.preventDefault();
    await api("/api/logout", { method: "POST" });
    location.href = "/";
  };
  fill(
    document.getElementById("whoami"),
    me.signed_in && h("a", { href: "#/about" }, t("about")),
    // The privacy notice is readable before signing in.
    h("a", { href: "#/privacy" }, t("privacy")),
    me.registered && !me.banned ? h("a", { href: "#/profile" }, t("my_profile")) : "",
    me.signed_in && h("span", { class: "muted" }, me.email),
    me.signed_in && me.auth === "google" && signOut,
  );
  renderLangSwitch();
}

function renderLangSwitch() {
  const other = lang === "zh" ? "en" : "zh";
  document.getElementById("lang").replaceChildren(
    // Written in the language it switches to, so it reads for whoever needs it.
    h("button", { type: "button", class: "lang-switch", lang: other, onclick: () => setLang(other) }, other === "en" ? "switch to English" : "切换成中文"),
  );
}

function renderDevBar() {
  if (!me.dev_mode) return;
  const bar = document.getElementById("devbar");
  const input = h("input", { value: devUser(), placeholder: t("dev_placeholder") });
  bar.hidden = false;
  bar.replaceChildren(
    h("strong", {}, t("dev_mode")),
    t("dev_as"),
    input,
    h("button", { onclick: () => { setDevUser(input.value.trim()); location.reload(); } }, t("switch")),
  );
}

// Cloudflare Access proved the email; unknown emails register here by creating the site-wide
// profile. The email itself is fixed to the login email.
async function renderRegister() {
  if (!me.email_allowed) {
    app.replaceChildren(
      h(
        "section",
        { class: "panel narrow" },
        h("h1", {}, t("cannot_register")),
        h("p", {}, t("email_not_allowed_pre"), h("strong", {}, me.email), t("email_not_allowed_post")),
      ),
    );
    return;
  }
  const { schema } = await api("/api/profile/schema");
  // Before registering, the only data kept is an avatar upload (and the sign-in session).
  const delUploads = h("button", { class: "danger", type: "button" }, t("delete_uploads"));
  delUploads.onclick = async () => {
    if (!confirm(t("delete_uploads_confirm"))) return;
    await api("/api/account", { method: "DELETE" });
    location.href = "/";
  };
  const accept = h("input", { type: "checkbox" });
  const terms = h(
    "div",
    { class: "terms" },
    h("h3", {}, t("site_rules")),
    h("ul", { class: "rules" }, ["rule1", "rule2", "rule3", "rule4"].map((r) => h("li", {}, t(r)))),
    // Opens in a new tab so the form being filled in is kept.
    h("p", { class: "muted small" }, t("privacy_pre"), h("a", { href: "/#/privacy", target: "_blank", rel: "noopener" }, t("privacy_link")), t("privacy_post")),
    h("label", { class: "check" }, accept, t("accept_rules")),
  );
  app.replaceChildren(
    h("h1", {}, t("welcome")),
    h("p", {}, t("welcome_pre"), h("strong", {}, me.email), t("welcome_post")),
    profileForm({
      schema,
      email: me.email,
      title: t("profile"),
      submitLabel: t("register"),
      extra: [terms],
      onSubmit: async (profile) => {
        if (!accept.checked) return toast(t("accept_rules_first"), "warn");
        try {
          await api("/api/register", { method: "POST", body: { accept_terms: true, profile } });
          me = await api("/api/me");
          renderHeader();
          location.hash = "#/";
          route();
        } catch (err) {
          toast(err.message, "error");
        }
      },
    }),
    h("section", { class: "panel" }, h("p", { class: "muted small" }, t("unregistered_uploads")), delUploads),
  );
}

async function renderProfile() {
  const data = await api("/api/profile");
  const del = h("button", { class: "danger", type: "button" }, t("delete_account"));
  del.onclick = async () => {
    if (!confirm(t("delete_account_confirm"))) return;
    await api("/api/account", { method: "DELETE" });
    location.hash = "#/";
    location.reload();
  };
  app.replaceChildren(
    profileForm({
      schema: data.schema,
      profile: data.profile,
      email: me.email,
      lockedUntil: data.locked_until,
      latestUpload: data.latest_upload,
      title: t("my_profile"),
      intro: t("profile_intro"),
      submitLabel: t("save_profile"),
      onSubmit: async (profile) => {
        try {
          await api("/api/profile", { method: "PUT", body: profile });
          toast(t("saved"), "ok");
          renderProfile();
        } catch (err) {
          toast(err.message, "error");
        }
      },
    }),
    h("section", { class: "panel" }, h("h2", {}, t("account")), del),
  );
}

// One person in a home-page section: avatar and nickname; the card opens on click.
function personItem(m) {
  return h(
    "li",
    {},
    h(
      "button",
      { type: "button", class: "person", onclick: () => openCard(m) },
      h("img", { loading: "lazy", decoding: "async", src: m.avatar_url, alt: "" }),
      h("span", { class: "name" }, m.nickname),
    ),
  );
}

// A relation section shows the first page the server sent; "Show more" asks for the next ones.
// The list can change between requests, so people already shown are skipped (emails are unique).
function relationSection({ relation, total, people }) {
  const shown = new Set(people.map((m) => m.email));
  let offset = people.length;
  const list = h("ul", { class: "people" }, people.map(personItem));
  const more = h("button", { type: "button", class: "more" }, t("show_more"));
  more.hidden = offset >= total;
  more.onclick = async () => {
    more.disabled = true;
    try {
      const next = await api(`/api/people?relation=${encodeURIComponent(relation)}&offset=${offset}`);
      offset += next.people.length;
      list.append(...next.people.filter((m) => !shown.has(m.email)).map((m) => (shown.add(m.email), personItem(m))));
      more.hidden = !next.people.length || offset >= next.total;
    } catch (err) {
      toast(err.message, "error");
    } finally {
      more.disabled = false;
    }
  };
  return h(
    "section",
    { class: "panel relation-group" },
    h("h2", {}, RELATIONS[relation], h("span", { class: "muted small count" }, t("people_count", { n: total }))),
    total ? [list, more] : h("p", { class: "muted small" }, t("no_people_rel")),
  );
}

// Home: open challenges on the left; on the right everyone this user can browse right now,
// merged across lists without saying where they were met. Details open on click.
async function renderHome() {
  const [{ challenges }, { sections }] = await Promise.all([api("/api/challenges"), api("/api/people")]);
  const challengeCol = h(
    "section",
    { class: "home-col" },
    h("h1", {}, t("challenge_title")),
    h("p", { class: "muted" }, t("challenge_intro")),
    challenges.length
      ? challenges.map((s) =>
          h(
            "a",
            { class: "panel challenge-card", href: `#/c/${encodeURIComponent(s.challenge_id)}` },
            h("h2", {}, s.name),
            h("p", {}, s.description),
            h("p", { class: "muted small" }, s.refresh_rule),
          ),
        )
      : h("p", { class: "muted" }, t("no_challenge")),
  );
  // One section per relation the viewer seeks; someone sharing several relations with the
  // viewer appears in each of those sections.
  const peopleCol = h(
    "section",
    { class: "home-col" },
    h("h1", {}, t("people_title")),
    h("p", { class: "muted" }, t("people_intro")),
    sections.some((s) => s.total) ? sections.map(relationSection) : h("div", { class: "panel" }, h("p", { class: "muted" }, t("no_people"))),
  );
  app.replaceChildren(h("div", { class: "home" }, challengeCol, peopleCol));
}

async function renderChallenge(challengeId) {
  const { challenges } = await api("/api/challenges");
  const s = challenges.find((x) => x.challenge_id === challengeId);
  if (!s) {
    app.replaceChildren(h("p", {}, t("challenge_missing")), h("a", { href: "#/" }, t("back_home")));
    return;
  }
  const mod = await import(s.frontend);
  const root = h("div");
  app.replaceChildren(root);
  await mod.mount(root, { challengeId, challenge: s });
}

// Each navigation renders a new page; start it at the top rather than at the old scroll position.
async function route() {
  await renderRoute();
  window.scrollTo(0, 0);
}

async function renderRoute() {
  if (!me) return;
  if (location.hash === "#/privacy") return app.replaceChildren(privacyPage());
  if (!me.signed_in) return renderSignedOut();
  if (me.banned) return renderBanned();
  // Unregistered visitors read the About page first, then register from there.
  if (!me.registered) {
    if (location.hash === "#/register") return renderRegister();
    app.replaceChildren(aboutPage({ registered: false }));
    return;
  }
  const m = location.hash.match(/^#\/c\/([^/]+)/);
  app.replaceChildren(h("p", { class: "muted" }, t("loading")));
  try {
    if (location.hash === "#/profile") await renderProfile();
    else if (location.hash === "#/about") app.replaceChildren(aboutPage({ registered: true }));
    else if (m) await renderChallenge(decodeURIComponent(m[1]));
    else await renderHome();
  } catch (err) {
    app.replaceChildren(h("div", { class: "panel" }, h("p", {}, err.message)));
  }
}

window.addEventListener("hashchange", route);
boot();
