'use strict';
const test = require('node:test'), assert = require('node:assert/strict'); const R = require('../src/rota');
const e = { name: 'Ana', max_week_hours: 40 };
const sh = (date, start, end, b = 0, id = 1, employee_id = 1) => ({ id, employee_id, date, start, end, break_min: b });
test('paidHours handles breaks and overnight shifts', () => {
  assert.equal(R.paidHours(sh('2026-11-24', '09:00', '17:30', 30)), 8); assert.equal(R.paidHours(sh('2026-11-24', '22:00', '06:00', 60)), 7); assert.equal(R.paidHours(sh('2026-11-24', '09:00', '09:30', 60)), 0);
});
test('week helpers', () => { assert.equal(R.mondayOf('2026-11-29'), '2026-11-23'); assert.equal(R.mondayOf('2026-11-23'), '2026-11-23'); assert.equal(R.addDays('2026-12-30', 3), '2027-01-02'); assert.equal(R.weekday('2026-11-24'), 1); });
test('overlap including overnight into next day', () => {
  assert.ok(R.overlap(sh('2026-11-24', '22:00', '06:00'), sh('2026-11-25', '05:00', '09:00'))); assert.ok(!R.overlap(sh('2026-11-24', '09:00', '12:00'), sh('2026-11-24', '12:00', '15:00')));
});
test('check: hard conflicts and soft warnings', () => {
  const others = [sh('2026-11-24', '09:00', '17:00', 0, 2)];
  assert.match(R.check(sh('2026-11-24', '16:00', '20:00', 0, 3), others, e).hard[0], /Overlaps/);
  assert.match(R.check(sh('2026-11-25', '10:00', '12:00', 0, 3), [], e, { leave: ['2026-11-25'] }).hard[0], /on leave/);
  const rest = R.check(sh('2026-11-24', '23:00', '23:30', 0, 3), others, e); assert.equal(rest.hard.length, 0); assert.match(rest.soft[0], /rest/); // 6h gap after 17:00
  assert.equal(R.check(sh('2026-11-25', '09:00', '12:00', 0, 3), others, e).soft.length, 0); // 16h gap
  assert.match(R.check(sh('2026-11-26', '09:00', '17:00', 0, 3), [], e, { weekHours: 35 }).soft[0], /over 40 hours/);
  assert.match(R.check(sh('2026-11-26', '06:00', '20:00', 0, 3), [], e).soft[0], /12 paid hours/);
  assert.equal(R.check(sh('2026-11-24', '09:00', '17:00', 0, 2), others, e).hard.length, 0); // editing itself is not a conflict
});
test('weekCost pays overtime at 1.5x', () => {
  assert.deepEqual(R.weekCost(30, 2000), { hours: 30, overtime_hours: 0, cost_cents: 60000 });
  assert.deepEqual(R.weekCost(44, 2000), { hours: 44, overtime_hours: 4, cost_cents: 40 * 2000 + 4 * 3000 });
});
