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
//
// Each foot actually hangs off an invisible 2-bone leg (hip -> thigh -> calf,
// see docs/js/leg-bones.js) running from that leg's own hip anchor — X fixed
// at the leg's own idle stance X, Y at the avatar's "posterior" anchor
// height — down to wherever the gait/idle math above says the foot should
// be right now. Unauthored, the thigh points straight at the foot and the
// knee just marks its midpoint, so the leg reads as one straight line and
// the whole chain "follows the avatar wherever it goes" for free. An
// optional authored bend (proceduralFeet.legBend in scratchbones-config.js)
// rotates the thigh away from that straight line; the calf is never
// authored directly — it's re-aimed at the live foot target every frame so
// the foot never detaches from its computed ground contact point.
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

  // Per-species/gender authored posterior height rule (posteriorRule.
  // heightPercentOffset in attachment-rig-profiles.js — the same rig data
  // docs/tools/animation-author/index.html authors and the game's own
  // mount-seat placement references), mirroring that tool's own live-preview
  // formula: hip height = handAttachY + modelHeight * heightPercentOffset/100,
  // both terms already in the avatar's floor-anchored root space (handAttachY
  // is png-plane-avatar.js's own scanned hand-height, passed in via
  // options.handAttachY). Falls back to -18 (this rig data's own default,
  // see DEFAULT_POSTERIOR_HEIGHT_PERCENT in animation-author/index.html) for
  // any species/gender without an authored rule.
  function heightPercentOffsetForSpecies(speciesId, gender) {
    const lib = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters || {};
    const rec = lib[`${speciesId}::${gender}`];
    const value = Number(rec?.posteriorRule?.heightPercentOffset);
    return Number.isFinite(value) ? value : -18;
  }

  function posteriorYForSpecies(speciesId, gender, modelHeight, handAttachY) {
    const baseY = Number.isFinite(handAttachY) ? handAttachY : modelHeight / 2;
    return baseY + modelHeight * heightPercentOffsetForSpecies(speciesId, gender) / 100;
  }

  // Per-species/gender authored posterior anchor X (attachment-rig-profiles.js
  // anchors.posterior.position.x — "center", i.e. 0, for every authored
  // species today, but read live rather than hardcoded so an eventually
  // off-center posterior anchor is still honored). Falls back to 0 (the
  // avatar's own local centerline) for any species/gender without an
  // authored rig entry.
  function posteriorXForSpecies(speciesId, gender) {
    const lib = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters || {};
    const rec = lib[`${speciesId}::${gender}`];
    const value = Number(rec?.anchors?.posterior?.position?.x);
    return Number.isFinite(value) ? value : 0;
  }

  // Per-species/gender authored knee bend (proceduralFeet.legBend in
  // scratchbones-config.js), mirroring footScaleMultiplierForSpecies's own
  // species-chain + gender-key lookup. One {x,z} (degrees) per species+
  // gender applied to BOTH legs — the caller mirrors x (lateral) between
  // left/right, matching how the rest of this avatar's authored data
  // (footScale, portraitVerticalPlacement) is per-species+gender rather than
  // per-side. Falls back to a perfectly straight leg ({x:0,z:0}) for any
  // species/gender without an authored entry.
  function legBendForSpecies(speciesId, gender) {
    const table = cfg().legBend || {};
    const fallback = { x: Number(table.default?.x) || 0, z: Number(table.default?.z) || 0 };
    for (const key of speciesChain(speciesId)) {
      const entry = table[key];
      if (entry && Object.prototype.hasOwnProperty.call(entry, gender)) {
        const x = Number(entry[gender]?.x), z = Number(entry[gender]?.z);
        if (Number.isFinite(x) && Number.isFinite(z)) return { x, z };
      }
    }
    return fallback;
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

  // Opts every real mesh under `obj` into the game's inverted-shell outline
  // pass (see game.js's "Inverted shell outline" section / _markOutline) —
  // that pass renders layer-1 meshes a second time, back-side-only and
  // extruded along their normals, for the same thin black border every
  // other 3D prop (houses, furniture, terrain decor) gets. Layer 1 is a
  // plain THREE.Object3D API, not something private to game.js's closure,
  // so this only needs to mirror the same convention, not call into it.
  function markOutline(obj) {
    obj?.traverse?.(child => { if (child.isMesh) child.layers.enable(1); });
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
    // MeshBasicMaterial (fully unlit) — MeshToonMaterial's quantized
    // gradientMap only affects the DIRECT/directional-light diffuse term;
    // ambient and hemisphere light still apply unconditionally, full
    // strength, on every step including the brightest. The main outdoor
    // scene's HemisphereLight(sky #88ccff, ground #3a5a30 — a dark green)
    // was tinting toon feet green outdoors regardless, while indoor scenes
    // (no hemisphere light there) rendered correctly — confirmed live by
    // switching areas. Every other avatar-attached object (the body plane
    // itself, held tools/weapons, hat overlays — see makeSpriteMaterial in
    // png-plane-avatar.js and makeToolPlaneMesh in game.js) is unlit for
    // exactly this reason: it's the only way to be scene-lighting-invariant,
    // not just direct-light-invariant.
    // Starts tinted flat (not white) so there's no stark-white flash while
    // the textured surface decodes asynchronously; buildSurfaceTexture's
    // resolved map replaces this material's map (and resets color to white
    // so the two don't multiply together) once it's ready.
    const material = new THREE.MeshBasicMaterial({ color: initialColorHex || 0xffffff });
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
          toe.receiveShadow = true;
          group.add(toe);
        }
      }
    }
    group.userData.contactRadiusY = radius * sphereScaleY;
    group.userData.material = material;
    markOutline(group);
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
        // See buildFallbackFoot's comment on unlit vs lit materials.
        const cloned = new THREE.MeshBasicMaterial({ map: texture, color: 0xffffff });
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
    markOutline(group);
    // Seams where this foot's two materials meet (e.g. the sloth/pachyderm
    // bone-claw mesh touching the body-pad mesh) — game.js's furniture
    // material-ID outline pass, exposed via window.HobunjiOutlines since
    // this module is outside that closure. Marking the whole group tags
    // each mesh CHILD with its own unique ID independently (see that
    // function's own comment), so this only produces a seam where two
    // differently-tagged meshes actually touch — harmless (no seam drawn)
    // for the single-material feline foot, which has just one mesh.
    window.HobunjiOutlines?.markMaterialSeamId?.(group);
    return group;
  }

  const STANCE_FRACTION = 0.62;

  // ── Debug leg-bone visualization ────────────────────────────────────
  // Same colored capsule-and-joint guides the furniture-avatar-author tool
  // draws over its own seated preview (makeSeatedBoneGuide et al.) — a
  // shared toggle so every avatar's leg chain (player and NPCs alike, since
  // they all attach() through here) shows/hides together. Guides are built
  // once per leg alongside the real hip/thigh/calf pivots and just ride
  // along for free; only their scale/visibility needs updating per frame,
  // done inline in applyLegChain/applySeatedPose right next to the pivot
  // transforms they mirror.
  let showLegBoneGuides = false;
  function makeBoneGuide(THREE, color) {
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.62, depthTest: false, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.015, 1, 8), material);
    mesh.renderOrder = 42;
    mesh.visible = false;
    mesh.frustumCulled = false;
    return mesh;
  }
  function makeJointGuide(THREE, color, radius) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 10, 8), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false }));
    mesh.renderOrder = 43;
    mesh.visible = false;
    mesh.frustumCulled = false;
    return mesh;
  }

  // Attaches a procedural feet pair under `parent` (the avatar's own
  // floor-anchored root/playerMesh — NOT the billboard plane child, which
  // sits modelHeight/2 above it). Returns a handle with update()/dispose(),
  // or null if procedural feet are disabled or no species could be resolved.
  // options.profile (the same portrait profile passed to
  // NpcAvatarPreview.renderProfileToCanvas when building the avatar's own
  // texture) is optional but required for the real torso-width scan;
  // without it, feet fall back to a fixed fraction of modelWidth.
  // options.handAttachY (avatarGroup.userData.handAttachY from
  // png-plane-avatar.js, already in this same floor-anchored space) anchors
  // the invisible leg chain's hip pivot; without it the hip falls back to
  // modelHeight/2 (the sprite's own vertical center).
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
    const sizeBalanceMultiplier = Number(c.sizeBalanceMultiplier) > 0 ? Number(c.sizeBalanceMultiplier) : 1; // Enlarges every fallback/imported foot toward the shared hand/foot midpoint.
    // footScale is an authored per-species/gender multiplier
    // (proceduralFeet.footScale) on top of this base formula — defaults to
    // 1 (formula unchanged) for any species/gender without an authored
    // entry.
    const radius = modelHeight * footHeightFraction * 0.5 * footScaleMultiplierForSpecies(speciesId, gender) * sizeBalanceMultiplier;
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

    const posteriorY = posteriorYForSpecies(speciesId, gender, modelHeight, Number(options.handAttachY));
    const posteriorX = posteriorXForSpecies(speciesId, gender); // Used to recenter the legs and to locate the seated surface in this avatar-local frame.
    const initialIdleLeftX = -stanceWidthFraction * modelWidth * 0.5;
    const initialIdleRightX = stanceWidthFraction * modelWidth * 0.5;

    // Invisible hip -> thigh -> calf chain per leg (see docs/js/leg-bones.js)
    // — each leg gets its OWN hip anchor, at that leg's own idle stance X
    // (not the avatar's centerline) and the shared posterior height, so an
    // unauthored leg hangs straight down from directly above where its foot
    // actually rests rather than converging both legs toward the center.
    // Thigh/calf carry no geometry of their own; the foot mesh (built below)
    // is reparented onto the calf once it exists.
    function buildLegChain(sideName, hipX) {
      const hip = new THREE.Group();
      hip.name = `${sideName}_hip`;
      hip.position.set(hipX, posteriorY, 0);
      root.add(hip);
      const thigh = new THREE.Group();
      thigh.name = `${sideName}_thigh`;
      const calf = new THREE.Group();
      calf.name = `${sideName}_calf`;
      thigh.add(calf);
      hip.add(thigh);
      const hipGuide = makeJointGuide(THREE, 0xffd98f, 0.021);
      hip.add(hipGuide);
      const thighGuide = makeBoneGuide(THREE, 0xffb267);
      thigh.add(thighGuide);
      const kneeGuide = makeJointGuide(THREE, 0xffd39a, 0.022);
      calf.add(kneeGuide);
      const calfGuide = makeBoneGuide(THREE, 0xff7f50);
      calf.add(calfGuide);
      return { hip, thigh, calf, hipGuide, thighGuide, kneeGuide, calfGuide };
    }
    const legChains = {
      left: buildLegChain('left', initialIdleLeftX),
      right: buildLegChain('right', initialIdleRightX),
    };

    // One authored bend per species+gender applied to both legs, mirrored
    // laterally (x) between left/right — see legBendForSpecies.
    const bendBase = legBendForSpecies(speciesId, gender);
    const legBend = { left: { x: bendBase.x, z: bendBase.z }, right: { x: -bendBase.x, z: bendBase.z } };

    const state = {
      phase: 0,
      gaitStrength: 0,
      left: null,
      right: null,
      leftContactY: radius * sphereScaleY,
      rightContactY: radius * sphereScaleY,
      idleLeftX: initialIdleLeftX,
      idleRightX: initialIdleRightX,
      // Live foot targets, in root-local space (the same frame the old code
      // wrote directly onto mesh.position in) — the thigh/calf chain is
      // solved from each leg's own hip -> this point every time it changes.
      leftTarget: new THREE.Vector3(initialIdleLeftX, radius * sphereScaleY, 0),
      rightTarget: new THREE.Vector3(initialIdleRightX, radius * sphereScaleY, 0),
      leftRoll: 0,
      rightRoll: 0,
      disposed: false,
    };

    // Keeps a leg's hip anchor's X pinned to its own idle stance X (the torso
    // scan below can correct idleLeftX/idleRightX after this leg's hip was
    // already built from the rough fixed-fraction guess).
    function syncHipX(side) {
      legChains[side].hip.position.x = side === 'left' ? state.idleLeftX : state.idleRightX;
    }

    // Solves the leg chain for `side` ('left'/'right') from that leg's own
    // hip to the side's current target and applies the result to its
    // thigh/calf Object3Ds and its foot mesh (whichever is currently
    // attached — fallback or GLB), so the foot mesh's own local
    // position/rotation is always just (0, -calfLength, 0) plus the roll
    // lean: every other component of where the foot actually ends up in the
    // world comes from the chain's transforms, not from the mesh itself.
    function applyBoneGuideTransforms(chain, thighLength, calfLength) {
      chain.hipGuide.visible = showLegBoneGuides;
      chain.thighGuide.visible = showLegBoneGuides;
      chain.kneeGuide.visible = showLegBoneGuides;
      chain.calfGuide.visible = showLegBoneGuides;
      if (!showLegBoneGuides) return;
      chain.thighGuide.scale.set(1, thighLength, 1);
      chain.thighGuide.position.y = -thighLength * 0.5;
      chain.calfGuide.scale.set(1, calfLength, 1);
      chain.calfGuide.position.y = -calfLength * 0.5;
    }

    function applyLegChain(side) {
      const mesh = state[side];
      const chain = legChains[side];
      const target = state[`${side}Target`];
      if (!mesh || !chain || !target || !window.LegBones) return;
      const bend = legBend[side];
      const solved = window.LegBones.solveTwoBoneLeg(THREE, {
        hip: chain.hip.position, foot: target, bendDegX: bend.x, bendDegZ: bend.z,
      });
      chain.thigh.quaternion.copy(solved.thighQuaternion);
      chain.calf.position.set(0, -solved.thighLength, 0);
      chain.calf.quaternion.copy(solved.calfLocalQuaternion);
      mesh.position.set(0, -solved.calfLength, 0);
      mesh.rotation.x = state[`${side}Roll`];
      applyBoneGuideTransforms(chain, solved.thighLength, solved.calfLength);
    }

    // Sets a leg's target straight to its idle stance (no damping — used
    // both for the very first pose and whenever the foot mesh itself is
    // swapped out, matching the previous placeIdle's snap-to-idle behavior)
    // and immediately re-solves the chain so the new mesh doesn't render at
    // the chain's stale/default pose for a frame.
    function placeIdleTarget(side, contactY) {
      const idleX = side === 'left' ? state.idleLeftX : state.idleRightX;
      state[`${side}Target`].set(idleX, contactY, 0);
      state[`${side}Roll`] = 0;
      applyLegChain(side);
    }

    const surfaceForRole = makeSurfaceRoleResolver(THREE, speciesId, options.bodyColors);

    const leftFallback = buildFallbackFoot(THREE, { speciesId, radius, sphereScaleXZ, sphereScaleY, initialColorHex });
    const rightFallback = buildFallbackFoot(THREE, { speciesId, radius, sphereScaleXZ, sphereScaleY, initialColorHex });
    leftFallback.name = 'left_foot';
    rightFallback.name = 'right_foot';
    legChains.left.calf.add(leftFallback);
    legChains.right.calf.add(rightFallback);
    state.left = leftFallback;
    state.right = rightFallback;
    state.leftContactY = leftFallback.userData.contactRadiusY;
    state.rightContactY = rightFallback.userData.contactRadiusY;
    placeIdleTarget('left', state.leftContactY);
    placeIdleTarget('right', state.rightContactY);

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
        legChains.left.calf.remove(state.left);
        legChains.right.calf.remove(state.right);
        disposeObjectResources(state.left);
        disposeObjectResources(state.right);
        legChains.left.calf.add(leftMesh);
        legChains.right.calf.add(rightMesh);
        state.left = leftMesh;
        state.right = rightMesh;
        state.leftContactY = leftMesh.userData.contactRadiusY;
        state.rightContactY = rightMesh.userData.contactRadiusY;
        placeIdleTarget('left', state.leftContactY);
        placeIdleTarget('right', state.rightContactY);
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
        const scannedLeftX = pixelToModelX(scan.leftMedian, scan.canvasWidth, modelWidth);
        const scannedRightX = pixelToModelX(scan.rightMedian, scan.canvasWidth, modelWidth);
        // The scan's own left/right medians can land asymmetrically around
        // the torso's true centerline (e.g. a lopsided silhouette); re-center
        // both legs by the same shift so the posterior attach point's X ends
        // up exactly midway between them rather than inheriting that skew.
        const recenterShift = posteriorX - (scannedLeftX + scannedRightX) / 2;
        state.idleLeftX = scannedLeftX + recenterShift;
        state.idleRightX = scannedRightX + recenterShift;
        syncHipX('left');
        syncHipX('right');
        if (state.left) { state.leftTarget.x = state.idleLeftX; applyLegChain('left'); }
        if (state.right) { state.rightTarget.x = state.idleRightX; applyLegChain('right'); }
      }).catch(error => {
        console.warn(`[ProceduralLegAnimation] torso width scan failed for "${speciesId}":`, error);
      });
    }

    parent.add(root);

    function applyPose(side, contactY, idleX, pose, response, dt) {
      const target = state[`${side}Target`];
      if (!state[side] || !target) return;
      target.x = damp(target.x, idleX, response, dt);
      const targetZ = pose.travel;
      target.z = damp(target.z, targetZ, response, dt);
      const rollAmount = pose.travel / Math.max(radius, 0.001) * 0.32;
      state[`${side}Roll`] = damp(state[`${side}Roll`], -rollAmount, response, dt);
      if (pose.planted && state.gaitStrength > 0.04) {
        target.y = contactY;
      } else {
        target.y = damp(target.y, contactY + pose.lift, response, dt);
      }
      applyLegChain(side);
    }

    // speedWorldUnitsPerSecond: current movement speed in the same world
    // units as modelWidth/modelHeight (i.e. Three.js scene units, not
    // pixels/tiles — callers convert their own speed units before calling).
    // suppressed: true while a multi-avatar animation (mount, milking, …)
    // is driving this avatar's whole-body transform and this avatar is not
    // the anchor — the legs stay visible but just hang straight down from
    // their hip anchors instead of gaiting, since there's no meaningful
    // "standing on the ground" pose while e.g. seated on a mount. A
    // shoulder pet never sets this: the host avatar stays the anchor and
    // keeps walking normally underneath it.
    // seatedPose (optional): { seatY, normalDeg:{x,z}, footprintHalfDepth,
    // anchorZ } describing the furniture's own authored seat anchor — when
    // provided, bypasses gait/suppressed entirely and runs the faithful
    // surface-flush seated solve below (ported from the furniture-avatar-
    // author tool's solveSurfaceFlushSeatedLeg/seatedLegPose) instead of a
    // fixed-bend approximation. The caller already moves the whole avatar
    // so its posterior coincides with seatY; this module therefore solves
    // the seat plane in the resulting avatar-local posterior frame rather
    // than treating the floor-relative seat height as a second hip height.
    // Used for sitting (see docs/game.js's sitInteraction).
    const SEATED_THIGH_SURFACE_CLEARANCE = 0.006;
    const SEATED_KNEE_EDGE_TOLERANCE = 0.03;
    const SEATED_POSE_DAMP_RATE = 14;
    const SEATED_DEG = Math.PI / 180;
    function quatFromDownDir(dir) {
      const down = new THREE.Vector3(0, -1, 0);
      if (!Number.isFinite(dir.x) || !Number.isFinite(dir.y) || !Number.isFinite(dir.z) || dir.lengthSq() < 1e-12) return new THREE.Quaternion();
      return new THREE.Quaternion().setFromUnitVectors(down, dir.clone().normalize());
    }
    // Faithful port of the authoring tool's solveSurfaceFlushSeatedLeg: the
    // thigh is projected flush against the seat's own surface plane (not
    // aimed at a live foot target at all) so it visually rests along the
    // seat, and the calf is a simple two-state rule off the knee —
    // continues collinear with the thigh while the knee still projects
    // over the seat's own footprint (only matters for unusually deep
    // seats), otherwise drops exactly 90 degrees opposite the surface
    // normal, i.e. straight down toward the floor. hipSeed/planePoint/
    // normal/forward are all in the leg-rig root's own local space.
    function solveSeatedLegSurfaceFlush(hipSeed, boneLength, planePoint, normal, forward, footprintHalfDepth) {
      const delta = hipSeed.clone().sub(planePoint);
      const signedDistance = delta.dot(normal);
      const hip = hipSeed.clone().addScaledVector(normal, -signedDistance + SEATED_THIGH_SURFACE_CLEARANCE);
      const thighDirection = forward.clone().normalize();
      const knee = hip.clone().addScaledVector(thighDirection, boneLength);
      const kneeForwardOffset = knee.clone().sub(planePoint).dot(forward);
      const kneeOverSeat = kneeForwardOffset <= footprintHalfDepth + SEATED_KNEE_EDGE_TOLERANCE;
      const calfDirection = (kneeOverSeat ? thighDirection : normal.clone().negate()).normalize();
      const thighQuaternion = quatFromDownDir(thighDirection);
      const calfWorldQuaternion = quatFromDownDir(calfDirection);
      const calfLocalQuaternion = thighQuaternion.clone().invert().multiply(calfWorldQuaternion);
      // Same metric as the tool's own thighSurfaceDistance: perpendicular
      // gap from the thigh segment's own midpoint to the seat plane —
      // should read as ~clearance-only (a few thousandths) whenever the
      // hip seed is already near the seat, exactly like the tool's.
      const thighMidpoint = hip.clone().add(knee).multiplyScalar(0.5);
      const thighSurfaceGap = thighMidpoint.sub(planePoint).dot(normal);
      return {
        hip, thighQuaternion, calfLocalQuaternion,
        thighLength: boneLength, calfLength: boneLength,
        calfStraight: kneeOverSeat, kneeForwardOffset, footprintHalfDepth, thighSurfaceGap,
      };
    }
    // last resolved seated-pose diagnostics (see getSeatedPoseDebug on the
    // returned handle) — a plain-data mirror of the furniture-avatar-author
    // tool's own seatDiagnosticSnapshot/surfaceLegPose readout, kept here so
    // docs/game.js's Pixel Probe can report the exact numbers this leg
    // chain actually solved, comparable field-for-field against what the
    // tool would show for the same species/gender/chair combo. Cleared
    // whenever this avatar isn't seated so a stale reading never survives
    // into an unrelated probe.
    let lastSeatedPoseDebug = null;
    function applySeatedPose(side, seatFrame, dt) {
      const mesh = state[side];
      const chain = legChains[side];
      if (!mesh || !chain) return;
      const contactY = side === 'left' ? state.leftContactY : state.rightContactY;
      const standingPosteriorY = chain.hip.position.y;
      // Anatomy belongs to the character, not the chair. This exactly
      // mirrors furniture-avatar-author's seatedAnatomicalLegMetrics:
      // posterior -> foot contact determines the fixed full leg length once,
      // while moving the avatar root aligns that posterior with whatever
      // seat height is being used. A chair must never shorten or lengthen
      // the femur/calf just because its surface is lower or higher.
      const fullLegLength = Math.max(0.001, standingPosteriorY - contactY);
      const boneLength = fullLegLength * 0.5;
      const hipSeed = chain.hip.position.clone();
      const solved = solveSeatedLegSurfaceFlush(
        hipSeed, boneLength, seatFrame.planePoint, seatFrame.normal, seatFrame.forward, seatFrame.footprintHalfDepth
      );
      // chain.thigh is parented under the fixed anatomical hip. The solved
      // surface projection only contributes the tiny correction required to
      // place the thigh flush on the seat plane; whole-avatar seat height is
      // already handled by the caller's posterior-to-seat root transform.
      const hipOffset = solved.hip.clone().sub(chain.hip.position);
      const slerpT = 1 - Math.exp(-SEATED_POSE_DAMP_RATE * Math.max(0, dt));
      chain.thigh.position.x = damp(chain.thigh.position.x, hipOffset.x, SEATED_POSE_DAMP_RATE, dt);
      chain.thigh.position.y = damp(chain.thigh.position.y, hipOffset.y, SEATED_POSE_DAMP_RATE, dt);
      chain.thigh.position.z = damp(chain.thigh.position.z, hipOffset.z, SEATED_POSE_DAMP_RATE, dt);
      chain.thigh.quaternion.slerp(solved.thighQuaternion, slerpT);
      chain.calf.position.set(0, -solved.thighLength, 0);
      chain.calf.quaternion.slerp(solved.calfLocalQuaternion, slerpT);
      mesh.position.set(0, -solved.calfLength, 0);
      state[`${side}Roll`] = damp(state[`${side}Roll`], 0, SEATED_POSE_DAMP_RATE, dt);
      mesh.rotation.x = state[`${side}Roll`];
      applyBoneGuideTransforms(chain, solved.thighLength, solved.calfLength);
      if (!lastSeatedPoseDebug) lastSeatedPoseDebug = {};
      lastSeatedPoseDebug[side] = {
        thighLength: solved.thighLength, calfLength: solved.calfLength, fullLegLength,
        posteriorHeight: standingPosteriorY, footContactY: contactY,
        thighSurfaceGap: solved.thighSurfaceGap,
        calfStraight: solved.calfStraight, calfForced90: !solved.calfStraight,
        kneeOverSeat: solved.calfStraight, kneeForwardOffset: solved.kneeForwardOffset,
        footprintHalfDepth: solved.footprintHalfDepth, hipX: chain.hip.position.x,
      };
    }
    // seatedPose (see applySeatedPose's comment above): plain data describing
    // the furniture's authored seat. The caller has already translated the
    // avatar root so its posterior lies on that seat in world space, so the
    // leg solver's plane point is the posterior's own avatar-local position.
    // Pitch/roll and footprint depth still come from the authored seat.
    function update(dt, speedWorldUnitsPerSecond, suppressed, seatedPose) {
      if (state.disposed) return;
      if (seatedPose) {
        state.gaitStrength = damp(state.gaitStrength, 0, 12, dt);
        const pitchRad = (Number(seatedPose.normalDeg?.x) || 0) * SEATED_DEG;
        const rollRad = (Number(seatedPose.normalDeg?.z) || 0) * SEATED_DEG;
        const tiltEuler = new THREE.Euler(pitchRad, 0, rollRad, 'XYZ');
        const seatFrame = {
          planePoint: new THREE.Vector3(posteriorX, posteriorY, 0),
          normal: new THREE.Vector3(0, 1, 0).applyEuler(tiltEuler),
          forward: new THREE.Vector3(0, 0, 1).applyEuler(tiltEuler),
          footprintHalfDepth: Number.isFinite(seatedPose.footprintHalfDepth) ? seatedPose.footprintHalfDepth : 0.4,
        };
        applySeatedPose('left', seatFrame, dt);
        applySeatedPose('right', seatFrame, dt);
        return;
      }
      lastSeatedPoseDebug = null;
      legChains.left.thigh.position.set(0, 0, 0);
      legChains.right.thigh.position.set(0, 0, 0);
      if (suppressed) {
        // No meaningful "standing on the ground" gait while e.g. seated on a
        // mount or mid-harvest — legs stay visible and just hang straight
        // down from their own hip anchors instead. Each hip's X already IS
        // its leg's idle stance X (see buildLegChain), so feeding applyPose
        // the same neutral/idle pose it uses for a stationary leg produces
        // exactly that straight-down hang, with no separate math needed.
        state.gaitStrength = damp(state.gaitStrength, 0, 12, dt);
        const neutralPose = { travel: 0, lift: 0, planted: true };
        applyPose('left', state.leftContactY, state.idleLeftX, neutralPose, 11, dt);
        applyPose('right', state.rightContactY, state.idleRightX, neutralPose, 11, dt);
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
      applyPose('left', state.leftContactY, state.idleLeftX, leftPose, response, dt);
      applyPose('right', state.rightContactY, state.idleRightX, rightPose, response, dt);
    }

    function dispose() {
      if (state.disposed) return;
      state.disposed = true;
      parent.remove(root);
      disposeObjectResources(root);
    }

    // Writes an already-solved leg pose straight onto this side's thigh/calf
    // chain and foot mesh, bypassing solveTwoBoneLeg entirely — for
    // docs/js/combat/impact-ragdoll-playback.js, which samples pre-recorded
    // impact/ragdoll clips (docs/tools/procedural-animation-editor/index.html
    // exports) whose frames already carry each leg's thighQuaternion/
    // calfLocalQuaternion/upperLength/lowerLength in this exact shape (see
    // that tool's own IK solve, which this mirrors). Quaternions are plain
    // {x,y,z,w}; lengths are the same "distance along local -Y" convention
    // applyLegChain uses for chain.calf.position/mesh.position above, so a
    // recorded pose composites into this rig with zero remapping. Caller
    // owns interpolation between clip frames — this only ever applies one
    // already-resolved instant.
    function applyRecordedLegPose(side, record) {
      const mesh = state[side];
      const chain = legChains[side];
      if (!mesh || !chain || !record) return;
      const upperLength = Number(record.upperLength) || 0;
      const lowerLength = Number(record.lowerLength) || 0;
      chain.thigh.quaternion.set(record.thighQuaternion.x, record.thighQuaternion.y, record.thighQuaternion.z, record.thighQuaternion.w);
      chain.calf.position.set(0, -upperLength, 0);
      chain.calf.quaternion.set(record.calfLocalQuaternion.x, record.calfLocalQuaternion.y, record.calfLocalQuaternion.z, record.calfLocalQuaternion.w);
      mesh.position.set(0, -lowerLength, 0);
      mesh.rotation.x = Number(record.roll) || 0;
      applyBoneGuideTransforms(chain, upperLength, lowerLength);
    }

    return {
      group: root, update, dispose, applyRecordedLegPose,
      standingPosteriorY: posteriorY, // Used by NPC chair stations to lower the whole avatar onto the authored seat.
      getSeatedPoseDebug: () => lastSeatedPoseDebug,
    };
  }

  window.ProceduralLegAnimation = {
    attach,
    setShowBones: (visible) => { showLegBoneGuides = !!visible; },
    get showBones() { return showLegBoneGuides; },
  };
})();
