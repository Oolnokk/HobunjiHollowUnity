'use strict';
// The Procedural Animation Editor must expose the Maskbound Guardian's shipped
// troop gait profiles as editable, exportable presets — not decorative names.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const editor = read('docs/tools/procedural-animation-editor/index.html');
const guardianSource = read('docs/js/combat/combat-maskbound-guardian.js');
const legs = read('docs/js/procedural-leg-animation.js');

const start = editor.indexOf('const MOVEMENT_PRESETS = Object.freeze(');
const end = editor.indexOf('const IMPORTED_DRUNKEN_DIRECTIONAL_POSES', start);
assert(start >= 0 && end > start, 'found the real editor preset object');
const presetSource = editor.slice(start, end);
const presets = vm.runInNewContext(presetSource + '\nMOVEMENT_PRESETS', {
  REPOSITORY_MOVEMENT_LOGIC: { speed: 2.38, acceleration: 9.8, turnAcceleration: 13.2, deceleration: 18.5 },
});
const game = { console };
game.window = game;
vm.runInNewContext(guardianSource, game);
const troops = game.MaskboundGuardianCombat.troopTypes;
for (const name of ['sentinel', 'bulwark', 'reacher']) {
  const key = 'maskbound_' + name;
  const editorPreset = presets[key];
  assert(editorPreset, name + ' preset exists in the editor');
  assert.equal(editorPreset.label, troops[name].label);
  assert.deepEqual(JSON.parse(JSON.stringify(editorPreset.gaitProfile)), JSON.parse(JSON.stringify(troops[name].gait)), name + ' editor parameters match the live enemy');
  assert(editor.includes('<option value="' + key + '">'), name + ' option is selectable from the regular preset dropdown');
  assert(editorPreset.feetEnabled, name + ' defaults to visible foot animation');
  assert(editorPreset.autoWalk, name + ' automatically previews walking');
}
assert.equal(presets.regular.gaitProfile, undefined, 'ordinary walking is not changed');
assert.equal(presets.drunken.gaitProfile, undefined, 'drunken walking is not changed');

const panelFields = ['maskboundDragSide','maskboundCadence','maskboundStance','maskboundDragLift','maskboundLurchDegrees'];
for (const field of panelFields) {
  assert(editor.includes('id="' + field + '"'), field + ' control is in the editor');
  assert(editor.includes("'"+field+"'") || editor.includes("$('"+field+"')"), field + ' is read/wired in the editor');
}
assert(editor.includes('gaitProfile: normalizeMaskboundEditorGait(source.gaitProfile ?? fallback.gaitProfile)'), 'preset and custom export retain the gaitProfile');
assert(editor.includes("const lurch = procedural.settings.gaitProfile?.style === 'maskbound-lurch'"), 'editor preview applies a guardian-only lurch profile');
assert(editor.includes('dragging.lift *= lurch.dragLift'), 'foot preview shows the scraping leg');
assert(editor.includes('supporting.lift *= 0.82'), 'foot preview shows the supporting-leg asymmetry');
assert(editor.includes('rightPose = stridePoseAtPhase(procedural.feet.phase + (lurch ? 0.53 : 0.5)'), 'editor previews the same asymmetric timing as game');
assert(editor.includes('(lurch.lurchDegrees + 5 * Math.sin(procedural.feet.phase * Math.PI * 2))'), 'editor previews pulsed forward torso lean');
assert(legs.includes('(lurch.lurchDegrees + 5 * lurchBeat)'), 'game retains the matching procedural torso lean');
assert(editor.includes('gaitPanel.hidden = !gait'), 'extra authoring sliders are hidden for ordinary movement');

const normalizedStart = editor.indexOf('function normalizeMaskboundEditorGait(');
const normalizedEnd = editor.indexOf('function normalizedAnimationSettings(', normalizedStart);
assert(normalizedStart >= 0 && normalizedEnd > normalizedStart, 'found independent validation of gait sliders');
const normalizer = vm.runInNewContext(editor.slice(normalizedStart, normalizedEnd) + '\nnormalizeMaskboundEditorGait', {
  clampNumber: (value, min, max) => Math.max(min, Math.min(max, Number(value))),
});
assert.equal(normalizer({style:'maskbound-lurch', dragSide:'right', cadence:999, stance:1, dragLift:-5, lurchDegrees:100}).cadence, 1.5);
assert.equal(normalizer({style:'maskbound-lurch', dragSide:'right', cadence:999, stance:1, dragLift:-5, lurchDegrees:100}).dragLift, 0.01);
assert.equal(normalizer({style:'maskbound-lurch', dragSide:'right', cadence:999, stance:1, dragLift:-5, lurchDegrees:100}).lurchDegrees, 25);
assert.equal(normalizer({style:'regular'}), null, 'no custom lurch on an ordinary profile');

console.log('Maskbound walk editor: selectable named presets match game troops, custom sliders export and preview gait');
