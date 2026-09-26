/**
 * views/me.js — 我的:资料 / 任务管理 / 房间 / 统计 / 设置
 */

import { esc, toast, copyText, todayISO, dateLabel, startOfWeek, endOfWeek, completionRate } from '../util.js';
import { openSheet, inviteActions, copyCode } from '../components.js';
import { openSetupSheet } from './onboarding.js';
import { getConfig } from '../config.js';

const TASK_EMOJIS = ['📚', '🎧', '🗣️', '📖', '✍️', '🔤', '🧠', '🎬', '📝', '🎯', '💬', '🔊', '🈶', '📰'];
const UNITS = ['个', '分钟', '篇', '页', '句', '课', '次'];
const PROFILE_EMOJIS = ['🐣', '🦊', '🐼', '🐨', '🐯', '🦁', '🐸', '🐙', '🦄', '🐧', '🌻', '🍀', '📚', '🚀'];

function taskRow(task) {
  return `
    <div class="line">
      <div class="ic">${esc(task.emoji || '📌')}</div>
      <div class="main">
        <div class="t1">${esc(task.title)}</div>
        <div class="t2">目标 ${task.target_value}${esc(task.target_unit || '')}</div>
      </div>
      <button class="chip sm" data-action="edit-task" data-id="${task.id}">编辑</button>
      <button class="chip sm" data-action="delete-task" data-id="${task.id}" style="color:var(--danger);border-color:#f6d5d5">删除</button>
    </div>`;
}

function openTaskSheet(ctx, task) {
  const isEdit = !!task;
  let emoji = task?.emoji || '📚';
  let unit = task?.target_unit || '个';
  openSheet({
    title: isEdit ? '编辑任务' : '添加学习任务',
    subtitle: isEdit ? '' : '例如:背单词 50 个 / 听力 20 分钟',
    body: `
      <div class="field">
        <label>任务名称</label>
        <input class="input" id="tk-title" maxlength="16" placeholder="背单词" value="${esc(task?.title || '')}" />
      </div>
      <div class="field mt12">
        <label>选个图标</label>
        <div class="emoji-pick" id="tk-emoji">
          ${TASK_EMOJIS.map((e) => `<button data-emoji="${e}" class="${e === emoji ? 'on' : ''}">${e}</button>`).join('')}
        </div>
      </div>
      <div class="field mt12">
        <label>每日目标</label>
        <div class="row" style="gap:10px">
          <input class="input" id="tk-target" type="number" min="1" max="9999" style="width:110px" value="${task?.target_value ?? 50}" />
          <div class="chips" id="tk-units">
            ${UNITS.map((u) => `<button class="chip sm ${u === unit ? 'on' : ''}" data-unit="${u}">${u}</button>`).join('')}
          </div>
        </div>
      </div>
      <button class="btn btn-primary btn-block mt16" data-action="save-task">${isEdit ? '保存修改' : '添加任务'}</button>`,
    onMount: (sheet, close) => {
      const emojiHost = sheet.querySelector('#tk-emoji');
      emojiHost.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-emoji]');
        if (!btn) return;
        emoji = btn.dataset.emoji;
        emojiHost.querySelectorAll('[data-emoji]').forEach((b) => b.classList.toggle('on', b === btn));
      });
      const unitHost = sheet.querySelector('#tk-units');
      unitHost.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-unit]');
        if (!btn) return;
        unit = btn.dataset.unit;
        unitHost.querySelectorAll('[data-unit]').forEach((b) => b.classList.toggle('on', b === btn));
      });
      sheet.addEventListener('click', async (e) => {
        if (e.target.closest('[data-action="save-task"]')) {
          const title = sheet.querySelector('#tk-title').value.trim();
          const targetValue = Number(sheet.querySelector('#tk-target').value) || 1;
          if (!title) { toast('请填写任务名称', 'warn'); return; }
          try {
            if (isEdit) {
              await ctx.store.updateTask({
                id: task.id, memberId: ctx.state.me.id, title, emoji,
                targetValue, targetUnit: unit, sortOrder: task.sort_order, isActive: true,
              });
              toast('任务已更新', 'ok');
            } else {
              await ctx.store.addTask({ title, emoji, targetValue, targetUnit: unit });
              toast('任务已添加', 'ok');
            }
            close();
          } catch (err) { toast(err.message || '保存失败', 'err'); }
        }
      });
    },
  });
}

