import { h } from "/lib.js";
import { makeT } from "/i18n.js";

// The "Join this period's list automatically" choice (src/platform/join-mode.js), shared by the
// challenge modules so it reads the same everywhere.
const t = makeT({
  zh: {
    label: "自动进入本期 list",
    always: "总是加入",
    ask: "每次询问",
    never: "总是不加入",
    always_hint: "完成当期任务后，自动进入本期 list。",
    ask_hint: "每次完成任务时问你要不要进入本期 list。",
    never_hint: "完成任务后不进入 list，不会被别人看到，也不能浏览 list；之后仍可以手动加入。",
  },
  en: {
    label: "Join this period's list automatically",
    always: "Always",
    ask: "Ask each time",
    never: "Never",
    always_hint: "Completing the period's task puts you on this period's list.",
    ask_hint: "Each time you complete the task, you are asked whether to join this period's list.",
    never_hint: "Completing the task doesn't put you on the list: nobody sees you there and you can't browse it. You can still join by hand.",
  },
});

export const JOIN_MODES = ["always", "ask", "never"];

export function joinModeHint(mode) {
  return t(`${mode}_hint`);
}

// A labelled radio group. onChange(mode) is called on every change; it may return a promise and
// reject to put the previous choice back.
export function joinModeField(value, onChange) {
  let current = value;
  const name = `join-mode-${Math.random().toString(36).slice(2)}`;
  const hint = h("p", { class: "muted small" }, joinModeHint(current));
  const radios = JOIN_MODES.map((mode) => {
    const input = h("input", { type: "radio", name, value: mode, checked: mode === current });
    input.onchange = async () => {
      const previous = current;
      current = mode;
      hint.textContent = joinModeHint(mode);
      try {
        await onChange(mode);
      } catch {
        current = previous;
        radios.forEach((r) => (r.checked = r.value === previous));
        hint.textContent = joinModeHint(previous);
      }
    };
    return input;
  });
  return h(
    "div",
    { class: "field choice-field" },
    h("label", {}, t("label")),
    h(
      "div",
      { class: "chips" },
      radios.map((r) => h("label", { class: "chip" }, r, " ", t(r.value))),
    ),
    hint,
  );
}
