'use strict';
// Central x-ray hierarchy: the config module (defaults, live set/get, diff, export/import, dev-companion panel)
// and the renderer wiring that consumes it, including the executed "hand behind its front plane" test.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', 'docs');
const cfgSource = fs.readFileSync(path.join(root, 'js', 'xray-hierarchy.js'), 'utf8');
const render = fs.readFileSync(path.join(root, 'js', 'held-object-render-order.js'), 'utf8');

const store = {};
const panels = [];
let floorPunchTestEnabled = true; // Captures mobile A/B toggle changes in the fake renderer.
const win = {
  DevCompanion: { registerPanel: spec => { panels.push(spec); return true; } },
  HeldObjectRenderOrder: {
    snapshot: () => ({ rankedPortraitActors: 2, frontPortraitMasks: 1, handsBehindFrontPlane: 1, stencilBits: 8,
      frontPortraitGearCandidates: 3, frontPortraitMaskedGear: 2, forcedGroundDepthMaterials: 3,
      elevationShaderFallbacks: 0, xrayOrdinaryMeshes: 5,
      floorPunch: { enabled: floorPunchTestEnabled, punches: 12, fallbacks: 2 } }),
    setFloorPunchEnabled(value) { floorPunchTestEnabled = value !== false; return floorPunchTestEnabled; },
  },
  __hobunjiGameStarted: true,
};
global.window = win;
global.localStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } };
new Function(cfgSource)();
const X = win.XrayHierarchy;
assert.ok(X && X.version === 1, 'module registers window.XrayHierarchy');
assert.strictEqual(X.get('weapon.frontPlaneMask'), 'off', 'owner portrait weapon stencil is opt-in by default');

// Defaults, validation, live change, listeners.
assert.strictEqual(X.get('hand.frontPlaneMask'), 'off', 'hands are not masked by owner front art by default');
assert.strictEqual(X.get('actors.order'), 'all');
assert.strictEqual(X.get('feet.groundXray'), 'off', 'geometrically grounded feet and pants use ordinary depth by default');
assert.strictEqual(X.get('layers.manualOrder'), 'off');
assert.strictEqual(X.get('background.gearDepth'), 'ignore');
assert.strictEqual(X.get('airborne.rebuildDepth'), 'on');
assert.strictEqual(X.get('weapon.followHandLayer'), 'on', 'weapons inherit their gripping hand priority by default');
assert.strictEqual(X.get('shoulderPet.presentation'), undefined, 'shoulder pet occlusion is fixed, not a configurable x-ray mode');
assert.strictEqual(X.set('shoulderPet.presentation', 'world-depth'), false, 'old pet presets cannot override owner portrait stages');
let heard = null;
X.onChange((k, v, prev) => { heard = [k, v, prev]; });
assert.strictEqual(X.set('hand.frontPlaneMask', 'bogus'), false, 'rejects values outside the rule options');
assert.strictEqual(X.set('no.such.rule', 'on'), false, 'rejects unknown rules');
assert.strictEqual(X.set('hand.frontPlaneMask', 'behind'), true);
assert.deepStrictEqual(heard, ['hand.frontPlaneMask', 'behind', 'off'], 'listeners hear live changes');
assert.strictEqual(X.get('hand.frontPlaneMask'), 'behind');

// Diff / export / import round trip, persistence of changes only.
assert.deepStrictEqual(X.diff(), { 'hand.frontPlaneMask': { from: 'off', to: 'behind' } });
const exported = JSON.parse(X.exportDiff());
assert.deepStrictEqual(exported.xrayHierarchy.changes, X.diff());
assert.strictEqual(exported.xrayHierarchy.effective['actors.order'], 'all', 'export lists the full effective hierarchy');
assert.deepStrictEqual(JSON.parse(store['hobunji.xrayHierarchy.v1']), { 'hand.frontPlaneMask': 'behind' }, 'only changed rules persist');
X.reset();
assert.deepStrictEqual(X.diff(), {}, 'reset returns every rule to default');
assert.strictEqual(store['hobunji.xrayHierarchy.v1'], undefined);
assert.strictEqual(X.importDiff(JSON.stringify(exported)).applied > 0, true, 'an exported diff can be re-imported');
assert.strictEqual(X.get('hand.frontPlaneMask'), 'behind');
X.reset();

