// Interior-only Tzatzul mother-and-clutch encounter. The normal cavern
// locale supplies floor/collision; TzatzulNestInterior supplies rock perches
// and authored sharp stone. This runs in WildlifeSpawn's existing tick.
(() => {
  'use strict';
  if (window.TzatzulNestEncounter) return;
  const REST_S = 1.35; // Short perch pauses make the mother dangerous without a faraway retreat.
  const MOTHER_HEALTH_MULT = 3.5; // Big encounter health pool relative to the ordinary Tzatzul.
  const MOTHER_DAMAGE_MULT = 1.6; // The indoor dive uses the same body hit logic with stronger existing knockback.
  const rooms = new Map(); // Cave map -> one persisted in-session mother/hatchling encounter, never duplicated on re-entry.
  const owned = new Set(); // Flight-ownership adapter for game.js's canonical ground AI bypass.
  let deps = null; // WildlifeSpawn's existing creature factory, player, and hostile collections.
  let lastArea = null; // Only area changes trigger global-perch registry maintenance.
  const stats = { spawned: 0, completed: 0, dives: 0, wallHits: 0, spikeHits: 0,
    deposited: 0, lastImpact: null, lastError: null }; // Serialized mobile diagnostics, no retained mesh snapshots.
  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const tile = () => Math.max(1, finite(deps?.TILE, 64));
  const healthy = actor => !!actor && actor.health > 0;
  const within = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
  const saved = new Map(); // Small per-nest save records; meshes and original live actors stay outside serialized data.
  const victims = new Map(); // Nest map -> at most eight original, visibly carried victims for this session.
  const preparing = new Set(); // Prevent overlapping async portrait preparation on re-entry.
  function stateFor(mapId) {
    if (!saved.has(mapId)) saved.set(mapId, { eggs: 3, completed: false, victims: [] });
    return saved.get(mapId);
  }
  function buildNest(mapId, mapData, scene) {
    if (!window.TzatzulNestInterior?.isNestMap?.(mapId) || !deps?.denNests) return null;
    const plan = mapData.cavernFeatures?.tzatzulNest;
    if (!plan) return null;
    const old = deps.denNests.get(mapId); // Scene rebuilds retain the authoritative remaining clutch count.
    const nest = old || { col: finite(plan.arenaCenter?.col, 13) - 1,
      row: finite(plan.arenaCenter?.row, 13) + 2, w: 2, h: 2,
      itemKey: 'tzatzulEgg', liveBirth: false, remaining: stateFor(mapId).eggs,
      floorY: finite(mapData.floorSurfaceY) };
    deps.denNests.set(mapId, nest);
    window.DenNestSystem?.ensureCavernNestFurniture?.(nest, scene, deps.buildFurnitureVisual);
    return nest;
  }
  function storeVictim(prey, bird, rendered) {
    const mapId = bird?.tzatzulNestMapId;
    if (!rendered || !window.TzatzulNestInterior?.isNestMap?.(mapId)
      || !healthy(prey) || prey === deps?.player || !prey.avatarRef?.group
      || (!deps.hostileObjects.has(prey) && !deps.companionObjects?.has(prey))) return false;
    const state = stateFor(mapId); // Unseen prey and a full hoard are safely released alive by the flight owner.
    if (state.victims.length >= 8) return false;
    const index = state.victims.length; // Stable in-session and saved corpse identity, independent of random actor IDs.
    state.victims.push({ creatureKey: prey.creatureKey, name: prey.name || '',
      genotype: prey.genotype || null, roster: prey.rosterRecord || null,
      bandit: !!prey.isBandit, looted: false });
    const stored = victims.get(mapId) || new Map();
    stored.set(index, prey); victims.set(mapId, stored);
    deps.hostileObjects.delete(prey); deps.companionObjects?.delete(prey);
    window.PerchSupport?.forget?.(prey);
    prey.onBranch = null; prey.health = 0; prey.state = 'corpse';
    prey.tzatzulNestVictim = mapId; prey.keepCorpseAfterLoot = true;
    prey.def = { ...prey.def, lootPool: 'mixedCrateTreasurePuzzle' }; // Never modify the original species' shared loot definition.
    prey.avatarRef.group.parent?.remove(prey.avatarRef.group);
    prey.groundShadow?.parent?.remove(prey.groundShadow);
    for (const key of ['_banditToolHolder','_banditRangedToolHolder','_banditFlaskToolHolder','_banditTrailMesh']) {
      if (prey[key]) prey[key].visible = false;
    }
    stats.deposited++;
    deps.save?.();
    return true;
  }
  async function headless(prey) {
    const ref = prey.avatarRef; // Redraw humanoids with their own profile, retaining clothing and dyes below the missing head.
    if (ref?.profile && ref.frontCanvas && window.NpcAvatarPreview?.renderProfileToCanvas) {
      for (const [canvas, behind] of [[ref.frontCanvas, false], [ref.backCanvas, true]]) {
        if (!canvas) continue;
        canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
        await window.NpcAvatarPreview.renderProfileToCanvas(canvas, ref.profile,
          { forceEyesOpen: true, omitHeadSpriteAndCosmetics: true, ...(behind ? { portraitView: 'behind' } : {}) });
      }
      window.PNGPlaneAvatar?.refreshSinglePlaneAvatarModel?.(ref.textureRoot || ref.group,
        ref.frontCanvas, { backCanvas: ref.backCanvas });
    } else {
      // Animal PNGs share the authored head-weight rig; collapse its head-only vertices at the neck.
      for (const bone of [ref?.headRig?.frontHeadBone, ref?.headRig?.backHeadBone]) bone?.scale?.setScalar?.(.001);
    }
  }
  async function layVictims(mapId) {
    const targetScene = deps?.buildingScenes?.get(mapId)?.scene; // Skip completed layouts without allocating a Promise chain every tick.
    const descriptions = saved.get(mapId)?.victims;
    if (!targetScene || !descriptions?.length || preparing.has(mapId)
      || descriptions.every((_, index) => victims.get(mapId)?.get(index)?.tzatzulCorpsePlaced === targetScene)) return;
    preparing.add(mapId);
    const generation = deps; // A new-world reset invalidates in-flight portrait loads.
    const state = stateFor(mapId), stored = victims.get(mapId) || new Map();
    victims.set(mapId, stored);
    try {
      for (let index = 0; index < state.victims.length; index++) {
        if (deps !== generation || deps.getCurrentArea?.() !== mapId) break;
        const description = state.victims[index], building = deps.buildingScenes.get(mapId);
        let prey = stored.get(index); // Keep original actor/canvases when this session actually witnessed its carry.
        if (prey?.tzatzulCorpsePlaced === building.scene) continue;
        const plan = window.TzatzulNestInterior.getArena(mapId);
        const x = (finite(plan?.arenaCenter?.col, 13) - 2 + index % 4) * tile();
        const y = (finite(plan?.arenaCenter?.row, 13) + 4 + Math.floor(index / 4)) * tile();
        if (!prey && description.bandit && description.roster) {
          prey = await window.BanditCombat?.makeEntity?.({}, 'grunt', 1, x, y,
            { zoneId: mapId, rosterOverride: description.roster, preserveRoster: true });
        } else if (!prey && description.creatureKey) {
          prey = deps.makeCreatureEntity(description.creatureKey, x, y,
            { scene: building.scene, grid: building.grid, cols: building.cols, rows: building.rows,
              areaId: mapId, genotype: description.genotype });
        }
        if (!prey) continue;
        stored.set(index, prey);
        deps.hostileObjects.delete(prey); deps.companionObjects?.delete(prey);
        prey.areaId = mapId; prey.areaGrid = building.grid; prey.areaCols = building.cols; prey.areaRows = building.rows;
        prey.scene = building.scene; prey.x = x; prey.y = y;
        prey.tzatzulNestVictim = mapId; prey.keepCorpseAfterLoot = true;
        prey.def = { ...prey.def, lootPool: 'mixedCrateTreasurePuzzle' };
        prey.corpseLooted = !!description.looted;
        await headless(prey);
        if (deps !== generation) { generation.despawnCreature?.(prey); break; }
        building.scene.add(prey.avatarRef.group);
        if (prey.groundShadow) building.scene.add(prey.groundShadow);
        if (window.CreatureDeath?.settleAsCorpse?.(prey, { yaw: index * 1.7 })) {
          prey.tzatzulCorpsePlaced = building.scene;
          prey.avatarRef.group.visible = deps.getCurrentArea?.() === mapId;
          if (prey.groundShadow) prey.groundShadow.visible = deps.getCurrentArea?.() === mapId;
        }
      }
    } catch (error) { stats.lastError = String(error); }
    finally { preparing.delete(mapId); }
  }
  function serialize() {
    for (const [mapId, state] of saved) {
      const nest = deps?.denNests?.get(mapId); // Native hold-to-take owns the live clutch; save its current value.
      if (nest) state.eggs = Math.max(0, Math.floor(finite(nest.remaining)));
      const room = rooms.get(mapId); // Add deaths remain independent of the mother's defeated flag.
      if (room) {
        const dead = new Set(state.hatchlingsDead || []);
        for (const actor of room.hatchlings) if (!healthy(actor)) dead.add(actor.tzatzulClutchIndex);
        state.hatchlingsDead = [...dead];
      }
      for (const [index, actor] of victims.get(mapId) || []) {
        if (state.victims[index]) state.victims[index].looted = !!actor.corpseLooted;
      }
    }
    return { version: 1, nests: [...saved].map(([mapId, state]) => ({ mapId, ...state })) };
  }
  function restore(data) {
    saved.clear();
    for (const entry of Array.isArray(data?.nests) ? data.nests : []) {
      if (!window.TzatzulNestInterior?.isNestMap?.(entry.mapId)) continue;
      saved.set(entry.mapId, { eggs: within(Math.floor(finite(entry.eggs, 3)), 0, 3),
        completed: !!entry.completed, hatchlingsDead: (Array.isArray(entry.hatchlingsDead) ? entry.hatchlingsDead : []).filter(index => Number.isInteger(index) && index >= 0 && index < 8), victims: Array.isArray(entry.victims) ? entry.victims.filter(victim => victim && typeof victim === 'object' && (victim.creatureKey || victim.roster)).slice(0, 8) : [] });
    }
  }
  function spawn(mapId) {
    const interior = window.TzatzulNestInterior, flight = window.TzatzulFlightRuntime;
    const plan = interior?.getArena?.(mapId);
    if (deps?.buildingScenes && !deps.buildingScenes.get(mapId)?.scene) return null; // Wait for the native asynchronous cave loader before constructing actors.
    if (!deps?.makeCreatureEntity || !deps?.hostileObjects || !plan || !flight?.beginNestDive) return null;
    const support = interior.ensurePerches(mapId, tile()); // Exactly once per encounter; point supports reuse the shared global system.
    if (support.length < 2) return null;
    const appearance = window.TzatzulRegistration?.identityFor?.(plan.zoneId, plan.slot);
    if (!appearance) return null;
    const first = support[0];
    const mother = stateFor(mapId).completed ? null : deps.makeCreatureEntity('tzatzul', first.x, first.y, {
      homeX: first.x, homeY: first.y, state: 'idle', streamVisuals: true,
      wildlifeRole: 'predator', tzatzulNestCave: mapId, isBoss: true,
    });
    if (!mother && !stateFor(mapId).completed) return null;
    if (mother) {
      const baseline = Math.max(80, finite(mother.maxHealth, finite(mother.health, 100)));
      mother.maxHealth = Math.max(300, baseline * MOTHER_HEALTH_MULT);
      mother.health = mother.maxHealth;
      mother.def = { ...(mother.def || {}), attackDamage: Math.ceil(Math.max(24, finite(mother.def?.attackDamage, 24)) * MOTHER_DAMAGE_MULT) };
      mother.areaId = mapId;
      mother.tzatzulIdentity = appearance;
      mother.tzatzulFlightPose = 'perched';
      mother._tzNestMother = true; // Gameplay knockback and enemy ground-path skipping use this single marker.
      mother._tzFlight = { identity: appearance, roostId: first.id, roost: first,
        phase: 'perched', elapsed: 0, rest: REST_S, target: null,
        segment: null, struck: false, captive: null };
      if (!window.PerchSupport?.attach?.(mother, first)) return null;
      deps.hostileObjects.add(mother);
      owned.add(mother);
    }
    const hatchlings = []; // Real living adds use their registered foot-hinged peck attack, not decorative PNG clones.
    for (const [index, child] of (plan.hatchlings || []).entries()) {
      if (stateFor(mapId).hatchlingsDead?.includes(index)) continue;
      const x = (finite(child.col) + .5) * tile(), y = (finite(child.row) + .5) * tile();
      const hatchling = deps.makeCreatureEntity('tzatzul-hatchling', x, y, {
        homeX: x, homeY: y, state: 'idle', streamVisuals: true,
        tzatzulNestCave: mapId, wildlifeRole: 'predator',
      });
      if (!hatchling) continue;
      hatchling.areaId = mapId;
      hatchling.tzatzulIdentity = window.TzatzulRegistration?.identityFor?.(plan.zoneId, plan.slot, appearance);
      hatchling.tzatzulMother = mother;
      hatchling.tzatzulClutchIndex = index; // Saved add deaths preserve the actual surviving clutch after reload.
      deps.hostileObjects.add(hatchling);
      hatchlings.push(hatchling);
    }
    const session = { mapId, plan, mother, hatchlings, supports: support,
      floorY: finite(interior.getFloorY?.(mapId)), // Cave wall and stone spike collisions use the renderer's own carved floor elevation.
      perchIndex: 0, completed: !!stateFor(mapId).completed, lastPhase: 'perched', lastEvent: 'mother roosted' };
    rooms.set(mapId, session);
    stats.spawned++;
    window.__farmLog?.('[tzatzul] mother and ' + hatchlings.length + ' hatchlings roosted in ' + mapId,'wildlife');
    return session;
  }
  function init(injected) {
    for (const stored of victims.values()) for (const actor of stored.values()) deps?.despawnCreature?.(actor);
    victims.clear(); preparing.clear(); saved.clear();
    deps = injected; // Reuse the world data; no new RAF, map, timer, or creature factory.
    for (const old of owned) {
      old._tzNestMother = false;
      if (old._tzFlight?.captive) window.TzatzulFlightRuntime?.__test?.releaseCaptive?.(old._tzFlight.captive,'nest reset');
    }
    owned.clear(); rooms.clear(); lastArea = null;
  }
  function owns(bird) { return owned.has(bird) && !!bird._tzNestMother && healthy(bird); }
  function ensure(mapId = deps?.getCurrentArea?.()) {
    if (!window.TzatzulNestInterior?.isNestMap?.(mapId)) return null;
    const existing = rooms.get(mapId);
    if (existing) return existing;
    return spawn(mapId);
  }
  function impactDamage(target, amount) {
    const before = Math.max(0, finite(target.health));
    const attack = window.Combat?.deps?.damageCreature;
    if (typeof attack === 'function') attack(target, amount, target.x, target.y, 0,
      { tag: 'blunt', attacker: null, environmentalImpact: true });
    else if (typeof window.ResourceSystem?.applyDamage === 'function')
      window.ResourceSystem.applyDamage(target, amount, { tag: 'blunt', source: 'tzatzul nest wall impact' });
    else target.health = Math.max(0, before - amount);
    const after = Math.max(0, finite(target.health));
    return { applied: Math.min(before, before - after), lethal: before > 0 && after <= 0 };
  }
  function nearestObstacle(map, start, end, birdHalf) {
    const plan = map.plan, foot = finite(birdHalf?.y, .55);
    let best = null, bestT = Infinity;
    const check = (tileX, tileZ, hazard) => {
      // Closest point to one compact obstacle on this frame's swept body
      // path. Fast dives cannot skip the sharp stone clusters.
      const dx = end.x - start.x, dz = end.z - start.z, len = dx*dx + dz*dz;
      const t = len > 1e-9 ? within(((tileX-start.x)*dx + (tileZ-start.z)*dz)/len,0,1) : 0;
      const x = start.x+dx*t, z=start.z+dz*t, y=start.y+(end.y-start.y)*t;
      const radius = hazard ? .50 : .77; // Invisible 1x1 stone supports and roughly 0.7 radius rock pillars.
      const height = hazard ? 1.30 : 2.4;
      const sweep = window.TzatzulFlightRuntime?.sweptBodyHit;
      const contact = sweep ? sweep(start, end, { x: finite(birdHalf?.x, .3), y: foot, z: finite(birdHalf?.z, .3) },
        { min: { x:tileX-radius, y:map.floorY, z:tileZ-radius },
          max: { x:tileX+radius, y:map.floorY+height, z:tileZ+radius } })
        : Math.hypot(x-tileX,z-tileZ) <= radius + .3 && y-foot <= height + map.floorY ? t : null;
      if (contact !== null && contact < bestT) { bestT = contact; best = { kind: hazard ? 'sharp-spikes' : 'stone-rock', t:contact }; }
    };
    for (const spike of plan.stoneSpikeClusters || []) check(finite(spike.col)+.5,finite(spike.row)+.5,true);
    for (const rock of plan.wallPerches || []) check(finite(rock.col)+.5,finite(rock.row)+.5,false);
    const center = plan.arenaCenter || {};
    const endRadius = Math.hypot(end.x-(finite(center.col)+.5),end.z-(finite(center.row)+.5));
    const allowed = Math.max(3,finite(plan.arenaRadiusTiles,10)-.55);
    if (endRadius > allowed && end.y-foot <= map.floorY + 2.2) {
      const radial = { kind:'cave-wall', t: 1 };
      if (!best || bestT > radial.t) best = radial;
    }
    return best;
  }
  function resolveTerrainImpact(bird, previous, current, segment) {
    const map = rooms.get(bird?.areaId);
    if (!map || map.mother !== bird || bird._tzFlight?.phase !== 'swoop' ||
        !segment || bird.branchT < .20) return false; // Leaving the departure perch never counts as running into it.
    const obstacle = nearestObstacle(map, previous, current, segment.half);
    if (!obstacle) return false;
    const from = segment.from || { x: bird.x, y: bird.y, worldY: bird.branchSurfaceY };
    const to = segment.to || from;
    const intended = Math.hypot(to.x-from.x,to.y-from.y,(to.worldY-from.worldY)*tile());
    const traveled = Math.hypot(bird.x-from.x,bird.y-from.y,(bird.branchSurfaceY-from.worldY)*tile());
    const movement = { airborne:true,lungeMaxDistancePx:intended,lungeTraveledPx:traveled };
    const sharp = obstacle.kind === 'sharp-spikes';
    const impact = window.KnockbackCollisionImpact?.resolveAerialLunge?.(bird,movement,{
      kind:'stone',bladedHazard:sharp,label:sharp?'Sharp nest stalagmites':'Tzatzul nest rock wall'
    },tile(),{dealHealthDamage:impactDamage});
    if (!impact) return false; // Full travel or a harmless contact cannot double damage a bird.
    if (sharp) stats.spikeHits++; else stats.wallHits++;
    stats.lastImpact = { kind:obstacle.kind,deficitTiles:impact.deficitTiles,
      health:finite(bird.health),perchIndex:map.perchIndex };
    map.lastEvent = sharp?'mother struck sharp stalagmites':'mother struck the cave wall';
    window.__farmLog?.('[tzatzul] '+map.lastEvent,'combat');
    return true;
  }
  function update(dt) {
    const area = deps?.getCurrentArea?.();
    if (area !== lastArea) {
      window.TzatzulNestInterior?.releaseInactive?.(area);
      const cached = rooms.get(area); // Returning to a cached cavern re-registers supports once, never per frame.
      if (cached && !cached.completed) cached.supports = window.TzatzulNestInterior.ensurePerches(area, tile());
      lastArea = area;
    }
    if (!window.TzatzulNestInterior?.isNestMap?.(area)) return;
    const session = ensure(area);
    if (session) void layVictims(area); // Bounded async work only for this nest's delivered bodies.
    if (!session || session.completed) return;
    const mother = session.mother, state = mother?._tzFlight;
    if (!healthy(mother) || !deps.hostileObjects.has(mother)) {
      session.completed = true; owned.delete(mother); stats.completed++;
      stateFor(area).completed = true; deps.save?.();
      return; // Mother remains dead until a proper cave turnover/save rule is added.
    }
    if (!state || !healthy(deps.player)) return;
    if (!mother.onPerch || mother.prone || mother.knockbackT > 0) {
      if (!mother.prone && !mother._knockbackLedgeFall && !mother._knockbackLedgeAir && !(mother.knockbackT > 0)) {
        state.roost = session.supports[session.perchIndex];
        window.TzatzulFlightRuntime?.returnToRoost?.(mother); // Recover to a real perch after native ledge-fall motion finishes.
      }
      return;
    } // Canonical falling/knockback owns an interrupted bird.
    const step = within(finite(dt), 0, .1);
    if (state.phase !== 'perched') {
      const before = state.phase;
      window.TzatzulFlightRuntime?.advanceNestFlight?.(mother,step); // Same swept BODY hit implementation as exterior Tzatzuls.
      if (before === 'return' && state.phase === 'perched') {
        state.rest = REST_S;
        state.elapsed = 0;
      }
      return;
    }
    state.elapsed += step;
    if (state.elapsed < state.rest) return;
    // Always choose a *different* far-side perch before diving; the normal
    // flight return then continues beyond the player without turning around.
    session.perchIndex = (session.perchIndex + Math.max(1,Math.floor(session.supports.length/2)))%session.supports.length;
    state.roost = session.supports[session.perchIndex]; // The far-side perch is the return/landing objective.
    state.roostId = state.roost.id;
    if (window.TzatzulFlightRuntime?.beginNestDive?.(mother,deps.player)) {
      session.lastEvent = 'mother dived toward the player';
      stats.dives++;
    } else { state.elapsed=0; state.rest=REST_S; }
  }
  function debugSnapshot() {
    return { ...stats, area:lastArea, encounters:[...rooms.values()].map(room => ({
      mapId:room.mapId, motherHealth:finite(room.mother?.health), motherAlive:healthy(room.mother), eggs:deps?.denNests?.get(room.mapId)?.remaining ?? stateFor(room.mapId).eggs,
      victims:stateFor(room.mapId).victims.length,
      hatchlingsAlive:room.hatchlings.filter(healthy).length,
      phase:room.mother?._tzFlight?.phase || null, perchIndex:room.perchIndex,
      complete:room.completed, lastEvent:room.lastEvent,
    })) };
  }
  window.TzatzulNestEncounter=Object.freeze({init,update,owns,ensure,resolveTerrainImpact,debugSnapshot,buildNest,storeVictim,serialize,restore,
    __test:Object.freeze({nearestObstacle,impactDamage})});
})();
