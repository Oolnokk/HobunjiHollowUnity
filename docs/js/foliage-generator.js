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
      pts.push(p.clone().add(new T.Vector3(ox, oy, oz).multiplyScalar(amp)));
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

  // ─── Tube mesh from spine ─────────────────────────────────────────────────
  function buildMeshFromSpineWithRadiusFn({ seedU32, spine, radiusFn, radialSegments, twist, noiseAmt, noiseScale, noiseOctaves }) {
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
        indices.push(a0, b0, a1, a1, b0, b1);
      }
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
  function hslMat(h360, s, l, roughness = 1) {
    const col = new T.Color().setHSL(h360 / 360, s, l);
    return new T.MeshLambertMaterial({ color: col });
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

  // ─── Public API ───────────────────────────────────────────────────────────
  return {
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
      return buildShrubGroup(seedU32);
    }
  };
})();