// Manual rank editing, strict validation, clipboard persistence and reset.
const shippedOrder = X.DEFAULT_DRAW_ORDER.slice();
assert.strictEqual(X.describeLayers().length, 18, 'every category remains in persisted/exported visual order');
assert.strictEqual(X.editableLayers().length, 17, 'linked weapons are not a fake independent UI control');
assert.ok(!X.editableLayers().some(layer => layer.id === 'item.weapons'));
assert.match(X.editableLayers().find(layer => layer.id === 'actor.hands').label, /held tools/);
assert.strictEqual(X.layerRank('item.weapons'), X.layerRank('actor.hands'), 'linked gear has exactly one effective rank');
assert.strictEqual(X.setDrawOrder(['actor.hands']), false, 'cannot remove layers');
assert.strictEqual(X.setDrawOrder([...shippedOrder.slice(1), shippedOrder[1]]), false, 'cannot duplicate layers');
assert.strictEqual(X.moveLayer('item.weapons', '__end'), true, 'moving a linked weapon changes the effective hand rank, not a phantom weapon rank');
assert.strictEqual(X.layerRank('actor.hands'), shippedOrder.length - 1);
assert.strictEqual(X.layerRank('item.weapons'), X.layerRank('actor.hands'));
assert.strictEqual(X.shiftLayer('item.weapons', -1), true, 'linked weapon nudge moves the hand entry across active categories');
assert.strictEqual(X.layerRank('actor.hands'), shippedOrder.length - 2);
assert.strictEqual(X.moveLayer('item.weapons', '__end'), true);
X.set('weapon.followHandLayer', 'off');
assert.strictEqual(X.editableLayers().length, 18, 'unlinked weapons expose their own independently editable rank');
assert.notStrictEqual(X.layerRank('item.weapons'), X.layerRank('actor.hands'), 'only explicit unlink enables independent positioning');
X.set('weapon.followHandLayer', 'on');
assert.ok(Array.isArray(JSON.parse(store['hobunji.xrayHierarchy.v1']).__drawOrder), 'manual order survives reload storage');
const orderExport = X.exportDiff();
X.reset();
assert.deepStrictEqual(X.describeLayers().map(layer => layer.id), shippedOrder, 'reset restores all layer ranks');
assert.strictEqual(X.importDiff(orderExport).ok, true, 'layer ranks round-trip through exported config');
assert.strictEqual(X.layerRank('actor.hands'), shippedOrder.length - 1);
X.reset();

// Dev Companion panel: pass-aware, flat functional controls, live diagnostics, reset to repo and export.
assert.strictEqual(panels.length, 1);
const panel = panels[0];
assert.strictEqual(panel.when(), true);
const view = panel.render();
const dropdowns = view.actions.filter(a => a.options);
assert.ok(dropdowns.length >= X.keys().length, 'all rules and the layer pickers have dropdowns');
assert.ok(view.actions.every(action => !action.path?.length), 'there is no misleading nested hierarchy');
assert.ok(view.actions.some(action => action.id === 'reset' && action.label === 'Reset all to repo' && action.confirm), 'explicit confirmed reset to repository defaults exists');
assert.ok(view.actions.some(action => action.id === 'focus-stage' && action.options.length === 2), 'render passes are explicit choices');
assert.ok(view.actions.some(action => action.id === 'focus-layer' && action.options.length === 2), 'held stage has only hands+tools and feet while linked');
const circleCheckbox = view.actions.find(action => action.id === 'toggle-ground-zone');
assert.ok(circleCheckbox?.checkbox && circleCheckbox.checked === false, 'world-space circular X-ray zone is hidden by default');
assert.ok(view.rows.some(row => row[0] === 'Ground depth overrides (last replay)' && row[1] === '3'),
  'phone panel shows how many missing-depth ground material overrides ran across held replay groups');
assert.ok(view.rows.some(row => row[0] === 'Ordinary held parts' && row[1] === '5'),
  'phone diagnostic distinguishes above-floor ordinary gear from floor-exempt equipment');
assert.ok(view.rows.some(row => row[0] === 'Floor punch calls / fallbacks' && row[1] === '12 / 2'),
  'phone report distinguishes floor-punch permission from evidence it actually executed');
assert.ok(view.rows.some(row => row[0] === 'Ground shader fallbacks' && row[1] === '0'),
  'phone panel reports failed ground shader compatibility');
assert.deepStrictEqual(panel.onAction('toggle-floor-punch', { checked: false }), { ok: true },
  'mobile A/B control disables stencil floor punch to isolate its contribution');
assert.equal(panel.render().actions.find(action => action.id === 'toggle-floor-punch').checked, false);
assert.deepStrictEqual(JSON.parse(X.diagnosticReport()).xrayDiagnosis.stencilAndReplay.floorPunch, { enabled: false, punches: 12, fallbacks: 2 },
  'mobile clipboard diagnosis reports the selected floor-punch path and its actual use');
assert.deepStrictEqual(panel.onAction('toggle-floor-punch', { checked: true }), { ok: true },
  'the full renderer floor-punch path can be restored from the same menu');
assert.equal(JSON.parse(X.diagnosticReport()).xrayDiagnosis.stencilAndReplay.xrayOrdinaryMeshes, 5,
  'the copied report identifies the ordinary held source path without requiring mobile devtools');
assert.deepStrictEqual(panel.onAction('toggle-ground-zone', { checked: true }), { ok: true }, 'Dev Companion checkbox enables the visualizer');
assert.strictEqual(X.get('ground.showZone'), 'on', 'debug preview state changes without changing the ground mask');
// Mock the 3D scene only for the debug overlay. It must not create persistent
// depth/billboard registrations or leave a circle behind while gameplay is paused.
class PreviewGroup {
  constructor() { this.children = []; this.userData = {}; this.position = { set: (x, y, z) => { this.xyz = [x, y, z]; } }; }
  add(child) { this.children.push(child); child.parent = this; }
  traverse(visitor) { visitor(this); this.children.forEach(visitor); }
}
class PreviewMesh {
  constructor(geometry, material) { this.geometry = geometry; this.material = material; this.rotation = {}; this.userData = {}; }
}
class PreviewGeometry { dispose() {} }
class PreviewMaterial { constructor(params) { Object.assign(this, params); } dispose() {} }
win.THREE = { Group: PreviewGroup, Mesh: PreviewMesh, CircleGeometry: PreviewGeometry,
  RingGeometry: PreviewGeometry, MeshBasicMaterial: PreviewMaterial, DoubleSide: 2 };
