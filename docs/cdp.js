'use strict';
// Minimal Chrome DevTools driver (Node 22 built-in WebSocket, no packages). Needs google-chrome.
const { spawn } = require('node:child_process'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
async function launch({ width = 1280, height = 800, mobile = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-'));
  const port = 9300 + Math.floor(Math.random() * 600);
  const proc = spawn(process.env.CHROME || 'google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=' + port, '--user-data-dir=' + dir, 'about:blank'], { stdio: 'ignore' });
  let target;
  for (let i = 0; i < 100 && !target; i++) {
    await new Promise((r) => setTimeout(r, 150));
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch {}
  }
  if (!target) { proc.kill(); throw new Error('Chrome did not start'); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const { ok, no } = pending.get(d.id); pending.delete(d.id); d.error ? no(new Error(d.error.message)) : ok(d.result); } };
  const send = (method, params = {}) => new Promise((ok, no) => { const i = ++id; pending.set(i, { ok, no }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__errs=[];addEventListener("error",e=>__errs.push(String(e.message)));addEventListener("unhandledrejection",e=>__errs.push(String(e.reason)));' });
  const page = {
    async viewport(w, h, m = false) { await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: m }); },
    async goto(url) { await send('Page.navigate', { url }); await new Promise((r) => setTimeout(r, 500)); await page.waitFor('document.readyState==="complete"'); },
    async eval(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error('page error: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
      return r.result.value;
    },
    async waitFor(expr, ms = 8000) {
      const t = Date.now();
      while (Date.now() - t < ms) { try { if (await page.eval(expr)) return true; } catch {} await new Promise((r) => setTimeout(r, 100)); }
      throw new Error('timeout waiting for: ' + expr);
    },
    click: (sel) => page.eval(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)throw new Error('no element '+${JSON.stringify(sel)});e.click();return true})()`),
    clickText: (sel, text) => page.eval(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(sel)})].find(x=>x.textContent.trim().includes(${JSON.stringify(text)}));if(!e)throw new Error('no '+${JSON.stringify(sel)}+' with text '+${JSON.stringify(text)});e.click();return true})()`),
    // set value on input/select/textarea by name inside the open modal (or whole document)
    fill: (name, value, scope = 'document') => page.eval(`(()=>{const s=${scope};const e=s.querySelector('[name="${name}"]');if(!e)throw new Error('no field ${name}');if(e.type==='checkbox')e.checked=${JSON.stringify(!!value)};else{e.value=${JSON.stringify(String(value))};}e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`),
    errors: () => page.eval('window.__errs||[]'),
    text: () => page.eval('document.body.innerText'),
    async shot(file) { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, Buffer.from(r.data, 'base64')); },
    async close() { try { ws.close(); } catch {} proc.kill(); await new Promise((r) => setTimeout(r, 400)); try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); } catch {} },
  };
  await page.viewport(width, height, mobile);
  return page;
}
module.exports = { launch };
