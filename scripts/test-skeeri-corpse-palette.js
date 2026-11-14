#!/usr/bin/env node
'use strict';
// The real flying visual owner must preserve each Skeeri's palette when the body becomes lootable,
// and release those GPU resources as soon as the corpse leaves the authoritative death registry.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const seen = { created: 0, poses: [], disposals: 0 }; // Visible checks of rig lifetime, including corpse-only frames.
const hostiles = new Set(); // Live hostile roster is normally cleared as soon as death begins.
const corpses = new Set(); // CreatureDeath, not the enemy roster, owns the lootable corpse lifetime.
const camera = { getWorldPosition() {} }; // Minimal perspective contract used by the authored renderer.
const world = {
  window: {
    SkeeriRuins: {
      SPECIES: { small: { key: 'skeeri-small' } },
      createRig() {
        seen.created++;
        const rig = {
          root: { parent: null, visible: true, rotation: { y: 0, z: 0 }, scale: { setScalar() {} } },
          update(_camera, pose) { seen.poses.push(pose); },
          restoreTint() { return false; },
          dispose() { seen.disposals++; this.root.parent?.remove(this.root); },
        }; // Represents a separately colored live Skeeri, without mocking the owner under test.
        return Promise.resolve(rig);
      },
    },
    TzatzulRegistration: { KIND: 'tzatzul', HATCHLING_KIND: 'tzatzul-hatchling' },
    CreatureDeath: { getCorpseObjects: () => corpses },
    Combat: { deps: { getActiveCamera: () => camera } },
    __farmLog() {},
  },
  console, Date, Math, Map, Set, Promise, performance: { now: () => 1000 },
};
vm.runInNewContext(fs.readFileSync('docs/js/tzatzul-live-visuals.js', 'utf8'), world);

const group = { parent: {}, children: [], userData: {},
  add(node) { this.children.push(node); node.parent = this; },
  remove(node) { this.children = this.children.filter(child => child !== node); node.parent = null; } }; // The real avatar group holds both original planes and custom rig.
const makePlane = side => ({
  isMesh: true, name: 'skeeri_' + side + '_plane', userData: { hobunjiPlaneFace: side },
  parent: group, visible: true, geometry: { parameters: { height: 1.4 } },
}); // Native default green planes must remain hidden while the colored corpse is visible.
const front = makePlane('front'), back = makePlane('back');group.children.push(front, back);
const bird = {
  id: 'dying-skeeri', creatureKey: 'skeeri-small', isRuinSkeeri: true,
  areaId: 'map_i_dev_random_ruin', avatarRef: { group, frontPlane: front, backPlane: back },
  health: 18, state: 'idle', skeeriFlightPose: 'flap', skeeriDivePitchRad: -.5,
  x: 64, y: 64, def: { modelWidth: 1.4 }, skeeriPalette: { body: '#697a83', pattern: '#486371', eyes: '#30f0ff' },
}; // An ordinary registered ruin bird with a distinct palette that must survive to corpse loot.
hostiles.add(bird);
const visuals = world.window.TzatzulLiveVisuals;
visuals.init({ hostileObjects: hostiles, getCurrentArea: () => bird.areaId });

(async () => {
  visuals.tick(.016, bird.areaId);
  for (let i = 0; i < 8; i++) await Promise.resolve(); // Resolve the actual async mount path.
  visuals.tick(.016, bird.areaId);
  assert.equal(seen.created, 1);
  assert.equal(visuals.snapshot().liveRigs, 1);
  assert.equal(front.visible, false, 'native green sprite is hidden while the Skeeri is alive');

  bird.health = 0; bird.state = 'dying';
  hostiles.delete(bird); corpses.add(bird); // CreatureDeath takes ownership before hostile AI removes the creature.
  visuals.tick(.016, bird.areaId);
  assert.equal(seen.disposals, 0, 'dying Skeeri retain the colored rig instead of exposing an uncolored corpse');
  assert.equal(seen.poses.at(-1), 'perched', 'corpse is rendered with folded wings');
  assert.equal(front.visible, false);
  assert.equal(bird.skeeriDivePitchRad, 0);
  bird.state = 'corpse';
  visuals.tick(.016, bird.areaId);
  assert.equal(visuals.snapshot().tracked, 1, 'a surviving corpse stays tracked until its actual loot cleanup');

  corpses.delete(bird); // Corpse was looted, or removed during an area reroll.
  visuals.tick(.016, bird.areaId);
  assert.equal(seen.disposals, 1, 'finished corpse cleanup disposes GPU materials exactly once');
  assert.equal(front.visible, true, 'native portrait may be restored after the colored corpse is removed');
  assert.equal(visuals.snapshot().tracked, 0, 'no dead Skeeri remain in the live visual scan');
  console.log('Skeeri corpse palette stays visible through looting and disposes without changing other flyers PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
