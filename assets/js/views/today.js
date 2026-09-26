/**
 * views/today.js — 今日:双人状态 + 我的打卡 + 互相监督
 */

import { esc, toast, copyText, shareOrCopy, relativeLabel, timeLabel, isWeChat } from '../util.js';
import { personCard, openSheet, inviteActions, copyCode, openCopySheet } from '../components.js';

const DURATION_CHIPS = [10, 15, 20, 30, 45, 60];

/** 生成给对方的提醒文案 */
export function buildReminderText({ partner, partnerStatus, myStatus, partnerTasks, room }) {
  if (!partner) return '';
  const pending = partnerTasks.filter((t) => !partnerStatus.log || !((partnerStatus.log.log_tasks || []).some((lt) => lt.is_done && lt.task_id === t.id)));
  const targets = (pending.length ? pending : partnerTasks)
    .map((t) => `${t.emoji || '📌'}${t.title} ${t.target_value}${t.target_unit}`)
    .join('、');
  const url = `${location.origin}${location.pathname}?join=${room?.code || ''}`;
  const head = partnerStatus.checked
    ? `${partner.emoji || '🦊'} ${partner.nickname},今天已经打卡啦,继续保持!`
    : `${partner.emoji || '🦊'} ${partner.nickname},今天的语言学习还没打卡哦!`;
  const body = partnerStatus.checked
    ? `我这边也完成了 ${myStatus.doneCount}/${myStatus.totalTasks} 项,明天继续一起加油 💪`
    : `今天的目标:${targets || '你的每日任务'}\n我这边已经完成 ${myStatus.doneCount}/${myStatus.totalTasks} 项啦,等你一起 💪`;
  return `${head}\n${body}\n👉 打开打卡:${url}`;
}

function taskRows(tasks, doneIds, interactive) {
  if (tasks.length === 0) {
    return `<div class="empty" style="padding:18px 0"><span class="ic">📝</span><div>还没有任务</div><div class="tiny mt4">去「我的」页添加每天要完成的学习任务</div></div>`;
  }
  return tasks
    .map((t) => {
      const on = doneIds.has(t.id);
      return `
      <div class="task ${on ? 'on' : ''}" ${interactive ? `data-action="toggle-task" data-id="${t.id}"` : ''}>
        <div class="tick">${on ? '✓' : ''}</div>
        <div class="t-emoji">${esc(t.emoji || '📌')}</div>
        <div class="grow">
          <div class="t-title">${esc(t.title)}</div>
          <div class="t-meta">目标 ${t.target_value}${esc(t.target_unit || '')}</div>
        </div>
      </div>`;
    })
    .join('');
}

