'use strict';
// Browser-free behavioral regression for global perches and the shared airborne
// lunge wall impact. Run: node scripts/test-global-perch-aerial-impact.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const read = path => fs.readFileSync(path, 'utf8'); // Single authoritative repo source for every fixture.
const w = {
  __farmLog() {},
  ResourceSystem: {
    tick() { return 'ticked'; },
    applyDamage(actor, amount) { actor.health = Math.max(0, actor.health - amount); return amount; },
    spendFooting(actor, amount) { actor.footing = (actor.footing ?? 100) - amount; return amount; },
    addAffliction(actor, id, amount) {
      actor.afflictions ??= {};
      actor.afflictions[id] = (actor.afflictions[id] || 0) + amount;
      return amount;
    },
    enforceCaps() {},
  },
  RangedWeapons: { init() {} },
}; // Minimal real-module host; resource and movement callbacks retain their gameplay semantics.
const context = { window: w, console, Math, Date, Map, Set, THREE: {}, queueMicrotask };
function load(path) { vm.runInNewContext(read(path), context, { filename: path }); }
load('docs/js/perch-support.js');
load('docs/js/climb-system.js');
const tile = 64; // Matches game logical pixel-to-tile conversion for the test scenarios.
const mapId = 'map_northern_cliffs'; // Area-scoped Shadewood registry test must not depend on the current player map.
w.ClimbSystem.init({
  clamp: (x, a, b) => Math.max(a, Math.min(b, x)),
  TILE: tile, getCurrentArea: () => mapId, worldSurfaceY: () => 0,
  player: {}, hostileObjects: [], companionObjects: []
});
const branch = { id: mapId + ':1,3', col: 1, row: 3,
  baseX: 96, baseY: 200, tipX: 160, tipY: 200,
  baseWorldY: 4, tipWorldY: 5, length: 64 }; // Existing Shadewood 1D support.
w.ClimbSystem.registerBranch(mapId, branch);
assert.equal(w.PerchSupport.debugSnapshot().areas.find(a => a.id === mapId)?.supports, 1,
  'native Shadewood registration also registers global line support');
const actor = { health: 30, footing: 100, x: 0, y: 0 }; // Shared live creature fixture.
assert(w.PerchSupport.attach(actor, w.PerchSupport.point('stone-perch', 50, 60, 5)));
assert.equal(actor.onBranch?.perchSupport, true, 'point uses native height/render/movement support');
assert.equal(actor.branchSurfaceY, 5);
w.ClimbSystem.constrainEntityToBranch(actor);
assert.deepEqual([actor.x, actor.y], [50, 60], '0D perch cannot be walked off');
assert.equal(w.ClimbSystem.resolveBranchKnockback(actor, 0, 0, 0.01)?.fell, true,
  'even minimal knockback immediately ejects the creature');
assert.equal(actor.onPerch, null);
assert.equal(actor.onBranch, null);
assert.equal(actor.health, 30, 'game-owned ledge damage is deferred, not double-applied by the perch');
assert.equal(actor.footing, 100);
assert(w.PerchSupport.attach(actor, w.PerchSupport.line('wall-ledge',
  { x: 0, y: 0, worldY: 2 }, { x: 100, y: 0, worldY: 3 }), .4));
assert.equal(actor.x, 40);
actor.x = 70;
w.ClimbSystem.constrainEntityToBranch(actor);
w.PerchSupport.constrain(actor);
assert(Math.abs(actor.x - 70) < 1e-6);
assert(Math.abs(actor.perchT - 0.7) < 1e-6, 'native branch movement updates the 1D perch coordinate');
load('docs/js/prone-motion-exclusivity.js');
actor.prone = true;
assert.equal(w.ResourceSystem.tick(actor, 0.016), 'ticked');
assert.equal(actor.onPerch, null);
assert.equal(actor.onBranch, null);
assert.equal(actor.health, 26, 'prone releases from elevated perch with ordinary branch-fall Health');
assert.equal(actor.footing, 52.5, 'prone branch-fall Footing penalty is applied exactly once');
w.ClimbSystem.removeBranchesInBounds(mapId, { colStart: 1, rowStart: 3, colEnd: 2, rowEnd: 4 });
assert.equal(w.PerchSupport.debugSnapshot().areas.some(a => a.id === mapId), false,
  'streamed-out Shadewood supports do not leak across chunk rebuilds');
assert.match(read('docs/js/creature-death.js'), /PerchSupport\?\.release\?\.\(c, 'died on perch'\)/,
  'real corpse transition releases perched creatures');

