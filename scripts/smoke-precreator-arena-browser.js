'use strict';
// Real Chromium smoke for the FULL game Testing Arena preview, not a toy avatar canvas.
// Run with local Three.js r128 and a headless WebGL renderer in CI.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const BASE = process.env.HOBUNJI_TEST_URL || 'http://127.0.0.1:8000';

async function main() {
  const browser = await chromium.launch({ headless: true,
    args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 650 }, hasTouch: true });
  const errors = []; // On-device equivalent is the preview's visible Controls/Debug report.
  page.on('pageerror', error => { errors.push(String(error)); console.error('[preview pageerror]', String(error)); });
  try {
    const modules = {
      'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js': 'three/build/three.min.js',
      'https://unpkg.com/three@0.128.0/build/three.min.js': 'three/build/three.min.js',
      'https://unpkg.com/three@0.128.0/examples/js/controls/TransformControls.js': 'three/examples/js/controls/TransformControls.js',
      'https://unpkg.com/three@0.128.0/examples/js/controls/OrbitControls.js': 'three/examples/js/controls/OrbitControls.js',
      'https://unpkg.com/three@0.128.0/examples/js/loaders/GLTFLoader.js': 'three/examples/js/loaders/GLTFLoader.js',
    };
    for (const [url, file] of Object.entries(modules))
      await page.route(url, route => route.fulfill({
        contentType: 'application/javascript', body: fs.readFileSync(require.resolve(file)),
      }));
    // Seed actual origin Storage BEFORE loading the guest. Do not use addInitScript:
    // that would re-seed the sentinel on the final page and hide save corruption.
    await page.goto(BASE + '/config/species/index.json', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.evaluate(() => {
      localStorage.setItem('hobunjiSaveMeta', 'PREVIEW_TEST_REAL_SAVE_SENTINEL');
      localStorage.setItem('hobunjiPlayerProfile', 'PREVIEW_TEST_REAL_PROFILE_SENTINEL');
    });
    await page.route('**/config/npcs/hobunji-starter-npc-database.json*', route => {
      const json = JSON.parse(fs.readFileSync('docs/config/npcs/hobunji-starter-npc-database.json', 'utf8'));
      json.npcs = []; // No unrelated town NPC portrait downloads during arena boot.
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(json) });
    });
    await page.goto(BASE + '/index.html?previewArena=1&skipIntro=1&skipRescue=1&skipMeeting=1',
      { waitUntil: 'domcontentloaded', timeout: 60000 });
    try {
      await page.waitForFunction(() => window.HobunjiPrecreatorArena?.getDebug?.().ready === true,
        null, { timeout: 180000 });
    } catch (error) {
      const snapshot = await page.evaluate(() => ({
        preview: window.HobunjiPrecreatorArena?.getDebug?.() || null,
        started: window.__hobunjiGameStarted === true, title: window.HobunjiTitleScreen?.getDebug?.(),
        panel: document.getElementById('precreatorArenaStatus')?.textContent,
      })).catch(() => ({}));
      throw new Error('Real Testing Arena did not initialize: ' + JSON.stringify(snapshot) + ', errors=' +
        JSON.stringify(errors.slice(-12)) + '. ' + error.message);
    }
    const runtime = await page.evaluate(() => ({
      status: window.HobunjiPrecreatorArena.getDebug(),
      legs: !!window.PlayerBodyTransformComposer?.getPlayerLegHandle?.(),
      player: !!window.PlayerBodyTransformComposer?.getPlayerMesh?.(),
      hands: window.ProceduralHandAttachments?.getActiveDebug?.().length ?? 0,
      pants: window.PantsGarmentRenderer?.liveHandles?.().length ?? 0,
      sourceCanvasCount: document.querySelectorAll('canvas').length,
      panel: document.getElementById('precreatorArenaPanel')?.textContent,
      virtualSave: localStorage.getItem('hobunjiSaveMeta'),
    }));
    console.log('[precreator] arena boot:', JSON.stringify(runtime));
    assert.equal(runtime.status.area, 'map_dev_arena', 'real Testing Arena zone is active');
    assert.equal(runtime.player, true, 'the native game player exists');
    assert.equal(runtime.legs, true, 'the real procedural leg/foot rig exists');
    assert.ok(runtime.hands >= 1, 'the real hands have attached to the runtime actor');
    assert.equal(runtime.virtualSave, null, 'actual save is hidden behind guest storage quarantine');
    await page.waitForFunction(() => window.HobunjiPrecreatorArena?.getDebug?.().outfit.length > 0,
      null, { timeout: 30000 });
    await page.waitForFunction(() => (window.PantsGarmentRenderer?.liveHandles?.().length ?? 0) > 0,
      null, { timeout: 30000 });
    await page.click('#precreatorTool');
    await page.waitForFunction(() => !!window.HobunjiPrecreatorArena?.getDebug?.().tool,
      null, { timeout: 10000 });
    await page.selectOption('#precreatorSpecies', 'kenkari');
    await page.waitForFunction(() => window.HobunjiPrecreatorArena?.getDebug?.().species === 'kenkari',
      null, { timeout: 45000 });
    const values = await page.evaluate(() => {
      const before = window.HobunjiPrecreatorArena.getDebug().yaw;
      const wrap = document.getElementById('canvasWrap');
      const event = (name, x) => wrap.dispatchEvent(new PointerEvent(name, {
        pointerId: 99, clientX: x, clientY: 150, bubbles: true, cancelable: true,
      }));
      event('pointerdown', 140); event('pointermove', 240); event('pointerup', 240);
      return { before, after: window.HobunjiPrecreatorArena.getDebug().yaw,
        tool: window.HobunjiPrecreatorArena.getDebug().tool,
        selected: document.getElementById('precreatorSpecies').value };
    });
    assert.notEqual(values.after, values.before, 'pointer drag rotates the real skinned player');
    assert.equal(values.selected, 'kenkari', 'species dropdown rebuilt the native player');
    console.log('[precreator] updated avatar/tool/input:', JSON.stringify(values));

    // Navigate to a JSON resource on the same origin: no regular game code should
    // modify the original native Storage between inspecting the old and new pages.
    await page.goto(BASE + '/config/species/index.json', { waitUntil: 'domcontentloaded', timeout: 20000 });
    const saved = await page.evaluate(() => ({
      meta: localStorage.getItem('hobunjiSaveMeta'),
      profile: localStorage.getItem('hobunjiPlayerProfile'),
    }));
    assert.equal(saved.meta, 'PREVIEW_TEST_REAL_SAVE_SENTINEL', 'real world save untouched by preview');
    assert.equal(saved.profile, 'PREVIEW_TEST_REAL_PROFILE_SENTINEL', 'real character profile untouched by preview');
    console.log('precreator real Testing Arena browser smoke: PASS');
  } finally {
    await Promise.race([browser.close(), new Promise(resolve => setTimeout(resolve, 20000))]);
  }
}
main().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
