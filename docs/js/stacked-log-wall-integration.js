// StackedLogWalls — shared adapter between authored wall panels and the
// foliage generator's exact-length capped logs.
//
// This deliberately does not introduce a second structure/interior renderer:
// - InteriorSceneBuilder keeps owning room boundaries and window/door cuts.
// - HousePieceGen keeps owning tapered walls, gables, outlines and structure transforms.
// - FoliageGenerator owns every visible log's geometry and bark material.
(function (root) {
  'use strict';

  if (root.StackedLogWalls?.version >= 1) return;

  const SCRIPT_SRC = document.currentScript?.src || location.href; // Used to resolve sibling dependencies when an editor does not already load foliage-generator.js.
  const FOLIAGE_URL = (() => { // Used only by standalone authoring tools; the game already loads foliage-generator.js normally.
    try { return new URL('foliage-generator.js', SCRIPT_SRC).href; }
    catch (_) { return '../../js/foliage-generator.js'; }
  })();
  const DEFAULT_RADIUS = 0.085; // Used as the nominal radius for thin stacked wall logs.
  const COURSE_DIAMETER_OVERLAP = 0.86; // Used to overlap adjacent courses slightly so light cannot leak through the wall.
  const X_AXIS = () => new root.THREE.Vector3(1, 0, 0); // Used to rotate foliage logs from their authored +X axis onto each wall course.

  let housePiecePatched = false; // Prevents wrapping HousePieceGen.buildGroupFromPiece more than once.
  let interiorBuilderPatched = false; // Prevents wrapping InteriorSceneBuilder.buildWallGroup more than once.
  let foliagePromise = null; // Shares one dynamic foliage-generator load across editor calls.
  let pollTimer = 0; // Used by game/tool pages whose normal script order supplies dependencies shortly after this file.

  function log(message, level = 'info') {
    const text = `[StackedLogWalls] ${message}`; // Used in both in-page mobile debug panes and the console fallback.
    if (typeof root.__farmLog === 'function') root.__farmLog(text, level);
    const debug = document.getElementById('debugLog'); // Used by both authoring tools so failures are visible without devtools.
    if (debug) {
      const line = `[${new Date().toLocaleTimeString()}] ${level}: ${text}`; // Used as the newest line in the editor's debug pane.
      debug.textContent = `${debug.textContent || ''}${debug.textContent ? '\n' : ''}${line}`;
      debug.scrollTop = debug.scrollHeight;
    }
    const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'; // Used to preserve severity in desktop debugging.
    console[method](text);
  }

  function isBuildingInteriorEditor() {
    return Boolean(document.getElementById('biaApp')); // Limits dynamic dependency loading/UI injection to the intended interior authoring tool.
  }

  function isHousePieceEditor() {
    return Boolean(document.getElementById('generateBaseBtn') && document.getElementById('jsonInput')); // Identifies the structure author without depending on a private editor state object.
  }

  function ensureFoliageGenerator() {
    if (root.FoliageGenerator?.buildLogMesh) return Promise.resolve(root.FoliageGenerator);
    if (foliagePromise) return foliagePromise;

    foliagePromise = new Promise((resolve, reject) => {
      const existing = Array.from(document.scripts).find(script => /\/foliage-generator\.js(?:[?#]|$)/.test(script.src || '')); // Used to avoid injecting a duplicate when a page already has the normal foliage script in flight.
      const script = existing || document.createElement('script'); // Used as the one dependency script node for standalone editors.
      const finish = () => {
        if (root.FoliageGenerator?.buildLogMesh) resolve(root.FoliageGenerator);
        else reject(new Error('foliage-generator.js loaded without buildLogMesh().'));
      };
      script.addEventListener('load', finish, { once: true });
      script.addEventListener('error', () => reject(new Error(`Could not load ${FOLIAGE_URL}`)), { once: true });
      if (!existing) {
        script.src = FOLIAGE_URL;
        script.dataset.stackedLogWallDependency = '1';
        document.head.appendChild(script);
      } else if (root.FoliageGenerator?.buildLogMesh) {
        finish();
      }
    });
    return foliagePromise;
  }

  function vectorFrom(value, fallback) {
    if (value?.isVector3) return value.clone();
    if (Array.isArray(value)) return new root.THREE.Vector3(Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0);
    return fallback ? fallback.clone() : new root.THREE.Vector3();
  }

  function panelCorners(THREE, panel) {
    if (Array.isArray(panel?.corners) && panel.corners.length >= 4) {
      return panel.corners.slice(0, 4).map(corner => vectorFrom(corner));
    }
    const width = Math.max(0.001, Number(panel?.width) || 0.001); // Used to build rectangular interior panels that do not carry explicit frustum corners.
    const height = Math.max(0.001, Number(panel?.height) || 0.001); // Used as the floor-to-ceiling edge length for ordinary interiors.
    const position = Array.isArray(panel?.position) ? panel.position : [0, 0, 0]; // Used as the bottom-center transform of a canonical wall panel.
    const rotationDeg = Array.isArray(panel?.rotationDeg) ? panel.rotationDeg : [0, 0, 0]; // Used to orient canonical local corners into world coordinates.
    const euler = new THREE.Euler(
      THREE.MathUtils.degToRad(Number(rotationDeg[0]) || 0),
      THREE.MathUtils.degToRad(Number(rotationDeg[1]) || 0),
      THREE.MathUtils.degToRad(Number(rotationDeg[2]) || 0),
      'XYZ'
    );
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(Number(position[0]) || 0, Number(position[1]) || 0, Number(position[2]) || 0),
      new THREE.Quaternion().setFromEuler(euler),
      new THREE.Vector3(1, 1, 1)
    );
    return [
      new THREE.Vector3(-width * 0.5, 0, 0).applyMatrix4(matrix),
      new THREE.Vector3(width * 0.5, 0, 0).applyMatrix4(matrix),
      new THREE.Vector3(width * 0.5, height, 0).applyMatrix4(matrix),
      new THREE.Vector3(-width * 0.5, height, 0).applyMatrix4(matrix),
    ];
  }

  function fallbackLog(THREE, length, radius, barkColorHex) {
    const material = new THREE.MeshLambertMaterial({ color: barkColorHex ?? 0x4a3b33 }); // Used only if the foliage dependency unexpectedly disappears after installation.
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.97, radius, length, 8, 1, false), material); // Capped procedural safety geometry; never a scaled GLB.
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0));
    const group = new THREE.Group(); // Matches FoliageGenerator.buildLogMesh's transform-root shape.
    group.add(mesh);
    group.userData.foliageLogFallback = true;
    return group;
  }

  function buildStackedLogWalls(THREE, wallPanels, options = {}) {
    const group = new THREE.Group(); // Used as one wall-surface group by InteriorSceneBuilder and HousePieceGen.
    group.name = 'stacked_log_walls';
    group.userData.isStackedLogWalls = true;
    group.userData.interiorWallSurfaceGroup = true;

    const panels = Array.isArray(wallPanels) ? wallPanels.filter(Boolean) : []; // Used as the canonical already-cut wall surfaces to convert into log courses.
    const requestedRadius = Math.max(0.02, Number(options.logRadius) || DEFAULT_RADIUS); // Used as the preferred wall-log thickness while still fitting short panels.
    const barkColorHex = Number.isFinite(Number(options.barkColorHex)) ? Number(options.barkColorHex) : 0x4a3b33; // Used to allow future structure presets to tint the generated bark at source.
    let logCount = 0; // Reported in userData/debug so mobile testing can verify what actually generated.
    let exactLengthTotal = 0; // Reported for diagnostics and confirms geometry was generated to spans rather than post-scaled.

    panels.forEach((panel, panelIndex) => {
      const corners = panelCorners(THREE, panel); // Used as bottom-left, bottom-right, top-right, top-left boundaries for tapered and rectangular walls alike.
      const bottomLeft = corners[0]; // Used as the left edge's course interpolation origin.
      const bottomRight = corners[1]; // Used as the right edge's course interpolation origin.
      const topRight = corners[2]; // Used as the right edge's course interpolation destination.
      const topLeft = corners[3]; // Used as the left edge's course interpolation destination.
      const leftHeight = bottomLeft.distanceTo(topLeft); // Used with the opposite edge to estimate course count on tapered faces.
      const rightHeight = bottomRight.distanceTo(topRight); // Used with the opposite edge to estimate course count on tapered faces.
      const averageHeight = Math.max(0.001, (leftHeight + rightHeight) * 0.5); // Used to select a stable number of stacked rows for this panel.
      const nominalPitch = Math.max(0.025, requestedRadius * 2 * COURSE_DIAMETER_OVERLAP); // Used to slightly overlap logs vertically and eliminate daylight seams.
      const courseCount = Math.max(1, Math.ceil(averageHeight / nominalPitch)); // Used to fill the complete wall height without scaling any generated log.
      const courseStep = averageHeight / courseCount; // Used to fit the chosen number of rows exactly into short or tall panels.
      const courseRadius = Math.max(0.018, Math.min(requestedRadius, courseStep / (2 * COURSE_DIAMETER_OVERLAP))); // Used to shrink only radius on unusually short panels while preserving exact span length.

      for (let course = 0; course < courseCount; course++) {
        const t = (course + 0.5) / courseCount; // Used to sample the center height of this log course on both tapered side edges.
        const left = bottomLeft.clone().lerp(topLeft, t); // Used as the exact generated log's first endpoint.
        const right = bottomRight.clone().lerp(topRight, t); // Used as the exact generated log's second endpoint.
        const direction = right.clone().sub(left); // Used to derive both exact requested length and final orientation.
        const length = direction.length(); // Passed directly into FoliageGenerator; never reproduced by object scaling.
        if (length < 0.03) continue;
        direction.multiplyScalar(1 / length);
        const center = left.clone().add(right).multiplyScalar(0.5); // Used as the world-space transform root for a centered foliage log.
        const seed = `stacked-wall:${panel.id || panelIndex}:${course}:${left.x.toFixed(3)},${left.y.toFixed(3)},${left.z.toFixed(3)}:${right.x.toFixed(3)},${right.y.toFixed(3)},${right.z.toFixed(3)}`; // Used to keep bark deterministic for authored wall geometry.
        const log = root.FoliageGenerator?.buildLogMesh
          ? root.FoliageGenerator.buildLogMesh({ length, radius: courseRadius, seed, barkColorHex })
          : fallbackLog(THREE, length, courseRadius, barkColorHex); // Safety path remains generated/capped, never a stretched asset.
        log.position.copy(center);
        log.quaternion.setFromUnitVectors(X_AXIS(), direction);
        log.userData = Object.assign({}, log.userData, {
          stackedLogWallCourse: true,
          stackedLogPanelId: panel.id || panelIndex,
          stackedLogCourseIndex: course,
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
      panelCount: panels.length,
      logCount,
      requestedRadius,
      exactLengthTotal: Number(exactLengthTotal.toFixed(3)),
      geometrySource: root.FoliageGenerator?.buildLogMesh ? 'FoliageGenerator.buildLogMesh' : 'generated-cylinder-fallback',
      postScaledLogs: 0,
    };
    return group;
  }

  function patchInteriorSceneBuilder() {
    const builder = root.InteriorSceneBuilder; // Used to retain the canonical opening split and all existing non-log wall styles.
    if (!builder || interiorBuilderPatched) return false;
    const originalBuildWallGroup = builder.buildWallGroup; // Used for brick/cavern/mine/canvas styles without behavior changes.
    if (typeof originalBuildWallGroup !== 'function') return false;

    builder.buildStackedLogWalls = buildStackedLogWalls;
    builder.buildWallGroup = function (THREE, wallBuilder, wallPanels, wallStyle, wbOpts) {
      if (wallStyle !== 'stackedLogs') return originalBuildWallGroup.call(builder, THREE, wallBuilder, wallPanels, wallStyle, wbOpts);
      const options = Object.assign({}, wbOpts || {}); // Used to preserve authored wall options while removing only the opening metadata after subtraction.
      const renderPanels = typeof builder.applyWallOpenings === 'function'
        ? builder.applyWallOpenings(wallPanels, options.wallOpenings)
        : (wallPanels || []); // Uses the exact same door/window split as brick walls before any log is generated.
      delete options.wallOpenings;
      return buildStackedLogWalls(THREE, renderPanels, options);
    };
    interiorBuilderPatched = true;
    return true;
  }

  function patchHousePieceGen() {
    const generator = root.HousePieceGen; // Used to reuse its existing tapered/gable panel generation and wall hiding path.
    if (!generator || housePiecePatched || typeof generator.buildGroupFromPiece !== 'function') return false;
    const originalBuildGroupFromPiece = generator.buildGroupFromPiece; // Used unchanged for every structure that does not request stacked logs.

    generator.buildGroupFromPiece = function (payload, opts) {
      const piece = payload?.currentPiece || payload || {}; // Used to support both raw-piece and editor-export payloads.
      if (piece.wallStyle !== 'stackedLogs') return originalBuildGroupFromPiece.call(generator, payload, opts);
      const callerOptions = opts || {}; // Used to preserve every existing preview/runtime structure option.
      const logWallOptions = Object.assign({}, callerOptions.logWallOpts || {}); // Used for future per-structure radius/bark overrides without mutating caller data.
      const proceduralWallBuilder = {
        build(panels, wallBuilderOptions) {
          return buildStackedLogWalls(root.THREE, panels, Object.assign({}, wallBuilderOptions || {}, logWallOptions));
        }
      }; // Passed through HousePieceGen's normal WallBuilder seam so it still suppresses source wall planes and retains gable/body handling.
      const group = originalBuildGroupFromPiece.call(generator, payload, Object.assign({}, callerOptions, { wallBuilder: proceduralWallBuilder })); // Reuses all existing structure geometry/outline/tint integration.
      group?.traverse?.(object => {
        if (object.userData?.isStackedLogWalls) {
          object.userData.isWallBricks = false;
          object.userData.wallConstruction = 'stackedLogs';
        }
      });
      return group;
    };
    housePiecePatched = true;
    return true;
  }

  function addInteriorEditorOption() {
    if (!isBuildingInteriorEditor()) return;
    const select = document.getElementById('wallStyle'); // Used as the existing serialized wallStyle control; no new interior schema field is needed.
    if (!select || select.querySelector('option[value="stackedLogs"]')) return;
    const option = document.createElement('option'); // Adds the new shared wall style beside brick/cavern/canvas.
    option.value = 'stackedLogs';
    option.textContent = 'Stacked thin logs (procedural)';
    select.insertBefore(option, select.children[1] || null);

    const exportText = document.getElementById('exportText'); // Used to restore an already-loaded stackedLogs value if the option arrived after the editor's first afterLoad().
    try {
      const data = JSON.parse(exportText?.value || '{}'); // Reads only the editor's own current exported state; it does not mutate it.
      if (data.wallStyle === 'stackedLogs') select.value = 'stackedLogs';
    } catch (_) {}
  }

  function readHousePayload() {
    const refresh = document.getElementById('refreshExportBtn'); // Used to ask the editor to sync private state into its normal export surface.
    const output = document.getElementById('exportText'); // Used as the public bridge into the otherwise private house editor state.
    if (!refresh || !output) return null;
    refresh.click();
    try { return JSON.parse(output.value); }
    catch (_) { return null; }
  }

  function housePieceFromPayload(payload) {
    return payload?.currentPiece || payload || null;
  }

  function importHousePayload(payload) {
    const input = document.getElementById('jsonInput'); // Used to feed the edited wallStyle back through the house editor's existing validated import path.
    if (!input || !payload) return false;
    const file = new File([JSON.stringify(payload, null, 2)], 'stacked-log-wall-style.json', { type: 'application/json' }); // Used as the editor's ordinary import carrier; no hidden state mutation is required.
    if (typeof DataTransfer === 'function') {
      const transfer = new DataTransfer(); // Used to populate the file input in browsers that expose the normal drag/drop API.
      transfer.items.add(file);
      input.files = transfer.files;
    } else {
      Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    }
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function syncHouseEditorSelect() {
    const select = document.getElementById('houseWallStyle'); // Used to mirror the current imported/exported piece's top-level wallStyle.
    if (!select) return;
    const payload = readHousePayload(); // Reads the authoritative private editor state through its supported export button.
    const piece = housePieceFromPayload(payload); // Used to support both currentPiece wrappers and direct piece imports.
    select.value = piece?.wallStyle === 'stackedLogs' ? 'stackedLogs' : '';
  }

  function applyHouseEditorWallStyle(value) {
    const payload = readHousePayload(); // Used as a lossless round-trip so every unrelated authored field is preserved.
    const piece = housePieceFromPayload(payload); // The only object whose wallStyle is changed.
    if (!piece) {
      log('Could not read the current structure payload to change wall construction.', 'error');
      return;
    }
    if (value === 'stackedLogs') piece.wallStyle = 'stackedLogs';
    else delete piece.wallStyle;
    if (!importHousePayload(payload)) {
      log('Could not route wall construction through the structure editor import path.', 'error');
      return;
    }
    setTimeout(() => {
      document.getElementById('refreshExportBtn')?.click(); // Triggers the editor's own scheduled game-preview rebuild after FileReader finishes importing.
      syncHouseEditorSelect();
      log(value === 'stackedLogs' ? 'Structure walls set to foliage-generated stacked logs.' : 'Structure walls restored to brick/default construction.');
    }, 120);
  }

  function addHouseEditorOption() {
    if (!isHousePieceEditor() || document.getElementById('houseWallStyle')) return;
    const wallThickness = document.getElementById('wallThickness'); // Used as the insertion anchor so wall construction lives beside the existing wall dimensions.
    const anchor = wallThickness?.closest('.grid3') || wallThickness?.parentElement; // Keeps the injected control inside the structure/base settings section.
    if (!anchor) return;

    const row = document.createElement('div'); // Used as a compact editor-native row for construction style and mobile-visible diagnostics.
    row.className = 'grid2';
    row.style.marginTop = '8px';
    const field = document.createElement('div'); // Hosts the serialized wall construction selector.
    field.className = 'field';
    const label = document.createElement('label'); // Names the control without introducing a new concept/panel.
    label.textContent = 'Wall construction';
    const select = document.createElement('select'); // Round-trips piece.wallStyle through the editor's existing JSON import/export seam.
    select.id = 'houseWallStyle';
    select.innerHTML = '<option value="">Brick (default)</option><option value="stackedLogs">Stacked thin logs (procedural)</option>';
    field.append(label, select);

    const infoField = document.createElement('div'); // Provides concise behavior/debug information where mobile users can actually see it.
    infoField.className = 'field';
    const infoLabel = document.createElement('label'); // Aligns the debug button with the neighboring field.
    infoLabel.textContent = 'Procedural wall debug';
    const debugButton = document.createElement('button'); // Dumps patch/dependency/style state into the existing on-page debug log.
    debugButton.type = 'button';
    debugButton.id = 'debugStackedLogWallsBtn';
    debugButton.textContent = 'Debug log walls';
    infoField.append(infoLabel, debugButton);
    row.append(field, infoField);
    anchor.after(row);

    select.addEventListener('change', () => applyHouseEditorWallStyle(select.value));
    debugButton.addEventListener('click', () => {
      const snapshot = debugSnapshot(); // Used as a visible one-tap diagnostic for editor/runtime integration state.
      log(`Debug snapshot: ${JSON.stringify(snapshot)}`);
    });
    document.getElementById('jsonInput')?.addEventListener('change', () => setTimeout(syncHouseEditorSelect, 140));
    document.getElementById('refreshExportBtn')?.addEventListener('click', () => setTimeout(syncHouseEditorSelect, 0));
    syncHouseEditorSelect();
  }

  function debugSnapshot() {
    const housePayload = isHousePieceEditor() ? readHousePayload() : null; // Used to include the currently-authored structure style in one mobile-visible snapshot.
    return {
      version: 1,
      foliageReady: Boolean(root.FoliageGenerator?.buildLogMesh),
      interiorBuilderPatched,
      housePiecePatched,
      buildingInteriorEditor: isBuildingInteriorEditor(),
      housePieceEditor: isHousePieceEditor(),
      houseWallStyle: housePieceFromPayload(housePayload)?.wallStyle || '',
      interiorWallStyle: document.getElementById('wallStyle')?.value || '',
    };
  }

  function installReadyPieces() {
    patchInteriorSceneBuilder();
    patchHousePieceGen();
    addInteriorEditorOption();
    addHouseEditorOption();
  }

  function waitForNormalDependencies() {
    let attempts = 0; // Used to bound polling on pages where normal static script order loads foliage/HousePieceGen/InteriorSceneBuilder after this integration.
    clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      attempts += 1;
      installReadyPieces();
      if (root.FoliageGenerator?.buildLogMesh && (root.InteriorSceneBuilder || root.HousePieceGen || attempts > 100)) {
        clearInterval(pollTimer);
        pollTimer = 0;
      }
      if (attempts > 100) {
        clearInterval(pollTimer);
        pollTimer = 0;
      }
    }, 100);
  }

  root.StackedLogWalls = Object.freeze({
    version: 1,
    buildStackedLogWalls,
    ensureFoliageGenerator,
    debugSnapshot,
    install: installReadyPieces,
  });

  // Standalone authoring tools do not normally load foliage-generator.js, so
  // they request it here. Game/cutscene pages keep their established static
  // load order and are only polled, avoiding duplicate script injection.
  if (isBuildingInteriorEditor() || isHousePieceEditor()) {
    ensureFoliageGenerator()
      .then(() => {
        installReadyPieces();
        log('Foliage-generated stacked log wall support ready.');
      })
      .catch(error => log(error.message || String(error), 'error'));
  } else {
    installReadyPieces();
    waitForNormalDependencies();
  }
})(window);
