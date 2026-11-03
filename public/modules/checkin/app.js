import { h, fill, api, fmtTime, toast, ApiError } from "/lib.js";
import { makeT } from "/i18n.js";
import { joinModeField, joinModeHint } from "/join-mode.js";
import { challengeRelationsSlot } from "/challenge-relations.js";
import { personCard } from "/card.js";

const t = makeT({
  zh: {
    loading: "加载中…",
    tab_today: "今日签到",
    tab_members: "本期名单",
    tab_history: "我的签到",
    tab_settings: "签到设置",
    participation: "参加设置",
    join_mode_note: "修改从下次签到开始生效。不进入 list 时，签到只记录签到和连续天数。",
    saved: "已保存",
    check_in_join: "签到并进入本期 list",
    check_in_only: "只签到",
    change_setting: "修改设置",
    checked_in_only: "✓ 你在 {time} 签到了。",
    not_on_list: "你目前不在本期名单中，看不到其他成员，别人也看不到你。",
    join: "加入本期名单",
    data: "数据",
    need_profile: "请先补齐个人资料",
    need_profile_body: "个人资料全站通用，补齐后再回来签到。",
    go_profile: "去填写个人资料 →",
    rules: "本挑战规则",
    period_line: "第 {id} 期 · {start} – {end}（{tz}）",
    count: "今天已有 {n} 人签到",
    streak_now: "🔥 已连续签到 {n} 天",
    streak_continue: "已连续签到 {n} 天，今天签到就是第 {next} 天",
    streak_start: "今天签到，开始新的连续记录",
    check_in: "签到",
    checked_in: "✓ 你在 {time} 签到了，已进入本期名单。",
    see_members: "去看看本期成员 →",
    leave: "退出本期名单",
    leave_confirm: "退出后你不会出现在本期名单里，也不能浏览本期成员。本期内可以再次加入。确定吗？",
    cannot_browse: "还不能浏览本期名单",
    cannot_browse_body: "签到后才能看到本期其他成员，而且只能看到和你寻找相同关系的人。",
    go_today: "去签到 →",
    member_count: "本期与你有共同关系意向的成员：{n} 人",
    no_members: "暂时还没有与你意向重合的成员，晚点再来看看。",
    prev: "上一页",
    next: "下一页",
    streak: "连续签到 {n} 天",
    total: "累计签到 {n} 天",
    col_period: "日期",
    col_time: "签到时间",
    none: "还没有签到记录。",
    purge: "删除我在本挑战的全部数据",
    purge_confirm: "将删除你在本挑战的全部签到记录和名单资格（个人资料不受影响），无法恢复。确定吗？",
    purged: "已删除",
  },
  en: {
    loading: "Loading…",
    tab_today: "Today",
    tab_members: "This period",
    tab_history: "My check-ins",
    tab_settings: "Settings",
    participation: "Participation",
    join_mode_note: "Changes apply from your next check-in. Without joining, a check-in only counts toward your streak.",
    saved: "Saved",
    check_in_join: "Check in and join this period's list",
    check_in_only: "Just check in",
    change_setting: "Change",
    checked_in_only: "✓ You checked in at {time}.",
    not_on_list: "You're not on this period's list, so you can't see the others and they can't see you.",
    join: "Join this period's list",
    data: "Data",
    need_profile: "Complete your profile first",
    need_profile_body: "Your profile is shared across the site. Come back to check in once it's complete.",
    go_profile: "Fill in your profile →",
    rules: "Challenge rules",
    period_line: "Period {id} · {start} – {end} ({tz})",
    count: "{n} checked in today",
    streak_now: "🔥 {n}-day streak",
    streak_continue: "{n}-day streak so far; check in today to make it {next}",
    streak_start: "Check in today to start a new streak",
    check_in: "Check in",
    checked_in: "✓ You checked in at {time} and are on this period's list.",
    see_members: "See who else is here →",
    leave: "Leave this period's list",
    leave_confirm: "You won't appear on this period's list and won't be able to browse it. You can rejoin this period. Continue?",
    cannot_browse: "You can't browse this period's list yet",
    cannot_browse_body: "Check in to see the others here, and only people looking for a relationship type you share.",
    go_today: "Check in →",
    member_count: "Members this period who share a goal with you: {n}",
    no_members: "No one with an overlapping goal yet. Check back later.",
    prev: "Previous",
    next: "Next",
    streak: "Current streak: {n} days",
    total: "Total check-ins: {n}",
    col_period: "Date",
    col_time: "Checked in",
    none: "No check-ins yet.",
    purge: "Delete all my data in this challenge",
    purge_confirm: "This deletes all your check-ins and list memberships in this challenge (your profile is kept). This cannot be undone. Continue?",
    purged: "Deleted",
  },
});

