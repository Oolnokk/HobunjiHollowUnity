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

  // Exact port of analyzeShingleTemplate() from house-piece-author
  function _analyzeShingle(sceneObj) {
    var bone = null;
    sceneObj.traverse(function (o) {
      if (!bone && String(o.name || '').toLowerCase() === 'shinglebone') bone = o;
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

  // ── Public API ──────────────────────────────────────────────────────────────
  global.HousePieceGen = { buildGroup: buildGroup, loadShingleGlb: loadShingleGlb, shingleReady: shingleReady };

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
    var axis = (W >= D) ? 'x' : 'z';

    var faces = [];
    _addFrustumBody(faces, bottomRect, eaveRect, y0, yEave);
    _addGableRoof(faces, eaveRect, bottomRect, yEave, baseH, roofH, axis, tile);

    var group = new THREE.Group();
    _buildFaceMeshes(group, faces, opts);

    var roofFaces = faces.filter(function (f) { return f.tag === 'roof'; });
    _addShingles(group, roofFaces, faces, opts);

    // WallBuilder bricks on all body walls (non-roof)
    if (opts.wallBuilder) {
      var panels  = _wallPanels(minC, maxC, minR, maxR, y0, baseH, tile);
      var wbUse   = opts.wbUsePlaceholder !== false;
      var wbExtra = opts.wbOpts || { unitMult: 0.5, rockScale: 1.5,
                                     preScale: [1, 1, 0.6],
                                     brickJitter: { rotYDeg: 8, shiftU: 0.04, shiftV: 0.03 } };
      var wbGroup = opts.wallBuilder.build(panels, Object.assign({ usePlaceholder: wbUse }, wbExtra));
      wbGroup.userData.isWallBricks = true;
      group.add(wbGroup);
    }

    return group;
  }

  // ── Wall panel specs for WallBuilder ────────────────────────────────────────
  function _wallPanels(minC, maxC, minR, maxR, y0, baseH, tile) {
    var W  = (maxC - minC + 1) * tile, D = (maxR - minR + 1) * tile;
    var cx = (minC * tile + (maxC + 1) * tile) / 2;
    var cz = (minR * tile + (maxR + 1) * tile) / 2;
    var x0 = minC * tile, x1 = (maxC + 1) * tile;
    var z0 = minR * tile, z1 = (maxR + 1) * tile;
    return [
      { id: 'n', width: W, height: baseH, position: [cx, y0, z0], rotationDeg: [0, 180, 0] },
      { id: 's', width: W, height: baseH, position: [cx, y0, z1], rotationDeg: [0,   0, 0] },
      { id: 'w', width: D, height: baseH, position: [x0, y0, cz], rotationDeg: [0, -90, 0] },
      { id: 'e', width: D, height: baseH, position: [x1, y0, cz], rotationDeg: [0,  90, 0] },
    ];
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
    var matWall  = opts.matWall  || new THREE.MeshLambertMaterial({ color: 0xd4c4a8, side: THREE.FrontSide });
    var matRoof  = opts.matRoof  || new THREE.MeshLambertMaterial({ color: 0x6b3e26, side: THREE.FrontSide });
    var matFloor = opts.matFloor || new THREE.MeshLambertMaterial({ color: 0xa89878, side: THREE.FrontSide });

    for (var i = 0; i < faces.length; i++) {
      var f   = faces[i];
      var mat = f.tag === 'roof' ? matRoof
              : (f.tag === 'floor' || f.tag === 'ceiling') ? matFloor
              : matWall;
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

        if (cfg.secondLayer) {
          var t2 = _layer2Target(t, cfg);
          var s2 = _makeShingle(t2, cfg, peakCenter) || _makeTube(t2, cfg, matTube);
          faceGroup.add(s2);
        }
      }

      _alignGroup(face, faceGroup, cfg);
      group.add(faceGroup);
    }
  }

})(window);
