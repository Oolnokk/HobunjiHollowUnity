#!/usr/bin/env node
'use strict';

// Combat attach attacks (js/combat/combat-attach.js): a creature climbs onto one
// target, takes its place for a while, ticks an effect onto it, is immune to that
// host's own attacks, can still be hurt by others, and ends cleanly. Also covers
// the honeyfuzzle Swarm built on it and a second, differently-configured attack to
// prove the mechanic is reusable. Runs the real modules.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const read = file => fs.readFileSync(file, 'utf8');

const TILE = 40;
function world() {
  const calls = { creature: [], player: [], spent: [] };
  const player = { x: 400, y: 400, health: 100, facing: 0, areaId: 'z' };
  const hostileObjects = new Set(), companionObjects = new Set();
  const deps = {
    TILE, player, players: [player], hostileObjects, companionObjects,
    canOccupyAt: () => true,
    damageCreature: (target, amount, fx, fy, kb, opts) => { calls.creature.push({ target, amount, fx, fy, kb, opts }); },
    damagePlayer: (amount, fx, fy, kb, opts) => { calls.player.push({ amount, fx, fy, kb, opts }); },
    requestThreatGrowl() {},
  };
  const context = { console, Math, performance: { now: () => 0 }, Combat: { deps } };
  context.window = context;
  context.ResourceSystem = { afflictionBonusesForTag: tag => (tag === 'poison' ? { poisonedHealth: 0.28 } : null), spendStamina: (c, n) => calls.spent.push(n) };
  vm.createContext(context);
  vm.runInContext(read('docs/js/combat/combat-animal-attacks.js'), context, { filename: 'combat-animal-attacks.js' });
  vm.runInContext(read('docs/js/combat/combat-attach.js'), context, { filename: 'combat-attach.js' });
  const make = (props = {}) => ({ x: 0, y: 0, health: 30, facing: 0, areaId: 'z', halfHeight: 0.6, visualScaleY: 1, groundLift: 0.3, def: { attackDamage: 5, attackTag: 'poison' }, attackCooldownT: 0, ...props });
  return { context, calls, deps, player, hostileObjects, companionObjects, make, Combat: context.Combat };
}
const same = (list, expected, message) => assert(list.length === expected.length && expected.every((item, i) => list[i] === item), message || 'same members'); // Entities are cyclic and cross a vm context; compare by identity.
const run = (w, c, seconds, dt = 0.05) => { for (let t = 0; t < seconds; t += dt) w.Combat.animalAttacks.update(c, dt); };

