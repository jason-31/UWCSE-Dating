// Site language (zh | en). The choice is kept per browser and sent to the server, which
// localizes its own messages.
const LANG_KEY = "uwcse-lang";

function detect() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === "zh" || saved === "en") return saved;
  } catch {}
  return /^zh/i.test(navigator.language || "") ? "zh" : "en";
}

export const lang = detect();
document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
// Tab title per language; index.html carries the English one for crawlers and no-JS.
document.title = lang === "zh" ? "UWCSE - 奶蛙恋爱" : "UWCSE - MilkFrog Dating";

export function setLang(next) {
  try {
    localStorage.setItem(LANG_KEY, next);
  } catch {}
  location.reload();
}

// makeT({ zh: {...}, en: {...} }) -> t(key, vars). Values may be strings with {name}
// placeholders or functions of vars.
export function makeT(dict) {
  const table = dict[lang] || dict.zh;
  return (key, vars = {}) => {
    const v = table[key] ?? dict.zh[key] ?? key;
    return typeof v === "function" ? v(vars) : v.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
  };
}

export const RELATIONS = {
  zh: { FRIENDSHIP: "朋友", STUDY: "学习搭子", ROMANCE: "恋爱" },
  en: { FRIENDSHIP: "Friendship", STUDY: "Study buddy", ROMANCE: "Romantic relationship" },
}[lang];

export const FIELDS = {
  zh: { email: "邮箱", wechat: "微信", discord: "Discord", bio: "简介", program: "项目", research: "研究兴趣" },
  en: { email: "Email", wechat: "WeChat", discord: "Discord", bio: "Bio", program: "Program", research: "Research interests" },
}[lang];

export const GENDERS = {
  zh: { MALE: "男", FEMALE: "女", NON_BINARY: "非二元", PREFER_NOT_TO_SAY: "不愿透露" },
  en: { MALE: "Male", FEMALE: "Female", NON_BINARY: "Non-binary", PREFER_NOT_TO_SAY: "Prefer not to say" },
}[lang];

// Allen School programs; codes come from the site config (profile.program_options). Shown with
// their official English names in both languages.
export const PROGRAMS = {
  BS_CS: "Bachelor of Science in Computer Science",
  BS_CE: "Bachelor of Science in Computer Engineering",
  BS_MS: "BS/MS",
  PMP: "Professional Master's Program (PMP)",
  PHD: "PhD",
  STAFF: "Staff",
};

