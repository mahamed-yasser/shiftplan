'use strict';
// Phone layout check: at 390 and 320 px no page may scroll sideways, on every top-level view.
const e2e = require('./e2ekit'); const { build } = require('../src/app');
e2e((o) => build(o), async ({ page, shot, ok, tick, login }) => {
  await login();
  for (const w of [390, 320]) {
    await page.viewport(w, 800, true);
    const ids = await page.eval('[...document.querySelectorAll(".nav a")].map(a=>a.dataset.id)');
    for (const id of ids) {
      await page.eval('location.hash="#/' + id + '"'); await tick(500);
      const r = await page.eval('(()=>{const d=document.documentElement;let worst=null;document.querySelectorAll("body *").forEach(e=>{const b=e.getBoundingClientRect();if(b.width&&b.right>'+w+'+1&&!e.closest(".table-wrap,.nav"))worst=worst||(e.tagName+"."+e.className+" right="+Math.round(b.right))});return {sw:d.scrollWidth,iw:innerWidth,worst}})()');
      ok(r.sw <= w && r.iw === w, `${id} at ${w}px: no sideways page scroll (scrollWidth ${r.sw} <= ${r.iw})` + (r.worst ? ' [' + r.worst + ']' : ''));
    }
  }
}, { docs: require('node:path').join(__dirname, '.') });
