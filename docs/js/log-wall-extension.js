// Log-cabin wall extension for WallBuilder.
//
// A log-wall recipe intentionally remains a normal version:1 `wall` recipe.
// The extra `meta.logWall` payload controls only where its reusable log mesh
// comes from and how the per-panel course dimensions are derived. This keeps
// WallBuilder's existing panel projection, gable clipping, opening carving,
// transforms, and InstancedMesh batching as the single placement authority.
(function (root, factory) {
  'use strict';
  const api = factory(); // Shared browser/CommonJS API used by runtime and regression tests.
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) {
    root.LogWallExtension = api;
    api.install(root);
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null), function () {
  'use strict';

  const VERSION = 1; // Serialized log-wall metadata version consumed by live and baked paths.
  const INSTALL_FLAG = '__hobunjiLogWallExtensionInstalled'; // Prototype flag preventing duplicate WallBuilder wrapping.
  const DEFAULTS = Object.freeze({ // Default foliage-style log recipe values used by the authoring tool and runtime normalization.
    version: VERSION,
    sourceMode: 'generated',
    generator: 'foliage-log-spine-v1',
    seed: 'cabin-log-1',
    glbName: 'CabinLog.glb',
    logDiameter: 0.34,
    trunkTaper: 0.99,
    trunkWonk: 0.18,
    trunkWonkScale: 1.35,
    trunkTwist: 0.08,
    trunkNoise: 0.35,
    trunkNoiseScale: 2.2,
    trunkNoiseOctaves: 3,
    radialSegments: 8,
    ringSegments: 12,
    barkColor: '#6e5e30', // Approved dark-olive hue (#372f18) at twice the value: the darker swatch is flattened into a near-black slab by the painterly shadow crush and oil binning.
    overhang: 0.12,
    courseGap: -0.03,
    rowRollDeg: 1.5,
    rowDepthJitter: 0.012,
  });

  function finite(value, fallback) {
    const number = Number(value); // Normalized finite numeric value used throughout recipe/geometry generation.
    return Number.isFinite(number) ? number : fallback;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function normalizeHex(value, fallback) {
    const text = String(value || '').trim(); // Normalized CSS hex color serialized in recipes and used for generated bark material.
    return /^#[0-9a-f]{6}$/i.test(text) ? text.toLowerCase() : fallback;
  }

  function normalizeLogMeta(raw) {
    raw = raw || {};
    const sourceMode = String(raw.sourceMode || DEFAULTS.sourceMode).toLowerCase() === 'glb' ? 'glb' : 'generated'; // Selects live procedural or pre-baked prototype source.
    return {
      version: VERSION,
      sourceMode,
      generator: String(raw.generator || DEFAULTS.generator),
      seed: String(raw.seed ?? DEFAULTS.seed),
      glbName: String(raw.glbName || raw.glb || DEFAULTS.glbName),
      logDiameter: Math.max(0.02, finite(raw.logDiameter ?? raw.width, DEFAULTS.logDiameter)),
      trunkTaper: clamp(finite(raw.trunkTaper, DEFAULTS.trunkTaper), 0.5, 1.2),
      trunkWonk: clamp(finite(raw.trunkWonk ?? raw.wonkiness, DEFAULTS.trunkWonk), 0, 3),
      trunkWonkScale: Math.max(0.01, finite(raw.trunkWonkScale ?? raw.wonkScale, DEFAULTS.trunkWonkScale)),
      trunkTwist: finite(raw.trunkTwist, DEFAULTS.trunkTwist),
      trunkNoise: clamp(finite(raw.trunkNoise ?? raw.surfaceNoise, DEFAULTS.trunkNoise), 0, 3),
      trunkNoiseScale: Math.max(0.01, finite(raw.trunkNoiseScale ?? raw.surfaceNoiseScale, DEFAULTS.trunkNoiseScale)),
      trunkNoiseOctaves: Math.max(1, Math.min(6, Math.round(finite(raw.trunkNoiseOctaves, DEFAULTS.trunkNoiseOctaves)))),
      radialSegments: Math.max(5, Math.min(32, Math.round(finite(raw.radialSegments, DEFAULTS.radialSegments)))),
      ringSegments: Math.max(4, Math.min(64, Math.round(finite(raw.ringSegments, DEFAULTS.ringSegments)))),
      barkColor: normalizeHex(raw.barkColor || raw.woodColorHex, DEFAULTS.barkColor),
      overhang: Math.max(0, finite(raw.overhang, DEFAULTS.overhang)),
      courseGap: finite(raw.courseGap, DEFAULTS.courseGap),
      rowRollDeg: Math.max(0, finite(raw.rowRollDeg, DEFAULTS.rowRollDeg)),
      rowDepthJitter: Math.max(0, finite(raw.rowDepthJitter, DEFAULTS.rowDepthJitter)),
    };
  }

  function hashStringToUint32(value) {
    let hash = 2166136261 >>> 0; // FNV-1a hash state used to turn authored string seeds into deterministic noise seeds.
    const text = String(value ?? ''); // Stable seed text shared by generated and exported prototypes.
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash >>> 0;
  }

  function hashLattice(index, seed) {
    let value = (seed ^ Math.imul(index | 0, 0x9e3779b1)) >>> 0; // Integer lattice hash for one-dimensional foliage-style value noise.
    value = Math.imul(value ^ (value >>> 16), 0x85ebca6b) >>> 0;
    value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35) >>> 0;
    return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
  }

  function smoothstep(value) {
    return value * value * (3 - 2 * value);
  }

  function valueNoise1D(value, seed) {
    const lo = Math.floor(value); // Lower lattice point used by deterministic centerline/surface noise.
    const mix = smoothstep(value - lo); // Cubic blend keeping adjacent noise samples smooth instead of kinked.
    return hashLattice(lo, seed) * (1 - mix) + hashLattice(lo + 1, seed) * mix;
  }

  function fbm1D(value, seed, octaves) {
    let amplitude = 0.5; // Current octave amplitude used by the compact foliage-style fBm.
    let frequency = 1; // Current octave frequency used by the compact foliage-style fBm.
    let sum = 0; // Accumulated weighted noise value returned to centerline/radius generation.
    let norm = 0; // Accumulated amplitude used to normalize fBm back to 0..1.
    for (let octave = 0; octave < octaves; octave++) {
      sum += valueNoise1D(value * frequency, (seed + octave * 1013) >>> 0) * amplitude;
      norm += amplitude;
      amplitude *= 0.55;
      frequency *= 2.1;
    }
    return sum / Math.max(1e-6, norm);
  }

  function signature(raw) {
    const meta = normalizeLogMeta(raw); // Canonical log settings whose hash proves generated/baked source compatibility.
    const stable = [
      meta.generator, meta.seed, meta.logDiameter, meta.trunkTaper,
      meta.trunkWonk, meta.trunkWonkScale, meta.trunkTwist,
      meta.trunkNoise, meta.trunkNoiseScale, meta.trunkNoiseOctaves,
      meta.radialSegments, meta.ringSegments, meta.barkColor,
    ].join('|'); // Stable geometry-only signature input; wall placement settings intentionally excluded.
    return hashStringToUint32(stable).toString(16).padStart(8, '0');
  }

  function buildFrames(THREE, points) {
    const tangents = []; // Per-ring tangent vectors used to orient each circular cross-section along the wonky spine.
    for (let i = 0; i < points.length; i++) {
      const previous = points[Math.max(0, i - 1)]; // Neighbor behind this ring used for finite-difference tangent calculation.
      const next = points[Math.min(points.length - 1, i + 1)]; // Neighbor ahead of this ring used for finite-difference tangent calculation.
      const tangent = next.clone().sub(previous); // Finite-difference tangent kept deterministic for exported/live parity.
      tangents.push(tangent.lengthSq() > 1e-12 ? tangent.normalize() : new THREE.Vector3(1, 0, 0));
    }
    const normals = []; // Parallel-transported ring normals preventing arbitrary tube twists between rings.
    const binormals = []; // Parallel-transported ring binormals completing each tube cross-section basis.
    const axis = new THREE.Vector3(); // Scratch rotation axis reused while transporting frames down the spine.
    const firstTangent = tangents[0].clone(); // First tangent used to seed a stable initial frame.
    let firstNormal = new THREE.Vector3(0, 1, 0); // Preferred vertical starting normal so horizontal cabin logs orient predictably.
    if (Math.abs(firstNormal.dot(firstTangent)) > 0.98) firstNormal.set(0, 0, 1);
    firstNormal.addScaledVector(firstTangent, -firstNormal.dot(firstTangent)).normalize();
    normals.push(firstNormal);
    binormals.push(new THREE.Vector3().crossVectors(firstTangent, firstNormal).normalize());
    for (let i = 1; i < tangents.length; i++) {
      axis.crossVectors(tangents[i - 1], tangents[i]);
      const normal = normals[i - 1].clone(); // Transported normal for the current ring.
      if (axis.lengthSq() > 1e-12) {
        const angle = Math.acos(clamp(tangents[i - 1].dot(tangents[i]), -1, 1)); // Smallest turn angle between adjacent spine segments.
        normal.applyAxisAngle(axis.clone().normalize(), angle).normalize();
      }
      normals.push(normal);
      binormals.push(new THREE.Vector3().crossVectors(tangents[i], normal).normalize());
    }
    return { tangents, normals, binormals };
  }

  function createLogGeometry(THREE, raw) {
    if (!THREE) throw new Error('LogWallExtension.createLogGeometry requires THREE.');
    const meta = normalizeLogMeta(raw); // Canonical foliage-style parameters used to generate this reusable log prototype.
    const foliage = (typeof window !== 'undefined' ? window.FoliageGenerator : globalThis?.FoliageGenerator); // Real foliage generator preferred whenever the runtime/tool has published it.
    if (typeof foliage?.buildLogMesh === 'function') {
      const mesh = foliage.buildLogMesh({ // One-unit compatibility prototype delegates its actual shape to buildWonkyChain rather than the old wall-only duplicate.
        length: 1, logDiameter: 1, seed: meta.seed, trunkTaper: meta.trunkTaper, trunkWonk: meta.trunkWonk,
        trunkWonkScale: meta.trunkWonkScale, trunkTwist: meta.trunkTwist, trunkNoise: meta.trunkNoise,
        trunkNoiseScale: meta.trunkNoiseScale, trunkNoiseOctaves: meta.trunkNoiseOctaves, radialSegments: meta.radialSegments,
        ringSegments: meta.ringSegments, barkColor: meta.barkColor, useWoodAtlas: false,
      });
      if (mesh?.geometry) {
        const geometry = mesh.geometry; // Generated foliage geometry handed to the existing WallBuilder prototype/material pipeline.
        mesh.material?.dispose?.();
        geometry.userData = { ...(geometry.userData || {}), logWallFoliageAuthority: true };
        return geometry;
      }
    }
    const seed = hashStringToUint32(meta.seed); // Compatibility fallback used only by isolated tools that have not loaded FoliageGenerator.
    const points = []; // Wonky log centerline points sampled along a canonical one-unit X span.
    for (let ring = 0; ring < meta.ringSegments; ring++) {
      const t = meta.ringSegments <= 1 ? 0 : ring / (meta.ringSegments - 1); // Normalized position along the log.
      const envelope = Math.sin(Math.PI * t); // Keeps both log ends centered while allowing the middle to wander naturally.
      const wonkY = (fbm1D(t * meta.trunkWonkScale + 11.1, seed ^ 0x12345, 4) - 0.5) * 2;
      const wonkZ = (fbm1D(t * meta.trunkWonkScale + 27.7, seed ^ 0x23456, 4) - 0.5) * 2;
      const amplitude = meta.trunkWonk * 0.18 * envelope; // Foliage-generator-like centerline displacement relative to canonical log length.
      points.push(new THREE.Vector3(t - 0.5, wonkY * amplitude, wonkZ * amplitude));
    }
    const frames = buildFrames(THREE, points); // Stable parallel-transport frames used for every tube vertex.
    const positions = []; // Interleaved XYZ vertex positions for tube sides and duplicated flat end caps.
    const uvs = []; // Cylindrical side/cap UVs preserved identically through GLB export/import.
    const indices = []; // Triangle index list for tube sides plus closed end caps.

    for (let ring = 0; ring < meta.ringSegments; ring++) {
      const t = meta.ringSegments <= 1 ? 0 : ring / (meta.ringSegments - 1); // Normalized ring distance used by taper/twist/noise.
      const taperRadius = 0.5 * Math.pow(meta.trunkTaper, t * Math.max(1, meta.ringSegments - 1)); // Canonical radius before WallBuilder scales to authored diameter.
      const twist = meta.trunkTwist * t * Math.PI * 2; // Authored foliage-style axial twist applied progressively down the log.
      const tangent = frames.tangents[ring]; // Local spine tangent used as the twist axis.
      const normal = frames.normals[ring].clone().applyAxisAngle(tangent, twist); // Twisted tube normal for this ring.
      const binormal = frames.binormals[ring].clone().applyAxisAngle(tangent, twist); // Twisted tube binormal for this ring.
      for (let side = 0; side < meta.radialSegments; side++) {
        const around = side / meta.radialSegments; // Normalized angle around the log circumference.
        const angle = around * Math.PI * 2;
        const radialNoise = (fbm1D(t * meta.trunkNoiseScale + around * 3.7 + 53.9, seed ^ 0x91e10da5, meta.trunkNoiseOctaves) - 0.5) * 2;
        const radius = Math.max(0.02, taperRadius * (1 + meta.trunkNoise * 0.16 * radialNoise)); // Rough bark silhouette without changing deterministic outer scaling.
        const radial = normal.clone().multiplyScalar(Math.cos(angle) * radius).addScaledVector(binormal, Math.sin(angle) * radius); // Cross-section offset from centerline.
        const point = points[ring].clone().add(radial); // Final side vertex position.
        positions.push(point.x, point.y, point.z);
        uvs.push(t, around);
      }
    }
    for (let ring = 0; ring < meta.ringSegments - 1; ring++) {
      const first = ring * meta.radialSegments; // First vertex index of the current side ring.
      const next = (ring + 1) * meta.radialSegments; // First vertex index of the following side ring.
      for (let side = 0; side < meta.radialSegments; side++) {
        const a = first + side; // Current ring/current side vertex.
        const b = first + (side + 1) % meta.radialSegments; // Current ring/next side vertex.
        const c = next + side; // Next ring/current side vertex.
        const d = next + (side + 1) % meta.radialSegments; // Next ring/next side vertex.
        indices.push(a, b, c, c, b, d);
      }
    }

    for (const end of [0, meta.ringSegments - 1]) {
      const point = points[end]; // Centerline endpoint used as the flat cap center.
      const capStart = positions.length / 3; // First duplicated perimeter vertex for this cap.
      const sideStart = end * meta.radialSegments; // Matching side-ring vertex span whose positions are duplicated for hard cap normals.
      for (let side = 0; side < meta.radialSegments; side++) {
        const source = (sideStart + side) * 3; // Position-array offset of the matching side vertex.
        positions.push(positions[source], positions[source + 1], positions[source + 2]);
        const angle = side / meta.radialSegments * Math.PI * 2; // Cap UV angle around its disk.
        uvs.push(0.5 + Math.cos(angle) * 0.5, 0.5 + Math.sin(angle) * 0.5);
      }
      const center = positions.length / 3; // Center vertex index for this flat cap fan.
      positions.push(point.x, point.y, point.z);
      uvs.push(0.5, 0.5);
      for (let side = 0; side < meta.radialSegments; side++) {
        const current = capStart + side; // Current duplicated cap perimeter vertex.
        const next = capStart + (side + 1) % meta.radialSegments; // Next duplicated cap perimeter vertex.
        if (end === 0) indices.push(center, next, current);
        else indices.push(center, current, next);
      }
    }

    const geometry = new THREE.BufferGeometry(); // Final reusable prototype geometry registered in WallBuilder or exported as GLB.
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.userData = { ...(geometry.userData || {}), logWallSignature: signature(meta), logWallGenerator: meta.generator };
    return geometry;
  }

  function createLogPrototype(THREE, raw) {
    if (!THREE) throw new Error('LogWallExtension.createLogPrototype requires THREE.');
    const meta = normalizeLogMeta(raw); // Canonical metadata attached to the generated mesh and exported GLB extras.
    const geometry = createLogGeometry(THREE, meta); // Deterministic foliage-style log geometry reused by every course.
    const color = Number.parseInt(meta.barkColor.slice(1), 16); // Numeric Three.js bark color matching the authored hex value.
    const material = new THREE.MeshLambertMaterial({ color: Number.isFinite(color) ? color : 0x6e5e30 }); // Lightweight bark material analogous to procedural foliage wood.
    const mesh = new THREE.Mesh(geometry, material); // Reusable generated log prototype registered as a WallBuilder model.
    mesh.name = 'GeneratedCabinLog';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = {
      ...(mesh.userData || {}),
      logWallPrototype: true,
      logWallSignature: signature(meta),
      logWall: { ...meta },
    };
    return mesh;
  }

  function makeRecipe(panelWidth, panelHeight, raw) {
    const meta = normalizeLogMeta(raw); // Canonical metadata embedded in both generated-live and baked-GLB recipe exports.
    const width = Math.max(0.01, finite(panelWidth, 4)); // Authoring/reference panel width; runtime recalculates the span per actual panel.
    const height = Math.max(0.01, finite(panelHeight, 2.5)); // Authoring/reference panel height shown in standalone previews.
    const roll = meta.rowRollDeg; // Symmetric per-course roll range applied by WallBuilder's existing seeded random transform path.
    const depth = meta.rowDepthJitter; // Symmetric per-course depth variation applied by WallBuilder without regenerating geometry.
    return {
      version: 1,
      seed: `${meta.seed}:wall`,
      glbName: meta.glbName,
      meta: {
        name: 'Log Cabin Wall',
        instanceName: `Log Cabin Wall · ${meta.sourceMode === 'glb' ? 'Baked GLB' : 'Generated Live'}`,
        glb: meta.glbName,
        logWall: { ...meta, signature: signature(meta) },
        foliageGenerator: {
          assetType: 'Log', seed: meta.seed,
          trunkLength: width + meta.overhang * 2,
          trunkRadius: meta.logDiameter * 0.5,
          trunkTaper: meta.trunkTaper,
          trunkWonk: meta.trunkWonk,
          trunkWonkScale: meta.trunkWonkScale,
          trunkTwist: meta.trunkTwist,
          trunkNoise: meta.trunkNoise,
          trunkNoiseScale: meta.trunkNoiseScale,
          trunkNoiseOctaves: meta.trunkNoiseOctaves,
          radialSegments: meta.radialSegments,
          ringSegments: meta.ringSegments,
          rootsEnabled: false,
          knotEnabled: false,
          leavesEnabled: false,
        },
      },
      density: { value01: 0.5, overlapFrac: 0 },
      preTransform: { translate: [0, 0, 0], rotateDegXYZ: [0, 0, 0], scale: [1, 1, 1] },
      settings: {
        kind: 'wall',
        length: width,
        height,
        unitSize: { x: width + meta.overhang * 2, y: meta.logDiameter, z: meta.logDiameter },
        gapBase: { x: 0, y: meta.courseGap, z: 0 },
        stagger: { enabled: false, amountInUnits: 0 },
        microJitter: { x: 0, y: 0, z: depth },
        random: {
          rotationDeg: { x: { min: -roll, max: roll }, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          translate: { x: 0, y: 0, z: 0 },
        },
      },
    };
  }

  function computePerUnitScale(THREE, mesh) {
    const box = new THREE.Box3().setFromObject(mesh); // Generated prototype bounds normalized exactly like WallBuilder's imported-GLB path.
    const size = new THREE.Vector3(); // Scratch size vector used to derive world units per source-mesh unit.
    box.getSize(size);
    return new THREE.Vector3(
      size.x > 1e-6 ? 1 / size.x : 1,
      size.y > 1e-6 ? 1 / size.y : 1,
      size.z > 1e-6 ? 1 / size.z : 1,
    );
  }

  function generatedLibraryName(meta) {
    const safe = String(meta.glbName || DEFAULTS.glbName).replace(/[^a-z0-9_.-]+/gi, '_'); // Human-readable exported GLB name retained inside generated runtime cache keys.
    return `__generated_logwall_${signature(meta)}_${safe}`;
  }

  function ensureGeneratedModel(builder, THREE, raw) {
    const meta = normalizeLogMeta(raw); // Canonical source settings used for cache lookup and generated geometry.
    const name = generatedLibraryName(meta); // Private WallBuilder model key preventing collisions with a separately loaded baked GLB of the same export name.
    if (builder.glbLibrary.has(name)) return name;
    const mesh = createLogPrototype(THREE, meta); // One generated prototype shared by every course/instance of this exact log signature.
    builder.glbLibrary.set(name, {
      mesh,
      perUnitScale: computePerUnitScale(THREE, mesh),
      sourceName: `generated foliage log ${signature(meta)}`,
      logWallSignature: signature(meta),
      generatedLogWall: true,
    });
    return name;
  }

  function recipeLogMeta(recipe) {
    const raw = recipe?.meta?.logWall; // Serialized extension payload distinguishing ordinary wall recipes from log-cabin recipes.
    return raw && finite(raw.version, VERSION) === VERSION ? normalizeLogMeta(raw) : null;
  }

  function fitLogRecipeToPanel(recipe, panel, meta, sourceName) {
    const copy = JSON.parse(JSON.stringify(recipe)); // Ephemeral per-panel recipe preventing one shared recipe from assuming every wall has the authoring preview width.
    copy.glbName = sourceName;
    copy.meta = { ...(copy.meta || {}), glb: sourceName };
    copy.settings = { ...(copy.settings || {}), kind: 'wall' };
    copy.settings.unitSize = {
      x: Math.max(0.01, finite(panel?.width, copy.settings?.length || 1) + meta.overhang * 2),
      y: meta.logDiameter,
      z: meta.logDiameter,
    };
    copy.settings.gapBase = { x: 0, y: meta.courseGap, z: 0 };
    copy.settings.stagger = { enabled: false, amountInUnits: 0 };
    copy.settings.microJitter = { x: 0, y: 0, z: meta.rowDepthJitter };
    copy.settings.random = {
      rotationDeg: { x: { min: -meta.rowRollDeg, max: meta.rowRollDeg }, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      translate: { x: 0, y: 0, z: 0 },
    };
    return copy;
  }

  function moveChildren(from, to) {
    if (!from || !to) return;
    while (from.children && from.children.length) to.add(from.children[0]);
  }

  function install(target) {
    const THREE = target?.THREE; // Runtime Three.js namespace required only when WallBuilder is actually present.
    const WallBuilder = target?.WallBuilder; // Existing wall authority whose prototype is extended in place.
    if (!THREE || !WallBuilder?.prototype || WallBuilder.prototype[INSTALL_FLAG]) return false;
    const prototype = WallBuilder.prototype; // Shared prototype patched once so already-created and future builders gain log-wall support.
    const originalBuild = prototype.build; // Existing WallBuilder build path retained as the only panel/opening/instancing implementation.
    const originalAddRecipe = prototype.addRecipe; // Existing recipe validation/registration path retained before optional baked-GLB preloading.
    if (typeof originalBuild !== 'function' || typeof originalAddRecipe !== 'function') return false;

    prototype.prepareLogWallRecipe = function (idOrRecipe) {
      const recipe = typeof idOrRecipe === 'string' ? this.recipeLibrary.get(idOrRecipe) : idOrRecipe; // Recipe selected for optional baked asset preparation.
      const meta = recipeLogMeta(recipe); // Log metadata deciding whether preparation means generation or GLB fetch.
      if (!meta) return Promise.resolve(null);
      if (meta.sourceMode === 'generated') return Promise.resolve(ensureGeneratedModel(this, THREE, meta));
      if (this.glbLibrary.has(meta.glbName)) return Promise.resolve(meta.glbName);
      this._logWallLoadPromises = this._logWallLoadPromises || new Map(); // Per-builder baked GLB load cache avoiding duplicate network requests across rebuilds.
      if (this._logWallLoadPromises.has(meta.glbName)) return this._logWallLoadPromises.get(meta.glbName);
      const promise = this.loadGlbFromUrl(this.glbBasePath + meta.glbName, meta.glbName)
        .finally(() => this._logWallLoadPromises.delete(meta.glbName));
      this._logWallLoadPromises.set(meta.glbName, promise);
      return promise;
    };

    prototype.addRecipe = function (id, recipeData) {
      const result = originalAddRecipe.call(this, id, recipeData); // Standard version/kind validation remains authoritative for serialized recipes.
      const meta = recipeLogMeta(recipeData); // Optional log metadata used to eagerly prepare generated/baked source assets.
      if (meta) {
        this.prepareLogWallRecipe(recipeData).catch((error) => {
          console.warn(`[LogWallExtension] Could not prepare ${meta.glbName}:`, error);
        });
      }
      return result;
    };

    prototype.build = function (panels, opts) {
      const inputPanels = Array.isArray(panels) ? panels : []; // Wall panel list split into ordinary and log-cabin subsets without mutating caller data.
      const options = opts || {}; // Existing WallBuilder options preserved for ordinary walls and non-size log transforms.
      const defaultId = options.defaultRecipeId || this.defaultRecipeId; // Same default recipe resolution rule used by WallBuilder itself.
      const ordinary = []; // Non-log panels delegated to one normal WallBuilder batch.
      const logPanels = []; // Log-cabin panels built one at a time so each course spans that panel's exact width.
      for (const panel of inputPanels) {
        const recipe = this.recipeLibrary.get(panel?.wallRecipeId || defaultId); // Resolved recipe used to identify extension-authored log walls.
        const meta = recipeLogMeta(recipe); // Normalized log metadata or null for every pre-existing recipe.
        if (recipe && meta) logPanels.push({ panel, recipe, meta });
        else ordinary.push(panel);
      }
      if (!logPanels.length) return originalBuild.call(this, inputPanels, options);

      const group = new THREE.Group(); // Combined result matching WallBuilder's normal group contract for mixed ordinary/log panels.
      group.name = 'WallBuilder_Instances';
      const stats = { logPanels: logPanels.length, generatedPanels: 0, bakedPanels: 0, missingBakedGlbs: [] }; // In-scene diagnostics available without devtools.
      if (ordinary.length) moveChildren(originalBuild.call(this, ordinary, options), group);

      let serial = 0; // Unique ephemeral recipe suffix preventing collisions while the same builder processes multiple log panels.
      for (const entry of logPanels) {
        const { panel, recipe, meta } = entry;
        let sourceName = meta.glbName; // Model key consumed by the unchanged original WallBuilder build.
        if (meta.sourceMode === 'generated') {
          sourceName = ensureGeneratedModel(this, THREE, meta);
          stats.generatedPanels++;
        } else {
          stats.bakedPanels++;
          if (!this.glbLibrary.has(sourceName)) stats.missingBakedGlbs.push(sourceName);
        }
        const fitted = fitLogRecipeToPanel(recipe, panel, meta, sourceName); // Per-panel clone makes a single log exactly wall-width plus authored end overhang.
        const tempId = `__logwall_panel_${serial++}_${signature(meta)}`; // Temporary recipe key visible only during this synchronous delegated build call.
        this.recipeLibrary.set(tempId, fitted);
        try {
          const logOptions = {
            ...options,
            defaultRecipeId: tempId,
            unitMult: 1,
            densityMult: 1,
            rockScale: 1,
            usePlaceholder: meta.sourceMode === 'generated' ? options.usePlaceholder : false,
          }; // Size/density knobs are authored by the log recipe; global brick knobs must not change live-vs-baked parity.
          const fittedPanel = { ...panel, wallRecipeId: tempId }; // Non-mutating panel clone selecting the ephemeral exact-width recipe.
          moveChildren(originalBuild.call(this, [fittedPanel], logOptions), group);
        } finally {
          this.recipeLibrary.delete(tempId);
        }
      }
      group.userData = { ...(group.userData || {}), logWallStats: stats, latestChange: 'Log walls share deterministic generated/baked recipes.' };
      return group;
    };

    Object.defineProperty(prototype, INSTALL_FLAG, { value: true, configurable: false });
    return true;
  }

  return {
    VERSION,
    DEFAULTS,
    normalizeLogMeta,
    signature,
    createLogGeometry,
    createLogPrototype,
    makeRecipe,
    recipeLogMeta,
    install,
    latestChange: 'Log cabin walls can use deterministic foliage-style generated logs or the exact exported GLB prototype.',
  };
});
