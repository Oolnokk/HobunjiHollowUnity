(() => {
  'use strict';
  if (window.LivestockNursery) return;

  // One-way livestock Nursery lifecycle + its visual-only interior swarm.
  // This deliberately sits beside FarmAnimals/FarmBuildings/FarmTroughs/FarmPanel
  // instead of being appended to any of them: the decoupled public seams remain
  // authoritative and this module only specializes the Nursery behavior.
  const NURSERY_ID = 'farm_nursery';
  const NURSERY_MAP_ID = 'map_i_barn_' + NURSERY_ID;
  const NURSERY_TIER = 'nursery';
  const NURSERY_VISIBLE_LIMIT = 12;
  const BABY_SCALE = 0.3125;
  const BABY_SPEED_MULTIPLIER = 1.125;
  const OUTDOOR_SENTINEL_BARN = '__livestock_outdoors__';
  const TURN_MIN_SEC = 0.12;
  const TURN_MAX_SEC = 0.42;
  const HOP_MIN_HZ = 3.2;
  const HOP_MAX_HZ = 5.4;
  const HOP_MIN_HEIGHT = 0.10;
  const HOP_MAX_HEIGHT = 0.24;
  const FRAME_MIN_SEC = 0.075;
  const FRAME_MAX_SEC = 0.115;
  const NURSERY_PIECE_DEF = { file: 'config/pieces/barn-nursery.json', w: 3, h: 2 };
  const SPECIES_ICONS = {
    uumkaoii: '🐮',
    'gar-wolf': '🐺',
    'dabinggi-hound': '🐕',
    grehlr: '🐈',
    drenkirra: '🦎',
  };
  const SPECIES_LABELS = {
    uumkaoii: "Uumkao'ii",
    'gar-wolf': 'Gar-wolf',
    'dabinggi-hound': 'Dabinggi Hound',
    grehlr: 'Grehlr',
    drenkirra: 'Drenkirra',
  };

  let animalDeps = null; // Captures FarmAnimals' existing injected save/world/permission seam.
  let buildingDeps = null; // Captures FarmBuildings' placement/scene-transition seam.
  let panelDeps = null; // Captures FarmPanel's existing menu dependency seam for safe rerenders.
  let originalAnimalInit = null;
  let originalBuildingInit = null;
  let originalPanelInit = null;
  let originalAddFromItem = null;
  let originalAssignToBarn = null;
  let originalRespawnWorldLivestock = null;
  let originalTickResources = null;
  let originalTickHearts = null;
  let originalTickBreedingProgress = null;
  let originalResolveBreedingParent = null;
  let originalSpawnBuildingEntry = null;
  let originalDemolishBuilding = null;
  let originalSynthesizeBarnInterior = null;
  let originalPanelRender = null;
  let selectedBabyId = null; // Persists the compact-list selection while the Farm panel partially rerenders.
  let panelObserver = null; // Reapplies Nursery decoration after FarmPanel's private partial renders.
  let panelDecorating = false;
  let panelDecorateQueued = false;
  let swarmRaf = 0; // Nursery-only rAF; never runs outside its interior.
  let swarmEntered = false;
  let swarmLastFrameAt = 0;
  let swarmGeneration = 0; // Invalidates async genotype-frame work after exit/reroll.
  let swarmAgents = [];
  let swarmVisibleIds = [];

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const randomBetween = (min, max) => min + Math.random() * (max - min);
  const angleDiff = (target, current) => Math.atan2(Math.sin(target - current), Math.cos(target - current));
  const hasOwn = (object, key) => !!object && Object.prototype.hasOwnProperty.call(object, key);

  function isNurseryBuilding(entry) {
    return !!entry && (entry.id === NURSERY_ID || entry.nursery === true || entry.tier === NURSERY_TIER);
  }

  function isBaby(entry) {
    if (!entry) return false;
    if (entry.lifeStage === 'baby') return true;
    if (entry.lifeStage === 'adult') return false;
    // Pre-Nursery explicit barnId:null was the old stasis representation.
    // Records predating barns have no barnId property at all and remain adults.
    return hasOwn(entry, 'barnId') && entry.barnId == null;
  }

  function currentLivestock() {
    return animalDeps?.loadWorldLivestock?.() || [];
  }

  function babies() {
    return currentLivestock().filter(isBaby);
  }

  function adults() {
    return currentLivestock().filter(entry => !isBaby(entry));
  }

  function regularBuiltBarns() {
    return (buildingDeps?.getFarmBuildings?.() || []).filter(entry =>
      entry?.kind === 'barn' && entry.stage === 'built' && !isNurseryBuilding(entry));
  }

  function adultCapacity() {
    const tiers = buildingDeps?.getBarnTiers?.() || {};
    return regularBuiltBarns().reduce((sum, barn) => sum + (Number(tiers[barn.tier]?.slots) || 0), 0);
  }

  function adultCount() {
    return adults().length;
  }

  function normalizeLifeStages() {
    if (!animalDeps?.loadWorldLivestock || !animalDeps?.saveWorldLivestock) return false;
    const list = animalDeps.loadWorldLivestock();
    let changed = false;
    for (const entry of list) {
      if (entry.lifeStage !== 'baby' && entry.lifeStage !== 'adult') {
        entry.lifeStage = hasOwn(entry, 'barnId') && entry.barnId == null ? 'baby' : 'adult';
        changed = true;
      }
      if (entry.lifeStage === 'baby') {
        if (entry.barnId !== null || !hasOwn(entry, 'barnId')) { entry.barnId = null; changed = true; }
        if (entry.troughIndex != null) { entry.troughIndex = null; changed = true; }
        if (entry.assignedVatId != null) { entry.assignedVatId = null; changed = true; }
      } else if (!hasOwn(entry, 'barnId')) {
        // Normalize legacy roamers while preserving their saved col/row. The
        // respawn wrapper below temporarily presents null-housed adults to the
        // original legacy-roaming branch when exterior entities are rebuilt.
        entry.barnId = null;
        changed = true;
      }
    }
    if (changed) animalDeps.saveWorldLivestock(list);
    return changed;
  }

  function ensureNurseryTier() {
    const pieces = window.FarmBuildings?.BARN_PIECES;
    if (pieces) pieces[NURSERY_TIER] = { ...NURSERY_PIECE_DEF };
    const tiers = buildingDeps?.getBarnTiers?.();
    if (tiers && !tiers[NURSERY_TIER]) {
      tiers[NURSERY_TIER] = {
        label: 'Nursery', slots: 0, planItem: null,
        description: 'Permanent free baby-animal Nursery; not adult housing.',
      };
    }
  }

  function candidateNurserySpot() {
    const cols = Number(buildingDeps?.COLS) || 0;
    const rows = Number(buildingDeps?.ROWS) || 0;
    if (!cols || !rows || !window.FarmBuildings?.canPlaceAt) return null;
    const seedCol = Math.max(1, Math.floor(cols * 0.12));
    const seedRow = Math.max(1, Math.floor(rows * 0.12));
    const candidates = [];
    for (let row = 0; row <= rows - NURSERY_PIECE_DEF.h; row++) {
      for (let col = 0; col <= cols - NURSERY_PIECE_DEF.w; col++) {
        candidates.push({ col, row, d: Math.abs(col - seedCol) + Math.abs(row - seedRow) });
      }
    }
    candidates.sort((a, b) => a.d - b.d);
    return candidates.find(point => window.FarmBuildings.canPlaceAt(
      point.col, point.row, NURSERY_PIECE_DEF.w, NURSERY_PIECE_DEF.h)) || null;
  }

  function patchNurseryWorldObject(entry) {
    const object = entry?._worldObj;
    if (!object || object.__nurseryWorldObjectPatched) return;
    object.__nurseryWorldObjectPatched = true;
    try {
      Object.defineProperty(object, 'label', { configurable: true, get: () => '🍼 Nursery' });
    } catch (_) {}
    object.getButtons = () => [
      { icon: '🚪', label: 'Enter Nursery', action: 'obj_nursery_enter_' + entry.id, style: 'primary', allowed: true },
      { icon: '🐣', label: `Manage Babies (${babies().length})`, action: 'obj_nursery_manage_' + entry.id, style: 'secondary', allowed: animalDeps?.hasFarmPermission?.('livestock') !== false },
    ];
    object.onAction = action => {
      if (action === 'obj_nursery_enter_' + entry.id) {
        buildingDeps?.enterBuilding?.(NURSERY_MAP_ID);
        return { ok: true, message: 'Entered the Nursery.' };
      }
      if (action === 'obj_nursery_manage_' + entry.id) {
        if (animalDeps?.hasFarmPermission?.('livestock') === false) {
          return { ok: false, message: "Only the farm's owner (or a granted farmhand) can manage livestock." };
        }
        buildingDeps?.setFarmLivestockFocusBarnId?.(null);
        buildingDeps?.openMenu?.('farm');
        queuePanelDecoration();
        return { ok: true, message: 'Opened the Nursery baby list.' };
      }
      return { ok: false, message: 'Unknown Nursery action.' };
    };
  }

  function ensureNurseryBuilding() {
    if (!buildingDeps?.getFarmBuildings || !window.FarmBuildings?.spawnEntry) return null;
    ensureNurseryTier();
    const buildings = buildingDeps.getFarmBuildings();
    let nursery = buildings.find(isNurseryBuilding);
    if (nursery) {
      nursery.id = NURSERY_ID;
      nursery.kind = 'barn';
      nursery.tier = NURSERY_TIER;
      nursery.nursery = true;
      nursery.protected = true;
      nursery.w = NURSERY_PIECE_DEF.w;
      nursery.h = NURSERY_PIECE_DEF.h;
      patchNurseryWorldObject(nursery);
      return nursery;
    }

    const point = candidateNurserySpot();
    if (!point) {
      console.warn('[Nursery] could not find a clear 3x2 starting footprint.');
      return null;
    }
    nursery = {
      id: NURSERY_ID,
      kind: 'barn', tier: NURSERY_TIER,
      col: point.col, row: point.row,
      w: NURSERY_PIECE_DEF.w, h: NURSERY_PIECE_DEF.h,
      stage: 'built', nursery: true, protected: true, freeWithFarm: true,
    };
    buildings.push(nursery);
    window.FarmBuildings.spawnEntry(nursery);
    window.FarmBuildings.clearFootprint?.(nursery.col, nursery.row, nursery.w, nursery.h);
    buildingDeps.saveFarmLayout?.();
    buildingDeps.saveMemberWorldData?.();
    window.__farmLog?.(`[Nursery] seeded free 3x2 Nursery at ${nursery.col},${nursery.row}`, 'wildlife');
    return nursery;
  }

  function findOpenAdultBarn() {
    const list = currentLivestock();
    const tiers = buildingDeps?.getBarnTiers?.() || {};
    for (const barn of regularBuiltBarns()) {
      const slots = Number(tiers[barn.tier]?.slots) || 0;
      const occupied = list.filter(entry => entry.barnId === barn.id).length;
      if (occupied < slots) return barn;
    }
    return null;
  }

  function growBaby(livestockId) {
    if (animalDeps?.hasFarmPermission?.('livestock') === false) {
      return { ok: false, message: "Only the farm's owner (or a granted farmhand) can manage livestock." };
    }
    normalizeLifeStages();
    const list = currentLivestock();
    const entry = list.find(item => item.id === livestockId);
    if (!entry || !isBaby(entry)) return { ok: false, message: 'That Nursery baby was not found.' };
    const count = adultCount();
    const capacity = adultCapacity();
    if (count >= capacity) return { ok: false, message: `No adult barn space is available (${count}/${capacity}). Build or upgrade a barn first.` };
    const barn = findOpenAdultBarn();
    if (!barn) return { ok: false, message: `No adult barn has an open stall (${count}/${capacity}).` };

    entry.lifeStage = 'adult';
    entry.barnId = null;
    animalDeps.saveWorldLivestock?.(list);
    const result = originalAssignToBarn.call(window.FarmAnimals, livestockId, barn.id);
    if (!result?.ok) {
      entry.lifeStage = 'baby';
      entry.barnId = null;
      entry.troughIndex = null;
      animalDeps.saveWorldLivestock?.(list);
      return result;
    }
    rerollSwarm();
    queuePanelDecoration();
    return { ...result, message: `${entry.name} grew up and moved into the ${buildingDeps?.getBarnTiers?.()?.[barn.tier]?.label || 'barn'}!` };
  }

  function removeLiveAnimal(livestockId) {
    const animal = [...(animalDeps?.animalObjects || [])].find(item => item.livestockId === livestockId);
    if (!animal) return;
    animalDeps.worldObjects?.delete?.(animal.col + ',' + animal.row);
    animalDeps.animalObjects?.delete?.(animal);
    try { animal.reset?.(); } catch (_) {}
  }

  function spawnSingleOutdoorAdult(entry, preferredBarn) {
    if (!entry || animalDeps?.getCurrentArea?.() !== 'farm' || !originalRespawnWorldLivestock) return;
    removeLiveAnimal(entry.id);
    const spot = (preferredBarn && window.FarmBuildings?.findOpenTileNear?.(preferredBarn))
      || window.FarmBuildings?.findOpenTileNear?.(ensureNurseryBuilding());
    if (spot) { entry.col = spot.col; entry.row = spot.row; }
    const savedLoad = animalDeps.loadWorldLivestock;
    const savedBarn = entry.barnId;
    try {
      delete entry.barnId;
      animalDeps.loadWorldLivestock = () => [entry];
      originalRespawnWorldLivestock.call(window.FarmAnimals);
    } finally {
      entry.barnId = savedBarn == null ? null : savedBarn;
      animalDeps.loadWorldLivestock = savedLoad;
    }
  }

  function unassignAdultFromBarn(livestockId) {
    if (animalDeps?.hasFarmPermission?.('livestock') === false) {
      return { ok: false, message: "Only the farm's owner (or a granted farmhand) can manage livestock." };
    }
    normalizeLifeStages();
    const list = currentLivestock();
    const entry = list.find(item => item.id === livestockId);
    if (!entry) return { ok: false, message: 'Animal not found.' };
    if (isBaby(entry)) return { ok: false, message: 'Nursery babies can only leave by growing up.' };
    if (!entry.barnId) return { ok: true, message: `${entry.name} is already living outdoors.` };
    const oldBarn = (buildingDeps?.getFarmBuildings?.() || []).find(barn => barn.id === entry.barnId);
    const oldVatId = entry.assignedVatId;
    entry.lifeStage = 'adult';
    entry.barnId = null;
    entry.troughIndex = null;
    entry.assignedVatId = null;
    if (oldVatId) window.FarmAnimals?.clearVatWorkerPose?.(oldVatId);
    animalDeps.saveWorldLivestock?.(list);
    spawnSingleOutdoorAdult(entry, oldBarn);
    queuePanelDecoration();
    return { ok: true, message: `${entry.name} is living outdoors and will lose happiness each night until housed.` };
  }

  function withOutdoorAdultSentinel(original, args) {
    normalizeLifeStages();
    const list = currentLivestock();
    const outdoors = list.filter(entry => !isBaby(entry) && entry.barnId == null);
    if (!outdoors.length) return original.apply(window.FarmAnimals, args);
    const savedSave = animalDeps.saveWorldLivestock;
    try {
      outdoors.forEach(entry => { entry.barnId = OUTDOOR_SENTINEL_BARN; });
      // Original day ticks key their "stasis" pause solely off a falsy barnId.
      // Suppress the original write so the temporary sentinel can never persist.
      animalDeps.saveWorldLivestock = () => {};
      return original.apply(window.FarmAnimals, args);
    } finally {
      outdoors.forEach(entry => { entry.barnId = null; });
      animalDeps.saveWorldLivestock = savedSave;
      savedSave?.(list);
    }
  }

  function sanitizeBreedingPairs() {
    if (!animalDeps?._loadWorldBreedingPairs || !animalDeps?._saveWorldBreedingPairs) return;
    const pairs = animalDeps._loadWorldBreedingPairs();
    if (!Array.isArray(pairs) || !pairs.length) return;
    const babyIds = new Set(babies().map(entry => entry.id));
    const clean = pairs.filter(pair => {
      const aBaby = pair?.parentA?.source === 'world' && babyIds.has(pair.parentA.id);
      const bBaby = pair?.parentB?.source === 'world' && babyIds.has(pair.parentB.id);
      return !aBaby && !bBaby;
    });
    if (clean.length !== pairs.length) animalDeps._saveWorldBreedingPairs(clean);
  }

  function currentArea() {
    return animalDeps?.getCurrentArea?.() || window.__hobunjiFurnitureDebug?.getCurrentArea?.() || null;
  }

  function activeScene() {
    return window.GridTileAccessors?.getActiveScene?.() || null;
  }

  function nurseryBounds() {
    const nursery = ensureNurseryBuilding();
    return {
      cols: Math.max(6, (Number(nursery?.w) || 3) * 2),
      rows: Math.max(5, (Number(nursery?.h) || 2) * 2),
    };
  }

  function playerFaceTarget() {
    const target = animalDeps?.getPlayerFaceTarget?.();
    if (!target) return null;
    const z = Number.isFinite(Number(target.z)) ? Number(target.z) : Number(target.y);
    const x = Number(target.x);
    const worldY = Number(target.worldY);
    return Number.isFinite(x) && Number.isFinite(z) ? { x, z, worldY } : null;
  }

  function shuffledSample(entries, count) {
    const copy = entries.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy.slice(0, count);
  }

  function makeTexturePair(canvas, name) {
    if (!canvas || typeof THREE === 'undefined') return null;
    const front = new THREE.CanvasTexture(canvas);
    const back = new THREE.CanvasTexture(canvas);
    if ('colorSpace' in front && THREE.SRGBColorSpace) {
      front.colorSpace = THREE.SRGBColorSpace;
      back.colorSpace = THREE.SRGBColorSpace;
    }
    back.wrapS = THREE.RepeatWrapping;
    back.repeat.set(-1, 1);
    back.offset.set(1, 0);
    front.name = name + '_front';
    back.name = name + '_back';
    front.needsUpdate = true;
    back.needsUpdate = true;
    return { front, back };
  }

  function applyTexturePair(agent, pair) {
    if (!agent?.avatarRef?.group || !pair) return;
    agent.avatarRef.group.traverse(child => {
      if (!child?.material) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        if (!material) continue;
        if (String(child.name || '').endsWith('_front_plane')) {
          material.map = pair.front;
          material.needsUpdate = true;
        } else if (String(child.name || '').endsWith('_back_plane')) {
          material.map = pair.back;
          material.needsUpdate = true;
        }
      }
    });
  }

  async function prepareAgentFrames(agent, entry, token) {
    const renderer = window.CreatureGeneticsRender;
    if (!renderer?.composeFrame || !entry?.genotype) return;
    try {
      const names = ['idle', 'run1', 'run2'];
      const canvases = await Promise.all(names.map(name => renderer.composeFrame(entry.kind, name, entry.genotype, false)));
      if (token !== swarmGeneration || !swarmAgents.includes(agent)) return;
      for (let i = 0; i < names.length; i++) {
        if (canvases[i]) agent.frames[names[i]] = makeTexturePair(canvases[i], `nursery_${entry.id}_${names[i]}`);
      }
      agent.frameName = agent.frames.run1 ? 'run1' : 'idle';
      applyTexturePair(agent, agent.frames[agent.frameName] || agent.frames.idle);
    } catch (error) {
      console.warn('[Nursery] baby frame compose failed:', entry.kind, error);
    }
  }

  function disposeAgent(agent) {
    if (!agent) return;
    agent.avatarRef?.group?.parent?.remove?.(agent.avatarRef.group);
    const currentMaps = new Set();
    agent.avatarRef?.group?.traverse?.(child => {
      if (child?.material?.map) currentMaps.add(child.material.map);
    });
    try { agent.avatarRef?.dispose?.(); } catch (_) {}
    for (const pair of Object.values(agent.frames || {})) {
      if (pair?.front && !currentMaps.has(pair.front)) pair.front.dispose?.();
      if (pair?.back && !currentMaps.has(pair.back)) pair.back.dispose?.();
    }
  }

  function clearSwarm() {
    swarmGeneration++;
    for (const agent of swarmAgents) disposeAgent(agent);
    swarmAgents = [];
    swarmVisibleIds = [];
  }

  function retargetAgent(agent, immediate = false) {
    const bounds = nurseryBounds();
    const player = playerFaceTarget() || { x: bounds.cols / 2, z: bounds.rows / 2 };
    const angle = Math.random() * Math.PI * 2;
    const radius = randomBetween(0.18, 1.10);
    agent.targetX = clamp(player.x + Math.cos(angle) * radius, 0.45, bounds.cols - 0.45);
    agent.targetZ = clamp(player.z + Math.sin(angle) * radius, 0.45, bounds.rows - 0.45);
    agent.turnTimer = immediate ? 0 : randomBetween(TURN_MIN_SEC, TURN_MAX_SEC);
  }

  function createAgent(entry, scene, token) {
    const renderer = window.CreatureGeneticsRender;
    const avatarApi = window.PNGPlaneAvatar;
    if (typeof THREE === 'undefined' || !renderer || !avatarApi?.buildAnimalPlaneAvatarModel || token !== swarmGeneration) return null;
    const spec = renderer.SPECIES?.[entry.kind];
    const idleUrl = spec?.base?.idle;
    if (!idleUrl) return null;

    const speciesDef = animalDeps?.CREATURE_DB?.[entry.kind] || {};
    const configuredWidths = window.SCRATCHBONES_CONFIG?.game?.livestock?.animalWidths || {};
    const adultWidth = entry.kind === 'uumkaoii' ? 1.275 : (Number(configuredWidths[entry.kind]) || 1.7);
    const spriteAspect = Number(speciesDef.spriteAspect) || (600 / 1375);
    const sizeScale = window.CreatureGenetics?.creatureSizeScale?.(entry.kind, entry.genotype) || { x: 1, y: 1 };
    const modelWidth = adultWidth * BABY_SCALE;
    const modelHeight = adultWidth * spriteAspect * BABY_SCALE;
    const avatarRef = avatarApi.buildAnimalPlaneAvatarModel(THREE, idleUrl, {
      modelWidth,
      modelHeight,
      name: `nursery_baby_${entry.id}`,
      creatureId: entry.kind,
      headRig: renderer.headRigForKind?.(entry.kind) || undefined,
    });
    if (!avatarRef?.group) return null;
    avatarRef.group.name = `nursery_baby_${entry.id}`;
    window.CreatureGenetics?.applyCreatureBillboardScale?.(avatarRef.group, sizeScale);

    const bounds = nurseryBounds();
    const authoredGroundOffset = window.CreatureGenetics?.creatureGroundOffset?.(entry.kind, entry.genotype);
    const baseY = Number.isFinite(authoredGroundOffset)
      ? Math.max(0.03, authoredGroundOffset * BABY_SCALE)
      : Math.max(0.03, modelHeight * (Number(sizeScale.y) || 1) / 2);
    const agent = {
      id: entry.id,
      kind: entry.kind,
      genotype: entry.genotype,
      avatarRef,
      modelHeight,
      wx: 0.65 + Math.random() * Math.max(0.2, bounds.cols - 1.3),
      wz: 0.65 + Math.random() * Math.max(0.2, bounds.rows - 1.3),
      wy: baseY,
      baseY,
      speed: randomBetween(1.15, 2.0) * BABY_SPEED_MULTIPLIER,
      targetX: 0,
      targetZ: 0,
      turnTimer: 0,
      hopPhase: Math.random() * Math.PI * 2,
      hopHz: randomBetween(HOP_MIN_HZ, HOP_MAX_HZ),
      hopHeight: randomBetween(HOP_MIN_HEIGHT, HOP_MAX_HEIGHT),
      animTimer: randomBetween(FRAME_MIN_SEC, FRAME_MAX_SEC),
      framePeriod: randomBetween(FRAME_MIN_SEC, FRAME_MAX_SEC),
      frameName: 'idle',
      frames: {},
      groupRot: Math.random() * Math.PI * 2,
      x: 0,
      y: 0,
    };
    agent.avatarRef.group.position.set(agent.wx, agent.wy, agent.wz);
    agent.avatarRef.group.rotation.y = agent.groupRot;
    scene.add(agent.avatarRef.group);
    retargetAgent(agent);
    prepareAgentFrames(agent, entry, token);
    return agent;
  }

  function buildSwarm() {
    if (currentArea() !== NURSERY_MAP_ID || swarmAgents.length) return;
    const scene = activeScene();
    if (!scene?.add) return;
    const list = babies();
    if (!list.length) return;
    const token = ++swarmGeneration;
    const sample = shuffledSample(list, Math.min(NURSERY_VISIBLE_LIMIT, list.length));
    const made = sample.map(entry => createAgent(entry, scene, token)).filter(Boolean);
    if (token !== swarmGeneration || currentArea() !== NURSERY_MAP_ID) {
      made.forEach(disposeAgent);
      return;
    }
    swarmAgents = made;
    swarmVisibleIds = made.map(agent => agent.id);
  }

  function updateAgentHead(agent, dt) {
    const target = playerFaceTarget();
    if (!target) return;
    const headWorldY = window.CreatureHeadCache?.getHeadWorld?.(agent, 'animal')?.worldY
      ?? (agent.avatarRef.group.position.y + agent.modelHeight * 0.15);
    const dx = target.x - agent.wx;
    const dz = target.z - agent.wz;
    const horizontal = Math.max(0.15, Math.hypot(dx, dz));
    if (typeof agent.avatarRef?.updateHeadRotation === 'function' && Number.isFinite(target.worldY)) {
      // Shared animal rig convention: negative pitch looks up, positive looks down.
      const pitchDeg = -Math.atan2(target.worldY - headWorldY, horizontal) * 180 / Math.PI;
      agent.avatarRef.updateHeadRotation(pitchDeg, dt);
    }
    if (typeof agent.avatarRef?.updateHeadYaw === 'function') {
      const targetRot = -Math.atan2(dz, dx) + Math.PI / 2;
      const yawDeg = angleDiff(targetRot, agent.groupRot) * 180 / Math.PI;
      agent.avatarRef.updateHeadYaw(yawDeg, dt);
    }
  }

  function updateAgentFrame(agent, moving, dt) {
    agent.animTimer -= dt;
    if (agent.animTimer > 0) return;
    agent.animTimer = agent.framePeriod;
    let next = 'idle';
    if (moving && (agent.frames.run1 || agent.frames.run2)) {
      next = agent.frameName === 'run1' ? 'run2' : 'run1';
      if (!agent.frames[next]) next = agent.frames.run1 ? 'run1' : agent.frames.run2 ? 'run2' : 'idle';
    }
    if (next === agent.frameName || !agent.frames[next]) return;
    agent.frameName = next;
    applyTexturePair(agent, agent.frames[next]);
  }

  function updateSwarm(dt) {
    if (currentArea() !== NURSERY_MAP_ID) return;
    if (!swarmAgents.length) buildSwarm();
    const bounds = nurseryBounds();
    const liveBabyIds = new Set(babies().map(entry => entry.id));
    if (swarmAgents.some(agent => !liveBabyIds.has(agent.id))) {
      clearSwarm();
      buildSwarm();
    }
    for (const agent of swarmAgents) {
      agent.turnTimer -= dt;
      const dx = agent.targetX - agent.wx;
      const dz = agent.targetZ - agent.wz;
      const distance = Math.hypot(dx, dz);
      if (agent.turnTimer <= 0 || distance < 0.08 || Math.random() < dt * 0.55) retargetAgent(agent);
      const mdx = agent.targetX - agent.wx;
      const mdz = agent.targetZ - agent.wz;
      const moveDistance = Math.hypot(mdx, mdz);
      const moving = moveDistance > 0.025;
      if (moving) {
        const step = Math.min(moveDistance, agent.speed * dt);
        agent.wx = clamp(agent.wx + (mdx / moveDistance) * step, 0.35, bounds.cols - 0.35);
        agent.wz = clamp(agent.wz + (mdz / moveDistance) * step, 0.35, bounds.rows - 0.35);
        // Exactly the adult livestock convention: this is the correction that
        // prevents the authored side sprites from visibly running backwards.
        const movementRot = -Math.atan2(mdz, mdx) + Math.PI / 2;
        agent.groupRot += angleDiff(movementRot, agent.groupRot) * Math.min(1, dt * 18);
      }
      agent.hopPhase += dt * agent.hopHz * Math.PI * 2;
      const hop = Math.max(0, Math.sin(agent.hopPhase)) * agent.hopHeight;
      agent.wy = agent.baseY + hop;
      agent.x = agent.wx;
      agent.y = agent.wz;
      agent.avatarRef.group.position.set(agent.wx, agent.wy, agent.wz);
      agent.avatarRef.group.rotation.y = agent.groupRot;
      updateAgentFrame(agent, moving, dt);
      updateAgentHead(agent, dt);
    }
  }

  function stopSwarmLoop() {
    if (swarmRaf) cancelAnimationFrame(swarmRaf);
    swarmRaf = 0;
    swarmEntered = false;
    swarmLastFrameAt = 0;
    clearSwarm();
  }

  function startSwarmLoop() {
    if (swarmRaf) return;
    let activationFrames = 0;
    const frame = now => {
      swarmRaf = 0;
      const inside = currentArea() === NURSERY_MAP_ID;
      if (!inside) {
        if (swarmEntered) { stopSwarmLoop(); return; }
        activationFrames++;
        if (activationFrames > 120) { stopSwarmLoop(); return; }
        swarmRaf = requestAnimationFrame(frame);
        return;
      }
      swarmEntered = true;
      const dt = swarmLastFrameAt
        ? clamp((now - swarmLastFrameAt) / 1000, 0, 0.05)
        : 1 / 60;
      swarmLastFrameAt = now;
      updateSwarm(dt);
      swarmRaf = requestAnimationFrame(frame);
    };
    swarmRaf = requestAnimationFrame(frame);
  }

  function rerollSwarm() {
    clearSwarm();
    if (currentArea() === NURSERY_MAP_ID) {
      if (!swarmRaf) startSwarmLoop();
      else buildSwarm();
    }
  }

  function nurseryInteriorMap() {
    const nursery = ensureNurseryBuilding();
    if (!nursery) return null;
    const cols = Math.max(6, nursery.w * 2);
    const rows = Math.max(5, nursery.h * 2);
    const floor = [];
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) floor.push([col, row]);
    const center = Math.floor(cols / 2);
    const doorCols = [center - 1, center, center + 1].filter(col => col > 0 && col < cols - 1);
    return {
      schema: 'hobunji_building_interior.v1',
      id: NURSERY_MAP_ID,
      name: 'Nursery Interior',
      cols, rows,
      exits: [{ id: 'exit_nursery_front', label: 'Nursery Door', tiles: doorCols.map(col => [col, rows - 1]), targetMap: '', spawnCol: 0, spawnRow: 0 }],
      colliders: [], vendorZones: [], floor, furniture: [], npcStations: [],
    };
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function babySummary(entry) {
    const traits = window.CreatureGenetics?.genotypeTraits?.(entry.kind, entry.genotype) || {};
    const colors = Array.isArray(traits.colors) ? traits.colors : [];
    const patterns = Array.isArray(traits.patterns) ? traits.patterns : [];
    const special = [];
    if (traits.size?.isNonDefault) special.push(`Rare ${String(traits.size.label || 'size').toLowerCase()} size`);
    for (const pattern of patterns) {
      if (pattern.enabled) special.push(pattern.label);
      else if (pattern.carrier) special.push(`Carrier: ${pattern.label}`);
    }
    return {
      size: traits.size?.label || entry.genotype?.sizeClass || 'Medium',
      colors,
      special: special.length ? special : ['No special traits'],
    };
  }

  function renderBabyCompactList(container) {
    const babyList = babies();
    if (selectedBabyId && !babyList.some(entry => entry.id === selectedBabyId)) selectedBabyId = null;
    if (!selectedBabyId && babyList.length) selectedBabyId = babyList[0].id;
    const count = adultCount();
    const capacity = adultCapacity();
    const warning = count > capacity;

    const section = document.createElement('div');
    section.id = 'livestockNurserySection';
    section.style.cssText = 'border:1px solid var(--border,#4b443a);border-radius:9px;padding:10px;margin:0 0 10px;background:rgba(255,220,160,.055);';
    section.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:7px;">
      <strong>🍼 Nursery · ${babyList.length} babies</strong>
      <span style="font-size:11px;${warning ? 'color:#ff9b80;font-weight:700;' : 'color:var(--muted,#999);'}">Adults ${count}/${capacity} barn spaces</span>
    </div>
    <div style="font-size:11px;color:var(--muted,#999);line-height:1.35;margin-bottom:8px;">Babies stay babies indefinitely. Grow Up is one-way. Up to ${NURSERY_VISIBLE_LIMIT} are visible inside at once, rerolled every visit.</div>`;

    const stack = document.createElement('div');
    stack.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
    for (const entry of babyList) {
      const summary = babySummary(entry);
      const selected = entry.id === selectedBabyId;
      const row = document.createElement('button');
      row.type = 'button';
      row.style.cssText = `width:100%;text-align:left;border:1px solid ${selected ? 'var(--accent,#d9ad65)' : 'var(--border,#444)'};border-radius:7px;background:${selected ? 'rgba(217,173,101,.12)' : 'rgba(0,0,0,.12)'};color:inherit;padding:7px 8px;cursor:pointer;`;
      const colorsHtml = summary.colors.map(color => `<span title="${escapeHtml(color.label)}: ${escapeHtml(color.colorName || color.color || '')}" style="display:inline-block;width:10px;height:10px;border-radius:50%;border:1px solid rgba(255,255,255,.35);background:${escapeHtml(color.color || '#777')};margin-right:2px;vertical-align:-1px;"></span>`).join('');
      row.innerHTML = `<div style="display:flex;gap:6px;align-items:center;"><span>${SPECIES_ICONS[entry.kind] || '🐾'}</span><strong style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(entry.name)}</strong><span style="font-size:10px;color:var(--muted,#999);">${escapeHtml(summary.size)}</span></div>
        <div style="font-size:10px;color:var(--muted,#999);margin-top:3px;line-height:1.3;">${colorsHtml} ${escapeHtml(summary.colors.map(color => color.colorName || color.label).join(', ') || 'Default colors')} · ${escapeHtml(summary.special.join(', '))}</div>`;
      row.addEventListener('click', () => { selectedBabyId = entry.id; queuePanelDecoration(); });
      stack.appendChild(row);
    }
    if (!babyList.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'font-size:11px;color:var(--muted,#999);padding:4px 0;';
      empty.textContent = 'No babies are currently in the Nursery.';
      stack.appendChild(empty);
    }
    section.appendChild(stack);

    const selected = babyList.find(entry => entry.id === selectedBabyId);
    if (selected) {
      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;padding-top:8px;border-top:1px solid var(--border,#444);';
      const rename = document.createElement('button');
      rename.className = 'settings-small-btn';
      rename.textContent = 'Rename';
      rename.disabled = animalDeps?.hasFarmPermission?.('livestock') === false;
      rename.addEventListener('click', () => {
        const value = prompt('Rename baby:', selected.name);
        const trimmed = String(value || '').trim().slice(0, 30);
        if (!trimmed) return;
        selected.name = trimmed;
        animalDeps.saveWorldLivestock?.(currentLivestock());
        queuePanelDecoration();
      });
      actions.appendChild(rename);

      const grow = document.createElement('button');
      grow.className = 'settings-small-btn';
      grow.textContent = 'Grow Up';
      grow.disabled = animalDeps?.hasFarmPermission?.('livestock') === false || adultCount() >= adultCapacity();
      grow.title = grow.disabled && adultCount() >= adultCapacity() ? 'Build or upgrade a real barn first.' : 'Make this baby an adult and place it in an open barn.';
      grow.addEventListener('click', () => {
        const result = growBaby(selected.id);
        animalDeps?.showToast?.(result.message, result.ok !== false);
        window.FarmPanel?.render?.();
        queuePanelDecoration();
      });
      actions.appendChild(grow);

      const debug = document.createElement('button');
      debug.className = 'settings-small-btn';
      debug.textContent = 'Debug';
      debug.addEventListener('click', async () => {
        const text = JSON.stringify(debugSnapshot(), null, 2);
        try { await navigator.clipboard.writeText(text); animalDeps?.showToast?.('Nursery debug copied.', true); }
        catch (_) { window.__lastNurseryDebug = text; animalDeps?.showToast?.('Nursery debug stored in window.__lastNurseryDebug.', true); }
      });
      actions.appendChild(debug);
      section.appendChild(actions);
    }
    container.prepend(section);
  }

  function decorateLivestockList() {
    const container = document.getElementById('farmLivestockList');
    if (!container) return;
    normalizeLifeStages();
    container.querySelector('#livestockNurserySection')?.remove();
    const records = currentLivestock();
    const rows = [...container.querySelectorAll('.farm-row.livestock-trait-row')];
    records.forEach((entry, index) => {
      const row = rows[index];
      if (!row) return;
      if (isBaby(entry)) {
        row.remove();
        return;
      }
      const select = row.querySelector('.farm-barn-select');
      if (!select) return;
      const first = select.options?.[0];
      if (first && first.value === '') first.textContent = '🌿 Outdoors (no barn)';
      select.title = 'Adults without a barn keep roaming outside and lose happiness each night.';
      [...select.options].forEach(option => { if (option.value === NURSERY_ID) option.remove(); });
    });
    renderBabyCompactList(container);
  }

  function decorateBuildingList() {
    const container = document.getElementById('farmBuildingsList');
    if (!container) return;
    for (const row of container.querySelectorAll('.farm-row')) {
      if (!/Nursery/i.test(row.textContent || '')) continue;
      const name = row.querySelector('.farm-row-name');
      if (name && !/free/i.test(name.textContent || '')) name.textContent = '🍼 Nursery (free · permanent)';
      for (const button of row.querySelectorAll('button')) {
        if (/demolish/i.test(button.textContent || '')) button.remove();
      }
    }
  }

  function decoratePanelNow() {
    if (panelDecorating || typeof document === 'undefined') return;
    panelDecorating = true;
    panelObserver?.disconnect();
    try {
      ensureNurseryBuilding();
      decorateLivestockList();
      decorateBuildingList();
    } finally {
      panelDecorating = false;
      if (panelObserver && document.body) panelObserver.observe(document.body, { childList: true, subtree: true });
    }
  }

  function queuePanelDecoration() {
    if (panelDecorateQueued) return;
    panelDecorateQueued = true;
    queueMicrotask(() => {
      panelDecorateQueued = false;
      decoratePanelNow();
    });
  }

  function installPanelObserver() {
    if (panelObserver || typeof MutationObserver === 'undefined' || !document.body) return;
    panelObserver = new MutationObserver(() => queuePanelDecoration());
    panelObserver.observe(document.body, { childList: true, subtree: true });
    queuePanelDecoration();
  }

  function debugSnapshot() {
    const nursery = (buildingDeps?.getFarmBuildings?.() || []).find(isNurseryBuilding) || null;
    return {
      mostRecentChange: 'Nursery babies are 25% larger and 25% slower than the previous swarm tuning.',
      nursery: nursery && { id: nursery.id, col: nursery.col, row: nursery.row, w: nursery.w, h: nursery.h, tier: nursery.tier },
      currentArea: currentArea(),
      babies: babies().map(entry => ({ id: entry.id, name: entry.name, kind: entry.kind, size: entry.genotype?.sizeClass })),
      babyCount: babies().length,
      adults: adultCount(),
      adultCapacity: adultCapacity(),
      overCapacityBy: Math.max(0, adultCount() - adultCapacity()),
      visibleLimit: NURSERY_VISIBLE_LIMIT,
      visibleIds: [...swarmVisibleIds],
      babyScale: BABY_SCALE,
      speedMultiplier: BABY_SPEED_MULTIPLIER,
    };
  }

  function installHooks() {
    const animals = window.FarmAnimals;
    const buildings = window.FarmBuildings;
    const troughs = window.FarmTroughs;
    const panel = window.FarmPanel;
    if (!animals || !buildings || !troughs || !panel) return false;
    if (animals.__livestockNurseryRebuildInstalled) return true;
    animals.__livestockNurseryRebuildInstalled = true;

    // The barn renderer's private _pieceDef reads this exported object by
    // reference, so registering one new tier here is enough to let its existing
    // authored-piece loader render the 3x2 Nursery without modifying it.
    buildings.BARN_PIECES[NURSERY_TIER] = { ...NURSERY_PIECE_DEF };

    originalAnimalInit = animals.init;
    animals.init = function nurseryAnimalInit(injectedDeps) {
      animalDeps = injectedDeps;
      const result = originalAnimalInit.call(this, injectedDeps);
      normalizeLifeStages();
      return result;
    };

    originalBuildingInit = buildings.init;
    buildings.init = function nurseryBuildingInit(injectedDeps) {
      buildingDeps = injectedDeps;
      ensureNurseryTier();
      if (typeof injectedDeps.enterBuilding === 'function' && !injectedDeps.enterBuilding.__nurseryLoopWrapped) {
        const originalEnter = injectedDeps.enterBuilding;
        const wrappedEnter = function nurseryEnterBuilding(mapId, ...args) {
          const result = originalEnter.call(this, mapId, ...args);
          if (mapId === NURSERY_MAP_ID) startSwarmLoop();
          return result;
        };
        wrappedEnter.__nurseryLoopWrapped = true;
        injectedDeps.enterBuilding = wrappedEnter;
      }
      return originalBuildingInit.call(this, injectedDeps);
    };

    originalPanelInit = panel.init;
    panel.init = function nurseryPanelInit(injectedDeps) {
      panelDeps = injectedDeps;
      const result = originalPanelInit.call(this, injectedDeps);
      installPanelObserver();
      return result;
    };

    originalAddFromItem = animals.addFromItem;
    animals.addFromItem = function nurseryAddFromItem(itemKey, ...args) {
      const before = new Set(currentLivestock().map(entry => entry.id));
      const result = originalAddFromItem.call(this, itemKey, ...args);
      if (!result?.ok) return result;
      const list = currentLivestock();
      const entry = result.entry || list.find(item => !before.has(item.id));
      if (entry) {
        entry.lifeStage = 'baby';
        entry.barnId = null;
        entry.troughIndex = null;
        entry.assignedVatId = null;
        animalDeps.saveWorldLivestock?.(list);
      }
      ensureNurseryBuilding();
      queuePanelDecoration();
      return { ...result, entry, message: `${entry?.name || 'The baby'} moved into the Nursery and will stay a baby until you choose Grow Up.` };
    };

    originalAssignToBarn = animals.assignToBarn;
    animals.assignToBarn = function nurseryAssignToBarn(livestockId, barnId, ...args) {
      normalizeLifeStages();
      const entry = currentLivestock().find(item => item.id === livestockId);
      if (entry && isBaby(entry)) return { ok: false, message: 'Nursery babies can only enter adult housing through Grow Up.' };
      const target = (buildingDeps?.getFarmBuildings?.() || []).find(barn => barn.id === barnId);
      if (isNurseryBuilding(target) || barnId === NURSERY_ID) return { ok: false, message: 'Adults cannot be put back into the Nursery.' };
      return originalAssignToBarn.call(this, livestockId, barnId, ...args);
    };

    animals.unassignFromBarn = function nurseryUnassignFromBarn(livestockId) {
      return unassignAdultFromBarn(livestockId);
    };

    originalRespawnWorldLivestock = animals.respawnWorldLivestock;
    animals.respawnWorldLivestock = function nurseryRespawnWorldLivestock(...args) {
      ensureNurseryBuilding();
      normalizeLifeStages();
      const list = currentLivestock();
      let moved = false;
      const outdoors = list.filter(entry => !isBaby(entry) && entry.barnId == null);
      const nursery = ensureNurseryBuilding();
      for (const entry of outdoors) {
        if (!window.FarmAnimals.canSpawnAt(entry.col, entry.row)) {
          const spot = window.FarmBuildings?.findOpenTileNear?.(nursery);
          if (spot) { entry.col = spot.col; entry.row = spot.row; moved = true; }
        }
        delete entry.barnId;
      }
      try {
        return originalRespawnWorldLivestock.apply(this, args);
      } finally {
        outdoors.forEach(entry => { entry.barnId = null; });
        if (moved) animalDeps.saveWorldLivestock?.(list);
      }
    };

    originalTickResources = animals.tickResources;
    animals.tickResources = function nurseryTickResources(...args) {
      return withOutdoorAdultSentinel(originalTickResources, args);
    };

    originalTickHearts = animals.tickHearts;
    animals.tickHearts = function nurseryTickHearts(...args) {
      return withOutdoorAdultSentinel(originalTickHearts, args);
    };

    originalResolveBreedingParent = animals.resolveBreedingParent;
    animals.resolveBreedingParent = function nurseryResolveBreedingParent(ref, worldLivestock, stableCache) {
      const parent = originalResolveBreedingParent.call(this, ref, worldLivestock, stableCache);
      if (ref?.source === 'world' && parent && isBaby(parent)) return null;
      return parent;
    };

    originalTickBreedingProgress = animals.tickBreedingProgress;
    animals.tickBreedingProgress = function nurseryTickBreedingProgress(...args) {
      normalizeLifeStages();
      sanitizeBreedingPairs();
      const before = new Set(currentLivestock().map(entry => entry.id));
      const savedToast = animalDeps.showToast;
      if (typeof savedToast === 'function') {
        animalDeps.showToast = (message, ok) => savedToast(
          String(message).replace(/It's waiting in stasis until you assign it to a barn\./i, 'It is safe in the Nursery until you choose Grow Up.'), ok);
      }
      try {
        return originalTickBreedingProgress.apply(this, args);
      } finally {
        animalDeps.showToast = savedToast;
        const list = currentLivestock();
        let changed = false;
        for (const entry of list) {
          if (before.has(entry.id)) continue;
          entry.lifeStage = 'baby';
          entry.barnId = null;
          entry.troughIndex = null;
          entry.assignedVatId = null;
          changed = true;
        }
        if (changed) animalDeps.saveWorldLivestock?.(list);
        queuePanelDecoration();
      }
    };

    originalSpawnBuildingEntry = buildings.spawnEntry;
    buildings.spawnEntry = function nurserySpawnBuildingEntry(entry, ...args) {
      if (isNurseryBuilding(entry)) {
        entry.id = NURSERY_ID;
        entry.nursery = true;
        entry.protected = true;
        entry.tier = NURSERY_TIER;
      }
      const result = originalSpawnBuildingEntry.call(this, entry, ...args);
      if (isNurseryBuilding(entry)) patchNurseryWorldObject(entry);
      return result;
    };

    originalDemolishBuilding = buildings.demolish;
    buildings.demolish = function nurseryDemolishBuilding(id, ...args) {
      const entry = (buildingDeps?.getFarmBuildings?.() || []).find(building => building.id === id);
      if (isNurseryBuilding(entry) || id === NURSERY_ID) {
        return { ok: false, message: 'The Nursery comes with the farm and cannot be demolished. You can move it instead.' };
      }
      const occupants = currentLivestock().filter(animal => animal.barnId === id).map(animal => animal.id);
      occupants.forEach(livestockId => window.FarmAnimals.unassignFromBarn(livestockId));
      const result = originalDemolishBuilding.call(this, id, ...args);
      if (result?.ok && occupants.length) {
        result.message = 'Barn demolished. Its adults are now roaming outside and will lose happiness nightly until housed.';
      }
      queuePanelDecoration();
      return result;
    };

    originalSynthesizeBarnInterior = troughs.synthesizeBarnInteriorMapData;
    troughs.synthesizeBarnInteriorMapData = function nurserySynthesizeBarnInterior(mapId, ...args) {
      if (mapId === NURSERY_MAP_ID) {
        startSwarmLoop();
        return nurseryInteriorMap();
      }
      return originalSynthesizeBarnInterior.call(this, mapId, ...args);
    };

    originalPanelRender = panel.render;
    panel.render = function nurseryPanelRender(...args) {
      ensureNurseryBuilding();
      normalizeLifeStages();
      const result = originalPanelRender.apply(this, args);
      queuePanelDecoration();
      return result;
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installPanelObserver, { once: true });
    else installPanelObserver();
    return true;
  }

  window.LivestockNursery = {
    install: installHooks,
    ensureBuilding: ensureNurseryBuilding,
    growBaby,
    isBaby,
    adultCount,
    adultCapacity,
    rerollSwarm,
    debugSnapshot,
    constants: {
      NURSERY_ID, NURSERY_MAP_ID, NURSERY_VISIBLE_LIMIT,
      BABY_SCALE, BABY_SPEED_MULTIPLIER, TURN_MIN_SEC, TURN_MAX_SEC,
      HOP_MIN_HZ, HOP_MAX_HZ,
    },
  };
  window.__nurseryDebug = {
    snapshot: debugSnapshot,
    reroll: rerollSwarm,
    ensureBuilding: ensureNurseryBuilding,
  };

  installHooks();
})();