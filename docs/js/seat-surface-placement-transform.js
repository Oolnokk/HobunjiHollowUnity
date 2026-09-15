(() => {
  'use strict';

  if (window.SeatSurfacePlacementTransform?.installed) return;

  const EPSILON = 1e-6; // Used when deciding whether an editor post-transform actually changes a seat surface.
  const ALIAS_PREFIX = '__seat_surface_xform_'; // Used to create runtime-only furniture keys that carry per-transform seat metadata.
  const aliasByKey = new Map(); // Used by authored-data and visual-builder wrappers to resolve runtime aliases back to their base furniture.
  const aliasBySignature = new Map(); // Used to reuse aliases when several seats share the exact same transform.
  let decorativeFurnitureDefs = null; // Filled from FarmEditor.init and used to register alias furniture definitions before scene construction.
  const state = { // Used by the mobile/debug snapshot and one-line farm log diagnostics.
    installed: false,
    definitionsCaptured: false,
    aliasesCreated: 0,
    mapsTransformed: 0,
    furnitureInstancesTransformed: 0,
    boundStationsTransformed: 0,
    lastMapId: null,
    lastFurnitureId: null,
    lastAliasKey: null,
    lastError: null,
  };

  function finiteNumber(value, fallback = 0) {
    const number = Number(value); // Used as the sanitized numeric transform value returned to callers.
    return Number.isFinite(number) ? number : fallback;
  }

  function postTransformFor(piece) {
    const uniformScale = Number.isFinite(Number(piece?.postScale)) ? Number(piece.postScale) : 1; // Used as the legacy fallback for maps authored before per-axis post scales.
    return {
      tx: finiteNumber(piece?.postX, 0),
      ty: finiteNumber(piece?.postY, 0),
      tz: finiteNumber(piece?.postZ, 0),
      sx: finiteNumber(piece?.postSX, uniformScale),
      sy: finiteNumber(piece?.postSY, uniformScale),
      sz: finiteNumber(piece?.postSZ, uniformScale),
      yawDeg: finiteNumber(piece?.rotY, 0),
    };
  }

  function transformChangesSeat(transform) {
    return Math.abs(transform.tx) > EPSILON
      || Math.abs(transform.ty) > EPSILON
      || Math.abs(transform.tz) > EPSILON
      || Math.abs(transform.sx - 1) > EPSILON
      || Math.abs(transform.sy - 1) > EPSILON
      || Math.abs(transform.sz - 1) > EPSILON;
  }

  function furnitureKeyForItemKey(itemKey) {
    if (!decorativeFurnitureDefs || !itemKey) return '';
    for (const [key, definition] of Object.entries(decorativeFurnitureDefs)) {
      if (definition?.itemKey === itemKey) return key;
    }
    return '';
  }

  function aliasRecordForPiece(piece) {
    const itemKey = String(piece?.itemKey || ''); // Used to detect an effective map that has already passed through this adapter.
    const resolvedKey = furnitureKeyForItemKey(itemKey); // Used to map the runtime alias item key back to its alias record without persisting extra marker fields.
    return resolvedKey ? (aliasByKey.get(resolvedKey) || null) : null;
  }

  function baseFurnitureKeyForPiece(piece) {
    const directKey = String(piece?.key || ''); // Used first when an editor record already carries its internal furniture key.
    if (directKey && decorativeFurnitureDefs?.[directKey]?.sit) return directKey;
    const itemKeyMatch = furnitureKeyForItemKey(String(piece?.itemKey || '')); // Used for ordinary map records, which persist the inventory/item key instead.
    return itemKeyMatch && decorativeFurnitureDefs?.[itemKeyMatch]?.sit ? itemKeyMatch : '';
  }

  function hashSignature(text) {
    let hash = 0x811c9dc5; // Used as a compact deterministic suffix for runtime-only alias keys.
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(36);
  }

  function transformSignature(baseKey, transform, mode) {
    const values = [
      baseKey, mode,
      transform.tx, transform.ty, transform.tz,
      transform.sx, transform.sy, transform.sz,
      mode === 'piece' ? transform.yawDeg : 0,
    ]; // Used to share one alias only when its baked seat transform is mathematically identical.
    return values.join('|');
  }

  function uniqueAliasKey(signature) {
    const baseAlias = `${ALIAS_PREFIX}${hashSignature(signature)}`; // Used as the preferred compact runtime key for this transform signature.
    let aliasKey = baseAlias; // Used as the collision-resolved key ultimately registered in the furniture definition table.
    let suffix = 2; // Used only if an extremely rare 32-bit signature hash collision occurs.
    while (aliasByKey.has(aliasKey) && aliasByKey.get(aliasKey).signature !== signature) {
      aliasKey = `${baseAlias}_${suffix}`;
      suffix += 1;
    }
    return aliasKey;
  }

  function ensureAlias(baseKey, transform, mode) {
    const signature = transformSignature(baseKey, transform, mode); // Used to look up or create the exact seat-transform alias needed by this placement.
    const existingKey = aliasBySignature.get(signature); // Used to avoid duplicate definitions for repeated chairs with identical transforms.
    if (existingKey) return aliasByKey.get(existingKey);
    const baseDefinition = decorativeFurnitureDefs?.[baseKey]; // Used as the gameplay furniture definition copied for the runtime alias.
    if (!baseDefinition?.sit) return null;

    const aliasKey = uniqueAliasKey(signature); // Used by private gameplay seat resolution as the furniture key for this transformed placement.
    const aliasItemKey = `${aliasKey}_item`; // Used by map records so game.js's itemKey-to-furnitureKey lookup resolves the runtime alias.
    const record = {
      aliasKey,
      aliasItemKey,
      baseKey,
      signature,
      mode,
      transform: { ...transform },
      derivedData: null,
      derivedFrom: null,
    }; // Used by every wrapper to map the alias back to its base visual and transformed authored seat data.

    decorativeFurnitureDefs[aliasKey] = {
      ...baseDefinition,
      itemKey: aliasItemKey,
      __seatSurfacePlacementAlias: true,
      __seatSurfacePlacementBaseKey: baseKey,
    };
    aliasByKey.set(aliasKey, record);
    aliasBySignature.set(signature, aliasKey);
    state.aliasesCreated += 1;
    state.lastAliasKey = aliasKey;
    return record;
  }

  function localTranslationFor(transform, mode) {
    if (mode !== 'piece') return { x: 0, z: 0 };
    const yawRad = transform.yawDeg * Math.PI / 180; // Used to convert the editor's world-axis post translation back into pre-yaw seat-anchor space.
    const cos = Math.cos(yawRad); // Used by the inverse Y-yaw transform for the X component.
    const sin = Math.sin(yawRad); // Used by the inverse Y-yaw transform for the Z component.
    return {
      x: transform.tx * cos - transform.tz * sin,
      z: transform.tx * sin + transform.tz * cos,
    };
  }

  function transformedSeatRotation(rotationDeg, transform) {
    const THREE = window.THREE; // Used to transform the authored seat plane correctly under non-uniform post scale.
    if (!THREE?.Vector3 || !THREE?.Euler || !THREE?.Matrix4 || !THREE?.Quaternion) {
      return {
        x: finiteNumber(rotationDeg?.x, 0),
        y: finiteNumber(rotationDeg?.y, 0),
        z: finiteNumber(rotationDeg?.z, 0),
      };
    }

    const sourceEuler = new THREE.Euler(
      finiteNumber(rotationDeg?.x, 0) * Math.PI / 180,
      finiteNumber(rotationDeg?.y, 0) * Math.PI / 180,
      finiteNumber(rotationDeg?.z, 0) * Math.PI / 180,
      'XYZ',
    ); // Used to reconstruct the authored seat plane's local normal and forward tangent.
    const normal = new THREE.Vector3(0, 1, 0).applyEuler(sourceEuler); // Used as the seat surface normal transformed with the inverse-transpose of scale.
    const forward = new THREE.Vector3(0, 0, 1).applyEuler(sourceEuler); // Used as the seat surface forward tangent transformed with ordinary scale.
    const safeSx = Math.abs(transform.sx) > EPSILON ? transform.sx : EPSILON; // Used to keep degenerate X scale from dividing the normal by zero.
    const safeSy = Math.abs(transform.sy) > EPSILON ? transform.sy : EPSILON; // Used to keep degenerate Y scale from dividing the normal by zero.
    const safeSz = Math.abs(transform.sz) > EPSILON ? transform.sz : EPSILON; // Used to keep degenerate Z scale from dividing the normal by zero.

    normal.set(normal.x / safeSx, normal.y / safeSy, normal.z / safeSz).normalize();
    forward.set(forward.x * transform.sx, forward.y * transform.sy, forward.z * transform.sz);
    forward.addScaledVector(normal, -forward.dot(normal));
    if (forward.lengthSq() <= EPSILON * EPSILON) return { x: finiteNumber(rotationDeg?.x, 0), y: finiteNumber(rotationDeg?.y, 0), z: finiteNumber(rotationDeg?.z, 0) };
    forward.normalize();

    const right = new THREE.Vector3().crossVectors(normal, forward).normalize(); // Used with normal/forward to rebuild an orthonormal seat basis after non-uniform scale.
    const basis = new THREE.Matrix4().makeBasis(right, normal, forward); // Used to convert the transformed seat basis back into the existing Euler metadata format.
    const quaternion = new THREE.Quaternion().setFromRotationMatrix(basis); // Used as the stable intermediate between the transformed basis and Euler angles.
    const transformedEuler = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ'); // Used by the existing seat solver through its rotationDeg contract.
    return {
      x: transformedEuler.x * 180 / Math.PI,
      y: transformedEuler.y * 180 / Math.PI,
      z: transformedEuler.z * 180 / Math.PI,
    };
  }

  function deriveAuthoredData(baseData, record) {
    if (!baseData) return null;
    if (record.derivedData && record.derivedFrom === baseData) return record.derivedData;
    const transform = record.transform; // Used to bake only the seat metadata while leaving visible furniture parts in their authored local frame.
    const localTranslation = localTranslationFor(transform, record.mode); // Used to represent postX/postZ inside the private seat resolver without moving the visual twice.
    const baseFootprint = baseData.footprint || {}; // Used to make the seated leg solver's seat depth follow postSZ.
    const seatAnchors = Array.isArray(baseData.seatAnchors) ? baseData.seatAnchors.map(anchor => {
      const position = anchor?.position || {}; // Used as the authored local seat point before placement post-transform.
      return {
        ...anchor,
        position: {
          x: finiteNumber(position.x, 0) * transform.sx + localTranslation.x,
          y: finiteNumber(position.y, 0) * transform.sy + transform.ty,
          z: finiteNumber(position.z, 0) * transform.sz + localTranslation.z,
        },
        rotationDeg: transformedSeatRotation(anchor?.rotationDeg, transform),
      };
    }) : []; // Used by AuthoredFurniture.seatAnchorFor through the existing gameplay path.

    const derivedData = {
      ...baseData,
      key: record.aliasKey,
      footprint: {
        ...baseFootprint,
        w: Math.max(EPSILON, Math.abs(finiteNumber(baseFootprint.w, 1) * transform.sx)),
        d: Math.max(EPSILON, Math.abs(finiteNumber(baseFootprint.d, 1) * transform.sz)),
      },
      seatAnchors,
    }; // Used only for seat metadata; visible authored parts remain unchanged and are still transformed by the furniture group itself.
    record.derivedFrom = baseData;
    record.derivedData = derivedData;
    return derivedData;
  }

  function transformEffectiveMap(mapData) {
    if (!mapData || !decorativeFurnitureDefs) return mapData;
    const furniture = Array.isArray(mapData.furniture) ? mapData.furniture : null; // Used as the effective layout's furniture placements to inspect for post-transformed seats.
    if (!furniture?.length) return mapData;

    const transformedBySourceId = new Map(); // Used to apply the same postY/scale to NPC stations already bound to a source furniture id.
    let furnitureChanged = false; // Used to preserve MapLayoutSystem's non-destructive identity behavior when no seat needs correction.
    const transformedFurniture = furniture.map((piece, index) => {
      if (aliasRecordForPiece(piece)) return piece;
      const baseKey = baseFurnitureKeyForPiece(piece); // Used to skip non-seat furniture without creating any runtime definitions.
      if (!baseKey) return piece;
      const transform = postTransformFor(piece); // Used to mirror the exact post-placement transform already applied to the visible furniture group.
      if (!transformChangesSeat(transform)) return piece;
      const alias = ensureAlias(baseKey, transform, 'piece'); // Used by player sitting and auto-registered chair stations, which still originate at the raw tile position.
      if (!alias) return piece;
      const sourceId = String(piece.id || `${piece.itemKey || baseKey}:${index}`); // Used to pair authored NPC stations with this transformed furniture instance.
      transformedBySourceId.set(sourceId, { baseKey, transform });
      furnitureChanged = true;
      state.furnitureInstancesTransformed += 1;
      state.lastFurnitureId = String(piece.id || sourceId);
      return { ...piece, itemKey: alias.aliasItemKey };
    });

    if (!furnitureChanged) return mapData;
    const stations = Array.isArray(mapData.npcStations) ? mapData.npcStations : null; // Used to update explicit sourceFurnitureId-bound NPC sitting targets without double-applying postX/postZ.
    const transformedStations = stations ? stations.map(station => {
      const sourceId = String(station?.sourceFurnitureId || ''); // Used to find the transformed seat placement this station follows.
      const source = transformedBySourceId.get(sourceId); // Used to distinguish bound stations from unrelated manually placed NPC stations.
      if (!source) return station;
      const explicitKey = decorativeFurnitureDefs?.[station.furnitureKey] ? station.furnitureKey : furnitureKeyForItemKey(station.furnitureKey); // Used when a station deliberately selects a seat definition instead of inheriting the source piece's definition.
      const stationBaseKey = decorativeFurnitureDefs?.[explicitKey]?.sit ? explicitKey : source.baseKey; // Used as the authored seat geometry that receives the source furniture's post transform.
      const stationAlias = ensureAlias(stationBaseKey, source.transform, 'station'); // Used after MapLayoutSystem has already folded postX/postZ into station col/row.
      if (!stationAlias) return station;
      state.boundStationsTransformed += 1;
      return {
        ...station,
        furnitureKey: stationAlias.aliasKey,
        sourceFurnitureKey: stationAlias.aliasItemKey,
      };
    }) : stations;

    state.mapsTransformed += 1;
    state.lastMapId = String(mapData.id || mapData.mapId || 'unknown');
    window.__farmLog?.(`[seat-surface] ${state.lastMapId}: transformed ${transformedBySourceId.size} post-placed seat surface${transformedBySourceId.size === 1 ? '' : 's'}.`);
    return {
      ...mapData,
      furniture: transformedFurniture,
      ...(stations ? { npcStations: transformedStations } : {}),
    };
  }

  function installFarmEditorCapture() {
    const farmEditor = window.FarmEditor; // Used to capture game.js's decorative furniture definition object before any map scene is built.
    const originalInit = farmEditor?.init; // Used as the untouched FarmEditor initializer delegated to after capturing definitions.
    if (!farmEditor || typeof originalInit !== 'function' || originalInit.__seatSurfacePlacementWrapped) return;
    function initWithSeatSurfaceDefinitions(injectedDeps) {
      if (injectedDeps?.DECORATIVE_FURNITURE_DEFS) {
        decorativeFurnitureDefs = injectedDeps.DECORATIVE_FURNITURE_DEFS;
        state.definitionsCaptured = true;
      }
      return originalInit.call(this, injectedDeps);
    }
    Object.assign(initWithSeatSurfaceDefinitions, originalInit);
    initWithSeatSurfaceDefinitions.__seatSurfacePlacementWrapped = true;
    farmEditor.init = initWithSeatSurfaceDefinitions;
  }

  function installAuthoredFurnitureAliases() {
    const authored = window.AuthoredFurniture; // Used to make private gameplay seat resolution see transformed anchors under runtime alias keys.
    if (!authored || authored.peek?.__seatSurfacePlacementWrapped) return;
    const originalPeek = authored.peek; // Used for every ordinary key and as the source data for transformed aliases.
    const originalLoad = authored.load; // Used to preserve the existing async authored-data cache while aliases load their base furniture.
    if (typeof originalPeek !== 'function' || typeof originalLoad !== 'function') return;

    function peekWithSeatSurfaceAlias(furnitureKey) {
      const record = aliasByKey.get(String(furnitureKey || '')); // Used to detect runtime keys created for post-transformed seat placements.
      if (!record) return originalPeek.call(this, furnitureKey);
      return deriveAuthoredData(originalPeek.call(this, record.baseKey), record);
    }
    function loadWithSeatSurfaceAlias(furnitureKey) {
      const record = aliasByKey.get(String(furnitureKey || '')); // Used to load the base authored file instead of requesting a nonexistent alias JSON file.
      if (!record) return originalLoad.call(this, furnitureKey);
      return Promise.resolve(originalLoad.call(this, record.baseKey)).then(baseData => deriveAuthoredData(baseData, record));
    }
    Object.assign(peekWithSeatSurfaceAlias, originalPeek);
    Object.assign(loadWithSeatSurfaceAlias, originalLoad);
    peekWithSeatSurfaceAlias.__seatSurfacePlacementWrapped = true;
    loadWithSeatSurfaceAlias.__seatSurfacePlacementWrapped = true;
    authored.peek = peekWithSeatSurfaceAlias;
    authored.load = loadWithSeatSurfaceAlias;
  }

  function installVisualAliasBridge() {
    const furniture = window.ProceduralFurniture; // Used to keep runtime alias keys on the exact same visible furniture builder as their base keys.
    const originalBuilder = furniture?.buildFurnitureGroup; // Used as the already-installed procedural/authored visual chain delegated to for real geometry.
    if (!furniture || typeof originalBuilder !== 'function' || originalBuilder.__seatSurfacePlacementWrapped) return;
    function buildFurnitureGroupWithSeatAlias(furnitureKey, ...args) {
      const record = aliasByKey.get(String(furnitureKey || '')); // Used to prevent a seat alias from looking like an unknown furniture recipe to the visual builder.
      return originalBuilder.call(this, record?.baseKey || furnitureKey, ...args);
    }
    Object.assign(buildFurnitureGroupWithSeatAlias, originalBuilder);
    buildFurnitureGroupWithSeatAlias.__seatSurfacePlacementWrapped = true;
    furniture.buildFurnitureGroup = buildFurnitureGroupWithSeatAlias;
  }

  function installMapLayoutBridge() {
    const mapLayouts = window.MapLayoutSystem; // Used as the one shared point where active-layout furniture has already been selected but game.js has not built the scene yet.
    const originalGetEffectiveMapData = mapLayouts?.getEffectiveMapData; // Used to preserve all existing schedule/layout/furniture-bound-station resolution before seat correction.
    if (!mapLayouts || typeof originalGetEffectiveMapData !== 'function' || originalGetEffectiveMapData.__seatSurfacePlacementWrapped) return;
    function getEffectiveMapDataWithSeatSurfaces(mapData, now) {
      const effectiveMap = originalGetEffectiveMapData.call(this, mapData, now); // Used as the already-resolved non-destructive map copy to decorate with runtime-only seat aliases.
      try {
        return transformEffectiveMap(effectiveMap);
      } catch (error) {
        state.lastError = String(error?.stack || error?.message || error);
        window.__farmLog?.(`[seat-surface] transform failed: ${state.lastError}`);
        return effectiveMap;
      }
    }
    Object.assign(getEffectiveMapDataWithSeatSurfaces, originalGetEffectiveMapData);
    getEffectiveMapDataWithSeatSurfaces.__seatSurfacePlacementWrapped = true;
    mapLayouts.getEffectiveMapData = getEffectiveMapDataWithSeatSurfaces;
  }

  function debugSnapshot() {
    return {
      ...state,
      aliasCount: aliasByKey.size,
      definitionCount: decorativeFurnitureDefs ? Object.keys(decorativeFurnitureDefs).length : 0,
      authoredAliasBridge: !!window.AuthoredFurniture?.peek?.__seatSurfacePlacementWrapped,
      visualAliasBridge: !!window.ProceduralFurniture?.buildFurnitureGroup?.__seatSurfacePlacementWrapped,
      mapLayoutBridge: !!window.MapLayoutSystem?.getEffectiveMapData?.__seatSurfacePlacementWrapped,
      farmEditorBridge: !!window.FarmEditor?.init?.__seatSurfacePlacementWrapped,
    };
  }

  installFarmEditorCapture();
  installAuthoredFurnitureAliases();
  installVisualAliasBridge();
  installMapLayoutBridge();
  state.installed = true;

  window.SeatSurfacePlacementTransform = Object.freeze({
    installed: true,
    debugSnapshot,
    transformEffectiveMap,
  });
  window.__seatSurfacePlacementDebug = debugSnapshot;
})();
