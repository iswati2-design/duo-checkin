/**
 * components.js — 可复用 UI 片段
 */

import { esc, dateLabel, relativeLabel, toast, copyText, shareOrCopy, isWeChat } from './util.js';

/** 环形进度 */
export function progressRing(percent, color = 'var(--primary)', size = 54, stroke = 6) {
  const p = Math.max(0, Math.min(100, Math.round(percent || 0)));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - p / 100);
  const mid = size / 2;
  return `
    <div class="ring" style="width:${size}px;height:${size}px">
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <circle cx="${mid}" cy="${mid}" r="${r}" fill="none" stroke="#eef0f4" stroke-width="${stroke}"></circle>
        <circle cx="${mid}" cy="${mid}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
          stroke-linecap="round" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"
          style="transition:stroke-dashoffset .4s ease"></circle>
      </svg>
      <span class="val">${p}%</span>
    </div>`;
}

/** 双人状态卡 */
export function personCard({ member, isMe, status, pendingTasksText = '', showActions = false, liked = false, nudged = false }) {
  if (!member) {
    return `
      <div class="person other">
        <div class="who">
          <div class="avatar">➕</div>
          <div class="grow">
            <div class="name">等待语伴加入</div>
            <div class="tiny muted">把邀请码发给 TA</div>
          </div>
        </div>
        <div class="mt12 small muted">两个人一起,才叫监督 😉</div>
      </div>`;
  }
  const color = isMe ? 'var(--primary)' : 'var(--accent)';
  const badge = status.checked
    ? `<span class="badge done">已打卡</span>`
    : `<span class="badge todo">未打卡</span>`;
  return `
    <div class="person ${isMe ? 'me' : 'other'}">
      <div class="who">
        <div class="avatar">${esc(member.emoji || '🐣')}</div>
        <div class="grow">
          <div class="name">${esc(member.nickname || '同学')}${isMe ? ' <span class="tiny muted">(我)</span>' : ''}</div>
          <div class="tiny muted">${status.checked ? `今日 <b>${status.durationMin}</b> 分钟` : '还没开始'}</div>
        </div>
        ${badge}
      </div>
      <div class="progress">
        ${progressRing(status.completion, color)}
        <div class="metrics grow">
          <div>任务 <b>${status.doneCount}</b>/<b>${status.totalTasks || 0}</b></div>
          <div>连续 <span class="streak">${status.streak} 天</span></div>
        </div>
      </div>
      ${showActions && !isMe ? `
        <div class="person-actions">
          <button data-action="like" class="${liked ? 'primary-ghost' : ''}">👍 ${liked ? '已点赞' : '点赞'}</button>
          <button data-action="nudge" class="${nudged ? 'primary-ghost' : ''}">🔔 ${nudged ? '已催' : '催打卡'}</button>
        </div>` : ''}
      ${pendingTasksText ? `<div class="tiny muted mt8">${esc(pendingTasksText)}</div>` : ''}
    </div>`;
}

/** 空状态 */
export function emptyState(icon, title, hint = '') {
  return `<div class="empty"><span class="ic">${icon}</span><div>${esc(title)}</div>${hint ? `<div class="tiny mt4">${esc(hint)}</div>` : ''}</div>`;
}