const previewScene = { isScene: true, children: [],
  add(mesh) { this.children.push(mesh); }, remove(mesh) { this.children = this.children.filter(item => item !== mesh); } };
assert.strictEqual(X.updateGroundZone(previewScene, { x: 3.25, z: -2.75, elevation: 1 }, 1.5), true);
const previewCircle = previewScene.children[0];
assert.deepStrictEqual(previewCircle.xyz, [3.25, 1.025, -2.75], 'ground circle previews the actual world X/Z and foot elevation');
assert.strictEqual(previewCircle.children.length, 2, 'debug circle has fill and ring');
assert.ok(previewCircle.children.every(mesh => mesh.material.depthWrite === false && mesh.userData.noOutline === true
  && !mesh.userData.hobunjiDepthReplayInert), 'debug geometry neither writes depth nor enters retained background registries');
assert.strictEqual(X.updateGroundZone(previewScene, { x: 3.5, z: -2.5, elevation: 2 }, 1.5), true);
assert.strictEqual(previewScene.children[0], previewCircle, 'moving reuses the original debug geometry');
assert.deepStrictEqual(previewCircle.xyz, [3.5, 2.025, -2.5]);
assert.deepStrictEqual(panel.onAction('toggle-ground-zone', { checked: false }), { ok: true }, 'checkbox disables the visualizer');
assert.strictEqual(previewScene.children.length, 0, 'unchecking removes the overlay immediately, even without another frame');
assert.strictEqual(X.get('ground.showZone'), 'off');
assert.ok(view.actions.some(action => action.group === 'World depth and airborne replay'), 'depth controls are grouped by actual render pass');
assert.ok(view.actions.some(action => action.group === 'Front portrait occlusion'), 'front-art masking has its own direct controls');
assert.ok(view.rows.some(r => /Front mask stencil/.test(r[0]) && /2 \/ 3/.test(r[1])), 'mobile diagnostics show actual masking coverage');
assert.ok(view.rows.some(r => r[0] === 'Shoulder pet compositor'), 'the same panel reports the shoulder-pet compositor');
assert.ok(!X.DIAGNOSTIC_PRESETS.some(p => /^shoulder-/.test(p.id)), 'retired pet/global-depth experiments cannot override face-stage pairing');
assert.ok(!view.actions.some(a => a.id === 'set' && a.args?.key === 'shoulderPet.presentation'),
  'shoulder-pet occlusion is a fixed owner portrait rule, not an editable setting');
assert.ok(X.moveLayerInStage('item.weapons', 'terrain') === false, 'cross-pass reordering is rejected in the stage API');
assert.ok(X.moveLayerInStage('item.weapons', 'actor.feet') === true, 'linked weapons can move within the held stage');
X.reset();
assert.ok(view.rows.some(r => /Hands masked by front art/.test(r[0]) && r[1] === '1'), 'live renderer counters are shown');
assert.deepStrictEqual(panel.onAction('set', { key: 'pants.sortWithActor', value: 'off' }), { ok: true });
assert.strictEqual(X.get('pants.sortWithActor'), 'off');
assert.match(panel.render().summary, /1 override/);
const exportResult = panel.onAction('export', {});
assert.ok(exportResult.text.includes('pants.sortWithActor') && exportResult.title);
panel.onAction('reset', {});
assert.strictEqual(X.get('pants.sortWithActor'), 'on');
assert.deepStrictEqual(X.diff(), {}, 'reset button clears every override, including rank edits');
assert.strictEqual(store['hobunji.xrayHierarchy.v1'], undefined, 'reset button removes stored browser overrides');
assert.deepStrictEqual(panel.onAction('shift', { delta: -1 }), { ok: true }, 'nudge reorders only within the selected held stage');
assert.strictEqual(X.get('layers.manualOrder'), 'on', 'moving a layer automatically enables the color sorter');
panel.onAction('reset', {});
panel.onAction('set', { key: 'weapon.followHandLayer', value: 'off' });
assert.strictEqual(panel.render().actions.find(action => action.id === 'focus-layer').options.length, 3);
assert.deepStrictEqual(panel.onAction('focus-layer', { value: 'item.weapons' }), { ok: true });
panel.onAction('set', { key: 'weapon.followHandLayer', value: 'on' });
assert.strictEqual(panel.render().actions.find(action => action.id === 'focus-layer').value, 'actor.hands',
  'relinking switches the editor away from the now-inert weapon position');
panel.onAction('reset', {});
assert.deepStrictEqual(panel.onAction('focus-stage', { value: 'world' }), { ok: true });
assert.strictEqual(panel.render().actions.find(action => action.id === 'focus-layer').options.length, 15,
  'world stage has its own 15 categories, excluding held/feet overlay entries');
assert.deepStrictEqual(panel.onAction('move-before', { value: 'actor.hands' }).ok, false,
  'cannot move world item into the held stage');
panel.onAction('reset', {});
assert.strictEqual(panel.render().actions.find(action => action.id === 'focus-stage').value, 'held',
  'full reset restores stage selection');

