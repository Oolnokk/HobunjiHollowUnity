#!/usr/bin/env node
'use strict';

// Regression for creature-only Rig Coordinates export (28), including all size families and live variants.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const scope = { console, addEventListener() {} }; // Browser-compatible context used by the three production rig modules.
scope.window = scope;
scope.globalThis = scope;
scope.SCRATCHBONES_CONFIG = { game: { creatureGenetics: { palettes: { default: [{ id: 'gray', name: 'Gray', hex: '#888888', weight: 1 }] } } } };
vm.createContext(scope);
for (const filename of [
  'docs/config/attachment-rig-profiles.js',
  'docs/js/creature-genetics.js',
  'docs/js/animation-author-creature-gameplay-parity.js',
]) vm.runInContext(fs.readFileSync(filename, 'utf8'), scope, { filename });

const profileData = scope.HOBUNJI_ATTACHMENT_RIG_PROFILES; // One source for both live creature size/ground math and editor previews.
const expected = {
  drenkirra: [[2, 2, .9], [.45, .4, .17]],
  grehlr: [[1, .5, .3], [.625, .325, .13]],
  'gar-wolf': [[1.5, 1, .28], [.525, .35, .11]],
  'dabinggi-hound': [[2, 1, .35], [.7, .35, .09]],
  uumkaoii: [[1.5, 1, .24], [.75, .25, .05]],
  puktuk: [[.75, .45, .28], [.3, .175, .12]],
  'voorg-ass': [[1, .75, .34], [.39, .3, .11]],
  nelk: [[1.75, 1, .44], [.45, .25, .065]],
  nazgraku: [[1.5, 1, .5], [.31, .2, .07]],
  moot: [[1, .75, .35], [-300, -.3, 0]],
  pingdort: [[3.5, 1.75, 1], [.14842300556586271, .218, .07]],
  'skeeri-medium': [[1.5, 1, .35], [.23692307692307693, .12384615384615384, .07]],
  skeeri: [[3.3846153846153846, 1.769230769230769, 1], [.23692307692307693, .12384615384615384, .07]],
  'skeeri-small': [[1, 1, 1], [.23692307692307693, .12384615384615384, .07]],
  'skeeri-large': [[1, 1, 1], [.23692307692307693, .12384615384615384, .07]],
  'omgurku-lower': [[1, 1, 1], [0, .3, 0]],
  tzatzul: [[1.5, 1, .35], [0, .5, 0]],
  'tzatzul-hatchling': [[1.5, 1, .35], [0, .3, 0]],
}; // Exact X=Y scales and offsets in the uploaded creature data; order is Large, Medium, Small.
const classes = ['large', 'medium', 'small']; // Aligns the upload ordering with the production profile class names.
for (const [kind, [scales, lifts]] of Object.entries(expected)) {
  const actual = profileData.creatures[kind]; // Uses the assembled master, never an embedded Animation Author snapshot.
  assert.ok(actual, kind + ' has an independent base profile');
  for (let i = 0; i < classes.length; i++) {
    const size = classes[i]; // Selects one authored class for the exact profile comparison.
    const tolerance = 1e-12; // Accommodates the same decimal ratios derived for Skeeri native widths.
    assert.ok(Math.abs(actual.sizeScales[size].x - scales[i]) < tolerance, kind + ' ' + size + ' X');
    assert.ok(Math.abs(actual.sizeScales[size].y - scales[i]) < tolerance || (kind === 'gar-wolf' && size === 'small' && actual.sizeScales.small.y === .34), kind + ' ' + size + ' Y');
    assert.ok(Math.abs(actual.groundOffsets[size] - lifts[i]) < tolerance, kind + ' ' + size + ' lift');
  }
}
assert.equal(profileData.creatures['tzatzul'].anchors.saddle.position.y, .24489795684814464);
assert.equal(profileData.creatures['tzatzul-hatchling'].anchors.saddle.position.y, .1530612230300904);
assert.equal(profileData.creatures['tzatzul-hatchling'].anchors.shoulderGrip.position.y, -.19557822942733763);

const aliases = profileData.creatureTransformAliases; // Shared variant family map consumed by runtime genetics and Animation Author.
const db = Object.fromEntries([...Object.keys(expected), ...Object.keys(aliases)].map(kind => [kind, { defaultSizeClass: 'medium' }]));
scope.CreatureGenetics.init({ CREATURE_DB: db, clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)) });
for (const [kind, parent] of Object.entries(aliases)) {
  assert.equal(scope.AnimationAuthorCreatureGameplayParity.gameplayProfileForKind(kind), profileData.creatures[parent], kind + ' preview inherits base animal');
  for (const size of classes) {
    assert.deepEqual(
      JSON.parse(JSON.stringify(scope.CreatureGenetics.creatureSizeScale(kind, size))),
      JSON.parse(JSON.stringify(scope.CreatureGenetics.creatureSizeScale(parent, size))),
      kind + ' ' + size + ' inherits the parent size');
    assert.equal(scope.CreatureGenetics.creatureGroundOffset(kind, size),
      scope.CreatureGenetics.creatureGroundOffset(parent, size), kind + ' ' + size + ' inherits the parent ground lift');
  }
}
assert.equal(scope.CreatureGenetics.creatureGroundOffset('moot', 'large'), null, 'negative ground lift keeps existing Auto behavior');
assert.equal(scope.CreatureGenetics.creatureGroundOffset('moot', 'medium'), null, 'negative medium lift keeps Auto behavior');

const guard = scope.HOBUNJI_ATTACHMENT_RIG_MASTER_GUARD; // Reconciles browser autosaves without erasing user-made overrides.
const old = JSON.parse(JSON.stringify(profileData));
old.creatures.drenkirra.sizeScales.large = { x: 4, y: 4 };
old.creatures['gar-wolf'].groundOffsets = { large: .5, medium: .33, small: .11 };
old.creatures.puktuk.sizeScales.medium = { x: .6, y: .6 };
old.creatures.moot.groundOffsets = { large: 0, medium: 0, small: 0 };
const upgraded = guard.reconcileProfiles(old).creatures;
assert.equal(upgraded.drenkirra.sizeScales.large.x, 2);
assert.equal(upgraded['gar-wolf'].groundOffsets.medium, .35);
assert.equal(upgraded.puktuk.sizeScales.medium.x, .45);
assert.equal(upgraded.moot.groundOffsets.large, -300);
const custom = JSON.parse(JSON.stringify(old));
custom.creatures.drenkirra.sizeScales.large = { x: 2.7, y: 2.4 };
custom.creatures['gar-wolf'].groundOffsets.medium = .377;
const retained = guard.reconcileProfiles(custom).creatures;
assert.equal(retained.drenkirra.sizeScales.large.x, 2.7, 'manual size stays authored');
assert.equal(retained['gar-wolf'].groundOffsets.medium, .377, 'manual floor edit stays authored');

profileData.creatures['gar-wolf-alpha'] = {
  sizeScales: { large: { x: 9, y: 9 } }, groundOffsets: { large: .9 },
}; // Simulates an independently authored variant rig; its own profile takes priority.
assert.equal(scope.CreatureGenetics.creatureSizeScale('gar-wolf-alpha', 'large').x, 9);
assert.equal(scope.CreatureGenetics.creatureGroundOffset('gar-wolf-alpha', 'large'), .9);
assert.equal(scope.AnimationAuthorCreatureGameplayParity.gameplayProfileForKind('gar-wolf-alpha'), profileData.creatures['gar-wolf-alpha']);
console.log('November 22 animal rig and variant inheritance checks passed');