function openRoomSwitchSheet(ctx) {
  openSheet({
    title: '换一个房间',
    subtitle: '输入对方的邀请码即可加入新房间(原房间的打卡记录会保留)',
    body: `
      <div class="field">
        <label>6 位邀请码</label>
        <input class="input code" id="sw-code" maxlength="6" placeholder="ABC123" />
      </div>
      <button class="btn btn-primary btn-block mt16" data-action="switch-room">加入这个房间</button>`,
    onMount: (sheet, close) => {
      sheet.addEventListener('click', async (e) => {
        if (e.target.closest('[data-action="switch-room"]')) {
          const code = sheet.querySelector('#sw-code').value.trim().toUpperCase();
          if (code.length !== 6) { toast('请输入 6 位邀请码', 'warn'); return; }
          try {
            await ctx.store.joinRoom({ code, nickname: ctx.state.me.nickname, emoji: ctx.state.me.emoji });
            toast('已加入新房间 🎉', 'ok');
            close();
          } catch (err) { toast(err.message || '加入失败', 'err'); }
        }
      });
    },
  });
}

function openProfileSheet(ctx) {
  let emoji = ctx.state.me.emoji || '🐣';
  openSheet({
    title: '编辑我的资料',
    body: `
      <div class="field">
        <label>昵称</label>
        <input class="input" id="pf-name" maxlength="12" value="${esc(ctx.state.me.nickname || '')}" />
      </div>
      <div class="field mt12">
        <label>头像</label>
        <div class="emoji-pick" id="pf-emoji">
          ${PROFILE_EMOJIS.map((e) => `<button data-emoji="${e}" class="${e === emoji ? 'on' : ''}">${e}</button>`).join('')}
        </div>
      </div>
      <button class="btn btn-primary btn-block mt16" data-action="save-profile">保存</button>`,
    onMount: (sheet, close) => {
      const host = sheet.querySelector('#pf-emoji');
      host.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-emoji]');
        if (!btn) return;
        emoji = btn.dataset.emoji;
        host.querySelectorAll('[data-emoji]').forEach((b) => b.classList.toggle('on', b === btn));
      });
      sheet.addEventListener('click', async (e) => {
        if (e.target.closest('[data-action="save-profile"]')) {
          const nickname = sheet.querySelector('#pf-name').value.trim();
          if (!nickname) { toast('昵称不能为空', 'warn'); return; }
          try {
            await ctx.store.updateProfile({ nickname, emoji });
            toast('资料已更新', 'ok');
            close();
          } catch (err) { toast(err.message || '保存失败', 'err'); }
        }
      });
    },
  });
}

