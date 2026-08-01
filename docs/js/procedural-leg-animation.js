// Procedural leg/foot animation for non-creature (PNG-plane) avatars: attaches
// a pair of feet under an avatar's floor-anchored parent (the same `root`
// buildSinglePlaneAvatarModel returns, or playerMesh for the player — both
// place Y=0 at the actual floor, with the billboard plane itself offset up
// by modelHeight/2, see docs/js/png-plane-avatar.js) and steps them through a
// simple planted/swing gait driven by the avatar's own current movement
// speed. Species with a configured GLB (proceduralFeet.species in
// scratchbones-config.js) get that mesh, recolored per its materialRoles;
// everything else (kenkari/rakako'an, or any future species without an
// entry) gets a generated primitive foot instead. Ported from (and should
// stay consistent with) docs/tools/procedural-animation-editor/index.html,
// the reference authoring tool this was designed against.
(function () {
  'use strict';

  function cfg() {
    return window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.proceduralFeet || {};
  }

  function normalizeKey(value) {
    return String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/_/g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  }

  // Mirrors png-plane-avatar.js's own species->parentSpecies chain walk, so a
  // species without its own proceduralFeet entry inherits its parent's
  // (matching how portraitVerticalPlacement/portraitScaleBySpecies fall back).
  function configuredParentSpecies(species) {
    const speciesConfig = window.SCRATCHBONES_CONFIG?.game?.appearanceEditor?.species || {};
    return normalizeKey(speciesConfig[species]?.parentSpecies);
  }

  function speciesChain(species) {
    const chain = [];
    const seen = new Set();
    let current = normalizeKey(species);
    while (current && !seen.has(current)) {
      chain.push(current);
      seen.add(current);
      current = configuredParentSpecies(current);
    }
    return chain;
  }

  function footConfigForSpecies(species) {
    const bySpecies = cfg().species || {};
    for (const key of speciesChain(species)) {
      if (bySpecies[key]) return bySpecies[key];
    }
    return null;
  }

  const KENKARI_FAMILY = new Set(['kenkari', 'rakakoan']);

  function normalizeGender(value) {
    const g = String(value || '').trim().toLowerCase();
    return g === 'female' || g === 'f' ? 'female' : 'male';
  }

  // Per-species/gender authored foot-size multiplier (proceduralFeet.footScale
  // in scratchbones-config.js), mirroring png-plane-avatar.js's own
  // avatarPlacementRatioFor species-chain + gender-key lookup. Falls back to
  // 1 (the existing modelHeight-derived math, unchanged) for any
  // species/gender without an authored entry.
  function footScaleMultiplierForSpecies(speciesId, gender) {
    const table = cfg().footScale || {};
    const defaultMultiplier = Number.isFinite(Number(table.default)) ? Number(table.default) : 1;
    for (const key of speciesChain(speciesId)) {
      const entry = table[key];
      if (entry && Object.prototype.hasOwnProperty.call(entry, gender)) {
        const value = Number(entry[gender]);
        if (Number.isFinite(value)) return value;
      }
    }
    return defaultMultiplier;
  }

  function referenceHexForSpecies(speciesId) {
    return (typeof window._dyeReferenceHexForSlot === 'function')
      ? window._dyeReferenceHexForSlot('A', speciesId)
      : '#7dc89a';
  }

  function bodyColorDescriptor(bodyColors) {
    return bodyColors?.A || { hex: '#7dc89a' };
  }

  // Synchronous flat-color resolution (no image involved) — used both as the
  // immediate material color before the async textured surface resolves (so
  // there's no stark-white flash/flicker while canvas.png decodes) and as
  // the last-resort fallback if that texture ever fails to load, so a
  // missing/blocked asset degrades to "flat but correctly tinted" instead
  // of silently staying untinted white.
  function resolveFlatColorHex(colorDescriptor, referenceHex) {
    if (colorDescriptor?.hex) return colorDescriptor.hex;
    if (typeof window._resolveTargetRgbColor === 'function') {
      const rgb = window._resolveTargetRgbColor(colorDescriptor, referenceHex);
      if (Array.isArray(rgb)) {
        return '#' + rgb.slice(0, 3).map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
      }
    }
    return referenceHex;
  }

  function flatColorCanvas(hex) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 4;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = hex || '#808080';
    ctx.fillRect(0, 0, 4, 4);
    return canvas;
  }

  function smoothstep01(value) {
    const t = Math.max(0, Math.min(1, value));
    return t * t * (3 - 2 * t);
  }

  // Frame-rate-independent exponential damping toward `target` at rate
  // `lambda` (higher = snappier), matching the reference authoring tool's
  // own dampNumber helper.
  function damp(current, target, lambda, dt) {
    return current + (target - current) * (1 - Math.exp(-Math.max(0, lambda) * Math.max(0, dt)));
  }

  // Splits one foot's cycle into a long planted phase (the body travels over
  // a stationary foot) and a shorter lifted swing phase (the foot recovers
  // to the front) — ported from the reference procedural-movement tool's
  // stridePoseAtPhase.
  function stridePoseAtPhase(phase, strideLength, liftHeight, stanceFraction) {
    const cycle = ((phase % 1) + 1) % 1;
    if (cycle < stanceFraction) {
      const stanceT = cycle / stanceFraction;
      return { travel: strideLength * (0.5 - stanceT), lift: 0, planted: true };
    }
    const swingT = (cycle - stanceFraction) / Math.max(0.0001, 1 - stanceFraction);
    const eased = smoothstep01(swingT);
    return {
      travel: -strideLength / 2 + strideLength * eased,
      lift: Math.pow(Math.max(0, Math.sin(Math.PI * swingT)), 1.35) * liftHeight,
      planted: false,
    };
  }

  function disposeObjectResources(root) {
    if (!root) return;
    root.traverse?.(child => {
      child.geometry?.dispose?.();
      const materials = Array.isArray(child.material) ? child.material : (child.material ? [child.material] : []);
      for (const material of materials) {
        material.map?.dispose?.();
        material.dispose?.();
      }
    });
  }

  // ── Surface texture (colors) ────────────────────────────────────────────
  // Everything else in this game is drawn from shaded PNG art, recolored
  // toward a species' body color via portrait-utils.js's shade-fill tint
  // pipeline (the same one that colors clothing dyes and creature fur) — a
  // flat, untextured PBR color reads as visibly wrong next to that. These
  // feet reuse the exact same bundled surface PNGs and tint pipeline the
  // reference authoring tool uses for its own fallback feet: canvas.png for
  // ordinary "body color 1" skin, carved_smooth.png for the shared bone/claw
  // tint, boards.png for the Kenkari family's dark keratin.

  const _imageCache = new Map(); // asset path -> Promise<HTMLImageElement>
  function loadSurfaceImage(path) {
    if (_imageCache.has(path)) return _imageCache.get(path);
    const promise = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load ${path}`));
      img.src = path;
    });
    _imageCache.set(path, promise);
    return promise;
  }

  // Resolves one tinted CanvasTexture for a role ('body'/'bone'/'keratin'),
  // reusing portrait-utils.js's own shadeFillTintForBodyColor/getShadeFillCanvas
  // (already globally exposed and already cached by that module — colorDescriptor
  // may be a real {h,s,v} body color or a fixed {hex} for bone/keratin). Never
  // throws and never silently falls back to the untinted source PNG — any
  // failure (asset 404, tint pipeline unavailable) degrades to a flat canvas
  // in the correctly resolved color instead of leaving the material white.
  async function buildSurfaceTexture(THREE, sourcePath, colorDescriptor, referenceHex, repeatX, debugName) {
    let source = null;
    try {
      const img = await loadSurfaceImage(sourcePath);
      if (typeof window.shadeFillTintForBodyColor === 'function' && typeof window.getShadeFillCanvas === 'function') {
        const tint = window.shadeFillTintForBodyColor(colorDescriptor, referenceHex);
        source = tint?.mode === 'shadeFill' ? window.getShadeFillCanvas(img, sourcePath, tint) : null;
      }
    } catch (error) {
      source = null;
    }
    if (!source) source = flatColorCanvas(resolveFlatColorHex(colorDescriptor, referenceHex));
    const texture = new THREE.CanvasTexture(source);
    // Named so debug tools (e.g. the Pixel Probe's material dump) show
    // something identifiable instead of "(unnamed texture)".
    texture.name = debugName || sourcePath;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeatX || 1.25, 1);
    texture.needsUpdate = true;
    return texture;
  }

  // One shared, cached-per-attach() promise per role, so both feet (and, for
  // the GLB path, however many materials share a role) reuse a single loaded
  // texture instead of re-decoding/re-tinting the same PNG repeatedly.
  function makeSurfaceRoleResolver(THREE, speciesId, bodyColors) {
    const referenceHex = referenceHexForSpecies(speciesId);
    const promises = new Map();
    return role => {
      if (promises.has(role)) return promises.get(role);
      let promise;
      if (role === 'bone') {
        promise = buildSurfaceTexture(THREE, 'assets/textures/carved_smooth.png', { hex: cfg().boneColorHex || '#D8C7A3' }, referenceHex, 1.25, `${speciesId}_foot_bone`);
      } else if (role === 'keratin') {
        promise = buildSurfaceTexture(THREE, 'assets/textures/boards.png', { hex: cfg().keratinColorHex || '#44484D' }, referenceHex, 1.4, `${speciesId}_foot_keratin`);
      } else {
        promise = buildSurfaceTexture(THREE, 'assets/textures/canvas.png', bodyColorDescriptor(bodyColors), referenceHex, 1.25, `${speciesId}_foot_body`);
      }
      promises.set(role, promise);
      return promise;
    };
  }

  // ── Box-projected UVs for foot GLBs with no authored UVs ───────────────
  // The bundled foot GLBs carry POSITION/NORMAL only — no TEXCOORD_0 — so a
  // texture map would sample garbage without this. Ported directly from the
  // reference tool's generateImportedFootBoxProjectedUvs: per-triangle
  // dominant-axis box projection.
  function hasUsableUvs(geometry) {
    const position = geometry?.getAttribute?.('position');
    const uv = geometry?.getAttribute?.('uv');
    return Boolean(position && uv && uv.count === position.count);
  }

  function generateBoxProjectedUvs(THREE, geometry) {
    if (!geometry?.getAttribute?.('position') || hasUsableUvs(geometry)) return geometry;
    const originalGroups = (geometry.groups || []).map(group => ({ ...group }));
    const projected = geometry.index ? geometry.toNonIndexed() : geometry;
    if (projected !== geometry && originalGroups.length) {
      projected.clearGroups();
      for (const group of originalGroups) projected.addGroup(group.start, group.count, group.materialIndex);
    }
    const position = projected.getAttribute('position');
    projected.computeBoundingBox();
    const box = projected.boundingBox;
    const sizeX = Math.max(1e-6, box.max.x - box.min.x);
    const sizeY = Math.max(1e-6, box.max.y - box.min.y);
    const sizeZ = Math.max(1e-6, box.max.z - box.min.z);
    const uvArray = new Float32Array(position.count * 2);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const edge1 = new THREE.Vector3(), edge2 = new THREE.Vector3(), normal = new THREE.Vector3();
    for (let first = 0; first + 2 < position.count; first += 3) {
      a.fromBufferAttribute(position, first);
      b.fromBufferAttribute(position, first + 1);
      c.fromBufferAttribute(position, first + 2);
      edge1.subVectors(b, a);
      edge2.subVectors(c, a);
      normal.crossVectors(edge1, edge2).normalize();
      const ax = Math.abs(normal.x), ay = Math.abs(normal.y), az = Math.abs(normal.z);
      const dominant = ax >= ay && ax >= az ? 'x' : ay >= az ? 'y' : 'z';
      for (let corner = 0; corner < 3; corner++) {
        const vertex = corner === 0 ? a : corner === 1 ? b : c;
        let u, v;
        if (dominant === 'x') {
          u = (vertex.z - box.min.z) / sizeZ; v = (vertex.y - box.min.y) / sizeY;
          if (normal.x < 0) u = 1 - u;
        } else if (dominant === 'y') {
          u = (vertex.x - box.min.x) / sizeX; v = (vertex.z - box.min.z) / sizeZ;
          if (normal.y > 0) v = 1 - v;
        } else {
          u = (vertex.x - box.min.x) / sizeX; v = (vertex.y - box.min.y) / sizeY;
          if (normal.z > 0) u = 1 - u;
        }
        const target = (first + corner) * 2;
        uvArray[target] = u;
        uvArray[target + 1] = v;
      }
    }
    projected.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2));
    return projected;
  }

  // ── Placement width: scan the avatar's own torso silhouette ────────────
  // Ported from the reference tool's renderTorsoOnlyCanvasForFeet +
  // scanTorsoSpriteForFeet: re-renders just the fighter's base torso sprite
  // (no arms/clothes/head/hair) through the game's own portrait renderer,
  // finds its widest opaque horizontal row, and splits that span into a
  // left/right median column — a real per-species/gender silhouette
  // measurement instead of a guessed fraction of modelWidth.
  function torsoLayerForProfile(profile) {
    const bodyLayers = Array.isArray(profile?.fighter?.bodyLayers) ? profile.fighter.bodyLayers : [];
    const text = layer => `${layer?.id || ''} ${layer?.url || ''}`.toLowerCase();
    return bodyLayers.find(layer => String(layer?.id || '').toLowerCase() === 'torso')
      || bodyLayers.find(layer => /(^|[^a-z])torso([^a-z]|$)/.test(text(layer)))
      || bodyLayers.find(layer => /body|trunk|core/.test(text(layer)) && !/arm|wing|leg|tail/.test(text(layer)))
      || null;
  }

  async function buildTorsoOnlyCanvas(profile, size) {
    if (!window.NpcAvatarPreview?.renderProfileToCanvas || !profile?.fighter) return null;
    const torsoLayer = torsoLayerForProfile(profile);
    if (!torsoLayer?.url) return null;
    const none = { id: 'none', label: 'No clothing', tintSlot: null, layers: [] };
    const isolatedFighter = {
      ...profile.fighter,
      id: `${profile.fighter.id || 'fighter'}__legs_torso_only`,
      headUrl: null, urLayers: [], opacityMaskLayer: null,
      bodyLayers: [{ ...torsoLayer }],
    };
    const torsoOnlyProfile = {
      ...profile, fighter: isolatedFighter,
      hair: none, hairFront: none, hairBack: none, hairSide: none, hairSideL: none,
      hood: none, eyes: none, upperFace: none, facialHair: none, pauldron: none, hat: none,
      torsoCosmetic: none, armCosmetic: none,
    };
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    try {
      await window.NpcAvatarPreview.renderProfileToCanvas(canvas, torsoOnlyProfile, { omitHeadSpriteAndCosmetics: true });
    } catch (error) {
      return null;
    }
    return canvas;
  }

  function scanWidestOpaqueRow(canvas, alphaThreshold) {
    const width = canvas?.width || 0, height = canvas?.height || 0;
    if (!canvas || width < 2 || height < 2) return null;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const data = context.getImageData(0, 0, width, height).data;
    const rowLeft = new Int32Array(height).fill(width);
    const rowRight = new Int32Array(height).fill(-1);
    let top = height, bottom = -1;
    for (let y = 0; y < height; y++) {
      const rowOffset = y * width * 4;
      for (let x = 0; x < width; x++) {
        if (data[rowOffset + x * 4 + 3] <= alphaThreshold) continue;
        if (x < rowLeft[y]) rowLeft[y] = x;
        if (x > rowRight[y]) rowRight[y] = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
    if (bottom < top) return null;
    let widest = 0;
    const widestRows = [];
    for (let y = top; y <= bottom; y++) {
      if (rowRight[y] < rowLeft[y]) continue;
      const rowWidth = rowRight[y] - rowLeft[y] + 1;
      if (rowWidth > widest) { widest = rowWidth; widestRows.length = 0; widestRows.push(y); }
      else if (rowWidth === widest) widestRows.push(y);
    }
    if (widest < 2 || !widestRows.length) return null;
    const verticalCenter = (top + bottom) / 2;
    const sampleRow = widestRows.reduce((best, row) =>
      Math.abs(row - verticalCenter) < Math.abs(best - verticalCenter) ? row : best, widestRows[0]);
    const left = rowLeft[sampleRow], right = rowRight[sampleRow];
    const split = (left + right) / 2;
    return {
      canvasWidth: width, canvasHeight: height,
      leftMedian: (left + split) / 2,
      rightMedian: (split + right) / 2,
    };
  }

  function pixelToModelX(px, canvasWidth, modelWidth) {
    return -modelWidth / 2 + ((px + 0.5) / canvasWidth) * modelWidth;
  }

  // ── Per-species/gender session cache ────────────────────────────────────
  // The torso scan strips every individual/cosmetic variation (clothing,
  // hair, body color — see buildTorsoOnlyCanvas) down to just the species'
  // base torso sprite, so its result is identical for every NPC/player of
  // the same species+gender. Computing it once per species+gender for the
  // whole session (the first avatar of that species+gender to spawn pays
  // for it; every later one reuses the resolved value) instead of once per
  // avatar instance avoids redundantly re-rendering and re-scanning the
  // identical silhouette for, e.g., every tletingan bandit in a camp.
  // General-purpose (not just for this one scan) so future once-per-
  // species/gender checks have somewhere to live instead of re-deriving
  // their own caching each time.
  const _speciesGenderSession = new Map(); // "species::gender" -> {}
  function speciesGenderSession(speciesId, gender) {
    const key = `${speciesId}::${gender}`;
    let entry = _speciesGenderSession.get(key);
    if (!entry) { entry = {}; _speciesGenderSession.set(key, entry); }
    return entry;
  }

  // Resolves (once per species+gender per session) the torso silhouette's
  // widest-row pixel scan. Resolves to null if the profile/species doesn't
  // support the scan for any reason (caller keeps its fixed-fraction guess).
  function cachedTorsoScan(speciesId, gender, profile, portraitSize) {
    const session = speciesGenderSession(speciesId, gender);
    if (!session.torsoScanPromise) {
      session.torsoScanPromise = (async () => {
        const torsoCanvas = await buildTorsoOnlyCanvas(profile, portraitSize);
        if (!torsoCanvas) return null;
        return scanWidestOpaqueRow(torsoCanvas, Number(cfg().alphaThreshold) || 8);
      })();
    }
    return session.torsoScanPromise;
  }

  // A generated fallback foot: a flattened sphere pad, plus (for the Kenkari
  // family only) a pair of forward/backward teardrop-toe "V"s, mirroring the
  // reference tool's primitive anatomy. Used for any species without a
  // configured GLB (today: kenkari, rakako'an).
  function buildFallbackFoot(THREE, options) {
    const { speciesId, radius, sphereScaleXZ, sphereScaleY, initialColorHex } = options;
    const group = new THREE.Group();
    // Starts tinted flat (not white) so there's no stark-white flash while
    // the textured surface decodes asynchronously; buildSurfaceTexture's
    // resolved map replaces this material's map (and resets color to white
    // so the two don't multiply together) once it's ready.
    const material = new THREE.MeshStandardMaterial({ color: initialColorHex || 0xffffff, roughness: 0.85, metalness: 0.02 });
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 12), material);
    sphere.scale.set(sphereScaleXZ, sphereScaleY, sphereScaleXZ);
    sphere.castShadow = true;
    sphere.receiveShadow = true;
    group.add(sphere);
    if (KENKARI_FAMILY.has(speciesId)) {
      const toeLength = radius * 2.2;
      const toeRadius = radius * 0.17;
      const toeGeometry = new THREE.ConeGeometry(toeRadius, toeLength, 10);
      const sets = [{ z: radius * 0.18, facing: 0 }, { z: -radius * 0.18, facing: Math.PI }];
      for (const set of sets) {
        for (const side of [-1, 1]) {
          const toe = new THREE.Mesh(toeGeometry, material);
          // Cones point along +Y by default; lay them flat along local Z (the
          // gait's forward/back travel axis) and fan the pair outward.
          toe.rotation.x = Math.PI / 2;
          toe.rotation.z = set.facing + side * 0.42;
          toe.position.set(0, -radius + toeRadius * 0.6, set.z);
          toe.castShadow = true;
          group.add(toe);
        }
      }
    }
    group.userData.contactRadiusY = radius * sphereScaleY;
    group.userData.material = material;
    return group;
  }

  const _glbSceneCache = new Map(); // glb path -> Promise<THREE.Object3D>

  function loadGlbScene(THREE, path) {
    if (_glbSceneCache.has(path)) return _glbSceneCache.get(path);
    const promise = new Promise((resolve, reject) => {
      if (!THREE.GLTFLoader) { reject(new Error('THREE.GLTFLoader is not available.')); return; }
      new THREE.GLTFLoader().load(path, gltf => resolve(gltf.scene), undefined, reject);
    });
    _glbSceneCache.set(path, promise);
    return promise;
  }

  // Doubles the imported GLB after normalizing it to the species' procedural
  // foot contact diameter, matching the reference tool's
  // IMPORTED_FOOT_AUTOFIT_MULTIPLIER (the bundled feet are modeled small
  // relative to the procedural placeholder's contact radius).
  const IMPORTED_FOOT_AUTOFIT_MULTIPLIER = 2;

  // Builds one recolored, auto-fit clone of a species' configured foot GLB.
  // The bundled foot GLBs carry flat (untextured) per-material base colors
  // named "Mat 1"/"Mat 2" and no UVs at all — materialRoles maps those names
  // to a role ('body'/'bone') rather than assuming array order, since gltf
  // material array order isn't guaranteed to match the authored names (the
  // sloth and pachyderm GLBs actually store them in opposite order).
  async function buildGlbFoot(THREE, footConfig, options) {
    const { speciesId, targetHeight, surfaceForRole } = options;
    const scene = await loadGlbScene(THREE, footConfig.glb);
    const clone = scene.clone(true);
    const roles = footConfig.materialRoles || {};
    const roleTextures = new Map();
    for (const role of new Set(Object.values(roles))) {
      roleTextures.set(role, await surfaceForRole(role));
    }
    const defaultTexture = await surfaceForRole('body');
    const remapped = new Map();
    clone.traverse(child => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
      if (child.geometry) child.geometry = generateBoxProjectedUvs(THREE, child.geometry.clone());
      const applyOne = material => {
        if (remapped.has(material)) return remapped.get(material);
        const role = roles[material.name];
        const texture = roleTextures.get(role) || defaultTexture;
        const cloned = new THREE.MeshStandardMaterial({ map: texture, color: 0xffffff, roughness: 0.85, metalness: 0.02 });
        cloned.name = material.name;
        remapped.set(material, cloned);
        return cloned;
      };
      child.material = Array.isArray(child.material) ? child.material.map(applyOne) : applyOne(child.material);
    });
    clone.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(clone);
    const size = bounds.getSize(new THREE.Vector3());
    if (size.y > 0.000001 && targetHeight > 0) {
      clone.scale.multiplyScalar(targetHeight / size.y);
      clone.updateMatrixWorld(true);
    }
    const fitted = new THREE.Box3().setFromObject(clone);
    const center = fitted.getCenter(new THREE.Vector3());
    clone.position.x -= center.x;
    clone.position.z -= center.z;
    clone.position.y -= fitted.min.y; // sits the model's own bottom at local Y=0
    const group = new THREE.Group();
    group.add(clone);
    group.userData.contactRadiusY = 0;
    return group;
  }

  const STANCE_FRACTION = 0.62;

  // Attaches a procedural feet pair under `parent` (the avatar's own
  // floor-anchored root/playerMesh — NOT the billboard plane child, which
  // sits modelHeight/2 above it). Returns a handle with update()/dispose(),
  // or null if procedural feet are disabled or no species could be resolved.
  // options.profile (the same portrait profile passed to
  // NpcAvatarPreview.renderProfileToCanvas when building the avatar's own
  // texture) is optional but required for the real torso-width scan;
  // without it, feet fall back to a fixed fraction of modelWidth.
  function attach(THREE, parent, options = {}) {
    if (!THREE || !parent) return null;
    const c = cfg();
    if (c.enabled === false) return null;
    const speciesId = normalizeKey(options.speciesId);
    if (!speciesId) return null;
    const gender = normalizeGender(options.gender);
    const modelWidth = Number(options.modelWidth) || 0.9;
    const modelHeight = Number(options.modelHeight) || modelWidth;
    const stanceWidthFraction = Number(c.stanceWidthFraction) || 0.16;
    const footHeightFraction = Number(c.footHeightFraction) || 0.11;
    // footScale is an authored per-species/gender multiplier
    // (proceduralFeet.footScale) on top of this base formula — defaults to
    // 1 (formula unchanged) for any species/gender without an authored
    // entry.
    const radius = modelHeight * footHeightFraction * 0.5 * footScaleMultiplierForSpecies(speciesId, gender);
    const isKenkariFamily = KENKARI_FAMILY.has(speciesId);
    const sphereScaleXZ = isKenkariFamily ? 0.6 : 1;
    const sphereScaleY = isKenkariFamily ? 1 : 0.75;
    const referenceHex = referenceHexForSpecies(speciesId);
    const initialColorHex = resolveFlatColorHex(
      isKenkariFamily ? { hex: c.keratinColorHex || '#44484D' } : bodyColorDescriptor(options.bodyColors),
      referenceHex
    );

    const root = new THREE.Group();
    root.name = `${options.name || 'avatar'}_procedural_feet`;

    const state = {
      phase: 0,
      gaitStrength: 0,
      left: null,
      right: null,
      leftContactY: radius * sphereScaleY,
      rightContactY: radius * sphereScaleY,
      idleLeftX: -stanceWidthFraction * modelWidth * 0.5,
      idleRightX: stanceWidthFraction * modelWidth * 0.5,
      disposed: false,
    };

    function placeIdle(mesh, isLeft, contactY) {
      mesh.position.set(isLeft ? state.idleLeftX : state.idleRightX, contactY, 0);
    }

    const surfaceForRole = makeSurfaceRoleResolver(THREE, speciesId, options.bodyColors);

    const leftFallback = buildFallbackFoot(THREE, { speciesId, radius, sphereScaleXZ, sphereScaleY, initialColorHex });
    const rightFallback = buildFallbackFoot(THREE, { speciesId, radius, sphereScaleXZ, sphereScaleY, initialColorHex });
    leftFallback.name = 'left_foot';
    rightFallback.name = 'right_foot';
    placeIdle(leftFallback, true, leftFallback.userData.contactRadiusY);
    placeIdle(rightFallback, false, rightFallback.userData.contactRadiusY);
    root.add(leftFallback, rightFallback);
    state.left = leftFallback;
    state.right = rightFallback;
    state.leftContactY = leftFallback.userData.contactRadiusY;
    state.rightContactY = rightFallback.userData.contactRadiusY;

    surfaceForRole(isKenkariFamily ? 'keratin' : 'body').then(texture => {
      if (state.disposed) return;
      for (const foot of [leftFallback, rightFallback]) {
        const material = foot.userData.material;
        // Resets to white so the texture's own baked tint isn't multiplied
        // by the initial flat-color placeholder (see buildFallbackFoot).
        if (material) { material.map = texture; material.color.set(0xffffff); material.needsUpdate = true; }
      }
    }).catch(error => {
      console.warn(`[ProceduralLegAnimation] fallback foot texture failed for "${speciesId}":`, error);
    });

    const footConfig = footConfigForSpecies(speciesId);
    if (footConfig?.glb) {
      const targetHeight = radius * sphereScaleY * 2 * IMPORTED_FOOT_AUTOFIT_MULTIPLIER;
      Promise.all([
        buildGlbFoot(THREE, footConfig, { speciesId, targetHeight, surfaceForRole }),
        buildGlbFoot(THREE, footConfig, { speciesId, targetHeight, surfaceForRole }),
      ]).then(([leftMesh, rightMesh]) => {
        if (state.disposed) { disposeObjectResources(leftMesh); disposeObjectResources(rightMesh); return; }
        leftMesh.name = 'left_foot';
        rightMesh.name = 'right_foot';
        leftMesh.scale.x *= -1; // mirrors handedness for the left foot from a single authored mesh
        root.remove(state.left);
        root.remove(state.right);
        disposeObjectResources(state.left);
        disposeObjectResources(state.right);
        placeIdle(leftMesh, true, leftMesh.userData.contactRadiusY);
        placeIdle(rightMesh, false, rightMesh.userData.contactRadiusY);
        root.add(leftMesh, rightMesh);
        state.left = leftMesh;
        state.right = rightMesh;
        state.leftContactY = leftMesh.userData.contactRadiusY;
        state.rightContactY = rightMesh.userData.contactRadiusY;
      }).catch(error => {
        console.warn(`[ProceduralLegAnimation] foot GLB load failed for "${speciesId}" (${footConfig.glb}):`, error);
      });
    }

    // Refines idle X placement from the avatar's own torso silhouette once
    // the (per species+gender, session-cached) scan resolves — both feet,
    // whichever pair is currently attached (fallback or already-swapped
    // GLB), snap to the corrected spacing so a fast-loading GLB doesn't get
    // stuck on the rough guess. The expensive part (render + pixel scan) is
    // shared across every avatar of this species+gender for the rest of the
    // session; only the pixel->world conversion below (modelWidth can differ
    // per instance, e.g. a child) runs per avatar.
    if (options.profile) {
      const portraitSize = Number(options.portraitSize) || 200;
      cachedTorsoScan(speciesId, gender, options.profile, portraitSize).then(scan => {
        if (state.disposed || !scan) return;
        state.idleLeftX = pixelToModelX(scan.leftMedian, scan.canvasWidth, modelWidth);
        state.idleRightX = pixelToModelX(scan.rightMedian, scan.canvasWidth, modelWidth);
        if (state.left) state.left.position.x = state.idleLeftX;
        if (state.right) state.right.position.x = state.idleRightX;
      }).catch(error => {
        console.warn(`[ProceduralLegAnimation] torso width scan failed for "${speciesId}":`, error);
      });
    }

    parent.add(root);

    function applyPose(mesh, contactY, idleX, pose, response, dt) {
      if (!mesh) return;
      mesh.position.x = damp(mesh.position.x, idleX, response, dt);
      const targetZ = pose.travel;
      mesh.position.z = damp(mesh.position.z, targetZ, response, dt);
      const rollAmount = pose.travel / Math.max(radius, 0.001) * 0.32;
      mesh.rotation.x = damp(mesh.rotation.x, -rollAmount, response, dt);
      if (pose.planted && state.gaitStrength > 0.04) {
        mesh.position.y = contactY;
      } else {
        mesh.position.y = damp(mesh.position.y, contactY + pose.lift, response, dt);
      }
    }

    // speedWorldUnitsPerSecond: current movement speed in the same world
    // units as modelWidth/modelHeight (i.e. Three.js scene units, not
    // pixels/tiles — callers convert their own speed units before calling).
    // suppressed: true while a multi-avatar animation (mount, milking, …)
    // is driving this avatar's whole-body transform and this avatar is not
    // the anchor — the feet are hidden rather than animated, since there's
    // no meaningful "standing on the ground" pose while e.g. seated on a
    // mount. A shoulder pet never sets this: the host avatar stays the
    // anchor and keeps walking normally underneath it.
    function update(dt, speedWorldUnitsPerSecond, suppressed) {
      if (state.disposed) return;
      root.visible = !suppressed;
      if (suppressed) {
        state.gaitStrength = damp(state.gaitStrength, 0, 12, dt);
        return;
      }
      const speed = Math.max(0, Number(speedWorldUnitsPerSecond) || 0);
      const referenceSpeed = Number(c.referenceSpeedWorldUnitsPerSecond) || 4.3;
      const speedRatio = Math.max(0, Math.min(1.25, speed / Math.max(0.1, referenceSpeed)));
      const gaitTarget = speed > 0.02 ? Math.sqrt(speedRatio) : 0;
      state.gaitStrength = damp(state.gaitStrength, gaitTarget, gaitTarget > state.gaitStrength ? 8 : 12, dt);

      const fullStride = modelHeight * (0.24 + 0.34 * Math.sqrt(speedRatio));
      const strideLength = fullStride * state.gaitStrength;
      const cadenceHz = speed > 0.02 && fullStride > 0.001
        ? Math.max(0.55, Math.min(3.2, (speed * STANCE_FRACTION) / fullStride))
        : 0;
      const liftHeight = (radius * (0.35 + 1.35 * Math.sqrt(speedRatio)) + modelHeight * 0.012 * speedRatio) * state.gaitStrength;
      if (cadenceHz > 0.001) state.phase = (state.phase + dt * cadenceHz) % 1;

      const leftPose = stridePoseAtPhase(state.phase, strideLength, liftHeight, STANCE_FRACTION);
      const rightPose = stridePoseAtPhase(state.phase + 0.5, strideLength, liftHeight, STANCE_FRACTION);
      const response = speed > 0.02 ? 18 + cadenceHz * 3 : 11;
      applyPose(state.left, state.leftContactY, state.idleLeftX, leftPose, response, dt);
      applyPose(state.right, state.rightContactY, state.idleRightX, rightPose, response, dt);
    }

    function dispose() {
      if (state.disposed) return;
      state.disposed = true;
      parent.remove(root);
      disposeObjectResources(root);
    }

    return { group: root, update, dispose };
  }

  window.ProceduralLegAnimation = { attach };
})();
