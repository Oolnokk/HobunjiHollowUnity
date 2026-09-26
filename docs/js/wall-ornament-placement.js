// Shared wall-ornament placement bridge.
//
// Authoring stores one furniture-local attachment frame. Player farm/home
// placement and the dev Map Editor both store wall-space U/V/normal offsets,
// then derive the ordinary postX/postY/postZ/rotY transform fields used by
// existing furniture rendering. No new per-frame rendering path is required.
(() => {
  'use strict';

  if (Number(window.WallOrnamentPlacement?.version) >= 5) return;

  const VERSION = 5; // v5 keeps reticle-native placement and mirrors solved wall-normal yaw into the ordinary furniture save field.
  const DEG = Math.PI / 180; // Shared degree/radian conversion for authored and map yaw values.
  const PLAYER_STORE_PREFIX = 'hobunji_wall_ornaments_v1:'; // Namespaces logical wall placement separately from the ordinary farm layout save.
  const PLAYER_STORE_SCHEMA_VERSION = 1; // Persisted placement schema is intentionally decoupled from runtime VERSION so code revisions never invalidate mounted furniture.
  const CANONICAL_KEYS = new Set(['innSign', 'generalStoreSign', 'wallTorch']); // First repository wall-ornament presets.
  const PLAYER_ALIAS_KEYS = new Set(['wallInnSign', 'wallGeneralStoreSign', 'wallTorch']); // Ordinary inventory-placeable keys shown by Furniture Placer.
  const moduleUrl = typeof document !== 'undefined' && document.currentScript?.src ? document.currentScript.src : ''; // Captured while currentScript still identifies this file.
  const docsBaseUrl = moduleUrl ? new URL('../', moduleUrl) : null; // Used to fetch authored furniture metadata from both game and tool URLs.
  const attachmentCache = new Map(); // Reuses authored attachment metadata instead of refetching JSON for every placement.
  const playerPlacementListeners = new Set(); // Notifies linked wall systems after a player-owned logical wall placement changes.
  const playerPlacementRemovalListeners = new Set(); // Notifies linked wall systems before a mounted record is fully discarded.

  let farmDeps = null; // Captured from FarmEditor.init; supplies live placed furniture objects/scenes and the save namespace.
  let placerDeps = null; // Captured from FurniturePlacer.init; supplies inventory/catalog/toast/permission state.
  let runtimeDeps = null; // Captured from MapLivePreviewRuntime.init; supplies camera, renderer, and the active Three scene.
  let playerObject = null; // Current farm/interior placed-furniture record being adjusted.
  let playerPlacement = null; // Current logical wall-space placement record for playerObject.
  let playerAttachment = null;
  let playerPickWall = false;
  let playerMode = null; // null | new | move
  let playerArmedItemKey = null;
  let playerOriginalPlacement = null;
  let playerOriginalTransform = null;
  let playerPreviewValid = false;
  const playerClaimedActions = new Set(); // Keeps a controller/keyboard press claimed through release even if Done ends adjustment on press.
  let playerSyncTimer = null; // Low-frequency restore timer; reapplies persisted wall transforms after farm/interior rebuilds.
  let controllerUnsubscribe = null; // Shared ControllerInput subscription; no private RAF/gamepad poller is created.
  let lastError = null; // Most recent recoverable integration error exposed by debugSnapshot.
  let mapEditorInstalled = false; // Prevents duplicate Map Editor UI/listeners when the tool rerenders.
  let mapEditorArmKey = null; // Canonical ornament key awaiting a click on the Map Editor 3D preview wall.
  let mapProxy = null; // Map Editor local-axis proxy attached to the existing TransformControls.
  let mapProxyState = null; // {record,mesh,attachment} for the currently selected Map Editor ornament.

  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback; // Normalizes imported/save numeric fields.
  const round = (value, places = 3) => { const power = 10 ** places; return Math.round(finite(value) * power) / power; }; // Keeps saved transforms compact and diff-friendly.
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value)); // Keeps logical save records detached from live editor objects.

  function normalizeDegrees(value) {
    let degrees = finite(value); // Used by every derived root yaw and debug readout.
    while (degrees <= -180) degrees += 360;
    while (degrees > 180) degrees -= 360;
    return degrees;
  }

  function normalizeXZ(values, fallback = [0, 0, 1]) {
    const source = Array.isArray(values) ? values : fallback; // Target walls are vertical for this first implementation, so only X/Z define normal direction.
    const x = finite(source[0], fallback[0]); // Horizontal normal X component used by tangent/yaw math.
    const z = finite(source[2], fallback[2]); // Horizontal normal Z component used by tangent/yaw math.
    const length = Math.hypot(x, z) || 1; // Avoids invalid imported zero normals.
    return [x / length, 0, z / length];
  }

  function wallBasis(normalValues) {
    const normal = normalizeXZ(normalValues); // Z axis of both player and dev translation gizmos.
    const tangent = [normal[2], 0, -normal[0]]; // X axis lies horizontally along the wall plane.
    const up = [0, 1, 0]; // Y axis remains world vertical so wall ornaments never roll with wonky wall mesh triangulation.
    return { tangent, up, normal };
  }

  function yawOf(normalValues) {
    const normal = normalizeXZ(normalValues); // Converts a wall/furniture horizontal normal to the game's +Z-based yaw convention.
    return Math.atan2(normal[0], normal[2]) / DEG;
  }

  function rotateY(pointValues, yawDeg) {
    const point = Array.isArray(pointValues) ? pointValues : [0, 0, 0]; // Furniture-local attachment anchor rotated with the solved root yaw.
    const radians = finite(yawDeg) * DEG; // THREE's Y rotation convention is mirrored exactly in the scalar math below.
    const cosine = Math.cos(radians); // Used for both X and Z components.
    const sine = Math.sin(radians); // Used for both X and Z components.
    const x = finite(point[0]); // Local anchor X before root yaw.
    const y = finite(point[1]); // Local anchor height is unchanged by yaw-only wall alignment.
    const z = finite(point[2]); // Local anchor Z before root yaw.
    return [x * cosine + z * sine, y, -x * sine + z * cosine];
  }

  function targetPoint(placement) {
    const point = Array.isArray(placement?.wallPoint) ? placement.wallPoint : [0, 0, 0]; // Base point sampled from the wall hit.
    const basis = wallBasis(placement?.wallNormal); // Converts logical U/V/normal values into world-space displacement.
    const u = finite(placement?.offsetU); // Horizontal translation along the wall.
    const v = finite(placement?.offsetV); // Vertical translation along the wall.
    const n = finite(placement?.normalOffset); // Wall-distance translation along the outward normal.
    return [
      finite(point[0]) + basis.tangent[0] * u + basis.normal[0] * n,
      finite(point[1]) + v,
      finite(point[2]) + basis.tangent[2] * u + basis.normal[2] * n,
    ];
  }

  function deriveTransform(attachment, placement, base = null) {
    if (!attachment || !placement) return null;
    const wallNormal = normalizeXZ(placement.wallNormal); // Target wall's outward normal; attachment face points the opposite way.
    const rootYaw = normalizeDegrees(yawOf(wallNormal) + 180 - yawOf(attachment.normal)); // Delta aligns the SELECTED face rather than assuming a furniture-forward axis.
    const rotatedAnchor = rotateY(attachment.anchor, rootYaw); // Required to place the furniture origin so the chosen face actually lands on targetPoint.
    const target = targetPoint(placement); // Wall point plus U/V/normal gizmo offsets.
    const position = [target[0] - rotatedAnchor[0], target[1] - rotatedAnchor[1], target[2] - rotatedAnchor[2]]; // Furniture root position in scene/world space.
    const result = { position, rotY: rootYaw, target, wallNormal }; // Used directly for player meshes and converted to post fields for map records.
    if (base) {
      result.postX = round(position[0] - finite(base.x));
      result.postY = round(position[1] - finite(base.y));
      result.postZ = round(position[2] - finite(base.z));
    }
    return result;
  }

  function placementFromExistingTransform(attachment, rootPosition, rotY, normalOffset = 0) {
    const yaw = finite(rotY); // Existing ordinary furniture yaw is inverted back into a wall normal for lossless conversion.
    const attachmentNormalYaw = yawOf(attachment?.normal); // Authored selected-face yaw before the existing root rotation.
    const wallYaw = normalizeDegrees(yaw + attachmentNormalYaw - 180); // Inverse of deriveTransform's rootYaw equation.
    const wallNormal = [Math.sin(wallYaw * DEG), 0, Math.cos(wallYaw * DEG)]; // Reconstructed wall outward normal.
    const rotatedAnchor = rotateY(attachment?.anchor, yaw); // Finds the current world attachment point without moving the furniture.
    const attachmentPoint = [finite(rootPosition?.x) + rotatedAnchor[0], finite(rootPosition?.y) + rotatedAnchor[1], finite(rootPosition?.z) + rotatedAnchor[2]]; // Exact current face center in world space.
    return {
      version: VERSION,
      wallPoint: [round(attachmentPoint[0] - wallNormal[0] * normalOffset), round(attachmentPoint[1]), round(attachmentPoint[2] - wallNormal[2] * normalOffset)],
      wallNormal: wallNormal.map(value => round(value, 6)),
      offsetU: 0,
      offsetV: 0,
      normalOffset: round(normalOffset),
      space: 'wall-surface-uvn',
    };
  }

  function sourceKeyFor(key, def = null) {
    return String(def?.wallOrnamentSourceKey || def?.procKey || key || ''); // Player aliases resolve back to their canonical authored furniture JSON.
  }

  const FALLBACK_ATTACHMENTS = Object.freeze({
    innSign: Object.freeze({ version: 1, attachmentSurfaceId: 'hanging_sign_post:surface:6', surfacePartId: 'hanging_sign_post', anchor: [0.5, 1.376, 0], normal: [1, 0, 0], basisU: [0, 0, -1], basisV: [0, 1, 0], defaultNormalOffset: 0.01 }),
    generalStoreSign: Object.freeze({ version: 1, attachmentSurfaceId: 'hanging_sign_post:surface:6', surfacePartId: 'hanging_sign_post', anchor: [0.5, 1.376, 0], normal: [1, 0, 0], basisU: [0, 0, -1], basisV: [0, 1, 0], defaultNormalOffset: 0.01 }),
    wallTorch: Object.freeze({ version: 1, attachmentSurfaceId: 'wall_torch_plate:surface:4', surfacePartId: 'wall_torch_plate', anchor: [0, 0.8, -0.02], normal: [0, 0, -1], basisU: [1, 0, 0], basisV: [0, 1, 0], defaultNormalOffset: 0.012 }),
  }); // Used immediately while authored JSON fetches are cold or unavailable.

  async function loadAttachment(key, def = null) {
    const sourceKey = sourceKeyFor(key, def); // Canonical key identifies the authored config and cache entry.
    if (!sourceKey) return null;
    if (attachmentCache.has(sourceKey)) return attachmentCache.get(sourceKey);
    const peek = window.AuthoredFurniture?.peek?.(sourceKey); // Reuses already-loaded game furniture data without another fetch.
    if (peek?.wallOrnament) {
      const metadata = clone(peek.wallOrnament); // Cached copy cannot be mutated by placement UI.
      attachmentCache.set(sourceKey, metadata);
      return metadata;
    }
    if (docsBaseUrl && typeof fetch === 'function') {
      try {
        const url = new URL(`config/furniture-authored/${encodeURIComponent(sourceKey)}.json`, docsBaseUrl); // Works from /docs/index.html and /docs/tools/map-editor/ alike.
        const response = await fetch(url.href); // Authoring record carries the same wallOrnament metadata runtime needs.
        if (response.ok) {
          const data = await response.json(); // Complete furniture record is intentionally not retained here.
          if (data?.wallOrnament) {
            const metadata = clone(data.wallOrnament); // Cache only the small attachment contract.
            attachmentCache.set(sourceKey, metadata);
            return metadata;
          }
        }
      } catch (error) {
        lastError = `attachment fetch ${sourceKey}: ${error?.message || error}`;
      }
    }
    const fallback = FALLBACK_ATTACHMENTS[sourceKey] ? clone(FALLBACK_ATTACHMENTS[sourceKey]) : null; // Keeps the shipped presets usable offline and in static tests.
    if (fallback) attachmentCache.set(sourceKey, fallback);
    return fallback;
  }

  function isWallOrnamentKey(key, def = null) {
    const sourceKey = sourceKeyFor(key, def); // Alias-aware key check is used by Furniture Placer rows and diagnostics.
    return !!def?.wallOrnament || CANONICAL_KEYS.has(sourceKey) || PLAYER_ALIAS_KEYS.has(String(key || ''));
  }

  function isHouseWindowKey(key) {
    return !!window.HouseWindowLinkage?.isWindowKey?.(key); // Windows have stricter outside-slot placement than signs/torches.
  }

  function registerDecorDefs(defs) {
    if (!defs || typeof defs !== 'object') return;
    for (const key of ['innSign', 'generalStoreSign']) {
      const existing = defs[key]; // Existing town fixtures remain fixtures; only metadata marks them as wall-aware for dev map editing.
      if (existing) existing.wallOrnament = true;
    }
    if (!defs.wallInnSign) defs.wallInnSign = { itemKey: 'innSignFurniture', name: 'Hanging Inn Sign', icon: '🪧', color: 0x765536, fw: 1, fd: 1, area: 'any', procKey: 'innSign', wallOrnament: true, wallOrnamentSourceKey: 'innSign' }; // Inventory-placeable alias avoids changing canonical town-fixture semantics.
    if (!defs.wallGeneralStoreSign) defs.wallGeneralStoreSign = { itemKey: 'generalStoreSignFurniture', name: 'Hanging General Store Sign', icon: '🪧', color: 0x765536, fw: 1, fd: 1, area: 'any', procKey: 'generalStoreSign', wallOrnament: true, wallOrnamentSourceKey: 'generalStoreSign' }; // Inventory-placeable alias uses the same revised authored sign.
    if (!defs.wallTorch) defs.wallTorch = { itemKey: 'wallTorchFurniture', name: 'Wall Torch', icon: '🔥', color: 0x60452c, fw: 1, fd: 1, area: 'any', procKey: 'wallTorch', wallOrnament: true, wallOrnamentSourceKey: 'wallTorch' }; // First purpose-built wall-only furniture preset.
  }

  const WALL_TORCH_PARTS = Object.freeze([
    Object.freeze({ id: 'wall_torch_plate', kind: 'box', name: 'Wall Torch Plate', color: '#5a4029', transform: { x: 0, y: 0.8, z: 0, rx: 0, ry: 0, rz: 0, sx: 0.22, sy: 0.32, sz: 0.04 } }),
    Object.freeze({ id: 'wall_torch_arm', kind: 'beam', name: 'Wall Torch Arm', color: '#4b3523', transform: { x: 0, y: 0.83, z: 0.22, rx: 0, ry: 0, rz: 0, sx: 0.09, sy: 0.09, sz: 0.42 } }),
    Object.freeze({ id: 'wall_torch_shaft', kind: 'cylinder', name: 'Wall Torch Shaft', color: '#6e4b2c', segments: 10, transform: { x: 0, y: 1.04, z: 0.42, rx: 0, ry: 0, rz: 0, sx: 0.08, sy: 0.46, sz: 0.08 } }),
    Object.freeze({ id: 'wall_torch_flame', kind: 'sphere', name: 'Wall Torch Flame', color: '#ff9e3d', transform: { x: 0, y: 1.31, z: 0.42, rx: 0, ry: 0, rz: 0, sx: 0.15, sy: 0.15, sz: 0.15 } }),
  ]); // Shared fallback geometry mirrors docs/config/furniture-authored/wallTorch.json.

  function buildWallTorchGroup(api, baseColor) {
    const THREE = window.THREE; // Uses whichever Three instance owns the active game/tool scene.
    if (!THREE?.Group || !api?.buildPartMesh) return null;
    const group = new THREE.Group(); // Procedural fallback lets wallTorch render even before AuthoredFurniture knows this new key.
    group.name = 'procedural_furniture_wallTorch';
    for (const part of WALL_TORCH_PARTS) {
      const mesh = api.buildPartMesh(clone(part), baseColor); // Standard furniture primitive/material pipeline remains authoritative.
      if (!mesh) continue;
      mesh.userData.wallTorchPartId = part.id;
      if (part.id === 'wall_torch_flame' && THREE.MeshBasicMaterial) mesh.material = new THREE.MeshBasicMaterial({ color: 0xff9e3d }); // Flame stays luminous without adding a custom shader.
      group.add(mesh);
    }
    if (THREE.PointLight) {
      const light = new THREE.PointLight(0xffa04a, 0.85, 5, 2); // Light is parented to the furniture so wall gizmo transforms move it automatically.
      light.name = 'WallTorchLight';
      light.position.set(0, 1.31, 0.42);
      group.add(light);
    }
    group.userData.wallOrnamentKey = 'wallTorch';
    return group;
  }

  function patchProceduralFurniture(api) {
    if (!api || api.__wallOrnamentPatched || typeof api.buildFurnitureGroup !== 'function') return;
    const originalBuild = api.buildFurnitureGroup.bind(api); // Preserves every existing furniture recipe and later wrapper behavior.
    api.buildFurnitureGroup = function wallOrnamentBuildFurnitureGroup(key, baseColor) {
      if (key === 'wallTorch') return buildWallTorchGroup(api, baseColor) || originalBuild(key, baseColor);
      return originalBuild(key, baseColor);
    };
    api.__wallOrnamentPatched = true;
  }

  function playerStorageKey() {
    let layoutKey = 'default'; // Falls back safely during very early boot before FarmEditor dependencies are ready.
    try { layoutKey = window.FarmEditor?.farmLayoutKey?.() || layoutKey; } catch (_) {}
    return `${PLAYER_STORE_PREFIX}${layoutKey}`;
  }

  function readPlayerStore() {
    try {
      const parsed = JSON.parse(localStorage.getItem(playerStorageKey()) || 'null'); // Separate sidecar remains backward-compatible with every previous runtime revision.
      if (parsed?.placements && typeof parsed.placements === 'object') {
        return Object.assign({}, parsed, { version: PLAYER_STORE_SCHEMA_VERSION, placements: parsed.placements }); // v1/v2/v3 runtime-written stores all use the same placement shape; never discard them because code VERSION changed.
      }
    } catch (error) { lastError = `wall store read: ${error?.message || error}`; }
    return { version: PLAYER_STORE_SCHEMA_VERSION, placements: {} };
  }

  function writePlayerStore(store) {
    try {
      const normalized = Object.assign({}, store || {}, { version: PLAYER_STORE_SCHEMA_VERSION, placements: store?.placements && typeof store.placements === 'object' ? store.placements : {} }); // Future runtime bumps keep writing the stable storage contract.
      localStorage.setItem(playerStorageKey(), JSON.stringify(normalized));
    } catch (error) { lastError = `wall store write: ${error?.message || error}`; }
  }

  function isPlayerMounted(id) {
    return !!readPlayerStore().placements?.[id]; // Furniture Placer uses this to label Wall Mount vs Adjust Wall.
  }

  function placedObjectById(id) {
    return farmDeps?.interiorFurnitureObjects?.find?.(object => object?.id === id) || null; // Stable saved decor id joins the ordinary farm layout to wall metadata.
  }

  function notifyPlayerPlacementChanged(id, placement, object = placedObjectById(id)) {
    for (const listener of playerPlacementListeners) { // Extension callbacks run only on explicit saves, never in the low-frequency restore pass.
      try {
        const pending = listener(id, clone(placement), object); // A clone prevents one extension from mutating another extension's save view.
        if (pending?.catch) pending.catch(error => { lastError = `wall placement listener ${id}: ${error?.message || error}`; });
      } catch (error) { lastError = `wall placement listener ${id}: ${error?.message || error}`; }
    }
  }

  function notifyPlayerPlacementRemoved(id, placement, object = placedObjectById(id)) {
    for (const listener of playerPlacementRemovalListeners) { // Removal hooks let paired wall objects clean up their synthetic counterpart before the ordinary furniture record is refunded.
      try {
        const pending = listener(id, clone(placement), object); // The removed logical record is immutable from the listener's point of view.
        if (pending?.catch) pending.catch(error => { lastError = `wall removal listener ${id}: ${error?.message || error}`; });
      } catch (error) { lastError = `wall removal listener ${id}: ${error?.message || error}`; }
    }
  }

  function onPlayerPlacementChanged(listener) {
    if (typeof listener !== 'function') return () => {};
    playerPlacementListeners.add(listener); // Used by cross-scene links such as farmhouse windows.
    return () => playerPlacementListeners.delete(listener);
  }

  function onPlayerPlacementRemoved(listener) {
    if (typeof listener !== 'function') return () => {};
    playerPlacementRemovalListeners.add(listener); // Used by cross-scene links to tear down derived peers without inventory duplication.
    return () => playerPlacementRemovalListeners.delete(listener);
  }

  function getPlayerPlacement(id) {
    return clone(readPlayerStore().placements?.[id] || null); // Public read is detached so callers cannot mutate persisted data accidentally.
  }

  function getAllPlayerPlacements() {
    return clone(readPlayerStore().placements || {}); // Restore/migration helpers can scan wall records without knowing the sidecar storage key.
  }

  function objectDef(object) {
    return placerDeps?.getDecorativeFurnitureDefs?.()?.[object?.key] || farmDeps?.DECORATIVE_FURNITURE_DEFS?.[object?.key] || null; // Resolves alias -> canonical authored source and display metadata.
  }

  function setMeshTransform(object, attachment, placement) {
    const mesh = object?.mesh; // Ordinary furniture root remains the only visual object transformed by the wall system.
    if (!mesh || !attachment || !placement) return null;
    const derived = deriveTransform(attachment, placement); // Same pure solver powers player and Map Editor placement.
    if (!derived) return null;
    const oldPosition = mesh.position?.clone?.(); // Used to keep any legacy separately-parented light/sfx helpers translated with the visible group.
    mesh.position?.set?.(derived.position[0], derived.position[1], derived.position[2]);
    if (mesh.rotation) mesh.rotation.y = derived.rotY * DEG;
    object.rotYDeg = derived.rotY; // Saved primary/peer yaw now always matches the normal it is actually mounted to.
    if (mesh.userData) mesh.userData.wallOrnamentDerivedYawDeg = derived.rotY; // Mobile-visible diagnostics can verify the solved facing.
    if (oldPosition && object.light?.position?.add) {
      const delta = mesh.position.clone().sub(oldPosition); // Applies only translation; wall torch's new light is parented and needs no helper sync.
      object.light.position.add(delta);
    }
    if (object.sfxSource && typeof object.sfxSource === 'object') {
      object.sfxSource.x = derived.position[0]; // Keeps furniture-local audio approximately co-located with a mounted object.
      object.sfxSource.z = derived.position[2];
    }
    const signature = JSON.stringify(placement); // Cheap marker prevents the restore timer from rewriting unchanged meshes.
    mesh.userData.wallOrnamentPlacementSignature = signature;
    mesh.userData.wallOrnamentMounted = true;
    return derived;
  }

  async function applyStoredPlayerPlacement(object, placement) {
    const def = objectDef(object); // Alias metadata selects the canonical authored attachment JSON.
    const attachment = await loadAttachment(object?.key, def); // Async only on first encounter; cache makes subsequent restores immediate.
    if (!attachment || !object?.mesh) return false;
    const signature = JSON.stringify(placement); // Compared before transform application to keep the low-frequency restore pass cheap.
    if (object.mesh.userData.wallOrnamentPlacementSignature === signature) return true;
    return !!setMeshTransform(object, attachment, placement);
  }

  function syncStoredPlayerPlacements() {
    if (!farmDeps?.interiorFurnitureObjects?.length) return;
    const store = readPlayerStore(); // One localStorage read per low-frequency restore pass, never per frame.
    for (const object of farmDeps.interiorFurnitureObjects) {
      const placement = store.placements?.[object?.id]; // Only objects with explicit wall metadata are touched.
      if (placement) applyStoredPlayerPlacement(object, placement).catch(error => { lastError = `restore ${object.id}: ${error?.message || error}`; });
    }
  }

  function ensurePlayerSyncTimer() {
    if (playerSyncTimer || typeof window.setInterval !== 'function') return;
    playerSyncTimer = window.setInterval(syncStoredPlayerPlacements, 450); // Handles farm/interior scene rebuilds without introducing a per-frame operation.
  }

  function toast(message, ok = true) {
    placerDeps?.showToast?.(message, ok); // Reuses the game's mobile-visible toast path when Furniture Placer has initialized.
  }

  function ensurePlayerPanel() { return null; }
  function refreshPlayerPanel() {}

  function basisQuaternion(normalValues) {
    const THREE = window.THREE; // Proxy quaternion must use the active Three instance.
    if (!THREE?.Matrix4 || !THREE?.Quaternion) return null;
    const basis = wallBasis(normalValues); // Local X/Y/Z are wall tangent/up/normal exactly as requested.
    const matrix = new THREE.Matrix4(); // Matrix basis converts those three axes into a proxy orientation.
    matrix.makeBasis(new THREE.Vector3(...basis.tangent), new THREE.Vector3(...basis.up), new THREE.Vector3(...basis.normal));
    return new THREE.Quaternion().setFromRotationMatrix(matrix);
  }

  function persistPlayerPlacement(id, placement) {
    const store = readPlayerStore(); // Reads current store to avoid clobbering another ornament adjusted earlier in the same session.
    const prior = store.placements[id] || {}; // Extension metadata not edited by the wall gizmo is retained across ordinary U/V/N adjustments.
    const priorPoint = Array.isArray(prior.wallPoint) ? prior.wallPoint : null; // Used to distinguish same-surface gizmo edits from an explicit Pick-wall retarget.
    const nextPoint = Array.isArray(placement?.wallPoint) ? placement.wallPoint : null; // Newly requested base wall point for the same-surface check.
    const samePickedSurface = !!(priorPoint && nextPoint && Math.hypot(finite(priorPoint[0]) - finite(nextPoint[0]), finite(priorPoint[1]) - finite(nextPoint[1]), finite(priorPoint[2]) - finite(nextPoint[2])) < 1e-5); // Re-picking another wall intentionally drops extension metadata tied to the old surface.
    const next = samePickedSurface ? Object.assign({}, clone(prior), clone(placement)) : clone(placement); // Exact extension APIs below can also replace/remove metadata intentionally.
    store.placements[id] = next;
    writePlayerStore(store);
    notifyPlayerPlacementChanged(id, next);
  }

  async function setPlayerPlacement(id, placement, options = {}) {
    const store = readPlayerStore(); // Exact setter is used by paired wall systems when they derive a peer transform.
    const next = clone(placement);
    if (!id || !next) return false;
    store.placements[id] = next;
    writePlayerStore(store);
    const object = placedObjectById(id); // Applies immediately when the ordinary furniture mesh is currently live.
    if (playerObject?.id === id) {
      playerPlacement = clone(next);
      if (playerAttachment) setMeshTransform(playerObject, playerAttachment, playerPlacement);
    }
    if (options.apply !== false && object) await applyStoredPlayerPlacement(object, next);
    if (options.notify !== false) notifyPlayerPlacementChanged(id, next, object);
    return true;
  }

  function removePlayerPlacement(id, options = {}) {
    const store = readPlayerStore(); // Sidecar-only removal is useful for synthetic peers that should not be floor-restored/refunded.
    const removed = store.placements?.[id];
    if (!removed) return false;
    delete store.placements[id];
    writePlayerStore(store);
    if (options.notify !== false) notifyPlayerPlacementRemoved(id, removed);
    return true;
  }

  async function adjustPlayerObject(id) {
    const object = placedObjectById(id);
    if (!object) { toast('That furniture is no longer present.', false); return false; }
    const def = objectDef(object);
    if (!isWallOrnamentKey(object.key, def)) { toast('That furniture has no authored wall attachment surface.', false); return false; }
    if (object.derivedLinkedWindow) { toast('Move the window from outside; the interior copy follows automatically.', false); return false; }
    if (isHouseWindowKey(object.key) && object.area !== 'farm') { toast('Windows can only be positioned from the outside.', false); return false; }
    const attachment = await loadAttachment(object.key, def);
    if (!attachment) { toast('Wall attachment metadata could not be loaded.', false); return false; }
    cancelPlayerAdjustment(false);
    playerObject = object;
    playerAttachment = attachment;
    playerMode = 'move';
    playerOriginalPlacement = clone(readPlayerStore().placements?.[id] || null);
    playerOriginalTransform = {
      position: [finite(object.mesh?.position?.x), finite(object.mesh?.position?.y), finite(object.mesh?.position?.z)],
      rotY: finite(object.mesh?.rotation?.y) / DEG,
      visible: object.mesh?.visible !== false,
    };
    playerPlacement = playerOriginalPlacement ? clone(playerOriginalPlacement) : null;
    playerPickWall = true;
    playerPreviewValid = false;
    window.__wallOrnamentReticlePlacementActive = true;
    updatePlayerReticlePreview();
    toast('Aim at a wall. Action 1 places it there; Action 2 cancels. Camera and movement stay live.', true);
    return true;
  }

  function clearPlayerAimState() {
    playerObject = null; playerPlacement = null; playerAttachment = null;
    playerMode = null; playerArmedItemKey = null;
    playerOriginalPlacement = null; playerOriginalTransform = null;
    playerPickWall = false; playerPreviewValid = false;
    window.__wallOrnamentReticlePlacementActive = false;
  }

  function cancelPlayerAdjustment(showMessage = false) {
    if (!playerObject) { clearPlayerAimState(); return false; }
    if (playerMode === 'new') {
      playerObject.mesh?.parent?.remove?.(playerObject.mesh);
    } else if (playerMode === 'move') {
      if (playerOriginalPlacement && playerAttachment) setMeshTransform(playerObject, playerAttachment, playerOriginalPlacement);
      else if (playerOriginalTransform && playerObject.mesh) {
        playerObject.mesh.position?.set?.(...playerOriginalTransform.position);
        if (playerObject.mesh.rotation) playerObject.mesh.rotation.y = playerOriginalTransform.rotY * DEG;
      }
      if (playerObject.mesh) playerObject.mesh.visible = playerOriginalTransform?.visible !== false;
    }
    clearPlayerAimState();
    if (showMessage) toast('Wall placement cancelled.', true);
    return true;
  }

  function finishPlayerAdjustment() { return cancelPlayerAdjustment(false); }

  function unmountPlayerObject(id) {
    const object = placedObjectById(id); // Mounted object is restored to the transform it had immediately before first wall targeting.
    const store = readPlayerStore(); // Logical placement and captured base transform live together in the sidecar save.
    const placement = store.placements?.[id];
    if (object?.mesh && placement?.baseTransform) {
      const base = placement.baseTransform; // Ordinary tile placement pose captured before wall mounting.
      object.mesh.position.set(finite(base.position?.[0]), finite(base.position?.[1]), finite(base.position?.[2]));
      object.mesh.rotation.y = finite(base.rotY) * DEG;
      delete object.mesh.userData.wallOrnamentPlacementSignature;
      delete object.mesh.userData.wallOrnamentMounted;
    }
    if (playerObject?.id === id) finishPlayerAdjustment(false); // Do not immediately re-save the placement that Unmount is deleting.
    delete store.placements[id];
    writePlayerStore(store);
    notifyPlayerPlacementRemoved(id, placement, object);
    toast('Wall mount removed; furniture returned to its floor placement.', true);
    window.FurniturePlacer?.render?.();
  }

  function rootLooksLikeFurniture(node) {
    let current = node; // Walks ancestors so a clicked child mesh can be excluded if it belongs to any furniture root.
    while (current) {
      const name = String(current.name || ''); // Existing authored/procedural furniture roots have stable name prefixes.
      if (/^(authored|procedural)_furniture_/i.test(name) || current.userData?.wallOrnamentProxy) return true;
      current = current.parent;
    }
    return false;
  }

  function isExplicitPlayerWallTarget(node) {
    let current = node;
    while (current) {
      const data = current.userData || {};
      if (data.isWallBricks || data.interiorWallSurfaceGroup || data.interiorWallPanelId || data.interiorWallPlane || data.housePieceWallSurface) return true;
      current = current.parent;
    }
    return false;
  }

  function wallHitFromNdc(ndc, scene, camera, ignoredRoot = null, explicitWallsOnly = false) {
    const THREE = window.THREE;
    if (!THREE?.Raycaster || !scene || !camera || !ndc) return null;
    const raycaster = new THREE.Raycaster(); // Explicit wall picks are infrequent, so this remains off the frame hot path.
    raycaster.setFromCamera(ndc, camera);
    const meshes = []; // Candidate vertical surfaces excluding the ornament/gizmo/furniture itself.
    scene.traverse?.(node => {
      if (!node?.isMesh || node.visible === false) return;
      if (ignoredRoot && (node === ignoredRoot || ignoredRoot.getObjectById?.(node.id))) return;
      if (rootLooksLikeFurniture(node)) return;
      if (/TransformControls|Gizmo|Helper/i.test(String(node.name || ''))) return;
      if (explicitWallsOnly && !isExplicitPlayerWallTarget(node)) return;
      meshes.push(node);
    });
    const hits = raycaster.intersectObjects(meshes, false); // Nearest usable vertical face wins.
    for (const hit of hits) {
      if (!hit?.face?.normal || !hit.point) continue;
      const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld); // Converts triangle-local normal into world coordinates.
      if (Math.abs(normal.y) > 0.72) continue; // Floors/ceilings/steep roofs are not wall targets.
      normal.y = 0;
      if (normal.lengthSq() < 1e-6) continue;
      normal.normalize();
      if (normal.dot(raycaster.ray.direction) > 0) normal.negate(); // Keeps wall normal facing the picker/camera regardless triangle winding.
      return { point: hit.point.clone(), normal, object: hit.object, distance: hit.distance };
    }
    return null;
  }

  function wallHitFromPointer(event, scene, camera, renderer, ignoredRoot = null) {
    const THREE = window.THREE; // Mouse/touch uses the actual pointer coordinate while controller uses screen center below.
    if (!THREE?.Vector2 || !renderer?.domElement) return null;
    const rect = renderer.domElement.getBoundingClientRect(); // Converts pointer CSS coordinates into Three NDC.
    const ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -(((event.clientY - rect.top) / rect.height) * 2 - 1));
    return wallHitFromNdc(ndc, scene, camera, ignoredRoot);
  }

  function wallHitFromReticle(scene, camera, ignoredRoot = null) {
    const THREE = window.THREE; // Controller/keyboard wall targeting always uses the gameplay reticle at screen center.
    if (!THREE?.Vector2) return null;
    return wallHitFromNdc(new THREE.Vector2(0, 0), scene, camera, ignoredRoot, true);
  }

  function placementFromPlayerWallHit(hit) {
    if (!hit || !playerAttachment) return null;
    return {
      version: VERSION,
      wallPoint: [round(hit.point.x), round(hit.point.y), round(hit.point.z)],
      wallNormal: [round(hit.normal.x, 6), 0, round(hit.normal.z, 6)],
      offsetU: 0, offsetV: 0,
      normalOffset: round(finite(playerAttachment.defaultNormalOffset, 0.01)),
      space: 'wall-surface-uvn',
    };
  }

  function updatePlayerReticlePreview() {
    if (!playerObject || !playerAttachment || !runtimeDeps?.camera) return false;
    const hit = wallHitFromReticle(runtimeDeps.getActiveScene?.(), runtimeDeps.camera, playerObject.mesh);
    if (!hit) {
      playerPreviewValid = false;
      if (playerObject.mesh) playerObject.mesh.visible = false;
      return false;
    }
    const rawPlacement = placementFromPlayerWallHit(hit);
    playerPlacement = isHouseWindowKey(playerObject.key)
      ? window.HouseWindowLinkage?.snapExteriorPlayerPlacement?.(playerObject.key, rawPlacement, playerObject.id || null)
      : rawPlacement;
    if (!playerPlacement) {
      playerPreviewValid = false;
      if (playerObject.mesh) playerObject.mesh.visible = false;
      return false;
    }
    setMeshTransform(playerObject, playerAttachment, playerPlacement);
    if (playerObject.mesh) playerObject.mesh.visible = true;
    playerPreviewValid = true;
    return true;
  }

  function playerAnchorCell(placement, area) {
    const point = placement?.wallPoint || [0,0,0];
    const normal = placement?.wallNormal || [0,0,0];
    const inward = area === 'interior' ? 0.05 : 0;
    return { col: Math.floor(finite(point[0]) + finite(normal[0]) * inward), row: Math.floor(finite(point[2]) + finite(normal[2]) * inward) };
  }

  async function armNewPlayerFurniture(itemKey) {
    const defs = placerDeps?.getDecorativeFurnitureDefs?.() || farmDeps?.DECORATIVE_FURNITURE_DEFS || {};
    const entry = Object.entries(defs).find(([, def]) => def?.itemKey === itemKey);
    const key = entry?.[0], def = entry?.[1];
    if (!key || !def || !isWallOrnamentKey(key, def)) return false;
    if ((placerDeps?.inventory?.[itemKey] || 0) < 1) { toast(`No ${def.name || 'wall furniture'} in inventory.`, false); return false; }
    const attachment = await loadAttachment(key, def);
    if (!attachment) { toast('Wall attachment metadata could not be loaded.', false); return false; }
    const area = farmDeps?.getCurrentArea?.();
    if (isHouseWindowKey(key) && area !== 'farm') {
      toast('Windows can only be placed from outside the farmhouse.', false);
      return false;
    }
    const scene = area === 'interior' ? farmDeps?.getInteriorScene?.() : farmDeps?.getScene?.();
    const mesh = farmDeps?.buildFurnitureVisual?.(key, def.color || 0x8b6540);
    if (!scene || !mesh) { toast('Could not create wall-furniture preview.', false); return false; }
    cancelPlayerAdjustment(false);
    scene.add(mesh); mesh.visible = false;
    playerObject = { id:null, key, mesh, light:null, sfxSource:null, area, rotYDeg:0, wallPlacementPreview:true };
    playerAttachment = attachment; playerMode = 'new'; playerArmedItemKey = itemKey;
    playerPlacement = null; playerPickWall = true; playerPreviewValid = false;
    window.__wallOrnamentReticlePlacementActive = true;
    updatePlayerReticlePreview();
    toast(isHouseWindowKey(key)
      ? 'Aim at the outside wall. Windows snap to one fixed slot per 2 tiles; Action 1 places, Action 2 cancels.'
      : 'Aim at a wall and press Action 1 to place. Action 2 cancels.', true);
    return true;
  }

  function confirmPlayerReticlePlacement() {
    if (!playerObject || !playerAttachment) return false;
    updatePlayerReticlePreview();
    if (!playerPreviewValid || !playerPlacement) {
      toast(isHouseWindowKey(playerObject.key) ? 'Aim at an unused exterior window slot (one per 2 wall tiles).' : 'Aim at an actual wall surface first.', false);
      return false;
    }
    const placement = clone(playerPlacement), area = playerObject.area || farmDeps?.getCurrentArea?.();
    const anchor = playerAnchorCell(placement, area);
    if (playerMode === 'new') {
      const itemKey = playerArmedItemKey;
      const defs = placerDeps?.getDecorativeFurnitureDefs?.() || farmDeps?.DECORATIVE_FURNITURE_DEFS || {};
      const def = defs[playerObject.key];
      if (!itemKey || !def || (placerDeps?.inventory?.[itemKey] || 0) < 1) { toast('That furniture is no longer available.', false); return false; }
      const preview = playerObject.mesh;
      preview?.parent?.remove?.(preview);
      const scene = area === 'interior' ? farmDeps?.getInteriorScene?.() : farmDeps?.getScene?.();
      const result = farmDeps?.makeDecorativeFurnitureMesh?.(anchor.col, anchor.row, playerObject.key, scene, area, 0);
      if (!result) { scene?.add?.(preview); playerObject.mesh = preview; toast('Could not place wall furniture there.', false); return false; }
      placerDeps.inventory[itemKey]--; placerDeps.clampInventoryStack?.(itemKey);
      const owner = area === 'interior' ? (farmDeps?.furnitureOwnerFields?.(anchor.col, anchor.row) || {}) : {};
      const object = { id:'decor_'+Math.random().toString(36).slice(2,10), key:playerObject.key, col:anchor.col, row:anchor.row,
        mesh:result.mesh, light:result.light, sfxSource:result.sfxSource, area, rotYDeg:0, ...owner };
      farmDeps?.interiorFurnitureObjects?.push?.(object);
      playerObject = object;
      setMeshTransform(object, playerAttachment, placement);
      persistPlayerPlacement(object.id, placement);
      window.FarmEditor?.saveFarmLayout?.();
      window.HudUpdate?.refreshItemScroll?.();
      toast(`${def.icon || '🪟'} ${def.name || 'Wall furniture'} mounted.`, true);
      clearPlayerAimState(); window.FurniturePlacer?.render?.(); return true;
    }
    if (playerMode === 'move') {
      playerObject.col = anchor.col; playerObject.row = anchor.row;
      if (area === 'interior') Object.assign(playerObject, farmDeps?.furnitureOwnerFields?.(anchor.col, anchor.row) || {});
      if (playerObject.mesh) playerObject.mesh.visible = true;
      persistPlayerPlacement(playerObject.id, placement);
      window.FarmEditor?.saveFarmLayout?.();
      toast('Wall furniture moved.', true);
      clearPlayerAimState(); window.FurniturePlacer?.render?.(); return true;
    }
    return false;
  }

  function isPlayerReticlePlacementActive() {
    return !!(playerObject && playerAttachment && (playerMode === 'new' || playerMode === 'move'));
  }

  function canConfirmPlayerReticlePlacement() {
    return isPlayerReticlePlacementActive() && !!playerPreviewValid && !!playerPlacement; // Read-only action-bar gate; confirm itself still revalidates before placement.
  }

  function handleGameplayAction(actionId, phase = 'press') {
    const id = String(actionId || '');
    if (phase === 'release' && playerClaimedActions.has(id)) { playerClaimedActions.delete(id); return true; }
    if (!isPlayerReticlePlacementActive() || phase !== 'press') return false;
    if (id !== 'action1' && id !== 'action2') return false;
    playerClaimedActions.add(id);
    if (id === 'action1') confirmPlayerReticlePlacement(); else cancelPlayerAdjustment(true);
    return true;
  }

  function sharedControllerFrame() {
    if (isPlayerReticlePlacementActive()) updatePlayerReticlePreview();
  }

  function installModernInputBridge() {
    if (!controllerUnsubscribe && window.ControllerInput?.subscribe) {
      const priority = Math.max(1, Number(window.ControllerInput.PRIORITY?.menuNav || 10) - 2);
      controllerUnsubscribe = window.ControllerInput.subscribe('wall-ornament-placement', sharedControllerFrame, priority);
    }
  }

  function patchFarmEditor(api) {
    if (!api || api.__wallOrnamentPatched || typeof api.init !== 'function') return;
    const originalInit = api.init.bind(api); // Captures existing farm-editor dependencies without changing its save/layout behavior.
    api.init = function wallOrnamentFarmInit(injected, ...rest) {
      farmDeps = injected;
      registerDecorDefs(injected?.DECORATIVE_FURNITURE_DEFS);
      const result = originalInit(injected, ...rest);
      ensurePlayerSyncTimer();
      return result;
    };
    api.__wallOrnamentPatched = true;
  }

  function patchFurniturePlacer(api) {
    if (!api || api.__wallOrnamentPatched || typeof api.init !== 'function') return;
    const originalInit = api.init.bind(api); // Captures inventory/catalog helpers while FurniturePlacer continues owning ordinary placement/removal.
    api.init = function wallOrnamentFurniturePlacerInit(injected, ...rest) {
      placerDeps = injected;
      registerDecorDefs(injected?.getDecorativeFurnitureDefs?.());
      ensurePlayerSyncTimer();
      return originalInit(injected, ...rest);
    };
    api.__wallOrnamentPatched = true;
  }

  function patchMapRuntime(api) {
    if (!api || api.__wallOrnamentPatched || typeof api.init !== 'function') return;
    const originalInit = api.init.bind(api); // Captures camera/renderer/active-scene access for player wall picking and gizmos.
    api.init = function wallOrnamentMapRuntimeInit(injected, ...rest) {
      runtimeDeps = injected;
      const result = originalInit(injected, ...rest);
      ensurePlayerSyncTimer();
      return result;
    };
    api.__wallOrnamentPatched = true;
  }

  function futureGlobal(name, patch) {
    if (window[name]) patch(window[name]);
    const descriptor = Object.getOwnPropertyDescriptor(window, name); // Setter wrapper catches modules assigned after this companion script loads.
    if (descriptor && descriptor.configurable === false) return;
    const previousGet = descriptor?.get; // Preserves any older integration shim already watching this global.
    const previousSet = descriptor?.set; // Preserves any older integration shim already watching this global.
    let value = descriptor?.value; // Backing value used when the original property was a normal writable field.
    Object.defineProperty(window, name, {
      configurable: true,
      enumerable: descriptor?.enumerable ?? true,
      get() { return previousGet ? previousGet.call(window) : value; },
      set(next) {
        if (previousSet) previousSet.call(window, next); else value = next;
        patch(previousGet ? previousGet.call(window) : (previousSet ? next : value));
      },
    });
  }

  function mapUiValue(id, fallback = 0) {
    return finite(document.getElementById(id)?.value, fallback); // Shared direct-value reader for Map Editor U/V/normal controls.
  }

  function ensureMapEditorUi() {
    if (document.getElementById('wallOrnamentMapControls')) return;
    const bar = document.getElementById('gizmo3dBar'); // Existing 3D placement controls are the natural host for wall-space mode.
    if (!bar?.parentElement) return;
    const panel = document.createElement('div'); // Companion panel avoids editing the very large Map Editor HTML.
    panel.id = 'wallOrnamentMapControls';
    panel.style.cssText = 'margin:6px 0;padding:8px;border:1px solid #394450;border-radius:7px;background:#151a20;font-size:12px';
    panel.innerHTML = `<div style="font-weight:700;margin-bottom:5px">Wall Ornaments</div><div style="display:flex;gap:5px;flex-wrap:wrap"><select id="wallOrnamentMapPreset"><option value="innSign">Inn Sign</option><option value="generalStoreSign">General Store Sign</option><option value="wallTorch">Wall Torch</option></select><button id="wallOrnamentMapPlace">Place on wall</button><button id="wallOrnamentMapConvert">Convert selected</button></div><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:5px;margin-top:6px"><label>Wall X<input id="wallOrnamentMapU" type="number" step="0.01" style="width:100%"></label><label>Wall Y<input id="wallOrnamentMapV" type="number" step="0.01" style="width:100%"></label><label>Wall distance<input id="wallOrnamentMapN" type="number" step="0.005" style="width:100%"></label></div><div id="wallOrnamentMapReadout" style="opacity:.72;margin-top:5px">Select a wall ornament or arm placement.</div>`;
    bar.parentElement.insertBefore(panel, bar.nextSibling);
    document.getElementById('wallOrnamentMapPlace').addEventListener('click', () => {
      mapEditorArmKey = document.getElementById('wallOrnamentMapPreset')?.value || 'wallTorch'; // Next 3D click samples target wall point/normal.
      const button = document.getElementById('wallOrnamentMapPlace'); // Visible armed state avoids hidden keyboard-only editor modes.
      if (button) button.textContent = `Click wall for ${mapEditorArmKey}`;
    });
    document.getElementById('wallOrnamentMapConvert').addEventListener('click', convertSelectedMapPlacement);
    for (const id of ['wallOrnamentMapU', 'wallOrnamentMapV', 'wallOrnamentMapN']) document.getElementById(id)?.addEventListener('change', syncMapRecordFromInputs);
  }

  function mapActiveRecord() {
    try { return typeof active3DRecord === 'function' ? active3DRecord() : null; } catch (_) { return null; } // Uses Map Editor's canonical selected placement lookup.
  }

  function mapRecordDef(record) {
    try { return typeof DECOR !== 'undefined' ? DECOR[record?.key] : null; } catch (_) { return null; } // Reads the Map Editor's in-memory Decor palette entry.
  }

  function updateMapPanel(record = mapActiveRecord()) {
    if (typeof document === 'undefined') return;
    const placement = record?.wallAttachment; // Nested logical record remains authoritative while post transforms are derived compatibility output.
    const u = document.getElementById('wallOrnamentMapU'); // Surface-horizontal direct value.
    const v = document.getElementById('wallOrnamentMapV'); // Surface-vertical direct value.
    const n = document.getElementById('wallOrnamentMapN'); // Surface-normal distance direct value.
    for (const input of [u, v, n]) if (input) input.disabled = !placement;
    if (placement) {
      if (u) u.value = round(placement.offsetU);
      if (v) v.value = round(placement.offsetV);
      if (n) n.value = round(placement.normalOffset);
    }
    const readout = document.getElementById('wallOrnamentMapReadout'); // Shows mode/selection diagnostics inside the tool itself.
    if (readout) readout.textContent = placement ? `${record.key} · local gizmo X/Y = wall plane, Z = wall distance · wall normal ${normalizeXZ(placement.wallNormal).map(value => value.toFixed(2)).join(', ')}` : (record && isWallOrnamentKey(record.key, mapRecordDef(record)) ? `${record.key} can be converted without moving it.` : 'Select a wall ornament or arm placement.');
  }

  async function applyMapRecord(record, mesh, attachment = null) {
    if (!record?.wallAttachment || !mesh?.userData?.placementBase) return false;
    const metadata = attachment || await loadAttachment(record.key, mapRecordDef(record)); // Authoring-selected face frame is the same one used by player mounting.
    if (!metadata) return false;
    const derived = deriveTransform(metadata, record.wallAttachment, mesh.userData.placementBase); // Produces ordinary map post fields for backward-compatible runtime rendering.
    if (!derived) return false;
    record.postX = derived.postX;
    record.postY = derived.postY;
    record.postZ = derived.postZ;
    record.rotY = round(derived.rotY, 1);
    mesh.position.set(derived.position[0], derived.position[1], derived.position[2]);
    mesh.rotation.y = derived.rotY * DEG;
    return true;
  }

  function mapProxyPlacementFromPosition() {
    if (!mapProxyState?.record?.wallAttachment || !mapProxy) return;
    const placement = mapProxyState.record.wallAttachment; // Existing wall point stays fixed; proxy displacement becomes U/V/N.
    const point = placement.wallPoint || [0, 0, 0]; // Original target wall sample before gizmo offsets.
    const delta = [mapProxy.position.x - finite(point[0]), mapProxy.position.y - finite(point[1]), mapProxy.position.z - finite(point[2])]; // World displacement projected to wall basis.
    const basis = wallBasis(placement.wallNormal); // Local proxy X/Y/Z and these projection axes are identical.
    placement.offsetU = round(delta[0] * basis.tangent[0] + delta[2] * basis.tangent[2]);
    placement.offsetV = round(delta[1]);
    placement.normalOffset = round(delta[0] * basis.normal[0] + delta[2] * basis.normal[2]);
    applyMapRecord(mapProxyState.record, mapProxyState.mesh, mapProxyState.attachment).then(() => updateMapPanel(mapProxyState.record));
  }

  async function attachMapProxy(record, mesh) {
    if (!record?.wallAttachment || !mesh || typeof three3d === 'undefined') return;
    const attachment = await loadAttachment(record.key, mapRecordDef(record)); // Cache-backed after first selection.
    if (!attachment) return;
    const THREE = window.THREE; // Map Editor's existing Three instance owns the proxy and TransformControls.
    if (!mapProxy) {
      mapProxy = new THREE.Object3D(); // Invisible local-space translation target prevents gizmo axes from inheriting furniture-specific yaw.
      mapProxy.name = 'WallOrnamentMapProxy';
      mapProxy.userData.wallOrnamentProxy = true;
      three3d.scene.add(mapProxy);
      three3d.transform.addEventListener('objectChange', () => { if (three3d.transform.object === mapProxy) mapProxyPlacementFromPosition(); }); // Existing generic listener runs first; this companion then restores logical wall-derived fields.
      three3d.transform.addEventListener('dragging-changed', event => {
        if (event.value || three3d.transform.object !== mapProxy || !mapProxyState) return;
        try { saveWorkspace(); refreshPreview(); draw(); } catch (_) {} // Persist once at drag end while objectChange handles live preview during the drag.
      });
    }
    mapProxyState = { record, mesh, attachment };
    const target = targetPoint(record.wallAttachment); // Proxy origin is the logical contact target after U/V/N offsets.
    mapProxy.position.set(target[0], target[1], target[2]);
    const quaternion = basisQuaternion(record.wallAttachment.wallNormal); // X/Y plane + Z normal matches player controls exactly.
    if (quaternion) mapProxy.quaternion.copy(quaternion);
    three3d.transform.detach();
    three3d.transform.setMode('translate');
    three3d.transform.setSpace?.('local');
    three3d.transform.attach(mapProxy);
    updateMapPanel(record);
  }

  function detachMapProxy() {
    if (typeof three3d !== 'undefined' && three3d?.transform?.object === mapProxy) three3d.transform.detach();
    mapProxyState = null;
    updateMapPanel();
  }

  async function syncMapSelection() {
    if (typeof three3d === 'undefined') return;
    const record = mapActiveRecord(); // Selected record may have changed through ordinary 3D click selection.
    const ref = typeof _3dSelected !== 'undefined' ? _3dSelected : null; // Stable map/kind/id ref maintained by the base Map Editor.
    const mesh = ref ? three3d.placementMeshes?.get(`${ref.kind}:${ref.id}`) : null; // Existing placement mesh remains the visible transform target.
    if (record?.wallAttachment && mesh) await attachMapProxy(record, mesh);
    else detachMapProxy();
  }

  function syncMapRecordFromInputs() {
    const state = mapProxyState; // Direct value entry is valid only while a wall ornament is selected and proxy metadata exists.
    if (!state?.record?.wallAttachment) return;
    state.record.wallAttachment.offsetU = mapUiValue('wallOrnamentMapU');
    state.record.wallAttachment.offsetV = mapUiValue('wallOrnamentMapV');
    state.record.wallAttachment.normalOffset = mapUiValue('wallOrnamentMapN');
    const target = targetPoint(state.record.wallAttachment); // Moves proxy without dispatching a synthetic TransformControls event.
    state.mesh && applyMapRecord(state.record, state.mesh, state.attachment);
    if (mapProxy) mapProxy.position.set(target[0], target[1], target[2]);
    try { saveWorkspace(); refreshPreview(); draw(); } catch (_) {}
    updateMapPanel(state.record);
  }

  async function convertSelectedMapPlacement() {
    const record = mapActiveRecord(); // Converts canonical signs/torch already placed with ordinary post fields into logical wall space without moving them.
    const ref = typeof _3dSelected !== 'undefined' ? _3dSelected : null; // Needed to resolve the current visible mesh/root position.
    const mesh = ref && typeof three3d !== 'undefined' ? three3d.placementMeshes?.get(`${ref.kind}:${ref.id}`) : null; // Existing transform is preserved exactly.
    if (!record || !mesh || !isWallOrnamentKey(record.key, mapRecordDef(record))) { try { setStatus('Select a wall ornament first.'); } catch (_) {} return; }
    const attachment = await loadAttachment(record.key, mapRecordDef(record)); // Selected-surface frame determines the inferred wall normal.
    if (!attachment) return;
    record.wallAttachment = placementFromExistingTransform(attachment, mesh.position, mesh.rotation.y / DEG, finite(attachment.defaultNormalOffset, 0.01));
    record.wallAttachment.normalOffset = finite(attachment.defaultNormalOffset, 0.01);
    const basis = wallBasis(record.wallAttachment.wallNormal); // Rebase wallPoint so adding default normal offset still leaves the visible furniture unmoved.
    record.wallAttachment.wallPoint[0] = round(record.wallAttachment.wallPoint[0] - basis.normal[0] * record.wallAttachment.normalOffset);
    record.wallAttachment.wallPoint[2] = round(record.wallAttachment.wallPoint[2] - basis.normal[2] * record.wallAttachment.normalOffset);
    await applyMapRecord(record, mesh, attachment);
    try { saveWorkspace(); refreshPreview(); draw(); } catch (_) {}
    await attachMapProxy(record, mesh);
  }

  async function handleMapWallPick(event) {
    if (!mapEditorArmKey || typeof three3d === 'undefined') return;
    const hit = wallHitFromPointer(event, three3d.scene, three3d.camera, three3d.renderer, null); // Samples the rendered dev preview rather than guessing wall orientation from tile data.
    if (!hit) { try { setStatus('No wall-like surface under that point.'); } catch (_) {} return; }
    event.preventDefault();
    event.stopImmediatePropagation();
    const map = typeof activeMap === 'function' ? activeMap() : null; // New repo placements always belong to the Map Editor workspace, never direct source-file mutation.
    if (!map) return;
    const offset = typeof mapWorldInfo === 'function' ? mapWorldInfo(map) : { offsetC: 0, offsetR: 0 }; // Converts root-scene hit coordinates back to active map-local tiles.
    const key = mapEditorArmKey; // Snapshot before disarming so async metadata/load operations cannot change preset identity.
    mapEditorArmKey = null;
    const placeButton = document.getElementById('wallOrnamentMapPlace'); // Returns UI to idle state immediately after one placement click.
    if (placeButton) placeButton.textContent = 'Place on wall';
    const attachment = await loadAttachment(key, typeof DECOR !== 'undefined' ? DECOR[key] : null); // Needed for default wall gap and later derived post transform.
    if (!attachment) return;
    const record = {
      id: typeof uid === 'function' ? uid(`wall_${key}`) : `wall_${key}_${Date.now().toString(36)}`,
      key,
      col: Math.floor(hit.point.x - finite(offset.offsetC)),
      row: Math.floor(hit.point.z - finite(offset.offsetR)),
      rotY: 0,
      wallAttachment: {
        version: VERSION,
        wallPoint: [round(hit.point.x), round(hit.point.y), round(hit.point.z)],
        wallNormal: [round(hit.normal.x, 6), 0, round(hit.normal.z, 6)],
        offsetU: 0,
        offsetV: 0,
        normalOffset: round(finite(attachment.defaultNormalOffset, 0.01)),
        space: 'wall-surface-uvn',
      },
    }; // Ordinary post fields are filled after the base placement mesh exposes its exact terrain-relative origin.
    try { pushUndo(); } catch (_) {}
    const decor = typeof activeDecor === 'function' ? activeDecor(map) : (map.decor ||= []); // Respects active layout decor when the base editor is editing a layout variant.
    decor.push(record);
    try { saveWorkspace(); refreshPreview(); draw(); } catch (_) {}
    window.setTimeout(async () => {
      const mesh = typeof three3d !== 'undefined' ? three3d.placementMeshes?.get(`decor:${record.id}`) : null; // Preview rebuild establishes the same placementBase runtime will use.
      if (!mesh) { lastError = `Map Editor did not build preview mesh for ${record.id}`; return; }
      await applyMapRecord(record, mesh, attachment);
      try { saveWorkspace(); refreshPreview(); draw(); } catch (_) {}
      const rebuilt = three3d.placementMeshes?.get(`decor:${record.id}`) || mesh; // Refresh may replace placeholder mesh identity.
      const ref = rebuilt.userData?.placementRef || { mapId: map.id, layoutId: null, kind: 'decor', id: record.id }; // Existing selector owns layout-ref semantics.
      try { select3DPlacement(ref); } catch (_) {}
      window.setTimeout(syncMapSelection, 0);
    }, 40);
  }

  function installMapEditorIntegration() {
    if (mapEditorInstalled || typeof document === 'undefined' || !/\/tools\/map-editor(?:\/index\.html)?\/?$/.test(location.pathname)) return false;
    try {
      if (typeof three3d === 'undefined' || !three3d?.renderer || typeof DECOR === 'undefined' || typeof select3DPlacement !== 'function') return false;
      mapEditorInstalled = true;
      DECOR.wallTorch ||= { icon: '🔥', label: 'Wall Torch', fw: 1, fd: 1, area: 'any', wallOrnament: true }; // Makes the new preset available to ordinary decor preview/render lookup.
      if (DECOR.innSign) DECOR.innSign.wallOrnament = true;
      if (DECOR.generalStoreSign) DECOR.generalStoreSign.wallOrnament = true;
      ensureMapEditorUi();
      const originalSelect = select3DPlacement; // Base selection still updates selection labels and generic mesh lookup before wall proxy takeover.
      select3DPlacement = function wallOrnamentSelect3DPlacement(ref) {
        const result = originalSelect(ref);
        window.setTimeout(syncMapSelection, 0);
        return result;
      };
      three3d.renderer.domElement.addEventListener('pointerdown', handleMapWallPick, true); // Capture phase lets armed wall placement win over ordinary 3D selection.
      for (const id of ['gizmo3dRotate', 'gizmo3dScale']) {
        document.getElementById(id)?.addEventListener('click', event => {
          if (!mapProxyState) return;
          event.preventDefault();
          event.stopImmediatePropagation();
          try { setStatus('Wall ornaments use translation only: X/Y are wall-space, Z is wall distance.'); } catch (_) {}
        }, true);
      }
      updateMapPanel();
      return true;
    } catch (error) {
      lastError = `map editor install: ${error?.message || error}`;
      return false;
    }
  }

  function debugSnapshot() {
    const store = typeof localStorage !== 'undefined' ? readPlayerStore() : { placements: {} }; // Mobile debug includes persisted ids without dumping unrelated save data.
    return {
      version: VERSION,
      farmReady: !!farmDeps,
      placerReady: !!placerDeps,
      runtimeReady: !!runtimeDeps,
      playerAdjusting: playerObject ? { id: playerObject.id, key: playerObject.key, mode: playerMode, reticlePreviewValid: playerPreviewValid, placement: clone(playerPlacement), attachmentSurfaceId: playerAttachment?.attachmentSurfaceId || null } : null,
      mountedPlayerIds: Object.keys(store.placements || {}),
      mapEditorInstalled,
      mapEditorArmedKey: mapEditorArmKey,
      mapSelected: mapProxyState?.record ? { id: mapProxyState.record.id, key: mapProxyState.record.key, placement: clone(mapProxyState.record.wallAttachment) } : null,
      controllerBridge: !!controllerUnsubscribe,
      lastError,
    };
  }

  window.WallOrnamentPlacement = Object.freeze({
    version: VERSION,
    isWallOrnamentKey,
    isPlayerMounted,
    getPlayerPlacement,
    getAllPlayerPlacements,
    setPlayerPlacement,
    removePlayerPlacement,
    onPlayerPlacementChanged,
    onPlayerPlacementRemoved,
    adjustPlayerObject,
    armNewPlayerFurniture,
    finishPlayerAdjustment,
    unmountPlayerObject,
    handleGameplayAction,
    isPlayerReticlePlacementActive,
    canConfirmPlayerReticlePlacement,
    updatePlayerReticlePreview,
    loadAttachment,
    deriveTransform,
    placementFromExistingTransform,
    wallBasis,
    syncStoredPlayerPlacements,
    debugSnapshot,
    __test: Object.freeze({ normalizeDegrees, normalizeXZ, yawOf, rotateY, targetPoint, deriveTransform, placementFromExistingTransform, FALLBACK_ATTACHMENTS }),
  });
  window.__wallOrnamentDebug = debugSnapshot;
  installModernInputBridge(); // Shared input modules load before this runtime on the shipped page.

  futureGlobal('ProceduralFurniture', patchProceduralFurniture);
  futureGlobal('FarmEditor', patchFarmEditor);
  futureGlobal('FurniturePlacer', patchFurniturePlacer);
  futureGlobal('MapLivePreviewRuntime', patchMapRuntime);

  if (typeof document !== 'undefined' && /\/tools\/map-editor(?:\/index\.html)?\/?$/.test(location.pathname)) {
    const installTimer = window.setInterval(() => { if (installMapEditorIntegration()) window.clearInterval(installTimer); }, 100); // Map editor's inline globals are declared after this companion script may finish loading.
    window.setTimeout(() => window.clearInterval(installTimer), 15000); // Finite retry avoids a permanent idle timer if tool boot fails.
  }
})();
