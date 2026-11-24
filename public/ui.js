'use strict';
(function () {
// Tiny UI toolkit (no framework). Builds DOM with h(); all text goes through textContent, never innerHTML.
const $ = (s, r = document) => r.querySelector(s);
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, val] of Object.entries(attrs || {})) {
    if (val == null || val === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), val);
    else if (k === 'class') el.className = val;
    else if (k === 'value') el.value = val;
    else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = !!val;
    else el.setAttribute(k, val === true ? '' : val);
  }
  const add = (c) => { if (Array.isArray(c)) c.forEach(add); else if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c))); };
  kids.forEach(add);
  return el;
}
let onAuthLost = () => {};
async function api(method, url, body) {
  const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401 && !url.endsWith('/login')) { onAuthLost(); throw new Error('Please sign in'); }
  const text = await r.text();
  let data = {}; try { data = JSON.parse(text); } catch { data = { text }; }
  if (!r.ok) { const e = new Error(data.error || 'Request failed'); e.status = r.status; throw e; }
  return data;
}
function toast(msg, kind = 'ok') {
  let box = $('#toasts'); if (!box) { box = h('div', { id: 'toasts', 'aria-live': 'polite' }); document.body.append(box); }
  const t = h('div', { class: 'toast ' + kind }, msg); box.append(t); setTimeout(() => t.remove(), 4000);
}
const money = (cents, cur = '$') => (cents < 0 ? '-' : '') + cur + (Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d) => d ? new Date(d + (d.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
const badge = (text, kind) => h('span', { class: 'badge ' + (kind || '') }, text);

function field(f, val) {
  const id = 'f_' + f.name; let input;
  const common = { id, name: f.name, required: f.required, placeholder: f.placeholder };
  if (f.type === 'select') input = h('select', common, (f.options || []).map(([v, l]) => h('option', { value: v, selected: String(v) === String(val ?? '') }, l)));
  else if (f.type === 'textarea') input = h('textarea', { ...common, rows: 3 }, val ?? '');
  else if (f.type === 'checkbox') input = h('input', { id, name: f.name, type: 'checkbox', checked: !!val });
  else input = h('input', { ...common, type: f.type || 'text', value: val ?? '', step: f.step, min: f.min, max: f.max, maxlength: f.maxlength });
  return h('label', { class: 'field' + (f.type === 'checkbox' ? ' check' : '') + (f.wide ? ' wide' : ''), for: id }, h('span', {}, f.label), input);
}
// form modal: resolves with an object of values, or null if cancelled. onSubmit may throw to show an inline error.
function formModal({ title, fields, values = {}, submit = 'Save', onSubmit, note }) {
  return new Promise((resolve) => {
    const err = h('p', { class: 'form-error', role: 'alert' });
    const form = h('form', { class: 'form-grid' }, fields.map((f) => field(f, values[f.name])), note ? h('p', { class: 'muted wide' }, note) : null, err);
    const close = (r) => { back.remove(); document.removeEventListener('keydown', esc); resolve(r); };
    const esc = (e) => { if (e.key === 'Escape') close(null); };
    const go = async () => {
      const out = {};
      for (const f of fields) {
        const el = form.elements[f.name];
        out[f.name] = f.type === 'checkbox' ? el.checked : f.type === 'number' ? (el.value === '' ? null : Number(el.value)) : el.value;
      }
      try { if (onSubmit) await onSubmit(out); close(out); } catch (e) { err.textContent = e.message; }
    };
    form.addEventListener('submit', (e) => { e.preventDefault(); go(); });
    const dlg = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('h2', {}, title), form,
      h('div', { class: 'modal-actions' }, h('button', { class: 'btn ghost', type: 'button', onclick: () => close(null) }, 'Cancel'),
        h('button', { class: 'btn primary', type: 'button', id: 'modal-submit', onclick: () => form.requestSubmit() }, submit)));
    const back = h('div', { class: 'backdrop' }, dlg);
    back.addEventListener('mousedown', (e) => { if (e.target === back) close(null); });
    document.addEventListener('keydown', esc); document.body.append(back);
    const first = form.querySelector('input,select,textarea'); if (first) first.focus();
  });
}
const confirmBox = (title, text, label = 'Confirm') => formModal({ title, fields: [], note: text, submit: label });

function table(cols, rows, { empty = 'Nothing here yet.', onRow } = {}) {
  if (!rows.length) return h('div', { class: 'empty' }, empty);
  return h('div', { class: 'table-wrap' }, h('table', {},
    h('thead', {}, h('tr', {}, cols.map((c) => h('th', { class: c.class }, c.label)))),
    h('tbody', {}, rows.map((r) => h('tr', { class: onRow ? 'click' : '', onclick: onRow ? () => onRow(r) : null },
      cols.map((c) => h('td', { class: c.class, 'data-label': c.label }, c.render ? c.render(r) : r[c.key])))))));
}
const kpi = (label, value, sub, kind) => h('div', { class: 'kpi ' + (kind || '') }, h('div', { class: 'kpi-label' }, label), h('div', { class: 'kpi-value' }, value), sub ? h('div', { class: 'kpi-sub' }, sub) : null);
const toolbar = (...kids) => h('div', { class: 'toolbar' }, kids);
const btn = (label, onclick, cls = '') => h('button', { class: 'btn ' + cls, type: 'button', onclick }, label);
function download(name, text, type = 'text/csv') {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name }); document.body.append(a); a.click(); a.remove();
}

