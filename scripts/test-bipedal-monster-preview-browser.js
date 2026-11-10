'use strict';
// Browser regression: verify the existing Animation Author replaces both
// temporary primate placeholders with actual shipped GLB meshes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const PAGE = 'http://127.0.0.1:8000/tools/animation-author/index.html?actors=nohuknuk&ref=nohuknuk-model-fixture';
const RAW_RE = /^https:\/\/raw\.githubusercontent\.com\/Oolnokk\/HobunjiHollowUnity\/[^/]+\/(.+)$/;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 980, height: 620 }, hasTouch: true, isMobile: true });
  const errors = [];
  const modelResponses = [];
  page.on('pageerror', error => errors.push(error.stack || String(error)));
  page.on('requestfailed', request => errors.push(request.url() + ': ' + request.failure()?.errorText));
  page.on('response', response => {
    if (/(?:hand|foot)_primate\.glb/.test(response.url())) {
      modelResponses.push({ status: response.status(), url: response.url() });
    }
  });
  try {
    const html = fs.readFileSync(path.join(DOCS, 'tools/animation-author/index.html'), 'utf8');
    const marker = 'window.MultiAvatarAnimationAuthor.fullBodyDiagnostics = fullCharacterPreviewDiagnosticsV1548;';
    assert(html.includes(marker), 'Animation Author diagnostic extension anchor changed');
    const injected = html.replace(marker, marker + String.raw`
      window.MultiAvatarAnimationAuthor.__primateModelProbe = () => {
        const actor = animationAuthor.actors.find(candidate => candidate.source?.id === 'nohuknuk');
        if (!actor) return { loaded: false };
        const hand = actor.model?.userData?.proceduralHandRig;
        const foot = actor.rigFeetPreview;
        const handMeshes = [];
        const footMeshes = [];
        hand?.group?.traverse?.(node => { if (node.isMesh) handMeshes.push(node.name); });
        foot?.group?.traverse?.(node => { if (node.isMesh) footMeshes.push(node.name); });
        return {
          loaded: true,
          species: actor.source?.species,
          isBipedal: !!actor.model?.userData?.bipedalMonster,
          neckImplementation: actor.neckRig?.implementation,
          handProfileKey: window.HobunjiHandModelProfiles?.modelKeyForSpecies?.('nohuknuk'),
          handState: hand?.getDebug?.() || null,
          handMeshes,
          footConfig: window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.proceduralFeet?.species?.nohuknuk,
          feetPresent: !!foot?.group?.parent,
          footMeshes,
          handGlbLoaded: handMeshes.some(name => name.includes('hand_primate_fur')),
          footGlbLoaded: footMeshes.some(name => name.includes('foot_primate_fur')),
        };
      };
    `);
    await page.route('**/tools/animation-author/index.html**', route =>
      route.fulfill({ status: 200, contentType: 'text/html', body: injected }));
    await page.route('https://api.github.com/repos/Oolnokk/HobunjiHollowUnity/commits/**', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sha: 'nohuknuk-model-fixture' }) }));
    await page.route(RAW_RE, route => {
      const match = RAW_RE.exec(route.request().url());
      const relative = decodeURIComponent(match[1]);
      const local = path.resolve(ROOT, relative);
      if (!local.startsWith(DOCS + path.sep) || !fs.existsSync(local) || !fs.statSync(local).isFile()) {
        return route.fulfill({ status: 404, body: 'Missing checkout asset ' + relative });
      }
      const mime = local.endsWith('.js') ? 'application/javascript'
        : local.endsWith('.json') ? 'application/json'
        : local.endsWith('.png') ? 'image/png'
        : local.endsWith('.glb') ? 'model/gltf-binary' : 'application/octet-stream';
      return route.fulfill({ status: 200, contentType: mime, body: fs.readFileSync(local) });
    });
    await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForFunction(() => window.MultiAvatarAnimationAuthor?.__primateModelProbe?.().loaded,
      null, { timeout: 120000 });
    let ready = false;
    try {
      await page.waitForFunction(() => {
        const result = window.MultiAvatarAnimationAuthor?.__primateModelProbe?.();
        return result?.handGlbLoaded && result?.footGlbLoaded;
      }, null, { timeout: 25000 });
      ready = true;
    } catch (_) {
      // Report both model load states and URL/status failures without requiring browser devtools.
    }
    const probe = await page.evaluate(() => window.MultiAvatarAnimationAuthor.__primateModelProbe());
    assert(ready, 'Primate GLBs never replaced the placeholders: ' +
      JSON.stringify({ probe, modelResponses, errors }).slice(0, 9000));
    assert.equal(probe.species, 'nohuknuk');
    assert.equal(probe.isBipedal, true);
    assert.equal(probe.neckImplementation, 'creature-painted-neck');
    assert.equal(probe.handProfileKey, 'primate');
    assert.equal(probe.handState?.loadError, null);
    assert.equal(probe.handState?.glb, 'assets/models/hands/hand_primate.glb');
    assert.equal(probe.footConfig?.glb, 'assets/models/feet/foot_primate.glb');
    assert(probe.footMeshes.some(name => name.includes('foot_primate_claws')));
    assert(probe.handMeshes.some(name => name.includes('hand_primate_claws')));
    assert(modelResponses.some(response => response.status === 200 &&
      response.url.includes('hand_primate.glb')), 'hand GLB was never successfully requested');
    assert(modelResponses.some(response => response.status === 200 &&
      response.url.includes('foot_primate.glb')), 'foot GLB was never successfully requested');
    console.log('Nohuknuk existing Shoulder Rig: both real primate GLB pairs loaded; no placeholder geometry remains.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
