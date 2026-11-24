'use strict';
const R = require('./rota');
module.exports = function seed(db, today) {
  const mon = R.mondayOf(today);
  const E = [['Amira Saleh', 'Barista', 1650, 40], ['Jonas Weber', 'Barista', 1600, 32], ['Priya Menon', 'Barista', 1550, 24], ['Luca Romano', 'Chef', 2200, 40], ['Sara Lindqvist', 'Chef', 2100, 40], ['Omar Haddad', 'Front of house', 1500, 40], ['Nina Petrova', 'Front of house', 1450, 28]];
  E.forEach((e) => db.prepare('INSERT INTO employees(name,role,hourly_cents,max_week_hours) VALUES(?,?,?,?)').run(e[0], e[1], e[2], e[3]));
  const S = (emp, day, st, en, br, label) => db.prepare('INSERT INTO shifts(employee_id,date,start,end,break_min,label) VALUES(?,?,?,?,?,?)').run(emp, R.addDays(mon, day), st, en, br, label);
  for (let d = 0; d < 5; d++) { S(1, d, '07:00', '15:30', 30, 'Open'); S(4, d, '08:00', '16:30', 30, 'Kitchen'); }
  for (let d = 0; d < 6; d += 1) S(2, d, '12:00', '20:00', 30, 'Close');
  S(6, 0, '10:00', '18:00', 30, ''); S(6, 2, '10:00', '18:00', 30, ''); S(6, 4, '10:00', '20:00', 30, ''); S(6, 5, '09:00', '19:00', 45, 'Busy day');
  S(7, 1, '16:00', '22:00', 0, ''); S(7, 3, '16:00', '22:00', 0, ''); S(7, 5, '16:00', '23:00', 0, '');
  S(5, 1, '16:00', '23:30', 30, 'Dinner'); S(5, 2, '16:00', '23:30', 30, 'Dinner'); S(5, 3, '16:00', '23:30', 30, 'Dinner'); S(5, 4, '16:00', '23:30', 30, 'Dinner'); S(5, 5, '16:00', '23:30', 30, 'Dinner');
  S(3, 5, '08:00', '14:00', 0, ''); S(3, 6, '09:00', '15:00', 0, 'Brunch');
  db.prepare('INSERT INTO leave(employee_id,date,note) VALUES(?,?,?)').run(3, R.addDays(mon, 3), 'Dentist');
  // previous week is published as history
  for (let d = 0; d < 5; d++) db.prepare('INSERT INTO shifts(employee_id,date,start,end,break_min,label) VALUES(?,?,?,?,?,?)').run(1, R.addDays(mon, d - 7), '07:00', '15:30', 30, 'Open');
  db.prepare('INSERT INTO weeks VALUES(?,?)').run(R.addDays(mon, -7), R.addDays(mon, -9) + 'T10:00:00.000Z');
};
