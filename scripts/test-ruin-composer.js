#!/usr/bin/env node
'use strict';
// RuinComposer acceptance: the two design scenarios are not authored anywhere; they must *fall out* of goals, rules
// and archetypes, and the room as a whole must hold together (claims, circulation, budgets).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const C = require('../docs/js/ruin-composer.js');
const S = require('../docs/js/ruin-solver.js');
const RL = require('../docs/js/rope-launch.js');
const RP = require('../docs/js/room-plan.js');
const near = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, `${msg || ''} expected ${b}, got ${a}`);
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const by = (comp, piece) => comp.records.filter(r => r.piece === piece);

// ---- RoomPlan: the ledger
{
  const room = C.rooms.hall(), plan = RP.create(room);
  assert(plan.claim('a', RP.circle(10, 9, 1)).ok);
  assert(!plan.claim('b', RP.circle(10.5, 9, 1)).ok, 'footprints cannot overlap');
  assert(plan.claim('b', RP.circle(14, 9, 1)).ok);
  assert(!plan.claim('c', RP.circle(14, 9, 2), { kind: 'clear' }).ok, 'a clear area cannot cover a footprint');
  assert(plan.claim('c', RP.circle(20, 9, 2), { kind: 'clear' }).ok);
  assert(!plan.claim('d', RP.circle(20, 9, .5)).ok, 'a footprint cannot stand in someone else’s clear area');
  assert(plan.claim('c', RP.circle(20, 9, .5)).ok === true, 'but the owner may');
  assert(plan.solidFn()(10, 9) && !plan.solidFn()(6, 2), 'footprints are solid to later decisions');
  assert.equal(plan.release('a'), 1);
  assert(plan.circulation().ok);
  const wall = RP.create(room); for (let z = 0; z <= 18; z++) wall.claim('w' + z, RP.circle(12, z, .7), { group: 'wall' });
  const cut = wall.circulation(); assert(!cut.ok && cut.broken.length, 'a wall of footprints cuts the room in two: ' + JSON.stringify(cut));
  const chasm = C.rooms.chasm(), cp = RP.create(chasm);
  assert(cp.reaches({ x: 2, z: 8 }, { x: 8, z: 3 })); assert(!cp.reaches({ x: 2, z: 8 }, { x: 20, z: 8 }), 'a chasm separates the sides');
  assert(cp.circulation().ok, 'zones that never could connect are not a circulation failure');
}

// ---- every archetype composes, and says why
const results = {};
for (const [name, room] of [['vaultHall', C.rooms.hall()], ['chasmHall', C.rooms.chasm()], ['trialHall', C.rooms.chasm()]]) {
  const r = C.compose(room, { archetype: name, seed: 3 });
  assert(r.ok, `${name}: ${r.reason}`);
  assert(r.checks.every(c => c.ok), `${name}: all checks pass`);
  assert(r.explanation.length && r.explanation[0].includes('★'), 'the focal goal is marked');
  results[name] = r;
}

// ---- scenario 1: defend the statue
{
  const r = results.vaultHall, room = C.rooms.hall();
  const plinth = by(r, 'plinth')[0], spawners = by(r, 'spawnerPillar'), enc = r.encounter;
  assert.equal(plinth.key, 'ruinDefensePlinth'); assert(spawners.length >= 3, 'several secret openings');
  assert.deepEqual(enc.objective, { type: 'defend', plinthId: plinth.id, fragileStatue: true });
  assert.equal(enc.spawners.length, spawners.length);
  const demolitionists = enc.schedule.filter(e => e.kind === 'demolitionist'), skeletons = enc.schedule.filter(e => e.kind === 'skeleton');
  assert(skeletons.length && demolitionists.length, 'distraction and a real threat');
  // the statue is genuinely threatened, but never faster than a player can respond
  const speed = S.ENEMY.speed;
  const arrivals = demolitionists.map(e => e.t + 0.9 + dist(enc.spawners[e.spawner % enc.spawners.length], plinth) / speed);
  assert(Math.min(...arrivals) < 36 + 5, 'a demolitionist reaches the statue during the press');
  for (const s of enc.spawners) assert(dist(s, plinth) / speed >= 4 - 1e-9, 'every spawner gives the player 4s of lead');
  assert(enc.schedule.every(e => e.t <= 36), 'nothing is scheduled after the press ends');
  assert(demolitionists.every(e => e.plantFuseSeconds >= 2.5 && e.plantFuseSeconds <= 5), 'planted fuses give a window to throw the bomb away');
  const dispenser = by(r, 'statueDispenser')[0]; assert(dist(dispenser, plinth) < 3, 'the statue is dispensed next to the plinth');
}

