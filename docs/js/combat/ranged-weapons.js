// Ranged weapon slot, load/fire actions, and projectile simulation.
(() => {
  'use strict';

  let deps = null;
  const projectiles = [];
  const playerLoaded = new Map();
  let playerAction = null;
  let lastEvent = 'idle';
  let lastAudioEvent = 'idle'; // Exposed through __rangedDebug so mobile testing can confirm cue type and chorus layer count.
  const SCATTERBOW_LOAD_CHORUS_MS = [0, 55, 110]; // Used by playRangedActionSfx() to layer the scatterbow's multiple loading mechanisms.
  const SCATTERBOW_FIRE_CHORUS_MS = [0, 28, 56, 84, 112, 140]; // Used by playRangedActionSfx() to stagger one shot sound per scatterbow projectile.
  const PROJECTILE_PERP_DEAD_DEG = 15; // Used only by projectile PNG facing so arrows turn within tighter windows than animals.
  const PROJECTILE_PERP_DEAD_RAD = THREE.MathUtils.degToRad(PROJECTILE_PERP_DEAD_DEG); // Passed to the shared animal deadzone helpers.
  const PROJECTILE_TRAIL_MAX_POINTS = 14; // Caps each comet ribbon's geometry and per-frame update cost.
  const PROJECTILE_TRAIL_MAX_LANES = 4; // Mirrors the melee trail's readable multi-affliction lane limit.
  const SPECIAL_AMMO_MAX = 8; // Shared character resource cap displayed by the ranged loadout and ammo arch.
  const SPECIAL_AMMO_LOOT_CHANCE = 0.72; // High per-corpse chance requested for creatures and bandits.
  const SHRAPNEL_DURATION_MS = 5000; // Movement-powered Shrapnel debuff lifetime.
  const DISORIENT_DURATION_MS = 3000; // Concussive reversed-movement debuff lifetime.
  const HITBOX_MIN_DEPTH_TILES = 0.18; // Prevents very narrow portrait data from collapsing the actor's 3D target volume.
  const AIM_EPSILON = 1e-6; // Shared tolerance for normalized shot rays and slab intersection math.
  const ACTOR_HITBOX_CACHE_MS = 16; // Reuses portrait-derived hitboxes across all projectile/reticle work in the same rendered frame.
  const BANDIT_LOS_CACHE_MS = 80; // LOS only needs tactical responsiveness, not a full scene query every render frame for every loaded bandit.
  const BANDIT_LOS_STRAFE_TILES = 1.25; // Side-step target used after loading when an ally or obstacle blocks the shot.
  const BANDIT_LOS_TERRAIN_STEP_TILES = 0.75; // Coarse tile-only LOS sampling; precise render geometry is intentionally never consulted.
  const BANDIT_LOS_TERRAIN_OBSTACLE_CLEARANCE_WORLD = 1.7; // A shot only trips a solid ground tile while it's still near that tile's own surface — an upward shot toward a tree sails clean over low terrain it would otherwise be flattened against.
  const WOULD_HIT_CACHE_MS = 50; // HUD prediction at 20 Hz is visually immediate while removing redundant per-frame collision work.
  // A shot doesn't just vanish once it passes a weapon's tuned rangeTiles —
  // it keeps flying, shedding damage/knockback as it goes, until it
  // actually runs out of momentum at rangeTiles * this multiplier. AI
  // engagement range, the HUD "would hit" reticle, and bandit LOS all still
  // key off the base rangeTiles (that's still "the range this weapon is
  // built to fight at"); this only softens what happens to a shot that
  // outran its intended reach instead of hard-despawning it.
  const RANGE_FALLOFF_DISTANCE_MULTIPLIER = 1.6;
  const RANGE_FALLOFF_MIN_FRACTION = 0.15; // Damage/knockback floor at the true despawn distance — never fully free damage, but a spent arrow still stings.
  const actorHitboxCache = new WeakMap(); // Used by actorHitbox() to share one computed portrait volume across same-frame callers.
  let wouldHitCacheAt = -Infinity;
  let wouldHitCacheValue = false;
  let friendlyFireHits = 0;
  let losRepositions = 0;
  let wouldHitCacheHits = 0;

  const BASIC_AMMO_EFFECTS = Object.freeze([
    { id: 'bleedingHealth', label: 'Bleeding Health', desc: 'Each bolt applies a small amount of Bleeding Health.', afflictionId: 'bleedingHealth' },
    { id: 'woundedStamina', label: 'Wounded Stamina', desc: 'Each bolt applies a small amount of Wounded Stamina.', afflictionId: 'woundedStamina' },
    { id: 'congealedHealth', label: 'Congealed Health', desc: 'Each bolt applies a small amount of Congealed Health.', afflictionId: 'congealedHealth' },
    { id: 'infectedStamina', label: 'Infected Stamina', desc: 'Each bolt applies a small amount of Infected Stamina.', afflictionId: 'infectedStamina' },
    { id: 'windedStamina', label: 'Winded Stamina', desc: 'Each bolt applies a small amount of Winded Stamina.', afflictionId: 'windedStamina' },
    { id: 'bruisedHealth', label: 'Bruised Health', desc: 'Each bolt applies a small amount of Bruised Health.', afflictionId: 'bruisedHealth' },
    { id: 'shatteredStamina', label: 'Shattered Stamina', desc: 'Each bolt applies a small amount of Shattered Stamina.', afflictionId: 'shatteredStamina' },
    { id: 'poisonedHealth', label: 'Poisoned Health', desc: 'Each bolt applies a small amount of Poisoned Health.', afflictionId: 'poisonedHealth' },
    { id: 'knockback', label: 'Knockback Boost', desc: 'Bolts deal 25% more knockback.', knockbackMul: 0.25 },
  ]);
  const SPECIAL_AMMO_TYPES = Object.freeze({
    shrapnel: Object.freeze({
      id: 'shrapnel', label: 'Shrapnel Ammo', icon: '🩸',
      desc: 'For 5 seconds, the target’s own movement adds heavy Bleeding Health and Wounded Stamina.',
      trailColors: [{ id: 'bleedingHealth' }, { id: 'woundedStamina' }],
    }),
    concussive: Object.freeze({
      id: 'concussive', label: 'Concussive Ammo', icon: '💥',
      desc: 'High knockback and Footing damage, plus 3 seconds of reversed movement.',
      knockbackMul: 2.5, footingDamageMultiplier: 2.25,
      trailColors: [{ id: 'disorient', color: 0x55ddff }, { id: 'footing', color: 0xffd45a }],
    }),
  });

  const AUTHORED_FIRE_POSE = {
    neutral: { x: 0.23, y: 0.08, z: 0.14, pitch: 16, yaw: 65, bodyYaw: -52, roll: 11, scale: 1.77 },
    windup:  { x: 0.34, y: 0.14, z: 0.11, pitch: -9, yaw: 86, bodyYaw: -76, roll: 12 },
    strike:  { x: 0.33, y: 0.11, z: 0.12, pitch: -9, yaw: 84, bodyYaw: -109, roll: 9 },
  };
  const AUTHORED_LOAD_POSE = {
    neutral: { x: 0, y: 0.12, z: 0.18, pitch: -8, yaw: 0, bodyYaw: 0, roll: 0, scale: 1.77 },
    windup:  { x: 0, y: -0.17, z: 0.09, pitch: 77, yaw: 0, bodyYaw: -10, roll: 0 },
    strike:  { x: 0, y: 0.18, z: 0.08, pitch: -11, yaw: 0, bodyYaw: 7, roll: 0 },
  };
  function clonePoseSet(source) {
    return {
      neutral: { ...source.neutral },
      windup: { ...source.windup },
      strike: { ...source.strike },
    };
  }

  function mergePoseSet(base, incoming = {}) {
    return {
      neutral: { ...base.neutral, ...(incoming.neutral || {}) },
      windup: { ...base.windup, ...(incoming.windup || {}) },
      strike: { ...base.strike, ...(incoming.strike || {}) },
    };
  }

  const CONFIG = {
    crossbow: {
      label: 'Crossbow', projectileSprite: 'assets/toolsprites/arrow_long.png',
      projectileCount: 1, spreadDeg: 0, damage: 16, speedPxS: 720,
      rangeTiles: 9, projectileRadiusPx: 7, knockbackPxS: 260,
      reloadDurationS: 1.04, reloadSequence: 'attack', reloadWindupFrac: 0.55, reloadStrikeFrac: 0.56, reloadHoldFrac: 0.692,
      fireDurationS: 1.04, fireSequence: 'attack', fireWindupFrac: 0.05, fireAtFrac: 0.08, fireHoldFrac: 0.17,
      staminaCost: 10,
      firePose: clonePoseSet(AUTHORED_FIRE_POSE),
      loadPose: clonePoseSet(AUTHORED_LOAD_POSE),
    },
    scatterbow: {
      label: 'Scatterbow', projectileSprite: 'assets/toolsprites/arrow_short.png',
      projectileCount: 6, spreadDeg: 28, damage: 5, speedPxS: 650,
      rangeTiles: 6.5, projectileRadiusPx: 4, knockbackPxS: 110,
      reloadDurationS: 1.04, reloadSequence: 'attack', reloadWindupFrac: 0.55, reloadStrikeFrac: 0.56, reloadHoldFrac: 0.692,
      fireDurationS: 1.04, fireSequence: 'attack', fireWindupFrac: 0.05, fireAtFrac: 0.08, fireHoldFrac: 0.17,
      staminaCost: 14,
      firePose: clonePoseSet(AUTHORED_FIRE_POSE),
      loadPose: clonePoseSet(AUTHORED_LOAD_POSE),
    },
  };

  function init(injectedDeps) {
    deps = injectedDeps;
    ensureAmmoState();
    deps.debugLog?.('Ranged update: friendly-fire actor cover, loaded-before-fire LOS repositioning, and same-frame hitbox/perp caches enabled.');
  }

  function gear() { return deps?.getGearInventory?.() || null; }
  function ensureAmmoState() {
    const g = gear();
    if (!g) return null;
    g.specialAmmo = Math.max(0, Math.min(SPECIAL_AMMO_MAX, Math.floor(Number(g.specialAmmo) || 0)));
    if (!g.rangedAmmoLoadouts || typeof g.rangedAmmoLoadouts !== 'object') g.rangedAmmoLoadouts = {};
    if (!Array.isArray(g.unlockedSpecialAmmo)) g.unlockedSpecialAmmo = [];
    for (const id of Object.keys(SPECIAL_AMMO_TYPES)) if (!g.unlockedSpecialAmmo.includes(id)) g.unlockedSpecialAmmo.push(id);
    return g;
  }

  function defaultAmmoLoadout() {
    return { basicEffects: { 1: null, 3: null, 5: null }, specialSlots: { 2: 'shrapnel', 4: 'concussive' }, activeAmmo: 'basic' };
  }

  function ammoLoadout(itemKey) {
    const g = ensureAmmoState();
    if (!g || !itemKey) return defaultAmmoLoadout();
    const current = g.rangedAmmoLoadouts[itemKey];
    if (!current || typeof current !== 'object') g.rangedAmmoLoadouts[itemKey] = defaultAmmoLoadout();
    const out = g.rangedAmmoLoadouts[itemKey];
    out.basicEffects = { 1: null, 3: null, 5: null, ...(out.basicEffects || {}) };
    out.specialSlots = { 2: 'shrapnel', 4: 'concussive', ...(out.specialSlots || {}) };
    if (typeof out.activeAmmo !== 'string') out.activeAmmo = 'basic';
    return out;
  }

  function rangedMastery(itemKey) { return Math.max(0, Math.min(5, Number(deps?.toolMasteryLevel?.(itemKey)) || 0)); }
  function notifyAmmoChanged() {
    deps?.saveGearInventory?.();
    deps?.refreshActionBar?.();
    document.dispatchEvent(new CustomEvent('hobunji-ranged-ammo-change'));
  }

  function setBasicEffect(itemKey, rank, effectId) {
    if (![1, 3, 5].includes(Number(rank)) || rangedMastery(itemKey) < Number(rank)) return false;
    if (!BASIC_AMMO_EFFECTS.some(effect => effect.id === effectId)) return false;
    ammoLoadout(itemKey).basicEffects[rank] = effectId;
    notifyAmmoChanged();
    return true;
  }

  function setSpecialSlot(itemKey, rank, ammoId) {
    if (![2, 4].includes(Number(rank)) || rangedMastery(itemKey) < Number(rank)) return false;
    const g = ensureAmmoState();
    if (!SPECIAL_AMMO_TYPES[ammoId] || !g?.unlockedSpecialAmmo.includes(ammoId)) return false;
    ammoLoadout(itemKey).specialSlots[rank] = ammoId;
    notifyAmmoChanged();
    return true;
  }

  function specialAmmoCount() { return ensureAmmoState()?.specialAmmo || 0; }
  function grantSpecialAmmo(amount = 1, announce = false) {
    const g = ensureAmmoState();
    if (!g) return 0;
    const before = g.specialAmmo;
    g.specialAmmo = Math.min(SPECIAL_AMMO_MAX, before + Math.max(0, Math.floor(Number(amount) || 0)));
    const gained = g.specialAmmo - before;
    if (gained) {
      notifyAmmoChanged();
      if (announce) deps?.showToast?.(`Found ${gained} Special Ammo (${g.specialAmmo}/${SPECIAL_AMMO_MAX}).`, true);
    }
    return gained;
  }

  function rollSpecialAmmoLoot() {
    if (specialAmmoCount() >= SPECIAL_AMMO_MAX || (deps?.random?.() ?? Math.random()) >= SPECIAL_AMMO_LOOT_CHANCE) return 0;
    return grantSpecialAmmo(1, false);
  }

  function ammoChoices(itemKey = deps?.getEquippedRangedKey?.()) {
    const loadout = ammoLoadout(itemKey);
    const mastery = rangedMastery(itemKey);
    const choices = [{ id: 'basic', label: 'Basic Ammo', icon: '🏹', available: true }];
    const seen = new Set();
    for (const rank of [2, 4]) {
      const ammoId = loadout.specialSlots[rank];
      if (mastery < rank || !SPECIAL_AMMO_TYPES[ammoId] || seen.has(ammoId)) continue;
      seen.add(ammoId);
      const def = SPECIAL_AMMO_TYPES[ammoId];
      choices.push({ id: ammoId, label: def.label, icon: def.icon, available: specialAmmoCount() > 0 });
    }
    return choices;
  }

  function activeAmmoId(itemKey = deps?.getEquippedRangedKey?.()) {
    const selected = ammoLoadout(itemKey).activeAmmo;
    const choice = ammoChoices(itemKey).find(entry => entry.id === selected && entry.available);
    return choice?.id || 'basic';
  }

  function setActiveAmmo(itemKey, ammoId) {
    const choice = ammoChoices(itemKey).find(entry => entry.id === ammoId && entry.available);
    if (!choice) return false;
    ammoLoadout(itemKey).activeAmmo = choice.id;
    notifyAmmoChanged();
    lastEvent = `player:${itemKey}:ammo-${choice.id}`;
    return true;
  }

  function cycleAmmo(itemKey = deps?.getEquippedRangedKey?.(), direction = 1) {
    const available = ammoChoices(itemKey).filter(entry => entry.available);
    if (!available.length) return 'basic';
    const index = Math.max(0, available.findIndex(entry => entry.id === activeAmmoId(itemKey)));
    const next = available[(index + Math.sign(direction || 1) + available.length) % available.length];
    setActiveAmmo(itemKey, next.id);
    return next.id;
  }

  function ammoActionLabel(itemKey = deps?.getEquippedRangedKey?.()) {
    const choice = ammoChoices(itemKey).find(entry => entry.id === activeAmmoId(itemKey));
    return `${choice?.label || 'Basic Ammo'}${choice?.id === 'basic' ? '' : ` (${specialAmmoCount()}/${SPECIAL_AMMO_MAX})`}`;
  }

  function playerAmmoPayload(itemKey) {
    const loadout = ammoLoadout(itemKey);
    const ammoId = activeAmmoId(itemKey);
    if (ammoId !== 'basic') {
      const special = SPECIAL_AMMO_TYPES[ammoId];
      return { ammoId, specialAmmoId: ammoId, afflictionBonuses: {}, knockbackMul: special.knockbackMul || 1, footingDamageMultiplier: special.footingDamageMultiplier || 0, trailColors: special.trailColors };
    }
    const afflictionBonuses = {};
    let knockbackMul = 1;
    const mastery = rangedMastery(itemKey);
    for (const rank of [1, 3, 5]) {
      if (mastery < rank) continue;
      const effect = BASIC_AMMO_EFFECTS.find(entry => entry.id === loadout.basicEffects[rank]);
      if (effect?.afflictionId) afflictionBonuses[effect.afflictionId] = (afflictionBonuses[effect.afflictionId] || 0) + 0.15;
      knockbackMul += effect?.knockbackMul || 0;
    }
    return { ammoId: 'basic', afflictionBonuses, knockbackMul, footingDamageMultiplier: 0 };
  }

  function consumeSpecialAmmo(payload) {
    if (!payload?.specialAmmoId) return;
    const g = ensureAmmoState();
    if (!g || g.specialAmmo <= 0) return;
    g.specialAmmo -= 1;
    if (g.specialAmmo <= 0) ammoLoadout(deps?.getEquippedRangedKey?.()).activeAmmo = 'basic';
    notifyAmmoChanged();
  }

  function applyConfig(config) {
    if (!config) return;
    for (const key of Object.keys(CONFIG)) {
      if (!config[key]) continue;
      const incoming = config[key];
      CONFIG[key] = {
        ...CONFIG[key],
        ...incoming,
        firePose: mergePoseSet(CONFIG[key].firePose, incoming.firePose),
        loadPose: mergePoseSet(CONFIG[key].loadPose, incoming.loadPose),
      };
    }
  }

  function defFor(itemKey) { return CONFIG[itemKey] || null; }
  function poseForAction(def, kind) { return kind === 'load' ? def.loadPose : def.firePose; }
  function isLoaded(itemKey, owner = null) {
    if (owner) return owner._rangedLoaded !== false;
    if (!playerLoaded.has(itemKey)) playerLoaded.set(itemKey, true);
    return playerLoaded.get(itemKey);
  }

  function setLoaded(itemKey, loaded, owner = null) {
    if (owner) owner._rangedLoaded = !!loaded;
    else playerLoaded.set(itemKey, !!loaded);
    deps?.setRangedLoadedVisual?.(itemKey, !!loaded, owner);
    if (!owner) deps?.refreshActionBar?.();
    lastEvent = `${owner ? owner.id : 'player'}:${itemKey}:${loaded ? 'loaded' : 'empty'}`;
  }

  function idlePose(itemKey, owner = null) {
    const def = defFor(itemKey);
    if (!def) return null;
    return (isLoaded(itemKey, owner) ? def.firePose : def.loadPose)?.neutral || null;
  }

  const POSE_CHANNELS = ['x', 'y', 'z', 'pitch', 'yaw', 'roll', 'bodyYaw'];
  function lerpPose(a, b, amount) {
    const k = Math.max(0, Math.min(1, amount));
    const pose = {};
    for (const key of POSE_CHANNELS) pose[key] = (a?.[key] ?? 0) + ((b?.[key] ?? 0) - (a?.[key] ?? 0)) * k;
    return pose;
  }

  function poseAtAction(def, kind, progress) {
    const poses = poseForAction(def, kind);
    const t = Math.max(0, Math.min(1, progress));
    const sequence = kind === 'load' ? (def.reloadSequence || 'attack') : (def.fireSequ