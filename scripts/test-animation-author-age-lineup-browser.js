'use strict';
const assert = require('node:assert/strict'); // Real browser checks age-mode controls, 3D transform parity and input performance.
const fs = require('node:fs'); // Maps version-pinned CDN/source assets to the checked-out PR commit.
const path = require('node:path'); // Keeps fixtures within the repository's docs directory.
const { chromium } = require('playwright'); // Uses the existing Animation Author Chromium workflow.
const ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const BASE = 'http://127.0.0.1:8000/tools/animation-author/index.html?ref=scene-smoke-fixture'; // Tests exactly the checked-out PR assets instead of floating main.
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
    await page.route('https://api.github.com/repos/Oolnokk/HobunjiHollowUnity/commits/**', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sha: 'scene-smoke-fixture' }) }));
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForFunction(() => !!window.HobunjiFullCharacterScaleComparison && !!document.getElementById('maaFullScaleTab'),
      null, { timeout: 90000 });
    await page.locator('#maaFullScaleTab').click();
    await page.waitForFunction(() => {
      const api = window.HobunjiFullCharacterScaleComparison;
      return api?.active && api.previewCount >= 1 && !!document.querySelector('#maaFullScaleChoose option');
    }, null, { timeout: 150000 });

    await page.waitForFunction(() => !window.HobunjiFullCharacterScaleComparison?.debugSnapshot?.().building, null, { timeout: 180000 }); // Isolate slider timing from progressive asset construction.
    const browserReport = await page.evaluate(async () => {
      const api = window.HobunjiFullCharacterScaleComparison;
      const selectedKey = api.selectedKey;
      const panel = document.getElementById('maaFullScalePanel');
      const chooser = document.getElementById('maaFullScaleChoose');
      const age = document.getElementById('maaFullScaleAgeMode');
      if (!selectedKey || !chooser?.value || getComputedStyle(panel).display === 'none') throw Error('Dropdown panel is not visible or lacks a selected character');
      if (chooser.value !== selectedKey) throw Error('Dropdown selection and preview state diverged');
      // Canvas picking is checked with a real pointer event outside the right-hand rail below.
      if (api.selectedKey !== selectedKey) throw Error('Dropdown selection changed unexpectedly');
      age.value = 'baby';
      age.dispatchEvent(new Event('change', { bubbles: true }));
      if (api.ageMode !== 'baby') throw Error('Baby stage did not activate');
      const group = window.HobunjiGameplayBackdrop?.getScene?.()?.getObjectByName?.('FullScalePreview_' + selectedKey);
      const state = group?.userData?.hobunjiCharacterRigScaleState;
      if (!state?.factor) throw Error('Rendered preview did not apply a floor-relative rig scale');
      const [species, gender] = selectedKey.split('::');
      const authored = window.HobunjiCharacterRigScale?.scaleFor?.(species, gender,
        window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters?.[selectedKey]);
      const config = window.HobunjiCharacterAgeRigConfig;
      const baseline = config.repositoryDefaults().baby;
      const preset = config.profileFor('baby', species, gender, config.repositoryProfiles()); // The selected authored preset, not the global fallback.
      const expected = config.composePreviewScale(authored, config.relativeProfile(preset || baseline, authored), { species, gender });
      const near = (a, b) => Math.abs(a - b) < 1e-5;
      if (!expected || !near(state.factor.x, expected.x) || !near(state.factor.y, expected.y) || !near(state.authoredScale.head, expected.head)) {
        throw Error('Real Three.js avatar body is not the same size as shared runtime age math: ' + JSON.stringify({ state, expected }));
      }
      // Thirty inputs in a single UI task must not force thirty full lineup traversals.
      const before = api.debugSnapshot().agePerf;
      const body = document.getElementById('maaFullScaleAgeRangeHeight');
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
      const applied = config?.snapshot?.();
      if (!applied?.applied || !near(applied.profiles.baby[selectedKey].height, .67) || !near(applied.profiles.baby[selectedKey].hand, 1.44) || !near(window.HobunjiRomanceConfig.family.phaseScales.basket.height, baseline.height)) {
        throw Error('Apply did not update the actual game family phase config');
      }
      document.getElementById('maaFullScaleAgeUnapply').click();
      if (config.snapshot().applied) throw Error('Restore did not clear the active game override');
      if (!near(window.HobunjiRomanceConfig.family.phaseScales.basket.height, baseline.height) || !near(config.snapshot().profiles.baby[selectedKey].height, preset.height)) {
        throw Error('Restore did not recover repository game phase config');
      }
      const neighborKey = [...chooser.options].find(option => option.value !== selectedKey)?.value;
      const scene = window.HobunjiGameplayBackdrop.getScene();
      const neighbor = scene.getObjectByName('FullScalePreview_' + neighborKey);
      if (!neighbor) throw Error('Overall Scale requires a second rendered identity for isolation checks');
      const overall = document.getElementById('maaFullScaleRangeOverall');
      const bakeOverall = document.getElementById('maaFullScaleBakeOverall');
      const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      for (const mode of ['baby', 'toddler', 'child', 'adult']) {
        age.value = mode;
        age.dispatchEvent(new Event('change', { bubbles: true }));
        const originalScale = group.scale.clone();
        const neighborScale = neighbor.scale.clone();
        const beforeResize = api.debugSnapshot().agePerf.rigPasses;
        overall.value = '110';
        overall.dispatchEvent(new Event('input', { bubbles: true }));
        await settle();
        if (api.debugSnapshot().agePerf.rigPasses - beforeResize !== 1) throw Error(mode + ' Overall Scale should recompose only one rig');
        if (!neighbor.scale.equals(neighborScale) || !near(group.scale.x, originalScale.x * 1.1) || !near(group.scale.y, originalScale.y * 1.1)) {
          throw Error(mode + ' Overall Scale changed the wrong rig or used the wrong scale');
        }
        const draftScale = group.scale.clone();
        bakeOverall.click();
        await settle();
        if (overall.value !== '100' || !near(group.scale.x, draftScale.x) || !near(group.scale.y, draftScale.y) || !neighbor.scale.equals(neighborScale)) {
          throw Error(mode + ' bake did not preserve the selected preview and its neighbor');
        }
      }
      const result = { selectedKey, previewCount: api.previewCount, expected, appliedInGame: applied.profiles.baby[selectedKey].height,
        perf: { before, after, beforeHand, afterHand }, debug: api.debugSnapshot() };
      return result;
    });
    assert.equal(browserReport.appliedInGame, .67);
    const toolbarBounds = await page.locator('#maaTopbar').boundingBox();
    const panelBounds = await page.locator('#maaFullScalePanel').boundingBox();
    assert(toolbarBounds && panelBounds && panelBounds.y >= toolbarBounds.y + toolbarBounds.height,
      'the age controls must never cover mode tabs on mobile; panel should scroll within available viewport space');
    await page.mouse.click(24, 540); // Real viewport pointer event outside the fixed editor controls.
    assert.equal(await page.evaluate(() => window.HobunjiFullCharacterScaleComparison?.selectedKey),
      browserReport.selectedKey, 'clicking the rendered lineup must not change selection');

    // The original regression: the scale tab intercepted Multi's native click and never refreshed its mode chrome.
    await page.locator('#maaMultiTab').click();
    await page.waitForFunction(() => document.body.dataset.animationAuthorMode === 'multi'
      && document.getElementById('maaMultiTab')?.getAttribute('aria-selected') === 'true',
      null, { timeout: 60000 });
    assert.equal(await page.locator('#maaFullScalePanel').isVisible(), false, 'the scale controls must close after returning to Multi');

    await page.locator('#maaRigTab').click();
    await page.waitForFunction(() => document.body.dataset.animationAuthorMode === 'rig'
      && document.getElementById('maaRigTab')?.getAttribute('aria-selected') === 'true',
      null, { timeout: 60000 });
    await page.evaluate(async () => {
      await window.MultiAvatarAnimationAuthor.addCreature('grehlr', 'idle');
      const coordinate = document.getElementById('maaRigAnchorSelect');
      coordinate.value = 'shoulderGrip';
      coordinate.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.evaluate(() => { document.getElementById('maaRightPanel').open = true; });
    const carrierSelect = page.locator('#maaShoulderCarrierNpcV1553');
    await carrierSelect.waitFor({ state: 'attached', timeout: 60000 });
    const choices = await carrierSelect.locator('option').evaluateAll(options => options.map(option => ({ value: option.value, text: option.text })));
    const targets = ['kenkari::male', 'longoran::female'].map(key => choices.find(option => option.text.startsWith(key)));
    assert(targets.every(Boolean), 'carrier picker includes different species, including the adult Longoran fallback');
    for (const target of targets) {
      await carrierSelect.selectOption(target.value);
      await page.waitForFunction(id => {
        const scene = window.HobunjiGameplayBackdrop?.getScene?.();
        const carrier = scene?.getObjectByName('ShoulderGripCarrierPreview_' + id);
        const portrait = carrier?.getObjectByProperty('name', 'ShoulderGripCarrierPreview_' + id + '_portrait');
        const status = document.getElementById('maaShoulderCarrierStatusV1553')?.textContent || '';
        return portrait?.userData?.neckRig?.available && status.includes('grip error 0.0000');
      }, target.value, { timeout: 90000 });
    }
    await page.locator('#maaSingleTab').click();
    await page.waitForFunction(() => document.body.dataset.animationAuthorMode === 'single'
      && document.getElementById('maaSingleTab')?.getAttribute('aria-selected') === 'true',
      null, { timeout: 60000 });

    // Mid-build navigation must invalidate the unfinished lineup instead of cancelling a native tab click.
    await page.locator('#maaFullScaleTab').click();
    await page.waitForFunction(() => !!window.HobunjiFullCharacterScaleComparison?.debugSnapshot?.().building,
      null, { timeout: 30000 });
    await page.locator('#maaRigTab').click();
    await page.waitForFunction(() => document.body.dataset.animationAuthorMode === 'rig'
      && document.getElementById('maaRigTab')?.getAttribute('aria-selected') === 'true',
      null, { timeout: 90000 });
    assert.equal(await page.locator('#maaFullScalePanel').isVisible(), false, 'cancelled lineup must not cover the Rig editor');
    console.log('PASS real mobile age-rig parity and all tab handoffs including Multi, Single, Rig and mid-load cancellation:',
      JSON.stringify(browserReport).slice(0,6000));
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
