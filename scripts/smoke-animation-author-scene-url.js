'use strict';
// Real Chromium integration for shareable animation scene URLs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const PAGE = 'http://127.0.0.1:8000/tools/animation-author/index.html?scene=pahu-leaf-kiss&ref=scene-smoke-fixture';
const ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const RAW_RE = /^https:\/\/raw\.githubusercontent\.com\/Oolnokk\/HobunjiHollowUnity\/[^/]+\/(.+)$/;
async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 980, height: 620 }, hasTouch: true, isMobile: true });
  const errors = [];
  const failures = [];
  page.on('pageerror', e => errors.push(e.stack || String(e)));
  page.on('requestfailed', r => failures.push(r.url() + ': ' + r.failure()?.errorText));
  try {
    await page.route('https://api.github.com/repos/Oolnokk/HobunjiHollowUnity/commits/**', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sha: 'scene-smoke-fixture' }) }));
    await page.route(RAW_RE, route => {
      const match = RAW_RE.exec(route.request().url());
      const relative = decodeURIComponent(match[1]);
      const local = path.resolve(ROOT, relative);
      if (!local.startsWith(DOCS + path.sep) || !fs.existsSync(local) || !fs.statSync(local).isFile())
        return route.fulfill({ status: 404, body: 'Missing checkout asset ' + relative });
      const mime = local.endsWith('.json') ? 'application/json' : local.endsWith('.js') ? 'application/javascript'
        : local.endsWith('.png') ? 'image/png' : local.endsWith('.html') ? 'text/html' : 'application/octet-stream';
      return route.fulfill({ status: 200, contentType: mime, body: fs.readFileSync(local) });
    });
    await page.addInitScript(() => {
      // Explicit URL must win over even a broken previously saved project.
      localStorage.setItem('hobunjiMultiAvatarAnimationAuthor.project.v1',
        JSON.stringify({ schema: 'hobunji.multi-avatar-animation.v8', actors: [{ id: 'stale-autosave' }] }));
    });
    await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForFunction(() => window.MultiAvatarAnimationAuthor?.getActors?.().length === 2 &&
      document.getElementById('maaPresetSelect')?.value === 'kiss', null, { timeout: 120000 });
    const result = await page.evaluate(() => {
      const api = window.MultiAvatarAnimationAuthor;
      const actors = api.getActors();
      if (actors.map(x => x.source.id).join(',') !== 'pahu,leaf') throw Error('Wrong NPCs/order');
      if (document.body.dataset.animationAuthorMode !== 'multi') throw Error('Wrong tab');
      const share = new URL(api.getSceneLink());
      const restoredUrlScene = api.parseSceneUrl(share.search);
      if (restoredUrlScene.actorIds.join(',') !== 'pahu,leaf' || restoredUrlScene.preset !== 'kiss') {
        throw Error('Copy scene link does not round-trip the actors and kiss preset');
      }
      if (share.searchParams.get('ref') !== 'scene-smoke-fixture') throw Error('Share URL lost the exact tested runtime ref');
      const generic = api.parseSceneUrl('?actors=pahu,leaf&preset=kiss&t=1.12');
      if (generic.actorIds.join(',') !== 'pahu,leaf' || generic.time !== 1.12 || generic.preset !== 'kiss') {
        throw Error('General URL scene format is not recognized');
      }
      document.getElementById('maaPresetSelect').dispatchEvent(new Event('change', { bubbles: true }));
      if (/undefined preset/i.test(document.getElementById('statusPill')?.textContent || '')) {
        throw Error('Legacy preset-label bug is still present');
      }
      const project = api.exportProject();
      const initialBodies = api.fullBodyDiagnostics?.() || [];
      if (initialBodies.length !== 2 || initialBodies.some(body => !body.feet)) {
        throw Error('Both Pahu and Leaf must show real gameplay leg/foot rigs: ' + JSON.stringify(initialBodies));
      }
      if (!window.ProceduralHandFrameDriver?.syncNow || !window.PantsGarmentRenderer?.attachToLegs) {
        throw Error('Gameplay hand and pants modules were not loaded');
      }
      if (!project.actors || project.actors.length !== 2 || project.project.relationshipPreset !== 'kiss')
        throw Error('Scene did not persist a valid kiss clip');
      if (project.project.loop !== false || project.project.durationSeconds !== 2.4)
        throw Error('Kiss must be a 2.4-second one-shot');
      if (project.actors.some(actor => actor.keyframes.length < 6)) throw Error('Kiss clip has missing keyframes');
      document.getElementById('maaPlayBtn').click(); // The URL intentionally opens paused for editing; tests must actually start playback.
      for (let frame = 0; frame < 69; frame++) api.tick(1 / 60);
      const contactBodies = api.fullBodyDiagnostics();
      if (contactBodies.some(body => !body.handRig || !body.feet || !body.pants)) {
        throw Error('Missing hands, feet, or equipped pants during the kiss: ' + JSON.stringify(contactBodies));
      }
      if (!contactBodies.some(body => body.kneeDrop > 0)) {
        throw Error('The taller NPC must fold their knees at contact: ' + JSON.stringify(contactBodies));
      }
      for (let frame = 69; frame < 150; frame++) api.tick(1 / 60);
      const again = api.exportProject();
      const finishedBodies = api.fullBodyDiagnostics();
      if (finishedBodies.some(body => body.kneeDrop > 0.0001)) {
        throw Error('Both actors should stand normally after the kiss: ' + JSON.stringify(finishedBodies));
      }
      if (again.project.relationshipPreset !== 'kiss') throw Error('Kiss changed during preview');
      return {
        actors: actors.map(a => ({ id: a.source.id, label: a.label })),
        preset: project.project.relationshipPreset,
        clipDuration: project.project.durationSeconds,
        keyframes: project.actors.map(a => a.keyframes.length),
        exportable: again.actors.length === 2,
        fullBodiesAtContact: contactBodies,
        copiedUrlValid: true,
        genericUrlValid: true,
        status: document.getElementById('statusPill')?.textContent || '',
      };
    });
    await page.waitForTimeout(1000); // Catch idle renderer errors from real Three.js.
    assert.equal(errors.length, 0, errors.join('\n\n'));
    assert.ok(result.exportable);
    console.log('Multi-avatar scene URL PASS:', JSON.stringify(result));
  } catch (error) {
    let snapshot;
    try {
      snapshot = await page.evaluate(() => ({
        status: document.getElementById('statusPill')?.textContent || '',
        actors: window.MultiAvatarAnimationAuthor?.getActors?.() || null,
        logs: document.getElementById('debugLog')?.textContent?.slice(-10000) || null,
      }));
    } catch (_) { snapshot = { pageNotReadable: true }; }
    console.error('Animation URL smoke FAILED:', error.stack || error);
    console.error('Author diagnostics:', JSON.stringify(snapshot));
    console.error('JS errors:', errors.slice(0, 15).join('\n\n'));
    console.error('Request failures:', failures.slice(-15).join('\n'));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
