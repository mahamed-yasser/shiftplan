'use strict';
// Small zero-dependency server core: sqlite, scrypt login, cookie sessions, JSON routes, static files.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = (m) => new HttpError(400, m);

function hashPw(pw, salt = crypto.randomBytes(16).toString('hex')) {
  return salt + ':' + crypto.scryptSync(pw, salt, 32).toString('hex');
}
function checkPw(pw, stored) {
  const [salt, h] = stored.split(':');
  const a = Buffer.from(h, 'hex'), b = crypto.scryptSync(pw, salt, 32);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const v = {
  str(x, name, { max = 200, required = true } = {}) {
    if (x == null || x === '') { if (required) throw bad(name + ' is required'); return ''; }
    if (typeof x !== 'string') throw bad(name + ' must be text');
    const s = x.trim();
    if (required && !s) throw bad(name + ' is required');
    if (s.length > max) throw bad(name + ' is too long');
    return s;
  },
  int(x, name, { min = 0, max = 1e9, required = true } = {}) {
    if (x == null || x === '') { if (required) throw bad(name + ' is required'); return null; }
    const n = Number(x);
    if (!Number.isInteger(n)) throw bad(name + ' must be a whole number');
    if (n < min || n > max) throw bad(name + ' must be between ' + min + ' and ' + max);
    return n;
  },
  num(x, name, { min = 0, max = 1e9, required = true } = {}) {
    if (x == null || x === '') { if (required) throw bad(name + ' is required'); return null; }
    const n = Number(x);
    if (!Number.isFinite(n)) throw bad(name + ' must be a number');
    if (n < min || n > max) throw bad(name + ' must be between ' + min + ' and ' + max);
    return n;
  },
  date(x, name, { required = true } = {}) {
    if (x == null || x === '') { if (required) throw bad(name + ' is required'); return null; }
    if (typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x) || isNaN(Date.parse(x + 'T00:00:00Z'))
      || new Date(x + 'T00:00:00Z').toISOString().slice(0, 10) !== x) throw bad(name + ' must be a date (YYYY-MM-DD)');
    return x;
  },
  time(x, name) {
    if (typeof x !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(x)) throw bad(name + ' must be a time (HH:MM)');
    return x;
  },
  oneOf(x, list, name) {
    if (!list.includes(x)) throw bad(name + ' must be one of: ' + list.join(', '));
    return x;
  },
};

