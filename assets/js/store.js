/**
 * store.js — 应用状态与业务动作
 *
 * 单一状态树 + 订阅通知;所有视图只读 state、只通过 store 的动作改数据。
 */

import {
  todayISO, addDays, toISO, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  calcStreak, completionRate, dateRange, clamp,
} from './util.js';

export function createStore() {
  const listeners = new Set();

  const state = {
    phase: 'boot',            // boot | onboarding | ready | error
    mode: 'local',            // local | supabase
    config: null,
    error: '',
    adapter: null,

    room: null,
    me: null,
    partner: null,

    tasks: [],
    logsByDate: {},           // 'YYYY-MM-DD' -> { memberId: log }
    reactions: [],

    today: todayISO(),
    tab: 'today',             // today | records | me
    recordsMonth: startOfMonth(todayISO()),
    selectedDate: todayISO(),

    draft: { doneTaskIds: new Set(), durationMin: 0, note: '', initialized: false, dirty: false },
    saving: false,
    busy: false,
    realtime: 'idle',         // idle | connected | error
    lastSync: 0,
    toast: null,
  };

  /* ---------------- 订阅 ---------------- */

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function emit() {
    for (const fn of listeners) {
      try { fn(state); } catch (err) { console.error('[store] listener error', err); }
    }
  }

  function set(patch) {
    Object.assign(state, patch);
    emit();
  }

  /* ---------------- 派生数据 ---------------- */

  const memberTasks = (memberId) => state.tasks.filter((t) => t.member_id === memberId && t.is_active !== false);

  const logFor = (date, memberId) => state.logsByDate?.[date]?.[memberId] || null;

  function doneTaskIdsOf(log) {
    if (!log || !Array.isArray(log.log_tasks)) return new Set();
    return new Set(log.log_tasks.filter((lt) => lt.is_done).map((lt) => lt.task_id));
  }

  /** 已打卡的日期集合(至少完成 1 项) */
  function doneDatesOf(memberId) {
    const out = new Set();
    for (const [date, byMember] of Object.entries(state.logsByDate || {})) {
      const log = byMember[memberId];
      if (log && (log.done_tasks > 0 || (log.log_tasks || []).some((lt) => lt.is_done))) out.add(date);
    }
    return out;
  }

  function statusOf(memberId, date = state.today) {
    const log = logFor(date, memberId);
    const tasks = memberTasks(memberId);
    const done = log ? doneTaskIdsOf(log).size : 0;
    const total = log?.total_tasks ?? tasks.length;
    return {
      checked: !!log && (log.done_tasks > 0 || done > 0),
      hasLog: !!log,
      log,
      completion: log ? log.completion ?? (total ? Math.round((done / total) * 100) : 0) : 0,
      durationMin: log?.duration_min ?? 0,
      note: log?.note ?? '',
      doneCount: log ? (log.done_tasks ?? done) : 0,
      totalTasks: total,
      streak: calcStreak(doneDatesOf(memberId)),
    };
  }

  function weekStats(memberId) {
    const from = startOfWeek(state.today);
    const to = endOfWeek(state.today);
    const dates = dateRange(from, to);
    const done = doneDatesOf(memberId);
    const hitDays = dates.filter((d) => done.has(d) && d <= state.today).length;
    const elapsed = dates.filter((d) => d <= state.today).length || 1;
    const logs = dates.map((d) => logFor(d, memberId)).filter(Boolean);
    const minutes = logs.reduce((sum, l) => sum + (l.duration_min || 0), 0);
    const avgCompletion = logs.length ? Math.round(logs.reduce((s, l) => s + (l.completion || 0), 0) / logs.length) : 0;
    return { from, to, hitDays, elapsed, rate: Math.round((hitDays / elapsed) * 100), minutes, avgCompletion };
  }

  function monthStats(memberId, monthAnchor) {
    const from = startOfMonth(monthAnchor);
    const to = endOfMonth(monthAnchor);
    const done = doneDatesOf(memberId);
    const dates = dateRange(from, to).filter((d) => d <= state.today);
    const hitDays = dates.filter((d) => done.has(d)).length;
    const logs = dates.map((d) => logFor(d, memberId)).filter(Boolean);
    return {
      hitDays,
      elapsed: dates.length,
      rate: dates.length ? Math.round((hitDays / dates.length) * 100) : 0,
      minutes: logs.reduce((sum, l) => sum + (l.duration_min || 0), 0),
      streak: calcStreak(done),
      total: done.size,
    };
  }

  function reactionsFor(date = state.today) {
    return (state.reactions || []).filter((r) => r.log_date === date);
  }

  function reactionSummary(date = state.today) {
    const list = reactionsFor(date);
    const byMe = (kind) => list.filter((r) => r.from_member === state.me?.id && r.kind === kind).length;
    const toMe = (kind) => list.filter((r) => r.to_member === state.me?.id && r.kind === kind).length;
    return {
      list,
      likedByMe: byMe('like'),
      nudgedByMe: byMe('nudge'),
      likesToMe: toMe('like'),
      nudgesToMe: toMe('nudge'),
    };
  }

  /* ---------------- 打卡草稿 ---------------- */

  function syncDraftFromLog() {
    const log = logFor(state.today, state.me?.id);
    const doneIds = doneTaskIdsOf(log);
    state.draft = {
      doneTaskIds: doneIds,
      durationMin: log?.duration_min ?? 0,
      note: log?.note ?? '',
      initialized: true,
      dirty: false,
    };
  }

  /* ---------------- 数据加载 ---------------- */

  function rangeForLoad() {
    const monthStart = startOfMonth(state.recordsMonth || state.today);
    const monthEnd = endOfMonth(state.recordsMonth || state.today);
    const from = monthStart < addDays(state.today, -89) ? monthStart : addDays(state.today, -89);
    const to = monthEnd > state.today ? monthEnd : state.today;
    return { from, to: to < state.today ? state.today : to };
  }

  async function refresh({ silent = false } = {}) {
    if (!state.adapter) return;
    if (!silent) set({ busy: true });
    try {
      // 跨午夜时自动切换到新的一天
      const nowDay = todayISO();
      if (nowDay !== state.today) {
        state.today = nowDay;
        state.selectedDate = nowDay;
        state.draft.initialized = false;
      }
      const { from, to } = rangeForLoad();
      const snapshot = await state.adapter.loadSnapshot({ from, to, reactionsDate: state.today });
      const session = await state.adapter.getSession();
      state.logsByDate = snapshot.logsByDate;
      state.tasks = snapshot.tasks;
      state.reactions = snapshot.reactions;
      if (session) {
        state.room = session.room;
        state.me = session.me;
        state.partner = session.partner;
      }
      state.lastSync = Date.now();
      if (!state.draft.initialized) syncDraftFromLog();
      set({ phase: 'ready', error: '', busy: false });
    } catch (err) {
      set({ busy: false, error: err.message || String(err) });
      throw err;
    }
  }

  /* ---------------- 启动 ---------------- */

  async function bootstrap({ adapter, mode, config }) {
    set({ adapter, mode, config });
    try {
      await adapter.init?.();
      const session = await adapter.getSession();
      if (!session) {
        set({ phase: 'onboarding' });
        return;
      }
      state.room = session.room;
      state.me = session.me;
      state.partner = session.partner;
      state.today = todayISO();
      await refresh({ silent: true });
      // 标记活跃时间(不阻塞界面)
      adapter.updateProfile?.({}).catch(() => {});
      attachRealtime();
    } catch (err) {
      set({ phase: 'onboarding', error: err.message || String(err) });
    }
  }

  let detachRealtime = null;

  function attachRealtime() {
    if (!state.adapter?.subscribe) return;
    // 重新进入房间时先解绑旧订阅,避免重复刷新
    if (detachRealtime) {
      try { detachRealtime(); } catch { /* ignore */ }
      detachRealtime = null;
    }
    detachRealtime = state.adapter.subscribe(() => {
      const run = async () => {
        try {
          await refresh({ silent: true });
          set({ realtime: 'connected' });
        } catch { set({ realtime: 'error' }); }
      };
      clearTimeout(attachRealtime._t);
      attachRealtime._t = setTimeout(run, 220);
    }) || null;
    set({ realtime: 'connected' });
  }

  /* ---------------- 房间动作 ---------------- */

  async function createRoom({ nickname, emoji }) {
    set({ busy: true });
    try {
      await state.adapter.createRoom({ nickname, emoji });
      await bootstrap({ adapter: state.adapter, mode: state.mode, config: state.config });
      return true;
    } finally {
      set({ busy: false });
    }
  }

  async function joinRoom({ code, nickname, emoji }) {
    set({ busy: true });
    try {
      await state.adapter.joinRoom({ code: String(code).toUpperCase().trim(), nickname, emoji });
      await bootstrap({ adapter: state.adapter, mode: state.mode, config: state.config });
      return true;
    } finally {
      set({ busy: false });
    }
  }

  async function leaveRoom() {
    await state.adapter.leaveRoom();
    state.room = null;
    state.me = null;
    state.partner = null;
    state.logsByDate = {};
    state.tasks = [];
    state.reactions = [];
    state.draft = { doneTaskIds: new Set(), durationMin: 0, note: '', initialized: false, dirty: false };
    set({ phase: 'onboarding' });
  }

  async function updateProfile({ nickname, emoji }) {
    await state.adapter.updateProfile({ nickname, emoji });
    await refresh({ silent: true });
  }

  /* ---------------- 任务动作 ---------------- */

  async function addTask({ title, emoji, targetValue, targetUnit }) {
    const tasks = memberTasks(state.me.id);
    await state.adapter.saveTask({
      memberId: state.me.id,
      title,
      emoji,
      targetValue,
      targetUnit,
      sortOrder: tasks.length,
      isActive: true,
    });
    await refresh({ silent: true });
  }

  async function updateTask(task) {
    await state.adapter.saveTask(task);
    await refresh({ silent: true });
  }

  async function removeTask(taskId) {
    await state.adapter.deleteTask(taskId);
    state.draft.doneTaskIds.delete(taskId);
    await refresh({ silent: true });
  }

  /* ---------------- 打卡动作 ---------------- */

  function toggleTask(taskId) {
    const set1 = state.draft.doneTaskIds;
    if (set1.has(taskId)) set1.delete(taskId);
    else set1.add(taskId);
    state.draft.dirty = true;
    emit();
  }

  function setDuration(minutes) {
    state.draft.durationMin = clamp(Math.round(Number(minutes) || 0), 0, 1440);
    state.draft.dirty = true;
    emit();
  }

  function bumpDuration(delta) {
    setDuration((state.draft.durationMin || 0) + delta);
  }

  function setNote(note) {
    state.draft.note = String(note).slice(0, 500);
    state.draft.dirty = true;
  }

  async function submitLog() {
    const tasks = memberTasks(state.me.id);
    const entries = tasks.map((t) => ({
      taskId: t.id,
      isDone: state.draft.doneTaskIds.has(t.id),
      amount: 0,
    }));
    set({ saving: true });
    try {
      await state.adapter.saveLog({
        date: state.today,
        memberId: state.me.id,
        entries,
        durationMin: state.draft.durationMin,
        note: state.draft.note,
      });
      state.draft.dirty = false;
      state.draft.initialized = true;
      await refresh({ silent: true });
      return true;
    } finally {
      set({ saving: false });
    }
  }

  /** 补记/修改任意一天(记录页使用,不经过今日草稿) */
  async function saveLogFor({ date, doneTaskIds, durationMin, note }) {
    const tasks = memberTasks(state.me.id);
    const done = doneTaskIds instanceof Set ? doneTaskIds : new Set(doneTaskIds || []);
    const entries = tasks.map((t) => ({ taskId: t.id, isDone: done.has(t.id), amount: 0 }));
    await state.adapter.saveLog({
      date,
      memberId: state.me.id,
      entries,
      durationMin,
      note: note || '',
    });
    await refresh({ silent: true });
  }

  /** 删除某天的打卡记录 */
  async function deleteLogFor({ date }) {
    await state.adapter.deleteLog({ date, memberId: state.me.id });
    await refresh({ silent: true });
  }

  /* ---------------- 互动动作 ---------------- */

  async function sendReaction({ kind, message }) {
    if (!state.me || !state.partner) throw new Error('房间还没有另一位成员');
    await state.adapter.sendReaction({
      fromMemberId: state.me.id,
      toMemberId: state.partner.id,
      kind,
      message: message || '',
      date: state.today,
    });
    await refresh({ silent: true });
  }

  /* ---------------- UI 动作 ---------------- */

  function setTab(tab) {
    if (state.tab === tab) return;
    set({ tab });
    if (tab === 'records') refresh({ silent: true }).catch(() => {});
  }

  function setRecordsMonth(monthAnchor) {
    set({ recordsMonth: startOfMonth(monthAnchor) });
    refresh({ silent: true }).catch(() => {});
  }

  function selectDate(date) {
    set({ selectedDate: date });
  }

  return {
    state,
    subscribe,
    emit,
    set,
    bootstrap,
    refresh,
    attachRealtime,
    createRoom,
    joinRoom,
    leaveRoom,
    updateProfile,
    addTask,
    updateTask,
    removeTask,
    toggleTask,
    setDuration,
    bumpDuration,
    setNote,
    submitLog,
    saveLogFor,
    deleteLogFor,
    sendReaction,
    setTab,
    setRecordsMonth,
    selectDate,
    syncDraftFromLog,
    // 派生
    memberTasks,
    logFor,
    doneTaskIdsOf,
    doneDatesOf,
    statusOf,
    weekStats,
    monthStats,
    reactionsFor,
    reactionSummary,
  };
}
