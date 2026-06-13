// HousePieceGen.js — Highland house piece geometry generator for game.js
// Distills docs/tools/house-piece-author/ into a plain (non-module) script.
// Exposes window.HousePieceGen.buildGroup(THREE, minC, maxC, minR, maxR, opts) → THREE.Group
(function (global) {
  'use strict';

  const HIGHLAND_BODY_TOP_SCALE = 0.85;

  // ── Public API ─────────────────────────────────────────────────────────────

  global.HousePieceGen = { buildGroup };

  /**
   * Build a highland-style house group for one rectangular building.
   * @param {THREE} THREE
   * @param {number} minC  left-most column (inclusive) in tile coords
   * @param {number} maxC  right-most column (inclusive)
   * @param {number} minR  north-most row (inclusive)
   * @param {number} maxR  south-most row (inclusive)
   * @param {object} [opts]
   *   tileSize  - world units per tile (default 1)
   *   groundY   - Y of the ground plane (default 0)
   *   doorSide  - 'south'|'north'|'east'|'west'|null (currently unused visually)
   *   matWall   - override THREE.Material for body walls
   *   matRoof   - override THREE.Material for roof slopes + gable ends
   *   matFloor  - override THREE.Material for floor/ceiling
   *   matTube   - override THREE.Material for shingle tubes
   * @returns {THREE.Group}
   */
  function buildGroup(THREE, minC, maxC, minR, maxR, opts) {
    opts = opts || {};
    const tile      = opts.tileSize || 1;
    const y0        = opts.groundY  || 0;
    const baseH     = 1.4 * tile;
    const roofH     = 1.18 * tile;
    const yEave     = y0 + baseH;

    // World-space footprint rect (bottom of building)
    const bottomRect = { minX: minC * tile, maxX: (maxC + 1) * tile,
                         minZ: minR * tile, maxZ: (maxR + 1) * tile };

    // Eave rect = top of frustum body (inset 7.5% on each exposed side)
    const eaveRect = _scaleRect(bottomRect, HIGHLAND_BODY_TOP_SCALE, HIGHLAND_BODY_TOP_SCALE);

    // Ridge axis: ridge runs along the longer plan dimension
    const W = maxC - minC + 1, D = maxR - minR + 1;
    const axis = (W >= D) ? 'x' : 'z';

    // Collect face quads: { v: [[x,y,z]×4], tag: 'wall'|'roof'|'floor'|'ceiling' }
    const faces = [];
    _addFrustumBody(faces, THREE, bottomRect, eaveRect, y0, yEave);
    _addGableRoof(faces, THREE, eaveRect, bottomRect, yEave, baseH, roofH, axis, tile);

    // Build group
    const group = new THREE.Group();
    _buildFaceMeshes(group, THREE, faces, opts);
    _addShingleTubes(group, THREE, faces.filter(f => f.tag === 'roof'), opts);

    return group;
  }

  // ── Geometry helpers ────────────────────────────────────────────────────────

  function _scaleRect(r, sx, sz) {
    const cx = (r.minX + r.maxX) / 2, cz = (r.minZ + r.maxZ) / 2;
    const hw = (r.maxX - r.minX) * Math.max(0.001, sx) / 2;
    const hd = (r.maxZ - r.minZ) * Math.max(0.001, sz) / 2;
    return { minX: cx - hw, maxX: cx + hw, minZ: cz - hd, maxZ: cz + hd };
  }

  function _corners(THREE, r, y) {
    return {
      a: new THREE.Vector3(r.minX, y, r.minZ),
      b: new THREE.Vector3(r.maxX, y, r.minZ),
      c: new THREE.Vector3(r.maxX, y, r.maxZ),
      d: new THREE.Vector3(r.minX, y, r.maxZ)
    };
  }

  function _face(faces, v, tag) {
    faces.push({ v: v.map(p => [p.x, p.y, p.z]), tag });
  }

  // Frustum body: floor + ceiling + 4 tapered side walls.
  function _addFrustumBody(faces, THREE, bRect, tRect, y0, y1) {
    const b = _corners(THREE, bRect, y0);
    const t = _corners(THREE, tRect, y1);
    _face(faces, [b.a, b.b, b.c, b.d], 'floor');
    _face(faces, [t.d, t.c, t.b, t.a], 'ceiling');
    _face(faces, [b.a, t.a, t.b, b.b], 'wall');  // north
    _face(faces, [b.b, t.b, t.c, b.c], 'wall');  // east
    _face(faces, [b.c, t.c, t.d, b.d], 'wall');  // south
    _face(faces, [b.d, t.d, t.a, b.a], 'wall');  // west
  }

  // Gable roof: ridge cap + 2 slopes + 2 gable walls.
  // Implements continuousFrustumRidgeRect + addGableRoofSectionFaces from house-piece-author.
  function _addGableRoof(faces, THREE, eaveRect, bottomRect, yEave, baseH, roofH, axis, tile) {
    const es = { w: eaveRect.maxX - eaveRect.minX, d: eaveRect.maxZ - eaveRect.minZ };
    const bs = { w: bottomRect.maxX - bottomRect.minX, d: bottomRect.maxZ - bottomRect.minZ };
    const minRidge = 0.08 * tile;
    const cx = (eaveRect.minX + eaveRect.maxX) / 2;
    const cz = (eaveRect.minZ + eaveRect.maxZ) / 2;

    // Compute ridge rect following continuousFrustumRidgeRect
    const longAxis    = axis === 'z' ? 'z' : 'x';
    const longScale   = Math.min(0.995, Math.max(0.15, HIGHLAND_BODY_TOP_SCALE));
    const tgtLongLen  = longAxis === 'x' ? Math.max(minRidge, es.w * longScale)
                                         : Math.max(minRidge, es.d * longScale);
    const longShrink  = longAxis === 'x' ? Math.max(0, (es.w - tgtLongLen) / 2)
                                         : Math.max(0, (es.d - tgtLongLen) / 2);
    const insetPerH   = longAxis === 'x' ? Math.max(0, (bs.w - es.w) / 2) / Math.max(1e-4, baseH)
                                         : Math.max(0, (bs.d - es.d) / 2) / Math.max(1e-4, baseH);
    let ridgeH = roofH;
    if (insetPerH > 1e-7 && longShrink > 1e-7) {
      ridgeH = Math.max(0.2 * tile, longShrink / insetPerH);
    }
    const yTop = yEave + ridgeH;

    let ridgeRect;
    if (longAxis === 'x') {
      ridgeRect = { minX: cx - tgtLongLen / 2, maxX: cx + tgtLongLen / 2,
                    minZ: cz - minRidge / 2,   maxZ: cz + minRidge / 2 };
    } else {
      ridgeRect = { minX: cx - minRidge / 2,   maxX: cx + minRidge / 2,
                    minZ: cz - tgtLongLen / 2, maxZ: cz + tgtLongLen / 2 };
    }

    const base = _corners(THREE, eaveRect, yEave);
    const top  = _corners(THREE, ridgeRect, yTop);

    // Ridge cap (tiny ceiling face at top)
    _face(faces, [top.d, top.c, top.b, top.a], 'ceiling');

    if (axis === 'x') {
      // ridge runs east-west; slopes face north/south
      _face(faces, [base.a, top.a, top.b, base.b], 'roof');  // north slope
      _face(faces, [base.b, top.b, top.c, base.c], 'wall');  // east gable end
      _face(faces, [base.c, top.c, top.d, base.d], 'roof');  // south slope
      _face(faces, [base.d, top.d, top.a, base.a], 'wall');  // west gable end
    } else {
      // ridge runs north-south; slopes face east/west
      _face(faces, [base.a, top.a, top.b, base.b], 'wall');  // north gable end
      _face(faces, [base.b, top.b, top.c, base.c], 'roof');  // east slope
      _face(faces, [base.c, top.c, top.d, base.d], 'wall');  // south gable end
      _face(faces, [base.d, top.d, top.a, base.a], 'roof');  // west slope
    }
  }

  // ── Mesh building ───────────────────────────────────────────────────────────

  function _buildFaceMeshes(group, THREE, faces, opts) {
    const matWall  = opts.matWall  || new THREE.MeshLambertMaterial({ color: 0xd4c4a8, side: THREE.FrontSide });
    const matRoof  = opts.matRoof  || new THREE.MeshLambertMaterial({ color: 0x6b3e26, side: THREE.FrontSide });
    const matFloor = opts.matFloor || new THREE.MeshLambertMaterial({ color: 0xa89878, side: THREE.FrontSide });

    for (const face of faces) {
      let mat;
      if (face.tag === 'roof')                       mat = matRoof;
      else if (face.tag === 'floor' || face.tag === 'ceiling') mat = matFloor;
      else                                            mat = matWall;

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

  // ── Shingle tubes ───────────────────────────────────────────────────────────
  // Implements roofFaceFrame → roofTargetsForFace → makeTubePreview
  // with Highland defaults (tubeRadius=0.08, tubeSpacing=0.7, overhang=1.1,
  // wallOriginReach=true, direction='u', lift=0.04).

  const TUBE_RADIUS   = 0.08;
  const TUBE_SPACING  = 0.7;
  const TUBE_OVERHANG = 1.1;
  const TUBE_LIFT     = 0.04;
  const TUBE_SCALE_X  = 1.15;

  function _faceNormal(THREE, face) {
    const a = new THREE.Vector3(...face.v[0]);
    const b = new THREE.Vector3(...face.v[1]);
    const c = new THREE.Vector3(...face.v[2]);
    return b.clone().sub(a).cross(c.clone().sub(a)).normalize();
  }

  function _addShingleTubes(group, THREE, roofFaces, opts) {
    const mat = opts.matTube || new THREE.MeshLambertMaterial({ color: 0x9c6240, side: THREE.FrontSide });

    for (const face of roofFaces) {
      const p0 = new THREE.Vector3(...face.v[0]);
      const p1 = new THREE.Vector3(...face.v[1]);
      const p2 = new THREE.Vector3(...face.v[2]);
      const p3 = new THREE.Vector3(...face.v[3]);
      const n  = _faceNormal(THREE, face);

      // direction='u': length axis runs between midpoints of (p0,p3) and (p1,p2)
      const uMidA = p0.clone().lerp(p3, 0.5); // one end of length axis
      const uMidB = p1.clone().lerp(p2, 0.5); // other end
      const vMidA = p0.clone().lerp(p1, 0.5);
      const vMidB = p3.clone().lerp(p2, 0.5);
      const acrossVec = vMidB.clone().sub(vMidA);
      const acrossLen = acrossVec.length();
      if (acrossLen < 0.001) continue;
      const across = acrossVec.clone().normalize();

      // Spine = higher edge, eave = lower edge
      const spineOrigin = uMidA.y >= uMidB.y ? uMidA.clone() : uMidB.clone();
      const eaveEnd     = uMidA.y >= uMidB.y ? uMidB.clone() : uMidA.clone();
      const spineToEave = eaveEnd.clone().sub(spineOrigin);
      const baseLength  = Math.max(0.001, spineToEave.length());
      const spineDir    = spineToEave.clone().normalize();

      // wallOriginReach=true: start at eave, reach toward ridge
      const reachDir  = spineDir.clone().multiplyScalar(-1);
      const length    = baseLength * TUBE_OVERHANG;
      const scaleOrigin = spineOrigin.clone().add(spineDir.clone().multiplyScalar(baseLength * 0.5));

      const count  = Math.max(1, Math.floor(acrossLen / TUBE_SPACING) + 1);
      const step   = count > 1 ? acrossLen / (count - 1) : 0;
      const liftN  = n.clone().multiplyScalar(TUBE_LIFT + TUBE_RADIUS);

      for (let i = 0; i < count; i++) {
        const offset     = (i - (count - 1) / 2) * step;
        const acrossOff  = across.clone().multiplyScalar(offset);
        const basePos    = eaveEnd.clone().add(reachDir.clone().multiplyScalar(length * 0.5))
                               .add(acrossOff).add(liftN);
        const sOrigin    = scaleOrigin.clone().add(acrossOff).add(liftN);
        // Standard length scale (scaleX = 1.15): scale around scaleOrigin
        const scaledPos  = sOrigin.clone().add(basePos.clone().sub(sOrigin).multiplyScalar(TUBE_SCALE_X));
        const scaledLen  = Math.max(0.001, length * TUBE_SCALE_X);

        const geom = new THREE.CylinderGeometry(TUBE_RADIUS, TUBE_RADIUS, scaledLen, 8, 1, true);
        const mesh = new THREE.Mesh(geom, mat);
        mesh.position.copy(scaledPos);
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), reachDir.clone().normalize());
        mesh.castShadow = true;
        group.add(mesh);
      }
    }
  }

})(window);
