'use strict';
// Test helper: starts a project on a random port with an in-memory or temp-file database and a logged-in client.
// Test-only password, generated per process, held in memory, never written anywhere.
const pw = 'fixture-' + require('node:crypto').randomBytes(9).toString('hex');
async function start(build, opts = {}) {
  const app = build({ dbFile: ':memory:', ...opts });
  const port = await app.listen(0);
  const base = 'http://127.0.0.1:' + port;
  let cookie = '';
  const call = async (method, url, body, raw) => {
    const r = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const text = await r.text();
    if (raw) return { status: r.status, text, headers: r.headers };
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data };
  };
  const anon = async (method, url, body) => { const r = await fetch(base + url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, data: await r.json().catch(() => ({})) }; };
  const login = (p = pw) => call('POST', '/api/login', { username: 'owner', password: p });
  const setup = await call('POST', '/api/setup', { username: 'owner', name: 'Test Owner', password: pw });
  if (setup.status === 409) { const l = await login(); if (l.status !== 200) throw new Error('fixture login failed'); } else if (setup.status !== 200) throw new Error('test setup failed: ' + JSON.stringify(setup.data));
  return { app, pw, base, call, anon, login, close: () => app.close() };
}
module.exports = { start };
