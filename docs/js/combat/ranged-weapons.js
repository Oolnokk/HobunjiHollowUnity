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

  // Shared by both loading weapons so crossbow and scatterbow use the exact
  // authored Scatterbow Fire pose set supplied by the animation editor.
  const AUTHORED_FIRE_POSE = {
    neutral: { x: 0.23, y: 0.08, z: 0.14, pitch: 16, yaw: 65, bodyYaw: -52, roll: 11, scale: 1.77 },
    windup:  { x: 0.34, y: 0.14, z: 0.11, pitch: -9, yaw: 86, bodyYaw: -76, roll: 12 },
    strike:  { x: 0.33, y: 0.11, z: 0.12, pitch: -9, yaw: 84, bodyYaw: -109, roll: 9 },
  };
  // Shared by both loading weapons while empty/reloading. Both authored
  // ranged stances use the same enlarged tool scale.
  const AUTHORED_LOAD_POSE = {
    neutral: { x: 0, y: 0.12, z: 0.18, pitch: -8, yaw: 0, bodyYaw: 0, roll: 0, scale: 1.77 },
    windup:  { x: 0, y: -0.17, z: 0.09, pitch: 77, yaw: 0, bodyYaw: -10, roll: 0 },
    strike:  { x: 0, y: 0.18, z: 0.08, pitch: -11, yaw: 0, bodyYaw: 7, roll: 0 },
  };
  // Used to give each weapon its own mutable pose objects when config
  // overrides are merged at runtime.
  function clonePoseSet(source) {
    return {
      neutral: { ...source.neutral },
      windup: { ...source.windup },
      strike: { ...source.strike },
    };
  }

  // Used by runtime tuning overrides so changing one channel or phase does
  // not erase the remaining authored channels in that action's pose set.
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
    deps.debugLog?.('Ranged update: portrait-scaled 3D actor hitboxes now share one screen-reticle shot line with live projectile collision.');
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
      const incoming = config[key]; // Used to merge tuning without discarding either authored action pose set.
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
    const def = defFor(itemKey); // Used to select the loaded or empty neutral stance for players and bandits.
    if (!def) return null;
    return (isLoaded(itemKey, owner) ? def.firePose : def.loadPose)?.neutral || null;
  }

  // Interpolated by bandit load/fire visuals; scale stays on the action's
  // neutral pose and is applied once to the holder instead of lerping.
  const POSE_CHANNELS = ['x', 'y', 'z', 'pitch', 'yaw', 'roll', 'bodyYaw'];
  function lerpPose(a, b, amount) {
    const k = Math.max(0, Math.min(1, amount)); // Used to keep every authored channel inside its two endpoint poses.
    const pose = {}; // Used as the complete interpolated transform returned to the bandit holder.
    for (const key of POSE_CHANNELS) pose[key] = (a?.[key] ?? 0) + ((b?.[key] ?? 0) - (a?.[key] ?? 0)) * k;
    return pose;
  }

  function poseAtAction(def, kind, progress) {
    const poses = poseForAction(def, kind); // Used as the action-specific neutral/windup/strike source.
    const t = Math.max(0, Math.min(1, progress)); // Used to safely evaluate the authored phase fractions.
    const sequence = kind === 'load' ? (def.reloadSequence || 'attack') : (def.fireSequence || 'fire'); // Used to decouple action state from pose playback order.
    const wf = kind === 'load' ? (def.reloadWindupFrac ?? 0.55) : (def.fireWindupFrac ?? 0.02); // Used as the authored windup arrival point.
    const sf = kind === 'load' ? (def.reloadStrikeFrac ?? 0.56) : (def.fireAtFrac ?? 0.18); // Used as the authored strike arrival point.
    const hf = kind === 'load' ? (def.reloadHoldFrac ?? sf) : (def.fireHoldFrac ?? sf); // Used as the end of the strike hold.
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

  // Crossbows play one cue. Scatterbows layer the corresponding cue with a
  // short delay and subtle pitch spread so the six-shot volley reads as a
  // chorus rather than six perfectly phase-aligned copies of one recording.
  function playRangedActionSfx(itemKey, kind, owner = null) {
    const audio = window.AudioSystem; // Used to route player cues through global SFX volume and bandit cues through existing distance falloff.
    const cfgEntry = audio?.combatSfxConfig?.()[kind === 'load' ? 'rangedLoad' : 'rangedFire']; // Used as the shared recording/config for this action phase.
    if (!cfgEntry) return;
    const delays = itemKey === 'scatterbow'
      ? (kind === 'load' ? SCATTERBOW_LOAD_CHORUS_MS : SCATTERBOW_FIRE_CHORUS_MS)
      : [0]; // Used to keep an ordinary crossbow mechanically singular.
    const layerVolumeScale = itemKey === 'scatterbow' ? (kind === 'load' ? 0.55 : 0.52) : 1; // Used to keep layered scatterbow cues balanced against one full-volume crossbow cue.
    lastAudioEvent = `${owner?.id || 'player'}:${itemKey}:${kind}:${delays.length}-layer`;
    delays.forEach((delayMs, index) => {
      const playLayer = () => {
        const pitch = itemKey === 'scatterbow' ? 0.96 + index * 0.018 : 1; // Used to keep delayed layers distinct without changing the source's identity.
        if (owner) {
          const spatialCfg = { ...cfgEntry, volume: (Number(cfgEntry.volume) || 0.8) * layerVolumeScale }; // Used because playCreatureSfxAt applies its own distance scale internally.
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
    const pose = poseForAction(def, kind); // Used by the player visual for this specific load/fire action.
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
      const aim = playerAimSolution(action.itemKey); // Re-resolved at release so the projectile follows the reticle's current screen-center ray, not the windup's stale ground aim.
      const angle = aim?.angle ?? deps.getPlayerAimAngle();
      const pitch = aim?.pitch ?? deps.getPlayerAimPitch?.() ?? 0;
      const ammoPayload = playerAmmoPayload(action.itemKey); // Resolved once so a scatter volley consumes one resource and every pellet shares its selected ammo.
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

  // Enemy arrows retain their sharp baseline. Player payloads come from the
  // equipped ranged weapon's mastery loadout and are resolved once per volley.
  function projectileAfflictionBonuses(def, team, ammoPayload) {
    if (team === 'player') return { ...(ammoPayload?.afflictionBonuses || {}) };
    const configured = def.afflictionBonuses; // Used by future ammunition/weapon definitions to declare their exact status payload.
    if (configured && typeof configured === 'object') return { ...configured };
    return { ...(window.ResourceSystem?.afflictionBonusesForTag?.(def.damageType || 'sharp') || {}) };
  }

  // Reuses the resource-ring/melee-trail palette verbatim. An affliction-free
  // projectile still receives a white comet, matching the melee cone trail's
  // plain-hit fallback rather than disappearing entirely.
  function projectileTrailColors(afflictionBonuses, overrides) {
    if (Array.isArray(overrides) && overrides.length) {
      return overrides.slice(0, PROJECTILE_TRAIL_MAX_LANES).map(entry => {
        const raw = entry.color ?? window.ResourceRings?.AFFLICTION_COLORS?.[entry.id] ?? 0xffffff;
        return { id: entry.id, color: window.ResourceRings?.neonizeColor?.(raw) ?? raw };
      });
    }
    const ids = Object.keys(afflictionBonuses || {}).filter(id => Number(afflictionBonuses[id]) > 0); // Used as both the visual lane list and mobile debug payload.
    if (!ids.length) return [{ id: 'plain', color: 0xffffff }];
    return ids.slice(0, PROJECTILE_TRAIL_MAX_LANES).map(id => {
      const raw = window.ResourceRings?.AFFLICTION_COLORS?.[id]; // Used to stay synchronized with resource rings and melee trails.
      const color = raw == null ? 0xffffff : (window.ResourceRings?.neonizeColor?.(raw) ?? raw); // Stored on the lane for its additive vertex gradient.
      return { id, color };
    });
  }

  function createProjectileTrails(scene, colorEntries, radiusPx) {
    const trailWidth = Math.max(0.012, radiusPx / deps.TILE * 0.32); // Used as the head width and spacing scale for this projectile's ribbons.
    return colorEntries.map((entry, laneIndex) => {
      const geometry = new THREE.BufferGeometry(); // Preallocated once and updated in place while this projectile flies.
      const positions = new Float32Array(PROJECTILE_TRAIL_MAX_POINTS * 2 * 3); // Holds left/right ribbon edges for every path sample.
      const colors = new Float32Array(PROJECTILE_TRAIL_MAX_POINTS * 2 * 3); // Holds the tail-to-head brightness gradient in the affliction hue.
      const indices = []; // Connects consecutive left/right pairs into the ribbon triangles.
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
      }); // Additive unlit material matches the existing melee trail treatment.
      const mesh = new THREE.Mesh(geometry, material); // Lives in world space so the tail stays behind as the projectile advances.
      mesh.name = `projectileCometTrail:${entry.id}`;
      mesh.frustumCulled = false;
      mesh.renderOrder = (deps.heldObjectRenderOrder || 1.5) - 0.01;
      scene.add(mesh);
      return { mesh, color: new THREE.Color(entry.color), id: entry.id, laneIndex, laneCount: colorEntries.length, trailWidth };
    });
  }

  function updateProjectileTrails(p) {
    const point = { x: p.x / deps.TILE, y: p.mesh.position.y - 0.01, z: p.y / deps.TILE }; // Appended in world space to form the visible comet path.
    const prior = p.trailPoints[p.trailPoints.length - 1]; // Used to suppress duplicate samples while a projectile is stationary/spawning.
    if (!prior || Math.hypot(point.x - prior.x, point.z - prior.z) > 0.01) p.trailPoints.push(point);
    while (p.trailPoints.length > PROJECTILE_TRAIL_MAX_POINTS) p.trailPoints.shift();
    const count = p.trailPoints.length; // Controls the active portion of each preallocated ribbon.
    if (count < 2) return;

    for (const lane of p.trailMeshes) {
      const positionAttr = lane.mesh.geometry.attributes.position; // Updated with the current sampled flight path.
      const colorAttr = lane.mesh.geometry.attributes.color; // Updated with a dim-tail/bright-head comet gradient.
      const laneOffset = (lane.laneIndex - (lane.laneCount - 1) / 2) * lane.trailWidth * 1.45; // Separates simultaneous affliction colors without widening one ribbon.
      for (let i = 0; i < count; i++) {
        const sample = p.trailPoints[i]; // Supplies this ribbon cross-section's world position.
        const before = p.trailPoints[Math.max(0, i - 1)]; // Supplies a stable tangent at the projectile head.
        const after = p.trailPoints[Math.min(count - 1, i + 1)]; // Supplies a stable tangent at the projectile tail.
        const dx = after.x - before.x, dz = after.z - before.z;
        const length = Math.hypot(dx, dz) || 1; // Normalizes the path-perpendicular vector safely.
        const px = -dz / length, pz = dx / length;
        const u = i / Math.max(1, count - 1); // Drives the narrow/dim tail into the wider/brighter projectile head.
        const halfWidth = lane.trailWidth * (0.18 + u * 0.82);
        const centerX = sample.x + px * laneOffset, centerZ = sample.z + pz * laneOffset;
        const vertex = i * 2;
        positionAttr.setXYZ(vertex, centerX - px * halfWidth, sample.y, centerZ - pz * halfWidth);
        positionAttr.setXYZ(vertex + 1, centerX + px * halfWidth, sample.y, centerZ + pz * halfWidth);
        const intensity = 0.05 + 0.95 * u * u; // Keeps the tail colored but makes its projectile-adjacent core read brightest.
        colorAttr.setXYZ(vertex, lane.color.r * intensity, lane.color.g * intensity, lane.color.b * intensity);
        colorAttr.setXYZ(vertex + 1, lane.color.r * intensity, lane.color.g * intensity, lane.color.b * intensity);
      }
      positionAttr.needsUpdate = true;
      colorAttr.needsUpdate = true;
      lane.mesh.geometry.setDrawRange(0, (count - 1) * 6);
      lane.mesh.visible = true;
    }
  }

  // Vertical aim support: pitch tilts the flight straight-line (no gravity —
  // arrows already flew dead level before this, this only adds a tilt to
  // that same line) rather than adding a full ballistic arc. Horizontal
  // speed is scaled down by cos(pitch) so a steep shot doesn't also fly
  // unrealistically far along the ground.
  function spawnProjectile(itemKey, x, y, angle, team, owner, ammoPayload = null, pitch = 0) {
    const def = defFor(itemKey);
    if (!def) return null;
    const scene = deps.getActiveScene();
    const mesh = createProjectileMesh(def, def.projectileRadiusPx);
    const afflictionBonuses = projectileAfflictionBonuses(def, team, ammoPayload); // Passed to both impact damage and comet color selection.
    const trailColors = projectileTrailColors(afflictionBonuses, ammoPayload?.trailColors); // Special ammo can author non-affliction palette lanes such as Disorient/Footing.
    const surfaceY = deps.worldSurfaceY(x, y);
    const worldY = surfaceY + 0.55;
    mesh.position.set(x / deps.TILE, worldY, y / deps.TILE);
    scene.add(mesh);
    const horizSpeedPxS = def.speedPxS * Math.cos(pitch);
    const p = {
      itemKey, def, team, owner, mesh, visual: mesh.userData.visual,
      x, y, prevX: x, prevY: y, worldY, prevWorldY: worldY,
      vx: Math.cos(angle) * horizSpeedPxS, vy: Math.sin(angle) * horizSpeedPxS,
      vyWorld: Math.sin(pitch) * (def.speedPxS / deps.TILE), // Tile-unit world-Y speed to match worldY's units.
      angle, pitch, distancePx: 0, maxDistancePx: def.rangeTiles * deps.TILE,
      areaId: deps.getCurrentArea(), pngRot: -angle + Math.PI / 2, perpState: {}, dead: false,
      afflictionBonuses, trailAfflictionIds: trailColors.map(entry => entry.id),
      ammoId: ammoPayload?.ammoId || 'enemy',
      specialAmmoId: ammoPayload?.specialAmmoId || null,
      knockbackMul: Number(ammoPayload?.knockbackMul) || 1,
      footingDamageMultiplier: Number(ammoPayload?.footingDamageMultiplier) || 0,
      trailPoints: [{ x: x / deps.TILE, y: surfaceY + 0.54, z: y / deps.TILE }], // Seeds the comet at the muzzle so it appears on the first moving frame.
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

  // Produces an upright THREE.Box3 in world coordinates from the portrait's
  // authored width/height and grounding offset. getWorldScale applies every
  // parent/body scale after the PNG builder's species/child portrait scale,
  // and a square X/Z footprint turns the billboard into a true 3D volume.
  function actorHitbox(actor) {
    if (!deps || !actor) return null;
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
    return {
      actor, box, center: worldPosition.clone(), width, height, depth,
      portraitWidth, portraitHeight, verticalOffset,
      bodyScale: { x: bodyScale.x, y: bodyScale.y, z: bodyScale.z },
    };
  }

  // Slab intersection against a swept-sphere-expanded Box3. The returned
  // fractions are measured along the supplied segment and are shared by
  // prediction and actual projectile impacts.
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

  // Generic centered-reticle resolver shared by combat and world
  // interactions. Each candidate supplies a Box3 directly or the same
  // actor-hitbox wrapper used by projectiles.
  function focusCandidates(candidates, maxDistanceWorld = 24) {
    const cameraRay = normalizedAimRay(deps?.getPlayerAimRay?.());
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

  // Horizontal attack cones remain authoritative for ordinary melee range;
  // this adds the missing vertical requirement using the same portrait body
  // volumes that centered aiming and projectile collision already share.
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

  // Finds the exact point under the centered HUD reticle. When its camera ray
  // crosses a hostile portrait box, the projectile converges from the player
  // muzzle to the middle of that volume; otherwise it converges at max range.
  function playerAimSolution(itemKey = deps?.getEquippedRangedKey?.()) {
    const def = defFor(itemKey);
    if (!def || !deps?.player) return null;
    const origin = playerProjectileOrigin();
    let direction = null;
    let targetPoint = null;
    let reticleTarget = null;
    const cameraRay = normalizedAimRay(deps.getPlayerAimRay?.());
    if (cameraRay) {
      const cameraToMuzzle = origin.clone().sub(cameraRay.origin);
      const rayDistance = Math.max(def.rangeTiles + 2, cameraToMuzzle.length() + def.rangeTiles + 2);
      const rayEnd = cameraRay.origin.clone().addScaledVector(cameraRay.direction, rayDistance);
      let nearest = null;
      for (const hostile of deps.hostileObjects) {
        if (hostile.health <= 0 || hostile.areaId !== deps.getCurrentArea()) continue;
        const interval = segmentHitboxInterval(cameraRay.origin, rayEnd, actorHitbox(hostile));
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
      const movedTiles = Math.hypot(entity.x - lastX, entity.y - lastY) / Math.max(1, deps.TILE); // Converts only this frame's travel into the self-inflicted status amount.
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

  function projectileHit(p) {
    const start = new THREE.Vector3(p.prevX / deps.TILE, p.prevWorldY, p.prevY / deps.TILE);
    const end = new THREE.Vector3(p.x / deps.TILE, p.worldY, p.y / deps.TILE);
    const projectileRadius = p.def.projectileRadiusPx / deps.TILE;
    if (p.team === 'player') {
      let nearest = null;
      for (const c of deps.hostileObjects) {
        if (c.health <= 0 || c.areaId && c.areaId !== p.areaId) continue;
        const interval = segmentHitboxInterval(start, end, actorHitbox(c), projectileRadius);
        if (!interval || (nearest && interval.enter >= nearest.interval.enter)) continue;
        nearest = { creature: c, interval };
      }
      if (!nearest) return false;
      const c = nearest.creature;
      deps.damageCreature(c, p.def.damage, p.prevX, p.prevY, p.def.knockbackPxS * p.knockbackMul, { tag: 'sharp', ranged: true, afflictionBonuses: p.afflictionBonuses, footingDamageMultiplier: p.footingDamageMultiplier });
      applySpecialAmmoDebuff(c, p.specialAmmoId);
      deps.awardRangedMastery?.(p.itemKey);
      return true;
    }
    const playerHit = segmentHitboxInterval(start, end, actorHitbox(deps.player), projectileRadius);
    if (!playerHit) return false;
    deps.damagePlayer(p.def.damage, p.prevX, p.prevY, p.def.knockbackPxS * p.knockbackMul, { tag: 'sharp', ranged: true, afflictionBonuses: p.afflictionBonuses, footingDamageMultiplier: p.footingDamageMultiplier });
    applySpecialAmmoDebuff(deps.player, p.specialAmmoId);
    return true;
  }

  function updateProjectileVisual(p, dt) {
    // This is intentionally the animal PNG-plane rotation path only. The
    // root sphere's vx/vy and trajectory angle are never changed here.
    const rawTargetRotY = -p.angle + Math.PI / 2;
    const perps = deps.cameraRelativeCreaturePerps();
    const deadRad = PROJECTILE_PERP_DEAD_RAD; // Dedicated 15-degree window; player and animal portrait tuning remains unchanged.
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
    for (const p of projectiles) {
      if (p.dead) continue;
      if (p.areaId !== deps.getCurrentArea()) { disposeProjectile(p); continue; }
      p.prevX = p.x; p.prevY = p.y; p.prevWorldY = p.worldY;
      const dx = p.vx * dt, dy = p.vy * dt;
      p.x += dx; p.y += dy; p.worldY += p.vyWorld * dt; p.distancePx += Math.hypot(dx, dy);
      const groundedAtGround = p.worldY <= deps.worldSurfaceY(p.x, p.y) + 0.08; // A pitched-down shot embeds in the terrain instead of clipping through it.
      if (!deps.canOccupyAt(p.x, p.y, p.def.projectileRadiusPx) || groundedAtGround || projectileHit(p) || p.distancePx >= p.maxDistancePx) {
        disposeProjectile(p);
        continue;
      }
      p.mesh.position.x = p.x / deps.TILE;
      p.mesh.position.z = p.y / deps.TILE;
      p.mesh.position.y = p.worldY;
      updateProjectileVisual(p, dt);
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
    if (c._rangedCooldownT <= 0) beginBanditAction(c, isLoaded(itemKey, c) ? 'fire' : 'load', targetPlayer);
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
    const actionPose = action ? poseForAction(def, action.kind) : null; // Used for action-specific neutral/windup/strike playback.
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

  function cancelBanditAction(c) { if (c) { c._rangedAction = null; c._rangedMode = false; } }
  function disposeOwner(c) { cancelBanditAction(c); if (c?._banditRangedToolHolder) c._banditRangedToolHolder.parent?.remove(c._banditRangedToolHolder); }

  // Drives the red HUD state with the same shot segment, portrait Box3
  // volumes, projectile radius, wall test, and terrain-floor test used by
  // live projectiles. A red reticle therefore means the released center
  // projectile has an unobstructed 3D body-volume impact.
  const WOULD_HIT_LOS_STEP_PX = 48;
  function wouldHitHostile() {
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

  function update(dt) { updatePlayerAction(dt); updateProjectiles(dt); updateAmmoDebuffs(); }
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
    get lastMeleeHeightBlock() { return deps?.getLastMeleeHeightBlock?.() || null; },
    get wouldHitHostile() { return wouldHitHostile(); },
    setPlayerLoaded: (itemKey, loaded) => setLoaded(itemKey, loaded),
    firePlayer: (itemKey) => startPlayerAction(itemKey),
    idlePose: itemKey => ({ ...idlePose(itemKey) }),
    snapshot: () => ({
      latestChange: 'The centered 3D aim ray now selects enemies, climb trunks, and nests through shared Box3 focus; melee also requires vertically reachable portrait body volumes.',
      lastEvent, lastAudioEvent, projectileDeadzoneDeg: PROJECTILE_PERP_DEAD_DEG,
      equippedRanged: deps?.getEquippedRangedKey?.() || null,
      activeAmmo: activeAmmoId(), specialAmmo: specialAmmoCount(), specialAmmoMax: SPECIAL_AMMO_MAX,
      playerDebuffs: { ...(deps?.player?._rangedAmmoDebuffs || {}) },
      activeProjectiles: projectiles.length,
      activeTrailMeshes: projectiles.reduce((sum, p) => sum + (p.trailMeshes?.length || 0), 0),
      loaded: Object.fromEntries(playerLoaded),
    }),
  };
})();
