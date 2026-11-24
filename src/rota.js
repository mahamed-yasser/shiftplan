'use strict';
// Pure rota rules. Dates YYYY-MM-DD, times HH:MM. A shift whose end is not after its start runs overnight into the next day.
const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const dayNum = (d) => Math.round(Date.parse(d + 'T00:00:00Z') / 864e5);
const addDays = (d, n) => new Date((dayNum(d) + n) * 864e5).toISOString().slice(0, 10);
const weekday = (d) => (new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7; // Monday = 0
const mondayOf = (d) => addDays(d, -weekday(d));
const span = (s) => { const a = dayNum(s.date) * 1440 + toMin(s.start); let b = dayNum(s.date) * 1440 + toMin(s.end); if (b <= a) b += 1440; return [a, b]; };
const paidHours = (s) => { const [a, b] = span(s); return Math.max(0, (b - a - (s.break_min || 0)) / 60); };
const overlap = (x, y) => { const [a, b] = span(x), [c, d] = span(y); return a < d && c < b; };

// hard: cannot be saved. soft: needs the manager to confirm.
function check(shift, others, emp, { leave = [], weekHours = 0 } = {}) {
  const hard = [], soft = [];
  const mine = others.filter((o) => o.employee_id === shift.employee_id && o.id !== shift.id);
  if (mine.some((o) => overlap(shift, o))) hard.push('Overlaps another shift for this person');
  if (leave.some((l) => l === shift.date)) hard.push(`${emp.name} is on leave that day`);
  if (paidHours(shift) <= 0) hard.push('Shift has no paid hours');
  const [a, b] = span(shift);
  for (const o of mine) { const [c, d] = span(o); const gap = Math.min(Math.abs(a - d), Math.abs(c - b)); if (!overlap(shift, o) && gap < 11 * 60) { soft.push(`Less than 11 hours rest before or after ${o.date} ${o.start}`); break; } }
  if (paidHours(shift) > 12) soft.push('Shift is longer than 12 paid hours');
  if (weekHours + paidHours(shift) > emp.max_week_hours) soft.push(`Takes ${emp.name} over ${emp.max_week_hours} hours this week`);
  return { hard, soft };
}
// Weekly pay: hours over the overtime threshold are paid at 1.5x.
function weekCost(hours, rate_cents, otAfter = 40) {
  const reg = Math.min(hours, otAfter), ot = Math.max(0, hours - otAfter);
  return { hours, overtime_hours: ot, cost_cents: Math.round(reg * rate_cents + ot * rate_cents * 1.5) };
}
module.exports = { toMin, addDays, weekday, mondayOf, span, paidHours, overlap, check, weekCost };
