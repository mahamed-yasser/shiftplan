'use strict';
// End-to-end harness: real HTTP server + file database + real Chrome. Restart helper proves persistence.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { launch } = require('./cdp');
module.exports = async function e2e(build, scenario, { docs = path.join(__dirname, '.') } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-')); const dbFile = path.join(dir, 'e2e.db');
  let app, port; const startServer = async () => { app = build({ dbFile }); port = await app.listen(port || 0); };
  await startServer();
  const url = () => 'http://127.0.0.1:' + port;
  const page = await launch({ width: 1280, height: 800 });
  const shot = (n) => page.shot(path.join(docs, n + '.png'));
  const steps = []; const step = (m) => { steps.push(m); console.log('  ✓ ' + m); };
  const ok = (cond, msg) => { if (!cond) throw new Error('E2E assertion failed: ' + msg); step(msg); };
  const restart = async () => { await app.close(); await startServer(); step('server restarted (same database file)'); };
  const pw = 'fixture-' + require('node:crypto').randomBytes(9).toString('hex'); // test-only, in memory
  const login = async () => { await page.goto(url()); await page.waitFor('document.querySelector("input[name=password]")'); if (await page.eval('!!document.querySelector("input[name=name]")')) await page.fill('name', 'Test Owner'); await page.fill('username', 'owner'); await page.fill('password', pw); await page.eval('document.querySelector(".login").requestSubmit()'); await page.waitFor('document.querySelector(".shell")'); };
  const modal = (name, value) => page.fill(name, value, 'document.querySelector(".modal")');
  const tick = (ms = 300) => new Promise((r) => setTimeout(r, ms));
  try {
    await scenario({ page, url, shot, ok, step, restart, login, modal, tick, app: () => app });
    const errs = await page.errors(); ok(errs.length === 0, 'no uncaught browser errors' + (errs.length ? ': ' + errs.join('; ') : ''));
    console.log('E2E PASSED (' + steps.length + ' checks)');
  } catch (e) { console.error('E2E FAILED:', e.message); try { console.error((await page.text()).slice(0, 600)); } catch {} process.exitCode = 1; }
  finally { await page.close(); await app.close(); fs.rmSync(dir, { recursive: true, force: true }); }
};
