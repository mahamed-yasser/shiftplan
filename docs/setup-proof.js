'use strict';
// Mobile first-run flow on a fresh database: setup screen, owner creation, sign out, bad login, good login, restart.
const e2e = require('./e2ekit'); const { build } = require('../src/app');
e2e((o) => build(o), async ({ page, shot, ok, restart, tick, url }) => {
  await page.viewport(390, 844, true);
  await page.goto(url()); await page.waitFor('document.querySelector("input[name=password]")');
  ok(await page.eval('!!document.querySelector("input[name=name]")'), 'fresh database shows the create-owner form, not a login with a default account');
  await shot('06-mobile-first-run-setup');
  const pw = 'fixture-' + require('node:crypto').randomBytes(9).toString('hex');
  await page.fill('name', 'Test Owner'); await page.fill('username', 'owner'); await page.fill('password', pw);
  await page.eval('document.querySelector(".login").requestSubmit()'); await page.waitFor('document.querySelector(".shell")');
  await tick(600); await shot('07-mobile-after-setup'); ok(true, 'owner created and signed in on a phone-size screen');
  await page.clickText('button', 'Sign out'); await page.waitFor('document.querySelector("input[name=password]")');
  ok(!(await page.eval('!!document.querySelector("input[name=name]")')), 'after setup the form is a normal sign-in');
  await page.fill('username', 'owner'); await page.fill('password', 'not-the-password-1'); await page.eval('document.querySelector(".login").requestSubmit()');
  await page.waitFor('document.querySelector(".form-error").textContent.length>0'); ok(true, 'wrong password rejected');
  await restart(); await page.goto(url()); await page.waitFor('document.querySelector("input[name=password]")');
  ok(!(await page.eval('!!document.querySelector("input[name=name]")')), 'owner account persists across a server restart');
  await page.fill('username', 'owner'); await page.fill('password', pw); await page.eval('document.querySelector(".login").requestSubmit()'); await page.waitFor('document.querySelector(".shell")');
  ok(true, 'sign in works after restart'); await shot('08-mobile-signed-in-after-restart');
}, { docs: require('node:path').join(__dirname, '.') });