// Diagnostic hypothesis presets: each experiment is a fresh, reversible config, not a stack of overrides.
assert.equal(X.DIAGNOSTIC_PRESETS.length, 10, 'ten diagnostics remain after retiring three competing shoulder-pet modes');
const presetPicker = panel.render().actions.find(action => action.id === 'focus-preset');
assert.equal(presetPicker.options.length, X.DIAGNOSTIC_PRESETS.length, 'all experiments appear in one mobile dropdown');
assert.strictEqual(X.DIAGNOSTIC_PRESETS.find(p => p.id === 'front-mask-off')?.rules['weapon.frontPlaneMask'], 'on',
  'the retained diagnostic preset ID now enables the optional mask rather than duplicating the baseline');
assert.equal(panel.onAction('focus-preset', { value: 'not-a-preset' }).ok, false, 'unknown preset is rejected');
X.set('hand.frontPlaneMask', 'off');
X.set('actors.order', 'near');
X.set('ground.showZone', 'on'); // Leave the visual debugging circle visible throughout render experiments.
X.moveLayer('actor.hands', '__end');
const pretestRules = Object.fromEntries(X.keys().map(key => [key, X.get(key)])); // Simulates the user's custom pre-diagnosis configuration.
const pretestOrder = X.describeLayers().map(layer => layer.id); // Capture the exact non-default custom rank arrangement.
for (const experiment of X.DIAGNOSTIC_PRESETS) {
  const beforeActive = panel.render().rows.find(row => row[0] === 'Active experiment')?.[1];
  const beforeGuidance = panel.render().rows.find(row => row[0] === 'Testing')?.[1];
  assert.deepStrictEqual(panel.onAction('focus-preset', { value: experiment.id }), { ok: true });
  const pending = panel.render();
  assert.equal(pending.rows.find(row => row[0] === 'Active experiment')?.[1], beforeActive,
    'selecting a new experiment does not change the actual active one');
  assert.equal(pending.rows.find(row => row[0] === 'Testing')?.[1], beforeGuidance,
    'selected-but-not-applied setup never replaces guidance for the active experiment');
  assert.ok(pending.rows.find(row => row[0] === 'Selected next experiment')?.[1].includes(experiment.label),
    'pending selection clearly names the next experiment');
  assert.deepStrictEqual(panel.onAction('apply-preset', {}), { ok: true }, 'diagnostic preset applies from shipped defaults');
  for (const key of X.keys()) assert.equal(X.get(key), key === 'ground.showZone' ? pretestRules[key] : experiment.rules[key] ?? X.RULES[key].default,
    experiment.id + ' resets rendering choices while preserving the optional visible debugging circle');
  assert.equal(X.get('layers.manualOrder'), experiment.rules['layers.manualOrder'] ?? 'off',
    'the experiment does not inherit another color sort switch');
  if (experiment.id === 'tool-before-hand') {
    assert.ok(X.layerRank('item.weapons') < X.layerRank('actor.hands'), 'tool-under-hand preset changes the actual rank');
    assert.equal(X.get('weapon.followHandLayer'), 'off', 'independent priority is enabled before moving tools');
  }
  if (experiment.id === 'tool-after-hand') {
    assert.ok(X.layerRank('item.weapons') > X.layerRank('actor.hands'), 'tool-over-hand preset reverses that rank');
  }
  assert.ok(panel.render().rows.some(row => row[0] === 'Active experiment' && row[1].includes('(applied)')),
    'active experiment status ignores the independent visualization toggle and distinguishes actual render edits');
  assert.equal(panel.render().rows.find(row => row[0] === 'Testing')?.[1], experiment.hypothesis,
    'testing guidance refers to the actually applied setup, not the dropdown selection');
  const report = JSON.parse(panel.onAction('report', {}).text);
  assert.equal(report.xrayDiagnosis.activePreset, experiment.id, 'report carries the actual active preset');
  assert.equal(report.xrayDiagnosis.status, 'applied', 'report shows an unchanged experiment');
  assert.equal(report.xrayDiagnosis.stencilAndReplay.frontPortraitMaskedGear, 2,
    'mobile diagnosis includes the real owner-stencil assignment counter');
}
assert.ok(panel.render().actions.some(action => action.id === 'restore-original'),
  'the first configuration can be restored at any point in the experiment');
const savedOriginal = JSON.parse(store['hobunji.xrayHierarchy.diagnostics.v1']);
assert.deepStrictEqual(savedOriginal.original.rules, pretestRules, 'presets retain the original rules, not the previous preset');
assert.deepStrictEqual(savedOriginal.original.drawOrder, pretestOrder, 'presets retain the original layer positions');
assert.equal(savedOriginal.active, X.DIAGNOSTIC_PRESETS[X.DIAGNOSTIC_PRESETS.length - 1].id,
  'last remaining experiment survives browser reload');
X.set('hand.frontPlaneMask', 'behind');
assert.ok(panel.render().rows.some(row => row[0] === 'Active experiment' && row[1].includes('(modified manually)')),
  'editing one rule after applying a preset is reported, not silently treated as the preset');
const modifiedReport = JSON.parse(panel.onAction('report', {}).text);
assert.equal(modifiedReport.xrayDiagnosis.status, 'modified after apply');

