/**
 * adapters/roomserver.js — 本机房间服务器适配器
 *
 * 当页面由 scripts/server.mjs 提供服务时启用(双击「启动在线链接.bat」的场景):
 * 房间数据存在你自己电脑的 data/rooms.json,通过 Cloudflare 隧道分享给两台手机,
 * 因此不需要 Supabase 账号也能真实双人同步。
 *
 * 接口与 supabase.js 完全一致,所以 UI / store 无需区分数据来源。
 */

const SESSION_KEY = 'duo.server.session.v1';

function readSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.code && parsed?.memberId && parsed?.token ? parsed : null;
  } catch {
    return null;
  }
}

function writeSession(session) {
  if (!session) localStorage.removeItem(SESSION_KEY);
  else localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

/** 探测当前站点是否由本机房间服务器承载 */
export async function probeRoomServer(timeoutMs = 2500) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch('./api/health', { signal: controller.signal, headers: { Accept: 'application/json' } });
    clearTimeout(timer);
    if (!res.ok) return false;
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) return false;
    const data = await res.json();
    return data?.service === 'duo-checkin-room-server';
  } catch {
    return false;
  }
}

export async function createRoomServerAdapter() {
  let session = readSession();

  async function call(path, { method = 'GET', body, query } = {}, retried = false) {
    const url = new URL(path, location.href);
    for (const [k, v] of Object.entries(query || {})) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
    const res = await fetch(url.toString(), {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    let data = null;
    try { data = await res.json(); } catch { /* ignore */ }
    if (!res.ok) {
      // 令牌失效(例如在另一台设备/清了缓存的同一人重新加入过)→ 自动用昵称恢复身份后重试一次
      if (!retried && data?.error === 'BAD_TOKEN' && session?.nickname) {
        try {
          const fresh = await call('./api/room/join', {
            method: 'POST',
            body: { code: session.code, nickname: session.nickname, emoji: session.emoji },
          });
          session = { ...session, memberId: fresh.memberId, token: fresh.token };
          writeSession(session);
          return await call(path, { method, body, query }, true);
        } catch { /* 恢复失败则按原错误抛出 */ }
      }
      throw new Error(data?.message || `请求失败(${res.status})`);
    }
    return data;
  }

  const requireSession = () => {
    if (!session) throw new Error('尚未加入任何房间');
    return session;
  };

  const authBody = (extra = {}) => {
    const s = requireSession();
    return { code: s.code, memberId: s.memberId, token: s.token, ...extra };
  };

  return {
    kind: 'server',
    async init() { return session?.memberId || null; },

    async getSession() {
      if (!session) return null;
      try {
        const data = await call('./api/session', { query: { code: session.code, memberId: session.memberId } });
        return { room: data.room, me: data.me, partner: data.partner, memberCount: data.memberCount };
      } catch (err) {
        // 房间被删 / 成员被移除 → 清理本地会话
        if (/不存在|不在这个房间/.test(err.message)) {
          writeSession(null);
          session = null;
          return null;
        }
        throw err;
      }
    },

    async createRoom({ nickname, emoji }) {
      const data = await call('./api/room/create', { method: 'POST', body: { nickname, emoji } });
      session = { code: data.code, memberId: data.memberId, token: data.token, nickname, emoji };
      writeSession(session);
      return data;
    },

    async joinRoom({ code, nickname, emoji }) {
      const data = await call('./api/room/join', { method: 'POST', body: { code, nickname, emoji } });
      session = { code: data.code, memberId: data.memberId, token: data.token, nickname, emoji };
      writeSession(session);
      return data;
    },

    async leaveRoom() {
      if (session) {
        try { await call('./api/leave', { method: 'POST', body: authBody() }); } catch { /* ignore */ }
      }
      writeSession(null);
      session = null;
    },

    async updateProfile({ nickname, emoji }) {
      await call('./api/profile', { method: 'POST', body: authBody({ nickname, emoji }) });
    },

    async saveTask(task) {
      await call('./api/task', {
        method: 'POST',
        body: authBody({
          task: {
            id: task.id,
            title: task.title,
            emoji: task.emoji,
            targetValue: task.targetValue,
            targetUnit: task.targetUnit,
            sortOrder: task.sortOrder,
            isActive: task.isActive !== false,
          },
        }),
      });
      return task.id;
    },

    async deleteTask(taskId) {
      await call('./api/task/delete', { method: 'POST', body: authBody({ taskId }) });
    },

    async saveLog({ date, entries, durationMin, note }) {
      const data = await call('./api/log', { method: 'POST', body: authBody({ date, entries, durationMin, note }) });
      return data.log;
    },

    async deleteLog({ date }) {
      await call('./api/log/delete', { method: 'POST', body: authBody({ date }) });
    },

    async sendReaction({ toMemberId, kind, message, date }) {
      await call('./api/reaction', { method: 'POST', body: authBody({ toMemberId, kind, message, date }) });
    },

    async loadSnapshot({ from, to, reactionsDate }) {
      const s = requireSession();
      const data = await call('./api/snapshot', { query: { code: s.code, from, to, reactionsDate } });
      return { ...data, userId: s.memberId };
    },

    /**
     * 实时同步:长轮询(对代理/微信内置浏览器最友好)。
     * 服务器把请求挂起到房间有变更为止,返回新版本号 → 客户端再拉一次快照。
     * (SSE 在本机/局域网可用,但会被 Cloudflare 之类代理缓冲,所以默认走长轮询。)
     */
    subscribe(onChange) {
      const s = readSession();
      if (!s) return () => {};
      let stopped = false;
      let since = 0;
      const pause = (ms) => new Promise((r) => setTimeout(r, ms));

      (async () => {
        try {
          const first = await call('./api/poll', { query: { code: s.code, since: 0, timeout: 500 } });
          since = first.rev || 0;
        } catch { /* 下面循环会重试 */ }

        while (!stopped) {
          try {
            const r = await call('./api/poll', { query: { code: s.code, since, timeout: 20000 } });
            if (stopped) break;
            const rev = r.rev || 0;
            if (rev > since) {
              since = rev;
              onChange({ table: 'poll', payload: {} });
            }
          } catch {
            if (stopped) break;
            await pause(2500);
          }
        }
      })();

      return () => { stopped = true; };
    },

    unsubscribe() { /* 长轮询循环由 subscribe 返回的清理函数停止 */ },

    getUserId: () => session?.memberId || null,
  };
}
