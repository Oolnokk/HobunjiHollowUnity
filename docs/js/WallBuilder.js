// WallBuilder — FBSE6 wall generation logic as a reusable module.
// Extracted from FBSE6_Wall_Generator_Isolated1.html; ported to Three.js r128 global (window.THREE).
// Usage:
//   const wb = new WallBuilder({ glbBasePath: 'assets/models/' });
//   wb.loadDefaultGlb().then(() => {
//     const group = wb.build(panels, opts);
//     scene.add(group);
//   });
(function (root) {
  'use strict';

  const THREE = root.THREE;
  if (!THREE) { console.error('WallBuilder: window.THREE not found — load three.js first'); return; }

  const WALL_DEFAULT_GLB_NAME = 'Roughbrick1.glb';
  const BUILTIN_DEFAULT_RECIPE_ID = 'builtin_default';

  // ── Utilities ─────────────────────────────────────────────────────────────

  function v3(arr) {
    return new THREE.Vector3(Number(arr?.[0] ?? 0), Number(arr?.[1] ?? 0), Number(arr?.[2] ?? 0));
  }
  function degToEuler(a) {
    return new THREE.Euler(
      THREE.MathUtils.degToRad(a[0] || 0),
      THREE.MathUtils.degToRad(a[1] || 0),
      THREE.MathUtils.degToRad(a[2] || 0), 'XYZ'
    );
  }
  function panelMatrix(p) {
    return new THREE.Matrix4().compose(
      v3(p.position),
      new THREE.Quaternion().setFromEuler(degToEuler(p.rotationDeg || [0, 0, 0])),
      new THREE.Vector3(1, 1, 1)
    );
  }
  function panelCorners(p) {
    if (Array.isArray(p.corners) && p.corners.length === 4) {
      return p.corners.map(c => new THREE.Vector3(c[0] || 0, c[1] || 0, c[2] || 0));
    }
    const w = p.width / 2, h = p.height;
    const base = [
      new THREE.Vector3(-w, 0, 0), new THREE.Vector3(w, 0, 0),
      new THREE.Vector3(w, h, 0),  new THREE.Vector3(-w, h, 0)
    ];
    const m = panelMatrix(p);
    return base.map(x => x.applyMatrix4(m));
  }
  function hashStringToUint32(str) {
    let h = 2166136261 >>> 0;
    const s = String(str ?? '');
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  function makeRng(seedLike) {
    let x = (typeof seedLike === 'number' && Number.isFinite(seedLike))
      ? seedLike >>> 0 : hashStringToUint32(seedLike);
    if (x === 0) x = 123456789;
    return {
      next() { x ^= (x << 13) >>> 0; x ^= (x >>> 17) >>> 0; x ^= (x << 5) >>> 0; return (x >>> 0) / 4294967296; },
      range(a, b) { return a + (b - a) * this.next(); }
    };
  }
  function orderedRange(a, b) { return a <= b ? [a, b] : [b, a]; }
  function readMinMax(x, a, b) {
    if (Array.isArray(x)) {
      const n0 = Number(x[0]), n1 = Number(x[1]);
      if (Number.isFinite(n0) && Number.isFinite(n1)) return orderedRange(n0, n1);
    }
    if (x && typeof x === 'object') {
      const n0 = Number(x.min), n1 = Number(x.max);
      if (Number.isFinite(n0) && Number.isFinite(n1)) return orderedRange(n0, n1);
    }
    if (typeof x === 'number' && Number.isFinite(x)) return [x, x];
    return [a, b];
  }
  function applyRandomTRS(rng, random) {
    const r = random?.rotationDeg ?? {}, s = random?.scale ?? {}, t = random?.translate ?? {};
    const rx = readMinMax(r.x, 0, 0), ry = readMinMax(r.y, 0, 0), rz = readMinMax(r.z, 0, 0);
    const sx = readMinMax(s.x, 1, 1), sy = readMinMax(s.y, 1, 1), sz = readMinMax(s.z, 1, 1);
    const tx = readMinMax(t.x, 0, 0), ty = readMinMax(t.y, 0, 0), tz = readMinMax(t.z, 0, 0);
    return {
      r: [THREE.MathUtils.degToRad(rng.range(rx[0], rx[1])), THREE.MathUtils.degToRad(rng.range(ry[0], ry[1])), THREE.MathUtils.degToRad(rng.range(rz[0], rz[1]))],
      s: [rng.range(sx[0], sx[1]), rng.range(sy[0], sy[1]), rng.range(sz[0], sz[1])],
      t: [rng.range(tx[0], tx[1]), rng.range(ty[0], ty[1]), rng.range(tz[0], tz[1])]
    };
  }
  function preTRSToMatrix(translate, rotateDegXYZ, scale) {
    const pos = v3(translate || [0, 0, 0]);
    const quat = new THREE.Quaternion().setFromEuler(degToEuler(rotateDegXYZ || [0, 0, 0]));
    const scl = scale ? v3(scale) : new THREE.Vector3(1, 1, 1);
    return new THREE.Matrix4().compose(pos, quat, scl);
  }
  function computeEffectiveGap(recipe) {
    const s = recipe.settings ?? {};
    if (s.gapEffective && typeof s.gapEffective === 'object')
      return { x: Number(s.gapEffective.x ?? 0), y: Number(s.gapEffective.y ?? 0), z: Number(s.gapEffective.z ?? 0) };
    const base = s.gapBase ?? { x: 0, y: 0, z: 0 }, unit = s.unitSize ?? { x: 1, y: 1, z: 1 }, d = recipe.density ?? {};
    const k = (0.5 - Number(d.value01 ?? 0.5)) * 2 * Number(d.overlapFrac ?? 0);
    return { x: Number(base.x ?? 0) + k * Number(unit.x ?? 1), y: Number(base.y ?? 0) + k * Number(unit.y ?? 1), z: Number(base.z ?? 0) + k * Number(unit.z ?? 1) };
  }
  function resolveRecipeGlbName(recipe) {
    return recipe?.glbName || recipe?.glb || recipe?.settings?.glb || recipe?.model?.uri || recipe?.meta?.glbName || recipe?.meta?.glb || WALL_DEFAULT_GLB_NAME;
  }
  function quadPoint(a, b, c, d, s, t) {
    return a.clone().lerp(b, s).lerp(d.clone().lerp(c, s), t);
  }
  function quadBasis(a, b, c, d, s, t) {
    const u = b.clone().sub(a).multiplyScalar(1 - t).add(c.clone().sub(d).multiplyScalar(t));
    const v = d.clone().sub(a).multiplyScalar(1 - s).add(c.clone().sub(b).multiplyScalar(s));
    if (u.lengthSq() < 1e-10) u.set(1, 0, 0); else u.normalize();
    if (v.lengthSq() < 1e-10) v.set(0, 1, 0); else v.normalize();
    let n = new THREE.Vector3().crossVectors(u, v);
    if (n.lengthSq() < 1e-10) n.set(0, 0, 1); else n.normalize();
    return { u, v, n };
  }

  // ── Recipe-to-matrix generators ───────────────────────────────────────────

  function generateWallMatricesFromRecipe(recipe, meshPerUnitScale, rockScaleMult, densityMult) {
    rockScaleMult = rockScaleMult || 1;
    densityMult = Math.max(1e-6, Number(densityMult) || 1);
    if (recipe?.version !== 1 || recipe?.settings?.kind !== 'wall')
      throw new Error("Recipe.settings.kind must be 'wall'.");
    const s = recipe.settings, rng = makeRng(recipe.seed);
    const preM = preTRSToMatrix(recipe.preTransform?.translate, recipe.preTransform?.rotateDegXYZ, recipe.preTransform?.scale);
    const gap = computeEffectiveGap(recipe), unit = s.unitSize ?? { x: 1, y: 1, z: 1 };
    const baseStepX = Math.max(1e-6, Number(unit.x ?? 1) + Number(gap.x ?? 0));
    const baseStepY = Math.max(1e-6, Number(unit.y ?? 1) + Number(gap.y ?? 0));
    // Math.round (not floor) — floor truncates a whole partial column/row off
    // every wall, which is a much bigger relative loss on small walls than big
    // ones (e.g. a 1.3-unit-long wall at stepX=0.5 floors to 2 cols, leaving
    // 23% of its length bare). Any column that ends up slightly past the
    // panel's actual bounds is dropped later by the s/t clip in build().
    const cols = Math.max(1, Math.round((s.length ?? 1) / baseStepX * densityMult));
    const rows = Math.max(1, Math.round((s.height ?? 1) / baseStepY * densityMult));
    // Re-derive the actual placement spacing from cols/rows so the bricks still
    // exactly span the wall — densityMult packs more bricks into the same span
    // (overlapping if >1) rather than changing brick visual size, which stays
    // tied to unit/unitMult below.
    const stepX = (s.length ?? 1) / cols;
    const stepY = (s.height ?? 1) / rows;
    const perUnit = meshPerUnitScale ?? new THREE.Vector3(1, 1, 1);
    const unitScale = new THREE.Vector3(perUnit.x * Number(unit.x ?? 1), perUnit.y * Number(unit.y ?? 1), perUnit.z * Number(unit.z ?? 1));
    const mats = [];
    for (let row = 0; row < rows; row++) {
      const stagger = (s.stagger?.enabled && row % 2 === 1) ? Number(s.stagger?.amountInUnits ?? 0) * stepX : 0;
      for (let col = 0; col < cols; col++) {
        const x0 = (col * stepX + stagger) - (cols * stepX) / 2 + stepX / 2;
        const y0 = row * stepY + stepY / 2;
        const mj = s.microJitter ?? { x: 0, y: 0, z: 0 };
        const rt = applyRandomTRS(rng, s.random);
        const pos = new THREE.Vector3(
          x0 + rng.range(-Number(mj.x ?? 0), Number(mj.x ?? 0)) + rt.t[0],
          y0 + rng.range(-Number(mj.y ?? 0), Number(mj.y ?? 0)) + rt.t[1],
          rng.range(-Number(mj.z ?? 0), Number(mj.z ?? 0)) + rt.t[2]
        );
        const scl = new THREE.Vector3(unitScale.x * rt.s[0] * rockScaleMult, unitScale.y * rt.s[1] * rockScaleMult, unitScale.z * rt.s[2] * rockScaleMult);
        mats.push(new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromEuler(new THREE.Euler(rt.r[0], rt.r[1], rt.r[2], 'XYZ')), scl).multiply(preM));
      }
    }
    return mats;
  }

  function generateStacksMatricesFromRecipe(recipe, meshPerUnitScale, rockScaleMult) {
    rockScaleMult = rockScaleMult || 1;
    if (recipe?.version !== 1 || recipe?.settings?.kind !== 'stacks')
      throw new Error("Recipe.settings.kind must be 'stacks'.");
    const s = recipe.settings, rng = makeRng(recipe.seed);
    const preM = preTRSToMatrix(recipe.preTransform?.translate, recipe.preTransform?.rotateDegXYZ, recipe.preTransform?.scale);
    const gap = computeEffectiveGap(recipe), unit = s.unitSize ?? { x: 1, y: 1, z: 1 };
    const stepMult = Number(s.stepMultiplier ?? 1);
    const stepX = (Number(unit.x ?? 1) + Number(gap.x ?? 0)) * stepMult;
    const stepY = (Number(unit.y ?? 1) + Number(gap.y ?? 0)) * stepMult;
    const stepZ = (Number(unit.z ?? 1) + Number(gap.z ?? 0)) * stepMult;
    const axis = String(s.axis ?? 'X').toUpperCase();
    const step = axis === 'Y' ? stepY : (axis === 'Z' ? stepZ : stepX);
    const count = Math.max(1, Math.floor(Number(s.count ?? 1)));
    const centered = !!s.centered;
    const copies = Math.max(1, Math.floor(Number(s.duplicates?.copies ?? 1)));
    const off = s.duplicates?.offset ?? { x: 0, y: 0, z: 0 };
    const perUnit = meshPerUnitScale ?? new THREE.Vector3(1, 1, 1);
    const unitScale = new THREE.Vector3(perUnit.x * Number(unit.x ?? 1), perUnit.y * Number(unit.y ?? 1), perUnit.z * Number(unit.z ?? 1));
    const lineStart = centered ? (-(count * step) / 2 + step / 2) : 0;
    const mats = [];
    for (let c = 0; c < copies; c++) {
      for (let i = 0; i < count; i++) {
        const d = lineStart + i * step;
        let x0 = 0, y0 = 0, z0 = 0;
        if (axis === 'Y') y0 = d; else if (axis === 'Z') z0 = d; else x0 = d;
        const rt = applyRandomTRS(rng, s.random);
        const pos = new THREE.Vector3(
          Number(off.x ?? 0) * c + x0 + rt.t[0],
          Number(off.y ?? 0) * c + y0 + rt.t[1],
          Number(off.z ?? 0) * c + z0 + rt.t[2]
        );
        const scl = new THREE.Vector3(unitScale.x * rt.s[0] * rockScaleMult, unitScale.y * rt.s[1] * rockScaleMult, unitScale.z * rt.s[2] * rockScaleMult);
        mats.push(new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromEuler(new THREE.Euler(rt.r[0], rt.r[1], rt.r[2], 'XYZ')), scl).multiply(preM));
      }
    }
    return mats;
  }

  function cloneRecipeWithFaceDims(recipe, faceWidth, faceHeight, unitMult, densityMult) {
    const r = JSON.parse(JSON.stringify(recipe));
    r.settings = r.settings || {};
    r.settings.unitSize = r.settings.unitSize ?? { x: 1, y: 1, z: 1 };
    const m = Number(unitMult);
    if (Number.isFinite(m) && m > 0) {
      r.settings.unitSize.x = Number(r.settings.unitSize.x ?? 1) * m;
      r.settings.unitSize.y = Number(r.settings.unitSize.y ?? 1) * m;
      r.settings.unitSize.z = Number(r.settings.unitSize.z ?? 1) * m;
    }
    const dm = Math.max(1e-6, Number(densityMult) || 1);
    if (r.settings.kind === 'stacks') {
      const axis = String(r.settings.axis ?? 'X').toUpperCase();
      const gap = computeEffectiveGap(r), unit = r.settings.unitSize;
      const stepMult = Number(r.settings.stepMultiplier ?? 1);
      const step = (axis === 'Y' ? (Number(unit.y ?? 1) + Number(gap.y ?? 0)) : (axis === 'Z' ? (Number(unit.z ?? 1) + Number(gap.z ?? 0)) : (Number(unit.x ?? 1) + Number(gap.x ?? 0)))) * stepMult;
      const target = axis === 'Y' ? faceHeight : faceWidth;
      r.settings.count = Math.max(1, Math.round(target / Math.max(1e-6, step) * dm));
      // Shrink stepMultiplier to match the boosted count so stacks still span
      // the same target length/height (count grew but the per-piece spacing
      // must shrink proportionally, same idea as the 'wall' density rederivation).
      r.settings.stepMultiplier = stepMult / dm;
    } else {
      r.settings.kind = 'wall';
      r.settings.length = faceWidth;
      r.settings.height = faceHeight;
      r.settings.densityMult = dm;
    }
    return r;
  }

  function applyWallPreScaleToMatrices(mats, sx, sy, sz) {
    const ax = Math.max(1e-8, Number(sx) || 1), ay = Math.max(1e-8, Number(sy) || 1), az = Math.max(1e-8, Number(sz) || 1);
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    for (const m of mats) { m.decompose(p, q, s); s.set(s.x * ax, s.y * ay, s.z * az); m.compose(p, q, s); }
  }

  function applyWallPreRotationToMatrices(mats, rx, ry, rz) {
    const qPre = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      THREE.MathUtils.degToRad(Number(rx) || 0),
      THREE.MathUtils.degToRad(Number(ry) || 0),
      THREE.MathUtils.degToRad(Number(rz) || 0), 'XYZ'
    ));
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    for (const m of mats) { m.decompose(p, q, s); q.multiply(qPre); m.compose(p, q, s); }
  }

  // ── GLB helpers ───────────────────────────────────────────────────────────

  function findFirstMesh(root) {
    let found = null;
    root.traverse(o => { if (!found && o && o.isMesh) found = o; });
    return found;
  }
  function cloneMaterial(mat) {
    return Array.isArray(mat) ? mat.map(m => m.clone()) : mat.clone();
  }
  function computePerUnitScale(mesh) {
    const box = new THREE.Box3().setFromObject(mesh), size = new THREE.Vector3();
    box.getSize(size);
    return new THREE.Vector3(
      size.x > 1e-6 ? 1 / size.x : 1,
      size.y > 1e-6 ? 1 / size.y : 1,
      size.z > 1e-6 ? 1 / size.z : 1
    );
  }
  // Wraps GLTFLoader.parse in a Promise; works with both r128 (callback) and newer (parseAsync).
  function parseGlbAsync(loader, buffer) {
    if (typeof loader.parseAsync === 'function') return loader.parseAsync(buffer, '');
    return new Promise((resolve, reject) => loader.parse(buffer, '', resolve, reject));
  }

  // Some authored GLBs (e.g. Roughbrick1.glb) carry no `uv` attribute at all —
  // fine for their own baked/vertex-colored look, but a material.map assigned
  // later (tintDefaultGlb below) would sample a fixed corner texel for the
  // whole surface instead of actually varying across it. Generates a simple
  // per-vertex UV by projecting each vertex onto whichever world axis its
  // normal points along least (dominant-normal-axis projection), same
  // technique the town-path preview tool used for its material painter.
  // opts.stretch=true fits the whole PNG once across each axis group's own
  // bounding box (the preview's "stretch to bounds" mode) instead of tiling
  // it — opts.tileSize (world/local units per repeat, matching the tileSize
  // convention used by loadHousePieceFaceTexture/loadTerrainTileTexture) is
  // ignored in that case. No-op if the geometry already has a `uv` attribute.
  function ensureProjectedUv(geometry, opts) {
    opts = opts || {};
    if (geometry.getAttribute('uv')) return geometry;
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    const pos = geometry.getAttribute('position'), normal = geometry.getAttribute('normal');
    if (!pos || !normal) return geometry;
    const stride = Math.max(0.001, Number(opts.tileSize) || 1);
    const axisOf = (i) => {
      const nx = Math.abs(normal.getX(i)), ny = Math.abs(normal.getY(i)), nz = Math.abs(normal.getZ(i));
      return ny >= nx && ny >= nz ? 'y' : nx >= nz ? 'x' : 'z';
    };
    const rawUv = (i, axis) => {
      const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
      if (axis === 'x') return [pz, py];
      if (axis === 'z') return [px, py];
      return [px, pz];
    };
    const uvs = new Float32Array(pos.count * 2);
    if (opts.stretch) {
      const bounds = { x: [Infinity, -Infinity, Infinity, -Infinity], y: [Infinity, -Infinity, Infinity, -Infinity], z: [Infinity, -Infinity, Infinity, -Infinity] };
      for (let i = 0; i < pos.count; i++) {
        const axis = axisOf(i), [u, v] = rawUv(i, axis), b = bounds[axis];
        b[0] = Math.min(b[0], u); b[1] = Math.max(b[1], u); b[2] = Math.min(b[2], v); b[3] = Math.max(b[3], v);
      }
      for (let i = 0; i < pos.count; i++) {
        const axis = axisOf(i), [u, v] = rawUv(i, axis), b = bounds[axis];
        const du = Math.max(1e-6, b[1] - b[0]), dv = Math.max(1e-6, b[3] - b[2]);
        uvs[i * 2] = (u - b[0]) / du; uvs[i * 2 + 1] = (v - b[2]) / dv;
      }
    } else {
      for (let i = 0; i < pos.count; i++) {
        const axis = axisOf(i), [u, v] = rawUv(i, axis);
        uvs[i * 2] = u / stride; uvs[i * 2 + 1] = v / stride;
      }
    }
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    return geometry;
  }

  // ── WallBuilder ───────────────────────────────────────────────────────────

  /**
   * @param {Object} opts
   * @param {string} [opts.glbBasePath='assets/models/']  Base URL for GLB loads.
   */
  function WallBuilder(opts) {
    opts = opts || {};
    this.glbBasePath = opts.glbBasePath || 'assets/models/';
    this.recipeLibrary = new Map();
    this.glbLibrary = new Map();
    // Reused by every farmhouse/town rebuild so a later fetch cannot replace
    // the already PNG-textured shared brick material with a fresh GLB copy.
    this._defaultGlbLoadPromise = null;
    // Remembered here so a tint requested before the GLB is ready is applied
    // as soon as the shared brick template finishes loading.
    this._defaultGlbTintRequest = null;
    this._defaultGlbTintKey = '';
    this._defaultGlbTintModel = null;
    this.defaultRecipeId = BUILTIN_DEFAULT_RECIPE_ID;
    this.recipeLibrary.set(BUILTIN_DEFAULT_RECIPE_ID, {
      version: 1, seed: 'builtin_default',
      meta: { name: 'Default', instanceName: 'Default', glb: WALL_DEFAULT_GLB_NAME, libraryBaseId: BUILTIN_DEFAULT_RECIPE_ID },
      density: { value01: 0.5, overlapFrac: 0 },
      preTransform: { translate: [0, 0, 0], rotateDegXYZ: [0, 0, 0], scale: [1, 1, 1] },
      settings: {
        kind: 'wall', length: 1, height: 1,
        unitSize: { x: 1, y: 1, z: 1 },
        gapBase: { x: 0, y: 0, z: 0 },
        stagger: { enabled: false, amountInUnits: 0 },
        microJitter: { x: 0, y: 0, z: 0 },
        random: { rotationDeg: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, translate: { x: 0, y: 0, z: 0 } }
      }
    });
  }

  /** Register a wall/stacks recipe object (version:1 format from FBSE6). */
  WallBuilder.prototype.addRecipe = function (id, recipeData) {
    const kind = String(recipeData?.settings?.kind || '');
    if (recipeData?.version !== 1 || (kind !== 'wall' && kind !== 'stacks'))
      throw new Error('WallBuilder.addRecipe: unsupported kind/version: ' + kind);
    this.recipeLibrary.set(id, recipeData);
    if (this.defaultRecipeId === BUILTIN_DEFAULT_RECIPE_ID) this.defaultRecipeId = id;
    return id;
  };

  /** Load a GLB from an ArrayBuffer and register it by name. Returns Promise<name>. */
  WallBuilder.prototype.loadGlbFromBuffer = function (buffer, name) {
    const self = this;
    const loader = new THREE.GLTFLoader();
    return parseGlbAsync(loader, buffer).then(function (gltf) {
      const mesh = findFirstMesh(gltf.scene);
      if (!mesh) throw new Error('WallBuilder: no mesh in GLB "' + name + '"');
      const cloned = mesh.clone();
      cloned.geometry = ensureProjectedUv(mesh.geometry.clone(), { stretch: true });
      cloned.material = cloneMaterial(mesh.material);
      cloned.name = name;
      self.glbLibrary.set(name, { mesh: cloned, perUnitScale: computePerUnitScale(cloned) });
      return name;
    });
  };

  /** Fetch a GLB from a URL and register it. Returns Promise<name>. */
  WallBuilder.prototype.loadGlbFromUrl = function (url, name) {
    const self = this;
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('WallBuilder: HTTP ' + r.status + ' fetching ' + url);
      return r.arrayBuffer();
    }).then(function (buf) {
      return self.loadGlbFromBuffer(buf, name || url.split('/').pop() || WALL_DEFAULT_GLB_NAME);
    });
  };

  /** Fetch glbBasePath + 'Roughbrick1.glb'. Returns Promise<name>. */
  WallBuilder.prototype.loadDefaultGlb = function () {
    if (this._defaultGlbLoadPromise) return this._defaultGlbLoadPromise;
    this._defaultGlbLoadPromise = this.loadGlbFromUrl(this.glbBasePath + WALL_DEFAULT_GLB_NAME, WALL_DEFAULT_GLB_NAME)
      .then((name) => {
        const request = this._defaultGlbTintRequest;
        if (request) this.tintDefaultGlb(request.pngPath, request.fillColor);
        return name;
      })
      .catch((error) => {
        this._defaultGlbLoadPromise = null;
        throw error;
      });
    return this._defaultGlbLoadPromise;
  };

  /** Register a brown box placeholder so build() can run without a real GLB. */
  WallBuilder.prototype.ensurePlaceholderGlb = function () {
    if (this.glbLibrary.has(WALL_DEFAULT_GLB_NAME)) return;
    const geo = new THREE.BoxGeometry(1, 1, 0.25);
    const mat = new THREE.MeshLambertMaterial({ color: 0xb47a4a });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = WALL_DEFAULT_GLB_NAME;
    this.glbLibrary.set(WALL_DEFAULT_GLB_NAME, { mesh, perUnitScale: new THREE.Vector3(1, 1, 4) });
  };

  /**
   * Recolors the default (Roughbrick1.glb) wall model's own material in place,
   * replacing its baked brick texture with a repo PNG retinted via the same
   * adaptive shade fill used for portrait/creature tinting (getShadeFillCanvas
   * in portrait-utils.js, loaded before this file — called lazily here since
   * script load order puts this file first). build() hands every instanced
   * wall this exact material object (see WallBuilder.prototype.build below),
   * so tinting it once retints every wall — already built or built later —
   * anywhere the default GLB is used.
   */
  WallBuilder.prototype.tintDefaultGlb = function (pngPath, fillColor) {
    this._defaultGlbTintRequest = { pngPath, fillColor };
    const model = this.glbLibrary.get(WALL_DEFAULT_GLB_NAME);
    if (!model) return;
    const tintKey = `${pngPath}|${fillColor || ''}`;
    if (this._defaultGlbTintKey === tintKey && this._defaultGlbTintModel === model.mesh) return;
    this._defaultGlbTintKey = tintKey;
    this._defaultGlbTintModel = model.mesh;
    const mats = Array.isArray(model.mesh.material) ? model.mesh.material : [model.mesh.material];
    new THREE.TextureLoader().load(pngPath, (tex) => {
      const rgb = fillColor && root.parseHexColor && root.parseHexColor(fillColor);
      let finalTex = tex;
      if (rgb) {
        const canvas = root.getShadeFillCanvas(tex.image, pngPath + '|' + fillColor, {
          mode: 'shadeFill', rgb: [rgb.r, rgb.g, rgb.b], options: root.getPortraitTintingConfig(),
        });
        finalTex = new THREE.CanvasTexture(canvas);
      }
      finalTex.wrapS = finalTex.wrapT = THREE.RepeatWrapping;
      finalTex.needsUpdate = true;
      mats.forEach((m) => { if (!m) return; m.map = finalTex; if (m.color) m.color.setHex(0xffffff); m.needsUpdate = true; });
    }, undefined, () => {
      if (this._defaultGlbTintModel === model.mesh) {
        this._defaultGlbTintKey = '';
        this._defaultGlbTintModel = null;
      }
    });
  };

  /**
   * Generate instanced wall geometry for an array of panels.
   *
   * @param {Array}  panels  Each: { id, width, height, position:[x,y,z], rotationDeg:[rx,ry,rz], wallRecipeId? }
   * @param {Object} opts
   *   unitMult       {number}   Brick unit size multiplier (default 1)
   *   densityMult    {number}   Packs more (possibly overlapping) bricks of the
   *                              same size into the same wall span, independent
   *                              of unitMult (default 1)
   *   rockScale      {number}   Uniform scale applied after count (default 1)
   *   preScale       {number[]} [sx,sy,sz] applied to each instance before face projection (default [1,1,1])
   *   preRot         {number[]} [rx°,ry°,rz°] applied before face projection (default [0,0,0])
   *   postScale      {number[]} [sx,sy,sz] whole-wall post transform (default [1,1,1])
   *   postTranslate  {number[]} [tx,ty,tz] whole-wall post transform (default [0,0,0])
   *   usePlaceholder {boolean}  Fall back to placeholder box if GLB not loaded (default true)
   *   defaultRecipeId {string}  Recipe id for panels with no wallRecipeId
   * @returns {THREE.Group}  Ready to add to your scene; dispose with WallBuilder.disposeGroup().
   */
  WallBuilder.prototype.build = function (panels, opts) {
    opts = opts || {};
    const unitMult       = Math.max(0.0001, Number(opts.unitMult) || 1);
    const densityMult    = Math.max(0.0001, Number(opts.densityMult) || 1);
    const rockScale      = Math.max(0.0001, Number(opts.rockScale) || 1);
    const preScale       = opts.preScale       || [1, 1, 1];
    const preRot         = opts.preRot         || [0, 0, 0];
    const postScale      = opts.postScale      || [1, 1, 1];
    const postTranslate  = opts.postTranslate  || [0, 0, 0];
    const usePlaceholder = opts.usePlaceholder !== false;
    const defaultId      = opts.defaultRecipeId || this.defaultRecipeId || BUILTIN_DEFAULT_RECIPE_ID;
    const brickJitter    = opts.brickJitter || null;
    const jRng           = brickJitter ? makeRng('brickJitter') : null;
    const _jAxisY        = brickJitter ? new THREE.Vector3(0, 1, 0) : null;

    if (usePlaceholder) this.ensurePlaceholderGlb();

    const group = new THREE.Group();
    group.name = 'WallBuilder_Instances';

    const postM = new THREE.Matrix4()
      .makeTranslation(postTranslate[0] || 0, postTranslate[1] || 0, postTranslate[2] || 0)
      .multiply(new THREE.Matrix4().makeScale(
        Math.max(0.0001, Number(postScale[0]) || 1),
        Math.max(0.0001, Number(postScale[1]) || 1),
        Math.max(0.0001, Number(postScale[2]) || 1)
      ));

    const perGlb = new Map();
    const tmpPos = new THREE.Vector3(), tmpQuat = new THREE.Quaternion(), tmpScale = new THREE.Vector3();
    const eps = 0.002;

    for (const p of panels) {
      const recipe = this.recipeLibrary.get(p.wallRecipeId || defaultId);
      if (!recipe) continue;

      const glbName = resolveRecipeGlbName(recipe);
      const resolvedName = this.glbLibrary.has(glbName) ? glbName
                         : (usePlaceholder ? WALL_DEFAULT_GLB_NAME : null);
      if (!resolvedName) continue;
      const model = this.glbLibrary.get(resolvedName);
      if (!model) continue;

      const kind = String(recipe.settings?.kind || 'wall');
      const recipeFit = cloneRecipeWithFaceDims(recipe, p.width, p.height, unitMult, densityMult);
      let mats = kind === 'stacks'
        ? generateStacksMatricesFromRecipe(recipeFit, model.perUnitScale, rockScale)
        : generateWallMatricesFromRecipe(recipeFit, model.perUnitScale, rockScale, recipeFit.settings.densityMult);

      applyWallPreScaleToMatrices(mats, preScale[0], preScale[1], preScale[2]);
      applyWallPreRotationToMatrices(mats, preRot[0], preRot[1], preRot[2]);

      const [a, b, c, d] = panelCorners(p);

      for (const localM of mats) {
        const mLocal = postM.clone().multiply(localM);
        mLocal.decompose(tmpPos, tmpQuat, tmpScale);
        const s = (tmpPos.x + p.width * 0.5) / p.width;
        const t = tmpPos.y / p.height;
        if (s < -0.02 || s > 1.02 || t < -0.02 || t > 1.02) continue;

        const wp = quadPoint(a, b, c, d, s, t);
        const basis = quadBasis(a, b, c, d, s, t);
        wp.addScaledVector(basis.n, (tmpPos.z || 0) + eps);

        const worldQ = new THREE.Quaternion()
          .setFromRotationMatrix(new THREE.Matrix4().makeBasis(basis.u, basis.v, basis.n))
          .multiply(tmpQuat);
        if (brickJitter) {
          const jRotY = THREE.MathUtils.degToRad(jRng.range(-(brickJitter.rotYDeg || 0), brickJitter.rotYDeg || 0));
          worldQ.premultiply(new THREE.Quaternion().setFromAxisAngle(_jAxisY, jRotY));
          wp.addScaledVector(basis.u, jRng.range(-(brickJitter.shiftU || 0), brickJitter.shiftU || 0));
          wp.addScaledVector(basis.v, jRng.range(-(brickJitter.shiftV || 0), brickJitter.shiftV || 0));
        }
        const wm = new THREE.Matrix4().compose(wp, worldQ, tmpScale);

        if (!perGlb.has(resolvedName)) perGlb.set(resolvedName, { model, wms: [] });
        perGlb.get(resolvedName).wms.push(wm);
      }
    }

    for (const [name, { model, wms }] of perGlb) {
      const inst = new THREE.InstancedMesh(model.mesh.geometry, model.mesh.material, wms.length);
      inst.name = 'Wall:' + name;
      inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      wms.forEach((m, i) => inst.setMatrixAt(i, m));
      inst.instanceMatrix.needsUpdate = true;
      inst.castShadow = true;
      inst.receiveShadow = true;
      group.add(inst);
    }

    return group;
  };

  /** Dispose geometry/material owned by the group (does NOT dispose GLB library entries). */
  WallBuilder.disposeGroup = function (group) {
    if (!group) return;
    group.traverse(o => {
      if (o.isInstancedMesh) {
        o.geometry.dispose();
        if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
        else o.material.dispose();
      }
    });
  };

  root.WallBuilder = WallBuilder;
})(window);
