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
  const FREE_DRIFT_FACTOR = 3.5; // Used by spawnParticle() to let emitted effects travel noticeably beyond the originating metal silhouette.
  const BILLBOARD_RADIUS_FACTOR = 0.75; // Used by updateEmitters() to conservatively include any rotated sprite corners in held-overlay scissoring.
  const LICH_VARIANTS = Object.freeze(['pure', 'muted', 'dusty', 'dark_muted']); // Used by lichDyeIds() to mirror combat-lich.js wardrobe possibilities.
  const FALLBACK_VISUALS = {}; // Used only in isolated tools/tests where a live gear inventory is unavailable.
  const MASK_CACHE = new Map(); // Used by metalMaskForSprite() so each source PNG is decoded/scanned once per page load.
  const SHAPE_TEXTURE_CACHE = new Map(); // Used by shapeTexture() to share one white alpha sprite texture per particle silhouette.
  const EMITTERS = new Map(); // Used by updateEmitters() to retain pooled particles for each currently visible weapon plane.

  let lastScanAt = -Infinity; // Used by update() to throttle held-plane/config resolution.
  let lastHeldWeaponKey = null; // Used by update() to clear existing particles immediately on a held-slot, holster, or weapon change.
  let lastHeldWeaponVisual = null; // Used by update() to recognize hot-swapped/rebuilt weapon meshes even if the item key stays the same.
  let activeSnapshot = null; // Used by updateEmitters()/debugSnapshot() as the latest resolved weapon + planar visual state.
  let scanGeneration = 0; // Used by update()/forceRefresh() so an older async mask scan can never overwrite a newer weapon/config snapshot.
  let updateLoopInstalled = false; // Used by installUpdateLoop() to avoid duplicate scheduler registration.
  let lastEvent = 'idle'; // Used by debugSnapshot() and the in-menu diagnostics without browser devtools.

  function lichDyeIds(hues, neutrals = []) {
    const ids = []; // Used as the complete enchantment color picker for one planar family.
    for (const variant of LICH_VARIANTS) for (const hue of hues) ids.push(`dye:CLOTH:${variant}_${hue}`);
    return Object.freeze(ids.concat(neutrals));
  }

  const ALIGNMENTS = Object.freeze({
    Tothal: Object.freeze({
      id: 'Tothal', label: 'Tothal · Motion / Blizzard', opacity: 0.9,
      dyeIds: lichDyeIds(['green_blue', 'blue', 'blue_indigo']),
      effects: Object.freeze([
        Object.freeze({ id: 'blizzard-orb', label: 'Blizzard Orbs', motion: 'swirl', shape: 'orb', blend: 'additive', size: 0.052, life: 1.05, speed: 0.045 }),
        Object.freeze({ id: 'wind-streak', label: 'Crosswind Streaks', motion: 'crosswind', shape: 'streak', blend: 'additive', size: 0.055, life: 0.68, speed: 0.085 }),
        Object.freeze({ id: 'sleet-needle', label: 'Sleet Needles', motion: 'sleet', shape: 'needle', blend: 'normal', size: 0.048, life: 0.82, speed: 0.065 }),
      ]),
      lore: 'Constant motion: cold, wind, water, chaos, and change.',
    }),
    Hronal: Object.freeze({
      id: 'Hronal', label: 'Hronal · Stillness / Stone & Lava', opacity: 0.96,
      dyeIds: lichDyeIds(['red', 'red_orange', 'orange', 'yellow_orange', 'yellow']),
      effects: Object.freeze([
        Object.freeze({ id: 'lava-spit', label: 'Lava Spit', motion: 'lava', shape: 'drop', blend: 'additive', size: 0.055, life: 0.76, speed: 0.048 }),
        Object.freeze({ id: 'stone-spray', label: 'Stone Spray', motion: 'stone', shape: 'shard', blend: 'normal', size: 0.050, life: 0.92, speed: 0.052 }),
        Object.freeze({ id: 'ember-fall', label: 'Ember Fall', motion: 'ember', shape: 'ember', blend: 'additive', size: 0.044, life: 1.02, speed: 0.042 }),
      ]),
      lore: 'Utter stillness: stable earth, dead heat, flat desert, short mountains, and lava.',
    }),
    Kanthic: Object.freeze({
      id: 'Kanthic', label: 'Kanthic · Void-Nigh / Petroleum', opacity: 0.94,
      dyeIds: lichDyeIds(['indigo', 'indigo_violet', 'violet'], ['dye:CLOTH:white', 'dye:CLOTH:gray', 'dye:CLOTH:charcoal']),
      effects: Object.freeze([
        Object.freeze({ id: 'petroleum-drop', label: 'Petroleum Drops', motion: 'drip', shape: 'drop', blend: 'normal', size: 0.062, life: 1.16, speed: 0.035 }),
        Object.freeze({ id: 'tar-splash', label: 'Tar Splashes', motion: 'splash', shape: 'splash', blend: 'normal', size: 0.060, life: 0.84, speed: 0.050 }),
        Object.freeze({ id: 'goo-thread', label: 'Goo Threads', motion: 'thread', shape: 'thread', blend: 'normal', size: 0.058, life: 1.24, speed: 0.030 }),
      ]),
      lore: 'The void-nigh: oily filth, trapping pull, demonic violence, and death without release.',
    }),
    Ohthic: Object.freeze({
      id: 'Ohthic', label: 'Ohthic · Spirit World / Dead-Light', opacity: 0.75,
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
    return def ? { alignment, colorAlignment: alignment, dyeId: def.dyeIds[0], effectId: def.effects[0]?.id || '' } : null;
  }

  function normalizedState(key, raw = visualStore()[key]) {
    const active = activeAlignments(key); // Used to reject stale visual alignment choices after enchantments are removed/swapped.
    if (!active.length) return null;
    const alignment = active.includes(raw?.alignment) ? raw.alignment : strongestAlignment(key);
    const colorAlignment = active.includes(raw?.colorAlignment) ? raw.colorAlignment : alignment; // Used to preserve an independent, enchantment-backed palette origin.
    const def = ALIGNMENTS[alignment]; // Used to validate particle forms against their selected origin.
    const colorDef = ALIGNMENTS[colorAlignment]; // Used to validate colors independently of particle forms.
    const fallback = defaultStateForAlignment(alignment); // Used when an old/malformed save lacks current visual fields.
    const dyeId = colorDef.dyeIds.includes(raw?.dyeId) ? raw.dyeId : colorDef.dyeIds[0];
    const effectId = def.effects.some(effect => effect.id === raw?.effectId) ? raw.effectId : fallback.effectId;
    return { alignment, colorAlignment, dyeId, effectId };
  }

  function stateFor(key = window.Combat?.deps?.currentWeaponKey?.() || 'none') {
    return normalizedState(key);
  }

  function setChoice(key, field, value) {
    const current = normalizedState(key); // Used as the validated base state for a single player-authored visual mutation.
    if (!current || !['alignment', 'colorAlignment', 'dyeId', 'effectId'].includes(field)) return false;
    let next = { ...current, [field]: value }; // Used as the candidate persistent visual state before alignment-specific normalization.
    if (field === 'alignment' || field === 'colorAlignment') {
      if (!activeAlignments(key).includes(value)) return false;
      if (field === 'alignment') next.effectId = ALIGNMENTS[value].effects[0].id;
      else next.dyeId = ALIGNMENTS[value].dyeIds[0];
    }
    const def = ALIGNMENTS[next.alignment]; // Used to keep dye/effect selections within the chosen plane's authored vocabulary.
    if (!def || !ALIGNMENTS[next.colorAlignment]?.dyeIds.includes(next.dyeId) || !def.effects.some(effect => effect.id === next.effectId)) return false;
    visualStore()[key] = next;
    window.Combat?.deps?.saveGearInventory?.();
    lastEvent = `saved ${key}: ${next.alignment}/${next.colorAlignment}/${next.dyeId}/${next.effectId}`;
    scanGeneration++; // Invalidate any in-flight scan that still reflects the old visual choice.
    lastScanAt = -Infinity;
    activeSnapshot = null;
    clearAllEmitters();
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
    const modularParts = window.ModularWeapons?.decode?.(spritePath); // Virtual modular sprite keys must be composed, not loaded as image URLs.
    if (modularParts) {
      const revision = window.ModularWeapons.diagnostics?.(spritePath)?.revision ?? 0; // Separates cached masks after foundry authoring changes.
      const cacheKey = `modular-mask:${revision}:${spritePath}`; // Reuses one source-metal scan for each assembled weapon configuration.
      if (MASK_CACHE.has(cacheKey)) return MASK_CACHE.get(cacheKey);
      const task = window.ModularWeapons.compose(modularParts.shaft, modularParts.head).then(canvas => {
        const context = canvas?.getContext?.('2d', { willReadFrequently: true }); // Scan the exact assembled, unrecolored sprite used by tool-metal-recolor.
        if (!context || !canvas.width || !canvas.height) throw new Error('Modular weapon composition has no readable pixels');
        const mask = buildMetalMask(context.getImageData(0, 0, canvas.width, canvas.height));
        if (!mask) throw new Error('Metal pixel scanner unavailable');
        return mask;
      }).catch(error => {
        MASK_CACHE.delete(cacheKey); // Let later scans retry missing donor assets or transient canvas failures.
        lastEvent = `modular metal mask failed: ${error?.message || error}`;
        return null;
      });
      MASK_CACHE.set(cacheKey, task);
      return task;
    }
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
          MASK_CACHE.delete(url); // A transient decode/canvas failure must not permanently poison this sprite for the rest of the session.
          lastEvent = `mask failed: ${error?.message || error}`;
          resolve(null);
        }
      };
      image.onerror = () => {
        MASK_CACHE.delete(url); // Allow a later scan to retry a transient mobile/network asset failure.
        lastEvent = `mask image failed: ${spritePath}`;
        resolve(null);
      };
      image.src = url;
    });
    MASK_CACHE.set(url, promise);
    return promise;
  }

  function sourceSpriteForWeapon(key) {
    const defs = window.Combat?.deps?.TOOL_ITEM_DEFS; // EquipmentPanel.exposeInventoryMasteryBridge() populates this existing Combat dependency before the first game frame.
    return defs?.[key]?.sprite || defs?.[key]?.baseSprite || null;
  }

  function activeHeldWeaponKey() {
    const deps = window.Combat?.deps; // Gameplay's authoritative held mode, equipment slot, and per-weapon enchantment identity.
    const handDeps = window.ProceduralHandAttachments?.gameDeps; // Optional fallback for integrations without the Combat held-slot seams.
    const activeSlot = deps?.getActiveTool?.() ?? handDeps?.getActiveTool?.() ?? window.WeaponToolStances?.getRuntimeState?.()?.activeSlot ?? null; // Prefer cheap authoritative slot getters; avoid refreshing the full stance snapshot every frame.
    const heldMode = deps?.getHeldMode?.() ?? handDeps?.getHeldMode?.() ?? null; // Holstering or holding a bag item suppresses the aura.
    if (activeSlot !== 'weapon' || heldMode !== 'tool') return null; // Fail closed if held-slot metadata is missing; never guess from a nearby mesh.
    const weaponKey = deps?.currentWeaponKey?.() || null; // The weapon whose stored enchantments and verdigris mask will be read.
    const equippedKey = deps?.equipmentSlots?.weapon ?? handDeps?.equipmentSlots?.weapon ?? window.WeaponToolStances?.getRuntimeState?.()?.itemKey ?? null; // Reject a stale weapon key; borrow the stance's item identity only when slot registries are unavailable.
    if (!weaponKey || weaponKey === 'none' || (equippedKey && equippedKey !== weaponKey)) return null;
    return weaponKey;
  }

  function directHeldVisual(key) {
    const handDeps = window.ProceduralHandAttachments?.gameDeps; // Shares the live held visual with procedural hands and dual wield.
    const holder = handDeps?.toolHolder; // A player-owned holder is mandatory; a free-standing mesh or NPC must never inherit the aura.
    if (!holder?.children) return null;
    const meshMap = handDeps?.toolMeshMap; // Optional authoritative slot map; the shipped hand runtime can omit it.
    const belongsToHolder = candidate => {
      if (holder.children.includes(candidate)) return true; // Preserve the direct-child runtime and lightweight tool-holder contract even when the caller omits parent back-pointers.
      for (let ancestor = candidate?.parent; ancestor; ancestor = ancestor.parent) {
        if (ancestor === holder) return true; // Nested attachment/shaft rigs still belong to the exact player-held tool.
        if (ancestor.visible === false) return false; // A hidden intermediate rig cannot be the currently drawn weapon.
      }
      return false; // Never search the scene or accept an enemy/free-standing matching weapon.
    };
    const isHeldWeapon = candidate => candidate?.visible !== false
      && candidate?.userData?.itemKey === key
      && candidate?.userData?.toolPlane?.isObject3D
      && belongsToHolder(candidate); // Exact item identity and player-holder ancestry must both agree.
    const mapped = meshMap instanceof Map ? meshMap.get('weapon') : meshMap?.weapon; // Prefer the designated melee-slot visual when attached.
    if (isHeldWeapon(mapped)) return mapped;
    let held = null; // Fallback for nested attachments or a stale slot map during equipment rebuilds.
    holder.traverse?.(candidate => {
      if (!held && candidate !== holder && isHeldWeapon(candidate)) held = candidate;
    });
    return held || holder.children.find(isHeldWeapon) || null;
  }

  function heldVisualForWeapon(key) {
    return activeHeldWeaponKey() === key ? directHeldVisual(key) : null; // No scene-wide fallback: it could attach an aura to an enemy carrying the same weapon.
  }

  function particlePlanesForVisual(visual) {
    const plane = visual?.userData?.toolPlane; // Used as the authored single-weapon plane and the root containing dual-wield duplicates.
    if (!plane?.isObject3D) return [];
    const dual = window.HobunjiDualWieldWeaponVisuals?.debugSnapshot?.(); // Used to avoid emitting around the hidden midpoint plane while dual wield is visually active.
    if (!(dual?.copiesVisible ?? dual?.active)) return [plane]; // The invisible idle-offhand tool reports active but draws nothing; only real dual wield replaces the plane.
    const duplicates = []; // Used as the visible main/offhand blade planes when the original source material is hidden.
    plane.traverse?.(node => {
      if (node?.userData?.hobunjiDualWieldDuplicate === true) duplicates.push(node);
    });
    return duplicates.length ? duplicates : [plane];
  }

  function geometrySize(plane) {
    const geometry = plane?.geometry; // Used to map source pixels onto the exact local quad, including the offset of a modular head/haft.
    const width = Number(geometry?.parameters?.width);
    const height = Number(geometry?.parameters?.height);
    const layout = geometry?.userData?.modularLayout; // ModularWeapons.fitPlaneGeometry shifts quad vertices; width/height alone lose that offset.
    const box = geometry?.boundingBox; // An existing bounding box also supports custom non-centered plane geometry.
    const centerX = Number(layout?.x ?? (box ? (box.min.x + box.max.x) / 2 : 0)); // Used by spawnParticle() and scissor padding.
    const centerY = Number(layout?.y ?? (box ? (box.min.y + box.max.y) / 2 : 0)); // Used by spawnParticle() and scissor padding.
    if (width > 0 && height > 0) return { width, height, centerX, centerY };
    geometry?.computeBoundingBox?.();
    const bounds = geometry?.boundingBox; // Fallback for cloned/custom planes without constructor parameters.
    return bounds
      ? { width: Math.max(0.001, bounds.max.x - bounds.min.x), height: Math.max(0.001, bounds.max.y - bounds.min.y),
        centerX: (bounds.min.x + bounds.max.x) / 2, centerY: (bounds.min.y + bounds.max.y) / 2 }
      : { width: 0.5, height: 0.5, centerX: 0, centerY: 0 };
  }

  function metalPixelToLocal(index, mask, plane) {
    const px = index % mask.width; // Source pixel index converted to the assembled sprite's X coordinate.
    const py = Math.floor(index / mask.width); // Source pixel index converted to the assembled sprite's Y coordinate.
    const size = geometrySize(plane); // Returned frame includes both logical dimensions and local-quad center.
    return {
      x: size.centerX + ((px + 0.5) / mask.width - 0.5) * size.width,
      y: size.centerY + (0.5 - (py + 0.5) / mask.height) * size.height,
      size,
    };
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

  // Expired particles park their sprite (and its own material, needed for the
  // per-particle opacity fade) in the emitter's pool instead of disposing it,
  // so a steady 7-18 spawns/s per blade allocates nothing once warm.
  function retireParticle(emitter, particle) {
    const sprite = particle?.sprite;
    if (!sprite) return;
    sprite.visible = false;
    if (emitter?.pool && emitter.pool.length < MAX_PARTICLES_PER_PLANE) emitter.pool.push(sprite);
    else disposeParticle(particle);
  }

  function clearEmitter(emitter) {
    for (const particle of emitter?.particles || []) retireParticle(emitter, particle);
    if (emitter) {
      emitter.particles.length = 0;
      if (emitter.plane?.userData) emitter.plane.userData.hobunjiHeldOverlayVfxPadding = 0; // Clear the live overdraw envelope when the aura is reset.
    }
  }

  function disposeEmitter(emitter) {
    if (!emitter) return;
    for (const particle of emitter.particles) disposeParticle(particle);
    emitter.particles.length = 0;
    for (const sprite of emitter.pool || []) disposeParticle({ sprite });
    if (emitter.pool) emitter.pool.length = 0;
    emitter.group?.parent?.remove?.(emitter.group);
    if (emitter.plane?.userData) delete emitter.plane.userData.hobunjiHeldOverlayVfxPadding; // No stale scissor enlargement after unequipping.
  }

  function makeEmitter(plane, playerHeld = false) {
    if (typeof THREE === 'undefined' || !plane?.add) return null;
    const group = new THREE.Group(); // Used as the plane-local owner for all transient particles on this exact visible weapon copy.
    group.name = 'weapon_enchantment_metal_particles';
    group.userData.weaponEnchantmentVfx = true;
    group.position.z = 0.012;
    plane.add(group);
    plane.userData = plane.userData || {};
    plane.userData.hobunjiHeldOverlayVfxPadding = 0; // Read by HeldObjectRenderOrder's scissor bounds for only this emitting weapon plane.
    return { plane, group, particles: [], pool: [], accumulator: 0, token: '', lastTime: performance.now(), playerHeld }; // Only the actual player's held sprite may bypass replay culling; NPC and preview motes retain the draw-call optimization.
  }

  function styleFor(state) {
    const def = ALIGNMENTS[state?.alignment]; // Used to resolve the chosen plane-specific particle vocabulary.
    return def?.effects?.find(effect => effect.id === state?.effectId) || def?.effects?.[0] || null;
  }

  function syncParticleRenderLayers(sprite, plane, playerHeld = false) {
    if (!sprite?.layers) return;
    const overlayLayer = window.HeldObjectRenderOrder?.HELD_OVERLAY_LAYER; // Used to share the held-weapon selective replay without losing ordinary room rendering.
    const overlays = Number.isInteger(overlayLayer) && overlayLayer > 0 && overlayLayer < 32
      && ((Number(plane?.layers?.mask) >>> overlayLayer) & 1);
    const wantedMask = (1 | (overlays ? (1 << overlayLayer) : 0)) >>> 0; // Normal rendering stays available if the selective depth replay skips this scene.
    if ((Number(sprite.layers.mask) >>> 0) !== wantedMask) sprite.layers.mask = wantedMask;
    sprite.userData = sprite.userData || {};
    sprite.userData.hobunjiHeldOverlayParticle = !!overlays && playerHeld; // Only player-held motes are protected from the source-blade scissor's extra frustum cull.
  }

  function spawnParticle(emitter, mask, snapshot) {
    if (!emitter || !mask?.indices?.length || emitter.particles.length >= MAX_PARTICLES_PER_PLANE || typeof THREE === 'undefined') return;
    const state = snapshot.visual; // Used to resolve player-selected plane/color/effect for this spawn.
    const alignment = ALIGNMENTS[state.alignment]; // Used for plane-wide opacity/thematic behavior.
    const effect = styleFor(state); // Used for motion, silhouette, blend, size, and lifetime.
    if (!alignment || !effect) return;
    const texture = shapeTexture(effect); // Used as the white-alpha attack-inspired particle silhouette.
    if (!texture) return;
    const blending = effect.blend === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending;
    let sprite = emitter.pool.pop() || null; // Reuses a retired mote (sprite + its own material) when one is parked.
    if (sprite) {
      const material = sprite.material;
      if (material.map !== texture || material.blending !== blending) { material.map = texture; material.blending = blending; material.needsUpdate = true; }
      material.color.set(dyeHex(state.dyeId));
      material.opacity = alignment.opacity;
      material.rotation = 0;
      sprite.visible = true;
    } else {
      const material = new THREE.SpriteMaterial({
        map: texture,
        color: dyeHex(state.dyeId),
        transparent: true,
        opacity: alignment.opacity,
        depthWrite: false,
        blending,
      }); // Per-particle material is intentionally owned because opacity is animated independently.
      sprite = new THREE.Sprite(material); // Used as a camera-legible mote whose position still follows the weapon's local plane transform.
    }
    sprite.name = `weapon_enchantment_${effect.id}`;
    sprite.renderOrder = Number(emitter.plane.renderOrder || 0) + 4;
    // The held-object renderer hides the parent plane (and its children) in
    // the base pass, then redraws it on the overlay layer. Retain layer 0 as
    // well: rooms without ground replay still use the ordinary world pass.
    // Recheck existing sprites each frame as the held renderer may mark a mesh
    // after its first particle spawned (notably during scene/equipment rebuilds).
    syncParticleRenderLayers(sprite, emitter.plane, emitter.playerHeld);

    const index = mask.indices[Math.floor(random() * mask.indices.length)]; // Used to choose one exact verdigris-qualified metal pixel uniformly.
    const origin = metalPixelToLocal(index, mask, emitter.plane); // Pixel emission follows even offset/expanded modular weapon geometry.
    const { x: baseX, y: baseY, size } = origin;
    const particleSize = Math.max(0.008, Math.min(size.width, size.height) * effect.size * (0.76 + random() * 0.55)); // Used as a bounded local sprite size with slight natural variation.
    sprite.position.set(baseX, baseY, 0.004 + random() * 0.015);
    sprite.scale.set(particleSize, particleSize, 1);
    emitter.group.add(sprite);

    const angle = random() * Math.PI * 2; // Used by radial/swirling plane-local motion families.
    const speed = effect.speed * Math.max(size.width, size.height) * FREE_DRIFT_FACTOR * (0.65 + random() * 0.7); // Metal is only the birth mask; motion is free to leave its boundary.
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
      maxOpacity: Math.max(0.6, alignment.opacity * (0.85 + random() * 0.15)),
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
    sprite.material.opacity = Math.max(0.6, particle.maxOpacity * Math.sin(Math.PI * t)); // Keep live particles at least 60% opaque; scale still eases their birth/death.
    const scalePulse = 0.65 + 1.65 * Math.sin(Math.PI * t); // Used to bloom well beyond the source pixel without clipping to the metal mask.
    const stretchX = particle.motion === 'crosswind' ? 1.25 + 1.2 * t : (particle.motion === 'thread' || particle.motion === 'wisp' ? 0.66 : 1); // Used to lengthen traveling streaks and thin spectral trails.
    const stretchY = particle.motion === 'crosswind' ? 0.62 : (particle.motion === 'thread' || particle.motion === 'wisp' ? 1.35 + 0.7 * t : 1); // Used to stretch threads and wisps vertically as they drift.
    sprite.scale.set(particle.baseSize * scalePulse * stretchX, particle.baseSize * scalePulse * stretchY, 1);
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
        const emitter = makeEmitter(plane, true); // Only these world-held player emitters bypass the replay's additional sprite cull.
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

  function updateEmitters(dt, snapshot, emitters = EMITTERS.values()) {
    if (!snapshot?.mask?.indices?.length) return;
    const effect = styleFor(snapshot.visual); // Used to ensure a malformed state cannot emit.
    if (!effect) return;
    const totalEnchantments = Object.values(snapshot.counts || {}).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0); // Used to make multiply-enchanted weapons a little denser without changing style.
    const emissionPerSecond = Math.min(18, 7 + totalEnchantments * 2.5); // Used as the bounded spawn cadence per visible blade plane.
    for (const emitter of emitters) {
      for (let index = emitter.particles.length - 1; index >= 0; index--) {
        const particle = emitter.particles[index]; // Used as the current pooled particle advanced this frame.
        syncParticleRenderLayers(particle.sprite, emitter.plane, emitter.playerHeld); // Live weapons can acquire their replay layer after the first emission.
        if (updateParticle(particle, dt)) continue;
        retireParticle(emitter, particle);
        emitter.particles.splice(index, 1);
      }
      emitter.accumulator += dt * emissionPerSecond;
      while (emitter.accumulator >= 1 && emitter.particles.length < MAX_PARTICLES_PER_PLANE) {
        emitter.accumulator -= 1;
        const originMask = snapshot.maskByPlane?.get(emitter.plane) || snapshot.mask; // Multi-sprite flails sample only visible metal pixels from each assembled head layer.
        if (originMask?.indices?.length) spawnParticle(emitter, originMask, snapshot);
      }
      // Sprites are independent children of the plane, not texture-masked to its metal.
      // The held-weapon x-ray pass scissored to the mesh box, however, so grow
      // that *rendering* box around all live billboards, including their growth
      // and rotation. This changes draw coverage, never the particle positions.
      const size = geometrySize(emitter.plane); // Used to measure how far live particle sprites extend outside the plane rectangle.
      let padding = 0; // Used by HeldObjectRenderOrder to expand the replay scissor around live particle overdraw.
      for (const particle of emitter.particles) {
        const sprite = particle.sprite; // Used to measure current motion and sprite growth, not its original metal pixel.
        const radius = Math.max(sprite.scale.x, sprite.scale.y) * BILLBOARD_RADIUS_FACTOR; // Includes rotated billboard corners in every view.
        const outside = Math.max(
          Math.abs(sprite.position.x - size.centerX) - size.width * 0.5,
          Math.abs(sprite.position.y - size.centerY) - size.height * 0.5,
          Math.abs(sprite.position.z) + Math.abs(emitter.group.position.z),
        ); // Used to retain front/back face clearance even when the blade turns edge-on.
        padding = Math.max(padding, outside + radius);
      }
      if (emitter.plane.userData) emitter.plane.userData.hobunjiHeldOverlayVfxPadding = padding;
    }
  }

  async function resolveActiveSnapshot() {
    const weaponKey = activeHeldWeaponKey(); // Scans are valid only while this specific enchanted melee weapon is in hand.
    if (!weaponKey) return null;
    const visual = normalizedState(weaponKey); // Used to decide whether this weapon should emit at all and which plane vocabulary to use.
    if (!visual) return null;
    const heldVisual = heldVisualForWeapon(weaponKey); // Used as the exact makeToolPlaneMesh object carrying the rendered PNG plane.
    const spritePath = sourceSpriteForWeapon(weaponKey); // Used to scan the untouched authored PNG for verdigris-compatible metal pixels.
    if (!heldVisual?.userData?.toolPlane || !spritePath) return { weaponKey, visual, heldVisual, spritePath, mask: null, counts: planarCounts(weaponKey), planes: [] };
    const assembly = window.HobunjiWeaponSpriteAssemblies; // Flail layer renderer owns the final visible head masks.
    if (assembly?.definitionFor?.(weaponKey, window.Combat?.deps?.TOOL_ITEM_DEFS?.[weaponKey])) {
      // No fallback to the naked haft for an authored assembly while its sprites are
      // still loading; the next periodic scan picks up ready visible-metal masks.
      const targets = assembly.enchantmentTargets(heldVisual); // Each target is one ordered metal layer and its post-occlusion pixel mask.
      const planes = targets.map(target => target.plane);
      const maskByPlane = new Map(targets.map(target => [target.plane, target.mask]));
      const matched = targets.reduce((sum, target) => sum + target.mask.matchedMetalPixels, 0);
      const mask = targets[0]?.mask
        ? { indices: targets[0].mask.indices, matchedMetalPixels: matched }
        : null;
      return { weaponKey, visual, heldVisual, spritePath, mask, maskByPlane, counts: planarCounts(weaponKey), planes };
    }
    const mask = await metalMaskForSprite(spritePath); // Used as the exact legal particle-origin set.
    if (activeHeldWeaponKey() !== weaponKey || directHeldVisual(weaponKey) !== heldVisual) return null; // A mask decoded after a same-key mesh rebuild must not bind to the old mesh.
    const planes = particlePlanesForVisual(heldVisual); // Used to target one normal blade or both visible dual-wield blade copies.
    return { weaponKey, visual, heldVisual, spritePath, mask, counts: planarCounts(weaponKey), planes };
  }

  // Particles sit just in front of the blade's +Z face. Light/heavy stances and
  // attack poses show the camera either face, and from behind, the opaque blade
  // depth-hid every particle, so each emitter is mirrored onto the visible face.
  let faceScratch = null; // Lazily created { normal, toCamera, planePos, cameraPos }; this runs every frame.
  function faceEmittersTowardCamera(emitters = EMITTERS.values(), cameraOverride = null) {
    const camera = cameraOverride || window.Combat?.deps?.camera; // A menu preview supplies its own camera; gameplay keeps using the live combat camera. // Live game camera handed to Combat.init.
    if (!camera?.matrixWorld || typeof THREE === 'undefined') return;
    if (!faceScratch) faceScratch = { normal: new THREE.Vector3(), toCamera: new THREE.Vector3(), planePos: new THREE.Vector3(), cameraPos: new THREE.Vector3() };
    const { normal, toCamera, planePos, cameraPos } = faceScratch;
    cameraPos.setFromMatrixPosition(camera.matrixWorld);
    for (const emitter of emitters) {
      const plane = emitter?.plane;
      if (!plane?.matrixWorld || !emitter.group) continue;
      normal.set(0, 0, 1).transformDirection(plane.matrixWorld);
      planePos.setFromMatrixPosition(plane.matrixWorld);
      const side = normal.dot(toCamera.subVectors(cameraPos, planePos)) < 0 ? -1 : 1;
      if (emitter.group.scale.z === side) continue;
      emitter.group.scale.z = side;
      emitter.group.position.z = 0.012 * side;
    }
  }

  function clearAllEmitters() {
    for (const emitter of EMITTERS.values()) disposeEmitter(emitter);
    EMITTERS.clear();
  }

  function update(nowMs) {
    const heldWeaponKey = activeHeldWeaponKey(); // Checked every frame so tools, ranged weapons, and holstering clear particles without a 180-ms leak.
    const heldWeaponVisual = heldWeaponKey ? directHeldVisual(heldWeaponKey) : null; // Used to detect replacement of the exact equipped weapon mesh.
    if (heldWeaponKey !== lastHeldWeaponKey || heldWeaponVisual !== lastHeldWeaponVisual) {
      lastHeldWeaponKey = heldWeaponKey;
      lastHeldWeaponVisual = heldWeaponVisual;
      scanGeneration++; // Invalidates any unresolved metal-mask scan from the previously held weapon or slot.
      lastScanAt = -Infinity; // Rescan immediately when the actual melee weapon comes back into the player's hand.
      activeSnapshot = null;
      clearAllEmitters(); // Also clears overlay padding on the old blade rather than leaving drifting sprites on another item.
      lastEvent = heldWeaponKey ? `held melee weapon: ${heldWeaponKey}` : 'melee weapon not held; aura cleared';
    }
    if (!heldWeaponKey) return;
    const now = Number.isFinite(Number(nowMs)) ? Number(nowMs) : performance.now(); // Used as scheduler/RAF-compatible wall time.
    const previous = activeSnapshot?.updatedAt ?? now; // Used to derive a bounded visual-only delta time.
    const dt = Math.min(0.05, Math.max(0, (now - previous) / 1000)); // Used to keep tab-resume gaps from launching particles far from the weapon.
    if (activeSnapshot) activeSnapshot.updatedAt = now;

    if (now - lastScanAt >= SCAN_INTERVAL_MS) {
      lastScanAt = now;
      const generation = ++scanGeneration; // Captured by this async scan; any newer scan/config refresh invalidates its eventual result.
      resolveActiveSnapshot().then(snapshot => {
        if (generation !== scanGeneration || activeHeldWeaponKey() !== heldWeaponKey) return;
        if (!snapshot) {
          activeSnapshot = null;
          clearAllEmitters();
          return; // Unenchanted weapons legitimately have no snapshot; retain the normal scan throttle.
        }
        if (snapshot.heldVisual !== directHeldVisual(heldWeaponKey)) {
          activeSnapshot = null;
          clearAllEmitters();
          lastScanAt = -Infinity; // Retry a transient mesh rebuild immediately, rather than waiting an extra throttle interval.
          return;
        }
        snapshot.updatedAt = performance.now();
        activeSnapshot = snapshot;
        reconcileEmitters(snapshot.planes || [], snapshot);
        lastEvent = snapshot.mask?.matchedMetalPixels
          ? `${snapshot.weaponKey}: ${snapshot.mask.matchedMetalPixels} metal px, ${snapshot.planes.length} plane(s)`
          : `${snapshot.weaponKey}: no matched metal pixels`;
      }).catch(error => { if (generation === scanGeneration) lastEvent = `scan failed: ${error?.message || error}`; });
    }

    if (activeSnapshot?.planes?.length && activeSnapshot.mask?.indices?.length) {
      updateEmitters(dt, activeSnapshot);
      faceEmittersTowardCamera();
    }
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
    lastEvent = 'RuntimeFrameScheduler unavailable; enchantment VFX idle.'; // The shipped game owns frame work through RuntimeFrameScheduler; no parallel RAF loop is permitted.
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
        if (setChoice(key, 'alignment', value)) window.CombatLoadoutUI?.render?.('weaponEnchantmentVfxAlignment');
      });
      alignmentSelect.id = 'weaponEnchantmentVfxAlignment';
      alignmentSelect.disabled = active.length < 2;
      addControlRow(section, 'Particle form origin', alignmentDef.lore, alignmentSelect);

      const colorDef = ALIGNMENTS[state.colorAlignment]; // Used for the independent palette picker and its lore.
      const colorAlignmentSelect = makeSelect(state.colorAlignment, active.map(alignment => ({ value: alignment, label: ALIGNMENTS[alignment].label })), value => {
        if (setChoice(key, 'colorAlignment', value)) window.CombatLoadoutUI?.render?.('weaponEnchantmentVfxColorAlignment');
      });
      colorAlignmentSelect.id = 'weaponEnchantmentVfxColorAlignment';
      colorAlignmentSelect.disabled = active.length < 2;
      addControlRow(section, 'Particle color origin', 'Choose any origin present on this weapon, independently of its particle form.', colorAlignmentSelect);

      const colorSelect = makeSelect(state.dyeId, colorDef.dyeIds.map(dyeId => ({ value: dyeId, label: dyeLabel(dyeId) })), value => {
        if (setChoice(key, 'dyeId', value)) window.CombatLoadoutUI?.render?.('weaponEnchantmentVfxColor');
      });
      colorSelect.id = 'weaponEnchantmentVfxColor';
      addControlRow(section, 'Particle color', 'Uses the authored cloth-dye palette of the selected color origin.', colorSelect);

      const effectSelect = makeSelect(state.effectId, alignmentDef.effects.map(effect => ({ value: effect.id, label: effect.label })), value => {
        if (setChoice(key, 'effectId', value)) window.CombatLoadoutUI?.render?.('weaponEnchantmentVfxEffect');
      });
      effectSelect.id = 'weaponEnchantmentVfxEffect';
      addControlRow(section, 'Particle form', 'Attack-shaped or plane-themed silhouettes; every particle still originates from the weapon’s detected metal region.', effectSelect);

      const preview = document.createElement('div'); // Used as an immediate readable color/opacity sample beneath browser-native selects.
      preview.className = 'loadout-slot-combo-note';
      const swatch = document.createElement('span'); // Used to show the exact dye hex at the plane's authored transparency.
      swatch.style.cssText = `display:inline-block;width:12px;height:12px;border-radius:50%;vertical-align:-2px;margin-right:6px;border:1px solid rgba(255,255,255,.55);background:${dyeHex(state.dyeId)};opacity:${alignmentDef.opacity};`;
      preview.append(swatch, document.createTextNode(`${alignmentDef.label} form / ${colorDef.label} color · ${styleFor(state)?.label || state.effectId} · ${Math.round(alignmentDef.opacity * 100)}% base opacity (60% minimum)`));
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
      currentHeldVisualMatchesSnapshot: !!activeSnapshot?.heldVisual && activeSnapshot.heldVisual === heldVisualForWeapon(key), // True only when a real current visual matches a live snapshot.
      activeHeldWeaponKey: activeHeldWeaponKey(), // Mobile diagnostics distinguish an enchanted weapon being equipped from actually drawn.
      activeSlot: window.Combat?.deps?.getActiveTool?.() ?? window.WeaponToolStances?.getRuntimeState?.()?.activeSlot ?? null,
      heldMode: window.Combat?.deps?.getHeldMode?.() ?? null,
      matchedMetalPixels: activeSnapshot?.weaponKey === key ? (activeSnapshot.mask?.matchedMetalPixels || 0) : null,
      visibleParticlePlanes: activeSnapshot?.weaponKey === key ? (activeSnapshot.planes?.length || 0) : 0,
      emitters: EMITTERS.size,
      particles: [...EMITTERS.values()].reduce((sum, emitter) => sum + emitter.particles.length, 0),
      overlayPadding: [...EMITTERS.values()].map(emitter => Number((emitter.plane?.userData?.hobunjiHeldOverlayVfxPadding || 0).toFixed(4))), // Reveals the live out-of-weapon overdraw envelope on mobile.
      dualWield: window.HobunjiDualWieldWeaponVisuals?.debugSnapshot?.() || null,
      metalDetection: { sourceHex: SOURCE_HEX, hueToleranceDeg: SOURCE_HUE_TOL_DEG, saturationTolerance: SOURCE_SAT_TOL, alphaMin: SOURCE_ALPHA_MIN },
      latestChange: 'An aura requires the exact player-held melee mesh and EquipmentPanel sprite source; slot, holster and same-key mesh rebuilds invalidate old emitters.',
      lastEvent,
    };
  }

  // A separate emitter uses the same metal mask, authored particle shapes,
  // colors, and motion as the held weapon. It never enters gameplay's EMITTERS
  // map, which is intentionally limited to the actually drawn melee weapon.
  function createPreviewEmitter(plane, key) {
    if (!plane?.isObject3D || !key) return null;
    const emitter = makeEmitter(plane); // Owned exclusively by the loadout's miniature 3D scene.
    if (!emitter) return null;
    let disposed = false; // Blocks late mask-decoding promises from attaching to a closed preview.
    let generation = 0; // Invalidates an older preview scan whenever enchantments or visual choices change.
    let activeToken = null; // Tracks the saved visual, enchantment counts and source sprite while this preview stays open.
    let snapshot = null; // Supplies the existing particle integrator with the preview's independent metal mask.

    function refresh() {
      if (disposed) return;
      const visual = normalizedState(key); // Same validated effect/plane/dye choice as the real held-weapon renderer.
      const counts = planarCounts(key); // A newly applied or removed planar enchantment changes emission density.
      const spritePath = sourceSpriteForWeapon(key); // Use the untouched sprite, never the already-verdigris-colored texture.
      const token = JSON.stringify([visual, counts, spritePath]);
      if (token === activeToken) return;
      activeToken = token;
      const request = ++generation;
      clearEmitter(emitter);
      emitter.accumulator = 0;
      snapshot = null;
      if (!visual || !spritePath) return; // Unenchanted weapons legitimately show no particles.
      metalMaskForSprite(spritePath).then(mask => {
        if (disposed || request !== generation) return;
        snapshot = { weaponKey: key, visual, counts, spritePath, mask };
      }).catch(error => {
        if (disposed || request !== generation) return;
        lastEvent = 'preview mask failed: ' + (error?.message || error);
      });
    }
    refresh();
    return {
      update(dt, camera) {
        if (disposed) return;
        refresh();
        if (!snapshot?.mask?.indices?.length) return;
        updateEmitters(Math.min(0.05, Math.max(0, Number(dt) || 0)), snapshot, [emitter]);
        if (camera) faceEmittersTowardCamera([emitter], camera); // Preview particles face its own camera, not the paused game camera.
      },
      refresh,
      dispose() {
        if (disposed) return;
        disposed = true;
        generation++;
        disposeEmitter(emitter); // Dispose only this preview's sprite materials/pool; shared shape textures remain cached.
      },
      debugSnapshot() {
        return { weaponKey: key, active: !disposed, visual: snapshot?.visual || null,
          matchedMetalPixels: snapshot?.mask?.matchedMetalPixels || 0, particles: emitter.particles.length };
      },
    };
  }

  // Particles for a weapon the player does not own (an enemy's enchanted weapon): the same emitter, mask and integrator as the held weapon, with a
  // fixed visual choice and planar counts supplied by the caller instead of the gear inventory. `config` = { visual, counts, spritePath }.
  function createFixedEmitter(plane, config) {
    const visual = config?.visual && ALIGNMENTS[config.visual.alignment] && ALIGNMENTS[config.visual.colorAlignment] ? config.visual : null;
    if (!plane?.isObject3D || !visual || !config.spritePath) return null;
    const emitter = makeEmitter(plane);
    if (!emitter) return null;
    let disposed = false;
    let snapshot = null;
    const counts = config.counts && typeof config.counts === 'object' ? config.counts : { [visual.alignment]: 1 };
    metalMaskForSprite(config.spritePath).then(mask => {
      if (!disposed) snapshot = { weaponKey: 'enemy:' + config.spritePath, visual, counts, spritePath: config.spritePath, mask };
    }).catch(error => { lastEvent = 'enemy mask failed: ' + (error?.message || error); });
    return {
      update(dt) {
        if (disposed || !snapshot?.mask?.indices?.length) return;
        updateEmitters(Math.min(0.05, Math.max(0, Number(dt) || 0)), snapshot, [emitter]);
        faceEmittersTowardCamera([emitter]); // The live combat camera, exactly like the held weapon.
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        disposeEmitter(emitter);
      },
      debugSnapshot() { return { active: !disposed, visual, matchedMetalPixels: snapshot?.mask?.matchedMetalPixels || 0, particles: emitter.particles.length }; },
    };
  }

  function bootstrap() {
    installUpdateLoop();
  }

  window.WeaponEnchantmentVFX = Object.freeze({
    ALIGNMENTS,
    METAL_DETECTION: Object.freeze({ sourceHex: SOURCE_HEX, hueToleranceDeg: SOURCE_HUE_TOL_DEG, saturationTolerance: SOURCE_SAT_TOL, alphaMin: SOURCE_ALPHA_MIN }),
    stateFor,
    setChoice,
    activeAlignments,
    buildMetalMask,
    renderControls,
    createPreviewEmitter,
    createFixedEmitter,
    debugSnapshot,
    copyDebug,
    forceRefresh() { scanGeneration++; lastScanAt = -Infinity; activeSnapshot = null; clearAllEmitters(); },
    _test: Object.freeze({ makeEmitter, updateEmitters, clearEmitter, disposeEmitter, faceEmittersTowardCamera, metalPixelToLocal }), // Particle lifecycle/pooling regression hooks.
  });

  bootstrap();
})();
