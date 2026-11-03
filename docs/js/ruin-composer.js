// RuinComposer — builds a whole room out of goals.
//
// A room is composed, not scattered:
//   1. an *archetype* decides what the room is for: which goals it must make possible, and which one is the focal
//      feature (the thing the room is about);
//   2. goals are solved focal-first by RuinSolver, each against a view of the room that already contains everything
//      placed so far (RoomPlan.solidFn), so later pieces steer around earlier ones;
//   3. every placement is claimed in the RoomPlan ledger (footprints, the floor a rope swings over, the path a pillar
//      topples along); a clash, a broken circulation or a blown budget rejects the attempt and the composer tries
//      another seed;
//   4. what comes out is plain data: furniture records, an encounter description, wiring. Nothing here knows about a
//      specific scenario; the two scenarios in the design notes (a defended statue, a bomb thrown by a rope at a
//      cracked pillar) fall out of the rules and archetypes below and are acceptance tests, not shipped content.
//
// apply(composition, env) hands the records to whoever places furniture (env.place) and creates the encounter.
//
// Pure logic apart from apply(); runs under node and in the browser.
(function (root, factory) {
  const isCjs = typeof module === 'object' && module.exports;
  const api = factory(isCjs ? require('./ruin-solver.js') : root.RuinSolver, isCjs ? require('./room-plan.js') : root.RoomPlan);
  if (isCjs) module.exports = api;
  else root.RuinComposer = api;
})(typeof self !== 'undefined' ? self : globalThis, function (Solver, RoomPlan) {
  'use strict';

  // Abstract piece -> the authored furniture that plays it, and what it takes up on the floor.
  //   footprint: floor radius it occupies; clear: [{radius, kind}] floor that must stay open; overhead: hangs from the ceiling
  const PIECES = {
    plinth:          { key: 'ruinDefensePlinth',  footprint: 0.8 },
    statueDispenser: { key: 'keyStatueDispenser', footprint: 0.6 },
    bombDispenser:   { key: 'witchBombCeilingTube', overhead: true, clearRadius: 0.5 },
    ropeMount:       { key: 'ruinRopeMount', overhead: true, clearRadius: 0.6 },
    crackedPillar:   { key: 'ruinPillarBridge', footprint: 0.6 },
    spawnerPillar:   { key: 'ruinPillarBroken', footprint: 0.9 },
    strikeStand:     { key: null, clearRadius: 0.55 },                              // a marker for the planner: where to stand to strike
  };

  // ---------------------------------------------------------------- sample rooms (also the shape real rooms are lifted into)
  const rooms = {
    // A west platform and an east platform with a gap running the full depth of the room.
    chasm({ width = 36, depth = 16, gapWidth = 3.4, gapStart = 9.5, floorY = 0, ceilingY = 3.5 } = {}) {
      const gapEnd = gapStart + gapWidth;
      const room = {
        id: 'chasm-room', bounds: { minX: 0, maxX: width, minZ: 0, maxZ: depth }, floorY, ceilingY,
        zones: { near: { x: 6, z: depth / 2, r: 3.6 }, far: { x: gapEnd + 5, z: depth / 2, r: 3.6 } },
        gaps: [{ id: 'g1', axis: 'x', start: gapStart, end: gapEnd, crossMin: 0, crossMax: depth, y: floorY }],
        playerReach: { throwRange: 6 },
      };
      room.groundAt = (x, z) => (x > gapStart && x < gapEnd ? floorY - 4 : floorY);
      return room;
    },
    // A single open hall.
    hall({ width = 24, depth = 18, floorY = 0, ceilingY = 3.5 } = {}) {
      return { id: 'hall', bounds: { minX: 0, maxX: width, minZ: 0, maxZ: depth }, floorY, ceilingY, zones: { near: { x: 4, z: depth / 2, r: 3 }, far: { x: width - 7, z: depth / 2, r: 4 } }, gaps: [], playerReach: { throwRange: 6 } };
    },
  };

  // ---------------------------------------------------------------- archetypes: what a room is *for*
  // goals(room, opts) -> [{ id, goal, focal? }]. The focal goal is solved first; the rest orbit it.
  const archetypes = {
    vaultHall: {
      describe: 'A chamber about one thing: a statue pressed into a plinth while the walls disgorge enemies.',
      goals: (room, o) => [{ id: 'defend', focal: true, goal: { type: 'defend', at: { x: (room.bounds.minX + room.bounds.maxX) / 2, z: (room.bounds.minZ + room.bounds.maxZ) / 2 }, pressSeconds: o.pressSeconds ?? 36, difficulty: o.difficulty ?? 2 } }],
    },
    chasmHall: {
      describe: 'A room divided by a chasm, crossed with a tool found on the near side.',
      goals: (room) => [{ id: 'cross', focal: true, goal: { type: 'connect', from: 'near', to: 'far', gap: room.gaps[0].id } }],
    },
    trialHall: {
      describe: 'A chasm to cross, then a statue to defend on the far side. The defence is the point of the room; the crossing is how you earn it.',
      goals: (room, o) => [
        { id: 'defend', focal: true, goal: { type: 'defend', at: focus(room, 'far'), pressSeconds: o.pressSeconds ?? 36, difficulty: o.difficulty ?? 2 } },
        { id: 'cross', goal: { type: 'connect', from: 'near', to: 'far', gap: room.gaps[0].id } },
      ],
    },
  };
  function focus(room, zone) { const z = room.zones[zone] || room.zones.near; return { x: z.x, z: z.z }; }

  // ---------------------------------------------------------------- claims
  function claimPlacements(plan, goalId, placements) {
    const failures = [];
    const claimed = [];
    const tryClaim = (owner, shape, kind, label, group = owner) => { const r = plan.claim(owner, shape, { kind, label, group }); if (!r.ok) failures.push(`${label} clashes with ${r.conflicts.map(c => c.label || c.owner).join(', ')}`); else claimed.push(owner); };
    // footprints first so clear volumes are checked against them
    placements.forEach((p, i) => {
      const spec = PIECES[p.piece] || {}, owner = `${goalId}:${p.piece}:${i}`;
      if (spec.footprint) tryClaim(owner, RoomPlan.circle(p.x, p.z, spec.footprint), 'footprint', `${p.piece}@${p.x.toFixed(1)},${p.z.toFixed(1)}`);
    });
    placements.forEach((p, i) => {
      const spec = PIECES[p.piece] || {}, owner = `${goalId}:${p.piece}:${i}`;
      if (spec.clearRadius) tryClaim(owner + ':clear', RoomPlan.circle(p.x, p.z, spec.clearRadius), 'clear', `${p.piece} clearance`, owner);
      if (p.piece === 'crackedPillar') { // the path it topples along
        const f = p.facing, len = (p.params && p.params.length) || Solver.PILLAR.length;
        tryClaim(owner + ':fall', RoomPlan.segment({ x: p.x, z: p.z }, { x: p.x + f.x * len, z: p.z + f.z * len }, 0.5), 'clear', 'pillar fall path', owner);
      }
    });
    return failures;
  }

  // ---------------------------------------------------------------- composition -> data
  const rotYFor = f => Math.atan2(Number(f?.x) || 0, Number.isFinite(Number(f?.z)) ? Number(f.z) : 1); // Preserve cardinal z=0: +z is rotation 0, -x is -90 degrees.
  function toRecords(goalId, placements, taken) {
    const out = [];
    placements.forEach((p, i) => {
      const spec = PIECES[p.piece];
      if (!spec) return;
      const base = `${goalId}_${p.piece}`;
      let id = base + '_' + i; while (taken.has(id)) id += '_';
      taken.add(id);
      out.push({ id, piece: p.piece, key: spec.key, x: +p.x.toFixed(3), y: +(p.y || 0).toFixed(3), z: +p.z.toFixed(3), rotY: +rotYFor(p.facing).toFixed(4), authored: spec.authored !== false, marker: !spec.key, overhead: !!spec.overhead, params: p.params || {}, goal: p.goal || goalId, rule: p.rule });
    });
    return out;
  }

  function encounterFor(records, defendPlan, opts) {
    const plinth = records.find(r => r.piece === 'plinth');
    if (!plinth || !defendPlan) return null;
    const spawners = records.filter(r => r.piece === 'spawnerPillar').sort((a, b) => (a.params.index || 0) - (b.params.index || 0)).map(r => ({ x: r.x, z: r.z, pillarId: r.id }));
    return { id: opts.encounterId || 'composed_defense', objective: { type: 'defend', plinthId: plinth.id, fragileStatue: true }, spawners, schedule: defendPlan.schedule || [], tier: opts.tier || 0, maxAlive: opts.maxAlive };
  }

  // ---------------------------------------------------------------- compose
  // options: { archetype, seed, attempts, tier, pressSeconds, difficulty, budget, solver:{...RuinSolver.solve options} }
  function compose(room, options = {}) {
    const name = options.archetype || 'trialHall', arch = archetypes[name];
    if (!arch) return { ok: false, reason: `unknown archetype '${name}'`, attempts: [] };
    const attempts = [], max = options.attempts || 8;
    for (let n = 0; n < max; n++) {
      const seed = (options.seed ?? 1) + n * 7919;
      const result = attempt(room, name, arch, seed, options);
      attempts.push({ seed, ok: result.ok, reason: result.reason || null });
      if (result.ok) return { ...result, attempts };
    }
    return { ok: false, archetype: name, reason: attempts[attempts.length - 1].reason, attempts };
  }

  function attempt(room, name, arch, seed, options) {
    const plan = RoomPlan.create(room, { budget: options.budget });
    const view = { ...room, solid: plan.solidFn(), reachable: (a, b) => plan.reaches(a, b) && !plan.nearGap(a) };
    const goals = arch.goals(room, options).sort((a, b) => (b.focal ? 1 : 0) - (a.focal ? 1 : 0));
    const records = [], plans = [], checks = [], taken = new Set();
    let defendPlan = null;
    for (const g of goals) {
      const solved = Solver.solve(g.goal, view, { ...(options.solver || {}), seed: seed + plans.length });
      if (!solved.ok) return { ok: false, reason: `${g.id}: ${solved.reason}` };
      const flat = Solver.flatten(solved.plan);
      const clashes = claimPlacements(plan, g.id, flat);
      if (clashes.length) return { ok: false, reason: `${g.id}: ${clashes[0]}` };
      plans.push({ id: g.id, focal: !!g.focal, plan: solved.plan });
      checks.push(...Solver.allChecks(solved.plan).map(c => ({ ...c, goalId: g.id })));
      records.push(...toRecords(g.id, flat, taken));
      if (g.goal.type === 'defend') defendPlan = solved.plan;
    }
    const circulation = plan.circulation();
    checks.push({ name: 'circulation', ok: circulation.ok, detail: circulation.ok ? 'every zone that could reach another still can' : `cut off: ${circulation.broken.map(p => p.join('↔')).join(', ')}${circulation.walledIn.length ? ' walled in: ' + circulation.walledIn.join(',') : ''}` });
    const budget = plan.budget, pieces = plan.pieceCount();
    checks.push({ name: 'pieceBudget', ok: records.filter(r => !r.marker).length <= budget.maxPieces, detail: `${records.filter(r => !r.marker).length} pieces vs ${budget.maxPieces}` });
    const encounter = encounterFor(records, defendPlan, options);
    if (encounter) {
      const alive = peakAlive(encounter.schedule);
      checks.push({ name: 'enemyBudget', ok: alive <= budget.maxEnemiesAlive, detail: `up to ${alive} spawned across the press vs ${budget.maxEnemiesAlive} alive at once` });
    }
    const failed = checks.filter(c => !c.ok);
    if (failed.length) return { ok: false, reason: failed.map(c => `${c.name}: ${c.detail}`).join('; ') };
    return {
      ok: true, archetype: name, description: arch.describe, seed, room: room.id, plans, records, encounter, checks,
      wiring: encounter ? [{ from: encounter.objective.plinthId, event: 'complete', note: 'the press finished: whatever the plinth unlocks opens' }] : [],
      claims: plan.snapshot(), explanation: plans.flatMap(p => Solver.describe(p.plan, `${p.focal ? '★ ' : ''}`)),
    };
  }
  function peakAlive(schedule) { // a conservative bound: everything that comes out within any 8 s window
    let peak = 0;
    for (const a of schedule) { let n = 0; for (const b of schedule) if (b.t >= a.t && b.t < a.t + 8) n += b.count || 1; peak = Math.max(peak, n); }
    return peak;
  }

  // ---------------------------------------------------------------- apply
  // env: { place(record) -> node|Promise<node>|null, createEncounter?(options), mapId, unplace?(record, node) }
  async function apply(composition, env = {}) {
    if (!composition || !composition.ok) throw new Error('cannot apply a composition that did not succeed');
    const nodes = new Map(), skipped = [];
    for (const record of composition.records) {
      if (record.marker) continue;
      if (typeof env.place !== 'function') { skipped.push(record.id); continue; }
      const node = await env.place(record);
      if (node) nodes.set(record.id, node); else skipped.push(record.id);
    }
    let encounter = null;
    if (composition.encounter) {
      const create = env.createEncounter || (typeof window !== 'undefined' && window.RuinEncounters && window.RuinEncounters.create);
      if (create) encounter = create({ ...composition.encounter, mapId: env.mapId, surfaceY: env.surfaceY });
    }
    return { nodes, encounter, skipped };
  }
  function dispose(applied, env = {}) {
    if (applied.encounter && typeof window !== 'undefined' && window.RuinEncounters) window.RuinEncounters.remove(applied.encounter.id);
    if (typeof env.unplace === 'function') for (const [id, node] of applied.nodes) env.unplace(id, node);
    applied.nodes.clear();
  }

  return Object.freeze({ PIECES, rooms, archetypes, compose, apply, dispose });
});
