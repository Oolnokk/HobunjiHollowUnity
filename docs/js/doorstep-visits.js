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
  let gameDeps = null; // DoorstepVisits.init({ save }) from game.js.
  let activeVisit = null; // One visitor at a time.
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

  function nextVisit() {
    for (const provider of providers) {
      let visit = null;
      try { visit = provider.next(); }
      catch (error) { console.warn(`[doorstep-visits] ${provider.id}.next failed`, error); }
      if (visit?.key && visit?.npcId) return { ...visit, providerId: provider.id };
    }
    return null;
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

  function playerTilePosition() {
    // BanditCombat deliberately receives a read-only face target rather than
    // the private player object. It is already expressed in scene/tile world
    // coordinates (x/z), which is exactly what farmhouse door selection needs.
    const face = runtimeDeps?.getPlayerFaceTarget?.();
    const z = Number.isFinite(Number(face?.z)) ? Number(face.z) : Number(face?.y);
    if (Number.isFinite(Number(face?.x)) && Number.isFinite(z)) return { c: Number(face.x), r: z };
    const player = runtimeDeps?.player;
    const tileSize = Math.max(1e-6, Number(runtimeDeps?.TILE) || 1);
    if (!player || !Number.isFinite(player.x) || !Number.isFinite(player.y)) return null;
    return { c: player.x / tileSize, r: player.y / tileSize };
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

  function doorJustExited() {
    const candidates = exitDoorCandidates();
    if (!candidates.length) return null;
    const player = playerTilePosition();
    if (!player) return candidates[0];
    return candidates.slice().sort((a, b) => {
      const aa = a.approach || a.door, bb = b.approach || b.door;
      return Math.hypot(aa.c + 0.5 - player.c, aa.r + 0.5 - player.r)
        - Math.hypot(bb.c + 0.5 - player.c, bb.r + 0.5 - player.r);
    })[0];
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

  function cloneVisitorRoot(source, visit, spot, door) {
    const root = source?.root?.clone?.(true);
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
    const neckJoint = clonedNodeAtSamePath(source.root, root, source.neckJoint);
    const stationToolMesh = clonedNodeAtSamePath(source.root, root, source.stationToolMesh);

    // A visit is a standing social interaction, not a snapshot of whatever job
    // pose/tool/drunken lean the source walker happened to be using elsewhere.
    if (alcoholPoseGroup) {
      alcoholPoseGroup.position.set(0, 0, 0);
      alcoholPoseGroup.rotation.set(0, 0, 0);
    }
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

  function spawnVisit(visit) {
    if (!visit?.key || !visit?.npcId || !scheduleDeps?.npcWalkers) return false;
    const source = sourceWalker(visit.npcId);
    const door = doorJustExited();
    const spot = nearestWalkableSpawn(door);
    if (!source || !door || !spot) return false;
    if (!visit.tree && !(visit.treeId && source.rec?.dialogueTrees?.some(tree => tree?.id === visit.treeId))) return false;
    removeActiveVisitor('replace');
    const visual = cloneVisitorRoot(source, visit, spot, door);
    if (!visual?.root) return false;
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
  function onFarmhouseExit() {
    syncProviders();
    const visit = nextVisit();
    if (visit) spawnVisit(visit);
  }

  function currentArea() {
    return runtimeDeps?.getCurrentArea?.() || scheduleDeps?.getCurrentArea?.() || null;
  }

  function update() {
    const now = performance.now();
    const area = currentArea();
    if (area && area !== lastArea) {
      const from = lastArea;
      lastArea = area;
      if (area !== config.farmhouseExteriorArea && activeVisit) removeActiveVisitor('area-change');
      if (from === config.farmhouseInteriorArea && area === config.farmhouseExteriorArea) onFarmhouseExit();
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
    spawnVisit,
    removeActiveVisitor,
    dismissVisit,
    onFarmhouseExit,
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
        mode: IS_DIALOGUE_EDITOR ? 'dialogue-editor' : 'game',
        currentArea: currentArea(),
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