// App shell: login screen + sidebar navigation + hash routing.
async function mountApp({ title, tagline, accent, views, root = document.body }) {
  if (accent) document.documentElement.style.setProperty('--accent', accent);
  document.title = title;
  let current = null;
  const main = h('main', { id: 'view', tabindex: '-1' });
  async function show() {
    const id = location.hash.slice(2).split('/')[0] || views[0].id;
    const view = views.find((x) => x.id === id) || views[0];
    current = view.id;
    document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('on', a.dataset.id === current));
    main.replaceChildren(h('div', { class: 'loading' }, 'Loading…'));
    try { const body = h('div', { class: 'view' }); await view.render(body, location.hash.split('/').slice(2)); main.replaceChildren(h('h1', {}, view.label), body); }
    catch (e) { main.replaceChildren(h('h1', {}, view.label), h('div', { class: 'empty err' }, e.message)); }
  }
  async function login(msg) {
    let setup = false; try { setup = (await api('GET', '/api/status')).setupRequired; } catch {}
    const err = h('p', { class: 'form-error', role: 'alert' }, msg || '');
    const form = h('form', { class: 'login', onsubmit: async (e) => {
      e.preventDefault();
      try { await api('POST', setup ? '/api/setup' : '/api/login', { username: form.username.value, password: form.password.value, name: setup ? form.name.value : undefined }); start(); }
      catch (x) { err.textContent = x.message; }
    } },
      h('h1', {}, title), h('p', { class: 'muted' }, tagline || ''),
      setup ? h('p', { class: 'muted' }, 'First run: create the owner account for this local copy. Use a password of at least 10 characters.') : null,
      setup ? h('label', { class: 'field' }, h('span', {}, 'Your name'), h('input', { name: 'name', autocomplete: 'name' })) : null,
      h('label', { class: 'field' }, h('span', {}, 'Username'), h('input', { name: 'username', autocomplete: 'username' })),
      h('label', { class: 'field' }, h('span', {}, 'Password'), h('input', { name: 'password', type: 'password', autocomplete: setup ? 'new-password' : 'current-password', minlength: setup ? 10 : undefined })),
      err, h('button', { class: 'btn primary', type: 'submit' }, setup ? 'Create owner account' : 'Sign in'),
      h('p', { class: 'muted small' }, 'Demo build with fictional data.'));
    root.replaceChildren(h('div', { class: 'login-wrap' }, form));
    form.password.focus();
  }
  onAuthLost = () => login('Your session ended. Please sign in again.');
  async function start() {
    const me = await api('GET', '/api/me');
    const nav = h('nav', { class: 'nav', 'aria-label': 'Main' }, views.map((x) => h('a', { href: '#/' + x.id, 'data-id': x.id }, x.label)));
    const side = h('aside', { class: 'side' }, h('div', { class: 'brand' }, title), nav,
      h('div', { class: 'who' }, h('span', {}, me.user.name), h('button', { class: 'link', onclick: async () => { await api('POST', '/api/logout'); login(); } }, 'Sign out')));
    root.replaceChildren(h('div', { class: 'shell' }, side, main));
    window.onhashchange = show; show();
  }
  try { await api('GET', '/api/me'); await start(); } catch { login(); }
  return { refresh: show };
}
window.UI = { $, h, api, toast, money, fmtDate, badge, formModal, confirmBox, table, kpi, toolbar, btn, download, mountApp };
})();
