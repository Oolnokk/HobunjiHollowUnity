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
  const WEED_PAIR_TILT = THREE.MathUtils.degToRad(20); // Used by weed billboard pairs to splay their tops 40° total from one bottom origin.

  const _grassBillVert = `
    uniform float uTime;
    uniform float uStrength;
    #ifdef HOBUNJI_GRASS_DISTANCE_LOD
      uniform float uDensity;
    #endif
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
    #ifdef HOBUNJI_GRASS_DISTANCE_LOD
      // x = full-density radius, y = radius where thinning bottoms out,
      // z = fraction of blades kept beyond y. y <= x disables the thinning.
      uniform vec3 uGrassLod;
    #endif
    void main() {
      vUv = uv;
      #ifdef USE_INSTANCING
        vec4 worldPos = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vec4 randomOrigin = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      #else
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vec4 randomOrigin = modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      #endif
      // Use the instance bottom origin for seasonal density so this value is
      // constant across the whole plane instead of becoming an interpolated mask.
      vRandom = fract(sin(dot(randomOrigin.xz, vec2(12.9898, 78.233))) * 43758.5453);
      #ifdef HOBUNJI_GRASS_DISTANCE_LOD
        // Blades the fragment shader would discard anyway (seasonal density)
        // and a growing share of distant blades are pushed outside the clip
        // volume here, so they cost no rasterisation, alpha-test or overdraw.
        // The same per-blade random as the seasonal mask keeps the kept set
        // stable while walking: a blade only appears/disappears as its own
        // distance crosses its threshold, never flickers between frames.
        float grassKeep = uDensity;
        if (uGrassLod.y > uGrassLod.x) {
          float grassLodDist = length(randomOrigin.xz - cameraPosition.xz);
          grassKeep *= mix(1.0, uGrassLod.z, smoothstep(uGrassLod.x, uGrassLod.y, grassLodDist));
        }
        if (vRandom > grassKeep) {
          vUv = vec2(0.0);
          #ifdef USE_FOG
            vGrassFogFactor = 0.0;
          #endif
          gl_Position = vec4(0.0, 0.0, 2.0, 1.0); // z/w = 2 lies beyond the far plane: clipped before rasterisation.
          return;
        }
      #endif
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
  // Distance thinning for the one grass material shared by the farm, town,
  // town border and every wilderness zone (the outdoor-only alpha-tested
  // overdraw that interiors and caves never pay). Distances are world units
  // from the camera: full density inside NEAR, tapering to MIN_KEEP of the
  // blades at FAR and beyond. Fog already washes most of the far blades out.
  const GRASS_LOD_DEFAULTS = Object.freeze({ near: 12, far: 34, minKeep: 0.35 });
  const _grassLodUniformValue = new THREE.Vector3(GRASS_LOD_DEFAULTS.near, GRASS_LOD_DEFAULTS.far, GRASS_LOD_DEFAULTS.minKeep);
  function setGrassDistanceLod(options = true) {
    if (options === false) { _grassLodUniformValue.y = _grassLodUniformValue.x = 0; return getGrassDistanceLod(); } // A/B switch: full density everywhere.
    const next = { ...GRASS_LOD_DEFAULTS, ...(options === true ? {} : options) };
    const near = Math.max(0, Number(next.near) || 0);
    const far = Math.max(near + 0.001, Number(next.far) || 0);
    const minKeep = Math.max(0, Math.min(1, Number(next.minKeep)));
    _grassLodUniformValue.set(near, far, Number.isFinite(minKeep) ? minKeep : GRASS_LOD_DEFAULTS.minKeep);
    return getGrassDistanceLod();
  }
  function getGrassDistanceLod() {
    const v = _grassLodUniformValue;
    return { enabled: v.y > v.x, near: v.x, far: v.y, minKeep: v.z };
  }
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
      const grassUniforms = sharedUniforms();
      grassUniforms.uGrassLod = { value: _grassLodUniformValue }; // Shared vector: setGrassDistanceLod() retunes every outdoor map at once.
      grassBillboardMat = new THREE.ShaderMaterial({
        fog: true, // see _grassBillFrag's USE_FOG block — refreshed from whichever scene is active
        defines: { HOBUNJI_GRASS_DISTANCE_LOD: 1 }, // Only this material: other users of _grassBillVert (glow, reagent plants) declare no uGrassLod.
        uniforms:       grassUniforms,
        vertexShader:   _grassBillVert,
        fragmentShader: _grassBillFrag,
        alphaTest: 0.5, side: THREE.DoubleSide, depthWrite: true,
      });
      deps.applySeasonalGrassAppearance();
      cuttableBillboardGlowMat = new THREE.ShaderMaterial({
        uniforms: {
          uGrassTex: { value: tex },
          uTime: grassBillboardMat.uniforms.uTime, // Shared so the selection highlight sways in exact lockstep with the weed cards.
          uStrength: grassBillboardMat.uniforms.uStrength, // Shared so wind amplitude cannot drift between weed and highlight.
          uDensity: grassBillboardMat.uniforms.uDensity, // Shared so seasonally hidden weed planes are also omitted from the highlight.
          uColor: { value: new THREE.Color(deps.combatConfig().cuttableTargetGlow?.color || '#ff2a1f') },
          uAlpha: { value: Number(deps.combatConfig().cuttableTargetGlow?.alpha) || 0.42 }
        },
        vertexShader: _grassBillVert,
        fragmentShader: `
          uniform sampler2D uGrassTex;
          uniform float uDensity;
          uniform vec3 uColor;
          uniform float uAlpha;
          varying vec2 vUv;
          varying float vRandom;
          void main() {
            if (vRandom > uDensity) discard;
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

  // Fills 14 billboard pairs (28 planes) worth of instance matrices for one tile.
  // pairTiltRad=0 preserves the normal perpendicular grass cross; a nonzero
  // value gives both planes one yaw/origin and opposite local-X tilts.
  function _fillBillboardInstances(mesh, dummy, startIdx, col, row, sizeMul, yOffset = 0, widthMul = 1, heightMul = 1, pairTiltRad = 0) {
    const rand  = _mbRng(((col * 31337 + row * 1009) >>> 0));
    const baseY = deps.tileSurfaceY(deps.TileType.GRASS) + yOffset;
    let idx = startIdx;
    for (let b = 0; b < 14; b++) {
      const ox  = (rand() - 0.5) * 0.9;
      const oz  = (rand() - 0.5) * 0.9;
      const w   = (0.16 + rand() * 0.10) * sizeMul * widthMul;
      const h   = (0.22 + rand() * 0.14) * sizeMul * heightMul;
      const rot = rand() * Math.PI;
      const px  = col + 0.5 + ox, pz = row + 0.5 + oz;

      dummy.position.set(px, baseY, pz);
      dummy.scale.set(w, h, 1);
      if (pairTiltRad) {
        dummy.rotation.set(pairTiltRad, rot, 0, 'YXZ');
        dummy.updateMatrix();
        mesh.setMatrixAt(idx++, dummy.matrix);

        dummy.rotation.set(-pairTiltRad, rot, 0, 'YXZ');
        dummy.updateMatrix();
        mesh.setMatrixAt(idx++, dummy.matrix);
      } else {
        dummy.rotation.set(0, rot, 0, 'XYZ');
        dummy.updateMatrix();
        mesh.setMatrixAt(idx++, dummy.matrix);

        dummy.rotation.set(0, rot + Math.PI * 0.5, 0, 'XYZ');
        dummy.updateMatrix();
        mesh.setMatrixAt(idx++, dummy.matrix);
      }
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
    const tile = deps.getGrid()?.[row]?.[col]; // Used here to match the selected weed billboard's elevation tier exactly.
    const tierY = (tile?.elevTier || 0) * deps.PLATEAU_UNIT; // Passed into the same billboard transform helper used by the visible weed.
    const dummy = new THREE.Object3D();
    cuttableBillboardGlowMesh.count = _fillBillboardInstances(cuttableBillboardGlowMesh, dummy, 0, col, row, 2.0, tierY, 0.75, 0.75, WEED_PAIR_TILT);
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
    farmGrassBillMesh.userData.noOutline = true; // Authored grass blade art already contains its own border.
    deps.scene.add(farmGrassBillMesh);
    window.GrassBillboardRenderChunks?.register(farmGrassBillMesh); // Drawn as camera-cullable chunks (js/grass-billboard-render-chunks.js).

    farmWeedBillMesh = new THREE.InstancedMesh(_grassBladeGeo, grassBillboardMat, cap);
    farmWeedBillMesh.frustumCulled = false;
    farmWeedBillMesh.count = 0;
    farmWeedBillMesh.userData.isBillboard = true;
    farmWeedBillMesh.userData.noOutline = true; // Don't outline individual flat weed cards.
    deps.scene.add(farmWeedBillMesh);
    window.GrassBillboardRenderChunks?.register(farmWeedBillMesh); // Drawn as camera-cullable chunks (js/grass-billboard-render-chunks.js).

    cuttableBillboardGlowMesh = new THREE.InstancedMesh(_grassBladeGeo, cuttableBillboardGlowMat || grassBillboardMat, 28);
    cuttableBillboardGlowMesh.frustumCulled = false;
    cuttableBillboardGlowMesh.count = 0;
    cuttableBillboardGlowMesh.userData.isBillboard = true;
    cuttableBillboardGlowMesh.userData.noOutline = true; // Colored highlight pass is separate from shell rendering.
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
        const pavedRoad = window.FarmPathBricks?.suppressesGrassAt?.(col, row); // Keeps billboard grass off visual road tiles without rewriting their saved terrain type.
        if (tile.type === deps.TileType.GRASS && !tile.crop && !pavedRoad) {
          gi = _fillBillboardInstances(farmGrassBillMesh, dummy, gi, col, row, 1.0, tierY);
        } else if (tile.type === deps.TileType.WEEDS && !tile.crop && !deps.getWeed3D()) {
          wi = _fillBillboardInstances(farmWeedBillMesh, dummy, wi, col, row, 2.0, tierY, 0.75, 0.75, WEED_PAIR_TILT);
        }
      }
    }
    farmGrassBillMesh.count = gi;
    farmWeedBillMesh.count  = wi;
    farmGrassBillMesh.instanceMatrix.needsUpdate = true;
    farmWeedBillMesh.instanceMatrix.needsUpdate  = true;
    // A rebuilt farm grass buffer must replace the footprint filter's old
    // source matrices, or moving/refreshing a house can restore stale tufts
    // over spouse-tilled soil, crops and dug trenches.
    window.BuildingGrassSuppression?.refreshRebuiltBillboardMesh?.(farmGrassBillMesh);
    window.BuildingGrassSuppression?.refreshRebuiltBillboardMesh?.(farmWeedBillMesh);
  }

  // Town's normalized map layout deliberately contains no farmPlots array:
  // the NPC plot registry owns the authoritative managed-tile footprint, which
  // the town loader already uses to replace authored soil/trench ground with
  // grass beneath the NPC work meshes. Reuse that exact predicate here, so
  // billboard suppression cannot disagree with the floor normalization.
  function isManagedTownPlotTile(col, row) {
    return window.NpcFarmPlots?.isManagedTile?.('map_hobunji_town', col, row) === true;
  }

  // Town grass is rebuilt on entry; working NPC plots reserve their tile
  // footprint even when individual cells are briefly bare between crops.
  let townGrassBillMesh = null;
  function _buildTownGrassBillboards(tcols, trows) {
    if (!grassBillboardMat) return;
    const townScene = deps.getTownScene();
    if (townGrassBillMesh) { townScene.remove(townGrassBillMesh); townGrassBillMesh = null; }
    const townGrid = deps.getTownGrid();
    let count = 0;
    for (let row = 0; row < trows; row++)
      for (let col = 0; col < tcols; col++)
        if (townGrid[row]?.[col]?.type === deps.TileType.GRASS && !isManagedTownPlotTile(col, row)) count++;
    if (count === 0) return;

    townGrassBillMesh = new THREE.InstancedMesh(_grassBladeGeo, grassBillboardMat, count * 28);
    townGrassBillMesh.frustumCulled = false;
    townGrassBillMesh.visible = deps.getGrassEnabled();
    townGrassBillMesh.userData.isBillboard = true;
    townGrassBillMesh.userData.noOutline = true; // Festival lawn blade cards already carry authored ink.
    const dummy = new THREE.Object3D();
    let idx = 0;
    for (let row = 0; row < trows; row++) {
      for (let col = 0; col < tcols; col++) {
        const tile = townGrid[row]?.[col];
        if (tile?.type !== deps.TileType.GRASS || isManagedTownPlotTile(col, row)) continue;
        const tierY = (tile.elevTier || 0) * deps.PLATEAU_UNIT;
        idx = _fillBillboardInstances(townGrassBillMesh, dummy, idx, col, row, 1.0, tierY);
      }
    }
    townGrassBillMesh.count = idx;
    // Capture before scene.add: height followers and footprint filtering share this flat source.
    townGrassBillMesh.userData.hobunjiBillboardSourceMatrices = new Float32Array(townGrassBillMesh.instanceMatrix.array);
    townGrassBillMesh.userData.hobunjiBillboardSourceCount = idx;
    townGrassBillMesh.instanceMatrix.needsUpdate = true;
    townScene.add(townGrassBillMesh);
    window.GrassBillboardRenderChunks?.register(townGrassBillMesh); // Drawn as camera-cullable chunks (js/grass-billboard-render-chunks.js).
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
  // Needlegrain/heftroot, mushtard and berry bushes own genuine foliage.
  // Only garlink and ongyums retain placeholders for the authored PNG bridge.
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



  // Mushtard foliage is made from existing hand-painted leaf PNGs, not a
  // special new sprite. The outer card is lobed; the inner card is broad.
  const MUSHTARD_LEAF_ART = Object.freeze({
    outer: 'assets/leaves/small_leaf.png',
    inner: 'assets/leaves/speartip_leaf.png',
  }); // Existing foliage assets shared with the rest of the game.
  const mushtardGeometries = new Map(); // Stores one softly warped plane per leaf shape.
  const mushtardTextures = new Map(); // Loads each existing PNG only once for both cultivars.
  const mushtardMaterials = new Map(); // Reuses alpha-cutout materials for each shape and plant color.

  function _mushtardCardGeometry(shape) {
    if (mushtardGeometries.has(shape)) return mushtardGeometries.get(shape);
    const geometry = new THREE.PlaneGeometry(1, 1, 4, 8); // 4×8 subdivisions permit subtle leaf bending without a new texture.
    geometry.translate(0, 0.5, 0); // Place the card base at the common rosette crown.
    const positions = geometry.getAttribute('position'); // Modified here to gently widen the blade and curve its surface.
    for (let index = 0; index < positions.count; index++) {
      const x = positions.getX(index); // Original sideways position before a mid-blade bulge is applied.
      const y = positions.getY(index); // Distance along the leaf from petiole to tip, in [0, 1].
      const bulge = Math.sin(Math.PI * y); // Concentrates the broadened silhouette in the middle, leaving the root narrow.
      const widen = shape === 'outer' ? 0.34 : 0.14; // Lobed outer leaves need more width than their source artwork.
      const lean = (shape === 'outer' ? 0.075 : 0.035) * bulge * (2 * y - 0.5); // Slightly bends the blade away from a perfect straight strip.
      positions.setXYZ(index,
        x * (1 + widen * bulge) + lean,
        y,
        (0.045 + Math.abs(x) * 0.055) * bulge); // Shallow 3D cupping so leaves do not read as rigid rectangles.
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    geometry.boundingSphere.center.set(0, 0.25, 0);
    geometry.boundingSphere.radius = 0.85; // Includes the entire rotated rosette, not just the source leaf card.
    mushtardGeometries.set(shape, geometry);
    return geometry;
  }

  function _mushtardTexture(shape) {
    if (mushtardTextures.has(shape)) return mushtardTextures.get(shape).texture;
    const path = MUSHTARD_LEAF_ART[shape]; // Refers only to leaves that already exist on main.
    const record = { texture: null, state: 'loading' }; // Reports each image's loading state in the dev companion.
    mushtardTextures.set(shape, record);
    record.texture = new THREE.TextureLoader().load(path, texture => {
      if (THREE.sRGBEncoding !== undefined) texture.encoding = THREE.sRGBEncoding;
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.generateMipmaps = false; // Matches the shared foliage-generator PNG settings.
      texture.needsUpdate = true;
      record.state = 'loaded';
    }, undefined, () => {
      record.state = 'failed';
      window.__farmLog?.(`[mushtard] failed to load existing leaf art: ${path}`, 'warn');
    });
    return record.texture;
  }

  function _mushtardMaterial(family, shape) {
    const key = family + ':' + shape; // Reuse one leaf material for every card with the same variety and PNG.
    if (mushtardMaterials.has(key)) return mushtardMaterials.get(key);
    const tint = family === 'blackMustard' ? 0xc1d5b9 : 0xddf0cf; // Black mushtard's seeds are black, not its leaves.
    const material = new THREE.MeshBasicMaterial({
      map: _mushtardTexture(shape),
      color: tint,
      side: THREE.DoubleSide,
      transparent: false,
      alphaTest: 0.5,
      depthWrite: true,
    }); // Uses the foliage generator's opaque alpha-test rendering, avoiding transparent depth-sort glitches.
    mushtardMaterials.set(key, material);
    return material;
  }

  function _buildMustardMesh(family, growth, col, row) {
    const group = new THREE.Group(); // Root at soil level, compatible with the original crop renderer.
    const rand = _mbRng(Math.imul(col + 1, 92837111) ^ Math.imul(row + 1, 689287499) ^ 0x4d575354); // Stable per-tile leaf arrangement.
    const stage = _growthBucket(growth); // Reuses existing growth buckets for leaf density.
    const rings = [
      { count: stage >= 3 ? 7 : stage === 2 ? 5 : stage === 1 ? 3 : 2, shape: 'outer', length: 0.58, width: 0.48, tilt: 1.10, offset: 0.0 },
      { count: stage >= 3 ? 5 : stage === 2 ? 4 : stage === 1 ? 2 : 1, shape: 'outer', length: 0.47, width: 0.37, tilt: 0.73, offset: 0.29 },
      { count: stage >= 3 ? 3 : stage === 2 ? 2 : 0, shape: 'inner', length: 0.37, width: 0.31, tilt: 0.33, offset: 0.57 },
    ]; // Mature plant: wide, low lobed leaves around a smaller, upright heart.
    const counts = { outer: 0, inner: 0 }; // Totals per source PNG allocate tightly sized instance buffers.
    for (const ring of rings) counts[ring.shape] += ring.count;
    const batches = {}; // Two draw calls per plant regardless of its leaf count, keeping mobile farm fields practical.
    for (const shape of ['outer', 'inner']) {
      if (!counts[shape]) continue;
      const batch = new THREE.InstancedMesh(_mushtardCardGeometry(shape), _mushtardMaterial(family, shape), counts[shape]);
      batch.castShadow = false;
      batch.receiveShadow = false;
      batch.frustumCulled = true; // Expanded shared geometry bounds safely cull entire offscreen plants.
      batch.userData.noOutline = true; // Alpha-cutout leaf cards cannot use the inverted-hull shell: it paints their transparent area solid black.
      batch.userData.hobunjiMustardLeaf = true; // The dev companion can identify the source shape and leaf instance IDs.
      batch.userData.hobunjiMustardShape = shape;
      batches[shape] = batch;
      group.add(batch);
    }
    const nextIndex = { outer: 0, inner: 0 }; // Tracks each shape's next instance slot while processing rosette rings.
    const leafTransform = new THREE.Object3D(); // Reused to compose all leaf matrices without 15 separate render objects.
    for (let ringIndex = 0; ringIndex < rings.length; ringIndex++) {
      const ring = rings[ringIndex]; // Leaf dimensions and density for the current concentric ring.
      for (let index = 0; index < ring.count; index++) {
        const azimuth = (index + ring.offset) * Math.PI * 2 / ring.count + (rand() - 0.5) * 0.2; // Radial fan with small irregularity.
        const tilt = ring.tilt + (rand() - 0.5) * 0.19; // Older outer leaves lie flatter than the young center.
        const length = ring.length * (0.88 + rand() * 0.19); // Leaf-by-leaf length variation.
        const width = ring.width * (0.88 + rand() * 0.22); // Leaf-by-leaf width variation.
        const mirror = rand() < 0.5; // Reflect the source illustration without a negative instance scale (unsupported by Three.js).
        leafTransform.position.set((rand() - 0.5) * 0.035, 0.018 + ringIndex * 0.018, (rand() - 0.5) * 0.035);
        leafTransform.rotation.set(tilt, azimuth, (rand() - 0.5) * 0.12, 'YXZ');
        if (mirror) leafTransform.rotateY(Math.PI); // Local half-turn reflects the double-sided PNG without changing its radial growth direction.
        leafTransform.scale.set(width, length, 1);
        leafTransform.updateMatrix();
        batches[ring.shape].setMatrixAt(nextIndex[ring.shape]++, leafTransform.matrix);
      }
    }
    for (const batch of Object.values(batches)) batch.instanceMatrix.needsUpdate = true;
    group.userData.hobunjiCropRootKey = family;
    group.userData.hobunjiMustardLeafCount = nextIndex.outer + nextIndex.inner; // Stage-specific leaf count for diagnostics.
    return group;
  }

  const BERRY_CROPS = new Set(['redberries', 'blueberries', 'yellowberries', 'whiteberries', 'blackberries']); // Shared family check for real shrub geometry and fruit maturity.
  const FOLIAGE_CROPS = new Set(['needlegrain', 'heftroot', 'blackMustard', 'greenMustard', 'redberries', 'blueberries', 'yellowberries', 'whiteberries', 'blackberries']);

  function _cropFamily(cropKey, data, variety = null) {
    // Restored/older cultivar definitions can exist without baseCrop; their encoded ID still identifies the species.
    return data?.baseCrop || variety?.family || window.CropVarieties?.produceFamily?.(cropKey) || cropKey;
  }

  function _growthBucket(growth) {
    // Rebuild foliage at 4 thresholds to avoid per-frame rebuilds.
    if (growth < 0.15) return 0;
    if (growth < 0.45) return 1;
    if (growth < 0.80) return 2;
    return 3;
  }

  let berryFruitGeometry = null; // One small low-poly sphere shared by every bush's instanced fruit batches.
  const berryFruitMaterials = new Map(); // One native/variant pigment material per exact inherited RGB, shared without cross-tinting.
  function _buildBerryBush(family, growth, col, row, ready, varietyColor) {
    const foliage = window.FoliageGenerator; // Reuses the existing cached eight-shape small-bush generator, never another procedural tree builder.
    const shrub = foliage?.buildShrubMesh?.(col, row);
    if (!shrub) return null;

    const group = new THREE.Group(); // Root is anchored at soil level by the shared farm/NPC crop renderer.
    const nativeScale = Number(shrub.scale?.x); // Keeps the generator's per-tile variation while fitting a cultivated bush to one plot.
    shrub.scale.setScalar((Number.isFinite(nativeScale) && nativeScale > 0 ? nativeScale : 1) * 0.43);
    group.add(shrub); // Retain the generator's woody branches and alpha-tested leaves unchanged.

    const leafMesh = shrub.children?.find(child => child?.userData?.noOutline && child.geometry); // The generator's final alpha-tested canopy mesh supplies actual bounds for fruit attachment.
    const leafGeometry = leafMesh?.geometry; // Shared eight-variant geometry: its bounding box is cached, not recalculated per berry.
    if (leafGeometry && !leafGeometry.boundingBox) leafGeometry.computeBoundingBox?.();
    const bounds = leafGeometry?.boundingBox; // Used for each plant's vertical fruit range, after the shrub's cultivar-scale adjustment.
    const canopyLocalRadius = Number(shrub.userData?.canopyLocal?.radius); // Cached canopy extent is calculated by FoliageGenerator for each bush shape.
    const canopyRadius = Math.max(0.18, Math.min(0.52,
      (Number.isFinite(canopyLocalRadius) && canopyLocalRadius > 0 ? canopyLocalRadius : 1) * shrub.scale.x)); // Cluster centers remain inside the existing leafy canopy.
    const canopyMinY = Math.max(0.08, (Number.isFinite(bounds?.min?.y) ? bounds.min.y : 0.45) * shrub.scale.y);
    const canopyMaxY = Math.max(canopyMinY + 0.16, (Number.isFinite(bounds?.max?.y) ? bounds.max.y : 1.35) * shrub.scale.y);
    group.userData.hobunjiBerryCanopyRadius = canopyRadius; // Mobile inspector and instance-position tests can verify berries are actually attached to leaves.
    group.userData.hobunjiBerryCanopyMinY = canopyMinY;
    group.userData.hobunjiBerryCanopyMaxY = canopyMaxY;

    const stage = _growthBucket(growth); // Early plants are small leafy shrubs; berries develop only on older branches.
    const bunchCount = ready ? 10 : stage >= 3 ? 5 : stage === 2 ? 2 : 0; // Mature/harvestable bushes visibly carry many more berries.
    const fruitColor = varietyColor == null ? CROP_COLORS[family].ripe : varietyColor; // CropVarieties' exact RGB drives both native and crossbred fruit.
    group.userData.hobunjiBerryBush = true; // Mobile scene inspector and regression tests identify the real foliage type.
    group.userData.hobunjiBerryFruitHex = fruitColor; // Reports inherited fruit color without needing WebGL readback.
    group.userData.hobunjiBerryFruitCount = bunchCount * 3; // The batch contains three berries per branch-tip cluster.
    if (!bunchCount) return group;

    if (!berryFruitGeometry) {
      berryFruitGeometry = new THREE.SphereGeometry(0.07, 6, 5); // Rounded fruit with inexpensive geometry and natural lighting.
      berryFruitGeometry.computeBoundingSphere();
      berryFruitGeometry.boundingSphere.center.set(0, 0.4, 0); // Includes all branch-tip instance offsets, not only a lone berry at the origin.
      berryFruitGeometry.boundingSphere.radius = 0.92; // Prevents edge-of-camera fruit from being culled before the actual bush canopy.
    }
    let material = berryFruitMaterials.get(fruitColor);
    if (!material) {
      material = new THREE.MeshLambertMaterial({ color: fruitColor }); // Exact fruit pigment; surrounding foliage stays green.
      berryFruitMaterials.set(fruitColor, material);
    }
    const berries = new THREE.InstancedMesh(berryFruitGeometry, material, bunchCount * 3); // One draw call for every berry on the bush.
    berries.userData.hobunjiBerryFruit = true; // Distinguishes fruit from trunk and transparent leaves in debug/render tests.
    berries.userData.noOutline = true; // Small spheres do not need heavy black shell outlines over their highlights.
    berries.castShadow = false;
    berries.receiveShadow = false;
    berries.frustumCulled = true; // The expanded shared bounds permit ordinary conservative view-frustum culling.

    const random = _mbRng(Math.imul(col + 1, 92837111) ^ Math.imul(row + 1, 689287499) ^ 0xb3771e5); // Stable canopy clusters across saves and growth-stage rebuilds.
    const transform = new THREE.Object3D(); // Reused to assemble each instance matrix without one mesh per fruit.
    let fruitIndex = 0; // Sequential instance index through the current bush's packed berry batch.
    for (let bunch = 0; bunch < bunchCount; bunch++) {
      const azimuth = (bunch + 0.2 + random() * 0.55) * Math.PI * 2 / bunchCount; // Spread fruit around the bush, not in a flat frontal row.
      const radius = canopyRadius * (0.54 + random() * 0.28); // Fruit locations follow this actual bush variant's leaf spread instead of guessed fixed world offsets.
      const centerX = Math.cos(azimuth) * radius;
      const centerZ = Math.sin(azimuth) * radius;
      const centerY = canopyMinY + (canopyMaxY - canopyMinY) * (0.3 + random() * 0.48); // Distribute clusters through the leafy canopy, not above or below it.
      for (let berry = 0; berry < 3; berry++) {
        const offset = berry * Math.PI * 2 / 3 + random() * 0.24;
        const spread = 0.043 + random() * 0.018;
        transform.position.set(centerX + Math.cos(offset) * spread, centerY + (berry - 1) * 0.035,
          centerZ + Math.sin(offset) * spread);
        transform.scale.setScalar(0.72 + random() * 0.37); // Subtle natural fruit-size variance using the same shared sphere.
        transform.updateMatrix();
        berries.setMatrixAt(fruitIndex++, transform.matrix);
      }
    }
    berries.instanceMatrix.needsUpdate = true;
    group.add(berries); // Fruit moves/scales with the bush and cannot detach as a separate billboard.
    return group;
  }

  function _buildFoliageMesh(crop, growth, col, row, ready = false, varietyColor = null) {
    const FG = window.FoliageGenerator;
    if (!FG) return null;
    if (crop === 'needlegrain') {
      const plant = FG.buildNeedlegrainMesh(growth, col, row); // Retains the authored needles and wood as separate meshes.
      const needles = plant?.children?.[plant.children.length - 1]; // The generator appends the grain-bearing needle mesh after the brown bark.
      if (needles?.userData) needles.userData.hobunjiCropTintRegion = 'grain';
      return plant;
    }
    if (crop === 'blackMustard' || crop === 'greenMustard') return _buildMustardMesh(crop, growth, col, row);
    if (BERRY_CROPS.has(crop)) return _buildBerryBush(crop, growth, col, row, ready, varietyColor); // Native and regional crops share actual leafy bush silhouettes.
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

  const cultivarTextureCache = new Map(); // Shares one shade-filled PNG texture per authored crop shape and inherited RGB color.
  const cultivarTextureState = new Map(); // Exposes on-device success/failure without requiring a developer console.
  function _cultivarTexture(path, color) {
    const key = path + ':' + color.toString(16).padStart(6, '0'); // Every cultivar with the same pigment can reuse the same GPU texture.
    const cached = cultivarTextureCache.get(key);
    if (cached) return cached;
    if (!window.SpriteRecolor?.getRecoloredCanvas || !window.HobunjiSpritePngSurface?.makeCanvasTexture) return null;
    cultivarTextureState.set(key, 'loading');
    const pending = window.SpriteRecolor.getRecoloredCanvas(path, color, 'direct').then(canvas => {
      const texture = window.HobunjiSpritePngSurface.makeCanvasTexture(THREE, canvas, 'cultivar-' + key);
      cultivarTextureState.set(key, 'loaded');
      return texture;
    }).catch(error => {
      cultivarTextureState.set(key, 'failed');
      cultivarTextureCache.delete(key); // A temporary asset/CORS error can be retried after the next plant rebuild.
      window.__farmLog?.('[crop-art] foliage recolor failed ' + key + ': ' + String(error?.message || error), 'warn');
      throw error;
    });
    cultivarTextureCache.set(key, pending);
    return pending;
  }

  function _tintVarietyFoliage(group, color, family) {
    if (color == null || !Number.isFinite(Number(color))) return; // Native foliage keeps its authored textures, shaded anatomy and materials.
    const pigment = Number(color) & 0xffffff; // Canonical CropVarieties RGB drives every part that actually bears species color.
    group.traverse(child => {
      if (!child.isMesh || !child.material) return;
      const material = child.material; // Per-plant clone prevents a crossbreed from altering neighboring native crops.
      if (!material.clone || !material.color) return;

      const isMustardLeaf = child.userData?.hobunjiMustardLeaf; // Both outer and inner mushtard leaves use authored transparent PNGs.
      const isHeftrootSprite = child.userData?.hobunjiHeftrootBillboard; // Heftroot keeps its existing three-plant PNG footprint.
      const isNeedlegrain = family === 'needlegrain' && child.userData?.hobunjiCropTintRegion === 'grain';
      if (!isMustardLeaf && !isHeftrootSprite && !isNeedlegrain) return; // Preserve bark, stems and structural meshes unchanged.

      const copy = material.clone(); // No global shared-material tint can leak onto native or unrelated cultivars.
      copy.color.setHex(pigment); // Show the inherited hue immediately, even if an async canvas recolor is still loading.
      child.material = copy;
      if (isNeedlegrain) return; // Its grain is real geometry with a flat native hue, not a tinted image.

      const spritePath = isMustardLeaf ? MUSHTARD_LEAF_ART[child.userData.hobunjiMustardShape]
        : 'assets/objectsprites/heftroot.png'; // Uses the original authored art, not a previously recolored canvas.
      const loaded = _cultivarTexture(spritePath, pigment);
      loaded?.then(texture => {
        if (child.material !== copy) return; // Do not overwrite a plant that has changed identity or been rebuilt.
        copy.map = texture;
        copy.color.setHex(0xffffff); // Shade-filled PNG already carries the exact inherited hue and source highlights.
        copy.needsUpdate = true;
      }).catch(() => {}); // Error is reported once by _cultivarTexture; temporary material multiplier remains visible.
    });
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

        const data   = deps.cropData[tile.crop] || (window.CropVarieties?.ensure?.(tile.crop) && deps.cropData[tile.crop]);
        if (!data) continue;
        const growth = Math.min(tile.cropAge / data.growDays, 1.0);
        const surfY  = deps.tileSurfaceY(tile.type) + tile.water * deps.WATER_UNIT;

        const family = _cropFamily(tile.crop, data); // Saved and imported cultivars inherit the geometry of their true crop family.
        const inheritedColor = data.varietyColor ?? (tile.crop !== family ? window.CropVarieties?.colorOf?.(tile.crop) : null); // Older saves may omit the cached pigment.
        const pigment = inheritedColor != null && Number.isFinite(Number(inheritedColor)) ? (Number(inheritedColor) & 0xffffff) : null; // Exact RGB identity used by every recolor path.
        const wantsFoliage = FOLIAGE_CROPS.has(family); // Selects the existing foliage versus authored PNG-cluster route.
        const previousMesh = cropMeshes[i]; // A tile may have held a different cultivar of the same species since the previous update.
        if (previousMesh && (
          previousMesh.userData?.hobunjiCropId !== tile.crop
          || previousMesh.userData?.hobunjiCropVarietyColor !== pigment
          || (previousMesh.userData?.hobunjiCropRootKey && previousMesh.userData.hobunjiCropRootKey !== family)
          || (wantsFoliage && previousMesh.userData?.hobunjiFoliageMesh !== true)
          || (!wantsFoliage && !previousMesh.isMesh)
        )) {
          deps.scene.remove(previousMesh);
          cropMeshes[i] = null;
          cropGrowthBucket[i] = -1;
        }
        if (wantsFoliage) {
          // ── Procedural foliage mesh ──────────────────────────────
          const bucket = _growthBucket(growth) + (BERRY_CROPS.has(family) && tile.cropReady ? 4 : 0); // Readiness can change fruit density without changing growth stage.
          if (cropMeshes[i] && cropGrowthBucket[i] !== bucket) {
            // Growth crossed a threshold — rebuild.
            deps.scene.remove(cropMeshes[i]);
            cropMeshes[i] = null;
          }
          if (!cropMeshes[i]) {
            const group = _buildFoliageMesh(family, growth, col, row, tile.cropReady, pigment);
            if (group) {
              group.userData.hobunjiCropRootKey = family; // Prevent a tile switched to another crop from reusing the wrong foliage.
              group.userData.hobunjiCropId = tile.crop; // Detects genetic color switches within the same family.
              group.userData.hobunjiCropVarietyColor = pigment; // Tracks exactly which rendered shade-fill matches the current saved genotype.
              group.userData.hobunjiFoliageMesh = true; // Distinguishes foliage from legacy colored cube placeholders on restored fields.
              _tintVarietyFoliage(group, pigment, family); // Recolors authored source pixels instead of multiplying tinted PNGs.
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

          const isRootedBush = BERRY_CROPS.has(family); // Cultivated shrubs should not levitate, spin, or bob when their fruit becomes ready.
          const bobY = tile.cropReady && !isRootedBush ? Math.sin(_now / 500 + col + row) * 0.025 : 0;
          mesh.position.set(col + 0.5, surfY + 0.01 + bobY, row + 0.5);
          if (tile.cropReady && !isRootedBush && family !== 'blackMustard' && family !== 'greenMustard') mesh.rotation.y = _now / 2200 + col; // Rooted leaf rosettes/bushes stay planted.

        } else {
          // ── Temporary cube anchors for garlink/ongyums PNG clusters ──
          const variety = pigment; // Genetic ripe color is used by the existing simple crop-mesh path.
          const colors = variety == null ? (CROP_COLORS[tile.crop] || CROP_COLORS.garlink) : { body: variety, ripe: variety, sprout: 0x6c9751 };
          const size   = CROP_MIN_SCALE + (CROP_MAX_SCALE - CROP_MIN_SCALE) * growth;
          const color  = tile.cropReady ? colors.ripe
                       : growth < 0.15  ? colors.sprout
                       : colors.body;

          if (!cropMeshes[i]) {
            const geo  = new THREE.BoxGeometry(1, 1, 1);
            const mat  = new THREE.MeshLambertMaterial({ color });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.userData.hobunjiCropBaseKey = family; // Authored PNG bridge identifies imported/berry cultivars without guessing color.
            mesh.userData.hobunjiCropRootKey = family; // Soil anchoring applies to imported crops just as it does to native ones.
            mesh.userData.hobunjiCropId = tile.crop; // Replanting a different genotype triggers a fresh visual.
            mesh.userData.hobunjiCropVarietyColor = pigment; // Exact inherited RGB used by the shade-fill sprite bridge.
            mesh.castShadow = true;
            deps.scene.add(mesh);
            mesh.layers.enable(1);
            cropMeshes[i] = mesh;
            window.HobunjiCropSpriteArt?.registerPlaceholder?.(mesh); // Deferred until the frame hook, after growth/position are set below.
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

  // Flat floor slabs (makeFloorGeo: a 1x1 box whose top only jitters by
  // +-1.5cm) sit at ground level, so their shadow can only ever fall below the
  // ground surface — nothing lit lives there. They were still ~half of the
  // farm's shadow-map draw calls (one per tile, every frame). receiveShadow
  // stays on: HeldObjectRenderOrder's terrain classification keys off it.
  function setFlatSlabShadowFlags(mesh) {
    mesh.castShadow = false;
    mesh.receiveShadow = true;
  }

  // Update a single tile mesh (called after shovel actions)
  // Every object a farm tile builds is tagged so other systems can tell farm
  // ground from town/wilderness ground: TerrainJigsawUV shares one material
  // clone per source material for these tiles (instead of one per tile), which
  // in turn lets js/farm-tile-render-batches.js merge them.
  function _addFarmTileObject(object) {
    object.userData.hobunjiFarmTile = true;
    deps.scene.add(object);
  }

  function _buildOneTileMesh(col, row) {
    const TileType = deps.TileType;
    const i    = row * deps.COLS + col;
    const grid = deps.getGrid();
    const tile = grid[row][col];
    const mat  = deps.resolveTileMat('farm', tile.type);

    if (tile.type === TileType.ROCK) {
      // Floor slab — grass so it blends with surrounding tiles
      const floorMesh = new THREE.Mesh(window.TerrainGeometry.makeFloorGeo(col, row), deps.resolveTileMat('farm', TileType.GRASS));
      setFlatSlabShadowFlags(floorMesh);
      floorMesh.position.set(col + 0.5, deps.NORMAL_TOP - deps.SLAB_H / 2, row + 0.5);
      _addFarmTileObject(floorMesh);
      tileMeshes[i] = floorMesh;
      deps.markTerrainEdgeId(floorMesh, TileType.GRASS);
      // Plateau mound: stone for elevated/cliff cells, grass for ground-level base
      const { stoneGeo, grassGeo } = window.TerrainGeometry.buildRockTileGeo(col, row);
      let moundRoot = null;
      if (stoneGeo) {
        const m = new THREE.Mesh(stoneGeo, deps.resolveTileMat('farm', TileType.ROCK));
        m.userData.farmLooseRockMound = true; // The final farm-rock naturalization pass uses this to map the real finished stone material exactly once.
        if (!window.FacetedNaturalSurfaceShellReduction?.installed) window.OreRockTextures?.fitRockMesh?.(m, `farm:${col},${row}`); // Standalone editor fallback when the gameplay post-build styling module is absent.
        m.castShadow = m.receiveShadow = true;
        m.position.set(col + 0.5, deps.NORMAL_TOP, row + 0.5);
        _addFarmTileObject(m);
        deps.markTerrainEdgeId(m, TileType.ROCK);
        moundRoot = m;
      }
      if (grassGeo) {
        const m = new THREE.Mesh(grassGeo, deps.resolveTileMat('farm', TileType.GRASS));
        m.castShadow = m.receiveShadow = true;
        m.position.set(col + 0.5, deps.NORMAL_TOP, row + 0.5);
        _addFarmTileObject(m);
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
      setFlatSlabShadowFlags(floorMesh);
      floorMesh.position.set(col + 0.5, deps.tileYCenter(TileType.GRASS), row + 0.5);
      _addFarmTileObject(floorMesh);
      tileMeshes[i] = floorMesh;
      deps.markTerrainEdgeId(floorMesh, TileType.GRASS);

      const vegGroup = window.FoliageGenerator.buildShrubMesh(col, row);
      vegGroup._windPhase = (col * 1.7 + row * 2.3) % (Math.PI * 2);
      vegGroup._windAmp   = 0.06;
      // buildShrubMesh now returns TREE_PRESETS.bush, so its native scale
      // is already the regular wilderness-bush size. Do not apply the old
      // generic shrub x2 farm boost here.
      vegGroup.position.set(col + 0.5, deps.tileSurfaceY(tile.type), row + 0.5);
      _addFarmTileObject(vegGroup);
      setVegFoliageMesh(i, vegGroup);
      deps.markOutline(vegGroup);
      return;
    }

    if (tile.type === TileType.WEEDS) {
      // Grass floor slab underneath
      const floorMesh = new THREE.Mesh(window.TerrainGeometry.makeFloorGeo(col, row), deps.vegFloorMat);
      setFlatSlabShadowFlags(floorMesh);
      floorMesh.position.set(col + 0.5, deps.tileYCenter(TileType.GRASS), row + 0.5);
      _addFarmTileObject(floorMesh);
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
            wm.scale.set(0.75, 0.75, 0.75); // Weed-only width/height reduction; keeps placement and density unchanged.
            vegGroup.add(wm);
          }
        }
        vegGroup._windPhase = (col * 1.7 + row * 2.3) % (Math.PI * 2);
        vegGroup._windAmp   = 0.10;
        _addFarmTileObject(vegGroup);
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
        _addFarmTileObject(m);
        m.layers.enable(1);  // material transition outline
        deps.markTerrainEdgeId(m, TileType.TRENCH);
        primary = m;
      }
      if (grassGeo) {
        const m = new THREE.Mesh(grassGeo, deps.resolveTileMat('farm', TileType.GRASS));
        m.castShadow = m.receiveShadow = true;
        m.position.set(col + 0.5, deps.NORMAL_TOP, row + 0.5);
        m._windAmp = 0;
        _addFarmTileObject(m);
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
        _addFarmTileObject(m);
        primary = m;
      }
      if (grassGeo) {
        const m = new THREE.Mesh(grassGeo, deps.resolveTileMat('farm', TileType.GRASS));
        m.castShadow = m.receiveShadow = true;
        m.position.set(col + 0.5, deps.NORMAL_TOP, row + 0.5);
        _addFarmTileObject(m);
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
    if (tile.type === TileType.ROCK || tile.type === TileType.SHRUB || tile.type === TileType.WEEDS) mesh.castShadow = mesh.receiveShadow = true;
    else setFlatSlabShadowFlags(mesh);
    mesh.position.set(col + 0.5, deps.tileYCenter(tile.type), row + 0.5);
    _addFarmTileObject(mesh);
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

  // A crop's plant mesh with no farm-grid tile behind it (NPC-tended plots on town/zone maps, js/npc-farm-plots.js).
  // Returns { mesh, lift } — place at (col + 0.5, surfaceY + lift, row + 0.5); null if the crop has no visual.
  function buildStandaloneCropMesh(crop, growth, ready, col, row) {
    const g = Math.max(0, Math.min(1, growth));
    const size = CROP_MIN_SCALE + (CROP_MAX_SCALE - CROP_MIN_SCALE) * g;
    const variety = window.CropVarieties?.ensure?.(crop); // Saved NPC crops use the same genotype/color as the farm.
    const family = _cropFamily(crop, null, variety); // NPC plots must also preserve native leaf art for imported mushtard keys.
    if (FOLIAGE_CROPS.has(family)) {
      const group = _buildFoliageMesh(family, g, col, row, ready, variety?.color ?? null);
      if (!group) return null;
      group.userData.hobunjiCropRootKey = family; // Identifies the actual crop family in town and wilderness farm plots.
      group.userData.hobunjiFoliageMesh = true; // Keeps the same foliage identity contract as player farm crops.
      group.userData.hobunjiCropId = crop; // NPC plots use the same per-genotype visual identity.
      group.userData.hobunjiCropVarietyColor = variety?.color ?? null; // NPC crops and player fields share the inherited color.
      _tintVarietyFoliage(group, variety?.color, family);
      group.scale.setScalar(size);
      return { mesh: group, lift: 0.01 };
    }
    const pigment = variety?.color; // Reuse the resolved genotype; redeclaring "variety" here broke the whole renderer.
    const colors = pigment == null ? (CROP_COLORS[crop] || CROP_COLORS.garlink) : { body: pigment, ripe: pigment, sprout: 0x6c9751 };
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: ready ? colors.ripe : g < 0.15 ? colors.sprout : colors.body }));
    mesh.userData.hobunjiCropId = crop; // NPC planted berry/vegetable variants are independently identifiable in the sprite bridge.
    mesh.userData.hobunjiCropBaseKey = family; // Saved NPC plots use the same authored crop-art bridge.
    mesh.userData.hobunjiCropRootKey = family;
    mesh.userData.hobunjiCropVarietyColor = pigment ?? null;
    mesh.scale.setScalar(size);
    window.HobunjiCropSpriteArt?.registerPlaceholder?.(mesh); // Also covers standalone callers outside NPC plot drawing.
    return { mesh, lift: size / 2 + 0.02 };
  }

  window.VegetationCropRendering = {
    registersCropSpritePlaceholders: true, // Lets the crop-art bridge stop periodic full-scene scans when both producers are updated.
    buildStandaloneCropMesh,
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
    getBerryBushDebug: () => ({ families: [...BERRY_CROPS], sharedFruitMaterials: berryFruitMaterials.size, maxBerriesPerBush: 30, shapeSource: 'FoliageGenerator.buildShrubMesh' }), // Mobile-friendly bush geometry and batch diagnostics.
    getMustardDebug: () => ({ texture: MUSHTARD_LEAF_ART.outer, textures: { ...MUSHTARD_LEAF_ART }, textureStates: Object.fromEntries([...mushtardTextures].map(([shape, record]) => [shape, record.state])), cultivarTextureStates: Object.fromEntries(cultivarTextureState), nativeMaterialCount: mushtardMaterials.size, matureLeaves: 15, maxDrawCallsPerPlant: 2 }), // Lightweight mushtard PNG and card diagnostics for mobile.
    getGrassBillboardMat: () => grassBillboardMat,
    setGrassDistanceLod,
    getGrassDistanceLod,
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
    rebuildFarmBillboards: _rebuildFarmBillboards,
  };
})();