const reloadedPanels = []; // Simulates loading the same game configuration into a new mobile tab.
const reloadedWin = {
  DevCompanion: { registerPanel: panel => reloadedPanels.push(panel) },
  HeldObjectRenderOrder: win.HeldObjectRenderOrder,
  __hobunjiGameStarted: true,
};
global.window = reloadedWin;
new Function(cfgSource)();
const Y = reloadedWin.XrayHierarchy;
assert.equal(reloadedPanels.length, 1, 'reloaded X-ray panel is registered');
assert.equal(Y.get('hand.frontPlaneMask'), 'behind', 'user edits during the experiment still persist');
assert.ok(reloadedPanels[0].render().actions.some(action => action.id === 'restore-original'),
  'the original configuration is available after a page reload');
assert.equal(Y.restoreBeforePresets(), true, 'restoring after reload succeeds');
assert.equal(reloadedPanels[0].render().actions.find(action => action.id === 'focus-preset').value, 'baseline',
  'restoration cannot leave the former experiment preselected');
for (const key of X.keys()) assert.equal(Y.get(key), pretestRules[key],
  'restore brings back the rule values from before the first experiment');
assert.deepStrictEqual(Y.describeLayers().map(layer => layer.id), pretestOrder,
  'restore brings back the exact pre-experiment draw order');
assert.equal(store['hobunji.xrayHierarchy.diagnostics.v1'], undefined, 'restoring clears the backup record');
assert.equal(Y.restoreBeforePresets(), false, 'prevents restoring a stale backup twice');
// Saved older diagnostic backups, including retired pet settings, remain recoverable.
const oldRules = { ...pretestRules };
oldRules['shoulderPet.presentation'] = 'world-depth'; // Legacy, now ignored, must not invalidate saved backups.
delete oldRules['ground.showZone'];
store['hobunji.xrayHierarchy.diagnostics.v1'] = JSON.stringify({
  version: 1, active: 'baseline',
  original: { rules: oldRules, drawOrder: pretestOrder, stage: 'held', layer: 'actor.hands' },
});
const oldPanels = [];
const oldWin = { DevCompanion: { registerPanel: spec => oldPanels.push(spec) }, __hobunjiGameStarted: true };
global.window = oldWin;
new Function(cfgSource)();
assert.strictEqual(oldPanels.length, 1, 'legacy backup still shows the X-ray companion');
assert.ok(oldPanels[0].render().actions.some(action => action.id === 'restore-original'), 'legacy backup keeps its restore action');
assert.strictEqual(oldWin.XrayHierarchy.restoreBeforePresets(), true, 'legacy backup restores despite missing new debug-only rules');
assert.strictEqual(oldWin.XrayHierarchy.get('shoulderPet.presentation'), undefined);
assert.strictEqual(oldWin.XrayHierarchy.get('ground.showZone'), 'off');
global.window = win;
panel.onAction('reset', {});
assert.equal(panel.render().actions.find(action => action.id === 'focus-preset').value, 'baseline',
  'repo reset clears the previously highlighted experiment');
assert.equal(store['hobunji.xrayHierarchy.v1'], undefined, 'reset to repo clears experiment values');
assert.equal(store['hobunji.xrayHierarchy.diagnostics.v1'], undefined, 'reset to repo clears the diagnostic session too');
assert.deepStrictEqual(X.diff(), {}, "remaining renderer checks start at shipped defaults");

// The renderer's own fallback table (used only if this module is absent) must not drift from the shipped defaults.
const fallbackSource = /const XRAY_RULE_FALLBACK = (\{[^}]*\});/.exec(render);
assert.ok(fallbackSource, 'renderer declares XRAY_RULE_FALLBACK');
const fallback = new Function('return ' + fallbackSource[1])();
for (const key of X.keys()) assert.strictEqual(fallback[key], X.RULES[key].default, `fallback default for ${key} matches the config`);
assert.strictEqual(Object.keys(fallback).length, X.keys().length, 'fallback lists exactly the configured rules');

// Renderer wiring: every rule is read where its behaviour lives.
for (const key of X.keys()) assert.ok(render.includes(`'${key}'`), `renderer reads rule ${key}`);
assert.ok(/updateFrontPlaneHands\(held, scene, camera\)/.test(render), 'hand rule runs each base world frame');
assert.ok(/handsBehindFrontPlane: lastHandsBehindFrontPlane/.test(render), 'snapshot exposes the hand counter');
assert.ok(/withPortraitDrawOrder\(renderer, overlayDrawOrder, \(\) => rawRender\.call\(renderer, scene, camera\)\)/.test(render),
  'actual gear/hand/foot overlay color draws inherit actor depth and manual layer sorting');
assert.ok(/const supplementDepth = !group\.regions\.length && canLockColorMask && !rebuildAirborne/.test(render),
  'airborne ordinary gear cannot reuse a sky-masked base depth buffer');
assert.ok(/backgroundHidden = backgroundMeshes\.length && !supplementDepth \? hideObjects\(backgroundMeshes\)/.test(render),
  'only the selective depth rebuild excludes backdrops, not the original scene or final depth restore');
assert.ok(/isPresentationBackdrop\(object\).*backgroundDepthRegistry\.add\(object(?:,\s*knownScene)?\)/.test(render),
  'sky and horizon meshes are registered without a new scene traversal per gear draw');