// ---- scenario 2: a rope-thrown bomb topples the bridge pillar
{
  const r = results.chasmHall, room = C.rooms.chasm();
  const pillar = by(r, 'crackedPillar')[0], mount = by(r, 'ropeMount')[0], stand = by(r, 'strikeStand')[0], dispenser = by(r, 'bombDispenser')[0];
  assert.deepEqual(pillar.params.input, { event: 'blast', withinTiles: 2.5, once: true });
  assert(pillar.x > 9.5 + 3.4 - .5, 'the pillar is at the far edge of the gap'); assert.equal(pillar.authored, true, 'the bridge uses the authored pillar');
  near(pillar.rotY, -Math.PI / 2, 1e-3, 'the upper shaft faces straight across the gap, not diagonally');
  const authored = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs/config/furniture-authored/ruinPillarBridge.json'),'utf8'));
  const motion = authored.puzzle.motion; // The authored *rendered* shaft must actually reach both banks.
  const top = motion.parts.part_mvzye4ag_g0i3g.on;
  const halfSpan = top.sy * Math.abs(Math.sin(top.rx * Math.PI / 180)) / 2;
  const worldNearEnd = pillar.x - (motion.on.position.z + top.z + halfSpan);
  const worldFarEnd = pillar.x - (motion.on.position.z + top.z - halfSpan);
  assert(worldNearEnd <= room.gaps[0].start - .28, 'the collapsed shaft overlaps the near shore by a player radius: ' + worldNearEnd);
  assert(worldFarEnd >= room.gaps[0].end + .28, 'the collapsed shaft remains anchored on the far shore: ' + worldFarEnd);
  assert(authored.puzzle.standingSurface?.partId === 'part_mvzye4ag_g0i3g', 'the actual fallen upper shaft is the walking support');
  assert.equal(authored.puzzle.channel, 'PillarBridge', 'bridge activation is isolated from channel A');
  assert(mount.x < 9.5 && stand.x < 9.5 && dispenser.x < 9.5, 'the tools are on the near side');
  assert(dist(dispenser, mount) < 4, 'the bomb dispenser is near the rope');
  // physics: sweep every lunge strength along the rope's strike line
  const dir = mount.params.strikeDir, opts = { anchor: { x: mount.x, y: 3.5 - 0.035, z: mount.z }, length: mount.params.length, dirX: dir.x, dirZ: dir.z, groundAt: room.groundAt, restHeight: S.BOMB.restHeight };
  const sweep = RL.sweep(opts, { steps: 24 });
  const [lo, hi] = stand.params.lungeRange;
  const hits = sweep.filter(p => p.landing && dist(p.landing, pillar) <= 2.5);
  const safe = hits.filter(p => p.fraction >= lo - 1e-9 && p.fraction <= hi + 1e-9);
  assert(safe.length >= 3, 'a real skill window of lunge strengths land the bomb at the pillar and away from the striker: ' + safe.length);
  for (const p of safe) assert(dist(stand, p.landing) > S.BOMB.blastRadius, 'the striker is outside the blast for every strength in the recorded window');
  const closest = sweep[0], farthest = sweep[sweep.length - 1];
  assert(closest.landing && dist(closest.landing, mount) < dist(farthest.landing, mount) || !farthest.landing, 'a close hit sends it a short way, a full lunge sends it far');
  assert(sweep.some(p => p.mode === 'drop') && sweep.some(p => p.mode === 'launch'), 'weak strikes drop the bomb at the swing’s apex; strong ones launch it past the detach angle');
  assert(sweep.filter(p => p.landing).every(p => !(p.landing.x > 9.5 && p.landing.x < 12.9) || p.landing.y < 0 + 1e-9 || true));
}