function createApp({ dbFile = ':memory:', publicDir, schema, seed, routes, appName = 'app', sessionHours = 12 }) {
  const db = new DatabaseSync(dbFile);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;');
  db.exec(`CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, pw TEXT NOT NULL, name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);`);
  db.exec(schema);
  const tx = (fn) => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };
  // Demo data is seeded once per database. There is no built-in account: the first visitor creates the owner (see /api/setup).
  if (db.prepare('PRAGMA user_version').get().user_version === 0) { if (seed) tx(() => seed(db)); db.exec('PRAGMA user_version=1'); }
  const hasUsers = () => !!db.prepare('SELECT 1 FROM users').get();
  const table = [];
  const add = (method, pattern, handler, opts = {}) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:([a-z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    table.push({ method, re, keys, handler, opts });
  };
  const fails = new Map();
  const openSession = (ctx, u) => {
    const sid = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sid, u.id, Date.now() + sessionHours * 3600e3);
    ctx.setCookie = `sid=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionHours * 3600}`;
    return { user: { id: u.id, username: u.username, name: u.name } };
  };
  add('GET', '/api/status', () => ({ setupRequired: !hasUsers(), app: appName }), { public: true });
  add('POST', '/api/setup', (ctx) => {
    const username = String(ctx.body.username || '').trim().toLowerCase(), name = String(ctx.body.name || '').trim() || username, pw = String(ctx.body.password || '');
    if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw bad('Username: 3-32 letters, digits, dot, dash or underscore');
    if (pw.length < 10 || pw.length > 200) throw bad('Password must be at least 10 characters');
    if (pw.toLowerCase().includes(username)) throw bad('Password must not contain the username');
    return tx(() => {
      if (hasUsers()) throw new HttpError(409, 'Setup is already done');
      const id = Number(db.prepare('INSERT INTO users(username,pw,name) VALUES(?,?,?)').run(username, hashPw(pw), name.slice(0, 80)).lastInsertRowid);
      return openSession(ctx, { id, username, name: name.slice(0, 80) });
    });
  }, { public: true });
  add('POST', '/api/login', (ctx) => {
    const ip = ctx.ip, f = fails.get(ip) || { n: 0, t: Date.now() };
    if (Date.now() - f.t > 300000) { f.n = 0; f.t = Date.now(); }
    if (f.n >= 8) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
    const u = db.prepare('SELECT * FROM users WHERE username=?').get(String(ctx.body.username || ''));
    if (!u || !checkPw(String(ctx.body.password || ''), u.pw)) { f.n++; fails.set(ip, f); throw new HttpError(401, 'Wrong username or password'); }
    fails.delete(ip);
    return openSession(ctx, u);
  }, { public: true });
  add('POST', '/api/logout', (ctx) => {
    if (ctx.sid) db.prepare('DELETE FROM sessions WHERE id=?').run(ctx.sid);
    ctx.setCookie = 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0';
    return { ok: true };
  }, { public: true });
  add('GET', '/api/me', (ctx) => ({ user: ctx.user, app: appName }));
  add('GET', '/api/health', () => ({ ok: true }), { public: true });
  routes(add, { db, tx, v, bad, HttpError });

  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.csv': 'text/csv; charset=utf-8' };
  const headers = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'" };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const cookie = Object.fromEntries((req.headers.cookie || '').split(/;\s*/).filter(Boolean).map((c) => { const i = c.indexOf('='); return [c.slice(0, i), c.slice(i + 1)]; }));
    const send = (status, body, type = 'application/json', extra = {}) => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...headers, ...extra });
      res.end(body);
    };
    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'Method not allowed', 'text/plain');
      let p = decodeURIComponent(url.pathname); if (p === '/') p = '/index.html';
      const file = path.join(publicDir, path.normalize(p));
      if (!file.startsWith(publicDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(404, 'Not found', 'text/plain');
      return send(200, fs.readFileSync(file), mime[path.extname(file)] || 'application/octet-stream');
    }
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > 1e6) req.destroy(); else chunks.push(c); });
    req.on('end', () => {
      const ctx = { db, tx, query: Object.fromEntries(url.searchParams), body: {}, params: {}, ip: req.socket.remoteAddress, sid: cookie.sid, user: null, setCookie: null, v };
      try {
        const r = table.find((t) => t.method === req.method && t.re.test(url.pathname));
        if (!r) throw new HttpError(404, 'Not found');
        const m = url.pathname.match(r.re); r.keys.forEach((k, i) => { ctx.params[k] = decodeURIComponent(m[i + 1]); });
        if (req.method !== 'GET') {
          if (chunks.length) {
            if (!(req.headers['content-type'] || '').includes('application/json')) throw new HttpError(415, 'JSON required');
            try { ctx.body = JSON.parse(Buffer.concat(chunks).toString()); } catch { throw bad('Invalid JSON'); }
            if (ctx.body === null || typeof ctx.body !== 'object' || Array.isArray(ctx.body)) throw bad('Body must be an object');
          }
        }
        if (cookie.sid) {
          const s = db.prepare('SELECT u.id,u.username,u.name,s.expires FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=?').get(cookie.sid);
          if (s && s.expires > Date.now()) ctx.user = { id: s.id, username: s.username, name: s.name };
        }
        if (!r.opts.public && !ctx.user) throw new HttpError(401, 'Please sign in');
        const out = r.handler(ctx);
        const extra = ctx.setCookie ? { 'Set-Cookie': ctx.setCookie } : {};
        if (out && out.__raw) return send(200, out.body, out.type, { ...extra, ...(out.headers || {}) });
        send(200, JSON.stringify(out === undefined ? { ok: true } : out), 'application/json', extra);
      } catch (e) {
        if (e instanceof HttpError) return send(e.status, JSON.stringify({ error: e.message }));
        if (/UNIQUE constraint/.test(String(e.message))) return send(409, JSON.stringify({ error: 'That already exists' }));
        if (/FOREIGN KEY|CHECK constraint/.test(String(e.message))) return send(400, JSON.stringify({ error: 'Invalid reference or value' }));
        console.error(e); send(500, JSON.stringify({ error: 'Something went wrong' }));
      }
    });
  });
  return {
    db, server, protectedRoutes: () => table.filter((t) => !t.opts.public).map((t) => ({ method: t.method, pattern: t.re.source })),
    listen: (port = 0, host = '127.0.0.1') => new Promise((ok) => server.listen(port, host, () => ok(server.address().port))),
    close: () => new Promise((ok) => { server.closeAllConnections?.(); server.close(() => { try { db.close(); } catch {} ok(); }); }),
  };
}
const csvCell = (x) => { const s = String(x ?? ''); return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? '"' + (/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""') + '"' : s; };
const csv = (rows) => ({ __raw: true, type: 'text/csv; charset=utf-8', body: rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n' });
module.exports = { createApp, HttpError, v, bad, hashPw, checkPw, csv };
