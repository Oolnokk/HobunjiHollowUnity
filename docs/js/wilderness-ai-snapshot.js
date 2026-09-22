(() => {
  'use strict';

  // One button dumps a world-wide text snapshot of Porakaneki camp residents
  // plus the den-, nest-, and roaming-herd wildlife instantiated in the live runtime.
  // Porakaneki camps retain abstract off-radius agents world-wide; wildlife
  // packs do not — WildlifeSpawn materializes them only for the active zone.
  // Keeping those scopes explicit prevents an empty section from being
  // misread as "every den, nest, and roaming herd in the world is empty."
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  const WILDERNESS_LAB_ZONE_ID = 'map_wilderness_lab'; // Restricts the handoff harness to the small disposable chunk-streaming test zone.
  const HANDOFF_POLL_MS = 100; // Used only while a handoff test is armed so chunk-entry detection stays cheap and off the per-frame path.
  const HANDOFF_SAMPLE_OFFSETS_MS = Object.freeze([0, 250, 1000, 2000]); // Used to catch immediate and delayed simulation/render divergence after publication.
  const portraitTextureAlphaStatsCache = new WeakMap(); // Reuses static portrait-canvas alpha scans across the repeated handoff samples instead of rereading pixels every time.
  let handoffTest = null; // Stores the single isolated abstract->live Porakaneki experiment currently armed in the Wilderness Chunk Lab.
  let handoffPollTimer = null; // Owns the temporary interval that watches player chunk transitions during an armed handoff experiment.
  let handoffSequence = 0; // Gives each experiment a readable stable id inside copyable diagnostics.

  const SNAPSHOT_GUIDE = `HOBUNJI WILDERNESS AI SNAPSHOT -- interpretation guide for AI review
One frozen instant of all Porakaneki camp residents world-wide plus currently instantiated den-, nest-, and roaming-herd wildlife. Porakaneki camps keep abstract off-radius agents, so their section spans all generated wilderness zones. WILDLIFE is different: it reads live hostileObjects entries carrying a denKey, nestTreeKey, or herdKey, and those animals are normally instantiated only for the active zone. Therefore an empty WILDLIFE section does NOT mean every den, nest, or roaming herd world-wide is empty.
PORAKANEKI lines: "camp=<zoneId>/<campId> kind=<small|chief> ... sleeping=<n>/<residents>" is one camp; each indented "res#<index>" line is one generated resident. act=<activity> is sleep|hunt|wander|socialize|camp|investigate. pos=(col,row) is the planner position. dist is tile distance to the player when in the active zone. lod<=N is the current materialization threshold: normally the enter radius, or the wider release radius while already live. full=1 means that distance gate currently requests full simulation. mat=1 means a real humanoid entity exists; vis=1 means its mesh is visible; reg=1 means that exact entity is still registered in hostileObjects. state is the shared hostile-loop state. planner=1 means neutral Porakaneki target planning owns its destination while the shared hostile loop owns locomotion/rendering. sim=(x,y) is the live entity position, render=(x,y) is the avatar root position, and rd is their tile-space render delta; a large/stuck rd identifies a simulation/render handoff failure directly.
WILDLIFE header: activeArea=<area> is the player's current area, instantiatedWildlife=<n> counts live runtime creatures carrying a denKey, nestTreeKey, or herdKey; denCreatures/nestCreatures/herdCreatures split those sources. herdMothers/carriedBabies/sleepingHerdCreatures expose the Voorg-Ass herd state directly, and scope=active-runtime is a reminder that off-zone populations are not represented here. Creature lines report source/species/state/mode/tile/home; Herd-Mothers also report role=Herd-Mother and carriedBabies=<n>.`;

  const HANDOFF_GUIDE = `HOBUNJI PORAKANEKI CHUNK HANDOFF TRACE -- interpretation guide
This is an isolated Wilderness Chunk Lab experiment. SPAWN_ARMED creates only abstract Porakaneki position/chunk data in a chunk the player is not standing in. No humanoid entity exists yet. PLAYER_CHUNK_CHANGED records the real WildernessChunks center as the player walks. TARGET_CHUNK_ENTERED is the handoff trigger. Materialization then uses BanditCombat.makeEntity with speciesWeights forced to Porakaneki, records the raw builder result, neutralizes the entity, and only then publishes it into hostileObjects. POST_PUBLISH_SAMPLE lines compare simulation position to the avatar root at 0/250/1000/2000 ms. renderDelta is measured in tile space; a large or growing value means the live entity and its rendered avatar diverged during the handoff. reputation reports the live Porakaneki faction Favor, attackOnSight state, player-attributed production Porakaneki kill count, and the reputation runtime's lastReason so intended hostility can be distinguished from a handoff bug. avatarInternals drills into the same front/back portrait pivots and assembled textures that a working Testing Arena Porakaneki uses, including child meshes, transforms, material/texture state, and sampled canvas alpha coverage.`;

  function activeArea() {
    return window.GridTileAccessors?.getCurrentArea?.() || '-';
  }

  function pointText(point) {
    return point && Number.isFinite(point.x) && Number.isFinite(point.y) ? `(${point.x},${point.y})` : '-';
  }

  function porakanekiReputationSnapshot() {
    const debug = window.PorakanekiCamps?.debugSnapshot?.(); // Reuses the production faction runtime as the single authority for Favor and attack-on-sight state.
    return {
      favor: debug?.favor ?? null,
      attackOnSight: debug?.attackOnSight ?? null,
      kills: debug?.kills ?? null,
      lastReason: debug?.lastReason ?? null,
    };
  }

  function roundDiagnosticNumber(value, digits = 4) {
    const number = Number(value);
    return Number.isFinite(number) ? Number(number.toFixed(digits)) : null;
  }

  function vectorDiagnostic(vector, digits = 4) {
    if (!vector) return null;
    const out = { x: roundDiagnosticNumber(vector.x, digits), y: roundDiagnosticNumber(vector.y, digits) };
    if (Number.isFinite(Number(vector.z))) out.z = roundDiagnosticNumber(vector.z, digits);
    return out;
  }

  function objectTransformDiagnostic(object) {
    if (!object) return null;
    const rotation = object.rotation ? {
      xDeg: roundDiagnosticNumber(Number(object.rotation.x) * 180 / Math.PI, 2),
      yDeg: roundDiagnosticNumber(Number(object.rotation.y) * 180 / Math.PI, 2),
      zDeg: roundDiagnosticNumber(Number(object.rotation.z) * 180 / Math.PI, 2),
      order: object.rotation.order || null,
    } : null;
    let worldPosition = null;
    let worldScale = null;
    try {
      object.updateWorldMatrix?.(true, false);
      if (typeof THREE !== 'undefined' && object.getWorldPosition) {
        const position = new THREE.Vector3();
        const scale = new THREE.Vector3();
        object.getWorldPosition(position);
        object.getWorldScale?.(scale);
        worldPosition = vectorDiagnostic(position);
        worldScale = vectorDiagnostic(scale);
      }
    } catch (_) { /* Diagnostics must never disrupt the handoff test. */ }
    return {
      localPosition: vectorDiagnostic(object.position),
      localRotation: rotation,
      localScale: vectorDiagnostic(object.scale),
      worldPosition,
      worldScale,
    };
  }

  function textureAlphaDiagnostic(texture) {
    if (!texture) return null;
    if (portraitTextureAlphaStatsCache.has(texture)) return portraitTextureAlphaStatsCache.get(texture);
    const image = texture.image || texture.source?.data || null;
    const width = Number(image?.width ?? image?.naturalWidth ?? image?.videoWidth);
    const height = Number(image?.height ?? image?.naturalHeight ?? image?.videoHeight);
    const base = {
      name: texture.name || null,
      imageType: image?.constructor?.name || null,
      width: Number.isFinite(width) ? width : null,
      height: Number.isFinite(height) ? height : null,
      repeat: vectorDiagnostic(texture.repeat, 3),
      flipY: texture.flipY ?? null,
      readback: false,
    };
    let result = base;
    try {
      const context = image?.getContext?.('2d', { willReadFrequently: true }) || image?.getContext?.('2d');
      if (context && width > 0 && height > 0) {
        const rgba = context.getImageData(0, 0, width, height).data;
        const step = Math.max(1, Math.floor(Math.max(width, height) / 64));
        let samples = 0, nonzero = 0, opaque = 0, maxAlpha = 0;
        let minX = width, minY = height, maxX = -1, maxY = -1;
        for (let y = 0; y < height; y += step) {
          for (let x = 0; x < width; x += step) {
            const alpha = rgba[(y * width + x) * 4 + 3];
            samples += 1;
            maxAlpha = Math.max(maxAlpha, alpha);
            if (alpha > 0) {
              nonzero += 1;
              if (alpha === 255) opaque += 1;
              minX = Math.min(minX, x); minY = Math.min(minY, y);
              maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
            }
          }
        }
        result = {
          ...base,
          readback: true,
          sampleStep: step,
          samples,
          nonzeroAlphaSamples: nonzero,
          opaqueAlphaSamples: opaque,
          nonzeroAlphaFraction: samples ? roundDiagnosticNumber(nonzero / samples, 4) : null,
          maxAlpha,
          approximateOpaqueBounds: nonzero ? { minX, minY, maxX, maxY } : null,
        };
      }
    } catch (error) {
      result = { ...base, readbackError: error?.message || String(error) };
    }
    portraitTextureAlphaStatsCache.set(texture, result);
    return result;
  }

  function materialDiagnostic(material) {
    const materials = (Array.isArray(material) ? material : [material]).filter(Boolean);
    return materials.map(entry => ({
      name: entry.name || null,
      type: entry.type || entry.constructor?.name || null,
      transparent: entry.transparent ?? null,
      opacity: roundDiagnosticNumber(entry.opacity, 4),
      alphaTest: roundDiagnosticNumber(entry.alphaTest, 4),
      depthWrite: entry.depthWrite ?? null,
      depthTest: entry.depthTest ?? null,
      side: entry.side ?? null,
      map: textureAlphaDiagnostic(entry.map),
    }));
  }

  function objectDiagnostic(object) {
    if (!object) return null;
    return {
      name: object.name || null,
      type: object.type || object.constructor?.name || null,
      visible: object.visible !== false,
      parent: object.parent?.name || object.parent?.type || null,
      renderOrder: Number.isFinite(Number(object.renderOrder)) ? Number(object.renderOrder) : null,
      frustumCulled: object.frustumCulled ?? null,
      transform: objectTransformDiagnostic(object),
    };
  }

  function firstMeshUnder(root) {
    if (!root) return null;
    if (root.isMesh) return root;
    let found = null;
    root.traverse?.(object => { if (!found && object?.isMesh) found = object; });
    return found;
  }

  function portraitPlaneDiagnostic(group, pivotName) {
    const pivot = group?.getObjectByName?.(pivotName) || null;
    const mesh = firstMeshUnder(pivot);
    return {
      pivot: objectDiagnostic(pivot),
      childCount: pivot?.children?.length ?? null,
      mesh: mesh ? {
        ...objectDiagnostic(mesh),
        geometry: {
          type: mesh.geometry?.type || mesh.geometry?.constructor?.name || null,
          positionCount: mesh.geometry?.attributes?.position?.count ?? null,
          uvCount: mesh.geometry?.attributes?.uv?.count ?? null,
        },
        materials: materialDiagnostic(mesh.material),
      } : null,
    };
  }

  function avatarInternalsSnapshot(entity) {
    const avatarRef = entity?.avatarRef;
    const group = avatarRef?.group || null;
    let descendantCount = 0;
    const descendants = [];
    group?.traverse?.(object => {
      descendantCount += 1;
      if (object === group || descendants.length >= 32) return;
      descendants.push({
        name: object.name || null,
        type: object.type || object.constructor?.name || null,
        visible: object.visible !== false,
        parent: object.parent?.name || object.parent?.type || null,
      });
    });
    const roster = entity?.rosterRecord || null;
    return {
      roster: roster ? {
        name: roster.name || null,
        appearance: roster.appearance || null,
        equippedCosmetics: Array.isArray(roster.equippedCosmetics) ? [...roster.equippedCosmetics] : [],
        appliedDyes: roster.appliedDyes ? { ...roster.appliedDyes } : {},
      } : null,
      model: {
        width: roundDiagnosticNumber(avatarRef?.modelWidth, 4),
        height: roundDiagnosticNumber(avatarRef?.modelHeight, 4),
        handAttachX: roundDiagnosticNumber(avatarRef?.handAttachX, 4),
        handAttachY: roundDiagnosticNumber(avatarRef?.handAttachY, 4),
      },
      root: objectDiagnostic(group),
      front: portraitPlaneDiagnostic(group, 'bandit_front_plane'),
      back: portraitPlaneDiagnostic(group, 'bandit_back_plane'),
      legsPivot: objectDiagnostic(group?.getObjectByName?.('bandit_legs_pivot') || null),
      descendantCount,
      descendantsTruncated: descendantCount - 1 > descendants.length,
      descendants,
    };
  }

  function porakanekiSection() {
    const debug = window.PorakanekiCamps?.debugSnapshot?.();
    if (!debug) return 'PORAKANEKI: PorakanekiCamps not ready.';
    const player = debug.playerTile ? `(${debug.playerTile.col},${debug.playerTile.row})` : '-';
    const lines = [`PORAKANEKI season=${debug.season} chiefZone=${debug.chiefZoneId || '-'} favor=${debug.favor ?? '-'} player=${player} lod=${debug.fullSimulationRadiusTiles ?? '-'}/${debug.fullSimulationReleaseRadiusTiles ?? '-'}`];
    for (const [zoneId, zone] of Object.entries(debug.zones || {})) {
      for (const camp of zone.camps || []) {
        const sleeping = camp.hunters.filter(h => h.activity === 'sleep').length;
        lines.push(`camp=${zoneId}/${camp.id} kind=${camp.kind} center=(${camp.center.col},${camp.center.row}) sleeping=${sleeping}/${camp.hunters.length}`);
        for (const h of camp.hunters) {
          const dist = h.distanceToPlayer == null ? '-' : h.distanceToPlayer;
          const state = h.entityState || '-';
          const rd = h.renderDelta == null ? '-' : h.renderDelta;
          lines.push(`  res#${h.index} act=${h.activity} pos=(${h.x},${h.y}) chunk=(${h.chunk.x},${h.chunk.y}) dist=${dist} lod<=${h.lodRadius ?? '-'} full=${h.fullSimulation ? 1 : 0} mat=${h.materialized ? 1 : 0} vis=${h.visible ? 1 : 0} reg=${h.registered ? 1 : 0} state=${state} planner=${h.plannerControlled ? 1 : 0} sim=${pointText(h.simPosition)} render=${pointText(h.renderPosition)} rd=${rd}`);
        }
      }
    }
    const chiefWalker = deps.npcWalkers.find(w => w.rec?.id === 'porakaneki_chief');
    if (chiefWalker) {
      const sleepingHour = window.PorakanekiCamps?.__test?.isSleepingHour?.();
      lines.push(`CHIEF area=${chiefWalker.area || '-'} pos=(${Math.round(chiefWalker.root.position.x / deps.TILE)},${Math.round(chiefWalker.root.position.z / deps.TILE)}) sleepHourNow=${sleepingHour ? 1 : 0}`);
    }
    return lines.join('\n');
  }

  function wildlifeSection() {
    const wildlife = [];
    let denCreatureCount = 0;
    let nestCreatureCount = 0;
    let herdCreatureCount = 0;
    let herdMotherCount = 0;
    let carriedBabyCount = 0;
    let sleepingHerdCreatureCount = 0;
    for (const c of deps.hostileObjects) {
      if (!c.denKey && !c.nestTreeKey && !c.herdKey) continue;
      wildlife.push(c);
      if (c.denKey) denCreatureCount++;
      if (c.nestTreeKey) nestCreatureCount++;
      if (c.herdKey) {
        herdCreatureCount++;
        if (c.isHerdMother) {
          herdMotherCount++;
          carriedBabyCount += Math.max(0, Math.floor(Number(c.carriedBabyCount) || 0));
        }
        if (c._animalSleeping) sleepingHerdCreatureCount++;
      }
    }
    const lines = [`WILDLIFE activeArea=${activeArea()} instantiatedWildlife=${wildlife.length} denCreatures=${denCreatureCount} nestCreatures=${nestCreatureCount} herdCreatures=${herdCreatureCount} herdMothers=${herdMotherCount} carriedBabies=${carriedBabyCount} sleepingHerdCreatures=${sleepingHerdCreatureCount} scope=active-runtime`];
    for (const c of wildlife) {
      const mode = c._cfDrenkirra?.mode || c._grehlrForage?.mode || (c._animalSleeping ? 'sleeping' : c.state);
      const source = c.herdKey ? `herd:${c.herdKey}` : (c.nestTreeKey ? `nest:${c.nestTreeKey}` : `den:${c.denKey}`);
      const herdDetail = c.isHerdMother ? ` role=Herd-Mother carriedBabies=${Math.max(0, Math.floor(Number(c.carriedBabyCount) || 0))}` : '';
      lines.push(`id=${c.id} source=${source} species=${c.creatureKey} area=${c.areaId} state=${c.state} mode=${mode} tile=(${Math.round(c.x / deps.TILE)},${Math.round(c.y / deps.TILE)}) home=(${Math.round(c.homeX / deps.TILE)},${Math.round(c.homeY / deps.TILE)})${herdDetail}`);
    }
    if (!wildlife.length) lines.push('(no den-, nest-, or roaming-herd creatures currently instantiated; off-zone populations are not represented in hostileObjects)');
    return lines.join('\n');
  }
  function captureSnapshotText() {
    const hour = Number(window.CalendarSystem?.getHour?.());
    const header = `--- WILDERNESS AI SNAPSHOT t=${new Date().toISOString()} gameHour=${Number.isFinite(hour) ? hour.toFixed(2) : '-'} activeArea=${activeArea()} ---`;
    return [header, '', porakanekiSection(), '', wildlifeSection()].join('\n');
  }

  async function copySnapshot() {
    const text = [SNAPSHOT_GUIDE, '', captureSnapshotText()].join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      deps.showToast('Wilderness AI snapshot copied.', true);
    } catch (e) {
      console.log(text);
      deps.showToast('Clipboard blocked — snapshot printed to console instead (check devtools).', false);
    }
  }

  function chunkTiles() {
    return Math.max(1, Number(window.WildernessChunks?.constants?.CHUNK_TILES) || 16);
  }

  function currentLabChunk() {
    if (activeArea() !== WILDERNESS_LAB_ZONE_ID) return null;
    const snapshot = window.WildernessChunks?.snapshot?.();
    const zone = snapshot?.zones?.find?.(entry => entry.mapId === WILDERNESS_LAB_ZONE_ID);
    return zone?.center ? { x: Number(zone.center.x), z: Number(zone.center.z) } : null;
  }

  function sameChunk(a, b) {
    return !!a && !!b && a.x === b.x && a.z === b.z;
  }

  function chunkText(chunk) {
    return chunk && Number.isFinite(chunk.x) && Number.isFinite(chunk.z) ? `(${chunk.x},${chunk.z})` : '-';
  }

  function chooseTargetChunk(playerChunk) {
    const cols = Number(window.GridTileAccessors?.getActiveCols?.()) || 0;
    const rows = Number(window.GridTileAccessors?.getActiveRows?.()) || 0;
    const size = chunkTiles();
    const maxX = Math.max(0, Math.ceil(cols / size) - 1);
    const maxZ = Math.max(0, Math.ceil(rows / size) - 1);
    const candidates = [
      { x: playerChunk.x + 1, z: playerChunk.z },
      { x: playerChunk.x, z: playerChunk.z + 1 },
      { x: playerChunk.x - 1, z: playerChunk.z },
      { x: playerChunk.x, z: playerChunk.z - 1 },
    ];
    return candidates.find(candidate => candidate.x >= 0 && candidate.z >= 0 && candidate.x <= maxX && candidate.z <= maxZ) || null;
  }

  function tileIsSuitable(tile) {
    if (!tile) return false;
    if (tile.water || tile.waterfall || tile.occupiedBy) return false;
    const type = String(tile.type || tile.terrain || '').toLowerCase();
    return !type.includes('water') && !type.includes('waterfall');
  }

  function chooseTargetTile(targetChunk) {
    const grid = window.GridTileAccessors?.getActiveGrid?.();
    if (!grid?.length) return null;
    const size = chunkTiles();
    const colStart = targetChunk.x * size;
    const rowStart = targetChunk.z * size;
    const colEnd = Math.min(Number(window.GridTileAccessors?.getActiveCols?.()) || colStart + size, colStart + size);
    const rowEnd = Math.min(Number(window.GridTileAccessors?.getActiveRows?.()) || rowStart + size, rowStart + size);
    const centerCol = Math.floor((colStart + colEnd - 1) * 0.5);
    const centerRow = Math.floor((rowStart + rowEnd - 1) * 0.5);
    const candidates = [];
    for (let row = rowStart + 1; row < rowEnd - 1; row++) {
      for (let col = colStart + 1; col < colEnd - 1; col++) {
        if (!tileIsSuitable(grid[row]?.[col])) continue;
        candidates.push({ col, row, distance: Math.hypot(col - centerCol, row - centerRow) });
      }
    }
    candidates.sort((a, b) => a.distance - b.distance || a.row - b.row || a.col - b.col);
    const best = candidates[0];
    return best ? { col: best.col + 0.5, row: best.row + 0.5 } : null;
  }

  function targetChunkGroup(test) {
    if (!test) return null;
    const scene = window.GridTileAccessors?.getActiveScene?.();
    return scene?.getObjectByName?.(`WildernessChunk_${test.area}_${test.targetChunk.x}_${test.targetChunk.z}`) || null;
  }

  function millisecondsSince(test, at = performance.now()) {
    return Math.max(0, at - test.startedAt);
  }

  function safeJson(value) {
    try { return JSON.stringify(value); }
    catch { return '"<unserializable>"'; }
  }

  function appendHandoffEvent(test, event, details = {}) {
    if (!test) return;
    const elapsed = millisecondsSince(test);
    const line = `${elapsed.toFixed(0).padStart(5, ' ')}ms ${event} ${safeJson(details)}`;
    test.events.push(line);
    test.lastEvent = event;
    updateHandoffUi();
  }

  function entityHandoffSnapshot(entity) {
    if (!entity) return { entity: null };
    const group = entity.avatarRef?.group || null;
    const simX = Number(entity.x) / deps.TILE;
    const simY = Number(entity.y) / deps.TILE;
    const renderX = Number(group?.position?.x);
    const renderY = Number(group?.position?.z);
    const renderDelta = Number.isFinite(simX) && Number.isFinite(simY) && Number.isFinite(renderX) && Number.isFinite(renderY)
      ? Number(Math.hypot(renderX - simX, renderY - simY).toFixed(4))
      : null;
    return {
      id: entity.id || null,
      species: entity.rosterRecord?.appearance?.speciesId || null,
      gender: entity.rosterRecord?.appearance?.gender || null,
      areaId: entity.areaId || null,
      state: entity.state || null,
      health: entity.health ?? null,
      registered: !!deps.hostileObjects?.has?.(entity),
      plannerControlled: entity._porakanekiPlannerControlled === true,
      avatar: !!group,
      visible: !!group && group.visible !== false,
      parent: group?.parent?.name || group?.parent?.type || null,
      sim: Number.isFinite(simX) && Number.isFinite(simY) ? { x: Number(simX.toFixed(3)), y: Number(simY.toFixed(3)) } : null,
      render: Number.isFinite(renderX) && Number.isFinite(renderY) ? { x: Number(renderX.toFixed(3)), y: Number(renderY.toFixed(3)) } : null,
      renderDelta,
      aggroRangePx: Number(entity.def?.aggroRangePx),
      moveSpeed: Number(entity.def?.moveSpeed),
      avatarInternals: avatarInternalsSnapshot(entity),
    };
  }

  function neutralizeHandoffEntity(entity) {
    if (!entity) return;
    entity._porakanekiAggroRangePx ??= Number(entity.def?.aggroRangePx) || deps.TILE * 6;
    entity._porakanekiBaseMoveSpeed ??= Number(entity.def?.moveSpeed) || 118;
    if (entity.def) entity.def.aggroRangePx = 0;
    entity._porakanekiPlannerControlled = true;
    entity._porakanekiActivity = 'chunk-handoff-test';
    entity.homeX = entity.x;
    entity.homeY = entity.y;
    entity.state = 'return';
    entity._banditAction = null;
    entity._rangedAction = null;
    entity._rangedMode = false;
    entity.wanderTarget = { x: entity.x, y: entity.y };
    entity.wanderT = 9999;
  }

  async function materializeHandoffTest(test) {
    if (!test || test !== handoffTest || test.materializing || test.entity) return;
    test.materializing = true;
    test.phase = 'materializing';
    appendHandoffEvent(test, 'MATERIALIZE_BEGIN', {
      targetChunk: test.targetChunk,
      targetTile: test.targetTile,
      targetChunkGroupPresent: !!targetChunkGroup(test),
      playerChunk: currentLabChunk(),
      reputation: porakanekiReputationSnapshot(),
    });
    try {
      const cfg = await window.BanditCombat?.loadGangConfig?.();
      if (!cfg) throw new Error('BanditCombat.loadGangConfig returned no config');
      if (test !== handoffTest || activeArea() !== WILDERNESS_LAB_ZONE_ID || !sameChunk(currentLabChunk(), test.targetChunk)) {
        appendHandoffEvent(test, 'MATERIALIZE_ABORTED_CONTEXT_CHANGED', { area: activeArea(), playerChunk: currentLabChunk() });
        test.phase = 'armed';
        return;
      }
      appendHandoffEvent(test, 'GANG_CONFIG_READY', { speciesWeightsBeforeOverride: cfg.speciesWeights || null });
      const scene = window.GridTileAccessors?.getActiveScene?.();
      const grid = window.GridTileAccessors?.getActiveGrid?.();
      const cols = Number(window.GridTileAccessors?.getActiveCols?.()) || 1;
      const rows = Number(window.GridTileAccessors?.getActiveRows?.()) || 1;
      const x = test.targetTile.col * deps.TILE;
      const y = test.targetTile.row * deps.TILE;
      const entity = await window.BanditCombat.makeEntity({
        ...cfg,
        speciesWeights: { porakaneki: 1 },
        rangedWeaponChanceByRank: { grunt: 0, lieutenant: 0, captain: 0 },
      }, 'grunt', 0, x, y, {
        zoneId: WILDERNESS_LAB_ZONE_ID,
        scene,
        grid,
        cols,
        rows,
        nameOverride: 'Porakaneki Handoff Test',
        extra: {
          isPorakanekiHunter: true,
          isPorakanekiChunkHandoffTest: true,
          homeX: x,
          homeY: y,
        },
      });
      appendHandoffEvent(test, 'MAKE_ENTITY_RESOLVED', {
        ...entityHandoffSnapshot(entity),
        reputation: porakanekiReputationSnapshot(),
      });
      if (!entity) throw new Error('BanditCombat.makeEntity returned null');
      if (test !== handoffTest) {
        disposeHandoffEntity(entity);
        return;
      }
      if (activeArea() !== WILDERNESS_LAB_ZONE_ID || !sameChunk(currentLabChunk(), test.targetChunk)) {
        appendHandoffEvent(test, 'MAKE_ENTITY_CONTEXT_LOST', { area: activeArea(), playerChunk: currentLabChunk() });
        disposeHandoffEntity(entity);
        test.phase = 'armed';
        return;
      }
      test.entity = entity;
      neutralizeHandoffEntity(entity);
      appendHandoffEvent(test, 'NEUTRALIZED_BEFORE_PUBLICATION', {
        ...entityHandoffSnapshot(entity),
        reputation: porakanekiReputationSnapshot(),
      });
      deps.hostileObjects.add(entity);
      test.materializedAt = performance.now();
      test.phase = 'live';
      test.nextSampleIndex = 0;
      appendHandoffEvent(test, 'PUBLISHED_TO_HOSTILE_LOOP', {
        ...entityHandoffSnapshot(entity),
        reputation: porakanekiReputationSnapshot(),
      });
      recordDueHandoffSamples(test, true);
    } catch (error) {
      test.phase = 'failed';
      appendHandoffEvent(test, 'MATERIALIZE_FAILED', { message: error?.message || String(error), stack: error?.stack || null, reputation: porakanekiReputationSnapshot() });
      deps.showToast?.('Porakaneki handoff test failed — copy the handoff trace.', false);
    } finally {
      test.materializing = false;
      updateHandoffUi();
    }
  }

  function recordDueHandoffSamples(test, forceImmediate = false) {
    if (!test?.entity || !Number.isFinite(test.materializedAt)) return;
    const sinceMaterialized = performance.now() - test.materializedAt;
    while (test.nextSampleIndex < HANDOFF_SAMPLE_OFFSETS_MS.length) {
      const dueAt = HANDOFF_SAMPLE_OFFSETS_MS[test.nextSampleIndex];
      if (!forceImmediate && sinceMaterialized < dueAt) break;
      if (forceImmediate && dueAt > 0) break;
      appendHandoffEvent(test, 'POST_PUBLISH_SAMPLE', {
        sampleMs: dueAt,
        playerChunk: currentLabChunk(),
        targetChunkGroupPresent: !!targetChunkGroup(test),
        reputation: porakanekiReputationSnapshot(),
        ...entityHandoffSnapshot(test.entity),
      });
      test.nextSampleIndex += 1;
      if (forceImmediate) break;
    }
    if (test.nextSampleIndex >= HANDOFF_SAMPLE_OFFSETS_MS.length && !test.samplesComplete) {
      test.samplesComplete = true;
      appendHandoffEvent(test, 'POST_PUBLISH_SAMPLING_COMPLETE', {
        ...entityHandoffSnapshot(test.entity),
        reputation: porakanekiReputationSnapshot(),
      });
    }
  }

  function pollHandoffTest() {
    const test = handoffTest;
    if (!test) return;
    if (activeArea() !== WILDERNESS_LAB_ZONE_ID) {
      if (!test.leftLabLogged) {
        test.leftLabLogged = true;
        appendHandoffEvent(test, 'LEFT_WILDERNESS_LAB', { area: activeArea() });
      }
      return;
    }
    test.leftLabLogged = false;
    const playerChunk = currentLabChunk();
    if (!playerChunk) return;
    if (!sameChunk(playerChunk, test.lastPlayerChunk)) {
      test.lastPlayerChunk = { ...playerChunk };
      appendHandoffEvent(test, 'PLAYER_CHUNK_CHANGED', {
        playerChunk,
        targetChunk: test.targetChunk,
        targetChunkGroupPresent: !!targetChunkGroup(test),
      });
    }
    const insideTargetChunk = sameChunk(playerChunk, test.targetChunk);
    if (insideTargetChunk && !test.insideTargetChunk) {
      test.insideTargetChunk = true;
      test.waitingForChunkLogged = false;
      appendHandoffEvent(test, 'TARGET_CHUNK_ENTERED', {
        playerChunk,
        targetChunkGroupPresent: !!targetChunkGroup(test),
        reputation: porakanekiReputationSnapshot(),
      });
    } else if (!insideTargetChunk && test.insideTargetChunk) {
      test.insideTargetChunk = false;
      appendHandoffEvent(test, 'TARGET_CHUNK_LEFT', { playerChunk, targetChunk: test.targetChunk });
    }
    if (insideTargetChunk && !test.entity && !test.materializing) {
      if (targetChunkGroup(test)) materializeHandoffTest(test);
      else if (!test.waitingForChunkLogged) {
        test.waitingForChunkLogged = true;
        appendHandoffEvent(test, 'WAITING_FOR_TARGET_CHUNK_GROUP', { targetChunk: test.targetChunk });
      }
    }
    if (test.entity) recordDueHandoffSamples(test);
  }

  function startHandoffPolling() {
    if (handoffPollTimer != null) return;
    handoffPollTimer = window.setInterval(pollHandoffTest, HANDOFF_POLL_MS);
  }

  function stopHandoffPolling() {
    if (handoffPollTimer == null) return;
    window.clearInterval(handoffPollTimer);
    handoffPollTimer = null;
  }

  function disposeHandoffEntity(entity) {
    if (!entity) return;
    deps.hostileObjects?.delete?.(entity);
    entity.avatarRef?.group?.parent?.remove?.(entity.avatarRef.group);
    entity.groundShadow?.parent?.remove?.(entity.groundShadow);
    entity._banditToolHolder?.parent?.remove?.(entity._banditToolHolder);
    entity._banditRangedToolHolder?.parent?.remove?.(entity._banditRangedToolHolder);
    entity.avatarRef?.dispose?.();
  }

  function resetHandoffTest(options = {}) {
    const previous = handoffTest;
    if (previous?.entity) disposeHandoffEntity(previous.entity);
    handoffTest = null;
    stopHandoffPolling();
    updateHandoffUi();
    if (!options.silent) deps.showToast?.('Porakaneki handoff test reset.', true);
  }

  function spawnPorakanekiChunkHandoffTest() {
    if (activeArea() !== WILDERNESS_LAB_ZONE_ID) {
      deps.showToast?.('Enter the Wilderness Chunk Lab before arming the Porakaneki handoff test.', false);
      return false;
    }
    const playerChunk = currentLabChunk();
    if (!playerChunk) {
      deps.showToast?.('Wilderness chunk streamer has not reported the player chunk yet.', false);
      return false;
    }
    const targetChunk = chooseTargetChunk(playerChunk);
    if (!targetChunk) {
      deps.showToast?.('This lab has only the current chunk. Generate at least a 2x2 lab (4 chunks) and try again.', false);
      return false;
    }
    const targetTile = chooseTargetTile(targetChunk);
    if (!targetTile) {
      deps.showToast?.('Could not find a dry open tile in the adjacent test chunk. Regenerate the lab and try again.', false);
      return false;
    }
    resetHandoffTest({ silent: true });
    const now = performance.now();
    handoffTest = {
      id: `porakaneki-handoff-${++handoffSequence}`,
      area: WILDERNESS_LAB_ZONE_ID,
      startedAt: now,
      phase: 'armed',
      targetChunk,
      targetTile,
      entity: null,
      materializing: false,
      materializedAt: null,
      nextSampleIndex: 0,
      samplesComplete: false,
      insideTargetChunk: false,
      waitingForChunkLogged: false,
      leftLabLogged: false,
      lastPlayerChunk: { ...playerChunk },
      lastEvent: 'SPAWN_ARMED',
      events: [],
    };
    appendHandoffEvent(handoffTest, 'SPAWN_ARMED', {
      area: WILDERNESS_LAB_ZONE_ID,
      playerChunk,
      targetChunk,
      targetTile,
      abstractOnly: true,
      entityExists: false,
      targetChunkGroupPresent: !!targetChunkGroup(handoffTest),
      reputation: porakanekiReputationSnapshot(),
    });
    appendHandoffEvent(handoffTest, 'ABSTRACT_POSITION_READY', {
      position: targetTile,
      chunk: targetChunk,
      entityExists: false,
      instruction: `Walk into chunk ${targetChunk.x},${targetChunk.z}; materialization waits for actual chunk entry.`,
    });
    startHandoffPolling();
    updateHandoffUi();
    deps.showToast?.(`Porakaneki test armed in chunk ${targetChunk.x},${targetChunk.z}. Walk into that chunk, then copy the trace.`, true);
    return true;
  }

  function captureHandoffTraceText() {
    if (!handoffTest) return [HANDOFF_GUIDE, '', 'No Porakaneki chunk handoff test is currently armed.'].join('\n');
    const test = handoffTest;
    const currentEntity = test.entity ? entityHandoffSnapshot(test.entity) : null;
    const summary = {
      id: test.id,
      phase: test.phase,
      area: test.area,
      currentArea: activeArea(),
      currentPlayerChunk: currentLabChunk(),
      targetChunk: test.targetChunk,
      targetTile: test.targetTile,
      targetChunkGroupPresent: !!targetChunkGroup(test),
      reputation: porakanekiReputationSnapshot(),
      entity: currentEntity,
    };
    return [
      HANDOFF_GUIDE,
      '',
      `--- PORAKANEKI CHUNK HANDOFF ${test.id} ---`,
      `SUMMARY ${safeJson(summary)}`,
      '',
      ...test.events,
    ].join('\n');
  }

  async function copyHandoffTrace() {
    const text = captureHandoffTraceText();
    try {
      await navigator.clipboard.writeText(text);
      deps.showToast?.('Porakaneki chunk handoff trace copied.', true);
    } catch (error) {
      console.log(text);
      deps.showToast?.('Clipboard blocked — handoff trace printed to console instead.', false);
    }
  }

  function updateHandoffUi() {
    const status = document.getElementById('devPorakanekiChunkHandoffStatus');
    const trace = document.getElementById('devPorakanekiChunkHandoffTrace');
    const copyButton = document.getElementById('devPorakanekiChunkHandoffCopyBtn');
    const resetButton = document.getElementById('devPorakanekiChunkHandoffResetBtn');
    if (status) {
      if (!handoffTest) status.textContent = 'No handoff test armed.';
      else {
        const reputation = porakanekiReputationSnapshot();
        const favorText = reputation.favor == null ? '?' : reputation.favor;
        const aosText = reputation.attackOnSight == null ? '?' : (reputation.attackOnSight ? 'YES' : 'no');
        status.textContent = `${handoffTest.phase.toUpperCase()} · Favor ${favorText} · AOS ${aosText} · player ${chunkText(currentLabChunk())} → target (${handoffTest.targetChunk.x},${handoffTest.targetChunk.z}) · last ${handoffTest.lastEvent}`;
      }
    }
    if (trace) trace.textContent = handoffTest ? handoffTest.events.join('\n') : 'Press “Spawn Off-Chunk Porakaneki” while inside a 2x2-or-larger Wilderness Chunk Lab.';
    if (copyButton) copyButton.disabled = !handoffTest;
    if (resetButton) resetButton.disabled = !handoffTest;
  }

  function installHandoffUi() {
    if (document.getElementById('devPorakanekiChunkHandoffHarness')) return;
    const labAnchor = document.getElementById('devRegenerateWildernessLabBtn');
    const fallbackAnchor = document.getElementById('devWildernessAiSnapshotBtn');
    const anchor = labAnchor?.parentElement || fallbackAnchor?.parentElement;
    if (!anchor || !document.createElement) return;
    const panel = document.createElement('div');
    panel.id = 'devPorakanekiChunkHandoffHarness';
    panel.style.cssText = 'margin-top:8px;padding:8px;border:1px solid rgba(129,140,248,.4);border-radius:8px;background:rgba(30,27,75,.22);font-size:11px;';
    panel.innerHTML = `
      <div style="font-weight:800;color:#c7d2fe;margin-bottom:4px">Porakaneki Chunk Handoff Test</div>
      <div style="color:#aab1c5;margin-bottom:6px;line-height:1.35">Creates abstract position data in an adjacent chunk. Nothing materializes until you actually enter that chunk; then the production bandit-like builder is sampled through the handoff.</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button type="button" id="devPorakanekiChunkHandoffSpawnBtn" class="settings-small-btn">Spawn Off-Chunk Porakaneki</button>
        <button type="button" id="devPorakanekiChunkHandoffCopyBtn" class="settings-small-btn" disabled>Copy Handoff Trace</button>
        <button type="button" id="devPorakanekiChunkHandoffResetBtn" class="settings-small-btn" disabled>Reset Test</button>
      </div>
      <div id="devPorakanekiChunkHandoffStatus" style="margin-top:6px;color:#d8dcff">No handoff test armed.</div>
      <pre id="devPorakanekiChunkHandoffTrace" style="margin:6px 0 0;max-height:180px;overflow:auto;white-space:pre-wrap;word-break:break-word;padding:6px;border-radius:6px;background:rgba(0,0,0,.28);color:#d1d5db;font-size:10px;line-height:1.35">Press “Spawn Off-Chunk Porakaneki” while inside a 2x2-or-larger Wilderness Chunk Lab.</pre>`;
    if (labAnchor?.parentElement) labAnchor.parentElement.insertAdjacentElement('afterend', panel);
    else fallbackAnchor?.insertAdjacentElement?.('afterend', panel);
    document.getElementById('devPorakanekiChunkHandoffSpawnBtn')?.addEventListener('click', spawnPorakanekiChunkHandoffTest);
    document.getElementById('devPorakanekiChunkHandoffCopyBtn')?.addEventListener('click', copyHandoffTrace);
    document.getElementById('devPorakanekiChunkHandoffResetBtn')?.addEventListener('click', () => resetHandoffTest());
    updateHandoffUi();
  }

  function initWithBinding(injectedDeps) {
    init(injectedDeps);
    document.getElementById('devWildernessAiSnapshotBtn')?.addEventListener('click', copySnapshot);
    installHandoffUi();
  }

  window.WildernessAiSnapshot = {
    init: initWithBinding,
    captureSnapshotText,
    spawnPorakanekiChunkHandoffTest,
    captureHandoffTraceText,
    resetHandoffTest,
  };
})();