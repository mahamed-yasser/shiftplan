'use strict';
const { h, api, toast, money, badge, formModal, confirmBox, table, kpi, toolbar, btn, download, mountApp } = UI;
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const mondayOf = (d) => addDays(d, -((new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7));
const pretty = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const hrs = (x) => (Math.round(x * 10) / 10).toString();
let weekStart = null;

async function save(method, url, body) {
  try { return await api(method, url, body); }
  catch (e) {
    if (e.status === 409 && await confirmBox('Warning', e.message + '. Save anyway?', 'Save anyway')) return api(method, url, { ...body, confirm: true });
    throw e;
  }
}
async function roster(el) {
  if (!weekStart) weekStart = mondayOf(new Date().toISOString().slice(0, 10));
  const draw = async () => {
    const w = await api('GET', '/api/week?start=' + weekStart); const { employees } = w;
    const today = new Date().toISOString().slice(0, 10);
    const shiftForm = (s) => formModal({ title: s.id ? 'Edit shift' : 'Add shift', fields: [
      { name: 'employee_id', label: 'Person', type: 'select', options: employees.map((e) => [e.id, e.name]) }, { name: 'date', label: 'Date', type: 'date', required: true },
      { name: 'start', label: 'Start', type: 'time', required: true }, { name: 'end', label: 'End (earlier than start = overnight)', type: 'time', required: true },
      { name: 'break_min', label: 'Unpaid break (min)', type: 'number', min: 0 }, { name: 'label', label: 'Label' }], values: s, submit: 'Save shift',
      onSubmit: (v) => save(s.id ? 'PATCH' : 'POST', s.id ? '/api/shifts/' + s.id : '/api/shifts', { ...v, employee_id: Number(v.employee_id) }) });
    const cell = (e, d) => h('td', { 'data-label': DOW[w.days.indexOf(d)] + ' ' + pretty(d), class: d === today ? 'today' : '' },
      e.leave.includes(d) ? h('div', { class: 'leave' }, 'On leave') : null,
      e.shifts.filter((s) => s.date === d).map((s) => h('button', { class: 'chip' + (s.label ? ' lbl' : ''), title: 'Edit shift', onclick: async () => { const r = await shiftForm({ ...s }); if (r) draw(); } },
        s.start + ' to ' + s.end, h('small', {}, hrs(s.hours) + ' h' + (s.label ? ' · ' + s.label : '')))),
      !w.published && !e.leave.includes(d) ? h('button', { class: 'add', 'aria-label': 'Add shift for ' + e.name, onclick: async () => { const r = await shiftForm({ employee_id: e.id, date: d, start: '09:00', end: '17:00', break_min: 30 }); if (r) draw(); } }, '+') : null);
    el.replaceChildren(
      toolbar(btn('◀', () => { weekStart = addDays(weekStart, -7); draw(); }), h('b', {}, pretty(w.days[0]) + ' to ' + pretty(w.days[6])), btn('▶', () => { weekStart = addDays(weekStart, 7); draw(); }), btn('This week', () => { weekStart = mondayOf(today); draw(); }),
        w.published ? badge('Published', 'ok') : badge('Draft', 'warn'), h('span', { class: 'grow' }),
        btn('Copy previous week here', async () => { try { const r = await api('POST', '/api/week/copy', { from: addDays(weekStart, -7), to: weekStart }); toast(`Copied ${r.copied} shifts` + (r.skipped.length ? `, skipped ${r.skipped.length}: ${r.skipped[0]}` : '')); draw(); } catch (e) { toast(e.message, 'bad'); } }),
        btn('Export CSV', async () => download('rota-' + weekStart + '.csv', await (await fetch('/api/week.csv?start=' + weekStart)).text())),
        w.published ? btn('Unpublish', async () => { await api('POST', '/api/week/unpublish', { start: weekStart }); draw(); }) : btn('Publish week', async () => { try { await api('POST', '/api/week/publish', { start: weekStart }); toast('Week published and locked'); draw(); } catch (e) { toast(e.message, 'bad'); } }, 'primary')),
      h('div', { class: 'grid g4', style: 'margin-bottom:14px' }, kpi('Scheduled hours', hrs(w.total_hours)), kpi('Labour cost', money(w.total_cost_cents), 'overtime at 1.5x after 40 h'), kpi('Overtime hours', hrs(w.overtime_hours), '', w.overtime_hours ? 'warn' : 'ok'),
        kpi('Busiest day', DOW[w.by_day.reduce((m, d, i) => d.hours > w.by_day[m].hours ? i : m, 0)], hrs(Math.max(...w.by_day.map((d) => d.hours))) + ' staff hours')),
      h('div', { class: 'table-wrap' }, h('table', { class: 'grid-week' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Team'), w.days.map((d, i) => h('th', {}, DOW[i] + ' ' + pretty(d), h('div', { class: 'muted small' }, hrs(w.by_day[i].hours) + ' h · ' + w.by_day[i].people + ' people'))))),
        h('tbody', {}, employees.map((e) => h('tr', {}, h('td', { 'data-label': 'Person' }, h('b', {}, e.name), h('div', { class: 'muted small' }, e.role), h('div', { class: 'small' + (e.over_max ? ' over' : '') }, hrs(e.hours) + ' / ' + e.max_week_hours + ' h · ' + money(e.cost_cents))), w.days.map((d) => cell(e, d)))))))
    );
  };
  await draw();
}
async function team(el) {
  const draw = async () => {
    const { employees } = await api('GET', '/api/employees');
    el.replaceChildren(toolbar(h('span', { class: 'grow' }),
      btn('Add leave', async () => { if (await formModal({ title: 'Add day of leave', fields: [{ name: 'employee_id', label: 'Person', type: 'select', options: employees.filter((e) => e.active).map((e) => [e.id, e.name]) }, { name: 'date', label: 'Date', type: 'date', required: true }, { name: 'note', label: 'Note' }], onSubmit: (v) => api('POST', '/api/leave', { ...v, employee_id: Number(v.employee_id) }) })) toast('Leave added'); }),
      btn('Add person', async () => { if (await formModal({ title: 'Add person', fields: [{ name: 'name', label: 'Name', required: true }, { name: 'role', label: 'Role', required: true }, { name: 'rate', label: 'Hourly rate', type: 'number', step: '0.01', required: true }, { name: 'max', label: 'Max hours per week', type: 'number' }], values: { max: 40 }, onSubmit: (v) => api('POST', '/api/employees', { name: v.name, role: v.role, hourly_cents: Math.round(v.rate * 100), max_week_hours: v.max }) })) draw(); }, 'primary')),
      table([{ label: 'Name', key: 'name' }, { label: 'Role', key: 'role' }, { label: 'Rate', class: 'r', render: (e) => money(e.hourly_cents) + '/h' }, { label: 'Max hours', class: 'r', key: 'max_week_hours' }, { label: 'Status', render: (e) => badge(e.active ? 'Active' : 'Inactive', e.active ? 'ok' : '') },
        { label: '', render: (e) => btn(e.active ? 'Deactivate' : 'Activate', async () => { await api('PATCH', '/api/employees/' + e.id, { active: !e.active }); draw(); }, 'sm') }], employees));
  };
  await draw();
}
mountApp({ title: 'ShiftPlan', tagline: 'Weekly staff rota with conflict checks and labour cost', accent: '#0284c7', views: [{ id: 'rota', label: 'Weekly rota', render: roster }, { id: 'team', label: 'Team', render: team }] });