// ---- attach to a hostile host ---------------------------------------------------
{
  const w = world();
  const host = w.make({ x: 300, y: 200, def: { attackDamage: 8, attackTag: 'sharp' }, halfHeight: 0.9 });
  const swarm = w.make({ x: 330, y: 200, isCompanion: true, def: { attackDamage: 5, attackTag: 'poison' } });
  w.hostileObjects.add(host);
  assert.equal(w.Combat.animalAttacks.start(swarm, 'swarm', { target: host }), true);
  assert.equal(w.Combat.animalAttacks.isBusy(swarm), true, 'the creature is busy for the whole attachment');
  assert.equal(w.Combat.attach.isAttached(swarm), false, 'still approaching');
  run(w, swarm, 0.4);
  assert.equal(w.Combat.attach.isAttached(swarm), true, 'it reaches the target and attaches');
  assert.equal(w.Combat.attach.hostOf(swarm), host);
  same(w.Combat.attach.attachersOf(host), [swarm]);
  // The swarm inherits the host's X/Y and occupies its visible body center,
  // correcting for its own hovering wing-cloud pivot rather than sitting above the head.
  w.deps.getActorWorldY = actor => actor === host ? 2.83 : 0.85;
  w.deps.worldSurfaceY = () => 2;
  swarm.avatarRef = { group: { position: { y: 0 }, scale: { y: 1 } }, frontPlane: { position: { y: 0.12 } } };
  host.x = 360; host.y = 260; host.facing = 1.2;
  run(w, swarm, 0.05);
  assert.deepEqual([swarm.x, swarm.y, swarm.facing], [360, 260, 1.2]);
  assert(Math.abs(swarm._banditLungeHopCurrent - (0.41 + 1.8 * 0.375)) < 1e-9, 'upper-quarter anchor minus the swarm floor lift and hover pivot');
  assert(Math.abs(swarm.avatarRef.group.position.y - (2.71 + 1.8 * 0.375)) < 1e-9, 'visible wing cloud sits exactly at host world-Y center');
  assert.equal(swarm._attachVisualSpread, 0.71, 'attachment is less densely clustered than ordinary flight');
  host.y += 40; run(w, swarm, 0.05);
  assert.equal(swarm.y, host.y, 'swarm tracks the target as it moves');
  // Ticks: little direct damage, a heavy poison multiplier, no stagger or knockback.
  w.calls.creature.length = 0;
  run(w, swarm, 2);
  assert(w.calls.creature.length >= 3 && w.calls.creature.length <= 5, `ticks about every half second (${w.calls.creature.length})`);
  for (const hit of w.calls.creature) {
    assert.equal(hit.target, host);
    assert.equal(hit.amount, 5 * 0.3, 'low direct damage');
    assert.equal(hit.opts.tag, 'poison');
    assert.equal(hit.opts.afflictionBonuses.poisonedHealth, 3, 'a heavy Poisoned Health buildup');
    assert.equal(hit.opts.noStagger, true); assert.equal(hit.kb, 0); assert.equal(hit.opts.attacker, swarm);
  }
  assert(w.calls.creature[0].amount * w.calls.creature[0].opts.afflictionBonuses.poisonedHealth > 3 * w.calls.creature[0].amount * 0.9, 'poison buildup dwarfs direct damage');
  // Immune to its host; vulnerable to everyone else; staggerless while attached.
  const other = w.make({ x: 380, y: 260 });
  assert.equal(w.Combat.attach.blocksDamage(swarm, { attacker: host }, host.x, host.y), true, 'immune to the host\'s named attacks');
  assert.equal(w.Combat.attach.blocksDamage(swarm, {}, host.x + 5, host.y), true, 'immune to an unnamed hit that starts on the host');
  assert.equal(w.Combat.attach.blocksDamage(swarm, {}, host.x + 200, host.y), false, 'an unnamed hit from far away is somebody else\'s');
  assert.equal(w.Combat.attach.blocksDamage(swarm, { attacker: other }, host.x, host.y), false, 'other creatures can hurt it');
  assert.equal(w.Combat.attach.blocksDamage(swarm, { attacker: swarm, attachTick: true }, host.x, host.y), false);
  assert.equal(w.Combat.attach.suppressesStagger(swarm), true);
  // Friendly fire: the host swats at what is on it, hitting nearby allies but not the swarm, other riders, or the far.
  const ally = w.make({ x: 380, y: 270 }), farAlly = w.make({ x: 900, y: 900 }), rider2 = w.make({ x: 0, y: 0, isCompanion: true });
  w.hostileObjects.add(ally); w.hostileObjects.add(farAlly); w.hostileObjects.add(swarm); w.hostileObjects.add(rider2);
  w.Combat.animalAttacks.start(rider2, 'swarm', { target: host }); run(w, rider2, 0.8);
  w.calls.creature.length = 0; w.calls.player.length = 0;
  run(w, swarm, 1.0);
  const swats = w.calls.creature.filter(hit => hit.opts.attacker === host);
  assert(swats.length >= 1, 'the swarmed host flails');
  assert(swats.every(hit => hit.target === ally), 'only a nearby ally is struck (not the swarm, the other rider, the far ally or the host)');
  assert(swats[0].amount > 0 && swats[0].opts.attacker === host);
  assert.equal(w.calls.player.length, 0, 'the swat does not hit the player\'s side unless configured to');
  // It ends on time, sets down beside the host and rests before the next one.
  run(w, swarm, 6);
  assert.equal(w.Combat.animalAttacks.isBusy(swarm), false);
  assert.equal(swarm._attachment, null); assert.equal(swarm._banditLungeHopCurrent, 0);
  assert(Math.hypot(swarm.x - host.x, swarm.y - host.y) > TILE * 0.5, 'set down beside the host, not inside it');
  assert(swarm.attackCooldownT >= 5, 'cools down before swarming again');
  assert.equal(w.Combat.attach.suppressesStagger(swarm), false);
  same(w.Combat.attach.attachersOf(host), [rider2], 'only the other rider remains');
  // Immunity is gone once it lets go.
  assert.equal(w.Combat.attach.blocksDamage(swarm, { attacker: host }, host.x, host.y), false);
}

