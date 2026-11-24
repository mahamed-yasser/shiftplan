'use strict';
const path = require('node:path');
const { createApp, csv } = require('./core');
const R = require('./rota');
const SCHEMA = `
CREATE TABLE IF NOT EXISTS employees(id INTEGER PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, hourly_cents INTEGER NOT NULL CHECK(hourly_cents>0), max_week_hours INTEGER NOT NULL DEFAULT 40, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS leave(id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id), date TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', UNIQUE(employee_id,date));
CREATE TABLE IF NOT EXISTS shifts(id INTEGER PRIMARY KEY, employee_id INTEGER NOT NULL REFERENCES employees(id), date TEXT NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL, break_min INTEGER NOT NULL DEFAULT 0, label TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS weeks(week_start TEXT PRIMARY KEY, published_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_shift_date ON shifts(date);`;

function build({ dbFile, clock = () => new Date(), publicDir = path.join(__dirname, '..', 'public') } = {}) {
  return createApp({ dbFile, publicDir, schema: SCHEMA, appName: 'ShiftPlan', seed: (db) => require('./seed')(db, clock().toISOString().slice(0, 10)),
    routes(add, { db, tx, v, bad, HttpError }) {
      const emp = (id) => { const e = db.prepare('SELECT * FROM employees WHERE id=?').get(id); if (!e) throw bad('Unknown employee'); return e; };
      const weekRows = (monday) => db.prepare('SELECT * FROM shifts WHERE date>=? AND date<=?').all(monday, R.addDays(monday, 6));
      const hoursOf = (rows, id, excludeId) => rows.filter((s) => s.employee_id === id && s.id !== excludeId).reduce((t, s) => t + R.paidHours(s), 0);
      const locked = (date) => !!db.prepare('SELECT 1 FROM weeks WHERE week_start=?').get(R.mondayOf(date));
      const leaveOf = (id) => db.prepare('SELECT date FROM leave WHERE employee_id=?').all(id).map((x) => x.date);
      function validate(body, id) {
        const e = emp(v.int(body.employee_id, 'Employee', { min: 1 })); if (!e.active) throw bad('That person is inactive');
        const s = { id, employee_id: e.id, date: v.date(body.date, 'Date'), start: v.time(body.start, 'Start'), end: v.time(body.end, 'End'), break_min: v.int(body.break_min ?? 0, 'Break', { max: 240 }), label: v.str(body.label, 'Label', { required: false, max: 40 }) };
        if (locked(s.date)) throw bad('This week is published. Unpublish it to make changes.');
        const near = db.prepare('SELECT * FROM shifts WHERE employee_id=? AND date BETWEEN ? AND ?').all(e.id, R.addDays(s.date, -2), R.addDays(s.date, 2));
        const wk = weekRows(R.mondayOf(s.date));
        const res = R.check(s, near, e, { leave: leaveOf(e.id), weekHours: hoursOf(wk, e.id, id) });
        if (res.hard.length) throw bad(res.hard[0]);
        if (res.soft.length && !body.confirm) { const err = new HttpError(409, res.soft.join('. ')); err.warnings = res.soft; throw err; }
        return s;
      }
      add('GET', '/api/week', ({ query }) => {
        const monday = R.mondayOf(v.date(query.start, 'start')); const shifts = weekRows(monday).map((s) => ({ ...s, hours: R.paidHours(s) }));
        const days = [...Array(7)].map((_, i) => R.addDays(monday, i));
        const employees = db.prepare('SELECT * FROM employees WHERE active=1 ORDER BY role,name').all().map((e) => {
          const mine = shifts.filter((s) => s.employee_id === e.id); const hours = mine.reduce((t, s) => t + s.hours, 0);
          return { ...e, shifts: mine.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start)), leave: leaveOf(e.id).filter((d) => days.includes(d)), ...R.weekCost(hours, e.hourly_cents), over_max: hours > e.max_week_hours };
        });
        const pub = db.prepare('SELECT published_at FROM weeks WHERE week_start=?').get(monday);
        const byDay = days.map((d) => ({ date: d, hours: shifts.filter((s) => s.date === d).reduce((t, s) => t + s.hours, 0), people: new Set(shifts.filter((s) => s.date === d).map((s) => s.employee_id)).size }));
        return { start: monday, days, employees, published: !!pub, published_at: pub ? pub.published_at : null, by_day: byDay,
          total_hours: employees.reduce((t, e) => t + e.hours, 0), total_cost_cents: employees.reduce((t, e) => t + e.cost_cents, 0), overtime_hours: employees.reduce((t, e) => t + e.overtime_hours, 0) };
      });
      add('POST', '/api/shifts', ({ body }) => { const s = validate(body); return { id: Number(db.prepare('INSERT INTO shifts(employee_id,date,start,end,break_min,label) VALUES(?,?,?,?,?,?)').run(s.employee_id, s.date, s.start, s.end, s.break_min, s.label).lastInsertRowid) }; });
      add('PATCH', '/api/shifts/:id', ({ params, body }) => {
        const old = db.prepare('SELECT * FROM shifts WHERE id=?').get(Number(params.id)); if (!old) throw new HttpError(404, 'Shift not found');
        if (locked(old.date)) throw bad('This week is published. Unpublish it to make changes.');
        const s = validate({ ...old, ...body }, old.id); db.prepare('UPDATE shifts SET employee_id=?,date=?,start=?,end=?,break_min=?,label=? WHERE id=?').run(s.employee_id, s.date, s.start, s.end, s.break_min, s.label, old.id); return { ok: true };
      });
      add('DELETE', '/api/shifts/:id', ({ params }) => {
        const old = db.prepare('SELECT * FROM shifts WHERE id=?').get(Number(params.id)); if (!old) throw new HttpError(404, 'Shift not found');
        if (locked(old.date)) throw bad('This week is published. Unpublish it to make changes.'); db.prepare('DELETE FROM shifts WHERE id=?').run(old.id); return { ok: true };
      });
      add('POST', '/api/week/publish', ({ body }) => { const m = R.mondayOf(v.date(body.start, 'start')); if (!weekRows(m).length) throw bad('Nothing to publish: the week has no shifts'); db.prepare('INSERT OR REPLACE INTO weeks VALUES(?,?)').run(m, clock().toISOString()); return { ok: true }; });
      add('POST', '/api/week/unpublish', ({ body }) => { db.prepare('DELETE FROM weeks WHERE week_start=?').run(R.mondayOf(v.date(body.start, 'start'))); return { ok: true }; });
      add('POST', '/api/week/copy', ({ body }) => tx(() => {
        const from = R.mondayOf(v.date(body.from, 'from')), to = R.mondayOf(v.date(body.to, 'to')); if (from === to) throw bad('Pick a different week to copy into');
        if (locked(to)) throw bad('The target week is published'); let copied = 0; const skipped = [];
        for (const s of weekRows(from)) {
          const e = db.prepare('SELECT * FROM employees WHERE id=? AND active=1').get(s.employee_id); if (!e) continue;
          const n = { ...s, id: undefined, date: R.addDays(s.date, R.span({ date: to, start: '00:00', end: '01:00' })[0] / 1440 - R.span({ date: from, start: '00:00', end: '01:00' })[0] / 1440) };
          const near = db.prepare('SELECT * FROM shifts WHERE employee_id=? AND date BETWEEN ? AND ?').all(e.id, R.addDays(n.date, -2), R.addDays(n.date, 2));
          const res = R.check(n, near, e, { leave: leaveOf(e.id), weekHours: hoursOf(weekRows(to), e.id) });
          if (res.hard.length) { skipped.push(`${e.name} ${n.date}: ${res.hard[0]}`); continue; }
          db.prepare('INSERT INTO shifts(employee_id,date,start,end,break_min,label) VALUES(?,?,?,?,?,?)').run(e.id, n.date, n.start, n.end, n.break_min, n.label); copied++;
        }
        return { copied, skipped };
      }));
      add('GET', '/api/employees', () => ({ employees: db.prepare('SELECT * FROM employees ORDER BY active DESC,name').all() }));
      add('POST', '/api/employees', ({ body }) => ({ id: Number(db.prepare('INSERT INTO employees(name,role,hourly_cents,max_week_hours) VALUES(?,?,?,?)').run(v.str(body.name, 'Name'), v.str(body.role, 'Role', { max: 40 }), v.int(body.hourly_cents, 'Hourly rate', { min: 1 }), v.int(body.max_week_hours ?? 40, 'Max hours', { min: 1, max: 80 })).lastInsertRowid) }));
      add('PATCH', '/api/employees/:id', ({ params, body }) => { db.prepare('UPDATE employees SET active=? WHERE id=?').run(body.active ? 1 : 0, Number(params.id)); return { ok: true }; });
      add('POST', '/api/leave', ({ body }) => { const e = emp(v.int(body.employee_id, 'Employee', { min: 1 })); const d = v.date(body.date, 'Date');
        if (db.prepare('SELECT 1 FROM shifts WHERE employee_id=? AND date=?').get(e.id, d)) throw bad('Remove that day\'s shift first'); db.prepare('INSERT INTO leave(employee_id,date,note) VALUES(?,?,?)').run(e.id, d, v.str(body.note, 'Note', { required: false })); return { ok: true }; });
      add('DELETE', '/api/leave', ({ query }) => { db.prepare('DELETE FROM leave WHERE employee_id=? AND date=?').run(Number(query.employee_id), query.date); return { ok: true }; });
      add('GET', '/api/week.csv', ({ query }) => { const m = R.mondayOf(v.date(query.start, 'start'));
        return csv([['Date', 'Employee', 'Role', 'Start', 'End', 'Break (min)', 'Paid hours'], ...weekRows(m).sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start)).map((s) => { const e = emp(s.employee_id); return [s.date, e.name, e.role, s.start, s.end, s.break_min, R.paidHours(s)]; })]); });
    } });
}
module.exports = { build };
