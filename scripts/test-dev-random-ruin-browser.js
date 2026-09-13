#!/usr/bin/env node
'use strict';

// End-to-end Random Test Ruin smoke. Requires Playwright + Chromium and a local
// server rooted at docs/. Example:
//   python3 -m http.server 8000 --directory docs
//   node scripts/test-dev-random-ruin-browser.js
// Optional diagnostics:
//   HOBUNJI_RUIN_FIXED_SEEDS=0x2468ace0 HOBUNJI_RUIN_AUDIT_SEEDS=0 node ...

const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const TEST_URL = process.env.HOBUNJI_TEST_URL || 'http://127.0.0.1:8000/index.html';
const DEFAULT_FIXED_SEEDS = [0x5eed1234, 0x13579bdf, 0x2468ace0, 0x0badc0de];
function parseFixedSeeds(value) {
  if (!value) return DEFAULT_FIXED_SEEDS;
  const parsed = value.split(',').map(token => Number(token.trim())).filter(Number.isFinite).map(value => value >>> 0);
  if (!parsed.length) throw new Error('HOBUNJI_RUIN_FIXED_SEEDS contained no valid numeric seeds.');
  return parsed;
}
const FIXED_SEEDS = parseFixedSeeds(process.env.HOBUNJI_RUIN_FIXED_SEEDS);
const auditRaw = process.env.HOBUNJI_RUIN_AUDIT_SEEDS;
const AUDIT_SEEDS = auditRaw == null ? 8 : Math.max(0, Number(auditRaw) || 0);