// Strings shared by the site shell and the profile form.
export const t = makeT({
  zh: {
    loading: "加载中…",
    cannot_sign_in: "无法登录",
    my_profile: "我的资料",
    sign_out: "退出登录",
    banned_title: "此账号已被封禁",
    banned_body: "你的账号因违反网站规则已被永久封禁，不能再使用本站，你的卡片也已从所有名单中移除。你仍然可以注销账号，删除你在本站的全部数据。",
    login_error_domain: "只能用由 CSE 管理的 @cs.washington.edu Google 账号登录。如果你用的是个人 Google 账号，请切换到学校账号。",
    login_error_cancelled: "登录已取消。",
    login_error_other: "登录没有成功，请再试一次。",
    login_error_rate_limited: "登录尝试太频繁，请稍等一分钟再试。",
    login_error_daily_capacity: "本站今天的免费额度已经用完，UTC 0 点（太平洋时间下午 4 或 5 点）后恢复，请到时再登录。",
    daily_capacity: "本站今天的免费额度已经用完，UTC 0 点（太平洋时间下午 4 或 5 点）后恢复。",
    unregistered_uploads: "注册完成前，你上传的头像只用于这次注册；没有被资料用上的上传会在 1 天后自动删除。",
    delete_uploads: "删除我上传的头像并退出",
    delete_uploads_confirm: "删除你上传过的头像并退出登录？已经用掉的上传次数不会恢复。",
    show_more: "显示更多",
    about: "关于本站",
    privacy: "隐私说明",
    privacy_pre: "注册前请阅读",
    privacy_link: "隐私说明",
    privacy_post: "：我们存什么、谁能看到、保存多久，以及还做不到的地方。",
    dev_mode: "开发模式",
    dev_as: " 以此邮箱身份访问：",
    dev_placeholder: "默认使用 DEV_USER_EMAIL",
    switch: "切换",
    cannot_register: "暂时无法注册",
    email_not_allowed_pre: "你当前登录的邮箱 ",
    email_not_allowed_post: " 不在允许注册的域名内。请用学校 CS 邮箱登录。",
    site_rules: "网站规则",
    rule1: "本站通过可验证的学术挑战，让完成同一期任务、并且有共同交友意向的人发现彼此。",
    rule2: "这份个人资料全站通用。各挑战只会另外收集该挑战必需的信息（例如 LeetCode 账号）。",
    rule3: "本站不提供站内消息，只展示你主动开放的联系方式。",
    rule4: "“恋爱”指以长期关系为目标的认真交往。本站不支持寻找短期恋爱。",
    romance_hint: "“恋爱”指以长期关系为目标的认真交往，本站不支持寻找短期恋爱。",
    accept_rules: " 我已阅读并同意以上规则",
    welcome: "欢迎来到 UWCSE.date",
    welcome_pre: "你已以 ",
    welcome_post: " 登录，这个邮箱还没有注册。填写个人资料完成注册：",
    profile: "个人资料",
    register: "注册",
    accept_rules_first: "请先勾选同意网站规则",
    delete_account: "注销账号并删除全部数据",
    delete_account_confirm:
      "将删除你的个人资料以及在所有挑战中的绑定、完成记录和名单资格，无法恢复。为防止有人删号重注册来绕过资料修改限制，如果你的资料修改锁还没到期，删除后要等到期（最多 30 天）才能用同一邮箱重新注册。为此，以及为了让头像上传次数不因删号而重置，我们在 30 天内只保留由邮箱算出、无法还原成邮箱的哈希。确定吗？",
    profile_intro: "这份资料全站通用，修改后对所有仍可访问的名单立即生效。",
    save_profile: "保存资料",
    saved: "资料已保存",
    account: "账号",
    challenge_title: "挑战",
    challenge_intro: "每个挑战独立出题、独立验证、独立名单。",
    no_challenge: "暂无开放的挑战。",
    people_title: "你能看到的人",
    people_intro: "所有你此刻能浏览的名单里的人，按你寻找的关系分组。同时和你有几种共同关系的人，会出现在每一组里。点开查看详细资料。",
    no_people_rel: "暂时还没有。",
    people_count: "{n} 人",
    no_people: "现在还没有你能看到的人。完成任意挑战的当期任务并入列后，名单里的人会出现在这里。",
    research_prefix: "研究兴趣：",
    note_title: "对“{rel}”的期待",
    close: "关闭",
    challenge_missing: "该挑战不存在或未启用。",
    back_home: "返回首页",
    request_failed: "请求失败（{status}）",

    sec_basic: "基本信息",
    sec_basic_hint: "必填，对所有能看到你卡片的人展示。昵称、性别和项目保存后 {days} 天内不能再修改；头像随时可以换。",
    basic_locked: "昵称、性别和项目在 {time} 之后才能再次修改；头像随时可以换。",
    sec_contact: "联系信息",
    sec_contact_hint: "微信和 Discord 可以选择是否展示、对哪种共同关系展示。",
    sec_about: "关于我",
    sec_about_hint: "选填，填了就对所有能看到你卡片的人展示。长度按字母、数字算 1，汉字等全角字符算 2 计。",
    length_rule: "字母、数字算 1，汉字等全角字符算 2",
    sec_relations: "寻找什么关系",
    label_gender: "性别",
    label_program: "项目",
    f_gender: "性别 *",
    f_program: "项目 *",
    f_avatar: "头像 *",
    upload_avatar: "上传头像",
    uploading: "上传中…",
    my_upload: "我上传的头像",
    upload_limit_hint: "上传头像每 {days} 天最多 {n} 次，上传失败也算一次。换头像不限次数：预设头像和你最近上传的头像随时可选。",
    image_too_large: "图片太大，请换一张",
    image_unreadable: "无法读取这张图片",
    f_nickname: "昵称 *",
    f_email: "邮箱",
    email_fixed: "使用你登录本站的学校邮箱，不能修改，所有能看到你卡片的人都会看到。",
    f_relations: "寻找的关系 *（可多选）",
    matching_locked: "寻找的关系和筛选条件在 {time} 之后才能再次修改。",
    matching_cooldown: "保存后，{days} 天内不能再修改。",
    relation_block: "寻找“{rel}”",
    filter_title: "筛选：只和勾选范围内的人互相看到",
    filter_need_one: "每项筛选至少保留一个选项",
    filter_hint:
      "默认全选，表示不限；取消勾选后，只和性别、项目在勾选范围内的人互相看到。筛选是双向的：你也要符合对方的条件才会互相看到。请注意：能在某种关系下看到你的人，会知道你在这种关系上接受他们的性别和项目；对“恋爱”来说，这可能透露你的性取向。性别由每个人自己填写。",
    preview_only: "筛选：{only}",
    preview_any: "不筛选",
    note_label: "对这段关系的期待（选填）",
    note_placeholder: "例如你希望怎样相处、多久见一次面",
    note_hint: "只有同样寻找这种关系的人能看到这段话。",
    research_placeholder: "例如 PL、系统、HCI",
    show_to: "向以下共同关系展示：",
    preview: "可见性预览",
    preview_row: "：基本信息、关于我",
    preview_note: "对这段关系的期待",
    preview_empty: "至少选择一种关系后可预览。",
    preview_footer: "只有和你在同一个挑战同一期名单里、且至少有一种共同关系的人能看到你的卡片。每个字段只展示给你在这里勾选、且对方也在寻找的关系。每个挑战还可以在自己的设置里只选其中几种关系。",
    sep: "、",
  },
  en: {
    loading: "Loading…",
    cannot_sign_in: "Cannot sign in",
    my_profile: "My profile",
    sign_out: "Sign out",
    banned_title: "This account has been banned",
    banned_body: "Your account has been permanently banned for breaking the site rules. You can no longer use the site, and your card has been removed from every list. You can still delete your account and all your data here.",
    login_error_domain: "Only @cs.washington.edu Google accounts managed by CSE can sign in. If you used a personal Google account, switch to your school account.",
    login_error_cancelled: "Sign-in was cancelled.",
    login_error_other: "Sign-in didn't work. Please try again.",
    login_error_rate_limited: "Too many sign-in attempts. Please wait a minute and try again.",
    login_error_daily_capacity: "The site has used up today's free capacity. It comes back at 00:00 UTC (4 or 5 pm Pacific time); please sign in again then.",
    daily_capacity: "The site has used up today's free capacity. It comes back at 00:00 UTC (4 or 5 pm Pacific time).",
    unregistered_uploads: "Until you finish registering, an avatar you upload is only used for this registration; uploads no profile uses are deleted automatically after a day.",
    delete_uploads: "Delete my uploads and sign out",
    delete_uploads_confirm: "Delete the avatars you uploaded and sign out? Upload attempts you have used are not restored.",
    show_more: "Show more",
    about: "About",
    privacy: "Privacy",
    privacy_pre: "Before registering, read the ",
    privacy_link: "privacy notice",
    privacy_post: ": what we store, who can see it, how long we keep it, and what we cannot promise yet.",
    dev_mode: "Dev mode",
    dev_as: " Act as email: ",
    dev_placeholder: "Defaults to DEV_USER_EMAIL",
    switch: "Switch",
    cannot_register: "Registration unavailable",
    email_not_allowed_pre: "The email you signed in with, ",
    email_not_allowed_post: ", is not in an allowed domain. Please sign in with your CSE email.",
    site_rules: "Site rules",
    rule1: "Through verifiable academic challenges, people who finish the same period and share a relationship goal can find each other.",
    rule2: "This profile is shared across the whole site. Each challenge only collects what it strictly needs (e.g. your LeetCode account).",
    rule3: "There is no messaging on this site; only the contact details you choose to share are shown.",
    rule4: "\"Romantic relationship\" means dating seriously with a long-term relationship in mind. This site does not support looking for short-term relationships.",
    romance_hint: "\"Romantic relationship\" means dating seriously with a long-term relationship in mind; this site does not support looking for short-term relationships.",
    accept_rules: " I have read and accept these rules",
    welcome: "Welcome to UWCSE.date",
    welcome_pre: "You are signed in as ",
    welcome_post: ", which is not registered yet. Fill in your profile to register:",
    profile: "Profile",
    register: "Register",
    accept_rules_first: "Please accept the site rules first",
    delete_account: "Delete account and all data",
    delete_account_confirm:
      "This deletes your profile and all your bindings, completions and list memberships in every challenge. This cannot be undone. So that nobody can delete and re-register to get around the profile change limits, if a profile change lock is still running you can only register again with this email once it expires (at most 30 days). For that, and so that deleting does not reset the avatar upload count, we keep for up to 30 days only hashes computed from your email that cannot be turned back into it. Continue?",
    profile_intro: "This profile is shared across the site; changes apply immediately to every list that can still be viewed.",
    save_profile: "Save profile",
    saved: "Profile saved",
    account: "Account",
    challenge_title: "Challenges",
    challenge_intro: "Each challenge has its own problems, verification and lists.",
    no_challenge: "No challenges are open right now.",
    people_title: "People you can see",
    people_intro: "Everyone on all the lists you can browse right now, grouped by what you're looking for. Someone who shares several goals with you appears in each of those groups. Open someone to see their details.",
    no_people_rel: "No one yet.",
    people_count: "{n} people",
    no_people: "No one to show yet. Complete the current task of any challenge and join its list, and the people there will show up here.",
    research_prefix: "Research: ",
    note_title: "Hopes for {rel}",
    close: "Close",
    challenge_missing: "This challenge does not exist or is disabled.",
    back_home: "Back to home",
    request_failed: "Request failed ({status})",

    sec_basic: "Basic info",
    sec_basic_hint: "Required, and shown to everyone who can see your card. Once saved, nickname, gender and program can't be changed for {days} days; the avatar can change any time.",
    basic_locked: "You can change your nickname, gender and program again after {time}; the avatar can change any time.",
    sec_contact: "Contact",
    sec_contact_hint: "For WeChat and Discord you choose whether, and to which shared relationships, each is shown.",
    sec_about: "About me",
    sec_about_hint: "Optional; whatever you fill in is shown to everyone who can see your card. Length counts letters and digits as 1 and Chinese and other full-width characters as 2.",
    length_rule: "Letters and digits count 1; Chinese and other full-width characters count 2",
    sec_relations: "What you're looking for",
    label_gender: "Gender",
    label_program: "Program",
    f_gender: "Gender *",
    f_program: "Program *",
    f_avatar: "Avatar *",
    upload_avatar: "Upload",
    uploading: "Uploading…",
    my_upload: "My upload",
    upload_limit_hint: "You can upload an avatar at most {n} times every {days} days, failed uploads included. Switching avatars is unlimited: the presets and your latest upload are always available.",
    image_too_large: "The image is too large; please choose another",
    image_unreadable: "Couldn't read that image",
    f_nickname: "Nickname *",
    f_email: "Email",
    email_fixed: "The school email you signed in with. It cannot be changed and is shown to everyone who can see your card.",
    f_relations: "Looking for * (choose any)",
    matching_locked: "You can change what you're looking for and your filters again after {time}.",
    matching_cooldown: "Once saved, it can't be changed for {days} days.",
    relation_block: "Looking for: {rel}",
    filter_title: "Filter: only see each other within the ticked options",
    filter_need_one: "Keep at least one option ticked in each filter",
    filter_hint:
      "Everything is ticked by default, meaning no restriction; untick to only see each other with people whose gender and program are ticked. Filters work both ways: you also have to meet theirs to see each other. Note: anyone who can see you under a relationship learns that your filter for it accepts their gender and program; for a romantic relationship, this can reveal your sexual orientation. Gender is self-reported.",
    preview_only: "Filter: {only}",
    preview_any: "No filter",
    note_label: "What you hope for (optional)",
    note_placeholder: "e.g. how you'd like to spend time together, how often to meet",
    note_hint: "Only people also looking for this will see it.",
    research_placeholder: "e.g. PL, systems, HCI",
    show_to: "Show to shared relationships:",
    preview: "Visibility preview",
    preview_row: ": basic info, about me",
    preview_note: "your hopes for it",
    preview_empty: "Choose at least one relationship to see the preview.",
    preview_footer: "Only people on the same period's list of the same challenge who share at least one relationship type with you can see your card. Each field is shown only for the relationships you tick here that they are also looking for. Each challenge's settings can narrow this to some of the types.",
    sep: ", ",
  },
});

export function fmtDateTime(ts) {
  return new Date(ts).toLocaleString(lang === "zh" ? "zh-CN" : "en-US", { hour12: false });
}
