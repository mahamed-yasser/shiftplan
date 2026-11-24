'use strict';
// First-run setup, login, restart and unauthenticated-access checks. Same file in every project.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { build } = require('../src/app');
const post = (base, url, body, cookie) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
const PW = 'fixture-' + require('node:crypto').randomBytes(9).toString('hex');

test('fresh database: no built-in account, setup once, login, restart', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-')), dbFile = path.join(dir, 't.db');
  let app = build({ dbFile }), port = await app.listen(0), base = 'http://127.0.0.1:' + port;
  assert.equal((await (await fetch(base + '/api/status')).json()).setupRequired, true);
  for (const guess of ['admin', 'demo1234', 'password', 'admin123']) assert.equal((await post(base, '/api/login', { username: 'admin', password: guess })).status, 401, 'no default credentials');
  assert.equal((await post(base, '/api/setup', { username: 'owner', password: 'short' })).status, 400, 'weak password refused');
  const ok = await post(base, '/api/setup', { username: 'owner', name: 'Owner', password: PW });
  assert.equal(ok.status, 200); const cookie = ok.headers.get('set-cookie').split(';')[0];
  assert.match(ok.headers.get('set-cookie'), /HttpOnly/);
  assert.equal((await post(base, '/api/setup', { username: 'second', password: PW + 'x' })).status, 409, 'setup cannot run twice');
  assert.equal((await (await fetch(base + '/api/status')).json()).setupRequired, false);
  assert.equal((await fetch(base + '/api/me', { headers: { Cookie: cookie } })).status, 200);
  await app.close();
  app = build({ dbFile }); port = await app.listen(0); base = 'http://127.0.0.1:' + port;
  assert.equal((await (await fetch(base + '/api/status')).json()).setupRequired, false, 'owner survives restart');
  assert.equal((await post(base, '/api/login', { username: 'owner', password: 'wrong-password-1' })).status, 401);
  assert.equal((await post(base, '/api/login', { username: 'owner', password: PW })).status, 200);
  assert.equal((await post(base, '/api/setup', { username: 'third', password: PW + 'y' })).status, 409);
  await app.close(); fs.rmSync(dir, { recursive: true, force: true });
});

test('every non-public route refuses unauthenticated requests', async () => {
  const app = build({ dbFile: ':memory:' }); const port = await app.listen(0), base = 'http://127.0.0.1:' + port;
  await post(base, '/api/setup', { username: 'owner', password: PW });
  const routes = app.protectedRoutes(); assert.ok(routes.length > 8);
  for (const r of routes) {
    const url = r.pattern.replace(/^\^|\$$/g, '').replace(/\(\[\^\/\]\+\)/g, '1').replace(/\\\//g, '/').replace(/\\/g, '');
    const res = await fetch(base + url, { method: r.method, headers: { 'Content-Type': 'application/json' }, body: r.method === 'GET' ? undefined : '{}' });
    assert.equal(res.status, 401, r.method + ' ' + url + ' must require sign-in');
  }
  await app.close();
});

test('server binds to loopback by default', async () => {
  const app = build({ dbFile: ':memory:' }); await app.listen(0);
  assert.equal(app.server.address().address, '127.0.0.1'); await app.close();
});
