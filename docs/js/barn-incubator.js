(() => {
  'use strict';
  if (window.BarnIncubator) return;

  const CONFIG = window.BARN_INCUBATOR_CONFIG; // Used as the single runtime/editor tuning source for incubators.
  const GROWTH = window.ANIMAL_GROWTH_CONFIG; // Used to share baby/adult stage IDs with the Growth Tonic feature.
  if (!CONFIG?.addition?.id || !CONFIG?.gameplay?.slots || !GROWTH?.stages?.baby) {
    throw new Error('BARN_INCUBATOR_CONFIG and ANIMAL_GROWTH_CONFIG must load before barn-incubator.js');
  }

  let buildingDeps = null; // Captures FarmBuildings' farm-grid/building/render persistence seam.
  let animalDeps = null; // Captures FarmAnimals' livestock/trough/save seam.
  let troughDeps = null; // Captures FarmTroughs' current-area/interior-map seam.
  let panelDeps = null; // Captures FarmPanel's inventory/UI/Stable-compatible dependency seam.
  let carpenterDeps = null; // Captures CarpenterShop's wallet/inventory UI seam.
  let installed = false; // Keeps all public wrappers idempotent.
  let state = null; // Holds this world's serialized barn-addition/incubation state.
  let selectedBarnId = null; // Identifies the barn currently open in the Barn Layout editor.
  let selectedAdditionId = null; // Identifies the selected incubator piece in that editor.
  let editorMode = null; // 'place'|'move' while the next canvas tap should reposition a piece.
  let managementAdditionId = null; // Identifies the incubator whose 3 maturation slots are being managed.
  let interiorSyncTimer = null; // Periodically reconciles visible sleeping babies in loaded barn interiors.
  let piecePromise = null; // Caches the authored incubator exterior piece JSON.
  let furniturePromise = null; // Caches the authored incubator crib JSON + animal anchors.
  let allowReservedTroughKey = null; // Temporarily permits completion into the slot's own reserved trough.
  let lastDebugChange = 'Incubator system loaded.'; // Mobile-visible most recent lifecycle/debug change.

  const exteriorMeshes = new Map(); // additionId -> THREE.Group for live farm exterior additions.
  const exteriorObjects = new Map(); // additionId -> one interactable footprint object registered across its tiles.
  const sleepingBabies = new Map(); // `${additionId}:${slot}` -> temporary barn-interior avatar ref.

  const original = { // Stores wrapped API functions so existing systems remain authoritative underneath.
    buildingInit: null, spawnEntry: null, moveBarn: null, demolishBarn: null, clearBuildings: null,
    animalInit: null, assignToBarn: null, assignToTrough: null, tickHearts: null,
    troughInit: null, synthesizeBarnInterior: null,
    panelInit: null, panelRender: null,
    carpenterInit: null, carpenterRender: null,
  };

  const deepClone = value => JSON.parse(JSON.stringify(value)); // Used only for JSON-shaped saved records and authored piece variants.
  const troughKey = (barnId, troughIndex) => `${barnId}:${Number(troughIndex)}`; // Canonical reservation identity shared by all trough gates.

  function worldId() {
    const profile = window.__hobunjiPlayerProfile || buildingDeps?.getPlayerData?.() || panelDeps?.getPlayerData?.(); // Used to namespace incubator saves per world.
    return profile?.worldId || 'legacy';
  }

  function storageKey() {
    return `${CONFIG.persistence.key}:${worldId()}`; // Used by localStorage so separate worlds never share incubators.
  }

  function freshState() {
    return { version: CONFIG.persistence.version, barns: {} }; // Used whenever no compatible persisted incubator state exists.
  }

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey()) || 'null'); // Used to restore additions and in-flight babies for the active world.
      state = parsed?.version === CONFIG.persistence.version && parsed.barns ? parsed : freshState();
    } catch (_) {
      state = freshState();
    }
    return state;
  }

  function saveState(reason = null) {
    if (!state) loadState();
    localStorage.setItem(storageKey(), JSON.stringify(state));
    if (reason) lastDebugChange = reason;
    buildingDeps?.saveMemberWorldData?.();
  }

  function barnState(barnId, create = true) {
    if (!state) loadState();
    if (!state.barns[barnId] && create) state.barns[barnId] = { additions: [] };
    return state.barns[barnId] || null;
  }

  function additionsForBarn(barnId) {
    return barnState(barnId, false)?.additions || []; // Used by rendering, layout, maturation, and trough reservation queries.
  }

  function allAdditions() {
    if (!state) loadState();
    return Object.values(state.barns || {}).flatMap(entry => entry.additions || []); // Used by global reservation and debug scans.
  }

  function additionById(additionId) {
    return allAdditions().find(entry => entry.id === additionId) || null; // Used by management/editor actions that start from an addition id.
  }

  function owningBarnOfAddition(additionId) {
    return regularBarns().find(barn => additionsForBarn(barn.id).some(entry => entry.id === additionId)) || null; // Used to locate an addition's barn.
  }

  function regularBarns() {
    const tiers = buildingDeps?.getBarnTiers?.() || {}; // Used to exclude the free Nursery pseudo-tier from editable barns.
    return (buildingDeps?.getFarmBuildings?.() || []).filter(barn =>
      barn?.kind === 'barn' && barn.stage === 'built' && tiers[barn.tier]?.slots > 0 && !barn.nursery);
  }

  function barnById(barnId) {
    return regularBarns().find(barn => barn.id === barnId) || null; // Used by every placement/trough/interior operation.
  }

  function stockDefinition() {
    return window.LootRolling?.getShopStock?.()?.carpenterBarnPlans?.additions?.[CONFIG.addition.id] || null; // Price/plan identity stays authored in shop-stock.json.
  }

  function planItemKey() {
    return stockDefinition()?.planItem || null; // Used for purchases and placement inventory without a duplicate hard-coded item ID.
  }

  function ensurePlanItemDef() {
    const deps = carpenterDeps || panelDeps || animalDeps; // Used to register the purchased plan in whichever initialized UI seam is available.
    const definition = stockDefinition(); // Used as the authored label/description source.
    const key = planItemKey(); // Used as the actual inventory stack key.
    if (!deps?.ITEM_DEFS || !definition || !key || deps.ITEM_DEFS[key]) return key;
    deps.ITEM_DEFS[key] = {
      icon: definition.icon || '🪺',
      label: definition.label || CONFIG.addition.label,
      cat: 'processed',
      sellPrice: 0,
      tags: ['Building Plan', 'Barn Addition'],
      desc: definition.desc || 'A modular addition installed against a barn wall.',
    };
    return key;
  }

  function ensureFurnitureDef() {
    const defs = panelDeps?.DECORATIVE_FURNITURE_DEFS; // Used by interior-scene furniture lookup for the authored crib.
    if (!defs || defs[CONFIG.interior.furnitureKey]) return;
    defs[CONFIG.interior.furnitureKey] = {
      name: 'Incubator Crib',
      icon: '🪺',
      fw: 5,
      fd: 2,
      procKey: CONFIG.interior.furnitureAuthoredKey,
      desc: 'A fenced nest with three authored sleeping-animal attachment points.',
    };
  }

  function makeSlots() {
    return Array.from({ length: CONFIG.gameplay.slots }, (_, index) => ({
      index,
      troughBarnId: null,
      troughIndex: null,
      baby: null,
      daysRemaining: null,
      blockedReason: null,
    })); // Used when a newly placed incubator receives its three independent maturation slots.
  }

  function normalizeAddition(addition) {
    if (!addition || addition.type !== CONFIG.addition.id) return addition;
    if (!Array.isArray(addition.slots)) addition.slots = makeSlots();
    while (addition.slots.length < CONFIG.gameplay.slots) addition.slots.push(makeSlots()[addition.slots.length]);
    if (addition.slots.length > CONFIG.gameplay.slots) addition.slots.length = CONFIG.gameplay.slots;
    addition.slots.forEach((slot, index) => {
      slot.index = index;
      if (!Object.prototype.hasOwnProperty.call(slot, 'troughBarnId')) slot.troughBarnId = null;
      if (!Object.prototype.hasOwnProperty.call(slot, 'troughIndex')) slot.troughIndex = null;
      if (!Object.prototype.hasOwnProperty.call(slot, 'baby')) slot.baby = null;
      if (!Object.prototype.hasOwnProperty.call(slot, 'daysRemaining')) slot.daysRemaining = null;
    });
    return addition;
  }

  function normalizeState() {
    if (!state) loadState();
    for (const barnEntry of Object.values(state.barns || {})) {
      for (const addition of barnEntry.additions || []) normalizeAddition(addition);
    }
  }

  function candidatePlacementsForBarn(barn) {
    if (!barn) return [];
    const footprint = CONFIG.addition.canonicalFootprint; // Used to generate every full-long-edge attachment position.
    const out = []; // Returned to editor hit-testing and validation.
    for (let localCol = 0; localCol <= barn.w - footprint.w; localCol++) {
      out.push({ side: 'north', localCol, localRow: -footprint.h, w: footprint.w, h: footprint.h, rotY: 0 });
      out.push({ side: 'south', localCol, localRow: barn.h, w: footprint.w, h: footprint.h, rotY: 180 });
    }
    for (let localRow = 0; localRow <= barn.h - footprint.w; localRow++) {
      out.push({ side: 'west', localCol: -footprint.h, localRow, w: footprint.h, h: footprint.w, rotY: 90 });
      out.push({ side: 'east', localCol: barn.w, localRow, w: footprint.h, h: footprint.w, rotY: 270 });
    }
    return out;
  }

  function rectOverlap(a, b) {
    return a.col < b.col + b.w && a.col + a.w > b.col && a.row < b.row + b.h && a.row + a.h > b.row; // Used to reject overlapping barn additions.
  }

  function absoluteRect(barn, placement) {
    return { col: barn.col + placement.localCol, row: barn.row + placement.localRow, w: placement.w, h: placement.h }; // Converts saved barn-local placement to farm-grid coordinates.
  }

  function unregisterAdditionObject(additionId) {
    const object = exteriorObjects.get(additionId); // Used to free every tile owned by one addition before moving/rebuilding it.
    if (!object || !buildingDeps?.worldObjects) return;
    for (const key of object.__keys || []) {
      if (buildingDeps.worldObjects.get(key) === object) buildingDeps.worldObjects.delete(key);
    }
    exteriorObjects.delete(additionId);
  }

  function disposeExteriorMesh(additionId) {
    const mesh = exteriorMeshes.get(additionId); // Used to release the prior authored addition mesh before rebuilding.
    if (!mesh) return;
    buildingDeps?.scene?.remove?.(mesh);
    mesh.traverse?.(child => {
      child.geometry?.dispose?.();
      if (Array.isArray(child.material)) child.material.forEach(material => material?.dispose?.());
      else child.material?.dispose?.();
    });
    exteriorMeshes.delete(additionId);
  }

  function unregisterAllAdditionObjects() {
    for (const additionId of [...exteriorObjects.keys()]) unregisterAdditionObject(additionId); // Used around core barn moves so its occupancy test sees only structural buildings.
  }

  function registerAllAdditionObjects() {
    for (const barn of regularBarns()) {
      for (const addition of additionsForBarn(barn.id)) {
        if (!exteriorObjects.has(addition.id)) registerAdditionObject(barn, addition);
      }
    }
  }

  function validatePlacement(barn, placement, ignoreAdditionId = null) {
    if (!barn || !placement) return { ok: false, message: 'Choose a built barn and an attachment wall.' };
    const rect = absoluteRect(barn, placement); // Used for FarmBuildings' existing hazard/building/house collision gate.
    const siblings = additionsForBarn(barn.id).filter(entry => entry.id !== ignoreAdditionId); // Used to prevent same-barn addition overlap.
    if (siblings.some(entry => rectOverlap(rect, absoluteRect(barn, entry)))) return { ok: false, message: 'That barn addition would overlap another addition.' };
    unregisterAllAdditionObjects();
    let clear = false; // Records the authoritative existing FarmBuildings placement result.
    try {
      clear = !!window.FarmBuildings?.canPlaceAt?.(rect.col, rect.row, rect.w, rect.h, barn.id);
    } finally {
      registerAllAdditionObjects();
    }
    return clear ? { ok: true, rect } : { ok: false, message: 'That wall position is blocked by terrain, a building, furniture, or the farmhouse.' };
  }

  function closestCandidate(barn, col, row, ignoreAdditionId = null) {
    const candidates = candidatePlacementsForBarn(barn); // Used to snap a mobile/desktop canvas tap to the nearest valid wall-flush 3×1 placement.
    const scored = candidates.map(candidate => {
      const rect = absoluteRect(barn, candidate); // Used only for center-distance scoring.
      const distance = Math.hypot(col - (rect.col + rect.w / 2), row - (rect.row + rect.h / 2)); // Used to choose the most intuitive wall slot.
      return { candidate, distance };
    }).sort((a, b) => a.distance - b.distance);
    for (const entry of scored) {
      if (validatePlacement(barn, entry.candidate, ignoreAdditionId).ok) return entry.candidate;
    }
    return null;
  }

  function placeIncubator(barnId, placement) {
    const barn = barnById(barnId); // Target barn for the purchased room.
    if (!barn) return { ok: false, message: 'Built barn not found.' };
    if (additionsForBarn(barnId).filter(entry => entry.type === CONFIG.addition.id).length >= CONFIG.addition.maxPerBarn) {
      return { ok: false, message: `This barn already has its ${CONFIG.addition.label}.` };
    }
    const key = ensurePlanItemDef(); // Purchased plan consumed only after placement validation succeeds.
    const inventory = (panelDeps || carpenterDeps || animalDeps)?.inventory; // Used to debit the player's plan stack.
    if (!key || !inventory || (inventory[key] || 0) < 1) return { ok: false, message: `You need a purchased ${CONFIG.addition.label} plan.` };
    const valid = validatePlacement(barn, placement); // Existing farm collision rules remain authoritative.
    if (!valid.ok) return valid;
    const addition = normalizeAddition({
      id: `barn_incubator_${Math.random().toString(36).slice(2, 10)}`,
      type: CONFIG.addition.id,
      localCol: placement.localCol,
      localRow: placement.localRow,
      w: placement.w,
      h: placement.h,
      side: placement.side,
      rotY: placement.rotY,
      slots: makeSlots(),
    }); // Persisted barn-local geometry makes the addition follow future barn moves automatically.
    barnState(barnId).additions.push(addition);
    inventory[key]--;
    (panelDeps || carpenterDeps || animalDeps)?.clampInventoryStack?.(key);
    saveState(`Placed ${CONFIG.addition.label} on ${barnId}.`);
    rebuildExteriorAll();
    refreshAllUi();
    return { ok: true, addition, message: `Installed ${CONFIG.addition.label}.` };
  }

  function moveIncubator(additionId, placement) {
    const barn = owningBarnOfAddition(additionId); // Barn whose local coordinate system owns the piece.
    const addition = additionById(additionId); // Existing addition being moved.
    if (!barn || !addition) return { ok: false, message: 'Incubator addition not found.' };
    const valid = validatePlacement(barn, placement, additionId); // Reuses the same farm collision rules as first placement.
    if (!valid.ok) return valid;
    Object.assign(addition, {
      localCol: placement.localCol, localRow: placement.localRow, w: placement.w, h: placement.h,
      side: placement.side, rotY: placement.rotY,
    });
    saveState(`Moved ${CONFIG.addition.label} on ${barn.id}.`);
    rebuildExteriorAll();
    refreshAllUi();
    return { ok: true, message: `Moved ${CONFIG.addition.label}.` };
  }

  function additionHasBaby(addition) {
    return !!addition?.slots?.some(slot => slot.baby); // Used to block destructive layout changes during maturation.
  }

  function removeIncubator(additionId, refund = true) {
    const barn = owningBarnOfAddition(additionId); // Barn containing the room being removed.
    const addition = additionById(additionId); // Addition checked for active babies before removal.
    if (!barn || !addition) return { ok: false, message: 'Incubator addition not found.' };
    if (additionHasBaby(addition)) return { ok: false, message: 'Move or finish every maturing baby before removing the incubator.' };
    barnState(barn.id).additions = additionsForBarn(barn.id).filter(entry => entry.id !== additionId);
    if (refund) {
      const key = ensurePlanItemDef(); // Returned to inventory just like relocating a reusable farmhouse room deed.
      const inventory = (panelDeps || carpenterDeps || animalDeps)?.inventory; // Receives the recovered addition plan.
      if (key && inventory) inventory[key] = Math.min(9, (inventory[key] || 0) + 1);
    }
    unregisterAdditionObject(additionId);
    disposeExteriorMesh(additionId);
    saveState(`Removed ${CONFIG.addition.label} from ${barn.id}.`);
    refreshAllUi();
    return { ok: true, message: `${CONFIG.addition.label} removed${refund ? ' and its plan was returned' : ''}.` };
  }

  function loadPiece() {
    if (!piecePromise) piecePromise = fetch(CONFIG.addition.pieceFile).then(response => {
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return response.json();
    }).catch(error => {
      piecePromise = null;
      console.warn('[BarnIncubator] piece load failed:', error);
      return null;
    }); // Cached repo-authored exterior piece.
    return piecePromise;
  }

  function rotatedVerticalPiece(source) {
    const piece = deepClone(source); // Rotated clone keeps the canonical repo piece editable as 3×1.
    const floor = piece.base?.faces?.find(face => face.tag === 'floor'); // Used to find the authored piece center for quarter-turning every vertex.
    const points = floor?.v || []; // Floor corners bound the whole canonical rectangle.
    const cx = points.reduce((sum, point) => sum + point[0], 0) / Math.max(1, points.length); // Rotation pivot X.
    const cz = points.reduce((sum, point) => sum + point[2], 0) / Math.max(1, points.length); // Rotation pivot Z.
    for (const face of piece.base?.faces || []) {
      face.v = face.v.map(([x, y, z]) => [cx + (z - cz), y, cz - (x - cx)]);
    }
    const cells = piece.footprint?.cells || []; // Used only so buildGroupFromPiece resolves the rotated 1×3 authored footprint.
    if (cells.length) {
      const minX = Math.min(...cells.map(cell => cell.x)); // Canonical grid origin X.
      const minY = Math.min(...cells.map(cell => cell.y)); // Canonical grid origin Y.
      const width = Math.max(...cells.map(cell => cell.x)) - minX + 1; // Canonical long dimension.
      piece.footprint.cells = cells.map(cell => ({ x: minX + (cell.y - minY), y: minY + (width - 1 - (cell.x - minX)) }));
    }
    for (const section of piece.roof?.crossGableSections || []) section.axis = section.axis === 'x' ? 'z' : 'x';
    return piece;
  }

  function registerAdditionObject(barn, addition) {
    if (!buildingDeps?.worldObjects) return;
    const rect = absoluteRect(barn, addition); // Farm-grid tiles reserved by the addition.
    const object = {
      id: addition.id,
      type: 'barn_addition',
      kind: CONFIG.addition.id,
      col: rect.col,
      row: rect.row,
      __keys: [],
      get label() { return `🪺 ${CONFIG.addition.label}`; },
      getButtons() {
        return [
          { icon: '🪺', label: 'Manage Incubator', action: `obj_incubator_manage_${addition.id}`, style: 'primary', allowed: true },
          { icon: '🏚', label: 'Edit Barn Layout', action: `obj_incubator_layout_${addition.id}`, style: 'secondary', allowed: true },
        ];
      },
      onAction(action) {
        if (action === `obj_incubator_manage_${addition.id}`) {
          openIncubatorMenu(addition.id);
          return { ok: true, message: 'Opened incubator.' };
        }
        if (action === `obj_incubator_layout_${addition.id}`) {
          openBarnEditor(barn.id);
          return { ok: true, message: 'Opened barn layout.' };
        }
        return { ok: false, message: 'Unknown incubator action.' };
      },
    }; // One object is registered across the whole 3×1 footprint so reticle interaction works from any tile.
    for (let row = rect.row; row < rect.row + rect.h; row++) {
      for (let col = rect.col; col < rect.col + rect.w; col++) {
        const key = `${col},${row}`; // Registered farm worldObjects coordinate.
        if (!buildingDeps.worldObjects.get(key)) {
          buildingDeps.worldObjects.set(key, object);
          object.__keys.push(key);
        }
      }
    }
    exteriorObjects.set(addition.id, object);
  }

  async function rebuildAdditionExterior(barn, addition) {
    unregisterAdditionObject(addition.id);
    disposeExteriorMesh(addition.id);
    registerAdditionObject(barn, addition);
    if (typeof THREE === 'undefined' || !window.HousePieceGen || !buildingDeps?.scene) return;
    const source = await loadPiece(); // Repo-authored 3×1 Highland room with the lowered ridge.
    if (!source || !additionById(addition.id)) return;
    const piece = addition.w < addition.h ? rotatedVerticalPiece(source) : source; // East/west attachments use the same authored piece quarter-turned.
    const rect = absoluteRect(barn, addition); // World top-left consumed by HousePieceGen.
    try {
      const mesh = window.HousePieceGen.buildGroupFromPiece(THREE, piece, rect.col, rect.row, {
        wallBuilder: buildingDeps.houseWallBuilder || null,
        wbUsePlaceholder: true,
        wbOpts: { unitMult: 0.4375, rockScale: 1.5, preScale: [1, 1, 0.6], brickJitter: { rotYDeg: 8, shiftU: 0.04, shiftV: 0.03 } },
      }); // Uses the same renderer as authored barns/house pieces.
      if (!mesh) return;
      mesh.userData.barnAdditionId = addition.id;
      buildingDeps.scene.add(mesh);
      exteriorMeshes.set(addition.id, mesh);
    } catch (error) {
      console.warn('[BarnIncubator] exterior build failed:', error);
    }
  }

  function rebuildExteriorAll() {
    for (const id of [...exteriorObjects.keys()]) unregisterAdditionObject(id);
    for (const id of [...exteriorMeshes.keys()]) disposeExteriorMesh(id);
    normalizeState();
    for (const barn of regularBarns()) {
      for (const addition of additionsForBarn(barn.id)) rebuildAdditionExterior(barn, addition);
    }
  }

  function reservedTroughMap() {
    const map = new Map(); // troughKey -> slot descriptor used by all animal-assignment guards.
    for (const addition of allAdditions()) {
      for (const slot of addition.slots || []) {
        if (!slot.troughBarnId || slot.troughIndex == null) continue;
        map.set(troughKey(slot.troughBarnId, slot.troughIndex), { additionId: addition.id, slotIndex: slot.index, baby: slot.baby });
      }
    }
    return map;
  }

  function livestockList() {
    return animalDeps?.loadWorldLivestock?.() || []; // Shared read of current farm livestock.
  }

  function troughsForBarn(barn) {
    return window.FarmAnimals?.ensureBarnTroughs?.(barn) || []; // Existing FarmAnimals trough array remains authoritative.
  }

  function troughOccupied(barnId, index, ignoreLivestockId = null) {
    return livestockList().some(entry => entry.id !== ignoreLivestockId && entry.barnId === barnId && Number(entry.troughIndex) === Number(index)); // Used by reservations and completion.
  }

  function troughAvailable(barnId, index, options = {}) {
    const barn = barnById(barnId); // Target regular built barn.
    if (!barn || !troughsForBarn(barn)[index]) return false;
    if (troughOccupied(barnId, index, options.ignoreLivestockId || null)) return false;
    const reserved = reservedTroughMap().get(troughKey(barnId, index)); // Existing incubator reservation, if any.
    if (reserved && !(reserved.additionId === options.additionId && reserved.slotIndex === options.slotIndex)) return false;
    return true;
  }

  function availableTroughsForSlot(additionId, slotIndex) {
    const result = []; // Used to populate each slot's advance-assignment dropdown.
    for (const barn of regularBarns()) {
      troughsForBarn(barn).forEach((trough, index) => {
        if (troughAvailable(barn.id, index, { additionId, slotIndex })) {
          result.push({ barnId: barn.id, troughIndex: index, barn, trough, filled: trough?.slots?.filter(Boolean).length || 0 });
        }
      });
    }
    return result;
  }

  function reserveTrough(additionId, slotIndex, barnId, index) {
    const addition = additionById(additionId); // Incubator owning the requested slot.
    const slot = addition?.slots?.[slotIndex]; // Slot whose future adult destination is being set.
    if (!addition || !slot) return { ok: false, message: 'Incubator slot not found.' };
    if (slot.baby) return { ok: false, message: 'That slot is already maturing a baby; its trough cannot change.' };
    if (!barnId || index == null || index === '') {
      slot.troughBarnId = null;
      slot.troughIndex = null;
      saveState(`Cleared trough reservation for ${additionId} slot ${slotIndex + 1}.`);
      refreshManagement();
      return { ok: true, message: 'Trough reservation cleared.' };
    }
    const numericIndex = Number(index); // Normalized select value used by trough lookup.
    if (!troughAvailable(barnId, numericIndex, { additionId, slotIndex })) return { ok: false, message: 'That trough is already assigned or reserved.' };
    slot.troughBarnId = barnId;
    slot.troughIndex = numericIndex;
    saveState(`Reserved ${barnId} trough ${numericIndex + 1} for ${additionId} slot ${slotIndex + 1}.`);
    refreshManagement();
    return { ok: true, message: `Reserved trough ${numericIndex + 1}.` };
  }

  function isFarmBaby(entry) {
    return !!entry && (window.LivestockNursery?.isBaby?.(entry) || entry.lifeStage === GROWTH.stages.baby); // Uses the existing Nursery age rule with config fallback.
  }

  function nurseryBabies() {
    return livestockList().filter(isFarmBaby); // Incubating babies are absent from this list because their full records live inside slots.
  }

  function cleanupBreedingRefs(livestockId) {
    const load = animalDeps?._loadWorldBreedingPairs; // Existing farm breeding-pair loader used to remove a baby while it is unavailable.
    const save = animalDeps?._saveWorldBreedingPairs; // Existing matching saver.
    if (typeof load !== 'function' || typeof save !== 'function') return;
    const pairs = load(); // Current breeding pairs possibly referencing this world livestock ID.
    const clean = (pairs || []).filter(pair => !(
      (pair?.parentA?.source === 'world' && pair.parentA.id === livestockId) ||
      (pair?.parentB?.source === 'world' && pair.parentB.id === livestockId)
    ));
    if (clean.length !== (pairs || []).length) save(clean);
  }

  function startMaturation(additionId, slotIndex, babyId) {
    const addition = additionById(additionId); // Incubator holding the selected slot.
    const slot = addition?.slots?.[slotIndex]; // Target one of the three maturation slots.
    if (!addition || !slot) return { ok: false, message: 'Incubator slot not found.' };
    if (slot.baby) return { ok: false, message: 'That incubator slot is already occupied.' };
    if (!slot.troughBarnId || slot.troughIndex == null) return { ok: false, message: 'Assign an unused barn trough to this slot first.' };
    if (!troughAvailable(slot.troughBarnId, slot.troughIndex, { additionId, slotIndex })) return { ok: false, message: 'The reserved trough is no longer available.' };
    const list = livestockList(); // Nursery list from which the selected baby is physically moved into the incubator state.
    const index = list.findIndex(entry => entry.id === babyId && isFarmBaby(entry)); // Exact baby record location.
    if (index < 0) return { ok: false, message: 'That Nursery baby is no longer available.' };
    const [baby] = list.splice(index, 1); // Full genetics/name record retained verbatim in the slot.
    animalDeps?.saveWorldLivestock?.(list);
    cleanupBreedingRefs(baby.id);
    slot.baby = deepClone(baby);
    slot.daysRemaining = CONFIG.gameplay.maturationDays;
    slot.blockedReason = null;
    saveState(`Started incubating ${baby.name || baby.id} in ${additionId} slot ${slotIndex + 1}.`);
    window.FarmPanel?.render?.();
    refreshManagement();
    syncSleepingBabies(true);
    return { ok: true, message: `${baby.name || 'Baby'} is maturing for ${CONFIG.gameplay.maturationDays} days.`, baby: slot.baby };
  }

  function cancelMaturation(additionId, slotIndex) {
    const addition = additionById(additionId); // Incubator owning the active baby.
    const slot = addition?.slots?.[slotIndex]; // Slot being canceled.
    if (!slot?.baby) return { ok: false, message: 'That slot is empty.' };
    const list = livestockList(); // Nursery/world list receiving the baby again.
    if (!list.some(entry => entry.id === slot.baby.id)) list.push(deepClone(slot.baby));
    animalDeps?.saveWorldLivestock?.(list);
    const name = slot.baby.name || 'Baby'; // Used in feedback before clearing the slot.
    slot.baby = null;
    slot.daysRemaining = null;
    slot.blockedReason = null;
    saveState(`Canceled incubation for ${name}.`);
    window.FarmPanel?.render?.();
    refreshManagement();
    syncSleepingBabies(true);
    return { ok: true, message: `${name} returned to the Nursery. The trough remains reserved.` };
  }

  function completeSlot(addition, slot) {
    if (!slot?.baby || !slot.troughBarnId || slot.troughIndex == null) return { ok: false, message: 'Incomplete incubator slot.' };
    if (!troughAvailable(slot.troughBarnId, slot.troughIndex, { additionId: addition.id, slotIndex: slot.index })) {
      slot.blockedReason = 'Reserved trough became unavailable.';
      return { ok: false, message: slot.blockedReason };
    }
    const baby = deepClone(slot.baby); // Full baby record converted into an adult without consuming Growth Tonic.
    baby.lifeStage = GROWTH.stages.adult;
    baby.barnId = null;
    baby.troughIndex = null;
    baby.assignedVatId = null;
    const list = livestockList(); // World livestock list receiving the mature animal before existing barn assignment APIs run.
    if (!list.some(entry => entry.id === baby.id)) list.push(baby);
    animalDeps?.saveWorldLivestock?.(list);

    const targetKey = troughKey(slot.troughBarnId, slot.troughIndex); // Temporary exception key during completion.
    allowReservedTroughKey = targetKey;
    const assignBarn = original.assignToBarn || window.FarmAnimals?.assignToBarn; // Underlying Nursery-aware barn assignment.
    const assignTrough = original.assignToTrough || window.FarmAnimals?.assignToTrough; // Underlying explicit trough assignment.
    let barnResult = null; // Captures completion housing result for rollback.
    try {
      barnResult = assignBarn?.call(window.FarmAnimals, baby.id, slot.troughBarnId);
      if (!barnResult?.ok) throw new Error(barnResult?.message || 'Could not house the matured animal.');
      const troughResult = assignTrough?.call(window.FarmAnimals, baby.id, slot.troughIndex); // Moves from auto-picked trough to the pre-reserved one if necessary.
      if (!troughResult?.ok) throw new Error(troughResult?.message || 'Could not assign the reserved trough.');
    } catch (error) {
      const rollback = livestockList(); // World record removed again so the baby stays safe inside the incubator.
      const rollbackIndex = rollback.findIndex(entry => entry.id === baby.id);
      if (rollbackIndex >= 0) rollback.splice(rollbackIndex, 1);
      animalDeps?.saveWorldLivestock?.(rollback);
      slot.blockedReason = error?.message || String(error);
      allowReservedTroughKey = null;
      return { ok: false, message: slot.blockedReason };
    }
    allowReservedTroughKey = null;
    const name = baby.name || 'Animal'; // Completion feedback before clearing the stored baby record.
    slot.baby = null;
    slot.daysRemaining = null;
    slot.blockedReason = null;
    slot.troughBarnId = null;
    slot.troughIndex = null; // The newly adult animal now occupies that trough, so this incubator slot must reserve another unused one next time.
    return { ok: true, message: `${name} matured and moved into its reserved barn trough.` };
  }

  function advanceMaturationDay() {
    normalizeState();
    const completed = []; // Successful maturation messages returned for diagnostics/tests.
    const blocked = []; // Failed ready-slot messages retained for diagnostics.
    for (const addition of allAdditions()) {
      for (const slot of addition.slots || []) {
        if (!slot.baby) continue;
        slot.daysRemaining = Math.max(0, Number(slot.daysRemaining ?? CONFIG.gameplay.maturationDays) - 1);
        if (slot.daysRemaining > 0) continue;
        const result = completeSlot(addition, slot); // Reuses existing FarmAnimals barn/trough placement at the end of the timer.
        (result.ok ? completed : blocked).push(result.message);
      }
    }
    saveState(`Incubator day advanced: ${completed.length} matured, ${blocked.length} blocked.`);
    if (completed.length) animalDeps?.showToast?.(`🪺 ${completed.join(' ')}`, true);
    refreshAllUi();
    syncSleepingBabies(true);
    return { completed, blocked };
  }

  function wrapFarmAnimals(api) {
    if (!api || api.__barnIncubatorWrapped) return !!api;
    api.__barnIncubatorWrapped = true;

    original.animalInit = api.init; // Captured to obtain FarmAnimals' injected data seam.
    if (typeof original.animalInit === 'function') {
      api.init = function incubatorAnimalInit(injectedDeps, ...args) {
        const result = original.animalInit.call(this, injectedDeps, ...args);
        animalDeps = injectedDeps;
        normalizeState();
        ensurePlanItemDef();
        return result;
      };
    }

    original.assignToBarn = api.assignToBarn; // Captured so ordinary housing can avoid incubator-reserved troughs.
    if (typeof original.assignToBarn === 'function') {
      api.assignToBarn = function incubatorAwareAssignToBarn(livestockId, barnId, ...args) {
        const barn = barnById(barnId); // Target barn whose trough reservations are checked before normal assignment.
        if (barn && allowReservedTroughKey == null) {
          const available = troughsForBarn(barn).some((trough, index) =>
            !reservedTroughMap().has(troughKey(barn.id, index)) && !troughOccupied(barn.id, index, livestockId));
          if (!available) return { ok: false, message: 'Every open trough in that barn is reserved for an incubator.' };
        }
        const result = original.assignToBarn.call(this, livestockId, barnId, ...args);
        if (!result?.ok || allowReservedTroughKey != null) return result;
        const record = livestockList().find(entry => entry.id === livestockId); // Existing assignment may have auto-picked a reserved trough.
        if (!record || !reservedTroughMap().has(troughKey(record.barnId, record.troughIndex))) return result;
        const alternate = troughsForBarn(barn).findIndex((trough, index) =>
          !reservedTroughMap().has(troughKey(barn.id, index)) && !troughOccupied(barn.id, index, livestockId));
        if (alternate >= 0 && typeof original.assignToTrough === 'function') original.assignToTrough.call(this, livestockId, alternate);
        return result;
      };
    }

    original.assignToTrough = api.assignToTrough; // Captured to gate explicit dropdown reassignments.
    if (typeof original.assignToTrough === 'function') {
      api.assignToTrough = function incubatorAwareAssignToTrough(livestockId, troughIndex, ...args) {
        const record = livestockList().find(entry => entry.id === livestockId); // Current barn determines reservation key.
        const key = record?.barnId && troughIndex != null ? troughKey(record.barnId, troughIndex) : null; // Proposed reserved destination.
        if (key && key !== allowReservedTroughKey && reservedTroughMap().has(key)) {
          return { ok: false, message: 'That trough is reserved for a maturing incubator baby.' };
        }
        return original.assignToTrough.call(this, livestockId, troughIndex, ...args);
      };
    }

    original.tickHearts = api.tickHearts; // Existing once-per-day livestock upkeep is the incubator's day clock.
    if (typeof original.tickHearts === 'function') {
      api.tickHearts = function incubatorDailyTick(...args) {
        const result = original.tickHearts.apply(this, args);
        advanceMaturationDay();
        return result;
      };
    }
    return true;
  }

  function wrapFarmBuildings(api) {
    if (!api || api.__barnIncubatorWrapped) return !!api;
    api.__barnIncubatorWrapped = true;

    original.buildingInit = api.init; // Captured to obtain farm scene/grid/building dependencies.
    if (typeof original.buildingInit === 'function') {
      api.init = function incubatorBuildingInit(injectedDeps, ...args) {
        const result = original.buildingInit.call(this, injectedDeps, ...args);
        buildingDeps = injectedDeps;
        loadState();
        normalizeState();
        queueMicrotask(rebuildExteriorAll);
        return result;
      };
    }

    original.spawnEntry = api.spawnEntry; // Farm-layout load creates barns through this path; additions rebuild immediately afterward.
    if (typeof original.spawnEntry === 'function') {
      api.spawnEntry = function incubatorAwareSpawnEntry(entry, ...args) {
        const result = original.spawnEntry.call(this, entry, ...args);
        if (entry?.kind === 'barn') queueMicrotask(() => additionsForBarn(entry.id).forEach(addition => rebuildAdditionExterior(entry, addition)));
        return result;
      };
    }

    original.moveBarn = api.move; // Barn moves need to validate and carry their local-coordinate additions too.
    if (typeof original.moveBarn === 'function') {
      api.move = function incubatorAwareBarnMove(barnId, col, row, ...args) {
        const barn = barnById(barnId); // Current base position used to test every addition at the candidate base position.
        if (!barn || !additionsForBarn(barnId).length) return original.moveBarn.call(this, barnId, col, row, ...args);
        unregisterAllAdditionObjects();
        const old = { col: barn.col, row: barn.row }; // Used to restore extension registrations if the core move fails.
        let valid = true; // Candidate aggregate addition-placement result.
        for (const addition of additionsForBarn(barnId)) {
          const candidateBarn = { ...barn, col, row }; // Temporary base used only for absolute extension coordinates.
          const rect = absoluteRect(candidateBarn, addition); // Candidate extension footprint.
          if (!window.FarmBuildings.canPlaceAt(rect.col, rect.row, rect.w, rect.h, barn.id)) { valid = false; break; }
        }
        if (!valid) {
          registerAllAdditionObjects();
          return { ok: false, message: 'That barn move would put an attached incubator on blocked ground.' };
        }
        const result = original.moveBarn.call(this, barnId, col, row, ...args);
        if (!result?.ok) {
          barn.col = old.col; barn.row = old.row;
        }
        rebuildExteriorAll();
        return result;
      };
    }

    original.demolishBarn = api.demolish; // Demolition is blocked while babies are physically inside an addition.
    if (typeof original.demolishBarn === 'function') {
      api.demolish = function incubatorAwareBarnDemolish(barnId, ...args) {
        const additions = additionsForBarn(barnId); // Attached rooms that must be recovered or block demolition.
        if (additions.some(additionHasBaby)) return { ok: false, message: 'A maturing baby is still inside this barn’s incubator.' };
        const result = original.demolishBarn.call(this, barnId, ...args);
        if (result?.ok && additions.length) {
          for (const addition of [...additions]) removeIncubator(addition.id, true);
          delete state.barns[barnId];
          saveState(`Demolished barn ${barnId} and recovered its incubator plan.`);
        }
        return result;
      };
    }

    original.clearBuildings = api.clearAll; // World reload clears live meshes but preserves persisted state until the correct world is loaded.
    if (typeof original.clearBuildings === 'function') {
      api.clearAll = function incubatorAwareClearBuildings(...args) {
        for (const id of [...exteriorObjects.keys()]) unregisterAdditionObject(id);
        for (const id of [...exteriorMeshes.keys()]) disposeExteriorMesh(id);
        return original.clearBuildings.apply(this, args);
      };
    }
    return true;
  }

  function mapExtentsForBarn(barn) {
    const additions = additionsForBarn(barn.id); // Built room rectangles unioned with the base barn for one merged interior grid.
    let minCol = 0, minRow = 0, maxCol = barn.w, maxRow = barn.h; // Barn-local farm-tile extents.
    for (const addition of additions) {
      minCol = Math.min(minCol, addition.localCol);
      minRow = Math.min(minRow, addition.localRow);
      maxCol = Math.max(maxCol, addition.localCol + addition.w);
      maxRow = Math.max(maxRow, addition.localRow + addition.h);
    }
    return { minCol, minRow, maxCol, maxRow };
  }

  function shiftMapCoordinates(map, shiftCol, shiftRow) {
    map.floor = (map.floor || []).map(([col, row]) => [col + shiftCol, row + shiftRow]); // Base barn floor shifted into the expanded union.
    for (const exit of map.exits || []) {
      exit.tiles = (exit.tiles || []).map(([col, row]) => [col + shiftCol, row + shiftRow]);
      if (Number.isFinite(exit.spawnCol)) exit.spawnCol += shiftCol;
      if (Number.isFinite(exit.spawnRow)) exit.spawnRow += shiftRow;
    }
    for (const furniture of map.furniture || []) {
      furniture.col += shiftCol;
      furniture.row += shiftRow;
    }
    for (const station of map.npcStations || []) {
      if (Number.isFinite(station.col)) station.col += shiftCol;
      if (Number.isFinite(station.row)) station.row += shiftRow;
    }
  }

  function interiorFurniturePlacement(barn, addition, extents = mapExtentsForBarn(barn)) {
    const scale = CONFIG.interior.cellsPerFarmTile; // Farm tile -> barn interior cell scale shared with existing FarmTroughs.
    const baseCol = (addition.localCol - extents.minCol) * scale; // Expanded-map room left edge.
    const baseRow = (addition.localRow - extents.minRow) * scale; // Expanded-map room top edge.
    const width = addition.w * scale; // Addition room interior width in cells.
    const height = addition.h * scale; // Addition room interior depth in cells.
    if (addition.side === 'north') return { col: baseCol + Math.floor(width / 2), row: baseRow, rotY: 0 };
    if (addition.side === 'south') return { col: baseCol + Math.floor(width / 2), row: baseRow + height - 1, rotY: 180 };
    if (addition.side === 'west') return { col: baseCol, row: baseRow + Math.floor(height / 2), rotY: 90 };
    return { col: baseCol + width - 1, row: baseRow + Math.floor(height / 2), rotY: 270 };
  }

  function extendBarnInterior(mapId, map) {
    if (!map || !String(mapId || '').startsWith('map_i_barn_')) return map;
    const barnId = String(mapId).slice('map_i_barn_'.length); // Base barn whose additions are merged into this synthesized interior.
    const barn = barnById(barnId); // Must be a real adult barn, not the Nursery.
    const additions = barn ? additionsForBarn(barnId) : [];
    if (!barn || !additions.length) return map;
    ensureFurnitureDef();

    const extents = mapExtentsForBarn(barn); // Union rectangle used only for coordinate shifting and dimensions.
    const scale = CONFIG.interior.cellsPerFarmTile; // Existing barn interiors use two cells per exterior farm tile.
    const shiftCol = -extents.minCol * scale; // Moves negative west additions into nonnegative interior coordinates.
    const shiftRow = -extents.minRow * scale; // Moves negative north additions likewise.
    shiftMapCoordinates(map, shiftCol, shiftRow);
    map.cols = (extents.maxCol - extents.minCol) * scale;
    map.rows = (extents.maxRow - extents.minRow) * scale;
    const floorSet = new Set((map.floor || []).map(([col, row]) => `${col},${row}`)); // Prevents duplicate union floor cells.
    for (const addition of additions) {
      const startCol = (addition.localCol - extents.minCol) * scale; // Room interior left.
      const startRow = (addition.localRow - extents.minRow) * scale; // Room interior top.
      for (let row = 0; row < addition.h * scale; row++) {
        for (let col = 0; col < addition.w * scale; col++) floorSet.add(`${startCol + col},${startRow + row}`);
      }
      const placement = interiorFurniturePlacement(barn, addition, extents); // Authored crib placed against the addition's outside/back wall.
      map.furniture.push({
        id: `f_barn_incubator_${addition.id}`,
        itemKey: CONFIG.interior.furnitureKey,
        col: placement.col,
        row: placement.row,
        rotY: placement.rotY,
        barnId,
        incubatorId: addition.id,
        postX: 0, postY: 0, postZ: 0, postSX: 1, postSY: 1, postSZ: 1,
      });
    }
    map.floor = [...floorSet].map(key => key.split(',').map(Number));
    map.name = `${map.name || 'Barn'} + Incubator`;
    return map;
  }

  function wrapFarmTroughs(api) {
    if (!api || api.__barnIncubatorWrapped) return !!api;
    api.__barnIncubatorWrapped = true;
    original.troughInit = api.init; // Captured to obtain current-area/interior scene dependencies.
    if (typeof original.troughInit === 'function') {
      api.init = function incubatorTroughInit(injectedDeps, ...args) {
        const result = original.troughInit.call(this, injectedDeps, ...args);
        troughDeps = injectedDeps;
        startInteriorSync();
        return result;
      };
    }
    original.synthesizeBarnInterior = api.synthesizeBarnInteriorMapData; // Existing barn map is extended rather than replaced.
    if (typeof original.synthesizeBarnInterior === 'function') {
      api.synthesizeBarnInteriorMapData = function incubatorBarnInterior(mapId, ...args) {
        const map = original.synthesizeBarnInterior.call(this, mapId, ...args);
        return extendBarnInterior(mapId, map);
      };
    }
    return true;
  }

  function currentArea() {
    return troughDeps?.getCurrentArea?.() || window.__hobunjiFurnitureDebug?.getCurrentArea?.() || null; // Used to create temporary sleeping avatars only in the loaded barn interior.
  }

  function activeScene() {
    return window.GridTileAccessors?.getActiveScene?.() || troughDeps?.getActiveScene?.() || null; // Scene receiving incubator baby visuals.
  }

  function loadFurnitureAuthored() {
    if (!furniturePromise) furniturePromise = fetch(CONFIG.interior.furnitureFile).then(response => {
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return response.json();
    }).catch(error => {
      furniturePromise = null;
      console.warn('[BarnIncubator] furniture anchor load failed:', error);
      return null;
    }); // Cached editable crib/anchor data.
    return furniturePromise;
  }

  function attachmentLocal(authored, slotIndex) {
    const point = (authored?.stompAttachPoints || []).filter(entry => entry.enabled !== false)[slotIndex]; // Existing furniture-author attachment format, same as the squeezing vat.
    if (!point) return null;
    const parent = (authored.parts || []).find(part => part.id === point.parentPartId); // Parent part transform makes the anchor move with crib edits.
    return {
      x: (Number(parent?.transform?.x) || 0) + (Number(point.position?.x) || 0),
      y: (Number(parent?.transform?.y) || 0) + (Number(point.position?.y) || 0),
      z: (Number(parent?.transform?.z) || 0) + (Number(point.position?.z) || 0),
      rotY: Number(point.rotation?.y) || 0,
      anchorName: point.anchorName || `incubatorBaby${slotIndex + 1}`,
    };
  }

  function disposeSleepingVisual(key) {
    const visual = sleepingBabies.get(key); // Temporary avatar being removed on slot/area change.
    if (!visual) return;
    visual.avatarRef?.group?.parent?.remove?.(visual.avatarRef.group);
    try { visual.avatarRef?.dispose?.(); } catch (_) {}
    sleepingBabies.delete(key);
  }

  function clearSleepingVisuals() {
    for (const key of [...sleepingBabies.keys()]) disposeSleepingVisual(key); // Used whenever the player leaves the owning barn or a slot changes.
  }

  async function createSleepingVisual(barn, addition, slot, placement, authored) {
    const key = `${addition.id}:${slot.index}`; // Stable visual identity for the slot.
    if (sleepingBabies.has(key) || !slot.baby || typeof THREE === 'undefined') return;
    const renderer = window.CreatureGeneticsRender; // Existing genotype compositor and species sprite registry.
    const avatarApi = window.PNGPlaneAvatar; // Existing front/back animal billboard builder.
    const species = renderer?.SPECIES?.[slot.baby.kind]; // Idle sprite metadata for this baby species.
    const idleUrl = species?.base?.idle; // Texture source for the sleeping billboard.
    const scene = activeScene(); // Current barn interior scene.
    const anchor = attachmentLocal(authored, slot.index); // Editable furniture-authored animal location.
    if (!renderer || !avatarApi?.buildAnimalPlaneAvatarModel || !idleUrl || !scene || !anchor) return;
    const speciesDef = animalDeps?.CREATURE_DB?.[slot.baby.kind] || {}; // Sprite aspect source shared with farm animals.
    const configuredWidths = window.SCRATCHBONES_CONFIG?.game?.livestock?.animalWidths || {}; // Existing per-species size overrides.
    const adultWidth = slot.baby.kind === 'uumkaoii' ? 1.275 : (Number(configuredWidths[slot.baby.kind]) || 1.7); // Same fallback convention as Nursery visuals.
    const aspect = Number(speciesDef.spriteAspect) || (600 / 1375); // Model height aspect.
    const modelWidth = adultWidth * CONFIG.visuals.babyScale; // Baby-scale billboard width.
    const modelHeight = adultWidth * aspect * CONFIG.visuals.babyScale; // Baby-scale billboard height.
    const avatarRef = avatarApi.buildAnimalPlaneAvatarModel(THREE, idleUrl, {
      modelWidth, modelHeight, name: `incubator_sleep_${slot.baby.id}`, creatureId: slot.baby.kind,
      headRig: renderer.headRigForKind?.(slot.baby.kind) || undefined,
    });
    if (!avatarRef?.group) return;
    const sizeScale = window.CreatureGenetics?.creatureSizeScale?.(slot.baby.kind, slot.baby.genotype) || { x: 1, y: 1 }; // Genetics-driven size variation.
    window.CreatureGenetics?.applyCreatureBillboardScale?.(avatarRef.group, sizeScale);
    avatarRef.group.scale.y *= CONFIG.visuals.sleepScaleY; // Same deliberately simple flattened sleeping language used by livestock sleepers.

    const angle = placement.rotY * Math.PI / 180; // Furniture orientation applied to authored local anchor.
    const localX = anchor.x, localZ = anchor.z; // Unrotated anchor offset from furniture center.
    const rx = localX * Math.cos(angle) + localZ * Math.sin(angle); // Rotated interior X offset.
    const rz = -localX * Math.sin(angle) + localZ * Math.cos(angle); // Rotated interior Z offset.
    avatarRef.group.position.set(placement.col + 0.5 + rx, Math.max(0.05, anchor.y), placement.row + 0.5 + rz);
    avatarRef.group.rotation.y = angle + anchor.rotY * Math.PI / 180;
    scene.add(avatarRef.group);
    sleepingBabies.set(key, { avatarRef, babyId: slot.baby.id });

    try {
      const canvas = await renderer.composeFrame(slot.baby.kind, 'idle', slot.baby.genotype, false); // Applies the baby's actual inherited colors/patterns.
      if (!canvas || !sleepingBabies.has(key)) return;
      const front = new THREE.CanvasTexture(canvas); // Front genotype texture.
      const back = new THREE.CanvasTexture(canvas); // Mirrored back genotype texture.
      if ('colorSpace' in front && THREE.SRGBColorSpace) { front.colorSpace = THREE.SRGBColorSpace; back.colorSpace = THREE.SRGBColorSpace; }
      back.wrapS = THREE.RepeatWrapping; back.repeat.set(-1, 1); back.offset.set(1, 0);
      avatarRef.group.traverse(child => {
        if (!child?.material) return;
        if (String(child.name || '').endsWith('_front_plane')) { child.material.map = front; child.material.needsUpdate = true; }
        if (String(child.name || '').endsWith('_back_plane')) { child.material.map = back; child.material.needsUpdate = true; }
      });
    } catch (_) {}
  }

  async function syncSleepingBabies(force = false) {
    const area = currentArea(); // Current map determines whether any incubator babies should exist visually.
    if (!String(area || '').startsWith('map_i_barn_')) {
      if (sleepingBabies.size) clearSleepingVisuals();
      return;
    }
    const barnId = String(area).slice('map_i_barn_'.length); // Loaded barn owning potential incubator visuals.
    const barn = barnById(barnId); // Real barn corresponding to the interior.
    const additions = barn ? additionsForBarn(barnId) : [];
    if (!barn || !additions.length) { clearSleepingVisuals(); return; }
    const wanted = new Set(); // Visual slot keys that should remain alive after reconciliation.
    const authored = await loadFurnitureAuthored(); // Editable crib anchor definitions.
    if (!authored || currentArea() !== area) return;
    const extents = mapExtentsForBarn(barn); // Same coordinate expansion used by synthesized interior placement.
    for (const addition of additions) {
      const placement = interiorFurniturePlacement(barn, addition, extents); // Crib world position in expanded interior.
      for (const slot of addition.slots || []) {
        if (!slot.baby) continue;
        const key = `${addition.id}:${slot.index}`; // Desired visible baby key.
        wanted.add(key);
        const existing = sleepingBabies.get(key); // Existing visual may represent a previous baby after slot reuse.
        if (existing && existing.babyId !== slot.baby.id) disposeSleepingVisual(key);
        createSleepingVisual(barn, addition, slot, placement, authored);
      }
    }
    for (const key of [...sleepingBabies.keys()]) if (!wanted.has(key)) disposeSleepingVisual(key);
  }

  function startInteriorSync() {
    if (interiorSyncTimer != null || typeof window.setInterval !== 'function') return;
    interiorSyncTimer = window.setInterval(() => syncSleepingBabies(false), CONFIG.visuals.syncMs); // Low-cost visual reconciliation while an interior is loaded.
  }

  function buyIncubatorPlan() {
    const definition = stockDefinition(); // Shop-stock authored price, plan key, and conditions.
    const deps = carpenterDeps; // Carpenter wallet/inventory seam.
    const key = ensurePlanItemDef(); // Physical plan stack granted on purchase.
    if (!definition || !deps || !key) return { ok: false, message: 'Incubator plan stock is not loaded yet.' };
    if (window.ConditionRegistry?.entryEligible && !window.ConditionRegistry.entryEligible(definition, deps.lootShopWorldState?.() || {})) {
      return { ok: false, message: 'That plan is not available right now.' };
    }
    const gold = Number(deps.inventory.gold) || 0; // Current wallet.
    if (gold < definition.price) return { ok: false, message: `Not enough gold (need ${definition.price}g).` };
    deps.inventory.gold = gold - definition.price;
    deps.inventory[key] = Math.min(9, (deps.inventory[key] || 0) + 1);
    deps.saveMemberWorldData?.();
    deps.buildInventoryGrid?.();
    deps.showToast?.(`Bought ${definition.label}!`, true);
    window.CarpenterShop?.render?.();
    return { ok: true, message: `Bought ${definition.label}.` };
  }

  function decorateCarpenterShop() {
    if (typeof document === 'undefined') return;
    const list = document.getElementById('carpenterShopList'); // Existing Carpenter list receiving a generic Barn Additions section.
    const definition = stockDefinition(); // Authored addition stock.
    if (!list || !definition || list.querySelector('[data-barn-incubator-shop]')) return;
    ensurePlanItemDef();
    const header = document.createElement('div'); // Section heading inserted before furniture blueprints when possible.
    header.className = 'shop-section-label';
    header.dataset.barnIncubatorShop = 'header';
    header.textContent = '🏚 Barn Additions';
    const row = document.createElement('div'); // Purchase row matching existing carpenter shop styling.
    row.className = 'shop-row';
    row.dataset.barnIncubatorShop = 'incubator';
    const owned = Number(carpenterDeps?.inventory?.[planItemKey()]) || 0; // Current unplaced plan count.
    row.innerHTML = `
      <div class="sh-icon">${definition.icon || '🪺'}</div>
      <div class="sh-info">
        <div class="sh-name">${panelDeps?.esc?.(definition.label) || definition.label}</div>
        <div class="sh-desc">${panelDeps?.esc?.(definition.desc) || definition.desc} Owned: ${owned}</div>
        <div class="sh-price">${definition.price}g each</div>
      </div>
      <button class="shop-buy-btn" type="button">Buy</button>`;
    row.querySelector('button')?.addEventListener('click', buyIncubatorPlan);
    const blueprintHeader = [...list.querySelectorAll('.shop-section-label')].find(element => /Furniture Blueprints/i.test(element.textContent || '')); // Keeps building additions grouped with other structural purchases.
    list.insertBefore(header, blueprintHeader || null);
    list.insertBefore(row, blueprintHeader || null);
  }

  function wrapCarpenterShop(api) {
    if (!api || api.__barnIncubatorWrapped) return !!api;
    api.__barnIncubatorWrapped = true;
    original.carpenterInit = api.init; // Captured to get Carpenter wallet/inventory dependencies.
    if (typeof original.carpenterInit === 'function') {
      api.init = function incubatorCarpenterInit(injectedDeps, ...args) {
        const result = original.carpenterInit.call(this, injectedDeps, ...args);
        carpenterDeps = injectedDeps;
        ensurePlanItemDef();
        return result;
      };
    }
    original.carpenterRender = api.render; // Existing three carpenter sections render first.
    if (typeof original.carpenterRender === 'function') {
      api.render = function incubatorCarpenterRender(...args) {
        const result = original.carpenterRender.apply(this, args);
        decorateCarpenterShop();
        return result;
      };
    }
    return true;
  }

  function ensureStyles() {
    if (document.getElementById('barnIncubatorStyles')) return;
    const style = document.createElement('style'); // Shared responsive styles for both full-screen barn editor and slot manager.
    style.id = 'barnIncubatorStyles';
    style.textContent = `
      .barn-incubator-modal{position:fixed;inset:0;z-index:10080;background:rgba(10,10,12,.92);display:none;align-items:stretch;justify-content:center;padding:12px;box-sizing:border-box}
      .barn-incubator-modal.open{display:flex}
      .barn-incubator-shell{width:min(1050px,100%);height:100%;display:grid;grid-template-columns:minmax(0,1fr) minmax(250px,340px);gap:10px;background:var(--panel,#201d1a);border:1px solid var(--border,#554b40);border-radius:12px;padding:10px;box-sizing:border-box;overflow:hidden}
      .barn-incubator-stage{min-width:0;display:flex;flex-direction:column;gap:8px}
      .barn-incubator-canvas{width:100%;min-height:280px;flex:1;background:#171717;border:1px solid var(--border,#554b40);border-radius:8px;touch-action:none}
      .barn-incubator-sidebar{overflow:auto;display:flex;flex-direction:column;gap:8px}
      .barn-incubator-actions{display:flex;flex-wrap:wrap;gap:6px}
      .incubator-slot{border:1px solid var(--border,#554b40);border-radius:8px;padding:8px;display:flex;flex-direction:column;gap:6px}
      .incubator-slot select{width:100%}
      @media(max-width:720px){.barn-incubator-modal{padding:4px}.barn-incubator-shell{grid-template-columns:1fr;grid-template-rows:minmax(260px,48vh) minmax(0,1fr)}.barn-incubator-sidebar{padding-bottom:16px}}
    `;
    document.head.appendChild(style);
  }

  function ensureEditorModal() {
    ensureStyles();
    let modal = document.getElementById('barnIncubatorLayoutModal'); // Full-screen barn-layout editor, created lazily.
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'barnIncubatorLayoutModal';
    modal.className = 'barn-incubator-modal';
    modal.innerHTML = `
      <div class="barn-incubator-shell">
        <div class="barn-incubator-stage">
          <div class="menu-section-title" id="barnIncubatorEditorTitle">Barn Layout</div>
          <canvas id="barnIncubatorLayoutCanvas" class="barn-incubator-canvas"></canvas>
          <div class="farm-note" id="barnIncubatorEditorHint"></div>
        </div>
        <div class="barn-incubator-sidebar">
          <div class="settings-section-title">Barn Additions</div>
          <div id="barnIncubatorEditorSummary" class="farm-note"></div>
          <div id="barnIncubatorEditorList" class="farm-list"></div>
          <div class="barn-incubator-actions">
            <button class="settings-small-btn" id="barnIncubatorPlaceBtn">Place Incubator</button>
            <button class="settings-small-btn" id="barnIncubatorMoveBtn">Move Selected</button>
            <button class="settings-small-btn" id="barnIncubatorManageBtn">Manage Selected</button>
            <button class="settings-small-btn" id="barnIncubatorRemoveBtn">Remove Selected</button>
            <button class="settings-small-btn" id="barnIncubatorEditorClose">Close</button>
          </div>
          <button class="settings-small-btn" id="barnIncubatorDebugBtn">Copy Incubator Debug</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#barnIncubatorEditorClose')?.addEventListener('click', closeBarnEditor);
    modal.querySelector('#barnIncubatorPlaceBtn')?.addEventListener('click', () => { editorMode = 'place'; renderBarnEditor(); });
    modal.querySelector('#barnIncubatorMoveBtn')?.addEventListener('click', () => { if (selectedAdditionId) { editorMode = 'move'; renderBarnEditor(); } });
    modal.querySelector('#barnIncubatorManageBtn')?.addEventListener('click', () => { if (selectedAdditionId) openIncubatorMenu(selectedAdditionId); });
    modal.querySelector('#barnIncubatorRemoveBtn')?.addEventListener('click', () => {
      if (!selectedAdditionId) return;
      const result = removeIncubator(selectedAdditionId, true); // Existing selected piece removed only after active-baby gate.
      (panelDeps || animalDeps)?.showToast?.(result.message, result.ok !== false);
      if (result.ok) selectedAdditionId = null;
      renderBarnEditor();
    });
    modal.querySelector('#barnIncubatorDebugBtn')?.addEventListener('click', copyDebug);
    modal.querySelector('#barnIncubatorLayoutCanvas')?.addEventListener('click', onEditorCanvasClick);
    window.addEventListener('resize', () => { if (modal.classList.contains('open')) drawEditorCanvas(); });
    return modal;
  }

  function editorViewport(barn) {
    const candidates = candidatePlacementsForBarn(barn); // Potential wall slots included so the whole editable perimeter is visible.
    const rects = [{ col: barn.col, row: barn.row, w: barn.w, h: barn.h }, ...candidates.map(candidate => absoluteRect(barn, candidate))];
    const minCol = Math.min(...rects.map(rect => rect.col)) - 1; // One-tile visual margin.
    const minRow = Math.min(...rects.map(rect => rect.row)) - 1; // One-tile visual margin.
    const maxCol = Math.max(...rects.map(rect => rect.col + rect.w)) + 1; // Right visual boundary.
    const maxRow = Math.max(...rects.map(rect => rect.row + rect.h)) + 1; // Bottom visual boundary.
    return { minCol, minRow, maxCol, maxRow };
  }

  function drawEditorCanvas() {
    const canvas = document.getElementById('barnIncubatorLayoutCanvas'); // Top-down layout surface.
    const barn = barnById(selectedBarnId); // Barn currently being edited.
    if (!canvas || !barn) return;
    const rect = canvas.getBoundingClientRect(); // CSS size converted to backing-pixel resolution.
    const dpr = window.devicePixelRatio || 1; // Keeps mobile high-DPI lines/text readable.
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const ctx = canvas.getContext('2d'); // Simple top-down editor rendering.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const view = editorViewport(barn); // Farm-grid extent shown by the canvas.
    const cols = view.maxCol - view.minCol, rows = view.maxRow - view.minRow; // View dimensions in farm tiles.
    const cell = Math.max(14, Math.min(rect.width / cols, rect.height / rows)); // Uniform square tile size.
    const ox = (rect.width - cols * cell) / 2, oy = (rect.height - rows * cell) / 2; // Centered viewport origin.
    canvas.__incubatorView = { ...view, cell, ox, oy }; // Click handler uses exact draw transform.

    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.fillStyle = '#171717';
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.strokeStyle = 'rgba(255,255,255,.10)';
    ctx.lineWidth = 1;
    for (let c = 0; c <= cols; c++) { ctx.beginPath(); ctx.moveTo(ox + c * cell, oy); ctx.lineTo(ox + c * cell, oy + rows * cell); ctx.stroke(); }
    for (let r = 0; r <= rows; r++) { ctx.beginPath(); ctx.moveTo(ox, oy + r * cell); ctx.lineTo(ox + cols * cell, oy + r * cell); ctx.stroke(); }

    const drawRect = (farmRect, fill, stroke, label) => { // Shared base/addition rectangle renderer.
      const x = ox + (farmRect.col - view.minCol) * cell, y = oy + (farmRect.row - view.minRow) * cell;
      ctx.fillStyle = fill; ctx.fillRect(x, y, farmRect.w * cell, farmRect.h * cell);
      ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.strokeRect(x, y, farmRect.w * cell, farmRect.h * cell);
      ctx.fillStyle = '#fff'; ctx.font = `${Math.max(10, Math.min(14, cell * .35))}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, x + farmRect.w * cell / 2, y + farmRect.h * cell / 2);
    };
    drawRect({ col: barn.col, row: barn.row, w: barn.w, h: barn.h }, '#55483d', '#b9a58e', 'Barn');
    for (const addition of additionsForBarn(barn.id)) {
      const chosen = addition.id === selectedAdditionId; // Selected piece gets a brighter editor outline.
      drawRect(absoluteRect(barn, addition), chosen ? '#826e52' : '#665944', chosen ? '#ffe2a7' : '#c9b28a', 'Incubator');
    }
  }

  function onEditorCanvasClick(event) {
    const canvas = event.currentTarget; // Layout canvas owning the stored transform.
    const barn = barnById(selectedBarnId); // Barn currently being edited.
    const view = canvas.__incubatorView; // Exact draw transform produced above.
    if (!barn || !view) return;
    const rect = canvas.getBoundingClientRect(); // Pointer coordinates relative to CSS canvas.
    const x = event.clientX - rect.left, y = event.clientY - rect.top; // Local CSS pixels.
    const farmCol = view.minCol + (x - view.ox) / view.cell; // Fractional farm-grid X used for nearest slot snapping.
    const farmRow = view.minRow + (y - view.oy) / view.cell; // Fractional farm-grid Z.
    if (editorMode === 'place' || editorMode === 'move') {
      const candidate = closestCandidate(barn, farmCol, farmRow, editorMode === 'move' ? selectedAdditionId : null); // Nearest valid full-edge wall attachment.
      if (!candidate) {
        (panelDeps || animalDeps)?.showToast?.('No clear incubator position near that wall.', false);
        return;
      }
      const result = editorMode === 'move' ? moveIncubator(selectedAdditionId, candidate) : placeIncubator(barn.id, candidate); // Shared validated placement operations.
      (panelDeps || animalDeps)?.showToast?.(result.message, result.ok !== false);
      if (result.ok) {
        selectedAdditionId = result.addition?.id || selectedAdditionId;
        editorMode = null;
      }
      renderBarnEditor();
      return;
    }
    const hit = additionsForBarn(barn.id).find(addition => {
      const r = absoluteRect(barn, addition); // Existing addition rectangle used for selection hit-test.
      return farmCol >= r.col && farmCol < r.col + r.w && farmRow >= r.row && farmRow < r.row + r.h;
    });
    selectedAdditionId = hit?.id || null;
    renderBarnEditor();
  }

  function renderBarnEditor() {
    const barn = barnById(selectedBarnId); // Barn currently open.
    const modal = document.getElementById('barnIncubatorLayoutModal'); // Existing editor DOM.
    if (!barn || !modal) { closeBarnEditor(); return; }
    const definition = stockDefinition(); // Authored plan label/price description.
    const key = ensurePlanItemDef(); // Unplaced plan stack.
    const owned = Number((panelDeps || carpenterDeps || animalDeps)?.inventory?.[key]) || 0; // Current plans available for new placement.
    const additions = additionsForBarn(barn.id); // Installed additions rendered in list/canvas.
    const selected = additionById(selectedAdditionId); // Selected piece, if any.
    document.getElementById('barnIncubatorEditorTitle').textContent = `${buildingDeps?.getBarnTiers?.()?.[barn.tier]?.label || 'Barn'} Layout`;
    document.getElementById('barnIncubatorEditorSummary').textContent =
      `${definition?.label || CONFIG.addition.label}: ${owned} unplaced · ${additions.length}/${CONFIG.addition.maxPerBarn} installed.`;
    document.getElementById('barnIncubatorEditorHint').textContent = editorMode
      ? `Tap the desired barn wall. The ${CONFIG.addition.canonicalFootprint.w}-tile side snaps flat against the wall automatically.`
      : 'Select an installed addition, or place a purchased one. Moving the barn later carries its additions with it.';
    const list = document.getElementById('barnIncubatorEditorList'); // Installed room list.
    list.innerHTML = additions.length ? '' : '<div class="farm-note">No barn additions installed.</div>';
    additions.forEach(addition => {
      const row = document.createElement('button'); // Mobile-friendly list selection alternative to canvas tapping.
      row.type = 'button';
      row.className = `settings-small-btn${addition.id === selectedAdditionId ? ' active' : ''}`;
      const active = addition.slots.filter(slot => slot.baby).length; // Current maturation occupancy.
      row.textContent = `🪺 ${CONFIG.addition.label} · ${active}/${CONFIG.gameplay.slots} maturing`;
      row.addEventListener('click', () => { selectedAdditionId = addition.id; editorMode = null; renderBarnEditor(); });
      list.appendChild(row);
    });
    document.getElementById('barnIncubatorPlaceBtn').disabled = owned < 1 || additions.length >= CONFIG.addition.maxPerBarn;
    document.getElementById('barnIncubatorMoveBtn').disabled = !selected || additionHasBaby(selected);
    document.getElementById('barnIncubatorManageBtn').disabled = !selected;
    document.getElementById('barnIncubatorRemoveBtn').disabled = !selected || additionHasBaby(selected);
    drawEditorCanvas();
  }

  function openBarnEditor(barnId) {
    const barn = barnById(barnId); // Requested regular built barn.
    if (!barn) return { ok: false, message: 'Built barn not found.' };
    const modal = ensureEditorModal(); // Lazily created full-screen sub-editor.
    selectedBarnId = barnId;
    selectedAdditionId = additionsForBarn(barnId)[0]?.id || null;
    editorMode = null;
    modal.classList.add('open');
    renderBarnEditor();
    return { ok: true, message: 'Opened barn layout editor.' };
  }

  function closeBarnEditor() {
    document.getElementById('barnIncubatorLayoutModal')?.classList.remove('open');
    editorMode = null;
  }

  function ensureManagementModal() {
    ensureStyles();
    let modal = document.getElementById('barnIncubatorManageModal'); // Full-screen three-slot management UI.
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'barnIncubatorManageModal';
    modal.className = 'barn-incubator-modal';
    modal.innerHTML = `
      <div class="barn-incubator-shell" style="grid-template-columns:1fr">
        <div class="barn-incubator-sidebar">
          <div class="menu-section-title">🪺 Incubator</div>
          <div class="farm-note">Reserve one unused trough per slot before starting a Nursery baby. Incubation takes ${CONFIG.gameplay.maturationDays} daily livestock ticks and uses no Growth Tonic.</div>
          <div id="barnIncubatorSlots"></div>
          <div class="barn-incubator-actions">
            <button class="settings-small-btn" id="barnIncubatorManageDebug">Copy Debug</button>
            <button class="settings-small-btn" id="barnIncubatorManageClose">Close</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#barnIncubatorManageClose')?.addEventListener('click', () => modal.classList.remove('open'));
    modal.querySelector('#barnIncubatorManageDebug')?.addEventListener('click', copyDebug);
    return modal;
  }

  function troughLabel(entry) {
    const tier = buildingDeps?.getBarnTiers?.()?.[entry.barn.tier]?.label || 'Barn'; // Human-readable barn tier.
    return `${tier} · trough ${entry.troughIndex + 1}${entry.filled ? ` · ${entry.filled} feed stored` : ''}`; // Reservation dropdown label.
  }

  function refreshManagement() {
    if (typeof document === 'undefined') return;
    const modal = document.getElementById('barnIncubatorManageModal'); // Existing manager, if open.
    if (!modal?.classList.contains('open')) return;
    const addition = additionById(managementAdditionId); // Incubator whose slots populate the manager.
    const host = document.getElementById('barnIncubatorSlots'); // Slot list container.
    if (!addition || !host) { modal.classList.remove('open'); return; }
    const babies = nurseryBabies(); // Available Nursery babies not currently inside an incubator.
    host.innerHTML = '';
    addition.slots.forEach((slot, slotIndex) => {
      const card = document.createElement('div'); // One independent maturation/reservation slot.
      card.className = 'incubator-slot';
      const currentTroughKey = slot.troughBarnId && slot.troughIndex != null ? troughKey(slot.troughBarnId, slot.troughIndex) : null; // Existing reservation retained in dropdown.
      const choices = availableTroughsForSlot(addition.id, slotIndex); // Currently valid unused troughs.
      if (currentTroughKey && !choices.some(entry => troughKey(entry.barnId, entry.troughIndex) === currentTroughKey)) {
        const barn = barnById(slot.troughBarnId); // Existing reservation may be temporarily invalid/occupied but must stay visible.
        const trough = barn && troughsForBarn(barn)[slot.troughIndex];
        if (barn && trough) choices.unshift({ barnId: barn.id, troughIndex: slot.troughIndex, barn, trough, filled: trough?.slots?.filter(Boolean).length || 0 });
      }
      card.innerHTML = `<strong>Slot ${slotIndex + 1}</strong>`;
      const troughSelect = document.createElement('select'); // Advance trough assignment required before Start.
      troughSelect.className = 'settings-select';
      troughSelect.disabled = !!slot.baby;
      troughSelect.innerHTML = '<option value="">— Reserve unused trough —</option>' + choices.map(entry => {
        const value = troughKey(entry.barnId, entry.troughIndex); // Select payload.
        return `<option value="${value}" ${value === currentTroughKey ? 'selected' : ''}>${troughLabel(entry)}</option>`;
      }).join('');
      troughSelect.addEventListener('change', () => {
        const [barnId, index] = String(troughSelect.value || '').split(':'); // Selected reservation target.
        const result = troughSelect.value ? reserveTrough(addition.id, slotIndex, barnId, Number(index)) : reserveTrough(addition.id, slotIndex, null, null);
        (panelDeps || animalDeps)?.showToast?.(result.message, result.ok !== false);
      });
      card.appendChild(troughSelect);

      if (slot.baby) {
        const status = document.createElement('div'); // Active baby/progress summary.
        status.className = 'farm-note';
        status.textContent = `${slot.baby.name || 'Baby'} · ${slot.daysRemaining ?? 0} day${slot.daysRemaining === 1 ? '' : 's'} remaining${slot.blockedReason ? ` · BLOCKED: ${slot.blockedReason}` : ''}`;
        card.appendChild(status);
        const cancel = document.createElement('button'); // Returns baby to Nursery without clearing the preassigned trough.
        cancel.className = 'settings-small-btn';
        cancel.textContent = 'Return to Nursery';
        cancel.addEventListener('click', () => {
          const result = cancelMaturation(addition.id, slotIndex);
          (panelDeps || animalDeps)?.showToast?.(result.message, result.ok !== false);
        });
        card.appendChild(cancel);
      } else {
        const babySelect = document.createElement('select'); // Nursery baby chosen only after a trough is reserved.
        babySelect.className = 'settings-select';
        babySelect.disabled = !currentTroughKey || !babies.length;
        babySelect.innerHTML = '<option value="">— Choose Nursery baby —</option>' + babies.map(baby =>
          `<option value="${baby.id}">${baby.name || baby.kind} · ${baby.kind}</option>`).join('');
        card.appendChild(babySelect);
        const start = document.createElement('button'); // Starts the no-tonic multi-day maturation.
        start.className = 'settings-small-btn';
        start.textContent = `Start ${CONFIG.gameplay.maturationDays}-day Maturation`;
        start.disabled = !currentTroughKey || !babies.length;
        start.addEventListener('click', () => {
          if (!babySelect.value) { (panelDeps || animalDeps)?.showToast?.('Choose a baby first.', false); return; }
          const result = startMaturation(addition.id, slotIndex, babySelect.value);
          (panelDeps || animalDeps)?.showToast?.(result.message, result.ok !== false);
        });
        card.appendChild(start);
      }
      host.appendChild(card);
    });
  }

  function openIncubatorMenu(additionId) {
    const addition = additionById(additionId); // Installed incubator being managed.
    if (!addition) return { ok: false, message: 'Incubator not found.' };
    managementAdditionId = additionId;
    const modal = ensureManagementModal(); // Lazily created slot manager.
    modal.classList.add('open');
    refreshManagement();
    return { ok: true, message: 'Opened incubator.' };
  }

  function decorateFarmPanel() {
    if (typeof document === 'undefined') return;
    const list = document.getElementById('farmBuildingsList'); // Existing Buildings section anchor.
    if (!list) return;
    document.getElementById('barnLayoutEditorLaunchers')?.remove();
    const barns = regularBarns(); // Each built adult barn gets its own sub-editor launcher.
    if (!barns.length) return;
    const wrap = document.createElement('div'); // Dedicated launcher block avoids fragile matching against existing barn rows.
    wrap.id = 'barnLayoutEditorLaunchers';
    wrap.className = 'farm-list';
    wrap.style.marginTop = '8px';
    const heading = document.createElement('div'); // Explains the new barn-specific modular layout system.
    heading.className = 'farm-note';
    heading.textContent = 'Barn layouts — attach purchased room additions along clear barn walls:';
    wrap.appendChild(heading);
    barns.forEach((barn, index) => {
      const button = document.createElement('button'); // Mobile-friendly barn editor launcher.
      button.className = 'settings-small-btn';
      const label = buildingDeps?.getBarnTiers?.()?.[barn.tier]?.label || 'Barn'; // Human-readable tier.
      button.textContent = `Edit ${label}${barns.length > 1 ? ` ${index + 1}` : ''} Layout`;
      button.addEventListener('click', () => openBarnEditor(barn.id));
      wrap.appendChild(button);
    });
    list.insertAdjacentElement('afterend', wrap);
  }

  function wrapFarmPanel(api) {
    if (!api || api.__barnIncubatorWrapped) return !!api;
    api.__barnIncubatorWrapped = true;
    original.panelInit = api.init; // Captured to obtain inventory, furniture-def, and Farm Panel UI dependencies.
    if (typeof original.panelInit === 'function') {
      api.init = function incubatorPanelInit(injectedDeps, ...args) {
        const result = original.panelInit.call(this, injectedDeps, ...args);
        panelDeps = injectedDeps;
        ensurePlanItemDef();
        ensureFurnitureDef();
        return result;
      };
    }
    original.panelRender = api.render; // Existing Farm panel renders before incubator editor launchers are decorated in.
    if (typeof original.panelRender === 'function') {
      api.render = function incubatorPanelRender(...args) {
        const result = original.panelRender.apply(this, args);
        decorateFarmPanel();
        return result;
      };
    }
    return true;
  }

  async function copyDebug() {
    const text = JSON.stringify(debugSnapshot(), null, 2); // Mobile-readable complete feature state.
    try {
      await navigator.clipboard.writeText(text);
      (panelDeps || animalDeps)?.showToast?.('Incubator debug copied.', true);
    } catch (_) {
      window.prompt?.('Copy incubator debug:', text);
    }
  }

  function debugSnapshot() {
    normalizeState();
    return {
      mostRecentChange: lastDebugChange,
      config: {
        slots: CONFIG.gameplay.slots,
        maturationDays: CONFIG.gameplay.maturationDays,
        footprint: CONFIG.addition.canonicalFootprint,
        roofSpineHeightMultiplier: CONFIG.addition.roofSpineHeightMultiplier,
        maxPerBarn: CONFIG.addition.maxPerBarn,
      },
      worldId: worldId(),
      planItemKey: planItemKey(),
      planCount: Number((panelDeps || carpenterDeps || animalDeps)?.inventory?.[planItemKey()]) || 0,
      barns: regularBarns().map(barn => ({
        id: barn.id, tier: barn.tier, col: barn.col, row: barn.row, w: barn.w, h: barn.h,
        additions: additionsForBarn(barn.id).map(addition => ({
          id: addition.id, side: addition.side, localCol: addition.localCol, localRow: addition.localRow, w: addition.w, h: addition.h,
          slots: addition.slots.map(slot => ({
            slot: slot.index + 1,
            trough: slot.troughBarnId ? troughKey(slot.troughBarnId, slot.troughIndex) : null,
            babyId: slot.baby?.id || null,
            babyName: slot.baby?.name || null,
            daysRemaining: slot.daysRemaining,
            blockedReason: slot.blockedReason || null,
          })),
        })),
      })),
      reservedTroughs: [...reservedTroughMap().keys()],
      nurseryBabyCount: nurseryBabies().length,
      currentArea: currentArea(),
      sleepingVisuals: [...sleepingBabies.keys()],
    };
  }

  function refreshAllUi() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('barnIncubatorLayoutModal')?.classList.contains('open')) renderBarnEditor();
    refreshManagement();
    if (document.getElementById('mpFarm')?.classList.contains('active')) decorateFarmPanel();
    carpenterDeps && decorateCarpenterShop();
  }

  function install() {
    if (installed) return true;
    installed = true;
    loadState();
    normalizeState();
    wrapFarmBuildings(window.FarmBuildings);
    wrapFarmAnimals(window.FarmAnimals);
    wrapFarmTroughs(window.FarmTroughs);
    wrapFarmPanel(window.FarmPanel);
    wrapCarpenterShop(window.CarpenterShop);
    startInteriorSync();
    if (typeof document !== 'undefined') {
      document.addEventListener('hobunjiPlayerReady', () => {
        loadState(); // Reloads under the now-known real world ID rather than the parser-time legacy namespace.
        normalizeState();
        ensurePlanItemDef();
        ensureFurnitureDef();
        rebuildExteriorAll();
        refreshAllUi();
      });
    }
    return true;
  }

  window.BarnIncubator = {
    install,
    openBarnEditor,
    openIncubatorMenu,
    candidatePlacementsForBarn,
    placeIncubator,
    moveIncubator,
    removeIncubator,
    reserveTrough,
    availableTroughsForSlot,
    startMaturation,
    cancelMaturation,
    advanceMaturationDay,
    extendBarnInterior,
    rebuildExteriorAll,
    syncSleepingBabies,
    debugSnapshot,
    getState: () => deepClone(state || freshState()),
    constants: {
      additionId: CONFIG.addition.id,
      slots: CONFIG.gameplay.slots,
      maturationDays: CONFIG.gameplay.maturationDays,
      roofSpineHeightMultiplier: CONFIG.addition.roofSpineHeightMultiplier,
    },
  };
})();
