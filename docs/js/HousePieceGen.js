// HousePieceGen.js — Exact port of docs/tools/house-piece-author/ for game.js.
// Uses the identical Highland preset config and shingle placement logic.
// Plain script (no ES modules). Exposes: window.HousePieceGen = { buildGroup, loadShingleGlb, shingleReady }
(function (global) {
  'use strict';

  const THREE = global.THREE;

  // ── Highland constants ──────────────────────────────────────────────────────
  const HIGHLAND_BODY_TOP_SCALE = 0.85;

  // Exact Highland preset from house-piece-author generateHighlandBaseFromFootprint()
  const HIGHLAND_ROOF_CFG = {
    tubeRadius:                 0.08,
    tubeSpacing:                0.5,
    overhang:                   1.25,
    wallOriginReach:            true,
    direction:                  'u',
    lift:                       0.04,
    flipX:                      true,
    flipY:                      false,
    flipZ:                      false,
    shingleScaleX:              1.2,
    shingleScaleY:              1.2,
    shingleScaleZ:              2,
    shingleRotX:               -10,
    shingleRotZ:                0,
    peakRotateAway:             true,
    secondLayer:                true,
    secondLayerAcross:          0.25,
    secondLayerLift:            0,
    secondLayerOverhang:        1,
    secondLayerWallOriginReach: false,
    secondLayerShingleScaleX:   1.5,
    secondLayerShingleScaleY:   1.2,
    secondLayerShingleScaleZ:   2,
    secondLayerShingleRotX:     0,
    secondLayerPeakRotateAway:  false,
    secondLayerFlipX:           true,
    secondLayerFlipY:           false,
    secondLayerFlipZ:           false,
    peakRotate:                 true,
    peakRotateStrength:         0.05,
    peakRotateFalloff:          0,
    highlandInterlockOffset:    0.25,
  };

  // ── Shingle GLB singleton ───────────────────────────────────────────────────
  var _tpl = null;      // { scene, bone, boneLength, boneFrameInverse }
  var _tplProm = null;

  function loadShingleGlb(basePath) {
    if (_tpl)     return Promise.resolve(_tpl);
    if (_tplProm) return _tplProm;
    var url = (basePath || 'assets/models/') + 'HighlandLongshingle_boned.glb';
    _tplProm = new Promise(function (resolve, reject) {
      var loader = new THREE.GLTFLoader();
      loader.load(url, function (gltf) {
        _tpl = _analyzeShingle(gltf.scene);
        resolve(_tpl);
      }, undefined, reject);
    });
    return _tplProm;
  }

  function shingleReady() { return !!_tpl; }

  // Recolors the shingle GLB's own baked material in place, replacing its
  // texture with a repo PNG retinted via the same adaptive shade fill used
  // for portrait/creature tinting (getShadeFillCanvas in portrait-utils.js,
  // loaded after this file — called lazily here since script load order puts
  // this file first). _makeShingle's `_tpl.scene.clone(true)` shares material
  // references with the template (THREE's Object3D/Mesh clone does not deep-
  // clone materials), so tinting the template's material once retints every
  // shingle instance — already placed or placed later.
  function tintShingleMaterial(pngPath, fillColor) {
    if (!_tpl) return;
    var mats = new Set();
    _tpl.scene.traverse(function (o) {
      if (!o.isMesh || !o.material) return;
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) { if (m) mats.add(m); });
    });
    if (!mats.size) return;
    new THREE.TextureLoader().load(pngPath, function (tex) {
      var rgb = fillColor && global.parseHexColor && global.parseHexColor(fillColor);
      var finalTex = tex;
      if (rgb) {
        var canvas = global.getShadeFillCanvas(tex.image, pngPath + '|' + fillColor, {
          mode: 'shadeFill', rgb: [rgb.r, rgb.g, rgb.b], options: global.getPortraitTintingConfig(),
        });
        finalTex = new THREE.CanvasTexture(canvas);
      }
      finalTex.wrapS = finalTex.wrapT = THREE.RepeatWrapping;
      finalTex.needsUpdate = true;
      mats.forEach(function (m) { m.map = finalTex; if (m.color) m.color.setHex(0xffffff); m.needsUpdate = true; });
    }, undefined, function () {});
  }

  // Some authored GLBs (e.g. HighlandLongshingle_boned.glb's shell meshes)
  // carry no `uv` attribute at all — fine for their own baked/vertex-colored
  // look, but a material.map assigned later (tintShingleMaterial above) would
  // sample a fixed corner texel for the whole surface instead of actually
  // varying across it. Generates a simple per-vertex UV by projecting each
  // vertex onto whichever world axis its normal points along least
  // (dominant-normal-axis projection), same technique the town-path preview
  // tool used for its material painter. opts.stretch=true fits the whole PNG
  // once across each axis group's own bounding box (the preview's "stretch to
  // bounds" mode) instead of tiling it — opts.tileSize (world/local units per
  // repeat, matching the tileSize convention used by loadHousePieceFaceTexture/
  // loadTerrainTileTexture) is ignored in that case. No-op if the geometry
  // already has a `uv` attribute.
  function _ensureProjectedUv(geometry, opts) {
    opts = opts || {};
    if (geometry.getAttribute('uv')) return;
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    var pos = geometry.getAttribute('position'), normal = geometry.getAttribute('normal');
    if (!pos || !normal) return;
    var stride = Math.max(0.001, Number(opts.tileSize) || 1);
    function axisOf(i) {
      var nx = Math.abs(normal.getX(i)), ny = Math.abs(normal.getY(i)), nz = Math.abs(normal.getZ(i));
      return ny >= nx && ny >= nz ? 'y' : nx >= nz ? 'x' : 'z';
    }
    function rawUv(i, axis) {
      var px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
      if (axis === 'x') return [pz, py];
      if (axis === 'z') return [px, py];
      return [px, pz];
    }
    var uvs = new Float32Array(pos.count * 2);
    if (opts.stretch) {
      var bounds = { x: [Infinity, -Infinity, Infinity, -Infinity], y: [Infinity, -Infinity, Infinity, -Infinity], z: [Infinity, -Infinity, Infinity, -Infinity] };
      var i, axis, uv, b;
      for (i = 0; i < pos.count; i++) {
        axis = axisOf(i); uv = rawUv(i, axis); b = bounds[axis];
        b[0] = Math.min(b[0], uv[0]); b[1] = Math.max(b[1], uv[0]); b[2] = Math.min(b[2], uv[1]); b[3] = Math.max(b[3], uv[1]);
      }
      for (i = 0; i < pos.count; i++) {
        axis = axisOf(i); uv = rawUv(i, axis); b = bounds[axis];
        var du = Math.max(1e-6, b[1] - b[0]), dv = Math.max(1e-6, b[3] - b[2]);
        uvs[i * 2] = (uv[0] - b[0]) / du; uvs[i * 2 + 1] = (uv[1] - b[2]) / dv;
      }
    } else {
      for (var j = 0; j < pos.count; j++) {
        var ax = axisOf(j), rv = rawUv(j, ax);
        uvs[j * 2] = rv[0] / stride; uvs[j * 2 + 1] = rv[1] / stride;
      }
    }
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  }

  // Exact port of analyzeShingleTemplate() from house-piece-author
  function _analyzeShingle(sceneObj) {
    var bone = null;
    sceneObj.traverse(function (o) {
      if (!bone && String(o.name || '').toLowerCase() === 'shinglebone') bone = o;
      if (o.isMesh && o.geometry) _ensureProjectedUv(o.geometry, { stretch: true });
    });
    var boneLength = 1, boneFrameInverse = null;
    if (bone) {
      bone.visible = false;
      sceneObj.updateWorldMatrix(true, true);
      bone.updateWorldMatrix(true, true);
      var pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scale = new THREE.Vector3();
      bone.matrixWorld.decompose(pos, quat, scale);
      boneLength = Math.max(Math.abs(scale.x), 0.001);
      var frame = new THREE.Matrix4().compose(pos, quat, new THREE.Vector3(1, 1, 1));
      boneFrameInverse = frame.clone().invert();
    } else {
      var box = new THREE.Box3().setFromObject(sceneObj);
      var size = box.getSize(new THREE.Vector3());
      boneLength = Math.max(size.x, size.y, size.z, 1);
    }
    return { scene: sceneObj, bone: bone, boneLength: boneLength, boneFrameInverse: boneFrameInverse };
  }

  // ── Door portal cutting + entry tunnel (ported from the reference
  // hobunji_modular_farmhouse_join_demo — its addWallWithEntrances() /
  // generatedEntryTunnelPiece(), adapted to run against a pre-baked piece
  // JSON's already-generated whole-side wall faces instead of generating
  // walls live from a rectangle). A piece authored with no footprint.door
  // (see house-pieces.js's south-biased automatic door placement) has one
  // single full-length 'wall' face per side and nothing to visually open —
  // this splits that one face into solid/portal/solid segments at the
  // resolved door's cell, then a separately-positioned 1x1 "entry tunnel"
  // piece adds the jambs/lintel/roof-cap detail around the opening, exactly
  // like the House Piece Author tool's own entryTunnel extension output.
  // ─────────────────────────────────────────────────────────────────────────

  function _lerp3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

  // Body wall faces are the 4 single_rectangle 'wall' faces (excluding the
  // triangular gableEnd faces) produced by the Highland generator — one per
  // side, corners ordered [bottom(u=0), top(u=0), top(u=1), bottom(u=1)].
  // Classifies each by comparing its bottom-edge midpoint against the whole
  // set's own bounding box (no piece-level bbox/footprint lookup needed).
  function _classifyBodyWalls(faces) {
    var walls = faces.filter(function (f) { return f.tag === 'wall' && !f.gableEnd && f.highlandFrustumWall; });
    var minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    walls.forEach(function (f) {
      [f.v[0], f.v[3]].forEach(function (p) {
        minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
        minZ = Math.min(minZ, p[2]); maxZ = Math.max(maxZ, p[2]);
      });
    });
    var sideOf = new Map();
    walls.forEach(function (f) {
      var cx = (f.v[0][0] + f.v[3][0]) / 2, cz = (f.v[0][2] + f.v[3][2]) / 2;
      var dN = Math.abs(cz - minZ), dS = Math.abs(cz - maxZ), dW = Math.abs(cx - minX), dE = Math.abs(cx - maxX);
      var m = Math.min(dN, dS, dW, dE);
      sideOf.set(f, m === dN ? 'north' : m === dS ? 'south' : m === dW ? 'west' : 'east');
    });
    return { walls: walls, bbox: { minX: minX, maxX: maxX, minZ: minZ, maxZ: maxZ }, sideOf: sideOf };
  }

  // Splits one whole-side wall face into up to 3 faces: solid run before the
  // door cell, a near-full-height portal cut (90% Highland lintel only,
  // matching the House Piece Author tool's own entryPortalCut convention)
  // over the door cell, and solid run after it. idx/len are the door's
  // 0-based cell position and the wall's total cell count along that side
  // (e.g. idx=2,len=5 for a door on the 3rd of 5 columns).
  function _splitWallFaceForPortal(f, side, bbox, idx, len) {
    var lo = idx / len, hi = (idx + 1) / len;
    var varyingIsX = (side === 'north' || side === 'south');
    var v0 = varyingIsX ? f.v[0][0] : f.v[0][2];
    var v3 = varyingIsX ? f.v[3][0] : f.v[3][2];
    var minRef = varyingIsX ? bbox.minX : bbox.minZ;
    var startIsMin = Math.abs(v0 - minRef) < Math.abs(v3 - minRef);
    if (!startIsMin) { var nlo = 1 - hi, nhi = 1 - lo; lo = nlo; hi = nhi; }
    lo = Math.max(0, Math.min(1, lo)); hi = Math.max(0, Math.min(1, hi));
    if (hi <= lo) return null;

    var b0 = f.v[0], t0 = f.v[1], t1 = f.v[2], b1 = f.v[3];
    var bottom = function (u) { return _lerp3(b0, b1, u); };
    var top    = function (u) { return _lerp3(t0, t1, u); };
    var wallH  = Math.max(t0[1], t1[1]) - Math.min(b0[1], b1[1]);
    var atHeight = function (u, y) { return _lerp3(bottom(u), top(u), Math.max(0, Math.min(1, y / wallH))); };
    var portalH = wallH * 0.92; // exact House Editor near-full-height portal

    var segs = [];
    function full(ua, ub) {
      if (ub - ua < 1e-5) return;
      segs.push(Object.assign({}, f, { v: [bottom(ua), top(ua), top(ub), bottom(ub)] }));
    }
    full(0, lo);
    segs.push(Object.assign({}, f, {
      v: [atHeight(lo, portalH), top(lo), top(hi), atHeight(hi, portalH)],
      entryPortalCut: true, entryPortalPart: 'nearFullHeightEntryLintel',
    }));
    full(hi, 1);
    return segs;
  }

  // Core cut: given a flat faces array, splits whichever whole-side wall
  // face matches `side` into solid/portal/solid segments. Returns the SAME
  // array reference unchanged if nothing matched (e.g. no wall face on that
  // side) — callers can cheaply tell "did anything change" via `!==`.
  function _cutFacesForDoor(faces, side, idx, len) {
    var classified = _classifyBodyWalls(faces);
    var out = [], cut = false;
    for (var i = 0; i < faces.length; i++) {
      var f = faces[i];
      if (!cut && classified.sideOf.get(f) === side) {
        var segs = _splitWallFaceForPortal(f, side, classified.bbox, idx, len);
        if (segs) { cut = true; out = out.concat(segs); continue; }
      }
      out.push(f);
    }
    if (!cut) return faces;
    return out.map(function (f, idx2) { return Object.assign({}, f, { id: idx2 + 1 }); });
  }

  // Returns a new piece object (the input is never mutated — a cached piece
  // JSON can be shared across multiple placements that resolve their door to
  // different sides) with the door's own side wall split into a real
  // opening. No-ops (returns `piece` unchanged) if that side has no
  // matching whole-side wall face to cut — e.g. a piece already authored
  // with its own door.
  function cutDoorPortal(piece, side, idx, len) {
    var src = piece && piece.currentPiece ? piece.currentPiece : piece;
    var faces = (src.base && src.base.faces) || [];
    var faces2 = _cutFacesForDoor(faces, side, idx, len);
    if (faces2 === faces) return piece;
    var nextSrc = Object.assign({}, src, { base: Object.assign({}, src.base, { faces: faces2 }) });
    // Preserve the input's own wrapped-vs-unwrapped shape (buildGroupFromPiece
    // accepts either, but a consistent return shape avoids surprises for any
    // other caller that inspects the result directly).
    return (piece && piece.currentPiece) ? Object.assign({}, piece, { currentPiece: nextSrc }) : nextSrc;
  }

  var ENTRY_TUNNEL_H = Math.max(1.05, 1.4 * 0.82); // mirrors the demo's ENTRY_H (BODY_H=1.4)
  var _entryTunnelPieceCache = null;

  // addBoxFacesTo — exact port of the demo's editorBoxFaces(): 6 faces of an
  // axis-aligned box (floor/top/north/east/south/west), used to build the
  // entry tunnel's solid wall runs and doorway jamb/lintel pieces.
  function _entryBoxFaces(faces, rect, y0, y1, tag, extra) {
    var P = function (x, y, z) { return [x, y, z]; };
    function F(v, ex) { faces.push(Object.assign({ id: faces.length + 1, tag: tag, v: v }, extra, ex)); }
    F([P(rect.minX, y0, rect.minZ), P(rect.maxX, y0, rect.minZ), P(rect.maxX, y0, rect.maxZ), P(rect.minX, y0, rect.maxZ)], { extensionFace: 'floor' });
    F([P(rect.minX, y1, rect.maxZ), P(rect.maxX, y1, rect.maxZ), P(rect.maxX, y1, rect.minZ), P(rect.minX, y1, rect.minZ)], { extensionFace: 'top' });
    F([P(rect.minX, y0, rect.minZ), P(rect.minX, y1, rect.minZ), P(rect.maxX, y1, rect.minZ), P(rect.maxX, y0, rect.minZ)], { extensionFace: 'north' });
    F([P(rect.maxX, y0, rect.minZ), P(rect.maxX, y1, rect.minZ), P(rect.maxX, y1, rect.maxZ), P(rect.maxX, y0, rect.maxZ)], { extensionFace: 'east' });
    F([P(rect.maxX, y0, rect.maxZ), P(rect.maxX, y1, rect.maxZ), P(rect.minX, y1, rect.maxZ), P(rect.minX, y0, rect.maxZ)], { extensionFace: 'south' });
    F([P(rect.minX, y0, rect.maxZ), P(rect.minX, y1, rect.maxZ), P(rect.minX, y1, rect.minZ), P(rect.minX, y0, rect.minZ)], { extensionFace: 'west' });
  }
  function _entrySolidWallRun(faces, rect, side, y0, y1, thickness, tag, extra) {
    var tt = Math.max(0.01, thickness), wallRect;
    if (side === 'north') wallRect = { minX: rect.minX, maxX: rect.maxX, minZ: rect.minZ, maxZ: rect.minZ + tt };
    else if (side === 'south') wallRect = { minX: rect.minX, maxX: rect.maxX, minZ: rect.maxZ - tt, maxZ: rect.maxZ };
    else if (side === 'east') wallRect = { minX: rect.maxX - tt, maxX: rect.maxX, minZ: rect.minZ, maxZ: rect.maxZ };
    else wallRect = { minX: rect.minX, maxX: rect.minX + tt, minZ: rect.minZ, maxZ: rect.maxZ };
    _entryBoxFaces(faces, wallRect, y0, y1, tag, Object.assign({ extensionFace: side, solidifiedWall: true, wallThickness: tt }, extra));
  }
  function _entryWallOpeningFrame(faces, rect, side, y0, y1, thickness, tag, extra) {
    var tt = Math.max(0.01, thickness), openH = (y1 - y0) * 0.92, topY = y1, lintelBottom = y0 + openH;
    var openW = (side === 'north' || side === 'south') ? (rect.maxX - rect.minX) * 0.82 : (rect.maxZ - rect.minZ) * 0.82;
    var cx = (rect.minX + rect.maxX) / 2, cz = (rect.minZ + rect.maxZ) / 2;
    function add(r, a, b, part) { _entryBoxFaces(faces, r, a, b, tag, Object.assign({ extensionFace: side, solidifiedWall: true, doorwayFrame: true, doorwayFramePart: part, wallThickness: tt }, extra)); }
    if (side === 'north' || side === 'south') {
      var z0 = side === 'north' ? rect.minZ : rect.maxZ - tt, z1 = side === 'north' ? rect.minZ + tt : rect.maxZ;
      var o0 = cx - openW / 2, o1 = cx + openW / 2;
      if (o0 > rect.minX) add({ minX: rect.minX, maxX: o0, minZ: z0, maxZ: z1 }, y0, topY, 'leftJamb');
      if (o1 < rect.maxX) add({ minX: o1, maxX: rect.maxX, minZ: z0, maxZ: z1 }, y0, topY, 'rightJamb');
      add({ minX: o0, maxX: o1, minZ: z0, maxZ: z1 }, lintelBottom, topY, 'lowLintel');
    } else {
      var x0 = side === 'west' ? rect.minX : rect.maxX - tt, x1 = side === 'west' ? rect.minX + tt : rect.maxX;
      var p0 = cz - openW / 2, p1 = cz + openW / 2;
      if (p0 > rect.minZ) add({ minX: x0, maxX: x1, minZ: rect.minZ, maxZ: p0 }, y0, topY, 'leftJamb');
      if (p1 < rect.maxZ) add({ minX: x0, maxX: x1, minZ: p1, maxZ: rect.maxZ }, y0, topY, 'rightJamb');
      add({ minX: x0, maxX: x1, minZ: p0, maxZ: p1 }, lintelBottom, topY, 'lowLintel');
    }
  }
  function _entryRimCap(faces, rect, side, y, thickness, tag, extra) {
    var tt = Math.max(0.01, thickness), cap;
    if (side === 'north') cap = { minX: rect.minX, maxX: rect.maxX, minZ: rect.minZ, maxZ: rect.minZ + tt };
    else if (side === 'south') cap = { minX: rect.minX, maxX: rect.maxX, minZ: rect.maxZ - tt, maxZ: rect.maxZ };
    else if (side === 'east') cap = { minX: rect.maxX - tt, maxX: rect.maxX, minZ: rect.minZ, maxZ: rect.maxZ };
    else cap = { minX: rect.minX, maxX: rect.minX + tt, minZ: rect.minZ, maxZ: rect.maxZ };
    faces.push(Object.assign({ id: faces.length + 1, tag: tag, extensionFace: 'topRimCap', rimSide: side,
      v: [[cap.minX, y, cap.maxZ], [cap.maxX, y, cap.maxZ], [cap.maxX, y, cap.minZ], [cap.minX, y, cap.minZ]] }, extra));
  }

  // Exact port of the demo's generatedEntryTunnelPiece(): a self-contained
  // 1x1 piece, canonical opening SOUTH (rotationDeg maps it onto whichever
  // side a piece's door actually resolved to — see house-pieces.js). Cached
  // since it's pure/parameterless.
  function buildEntryTunnelPiece() {
    if (_entryTunnelPieceCache) return _entryTunnelPieceCache;
    var faces = [], rect = { minX: 0, maxX: 1, minZ: 0, maxZ: 1 }, tt = 0.13, y0 = 0, y1 = ENTRY_TUNNEL_H;
    faces.push({ id: faces.length + 1, tag: 'entryTunnel', extensionFace: 'floor', v: [[0, 0.006, 0], [1, 0.006, 0], [1, 0.006, 1], [0, 0.006, 1]] });
    faces.push({ id: faces.length + 1, tag: 'entryTunnel', extensionFace: 'ceiling', v: [[0, y1 + 0.008, 1], [1, y1 + 0.008, 1], [1, y1 + 0.008, 0], [0, y1 + 0.008, 0]] });
    _entryWallOpeningFrame(faces, rect, 'south', y0, y1, tt, 'entryTunnel', { exteriorEntryOpening: true });
    _entryRimCap(faces, rect, 'south', y1 + 0.006, tt, 'entryTunnel', { exteriorEntryOpening: true });
    ['north', 'east', 'west'].forEach(function (side) {
      _entrySolidWallRun(faces, rect, side, y0, y1, tt, 'entryTunnel', {});
      _entryRimCap(faces, rect, side, y1 + 0.002, tt, 'entryTunnel', {});
    });
    _entryTunnelPieceCache = {
      schema: 'modular-house-piece-author/entry-tunnel-runtime', id: 'entry_tunnel_runtime', gridSize: 1, tileSize: 1,
      footprint: { cells: [{ x: 0, y: 0 }], connectors: [], extensions: {} },
      base: { height: y1, wallThickness: tt, groundY: 0, faces: faces }, assets: [],
    };
    return _entryTunnelPieceCache;
  }

  // Builds the entry tunnel's mesh group already positioned/rotated for a
  // resolved door — col/row is the piece's OWN edge cell the door opens
  // through (one step in from the world door tile, i.e. building.js's
  // _doorWallTile), not the exterior door tile itself, matching where the
  // wall portal cut above actually lives. side is 'north'|'south'|'east'|'west'.
  var _ENTRY_ROTATION_DEG = { south: 0, west: 90, north: 180, east: 270 };
  function buildEntryTunnelGroup(THREE, col, row, side, opts) {
    opts = opts || {};
    var built = buildGroupFromPiece(THREE, buildEntryTunnelPiece(), col, row, Object.assign({}, opts, {
      rotationDeg: _ENTRY_ROTATION_DEG[side] || 0,
    }));
    built.userData.isEntryTunnel = true;
    return built;
  }

  // ── Public API ──────────────────────────────────────────────────────────────
  global.HousePieceGen = {
    buildGroup: buildGroup, buildGroupFromPiece: buildGroupFromPiece,
    loadShingleGlb: loadShingleGlb, shingleReady: shingleReady, tintShingleMaterial: tintShingleMaterial,
    cutDoorPortal: cutDoorPortal, buildEntryTunnelGroup: buildEntryTunnelGroup,
  };

  /**
   * Build a Highland house group for one rectangular building footprint.
   * @param {object} THREE
   * @param {number} minC  left column inclusive (tile units)
   * @param {number} maxC  right column inclusive
   * @param {number} minR  north row inclusive
   * @param {number} maxR  south row inclusive
   * @param {object} [opts]
   *   tileSize        - world units per tile (default 1)
   *   groundY         - Y floor level (default 0)
   *   wallBuilder     - WallBuilder instance; if set, adds brick geometry on body walls
   *   wbUsePlaceholder- passed to wallBuilder.build as usePlaceholder (default true)
   *   wbOpts          - extra opts forwarded to wallBuilder.build
   *   matWall / matRoof / matFloor / matTube  - override materials
   */
  function buildGroup(THREE, minC, maxC, minR, maxR, opts) {
    opts = opts || {};
    var tile  = opts.tileSize || 1;
    var y0    = opts.groundY  || 0;
    var baseH = 1.4 * tile;
    var roofH = 1.18 * tile;
    var yEave = y0 + baseH;

    var bottomRect = { minX: minC * tile, maxX: (maxC + 1) * tile,
                       minZ: minR * tile, maxZ: (maxR + 1) * tile };
    var eaveRect   = _scaleRect(bottomRect, HIGHLAND_BODY_TOP_SCALE, HIGHLAND_BODY_TOP_SCALE);

    var W    = maxC - minC + 1, D = maxR - minR + 1;
    // axisOverride lets a caller force the ridge direction instead of the
    // natural long-axis default — used by house-pieces.js's roof-axis vote
    // (see _roofAxisDecision), so a cluster's connected gables actively
    // point at each other instead of each piece resolving independently.
    var axis = opts.axisOverride || ((W >= D) ? 'x' : 'z');

    var faces = [];
    _addFrustumBody(faces, bottomRect, eaveRect, y0, yEave);
    _addGableRoof(faces, eaveRect, bottomRect, yEave, baseH, roofH, axis, tile);

    // doorSide/doorIdx/doorLen (see house-pieces.js's south-biased automatic
    // door) cut a real portal into that side's wall instead of leaving a
    // solid one — the walkable door tile would otherwise have nothing
    // visually open where a player can enter.
    var doorCut = false;
    if (opts.doorSide) {
      var cutFaces = _cutFacesForDoor(faces, opts.doorSide, opts.doorIdx, opts.doorLen);
      doorCut = cutFaces !== faces;
      faces = cutFaces;
    }

    var group = new THREE.Group();
    _buildFaceMeshes(group, faces, opts);

    var roofFaces = faces.filter(function (f) { return f.tag === 'roof'; });
    _addShingles(group, roofFaces, faces, opts);

    // WallBuilder bricks on frustum body walls + gable end triangles
    if (opts.wallBuilder) {
      // A door cut split one whole-side panel into several — build bricks
      // per actual face instead of the old fixed one-panel-per-side spec so
      // each segment (including the portal cut) gets its own panel. Plain,
      // uncut pieces (doorCut false — every current buildGroup caller other
      // than a house piece with a door, e.g. barns) keep the exact original
      // whole-side panels, unchanged.
      var bodyPanels = doorCut
        ? faces.filter(function (f) { return f.tag === 'wall' && !f.gableEnd; }).map(_faceToPanel)
        : _wallPanels(minC, maxC, minR, maxR, y0, baseH, tile);
      var gablePanels = _gablePanels(faces);
      var wbUse   = opts.wbUsePlaceholder !== false;
      var wbExtra = opts.wbOpts || { unitMult: 0.4375, rockScale: 1.5,
                                     preScale: [1, 1, 0.6],
                                     brickJitter: { rotYDeg: 8, shiftU: 0.04, shiftV: 0.03 } };

      var wbGroup = opts.wallBuilder.build(bodyPanels, Object.assign({ usePlaceholder: wbUse }, wbExtra));
      wbGroup.userData.isWallBricks = true;
      _markOutlineLayer(wbGroup);
      group.add(wbGroup);

      // Gable triangles are smaller — use denser, smaller bricks so they fill properly.
      var gableExtra = opts.wbGableOpts || Object.assign({}, wbExtra, { unitMult: 0.396, densityMult: 1.5, rockScale: 1.1 });
      var gableGroup = opts.wallBuilder.build(gablePanels, Object.assign({ usePlaceholder: wbUse }, gableExtra));
      gableGroup.userData.isWallBricks = true;
      _markOutlineLayer(gableGroup);
      group.add(gableGroup);
    }

    return group;
  }

  // ── Wall panel specs for WallBuilder ────────────────────────────────────────
  // Panels use the actual frustum face corners so bricks tile on the tapered walls.
  // Corner order [a,b,c,d] chosen so u×v points outward (matches WallBuilder quadBasis convention).
  function _wallPanels(minC, maxC, minR, maxR, y0, baseH, tile) {
    var bMinX = minC * tile, bMaxX = (maxC + 1) * tile;
    var bMinZ = minR * tile, bMaxZ = (maxR + 1) * tile;
    var bRect = { minX: bMinX, maxX: bMaxX, minZ: bMinZ, maxZ: bMaxZ };
    var eRect = _scaleRect(bRect, HIGHLAND_BODY_TOP_SCALE, HIGHLAND_BODY_TOP_SCALE);
    var eMinX = eRect.minX, eMaxX = eRect.maxX, eMinZ = eRect.minZ, eMaxZ = eRect.maxZ;
    var yEave = y0 + baseH;
    var W = bMaxX - bMinX, D = bMaxZ - bMinZ;
    return [
      {
        id: 'n', width: W, height: baseH,
        position: [(bMinX + bMaxX) / 2, y0, bMinZ], rotationDeg: [0, 180, 0],
        corners: [[bMaxX, y0, bMinZ], [bMinX, y0, bMinZ], [eMinX, yEave, eMinZ], [eMaxX, yEave, eMinZ]],
      },
      {
        id: 's', width: W, height: baseH,
        position: [(bMinX + bMaxX) / 2, y0, bMaxZ], rotationDeg: [0, 0, 0],
        corners: [[bMinX, y0, bMaxZ], [bMaxX, y0, bMaxZ], [eMaxX, yEave, eMaxZ], [eMinX, yEave, eMaxZ]],
      },
      {
        id: 'e', width: D, height: baseH,
        position: [bMaxX, y0, (bMinZ + bMaxZ) / 2], rotationDeg: [0, 90, 0],
        corners: [[bMaxX, y0, bMaxZ], [bMaxX, y0, bMinZ], [eMaxX, yEave, eMinZ], [eMaxX, yEave, eMaxZ]],
      },
      {
        id: 'w', width: D, height: baseH,
        position: [bMinX, y0, (bMinZ + bMaxZ) / 2], rotationDeg: [0, -90, 0],
        corners: [[bMinX, y0, bMinZ], [bMinX, y0, bMaxZ], [eMinX, yEave, eMaxZ], [eMinX, yEave, eMinZ]],
      },
    ];
  }

  // Convert gable end faces to WallBuilder panels with outward-normal corner ordering.
  // Automatically selects winding by checking sign of (v[3]-v[0])×(v[1]-v[0]) vs face normal.
  function _gablePanels(faces) {
    var panels = [];
    var gIdx   = 0;
    for (var fi = 0; fi < faces.length; fi++) {
      var face = faces[fi];
      if (!face.gableEnd) continue;
      var v = face.v.map(function (p) { return new THREE.Vector3(p[0], p[1], p[2]); });
      var N     = _faceNormal(face);
      var u0    = v[3].clone().sub(v[0]);
      var vv0   = v[1].clone().sub(v[0]);
      var nTest = u0.clone().cross(vv0);
      var corners;
      if (nTest.dot(N) > 0) {
        corners = [[v[0].x,v[0].y,v[0].z],[v[3].x,v[3].y,v[3].z],[v[2].x,v[2].y,v[2].z],[v[1].x,v[1].y,v[1].z]];
      } else {
        corners = [[v[3].x,v[3].y,v[3].z],[v[0].x,v[0].y,v[0].z],[v[1].x,v[1].y,v[1].z],[v[2].x,v[2].y,v[2].z]];
      }
      var bottomW = v[0].distanceTo(v[3]);
      var ridgeH  = Math.abs(v[1].y - v[0].y);
      panels.push({
        id: 'gable_' + (gIdx++),
        width: bottomW, height: ridgeH,
        position: [0, 0, 0], rotationDeg: [0, 0, 0],
        corners: corners,
      });
    }
    return panels;
  }

  // ── Geometry helpers ────────────────────────────────────────────────────────
  function _finite(x, def) { var n = Number(x); return Number.isFinite(n) ? n : def; }

  function _scaleRect(r, sx, sz) {
    var cx = (r.minX + r.maxX) / 2, cz = (r.minZ + r.maxZ) / 2;
    var hw = (r.maxX - r.minX) * Math.max(0.001, sx) / 2;
    var hd = (r.maxZ - r.minZ) * Math.max(0.001, sz) / 2;
    return { minX: cx - hw, maxX: cx + hw, minZ: cz - hd, maxZ: cz + hd };
  }

  function _corners(r, y) {
    return {
      a: new THREE.Vector3(r.minX, y, r.minZ), b: new THREE.Vector3(r.maxX, y, r.minZ),
      c: new THREE.Vector3(r.maxX, y, r.maxZ), d: new THREE.Vector3(r.minX, y, r.maxZ)
    };
  }

  function _face(faces, v, tag, extra) {
    var f = { v: v.map(function (p) { return [p.x, p.y, p.z]; }), tag: tag };
    if (extra) Object.assign(f, extra);
    faces.push(f);
    return f;
  }

  function _faceNormal(face) {
    var a = new THREE.Vector3().fromArray(face.v[0]);
    var b = new THREE.Vector3().fromArray(face.v[1]);
    var c = new THREE.Vector3().fromArray(face.v[2]);
    return b.clone().sub(a).cross(c.clone().sub(a)).normalize();
  }

  function _faceCenter(face) {
    var c = new THREE.Vector3();
    for (var i = 0; i < face.v.length; i++) c.add(new THREE.Vector3().fromArray(face.v[i]));
    return c.multiplyScalar(1 / face.v.length);
  }

  // ── Body: floor + ceiling + 4 tapered walls ─────────────────────────────────
  function _addFrustumBody(faces, bRect, tRect, y0, y1) {
    var b = _corners(bRect, y0), t = _corners(tRect, y1);
    _face(faces, [b.a, b.b, b.c, b.d], 'floor',   { highlandFrustumBottom: true });
    _face(faces, [t.d, t.c, t.b, t.a], 'ceiling',  { highlandFrustumTop: true });
    _face(faces, [b.a, t.a, t.b, b.b], 'wall',     { highlandFrustumWall: true }); // north
    _face(faces, [b.b, t.b, t.c, b.c], 'wall',     { highlandFrustumWall: true }); // east
    _face(faces, [b.c, t.c, t.d, b.d], 'wall',     { highlandFrustumWall: true }); // south
    _face(faces, [b.d, t.d, t.a, b.a], 'wall',     { highlandFrustumWall: true }); // west
  }

  // ── Roof: ridge cap + 2 slopes + 2 gable walls ──────────────────────────────
  // Exact port of continuousFrustumRidgeRect + addGableRoofSectionFaces
  function _addGableRoof(faces, eaveRect, bottomRect, yEave, baseH, roofH, axis, tile) {
    var es = { w: eaveRect.maxX - eaveRect.minX, d: eaveRect.maxZ - eaveRect.minZ };
    var bs = { w: bottomRect.maxX - bottomRect.minX, d: bottomRect.maxZ - bottomRect.minZ };
    var minRidgeLen = 0.08 * tile;
    var cx = (eaveRect.minX + eaveRect.maxX) / 2;
    var cz = (eaveRect.minZ + eaveRect.maxZ) / 2;

    var longAxis    = axis === 'z' ? 'z' : 'x';
    var longScale   = Math.min(0.995, Math.max(0.15, HIGHLAND_BODY_TOP_SCALE));
    var tgtLong     = longAxis === 'x' ? Math.max(minRidgeLen, es.w * longScale) : Math.max(minRidgeLen, es.d * longScale);
    var longShrink  = longAxis === 'x' ? Math.max(0, (es.w - tgtLong) / 2) : Math.max(0, (es.d - tgtLong) / 2);
    var insetPerH   = longAxis === 'x'
      ? Math.max(0, (bs.w - es.w) / 2) / Math.max(1e-4, baseH)
      : Math.max(0, (bs.d - es.d) / 2) / Math.max(1e-4, baseH);

    var ridgeH = roofH;
    if (insetPerH > 1e-7 && longShrink > 1e-7) ridgeH = Math.max(0.2 * tile, longShrink / insetPerH);
    var yTop = yEave + ridgeH;

    var ridgeRect;
    if (longAxis === 'x') {
      ridgeRect = { minX: cx - tgtLong / 2, maxX: cx + tgtLong / 2, minZ: cz - minRidgeLen / 2, maxZ: cz + minRidgeLen / 2 };
    } else {
      ridgeRect = { minX: cx - minRidgeLen / 2, maxX: cx + minRidgeLen / 2, minZ: cz - tgtLong / 2, maxZ: cz + tgtLong / 2 };
    }

    var base = _corners(eaveRect, yEave), top = _corners(ridgeRect, yTop);
    var edgewardOff = -Math.abs(HIGHLAND_ROOF_CFG.highlandInterlockOffset); // -0.25

    _face(faces, [top.d, top.c, top.b, top.a], 'ceiling', { roofRidgeCap: true }); // ridge cap

    if (axis === 'x') {
      _face(faces, [base.a, top.a, top.b, base.b], 'roof', { roofAcrossOffset: edgewardOff, roofOffsetRole: 'cross_gable_edgeward' }); // north slope
      _face(faces, [base.b, top.b, top.c, base.c], 'wall', { gableEnd: true });  // east gable
      _face(faces, [base.c, top.c, top.d, base.d], 'roof', { roofAcrossOffset: 0, roofOffsetRole: 'cross_gable_reference' }); // south slope
      _face(faces, [base.d, top.d, top.a, base.a], 'wall', { gableEnd: true });  // west gable
    } else {
      _face(faces, [base.a, top.a, top.b, base.b], 'wall', { gableEnd: true });  // north gable
      _face(faces, [base.b, top.b, top.c, base.c], 'roof', { roofAcrossOffset: edgewardOff, roofOffsetRole: 'cross_gable_edgeward' }); // east slope
      _face(faces, [base.c, top.c, top.d, base.d], 'wall', { gableEnd: true });  // south gable
      _face(faces, [base.d, top.d, top.a, base.a], 'roof', { roofAcrossOffset: 0, roofOffsetRole: 'cross_gable_reference' }); // west slope
    }
  }

  // ── Face mesh building ──────────────────────────────────────────────────────
  function _buildFaceMeshes(group, faces, opts) {
    var matRoof  = opts.matRoof  || new THREE.MeshLambertMaterial({ color: 0x6b3e26, side: THREE.FrontSide });
    var matFloor = opts.matFloor || new THREE.MeshLambertMaterial({ color: 0xa89878, side: THREE.FrontSide });
    var hideWalls = !!opts.wallBuilder;

    for (var i = 0; i < faces.length; i++) {
      var f   = faces[i];
      // Wall faces are covered by WallBuilder bricks — skip the base mesh planes.
      if (hideWalls && f.tag === 'wall') continue;
      var mat = f.tag === 'roof' ? matRoof : matFloor;
      var geom = new THREE.BufferGeometry();
      var pts  = [f.v[0], f.v[1], f.v[2], f.v[0], f.v[2], f.v[3]].flat();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      geom.computeVertexNormals();
      var mesh = new THREE.Mesh(geom, mat);
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
    }
  }

  // ── Shingle generation — exact port of rebuildRoofPreview() ─────────────────

  // Exact port of roofFaceFrame()
  function _roofFaceFrame(face, cfg) {
    var p0 = new THREE.Vector3().fromArray(face.v[0]), p1 = new THREE.Vector3().fromArray(face.v[1]);
    var p2 = new THREE.Vector3().fromArray(face.v[2]), p3 = new THREE.Vector3().fromArray(face.v[3]);
    var n   = _faceNormal(face);
    var uMidA = p0.clone().lerp(p3, 0.5), uMidB = p1.clone().lerp(p2, 0.5);
    var vMidA = p0.clone().lerp(p1, 0.5), vMidB = p3.clone().lerp(p2, 0.5);
    var uVec  = uMidB.clone().sub(uMidA), vVec = vMidB.clone().sub(vMidA);
    var lengthA = cfg.direction === 'v' ? vMidA : uMidA;
    var lengthB = cfg.direction === 'v' ? vMidB : uMidB;
    var acrossVec = cfg.direction === 'v' ? uVec : vVec;
    var spineOrigin = (lengthA.y >= lengthB.y ? lengthA : lengthB).clone();
    var eaveEnd     = (lengthA.y >= lengthB.y ? lengthB : lengthA).clone();
    var spineToEave = eaveEnd.clone().sub(spineOrigin);
    var baseLength  = Math.max(0.001, spineToEave.length());
    var dir = spineToEave.clone();
    if (dir.lengthSq() < 1e-10) dir = (cfg.direction === 'v' ? vVec : uVec).clone();
    if (dir.lengthSq() < 1e-10) dir = new THREE.Vector3(1, 0, 0);
    dir.normalize();
    var useWallOrigin = !!cfg.wallOriginReach;
    var reachOrigin   = useWallOrigin ? eaveEnd.clone() : spineOrigin.clone();
    var reachDir      = useWallOrigin ? dir.clone().multiplyScalar(-1) : dir.clone();
    var reach         = Math.max(0, _finite(cfg.overhang, 1));
    var length        = Math.max(0.001, baseLength * reach);
    var center        = reachOrigin.clone().add(reachDir.clone().multiplyScalar(length * 0.5));
    var scaleOrigin   = spineOrigin.clone().add(dir.clone().multiplyScalar(baseLength * 0.5));
    var across        = acrossVec.clone();
    var acrossLen     = Math.max(0.001, across.length());
    if (across.lengthSq() < 1e-10) across = new THREE.Vector3(0, 0, 1);
    across.normalize();
    return { center: center, n: n, dir: reachDir, spineToEaveDir: dir,
             across: across, length: length, baseLength: baseLength,
             reach: reach, acrossLen: acrossLen,
             spineOrigin: spineOrigin, eaveEnd: eaveEnd,
             reachOrigin: reachOrigin, scaleOrigin: scaleOrigin };
  }

  // Exact port of roofTargetsForFace()
  function _roofTargetsForFace(face, cfg) {
    var frame = _roofFaceFrame(face, cfg);
    var count = Math.max(1, Math.floor(frame.acrossLen / cfg.tubeSpacing) + 1);
    var step  = count > 1 ? frame.acrossLen / (count - 1) : 0;
    var faceOffset = _finite(face.roofAcrossOffset, 0);
    var targets = [];
    for (var i = 0; i < count; i++) {
      var offset      = (i - (count - 1) / 2) * step + faceOffset;
      var liftedOff   = frame.across.clone().multiplyScalar(offset)
                                    .add(frame.n.clone().multiplyScalar(cfg.lift + cfg.tubeRadius));
      targets.push({
        position:          frame.center.clone().add(liftedOff),
        scaleOrigin:       frame.scaleOrigin.clone().add(liftedOff),
        spineOrigin:       frame.spineOrigin.clone().add(liftedOff),
        eaveEnd:           frame.eaveEnd.clone().add(liftedOff),
        direction:         frame.dir.clone(),
        spineToEaveDirection: frame.spineToEaveDir.clone(),
        reachOrigin:       frame.reachOrigin.clone().add(liftedOff),
        normal:            frame.n.clone(),
        across:            frame.across.clone(),
        length:            frame.length,
        baseLength:        frame.baseLength,
        reach:             frame.reach,
        radius:            cfg.tubeRadius,
        roofAcrossOffset:  faceOffset,
        originMode:        cfg.wallOriginReach ? 'wall_edge_then_eave_center_scale' : 'spine_edge_then_eave_center_scale',
        layer: 1,
      });
    }
    return targets;
  }

  // Exact port of shingleLayerSettings()
  function _layerSettings(target, cfg) {
    var s = target.layer === 2;
    return {
      reach:        s ? Math.max(0, _finite(cfg.secondLayerOverhang, cfg.overhang)) : Math.max(0, _finite(cfg.overhang, 1)),
      scaleX:       s ? Math.max(0.01, _finite(cfg.secondLayerShingleScaleX, cfg.shingleScaleX)) : Math.max(0.01, _finite(cfg.shingleScaleX, 1)),
      scaleY:       s ? Math.max(0.01, _finite(cfg.secondLayerShingleScaleY, cfg.shingleScaleY)) : Math.max(0.01, _finite(cfg.shingleScaleY, 1)),
      scaleZ:       s ? Math.max(0.01, _finite(cfg.secondLayerShingleScaleZ, cfg.shingleScaleZ)) : Math.max(0.01, _finite(cfg.shingleScaleZ, 1)),
      rotX:         s ? _finite(cfg.secondLayerShingleRotX, 0) : _finite(cfg.shingleRotX, 0),
      peakRotateAway: s ? !!cfg.secondLayerPeakRotateAway : !!cfg.peakRotateAway,
      flipX:        s ? !!cfg.secondLayerFlipX : !!cfg.flipX,
      flipY:        s ? !!cfg.secondLayerFlipY : !!cfg.flipY,
      flipZ:        s ? !!cfg.secondLayerFlipZ : !!cfg.flipZ,
      wallOriginReach: s ? !!cfg.secondLayerWallOriginReach : !!cfg.wallOriginReach,
    };
  }

  // Exact port of standardLengthScalePlacement()
  function _scalePlacement(target, cfg) {
    var layer = _layerSettings(target, cfg);
    var sx    = layer.scaleX;
    var origin = (target.scaleOrigin || target.position || new THREE.Vector3()).clone();
    var pos    = (target.position    || origin).clone();
    return {
      sx:            sx,
      origin:        origin,
      scaledPosition: origin.clone().add(pos.clone().sub(origin).multiplyScalar(sx)),
      scaledLength:   Math.max(0.001, _finite(target.length, 1) * sx),
    };
  }

  // Peak-center rotation — exact port of highestPeakFaceCenter + peakCenterRotationRad
  function _highestCeilingCenter(faces) {
    var best = null, bestY = -Infinity;
    for (var i = 0; i < faces.length; i++) {
      if (faces[i].tag !== 'ceiling') continue;
      var c = _faceCenter(faces[i]);
      if (c.y > bestY) { bestY = c.y; best = c; }
    }
    if (!best) {
      for (var j = 0; j < faces.length; j++) {
        var cc = _faceCenter(faces[j]);
        if (cc.y > bestY) { bestY = cc.y; best = cc; }
      }
    }
    return best;
  }

  function _peakRotRad(target, cfg, peakCenter) {
    if (!cfg.peakRotate || !peakCenter) return 0;
    var normal = (target.normal || new THREE.Vector3(0, 1, 0)).clone().normalize();
    var dir    = (target.direction || new THREE.Vector3(1, 0, 0)).clone().normalize();
    var origin = (target.rotationOrigin || target.position || new THREE.Vector3()).clone();
    var toPeak = peakCenter.clone().sub(origin);
    var proj   = toPeak.clone().sub(normal.clone().multiplyScalar(toPeak.dot(normal)));
    if (proj.lengthSq() < 1e-10) return 0;
    proj.normalize();
    var angle = dir.angleTo(proj);
    var cross = dir.clone().cross(proj);
    var sign  = Math.sign(cross.dot(normal)) || 1;
    angle *= sign;
    var weight = Math.min(1, Math.max(0, _finite(cfg.peakRotateStrength, 0.5)));
    var falloff = Math.max(0, _finite(cfg.peakRotateFalloff, 0));
    if (falloff > 0) weight *= Math.max(0, 1 - peakCenter.distanceTo(origin) / falloff);
    return angle * weight;
  }

  // Exact port of targetQuaternionForRoofTarget()
  function _targetQuat(target, cfg, peakCenter) {
    var layer = _layerSettings(target, cfg);
    var x  = (target.direction || new THREE.Vector3(1, 0, 0)).clone().normalize();
    var z  = (target.normal    || new THREE.Vector3(0, 1, 0)).clone().normalize();
    var y  = z.clone().cross(x).normalize();
    if (y.lengthSq() < 1e-8) y = new THREE.Vector3(0, 0, 1).cross(x).normalize();
    z = x.clone().cross(y).normalize();
    var m  = new THREE.Matrix4().makeBasis(x, y, z);
    var q  = new THREE.Quaternion().setFromRotationMatrix(m);
    var ql = new THREE.Quaternion();
    if (layer.flipX) q.multiply(ql.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI));
    if (layer.flipY) q.multiply(ql.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
    if (layer.flipZ) q.multiply(ql.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI));
    var rx = layer.rotX * Math.PI / 180;
    if (Math.abs(rx) > 1e-8) q.multiply(ql.setFromAxisAngle(new THREE.Vector3(1, 0, 0), rx));
    var zSign = layer.flipX ? -1 : 1;
    var rz = _finite(cfg.shingleRotZ, 0) * Math.PI / 180 * zSign;
    if (Math.abs(rz) > 1e-8) q.multiply(ql.setFromAxisAngle(new THREE.Vector3(0, 0, 1), rz));
    var peakRad = -_peakRotRad(target, cfg, peakCenter) * zSign;
    if (layer.peakRotateAway) peakRad *= -1;
    if (Math.abs(peakRad) > 1e-8) q.multiply(ql.setFromAxisAngle(new THREE.Vector3(0, 0, 1), peakRad));
    return q;
  }

  // Exact port of cloneRoofTargetWithLayerOffset()
  function _layer2Target(target, cfg) {
    var across        = (target.across || new THREE.Vector3(0, 0, 1)).clone().normalize();
    var normal        = (target.normal || new THREE.Vector3(0, 1, 0)).clone().normalize();
    var spineToEaveDir = (target.spineToEaveDirection || target.direction || new THREE.Vector3(1, 0, 0)).clone().normalize();
    var layerOff  = across.clone().multiplyScalar(_finite(cfg.secondLayerAcross, 0.25))
                           .add(normal.clone().multiplyScalar(_finite(cfg.secondLayerLift, 0)));
    var spine = (target.spineOrigin || target.position || new THREE.Vector3()).clone().add(layerOff);
    var eave  = target.eaveEnd ? target.eaveEnd.clone().add(layerOff)
                               : spine.clone().add(spineToEaveDir.clone().multiplyScalar(_finite(target.baseLength, target.length || 1)));
    var baseLength   = Math.max(0.001, _finite(target.baseLength, target.length || 1));
    var useWall      = !!cfg.secondLayerWallOriginReach;
    var reachOrigin  = useWall ? eave.clone() : spine.clone();
    var dir          = useWall ? spineToEaveDir.clone().multiplyScalar(-1) : spineToEaveDir.clone();
    var reach        = Math.max(0, _finite(cfg.secondLayerOverhang, cfg.overhang));
    var length       = Math.max(0.001, baseLength * reach);
    var position     = reachOrigin.clone().add(dir.clone().multiplyScalar(length * 0.5));
    var scaleOrigin  = spine.clone().add(spineToEaveDir.clone().multiplyScalar(baseLength * 0.5));
    return Object.assign({}, target, {
      position: position, scaleOrigin: scaleOrigin,
      spineOrigin: spine, eaveEnd: eave, reachOrigin: reachOrigin,
      length: length, reach: reach,
      normal: normal.clone(), across: across.clone(),
      direction: dir.clone(), spineToEaveDirection: spineToEaveDir.clone(),
      layer: 2,
    });
  }

  // Tube preview fallback (before GLB loads)
  function _makeTube(target, cfg, mat) {
    var p = _scalePlacement(target, cfg);
    var geom = new THREE.CylinderGeometry(target.radius, target.radius, p.scaledLength, 14, 1, true);
    var mesh = new THREE.Mesh(geom, mat);
    mesh.position.copy(p.scaledPosition);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), target.direction.clone().normalize());
    mesh.castShadow = true;
    return mesh;
  }

  // GLB shingle instance — exact port of makeShingleInstance()
  function _makeShingle(target, cfg, peakCenter) {
    if (!_tpl) return null;  // caller falls back to tube
    var p       = _scalePlacement(target, cfg);
    var stretch = target.length / Math.max(0.001, _tpl.boneLength);
    var layer   = _layerSettings(target, cfg);
    var tWithOrigin = Object.assign({}, target, { rotationOrigin: p.scaledPosition });
    var q = _targetQuat(tWithOrigin, cfg, peakCenter);

    var wrapper = new THREE.Group();
    var clone   = _tpl.scene.clone(true);
    clone.traverse(function (o) {
      if (String(o.name || '').toLowerCase() === 'shinglebone') o.visible = false;
    });
    wrapper.position.copy(p.scaledPosition);
    wrapper.quaternion.copy(q);
    wrapper.scale.set(stretch * p.sx, layer.scaleY, layer.scaleZ);
    wrapper.castShadow = true;
    if (_tpl.boneFrameInverse) {
      clone.matrix.copy(_tpl.boneFrameInverse);
      clone.matrixAutoUpdate = false;
    }
    wrapper.add(clone);
    return wrapper;
  }

  // Exact port of alignRoofFaceGroupToEavePlaneCenter()
  function _alignGroup(face, group, cfg) {
    if (!group || !group.children.length) return;
    var frame  = _roofFaceFrame(face, cfg);
    var dir    = frame.dir.clone().normalize();
    var across = frame.across.clone().normalize();
    var desired = _faceCenter(face);
    group.updateWorldMatrix(true, true);
    var box = new THREE.Box3().setFromObject(group);
    if (!Number.isFinite(box.min.x)) return;
    var actual = box.getCenter(new THREE.Vector3());
    var dDir    = desired.dot(dir)    - actual.dot(dir);
    var dAcross = desired.dot(across) - actual.dot(across);
    var move    = dir.multiplyScalar(dDir).add(across.multiplyScalar(dAcross));
    if (move.lengthSq() > 1e-12) group.position.add(move);
  }

  // Exact port of rebuildRoofPreview() — adds shingle groups to `group`
  // Enables render layer 1 (the selective black "shell" outline pass used for
  // shrubs/rocks elsewhere in the game) on a mesh or every mesh inside a Group.
  function _markOutlineLayer(obj) {
    if (!obj) return;
    if (obj.isMesh) { obj.layers.enable(1); return; }
    obj.traverse(function (child) { if (child.isMesh) child.layers.enable(1); });
  }

  function _addShingles(group, roofFaces, allFaces, opts) {
    var cfg        = HIGHLAND_ROOF_CFG;
    var peakCenter = _highestCeilingCenter(allFaces);
    var matTube    = opts.matTube || new THREE.MeshLambertMaterial({ color: 0x9c6240, side: THREE.FrontSide });

    for (var fi = 0; fi < roofFaces.length; fi++) {
      var face          = roofFaces[fi];
      var faceGroup     = new THREE.Group();
      var targets       = _roofTargetsForFace(face, cfg);

      for (var ti = 0; ti < targets.length; ti++) {
        var t  = targets[ti];
        var s1 = _makeShingle(t, cfg, peakCenter) || _makeTube(t, cfg, matTube);
        faceGroup.add(s1);
        _markOutlineLayer(s1);

        if (cfg.secondLayer) {
          var t2 = _layer2Target(t, cfg);
          var s2 = _makeShingle(t2, cfg, peakCenter) || _makeTube(t2, cfg, matTube);
          faceGroup.add(s2);
          _markOutlineLayer(s2);
        }
      }

      _alignGroup(face, faceGroup, cfg);
      group.add(faceGroup);
    }
  }

  // ── buildGroupFromPiece ─────────────────────────────────────────────────────
  // Builds a Three.js Group from a house piece JSON exported by the house editor.
  // Reads piece.base.faces directly — same geometry as the house editor's 3D preview,
  // with WallBuilder bricks added on top of wall/gable faces when opts.wallBuilder is set.
  //
  // @param piece     Parsed piece JSON (schema modular-house-piece-author/v*)
  // @param bldgMinC  World grid column of the building's footprint top-left corner
  // @param bldgMinR  World grid row    of the building's footprint top-left corner
  // @param opts      Same options as buildGroup (wallBuilder, wbOpts, wbGableOpts,
  //                  wbUsePlaceholder, matRoof, matFloor, matBoards, matStone, matTube)
  function buildGroupFromPiece(THREE, piece, bldgMinC, bldgMinR, opts) {
    opts = opts || {};
    // Some piece files on disk are saved as the house editor's full export
    // payload ({schema, currentPiece, library}, from "Download JSON"/"Copy
    // full JSON") rather than the single flat piece object ("Copy piece"
    // uses; see exportPiecePayload() in house-piece-author) — piece.base is
    // undefined on the wrapper, so faces silently resolved to [] and the
    // building built as an empty (invisible) group with no error. Unwrap
    // once here so every caller (map editor, cutscene director, the live
    // game's spawnTownBuildings/spawnZoneBuildings) accepts either shape.
    if (piece && piece.currentPiece) piece = piece.currentPiece;
    var faces   = (piece.base && piece.base.faces) ? piece.base.faces : [];
    var pcells  = (piece.footprint && piece.footprint.cells) ? piece.footprint.cells : [];
    var gc      = Math.floor((piece.gridSize || 18) / 2);
    var minCX   = pcells.length ? Math.min.apply(null, pcells.map(function(c) { return c.x; })) : gc;
    var minCZ   = pcells.length ? Math.min.apply(null, pcells.map(function(c) { return c.y; })) : gc;
    var offX    = bldgMinC + (gc - minCX);
    var offZ    = bldgMinR + (gc - minCZ);
    var offY    = opts.elevationY || 0;

    // Optional CW rotation (viewed from above) around piece footprint centre
    var rotDeg  = opts.rotationDeg || 0;
    var rotRad  = -rotDeg * Math.PI / 180;   // negative = CW in XZ plane
    var cosR = 1, sinR = 0, pivX = 0, pivZ = 0, txAdj = 0, tzAdj = 0;
    if (rotDeg) {
      cosR = Math.cos(rotRad); sinR = Math.sin(rotRad);
      var maxCXp = pcells.length ? Math.max.apply(null, pcells.map(function(c){return c.x;})) : gc + 3;
      var maxCZp = pcells.length ? Math.max.apply(null, pcells.map(function(c){return c.y;})) : gc + 3;
      var fw0 = maxCXp - minCX + 1, fd0 = maxCZp - minCZ + 1;
      pivX = bldgMinC + fw0 / 2;
      pivZ = bldgMinR + fd0 / 2;
      // Keep gridX/gridZ = top-left of rotated bounding box
      if (rotDeg === 90 || rotDeg === 270) { txAdj = (fd0 - fw0) / 2; tzAdj = (fw0 - fd0) / 2; }
    }

    var matRoof   = opts.matRoof   || new THREE.MeshLambertMaterial({ color: 0x6b3e26, side: THREE.FrontSide });
    var matFloor  = opts.matFloor  || new THREE.MeshLambertMaterial({ color: 0xa89878, side: THREE.FrontSide });
    var matBoards = opts.matBoards || new THREE.MeshLambertMaterial({ color: 0x8b6914, side: THREE.DoubleSide });
    var matStone  = opts.matStone  || new THREE.MeshLambertMaterial({ color: 0x888888, side: THREE.DoubleSide });
    var matTube   = opts.matTube   || new THREE.MeshLambertMaterial({ color: 0x9c6240, side: THREE.FrontSide });
    // Flat, unshingled/unbricked cloth materials -- e.g. the Researcher's
    // Tent, whose whole body is 'canvas'-tagged Highland roof/gable faces
    // (see docs/config/pieces/researchers-tent.json) with a 'doorOpening'
    // triangle cut into one gable for the dark interior showing through.
    var matCanvas = opts.matCanvas || new THREE.MeshLambertMaterial({ color: 0xcbb489, side: THREE.DoubleSide });
    var matDoorOpening = opts.matDoorOpening || new THREE.MeshBasicMaterial({ color: 0x080808, side: THREE.DoubleSide });

    var BOARD_TAGS = { porch: 1, porchStair: 1, railing: 1, floor: 1 };
    var STONE_TAGS = { chimney: 1 };

    var group       = new THREE.Group();
    var bodyPanels  = [];
    var gablePanels = [];
    var roofFaces   = [];
    var allOff      = [];  // offset copies of all faces — for peak-center detection

    var hideWalls = !!opts.wallBuilder;

    for (var i = 0; i < faces.length; i++) {
      var f   = faces[i];
      var tag = f.tag;

      // Offset vertices to world space, then apply rotation if any
      var vOff = f.v.map(function(p) {
        var wx = p[0] + offX, wz = p[2] + offZ;
        if (rotDeg) {
          var px = wx - pivX, pz = wz - pivZ;
          wx = px * cosR - pz * sinR + pivX + txAdj;
          wz = px * sinR + pz * cosR + pivZ + tzAdj;
        }
        return [wx, p[1] + offY, wz];
      });
      var fOff = { v: vOff, tag: tag, id: f.id,
                   gableEnd: f.gableEnd, highlandFrustumWall: f.highlandFrustumWall,
                   roofAcrossOffset: f.roofAcrossOffset, roofOffsetRole: f.roofOffsetRole,
                   extensionFace: f.extensionFace };
      allOff.push(fOff);

      // Wall and entry-tunnel faces → WallBuilder panels (hidden from base mesh).
      // Entryway walls use the gable brick recipe (smaller/denser) regardless of
      // gableEnd, since they're framing a doorway rather than a full wall face.
      if (hideWalls && (tag === 'wall' || tag === 'entryTunnel')) {
        var panel = _faceToPanel(fOff);
        if (f.gableEnd || tag === 'entryTunnel') gablePanels.push(panel);
        else bodyPanels.push(panel);
        continue;
      }

      // Skip interior-only faces: extension floor undersides, main building ceiling
      if (f.extensionFace === 'floor') continue;
      if (tag === 'ceiling') continue;

      // Collect roof faces for shingle generation
      if (tag === 'roof') roofFaces.push(fOff);

      // Select material
      var mat;
      if (tag === 'roof')          mat = matRoof;
      else if (tag === 'canvas')      mat = matCanvas;
      else if (tag === 'doorOpening') mat = matDoorOpening;
      else if (BOARD_TAGS[tag])    mat = matBoards;
      else if (STONE_TAGS[tag])    mat = matStone;
      else                         mat = matFloor;

      // Build quad mesh
      var pts = [
        vOff[0][0], vOff[0][1], vOff[0][2],
        vOff[1][0], vOff[1][1], vOff[1][2],
        vOff[2][0], vOff[2][1], vOff[2][2],
        vOff[0][0], vOff[0][1], vOff[0][2],
        vOff[2][0], vOff[2][1], vOff[2][2],
        vOff[3][0], vOff[3][1], vOff[3][2],
      ];
      // UVs: quad corners v0..v3 go around the perimeter (v0-v1 and v0-v3 are
      // the two edges out of v0, v2 is diagonally opposite — see the
      // triangulation just above, split 0-1-2 / 0-2-3), so a standard
      // bilinear (0,0)/(1,0)/(1,1)/(0,1) parametrization maps cleanly onto
      // it. Scaled by the material's own world-units-per-tile (see
      // mat.userData.uvTileSize below) instead of a flat 0..1 range so a
      // texture stretches proportional to the face's *actual* size and
      // repeats every uvTileSize world units — a plain 0..1 UV would stretch
      // a whole texture across every face regardless of size (a tiny
      // railing baluster and a wide porch deck would look identical scale),
      // which is what made every textured face look wrong before this.
      var tileSize = (mat.userData && mat.userData.uvTileSize) || 1;
      var v0 = new THREE.Vector3(vOff[0][0], vOff[0][1], vOff[0][2]);
      var v1 = new THREE.Vector3(vOff[1][0], vOff[1][1], vOff[1][2]);
      var v3 = new THREE.Vector3(vOff[3][0], vOff[3][1], vOff[3][2]);
      var uLen = v1.distanceTo(v0) / tileSize;
      var vLen = v3.distanceTo(v0) / tileSize;
      var uvs = [
        0, 0,
        uLen, 0,
        uLen, vLen,
        0, 0,
        uLen, vLen,
        0, vLen,
      ];
      var geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geom.computeVertexNormals();
      var mesh = new THREE.Mesh(geom, mat);
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
    }

    // Shingles on roof faces (same as buildGroup)
    _addShingles(group, roofFaces, allOff, Object.assign({ matTube: matTube }, opts));

    // WallBuilder bricks on body walls and gable triangles
    if (opts.wallBuilder) {
      var wbUse   = opts.wbUsePlaceholder !== false;
      var wbExtra = opts.wbOpts || { unitMult: 0.4375, rockScale: 1.5,
                                     preScale: [1, 1, 0.6],
                                     brickJitter: { rotYDeg: 8, shiftU: 0.04, shiftV: 0.03 } };
      if (bodyPanels.length) {
        var wbGrp = opts.wallBuilder.build(bodyPanels, Object.assign({ usePlaceholder: wbUse }, wbExtra));
        wbGrp.userData.isWallBricks = true;
        _markOutlineLayer(wbGrp);
        group.add(wbGrp);
      }
      if (gablePanels.length) {
        var gblExtra = opts.wbGableOpts || Object.assign({}, wbExtra, { unitMult: 0.396, densityMult: 1.5, rockScale: 1.1 });
        var gblGrp   = opts.wallBuilder.build(gablePanels, Object.assign({ usePlaceholder: wbUse }, gblExtra));
        gblGrp.userData.isWallBricks = true;
        _markOutlineLayer(gblGrp);
        group.add(gblGrp);
      }
    }

    return group;
  }

  // Converts an already-world-space face quad to a WallBuilder panel object.
  // Selects winding so the outward normal faces away from the building.
  function _faceToPanel(face) {
    var v   = face.v.map(function(p) { return new THREE.Vector3(p[0], p[1], p[2]); });
    var N   = _faceNormal({ v: face.v });
    var u0  = v[3].clone().sub(v[0]);
    var vv0 = v[1].clone().sub(v[0]);
    var nTest = u0.clone().cross(vv0);
    var corners;
    if (nTest.dot(N) > 0) {
      corners = [[v[0].x,v[0].y,v[0].z],[v[3].x,v[3].y,v[3].z],[v[2].x,v[2].y,v[2].z],[v[1].x,v[1].y,v[1].z]];
    } else {
      corners = [[v[3].x,v[3].y,v[3].z],[v[0].x,v[0].y,v[0].z],[v[1].x,v[1].y,v[1].z],[v[2].x,v[2].y,v[2].z]];
    }
    var w = v[0].distanceTo(v[3]);
    var h = Math.abs(v[1].y - v[0].y);
    if (h < 0.001) h = v[0].distanceTo(v[1]);
    return { id: String(face.id || 'fp'), width: w, height: h,
             position: [0, 0, 0], rotationDeg: [0, 0, 0], corners: corners };
  }

})(window);
