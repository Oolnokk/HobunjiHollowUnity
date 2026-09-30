// Farmhouse linked-window bridge.
//
// Player windows are authored only from the farmhouse exterior. Exterior
// walls expose fixed two-tile slots; one owned window occupies one slot and
// punches the matching hole. The interior representation is always synthetic
// and simply mirrors that exterior slot/hole without becoming player-editable.
(() => {
  'use strict';

  if (Number(window.HouseWindowLinkage?.version) >= 12) return;

  const VERSION = 12; // v12 parents the exterior window and exact cut guide to one wall-aligned aperture frame.
  const WINDOW_KEYS = new Set(['simpleWindow', 'crossbarWindow', 'wideWindow']); // Only authored daylight-window furniture participates.
  const PEER_SUFFIX = ':house-window-peer'; // Deterministic suffix lets a primary decor id regenerate the same opposite-side id after load.
  const INTERIOR_SCALE = 2; // HousePieces.computeInteriorLayout maps every exterior farm tile to a 2x2 interior footprint.
  const EXTERIOR_WALL_HEIGHT = 1.4; // HousePieceGen Highland body height used to normalize vertical window placement.
  const EXTERIOR_HEIGHT_SCALE = 1; // Exterior frame and brick opening retain the authored height around the attachment center.
  const EXTERIOR_SLOT_TILES = 2; // Fixed placement density: at most one window per two tiles of exposed exterior wall.
  const EXTERIOR_SLOT_V01 = 0.5; // Every exterior slot is vertically centered; aiming chooses only the horizontal slot.
  const INTERIOR_WALL_HEIGHT = 1.75; // Game interior wall height used to scale the same normalized vertical position indoors.
  const BODY_TOP_SCALE = 0.85; // HousePieceGen Highland wall taper used to put exterior peers back on the sloped body plane.
  const PLANE_TOLERANCE = 0.6; // Maximum farm-grid distance accepted when identifying the clicked tapered exterior wall.
  const FALLBACK_SILHOUETTES = Object.freeze({ // Exact authored outer-frame bounds used if daylight-window part recipes are unavailable during early boot.
    simpleWindow: Object.freeze({ minX: -0.48, maxX: 0.48, minY: 0.54, maxY: 1.70, width: 0.96, height: 1.16 }),
    crossbarWindow: Object.freeze({ minX: -0.55, maxX: 0.55, minY: 0.50, maxY: 1.74, width: 1.10, height: 1.24 }),
    wideWindow: Object.freeze({ minX: -0.77, maxX: 0.77, minY: 0.62, maxY: 1.58, width: 1.54, height: 0.96 }),
  });
  const pairState = new Map(); // Runtime-only primary-id -> pair summary used by diagnostics and rebuild queries.
  const teardownPrimaryIds = new Set(); // Prevents a pair cleanup from recursively reacting to its own sidecar removals.

  let farmDeps = null; // Captured from FarmEditor.init; supplies house pieces, scenes, furniture construction, and geometry rebuilds.
  let rebuildTimer = null; // Debounces expensive house/interior geometry rebuilds to one task after an explicit gizmo save.
  let restoreTimer = null; // Coalesces post-layout restoration so synthetic peers are rebuilt after ordinary decor and house pieces exist.
  let restoreRebuildAfter = false; // Any queued caller may upgrade a coalesced restore to request one geometry rebuild; post-rebuild callers never cause a loop.
  let realignTimer = null; // Coalesces peer-transform refreshes after a whole house piece moves/rebuilds.
  let lastError = null; // Most recent recoverable link error, exposed through the mobile-friendly debug snapshot.

  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback; // Normalizes sidecar/import numeric fields.
  const clamp = (value, min, max) => Math.max(min, Math.min(max, finite(value))); // Keeps linked centers inside the physical exterior frame.
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value)); // Pair metadata is persisted detached from live records.

  function wallApi() {
    return window.WallOrnamentPlacement || null; // Central wall-placement API remains the only transform authority for both halves.
  }

  function isWindowKey(key) {
    return WINDOW_KEYS.has(String(key || '')); // Guards signs/torches/other wall ornaments from farmhouse-specific pairing.
  }

  function isWindowObject(object) {
    return !!object && isWindowKey(object.key) && (object.area === 'farm' || object.area === 'interior'); // Only the farmhouse's two corresponding spaces link.
  }

  function outwardNormal(side) {
    return side === 'north' ? [0, 0, -1]
      : side === 'south' ? [0, 0, 1]
      : side === 'west' ? [-1, 0, 0]
      : [1, 0, 0]; // Exterior cardinal normal used by the wall transform solver.
  }

  function pieceAxisOrigin(piece, side) {
    return side === 'north' || side === 'south' ? finite(piece?.col) : finite(piece?.row); // Local run offsets survive whole-room movement.
  }

  function pieceAxisLength(piece, side) {
    return side === 'north' || side === 'south' ? Math.max(1, finite(piece?.w, 1)) : Math.max(1, finite(piece?.h, 1)); // Used for tapering along-wall coordinates.
  }

  function piecePerpendicularLength(piece, side) {
    return side === 'north' || side === 'south' ? Math.max(1, finite(piece?.h, 1)) : Math.max(1, finite(piece?.w, 1)); // Used for the inward frustum shift at height.
  }

  function pieceSideFixed(piece, side) {
    if (side === 'north') return finite(piece?.row);
    if (side === 'south') return finite(piece?.row) + Math.max(1, finite(piece?.h, 1));
    if (side === 'west') return finite(piece?.col);
    return finite(piece?.col) + Math.max(1, finite(piece?.w, 1)); // Bottom-edge farm coordinate of the selected exterior side.
  }

  function builtPieces() {
    return (farmDeps?.getHousePieces?.() || []).filter(piece => piece?.stage === 'built'); // Foundations do not have a linkable rendered wall.
  }

  function buildBoundaryRuns() {
    const pieces = builtPieces(); // Current movable-house records used both for occupancy and stable piece-local ownership.
    const occupied = new Set(); // Union occupancy determines whether a candidate cell edge is truly exterior rather than a room seam.
    pieces.forEach(piece => {
      for (let row = finite(piece.row); row < finite(piece.row) + Math.max(1, finite(piece.h, 1)); row++) {
        for (let col = finite(piece.col); col < finite(piece.col) + Math.max(1, finite(piece.w, 1)); col++) occupied.add(`${col},${row}`);
      }
    });

    const intervalsByKey = new Map(); // piece+side+fixed -> exposed one-cell intervals, merged below into continuous wall surfaces.
    const addInterval = (piece, side, fixed, start, end) => {
      const key = `${piece.id}|${side}|${fixed}`; // Group key keeps adjacent pieces from accidentally sharing one normalized surface.
      if (!intervalsByKey.has(key)) intervalsByKey.set(key, { pieceId: piece.id, side, fixed, intervals: [] });
      intervalsByKey.get(key).intervals.push([start, end]);
    };

    pieces.forEach(piece => {
      const col0 = finite(piece.col); // Piece west edge used by all cell scans below.
      const row0 = finite(piece.row); // Piece north edge used by all cell scans below.
      const width = Math.max(1, finite(piece.w, 1)); // Piece farm-grid width used by the exposure loop.
      const height = Math.max(1, finite(piece.h, 1)); // Piece farm-grid height used by the exposure loop.
      for (let row = row0; row < row0 + height; row++) {
        for (let col = col0; col < col0 + width; col++) {
          if (!occupied.has(`${col},${row - 1}`)) addInterval(piece, 'north', row, col, col + 1);
          if (!occupied.has(`${col},${row + 1}`)) addInterval(piece, 'south', row + 1, col, col + 1);
          if (!occupied.has(`${col - 1},${row}`)) addInterval(piece, 'west', col, row, row + 1);
          if (!occupied.has(`${col + 1},${row}`)) addInterval(piece, 'east', col + 1, row, row + 1);
        }
      }
    });

    const runs = []; // Continuous exposed surfaces are the normalization domain for paired window U coordinates.
    intervalsByKey.forEach(group => {
      const sorted = group.intervals.sort((a, b) => a[0] - b[0]); // Adjacent one-cell intervals become one draggable wall run.
      let current = null; // Current merged interval for this piece/side/fixed plane.
      sorted.forEach(interval => {
        if (!current || interval[0] > current[1] + 1e-6) {
          if (current) runs.push(Object.assign({}, group, { start: current[0], end: current[1], intervals: undefined }));
          current = interval.slice();
        } else current[1] = Math.max(current[1], interval[1]);
      });
      if (current) runs.push(Object.assign({}, group, { start: current[0], end: current[1], intervals: undefined }));
    });
    return runs;
  }

  function pieceById(id) {
    return builtPieces().find(piece => piece.id === id) || null; // Binding resolution follows a moved room by stable house-piece id.
  }

  function localizeRun(run) {
    const piece = pieceById(run?.pieceId); // Current piece origin converts absolute exposed-run coordinates into move-stable offsets.
    if (!piece || !run) return null;
    const origin = pieceAxisOrigin(piece, run.side); // Along-wall origin of the owning room.
    return { pieceId: run.pieceId, side: run.side, localStart: run.start - origin, localEnd: run.end - origin }; // Stored linkage excludes absolute farm position.
  }

  function resolveRun(binding) {
    const piece = pieceById(binding?.pieceId); // Moving a whole house piece updates the link without rewriting sidecar metadata.
    if (!piece || !binding?.side) return null;
    const origin = pieceAxisOrigin(piece, binding.side); // Current along-wall piece origin used to rehydrate local offsets.
    const start = origin + finite(binding.localStart); // Current farm-grid start of the linked exposed segment.
    const end = origin + finite(binding.localEnd, pieceAxisLength(piece, binding.side)); // Current farm-grid end of the linked exposed segment.
    return { pieceId: piece.id, side: binding.side, fixed: pieceSideFixed(piece, binding.side), start, end, piece };
  }

  function renderRectForRun(run) {
    return window.HousePieces?.getExteriorRenderRect?.(run?.pieceId) || run?.piece; // Same expanded Highland footprint used by HousePieceGen.
  }

  function windowSilhouette(key) {
    const parts = window.DaylightWindowRuntime?.__test?.WINDOW_PARTS?.[key]; // Authored/procedural fallback parts provide the real outer frame, not only the glass pane.
    if (!Array.isArray(parts) || !parts.length) return FALLBACK_SILHOUETTES[key] || { width: 1, height: 1 };
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity; // Bounds accumulate every visible frame/pane/mullion part.
    parts.forEach(part => {
      const transform = part?.transform || {}; // Part-local center and dimensions from the same recipe used to render the window.
      const x = finite(transform.x); // Part center X used for silhouette horizontal extent.
      const y = finite(transform.y); // Part center Y used for silhouette vertical extent.
      const sx = Math.abs(finite(transform.sx)); // Part width in furniture-local units.
      const sy = Math.abs(finite(transform.sy)); // Part height in furniture-local units.
      minX = Math.min(minX, x - sx * 0.5); maxX = Math.max(maxX, x + sx * 0.5);
      minY = Math.min(minY, y - sy * 0.5); maxY = Math.max(maxY, y + sy * 0.5);
    });
    if (!Number.isFinite(minX) || !Number.isFinite(minY)) return FALLBACK_SILHOUETTES[key] || { minX: -0.5, maxX: 0.5, minY: 0, maxY: 1, width: 1, height: 1 };
    return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY }; // Exact visible bounds let the exterior brick gap share the frame's real lower edge.
  }

  function exteriorWindowSilhouette(key) {
    const silhouette = windowSilhouette(key); // Same authored frame bounds drive both the visible farm peer and its brick cut.
    const centerY = (silhouette.minY + silhouette.maxY) * 0.5; // Current window attachment anchors are authored at this visual center.
    const minY = centerY + (silhouette.minY - centerY) * EXTERIOR_HEIGHT_SCALE; // Lower frame edge around the unchanged wall attachment center.
    const maxY = centerY + (silhouette.maxY - centerY) * EXTERIOR_HEIGHT_SCALE; // Upper frame edge around the unchanged wall attachment center.
    return Object.assign({}, silhouette, { centerY, minY, maxY, height: maxY - minY, scaleY: EXTERIOR_HEIGHT_SCALE });
  }

  function exteriorTaperScale(v01) {
    return Math.max(0.01, 1 - (1 - BODY_TOP_SCALE) * clamp(v01, 0, 1)); // HousePieceGen interpolates wall width between full-size base and 85% eave.
  }

  function placementTargetPoint(placement) {
    const point = Array.isArray(placement?.wallPoint) ? placement.wallPoint : [0, 0, 0]; // Base wall hit retained by WallOrnamentPlacement.
    const basis = wallApi()?.wallBasis?.(placement?.wallNormal) || { tangent: [1, 0, 0], normal: [0, 0, 1] }; // Shared wall basis keeps U/N interpretation identical.
    return [
      finite(point[0]) + finite(placement?.offsetU) * basis.tangent[0] + finite(placement?.normalOffset) * basis.normal[0],
      finite(point[1]) + finite(placement?.offsetV),
      finite(point[2]) + finite(placement?.offsetU) * basis.tangent[2] + finite(placement?.normalOffset) * basis.normal[2],
    ];
  }

  function farmWallPoint(run, u01, v01) {
    const piece = run?.piece || pieceById(run?.pieceId); // Owning room dimensions define the Highland body's 15% top taper.
    if (!piece || !run) return null;
    const canonicalAlong = run.start + (run.end - run.start) * u01; // Untapered floor-edge coordinate represented by the normalized link.
    const side = run.side; // Cardinal side chooses which farm axis is fixed versus along-wall.
    const render = renderRectForRun(run) || piece; // Neighbor extensions can shift the rendered wall center.
    const alongCenter = pieceAxisOrigin(render, side) + pieceAxisLength(render, side) * 0.5; // Highland body taper pivot.
    const taperScale = 1 - (1 - BODY_TOP_SCALE) * clamp(v01, 0, 1); // Linear body taper from full footprint at floor to 85% at eave.
    const actualAlong = alongCenter + (canonicalAlong - alongCenter) * taperScale; // Reprojects normalized U onto the wall at the requested height.
    const inwardShift = piecePerpendicularLength(render, side) * (1 - taperScale) * 0.5; // Follows the generated wall rather than only the owning room.
    const fixed = run.fixed; // Untapered bottom-edge side coordinate.
    if (side === 'north') return [actualAlong, v01 * EXTERIOR_WALL_HEIGHT, fixed + inwardShift];
    if (side === 'south') return [actualAlong, v01 * EXTERIOR_WALL_HEIGHT, fixed - inwardShift];
    if (side === 'west') return [fixed + inwardShift, v01 * EXTERIOR_WALL_HEIGHT, actualAlong];
    return [fixed - inwardShift, v01 * EXTERIOR_WALL_HEIGHT, actualAlong];
  }

  function exteriorSlotSurface(run, binding) {
    const center = farmWallPoint(run, binding?.u01, binding?.v01); // Shared physical center for the exterior attachment and brick cut.
    const bottom = farmWallPoint(run, binding?.u01, 0); // Floor-edge sample determines how the Highland wall leans in world space.
    const top = farmWallPoint(run, binding?.u01, 1); // Eave sample determines the same slope without guessing a wall normal.
    if (!center || !bottom || !top) return null;
    return { center, slopeX: (top[0] - bottom[0]) / EXTERIOR_WALL_HEIGHT, slopeZ: (top[2] - bottom[2]) / EXTERIOR_WALL_HEIGHT };
  }

  function canonicalAlongFromFarmPoint(run, point, v01) {
    const piece = run?.piece || pieceById(run?.pieceId); // Same owning room used by farmWallPoint so the mapping is reversible.
    if (!piece || !run) return NaN;
    const side = run.side; // Cardinal side chooses observed X or Z as the along-wall coordinate.
    const observedAlong = side === 'north' || side === 'south' ? finite(point?.[0]) : finite(point?.[2]); // Actual tapered wall coordinate clicked by the player.
    const render = renderRectForRun(run) || piece; // Inverts the same expanded wall surface used for placement.
    const alongCenter = pieceAxisOrigin(render, side) + pieceAxisLength(render, side) * 0.5; // Taper pivot along the generated wall.
    const taperScale = Math.max(0.01, 1 - (1 - BODY_TOP_SCALE) * clamp(v01, 0, 1)); // Avoids division by zero even if future tuning becomes extreme.
    return alongCenter + (observedAlong - alongCenter) / taperScale; // Undo the frustum shrink to recover the stable floor-edge coordinate.
  }

  function expectedFarmFixed(run, v01) {
    const piece = run?.piece || pieceById(run?.pieceId); // Owning room supplies perpendicular dimension for taper depth.
    if (!piece || !run) return NaN;
    const taperScale = 1 - (1 - BODY_TOP_SCALE) * clamp(v01, 0, 1); // Same vertical taper factor used by farmWallPoint.
    const inwardShift = piecePerpendicularLength(renderRectForRun(run) || piece, run.side) * (1 - taperScale) * 0.5; // Side-plane displacement of the rendered body.
    if (run.side === 'north' || run.side === 'west') return run.fixed + inwardShift;
    return run.fixed - inwardShift;
  }

  function exteriorSlotLayout(run) {
    if (!run) return null;
    const length = Math.max(0, finite(run.end) - finite(run.start));
    const count = Math.floor(length / EXTERIOR_SLOT_TILES); // A wall shorter than two tiles intentionally exposes no window slot.
    if (count < 1) return null;
    const unused = length - count * EXTERIOR_SLOT_TILES; // Odd leftover wall is split evenly so the slot pattern stays centered.
    return {
      count,
      firstCenter: run.start + unused * 0.5 + EXTERIOR_SLOT_TILES * 0.5,
      spacing: EXTERIOR_SLOT_TILES,
      length,
    };
  }

  function snapBindingToExteriorSlot(binding) {
    const run = resolveRun(binding);
    const layout = exteriorSlotLayout(run);
    if (!run || !layout) return null;
    const desiredAlong = run.start + layout.length * clamp(binding?.u01, 0, 1);
    const rawIndex = Math.round((desiredAlong - layout.firstCenter) / layout.spacing);
    const slotIndex = Math.max(0, Math.min(layout.count - 1, rawIndex));
    const canonicalAlong = layout.firstCenter + slotIndex * layout.spacing;
    return Object.assign({}, binding, {
      u01: (canonicalAlong - run.start) / Math.max(0.001, layout.length),
      v01: EXTERIOR_SLOT_V01,
      slotIndex,
    });
  }

  function exteriorSlotId(binding) {
    const snapped = snapBindingToExteriorSlot(binding);
    if (!snapped) return null;
    return [
      snapped.pieceId,
      snapped.side,
      finite(snapped.localStart).toFixed(4),
      finite(snapped.localEnd).toFixed(4),
      snapped.slotIndex,
    ].join('|'); // Piece-local identity survives whole-room movement.
  }

  function clampBindingForWindow(binding, key) {
    return snapBindingToExteriorSlot(binding); // Window dimensions already fit inside a two-tile slot; the slot is the only placement authority.
  }

  function bindingFromPlacement(area, placement, key, previousBinding = null) {
    const point = placementTargetPoint(placement); // Furniture attachment target after U/V/N offsets, in the active area's world units.
    const sourceHeight = area === 'interior' ? INTERIOR_WALL_HEIGHT : EXTERIOR_WALL_HEIGHT; // Same normalized vertical coordinate maps between unequal wall heights.
    const v01 = clamp(finite(point[1]) / sourceHeight, 0, 1); // Vertical fraction is the scale-independent part of the link.
    let candidates = buildBoundaryRuns(); // Current exposed surfaces let first-time placement identify its owning farmhouse wall.
    if (previousBinding?.pieceId && previousBinding?.side) {
      const previousRun = resolveRun(previousBinding); // Existing links stay on their original movable room/surface instead of jumping at corners.
      candidates = previousRun ? [previousRun] : candidates;
    } else {
      candidates = candidates.map(run => Object.assign(run, { piece: pieceById(run.pieceId) })); // First-time candidates need piece dimensions for taper inversion.
    }

    const placementNormal = wallApi()?.wallBasis?.(placement?.wallNormal)?.normal || [0, 0, 1]; // Click-facing normal is a soft side-selection hint.
    let best = null; // Lowest-score wall run becomes the stable normalized surface binding.
    candidates.forEach(runValue => {
      const run = runValue.piece ? runValue : Object.assign({}, runValue, { piece: pieceById(runValue.pieceId) }); // Normalizes fresh and resolved run shapes.
      if (!run.piece) return;
      const expectedNormal = area === 'interior' ? outwardNormal(run.side).map(value => -value) : outwardNormal(run.side); // Interior clicks face inward; exterior clicks face outward.
      const normalPenalty = 1 - Math.abs(placementNormal[0] * expectedNormal[0] + placementNormal[2] * expectedNormal[2]); // Abs tolerates backface winding while preferring the correct axis.
      let canonicalAlong = 0; // Stable farm-grid coordinate along the untapered exterior wall.
      let planeDistance = Infinity; // Distance from clicked target to the expected wall plane in source-area units.
      if (area === 'interior') {
        const scaledX = finite(point[0]) / INTERIOR_SCALE; // Interior X maps back to farm-grid canonical coordinates.
        const scaledZ = finite(point[2]) / INTERIOR_SCALE; // Interior Z maps back to farm-grid canonical coordinates.
        canonicalAlong = run.side === 'north' || run.side === 'south' ? scaledX : scaledZ;
        const normalCoord = run.side === 'north' || run.side === 'south' ? scaledZ : scaledX; // Canonical coordinate perpendicular to this wall.
        planeDistance = Math.abs(normalCoord - run.fixed);
      } else {
        canonicalAlong = canonicalAlongFromFarmPoint(run, point, v01); // Undo Highland taper before normalizing U.
        const normalCoord = run.side === 'north' || run.side === 'south' ? finite(point[2]) : finite(point[0]); // Actual farm-space coordinate perpendicular to the side.
        planeDistance = Math.abs(normalCoord - expectedFarmFixed(run, v01));
      }
      const overflow = canonicalAlong < run.start ? run.start - canonicalAlong : canonicalAlong > run.end ? canonicalAlong - run.end : 0; // Rejects geometrically nearby perpendicular/corner walls.
      const score = planeDistance * 4 + overflow * 6 + normalPenalty * 0.15; // Plane/segment geometry dominates the normal hint.
      const tolerance = area === 'interior' ? PLANE_TOLERANCE / INTERIOR_SCALE : PLANE_TOLERANCE; // Interior coordinates are twice farm scale before canonical conversion.
      if (planeDistance > tolerance || overflow > 0.45) return;
      if (!best || score < best.score) best = { run, canonicalAlong, score };
    });
    if (!best) return null;

    const localized = localizeRun(best.run) || previousBinding; // Piece-local surface identity survives room movement.
    if (!localized) return null;
    const runLength = Math.max(0.001, best.run.end - best.run.start); // Normalization denominator for along-wall movement.
    return clampBindingForWindow(Object.assign({}, localized, {
      u01: (best.canonicalAlong - best.run.start) / runLength,
      v01,
    }), key);
  }

  function placementForArea(area, binding, key, baseTransform, normalOffset = 0.01) {
    const run = resolveRun(binding); // Current room position turns stable local binding back into world coordinates.
    if (!run) return null;
    const normalized = clampBindingForWindow(binding, key); // Both peers use the exact same fixed exterior slot.
    if (!normalized) return null; // Runs shorter than two tiles intentionally expose no legal window placement.
    const outward = outwardNormal(run.side); // Farm exterior normal is the cardinal outward side.
    let point = null; // Wall contact target in the destination area's world units.
    let normal = outward; // Wall-facing horizontal normal consumed by WallOrnamentPlacement.
    if (area === 'interior') {
      const canonicalAlong = run.start + (run.end - run.start) * normalized.u01; // Same exterior normalized U expressed on the 2x room wall.
      const fixed = run.fixed; // Canonical farm-grid side plane before interior scale.
      point = run.side === 'north' || run.side === 'south'
        ? [canonicalAlong * INTERIOR_SCALE, normalized.v01 * INTERIOR_WALL_HEIGHT, fixed * INTERIOR_SCALE]
        : [fixed * INTERIOR_SCALE, normalized.v01 * INTERIOR_WALL_HEIGHT, canonicalAlong * INTERIOR_SCALE];
      normal = outward.map(value => -value); // A window seen from inside attaches to the inward-facing side of the same physical wall.
    } else point = exteriorSlotSurface(run, normalized)?.center;
    if (!point) return null;
    return {
      version: wallApi()?.version || 1,
      wallPoint: point.map(value => Math.round(finite(value) * 1000) / 1000),
      wallNormal: normal.slice(),
      offsetU: 0,
      offsetV: 0,
      normalOffset: finite(normalOffset, 0.01),
      space: 'wall-surface-uvn',
      baseTransform: clone(baseTransform),
    };
  }

  function exteriorSlotOccupied(binding, excludePrimaryId = null) {
    const wanted = exteriorSlotId(binding);
    if (!wanted) return true;
    return activePairRecords().some(record => {
      if (record.primaryId === excludePrimaryId) return false;
      return exteriorSlotId(record.binding) === wanted;
    });
  }

  function snapExteriorPlayerPlacement(key, rawPlacement, excludePrimaryId = null) {
    if (!isWindowKey(key) || farmDeps?.getCurrentArea?.() !== 'farm' || !rawPlacement) return null;
    const binding = bindingFromPlacement('farm', rawPlacement, key, null);
    if (!binding || exteriorSlotOccupied(binding, excludePrimaryId)) return null;
    return placementForArea('farm', binding, key, rawPlacement.baseTransform || null, rawPlacement.normalOffset);
  }

  function baseTransformForObject(object) {
    return { // Used only if that half is later unmounted/promoted back to ordinary floor furniture.
      position: [finite(object?.mesh?.position?.x), finite(object?.mesh?.position?.y), finite(object?.mesh?.position?.z)],
      rotY: finite(object?.mesh?.rotation?.y) * 180 / Math.PI,
    };
  }

  function ensureWindowSelectionRoot(root) {
    const visualRoot = root?.userData?.daylightWindowVisualRoot || null;
    if (!root?.add || !visualRoot) return null;
    visualRoot.matrixAutoUpdate = true;
    visualRoot.position.set(0, 0, 0);
    visualRoot.quaternion.identity();
    visualRoot.scale.set(1, 1, 1);
    visualRoot.updateMatrix();

    // Recover cleanly from older branch builds that inserted extra scale wrappers.
    const legacyScaleRoot = root.userData?.houseWindowAssemblyScaleRoot;
    const legacyContentRoot = root.userData?.houseWindowAssemblyContentRoot;
    if (legacyScaleRoot || legacyContentRoot) {
      if (visualRoot.parent !== root) root.add(visualRoot);
      if (legacyScaleRoot?.parent === root) root.remove(legacyScaleRoot);
      delete root.userData.houseWindowAssemblyScaleRoot;
      delete root.userData.houseWindowAssemblyContentRoot;
    } else if (visualRoot.parent !== root) root.add(visualRoot);

    const looseChildren = Array.from(root.children || []).filter(child => child !== visualRoot && child !== root.userData.houseWindowApertureRoot);
    looseChildren.forEach(child => visualRoot.add(child)); // Pane/frame/mullions/helpers always stay one visual assembly.
    return visualRoot;
  }

  function applyLinkedWindowVisualScale(object, binding, attachment) {
    const root = object?.mesh;
    const visualRoot = ensureWindowSelectionRoot(root);
    const THREE = window.THREE;
    if (!root || !visualRoot || !THREE?.Matrix4) return false;

    const farmSide = object.area === 'farm';
    const widthScale = farmSide ? exteriorTaperScale(EXTERIOR_SLOT_V01) : 1;
    const heightScale = farmSide ? EXTERIOR_HEIGHT_SCALE : 1;
    const silhouette = windowSilhouette(object.key);
    const pivotX = (finite(silhouette.minX) + finite(silhouette.maxX)) * 0.5;
    const pivotY = (finite(silhouette.minY) + finite(silhouette.maxY)) * 0.5;

    const anchor = Array.isArray(attachment?.anchor) ? attachment.anchor.map(value => finite(value)) : [pivotX, pivotY, 0]; // Same authored contact point used by WallOrnamentPlacement to solve the outer root.
    let shearX = 0, shearZ = 0; // Exterior wall slope expressed in the furniture root's rotated local frame.
    if (farmSide) {
      const surface = exteriorSlotSurface(resolveRun(binding), binding); // Shares the exact slanted wall sampled by placement and the exterior cut.
      if (surface) {
        const yaw = finite(root.rotation?.y); // Converts the physical wall rise into this furniture root's local X/Z axes.
        shearX = surface.slopeX * Math.cos(yaw) - surface.slopeZ * Math.sin(yaw);
        shearZ = surface.slopeX * Math.sin(yaw) + surface.slopeZ * Math.cos(yaw);
      }
    }
    let apertureRoot = root.userData.houseWindowApertureRoot; // Shared placement frame owns both the cut guide and all visible window parts.
    if (!apertureRoot) {
      apertureRoot = new THREE.Group(); // Its origin is the authored wall-contact point rather than the furniture's floor origin.
      apertureRoot.name = 'HouseWindowApertureRoot';
      root.userData.houseWindowApertureRoot = apertureRoot;
      root.add(apertureRoot);
    }
    const apertureMatrix = new THREE.Matrix4().set(widthScale, shearX, 0, anchor[0], 0, heightScale, 0, anchor[1], 0, shearZ, 1, anchor[2], 0, 0, 0, 1); // Maps the opening and its child geometry through the identical wall slope and midpoint taper.
    apertureRoot.matrixAutoUpdate = false;
    apertureRoot.matrix.copy(apertureMatrix);
    apertureRoot.matrixWorldNeedsUpdate = true;
    apertureRoot.add(visualRoot);
    visualRoot.matrixAutoUpdate = true;
    visualRoot.position.set(-anchor[0], -anchor[1], -anchor[2]); // Restores each authored part's coordinates relative to the new aperture origin.
    visualRoot.quaternion.identity();
    visualRoot.scale.set(1, 1, 1);
    visualRoot.updateMatrix();
    let openingGuide = apertureRoot.userData.openingGuide; // Preview geometry is reused across pair resyncs and cannot intercept placement raycasts.
    if (!openingGuide) {
      const bottomWidth = silhouette.width * exteriorTaperScale(EXTERIOR_SLOT_V01 - silhouette.height / (2 * EXTERIOR_WALL_HEIGHT)) / widthScale; // The generated wall tapers each cut edge independently of the midpoint width.
      const topWidth = silhouette.width * exteriorTaperScale(EXTERIOR_SLOT_V01 + silhouette.height / (2 * EXTERIOR_WALL_HEIGHT)) / widthScale; // Widths are aperture-local before the common root's midpoint scale.
      const bottomLeft = new THREE.Vector3(-bottomWidth / 2, -silhouette.height / 2, 0);
      const bottomRight = new THREE.Vector3(bottomWidth / 2, -silhouette.height / 2, 0);
      const topLeft = new THREE.Vector3(-topWidth / 2, silhouette.height / 2, 0);
      const topRight = new THREE.Vector3(topWidth / 2, silhouette.height / 2, 0);
      const outlineGeometry = new THREE.BufferGeometry().setFromPoints([bottomLeft, bottomRight, bottomRight, topRight, topRight, topLeft, topLeft, bottomLeft]); // Exactly traces the four cut edges on the Highland frustum.
      openingGuide = new THREE.LineSegments(outlineGeometry, new THREE.LineBasicMaterial({ color: 0x30f5d0, depthTest: false }));
      openingGuide.name = 'HouseWindowHoleMarker';
      openingGuide.position.z = 0.06;
      openingGuide.renderOrder = 100;
      openingGuide.raycast = () => {};
      apertureRoot.add(openingGuide);
      apertureRoot.userData.openingGuide = openingGuide;
    }
    openingGuide.visible = farmSide && new URLSearchParams(window.location.search).has('windowApertureGuides'); // Mobile inspection uses a URL flag rather than developer tools.
    root.userData.houseWindowAperture = { anchor: anchor.slice(), width: silhouette.width * widthScale, height: silhouette.height * heightScale, slopeX: shearX, slopeZ: shearZ }; // Included in mobile-visible window diagnostics.

    root.userData.houseWindowExteriorWidthScale = widthScale;
    root.userData.houseWindowExteriorHeightScale = heightScale;
    root.userData.houseWindowExteriorTransformModel = farmSide ? 'fixed-exterior-slot' : 'derived-interior-copy';
    root.userData.houseWindowExteriorVerticalShift = 0;
    root.userData.houseWindowExteriorNormalShift = 0;
    return true;
  }

  function findObject(id) {
    return farmDeps?.interiorFurnitureObjects?.find?.(object => object?.id === id) || null; // Shared farm/interior decor array is the pair's live object registry.
  }

  function sceneForArea(area) {
    return area === 'interior' ? farmDeps?.getInteriorScene?.() : farmDeps?.getScene?.(); // Synthetic peer is created in the same scene ordinary furniture would use.
  }

  function isObjectMeshSceneAttached(object) {
    const scene = sceneForArea(object?.area); // A rebuild may leave the registry record alive after its actual mesh has been detached from the rebuilt scene.
    if (!scene || !object?.mesh) return false;
    let node = object.mesh;
    while (node) {
      if (node === scene) return true;
      node = node.parent || null;
    }
    return false;
  }

  function disposeSyntheticObject(object) {
    if (!object) return;
    const scene = sceneForArea(object.area); // Removes visible root/light from the scene that owns this peer.
    scene?.remove?.(object.mesh);
    object.mesh?.traverse?.(child => {
      child.geometry?.dispose?.(); // Mirrors ordinary decorative-furniture disposal for generated geometry.
      if (Array.isArray(child.material)) child.material.forEach(material => material?.dispose?.());
      else child.material?.dispose?.();
    });
    if (object.light) scene?.remove?.(object.light);
    window.Music?.unregisterFurnitureSfxSource?.(object.sfxSource);
    const index = farmDeps?.interiorFurnitureObjects?.indexOf?.(object) ?? -1; // Removes the synthetic registry record without refunding inventory.
    if (index >= 0) farmDeps.interiorFurnitureObjects.splice(index, 1);
  }

  function createSyntheticPeer(primaryObject, peerId, area, placement) {
    const point = placement?.wallPoint || [0, 0, 0]; // Initial tile anchor only seeds ordinary furniture construction before the wall transform is applied.
    const col = Math.floor(finite(point[0])); // Synthetic record tile X is retained for collision/debug and possible promotion on unmount.
    const row = Math.floor(finite(point[2])); // Synthetic record tile Z is retained for collision/debug and possible promotion on unmount.
    const result = farmDeps?.makeDecorativeFurnitureMesh?.(col, row, primaryObject.key, sceneForArea(area), area, 0); // Reuses normal authored/procedural furniture rendering and daylight registration.
    if (!result?.mesh) return null;
    const owner = area === 'interior' ? (farmDeps?.furnitureOwnerFields?.(col, row) || {}) : {}; // Keeps interior ownership metadata coherent if this peer is promoted later.
    const peer = {
      id: peerId,
      key: primaryObject.key,
      col,
      row,
      mesh: result.mesh,
      light: result.light,
      sfxSource: result.sfxSource,
      area,
      rotYDeg: 0,
      ...owner,
      derivedLinkedWindow: true,
      linkedWindowPrimaryId: primaryObject.id,
    }; // Synthetic marker is consumed by FarmEditor.saveFarmLayout so this half never serializes as a second owned item.
    result.mesh.userData.houseWindowDerived = true;
    farmDeps.interiorFurnitureObjects.push(peer);
    return peer;
  }

  function pairMetadata(primaryId, peerId, role, binding) {
    return { version: VERSION, primaryId, peerId, role, binding: clone(binding) }; // Stored on each wall placement so either visible half can become the editor/source.
  }

  async function synchronizePair(id, placement, object, options = {}) {
    if (!farmDeps || !isWindowObject(object) || !placement || object.derivedLinkedWindow) return false;
    if (object.area !== 'farm') return false; // Legacy inside-authored primaries remain untouched; all new/editable windows are exterior-only.

    const existingLink = placement.houseWindowLink || null;
    const primaryId = existingLink?.primaryId || object.id;
    if (!primaryId || primaryId !== object.id) return false;
    const peerId = existingLink?.peerId || `${primaryId}${PEER_SUFFIX}`;
    const previousBinding = existingLink?.binding || null;
    const rawBinding = options.useExistingBinding && previousBinding
      ? previousBinding
      : bindingFromPlacement('farm', placement, object.key, null);
    const normalizedBinding = clampBindingForWindow(rawBinding, object.key);
    if (!normalizedBinding || exteriorSlotOccupied(normalizedBinding, primaryId)) return false;

    const sourcePlacement = placementForArea('farm', normalizedBinding, object.key, placement.baseTransform || baseTransformForObject(object), placement.normalOffset);
    if (!sourcePlacement) return false;
    sourcePlacement.houseWindowLink = pairMetadata(primaryId, peerId, 'primary', normalizedBinding);
    await wallApi()?.setPlayerPlacement?.(primaryId, sourcePlacement, { notify: false, apply: true });
    applyLinkedWindowVisualScale(object, normalizedBinding, await wallApi()?.loadAttachment?.(object.key));

    let peerObject = findObject(peerId);
    if (peerObject?.derivedLinkedWindow && !isObjectMeshSceneAttached(peerObject)) {
      disposeSyntheticObject(peerObject);
      peerObject = null;
    }
    if (!peerObject) {
      const provisional = placementForArea('interior', normalizedBinding, object.key, null, placement.normalOffset);
      if (!provisional) return false;
      peerObject = createSyntheticPeer(object, peerId, 'interior', provisional);
    }
    if (!peerObject || peerObject.id !== peerId) return false;

    const peerStored = wallApi()?.getPlayerPlacement?.(peerId);
    const peerPlacement = placementForArea('interior', normalizedBinding, peerObject.key, peerStored?.baseTransform || baseTransformForObject(peerObject), peerStored?.normalOffset ?? placement.normalOffset);
    if (!peerPlacement) return false;
    peerPlacement.houseWindowLink = pairMetadata(primaryId, peerId, 'derived', normalizedBinding);
    await wallApi()?.setPlayerPlacement?.(peerId, peerPlacement, { notify: false, apply: true });
    applyLinkedWindowVisualScale(peerObject, normalizedBinding, await wallApi()?.loadAttachment?.(peerObject.key));

    pairState.set(primaryId, { primaryId, peerId, key: object.key, binding: clone(normalizedBinding) });
    if (!options.skipGeometryRebuild) scheduleGeometryRebuild();
    if (!options.skipSave) window.FarmEditor?.saveFarmLayout?.();
    window.FurniturePlacer?.render?.();
    return true;
  }

  function scheduleGeometryRebuild() {
    if (rebuildTimer || typeof window.setTimeout !== 'function') return;
    rebuildTimer = window.setTimeout(() => {
      rebuildTimer = null;
      try { window.HousePieces?.rebuildStructureMeshes?.(); } catch (error) { lastError = `exterior window rebuild: ${error?.message || error}`; }
      try { farmDeps?.rebuildInteriorGeometry?.(); } catch (error) { lastError = `interior window rebuild: ${error?.message || error}`; }
    }, 0); // Explicit wall saves can fire twice (drag-end + Done); one rebuild handles both without any per-frame cost.
  }

  function scheduleRestorePairs(options = {}) {
    if (options.rebuildAfter !== false) restoreRebuildAfter = true; // Coalesced load/init requests may need openings rebuilt; a post-rebuild repair explicitly opts out.
    if (restoreTimer || typeof window.setTimeout !== 'function') return;
    restoreTimer = window.setTimeout(() => {
      restoreTimer = null;
      const rebuildAfter = restoreRebuildAfter;
      restoreRebuildAfter = false;
      restorePairs({ rebuildAfter }).catch(error => { lastError = `window pair restore: ${error?.message || error}`; });
    }, 0); // FarmEditor restores ordinary decor/house pieces synchronously; synthetic peers run immediately afterward.
  }

  async function restorePairs(options = {}) {
    if (!farmDeps || !wallApi()?.getAllPlayerPlacements) return;
    const placements = wallApi().getAllPlayerPlacements(); // Modern saves include both halves; older saves may contain only the primary's raw wall placement.
    let restoredAny = false; // Geometry rebuild waits until every surviving/migrated pair has been realigned.
    for (const [id, placement] of Object.entries(placements)) {
      const object = findObject(id);
      if (!isWindowObject(object) || object.derivedLinkedWindow) continue; // Only the one owned primary is an authoritative restore seed.
      const savedLink = placement?.houseWindowLink;
      if (savedLink && savedLink.role === 'primary' && savedLink.primaryId === id) {
        restoredAny = (await synchronizePair(id, placement, object, { useExistingBinding: true, skipGeometryRebuild: true, skipSave: true })) || restoredAny;
        continue;
      }
      if (placement?.wallPoint && placement?.wallNormal) {
        // Compatibility repair for saves captured before async pair metadata
        // finished attaching. The physical mount is enough to infer the
        // farmhouse boundary run and regenerate/persist the missing peer.
        restoredAny = (await synchronizePair(id, placement, object, { useExistingBinding: false, skipGeometryRebuild: true, skipSave: false })) || restoredAny;
      }
    }
    if (options.rebuildAfter !== false && restoredAny) scheduleGeometryRebuild(); // Punch openings only after both physical representations exist.
  }

  function patchInteriorGeometryRebuild(injected) {
    if (!injected || typeof injected.rebuildInteriorGeometry !== 'function' || injected.rebuildInteriorGeometry.__houseWindowLinkageWrapped) return;
    const originalRebuild = injected.rebuildInteriorGeometry; // Explicit event boundary: every interior scene reconstruction gets one peer-validity pass afterward.
    const wrappedRebuild = function houseWindowInteriorGeometryRebuild(...args) {
      const result = originalRebuild.apply(this, args);
      const after = () => scheduleRestorePairs({ rebuildAfter: false }); // Geometry already exists; only recreate/re-attach a stale synthetic mesh.
      if (result?.then) return result.then(value => { after(); return value; }, error => { after(); throw error; });
      after();
      return result;
    };
    wrappedRebuild.__houseWindowLinkageWrapped = true;
    wrappedRebuild.__houseWindowLinkageOriginal = originalRebuild;
    injected.rebuildInteriorGeometry = wrappedRebuild;
  }

  function onHouseGeometryRebuilt() {
    if (realignTimer || typeof window.setTimeout !== 'function') return;
    realignTimer = window.setTimeout(() => {
      realignTimer = null;
      restorePairs({ rebuildAfter: false }).catch(error => { lastError = `window realign after house move: ${error?.message || error}`; });
    }, 0); // House-piece movement changes absolute wall coordinates; piece-local binding repositions both meshes without starting another geometry rebuild.
  }

  function handlePlacementChanged(id, placement, object) {
    if (!isWindowObject(object) || object.derivedLinkedWindow || object.area !== 'farm') return;
    synchronizePair(id, placement, object).catch(error => { lastError = `window sync ${id}: ${error?.message || error}`; });
  }

  function handlePlacementRemoved(id, placement, object) {
    const link = placement?.houseWindowLink;
    if (!link?.primaryId || link.role !== 'primary' || teardownPrimaryIds.has(link.primaryId)) return; // Interior derived copies are never an editable/removable authority.
    teardownPrimaryIds.add(link.primaryId);
    try {
      const peerId = link.peerId || `${link.primaryId}${PEER_SUFFIX}`;
      const peerObject = findObject(peerId);
      if (peerObject) disposeSyntheticObject(peerObject);
      wallApi()?.removePlayerPlacement?.(peerId, { notify: false });
      pairState.delete(link.primaryId);
      window.FarmEditor?.saveFarmLayout?.();
      scheduleGeometryRebuild();
      window.FurniturePlacer?.render?.();
    } catch (error) { lastError = `window unlink ${id}: ${error?.message || error}`; }
    finally { teardownPrimaryIds.delete(link.primaryId); }
  }

  function activePairRecords() {
    const placements = wallApi()?.getAllPlayerPlacements?.() || {}; // Source of truth includes restored pairs even if debug map has not been populated yet.
    const records = [];
    Object.entries(placements).forEach(([id, placement]) => {
      const link = placement?.houseWindowLink; // One output per primary avoids double-cutting the same aperture.
      if (!link || link.role !== 'primary' || link.primaryId !== id || !isWindowKey(findObject(id)?.key || pairState.get(id)?.key)) return;
      records.push({ primaryId: id, key: findObject(id)?.key || pairState.get(id)?.key, binding: clone(link.binding) });
    });
    return records;
  }

  function getInteriorWallOpenings() {
    return activePairRecords().map(record => {
      const run = resolveRun(record.binding); // Current movable-room location maps the saved local wall binding into interior world space.
      if (!run) return null;
      const binding = clampBindingForWindow(record.binding, record.key); // Exterior slot is the sole aperture authority.
      if (!binding) return null;
      const canonicalAlong = run.start + (run.end - run.start) * binding.u01; // Exterior farm coordinate before the 2x interior mapping.
      const fixed = run.fixed; // Exterior side plane before the 2x interior mapping.
      const center = run.side === 'north' || run.side === 'south'
        ? [canonicalAlong * INTERIOR_SCALE, binding.v01 * INTERIOR_WALL_HEIGHT, fixed * INTERIOR_SCALE]
        : [fixed * INTERIOR_SCALE, binding.v01 * INTERIOR_WALL_HEIGHT, canonicalAlong * INTERIOR_SCALE]; // Exact interior wall-plane aperture center.
      const silhouette = windowSilhouette(record.key); // Brick omission follows the full visible frame silhouette.
      return { id: record.primaryId, center, normal: outwardNormal(run.side).map(value => -value), width: silhouette.width, height: silhouette.height };
    }).filter(Boolean);
  }

  function exteriorCutCenterForRender(render, run, binding) {
    if (!render || !run || !binding) return null;
    const renderStart = run.side === 'north' || run.side === 'south' ? finite(render.col) : finite(render.row);
    const renderLength = run.side === 'north' || run.side === 'south' ? Math.max(1, finite(render.w, 1)) : Math.max(1, finite(render.h, 1));
    const renderCenter = renderStart + renderLength * 0.5;
    const slotPoint = exteriorSlotSurface(run, binding)?.center; // Exact physical point used by the mounted exterior frame.
    if (!slotPoint) return null;
    const actualAlong = run.side === 'north' || run.side === 'south' ? finite(slotPoint[0]) : finite(slotPoint[2]);
    const taperScale = exteriorTaperScale(binding.v01);
    const untaperedAlongForRender = renderCenter + (actualAlong - renderCenter) / Math.max(0.01, taperScale); // Invert THIS render rectangle's frustum so its cut lands on the same physical slot center.
    return {
      renderStart,
      renderLength,
      actualAlong,
      untaperedAlongForRender,
      uCenter: (untaperedAlongForRender - renderStart) / renderLength,
      taperScale,
    };
  }

  function getExteriorWindowCuts(render) {
    if (!render) return [];
    const cuts = []; // Normalized HousePieceGen apertures for this one generated render rectangle.
    activePairRecords().forEach(record => {
      const run = resolveRun(record.binding); // Current wall run follows the owning room after layout movement.
      if (!run) return;
      const binding = clampBindingForWindow(record.binding, record.key); // Same fixed slot drives the visible exterior furniture and its cut.
      if (!binding) return;
      const silhouette = exteriorWindowSilhouette(record.key); // Same authored-height exterior frame bounds drive both the visible peer and WallBuilder brick omission.
      const renderFixed = run.side === 'north' ? finite(render.row)
        : run.side === 'south' ? finite(render.row) + Math.max(1, finite(render.h, 1))
        : run.side === 'west' ? finite(render.col)
        : finite(render.col) + Math.max(1, finite(render.w, 1)); // Candidate side plane for this generated mesh.
      if (Math.abs(renderFixed - run.fixed) > 1e-5) return;
      const cutCenter = exteriorCutCenterForRender(render, run, binding); // Converts the frame's physical slot center into this render rectangle's own frustum coordinate system.
      if (!cutCenter) return;
      const halfCanonicalWidth = silhouette.width * 0.5;
      if (cutCenter.untaperedAlongForRender + halfCanonicalWidth < cutCenter.renderStart
          || cutCenter.untaperedAlongForRender - halfCanonicalWidth > cutCenter.renderStart + cutCenter.renderLength) return;
      cuts.push({
        id: record.primaryId,
        side: run.side,
        uCenter: cutCenter.uCenter,
        uWidth: silhouette.width / cutCenter.renderLength, // HousePieceGen tapers this normalized width at height, exactly matching the frame's exteriorTaperScale.
        vCenter: binding.v01,
        vHeight: silhouette.height / EXTERIOR_WALL_HEIGHT,
      });
    });
    return cuts;
  }


  function patchFarmEditor(api) {
    if (!api || api.__houseWindowLinkagePatched || typeof api.init !== 'function') return;
    const originalInit = api.init.bind(api); // Existing WallOrnament/Daylight wrappers remain inside this call chain.
    api.init = function houseWindowFarmInit(injected, ...rest) {
      farmDeps = injected; // Captures shared decor array, scenes, house pieces, and geometry rebuild callback once game.js initializes.
      patchInteriorGeometryRebuild(injected); // Any explicit interior rebuild now validates/recreates its synthetic window peers afterward; no polling is added.
      const result = originalInit(injected, ...rest);
      scheduleRestorePairs();
      return result;
    };
    if (typeof api.applyFarmLayoutObjects === 'function') {
      const originalApplyObjects = api.applyFarmLayoutObjects.bind(api); // Synthetic peers must be regenerated only after the one saved primary object exists.
      api.applyFarmLayoutObjects = function houseWindowApplyFarmLayoutObjects(...args) {
        const result = originalApplyObjects(...args);
        scheduleRestorePairs();
        return result;
      };
    }
    api.__houseWindowLinkagePatched = true;
  }

  function debugSnapshot() {
    const runs = buildBoundaryRuns(); // Mobile debug reports linkable wall geometry without requiring console access.
    return {
      version: VERSION,
      farmReady: !!farmDeps,
      pairCount: activePairRecords().length,
      derivedPeerCount: (farmDeps?.interiorFurnitureObjects || []).filter(object => object?.derivedLinkedWindow).length, // Mobile debug confirms the opposite-side peer exists without exposing the full furniture registry.
      pairs: activePairRecords().map(record => ({ ...record, aperture: findObject(record.primaryId)?.mesh?.userData?.houseWindowAperture || null })),
      interiorOpenings: getInteriorWallOpenings(),
      boundaryRuns: runs.map(run => ({ pieceId: run.pieceId, side: run.side, fixed: run.fixed, start: run.start, end: run.end })),
      lastError,
    };
  }

  window.HouseWindowLinkage = Object.freeze({
    version: VERSION,
    getInteriorWallOpenings,
    getExteriorWindowCuts,
    restorePairs,
    onHouseGeometryRebuilt,
    debugSnapshot,
    isWindowKey,
    snapExteriorPlayerPlacement,
    __test: Object.freeze({ buildBoundaryRuns, windowSilhouette, exteriorWindowSilhouette, exteriorTaperScale, exteriorSlotLayout, snapBindingToExteriorSlot, exteriorSlotId, bindingFromPlacement, resolveRun, farmWallPoint, exteriorSlotSurface, exteriorCutCenterForRender, EXTERIOR_HEIGHT_SCALE, EXTERIOR_SLOT_TILES, EXTERIOR_SLOT_V01, ensureWindowSelectionRoot, isObjectMeshSceneAttached }),
  });
  window.__houseWindowLinkDebug = debugSnapshot;

  wallApi()?.onPlayerPlacementChanged?.(handlePlacementChanged); // Explicit wall saves are the only normal pair-sync trigger.
  wallApi()?.onPlayerPlacementRemoved?.(handlePlacementRemoved); // Unmount/remove tears down or promotes the paired representation safely.
  patchFarmEditor(window.FarmEditor);
})();
