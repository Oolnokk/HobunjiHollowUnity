// Old Man Nohuknuk: a solitary, sight-shy NPC roaming the snowy Western Slope.
// Reuses NPC scheduling/pathfinding, ordinary hand/tool animation, RangedWeapons LOS,
// the Grehlr's dive sampler, and WildlifeFoodWeb's shared snow clods.
(() => {
  'use strict';
  if (window.NohuknukWilderness) return;

  const NPC_ID = 'nohuknuk'; // Restricts all routing and behavior to this one named NPC.
  const ZONE = 'map_western_slope'; // The only snowy Slope zone currently authored in the world map.
  const OWNER = 'nohuknuk-wilderness'; // Owner key for the shared NPC schedule override.
  const DEFAULTS = Object.freeze({
    sightRadiusTiles: 9, // Mutual LOS is evaluated only inside this ground-plane radius.
    fleeDistanceTiles: 5.5, // Ordinary NPC sprint path target after first visual contact.
    fleeMaxSeconds: 4, // Ends an unreachable or lengthy run with a snow dive.
    diveSeconds: 0.5, // Matches the existing Grehlr dive's first phase.
    relocationMinTiles: 17, // Logical reappearance must be well outside nearby observers' range.
    roamMinSeconds: 5, // Activity length bounds prevent every-frame replanning.
    roamMaxSeconds: 11,
    scanIntervalSeconds: 0.24, // Four-ish LOS scans per second, rather than every render frame.
  });

  let deps = null; // Live game-owned NPC, map and combat adapters injected by game.js.
  let activeWalker = null; // The sole materialized Nohuknuk; no duplicate actor/renderer.
  let buriedVisual = null; // Child wrapper for applying the existing Grehlr dive to the entire NPC rig.
  let snowProxy = null; // World-coordinate actor adapter for WildlifeFoodWeb.emitDig.
  let refreshClock = 0; // Throttles lookup of a walker that is still being built asynchronously.
  let sightClock = 0; // Bounds expensive bidirectional geometry LOS tests.
  let lastDebugAt = 0; // Bounds DOM diagnostics to mobile-friendly update rates.
  let debugElement = null; // In-game readout for ?nohuknukDebug=1 (no console required).
  const sightProxies = new WeakMap(); // Stable pixel-coordinate actor adapters for RangedWeapons LOS caching.
  const status = {
    phase: 'roam', activity: 'wander', target: { c: 30, r: 20 },
    activityTimer: 0, travelTimer: 0, escapeTimer: 0, digTimer: 0,
    lastThreat: null, lastSight: 'unobserved', lastEvent: 'awaiting world', lastActivity: '',
    flees: 0, burrows: 0, relocations: 0, catches: 0, gathered: 0,
    huntTarget: null, forageBerry: null, pendingRestore: null, sequence: 0,
    hiddenRetrySeconds: 0, // Backoff between expensive unseen landing searches when snowfield access is blocked.
  }; // Sole persistent logical actor state; the actual mesh remains game-owned.

  function random() { return window.GameRandom?.random?.() ?? Math.random(); }
  function finite(value, fallback = 0) {
    const number = Number(value); // Bounds restored/member-owned state before it reaches transforms.
    return Number.isFinite(number) ? number : fallback;
  }
  function clamp(value, lower, upper) { return Math.max(lower, Math.min(upper, value)); }
  function distance(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
  function tileSize() { return Math.max(1, finite(deps?.TILE, 64)); }
  function area() { return deps?.getCurrentArea?.() || ''; }
  function layout() { return deps?.getZoneLayout?.(ZONE) || null; }
  function bounds() {
    const map = layout(); // Regenerated Tothal Shift dimensions take precedence over legacy zone defaults.
    const def = deps?.EXTERIOR_ZONES?.[ZONE] || {};
    const cols = Math.max(8, Math.floor(finite(map?.cols, finite(def.cols, 50))));
    const rows = Math.max(8, Math.floor(finite(map?.rows, finite(def.rows, 40))));
    return {
      minC: 2, maxC: cols - 3, minR: 2, maxR: rows - 3, cols, rows,
    }; // The entire Western Slope is available, with only the standard two-tile edge margin.
  }
  function settings() {
    const author = activeWalker?.rec?.wildernessRoaming || deps?.getNpcRecord?.(NPC_ID)?.wildernessRoaming || {};
    const result = {};
    for (const [key, value] of Object.entries(DEFAULTS)) {
      const number = Number(author[key]);
      result[key] = Number.isFinite(number) && number > 0 ? number : value;
    }
    return result; // Author values override Nohuknuk alone, never another NPC's movement defaults.
  }
  function validTile(c, r) {
    if (!Number.isInteger(c) || !Number.isInteger(r)) return false;
    const b = bounds();
    if (c < b.minC || c > b.maxC || r < b.minR || r > b.maxR) return false;
    if (!layout()?.tiles?.length) return false; // Never promise a safe teleport before terrain has actually generated.
    return window.NpcPathfinding?.isNpcTileWalkable?.(ZONE, c, r) === true;
  }
  function posOf(walker) {
    return { x: finite(walker?.root?.position?.x), z: finite(walker?.root?.position?.z) };
  }
  function randomSafeTile({ reference = null, minDistance = 0, origin = null, oldDistance = 0, tries = 100 } = {}) {
    const b = bounds(); // Every candidate uses the actual current generated zone extent.
    for (let attempt = 0; attempt < tries; attempt++) {
      const c = b.minC + Math.floor(random() * (b.maxC - b.minC + 1));
      const r = b.minR + Math.floor(random() * (b.maxR - b.minR + 1));
      const point = { c, r, x: c + 0.5, z: r + 0.5 }; // Used to compare candidate distances in tile units.
      if (reference && distance(point, reference) < minDistance) continue;
      if (origin && distance(point, origin) < oldDistance) continue;
      if (validTile(c, r)) return { c, r };
    }
    return null; // A blocked zone must not trigger an unsafe blind teleport.
  }
  function setTarget(target, activity = status.activity, seconds = null) {
    if (!target || !Number.isFinite(target.c) || !Number.isFinite(target.r)) return false;
    const changed = !status.target || status.target.c !== target.c || status.target.r !== target.r || activity !== status.activity;
    status.target = { c: Math.floor(target.c), r: Math.floor(target.r) };
    status.activity = activity;
    status.travelTimer = 0;
    if (seconds != null) status.activityTimer = Math.max(0, finite(seconds));
    if (changed) {
      status.sequence++;
      activeWalker?.resetRouteState?.(); // Reuses game.js/TilePathfinding routes instead of generating another NPC pathfinder.
    }
    return true;
  }
  function targetFor(rec) {
    if (rec?.id !== NPC_ID) return null;
    const target = status.target || { c: 30, r: 20 };
    const takingCover = status.phase === 'flee';
    const working = status.phase === 'roam' && status.activityTimer > 0;
    const stationary = working && (status.activity === 'fish' || status.activity === 'hunt') && atTarget(activeWalker, 1.6);
    return {
      area: ZONE, c: target.c, r: target.r,
      activity: takingCover ? 'taking cover' : status.phase === 'dig' || status.phase === 'hidden'
        ? 'burrowing into snow' : status.activity === 'fish' ? 'fishing' : status.activity === 'hunt'
          ? 'hunting' : status.activity === 'forage' ? 'foraging' : 'wandering',
      label: takingCover ? 'Retreating from a witness' : 'Western Slope snowfields',
      run: takingCover,
      ...(stationary ? { toolKey: 'fishingspear', toolActivity: 'fish' } : {}), // Both wild fishing and spear hunting reuse the existing timed throw pose.
    };
  }
  function atTarget(walker, radius = 0.42) {
    if (!walker?.root || !status.target) return false;
    return distance(posOf(walker), { x: status.target.c + 0.5, z: status.target.r + 0.5 }) <= radius;
  }

  function isNonCreatureNpc(walker) {
    return !!walker?.root && walker?.area === ZONE && walker?.rec?.id !== NPC_ID
      && walker.animalKind == null && walker.rec?.kind !== 'animal'
      && walker.rec?.appearance?.avatarType !== 'animal';
  }
  function isPeopleHostile(actor) {
    return !!actor && actor.areaId === ZONE && actor.health > 0 &&
      (actor.isBandit === true || actor.isTribeHunter === true || actor.isBarbarian === true ||
       actor.rosterRecord?.appearance?.speciesId && actor.avatarRef?.group && !actor.creatureKey);
  }
  function actorProxy(walker) {
    let proxy = sightProxies.get(walker);
    if (!proxy) {
      proxy = { x: 0, y: 0, health: 1, avatarGroup: walker.avatarGroup, root: walker.root, areaId: walker.area, walker };
      sightProxies.set(walker, proxy);
    }
    proxy.x = walker.root.position.x * tileSize();
    proxy.y = walker.root.position.z * tileSize();
    proxy.areaId = walker.area;
    return proxy; // RangedWeapons consumes pixel X/Y and native avatar WorldY, unlike NPC's tile-space root.
  }
  function playerPosition() {
    const p = deps?.player;
    return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x / tileSize(), z: p.y / tileSize() } : null;
  }
  function humanActors() {
    const list = []; // Reused only on a throttled perception tick, never in the render loop.
    if (area() !== ZONE) return list;
    const player = deps?.player;
    if (player?.health > 0) list.push({ actor: player, name: 'player' });
    for (const other of deps?.npcWalkers || []) {
      if (isNonCreatureNpc(other)) list.push({ actor: actorProxy(other), name: other.rec?.id || 'npc' });
    }
    for (const other of deps?.hostileObjects || []) {
      if (isPeopleHostile(other)) list.push({ actor: other, name: other.id || other.name || 'hostile' });
    }
    return list;
  }
  function mutualSight(observer, target) {
    const hasSight = window.RangedWeapons?.hasLineOfSight;
    if (typeof hasSight !== 'function') return false; // Fail closed: missing sight support must never give Nohuknuk wall vision.
    // AND is intentional: if either side's geometry/elevation ray is occluded, neither can observe the other.
    return hasSight(observer, target) === true && hasSight(target, observer) === true;
  }
  function findWitness(walker) {
    if (walker.area !== ZONE || area() !== ZONE || !walker.root) return null;
    const observer = actorProxy(walker);
    const radius = settings().sightRadiusTiles * tileSize();
    const radius2 = radius * radius;
    let candidate = null, closestD2 = radius2;
    status.lastSight = 'no visible people in range'; // Reset each scan; an earlier blocked ray must not linger as the current diagnosis.
    for (const human of humanActors()) {
      const other = human.actor;
      const dx = other.x - observer.x, dy = other.y - observer.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > closestD2) continue;
      if (!mutualSight(observer, other)) { status.lastSight = 'occluded: ' + human.name; continue; }
      closestD2 = d2;
      candidate = { name: human.name, x: other.x / tileSize(), z: other.y / tileSize(), distanceTiles: Math.sqrt(d2) / tileSize() };
    }
    status.lastSight = candidate ? 'mutual LOS: ' + candidate.name : status.lastSight.startsWith('occluded:')
      ? status.lastSight : 'no visible people in range';
    return candidate;
  }
  function escapeTarget(walker, witness) {
    const origin = posOf(walker);
    const dx = origin.x - witness.x, dz = origin.z - witness.z;
    const length = Math.max(0.001, Math.hypot(dx, dz));
    const dist = settings().fleeDistanceTiles;
    const spread = [-0.4, 0.4, -0.8, 0.8, 0, -1.1, 1.1];
    for (const skew of spread) {
      const angle = Math.atan2(dz, dx) + skew;
      const c = Math.floor(origin.x + Math.cos(angle) * dist);
      const r = Math.floor(origin.z + Math.sin(angle) * dist);
      const point = { c, r };
      if (!validTile(c, r)) continue;
      const path = window.NpcPathfinding?.findNpcPath?.(ZONE, origin.x, origin.z, c, r);
      if (path || window.NpcPathfinding?.canNpcBeeline?.(ZONE, origin.x, origin.z, c, r)) return point;
    }
    return randomSafeTile({ reference: { x: witness.x, z: witness.z }, minDistance: dist, tries: 40 })
      || { c: Math.floor(origin.x), r: Math.floor(origin.z) };
  }
  function releaseBerry() {
    if (status.forageBerry) status.forageBerry.reserved = false; // Restore the shared Grehlr/Nazgraku food reservation on all interruptions.
    status.forageBerry = null;
  }
  function beginFlight(walker, witness) {
    releaseBerry();
    status.huntTarget = null;
    status.phase = 'flee';
    status.escapeTimer = 0;
    status.lastThreat = witness.name;
    status.flees++;
    status.lastEvent = 'Spotted ' + witness.name + ' at ' + witness.distanceTiles.toFixed(1) + ' tiles — sprinting';
    setTarget(escapeTarget(walker, witness), 'escape', 0);
  }
  function beginDig(walker) {
    status.phase = 'dig';
    status.digTimer = 0;
    status.hiddenRetrySeconds = 0;
    status.burrows++;
    status.lastEvent = 'Digging into snow';
    setTarget({ c: Math.floor(walker.root.position.x), r: Math.floor(walker.root.position.z) }, 'dig', 0);
    if (snowProxy) {
      snowProxy.x = walker.root.position.x * tileSize();
      snowProxy.y = walker.root.position.z * tileSize();
      window.WildlifeFoodWeb?.emitDig?.(snowProxy, 'snow', tileSize()); // Shared snow/canvas clods and their already-running particle simulation.
    }
  }
  function conceal(walker) {
    if (buriedVisual) buriedVisual.visible = false; // Hide the original NPC body; never create a duplicate avatar.
    if (walker?.groundShadow) walker.groundShadow.visible = false; // Conceal the shadow before any positional change.
  }
  function finishDig(walker) {
    status.phase = 'hidden';
    conceal(walker);
    status.lastEvent = 'Underground: choosing an unseen distant tile';
    if (!tryRelocate(walker)) status.hiddenRetrySeconds = 1.25; // Do not repeat 200 potential pathing probes every render frame.
  }
  function tryRelocate(walker) {
    if (!walker?.root || walker.root._pendingZoneAdd === ZONE || !layout()?.tiles?.length) return false; // A deferred wilderness scene has no live walkability grid yet; do not brute-force 200 invalid landing probes.
    const old = posOf(walker);
    const player = playerPosition();
    const min = settings().relocationMinTiles;
    const humans = humanActors();
    let landing = null;
    for (let i = 0; i < 200; i++) {
      const candidate = randomSafeTile({ origin: old, oldDistance: min,
        reference: player, minDistance: player ? min : 0, tries: 1 });
      if (!candidate) continue;
      const candidatePos = { x: candidate.c + 0.5, z: candidate.r + 0.5 };
      if (humans.some(human => distance(candidatePos,
        { x: human.actor.x / tileSize(), z: human.actor.y / tileSize() }) < settings().sightRadiusTiles * 1.5)) continue;
      landing = candidate;
      break;
    }
    if (!landing) return false; // Remain as data/hidden until real safe terrain exists; never pop into a visible spot.
    const y = finite(deps.npcSurfaceY?.(ZONE, landing.c, landing.r));
    walker.root.position.set(landing.c + 0.5, y, landing.r + 0.5);
    walker._legsPrevX = walker.root.position.x;
    walker._legsPrevZ = walker.root.position.z;
    walker._deadzonePrevX = walker.root.position.x; // Discard the impossible one-frame cross-map motion hint.
    walker._deadzonePrevZ = walker.root.position.z;
    walker._moveSpeedTiles = 0;
    walker.resetRouteState?.();
    resetDigVisual();
    if (walker.groundShadow) walker.groundShadow.visible = true; // Shadow returns only after a far-away logical relocation.
    status.phase = 'roam';
    status.hiddenRetrySeconds = 0;
    status.activity = 'wander';
    status.activityTimer = 0;
    status.relocations++;
    status.lastEvent = 'Relocated unseen to (' + landing.c + ',' + landing.r + ')';
    setTarget(landing, 'wander', 0);
    return true;
  }
  function resetDigVisual() {
    if (!buriedVisual) return;
    buriedVisual.position.y = 0;
    buriedVisual.rotation.x = 0;
    buriedVisual.scale.set(1, 1, 1);
    buriedVisual.visible = true;
  }
  function updateDig(walker, dt) {
    status.digTimer += dt;
    const fraction = clamp(status.digTimer / settings().diveSeconds, 0, 1);
    const sample = window.HobunjiGrehlrBurrow?.sampleForagingDivePose?.(fraction);
    if (buriedVisual) {
      const eased = sample?.progress ?? (1 - Math.pow(1 - fraction, 3));
      buriedVisual.rotation.x = sample?.pitchRad ?? 66 * Math.PI / 180 * eased;
      buriedVisual.scale.y = sample?.scaleY ?? 1 - 0.94 * eased;
      buriedVisual.position.y = -Math.max(0.4, finite(walker.avatarHeight, 1)) * 0.38 * eased;
    }
    if (status.digTimer >= settings().diveSeconds) finishDig(walker);
  }

  function findFishSpot(walker) {
    // Share Grehlr's tilesRef-keyed water index; the rare fallback keeps standalone NPC previews functional.
    const water = window.HobunjiGrehlrForaging?.waterTilesFor?.(ZONE)
      || layout()?.tiles?.filter(t => t.type === 'river' || t.type === 'stream') || [];
    const origin = posOf(walker);
    let best = null, bestDistance = Infinity;
    for (const tile of water) {
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const c = tile.c + dc, r = tile.r + dr;
        const d = Math.hypot(origin.x - c - 0.5, origin.z - r - 0.5); // Reject more-distant banks before the expensive NPC-size collision check.
        if (d >= bestDistance || !validTile(c, r)) continue;
        bestDistance = d;
        best = { c, r };
      }
    }
    return best; // Activity uses the canonical fishing spear station animation once standing at the bank.
  }
  function chooseHunt(walker) {
    if (area() !== ZONE) return null; // Unmaterialized wildlife is not fabricated just for a distant NPC's hunt.
    const origin = posOf(walker);
    let nearest = null, best = 12;
    for (const prey of deps?.hostileObjects || []) {
      if (!prey || prey.areaId !== ZONE || prey.health <= 0 || prey.isBandit ||
          prey.isCompanion || prey._denHidden || prey._animalSleeping ||
          !['uumkaoii-wild', 'puktuk'].includes(prey.creatureKey)) continue;
      const x = prey.x / tileSize(), z = prey.y / tileSize();
      const d = Math.hypot(origin.x - x, origin.z - z);
      if (d < best) { best = d; nearest = prey; }
    }
    if (!nearest) return null;
    const c = Math.floor(nearest.x / tileSize() - 0.8), r = Math.floor(nearest.y / tileSize());
    if (!validTile(c, r)) return null;
    status.huntTarget = nearest;
    return { c, r };
  }
  function chooseForage(walker) {
    const origin = posOf(walker);
    const berry = window.WildBerries?.nearestAvailableBerry?.(ZONE, origin.x, origin.z);
    if (!berry || berry.reserved || !validTile(berry.col, berry.row) ||
        distance({ x: berry.col + 0.5, z: berry.row + 0.5 }, origin) > 15) return null;
    berry.reserved = true;
    status.forageBerry = berry;
    return { c: berry.col, r: berry.row };
  }
  function chooseActivity(walker) {
    releaseBerry();
    status.huntTarget = null;
    const choice = random(); // Weighted civilian routine: each station uses existing target pathing/pose tools.
    let activity = choice < 0.22 ? 'hunt' : choice < 0.43 ? 'fish' : choice < 0.71 ? 'forage' : 'wander';
    let target = activity === 'hunt' ? chooseHunt(walker)
      : activity === 'fish' ? findFishSpot(walker) : activity === 'forage' ? chooseForage(walker) : null;
    if (!target) {
      activity = 'wander';
      target = randomSafeTile({ reference: posOf(walker), minDistance: 3, tries: 60 });
    }
    if (!target) return;
    const config = settings();
    const duration = config.roamMinSeconds + random() * (config.roamMaxSeconds - config.roamMinSeconds);
    setTarget(target, activity, duration);
    status.lastActivity = activity;
    status.lastEvent = 'Now ' + activity + ' at (' + target.c + ',' + target.r + ')';
  }
  function completeActivity(walker) {
    if (status.activity === 'forage' && status.forageBerry) {
      window.WildBerries?.removeBerryBush?.(ZONE, status.forageBerry.col, status.forageBerry.row);
      status.gathered++;
    }
    if (status.activity === 'hunt' && status.huntTarget?.health > 0 &&
        Math.hypot(walker.root.position.x - status.huntTarget.x / tileSize(),
          walker.root.position.z - status.huntTarget.y / tileSize()) < 1.8) {
      const hunter = actorProxy(walker); // Attribute a real creature hit to this NPC, not to player damage/XP.
      const hit = deps?.damageCreature?.(status.huntTarget, 12, hunter.x, hunter.y, 0,
        { attacker: hunter, attackPower: 12 });
      if (hit !== false) status.catches++;
    }
    releaseBerry();
    status.huntTarget = null;
    chooseActivity(walker);
  }
  function updateRoaming(walker, dt) {
    if (walker.root?._pendingZoneAdd === ZONE || !layout()?.tiles?.length) return; // Defer grid/path queries until the real zone scene exists; offscreen NPCs must not bury themselves merely because its scene hasn't loaded.
    if (!validTile(Math.floor(walker.root.position.x), Math.floor(walker.root.position.z))) {
      // An unlucky Tothal Shift or an old saved position can leave this NPC inside a cliff.
      // Conceal the existing rig before moving it, including when the player is already on this map.
      status.phase = 'hidden';
      conceal(walker);
      status.lastEvent = 'Blocked snowfield spawn; searching for an unseen safe tile';
      if (!tryRelocate(walker)) status.hiddenRetrySeconds = 1.25;
      return;
    }
    if (!validTile(status.target.c, status.target.r)) { chooseActivity(walker); return; }
    status.travelTimer += dt;
    if (!status.activityTimer) { chooseActivity(walker); return; }
    if (!atTarget(walker)) {
      if (status.travelTimer > 22) chooseActivity(walker); // Unreachable destinations cannot lock a character forever.
      return;
    }
    status.activityTimer -= dt;
    if (status.activityTimer <= 0) completeActivity(walker);
  }
  function attach(walker) {
    activeWalker = walker;
    const body = walker._npcCharacterRigRoot || walker.avatarGroup;
    const THREE = window.THREE;
    if (body?.parent && THREE?.Group) {
      buriedVisual = new THREE.Group(); // Isolates dive transforms from the live NPC shoulder/foot/portrait scale.
      buriedVisual.name = 'nohuknuk_burrow_visual';
      body.parent.add(buriedVisual);
      buriedVisual.add(body);
    }
    snowProxy = { root: walker.root, x: 0, y: 0 }; // Allows WildlifeFoodWeb to emit real scene-space snow for a normal NPC walker.
    if (status.phase === 'hidden') conceal(walker); // Restore hidden state before the walker can render after loading a save.
    if (status.pendingRestore) {
      const restored = status.pendingRestore;
      status.pendingRestore = null;
      if (Number.isFinite(restored.x) && Number.isFinite(restored.z) && restored.area === ZONE) {
        walker.root.position.x = restored.x;
        walker.root.position.z = restored.z;
        walker._legsPrevX = restored.x;
        walker._legsPrevZ = restored.z;
        walker.resetRouteState?.();
      }
    }
    const original = walker.update; // Wrapping only this named NPC leaves every ordinary NPC's walking/scheduling untouched.
    walker.update = function nohulknukWalkerUpdate(dt) {
      if (deps?.getCurrentArea?.() === ZONE && status.phase === 'roam') {
        sightClock += dt;
        if (sightClock >= settings().scanIntervalSeconds) {
          sightClock = 0;
          const witness = findWitness(this);
          if (witness) beginFlight(this, witness);
        }
      }
      if (status.phase === 'roam') updateRoaming(this, dt);
      else if (status.phase === 'flee') {
        status.escapeTimer += dt;
        if (atTarget(this, 0.7) || status.escapeTimer >= settings().fleeMaxSeconds) beginDig(this);
      } else if (status.phase === 'hidden') {
        status.hiddenRetrySeconds = Math.max(0, status.hiddenRetrySeconds - Math.max(0, dt));
        if (status.hiddenRetrySeconds <= 0 && !tryRelocate(this)) status.hiddenRetrySeconds = 1.25;
      }
      const result = original.call(this, dt); // Normal NPC beeline/grid routing, run animation, tool poses, legs and hands.
      if (status.phase === 'dig') updateDig(this, dt);
      return result;
    };
    status.lastEvent = 'Attached to actual NPC walker';
  }
  function update(dt) {
    if (!deps?.npcWalkers || !Number.isFinite(dt)) return;
    refreshClock += Math.max(0, dt);
    if (refreshClock >= 0.5 || !activeWalker) {
      refreshClock = 0;
      const found = deps.npcWalkers.find(w => w?.rec?.id === NPC_ID) || null;
      if (found && found !== activeWalker) attach(found);
      if (!found && activeWalker) { activeWalker = null; buriedVisual = null; snowProxy = null; }
    }
    if (new URLSearchParams(window.location?.search || '').has('nohuknukDebug')) showDebug();
  }
  function showDebug() {
    if (!document.body || performance.now() - lastDebugAt < 500) return;
    lastDebugAt = performance.now();
    if (!debugElement) {
      debugElement = document.createElement('pre'); // Visible directly on mobile; no devtools or console needed.
      debugElement.id = 'nohuknukWildernessDebug';
      debugElement.style.cssText = 'position:fixed;top:6px;right:6px;z-index:100000;max-width:65vw;white-space:pre-wrap;background:#101827dd;color:#fff;padding:8px;font:11px/1.4 monospace;pointer-events:none;border:1px solid #cad1e0aa';
      document.body.appendChild(debugElement);
    }
    const snap = debugSnapshot();
    debugElement.textContent = 'Nohuknuk / Western Slope snowfields\n' +
      snap.phase + ' / ' + snap.activity + '\n' +
      'pos ' + snap.x + ',' + snap.z + ' -> ' + snap.target.c + ',' + snap.target.r + '\n' +
      'sight ' + snap.lastSight + '\n' + snap.lastEvent + '\n' +
      'flees ' + snap.flees + ' / burrows ' + snap.burrows + ' / relocations ' + snap.relocations;
  }
  function serialize() {
    const position = activeWalker?.root?.position || status.pendingRestore; // Preserve a saved location even before the avatar's asynchronous build finishes.
    return { version: 1, area: ZONE, x: finite(position?.x, status.target.c + 0.5),
      z: finite(position?.z, status.target.r + 0.5), hidden: status.phase === 'hidden' || status.phase === 'dig',
      activity: status.activity,
      target: { ...status.target }, flees: status.flees, burrows: status.burrows,
      relocations: status.relocations, catches: status.catches, gathered: status.gathered };
  }
  function restore(raw) {
    if (!raw || raw.version !== 1 || raw.area !== ZONE) return false;
    const target = raw.target; // Only finite owned coordinates may be restored into a generated wilderness map.
    if (Number.isInteger(target?.c) && Number.isInteger(target?.r)) status.target = { c: target.c, r: target.r };
    status.activity = ['wander', 'fish', 'forage', 'hunt'].includes(raw.activity) ? raw.activity : 'wander';
    status.activityTimer = 0; // A mid-session prey/bush reservation must never survive the reload without its live object.
    status.phase = raw.hidden === true ? 'hidden' : 'roam'; // A mid-dive save resumes concealed, never as a visible mid-map teleport.
    status.hiddenRetrySeconds = 0;
    status.flees = Math.max(0, Math.floor(finite(raw.flees)));
    status.burrows = Math.max(0, Math.floor(finite(raw.burrows)));
    status.relocations = Math.max(0, Math.floor(finite(raw.relocations)));
    status.catches = Math.max(0, Math.floor(finite(raw.catches)));
    status.gathered = Math.max(0, Math.floor(finite(raw.gathered)));
    status.pendingRestore = { area: ZONE, x: finite(raw.x, NaN), z: finite(raw.z, NaN) };
    releaseBerry();
    status.huntTarget = null;
    if (activeWalker?.root && Number.isFinite(status.pendingRestore.x) && Number.isFinite(status.pendingRestore.z)) {
      const saved = status.pendingRestore;
      activeWalker.root.position.x = saved.x;
      activeWalker.root.position.z = saved.z;
      activeWalker._legsPrevX = saved.x;
      activeWalker._legsPrevZ = saved.z;
      activeWalker.resetRouteState?.();
      status.pendingRestore = null;
    }
    resetDigVisual();
    if (status.phase === 'hidden' && activeWalker) conceal(activeWalker);
    else if (activeWalker?.groundShadow) activeWalker.groundShadow.visible = true;
    status.lastEvent = 'Restored logical snowfield position';
    return true;
  }
  function debugSnapshot() {
    return { id: NPC_ID, zone: ZONE, loaded: !!activeWalker,
      x: activeWalker ? Number(activeWalker.root.position.x.toFixed(2)) : null,
      z: activeWalker ? Number(activeWalker.root.position.z.toFixed(2)) : null,
      phase: status.phase, activity: status.activity, target: { ...status.target },
      lastSight: status.lastSight, lastThreat: status.lastThreat, lastEvent: status.lastEvent,
      flees: status.flees, burrows: status.burrows, relocations: status.relocations,
      catches: status.catches, gathered: status.gathered,
      nativeRig: !!activeWalker?.avatarGroup?.userData?.bipedalMonster,
    };
  }

  function init(injectedDeps) {
    deps = injectedDeps; // Shares the game's actor registry, NPC route graph, terrain and Combat damage callback.
    window.NpcScheduling?.registerTargetOverride?.(OWNER, targetFor); // Overrides this NPC only; ordinary schedule resolution remains authoritative for everyone else.
  }
  window.NohuknukWilderness = Object.freeze({ init, update, serialize, restore, debugSnapshot,
    DEFAULTS, __test: Object.freeze({ targetFor, findWitness, findFishSpot, chooseActivity, beginFlight, beginDig, tryRelocate, validTile, settings }) });
})();