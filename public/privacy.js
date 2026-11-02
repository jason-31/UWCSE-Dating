import { h } from "/lib.js";
import { lang } from "/i18n.js";

// The privacy notice (docs/oversight.md rule 12), linked from the header for everyone, signed in
// or not. It must describe what the site actually does today, never more: update it whenever
// what is stored, who can see it or how long it is kept changes.
const CONTACT = "chines_cells_9s@icloud.com";
const REPO = "https://github.com/jason-31/UWCSE-Dating";

const CONTENT = {
  zh: {
    title: "隐私说明",
    updated: "最后更新：2026 年 11 月 1 日",
    lead: "这里说明本站存了你的哪些信息、谁能看到、保存多久，以及我们目前还做不到的地方。这里只写已经做到的事。本站由个人独立运营，不是 Paul G. Allen School 或华盛顿大学的官方服务，文中的“运营者”指这位个人运营者。",
    sections: [
      {
        h: "我们存什么",
        p: [
          "账号：你用来登录的学校邮箱，以及注册和同意网站规则的时间。",
          "资料：你在资料页填写的全部内容，包括昵称、性别、项目、头像、寻找的关系（以及在每个挑战里寻找哪几种）、筛选条件、对每种关系的期待、微信、Discord、研究兴趣和简介。",
          "挑战记录：你哪天签到、哪天完成了 LeetCode 题目、是否在当天的名单上，以及对应的时间。参加 LeetCode 挑战时，还有你绑定的 LeetCode 用户名和验证记录。",
          "另外还有：登录会话、你上传的头像图片、头像上传次数，以及封禁记录。",
          "我们不存：任何密码（登录交给 Google）；你的 LeetCode 密码、cookie 或代码。本站没有站内消息、点赞、匹配，也不记录谁看过谁，所以这些信息都不存在。",
        ],
      },
      {
        h: "怎么存",
        p: [
          "能识别你或描述你的信息都加密后保存：邮箱、全部资料、LeetCode 用户名、登录会话、头像图片和封禁原因。需要按邮箱查找时，数据库里只有用密钥算出的哈希，没有邮箱本身。",
          "加密密钥由公开仓库里的自动化流程生成，直接交给 Cloudflare 保存；生成过程中不显示密钥，也没有存到别的地方。直接读取数据库或文件存储，只能看到密文、哈希和元数据，例如记录条数、写入时间、哪个随机编号在哪天的名单上。",
          `网站代码完全公开：${REPO}`,
        ],
      },
      {
        h: "谁能看到什么",
        p: [
          "其他成员：只有和你在同一期名单上、在这个挑战里和你至少有一种共同寻找的关系、并且双方都满足对方筛选条件的人，才能看到你的卡片。卡片上总会有头像、昵称、性别、项目和学校邮箱；研究兴趣和简介填了就显示；微信和 Discord 只向你选择的关系显示；每段“期待”只向同样寻找那种关系的人显示。",
          "筛选是双向的：能在某种关系下看到你的人，会知道你在这种关系上接受他们的性别和项目。对约会来说，这可能透露你的性取向。",
          "首页会把你在各个挑战里能看到的人合并显示，不标明来源；但如果你只在一个挑战里寻找某种关系，在首页这种关系下看到你的人，能推断出你们是在那个挑战里遇到的。",
          "能看到你卡片的人可以截图或记下你的信息，我们无法阻止。",
          "网站运营者：本站没有任何查看资料的后台或接口，日志也不记录个人信息。但运营者控制网站的部署，可以修改并上线新代码，而新代码能读到解密后的数据。按规定，部署只通过公开仓库里的自动化流程进行，但目前还没有独立的第三方核对每一次上线是否都来自这个流程。运营者能看到上面说的元数据，也能封禁账号。",
          "Cloudflare：托管整个网站和数据库，会处理你的每个请求（包括 IP 地址），并按它自己的政策保存访问日志。Cloudflare 能接触运行中的系统，不在本站能保护的范围之内。",
          "Google：负责登录，所以 Google 知道你用学校账号登录了本站。我们只向 Google 请求你的邮箱，不请求姓名或头像。",
          "LeetCode：参加 LeetCode 挑战时，服务器会用你绑定的用户名向 LeetCode 查询你的公开资料和最近的通过记录。",
          "内测期间，网站还在 Cloudflare Access 后面，Access 会记录登录的邮箱和时间，运营者可以看到这些记录。",
        ],
      },
      {
        h: "保存多久",
        p: [
          "资料、签到和挑战记录：保存到你修改或注销为止。",
          "登录会话：30 天后过期并删除。没被资料用上的头像上传：1 天后删除。LeetCode 验证记录：7 天后删除，绑定令牌过期后删除。头像上传次数：30 天后删除。",
          "注销账号时，你的数据会立即删除，只留下一条由邮箱算出的哈希，保留到你原来资料的修改间隔结束（最多 30 天）；在此之前，这个邮箱不能重新注册。",
          "封禁记录（邮箱哈希和加密的原因）永久保存，注销账号也不会解除封禁。",
          "数据库服务（Cloudflare D1）会保留最近 7 天的历史版本用于恢复，所以删除的数据可能在其中再存在最多 7 天，同样是加密的。",
        ],
      },
      {
        h: "你可以",
        p: [
          "随时修改资料、收紧联系方式的可见范围、退出当期名单或某个挑战，或者注销账号，删除你在本站的全部数据。",
          `有疑问、想举报，或者需要我们处理你的数据，请写信到 ${CONTACT}。`,
        ],
      },
      {
        h: "目前还做不到的",
        p: [
          "如上所说，运营者可以上线新代码来读取数据，目前没有独立核对每次上线的机制。",
          "元数据没有加密：时间戳和名单记录如果与登录记录对照，可能把某个邮箱和它的签到、名单记录对应起来，但仍然看不到资料内容。",
          "能直接写数据库的人可以删除记录，或者把某个账号的随机编号加进名单；但读不到也改不了加密的资料。",
          "头像图片：拿到图片链接的已登录用户都能打开它。链接只出现在有权看到你卡片的人面前。",
          "如果加密密钥丢失，所有数据都将无法恢复，所有人需要重新注册。",
          "Cloudflare 本身（包括其员工和法律要求）不在本站能保护的范围之内。",
        ],
      },
    ],
    back: "返回首页",
  },
  en: {
    title: "Privacy notice",
    updated: "Last updated: November 1, 2026",
    lead: "What this site stores about you, who can see it, how long it is kept, and what we cannot promise yet. It only describes what is already in place. The site is run independently by an individual and is not a service of the Paul G. Allen School or the University of Washington; \"the operator\" below means that individual.",
    sections: [
      {
        h: "What we store",
        p: [
          "Your account: the school email you sign in with, and when you registered and accepted the site rules.",
          "Your profile: everything you fill in on it, including nickname, gender, program, avatar, what you are looking for (overall and in each challenge), your filters, what you hope for in each relationship, WeChat, Discord, research interests and bio.",
          "Challenge records: the days you checked in or completed the LeetCode problem, whether you were on that day's list, and the times. If you take part in LeetCode Daily, also the LeetCode username you bound and your verification records.",
          "Also: your sign-in sessions, the avatar images you upload, how many uploads you have made, and ban records.",
          "We do not store passwords (Google handles sign-in) or your LeetCode password, cookies or code. There are no messages, likes, matches or records of who viewed whom on this site, so none of that exists.",
        ],
      },
      {
        h: "How it is stored",
        p: [
          "Everything that identifies or describes you is stored encrypted: your email, your whole profile, your LeetCode username, your sessions, your avatar images and ban reasons. Where the database has to find you by email, it holds a keyed hash, not the email.",
          "The encryption key was generated by an automated process in the public repository and handed straight to Cloudflare; it was never displayed or saved anywhere else. Reading the database or the file storage directly shows only ciphertext, hashes and metadata, such as how many records there are, when they were written and which random id is on which day's list.",
          `The site's code is public: ${REPO}`,
        ],
      },
      {
        h: "Who can see what",
        p: [
          "Other members: only people on the same period's list as you, who share at least one relationship type you are looking for in that challenge, and who pass each other's filters, can see your card. It always shows your avatar, nickname, gender, program and school email; research interests and bio when you fill them in; WeChat and Discord only to the relationship types you choose; and each note on what you hope for only to people looking for that same type.",
          "Filters work both ways: anyone who can see you under a relationship type learns that you accept their gender and program for it. For dating, this can reveal your sexual orientation.",
          "The home page merges the people you can see in every challenge without saying where you met them. But if you look for a type in only one challenge, someone who sees you under that type on the home page can tell which challenge it was.",
          "People who can see your card can take screenshots or note down what it says; we cannot prevent that.",
          "The site operator: there is no admin page or endpoint that shows profiles, and logs never contain personal data. But the operator controls deployment and could put new code online, and new code could read decrypted data. Deployments are meant to happen only through the automated process in the public repository, but nobody independent checks yet that every deployment did. The operator can see the metadata described above and can ban accounts.",
          "Cloudflare hosts the whole site and its database, handles every request (including your IP address) and keeps access logs under its own policies. Cloudflare has access to the running system and is outside what this site can protect against.",
          "Google handles sign-in, so Google knows you signed in to this site with your school account. We only ask Google for your email, not your name or photo.",
          "LeetCode: when you take part in LeetCode Daily, the server asks LeetCode for the public profile and recent accepted submissions of the username you bound.",
          "During the closed beta the site sits behind Cloudflare Access, which records the email and time of each sign-in; the operator can see those records.",
        ],
      },
      {
        h: "How long we keep it",
        p: [
          "Your profile, check-ins and challenge records: until you change them or delete your account.",
          "Sign-in sessions expire and are deleted after 30 days. Uploaded avatars your profile does not use: deleted after a day. LeetCode verification records: deleted after 7 days; binding tokens once they expire. Upload counts: deleted after 30 days.",
          "When you delete your account, your data is deleted at once. Only a hash computed from your email remains, until the change limits on your old profile would have ended (at most 30 days); until then that email cannot register again.",
          "Ban records (an email hash and an encrypted reason) are kept permanently; deleting the account does not lift a ban.",
          "The database service (Cloudflare D1) keeps 7 days of history for recovery, so deleted data may remain there, still encrypted, for up to 7 more days.",
        ],
      },
      {
        h: "You can",
        p: [
          "Change your profile at any time, narrow who sees your contact details, leave the current list or a challenge, or delete your account and all your data here.",
          `For questions, reports or anything about your data, write to ${CONTACT}.`,
        ],
      },
      {
        h: "What we cannot promise yet",
        p: [
          "As above, the operator could put new code online that reads data, and nothing independent checks each deployment yet.",
          "Metadata is not encrypted: matched against sign-in records, timestamps and list records could link an email to its check-ins and list records, though not to any profile content.",
          "Someone able to write to the database directly could delete records or put an account's random id on a list, but could not read or change the encrypted profiles.",
          "Avatar images can be opened by any signed-in user who has the image link. The link only appears to people allowed to see your card.",
          "If the encryption key were lost, all data would be unrecoverable and everyone would have to register again.",
          "Cloudflare itself (its staff and legal requests) is outside what this site can protect against.",
        ],
      },
    ],
    back: "Back to home",
  },
}[lang];

export function privacyPage() {
  const c = CONTENT;
  return h(
    "article",
    { class: "panel about" },
    h("h1", {}, c.title),
    h("p", { class: "muted small" }, c.updated),
    h("p", { class: "lead" }, c.lead),
    c.sections.map((s) => h("section", {}, h("h2", {}, s.h), s.p.map((p) => h("p", {}, p)))),
    h("div", { class: "row" }, h("a", { href: "#/" }, c.back)),
  );
}
