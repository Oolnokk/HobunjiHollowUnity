(() => {
  'use strict';

  if (typeof window === 'undefined' || window.EnvironmentSurfaceRuntime?.__installedV4) return;

  const WESTERN_SLOPE_ID = 'map_western_slope'; // Used by resolveMode() so permanent Western Slope snow overrides seasonal slush.
  const SURFACE_NORMAL_MIN_Y = 0.28; // Used by processTriangle() to exclude wall-like faces while keeping walkable slopes and plateau tops.
  const LARGE_TERRAIN_TRIANGLES = 60000; // Matches TerrainRenderChunks' split threshold so giant root meshes wait for their renderer spatial children.
  const WORK_BUDGET_MS = 1.25; // Maximum environment-surface CPU time spent in one animation frame.
  const MAX_TRIANGLES_PER_SLICE = 160; // Hard triangle cap paired with WORK_BUDGET_MS so work yields frequently on fast machines too.
  const TOP_BATCH_TRIANGLES = 768; // Maximum generated top triangles kept in one output batch before flushing.
  const EXACT_STRETCH_TRIANGLE_LIMIT = 768; // Small owners can use the exact farm/furniture irregular stretch mapper without risking a long synchronous solve.
  const EDGE_SEGMENTS = 6; // Number of curved side-shell strips between the raised top and the source tile surface.
  const SHELL_BATCH_EDGES = 128; // Bounds each perimeter-shell allocation so shell rebuilds are incremental too.
  const SHELL_OUTLINE_LAYER = 1; // Existing inverted-hull shell-outline layer; enabled only on exposed continuous-mass side shells.
  const KEY_SCALE = 1000; // Used by edge keys to weld shared edges across separately generated terrain owners.
  const PROTECTED_SOURCE_EDGE = 0.16; // Same protected PNG edge fraction used by natural-surface-stretch-post-jigsaw.js.
  const PROTECTED_SURFACE_EDGE = 0.06; // Same narrow surface band that receives the protected PNG edge on farm/natural surfaces.
  const DISCOVERY_INTERVAL_MS = 180; // Lightweight root-scene discovery cadence for renderer-created spatial chunks that appear after first render.
  const LAND_TARGETS = new Set(['grass', 'path', 'tilled', 'trench', 'raised', 'paddy', 'rock', 'shrub', 'cliff', 'ramp']); // Western snow covers authored exposed land targets.
  const WATER_KEYS = new Set(['water', 'river', 'stream', 'waterfall']); // Open water remains uncovered.

  const PRESETS = Object.freeze({
    snow: Object.freeze({
      height: 0.275,
      edgeWidth: 0.18,
      edgeRound: 1.4,
      opacity: 1,
    }),
    slush: Object.freeze({
      height: 0.18,
      edgeWidth: 0.13,
      edgeRound: 1.35,
      opacity: 0.22,
    }),
  }); // Snow remains exactly half the original 0.55 preview height; both tops are flat constant offsets.

  let deps = null; // Captured from RainPlanes.init(); provides THREE, scene, calendar, area, player, and outdoor-state access.
  let attachedScene = null; // Scene currently owning generated snow/slush meshes.
  let activeArea = null; // Last area id used to detect map transitions.
  let activeMode = 'none'; // Last none|snow|slush mode used to detect season/policy transitions.
  let wildernessHooksInstalled = false; // Prevents wrapping WildernessChunks more than once.
  let priorRainInit = null; // Original RainPlanes.init preserved by installRainPlanesBridge().
  let priorRainUpdate = null; // Original RainPlanes.update preserved by installRainPlanesBridge().
  let activeJob = null; // One source-mesh top build incrementally processed across frames.
  let shellJob = null; // One global exposed-perimeter shell build incrementally processed across frames.
  let shellRoot = null; // Currently visible curved perimeter shell group.
  let shellRevision = 0; // Increments whenever owner boundaries change so stale shell jobs cannot publish.
  let shellDirty = false; // Marks that globally exposed perimeter geometry needs rebuilding.
  let lastDiscoveryAt = -Infinity; // Throttles only cheap scene-child discovery; it never scans source triangles.
  let snowTextureState = 'not-requested'; // Exposed in debugSnapshot() so white canvas texture load/tint failures are visible.
  let snowCanvasTexture = null; // Shared shade-filled white canvas.png texture used by every snow top material.

  const pendingJobs = new Map(); // Source mesh -> newest build request; avoids duplicate work while preserving insertion priority.
  const ownerRoots = new Map(); // Source mesh -> generated top group currently visible for that source.
  const ownerBoundaryRecords = new Map(); // Source mesh -> local true-boundary records used by the cross-owner perimeter registry.
  const globalBoundaryStates = new Map(); // Edge key -> owner/record map; exactly one owner means that edge is exposed.
  const sourceSignatures = new WeakMap(); // Source mesh -> last queued/built geometry signature so discovery does not rebuild unchanged terrain.
  const sharedMaterials = new Map(); // mode:kind -> reusable material; prevents shader/material churn while streaming.

  let completedJobs = 0; // Total completed source-mesh top builds.
  let shellBuilds = 0; // Total completed global continuous-mass shell rebuilds.
  let exactStretchBuilds = 0; // Completed top batches mapped through HobunjiSurfaceStretchUV.
  let fallbackStretchBuilds = 0; // Completed top batches using the cheap protected-edge rectangular fallback.
  let lastSliceMs = 0; // Most recent single-frame snow/slush work slice.
  let maxSliceMs = 0; // Largest observed single-frame snow/slush work slice.
  let lastJobWorkMs = 0; // Accumulated incremental CPU time for the most recently completed source job.
  let maxJobWorkMs = 0; // Largest accumulated CPU time for any completed source job.
  let lastTriangleCount = 0; // Accepted upward-facing triangles in the most recently completed source job.
  let lastBoundaryCount = 0; // Local true-boundary edge count in the most recently completed source job.
  let visibleShellEdges = 0; // Current globally exposed edge count after cross-owner cancellation.
  let deferredLargeSources = 0; // Count of giant root meshes intentionally deferred to TerrainRenderChunks.
  let discoveredSpatialChunks = 0; // Count of renderer spatial chunk sources newly queued after first render.
  let lastReason = 'not initialized'; // Human-readable most recent state transition for mobile/debug reports.

  function now() {
    return globalThis.performance?.now?.() ?? Date.now();
  }

  function debugLog(message, level = 'info') {
    const logger = deps?.debugLog || window.__farmLog || console.log;
    try { logger(`[environment surface] ${message}`, level, 'terrain'); }
    catch (_) { console.log(`[environment surface] ${message}`); }
  }

  function currentSeasonName() {
    try { return String(window.CalendarSystem?.currentSeason?.()?.name || ''); }
    catch (_) { return ''; }
  }

  function currentAreaId() {
    return String(deps?.getCurrentArea?.() || '');
  }

  function isWesternSlope(areaId) {
    return areaId === WESTERN_SLOPE_ID || areaId.includes('western_slope');
  }

  function resolveMode() {
    if (!deps?.getActiveScene?.() || deps?.isOutdoorArea?.() === false) return 'none';
    const areaId = currentAreaId();
    if (isWesternSlope(areaId)) return 'snow';
    return currentSeasonName() === 'Coldmuck' ? 'slush' : 'none';
  }

  function terrainKeyForMesh(mesh) {
    return String(
      mesh?.userData?.terrainEdgeId ||
      mesh?.userData?.terrainKey ||
      mesh?.material?.userData?.terrainKey ||
      '',
    ).toLowerCase();
  }

  function hasTerrainLayer(mesh) {
    const mask = Number(mesh?.layers?.mask || 0) >>> 0;
    return Boolean(mask & (1 << 3));
  }

  function triangleCountForGeometry(geometry) {
    const count = geometry?.index?.count ?? geometry?.attributes?.position?.count ?? 0;
    return Math.floor(Number(count) / 3) || 0;
  }

  function isTerrainSurfaceMesh(mesh, mode) {
    if (!mesh?.isMesh || !mesh.geometry?.attributes?.position || mesh.visible === false) return false;
    if (mesh.userData?.environmentSurfaceRuntime || mesh.userData?.terrainRenderChunkSource) return false;
    if (mesh.userData?.isBillboard || mesh.isSkinnedMesh) return false;
    const key = terrainKeyForMesh(mesh);
    const name = String(mesh.name || '').toLowerCase();
    if (WATER_KEYS.has(key) || /(^|[_-])(water|river|stream|waterfall)([_-]|$)/.test(name)) return false;
    if (mode === 'slush') {
      if (key) return key === 'grass';
      return /grass/.test(name) && (hasTerrainLayer(mesh) || mesh.userData?.terrainRenderChunk === true);
    }
    if (LAND_TARGETS.has(key)) return true;
    if (mesh.userData?.terrainRenderChunk === true) return true;
    if (!hasTerrainLayer(mesh)) return false;
    return /terrain|ground|floor|border|cliff|mesa|ramp|rock|path|trench|raised|paddy|shrub/i.test(name);
  }

  function shouldDeferToSpatialSplit(mesh) {
    if (!window.TerrainRenderChunks?.installed) return false;
    if (!mesh?.parent?.isScene || mesh.userData?.terrainRenderChunk === true || mesh.userData?.terrainRenderChunkSource === true) return false;
    if (mesh.isSkinnedMesh || mesh.isInstancedMesh || Array.isArray(mesh.material) || mesh.geometry?.groups?.length > 1) return false;
    if (!mesh.receiveShadow || !hasTerrainLayer(mesh)) return false;
    return triangleCountForGeometry(mesh.geometry) >= LARGE_TERRAIN_TRIANGLES;
  }

  function elementRange(geometry) {
    const total = geometry?.index?.count ?? geometry?.attributes?.position?.count ?? 0;
    const rawStart = Math.max(0, Math.floor(Number(geometry?.drawRange?.start) || 0));
    const start = Math.min(total, rawStart - (rawStart % 3));
    const rawCount = Number(geometry?.drawRange?.count);
    const available = Math.max(0, total - start);
    const count = Number.isFinite(rawCount) ? Math.max(0, Math.min(available, Math.floor(rawCount))) : available;
    const aligned = count - (count % 3);
    return { start, end: start + aligned, triangles: aligned / 3 };
  }

  function sourceSignature(mesh, mode) {
    const geometry = mesh?.geometry;
    const range = elementRange(geometry);
    const position = geometry?.attributes?.position;
    const index = geometry?.index;
    const p = mesh?.position;
    const s = mesh?.scale;
    return [
      mode,
      geometry?.uuid || 'none',
      Number(position?.version || 0),
      Number(index?.version || 0),
      range.start,
      range.end,
      Number(p?.x || 0).toFixed(4), Number(p?.y || 0).toFixed(4), Number(p?.z || 0).toFixed(4),
      Number(s?.x || 1).toFixed(4), Number(s?.y || 1).toFixed(4), Number(s?.z || 1).toFixed(4),
    ].join('|');
  }

  function frameRemapCoordinate(value) {
    const t = Math.max(0, Math.min(1, Number(value) || 0));
    if (t <= PROTECTED_SURFACE_EDGE) return (t / PROTECTED_SURFACE_EDGE) * PROTECTED_SOURCE_EDGE;
    if (t >= 1 - PROTECTED_SURFACE_EDGE) {
      return 1 - PROTECTED_SOURCE_EDGE + ((t - (1 - PROTECTED_SURFACE_EDGE)) / PROTECTED_SURFACE_EDGE) * PROTECTED_SOURCE_EDGE;
    }
    return PROTECTED_SOURCE_EDGE + ((t - PROTECTED_SURFACE_EDGE) / (1 - PROTECTED_SURFACE_EDGE * 2)) * (1 - PROTECTED_SOURCE_EDGE * 2);
  }

  function quantizedNumber(value) {
    return Math.round(Number(value) * KEY_SCALE);
  }

  function pointKeyNumbers(x, y, z) {
    return `${quantizedNumber(x)},${quantizedNumber(y)},${quantizedNumber(z)}`;
  }

  function edgeKeyNumbers(ax, ay, az, bx, by, bz) {
    const a = pointKeyNumbers(ax, ay, az);
    const b = pointKeyNumbers(bx, by, bz);
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  function localWhiteShadeCanvas(image) {
    try {
      const width = image?.naturalWidth || image?.width;
      const height = image?.naturalHeight || image?.height;
      if (!width || !height) return null;
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0, width, height);
      const imageData = context.getImageData(0, 0, width, height);
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        if (!data[i + 3]) continue;
        const luminance = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
        const shade = Math.max(0.68, Math.min(1.0, 0.76 + luminance * 0.28));
        const value = Math.round(255 * shade);
        data[i] = value; data[i + 1] = value; data[i + 2] = value;
      }
      context.putImageData(imageData, 0, 0);
      return canvas;
    } catch (_) { return null; }
  }

  function requestSnowTexture() {
    if (snowTextureState !== 'not-requested' || !deps?.THREE) return;
    const THREE = deps.THREE;
    snowTextureState = 'loading';
    new THREE.TextureLoader().load(
      'assets/textures/canvas.png',
      texture => {
        let finalTexture = texture;
        try {
          const shadeFill = window.getShadeFillCanvas;
          if (typeof shadeFill === 'function' && texture.image) {
            const canvas = shadeFill(texture.image, 'environment-snow|canvas.png|white', {
              mode: 'shadeFill',
              rgb: [255, 255, 255],
              options: window.getPortraitTintingConfig?.() || {},
            });
            if (canvas) finalTexture = new THREE.CanvasTexture(canvas);
          } else if (texture.image) {
            const canvas = localWhiteShadeCanvas(texture.image);
            if (canvas) finalTexture = new THREE.CanvasTexture(canvas);
          }
        } catch (error) {
          debugLog(`white canvas shade fill failed; using raw canvas.png: ${error?.message || error}`, 'warn');
        }
        finalTexture.wrapS = finalTexture.wrapT = THREE.ClampToEdgeWrapping;
        finalTexture.minFilter = THREE.LinearFilter;
        finalTexture.magFilter = THREE.LinearFilter;
        finalTexture.generateMipmaps = false;
        finalTexture.needsUpdate = true;
        snowCanvasTexture = finalTexture;
        snowTextureState = finalTexture === texture ? 'raw-canvas-png' : 'shade-filled-white-canvas-png';
        for (const [key, material] of sharedMaterials) {
          if (!key.startsWith('snow:top')) continue;
          material.map = snowCanvasTexture;
          material.color.setHex(0xffffff);
          material.needsUpdate = true;
        }
      },
      undefined,
      error => {
        snowTextureState = `load-failed:${String(error?.message || 'unknown')}`;
        debugLog('failed to load assets/textures/canvas.png for snow; keeping white fallback material', 'warn');
      },
    );
  }

  function sharedMaterial(mode, kind) {
    const key = `${mode}:${kind}`;
    if (sharedMaterials.has(key)) return sharedMaterials.get(key);
    const THREE = deps.THREE;
    let material;
    if (mode === 'snow' && kind === 'top') {
      requestSnowTexture();
      material = new THREE.MeshLambertMaterial({
        color: 0xffffff,
        map: snowCanvasTexture,
        side: THREE.DoubleSide,
        transparent: false,
        depthTest: true,
        depthWrite: true,
        fog: true,
      });
    } else if (mode === 'snow') {
      material = new THREE.MeshLambertMaterial({
        color: 0xf1f4f8,
        side: THREE.DoubleSide,
        transparent: false,
        depthTest: true,
        depthWrite: true,
        fog: true,
      });
    } else if (kind === 'top') {
      material = new THREE.MeshPhongMaterial({
        color: 0x101417,
        specular: new THREE.Color(0x70777c),
        shininess: 72,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: PRESETS.slush.opacity,
        depthTest: true,
        depthWrite: false,
        fog: true,
      });
    } else {
      material = new THREE.MeshPhongMaterial({
        color: 0x171c1f,
        specular: new THREE.Color(0x60686d),
        shininess: 54,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: PRESETS.slush.opacity,
        depthTest: true,
        depthWrite: false,
        fog: true,
      });
    }
    material.userData.environmentSurfaceSharedMaterial = true;
    sharedMaterials.set(key, material);
    return material;
  }

  function disposeGeneratedRoot(root) {
    if (!root) return;
    root.parent?.remove(root);
    root.traverse?.(node => node.geometry?.dispose?.());
  }

  function makeSources(mesh) {
    const THREE = deps.THREE;
    const geometry = mesh?.geometry;
    const position = geometry?.attributes?.position;
    if (!position) return { sources: [], bounds: null, totalTriangles: 0 };
    mesh.updateWorldMatrix?.(true, false);
    if (!geometry.boundingBox) geometry.computeBoundingBox?.();
    const range = elementRange(geometry);
    if (range.end <= range.start) return { sources: [], bounds: null, totalTriangles: 0 };
    const sources = [];
    const worldBounds = new THREE.Box3();
    worldBounds.makeEmpty();
    const instanceMatrix = new THREE.Matrix4();
    const combined = new THREE.Matrix4();
    const localBox = geometry.boundingBox?.clone?.() || null;
    if (mesh.isInstancedMesh) {
      for (let instance = 0; instance < mesh.count; instance++) {
        mesh.getMatrixAt(instance, instanceMatrix);
        combined.multiplyMatrices(mesh.matrixWorld, instanceMatrix);
        sources.push({ geometry, position, index: geometry.index || null, start: range.start, end: range.end, matrixWorld: combined.clone() });
        if (localBox) worldBounds.union(localBox.clone().applyMatrix4(combined));
      }
    } else {
      sources.push({ geometry, position, index: geometry.index || null, start: range.start, end: range.end, matrixWorld: mesh.matrixWorld.clone() });
      if (localBox) worldBounds.union(localBox.clone().applyMatrix4(mesh.matrixWorld));
    }
    return {
      sources,
      bounds: worldBounds.isEmpty() ? null : worldBounds,
      totalTriangles: range.triangles * Math.max(1, mesh.isInstancedMesh ? mesh.count : 1),
    };
  }

  function readVertex(source, element, out) {
    const vertexIndex = source.index ? source.index.getX(element) : element;
    out.fromBufferAttribute(source.position, vertexIndex);
    out.applyMatrix4(source.matrixWorld);
    return out;
  }

  function toggleLocalBoundary(job, a, b, third, topAY, topBY) {
    const key = edgeKeyNumbers(a.x, a.y, a.z, b.x, b.y, b.z);
    if (job.boundaryMap.has(key)) {
      job.boundaryMap.delete(key);
      return;
    }
    job.boundaryMap.set(key, {
      key,
      ax: a.x, ay: a.y, az: a.z,
      bx: b.x, by: b.y, bz: b.z,
      cx: third.x, cy: third.y, cz: third.z,
      topAY, topBY,
    });
  }

  function unregisterOwnerBoundary(owner) {
    const records = ownerBoundaryRecords.get(owner);
    if (!records) return;
    ownerBoundaryRecords.delete(owner);
    for (const record of records) {
      const state = globalBoundaryStates.get(record.key);
      if (!state) continue;
      state.owners.delete(owner);
      if (!state.owners.size) globalBoundaryStates.delete(record.key);
    }
    shellRevision++;
    shellDirty = true;
  }

  function registerOwnerBoundary(owner, records) {
    unregisterOwnerBoundary(owner);
    ownerBoundaryRecords.set(owner, records);
    for (const record of records) {
      let state = globalBoundaryStates.get(record.key);
      if (!state) {
        state = { owners: new Map() };
        globalBoundaryStates.set(record.key, state);
      }
      state.owners.set(owner, record);
    }
    shellRevision++;
    shellDirty = true;
  }

  function dropOwner(owner, forgetSignature = false) {
    pendingJobs.delete(owner);
    if (activeJob?.owner === owner) activeJob.cancelled = true;
    unregisterOwnerBoundary(owner);
    const root = ownerRoots.get(owner);
    if (root) disposeGeneratedRoot(root);
    ownerRoots.delete(owner);
    if (forgetSignature) sourceSignatures.delete(owner);
  }

  function createJob(request) {
    const THREE = deps.THREE;
    dropOwner(request.owner, false);
    const prepared = makeSources(request.owner);
    if (!prepared.sources.length) return null;
    const parent = request.owner.parent;
    if (!parent) return null;
    const root = new THREE.Group();
    root.name = `hobunji_environment_surface_${request.mode}_${request.label}`;
    root.userData.environmentSurfaceRuntime = true;
    parent.add(root);
    ownerRoots.set(request.owner, root);
    parent.updateWorldMatrix?.(true, false);
    const parentInverse = new THREE.Matrix4().copy(parent.matrixWorld).invert();
    const job = {
      ...request,
      parent,
      root,
      parentInverse,
      sources: prepared.sources,
      uvBounds: prepared.bounds,
      exactStretch: prepared.totalTriangles <= EXACT_STRETCH_TRIANGLE_LIMIT,
      sourceIndex: 0,
      element: null,
      positions: [],
      normals: [],
      worldXZ: [],
      batchTriangles: 0,
      batchIndex: 0,
      triangleCount: 0,
      boundaryMap: new Map(),
      workMs: 0,
      cancelled: false,
      a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), swap: new THREE.Vector3(),
      ab: new THREE.Vector3(), ac: new THREE.Vector3(), normal: new THREE.Vector3(),
      topA: new THREE.Vector3(), topB: new THREE.Vector3(), topC: new THREE.Vector3(),
      localA: new THREE.Vector3(), localB: new THREE.Vector3(), localC: new THREE.Vector3(),
    };
    return job;
  }

  function nextSource(job) {
    while (job.sourceIndex < job.sources.length) {
      const source = job.sources[job.sourceIndex];
      if (job.element == null) job.element = source.start;
      if (job.element + 2 < source.end) return source;
      job.sourceIndex++;
      job.element = null;
    }
    return null;
  }

  function fallbackUvAttribute(job, vertexCount) {
    const THREE = deps.THREE;
    const bounds = job.uvBounds;
    const minX = Number(bounds?.min?.x || 0);
    const minZ = Number(bounds?.min?.z || 0);
    const dx = Math.max(1e-5, Number(bounds?.max?.x || 1) - minX);
    const dz = Math.max(1e-5, Number(bounds?.max?.z || 1) - minZ);
    const uv = new Float32Array(vertexCount * 2);
    for (let i = 0; i < vertexCount; i++) {
      const x = job.worldXZ[i * 2];
      const z = job.worldXZ[i * 2 + 1];
      uv[i * 2] = frameRemapCoordinate((x - minX) / dx);
      uv[i * 2 + 1] = frameRemapCoordinate((z - minZ) / dz);
    }
    return new THREE.BufferAttribute(uv, 2);
  }

  function mapTopGeometry(job, geometry, finalBatch) {
    if (job.mode !== 'snow') return geometry;
    if (job.exactStretch && finalBatch) {
      const mapper = window.HobunjiSurfaceStretchUV;
      if (typeof mapper?.mapGeometry === 'function') {
        try {
          const mapped = mapper.mapGeometry(geometry, { label: `environment-snow:${job.label}` });
          if (mapped?.getAttribute?.('uv')) {
            if (mapped !== geometry) geometry.dispose?.();
            exactStretchBuilds++;
            return mapped;
          }
        } catch (error) {
          debugLog(`exact snow stretch failed for ${job.label}; using protected fallback: ${error?.message || error}`, 'warn');
        }
      }
    }
    geometry.setAttribute('uv', fallbackUvAttribute(job, geometry.getAttribute('position').count));
    geometry.userData = Object.assign({}, geometry.userData, {
      environmentSnowUvMapping: 'protected-edge-rectangular-fallback',
      protectedSourceEdgeFraction: PROTECTED_SOURCE_EDGE,
      protectedSurfaceEdgeFraction: PROTECTED_SURFACE_EDGE,
    });
    fallbackStretchBuilds++;
    return geometry;
  }

  function flushTopBatch(job, finalBatch = false) {
    if (!job.batchTriangles) return;
    const THREE = deps.THREE;
    let geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(job.positions), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(job.normals), 3));
    geometry = mapTopGeometry(job, geometry, finalBatch);
    geometry.computeBoundingBox?.();
    geometry.computeBoundingSphere?.();
    const mesh = new THREE.Mesh(geometry, sharedMaterial(job.mode, 'top'));
    mesh.name = `${job.root.name}_top_${job.batchIndex++}`;
    mesh.userData.environmentSurfaceRuntime = true;
    mesh.userData.environmentSurfaceFlatTop = true;
    mesh.userData.environmentSurfaceTexture = job.mode === 'snow' ? 'assets/textures/canvas.png|shade-fill-white' : null;
    mesh.renderOrder = job.mode === 'slush' ? 22 : 2;
    mesh.receiveShadow = true;
    job.root.add(mesh);
    job.positions.length = 0;
    job.normals.length = 0;
    job.worldXZ.length = 0;
    job.batchTriangles = 0;
  }

  function pushTopTriangle(job, topA, topB, topC) {
    job.localA.copy(topA).applyMatrix4(job.parentInverse);
    job.localB.copy(topB).applyMatrix4(job.parentInverse);
    job.localC.copy(topC).applyMatrix4(job.parentInverse);
    job.positions.push(
      job.localA.x, job.localA.y, job.localA.z,
      job.localB.x, job.localB.y, job.localB.z,
      job.localC.x, job.localC.y, job.localC.z,
    );
    job.normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0); // Top lighting stays visually flat; no procedural snow bumps alter normals.
    job.worldXZ.push(topA.x, topA.z, topB.x, topB.z, topC.x, topC.z);
    job.batchTriangles++;
    job.triangleCount++;
    if (!job.exactStretch && job.batchTriangles >= TOP_BATCH_TRIANGLES) flushTopBatch(job, false);
  }

  function processTriangle(job) {
    const source = nextSource(job);
    if (!source) return false;
    const element = job.element;
    job.element += 3;
    readVertex(source, element, job.a);
    readVertex(source, element + 1, job.b);
    readVertex(source, element + 2, job.c);
    job.ab.subVectors(job.b, job.a);
    job.ac.subVectors(job.c, job.a);
    job.normal.crossVectors(job.ab, job.ac);
    const length = job.normal.length();
    if (length < 1e-8) return true;
    job.normal.multiplyScalar(1 / length);
    if (job.normal.y < 0) {
      job.swap.copy(job.b); job.b.copy(job.c); job.c.copy(job.swap);
      job.normal.multiplyScalar(-1);
    }
    if (job.normal.y < SURFACE_NORMAL_MIN_Y) return true;

    const height = PRESETS[job.mode].height;
    job.topA.set(job.a.x, job.a.y + height, job.a.z);
    job.topB.set(job.b.x, job.b.y + height, job.b.z);
    job.topC.set(job.c.x, job.c.y + height, job.c.z);
    pushTopTriangle(job, job.topA, job.topB, job.topC);
    toggleLocalBoundary(job, job.a, job.b, job.c, job.topA.y, job.topB.y);
    toggleLocalBoundary(job, job.b, job.c, job.a, job.topB.y, job.topC.y);
    toggleLocalBoundary(job, job.c, job.a, job.b, job.topC.y, job.topA.y);
    return true;
  }

  function finishJob(job) {
    if (job.cancelled || job.owner.parent !== job.parent || job.mode !== resolveMode()) {
      disposeGeneratedRoot(job.root);
      ownerRoots.delete(job.owner);
      return;
    }
    flushTopBatch(job, true);
    const boundaries = [...job.boundaryMap.values()];
    registerOwnerBoundary(job.owner, boundaries);
    sourceSignatures.set(job.owner, job.signature);
    completedJobs++;
    lastJobWorkMs = job.workMs;
    maxJobWorkMs = Math.max(maxJobWorkMs, job.workMs);
    lastTriangleCount = job.triangleCount;
    lastBoundaryCount = boundaries.length;
    lastReason = `${job.label} built (${job.triangleCount} flat top triangles)`;
  }

  function processTopWorkSlice() {
    if (!activeJob) {
      const next = pendingJobs.entries().next();
      if (next.done) return false;
      const [owner, request] = next.value;
      pendingJobs.delete(owner);
      activeJob = createJob(request);
      if (!activeJob) return true;
    }
    const started = now();
    let processed = 0;
    while (activeJob && processed < MAX_TRIANGLES_PER_SLICE && now() - started < WORK_BUDGET_MS) {
      if (activeJob.cancelled) break;
      if (!processTriangle(activeJob)) break;
      processed++;
    }
    const elapsed = now() - started;
    activeJob.workMs += elapsed;
    lastSliceMs = elapsed;
    maxSliceMs = Math.max(maxSliceMs, elapsed);
    const finished = activeJob.cancelled || !nextSource(activeJob);
    if (finished) {
      const completed = activeJob;
      activeJob = null;
      finishJob(completed);
    }
    return true;
  }

  function queueTerrainMesh(mesh, mode, labelPrefix = 'terrain') {
    if (!isTerrainSurfaceMesh(mesh, mode)) return false;
    if (shouldDeferToSpatialSplit(mesh)) {
      deferredLargeSources++;
      return false;
    }
    const signature = sourceSignature(mesh, mode);
    if (activeJob?.owner === mesh && activeJob.signature === signature) return false;
    if (sourceSignatures.get(mesh) === signature && ownerRoots.has(mesh)) return false;
    const pending = pendingJobs.get(mesh);
    if (pending?.signature === signature) return false;
    pendingJobs.set(mesh, {
      owner: mesh,
      mode,
      signature,
      label: `${labelPrefix}_${String(mesh.name || mesh.uuid || 'mesh').replace(/[^a-z0-9_-]+/gi, '_')}`,
    });
    return true;
  }

  function queueTerrainSubtree(root, mode, labelPrefix = 'chunk') {
    const candidates = [];
    root?.traverse?.(node => {
      if (node?.isMesh && isTerrainSurfaceMesh(node, mode) && !shouldDeferToSpatialSplit(node)) candidates.push(node);
    });
    candidates.sort((a, b) => {
      const ac = a.userData?.terrainRenderChunk === true ? 0 : 1;
      const bc = b.userData?.terrainRenderChunk === true ? 0 : 1;
      return ac - bc;
    });
    for (const mesh of candidates) queueTerrainMesh(mesh, mode, labelPrefix);
    return candidates.length;
  }

  function dropTerrainSubtree(root) {
    root?.traverse?.(node => {
      if (!node?.isMesh) return;
      if (ownerRoots.has(node) || pendingJobs.has(node) || sourceSignatures.has(node)) dropOwner(node, true);
    });
  }

  function seedScene(scene, mode) {
    const chunkGroups = [];
    const otherMeshes = [];
    const visit = node => {
      if (!node) return;
      if (node !== scene && node.userData?.wildernessChunk === true) {
        chunkGroups.push(node);
        return;
      }
      if (node.isMesh && isTerrainSurfaceMesh(node, mode)) otherMeshes.push(node);
      for (const child of node.children || []) visit(child);
    };
    visit(scene);
    for (const group of chunkGroups) queueTerrainSubtree(group, mode, 'wilderness');
    otherMeshes.sort((a, b) => {
      const ap = a.userData?.terrainRenderChunk === true ? 0 : shouldDeferToSpatialSplit(a) ? 2 : 1;
      const bp = b.userData?.terrainRenderChunk === true ? 0 : shouldDeferToSpatialSplit(b) ? 2 : 1;
      return ap - bp;
    });
    for (const mesh of otherMeshes) queueTerrainMesh(mesh, mode, 'root');
    lastReason = `seeded ${pendingJobs.size} per-mesh surface jobs`;
  }

  function discoverRendererChunks(scene, mode) {
    if (!scene?.children) return 0;
    let queued = 0;
    for (const child of scene.children) {
      if (child?.userData?.terrainRenderChunkSource === true) {
        if (ownerRoots.has(child) || pendingJobs.has(child) || sourceSignatures.has(child)) dropOwner(child, true);
        for (const spatial of child.children || []) {
          if (spatial?.userData?.terrainRenderChunk !== true) continue;
          if (queueTerrainMesh(spatial, mode, 'spatial')) { queued++; discoveredSpatialChunks++; }
        }
      } else if (child?.isMesh && isTerrainSurfaceMesh(child, mode)) {
        if (queueTerrainMesh(child, mode, 'root-discovery')) queued++;
      }
    }
    return queued;
  }

  function pruneDetachedOwners() {
    for (const owner of [...ownerRoots.keys()]) {
      let node = owner;
      let belongs = false;
      while (node) {
        if (node === attachedScene) { belongs = true; break; }
        node = node.parent;
      }
      if (!belongs) dropOwner(owner, true);
    }
  }

  function exposedGlobalBoundaries() {
    const output = [];
    for (const state of globalBoundaryStates.values()) {
      if (state.owners.size !== 1) continue;
      output.push(state.owners.values().next().value);
    }
    return output;
  }

  function beginShellJob() {
    if (!attachedScene || activeMode === 'none') return;
    const THREE = deps.THREE;
    const records = exposedGlobalBoundaries();
    visibleShellEdges = records.length;
    const root = new THREE.Group();
    root.name = `hobunji_environment_surface_${activeMode}_continuous_mass_shell`;
    root.userData.environmentSurfaceRuntime = true;
    root.userData.environmentSurfaceContinuousMassShell = true;
    attachedScene.updateWorldMatrix?.(true, false);
    shellJob = {
      scene: attachedScene,
      mode: activeMode,
      revision: shellRevision,
      records,
      index: 0,
      root,
      positions: [],
      batchIndex: 0,
      sceneInverse: new THREE.Matrix4().copy(attachedScene.matrixWorld).invert(),
      point: new THREE.Vector3(),
      workMs: 0,
    };
    shellDirty = false;
  }

  function shellPushPoint(job, x, y, z) {
    job.point.set(x, y, z).applyMatrix4(job.sceneInverse);
    job.positions.push(job.point.x, job.point.y, job.point.z);
  }

  function flushShellBatch(job) {
    if (!job.positions.length) return;
    const THREE = deps.THREE;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(job.positions), 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, sharedMaterial(job.mode, 'shell'));
    mesh.name = `${job.root.name}_${job.batchIndex++}`;
    mesh.userData.environmentSurfaceRuntime = true;
    mesh.userData.environmentSurfaceMassShellOutline = true;
    mesh.layers.enable(SHELL_OUTLINE_LAYER);
    mesh.renderOrder = job.mode === 'slush' ? 22.1 : 2.1;
    mesh.receiveShadow = true;
    job.root.add(mesh);
    job.positions.length = 0;
  }

  function appendShellEdge(job, record) {
    const preset = PRESETS[job.mode];
    const ex = record.bx - record.ax;
    const ez = record.bz - record.az;
    const edgeLength = Math.hypot(ex, ez);
    if (edgeLength < 1e-8) return;
    let ox = ez / edgeLength;
    let oz = -ex / edgeLength;
    const midX = (record.ax + record.bx) * 0.5;
    const midZ = (record.az + record.bz) * 0.5;
    if (ox * (record.cx - midX) + oz * (record.cz - midZ) > 0) { ox *= -1; oz *= -1; }

    let prevAX = record.ax, prevAY = record.topAY, prevAZ = record.az;
    let prevBX = record.bx, prevBY = record.topBY, prevBZ = record.bz;
    for (let segment = 1; segment <= EDGE_SEGMENTS; segment++) {
      const t = segment / EDGE_SEGMENTS;
      const outward = preset.edgeWidth * Math.sin(t * Math.PI); // Bulges outward mid-curve but returns to the source tile edge at t=1.
      const verticalT = Math.pow(t, preset.edgeRound);
      const nextAX = record.ax + ox * outward;
      const nextAY = record.topAY + (record.ay - record.topAY) * verticalT; // t=1 is exactly the original surface Y regardless of snow height scaling.
      const nextAZ = record.az + oz * outward;
      const nextBX = record.bx + ox * outward;
      const nextBY = record.topBY + (record.by - record.topBY) * verticalT;
      const nextBZ = record.bz + oz * outward;
      shellPushPoint(job, prevAX, prevAY, prevAZ);
      shellPushPoint(job, prevBX, prevBY, prevBZ);
      shellPushPoint(job, nextBX, nextBY, nextBZ);
      shellPushPoint(job, prevAX, prevAY, prevAZ);
      shellPushPoint(job, nextBX, nextBY, nextBZ);
      shellPushPoint(job, nextAX, nextAY, nextAZ);
      prevAX = nextAX; prevAY = nextAY; prevAZ = nextAZ;
      prevBX = nextBX; prevBY = nextBY; prevBZ = nextBZ;
    }
  }

  function finishShellJob(job) {
    flushShellBatch(job);
    if (job.revision !== shellRevision || job.scene !== attachedScene || job.mode !== activeMode) {
      disposeGeneratedRoot(job.root);
      shellDirty = true;
      return;
    }
    disposeGeneratedRoot(shellRoot);
    shellRoot = null;
    if (job.root.children.length) {
      job.scene.add(job.root);
      shellRoot = job.root;
    }
    shellBuilds++;
    lastReason = `continuous ${job.mode} shell rebuilt (${job.records.length} exposed edges)`;
  }

  function processShellWorkSlice() {
    if (!shellJob) beginShellJob();
    if (!shellJob) return false;
    const job = shellJob;
    const started = now();
    let edges = 0;
    while (job.index < job.records.length && edges < SHELL_BATCH_EDGES && now() - started < WORK_BUDGET_MS) {
      appendShellEdge(job, job.records[job.index++]);
      edges++;
      if (job.positions.length >= SHELL_BATCH_EDGES * EDGE_SEGMENTS * 18) flushShellBatch(job);
    }
    const elapsed = now() - started;
    job.workMs += elapsed;
    lastSliceMs = elapsed;
    maxSliceMs = Math.max(maxSliceMs, elapsed);
    if (job.index >= job.records.length) {
      shellJob = null;
      finishShellJob(job);
    }
    return true;
  }

  function clearAllSurfaces(reason) {
    pendingJobs.clear();
    if (activeJob) {
      activeJob.cancelled = true;
      disposeGeneratedRoot(activeJob.root);
      activeJob = null;
    }
    if (shellJob) {
      disposeGeneratedRoot(shellJob.root);
      shellJob = null;
    }
    for (const root of ownerRoots.values()) disposeGeneratedRoot(root);
    ownerRoots.clear();
    ownerBoundaryRecords.clear();
    globalBoundaryStates.clear();
    disposeGeneratedRoot(shellRoot);
    shellRoot = null;
    visibleShellEdges = 0;
    shellRevision++;
    shellDirty = false;
    lastReason = reason;
  }

  function syncAreaState(reason = 'scene/area/season mode changed') {
    const scene = deps?.getActiveScene?.() || null;
    const area = currentAreaId();
    const mode = resolveMode();
    clearAllSurfaces(reason);
    attachedScene = scene;
    activeArea = area;
    activeMode = mode;
    lastDiscoveryAt = -Infinity;
    if (!scene || mode === 'none') return;
    seedScene(scene, mode);
    debugLog(`${area || '(unknown area)'} => ${mode}; queued ${pendingJobs.size} per-mesh jobs (flat tops, canvas snow texture)`);
  }

  function findWildernessChunkAncestor(object) {
    let node = object;
    while (node) {
      if (node.userData?.wildernessChunk === true) return node;
      node = node.parent;
    }
    return null;
  }

  function installWildernessHooks() {
    const api = window.WildernessChunks;
    if (!api || api.__environmentSurfaceRuntimeV4) return Boolean(api?.__environmentSurfaceRuntimeV4);
    const originalCreateZone = api.createZone;
    const originalAttachObject = api.attachObject;
    if (typeof originalCreateZone !== 'function' || typeof originalAttachObject !== 'function') return false;

    api.createZone = function (config = {}) {
      const callerLoaded = config.onChunkLoaded;
      const callerUnloaded = config.onChunkUnloaded;
      const mapId = config.mapId;
      return originalCreateZone.call(this, {
        ...config,
        onChunkLoaded(record) {
          callerLoaded?.(record);
          if (mapId === currentAreaId() && resolveMode() !== 'none') queueTerrainSubtree(record?.group, resolveMode(), 'wilderness-load');
        },
        onChunkUnloaded(record) {
          dropTerrainSubtree(record?.group);
          callerUnloaded?.(record);
        },
      });
    };

    api.attachObject = function (mapId, col, row, object) {
      const attached = originalAttachObject.call(this, mapId, col, row, object);
      if (!attached || mapId !== currentAreaId() || resolveMode() === 'none') return attached;
      const chunk = findWildernessChunkAncestor(object);
      if (chunk && object) queueTerrainSubtree(object, resolveMode(), 'wilderness-attach');
      return attached;
    };

    api.__environmentSurfaceRuntimeV4 = true;
    wildernessHooksInstalled = true;
    return true;
  }

  function init(injectedDeps) {
    deps = injectedDeps || deps;
    installWildernessHooks();
    attachedScene = null;
    activeArea = null;
    activeMode = 'none';
    requestSnowTexture();
    lastReason = 'initialized; awaiting active outdoor scene';
    debugLog('runtime v4 installed: flat half-height Western snow, white canvas PNG tops, protected-edge stretch, continuous shells');
  }

  function update() {
    if (!deps) return;
    if (!wildernessHooksInstalled) wildernessHooksInstalled = installWildernessHooks();
    const scene = deps.getActiveScene?.() || null;
    const area = currentAreaId();
    const mode = resolveMode();
    if (scene !== attachedScene || area !== activeArea || mode !== activeMode) syncAreaState();
    if (!scene || mode === 'none') return;

    const time = now();
    if (time - lastDiscoveryAt >= DISCOVERY_INTERVAL_MS) {
      lastDiscoveryAt = time;
      discoverRendererChunks(scene, mode);
      pruneDetachedOwners();
    }

    if (activeJob || pendingJobs.size) {
      processTopWorkSlice();
      return;
    }
    if (shellDirty || shellJob) processShellWorkSlice();
  }

  function forceRebuild(reason = 'manual debug rebuild') {
    syncAreaState(reason);
    return debugSnapshot();
  }

  function debugSnapshot() {
    return {
      installed: true,
      version: 4,
      initialized: Boolean(deps),
      area: currentAreaId() || null,
      season: currentSeasonName() || null,
      mode: resolveMode(),
      activeMode,
      pendingJobs: pendingJobs.size,
      activeJob: activeJob?.label || null,
      ownerSurfaces: ownerRoots.size,
      completedJobs,
      shellBuilds,
      shellDirty,
      shellInProgress: Boolean(shellJob),
      visibleShellEdges,
      lastSliceMs: Number(lastSliceMs.toFixed(2)),
      maxSliceMs: Number(maxSliceMs.toFixed(2)),
      lastJobWorkMs: Number(lastJobWorkMs.toFixed(2)),
      maxJobWorkMs: Number(maxJobWorkMs.toFixed(2)),
      lastTriangles: lastTriangleCount,
      lastBoundaryEdges: lastBoundaryCount,
      exactStretchBuilds,
      fallbackStretchBuilds,
      deferredLargeSources,
      discoveredSpatialChunks,
      snowTextureState,
      wildernessHooksInstalled,
      lastReason,
      presets: PRESETS,
      protectedStretch: { sourceEdgeFraction: PROTECTED_SOURCE_EDGE, surfaceEdgeFraction: PROTECTED_SURFACE_EDGE },
    };
  }

  function installRainPlanesBridge() {
    const rainPlanes = window.RainPlanes;
    if (!rainPlanes?.init || !rainPlanes?.update || rainPlanes.__environmentSurfaceBridgeV4) return false;
    priorRainInit = rainPlanes.init;
    priorRainUpdate = rainPlanes.update;
    rainPlanes.init = function (injectedDeps) {
      const result = priorRainInit.call(this, injectedDeps);
      init(injectedDeps);
      return result;
    };
    rainPlanes.update = function (dt) {
      const result = priorRainUpdate.call(this, dt);
      update(dt);
      return result;
    };
    rainPlanes.__environmentSurfaceBridgeV4 = true;
    return true;
  }

  window.EnvironmentSurfaceRuntime = {
    __installedV4: true,
    PRESETS,
    init,
    update,
    forceRebuild,
    debugSnapshot,
  };

  if (!installRainPlanesBridge()) console.warn('[environment surface] RainPlanes was unavailable; runtime bridge not installed.');
})();