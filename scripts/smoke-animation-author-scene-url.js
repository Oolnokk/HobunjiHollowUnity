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
    // Test-only hook, inserted into the served HTML but NEVER committed to the
    // editor: simulate a differently sized spouse without exporting a fake NPC.
    const authorHtml = fs.readFileSync(path.join(DOCS, 'tools/animation-author/index.html'), 'utf8');
    const authorMarker = 'window.MultiAvatarAnimationAuthor.fullBodyDiagnostics = fullCharacterPreviewDiagnosticsV1548;';
    if (!authorHtml.includes(authorMarker)) throw Error('Animation author no longer exposes the full-body diagnostics anchor');
    const instrumentedHtml = authorHtml.replace(authorMarker, authorMarker + `
      window.MultiAvatarAnimationAuthor.__testScaleNpcAndRebuildKiss = (npcId, fraction) => {
        const actor = animationAuthor.actors.find(entry => entry.source?.id === npcId);
        if (!actor) throw Error('NPC was not loaded: ' + npcId);
        actor.visualOffset.scale.setScalar(fraction); // Scales the real hands, portrait, legs and pants together.
        const initiator = actorById(animationAuthor.kissInitiatorActorIdV1550);
        if (initiator) selectAnimationActor(initiator.id); // Preserve leader identity when rebuilding the preset.
        return applyKissPresetV1546();
      };
    `);
    await page.route('**/tools/animation-author/index.html**', route =>
      route.fulfill({ status: 200, contentType: 'text/html', body: instrumentedHtml }));
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
      // The original bug: a constant 180° Y-facing kiss turned into a
      // 180° X + 180° Z Euler representation between animation keys. The
      // full-body preview then cleared X for the legs, visually rolling Leaf
      // upside down and leaving him facing the wrong direction.
      const scrubber = document.getElementById('maaScrubber');
      const samples = [0, .10, .21, .30, .48, .70, .82, 1.02, 1.12, 1.52, 1.72, 1.95, 2.19, 2.40]; // Regression frame positions, not just keyframe endpoints.
      const facingSamples = []; // Collected for mobile-friendly CI diagnostics when a particular frame fails.
      for (const t of samples) {
        scrubber.value = String(t);
        scrubber.dispatchEvent(new Event('input', { bubbles: true }));
        const poses = api.kissFacingDiagnostics?.();
        const leaf = poses?.find(actor => actor.name === 'Leaf');
        const pahu = poses?.find(actor => actor.name === 'Pahu');
        if (!leaf || !pahu) throw Error('Missing character facing diagnostics at ' + t);
        facingSamples.push({ t, leaf: leaf.rootRotationDeg, portraitUpY: leaf.portraitUpY });
        if (leaf.worldUpY < .98 || leaf.portraitUpY < .90) {
          throw Error('Leaf flips upside down at t=' + t + ': ' + JSON.stringify(leaf));
        }
        if (Math.abs(leaf.rootRotationDeg.x) > 1 || Math.abs(leaf.rootRotationDeg.z) > 1) {
          throw Error('Leaf root has unintended X/Z inversion at t=' + t + ': ' + JSON.stringify(leaf));
        }
        if (Math.abs(Math.abs(leaf.rootRotationDeg.y) - 180) > 2) {
          throw Error('Leaf reversed his face-to-face yaw at t=' + t + ': ' + JSON.stringify(leaf));
        }
        if (Math.abs(pahu.rootRotationDeg.x) > 1 || Math.abs(pahu.rootRotationDeg.z) > 1) {
          throw Error('Pahu acquired an upside-down root rotation at t=' + t + ': ' + JSON.stringify(pahu));
        }
      }
      const seek = t => { // Scrub and let both partners' existing rig code sample the exact timeline time.
        scrubber.value = String(t);
        scrubber.dispatchEvent(new Event('input', { bubbles: true }));
        return api.fullBodyDiagnostics();
      };
      const early = seek(.37);
      const earlyInitiator = early.find(actor => actor.name === 'Pahu');
      const earlyTall = early.find(actor => actor.name === 'Leaf');
      if (!earlyInitiator?.initiatorHands?.applied || earlyInitiator.initiatorHands.blend < .85) {
        throw Error('Pahu must attach both hands toward Leaf shoulders before she kneels: ' + JSON.stringify(early));
      }
      if (earlyInitiator.initiatorHands.unreachableSurfaces > 0 ||
          earlyInitiator.initiatorHands.hands !== 2) {
        throw Error('Short initiator hands must touch actual reachable upper-body surfaces, not float in air: ' +
          JSON.stringify(earlyInitiator));
      }
      if (earlyTall?.kneeDrop > .001) {
        throw Error('Leaf kneels before shorter Pahu places his hands on shoulders: ' + JSON.stringify(early));
      }
      const leafInspectorId = actors.find(actor => actor.source.id === 'leaf')?.id;
      const pahuInspectorId = actors.find(actor => actor.source.id === 'pahu')?.id;
      api.selectActor(leafInspectorId); // Selecting the recipient must NOT change the authored initiator or swap the kneeling participant.
      const afterInspectorSwitch = seek(.37);
      if (api.kissPairDiagnostics?.().initiator !== 'pahu' ||
          !afterInspectorSwitch.find(actor => actor.name === 'Pahu')?.initiatorHands?.applied ||
          afterInspectorSwitch.find(actor => actor.name === 'Leaf')?.kneeDrop > .001) {
        throw Error('Inspector selection silently switched kiss initiator/shorter-first choreography: ' +
          JSON.stringify({ pair: api.kissPairDiagnostics?.(), bodies: afterInspectorSwitch }));
      }
      api.selectActor(pahuInspectorId);
      const afterLowering = seek(.78);
      if (!(afterLowering.find(actor => actor.name === 'Leaf')?.kneeDrop > .005)) {
        throw Error('Leaf never kneels after the initiator shoulder grasp: ' + JSON.stringify(afterLowering));
      }
      const afterContact = seek(1.12);
      if (!afterContact.find(actor => actor.name === 'Pahu')?.initiatorHands?.applied) {
        throw Error('Initiator wrist anchors must follow the spouse shoulders during contact: ' + JSON.stringify(afterContact));
      }
      scrubber.value = '0';
      scrubber.dispatchEvent(new Event('input', { bubbles: true })); // Reset to the intended kiss opening before testing walking gait.
      const project = api.exportProject();
      const initialPair = api.kissPairDiagnostics?.(); // Ensures initiator/partner anatomy does not silently swap when applying a new preset.
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
      let walked = false; // Tracks real authored approach speed, not a fake continuous idle-leg animation.
      for (let frame = 0; frame < 69; frame++) {
        api.tick(1 / 60);
        walked ||= api.fullBodyDiagnostics().some(body => body.preview?.gaitSpeed > .01);
      }
      if (!walked) throw Error('Approach root motion never animated the procedural gait');
      const contactBodies = api.fullBodyDiagnostics();
      if (contactBodies.some(body => !body.handRig || !body.feet || !body.pants)) {
        throw Error('Missing hands, feet, or equipped pants during the kiss: ' + JSON.stringify(contactBodies));
      }
      if (contactBodies.some(body => body.preview.feetGrounded !== true)) {
        throw Error('An avatar root is pitching or sinking the procedural soles: ' + JSON.stringify(contactBodies));
      }
      if (!contactBodies.some(body => body.kneeDrop > 0)) {
        throw Error('The taller NPC must fold their knees at contact: ' + JSON.stringify(contactBodies));
      }
      if (contactBodies.some(body => !body.preview?.feetGrounded)) {
        throw Error('Kiss rotated or sank the actual planted feet: ' + JSON.stringify(contactBodies));
      }
      if (!contactBodies.some(body => body.preview?.torsoBowDegrees > 1)) {
        throw Error('Tall torso did not bow independently of grounded legs: ' + JSON.stringify(contactBodies));
      }
      for (let frame = 69; frame < 150; frame++) api.tick(1 / 60);
      const again = api.exportProject();
      const finishedBodies = api.fullBodyDiagnostics();
      if (finishedBodies.some(body => body.kneeDrop > 0.0001 || Math.abs(body.preview?.torsoBowDegrees || 0) > .01)) {
        throw Error('Both actors must recover their knee and torso rest poses: ' + JSON.stringify(finishedBodies));
      }
      if (again.project.relationshipPreset !== 'kiss') throw Error('Kiss changed during preview');
      const feetAtFinish = api.fullBodyDiagnostics(); // Used to verify no lingering shoulder grip remains after the one-shot.
      if (feetAtFinish.find(actor => actor.name === 'Pahu')?.initiatorHands?.blend > .001) {
        throw Error('Pahu hands remained locked to shoulders after the kiss released: ' + JSON.stringify(feetAtFinish));
      }
      // Reverse the initiator without loading another scene: Leaf is now the
      // taller initiator and may grip Pahu's shoulders only when his own torso
      // has lowered far enough to fit his real arm lengths.
      const leafActorId = actors.find(actor => actor.source.id === 'leaf')?.id;
      api.selectActor(leafActorId);
      if (!api.applyKissPreset?.()) throw Error('Could not rebuild the taller-initiator kiss');
      const reversePair = api.kissPairDiagnostics?.();
      const reverseProject = api.exportProject();
      const reverseActorSink = reverseProject.actors.map(actor => ({
        name: actor.source?.name, id: actor.source?.id, sink: actor.kissBodySinkPctAtContact,
      })); // Clear browser diagnostics before asserting that the newly selected initiator is the tall one.
      const tallerInitiator = [];
      for (const t of [0, .13, .25, .37, .52, .67, .82, 1.12, 1.52, 2.4]) {
        const bodies = seek(t);
        tallerInitiator.push({ t, leafHands: bodies.find(actor => actor.name === 'Leaf')?.initiatorHands || null,
          leafKnee: bodies.find(actor => actor.name === 'Leaf')?.kneeDrop || 0 });
      }
      return {
        actors: actors.map(a => ({ id: a.source.id, label: a.label })),
        preset: project.project.relationshipPreset,
        clipDuration: project.project.durationSeconds,
        keyframes: project.actors.map(a => a.keyframes.length),
        exportable: again.actors.length === 2,
        fullBodiesAtContact: contactBodies,
        facingSamples,
        shoulderGripEarly: earlyInitiator.initiatorHands,
        shoulderGripAtContact: afterContact.find(actor => actor.name === 'Pahu')?.initiatorHands,
        tallerInitiator,
        initialPair,
        reversePair,
        reverseActorSink,
        copiedUrlValid: true,
        genericUrlValid: true,
        status: document.getElementById('statusPill')?.textContent || '',
      };
    });
    await page.waitForTimeout(1000); // Catch idle renderer errors from real Three.js.
    assert.equal(errors.length, 0, errors.join('\n\n'));
    assert.ok(result.exportable);
    console.log('Multi-avatar scene URL PASS:', JSON.stringify(result));

    // A fresh explicit URL with the tall character first tests the OTHER
    // choreography branch without inheriting transforms from the first clip.
    await page.goto(PAGE.replace('?scene=pahu-leaf-kiss', '?actors=leaf,pahu&preset=kiss'), {
      waitUntil: 'domcontentloaded', timeout: 35000,
    });
    await page.waitForFunction(() => window.MultiAvatarAnimationAuthor?.getActors?.().length === 2 &&
      document.getElementById('maaPresetSelect')?.value === 'kiss', null, { timeout: 120000 });
    const tallerFirst = await page.evaluate(() => {
      const api = window.MultiAvatarAnimationAuthor;
      const pair = api.kissPairDiagnostics?.();
      const slider = document.getElementById('maaScrubber');
      const frames = [];
      for (const t of [0, .13, .25, .37, .52, .67, .82, 1.12, 2.4]) {
        slider.value = String(t);
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        const leaf = api.fullBodyDiagnostics().find(actor => actor.name === 'Leaf');
        frames.push({ t, handBlend: leaf?.initiatorHands?.blend || 0,
          reachGap: leaf?.initiatorHands?.closestGap || 0, knee: leaf?.kneeDrop || 0 });
      }
      return { pair, frames };
    });
    if (tallerFirst.pair?.initiator !== 'leaf') {
      throw Error('Reverse URL did not select Leaf as the explicit initiator: ' + JSON.stringify(tallerFirst));
    }
    console.log('Kiss reversed-role height and shoulder reach:', JSON.stringify(tallerFirst));

    // Pahu at half-size is deliberately beyond the normal kneeling-only
    // range. Test the actual procedural leg IK, not merely the math solver.
    const jumpPreview = await page.evaluate(() => {
      const api = window.MultiAvatarAnimationAuthor;
      if (!api.__testScaleNpcAndRebuildKiss('pahu', .5)) throw Error('Rescaled kiss preset could not be rebuilt');
      const pair = api.kissPairDiagnostics();
      if (!pair.posteriorJump || pair.jumpWorld <= .01) throw Error('A 2x taller spouse must select the posterior-supported hop: ' + JSON.stringify(pair));
      const slider = document.getElementById('maaScrubber');
      const frames = [];
      for (const t of [0, .37, .52, .67, .82, 1.02, 1.12, 1.52, 1.85, 2.25, 2.4]) {
        slider.value = String(t);
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        const all = api.fullBodyDiagnostics();
        const jumper = all.find(actor => actor.name === 'Pahu');
        const standing = all.find(actor => actor.name === 'Leaf');
        frames.push({ t, jump: jumper?.preview.jumpHeightWorld || 0,
          feetAnchored: !!jumper?.preview.jumpFeetAnchored,
          footSeparation: jumper?.preview.jumpFootDistance || 0,
          knee: standing?.kneeDrop || 0, pants: jumper?.pants, arms: jumper?.handRig });
        if (!jumper?.pants || !jumper?.feet || !standing?.feet) {
          throw Error('Missing actual feet/pants in jump: ' + JSON.stringify(all));
        }
        if (t === 1.12) {
          if (!jumper.preview.jumpFeetAnchored || jumper.preview.jumpHeightWorld < pair.jumpWorld * .95 ||
              jumper.preview.jumpFootDistance <= .005) {
            throw Error('Shorter partner does not plant both feet around the taller posterior at contact: ' + JSON.stringify(all));
          }
          if (jumper.preview.feetGrounded) throw Error('Jumping spouse incorrectly diagnosed as grounded');
        }
        if (t === 2.4 && (jumper.preview.jumpHeightWorld > .0001 || jumper.preview.jumpFeetAnchored)) {
          throw Error('Jump did not recover to the floor: ' + JSON.stringify(all));
        }
      }
      const exported = api.exportProject();
      if (!exported.project?.kiss?.posteriorJump?.enabled ||
          !exported.actors.some(actor => actor.keyframes?.some(key => key.jumpLiftWorld > .01))) {
        throw Error('Export did not preserve the posterior jump and vertical lift: ' + JSON.stringify(exported.project?.kiss));
      }
      return { pair, frames, exportedJump: exported.project.kiss.posteriorJump };
    });
    console.log('Height-adaptive posterior-straddle jump PASS:', JSON.stringify(jumpPreview));

    // Repeat with the shortened Pahu as INITIATOR. Early hand gestures must
    // precede Leaf's knee bend even when a later hop is needed to reach lips.
    const shortInitiatorHop = await page.evaluate(() => {
      const api = window.MultiAvatarAnimationAuthor;
      const pahu = api.getActors().find(actor => actor.source.id === 'pahu');
      api.selectActor(pahu.id);
      if (!api.applyKissPreset()) throw Error('Could not rebuild a short-initiator jump kiss');
      const pair = api.kissPairDiagnostics();
      if (pair.initiator !== 'pahu' || pair.taller !== 'second' || !pair.posteriorJump) {
        throw Error('Height-adaptive kiss lost the intended short initiator: ' + JSON.stringify(pair));
      }
      const slider = document.getElementById('maaScrubber');
      const seek = t => {
        slider.value = String(t);
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        return api.fullBodyDiagnostics();
      };
      const early = seek(.37);
      if (early.find(actor => actor.name === 'Leaf')?.kneeDrop > .001) {
        throw Error('Tall recipient knelt before the short initiator reached up: ' + JSON.stringify(early));
      }
      const contact = seek(1.12);
      if (!contact.find(actor => actor.name === 'Pahu')?.preview.jumpFeetAnchored ||
          !(contact.find(actor => actor.name === 'Leaf')?.kneeDrop > .005)) {
        throw Error('Short initiator never reached the posterior-supported kiss: ' + JSON.stringify(contact));
      }
      const finished = seek(2.4);
      if (finished.find(actor => actor.name === 'Pahu')?.preview.jumpFeetAnchored) {
        throw Error('Short initiator did not put both feet back on the floor');
      }
      return { pair, handsBeforeKneel: early.find(actor => actor.name === 'Pahu')?.initiatorHands,
        contact: contact.find(actor => actor.name === 'Pahu')?.preview };
    });
    console.log('Shorter initiator posterior hop PASS:', JSON.stringify(shortInitiatorHop));
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