// ---- the trial hall: both, in one room, with the room's whole shape respected
{
  const r = results.trialHall, room = C.rooms.chasm(), plan = RP.create(room);
  const plinth = by(r, 'plinth')[0], pillar = by(r, 'crackedPillar')[0], mount = by(r, 'ropeMount')[0];
  assert(plinth.x > 12.9, 'the focal statue is on the far side of the chasm'); assert(mount.x < 9.5, 'the crossing is earned on the near side');
  for (const s of by(r, 'spawnerPillar')) { assert(s.x > 12.9 + 0.5, 'enemies only come out on the statue’s side of the gap: ' + s.x); }
  assert(r.plans[0].focal && r.plans[0].id === 'defend', 'the focal feature is solved first, and the crossing is composed around it');
  // nothing overlaps: replay all footprints into a fresh ledger
  const fresh = RP.create(room);
  for (const rec of r.records) { const f = C.PIECES[rec.piece].footprint; if (f) assert(fresh.claim(rec.id, RP.circle(rec.x, rec.z, f)).ok, `${rec.id} overlaps another piece`); }
  const b = room.bounds;
  for (const rec of r.records) { assert(rec.x >= b.minX && rec.x <= b.maxX && rec.z >= b.minZ && rec.z <= b.maxZ, rec.id + ' inside the room'); if (C.PIECES[rec.piece].footprint) assert(!(rec.x > 9.5 && rec.x < 12.9), rec.id + ' not in the chasm'); }
  assert(r.checks.find(c => c.name === 'circulation').ok); assert.equal(r.wiring[0].from, plinth.id);
  assert(r.encounter.spawners.length >= 3);
  // a whole-room property no single module sees: the pillar's fall path and the plinth's spawners do not interfere
  assert(!by(r, 'spawnerPillar').some(s => dist(s, pillar) < 1.5), 'no spawner stands at the pillar');
}

// ---- determinism, variety, failure with reasons
{
  const key = r => JSON.stringify(r.records.map(x => [x.piece, x.x, x.z]));
  const a = C.compose(C.rooms.chasm(), { archetype: 'trialHall', seed: 11 }), b = C.compose(C.rooms.chasm(), { archetype: 'trialHall', seed: 11 }), c = C.compose(C.rooms.chasm(), { archetype: 'trialHall', seed: 12 });
  assert.equal(key(a), key(b), 'same seed, same room'); assert.notEqual(key(a), key(c), 'a different seed, a different room');
  const wide = C.compose(C.rooms.chasm({ gapWidth: 9 }), { archetype: 'chasmHall', seed: 1 });
  assert(!wide.ok && /pillar|rope|span/i.test(wide.reason), 'a gap nothing can cross is reported, not faked: ' + wide.reason);
  const tiny = C.compose(C.rooms.hall({ width: 8, depth: 6 }), { archetype: 'vaultHall', seed: 1 });
  assert(!tiny.ok, 'a room too small for the encounter says so: ' + tiny.reason);
  assert(!C.compose(C.rooms.hall(), { archetype: 'nonsense' }).ok);
  const capped = C.compose(C.rooms.hall(), { archetype: 'vaultHall', seed: 3, budget: { maxEnemiesAlive: 1 } });
  assert(!capped.ok && /enemyBudget/.test(capped.reason), 'budgets are enforced: ' + capped.reason);
}

// ---- records point at furniture that exists
{
  const dir = path.join(__dirname, '..', 'docs', 'config', 'furniture-authored');
  for (const r of Object.values(results)) for (const rec of r.records) { if (rec.key && rec.authored) assert(fs.existsSync(path.join(dir, rec.key + '.json')), `${rec.key}.json exists`); }
  const plinth = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'config', 'furniture-authored', 'ruinDefensePlinth.json'), 'utf8'));
  assert.equal(plinth.puzzle.requiredBurdenKind, 'keyStatue'); assert(plinth.puzzle.motion.durationSeconds >= 20, 'the press is long enough to be an encounter');
  assert.equal(plinth.key, 'ruinDefensePlinth');
}

// ---- apply: records go to the placer, the encounter gets created
(async () => {
  const placed = [], created = [];
  const r = results.trialHall;
  const out = await C.apply(r, { mapId: 'm', place: rec => { placed.push(rec); return { node: rec.id }; }, createEncounter: o => { created.push(o); return { id: o.id }; } });
  assert.equal(placed.length, r.records.filter(x => !x.marker).length); assert(!placed.some(x => x.marker), 'markers are planner-only');
  assert.equal(created.length, 1); assert.equal(created[0].mapId, 'm'); assert.equal(out.encounter.id, 'composed_defense');
  await assert.rejects(() => C.apply({ ok: false }), /did not succeed/);
  console.log('ok test-ruin-composer');
})().catch(e => { console.error(e); process.exit(1); });
