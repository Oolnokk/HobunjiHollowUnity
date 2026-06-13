// HousePieceGen.js — Highland house piece geometry generator for game.js
// Distills docs/tools/house-piece-author/ into a plain (non-module) script.
// Exposes window.HousePieceGen = { buildGroup, loadShingleGlb, shingleReady }
(function (global) {
  'use strict';

  const THREE = global.THREE;

  const HIGHLAND_BODY_TOP_SCALE = 0.85;

  // Default shingle config (matches house-piece-author Highland preset)
  const CFG = {
    tubeRadius:   0.08,
    tubeSpacing:  0.9,     // wider spacing for game perf (editor uses 0.5)
    overhang:     1.1,
    lift:         0.04,
    scaleX:       1.15,
    rotXDeg:     -10,
    flipX:        true,
  };

  // ── Shingle GLB singleton ───────────────────────────────────────────────────
  let _tpl     = null;   // { scene, boneLength, boneFrameInverse }
  let _tplProm = null;

  function loadShingleGlb(basePath) {
    if (_tpl)     return Promise.resolve(_tpl);
    if (_tplProm) return _tplProm;
    const url = (basePath || 'assets/models/') + 'HighlandLongshingle_boned.glb';
    _tplProm = new Promise(function (resolve, reject) {
      const loader = new THREE.GLTFLoader();
      loader.load(url, function (gltf) {
        _tpl = _analyzeShingle(gltf.scene);
        resolve(_tpl);
      }, undefined, reject);
    });
    return _tplProm;
  }

  function shingleReady() { return !!_tpl; }

  function _analyzeShingle(sceneObj) {
    let bone = null;
    sceneObj.traverse(function (o) { if (!bone && (o.name || '').toLowerCase() === 'shinglebone') bone = o; });
    let boneLength = 1, boneFrameInverse = null;
    if (bone) {
      bone.visible = false;
      sceneObj.updateWorldMatrix(true, true);
      bone.updateWorldMatrix(true, true);
      const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scale = new THREE.Vector3();
      bone.matrixWorld.decompose(pos, quat, scale);
      boneLength = Math.max(Math.abs(scale.x), 0.001);
      const frame = new THREE.Matrix4().compose(pos, quat, new THREE.Vector3(1, 1, 1));
      boneFrameInverse = frame.clone().invert();
    } else {
      const box = new THREE.Box3().setFromObject(sceneObj);
      const size = box.getSize(new THREE.Vector3());
      boneLength = Math.max(size.x, size.y, size.z, 1);
    }
    return { scene: sceneObj, bone, boneLength, boneFrameInverse };
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  global.HousePieceGen = { buildGroup, loadShingleGlb, shingleReady };

  /**
   * Build a highland house group.
   * @param {object} THREE
   * @param {number} minC  left column (inclusive)
   * @param {number} maxC  right column (inclusive)
   * @param {number} minR  north row (inclusive)
   * @param {number} maxR  south row (inclusive)
   * @param {object} [opts]
   *   tileSize        - world units per tile (default 1)
   *   groundY         - Y floor level (default 0)
   *   wallBuilder     - WallBuilder instance; if set, adds brick geometry to walls
   *   wbUsePlaceholder- pass to wallBuilder.build as usePlaceholder (default true)
   *   wbOpts          - extra opts forwarded to wallBuilder.build
   *   matWall / matRoof / matFloor / matTube - override materials
   */
  function buildGroup(THREE, minC, maxC, minR, maxR, opts) {
    opts = opts || {};
    const tile  = opts.tileSize || 1;
    const y0    = opts.groundY  || 0;
    const baseH = 1.4 * tile;
    const roofH = 1.18 * tile;
    const yEave = y0 + baseH;

    const bottomRect = { minX: minC * tile, maxX: (maxC + 1) * tile,
                         minZ: minR * tile, maxZ: (maxR + 1) * tile };
    const eaveRect   = _scaleRect(bottomRect, HIGHLAND_BODY_TOP_SCALE, HIGHLAND_BODY_TOP_SCALE);

    const W    = maxC - minC + 1, D = maxR - minR + 1;
    const axis = (W >= D) ? 'x' : 'z';

    const faces = [];
    _addFrustumBody(faces, THREE, bottomRect, eaveRect, y0, yEave);
    _addGableRoof(faces, THREE, eaveRect, bottomRect, yEave, baseH, roofH, axis, tile);

    const group = new THREE.Group();
    _buildFaceMeshes(group, THREE, faces, opts);

    const roofFaces = faces.filter(function (f) { return f.tag === 'roof'; });
    _addShingles(group, THREE, roofFaces, opts);

    // WallBuilder bricks on all non-roof surfaces
    if (opts.wallBuilder) {
      const panels  = _wallPanels(minC, maxC, minR, maxR, y0, baseH, tile);
      const wbUse   = opts.wbUsePlaceholder !== false;
      const wbExtra = opts.wbOpts || { unitMult: 0.5, rockScale: 1.5,
                                       preScale: [1, 1, 0.6],
                                       brickJitter: { rotYDeg: 8, shiftU: 0.04, shiftV: 0.03 } };
      const wbGroup = opts.wallBuilder.build(panels, Object.assign({ usePlaceholder: wbUse }, wbExtra));
      wbGroup.userData.isWallBricks = true;
      group.add(wbGroup);
    }

    return group;
  }

  // ── Wall panel specs for WallBuilder ────────────────────────────────────────

  function _wallPanels(minC, maxC, minR, maxR, y0, baseH, tile) {
    const W   = (maxC - minC + 1) * tile;
    const D   = (maxR - minR + 1) * tile;
    const cx  = (minC * tile + (maxC + 1) * tile) / 2;
    const cz  = (minR * tile + (maxR + 1) * tile) / 2;
    const x0  = minC * tile, x1 = (maxC + 1) * tile;
    const z0  = minR * tile, z1 = (maxR + 1) * tile;
    return [
      { id: 'n', width: W, height: baseH, position: [cx, y0, z0], rotationDeg: [0, 180, 0] },
      { id: 's', width: W, height: baseH, position: [cx, y0, z1], rotationDeg: [0,   0, 0] },
      { id: 'w', width: D, height: baseH, position: [x0, y0, cz], rotationDeg: [0, -90, 0] },
      { id: 'e', width: D, height: baseH, position: [x1, y0, cz], rotationDeg: [0,  90, 0] },
    ];
  }

  // ── Geometry helpers ────────────────────────────────────────────────────────

  function _scaleRect(r, sx, sz) {
    const cx = (r.minX + r.maxX) / 2, cz = (r.minZ + r.maxZ) / 2;
    const hw = (r.maxX - r.minX) * Math.max(0.001, sx) / 2;
    const hd = (r.maxZ - r.minZ) * Math.max(0.001, sz) / 2;
    return { minX: cx - hw, maxX: cx + hw, minZ: cz - hd, maxZ: cz + hd };
  }

  function _corners(r, y) {
    return {
      a: new THREE.Vector3(r.minX, y, r.minZ), b: new THREE.Vector3(r.maxX, y, r.minZ),
      c: new THREE.Vector3(r.maxX, y, r.maxZ), d: new THREE.Vector3(r.minX, y, r.maxZ)
    };
  }

  function _face(faces, v, tag) {
    faces.push({ v: v.map(function (p) { return [p.x, p.y, p.z]; }), tag: tag });
  }

  // Frustum body: floor + ceiling + 4 tapered walls
  function _addFrustumBody(faces, THREE, bRect, tRect, y0, y1) {
    const b = _corners(bRect, y0), t = _corners(tRect, y1);
    _face(faces, [b.a, b.b, b.c, b.d], 'floor');
    _face(faces, [t.d, t.c, t.b, t.a], 'ceiling');
    _face(faces, [b.a, t.a, t.b, b.b], 'wall');  // north
    _face(faces, [b.b, t.b, t.c, b.c], 'wall');  // east
    _face(faces, [b.c, t.c, t.d, b.d], 'wall');  // south
    _face(faces, [b.d, t.d, t.a, b.a], 'wall');  // west
  }

  // Gable roof: ridge cap + 2 slopes ('roof') + 2 gable ends ('wall')
  function _addGableRoof(faces, THREE, eaveRect, bottomRect, yEave, baseH, roofH, axis, tile) {
    const es = { w: eaveRect.maxX - eaveRect.minX, d: eaveRect.maxZ - eaveRect.minZ };
    const bs = { w: bottomRect.maxX - bottomRect.minX, d: bottomRect.maxZ - bottomRect.minZ };
    const minR  = 0.08 * tile;
    const cx = (eaveRect.minX + eaveRect.maxX) / 2, cz = (eaveRect.minZ + eaveRect.maxZ) / 2;

    // continuousFrustumRidgeRect logic
    const longAxis   = axis === 'z' ? 'z' : 'x';
    const longScale  = Math.min(0.995, Math.max(0.15, HIGHLAND_BODY_TOP_SCALE));
    const tgtLong    = longAxis === 'x' ? Math.max(minR, es.w * longScale) : Math.max(minR, es.d * longScale);
    const longShrink = longAxis === 'x' ? Math.max(0, (es.w - tgtLong) / 2) : Math.max(0, (es.d - tgtLong) / 2);
    const insetPerH  = longAxis === 'x'
      ? Math.max(0, (bs.w - es.w) / 2) / Math.max(1e-4, baseH)
      : Math.max(0, (bs.d - es.d) / 2) / Math.max(1e-4, baseH);

    let ridgeH = roofH;
    if (insetPerH > 1e-7 && longShrink > 1e-7) ridgeH = Math.max(0.2 * tile, longShrink / insetPerH);
    const yTop = yEave + ridgeH;

    let ridgeRect;
    if (longAxis === 'x') {
      ridgeRect = { minX: cx - tgtLong / 2, maxX: cx + tgtLong / 2, minZ: cz - minR / 2, maxZ: cz + minR / 2 };
    } else {
      ridgeRect = { minX: cx - minR / 2, maxX: cx + minR / 2, minZ: cz - tgtLong / 2, maxZ: cz + tgtLong / 2 };
    }

    const base = _corners(eaveRect, yEave), top = _corners(ridgeRect, yTop);
    _face(faces, [top.d, top.c, top.b, top.a], 'ceiling');  // ridge cap

    if (axis === 'x') {
      _face(faces, [base.a, top.a, top.b, base.b], 'roof'); // north slope
      _face(faces, [base.b, top.b, top.c, base.c], 'wall'); // east gable
      _face(faces, [base.c, top.c, top.d, base.d], 'roof'); // south slope
      _face(faces, [base.d, top.d, top.a, base.a], 'wall'); // west gable
    } else {
      _face(faces, [base.a, top.a, top.b, base.b], 'wall'); // north gable
      _face(faces, [base.b, top.b, top.c, base.c], 'roof'); // east slope
      _face(faces, [base.c, top.c, top.d, base.d], 'wall'); // south gable
      _face(faces, [base.d, top.d, top.a, base.a], 'roof'); // west slope
    }
  }

  // ── Face mesh building ──────────────────────────────────────────────────────

  function _buildFaceMeshes(group, THREE, faces, opts) {
    const matWall  = opts.matWall  || new THREE.MeshLambertMaterial({ color: 0xd4c4a8, side: THREE.FrontSide });
    const matRoof  = opts.matRoof  || new THREE.MeshLambertMaterial({ color: 0x6b3e26, side: THREE.FrontSide });
    const matFloor = opts.matFloor || new THREE.MeshLambertMaterial({ color: 0xa89878, side: THREE.FrontSide });

    for (var i = 0; i < faces.length; i++) {
      const face = faces[i];
      const mat  = face.tag === 'roof' ? matRoof
                 : (face.tag === 'floor' || face.tag === 'ceiling') ? matFloor
                 : matWall;
      const geom = new THREE.BufferGeometry();
      const pts  = [face.v[0], face.v[1], face.v[2],
                    face.v[0], face.v[2], face.v[3]].flat();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      geom.computeVertexNormals();
      const mesh = new THREE.Mesh(geom, mat);
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
    }
  }

  // ── Shingle generation ──────────────────────────────────────────────────────
  // Implements roofFaceFrame → roofTargetsForFace → makeShingleInstance (or tube fallback)

  function _faceNormal(face) {
    const a = new THREE.Vector3(...face.v[0]);
    const b = new THREE.Vector3(...face.v[1]);
    const c = new THREE.Vector3(...face.v[2]);
    return b.clone().sub(a).cross(c.clone().sub(a)).normalize();
  }

  function _addShingles(group, THREE, roofFaces, opts) {
    const matTube = opts.matTube || new THREE.MeshLambertMaterial({ color: 0x9c6240, side: THREE.FrontSide });

    for (var fi = 0; fi < roofFaces.length; fi++) {
      const face = roofFaces[fi];
      const targets = _roofTargets(face);

      for (var ti = 0; ti < targets.length; ti++) {
        const t = targets[ti];
        if (_tpl) {
          group.add(_makeShingleInstance(t));
        } else {
          group.add(_makeTube(t, matTube));
        }
      }
    }
  }

  // Compute shingle target objects for one roof face (wallOriginReach=true, direction='u')
  function _roofTargets(face) {
    const p0 = new THREE.Vector3(...face.v[0]), p1 = new THREE.Vector3(...face.v[1]);
    const p2 = new THREE.Vector3(...face.v[2]), p3 = new THREE.Vector3(...face.v[3]);
    const n  = _faceNormal(face);

    // direction='u': length axis = (uMidA ↔ uMidB), across = vVec
    const uMidA = p0.clone().lerp(p3, 0.5);  // midpoint of (v0,v3) edge
    const uMidB = p1.clone().lerp(p2, 0.5);  // midpoint of (v1,v2) edge
    const vMidA = p0.clone().lerp(p1, 0.5);
    const vMidB = p3.clone().lerp(p2, 0.5);
    const acrossVec = vMidB.clone().sub(vMidA);
    const acrossLen = acrossVec.length();
    if (acrossLen < 0.001) return [];
    const across = acrossVec.clone().normalize();

    // spine = higher edge, eave = lower edge
    const spineOrigin = uMidA.y >= uMidB.y ? uMidA.clone() : uMidB.clone();
    const eaveEnd     = uMidA.y >= uMidB.y ? uMidB.clone() : uMidA.clone();
    const baseLength  = Math.max(0.001, spineOrigin.distanceTo(eaveEnd));
    const spineDir    = eaveEnd.clone().sub(spineOrigin).normalize();

    // wallOriginReach: start at eave, reach toward ridge
    const reachDir   = spineDir.clone().multiplyScalar(-1);
    const length     = baseLength * CFG.overhang;
    const scaleOrig  = spineOrigin.clone().add(spineDir.clone().multiplyScalar(baseLength * 0.5));
    const liftVec    = n.clone().multiplyScalar(CFG.lift + CFG.tubeRadius);

    const count = Math.max(1, Math.floor(acrossLen / CFG.tubeSpacing) + 1);
    const step  = count > 1 ? acrossLen / (count - 1) : 0;

    const targets = [];
    for (var i = 0; i < count; i++) {
      const offset  = (i - (count - 1) / 2) * step;
      const ao      = across.clone().multiplyScalar(offset);
      const basePos = eaveEnd.clone().add(reachDir.clone().multiplyScalar(length * 0.5)).add(ao).add(liftVec);
      const sOrig   = scaleOrig.clone().add(ao).add(liftVec);
      // Standard length scale: scale around spine/eave center
      const scaledPos = sOrig.clone().add(basePos.clone().sub(sOrig).multiplyScalar(CFG.scaleX));
      const scaledLen = Math.max(0.001, length * CFG.scaleX);
      targets.push({
        position:     scaledPos,
        scaleOrigin:  sOrig,
        spineOrigin:  spineOrigin.clone().add(ao).add(liftVec),
        eaveEnd:      eaveEnd.clone().add(ao).add(liftVec),
        direction:    reachDir.clone(),
        normal:       n.clone(),
        across:       across.clone(),
        length:       scaledLen,
        baseLength:   baseLength,
        radius:       CFG.tubeRadius,
      });
    }
    return targets;
  }

  // Cylinder tube fallback (used before GLB is loaded)
  function _makeTube(t, mat) {
    const geom = new THREE.CylinderGeometry(t.radius, t.radius, t.length, 8, 1, true);
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.copy(t.position);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), t.direction.clone().normalize());
    mesh.castShadow = true;
    return mesh;
  }

  // GLB shingle instance
  function _makeShingleInstance(t) {
    const tpl    = _tpl;
    const clone  = tpl.scene.clone(true);
    clone.traverse(function (o) {
      if ((o.name || '').toLowerCase() === 'shinglebone') o.visible = false;
    });

    const stretch = t.length / Math.max(0.001, tpl.boneLength);
    const q = _shingleQuat(t);

    const wrapper = new THREE.Group();
    wrapper.position.copy(t.position);
    wrapper.quaternion.copy(q);
    wrapper.scale.set(stretch, 1, 1);
    wrapper.castShadow = true;

    if (tpl.boneFrameInverse) {
      clone.matrix.copy(tpl.boneFrameInverse);
      clone.matrixAutoUpdate = false;
    }
    wrapper.add(clone);
    return wrapper;
  }

  // Build shingle quaternion: basis (x=direction, z=normal, y=z×x), flipX, rotX=-10°
  function _shingleQuat(t) {
    const dir = t.direction.clone().normalize();
    let   nrm = t.normal.clone().normalize();
    let   y   = nrm.clone().cross(dir).normalize();
    if (y.lengthSq() < 1e-8) y = new THREE.Vector3(0, 0, 1).cross(dir).normalize();
    const z = dir.clone().cross(y).normalize();
    const m = new THREE.Matrix4().makeBasis(dir, y, z);
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    const ql = new THREE.Quaternion();
    if (CFG.flipX) q.multiply(ql.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI));
    const rx = CFG.rotXDeg * Math.PI / 180;
    if (Math.abs(rx) > 1e-8) q.multiply(ql.setFromAxisAngle(new THREE.Vector3(1, 0, 0), rx));
    return q;
  }

})(window);
