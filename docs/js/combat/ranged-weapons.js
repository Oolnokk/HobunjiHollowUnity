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
  const WOULD_HIT_CACHE_MS = 50; // HUD prediction at 20 Hz is visually immediate while removing redundant per-frame collision work.
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
    const sequence = kind === 'load' ? (def.reloadSequence || 'attack') : (def.fireSequence || 'fire');
    const wf = kind === 'load' ? (def.reloadWindupFrac ?? 0.55) : (def.fireWindupFrac ?? 0.02);
    const sf = kind === 'load' ? (def.reloadStrikeFrac ?? 0.56) : (def.fireAtFrac ?? 0.18);
    const hf = kind === 'load' ? (def.reloadHoldFrac ?? sf) : (def.fireHoldFrac ?? sf);
    if (sequence === 'attack') {
      if (t <= wf) return lerpPose(poses.neutral, poses.windup, t / Math.max(0.0001, wf));
      if (t <= sf) return lerpPose(poses.windup, poses.strike, (t - wf) / Math.max(0.0001, sf - wf));
    } else if (sequence === 'load') {
      if (t <= wf) return lerpPose(poses.neutral, poses.windup, t / Math.max(0.0001, wf));
      return lerpPose(poses.windup, poses.neutral, (t - wf) / Math.max(0.0001, 1 - wf));
    } else if (t <= sf) {
      return lerpPose(poses.neutral, poses.strike, t / Math.max(0.0001, sf));
    }
    if (t <= hf) return { ...poses.strike };
    return lerpPose(poses.strike, poses.neutral, (t - hf) / Math.max(0.0001, 1 - hf));
  }

  function playerActionLabel(itemKey) {
    const def = defFor(itemKey);
    if (!def) return 'Fire';
    if (playerAction) return playerAction.kind === 'load' ? 'Loading…' : 'Firing…';
    return isLoaded(itemKey) ? `Fire ${def.label}` : `Load ${def.label}`;
  }

  function playRangedActionSfx(itemKey, kind, owner = null) {
    const audio = window.AudioSystem;
    const cfgEntry = audio?.combatSfxConfig?.()[kind === 'load' ? 'rangedLoad' : 'rangedFire'];
    if (!cfgEntry) return;
    const delays = itemKey === 'scatterbow'
      ? (kind === 'load' ? SCATTERBOW_LOAD_CHORUS_MS : SCATTERBOW_FIRE_CHORUS_MS)
      : [0];
    const layerVolumeScale = itemKey === 'scatterbow' ? (kind === 'load' ? 0.55 : 0.52) : 1;
    lastAudioEvent = `${owner?.id || 'player'}:${itemKey}:${kind}:${delays.length}-layer`;
    delays.forEach((delayMs, index) => {
      const playLayer = () => {
        const pitch = itemKey === 'scatterbow' ? 0.96 + index * 0.018 : 1;
        if (owner) {
          const spatialCfg = { ...cfgEntry, volume: (Number(cfgEntry.volume) || 0.8) * layerVolumeScale };
          audio.playCreatureSfxAt?.(owner, spatialCfg, pitch);
        } else audio.playOneShotSfx?.(cfgEntry, layerVolumeScale, pitch);
      };
      if (delayMs > 0) setTimeout(playLayer, delayMs);
      else playLayer();
    });
  }

  function startPlayerAction(itemKey) {
    const def = defFor(itemKey);
    if (!def || playerAction) return false;
    const loaded = isLoaded(itemKey);
    const kind = loaded ? 'fire' : 'load';
    if (kind === 'fire') window.ResourceSystem?.spendStamina?.(deps.player, def.staminaCost, `${def.label} fire`);
    const durationS = kind === 'fire' ? def.fireDurationS : def.reloadDurationS;
    const pose = poseForAction(def, kind);
    playerAction = { itemKey, def, kind, t: 0, durationS, fired: false };
    deps.triggerRangedWeaponVisual?.(durationS, {
      sequence: kind === 'fire' ? (def.fireSequence || 'fire') : (def.reloadSequence || 'attack'),
      pose,
      windupFrac: kind === 'load' ? (def.reloadWindupFrac ?? 0.55) : (def.fireWindupFrac ?? 0.02),
      strikeFrac: kind === 'fire' ? def.fireAtFrac : (def.reloadStrikeFrac ?? 0.56),
      holdFrac: kind === 'fire' ? (def.fireHoldFrac ?? Math.min(0.99, def.fireAtFrac + 0.12)) : (def.reloadHoldFrac ?? 0.57),
    });
    if (kind === 'load') playRangedActionSfx(itemKey, 'load');
    lastEvent = `player:${itemKey}:${kind}-start`;
    deps.refreshActionBar?.();
    return true;
  }

  function cancelPlayerAction() {
    playerAction = null;
    deps?.refreshActionBar?.();
  }

  function updatePlayerAction(dt) {
    if (!playerAction) return;
    const action = playerAction;
    action.t += dt;
    if (action.kind === 'fire' && !action.fired && action.t >= action.durationS * action.def.fireAtFrac) {
      action.fired = true;
      setLoaded(action.itemKey, false);
      playRangedActionSfx(action.itemKey, 'fire');
      const aim = playerAimSolution(action.itemKey);
      const angle = aim?.angle ?? deps.getPlayerAimAngle();
      const pitch = aim?.pitch ?? deps.getPlayerAimPitch?.() ?? 0;
      const ammoPayload = playerAmmoPayload(action.itemKey);
      spawnVolley(action.itemKey, deps.player.x, deps.player.y, angle, 'player', deps.player, ammoPayload, pitch);
      consumeSpecialAmmo(ammoPayload);
    }
    if (action.t < action.durationS) return;
    if (action.kind === 'load') setLoaded(action.itemKey, true);
    playerAction = null;
    deps.refreshActionBar?.();
  }

  function createProjectileMesh(def, radiusPx) {
    const root = new THREE.Group();
    root.name = 'rangedProjectile';
    const collider = new THREE.Mesh(
      new THREE.SphereGeometry(radiusPx / deps.TILE, 8, 6),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    collider.name = 'hiddenProjectileCollider';
    collider.userData.rangedCollider = true;
    root.add(collider);

    const visual = new THREE.Group();
    visual.name = 'projectilePngDeadzoneVisual';
    const texture = new THREE.TextureLoader().load(def.projectileSprite);
    texture.magFilter = texture.minFilter = THREE.NearestFilter;
    const longArrow = def.projectileSprite.includes('arrow_long');
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(longArrow ? 0.09 : 0.065, longArrow ? 0.72 : 0.38),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: 0.08, side: THREE.DoubleSide })
    );
    plane.rotation.x = -Math.PI / 2;
    plane.renderOrder = deps.heldObjectRenderOrder || 1.5;
    visual.add(plane);
    root.add(visual);
    root.userData.collider = collider;
    root.userData.visual = visual;
    return root;
  }

  function projectileAfflictionBonuses(def, team, ammoPayload) {
    if (team === 'player') return { ...(ammoPayload?.afflictionBonuses || {}) };
    const configured = def.afflictionBonuses;
    if (configured && typeof configured === 'object') return { ...configured };
    return { ...(window.ResourceSystem?.afflictionBonusesForTag?.(def.damageType || 'sharp') || {}) };
  }

  function projectileTrailColors(afflictionBonuses, overrides) {
    if (Array.isArray(overrides) && overrides.length) {
      return overrides.slice(0, PROJECTILE_TRAIL_MAX_LANES).map(entry => {
        const raw = entry.color ?? window.ResourceRings?.AFFLICTION_COLORS?.[entry.id] ?? 0xffffff;
        return { id: entry.id, color: window.ResourceRings?.neonizeColor?.(raw) ?? raw };
      });
    }
    const ids = Object.keys(afflictionBonuses || {}).filter(id => Number(afflictionBonuses[id]) > 0);
    if (!ids.length) return [{ id: 'plain', color: 0xffffff }];
    return ids.slice(0, PROJECTILE_TRAIL_MAX_LANES).map(id => {
      const raw = window.ResourceRings?.AFFLICTION_COLORS?.[id];
      const color = raw == null ? 0xffffff : (window.ResourceRings?.neonizeColor?.(raw) ?? raw);
      return { id, color };
    });
  }

  function createProjectileTrails(scene, colorEntries, radiusPx) {
    const trailWidth = Math.max(0.012, radiusPx / deps.TILE * 0.32);
    return colorEntries.map((entry, laneIndex) => {
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array(PROJECTILE_TRAIL_MAX_POINTS * 2 * 3);
      const colors = new Float32Array(PROJECTILE_TRAIL_MAX_POINTS * 2 * 3);
      const indices = [];
      for (let i = 0; i < PROJECTILE_TRAIL_MAX_POINTS - 1; i++) {
        const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
        indices.push(a, b, c, b, d, c);
      }
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geometry.setIndex(indices);
      geometry.setDrawRange(0, 0);
      const material = new THREE.MeshBasicMaterial({
        transparent: true, opacity: 0.86, depthWrite: false, vertexColors: true,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `projectileCometTrail:${entry.id}`;
      mesh.frustumCulled = false;
      mesh.renderOrder = (deps.heldObjectRenderOrder || 1.5) - 0.01;
      scene.add(mesh);
      return { mesh, color: new THREE.Color(entry.color), id: entry.id, laneIndex, laneCount: colorEntries.length, trailWidth };
    });
  }

  function updateProjectileTrails(p) {
    const point = { x: p.x / deps.TILE, y: p.mesh.position.y - 0.01, z: p.y / deps.TILE };
    const prior = p.trailPoints[p.trailPoints.length - 1];
    if (!prior || Math.hypot(point.x - prior.x, point.z - prior.z) > 0.01) p.trailPoints.push(point);
    while (p.trailPoints.length > PROJECTILE_TRAIL_MAX_POINTS) p.trailPoints.shift();
    const count = p.trailPoints.length;
    if (count < 2) return;

    for (const lane of p.trailMeshes) {
      const positionAttr = lane.mesh.geometry.attributes.position;
      const colorAttr = lane.mesh.geometry.attributes.color;
      const laneOffset = (lane.laneIndex - (lane.laneCount - 1) / 2) * lane.trailWidth * 1.45;
      for (let i = 0; i < count; i++) {
        const sample = p.trailPoints[i];
        const before = p.trailPoints[Math.max(0, i - 1)];
        const after = p.trailPoints[Math.min(count - 1, i + 1)];
        const dx = after.x - before.x, dz = after.z - before.z;
        const length = Math.hypot(dx, dz) || 1;
        const px = -dz / length, pz = dx / length;
        const u = i / Math.max(1, count - 1);
        const halfWidth = lane.trailWidth * (0.18 + u * 0.82);
        const centerX = sample.x + px * laneOffset, centerZ = sample.z + pz * laneOffset;
        const vertex = i * 2;
        positionAttr.setXYZ(vertex, centerX - px * halfWidth, sample.y, centerZ - pz * halfWidth);
        positionAttr.setXYZ(vertex + 1, centerX + px * halfWidth, sample.y, centerZ + pz * halfWidth);
        const intensity = 0.05 + 0.95 * u * u;
        colorAttr.setXYZ(vertex, lane.color.r * intensity, lane.color.g * intensity, lane.color.b * intensity);
        colorAttr.setXYZ(vertex + 1, lane.color.r * intensity, lane.color.g * intensity, lane.color.b * intensity);
      }
      positionAttr.needsUpdate = true;
      colorAttr.needsUpdate = true;
      lane.mesh.geometry.setDrawRange(0, (count - 1) * 6);
      lane.mesh.visible = true;
    }
  }

  function spawnProjectile(itemKey, x, y, angle, team, owner, ammoPayload = null, pitch = 0) {
    const def = defFor(itemKey);
    if (!def) return null;
    const scene = deps.getActiveScene();
    const mesh = createProjectileMesh(def, def.projectileRadiusPx);
    const afflictionBonuses = projectileAfflictionBonuses(def, team, ammoPayload);
    const trailColors = projectileTrailColors(afflictionBonuses, ammoPayload?.trailColors);
    const surfaceY = deps.worldSurfaceY(x, y);
    const worldY = surfaceY + 0.55;
    mesh.position.set(x / deps.TILE, worldY, y / deps.TILE);
    scene.add(mesh);
    const horizSpeedPxS = def.speedPxS * Math.cos(pitch);
    const p = {
      itemKey, def, team, owner, mesh, visual: mesh.userData.visual,
      x, y, prevX: x, prevY: y, worldY, prevWorldY: worldY,
      vx: Math.cos(angle) * horizSpeedPxS, vy: Math.sin(angle) * horizSpeedPxS,
      vyWorld: Math.sin(pitch) * (def.speedPxS / deps.TILE),
      angle, pitch, distancePx: 0, maxDistancePx: def.rangeTiles * deps.TILE,
      areaId: deps.getCurrentArea(), pngRot: -angle + Math.PI / 2, perpState: {}, dead: false,
      afflictionBonuses, trailAfflictionIds: trailColors.map(entry => entry.id),
      ammoId: ammoPayload?.ammoId || 'enemy',
      specialAmmoId: ammoPayload?.specialAmmoId || null,
      knockbackMul: Number(ammoPayload?.knockbackMul) || 1,
      footingDamageMultiplier: Number(ammoPayload?.footingDamageMultiplier) || 0,
      trailPoints: [{ x: x / deps.TILE, y: surfaceY + 0.54, z: y / deps.TILE }],
      trailMeshes: createProjectileTrails(scene, trailColors, def.projectileRadiusPx),
    };
    p.visual.rotation.y = p.pngRot;
    projectiles.push(p);
    return p;
  }

  function spawnVolley(itemKey, x, y, angle, team, owner, ammoPayload = null, pitch = 0) {
    const def = defFor(itemKey);
    if (!def) return [];
    const count = Math.max(1, Math.round(def.projectileCount));
    const spread = THREE.MathUtils.degToRad(def.spreadDeg || 0);
    const made = [];
    for (let i = 0; i < count; i++) {
      const u = count === 1 ? 0.5 : i / (count - 1);
      made.push(spawnProjectile(itemKey, x, y, angle + (u - 0.5) * spread, team, owner, ammoPayload, pitch));
    }
    lastEvent = `${team}:${itemKey}:volley-${count}`;
    return made;
  }

  function avatarNodeForActor(actor) {
    if (!actor) return null;
    if (actor === deps.player) return deps.getPlayerAvatarGroup?.() || null;
    if (actor.avatarGroup?.isObject3D) return actor.avatarGroup;
    if (actor.avatarRef?.group?.isObject3D) return actor.avatarRef.group;
    let found = null;
    actor.root?.traverse?.(child => {
      if (!found && Number.isFinite(child.userData?.portraitModelHeight)) found = child;
    });
    return found;
  }

  function positiveNumber(...values) {
    for (const value of values) {
      const number = Number(value);
      if (Number.isFinite(number) && number > 0) return number;
    }
    return null;
  }

  function actorHitbox(actor) {
    if (!deps || !actor) return null;
    const now = performance.now();
    const cached = actorHitboxCache.get(actor);
    if (cached && now - cached.at < ACTOR_HITBOX_CACHE_MS) return cached.value;
    const avatarNode = avatarNodeForActor(actor);
    const portraitWidth = positiveNumber(
      avatarNode?.userData?.portraitModelWidth,
      actor.avatarRef?.modelWidth,
      actor.visualModelWidth,
      actor.def?.modelWidth,
      deps.playerRadius ? (deps.playerRadius * 2 / deps.TILE) : null,
      0.6,
    );
    const portraitHeight = positiveNumber(
      avatarNode?.userData?.portraitModelHeight,
      actor.avatarRef?.modelHeight,
      actor.halfHeight ? actor.halfHeight * 2 : null,
      actor.def?.modelHeight,
      portraitWidth,
    );
    const worldPosition = new THREE.Vector3();
    const bodyScale = new THREE.Vector3(1, 1, 1);
    let verticalOffset = 0;
    if (avatarNode) {
      avatarNode.updateWorldMatrix?.(true, false);
      avatarNode.getWorldPosition(worldPosition);
      avatarNode.getWorldScale(bodyScale);
      const placementRatio = Number(avatarNode.userData?.portraitVerticalPlacementRatio);
      if (Number.isFinite(placementRatio)) {
        verticalOffset = (placementRatio - 0.5) * portraitHeight;
      } else {
        const planeOffset = Number(actor.avatarRef?.frontPlane?.position?.y);
        if (Number.isFinite(planeOffset)) verticalOffset = planeOffset;
      }
      worldPosition.y += verticalOffset * Math.abs(bodyScale.y);
    } else {
      worldPosition.set(
        (Number(actor.x) || 0) / deps.TILE,
        deps.worldSurfaceY(Number(actor.x) || 0, Number(actor.y) || 0) + portraitHeight / 2,
        (Number(actor.y) || 0) / deps.TILE,
      );
    }
    const horizontalScale = Math.max(Math.abs(bodyScale.x), Math.abs(bodyScale.z), AIM_EPSILON);
    const verticalScale = Math.max(Math.abs(bodyScale.y), AIM_EPSILON);
    const width = portraitWidth * horizontalScale;
    const height = portraitHeight * verticalScale;
    const depth = Math.max(HITBOX_MIN_DEPTH_TILES, width);
    const halfWidth = width / 2, halfHeight = height / 2, halfDepth = depth / 2;
    const box = new THREE.Box3(
      new THREE.Vector3(worldPosition.x - halfWidth, worldPosition.y - halfHeight, worldPosition.z - halfDepth),
      new THREE.Vector3(worldPosition.x + halfWidth, worldPosition.y + halfHeight, worldPosition.z + halfDepth),
    );
    const value = {
      actor, box, center: worldPosition.clone(), width, height, depth,
      portraitWidth, portraitHeight, verticalOffset,
      bodyScale: { x: bodyScale.x, y: bodyScale.y, z: bodyScale.z },
    };
    actorHitboxCache.set(actor, { at: now, value });
    return value;
  }

  function segmentHitboxInterval(start, end, hitbox, radius = 0) {
    if (!hitbox?.box) return null;
    let enter = 0, exit = 1;
    for (const axis of ['x', 'y', 'z']) {
      const delta = end[axis] - start[axis];
      const min = hitbox.box.min[axis] - radius;
      const max = hitbox.box.max[axis] + radius;
      if (Math.abs(delta) < AIM_EPSILON) {
        if (start[axis] < min || start[axis] > max) return null;
        continue;
      }
      let a = (min - start[axis]) / delta;
      let b = (max - start[axis]) / delta;
      if (a > b) [a, b] = [b, a];
      enter = Math.max(enter, a);
      exit = Math.min(exit, b);
      if (enter > exit) return null;
    }
    return exit >= 0 && enter <= 1 ? { enter: Math.max(0, enter), exit: Math.min(1, exit) } : null;
  }

  function actorDebugHitbox(label, actor) {
    const hitbox = actorHitbox(actor);
    if (!hitbox) return null;
    return {
      label,
      center: { x: hitbox.center.x, y: hitbox.center.y, z: hitbox.center.z },
      size: { width: hitbox.width, height: hitbox.height, depth: hitbox.depth },
      portrait: { width: hitbox.portraitWidth, height: hitbox.portraitHeight, verticalOffset: hitbox.verticalOffset },
      bodyScale: { ...hitbox.bodyScale },
    };
  }

  function playerProjectileOrigin() {
    return new THREE.Vector3(
      deps.player.x / deps.TILE,
      deps.worldSurfaceY(deps.player.x, deps.player.y) + 0.55,
      deps.player.y / deps.TILE,
    );
  }

  function normalizedAimRay(rawRay) {
    const origin = rawRay?.origin;
    const direction = rawRay?.direction;
    if (![origin?.x, origin?.y, origin?.z, direction?.x, direction?.y, direction?.z].every(Number.isFinite)) return null;
    const dir = new THREE.Vector3(direction.x, direction.y, direction.z);
    if (dir.lengthSq() < AIM_EPSILON) return null;
    return {
      origin: new THREE.Vector3(origin.x, origin.y, origin.z),
      direction: dir.normalize(),
    };
  }

  function interactionAimRay() {
    return normalizedAimRay(deps?.getPlayerInteractionRay?.() || deps?.getPlayerAimRay?.());
  }
  function focusCandidates(candidates, maxDistanceWorld = 24) {
    const cameraRay = interactionAimRay();
    const distance = Math.max(0.01, Number(maxDistanceWorld) || 24);
    if (!cameraRay || !Array.isArray(candidates) || !candidates.length) return null;
    const rayEnd = cameraRay.origin.clone().addScaledVector(cameraRay.direction, distance);
    let nearest = null;
    for (const candidate of candidates) {
      const hitbox = candidate?.hitbox?.box ? candidate.hitbox
        : candidate?.box?.isBox3 ? { box: candidate.box }
        : candidate?.box?.min && candidate?.box?.max ? { box: candidate.box }
        : null;
      const interval = segmentHitboxInterval(cameraRay.origin, rayEnd, hitbox);
      if (!interval || (nearest && interval.enter >= nearest.interval.enter)) continue;
      const middle = (interval.enter + interval.exit) / 2;
      nearest = {
        candidate, interval,
        distanceWorld: interval.enter * distance,
        point: cameraRay.origin.clone().lerp(rayEnd, middle),
      };
    }
    return nearest;
  }

  function focusedHostile(maxDistanceWorld = 24) {
    if (!deps?.hostileObjects) return null;
    const candidates = [];
    for (const hostile of deps.hostileObjects) {
      if (hostile.health <= 0 || hostile.areaId !== deps.getCurrentArea()) continue;
      const hitbox = actorHitbox(hostile);
      if (hitbox) candidates.push({ type: 'hostile', id: hostile.id || hostile.name || hostile.def?.id, data: hostile, hitbox });
    }
    return focusCandidates(candidates, maxDistanceWorld);
  }

  function meleeReachCheck(attacker, target, verticalAllowanceWorld = 0.4) {
    const attackerHitbox = actorHitbox(attacker);
    const targetHitbox = actorHitbox(target);
    if (!attackerHitbox || !targetHitbox) return { reachable: true, verticalGap: 0, allowance: verticalAllowanceWorld };
    const a = attackerHitbox.box, b = targetHitbox.box;
    const verticalGap = a.max.y < b.min.y ? b.min.y - a.max.y
      : b.max.y < a.min.y ? a.min.y - b.max.y
      : 0;
    const allowance = Math.max(0, Number(verticalAllowanceWorld) || 0);
    return { reachable: verticalGap <= allowance, verticalGap, allowance, attackerHitbox, targetHitbox };
  }
  function canMeleeReach(attacker, target, verticalAllowanceWorld = 0.4) {
    return meleeReachCheck(attacker, target, verticalAllowanceWorld).reachable;
  }

  function playerAimSolution(itemKey = deps?.getEquippedRangedKey?.()) {
    const def = defFor(itemKey);
    if (!def || !deps?.player) return null;
    const origin = playerProjectileOrigin();
    let direction = null;
    let targetPoint = null;
    let reticleTarget = null;
    const cameraRay = normalizedAimRay(deps.getPlayerAimRay?.());
    const aimRadius = Math.max(0, Number(def.projectileRadiusPx) || 0) / deps.TILE;
    if (cameraRay) {
      const cameraToMuzzle = origin.clone().sub(cameraRay.origin);
      const rayDistance = Math.max(def.rangeTiles + 2, cameraToMuzzle.length() + def.rangeTiles + 2);
      const rayEnd = cameraRay.origin.clone().addScaledVector(cameraRay.direction, rayDistance);
      let nearest = null;
      for (const hostile of deps.hostileObjects) {
        if (hostile.health <= 0 || hostile.areaId !== deps.getCurrentArea()) continue;
        const interval = segmentHitboxInterval(cameraRay.origin, rayEnd, actorHitbox(hostile), aimRadius);
        if (!interval || (nearest && interval.enter >= nearest.interval.enter)) continue;
        nearest = { hostile, interval };
      }
      if (nearest) {
        const middle = (nearest.interval.enter + nearest.interval.exit) / 2;
        targetPoint = cameraRay.origin.clone().lerp(rayEnd, middle);
        reticleTarget = nearest.hostile;
      } else {
        const alongMuzzle = cameraToMuzzle.dot(cameraRay.direction);
        targetPoint = cameraRay.origin.clone().addScaledVector(cameraRay.direction, Math.max(1, alongMuzzle + def.rangeTiles));
      }
      direction = targetPoint.clone().sub(origin);
      if (direction.lengthSq() < AIM_EPSILON) direction = cameraRay.direction.clone();
      else direction.normalize();
    }
    if (!direction) {
      const angle = deps.getPlayerAimAngle();
      const pitch = deps.getPlayerAimPitch?.() || 0;
      const horizontal = Math.cos(pitch);
      direction = new THREE.Vector3(Math.cos(angle) * horizontal, Math.sin(pitch), Math.sin(angle) * horizontal).normalize();
    }
    return {
      itemKey, origin, direction, targetPoint, reticleTarget,
      angle: Math.atan2(direction.z, direction.x),
      pitch: Math.asin(THREE.MathUtils.clamp(direction.y, -1, 1)),
      aimRadiusPx: aimRadius * deps.TILE,
    };
  }

  function shotSegment(solution, def) {
    const horizontal = Math.hypot(solution.direction.x, solution.direction.z);
    const travel = def.rangeTiles / Math.max(horizontal, AIM_EPSILON);
    return {
      start: solution.origin.clone(),
      end: solution.origin.clone().addScaledVector(solution.direction, travel),
    };
  }

  function applySpecialAmmoDebuff(entity, ammoId) {
    if (!entity || !ammoId) return;
    const now = performance.now();
    if (!entity._rangedAmmoDebuffs) entity._rangedAmmoDebuffs = {};
    if (ammoId === 'shrapnel') {
      entity._rangedAmmoDebuffs.shrapnelUntil = Math.max(entity._rangedAmmoDebuffs.shrapnelUntil || 0, now + SHRAPNEL_DURATION_MS);
      entity._rangedAmmoDebuffs.shrapnelX = entity.x;
      entity._rangedAmmoDebuffs.shrapnelY = entity.y;
    } else if (ammoId === 'concussive') {
      entity._rangedAmmoDebuffs.disorientUntil = Math.max(entity._rangedAmmoDebuffs.disorientUntil || 0, now + DISORIENT_DURATION_MS);
    }
  }

  function movementDirectionMultiplier(entity) {
    return entity?._rangedAmmoDebuffs?.disorientUntil > performance.now() ? -1 : 1;
  }

  function updateEntityAmmoDebuffs(entity) {
    const state = entity?._rangedAmmoDebuffs;
    if (!state) return;
    const now = performance.now();
    if (state.shrapnelUntil > now) {
      const lastX = Number.isFinite(state.shrapnelX) ? state.shrapnelX : entity.x;
      const lastY = Number.isFinite(state.shrapnelY) ? state.shrapnelY : entity.y;
      const movedTiles = Math.hypot(entity.x - lastX, entity.y - lastY) / Math.max(1, deps.TILE);
      if (movedTiles > 0 && !(entity.knockbackT > 0)) {
        window.ResourceSystem?.addAffliction?.(entity, 'bleedingHealth', movedTiles * 5);
        window.ResourceSystem?.addAffliction?.(entity, 'woundedStamina', movedTiles * 4);
      }
      state.shrapnelX = entity.x;
      state.shrapnelY = entity.y;
    } else {
      delete state.shrapnelUntil;
      delete state.shrapnelX;
      delete state.shrapnelY;
    }
    if (!(state.disorientUntil > now)) delete state.disorientUntil;
    if (!Object.keys(state).length) delete entity._rangedAmmoDebuffs;
  }

  function updateAmmoDebuffs() {
    updateEntityAmmoDebuffs(deps.player);
    for (const entity of deps.hostileObjects) updateEntityAmmoDebuffs(entity);
  }

  function nearestHostileHit(start, end, projectileRadius, areaId, exclude = null) {
    let nearest = null;
    for (const c of deps.hostileObjects) {
      if (c === exclude || c.id === exclude?.id || c.health <= 0 || (c.areaId && c.areaId !== areaId)) continue;
      const interval = segmentHitboxInterval(start, end, actorHitbox(c), projectileRadius);
      if (!interval || (nearest && interval.enter >= nearest.interval.enter)) continue;
      nearest = { creature: c, interval };
    }
    return nearest;
  }

  function projectileHit(p) {
    const start = new THREE.Vector3(p.prevX / deps.TILE, p.prevWorldY, p.prevY / deps.TILE);
    const end = new THREE.Vector3(p.x / deps.TILE, p.worldY, p.y / deps.TILE);
    const projectileRadius = p.def.projectileRadiusPx / deps.TILE;
    const coverHit = window.NearbyVolumeCollision?.segmentHit?.(start, end, projectileRadius) || null;
    if (p.team === 'player') {
      const nearest = nearestHostileHit(start, end, projectileRadius, p.areaId);
      if (coverHit && (!nearest || coverHit.t <= nearest.interval.enter)) return true;
      if (!nearest) return false;
      const c = nearest.creature;
      deps.damageCreature(c, p.def.damage, p.prevX, p.prevY, p.def.knockbackPxS * p.knockbackMul, { tag: 'sharp', ranged: true, afflictionBonuses: p.afflictionBonuses, footingDamageMultiplier: p.footingDamageMultiplier });
      applySpecialAmmoDebuff(c, p.specialAmmoId);
      deps.awardRangedMastery?.(p.itemKey);
      return true;
    }

    const playerInterval = segmentHitboxInterval(start, end, actorHitbox(deps.player), projectileRadius);
    const friendly = nearestHostileHit(start, end, projectileRadius, p.areaId, p.owner);
    let nearest = playerInterval ? { kind: 'player', interval: playerInterval, actor: deps.player } : null;
    if (friendly && (!nearest || friendly.interval.enter < nearest.interval.enter)) {
      nearest = { kind: 'hostile', interval: friendly.interval, actor: friendly.creature };
    }
    if (coverHit && (!nearest || coverHit.t <= nearest.interval.enter)) return true;
    if (!nearest) return false;
    if (nearest.kind === 'hostile') {
      friendlyFireHits++;
      deps.damageCreature(nearest.actor, p.def.damage, p.prevX, p.prevY, p.def.knockbackPxS * p.knockbackMul, { tag: 'sharp', ranged: true, friendlyFire: true, afflictionBonuses: p.afflictionBonuses, footingDamageMultiplier: p.footingDamageMultiplier });
      applySpecialAmmoDebuff(nearest.actor, p.specialAmmoId);
      lastEvent = `friendly-fire:${p.owner?.id || 'enemy'}->${nearest.actor.id || nearest.actor.name || 'hostile'}`;
      return true;
    }
    deps.damagePlayer(p.def.damage, p.prevX, p.prevY, p.def.knockbackPxS * p.knockbackMul, { tag: 'sharp', ranged: true, afflictionBonuses: p.afflictionBonuses, footingDamageMultiplier: p.footingDamageMultiplier });
    applySpecialAmmoDebuff(deps.player, p.specialAmmoId);
    return true;
  }

  function updateProjectileVisual(p, dt, sharedPerps = null) {
    const rawTargetRotY = -p.angle + Math.PI / 2;
    const perps = sharedPerps || deps.cameraRelativeCreaturePerps();
    const deadRad = PROJECTILE_PERP_DEAD_RAD;
    const mode = window.PerpRotation?.CREATURE_PLANE_ROT_MODE;
    if (mode === 'snap') {
      const result = window.PerpRotation.creatureSnapSwayTarget(p.perpState, rawTargetRotY, perps, deadRad, dt, true);
      if (result.snap) p.pngRot = result.target;
      else p.pngRot += deps.angleDiff(result.target, p.pngRot) * Math.min(1, dt * 10);
    } else if (mode === 'sway') {
      const target = window.PerpRotation.creatureDeadzoneTarget(p.perpState, rawTargetRotY, perps, deadRad, dt, true);
      p.pngRot += deps.angleDiff(target, p.pngRot) * Math.min(1, dt * 10);
    } else if (window.PerpRotation?.perpClamp) {
      const result = window.PerpRotation.perpClamp(p.perpState, rawTargetRotY, perps, deadRad);
      if (result.snapTo !== null) p.pngRot = result.effectiveTarget;
      else p.pngRot += deps.angleDiff(result.effectiveTarget, p.pngRot) * Math.min(1, dt * 10);
    }
    p.visual.rotation.y = p.pngRot;
  }

  function disposeProjectile(p) {
    p.dead = true;
    p.mesh.parent?.remove(p.mesh);
    p.mesh.traverse(child => {
      child.geometry?.dispose?.();
      child.material?.map?.dispose?.();
      child.material?.dispose?.();
    });
    for (const lane of p.trailMeshes || []) {
      lane.mesh.parent?.remove(lane.mesh);
      lane.mesh.geometry?.dispose?.();
      lane.mesh.material?.dispose?.();
    }
  }

  function updateProjectiles(dt) {
    const sharedPerps = projectiles.some(p => !p.dead) ? deps.cameraRelativeCreaturePerps() : null;
    for (const p of projectiles) {
      if (p.dead) continue;
      if (p.areaId !== deps.getCurrentArea()) { disposeProjectile(p); continue; }
      p.prevX = p.x; p.prevY = p.y; p.prevWorldY = p.worldY;
      const dx = p.vx * dt, dy = p.vy * dt;
      p.x += dx; p.y += dy; p.worldY += p.vyWorld * dt; p.distancePx += Math.hypot(dx, dy);
      const groundedAtGround = p.worldY <= deps.worldSurfaceY(p.x, p.y) + 0.08;
      if (!deps.canOccupyAt(p.x, p.y, p.def.projectileRadiusPx) || groundedAtGround || projectileHit(p) || p.distancePx >= p.maxDistancePx) {
        disposeProjectile(p);
        continue;
      }
      p.mesh.position.x = p.x / deps.TILE;
      p.mesh.position.z = p.y / deps.TILE;
      p.mesh.position.y = p.worldY;
      updateProjectileVisual(p, dt, sharedPerps);
      updateProjectileTrails(p);
    }
    for (let i = projectiles.length - 1; i >= 0; i--) if (projectiles[i].dead) projectiles.splice(i, 1);
  }

  function beginBanditAction(c, kind, targetPlayer) {
    const itemKey = c.def.rangedWeaponKey;
    const def = defFor(itemKey);
    if (!def) return;
    c._rangedMode = true;
    c._rangedAction = { kind, t: 0, durationS: kind === 'fire' ? def.fireDurationS : def.reloadDurationS, fired: false };
    c._rangedAimAngle = Math.atan2(targetPlayer.y - c.y, targetPlayer.x - c.x);
    if (kind === 'load') playRangedActionSfx(itemKey, 'load', c);
    lastEvent = `${c.id}:${itemKey}:${kind}-start`;
  }

  function banditLosSegment(c, targetPlayer) {
    const shooter = actorHitbox(c);
    const target = actorHitbox(targetPlayer);
    const start = shooter?.center?.clone?.() || new THREE.Vector3(c.x / deps.TILE, deps.worldSurfaceY(c.x, c.y) + 0.55, c.y / deps.TILE);
    const end = target?.center?.clone?.() || new THREE.Vector3(targetPlayer.x / deps.TILE, deps.worldSurfaceY(targetPlayer.x, targetPlayer.y) + 0.55, targetPlayer.y / deps.TILE);
    return { start, end };
  }

  function computeBanditLos(c, targetPlayer, def) {
    const segment = banditLosSegment(c, targetPlayer);
    const radiusWorld = Math.max(0, Number(def.projectileRadiusPx) || 0) / deps.TILE;
    const coverHit = window.NearbyVolumeCollision?.segmentHit?.(segment.start, segment.end, radiusWorld) || null;
    if (coverHit && coverHit.t < 0.985) return { clear: false, kind: 'cover', id: coverHit.object?.name || coverHit.key || coverHit.kind || 'cover' };

    let ally = null;
    for (const other of deps.hostileObjects) {
      if (other === c || other.id === c.id || other.health <= 0 || (other.areaId && other.areaId !== deps.getCurrentArea())) continue;
      const interval = segmentHitboxInterval(segment.start, segment.end, actorHitbox(other), radiusWorld);
      if (!interval || interval.enter <= 0.02 || interval.enter >= 0.985 || (ally && interval.enter >= ally.interval.enter)) continue;
      ally = { actor: other, interval };
    }
    if (ally) return { clear: false, kind: 'ally', id: ally.actor.id || ally.actor.name || 'ally' };

    const dxPx = (segment.end.x - segment.start.x) * deps.TILE;
    const dyPx = (segment.end.z - segment.start.z) * deps.TILE;
    const distancePx = Math.hypot(dxPx, dyPx);
    const stepPx = deps.TILE * BANDIT_LOS_TERRAIN_STEP_TILES;
    if (distancePx > stepPx) {
      const ux = dxPx / distancePx, uy = dyPx / distancePx;
      for (let travel = stepPx; travel < distancePx - stepPx * 0.35; travel += stepPx) {
        const x = c.x + ux * travel;
        const y = c.y + uy * travel;
        if (!deps.canOccupyAt(x, y, def.projectileRadiusPx)) return { clear: false, kind: 'tile', id: 'solid-tile' };
      }
    }
    return { clear: true, kind: 'clear', id: null };
  }

  function banditLosStatus(c, targetPlayer, def) {
    const now = performance.now();
    const cached = c._rangedLosCache;
    const moved = cached ? Math.hypot(c.x - cached.x, c.y - cached.y) : Infinity;
    const targetMoved = cached ? Math.hypot(targetPlayer.x - cached.tx, targetPlayer.y - cached.ty) : Infinity;
    if (cached && now - cached.at < BANDIT_LOS_CACHE_MS && moved < deps.TILE * 0.08 && targetMoved < deps.TILE * 0.08) return cached.result;
    const result = computeBanditLos(c, targetPlayer, def);
    c._rangedLosCache = { at: now, x: c.x, y: c.y, tx: targetPlayer.x, ty: targetPlayer.y, result };
    c._rangedLosDebug = { ...result, at: now };
    return result;
  }

  function repositionBanditForLos(c, targetPlayer, def, dt, los) {
    const dx = targetPlayer.x - c.x, dy = targetPlayer.y - c.y;
    const distance = Math.hypot(dx, dy) || 1;
    const nx = dx / distance, ny = dy / distance;
    if (c._rangedLosSide !== 1 && c._rangedLosSide !== -1) c._rangedLosSide = ((String(c.id || '').length + Math.floor(c.x / deps.TILE)) & 1) ? 1 : -1;
    const side = c._rangedLosSide;
    const strafePx = deps.TILE * BANDIT_LOS_STRAFE_TILES;
    const targetX = c.x - ny * side * strafePx + nx * deps.TILE * 0.08;
    const targetY = c.y + nx * side * strafePx + ny * deps.TILE * 0.08;
    const beforeX = c.x, beforeY = c.y;
    const moving = deps.moveCreatureToward(c, targetX, targetY, c.def.chaseSpeed, dt);
    if (Math.hypot(c.x - beforeX, c.y - beforeY) < 0.01) c._rangedLosSide = -side;
    c._rangedAimAngle = Math.atan2(targetPlayer.y - c.y, targetPlayer.x - c.x);
    c.facing = c._rangedAimAngle;
    c._rangedLosDebug = { ...(c._rangedLosDebug || los), repositioning: true, side: c._rangedLosSide, at: performance.now() };
    losRepositions++;
    return moving;
  }

  function updateBanditAI(c, dt, targetPlayer, distToPlayer) {
    const itemKey = c.def?.rangedWeaponKey;
    const def = defFor(itemKey);
    if (!def || !targetPlayer) return null;
    c._rangedCooldownT = Math.max(0, (c._rangedCooldownT || 0) - dt);
    const action = c._rangedAction;
    if (action) {
      action.t += dt;
      c._rangedAimAngle = Math.atan2(targetPlayer.y - c.y, targetPlayer.x - c.x);
      if (action.kind === 'fire' && !action.fired && action.t >= action.durationS * def.fireAtFrac) {
        action.fired = true;
        setLoaded(itemKey, false, c);
        playRangedActionSfx(itemKey, 'fire', c);
        spawnVolley(itemKey, c.x, c.y, c._rangedAimAngle, 'bandit', c);
      }
      if (action.t >= action.durationS) {
        if (action.kind === 'load') setLoaded(itemKey, true, c);
        c._rangedAction = null;
        c._rangedCooldownT = action.kind === 'fire' ? 0.55 : 0.18;
      }
      return { aimAngle: c._rangedAimAngle, moving: false, handled: true };
    }

    const minRange = deps.TILE * 2.25;
    const maxRange = deps.TILE * def.rangeTiles * 0.9;
    if (distToPlayer < minRange) { c._rangedMode = false; return null; }
    c._rangedMode = true;
    const aimAngle = Math.atan2(targetPlayer.y - c.y, targetPlayer.x - c.x);
    if (distToPlayer > maxRange) {
      const moving = deps.moveCreatureToward(c, targetPlayer.x, targetPlayer.y, c.def.chaseSpeed, dt);
      return { aimAngle, moving, handled: true };
    }

    if (!isLoaded(itemKey, c)) {
      if (c._rangedCooldownT <= 0) beginBanditAction(c, 'load', targetPlayer);
      return { aimAngle, moving: false, handled: true };
    }

    const los = banditLosStatus(c, targetPlayer, def);
    if (!los.clear) {
      const moving = repositionBanditForLos(c, targetPlayer, def, dt, los);
      return { aimAngle: c._rangedAimAngle, moving, handled: true, seekingLos: true };
    }
    c._rangedLosDebug = { ...los, repositioning: false, at: performance.now() };
    if (c._rangedCooldownT <= 0) beginBanditAction(c, 'fire', targetPlayer);
    return { aimAngle, moving: false, handled: true };
  }

  function updateBanditVisual(c) {
    const holder = c._banditRangedToolHolder;
    if (!holder) return;
    holder.visible = !!c._rangedMode;
    if (!holder.visible) return;
    const θ = c.facing || c._rangedAimAngle || 0;
    const action = c._rangedAction;
    const def = defFor(c.def.rangedWeaponKey);
    if (!def) return;
    const actionPose = action ? poseForAction(def, action.kind) : null;
    const neutral = actionPose?.neutral || idlePose(c.def.rangedWeaponKey, c);
    holder.scale.setScalar(Number.isFinite(Number(neutral?.scale)) ? Math.max(0.1, Number(neutral.scale)) : 1);
    let pose = neutral;
    if (action) {
      const t = Math.min(1, action.t / action.durationS);
      pose = poseAtAction(def, action.kind, t);
    }
    const vθ = θ + THREE.MathUtils.degToRad(pose.bodyYaw || 0);
    const rx = Math.cos(vθ), rz = -Math.sin(vθ), fx = Math.sin(vθ), fz = Math.cos(vθ);
    holder.position.set(c.x / deps.TILE + rx * (-0.34 + pose.x) + fx * pose.z, c.avatarRef.group.position.y + pose.y, c.y / deps.TILE + rz * (-0.34 + pose.x) + fz * pose.z);
    holder.rotation.set(THREE.MathUtils.degToRad(pose.pitch), vθ + THREE.MathUtils.degToRad(pose.yaw), THREE.MathUtils.degToRad(pose.roll), 'YXZ');
  }

  function cancelBanditAction(c) {
    if (c) {
      c._rangedAction = null;
      c._rangedMode = false;
      delete c._rangedLosCache;
      delete c._rangedLosDebug;
    }
  }
  function disposeOwner(c) { cancelBanditAction(c); if (c?._banditRangedToolHolder) c._banditRangedToolHolder.parent?.remove(c._banditRangedToolHolder); }

  const WOULD_HIT_LOS_STEP_PX = 48;
  function computeWouldHitHostile() {
    const itemKey = deps?.getEquippedRangedKey?.();
    const def = defFor(itemKey);
    if (!def || !isLoaded(itemKey)) return false;
    const solution = playerAimSolution(itemKey);
    if (!solution) return false;
    const segment = shotSegment(solution, def);
    const projectileRadius = def.projectileRadiusPx / deps.TILE;
    let nearest = null;
    for (const hostile of deps.hostileObjects) {
      if (hostile.health <= 0 || hostile.areaId !== deps.getCurrentArea()) continue;
      const interval = segmentHitboxInterval(segment.start, segment.end, actorHitbox(hostile), projectileRadius);
      if (!interval || (nearest && interval.enter >= nearest.interval.enter)) continue;
      nearest = { hostile, interval };
    }
    if (!nearest) return false;
    const coverHit = window.NearbyVolumeCollision?.segmentHit?.(segment.start, segment.end, projectileRadius) || null;
    if (coverHit && coverHit.t <= nearest.interval.enter) return false;
    const maxRangePx = def.rangeTiles * deps.TILE;
    const hitDistancePx = nearest.interval.enter * maxRangePx;
    const horizontalDirX = (segment.end.x - segment.start.x) / def.rangeTiles;
    const horizontalDirY = (segment.end.z - segment.start.z) / def.rangeTiles;
    for (let distancePx = WOULD_HIT_LOS_STEP_PX; distancePx < hitDistancePx; distancePx += WOULD_HIT_LOS_STEP_PX) {
      const fraction = distancePx / maxRangePx;
      const x = deps.player.x + horizontalDirX * distancePx;
      const y = deps.player.y + horizontalDirY * distancePx;
      const worldY = THREE.MathUtils.lerp(segment.start.y, segment.end.y, fraction);
      if (!deps.canOccupyAt(x, y, def.projectileRadiusPx) || worldY <= deps.worldSurfaceY(x, y) + 0.08) return false;
    }
    return true;
  }

  function wouldHitHostile() {
    const now = performance.now();
    if (now - wouldHitCacheAt < WOULD_HIT_CACHE_MS) {
      wouldHitCacheHits++;
      return wouldHitCacheValue;
    }
    wouldHitCacheAt = now;
    wouldHitCacheValue = computeWouldHitHostile();
    return wouldHitCacheValue;
  }

  function updateBanditAimLabel() {
    if (!deps?.isWeaponAiming?.()) {
      window.WorldPopupText?.clearAimLabel?.();
      return;
    }
    const focused = focusedHostile(deps.getAimLabelRangeWorld?.() ?? 14);
    const bandit = focused?.candidate?.data;
    if (!bandit?.isBandit || !bandit.avatarRef?.group) {
      window.WorldPopupText?.clearAimLabel?.();
      return;
    }
    const rank = window.BanditCombat?.RANK_LABEL?.[bandit.banditRank] ||
      String(bandit.banditRank || 'bandit').replace(/\b\w/g, letter => letter.toUpperCase());
    window.WorldPopupText?.setAimLabel?.(bandit.avatarRef.group, (bandit.name || 'Bandit') + ' · ' + rank);
  }

  function update(dt) { updatePlayerAction(dt); updateProjectiles(dt); updateAmmoDebuffs(); updateBanditAimLabel(); }
  function playerLockRangePx(itemKey) { return (defFor(itemKey)?.rangeTiles || 7) * (deps?.TILE || 64); }

  window.RangedWeapons = {
    init, applyConfig, startPlayerAction, cancelPlayerAction, playerActionLabel,
    isLoaded, setLoaded, update, updateBanditAI, updateBanditVisual,
    cancelBanditAction, disposeOwner, playerLockRangePx, playerIdlePose: itemKey => idlePose(itemKey),
    wouldHitHostile, playerAimSolution, actorHitbox,
    focusCandidates, focusedHostile, meleeReachCheck, canMeleeReach,
    ammoChoices, activeAmmoId, setActiveAmmo, cycleAmmo, ammoActionLabel,
    setBasicEffect, setSpecialSlot, specialAmmoCount, grantSpecialAmmo, rollSpecialAmmoLoot,
    movementDirectionMultiplier,
    equippedRangedKey: () => deps?.getEquippedRangedKey?.() || null,
    devBumpMastery: itemKey => deps?.devBumpToolMasteryLevel?.(itemKey),
    getLoadoutView: itemKey => ({ itemKey, mastery: rangedMastery(itemKey), loadout: JSON.parse(JSON.stringify(ammoLoadout(itemKey))), unlockedSpecialAmmo: [...(ensureAmmoState()?.unlockedSpecialAmmo || [])], specialAmmo: specialAmmoCount(), specialAmmoMax: SPECIAL_AMMO_MAX }),
    BASIC_AMMO_EFFECTS, SPECIAL_AMMO_TYPES,
    get config() { return CONFIG; },
  };
  window.__rangedDebug = {
    get projectiles() { return projectiles.map(p => ({ itemKey: p.itemKey, team: p.team, ammoId: p.ammoId, x: p.x, y: p.y, vx: p.vx, vy: p.vy, distancePx: p.distancePx, trailAfflictionIds: [...p.trailAfflictionIds] })); },
    get playerAction() { return playerAction ? { ...playerAction, def: undefined } : null; },
    get lastEvent() { return lastEvent; },
    get lastAudioEvent() { return lastAudioEvent; },
    get aimPitchDeg() { return THREE.MathUtils.radToDeg(playerAimSolution()?.pitch ?? deps?.getPlayerAimPitch?.() ?? 0); },
    get aimSolution() {
      const aim = playerAimSolution();
      return aim ? {
        angleDeg: THREE.MathUtils.radToDeg(aim.angle), pitchDeg: THREE.MathUtils.radToDeg(aim.pitch),
        origin: { x: aim.origin.x, y: aim.origin.y, z: aim.origin.z },
        direction: { x: aim.direction.x, y: aim.direction.y, z: aim.direction.z },
        reticleTarget: aim.reticleTarget?.id || aim.reticleTarget?.name || aim.reticleTarget?.def?.id || null,
      } : null;
    },
    get actorHitboxes() {
      return [
        actorDebugHitbox('player', deps?.player),
        ...(deps?.hostileObjects || []).filter(c => c.health > 0 && c.areaId === deps.getCurrentArea()).map((c, index) => actorDebugHitbox(c.id || c.name || `hostile-${index}`, c)),
        ...(deps?.npcWalkers || []).filter(npc => npc.area === deps.getCurrentArea()).map((npc, index) => actorDebugHitbox(npc.id || npc.name || `npc-${index}`, npc)),
      ].filter(Boolean);
    },
    get focusedHostile() {
      const focus = focusedHostile();
      return focus ? { id: focus.candidate.id || null, distanceWorld: focus.distanceWorld } : null;
    },
    get banditLos() {
      return [...(deps?.hostileObjects || [])].filter(c => c.health > 0 && c._rangedLosDebug).map(c => ({ id: c.id || c.name, ...c._rangedLosDebug }));
    },
    get lastMeleeHeightBlock() { return deps?.getLastMeleeHeightBlock?.() || null; },
    get wouldHitHostile() { return wouldHitHostile(); },
    setPlayerLoaded: (itemKey, loaded) => setLoaded(itemKey, loaded),
    firePlayer: (itemKey) => startPlayerAction(itemKey),
    idlePose: itemKey => ({ ...idlePose(itemKey) }),
    snapshot: () => ({
      latestChange: 'Enemy bodies now block allied shots and take friendly-fire damage; loaded ranged AI strafes for LOS before firing. Actor hitboxes/projectile perps are shared within the frame and HUD LOS is throttled to 20 Hz.',
      lastEvent, lastAudioEvent, projectileDeadzoneDeg: PROJECTILE_PERP_DEAD_DEG,
      equippedRanged: deps?.getEquippedRangedKey?.() || null,
      activeAmmo: activeAmmoId(), specialAmmo: specialAmmoCount(), specialAmmoMax: SPECIAL_AMMO_MAX,
      playerDebuffs: { ...(deps?.player?._rangedAmmoDebuffs || {}) },
      activeProjectiles: projectiles.length,
      activeTrailMeshes: projectiles.reduce((sum, p) => sum + (p.trailMeshes?.length || 0), 0),
      friendlyFireHits, losRepositions, wouldHitCacheHits,
      loaded: Object.fromEntries(playerLoaded),
    }),
  };
})();