export async function mount(root, { challengeId, challenge }) {
  const base = `/api/challenges/${encodeURIComponent(challengeId)}`;
  const tab = location.hash.split("/")[3] || "today";
  const tabs = [
    ["today", t("tab_today")],
    ["members", t("tab_members")],
    ["history", t("tab_history")],
    ["settings", t("tab_settings")],
  ];
  const view = h("div", {}, h("p", { class: "muted" }, t("loading")));
  root.replaceChildren(
    h("div", { class: "challenge-head" }, h("h1", {}, challenge.name), h("p", { class: "muted" }, challenge.refresh_rule)),
    h(
      "nav",
      { class: "tabs" },
      tabs.map(([id, label]) => h("a", { href: `#/c/${challengeId}/${id}`, class: id === tab ? "active" : "" }, label)),
    ),
    view,
  );
  const views = { today: todayView, members: membersView, history: historyView, settings: settingsView };
  (views[tab] || todayView)(view).catch((err) => view.replaceChildren(h("div", { class: "panel" }, h("p", { class: "error-text" }, err.message))));

  async function todayView(view) {
    const cur = await api(`${base}/periods/current`);
    if (!cur.profile_complete) {
      return view.replaceChildren(
        h(
          "section",
          { class: "panel" },
          h("h2", {}, t("need_profile")),
          h("p", {}, t("need_profile_body")),
          h("a", { href: "#/profile" }, t("go_profile")),
        ),
      );
    }
    const p = cur.period;
    const tz = p.timezone;
    const ci = cur.checkin;
    const periodUrl = `${base}/periods/${p.period_id}`;

    // POST checkin, or POST membership to join the list after checking in. With join mode "ask",
    // the check-in carries the answer ({ join }).
    const act = async (btn, path, body = {}) => {
      btn.disabled = true;
      try {
        const res = await api(`${periodUrl}/${path}`, { method: "POST", body });
        toast(res.message, "ok");
        todayView(view);
      } catch (err) {
        toast(err.message, "error");
        btn.disabled = false;
      }
    };

    let status;
    if (ci?.status === "active") {
      const leave = h("button", {}, t("leave"));
      leave.onclick = async () => {
        if (!confirm(t("leave_confirm"))) return;
        await api(`${periodUrl}/membership`, { method: "DELETE" });
        todayView(view);
      };
      status = [
        h("p", { class: "streak" }, t("streak_now", { n: cur.streak })),
        h("p", { class: "done" }, t("checked_in", { time: fmtTime(ci.checked_in_at, tz) })),
        h("p", {}, h("a", { href: `#/c/${challengeId}/members` }, t("see_members"))),
        leave,
      ];
    } else if (ci) {
      // Checked in but not on the list: left it, or chose not to join.
      const btn = h("button", { class: "primary" }, t("join"));
      btn.onclick = () => act(btn, "membership");
      status = [
        h("p", { class: "streak" }, t("streak_now", { n: cur.streak })),
        h("p", { class: "done" }, t("checked_in_only", { time: fmtTime(ci.checked_in_at, tz) })),
        h("p", { class: "muted" }, t("not_on_list")),
        btn,
      ];
    } else {
      const mode = cur.settings.join_mode;
      let buttons;
      if (mode === "ask") {
        const join = h("button", { class: "primary big" }, t("check_in_join"));
        const only = h("button", { class: "big" }, t("check_in_only"));
        join.onclick = () => act(join, "checkin", { join: true });
        only.onclick = () => act(only, "checkin", { join: false });
        buttons = h("div", { class: "row" }, join, only);
      } else {
        buttons = h("button", { class: "primary big" }, t("check_in"));
        buttons.onclick = () => act(buttons, "checkin");
      }
      const streakLine = cur.streak > 0 ? t("streak_continue", { n: cur.streak, next: cur.streak + 1 }) : t("streak_start");
      status = [
        h("p", { class: "streak" }, streakLine),
        challengeRelationsSlot(challengeId),
        buttons,
        h(
          "p",
          { class: "muted small" },
          joinModeHint(mode),
          " ",
          h("a", { href: `#/c/${challengeId}/settings` }, t("change_setting")),
        ),
      ];
    }

    view.replaceChildren(
      h(
        "section",
        { class: "panel problem" },
        h("div", { class: "muted small" }, t("period_line", { id: p.period_id, start: fmtTime(p.starts_at, tz), end: fmtTime(p.ends_at, tz), tz })),
        h("p", {}, t("count", { n: cur.checked_in_count })),
        ...status,
      ),
      h("section", { class: "panel" }, h("h2", {}, t("rules")), h("ul", { class: "rules" }, cur.rules.map((r) => h("li", {}, r)))),
    );
  }

  // periodId is passed by the pager so a page click does not re-fetch periods/current.
  async function membersView(view, page = 1, periodId = null) {
    const pid = periodId ?? (await api(`${base}/periods/current`)).period.period_id;
    let data;
    try {
      data = await api(`${base}/periods/${pid}/members?page=${page}`);
    } catch (err) {
      if (err instanceof ApiError && err.body?.code === "not_member") {
        return view.replaceChildren(
          h(
            "section",
            { class: "panel" },
            h("h2", {}, t("cannot_browse")),
            h("p", {}, t("cannot_browse_body")),
            h("a", { href: `#/c/${challengeId}/today` }, t("go_today")),
          ),
        );
      }
      throw err;
    }
    const pages = Math.max(1, Math.ceil(data.total / data.page_size));
    fill(
      view,
      h("p", { class: "muted" }, t("member_count", { n: data.total })),
      data.members.length ? h("div", { class: "cards" }, data.members.map(personCard)) : h("p", { class: "muted" }, t("no_members")),
      pages > 1 &&
        h(
          "div",
          { class: "pager" },
          h("button", { disabled: page <= 1, onclick: () => membersView(view, page - 1, pid) }, t("prev")),
          ` ${page} / ${pages} `,
          h("button", { disabled: page >= pages, onclick: () => membersView(view, page + 1, pid) }, t("next")),
        ),
    );
  }

  async function settingsView(view) {
    const { settings } = await api(`${base}/settings`);
    const joinChoice = joinModeField(settings.join_mode, async (mode) => {
      try {
        await api(`${base}/settings`, { method: "PUT", body: { join_mode: mode } });
        toast(t("saved"), "ok");
      } catch (err) {
        toast(err.message, "error");
        throw err;
      }
    });
    const purge = h("button", { class: "danger" }, t("purge"));
    purge.onclick = async () => {
      if (!confirm(t("purge_confirm"))) return;
      await api(`${base}/data`, { method: "DELETE" });
      toast(t("purged"), "ok");
      settingsView(view);
    };
    view.replaceChildren(
      h(
        "section",
        { class: "panel" },
        h("h2", {}, t("participation")),
        challengeRelationsSlot(challengeId),
        joinChoice,
        h("p", { class: "muted small" }, t("join_mode_note")),
      ),
      h("section", { class: "panel" }, h("h2", {}, t("data")), purge),
    );
  }

  async function historyView(view) {
    const data = await api(`${base}/history`);
    view.replaceChildren(
      h(
        "section",
        { class: "panel" },
        h("p", {}, h("strong", {}, t("streak", { n: data.streak })), " · ", t("total", { n: data.total })),
        data.checkins.length
          ? h(
              "table",
              { class: "history" },
              h("thead", {}, h("tr", {}, h("th", {}, t("col_period")), h("th", {}, t("col_time")))),
              h(
                "tbody",
                {},
                data.checkins.map((c) =>
                  h("tr", {}, h("td", {}, c.period_id), h("td", {}, fmtTime(c.checked_in_at))),
                ),
              ),
            )
          : h("p", { class: "muted" }, t("none")),
      ),
    );
  }
}