export function renderToday(ctx) {
  const { state, store } = ctx;
  const { me, partner, room, draft, mode } = state;
  if (!me) return '';

  const myStatus = store.statusOf(me.id);
  const partnerStatus = partner ? store.statusOf(partner.id) : null;
  const myTasks = store.memberTasks(me.id);
  const partnerTasks = partner ? store.memberTasks(partner.id) : [];
  const rx = store.reactionSummary();
  const partnerDoneIds = partnerStatus ? store.doneTaskIdsOf(partnerStatus.log) : new Set();

  const modeNotice = mode === 'local'
    ? `<div class="notice"><span>🧪</span><span><b>本地演示模式</b>:数据只在本机,对方是模拟语伴。<a href="#" data-action="open-setup">配置 Supabase</a> 即可两台手机真实同步。</span></div>`
    : '';

  // 微信内置浏览器的一键打开提示(看过一次就不再显示)
  const wechatTip = isWeChat() && !localStorage.getItem('duo.wechatTipDismissed')
    ? `<div class="notice info">
         <span>💡</span>
         <span><b>在微信里这样用更顺手:</b>点右上角 <b>⋯</b> → <b>浮窗</b>,下次从微信一点就进来;
         或在 ⋯ 里选「在浏览器打开」后<b>添加到主屏幕</b>,像 App 一样用。
         <a href="#" data-action="dismiss-wechat-tip">知道了</a></span>
       </div>`
    : '';

  const inviteCard = !partner
    ? `<div class="card">
        <div class="card-head"><div class="card-title"><span class="emoji">💌</span>邀请你的语伴</div></div>
        <div class="small muted">把下面这串邀请码发给 TA,TA 用「加入房间」输入即可。</div>
        <div class="invite-link mt12">邀请码 <b style="letter-spacing:3px;font-size:16px">${esc(room?.code || '')}</b></div>
        <div class="row mt12" style="gap:8px">
          <button class="btn btn-soft btn-sm grow" data-action="copy-code">复制邀请码</button>
          <button class="btn btn-primary btn-sm grow" data-action="invite">分享邀请链接</button>
        </div>
      </div>`
    : '';

  const reminderText = partner ? buildReminderText({ partner, partnerStatus, myStatus, partnerTasks, room }) : '';

  const feedItems = rx.list.slice(0, 6).map((r) => {
    const from = r.from_member === me.id ? '我' : (partner?.nickname || '对方');
    const to = r.to_member === me.id ? '我' : (partner?.nickname || '对方');
    const label = r.kind === 'like' ? '👍 点赞' : r.kind === 'cheer' ? '🎉 加油' : '🔔 催打卡';
    return `<div class="feed-item">
        <span class="pill ${r.kind === 'cheer' ? 'cheer' : ''}">${label}</span>
        <span class="grow">${esc(from)} → ${esc(to)}${r.message ? ` · ${esc(r.message)}` : ''}</span>
        <span class="tiny muted nowrap">${timeLabel(r.created_at)}</span>
      </div>`;
  }).join('');

  const pendingPartnerTasks = partner
    ? partnerTasks.filter((t) => !partnerDoneIds.has(t.id)).map((t) => `${t.emoji || ''}${t.title}`).join('、')
    : '';

  return `
  <div class="page">
    <div class="room-bar">
      <div class="grow">
        <div class="label">房间邀请码</div>
        <div class="code" data-action="copy-code">${esc(room?.code || '------')}</div>
      </div>
      <button class="btn-invite" data-action="invite">邀请语伴</button>
    </div>

    ${modeNotice ? `<div class="mt12">${modeNotice}</div>` : ''}
    ${wechatTip ? `<div class="mt12">${wechatTip}</div>` : ''}

    <div class="duo mt12">
      ${personCard({ member: me, isMe: true, status: myStatus })}
      ${personCard({
        member: partner,
        isMe: false,
        status: partnerStatus || { completion: 0, streak: 0, doneCount: 0, totalTasks: 0, durationMin: 0, checked: false },
        showActions: true,
        liked: rx.likedByMe > 0,
        nudged: rx.nudgedByMe > 0,
        pendingTasksText: pendingPartnerTasks ? `还没完成:${pendingPartnerTasks}` : '',
      })}
    </div>

    ${inviteCard ? `<div class="mt12">${inviteCard}</div>` : ''}

    <div class="card mt12">
      <div class="card-head">
        <div class="card-title"><span class="emoji">✅</span>我的今日任务</div>
        <div class="tiny muted">${relativeLabel(state.today)}</div>
      </div>
      ${taskRows(myTasks, draft.doneTaskIds, true)}

      <div class="mt16">
        <div class="row-between">
          <div class="bold small">今日学习时长</div>
          <div class="tiny muted">分钟</div>
        </div>
        <div class="row mt8" style="gap:10px">
          <div class="stepper">
            <button data-action="dur-minus">−</button>
            <div class="num">${draft.durationMin || 0}</div>
            <button data-action="dur-plus">+</button>
          </div>
        </div>
        <div class="chips mt8">
          ${DURATION_CHIPS.map((m) => `<button class="chip sm ${draft.durationMin === m ? 'on' : ''}" data-action="dur-set" data-min="${m}">${m} 分</button>`).join('')}
        </div>
      </div>

      <div class="field mt16">
        <label>今日备注(可选)</label>
        <textarea class="textarea" data-action="note" placeholder="今天学了什么?状态如何?">${esc(draft.note || '')}</textarea>
      </div>

      <button class="btn ${myStatus.checked ? 'btn-soft' : 'btn-primary'} btn-block mt16" data-action="submit-log" ${state.saving ? 'disabled' : ''}>
        ${state.saving ? '保存中…' : myStatus.checked ? '更新今日打卡' : '提交今日打卡'}
      </button>
      <div class="tiny muted center mt8">
        ${myStatus.checked
          ? `已打卡 · 完成 ${myStatus.doneCount}/${myStatus.totalTasks} 项 · ${myStatus.durationMin} 分钟 · 连续 ${myStatus.streak} 天`
          : draft.dirty ? '有未保存的修改,记得点上面的按钮' : '勾选完成的任务,填写时长后提交'}
      </div>
    </div>

    ${partner ? `
    <div class="card mt12">
      <div class="card-head"><div class="card-title"><span class="emoji">🤝</span>互相监督</div></div>
      <div class="row" style="gap:8px">
        <button class="btn btn-soft btn-sm grow" data-action="like">👍 给 TA 点赞</button>
        <button class="btn btn-accent btn-sm grow" data-action="nudge">🔔 催 TA 打卡</button>
        <button class="btn btn-ghost btn-sm grow" data-action="reminder">📋 提醒文案</button>
      </div>
      <div class="tiny muted mt8">
        今日互动:我点赞 ${rx.likedByMe} · 我催打卡 ${rx.nudgedByMe} · 收到赞 ${rx.likesToMe}${rx.nudgesToMe ? ` · 被催 ${rx.nudgesToMe}` : ''}
      </div>
    </div>` : ''}

    <div class="card mt12">
      <div class="card-head"><div class="card-title"><span class="emoji">📣</span>今日动态</div></div>
      ${feedItems ? `<div class="feed">${feedItems}</div>` : `<div class="empty" style="padding:14px 0"><div>今天还没有互动</div><div class="tiny mt4">点个赞,或者催 TA 打卡</div></div>`}
    </div>
  </div>`;
}

