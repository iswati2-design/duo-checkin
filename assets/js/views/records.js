/**
 * views/records.js — 记录:日历回看 + 本周完成率 + 连续天数 + 补记
 */

import { esc, toast, dateRange, startOfWeek, endOfWeek, startOfMonth, endOfMonth, addDays, monthLabel, todayISO, relativeLabel, dateLabel } from '../util.js';
import { openSheet, dayDetailBlock, emptyState } from '../components.js';

function levelOf(percent, hasLog) {
  if (!hasLog) return 0;
  if (percent >= 100) return 3;
  if (percent >= 60) return 2;
  if (percent > 0) return 1;
  return 0;
}

function cell(dateIso, ctx, inMonth) {
  const { state, store } = ctx;
  const myLog = store.logFor(dateIso, state.me?.id);
  const partnerLog = state.partner ? store.logFor(dateIso, state.partner.id) : null;
  const myLv = levelOf(myLog?.completion ?? 0, !!myLog && (myLog.done_tasks || 0) > 0);
  const pLv = levelOf(partnerLog?.completion ?? 0, !!partnerLog && (partnerLog.done_tasks || 0) > 0);
  const cls = [
    'cell',
    inMonth ? '' : 'other',
    dateIso === state.today ? 'today' : '',
    dateIso === state.selectedDate ? 'sel' : '',
  ].join(' ');
  return `
    <div class="${cls}" data-action="select-day" data-date="${dateIso}">
      <div class="d">${Number(dateIso.slice(-2))}</div>
      <div class="dots">
        <i class="dot me lv${myLv}"></i>
        <i class="dot other lv${pLv}"></i>
      </div>
    </div>`;
}

export function renderRecords(ctx) {
  const { state, store } = ctx;
  const { me, partner } = state;
  const month = state.recordsMonth;
  const gridStart = startOfWeek(startOfMonth(month));
  const gridEnd = endOfWeek(endOfMonth(month));
  const days = dateRange(gridStart, gridEnd);
  const monthDays = startOfMonth(month).slice(0, 7);

  const myWeek = store.weekStats(me.id);
  const pWeek = partner ? store.weekStats(partner.id) : null;
  const myMonth = store.monthStats(me.id, month);
  const pMonth = partner ? store.monthStats(partner.id, month) : null;
  const myDone = store.doneDatesOf(me.id);
  const pDone = partner ? store.doneDatesOf(partner.id) : new Set();

  const myLog = store.logFor(state.selectedDate, me.id);
  const partnerLog = partner ? store.logFor(state.selectedDate, partner.id) : null;

  const recent = dateRange(addDays(state.today, -13), state.today).reverse().map((d) => {
    const ml = store.logFor(d, me.id);
    const pl = partner ? store.logFor(d, partner.id) : null;
    return `
      <div class="line" data-action="select-day" data-date="${d}">
        <div class="ic">${ml || pl ? '📗' : '·'}</div>
        <div class="main">
          <div class="t1">${esc(relativeLabel(d))} <span class="tiny muted">${esc(dateLabel(d))}</span></div>
          <div class="t2">
            我:${ml ? `${ml.completion}% · ${ml.duration_min}分` : '未打卡'} ·
            对方:${pl ? `${pl.completion}% · ${pl.duration_min}分` : '未打卡'}
          </div>
        </div>
        <div class="tiny muted nowrap">${myDone.has(d) ? '✅' : '—'}${partner ? (pDone.has(d) ? '✅' : '—') : ''}</div>
      </div>`;
  }).join('');

  return `
  <div class="page">
    <div class="page-head">
      <div>
        <div class="page-title">记录</div>
        <div class="page-sub">看看我们坚持了多少天 🌱</div>
      </div>
      <button class="chip" data-action="records-today">回到今天</button>
    </div>

    <div class="card">
      <div class="row-between">
        <button class="chip" data-action="records-prev">‹</button>
        <div class="bold">${esc(monthLabel(month))}</div>
        <button class="chip" data-action="records-next">›</button>
      </div>
      <div class="cal-head mt12"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div>
      <div class="cal">${days.map((d) => cell(d, ctx, d.slice(0, 7) === monthDays)).join('')}</div>
      <div class="legend mt12">
        <span><i style="background:var(--primary)"></i>我</span>
        <span><i style="background:var(--accent)"></i>对方</span>
        <span class="muted">圆点越深 = 完成度越高</span>
      </div>
    </div>

    <div class="mt12">
      ${dayDetailBlock({
        date: state.selectedDate,
        me,
        partner,
        myLog,
        partnerLog,
        myTasks: store.memberTasks(me.id),
        partnerTasks: partner ? store.memberTasks(partner.id) : [],
      })}
    </div>

    <div class="card mt12">
      <div class="card-head"><div class="card-title"><span class="emoji">📈</span>本周完成率</div></div>
      <div class="row-between small">
        <span class="bold">我</span>
        <span class="muted">${myWeek.hitDays}/${myWeek.elapsed} 天 · ${myWeek.rate}% · ${myWeek.minutes} 分钟</span>
      </div>
      <div class="bar-track mt8"><div class="bar-fill" style="width:${myWeek.rate}%"></div></div>
      ${partner ? `
      <div class="row-between small mt12">
        <span class="bold">${esc(partner.nickname)}</span>
        <span class="muted">${pWeek.hitDays}/${pWeek.elapsed} 天 · ${pWeek.rate}% · ${pWeek.minutes} 分钟</span>
      </div>
      <div class="bar-track mt8"><div class="bar-fill other" style="width:${pWeek.rate}%"></div></div>` : ''}
      <div class="stats mt16">
        <div class="stat"><div class="v" style="color:var(--warn)">${myMonth.streak}</div><div class="k">我的连续天数</div></div>
        <div class="stat"><div class="v">${myMonth.hitDays}</div><div class="k">本月打卡</div></div>
        <div class="stat"><div class="v">${myDone.size}</div><div class="k">累计打卡</div></div>
      </div>
      ${partner ? `
      <div class="tiny muted center mt8">
        ${esc(partner.nickname)} 本月打卡 ${pMonth.hitDays} 天,连续 ${pMonth.streak} 天,累计 ${pDone.size} 天
      </div>` : ''}
    </div>

    <div class="card mt12">
      <div class="card-head"><div class="card-title"><span class="emoji">🗓️</span>最近 14 天</div></div>
      ${recent || emptyState('📭', '还没有记录')}
    </div>
  </div>`;
}

