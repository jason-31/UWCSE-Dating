import { h, fill, apiUpload, toast } from "/lib.js";
import { t, RELATIONS, FIELDS, PROGRAMS, GENDERS, fmtDateTime } from "/i18n.js";
import { textWeight } from "/text-weight.js";

// Site-wide profile form. The email is the sign-in email: read-only and always on the card.
// onSubmit(values) returns a promise; extra nodes are rendered just above the submit button.
export function profileForm({ schema, profile, email, title, intro, submitLabel, extra = [], lockedUntil = {}, onSubmit }) {
  // Relations sought and filters share one change lock.
  const matchingLockedUntil = lockedUntil.matching || 0;
  const matchingLocked = matchingLockedUntil > Date.now();
  // Basic info (nickname, gender, program, avatar) has its own, longer lock.
  const basicLockedUntil = lockedUntil.basic || 0;
  const basicLocked = basicLockedUntil > Date.now();
  const p = profile || {
    nickname: "",
    avatar: "uw",
    relations: [],
    relation_notes: {},
    relation_filters: {},
    visibility: Object.fromEntries(Object.entries(schema.visibility_rules).map(([k, v]) => [k, v.default])),
  };
  const state = {
    avatar: p.avatar,
    relations: new Set(p.relations),
    filters: structuredClone(p.relation_filters || {}),
    vis: structuredClone(p.visibility),
  };
  const spec = Object.fromEntries(schema.fields.map((f) => [f.name, f]));
  const noteMax = spec.relation_notes.max;

  // Presets plus the user's own upload (if any). Uploads are cropped to a centred square and
  // re-encoded in the browser, which also strips metadata such as EXIF location.
  const avatarPicker = h("div", { class: "avatar-picker" });
  const options = schema.avatars.map((a) => ({ id: a.id, url: a.url }));
  if (p.avatar?.startsWith("upload:")) options.push({ id: p.avatar, url: p.avatar_url });
  const fileInput = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp", hidden: true });
  const uploadBtn = h("button", { type: "button", class: "avatar-upload" }, t("upload_avatar"));
  uploadBtn.onclick = () => fileInput.click();
  fileInput.onchange = async () => {
    const file = fileInput.files[0];
    fileInput.value = "";
    if (!file) return;
    uploadBtn.disabled = true;
    uploadBtn.textContent = t("uploading");
    try {
      const px = schema.avatar_upload.size_px;
      const blob = await squareImage(file, px);
      if (blob.size > schema.avatar_upload.max_bytes) throw new Error(t("image_too_large"));
      // Confirm the encoded result really is px×px before sending it (the server checks again).
      const check = await createImageBitmap(blob);
      const ok = check.width === px && check.height === px;
      check.close();
      if (!ok) throw new Error(t("image_unreadable"));
      const res = await apiUpload("/api/avatars", blob);
      const i = options.findIndex((o) => o.id.startsWith("upload:"));
      if (i >= 0) options.splice(i, 1);
      options.push({ id: res.avatar, url: res.url });
      state.avatar = res.avatar;
      renderAvatars();
    } catch (err) {
      toast(err.message, "error");
    } finally {
      uploadBtn.disabled = false;
      uploadBtn.textContent = t("upload_avatar");
    }
  };
  function renderAvatars() {
    fill(
      avatarPicker,
      ...options.map((a) =>
        h(
          "button",
          {
            type: "button",
            class: a.id === state.avatar ? "avatar-opt selected" : "avatar-opt",
            disabled: basicLocked && a.id !== state.avatar,
            title: a.id.startsWith("upload:") ? t("my_upload") : a.id,
            onclick: () => {
              state.avatar = a.id;
              renderAvatars();
            },
          },
          h("img", { src: a.url, alt: "" }),
        ),
      ),
      !basicLocked && uploadBtn,
      fileInput,
    );
  }
  renderAvatars();

  const input = (name, attrs = {}) => h("input", { name, value: p[name] || "", ...attrs });
  const nickname = input("nickname", { maxlength: 30, required: true, readOnly: basicLocked });
  const wechat = input("wechat", { maxlength: 64 });
  const discord = input("discord", { maxlength: 64 });
  // Gender and program: required single choices, rendered as radio chips.
  const radioChips = (name, labels) =>
    h(
      "div",
      { class: "chips" },
      schema.fields
        .find((f) => f.name === name)
        .options.map((code) =>
          h("label", { class: "chip" }, h("input", { type: "radio", name, value: code, checked: p[name] === code, disabled: basicLocked }), " ", labels[code] || code),
        ),
    );
  const genderRadios = radioChips("gender", GENDERS);
  const programRadios = radioChips("program", PROGRAMS);
  // Weighted limits (a Chinese character counts 2) are never below the plain length, so
  // maxlength stays as a coarse cap and the counter shows the real one.
  const research = input("research", { maxlength: spec.research.max, placeholder: t("research_placeholder") });
  const bio = h("textarea", { name: "bio", maxlength: spec.bio.max, rows: 3 }, p.bio || "");

  // One optional note per relation, shown while that relation is selected. Kept in memory when
  // unticked so re-ticking restores it; only selected relations are submitted.
  const notes = Object.fromEntries(
    schema.relation_options.map((o) => [
      o.value,
      h("textarea", { maxlength: noteMax, rows: 2, placeholder: t("note_placeholder") }, p.relation_notes?.[o.value] || ""),
    ]),
  );
  // Per-relation filters. Every option starts ticked (no restriction, stored as absent);
  // unticking narrows who you and the other person see each other as. A row can't be emptied.
  const filterLabels = { gender: GENDERS, program: PROGRAMS };
  function filterRow(rel, fieldName) {
    const all = schema.filter_options[fieldName];
    const boxes = all.map((value) =>
      h("input", { type: "checkbox", value, checked: state.filters[rel]?.[fieldName]?.includes(value) ?? true, disabled: matchingLocked }),
    );
    for (const cb of boxes) {
      cb.onchange = () => {
        const picked = boxes.filter((b) => b.checked).map((b) => b.value);
        if (!picked.length) {
          cb.checked = true;
          return toast(t("filter_need_one"), "warn");
        }
        const f = (state.filters[rel] ||= {});
        if (picked.length === all.length) delete f[fieldName];
        else f[fieldName] = picked;
        updatePreview();
      };
    }
    return h(
      "div",
      { class: "vis" },
      h("span", { class: "muted small filter-label" }, t(`label_${fieldName}`)),
      boxes.map((cb) => h("label", { class: "chip small" }, cb, " ", filterLabels[fieldName][cb.value] || cb.value)),
    );
  }

  // One block per relation (note + filters), built once and shown while that relation is ticked.
  const relationBlocks = Object.fromEntries(
    schema.relation_options.map((o) => [
      o.value,
      h(
        "div",
        { class: "field relation-block" },
        h("label", {}, t("relation_block", { rel: RELATIONS[o.value] })),
        h("div", { class: "muted small" }, t("note_label")),
        notes[o.value],
        counter(notes[o.value], noteMax),
        h("p", { class: "muted small" }, t("note_hint")),
        h("div", { class: "muted small filter-title" }, t("filter_title")),
        filterRow(o.value, "gender"),
        filterRow(o.value, "program"),
        h("p", { class: "muted small" }, t("filter_hint")),
      ),
    ]),
  );
  const noteFields = h("div");
  function renderNotes() {
    noteFields.replaceChildren(...schema.relation_options.filter((o) => state.relations.has(o.value)).map((o) => relationBlocks[o.value]));
  }

  const relationBoxes = h(
    "div",
    { class: "chips" },
    schema.relation_options.map((o) => {
      const cb = h("input", { type: "checkbox", checked: state.relations.has(o.value), disabled: matchingLocked });
      cb.onchange = () => {
        cb.checked ? state.relations.add(o.value) : state.relations.delete(o.value);
        renderNotes();
        updatePreview();
      };
      return h("label", { class: "chip" }, cb, " ", RELATIONS[o.value]);
    }),
  );
  const relationNote = h(
    "p",
    { class: matchingLocked ? "warn-text small" : "muted small" },
    matchingLocked
      ? t("matching_locked", { time: fmtDateTime(matchingLockedUntil) })
      : t("matching_cooldown", { days: schema.matching_change_cooldown_days }),
  );

  function visControl(field) {
    const rule = schema.visibility_rules[field];
    return h(
      "div",
      { class: "vis" },
      h("span", { class: "muted small" }, t("show_to")),
      rule.allowed.map((rel) => {
        const cb = h("input", { type: "checkbox", checked: (state.vis[field] || []).includes(rel) });
        cb.onchange = () => {
          const set = new Set(state.vis[field] || []);
          cb.checked ? set.add(rel) : set.delete(rel);
          state.vis[field] = rule.allowed.filter((r) => set.has(r));
          updatePreview();
        };
        return h("label", { class: "chip small" }, cb, " ", RELATIONS[rel]);
      }),
    );
  }

  const preview = h("div", { class: "preview" });
  function updatePreview() {
    const rows = [...state.relations].map((rel) => {
      const shown = Object.keys(FIELDS).filter((f) => (state.vis[f] || []).includes(rel));
      const items = [...shown.map((f) => FIELDS[f]), notes[rel].value.trim() && t("preview_note")].filter(Boolean);
      const f = state.filters[rel] || {};
      const only = ["gender", "program"]
        .filter((k) => f[k]?.length)
        .map((k) => f[k].map((v) => filterLabels[k][v] || v).join(" / "));
      return h(
        "li",
        {},
        h("strong", {}, RELATIONS[rel]),
        t("preview_row"),
        items.length ? t("sep") + items.join(t("sep")) : "",
        h("div", { class: "muted small" }, only.length ? t("preview_only", { only: only.join("；") }) : t("preview_any")),
      );
    });
    preview.replaceChildren(
      h("h3", {}, t("preview")),
      rows.length ? h("ul", {}, rows) : h("p", { class: "muted" }, t("preview_empty")),
      h("p", { class: "muted small" }, t("preview_footer")),
    );
  }
  for (const n of Object.values(notes)) n.oninput = updatePreview;
  renderNotes();
  updatePreview();

  const field = (label, control, extra) => h("div", { class: "field" }, h("label", {}, label), control, extra);
  const section = (heading, hint, ...children) =>
    h("fieldset", { class: "form-section" }, h("legend", {}, heading), hint && h("p", { class: "muted small" }, hint), children);

  const save = h("button", { class: "primary", type: "submit" }, submitLabel);
  const form = h(
    "form",
    { class: "panel form" },
    h("h2", {}, title),
    intro && h("p", { class: "muted small" }, intro),
    section(
      t("sec_basic"),
      basicLocked
        ? h("span", { class: "warn-text" }, t("basic_locked", { time: fmtDateTime(basicLockedUntil) }))
        : t("sec_basic_hint", { days: schema.basic_change_cooldown_days }),
      field(t("f_nickname"), nickname),
      field(t("f_gender"), genderRadios),
      field(t("f_program"), programRadios),
      field(
        t("f_avatar"),
        avatarPicker,
        !basicLocked && h("p", { class: "muted small" }, t("upload_limit_hint", { n: schema.avatar_upload.max_attempts, days: schema.avatar_upload.window_days })),
      ),
      field(t("f_email"), h("div", { class: "readonly" }, email), h("p", { class: "muted small" }, t("email_fixed"))),
    ),
    section(
      t("sec_contact"),
      t("sec_contact_hint"),
      field(FIELDS.wechat, wechat, visControl("wechat")),
      field(FIELDS.discord, discord, visControl("discord")),
    ),
    section(
      t("sec_about"),
      t("sec_about_hint"),
      field(FIELDS.research, research, counter(research, spec.research.max)),
      field(FIELDS.bio, bio, counter(bio, spec.bio.max)),
    ),
    section(
      t("sec_relations"),
      null,
      field(t("f_relations"), relationBoxes, [relationNote, h("p", { class: "muted small" }, t("romance_hint"))]),
      noteFields,
    ),
    preview,
    extra,
    save,
  );
  form.onsubmit = async (e) => {
    e.preventDefault();
    save.disabled = true;
    try {
      await onSubmit({
        nickname: nickname.value,
        gender: genderRadios.querySelector("input:checked")?.value ?? null,
        avatar: state.avatar,
        relations: [...state.relations],
        relation_notes: Object.fromEntries([...state.relations].map((r) => [r, notes[r].value])),
        relation_filters: Object.fromEntries([...state.relations].map((r) => [r, state.filters[r] || {}])),
        wechat: wechat.value,
        discord: discord.value,
        program: programRadios.querySelector("input:checked")?.value ?? null,
        research: research.value,
        bio: bio.value,
        visibility: state.vis,
      });
    } finally {
      save.disabled = false;
    }
  };
  return form;
}

// "used / limit" under a text field with a weighted limit, highlighted once over it (the server
// refuses the save then).
function counter(control, max) {
  const el = h("div", { class: "muted small counter", title: t("length_rule") });
  const update = () => {
    const n = textWeight(control.value.trim());
    el.textContent = `${n} / ${max}`;
    el.classList.toggle("over", n > max);
  };
  control.addEventListener("input", update);
  update();
  return el;
}

// Centre-crops an image file to a square of size×size and re-encodes it (WebP where the browser
// can encode it, otherwise JPEG).
async function squareImage(file, size) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(t("image_unreadable"));
  }
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  canvas.getContext("2d").drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close();
  const encode = (type) => new Promise((resolve) => canvas.toBlob(resolve, type, 0.85));
  const webp = await encode("image/webp");
  return webp?.type === "image/webp" ? webp : encode("image/jpeg");
}
