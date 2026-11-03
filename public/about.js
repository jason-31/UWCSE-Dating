import { h } from "/lib.js";
import { lang } from "/i18n.js";

// "About this site": shown to everyone before registering and linked from the header after.
const CONTENT = {
  zh: {
    title: "关于 UWCSE.date",
    unofficial:
      "本站是个人独立运营的非官方网站，不是 Paul G. Allen School 或华盛顿大学的官方服务，不受它们管理，也没有得到它们的认可或支持。用学校账号登录只是为了确认你是 CSE 的成员。",
    lead: "这里不是刷卡片的交友软件。UW CSE 的同学通过一起完成可验证的学术挑战认识彼此：在同一个挑战的同一期完成任务的人，才会出现在彼此的名单里。",
    sections: [
      {
        h: "挑战",
        p: [
          "网站由一个个挑战组成，每个挑战有自己的题目、验证方式和名单，彼此独立。",
          "第一个挑战是 LeetCode 每日挑战：每天洛杉矶时间 0 点随机抽一道题，所有人同一道，不会为个人换题。",
          "你需要在当天用自己的 LeetCode 账号把这道题做到 Accepted，然后点“请服务器检查”。服务器会直接向 LeetCode 核对你最近的提交记录；截图或自报都不算。以前做过的题，当天也要重新提交。",
          "为了确认账号是你的，参加前要绑定一次：把网站给的一串令牌临时贴到你 LeetCode 个人资料的简介里。我们不会要你的密码、cookie 或代码。",
          "还有一个更轻松的每日签到：每天点一下签到，就进入当天的名单，看看今天还有谁也来了。",
        ],
      },
      {
        h: "每期一份名单",
        p: [
          "每个挑战按自己的周期刷新任务，周期长短由挑战决定。比如 LeetCode 每日挑战一天一期，以后的挑战也可以一周一期。",
          "完成当期任务并通过验证后，按你对“自动进入本期 list”的选择（总是加入、每次询问或总是不加入），你会进入这个挑战当期的名单。每个挑战的每一期都有独立的名单，只有同一期名单里的人能看到彼此；这一期结束，名单就关闭了。",
          "所以想认识新的人，就在每一期完成任务。没完成的人看不到名单，你也不会被他们看到。",
          "名单按入列时间排列，没有打分、推荐或排名算法。",
        ],
      },
      {
        h: "你会看到谁",
        p: [
          "注册时选择你在寻找哪几种关系：朋友、学习搭子、恋爱，可以多选。“恋爱”指以长期关系为目标的认真交往，本站不支持寻找短期恋爱。",
          "每个挑战还可以单独选择在这里寻找哪几种关系（只能从你资料里选的关系中选），比如靠每日签到交朋友、恋爱只通过 LeetCode。在某个挑战里，双方都在这里寻找同一种关系，才会以这种关系互相看到。",
          "你只会看到和你至少有一种共同关系的人，对方也一样。比如 A 寻找朋友和恋爱、B 只寻找朋友、C 只寻找恋爱：A 和 B 以朋友身份互相可见，A 和 C 以恋爱身份互相可见，B 和 C 互相看不到。",
          "每种关系还可以按性别和项目筛选，默认全选、不做限制，取消勾选来缩小范围，比如恋爱只保留某些项目的女生。筛选是双向的：你也要符合对方的条件，你们才会互相看到；筛选只看对方卡片上本来就显示的性别和项目。也因为是双向的，能在某种关系下看到你的人会知道你在这种关系上接受他们的性别；对恋爱来说，这可能透露你的性取向。性别由每个人自己填写。",
          "为了避免为了看到更多人而频繁切换，寻找的关系和筛选条件共用一个计时，改动保存后 7 天内都不能再改。昵称、性别和项目另有一个计时，改动后 30 天内不能再改。头像可以随时换，只有上传新头像有次数限制（每 30 天 5 次）。",
        ],
      },
      {
        h: "对方能看到你什么",
        p: [
          "头像、昵称、性别、项目和你的学校邮箱是基础信息，总会显示在你的卡片上，所以在能看到你的人面前你不是匿名的。研究兴趣和简介填了就会展示。只有微信和 Discord 可以单独选择向哪种共同关系展示。微信和 Discord 默认只向恋爱展示，你可以自己调整。",
          "每种关系还可以写一段“对这段关系的期待”，只有同样寻找这种关系的人能看到。",
          "资料全站通用，修改后立即生效。",
        ],
      },
      {
        h: "怎么联系",
        p: [
          "本站没有站内消息。看到感兴趣的人，就用对方愿意公开给你的联系方式自己去打招呼。",
        ],
      },
      {
        h: "你始终可以",
        p: [
          "退出当期名单；退出某个挑战；把“自动进入本期 list”设为总是不加入，只做题不展示；或者注销账号，删除你在本站的全部数据。",
          "登录使用你的 @cs.washington.edu 学校 Google 账号，只接受由 CSE 管理的账号。",
        ],
      },
    ],
    register: "开始注册",
    sign_in: "用 Google 账号登录",
    sign_in_note: "仅限 @cs.washington.edu 学校账号。",
    back: "返回首页",
  },
  en: {
    title: "About UWCSE.date",
    unofficial:
      "This is an unofficial site run independently by an individual. It is not a service of the Paul G. Allen School or the University of Washington, is not managed by them, and is not endorsed or supported by them. Signing in with your school account only confirms that you are part of CSE.",
    lead: "This isn't a swipe app. People in UW CSE meet by finishing verifiable academic challenges together: you only appear on someone's list if you both completed the same period of the same challenge.",
    sections: [
      {
        h: "Challenges",
        p: [
          "The site is made of challenges. Each one has its own problems, verification and lists, independent of the others.",
          "The first challenge is LeetCode Daily: every day at midnight Los Angeles time one problem is drawn at random. Everyone gets the same one, and it's never re-rolled for an individual.",
          "Get it Accepted on your own LeetCode account that day, then press \"Ask the server to check\". The server checks your recent submissions with LeetCode directly; screenshots and self-reports don't count. If you solved it before, submit it again that day.",
          "To prove the account is yours, you bind it once by temporarily pasting a token we give you into your LeetCode profile summary. We never ask for your password, cookies or code.",
          "There's also a lighter Daily Check-in: check in once a day to join that day's list and see who else showed up.",
        ],
      },
      {
        h: "A new list every period",
        p: [
          "Each challenge refreshes its task on its own schedule. LeetCode Daily runs one period per day; a future challenge might run weekly.",
          "Once you complete the current task and pass verification, you join that challenge's list for the period as your \"Join this period's list automatically\" choice says: always, ask each time, or never. Every period of every challenge has its own list: only people on the same period's list can see each other, and the list closes when the period ends.",
          "So to meet new people, complete the task each period. People who haven't completed it can't see the list, and they can't see you.",
          "Lists are ordered by when people joined. There is no scoring, recommendation or ranking.",
        ],
      },
      {
        h: "Who you'll see",
        p: [
          "When you register, choose what you're looking for: friendship, a study buddy, or a romantic relationship. Pick as many as you like. A romantic relationship here means dating seriously with a long-term relationship in mind; this site does not support looking for short-term relationships.",
          "Each challenge also lets you choose which of those you look for there (only from the ones in your profile): for example, make friends through the Daily Check-in and look for a relationship only through LeetCode. In a challenge, two people see each other under a type only if both look for it there.",
          "You only see people who share at least one of those with you, and the same goes for them. Say A wants friendship and romance, B only friendship and C only romance: A and B see each other as friends, A and C see each other for romance, and B and C don't see each other at all.",
          "For each relationship type you can also filter by gender and program. Everything is ticked by default (no restriction); untick to narrow it, e.g. a romantic relationship only with women in certain programs. Filters work both ways: you have to meet theirs too, and it only looks at the gender and program already shown on everyone's card. Because filters are two-way, anyone who can see you under a relationship learns that you accept their gender for it; for a romantic relationship, this can reveal your sexual orientation. Gender is self-reported.",
          "So nobody keeps switching just to see more people, what you're looking for and your filters share one timer: after you save a change, neither can be changed again for 7 days. Nickname, gender and program have their own timer of 30 days. Your avatar can change any time; only uploading a new one is limited (5 times every 30 days).",
        ],
      },
      {
        h: "What others see of you",
        p: [
          "Your avatar, nickname, gender, program and school email are basic info and always on your card, so you are not anonymous to the people who can see you. Research interests and bio are shown whenever you fill them in. Only WeChat and Discord can each be shown to whichever shared relationship types you choose. WeChat and Discord default to romantic relationships only; you can change that.",
          "For each relationship type you can also write what you hope for. Only people looking for that same type will see it.",
          "Your profile is shared across the site and changes take effect immediately.",
        ],
      },
      {
        h: "Getting in touch",
        p: ["There is no messaging on this site. If someone catches your eye, reach out through the contact details they chose to share with you."],
      },
      {
        h: "You can always",
        p: [
          "Leave the current list, leave a challenge, set \"Join this period's list automatically\" to never and just solve, or delete your account and all your data here.",
          "You sign in with your @cs.washington.edu school Google account; only accounts managed by CSE are accepted.",
        ],
      },
    ],
    register: "Register",
    sign_in: "Sign in with Google",
    sign_in_note: "Only @cs.washington.edu school accounts.",
    back: "Back to home",
  },
}[lang];

// signedIn: false shows a sign-in button (top and bottom) instead of the register link; notice
// is an optional node shown above the text (e.g. why a sign-in failed).
export function aboutPage({ registered, signedIn = true, notice = null }) {
  const c = CONTENT;
  const action = () =>
    !signedIn
      ? h(
          "div",
          { class: "sign-in" },
          h(
            "a",
            { class: "button primary big", href: "/auth/login" },
            h("span", { class: "g-badge" }, h("img", { src: "/google-g.svg", alt: "" })),
            c.sign_in,
          ),
          h("p", { class: "muted small" }, c.sign_in_note),
        )
      : registered
        ? h("a", { href: "#/" }, c.back)
        : h("a", { class: "button primary", href: "#/register" }, c.register);
  return h(
    "article",
    { class: "panel about" },
    h("h1", {}, c.title),
    notice,
    h("p", { class: "unofficial" }, c.unofficial),
    h("p", { class: "lead" }, c.lead),
    !signedIn && h("div", { class: "row" }, action()),
    c.sections.map((s) => h("section", {}, h("h2", {}, s.h), s.p.map((p) => h("p", {}, p)))),
    h("div", { class: "row" }, action()),
  );
}
