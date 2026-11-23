'use strict';
const assert = require('node:assert/strict'); // Real browser checks age-mode controls, 3D transform parity and input performance.
const fs = require('node:fs'); // Maps version-pinned CDN/source assets to the checked-out PR commit.
const path = require('node:path'); // Keeps fixtures within the repository's docs directory.
const { chromium } = require('playwright'); // Uses the existing Animation Author Chromium workflow.
const ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const BASE = 'http://127.0.0.1:8000/tools/animation-author/index.html';
const RAW = /^https:\/\/raw\.githubusercontent\.com\/Oolnokk\/HobunjiHollowUnity\/[^/]+\/(.+)$/;
const CDN = /^https:\/\/cdn\.jsdelivr\.net\/gh\/Oolnokk\/HobunjiHollowUnity@[^/]+\/(docs\/.+)$/;
const safeLocal = (route, raw) => {
  const relative = decodeURIComponent(raw || '').split(/[?#]/)[0];
  const local = path.resolve(ROOT, relative);
  if (!relative.startsWith('docs/') || !local.startsWith(DOCS + path.sep) || !fs.existsSync(local)) {
    return route.fulfill({ status: 404, body: 'Unavailable PR fixture: ' + relative });
  }
  const mime = local.endsWith('.json') ? 'application/json' : local.endsWith('.js') ? 'application/javascript'
    : local.endsWith('.png') ? 'image/png' : 'application/octet-stream';
  return route.fulfill({ status: 200, contentType: mime, body: fs.readFileSync(local) });
};
async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 420, height: 800 }, hasTouch: true, isMobile: true });
  const errors = []; // Mobile CI failure output is directly usable without browser devtools.
  page.on('pageerror', error => errors.push(String(error.stack || error)));
  try {
    await page.route(RAW, route => safeLocal(route, RAW.exec(route.request().url())?.[1]));
    await page.route(CDN, route => safeLocal(route, CDN.exec(route.request().url())?.[1]));
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForFunction(() => !!window.HobunjiFullCharacterScaleComparison && !!document.getElementById('maaFullScaleTab'),
      null, { timeout: 90000 });
    await page.locator('#maaFullScaleTab').click();
    await page.waitForFunction(() => {
      const api = window.HobunjiFullCharacterScaleComparison;
      return api?.active && api.previewCount >= 1 && !!document.querySelector('#maaFullScaleChoose option');
    }, null, { timeout: 150000 });

    const browserReport = await page.evaluate(async () => {
      const api = window.HobunjiFullCharacterScaleComparison;
      const selectedKey = api.selectedKey;
      const panel = document.getElementById('maaFullScalePanel');
      const chooser = document.getElementById('maaFullScaleChoose');
      const age = document.getElementById('maaFullScaleAgeMode');
      if (!selectedKey || !chooser?.value || getComputedStyle(panel).display === 'none') throw Error('Dropdown panel is not visible or lacks a selected character');
      if (chooser.value !== selectedKey) throw Error('Dropdown selection and preview state diverged');
      const canvas = document.getElementById('view3d');
      const rect = canvas.getBoundingClientRect();
      canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, bubbles: true }));
      canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, bubbles: true }));
      if (api.selectedKey !== selectedKey) throw Error('Canvas click changed dropdown-only selection');
      age.value = 'baby';
      age.dispatchEvent(new Event('change', { bubbles: true }));
      if (api.ageMode !== 'baby') throw Error('Baby stage did not activate');
      const group = window.HobunjiGameplayBackdrop?.getScene?.()?.getObjectByName?.('FullScalePreview_' + selectedKey);
      const state = group?.userData?.hobunjiCharacterRigScaleState;
      if (!state?.factor) throw Error('Rendered preview did not apply a floor-relative rig scale');
      const [species, gender] = selectedKey.split('::');
      const authored = window.HobunjiCharacterRigScale?.scaleFor?.(species, gender,
        window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters?.[selectedKey]);
      const expected = window.HobunjiCharacterAgeRigConfig?.composePreviewScale?.(authored, api.ageModifiers.baby);
      const near = (a, b) => Math.abs(a - b) < 1e-5;
      if (!expected || !near(state.factor.x, expected.x) || !near(state.factor.y, expected.y)) {
        throw Error('Real Three.js avatar body is not the same size as shared runtime age math: ' + JSON.stringify({ state, expected }));
      }
      // Thirty inputs in a single UI task must not force thirty full lineup traversals.
      const before = api.debugSnapshot().agePerf;
      const body = document.getElementById('maaFullScaleAgeRangeBody');
      for (let p = 38; p < 68; p++) {
        body.value = String(p);
        body.dispatchEvent(new Event('input', { bubbles: true }));
      }
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const after = api.debugSnapshot().agePerf;
      if (after.rigPasses - before.rigPasses > api.previewCount) throw Error('Body dragging recomposed the entire rig more than once per rendered frame');
      if (after.layoutPasses - before.layoutPasses > 1) throw Error('Body dragging caused redundant layout Box3 traversals');
      const hand = document.getElementById('maaFullScaleAgeRangeHands');
      const beforeHand = api.debugSnapshot().agePerf;
      for (let p = 120; p < 145; p++) {
        hand.value = String(p);
        hand.dispatchEvent(new Event('input', { bubbles: true }));
      }
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const afterHand = api.debugSnapshot().agePerf;
      if (afterHand.rigPasses !== beforeHand.rigPasses || afterHand.handSyncs !== beforeHand.handSyncs) {
        throw Error('Hand-only slider triggered expensive whole-rig work');
      }
      document.getElementById('maaFullScaleAgeApply').click();
      const config = window.HobunjiCharacterAgeRigConfig;
      const applied = config?.snapshot?.();
      if (!applied?.applied || Math.abs(window.HobunjiRomanceConfig.family.phaseScales.basket.body - .67) > 0.0001) {
        throw Error('Apply did not update the actual game family phase config');
      }
      document.getElementById('maaFullScaleAgeUnapply').click();
      if (config.snapshot().applied) throw Error('Restore did not clear the active game override');
      if (Math.abs(window.HobunjiRomanceConfig.family.phaseScales.basket.body - .32) > 0.0001) {
        throw Error('Restore did not recover repository game phase config');
      }
      const result = { selectedKey, previewCount: api.previewCount, expected, appliedInGame: applied.values.baby.body,
        perf: { before, after, beforeHand, afterHand }, debug: api.debugSnapshot() };
      return result;
    });
    assert.equal(browserReport.appliedInGame, .67);
    await page.locator('#maaRigTab').click();
    await page.waitForFunction(() => document.body.dataset.animationAuthorMode !== 'scale-compare', null, { timeout: 30000 });
    assert.equal(await page.locator('#maaFullScalePanel').isVisible(), false, 'comparison panel must close when another author tab opens');
    console.log('PASS live age-rig browser parity, dropdown-only selection, mobile slider frame budget, and runtime apply:', JSON.stringify(browserReport).slice(0,6000));
  } catch (error) {
    console.error('FAILED animation author age-rig browser:', error.stack || error);
    console.error('Browser errors:', errors.slice(-12).join('\n\n'));
    const report = await page.evaluate(() => ({
      author: window.HobunjiFullCharacterScaleComparison?.debugSnapshot?.() || null,
      status: document.getElementById('maaFullScaleStatus')?.textContent || null,
    })).catch(() => null);
    console.error('Mobile diagnostics:', JSON.stringify(report));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