/** 今日页事件绑定(由 main.js 的全局委托调用) */
export async function handleTodayAction({ action, el, ctx }) {
  const { store, state } = ctx;
  const { me, partner } = state;

  switch (action) {
    case 'toggle-task':
      store.toggleTask(el.dataset.id);
      return true;
    case 'dur-minus':
      store.bumpDuration(-5);
      return true;
    case 'dur-plus':
      store.bumpDuration(5);
      return true;
    case 'dur-set':
      store.setDuration(Number(el.dataset.min));
      return true;
    case 'submit-log': {
      const anyDone = state.draft.doneTaskIds.size > 0;
      const hasDuration = (state.draft.durationMin || 0) > 0;
      const hasNote = !!(state.draft.note || '').trim();
      if (!anyDone && !hasDuration && !hasNote) {
        toast('至少勾选一个已完成任务,或填写学习时长', 'warn');
        return true;
      }
      try {
        await store.submitLog();
        toast('打卡成功,继续保持!🎉', 'ok');
      } catch (err) {
        toast(err.message || '提交失败', 'err');
      }
      return true;
    }
    case 'copy-code':
      await copyCode(state.room?.code || '');
      return true;
    case 'dismiss-wechat-tip':
      localStorage.setItem('duo.wechatTipDismissed', '1');
      store.emit();
      return true;
    case 'invite':
      await inviteActions(state.room?.code || '');
      return true;
    case 'like':
      try {
        await store.sendReaction({ kind: 'like', message: '给你点个赞 👍' });
        toast('已点赞 👍', 'ok');
      } catch (err) { toast(err.message, 'err'); }
      return true;
    case 'nudge':
      try {
        await store.sendReaction({ kind: 'nudge', message: partner && store.statusOf(partner.id).checked ? '明天继续保持!' : '该打卡啦,别偷懒 😉' });
        toast('已发出催打卡 🔔', 'ok');
      } catch (err) { toast(err.message, 'err'); }
      return true;
    case 'reminder': {
      const myStatus = store.statusOf(me.id);
      const partnerStatus = partner ? store.statusOf(partner.id) : null;
      const text = buildReminderText({
        partner, partnerStatus, myStatus,
        partnerTasks: partner ? store.memberTasks(partner.id) : [],
        room: state.room,
      });
      openSheet({
        title: '提醒文案',
        subtitle: '复制后发给 TA(微信 / QQ / 短信都行)',
        body: `
          <div class="invite-link" style="white-space:pre-wrap">${esc(text)}</div>
          <div class="row mt12" style="gap:8px">
            <button class="btn btn-primary btn-sm grow" data-action="copy-reminder">复制文案</button>
            <button class="btn btn-ghost btn-sm grow" data-action="share-reminder">分享 / 发送</button>
          </div>`,
        onMount: (sheet) => {
          sheet.addEventListener('click', async (e) => {
            const act = e.target.closest('[data-action]')?.dataset.action;
            if (act === 'copy-reminder') {
              const ok = await copyText(text);
              if (ok) toast(isWeChat() ? '已复制 ✅ 回微信粘贴给 TA' : '文案已复制,去粘贴给 TA 吧 📋', 'ok');
              else openCopySheet(text, { title: '提醒文案', hint: '长按文字 → 全选 → 复制 → 回微信粘贴' });
            }
            if (act === 'share-reminder') {
              const r = await shareOrCopy({ title: '打卡提醒', text });
              if (r === 'copied') toast('已复制文案', 'ok');
              else if (r === 'failed') openCopySheet(text, { title: '提醒文案' });
            }
          });
        },
      });
      return true;
    }
    default:
      return false;
  }
}
