/**
 * adapters/local.js — 本地演示适配器
 *
 * 未配置 Supabase 时启用:数据存在浏览器 localStorage,内置一个「模拟语伴」,
 * 让单个用户也能完整体验双人监督的全部界面(对方状态、点赞、催打卡、记录页)。
 *
 * 明确提示:此模式数据只在本机,换设备/清缓存会丢失 —— 用于体验,不用于真实监督。
 */

import { todayISO, addDays, randomId, toISO } from '../util.js';

const DB_KEY = 'duo.local.v1';
const MY_USER_ID = 'local-me';
const PARTNER_USER_ID = 'local-partner';

function read() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return null;
}

function write(db) {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
}

function seed(db) {
  const today = todayISO();
  const roomId = randomId('room');
  const me = {
    id: randomId('mem'), room_id: roomId, user_id: MY_USER_ID,
    nickname: db.nickname || '我', emoji: db.emoji || '🐣',
    created_at: new Date().toISOString(), last_seen_at: new Date().toISOString(),
  };
  const partner = {
    id: randomId('mem'), room_id: roomId, user_id: PARTNER_USER_ID,
    nickname: '小语伴', emoji: '🦊',
    created_at: new Date().toISOString(), last_seen_at: new Date().toISOString(),
  };
  const taskSeed = [
    { title: '背单词', emoji: '📚', target_value: 50, target_unit: '个' },
    { title: '听力', emoji: '🎧', target_value: 20, target_unit: '分钟' },
    { title: '口语跟读', emoji: '🗣️', target_value: 10, target_unit: '分钟' },
    { title: '阅读', emoji: '📖', target_value: 1, target_unit: '篇' },
    { title: '写作', emoji: '✍️', target_value: 1, target_unit: '篇' },
  ];
  const tasks = [];
  taskSeed.forEach((t, i) => {
    tasks.push({
      id: randomId('task'), room_id: roomId, member_id: me.id, title: t.title, emoji: t.emoji,
      target_value: t.target_value, target_unit: t.target_unit, sort_order: i, is_active: true,
      created_at: new Date().toISOString(),
    });
    tasks.push({
      id: randomId('task'), room_id: roomId, member_id: partner.id, title: t.title, emoji: t.emoji,
      target_value: t.target_value, target_unit: t.target_unit, sort_order: i, is_active: true,
      created_at: new Date().toISOString(),
    });
  });

  // 给语伴造 14 天历史(约 8 成打卡),让记录页/统计有内容
  const logs = [];
  const logTasks = [];
  for (let i = 14; i >= 1; i -= 1) {
    const date = addDays(today, -i);
    const chance = (i * 7) % 10;
    if (chance < 2) continue;
    const partnerTasks = tasks.filter((t) => t.member_id === partner.id);
    const doneCount = 3 + (i % 3);
    const picked = partnerTasks.slice(0, Math.min(doneCount, partnerTasks.length));
    const logId = randomId('log');
    logs.push({
      id: logId, room_id: roomId, member_id: partner.id, log_date: date,
      duration_min: 20 + ((i * 5) % 40), note: i % 3 === 0 ? '今天状态不错,坚持住了!' : '',
      total_tasks: partnerTasks.length, done_tasks: picked.length,
      completion: Math.round((picked.length / partnerTasks.length) * 100),
      created_at: new Date(date + 'T21:00:00').toISOString(),
      updated_at: new Date(date + 'T21:00:00').toISOString(),
    });
    for (const t of partnerTasks) {
      logTasks.push({ id: randomId('lt'), log_id: logId, task_id: t.id, is_done: picked.includes(t), amount: 0 });
    }
  }

  return {
    room: { id: roomId, code: 'LOCAL1', name: '本地演示房间', created_at: new Date().toISOString() },
    members: [me, partner],
    tasks,
    logs,
    log_tasks: logTasks,
    reactions: [],
  };
}

