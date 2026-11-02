import { h, fill, api, fmtTime, toast, ApiError } from "/lib.js";
import { makeT } from "/i18n.js";
import { joinModeField } from "/join-mode.js";
import { personCard } from "/card.js";

const t = makeT({
  zh: {
    loading: "加载中…",
    tab_today: "今日挑战",
    tab_members: "本期名单",
    tab_settings: "挑战设置",
    tab_history: "我的历史",
    need_profile: "请先补齐个人资料",
    need_profile_body: "个人资料全站通用，补齐后再回来参加本挑战。",
    go_profile: "去填写个人资料 →",
    step_bind: "验证 LeetCode 账号",
    step_rules: "确认规则与入列方式",
    enroll: "确认报名",
    accept_challenge_rules: "请先同意本挑战规则",
    challenge_rules: "本挑战规则",
    accept_rules: " 我已阅读并同意以上规则",
    withdrawn_hint: "你之前退出过本挑战，重新确认即可恢复参加。",
    lc_username: "LeetCode 用户名",
    regen_token: "重新生成令牌",
    get_token: "获取验证令牌",
    check_owner: "检查归属",
    token_step1_pre: "1. 打开 ",
    token_step1_link: "leetcode.com 个人资料设置",
    token_step1_post: "，在 General 里打开 ReadMe（旧版叫 Summary），把下面的令牌加进去并保存。不用删掉原来的内容，令牌出现在任意位置都可以：",
    token_valid: "令牌在 {time} 前有效，只用于这个账号和你在本挑战的绑定。",
    token_step2: "2. 保存后回到这里检查。验证通过后，就可以把 ReadMe 改回原来的内容了：",
    lc_account: "LeetCode 账号",
    verified_as: "已验证：",
    binding_version: "（第 {v} 版绑定）",
    bind_intro: "需要证明你能控制这个 leetcode.com 账号。只填用户名不算绑定。",
    rebind_hint: "更换账号需要重新验证；如果本期已经开始验证，新账号从下一期生效。",
    privacy_hint: "本站不会索取 LeetCode 密码、cookie 或你的代码。用户名只对你本人和验证逻辑可见。",
    unavailable: "暂不可用",
    ask_server: "请服务器检查",
    ask_server_wait: "请服务器检查（{s}s）",
    checking: "正在向数据源核对…",
    done_at: "✓ 本期已验证完成（AC 于 {time}）",
    leave: "退出本期展示",
    leave_confirm: "退出后你不会出现在本期名单里，也不能浏览本期成员。确定吗？",
    on_list: "你在本期名单中。",
    see_members: "去看看本期成员 →",
    join: "加入本期展示",
    left_list: "你已退出本期展示。",
    ask_join: "要进入本期 list 吗？进入后，和你有共同寻找关系的人能看到你，你也能浏览本期名单。",
    not_auto_joined: "你设置了不自动进入本期 list，需要的话可以手动加入。",
    verify_intro: "在 LeetCode 上用已绑定账号 AC 这道题后，点击下面的按钮让服务器核对。",
    last_check: "上次检查：{time} · {result}",
    period_line: "第 {id} 期 · {start} – {end}（{tz}）",
    same_problem: "所有参与者本期都是这道题。以前 AC 过也需要在本期重新提交并 AC。",
    r_verified: "已验证",
    r_not_found: "尚未查到",
    r_unverifiable: "暂无法验证",
    r_provider_unavailable: "数据源不可用",
    verify_paused: "LeetCode 验证暂时停用，现在不能检查归属或完成情况。已有的完成记录、名单和历史不受影响。",
    r_invalid_request: "请求无效",
    r_pending: "处理中",
    cannot_browse: "还不能浏览本期名单",
    cannot_browse_body: "只有本期验证完成并在名单中的成员才能看到彼此，而且只能看到和你寻找相同关系的人。",
    go_today: "去完成今日挑战 →",
    member_count: "本期与你有共同关系意向的成员：{n} 人",
    no_members: "暂时还没有与你意向重合的成员，晚点再来看看。",
    prev: "上一页",
    next: "下一页",
    saved: "已保存（不影响本期已有的展示）",
    withdraw: "退出本挑战",
    withdraw_confirm: "退出后你会从所有本挑战名单中撤下，以后也不会再自动进入 list。账号绑定会保留，之后可以重新报名。确定吗？",
    purge: "删除我在本挑战的全部数据",
    purge_confirm: "将删除你在本挑战的账号绑定、完成记录和名单资格（个人资料不受影响），无法恢复。确定吗？",
    profile: "个人资料",
    profile_hint: "昵称、头像、寻找的关系和联系方式是全站通用的个人资料。",
    edit_profile: "编辑个人资料 →",
    participation: "参加设置",
    my_completions: "我的完成记录",
    col_period: "周期",
    col_problem: "题目",
    col_list: "名单",
    m_active: "已展示",
    m_left: "已退出",
    m_none: "未入列",
    no_completions: "还没有完成记录。",
    badges: "奖章：{n} 枚",
  },
  en: {
    loading: "Loading…",
    tab_today: "Today",
    tab_members: "This period",
    tab_settings: "Challenge settings",
    tab_history: "My history",
    need_profile: "Complete your profile first",
    need_profile_body: "Your profile is shared across the site. Come back to this challenge once it's complete.",
    go_profile: "Fill in your profile →",
    step_bind: "Verify your LeetCode account",
    step_rules: "Accept rules and list settings",
    enroll: "Join challenge",
    accept_challenge_rules: "Please accept the challenge rules first",
    challenge_rules: "Challenge rules",
    accept_rules: " I have read and accept these rules",
    withdrawn_hint: "You left this challenge earlier; confirm again to rejoin.",
    lc_username: "LeetCode username",
    regen_token: "Generate a new token",
    get_token: "Get verification token",
    check_owner: "Check ownership",
    token_step1_pre: "1. Open your ",
    token_step1_link: "leetcode.com profile settings",
    token_step1_post: ", open ReadMe under General (called Summary in the old layout), add the token below anywhere in it and save. You don't need to remove what's already there:",
    token_valid: "Valid until {time}; it only works for this account and your binding in this challenge.",
    token_step2: "2. Then come back here to check. Once verified, you can put your ReadMe back the way it was:",
    lc_account: "LeetCode account",
    verified_as: "Verified: ",
    binding_version: " (binding v{v})",
    bind_intro: "You need to prove you control this leetcode.com account. Entering a username alone does not bind it.",
    rebind_hint: "Switching accounts requires verifying again; if you've already started checking this period, the new account applies from the next one.",
    privacy_hint: "We never ask for your LeetCode password, cookies or code. Your username is visible only to you and the verifier.",
    unavailable: "Unavailable",
    ask_server: "Ask the server to check",
    ask_server_wait: "Ask the server to check ({s}s)",
    checking: "Checking with the data source…",
    done_at: "✓ Verified for this period (Accepted at {time})",
    leave: "Leave this period's list",
    leave_confirm: "You won't appear on this period's list and won't be able to browse its members. Continue?",
    on_list: "You're on this period's list. ",
    see_members: "See who else is here →",
    join: "Join this period's list",
    left_list: "You left this period's list.",
    ask_join: "Join this period's list? People who share a relationship type with you will see you, and you can browse the list.",
    not_auto_joined: "You chose not to join this period's list automatically; you can join by hand.",
    verify_intro: "Get this problem Accepted with your bound account on LeetCode, then press the button below so the server can check.",
    last_check: "Last check: {time} · {result}",
    period_line: "Period {id} · {start} – {end} ({tz})",
    same_problem: "Everyone gets this problem this period. Even if you solved it before, submit it again this period.",
    r_verified: "Verified",
    r_not_found: "Not found yet",
    r_unverifiable: "Cannot verify",
    r_provider_unavailable: "Data source unavailable",
    verify_paused: "LeetCode checks are paused, so ownership and completions can't be checked right now. Existing completions, lists and history are not affected.",
    r_invalid_request: "Invalid request",
    r_pending: "In progress",
    cannot_browse: "You can't browse this period's list yet",
    cannot_browse_body: "Only members verified and on this period's list can see each other, and only people looking for a relationship type you share.",
    go_today: "Do today's challenge →",
    member_count: "Members this period who share a relationship goal with you: {n}",
    no_members: "No one with an overlapping goal yet. Check back later.",
    prev: "Previous",
    next: "Next",
    saved: "Saved (this period's list is unaffected)",
    withdraw: "Leave this challenge",
    withdraw_confirm: "You'll be removed from all of this challenge's lists and won't join any automatically. Your account binding is kept, so you can rejoin later. Continue?",
    purge: "Delete all my data in this challenge",
    purge_confirm: "This deletes your account binding, completions and list memberships in this challenge (your profile is kept). This cannot be undone. Continue?",
    profile: "Profile",
    profile_hint: "Nickname, avatar, what you're looking for and contact details are part of your site-wide profile.",
    edit_profile: "Edit profile →",
    participation: "Participation",
    my_completions: "My completions",
    col_period: "Period",
    col_problem: "Problem",
    col_list: "List",
    m_active: "Shown",
    m_left: "Left",
    m_none: "Not joined",
    no_completions: "No completions yet.",
    badges: "Badges: {n}",
  },
});
const DIFF_CLASS = { Easy: "easy", Medium: "medium", Hard: "hard" };

