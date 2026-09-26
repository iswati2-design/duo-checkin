/**
 * adapters/supabase.js — Supabase 数据适配器
 *
 * 设计要点:
 *  - 用 Supabase 匿名登录(Anonymous Sign-In)拿到稳定 user id,无需邮箱密码;
 *    刷新/换会话后 auth 会话由 supabase-js 持久化在 localStorage,身份不变。
 *  - 建房 / 加入房间走 SECURITY DEFINER 的 RPC(create_room / join_room),
 *    既解决了「凭邀请码读房间」的鸡生蛋问题,也在服务端强制「每房间最多 2 人」。
 *  - 读取走 RLS 策略(只允许读到自己在的房间),写入限定为本人行。
 *  - Realtime 订阅本房间的 daily_logs / log_tasks / tasks / reactions / members 变化。
 */

const SESSION_KEY = 'duo.session.v1';
const LIB_SOURCES = [
  'https://esm.sh/@supabase/supabase-js@2.45.4',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm',
  'https://unpkg.com/@supabase/supabase-js@2.45.4/dist/module/index.js',
];

let cachedLib = null;

async function loadLib() {
  if (cachedLib) return cachedLib;
  const errors = [];
  for (const src of LIB_SOURCES) {
    try {
      cachedLib = await import(/* webpackIgnore: true */ src);
      return cachedLib;
    } catch (err) {
      errors.push(`${src}: ${err.message}`);
    }
  }
  throw new Error('无法加载 Supabase 客户端库(网络被拦截?)\n' + errors.join('\n'));
}

/** 把 Supabase 原始报错翻译成用户能看懂的中文 */
export function friendlyError(err) {
  const raw = (err && (err.message || err.error_description || err.hint)) || String(err);
  const code = err?.code || '';
  const map = [
    [/anonymous.*(disabled|not enabled|prohibited)/i, 'Supabase 未开启匿名登录。请在 Supabase 控制台 → Authentication → Sign In / Providers 打开 "Anonymous sign-ins"。'],
    [/ROOM_NOT_FOUND/i, '邀请码不存在,请确认后重试。'],
    [/ROOM_FULL/i, '这个房间已经满员了(每间最多两人)。'],
    [/NICKNAME_REQUIRED/i, '请先填写昵称。'],
    [/NOT_AUTHENTICATED/i, '身份未就绪,请检查网络后重试。'],
    [/Failed to fetch|NetworkError|fetch failed/i, '网络连接失败,请检查手机网络后重试。'],
    [/Invalid API key|No API key/i, 'Supabase 配置有误(URL 或 anon key 不正确)。'],
    [/relation .* does not exist|schema cache/i, '数据库还没初始化:请先在 Supabase SQL Editor 执行 supabase/schema.sql。'],
    [/row-level security/i, '权限被拒绝:请确认 schema.sql 里的 RLS 策略已执行。'],
  ];
  for (const [re, msg] of map) {
    if (re.test(raw) || re.test(code)) return msg;
  }
  return raw || '未知错误';
}

export function readStoredSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.roomId && parsed?.code ? parsed : null;
  } catch {
    return null;
  }
}