export async function createLocalAdapter(prefs = {}) {
  let db = read();
  // 兼容早期数据:已存在房间即视为已加入
  if (db && db.room && !('joined' in db)) db.joined = true;

  /** 首次创建/加入时才真正种下演示房间 */
  const ensureDb = (nickname, emoji) => {
    if (!db || !db.room) db = seed({ nickname, emoji });
    db.joined = true;
    if (db.members?.[0]) {
      if (nickname) db.members[0].nickname = String(nickname).slice(0, 20);
      if (emoji) db.members[0].emoji = emoji;
    }
    write(db);
    return db;
  };

  const listeners = new Set();
  let simTimer = null;

  const notify = (table = '__local') => {
    for (const fn of listeners) {
      try { fn({ table, payload: {} }); } catch { /* ignore */ }
    }
  };

  const me = () => db?.members?.find((m) => m.user_id === MY_USER_ID) || null;
  const partner = () => db?.members?.find((m) => m.user_id === PARTNER_USER_ID) || null;

  /** 模拟语伴在你打卡后的一点点互动,让双人监督的体验可见 */
  function schedulePartnerSim() {
    clearTimeout(simTimer);
    simTimer = setTimeout(() => {
      const myLog = db.logs.find((l) => l.member_id === me()?.id && l.log_date === todayISO());
      const p = partner();
      if (!p) return;
      if (myLog && !db.reactions.some((r) => r.from_member === p.id && r.log_date === todayISO() && r.kind === 'like')) {
        db.reactions.unshift({
          id: randomId('rx'), room_id: db.room.id, from_member: p.id, to_member: me().id,
          kind: 'like', message: '今天也完成啦,给你点个赞 👍', log_date: todayISO(),
          created_at: new Date().toISOString(),
        });
        write(db);
        notify('reactions');
      }
      // 语伴 6 秒后完成今日打卡
      const partnerLog = db.logs.find((l) => l.member_id === p.id && l.log_date === todayISO());
      if (!partnerLog) {
        const partnerTasks = db.tasks.filter((t) => t.member_id === p.id && t.is_active);
        const done = partnerTasks.slice(0, Math.max(1, partnerTasks.length - 1));
        const logId = randomId('log');
        db.logs.push({
          id: logId, room_id: db.room.id, member_id: p.id, log_date: todayISO(),
          duration_min: 35, note: '被催到了,马上补上!',
          total_tasks: partnerTasks.length, done_tasks: done.length,
          completion: Math.round((done.length / partnerTasks.length) * 100),
          created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        });
        for (const t of partnerTasks) {
          db.log_tasks.push({ id: randomId('lt'), log_id: logId, task_id: t.id, is_done: done.includes(t), amount: 0 });
        }
        write(db);
        notify('daily_logs');
      }
    }, 6000);
  }

  return {
    kind: 'local',
    async init() { return MY_USER_ID; },
    async getSession() {
      if (!db || !db.room || !db.joined) return null;
      const m = me();
      if (!m) return null;
      return { room: db.room, me: m, partner: partner(), memberCount: db.members.length };
    },
    async createRoom({ nickname, emoji }) {
      ensureDb(nickname || '我', emoji || '🐣');
      notify('__created');
      return { roomId: db.room.id, code: db.room.code, memberId: me().id };
    },
    async joinRoom({ nickname, emoji }) {
      ensureDb(nickname || '我', emoji || '🐣');
      notify('__joined');
      return { roomId: db.room.id, code: db.room.code, memberId: me().id };
    },
    async leaveRoom() {
      if (db) { db.joined = false; write(db); }
      notify('__left');
    },
    async updateProfile({ nickname, emoji }) {
      const m = me();
      if (nickname) m.nickname = nickname.trim().slice(0, 20);
      if (emoji) m.emoji = emoji;
      m.last_seen_at = new Date().toISOString();
      write(db);
    },
    async saveTask(task) {
      const p = me();
      if (task.id) {
        const row = db.tasks.find((t) => t.id === task.id);
        if (row) Object.assign(row, {
          title: task.title, emoji: task.emoji, target_value: Number(task.targetValue) || 1,
          target_unit: task.targetUnit || '次', sort_order: task.sortOrder ?? row.sort_order,
          is_active: task.isActive !== false,
        });
      } else {
        db.tasks.push({
          id: randomId('task'), room_id: db.room.id, member_id: p.id,
          title: task.title, emoji: task.emoji || '📌',
          target_value: Number(task.targetValue) || 1, target_unit: task.targetUnit || '次',
          sort_order: db.tasks.filter((t) => t.member_id === p.id).length, is_active: true,
          created_at: new Date().toISOString(),
        });
      }
      write(db);
      notify('tasks');
      return task.id;
    },
    async deleteTask(taskId) {
      const row = db.tasks.find((t) => t.id === taskId);
      if (row) row.is_active = false;
      write(db);
      notify('tasks');
    },
    async saveLog({ date, memberId, entries, durationMin, note }) {
      const total = entries.length;
      const done = entries.filter((e) => e.isDone).length;
      const completion = total === 0 ? 0 : Math.round((done / total) * 100);
      let log = db.logs.find((l) => l.member_id === memberId && l.log_date === date);
      if (!log) {
        log = {
          id: randomId('log'), room_id: db.room.id, member_id: memberId, log_date: date,
          created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        };
        db.logs.push(log);
      }
      Object.assign(log, {
        duration_min: Math.max(0, Math.round(Number(durationMin) || 0)),
        note: String(note || '').slice(0, 500),
        total_tasks: total, done_tasks: done, completion,
        updated_at: new Date().toISOString(),
      });
      db.log_tasks = db.log_tasks.filter((lt) => lt.log_id !== log.id);
      for (const e of entries) {
        db.log_tasks.push({ id: randomId('lt'), log_id: log.id, task_id: e.taskId, is_done: !!e.isDone, amount: Number(e.amount) || 0 });
      }
      write(db);
      notify('daily_logs');
      schedulePartnerSim();
      return log;
    },
    async deleteLog({ date, memberId }) {
      const log = db.logs.find((l) => l.member_id === memberId && l.log_date === date);
      if (log) {
        db.logs = db.logs.filter((l) => l.id !== log.id);
        db.log_tasks = db.log_tasks.filter((lt) => lt.log_id !== log.id);
        write(db);
        notify('daily_logs');
      }
    },
    async sendReaction({ fromMemberId, toMemberId, kind, message, date }) {
      db.reactions.unshift({
        id: randomId('rx'), room_id: db.room.id, from_member: fromMemberId, to_member: toMemberId,
        kind, message: String(message || '').slice(0, 200), log_date: date,
        created_at: new Date().toISOString(),
      });
      write(db);
      notify('reactions');
    },
    async loadSnapshot({ from, to, reactionsDate }) {
      const logsByDate = {};
      for (const log of db.logs.filter((l) => l.log_date >= from && l.log_date <= to)) {
        logsByDate[log.log_date] = logsByDate[log.log_date] || {};
        logsByDate[log.log_date][log.member_id] = {
          ...log,
          log_tasks: db.log_tasks.filter((lt) => lt.log_id === log.id),
        };
      }
      return {
        room: db.room,
        members: db.members,
        tasks: db.tasks.filter((t) => t.is_active),
        logsByDate,
        reactions: db.reactions.filter((r) => r.log_date === reactionsDate),
        userId: MY_USER_ID,
      };
    },
    subscribe(onChange) {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    unsubscribe() { listeners.clear(); clearTimeout(simTimer); },
    getUserId: () => MY_USER_ID,
    /** 供「我的」页展示的重置入口 */
    async resetDemo() {
      localStorage.removeItem(DB_KEY);
      db = null;                 // 下次创建/加入时重新种下演示房间
      notify('__reset');
    },
  };
}