load('docs/js/combat/knockback-collision-impact.js');
const collided = { health: 100, footing: 100 };
const movement = { airborne: true, lungeMaxDistancePx: 128, lungeTraveledPx: 0 };
const impact = w.KnockbackCollisionImpact.resolveAerialLunge(
  collided, movement, { kind: 'stone', label: 'Wall' }, tile, {
    dealHealthDamage(target, amount) {
      target.health -= amount;
      return { applied: amount, lethal: false };
    }
  }
);
assert.equal(impact.mode, 'aerial-lunge');
assert.equal(impact.deficitTiles, 2);
assert.equal(collided.health, 92);
assert.equal(w.KnockbackCollisionImpact.resolveAerialLunge(collided, movement, { kind: 'stone' }, tile), null,
  'impact cannot repeat during the same lunge');
assert.equal(w.KnockbackCollisionImpact.resolveAerialLunge(collided,
  { airborne: false, lungeMaxDistancePx: 128, lungeTraveledPx: 0 }, { kind: 'stone' }, tile), null,
'grounded attacks do not self-collide');

const player = { x: 0, y: 0, health: 100, footing: 100, lunging: false, lungeT: 0, lungeDur: 0, lungeHeightUnits: 1 };
let pointY = 4; // Switches between upward aim and flat aim in the same injected camera contract.
let healthHits = 0; // Confirms exactly one environmental Health impact after sustained wall obstruction.
const combatDeps = {
  player, TILE: tile, hostileObjects: [], getCurrentArea: () => 'arena',
  getActorWorldY: () => 0,
  getPlayerPerspectiveTarget: () => ({ point: { x: 9, y: pointY, z: 0 } }),
  beginCombatLunge(distance, duration, hop, hitTest) {
    player.lunging = true;
    player.lungeT = duration; player.lungeDur = duration;
    player.lungeStartX = player.x; player.lungeStartY = player.y;
    player.lungeDistancePx = distance; player.lungeHitTest = hitTest;
    return true;
  },
  damagePlayer(amount) { healthHits++; player.health -= amount; },
};
w.Combat = {
  init(injected) { this.deps = injected; },
  update() {},
  meleeLungeProfile(distance, pitch) {
    return { distancePx: 128, pitch, hopUnits: 0, directFlightStrength: 1, verticalTravelUnits: 2 };
  },
};
load('docs/js/combat/combat-camera-alignment-bridge.js');
w.Combat.init(combatDeps);
assert.equal(!!w.Combat.deps.beginCombatLunge.__hobunjiCameraAuthoredLunge, true);
const hitTest = () => ({ rangePx: 32, halfConeRad: 0.25 });
combatDeps.beginCombatLunge(128, 0.4, 0, hitTest());
player.lungeT = 0.3; w.Combat.update(0.016);
player.lungeT = 0.2; w.Combat.update(0.016);
assert.equal(player.lunging, false, 'blocked upward player lunge stops');
assert.equal(player.health, 92, 'unused two-tile travel applies shared stone collision Health once');
assert.equal(healthHits, 1);
assert.equal(w.KnockbackCollisionImpact.debugSnapshot().mode, 'aerial-lunge');
// Normal unblocked travel follows the same cubic curve and must not get
// mistaken for a collision; the reticle volume contains no hostile in this fixture.
player.x = 0; player.y = 0; player.lunging = false; player.health = 100;
combatDeps.beginCombatLunge(128, 0.4, 0, hitTest());
player.lungeT = 0.3; player.x = 128 * (1 - 0.75 ** 3); w.Combat.update(0.016);
player.lungeT = 0.2; player.x = 128 * (1 - 0.5 ** 3); w.Combat.update(0.016);
assert.equal(healthHits, 1, 'unblocked upward travel has no wall impact');
// Explicit strike-volume stop is intentional, not a wall collision.
player.lunging = false; player.x = 0; player.health = 100;
combatDeps.beginCombatLunge(128, 0.4, 0, hitTest());
player.lungeDistancePx = 0; player.lungeHitTest = null;
player.lungeT = .3; w.Combat.update(.016);
player.lungeT = .2; w.Combat.update(.016);
assert.equal(healthHits, 1, 'enemy-range lunge stop does not rebound');
// Direct-flight strength alone is insufficient: horizontal aim is grounded.
player.lunging = false; player.x = 0; pointY = 0.55;
combatDeps.beginCombatLunge(128, .4, 0, hitTest());
player.lungeT = .3; w.Combat.update(.016);
player.lungeT = .2; w.Combat.update(.016);
assert.equal(healthHits, 1, 'flat player lunge is excluded');

const editor = read('docs/tools/furniture-avatar-author/index.html');
const spikes = read('docs/tools/furniture-avatar-author/ice-stalagmites.js');
assert.match(editor, /stoneStalagmiteAutoBlade:autoStoneBlade/);
assert.doesNotMatch(spikes, /state\.bladedHazard\s*=\s*true/,
  'generating and removing sharp stone layers never silently overwrites manual furniture hazard');
console.log('Global perch support, shared aerial collision, player wall/target discrimination and sharp-stone provenance PASS.');
