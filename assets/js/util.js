/**
 * util.js — 日期 / DOM / 剪贴板 / 提示等通用工具
 */

/* ---------------- 日期 ---------------- */

export const pad2 = (n) => String(n).padStart(2, '0');

/** 本地时区的 YYYY-MM-DD */
export function toISO(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function todayISO() {
  return toISO(new Date());
}

export function parseISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso, delta) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + delta);
  return toISO(d);
}

/** 两个日期相差的天数(a - b) */
export function diffDays(a, b) {
  return Math.round((parseISO(a) - parseISO(b)) / 86400000);
}

/** 周一开始的星期序号 0..6 */
export function weekdayIndex(iso) {
  return (parseISO(iso).getDay() + 6) % 7;
}

export function startOfWeek(iso) {
  return addDays(iso, -weekdayIndex(iso));
}

export function endOfWeek(iso) {
  return addDays(startOfWeek(iso), 6);
}

export function startOfMonth(iso) {
  return iso.slice(0, 7) + '-01';
}

export function endOfMonth(iso) {
  const d = parseISO(iso.slice(0, 7) + '-01');
  d.setMonth(d.getMonth() + 1, 0);
  return toISO(d);
}

export function monthLabel(iso) {
  const d = parseISO(iso);
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`;
}

export function dateLabel(iso) {
  const d = parseISO(iso);
  const week = ['一', '二', '三', '四', '五', '六', '日'][weekdayIndex(iso)];
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 周${week}`;
}

export function relativeLabel(iso) {
  const delta = diffDays(iso, todayISO());
  if (delta === 0) return '今天';
  if (delta === -1) return '昨天';
  if (delta === -2) return '前天';
  if (delta === 1) return '明天';
  return dateLabel(iso);
}

export function timeLabel(ts) {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 生成从 start 到 end 的日期数组 */
export function dateRange(startIso, endIso) {
  const out = [];
  let cur = startIso;
  let guard = 0;
  while (cur <= endIso && guard++ < 1000) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

/* ---------------- 文本 ---------------- */

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function truncate(text, len = 60) {
  const s = String(text ?? '');
  return s.length > len ? s.slice(0, len - 1) + '…' : s;
}

/* ---------------- DOM ---------------- */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** 绑定事件(带 data-action 委托) */
export function on(root, event, selector, handler) {
  root.addEventListener(event, (e) => {
    const target = e.target.closest(selector);
    if (target && root.contains(target)) handler(e, target);
  });
}

/* ---------------- 提示 ---------------- */

export function toast(message, kind = '', ms = 2200) {
  const host = document.getElementById('toast-host');
  if (!host) return;
  const el = document.createElement('div');
  el.className = `toast ${kind}`.trim();
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .25s ease, transform .25s ease';
    el.style.opacity = '0';
    el.style.transform = 'translateY(6px)';
    setTimeout(() => el.remove(), 260);
  }, ms);
}

/* ---------------- 剪贴板 / 分享 ---------------- */

/** 是否在微信内置浏览器里 */
export function isWeChat() {
  const ua = navigator.userAgent || '';
  return /MicroMessenger/i.test(ua);
}

/** 是否在手机浏览器里 */
export function isMobile() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
}

/**
 * 复制文本:依次尝试 Clipboard API → execCommand → 返回 false(由调用方弹出长按复制面板)。
 * 微信内置浏览器常禁用 navigator.clipboard,所以 execCommand 兜底是必须的。
 */
export async function copyText(text) {
  const value = String(text ?? '');
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch { /* 继续尝试下一种 */ }

  try {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', 'readonly');
    ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, value.length);
    const ok = document.execCommand('copy');
    ta.remove();
    if (ok) return true;
  } catch { /* 落到长按面板 */ }

  return false;
}

/**
 * 分享(优先系统分享面板 → 复制)
 * 微信里没有 navigator.share,会自动走复制。
 * @returns {Promise<'shared'|'copied'|'failed'>}
 */
export async function shareOrCopy({ title, text, url }) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return 'shared';
    } catch (err) {
      if (err && err.name === 'AbortError') return 'shared';
    }
  }
  const ok = await copyText([text, url].filter(Boolean).join('\n'));
  return ok ? 'copied' : 'failed';
}

/* ---------------- 其他 ---------------- */

export function debounce(fn, ms = 200) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function vibrate(ms = 12) {
  try { navigator.vibrate?.(ms); } catch { /* ignore */ }
}

/** 生成 4 位随机后缀(本地演示模式的 id) */
export function randomId(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/** 连续打卡天数:doneSet 为已完成日期集合,从 today 或昨天回溯 */
export function calcStreak(doneDates, refIso = todayISO()) {
  const set = doneDates instanceof Set ? doneDates : new Set(doneDates);
  let cursor = refIso;
  if (!set.has(cursor)) {
    cursor = addDays(cursor, -1);
    if (!set.has(cursor)) return 0;
  }
  let streak = 0;
  while (set.has(cursor) && streak < 3650) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/** 区间完成率(有打卡的天数 / 区间天数) */
export function completionRate(doneDates, startIso, endIso) {
  const set = doneDates instanceof Set ? doneDates : new Set(doneDates);
  const days = dateRange(startIso, endIso).filter((d) => d <= todayISO());
  if (days.length === 0) return 0;
  const hit = days.filter((d) => set.has(d)).length;
  return Math.round((hit / days.length) * 100);
}