export function renderMe(ctx) {
  const { state, store } = ctx;
  const { me, partner, room, mode } = state;
  if (!me) return '';
  const cfg = getConfig();

  const myTasks = store.memberTasks(me.id);
  const myDone = store.doneDatesOf(me.id);
  const myWeek = store.weekStats(me.id);
  const myMonth = store.monthStats(me.id, todayISO());

  const partnerTasks = partner ? store.memberTasks(partner.id) : [];

  return `
  <div class="page">
    <div class="page-head">
      <div>
        <div class="page-title">我的</div>
        <div class="page-sub">${esc(me.nickname)}${partner ? ` & ${esc(partner.nickname)}` : ''} · 一起学习第 ${myDone.size} 天</div>
      </div>
    </div>

    <div class="card">
      <div class="row">
        <div class="person-avatar avatar" style="width:48px;height:48px;font-size:26px;border-radius:16px;background:var(--primary-soft);display:grid;place-items:center">${esc(me.emoji || '🐣')}</div>
        <div class="grow">
          <div class="bold">${esc(me.nickname)}</div>
          <div class="tiny muted">加入于 ${esc((me.created_at || '').slice(0, 10))}</div>
        </div>
        <button class="chip" data-action="edit-profile">编辑</button>
      </div>
      <div class="stats mt16">
        <div class="stat"><div class="v" style="color:var(--warn)">${myMonth.streak}</div><div class="k">当前连续</div></div>
        <div class="stat"><div class="v">${myDone.size}</div><div class="k">累计打卡</div></div>
        <div class="stat"><div class="v">${myWeek.rate}%</div><div class="k">本周完成率</div></div>
      </div>
      <div class="tiny muted center mt8">本周学习 ${myWeek.minutes} 分钟 · 本月打卡 ${myMonth.hitDays} 天</div>
    </div>

    <div class="card mt12">
      <div class="card-head">
        <div class="card-title"><span class="emoji">📝</span>我的每日任务 <span class="tiny muted">(${myTasks.length})</span></div>
        <button class="chip" data-action="add-task">+ 添加</button>
      </div>
      ${myTasks.length ? myTasks.map(taskRow).join('') : `
        <div class="empty" style="padding:16px 0">
          <span class="ic">🎯</span>
          <div>还没有设置任务</div>
          <div class="tiny mt4">添加「背单词」「听力」等每天要完成的目标</div>
        </div>`}
      ${partnerTasks.length ? `<div class="tiny muted mt12">${esc(partner.nickname)} 的任务:${esc(partnerTasks.map((t) => `${t.emoji || ''}${t.title}`).join('、'))}</div>` : ''}
    </div>

    <div class="card mt12">
      <div class="card-head"><div class="card-title"><span class="emoji">🏠</span>我的房间</div></div>
      <div class="invite-link">邀请码 <b style="letter-spacing:3px;font-size:16px">${esc(room?.code || '')}</b><br/>
        <span class="tiny">${partner ? `房间成员:我 + ${esc(partner.nickname)}` : '还在等一位语伴加入'}</span>
      </div>
      <div class="row mt12" style="gap:8px">
        <button class="btn btn-soft btn-sm grow" data-action="copy-code">复制邀请码</button>
        <button class="btn btn-primary btn-sm grow" data-action="invite">分享邀请链接</button>
      </div>
      <div class="row mt8" style="gap:8px">
        <button class="btn btn-ghost btn-sm grow" data-action="switch-room">换个房间</button>
        <button class="btn btn-danger btn-sm grow" data-action="leave-room">退出房间</button>
      </div>
    </div>

    <div class="card mt12">
      <div class="card-head"><div class="card-title"><span class="emoji">⚙️</span>设置</div></div>
      <div class="line">
        <div class="ic">${mode === 'local' ? '🧪' : mode === 'server' ? '🖥️' : '☁️'}</div>
        <div class="main">
          <div class="t1">${mode === 'local' ? '本地演示模式' : mode === 'server' ? '本机服务器共享' : 'Supabase 云端同步'}</div>
          <div class="t2">${
            mode === 'local'
              ? '数据仅存本机,换设备会丢失'
              : mode === 'server'
                ? '数据在你自己电脑的 data/rooms.json(通过隧道分享)'
                : esc(cfg.supabaseUrl || '')
          }</div>
        </div>
        <button class="chip sm" data-action="open-setup">${mode === 'supabase' ? '修改' : '改用 Supabase'}</button>
      </div>
      <div class="line">
        <div class="ic">🔄</div>
        <div class="main">
          <div class="t1">刷新数据</div>
          <div class="t2">${state.lastSync ? `上次同步 ${new Date(state.lastSync).toLocaleTimeString('zh-CN')}` : '尚未同步'}${
            mode !== 'local' ? ` · 实时连接:${state.realtime === 'connected' ? '已连接' : state.realtime === 'error' ? '异常' : '待连接'}` : ''
          }</div>
        </div>
        <button class="chip sm" data-action="refresh">刷新</button>
      </div>
      ${mode === 'local' ? `
      <div class="line">
        <div class="ic">🧹</div>
        <div class="main">
          <div class="t1">重置演示数据</div>
          <div class="t2">清空本机演示房间与记录</div>
        </div>
        <button class="chip sm" data-action="reset-demo" style="color:var(--danger)">重置</button>
      </div>` : ''}
    </div>

    <div class="center tiny muted mt16" style="line-height:1.9">
      语伴打卡 v1.0 · 双人语言学习监督<br/>
      ${mode === 'local' ? '当前为演示模式,配置 Supabase 后即可两台手机同步' : '两台手机用同一邀请码即可互相监督'}
    </div>
  </div>`;
}

export async function handleMeAction({ action, el, ctx }) {
  const { store, state } = ctx;
  switch (action) {
    case 'add-task':
      openTaskSheet(ctx, null);
      return true;
    case 'edit-task': {
      const task = store.memberTasks(state.me.id).find((t) => t.id === el.dataset.id);
      if (task) openTaskSheet(ctx, task);
      return true;
    }
    case 'delete-task': {
      const task = store.memberTasks(state.me.id).find((t) => t.id === el.dataset.id);
      if (!task) return true;
      if (confirm(`删除任务「${task.title}」?历史打卡记录会保留。`)) {
        try {
          await store.removeTask(task.id);
          toast('任务已删除', 'ok');
        } catch (err) { toast(err.message || '删除失败', 'err'); }
      }
      return true;
    }
    case 'edit-profile':
      openProfileSheet(ctx);
      return true;
    case 'copy-code':
      await copyCode(state.room?.code || '');
      return true;
    case 'invite':
      await inviteActions(state.room?.code || '');
      return true;
    case 'switch-room':
      openRoomSwitchSheet(ctx);
      return true;
    case 'leave-room':
      if (confirm('确定退出房间?你将回到欢迎页(打卡记录仍保留在云端)。')) {
        try {
          await store.leaveRoom();
          toast('已退出房间', 'ok');
        } catch (err) { toast(err.message || '退出失败', 'err'); }
      }
      return true;
    case 'open-setup':
      openSetupSheet();
      return true;
    case 'refresh':
      try {
        await store.refresh();
        toast('已刷新 ✅', 'ok');
      } catch (err) { toast(err.message || '刷新失败', 'err'); }
      return true;
    case 'reset-demo':
      if (confirm('重置本机演示数据?这会清空演示房间与记录。')) {
        try {
          await state.adapter.resetDemo?.();
          location.reload();
        } catch (err) { toast(err.message || '重置失败', 'err'); }
      }
      return true;
    default:
      return false;
  }
}

export { openTaskSheet };
