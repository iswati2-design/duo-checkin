/**
 * main.js — 应用入口:启动、渲染、导航、事件委托
 */

import { createAdapter } from './adapters/index.js';
import { createStore } from './store.js';
import { toast, todayISO } from './util.js';
import { initOnboarding, renderOnboarding, readOnboardingForm, setOnboardingTab, pickOnboardingEmoji, openSetupSheet } from './views/onboarding.js';
import { renderToday, handleTodayAction } from './views/today.js';
import { renderRecords, handleRecordsAction } from './views/records.js';
import { renderMe, handleMeAction } from './views/me.js';

const root = document.getElementById('app');

const store = createStore();
const ctx = { store, state: store.state, get mode() { return store.state.mode; } };

let renderedPhase = null;

/* ---------------- 渲染 ---------------- */

function navHtml(state) {
  const items = [
    { key: 'today', icon: '☀️', label: '今日' },
    { key: 'records', icon: '📅', label: '记录' },
    { key: 'me', icon: '🙂', label: '我的' },
  ];
  return `
    <nav class="nav">
      <div class="nav-inner">
        ${items.map((it) => `
          <button data-nav="${it.key}" class="${state.tab === it.key ? 'on' : ''}">
            <span class="ic">${it.icon}</span>
            <span>${it.label}</span>
          </button>`).join('')}
      </div>
    </nav>`;
}

let lastError = '';

function render() {
  const state = store.state;

  if (state.phase === 'boot') {
    root.innerHTML = `
      <div class="boot">
        <div class="boot-logo">📚</div>
        <div class="boot-text">正在打开你的学习房间…</div>
      </div>`;
    return;
  }

  if (state.phase === 'onboarding') {
    const wasOnboarding = renderedPhase === 'onboarding';
    if (!wasOnboarding) initOnboarding({});
    root.innerHTML = renderOnboarding({ mode: state.mode, config: state.config, error: state.error });
    renderedPhase = 'onboarding';
    return;
  }

  if (state.phase === 'ready') {
    let view = '';
    if (state.tab === 'records') view = renderRecords(ctx);
    else if (state.tab === 'me') view = renderMe(ctx);
    else view = renderToday(ctx);
    root.innerHTML = view + navHtml(state);
    renderedPhase = 'ready';

    if (state.error && state.error !== lastError) {
      lastError = state.error;
      toast(state.error, 'err', 4000);
    }
    return;
  }
}

const scheduleRender = (() => {
  let queued = false;
  return () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      render();
    });
  };
})();

/* ---------------- 事件 ---------------- */

document.addEventListener('click', async (e) => {
  const navBtn = e.target.closest('[data-nav]');
  if (navBtn) {
    store.setTab(navBtn.dataset.nav);
    window.scrollTo({ top: 0 });
    return;
  }

  // 引导页:Tab 切换与头像选择(用委托,避免重渲染后监听器失效)
  if (store.state.phase === 'onboarding') {
    const tabBtn = e.target.closest('[data-tab]');
    if (tabBtn) {
      readOnboardingForm(root);            // 先保住已输入内容
      setOnboardingTab(tabBtn.dataset.tab);
      render();
      return;
    }
    const emojiBtn = e.target.closest('#ob-emoji [data-emoji]');
    if (emojiBtn) {
      readOnboardingForm(root);
      pickOnboardingEmoji(emojiBtn.dataset.emoji);
      render();
      return;
    }
  }

  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;

  // 通用动作先行
  if (action === 'open-setup') {
    e.preventDefault();
    openSetupSheet();
    return;
  }

  if (store.state.phase === 'onboarding') {
    if (action === 'create-room') {
      const { nickname, emoji } = readOnboardingForm(root);
      try {
        await store.createRoom({ nickname, emoji });
        toast('房间创建成功 🎉 把邀请码发给 TA 吧', 'ok');
      } catch (err) {
        toast(err.message || '创建失败', 'err', 4000);
        render();
      }
      return;
    }
    if (action === 'join-room') {
      const { nickname, emoji, code } = readOnboardingForm(root);
      if (!code || code.length !== 6) {
        toast('请输入 6 位邀请码', 'warn');
        return;
      }
      try {
        await store.joinRoom({ code, nickname, emoji });
        toast('加入成功,一起加油 💪', 'ok');
      } catch (err) {
        toast(err.message || '加入失败', 'err', 4000);
      }
      return;
    }
    return;
  }

  // 视图动作
  const payload = { action, el, ctx };
  try {
    if (await handleTodayAction(payload)) return;
    if (await handleRecordsAction(payload)) return;
    if (await handleMeAction(payload)) return;
  } catch (err) {
    console.error(err);
    toast(err.message || '操作失败', 'err');
  }
});

// 备注输入:不触发整页重渲染,避免光标跳动
document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.matches?.('[data-action="note"]')) store.setNote(el.value);
});

window.addEventListener('scroll', () => { /* 预留:吸顶效果 */ }, { passive: true });

/* ---------------- 后台同步 ---------------- */

// 轮询兜底:SSE/WebSocket 被代理拦截时靠它同步。
// 本机服务器模式(通常是公网隧道)收紧到 8 秒,保证对方打卡后你能很快看到。
(function schedulePoll(attempt = 0) {
  const delay = store.state.mode === 'server' ? 8000 : 25000;
  setTimeout(async () => {
    if (store.state.phase === 'ready' && document.visibilityState === 'visible') {
      try { await store.refresh({ silent: true }); } catch { /* 网络抖动忽略 */ }
    }
    schedulePoll(attempt + 1);
  }, delay);
})();

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && store.state.phase === 'ready') {
    store.refresh({ silent: true }).catch(() => {});
  }
});

window.addEventListener('online', () => toast('网络已恢复', 'ok'));
window.addEventListener('offline', () => toast('网络已断开,恢复后会自动同步', 'warn', 3500));

/* ---------------- 启动 ---------------- */

store.subscribe(scheduleRender);

(async () => {
  try {
    const prefs = {
      nickname: localStorage.getItem('duo.nickname') || '',
      emoji: localStorage.getItem('duo.emoji') || '🐣',
    };
    const { adapter, mode, config } = await createAdapter(prefs);
    await store.bootstrap({ adapter, mode, config });
    render();
  } catch (err) {
    console.error(err);
    root.innerHTML = `
      <div class="page">
        <div class="hero">
          <div class="logo">😵</div>
          <h1>启动失败</h1>
          <p>${String(err.message || err)}</p>
        </div>
        <div class="card mt16">
          <div class="small muted">可能是网络问题或 Supabase 配置有误。</div>
          <button class="btn btn-primary btn-block mt12" data-action="open-setup">检查 Supabase 配置</button>
        </div>
      </div>`;
  }
})();

// 暴露给调试
window.__duo = { store, render, todayISO };
