'use strict';

const fs = require('fs'); // Reads the browser modules exactly as shipped for this lightweight VM regression test.
const vm = require('vm'); // Executes the entourage module without requiring a browser.
const assert = require('assert'); // Verifies coat, owner-follow, and cleanup contracts.

const source = fs.readFileSync('docs/js/jubmir-dabinggi-hounds.js', 'utf8'); // Production module under test.
const loaderSource = fs.readFileSync('docs/js/livestock-nursery-install-bridge.js', 'utf8'); // Ensures the production bootstrap actually loads/installs the module.
const companionObjects = new Set(); // Mock canonical companion collection used by game.js.
const despawned = []; // Records only entities passed through the canonical despawn path.
let openingPhase = 'idle'; // Lets the test enter/leave the rescue-only genotype override deterministically.
let defaultGenotypeCalls = 0; // Proves ordinary default-genotype calls still delegate to the original API.

const window = { // Minimal browser/game global used by the production module.
  __farmLog() {},
  OpeningStoryCutscene: { debugSnapshot: () => ({ phase: openingPhase }) },
  CreatureGenetics: {
    makeDefaultGenotype(kind) {
      defaultGenotypeCalls += 1;
      return { kind, ordinary: true };
    },
  },
};
const walker = { // Jubmir's scheduler walker; root coordinates are tile-space like the real NPC scheduler.
  rec: { id: 'jubmir' },
  area: 'map_hobunji_town',
  rot: 0.5,
  root: { visible: true, position: { x: 10, z: 20 }, rotation: { y: 0.5 } },
};
window._npcWalkers = [walker];
window.Combat = {
  deps: {
    TILE: 32,
    cutscenePreviewActive: false,
    companionObjects,
    makeCreatureEntity(kind, x, y, opts) {
      return { kind, x, y, health: 100, areaId: walker.area, ...opts };
    },
    despawnCreature(creature) {
      creature.despawned = true;
      despawned.push(creature);
    },
  },
};

const context = { window, console, setInterval() { return 1; }, clearInterval() {} }; // Timer stubs keep install-capable code deterministic in Node.
vm.runInNewContext(source, context, { filename: 'jubmir-dabinggi-hounds.js' });
const api = window.JubmirDabinggiHounds; // Public runtime/debug API exposed by the production module.

assert(api, 'JubmirDabinggiHounds API should be exported');
assert.match(loaderSource, /JubmirDabinggiHounds.*jubmir-dabinggi-hounds\.js/, 'feature bootstrap should load the entourage module');
assert.match(loaderSource, /window\.JubmirDabinggiHounds\?\.install\?\.\(\)/, 'feature bootstrap should install the entourage module');

const coat = api.makeJubmirHoundGenotype(); // Shared authored coat used by roaming and rescue hounds.
assert.equal(coat.base.color, '#4f3f36');
assert.equal(coat.stripes.color, '#ae8430');
assert.equal(coat.stripes.enabled, true);
assert.equal(coat.stripes.copies, 2);
assert.equal(coat.mitts.enabled, false);
assert.equal(coat.spectacles.enabled, false);

api.__test.installGeneticsOverride();
openingPhase = 'rescue';
const rescueCoat = window.CreatureGenetics.makeDefaultGenotype('dabinggi-hound'); // The cutscene runtime asks only for a default genotype, so rescue phase supplies the authored pair coat here.
assert.equal(rescueCoat.base.color, coat.base.color);
assert.equal(rescueCoat.stripes.color, coat.stripes.color);
assert.equal(defaultGenotypeCalls, 0, 'rescue dabinggi should not consume an ordinary random/default genotype');
assert.deepEqual(window.CreatureGenetics.makeDefaultGenotype('gar-wolf'), { kind: 'gar-wolf', ordinary: true });
openingPhase = 'idle';
assert.deepEqual(window.CreatureGenetics.makeDefaultGenotype('dabinggi-hound'), { kind: 'dabinggi-hound', ordinary: true });
assert.equal(defaultGenotypeCalls, 2, 'all non-rescue/default calls should delegate unchanged');

assert.equal(api.sync(), true, 'Jubmir should acquire both hounds when his live walker is present');
assert.equal(companionObjects.size, 2);
const spawned = [...companionObjects]; // Stable snapshot used for identity/owner assertions across a second sync.
assert(spawned.every(hound => hound.isCompanion));
assert(spawned.every(hound => hound.npcCompanionOwnerId === 'jubmir'));
assert(spawned.every(hound => hound.master === spawned[0].master));
assert(spawned.every(hound => hound.genotype.base.color === '#4f3f36'));
assert(spawned.every(hound => hound.genotype.stripes.color === '#ae8430'));
assert.equal(spawned[0].master.x, 320);
assert.equal(spawned[0].master.y, 640);
assert.deepEqual(spawned.map(hound => hound.npcCompanionSlot).sort(), [0, 1]);

walker.root.position.x = 11;
walker.root.position.z = 21;
assert.equal(api.sync(), true, 'existing hounds should remain active while Jubmir moves');
assert.equal(companionObjects.size, 2, 'movement must not duplicate the pair');
assert(spawned.every(hound => companionObjects.has(hound)), 'movement should retain both creature instances');
assert.equal(spawned[0].master.x, 352);
assert.equal(spawned[0].master.y, 672);

window.Combat.deps.cutscenePreviewActive = true;
assert.equal(api.sync(), false, 'authored cutscenes should own their creature cast without duplicate roaming hounds');
assert.equal(companionObjects.size, 0);
assert.equal(despawned.length, 2);
assert(spawned.every(hound => hound.despawned));

console.log('Jubmir dabinggi hound entourage passed');
