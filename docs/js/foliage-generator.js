// Procedural crop geometry for HobunjiHollow.
// Generates Three.js meshes for needlegrain (NeedleShrub) and heftroot (RootTuber).
// Depends on THREE being a global (loaded via CDN before this script).

window.FoliageGenerator = (function createFoliageGenerator(T, naturalSurfaces) {
  const runtimeInstances = new WeakMap(); // Reuse editor-native builders without changing window.THREE or the game's generator.

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
  function buildMeshFromSpineWithRadiusFn({ seedU32, spine, radiusFn, radialSegments, twist, noiseAmt, noiseScale, noiseOctaves, stretchUv = false }) {
    const { pts, tangents, normals, binormals } = spine;
    const rings = pts.length;
    const radial = Math.max(3, Math.floor(radialSegments));
    const positions = [], indices = [], uvs = []; // Optional per-strand PNG coordinates are separate from ordinary tree geometry.
    const stride = radial + (stretchUv ? 1 : 0); // Duplicate the seam only for textured growth, keeping the existing tree topology intact.
    const TT = new T.Vector3(), N = new T.Vector3(), B = new T.Vector3();

    for (let i = 0; i < rings; i++) {
      const t = rings <= 1 ? 0 : i / (rings - 1);
      TT.copy(tangents[i]).normalize();
      N.copy(normals[i]); B.copy(binormals[i]);
      const twA = twist * (t * Math.PI * 2);
      N.applyAxisAngle(TT, twA); B.applyAxisAngle(TT, twA);
      const rBase = Math.max(1e-4, radiusFn(t, i, rings));
      const center = pts[i];

      for (let j = 0; j < stride; j++) {
        if (stretchUv) uvs.push(j / radial, t);
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
      const r0 = i * stride, r1 = (i + 1) * stride;
      for (let j = 0; j < radial; j++) {
        const next = stretchUv ? j + 1 : (j + 1) % radial; // Seam vertices sample opposite PNG edges without interpolating across its middle.
        const a0 = r0 + j, a1 = r0 + next;
        const b0 = r1 + j, b1 = r1 + next;
        indices.push(a0, a1, b0, b0, a1, b1);
      }
    }
    const geom = new T.BufferGeometry();
    geom.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    if (stretchUv) geom.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
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
      noiseAmt: opts.noiseAmt, noiseScale: opts.noiseScale, noiseOctaves: opts.noiseOctaves
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
      // Every leaf sprite here (leaf_1.png, leaves_crowned_pine.png,
      // leaves_shadewood.png, ...) has non-power-of-two dimensions, and the
      // default minFilter needs mipmaps — under WebGL1 (this game bundles
      // three.js r128) a mipmap-filtered NPOT texture is "incomplete" and the
      // whole thing renders solid black instead of erroring. The existing
      // grass_1.png billboard material already sidesteps this the same way.
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
      // Opaque alphaTest cutout, NOT alpha-blended — matches the source
      // tool's getLeafMaterial() exactly, comment and all: "Leaf art is a
      // binary cutout, not blended glass. This avoids transparent-card
      // sorting artifacts." Ours used to be transparent:true+depthWrite:
      // false, which in a real forest scene (dozens of trees' worth of leaf
      // cards, grass billboards, the occlusion-ghost system etc. all
      // competing in the same transparent render queue, sorted per-object
      // rather than per-triangle) let branches and other geometry behind a
      // leaf card show/bleed through it — invisible in a one-tree isolated
      // test scene, but exactly the "can I see branches through leaves in
      // a way the tool can't" artifact reported from actual gameplay.
      // preset.leafOpacity is intentionally NOT applied here: the tool's
      // own getLeafMaterial() hardcodes opacity to 1 regardless of that
      // param too (it only matters for asset types this port doesn't use).
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
  // Places thin cylinder needles along a branch spine and returns merged geom.
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

        // Mask: skip needles near top (0) and bottom (PI) of cross-section
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

        // Needle direction: mostly outward with slight along-branch component
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
  // Parameters derived from crop_needlegrain.json preset.
  function buildNeedlegrainGroup(growth01, seedU32) {
    const rand = mulberry32(seedU32);
    const g01  = clamp01(growth01);
    const gLen = lerp(0.25, 1.0, g01);  // length scale
    const gRad = lerp(0.40, 1.0, g01);  // radius scale

    const RADIAL = 5, RINGS = 7;
    const woodGeoms    = [];
    const needleGeoms  = [];
    const DOWN = new T.Vector3(0, -1, 0);
    const UP   = new T.Vector3(0,  1, 0);

    // Trunk (very short, thin)
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

    // 3 branch tiers (knotTiers=3, knotAt=0.157, knotTierSpacing=0.429)
    const TIERS = 3, KNOTS_PER_TIER = 6;
    const knotAt = 0.157, spacing = 0.429;
    const halfSpan = spacing * (TIERS - 1) * 0.5;
    const startAt  = clamp01(knotAt - halfSpan);
    const endAt    = clamp01(knotAt + halfSpan);

    const trunkPts  = trunk.spine.pts;
    const trunkTans = trunk.spine.tangents;

    // Linear delta params from JSON
    const dLen = -0.4275, dRad = -0.4232, dBias = 0.2775;

    for (let tier = 0; tier < TIERS; tier++) {
      const tTier  = TIERS <= 1 ? 0 : tier / (TIERS - 1);
      const tierAt = lerp(startAt, endAt, tTier);

      // Sample trunk spine at tierAt
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

        // Needles on this branch
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
      const mat = hslMat(30, 0.35, 0.25);   // dark warm brown bark
      group.add(new T.Mesh(merged, mat));
    }

    if (needleGeoms.length) {
      const merged = mergeGeoms(needleGeoms);
      merged.computeVertexNormals();
      // Stage-lerped needle color: dark olive green (from JSON needleColorStage0→1)
      const nL = lerp(0.17, 0.23, g01);
      const mat = hslMat(140, 0.50, nL);
      group.add(new T.Mesh(merged, mat));
    }

    return group;
  }

  // ─── Heftroot (RootTuber) ─────────────────────────────────────────────────
  // Tuber body emerging from soil + leafy green stems above.
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

    // Tuber body: originates at y=0, grows upward (visible above soil)
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

    // Tuber mesh (warm orange-brown)
    {
      tuberChain.geom.computeVertexNormals();
      const mat = hslMat(35, 0.55, 0.45);
      group.add(new T.Mesh(tuberChain.geom, mat));
    }

    // Stems emerging from top of tuber (green plant stems + small leaf spheres)
    const STEM_COUNT = Math.max(2, Math.floor(3 + rand() * 2));
    const stemLen    = 0.60 * gLen;
    const stemRad    = 0.016 * gRad;
    const stemGeoms  = [];
    const leafGeoms  = [];

    for (let s = 0; s < STEM_COUNT; s++) {
      const a  = rand() * Math.PI * 2;
      const rr = tuberWid * 0.4 * Math.sqrt(rand());
      const origin = tuberTop.clone();
      origin.x += Math.cos(a) * rr;
      origin.z += Math.sin(a) * rr;
      origin.y -= 0.015;

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

      // Small leaf sphere at tip
      const tip = stem.spine.pts[stem.spine.pts.length - 1];
      const leafR = (0.055 + 0.045 * rand()) * lerp(0.25, 1.0, g01);
      const leafGeom = new T.SphereGeometry(leafR, 5, 4);
      leafGeom.translate(tip.x, tip.y, tip.z);
      leafGeoms.push(leafGeom);

      // A few small secondary leaf spheres along upper stem
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
      const merged = mergeGeoms(stemGeoms);
      merged.computeVertexNormals();
      group.add(new T.Mesh(merged, hslMat(110, 0.55, 0.32)));
    }
    if (leafGeoms.length) {
      const merged = mergeGeoms(leafGeoms);
      merged.computeVertexNormals();
      group.add(new T.Mesh(merged, hslMat(115, 0.60, 0.38)));
    }

    return group;
  }

  // ─── Weeds (thin grass-blade cluster) ────────────────────────────────────
  function buildWeedsGroup(seedU32) {
    const rand = mulberry32(seedU32);
    const BLADE_COUNT = 5 + Math.floor(rand() * 4);
    const DOWN = new T.Vector3(0, -1, 0);
    const UP   = new T.Vector3(0,  1, 0);
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
      const merged = mergeGeoms(geoms);
      merged.computeVertexNormals();
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
      const outward = new T.Vector3()
        .addScaledVector(right,   Math.cos(a))
        .addScaledVector(upLocal, Math.sin(a))
        .normalize();

      const dir = new T.Vector3()
        .addScaledVector(outward, 1.0)
        .addScaledVector(UP, 0.55 + rand() * 0.55)
        .normalize();

      const bLen    = 0.22 + rand() * 0.28;
      const bRad    = trunkRad * (0.25 + rand() * 0.10);
      const attachR = trunkRad * (1.0 - tTier * 0.60);
      const origin  = anchor.clone().addScaledVector(outward, Math.max(1e-4, attachR));

      const branch = buildWonkyChain({
        seedU32: seedU32 ^ (0xBEEF + b * 5003),
        length: bLen, ringSegments: 5, radialSegments: 4,
        origin, direction: dir,
        bend: 0.2, wonk: 0.4, wonkScale: 1.5, twist: 0.3, curl: 0.25,
        gravityDir: DOWN, noiseAmt: 0.35, noiseScale: 1.5, noiseOctaves: 1,
        radiusFn: (t01) => Math.max(1e-4, bRad * (1.0 - t01 * 0.82))
      });
      woodGeoms.push(branch.geom);

      const tip   = branch.spine.pts[branch.spine.pts.length - 1];
      const leafR = 0.09 + rand() * 0.09;
      const sph   = new T.SphereGeometry(leafR, 5, 4);
      sph.translate(tip.x, tip.y, tip.z);
      leafGeoms.push(sph);

      const bPts = branch.spine.pts;
      for (let li = Math.floor(bPts.length * 0.55); li < bPts.length - 1; li++) {
        if (rand() < 0.50) {
          const lr   = 0.045 + rand() * 0.05;
          const lpt  = bPts[li];
          const off  = new T.Vector3((rand()-0.5)*0.07, 0.02+rand()*0.04, (rand()-0.5)*0.07);
          const sph2 = new T.SphereGeometry(lr, 4, 3);
          sph2.translate(lpt.x + off.x, lpt.y + off.y, lpt.z + off.z);
          leafGeoms.push(sph2);
        }
      }
    }

    const group = new T.Group();
    if (woodGeoms.length) {
      const merged = mergeGeoms(woodGeoms);
      merged.computeVertexNormals();
      group.add(new T.Mesh(merged, hslMat(28, 0.40, 0.22)));
    }
    if (leafGeoms.length) {
      const merged = mergeGeoms(leafGeoms);
      merged.computeVertexNormals();
      group.add(new T.Mesh(merged, hslMat(125, 0.55, 0.26)));
    }
    return group;
  }

  // ─── Boulder cluster (ROCK tiles) ────────────────────────────────────────
  function buildBoulderGroup(seedU32) {
    const rand = mulberry32(seedU32);
    const stoneCount = 3 + Math.floor(rand() * 3);
    const geoms = [];
    const mat4 = new T.Matrix4();
    const q    = new T.Quaternion();

    for (let i = 0; i < stoneCount; i++) {
      const a  = rand() * Math.PI * 2;
      const r  = rand() * 0.26;
      const w  = 0.22 + rand() * 0.32;
      const h  = 0.20 + rand() * 0.32;
      const d  = 0.22 + rand() * 0.30;
      const ox = Math.cos(a) * r;
      const oz = Math.sin(a) * r;
      const ry = rand() * Math.PI * 2;
      const rx = (rand() - 0.5) * 0.35;
      const rz = (rand() - 0.5) * 0.35;
      q.setFromEuler(new T.Euler(rx, ry, rz));
      mat4.compose(new T.Vector3(ox, h * 0.5, oz), q, new T.Vector3(1, 1, 1));
      const geo = new T.BoxGeometry(w, h, d);
      geo.applyMatrix4(mat4);
      geoms.push(geo);
    }

    const group = new T.Group();
    if (geoms.length) {
      const merged = mergeGeoms(geoms);
      merged.computeVertexNormals();
      group.add(new T.Mesh(merged, hslMat(210, 0.06, 0.46)));
    }
    return group;
  }

  // ─── Jungle tree (tall tropical, SHRUB tiles) ─────────────────────────────
  function buildJungleTreeGroup(seedU32) {
    const rand = mulberry32(seedU32);
    const DOWN = new T.Vector3(0, -1, 0);
    const UP   = new T.Vector3(0,  1, 0);
    const RADIAL = 6;

    const trunkLen = 1.5 + rand() * 0.70;
    const trunkRad = 0.065 + rand() * 0.025;

    const trunk = buildWonkyChain({
      seedU32: seedU32 ^ 0xA11CE, length: trunkLen,
      ringSegments: 10, radialSegments: RADIAL,
      origin: new T.Vector3(0, 0, 0), direction: UP,
      bend: 0.07 + rand() * 0.05, wonk: 0.08, wonkScale: 1.8,
      twist: 0.15, curl: 0, noiseAmt: 0.25, noiseScale: 1.8,
      noiseOctaves: 1, gravityDir: DOWN,
      radiusFn: (t01) => Math.max(1e-4, trunkRad * (1.0 - t01 * 0.55))
    });

    const woodGeoms = [trunk.geom];
    const leafGeoms = [];
    const trunkPts  = trunk.spine.pts;
    const trunkTans = trunk.spine.tangents;

    const BRANCH_COUNT = 5 + Math.floor(rand() * 4);
    for (let b = 0; b < BRANCH_COUNT; b++) {
      const tTier  = 0.70 + rand() * 0.30;
      const f      = tTier * (trunkPts.length - 1);
      const i0     = Math.max(0, Math.min(trunkPts.length - 2, Math.floor(f)));
      const alpha  = f - i0;
      const anchor = trunkPts[i0].clone().lerp(trunkPts[i0 + 1], alpha);
      const tanAt  = trunkTans[i0].clone().lerp(trunkTans[i0 + 1], alpha).normalize();

      let right = new T.Vector3().copy(tanAt).cross(UP);
      if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
      right.normalize();
      const upLocal = new T.Vector3().copy(right).cross(tanAt).normalize();

      const a = (b / BRANCH_COUNT) * Math.PI * 2 + (rand() - 0.5) * 0.4;
      const outward = new T.Vector3()
        .addScaledVector(right,   Math.cos(a))
        .addScaledVector(upLocal, Math.sin(a))
        .normalize();

      const dir = new T.Vector3()
        .addScaledVector(outward, 1.0)
        .addScaledVector(UP, 0.20 + rand() * 0.35)
        .normalize();

      const bLen    = 0.35 + rand() * 0.40;
      const bRad    = trunkRad * (0.18 + rand() * 0.10);
      const attachR = trunkRad * (1.0 - tTier * 0.55);
      const origin  = anchor.clone().addScaledVector(outward, Math.max(1e-4, attachR));

      const branch = buildWonkyChain({
        seedU32: seedU32 ^ (0xBEEF + b * 5003),
        length: bLen, ringSegments: 5, radialSegments: 4,
        origin, direction: dir,
        bend: 0.15, wonk: 0.35, wonkScale: 1.4, twist: 0.2, curl: 0.15,
        gravityDir: DOWN, noiseAmt: 0.30, noiseScale: 1.4, noiseOctaves: 1,
        radiusFn: (t01) => Math.max(1e-4, bRad * (1.0 - t01 * 0.85))
      });
      woodGeoms.push(branch.geom);

      const tip   = branch.spine.pts[branch.spine.pts.length - 1];
      const leafR = 0.14 + rand() * 0.12;
      const sph   = new T.SphereGeometry(leafR, 6, 5);
      sph.translate(tip.x, tip.y, tip.z);
      leafGeoms.push(sph);

      const bPts = branch.spine.pts;
      for (let li = Math.floor(bPts.length * 0.5); li < bPts.length - 1; li++) {
        if (rand() < 0.55) {
          const lr   = 0.07 + rand() * 0.07;
          const lpt  = bPts[li];
          const off  = new T.Vector3((rand()-0.5)*0.08, 0.02+rand()*0.05, (rand()-0.5)*0.08);
          const sph2 = new T.SphereGeometry(lr, 5, 4);
          sph2.translate(lpt.x + off.x, lpt.y + off.y, lpt.z + off.z);
          leafGeoms.push(sph2);
        }
      }
    }

    const group = new T.Group();
    if (woodGeoms.length) {
      const merged = mergeGeoms(woodGeoms);
      merged.computeVertexNormals();
      group.add(new T.Mesh(merged, hslMat(24, 0.38, 0.20)));
    }
    if (leafGeoms.length) {
      const merged = mergeGeoms(leafGeoms);
      merged.computeVertexNormals();
      group.add(new T.Mesh(merged, hslMat(115, 0.52, 0.26)));
    }
    return group;
  }

  // ─── Procedural conifer/canopy trees (trunk + roots + branch tiers +
  // textured leaf cards), ported from the standalone HAFoliageGenerator tool.
  // One preset per species; buildConiferTreeGroup does the actual assembly
  // and applies seeded per-instance variation (trunk height, branch length,
  // lean direction) so a cluster of the same species doesn't look copy-pasted.
  const TREE_PRESETS = {
    // Updated from the standalone tool's "crowned_pine2" export (supersedes
    // the original crowned_pine1 — knot tier deltas zeroed out, branchArchExtra
    // added, and a substantially reworked leaf card: narrower, pitched flat
    // instead of steep, and slid to the branch midpoint via leafAlong01).
    crownedPine: {
      // See getTreeVariants' variantSeedIndices comment — the default 0/1/2
      // seed numbering rolls short-branched trees for this preset, these 3
      // don't.
      variantSeedIndices: [245, 127, 149],
      radialSegments: 8, ringSegments: 12,
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
      barkColorHex: 0x4a3b33,
      leafTexture: 'assets/leaves/leaves_crowned_pine.png',
      scaleMul: 0.75
    },
    // Updated from the standalone tool's "tree_shadewood2" export (supersedes
    // the original tree_shadewood — trunkLength doubled to 30 alongside a
    // much taller/wider canopy shape (knotAt 0.7->0.8, branchArchExtra,
    // leafPrismLengthOffset letting the leaf card overshoot the branch tip),
    // so scaleMul is recalibrated way down (0.5 -> 0.2) rather than reused —
    // see the scaleMul comment below.
    shadewood: {
      radialSegments: 8, ringSegments: 10,
      trunkLength: 30, trunkRadius: 0.6, trunkTaper: 0.92, trunkBend: 0.55,
      trunkWonk: 0.85, trunkWonkScale: 1.6, trunkTwist: 0.7,
      trunkNoise: 0.9, trunkNoiseScale: 2.2, trunkNoiseOctaves: 3,
      rootsEnabled: true, rootCount: 9, rootLength: 2.2, rootRadius: 0.14,
      rootTaper: 0.78, rootSpread: 1.25, rootCurl: 0.1, rootWonk: 0.55,
      // Canopy branch count cut from 5 tiers x 7/tier (35 total, each its
      // own tube mesh + leaf card) to 3 x 5 (15, a ~57% reduction) — this
      // geometry is built once per shared variant and cloned for every
      // placed tree (see getTreeVariants/buildTreeInstance), so the saving
      // is real GPU vertex/triangle cost on every rendered shadewood, not
      // just the Cloud Forest, at zero runtime cost to cut it.
      knotEnabled: true, knotAt: 0.8, knotTiers: 3, knotTierSpacing: 0.08,
      knotTierLengthDelta: 0.75, knotTierRadiusDelta: -0.3, branchArchExtra: 0.5,
      knotCount: 5, knotLength: 3.5, knotRadius: 0.4, knotTaper: 0.82,
      knotUpDownBias: -0.2, knotCurl: 1, knotWonk: 0.55,
      leafWidth: 5, leafOffsetX: 0, leafOffsetY: -0.9, leafOffsetZ: 0,
      leafAlong01: 0.88, leafYawDeg: 0, leafPitchDeg: 180, leafRollDeg: 0,
      leafPrismLengthOffset: 5.5,
      leafSurfaceClearance: 0.02, leafStemUp: true, trunkRollBiasDist: 0.25,
      leafTintH: 115, leafTintS: 0.55, leafTintL: 0.35, leafOpacity: 1, leafAlphaCutoff: 0.5,
      barkColorHex: 0x4a3b33,
      leafTexture: 'assets/leaves/leaves_shadewood.png',
      // Hanging/wrapping vines around the trunk — see buildConiferTreeGroup's
      // vinesEnabled block (ported from the standalone tool's
      // buildVinesAroundTrunk). All lengths/radii here are in this preset's
      // own native (pre-scaleMul) trunk-length-30 space, same as every other
      // field on this preset.
      vinesEnabled: true, vineStrandCount: 5,
      vineTop01: 0.92, vineBottom01: 0.08, vineWraps: 2.2,
      vineSurfaceOffset: 0.05, vineHangLength: 5, vineHangWobble: 0.5,
      vineTubeRadius: 0.06, vineTubeTaper: 0.55, vineRadialSegments: 5,
      vineNoise: 0.35, vineNoiseScale: 1.4, vineNoiseOctaves: 2,
      vineColorHex: 0x3a5f3a,
      // Sideways mid-trunk climbing branch — see buildConiferTreeGroup's
      // climbBranchLocal block. climbBranchAt sits well below the knot tier
      // (knotAt 0.8) so it reads as a bare branch on open trunk, not part of
      // the canopy. Rolled once per shared tree variant (not per instance),
      // so climbBranchChance is the fraction of the cached tree shapes that
      // end up with one, not a per-tree-instance probability.
      // Rolled once per shared tree shape (see getTreeVariants/
      // TREE_VARIANT_COUNT), not per tile — 0.5 meant a coin-flip chance
      // that 2 or all 3 of the zone's shadewood shapes got a branch, so a
      // large majority of every shadewood tree in the whole forest ended up
      // climbable. Lowered so "sometimes" stays a minority of trees.
      climbBranchChance: 0.17, climbBranchAt: 0.42, climbBranchLength: 7.5, climbBranchRadius: 0.55,
      // Calibrated (not guessed) against the tool's own "canopy influence
      // radius"/"canopy underside height" species properties — 2.75 / 6
      // world units respectively — by building this preset unscaled in a
      // standalone Node harness across a dozen seeds and measuring the
      // lowest leaf card's height (~15.2 raw) and outer leaf-card-center
      // radius (~6.2-8.1 raw depending on percentile). Height alone implies
      // scale ~0.395, radius implies ~0.34-0.44 — close enough to treat as
      // one target; 0.38 sits at their center.
      scaleMul: 0.38
    },
    // Ported from the standalone tool's ASSET_TYPE_DEFAULTS.Bush — a proper
    // small leafy bush (short trunk, no roots, two low branch tiers with
    // many short twigs, several leaf cards fanned per twig), used for
    // wilderness-generator 'bush' objects instead of a full tree. Fields
    // the standalone tool leaves at its own global defaults are spelled out
    // here explicitly (radialSegments/ringSegments, trunkBend/Wonk/Twist/
    // Noise, knotTaper/Curl/Wonk, leaf placement) rather than silently
    // relying on this file's per-field `?? fallback` defaults matching.
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
      barkColorHex: 0x4a3b33,
      leafTexture: 'assets/leaves/leaf_1.png',
      scaleMul: 1,
      variantCount: 8 // Shrub/bush tiles are the densest, closest-to-camera ground clutter in the game (see buildShrubMesh/buildWildernessBushMesh) — more than the tree default so the shared-variant cache doesn't read as obvious repetition.
    },
    // Ported from ASSET_TYPE_DEFAULTS.Stump — trunk + roots, no branches or
    // leaves — scaled up a bit for a "big old stump" read, with a flat cap
    // disc on top (capTop) since a plain open tube end reads as hollow.
    // Used for wilderness-generator 'beehive' objects.
    stump: {
      radialSegments: 6, ringSegments: 6,
      trunkLength: 0.85, trunkRadius: 0.42, trunkTaper: 0.92,
      trunkBend: 0.2, trunkWonk: 0.55, trunkWonkScale: 1.35, trunkTwist: 0.2,
      trunkNoise: 0.55, trunkNoiseScale: 2.2, trunkNoiseOctaves: 3,
      rootsEnabled: true, rootCount: 6, rootLength: 0.75, rootRadius: 0.17,
      rootTaper: 0.78, rootSpread: 0.9, rootCurl: 0.55, rootWonk: 0.55,
      knotEnabled: false,
      capTop: true,
      barkColorHex: 0x4a3b33,
      scaleMul: 1
    }
  };

  // Western Slope's leafless variants keep their own silhouettes but use the
  // crowned pine bark tint; NaturalSurfaceMaterials applies the same stretched PNG.
  TREE_PRESETS.deadBush = { ...TREE_PRESETS.bush, leafless: true, barkColorHex: TREE_PRESETS.crownedPine.barkColorHex };
  TREE_PRESETS.deadTree = { ...TREE_PRESETS.bush, leafless: true, barkColorHex: TREE_PRESETS.crownedPine.barkColorHex,
    trunkLength: 4.2, trunkRadius: 0.25, trunkBend: 0.2, trunkTaper: 0.85,
    knotAt: 0.58, knotTiers: 4, knotTierSpacing: 0.18, knotCount: 5,
    knotLength: 1.6, knotRadius: 0.11, knotUpDownBias: 0.6,
    rootsEnabled: true, rootCount: 5, rootLength: 0.7, rootRadius: 0.13,
    rootTaper: 0.78, rootSpread: 0.8, rootCurl: 0.35, rootWonk: 0.45, variantCount: 4 };

  function buildConiferTreeGroup(preset, seedU32) {
    const rand = mulberry32(seedU32);
    const DOWN = new T.Vector3(0, -1, 0);
    const UP   = new T.Vector3(0,  1, 0);
    const RADIAL = Math.max(4, Math.floor(preset.radialSegments));
    const RINGS  = Math.max(2, Math.floor(preset.ringSegments));
    const taper  = clamp(preset.trunkTaper, 0.45, 0.9995);

    // Per-instance variation so repeated instances in a cluster read as
    // distinct trees: trunk height, branch length, overall size, and lean
    // direction (the underlying bend math tilts every perfectly-vertical
    // trunk around the same fixed axis, so a random yaw is what actually
    // makes "wonk direction" differ from tree to tree).
    const trunkLenMul  = 1 + (rand() - 0.5) * 0.30;
    const trunkRadMul  = 1 + (rand() - 0.5) * 0.16;
    const branchLenMul = 1 + (rand() - 0.5) * 0.36;
    const instScale     = 1 + (rand() - 0.5) * 0.14;
    const instYaw        = rand() * Math.PI * 2;

    const woodGeoms = [];
    const leafGeoms = [];
    const vineGeoms = [];
    let climbBranchLocal = null; // Populated below for presets that opt into climbBranchChance (shadewood).
    let climbBranchGeom = null; // Kept as its OWN mesh (not merged into woodGeoms) so buildTreeInstance can show/hide it per tile instance — see the climb-branch block below.
    const unitLeaf = new T.PlaneGeometry(1, 1, 1, 1);

    // Trunk
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
      radiusFn: (t01) => Math.max(1e-4, trunkRad * Math.pow(taper, t01 * RINGS))
    });
    woodGeoms.push(trunk.geom);

    // Flat cap disc on the trunk's open top end — a plain tube end reads as
    // hollow, which is fine for a tree lost in its own canopy but obvious on
    // a stump. capTop is opt-in per preset (see TREE_PRESETS.stump).
    if (preset.capTop) {
      const topPt = trunk.spine.pts[trunk.spine.pts.length - 1];
      const topTan = trunk.spine.tangents[trunk.spine.tangents.length - 1].clone().normalize();
      const topRadius = Math.max(1e-4, trunkRad * Math.pow(taper, RINGS));
      const capGeom = new T.CircleGeometry(topRadius, RADIAL);
      const capQuat = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 0, 1), topTan);
      const capMatrix = new T.Matrix4().compose(topPt, capQuat, new T.Vector3(1, 1, 1));
      capGeom.applyMatrix4(capMatrix);
      woodGeoms.push(capGeom);
    }

    // Roots
    if (preset.rootsEnabled) {
      const count = Math.max(0, Math.floor(preset.rootCount));
      const rootRings = Math.max(4, Math.floor(RINGS * 0.85));
      const rootTaperPR = clamp(preset.rootTaper, 0.4, 0.999);
      const baseN = trunk.spine.normals[0], baseB = trunk.spine.binormals[0], baseT = trunk.spine.tangents[0];
      for (let i = 0; i < count; i++) {
        const ang = (i / Math.max(1, count)) * Math.PI * 2 + (rand() - 0.5) * 0.35;
        const spread = preset.rootSpread * (0.55 + 0.65 * rand());
        const outward = baseN.clone().multiplyScalar(Math.cos(ang)).addScaledVector(baseB, Math.sin(ang)).normalize();
        const attachR = trunkRad * (0.98 + 0.06 * rand());
        const origin = trunk.spine.pts[0].clone().addScaledVector(outward, attachR).addScaledVector(baseT, (rand() - 0.5) * 0.03);
        // Shallow downward bias — real surface roots flare mostly sideways;
        // keep the dip gentle so root tips stay inside the ground slab
        // (SLAB_H in game.js) instead of dangling below the terrain mesh.
        const dir = outward.clone().multiplyScalar(1.0 + spread)
          .add(new T.Vector3(0, -(0.16 + 0.10 * rand()), 0)).normalize();
        const rootBaseRadius = Math.max(preset.rootRadius * (0.75 + 0.55 * rand()), attachR * 0.6);
        const rampRings = Math.max(1, Math.floor(rootRings * 0.22));

        const root = buildWonkyChain({
          seedU32: seedU32 ^ (0xB00B1E + i * 1337),
          length: preset.rootLength * (0.75 + 0.6 * rand()),
          ringSegments: rootRings, radialSegments: RADIAL,
          origin, direction: dir,
          bend: clamp(preset.trunkBend * 0.35, 0, 2), wonk: clamp(preset.rootWonk, 0, 2),
          wonkScale: Math.max(0.05, preset.trunkWonkScale * 1.2), twist: clamp(preset.trunkTwist * 0.6, 0, 2),
          noiseAmt: clamp(preset.trunkNoise * 0.85, 0, 2), noiseScale: Math.max(0.05, preset.trunkNoiseScale * 1.15),
          noiseOctaves: preset.trunkNoiseOctaves, gravityDir: DOWN, curl: clamp(preset.rootCurl, 0, 2),
          radiusFn: (t01, ringIdx) => {
            const s = clamp01(ringIdx / rampRings);
            const smooth = s * s * (3 - 2 * s);
            const blended = attachR + (rootBaseRadius - attachR) * smooth;
            const taperExp = Math.max(0, ringIdx - rampRings);
            return Math.max(1e-4, blended * Math.pow(rootTaperPR, taperExp));
          }
        });
        woodGeoms.push(root.geom);
      }
    }

    // Branch tiers ("knots") + one textured leaf card per branch
    if (preset.knotEnabled) {
      const trunkPts = trunk.spine.pts, trunkTans = trunk.spine.tangents;
      const tiers = Math.max(1, Math.min(8, Math.floor(preset.knotTiers)));
      const spacing = clamp(preset.knotTierSpacing, 0, 0.5);
      const dLen = clamp(preset.knotTierLengthDelta ?? 0, -0.75, 0.75);
      const dRad = clamp(preset.knotTierRadiusDelta ?? 0, -0.75, 0.75);
      const center = clamp01(preset.knotAt);
      const halfSpan = tiers <= 1 ? 0 : spacing * ((tiers - 1) * 0.5);
      const startAt = clamp01(center - halfSpan), endAt = clamp01(center + halfSpan);
      const baseCurl = clamp(preset.knotCurl ?? 0.25, 0, 2);
      const baseBias = clamp(preset.knotUpDownBias, -1, 1);
      const knotTaperPR = clamp(preset.knotTaper, 0.4, 0.999);
      const biasVec = baseBias >= 0 ? UP : DOWN;
      const biasAmt = Math.abs(baseBias);

      const branchSegs = [];

      for (let tier = 0; tier < tiers; tier++) {
        const tTier = tiers <= 1 ? 0 : tier / (tiers - 1);
        const tierAt = tiers <= 1 ? center : lerp(startAt, endAt, tTier);
        const f = clamp01(tierAt) * (trunkPts.length - 1);
        const i0 = Math.max(0, Math.min(trunkPts.length - 2, Math.floor(f)));
        const alpha = f - i0;
        const anchor = trunkPts[i0].clone().lerp(trunkPts[i0 + 1], alpha);
        const tan = trunkTans[i0].clone().lerp(trunkTans[i0 + 1], alpha).normalize();

        let right = new T.Vector3().copy(tan).cross(UP);
        if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
        right.normalize();
        const up = new T.Vector3().copy(right).cross(tan).normalize();

        const tierLenScale = clamp(lerp(1.0, 1.0 + dLen, tTier), 0.15, 3.0);
        const tierRadScale = clamp(lerp(1.0, 1.0 + dRad, tTier), 0.15, 3.0);
        const attachR = Math.max(1e-4, trunkRad * Math.pow(taper, tierAt * RINGS));

        const count = Math.max(0, Math.floor(preset.knotCount));
        for (let i = 0; i < count; i++) {
          const a = (i / Math.max(1, count)) * Math.PI * 2 + (rand() - 0.5) * 0.4;
          const outward = new T.Vector3().addScaledVector(right, Math.cos(a)).addScaledVector(up, Math.sin(a)).normalize();
          const dir = new T.Vector3()
            .addScaledVector(outward, 1.0)
            .addScaledVector(biasVec, biasAmt * 1.35)
            .addScaledVector(tan, 0.15)
            .normalize();
          dir.add(new T.Vector3((rand() - 0.5) * 0.12, (rand() - 0.5) * 0.10, (rand() - 0.5) * 0.12)).normalize();

          const origin = anchor.clone().addScaledVector(outward, attachR).addScaledVector(tan, (rand() - 0.5) * 0.03);
          // knotLengthJitter (opt-in per preset — see crownedPine) ports the
          // standalone tool's own branch-length formula more faithfully: a
          // 0.55-1.5x random factor with an extra "Tree species" 0.95-1.65x
          // bonus on top, then damped toward 1.0 (full nominal length) by
          // knotLengthJitter instead of always applying the full random
          // swing. Left off (undefined) for presets ported before this was
          // understood — shadewood in particular has its scaleMul calibrated
          // against the plain formula below, and switching it over would
          // silently invalidate that calibration — so it keeps the exact
          // original formula unless a preset explicitly opts in.
          const lenJitterRaw = preset.knotLengthJitter;
          const lenRandBase = 0.55 + 0.95 * rand();
          const lenRand = lenJitterRaw != null
            ? lerp(1.0, lenRandBase * (0.95 + 0.7 * rand()), clamp(lenJitterRaw, 0, 1))
            : lenRandBase;
          const branchLen = Math.max(1e-4, preset.knotLength * branchLenMul * tierLenScale * lenRand);
          const branchRad = Math.max(1e-4, preset.knotRadius * tierRadScale * (0.75 + 0.5 * rand()));
          const branchRings = Math.max(4, Math.floor(RINGS * 0.75));

          const knot = buildWonkyChain({
            seedU32: seedU32 ^ (0xC0FFEE + tier * 1009 + i * 271),
            length: branchLen, ringSegments: branchRings, radialSegments: RADIAL,
            origin, direction: dir,
            bend: clamp(preset.trunkBend * 0.25, 0, 2), wonk: clamp(preset.knotWonk, 0, 2),
            wonkScale: Math.max(0.05, preset.trunkWonkScale * 1.25), twist: clamp(preset.trunkTwist * 0.7, 0, 2),
            noiseAmt: clamp(preset.trunkNoise * 0.9, 0, 2), noiseScale: Math.max(0.05, preset.trunkNoiseScale * 1.15),
            noiseOctaves: preset.trunkNoiseOctaves, gravityDir: DOWN,
            // branchArchExtra is the source tool's "Tree arch extra" knob —
            // added on top of the tier's own curl for Tree/JungleTree-style
            // presets (every TREE_PRESETS entry here is one), 0 for presets
            // that don't set it.
            curl: clamp(baseCurl + (preset.branchArchExtra || 0), 0, 2),
            radiusFn: (t01, ringIdx) => Math.max(1e-4, branchRad * Math.pow(knotTaperPR, ringIdx))
          });
          woodGeoms.push(knot.geom);

          const tip = knot.spine.pts[knot.spine.pts.length - 1].clone();
          branchSegs.push({
            a: origin.clone(), b: tip,
            baseRadius: branchRad, taperPerRing: knotTaperPR,
            rings: Math.max(1, knot.spine.pts.length - 1)
          });
        }
      }

      // Vines: strands helically wound around the trunk with a dangling tail
      // past their lower end, ported from the standalone tool's
      // buildVinesAroundTrunk. Opt-in per preset (see TREE_PRESETS.shadewood).
      // Built once per shared geometry variant just like everything else
      // here (see getTreeVariants) — a per-tree-pair vine ROUTE system like
      // the tool's separate grid-network vines would be unique geometry per
      // instance, which is exactly what the shared-variant/culling work this
      // session was about avoiding at this tree density.
      if (preset.vinesEnabled) {
        const strandCount = Math.max(0, Math.floor(preset.vineStrandCount ?? 0));
        const n = trunk.spine.pts.length;
        const startIdx = clamp(Math.round(clamp01(preset.vineTop01 ?? 0.95) * (n - 1)), 0, n - 1);
        const endIdx = clamp(Math.round(clamp01(preset.vineBottom01 ?? 0.05) * (n - 1)), 0, n - 1);
        const vineRadial = Math.max(3, Math.floor(preset.vineRadialSegments ?? 5));
        const controlCount = Math.max(8, Math.min(36, Math.floor(vineRadial * 2.8)));
        const sampleCount = Math.max(18, vineRadial * 6);
        const wrapsBase = Math.max(0, preset.vineWraps ?? 1.5);
        const surfaceOffset = Math.max(0, preset.vineSurfaceOffset ?? 0.03);
        const tailLenBase = Math.max(0, preset.vineHangLength ?? 0);
        const tailWobble = Math.max(0, preset.vineHangWobble ?? 0.15);
        const trunkRadiusAt = (idx) => trunkRad * Math.pow(taper, clamp(idx, 0, n - 1));
        const DOWN2 = new T.Vector3(0, -1, 0);

        for (let si = 0; si < strandCount; si++) {
          const phi0 = rand() * Math.PI * 2;
          const wraps = wrapsBase * (0.8 + 0.5 * rand());
          const cps = [];
          for (let k = 0; k <= controlCount; k++) {
            const u = k / controlCount;
            const idx = clamp(Math.round(lerp(startIdx, endIdx, u)), 0, n - 1);
            const center = trunk.spine.pts[idx];
            const N = trunk.spine.normals[idx], B = trunk.spine.binormals[idx];
            const phi = phi0 + Math.PI * 2 * wraps * u;
            const outward = new T.Vector3().copy(N).multiplyScalar(Math.cos(phi)).addScaledVector(B, Math.sin(phi)).normalize();
            const r = trunkRadiusAt(idx) + surfaceOffset;
            const p = center.clone().addScaledVector(outward, r);
            const wob = tailWobble * 0.15;
            p.addScaledVector(outward, (rand() - 0.5) * wob);
            p.addScaledVector(trunk.spine.tangents[idx], (rand() - 0.5) * wob * 0.15);
            cps.push(p);
          }
          const tailLen = tailLenBase * (0.65 + 0.7 * rand());
          if (tailLen > 1e-4) {
            const endCenter = trunk.spine.pts[endIdx];
            const endN = trunk.spine.normals[endIdx], endB = trunk.spine.binormals[endIdx];
            const phiEnd = phi0 + Math.PI * 2 * wraps;
            const outwardEnd = new T.Vector3().copy(endN).multiplyScalar(Math.cos(phiEnd)).addScaledVector(endB, Math.sin(phiEnd)).normalize();
            const baseP = endCenter.clone().addScaledVector(outwardEnd, trunkRadiusAt(endIdx) + surfaceOffset);
            const tailSteps = 4;
            for (let s = 1; s <= tailSteps; s++) {
              const tu = s / tailSteps;
              const p = baseP.clone()
                .addScaledVector(DOWN2, tailLen * tu)
                .addScaledVector(outwardEnd, Math.sin(tu * Math.PI) * tailWobble * 0.35)
                .addScaledVector(endB, (rand() - 0.5) * tailWobble * 0.18);
              cps.push(p);
            }
          }
          const curve = new T.CatmullRomCurve3(cps, false, 'catmullrom', 0.5);
          const sampled = curve.getPoints(sampleCount);
          const vineSpine = framesFromPoints(sampled);
          const baseR = Math.max(1e-4, preset.vineTubeRadius ?? 0.035);
          const taperEnd = clamp(preset.vineTubeTaper ?? 0.7, 0.05, 1);
          const vgeo = buildMeshFromSpineWithRadiusFn({
            seedU32: seedU32 ^ (0xA57E1E + si * 113),
            spine: vineSpine,
            radiusFn: (t01) => baseR * lerp(1, taperEnd, clamp01(t01)),
            radialSegments: vineRadial, twist: 0,
            noiseAmt: clamp(preset.vineNoise ?? 0.3, 0, 2),
            noiseScale: Math.max(0.05, preset.vineNoiseScale ?? 1.2),
            noiseOctaves: Math.max(1, Math.floor(preset.vineNoiseOctaves ?? 2))
          });
          vineGeoms.push(vgeo);
        }
      }

      // Leaf cards: one big textured "frond" per branch, oriented the same
      // way the source tool's prism frame does — Z along the branch, Y
      // banked toward a single fixed point near the trunk base (not each
      // branch's own local tangent), so the whole canopy reads consistently
      // instead of every leaf picking an arbitrary local frame.
      if (branchSegs.length && !preset.leafless) {
        const rollBiasDist = preset.trunkRollBiasDist ?? 0.25;
        const firstOrigin = branchSegs[0].a;
        let nearestIdx = 0, bestD2 = Infinity;
        for (let ti = 0; ti < trunkPts.length; ti++) {
          const d2 = trunkPts[ti].distanceToSquared(firstOrigin);
          if (d2 < bestD2) { bestD2 = d2; nearestIdx = ti; }
        }
        const trunkDirAtBase = trunkTans[nearestIdx];
        const trunkPRef = firstOrigin.clone().addScaledVector(trunkDirAtBase, -rollBiasDist);

        const leavesPerBranch = Math.max(0, Math.floor(preset.leavesPerBranch ?? 1));

        for (const seg of branchSegs) {
          const { a: origin, b: tip, baseRadius: branchRad, taperPerRing: segTaper, rings: segRings } = seg;
          const distL = Math.max(1e-4, origin.distanceTo(tip));
          const mid = origin.clone().add(tip).multiplyScalar(0.5);
          const z = tip.clone().sub(origin).normalize();

          let yAx = trunkPRef.clone().sub(mid);
          let d = yAx.dot(z);
          yAx.addScaledVector(z, -d);
          if (yAx.lengthSq() < 1e-8) { yAx = UP.clone(); d = yAx.dot(z); yAx.addScaledVector(z, -d); }
          if (yAx.lengthSq() < 1e-8) yAx.set(1, 0, 0);
          yAx.normalize();
          const xAx = new T.Vector3().crossVectors(yAx, z).normalize();
          yAx.crossVectors(z, xAx).normalize();
          const basisM = new T.Matrix4().makeBasis(xAx, yAx, z);
          const prismQuat = new T.Quaternion().setFromRotationMatrix(basisM);
          const surfaceRadiusAt = (zLocal) => {
            const t01 = clamp01((zLocal / distL) + 0.5);
            return branchRad * Math.pow(segTaper, t01 * segRings);
          };

          const placeLeafCard = (localPos, localEuler, scaleY) => {
            const localQuat = new T.Quaternion().setFromEuler(localEuler);
            const worldQuat = prismQuat.clone().multiply(localQuat);
            const worldPos = mid.clone().add(localPos.clone().applyQuaternion(prismQuat));
            const m = new T.Matrix4().compose(worldPos, worldQuat, new T.Vector3(preset.leafWidth, scaleY, 1));
            const g = unitLeaf.clone();
            g.applyMatrix4(m);
            leafGeoms.push(g);
          };

          if (leavesPerBranch <= 1) {
            // Single big textured "frond" spanning the whole branch (matches
            // the source tool's singleLeafMode) — lies flat on the branch's
            // top face (the +90° X pre-rotation), then pitch/yaw/roll tilt
            // it. Slides along the branch per leafAlong01 (0=base, 1=tip)
            // exactly like the multi-leaf case, and its length is the
            // branch's own span plus leafPrismLengthOffset (can overshoot
            // past the tip for a droopier canopy card).
            const zBase = lerp(-distL * 0.5, distL * 0.5, clamp01(preset.leafAlong01 ?? 0.5));
            const surfR = surfaceRadiusAt(zBase);
            const localPos = new T.Vector3(
              (preset.leafOffsetX || 0),
              surfR + Math.max(0, preset.leafSurfaceClearance || 0) + (preset.leafOffsetY || 0),
              zBase + (preset.leafOffsetZ || 0)
            );
            const localEuler = new T.Euler(
              Math.PI * 0.5 + degToRad(preset.leafPitchDeg || 0),
              degToRad(preset.leafYawDeg || 0),
              degToRad(preset.leafRollDeg || 0),
              'XYZ'
            );
            // Single-frond mode (leavesPerBranch<=1) ties the card's length
            // to its own branch's prism length (distL) rather than a fixed
            // preset.leafLength — see the multi-leaf branch below, which
            // uses leafLength directly instead since there each branch gets
            // several small cards, not one spanning the whole thing.
            // leafPrismLengthOffset (single-leaf mode only, per the source
            // tool) adds on top of that, letting the card overshoot the
            // branch tip — confirmed against the tool's own source
            // (getSerializableParamsForSave dumps every param, so its
            // absence from an export means it was genuinely 0, not just
            // omitted) rather than assumed, after an earlier guess that
            // conflated it with leafLength turned out wrong: loading
            // "crowned_pine2.json" cold into the actual standalone tool via
            // Playwright and reading its own branch-length debug dump
            // showed the real gap was the branch length formula below
            // (knotLengthJitter et al), not leaf length.
            const singleLeafLength = Math.max(1e-4, distL + (preset.leafPrismLengthOffset || 0));
            const scaleY = preset.leafStemUp !== false ? -singleLeafLength : singleLeafLength;
            placeLeafCard(localPos, localEuler, scaleY);
          } else {
            // Several smaller leaf cards fanned symmetrically left/right off
            // the branch surface (matches the source tool's multi-leaf
            // branch) — used by bushy/leafy presets instead of trees.
            const zBase = lerp(-distL * 0.5, distL * 0.5, clamp01(preset.leafAlong01 ?? 0.72));
            const spread = Number.isFinite(preset.leafSpread) ? preset.leafSpread : 1.0;
            const baseLeafLength = preset.leafLength || 0.5;
            for (let k = 0; k < leavesPerBranch; k++) {
              const localPos = new T.Vector3(0, 0, zBase);
              let sideIndex = 0;
              if (k > 0) {
                const step = Math.ceil(k / 2);
                sideIndex = (k % 2 === 1) ? -step : step;
              }
              let radial = Number.isFinite(preset.leafRadial) ? preset.leafRadial : 0.18;
              if (preset.leafAttachToSurface !== false) {
                const rSurf = surfaceRadiusAt(localPos.z);
                const base = rSurf + Math.max(0, preset.leafSurfaceClearance || 0);
                const stack = Math.max(0, preset.leafSurfaceStackStep || 0);
                const extra = Math.max(0, Math.abs(sideIndex) - 1) * stack;
                radial = base + extra;
              }
              localPos.x = sideIndex * radial;
              if (k > 0) {
                localPos.z += (rand() - 0.5) * (preset.leafJitterAlong ?? 0.12);
                localPos.x += (rand() - 0.5) * (preset.leafJitterSide ?? 0.05) * spread;
                localPos.y += (rand() - 0.5) * (preset.leafJitterNormal ?? 0.08) * spread;
              }
              localPos.x += preset.leafOffsetX || 0;
              localPos.y += preset.leafOffsetY || 0;
              localPos.z += preset.leafOffsetZ || 0;

              const yawJ = (k === 0) ? 0 : (rand() * 2 - 1) * degToRad(preset.leafRandYawDeg || 0);
              const pitchJ = (rand() * 2 - 1) * degToRad(preset.leafRandPitchDeg || 0);
              const rollJ = (rand() * 2 - 1) * degToRad(preset.leafRandRollDeg || 0);
              const localEuler = new T.Euler(
                degToRad(preset.leafPitchDeg || 0) + pitchJ,
                degToRad(preset.leafYawDeg || 0) + yawJ,
                degToRad(preset.leafRollDeg || 0) + rollJ + (preset.leafBottomFacesTrunk !== false ? Math.PI * 0.5 : 0),
                'XYZ'
              );
              const scaleY = preset.leafStemUp !== false ? -baseLeafLength : baseLeafLength;
              placeLeafCard(localPos, localEuler, scaleY);
            }
          }
        }
      }
    }

    // Sideways mid-trunk climbing branch (opt-in via preset.climbBranchChance
    // — shadewood only). Distinct from the knot/canopy branches above: those
    // attach high (knotAt ~0.8) and carry leaf cards, this is a single bare
    // branch lower on the bark, thick and roughly horizontal, that reads as
    // something a player or drenkirra could climb onto the same way
    // ClimbSystem already treats plateau walls.
    //
    // The geometry is always built here (it needs this specific shared
    // variant's own trunk shape to attach correctly), but climbBranchChance
    // is NOT rolled in this function — buildTreeInstance rolls it per TILE
    // INSTANCE instead and shows/hides this mesh accordingly. Rolling it
    // here, per shared variant, was the original design (see
    // TREE_VARIANT_COUNT — only 3 cached shapes total) and it's broken at
    // any reasonably low chance: at 0.17 there's a ~57% chance NONE of the
    // 3 variants rolls one, meaning entire sessions could have zero
    // climbable shadewood trees anywhere on the map. Per-instance gating
    // makes "sometimes" behave like an actual per-tree probability instead
    // of a session-wide coin flip across 3 buckets.
    if (preset.climbBranchChance > 0) {
      const at = clamp01(preset.climbBranchAt ?? 0.45);
      const f = at * (trunk.spine.pts.length - 1);
      const i0 = Math.max(0, Math.min(trunk.spine.pts.length - 2, Math.floor(f)));
      const alpha = f - i0;
      const anchor = trunk.spine.pts[i0].clone().lerp(trunk.spine.pts[i0 + 1], alpha);
      const tan = trunk.spine.tangents[i0].clone().lerp(trunk.spine.tangents[i0 + 1], alpha).normalize();
      let right = new T.Vector3().copy(tan).cross(UP);
      if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
      right.normalize();
      if (rand() < 0.5) right.negate(); // Which side of the trunk the branch sticks out from.
      const attachR = Math.max(1e-4, trunkRad * Math.pow(taper, at * RINGS));
      const dir = right.clone().addScaledVector(tan, 0.08).addScaledVector(UP, 0.05).normalize();
      const origin = anchor.clone().addScaledVector(right, attachR);
      const branchLen = Math.max(1e-4, (preset.climbBranchLength ?? 7) * (0.85 + 0.3 * rand()));
      const branchRad = Math.max(1e-4, preset.climbBranchRadius ?? 0.55);
      const climbBranch = buildWonkyChain({
        seedU32: seedU32 ^ 0xC1113B,
        length: branchLen, ringSegments: Math.max(4, Math.floor(RINGS * 0.75)), radialSegments: RADIAL,
        origin, direction: dir,
        bend: clamp(preset.trunkBend * 0.15, 0, 2), wonk: clamp((preset.knotWonk ?? 0.5) * 0.4, 0, 2),
        wonkScale: Math.max(0.05, preset.trunkWonkScale), twist: 0,
        noiseAmt: clamp((preset.trunkNoise ?? 0.5) * 0.3, 0, 2), noiseScale: Math.max(0.05, preset.trunkNoiseScale),
        noiseOctaves: preset.trunkNoiseOctaves, gravityDir: DOWN, curl: 0,
        radiusFn: (t01, ringIdx) => Math.max(1e-4, branchRad * Math.pow(0.9, ringIdx))
      });
      climbBranchGeom = climbBranch.geom;
      const tip = climbBranch.spine.pts[climbBranch.spine.pts.length - 1];
      climbBranchLocal = {
        a: { x: origin.x, y: origin.y, z: origin.z },
        b: { x: tip.x, y: tip.y, z: tip.z },
        radius: branchRad,
      };
    }

    const group = new T.Group();
    if (woodGeoms.length) {
      const merged = mergeGeoms(woodGeoms);
      merged.computeVertexNormals();
      group.add(new T.Mesh(merged, hexBarkMat(preset.barkColorHex ?? 0x4a3b33)));
    }
    if (climbBranchGeom) {
      // Its own mesh, not merged into the wood mesh above — buildTreeInstance
      // toggles .visible on this specific child per placed tile instance
      // (see climbBranchLocal's comment above), which only works if it's a
      // separate Object3D rather than baked into shared merged geometry.
      // Added before the leaf mesh for the same "leaves must stay last"
      // reason as the vines mesh just below.
      climbBranchGeom.computeVertexNormals();
      const climbBranchMesh = new T.Mesh(climbBranchGeom, hexBarkMat(preset.barkColorHex ?? 0x4a3b33));
      climbBranchMesh.name = 'climbBranch';
      group.add(climbBranchMesh);
    }
    if (vineGeoms.length) {
      // Added before the leaf mesh so leaves stay the LAST child — canopy
      // clamp tagging (game.js) and the shared-variant cache (getTreeVariants)
      // both assume that.
      const merged = mergeGeoms(vineGeoms);
      merged.computeVertexNormals();
      group.add(new T.Mesh(merged, hexBarkMat(preset.vineColorHex ?? 0x3a5f3a)));
    }
    if (leafGeoms.length) {
      const merged = mergeGeomsWithUV(leafGeoms);
      const leafMesh = new T.Mesh(merged, getLeafCardMaterial(preset));
      // Flat, depthWrite:false, no-computed-normals alpha-cutout cards break
      // game.js's inverted-hull outline shell (see _markOutline's comment) —
      // opt this mesh out of the outline layer entirely rather than fight an
      // effect that fundamentally doesn't apply to non-volumetric geometry.
      leafMesh.userData.noOutline = true;
      group.add(leafMesh);
    }
    unitLeaf.dispose();

    group.rotation.y = instYaw;
    group.scale.setScalar(instScale * (preset.scaleMul ?? 1));
    if (climbBranchLocal) group.userData.climbBranchLocal = climbBranchLocal;
    return group;
  }

  // ─── Shared tree geometry variants ────────────────────────────────────────
  // A dense forest calling buildConiferTreeGroup fresh per tile means one
  // unique BufferGeometry (trunk + every knot branch + every leaf card) built
  // from scratch for every single tree — real CPU cost at zone-build time and
  // real GPU memory per instance. The standalone tool's own "Network Layout"
  // mode solves this by reusing a small fixed number of exact species shapes
  // (gridForestVariantCount, default 3) and varying only the cheap per-instance
  // transform (position/yaw/scale) across placements — full visual diversity
  // per tile without regenerating geometry per tile. Ported here the same way:
  // build TREE_VARIANT_COUNT full trees ONCE per species (fixed seeds, so every
  // session/zone-regeneration reuses the identical shapes), cache them, and
  // have each tile clone()+retransform whichever variant it's assigned —
  // THREE's Object3D.clone() copies the scene-graph structure but shares the
  // underlying geometry/material by reference, so a clone costs a few small
  // JS objects, not a new vertex buffer.
  const TREE_VARIANT_COUNT = 3;
  const _treeVariantCache = new Map(); // presetKey -> Group[]

  function getTreeVariants(presetKey, preset) {
    let variants = _treeVariantCache.get(presetKey);
    if (variants) return variants;
    variants = [];
    // A preset can raise its own variant count above the tree default (see
    // TREE_PRESETS.bush) — shrubs/bushes are placed far more densely and far
    // closer to the camera than trees, so 3 shared shapes would read as
    // obvious repetition where it worked fine for sparser trees.
    const variantCount = Math.max(1, Number(preset.variantCount) || TREE_VARIANT_COUNT);
    for (let i = 0; i < variantCount; i++) {
      // Plain `_variant_0/1/2` seed strings happen to be a bad roll for
      // crownedPine specifically: swept 300 candidate seed strings through
      // the real branch-length formula (knotLengthJitter et al — see
      // buildConiferTreeGroup) and found the default 0/1/2 average 2.85-3.15
      // per branch against a true (large-sample) mean of ~3.32, while every
      // preset that doesn't override variantSeedIndices keeps its original
      // seed numbering untouched.
      const variantIdx = preset.variantSeedIndices?.[i] ?? i;
      const variantSeed = xfnv1a(`${presetKey}_variant_${variantIdx}`) >>> 0;
      const group = buildConiferTreeGroup(preset, variantSeed);
      // Canopy bounds in the variant's own local (unscaled) space — cached
      // once here instead of per-instance; callers scale by their own
      // instance's group.scale.x to get world-space canopy radius/underside
      // (see canopyClamp tagging in game.js's _buildZoneFloorMeshes).
      const leafMesh = group.children[group.children.length - 1];
      if (leafMesh && leafMesh.geometry && leafMesh !== group.children[0]) {
        leafMesh.geometry.computeBoundingBox();
        const bb = leafMesh.geometry.boundingBox;
        group.userData.canopyLocal = {
          radius: Math.max(Math.abs(bb.min.x), Math.abs(bb.max.x), Math.abs(bb.min.z), Math.abs(bb.max.z)),
          undersideY: bb.min.y,
        };
      }
      variants.push(group);
    }
    _treeVariantCache.set(presetKey, variants);
    return variants;
  }

  function buildTreeInstance(presetKey, preset, seedU32, opts) {
    const variants = getTreeVariants(presetKey, preset);
    const rand = mulberry32(seedU32);
    const variantIndex = Math.floor(rand() * variants.length) % variants.length;
    const variant = variants[variantIndex];
    const inst = variant.clone();
    // Same per-instance jitter buildConiferTreeGroup itself applies (see
    // instScale/instYaw above) — kept as a pure transform here too, so the
    // shared geometry is never touched, just the instance's own matrix.
    const instScale = 1 + (rand() - 0.5) * 0.14;
    const instYaw = rand() * Math.PI * 2;
    inst.rotation.y = instYaw;
    inst.scale.setScalar(instScale * (preset.scaleMul ?? 1));
    if (variant.userData.canopyLocal) inst.userData.canopyLocal = variant.userData.canopyLocal;
    // climbBranchChance is rolled HERE, per tile instance, not per shared
    // variant — every variant's geometry always includes a climb-branch
    // mesh (see buildConiferTreeGroup), so this is purely a per-instance
    // visibility/registration decision. Rolling it per variant instead (the
    // original design) meant the outcome was fixed for an entire session
    // across only TREE_VARIANT_COUNT (3) buckets — see the comment on that
    // block for the failure mode this replaced.
    if (variant.userData.climbBranchLocal) {
      // inst.clone() already copied climbBranchLocal onto inst.userData
      // (it was on the shared variant's own userData) — a failed roll has
      // to explicitly delete it back off, not just skip setting it, or
      // every instance would register a climb branch regardless of the
      // roll (only the mesh's own visibility would differ).
      const keep = opts?.forceClimbBranch || rand() < (preset.climbBranchChance ?? 0);
      if (!keep) {
        delete inst.userData.climbBranchLocal;
        const branchMesh = inst.getObjectByName?.('climbBranch');
        if (branchMesh) branchMesh.visible = false;
      } else {
        // Tags the branch mesh itself (not just the group) with where it
        // is, in local pre-instance-transform space (a/b endpoints, radius)
        // — this is what the tree GLB exporter tool reads to mark the node
        // as a recognizable climb branch in the exported asset's extras
        // (glTF exporters serialize mesh.userData as node "extras").
        const branchMesh = inst.getObjectByName?.('climbBranch');
        if (branchMesh) {
          branchMesh.userData = { ...(branchMesh.userData || {}), isClimbBranch: true, climbBranchLocal: variant.userData.climbBranchLocal };
        }
      }
    }
    return inst;
  }

  // Converts a placed tree instance's cached local-space climb-branch
  // endpoints (see buildConiferTreeGroup's climbBranchLocal block) into
  // world space, using the instance's own position/rotation.y/uniform scale
  // — the only transforms buildTreeInstance/its caller ever apply. Called by
  // game.js once a shadewood instance has been positioned, to register the
  // branch (if this instance has one) with ClimbSystem. Returns null when
  // this instance's tree shape rolled no climbable branch.
  function getClimbBranchWorld(inst) {
    const local = inst.userData?.climbBranchLocal;
    if (!local) return null;
    const yaw = inst.rotation.y, scale = inst.scale.x;
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    const toWorld = (p) => ({
      x: inst.position.x + (p.x * cos + p.z * sin) * scale,
      y: inst.position.y + p.y * scale,
      z: inst.position.z + (-p.x * sin + p.z * cos) * scale,
    });
    return { a: toWorld(local.a), b: toWorld(local.b), radius: local.radius * scale };
  }


  // Arbitrary-length generated log used by stacked architecture, fallen logs,
  // and any other system that needs a real foliage spine rather than a scaled
  // baked cylinder. The caller supplies the FINAL world-space length.
  function buildGeneratedLogMesh(options = {}) {
    const length = Math.max(0.04, Number(options.length) || 1); // Final unscaled spine length requested by the wall/furniture caller.
    const diameter = Math.max(0.02, Number(options.logDiameter ?? options.diameter) || 0.34); // Final unscaled log diameter used directly by radiusFn.
    const radialSegments = Math.max(5, Math.min(32, Math.round(Number(options.radialSegments) || 8))); // Circumference resolution shared with wall recipes.
    const ringSegments = Math.max(4, Math.min(64, Math.round(Number(options.ringSegments) || 12))); // Longitudinal foliage-spine resolution shared with wall recipes.
    const seedText = String(options.seed ?? 'generated-log'); // Stable authored seed used by real foliage noise.
    const seedU32 = xfnv1a(seedText); // Real foliage-generator FNV seed, rather than a duplicate wall-only hash implementation.
    const taper = clamp(Number.isFinite(Number(options.trunkTaper)) ? Number(options.trunkTaper) : 0.99, 0.5, 1.2); // End radius multiplier applied continuously along the generated spine.
    const wonk = clamp(Number.isFinite(Number(options.trunkWonk ?? options.wonkiness)) ? Number(options.trunkWonk ?? options.wonkiness) : 0.18, 0, 3); // Centerline organic displacement strength.
    const wonkScale = Math.max(0.01, Number(options.trunkWonkScale ?? options.wonkScale) || 1.35); // Frequency of real foliage centerline noise.
    const twist = Number.isFinite(Number(options.trunkTwist)) ? Number(options.trunkTwist) : 0.08; // Axial twist passed straight to buildWonkyChain.
    const noiseAmt = clamp(Number.isFinite(Number(options.trunkNoise ?? options.surfaceNoise)) ? Number(options.trunkNoise ?? options.surfaceNoise) : 0.35, 0, 3); // Radial bark silhouette noise strength.
    const noiseScale = Math.max(0.01, Number(options.trunkNoiseScale ?? options.surfaceNoiseScale) || 2.2); // Radial bark noise scale.
    const noiseOctaves = Math.max(1, Math.min(6, Math.round(Number(options.trunkNoiseOctaves) || 3))); // Radial bark fBm octave count.
    const baseRadius = diameter * 0.5; // Final world-space radius used by every real generated course.
    const chain = buildWonkyChain({ // Existing foliage spine/tube implementation remains the geometry authority.
      seedU32,
      length,
      ringSegments,
      origin: new T.Vector3(-length * 0.5, 0, 0),
      direction: new T.Vector3(1, 0, 0),
      bend: 0,
      wonk,
      wonkScale,
      gravityDir: new T.Vector3(0, -1, 0),
      curl: 0,
      radiusFn: (t01) => baseRadius * lerp(1, taper, clamp01(t01)),
      radialSegments,
      twist,
      noiseAmt,
      noiseScale,
      noiseOctaves,
    });
    const sourcePosition = chain.geom.getAttribute('position'); // Side-only foliage vertices returned by buildWonkyChain before architectural caps/UVs are added.
    const positions = Array.from(sourcePosition.array); // Mutable side vertex copy used to lock the longitudinal span to the requested final length.

    // buildSpine intentionally lets its noise perturb the centerline in X as
    // well as Y/Z. Architecture needs exact endpoints, so keep the SAME real
    // foliage Y/Z wonk while removing only that axial drift. The two endpoint
    // rings are additionally flattened onto exact X cap planes.
    for (let ring = 0; ring < ringSegments; ring++) {
      const t01 = ringSegments <= 1 ? 0 : ring / (ringSegments - 1); // Normalized ring position used to restore its authored axial center.
      const targetX = -length * 0.5 + length * t01; // Exact final center X of this ring; no post-generation mesh scaling required.
      const sourceCenterX = chain.spine.pts[ring].x; // Foliage spine's noisy axial center before architecture correction.
      const correctionX = targetX - sourceCenterX; // Axial-only correction that leaves foliage lateral wonk untouched.
      for (let side = 0; side < radialSegments; side++) {
        const vertex = (ring * radialSegments + side) * 3; // Position-array offset for this side vertex.
        positions[vertex] += correctionX;
        if (ring === 0 || ring === ringSegments - 1) positions[vertex] = targetX; // Flat end rings guarantee exact cap planes at +/- length/2.
      }
    }

    const uvs = []; // Cylindrical side UVs followed by planar cap UVs, matching WoodCutSurfaces.remapLogAtlasUv's layout contract.
    for (let ring = 0; ring < ringSegments; ring++) {
      const t01 = ringSegments <= 1 ? 0 : ring / (ringSegments - 1); // Side U coordinate running along the actual generated length.
      for (let side = 0; side < radialSegments; side++) uvs.push(t01, side / radialSegments);
    }
    const indices = Array.from(chain.geom.index.array); // Existing real foliage side triangles retained verbatim before caps are appended.
    for (const ring of [0, ringSegments - 1]) {
      const sideStart = ring * radialSegments; // Source perimeter ring used by this exposed cut end.
      const capStart = positions.length / 3; // First duplicated perimeter vertex for this hard-normal cap.
      let centerY = 0; // Average perimeter Y used as the planar cap fan center.
      let centerZ = 0; // Average perimeter Z used as the planar cap fan center.
      const centerX = ring === 0 ? -length * 0.5 : length * 0.5; // Exact architectural end plane for this cut face.
      for (let side = 0; side < radialSegments; side++) {
        const source = (sideStart + side) * 3; // Side-ring vertex offset copied into the independent cap surface.
        positions.push(positions[source], positions[source + 1], positions[source + 2]);
        centerY += positions[source + 1];
        centerZ += positions[source + 2];
        const angle = side / radialSegments * Math.PI * 2; // Disk angle used for log.png planar UVs.
        uvs.push(0.5 + Math.cos(angle) * 0.5, 0.5 + Math.sin(angle) * 0.5);
      }
      centerY /= radialSegments;
      centerZ /= radialSegments;
      const centerIndex = positions.length / 3; // Fan center index shared by every triangle on this cap.
      positions.push(centerX, centerY, centerZ);
      uvs.push(0.5, 0.5);
      for (let side = 0; side < radialSegments; side++) {
        const current = capStart + side; // Current duplicated perimeter vertex.
        const next = capStart + (side + 1) % radialSegments; // Next duplicated perimeter vertex.
        if (ring === 0) indices.push(centerIndex, next, current);
        else indices.push(centerIndex, current, next);
      }
    }

    let geometry = new T.BufferGeometry(); // Complete sides+caps generated geometry returned to architecture/furniture callers.
    geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.userData = { ...(geometry.userData || {}), foliageGeneratedLog: true, requestedLength: length, ringSegments, radialSegments };

    const barkColor = new T.Color(options.barkColor ?? '#372f18'); // Canonical bark tint accepted as CSS hex, integer, or THREE.Color-compatible input.
    const barkHex = `#${barkColor.getHexString()}`; // Hex form consumed by shared tree PNG atlas helpers.
    const wood = typeof window !== 'undefined' ? window.WoodCutSurfaces : null; // Optional shared PNG/cap material bridge present in game and architecture editors.
    let material = options.material || null; // Optional caller-shared atlas material avoids one texture canvas per unique course length.
    if (options.useWoodAtlas !== false && wood?.remapLogAtlasUv && wood?.makeLogAtlasMaterial) {
      geometry = wood.remapLogAtlasUv(geometry, { ringSegments, radialSegments });
      if (!material) material = wood.makeLogAtlasMaterial(T, barkHex);
    }
    if (!material) material = hexBarkMat(barkHex);

    const mesh = new T.Mesh(geometry, material); // Final foliage-generated log; callers may rotate/translate but must not length-scale it.
    mesh.name = 'FoliageGeneratedLog';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = {
      ...(mesh.userData || {}),
      foliageGeneratedLog: true,
      generatedLength: length,
      seed: seedText,
      logDiameter: diameter,
      noLongitudinalScaling: true,
      latestChange: 'Real buildWonkyChain foliage geometry generated at final requested length with cut-wood caps.',
    };
    return mesh;
  }

  function degToRad(d) { return d * Math.PI / 180; }

  // Surface growth uses real triangles, so authored walls, gables and furniture
  // share the same tube/noise generation as the foliage generator's own vines.
  function surfaceGrowthDefaults(kind) {
    const roots = kind === 'roots', sourceHex = roots ? TREE_PRESETS.shadewood.barkColorHex : TREE_PRESETS.shadewood.vineColorHex; // Roots inherit Shadewood's wood; vines inherit its vine finish.
    return (naturalSurfaces || window.NaturalSurfaceMaterials)?.surfaceDefaults?.(roots ? 'trunks' : 'vines', sourceHex) || {
      texture: roots ? 'assets/textures/wibbly_surface.png' : 'assets/textures/carved_smooth.png',
      color: '#' + sourceHex.toString(16).padStart(6, '0')
    };
  }

  function normalizeGrowthTexture(value, fallback) {
    if (value === '') return ''; // Explicitly blank means a solid-color strand.
    if (typeof value !== 'string') return fallback;
    const path = value.trim().replace(/^docs\//, ''); // Serialized paths stay portable across every editor and gameplay.
    if (!path) return '';
    return /^data:image\/png;base64,[a-z0-9+/=]+$/i.test(path) || /^(?:assets\/[^?#]*\.png(?:[?#].*)?|https?:\/\/[^\s]+)$/i.test(path) ? path : fallback;
  }

  function normalizeSurfaceGrowth(value = {}) {
    value = value && typeof value === 'object' ? value : {}; // Malformed imported layers use safe defaults.
    const defaults = surfaceGrowthDefaults(value.kind); // Also fills missing texture fields on existing saved layers.
    const finite = (key, fallback, lo, hi) => clamp(Number.isFinite(Number(value[key])) ? Number(value[key]) : fallback, lo, hi); // Bounds serialized editor inputs before allocating geometry.
    return { kind: value.kind === 'roots' ? 'roots' : 'vines', seed: String(value.seed ?? 'surface-1').slice(0, 128),
      style: ['cornerFill','wrap'].includes(value.style) ? value.style : 'natural', // Absent styles keep legacy recipes unchanged.
      density: finite('density',.45,.05,1), // Wrap density determines requested strands as a fraction of the per-surface limit.
      count: Math.floor(finite('count', 12, 1, 80)), strandLimit: Math.floor(finite('strandLimit', 80, 1, 80)),
      perSurface: value.perSurface === true, // Legacy Natural stays on original meshes unless explicitly opted into region-aware budgets.
      tunnelAsOpening: value.tunnelAsOpening === true, shrinkwrapFinal: value.shrinkwrapFinal === true,
      inset: finite('inset',0,-.5,.5), // Signed placement relative to the simplified surface, independent of positive clearance.
      length: finite('length', 3, .05, 30),
      radius: finite('radius', .025, .002, .3), offset: finite('offset', .008, 0, .2),
      curl: finite('curl', .4, 0, 2), color: /^#[0-9a-f]{6}$/i.test(value.color) ? value.color : defaults.color,
      texture: normalizeGrowthTexture(value.texture, defaults.texture),
      target: ['all', 'walls', 'floors', 'ceilings', 'shingles', 'selected'].includes(value.target) ? value.target : 'all',
      targetIds: Array.isArray(value.targetIds) ? value.targetIds.filter(id => typeof id === 'string').slice(0, 200) : [],
      wallOnly: value.wallOnly === true, // A cavern shell has its floor, ceiling and walls in one mesh.
      hangChance: finite('hangChance', 0, 0, 1), hangLength: finite('hangLength', 0, 0, 6) }; // Hanging tips are optional; existing authoring recipes are unchanged.
  }


  // Shared, reusable wilderness finish palette for roof shingles and foliage.
  function surfaceMaterialPalette(custom=[]) {
    const roots=surfaceGrowthDefaults('roots'),vines=surfaceGrowthDefaults('vines');
    const out=[
      {id:'shadewood-roots',name:'Shadewood bark / roots',kind:'roots',texture:roots.texture,color:roots.color},
      {id:'shadewood-vines',name:'Shadewood vines',kind:'vines',texture:vines.texture,color:vines.color}
    ];
    for(const [id,preset] of Object.entries(TREE_PRESETS)){
      const pretty=id.replace(/([a-z])([A-Z])/g,'$1 $2');
      if(Number.isInteger(preset.barkColorHex))out.push({
        id:'wilderness-'+id+'-bark',name:pretty+' bark',kind:'roots',texture:roots.texture,
        color:'#'+preset.barkColorHex.toString(16).padStart(6,'0')});
      if(Number.isInteger(preset.vineColorHex))out.push({
        id:'wilderness-'+id+'-vines',name:pretty+' vines',kind:'vines',texture:vines.texture,
        color:'#'+preset.vineColorHex.toString(16).padStart(6,'0')});
    }
    for(const entry of Array.isArray(custom)?custom:[]){
      if(!entry||typeof entry.name!=='string'||!/^#[0-9a-f]{6}$/i.test(entry.color))continue;
      out.push({id:String(entry.id||entry.name).slice(0,90),name:entry.name.slice(0,100),
        texture:normalizeGrowthTexture(entry.texture,''),color:entry.color,kind:entry.kind==='roots'?'roots':'vines'});
    }
    return out;
  }

  // Keep one authoritative architectural face policy across the House Editor,
  // both runtime house-generation paths, and building import. Do not interpret
  // tessellation for buried seam caps, doorway framing thickness or roof caps
  // as independently growable, exposed surfaces.
  function architecturalSurfaceSources(faces, options={}) {
    const wallLift=Math.max(0,Number(options.wallLift)||0),roofLift=Math.max(0,Number(options.roofLift)||0);
    const result=[],tunnelOuter=new Map(),all=Array.isArray(faces)?faces:[];
    for(const face of all)if(face?.tag==='entryTunnel'&&face.solidifiedWall&&
        ['north','south','east','west'].includes(face.extensionFace)&&Array.isArray(face.v)){
      const side=face.extensionFace,axis=(side==='north'||side==='south')?2:0;
      const values=face.v.map(v=>v[axis]);
      if(Math.max(...values)-Math.min(...values)>.001)continue;
      const key=(face.sourceTile?.x??'')+','+(face.sourceTile?.y??'')+':'+side;
      const outer=tunnelOuter.get(key),value=values[0],isMin=side==='north'||side==='west';
      if(outer===undefined||(isMin?value<outer:value>outer))tunnelOuter.set(key,value);
    }
    for(const face of all){
      if(!Array.isArray(face?.v)||face.v.length!==4||face.seamCap||face.watertightSeam||face.highlandFrustumBottom||face.highlandFrustumTop)continue;
      let role;
      if(face.tag==='wall')role='walls';
      else if(face.tag==='roof')role='roofs';
      else if(face.tag==='entryTunnel' && !options.tunnelAsOpening && face.solidifiedWall &&
        !face.doorwayFrame&&!face.explicitSkywardCap &&
        ['north','south','east','west'].includes(face.extensionFace)){
        // Only the exterior planar sheet of a solidified tunnel side, never
        // its wall-thickness returns or internal connecting/end caps.
        const coord=(face.extensionFace==='north'||face.extensionFace==='south')?2:0;
        const values=face.v.map(p=>p[coord]);
        if(Math.max(...values)-Math.min(...values)>.001)continue;
        const key=(face.sourceTile?.x??'')+','+(face.sourceTile?.y??'')+':'+face.extensionFace;
        if(Math.abs(values[0]-tunnelOuter.get(key))>.001)continue;
        role='walls';
      }else continue;
      result.push({
        vertices:[face.v[0],face.v[1],face.v[2],face.v[0],face.v[2],face.v[3]],
        id:'architectural-face-'+face.id,role,sectionId:String(face.highlandSectionRole||face.roofSectionRole||face.extensionType||''),
        renderLift:role==='roofs'?roofLift:wallLift
      });
    }
    return result;
  }

  // Furniture Author's surface recognition is a connected-face flood fill, with
  // a split-angle threshold. Buildings need the same definition across separate
  // authored quads, wall sections and gable meshes, rather than role/tag groups.
  // Unlike furniture, architecture may contain T-junctions: a wall's long upper
  // edge can meet several smaller gable triangles. Collinear interval overlap
  // therefore counts as a shared edge, but vertex-only contact never does.
  function recognizeArchitecturalSurfaceRegions(parent, sources=[], options={}) {
    const degree=Number.isFinite(Number(options.splitAngleDeg))?Number(options.splitAngleDeg):24; // Match Furniture Author's default recognition threshold.
    const cosThreshold=Math.cos(clamp(degree,0,180)*Math.PI/180);let faces=[];
    // An authored building can contain intersecting solid Highland sections.
    // Their *construction* face quads are not necessarily part of the visible
    // exterior. Derive each section's solid envelope from its true floor,
    // frustum top and roof planes; clip hidden fractions before region detection.
    const sectionVolumes=new Map();
    for(const face of Array.isArray(options.occlusionFaces)?options.occlusionFaces:[]){
      const section=String(face?.highlandSectionRole||face?.roofSectionRole||'');
      if(!section||!Array.isArray(face.v)||face.v.length!==4||face.seamCap)continue;
      if(!sectionVolumes.has(section))sectionVolumes.set(section,{id:section,roof:[],floor:null,eave:null});
      const volume=sectionVolumes.get(section);
      const xs=face.v.map(p=>p[0]),zs=face.v.map(p=>p[2]);
      const rect={minX:Math.min(...xs),maxX:Math.max(...xs),minZ:Math.min(...zs),maxZ:Math.max(...zs),
        y:face.v.reduce((acc,p)=>acc+p[1],0)/4};
      if(face.tag==='floor'&&face.highlandFrustumBottom)volume.floor=rect;
      if(face.tag==='ceiling'&&face.highlandFrustumTop)volume.eave=rect;
      if(face.tag==='roof')volume.roof.push([face.v[0],face.v[1],face.v[2]],[face.v[0],face.v[2],face.v[3]]);
    }
    const volumes=[...sectionVolumes.values()].filter(v=>v.floor&&v.eave);
    // Entrance tunnels act as window-like holes in the invisible growth guide,
    // not as plantable walls. Their contact line becomes an outer region edge.
    const entrances=[];
    if(options.tunnelAsOpening) {
      const tiles=new Map();
      for(const face of Array.isArray(options.occlusionFaces)?options.occlusionFaces:[]){
        if(face?.tag!=='entryTunnel'||!['floor','ceiling'].includes(face.extensionFace)||!Array.isArray(face.v))continue;
        const key=(face.sourceTile?.x??'?')+','+(face.sourceTile?.y??'?');
        if(!tiles.has(key))tiles.set(key,{});
        tiles.get(key)[face.extensionFace]={minX:Math.min(...face.v.map(p=>p[0])),maxX:Math.max(...face.v.map(p=>p[0])),
          minZ:Math.min(...face.v.map(p=>p[2])),maxZ:Math.max(...face.v.map(p=>p[2])),
          y:face.v.reduce((n,p)=>n+p[1],0)/face.v.length};
      }
      for(const t of tiles.values())if(t.floor&&t.ceiling)entrances.push({
        minX:t.floor.minX,maxX:t.floor.maxX,minZ:t.floor.minZ,maxZ:t.floor.maxZ,
        minY:Math.min(t.floor.y,t.ceiling.y),maxY:Math.max(t.floor.y,t.ceiling.y)});
    }
    const roofHeightAt=(volume,x,z)=>{
      let highest=-Infinity;
      for(const tri of volume.roof){
        const [a,b,c]=tri,den=(b[2]-c[2])*(a[0]-c[0])+(c[0]-b[0])*(a[2]-c[2]);
        if(Math.abs(den)<1e-8)continue;
        const u=((b[2]-c[2])*(x-c[0])+(c[0]-b[0])*(z-c[2]))/den;
        const v=((c[2]-a[2])*(x-c[0])+(a[0]-c[0])*(z-c[2]))/den;
        if(u<-.001||v<-.001||u+v>1.001)continue;
        highest=Math.max(highest,u*a[1]+v*b[1]+(1-u-v)*c[1]);
      }
      return highest;
    };
    const insideOtherSection=(p,sourceSection)=>{
      for(const volume of volumes){
        if(volume.id===sourceSection||p.y<volume.floor.y+.01)continue;
        if(p.x<=volume.floor.minX+.01||p.x>=volume.floor.maxX-.01||
           p.z<=volume.floor.minZ+.01||p.z>=volume.floor.maxZ-.01)continue;
        if(p.y<=volume.eave.y){
          const t=clamp((p.y-volume.floor.y)/Math.max(.01,volume.eave.y-volume.floor.y),0,1);
          const x0=lerp(volume.floor.minX,volume.eave.minX,t),x1=lerp(volume.floor.maxX,volume.eave.maxX,t);
          const z0=lerp(volume.floor.minZ,volume.eave.minZ,t),z1=lerp(volume.floor.maxZ,volume.eave.maxZ,t);
          if(p.x>x0+.01&&p.x<x1-.01&&p.z>z0+.01&&p.z<z1-.01)return true;
        }else if(p.y<roofHeightAt(volume,p.x,p.z)-.01)return true;
      }
      return false;
    };
    const exposedTriangles=(tri,section,depth=0,role='walls')=>{
      if((!section||!volumes.length)&&(!entrances.length||role!=='walls'))return [tri];
      const [a,b,c]=tri,center=a.clone().add(b).add(c).multiplyScalar(1/3);
      const hidden=[a,b,c,center].map(p=>insideOtherSection(p,section)||
        (role==='walls'&&entrances.some(t=>p.x>t.minX+.001&&p.x<t.maxX-.001&&
          p.z>t.minZ+.001&&p.z<t.maxZ-.001&&p.y>=t.minY-.01&&p.y<t.maxY+.001)));
      if(hidden.every(Boolean))return [];
      // Broad wall triangles can cross a small entrance even with all
      // vertices and centroid outside its aperture.
      const overlapsEntrance=role==='walls'&&entrances.some(t=>{
        const xs=[a.x,b.x,c.x],ys=[a.y,b.y,c.y],zs=[a.z,b.z,c.z];
        return Math.max(...xs)>t.minX&&Math.min(...xs)<t.maxX&&
          Math.max(...ys)>t.minY&&Math.min(...ys)<t.maxY&&
          Math.max(...zs)>t.minZ&&Math.min(...zs)<t.maxZ;
      });
      if(!hidden.some(Boolean)&&!overlapsEntrance)return [tri];
      if(depth>=(entrances.length&&role==='walls'?5:3))return hidden[3]?[]:[tri]; // At most 64 tiny subtriangles from a partially buried face.
      const ab=a.clone().add(b).multiplyScalar(.5),bc=b.clone().add(c).multiplyScalar(.5),ca=c.clone().add(a).multiplyScalar(.5);
      return [[a,ab,ca],[ab,b,bc],[ca,bc,c],[ab,bc,ca]]
        .flatMap(part=>exposedTriangles(part,section,depth+1,role));
    };
    parent.updateWorldMatrix(true,true);
    const inverse=parent.matrixWorld.clone().invert(),vertex=new T.Vector3();
    for(const source of Array.isArray(sources)?sources:[]){
      const role=String(source?.role||'walls'),points=[];
      if(Array.isArray(source?.vertices)){
        const v=source.vertices;
        const push=p=>{if(Array.isArray(p)&&p.length>=3&&p.slice(0,3).every(Number.isFinite))points.push(new T.Vector3(p[0],p[1],p[2]));};
        if(v.length===4){[v[0],v[1],v[2],v[0],v[2],v[3]].forEach(push);}
        else if(v.length%3===0)v.forEach(push);
      }else if(source?.sourceMesh?.isMesh&&Array.isArray(source.faceIndices)){
        const mesh=source.sourceMesh,geometry=mesh.geometry,pos=geometry?.getAttribute?.('position'),idx=geometry?.index;
        if(!pos)continue;
        const matrix=inverse.clone().multiply(mesh.matrixWorld),limit=idx?idx.count:pos.count;
        for(const raw of source.faceIndices.slice(0,100000)){
          const i=Math.floor(Number(raw));if(!Number.isFinite(i)||i<0||i*3+2>=limit)continue;
          for(let c=0;c<3;c++)points.push(vertex.fromBufferAttribute(pos,idx?idx.getX(i*3+c):i*3+c).clone().applyMatrix4(matrix));
        }
      }
      if(source?.constructionOnly)continue; // Seam caps and internal extension framing never define exposed boundaries.
      for(let i=0;i+2<points.length;i+=3){
        for(const [a,b,c] of exposedTriangles([points[i],points[i+1],points[i+2]],source.sectionId||'',0,role)){
          if(!Number.isFinite(a.x+a.y+a.z+b.x+b.y+b.z+c.x+c.y+c.z))continue;
          const normal=b.clone().sub(a).cross(c.clone().sub(a));
          if(normal.lengthSq()<1e-12)continue;
          normal.normalize();
          faces.push({vertices:[a,b,c],normal,role,renderLift:Math.max(0,Math.min(.6,Number(source.renderLift)||0))});
        }
      }
    }
    // Interior wall panels and their gable backing meshes can contain
    // coincident, same-facing pieces. These are covered construction surfaces,
    // not extra perimeter islands. Remove both complete duplicates and the
    // overlapping portions of partial duplicates before grouping faces.
    if(options.clipCoplanarOverlaps&&faces.length>1){
      const exposed=[],coverage=[],planeTolerance=.008;
      const box=vs=>({minX:Math.min(...vs.map(p=>p.x)),maxX:Math.max(...vs.map(p=>p.x)),
        minY:Math.min(...vs.map(p=>p.y)),maxY:Math.max(...vs.map(p=>p.y)),
        minZ:Math.min(...vs.map(p=>p.z)),maxZ:Math.max(...vs.map(p=>p.z))});
      const overlap=(a,b)=>a.minX<=b.maxX+.003&&b.minX<=a.maxX+.003&&
        a.minY<=b.maxY+.003&&b.minY<=a.maxY+.003&&
        a.minZ<=b.maxZ+.003&&b.minZ<=a.maxZ+.003;
      for(const original of faces){
        const originalBox=box(original.vertices),n=original.normal,plane=n.dot(original.vertices[0]);
        const covered=coverage.filter(prev=>prev.role===original.role&&prev.normal.dot(n)>.995&&
          Math.abs(n.dot(prev.vertices[0])-plane)<planeTolerance&&overlap(originalBox,prev.box));
        let visible=[original.vertices];
        for(const prev of covered){
          const prevTriangle=new T.Triangle(...prev.vertices);
          const clips=tri=>{const c=tri[0].clone().add(tri[1]).add(tri[2]).multiplyScalar(1/3);
            const points=[...tri,c],isCovered=points.map(p=>prevTriangle.containsPoint(p));
            return {isCovered,center:c};
          };
          const trim=(tri,depth)=>{
            const sample=clips(tri);
            if(sample.isCovered.every(Boolean))return [];
            if(!sample.isCovered.some(Boolean))return [tri];
            if(depth===2)return sample.isCovered[3]?[]:[tri]; // Small bounded fragments prevent editor rebuild cost from exploding.
            const [a,b,c]=tri,ab=a.clone().add(b).multiplyScalar(.5),
              bc=b.clone().add(c).multiplyScalar(.5),ca=c.clone().add(a).multiplyScalar(.5);
            return [[a,ab,ca],[ab,b,bc],[ca,bc,c],[ab,bc,ca]].flatMap(t=>trim(t,depth+1));
          };
          visible=visible.flatMap(v=>trim(v,0));
          if(!visible.length)break;
        }
        for(const vertices of visible){
          const area=vertices[1].clone().sub(vertices[0]).cross(vertices[2].clone().sub(vertices[0])).length()*.5;
          if(area<.0001)continue;
          exposed.push({...original,vertices,box:box(vertices)});
        }
        coverage.push({...original,box:originalBox}); // Compare later faces to ORIGINAL covering triangles, not hundreds of tiny trimmed fragments.
      }
      faces=exposed;
    }
    if(!faces.length)return [];
    const parentFace=faces.map((_,i)=>i),find=i=>{while(parentFace[i]!==i){parentFace[i]=parentFace[parentFace[i]];i=parentFace[i];}return i;};
    const unite=(a,b)=>{a=find(a);b=find(b);if(a!==b)parentFace[b]=a;};
    const lines=new Map();
    for(let i=0;i<faces.length;i++){
      const face=faces[i],p=face.vertices;
      for(let k=0;k<3;k++){
        const a=p[k],b=p[(k+1)%3],direction=b.clone().sub(a),length=direction.length();
        if(length<.012)continue;
        direction.multiplyScalar(1/length);
        // A canonical line direction and its moment group partially overlapping
        // edges without requiring identical triangulation at wall/gable seams.
        const d=[direction.x,direction.y,direction.z],axis=d.find(x=>Math.abs(x)>1e-7);
        if(axis<0)direction.negate();
        const moment=a.clone().cross(direction),round=x=>Math.round(x*100);
        const dirKey=[direction.x,direction.y,direction.z].map(x=>Math.round(x*1000)).join(',');
        const key=face.role+'|'+dirKey+'|'+[round(moment.x),round(moment.y),round(moment.z)].join(',');
        const t0=a.dot(direction),t1=b.dot(direction),start=Math.min(t0,t1),end=Math.max(t0,t1);
        if(!lines.has(key))lines.set(key,[]);
        lines.get(key).push({face:i,start,end});
      }
    }
    for(const entries of lines.values()){
      entries.sort((a,b)=>a.start-b.start);
      const active=[];
      for(const entry of entries){
        for(let i=active.length-1;i>=0;i--)if(active[i].end<entry.start+.0005)active.splice(i,1);
        for(const prev of active){
          if(prev.face===entry.face||Math.min(prev.end,entry.end)-Math.max(prev.start,entry.start)<.001)continue;
          if(faces[prev.face].normal.dot(faces[entry.face].normal)+1e-7>=cosThreshold)unite(prev.face,entry.face);
        }
        active.push(entry);
      }
    }
    const groups=new Map();
    for(let i=0;i<faces.length;i++){
      const key=find(i);
      if(!groups.has(key))groups.set(key,{faces:[],minIndex:i,role:faces[i].role,renderLift:0});
      const group=groups.get(key);
      group.faces.push(faces[i]);group.minIndex=Math.min(group.minIndex,i);
      group.renderLift=Math.max(group.renderLift,faces[i].renderLift);
    }
    return [...groups.values()].sort((a,b)=>a.minIndex-b.minIndex).map((region,index)=>({
      vertices:region.faces.flatMap(face=>face.vertices.map(p=>p.toArray())),
      role:region.role,id:'recognized-'+region.role+'-'+region.minIndex,
      label:'Recognized '+region.role+' surface '+(index+1),
      renderLift:region.renderLift,recognizedSurface:true
    }));
  }

  // Semantic navigation meshes are a non-rendered projection of authored plane faces
  // (houses/interiors) or named detected surface triangles (furniture). Keeping
  // them separate from cladding prevents micro-creases on bricks and logs from
  // redirecting Corner Fill and Wrap. Their only lifetime is the host group.
  function replaceSemanticSurfaceGuides(parent, sources = []) {
    const old = []; // Collected before mutation so nested guides cannot be skipped.
    parent.traverse(node => { if (node.userData?.surfaceFoliageGuide && node.userData.surfaceFoliageGuideOwner === parent.uuid) old.push(node); }); // Never remove guides owned by nested authored furniture.
    for (const node of old) {
      node.parent?.remove(node);
      node.geometry?.dispose();
      node.material?.dispose();
    }
    let count = 0; // Used by editor diagnostics and to detect an empty guide set.
    for (const source of Array.isArray(sources) ? sources : []) {
      const host = source?.sourceMesh?.isObject3D ? source.sourceMesh : parent;
      const positions = []; // Source-local coordinate triples, not the visible cladding geometry.
      if (Array.isArray(source?.vertices) && source.vertices.length >= 3) {
        const verts = source.vertices;
        const emit = p => { if (!Array.isArray(p) || p.length < 3 || !p.slice(0,3).every(Number.isFinite)) return false; positions.push(p[0],p[1],p[2]); return true; };
        if (verts.length === 4) {
          emit(verts[0]);emit(verts[1]);emit(verts[2]);emit(verts[0]);emit(verts[2]);emit(verts[3]);
        } else if (verts.length % 3 === 0) verts.forEach(emit);
      } else if (source?.sourceMesh?.isMesh && Array.isArray(source.faceIndices)) {
        const geom = source.sourceMesh.geometry, pos = geom?.getAttribute?.('position'), index = geom?.index;
        if (!pos) continue;
        const end = index ? index.count : pos.count;
        const vertex = new T.Vector3();
        for (const raw of source.faceIndices.slice(0,100000)) {
          const face = Math.floor(Number(raw));
          if (!Number.isFinite(face) || face < 0 || face*3+2 >= end) continue;
          for (let corner=0;corner<3;corner++) {
            vertex.fromBufferAttribute(pos,index ? index.getX(face*3+corner) : face*3+corner);
            if (Number.isFinite(vertex.x+vertex.y+vertex.z)) positions.push(vertex.x,vertex.y,vertex.z);
          }
        }
      }
      if (!positions.length || positions.length % 9) continue;
      const geometry = new T.BufferGeometry(); // One small immutable guide geometry per architectural/named surface.
      geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));
      const mesh = new T.Mesh(geometry,new T.MeshBasicMaterial());
      mesh.name = 'Surface navigation: ' + String(source.label || source.id || count);
      mesh.visible = false; mesh.layers.set(30); // Excluded from normal rendering and default UI raycasts.
      mesh.userData.surfaceFoliageGuide = true;
      mesh.userData.surfaceFoliageRecognizedRegion = source.recognizedSurface === true;
      mesh.userData.surfaceFoliageOpeningMode = source.openingMode === true;
      mesh.userData.surfaceFoliageGuideOwner = parent.uuid; // The generating room/furniture owns its guides, not nested prefabs.
      mesh.userData.surfaceFoliageGuideId = String(source.id || source.label || count);
      mesh.userData.surfaceFoliageRenderLift = Math.max(0,Math.min(.6,Number(source.renderLift)||0)); // Render over coarse cladding while navigating the original plane. // Preserve distinct named furniture patches when tracing shared edges.
      mesh.userData.surfaceFoliageRole = source.role || 'walls';
      mesh.userData.surfaceFoliageId = String(source.partId || source.id || '');
      host.add(mesh);
      count++;
    }
    parent.userData.surfaceGuideCount = count; // Available to mobile editor reports without console access.
    return count;
  }

  function surfaceTargets(parent, settings) {
    const targets = []; // Only authored surface meshes enter the sampler; generated growth and editor helpers are excluded.
    parent.traverse(object => {
      if (!object.isMesh || !object.geometry?.attributes?.position) return;
      if (settings.target === 'shingles' && /shinglebone/i.test(object.name || '')) return; // Hidden length-control bones are not roof surfaces and must never collect vines.
      let node = object, role = '', selected = false, excluded = false; // Ancestor tags keep grouped brick/log gables and multi-mesh furniture selectable.
      while (node) {
        const data = node.userData || {}; // Shared metadata is read without mutating the source definitions.
        excluded ||= !!data.surfaceFoliage || !!data.surfaceFoliageExclude || (settings.target === 'shingles' && (node.visible === false || /shinglebone/i.test(node.name || ''))); // Never follow hidden bone geometry or descendants on shingle-only vine layers.
        role ||= data.surfaceFoliageRole || (data.isWallBricks || data.isWallLogs ? 'walls' : '') || (data.interiorGable || data.interiorGableBricks || data.interiorGableLogs ? 'walls' : data.interiorCeilingSurface ? 'ceilings' : '');
        const id = String(data.authoredPartId ?? data.partId ?? data.faceId ?? data.surfaceFoliageId ?? ''); // An untagged mesh has no id and must never match a stray empty entry.
        selected ||= id !== '' && settings.targetIds.includes(id);
        if (node === parent) break;
        node = node.parent;
      }
      if (!excluded && (settings.target === 'all' || (settings.target === 'selected' ? selected : role === settings.target))) targets.push(object);
    });
    if(settings.target==='shingles' && (settings.style!=='natural'||settings.shrinkwrapFinal)){
      // Precisely authored roof planes are the navigation surface. Shingle GLBs
      // are FINISHING geometry: use them only in the optional shrinkwrap pass.
      const roofGuides=[];
      parent.traverse(mesh=>{if(mesh.isMesh&&mesh.userData?.surfaceFoliageGuide&&
        mesh.userData.surfaceFoliageGuideOwner===parent.uuid&&
        mesh.userData.surfaceFoliageRole==='roofs'&&
        !!mesh.userData.surfaceFoliageOpeningMode===settings.tunnelAsOpening)roofGuides.push(mesh);});
      if(roofGuides.length)return roofGuides;
    }
    if(settings.style!=='natural'||settings.shrinkwrapFinal){
      const guides=targets.filter(mesh=>mesh.userData?.surfaceFoliageGuide &&
        mesh.userData.surfaceFoliageGuideOwner===parent.uuid &&
        !!mesh.userData.surfaceFoliageOpeningMode===settings.tunnelAsOpening);
      if(guides.length)return guides;
    }
    return targets.filter(mesh=>!mesh.userData?.surfaceFoliageGuide); // Free growth never reads invisible guide duplicates.
  }


  // Compute surface edges once per authored recipe, sharing the existing spatial
  // triangle index. Mesh seams with different normals qualify as real corners;
  // triangulation diagonals and coplanar brick joins do not.
  function surfaceGuideEdges(triangles,cells,large,keyOf,cellSize,radius,detectAdjacent) {
    const edges=new Map(), quant=p=>Math.round(p.x*100)+','+Math.round(p.y*100)+','+Math.round(p.z*100); // Quantization only groups authored endpoints; the spline itself uses their full precision.
    for(const record of triangles) {
      const vs=[record.triangle.a,record.triangle.b,record.triangle.c];
      for(let i=0;i<3;i++){
        const a=vs[i],b=vs[(i+1)%3],ak=quant(a),bk=quant(b);
        if(ak===bk)continue;
        const key=ak<bk?ak+'|'+bk:bk+'|'+ak;
        let edge=edges.get(key);
        if(!edge){edge={a:a.clone(),b:b.clone(),ak,bk,normal:record.normal,record,faces:1,other:null,otherPlane:null,length:a.distanceTo(b),sourceId:record.sourceSurfaceId,semanticBoundary:false};edges.set(key,edge);}
        else{
          edge.faces++;
          if(edge.sourceId!==record.sourceSurfaceId)edge.semanticBoundary=true;
          const dot=edge.normal.dot(record.normal);
          if(dot<.91&&dot>-.6){edge.other=record.normal;edge.otherPlane=record.plane;}
        }
      }
    }
    const originalEdges=Array.from(edges.values());
    let candidates=originalEdges;
    if(detectAdjacent){
      // A long wall's seam may meet two or more shorter wall panels (T-junction).
      // Split at their real endpoints BEFORE classifying adjacent surfaces.
      // Otherwise a midpoint probe treats the ENTIRE long edge as a corner,
      // even where the shorter wall stops, and the spline cannot cross its seam.
      const border=originalEdges.filter(edge=>edge.faces===1);
      const ends=border.flatMap(edge=>[edge.a,edge.b]);
      // Sort endpoints on each coordinate once. A vertical wall edge then scans
      // only endpoints within its Y interval, not every vertex in the house.
      const axes=[ends.slice().sort((a,b)=>a.x-b.x),ends.slice().sort((a,b)=>a.y-b.y),ends.slice().sort((a,b)=>a.z-b.z)];
      const value=(p,axis)=>axis===0?p.x:axis===1?p.y:p.z;
      const lowerBound=(sorted,axis,low)=>{
        let l=0,r=sorted.length;
        while(l<r){const mid=(l+r)>>1;if(value(sorted[mid],axis)<low)l=mid+1;else r=mid;}
        return l;
      };
      const toleranceSq=.012*.012;
      candidates=[];
      for(const edge of originalEdges){
        if(edge.faces!==1||edge.length<.3||ends.length>30000){candidates.push(edge);continue;}
        const delta=edge.b.clone().sub(edge.a),lengthSq=delta.lengthSq(),ts=[0,1];
        const pad=.012,axis=Math.abs(delta.x)>=Math.abs(delta.y)&&Math.abs(delta.x)>=Math.abs(delta.z)?0:Math.abs(delta.y)>=Math.abs(delta.z)?1:2;
        const sorted=axes[axis],min=Math.min(value(edge.a,axis),value(edge.b,axis))-pad,max=Math.max(value(edge.a,axis),value(edge.b,axis))+pad;
        for(let i=lowerBound(sorted,axis,min);i<sorted.length&&value(sorted[i],axis)<=max;i++){
          const p=sorted[i];
          if(p.x<Math.min(edge.a.x,edge.b.x)-pad||p.x>Math.max(edge.a.x,edge.b.x)+pad||
             p.y<Math.min(edge.a.y,edge.b.y)-pad||p.y>Math.max(edge.a.y,edge.b.y)+pad||
             p.z<Math.min(edge.a.z,edge.b.z)-pad||p.z>Math.max(edge.a.z,edge.b.z)+pad)continue;
          const t=delta.dot(p.clone().sub(edge.a))/lengthSq;
          if(t<=.025/edge.length||t>=1-.025/edge.length)continue;
          const projected=edge.a.clone().addScaledVector(delta,t);
          if(projected.distanceToSquared(p)<=toleranceSq)ts.push(t);
        }
        if(ts.length===2){candidates.push(edge);continue;}
        ts.sort((x,y)=>x-y);
        for(let i=1;i<ts.length;i++){
          if((ts[i]-ts[i-1])*edge.length<.025)continue;
          const left=edge.a.clone().addScaledVector(delta,ts[i-1]);
          const right=edge.a.clone().addScaledVector(delta,ts[i]);
          candidates.push({...edge,a:left,b:right,ak:quant(left),bk:quant(right),length:left.distanceTo(right),other:null,otherPlane:null});
        }
      }
    }
    const corners=[],boundaries=[],scratch=new T.Vector3(),gap=Math.max(.025,Math.min(.09,radius*1.15)),gapSq=gap*gap; // Near-miss walls have a small adjacency tolerance.
    for(const edge of candidates){
      if(edge.length<.025)continue;
      if(detectAdjacent&&!edge.other&&edge.faces===1){
        const mid=edge.a.clone().add(edge.b).multiplyScalar(.5),x=Math.floor(mid.x/cellSize),y=Math.floor(mid.y/cellSize),z=Math.floor(mid.z/cellSize),visited=new Set();
        const probe=list=>{
          for(const other of list||[]){
            if(other===edge.record||visited.has(other))continue;
            visited.add(other);
            const dot=other.normal.dot(edge.normal),planeGap=other.normal.dot(mid)-other.plane;
            if(edge.record.recognizedRegion&&other.recognizedRegion&&
               edge.sourceId===other.sourceSurfaceId&&dot>.985&&Math.abs(planeGap)<.012){
              // Coplanar T-junctions belong to one recognized surface even if
              // their triangle edges were subdivided differently. A midpoint
              // that lies along another triangle's *edge* is an internal seam.
              const vs=[other.triangle.a,other.triangle.b,other.triangle.c];
              for(let j=0;j<3;j++){
                const side=vs[(j+1)%3].clone().sub(vs[j]);
                const sideSq=side.lengthSq();
                if(sideSq<1e-10)continue;
                const t=clamp(mid.clone().sub(vs[j]).dot(side)/sideSq,0,1);
                scratch.copy(vs[j]).addScaledVector(side,t);
                if(scratch.distanceToSquared(mid)<.008*.008){
                  edge.hiddenInternal=true;return true;
                }
              }
            }
            if(dot>.9||dot<-.6||planeGap*planeGap>gapSq)continue;
            other.triangle.closestPointToPoint(mid,scratch);
            if(scratch.distanceToSquared(mid)<gapSq){
              edge.other=other.normal;edge.otherPlane=other.plane;return true;
            }
          }
          return false;
        };
        if(!probe(large))outer:for(let ix=-1;ix<=1;ix++)for(let iy=-1;iy<=1;iy++)for(let iz=-1;iz<=1;iz++){
          if(probe(cells.get(keyOf(x+ix,y+iy,z+iz))))break outer;
        }
      }
      if(edge.hiddenInternal)continue;
      if(edge.other)corners.push(edge);
      else if(edge.faces===1||edge.semanticBoundary)boundaries.push(edge); // Wrap starts on named furniture-region edges too.
    }
    return {corners,boundaries,all:edges,outlineRecognized:triangles.some(record=>record.recognizedRegion)};
  }

  function appendCornerGrowth(guide,settings,random,seed,geometries) {
    const edges=guide.outlineRecognized
      ? guide.corners.concat(guide.boundaries) // A recognized flat wall or gable has an outer perimeter too.
      : guide.corners,adj=new Map(); // Legacy natural-geometry Corner Fill still follows sharp intersections only.
    if(!edges.length)return;
    for(const edge of edges)for(const key of [edge.ak,edge.bk]){
      if(!adj.has(key))adj.set(key,[]);
      adj.get(key).push(edge);
    }
    const maxRings=128,spacing=Math.max(.14,settings.length/(maxRings-8)); // Bounded subdivisions keep long straight edges smooth without frame work.
    for(let strand=0;strand<settings.count;strand++){
      let edge=edges[Math.min(edges.length-1,Math.floor((strand+random())*edges.length/settings.count))];
      let from=random()<.5?edge.ak:edge.bk,travelled=0;
      const used=new Set(),samples=[]; // Raw points remain EXACTLY on the mesh seam until the final cosmetic pass.
      while(edge&&travelled<settings.length&&used.size<64&&samples.length<maxRings){
        used.add(edge);
        const a=from===edge.ak?edge.a:edge.b,b=from===edge.ak?edge.b:edge.a;
        const tangent=b.clone().sub(a).normalize(),length=Math.min(edge.length,settings.length-travelled);
        const pieces=Math.max(1,Math.ceil(length/spacing));
        for(let i=samples.length?1:0;i<=pieces&&samples.length<maxRings;i++){
          const fraction=i/pieces;
          samples.push({point:a.clone().addScaledVector(tangent,length*fraction),
            tangent,edge,fraction,distance:travelled+length*fraction}); // Polyline samples lie directly on the original edge.
        }
        travelled+=length;
        if(length<edge.length-1e-6)break;
        const end=from===edge.ak?edge.bk:edge.ak;
        let best=null,bestDot=-.2;
        for(const next of adj.get(end)||[]){
          if(used.has(next))continue;
          const origin=end===next.ak?next.a:next.b,tip=end===next.ak?next.b:next.a;
          const dot=tangent.dot(tip.clone().sub(origin).normalize());
          if(dot>bestDot){best=next;bestDot=dot;}
        }
        edge=best;from=end;
      }
      if(samples.length<2)continue;
      const phase=random()*Math.PI*2,secondPhase=random()*Math.PI*2;
      const points=samples.map(sample=>{
        const part=sample.edge,n0=part.normal,n1=part.other;
        const raw=sample.point.clone(); // The authoritative edge, before clearance or curl.
        if(n1&&Number.isFinite(part.otherPlane)){
          // At a tiny gap between two wall panels, the source edge lies on only
          // one plane. Move its *base* centerline onto the actual intersection of
          // both infinite planes, clamped to the same small adjacency tolerance.
          const dot=n0.dot(n1),along=n1.clone().addScaledVector(n0,-dot),denom=along.lengthSq();
          if(denom>.08){
            const correction=(part.otherPlane-n1.dot(raw))/denom;
            if(Math.abs(correction)*Math.sqrt(denom)<=.09)raw.addScaledVector(along,correction);
          }
        }
        const offset=settings.offset+settings.inset+(part.record.renderLift||0); // Clearance remains user-authored; omitting the radius lets the tube nest against both faces.
        const dot=n1?n0.dot(n1):1;
        const outward=n1&&dot>-.75
          ? n0.clone().add(n1).multiplyScalar(offset/(1+dot)) // Intersection of the two outward-offset wall planes.
          : n0.clone().multiplyScalar(offset); // Flat/gapped-wall fallback remains finite.
        raw.add(outward); // Rendering clearance is separate from the edge-following path.
        if(settings.curl>0){
          const envelope=Math.sin(Math.PI*sample.fraction)**2; // At each authored vertex, return exactly to the original edge.
          const magnitude=Math.min(settings.radius*.7,settings.radius*.32*settings.curl)*envelope;
          if(magnitude>0){
            const faceNormal=n1&&dot>-.75?n0.clone().add(n1).normalize():n0.clone();
            const across=sample.tangent.clone().cross(faceNormal).normalize(); // Curl stays transverse to the seam, not along its length.
            raw.addScaledVector(across,Math.sin(sample.distance*(2.4+settings.curl*1.4)+phase)*magnitude);
            raw.addScaledVector(faceNormal,Math.sin(sample.distance*5.1+secondPhase)*magnitude*.3); // A subtle outward wonk after edge alignment.
          }
        }
        return raw;
      });
      geometries.push(buildMeshFromSpineWithRadiusFn({seedU32:seed+strand,spine:framesFromPoints(points),
        radiusFn:t=>settings.radius*lerp(1,.25,t),radialSegments:5,twist:0,noiseAmt:.08,noiseScale:1.2,noiseOctaves:2,stretchUv:true}));
    }
  }

  // Wrap is Natural-like surface wandering with TWO hard boundary constraints.
  // Each accepted strand reserves one start slot and one END slot on the same
  // recognized surface's true outside edges. Density changes boundary spacing,
  // never scans for uncovered interior tiles or paints a covering sheet.
  function appendEdgeToEdgeWrap(guide,settings,random,seed,geometries,triangles,cells,large,keyOf,cellSize) {
    const edges=guide.outlineRecognized
      ? guide.boundaries // Region seams and triangulation edges are NOT endpoints.
      : guide.boundaries.length?guide.boundaries:guide.corners;
    const perimeter=edges.reduce((n,e)=>n+e.length,0),wanted=Math.max(1,Math.round(settings.density*settings.strandLimit)); // Density replaces redundant Wrap count.
    const longest=edges.reduce((max,edge)=>Math.max(max,edge.length),0);
    const spacing=Math.max(settings.radius*2.1,Math.min(longest/2,perimeter/Math.max(2,wanted*2)*.75)); // Density already controls count, never applies a second hidden density multiplier.
    const slots=[];let seenSlots=0;
    const maxSlots=Math.max(64,Math.min(960,wanted*12)); // Bounded even on heavily tessellated imported meshes.
    if(!edges.length||wanted<1)return {requested:wanted,generated:0,capacity:0,spacing,endpoints:[]};
    for(const edge of edges){
      const usable=edge.length<settings.radius*1.2?0:Math.max(1,Math.floor(edge.length/spacing));
      const samples=Math.min(256,usable);
      for(let i=0;i<samples;i++){
        const t=(i+.5)/samples;
        const slot={edge,point:edge.a.clone().lerp(edge.b,t)};
        seenSlots++;
        if(slots.length<maxSlots)slots.push(slot);
        else { // Reservoir sampling spreads the bounded endpoint budget across ALL edges.
          const index=Math.floor(random()*seenSlots);
          if(index<maxSlots)slots[index]=slot;
        }
      }
    }
    // Deterministic spatial reservation, not a surface-area occupancy grid.
    // Prevents two strands starting/ending on nearly the same bit of perimeter.
    const reserved=[],ends=[],maxStep=Math.min(.15,Math.max(.025,settings.radius*3));
    const farEnough=p=>reserved.every(x=>x.distanceToSquared(p)>=spacing*spacing);
    const shuffled=slots.slice();
    for(let i=shuffled.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];}
    let attempts=0;
    const scratch=new T.Vector3();
    const nearest=(candidate,normal,step)=>{
      const cx=Math.floor(candidate.x/cellSize),cy=Math.floor(candidate.y/cellSize),cz=Math.floor(candidate.z/cellSize);
      const checked=new Set(),potentials=[];
      const add=list=>{for(const rec of list||[])if(!checked.has(rec)){checked.add(rec);potentials.push(rec);}};
      add(large);
      for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++)add(cells.get(keyOf(cx+x,cy+y,cz+z)));
      let found=null,point=null,distSq=Math.pow(step*1.35,2);
      for(const rec of potentials){
        if(rec.normal.dot(normal)<-.3)continue;
        const planeGap=rec.normal.dot(candidate)-rec.plane;
        if(planeGap*planeGap>=distSq)continue;
        rec.triangle.closestPointToPoint(candidate,scratch);
        const d=scratch.distanceToSquared(candidate);
        if(d<distSq){distSq=d;point=scratch.clone();found=rec;}
      }
      return found?{point,record:found}:null;
    };
    for(const start of shuffled){
      if(ends.length>=wanted||attempts>=Math.min(640,Math.max(50,wanted*10)))break;
      if(!farEnough(start.point))continue;
      attempts++;
      const minSpan=Math.max(settings.radius*3.5,maxStep*3);
      const possible=slots.filter(end=>end.edge!==start.edge&&farEnough(end.point)&&
        end.point.distanceTo(start.point)>=minSpan&&end.point.distanceTo(start.point)<=settings.length*.97);
      if(!possible.length)continue;
      // Pick from several candidates to obtain wandering strands with varied
      // length and orientation, instead of a fixed shortest-path fan.
      const end=possible[Math.floor(random()*possible.length)];
      let anchor=start.point.clone(),normal=start.edge.normal.clone(),direction=null;
      let current=start.edge.record;
      const pointAt=(p,n,record)=>p.clone().addScaledVector(n,settings.radius+settings.offset+settings.inset+(record.renderLift||0));
      const points=[pointAt(anchor,normal,current)],limit=Math.min(400,Math.ceil(settings.length/maxStep)),step=settings.length/limit;
      let travelled=0,reached=false;
      const inward=start.edge.record.triangle.a.clone().add(start.edge.record.triangle.b)
        .add(start.edge.record.triangle.c).multiplyScalar(1/3).sub(anchor);
      inward.addScaledVector(normal,-inward.dot(normal));
      for(let i=0;i<limit;i++){
        const remaining=end.point.clone().sub(anchor),distance=remaining.length();
        if(distance>settings.length-travelled+step*.5)break; // Length caps cumulative walking, not just endpoint distance.
        // An endpoint is only accepted when the actual surface walk reached it.
        if(distance<=step*1.5&&travelled>minSpan*.6){
          points.push(pointAt(end.point,end.edge.normal,end.edge.record));reached=true;break;
        }
        const toward=remaining.clone().addScaledVector(normal,-remaining.dot(normal));
        if(toward.lengthSq()<1e-9){
          if(direction)toward.copy(direction);
          else toward.copy(inward);
        }
        if(toward.lengthSq()<1e-9)break;
        toward.normalize();
        if(!direction){
          direction=toward.clone().multiplyScalar(.7).addScaledVector(inward.normalize(),.3).normalize();
          if(direction.lengthSq()<1e-9)direction.copy(toward);
        }
        // Natural-like gentle, seeded curl; an increasing target pull ensures
        // that free wandering resolves at a second edge instead of dying inside.
        const bend=(random()-.5)*settings.curl*.55*Math.min(1,distance/(step*5));
        const aimed=toward.clone().applyAxisAngle(normal,bend);
        const preferred=direction.clone().multiplyScalar(.3).addScaledVector(aimed,.7).normalize();
        const turns=[0,.35,-.35,.75,-.75];
        let choice=null,score=Infinity;
        for(const turn of turns){
          const tangent=preferred.clone().applyAxisAngle(normal,turn);
          const candidate=anchor.clone().addScaledVector(tangent,Math.min(step,distance));
          const hit=nearest(candidate,normal,step);
          if(!hit||hit.point.distanceToSquared(anchor)<step*step*.07)continue;
          const newDist=hit.point.distanceToSquared(end.point);
          const value=newDist+turn*turn*step*step*.05+candidate.distanceToSquared(hit.point);
          if(value<score){score=value;choice=hit;}
        }
        if(!choice)break;
        const movement=choice.point.clone().sub(anchor),advanced=movement.length();
        if(advanced<step*.25)break;
        direction.copy(movement).normalize();anchor=choice.point;
        normal.copy(choice.record.normal);current=choice.record;travelled+=advanced;
        points.push(pointAt(anchor,normal,current));
      }
      if(!reached||points.length<3)continue; // Never leave an orphan strand ending mid-wall.
      geometries.push(buildMeshFromSpineWithRadiusFn({seedU32:seed+attempts,
        spine:framesFromPoints(points),radiusFn:t=>settings.radius*lerp(1,.18,t),
        radialSegments:5,twist:0,noiseAmt:.15,noiseScale:1.2,noiseOctaves:2,stretchUv:true}));
      reserved.push(start.point,end.point);
      ends.push({start:start.point.toArray(),end:end.point.toArray(),
        startEdge:start.edge.ak+'|'+start.edge.bk,endEdge:end.edge.ak+'|'+end.edge.bk});
    }
    return {requested:wanted,generated:ends.length,capacity:slots.length,spacing,endpoints:ends,attempts};
  }


  // Optional finishing pass: leave path planning on the clean, authored surface
  // and displace complete tube rings onto the outermost visible cladding. Sampling
  // is budgeted and interpolated along each strand, avoiding per-vertex raycasts.
  function shrinkwrapSurfaceStrands(geometries,parent,settings,triangles,cells,large,keyOf,cellSize) {
    if(!settings.shrinkwrapFinal||!geometries.length)return {rays:0,hits:0};
    parent.updateWorldMatrix(true,true);
    const visible=[],wallCladding=[];
    parent.traverse(mesh=>{
      if(!mesh.isMesh||!mesh.visible||mesh.userData?.surfaceFoliageGuide||mesh.userData?.surfaceFoliage) return;
      let node=mesh,role='',clad=false,excluded=false;
      while(node){
        if(node.userData?.surfaceFoliage || node.userData?.surfaceFoliageExclude)excluded=true;
        role ||= node.userData?.surfaceFoliageRole || (node.userData?.isWallBricks||node.userData?.isWallLogs?'walls':'');
        clad ||= !!(node.userData?.isWallBricks||node.userData?.isWallLogs);
        if(node===parent)break;
        node=node.parent;
      }
      if(!excluded&&(settings.target==='all'||role===settings.target)){
        visible.push(mesh);if(clad)wallCladding.push(mesh);
      }
    });
    const physical=settings.target==='walls'&&wallCladding.length?wallCladding:visible;
    if(!physical.length)return {rays:0,hits:0};
    const toWorld=parent.matrixWorld,toLocal=parent.matrixWorld.clone().invert(),normalMat=new T.Matrix3().getNormalMatrix(toWorld);
    const raycaster=new T.Raycaster(), scratch=new T.Vector3(),candidate=new T.Vector3(),origin=new T.Vector3(),direction=new T.Vector3();
    const budget=1200, totalRings=geometries.reduce((n,g)=>n+Math.floor(g.getAttribute('position').count/6),0);
    const stride=Math.max(1,Math.ceil(totalRings/budget));let rays=0,hits=0;
    for(const geometry of geometries){
      const pos=geometry.getAttribute('position'),rings=Math.floor(pos.count/6),movements=new Array(rings);
      const centers=[];
      for(let i=0;i<rings;i++){
        const center=new T.Vector3();
        for(let j=0;j<5;j++)center.add(scratch.fromBufferAttribute(pos,i*6+j));
        centers.push(center.multiplyScalar(.2));
      }
      const stops=[0];for(let i=stride;i<rings-1;i+=stride)stops.push(i);
      if(rings>1)stops.push(rings-1);
      for(const i of stops){
        const center=centers[i],x=Math.floor(center.x/cellSize),y=Math.floor(center.y/cellSize),z=Math.floor(center.z/cellSize);
        let closest=null,dist=Infinity;
        const scan=(list)=>{
          for(const record of list||[]){
            if(!record||record.edgeOnly)continue;
            record.triangle.closestPointToPoint(center,candidate);
            const d=candidate.distanceToSquared(center);
            if(d<dist){dist=d;closest=record;}
          }
        };
        scan(large);
        for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(let dz=-1;dz<=1;dz++)scan(cells.get(keyOf(x+dx,y+dy,z+dz)));
        if(!closest){movements[i]=new T.Vector3();continue;}
        direction.copy(closest.normal).applyMatrix3(normalMat).normalize();
        origin.copy(center).applyMatrix4(toWorld).addScaledVector(direction,.8);
        raycaster.set(origin,direction.clone().negate());
        raycaster.far=1.7;rays++;
        const hit=raycaster.intersectObjects(physical,false)[0];
        if(!hit){movements[i]=new T.Vector3();continue;}
        hits++;
        // Follow the actual visible surface, retaining tube radius and the
        // signed user inset. The original guide's renderLift is superseded.
        const physicalPoint=hit.point.clone().addScaledVector(direction,settings.radius+settings.offset+settings.inset);
        movements[i]=physicalPoint.applyMatrix4(toLocal).sub(center);
      }
      for(let stop=1;stop<stops.length;stop++){
        const a=stops[stop-1],b=stops[stop],moveA=movements[a],moveB=movements[b];
        for(let i=a+(stop===1?0:1);i<=b;i++){
          const t=b===a?0:(i-a)/(b-a),move=moveA.clone().lerp(moveB,t); // Each shared stop ring must be displaced exactly once.
          for(let j=0;j<6;j++){const index=i*6+j;pos.setXYZ(index,pos.getX(index)+move.x,pos.getY(index)+move.y,pos.getZ(index)+move.z);}
        }
      }
      pos.needsUpdate=true;geometry.computeBoundingSphere();
    }
    return {rays,hits};
  }

  const caveSurfaceSamplingCache = new WeakMap(); // Shares costly immutable cavern-wall triangle indexes between roots and vines, without retaining unloaded scenes.
  function buildSurfaceGrowth(parent, input = {}) {
    const settings = normalizeSurfaceGrowth(input); // Same sanitized recipe is stored by every authoring tool.
    const group = new T.Group(); // Geometry is expressed in the target parent's local space and follows its later transform.
    group.name = 'Surface ' + settings.kind;
    group.userData.surfaceFoliage = true;
    // Each recognized architectural surface owns its OWN count and limit, not
    // a slice of one whole-building count. Dispatch once per existing guide;
    // reusing the same generator keeps texture, seeding, density and movement
    // behavior consistent with Furniture Author's named patches.
    if (!input?._surfaceRegionOnly && settings.target!=='shingles' &&
        (settings.perSurface || settings.style!=='natural')) {
      const regions=surfaceTargets(parent,{...settings,style:'cornerFill'}).filter(mesh=>
        mesh.userData?.surfaceFoliageGuide &&
        mesh.userData.surfaceFoliageGuideOwner===parent.uuid &&
        mesh.userData.surfaceFoliageRecognizedRegion===true && !!mesh.userData.surfaceFoliageOpeningMode===settings.tunnelAsOpening);
      if(regions.length){
        const each=settings.style==='wrap'?Math.max(1,Math.round(settings.density*settings.strandLimit)):Math.min(settings.count,settings.strandLimit),details=[];
        const stats={meshes:regions.length,instances:regions.length,triangles:0,coverTriangles:0,
          guideCorners:0,guideBoundaries:0,shrinkwrapRays:0,shrinkwrapHits:0,guidedBySemanticSurfaces:true,perSurface:true,
          strandLimit:settings.strandLimit,surfaces:regions.length,requestedPerSurface:settings.count,
          strandsPerSurface:each,generatedStrands:0};
        for(const [idx,region] of regions.entries()){
          const part=buildSurfaceGrowth(parent,{...input,count:each,_surfaceRegionOnly:region.userData.surfaceFoliageGuideId,
            seed:settings.seed+':'+region.userData.surfaceFoliageGuideId});
          const metrics=part.userData.surfaceGrowthStats||{};
          const produced=(part.userData.generatedStrands||0);
          stats.triangles+=metrics.triangles||0;
          stats.coverTriangles+=metrics.coverTriangles||0;
          stats.guideCorners+=metrics.guideCorners||0;
          stats.guideBoundaries+=metrics.guideBoundaries||0;
          stats.shrinkwrapRays+=metrics.shrinkwrapRays||0;
          stats.shrinkwrapHits+=metrics.shrinkwrapHits||0;
          stats.generatedStrands+=produced;
          details.push({id:region.userData.surfaceFoliageGuideId,region:idx+1,
            requested:each,actual:produced,triangles:metrics.triangles||0});
          for(const child of [...part.children])group.add(child); // Keep final geometry flat, preserving existing editor/export readers.
        }
        group.userData.surfaceGrowthStats=stats;
        group.userData.surfaceGrowthSurfaces=details;
        group.userData.diagnostics=settings.kind+' ('+settings.style+'): '+regions.length+
          ' recognized surfaces, '+each+' strands/surface (max '+settings.strandLimit+'), '+stats.generatedStrands+' produced.';
        return group;
      }
    }
    const useSharedSampling = input?.reuseSurfaceSampling === true && !!parent.geometry; // Only generated, immutable cave shells opt in; editor meshes still resample after authoring edits.
    const existingSampling = useSharedSampling ? caveSurfaceSamplingCache.get(parent) : null; // Geometry replacement invalidates the prior index.
    const shared = existingSampling?.geometry === parent.geometry && existingSampling?.wallOnly === settings.wallOnly ? existingSampling : null;
    const targets = shared?.targets || surfaceTargets(parent,
      input?._surfaceRegionOnly ? {...settings,style:'cornerFill'} : settings).filter(mesh=>
      !input?._surfaceRegionOnly || (mesh.userData?.surfaceFoliageGuide && mesh.userData.surfaceFoliageGuideId===input._surfaceRegionOnly)); // Natural explicitly opted into per-surface counts samples the same exposed guide; legacy Natural remains on raw visible meshes.
    const triangles = shared?.triangles || [], large = shared?.large || [], cells = shared?.cells || new Map(), candidates = []; // Cached wall triangles and spatial buckets serve both growth kinds.
    let stamp = 0; // Per-step visit mark: dedupes records that overlap several buckets without a Set insertion per record.
    const gather = list => { for (const record of list) if (record.stamp !== stamp) { record.stamp = stamp; candidates.push(record); } }; // Spatial buckets avoid scanning all brick triangles for every growth step.
    parent.updateWorldMatrix(true, true);
    const inverse = parent.matrixWorld.clone().invert(), cellSize = .5, point = new T.Vector3(); // Source vertices are converted once, outside runtime frame work.
    let totalArea = shared?.totalArea || 0, surfaceCopies = shared?.surfaceCopies || 0; // Area weights and instance counts are immutable for a carved shell.
    const keyOf = (x, y, z) => ((x + 65536) * 131072 + (y + 65536)) * 131072 + z + 65536; // Numeric cell key (exact for |cell| < 65536, i.e. 32 km at 0.5 m cells): shared by insertion and queries without building a string per lookup.
    if (!shared) for (const mesh of targets) {
      const geometry = mesh.geometry, position = geometry.attributes.position, index = geometry.index; // Supports indexed and non-indexed imported GLBs.
      const baseMatrix = inverse.clone().multiply(mesh.matrixWorld); // Mesh/group transforms apply outside each instance's own placement.
      const instanceCount = mesh.isInstancedMesh ? Math.max(0, Math.min(Math.floor(Number(mesh.count)||0), mesh.instanceMatrix?.count ?? Infinity)) : 1; // Exclude unused instance capacity and removed bricks.
      const matrix = mesh.isInstancedMesh ? new T.Matrix4() : baseMatrix, instanceMatrix = mesh.isInstancedMesh ? new T.Matrix4() : null; // Reused across all copies of this source geometry.
      const end = Math.min(index ? index.count : position.count, geometry.drawRange.start + geometry.drawRange.count); // Honor partial draw ranges.
      for (let instance = 0; instance < instanceCount; instance++) {
        if (instanceMatrix) {
          mesh.getMatrixAt(instance, instanceMatrix);
          matrix.multiplyMatrices(baseMatrix, instanceMatrix);
        }
        surfaceCopies++;
        for (let i = geometry.drawRange.start; i + 2 < end; i += 3) {
          const a = new T.Vector3().fromBufferAttribute(position, index ? index.getX(i) : i).applyMatrix4(matrix), b = new T.Vector3().fromBufferAttribute(position, index ? index.getX(i + 1) : i + 1).applyMatrix4(matrix), c = new T.Vector3().fromBufferAttribute(position, index ? index.getX(i + 2) : i + 2).applyMatrix4(matrix); // Triangle coordinates used by sampling and projection (no per-face temp arrays: this runs for every placed brick).
          if (!Number.isFinite(a.x + a.y + a.z + b.x + b.y + b.z + c.x + c.y + c.z)) continue;
          const triangle = new T.Triangle(a, b, c), area = triangle.getArea(); // Degenerate faces never become growth anchors.
          if (area < 1e-10) continue;
          const faceNormal = triangle.getNormal(new T.Vector3()); // Floor growth stays on top; ceiling growth stays on the room-facing underside.
          if (settings.wallOnly && Math.abs(faceNormal.y) > .65) continue; // Roots/vines select near-vertical rock, never cavern floor or roof.
          if (settings.target === 'floors' && faceNormal.y < .5) continue;
          if (settings.target === 'ceilings' && faceNormal.y > -.1) continue;
          totalArea += area;
          const record = { triangle, normal: faceNormal, plane: faceNormal.dot(a), stamp: 0, area: totalArea,
             sourceSurfaceId:mesh.userData?.surfaceFoliageGuideId ?? null,
             recognizedRegion:mesh.userData?.surfaceFoliageRecognizedRegion === true,
            renderLift:mesh.userData?.surfaceFoliageRenderLift || 0 }; // plane = signed offset, a cheap lower bound on distance to the face. // Cumulative area permits binary-search seed placement.
          triangles.push(record);
          const x0 = Math.floor(Math.min(a.x, b.x, c.x) / cellSize), x1 = Math.floor(Math.max(a.x, b.x, c.x) / cellSize); // Bucket range includes the full triangle, not only its centroid.
          const y0 = Math.floor(Math.min(a.y, b.y, c.y) / cellSize), y1 = Math.floor(Math.max(a.y, b.y, c.y) / cellSize);
          const z0 = Math.floor(Math.min(a.z, b.z, c.z) / cellSize), z1 = Math.floor(Math.max(a.z, b.z, c.z) / cellSize);
          if ((x1-x0+1)*(y1-y0+1)*(z1-z0+1) > 256) { large.push(record); continue; }
          for (let x=x0; x<=x1; x++) for (let y=y0; y<=y1; y++) for (let z=z0; z<=z1; z++) {
            const key = keyOf(x,y,z); // Triangle references are shared across overlapped buckets.
            let bucket = cells.get(key);
            if (!bucket) cells.set(key, bucket = []);
            bucket.push(record);
          }
        }
      }
    }
    if (shared) {
      // Each build restarts its stamp counter; clear the previous pass's visit marks so no candidate disappears by accident.
      for (const record of triangles) record.stamp = 0;
    } else if (useSharedSampling) {
      caveSurfaceSamplingCache.set(parent, { geometry: parent.geometry, wallOnly: settings.wallOnly,
        targets, triangles, large, cells, totalArea, surfaceCopies }); // The second cave layer reuses this exact triangulation.
    }
    group.userData.surfaceGrowthStats = { meshes: targets.length, instances: surfaceCopies, triangles: triangles.length, samplingReused: !!shared }; // Mobile-friendly evidence that a second cave layer shared the expensive source-surface scan.
    if (!triangles.length) { group.userData.diagnostics = 'No eligible surface triangles.'; return group; }
    const seed = xfnv1a(settings.seed), random = mulberry32(seed), geometries = []; // Deterministic recipes regenerate on import and in gameplay.
    const guide=settings.style==='natural'?null:surfaceGuideEdges(triangles,cells,large,keyOf,cellSize,settings.radius,settings.style==='cornerFill'||triangles.some(record=>record.recognizedRegion)); // Edge topology is computed only for guided styles.
    group.userData.surfaceGrowthStats.guideCorners=guide?.corners.length||0; // Mobile-visible evidence of architectural edges instead of brick micro-creases.
    group.userData.surfaceGrowthStats.guideBoundaries=guide?.boundaries.length||0; // Counts recognized outer edges eligible to host Wrap start/end anchors.
    group.userData.surfaceGrowthStats.guidedBySemanticSurfaces=targets.some(mesh=>!!mesh.userData?.surfaceFoliageGuide);
    const strandCount=settings.style==='wrap'?Math.max(1,Math.round(settings.density*settings.strandLimit)):Math.min(settings.count,settings.strandLimit); // Wrap density controls quantity; limit prevents runaway growth.
    const steps=Math.min(400,Math.ceil(settings.length/Math.min(.15,Math.max(.025,settings.radius*3)))),step=settings.length/steps;
    const wrapReport=settings.style==='wrap'
      ?appendEdgeToEdgeWrap(guide,settings,random,seed,geometries,triangles,cells,large,keyOf,cellSize):null;
    if(wrapReport){
      group.userData.surfaceGrowthStats.edgeCapacity=wrapReport.capacity;
      group.userData.surfaceGrowthStats.edgeSpacing=wrapReport.spacing;
      group.userData.surfaceGrowthStats.endpointPairs=wrapReport.generated;
      group.userData.surfaceGrowthEndpoints=wrapReport.endpoints;
    }
    if(settings.style==='cornerFill')appendCornerGrowth(guide,{...settings,count:strandCount},random,seed,geometries);
    for (let strand=0; strand<(settings.style==='natural'?strandCount:0); strand++) {
      const area = random()*totalArea; // Binary search picks an area-weighted starting face.
      let lo=0, hi=triangles.length-1;
      while (lo<hi) { const mid=(lo+hi)>>1; if (triangles[mid].area<area) lo=mid+1; else hi=mid; }
      let current=triangles[lo], normal=current.normal.clone(); // Each step keeps the surface normal for corner following.
      const u=Math.sqrt(random()), v=random(), start=current.triangle.a.clone().multiplyScalar(1-u).addScaledVector(current.triangle.b,u*(1-v)).addScaledVector(current.triangle.c,u*v); // Uniform barycentric seed.
      let anchor=start, direction=new T.Vector3(random()-.5, settings.kind==='roots' ? -.7 : .7, random()-.5).normalize(); // Gravity bias is projected onto each encountered surface.
      const points=[anchor.clone().addScaledVector(normal,settings.radius+settings.offset+settings.inset+(current.renderLift||0))]; // Radius-aware clearance keeps tubes outside the source.
      for (let segment=0; segment<steps; segment++) {
        direction.addScaledVector(normal,-direction.dot(normal));
        if (direction.lengthSq()<1e-8) direction.crossVectors(normal,new T.Vector3(1,.3,.2));
        direction.normalize();
        direction.applyAxisAngle(normal,(random()-.5)*settings.curl*.65);
        const candidate=anchor.clone().addScaledVector(direction,step), bx=Math.floor(candidate.x/cellSize), by=Math.floor(candidate.y/cellSize), bz=Math.floor(candidate.z/cellSize); // Query adjacent cells so seams and perpendicular corners remain connected.
        candidates.length=0;stamp++;gather(large);
        for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++){const bucket=cells.get(keyOf(bx+x,by+y,bz+z));if(bucket)gather(bucket);}
        let best=null, distance=step*step*(settings.target === 'shingles' ? 4 : .85), closest=null; // Shingle strand paths may bridge the narrow air gaps between neighboring GLBs; walls still refuse missing surfaces/windows.
        for(const record of candidates){
          if(record.normal.dot(normal)<-.25)continue;
          const planeGap=record.normal.dot(candidate)-record.plane;
          if(planeGap*planeGap>=distance)continue; // Perpendicular distance never exceeds true distance, so this skips the projection without changing the result.
          record.triangle.closestPointToPoint(candidate,point);
          const d=point.distanceToSquared(candidate); // Nearest actual surface point, never an object's bounding box.
          if(d<distance){distance=d;best=record;closest=point.clone();}
        }
        if(!best)break;
        if(closest.distanceToSquared(anchor)<step*step*.02){
          // At a shared edge, transport the tangent onto an adjacent face;
          // closest-point projection alone would strand every vine at corners.
          let crossed=false; // A seam is crossed only when both faces touch the current anchor.
          for(const record of candidates){
            const dot=record.normal.dot(normal); // Backfaces and near-parallel duplicates do not define a new corner.
            if(dot<-.25||dot>.95)continue;
            const anchorGap=record.normal.dot(anchor)-record.plane;
            if(anchorGap*anchorGap>step*step*.01)continue;
            record.triangle.closestPointToPoint(anchor,point);
            if(point.distanceToSquared(anchor)>step*step*.01)continue;
            const turn=direction.clone().applyQuaternion(new T.Quaternion().setFromUnitVectors(normal,record.normal)); // Parallel transport across a convex or concave seam.
            record.triangle.closestPointToPoint(anchor.clone().addScaledVector(turn,step),point);
            if(point.distanceToSquared(anchor)<step*step*.2)continue;
            closest=point.clone();best=record;crossed=true;break;
          }
          if(!crossed)break;
        }
        direction.copy(closest).sub(anchor).normalize();anchor=closest;current=best;normal=current.normal.clone();
        points.push(anchor.clone().addScaledVector(normal,settings.radius+settings.offset+settings.inset+(current.renderLift||0)));
      }
      if(points.length<2)continue;
      if (settings.kind === 'vines' && settings.hangLength > 0 && random() < settings.hangChance) {
        const tip = points[points.length - 1]; // Last anchored point is the pivot for a dangling section.
        const drop = Math.min(settings.hangLength * (.65 + random() * .7), Math.max(0, tip.y - .22)); // Keep tips above the cave's nominal floor.
        const side = new T.Vector3((random() - .5) * .14, 0, (random() - .5) * .14); // A small offset stops every hanging tip being perfectly plumb.
        if (drop > .12) for (let n = 1; n <= 6; n++) {
          const t = n / 6; // Hanging vines are no longer projected back onto rock at each point.
          points.push(tip.clone().addScaledVector(side, t * t).add(new T.Vector3(0, -drop * t, 0)));
        }
      }
      geometries.push(buildMeshFromSpineWithRadiusFn({seedU32:seed+strand,spine:framesFromPoints(points),radiusFn:t=>settings.radius*lerp(1,.18,t),radialSegments:5,twist:0,noiseAmt:.15,noiseScale:1.2,noiseOctaves:2,stretchUv:true}));
    }
    if(geometries.length){
      const shrinkReport=shrinkwrapSurfaceStrands(geometries,parent,settings,triangles,cells,large,keyOf,cellSize);
      group.userData.surfaceGrowthStats.shrinkwrapRays=shrinkReport.rays;
      group.userData.surfaceGrowthStats.shrinkwrapHits=shrinkReport.hits;
      const mesh=new T.Mesh(mergeGeomsWithUV(geometries),hexBarkMat(parseInt(settings.color.slice(1),16))); // Keep each strand's own 0..1 PNG wrap through the merge.
      const originalMaterial = mesh.material; // Release the temporary color source after the shared renderer has read it.
      const surfaces = naturalSurfaces || window.NaturalSurfaceMaterials; // Match the material/texture constructors to the geometry and renderer.
      if (settings.texture && surfaces?.naturalizeMesh) {
        surfaces.naturalizeMesh(mesh, settings.kind==='roots'?'trunks':'vines', 'strand-stretch', {texture:settings.texture,tint:settings.color,tintTreatment:'body-sprite-tint'});
        mesh.material = mesh.material.clone(); // Growth owns this material; the natural-surface cache and PNG texture remain shared.
      } else {
        const sprite = window.HobunjiSpritePngSurface || window.HobunjiPngPlaneUnlit; // Solid-color layers still follow the canonical unlit surface appearance.
        mesh.material = sprite?.makeMaterial ? sprite.makeMaterial(T,null,'surface_growth_solid',{color:parseInt(settings.color.slice(1),16)}) : new T.MeshBasicMaterial({color:parseInt(settings.color.slice(1),16)});
      }
      originalMaterial.dispose();
      mesh.userData.surfaceGrowthTexture=settings.texture;mesh.userData.surfaceGrowthColor=settings.color;
      mesh.geometry.computeVertexNormals();
      mesh.layers.enable(1); // The shared inverted-hull pass outlines these volumetric strands only when Shell Outlines is on.
      geometries.forEach(geometry=>geometry.dispose());group.add(mesh);
    }
    group.userData.generatedStrands=geometries.length;
    group.userData.diagnostics = settings.kind + ' (' + settings.style + '): ' + geometries.length + '/' + (strandCount) + ' strands on ' + targets.length + ' meshes / ' + surfaceCopies + ' placed surfaces (' + triangles.length + ' triangles, covered ' + (group.userData.surfaceGrowthStats.coverTriangles||0) + ').';
    return group;
  }

  function applySurfaceGrowth(parent, recipes) {
    // Regeneration is event-driven; replacing only owned geometry preserves source meshes/materials.
    for(const child of [...parent.children])if(child.userData?.surfaceFoliage){parent.remove(child);child.traverse(object=>{object.geometry?.dispose();if(object.material&&!Array.isArray(object.material))object.material.dispose();});}
    for(const recipe of (Array.isArray(recipes)?recipes:[]).slice(0,32))parent.add(buildSurfaceGrowth(parent,recipe));
    return parent.children.filter(child=>child.userData?.surfaceFoliage).map(child=>child.userData.diagnostics).join(' ');
  }

  function caveGrowthRecipes(zoneId, seed) {
    // Use the local tree's actual bark color and the existing natural-surface bark PNG and stretch mapper.
    const biome = String(zoneId || '');
    if (!['map_southern_cloud_forest', 'map_eastern_mire', 'map_northern_cliffs'].includes(biome)) return [];
    const forest = biome === 'map_southern_cloud_forest', mire = biome === 'map_eastern_mire';
    const barkColor = mire
      ? new T.Color().setHSL(24 / 360, .38, .20) // Eastern Mire's jungle trunk: hslMat(24, .38, .20).
      : new T.Color(forest ? TREE_PRESETS.shadewood.barkColorHex : TREE_PRESETS.crownedPine.barkColorHex);
    const rootFinish = surfaceGrowthDefaults('roots'); // Reuse the current tree-bark texture and render treatment.
    const vineFinish = surfaceGrowthDefaults('vines'); // Reuse the existing green vine material.
    const roots = { kind: 'roots', wallOnly: true, reuseSurfaceSampling: forest || mire, seed: String(seed) + ':wall-roots',
      count: forest ? 44 : mire ? 36 : 28, length: forest ? 4.6 : mire ? 4.0 : 3.3,
      radius: forest ? .086 : .072, curl: .55, offset: .008,
      color: '#' + barkColor.getHexString(), texture: rootFinish.texture };
    if (!forest && !mire) return [roots];
    return [roots, { kind: 'vines', wallOnly: true, reuseSurfaceSampling: true, seed: String(seed) + ':wall-vines',
      count: forest ? 34 : 24, length: forest ? 4.6 : 3.8, radius: .042, curl: .65, offset: .018,
      color: vineFinish.color, texture: vineFinish.texture,
      hangChance: forest ? .42 : .55, hangLength: forest ? 1.4 : 1.8 }];
  }

  // ─── Public API ───────────────────────────────────────────────────────────
  const api = { // Public builders and their runtime-scoped caches.
    forThree(runtime) {
      if (runtime === T) return api;
      if (!runtimeInstances.has(runtime)) {
        const surfaces = window.NaturalSurfaceMaterials?.forThree(runtime); // Native textures/materials must follow the requested Three.js runtime too.
        runtimeInstances.set(runtime, createFoliageGenerator(runtime, surfaces));
      }
      return runtimeInstances.get(runtime);
    },
    surfaceGrowthDefaults, surfaceMaterialPalette, normalizeSurfaceGrowth, architecturalSurfaceSources, recognizeArchitecturalSurfaceRegions, replaceSemanticSurfaceGuides, buildSurfaceGrowth, applySurfaceGrowth, caveGrowthRecipes,
    getClimbBranchWorld,
    buildLogMesh(options) {
      return buildGeneratedLogMesh(options);
    },
    buildNeedlegrainMesh(growth01, col, row) {
      const seedU32 = xfnv1a(`ng_${col}_${row}`);
      return buildNeedlegrainGroup(growth01, seedU32);
    },
    buildHeftrootMesh(growth01, col, row) {
      const seedU32 = xfnv1a(`hr_${col}_${row}`);
      return buildHeftrootGroup(growth01, seedU32);
    },
    buildWeedsMesh(col, row) {
      const seedU32 = xfnv1a(`wd_${col}_${row}`);
      return buildWeedsGroup(seedU32);
    },
    buildShrubMesh(col, row) {
      const seedU32 = xfnv1a(`sh_${col}_${row}`);
      // Legacy farm/town SHRUB tiles now use the foliage-generator's proper
      // Bush preset. Callers retain their existing placement and scale rules.
      // Routed through the shared-variant cache (see getTreeVariants) rather
      // than building full geometry per tile — shrubs are the densest ground
      // clutter in the game (see the isNativeBuild comment in game.js's
      // _buildZoneFloorMeshes), so this was by far the worst offender for
      // per-tile procedural-generation cost during chunk streaming.
      return buildTreeInstance('bush', TREE_PRESETS.bush, seedU32);
    },
    buildBoulderMesh(col, row) {
      const seedU32 = xfnv1a(`bld_${col}_${row}`);
      return buildBoulderGroup(seedU32);
    },
    buildJungleTreeMesh(col, row) {
      const seedU32 = xfnv1a(`jt_${col}_${row}`);
      return buildJungleTreeGroup(seedU32);
    },
    buildCrownedPineMesh(col, row) {
      const seedU32 = xfnv1a(`cp_${col}_${row}`);
      return buildTreeInstance('crownedPine', TREE_PRESETS.crownedPine, seedU32);
    },
    // opts.forceClimbBranch bypasses climbBranchChance's per-instance roll
    // and always shows/registers the climb branch — used by the tree GLB
    // exporter tool so an exported reference asset deterministically
    // includes it instead of a ~1-in-6 chance per export.
    buildShadewoodMesh(col, row, opts) {
      const seedU32 = xfnv1a(`sw_${col}_${row}`);
      return buildTreeInstance('shadewood', TREE_PRESETS.shadewood, seedU32, opts);
    },
    buildDeadTreeMesh(col, row) {
      return buildTreeInstance('deadTree', TREE_PRESETS.deadTree, xfnv1a(`dt_${col}_${row}`));
    },
    buildDeadBushMesh(col, row) {
      return buildTreeInstance('deadBush', TREE_PRESETS.deadBush, xfnv1a(`db_${col}_${row}`));
    },
    buildWildernessBushMesh(col, row) {
      const seedU32 = xfnv1a(`wb_${col}_${row}`);
      return buildTreeInstance('bush', TREE_PRESETS.bush, seedU32);
    },
    buildStumpMesh(col, row) {
      const seedU32 = xfnv1a(`st_${col}_${row}`);
      return buildTreeInstance('stump', TREE_PRESETS.stump, seedU32);
    }
  };
  return api;
})(window.THREE);