/** 底部弹层 */
export function openSheet({ title, subtitle = '', body, onMount }) {
  const host = document.getElementById('sheet-host');
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true">
      <div class="sheet-grip"></div>
      ${title ? `<h3>${esc(title)}</h3>` : ''}
      ${subtitle ? `<div class="small muted mt4">${esc(subtitle)}</div>` : ''}
      <div class="mt12">${body}</div>
      <div class="mt16"><button class="btn btn-ghost btn-block" data-action="close-sheet">关闭</button></div>
    </div>`;
  host.appendChild(backdrop);

  const close = () => {
    backdrop.style.transition = 'opacity .16s ease';
    backdrop.style.opacity = '0';
    setTimeout(() => backdrop.remove(), 170);
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop || e.target.closest('[data-action="close-sheet"]')) close();
  });
  onMount?.(backdrop.querySelector('.sheet'), close);
  return close;
}

/**
 * 长按复制面板 —— 微信里 Clipboard API / execCommand 都可能被禁用,
 * 这时弹出一个已全选的文本框,提示「长按选择复制」,保证一定能复制成功。
 */
export function openCopySheet(text, { title = '复制内容', hint = '' } = {}) {
  return openSheet({
    title,
    subtitle: hint || '长按下面的文字 → 全选 → 复制',
    body: `
      <textarea class="textarea" id="copy-area" readonly
        style="min-height:130px;font-size:13.5px;line-height:1.7">${esc(text)}</textarea>
      <div class="row mt12" style="gap:8px">
        <button class="btn btn-primary btn-sm grow" data-action="try-copy">再试一次自动复制</button>
      </div>`,
    onMount: (sheet) => {
      const area = sheet.querySelector('#copy-area');
      setTimeout(() => { try { area.focus(); area.select(); area.setSelectionRange(0, area.value.length); } catch { /* ignore */ } }, 120);
      sheet.addEventListener('click', async (e) => {
        if (e.target.closest('[data-action="try-copy"]')) {
          const ok = await copyText(text);
          if (ok) {
            toast('已复制 ✅', 'ok');
          } else {
            try { area.focus(); area.select(); } catch { /* ignore */ }
            toast('请长按文字手动复制', 'warn');
          }
        }
      });
    },
  });
}

/** 邀请语伴:复制微信里可直接发送的整段话(含邀请码 + 链接) */
export async function inviteActions(code) {
  const url = `${location.origin}${location.pathname}?join=${code}`;
  const text = `【语伴打卡】我在建了个语言学习房间,邀请码 ${code},一起每天互相监督吧 👇`;
  const result = await shareOrCopy({ title: '一起语言学习打卡', text, url });
  if (result === 'shared') return;
  if (result === 'copied') {
    toast(isWeChat() ? '已复制 ✅ 回到微信聊天窗口粘贴发送即可' : '邀请链接已复制,发给 TA 吧 📩', 'ok');
    return;
  }
  openCopySheet(`${text}\n${url}`, { title: '邀请语伴', hint: '长按文字 → 全选 → 复制 → 回到微信粘贴发送' });
}

export async function copyCode(code, label = '邀请码') {
  const ok = await copyText(code);
  if (ok) {
    toast(`${label} ${code} 已复制`, 'ok');
    return;
  }
  openCopySheet(code, { title: `复制${label}`, hint: '长按下面的邀请码 → 复制' });
}

/** 日期详情行(记录页用) */
export function dayDetailBlock({ date, me, partner, myLog, partnerLog, myTasks, partnerTasks }) {
  const block = (member, log, tasks) => {
    if (!member) return '';
    if (!log) {
      return `
        <div class="line">
          <div class="ic">${esc(member.emoji || '🐣')}</div>
          <div class="main">
            <div class="t1">${esc(member.nickname)}</div>
            <div class="t2">这天没有打卡记录</div>
          </div>
          <div class="tiny muted nowrap">未打卡</div>
        </div>`;
    }
    const done = new Set((log.log_tasks || []).filter((lt) => lt.is_done).map((lt) => lt.task_id));
    const doneNames = tasks.filter((t) => done.has(t.id)).map((t) => `${t.emoji || ''}${t.title}`);
    const missNames = tasks.filter((t) => !done.has(t.id)).map((t) => `${t.emoji || ''}${t.title}`);
    return `
      <div class="line" style="align-items:flex-start">
        <div class="ic">${esc(member.emoji || '🐣')}</div>
        <div class="main">
          <div class="t1">${esc(member.nickname)} · ${log.completion}% · ${log.duration_min} 分钟</div>
          <div class="t2" style="white-space:normal">${doneNames.length ? '完成:' + esc(doneNames.join('、')) : '未完成任何任务'}</div>
          ${missNames.length ? `<div class="tiny muted mt4">未完成:${esc(missNames.join('、'))}</div>` : ''}
          ${log.note ? `<div class="tiny mt4" style="color:var(--ink-2)">📝 ${esc(log.note)}</div>` : ''}
        </div>
      </div>`;
  };
  return `
    <div class="card tight">
      <div class="row-between">
        <div class="card-title">${esc(relativeLabel(date))} · ${esc(dateLabel(date))}</div>
        <button class="chip sm" data-action="record-on-date" data-date="${date}">补记这天</button>
      </div>
      ${block(me, myLog, myTasks)}
      ${block(partner, partnerLog, partnerTasks)}
    </div>`;
}
