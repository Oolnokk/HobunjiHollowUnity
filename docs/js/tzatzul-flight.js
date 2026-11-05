// Tzatzul autonomous flight, adult/hatchling rigs, and shared airborne carry.
// Installs through WildlifeSpawn's real dependency bag and gameLoop's existing
// HoneyfuzzleHives.control seam; no independent animation frame or global scan.
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TzatzulFlight = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const SPECIES = 'tzatzul', HATCHLING = 'tzatzul-hatchling';
  const CHECK_INTERVAL = 0.55; // Existing hostile loop calls control once per frame; prey searches run at most twice a second.
  const MAX_PREY_TILES = 33; // Extended sight radius for prey, separate from normal 14–18 tile wildlife visuals.
  const CAPTURE_RADIUS = 0.85; // Dive must actually intersect a target to grab it.
  const BASE_FLIGHT_HEIGHT = 5.6; // Cruise height above the spire's base in world terrain units.
  const ADULT_BIRD_SCALE = 2; // Authored config wins when loaded; used only for missing-config fallback.
  const air = new Map(); // Stable spire id -> living adult, flight phase and carried target.
  const visited = new Set(); // A killed adult cannot be resurrected by the two-second zone population scan.
  const sessions = new WeakMap(); // One finite state machine per live entity, never written to the shared species definition.
  const imageCache = new Map(); // Relative PNG path -> one CORS-clean image promise shared by birds and hatchlings.
  const debug = { spawns: 0, grabs: 0, drops: 0, escorts: 0, frames: 0, errors: 0, lastError: null, lastEvent: null };
  let deps = null; // WildlifeSpawn injects native creature definitions, spawning, rendering and area ownership.
  let sceneDeps = null; // DenNestSystem injects existing player/interior scene-transition ownership.
  let pathDeps = null; // NpcPathfinding injects on-demand building scene loading without a new copy of it.
  let rigConfig = null; // One normalized approved JSON profile, read by both adult and juvenile presenters.
  let rigPromise = null; // Prevents duplicate preset/PNG requests across zone-entries.
  let promptOwner = false; // WorldActionInputClaims owner flag; no DOM write when nothing changed.
  let promptNest = null; // Cached nearby spire to keep one onPress callback stable.
  let escort = null; // Voluntary player lift session, never an involuntary hostile attack.
  let previousArea = null; // Zone changes release carried prey and retire stale outer-zone rigs.

  const finite = (n, fallback = 0) => Number.isFinite(Number(n)) ? Number(n) : fallback;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const angleDelta = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
  const speciesOf = c => c?.creatureKey || c?.kind || c?.def?.key || c?.speciesKey || '';
  const areaOf = c => c?._wildernessLodAreaId || c?.areaId || c?.zoneId || '';
  const pos = c => ({ x: finite(c?.x), y: finite(c?.y) });
  const sceneCamera = () => root.Combat?.deps?.getActiveCamera?.() || root.Shattercasks?.deps?.getActiveCamera?.() || null;

  function sizeClass(target) {
    const name = speciesOf(target);
    const authored = target?.genotype?.sizeClass || target?.sizeClass || target?.def?.defaultSizeClass ||
      deps?.CREATURE_DB?.[name]?.defaultSizeClass;
    return String(authored || 'medium').toLowerCase();
  }
  function eligiblePrey(target, bird, allowPlayer = false) {
    if (!target || target === bird || target._flyingCarriedBy || target._deathTransitionStarted ||
      target.prone || target._companionDowned || target._tzatzulFlight) return false;
    if (allowPlayer && target === deps?.player) return true; // Explicit voluntary request only.
    if (target === deps?.player || target.isPlayer || target.health <= 0 || target.dead || target.deceased) return false;
    if (areaOf(target) !== areaOf(bird)) return false;
    const humanoid = target.isBandit || target.isTribeHunter || target.isPorakanekiHunter ||
      target.isBarbarian || target.tribeId || target.isNpcWalker;
    if (humanoid) return true; // Armed bandits/barbarians use the same talon transport pose.
    return sizeClass(target) === 'small' || sizeClass(target) === 'medium';
  }
  function findPrey(bird) {
    let best = null, bestD2 = Infinity;
    const radius2 = (MAX_PREY_TILES * finite(deps?.TILE, 32)) ** 2;
    for (const actor of deps?.hostileObjects || []) {
      if (!eligiblePrey(actor, bird)) continue;
      const d2 = (actor.x - bird.x) ** 2 + (actor.y - bird.y) ** 2;
      if (d2 < radius2 && d2 < bestD2) { bestD2 = d2; best = actor; }
    }
    // Scheduled walkers lack Health/Combat; use the existing raw walker list only
    // when present, and let them return to their schedule when released.
    const walkers = pathDeps?.npcWalkers || root._npcWalkers || [];
    for (const walker of walkers) {
      if (!walker || !Number.isFinite(walker.x) || !Number.isFinite(walker.y)) continue;
      const candidate = Object.assign({ isNpcWalker: true, areaId: deps?.getCurrentArea?.() }, walker);
      if (!eligiblePrey(candidate, bird)) continue;
      const d2 = (candidate.x - bird.x) ** 2 + (candidate.y - bird.y) ** 2;
      if (d2 < radius2 && d2 < bestD2) { bestD2 = d2; best = walker; }
    }
    return best;
  }
  function phaseStep(state, dt, goal, tileSize) {
    const delta = clamp(finite(dt), 0, 0.09); // Protect flight physics from paused/background-tab catch-up.
    const unit = Math.max(1, finite(tileSize, 32));
    const toX = finite(goal?.x, state.x) - state.x;
    const toY = finite(goal?.y, state.y) - state.y;
    const bearing = Math.atan2(toY, toX);
    const turn = clamp(angleDelta(state.heading, bearing), -delta * 1.6, delta * 1.6); // Sweeping hawk banking, never a pivot-on-a-dime.
    state.heading += turn;
    state.cycleT = finite(state.cycleT) + delta;
    const phase = state.phase || 'climb';
    const duration = phase === 'climb' ? 2.2 : phase === 'dive' ? 1.15 : 3.4;
    if (state.cycleT >= duration && !state.lockPhase) {
      state.cycleT -= duration;
      state.phase = phase === 'climb' ? 'dive' : phase === 'dive' ? 'glide' : 'climb';
    }
    const flying = state.phase || phase;
    // "Dragonriding" rhythm: flaps trade speed for upward lift; gravity takes
    // the bird into an accelerating dive; the following glide gradually sheds it.
    const horizontalSpeed = flying === 'climb' ? 2.9 : flying === 'dive' ? 6.4 : 4.2;
    const verticalSpeed = flying === 'climb' ? 1.65 : flying === 'dive' ? -2.8 : -0.38;
    const requiredAltitude = Math.max(1.2, finite(goal?.altitude, BASE_FLIGHT_HEIGHT));
    state.altitude = clamp(finite(state.altitude, BASE_FLIGHT_HEIGHT) + verticalSpeed * delta, 1.0, requiredAltitude + 4.2);
    if (state.altitude < requiredAltitude - 1.6 && flying !== 'dive') {
      state.altitude = Math.min(requiredAltitude, state.altitude + 1.1 * delta); // So a complete circuit retains enough lift to clear cliff lips.
    }
    state.speed = horizontalSpeed;
    const distance = Math.hypot(toX, toY);
    const advance = Math.min(horizontalSpeed * unit * delta, distance);
    state.x += Math.cos(state.heading) * advance;
    state.y += Math.sin(state.heading) * advance;
    return state;
  }

  function stateFor(bird, spire) {
    let state = sessions.get(bird);
    if (state) return state;
    state = {
      bird, spire, x: bird.x, y: bird.y,
      heading: finite(bird.facing), altitude: BASE_FLIGHT_HEIGHT,
      speed: 0, cycleT: 0, phase: 'climb', mode: 'orbit',
      target: null, carried: null, scanT: 0, animationT: 0,
      rig: null, rigRoot: null, carryVisual: null, carryingFrame: null,
      rendered: false, lastFrameArea: null, peckT: 0,
    }; // The bird's mutable flight state is separate from frozen authored rig data.
    sessions.set(bird, state);
    return state;
  }
  function preloadImage(path) {
    if (imageCache.has(path)) return imageCache.get(path);
    const promise = new Promise((resolve, reject) => {
      if (typeof Image === 'undefined') { reject(new Error('Image loader unavailable')); return; }
      const image = new Image();
      image.crossOrigin = 'anonymous'; // CanvasTexture needs CORS before setting src on a CDN preview.
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Cannot load flying creature sprite: ' + path));
      image.src = 'assets/' + path;
    });
    imageCache.set(path, promise);
    return promise;
  }
  function rigReady() {
    if (rigPromise) return rigPromise;
    const defaults = root.FlyingAnimalRig?.defaults;
    if (!defaults || typeof fetch !== 'function') return Promise.resolve(null);
    rigPromise = fetch('config/creatures/tzatzul-flying-rig.json')
      .then(response => response.ok ? response.json() : Promise.reject(new Error('Tzatzul rig HTTP ' + response.status)))
      .then(json => root.FlyingAnimalRig.normalize(json))
      .catch(error => {
        debug.lastError = String(error?.message || error);
        return root.FlyingAnimalRig.normalize(defaults);
      })
      .then(async rig => {
        const [flying, perched, wings] = await Promise.all([rig.flying, rig.perched, rig.wings].map(preloadImage));
        rigConfig = rig;
        return { rig, images: { flying, perched, wings } };
      })
      .catch(error => { debug.errors++; debug.lastError = String(error?.message || error); return null; });
    return rigPromise;
  }
  function hideNativeSprite(avatar, hidden) {
    if (!avatar) return;
    for (const key of ['frontPlane', 'backPlane', 'mesh', 'spriteMesh']) {
      const part = avatar[key];
      if (part && part.userData?.tzatzulHidden !== hidden) {
        part.visible = !hidden; part.userData.tzatzulHidden = hidden;
      }
    }
  }
  async function createRig(c, state, hatchling = false) {
    const profile = await rigReady();
    if (!profile || !c?.avatarRef?.group || c.health <= 0 || (state.rig && state.rigRoot)) return;
    const model = root.FlyingAnimalRig.create(profile.rig, profile.images);
    const frame = c.avatarRef.group;
    const scale = finite(profile.rig?.talonCarry?.birdScale, ADULT_BIRD_SCALE);
    model.root.scale.set(scale * (hatchling ? 0.375 : 1), scale * (hatchling ? .625 : 1), scale * (hatchling ? .375 : 1));
    frame.add(model.root);
    hideNativeSprite(c.avatarRef, true);
    state.rig = model;
    state.rigRoot = model.root;
    state.lastFrameArea = areaOf(c);
    model.update(sceneCamera() || { getWorldPosition: out => out.set(0, 1, 8) }, hatchling ? 'perched' : 'flap', state.animationT, false);
  }
  function ensureRig(c, state, hatchling = false) {
    if (state.rig || state.rigPending || !c?.avatarRef?.group) return;
    state.rigPending = true;
    createRig(c, state, hatchling).catch(error => {
      debug.errors++; debug.lastError = String(error?.message || error);
    }).finally(() => { state.rigPending = false; });
  }
  function carryType(target) {
    return (target.isBandit || target.isTribeHunter || target.isPorakanekiHunter ||
      target.isBarbarian || target.isNpcWalker || target === deps?.player) ? 'humanoid' : 'animal';
  }
  function saddleAnchor(target) {
    if (carryType(target) !== 'animal') return { position: { x: 0, y: 0, z: 0 } };
    const key = speciesOf(target);
    const anchor = root.HOBUNJI_ATTACHMENT_RIG_PROFILES?.creatures?.[key]?.anchors?.saddle;
    return anchor ? { position: anchor.position || { x: 0, y: 0, z: 0 }, rotation: anchor.rotation } : { position: { x: 0, y: 0, z: 0 } };
  }
  function detachCarry(state, restore = true) {
    const target = state.carried;
    if (!target) return false;
    if (state.carryVisual) {
      state.carryVisual.parent?.remove?.(state.carryVisual);
      state.carryVisual = null; // Shared materials from avatar.clone() belong to the actual target, not to this presenter.
    }
    state.carryingFrame?.parent?.remove?.(state.carryingFrame);
    state.carryingFrame = null;
    if (target._flyingCarriedBy === state.bird) {
      delete target._flyingCarriedBy;
      if (restore) {
        target.state = target._tzatzulPriorState || 'idle';
        if (target.avatarRef?.group) target.avatarRef.group.visible = true;
        if (target.groundShadow) target.groundShadow.visible = true;
      }
      delete target._tzatzulPriorState;
    }
    state.carried = null;
    debug.drops++;
    return true;
  }
  function attachCarry(state, target) {
    if (!state || !target || state.carried || target._flyingCarriedBy) return false;
    const bird = state.bird;
    if (!eligiblePrey(target, bird, target === deps?.player && escort?.bird === bird)) return false;
    state.carried = target;
    target._flyingCarriedBy = bird;
    target._tzatzulPriorState = target.state;
    target.state = 'tzatzul-carried';
    if (target.avatarRef?.group) target.avatarRef.group.visible = false;
    if (target.groundShadow) target.groundShadow.visible = false;
    if (state.rigRoot && root.THREE?.Group && target.avatarRef?.group?.clone) {
      const THREE = root.THREE;
      const frame = new THREE.Group(); // Lives on the authored talon socket inside the actual bird rig.
      const outer = new THREE.Group(); // Compensated payload frame retains its true game scale.
      const clone = target.avatarRef.group.clone(true);
      outer.add(clone);
      frame.add(outer);
      state.rigRoot.add(frame);
      root.FlyingAnimalRig.placeTalonPayload(frame, outer, rigConfig.talonCarry, carryType(target), saddleAnchor(target));
      state.carryVisual = outer;
      state.carryingFrame = frame;
    }
    state.mode = 'return';
    state.phase = 'climb';
    state.cycleT = 0;
    debug.grabs++;
    debug.lastEvent = 'Captured ' + (speciesOf(target) || (target === deps?.player ? 'voluntary player' : 'NPC'));
    return true;
  }
  function retire(state) {
    if (!state) return;
    detachCarry(state);
    state.rig?.dispose?.();
    state.rig = null; state.rigRoot = null;
    if (state.bird?.avatarRef) hideNativeSprite(state.bird.avatarRef, false);
  }
  function clearZone(zoneId) {
    const prefix = String(zoneId) + ':';
    for (const [key, state] of air) if (key.startsWith(prefix)) {
      retire(state); air.delete(key); visited.delete(key);
    }
    for (const key of visited) if (key.startsWith(prefix)) visited.delete(key);
  }
  function registerSpecies(injectedDeps) {
    const db = injectedDeps?.CREATURE_DB;
    if (!db) return false;
    const baseline = db['gar-wolf'] || db.grehlr || {};
    db[SPECIES] = {
      ...baseline, ...(db[SPECIES] || {}),
      label: 'Tzatzul', defaultSizeClass: 'large', hostile: true,
      diet: 'carnivore', flying: true,
      modelWidth: 2.0, spriteAspect: .65,
      attacks: [], // Aerial grab/transport is controlled by this state machine, not generic ground pounce.
      sprites: { idle: 'assets/creaturesprites/tzatzul_flying.png',
        run: ['assets/creaturesprites/tzatzul_flying.png','assets/creaturesprites/tzatzul_flying.png'] },
    };
    db[HATCHLING] = {
      ...baseline, ...(db[HATCHLING] || {}),
      label: 'Tzatzul Hatchling', defaultSizeClass: 'small', hostile: true,
      modelWidth: 2.0 * .375, spriteAspect: .65 * (.625 / .375),
      attacks: ['pounce'], attackTag: 'sharp', attackDamage: 8,
      sprites: { idle: 'assets/creaturesprites/tzatzul_perched.png',
        run: ['assets/creaturesprites/tzatzul_perched.png','assets/creaturesprites/tzatzul_perched.png'] },
    };
    return true;
  }
  function initWildlife(injectedDeps) {
    deps = injectedDeps;
    registerSpecies(injectedDeps);
    rigReady(); // Fire off one preload, allowing distance-streamed spawns to use it later.
    root.RuntimeFrameScheduler?.register?.('tzatzul-flight-presentation', framePresentation, {
      phase: 'pre-render', owner: 'TzatzulFlight', description: 'Airborne rigs and payloads retain full distant visibility',
    });
    return true;
  }
  function initScene(injectedDeps) { sceneDeps = injectedDeps; }
  function initPathfinding(injectedDeps) { pathDeps = injectedDeps; }
  function spawnAtSpire(zoneId, spire) {
    const key = zoneId + ':' + spire.id;
    if (air.has(key) || visited.has(key)) return null;
    const T = finite(deps?.TILE, 32);
    // Spire's nest is a true building map id; the existing den identity table
    // can resolve its exterior zone without parsing underscores.
    root.WildlifeSpawn?.denCavernMapId?.(zoneId, spire.nest.denId || spire.nest.id);
    const c = deps.makeCreatureEntity(SPECIES, spire.x * T, spire.z * T, {
      homeX: spire.x * T, homeY: spire.z * T,
      state: 'idle', streamVisuals: false,
      wildlifeRole: 'predator', tzatzulSpireId: spire.id,
    });
    if (!c) return null;
    c._tzatzulFlight = true;
    c.areaId = zoneId;
    deps.hostileObjects.add(c);
    const state = stateFor(c, spire);
    air.set(key, state);
    visited.add(key);
    ensureRig(c, state);
    debug.spawns++;
    return c;
  }
  function ensureCurrentZone() {
    if (!deps?.getCurrentArea || !deps?.makeCreatureEntity) return;
    const zoneId = deps.getCurrentArea();
    if (!deps._isZoneArea?.(zoneId)) return;
    for (const spire of root.TzatzulSpires?.forArea?.(zoneId) || []) spawnAtSpire(zoneId, spire);
  }
  function targetPosition(state) {
    const T = finite(deps?.TILE, 32);
    if (state.mode === 'intercept' && state.target) {
      const target = state.target;
      return { x: target.x, y: target.y, altitude: 2.6 };
    }
    if (state.mode === 'return') return {
      x: state.spire.nest.x * T, y: state.spire.nest.z * T,
      altitude: Math.max(5, state.spire.nest.y - state.spire.baseY + 1.1),
    };
    const orbit = state.animationT * 0.21 + (state.spire.seed % 63) * .10;
    return {
      x: (state.spire.x + Math.cos(orbit) * 7.2) * T,
      y: (state.spire.z + Math.sin(orbit) * 7.2) * T,
      altitude: BASE_FLIGHT_HEIGHT + 1.5,
    };
  }
  function updateHatchling(c, dt) {
    if (c.health <= 0) return false;
    const state = stateFor(c, { baseY: 0 });
    state.animationT += Math.max(0, finite(dt));
    ensureRig(c, state, true);
    // A single authored perched plane waddles; no manufactured run sprites.
    const offset = Math.sin(state.animationT * 11) * .035;
    const group = c.avatarRef?.group;
    if (group) {
      group.rotation.z = Math.sin(state.animationT * 7) * .075;
      if (state.rigRoot) state.rigRoot.position.y = offset;
    }
    const player = sceneDeps?.player;
    if (player && sceneDeps?.getCurrentArea?.() === areaOf(c)) {
      const dx = player.x - c.x, dy = player.y - c.y;
      const dist = Math.hypot(dx,dy);
      if (dist > (deps?.TILE || 32) * .75 && dist < (deps?.TILE || 32) * 7) {
        const step = Math.min(dist, finite(deps?.TILE,32) * .6 * Math.max(0,dt));
        c.x += dx / dist * step; c.y += dy / dist * step;
      }
      // At peck range use the feet as the local hinge (Z rotation of a
      // translated plane); the existing melee hit path remains authoritative.
      if (dist < (deps?.TILE || 32) * 1.1) state.peckT += Math.max(0,dt);
      const peck = Math.max(0, Math.sin(state.peckT * 9));
      if (state.rigRoot) {
        state.rigRoot.position.y = -0.24 * (1 - Math.cos(peck * 1.4)); // Foot-end stationary while the body tips.
        state.rigRoot.rotation.z = -peck * .72;
      }
    }
    deps?.updateCreatureMesh?.(c,dt,c.facing || 0);
    return true;
  }
  function control(c, dt) {
    if (c?._tzatzulHatchling) return updateHatchling(c,dt);
    if (!c?._tzatzulFlight || !deps) return false;
    const state = sessions.get(c);
    if (!state) return false;
    if (c.health <= 0 || deps.getCurrentArea?.() !== areaOf(c)) {
      retire(state);
      return false;
    }
    state.animationT += Math.max(0,finite(dt));
    state.scanT -= finite(dt);
    if (state.mode === 'orbit' && state.scanT <= 0) {
      state.scanT = CHECK_INTERVAL;
      const prey = findPrey(c);
      if (prey) { state.target = prey; state.mode = 'intercept'; }
    }
    if (state.mode === 'intercept' && state.target && state.target !== deps.player &&
        !eligiblePrey(state.target,c)) { state.mode = 'orbit'; state.target = null; }
    const goal = targetPosition(state);
    phaseStep(state,dt,goal,deps.TILE);
    c.x = state.x; c.y = state.y;
    c.facing = state.heading;
    const T = finite(deps.TILE,32);
    const arrived = Math.hypot(goal.x - state.x, goal.y - state.y) < T * CAPTURE_RADIUS;
    if (state.mode === 'intercept' && arrived && state.altitude <= 3.4 && state.target) {
      const got = attachCarry(state,state.target);
      if (!got) { state.mode = 'orbit'; state.target = null; }
    }
    if (state.mode === 'return' && arrived &&
        state.altitude >= goal.altitude - 2.5) {
      const carried = state.carried;
      if (carried === deps.player && escort?.bird === c) {
        root.TzatzulNestInterior?.enter?.(state.spire,sceneDeps,pathDeps);
        debug.escorts++;
        escort = null;
      } else if (carried) {
        root.TzatzulNestInterior?.deliverPrey?.(state.spire, carried);
      }
      if (carried && carried !== deps.player) {
        carried.x = state.spire.nest.x * T;
        carried.y = state.spire.nest.z * T;
      }
      detachCarry(state);
      state.target = null;
      state.mode = 'orbit'; state.phase = 'glide'; state.cycleT = 0;
    }
    if (state.carried && state.carried !== deps.player) {
      state.carried.x = c.x;
      state.carried.y = c.y;
      state.carried.vx = 0; state.carried.vy = 0;
    }
    deps.updateCreatureMesh?.(c,dt,c.facing);
    ensureRig(c,state);
    if (c.avatarRef?.group) c.avatarRef.group.position.y = state.spire.baseY + state.altitude;
    if (c.groundShadow) c.groundShadow.visible = false;
    return true; // Never hand flight-controlled creatures to the ground AI.
  }
  function framePresentation(frame) {
    debug.frames++;
    const area = deps?.getCurrentArea?.();
    if (area !== previousArea) {
      if (previousArea != null) for (const state of air.values()) if (areaOf(state.bird) !== area) detachCarry(state);
      previousArea = area;
    }
    const camera = sceneCamera();
    for (const state of air.values()) {
      const c = state.bird;
      if (areaOf(c) !== area || c.health <= 0) continue;
      const group = c.avatarRef?.group;
      if (!group) continue;
      group.visible = true; // Flight is visible at true flight distance, not ordinary wildlife LOD.
      group.position.y = state.spire.baseY + state.altitude;
      hideNativeSprite(c.avatarRef, !!state.rig);
      const pose = state.carried || state.phase === 'glide' ? 'glide' : 'flap';
      if (camera && state.rig) state.rig.update(camera, pose, state.animationT, !!state.carried);
      if (state.carried) {
        if (state.carried.avatarRef?.group) state.carried.avatarRef.group.visible = false;
        if (state.carried.groundShadow) state.carried.groundShadow.visible = false;
      }
    }
  }
  function requestPlayerLift(bird) {
    if (!deps?.player || !bird?._tzatzulFlight || bird.health <= 0 || escort) return false;
    const state = sessions.get(bird);
    if (!state || state.carried) return false;
    escort = { bird };
    state.target = deps.player; state.mode = 'intercept';
    debug.lastEvent = 'Player requested lift to ' + state.spire.nest.id;
    return true;
  }
  function promptCurrentArea() {
    if (!sceneDeps?.player || !deps?._isZoneArea?.(deps.getCurrentArea?.())) {
      if (promptOwner) root.WorldActionInputClaims?.clearClaims?.('tzatzul-escort');
      promptOwner = false; promptNest = null; return;
    }
    const T = finite(deps.TILE,32);
    let nearest = null, d2 = (T * 2.3) ** 2;
    for (const state of air.values()) {
      if (areaOf(state.bird) !== deps.getCurrentArea?.() || state.bird.health <= 0 || state.carried) continue;
      const dx = sceneDeps.player.x - state.spire.x * T, dy = sceneDeps.player.y - state.spire.z * T;
      const dist = dx * dx + dy * dy;
      if (dist < d2) { nearest = state; d2 = dist; }
    }
    if (nearest === promptNest) return;
    promptNest = nearest;
    if (nearest && !escort) {
      root.WorldActionInputClaims?.setClaims?.('tzatzul-escort',[{
        actionId: 'interact', label: 'Ask Tzatzul to carry you to its cliff nest',
        priority: 120, onPress: () => requestPlayerLift(nearest.bird),
      }]);
      promptOwner = true;
    } else {
      root.WorldActionInputClaims?.clearClaims?.('tzatzul-escort');
      promptOwner = false;
    }
  }
  function debugSnapshot() {
    return {
      ...debug, rigLoaded: !!rigConfig, active: air.size, escort: !!escort,
      birds: [...air.values()].map(s => ({
        area: areaOf(s.bird), spire: s.spire.id, phase: s.phase, mode: s.mode,
        x: Math.round(s.x), y: Math.round(s.y), altitude: Math.round(s.altitude * 100)/100,
        prey: s.carried ? speciesOf(s.carried) || 'NPC' : null, visible: !!s.bird.avatarRef?.group?.visible,
      })),
    };
  }
  return Object.freeze({
    SPECIES,HATCHLING,eligiblePrey,sizeClass,phaseStep,initWildlife,initScene,initPathfinding,
    ensureCurrentZone,control,requestPlayerLift,attachCarry,detachCarry,
    promptCurrentArea,clearZone,debugSnapshot,registerSpecies,framePresentation,
  });
});