/** 补记某天(独立弹层,不走今日草稿) */
function openBackfillSheet(date, ctx) {
  const { store, state } = ctx;
  const tasks = store.memberTasks(state.me.id);
  const log = store.logFor(date, state.me.id);
  const doneIds = store.doneTaskIdsOf(log);
  let duration = log?.duration_min ?? 0;
  const picked = new Set(doneIds);

  openSheet({
    title: `补记 ${relativeLabel(date)}`,
    subtitle: `${dateLabel(date)} · 勾选当天完成的任务`,
    body: `
      <div id="bf-tasks">
        ${tasks.length === 0 ? '<div class="empty">还没有任务</div>' : tasks.map((t) => `
          <div class="task ${picked.has(t.id) ? 'on' : ''}" data-bf-task="${t.id}">
            <div class="tick">${picked.has(t.id) ? '✓' : ''}</div>
            <div class="t-emoji">${esc(t.emoji || '📌')}</div>
            <div class="grow"><div class="t-title">${esc(t.title)}</div><div class="t-meta">目标 ${t.target_value}${esc(t.target_unit || '')}</div></div>
          </div>`).join('')}
      </div>
      <div class="field mt12">
        <label>学习时长(分钟)</label>
        <div class="row" style="gap:10px">
          <div class="stepper">
            <button data-bf-dur="-5">−</button>
            <div class="num" id="bf-dur">${duration}</div>
            <button data-bf-dur="5">+</button>
          </div>
          <span class="tiny muted">可长按 + 快速增加</span>
        </div>
      </div>
      <div class="field mt12">
        <label>备注</label>
        <textarea class="textarea" id="bf-note" placeholder="这天学了什么?">${esc(log?.note || '')}</textarea>
      </div>
      <button class="btn btn-primary btn-block mt16" data-action="bf-save">保存这天的打卡</button>
      ${log ? '<button class="btn btn-danger btn-block mt8" data-action="bf-delete">删除这天记录</button>' : ''}`,
    onMount: (sheet, close) => {
      const refreshCells = () => {
        sheet.querySelectorAll('[data-bf-task]').forEach((row) => {
          const on = picked.has(row.dataset.bfTask);
          row.classList.toggle('on', on);
          row.querySelector('.tick').textContent = on ? '✓' : '';
        });
      };
      sheet.addEventListener('click', async (e) => {
        const taskRow = e.target.closest('[data-bf-task]');
        if (taskRow) {
          const id = taskRow.dataset.bfTask;
          if (picked.has(id)) picked.delete(id); else picked.add(id);
          refreshCells();
          return;
        }
        const durBtn = e.target.closest('[data-bf-dur]');
        if (durBtn) {
          duration = Math.max(0, duration + Number(durBtn.dataset.bfDur));
          sheet.querySelector('#bf-dur').textContent = String(duration);
          return;
        }
        const action = e.target.closest('[data-action]')?.dataset.action;
        if (action === 'bf-save') {
          try {
            await store.saveLogFor({
              date,
              doneTaskIds: picked,
              durationMin: duration,
              note: sheet.querySelector('#bf-note').value,
            });
            toast('已保存这天的打卡 ✅', 'ok');
            close();
          } catch (err) { toast(err.message || '保存失败', 'err'); }
        }
        if (action === 'bf-delete') {
          try {
            await store.deleteLogFor({ date });
            toast('已删除这天记录', 'ok');
            close();
          } catch (err) { toast(err.message || '删除失败', 'err'); }
        }
      });
    },
  });
}

export async function handleRecordsAction({ action, el, ctx }) {
  const { store, state } = ctx;
  switch (action) {
    case 'records-prev': {
      const d = new Date(state.recordsMonth);
      d.setMonth(d.getMonth() - 1);
      store.setRecordsMonth(d.toISOString().slice(0, 10));
      return true;
    }
    case 'records-next': {
      const d = new Date(state.recordsMonth);
      d.setMonth(d.getMonth() + 1);
      store.setRecordsMonth(d.toISOString().slice(0, 10));
      return true;
    }
    case 'records-today':
      store.setRecordsMonth(todayISO());
      store.selectDate(todayISO());
      return true;
    case 'select-day':
      store.selectDate(el.dataset.date);
      return true;
    case 'record-on-date':
      openBackfillSheet(el.dataset.date, ctx);
      return true;
    default:
      return false;
  }
}
