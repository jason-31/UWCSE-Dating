import { lang, t } from "/i18n.js";

// Shared front-end helpers. Builds DOM nodes with textContent so user-supplied values are
// never parsed as HTML.
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "class") el.className = v;
    else if (k in el && typeof v !== "string") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  appendChildren(el, children);
  return el;
}

// Like el.replaceChildren(), but skips null/false/undefined the way h() does, so conditional
// children (cond && node) don't render as the text "false" or "null".
export function fill(el, ...children) {
  el.replaceChildren();
  appendChildren(el, children);
  return el;
}

function appendChildren(el, children) {
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

const DEV_USER_KEY = "uwcse-dev-user";

export function devUser() {
  try {
    return localStorage.getItem(DEV_USER_KEY) || "";
  } catch {
    return "";
  }
}

export function setDevUser(email) {
  try {
    if (email) localStorage.setItem(DEV_USER_KEY, email);
    else localStorage.removeItem(DEV_USER_KEY);
  } catch {}
}

export class ApiError extends Error {
  constructor(status, body) {
    // A 429 without our JSON body is Cloudflare refusing the Worker: the free daily request
    // quota is used up.
    super(body?.message || (status === 429 && !body ? t("daily_capacity") : t("request_failed", { status })));
    this.status = status;
    this.body = body;
  }
}

export async function api(path, { method = "GET", body } = {}) {
  const headers = { "x-uwcse-csrf": "1", "x-uwcse-lang": lang };
  if (body !== undefined) headers["content-type"] = "application/json";
  const dev = devUser();
  if (dev) headers["x-dev-user"] = dev;
  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

// Uploads a binary body (e.g. an image Blob) and returns the JSON response.
export async function apiUpload(path, blob) {
  const headers = { "x-uwcse-csrf": "1", "x-uwcse-lang": lang, "content-type": blob.type };
  const dev = devUser();
  if (dev) headers["x-dev-user"] = dev;
  const res = await fetch(path, { method: "POST", headers, body: blob });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export function fmtTime(ts, tz) {
  return new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", {
    timeZone: tz,
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ts));
}

export function toast(msg, kind = "info") {
  const el = h("div", { class: `toast ${kind}` }, msg);
  document.body.append(el);
  setTimeout(() => el.remove(), 4000);
}
