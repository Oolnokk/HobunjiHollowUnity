// RuinSolver — turns goals into layouts of pieces that can actually be played, by chaining what the
// pieces can do and checking the chain with the game's own physics.
//
// A *goal* is something the room must make possible:
//   { type:'connect', from:'near', to:'far', gap:'g1' }       the player can get from one zone to another
//   { type:'blast',   at:{x,z}, radius, reason }               an explosion goes off near a point
//   { type:'defend',  at:{x,z}, pressSeconds, difficulty }     the player must protect something while a press completes
//
// A *rule* decomposes a goal into candidate plans: placements (abstract pieces: positions + parameters),
// sub-goals the plan depends on, and *checks* that say whether it works. Rules are data you register; the
// solver does the search, recurses into sub-goals, and picks among valid candidates with a seeded RNG so
// the same seed gives the same room and different seeds give different ones.
//
//   connect ──pillarBridge──▶ crackedPillar  + blast(at the pillar)
//   blast   ──ropeBomb─────▶ bombDispenser + ropeMount + strikeStand   (validated by RopeLaunch, which predicts
//                                                                        landings exactly as the game plays them)
//   blast   ──thrownBomb───▶ bombDispenser + strikeStand              (the player throws it)
//   defend  ──plinthDefense▶ plinth + statueDispenser + spawnerPillars + a pressure schedule
//
// The room is abstract on purpose: { bounds, floorY, ceilingY, zones:{name:{x,z,r}}, gaps:[...], groundAt?, solid? }.
// Pure logic; runs under node and in the browser.
(function (root, factory) {
  const isCjs = typeof module === 'object' && module.exports;
  const api = factory(isCjs ? require('./rope-launch.js') : root.RopeLaunch, isCjs ? require('./rope-core.js') : root.RopeCore);
  if (isCjs) module.exports = api;
  else root.RuinSolver = api;
})(typeof self !== 'undefined' ? self : globalThis, function (RL, RC0) {
  'use strict';

  // ---------------------------------------------------------------- constants shared with the game
  const BOMB = Object.freeze({ blastRadius: 4.4, restHeight: 0.45, fuseSeconds: 10 }); // HronalWitchBombs
  const PILLAR = Object.freeze({ length: 4.18, margin: 0.5 });                           // the pillar bridge piece
  const ROPE = Object.freeze({ lengths: [2.1, 2.4, 3.0], gripHeight: 0.865, standOff: 1.1 });
  const ENEMY = Object.freeze({ speed: 2.0 });                                           // tiles/s, a Minion's chase pace

  // ---------------------------------------------------------------- helpers
  function rngFor(seed) { // mulberry32
    let a = (Number(seed) >>> 0) || 1;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const norm = (dx, dz) => { const l = Math.hypot(dx, dz) || 1; return { x: dx / l, z: dz / l }; };
  const inZone = (z, p) => dist(z, p) <= z.r;
  const inBounds = (b, p, pad = 0) => p.x >= b.minX + pad && p.x <= b.maxX - pad && p.z >= b.minZ + pad && p.z <= b.maxZ - pad;
  const groundOf = room => (typeof room.groundAt === 'function' ? room.groundAt : () => room.floorY || 0);
  const isSolid = (room, x, z) => (typeof room.solid === 'function' ? !!room.solid(x, z) : false);
  const clearLine = (room, a, b, step = 0.4) => { const n = Math.max(1, Math.ceil(dist(a, b) / step)); for (let i = 0; i <= n; i++) if (isSolid(room, a.x + (b.x - a.x) * i / n, a.z + (b.z - a.z) * i / n)) return false; return true; };
  const check = (name, ok, detail) => ({ name, ok: !!ok, detail: detail ?? null });
  const allOk = checks => checks.every(c => c.ok);

  // ---------------------------------------------------------------- rules
  const rules = new Map(); // goal type -> [rule]
  function registerRule(goalType, rule) {
    if (!rules.has(goalType)) rules.set(goalType, []);
    const list = rules.get(goalType), i = list.findIndex(r => r.id === rule.id);
    if (i >= 0) list[i] = rule; else list.push(rule);
    return rule;
  }

  // connect: a cracked pillar at the far edge topples across the gap when a blast reaches it.
  registerRule('connect', {
    id: 'pillarBridge',
    build(goal, room, ctx) {
      const gap = (room.gaps || []).find(g => g.id === goal.gap) || (room.gaps || [])[0];
      if (!gap) return [];
      const dir = gap.axis === 'x' ? { x: Math.sign(gap.start - gap.end) || -1, z: 0 } : { x: 0, z: Math.sign(gap.start - gap.end) || -1 }; // from the far edge toward the near edge
      const far = gap.axis === 'x' ? gap.end : gap.end, width = Math.abs(gap.end - gap.start);
      const crossPos = (gap.crossMin + gap.crossMax) / 2;
      const base = gap.axis === 'x' ? { x: far, z: crossPos } : { x: crossPos, z: far };
      const trigger = 2.5; // the blast must land within this of the pillar
      const checks = [
        check('pillarSpansGap', width <= PILLAR.length - PILLAR.margin, `gap ${width.toFixed(2)} vs pillar ${PILLAR.length}`),
        check('pillarBaseOnFarSide', !isSolid(room, base.x, base.z), 'pillar base position is open floor'),
      ];
      return [{
        rule: 'pillarBridge', score: 1 + ctx.rng() * 0.2,
        placements: [{ piece: 'crackedPillar', x: base.x, y: gap.y ?? room.floorY ?? 0, z: base.z, facing: dir, params: { input: { event: 'blast', withinTiles: trigger, once: true }, length: PILLAR.length } }],
        subgoals: [{ type: 'blast', at: base, radius: trigger, reason: `topple the pillar bridge over ${gap.id}` }],
        checks,
      }];
    },
  });

  // connect: the original rope traversal, validated with the original rope's own reach simulation.
  registerRule('connect', {
    id: 'ropeSwing',
    build(goal, room, ctx) {
      const gap = (room.gaps || []).find(g => g.id === goal.gap) || (room.gaps || [])[0];
      const RC = ctx.RopeCore;
      if (!gap || !RC) return [];
      const width = Math.abs(gap.end - gap.start);
      if (width < 4.4 || width > 6.4) return []; // the generated ropes' span window
      const mid = (gap.start + gap.end) / 2, cross = (gap.crossMin + gap.crossMax) / 2, y = room.floorY || 0;
      const anchorY = (room.ceilingY ?? y + 3) - 0.035, bobY = y + 0.86, length = Math.hypot(width / 2, anchorY - bobY);
      const dir = gap.axis === 'x' ? { x: Math.sign(gap.end - gap.start) || 1, z: 0 } : { x: 0, z: Math.sign(gap.end - gap.start) || 1 };
      const rope = RC.create({ anchor: gap.axis === 'x' ? { x: mid, y: anchorY, z: cross } : { x: cross, y: anchorY, z: mid }, yaw: Math.atan2(dir.z, dir.x), length });
      const farEdge = gap.axis === 'x' ? { x: gap.end, z: cross } : { x: cross, z: gap.end };
      // A rider's release flight (rope gravity, as in the ruin runtime) must land on the far side within reach of its edge.
      const lands = start => { const f = { ...start }; for (let i = 0; i < 240; i++) { f.vy -= RC.GRAVITY / 60; f.x += f.vx / 60; f.z += f.vz / 60; f.y += f.vy / 60; if (f.vy < 0 && f.y <= y + 0.08) return Math.hypot(f.x - farEdge.x, f.z - farEdge.z) <= 1.3; } return false; };
      const reach = RC.reachAmplitude(rope, lands);
      return [{
        rule: 'ropeSwing', score: 0.8 + ctx.rng() * 0.2,
        placements: [{ piece: 'ropeMount', x: rope.anchor.x, y: 0, z: rope.anchor.z, facing: dir, params: { length: +length.toFixed(2), maxLength: +(length + 0.55).toFixed(2), role: 'traverse' } }],
        subgoals: [],
        checks: [check('ropeSpanInRange', true, `span ${width.toFixed(2)}`), check('ropeReachesFarSide', reach !== null, reach === null ? 'no swing amplitude reaches the far edge' : `amplitude ${reach}`)],
      }];
    },
  });

  // blast: hang a bomb on a rope, strike it, and let the rope throw it where the goal needs it.
  registerRule('blast', {
    id: 'ropeBomb',
    build(goal, room, ctx) {
      const near = room.zones[ctx.nearZone || 'near'];
      if (!near) return [];
      const ground = groundOf(room), out = [], radius = goal.radius;
      for (const length of ROPE.lengths) {
        for (let gx = near.x - near.r; gx <= near.x + near.r; gx += ctx.gridStep) for (let gz = near.z - near.r; gz <= near.z + near.r; gz += ctx.gridStep) {
          const mount = { x: gx, z: gz };
          if (!inZone(near, mount) || !inBounds(room.bounds, mount, 0.6) || isSolid(room, mount.x, mount.z)) continue;
          const dir = norm(goal.at.x - mount.x, goal.at.z - mount.z), anchorY = (room.ceilingY ?? ((room.floorY || 0) + 3)) - 0.035;
          if (anchorY - length < (room.floorY || 0) + 0.3) continue; // the bomb would rest on the floor
          const opts = { anchor: { x: mount.x, y: anchorY, z: mount.z }, length, dirX: dir.x, dirZ: dir.z, groundAt: ground, restHeight: BOMB.restHeight };
          const win = RL.window(opts, goal.at, radius, { steps: 24 });
          if (win.width < ctx.minWindow) continue;
          const stand = { x: mount.x - dir.x * ROPE.standOff, z: mount.z - dir.z * ROPE.standOff };
          const mid = RL.predict({ ...opts, speed: RL.strikeSpeedForFraction((win.range[0] + win.range[1]) / 2) });
          if (!mid.landing) continue;
          const checks = [
            check('skillWindow', win.width >= ctx.minWindow, `${(win.width * 100).toFixed(0)}% of lunge strengths land within ${radius} of the target`),
            check('strikeStandOpen', inBounds(room.bounds, stand, 0.4) && !isSolid(room, stand.x, stand.z), 'there is floor to stand on behind the bomb'),
            check('playerOutsideBlast', dist(stand, mid.landing) > BOMB.blastRadius + 0.5, `${dist(stand, mid.landing).toFixed(2)} from the landing vs blast ${BOMB.blastRadius}`),
            check('swingClear', swingClear(room, opts, mid), 'the swing and the flight do not pass through solids'),
          ];
          out.push({
            rule: 'ropeBomb', score: 2 + win.width * 2 + ctx.rng() * 0.3, difficulty: 1 - win.width,
            placements: [
              { piece: 'ropeMount', x: mount.x, y: 0, z: mount.z, facing: dir, params: { length, maxLength: +(length + 0.55).toFixed(2), role: 'bomb', strikeDir: dir } },
              { piece: 'strikeStand', x: stand.x, y: ground(stand.x, stand.z), z: stand.z, facing: dir, params: { lungeRange: [win.range[0], win.range[1]] } },
            ],
            subgoals: [{ type: 'obtain', item: 'bomb', near: { x: mount.x, z: mount.z }, reason: 'a bomb for the rope' }],
            checks, window: win, landing: mid.landing,
          });
        }
      }
      out.sort((a, b) => b.score - a.score);
      return out.slice(0, ctx.keep); // the best few; the seeded RNG chooses among them
    },
  });

  // blast: the player throws a bomb (easier, less interesting; used when no rope layout fits).
  registerRule('blast', {
    id: 'thrownBomb',
    build(goal, room, ctx) {
      const near = room.zones[ctx.nearZone || 'near'];
      if (!near) return [];
      const reach = (room.playerReach && room.playerReach.throwRange) || 6;
      const d = dist(near, goal.at) - near.r;
      const checks = [check('withinThrowRange', d <= reach, `${d.toFixed(2)} from the near zone vs a throw reach of ${reach}`), check('playerOutsideBlast', dist(near, goal.at) - near.r > BOMB.blastRadius * 0.55, 'a thrown bomb is only safe if the thrower can retreat')];
      return [{ rule: 'thrownBomb', score: 0.6 + ctx.rng() * 0.2, difficulty: 0.2, placements: [{ piece: 'strikeStand', x: near.x, y: room.floorY || 0, z: near.z, facing: norm(goal.at.x - near.x, goal.at.z - near.z), params: { throw: true } }], subgoals: [{ type: 'obtain', item: 'bomb', near: { x: near.x, z: near.z } }], checks }];
    },
  });

  // obtain: a bomb comes from a ceiling-tube dispenser the player can reach.
  registerRule('obtain', {
    id: 'bombDispenser',
    build(goal, room, ctx) {
      const near = room.zones[ctx.nearZone || 'near'], c = goal.near || near;
      if (!c || goal.item !== 'bomb') return [];
      const candidates = [];
      for (let a = 0; a < 8; a++) for (const r of [1.6, 2.4]) {
        const p = { x: c.x + Math.cos(a * Math.PI / 4) * r, z: c.z + Math.sin(a * Math.PI / 4) * r };
        if (!inBounds(room.bounds, p, 0.6) || isSolid(room, p.x, p.z) || (near && !inZone(near, p))) continue;
        candidates.push(p);
      }
      if (!candidates.length) return [];
      const p = candidates[Math.floor(ctx.rng() * candidates.length)];
      return [{ rule: 'bombDispenser', score: 1, placements: [{ piece: 'bombDispenser', x: p.x, y: room.ceilingY ?? (room.floorY || 0) + 3, z: p.z, facing: { x: 0, z: 1 }, params: { fuseSeconds: BOMB.fuseSeconds, trigger: 'interact' } }], subgoals: [], checks: [check('dispenserReachable', dist(p, c) <= 3, 'within a few steps of where the bomb is used')] }];
    },
  });

  // defend: a plinth presses while spawner pillars send skeletons at the player and demolitionists at the statue.
  registerRule('defend', {
    id: 'plinthDefense',
    build(goal, room, ctx) {
      const difficulty = Math.max(1, Math.min(3, Math.round(goal.difficulty || 2)));
      const count = Math.min(6, 2 + difficulty), speed = goal.enemySpeed || ENEMY.speed, minLead = goal.minLeadSeconds ?? 4;
      const spots = [];
      const phase = ctx.rng() * Math.PI * 2;
      for (let i = 0; i < count; i++) {
        const a = phase + (i / count) * Math.PI * 2 + (ctx.rng() - 0.5) * 0.3;
        let placed = null;
        const rMin = minLead * speed + 0.5; // the nearest ring that still gives the player their lead time, then outward
        for (const r of [rMin, rMin + 1, rMin + 2, rMin + 3, rMin - 1]) {
          const p = { x: goal.at.x + Math.cos(a) * r, z: goal.at.z + Math.sin(a) * r };
          if (inBounds(room.bounds, p, 0.8) && !isSolid(room, p.x, p.z)) { placed = p; break; }
        }
        if (placed) spots.push(placed);
      }
      const leads = spots.map(p => (typeof room.pathLength === 'function' ? room.pathLength(p, goal.at) : dist(p, goal.at)) / speed);
      const interval = Math.max(3, Math.min(10, goal.pressSeconds / (3 + difficulty)));
      const schedule = [];
      for (let t = 2, wave = 0; t < goal.pressSeconds; t += interval, wave++) {
        const spawner = Math.floor(ctx.rng() * Math.max(1, spots.length));
        schedule.push({ t: +t.toFixed(1), kind: 'skeleton', count: 1 + Math.floor(difficulty / 2) + (wave % 3 === 2 ? 1 : 0), spawner });
        if (difficulty >= 2 && wave % 2 === 1) schedule.push({ t: +(t + 1).toFixed(1), kind: 'demolitionist', count: 1, spawner: (spawner + 1) % Math.max(1, spots.length), plantFuseSeconds: Math.max(2.5, Math.min(5, leads[(spawner + 1) % Math.max(1, spots.length)] * 0.5)) });
      }
      const checks = [
        check('enoughSpawners', spots.length >= Math.min(count, 3), `${spots.length} spawner pillars placed`),
        check('leadTime', leads.length > 0 && Math.min(...leads) >= minLead, `nearest spawner is ${leads.length ? Math.min(...leads).toFixed(1) : 'n/a'}s from the statue (needs ${minLead}s)`),
        check('hasDemolitionists', difficulty < 2 || schedule.some(s => s.kind === 'demolitionist'), 'the statue is actually threatened'),
        check('spawnersHaveRoom', spots.every(p => clearLine(room, p, goal.at)), 'every spawner has a clear line of approach'),
      ];
      return [{
        rule: 'plinthDefense', score: 1 + difficulty * 0.2 + ctx.rng() * 0.1, difficulty: difficulty / 3,
        placements: [
          { piece: 'plinth', x: goal.at.x, y: room.floorY || 0, z: goal.at.z, facing: { x: 0, z: 1 }, params: { requiredBurden: 'keyStatue', pressSeconds: goal.pressSeconds } },
          { piece: 'statueDispenser', x: goal.at.x + 2.2, y: room.floorY || 0, z: goal.at.z, facing: { x: -1, z: 0 }, params: { kind: 'keyStatue' } },
          ...spots.map((p, i) => ({ piece: 'spawnerPillar', x: p.x, y: room.floorY || 0, z: p.z, facing: norm(goal.at.x - p.x, goal.at.z - p.z), params: { index: i } })),
        ],
        subgoals: [], checks, schedule,
      }];
    },
  });

  // ---------------------------------------------------------------- search
  function swingClear(room, opts, landing) { // sample the swing arc and the flight for solids
    if (typeof room.solid !== 'function') return true;
    for (let i = 0; i <= 12; i++) { const a = (opts.length > 0 ? 0.85 : 0.5) * (i / 12); const x = opts.anchor.x + opts.dirX * Math.sin(a) * opts.length, z = opts.anchor.z + opts.dirZ * Math.sin(a) * opts.length; if (isSolid(room, x, z)) return false; }
    for (let i = 1; i <= 10; i++) { const t = i / 10, x = opts.anchor.x + (landing.x - opts.anchor.x) * t, z = opts.anchor.z + (landing.z - opts.anchor.z) * t; if (isSolid(room, x, z)) return false; }
    return true;
  }

  function unregisterRule(goalType, id) { const list = rules.get(goalType); if (!list) return false; const i = list.findIndex(r => r.id === id); if (i < 0) return false; list.splice(i, 1); return true; }

  // options: { seed, minWindow, gridStep, keep, nearZone, maxDepth, only:[ruleIds] (narrows only the goal types it names a rule for) }
  function solve(goal, room, options = {}, depth = 0, shared = null) {
    const ctx = Object.assign({ minWindow: 0.12, gridStep: 0.75, keep: 6, nearZone: 'near', maxDepth: 5, RopeCore: RC0 }, options);
    if (!shared) { shared = { rng: rngFor(options.seed ?? 1), tried: [] }; }
    ctx.rng = shared.rng;
    if (depth > ctx.maxDepth) return { ok: false, goal, reason: 'goal chain too deep' };
    const ruleList = rules.get(goal.type) || [];
    if (!ruleList.length) return { ok: false, goal, reason: `no rule can satisfy a '${goal.type}' goal` };
    const valid = [], rejected = [];
    const restrict = Array.isArray(ctx.only) && ruleList.some(r => ctx.only.includes(r.id)); // `only` narrows just the goal types it names a rule for
    for (const rule of ruleList) {
      if (restrict && !ctx.only.includes(rule.id)) continue;
      let candidates = [];
      try { candidates = rule.build(goal, room, ctx) || []; } catch (error) { rejected.push({ rule: rule.id, reason: 'rule threw: ' + (error.message || error) }); continue; }
      if (!candidates.length) { rejected.push({ rule: rule.id, reason: 'no candidate layout' }); continue; }
      for (const c of candidates) {
        if (!allOk(c.checks)) { rejected.push({ rule: rule.id, reason: c.checks.filter(k => !k.ok).map(k => `${k.name}: ${k.detail}`).join('; ') }); continue; }
        const subplans = [];
        let ok = true;
        for (const sub of c.subgoals || []) {
          const solved = solve(sub, room, options, depth + 1, shared);
          if (!solved.ok) { rejected.push({ rule: rule.id, reason: `sub-goal '${sub.type}' failed: ${solved.reason || solved.rejected?.[0]?.reason || 'unsolved'}` }); ok = false; break; }
          subplans.push(solved.plan);
        }
        if (ok) valid.push({ ...c, subplans, goal });
      }
    }
    if (!valid.length) return { ok: false, goal, rejected, reason: rejected[0]?.reason || 'no valid layout' };
    valid.sort((a, b) => b.score - a.score);
    const top = valid.slice(0, Math.max(1, Math.min(3, valid.length)));
    const pick = top[Math.floor(shared.rng() * top.length)];
    return { ok: true, goal, plan: toPlan(pick), alternatives: valid.map(v => ({ rule: v.rule, score: +v.score.toFixed(3) })), rejected };
  }
  function toPlan(c) {
    return { goal: c.goal, rule: c.rule, placements: c.placements, checks: c.checks, subplans: c.subplans, difficulty: c.difficulty ?? null, schedule: c.schedule || null, window: c.window || null, landing: c.landing || null };
  }

  // ---------------------------------------------------------------- utilities for consumers
  const flatten = plan => [...plan.placements.map(p => ({ ...p, rule: plan.rule, goal: plan.goal.type })), ...plan.subplans.flatMap(flatten)];
  const allChecks = plan => [...plan.checks.map(c => ({ ...c, rule: plan.rule })), ...plan.subplans.flatMap(allChecks)];
  const describe = (plan, indent = '') => [`${indent}${plan.goal.type}${plan.goal.reason ? ` (${plan.goal.reason})` : ''} → ${plan.rule}: ${plan.placements.map(p => p.piece).join(', ')}`, ...plan.subplans.flatMap(s => describe(s, indent + '  '))];
  // Re-runs a plan's checks' meaning: a plan is valid iff every check in the tree passed (plans from storage carry them).
  const validate = plan => ({ ok: allChecks(plan).every(c => c.ok), failed: allChecks(plan).filter(c => !c.ok) });

  return Object.freeze({ BOMB, PILLAR, ROPE, ENEMY, rngFor, registerRule, unregisterRule, solve, flatten, allChecks, describe, validate, rules: () => Object.fromEntries([...rules].map(([k, v]) => [k, v.map(r => r.id)])) });
});