// ---- centered visual position: first frame, varied terrain, zero lift ---------------
{
  const w = world();
  const host = w.make({ x: 120, y: 160, halfHeight: 0.85 });
  const swarm = w.make({ x: 125, y: 160, groundLift: 0, avatarRef: {
    group: { position: { y: 0 }, scale: { y: 1.5 } },
    frontPlane: { position: { y: 0.12 } },
  } });
  let centerY = 4; // Simulates the rendered host center during this attack.
  let groundY = 3; // Simulates the actual world surface beneath the swarmed target.
  w.deps.getActorWorldY = actor => actor === host ? centerY : undefined;
  w.deps.worldSurfaceY = () => groundY;
  w.Combat.animalAttacks.start(swarm, 'swarm', { target: host });
  run(w, swarm, 0.05);
  assert.equal(w.Combat.attach.isAttached(swarm), true, 'attaches on the first contact frame');
  assert(Math.abs(swarm._banditLungeHopCurrent - (0.82 + 1.7 * 0.375)) < 1e-9, 'authored zero ground lift is preserved');
  assert(Math.abs(swarm.avatarRef.group.position.y + 0.12 * 1.5 - centerY - 1.7 * 0.375) < 1e-9,
    'visible cloud, not avatar root, is centered on host on initial contact');
  assert.equal(swarm._attachVisualSpread, 0.71, 'the revised dense state applies on the first attached frame');
  centerY = 5.5; groundY = 3.5; host.x = 200;
  run(w, swarm, 0.05);
  assert.equal(swarm.x, host.x, 'tracks moving target immediately');
  assert(Math.abs(swarm._banditLungeHopCurrent - (1.82 + 1.7 * 0.375)) < 1e-9, 'tracks changing vertical world elevation');
  assert(Math.abs(swarm.avatarRef.group.position.y + 0.18 - centerY - 1.7 * 0.375) < 1e-9,
    'tracks the updated rendered center despite a terrain-height change');
  w.Combat.animalAttacks.cancel(swarm);
  assert.equal(swarm._banditLungeHopCurrent, 0, 'returns to ordinary floor height when detached');
  assert.equal(swarm._attachVisualSpread, 1, 'returns to ordinary free-flight spread when detached');
}

// ---- ending early -------------------------------------------------------------------
{
  const w = world();
  const host = w.make({ x: 100, y: 100 }), c = w.make({ x: 110, y: 100, isCompanion: true });
  w.Combat.animalAttacks.start(c, 'swarm', { target: host }); run(w, c, 0.5);
  assert.equal(w.Combat.attach.isAttached(c), true);
  host.health = 0; run(w, c, 0.1);
  assert.equal(w.Combat.animalAttacks.isBusy(c), false, 'ends when the host dies');
  same(w.Combat.attach.attachersOf(host), []);

  const host2 = w.make({ x: 100, y: 100 }), c2 = w.make({ x: 110, y: 100 });
  w.Combat.animalAttacks.start(c2, 'swarm', { target: host2 }); run(w, c2, 0.5);
  w.Combat.animalAttacks.cancel(c2);
  assert.equal(c2._attachment, null); same(w.Combat.attach.attachersOf(host2), [], 'cancelling cleans up both sides');

  const host3 = w.make({ x: 100, y: 100, areaId: 'z' }), c3 = w.make({ x: 110, y: 100 });
  w.Combat.animalAttacks.start(c3, 'swarm', { target: host3 }); run(w, c3, 0.5);
  host3.areaId = 'elsewhere'; run(w, c3, 0.1);
  assert.equal(w.Combat.animalAttacks.isBusy(c3), false, 'ends when the host leaves the area');

  // A dead or already-ridden target is not attachable; a host is limited in riders.
  const dead = w.make({ health: 0 }), c4 = w.make();
  w.Combat.animalAttacks.start(c4, 'swarm', { target: dead }); run(w, c4, 0.1);
  assert.equal(w.Combat.animalAttacks.isBusy(c4), false, 'nothing to attach to');
  const crowded = w.make({ x: 50, y: 50 });
  const riders = [0, 1, 2, 3].map(() => w.make({ x: 55, y: 50 }));
  for (const r of riders) { w.Combat.animalAttacks.start(r, 'swarm', { target: crowded }); run(w, r, 0.1); }
  assert.equal(w.Combat.attach.attachersOf(crowded).length, 3, 'at most three riders per host');
  const rider = riders[0], b = w.make();
  w.Combat.animalAttacks.start(b, 'swarm', { target: rider }); run(w, b, 0.1);
  assert.equal(w.Combat.animalAttacks.isBusy(b), false, 'a rider cannot be a host');
}

