// Shared "an NPC is waiting outside the farmhouse door" visits.
//
// Any feature that wants to tell the player something in person (a trust
// gift, a newly unlocked tutorial, ...) registers a provider here instead of
// owning its own visitor clone / door lookup / dialogue-end detection:
//
//   DoorstepVisits.registerProvider({
//     id: 'my_feature',
//     priority: 10,              // higher asks first on each farmhouse exit
//     sync() {},                 // optional; also runs once a second
//     next() {                   // null, or the visit that should appear now
//       return { key, npcId, treeId?, tree, data? };
//     },
//     onComplete(visit) {},      // natural dialogue end; return true when done
//   });
//
// On every interior -> farm transition the highest-priority provider with a
// pending visit gets one visitor, cloned from that NPC's live walker, standing
// a few tiles out from the door the player just used. Leaving with Escape /
// Leave keeps the visit pending, so the same visitor returns on the next exit.
// `tree` is ordinary Dialogue Editor data; an authored tree on the source NPC
// with id `treeId` wins over it. Text may use {{timeOfDay}} and
// {{playerHonorific}}.
//
// markDone/isDone is a small per-character-per-world flag store (saved by
// game.js's saveMemberWorldData as member.doorstepVisitState) for providers
// that have no better place to remember "already told the player this".
(function (global) {
  'use strict';

  const IS_DIALOGUE_EDITOR = String(global.location?.pathname || '').includes('/tools/dialogue-editor');
  const NATURAL_END_MARKER = '⁣'; // Invisible separator appended only to runtime visitor terminal text so Continue can be distinguished from Leave/Escape.

  const config = Object.freeze({
    farmhouseInteriorArea: 'interior',
    farmhouseExteriorArea: 'farm',
    preferredDistanceFromDoorTiles: 3,
    nearestWalkableSearchRadiusTiles: 5,
    defaultVisitorIdPrefix: 'doorstep_visit:',
  });

  let dialogueDeps = null; // DialogueContent's narrow adapters; used only for natural dialogue close integration.
  let scheduleDeps = null; // NpcScheduling adapters; authoritative live npcWalkers array.
  let runtimeDeps = null; // BanditCombat adapters; active scene/grid/player-face helpers already supplied by game.js.
  let gameDeps = null; // DoorstepVisits.init({ save, getPlayerTile }) from game.js.
  let lastSpawnAttempt = null; // Companion diagnostics retain the last attempted visit and any concrete spawn blocker.
  const spawnAttemptsByNpc = new Map(); // Preserves each visitor outcome when a later provider spawns successfully.
  let activeVisit = null; // One visitor at a time.
  let exitCount = 0; // Counts actual farmhouse exit requests in companion diagnostics.
  let lastExitAttempt = null; // Retains trigger and provider selection even when no visit reaches spawn.
  let lastArea = null;
  let lastSyncAt = 0;
  let frameHandle = 0;
  let doneFlags = {};
  const providers = [];
  const patchedApis = new WeakSet();

  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

  // ── Future-singleton hooks ────────────────────────────────────────────
  // Several features wait for the same window.Foo to be assigned. Chain an
  // existing setter rather than replacing it, otherwise the last module to
  // ask would silently disable every earlier module's integration.
  function whenApiAssigned(name, patcher) {
    const existing = global[name];
    if (existing) { patcher(existing); return; }
    const descriptor = Object.getOwnPropertyDescriptor(global, name);
    if (descriptor && descriptor.configurable === false) return;
    if (typeof descriptor?.set === 'function') {
      const upstreamSet = descriptor.set;
      Object.defineProperty(global, name, {
        configurable: true,
        enumerable: descriptor.enumerable ?? true,
        get() { return descriptor.get ? descriptor.get.call(global) : undefined; },
        set(value) {
          upstreamSet.call(global, value);
          patcher(global[name] || value);
        },
      });
      return;
    }
    let stored = descriptor?.get ? descriptor.get.call(global) : descriptor?.value;
    Object.defineProperty(global, name, {
      configurable: true,
      enumerable: descriptor?.enumerable ?? true,
      get() { return stored; },
      set(value) {
        stored = value;
        patcher(value);
        Object.defineProperty(global, name, { value: stored, writable: true, configurable: true, enumerable: true });
      },
    });
  }

  // ── Providers ─────────────────────────────────────────────────────────
  function registerProvider(provider) {
    if (!provider?.id || typeof provider.next !== 'function') return false;
    const index = providers.findIndex(entry => entry.id === provider.id);
    if (index >= 0) providers.splice(index, 1);
    providers.push(provider);
    providers.sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0));
    return true;
  }

  function syncProviders() {
    for (const provider of providers) {
      try { provider.sync?.(); }
      catch (error) { console.warn(`[doorstep-visits] ${provider.id}.sync failed`, error); }
    }
  }

  function* pendingVisits() {
    for (const provider of providers) {
      let visit = null;
      try { visit = provider.next(); }
      catch (error) {
        lastExitAttempt?.providers.push({ id: provider.id, result: 'Provider error', error: String(error?.message || error) });
        console.warn(`[doorstep-visits] ${provider.id}.next failed`, error);
        continue;
      }
      lastExitAttempt?.providers.push({ id: provider.id, result: visit?.key && visit?.npcId ? visit.key : 'No pending visit' });
      if (visit?.key && visit?.npcId) yield { ...visit, providerId: provider.id };
    }
  }

  // ── Persistent flags ──────────────────────────────────────────────────
  function isDone(key) { return !!doneFlags[key]; }
  function markDone(key) {
    if (!key || doneFlags[key]) return;
    doneFlags[key] = Date.now();
    gameDeps?.save?.();
  }
  function serialize() { return { done: { ...doneFlags } }; }
  function restore(state) { doneFlags = { ...(state?.done || {}) }; }

  // ── Door / spawn placement ────────────────────────────────────────────
  function parseTileKey(key) {
    const parts = String(key || '').split(',').map(Number);
    return parts.length === 2 && parts.every(Number.isFinite) ? { c: parts[0], r: parts[1] } : null;
  }

  function exitDoorCandidates() {
    const groups = global.HousePieces?.debugPieceFeatures?.() || [];
    const candidates = [];
    for (const group of groups) {
      for (const feature of (group.features || [])) {
        if (feature.type !== 'entrance' || feature.invalid || !feature.doorTile) continue;
        const door = parseTileKey(feature.doorTile);
        const approach = parseTileKey(feature.approachTile);
        if (!door) continue;
        const sideVector = {
          north: { dc: 0, dr: -1 }, south: { dc: 0, dr: 1 }, west: { dc: -1, dr: 0 }, east: { dc: 1, dr: 0 },
        }[feature.side];
        const direction = approach
          ? { dc: Math.sign(approach.c - door.c), dr: Math.sign(approach.r - door.r) }
          : sideVector;
        if (!direction || (!direction.dc && !direction.dr)) continue;
        candidates.push({ ...feature, pieceId: group.id, door, approach, direction });
      }
    }
    return candidates;
  }

  // Leaving the interior puts the player back where they stood to go in, so
  // the door "just exited" is the entrance HousePieces recorded on the way in.
  // Only entries that bypassed a door (legacy interior travel spots, debug
  // teleports) or a since-removed entrance fall back to proximity, measured
  // from the player's feet in tile units — the same units as door tiles.
  function doorJustExited() {
    const candidates = exitDoorCandidates();
    if (!candidates.length) return null;
    const entered = global.HousePieces?.lastEnteredEntrance?.();
    const recorded = entered && candidates.find(door => door.pieceId === entered.pieceId && door.id === entered.featureId);
    if (recorded) return recorded;
    const player = gameDeps?.getPlayerTile?.();
    if (!Number.isFinite(player?.c) || !Number.isFinite(player?.r)) return candidates[0];
    const distance = door => {
      const spot = door.approach || door.door;
      return Math.hypot(spot.c + 0.5 - player.c, spot.r + 0.5 - player.r);
    };
    return candidates.slice().sort((a, b) => distance(a) - distance(b))[0];
  }

  function occupiedByNpc(c, r) {
    return (scheduleDeps?.npcWalkers || []).some(walker => {
      if (walker === activeVisit?.proxy || walker?.area !== config.farmhouseExteriorArea || !walker?.root?.position) return false;
      return Math.hypot(walker.root.position.x - (c + 0.5), walker.root.position.z - (r + 0.5)) < 0.7;
    });
  }

  function nearestWalkableSpawn(door) {
    if (!door) return null;
    const distance = Math.max(1, Number(config.preferredDistanceFromDoorTiles) || 3);
    const desiredC = Math.round(door.door.c + door.direction.dc * distance);
    const desiredR = Math.round(door.door.r + door.direction.dr * distance);
    const radius = Math.max(0, Number(config.nearestWalkableSearchRadiusTiles) || 5);
    const candidates = [];
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        candidates.push({ c: desiredC + dc, r: desiredR + dr, d2: dc * dc + dr * dr });
      }
    }
    candidates.sort((a, b) => a.d2 - b.d2 || Math.abs(a.c - desiredC) + Math.abs(a.r - desiredR) - (Math.abs(b.c - desiredC) + Math.abs(b.r - desiredR)));
    for (const spot of candidates) {
      if (occupiedByNpc(spot.c, spot.r)) continue;
      if (global.NpcPathfinding?.isNpcTileWalkable?.(config.farmhouseExteriorArea, spot.c, spot.r)) return spot;
    }
    return null;
  }

  function farmSurfaceY(c, r) {
    try {
      const grid = runtimeDeps?.getActiveGrid?.();
      const tile = grid?.[r]?.[c];
      if (tile && runtimeDeps?.tileSurfaceYInArea) return Number(runtimeDeps.tileSurfaceYInArea(tile, config.farmhouseExteriorArea)) || 0;
    } catch (_) {}
    return 0;
  }

  // ── Visitor proxy ─────────────────────────────────────────────────────
  function sourceWalker(npcId) {
    return (scheduleDeps?.npcWalkers || []).find(walker => !walker?._doorstepVisitor && walker?.rec?.id === npcId) || null;
  }

  function markNaturalTerminalText(tree) {
    const nodeMap = new Map((tree?.nodes || []).map(node => [node.id, node]));
    for (const node of (tree?.nodes || [])) {
      if (node?.type !== 'text') continue;
      const nextNode = node.next ? nodeMap.get(node.next) : null;
      const naturallyCloses = !node.next || nextNode?.type === 'end';
      if (!naturallyCloses) continue;
      const text = String(node.text ?? '');
      if (!text.includes(NATURAL_END_MARKER)) node.text = `${text}${NATURAL_END_MARKER}`;
    }
  }

  function visitorTree(source, visit) {
    const authored = (visit.treeId && source?.rec?.dialogueTrees?.find(tree => tree?.id === visit.treeId)) || visit.tree;
    const tree = clone(authored);
    tree.trigger = 'interact';
    tree.priority = 100000;
    // Visit eligibility/queueing is owned by the provider; stripping ordinary
    // conditions here prevents weather/station/etc. from suppressing a visitor
    // who has already physically appeared at the farmhouse door.
    tree.conditions = { weekdays: [], seasons: [], weather: [], timesOfDay: [], encounter: [], maps: [], stations: [], playerSpecies: [], relationship: { min: null, max: null } };
    tree.excludeConditions = clone(tree.conditions);
    tree.doorstepVisitKey = visit.key;
    // Greeting-friendly tokens resolved from the same live player/world data
    // used by the ordinary dialogue system.
    const phase = dialogueDeps?.fishingTimeOfDay?.();
    const timeOfDay = ({ dawn: 'morning', day: 'day', dusk: 'evening', night: 'evening' })[phase] || 'day';
    const playerGender = dialogueDeps?.getPlayerData?.()?.appearance?.gender || 'male';
    const playerHonorific = playerGender === 'female' ? 'Miss' : 'Master';
    for (const node of (tree.nodes || [])) {
      if (node?.type !== 'text') continue;
      node.text = String(node.text ?? '')
        .replace(/\{\{timeOfDay\}\}/g, timeOfDay)
        .replace(/\{\{playerHonorific\}\}/g, playerHonorific);
    }
    markNaturalTerminalText(tree);
    return tree;
  }

  function clonedNodeAtSamePath(sourceRoot, clonedRoot, sourceNode) {
    if (!sourceRoot || !clonedRoot || !sourceNode) return null;
    if (sourceNode === sourceRoot) return clonedRoot;
    const indices = [];
    let cursor = sourceNode;
    while (cursor && cursor !== sourceRoot) {
      const parent = cursor.parent;
      const index = parent?.children?.indexOf?.(cursor) ?? -1;
      if (!parent || index < 0) return null;
      indices.unshift(index);
      cursor = parent;
    }
    if (cursor !== sourceRoot) return null;
    let cloned = clonedRoot;
    for (const index of indices) cloned = cloned?.children?.[index] || null;
    return cloned || null;
  }

  function copyVisitorMetadata(value, copies, seen) {
    if (!value || typeof value !== 'object') return value;
    if (copies.has(value)) return copies.get(value);
    if (value.isObject3D) return null; // External scene objects do not belong to this visitor.
    if (seen.has(value)) return seen.get(value);
    const prototype = Object.getPrototypeOf(value); // Textures, canvases and other resource instances stay shared, without calling toJSON.
    if (!Array.isArray(value) && prototype !== null && prototype.constructor?.name !== 'Object') return value;
    const result = Array.isArray(value) ? [] : {}; // Plain passive metadata gets its own cycle-safe container.
    seen.set(value, result);
    for (const key of Object.keys(value)) {
      // The stationary clone keeps the hand meshes, but never the live driver's
      // callbacks: they close over the original NPC's rig and disposal state.
      if (key === 'proceduralHandRig') continue;
      result[key] = copyVisitorMetadata(value[key], copies, seen);
    }
    return result;
  }

  function cloneVisitorHierarchy(sourceRoot) {
    if (!sourceRoot?.clone) return null;
    const copies = new Map(); // Remaps every mesh/bone/rig reference into the visitor's own hierarchy.
    const skeletons = []; // Tracks only visitor-owned skeletons for disposal when the clone leaves.
    function copyNode(sourceNode) {
      // Object3D.copy JSON-serializes userData. A non-mutating view bypasses
      // that step, including the hand rig's avatarRoot -> userData -> rig loop.
      const cloneSource = Object.create(sourceNode, { userData: { value: {} }, children: { value: [] } }); // Leaves the live NPC untouched even if cloning throws.
      const copied = sourceNode.clone.call(cloneSource, false); // Empty children also handles r128 SkinnedMesh.copy ignoring the recursive flag.
      copies.set(sourceNode, copied);
      for (const child of sourceNode.children || []) copied.add(copyNode(child));
      return copied;
    }
    const root = copyNode(sourceRoot); // First build all nodes so forward rig references can be remapped.
    for (const [sourceNode, copied] of [...copies]) {
      if (!sourceNode.isSkinnedMesh || !sourceNode.skeleton) continue;
      let skeleton = copies.get(sourceNode.skeleton); // Multiple meshes may share one skeleton inside this visitor.
      if (!skeleton) {
        skeleton = sourceNode.skeleton.clone();
        skeleton.bones = sourceNode.skeleton.bones.map(bone => {
          const copiedBone = copies.get(bone); // Visitors must not animate or reset the source NPC's bones.
          if (!copiedBone) throw new Error('Visitor skeleton bone is outside the NPC hierarchy.');
          return copiedBone;
        });
        copies.set(sourceNode.skeleton, skeleton);
        skeletons.push(skeleton);
      }
      copied.skeleton = skeleton;
    }
    const seen = new WeakMap(); // Preserves shared passive metadata references without recursing through Three.js serialization.
    for (const [sourceNode, copied] of copies) {
      if (sourceNode.isObject3D || sourceNode === sourceRoot || sourceNode.children) copied.userData = copyVisitorMetadata(sourceNode.userData || {}, copies, seen);
    }
    root._doorstepSkeletons = skeletons;
    return root;
  }

  function cloneVisitorRoot(source, visit, spot, door) {
    const root = cloneVisitorHierarchy(source?.root);
    if (!root) return null;
    root.name = `doorstepVisitor_${visit.npcId}`;
    root.visible = true;
    root.userData = { ...(root.userData || {}), doorstepVisitor: true, doorstepVisitKey: visit.key };
    root.position.set(spot.c + 0.5, farmSurfaceY(spot.c, spot.r), spot.r + 0.5);
    const dx = door.door.c + 0.5 - root.position.x;
    const dz = door.door.r + 0.5 - root.position.z;
    root.rotation.y = Math.atan2(dx, dz);

    // Always attach the visitor to the player's active FARM scene. Reusing the
    // source NPC's parent is wrong whenever that NPC is currently in town or
    // a building; the clone would exist, but in a scene the player cannot see.
    const parent = runtimeDeps?.getActiveScene?.()
      || (source.area === config.farmhouseExteriorArea ? source.root.parent : null);
    if (!parent?.add) return null;
    parent.add(root);
    root._npcScene = parent;
    root._pendingTownAdd = false;
    root._pendingBuildingAdd = null;
    root._pendingZoneAdd = null;

    const avatarGroup = clonedNodeAtSamePath(source.root, root, source.avatarGroup);
    const groundShadow = clonedNodeAtSamePath(source.root, root, source.groundShadow);
    const alcoholPoseGroup = clonedNodeAtSamePath(source.root, root, source.alcoholPoseGroup);
    const runLeanPivot = clonedNodeAtSamePath(source.root, root, source._npcRunLeanPivot); // Cloned from a runner, this visual transform must reset to a standing visitor pose.
    const neckJoint = clonedNodeAtSamePath(source.root, root, source.neckJoint);
    const stationToolMesh = clonedNodeAtSamePath(source.root, root, source.stationToolMesh);

    // A visit is a standing social interaction, not a snapshot of whatever job
    // pose/tool/drunken lean the source walker happened to be using elsewhere.
    if (alcoholPoseGroup) {
      alcoholPoseGroup.position.set(0, 0, 0);
      alcoholPoseGroup.rotation.set(0, 0, 0);
    }
    runLeanPivot?.quaternion?.identity?.();
    if (neckJoint) neckJoint.rotation.set(0, 0, 0);
    stationToolMesh?.parent?.remove?.(stationToolMesh);

    return { root, avatarGroup, groundShadow, alcoholPoseGroup, neckJoint };
  }

  function visitorRecord(source, visit) {
    return {
      ...clone(source.rec || {}),
      id: `${visit.visitorIdPrefix || config.defaultVisitorIdPrefix}${visit.npcId}`,
      sourceNpcId: visit.npcId,
      relationship: false,
      dialogueTrees: [visitorTree(source, visit)],
      schedule: [],
      schedules: [],
      scheduleHooks: {},
      doorstepVisitKey: visit.key,
    };
  }

  function sourceDiagnostics(npcId) {
    const walker = sourceWalker(npcId); // Checks the exact source lookup used to clone visitors.
    return {
      ...gameDeps?.getNpcSpawnDiagnostics?.(npcId),
      npcId,
      schedulingReady: !!scheduleDeps?.npcWalkers,
      walkerCount: scheduleDeps?.npcWalkers?.length || 0,
      sourceAvailable: !!walker,
      sourceArea: walker?.area || null,
      rootAvailable: !!walker?.root,
      rootCloneAvailable: typeof walker?.root?.clone === 'function',
      lastAttempt: spawnAttemptsByNpc.has(npcId) ? clone(spawnAttemptsByNpc.get(npcId)) : null,
    };
  }

  function recordSpawnAttempt(visit, reason) {
    lastSpawnAttempt = { key: visit?.key || null, npcId: visit?.npcId || null, reason };
    if (visit?.npcId) spawnAttemptsByNpc.set(visit.npcId, { ...lastSpawnAttempt });
  }

  function rejectSpawn(visit, reason) {
    recordSpawnAttempt(visit, reason);
    return false;
  }

  function spawnVisit(visit) {
    if (!visit?.key || !visit?.npcId) return rejectSpawn(visit, 'Visit key or NPC id is missing.');
    if (!scheduleDeps?.npcWalkers) return rejectSpawn(visit, 'NPC scheduling is not initialized.');
    const source = sourceWalker(visit.npcId);
    const door = doorJustExited();
    const spot = nearestWalkableSpawn(door);
    if (!source) return rejectSpawn(visit, 'Source NPC is unavailable.');
    if (!door) return rejectSpawn(visit, 'No valid farmhouse entrance was found.');
    if (!spot) return rejectSpawn(visit, 'No unoccupied walkable tile was found near the farmhouse door.');
    if (!visit.tree && !(visit.treeId && source.rec?.dialogueTrees?.some(tree => tree?.id === visit.treeId))) return rejectSpawn(visit, 'Visit dialogue is missing.');
    removeActiveVisitor('replace');
    const visual = cloneVisitorRoot(source, visit, spot, door);
    if (!visual?.root) return rejectSpawn(visit, 'Could not clone the NPC into the active farm scene.');
    const rec = visitorRecord(source, visit);
    const proxy = {
      root: visual.root,
      rec,
      profile: source.profile,
      avatarGroup: visual.avatarGroup || visual.root,
      avatarHeight: source.avatarHeight,
      alcoholPoseGroup: visual.alcoholPoseGroup,
      groundShadow: visual.groundShadow,
      neckJoint: visual.neckJoint,
      avatarFrontCanvas: source.avatarFrontCanvas,
      avatarBackCanvas: source.avatarBackCanvas,
      area: config.farmhouseExteriorArea,
      state: 'idle',
      currentScheduleTarget: null,
      targetX: visual.root.position.x,
      targetY: visual.root.position.z,
      rot: visual.root.rotation.y,
      pause: 0,
      catchup: 1,
      legs: null,
      stationToolMesh: null,
      stationToolKey: null,
      _doorstepVisitor: true,
      _doorstepVisitKey: visit.key,
      update() {}, // The visitor is deliberately stationary and never enters the normal schedule resolver.
      dispose() { visual.root.parent?.remove?.(visual.root); },
    };
    scheduleDeps.npcWalkers.push(proxy);
    recordSpawnAttempt(visit, 'Spawned successfully.');
    activeVisit = {
      visit, source, proxy, root: visual.root, door, spot,
      dialogueStarted: false,
      naturalEndArmed: false,
      completed: false,
    };
    global.__farmLog?.(`[doorstep-visits] spawned ${visit.npcId} (${visit.providerId || 'direct'}:${visit.key}) near farmhouse door`, 'npc');
    return true;
  }

  function removeActiveVisitor(reason = 'cleanup') {
    const current = activeVisit;
    if (!current) return;
    const walkers = scheduleDeps?.npcWalkers;
    if (Array.isArray(walkers)) {
      const index = walkers.indexOf(current.proxy);
      if (index >= 0) walkers.splice(index, 1);
    }
    current.root?.parent?.remove?.(current.root);
    for (const skeleton of current.root?._doorstepSkeletons || []) skeleton.dispose?.(); // Releases clone-owned bone textures; shared materials/geometry stay live.
    current.root?.traverse?.(node => {
      // Cloned visitor meshes share the source NPC's materials/textures; do not
      // dispose shared GPU resources here. Removing the clone is sufficient.
      node.userData && (node.userData.doorstepVisitorRemoved = true);
    });
    activeVisit = null;
    global.__farmLog?.(`[doorstep-visits] visitor removed (${reason})`, 'npc');
  }

  // Lets a provider that completed a visit through another path (debug, a
  // direct API call) send the matching visitor home.
  function dismissVisit(key, reason = 'completed') {
    if (!activeVisit || activeVisit.visit.key !== key || activeVisit.completed) return false;
    activeVisit.completed = true;
    setTimeout(() => { if (activeVisit?.visit?.key === key) removeActiveVisitor(reason); }, 250);
    return true;
  }

  function completeActiveVisit(current) {
    const provider = providers.find(entry => entry.id === current.visit.providerId);
    let done = false;
    try { done = !!provider?.onComplete?.(current.visit); }
    catch (error) { console.warn(`[doorstep-visits] ${current.visit.providerId}.onComplete failed`, error); }
    // A provider that could not commit (e.g. a gift grant failed) leaves the
    // visitor standing so the conversation can be retried.
    if (done) dismissVisit(current.visit.key, 'completed');
    document.dispatchEvent(new CustomEvent('hobunji-doorstep-visit-complete', {
      detail: { key: current.visit.key, npcId: current.visit.npcId, providerId: current.visit.providerId, done },
    }));
  }

  // ── Area watch ────────────────────────────────────────────────────────
  function onFarmhouseExit(trigger = 'direct') {
    exitCount++;
    lastExitAttempt = { trigger, area: currentArea(), result: 'Checking providers', providers: [] };
    syncProviders();
    // Failed visitors stay pending while later providers get their turn.
    for (const visit of pendingVisits()) { // Requests candidates lazily in priority order.
      try {
        if (spawnVisit(visit)) {
          lastExitAttempt.result = `Spawned ${visit.npcId}`;
          return true;
        }
      } catch (error) {
        rejectSpawn(visit, `Spawn error: ${String(error?.message || error)}`);
      }
    }
    lastExitAttempt.result = lastExitAttempt.providers.some(entry => entry.result !== 'No pending visit')
      ? 'No visitor could spawn; see provider results and last spawn attempt'
      : 'No pending visits';
    return false;
  }

  function onAreaTransition(from, to, trigger = 'scene-transition') {
    if (!to || from === to) return false;
    lastArea = to; // Prevents the timer from repeating an exit already delivered by the game.
    if (to !== config.farmhouseExteriorArea && activeVisit) removeActiveVisitor('area-change');
    if (from === config.farmhouseInteriorArea && to === config.farmhouseExteriorArea) return onFarmhouseExit(trigger);
    return false;
  }

  function currentArea() {
    return runtimeDeps?.getCurrentArea?.() || scheduleDeps?.getCurrentArea?.() || null;
  }

  function update() {
    const now = performance.now();
    const area = currentArea();
    if (area && area !== lastArea) {
      onAreaTransition(lastArea, area, 'area-watch');
    }
    if (now - lastSyncAt > 1000) {
      lastSyncAt = now;
      syncProviders();
    }
  }

  // ── Dialogue / runtime integration ────────────────────────────────────
  function patchDialogueContent(api) {
    if (!api || patchedApis.has(api)) return;
    patchedApis.add(api);
    const originalInit = api.init?.bind(api);
    if (originalInit) api.init = function doorstepDialogueInit(injectedDeps) {
      dialogueDeps = injectedDeps;
      const close = injectedDeps?.closeNpcDialogue;
      if (typeof close === 'function' && !close.__doorstepNaturalClose) {
        const wrappedClose = function doorstepNaturalDialogueClose(...args) {
          const current = activeVisit;
          const shouldComplete = !!current?.dialogueStarted && !!current?.naturalEndArmed && !current?.completed;
          const result = close.apply(this, args);
          if (current) current.naturalEndArmed = false;
          if (shouldComplete) completeActiveVisit(current);
          return result;
        };
        wrappedClose.__doorstepNaturalClose = true;
        injectedDeps.closeNpcDialogue = wrappedClose;
      }
      const result = originalInit(injectedDeps);
      syncProviders();
      return result;
    };
    const originalBegin = api.beginNpcConversation?.bind(api);
    if (originalBegin) api.beginNpcConversation = function doorstepBeginConversation(rec, ...rest) {
      if (activeVisit && rec?.doorstepVisitKey === activeVisit.visit.key) {
        activeVisit.dialogueStarted = true;
        activeVisit.naturalEndArmed = false;
      }
      return originalBegin(rec, ...rest);
    };
    const originalAdvance = api.advanceNpcDialogue?.bind(api);
    if (originalAdvance) api.advanceNpcDialogue = function doorstepAdvanceConversation(...args) {
      if (activeVisit?.dialogueStarted && !activeVisit?.completed) {
        // The invisible marker exists only after a terminal line has fully
        // revealed. Clicking Continue while the typewriter is still running
        // therefore merely reveals the line; only the following Continue
        // arms completion. Leave/Escape never calls this wrapper at all.
        const visibleText = document.getElementById('npcDialogueText')?.textContent || '';
        activeVisit.naturalEndArmed = visibleText.includes(NATURAL_END_MARKER);
      }
      return originalAdvance(...args);
    };
  }

  function patchNpcScheduling(api) {
    if (!api || patchedApis.has(api)) return;
    patchedApis.add(api);
    const originalInit = api.init?.bind(api);
    if (originalInit) api.init = function doorstepNpcSchedulingInit(injectedDeps) {
      scheduleDeps = injectedDeps;
      const result = originalInit(injectedDeps);
      syncProviders();
      return result;
    };
  }

  function patchBanditCombat(api) {
    if (!api || patchedApis.has(api)) return;
    patchedApis.add(api);
    const originalInit = api.init?.bind(api);
    if (originalInit) api.init = function doorstepBanditInit(injectedDeps) {
      runtimeDeps = injectedDeps;
      return originalInit(injectedDeps);
    };
  }

  global.DoorstepVisits = Object.freeze({
    config,
    NATURAL_END_MARKER,
    init(deps) { gameDeps = deps || null; },
    whenApiAssigned,
    registerProvider,
    sourceWalker,
    sourceDiagnostics,
    spawnVisit,
    removeActiveVisitor,
    dismissVisit,
    onFarmhouseExit,
    onAreaTransition,
    isDone,
    markDone,
    serialize,
    restore,
    getScheduleDeps: () => scheduleDeps,
    getDialogueDeps: () => dialogueDeps,
    getRuntimeDeps: () => runtimeDeps,
    exitDoorCandidates,
    activeVisitKey: () => activeVisit?.visit?.key || null,
    debugSnapshot() {
      return {
        exitCount,
        lastObservedArea: lastArea,
        lastExitAttempt: clone(lastExitAttempt),
        lastSpawnAttempt: lastSpawnAttempt ? { ...lastSpawnAttempt } : null,
        mode: IS_DIALOGUE_EDITOR ? 'dialogue-editor' : 'game',
        currentArea: currentArea(),
        schedulingReady: !!scheduleDeps?.npcWalkers,
        providers: providers.map(provider => provider.id),
        activeVisitKey: activeVisit?.visit?.key || null,
        activeProviderId: activeVisit?.visit?.providerId || null,
        activeNpcId: activeVisit?.visit?.npcId || null,
        activeDialogueStarted: !!activeVisit?.dialogueStarted,
        activeNaturalEndArmed: !!activeVisit?.naturalEndArmed,
        activeSpawn: activeVisit?.spot ? { ...activeVisit.spot } : null,
        done: { ...doneFlags },
      };
    },
  });

  if (!IS_DIALOGUE_EDITOR) {
    whenApiAssigned('DialogueContent', patchDialogueContent);
    whenApiAssigned('NpcScheduling', patchNpcScheduling);
    whenApiAssigned('BanditCombat', patchBanditCombat);
    frameHandle = global.setInterval(update, 100); // Only does substantive work on an area change or once the 1000ms sync throttle elapses; no per-frame cadence needed.
  }
})(window);
