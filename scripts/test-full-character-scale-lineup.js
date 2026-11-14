'use strict';
const assert = require('node:assert/strict'); // Checks representative identity and database isolation.
const fs = require('node:fs'); // Loads the shipping comparison code and authored NPC database.
const vm = require('node:vm'); // Executes the private representative selector without WebGL.
const source = fs.readFileSync('docs/js/character-scale-comparison.js', 'utf8'); // Shipping implementation under test.
const db = JSON.parse(fs.readFileSync('docs/config/npcs/hobunji-starter-npc-database.json', 'utf8')); // Real authored NPCs, including both Mashtzarr genders and Tletingan donors.
const original = JSON.stringify(db); // Detects accidental mutation of world NPCs.
const uiNodes = new Map(); // Allows private selection/frame handlers to be exercised without a browser.
let uiEnabled = false; // Prevents the comparison panel from installing during initial test source evaluation.
const getUiNode = id => { // Supplies stable minimal inputs and buttons for editor-camera isolation tests.
  if (!uiNodes.has(id)) uiNodes.set(id, { id, value: '', hidden: false, disabled: false, textContent: '', setAttribute() {}, closest() { return { hidden: false }; } });
  return uiNodes.get(id);
};
const window = { HOBUNJI_ATTACHMENT_RIG_PROFILES: { characters: {} } }; // Supplies independently registered species/gender profiles as the runtime does.
for (const species of ['tletingan', 'nuhongan', 'longoran', 'mashtzarr']) {
  for (const gender of ['male', 'female']) {
    window.HOBUNJI_ATTACHMENT_RIG_PROFILES.characters[`${species}::${gender}`] = { species, gender };
  }
}
const context = vm.createContext({ // Minimal browser globals; test-only injection exposes the private selection path.
  window, URL, console,
  location: { pathname: '/tools/animation-author/index.html', href: 'https://example.test/tools/animation-author/index.html' },
  document: { getElementById(id) { return uiEnabled ? getUiNode(id) : null; } },
  setInterval() { return 1; },
  setTimeout() { return 1; },
  clearTimeout() {},
  fetch: async () => ({ ok: true, json: async () => db }),
});
vm.runInContext(source.replace('  install();\n})();', `  window.testLineup = { representatives, portraitExportFor };
  window.testFocusControl = {
    configure() { active = true; THREE = {}; previewRoot = {}; },
    select, focusSelected, frame, applyLongoranSliders, applyBodyHeadSliders, applyAgeSlider,
    get focusKey() { return focusedEntryKey; },
  };
})();`), context);
(async () => {
  const lineup = await window.testLineup.representatives(); // Exercises the same selector used by buildLineup.
  for (const species of ['nuhongan', 'longoran', 'mashtzarr']) {
    for (const gender of ['male', 'female']) {
      const entry = lineup.find(item => item.key === `${species}::${gender}`); // Checks all four requested independent entries.
      assert(entry?.npc, `${species} ${gender} must have a renderable representative`);
      assert.equal(window.testLineup.portraitExportFor(entry.npc).appearance.speciesId, species);
      assert.equal(window.testLineup.portraitExportFor(entry.npc).appearance.gender, gender);
      if (species === 'nuhongan' || species === 'longoran') assert.equal(entry.npc.id, `full_scale_${species}_${gender}_preview`);
      else assert(db.npcs.includes(entry.npc), 'Mashtzarr should retain authored representatives');
    }
  }
  assert.equal(JSON.stringify(db), original, 'preview clones must not modify shipping NPC records');
  const authored = JSON.parse(JSON.stringify(lineup.find(item => item.key === 'nuhongan::male').npc)); // Simulates a future authored Nuhongan NPC superseding the fallback.
  authored.id = 'authored_nuhongan';
  db.npcs.push(authored);
  assert.equal((await window.testLineup.representatives()).find(item => item.key === 'nuhongan::male').npc.id, authored.id);
  for (const key of ['Hunch','Kyphosis']) {
    assert(source.includes(`maaLongoranRange${key}`) || source.includes(`longoranRow('${key}'`), `Longoran ${key} must have an authoring control`);
  }
  for (const key of ['Sway','Lurch','Cadence','Stance','DragLift']) {
    assert(!source.includes(`longoranRow('${key}'`), `Longoran ${key} should not add controls beyond Enemy Loadout Editor`);
  }
  assert(!source.includes('maaLongoranDragSide'), 'Maskbound drag side must not be an extra posture setting');
  assert(source.includes('spine[info.field] = percent / 100'), 'UI percentages must round-trip to 0-1 spine tuning');
  assert(source.includes('setAuthorTuning?.(selected.gender, { spine })'), 'only spine edits are written, preserving gait');
  assert(source.includes("maaFullScaleFocus") && source.includes("addEventListener('click', focusSelected)"), 'the selected-character camera focus must be an explicit, wired-up button');
  assert(!source.includes('longoranFocused') && !source.includes('frameLongoran()'), 'selection and slider changes must never force automatic Longoran framing');
  const panelHtmlStart = source.indexOf('<div class="scaleHead"><b>Full character scale</b>'); // Locates the actual template rather than accepting controls that only exist in JavaScript.
  const panelHtmlEnd = source.indexOf('<div id="maaFullScaleStatus"', panelHtmlStart);
  const panelHtml = source.slice(panelHtmlStart, panelHtmlEnd); // Full UI in rendered order: the spine must come before the body sliders.
  assert(panelHtmlStart >= 0 && panelHtmlEnd > panelHtmlStart, 'the comparison editor must have a renderable panel');
  assert(panelHtml.indexOf('maaFullScaleLongoranControls') > 0 && panelHtml.indexOf('maaFullScaleLongoranControls') < panelHtml.indexOf("scaleRow('X'"), 'hunch/kyphosis controls must be first in the panel so small screens cannot hide them below body scales');
  assert(!source.includes('max-height:32vh;overflow:auto'), 'remove the nested clipped scroll container that hid Longoran hunch inputs');
  assert(source.includes('Rig Coordinates → Species proportions'), 'point users to the existing canonical arm length offset instead of inventing a different arm scale control');
  assert.match(source, /<select id="maaFullScaleChoose"/, 'the character chooser must actually exist in the panel HTML, not only in the background option builder');
  assert.match(source, /querySelector\('#maaFullScaleChoose'\)\.addEventListener\('change'/, 'the chooser must select the entry the user picked');
  assert.match(source, /if \(!manualViewInteraction\) frame\(\)/, 'initial lineup auto-fit occurs only when no user input has already changed the view');
  assert.match(source, /panel\.addEventListener\('pointerdown',.*manualViewInteraction/, 'touching Reset all or other controls must prevent a surprise final auto-fit');
  const cameraFrames = []; // Capture only intentional camera reset requests from the actual private handlers.
  window.HobunjiFullScaleEditorPresentation = { frameOrthographic(...args) { cameraFrames.push(args); } };
  uiEnabled = true;
  window.testFocusControl.configure();
  const longoran = { key: 'longoran::male', species: 'longoran', gender: 'male', group: {}, profile: { anatomy: {} }, npc: { id: 'demo_longoran' } };
  const nuhongan = { key: 'nuhongan::female', species: 'nuhongan', gender: 'female', group: {}, profile: { anatomy: {} }, npc: { id: 'demo_nuhongan' } };
  window.testFocusControl.select(longoran);
  assert.equal(getUiNode('maaFullScaleChoose').value, longoran.key, 'selecting the Longoran must sync the visible character dropdown');
  assert.equal(cameraFrames.length, 0, 'choosing a Longoran must not move the camera');
  assert.equal(getUiNode('maaFullScaleFocus').disabled, false, 'a valid selection enables the Focus selected button');
  window.testFocusControl.applyLongoranSliders();
  window.testFocusControl.applyBodyHeadSliders();
  window.testFocusControl.applyAgeSlider();
  assert.equal(cameraFrames.length, 0, 'editing posture, body/head scale, and NPC hunch must never reframe the camera');
  window.testFocusControl.focusSelected();
  assert.equal(window.testFocusControl.focusKey, longoran.key, 'Focus selected must lock onto the specific Longoran');
  assert.equal(cameraFrames.length, 1, 'Focus selected explicitly requests one camera frame');
  window.testFocusControl.select(nuhongan);
  assert.equal(getUiNode('maaFullScaleChoose').value, nuhongan.key, 'tapping another portrait must keep the chooser synchronized');
  assert.equal(window.testFocusControl.focusKey, longoran.key, 'editing another character cannot silently retarget the focused camera');
  assert.equal(cameraFrames.length, 1, 'selection does not alter camera angle, placement or zoom');
  window.testFocusControl.focusSelected();
  assert.equal(window.testFocusControl.focusKey, nuhongan.key, 'Focus selected must work for species besides Longoran');
  assert.equal(cameraFrames.length, 2);
  window.testFocusControl.frame();
  assert.equal(window.testFocusControl.focusKey, null, 'Frame lineup clears the explicit character focus');
  assert.equal(cameraFrames.length, 3, 'Frame lineup explicitly requests exactly one reset');
  assert(source.includes('spinePreviewApplied'), 'missing spline deformation is reported in mobile debug');
  assert(source.includes('applyLongoranSliders'), 'Authoring controls must apply tuning, not be decorative');
  assert(source.includes('rebuildLongoranFeet'), 'Gait changes must rebuild the existing real foot solver');
  assert(source.includes('exportLongoranTuning'), 'Longoran tunings must be exportable');
  assert.match(source, /reps\.filter\(item => item\.species === 'longoran'\)/, 'Longoran should become available before the remaining slow species previews'); // Prioritize authoring without dropping any other species.
  assert.match(source, /buildPreviewEntry\(rep, buildId\)/, 'progressive builds must carry the cancellation generation');
  assert.match(source, /if \(buildId !== generation \|\| !previewRoot\) return null;/, 'an exited editor must not attach a stale avatar after image loading');
  assert.match(source, /active = true; \/\/ The first Longoran becomes tweakable/, 'the author must unlock before the entire lineup finishes');
  assert.match(source, /portraitLoading: window\.__portraitPixelCacheDebug/, 'mobile preview must expose real image-load diagnostics');
  console.log('Full Character Scale Longoran, Nuhongan and Mashtzarr lineup checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
