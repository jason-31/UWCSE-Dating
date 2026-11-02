import { h, api, toast } from "/lib.js";
import { makeT, RELATIONS } from "/i18n.js";

// "Looking for in this challenge": which of the profile's relationship types someone seeks in one
// challenge (GET/PUT /api/profile/relations/<challenge>). Shared by the challenge modules so it
// reads the same everywhere. Not choosing means all of the profile's types.
const t = makeT({
  zh: {
    label: "在本挑战中寻找",
    hint: "只能从个人资料里寻找的关系中选。对方也要在本挑战中寻找同一种关系，你们才会在这里互相看到。修改立即生效。",
    none_left: "你为本挑战选的关系都已不在个人资料里，现在本挑战里谁也看不到你。请重新选择。",
    need_one: "至少保留一种关系；不想出现在名单里，可以把“自动进入本期 list”设为总是不加入。",
    saved: "已保存",
  },
  en: {
    label: "Looking for in this challenge",
    hint: "Choose from the relationship types in your profile. You and someone else see each other here only if you both look for the same type in this challenge. Changes apply at once.",
    none_left: "None of the types you chose for this challenge is in your profile any more, so nobody sees you here. Choose again.",
    need_one: "Keep at least one type. To stay off the lists, set \"Join this period's list automatically\" to never.",
    saved: "Saved",
  },
});

export async function challengeRelationsField(challengeId) {
  const url = `/api/profile/relations/${encodeURIComponent(challengeId)}`;
  const data = await api(url);
  let current = data.relations;
  const warning = h("p", { class: "warn-text small" }, t("none_left"));
  warning.hidden = current.length > 0;
  const boxes = data.profile_relations.map((rel) => {
    const box = h("input", { type: "checkbox", value: rel, checked: current.includes(rel) });
    box.onchange = async () => {
      const next = boxes.filter((b) => b.checked).map((b) => b.value);
      if (!next.length) {
        box.checked = true;
        return toast(t("need_one"), "warn");
      }
      try {
        current = (await api(url, { method: "PUT", body: { relations: next } })).relations;
        warning.hidden = current.length > 0;
        toast(t("saved"), "ok");
      } catch (err) {
        boxes.forEach((b) => (b.checked = current.includes(b.value)));
        toast(err.message, "error");
      }
    };
    return box;
  });
  return h(
    "div",
    { class: "field choice-field" },
    h("label", {}, t("label")),
    h("div", { class: "chips" }, boxes.map((b) => h("label", { class: "chip" }, b, " ", RELATIONS[b.value]))),
    warning,
    h("p", { class: "muted small" }, t("hint")),
  );
}

// The same field, for synchronous renderers: returns a placeholder that fills itself in.
export function challengeRelationsSlot(challengeId) {
  const slot = h("div");
  challengeRelationsField(challengeId)
    .then((field) => slot.replaceChildren(field))
    .catch((err) => slot.replaceChildren(h("p", { class: "error-text small" }, err.message)));
  return slot;
}
