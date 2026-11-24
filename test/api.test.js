'use strict';
const test = require('node:test'), assert = require('node:assert/strict'); const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { start } = require('./testkit'); const { build } = require('../src/app');
const clock = () => new Date('2026-11-24T10:00:00Z'); const mk = (o) => build({ ...o, clock }); const W = '2026-11-23';
const emps = async (s) => (await s.call('GET', '/api/employees')).data.employees;

test('auth and seeded week totals add up', async () => {
  const s = await start(mk); assert.equal((await s.anon('GET', '/api/week?start=' + W)).status, 401);
  const w = (await s.call('GET', '/api/week?start=2026-11-26')).data; assert.equal(w.start, W); assert.equal(w.days.length, 7);
  assert.equal(w.total_hours, w.employees.reduce((t, e) => t + e.hours, 0)); assert.equal(w.total_cost_cents, w.employees.reduce((t, e) => t + e.cost_cents, 0));
  assert.equal(w.by_day.reduce((t, d) => t + d.hours, 0), w.total_hours); assert.equal(w.published, false);
  const amira = w.employees.find((e) => e.name === 'Amira Saleh'); assert.equal(amira.hours, 40); assert.equal(amira.cost_cents, 40 * 1650);
  await s.close();
});
test('shift rules: overlap refused, leave refused, rest/hours need confirmation', async () => {
  const s = await start(mk); const E = await emps(s); const priya = E.find((e) => e.name === 'Priya Menon'), jonas = E.find((e) => e.name === 'Jonas Weber');
  const base = { employee_id: priya.id, date: '2026-11-26', start: '09:00', end: '13:00' };
  assert.equal((await s.call('POST', '/api/shifts', base)).data.error, 'Priya Menon is on leave that day');
  assert.match((await s.call('POST', '/api/shifts', { ...base, employee_id: jonas.id, date: '2026-11-24', start: '18:00', end: '22:00' })).data.error, /Overlaps/);
  const closeLate = { employee_id: jonas.id, date: '2026-11-29', start: '06:00', end: '10:00' }; // Sat close ends 20:30 -> but Sunday 06:00 gap 9.5h
  const r = await s.call('POST', '/api/shifts', closeLate); assert.equal(r.status, 409); assert.match(r.data.error, /rest/);
  const ok = await s.call('POST', '/api/shifts', { ...closeLate, confirm: true }); assert.equal(ok.status, 200);
  assert.equal((await s.call('POST', '/api/shifts', { ...base, date: '2026-11-31' })).status, 400); assert.equal((await s.call('POST', '/api/shifts', { ...base, start: '25:00' })).status, 400);
  await s.close();
});
test('edit and delete; weekly max hours warning; overtime cost', async () => {
  const s = await start(mk); const amira = (await emps(s)).find((e) => e.name === 'Amira Saleh');
  const r = await s.call('POST', '/api/shifts', { employee_id: amira.id, date: '2026-11-28', start: '07:00', end: '11:00' }); assert.equal(r.status, 409); assert.match(r.data.error, /over 40 hours/);
  const id = (await s.call('POST', '/api/shifts', { employee_id: amira.id, date: '2026-11-28', start: '07:00', end: '11:00', confirm: true })).data.id;
  let w = (await s.call('GET', '/api/week?start=' + W)).data; let a = w.employees.find((e) => e.name === 'Amira Saleh'); assert.equal(a.hours, 44); assert.equal(a.overtime_hours, 4); assert.equal(a.cost_cents, 40 * 1650 + 4 * 1650 * 1.5); assert.ok(a.over_max);
  assert.equal((await s.call('PATCH', '/api/shifts/' + id, { end: '09:00' })).status, 409); assert.equal((await s.call('PATCH', '/api/shifts/' + id, { end: '09:00', confirm: true })).status, 200);
  assert.equal((await s.call('DELETE', '/api/shifts/' + id)).status, 200); assert.equal((await s.call('DELETE', '/api/shifts/' + id)).status, 404);
  await s.close();
});
test('publishing locks the week; copy skips conflicts and lands on the right dates', async () => {
  const s = await start(mk);
  assert.equal((await s.call('POST', '/api/week/publish', { start: '2026-11-30' })).status, 400); // empty
  const cp = (await s.call('POST', '/api/week/copy', { from: W, to: '2026-11-30' })).data; assert.ok(cp.copied > 20);
  const next = (await s.call('GET', '/api/week?start=2026-11-30')).data; assert.ok(next.total_hours > 100);
  assert.ok(next.employees.flatMap((e) => e.shifts).every((x) => x.date >= '2026-11-30' && x.date <= '2026-12-06'));
  await s.call('POST', '/api/week/publish', { start: '2026-11-30' });
  const e1 = (await emps(s))[0]; assert.match((await s.call('POST', '/api/shifts', { employee_id: e1.id, date: '2026-12-02', start: '09:00', end: '10:00' })).data.error, /published/);
  assert.equal((await s.call('POST', '/api/week/copy', { from: W, to: '2026-11-30' })).status, 400);
  await s.call('POST', '/api/week/unpublish', { start: '2026-11-30' }); assert.equal((await s.call('POST', '/api/shifts', { employee_id: e1.id, date: '2026-12-02', start: '20:00', end: '21:00', confirm: true })).status, 200);
  await s.close();
});
test('leave, inactive staff, CSV and restart persistence', async () => {
  const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sp-')), 'x.db'); let s = await start((o) => mk({ ...o, dbFile })); const E = await emps(s); const nina = E.find((e) => e.name === 'Nina Petrova');
  assert.equal((await s.call('POST', '/api/leave', { employee_id: nina.id, date: '2026-11-25' })).status, 200); assert.equal((await s.call('POST', '/api/leave', { employee_id: nina.id, date: '2026-11-25' })).status, 409);
  assert.match((await s.call('POST', '/api/leave', { employee_id: nina.id, date: '2026-11-24' })).data.error, /Remove/);
  await s.call('PATCH', '/api/employees/' + nina.id, { active: false }); assert.match((await s.call('POST', '/api/shifts', { employee_id: nina.id, date: '2026-11-27', start: '09:00', end: '12:00' })).data.error, /inactive/);
  assert.match((await s.call('GET', '/api/week.csv?start=' + W, null, true)).text, /^Date,Employee/); await s.close();
  s = await start((o) => mk({ ...o, dbFile })); assert.equal((await emps(s)).find((e) => e.name === 'Nina Petrova').active, 0); await s.close();
});