assert.ok(/backgroundDepthMeshesExcluded/.test(render) && /airborneDepthRebuilds/.test(render),
  'mobile Dev Companion diagnostics expose both airborne fixes');
assert.ok(/frontPortraitGearCandidates: lastFrontPortraitGearCandidates/.test(render)
  && /frontPortraitMaskedGear: lastFrontPortraitMaskedGear/.test(render),
  'renderer reports whether stencil masking actually covered tools rather than merely reading the UI rank');
assert.ok(/heldOrderNormalizations,/.test(render) && /lastHeldOrderNormalization: lastHeldOrderNormalization/.test(render),
  'renderer reports when it overwrites the authored held renderOrder');
assert.ok(/Held renderOrder overrides/.test(cfgSource) && /lastHeldOrderNormalization/.test(cfgSource),
  'mobile X-ray Companion explains the automatic renderer overrides');

// Execute the renderer classification and live render-list sorting (without a GL context).
const backdropStart = render.indexOf('  function isPresentationBackdrop(');
const backdropEnd = render.indexOf('\n  // Central x-ray rules', backdropStart);
const isBackdrop = new Function(render.slice(backdropStart, backdropEnd) + '; return isPresentationBackdrop;')();
assert.strictEqual(isBackdrop({ isMesh: true, name: 'hobunji_cloud_depth_mask_0', material: { userData: { skyLayerDepthNdc: 0.999 } } }), true,
  'far-plane cloud mask is recognized as a visual backdrop');
assert.strictEqual(isBackdrop({ isMesh: true, userData: { backgroundScenery: true } }), true,
  'authored background scenery is not a physical foreground occluder');
assert.strictEqual(isBackdrop({ isMesh: true, userData: {}, material: { userData: {} } }), false,
  'ordinary solid walls stay real occluders');
const layerStart = render.indexOf('  function visualLayerFor(');
const layerEnd = render.indexOf('\n  function nearbyPortraitOrder(', layerStart);
const visualSort = new Function('window', 'xrayRule', 'isPresentationBackdrop', 'surfaceKindForObject', 'comparePortraitDraws', 'heldPriorityLayer',
  'shoulderPetPresentation', 'previouslyPresentedPet', 'shoulderPetDrawFace', 'compareShoulderPetDrawFaces',
  render.slice(layerStart, layerEnd) + '; return { visualLayerFor, withVisualSort };')(
  win, key => X.get(key), isBackdrop, () => 'solid', (a, b, ranks, extras) =>
    (ranks.get(b.object)?.depth ?? extras?.get(b.object)?.depth ?? b.z)
      - (ranks.get(a.object)?.depth ?? extras?.get(a.object)?.depth ?? a.z),
  () => X.get('weapon.followHandLayer') === 'off' ? 'item.weapons' : 'actor.hands',
  null, null, () => null, () => 0); // This general harness has no equipped pet; the pet-specific harness tests pairing.
const drawn = (data, name) => ({ object: { userData: data, name: name || '' }, material: { id: 3 }, groupOrder: 0, renderOrder: 0, z: 0, id: 1 });
const handItem = drawn({ hobunjiProceduralHand: true });
const weaponItem = drawn({ hobunjiHeldObjectPlane: true });
const footItem = drawn({ hobunjiProceduralFoot: true });
assert.strictEqual(visualSort.visualLayerFor(handItem), 'actor.hands');
assert.strictEqual(visualSort.visualLayerFor(weaponItem), 'actor.hands', 'held weapon takes its gripping hand layer by default');
X.set('weapon.followHandLayer', 'off');
assert.strictEqual(visualSort.visualLayerFor(weaponItem), 'item.weapons', 'explicit unlink permits independent weapon rank');
assert.strictEqual(visualSort.visualLayerFor(footItem), 'actor.feet');
const rendererMock = { setTransparentSort(fn) { this.transparent = fn; }, setOpaqueSort(fn) { this.opaque = fn; } };
X.set('layers.manualOrder', 'on');
X.moveLayer('actor.hands', '__end');
visualSort.withVisualSort(rendererMock, null, () => {
  assert.ok(rendererMock.transparent(weaponItem, handItem) < 0, 'gear drawn before moved hand layer');
  assert.ok(rendererMock.opaque(weaponItem, handItem) < 0, 'manual sort also handles opaque parts');
});
assert.strictEqual(rendererMock.transparent, null, 'transparent renderer state restored after a sort');
assert.strictEqual(rendererMock.opaque, null, 'opaque renderer state restored after a sort');
// A manual visual rank must never reorder render-time pose sentinels, sky depth masks,
// or final overlay art across the protected phases that are not editable color layers.
const earlyPoseSentinel = { ...handItem, renderOrder: -100000, id: 50 };
const cloudDepthMask = { ...drawn({}, 'hobunji_cloud_depth_mask_0'), renderOrder: 100000, id: 51 };
const lateOverlay = { ...drawn({}, 'world_popup_text'), renderOrder: 1210, id: 52 };
visualSort.withVisualSort(rendererMock, null, () => {
  for (const compare of [rendererMock.transparent, rendererMock.opaque]) {
    assert.ok(compare(earlyPoseSentinel, weaponItem) < 0, 'pose driver must run before user-ranked gear');
    assert.ok(compare(cloudDepthMask, weaponItem) > 0, 'late cloud depth mask must follow ordinary opaque art');
    assert.ok(compare(lateOverlay, weaponItem) > 0, 'late text/overlay must not fall behind gear');
    assert.ok(compare({ ...weaponItem, groupOrder: 1 }, { ...handItem, groupOrder: 0 }) > 0,
      'manual ranks cannot override an explicit Three.js group boundary');
  }
});
assert.strictEqual(rendererMock.transparent, null, 'protected transparent sort transaction restores defaults');
assert.strictEqual(rendererMock.opaque, null, 'protected opaque sort transaction restores defaults');
const farOwner = { id: 100 }, nearOwner = { id: 101 };
const actorOrder = { ranks: new Map([
  [weaponItem.object, { owner: farOwner, depth: 0.8 }],
  [handItem.object, { owner: nearOwner, depth: 0.2 }],
]), extras: new Map() };
X.moveLayer('item.weapons', '__end'); // Edit would otherwise draw the farther weapon last.
visualSort.withVisualSort(rendererMock, actorOrder, () => {
  assert.ok(rendererMock.transparent(weaponItem, handItem) < 0,
    'near NPC portrait still covers far NPC weapon despite the weapon manual priority');
});
assert.strictEqual(rendererMock.transparent, null, 'actor-aware visual sort transaction restores renderer state');
const overlayRankStart = render.indexOf('  function rankedHeldOverlayOrder(');
const overlayRankEnd = render.indexOf('\n  function assignPortraitStencilOwners(', overlayRankStart);
assert.ok(overlayRankStart >= 0 && overlayRankEnd > overlayRankStart, 'held overlay owner-rank adapter is present');
const rankedHeld = new Function('xrayRule', 'portraitStencilOwner',
  render.slice(overlayRankStart, overlayRankEnd) + '; return rankedHeldOverlayOrder;')(
  key => X.get(key), mesh => mesh.owner);
