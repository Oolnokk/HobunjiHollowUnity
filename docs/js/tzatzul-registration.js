// Tzatzul-specific authoring and live creature registration. No ambient
// spawning happens here: cliffs, prey transport and the boss nest require
// their dedicated encounter runtime so birds never populate broken sites.
(() => {
  'use strict';
  if (window.TzatzulRegistration) return;
  const KIND = 'tzatzul'; // Adult bird registry key used by dev spawning and future nest generation.
  const HATCHLING_KIND = 'tzatzul-hatchling'; // Shares its mother's tint, but owns its own peck animation/attack.
  const RIG_URL = 'config/creatures/tzatzul-flying-rig.json'; // Committed author export, not mutable defaults from the preview tool.
  const BASE = 'assets/creaturesprites/'; // Canonical repository paths for the actual flying sprite PNGs.
  const SPRITES = Object.freeze({
    flying: BASE + 'tzatzul_flying.png',
    perched: BASE + 'tzatzul_perched.png',
    wings: BASE + 'tzatzul_wings.png',
    eyes: BASE + 'tzatzul_eyes.png',
    blink: BASE + 'tzatzul_blink.png',
  }); // The authored perched body and independent articulated wings are never generated from a flat replacement image.
  const HATCHLING_SCALE = Object.freeze({ x: 3 / 8, y: 5 / 8 }); // Relative to the adult portrait; the runtime nest must use nonuniform scaling.
  const PECK_WINDUP_S = 0.24; // Hatchling tips its body forward at the feet before striking.
  const PECK_STRIKE_S = 0.13; // Contact at peak of the foot-pivot peck.
  const PECK_RECOVERY_S = 0.31; // Returns the body to its prior authored rotation.
  const PECK_ANGLE_RAD = Math.PI * 0.29; // Hammer-like rotation about portrait Z, not a horizontal translation.
  const last = { registered: false, peckRegistered: false, rigLoaded: false, error: null }; // Mobile debug snapshot does not retain creature references.
  let rigPromise = null; // Coalesces fetch/image decoding across every bird and hatchling.
  function hash(str) {
    let value = 2166136261 >>> 0; // Deterministic per-map palette offset; not tied to the gameplay RNG stream.
    for (const ch of String(str || '')) value = Math.imul(value ^ ch.charCodeAt(0), 16777619) >>> 0;
    return value;
  }
  function hueRgb(p, q, t) {
    let u = (t % 1 + 1) % 1;
    if (u < 1/6) return p + (q - p) * 6 * u;
    if (u < 1/2) return q;
    if (u < 2/3) return p + (q - p) * (2/3 - u) * 6;
    return p;
  }
  function hslHex(h, s, l) {
    const q = l < .5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const digits = [hueRgb(p, q, h + 1/3), hueRgb(p, q, h), hueRgb(p, q, h - 1/3)]
      .map(v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0'));
    return '#' + digits.join('');
  }
  function identityFor(mapId, index, parent = null) {
    if (parent?.tintHex) return { id: parent.id, tintHex: parent.tintHex, mapId: String(mapId), parentId: parent.id }; // An individual mother's clutch is identical in coat color.
    const slot = Math.max(0, Math.floor(Number(index) || 0));
    // Golden-angle hue spacing makes nearby IDs visibly different through a
    // spyglass; deterministic luminance/saturation bands disambiguate even
    // larger rosters. The map-key shift is fixed across save reloads.
    const hue = (((hash(mapId) % 360) + slot * 137.507764) % 360) / 360;
    const saturation = .31 + (slot % 3) * .10;
    const lightness = .53 + (Math.floor(slot / 3) % 3) * .065;
    return { id: String(mapId) + ':tzatzul:' + slot, tintHex: hslHex(hue, saturation, lightness),
      mapId: String(mapId), index: slot };
  }
  function register(injected = {}) {
    const db = injected.CREATURE_DB;
    if (!db) return false;
    const baseline = db.grehlr || db['gar-wolf'] || {}; // Preserve existing ordinary health/stamina/stat defaults.
    const previousAdult = db[KIND] || {};
    const tile = Number(injected.TILE) || 55;
    db[KIND] = {
      ...baseline, ...previousAdult, label: 'Tzatzul',
      hostile: true, diet: 'carnivore', defaultSizeClass: 'large',
      modelWidth: Number(previousAdult.modelWidth) || 2.2,
      spriteAspect: 1000 / 1617, // Both authored body sprites use this canvas; native hitboxes and the articulated rig must match.
      attackRangePx: tile * 1.4, attackHalfConeRad: Math.PI / 3,
      attackDamage: 24, attackTag: 'sharp', attackCooldownS: 2.4,
      attacks: ['pounce'], // Exterior fight will replace this with flight-based engagement once nests are generated.
      isFlyingSpecies: true,
      lootPool: 'mixedCrateTreasurePuzzle', // The killed adult's stored prey is drawn from the full crate / treasure / puzzle pool.
      sprites: { idle: SPRITES.perched, run: [SPRITES.flying, SPRITES.flying] },
    };
    const adult = db[KIND];
    const existingHatchling = db[HATCHLING_KIND] || {};
    db[HATCHLING_KIND] = {
      ...adult, ...existingHatchling, label: 'Tzatzul Hatchling',
      defaultSizeClass: 'small', modelWidth: adult.modelWidth * HATCHLING_SCALE.x,
      spriteAspect: (adult.spriteAspect || 600 / 1375) * HATCHLING_SCALE.y / HATCHLING_SCALE.x, // Native planes must preserve the requested independent X/Y ratios.
      attackDamage: 6, attackRangePx: tile * 0.72, attackCooldownS: 1.8,
      attacks: ['tzatzulPeck'], isFlyingSpecies: false,
      lootPool: 'creature_tzatzul_hatchling', // Nest hatchlings do not independently produce a mother's accumulated prey hoard.
      sprites: { idle: SPRITES.perched, run: [SPRITES.perched, SPRITES.perched] },
    };
    const visual = window.CreatureGeneticsRender?.SPECIES;
    if (visual) {
      const adultVisual = {
        prefix: KIND, base: { idle: SPRITES.perched, run1: SPRITES.flying, run2: SPRITES.flying },
        patterns: [], eyes: { open: SPRITES.eyes, blink: SPRITES.blink },
      };
      visual[KIND] ||= adultVisual;
      visual[HATCHLING_KIND] ||= { ...adultVisual, prefix: HATCHLING_KIND,
        base: { idle: SPRITES.perched, run1: SPRITES.perched, run2: SPRITES.perched } };
    }
    last.registered = true;
    return true;
  }
  function registerPeck() {
    const attacks = window.Combat?.animalAttacks;
    if (!attacks?.register || last.peckRegistered) return false;
    function reset(c, state) {
      const group = c?.avatarRef?.group;
      if (group && Number.isFinite(state.baseRotZ)) group.rotation.z = state.baseRotZ;
    }
    attacks.register('tzatzulPeck', {
      label: 'Peck', ownsApproach: false,
      start(c, state, ctx) {
        state.t = 0;
        state.target = ctx?.target || null;
        state.hit = false;
        state.baseRotZ = Number(c.avatarRef?.group?.rotation?.z) || 0; // Save the feet-hinged portrait's resting rotation.
      },
      update(c, state, dt, deps) {
        state.t += Math.max(0, Math.min(.2, Number(dt) || 0));
        const total = PECK_WINDUP_S + PECK_STRIKE_S + PECK_RECOVERY_S;
        const group = c.avatarRef?.group;
        const forward = Math.min(1, state.t / PECK_WINDUP_S);
        const recovery = Math.max(0, Math.min(1, (state.t - PECK_WINDUP_S - PECK_STRIKE_S) / PECK_RECOVERY_S));
        if (group) group.rotation.z = state.baseRotZ - PECK_ANGLE_RAD * forward * (1 - recovery);
        if (!state.hit && state.t >= PECK_WINDUP_S) {
          state.hit = true; // Exactly one strike per peck, including multi-frame hitch cases.
          const target = state.target;
          const reach = Number(c.def?.attackRangePx) || (deps.TILE || 55) * .72;
          if (target && (!Number.isFinite(target.health) || target.health > 0)
            && Math.hypot((target.x || 0) - c.x, (target.y || 0) - c.y) <= reach) {
            const opts = { tag: 'sharp', afflictionBonuses: window.ResourceSystem?.afflictionBonusesForTag?.('sharp'), attacker: c };
            if (target === deps.player || target.isPlayer) deps.damagePlayer?.(c.def?.attackDamage || 6, c.x, c.y, 75, opts);
            else deps.damageCreature?.(target, c.def?.attackDamage || 6, c.x, c.y, 75, opts);
            deps.playCreatureClawHit?.(c);
          }
        }
        if (state.t >= total) { reset(c, state); return false; }
        return true;
      },
      cancel: reset,
      isWindingUp: state => state.t < PECK_WINDUP_S,
      isStriking: state => state.t >= PECK_WINDUP_S && state.t < PECK_WINDUP_S + PECK_STRIKE_S,
    });
    last.peckRegistered = true;
    return true;
  }
  function image(path) {
    return new Promise((resolve, reject) => {
      const asset = new Image(); // Source image decoded once and shared across bird rig allocations.
      asset.crossOrigin = 'anonymous'; // Must precede src for PNG canvas/texture access.
      asset.onload = () => resolve(asset);
      asset.onerror = () => reject(new Error('Unable to load ' + path));
      asset.src = path;
    });
  }
  async function loadRig() {
    if (!rigPromise) rigPromise = Promise.all([
      fetch(RIG_URL).then(r => { if (!r.ok) throw new Error('Tzatzul rig HTTP ' + r.status); return r.json(); }),
      ...[SPRITES.flying, SPRITES.perched, SPRITES.wings, SPRITES.eyes, SPRITES.blink].map(image),
    ]).then(([settings, flying, perched, wings, eyes, blink]) => {
      const authored = window.FlyingAnimalRig.normalize(settings); // Validate the serialized talon/socket and seven-point perch spline.
      last.rigLoaded = true;
      return { settings: authored, images: { flying, perched, wings, eyes, blink } };
    }).catch(error => { rigPromise = null; last.error = String(error); throw error; }); // Failed image fetches are retryable.
    return rigPromise;
  }
  async function createRig(identity = null, options = {}) {
    const { settings, images } = await loadRig();
    const instance = window.FlyingAnimalRig.create(settings, images);
    if (options.undeformedPerch) instance.setPerchSpline(null); // Hatchling uses flat perched art, oriented as flying.
    instance.talonCarry = settings.talonCarry; // Live actors use the same authored socket and payload poses as the editor.
    if (identity?.tintHex && window.THREE) {
      const tintHex = identity.tintHex; // The assigned mother's individual coat color survives damage and visual refreshes.
      const tintMaterials = new Set(); // Color only the body and wings, never the separately authored eyes.
      instance.root.traverse(node => {
        if (node.isMesh && !node.userData?.flyingAnimalEyeOverlay && node.material?.color) tintMaterials.add(node.material);
      });
      instance.restoreTint = () => {
        let changed = false;
        for (const material of tintMaterials) {
          const current = typeof material.color.getHexString === 'function' ? material.color.getHexString() : null;
          if (current?.toLowerCase() === tintHex.replace(/^#/, '').toLowerCase()) continue;
          material.color.set(tintHex);
          changed = true;
        }
        return changed;
      };
      instance.restoreTint(); // Other material owners may reset white on hit; the live tick repairs this after the hit flash.
    }
    return instance;
  }
  function debugSnapshot() { return { ...last, hatchlingScale: { ...HATCHLING_SCALE },
    exampleColors: Array.from({ length: 6 }, (_, i) => identityFor('map_northern_cliffs', i).tintHex) }; }
  window.TzatzulRegistration = Object.freeze({ KIND, HATCHLING_KIND, SPRITES, HATCHLING_SCALE,
    identityFor, register, registerPeck, loadRig, createRig, debugSnapshot });
  registerPeck(); // Combat.animalAttacks exists at script load time, long before WildlifeSpawn.init.
})();
