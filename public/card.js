import { h } from "/lib.js";
import { t, RELATIONS, FIELDS, PROGRAMS, GENDERS } from "/i18n.js";

// A member card as filtered by the server: basic info and "about me" are always present; notes
// and contact fields only for the shared relations the owner opened them to.
export function personCard(m) {
  const f = m.fields;
  const notes = m.common_relations
    .filter((r) => m.relation_notes?.[r])
    .map((r) => h("div", { class: "note" }, h("span", { class: "muted small" }, t("note_title", { rel: RELATIONS[r] })), h("p", {}, m.relation_notes[r])));
  const contact = (label, v) => v && h("div", { class: "contact" }, h("span", { class: "muted small" }, label), " ", v);
  return h(
    "article",
    { class: "card" },
    h("img", { class: "avatar", loading: "lazy", decoding: "async", src: m.avatar_url, alt: "" }),
    h("h3", {}, m.nickname),
    h("div", { class: "chips" }, m.common_relations.map((r) => h("span", { class: "chip tag" }, RELATIONS[r]))),
    h("p", { class: "small" }, `${GENDERS[m.gender] || m.gender} · ${PROGRAMS[m.program] || m.program}`),
    m.research && h("p", { class: "small" }, t("research_prefix"), m.research),
    m.bio && h("p", { class: "bio" }, m.bio),
    notes.length > 0 && h("div", { class: "notes" }, notes),
    contact(FIELDS.email, m.email),
    contact(FIELDS.wechat, f.wechat),
    contact(FIELDS.discord, f.discord),
  );
}

// Opens a card in a modal dialog; closes on the button, Esc or a click outside.
export function openCard(m) {
  const close = h("button", { type: "button", class: "dialog-close", "aria-label": t("close") }, "×");
  const dlg = h("dialog", { class: "card-dialog" }, close, personCard(m));
  close.onclick = () => dlg.close();
  dlg.onclick = (e) => {
    if (e.target === dlg) dlg.close();
  };
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}