export function writeStoredSession(session) {
  if (!session) localStorage.removeItem(SESSION_KEY);
  else localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export async function createSupabaseAdapter(config) {
  const lib = await loadLib();
  const { createClient } = lib;
  if (typeof createClient !== 'function') throw new Error('Supabase 客户端库加载异常');

  const client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    realtime: { params: { eventsPerSecond: 5 } },
  });

  let userId = null;
  let channel = null;
  let unsubscribeAll = null;

  async function ensureAuth() {
    const { data: existing } = await client.auth.getSession();
    if (existing?.session?.user?.id) {
      userId = existing.session.user.id;
      return userId;
    }
    const { data, error } = await client.auth.signInAnonymously();
    if (error) throw new Error(friendlyError(error));
    userId = data?.user?.id ?? null;
    if (!userId) throw new Error('匿名登录失败:未拿到用户身份');
    return userId;
  }

  function requireSession() {
    const s = readStoredSession();
    if (!s) throw new Error('尚未加入任何房间');
    return s;
  }

  /* ---------------- 房间 ---------------- */

  async function createRoom({ nickname, emoji }) {
    await ensureAuth();
    const { data, error } = await client.rpc('create_room', { p_nickname: nickname, p_emoji: emoji });
    if (error) throw new Error(friendlyError(error));
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.room_id) throw new Error('建房失败:服务端未返回房间信息');
    writeStoredSession({ roomId: row.room_id, code: row.code });
    return { roomId: row.room_id, code: row.code, memberId: row.member_id };
  }

  async function joinRoom({ code, nickname, emoji }) {
    await ensureAuth();
    const { data, error } = await client.rpc('join_room', { p_code: code, p_nickname: nickname, p_emoji: emoji });
    if (error) throw new Error(friendlyError(error));
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.room_id) throw new Error('加入失败:服务端未返回房间信息');
    writeStoredSession({ roomId: row.room_id, code: row.code });
    return { roomId: row.room_id, code: row.code, memberId: row.member_id };
  }

  /** 读取当前会话对应的房间与成员;房间不存在 / 已退出则清理本地会话 */
  async function getSession() {
    await ensureAuth();
    const stored = readStoredSession();
    if (!stored) return null;

    const { data: room, error: roomErr } = await client
      .from('rooms').select('id, code, name, created_at').eq('id', stored.roomId).maybeSingle();
    if (roomErr) throw new Error(friendlyError(roomErr));
    if (!room) {
      writeStoredSession(null);
      return null;
    }

    const { data: members, error: memErr } = await client
      .from('members').select('*').eq('room_id', stored.roomId).order('created_at', { ascending: true });
    if (memErr) throw new Error(friendlyError(memErr));

    const me = (members || []).find((m) => m.user_id === userId) || null;
    if (!me) {
      writeStoredSession(null);
      return null;
    }
    const partner = (members || []).find((m) => m.id !== me.id) || null;
    return { room, me, partner, memberCount: (members || []).length };
  }

  async function leaveRoom() {
    const stored = readStoredSession();
    if (!stored) return;
    const { data: members } = await client.from('members').select('id, user_id').eq('room_id', stored.roomId);
    const mine = (members || []).find((m) => m.user_id === userId);
    if (mine) await client.from('members').delete().eq('id', mine.id);
    writeStoredSession(null);
    if (channel) { try { await client.removeChannel(channel); } catch { /* ignore */ } channel = null; }
  }

  /** 更新昵称 / 头像 emoji / 最后活跃时间 */
  async function updateProfile({ nickname, emoji }) {
    const stored = requireSession();
    const patch = { last_seen_at: new Date().toISOString() };
    if (nickname) patch.nickname = nickname.trim().slice(0, 20);
    if (emoji) patch.emoji = emoji;
    const { error } = await client.from('members').update(patch).eq('room_id', stored.roomId).eq('user_id', userId);
    if (error) throw new Error(friendlyError(error));
  }

  /* ---------------- 任务 ---------------- */

  async function saveTask(task) {
    const stored = requireSession();
    const payload = {
      room_id: stored.roomId,
      member_id: task.memberId,
      title: task.title.trim().slice(0, 30),
      emoji: task.emoji || '📌',
      target_value: Number(task.targetValue) || 1,
      target_unit: (task.targetUnit || '次').slice(0, 8),
      sort_order: Number(task.sortOrder) || 0,
      is_active: task.isActive !== false,
    };
    if (task.id) {
      const { error } = await client.from('tasks').update(payload).eq('id', task.id);
      if (error) throw new Error(friendlyError(error));
      return task.id;
    }
    const { data, error } = await client.from('tasks').insert(payload).select('id').single();
    if (error) throw new Error(friendlyError(error));
    return data.id;
  }

  async function deleteTask(taskId) {
    const { error } = await client.from('tasks').delete().eq('id', taskId);
    if (error) throw new Error(friendlyError(error));
  }

  /* ---------------- 打卡 ---------------- */

  /**
   * 保存某天打卡(存在则更新)
   * @param {object} p
   * @param {string} p.date        YYYY-MM-DD
   * @param {string} p.memberId
   * @param {Array<{taskId:string,isDone:boolean,amount:number}>} p.entries
   * @param {number} p.durationMin
   * @param {string} p.note
   */
  async function saveLog({ date, memberId, entries, durationMin, note }) {
    const stored = requireSession();
    const totalTasks = entries.length;
    const doneTasks = entries.filter((e) => e.isDone).length;
    const completion = totalTasks === 0 ? 0 : Math.round((doneTasks / totalTasks) * 100);

    const { data: logRow, error } = await client
      .from('daily_logs')
      .upsert(
        {
          room_id: stored.roomId,
          member_id: memberId,
          log_date: date,
          duration_min: Math.max(0, Math.round(Number(durationMin) || 0)),
          note: String(note || '').slice(0, 500),
          total_tasks: totalTasks,
          done_tasks: doneTasks,
          completion,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'member_id,log_date' },
      )
      .select('*')
      .single();
    if (error) throw new Error(friendlyError(error));

    const logId = logRow.id;
    if (entries.length > 0) {
      const rows = entries.map((e) => ({
        log_id: logId,
        room_id: stored.roomId,
        task_id: e.taskId,
        is_done: !!e.isDone,
        amount: Number(e.amount) || 0,
      }));
      const { error: ltErr } = await client.from('log_tasks').upsert(rows, { onConflict: 'log_id,task_id' });
      if (ltErr) throw new Error(friendlyError(ltErr));
      // 清理已删除任务的旧记录
      const ids = entries.map((e) => e.taskId);
      const { error: delErr } = await client.from('log_tasks').delete().eq('log_id', logId).not('task_id', 'in', `(${ids.join(',')})`);
      if (delErr) { /* 非致命 */ }
    } else {
      await client.from('log_tasks').delete().eq('log_id', logId);
    }
    return logRow;
  }

  async function deleteLog({ date, memberId }) {
    const { error } = await client.from('daily_logs').delete().eq('member_id', memberId).eq('log_date', date);
    if (error) throw new Error(friendlyError(error));
  }

  /* ---------------- 互动 ---------------- */

  async function sendReaction({ fromMemberId, toMemberId, kind, message, date }) {
    const stored = requireSession();
    const { error } = await client.from('reactions').insert({
      room_id: stored.roomId,
      from_member: fromMemberId,
      to_member: toMemberId,
      kind,
      message: String(message || '').slice(0, 200),
      log_date: date,
    });
    if (error) throw new Error(friendlyError(error));
  }

  /* ---------------- 快照 ---------------- */

  /**
   * 拉取一次页面所需的全部数据
   * @param {{ from: string, to: string, reactionsDate: string }} range
   */
  async function loadSnapshot({ from, to, reactionsDate }) {
    const stored = requireSession();
    const roomId = stored.roomId;

    const [membersRes, tasksRes, logsRes, reactionsRes] = await Promise.all([
      client.from('members').select('*').eq('room_id', roomId).order('created_at', { ascending: true }),
      client.from('tasks').select('*').eq('room_id', roomId).eq('is_active', true).order('sort_order', { ascending: true }),
      client.from('daily_logs').select('*, log_tasks(*)').eq('room_id', roomId).gte('log_date', from).lte('log_date', to),
      client.from('reactions').select('*').eq('room_id', roomId).eq('log_date', reactionsDate).order('created_at', { ascending: false }),
    ]);

    for (const [label, res] of [['members', membersRes], ['tasks', tasksRes], ['logs', logsRes], ['reactions', reactionsRes]]) {
      if (res.error) throw new Error(`${label}: ${friendlyError(res.error)}`);
    }

    const members = membersRes.data || [];
    const logsByDate = {};
    for (const log of logsRes.data || []) {
      logsByDate[log.log_date] = logsByDate[log.log_date] || {};
      logsByDate[log.log_date][log.member_id] = log;
    }

    return {
      room: { id: roomId, code: stored.code },
      members,
      tasks: tasksRes.data || [],
      logsByDate,
      reactions: reactionsRes.data || [],
      userId,
    };
  }

  /* ---------------- Realtime ---------------- */

  function subscribe(onChange) {
    const stored = readStoredSession();
    if (!stored) return () => {};
    if (channel) { try { client.removeChannel(channel); } catch { /* ignore */ } }

    const tables = ['daily_logs', 'log_tasks', 'tasks', 'reactions', 'members'];
    let ch = client.channel(`room-${stored.roomId}`);
    for (const table of tables) {
      ch = ch.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `room_id=eq.${stored.roomId}` },
        (payload) => onChange({ table, payload }),
      );
    }
    ch.subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') onChange({ table: '__status', payload: { status } });
    });
    channel = ch;
    unsubscribeAll = () => { try { client.removeChannel(ch); } catch { /* ignore */ } };
    return unsubscribeAll;
  }

  function unsubscribe() {
    if (unsubscribeAll) unsubscribeAll();
    unsubscribeAll = null;
    channel = null;
  }

  return {
    kind: 'supabase',
    client,
    init: ensureAuth,
    getSession,
    createRoom,
    joinRoom,
    leaveRoom,
    updateProfile,
    saveTask,
    deleteTask,
    saveLog,
    deleteLog,
    sendReaction,
    loadSnapshot,
    subscribe,
    unsubscribe,
    getUserId: () => userId,
  };
}
