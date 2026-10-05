// Shared stacked-log wall adapter for gameplay and authoring tools.
// Wall spans/openings remain owned by the existing builders; the foliage
// generator only supplies exact-length capped log geometry for each course.
(function (root) {
  'use strict';

  if (root.StackedLogWalls?.version >= 2) return;

  const THREE = root.THREE; // Used by all generated log-wall transforms.
  if (!THREE) return;

  const SCRIPT_SRC = document.currentScript?.src || location.href; // Used to resolve the foliage dependency beside this script.
  const FOLIAGE_URL = new URL('foliage-generator.js', SCRIPT_SRC).href; // Used by standalone editors that do not already load foliage generation.
  const DEFAULT_RADIUS = 0.085; // Used as the preferred thin wall-log radius.
  const COURSE_OVERLAP = 0.86; // Used to overlap adjacent courses enough to avoid daylight seams.
  const X_AXIS = new THREE.Vector3(1, 0, 0); // Used as buildLogMesh's authored longitudinal axis.

  let interiorPatched = false; // Prevents wrapping InteriorSceneBuilder twice.
  let housePatched = false; // Prevents wrapping HousePieceGen twice.
  let foliageLoadPromise = null; // Shares one editor-side foliage script request.
  let pollTimer = 0; // Used when normal page script order supplies dependencies after this adapter.

  function log(message, level = 'info') {
    const text = `[StackedLogWalls] ${message}`; // Used for both the mobile-visible debug pane and console.
    const debug = document.getElementById('debugLog'); // Existing editor log; avoids requiring devtools on mobile.
    if (debug) {
      const line = `[${new Date().toLocaleTimeString()}] ${level}: ${text}`; // Used as the appended debug entry.
      debug.textContent = `${debug.textContent || ''}${debug.textContent ? '\n' : ''}${line}`;
      debug.scrollTop = debug.scrollHeight;
    }
    if (typeof root.__farmLog === 'function') root.__farmLog(text, level);
    const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'; // Used to preserve severity outside editors.
    console[method](text);
  }

  function isInteriorEditor() {
    return Boolean(document.getElementById('biaApp')); // Used to limit interior-editor UI injection.
  }

  function isStructureEditor() {
    return Boolean(document.getElementById('generateBaseBtn') && document.getElementById('jsonInput')); // Used to limit structure-editor UI injection.
  }

  function ensureFoliageGenerator() {
    if (root.FoliageGenerator?.buildLogMesh) return Promise.resolve(root.FoliageGenerator);
    if (foliageLoadPromise) return foliageLoadPromise;

    foliageLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script'); // Used to load foliage generation only in standalone editors.
      script.src = FOLIAGE_URL;
      script.dataset.stackedLogWallFoliage = '1';
      script.onload = () => root.FoliageGenerator?.buildLogMesh
        ? resolve(root.FoliageGenerator)
        : reject(new Error('Foliage generator loaded without buildLogMesh().'));
      script.onerror = () => reject(new Error(`Failed to load ${FOLIAGE_URL}`));
      document.head.appendChild(script);
    });
    return foliageLoadPromise;
  }

  function vector(value) {
    return value?.isVector3
      ? value.clone()
      : new THREE.Vector3(Number(value?.[0]) || 0, Number(value?.[1]) || 0, Number(value?.[2]) || 0);
  }

  function cornersForPanel(panel) {
    if (Array.isArray(panel?.corners) && panel.corners.length >= 4) {
      return panel.corners.slice(0, 4).map(vector);
    }

    const width = Math.max(0.001, Number(panel?.width) || 0.001); // Used as the canonical rectangular panel width.
    const height = Math.max(0.001, Number(panel?.height) || 0.001); // Used as the canonical rectangular panel height.
    const position = panel?.position || [0, 0, 0]; // Used as the floor-referenced panel origin.
    const rotation = panel?.rotationDeg || [0, 0, 0]; // Used to orient local rectangular corners into world space.
    const euler = new THREE.Euler(
      THREE.MathUtils.degToRad(Number(rotation[0]) || 0),
      THREE.MathUtils.degToRad(Number(rotation[1]) || 0),
      THREE.MathUtils.degToRad(Number(rotation[2]) || 0),
      'XYZ'
    );
    const matrix = new THREE.Matrix4().compose(
      vector(position),
      new THREE.Quaternion().setFromEuler(euler),
      new THREE.Vector3(1, 1, 1)
    );
    return [
      new THREE.Vector3(-width / 2, 0, 0).applyMatrix4(matrix),
      new THREE.Vector3(width / 2, 0, 0).applyMatrix4(matrix),
      new THREE.Vector3(width / 2, height, 0).applyMatrix4(matrix),
      new THREE.Vector3(-width / 2, height, 0).applyMatrix4(matrix),
    ];
  }

  function buildFallbackLog(length, radius, barkColorHex) {
    const geometry = new THREE.CylinderGeometry(radius * 0.97, radius, length, 8, 1, false); // Capped generated safety geometry; never a stretched GLB.
    geometry.rotateZ(Math.PI / 2);
    const material = new THREE.MeshLambertMaterial({ color: barkColorHex }); // Used only if foliage generation disappears unexpectedly.
    const group = new THREE.Group(); // Matches FoliageGenerator.buildLogMesh's transform-root contract.
    group.add(new THREE.Mesh(geometry, material));
    group.userData.foliageLogFallback = true;
    return group;
  }

  function buildStackedLogWalls(_three, panels, options = {}) {
    const group = new THREE.Group(); // Returned through the existing wall-builder seams in interiors and structures.
    group.name = 'stacked_log_walls';
    group.userData.isStackedLogWalls = true;
    group.userData.interiorWallSurfaceGroup = true;

    const wallPanels = Array.isArray(panels) ? panels.filter(Boolean) : []; // Used as the already-authored/already-cut wall rectangles.
    const requestedRadius = Math.max(0.02, Number(options.logRadius) || DEFAULT_RADIUS); // Used as the preferred course thickness.
    const barkColorHex = Number.isFinite(Number(options.barkColorHex)) ? Number(options.barkColorHex) : 0x4a3b33; // Used as the generated bark material color.
    let logCount = 0; // Exposed in debug metadata so mobile tests can verify generation.
    let exactLengthTotal = 0; // Exposed to verify spans are generated at length rather than object-scaled.

    wallPanels.forEach((panel, panelIndex) => {
      const corners = cornersForPanel(panel); // Used as bottom-left, bottom-right, top-right, top-left wall boundaries.
      const bottomLeft = corners[0]; // Used as the left wall-edge course origin.
      const bottomRight = corners[1]; // Used as the right wall-edge course origin.
      const topRight = corners[2]; // Used as the right wall-edge course destination.
      const topLeft = corners[3]; // Used as the left wall-edge course destination.
      const averageHeight = Math.max(0.001, (bottomLeft.distanceTo(topLeft) + bottomRight.distanceTo(topRight)) / 2); // Used to choose course count on tapered and rectangular faces.
      const desiredPitch = Math.max(0.025, requestedRadius * 2 * COURSE_OVERLAP); // Used to keep courses thin while slightly overlapping.
      const courseCount = Math.max(1, Math.ceil(averageHeight / desiredPitch)); // Used to fill the full panel height.
      const fittedPitch = averageHeight / courseCount; // Used to fit the selected number of courses exactly to short panels.
      const radius = Math.max(0.018, Math.min(requestedRadius, fittedPitch / (2 * COURSE_OVERLAP))); // Used to reduce radius only when a short panel demands it.

      for (let courseIndex = 0; courseIndex < courseCount; courseIndex += 1) {
        const t = (courseIndex + 0.5) / courseCount; // Used to sample this course halfway through its vertical allocation.
        const start = bottomLeft.clone().lerp(topLeft, t); // Used as one exact endpoint of the generated log.
        const end = bottomRight.clone().lerp(topRight, t); // Used as the other exact endpoint of the generated log.
        const direction = end.clone().sub(start); // Used to derive requested length and world rotation.
        const length = direction.length(); // Passed directly into foliage generation; no post-generation longitudinal scaling occurs.
        if (length < 0.03) continue;
        direction.multiplyScalar(1 / length);

        const center = start.clone().add(end).multiplyScalar(0.5); // Used as the centered log's world-space placement.
        const seed = `stacked-wall:${panel.id || panelIndex}:${courseIndex}:${start.x.toFixed(3)},${start.y.toFixed(3)},${start.z.toFixed(3)}:${end.x.toFixed(3)},${end.y.toFixed(3)},${end.z.toFixed(3)}`; // Used for deterministic bark variation.
        const log = root.FoliageGenerator?.buildLogMesh
          ? root.FoliageGenerator.buildLogMesh({ length, radius, seed, barkColorHex })
          : buildFallbackLog(length, radius, barkColorHex);
        log.position.copy(center);
        log.quaternion.setFromUnitVectors(X_AXIS, direction);
        log.userData = Object.assign({}, log.userData, {
          stackedLogWallCourse: true,
          stackedLogPanelId: panel.id || panelIndex,
          stackedLogCourseIndex: courseIndex,
          exactGeneratedLength: length,
          housePieceWallSurface: true,
          farmMaterialRole: 'wood',
        });
        log.traverse(child => {
          if (!child.isMesh) return;
          child.castShadow = true;
          child.receiveShadow = true;
          child.userData = Object.assign({}, child.userData, {
            stackedLogWallCourse: true,
            housePieceWallSurface: true,
            interiorWallSurface: true,
            cameraObstacle: true,
            farmMaterialRole: 'wood',
          });
        });
        group.add(log);
        logCount += 1;
        exactLengthTotal += length;
      }
    });

    group.userData.stackedLogWallDebug = {
      panelCount: wallPanels.length,
      logCount,
      requestedRadius,
      exactLengthTotal: Number(exactLengthTotal.toFixed(3)),
      geometrySource: root.FoliageGenerator?.buildLogMesh ? 'FoliageGenerator.buildLogMesh' : 'generated-cylinder-fallback',
      postScaledLogs: 0,
    };
    return group;
  }

  function patchInteriorBuilder() {
    const builder = root.InteriorSceneBuilder; // Existing shared interior renderer being extended, not replaced.
    if (!builder || interiorPatched || typeof builder.buildWallGroup !== 'function') return false;
    const original = builder.buildWallGroup; // Used unchanged for brick/cavern/mine/canvas walls.
    builder.buildStackedLogWalls = buildStackedLogWalls;
    builder.buildWallGroup = function (three, wallBuilder, panels, wallStyle, options) {
      if (wallStyle !== 'stackedLogs') return original.call(builder, three, wallBuilder, panels, wallStyle, options);
      const wallOptions = Object.assign({}, options || {}); // Used to preserve all non-opening caller options.
      const cutPanels = typeof builder.applyWallOpenings === 'function'
        ? builder.applyWallOpenings(panels, wallOptions.wallOpenings)
        : panels; // Uses the same silhouette subtraction as brick walls before courses are generated.
      delete wallOptions.wallOpenings;
      return buildStackedLogWalls(three, cutPanels, wallOptions);
    };
    interiorPatched = true;
    return true;
  }

  function patchHousePieceGenerator() {
    const generator = root.HousePieceGen; // Existing structure generator being extended through its WallBuilder seam.
    if (!generator || housePatched || typeof generator.buildGroupFromPiece !== 'function') return false;
    const original = generator.buildGroupFromPiece; // Used unchanged for non-log structures.
    generator.buildGroupFromPiece = function (payload, options) {
      const piece = payload?.currentPiece || payload || {}; // Used to read top-level authored wallStyle from either accepted payload shape.
      if (piece.wallStyle !== 'stackedLogs') return original.call(generator, payload, options);
      const callerOptions = options || {}; // Used to retain all normal structure preview/runtime options.
      const logOptions = Object.assign({}, callerOptions.logWallOpts || {}); // Used for future structure-specific bark/radius overrides.
      const proceduralWallBuilder = {
        build(wallPanels, wallBuilderOptions) {
          return buildStackedLogWalls(THREE, wallPanels, Object.assign({}, wallBuilderOptions || {}, logOptions));
        }
      }; // Lets HousePieceGen continue owning tapered body/gable panel generation and source-wall suppression.
      const result = original.call(generator, payload, Object.assign({}, callerOptions, { wallBuilder: proceduralWallBuilder }));
      result?.traverse?.(object => {
        if (!object.userData?.isStackedLogWalls) return;
        object.userData.isWallBricks = false;
        object.userData.wallConstruction = 'stackedLogs';
      });
      return result;
    };
    housePatched = true;
    return true;
  }

  function addInteriorEditorOption() {
    if (!isInteriorEditor()) return;
    const select = document.getElementById('wallStyle'); // Existing serialized interior.wallStyle control.
    if (!select || select.querySelector('option[value="stackedLogs"]')) return;
    const option = document.createElement('option'); // Adds the new construction style without adding a schema field.
    option.value = 'stackedLogs';
    option.textContent = 'Stacked thin logs (procedural)';
    select.insertBefore(option, select.children[1] || null);

    try {
      const exported = JSON.parse(document.getElementById('exportText')?.value || '{}'); // Used to restore an already-loaded log-wall interior after late script injection.
      if (exported.wallStyle === 'stackedLogs') select.value = 'stackedLogs';
    } catch (_) {}
  }

  function parseHouseExport() {
    const output = document.getElementById('exportText'); // Used as the public bridge into the structure editor's otherwise private state.
    if (!output) return null;
    try { return JSON.parse(output.value); }
    catch (_) { return null; }
  }

  function refreshAndReadHouseExport() {
    document.getElementById('refreshExportBtn')?.click(); // Used only for mutations/debug reads that explicitly need freshly-synced private state.
    return parseHouseExport();
  }

  function housePiece(payload) {
    return payload?.currentPiece || payload || null;
  }

  function importHousePayload(payload) {
    const input = document.getElementById('jsonInput'); // Existing validated structure import path used instead of mutating private editor state.
    if (!input || !payload) return false;
    const file = new File([JSON.stringify(payload, null, 2)], 'stacked-log-wall-style.json', { type: 'application/json' }); // Temporary carrier for the editor's ordinary FileReader importer.
    if (typeof DataTransfer === 'function') {
      const transfer = new DataTransfer(); // Used to populate the file input in supported browsers.
      transfer.items.add(file);
      input.files = transfer.files;
    } else {
      Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    }
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function syncStructureEditorSelect() {
    const select = document.getElementById('houseWallStyle'); // Injected wall-construction selector being synchronized after imports/refreshes.
    if (!select) return;
    const piece = housePiece(parseHouseExport()); // Reads current export text without clicking Refresh, preventing refresh→sync recursion.
    select.value = piece?.wallStyle === 'stackedLogs' ? 'stackedLogs' : '';
  }

  function applyStructureWallStyle(value) {
    const payload = refreshAndReadHouseExport(); // Captures every current authored field before changing only wallStyle.
    const piece = housePiece(payload); // Exact current structure record being modified.
    if (!piece) {
      log('Could not read current structure data.', 'error');
      return;
    }
    if (value === 'stackedLogs') piece.wallStyle = 'stackedLogs';
    else delete piece.wallStyle;
    if (!importHousePayload(payload)) {
      log('Could not route wall construction through the structure importer.', 'error');
      return;
    }
    setTimeout(() => {
      document.getElementById('refreshExportBtn')?.click(); // Rebuilds the editor's game preview after FileReader import settles.
      syncStructureEditorSelect();
      log(value === 'stackedLogs'
        ? 'Structure walls set to foliage-generated stacked logs.'
        : 'Structure walls restored to brick/default construction.');
    }, 140);
  }

  function addStructureEditorOption() {
    if (!isStructureEditor() || document.getElementById('houseWallStyle')) return;
    const wallThickness = document.getElementById('wallThickness'); // Existing structure-wall field used as a nearby insertion anchor.
    const anchor = wallThickness?.closest('.grid3') || wallThickness?.parentElement;
    if (!anchor) return;

    const row = document.createElement('div'); // Hosts construction choice plus a mobile-visible debug action.
    row.className = 'grid2';
    row.style.marginTop = '8px';

    const field = document.createElement('div'); // Hosts the serialized wallStyle selector.
    field.className = 'field';
    const label = document.createElement('label'); // Labels the new structure-level wall construction setting.
    label.textContent = 'Wall construction';
    const select = document.createElement('select'); // Writes piece.wallStyle through the editor's existing import/export seam.
    select.id = 'houseWallStyle';
    select.innerHTML = '<option value="">Brick (default)</option><option value="stackedLogs">Stacked thin logs (procedural)</option>';
    field.append(label, select);

    const debugField = document.createElement('div'); // Hosts diagnostics beside the selector without a new panel.
    debugField.className = 'field';
    const debugLabel = document.createElement('label'); // Keeps debug UI aligned with ordinary fields.
    debugLabel.textContent = 'Procedural wall debug';
    const debugButton = document.createElement('button'); // Dumps adapter state into the existing visible debug pane.
    debugButton.type = 'button';
    debugButton.id = 'debugStackedLogWallsBtn';
    debugButton.textContent = 'Debug log walls';
    debugField.append(debugLabel, debugButton);
    row.append(field, debugField);
    anchor.after(row);

    select.addEventListener('change', () => applyStructureWallStyle(select.value));
    debugButton.addEventListener('click', () => log(`Debug snapshot: ${JSON.stringify(debugSnapshot())}`));
    document.getElementById('jsonInput')?.addEventListener('change', () => setTimeout(syncStructureEditorSelect, 160));
    document.getElementById('refreshExportBtn')?.addEventListener('click', () => setTimeout(syncStructureEditorSelect, 0));
    syncStructureEditorSelect();
  }

  function debugSnapshot() {
    const currentPiece = isStructureEditor() ? housePiece(refreshAndReadHouseExport()) : null; // Used only on explicit debug requests, where a fresh editor sync is desired.
    return {
      version: 2,
      foliageReady: Boolean(root.FoliageGenerator?.buildLogMesh),
      interiorPatched,
      housePatched,
      interiorEditor: isInteriorEditor(),
      structureEditor: isStructureEditor(),
      interiorWallStyle: document.getElementById('wallStyle')?.value || '',
      structureWallStyle: currentPiece?.wallStyle || '',
    };
  }

  function install() {
    patchInteriorBuilder();
    patchHousePieceGenerator();
    addInteriorEditorOption();
    addStructureEditorOption();
  }

  function pollDependencies() {
    if (pollTimer) return;
    let attempts = 0; // Used to bound dependency polling on normal game/tool pages.
    pollTimer = setInterval(() => {
      attempts += 1;
      install();
      if (attempts >= 100 || (root.FoliageGenerator?.buildLogMesh && (root.InteriorSceneBuilder || root.HousePieceGen))) {
        clearInterval(pollTimer);
        pollTimer = 0;
      }
    }, 100);
  }

  root.StackedLogWalls = Object.freeze({
    version: 2,
    buildStackedLogWalls,
    ensureFoliageGenerator,
    debugSnapshot,
    install,
  });

  if (isInteriorEditor() || isStructureEditor()) {
    ensureFoliageGenerator()
      .then(() => {
        install();
        log('Foliage-generated stacked log wall support ready.');
      })
      .catch(error => log(error?.message || String(error), 'error'));
  } else {
    install();
    pollDependencies();
  }
})(window);
