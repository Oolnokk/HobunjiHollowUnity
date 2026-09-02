(() => {
  'use strict';

  // Farm/town grass & weed billboards, crop growth meshes, and per-tile
  // ground+vegetation mesh building, extracted out of game.js following the
  // same window.<Namespace> + init(deps) pattern as its siblings.
  //
  // grid is reassigned wholesale on farm load/reset (getGrid()). _townZone/
  // _townSceneBuilt/townScene/townGrid are `let`s owned by game.js's town
  // builder, read-only here (getters). s_grass/s_weed3D are settings-tab
  // toggles whose checkbox listeners stay in game.js — also getters here.
  // Everything else this module builds (grassBillboardMat/_grassLeafTex/
  // cuttableBillboardGlowMat+Mesh/farmGrassBillMesh/farmWeedBillMesh/
  // townGrassBillMesh/vegMeshes/vegFoliageMeshes/cropMeshes/mbRng/
  // grassBladeGeo/grassBillVert/grassTint/fillBillboardInstances) is owned
  // by this module outright — several already-extracted modules
  // (BorderTerrain/ZoneGrassBillboards/ReagentPlants/WildBerries/
  // WildTreasure) and game.js's own render loop/reticle code consume these
  // via the public API below rather than the old bare closures, same
  // treatment as loot-rolling.js's _lootPools/_shopStock.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  // ── Vegetation slab geometry + wind shader ────────────────────
  const VEG_H = 0.18;  // slab height for shrubs/weeds
  const vegGeo = new THREE.BoxGeometry(0.88, VEG_H, 0.88);

  // Wind vertex shader — displaces top vertices horizontally by sin(time + phase)
  const windVert = `
    uniform float uTime;
    uniform float uPhase;
    uniform float uStrength;
    varying vec3 vNormal;
    varying vec3 vViewPos;
    void main() {
      vNormal = normalMatrix * normal;
      vec4 worldPos = modelMatrix * vec4(position, 1.0);
      // Only sway the top half (position.y > 0)
      float topFactor = max(0.0, position.y / ${VEG_H.toFixed(3)});
      float sway = sin(uTime * 1.8 + uPhase) * uStrength * topFactor;
      float sway2 = cos(uTime * 1.2 + uPhase * 1.3) * uStrength * 0.5 * topFactor;
      worldPos.x += sway;
      worldPos.z += sway2;
      vec4 mvPos = viewMatrix * worldPos;
      vViewPos = mvPos.xyz;
      gl_Position = projectionMatrix * mvPos;
    }
  `;
  const windFrag = `
    uniform vec3 uColor;
    varying vec3 vNormal;
    varying vec3 vViewPos;
    void main() {
      vec3 lightDir = normalize(vec3(0.4, 1.0, 0.3));
      float diff = max(dot(normalize(vNormal), lightDir), 0.0) * 0.6 + 0.4;
      gl_FragColor = vec4(uColor * diff, 1.0);
    }
  `;

  // Shared time uniform — updated every frame
  const windUniforms = { uTime: { value: 0 }, uPhase: { value: 0 }, uStrength: { value: 0.04 }, uColor: { value: new THREE.Color(0x247c3c) } };

  function makeVegMaterial(color, phase) {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime:     { value: 0 },
        uPhase:    { value: phase },
        uStrength: { value: 0.04 },
        uColor:    { value: new THREE.Color(color) },
      },
      vertexShader:   windVert,
      fragmentShader: windFrag,
      side: THREE.DoubleSide,
    });
  }

  // Track all vegetation meshes for wind animation
  const vegMeshes = [];
  // Track foliage-generator groups by tile index for rotation-based sway;
  // sized in init() once ROWS/COLS are known.
  const vegFoliageMeshes = [];
  // Tile meshes indexed by row*COLS+col — sized in init() as well.
  let tileMeshes = null;
  // Sparse index of occupied vegFoliageMeshes slots, kept in sync by setVegFoliageMesh(),
  // so the per-frame wind-sway loop only visits live entries instead of all 936 slots.
  const _vegFoliageActive = new Set();
  function setVegFoliageMesh(i, val) {
    vegFoliageMeshes[i] = val;
    if (val) _vegFoliageActive.add(i); else _vegFoliageActive.delete(i);
  }

  // ── Grass billboard system (grass_1.png sprites on GRASS tiles) ─────────
  // Rendered via InstancedMesh (one draw call per category) instead of one
  // Mesh pair per blade — at 14 crosses × 2 blades per tile, a per-Mesh
  // approach would cost tens of thousands of draw calls across the farm's
  // WEEDS-majority default tile pattern, which is the real cause of janky
  // frame pacing during movement (not the per-tile speed multiplier).

  function _mbRng(seed) {
    let s = seed >>> 0;
    return () => {
      s += 0x6D2B79F5;
      let t = Math.imul(s ^ (s >>> 15), s | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Shared blade geometry: 1×1 PlaneGeometry anchored at Y=0
  const _grassBladeGeo = (() => {
    const g = new THREE.PlaneGeometry(1, 1);
    g.translate(0, 0.5, 0);
    return g;
  })();

  const _grassBillVert = `
    uniform float uTime;
    uniform float uStrength;
    #ifdef USE_FOG
      #ifdef FOG_EXP2
        uniform float fogDensity;
      #else
        uniform float fogNear;
        uniform float fogFar;
      #endif
      varying float vGrassFogFactor;
    #endif
    varying vec2 vUv;
    varying float vRandom;
    void main() {
      vUv = uv;
      #ifdef USE_INSTANCING
        vec4 worldPos = modelMatrix * instanceMatrix * vec4(position, 1.0);
      #else
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
      #endif
      // Stable per-blade pseudo-random value from its (fixed) ground
      // position — used by the fragment shader to thin the tuft count
      // seasonally (Deadgrass/Coldmuck) without touching the instance
      // buffer itself, so density can change with a single uniform.
      vRandom = fract(sin(dot(worldPos.xz, vec2(12.9898, 78.233))) * 43758.5453);
      float topFactor = uv.y;
      float phase = worldPos.x * 1.7 + worldPos.z * 2.3;
      float sway  = sin(uTime * 1.8 + phase) * uStrength * topFactor;
      float sway2 = cos(uTime * 1.2 + phase * 1.3) * uStrength * 0.5 * topFactor;
      worldPos.x += sway;
      worldPos.z += sway2;
      vec4 mvPosition = viewMatrix * worldPos;
      #ifdef USE_FOG
        // Evaluate fog four times per blade plane and interpolate it, rather
        // than running exp() for every overlapping grass fragment.
        float fogDepth = -mvPosition.z;
        #ifdef FOG_EXP2
          vGrassFogFactor = 1.0 - exp(- fogDensity * fogDensity * fogDepth * fogDepth);
        #else
          vGrassFogFactor = smoothstep(fogNear, fogFar, fogDepth);
        #endif
      #endif
      gl_Position = projectionMatrix * mvPosition;
    }
  `;

  const _grassBillFrag = `
    uniform sampler2D uGrassTex;
    uniform vec3 uTint;
    uniform float uDensity;
    uniform vec3 fogColor;
    #ifdef USE_FOG
      varying float vGrassFogFactor;
    #endif
    varying vec2 vUv;
    varying float vRandom;
    void main() {
      if (vRandom > uDensity) discard;
      vec4 texel = texture2D(uGrassTex, vUv);
      if (texel.a < 0.5) discard;
      // Treat grass_1.png as mint-toned; desaturate and re-tint to grass color
      float lum = dot(texel.rgb, vec3(0.299, 0.587, 0.114));
      // Unlit, same as the ground tiles' MeshBasicMaterial (see
      // unlitFloorMat/tileMats.grass) — blades read at one consistent
      // painted brightness day or night/storm instead of dimming with
      // ambientLight/sunLight, so a blade never goes darker than the
      // grass surface it's standing on.
      vec3 tinted = uTint * (0.7 + lum * 0.8);
      // Drawn outline pixels (near-black source) stay pure black; tint the rest
      vec3 col = mix(vec3(0.0), tinted, smoothstep(0.0, 0.15, lum));
      #ifdef USE_FOG
        col = mix(col, fogColor, vGrassFogFactor);
      #endif
      gl_FragColor = vec4(col, texel.a);
    }
  `;

  const _grassTint = new THREE.Color().setHSL(108 / 360, 0.58, 0.28);
  let grassBillboardMat = null;
  let cuttableBillboardGlowMat = null;
  let cuttableBillboardGlowMesh = null;
  // Cached grass-leaf silhouette texture, reused (re-tinted per reagent)
  // by getReagentPlantMaterial for alchemy reagent plant billboards.
  let _grassLeafTex = null;

  function _startGrassTextureLoad() {
    new THREE.TextureLoader().load('assets/leaves/grass_1.png', (tex) => {
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      _grassLeafTex = tex;
      const sharedUniforms = () => ({
        uGrassTex:   { value: tex },
        uTint:       { value: _grassTint },
        uTime:       { value: 0 },
        uStrength:   { value: 0.04 },
        uDensity:    { value: 1 },
        // Fog uniform slots _grassBillFrag's USE_FOG block reads, refreshed
        // every frame from whichever scene is active — declared directly
        // here rather than via THREE.UniformsUtils.merge(UniformsLib.fog):
        // merge() deep-clones every merged uniform, and cloning uGrassTex
        // (a real Texture, not a Color/number) here somehow left the
        // resulting InstancedMesh instances rendering nothing at all —
        // confirmed live (every farm grass tuft vanished) and isolated to
        // this specific clone call, not fog itself or the shader changes.
        fogColor:    { value: new THREE.Color() },
        fogDensity:  { value: 0 },
        fogNear:     { value: 1 },
        fogFar:      { value: 1000 },
      });
      grassBillboardMat = new THREE.ShaderMaterial({
        fog: true, // see _grassBillFrag's USE_FOG block — refreshed from whichever scene is active
        uniforms:       sharedUniforms(),
        vertexShader:   _grassBillVert,
        fragmentShader: _grassBillFrag,
        alphaTest: 0.5, side: THREE.DoubleSide, depthWrite: true,
      });
      deps.applySeasonalGrassAppearance();
      cuttableBillboardGlowMat = new THREE.ShaderMaterial({
        uniforms: {
          uGrassTex: { value: tex },
          uColor: { value: new THREE.Color(deps.combatConfig().cuttableTargetGlow?.color || '#ff2a1f') },
          uAlpha: { value: Number(deps.combatConfig().cuttableTargetGlow?.alpha) || 0.42 }
        },
        vertexShader: _grassBillVert,
        fragmentShader: `
          uniform sampler2D uGrassTex;
          uniform vec3 uColor;
          uniform float uAlpha;
          varying vec2 vUv;
          void main() {
            vec4 texel = texture2D(uGrassTex, vUv);
            if (texel.a < 0.5) discard;
            gl_FragColor = vec4(uColor, uAlpha * texel.a);
          }
        `,
        transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
      _rebuildFarmBillboards();
      if (deps.getTownSceneBuilt()) {
        _buildTownGrassBillboards(deps.getTownZone()?.cols || 60, deps.getTownZone()?.rows || 50);
        window.BorderTerrain.buildTownBorderGrassBillboards();
      }
    });
  }

  // Fills 14 crosses (28 blades) worth of instance matrices for one tile
  // into `mesh` starting at `startIdx`; returns the next free index.
  function _fillBillboardInstances(mesh, dummy, startIdx, col, row, sizeMul, yOffset = 0) {
    const rand  = _mbRng(((col * 31337 + row * 1009) >>> 0));
    const baseY = deps.tileSurfaceY(deps.TileType.GRASS) + yOffset;
    let idx = startIdx;
    for (let b = 0; b < 14; b++) {
      const ox  = (rand() - 0.5) * 0.9;
      const oz  = (rand() - 0.5) * 0.9;
      const w   = (0.16 + rand() * 0.10) * sizeMul;
      const h   = (0.22 + rand() * 0.14) * sizeMul;
      const rot = rand() * Math.PI;
      const px  = col + 0.5 + ox, pz = row + 0.5 + oz;

      dummy.position.set(px, baseY, pz);
      dummy.rotation.set(0, rot, 0);
      dummy.scale.set(w, h, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(idx++, dummy.matrix);

      dummy.rotation.set(0, rot + Math.PI * 0.5, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(idx++, dummy.matrix);
    }
    return idx;
  }

  function updateCuttableBillboardGlow(col, row, visible) {
    if (!cuttableBillboardGlowMesh || !cuttableBillboardGlowMat) return;
    if (!visible || deps.combatConfig().cuttableTargetGlow?.enabled === false) {
      cuttableBillboardGlowMesh.count = 0;
      return;
    }
    cuttableBillboardGlowMat.uniforms.uColor.value.set(deps.combatConfig().cuttableTargetGlow?.color || '#ff2a1f');
    cuttableBillboardGlowMat.uniforms.uAlpha.value = Number(deps.combatConfig().cuttableTargetGlow?.alpha) || 0.42;
    const dummy = new THREE.Object3D();
    cuttableBillboardGlowMesh.count = _fillBillboardInstances(cuttableBillboardGlowMesh, dummy, 0, col, row, 2.0);
    cuttableBillboardGlowMesh.instanceMatrix.needsUpdate = true;
  }

  // Farm grass (GRASS tiles, gated by s_grass) and weeds (WEEDS tiles in
  // Mode A, always on) each get one InstancedMesh sized for the worst case
  // (every farm tile being that type), so edits just refill the buffer and
  // adjust .count rather than recreating the mesh.
  let farmGrassBillMesh = null, farmWeedBillMesh = null;
  function _ensureFarmBillboardMeshes() {
    if (farmGrassBillMesh) return;
    const cap = deps.ROWS * deps.COLS * 28;
    farmGrassBillMesh = new THREE.InstancedMesh(_grassBladeGeo, grassBillboardMat, cap);
    farmGrassBillMesh.frustumCulled = false;
    farmGrassBillMesh.count = 0;
    farmGrassBillMesh.visible = deps.getGrassEnabled();
    farmGrassBillMesh.userData.isBillboard = true;
    deps.scene.add(farmGrassBillMesh);

    farmWeedBillMesh = new THREE.InstancedMesh(_grassBladeGeo, grassBillboardMat, cap);
    farmWeedBillMesh.frustumCulled = false;
    farmWeedBillMesh.count = 0;
    farmWeedBillMesh.userData.isBillboard = true;
    deps.scene.add(farmWeedBillMesh);

    cuttableBillboardGlowMesh = new THREE.InstancedMesh(_grassBladeGeo, cuttableBillboardGlowMat || grassBillboardMat, 28);
    cuttableBillboardGlowMesh.frustumCulled = false;
    cuttableBillboardGlowMesh.count = 0;
    cuttableBillboardGlowMesh.userData.isBillboard = true;
    deps.scene.add(cuttableBillboardGlowMesh);
  }

  function _rebuildFarmBillboards() {
    if (!grassBillboardMat) return;
    _ensureFarmBillboardMeshes();
    const dummy = new THREE.Object3D();
    let gi = 0, wi = 0;
    const grid = deps.getGrid();
    for (let row = 0; row < deps.ROWS; row++) {
      for (let col = 0; col < deps.COLS; col++) {
        const tile = grid[row][col];
        const tierY = (tile.elevTier || 0) * deps.PLATEAU_UNIT;
        if (tile.type === deps.TileType.GRASS) {
          gi = _fillBillboardInstances(farmGrassBillMesh, dummy, gi, col, row, 1.0, tierY);
        } else if (tile.type === deps.TileType.WEEDS && !deps.getWeed3D()) {
          wi = _fillBillboardInstances(farmWeedBillMesh, dummy, wi, col, row, 2.0, tierY);
        }
      }
    }
    farmGrassBillMesh.count = gi;
    farmWeedBillMesh.count  = wi;
    farmGrassBillMesh.instanceMatrix.needsUpdate = true;
    farmWeedBillMesh.instanceMatrix.needsUpdate  = true;
  }

  // Town's grass billboards — built once when entering town (town tiles
  // don't get tilled/cleared at runtime, so no per-tile rebuild needed).
  let townGrassBillMesh = null;
  function _buildTownGrassBillboards(tcols, trows) {
    if (!grassBillboardMat) return;
    const townScene = deps.getTownScene();
    if (townGrassBillMesh) { townScene.remove(townGrassBillMesh); townGrassBillMesh = null; }
    const townGrid = deps.getTownGrid();
    let count = 0;
    for (let row = 0; row < trows; row++)
      for (let col = 0; col < tcols; col++)
        if (townGrid[row]?.[col]?.type === deps.TileType.GRASS) count++;
    if (count === 0) return;

    townGrassBillMesh = new THREE.InstancedMesh(_grassBladeGeo, grassBillboardMat, count * 28);
    townGrassBillMesh.frustumCulled = false;
    townGrassBillMesh.visible = deps.getGrassEnabled();
    townGrassBillMesh.userData.isBillboard = true;
    const dummy = new THREE.Object3D();
    let idx = 0;
    for (let row = 0; row < trows; row++) {
      for (let col = 0; col < tcols; col++) {
        const tile = townGrid[row]?.[col];
        if (tile?.type !== deps.TileType.GRASS) continue;
        const tierY = (tile.elevTier || 0) * deps.PLATEAU_UNIT;
        idx = _fillBillboardInstances(townGrassBillMesh, dummy, idx, col, row, 1.0, tierY);
      }
    }
    townGrassBillMesh.count = idx;
    townGrassBillMesh.instanceMatrix.needsUpdate = true;
    townScene.add(townGrassBillMesh);
  }

  function _rebuildWeedTiles() {
    const grid = deps.getGrid();
    for (let r = 0; r < deps.ROWS; r++)
      for (let c = 0; c < deps.COLS; c++) {
        if (grid[r][c].type !== deps.TileType.WEEDS) continue;
        const i = r * deps.COLS + c;
        if (tileMeshes[i])       { deps.scene.remove(tileMeshes[i]);       tileMeshes[i]       = null; }
        if (vegFoliageMeshes[i]) { deps.scene.remove(vegFoliageMeshes[i]); setVegFoliageMesh(i, null); }
        _buildOneTileMesh(c, r);
      }
    _rebuildFarmBillboards();
  }

  // ── Crop mesh system ──────────────────────────────────────────
  // Needlegrain and heftroot use procedural foliage geometry.
  // All other crops use a simple colored cube (unchanged).
  const CROP_COLORS = {
    needlegrain:   { body: 0x8bc34a, ripe: 0xd4c526, sprout: 0x5a9e30 },
    heftroot:      { body: 0xcaa64a, ripe: 0xf0d15a, sprout: 0x7fae45 },
    garlink:       { body: 0xd8d0b0, ripe: 0xf2ead0, sprout: 0x8bbf6a },
    ongyums:       { body: 0xc07a3d, ripe: 0xe09a4b, sprout: 0x86b95a },
    redberries:    { body: 0xb83b42, ripe: 0xff4f62, sprout: 0x4c9b43 },
    blueberries:   { body: 0x3d62c8, ripe: 0x5f80ff, sprout: 0x4c9b74 },
    yellowberries: { body: 0xd6c345, ripe: 0xffe86a, sprout: 0x7ca84b },
    whiteberries:  { body: 0xdcded2, ripe: 0xffffff, sprout: 0x8bbf8a },
    blackberries:  { body: 0x3d2a52, ripe: 0x17121f, sprout: 0x4d8a4a },
    blackMustard:  { body: 0x4a3b2f, ripe: 0x1f1812, sprout: 0x789b3a },
    greenMustard:  { body: 0x6da64a, ripe: 0x9bd66b, sprout: 0x75b957 },
  };
  const CROP_MAX_SCALE = 0.96;
  const CROP_MIN_SCALE = 0.16;
  let cropMeshes = null;

  // Tracks which growth bucket (0–3) each foliage crop was built at,
  // so we only rebuild when the plant crosses a threshold.
  let cropGrowthBucket = null;

  // Indices of tiles that currently have a crop — rebuilt lazily whenever
  // a tile changes so updateCropMeshes() doesn't scan all 936 tiles.
  let _cropTileIndices = null;
  function _invalidateCropList() { _cropTileIndices = null; }
  function _ensureCropList() {
    if (_cropTileIndices !== null) return;
    _cropTileIndices = [];
    const grid = deps.getGrid();
    for (let row = 0; row < deps.ROWS; row++)
      for (let col = 0; col < deps.COLS; col++)
        if (grid[row][col].crop) _cropTileIndices.push(row * deps.COLS + col);
  }

  const FOLIAGE_CROPS = new Set(['needlegrain', 'heftroot']);

  function _growthBucket(growth) {
    // Rebuild foliage at 4 thresholds to avoid per-frame rebuilds.
    if (growth < 0.15) return 0;
    if (growth < 0.45) return 1;
    if (growth < 0.80) return 2;
    return 3;
  }

  function _buildFoliageMesh(crop, growth, col, row) {
    const FG = window.FoliageGenerator;
    if (!FG) return null;
    if (crop === 'needlegrain') return FG.buildNeedlegrainMesh(growth, col, row);
    if (crop === 'heftroot') {
      // Three plants in a triangle cluster, each with a unique seed offset
      const wrapper = new THREE.Group();
      const offsets = [[-0.20, 0, 0.14], [0.22, 0, 0.14], [0.0, 0, -0.22]];
      for (let idx = 0; idx < 3; idx++) {
        const [ox, oy, oz] = offsets[idx];
        const plant = FG.buildHeftrootMesh(growth, col + idx * 127, row + idx * 61);
        plant.position.set(ox, oy, oz);
        plant.scale.setScalar(0.68);
        wrapper.add(plant);
      }
      return wrapper;
    }
    return null;
  }

  function updateCropMeshes() {
    _ensureCropList();
    const grid = deps.getGrid();
    const _now = performance.now();
    for (const i of _cropTileIndices) {
      const col  = i % deps.COLS;
      const row  = (i / deps.COLS) | 0;
      const tile = grid[row][col];

      // Stale entry (crop was harvested since last list rebuild) — clean up.
      if (!tile.crop) {
        if (cropMeshes[i]) { deps.scene.remove(cropMeshes[i]); cropMeshes[i] = null; }
        cropGrowthBucket[i] = -1;
        _invalidateCropList();
        continue;
      }

        const data   = deps.cropData[tile.crop];
        const growth = Math.min(tile.cropAge / data.growDays, 1.0);
        const surfY  = deps.tileSurfaceY(tile.type) + tile.water * deps.WATER_UNIT;

        if (FOLIAGE_CROPS.has(tile.crop)) {
          // ── Procedural foliage mesh ──────────────────────────────
          const bucket = _growthBucket(growth);
          if (cropMeshes[i] && cropGrowthBucket[i] !== bucket) {
            // Growth crossed a threshold — rebuild.
            deps.scene.remove(cropMeshes[i]);
            cropMeshes[i] = null;
          }
          if (!cropMeshes[i]) {
            const group = _buildFoliageMesh(tile.crop, growth, col, row);
            if (group) {
              deps.scene.add(group);
              deps.markOutline(group);
              cropMeshes[i]       = group;
              cropGrowthBucket[i] = bucket;
            }
          }
          const mesh = cropMeshes[i];
          if (!mesh) continue;

          // Scale: foliage group base is at y=0, grows +Y about 0.5 units at full.
          // Map to the same visual range as the old box (0.08..0.48).
          const scale = CROP_MIN_SCALE + (CROP_MAX_SCALE - CROP_MIN_SCALE) * growth;
          mesh.scale.setScalar(scale);

          const bobY = tile.cropReady ? Math.sin(_now / 500 + col + row) * 0.025 : 0;
          mesh.position.set(col + 0.5, surfY + 0.01 + bobY, row + 0.5);
          if (tile.cropReady) mesh.rotation.y = _now / 2200 + col;

        } else {
          // ── Simple colored cube (all other crops) ────────────────
          const colors = CROP_COLORS[tile.crop] || CROP_COLORS.garlink;
          const size   = CROP_MIN_SCALE + (CROP_MAX_SCALE - CROP_MIN_SCALE) * growth;
          const color  = tile.cropReady ? colors.ripe
                       : growth < 0.15  ? colors.sprout
                       : colors.body;

          if (!cropMeshes[i]) {
            const geo  = new THREE.BoxGeometry(1, 1, 1);
            const mat  = new THREE.MeshLambertMaterial({ color });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.castShadow = true;
            deps.scene.add(mesh);
            mesh.layers.enable(1);
            cropMeshes[i] = mesh;
          }

          const mesh = cropMeshes[i];
          mesh.material.color.setHex(color);
          mesh.scale.setScalar(size);
          const bobY = tile.cropReady ? Math.sin(_now / 500 + col + row) * 0.03 : 0;
          mesh.position.set(col + 0.5, surfY + size / 2 + 0.02 + bobY, row + 0.5);
          if (tile.cropReady) mesh.rotation.y = _now / 1200 + col;
        }
    }
  }

  // Update a single tile mesh (called after shovel actions)
  function _buildOneTileMesh(col, row) {
    const TileType = deps.TileType;
    const i    = row * deps.COLS + col;
    const grid = deps.getGrid();
    const tile = grid[row][col];
    const mat  = deps.resolveTileMat('farm', tile.type);

    if (tile.type === TileType.ROCK) {
      // Floor slab — grass so it blends with surrounding tiles
      const floorMesh = new THREE.Mesh(window.TerrainGeometry.makeFloorGeo(col, row), deps.resolveTileMat('farm', TileType.GRASS));
      floorMesh.castShadow = floorMesh.receiveShadow = true;
      floorMesh.position.set(col + 0.5, deps.NORMAL_TOP - deps.SLAB_H / 2, row + 0.5);
      deps.scene.add(floorMesh);
      tileMeshes[i] = floorMesh;
      deps.markTerrainEdgeId(floorMesh, TileType.GRASS);
      // Plateau mound: stone for elevated/cliff cells, grass for ground-level base
      const { stoneGeo, grassGeo } = window.TerrainGeometry.buildRockTileGeo(col, row);
      let moundRoot = null;
      if (stoneGeo) {
        const m = new THREE.Mesh(stoneGeo, deps.resolveTileMat('farm', TileType.ROCK));
        m.castShadow = m.receiveShadow = true;
        m.position.set(col + 0.5, deps.NORMAL_TOP, row + 0.5);
        deps.scene.add(m);
        deps.markTerrainEdgeId(m, TileType.ROCK);
        moundRoot = m;
      }
      if (grassGeo) {
        const m = new THREE.Mesh(grassGeo, deps.resolveTileMat('farm', TileType.GRASS));
        m.castShadow = m.receiveShadow = true;
        m.position.set(col + 0.5, deps.NORMAL_TOP, row + 0.5);
        deps.scene.add(m);
        deps.markTerrainEdgeId(m, TileType.GRASS);
        if (!moundRoot) moundRoot = m;
      }
      if (moundRoot) moundRoot._windAmp = 0;  // wind loop skips _windAmp=0
      setVegFoliageMesh(i, moundRoot || { _windAmp: 0 });
      deps.markOutline(moundRoot);
      return;
    }

    if (tile.type === TileType.SHRUB && window.FoliageGenerator) {
      // Grass floor slab underneath the shrub
      const floorMesh = new THREE.Mesh(window.TerrainGeometry.makeFloorGeo(col, row), deps.vegFloorMat);
      floorMesh.castShadow = floorMesh.receiveShadow = true;
      floorMesh.position.set(col + 0.5, deps.tileYCenter(TileType.GRASS), row + 0.5);
      deps.scene.add(floorMesh);
      tileMeshes[i] = floorMesh;
      deps.markTerrainEdgeId(floorMesh, TileType.GRASS);

      const vegGroup = window.FoliageGenerator.buildShrubMesh(col, row);
      vegGroup._windPhase = (col * 1.7 + row * 2.3) % (Math.PI * 2);
      vegGroup._windAmp   = 0.06;
      // buildShrubMesh now returns TREE_PRESETS.bush, so its native scale
      // is already the regular wilderness-bush size. Do not apply the old
      // generic shrub x2 farm boost here.
      vegGroup.position.set(col + 0.5, deps.tileSurfaceY(tile.type), row + 0.5);
      deps.scene.add(vegGroup);
      setVegFoliageMesh(i, vegGroup);
      deps.markOutline(vegGroup);
      return;
    }

    if (tile.type === TileType.WEEDS) {
      // Grass floor slab underneath
      const floorMesh = new THREE.Mesh(window.TerrainGeometry.makeFloorGeo(col, row), deps.vegFloorMat);
      floorMesh.castShadow = floorMesh.receiveShadow = true;
      floorMesh.position.set(col + 0.5, deps.tileYCenter(TileType.GRASS), row + 0.5);
      deps.scene.add(floorMesh);
      tileMeshes[i] = floorMesh;
      deps.markTerrainEdgeId(floorMesh, TileType.GRASS);

      if (deps.getWeed3D() && window.FoliageGenerator) {
        // Mode B: procedural 3D weeds, subject to shell outline
        const vegGroup = new THREE.Group();
        vegGroup.position.set(col + 0.5, deps.tileSurfaceY(tile.type), row + 0.5);
        const rng   = _mbRng(((col * 31337 + row * 1009) >>> 0));
        const count = 3 + ((col * 7 + row * 13) % 3);  // 3–5 plants
        for (let p = 0; p < count; p++) {
          const wm = window.FoliageGenerator.buildWeedsMesh(col * 50 + p, row * 50 + p);
          if (wm) {
            wm.position.set((rng() - 0.5) * 0.8, 0, (rng() - 0.5) * 0.8);
            vegGroup.add(wm);
          }
        }
        vegGroup._windPhase = (col * 1.7 + row * 2.3) % (Math.PI * 2);
        vegGroup._windAmp   = 0.10;
        deps.scene.add(vegGroup);
        setVegFoliageMesh(i, vegGroup);
        deps.markOutline(vegGroup);
      }
      return;
    }

    if (tile.type === TileType.TRENCH || tile.type === TileType.RAISED) {
      const { dirtGeo, grassGeo } = window.TerrainGeometry.buildTerrainTileGeo(col, row, tile.type);
      let primary = null;
      if (dirtGeo) {
        // Both types use trench brown — raised earth is the same dug-soil colour
        const m = new THREE.Mesh(dirtGeo, deps.resolveTileMat('farm', TileType.TRENCH));
        m.castShadow = m.receiveShadow = true;
        m.position.set(col + 0.5, deps.NORMAL_TOP, row + 0.5);
        deps.scene.add(m);
        m.layers.enable(1);  // material transition outline
        deps.markTerrainEdgeId(m, TileType.TRENCH);
        primary = m;
      }
      if (grassGeo) {
        const m = new THREE.Mesh(grassGeo, deps.resolveTileMat('farm', TileType.GRASS));
        m.castShadow = m.receiveShadow = true;
        m.position.set(col + 0.5, deps.NORMAL_TOP, row + 0.5);
        m._windAmp = 0;
        deps.scene.add(m);
        m.layers.enable(1);  // material transition outline
        deps.markTerrainEdgeId(m, TileType.GRASS);
        setVegFoliageMesh(i, m);
        if (!primary) primary = m;
      }
      tileMeshes[i] = primary;
      return;
    }

    if (tile.type === TileType.PATH) {
      const { pathGeo, grassGeo } = window.TerrainGeometry.buildPathTileGeo(col, row);
      let primary = null;
      if (pathGeo) {
        // Regular ground (grass) under the path — the paved brick
        // surface (see "Path: paved brick surface" / registerPathBrickChunks
        // for 'farm') overlays ordinary ground rather than a separately-
        // colored path patch, same treatment as the town path.
        const m = new THREE.Mesh(pathGeo, deps.resolveTileMat('farm', TileType.GRASS));
        m.castShadow = m.receiveShadow = true;
        m.position.set(col + 0.5, deps.NORMAL_TOP, row + 0.5);
        deps.markTerrainEdgeId(m, TileType.GRASS);
        deps.scene.add(m);
        primary = m;
      }
      if (grassGeo) {
        const m = new THREE.Mesh(grassGeo, deps.resolveTileMat('farm', TileType.GRASS));
        m.castShadow = m.receiveShadow = true;
        m.position.set(col + 0.5, deps.NORMAL_TOP, row + 0.5);
        deps.scene.add(m);
        deps.markTerrainEdgeId(m, TileType.GRASS);
        if (!primary) primary = m;
      }
      tileMeshes[i] = primary;
      return;
    }

    let mesh;
    if (tile.type === TileType.SHRUB || tile.type === TileType.WEEDS) {
      // Fallback: foliage generator not available
      const phase = (col * 1.7 + row * 2.3) % (Math.PI * 2);
      const color = tile.type === TileType.SHRUB ? 0x356e36 : 0x247c3c;
      mesh = new THREE.Mesh(vegGeo, makeVegMaterial(color, phase));
      vegMeshes.push(mesh);
    } else {
      mesh = new THREE.Mesh(tile.type === TileType.ROCK ? deps.rockGeo : window.TerrainGeometry.makeFloorGeo(col, row), mat);
    }
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.position.set(col + 0.5, deps.tileYCenter(tile.type), row + 0.5);
    deps.scene.add(mesh);
    tileMeshes[i] = mesh;
    // Rock and fallback vegetation get outlines; flat floor tiles do not.
    if (tile.type === TileType.ROCK || tile.type === TileType.SHRUB || tile.type === TileType.WEEDS) {
      mesh.layers.enable(1);
    } else {
      // Flat ground tiles (grass/tilled/paddy/river/stream bed) — fallback
      // foliage billboards above are skipped since they aren't flat ground.
      deps.markTerrainEdgeId(mesh, deps.terrainCategoryFor(tile.type));
    }
  }

  function buildTileMeshes() {
    window.WaterSystem.resetFarmWaterMesh();
    for (let row = 0; row < deps.ROWS; row++) {
      for (let col = 0; col < deps.COLS; col++) {
        const i = row * deps.COLS + col;
        if (tileMeshes[i])     { deps.scene.remove(tileMeshes[i]);     tileMeshes[i]     = null; }
        if (cropMeshes[i])          { deps.scene.remove(cropMeshes[i]);          cropMeshes[i]          = null; }
        if (vegFoliageMeshes[i])    { deps.scene.remove(vegFoliageMeshes[i]);    setVegFoliageMesh(i, null); }
        cropGrowthBucket[i] = -1;
        _buildOneTileMesh(col, row);
      }
    }
    _rebuildFarmBillboards();
  }

  // Update a single tile mesh (called after shovel actions)
  function refreshTileMesh(col, row) {
    const i = row * deps.COLS + col;
    if (tileMeshes[i])     { deps.scene.remove(tileMeshes[i]);     tileMeshes[i]     = null; }
    if (cropMeshes[i])          { deps.scene.remove(cropMeshes[i]);          cropMeshes[i]          = null; }
    if (vegFoliageMeshes[i])    { deps.scene.remove(vegFoliageMeshes[i]);    setVegFoliageMesh(i, null); }
    cropGrowthBucket[i] = -1;
    _buildOneTileMesh(col, row);
    _rebuildFarmBillboards();
  }

  window.VegetationCropRendering = {
    init(injectedDeps) {
      init(injectedDeps);
      cropMeshes       = new Array(deps.ROWS * deps.COLS).fill(null);
      cropGrowthBucket = new Array(deps.ROWS * deps.COLS).fill(-1);
      vegFoliageMeshes.length = deps.ROWS * deps.COLS;
      vegFoliageMeshes.fill(null);
      tileMeshes = new Array(deps.ROWS * deps.COLS).fill(null);
      _startGrassTextureLoad();
    },
    // Stable pure helpers/values, consumed directly (no deps needed to
    // construct) by BorderTerrain/ZoneGrassBillboards/ReagentPlants/
    // WildBerries/WildTreasure's own init() calls.
    mbRng: _mbRng,
    grassBladeGeo: _grassBladeGeo,
    grassBillVert: _grassBillVert,
    grassTint: _grassTint,
    fillBillboardInstances: _fillBillboardInstances,
    vegMeshes,
    vegFoliageMeshes,
    vegFoliageActive: _vegFoliageActive,
    get cropMeshes() { return cropMeshes; },
    getGrassBillboardMat: () => grassBillboardMat,
    getGrassLeafTex: () => _grassLeafTex,
    getFarmGrassBillMesh: () => farmGrassBillMesh,
    getTownGrassBillMesh: () => townGrassBillMesh,
    buildTownGrassBillboards: _buildTownGrassBillboards,
    updateCuttableBillboardGlow,
    buildTileMeshes,
    refreshTileMesh,
    updateCropMeshes,
    invalidateCropList: _invalidateCropList,
    rebuildWeedTiles: _rebuildWeedTiles,
  };
})();
