// Builds furniture meshes from primitive part recipes (boxes/cylinders/discs/tapered
// legs) instead of loading GLB models. Recipes use the same part schema authored in
// docs/tools/furniture-avatar-author/index.html: { kind, transform:{x,y,z,rx,ry,rz,sx,sy,sz},
// topScaleX/Z, bottomScaleX/Z, segments, tint|color }. A recipe's local origin (0,0,0) is
// the center of its own footprint at floor level, matching the fw/fd placement convention
// used by docs/game.js and docs/tools/building-interior-author/index.html
// (cx = col + fw/2, cz = row + fd/2).
(function () {
  'use strict';

  const DEG = Math.PI / 180;

  function clampByte(v) { return Math.max(0, Math.min(255, Math.round(v))); }

  function shade(hex, factor) {
    const h = hex == null ? 0x8b6540 : hex;
    const r = clampByte(((h >> 16) & 255) * factor);
    const g = clampByte(((h >> 8) & 255) * factor);
    const b = clampByte((h & 255) * factor);
    return (r << 16) | (g << 8) | b;
  }

  function resolveColor(part, baseColor) {
    if (typeof part.color === 'number') return part.color;
    if (typeof part.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(part.color)) return parseInt(part.color.slice(1), 16);
    return shade(baseColor, part.tint != null ? part.tint : 1);
  }

  function createTaperedBoxGeometry(part) {
    const t = part.transform;
    const sx = Math.max(0.001, t.sx || 0.001);
    const sy = Math.max(0.001, t.sy || 0.001);
    const sz = Math.max(0.001, t.sz || 0.001);
    const topX = part.topScaleX ?? 1, topZ = part.topScaleZ ?? 1;
    const botX = part.bottomScaleX ?? 1, botZ = part.bottomScaleZ ?? 1;
    const verts = [
      [-0.5 * botX, -0.5, -0.5 * botZ], [0.5 * botX, -0.5, -0.5 * botZ], [0.5 * botX, -0.5, 0.5 * botZ], [-0.5 * botX, -0.5, 0.5 * botZ],
      [-0.5 * topX, 0.5, -0.5 * topZ], [0.5 * topX, 0.5, -0.5 * topZ], [0.5 * topX, 0.5, 0.5 * topZ], [-0.5 * topX, 0.5, 0.5 * topZ],
    ];
    const pos = [];
    verts.forEach(v => pos.push(v[0] * sx, v[1] * sy, v[2] * sz));
    // Outward-facing winding (verified to match the corrected winding used by the
    // furniture-avatar-author authoring tool's tapered-box primitive).
    const idx = [
      0, 1, 2, 0, 2, 3,
      4, 6, 5, 4, 7, 6,
      0, 5, 1, 0, 4, 5,
      1, 6, 2, 1, 5, 6,
      2, 7, 3, 2, 6, 7,
      3, 4, 0, 3, 7, 4,
    ];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return ensureUvs(geo);
  }

  // Per-triangle dominant-axis box-projected UVs — ported from
  // docs/js/procedural-leg-animation.js's generateBoxProjectedUvs (built for
  // the same problem there: imported foot GLBs with no authored UVs).
  // createTaperedBoxGeometry/createTaperedCylinderGeometry only ever set
  // position+index, never uv, since their 8/2N shared vertices can't each
  // carry a single correct UV across the multiple faces they belong to —
  // this expands to non-indexed (one vertex per triangle-corner, matching
  // how computeVertexNormals already effectively treats a shared-vertex cube
  // as smooth-shaded, unchanged) and derives UVs from each triangle's own
  // dominant normal axis instead of requiring a hand-authored unwrap.
  function ensureUvs(geo) {
    const position = geo.getAttribute('position');
    if (!position) return geo;
    if (geo.getAttribute('uv')) return geo;
    const projected = geo.index ? geo.toNonIndexed() : geo;
    const pos = projected.getAttribute('position');
    projected.computeBoundingBox();
    const box = projected.boundingBox;
    const sizeX = Math.max(1e-6, box.max.x - box.min.x);
    const sizeY = Math.max(1e-6, box.max.y - box.min.y);
    const sizeZ = Math.max(1e-6, box.max.z - box.min.z);
    const uv = new Float32Array(pos.count * 2);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3();
    for (let first = 0; first + 2 < pos.count; first += 3) {
      a.fromBufferAttribute(pos, first);
      b.fromBufferAttribute(pos, first + 1);
      c.fromBufferAttribute(pos, first + 2);
      e1.subVectors(b, a);
      e2.subVectors(c, a);
      n.crossVectors(e1, e2).normalize();
      const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
      const dominant = ax >= ay && ax >= az ? 'x' : ay >= az ? 'y' : 'z';
      for (let corner = 0; corner < 3; corner++) {
        const v = corner === 0 ? a : corner === 1 ? b : c;
        let u, vv;
        if (dominant === 'x') { u = (v.z - box.min.z) / sizeZ; vv = (v.y - box.min.y) / sizeY; if (n.x < 0) u = 1 - u; }
        else if (dominant === 'y') { u = (v.x - box.min.x) / sizeX; vv = (v.z - box.min.z) / sizeZ; if (n.y > 0) vv = 1 - vv; }
        else { u = (v.x - box.min.x) / sizeX; vv = (v.y - box.min.y) / sizeY; if (n.z > 0) u = 1 - u; }
        const t = (first + corner) * 2;
        uv[t] = u; uv[t + 1] = vv;
      }
    }
    projected.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return projected;
  }

  function createTaperedCylinderGeometry(part) {
    const t = part.transform;
    const seg = Math.max(3, Math.min(64, Math.round(part.segments || 16)));
    const sx = Math.max(0.001, t.sx || 0.001);
    const sy = Math.max(0.001, t.sy || 0.001);
    const sz = Math.max(0.001, t.sz || 0.001);
    const topX = part.topScaleX ?? 1, topZ = part.topScaleZ ?? 1;
    const botX = part.bottomScaleX ?? 1, botZ = part.bottomScaleZ ?? 1;
    const pos = [];
    const idx = [];
    const add = (x, y, z) => { pos.push(x * sx, y * sy, z * sz); return pos.length / 3 - 1; };
    const bot = [], top = [];
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      bot.push(add(Math.cos(a) * 0.5 * botX, -0.5, Math.sin(a) * 0.5 * botZ));
      top.push(add(Math.cos(a) * 0.5 * topX, 0.5, Math.sin(a) * 0.5 * topZ));
    }
    const cb = add(0, -0.5, 0);
    const ct = add(0, 0.5, 0);
    for (let i = 0; i < seg; i++) {
      const n = (i + 1) % seg;
      idx.push(bot[i], top[n], bot[n]);
      idx.push(bot[i], top[i], top[n]);
      // Cap fans wind opposite to the side quads' i/n order so their normals
      // point outward (down for the bottom cap, up for the top) rather than
      // facing into the solid — backwards here left both caps back-face
      // culled from their own outward side, e.g. a flat disc's top surface
      // (mostly cap, negligible side wall) rendering as a hole showing the
      // clear-color background straight through it.
      idx.push(cb, bot[i], bot[n]);
      idx.push(ct, top[n], top[i]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return ensureUvs(geo);
  }

  // Ring shape for 'hoop' parts (barrel/vat bands) — sx/sz set the outer
  // diameter, sy sets the tube (band) thickness relative to that diameter.
  function createHoopGeometry(part) {
    const t = part.transform;
    const seg = Math.max(3, Math.min(64, Math.round(part.segments || 16)));
    const outerRadius = 0.5 * Math.max(t.sx || 0.001, t.sz || 0.001);
    const tubeRadius = Math.max(0.001, (t.sy || 0.05) * 0.5);
    const geo = new THREE.TorusGeometry(Math.max(0.001, outerRadius - tubeRadius), tubeRadius, Math.max(4, Math.round(seg / 2)), seg);
    geo.rotateX(Math.PI / 2);
    return geo;
  }

  function buildPartMesh(part, baseColor) {
    let geo;
    const t = part.transform;
    if (part.kind === 'sphere') {
      geo = new THREE.SphereGeometry(0.5 * Math.max(t.sx, t.sy, t.sz), 16, 10);
    } else if (part.kind === 'hoop') {
      geo = createHoopGeometry(part);
    } else if (part.kind === 'legRound' || part.kind === 'cylinder' || part.kind === 'disc' || part.kind === 'barrel' || part.kind === 'cup' || part.kind === 'liquidSurface') {
      geo = createTaperedCylinderGeometry(part);
    } else {
      geo = createTaperedBoxGeometry(part);
    }
    const mat = new THREE.MeshLambertMaterial({ color: resolveColor(part, baseColor) });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(t.x || 0, t.y || 0, t.z || 0);
    mesh.rotation.set((t.rx || 0) * DEG, (t.ry || 0) * DEG, (t.rz || 0) * DEG);
    mesh.name = part.name || part.kind;
    if (part.materialTexture) applyPartTexture(mat, part);
    return mesh;
  }

  // ── Authored material textures (docs/config/furniture-authored/*.json's
  // materialTexture/materialRotationDeg fields, from docs/assets/textures/)
  // — cached per filename since most parts across a whole furniture piece
  // (and across many placed instances) share the same handful of textures.
  const _texLoader = new THREE.TextureLoader();
  const _texCache = new Map(); // filename -> { base: THREE.Texture, loaded: boolean, pendingClones: Set<THREE.Texture> }
  // THREE.Texture.copy() (used by .clone()) snapshots `image` by reference at
  // call time — the loader's onLoad only ever back-fills the ORIGINAL texture
  // object, so a clone made before the network fetch finishes captures the
  // still-empty image forever and renders solid black. Every part needs its
  // own clone (independent rotation per authored part), so instead of cloning
  // once and hoping the fetch already resolved, track pending clones per
  // filename and patch their `image`/`needsUpdate` in when the base loads.
  function texEntry(filename) {
    let entry = _texCache.get(filename);
    if (entry) return entry;
    entry = { base: null, loaded: false, pendingClones: new Set() };
    entry.base = _texLoader.load('assets/textures/' + filename, () => {
      entry.loaded = true;
      for (const clone of entry.pendingClones) {
        clone.image = entry.base.image;
        clone.format = entry.base.format;
        clone.needsUpdate = true;
      }
      entry.pendingClones.clear();
    }, undefined, () => {});
    entry.base.wrapS = entry.base.wrapT = THREE.RepeatWrapping;
    entry.base.center.set(0.5, 0.5);
    _texCache.set(filename, entry);
    return entry;
  }
  function applyPartTexture(mat, part) {
    const entry = texEntry(part.materialTexture);
    const tex = entry.base.clone();
    tex.needsUpdate = true;
    tex.rotation = (part.materialRotationDeg || 0) * DEG;
    if (!entry.loaded) entry.pendingClones.add(tex);
    mat.map = tex;
    mat.color.set(0xffffff);
    mat.transparent = !!part.textureTransparent;
    mat.needsUpdate = true;
  }

  function buildFurnitureGroup(key, baseColor) {
    const group = new THREE.Group();
    group.name = 'procedural_furniture_' + key;
    const recipe = CATALOG[key];
    if (!recipe) return group;
    for (const part of recipe) group.add(buildPartMesh(part, baseColor));
    return group;
  }

  // ── Recipe building blocks ──────────────────────────────────────────
  // `extra` may include rx/ry/rz (merged into transform) plus any other part field
  // (topScaleX, bottomScaleX, segments, color, tint, ...).
  function withExtra(part, extra) {
    if (!extra) return part;
    const { rx, ry, rz, ...rest } = extra;
    if (rx != null) part.transform.rx = rx;
    if (ry != null) part.transform.ry = ry;
    if (rz != null) part.transform.rz = rz;
    return Object.assign(part, rest);
  }
  function leg(x, z, h, size, tint, extra) {
    return withExtra({ kind: 'legSquare', tint, transform: { x, y: h / 2, z, sx: size, sy: h, sz: size } }, extra);
  }
  function roundLeg(x, z, h, size, tint, segments, extra) {
    return withExtra({ kind: 'legRound', tint, segments: segments || 10, transform: { x, y: h / 2, z, sx: size, sy: h, sz: size } }, extra);
  }
  function box(x, y, z, sx, sy, sz, tint, extra) {
    return withExtra({ kind: 'box', tint, transform: { x, y, z, sx, sy, sz } }, extra);
  }
  function cyl(x, y, z, sx, sy, sz, tint, extra) {
    return withExtra({ kind: 'cylinder', tint, transform: { x, y, z, sx, sy, sz } }, extra);
  }
  function disc(x, y, z, sx, sy, sz, tint, extra) {
    return withExtra({ kind: 'disc', tint, segments: 24, transform: { x, y, z, sx, sy, sz } }, extra);
  }

  // Table-like: flat top on four (or more, for long tables) legs.
  function tableRecipe(fw, fd, topThickness, legHeight) {
    const w = fw * 0.92, d = fd * 0.92;
    const legInsetX = Math.min(0.18, w * 0.12), legInsetZ = Math.min(0.18, d * 0.12);
    const lx = w / 2 - legInsetX, lz = d / 2 - legInsetZ;
    const legSize = Math.min(0.16, Math.min(w, d) * 0.14);
    const topY = legHeight + topThickness / 2;
    const parts = [box(0, topY, 0, w, topThickness, d, 1.05, { topScaleX: .96, topScaleZ: .96 })];
    const xs = fw >= 3 ? [-lx, -lx / 3, lx / 3, lx] : [-lx, lx];
    for (const x of xs) for (const z of [-lz, lz]) parts.push(leg(x, z, legHeight, legSize, 0.8));
    return parts;
  }

  function cabinetRecipe(fw, fd, height, shelfLines) {
    const w = fw * 0.85, d = fd * 0.85;
    const parts = [box(0, height / 2, 0, w, height, d, 1)];
    const n = shelfLines || 0;
    for (let i = 1; i <= n; i++) {
      const y = (height * i) / (n + 1);
      parts.push(box(0, y, d / 2 + 0.001, w * 0.96, 0.025, 0.02, 0.6));
    }
    return parts;
  }

  function barrelRecipe(radius, height, tint) {
    return [
      cyl(0, height / 2, 0, radius * 2, height, radius * 2, tint != null ? tint : 1, { topScaleX: .85, topScaleZ: .85, bottomScaleX: .92, bottomScaleZ: .92, segments: 20 }),
      disc(0, height * 0.92, 0, radius * 2.08, 0.05, radius * 2.08, 1.3, { segments: 20 }),
      disc(0, height * 0.08, 0, radius * 2.12, 0.05, radius * 2.12, 1.3, { segments: 20 }),
    ];
  }

  // Bed-like: frame + mattress + a pillow placed at one end of whichever axis (X or Z)
  // is the longer one, matching that axis's footprint dimension.
  function bedRecipe(fw, fd) {
    const longIsZ = fd >= fw;
    const frameW = fw * 0.92, frameD = fd * 0.92;
    const longLen = longIsZ ? frameD : frameW;
    const shortLen = longIsZ ? frameW : frameD;
    const headOffset = -(longLen / 2 - shortLen * 0.32);
    const parts = [
      box(0, .14, 0, frameW, .22, frameD, .85),
      box(0, .33, 0, frameW * 0.93, .22, frameD * 0.93, 1, { topScaleX: .96, topScaleZ: .96 }),
    ];
    const pillowDepth = shortLen * 0.32, pillowWidth = shortLen * 0.78;
    if (longIsZ) parts.push(box(0, .50, headOffset, pillowWidth, .16, pillowDepth, 1.25));
    else parts.push(box(headOffset, .50, 0, pillowDepth, .16, pillowWidth, 1.25));
    const fx = frameW / 2 - .07, fz = frameD / 2 - .07;
    for (const x of [-fx, fx]) for (const z of [-fz, fz]) parts.push(leg(x, z, .14, .14, .65));
    return parts;
  }

  // ── Catalog: one entry per furniture key in DECORATIVE_FURNITURE_DEFS / PROCESSING_FURNITURE_DEFS ──
  const CATALOG = {};

  // -- Decorative furniture --
  CATALOG.basicBed = bedRecipe(1, 2);
  CATALOG.doubleBed = bedRecipe(2, 2);

  CATALOG.bedroll = [
    box(0, .05, .05, .8, .1, 1.55, 1),
    cyl(0, .13, -.78, .24, .8, .24, 1.15, { rx: 90, segments: 14 }),
  ];

  CATALOG.bench = [
    box(0, .31, 0, 1.7, .18, .5, 1),
    box(0, .11, .22, 1.5, .12, .1, .85),
    box(0, .11, -.22, 1.5, .12, .1, .85),
    leg(-.68, -.18, .27, .12, .75), leg(.68, -.18, .27, .12, .75),
    leg(-.68, .18, .27, .12, .75), leg(.68, .18, .27, .12, .75),
  ];

  CATALOG.bookshelf = cabinetRecipe(2, 1, 1.5, 3);

  CATALOG.bucket = [
    cyl(0, .19, 0, .42, .38, .42, 1, { topScaleX: 1.08, topScaleZ: 1.08, bottomScaleX: .85, bottomScaleZ: .85, segments: 16 }),
    disc(0, .37, 0, .46, .03, .46, 1.3, { segments: 16 }),
  ];

  // Drenkirra nest — the bucket recipe's exact tapered-cylinder-body +
  // rim-disc shape, just halved in height and rendered in a yellow "woven"
  // tint (see DECORATIVE_FURNITURE_DEFS.nestBranch/nest's color) instead of
  // the bucket's tin gray. diameter is the caller's own knob rather than a
  // fixed size, since a 1x1 branch nest and a 2x2 den nest need different
  // footprints out of the same recipe.
  function nestRecipe(diameter) {
    const bodyH = .19; // Half of bucket's .38 body height.
    return [
      cyl(0, bodyH / 2, 0, diameter, bodyH, diameter, 1, { topScaleX: 1.08, topScaleZ: 1.08, bottomScaleX: .85, bottomScaleZ: .85, segments: 16 }),
      disc(0, bodyH * 0.97, 0, diameter + .04, .03, diameter + .04, 1.3, { segments: 16 }),
    ];
  }
  CATALOG.nestBranch = nestRecipe(.84); // 1x1 tile footprint, same scale as the bucket.
  CATALOG.nest = nestRecipe(1.7); // 2x2 tile footprint — matches the den nest marker's existing w:2,h:2 size.

  CATALOG.candleTable = [
    box(0, .42, 0, .6, .08, .6, 1.05, { topScaleX: .96, topScaleZ: .96 }),
    leg(-.22, -.22, .38, .07, .8), leg(.22, -.22, .38, .07, .8),
    leg(-.22, .22, .38, .07, .8), leg(.22, .22, .38, .07, .8),
    cyl(0, .55, 0, .06, .22, .06, .5, { segments: 8 }),
    disc(0, .47, 0, .14, .02, .14, 1.3, { segments: 12 }),
  ];

  CATALOG.chairSimple = [
    box(0, .38, 0, .42, .06, .42, 1),
    box(0, .65, -.19, .4, .5, .06, 1),
    leg(-.17, -.17, .38, .05, .8), leg(.17, -.17, .38, .05, .8),
    leg(-.17, .17, .38, .05, .8), leg(.17, .17, .38, .05, .8),
  ];

  CATALOG.chairCushion = [
    ...CATALOG.chairSimple,
    box(0, .42, 0, .38, .05, .38, 0.55),
  ];

  CATALOG.chest = [
    box(0, .19, 0, .8, .38, .5, 1),
    box(0, .42, 0, .82, .08, .52, 1.15),
    box(0, .39, .26, .06, .08, .03, .5),
  ];

  CATALOG.crateStack = [
    box(-.08, .17, -.05, .5, .34, .5, 1),
    box(.1, .42, .06, .38, .26, .38, .85, { ry: 12 }),
  ];

  CATALOG.copperBarrel = barrelRecipe(.36, .45, 1);

  CATALOG.desk = [
    ...tableRecipe(2, 1, .08, .42),
    box(.45, .27, 0, .5, .3, .7, .9),
  ];

  CATALOG.dresser = cabinetRecipe(2, 1, .85, 2);

  CATALOG.hearth = [
    box(0, .9, -.32, 1.7, 1.8, .3, .55),
    box(0, .22, 0, 1.7, .44, .85, .7),
    box(0, .42, .1, .9, .16, .55, 1.4, { color: 0xb35a2a }),
  ];

function campfireRecipe() {
    const parts = [
      cyl(0, .12, 0, .16, .92, .16, .82, { rz: 90, ry: 45, segments: 8, color: 0x5b321b }),
      cyl(0, .14, 0, .16, .92, .16, .70, { rz: 90, ry: -45, segments: 8, color: 0x6f3c1f }),
    ];
    for (let i = 0; i < 9; i++) {
      const a = i * Math.PI * 2 / 9;
      parts.push(cyl(Math.cos(a) * .42, .09, Math.sin(a) * .42, .23, .18, .23, 1, {
        segments: 7,
        color: i % 2 ? 0x68635a : 0x777168,
      }));
    }
    return parts;
  }
  CATALOG.campfire = campfireRecipe();

  CATALOG.loom = [
    leg(-.3, -.85, 1.6, .12, .8), leg(.3, -.85, 1.6, .12, .8),
    leg(-.3, .85, 1.6, .12, .8), leg(.3, .85, 1.6, .12, .8),
    box(0, 1.5, -.85, .76, .08, .12, .9),
    box(0, .25, -.85, .76, .08, .12, .9),
    box(0, 1.5, .85, .76, .08, .12, .9),
    box(0, .25, .85, .76, .08, .12, .9),
  ];

  CATALOG.nightstand = cabinetRecipe(1, 1, .55, 1);

  CATALOG.rug = [
    box(0, .015, 0, 1.85, .03, 1.85, 1),
  ];

  CATALOG.standingLamp = [
    roundLeg(0, 0, 1.3, .07, .85),
    cyl(0, 1.42, 0, .4, .22, .4, 1, { topScaleX: .55, topScaleZ: .55, segments: 14 }),
    disc(0, 1.0, 0, .26, .03, .26, .85, { segments: 10 }),
  ];

  // Placeholder weathered-stone statue/totem: a plinth, a tapered column, and
  // a small pointed cap -- explicit stone-gray colors (not tinted off the
  // passed-in base color) so it reads consistently regardless of what a
  // placement happens to pass as its "furniture color".
  CATALOG.statue = [
    box(0, .06, 0, .68, .12, .68, 1, { color: 0x63666c }),
    cyl(0, .34, 0, .42, .5, .42, 1, { color: 0x54585e, topScaleX: .8, topScaleZ: .8, segments: 8 }),
    cyl(0, .68, 0, .2, .18, .2, 1, { color: 0x40444a, topScaleX: .25, topScaleZ: .25, segments: 6 }),
  ];

  CATALOG.stool = [
    disc(0, .31, 0, .8, .14, .8, 1, { segments: 20 }),
    roundLeg(Math.cos(Math.PI / 6) * .26, Math.sin(Math.PI / 6) * .26, .28, .1, .8),
    roundLeg(Math.cos(Math.PI / 6 + Math.PI * 2 / 3) * .26, Math.sin(Math.PI / 6 + Math.PI * 2 / 3) * .26, .28, .1, .8),
    roundLeg(Math.cos(Math.PI / 6 + Math.PI * 4 / 3) * .26, Math.sin(Math.PI / 6 + Math.PI * 4 / 3) * .26, .28, .1, .8),
  ];

  CATALOG.tableLong = tableRecipe(4, 1, .12, .42);
  CATALOG.tableRound = [
    disc(0, .42, 0, 1.7, .12, 1.7, 1.05, { segments: 24, topScaleX: .96, topScaleZ: .96 }),
    cyl(0, .19, 0, .2, .38, .2, .85, { segments: 16 }),
    disc(0, .02, 0, .55, .04, .55, .85, { segments: 16 }),
  ];
  CATALOG.tableSmall = tableRecipe(1, 1, .1, .42);

  CATALOG.wardrobe = [
    ...cabinetRecipe(2, 1, 1.7, 0),
    box(0, .85, .43, .02, 1.6, .02, .5),
  ];

  CATALOG.washTub = [
    cyl(0, .17, 0, .68, .32, .68, 1, { topScaleX: 1.06, topScaleZ: 1.06, bottomScaleX: .88, bottomScaleZ: .88, segments: 18 }),
    disc(0, .32, 0, .72, .03, .72, 1.25, { segments: 18 }),
  ];

  CATALOG.counter = [
    box(0, .45, 0, 2.7, .9, .7, 1),
    box(0, .93, 0, 2.8, .06, .8, 1.15),
  ];

  // Bulletin Board: a post-mounted panel with a couple of pinned notices —
  // the public task board (see game.js's task/favor system).
  CATALOG.bulletinBoard = [
    leg(-.55, 0, .95, .09, .7), leg(.55, 0, .95, .09, .7),
    box(0, .95, 0, 1.3, 1.0, .08, 1, { topScaleX: .97, topScaleZ: 1 }),
    box(0, .95, .045, 1.15, .82, .02, 1.4),
    box(-.28, 1.08, .06, .32, .22, .01, 1.6),
    box(.22, .82, .06, .3, .2, .01, 1.6),
  ];

  // Alchemy Table: a squat cauldron on a stubby tripod, ringed with a few
  // corked reagent bottles — reuses the tapered-cylinder/disc primitives
  // rather than a bespoke model, matching every other CATALOG entry.
  CATALOG.alchemyTable = [
    roundLeg(0, 0, .32, .16, .8, 10),
    cyl(0, .5, 0, .78, .5, .78, .55, { segments: 18, topScaleX: 1.12, topScaleZ: 1.12, bottomScaleX: .7, bottomScaleZ: .7 }),
    disc(0, .74, 0, .84, .05, .84, 1.35, { segments: 18 }),
    cyl(-.34, .34, .22, .09, .3, .09, .95, { segments: 8 }),
    cyl(.3, .3, -.28, .08, .24, .08, 1.1, { segments: 8 }),
    cyl(.1, .28, .36, .07, .2, .07, 1.25, { segments: 8 }),
  ];

  // -- Processing furniture (used by docs/tools/building-interior-author preview) --
  CATALOG.pestle = [
    box(0, .19, 0, .6, .38, .6, .85),
    disc(0, .42, 0, .5, .1, .5, 1.15, { segments: 18, topScaleX: .8, topScaleZ: .8 }),
    cyl(.12, .55, 0, .08, .3, .08, .7, { segments: 8 }),
  ];

  CATALOG.squeezer = [
    cyl(0, .26, 0, 1.3, .5, 1.3, .9, { segments: 18, topScaleX: 1.05, topScaleZ: 1.05 }),
    roundLeg(0, 0, .9, .1, .8),
    disc(0, .92, 0, .5, .06, .5, 1.2, { segments: 14 }),
  ];

  CATALOG.handMill = [
    box(0, .22, 0, .62, .44, .62, .85),
    disc(0, .48, 0, .56, .14, .56, 1.1, { segments: 18 }),
    cyl(.32, .5, 0, .06, .3, .06, .7, { rz: 90, segments: 8 }),
  ];

  CATALOG.dryingRack = [
    leg(-.85, -.38, 1.1, .1, .8), leg(.85, -.38, 1.1, .1, .8),
    leg(-.85, .38, 1.1, .1, .8), leg(.85, .38, 1.1, .1, .8),
    box(0, 1.05, 0, 1.8, .07, .85, .9),
    box(0, .55, 0, 1.8, .05, .85, .9),
  ];

  CATALOG.smoker = [
    box(0, .8, 0, 1.5, 1.6, 1.5, .8),
    cyl(0, 1.75, 0, .26, .35, .26, .55, { segments: 10 }),
  ];

  CATALOG.agingBarrel = barrelRecipe(.36, .45, .75);

  CATALOG.agingVase = [
    cyl(0, .32, 0, .56, .64, .56, .9, { segments: 18, topScaleX: .55, topScaleZ: .55, bottomScaleX: .8, bottomScaleZ: .8 }),
    disc(0, .66, 0, .3, .04, .3, 1.2, { segments: 14 }),
  ];

  // -- Barn-interior fixtures (see game.js's synthesizeBarnInteriorMapData) --
  // Same hand-mill silhouette as CATALOG.handMill, tipped on its side (the
  // grinding face now points +X, toward the right wall) with a small catch
  // bowl on top — the real look comes from feedGrinder.json (authored) once
  // that loads; this is only the fallback before/if it doesn't.
  CATALOG.feedGrinder = [
    box(0, .14, 0, .5, .28, .42, .85),
    cyl(0, .34, 0, .22, .55, .22, 1, { rz: 90, segments: 14 }),
    disc(.26, .34, 0, .24, .07, .24, 1.1, { rz: 90, segments: 18 }),
    cyl(-.06, .34, -.3, .045, .16, .045, .7, { rx: 90, segments: 8 }),
    cyl(.34, .5, 0, .2, .18, .2, .9, { segments: 12, topScaleX: 1.1, topScaleZ: 1.1, bottomScaleX: .7, bottomScaleZ: .7 }),
  ];

  CATALOG.trough = [
    box(0, .07, 0, .7, .14, .26, .85),
    cyl(0, .2, 0, .76, .22, .32, 1, { segments: 16, topScaleX: 1.1, topScaleZ: 1.1, bottomScaleX: .82, bottomScaleZ: .82 }),
  ];

  // Loading can briefly race the first scene build; this tiny recipe keeps
  // the authored mine ladder on the normal furniture path until its JSON is
  // ready, at which point AuthoredFurniture supplies the real model.
  CATALOG.mineLadder = [
    box(0, .65, 0, .6, 1.3, .12, .85),
  ];

  // Loading can briefly race the first Dungeon Test scene build, same
  // reasoning as mineLadder above — a small stand-in box until
  // dungeonChest.json (authored, config/furniture-authored/dungeonChest.json)
  // is ready, at which point AuthoredFurniture supplies the real model.
  CATALOG.dungeonChest = [
    box(0, .19, 0, .8, .38, .5, .7, { color: 0x4a3a26 }),
    box(0, .42, 0, .82, .08, .52, .85, { color: 0x5c4830 }),
  ];

  // Same reasoning as dungeonChest above — a small stand-in until
  // dungeonRune.json is ready.
  CATALOG.dungeonRune = [
    box(0, .12, 0, .5, .24, .5, .8, { color: 0x6f7566 }),
    disc(0, .66, 0, .4, .05, .4, 1, { color: 0x8a5cff, segments: 16 }),
  ];

  // Same reasoning as dungeonChest/dungeonRune above — a small stand-in
  // pedestal+bowl until stoneBrazier.json is ready (its real fire/smoke
  // emitters, an exact copy of campfire.json's own, only exist there).
  CATALOG.stoneBrazier = [
    box(0, .4, 0, .32, .8, .32, 1, { color: 0x5c574e }),
    disc(0, .82, 0, .46, .12, .46, 1, { color: 0x6b665a, segments: 16 }),
  ];

  window.ProceduralFurniture = {
    buildFurnitureGroup,
    buildPartMesh,
    shade,
    CATALOG,
  };
})();