// ---- player host ------------------------------------------------------------------------
{
  const w = world();
  const swarm = w.make({ x: 420, y: 400, avatarRef: {
    group: { position: { y: 0 }, scale: { y: 1 } }, frontPlane: { position: { y: 0.12 } },
  } });
  w.deps.getActorWorldY = actor => actor === w.player ? 1.25 : undefined;
  w.deps.worldSurfaceY = () => 0.8;
  w.Combat.animalAttacks.start(swarm, 'swarm', { target: w.player }); run(w, swarm, 0.5);
  assert.equal(w.Combat.attach.isAttached(swarm), true);
  assert.deepEqual([swarm.x, swarm.y], [400, 400], 'sits on the player');
  assert(Math.abs(swarm.avatarRef.group.position.y + 0.12 - 1.25 - 1.7 * 0.375) < 1e-9,
    'swarm overlays the actual player avatar center instead of their head');
  w.calls.player.length = 0; run(w, swarm, 1.2);
  assert(w.calls.player.length >= 2);
  assert(Math.abs(w.calls.player[0].amount - 5 * 0.3 * 0.6) < 1e-9, 'softened against the player');
  for (const hit of w.calls.player) {
    assert.equal(hit.kb, 0); assert.equal(hit.opts.noStagger, true); assert.equal(hit.opts.tag, 'poison'); assert.equal(hit.opts.afflictionBonuses.poisonedHealth, 3);
  }
  assert.equal(w.calls.creature.length, 0, 'ticks go through damagePlayer, not damageCreature');
  assert.equal(w.Combat.attach.blocksDamage(swarm, {}, w.player.x + 300, w.player.y), true, 'the player\'s own (unnamed) attacks cannot hurt it');
  assert.equal(w.Combat.attach.blocksDamage(swarm, { attacker: w.make() }, 0, 0), false, 'but a creature can');
  run(w, swarm, 7);
  assert.equal(w.Combat.attach.isAttached(swarm), false);
}

// ---- rescue pet/NPC tests: identical hit scaled only against host ----------------
{
  const w = world();
  const pet = w.make({ x: 405, y: 400, isCompanion: true, master: w.player, stableRole: 'companion', def: { attackDamage: 20, attackTag: 'poison', attackCooldownS: 1.4 } });
  const swarm = w.make({ x: 407, y: 400 });
  w.companionObjects.add(pet); w.hostileObjects.add(swarm);
  assert(w.Combat.animalAttacks.start(swarm, 'swarm', { target: w.player }));
  run(w, swarm, 0.15);
  assert.equal(w.Combat.attach.isAttached(swarm), false, 'pet rescue detaches the swarm');
  assert.equal(w.Combat.animalAttacks.isBusy(swarm), false);
  assert.equal(w.calls.creature.length, 1);
  assert.equal(w.calls.creature[0].target, swarm);
  assert.equal(w.calls.creature[0].amount, 20);
  assert.equal(w.calls.creature[0].kb, 260);
  assert.equal(w.calls.player.length, 1);
  assert.equal(w.calls.player[0].amount, 5, 'pet deals quarter Health damage to player');
  assert.equal(w.calls.player[0].kb, 65, 'pet deals quarter knockback to player');
  assert.equal(w.calls.player[0].opts.noStagger, undefined, 'rescue knockback is not suppressed');
  assert.equal(w.calls.player[0].opts.afflictionBonuses.poisonedHealth, w.calls.creature[0].opts.afflictionBonuses.poisonedHealth,
    'quarter damage with the original affliction coefficient gives quarter buildup');
  assert(pet.attackCooldownT >= 1.4);
  assert(!pet._honeyfuzzleRescueTarget);
}
{
  const w = world();
  const host = w.make({ x: 120, y: 200, banditCampInstanceId: 'red' });
  const ally = w.make({ x: 125, y: 200, banditCampInstanceId: 'red', def: { attackDamage: 12, attackTag: 'sharp' } });
  const outsider = w.make({ x: 121, y: 200, banditCampInstanceId: 'blue', def: { attackDamage: 30, attackTag: 'sharp' } });
  const swarm = w.make({ x: 125, y: 200 });
  [host, ally, outsider, swarm].forEach(c => w.hostileObjects.add(c));
  assert(w.Combat.animalAttacks.start(swarm, 'swarm', { target: host }));
  run(w, swarm, 0.15);
  assert.equal(w.Combat.attach.isAttached(swarm), false, 'an NPC ally rescues their swarmed companion');
  assert.equal(w.calls.creature.filter(hit => hit.target === host).length, 1);
  assert.equal(w.calls.creature.find(hit => hit.target === host).amount, 3);
  assert.equal(w.calls.creature.find(hit => hit.target === host).kb, 65);
  assert.equal(w.calls.creature.find(hit => hit.target === swarm).amount, 12);
  assert.equal(w.calls.creature.find(hit => hit.target === swarm).opts.attacker, ally, 'only same-camp ally attacks');
}