const farEquipment = { owner: farOwner }, nearEquipment = { owner: nearOwner };
const baseActorSort = { ranks: actorOrder.ranks, extras: new Map() };
const heldSort = rankedHeld(baseActorSort, [farEquipment, nearEquipment], {});
assert.strictEqual(heldSort.extras.get(farEquipment).owner, farOwner,
  'the far actor weapon inherits its own portrait depth rank');
assert.strictEqual(heldSort.extras.get(nearEquipment).owner, nearOwner,
  'the near actor hands inherit the near portrait depth rank');
assert.strictEqual(rankedHeld(null, [farEquipment], {}), null, 'single actor worlds keep the original simple sort');
// The default manual-sort setting is OFF; moving pants into the foot replay must not lose the existing
// actor-aware layering that prevents a distant NPC's pants from painting over a nearer actor.
X.set('layers.manualOrder', 'off');
const farPants = { owner: farOwner, userData: { hobunjiPantsGarment: true } };
const nearPants = { owner: nearOwner, userData: { hobunjiPantsGarment: true } };
const pantsOrder = { ranks: actorOrder.ranks, extras: new Map([
  [farPants, { owner: farOwner, depth: 0.8 }],
  [nearPants, { owner: nearOwner, depth: 0.2 }],
]) };
assert.strictEqual(rankedHeld(pantsOrder, [farPants, nearPants], {}), pantsOrder,
  'pants retain their wearer-based ordering in the replay without enabling manual layer sorting');
assert.strictEqual(rankedHeld(pantsOrder, [farEquipment], {}), null,
  'the default tool/hand replay does not gain an unnecessary actor sorter');
visualSort.withVisualSort(rendererMock, rankedHeld(pantsOrder, [farPants, nearPants], {}), () => {
  const farDraw = { ...weaponItem, object: farPants, renderOrder: 28 };
  const nearDraw = { ...handItem, object: nearPants, renderOrder: 28 };
  assert.ok(rendererMock.transparent(farDraw, nearDraw) < 0,
    'nearby NPC pants overlay with their owner instead of over a nearer character');
});
X.set('pants.sortWithActor', 'off');
assert.strictEqual(rankedHeld(pantsOrder, [farPants], {}), null,
  'disabling pants owner sort also disables its special replay ordering');
X.set('pants.sortWithActor', 'on');
X.set('layers.manualOrder', 'on');
visualSort.withVisualSort(rendererMock, heldSort, () => {
  const farDraw = { ...weaponItem, object: farEquipment }, nearDraw = { ...handItem, object: nearEquipment };
  assert.ok(rendererMock.transparent(farDraw, nearDraw) < 0,
    'in the isolated held overlay the nearer actor still covers the farther actor');
});
X.reset();

// Stencil and visual priority are independent: rank movement cannot reorder a later overlay over its owner's front portrait.
const maskBegin = render.indexOf('  function heldPriorityLayer(');
const maskEnd = render.indexOf('\n  // Hands:', maskBegin);
const maskScope = new Function('window', 'xrayRule', 'maskedHands',
  render.slice(maskBegin, maskEnd) + '; return { heldPriorityLayer, isPortraitMaskedGear };')(
    win, key => X.get(key), new Set([handItem.object]));
assert.strictEqual(maskScope.isPortraitMaskedGear({ userData: { hobunjiHeldObjectPlane: true } }), false,
  'the shipped default does not stencil out opaque weapon pixels');
