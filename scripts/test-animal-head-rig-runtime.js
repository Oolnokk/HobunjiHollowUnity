#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const avatarSource = fs.readFileSync('docs/js/png-plane-avatar.js', 'utf8');
const speciesSource = fs.readFileSync('docs/js/creature-genetics-render.js', 'utf8');
const gameSource = fs.readFileSync('docs/game.js', 'utf8');
const indexSource = fs.readFileSync('docs/index.html', 'utf8');

const animalRigStart = avatarSource.indexOf('function applyAnimalHeadRig('); // Anchors the head API test within its real owning function, regardless of its length.
const animalRigEnd = avatarSource.indexOf('function installAnimalHeadRigRuntime(', animalRigStart); // Bounds the owned function so an unrelated API cannot satisfy this check.
assert.ok(animalRigStart >= 0 && animalRigEnd > animalRigStart
  && avatarSource.slice(animalRigStart, animalRigEnd).includes('avatarRef.updateHeadRotation ='),
  'the painted-weight avatar runtime exposes a smoothed head-rotation API');
assert.match(avatarSource, /avatarRef\.setHeadAdditiveRotation =/,
  'the painted-weight avatar runtime exposes an additive neck-animation layer');
const rigTableStart = speciesSource.indexOf('const ANIMAL_HEAD_RIGS =');
const rigTable = speciesSource.slice(rigTableStart, rigTableStart + 120000);
assert.ok(rigTableStart >= 0
  && rigTable.includes('"dabinggi-hound"')
  && rigTable.includes('"gar-wolf"')
  && rigTable.includes('"drenkirra"')
  && rigTable.includes('"grehlr"'),
  'the authored species rig table includes the four animal families');
assert.ok(indexSource.indexOf('js/png-plane-avatar.js') < indexSource.indexOf('js/creature-genetics.js')
  && indexSource.indexOf('js/creature-genetics.js') < indexSource.indexOf('js/creature-genetics-render.js'),
  'the head-rig runtime loads before the species bridge and game startup');
const buildCreatureVisuals = gameSource.slice(gameSource.indexOf('function createCreatureVisuals('), gameSource.indexOf('function releaseCreatureVisuals('));
assert.match(buildCreatureVisuals, /const authoredHeadRig = window\.CreatureGeneticsRender\?\.headRigForKind\?\.\(creatureKey\)/,
  'game resolves each creature kind’s authored head rig before building its visual');
assert.match(buildCreatureVisuals, /creatureId: creatureKey,\s*headRig,/,
  'the resolved rig is passed explicitly into the native creature builder');

// Execute the real head-rig swap: downstream portrait occlusion must receive
// the visible SkinnedMesh refs, not the rigid cards removed from the scene.
const replaceStart = avatarSource.indexOf('    group.remove(frontPlane);');
const replaceEnd = avatarSource.indexOf('    const legacyDispose =', replaceStart);
assert.ok(replaceStart >= 0 && replaceEnd > replaceStart, 'find live head-rig replacement body');
const legacyFront = { name: 'rigid-front' }, legacyBack = { name: 'rigid-back' };
const liveFront = { name: 'skinned-front', isSkinnedMesh:true };
const liveBack = { name: 'skinned-back', isSkinnedMesh:true };
const group = {
  children: [legacyFront, legacyBack],
  remove(mesh) { const i = this.children.indexOf(mesh); if (i >= 0) this.children.splice(i, 1); },
  add(mesh) { this.children.push(mesh); mesh.parent = this; },
};
const avatarRef = { frontPlane: legacyFront, backPlane: legacyBack, group };
new Function('group', 'frontPlane', 'backPlane', 'front', 'back', 'avatarRef',
  avatarSource.slice(replaceStart, replaceEnd))(
    group, legacyFront, legacyBack, { mesh: liveFront }, { mesh: liveBack }, avatarRef);
assert.strictEqual(avatarRef.frontPlane, liveFront, 'front reference follows the visible skinned mesh');
assert.strictEqual(avatarRef.backPlane, liveBack, 'back reference follows the visible skinned mesh');
assert.deepStrictEqual(group.children, [liveFront, liveBack], 'old cards are detached from rendered group');

console.log('Animal head-rig runtime regression checks passed.');
