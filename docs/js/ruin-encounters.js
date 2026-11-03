// RuinEncounters — timed pressure around an objective, built from pieces that already exist.
//
// An encounter is: spawners (places enemies come from), a schedule (what comes out and when), and an
// objective that decides success or failure. The first objective is *defend a key statue while a plinth
// presses*:
//   * the encounter arms when a statue sits on the burden plinth and the press begins; it runs on the
//     plinth's own clock, so the press duration IS the encounter length;
//   * skeletons come out of the spawner pillars and go for the player: they distract;
//   * demolitionists (MinionCombat.makeDemolitionist, ruin-only) are pointed at the statue instead; each
//     carries a Witch-bomb and, when it gets close, plants it by the statue with a short fuse
//     (HronalWitchBombs.dropEnemyBomb). The bomb is an ordinary burden: the player can pick it up and throw
//     it away, or it goes off. Any blast reaching the statue destroys it;
//   * success: the plinth finishes pressing (its completion channel fires and whatever it unlocks opens);
//   * failure: the statue is lost; the press reverses, enemies are cleared, the key-statue dispenser gives
//     the player another, and the encounter re-arms for another try.
//
// Everything is data: the layout solver (RuinSolver) produces { spawners, schedule } and a composer hands them
// in. Behaviors are registered by kind (registerEnemyKind), so new enemies take part without changing this file.
// Time is the encounter's own clock (dt from the frame scheduler), never wall time.
//
// Events (WorldEvents, scoped to the map): 'encounter:armed', 'encounter:start', 'encounter:spawn',
// 'encounter:plant', 'encounter:statue-destroyed', 'encounter:success', 'encounter:failed'.
(() => {
  'use strict';
  if (window.RuinEncounters?.installed) return;

  const CONFIG = {
    plantRangeTiles: 2.4,      // a demolitionist plants this close to the statue
    carrierFuseSeconds: 90,    // en route the carried bomb must not go off on its own
    emergeSeconds: 0.9,        // a spawned enemy is held (no AI) for this long while it comes out of its pillar
    maxAlive: 8,               // enemies alive at once, across the encounter
    despawnAfterPlantSeconds: 1.4, // a demolitionist leaves the field this long after planting
    proxyFacing: 0,
  };
  const encounters = new Map();
  const kinds = new Map();   // enemy kind -> { spawn(encounter, entry, spawner), update?(encounter, enemy, dt), dispose? }
  let serial = 0, schedulerUnsub = null;

  const deps = () => window.Combat?.deps || null;
  const TILE = () => Number(deps()?.TILE) || 64;
  const now = () => performance.now();
  const emit = (type, payload) => window.WorldEvents?.emit?.(type, payload);
  const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

  // ---------------------------------------------------------------- enemy kinds
  function disposeEntity(entity) {
    if (!entity) return;
    deps()?.hostileObjects?.delete?.(entity);
    entity.avatarRef?.group?.parent?.remove?.(entity.avatarRef.group);
    entity.groundShadow?.parent?.remove?.(entity.groundShadow);
    entity._banditToolHolder?.parent?.remove?.(entity._banditToolHolder);
    entity._banditRangedToolHolder?.parent?.remove?.(entity._banditRangedToolHolder);
    entity.avatarRef?.dispose?.();
  }
  function spawnOptions(enc, spawner) {
    const t = TILE(), g = window.GridTileAccessors;
    return { x: spawner.x * t, y: spawner.z * t, zoneId: enc.mapId, scene: g?.getActiveScene?.(), grid: g?.getActiveGrid?.(), cols: g?.getActiveCols?.(), rows: g?.getActiveRows?.(),
      extra: { homeX: spawner.x * t, homeY: spawner.z * t, state: 'idle', ruinEncounterId: enc.id } };
  }
  function attachSurface(enc, entity) {
    if (typeof enc.surfaceY !== 'function') return;
    const t = TILE();
    entity.surfaceYOverride = () => { const y = Number(enc.surfaceY(entity.x / t, entity.y / t)); return Number.isFinite(y) ? y : NaN; };
  }

  registerEnemyKind('skeleton', {
    async spawn(enc, entry, spawner) {
      const o = spawnOptions(enc, spawner);
      return window.MinionCombat?.makeEntity?.({ speciesId: 'harlyao-skeleton', name: 'Harlyao Skeleton', tier: enc.tier, weaponMetalKey: 'nativeCopper', ...o });
    },
  });
  registerEnemyKind('demolitionist', {
    async spawn(enc, entry, spawner) {
      const o = spawnOptions(enc, spawner);
      const entity = await window.MinionCombat?.makeDemolitionist?.({ ruinEncounter: true, tier: enc.tier, witchBombFuseSeconds: CONFIG.carrierFuseSeconds, ...o });
      return entity;
    },
    // Points the demolitionist at the statue (through the AI's existing target override) and plants when close.
    update(enc, enemy, dt) {
      const e = enemy.entity, statue = enc.statuePoint();
      if (!statue || enemy.planted) {
        if (enemy.planted && enemy.plantedAt != null && enc.clock - enemy.plantedAt >= CONFIG.despawnAfterPlantSeconds) enc.removeEnemy(enemy, 'planted');
        return;
      }
      e._chunkCombatTarget = enc.proxy; // never the player: the AI walks toward the statue stand-in
      const t = TILE();
      if (dist(e.x / t, e.y / t, statue.x, statue.z) <= CONFIG.plantRangeTiles) {
        const bomb = (window.Shattercasks?.activeBurdenRecords?.(enc.mapId) || []).find(b => b.enemyCarrier === e && !b.exploded);
        if (bomb && window.HronalWitchBombs?.dropEnemyBomb?.(bomb)) {
          bomb.spawnedAtMs = now(); bomb.fuseSeconds = Math.max(1, Number(enemy.entry.plantFuseSeconds) || 4); // the fuse starts when it is planted
          enemy.planted = true; enemy.plantedAt = enc.clock; e._chunkCombatTarget = null;
          emit('encounter:plant', { scope: enc.mapId, encounterId: enc.id, bombId: bomb.id, fuseSeconds: bomb.fuseSeconds, x: statue.x, z: statue.z });
        }
      }
    },
  });
  function registerEnemyKind(kind, impl) { kinds.set(String(kind), impl); return impl; }

  // ---------------------------------------------------------------- the defend objective's view of the world
  const plinthNode = enc => window.FurniturePuzzleRuntime?.getNode?.(enc.mapId, enc.objective.plinthId) || null;
  function plinthState(enc) {
    const node = plinthNode(enc);
    if (!node) return { present: false };
    const payload = node.userData?.burdenPlatePayload || null;
    const seated = !!payload && !payload.exploded && !!payload.group?.parent && payload.group.parent === node.userData?.burdenPlateAnchor;
    return { present: true, node, payload, seated, complete: !!node.userData?.burdenPlateComplete, progress: Number(node.userData?.puzzleProgress) || 0 };
  }

  // ---------------------------------------------------------------- encounters
  // options: { id?, mapId, objective:{ type:'defend', plinthId, fragileStatue? }, spawners:[{x,z,facing?}], schedule:[{t,kind,count,spawner,plantFuseSeconds?}],
  //            tier?, maxAlive?, surfaceY?(x,z), retry? }
  function create(options = {}) {
    const id = String(options.id || ('encounter_' + (++serial)));
    if (encounters.has(id)) remove(id);
    const enc = {
      id, mapId: String(options.mapId || window.GridTileAccessors?.getCurrentArea?.() || ''), objective: { fragileStatue: true, ...options.objective },
      spawners: (options.spawners || []).map((s, i) => ({ index: i, x: Number(s.x), z: Number(s.z), facing: s.facing || null })),
      schedule: [...(options.schedule || [])].sort((a, b) => a.t - b.t), tier: Number(options.tier) || 0, maxAlive: Number(options.maxAlive) || CONFIG.maxAlive,
      surfaceY: options.surfaceY || null, retry: options.retry !== false,
      state: 'waiting', clock: 0, next: 0, enemies: [], pending: 0, stats: { spawned: 0, planted: 0, failures: 0, successes: 0 },
      proxy: { id: id + '_statue_proxy', x: 0, y: 0, health: 1e9, maxHealth: 1e9, areaId: String(options.mapId || ''), creatureKey: 'encounterStatueProxy', invulnUntil: Infinity, isEncounterProxy: true, facing: CONFIG.proxyFacing, angle: 0 },
      statuePoint() { const p = plinthState(this).payload; if (!p?.group) return null; const v = p.group.getWorldPosition ? p.group.getWorldPosition(this._v ||= (window.THREE ? new window.THREE.Vector3() : { x: 0, y: 0, z: 0 })) : p.group.position; return { x: v.x, y: v.y, z: v.z }; },
      removeEnemy(enemy, reason) { removeEnemy(this, enemy, reason); },
      stop(reason) { return stop(this, reason); },
    };
    enc.proxy.areaId = enc.mapId;
    encounters.set(id, enc);
    emit('encounter:armed', { scope: enc.mapId, encounterId: id });
    ensureScheduler(); ensureBlastListener();
    return enc;
  }
  function remove(id) { const enc = typeof id === 'string' ? encounters.get(id) : id; if (!enc) return false; clearEnemies(enc, 'removed'); encounters.delete(enc.id); return true; }
  const clearScope = mapId => { let n = 0; for (const enc of [...encounters.values()]) if (enc.mapId === String(mapId) && remove(enc)) n++; return n; };

  function removeEnemy(enc, enemy, reason) {
    const i = enc.enemies.indexOf(enemy);
    if (i >= 0) enc.enemies.splice(i, 1);
    kinds.get(enemy.kind)?.dispose?.(enc, enemy);
    if (enemy.entity) { enemy.entity._chunkCombatTarget = null; disposeEntity(enemy.entity); }
  }
  function clearEnemies(enc, reason) { for (const enemy of [...enc.enemies]) removeEnemy(enc, enemy, reason); }

  function start(enc) {
    enc.state = 'running'; enc.clock = 0; enc.next = 0; enc.pending = 0; enc.statueDestroyed = false;
    emit('encounter:start', { scope: enc.mapId, encounterId: enc.id, waves: enc.schedule.length });
  }
  function stop(enc, reason) {
    clearEnemies(enc, reason);
    enc.state = reason === 'success' ? 'success' : (enc.retry ? 'waiting' : 'failed');
    return enc.state;
  }

  async function spawnEntry(enc, entry) {
    const kind = kinds.get(entry.kind), spawner = enc.spawners[entry.spawner % Math.max(1, enc.spawners.length)];
    if (!kind || !spawner) return 0;
    let spawned = 0;
    for (let i = 0; i < Math.max(1, entry.count | 0); i++) {
      if (enc.enemies.length + enc.pending >= enc.maxAlive) break;
      enc.pending++;
      let entity = null;
      try { entity = await kind.spawn(enc, entry, spawner); } catch (error) { console.warn('[RuinEncounters] spawn failed', error); }
      enc.pending--;
      if (!entity) continue;
      if (enc.state !== 'running' || !encounters.has(enc.id)) { disposeEntity(entity); continue; } // The encounter ended while the enemy was being built.
      attachSurface(enc, entity);
      const enemy = { kind: entry.kind, entry, entity, spawner: spawner.index, bornAt: enc.clock, released: false, planted: false };
      enc.enemies.push(enemy); enc.stats.spawned++; spawned++;
      emit('encounter:spawn', { scope: enc.mapId, encounterId: enc.id, kind: entry.kind, spawner: spawner.index, x: spawner.x, z: spawner.z });
    }
    return spawned;
  }

  function tickEncounter(enc, dt) {
    const plinth = plinthState(enc);
    if (enc.state === 'waiting') {
      if (plinth.present && plinth.seated && !plinth.complete) start(enc); // The statue is on the plinth: the press (and the encounter) begins.
      return;
    }
    if (enc.state !== 'running') return;
    // objective: lost statue = failure; finished press = success
    if (!plinth.present || !plinth.seated) {
      if (plinth.complete) { enc.stats.successes++; emit('encounter:success', { scope: enc.mapId, encounterId: enc.id, seconds: +enc.clock.toFixed(2) }); stop(enc, 'success'); return; }
      const retrieved = plinth.present && !plinth.payload && !enc.statueDestroyed; // the player took it back off the plinth: not a failure, the encounter just re-arms
      if (!retrieved) { enc.stats.failures++; emit('encounter:failed', { scope: enc.mapId, encounterId: enc.id, reason: 'statue-lost', seconds: +enc.clock.toFixed(2) }); }
      stop(enc, retrieved ? 'retrieved' : 'failed'); return;
    }
    if (plinth.complete) { enc.stats.successes++; emit('encounter:success', { scope: enc.mapId, encounterId: enc.id, seconds: +enc.clock.toFixed(2) }); stop(enc, 'success'); return; }
    enc.clock += dt;
    // The press IS the encounter: when the plinth reports how far along it is, the clock follows it (a long frame, a hitch or a
    // slow device then cannot let the press finish ahead of the schedule). dt only fills in between, or stands in without a plinth clock.
    const press = Number(plinth.node?.userData?.furniturePuzzle?.motion?.durationSeconds);
    if (press > 0 && plinth.progress > 0) enc.clock = Math.max(enc.clock, Math.min(press, plinth.progress * press));
    const statue = enc.statuePoint(), t = TILE();
    if (statue) { enc.proxy.x = statue.x * t; enc.proxy.y = statue.z * t; }
    while (enc.next < enc.schedule.length && enc.schedule[enc.next].t <= enc.clock) { const entry = enc.schedule[enc.next++]; spawnEntry(enc, entry); }
    for (const enemy of [...enc.enemies]) {
      const e = enemy.entity;
      if (!e || Number(e.health) <= 0 || !deps()?.hostileObjects?.has?.(e) && enemy.released) { removeEnemyIfGone(enc, enemy); continue; }
      if (!enemy.released && enc.clock - enemy.bornAt >= CONFIG.emergeSeconds) { deps()?.hostileObjects?.add?.(e); enemy.released = true; } // AI starts once it has come out
      if (enemy.released) kinds.get(enemy.kind)?.update?.(enc, enemy, dt);
    }
  }
  function removeEnemyIfGone(enc, enemy) { const i = enc.enemies.indexOf(enemy); if (i >= 0) enc.enemies.splice(i, 1); if (enemy.entity) enemy.entity._chunkCombatTarget = null; }

  function tick(dt = 0) {
    if (!encounters.size) return;
    const step = Math.min(0.1, Math.max(0, Number(dt) || 0)), mapId = String(window.GridTileAccessors?.getCurrentArea?.() || '');
    for (const enc of encounters.values()) if (enc.mapId === mapId) tickEncounter(enc, step);
  }

  // Any blast that reaches the statue destroys it (an explosion near a plinth is what the demolitionists are for).
  let blastUnsub = null;
  function ensureBlastListener() {
    if (blastUnsub || !window.WorldEvents) return;
    blastUnsub = window.WorldEvents.on('blast', p => {
      for (const enc of encounters.values()) {
        if (enc.state !== 'running' || enc.mapId !== p.scope || enc.objective.fragileStatue === false) continue;
        const plinth = plinthState(enc), statue = enc.statuePoint();
        if (!plinth.seated || !statue || dist(statue.x, statue.z, p.x, p.z) > Number(p.radius || 0)) continue;
        enc.statueDestroyed = true; // the plinth empties either way; this tells a destroyed statue from one the player took back
        emit('encounter:statue-destroyed', { scope: enc.mapId, encounterId: enc.id, sourceId: p.sourceId || null });
        window.Shattercasks?.discardBurden?.(plinth.payload); // the plinth's own payload watch then reverses the press; the dispenser returns a statue
      }
    });
  }
  function ensureScheduler() {
    if (schedulerUnsub || !window.RuntimeFrameScheduler?.register) return;
    schedulerUnsub = window.RuntimeFrameScheduler.register('ruin-encounters', ({ deltaMs }) => tick((Number(deltaMs) || 0) / 1000), { phase: 'pre-game', owner: 'RuinEncounters', description: 'Spawns and steers encounter enemies and watches the objective.' });
  }

  const debugSnapshot = () => ({ encounters: [...encounters.values()].map(e => ({ id: e.id, mapId: e.mapId, state: e.state, clock: +e.clock.toFixed(1), next: e.next, waves: e.schedule.length, alive: e.enemies.length, stats: { ...e.stats } })) });
  const configure = o => { Object.assign(CONFIG, o || {}); return { ...CONFIG }; };

  window.RuinEncounters = Object.freeze({ installed: true, CONFIG, create, remove, clearScope, tick, registerEnemyKind, configure, debugSnapshot, get encounters() { return [...encounters.values()]; } });
})();
