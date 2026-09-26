/**
 * views/onboarding.js — 引导页:创建房间 / 加入房间 / 配置 Supabase
 */

import { esc, toast } from '../util.js';
import { getConfig, saveOverride, clearOverride } from '../config.js';
import { openSheet } from '../components.js';

const EMOJIS = ['🐣', '🦊', '🐼', '🐨', '🐯', '🦁', '🐸', '🐙', '🦄', '🐧', '🌻', '🍀', '📚', '🚀'];

/** 头像选择器(纯 HTML,交互由 main.js 的事件委托处理) */
function emojiPickerHtml() {
  return `<div class="emoji-pick" id="ob-emoji">
    ${EMOJIS.map((e) => `<button data-emoji="${e}" class="${e === localState.emoji ? 'on' : ''}">${e}</button>`).join('')}
  </div>`;
}

let localState = {
  tab: 'create',
  nickname: '',
  emoji: '🐣',
  code: '',
};

/** 从 URL 读取 ?join=ABC123 */
export function codeFromUrl() {
  const params = new URLSearchParams(location.search);
  const code = params.get('join') || params.get('code') || location.hash.replace(/^#join=/, '');
  return (code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

export function initOnboarding(prefill = {}) {
  const stored = localStorage.getItem('duo.nickname') || '';
  localState.nickname = prefill.nickname || stored || '';
  localState.emoji = prefill.emoji || localStorage.getItem('duo.emoji') || '🐣';
  const urlCode = codeFromUrl();
  if (urlCode.length === 6) {
    localState.code = urlCode;
    localState.tab = 'join';
  }
}

export function renderOnboarding({ mode, config, error }) {
  const isLocal = mode === 'local';
  const cfg = config || getConfig();

  const setupNotice = isLocal
    ? `<div class="notice">
         <span>🧪</span>
         <span><b>本地演示模式</b>:数据只存在这台设备,内置一位模拟语伴供你体验界面。
         <a href="#" data-action="open-setup">配置 Supabase</a> 后即可两台手机真实同步。</span>
       </div>`
    : mode === 'server'
      ? `<div class="notice info"><span>☁️</span><span><b>本机服务器共享已开启</b>:两台手机用同一邀请码即可看到对方打卡,数据保存在你自己的电脑上。</span></div>`
      : `<div class="notice info"><span>☁️</span><span><b>云端同步已开启</b>:两台手机用同一房间码即可看到对方打卡。</span></div>`;

  const errBox = error ? `<div class="notice" style="background:var(--danger-soft);color:var(--danger)"><span>⚠️</span><span>${esc(error)}</span></div>` : '';

  const tabCreate = `
    <div class="field">
      <label>你的昵称</label>
      <input class="input" id="ob-nickname" maxlength="12" placeholder="例如:小马 / Luna" value="${esc(localState.nickname)}" />
    </div>
    <div class="field mt12">
      <label>选个头像</label>
      ${emojiPickerHtml()}
    </div>
    <button class="btn btn-primary btn-block mt16" data-action="create-room">创建学习房间 🏠</button>
    <div class="tiny muted center mt8">创建后会生成 6 位邀请码,发给你的语伴即可</div>`;

  const tabJoin = `
    <div class="field">
      <label>6 位邀请码</label>
      <input class="input code" id="ob-code" maxlength="6" placeholder="ABC123" value="${esc(localState.code)}" />
    </div>
    <div class="field mt12">
      <label>你的昵称</label>
      <input class="input" id="ob-nickname" maxlength="12" placeholder="例如:小马 / Luna" value="${esc(localState.nickname)}" />
    </div>
    <div class="field mt12">
      <label>选个头像</label>
      ${emojiPickerHtml()}
    </div>
    <button class="btn btn-primary btn-block mt16" data-action="join-room">加入语伴的房间 🚪</button>`;

  return `
  <div class="page">
    <div class="hero">
      <div class="logo">📚</div>
      <h1>语伴打卡</h1>
      <p>两个人,每天一起完成语言学习任务<br/>谁也别想偷懒 😉</p>
      <div class="feats">
        <div class="feat"><span class="ic">✅</span><span class="tx"><b>每日任务打卡</b> 背单词、听力、口语、阅读、写作,勾选即完成</span></div>
        <div class="feat"><span class="ic">👀</span><span class="tx"><b>互相看得见</b> 今日进度、学习时长、连续天数一目了然</span></div>
        <div class="feat"><span class="ic">🔔</span><span class="tx"><b>点赞 + 催打卡</b> 一键提醒,还能生成复制给 TA 的提醒文案</span></div>
        <div class="feat"><span class="ic">📅</span><span class="tx"><b>记录可回看</b> 日历看双方每天完成情况与本周完成率</span></div>
      </div>
    </div>

    <div class="mt16">${setupNotice}</div>
    ${errBox ? `<div class="mt12">${errBox}</div>` : ''}

    <div class="card mt16">
      <div class="seg" id="ob-tabs">
        <button data-tab="create" class="${localState.tab === 'create' ? 'on' : ''}">创建房间</button>
        <button data-tab="join" class="${localState.tab === 'join' ? 'on' : ''}">加入房间</button>
      </div>
      <div class="mt16" id="ob-body">${localState.tab === 'create' ? tabCreate : tabJoin}</div>
    </div>

    <div class="center tiny muted mt16" style="line-height:1.8">
      数据模式:${isLocal ? '本地演示(单机)' : 'Supabase 云端同步'}<br/>
      <a href="#" data-action="open-setup">${isLocal ? '接入云端同步 →' : '修改 Supabase 配置 →'}</a>
    </div>
  </div>`;
}

/** 切换「创建房间 / 加入房间」;调用方负责先 readOnboardingForm 保住已输入内容 */
export function setOnboardingTab(tab) {
  if (tab !== 'create' && tab !== 'join') return;
  localState.tab = tab;
}

/** 选择头像 */
export function pickOnboardingEmoji(emoji) {
  if (!emoji) return;
  localState.emoji = emoji;
  localStorage.setItem('duo.emoji', emoji);
}

export function readOnboardingForm(root) {
  const nicknameEl = root.querySelector('#ob-nickname');
  const codeEl = root.querySelector('#ob-code');
  const nickname = (nicknameEl?.value || '').trim() || localState.nickname || '同学';
  const code = (codeEl?.value || '').trim().toUpperCase() || localState.code;
  localState.nickname = nickname;
  localState.code = code;
  localStorage.setItem('duo.nickname', nickname);
  localStorage.setItem('duo.emoji', localState.emoji);
  return { nickname, emoji: localState.emoji, code };
}

/** Supabase 配置弹层 */
export function openSetupSheet() {
  const cfg = getConfig();
  openSheet({
    title: '配置云端同步',
    subtitle: '两个手机共享数据需要自己的 Supabase 项目(免费),约 3 分钟。',
    body: `
      <div class="notice"><span>📋</span><span>在 Supabase 控制台 → Project Settings → API 复制 <b>Project URL</b> 与 <b>anon public key</b>;再到 SQL Editor 执行 <code>supabase/schema.sql</code>。</span></div>
      <div class="field mt12">
        <label>Project URL</label>
        <input class="input" id="su-url" placeholder="https://xxxx.supabase.co" value="${esc(cfg.supabaseUrl || '')}" />
      </div>
      <div class="field mt12">
        <label>anon public key</label>
        <textarea class="textarea" id="su-key" placeholder="eyJhbGciOi...">${esc(cfg.supabaseAnonKey || '')}</textarea>
      </div>
      <button class="btn btn-primary btn-block mt16" data-action="save-setup">保存并启用云端同步</button>
      <button class="btn btn-ghost btn-block mt8" data-action="clear-setup">清除配置(回到本地模式)</button>`,
    onMount: (sheet, close) => {
      sheet.addEventListener('click', async (e) => {
        const action = e.target.closest('[data-action]')?.dataset.action;
        if (action === 'save-setup') {
          const url = sheet.querySelector('#su-url').value.trim();
          const key = sheet.querySelector('#su-key').value.trim();
          if (!/^https?:\/\//.test(url) || key.length < 20) {
            toast('请填写正确的 URL 与 anon key', 'warn');
            return;
          }
          saveOverride(url, key);
          close();
          toast('已保存,正在重载…', 'ok');
          setTimeout(() => location.reload(), 500);
        }
        if (action === 'clear-setup') {
          clearOverride();
          localStorage.removeItem('duo.session.v1');
          close();
          toast('已回到本地演示模式', 'ok');
          setTimeout(() => location.reload(), 500);
        }
      });
    },
  });
}
