// Procedural crop geometry for HobunjiHollow.
// Generates Three.js meshes for needlegrain (NeedleShrub) and heftroot (RootTuber).
// Depends on THREE being a global (loaded via CDN before this script).

window.FoliageGenerator = (() => {
  const T = window.THREE;

  // ─── RNG ─────────────────────────────────────────────────────────────────
  function xfnv1a(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function mulberry32(seed) {
    return function () {
      let t = (seed += 0x6D2B79F5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ─── Math helpers ────────────────────────────────────────────────────────
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function clamp01(x) { return Math.max(0, Math.min(1, x)); }
  function fract(x) { return x - Math.floor(x); }

  // ─── 3D value noise (compact, no deps) ──────────────────────────────────
  function hash3(ix, iy, iz, seed) {
    let h = seed ^ (ix * 374761393) ^ (iy * 668265263) ^ (iz * 2147483647);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return fract((h >>> 0) / 4294967296);
  }
  function valueNoise3D(x, y, z, seed) {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const fx = x - ix, fy = y - iy, fz = z - iz;
    const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const w = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
    const n000 = hash3(ix,   iy,   iz,   seed), n100 = hash3(ix+1, iy,   iz,   seed);
    const n010 = hash3(ix,   iy+1, iz,   seed), n110 = hash3(ix+1, iy+1, iz,   seed);
    const n001 = hash3(ix,   iy,   iz+1, seed), n101 = hash3(ix+1, iy,   iz+1, seed);
    const n011 = hash3(ix,   iy+1, iz+1, seed), n111 = hash3(ix+1, iy+1, iz+1, seed);
    return lerp(lerp(lerp(n000, n100, u), lerp(n010, n110, u), v),
                lerp(lerp(n001, n101, u), lerp(n011, n111, u), v), w);
  }
  function fbm3D(x, y, z, seed, octaves, lacunarity, gain) {
    let amp = 0.5, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum  += valueNoise3D(x * freq, y * freq, z * freq, seed + i * 1013) * amp;
      norm += amp;
      freq *= lacunarity;
      amp  *= gain;
    }
    return sum / Math.max(1e-6, norm);
  }

  // ─── Spine builder (parallel transport) ──────────────────────────────────
  function buildSpine({ seedU32, length, rings, origin, direction, bend, wonk, wonkScale, gravityDir, curl }) {
    const pts = [], tangents = [];
    const dir0 = direction.clone().normalize();
    const g    = gravityDir.clone().normalize();
    let p = origin.clone(), dir = dir0.clone();

    const right0 = new T.Vector3().copy(dir0).cross(new T.Vector3(0, 1, 0));
    if (right0.lengthSq() < 1e-6) right0.set(1, 0, 0);
    right0.normalize();
    const up0 = new T.Vector3().copy(right0).cross(dir0).normalize();

    const step = rings > 1 ? length / (rings - 1) : 0;

    for (let i = 0; i < rings; i++) {
      const t    = rings <= 1 ? 0 : i / (rings - 1);
      const bAx  = (Math.abs(up0.y) < 0.99 ? up0 : right0).clone().normalize();
      dir.applyAxisAngle(bAx, bend * 1.15 * (t - 0.25) * 0.02);
      if (curl > 0) dir.lerp(g, curl * (0.15 + 0.85 * t) * 0.08).normalize();
      if (i > 0)    p = p.clone().addScaledVector(dir, step);

      const ws = Math.max(0.05, wonkScale);
      const ox = (fbm3D(t * ws + 11.1, 0, 0, seedU32 ^ 0x12345, 4, 2.1, 0.55) - 0.5) * 2;
      const oy = (fbm3D(0, t * ws + 27.7, 0, seedU32 ^ 0x23456, 4, 2.1, 0.55) - 0.5) * 2;
      const oz = (fbm3D(0, 0, t * ws + 39.9, seedU32 ^ 0x34567, 4, 2.1, 0.55) - 0.5) * 2;
      const amp = Math.max(0, wonk) * 0.18 * (0.35 + 0.65 * length);
      // Keep every procedural spine exactly on its authored origin at the
      // first ring, then ease the organic displacement in. For tree trunks
      // that origin is the center of their solid tile, so the visible base
      // and the tile collision finally agree even on highly wonky variants.
      const originBlend01 = clamp01(t / 0.18);
      const originBlend = originBlend01 * originBlend01 * (3 - 2 * originBlend01);
      pts.push(p.clone().add(new T.Vector3(ox, oy, oz).multiplyScalar(amp * originBlend)));
      tangents.push(dir.clone().normalize());
    }

    const normals = [], binormals = [];
    const worldUp = new T.Vector3(0, 1, 0);
    const T0 = tangents[0].clone();
    let N0 = new T.Vector3().copy(worldUp).cross(T0);
    if (N0.lengthSq() < 1e-6) N0.set(1, 0, 0).cross(T0);
    N0.normalize();
    normals.push(N0); binormals.push(new T.Vector3().copy(T0).cross(N0).normalize());

    const axis = new T.Vector3();
    for (let i = 1; i < rings; i++) {
      axis.copy(tangents[i - 1]).cross(tangents[i]);
      let N = normals[i - 1].clone();
      if (axis.length() > 1e-6) {
        const angle = Math.acos(clamp(tangents[i - 1].dot(tangents[i]), -1, 1));
        N.applyAxisAngle(axis.clone().normalize(), angle).normalize();
      }
      normals.push(N);
      binormals.push(new T.Vector3().copy(tangents[i]).cross(N).normalize());
    }
    return { pts, tangents, normals, binormals };
  }

  // Parallel-transport tangent/normal/binormal frames for an arbitrary point
  // list (e.g. a CatmullRomCurve3's sampled points) — same normal-propagation
  // approach buildSpine uses for its own parametrically-generated points,
  // just fed finite-difference tangents instead. Used by vine strands, whose
  // control points come from wrapping around another spine (the trunk's),
  // not from buildSpine's own bend/wonk/noise walk.
  function framesFromPoints(pts) {
    const tangents = [];
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[Math.max(0, i - 1)];
      const next = pts[Math.min(pts.length - 1, i + 1)];
      const t = next.clone().sub(prev);
      tangents.push(t.lengthSq() > 1e-10 ? t.normalize() : new T.Vector3(0, 1, 0));
    }
    const normals = [], binormals = [];
    const worldUp = new T.Vector3(0, 1, 0);
    const T0 = tangents[0].clone();
    let N0 = new T.Vector3().copy(worldUp).cross(T0);
    if (N0.lengthSq() < 1e-6) N0.set(1, 0, 0).cross(T0);
    N0.normalize();
    normals.push(N0); binormals.push(new T.Vector3().copy(T0).cross(N0).normalize());
    const axis = new T.Vector3();
    for (let i = 1; i < pts.length; i++) {
      axis.copy(tangents[i - 1]).cross(tangents[i]);
      let N = normals[i - 1].clone();
      if (axis.length() > 1e-6) {
        const angle = Math.acos(clamp(tangents[i - 1].dot(tangents[i]), -1, 1));
        N.applyAxisAngle(axis.clone().normalize(), angle).normalize();
      }
      normals.push(N);
      binormals.push(new T.Vector3().copy(tangents[i]).cross(N).normalize());
    }
    return { pts, tangents, normals, binormals };
  }

  // ─── Tube mesh from spine ─────────────────────────────────────────────────
  function buildMeshFromSpineWithRadiusFn({ seedU32, spine, radiusFn, radialSegments, twist, noiseAmt, noiseScale, noiseOctaves, capStart = false, capEnd = false }) {
    const { pts, tangents, normals, binormals } = spine;
    const rings = pts.length;
    const radial = Math.max(3, Math.floor(radialSegments));
    const positions = [], indices = [];
    const TT = new T.Vector3(), N = new T.Vector3(), B = new T.Vector3();

    for (let i = 0; i < rings; i++) {
      const t = rings <= 1 ? 0 : i / (rings - 1);
      TT.copy(tangents[i]).normalize();
      N.copy(normals[i]); B.copy(binormals[i]);
      const twA = twist * (t * Math.PI * 2);
      N.applyAxisAngle(TT, twA); B.applyAxisAngle(TT, twA);
      const rBase = Math.max(1e-4, radiusFn(t, i, rings));
      const center = pts[i];

      for (let j = 0; j < radial; j++) {
        const a = (j / radial) * Math.PI * 2;
        const nx = Math.cos(a), ny = Math.sin(a);
        const n = fbm3D(center.x * 0.35 + nx * noiseScale + 101.1,
                        center.y * 0.35 + ny * noiseScale -  31.7,
                        center.z * 0.35 + t * 7            +  72.4,
                        seedU32 ^ 0x91E10DA5, Math.max(1, Math.floor(noiseOctaves)), 2.1, 0.55);
        const r = rBase * (1 + noiseAmt * 0.35 * (n - 0.5) * 2);
        positions.push(center.x + N.x * nx * r + B.x * ny * r,
                       center.y + N.y * nx * r + B.y * ny * r,
                       center.z + N.z * nx * r + B.z * ny * r);
      }
    }
    for (let i = 0; i < rings - 1; i++) {
      const r0 = i * radial, r1 = (i + 1) * radial;
      for (let j = 0; j < radial; j++) {
        const a0 = r0 + j, a1 = r0 + (j + 1) % radial;
        const b0 = r1 + j, b1 = r1 + (j + 1) % radial;
        indices.push(a0, a1, b0, b0, a1, b1);
      }
    }
    if (capStart && rings) {
      const centerIndex = positions.length / 3; // Used as the start-cap triangle fan center.
      const center = pts[0]; // Used to close the exact first noisy perimeter without a separate disc.
      positions.push(center.x, center.y, center.z);
      for (let j = 0; j < radial; j++) indices.push(centerIndex, (j + 1) % radial, j);
    }
    if (capEnd && rings) {
      const centerIndex = positions.length / 3; // Used as the end-cap triangle fan center.
      const center = pts[rings - 1]; // Used to close the exact final noisy perimeter without a separate disc.
      const ringStart = (rings - 1) * radial; // Used to address vertices in the last generated tube ring.
      positions.push(center.x, center.y, center.z);
      for (let j = 0; j < radial; j++) indices.push(centerIndex, ringStart + j, ringStart + (j + 1) % radial);
    }
    const geom = new T.BufferGeometry();
    geom.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    geom.setIndex(indices);
    return geom;
  }

  function buildWonkyChain(opts) {
    const rings = Math.max(2, Math.floor(opts.ringSegments));
    const spine = buildSpine({
      seedU32: opts.seedU32, length: opts.length, rings,
      origin: opts.origin, direction: opts.direction,
      bend: opts.bend, wonk: opts.wonk, wonkScale: opts.wonkScale ?? 1.35,
      gravityDir: opts.gravityDir, curl: opts.curl
    });
    const geom = buildMeshFromSpineWithRadiusFn({
      seedU32: opts.seedU32, spine, radiusFn: opts.radiusFn,
      radialSegments: opts.radialSegments, twist: opts.twist,
      noiseAmt: opts.noiseAmt, noiseScale: opts.noiseScale, noiseOctaves: opts.noiseOctaves,
      capStart: !!opts.capStart, capEnd: !!opts.capEnd
    });
    return { geom, spine };
  }

  // ─── Geometry merge ───────────────────────────────────────────────────────
  function mergeGeoms(geoms) {
    let totalV = 0, totalI = 0;
    for (const g of geoms) {
      if (!g?.getAttribute('position')?.count || !g.index) continue;
      totalV += g.getAttribute('position').count;
      totalI += g.index.count;
    }
    const pos  = new Float32Array(totalV * 3);
    const idx  = new (totalV > 65535 ? Uint32Array : Uint16Array)(totalI);
    let vOff = 0, iOff = 0;
    for (const g of geoms) {
      const pa = g.getAttribute('position');
      const ia = g.index;
      if (!pa || !ia) continue;
      pos.set(pa.array, vOff * 3);
      const arr = ia.array;
      for (let i = 0; i < arr.length; i++) idx[iOff + i] = arr[i] + vOff;
      vOff += pa.count;
      iOff += arr.length;
    }
    const out = new T.BufferGeometry();
    out.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    out.setIndex(new T.BufferAttribute(idx, 1));
    return out;
  }

  // ─── Material helpers ─────────────────────────────────────────────────────
  // MeshLambertMaterial has no light of its own — under this game's storm/
  // night dimming it can go essentially to (0,0,0), and a bush's dense tangle
  // of thin wood geometry (many more branch segments packed into a small area
  // than a single tree's trunk+roots) reads as a solid black blob rather than
  // a recognizably dark bush. Grass sidesteps this by going fully unlit
  // instead (see game.js's unlitFloorMat/tileMats.grass and _grassBillFrag);
  // bark stays a lit MeshLambertMaterial but gets a constant emissive floor
  // so it can't go fully black: emissive = 30% of the base color guarantees
  // that same ~30% brightness floor regardless of scene lighting.
  const BARK_EMISSIVE_FLOOR = 0.3;
  function hslMat(h360, s, l, roughness = 1) {
    const col = new T.Color().setHSL(h360 / 360, s, l);
    return new T.MeshLambertMaterial({ color: col, emissive: col.clone().multiplyScalar(BARK_EMISSIVE_FLOOR) });
  }
  function hexBarkMat(hex) {
    const col = new T.Color(hex);
    return new T.MeshLambertMaterial({ color: col, emissive: col.clone().multiplyScalar(BARK_EMISSIVE_FLOOR) });
  }

  // Exact-length, capped horizontal log used by structure/interior walls.
  // Centerline wonk is intentionally disabled: callers get exactly the span
  // they request, while radius noise keeps the bark silhouette procedural.
  function buildLogGroup(options) {
    const opts = options || {}; // Used to keep public log generation tolerant of omitted configuration.
    const length = Math.max(0.05, Number(opts.length) || 1); // Used as the exact generated centerline span.
    const radius = Math.max(0.01, Number(opts.radius) || 0.085); // Used as the log's nominal bark radius.
    const seedText = opts.seed != null ? String(opts.seed) : `log_${length.toFixed(4)}_${radius.toFixed(4)}`; // Used to make bark variation deterministic.
    const numericSeed = Number(opts.seedU32); // Used when a caller already owns a stable integer seed.
    const seedU32 = Number.isFinite(numericSeed) ? (numericSeed >>> 0) : xfnv1a(seedText); // Used by all procedural bark/noise sampling for this log.
    const radialSegments = Math.max(5, Math.floor(Number(opts.radialSegments) || 8)); // Used for the capped cross-section resolution.
    const ringSegments = Math.max(2, Math.floor(Number(opts.ringSegments) || Math.max(4, Math.ceil(length * 3)))); // Used for axial bark detail without changing length.
    const noiseAmtValue = Number(opts.noiseAmt); // Used to validate an optional bark roughness override.
    const noiseScaleValue = Number(opts.noiseScale); // Used to validate an optional bark noise-scale override.
    const noiseOctavesValue = Number(opts.noiseOctaves); // Used to validate an optional bark octave override.
    const chain = buildWonkyChain({
      seedU32,
      length,
      ringSegments,
      radialSegments,
      origin: new T.Vector3(-length * 0.5, 0, 0),
      direction: new T.Vector3(1, 0, 0),
      bend: 0,
      wonk: 0,
      wonkScale: 1,
      twist: 0,
      curl: 0,
      gravityDir: new T.Vector3(0, -1, 0),
      noiseAmt: Number.isFinite(noiseAmtValue) ? noiseAmtValue : 0.45,
      noiseScale: Number.isFinite(noiseScaleValue) ? noiseScaleValue : 2.2,
      noiseOctaves: Math.max(1, Math.floor(Number.isFinite(noiseOctavesValue) ? noiseOctavesValue : 3)),
      capStart: true,
      capEnd: true,
      radiusFn: (t01) => Math.max(1e-4, radius * lerp(1, 0.97, t01))
    });
    chain.geom.computeVertexNormals();

    const group = new T.Group(); // Used as the public transform root so wall callers can position/orient without scaling geometry.
    const mesh = new T.Mesh(chain.geom, hexBarkMat(opts.barkColorHex ?? 0x4a3b33)); // Used as the visible capped procedural log.
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.foliageLog = true;
    group.add(mesh);
    group.userData.foliageLog = { length, radius, seedU32 };
    return group;
  }

  // ─── Geometry merge (position + uv, for textured leaf cards) ─────────────
  function mergeGeomsWithUV(geoms) {
    let totalV = 0, totalI = 0;
    for (const g of geoms) {
      if (!g?.getAttribute('position')?.count || !g.index) continue;
      totalV += g.getAttribute('position').count;
      totalI += g.index.count;
    }
    const pos = new Float32Array(totalV * 3);
    const uv  = new Float32Array(totalV * 2);
    const idx = new (totalV > 65535 ? Uint32Array : Uint16Array)(totalI);
    let vOff = 0, iOff = 0;
    for (const g of geoms) {
      const pa = g.getAttribute('position');
      const ua = g.getAttribute('uv');
      const ia = g.index;
      if (!pa || !ia) continue;
      pos.set(pa.array, vOff * 3);
      if (ua) uv.set(ua.array, vOff * 2);
      const arr = ia.array;
      for (let i = 0; i < arr.length; i++) idx[iOff + i] = arr[i] + vOff;
      vOff += pa.count;
      iOff += arr.length;
    }
    const out = new T.BufferGeometry();
    out.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    out.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    out.setIndex(new T.BufferAttribute(idx, 1));
    return out;
  }

  // ─── Leaf card textures (lazy-loaded, cached, shared across every tree
  // instance of a given kind) ────────────────────────────────────────────
  // Routes through the game's own in-game debug log (DEBUG tab -> Game Log)
  // when it's present, so load status is visible without devtools; falls
  // back to console when running standalone (e.g. this file's own test
  // harnesses) where window.__farmLog doesn't exist.
  function _leafDebugLog(message, level) {
    if (typeof window !== 'undefined' && typeof window.__farmLog === 'function') {
      window.__farmLog(message, level);
    } else if (level === 'error') {
      console.error(message);
    } else {
      console.log(message);
    }
  }

  const _leafTexCache = new Map();
  function getLeafTexture(path) {
    let tex = _leafTexCache.get(path);
    if (!tex) {
      _leafDebugLog(`leaf texture: requesting ${path}`, 'info');
      tex = new T.TextureLoader().load(
        path,
        (loadedTex) => {
          const img = loadedTex.image;
          _leafDebugLog(`leaf texture: loaded ${path} (${img?.width ?? '?'}x${img?.height ?? '?'}, complete=${!!img?.complete})`, 'info');
        },
        undefined,
        (err) => {
          _leafDebugLog(`leaf texture: FAILED to load ${path} — ${err?.message || err}`, 'error');
        }
      );
      tex.colorSpace = T.SRGBColorSpace;
      tex.magFilter = T.NearestFilter;
      tex.minFilter = T.NearestFilter;
      tex.generateMipmaps = false;
      _leafTexCache.set(path, tex);
    }
    return tex;
  }
  const _leafMatCache = new Map();
  function getLeafCardMaterial(preset) {
    let mat = _leafMatCache.get(preset);
    if (!mat) {
      const tex = getLeafTexture(preset.leafTexture);
      const col = new T.Color().setHSL((preset.leafTintH ?? 115) / 360, preset.leafTintS ?? 0.55, preset.leafTintL ?? 0.35);
      mat = new T.MeshBasicMaterial({
        map: tex, color: col, transparent: false,
        opacity: 1, side: T.DoubleSide,
        depthWrite: true, depthTest: true, alphaTest: preset.leafAlphaCutoff ?? 0.5
      });
      _leafMatCache.set(preset, mat);
    }
    return mat;
  }

  // ─── Needle placement (local-space, no scene required) ────────────────────
  function needlesOnSpine({ spine, rand, baseRadius, taperPerRing, rings,
                            needleLen, needleThick, clusters, perCluster,
                            fromFrac, toFrac, maskTopRad, maskBotRad, growth01 }) {
    const pts = spine.pts, tans = spine.tangents, norms = spine.normals, bins = spine.binormals;
    const n  = pts.length;
    const geoms = [];
    const unitGeom = new T.CylinderGeometry(0.2, 1.0, 1.0, 5, 1);

    for (let c = 0; c < clusters; c++) {
      const t01C = clusters <= 1
        ? lerp(fromFrac, toFrac, 0.5)
        : lerp(fromFrac, toFrac, c / (clusters - 1));

      const radA0 = rand() * Math.PI * 2;

      for (let ni = 0; ni < perCluster; ni++) {
        const t01 = clamp01(t01C + (rand() - 0.5) * 0.10 * (toFrac - fromFrac));
        const f   = t01 * (n - 1);
        const i0  = Math.max(0, Math.min(n - 2, Math.floor(f)));
        const alpha = f - i0;

        const pt = pts[i0].clone().lerp(pts[i0 + 1], alpha);
        const TT = tans[i0].clone().lerp(tans[i0 + 1], alpha).normalize();
        const NN = norms[i0].clone().lerp(norms[i0 + 1], alpha).normalize();
        const BB = bins[i0].clone().lerp(bins[i0 + 1], alpha).normalize();

        const ringIdx  = t01 * rings;
        const surfR    = Math.max(1e-4, baseRadius * Math.pow(Math.max(0.001, taperPerRing), ringIdx));

        const radA = radA0 + (rand() - 0.5) * 0.85;

        if (maskTopRad > 1e-6 || maskBotRad > 1e-6) {
          const maskA     = radA + Math.PI * 0.5;
          const normalized = ((maskA % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
          const dTop       = Math.min(normalized, Math.PI * 2 - normalized);
          const dBot       = Math.abs(Math.PI - normalized);
          if (maskTopRad > 1e-6 && dTop <= maskTopRad) continue;
          if (maskBotRad > 1e-6 && dBot <= maskBotRad) continue;
        }

        const outward = NN.clone().multiplyScalar(Math.cos(radA)).addScaledVector(BB, Math.sin(radA)).normalize();

        const len   = Math.max(1e-4, needleLen  * (0.75 + 0.5 * rand()));
        const thick = Math.max(1e-4, needleThick * (0.80 + 0.4 * rand()));

        const dirW = outward.clone().addScaledVector(TT, 0.35 + 0.25 * rand()).normalize();
        dirW.applyAxisAngle(TT, (rand() - 0.5) * 0.65);
        dirW.normalize();

        const embed   = Math.min(len * 0.18, surfR * 0.35);
        const rAttach = surfR + (rand() - 0.5) * 0.08 * surfR;
        const basePos = pt.clone().addScaledVector(outward, Math.max(1e-4, rAttach));
        const center  = basePos.clone().addScaledVector(dirW, Math.max(0, len * 0.5 - embed));

        const q = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), dirW);
        const m = new T.Matrix4().compose(center, q, new T.Vector3(thick, len, thick));
        const g = unitGeom.clone();
        g.applyMatrix4(m);
        geoms.push(g);
      }
    }
    unitGeom.dispose();
    return geoms;
  }

  // ─── Needlegrain (NeedleShrub) ────────────────────────────────────────────
  function buildNeedlegrainGroup(growth01, seedU32) {
    const rand = mulberry32(seedU32);
    const g01  = clamp01(growth01);
    const gLen = lerp(0.25, 1.0, g01);
    const gRad = lerp(0.40, 1.0, g01);

    const RADIAL = 5, RINGS = 7;
    const woodGeoms    = [];
    const needleGeoms  = [];
    const DOWN = new T.Vector3(0, -1, 0);
    const UP   = new T.Vector3(0,  1, 0);

    const trunkLen  = 0.47 * gLen;
    const trunkRad  = 0.026 * gRad;
    const trunk = buildWonkyChain({
      seedU32: seedU32 ^ 0xA11CE, length: trunkLen,
      ringSegments: RINGS, radialSegments: RADIAL,
      origin: new T.Vector3(0, 0, 0), direction: UP,
      bend: 0.1, wonk: 0.0, wonkScale: 2.4, twist: 0.65, curl: 0,
      noiseAmt: 0.6, noiseScale: 2.8, noiseOctaves: 1,
      gravityDir: DOWN,
      radiusFn: (t01) => Math.max(1e-4, trunkRad * Math.pow(0.9355, t01 * RINGS))
    });
    woodGeoms.push(trunk.geom);

    const TIERS = 3, KNOTS_PER_TIER = 6;
    const knotAt = 0.157, spacing = 0.429;
    const halfSpan = spacing * (TIERS - 1) * 0.5;
    const startAt  = clamp01(knotAt - halfSpan);
    const endAt    = clamp01(knotAt + halfSpan);

    const trunkPts  = trunk.spine.pts;
    const trunkTans = trunk.spine.tangents;
    const dLen = -0.4275, dRad = -0.4232, dBias = 0.2775;

    for (let tier = 0; tier < TIERS; tier++) {
      const tTier  = TIERS <= 1 ? 0 : tier / (TIERS - 1);
      const tierAt = lerp(startAt, endAt, tTier);
      const f  = clamp01(tierAt) * (trunkPts.length - 1);
      const i0 = Math.max(0, Math.min(trunkPts.length - 2, Math.floor(f)));
      const alpha = f - i0;
      const anchor = trunkPts[i0].clone().lerp(trunkPts[i0 + 1], alpha);
      const tanAt  = trunkTans[i0].clone().lerp(trunkTans[i0 + 1], alpha).normalize();

      let right = new T.Vector3().copy(tanAt).cross(UP);
      if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
      right.normalize();
      const upLocal = new T.Vector3().copy(right).cross(tanAt).normalize();

      const tierLenScale = clamp(lerp(1.0, 1.0 + dLen, tTier), 0.15, 3.0);
      const tierRadScale = clamp(lerp(1.0, 1.0 + dRad, tTier), 0.15, 3.0);
      const biasTier     = clamp(0.313 + dBias * tTier, -1, 1);
      const biasVec      = biasTier >= 0 ? UP : DOWN;
      const biasAmt      = Math.abs(biasTier);

      const knotLen = 0.284 * gLen * tierLenScale;
      const knotRad = 0.03  * gRad * tierRadScale;
      const knotTaper = 0.75;

      for (let k = 0; k < KNOTS_PER_TIER; k++) {
        const a = (k / Math.max(1, KNOTS_PER_TIER)) * Math.PI * 2 + (rand() - 0.5) * 0.4;
        const outward = new T.Vector3()
          .addScaledVector(right,   Math.cos(a))
          .addScaledVector(upLocal, Math.sin(a))
          .normalize();
        const attachR = Math.max(1e-4, trunkRad * (1.0 - 0.503) * Math.pow(0.9355, tierAt * RINGS));
        const origin  = anchor.clone().addScaledVector(outward, Math.max(1e-4, attachR));
        const dir = new T.Vector3()
          .addScaledVector(outward, 1.0)
          .addScaledVector(biasVec, biasAmt * 1.35)
          .addScaledVector(tanAt, 0.15)
          .normalize();
        dir.add(new T.Vector3((rand()-0.5)*0.12, (rand()-0.5)*0.10, (rand()-0.5)*0.12)).normalize();
        const kLen = knotLen * lerp(1.0, 0.55 + 0.95 * rand(), 0.23);
        const knot = buildWonkyChain({
          seedU32: seedU32 ^ (0xC0FFEE + tier * 1009 + k * 271),
          length: kLen, ringSegments: 5, radialSegments: RADIAL,
          origin, direction: dir, bend: 0, wonk: 0.3, wonkScale: 1.25,
          twist: 0.38, curl: clamp(0.9275, 0, 2), gravityDir: DOWN,
          noiseAmt: 0.5, noiseScale: 1.15, noiseOctaves: 2,
          radiusFn: (t01) => Math.max(1e-4, knotRad * (0.75 + 0.5 * rand() * 0.1) * Math.pow(knotTaper, t01 * 5))
        });
        woodGeoms.push(knot.geom);
        const nLen  = 0.142 * lerp(0.35, 1.0, g01) * (0.75 + 0.5 * (rand() * 0.2 + 0.9));
        const nThick = 0.014 * gRad;
        const nGeoms = needlesOnSpine({
          spine: knot.spine, rand,
          baseRadius: knotRad, taperPerRing: knotTaper, rings: 5,
          needleLen: nLen, needleThick: nThick,
          clusters: 5, perCluster: 3,
          fromFrac: 0.0, toFrac: 0.92,
          maskTopRad: 50 * Math.PI / 180, maskBotRad: 50 * Math.PI / 180,
          growth01: g01
        });
        needleGeoms.push(...nGeoms);
      }
    }

    const group = new T.Group();
    if (woodGeoms.length) {
      const merged = mergeGeoms(woodGeoms);
      merged.computeVertexNormals();
      group.add(new T.Mesh(merged, hslMat(30, 0.35, 0.25)));
    }
    if (needleGeoms.length) {
      const merged = mergeGeoms(needleGeoms);
      merged.computeVertexNormals();
      const nL = lerp(0.17, 0.23, g01);
      group.add(new T.Mesh(merged, hslMat(140, 0.50, nL)));
    }
    return group;
  }

  // ─── Heftroot (RootTuber) ─────────────────────────────────────────────────
  function buildHeftrootGroup(growth01, seedU32) {
    const rand = mulberry32(seedU32);
    const g01  = clamp01(growth01);
    const gLen = lerp(0.25, 1.0, g01);
    const gRad = lerp(0.35, 1.0, g01);
    const RADIAL = 6, RINGS = 8;
    const DOWN = new T.Vector3(0, -1, 0);
    const UP   = new T.Vector3(0,  1, 0);
    const tuberLen  = 0.50 * gLen;
    const tuberWid  = 0.16 * gRad;
    const lump      = 0.55;
    const tuberChain = buildWonkyChain({
      seedU32: seedU32 ^ 0x71B3A, length: tuberLen,
      ringSegments: RINGS, radialSegments: RADIAL,
      origin: new T.Vector3(0, 0, 0), direction: UP,
      bend: 0.15, wonk: 0.65, wonkScale: 1.9, twist: 0.12, curl: 0.25,
      noiseAmt: lump, noiseScale: 3.2, noiseOctaves: 2, gravityDir: DOWN,
      radiusFn: (t01) => {
        const bulge = tuberWid * (0.25 + 0.75 * Math.sin(Math.PI * t01));
        const cone  = tuberWid * (0.15 + 0.85 * (1.0 - t01));
        return Math.max(1e-4, lerp(bulge, cone, 0.25));
      }
    });
    const tuberTop = tuberChain.spine.pts[tuberChain.spine.pts.length - 1].clone();
    const group = new T.Group();
    tuberChain.geom.computeVertexNormals();
    group.add(new T.Mesh(tuberChain.geom, hslMat(35, 0.55, 0.45)));
    const STEM_COUNT = Math.max(2, Math.floor(3 + rand() * 2));
    const stemLen    = 0.60 * gLen;
    const stemRad    = 0.016 * gRad;
    const stemGeoms  = [];
    const leafGeoms  = [];
    for (let s = 0; s < STEM_COUNT; s++) {
      const a  = rand() * Math.PI * 2;
      const rr = tuberWid * 0.4 * Math.sqrt(rand());
      const origin = tuberTop.clone();
      origin.x += Math.cos(a) * rr; origin.z += Math.sin(a) * rr; origin.y -= 0.015;
      const dir = new T.Vector3((rand() - 0.5) * 0.35, 1.0, (rand() - 0.5) * 0.35).normalize();
      const sLen = stemLen * (0.8 + 0.4 * rand());
      const stem = buildWonkyChain({
        seedU32: seedU32 ^ (0x51EAD + s * 9973), length: sLen,
        ringSegments: 6, radialSegments: 4,
        origin, direction: dir, bend: 0.35, wonk: 0.65, wonkScale: 2.4,
        twist: 0.55, curl: 0.35, gravityDir: DOWN,
        noiseAmt: 0.6, noiseScale: 2.8, noiseOctaves: 1,
        radiusFn: (t01) => Math.max(1e-4, stemRad * (0.75 + 0.25 * rand() * 0.1) * Math.pow(0.88, t01 * 6))
      });
      stemGeoms.push(stem.geom);
      const tip = stem.spine.pts[stem.spine.pts.length - 1];
      const leafR = (0.055 + 0.045 * rand()) * lerp(0.25, 1.0, g01);
      const leafGeom = new T.SphereGeometry(leafR, 5, 4);
      leafGeom.translate(tip.x, tip.y, tip.z);
      leafGeoms.push(leafGeom);
      const pts = stem.spine.pts;
      for (let li = Math.floor(pts.length * 0.5); li < pts.length - 1; li++) {
        if (rand() < 0.45) {
          const lr   = (0.035 + 0.03 * rand()) * lerp(0.2, 1.0, g01);
          const sph  = new T.SphereGeometry(lr, 4, 3);
          const lp   = pts[li];
          const off  = new T.Vector3((rand()-0.5)*0.08, 0.02 + rand()*0.04, (rand()-0.5)*0.08);
          sph.translate(lp.x + off.x, lp.y + off.y, lp.z + off.z);
          leafGeoms.push(sph);
        }
      }
    }
    if (stemGeoms.length) {
      const merged = mergeGeoms(stemGeoms); merged.computeVertexNormals();
      group.add(new T.Mesh(merged, hslMat(110, 0.55, 0.32)));
    }
    if (leafGeoms.length) {
      const merged = mergeGeoms(leafGeoms); merged.computeVertexNormals();
      group.add(new T.Mesh(merged, hslMat(115, 0.60, 0.38)));
    }
    return group;
  }

  // ─── Weeds (thin grass-blade cluster) ────────────────────────────────────
  function buildWeedsGroup(seedU32) {
    const rand = mulberry32(seedU32);
    const BLADE_COUNT = 5 + Math.floor(rand() * 4);
    const DOWN = new T.Vector3(0, -1, 0);
    const geoms = [];
    for (let b = 0; b < BLADE_COUNT; b++) {
      const a   = (b / BLADE_COUNT) * Math.PI * 2 + (rand() - 0.5) * 0.7;
      const len = 0.22 + rand() * 0.20;
      const lat = 0.06 + rand() * 0.12;
      const dir = new T.Vector3(Math.cos(a) * lat, 1.0, Math.sin(a) * lat).normalize();
      const origin = new T.Vector3(Math.cos(a) * 0.04 * rand(), 0, Math.sin(a) * 0.04 * rand());
      const r0 = 0.007 + rand() * 0.005;
      const blade = buildWonkyChain({
        seedU32: seedU32 ^ (0xB1ADE + b * 7901),
        length: len, ringSegments: 6, radialSegments: 3,
        origin, direction: dir,
        bend: 0.5 + rand() * 0.4, wonk: 0.35, wonkScale: 2.0,
        twist: 0.1, curl: 0.4 + rand() * 0.35, gravityDir: DOWN,
        noiseAmt: 0.25, noiseScale: 1.5, noiseOctaves: 1,
        radiusFn: (t01) => Math.max(1e-4, r0 * (1.0 - t01 * 0.88))
      });
      geoms.push(blade.geom);
    }
    const group = new T.Group();
    if (geoms.length) {
      const merged = mergeGeoms(geoms); merged.computeVertexNormals();
      group.add(new T.Mesh(merged, hslMat(108, 0.58, 0.28)));
    }
    return group;
  }

  // ─── Shrub / tree (trunk + branching canopy) ──────────────────────────────
  function buildShrubGroup(seedU32) {
    const rand = mulberry32(seedU32);
    const DOWN = new T.Vector3(0, -1, 0);
    const UP   = new T.Vector3(0,  1, 0);
    const RADIAL = 5;
    const trunkLen = 0.38 + rand() * 0.28;
    const trunkRad = 0.045 + rand() * 0.02;
    const trunk = buildWonkyChain({
      seedU32: seedU32 ^ 0xA11CE, length: trunkLen,
      ringSegments: 8, radialSegments: RADIAL,
      origin: new T.Vector3(0, 0, 0), direction: UP,
      bend: 0.12 + rand() * 0.08, wonk: 0.1, wonkScale: 2.0, twist: 0.25, curl: 0,
      noiseAmt: 0.3, noiseScale: 2.0, noiseOctaves: 1, gravityDir: DOWN,
      radiusFn: (t01) => Math.max(1e-4, trunkRad * (1.0 - t01 * 0.60))
    });
    const woodGeoms = [trunk.geom];
    const leafGeoms = [];
    const trunkPts  = trunk.spine.pts;
    const trunkTans = trunk.spine.tangents;
    const BRANCH_COUNT = 7 + Math.floor(rand() * 5);
    for (let b = 0; b < BRANCH_COUNT; b++) {
      const tTier  = 0.35 + rand() * 0.65;
      const f      = tTier * (trunkPts.length - 1);
      const i0     = Math.max(0, Math.min(trunkPts.length - 2, Math.floor(f)));
      const alpha  = f - i0;
      const anchor = trunkPts[i0].clone().lerp(trunkPts[i0 + 1], alpha);
      const tanAt  = trunkTans[i0].clone().lerp(trunkTans[i0 + 1], alpha).normalize();
      let right = new T.Vector3().copy(tanAt).cross(UP);
      if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
      right.normalize();
      const upLocal = new T.Vector3().copy(right).cross(tanAt).normalize();
      const a = (b / BRANCH_COUNT) * Math.PI * 2 + (rand() - 0.5) * 0.55;
      const outward = new T.Vector3().addScaledVector(right, Math.cos(a)).addScaledVector(upLocal, Math.sin(a)).normalize();
      const dir = new T.Vector3().addScaledVector(outward, 1.0).addScaledVector(UP, 0.55 + rand() * 0.55).normalize();
      const bLen = 0.22 + rand() * 0.28;
      const bRad = trunkRad * (0.25 + rand() * 0.10);
      const attachR = trunkRad * (1.0 - tTier * 0.60);
      const origin = anchor.clone().addScaledVector(outward, Math.max(1e-4, attachR));
      const branch = buildWonkyChain({
        seedU32: seedU32 ^ (0xBEEF + b * 5003),
        length: bLen, ringSegments: 5, radialSegments: 4,
        origin, direction: dir,
        bend: 0.2, wonk: 0.4, wonkScale: 1.5, twist: 0.3, curl: 0.25,
        gravityDir: DOWN, noiseAmt: 0.35, noiseScale: 1.5, noiseOctaves: 1,
        radiusFn: (t01) => Math.max(1e-4, bRad * (1.0 - t01 * 0.82))
      });
      woodGeoms.push(branch.geom);
      const tip = branch.spine.pts[branch.spine.pts.length - 1];
      const leafR = 0.09 + rand() * 0.09;
      const sph = new T.SphereGeometry(leafR, 5, 4); sph.translate(tip.x, tip.y, tip.z); leafGeoms.push(sph);
      const bPts = branch.spine.pts;
      for (let li = Math.floor(bPts.length * 0.55); li < bPts.length - 1; li++) {
        if (rand() < 0.50) {
          const lr = 0.045 + rand() * 0.05;
          const lpt = bPts[li];
          const off = new T.Vector3((rand()-0.5)*0.07, 0.02+rand()*0.04, (rand()-0.5)*0.07);
          const sph2 = new T.SphereGeometry(lr, 4, 3); sph2.translate(lpt.x + off.x, lpt.y + off.y, lpt.z + off.z); leafGeoms.push(sph2);
        }
      }
    }
    const group = new T.Group();
    if (woodGeoms.length) { const merged = mergeGeoms(woodGeoms); merged.computeVertexNormals(); group.add(new T.Mesh(merged, hslMat(28, 0.40, 0.22))); }
    if (leafGeoms.length) { const merged = mergeGeoms(leafGeoms); merged.computeVertexNormals(); group.add(new T.Mesh(merged, hslMat(125, 0.55, 0.26))); }
    return group;
  }

  // ─── Boulder cluster (ROCK tiles) ────────────────────────────────────────
  function buildBoulderGroup(seedU32) {
    const rand = mulberry32(seedU32);
    const stoneCount = 3 + Math.floor(rand() * 3);
    const geoms = [];
    const mat4 = new T.Matrix4();
    const q = new T.Quaternion();
    for (let i = 0; i < stoneCount; i++) {
      const a = rand() * Math.PI * 2;
      const r = rand() * 0.26;
      const w = 0.22 + rand() * 0.32;
      const h = 0.20 + rand() * 0.32;
      const d = 0.22 + rand() * 0.30;
      const ox = Math.cos(a) * r, oz = Math.sin(a) * r;
      q.setFromEuler(new T.Euler((rand()-0.5)*0.35, rand()*Math.PI*2, (rand()-0.5)*0.35));
      mat4.compose(new T.Vector3(ox,h*0.5,oz),q,new T.Vector3(1,1,1));
      const geo = new T.BoxGeometry(w,h,d); geo.applyMatrix4(mat4); geoms.push(geo);
    }
    const group = new T.Group();
    if (geoms.length) { const merged=mergeGeoms(geoms); merged.computeVertexNormals(); group.add(new T.Mesh(merged,hslMat(210,0.06,0.46))); }
    return group;
  }

  // ─── Jungle tree (tall tropical, SHRUB tiles) ─────────────────────────────
  function buildJungleTreeGroup(seedU32) {
    const rand = mulberry32(seedU32);
    const DOWN = new T.Vector3(0, -1, 0);
    const UP = new T.Vector3(0, 1, 0);
    const RADIAL = 6;
    const trunkLen = 1.5 + rand() * 0.70;
    const trunkRad = 0.065 + rand() * 0.025;
    const trunk = buildWonkyChain({
      seedU32: seedU32 ^ 0xA11CE, length: trunkLen,
      ringSegments: 10, radialSegments: RADIAL,
      origin: new T.Vector3(0,0,0), direction: UP,
      bend: 0.07 + rand()*0.05, wonk: 0.08, wonkScale: 1.8,
      twist: 0.15, curl: 0, noiseAmt: 0.25, noiseScale: 1.8,
      noiseOctaves: 1, gravityDir: DOWN,
      radiusFn: (t01)=>Math.max(1e-4,trunkRad*(1.0-t01*0.55))
    });
    const woodGeoms=[trunk.geom], leafGeoms=[];
    const trunkPts=trunk.spine.pts, trunkTans=trunk.spine.tangents;
    const BRANCH_COUNT=5+Math.floor(rand()*4);
    for(let b=0;b<BRANCH_COUNT;b++){
      const tTier=0.70+rand()*0.30;
      const f=tTier*(trunkPts.length-1);
      const i0=Math.max(0,Math.min(trunkPts.length-2,Math.floor(f)));
      const alpha=f-i0;
      const anchor=trunkPts[i0].clone().lerp(trunkPts[i0+1],alpha);
      const tanAt=trunkTans[i0].clone().lerp(trunkTans[i0+1],alpha).normalize();
      let right=new T.Vector3().copy(tanAt).cross(UP); if(right.lengthSq()<1e-6) right.set(1,0,0); right.normalize();
      const upLocal=new T.Vector3().copy(right).cross(tanAt).normalize();
      const a=(b/BRANCH_COUNT)*Math.PI*2+(rand()-0.5)*0.4;
      const outward=new T.Vector3().addScaledVector(right,Math.cos(a)).addScaledVector(upLocal,Math.sin(a)).normalize();
      const dir=new T.Vector3().addScaledVector(outward,1.0).addScaledVector(UP,0.20+rand()*0.35).normalize();
      const bLen=0.35+rand()*0.40, bRad=trunkRad*(0.18+rand()*0.10), attachR=trunkRad*(1.0-tTier*0.55);
      const origin=anchor.clone().addScaledVector(outward,Math.max(1e-4,attachR));
      const branch=buildWonkyChain({seedU32:seedU32^(0xBEEF+b*5003),length:bLen,ringSegments:5,radialSegments:4,origin,direction:dir,bend:0.15,wonk:0.35,wonkScale:1.4,twist:0.2,curl:0.15,gravityDir:DOWN,noiseAmt:0.30,noiseScale:1.4,noiseOctaves:1,radiusFn:(t01)=>Math.max(1e-4,bRad*(1.0-t01*0.85))});
      woodGeoms.push(branch.geom);
      const tip=branch.spine.pts[branch.spine.pts.length-1];
      const leafR=0.14+rand()*0.12; const sph=new T.SphereGeometry(leafR,6,5); sph.translate(tip.x,tip.y,tip.z); leafGeoms.push(sph);
      const bPts=branch.spine.pts;
      for(let li=Math.floor(bPts.length*0.5);li<bPts.length-1;li++) if(rand()<0.55){const lr=0.07+rand()*0.07,lpt=bPts[li],off=new T.Vector3((rand()-0.5)*0.08,0.02+rand()*0.05,(rand()-0.5)*0.08),sph2=new T.SphereGeometry(lr,5,4);sph2.translate(lpt.x+off.x,lpt.y+off.y,lpt.z+off.z);leafGeoms.push(sph2);}
    }
    const group=new T.Group();
    if(woodGeoms.length){const merged=mergeGeoms(woodGeoms);merged.computeVertexNormals();group.add(new T.Mesh(merged,hslMat(24,0.38,0.20)));}
    if(leafGeoms.length){const merged=mergeGeoms(leafGeoms);merged.computeVertexNormals();group.add(new T.Mesh(merged,hslMat(115,0.52,0.26)));}
    return group;
  }

  // ─── Procedural conifer/canopy trees ─────────────────────────────────────
  const TREE_PRESETS = {
    crownedPine: {
      variantSeedIndices: [245, 127, 149], radialSegments: 8, ringSegments: 12,
      trunkLength: 6.86, trunkRadius: 0.305, trunkTaper: 0.91, trunkBend: 1.02,
      trunkWonk: 0, trunkWonkScale: 6, trunkTwist: 1.78,
      trunkNoise: 0.39, trunkNoiseScale: 3.8, trunkNoiseOctaves: 2,
      rootsEnabled: true, rootCount: 6, rootLength: 2.06, rootRadius: 0.164,
      rootTaper: 0.922, rootSpread: 0.9, rootCurl: 0.28, rootWonk: 0.28,
      knotEnabled: true, knotAt: 0.654, knotTiers: 5, knotTierSpacing: 0.133,
      knotTierLengthDelta: 0, knotTierRadiusDelta: 0, branchArchExtra: 0.35,
      knotCount: 5, knotLength: 2.66, knotLengthJitter: 0.75, knotRadius: 0.104, knotTaper: 0.926,
      knotUpDownBias: -0.63, knotCurl: 0.76, knotWonk: 0,
      leafWidth: 1.75, leafLength: 2, leafOffsetX: 0, leafOffsetY: -0.5, leafOffsetZ: 0,
      leafAlong01: 0.5, leafYawDeg: 180, leafPitchDeg: 0, leafRollDeg: -15,
      leafSurfaceClearance: 0.01, leafStemUp: false, trunkRollBiasDist: 0.25,
      leafTintH: 115, leafTintS: 0.55, leafTintL: 0.35, leafOpacity: 0.92, leafAlphaCutoff: 0.5,
      barkColorHex: 0x4a3b33, leafTexture: 'assets/leaves/leaves_crowned_pine.png', scaleMul: 0.75
    },
    shadewood: {
      radialSegments: 8, ringSegments: 10,
      trunkLength: 30, trunkRadius: 0.6, trunkTaper: 0.92, trunkBend: 0.55,
      trunkWonk: 0.85, trunkWonkScale: 1.6, trunkTwist: 0.7,
      trunkNoise: 0.9, trunkNoiseScale: 2.2, trunkNoiseOctaves: 3,
      rootsEnabled: true, rootCount: 9, rootLength: 2.2, rootRadius: 0.14,
      rootTaper: 0.78, rootSpread: 1.25, rootCurl: 0.1, rootWonk: 0.55,
      knotEnabled: true, knotAt: 0.8, knotTiers: 3, knotTierSpacing: 0.08,
      knotTierLengthDelta: 0.75, knotTierRadiusDelta: -0.3, branchArchExtra: 0.5,
      knotCount: 5, knotLength: 3.5, knotRadius: 0.4, knotTaper: 0.82,
      knotUpDownBias: -0.2, knotCurl: 1, knotWonk: 0.55,
      leafWidth: 5, leafOffsetX: 0, leafOffsetY: -0.9, leafOffsetZ: 0,
      leafAlong01: 0.88, leafYawDeg: 0, leafPitchDeg: 180, leafRollDeg: 0,
      leafPrismLengthOffset: 5.5, leafSurfaceClearance: 0.02, leafStemUp: true, trunkRollBiasDist: 0.25,
      leafTintH: 115, leafTintS: 0.55, leafTintL: 0.35, leafOpacity: 1, leafAlphaCutoff: 0.5,
      barkColorHex: 0x4a3b33, leafTexture: 'assets/leaves/leaves_shadewood.png',
      vinesEnabled: true, vineStrandCount: 5, vineTop01: 0.92, vineBottom01: 0.08, vineWraps: 2.2,
      vineSurfaceOffset: 0.05, vineHangLength: 5, vineHangWobble: 0.5,
      vineTubeRadius: 0.06, vineTubeTaper: 0.55, vineRadialSegments: 5,
      vineNoise: 0.35, vineNoiseScale: 1.4, vineNoiseOctaves: 2, vineColorHex: 0x3a5f3a,
      climbBranchChance: 0.17, climbBranchAt: 0.42, climbBranchLength: 7.5, climbBranchRadius: 0.55,
      scaleMul: 0.38
    },
    bush: {
      radialSegments: 6, ringSegments: 8,
      trunkLength: 0.55, trunkRadius: 0.08, trunkTaper: 0.90, trunkBend: 0.65,
      trunkWonk: 0.55, trunkWonkScale: 1.35, trunkTwist: 0.55,
      trunkNoise: 0.55, trunkNoiseScale: 2.2, trunkNoiseOctaves: 3,
      rootsEnabled: false,
      knotEnabled: true, knotAt: 0.18, knotTiers: 2, knotTierSpacing: 0.06,
      knotCount: 14, knotLength: 0.65, knotRadius: 0.045, knotTaper: 0.82,
      knotUpDownBias: 0.35, knotCurl: 0.25, knotWonk: 0.55,
      leavesPerBranch: 7, leafAlong01: 0.55, leafLength: 0.85, leafWidth: 0.42,
      leafRandYawDeg: 180, leafRandPitchDeg: 55, leafRandRollDeg: 30,
      leafRadial: 0.18, leafAttachToSurface: true, leafSurfaceClearance: 0.02,
      leafSurfaceStackStep: 0.06, leafSpread: 1.0,
      leafJitterAlong: 0.12, leafJitterSide: 0.05, leafJitterNormal: 0.08,
      leafBottomFacesTrunk: true, leafOffsetX: 0, leafOffsetY: 0, leafOffsetZ: 0,
      leafYawDeg: 0, leafPitchDeg: 0, leafRollDeg: 0,
      leafStemUp: true, trunkRollBiasDist: 0.25,
      leafTintH: 115, leafTintS: 0.55, leafTintL: 0.35, leafOpacity: 1,
      barkColorHex: 0x4a3b33, leafTexture: 'assets/leaves/leaf_1.png', scaleMul: 1, variantCount: 8
    },
    stump: {
      radialSegments: 6, ringSegments: 6,
      trunkLength: 0.85, trunkRadius: 0.42, trunkTaper: 0.92,
      trunkBend: 0.2, trunkWonk: 0.55, trunkWonkScale: 1.35, trunkTwist: 0.2,
      trunkNoise: 0.55, trunkNoiseScale: 2.2, trunkNoiseOctaves: 3,
      rootsEnabled: true, rootCount: 6, rootLength: 0.75, rootRadius: 0.17,
      rootTaper: 0.78, rootSpread: 0.9, rootCurl: 0.55, rootWonk: 0.55,
      knotEnabled: false, capTop: true, barkColorHex: 0x4a3b33, scaleMul: 1
    }
  };

  function buildConiferTreeGroup(preset, seedU32) {
    const rand = mulberry32(seedU32);
    const DOWN = new T.Vector3(0, -1, 0);
    const UP   = new T.Vector3(0,  1, 0);
    const RADIAL = Math.max(4, Math.floor(preset.radialSegments));
    const RINGS  = Math.max(2, Math.floor(preset.ringSegments));
    const taper  = clamp(preset.trunkTaper, 0.45, 0.9995);
    const trunkLenMul  = 1 + (rand() - 0.5) * 0.30;
    const trunkRadMul  = 1 + (rand() - 0.5) * 0.16;
    const branchLenMul = 1 + (rand() - 0.5) * 0.36;
    const instScale     = 1 + (rand() - 0.5) * 0.14;
    const instYaw       = rand() * Math.PI * 2;
    const woodGeoms = [], leafGeoms = [], vineGeoms = [];
    let climbBranchLocal = null;
    let climbBranchGeom = null;
    const unitLeaf = new T.PlaneGeometry(1, 1, 1, 1);

    const trunkLen = Math.max(1e-4, preset.trunkLength * trunkLenMul);
    const trunkRad = Math.max(1e-4, preset.trunkRadius * trunkRadMul);
    const trunk = buildWonkyChain({
      seedU32: seedU32 ^ 0xA11CE, length: trunkLen,
      ringSegments: RINGS, radialSegments: RADIAL,
      origin: new T.Vector3(0, 0, 0), direction: UP,
      bend: clamp(preset.trunkBend, 0, 2), wonk: clamp(preset.trunkWonk, 0, 2),
      wonkScale: Math.max(0.05, preset.trunkWonkScale), twist: clamp(preset.trunkTwist, 0, 2),
      noiseAmt: clamp(preset.trunkNoise, 0, 2), noiseScale: Math.max(0.05, preset.trunkNoiseScale),
      noiseOctaves: preset.trunkNoiseOctaves, gravityDir: DOWN, curl: 0,
      capEnd: !!preset.capTop,
      radiusFn: (t01) => Math.max(1e-4, trunkRad * Math.pow(taper, t01 * RINGS))
    });
    woodGeoms.push(trunk.geom);

    if (preset.rootsEnabled) {
      const count = Math.max(0, Math.floor(preset.rootCount));
      const rootRings = Math.max(4, Math.floor(RINGS * 0.85));
      const rootTaperPR = clamp(preset.rootTaper, 0.4, 0.999);
      const baseN = trunk.spine.normals[0], baseB = trunk.spine.binormals[0], baseT = trunk.spine.tangents[0];
      for (let i = 0; i < count; i++) {
        const ang=(i/Math.max(1,count))*Math.PI*2+(rand()-0.5)*0.35;
        const spread=preset.rootSpread*(0.55+0.65*rand());
        const outward=baseN.clone().multiplyScalar(Math.cos(ang)).addScaledVector(baseB,Math.sin(ang)).normalize();
        const attachR=trunkRad*(0.98+0.06*rand());
        const origin=trunk.spine.pts[0].clone().addScaledVector(outward,attachR).addScaledVector(baseT,(rand()-0.5)*0.03);
        const dir=outward.clone().multiplyScalar(1.0+spread).add(new T.Vector3(0,-(0.16+0.10*rand()),0)).normalize();
        const rootBaseRadius=Math.max(preset.rootRadius*(0.75+0.55*rand()),attachR*0.6);
        const rampRings=Math.max(1,Math.floor(rootRings*0.22));
        const root=buildWonkyChain({seedU32:seedU32^(0xB00B1E+i*1337),length:preset.rootLength*(0.75+0.6*rand()),ringSegments:rootRings,radialSegments:RADIAL,origin,direction:dir,bend:clamp(preset.trunkBend*0.35,0,2),wonk:clamp(preset.rootWonk,0,2),wonkScale:Math.max(0.05,preset.trunkWonkScale*1.2),twist:clamp(preset.trunkTwist*0.6,0,2),noiseAmt:clamp(preset.trunkNoise*0.85,0,2),noiseScale:Math.max(0.05,preset.trunkNoiseScale*1.15),noiseOctaves:preset.trunkNoiseOctaves,gravityDir:DOWN,curl:clamp(preset.rootCurl,0,2),radiusFn:(t01,ringIdx)=>{const s=clamp01(ringIdx/rampRings),smooth=s*s*(3-2*s),blended=attachR+(rootBaseRadius-attachR)*smooth,taperExp=Math.max(0,ringIdx-rampRings);return Math.max(1e-4,blended*Math.pow(rootTaperPR,taperExp));}});
        woodGeoms.push(root.geom);
      }
    }

    if (preset.knotEnabled) {
      const trunkPts=trunk.spine.pts,trunkTans=trunk.spine.tangents;
      const tiers=Math.max(1,Math.min(8,Math.floor(preset.knotTiers)));
      const spacing=clamp(preset.knotTierSpacing,0,0.5),dLen=clamp(preset.knotTierLengthDelta??0,-0.75,0.75),dRad=clamp(preset.knotTierRadiusDelta??0,-0.75,0.75);
      const center=clamp01(preset.knotAt),halfSpan=tiers<=1?0:spacing*((tiers-1)*0.5),startAt=clamp01(center-halfSpan),endAt=clamp01(center+halfSpan);
      const baseCurl=clamp(preset.knotCurl??0.25,0,2),baseBias=clamp(preset.knotUpDownBias,-1,1),knotTaperPR=clamp(preset.knotTaper,0.4,0.999),biasVec=baseBias>=0?UP:DOWN,biasAmt=Math.abs(baseBias);
      const branchSegs=[];
      for(let tier=0;tier<tiers;tier++){
        const tTier=tiers<=1?0:tier/(tiers-1),tierAt=tiers<=1?center:lerp(startAt,endAt,tTier),f=clamp01(tierAt)*(trunkPts.length-1),i0=Math.max(0,Math.min(trunkPts.length-2,Math.floor(f))),alpha=f-i0;
        const anchor=trunkPts[i0].clone().lerp(trunkPts[i0+1],alpha),tan=trunkTans[i0].clone().lerp(trunkTans[i0+1],alpha).normalize();
        let right=new T.Vector3().copy(tan).cross(UP);if(right.lengthSq()<1e-6)right.set(1,0,0);right.normalize();const up=new T.Vector3().copy(right).cross(tan).normalize();
        const tierLenScale=clamp(lerp(1.0,1.0+dLen,tTier),0.15,3.0),tierRadScale=clamp(lerp(1.0,1.0+dRad,tTier),0.15,3.0),attachR=Math.max(1e-4,trunkRad*Math.pow(taper,tierAt*RINGS));
        const count=Math.max(0,Math.floor(preset.knotCount));
        for(let i=0;i<count;i++){
          const a=(i/Math.max(1,count))*Math.PI*2+(rand()-0.5)*0.4;
          const outward=new T.Vector3().addScaledVector(right,Math.cos(a)).addScaledVector(up,Math.sin(a)).normalize();
          const dir=new T.Vector3().addScaledVector(outward,1.0).addScaledVector(biasVec,biasAmt*1.35).addScaledVector(tan,0.15).normalize();dir.add(new T.Vector3((rand()-0.5)*0.12,(rand()-0.5)*0.10,(rand()-0.5)*0.12)).normalize();
          const origin=anchor.clone().addScaledVector(outward,attachR).addScaledVector(tan,(rand()-0.5)*0.03);
          const lenJitterRaw=preset.knotLengthJitter,lenRandBase=0.55+0.95*rand(),lenRand=lenJitterRaw!=null?lerp(1.0,lenRandBase*(0.95+0.7*rand()),clamp(lenJitterRaw,0,1)):lenRandBase;
          const branchLen=Math.max(1e-4,preset.knotLength*branchLenMul*tierLenScale*lenRand),branchRad=Math.max(1e-4,preset.knotRadius*tierRadScale*(0.75+0.5*rand())),branchRings=Math.max(4,Math.floor(RINGS*0.75));
          const knot=buildWonkyChain({seedU32:seedU32^(0xC0FFEE+tier*1009+i*271),length:branchLen,ringSegments:branchRings,radialSegments:RADIAL,origin,direction:dir,bend:clamp(preset.trunkBend*0.25,0,2),wonk:clamp(preset.knotWonk,0,2),wonkScale:Math.max(0.05,preset.trunkWonkScale*1.25),twist:clamp(preset.trunkTwist*0.7,0,2),noiseAmt:clamp(preset.trunkNoise*0.9,0,2),noiseScale:Math.max(0.05,preset.trunkNoiseScale*1.15),noiseOctaves:preset.trunkNoiseOctaves,gravityDir:DOWN,curl:clamp(baseCurl+(preset.branchArchExtra||0),0,2),radiusFn:(t01,ringIdx)=>Math.max(1e-4,branchRad*Math.pow(knotTaperPR,ringIdx))});
          woodGeoms.push(knot.geom);const tip=knot.spine.pts[knot.spine.pts.length-1].clone();branchSegs.push({a:origin.clone(),b:tip,baseRadius:branchRad,taperPerRing:knotTaperPR,rings:Math.max(1,knot.spine.pts.length-1)});
        }
      }
      if(preset.vinesEnabled){
        const strandCount=Math.max(0,Math.floor(preset.vineStrandCount??0)),n=trunk.spine.pts.length,startIdx=clamp(Math.round(clamp01(preset.vineTop01??0.95)*(n-1)),0,n-1),endIdx=clamp(Math.round(clamp01(preset.vineBottom01??0.05)*(n-1)),0,n-1),vineRadial=Math.max(3,Math.floor(preset.vineRadialSegments??5)),controlCount=Math.max(8,Math.min(36,Math.floor(vineRadial*2.8))),sampleCount=Math.max(18,vineRadial*6),wrapsBase=Math.max(0,preset.vineWraps??1.5),surfaceOffset=Math.max(0,preset.vineSurfaceOffset??0.03),tailLenBase=Math.max(0,preset.vineHangLength??0),tailWobble=Math.max(0,preset.vineHangWobble??0.15),trunkRadiusAt=(idx)=>trunkRad*Math.pow(taper,clamp(idx,0,n-1)),DOWN2=new T.Vector3(0,-1,0);
        for(let si=0;si<strandCount;si++){
          const phi0=rand()*Math.PI*2,wraps=wrapsBase*(0.8+0.5*rand()),cps=[];
          for(let k=0;k<=controlCount;k++){const u=k/controlCount,idx=clamp(Math.round(lerp(startIdx,endIdx,u)),0,n-1),centerP=trunk.spine.pts[idx],NN=trunk.spine.normals[idx],BB=trunk.spine.binormals[idx],phi=phi0+Math.PI*2*wraps*u,outward=new T.Vector3().copy(NN).multiplyScalar(Math.cos(phi)).addScaledVector(BB,Math.sin(phi)).normalize(),rr=trunkRadiusAt(idx)+surfaceOffset,p=centerP.clone().addScaledVector(outward,rr),wob=tailWobble*0.15;p.addScaledVector(outward,(rand()-0.5)*wob);p.addScaledVector(trunk.spine.tangents[idx],(rand()-0.5)*wob*0.15);cps.push(p);}
          const tailLen=tailLenBase*(0.65+0.7*rand());if(tailLen>1e-4){const endCenter=trunk.spine.pts[endIdx],endN=trunk.spine.normals[endIdx],endB=trunk.spine.binormals[endIdx],phiEnd=phi0+Math.PI*2*wraps,outwardEnd=new T.Vector3().copy(endN).multiplyScalar(Math.cos(phiEnd)).addScaledVector(endB,Math.sin(phiEnd)).normalize(),baseP=endCenter.clone().addScaledVector(outwardEnd,trunkRadiusAt(endIdx)+surfaceOffset),tailSteps=4;for(let s=1;s<=tailSteps;s++){const tu=s/tailSteps,p=baseP.clone().addScaledVector(DOWN2,tailLen*tu).addScaledVector(outwardEnd,Math.sin(tu*Math.PI)*tailWobble*0.35).addScaledVector(endB,(rand()-0.5)*tailWobble*0.18);cps.push(p);}}
          const curve=new T.CatmullRomCurve3(cps,false,'catmullrom',0.5),sampled=curve.getPoints(sampleCount),vineSpine=framesFromPoints(sampled),baseR=Math.max(1e-4,preset.vineTubeRadius??0.035),taperEnd=clamp(preset.vineTubeTaper??0.7,0.05,1);
          vineGeoms.push(buildMeshFromSpineWithRadiusFn({seedU32:seedU32^(0xA57E1E+si*113),spine:vineSpine,radiusFn:(t01)=>baseR*lerp(1,taperEnd,clamp01(t01)),radialSegments:vineRadial,twist:0,noiseAmt:clamp(preset.vineNoise??0.3,0,2),noiseScale:Math.max(0.05,preset.vineNoiseScale??1.2),noiseOctaves:Math.max(1,Math.floor(preset.vineNoiseOctaves??2))}));
        }
      }
      if(branchSegs.length){
        const rollBiasDist=preset.trunkRollBiasDist??0.25,firstOrigin=branchSegs[0].a;let nearestIdx=0,bestD2=Infinity;for(let ti=0;ti<trunkPts.length;ti++){const d2=trunkPts[ti].distanceToSquared(firstOrigin);if(d2<bestD2){bestD2=d2;nearestIdx=ti;}}
        const trunkDirAtBase=trunkTans[nearestIdx],trunkPRef=firstOrigin.clone().addScaledVector(trunkDirAtBase,-rollBiasDist),leavesPerBranch=Math.max(0,Math.floor(preset.leavesPerBranch??1));
        for(const seg of branchSegs){const {a:origin,b:tip,baseRadius:branchRad,taperPerRing:segTaper,rings:segRings}=seg,distL=Math.max(1e-4,origin.distanceTo(tip)),mid=origin.clone().add(tip).multiplyScalar(0.5),z=tip.clone().sub(origin).normalize();let yAx=trunkPRef.clone().sub(mid),d=yAx.dot(z);yAx.addScaledVector(z,-d);if(yAx.lengthSq()<1e-8){yAx=UP.clone();d=yAx.dot(z);yAx.addScaledVector(z,-d);}if(yAx.lengthSq()<1e-8)yAx.set(1,0,0);yAx.normalize();const xAx=new T.Vector3().crossVectors(yAx,z).normalize();yAx.crossVectors(z,xAx).normalize();const basisM=new T.Matrix4().makeBasis(xAx,yAx,z),prismQuat=new T.Quaternion().setFromRotationMatrix(basisM),surfaceRadiusAt=(zLocal)=>{const t01=clamp01((zLocal/distL)+0.5);return branchRad*Math.pow(segTaper,t01*segRings);},placeLeafCard=(localPos,localEuler,scaleY)=>{const localQuat=new T.Quaternion().setFromEuler(localEuler),worldQuat=prismQuat.clone().multiply(localQuat),worldPos=mid.clone().add(localPos.clone().applyQuaternion(prismQuat)),m=new T.Matrix4().compose(worldPos,worldQuat,new T.Vector3(preset.leafWidth,scaleY,1)),g=unitLeaf.clone();g.applyMatrix4(m);leafGeoms.push(g);};
          if(leavesPerBranch<=1){const zBase=lerp(-distL*0.5,distL*0.5,clamp01(preset.leafAlong01??0.5)),surfR=surfaceRadiusAt(zBase),localPos=new T.Vector3((preset.leafOffsetX||0),surfR+Math.max(0,preset.leafSurfaceClearance||0)+(preset.leafOffsetY||0),zBase+(preset.leafOffsetZ||0)),localEuler=new T.Euler(Math.PI*0.5+degToRad(preset.leafPitchDeg||0),degToRad(preset.leafYawDeg||0),degToRad(preset.leafRollDeg||0),'XYZ'),singleLeafLength=Math.max(1e-4,distL+(preset.leafPrismLengthOffset||0)),scaleY=preset.leafStemUp!==false?-singleLeafLength:singleLeafLength;placeLeafCard(localPos,localEuler,scaleY);}else{const zBase=lerp(-distL*0.5,distL*0.5,clamp01(preset.leafAlong01??0.72)),spread=Number.isFinite(preset.leafSpread)?preset.leafSpread:1.0,baseLeafLength=preset.leafLength||0.5;for(let k=0;k<leavesPerBranch;k++){const localPos=new T.Vector3(0,0,zBase);let sideIndex=0;if(k>0){const step=Math.ceil(k/2);sideIndex=(k%2===1)?-step:step;}let radial=Number.isFinite(preset.leafRadial)?preset.leafRadial:0.18;if(preset.leafAttachToSurface!==false){const rSurf=surfaceRadiusAt(localPos.z),base=rSurf+Math.max(0,preset.leafSurfaceClearance||0),stack=Math.max(0,preset.leafSurfaceStackStep||0),extra=Math.max(0,Math.abs(sideIndex)-1)*stack;radial=base+extra;}localPos.x=sideIndex*radial;if(k>0){localPos.z+=(rand()-0.5)*(preset.leafJitterAlong??0.12);localPos.x+=(rand()-0.5)*(preset.leafJitterSide??0.05)*spread;localPos.y+=(rand()-0.5)*(preset.leafJitterNormal??0.08)*spread;}localPos.x+=preset.leafOffsetX||0;localPos.y+=preset.leafOffsetY||0;localPos.z+=preset.leafOffsetZ||0;const yawJ=(k===0)?0:(rand()*2-1)*degToRad(preset.leafRandYawDeg||0),pitchJ=(rand()*2-1)*degToRad(preset.leafRandPitchDeg||0),rollJ=(rand()*2-1)*degToRad(preset.leafRandRollDeg||0),localEuler=new T.Euler(degToRad(preset.leafPitchDeg||0)+pitchJ,degToRad(preset.leafYawDeg||0)+yawJ,degToRad(preset.leafRollDeg||0)+rollJ+(preset.leafBottomFacesTrunk!==false?Math.PI*0.5:0),'XYZ'),scaleY=preset.leafStemUp!==false?-baseLeafLength:baseLeafLength;placeLeafCard(localPos,localEuler,scaleY);}}
        }
      }
    }

    if(preset.climbBranchChance>0){const at=clamp01(preset.climbBranchAt??0.45),f=at*(trunk.spine.pts.length-1),i0=Math.max(0,Math.min(trunk.spine.pts.length-2,Math.floor(f))),alpha=f-i0,anchor=trunk.spine.pts[i0].clone().lerp(trunk.spine.pts[i0+1],alpha),tan=trunk.spine.tangents[i0].clone().lerp(trunk.spine.tangents[i0+1],alpha).normalize();let right=new T.Vector3().copy(tan).cross(UP);if(right.lengthSq()<1e-6)right.set(1,0,0);right.normalize();if(rand()<0.5)right.negate();const attachR=Math.max(1e-4,trunkRad*Math.pow(taper,at*RINGS)),dir=right.clone().addScaledVector(tan,0.08).addScaledVector(UP,0.05).normalize(),origin=anchor.clone().addScaledVector(right,attachR),branchLen=Math.max(1e-4,(preset.climbBranchLength??7)*(0.85+0.3*rand())),branchRad=Math.max(1e-4,preset.climbBranchRadius??0.55),climbBranch=buildWonkyChain({seedU32:seedU32^0xC1113B,length:branchLen,ringSegments:Math.max(4,Math.floor(RINGS*0.75)),radialSegments:RADIAL,origin,direction:dir,bend:clamp(preset.trunkBend*0.15,0,2),wonk:clamp((preset.knotWonk??0.5)*0.4,0,2),wonkScale:Math.max(0.05,preset.trunkWonkScale),twist:0,noiseAmt:clamp((preset.trunkNoise??0.5)*0.3,0,2),noiseScale:Math.max(0.05,preset.trunkNoiseScale),noiseOctaves:preset.trunkNoiseOctaves,gravityDir:DOWN,curl:0,radiusFn:(t01,ringIdx)=>Math.max(1e-4,branchRad*Math.pow(0.9,ringIdx))});climbBranchGeom=climbBranch.geom;const tip=climbBranch.spine.pts[climbBranch.spine.pts.length-1];climbBranchLocal={a:{x:origin.x,y:origin.y,z:origin.z},b:{x:tip.x,y:tip.y,z:tip.z},radius:branchRad};}

    const group=new T.Group();
    if(woodGeoms.length){const merged=mergeGeoms(woodGeoms);merged.computeVertexNormals();group.add(new T.Mesh(merged,hexBarkMat(preset.barkColorHex??0x4a3b33)));}
    if(climbBranchGeom){climbBranchGeom.computeVertexNormals();const climbBranchMesh=new T.Mesh(climbBranchGeom,hexBarkMat(preset.barkColorHex??0x4a3b33));climbBranchMesh.name='climbBranch';group.add(climbBranchMesh);}
    if(vineGeoms.length){const merged=mergeGeoms(vineGeoms);merged.computeVertexNormals();group.add(new T.Mesh(merged,hexBarkMat(preset.vineColorHex??0x3a5f3a)));}
    if(leafGeoms.length){const merged=mergeGeomsWithUV(leafGeoms),leafMesh=new T.Mesh(merged,getLeafCardMaterial(preset));leafMesh.userData.noOutline=true;group.add(leafMesh);}
    unitLeaf.dispose();group.rotation.y=instYaw;group.scale.setScalar(instScale*(preset.scaleMul??1));if(climbBranchLocal)group.userData.climbBranchLocal=climbBranchLocal;return group;
  }

  const TREE_VARIANT_COUNT = 3;
  const _treeVariantCache = new Map();
  function getTreeVariants(presetKey,preset){let variants=_treeVariantCache.get(presetKey);if(variants)return variants;variants=[];const variantCount=Math.max(1,Number(preset.variantCount)||TREE_VARIANT_COUNT);for(let i=0;i<variantCount;i++){const variantIdx=preset.variantSeedIndices?.[i]??i,variantSeed=xfnv1a(`${presetKey}_variant_${variantIdx}`)>>>0,group=buildConiferTreeGroup(preset,variantSeed),leafMesh=group.children[group.children.length-1];if(leafMesh&&leafMesh.geometry&&leafMesh!==group.children[0]){leafMesh.geometry.computeBoundingBox();const bb=leafMesh.geometry.boundingBox;group.userData.canopyLocal={radius:Math.max(Math.abs(bb.min.x),Math.abs(bb.max.x),Math.abs(bb.min.z),Math.abs(bb.max.z)),undersideY:bb.min.y};}variants.push(group);}_treeVariantCache.set(presetKey,variants);return variants;}
  function buildTreeInstance(presetKey,preset,seedU32,opts){const variants=getTreeVariants(presetKey,preset),rand=mulberry32(seedU32),variantIndex=Math.floor(rand()*variants.length)%variants.length,variant=variants[variantIndex],inst=variant.clone(),instScale=1+(rand()-0.5)*0.14,instYaw=rand()*Math.PI*2;inst.rotation.y=instYaw;inst.scale.setScalar(instScale*(preset.scaleMul??1));if(variant.userData.canopyLocal)inst.userData.canopyLocal=variant.userData.canopyLocal;if(variant.userData.climbBranchLocal){const keep=opts?.forceClimbBranch||rand()<(preset.climbBranchChance??0);if(!keep){delete inst.userData.climbBranchLocal;const branchMesh=inst.getObjectByName?.('climbBranch');if(branchMesh)branchMesh.visible=false;}else{const branchMesh=inst.getObjectByName?.('climbBranch');if(branchMesh)branchMesh.userData={...(branchMesh.userData||{}),isClimbBranch:true,climbBranchLocal:variant.userData.climbBranchLocal};}}return inst;}

  function getClimbBranchWorld(inst){const local=inst.userData?.climbBranchLocal;if(!local)return null;const yaw=inst.rotation.y,scale=inst.scale.x,cos=Math.cos(yaw),sin=Math.sin(yaw),toWorld=(p)=>({x:inst.position.x+(p.x*cos+p.z*sin)*scale,y:inst.position.y+p.y*scale,z:inst.position.z+(-p.x*sin+p.z*cos)*scale});return{a:toWorld(local.a),b:toWorld(local.b),radius:local.radius*scale};}
  function degToRad(d){return d*Math.PI/180;}

  // ─── Public API ───────────────────────────────────────────────────────────
  return {
    getClimbBranchWorld,
    buildLogMesh(options) { return buildLogGroup(options); },
    buildNeedlegrainMesh(growth01,col,row){const seedU32=xfnv1a(`ng_${col}_${row}`);return buildNeedlegrainGroup(growth01,seedU32);},
    buildHeftrootMesh(growth01,col,row){const seedU32=xfnv1a(`hr_${col}_${row}`);return buildHeftrootGroup(growth01,seedU32);},
    buildWeedsMesh(col,row){const seedU32=xfnv1a(`wd_${col}_${row}`);return buildWeedsGroup(seedU32);},
    buildShrubMesh(col,row){const seedU32=xfnv1a(`sh_${col}_${row}`);return buildTreeInstance('bush',TREE_PRESETS.bush,seedU32);},
    buildBoulderMesh(col,row){const seedU32=xfnv1a(`bld_${col}_${row}`);return buildBoulderGroup(seedU32);},
    buildJungleTreeMesh(col,row){const seedU32=xfnv1a(`jt_${col}_${row}`);return buildJungleTreeGroup(seedU32);},
    buildCrownedPineMesh(col,row){const seedU32=xfnv1a(`cp_${col}_${row}`);return buildTreeInstance('crownedPine',TREE_PRESETS.crownedPine,seedU32);},
    buildShadewoodMesh(col,row,opts){const seedU32=xfnv1a(`sw_${col}_${row}`);return buildTreeInstance('shadewood',TREE_PRESETS.shadewood,seedU32,opts);},
    buildWildernessBushMesh(col,row){const seedU32=xfnv1a(`wb_${col}_${row}`);return buildTreeInstance('bush',TREE_PRESETS.bush,seedU32);},
    buildStumpMesh(col,row){const seedU32=xfnv1a(`st_${col}_${row}`);return buildTreeInstance('stump',TREE_PRESETS.stump,seedU32);}
  };
})();