(async () => {
  const browser = await chromium.launch({ headless:true });
  const page = await browser.newPage();
  const pageErrors = [];
  const consoleMessages = [];
  const forbiddenEmbeddedRequests = [];

  page.on('pageerror', error => pageErrors.push(String(error)));
  page.on('console', message => {
    consoleMessages.push(`[${message.type()}] ${message.text()}`);
    if (consoleMessages.length > 240) consoleMessages.shift();
  });
  page.on('request', request => {
    const url = request.url();
    let frameUrl = '';
    try { frameUrl = request.frame()?.url?.() || ''; } catch (_) {}
    if (frameUrl.includes('/tools/debris-ifier/') && /(?:api\.github\.com|raw\.githubusercontent\.com)/i.test(url)) {
      forbiddenEmbeddedRequests.push({ url, frameUrl });
    }
  });

  await page.addInitScript(() => localStorage.setItem('hobunjiDevMode', '1'));
  await page.goto(TEST_URL, { waitUntil:'domcontentloaded', timeout:30000 });
  await page.waitForFunction(() =>
    !!window.DevRandomRuin &&
    !!window.DevRandomRuinPrototypeHooks &&
    !!window.DevRandomRuinHitPuzzles &&
    !!window.DevRandomRuinMotionRuntime &&
    !!window.DevRandomRuinRuntimeCoverage,
  null, { timeout:30000 });
  await page.evaluate(() => window.HobunjiTitleScreen?.start?.());
  await page.waitForFunction(() => !window.HobunjiTitleScreen?.isActive?.(), null, { timeout:5000 });

  async function failureDiagnostics(seed) {
    return page.evaluate(value => {
      const frame = document.getElementById('devRandomRuinGeneratorFrame');
      const generator = frame?.contentWindow?.DebrisifierV50;
      const state = generator?.getState?.();
      return {
        seed:value,
        area:window.GridTileAccessors?.getCurrentArea?.() || null,
        gameState:window.DevRandomRuin?.getState?.() || null,
        badge:document.getElementById('devRandomRuinBadge')?.textContent || null,
        generatorPresent:!!generator,
        transport:frame?.contentWindow?.__debrisifierEmbeddedTransport || null,
        localeStatus:frame?.contentDocument?.getElementById('localeStatus')?.textContent || null,
        furnitureStatus:frame?.contentDocument?.getElementById('furnitureRepoStatus')?.textContent || null,
        generatorDebug:frame?.contentDocument?.getElementById('debug')?.textContent || null,
        generatedSeed:state?.locale?.seed || null,
        generatedEnvironment:state?.locale?.meta?.environment || null,
      };
    }, seed);
  }

  const activeRuns = [];
  for (const seed of FIXED_SEEDS) {
    const ok = await page.evaluate(async value => window.DevRandomRuin.generate(value), seed);
    if (!ok) {
      const diagnostics = await failureDiagnostics(seed);
      throw new Error(
        `generate(${seed}) failed\nDIAGNOSTICS\n${JSON.stringify(diagnostics, null, 2)}` +
        `\nPAGE ERRORS\n${pageErrors.join('\n') || '(none)'}` +
        `\nRECENT CONSOLE\n${consoleMessages.slice(-80).join('\n') || '(none)'}` +
        `\nFORBIDDEN REQUESTS\n${JSON.stringify(forbiddenEmbeddedRequests, null, 2)}`,
      );
    }
    await page.waitForFunction(
      () => window.GridTileAccessors.getCurrentArea() === 'map_i_dev_random_ruin',
      null,
      { timeout:30000 },
    );
    await page.waitForFunction(() =>
      window.DevRandomRuinPrototypeHooks.snapshot().active &&
      window.DevRandomRuinHitPuzzles.snapshot().active &&
      window.DevRandomRuinMotionRuntime.snapshot().active &&
      window.DevRandomRuinRuntimeCoverage.snapshot().active,
    null, { timeout:10000 });

    const active = await page.evaluate(() => {
      const scene = window.GridTileAccessors.getActiveScene();
      const hooks = window.DevRandomRuinPrototypeHooks.snapshot();
      const hit = window.DevRandomRuinHitPuzzles.snapshot();
      const motion = window.DevRandomRuinMotionRuntime.snapshot();
      const coverage = window.DevRandomRuinRuntimeCoverage.snapshot();
      const frame = document.getElementById('devRandomRuinGeneratorFrame');
      const generator = frame?.contentWindow?.DebrisifierV50;
      const generatorState = generator?.getState?.();
      const transport = frame?.contentWindow?.__debrisifierEmbeddedTransport || null;
      const furnitureStatus = frame?.contentDocument?.getElementById('furnitureRepoStatus')?.textContent || '';
      const levels = Object.values(
        generatorState?.locale?.meta?.interiorShell?.plateauModel?.levelByCell || {},
      ).map(Number);
      let ladders = 0;
      scene?.traverse?.(object => {
        if (object.userData?.generatedAccessType === 'stoneLadder') ladders++;
      });
      return {
        area:window.GridTileAccessors.getCurrentArea(),
        building:window.GridTileAccessors.isBuildingArea(),
        sceneName:scene?.name || null,
        hasRoot:!!scene?.children?.find?.(object => /^dev_v50_ruin_/.test(object?.name || '')),
        hooks,
        hit,
        motion,
        coverage,
        transport,
        furnitureStatus,
        ladders,
        negativeLevels:levels.filter(level => level < 0).length,
      };
    });

    assert.equal(active.area, 'map_i_dev_random_ruin', JSON.stringify(active));
    assert.equal(active.building, true, JSON.stringify(active));
    assert.equal(active.sceneName, 'map_i_dev_random_ruin', JSON.stringify(active));
    assert.equal(active.hasRoot, true, JSON.stringify(active));
    assert.equal(active.hit.active, true, JSON.stringify(active.hit));
    assert.equal(active.motion.active, true, JSON.stringify(active.motion));
    assert.equal(active.coverage.effectiveUnhandled.length, 0, JSON.stringify(active.coverage));
    assert.ok(active.coverage.torchSourceCoverage.complete, JSON.stringify(active.coverage.torchSourceCoverage));
    assert.equal(active.transport?.active, true, JSON.stringify(active.transport));
    assert.equal(active.transport?.sameOrigin, true, JSON.stringify(active.transport));
    assert.equal(active.transport?.expectedFurniturePaths, 11, JSON.stringify(active.transport));
    assert.equal(active.transport?.patchedBindings, 4, JSON.stringify(active.transport));
    assert.match(
      active.furnitureStatus,
      /11 JSONs.*1 Runtime Authored.*10 Furniture Model Data/,
      active.furnitureStatus,
    );
    if (active.negativeLevels > 0) {
      assert.ok(active.ladders > 0, `negative floor tiers require ladder access: ${JSON.stringify(active)}`);
    }
    activeRuns.push({
      seed,
      ladders:active.ladders,
      negativeLevels:active.negativeLevels,
      furnitureStatus:active.furnitureStatus,
    });
  }

  let aggregate = null;
  if (AUDIT_SEEDS > 0) {
    const audit = await page.evaluate(async count => window.DevRandomRuinRuntimeCoverage.auditSeeds(count), AUDIT_SEEDS);
    assert.equal(audit.count, AUDIT_SEEDS, JSON.stringify(audit));
    assert.equal(audit.aggregate.unknown.length, 0, JSON.stringify(audit.aggregate.unknown));
    assert.ok(audit.aggregate.motions.length > 0, JSON.stringify(audit.aggregate));
    assert.ok(audit.aggregate.activators.length > 0, JSON.stringify(audit.aggregate));
    assert.ok(audit.aggregate.access.includes('stoneLadder'), JSON.stringify(audit.aggregate));
    aggregate = audit.aggregate;
  }
  assert.deepEqual(
    forbiddenEmbeddedRequests,
    [],
    `embedded V50 made forbidden live-repo requests: ${JSON.stringify(forbiddenEmbeddedRequests)}`,
  );
  if (pageErrors.length) throw new Error(`Page errors: ${pageErrors.join(' | ')}`);

  console.log(JSON.stringify({ activeRuns, transport:'same-origin', aggregate }, null, 2));
  await browser.close();
})().catch(error => {
  console.error(error);
  process.exit(1);
});
