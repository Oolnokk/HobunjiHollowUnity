// Friendship-gated farmhouse visitors that gift/unlock weapon shapes.
// All content/tuning lives in config/weapon-trust-visits.js; this file owns
// only reusable queue, visitor-proxy, grant, persistence, and integration logic.
(function (global) {
  'use strict';

  const cfg = global.WEAPON_TRUST_VISIT_CONFIG;
  if (!cfg) {
    console.warn('[weapon-trust-visits] config missing; system disabled');
    return;
  }

  const IS_DIALOGUE_EDITOR = String(global.location?.pathname || '').includes('/tools/dialogue-editor');
  const NATURAL_END_MARKER = '\u2063'; // Invisible separator appended only to runtime visitor terminal text so Continue can be distinguished from Leave/Escape.

  let dialogueDeps = null; // DialogueContent's narrow adapters; used only for natural dialogue close integration.
  let scheduleDeps = null; // NpcScheduling adapters; authoritative live npcWalkers array.
  let craftDeps = null; // MetalCraftShop adapters; authoritative gear/smithing/save functions.
  let runtimeDeps = null; // BanditCombat adapters; active scene/grid/player-face helpers already supplied by game.js.
  let allSmithShapeKeys = null; // Original bronzeworks shape order before friendship gating removes entries.
  let activeVisit = null; // One visitor proxy at a time, exactly as requested.
  let lastArea = null;
  let lastSyncAt = 0;
  let frameHandle = 0;
  let editorObserver = null;
  const patchedApis = new WeakSet();
  const banditPoolProxies = new WeakSet();

  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const giftByShape = new Map((cfg.gifts || []).map(gift => [gift.shapeKey, gift]));
  const gatedShapeKeys = new Set((cfg.gifts || []).map(gift => gift.shapeKey));
  const banditShapeKeys = new Set(cfg.bandits?.weaponShapePool || []);

  function requiredHearts(gift) {
    return Math.max(0, Number(gift?.requiredHearts ?? cfg.relationship?.requiredHearts) || 0);
  }

  function completionMemoryEvent(gift) {
    return `${cfg.visitor?.completionMemoryPrefix || 'weapon_trust_gift:'}${gift.id}`;
  }

  function originalNpcState(gift) {
    return global.DialogueContent?.getNpcDlgState?.(gift?.npcId) || null;
  }

  function giftCompleted(gift) {
    // Check the durable owned-tool flag first (see giveGiftItem) — it's an
    // idempotent boolean in gearInventory.tools that never gets evicted.
    // The NPC memory event below is a FIFO-capped log (50 entries/NPC,
    // see DialogueContent.recordNpcMemory) that ordinary continued talking/
    // gifting with this same NPC can push the completion entry out of, so
    // it can't be the sole source of truth without an already-earned
    // weapon shape silently re-locking itself.
    const itemKey = gift && craftDeps?.craftedToolItemKey?.(gift.shapeKey, gift.giftMetalKey);
    const gear = itemKey ? craftDeps?.getGearInventory?.() : null;
    if (gear?.tools?.[itemKey]) return true;
    const state = originalNpcState(gift);
    const event = completionMemoryEvent(gift);
    return !!state?.memory?.some?.(entry => entry?.event === event);
  }

  function giftEligible(gift) {
    if (!gift || giftCompleted(gift)) return false;
    const favor = Number(originalNpcState(gift)?.favor) || 0;
    return favor >= requiredHearts(gift);
  }

  function pendingGifts() {
    // Config order is intentional queue order. The first eligible incomplete
    // entry remains first until its natural dialogue end records completion.
    return (cfg.gifts || []).filter(giftEligible);
  }

  function emptyTrustConditions(gift, requireRelationship = true) {
    return {
      weekdays: [], seasons: [], weather: [], timesOfDay: [], encounter: [], maps: [], stations: [], playerSpecies: [],
      relationship: { min: requireRelationship ? requiredHearts(gift) : null, max: null },
    };
  }

  function dialogueTreeFromGift(gift) {
    // Simple visits can remain a line list. Visits that need choices, sequences,
    // or custom node topology may instead provide an ordinary Dialogue Editor
    // tree under gift.dialogueTree; the runtime adds only trust-event metadata.
    if (gift?.dialogueTree && Array.isArray(gift.dialogueTree.nodes)) {
      const tree = clone(gift.dialogueTree);
      const required = emptyTrustConditions(gift, true);
      const excluded = emptyTrustConditions(gift, false);
      tree.id = gift.dialogueTreeId;
      tree.label = gift.dialogueLabel || tree.label || `Trust Gift — ${gift.shapeKey}`;
      tree.trigger = 'weaponTrustVisit';
      tree.priority = Number.isFinite(Number(tree.priority)) ? Number(tree.priority) : 99;
      tree.visibility = tree.visibility || 'any';
      tree.conditions = {
        ...required,
        ...(tree.conditions || {}),
        relationship: { ...required.relationship, ...(tree.conditions?.relationship || {}) },
      };
      tree.excludeConditions = {
        ...excluded,
        ...(tree.excludeConditions || {}),
        relationship: { ...excluded.relationship, ...(tree.excludeConditions?.relationship || {}) },
      };
      tree.entryNode = tree.entryNode || tree.nodes[0]?.id || null;
      tree.weaponTrustGiftId = gift.id;
      tree.generatedFromWeaponTrustVisitConfig = true;
      return tree;
    }

    const lines = Array.isArray(gift.dialogueLines) && gift.dialogueLines.length
      ? gift.dialogueLines
      : ['I trust you enough that I wanted you to have this.'];
    const nodes = lines.map((text, index) => ({
      id: `${gift.dialogueTreeId}_line_${index + 1}`,
      type: 'text',
      text,
      expression: index === 0 ? 'neutral' : 'smile',
      expressionHold: 2,
      revealSpeed: 'normal',
      next: index + 1 < lines.length ? `${gift.dialogueTreeId}_line_${index + 2}` : null,
      tags: [{ type: 'weapon_trust_gift' }],
    }));
    return {
      id: gift.dialogueTreeId,
      label: gift.dialogueLabel || `Trust Gift — ${gift.shapeKey}`,
      // Runtime visitor proxies convert this to interact. Keeping a distinct
      // authored trigger makes these trees easy to find/audit in Dialogue Editor.
      trigger: 'weaponTrustVisit',
      priority: 99,
      visibility: 'any',
      conditions: emptyTrustConditions(gift, true),
      excludeConditions: emptyTrustConditions(gift, false),
      entryNode: nodes[0]?.id || null,
      nodes,
      weaponTrustGiftId: gift.id,
      generatedFromWeaponTrustVisitConfig: true,
    };
  }

  function mergeDialogueTreesIntoDatabase(database) {
    if (!database?.npcs) return database;
    for (const gift of (cfg.gifts || [])) {
      const npc = database.npcs.find(record => record?.id === gift.npcId);
      if (!npc) continue;
      if (!Array.isArray(npc.dialogueTrees)) npc.dialogueTrees = [];
      if (!npc.dialogueTrees.some(tree => tree?.id === gift.dialogueTreeId)) {
        npc.dialogueTrees.push(dialogueTreeFromGift(gift));
      }
    }
    return database;
  }

  function ensureDialogueTreesOnWalkers() {
    const walkers = scheduleDeps?.npcWalkers || [];
    for (const gift of (cfg.gifts || [])) {
      const source = walkers.find(walker => !walker?._weaponTrustVisitor && walker?.rec?.id === gift.npcId);
      const rec = source?.rec;
      if (!rec) continue;
      if (!Array.isArray(rec.dialogueTrees)) rec.dialogueTrees = [];
      // A tree authored/exported from the Dialogue Editor wins over the
      // config-generated fallback by ID; never overwrite authored content.
      if (!rec.dialogueTrees.some(tree => tree?.id === gift.dialogueTreeId)) rec.dialogueTrees.push(dialogueTreeFromGift(gift));
    }
  }

  function removeStarterGiftItems(playerData) {
    const remove = cfg.onboarding?.removeStarterItemKeys || [];
    const gear = playerData?.gearInventory || playerData?.gear || null;
    if (!gear || !remove.length) return false;
    let changed = false;
    if (gear.tools) {
      for (const itemKey of remove) {
        if (!Object.prototype.hasOwnProperty.call(gear.tools, itemKey)) continue;
        delete gear.tools[itemKey];
        changed = true;
      }
    }
    const slots = gear.equipmentSlots || playerData?.equipmentSlots || null;
    if (slots) {
      for (const [slot, itemKey] of Object.entries(slots)) {
        if (!remove.includes(itemKey)) continue;
        slots[slot] = null;
        changed = true;
      }
    }
    return changed;
  }

  function readSaveMeta() {
    try { return JSON.parse(global.localStorage?.getItem('hobunjiSaveMeta') || 'null'); }
    catch (_) { return null; }
  }

  function isFreshlyCreatedCharacter(playerData) {
    // isNewWorld alone is insufficient: an old character can create a new
    // world and must keep gear that travels with that character. The new-
    // character path creates its character and first world together, so
    // their persisted creation timestamps are effectively identical.
    if (!playerData?.characterId || !playerData?.worldId || playerData?.isNewWorld !== true) return false;
    const meta = readSaveMeta();
    const character = meta?.characters?.find?.(entry => entry?.id === playerData.characterId);
    const world = meta?.worlds?.find?.(entry => entry?.id === playerData.worldId);
    const characterCreatedAt = Number(character?.createdAt);
    const worldCreatedAt = Number(world?.createdAt);
    const toleranceMs = Math.max(0, Number(cfg.onboarding?.newCharacterCreationToleranceMs) || 5000);
    return Number.isFinite(characterCreatedAt)
      && Number.isFinite(worldCreatedAt)
      && Math.abs(characterCreatedAt - worldCreatedAt) <= toleranceMs;
  }

  function removeStarterGiftItemsFromNewCharacter(playerData) {
    if (!isFreshlyCreatedCharacter(playerData)) return false;
    const changedLive = removeStarterGiftItems(playerData);
    const meta = readSaveMeta();
    const character = meta?.characters?.find?.(entry => entry?.id === playerData.characterId);
    const changedPersisted = removeStarterGiftItems(character ? { gearInventory: character.gearInventory } : null);
    if (changedPersisted && meta) {
      try { global.localStorage?.setItem('hobunjiSaveMeta', JSON.stringify(meta)); }
      catch (_) {}
    }
    return changedLive || changedPersisted;
  }

  function syncSmithingShapeUnlocks() {
    if (!craftDeps?.UNLOCKED_TOOL_SHAPES) return;
    if (!allSmithShapeKeys) allSmithShapeKeys = [...craftDeps.UNLOCKED_TOOL_SHAPES];
    const available = allSmithShapeKeys.filter(shapeKey => {
      if (!gatedShapeKeys.has(shapeKey)) return true;
      const gift = giftByShape.get(shapeKey);
      return gift ? giftCompleted(gift) : false;
    });
    const target = craftDeps.UNLOCKED_TOOL_SHAPES;
    if (target.length === available.length && target.every((key, index) => key === available[index])) return;
    target.splice(0, target.length, ...available);
  }

  function giveGiftItem(gift) {
    if (!gift || !craftDeps) return null;
    const itemKey = craftDeps.craftedToolItemKey?.(gift.shapeKey, gift.giftMetalKey)
      || `${gift.shapeKey}_${gift.giftMetalKey}`;
    const gear = craftDeps.getGearInventory?.();
    if (!gear) return null;
    if (!gear.tools) gear.tools = {};
    gear.tools[itemKey] = true;
    craftDeps.saveGearInventory?.();
    craftDeps.refreshMetalToolWorldTexture?.(itemKey);
    craftDeps.buildInventoryGrid?.();
    craftDeps.buildEquipmentSlots?.();
    return itemKey;
  }

  function completeGift(gift) {
    if (!gift || giftCompleted(gift)) return false;
    const itemKey = giveGiftItem(gift);
    global.DialogueContent?.recordNpcMemory?.(gift.npcId, completionMemoryEvent(gift));
    syncSmithingShapeUnlocks();
    craftDeps?.saveMemberWorldData?.();
    const itemLabel = craftDeps?.TOOL_ITEM_DEFS?.[itemKey]?.label || gift.shapeKey;
    craftDeps?.showToast?.(`🎁 ${itemLabel} received — its shape is now available at the bronzeworks.`, true);
    document.dispatchEvent(new CustomEvent('hobunji-weapon-trust-gift', {
      detail: { giftId: gift.id, npcId: gift.npcId, shapeKey: gift.shapeKey, itemKey },
    }));
    if (activeVisit?.gift?.id === gift.id) {
      activeVisit.completed = true;
      setTimeout(() => removeActiveVisitor('completed'), 250);
    }
    return true;
  }

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
        candidates.push({ ...feature, door, approach, direction });
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
      if (walker === activeVisit?.proxy || walker?.area !== cfg.visitor.farmhouseExteriorArea || !walker?.root?.position) return false;
      return Math.hypot(walker.root.position.x - (c + 0.5), walker.root.position.z - (r + 0.5)) < 0.7;
    });
  }

  function nearestWalkableSpawn(door) {
    if (!door) return null;
    const distance = Math.max(1, Number(cfg.visitor?.preferredDistanceFromDoorTiles) || 3);
    const desiredC = Math.round(door.door.c + door.direction.dc * distance);
    const desiredR = Math.round(door.door.r + door.direction.dr * distance);
    const radius = Math.max(0, Number(cfg.visitor?.nearestWalkableSearchRadiusTiles) || 5);
    const candidates = [];
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        candidates.push({ c: desiredC + dc, r: desiredR + dr, d2: dc * dc + dr * dr });
      }
    }
    candidates.sort((a, b) => a.d2 - b.d2 || Math.abs(a.c - desiredC) + Math.abs(a.r - desiredR) - (Math.abs(b.c - desiredC) + Math.abs(b.r - desiredR)));
    for (const spot of candidates) {
      if (occupiedByNpc(spot.c, spot.r)) continue;
      if (global.NpcPathfinding?.isNpcTileWalkable?.(cfg.visitor.farmhouseExteriorArea, spot.c, spot.r)) return spot;
    }
    return null;
  }

  function farmSurfaceY(c, r) {
    try {
      const grid = runtimeDeps?.getActiveGrid?.();
      const tile = grid?.[r]?.[c];
      if (tile && runtimeDeps?.tileSurfaceYInArea) return Number(runtimeDeps.tileSurfaceYInArea(tile, cfg.visitor.farmhouseExteriorArea)) || 0;
    } catch (_) {}
    return 0;
  }

  function sourceWalkerForGift(gift) {
    return (scheduleDeps?.npcWalkers || []).find(walker => !walker?._weaponTrustVisitor && walker?.rec?.id === gift.npcId) || null;
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

  function visitorTree(source, gift) {
    const authored = source?.rec?.dialogueTrees?.find(tree => tree?.id === gift.dialogueTreeId) || dialogueTreeFromGift(gift);
    const tree = clone(authored);
    tree.trigger = 'interact';
    tree.priority = 100000;
    // Event eligibility/queueing is owned by this module; stripping ordinary
    // conditions here prevents weather/station/etc. from suppressing a visitor
    // who has already physically appeared at the farmhouse door.
    tree.conditions = { weekdays: [], seasons: [], weather: [], timesOfDay: [], encounter: [], maps: [], stations: [], playerSpecies: [], relationship: { min: null, max: null } };
    tree.excludeConditions = clone(tree.conditions);
    tree.weaponTrustGiftId = gift.id;
    // Trust-visit dialogue supports greeting-friendly tokens that are resolved
    // from the same live player/world data used by the ordinary dialogue system.
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

  function cloneVisitorRoot(source, gift, spot, door) {
    const root = source?.root?.clone?.(true);
    if (!root) return null;
    root.name = `weaponTrustVisitor_${gift.npcId}`;
    root.visible = true;
    root.userData = { ...(root.userData || {}), weaponTrustVisitor: true, weaponTrustGiftId: gift.id };
    root.position.set(spot.c + 0.5, farmSurfaceY(spot.c, spot.r), spot.r + 0.5);
    const dx = door.door.c + 0.5 - root.position.x;
    const dz = door.door.r + 0.5 - root.position.z;
    root.rotation.y = Math.atan2(dx, dz);

    // Always attach the visitor to the player's active FARM scene. Reusing the
    // source NPC's parent is wrong whenever that NPC is currently in town or
    // a building; the clone would exist, but in a scene the player cannot see.
    const parent = runtimeDeps?.getActiveScene?.()
      || (source.area === cfg.visitor.farmhouseExteriorArea ? source.root.parent : null);
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

  function visitorRecord(source, gift) {
    return {
      ...clone(source.rec || {}),
      id: `${cfg.visitor?.visitorIdPrefix || 'weapon_trust_visit:'}${gift.npcId}`,
      sourceNpcId: gift.npcId,
      relationship: false,
      dialogueTrees: [visitorTree(source, gift)],
      schedule: [],
      schedules: [],
      scheduleHooks: {},
      weaponTrustGiftId: gift.id,
    };
  }

  function spawnVisitor(gift) {
    if (!gift || !scheduleDeps?.npcWalkers) return false;
    const source = sourceWalkerForGift(gift);
    const door = doorJustExited();
    const spot = nearestWalkableSpawn(door);
    if (!source || !door || !spot) return false;
    removeActiveVisitor('replace');
    const visual = cloneVisitorRoot(source, gift, spot, door);
    if (!visual?.root) return false;
    const rec = visitorRecord(source, gift);
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
      area: cfg.visitor.farmhouseExteriorArea,
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
      _weaponTrustVisitor: true,
      _weaponTrustGiftId: gift.id,
      update() {}, // The visitor is deliberately stationary and never enters the normal schedule resolver.
      dispose() { visual.root.parent?.remove?.(visual.root); },
    };
    scheduleDeps.npcWalkers.push(proxy);
    activeVisit = {
      gift, source, proxy, root: visual.root, door, spot,
      dialogueStarted: false,
      naturalEndArmed: false,
      completed: false,
    };
    global.__farmLog?.(`[weapon-trust-visits] spawned ${gift.npcId} for ${gift.shapeKey} near farmhouse door`, 'npc');
    return true;
  }

  function removeActiveVisitor(reason = 'cleanup') {
    const visit = activeVisit;
    if (!visit) return;
    const walkers = scheduleDeps?.npcWalkers;
    if (Array.isArray(walkers)) {
      const index = walkers.indexOf(visit.proxy);
      if (index >= 0) walkers.splice(index, 1);
    }
    visit.root?.parent?.remove?.(visit.root);
    visit.root?.traverse?.(node => {
      // Cloned visitor meshes share the source NPC's materials/textures; do not
      // dispose shared GPU resources here. Removing the clone is sufficient.
      node.userData && (node.userData.weaponTrustVisitorRemoved = true);
    });
    activeVisit = null;
    global.__farmLog?.(`[weapon-trust-visits] visitor removed (${reason})`, 'npc');
  }

  function onFarmhouseExit() {
    ensureDialogueTreesOnWalkers();
    syncSmithingShapeUnlocks();
    const queue = pendingGifts();
    if (!queue.length) return;
    // If the front visitor was never completed, they remain the front of the
    // config-order queue and simply reappear on the next farmhouse exit.
    spawnVisitor(queue[0]);
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
      if (area !== cfg.visitor.farmhouseExteriorArea && activeVisit) removeActiveVisitor('area-change');
      if (from === cfg.visitor.farmhouseInteriorArea && area === cfg.visitor.farmhouseExteriorArea) onFarmhouseExit();
    }
    if (now - lastSyncAt > 1000) {
      lastSyncAt = now;
      ensureDialogueTreesOnWalkers();
      syncSmithingShapeUnlocks();
    }
    frameHandle = global.requestAnimationFrame(update);
  }

  function patchDialogueContent(api) {
    if (!api || patchedApis.has(api)) return;
    patchedApis.add(api);
    const originalInit = api.init?.bind(api);
    if (originalInit) api.init = function weaponTrustDialogueInit(injectedDeps) {
      dialogueDeps = injectedDeps;
      const close = injectedDeps?.closeNpcDialogue;
      if (typeof close === 'function' && !close.__weaponTrustNaturalClose) {
        const wrappedClose = function weaponTrustNaturalDialogueClose(...args) {
          const visit = activeVisit;
          const shouldComplete = !!visit?.dialogueStarted && !!visit?.naturalEndArmed && !visit?.completed;
          const gift = visit?.gift || null;
          const result = close.apply(this, args);
          if (visit) visit.naturalEndArmed = false;
          if (shouldComplete && gift) completeGift(gift);
          return result;
        };
        wrappedClose.__weaponTrustNaturalClose = true;
        injectedDeps.closeNpcDialogue = wrappedClose;
      }
      const result = originalInit(injectedDeps);
      ensureDialogueTreesOnWalkers();
      return result;
    };
    const originalBegin = api.beginNpcConversation?.bind(api);
    if (originalBegin) api.beginNpcConversation = function weaponTrustBeginConversation(rec, ...rest) {
      if (activeVisit && rec?.weaponTrustGiftId === activeVisit.gift.id) {
        activeVisit.dialogueStarted = true;
        activeVisit.naturalEndArmed = false;
      }
      return originalBegin(rec, ...rest);
    };
    const originalAdvance = api.advanceNpcDialogue?.bind(api);
    if (originalAdvance) api.advanceNpcDialogue = function weaponTrustAdvanceConversation(...args) {
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
    if (originalInit) api.init = function weaponTrustNpcSchedulingInit(injectedDeps) {
      scheduleDeps = injectedDeps;
      const result = originalInit(injectedDeps);
      ensureDialogueTreesOnWalkers();
      return result;
    };
  }

  function patchMetalCraftShop(api) {
    if (!api || patchedApis.has(api)) return;
    patchedApis.add(api);
    const originalInit = api.init?.bind(api);
    if (originalInit) api.init = function weaponTrustSmithingInit(injectedDeps) {
      craftDeps = injectedDeps;
      // Preserve the original full catalog across character/world re-init.
      // After the first filter pass injectedDeps.UNLOCKED_TOOL_SHAPES is the
      // same mutable array but shorter, so resnapshotting it would permanently
      // forget every gated shape and make later friendship unlocks impossible.
      if (!allSmithShapeKeys || injectedDeps?.UNLOCKED_TOOL_SHAPES?.length > allSmithShapeKeys.length) {
        allSmithShapeKeys = [...(injectedDeps?.UNLOCKED_TOOL_SHAPES || [])];
      }
      syncSmithingShapeUnlocks();
      return originalInit(injectedDeps);
    };
  }

  function patchBanditCombat(api) {
    if (!api || patchedApis.has(api)) return;
    patchedApis.add(api);
    const originalInit = api.init?.bind(api);
    if (originalInit) api.init = function weaponTrustBanditInit(injectedDeps) {
      runtimeDeps = injectedDeps;
      const held = injectedDeps?.HELD_SHAPE_DEFS;
      if (held && banditShapeKeys.size && !banditPoolProxies.has(held)) {
        const proxy = new Proxy(held, {
          ownKeys(target) {
            return Reflect.ownKeys(target).filter(key => typeof key !== 'string' || !target[key]?.slots?.includes?.('weapon') || banditShapeKeys.has(key));
          },
        });
        banditPoolProxies.add(proxy);
        injectedDeps.HELD_SHAPE_DEFS = proxy;
      }
      return originalInit(injectedDeps);
    };
  }

  function patchApiWhenAssigned(name, patcher) {
    const existing = global[name];
    if (existing) { patcher(existing); return; }
    const descriptor = Object.getOwnPropertyDescriptor(global, name);
    if (descriptor && descriptor.configurable === false) return;
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

  function ensureDialogueEditorTriggerOption() {
    const select = document.getElementById('editTreeTrigger');
    if (!select) return;
    let option = [...select.options].find(entry => entry.value === 'weaponTrustVisit');
    if (!option) {
      option = document.createElement('option');
      option.value = 'weaponTrustVisit';
      option.textContent = 'weaponTrustVisit';
      select.appendChild(option);
    }
    const tree = typeof global.currentTree === 'function' ? global.currentTree() : null;
    if (tree?.trigger === 'weaponTrustVisit') select.value = 'weaponTrustVisit';
  }

  function installDialogueEditorSupport() {
    const start = () => {
      ensureDialogueEditorTriggerOption();
      editorObserver?.disconnect?.();
      editorObserver = new MutationObserver(ensureDialogueEditorTriggerOption);
      editorObserver.observe(document.body, { childList: true, subtree: true });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }

  global.WeaponTrustVisits = Object.freeze({
    config: cfg,
    requiredHearts,
    dialogueTreeFromGift,
    mergeDialogueTreesIntoDatabase,
    pendingGifts,
    giftEligible,
    giftCompleted,
    isFreshlyCreatedCharacter,
    removeStarterGiftItems,
    removeStarterGiftItemsFromNewCharacter,
    syncSmithingShapeUnlocks,
    spawnVisitor,
    removeActiveVisitor,
    completeGift,
    debugSnapshot() {
      return {
        mode: IS_DIALOGUE_EDITOR ? 'dialogue-editor' : 'game',
        currentArea: currentArea(),
        pendingGiftIds: pendingGifts().map(gift => gift.id),
        activeGiftId: activeVisit?.gift?.id || null,
        activeNpcId: activeVisit?.gift?.npcId || null,
        activeDialogueStarted: !!activeVisit?.dialogueStarted,
        activeNaturalEndArmed: !!activeVisit?.naturalEndArmed,
        activeSpawn: activeVisit?.spot ? { ...activeVisit.spot } : null,
        smithShapes: craftDeps?.UNLOCKED_TOOL_SHAPES ? [...craftDeps.UNLOCKED_TOOL_SHAPES] : null,
        configuredBanditShapes: [...banditShapeKeys],
      };
    },
  });

  if (IS_DIALOGUE_EDITOR) {
    // Editor only needs the generated-tree overlay and trigger UI. Do not run
    // the live game's frame loop or install setters for gameplay singleton APIs.
    installDialogueEditorSupport();
  } else {
    // New-character correction runs in capture phase so game/profile consumers
    // see the Fishing Mace already removed. Existing characters — including
    // those starting/joining another world — are deliberately untouched.
    document.addEventListener('hobunjiPlayerReady', event => {
      removeStarterGiftItemsFromNewCharacter(event.detail);
      setTimeout(() => { ensureDialogueTreesOnWalkers(); syncSmithingShapeUnlocks(); }, 0);
    }, { capture: true });

    patchApiWhenAssigned('DialogueContent', patchDialogueContent);
    patchApiWhenAssigned('NpcScheduling', patchNpcScheduling);
    patchApiWhenAssigned('MetalCraftShop', patchMetalCraftShop);
    patchApiWhenAssigned('BanditCombat', patchBanditCombat);

    frameHandle = global.requestAnimationFrame(update);
  }
})(window);