export async function mount(root, { challengeId, challenge }) {
  const base = `/api/challenges/${encodeURIComponent(challengeId)}`;
  const tabFromHash = () => location.hash.split("/")[3] || "today";
  let enrollment = await api(`${base}/enrollment`);

  const header = h("div", { class: "challenge-head" }, h("h1", {}, challenge.name), h("p", { class: "muted" }, challenge.refresh_rule));
  const body = h("div");
  root.replaceChildren(header, body);

  async function refresh() {
    enrollment = await api(`${base}/enrollment`);
    render();
  }

  function render() {
    const r = enrollment.readiness;
    if (!r.profile_complete || !r.binding_verified || !r.enrolled) {
      return body.replaceChildren(onboarding());
    }
    const tab = tabFromHash();
    const tabs = [
      ["today", t("tab_today")],
      ["members", t("tab_members")],
      ["settings", t("tab_settings")],
      ["history", t("tab_history")],
    ];
    const nav = h(
      "nav",
      { class: "tabs" },
      tabs.map(([id, label]) => h("a", { href: `#/c/${challengeId}/${id}`, class: id === tab ? "active" : "" }, label)),
    );
    const view = h("div", {}, h("p", { class: "muted" }, t("loading")));
    body.replaceChildren(nav, view);
    const views = { today: todayView, members: membersView, settings: settingsView, history: historyView };
    (views[tab] || todayView)(view).catch((err) => view.replaceChildren(errorBox(err)));
  }

  // ---------- onboarding ----------

  function onboarding() {
    const r = enrollment.readiness;
    if (!r.profile_complete) {
      return h(
        "section",
        { class: "panel" },
        h("h2", {}, t("need_profile")),
        h("p", {}, t("need_profile_body")),
        h("a", { href: "#/profile" }, t("go_profile")),
      );
    }
    const step = !r.binding_verified ? 1 : 2;
    const steps = [t("step_bind"), t("step_rules")];
    return h(
      "div",
      {},
      h(
        "ol",
        { class: "stepper" },
        steps.map((s, i) => h("li", { class: i + 1 === step ? "current" : i + 1 < step ? "done" : "" }, s)),
      ),
      step === 1 ? bindingPanel() : consentPanel(),
    );
  }

  function consentPanel() {
    const accept = h("input", { type: "checkbox" });
    let joinMode = enrollment.enrollment?.join_mode ?? "always";
    const joinChoice = joinModeField(joinMode, (mode) => (joinMode = mode));
    const btn = h("button", { class: "primary" }, t("enroll"));
    btn.onclick = async () => {
      if (!accept.checked) return toast(t("accept_challenge_rules"), "warn");
      btn.disabled = true;
      try {
        await api(`${base}/enrollment`, {
          method: "POST",
          body: { accept_rules: true, join_mode: joinMode },
        });
        location.hash = `#/c/${challengeId}/today`;
        await refresh();
      } catch (err) {
        toast(err.message, "error");
        btn.disabled = false;
      }
    };
    return h(
      "section",
      { class: "panel" },
      h("h2", {}, t("challenge_rules")),
      h("ul", { class: "rules" }, enrollment.rules.map((r) => h("li", {}, r))),
      h("label", { class: "check" }, accept, t("accept_rules")),
      joinChoice,
      enrollment.enrollment?.status === "withdrawn" && h("p", { class: "muted small" }, t("withdrawn_hint")),
      btn,
    );
  }

  // ---------- binding ----------

  function bindingPanel() {
    const panel = h("section", { class: "panel" });
    const b = enrollment.binding;
    const pending = enrollment.pending_binding;
    const username = h("input", { placeholder: t("lc_username"), value: pending?.username || "" });
    const start = h("button", {}, pending ? t("regen_token") : t("get_token"));
    const tokenBox = h("div");

    function showToken(tk) {
      const check = h("button", { class: "primary" }, t("check_owner"));
      check.onclick = async () => {
        check.disabled = true;
        try {
          const res = await api(`${base}/binding/verify`, { method: "POST", body: {} });
          toast(res.message, res.ok ? "ok" : "warn");
          if (res.ok) await refresh();
        } catch (err) {
          toast(err.message, "error");
        } finally {
          check.disabled = false;
        }
      };
      tokenBox.replaceChildren(
        h(
          "div",
          { class: "token" },
          h(
            "p",
            {},
            t("token_step1_pre"),
            h("a", { href: "https://leetcode.com/settings/profile/", target: "_blank", rel: "noopener" }, t("token_step1_link")),
            t("token_step1_post"),
          ),
          h("code", { class: "token-code" }, tk.token),
          h("p", { class: "muted small" }, t("token_valid", { time: fmtTime(tk.expires_at) })),
          h("p", {}, t("token_step2")),
          check,
        ),
      );
    }

    start.onclick = async () => {
      start.disabled = true;
      try {
        showToken(await api(`${base}/binding/start`, { method: "POST", body: { username: username.value } }));
      } catch (err) {
        toast(err.message, "error");
      } finally {
        start.disabled = false;
      }
    };
    if (pending) showToken(pending);

    panel.append(
      h("h2", {}, t("lc_account")),
      b
        ? h("p", {}, t("verified_as"), h("strong", {}, b.username), h("span", { class: "muted small" }, t("binding_version", { v: b.version })))
        : h("p", {}, t("bind_intro")),
      b && h("p", { class: "muted small" }, t("rebind_hint")),
      enrollment.verification_paused && h("p", { class: "warn-text" }, t("verify_paused")),
      h("p", { class: "muted small" }, t("privacy_hint")),
      h("div", { class: "row" }, username, start),
      tokenBox,
    );
    return panel;
  }

  // ---------- today ----------

  async function todayView(view) {
    const cur = await api(`${base}/periods/current`);
    if (!cur.available) {
      view.replaceChildren(h("section", { class: "panel" }, h("h2", {}, t("unavailable")), h("p", {}, cur.message)));
      return;
    }
    const { period, me: mine } = cur;
    const tz = period.timezone;
    const pr = period.problem;
    const status = h("div", { class: "status" });
    const msg = h("p", { class: "verify-msg" });

    const verifyBtn = h("button", { class: "primary" }, t("ask_server"));
    let timer;
    function tickCooldown(until) {
      clearInterval(timer);
      const update = () => {
        const left = Math.ceil((until - Date.now()) / 1000);
        if (left > 0) {
          verifyBtn.disabled = true;
          verifyBtn.textContent = t("ask_server_wait", { s: left });
        } else {
          clearInterval(timer);
          verifyBtn.disabled = false;
          verifyBtn.textContent = t("ask_server");
        }
      };
      update();
      timer = setInterval(update, 1000);
    }
    verifyBtn.onclick = async () => {
      verifyBtn.disabled = true;
      msg.textContent = t("checking");
      msg.className = "verify-msg";
      try {
        const res = await api(`${base}/periods/${period.period_id}/verify`, { method: "POST", body: {} });
        msg.textContent = res.message;
        msg.className = `verify-msg ${res.ok ? "ok" : res.result === "provider_unavailable" ? "warn" : "info"}`;
        if (res.ok) return todayView(view);
        tickCooldown(Date.now() + 60_000);
      } catch (err) {
        msg.textContent = err.message;
        msg.className = "verify-msg error";
        if (err instanceof ApiError && err.body?.retry_after) tickCooldown(Date.now() + err.body.retry_after * 1000);
        else verifyBtn.disabled = false;
      }
    };

    if (mine.completion) {
      const m = mine.membership;
      const rows = [h("p", { class: "done" }, t("done_at", { time: fmtTime(mine.completion.accepted_at, tz) }))];
      if (m?.status === "active") {
        const leave = h("button", {}, t("leave"));
        leave.onclick = async () => {
          if (!confirm(t("leave_confirm"))) return;
          await api(`${base}/periods/${period.period_id}/membership`, { method: "DELETE" });
          todayView(view);
        };
        rows.push(
          h("p", {}, t("on_list"), h("a", { href: `#/c/${challengeId}/members` }, t("see_members"))),
          leave,
        );
      } else {
        const join = h("button", { class: "primary" }, t("join"));
        join.onclick = async () => {
          try {
            await api(`${base}/periods/${period.period_id}/membership`, { method: "POST", body: { confirm: true } });
            todayView(view);
          } catch (err) {
            toast(err.message, "error");
          }
        };
        rows.push(
          h("p", { class: "muted" }, m?.status === "left" ? t("left_list") : cur.readiness.join_mode === "ask" ? t("ask_join") : t("not_auto_joined")),
          join,
        );
      }
      status.replaceChildren(...rows);
    } else {
      fill(
        status,
        h("p", {}, t("verify_intro")),
        cur.verification_paused ? h("p", { class: "warn-text" }, t("verify_paused")) : [verifyBtn, msg],
        mine.last_attempt && h("p", { class: "muted small" }, t("last_check", { time: fmtTime(mine.last_attempt.requested_at, tz), result: resultLabel(mine.last_attempt.result) })),
      );
      if (mine.cooldown_until > Date.now()) tickCooldown(mine.cooldown_until);
    }

    view.replaceChildren(
      h(
        "section",
        { class: "panel problem" },
        h("div", { class: "muted small" }, t("period_line", { id: period.period_id, start: fmtTime(period.starts_at, tz), end: fmtTime(period.ends_at, tz), tz })),
        h(
          "h2",
          {},
          `${pr.frontend_id}. `,
          h("a", { href: pr.url, target: "_blank", rel: "noopener" }, pr.title),
          " ",
          h("span", { class: `diff ${DIFF_CLASS[pr.difficulty] || ""}` }, pr.difficulty),
        ),
        h("p", { class: "muted small" }, t("same_problem")),
      ),
      h("section", { class: "panel" }, status),
    );
  }

  function resultLabel(r) {
    const known = ["verified", "not_found", "unverifiable", "provider_unavailable", "invalid_request"];
    return t(known.includes(r) ? `r_${r}` : "r_pending");
  }

  // ---------- members ----------

  // periodId is passed by the pager so a page click does not re-fetch periods/current.
  async function membersView(view, page = 1, periodId = null) {
    let pid = periodId;
    if (!pid) {
      const cur = await api(`${base}/periods/current`);
      if (!cur.available) return view.replaceChildren(h("p", { class: "muted" }, cur.message));
      pid = cur.period.period_id;
    }
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
      data.members.length
        ? h("div", { class: "cards" }, data.members.map(personCard))
        : h("p", { class: "muted" }, t("no_members")),
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

  // ---------- settings tab (challenge-specific only) ----------

  async function settingsView(view) {
    const e = enrollment.enrollment;
    const joinChoice = joinModeField(e.join_mode, async (mode) => {
      try {
        await api(`${base}/enrollment`, { method: "POST", body: { accept_rules: true, join_mode: mode } });
        e.join_mode = mode;
        toast(t("saved"), "ok");
      } catch (err) {
        toast(err.message, "error");
        throw err;
      }
    });
    const withdraw = h("button", {}, t("withdraw"));
    withdraw.onclick = async () => {
      if (!confirm(t("withdraw_confirm"))) return;
      await api(`${base}/enrollment`, { method: "DELETE" });
      await refresh();
    };
    const purge = h("button", { class: "danger" }, t("purge"));
    purge.onclick = async () => {
      if (!confirm(t("purge_confirm"))) return;
      await api(`${base}/enrollment?purge=1`, { method: "DELETE" });
      location.hash = `#/c/${challengeId}`;
      await refresh();
    };
    view.replaceChildren(
      h(
        "section",
        { class: "panel" },
        h("h2", {}, t("profile")),
        h("p", { class: "muted small" }, t("profile_hint")),
        h("a", { href: "#/profile" }, t("edit_profile")),
      ),
      bindingPanel(),
      h(
        "section",
        { class: "panel" },
        h("h2", {}, t("participation")),
        joinChoice,
        h("div", { class: "row" }, withdraw, purge),
      ),
    );
  }

  // ---------- history ----------

  async function historyView(view) {
    const data = await api(`${base}/history`);
    view.replaceChildren(
      h(
        "section",
        { class: "panel" },
        h("h2", {}, t("my_completions")),
        data.completions.length
          ? h(
              "table",
              { class: "history" },
              h("thead", {}, h("tr", {}, h("th", {}, t("col_period")), h("th", {}, t("col_problem")), h("th", {}, t("col_list")))),
              h(
                "tbody",
                {},
                data.completions.map((c) =>
                  h(
                    "tr",
                    {},
                    h("td", {}, c.period_id),
                    h("td", {}, h("a", { href: c.problem.url, target: "_blank", rel: "noopener" }, `${c.problem.frontend_id}. ${c.problem.title}`)),
                    h("td", {}, t(c.membership === "active" ? "m_active" : c.membership === "left" ? "m_left" : "m_none")),
                  ),
                ),
              ),
            )
          : h("p", { class: "muted" }, t("no_completions")),
        data.badges && data.badges.length > 0 && h("p", {}, t("badges", { n: data.badges.length })),
      ),
    );
  }

  render();
}

function errorBox(err) {
  return h("div", { class: "panel" }, h("p", { class: "error-text" }, err.message));
}