// ---- reusable: a second, different attach attack ------------------------------------------
{
  const w = world();
  const ticks = [];
  w.Combat.attach.register('leech', {
    label: 'Leech', durationS: 2, tickIntervalS: 0.25, immuneToHost: false, staggerImmune: false,
    onTick: (c, host) => ticks.push([c, host]),
  });
  const host = w.make({ x: 100, y: 100 }), leech = w.make({ x: 110, y: 100 });
  w.Combat.animalAttacks.start(leech, 'leech', { target: host }); run(w, leech, 0.5);
  assert.equal(w.Combat.attach.isAttached(leech), true);
  assert.equal(w.Combat.attach.blocksDamage(leech, { attacker: host }, host.x, host.y), false, 'immunity is opt-in per attack');
  assert.equal(w.Combat.attach.suppressesStagger(leech), false);
  assert(Math.abs(leech._banditLungeHopCurrent - 1.0) < 1e-9,
    'non-swarm attach attacks preserve the original above-head +0.1 height');
  run(w, leech, 3);
  assert(ticks.length >= 4 && ticks.every(([c, h]) => c === leech && h === host), 'its own onTick ran instead of the default');
  assert.equal(w.calls.creature.length, 0, 'no default damage when the attack supplies its own tick');
  assert.equal(w.Combat.animalAttacks.isBusy(leech), false);
  assert.equal(w.Combat.attach.config('leech').durationS, 2);
  assert(Math.abs(leech._banditLungeHopCurrent) < 1e-9, 'legacy rider height clears on detach');
}

// ---- authored config ----------------------------------------------------------------------------
{
  const w = world();
  const authored = JSON.parse(read('docs/config/combat/attack-values.json'));
  assert.equal(authored.creatureAttacks.swarm.tick.afflictionBonuses.poisonedHealth, 3);
  assert(authored.creatureBehaviors.territorial.species.includes('honeyfuzzle'), 'honeyfuzzles defend their hive territorially');
  w.Combat.animalAttacks.applyConfig({ swarm: { durationS: 2, tick: { damageScale: 0.5 } } });
  const cfg = w.Combat.attach.config('swarm');
  assert.equal(cfg.durationS, 2); assert.equal(cfg.tick.damageScale, 0.5); assert.equal(cfg.tick.afflictionBonuses.poisonedHealth, 3, 'unspecified tuning keeps its defaults');
  w.Combat.animalAttacks.applyConfig(authored.creatureAttacks);
  const loaded = w.Combat.attach.config('swarm');
  assert.equal(loaded.durationS, 6); assert.equal(loaded.hostReaction.kind, 'flail'); assert.equal(loaded.tick.playerScale, 0.6);
  assert.equal(loaded.verticalAnchor, 'center'); assert.equal(loaded.heightAboveHost, 0);
  assert.equal(loaded.visualSpreadScale, 0.42, 'authoring keeps the compact attached-state visual');
}

// Companion Swarm must use its own flying approach rather than taking an
// extra ground-combat lunge before attaching to the target.
{
  const w = world();
  const host = w.make({ x: TILE * 3, y: 0 }); // Beyond ordinary melee range, still within the enlarged engagement window.
  const flyer = w.make({
    x: 0, y: 0, isCompanion: true,
    def: { attackDamage: 5, attackRangePx: TILE, attackTag: 'poison' },
  }); // The attached creature is the only state owner for this special.
  w.Combat.animalAttacks.start(flyer, 'swarm', { target: host });
  assert.equal(flyer._animalAttack.approach, null, 'Swarm has no generic ground-lunge stage');
  assert.equal(flyer._animalAttack.state.stage, 'approach', 'the authored attachment approach begins immediately');
  w.Combat.animalAttacks.update(flyer, 0.12);
  assert(flyer.x >= TILE * 2.5, 'companion swarm flies most of the gap in a single weapon-speed burst');
  w.Combat.animalAttacks.cancel(flyer);
}
console.log('combat attach: ok');
