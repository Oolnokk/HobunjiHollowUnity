#!/usr/bin/env node
'use strict';
// In-game pants wiring that runs without a browser: NPC default pants, rig-data lookup, and the shipped rig config.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const win = { document: {}, ScratchbonesAccount: { getDyeCatalog: () => [{ id: 'dye_a', acquisition: 'starter' }, { id: 'dye_b', acquisition: 'starter' }, { id: 'dye_c', acquisition: 'rare' }] } };
win.window = win; win.globalThis = win;
vm.createContext(win);
for (const file of ['docs/config/pants-rigs.js', 'docs/js/pants-rig-core.js', 'docs/js/pants-garment-renderer.js']) vm.runInContext(fs.readFileSync(file, 'utf8'), win, { filename: file });
const Renderer = win.PantsGarmentRenderer;
assert(Renderer, 'renderer did not install');

// Shipped data: the starter garment exists with a valid 5-channel weight map, and unknown species fall back to __default.
const rigs = win.HOBUNJI_PANTS_RIGS;
assert(rigs.garments.pants_basic, 'config/pants-rigs.js ships the pants_basic garment');
assert.strictEqual(win.HobunjiPantsRig.decodeWeightGridRle(rigs.garments.pants_basic.weightMap).channels.length, 5);
assert(Renderer.hasRigFor('kenkari', 'male') && Renderer.hasRigFor('some-new-species', 'female'), 'every species resolves to a rig through __default');
assert(Renderer.resolveCharacter('Mao_Ao', 'MALE'), 'species/gender keys are normalized');

// Every humanoid NPC gets the free pants with a deterministic dye; animals and opt-outs do not.
const npc = { id: 'tester', equippedCosmetics: ['tankan_tunic'] };
assert.strictEqual(Renderer.ensureNpcPants(npc), true);
assert(npc.equippedCosmetics.includes('pants_basic') && npc.equippedCosmetics.includes('tankan_tunic'), 'pants are added beside existing clothing');
const dye = npc.appliedDyes.PANTS;
assert(['dye_a', 'dye_b'].includes(dye), 'pants dye comes from the starter cloth dyes');
assert.strictEqual(Renderer.ensureNpcPants(npc), false, 'idempotent');
const again = { id: 'tester' };
Renderer.ensureNpcPants(again);
assert.strictEqual(again.appliedDyes.PANTS, dye, 'the same NPC always gets the same shade');
const authored = { id: 'dyed', appliedDyes: { PANTS: 'dye_c' } };
Renderer.ensureNpcPants(authored);
assert.strictEqual(authored.appliedDyes.PANTS, 'dye_c', 'an authored pants dye is never overwritten');
assert.strictEqual(Renderer.ensureNpcPants({ id: 'banubu', kind: 'animal' }), false, 'animals do not wear pants');
assert.strictEqual(Renderer.ensureNpcPants({ id: 'nopants', noPants: true }), false, 'records can opt out');

// Dye/weave inputs.
assert.deepStrictEqual(JSON.parse(JSON.stringify(Renderer.appearanceFromItem({ colorA: { hex: '#112233' }, colorB: null, colorC: { hex: '#fff000' }, weaving: { layers: {} } }))), { primaryHex: '#112233', secondaryHex: '#112233', patternHex: '#fff000', weaving: { layers: {} } });
assert.strictEqual(Renderer.appearanceFromBodyColors({ PANTS: { hex: '#abcdef' } }).primaryHex, '#abcdef');

// The pants cosmetic is registered so dye/weaving/icons can resolve its art.
const index = JSON.parse(fs.readFileSync('docs/config/cosmetics/index.json', 'utf8'));
const entry = index.entries.find(e => e.id === 'pants_basic');
assert(entry, 'cosmetics/index.json registers pants_basic');
const cosmetic = JSON.parse(fs.readFileSync('docs/config/cosmetics/' + entry.path.replace(/^\.\//, ''), 'utf8'));
assert.strictEqual(cosmetic.slot, 'pants');
assert(cosmetic.parts.pants.layers.base.paletteColorKey === 'A', 'the garment layer takes the primary dye');

console.log('Pants garment wiring: PASS');
