// Enchanted weapon metal-region particle presentation.
//
// Particles originate only from pixels selected by the same source-key HSV
// test used by tool-metal-recolor.js for verdigris. The held PNG weapon plane
// owns the emitters, so Neutral/Windup/Strike transforms, end flips, ranged
// ready poses, and dual-wield duplicates carry the effect automatically.
(() => {
  'use strict';
  if (window.WeaponEnchantmentVFX) return;

  const SOURCE_HEX = '#5A8480'; // Verdigris source key reused by buildMetalMask() to identify authored metal pixels.
  const SOURCE_HUE_TOL_DEG = 22; // Verdigris-compatible hue tolerance used by buildMetalMask().
  const SOURCE_SAT_TOL = 0.22; // Verdigris-compatible saturation tolerance used by buildMetalMask().
  const SOURCE_ALPHA_MIN = 4; // Verdigris-compatible alpha floor used by buildMetalMask().
  const SCAN_INTERVAL_MS = 180; // Used by update() to avoid traversing held-weapon state every render frame.
  const MAX_PARTICLES_PER_PLANE = 24; // Used by spawnParticle() to cap draw-call growth, including dual-wield copies.
  const LICH_VARIANTS = Object.freeze(['pure', 'muted', 'dusty', 'dark_muted']); // Used by lichDyeIds() to mirror combat-lich.js wardrobe possibilities.
  const FALLBACK_VISUALS = {}; // Used only in isolated tools/tests where a live gear inventory is unavailable.
  const MASK_CACHE = new Map(); // Used by metalMaskForSprite() so each source PNG is decoded/scanned once per page load.
  const SHAPE_TEXTURE_CACHE = new Map(); // Used by shapeTexture() to share one white alpha sprite texture per particle silhouette.
  const EMITTERS = new Map(); // Used by updateEmitters() to retain pooled particles for each currently visible weapon plane.

  let lastScanAt = -Infinity; // Used by update() to throttle held-plane/config resolution.
  let activeSnapshot = null; // Used by updateEmitters()/debugSnapshot() as the latest resolved weapon + planar visual state.
  let loadoutHookInstalled = false; // Used by installLoadoutHook() to wrap CombatLoadoutUI.render exactly once.
  let updateLoopInstalled = false; // Used by installUpdateLoop() to avoid duplicate scheduler/RAF registration.
  let lastEvent = 'idle'; // Used by debugSnapshot() and the in-menu diagnostics without browser devtools.

  function lichDyeIds(hues, neutrals = []) {
    const ids = []; // Used as the complete enchantment color picker for one planar family.
    for (const variant of LICH_VARIANTS) for (const hue of hues) ids.push(`dye:CLOTH:${variant}_${hue}`);
    return Object.freeze(ids.concat(neutrals));
  }

  const ALIGNMENTS = Object.freeze({
    Tothal: Object.freeze({
      id: 'Tothal', label: 'Tothal · Motion / Blizzard', opacity: 0.78,
      dyeIds: lichDyeIds(['green_blue', 'blue', 'blue_indigo']),
      effects: Object.freeze([
        Object.freeze({ id: 'blizzard-orb', label: 'Blizzard Orbs', motion: 'swirl', shape: 'orb', blend: 'additive', size: 0.052, life: 1.05, speed: 0.045 }),
        Object.freeze({ id: 'wind-streak', label: 'Crosswind Streaks', motion: 'crosswind', shape: 'streak', blend: 'additive', size: 0.055, life: 0.68, speed: 0.085 }),
        Object.freeze({ id: 'sleet-needle', label: 'Sleet Needles', motion: 'sleet', shape: 'needle', blend: 'normal', size: 0.048, life: 0.82, speed: 0.065 }),
      ]),
      lore: 'Constant motion: cold, wind, water, chaos, and change.',
    }),
    Hronal: Object.freeze({
      id: 'Hronal', label: 'Hronal · Stillness / Stone & Lava', opacity: 0.86,
      dyeIds: lichDyeIds(['red', 'red_orange', 'orange', 'yellow_orange', 'yellow']),
      effects: Object.freeze([
        Object.freeze({ id: 'lava-spit', label: 'Lava Spit', motion: 'lava', shape: 'drop', blend: 'additive', size: 0.055, life: 0.76, speed: 0.048 }),
        Object.freeze({ id: 'stone-spray', label: 'Stone Spray', motion: 'stone', shape: 'shard', blend: 'normal', size: 0.050, life: 0.92, speed: 0.052 }),
        Object.freeze({ id: 'ember-fall', label: 'Ember Fall', motion: 'ember', shape: 'ember', blend: 'additive', size: 0.044, life: 1.02, speed: 0.042 }),
      ]),
      lore: 'Utter stillness: stable earth, dead heat, flat desert, short mountains, and lava.',
    }),
    Kanthic: Object.freeze({
      id: 'Kanthic', label: 'Kanthic · Void-Nigh / Petroleum', opacity: 0.82,
      dyeIds: lichDyeIds(['indigo', 'indigo_violet', 'violet'], ['dye:CLOTH:white', 'dye:CLOTH:gray', 'dye:CLOTH:charcoal']),
      effects: Object.freeze([
        Object.freeze({ id: 'petroleum-drop', label: 'Petroleum Drops', motion: 'drip', shape: 'drop', blend: 'normal', size: 0.062, life: 1.16, speed: 0.035 }),
        Object.freeze({ id: 'tar-splash', label: 'Tar Splashes', motion: 'splash', shape: 'splash', blend: 'normal', size: 0.060, life: 0.84, speed: 0.050 }),
        Object.freeze({ id: 'goo-thread', label: 'Goo Threads', motion: 'thread', shape: 'thread', blend: 'normal', size: 0.058, life: 1.24, speed: 0.030 }),
      ]),
      lore: 'The void-nigh: oily filth, trapping pull, demonic violence, and death without release.',
    }),
    Ohthic: Object.freeze({
      id: 'Ohthic', label: 'Ohthic · Spirit World / Dead-Light', opacity: 0.38,
      dyeIds: Object.freeze([
        'dye:CLOTH:white', 'dye:CLOTH:silver',
        'dye:CLOTH:pure_green_blue', 'dye:CLOTH:muted_green_blue',
        'dye:CLOTH:pure_blue', 'dye:CLOTH:muted_blue',
        'dye:CLOTH:pure_blue_indigo', 'dye:CLOTH:muted_blue_indigo',
        'dye:CLOTH:pure_indigo_violet', 'dye:CLOTH:muted_indigo_violet',
        'dye:CLOTH:pure_violet', 'dye:CLOTH:muted_violet',
      ]),
      effects: Object.freeze([
        Object.freeze({ id: 'spirit-wisp', label: 'Spirit Wisps', motion: 'wisp', shape: 'wisp', blend: 'additive', size: 0.070, life: 1.42, speed: 0.028 }),
        Object.freeze({ id: 'dead-light-orb', label: 'Dead-Light Orbs', motion: 'orbit', shape: 'ring', blend: 'additive', size: 0.060, life: 1.30, speed: 0.024 }),
        Object.freeze({ id: 'veil-shard', label: 'Veil Shards', motion: 'veil', shape: 'veil', blend: 'normal', size: 0.058, life: 1.18, speed: 0.026 }),
      ]),
      lore: 'The spirit world: comforting to the dead, hostile to living intruders, rendered as ghostly semi-transparent color.',
    }),
  });

  function random() {
    return window.GameRandom?.random?.() ?? Math.random();
  }

  function clamp01(value) {
    const number = Number(value); // Used to normalize particle alpha/lifetime interpolation.
    return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0;
  }

  function hexToRgb(hex) {
    const clean = String(hex || '#000000').replace('#', '').trim(); // Used by buildMetalMask() for the canonical verdigris source color.
    const full = clean.length === 3 ? clean.split('').map(char => char + char).join('') : clean;
    const value = Number.parseInt(full || '000000', 16); // Used to split the packed source color into channels.
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  }

  function visualStore() {
    const gear = window.Combat?.deps?.getGearInventory?.(); // Used as the active character's persistent enchantment-VFX owner.
    if (!gear) return FALLBACK_VISUALS;
    if (!gear.weaponEnchantmentVisuals || typeof gear.weaponEnchantmentVisuals !== 'object' || Array.isArray(gear.weaponEnchantmentVisuals)) {
      gear.weaponEnchantmentVisuals = {};
    }
    return gear.weaponEnchantmentVisuals;
  }

  function planarCounts(key) {
    const counts = window.EnchantmentSystem?.planarCounts?.(key); // Used as the authoritative source of alignments actually present on this weapon.
    return counts && typeof counts === 'object'
      ? counts
      : { Tothal: 0, Hronal: 0, Kanthic: 0, Ohthic: 0 };
  }

  function activeAlignments(key) {
    const counts = planarCounts(key); // Used to constrain the visual plane picker to enchantments the weapon really has.
    return (window.EnchantmentSystem?.PLANES || Object.keys(ALIGNMENTS)).filter(plane => Number(counts[plane]) > 0 && ALIGNMENTS[plane]);
  }

  function strongestAlignment(key) {
    const counts = planarCounts(key); // Used to choose a deterministic default visual plane when multiple enchantments exist.
    const active = activeAlignments(key); // Used as the legal default candidate set.
    return active.sort((a, b) => (Number(counts[b]) || 0) - (Number(counts[a]) || 0))[0] || null;
  }

  function defaultStateForAlignment(alignment) {
    const def = ALIGNMENTS[alignment]; // Used to select the first authored dye/effect for a newly seen planar family.
    return def ? { alignment, dyeId: def.dyeIds[0], effectId: def.effects[0]?.id || '' } : null;
  }

  function normalizedState(key, raw = visualStore()[key]) {
    const active = activeAlignments(key); // Used to reject stale visual alignment choices after enchantments are removed/swapped.
    if (!active.length) return null;
    const alignment = active.includes(raw?.alignment) ? raw.alignment : strongestAlignment(key);
    const def = ALIGNMENTS[alignment]; // Used to validate the alignment-scoped color and particle selections.
    const fallback = defaultStateForAlignment(alignment); // Used when an old/malformed save lacks current visual fields.
    const dyeId = def.dyeIds.includes(raw?.dyeId) ? raw.dyeId : fallback.dyeId;
    const effectId = def.effects.some(effect => effect.id === raw?.effectId) ? raw.effectId : fallback.effectId;
    return { alignment, dyeId, effectId };
  }

  function stateFor(key = window.Combat?.deps?.currentWeaponKey?.() || 'none') {
    return normalizedState(key);
  }

  function setChoice(key, field, value) {
    const current = normalizedState(key); // Used as the validated base state for a single player-authored visual mutation.
    if (!current || !['alignment', 'dyeId', 'effectId'].includes(field)) return false;
    let next = { ...current, [field]: value }; // Used as the candidate persistent visual state before alignment-specific normalization.
    if (field === 'alignment') {
      if (!activeAlignments(key).includes(value)) return false;
      next = defaultStateForAlignment(value);
    }
    const def = ALIGNMENTS[next.alignment]; // Used to keep dye/effect selections within the chosen plane's authored vocabulary.
    if (!def || !def.dyeIds.includes(next.dyeId) || !def.effects.some(effect => effect.id === next.effectId)) return false;
    visualStore()[key] = next;
    window.Combat?.deps?.saveGearInventory?.();
    lastEvent = `saved ${key}: ${next.alignment}/${next.dyeId}/${next.effectId}`;
    activeSnapshot = null;
    return true;
  }

  function dyeEntry(dyeId) {
    return window.DyeSystem?.getById?.(dyeId)
      || window.SCRATCHBONES_CONFIG?.game?.dyes?.catalog?.find?.(entry => entry.id === dyeId)
      || null;
  }

  function dyeHex(dyeId) {
    return dyeEntry(dyeId)?.hex || '#D7E8FF';
  }

  function dyeLabel(dyeId) {
    return dyeEntry(dyeId)?.label || String(dyeId || '').replace(/^dye:CLOTH:/, '').replaceAll('_', ' ');
  }

  function buildMetalMask(imageData) {
    const colorFill = window.ColorFill; // Used to deliberately share verdigris's canonical HSV conversion + hue-distance math.
    if (!colorFill?.rgbToHsv || !colorFill?.hueDistance) return null;
    const sourceHsv = colorFill.rgbToHsv(...hexToRgb(SOURCE_HEX)); // Used as the exact authored placeholder-metal reference.
    const data = imageData.data; // Used to scan opaque source pixels once.
    const matches = []; // Used as compact pixel indices sampled uniformly by each emitter.
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < SOURCE_ALPHA_MIN) continue;
      const hsv = colorFill.rgbToHsv(data[i], data[i + 1], data[i + 2]); // Used to compare this pixel with the verdigris source key.
      if (colorFill.hueDistance(hsv.h, sourceHsv.h) > SOURCE_HUE_TOL_DEG) continue;
      if (Math.abs(hsv.s - sourceHsv.s) > SOURCE_SAT_TOL) continue;
      matches.push(i >> 2);
    }
    return {
      width: imageData.width,
      height: imageData.height,
      indices: Uint32Array.from(matches),
      matchedMetalPixels: matches.length,
    };
  }

  function resolveSpriteUrl(spritePath) {
    try { return new URL(spritePath, document.baseURI).href; } catch (_) { return spritePath; }
  }

  function metalMaskForSprite(spritePath) {
    if (!spritePath || typeof Image === 'undefined' || typeof document === 'undefined') return Promise.resolve(null);
    const url = resolveSpriteUrl(spritePath); // Used as the stable per-source cache key and image URL.
    if (MASK_CACHE.has(url)) return MASK_CACHE.get(url);
    const promise = new Promise(resolve => {
      const image = new Image(); // Used to read the untouched authored PNG, not the already metal-recolored live texture.
      image.crossOrigin = 'anonymous';
      image.onload = () => {
        try {
          const width = image.naturalWidth || image.width; // Used to preserve the sprite's exact pixel-to-plane coordinate system.
          const height = image.naturalHeight || image.height; // Used with width for exact mask mapping.
          const canvas = document.createElement('canvas'); // Used only as an offscreen pixel-read surface for this one cached mask.
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext('2d', { willReadFrequently: true }); // Used to retrieve authored source RGBA values.
          context.drawImage(image, 0, 0, width, height);
          const mask = buildMetalMask(context.getImageData(0, 0, width, height)); // Used by emitters as the only legal spawn region.
          resolve(mask);
        } catch (error) {
          lastEvent = `mask failed: ${error?.message || error}`;
          resolve(null);
        }
      };
      image.onerror = () => {
        lastEvent = `mask image failed: ${spritePath}`;
        resolve(null);
      };
      image.src = url;
    });
    MASK_CACHE.set(url, promise);
    return promise;
  }

  function sourceSpriteForWeapon(key) {
    const defs = window.Combat?.deps?.TOOL_ITEM_DEFS; // Used as the same literal weapon definition source makeToolPlaneMesh consumes.
    return defs?.[key]?.sprite || defs?.[key]?.baseSprite || null;
  }

  function directHeldVisual(key) {
    const handDeps = window.ProceduralHandAttachments?.gameDeps; // Used to reach the exact live equipment mesh map already shared by hand/dual-wield runtime.
    const runtimeState = window.WeaponToolStances?.getRuntimeState?.() || window.WeaponToolStances?.debugSnapshot?.() || null; // Used to identify the active held slot without assuming 'weapon'.
    const activeSlot = runtimeState?.activeSlot || handDeps?.getActiveTool?.() || null; // Used as the first toolMeshMap lookup key.
    const meshMap = handDeps?.toolMeshMap; // Used to resolve the exact live makeToolPlaneMesh group instead of guessing from scene names.
    let visual = activeSlot && (meshMap?.get?.(activeSlot) || meshMap?.[activeSlot]); // Used as the normal player-held visual.
    if (visual?.userData?.itemKey === key && visual?.userData?.toolPlane) return visual;
    const candidates = meshMap instanceof Map ? [...meshMap.values()] : Object.values(meshMap || {}); // Used as an equipment-slot fallback if the active-slot snapshot lags one frame.
    visual = candidates.find(candidate => candidate?.userData?.itemKey === key && candidate?.userData?.toolPlane) || null;
    return visual;
  }

  function sceneHeldVisual(key) {
    const scene = window.Combat?.deps?.getActiveScene?.() || window.GridTileAccessors?.getActiveScene?.(); // Used only when the shared hand dependency map is unavailable.
    if (!scene?.traverse) return null;
    const player = window.Combat?.deps?.player; // Used to prefer the matching weapon nearest the player if an enemy happens to carry the same item key.
    const scratch = typeof THREE !== 'undefined' ? new THREE.Vector3() : null; // Used to score fallback scene candidates in world space without per-node allocation.
    let best = null; // Used as the nearest valid player-held weapon candidate.
    let bestDistance = Infinity; // Used to rank same-item candidates during fallback traversal.
    scene.traverse(node => {
      if (node?.userData?.itemKey !== key || !node?.userData?.toolPlane?.isObject3D) return;
      let distance = 0; // Used as a player-proximity tie breaker; direct handDeps lookup normally avoids this path entirely.
      if (scratch && Number.isFinite(Number(player?.x)) && Number.isFinite(Number(player?.y)) && node.getWorldPosition) {
        node.getWorldPosition(scratch);
        distance = Math.hypot(scratch.x - Number(player.x), scratch.z - Number(player.y));
      }
      if (!best || distance < bestDistance) { best = node; bestDistance = distance; }
    });
    return best;
  }

  function heldVisualForWeapon(key) {
    return directHeldVisual(key) || sceneHeldVisual(key);
  }

  function particlePlanesForVisual(visual) {
    const plane = visual?.userData?.toolPlane; // Used as the authored single-weapon plane and the root containing dual-wield duplicates.
    if (!plane?.isObject3D) return [];
    const dual = window.HobunjiDualWieldWeaponVisuals?.debugSnapshot?.(); // Used to avoid emitting around the hidden midpoint plane while dual wield is visually active.
    if (!dual?.active) return [plane];
    const duplicates = []; // Used as the visible main/offhand blade planes when the original source material is hidden.
    plane.traverse?.(node => {
      if (node?.userData?.hobunjiDualWieldDuplicate === true) duplicates.push(node);
    });
    return duplicates.length ? duplicates : [plane];
  }

  function geometrySize(plane) {
    const geometry = plane?.geometry; // Used to convert source-PNG normalized coordinates to this literal rendered plane's local coordinates.
    const width = Number(geometry?.parameters?.width);
    const height = Number(geometry?.parameters?.height);
    if (width > 0 && height > 0) return { width, height };
    geometry?.computeBoundingBox?.();
    const box = geometry?.boundingBox; // Used as a fallback for cloned/custom plane geometry lacking constructor parameters.
    return box ? { width: Math.max(0.001, box.max.x - box.min.x), height: Math.max(0.001, box.max.y - box.min.y) } : { width: 0.5, height: 0.5 };
  }

  function drawShape(context, shape) {
    context.clearRect(0, 0, 64, 64);
    context.save();
    context.translate(32, 32);
    context.fillStyle = '#ffffff';
    context.strokeStyle = '#ffffff';
    context.lineCap = 'round';
    context.lineJoin = 'round';
    if (shape === 'orb') {
      const gradient = context.createRadialGradient(0, 0, 2, 0, 0, 23); // Used to make Tothal's slow blizzard mote read as a hazy orb.
      gradient.addColorStop(0, 'rgba(255,255,255,1)'); gradient.addColorStop(0.45, 'rgba(255,255,255,.72)'); gradient.addColorStop(1, 'rgba(255,255,255,0)');
      context.fillStyle = gradient; context.beginPath(); context.arc(0, 0, 24, 0, Math.PI * 2); context.fill();
      context.lineWidth = 3; for (let i = 0; i < 3; i++) { context.rotate(Math.PI / 3); context.beginPath(); context.moveTo(-15, 0); context.lineTo(15, 0); context.stroke(); }
    } else if (shape === 'streak') {
      const gradient = context.createLinearGradient(-28, 0, 28, 0); // Used to taper the crosswind streak's tail.
      gradient.addColorStop(0, 'rgba(255,255,255,0)'); gradient.addColorStop(.58, 'rgba(255,255,255,.6)'); gradient.addColorStop(1, 'rgba(255,255,255,1)');
      context.strokeStyle = gradient; context.lineWidth = 8; context.beginPath(); context.moveTo(-27, 6); context.bezierCurveTo(-8, -8, 10, 8, 27, -5); context.stroke();
    } else if (shape === 'needle') {
      context.beginPath(); context.moveTo(0, -27); context.lineTo(6, 12); context.lineTo(0, 27); context.lineTo(-6, 12); context.closePath(); context.fill();
    } else if (shape === 'drop') {
      context.beginPath(); context.moveTo(0, -27); context.bezierCurveTo(19, -6, 19, 14, 0, 25); context.bezierCurveTo(-19, 14, -19, -6, 0, -27); context.fill();
    } else if (shape === 'shard') {
      context.beginPath(); context.moveTo(-17, 19); context.lineTo(-5, -27); context.lineTo(21, 7); context.lineTo(8, 25); context.closePath(); context.fill();
    } else if (shape === 'ember') {
      context.beginPath(); context.moveTo(0, -26); context.lineTo(13, -4); context.lineTo(5, 24); context.lineTo(-13, 7); context.closePath(); context.fill();
    } else if (shape === 'splash') {
      context.beginPath(); context.arc(-4, 4, 15, 0, Math.PI * 2); context.fill();
      for (const [x, y, r] of [[17, -14, 6], [21, 10, 4], [-18, -16, 5]]) { context.beginPath(); context.arc(x, y, r, 0, Math.PI * 2); context.fill(); }
    } else if (shape === 'thread') {
      context.lineWidth = 9; context.beginPath(); context.moveTo(-7, -28); context.bezierCurveTo(10, -10, -12, 7, 7, 28); context.stroke();
    } else if (shape === 'wisp') {
      const gradient = context.createLinearGradient(0, -28, 0, 28); // Used to make Ohthic wisps transparent at both ends instead of sprite-like solids.
      gradient.addColorStop(0, 'rgba(255,255,255,0)'); gradient.addColorStop(.42, 'rgba(255,255,255,.85)'); gradient.addColorStop(1, 'rgba(255,255,255,0)');
      context.strokeStyle = gradient; context.lineWidth = 10; context.beginPath(); context.moveTo(-12, 27); context.bezierCurveTo(19, 10, -17, -4, 12, -28); context.stroke();
    } else if (shape === 'ring') {
      const gradient = context.createRadialGradient(0, 0, 8, 0, 0, 24); // Used to create ghostly hollow dead-light rather than an opaque bead.
      gradient.addColorStop(.38, 'rgba(255,255,255,0)'); gradient.addColorStop(.68, 'rgba(255,255,255,.9)'); gradient.addColorStop(1, 'rgba(255,255,255,0)');
      context.fillStyle = gradient; context.beginPath(); context.arc(0, 0, 25, 0, Math.PI * 2); context.fill();
    } else if (shape === 'veil') {
      context.globalAlpha = 0.72; context.beginPath(); context.moveTo(-7, -28); context.lineTo(18, -7); context.lineTo(6, 28); context.lineTo(-18, 7); context.closePath(); context.fill();
    }
    context.restore();
  }

  function shapeTexture(effect) {
    const key = effect?.shape || 'orb'; // Used as the shared alpha-texture cache key across all color variants.
    if (SHAPE_TEXTURE_CACHE.has(key)) return SHAPE_TEXTURE_CACHE.get(key);
    if (typeof THREE === 'undefined' || typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas'); // Used as the tiny procedural white-alpha sprite source for this silhouette.
    canvas.width = 64; canvas.height = 64;
    const context = canvas.getContext('2d'); // Used by drawShape() to author the selected attack-inspired silhouette.
    drawShape(context, key);
    const texture = new THREE.CanvasTexture(canvas); // Used by every particle of this silhouette; material color supplies the chosen lich dye.
    texture.needsUpdate = true;
    SHAPE_TEXTURE_CACHE.set(key, texture);
    return texture;
  }

  function disposeParticle(particle) {
    particle?.sprite?.parent?.remove?.(particle.sprite);
    particle?.sprite?.material?.dispose?.();
  }

  function clearEmitter(emitter) {
    for (const particle of emitter?.particles || []) disposeParticle(particle);
    if (emitter) emitter.particles.length = 0;
  }

  function disposeEmitter(emitter) {
    if (!emitter) return;
    clearEmitter(emitter);
    emitter.group?.parent?.remove?.(emitter.group);
  }

  function makeEmitter(plane) {
    if (typeof THREE === 'undefined' || !plane?.add) return null;
    const group = new THREE.Group(); // Used as the plane-local owner for all transient particles on this exact visible weapon copy.
    group.name = 'weapon_enchantment_metal_particles';
    group.userData.weaponEnchantmentVfx = true;
    group.position.z = 0.012;
    plane.add(group);
    return { plane, group, particles: [], accumulator: 0, token: '', lastTime: performance.now() };
  }

  function styleFor(state) {
    const def = ALIGNMENTS[state?.alignment]; // Used to resolve the chosen plane-specific particle vocabulary.
    return def?.effects?.find(effect => effect.id === state?.effectId) || def?.effects?.[0] || null;
  }

  function spawnParticle(emitter, mask, snapshot) {
    if (!emitter || !mask?.indices?.length || emitter.particles.length >= MAX_PARTICLES_PER_PLANE || typeof THREE === 'undefined') return;
    const state = snapshot.visual; // Used to resolve player-selected plane/color/effect for this spawn.
    const alignment = ALIGNMENTS[state.alignment]; // Used for plane-wide opacity/thematic behavior.
    const effect = styleFor(state); // Used for motion, silhouette, blend, size, and lifetime.
    if (!alignment || !effect) return;
    const texture = shapeTexture(effect); // Used as the white-alpha attack-inspired particle silhouette.
    if (!texture) return;
    const material = new THREE.SpriteMaterial({
      map: texture,
      color: dyeHex(state.dyeId),
      transparent: true,
      opacity: alignment.opacity,
      depthWrite: false,
      blending: effect.blend === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending,
    }); // Per-particle material is intentionally owned because opacity is animated independently.
    const sprite = new THREE.Sprite(material); // Used as a camera-legible mote whose position still follows the weapon's local plane transform.
    sprite.name = `weapon_enchantment_${effect.id}`;
    sprite.renderOrder = Number(emitter.plane.renderOrder || 0) + 4;

    const index = mask.indices[Math.floor(random() * mask.indices.length)]; // Used to choose one exact verdigris-qualified metal pixel uniformly.
    const px = index % mask.width; // Used to map the selected source pixel into plane-local X.
    const py = Math.floor(index / mask.width); // Used to map the selected source pixel into plane-local Y.
    const size = geometrySize(emitter.plane); // Used so effects scale with the actual rendered weapon plane, not with source PNG dimensions.
    const baseX = ((px + 0.5) / mask.width - 0.5) * size.width; // Spawn X on the authored metal pixel.
    const baseY = (0.5 - (py + 0.5) / mask.height) * size.height; // Spawn Y on the authored metal pixel.
    const particleSize = Math.max(0.008, Math.min(size.width, size.height) * effect.size * (0.76 + random() * 0.55)); // Used as a bounded local sprite size with slight natural variation.
    sprite.position.set(baseX, baseY, 0.004 + random() * 0.015);
    sprite.scale.set(particleSize, particleSize, 1);
    emitter.group.add(sprite);

    const angle = random() * Math.PI * 2; // Used by radial/swirling plane-local motion families.
    const speed = effect.speed * Math.max(size.width, size.height) * (0.65 + random() * 0.7); // Used as weapon-scale-relative particle drift.
    emitter.particles.push({
      sprite,
      age: 0,
      life: effect.life * (0.78 + random() * 0.48),
      baseX,
      baseY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      speed,
      phase: random() * Math.PI * 2,
      spin: (random() - 0.5) * 5,
      baseSize: particleSize,
      effectId: effect.id,
      motion: effect.motion,
      maxOpacity: alignment.opacity * (0.72 + random() * 0.28),
    });
  }

  function updateParticle(particle, dt) {
    particle.age += dt;
    const t = clamp01(particle.age / particle.life); // Used by every motion family for fade/scale curves.
    if (t >= 1) return false;
    const sprite = particle.sprite; // Used as the live plane-local particle transform/material.
    const wave = Math.sin(particle.phase + particle.age * 8); // Used by wind/wisp/thread motion to avoid straight-line synthetic drift.
    let x = particle.baseX;
    let y = particle.baseY;
    if (particle.motion === 'swirl') {
      x += particle.vx * particle.age + wave * particle.speed * 0.55;
      y += particle.vy * particle.age + Math.cos(particle.phase + particle.age * 7) * particle.speed * 0.45;
    } else if (particle.motion === 'crosswind') {
      x += (particle.vx >= 0 ? 1 : -1) * particle.speed * particle.age * 1.55;
      y += wave * particle.speed * 0.22;
    } else if (particle.motion === 'sleet') {
      x += particle.vx * particle.age * 0.35;
      y -= Math.abs(particle.speed) * particle.age * 1.15;
    } else if (particle.motion === 'lava') {
      x += particle.vx * particle.age * 0.5;
      y += particle.speed * particle.age * (0.9 - 1.55 * t);
    } else if (particle.motion === 'stone') {
      x += particle.vx * particle.age;
      y += particle.vy * particle.age - particle.speed * particle.age * particle.age * 0.9;
    } else if (particle.motion === 'ember') {
      x += wave * particle.speed * 0.24;
      y += particle.speed * particle.age * 0.85;
    } else if (particle.motion === 'drip') {
      x += wave * particle.speed * 0.08;
      y -= particle.speed * particle.age * (0.35 + t);
    } else if (particle.motion === 'splash') {
      x += particle.vx * particle.age * 0.85;
      y += particle.vy * particle.age * 0.85;
    } else if (particle.motion === 'thread') {
      x += wave * particle.speed * 0.18;
      y -= particle.speed * particle.age * 0.48;
    } else if (particle.motion === 'wisp') {
      x += wave * particle.speed * 0.36;
      y += particle.speed * particle.age * 0.55;
    } else if (particle.motion === 'orbit') {
      const radius = particle.speed * particle.age * 0.7; // Used to make dead-light circle away from its source metal pixel before fading.
      x += Math.cos(particle.phase + particle.age * 5) * radius;
      y += Math.sin(particle.phase + particle.age * 5) * radius;
    } else if (particle.motion === 'veil') {
      x += wave * particle.speed * 0.16;
      y += particle.speed * particle.age * 0.30;
    }
    sprite.position.x = x;
    sprite.position.y = y;
    sprite.material.opacity = particle.maxOpacity * Math.sin(Math.PI * t); // Smooth birth/death fade prevents popping against the weapon edge.
    const scalePulse = 0.78 + 0.36 * Math.sin(Math.PI * t); // Used to make particles bloom slightly away from the metal source.
    sprite.scale.set(particle.baseSize * scalePulse, particle.baseSize * scalePulse, 1);
    sprite.material.rotation = particle.phase + particle.spin * particle.age;
    return true;
  }

  function reconcileEmitters(planes, snapshot) {
    const wanted = new Set(planes); // Used to remove emitters from old equipment/dual-wield planes immediately.
    for (const [plane, emitter] of [...EMITTERS]) {
      if (wanted.has(plane) && plane?.parent) continue;
      disposeEmitter(emitter);
      EMITTERS.delete(plane);
    }
    for (const plane of wanted) {
      if (!EMITTERS.has(plane)) {
        const emitter = makeEmitter(plane); // Used as the persistent particle pool for this visible blade copy.
        if (emitter) EMITTERS.set(plane, emitter);
      }
    }
    const token = `${snapshot.weaponKey}|${snapshot.visual.alignment}|${snapshot.visual.dyeId}|${snapshot.visual.effectId}|${snapshot.spritePath}`; // Used to flush particles when the user changes visual configuration.
    for (const emitter of EMITTERS.values()) {
      if (emitter.token === token) continue;
      clearEmitter(emitter);
      emitter.accumulator = 0;
      emitter.token = token;
    }
  }

  function updateEmitters(dt, snapshot) {
    if (!snapshot?.mask?.indices?.length) return;
    const effect = styleFor(snapshot.visual); // Used to ensure a malformed state cannot emit.
    if (!effect) return;
    const totalEnchantments = Object.values(snapshot.counts || {}).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0); // Used to make multiply-enchanted weapons a little denser without changing style.
    const emissionPerSecond = Math.min(18, 7 + totalEnchantments * 2.5); // Used as the bounded spawn cadence per visible blade plane.
    for (const emitter of EMITTERS.values()) {
      for (let index = emitter.particles.length - 1; index >= 0; index--) {
        const particle = emitter.particles[index]; // Used as the current pooled particle advanced this frame.
        if (updateParticle(particle, dt)) continue;
        disposeParticle(particle);
        emitter.particles.splice(index, 1);
      }
      emitter.accumulator += dt * emissionPerSecond;
      while (emitter.accumulator >= 1 && emitter.particles.length < MAX_PARTICLES_PER_PLANE) {
        emitter.accumulator -= 1;
        spawnParticle(emitter, snapshot.mask, snapshot);
      }
    }
  }

  async function resolveActiveSnapshot() {
    const weaponKey = window.Combat?.deps?.currentWeaponKey?.() || 'none'; // Used as the single enchantment/save/held-visual identity for this scan.
    const visual = normalizedState(weaponKey); // Used to decide whether this weapon should emit at all and which plane vocabulary to use.
    if (!visual) return null;
    const heldVisual = heldVisualForWeapon(weaponKey); // Used as the exact makeToolPlaneMesh object carrying the rendered PNG plane.
    const spritePath = sourceSpriteForWeapon(weaponKey); // Used to scan the untouched authored PNG for verdigris-compatible metal pixels.
    if (!heldVisual?.userData?.toolPlane || !spritePath) return { weaponKey, visual, heldVisual, spritePath, mask: null, counts: planarCounts(weaponKey), planes: [] };
    const mask = await metalMaskForSprite(spritePath); // Used as the exact legal particle-origin set.
    const planes = particlePlanesForVisual(heldVisual); // Used to target one normal blade or both visible dual-wield blade copies.
    return { weaponKey, visual, heldVisual, spritePath, mask, counts: planarCounts(weaponKey), planes };
  }

  function clearAllEmitters() {
    for (const emitter of EMITTERS.values()) disposeEmitter(emitter);
    EMITTERS.clear();
  }

  function update(nowMs) {
    const now = Number.isFinite(Number(nowMs)) ? Number(nowMs) : performance.now(); // Used as scheduler/RAF-compatible wall time.
    const previous = activeSnapshot?.updatedAt ?? now; // Used to derive a bounded visual-only delta time.
    const dt = Math.min(0.05, Math.max(0, (now - previous) / 1000)); // Used to keep tab-resume gaps from launching particles far from the weapon.
    if (activeSnapshot) activeSnapshot.updatedAt = now;

    if (now - lastScanAt >= SCAN_INTERVAL_MS) {
      lastScanAt = now;
      resolveActiveSnapshot().then(snapshot => {
        if (!snapshot) {
          activeSnapshot = null;
          clearAllEmitters();
          return;
        }
        snapshot.updatedAt = performance.now();
        activeSnapshot = snapshot;
        reconcileEmitters(snapshot.planes || [], snapshot);
        lastEvent = snapshot.mask?.matchedMetalPixels
          ? `${snapshot.weaponKey}: ${snapshot.mask.matchedMetalPixels} metal px, ${snapshot.planes.length} plane(s)`
          : `${snapshot.weaponKey}: no matched metal pixels`;
      }).catch(error => { lastEvent = `scan failed: ${error?.message || error}`; });
    }

    if (activeSnapshot?.planes?.length && activeSnapshot.mask?.indices?.length) updateEmitters(dt, activeSnapshot);
  }

  function installUpdateLoop() {
    if (updateLoopInstalled) return;
    updateLoopInstalled = true;
    if (window.RuntimeFrameScheduler?.register) {
      window.RuntimeFrameScheduler.register('weapon-enchantment-vfx', update, {
        phase: 'pre-render',
        owner: 'WeaponEnchantmentVFX',
        description: 'Emits plane-aligned enchantment particles only from verdigris-detected metal pixels on the held weapon.',
      });
      return;
    }
    const frame = now => { update(now); requestAnimationFrame(frame); }; // Used as a standalone fallback in tools/pages without RuntimeFrameScheduler.
    requestAnimationFrame(frame);
  }

  function makeSelect(value, options, onChange) {
    const select = document.createElement('select'); // Used as a controller/mobile-friendly planar VFX picker consistent with the existing loadout UI.
    select.className = 'settings-select';
    for (const optionDef of options) {
      const option = document.createElement('option'); // Used as one legal alignment/dye/effect choice.
      option.value = optionDef.value;
      option.textContent = optionDef.label;
      option.selected = optionDef.value === value;
      select.appendChild(option);
    }
    select.addEventListener('change', () => onChange(select.value));
    return select;
  }

  function addControlRow(section, name, description, control) {
    const row = document.createElement('div'); // Used as one loadout-style visual-customization row.
    row.className = 'loadout-slot';
    const label = document.createElement('div'); // Used to keep name/lore text aligned with existing enchantment rows.
    label.className = 'settings-label';
    const title = document.createElement('div'); // Used as the row's player-facing setting name.
    title.className = 'settings-name';
    title.textContent = name;
    const desc = document.createElement('div'); // Used as the concise explanation beneath the setting name.
    desc.className = 'settings-desc';
    desc.textContent = description;
    label.append(title, desc);
    row.append(label, control);
    section.appendChild(row);
  }

  function renderControls(pane, key = window.Combat?.deps?.currentWeaponKey?.() || 'none') {
    if (!pane || typeof document === 'undefined') return;
    pane.querySelector('.weapon-enchantment-vfx-section')?.remove();
    const section = document.createElement('div'); // Used as the complete semi-customizable enchantment-particle panel.
    section.className = 'weapon-enchantment-vfx-section';
    section.style.cssText = 'display:flex;flex-direction:column;gap:7px;margin-top:10px;padding-top:9px;border-top:1px solid rgba(255,255,255,.14);';
    const title = document.createElement('div'); // Used as the section heading next to Enchantments & Immundanity.
    title.className = 'settings-section-title';
    title.textContent = 'Enchantment Weapon Aura';
    section.appendChild(title);

    const active = activeAlignments(key); // Used to determine whether this weapon currently has any planar visual vocabulary to configure.
    const state = normalizedState(key); // Used as the validated current picker state without creating save data just by viewing the menu.
    if (!state || !active.length) {
      const empty = document.createElement('div'); // Used to explain why no controls appear on an unenchanted weapon.
      empty.className = 'loadout-slot-combo-note';
      empty.textContent = 'No planar enchantment is active on this weapon. Particles appear only after it gains an enchantment.';
      section.appendChild(empty);
    } else {
      const alignmentDef = ALIGNMENTS[state.alignment]; // Used by color/effect rows and the spectral opacity preview.
      const alignmentSelect = makeSelect(state.alignment, active.map(alignment => ({ value: alignment, label: ALIGNMENTS[alignment].label })), value => {
        if (setChoice(key, 'alignment', value)) window.CombatLoadoutUI?.render?.();
      });
      alignmentSelect.disabled = active.length < 2;
      addControlRow(section, 'Planar appearance', alignmentDef.lore, alignmentSelect);

      const colorSelect = makeSelect(state.dyeId, alignmentDef.dyeIds.map(dyeId => ({ value: dyeId, label: dyeLabel(dyeId) })), value => {
        if (setChoice(key, 'dyeId', value)) window.CombatLoadoutUI?.render?.();
      });
      addControlRow(section, 'Particle color', state.alignment === 'Ohthic'
        ? 'Ohthic colors render deliberately ghostly and semi-transparent.'
        : 'Uses the same authored cloth-dye color possibilities as the matching lich tradition.', colorSelect);

      const effectSelect = makeSelect(state.effectId, alignmentDef.effects.map(effect => ({ value: effect.id, label: effect.label })), value => {
        if (setChoice(key, 'effectId', value)) window.CombatLoadoutUI?.render?.();
      });
      addControlRow(section, 'Particle form', 'Attack-shaped or plane-themed silhouettes; every particle still originates from the weapon’s detected metal region.', effectSelect);

      const preview = document.createElement('div'); // Used as an immediate readable color/opacity sample beneath browser-native selects.
      preview.className = 'loadout-slot-combo-note';
      const swatch = document.createElement('span'); // Used to show the exact dye hex at the plane's authored transparency.
      swatch.style.cssText = `display:inline-block;width:12px;height:12px;border-radius:50%;vertical-align:-2px;margin-right:6px;border:1px solid rgba(255,255,255,.55);background:${dyeHex(state.dyeId)};opacity:${alignmentDef.opacity};`;
      preview.append(swatch, document.createTextNode(`${alignmentDef.label} · ${styleFor(state)?.label || state.effectId} · ${Math.round(alignmentDef.opacity * 100)}% base opacity`));
      section.appendChild(preview);
    }

    const diagnostics = document.createElement('details'); // Used as mobile-accessible validation for mask/plane/config resolution without devtools.
    diagnostics.className = 'enchantment-vfx-debug';
    diagnostics.innerHTML = '<summary>Enchantment aura diagnostics</summary>';
    const pre = document.createElement('pre'); // Used to display a copyable compact runtime snapshot.
    pre.style.cssText = 'white-space:pre-wrap;font-size:10px;max-height:240px;overflow:auto;';
    pre.textContent = JSON.stringify(debugSnapshot(key), null, 2);
    diagnostics.appendChild(pre);
    section.appendChild(diagnostics);

    if (window.Combat?.deps?.isDevMode?.()) {
      const copyButton = document.createElement('button'); // Used by mobile testing to copy the same diagnostics without console access.
      copyButton.type = 'button';
      copyButton.className = 'ii-btn';
      copyButton.textContent = '[Dev] Copy Enchantment Aura Debug';
      copyButton.addEventListener('click', async () => {
        const copied = await copyDebug(key); // Used to provide visible confirmation of the clipboard attempt.
        copyButton.textContent = copied ? '[Dev] Copied Enchantment Aura Debug' : '[Dev] Copy Failed';
        setTimeout(() => { if (copyButton.isConnected) copyButton.textContent = '[Dev] Copy Enchantment Aura Debug'; }, 1200);
      });
      section.appendChild(copyButton);
    }

    const enchantmentSection = pane.querySelector('.enchantment-loadout-section'); // Used to keep visual customization directly beneath its gameplay enchantment owner.
    if (enchantmentSection?.after) enchantmentSection.after(section);
    else pane.appendChild(section);
  }

  function installLoadoutHook() {
    const ui = window.CombatLoadoutUI; // Used as the stable menu render seam because EnchantmentSystem itself is intentionally Object.freeze()'d.
    if (loadoutHookInstalled || !ui?.render) return false;
    const originalRender = ui.render.bind(ui); // Used to preserve the full existing loadout/enchantment/ranged menu before adding the VFX section.
    ui.render = (...args) => {
      const result = originalRender(...args); // Used as the existing render contract/return value.
      const pane = document.getElementById('combatLoadoutPane'); // Used as the existing loadout menu insertion surface.
      if (pane) renderControls(pane, window.Combat?.deps?.currentWeaponKey?.() || 'none');
      return result;
    };
    loadoutHookInstalled = true;
    return true;
  }

  async function copyDebug(key = window.Combat?.deps?.currentWeaponKey?.() || 'none') {
    const text = JSON.stringify(debugSnapshot(key), null, 2); // Used as the exact clipboard payload for mobile issue reports.
    try {
      if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
      const field = document.createElement('textarea'); // Used as the legacy clipboard fallback.
      field.value = text; field.style.position = 'fixed'; field.style.left = '-9999px'; document.body.appendChild(field); field.select();
      const copied = !!document.execCommand?.('copy'); // Used to report whether the fallback copy request succeeded.
      field.remove();
      return copied;
    } catch (_) { return false; }
  }

  function debugSnapshot(key = window.Combat?.deps?.currentWeaponKey?.() || 'none') {
    const state = normalizedState(key); // Used to report the effective visual choice even before the player changes defaults.
    const counts = planarCounts(key); // Used to show which enchantment alignments are authoritatively active.
    return {
      weaponKey: key,
      activeAlignments: activeAlignments(key),
      counts,
      visual: state ? { ...state, colorHex: dyeHex(state.dyeId), opacity: ALIGNMENTS[state.alignment]?.opacity ?? null } : null,
      sourceSprite: sourceSpriteForWeapon(key),
      heldVisualFound: !!heldVisualForWeapon(key),
      matchedMetalPixels: activeSnapshot?.weaponKey === key ? (activeSnapshot.mask?.matchedMetalPixels || 0) : null,
      visibleParticlePlanes: activeSnapshot?.weaponKey === key ? (activeSnapshot.planes?.length || 0) : 0,
      emitters: EMITTERS.size,
      particles: [...EMITTERS.values()].reduce((sum, emitter) => sum + emitter.particles.length, 0),
      dualWield: window.HobunjiDualWieldWeaponVisuals?.debugSnapshot?.() || null,
      metalDetection: { sourceHex: SOURCE_HEX, hueToleranceDeg: SOURCE_HUE_TOL_DEG, saturationTolerance: SOURCE_SAT_TOL, alphaMin: SOURCE_ALPHA_MIN },
      lastEvent,
    };
  }

  function bootstrap() {
    installUpdateLoop();
    if (!installLoadoutHook()) {
      const timer = setInterval(() => { // Used only during parser startup until combat-loadout-ui.js has created its public API.
        if (!installLoadoutHook()) return;
        clearInterval(timer);
        if (document.readyState !== 'loading') window.CombatLoadoutUI?.render?.();
      }, 80);
    } else if (document.readyState !== 'loading') {
      window.CombatLoadoutUI?.render?.();
    }
  }

  window.WeaponEnchantmentVFX = Object.freeze({
    ALIGNMENTS,
    METAL_DETECTION: Object.freeze({ sourceHex: SOURCE_HEX, hueToleranceDeg: SOURCE_HUE_TOL_DEG, saturationTolerance: SOURCE_SAT_TOL, alphaMin: SOURCE_ALPHA_MIN }),
    stateFor,
    setChoice,
    activeAlignments,
    buildMetalMask,
    renderControls,
    debugSnapshot,
    copyDebug,
    forceRefresh() { lastScanAt = -Infinity; activeSnapshot = null; },
  });

  bootstrap();
})();
