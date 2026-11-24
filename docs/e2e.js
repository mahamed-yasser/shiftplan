'use strict';
const e2e = require('./e2ekit'); const { build } = require('../src/app');
const clock = () => new Date('2026-11-24T10:00:00Z');
e2e((o) => build({ ...o, clock }), async ({ page, shot, ok, restart, login, modal, tick, url }) => {
  await login(); await page.waitFor('document.querySelectorAll(".chip").length>20'); ok((await page.text()).toLowerCase().includes('labour cost'), 'weekly rota renders with shifts and totals'); await tick(300); await shot('01-rota');
  // add a shift that overlaps -> inline error
  await page.click('button[aria-label="Add shift for Amira Saleh"]'); await page.waitFor('document.querySelector(".modal")');
  await modal('date', '2026-11-23'); await modal('start', '10:00'); await modal('end', '12:00'); await page.click('#modal-submit');
  await page.waitFor('document.querySelector(".form-error").textContent.includes("Overlaps")'); ok(true, 'overlapping shift is refused with a clear message');
  await page.clickText('.modal button', 'Cancel'); await page.waitFor('!document.querySelector(".modal")');
  // soft warning flow: Amira already 40h; a Saturday shift needs confirmation
  await page.click('button[aria-label="Add shift for Amira Saleh"]'); await page.waitFor('document.querySelector(".modal")');
  await modal('date', '2026-11-28'); await modal('start', '08:00'); await modal('end', '12:00'); await page.click('#modal-submit');
  await page.waitFor('document.querySelectorAll(".backdrop").length===2'); ok((await page.text()).includes('over 40 hours'), 'going over max weekly hours asks for confirmation'); await shot('02-confirm');
  await page.eval(`(()=>{const b=[...document.querySelectorAll('.backdrop')].pop();[...b.querySelectorAll('button')].find(x=>x.textContent==='Save anyway').click()})()`); await page.waitFor('!document.querySelector(".modal")');
  await page.waitFor('document.body.innerText.includes("43.5 / 40 h")'); ok(true, 'confirmed shift saved: 43.5 / 40 h shown in red');
  ok((await page.text()).toLowerCase().includes('overtime hours'), 'overtime cost reflected in totals');
  await restart(); await page.eval('location.reload()'); await page.waitFor('document.body.innerText.includes("43.5 / 40 h")'); ok(true, 'shift persisted after restart');
  await page.clickText('button', 'Publish week'); await page.waitFor('document.body.innerText.includes("Published")'); ok((await page.eval('document.querySelectorAll(".add").length')) === 0, 'publishing locks the week (no add buttons)'); await shot('03-published');
  await page.clickText('button', '▶'); await page.waitFor('document.body.innerText.includes("Draft")'); await page.clickText('button', 'Copy previous week here');
  await page.waitFor('document.querySelectorAll(".chip").length>20'); ok(true, 'copied the published week into the next one');
  await page.viewport(390, 844, true); await tick(500); await shot('04-mobile-rota');
}, { docs: __dirname });