X.set('weapon.frontPlaneMask', 'on');
assert.strictEqual(maskScope.isPortraitMaskedGear({ userData: { hobunjiHeldObjectPlane: true } }), true,
  'front art masks a held weapon only after explicit opt-in');
X.set('layers.manualOrder', 'on');
X.moveLayer('item.weapons', '__end');
assert.strictEqual(maskScope.isPortraitMaskedGear({ userData: { hobunjiHeldObjectPlane: true } }), true,
  'no cross-pass movement silently removes the owner front-art mask');
X.set('weapon.followHandLayer', 'off');
assert.strictEqual(maskScope.isPortraitMaskedGear({ userData: { hobunjiHeldObjectPlane: true } }), true,
  'unlinking tool position has no effect on whether the front stencil masks it');
X.set('weapon.frontPlaneMask', 'off');
assert.strictEqual(maskScope.isPortraitMaskedGear({ userData: { hobunjiHeldObjectPlane: true } }), false,
  'direct mask switch disables owner stencil regardless of rank');
X.set('weapon.frontPlaneMask', 'on');
assert.strictEqual(maskScope.isPortraitMaskedGear({ userData: { hobunjiHeldObjectPlane: true } }), true,
  'direct mask switch re-enables owner stencil regardless of rank');
X.reset();
assert.strictEqual(maskScope.isPortraitMaskedGear({ userData: { hobunjiHeldObjectPlane: true } }), false,
  'reset to repository defaults disables the owner weapon stencil again');

// Execute the production "hand behind its front plane" math with a tiny matrix stand-in.
const start = render.indexOf('const HAND_BEHIND_PLANE_EPS');
const fnStart = render.indexOf('function handBehindFrontPlane(');
const fnEnd = render.indexOf('\n  }\n', fnStart) + 4;
class V3 {
  constructor() { this.x = 0; this.y = 0; this.z = 0; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { return this.set(v.x, v.y, v.z); }
  setFromMatrixPosition(m) { return this.set(m.elements[12], m.elements[13], m.elements[14]); }
  applyMatrix4(m) { return this.set(this.x - m.t[0], this.y - m.t[1], this.z - m.t[2]); } // Plane at m.t, no rotation.
}
class M4 { constructor() { this.t = [0, 0, 0]; } copy(m) { this.t = m.pos.slice(); return this; } invert() { return this; }
  multiplyMatrices(inverse, world) { this.t = [inverse.t[0] - world.pos[0], inverse.t[1] - world.pos[1], inverse.t[2] - world.pos[2]]; return this; } } // V3.applyMatrix4 subtracts t, so store the negated hand offset.
const handToPlaneStub = new M4();
const handBehind = new Function('THREE', 'handPlaneInverse', 'handPlaneLocal', 'handPlaneCamera', 'handToPlane', 'handCorner', 'handProbe',
  render.slice(start, render.indexOf('\n', start)) + '\n' + render.slice(render.indexOf('const HAND_PART_BEHIND_EPS'), render.indexOf('\n', render.indexOf('const HAND_PART_BEHIND_EPS'))) + '\n' + render.slice(fnStart, fnEnd) + '\nreturn handBehindFrontPlane;')(
  {}, new M4(), new V3(), new V3(), handToPlaneStub, new V3(), { cameraZ: NaN, handMinZ: NaN, handMaxZ: NaN, hands: 0 });
const plane = { matrixWorld: { pos: [0, 0, 0], elements: [] } };
const mat = (x, y, z) => { const e = new Array(16).fill(0); e[12] = x; e[13] = y; e[14] = z; return { elements: e, pos: [x, y, z] }; };
plane.matrixWorld = mat(0, 0, 0);
const cameraFront = { matrixWorld: mat(0, 0, 5) };
assert.strictEqual(handBehind({ matrixWorld: mat(0, 0, -0.05) }, plane, cameraFront), true, 'hand behind the plane, camera in front: hidden');
assert.strictEqual(handBehind({ matrixWorld: mat(0, 0, 0.08) }, plane, cameraFront), false, 'hand in front of the plane stays visible');
assert.strictEqual(handBehind({ matrixWorld: mat(0, 0, -0.05) }, plane, { matrixWorld: mat(0, 0, -5) }), false, 'camera behind the card: front art is not on screen, nothing to hide under');
// A gripping hand straddles the card: its centre is in front but a part (and its outline) reaches behind.
const box = (zmin, zmax) => ({ boundingBox: { min: { x: -0.05, y: -0.05, z: zmin }, max: { x: 0.05, y: 0.05, z: zmax } } });
assert.strictEqual(handBehind({ matrixWorld: mat(0, 0, 0.04), geometry: box(-0.12, 0.12) }, plane, cameraFront), true, 'straddling hand with a part behind the plane is masked');
assert.strictEqual(handBehind({ matrixWorld: mat(0, 0, 0.2), geometry: box(-0.05, 0.05) }, plane, cameraFront), false, 'hand wholly in front stays visible');
assert.strictEqual(handBehind({ matrixWorld: mat(0, 0, 0.04), geometry: box(-0.01, 0.12) }, plane, cameraFront), false, 'a sliver within tolerance does not hide the hand');
console.log('xray hierarchy: ok');
