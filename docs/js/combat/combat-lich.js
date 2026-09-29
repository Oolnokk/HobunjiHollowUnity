// Harlyao Lich testing-arena enemy class.
//
// Three elemental lich traditions reuse the Harlyao Skeleton portrait/wardrobe
// and shared humanoid hostile shell, but own their spell AI/projectiles here.
// Nothing in this file spawns outside map_dev_arena or an area that opted in
// through allowArea() (the Random Test Ruin's boss sanctum).
(() => {
  'use strict';

  const CLASS_ID = 'harlyao-lich'; // Semantic enemyClass used by the shared hostile loop to distinguish liches from ordinary Bandits/Minions.
  const ARENA_ID = 'map_dev_arena'; // Hard confinement guard checked by construction, AI, projectiles, puddles, and summons.
  const HOOD_ID = 'ragged_hood'; // Forced hood cosmetic on every lich roster.
  const BODYWRAP_ID = 'tankan_bodywrap'; // Forced overwear cosmetic sharing the hood's exact rolled dye.
  const GOO_SLOW_MAX_STACKS = 4; // Direct Kanthic hits can build to this movement-slow cap.
  const GOO_SLOW_DURATION_MS = 4800; // Every direct blob hit refreshes the full stack lifetime.
  const GOO_SLOW_PER_STACK = 0.13; // Used by player/enemy locomotion multipliers; four stacks bottom out near half speed.
  const ENTRANCED_FAST_RECOVERY_PER_S = 12; // Standing still or obeying the command clears Entranced Health quickly.
  const ENTRANCED_BASE_RECOVERY_PER_S = 3; // Sideways/neutral movement still recovers, but much more slowly.
  const ENTRANCED_WRONG_MOVE_DAMAGE_PER_TILE = 3.6; // One-fifth of the original movement conversion: wrong-way travel consumes/damages 3.6 Entranced Health per tile instead of 18.
  const ENTRANCED_COMMAND_ANNOUNCE_MS = 750; // New commands first show "<enemy> commands you to ..." before the numeric grace countdown.
  const ENTRANCED_COMMAND_COUNTDOWN_MS = 3000; // Three one-second 3→2→1 beats during which Entranced neither damages nor naturally recovers.
  const ENTRANCED_COMMAND_GRACE_MS = ENTRANCED_COMMAND_ANNOUNCE_MS + ENTRANCED_COMMAND_COUNTDOWN_MS; // Full immunity/freeze interval around every initial or changed command.
  const ENTRANCED_COMMAND_MIN_HOLD_MS = 10000; // Minimum time a command stays in force after its grace window ends.
  const PUDDLE_RADIUS_TILES = 0.82; // Kanthic misses make a gameplay hazard this far from the visual puddle center.
  const PUDDLE_LIFETIME_S = 9; // Short arena-readable lifetime before gasoline fades/disposes.
  const PUDDLE_TICK_S = 0.35; // Entranced buildup cadence while an actor remains inside gasoline.
  const PUDDLE_ENTRANCED_PER_TICK = 3.4; // Repeated buildup per puddle tick; latest puddle owner becomes the referential lich.
  const SUMMON_CAP = 3; // Per-lich live Minion cap prevents an unattended arena test from growing forever.
  const LUNGE_RING_REFERENCE_OUTER_RADIUS = 0.46; // Reference size of the familiar lunge-trail ground circle; used only so the Entranced owner marker can be authored explicitly at 2× diameter.
  const LUNGE_RING_REFERENCE_THICKNESS = 0.14; // Reference lunge-trail line width; Entranced doubles this independently from diameter.
  const ENTRANCER_RING_OUTER_RADIUS = LUNGE_RING_REFERENCE_OUTER_RADIUS * 2; // Twice the lunge circle diameter/radius scale requested for the controlling lich marker.
  const ENTRANCER_RING_THICKNESS = LUNGE_RING_REFERENCE_THICKNESS * 2; // Twice the lunge-circle line thickness requested for the controlling lich marker.
  const ENTRANCER_RING_PULSE_MS = 1000; // One explosive outward pulse per second while this lich remains the player's referential Entranced source.
  const ENTRANCER_RING_BURST_FRACTION = 0.24; // First quarter-second of each cycle carries the rapid expansion/fade; the rest stays as a faint ownership ring.
  const ENTRANCER_AURA_MAX_PARTICLES = 104; // Large body-height Entranced fire aura budget; intentionally stronger than Burning Health's ordinary 40-particle presentation.
  const LICH_CAST_WEAPON_KEY = 'pickshovel_nativeCopper'; // Existing Light Weapon definition used only as the invisible one-handed casting pose/grip authority.
  const LICH_CAST_COMBO_ID = 'pokeCombo'; // Existing light-weapon thrust combo whose authored Neutral/Windup/Strike poses animate every lich ability.
  const HOVER_HEIGHT_MODEL_FRACTION = 0.58; // Active lich body lift relative to rendered portrait height; keeps feet visibly above their summoned Minions.
  const HOVER_HEIGHT_MIN_WORLD = 0.44; // Minimum world-space lift keeps even short skeleton variants clearly airborne.
  const HOVER_BOB_MODEL_FRACTION = 0.045; // Small model-relative vertical oscillation prevents the airborne body from reading as rigidly translated.
  const HOVER_BOB_PERIOD_S = 2.6; // Slow float cadence kept separate from the faster dangling-leg sway.
  const TOTHAL_WIND_RANGE_TILES = 5.5; // Strong local wind BGS radius follows each slow Blizzard orb rather than globally replacing arena ambience.
  const TOTHAL_WIND_VOLUME = 0.78; // Explicitly much stronger than ordinary weather wind while still respecting the shared game-audio transport.
  const HRONAL_ERUPTION_RADIUS_TILES = 1.35 / 3; // Exactly one third of Grehlr Burrow's authored minimum 1.35-tile telegraph/hit radius.
  const HRONAL_STONE_PARTICLES_PER_S = 58; // Keep the dense authored spray; instancing below removes the old one-draw-call-per-stone cost.
  const HRONAL_STONE_INSTANCE_CAP = 112; // Hard per-eruption visual cap prevents overlapping warnings from growing unbounded while preserving the dense look.
  const HRONAL_LAVA_VISUAL_S = 0.62; // Short lava flare remains after damage resolution so the eruption reads clearly.
  const HRONAL_LAVA_FOUNTAIN_HEIGHT_MULT = 3.4; // Central eruption jet rises several AOE radii before collapsing with the lava flash.
  const WESTERN_SLOPE_SNOW_DEPTH_REFERENCE = 0.22; // Mirrors EnvironmentSurfaceMicroPlateau.SURFACE_DEPTH so Kanthic petroleum can deliberately read as the same raised-surface family.
  const PETROLEUM_SURFACE_DEPTH = WESTERN_SLOPE_SNOW_DEPTH_REFERENCE / 4; // Requested one-quarter snow height: a very shallow black petroleum skin instead of a tall puddle blob.
  const PETROLEUM_OPACITY = 0.70; // Requested fixed petroleum surface opacity.
  const PETROLEUM_TEXTURE_PATH = 'assets/textures/canvas.png'; // Exact canvas texture used by the Western Slope snow surface.
  const TYPE_ORDER = Object.freeze(['tothal', 'hronal', 'kanthic']); // Stable order used by the dev-spawner buttons and diagnostics.
  const HUE_VARIANTS = Object.freeze(['pure', 'muted', 'dusty', 'dark_muted']); // Existing authored dye variants combined with each tradition's hue families.

  const TYPE_DEFS = Object.freeze({
    tothal: Object.freeze({
      id: 'tothal', label: 'Tothal Lich',
      hues: Object.freeze(['green_blue', 'blue', 'blue_indigo']),
      castCooldownS: 2.45, preferredMinTiles: 4.25, preferredMaxTiles: 7,
      projectile: Object.freeze({
        speedPxS: 96, gravityWorldS2: 0, maxAgeS: 8.5, radiusWorld: 0.22,
        damage: 5, knockbackPxS: 930, footingDamageMultiplier: 5.2,
        frostbittenStamina: 42, homingBlendPerS: 3.2, wiggleWorld: 0.12,
      }),
    }),
    hronal: Object.freeze({
      id: 'hronal', label: 'Hronal Lich',
      hues: Object.freeze(['red', 'red_orange', 'orange', 'yellow_orange', 'yellow']),
      castCooldownS: 2.65, preferredMinTiles: 3.6, preferredMaxTiles: 6.5,
      projectile: Object.freeze({
        eruptionRadiusTiles: HRONAL_ERUPTION_RADIUS_TILES,
        burningHealth: 17,
      }),
    }),
    kanthic: Object.freeze({
      id: 'kanthic', label: 'Kanthic Lich',
      hues: Object.freeze(['indigo', 'indigo_violet', 'violet']),
      neutralDyes: Object.freeze(['dye:CLOTH:white', 'dye:CLOTH:gray', 'dye:CLOTH:charcoal']),
      castCooldownS: 2.15, preferredMinTiles: 3.1, preferredMaxTiles: 5.8,
      projectile: Object.freeze({
        speedPxS: 980, gravityWorldS2: 28, maxAgeS: 2.2, radiusWorld: 0.18,
        damage: 3, knockbackPxS: 70, footingDamageMultiplier: 0.15,
        entrancedHealth: 18,
      }),
    }),
  });

  let deps = null; // BanditCombat's injected gameplay dependencies captured by the init wrapper and used by all lich simulation.
  const projectiles = new Set(); // Live Tothal/Kanthic spell projectiles updated from the normal RangedWeapons gameplay tick.
  const puddles = new Set(); // Live Kanthic petroleum hazards updated/disposed alongside custom projectiles.
  const eruptions = new Set();
  let petroleumSurfaceGeometry = null; // Shared low micro-plateau mesh reused by every Kanthic petroleum impact.
  let petroleumSurfaceMaterial = null; // Shared black 70%-opacity canvas-textured material reused by every petroleum impact.
  let petroleumTextureLoadStarted = false; // Prevents duplicate canvas.png loads when several puddles exist at once. // Independent Hronal Erupting Earth warnings may overlap while the lich continues casting at normal cadence.
  let hronalStoneGeometry = null; // Shared Grehlr-style tetrahedral stone clod geometry for every active earth warning.
  let hronalStoneMaterial = null; // Shared town-cliff-textured material avoids per-particle material allocation.
  let hronalStoneTextureLoadStarted = false; // Ensures carved_smooth.png is shade-filled/loaded only once for all Hronal attacks.
  let hronalStoneInstanceDummy = null; // Single reusable Object3D composes all stone instance matrices without allocating per-particle meshes/matrices each frame.
  let lastEvent = 'idle'; // Mobile-copyable diagnostic summary exposed through __lichDebug.
  let totalSummons = 0; // Session counter used only by diagnostics.
  let totalPuddles = 0; // Session counter used only by diagnostics.
  let entrancerMarker = null; // Single reusable world-space ring pair that follows whichever Kanthic lich most recently applied the player's Entranced Health.
  let entrancerMarkerSource = null; // Current referential lich owning the visible marker; changes immediately when a newer applicant takes control.
  let entrancerAuraAnchor = null; // Avatar-local anchor carrying the large command-colored fire emitter above the ground ring.
  let entrancerAuraVisual = null; // AuthoredFurniture emitter visual updated while the latest Kanthic applicant controls the player.
  let entrancerBehindCamera = false; // Latest camera-facing test; drives the full-screen edge warning only while the controller is behind the view.
  let entrancerAuraCommand = null; // Current Approach/Flee command whose HUD color is driving the world aura and edge warning.
  let wrappersInstalled = false; // Prevents duplicate API wrapping if scripts/tools reinstall this feature.

  function random() {
    return window.GameRandom?.random?.() ?? Math.random();
  }

  function typeDef(type) {
    return TYPE_DEFS[String(type || '').toLowerCase()] || TYPE_DEFS.tothal;
  }

  const allowedAreas = new Set([ARENA_ID]); // Areas liches may exist in; the arena always, plus any area registered through allowArea().

  function currentLichArea() {
    const area = deps?.getCurrentArea?.();
    return allowedAreas.has(area) ? area : null;
  }

  function isArena() {
    return !!currentLichArea();
  }

  function isLiveActor(actor) {
    return !!actor && Number(actor.health) > 0 && (!actor.areaId || actor.areaId === currentLichArea());
  }

  function rollDye(type) {
    const def = typeDef(type); // Tradition definition supplies the allowed hue band and optional neutral tail.
    const chromatic = []; // Candidate authored cloth dyes for this tradition's hue range.
    for (const variant of HUE_VARIANTS) {
      for (const hue of def.hues) chromatic.push(`dye:CLOTH:${variant}_${hue}`);
    }
    const pool = def.neutralDyes ? chromatic.concat(def.neutralDyes) : chromatic; // Kanthic adds white/gray/charcoal while intentionally excluding brown/cream/silver.
    return pool[Math.floor(random() * pool.length)] || chromatic[0];
  }

  function rosterFor(type, gender = null) {
    const def = typeDef(type); // Lich type provides display name while cosmetics stay identical across traditions.
    const chosenGender = gender === 'female' ? 'female' : gender === 'male' ? 'male' : (random() < 0.5 ? 'male' : 'female'); // Used by the Engh-sho-inherited Harlyao Skeleton hood/bodywrap variants.
    const dyeId = rollDye(def.id); // One roll is deliberately reused for BOTH hood and bodywrap.
    return {
      name: def.label,
      appearance: { speciesId: 'harlyao-skeleton', gender: chosenGender, cosmetics: {} },
      equippedCosmetics: [HOOD_ID, BODYWRAP_ID],
      cosmeticSlots: { [HOOD_ID]: 'hood', [BODYWRAP_ID]: 'overwear' },
      appliedDyes: { HOOD: dyeId, CLOTH: dyeId },
      lichType: def.id,
      lichDyeId: dyeId,
    };
  }

  function disposeHolderChildren(holder) {
    if (!holder) return;
    for (const child of [...(holder.children || [])]) disposeObject3D(child); // Visible reference weapon geometry is removed while the animated holder itself remains authoritative.
  }

  function prepareEmptyCastWeapon(entity) {
    if (!entity) return null;
    const rangedHolder = entity._banditRangedToolHolder; // Liches never use an ordinary ranged weapon holder; only their custom spell projectile exists.
    if (rangedHolder) {
      disposeObject3D(rangedHolder);
      entity._banditRangedToolHolder = null;
    }
    const holder = entity._banditToolHolder; // Existing BanditCombat holder already receives the player's Neutral→Windup→Strike pose math every frame.
    if (!holder) {
      entity.banditWeaponMeshAttached = false;
      return null;
    }
    disposeHolderChildren(holder);
    holder.visible = true;
    if (typeof THREE !== 'undefined') {
      const socket = new THREE.Group(); // Empty weapon object: no rendered mesh, but it follows the exact Light Weapon holder transform for the procedural hand.
      socket.name = 'lich_empty_light_weapon';
      socket.userData.lichEmptyCastWeapon = true;
      socket.userData.referenceWeaponKey = LICH_CAST_WEAPON_KEY;
      holder.add(socket);
      entity._lichCastWeaponSocket = socket;
    }
    entity.banditWeaponMeshAttached = false;
    return holder;
  }

  function handRigForLich(entity) {
    const registeredRoot = entity?.avatarRef?.handRigAvatarRoot; // Shared hostile builder retains the original PNGPlaneAvatar root specifically so ProceduralHandFrameDriver can own real hands.
    if (registeredRoot?.userData?.proceduralHandRig) return registeredRoot.userData.proceduralHandRig;
    const root = entity?.avatarRef?.group;
    if (root?.userData?.proceduralHandRig) return root.userData.proceduralHandRig;
    let rig = null; // Fallback traversal catches late/legacy avatar layouts once their hand rig attaches.
    root?.traverse?.(node => {
      if (!rig && node?.userData?.proceduralHandRig) rig = node.userData.proceduralHandRig;
    });
    return rig;
  }

  function lichHandFrame(rig) {
    const profiles = window.HobunjiHandModelProfiles; // Existing species hand-model calibration owner shared with NPC held equipment.
    if (!rig || !profiles || typeof THREE === 'undefined') return null;
    const species = rig.speciesId || 'harlyao-skeleton'; // Harlyao Skeleton inherits the Engh-Sho hand model/profile at runtime.
    const gender = rig.gender || 'male'; // Used only for the existing species/gender hand scale.
    const raw = window.HobunjiHandGripModes?.effectiveFrameForSpecies?.(species)
      || profiles.handTransformForSpecies?.(species)
      || profiles.modelForSpecies?.(species)?.handFromTool
      || {};
    const p = raw.position || {}; // Existing hand-from-tool translation in normalized hand-height units.
    const r = raw.rotationDeg || {}; // Existing hand-from-tool orientation.
    const q = raw.rotationQuaternion || null; // Quaternion wins when the calibrated hand model supplies one.
    const avatarHeight = Number(rig.avatarRoot?.userData?.portraitModelHeight) || Number(rig.parent?.userData?.portraitModelHeight) || 0.9; // Same rendered-height basis as the civilian held-equipment path.
    const effectiveScale = Number(profiles.effectiveScaleFor?.(species, gender)) || 1; // Species+gender hand-model scale already authored in the shared profile.
    const unit = avatarHeight * (Number(profiles.data?.handHeightFraction) || 0.12) * effectiveScale; // Converts normalized calibration translation to world units.
    const quaternion = q && [q.x, q.y, q.z, q.w].every(value => Number.isFinite(Number(value)))
      ? new THREE.Quaternion(Number(q.x), Number(q.y), Number(q.z), Number(q.w)).normalize()
      : new THREE.Quaternion().setFromEuler(new THREE.Euler(
          THREE.MathUtils.degToRad(Number(r.pitch) || 0),
          THREE.MathUtils.degToRad(Number(r.yaw) || 0),
          THREE.MathUtils.degToRad(Number(r.roll) || 0),
          'YXZ',
        ));
    return {
      position: new THREE.Vector3((Number(p.x) || 0) * unit, (Number(p.y) || 0) * unit, (Number(p.z) || 0) * unit),
      quaternion,
    };
  }

  function hierarchyWorldQuaternion(node) {
    if (!node?.quaternion || typeof THREE === 'undefined') return null;
    const chain = []; // Avoids matrix decomposition under mirrored/non-uniform avatar ancestors, matching the existing hand runtimes.
    for (let cursor = node; cursor?.isObject3D; cursor = cursor.parent) chain.push(cursor);
    const world = new THREE.Quaternion();
    world.identity();
    for (let i = chain.length - 1; i >= 0; i--) world.multiply(chain[i].quaternion);
    return world.normalize();
  }

  function syncLichCastHand(entity) {
    const holder = entity?._banditToolHolder; // Empty reference weapon holder animated by BanditCombat.updateToolMesh.
    const rig = handRigForLich(entity); // Procedural right-hand rig attached to this Harlyao Skeleton avatar.
    const hand = lichHandFrame(rig); // Existing species/model calibration composed after the weapon grip.
    if (!holder?.visible || !holder.parent || !rig?.placeHandWorld || !hand || typeof THREE === 'undefined') return false;
    holder.updateWorldMatrix?.(true, true);
    const socketPosition = holder.getWorldPosition(new THREE.Vector3()); // Current Light Weapon pose position after BanditCombat animation.
    const socketQuaternion = hierarchyWorldQuaternion(holder); // Current Light Weapon pose orientation without mirrored-matrix decomposition.
    if (!socketQuaternion) return false;
    const grips = window.HobunjiHandToolGrips; // Existing authored grip metadata keeps the invisible reference weapon's hand placement identical to a real held copy.
    const grip = grips?.authoredPrimaryGripForTool?.(LICH_CAST_WEAPON_KEY, 'melee') || {};
    const gripPosition = grip.position || {}; // Authored point on the reference weapon where the right hand belongs.
    const gripRotation = grip.rotationDeg || {}; // Authored grip orientation on the reference weapon.
    const gripScale = Number(grips?.toolScaleForTool?.(LICH_CAST_WEAPON_KEY)) || 1; // Same tool-scale multiplier used by visible held weapons.
    socketPosition.add(new THREE.Vector3(
      (Number(gripPosition.x) || 0) * gripScale,
      (Number(gripPosition.y) || 0) * gripScale,
      (Number(gripPosition.z) || 0) * gripScale,
    ).applyQuaternion(socketQuaternion));
    socketQuaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(
      THREE.MathUtils.degToRad(Number(gripRotation.pitch) || 0),
      THREE.MathUtils.degToRad(Number(gripRotation.yaw) || 0),
      THREE.MathUtils.degToRad(Number(gripRotation.roll) || 0),
      'YXZ',
    )));
    const handPosition = socketPosition.clone().add(hand.position.clone().applyQuaternion(socketQuaternion)); // Final right-palm point after the species/model hand offset.
    const handQuaternion = socketQuaternion.clone().multiply(hand.quaternion); // Final right-palm orientation after grip + model calibration.
    rig.setSideVisible?.('right', true);
    rig.placeHandWorld('right', handPosition, handQuaternion);
    return true;
  }

  async function makeEntity(options = {}) {
    if (!deps || !isArena()) return null;
    const def = typeDef(options.type); // Chosen lich tradition used for appearance, AI tuning, and spell behavior.
    const cfg = await window.BanditCombat?.loadGangConfig?.(); // Reuses the canonical humanoid stat/tier constructor rather than cloning bandit entity plumbing.
    if (!cfg || !isArena()) return null;
    const x = Number(options.x); // World X supplied by the Testing Arena spawner.
    const y = Number(options.y); // World Z-plane coordinate supplied by the Testing Arena spawner.
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const roster = rosterFor(def.id, options.gender); // Forced skeleton+raggedhood+bodywrap roster passed through the normal portrait builder.
    const tier = Math.max(0, Math.min(3, Math.round(Number(options.tier) || 0))); // Existing dev tier selector remains meaningful for lich base stats.
    const areaId = currentLichArea(); // Spawn area; every spell/summon below follows its owner's area.
    const entity = await window.BanditCombat.makeEntity({
      ...cfg,
      speciesWeights: { 'harlyao-skeleton': 1 },
      rangedWeaponChanceByRank: { grunt: 0, lieutenant: 0, captain: 0 },
    }, 'lieutenant', tier, x, y, {
      zoneId: areaId,
      rosterOverride: roster,
      enemyClass: CLASS_ID,
      nameOverride: def.label,
      defOverride: {
        weaponKey: LICH_CAST_WEAPON_KEY, // Existing Light Weapon classification/attack pose source; its visible mesh is stripped immediately after construction.
        rangedWeaponKey: null,
        aggroRangePx: (deps.TILE || 64) * 11,
        leashRangePx: (deps.TILE || 64) * 14,
        moveSpeed: 104 + tier * 4,
        chaseSpeed: 142 + tier * 5,
      },
      extra: {
        homeX: x, homeY: y, state: 'chase',
        isHarlyaoLich: true, lichType: def.id, lichDyeId: roster.lichDyeId,
        ...(options.extra || {}),
      },
    });
    if (!entity) return null;
    prepareEmptyCastWeapon(entity);
    entity._lichCastAnimIndex = 0; // Cycles existing poke-combo steps so repeated spell casts do not all use one identical hand motion.
    entity._lichBaseGroundLift = Number(entity.groundLift ?? entity.halfHeight) || Number(entity.avatarRef?.modelHeight) * 0.5 || 0.45; // Original floor-to-center baseline restored while prone/dead.
    entity._lichHoverClockS = random() * HOVER_BOB_PERIOD_S; // Per-entity phase offset keeps groups of liches from bobbing in lockstep.
    entity._lichHoverOffsetWorld = 0; // Current presentation-only lift exposed through Pixel Probe/debug snapshots.
    entity.avatarRef?.legs?.setHoverMode?.(true); // Procedural legs immediately enter the dangling airborne solver instead of taking a first walking step.
    entity._lichPrimaryCooldownS = 0.7 + random() * 0.8; // Staggers first casts when several liches are spawned together.
    entity._lichSummonCooldownS = 5.5 + random() * 3; // First summon comes later than first projectile so the core attack is easy to observe.
    entity._lichCommand = 'approach'; // Referential command read live by every target currently Entranced by this lich.
    entity._lichCommandChangedAt = performance.now(); // Used by diagnostics and to avoid visually noisy rapid command flapping.
    entity._lichSummons = new Set(); // Tracks this lich's summoned Minion objects for the live-cap check.
    lastEvent = `spawn:${def.id}:${roster.lichDyeId}`;
    return entity;
  }

  function groundYAt(actor, xPx, yPx) {
    const tile = deps?.TILE || 64; // Shared pixel-to-world conversion used by every entity grid coordinate.
    const grid = actor?.areaGrid; // Lich's arena grid retained on the shared humanoid entity at construction.
    if (!grid?.length) return 0;
    const rows = actor.areaRows || grid.length; // Bounds for safe ballistic ground lookup.
    const cols = actor.areaCols || grid[0]?.length || 1; // Bounds for safe ballistic ground lookup.
    const col = Math.max(0, Math.min(cols - 1, Math.floor(xPx / tile))); // Projectile grid column used for surface lookup.
    const row = Math.max(0, Math.min(rows - 1, Math.floor(yPx / tile))); // Projectile grid row used for surface lookup.
    return deps.tileSurfaceYInArea?.(grid[row]?.[col], actor.areaId || currentLichArea() || ARENA_ID) || 0;
  }

  function targetCenter(actor) {
    const hitbox = window.RangedWeapons?.actorHitbox?.(actor); // Canonical portrait-derived collision volume shared with ordinary ranged weapons.
    if (hitbox?.center) return hitbox.center.clone();
    const surface = groundYAt(actor, actor.x, actor.y); // Fallback center if portrait hitbox metadata is unavailable.
    return new THREE.Vector3(actor.x / deps.TILE, surface + 0.6, actor.y / deps.TILE);
  }

  function makeSpellVisual(type) {
    const group = new THREE.Group(); // Root translated by projectile simulation; child shapes handle per-type styling/wobble.
    group.name = `lich_${type}_projectile`;
    if (type === 'tothal') {
      const palette = [0xd7f4ff, 0xb9eaff, 0xf5fdff, 0x91dcf4]; // Pale translucent layers read as a compact fog bank rather than a solid ice missile.
      for (let i = 0; i < 9; i++) {
        const phase = i / 9 * Math.PI * 2; // Stable per-lobe phase lets the cloud writhe without allocating new geometry every frame.
        const radius = 0.095 + (i % 4) * 0.018; // Unequal overlapping lobes break the projectile's silhouette into a wiggly fog ball.
        const material = new THREE.MeshBasicMaterial({
          color: palette[i % palette.length],
          transparent: true,
          opacity: 0.18 + (i % 3) * 0.055,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          fog: true,
        });
        const lobe = new THREE.Mesh(new THREE.SphereGeometry(radius, 10, 7), material);
        const radial = 0.045 + (i % 3) * 0.035;
        lobe.position.set(Math.cos(phase) * radial, Math.sin(phase * 1.7) * 0.055, Math.sin(phase) * radial);
        lobe.scale.set(1.1 + (i % 2) * 0.35, 0.8 + ((i + 1) % 3) * 0.14, 1.0 + ((i + 2) % 2) * 0.28);
        lobe.userData.fogBasePosition = { x: lobe.position.x, y: lobe.position.y, z: lobe.position.z }; // Reused by updateProjectiles for local cloud writhing.
        lobe.userData.fogPhase = phase; // Used to offset each lobe's sine motion.
        lobe.userData.baseOpacity = material.opacity; // Lifetime fade multiplies this authored opacity instead of accumulating changes.
        group.add(lobe);
      }
    } else {
      const gooMaterial = new THREE.MeshPhysicalMaterial({
        color: 0x30230f, roughness: 0.12, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.08,
        transparent: true, opacity: 0.76, depthWrite: false,
      }); // Translucent brown-black petroleum body; clearcoat gives the wet gasoline read under scene lighting.
      const sheenMaterial = new THREE.MeshBasicMaterial({
        color: 0x8d6cff, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending,
      }); // Thin violet sheen approximates gasoline's iridescent film without a texture dependency.
      const lobeA = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), gooMaterial); // Main irregular blob lobe.
      const lobeB = new THREE.Mesh(new THREE.SphereGeometry(0.10, 10, 7), gooMaterial.clone()); // Secondary lobe stretched during flight.
      const sheen = new THREE.Mesh(new THREE.SphereGeometry(0.135, 10, 7), sheenMaterial); // Slightly larger transparent rainbow-like highlight shell.
      lobeB.position.set(0.10, 0.035, -0.04);
      lobeB.scale.set(1.25, 0.8, 0.9);
      sheen.scale.set(1.04, 0.65, 1.04);
      group.add(lobeA, lobeB, sheen);
    }
    group.traverse(child => { if (child.isMesh) child.renderOrder = 4; }); // Spell visuals paint above ordinary terrain without changing collision.
    return group;
  }

  function ballisticVelocity(owner, target, def) {
    const tile = deps.TILE || 64; // Converts horizontal projectile speed into world-Y flight timing.
    const start = targetCenter(owner); // Spawn origin starts near the lich portrait center rather than its feet.
    const end = targetCenter(target); // Current target center used for one-shot ballistic lead-free aim.
    const dxPx = (end.x - start.x) * tile; // Horizontal X delta in the simulation's pixel coordinate system.
    const dyPx = (end.z - start.z) * tile; // Horizontal Z delta in the simulation's pixel coordinate system.
    const distPx = Math.max(1, Math.hypot(dxPx, dyPx)); // Used to derive flight time from authored horizontal speed.
    const travelS = distPx / def.speedPxS; // Approximate time-to-target before gravity; Kanthic uses this to start high then drop hard.
    const vx = dxPx / distPx * def.speedPxS; // Horizontal projectile X velocity.
    const vz = dyPx / distPx * def.speedPxS; // Horizontal projectile Z velocity.
    const vyWorld = (end.y - start.y + 0.5 * def.gravityWorldS2 * travelS * travelS) / Math.max(0.08, travelS); // Ballistic compensation so heavy Kanthic gravity still reaches a visible direct-hit window.
    return { start, vx, vz, vyWorld };
  }

  function projectilePower(projectile) {
    if (projectile?.type !== 'tothal') return 1;
    return Math.max(0, Math.min(1, 1 - projectile.ageS / Math.max(0.001, projectile.payload.maxAgeS))); // Blizzard power falls continuously with the same lifetime that visibly shrinks the fog ball.
  }

  function attachTothalWind(projectile) {
    if (projectile?.type !== 'tothal') return null;
    const bgs = window.AudioSystem?.gameAudioConfig?.()?.bgs || {}; // Existing authored BGS recordings are reused instead of introducing a spell-only audio asset.
    const url = bgs.wind2 || bgs.wind1;
    if (!url || !window.Music?.registerFurnitureSfxSource) return null;
    projectile.windSource = window.Music.registerFurnitureSfxSource(projectile.areaId || ARENA_ID, projectile.x / (deps.TILE || 64), projectile.y / (deps.TILE || 64), {
      url,
      rangeTiles: TOTHAL_WIND_RANGE_TILES,
      volume: TOTHAL_WIND_VOLUME,
    }); // The shared proximity-loop transport makes the wind strongest near the moving fog ball and respects global audio/autoplay controls.
    return projectile.windSource;
  }

  function updateTothalWind(projectile) {
    if (!projectile?.windSource) return;
    projectile.windSource.x = projectile.x / (deps.TILE || 64);
    projectile.windSource.z = projectile.y / (deps.TILE || 64);
    projectile.windSource.maxVolume = TOTHAL_WIND_VOLUME * Math.max(0.2, projectilePower(projectile)); // Wind weakens with the same lifetime power as the projectile.
  }

  function nearestSeekingTarget(projectile) {
    let nearest = null; // Current homing target can change when the original target dies or a nearer live actor enters the path.
    let bestDistSq = Infinity;
    for (const actor of candidateActors(projectile)) {
      const dx = (Number(actor.x) || 0) - projectile.x;
      const dz = (Number(actor.y) || 0) - projectile.y;
      const distSq = dx * dx + dz * dz;
      if (distSq < bestDistSq) { bestDistSq = distSq; nearest = actor; }
    }
    return nearest;
  }

  function updateTothalSeeking(projectile, dt) {
    if (projectile?.type !== 'tothal' || typeof THREE === 'undefined') return;
    if (!isLiveActor(projectile.target) || projectile.target === projectile.owner) projectile.target = nearestSeekingTarget(projectile);
    if (!projectile.target) return;
    const tile = deps.TILE || 64; // Converts vertical Three.js world units into the same pixel scale as horizontal homing velocity.
    const aim = targetCenter(projectile.target);
    const desired = new THREE.Vector3(
      aim.x * tile - projectile.x,
      (aim.y - projectile.worldY) * tile,
      aim.z * tile - projectile.y,
    );
    if (desired.lengthSq() < 1e-8) return;
    desired.normalize().multiplyScalar(projectile.payload.speedPxS);
    const current = new THREE.Vector3(projectile.vx, projectile.vyWorld * tile, projectile.vy);
    if (current.lengthSq() < 1e-8) current.copy(desired);
    const blend = 1 - Math.exp(-Math.max(0, projectile.payload.homingBlendPerS || 0) * Math.max(0, dt)); // Smooth steering produces a visibly seeking curve rather than instant target snapping.
    current.lerp(desired, blend).normalize().multiplyScalar(projectile.payload.speedPxS);
    projectile.vx = current.x;
    projectile.vyWorld = current.y / tile;
    projectile.vy = current.z;
  }

  function firePrimary(lich, target, castTiming = null) {
    if (!isArena() || !isLiveActor(lich) || !isLiveActor(target)) return false;
    const def = typeDef(lich.lichType); // Lich tradition selects projectile physics/payload/visual.
    if (def.id === 'hronal') {
      const windupS = Math.max(0, Number(castTiming?.windupS) || 0.16); // Exact staged attack timing captured by beginLichCast.
      const strikeS = Math.max(0, Number(castTiming?.strikeS) || 0.10); // Paired with windup so the warning lasts exactly four attack phases.
      return !!makeEruptingEarth(lich, target, 4 * (windupS + strikeS));
    }
    const velocity = ballisticVelocity(lich, target, def.projectile); // Kanthic remains ballistic; Tothal uses this only as its initial heading before homing takes over.
    const mesh = makeSpellVisual(def.id); // Per-type procedural spell visual avoids adding un-authored sprite assets.
    mesh.position.copy(velocity.start);
    lich.scene?.add?.(mesh);
    const projectile = {
      type: def.id, owner: lich, target, mesh, areaId: lich.areaId || currentLichArea() || ARENA_ID,
      x: velocity.start.x * deps.TILE, y: velocity.start.z * deps.TILE, worldY: velocity.start.y,
      prevX: velocity.start.x * deps.TILE, prevY: velocity.start.z * deps.TILE, prevWorldY: velocity.start.y,
      vx: velocity.vx, vy: velocity.vz, vyWorld: velocity.vyWorld,
      ageS: 0, payload: def.projectile,
    }; // Custom projectile record updated from RangedWeapons.update's normal gameplay cadence.
    projectiles.add(projectile);
    if (def.id === 'tothal') attachTothalWind(projectile);
    lastEvent = `cast:${def.id}:${lich.id || lich.name}`;
    return true;
  }

  function segmentBoxT(start, end, box, radius = 0) {
    if (!box) return null;
    let enter = 0; // Earliest normalized segment time still inside all slab intervals.
    let exit = 1; // Latest normalized segment time still inside all slab intervals.
    for (const axis of ['x', 'y', 'z']) {
      const delta = end[axis] - start[axis]; // Per-axis segment travel for slab intersection.
      const min = box.min[axis] - radius; // Inflated lower hitbox bound for projectile radius.
      const max = box.max[axis] + radius; // Inflated upper hitbox bound for projectile radius.
      if (Math.abs(delta) < 1e-7) {
        if (start[axis] < min || start[axis] > max) return null;
        continue;
      }
      let a = (min - start[axis]) / delta; // Entry candidate on this axis.
      let b = (max - start[axis]) / delta; // Exit candidate on this axis.
      if (a > b) [a, b] = [b, a];
      enter = Math.max(enter, a);
      exit = Math.min(exit, b);
      if (enter > exit) return null;
    }
    return enter >= 0 && enter <= 1 ? enter : null;
  }

  function candidateActors(projectile) {
    const out = []; // Player plus live arena hostiles; friendly-fire is intentional so Entranced can affect enemies too.
    if (isLiveActor(deps?.player)) out.push(deps.player);
    for (const actor of deps?.hostileObjects || []) {
      if (actor === projectile.owner || !isLiveActor(actor)) continue;
      out.push(actor);
    }
    return out;
  }

  function nearestActorHit(projectile, start, end) {
    let best = null; // Nearest actor intersection chosen across player and hostile bodies.
    for (const actor of candidateActors(projectile)) {
      const hitbox = window.RangedWeapons?.actorHitbox?.(actor); // Reuses ranged combat's real portrait-aware hitbox.
      const t = segmentBoxT(start, end, hitbox?.box, projectile.payload.radiusWorld);
      if (t == null || (best && best.t <= t)) continue;
      best = { actor, t };
    }
    return best;
  }

  function damageActor(actor, projectile, t) {
    const p = projectile.payload; // Type-specific impact numbers authored in TYPE_DEFS.
    const power = projectilePower(projectile); // Tothal damage/knockback/Footing pressure/frost all decay with its shrinking lifetime; Kanthic remains full-strength.
    const hitX = projectile.prevX + (projectile.x - projectile.prevX) * t; // Pixel X impact origin passed to canonical knockback/damage.
    const hitY = projectile.prevY + (projectile.y - projectile.prevY) * t; // Pixel Z-plane impact origin passed to canonical knockback/damage.
    const options = { tag: 'blunt', ranged: true, footingDamageMultiplier: (p.footingDamageMultiplier || 0) * power, afflictionBonuses: {} }; // Canonical damage path still owns knockback/stagger/prone transitions.
    const damage = (p.damage || 0) * power;
    const knockback = (p.knockbackPxS || 0) * power;
    if (actor === deps.player) deps.damagePlayer?.(damage, hitX, hitY, knockback, options);
    else deps.damageCreature?.(actor, damage, hitX, hitY, knockback, { ...options, friendlyFire: true });
    const RS = window.ResourceSystem; // Central affliction authority for fixed lich payload buildup.
    if (projectile.type === 'tothal') {
      RS?.addAffliction?.(actor, 'frostbittenStamina', (p.frostbittenStamina || 0) * power);
    } else {
      addGooSlow(actor);
      applyEntranced(actor, projectile.owner, p.entrancedHealth);
    }
    lastEvent = `hit:${projectile.type}:${actor.id || actor.name || 'player'}:power=${power.toFixed(2)}`;
  }

  function disposeObject3D(root) {
    root?.parent?.remove?.(root);
    root?.traverse?.(child => {
      if (!child.isMesh) return;
      child.geometry?.dispose?.();
      const materials = Array.isArray(child.material) ? child.material : [child.material]; // Normalizes Three single/multi-material disposal.
      for (const material of materials) material?.dispose?.();
    });
  }

  function disposeProjectile(projectile) {
    if (!projectiles.delete(projectile)) return;
    if (projectile.windSource) {
      window.Music?.unregisterFurnitureSfxSource?.(projectile.windSource); // Moving Tothal wind must stop immediately when the projectile hits/expires/leaves the arena.
      projectile.windSource = null;
    }
    disposeObject3D(projectile.mesh);
  }

  function buildHronalStoneGeometry() {
    if (hronalStoneGeometry || typeof THREE === 'undefined') return hronalStoneGeometry;
    let geometry = new THREE.TetrahedronGeometry(0.105, 0); // Same minimum four-face low-poly clod vocabulary as the Grehlr eruption particles.
    if (geometry.index) geometry = geometry.toNonIndexed(); // Independent triangle vertices let the whole cliff PNG stretch across every face.
    const position = geometry.getAttribute?.('position');
    if (position && position.count % 3 === 0 && THREE.BufferAttribute) {
      const uv = new Float32Array(position.count * 2); // Repeats the complete carved-stone texture on each triangular face.
      for (let vertex = 0; vertex < position.count; vertex += 3) {
        uv[(vertex + 0) * 2 + 0] = 0; uv[(vertex + 0) * 2 + 1] = 0;
        uv[(vertex + 1) * 2 + 0] = 1; uv[(vertex + 1) * 2 + 1] = 0;
        uv[(vertex + 2) * 2 + 0] = 0.5; uv[(vertex + 2) * 2 + 1] = 1;
      }
      geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    }
    hronalStoneGeometry = geometry;
    return hronalStoneGeometry;
  }

  function loadHronalStoneTexture() {
    if (hronalStoneTextureLoadStarted || !hronalStoneMaterial || !THREE?.TextureLoader) return;
    hronalStoneTextureLoadStarted = true;
    const texturePath = 'assets/textures/carved_smooth.png'; // Exact cliff texture used by the town terrain material.
    new THREE.TextureLoader().load(texturePath, loaded => {
      let finalTexture = loaded;
      const rgb = window.parseHexColor?.('#6a6460'); // Exact town cliff fill from terrain-materials.json.
      if (rgb && window.getShadeFillCanvas && window.getPortraitTintingConfig && THREE.CanvasTexture) {
        const canvas = window.getShadeFillCanvas(loaded.image, texturePath + '|#6a6460', {
          mode: 'shadeFill',
          rgb: [rgb.r, rgb.g, rgb.b],
          options: window.getPortraitTintingConfig(),
        });
        finalTexture = new THREE.CanvasTexture(canvas);
        hronalStoneMaterial.color.set(0xffffff);
      } else {
        hronalStoneMaterial.color.set(0x6a6460);
      }
      if (THREE.ClampToEdgeWrapping != null) {
        finalTexture.wrapS = THREE.ClampToEdgeWrapping;
        finalTexture.wrapT = THREE.ClampToEdgeWrapping;
      }
      finalTexture.needsUpdate = true;
      hronalStoneMaterial.map = finalTexture;
      hronalStoneMaterial.needsUpdate = true;
    }, undefined, () => {});
  }

  function ensureHronalStoneAssets() {
    if (typeof THREE === 'undefined') return false;
    buildHronalStoneGeometry();
    if (!hronalStoneMaterial) hronalStoneMaterial = new THREE.MeshStandardMaterial({
      color: 0x6a6460, roughness: 1, metalness: 0, flatShading: true,
    }); // Shared fallback already matches the town cliff fill while its PNG loads.
    loadHronalStoneTexture();
    return !!hronalStoneGeometry && !!hronalStoneMaterial;
  }

  function ensureHronalStoneBatch(erupt) {
    if (!erupt?.root || !ensureHronalStoneAssets() || typeof THREE?.InstancedMesh !== 'function') return false;
    if (erupt.stoneBatch) return true;
    const batch = new THREE.InstancedMesh(hronalStoneGeometry, hronalStoneMaterial, HRONAL_STONE_INSTANCE_CAP); // One draw call replaces up to 112 individual warning/burst meshes per eruption.
    batch.name = 'hronal_stone_batch';
    batch.renderOrder = 4;
    batch.frustumCulled = false; // Individual stones move beyond the source geometry's tiny bounds; avoid false culling of the whole batch.
    batch.instanceMatrix?.setUsage?.(THREE.DynamicDrawUsage);
    hronalStoneInstanceDummy ||= new THREE.Object3D();
    const hidden = hronalStoneInstanceDummy;
    hidden.position.set(0, -1000, 0);
    hidden.rotation.set(0, 0, 0);
    hidden.scale.setScalar(0.0001);
    hidden.updateMatrix();
    for (let i = 0; i < HRONAL_STONE_INSTANCE_CAP; i++) batch.setMatrixAt(i, hidden.matrix); // Unused slots start effectively invisible.
    batch.instanceMatrix.needsUpdate = true;
    erupt.root.add(batch);
    erupt.stoneBatch = batch;
    erupt.freeStoneSlots = Array.from({ length: HRONAL_STONE_INSTANCE_CAP }, (_, i) => HRONAL_STONE_INSTANCE_CAP - 1 - i);
    return true;
  }

  function writeHronalStoneInstance(erupt, particle, hidden = false) {
    const batch = erupt?.stoneBatch;
    if (!batch || !particle || !(particle.slot >= 0)) return;
    hronalStoneInstanceDummy ||= new THREE.Object3D();
    const dummy = hronalStoneInstanceDummy;
    if (hidden) {
      dummy.position.set(0, -1000, 0);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(0.0001);
    } else {
      dummy.position.set(particle.x, particle.y, particle.z);
      dummy.rotation.set(particle.rotX, particle.rotY, particle.rotZ);
      dummy.scale.setScalar(particle.scale);
    }
    dummy.updateMatrix();
    batch.setMatrixAt(particle.slot, dummy.matrix);
    batch.instanceMatrix.needsUpdate = true;
  }

  function spawnHronalStone(erupt, angle, radiusWorld, trackRing = true, burst = false) {
    if (!ensureHronalStoneBatch(erupt)) return;
    const slot = erupt.freeStoneSlots?.pop();
    if (!Number.isInteger(slot)) return; // Visual-only cap: gameplay/cadence continue even if this eruption already has its maximum live stone instances.
    const radialScale = 0.82 + random() * 0.34; // Thick irregular perimeter instead of a mechanically perfect particle circle.
    const scale = burst ? 1.55 + random() * 1.65 : 1.0 + random() * 1.25;
    const horizontal = burst ? 0.8 + random() * 1.55 : 0.12 + random() * 0.55;
    const particle = {
      slot, angle, radialScale, trackRing, scale,
      x: Math.cos(angle) * radiusWorld * radialScale,
      y: 0.025,
      z: Math.sin(angle) * radiusWorld * radialScale,
      rotX: random() * Math.PI,
      rotY: random() * Math.PI,
      rotZ: random() * Math.PI,
      vx: Math.cos(angle) * horizontal,
      vz: Math.sin(angle) * horizontal,
      vy: burst ? 1.7 + random() * 2.3 : 0.95 + random() * 1.8,
      life: burst ? 0.72 + random() * 0.7 : 0.5 + random() * 0.7,
    }; // Particle state is plain numbers; the GPU instance batch owns presentation.
    erupt.particles.push(particle);
    writeHronalStoneInstance(erupt, particle);
  }

  function disposeHronalEruption(erupt) {
    if (!eruptions.delete(erupt)) return;
    erupt.particles = [];
    erupt.freeStoneSlots = [];
    erupt.stoneBatch?.parent?.remove?.(erupt.stoneBatch); // Shared stone geometry/material remain cached; only this lightweight instance container is removed.
    erupt.stoneBatch?.dispose?.(); // Frees the per-eruption instanceMatrix GPU buffer; InstancedMesh.dispose never touches the shared geometry/material.
    erupt.stoneBatch = null;
    for (const visual of [erupt.ring, erupt.lava, erupt.lavaCore, erupt.lavaFountain, erupt.lavaFountainCore]) {
      if (!visual) continue;
      visual.parent?.remove?.(visual);
      visual.geometry?.dispose?.();
      visual.material?.dispose?.();
    }
    erupt.root?.parent?.remove?.(erupt.root);
  }

  function makeEruptingEarth(owner, target, telegraphS) {
    if (!isArena() || !isLiveActor(owner) || !isLiveActor(target) || !owner.scene || typeof THREE === 'undefined') return null;
    const radiusTiles = typeDef('hronal').projectile.eruptionRadiusTiles || HRONAL_ERUPTION_RADIUS_TILES;
    const radiusWorld = radiusTiles; // World horizontal units are tile units throughout this arena render path.
    const x = Number(target.x) || 0; // Target position is locked at cast Strike; later movement must escape the warning.
    const y = Number(target.y) || 0;
    const root = new THREE.Group(); // Independent root permits any number of overlapping Erupting Earth warnings.
    root.name = 'hronal_erupting_earth';
    root.position.set(x / (deps.TILE || 64), groundYAt(owner, x, y) + 0.02, y / (deps.TILE || 64));
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(radiusWorld * 0.79, radiusWorld, 24),
      new THREE.MeshBasicMaterial({ color: 0xc64d20, transparent: true, opacity: 0.62, depthWrite: false, side: THREE.DoubleSide })
    ); // Small fixed-AOE warning uses the same flat ring language as other arena telegraphs.
    ring.rotation.x = -Math.PI / 2;
    ring.renderOrder = 3;
    root.add(ring);
    owner.scene.add(root);
    const erupt = {
      owner, root, ring, lava: null, lavaCore: null, lavaFountain: null, lavaFountainCore: null,
      x, y, radiusPx: radiusTiles * (deps.TILE || 64), radiusWorld,
      ageS: 0, telegraphS: Math.max(0.12, Number(telegraphS) || 0.12),
      erupted: false, eruptionAgeS: 0, emitCarry: 0, particles: [], stoneBatch: null, freeStoneSlots: [],
      payload: typeDef('hronal').projectile,
    }; // Warning lifetime is independent of the lich's next-cast cooldown.
    eruptions.add(erupt);
    for (let i = 0; i < 18; i++) spawnHronalStone(erupt, i / 18 * Math.PI * 2, radiusWorld, true, false); // Immediate readable perimeter before continuous violent pops.
    lastEvent = `earth-warning:${owner.id || owner.name}:telegraph=${erupt.telegraphS.toFixed(2)}`;
    return erupt;
  }

  function actorsForHronalEruption(owner) {
    const actors = [];
    if (isLiveActor(deps?.player) && deps.player !== owner) actors.push(deps.player);
    for (const actor of deps?.hostileObjects || []) {
      if (actor === owner || !isLiveActor(actor)) continue;
      actors.push(actor);
    }
    return actors;
  }

  function resolveHronalEruption(erupt) {
    if (!erupt || erupt.erupted) return;
    erupt.erupted = true;
    erupt.eruptionAgeS = 0;
    if (erupt.ring) erupt.ring.visible = false;
    for (const particle of erupt.particles) particle.trackRing = false; // Existing warning stones explode outward instead of continuing to collapse toward the center.
    for (let i = 0; i < 30; i++) spawnHronalStone(erupt, random() * Math.PI * 2, erupt.radiusWorld * (0.15 + random() * 0.85), false, true);
    const lavaMaterial = new THREE.MeshBasicMaterial({
      color: 0xff4a12, transparent: true, opacity: 0.88, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    erupt.lava = new THREE.Mesh(new THREE.CircleGeometry(erupt.radiusWorld, 28), lavaMaterial);
    erupt.lava.rotation.x = -Math.PI / 2;
    erupt.lava.position.y = 0.012;
    erupt.lava.renderOrder = 5;
    erupt.root.add(erupt.lava);
    erupt.lavaCore = new THREE.Mesh(
      new THREE.CircleGeometry(erupt.radiusWorld * 0.55, 24),
      new THREE.MeshBasicMaterial({ color: 0xffc02f, transparent: true, opacity: 0.82, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })
    );
    erupt.lavaCore.rotation.x = -Math.PI / 2;
    erupt.lavaCore.position.y = 0.018;
    erupt.lavaCore.renderOrder = 6;
    erupt.root.add(erupt.lavaCore);

    const fountainHeight = erupt.radiusWorld * HRONAL_LAVA_FOUNTAIN_HEIGHT_MULT; // Tall central jet makes the damage moment read vertically without adding dozens of particle objects.
    erupt.lavaFountain = new THREE.Mesh(
      new THREE.ConeGeometry(erupt.radiusWorld * 0.42, fountainHeight, 9, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xff4a12, transparent: true, opacity: 0.92, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })
    );
    erupt.lavaFountain.position.y = fountainHeight * 0.5;
    erupt.lavaFountain.scale.set(1, 0.02, 1);
    erupt.lavaFountain.renderOrder = 7;
    erupt.root.add(erupt.lavaFountain);
    erupt.lavaFountainCore = new THREE.Mesh(
      new THREE.ConeGeometry(erupt.radiusWorld * 0.20, fountainHeight * 0.88, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffd34a, transparent: true, opacity: 0.88, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })
    );
    erupt.lavaFountainCore.position.y = fountainHeight * 0.44;
    erupt.lavaFountainCore.scale.set(1, 0.02, 1);
    erupt.lavaFountainCore.renderOrder = 8;
    erupt.root.add(erupt.lavaFountainCore);
    for (const actor of actorsForHronalEruption(erupt.owner)) {
      const dist = Math.hypot((Number(actor.x) || 0) - erupt.x, (Number(actor.y) || 0) - erupt.y);
      if (dist > erupt.radiusPx) continue;
      window.ResourceSystem?.addAffliction?.(actor, 'burningHealth', erupt.payload.burningHealth); // Lava is the attack: warning stones themselves cause no damage or affliction.
      lastEvent = `earth-erupt-hit:${actor.id || actor.name || 'player'}`;
    }
    if (!lastEvent.startsWith('earth-erupt-hit:')) lastEvent = `earth-erupt:${erupt.owner.id || erupt.owner.name}`;
  }

  function updateHronalParticles(erupt, dt, visualRadiusWorld) {
    const gravity = 4.25; // Slightly harsher than Grehlr dirt so chunks violently pop and fall back rather than float.
    for (let i = erupt.particles.length - 1; i >= 0; i--) {
      const particle = erupt.particles[i];
      particle.life -= dt;
      particle.vy -= gravity * dt;
      if (particle.trackRing && !erupt.erupted) {
        particle.x = Math.cos(particle.angle) * visualRadiusWorld * particle.radialScale;
        particle.z = Math.sin(particle.angle) * visualRadiusWorld * particle.radialScale;
      } else {
        particle.x += particle.vx * dt;
        particle.z += particle.vz * dt;
      }
      particle.y += particle.vy * dt;
      particle.rotX += dt * 5.5;
      particle.rotZ += dt * 4.2;
      if (particle.life <= 0) {
        writeHronalStoneInstance(erupt, particle, true);
        erupt.freeStoneSlots?.push?.(particle.slot);
        erupt.particles.splice(i, 1);
        continue;
      }
      writeHronalStoneInstance(erupt, particle);
    }
  }

  function updateEruptions(dt) {
    for (const erupt of eruptions) { // Deleting the current Set entry is safe during iteration; avoid allocating a fresh eruption array every frame.
      if (!isArena() || !isLiveActor(erupt.owner)) { disposeHronalEruption(erupt); continue; }
      if (!erupt.erupted) {
        erupt.ageS += dt;
        const progress = Math.max(0, Math.min(1, erupt.ageS / erupt.telegraphS));
        const visualRadiusWorld = erupt.radiusWorld * (1 - progress); // Grehlr-style warning perimeter contracts all the way to zero at eruption.
        erupt.ring.scale.setScalar(Math.max(0.001, 1 - progress));
        erupt.ring.material.opacity = 0.38 + progress * 0.34;
        erupt.emitCarry += HRONAL_STONE_PARTICLES_PER_S * dt;
        while (erupt.emitCarry >= 1) {
          erupt.emitCarry -= 1;
          spawnHronalStone(erupt, random() * Math.PI * 2, visualRadiusWorld, true, false);
        }
        updateHronalParticles(erupt, dt, visualRadiusWorld);
        if (progress >= 1) resolveHronalEruption(erupt);
        continue;
      }
      erupt.eruptionAgeS += dt;
      updateHronalParticles(erupt, dt, 0);
      const lifeT = Math.max(0, Math.min(1, erupt.eruptionAgeS / HRONAL_LAVA_VISUAL_S));
      if (erupt.lava?.material) erupt.lava.material.opacity = 0.88 * (1 - lifeT);
      if (erupt.lavaCore?.material) erupt.lavaCore.material.opacity = 0.82 * (1 - lifeT);
      const pulse = 1 + Math.sin(lifeT * Math.PI) * 0.2;
      erupt.lava?.scale?.setScalar?.(pulse);
      erupt.lavaCore?.scale?.setScalar?.(pulse * 0.92);
      const fountainPulse = Math.max(0.001, Math.sin(lifeT * Math.PI)); // Jet shoots up immediately, peaks halfway through the flash, then collapses back into the vent.
      const fountainWidth = 0.82 + fountainPulse * 0.28;
      if (erupt.lavaFountain) {
        erupt.lavaFountain.scale.set(fountainWidth, fountainPulse * 1.35, fountainWidth);
        erupt.lavaFountain.position.y = erupt.radiusWorld * HRONAL_LAVA_FOUNTAIN_HEIGHT_MULT * 0.5 * fountainPulse * 1.35;
        erupt.lavaFountain.material.opacity = 0.92 * (1 - lifeT);
      }
      if (erupt.lavaFountainCore) {
        erupt.lavaFountainCore.scale.set(fountainWidth * 0.72, fountainPulse * 1.5, fountainWidth * 0.72);
        erupt.lavaFountainCore.position.y = erupt.radiusWorld * HRONAL_LAVA_FOUNTAIN_HEIGHT_MULT * 0.44 * fountainPulse * 1.5;
        erupt.lavaFountainCore.material.opacity = 0.88 * (1 - lifeT);
      }
      if (erupt.eruptionAgeS >= HRONAL_LAVA_VISUAL_S && erupt.particles.length === 0) disposeHronalEruption(erupt);
    }
  }

  function buildPetroleumSurfaceGeometry() {
    if (petroleumSurfaceGeometry || typeof THREE === 'undefined') return petroleumSurfaceGeometry;
    const segments = 28; // Similar low-poly surface density to the snow micro-plateau while remaining cheap enough for many overlapping hazards.
    const topRadius = 0.76; // Flat central cap before the shallow snow-like edge incline returns to ground.
    const positions = [0, PETROLEUM_SURFACE_DEPTH, 0]; // Center vertex is the highest point, exactly one-quarter Western Slope snow depth.
    const uvs = [0.5, 0.5];
    const indices = [];
    for (let i = 0; i < segments; i++) {
      const angle = i / segments * Math.PI * 2;
      const irregular = 1 + Math.sin(i * 2.17) * 0.055 + Math.cos(i * 1.31) * 0.035; // Deterministic uneven edge keeps the petroleum from reading as a perfect spell circle.
      const tx = Math.cos(angle) * topRadius * irregular;
      const tz = Math.sin(angle) * topRadius * irregular;
      positions.push(tx, PETROLEUM_SURFACE_DEPTH, tz);
      uvs.push((tx + 1) * 0.5, (tz + 1) * 0.5);
    }
    for (let i = 0; i < segments; i++) {
      const angle = i / segments * Math.PI * 2;
      const irregular = 1 + Math.sin(i * 2.17) * 0.055 + Math.cos(i * 1.31) * 0.035;
      const ox = Math.cos(angle) * irregular;
      const oz = Math.sin(angle) * irregular;
      positions.push(ox, 0, oz); // Outer rim meets the real ground just like Western Slope snow's exposed micro-plateau edges.
      uvs.push((ox + 1) * 0.5, (oz + 1) * 0.5);
    }
    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments;
      const topA = 1 + i;
      const topB = 1 + next;
      const outerA = 1 + segments + i;
      const outerB = 1 + segments + next;
      indices.push(0, topA, topB); // Flat textured top cap.
      indices.push(topA, outerA, outerB, topA, outerB, topB); // Shallow sloped side, snow-micro-plateau style.
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals?.();
    geometry.computeBoundingSphere?.();
    petroleumSurfaceGeometry = geometry;
    return petroleumSurfaceGeometry;
  }

  function loadPetroleumTexture() {
    if (petroleumTextureLoadStarted || !petroleumSurfaceMaterial || !THREE?.TextureLoader) return;
    petroleumTextureLoadStarted = true;
    new THREE.TextureLoader().load(PETROLEUM_TEXTURE_PATH, loaded => {
      let finalTexture = loaded; // Same canvas.png source as Western Slope snow, recolored black through the shared shade-fill pipeline.
      let shadeFilled = false;
      try {
        if (typeof window.getShadeFillCanvas === 'function' && loaded.image && THREE.CanvasTexture) {
          const canvas = window.getShadeFillCanvas(loaded.image, 'kanthic-petroleum|canvas.png|black', {
            mode: 'shadeFill',
            rgb: [18, 18, 18], // Near-black preserves canvas.png luminance/grain; literal 0 would mathematically flatten every tinted pixel.
            options: window.getPortraitTintingConfig?.() || {},
          });
          if (canvas) {
            finalTexture = new THREE.CanvasTexture(canvas);
            shadeFilled = true;
          }
        }
      } catch (_) {}
      finalTexture.wrapS = finalTexture.wrapT = THREE.RepeatWrapping;
      finalTexture.minFilter = THREE.LinearFilter;
      finalTexture.magFilter = THREE.LinearFilter;
      finalTexture.generateMipmaps = false;
      finalTexture.needsUpdate = true;
      petroleumSurfaceMaterial.map = finalTexture;
      petroleumSurfaceMaterial.color.set(shadeFilled ? 0xffffff : 0x000000); // Raw fallback is multiplied black; shade-filled texture already carries the requested black tint.
      petroleumSurfaceMaterial.needsUpdate = true;
    }, undefined, () => {});
  }

  function petroleumMaterial() {
    if (petroleumSurfaceMaterial || typeof THREE === 'undefined') return petroleumSurfaceMaterial;
    petroleumSurfaceMaterial = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: PETROLEUM_OPACITY,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      fog: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }); // Black semi-transparent textured skin; no amber/violet magical sheen remains.
    loadPetroleumTexture();
    return petroleumSurfaceMaterial;
  }

  function disposePetroleumPuddle(puddle) {
    if (!puddle) return;
    puddles.delete(puddle);
    puddle.group?.parent?.remove?.(puddle.group); // Shared geometry/material stay cached for the next impact instead of being disposed per puddle.
  }

  function makeGasolinePuddle(owner, xPx, yPx) {
    if (!isArena() || !owner?.scene || typeof THREE === 'undefined') return null;
    const geometry = buildPetroleumSurfaceGeometry();
    const material = petroleumMaterial();
    if (!geometry || !material) return null;
    const group = new THREE.Group(); // Runtime/API name remains compatible, but the visual is now explicitly petroleum.
    group.name = 'kanthic_petroleum_surface';
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'kanthic_petroleum_micro_plateau';
    mesh.rotation.y = random() * Math.PI * 2; // Shared irregular geometry is rotated per impact so repeated puddles do not visibly stamp the same edge.
    mesh.scale.set(PUDDLE_RADIUS_TILES, 1, PUDDLE_RADIUS_TILES);
    mesh.renderOrder = 3;
    group.add(mesh);
    const groundY = groundYAt(owner, xPx, yPx); // The shallow cap is rooted on the actual arena surface just like Western Slope snow roots on authored terrain height.
    group.position.set(xPx / deps.TILE, groundY, yPx / deps.TILE); // Polygon offset handles z-fighting, so the cap's actual top stays exactly PETROLEUM_SURFACE_DEPTH above ground.
    owner.scene.add(group);
    const puddle = {
      owner, x: xPx, y: yPx, group, mesh,
      ageS: 0, tickS: 0, radiusPx: PUDDLE_RADIUS_TILES * deps.TILE,
    }; // Gameplay radius stays unchanged; only presentation becomes the low black textured petroleum surface.
    puddles.add(puddle);
    totalPuddles += 1;
    lastEvent = `petroleum:${owner.id || owner.name}`;
    return puddle;
  }

  function entrancedManeuverKind(target) {
    if (target?.lunging || target?._banditLunging) return 'lunge';
    if (target?.dodging) return 'dodge';
    return null;
  }

  function entrancedManeuverDirection(target, kind) {
    const rawX = kind === 'lunge' ? Number(target?.lungeDirX ?? target?._banditLungeDirX) : Number(target?.dodgeDirX);
    const rawY = kind === 'lunge' ? Number(target?.lungeDirY ?? target?._banditLungeDirY) : Number(target?.dodgeDirY);
    const magnitude = Math.hypot(rawX || 0, rawY || 0);
    if (magnitude > 1e-6) return { x: rawX / magnitude, y: rawY / magnitude };
    const angle = Number(target?.angle ?? target?.facing) || 0; // Fallback preserves a stable intended direction if a special dodge/lunge omits explicit axes.
    return { x: Math.cos(angle), y: Math.sin(angle) };
  }

  function resetEntrancedMovementBaseline(target, state, source = state?.source) {
    if (!target || !state) return;
    state.lastX = Number(target.x) || 0;
    state.lastY = Number(target.y) || 0;
    state.lastDistance = source
      ? Math.hypot(state.lastX - (Number(source.x) || 0), state.lastY - (Number(source.y) || 0))
      : 0;
  }

  function beginEntrancedCommandGrace(target, state, command, now = performance.now()) {
    if (!target || !state) return;
    state.command = command === 'flee' ? 'flee' : 'approach';
    state.graceStartedAt = now; // Banner first shows the spoken command, then uses this timestamp to derive the 3→2→1 countdown.
    state.graceUntil = now + ENTRANCED_COMMAND_GRACE_MS;
    state.activeManeuver = null;
    state.suppressManeuverUntilEnd = entrancedManeuverKind(target); // A dodge/lunge already underway when a command changes belongs wholly to the no-damage grace period.
    resetEntrancedMovementBaseline(target, state);
  }

  function entrancedGraceDisplay(state, now = performance.now()) {
    if (!state || !(state.graceUntil > now)) return null;
    const elapsed = Math.max(0, now - (state.graceStartedAt || now));
    if (elapsed < ENTRANCED_COMMAND_ANNOUNCE_MS) return { phase: 'announce', countdown: null };
    const countdownElapsed = elapsed - ENTRANCED_COMMAND_ANNOUNCE_MS;
    const countdown = Math.max(1, Math.min(3, 3 - Math.floor(countdownElapsed / 1000)));
    return { phase: 'countdown', countdown }; // Exactly three one-second beats follow the short spoken-command banner.
  }

  function liveEntrancedApplicators() {
    return [...(deps?.hostileObjects || [])].filter(actor =>
      isLiveActor(actor)
      && (actor.enemyClass === CLASS_ID || actor.isHarlyaoLich)
      && actor.lichType === 'kanthic'
    ); // Only live Kanthic liches can create/refresh Entranced Health.
  }

  function applyEntranced(target, source, amount) {
    if (!target || !source || !(amount > 0)) return 0;
    const added = window.ResourceSystem?.addAffliction?.(target, 'entrancedHealth', amount) || 0; // Canonical ring buildup amount.
    const command = source._lichCommand === 'flee' ? 'flee' : 'approach';
    let state = target._entrancedCommandState;
    const controllerChanged = !state || state.source !== source;
    if (controllerChanged) {
      state = target._entrancedCommandState = {
        source, sourceId: source.id || null,
        lastX: 0, lastY: 0, lastDistance: 0,
        command,
        graceStartedAt: 0, graceUntil: 0,
        activeManeuver: null, suppressManeuverUntilEnd: null,
      }; // Latest applicant deliberately replaces any older referential lich.
      beginEntrancedCommandGrace(target, state, command);
    } else {
      state.sourceId = source.id || null;
      if (command !== state.command) beginEntrancedCommandGrace(target, state, command); // A real command flip earns a fresh no-damage countdown.
      else resetEntrancedMovementBaseline(target, state, source); // Repeated puddle buildup never restarts grace, but it must not manufacture movement from an old sample.
    }
    return added;
  }

  // Wildlife shares its def object with every creature of the species
  // (CREATURE_DB[key]), so writing speeds into it slowed the whole species and
  // overlapping slows could restore to an already-slowed "base" permanently.
  // Non-bandit targets get a per-creature prototype overlay instead (same
  // pattern as wildlife-territorial.js); Bandit/Minion/Lich defs are already
  // per-entity objects and are written directly.
  function defInPrototypeChain(def, candidate) {
    for (let d = def; d; d = Object.getPrototypeOf(d)) if (d === candidate) return true;
    return false;
  }

  function enemySlowDef(target) {
    if (!target?.def) return null;
    if (target.isBandit) return target.def;
    const existing = target._kanthicSlowDef; // Reused across slow episodes so the prototype chain never grows per hit.
    if (existing && defInPrototypeChain(target.def, existing)) return existing;
    const overlay = Object.create(target.def); // Per-creature layer; the shared species def stays untouched.
    target.def = overlay;
    target._kanthicSlowDef = overlay;
    return overlay;
  }

  function restoreEnemySlowDef(target, state) {
    const slowDef = state?.slowDef;
    if (!slowDef || target === deps?.player) return;
    if (slowDef === target._kanthicSlowDef) {
      delete slowDef.moveSpeed; // Falls back through the overlay to the live species values.
      delete slowDef.chaseSpeed;
    } else if (Number.isFinite(state.baseMoveSpeed)) {
      slowDef.moveSpeed = state.baseMoveSpeed;
      slowDef.chaseSpeed = state.baseChaseSpeed;
    }
  }

  function addGooSlow(target) {
    const now = performance.now(); // Duration clock shared by player and hostile slow handling.
    const state = target._kanthicGooSlow || { stacks: 0, until: 0, slowDef: null, baseMoveSpeed: null, baseChaseSpeed: null }; // Runtime-only stacking state; base enemy speeds are captured once per slow episode.
    state.stacks = Math.min(GOO_SLOW_MAX_STACKS, state.stacks + 1);
    state.until = now + GOO_SLOW_DURATION_MS;
    if (target !== deps?.player && target.def && !state.slowDef) {
      state.slowDef = enemySlowDef(target);
      state.baseMoveSpeed = Number(state.slowDef.moveSpeed) || 0;
      state.baseChaseSpeed = Number(state.slowDef.chaseSpeed) || state.baseMoveSpeed;
    }
    target._kanthicGooSlow = state;
    applyEnemySlow(target);
  }

  function slowMultiplier(target) {
    const state = target?._kanthicGooSlow; // Active stack record used by player and enemy movement composition.
    if (!state || state.until <= performance.now()) return 1;
    return Math.max(0.48, 1 - state.stacks * GOO_SLOW_PER_STACK);
  }

  function applyEnemySlow(target) {
    const state = target?._kanthicGooSlow; // Captured enemy speeds restored exactly when the duration expires.
    if (!state?.slowDef || target === deps?.player || !Number.isFinite(state.baseMoveSpeed)) return;
    const mul = slowMultiplier(target); // Current stack-derived movement multiplier.
    state.slowDef.moveSpeed = state.baseMoveSpeed * mul;
    state.slowDef.chaseSpeed = state.baseChaseSpeed * mul;
  }

  function clearExpiredSlow(target) {
    const state = target?._kanthicGooSlow; // Runtime record removed after restoring authored movement values.
    if (!state || state.until > performance.now()) {
      if (state && target !== deps?.player) applyEnemySlow(target);
      return;
    }
    restoreEnemySlowDef(target, state);
    delete target._kanthicGooSlow;
  }

  function clearGooSlowNow(target) {
    const state = target?._kanthicGooSlow; // Immediate arena-exit cleanup restores enemy speeds instead of waiting for the duration clock.
    if (!state) return;
    restoreEnemySlowDef(target, state);
    delete target._kanthicGooSlow;
  }

  function clearEntrancedNow(target) {
    if (!target) return;
    const amount = window.ResourceSystem?.getAffliction?.(target, 'entrancedHealth') || 0; // Current arena-only buildup cleared when its referential lich can no longer be in the active area.
    if (amount > 0) window.ResourceSystem?.removeAffliction?.(target, 'entrancedHealth', amount);
    delete target._entrancedCommandState;
  }

  function resolveEntrancedMovement(target, state, command, movedPx, distanceDelta, dt, sourceLabel) {
    const RS = window.ResourceSystem;
    const amount = RS?.getAffliction?.(target, 'entrancedHealth') || 0;
    if (!(amount > 0)) return;
    const movementEpsilon = Math.max(0.45, (deps.TILE || 64) * 0.002); // Filters animation/physics jitter so standing still is never punished.
    const moved = movedPx > movementEpsilon;
    const wrong = moved && ((command === 'approach' && distanceDelta > movementEpsilon) || (command === 'flee' && distanceDelta < -movementEpsilon));
    const obeying = moved && ((command === 'approach' && distanceDelta < -movementEpsilon) || (command === 'flee' && distanceDelta > movementEpsilon));
    if (wrong) {
      const requested = movedPx / (deps.TILE || 64) * ENTRANCED_WRONG_MOVE_DAMAGE_PER_TILE; // Dodge/lunge callers pass exactly TILE here; ordinary movement remains actual-distance-scaled.
      const consumed = Math.min(amount, requested);
      RS?.removeAffliction?.(target, 'entrancedHealth', consumed);
      RS?.applyHealthAfflictionDamage?.(target, consumed);
      lastEvent = `entranced-punish:${command}:${sourceLabel || target.id || target.name || 'player'}`;
      return;
    }
    const rate = (!moved || obeying) ? ENTRANCED_FAST_RECOVERY_PER_S : ENTRANCED_BASE_RECOVERY_PER_S;
    RS?.removeAffliction?.(target, 'entrancedHealth', rate * dt);
  }

  function updateEntrancedTarget(target, dt) {
    const RS = window.ResourceSystem; // Central source for current buildup, removal, and damage conversion.
    const amount = RS?.getAffliction?.(target, 'entrancedHealth') || 0;
    const state = target?._entrancedCommandState; // Latest-applicant referential state installed by direct hit/puddle.
    if (!(amount > 0)) {
      if (state) delete target._entrancedCommandState;
      return;
    }
    if (liveEntrancedApplicators().length === 0) {
      clearEntrancedNow(target); // No lingering mind effect after the last enemy capable of applying Entranced Health dies.
      lastEvent = `entranced-cleared:no-applicators:${target.id || target.name || 'player'}`;
      return;
    }
    if (!state?.source || !isLiveActor(state.source)) {
      RS?.removeAffliction?.(target, 'entrancedHealth', ENTRANCED_FAST_RECOVERY_PER_S * dt); // A dead former controller cannot command, but buildup may naturally clear while another Kanthic still exists.
      return;
    }
    const source = state.source;
    const command = source._lichCommand === 'flee' ? 'flee' : 'approach';
    if (command !== state.command) beginEntrancedCommandGrace(target, state, command); // Tactical swaps never punish on the same frame the player learns the new command.

    const x = Number(target.x) || 0;
    const y = Number(target.y) || 0;
    const distance = Math.hypot(x - (Number(source.x) || 0), y - (Number(source.y) || 0));
    if (entrancedGraceDisplay(state)) {
      state.activeManeuver = null;
      state.suppressManeuverUntilEnd = entrancedManeuverKind(target) || state.suppressManeuverUntilEnd; // Any maneuver overlapping grace is wholly free.
      resetEntrancedMovementBaseline(target, state, source);
      return; // Grace freezes Entranced exactly: no damage conversion and no natural recovery.
    }

    const maneuverKind = entrancedManeuverKind(target);
    if (state.suppressManeuverUntilEnd) {
      if (maneuverKind === state.suppressManeuverUntilEnd) {
        resetEntrancedMovementBaseline(target, state, source);
        return;
      }
      state.suppressManeuverUntilEnd = null;
      resetEntrancedMovementBaseline(target, state, source);
      return; // First post-grace frame only closes the ignored maneuver; it cannot retroactively punish it.
    }

    if (maneuverKind) {
      if (!state.activeManeuver) {
        state.activeManeuver = {
          kind: maneuverKind,
          direction: entrancedManeuverDirection(target, maneuverKind),
          startX: x, startY: y,
          sourceX: Number(source.x) || 0, sourceY: Number(source.y) || 0,
        }; // Captures intent at maneuver start so collision-shortened and long authored variants are treated identically.
      }
      resetEntrancedMovementBaseline(target, state, source);
      return; // Per-frame displacement is ignored while a discrete dodge/lunge is active.
    }

    if (state.activeManeuver) {
      const move = state.activeManeuver;
      state.activeManeuver = null;
      const toSourceX = move.sourceX - move.startX;
      const toSourceY = move.sourceY - move.startY;
      const toSourceMag = Math.hypot(toSourceX, toSourceY);
      const dotToward = toSourceMag > 1e-6
        ? (move.direction.x * toSourceX + move.direction.y * toSourceY) / toSourceMag
        : 0;
      const syntheticDelta = dotToward > 0.08 ? -(deps.TILE || 64) : dotToward < -0.08 ? (deps.TILE || 64) : 0; // Positive distanceDelta means away; every directional maneuver is exactly one tile regardless of physical travel.
      resolveEntrancedMovement(target, state, command, deps.TILE || 64, syntheticDelta, dt, `${move.kind}-1tile`);
      resetEntrancedMovementBaseline(target, state, source);
      return;
    }

    const movedPx = Math.hypot(x - state.lastX, y - state.lastY); // Ordinary walking still uses actual distance and remains frame-rate independent.
    const distanceDelta = distance - state.lastDistance;
    resolveEntrancedMovement(target, state, command, movedPx, distanceDelta, dt);
    state.command = command;
    state.lastX = x;
    state.lastY = y;
    state.lastDistance = distance;
  }

  function ensureCommandBanner() {
    if (typeof document === 'undefined') return null;
    let el = document.getElementById('entrancedCommandBanner'); // Reused singleton HUD element styled by the shared game stylesheet rather than module-local debug CSS.
    if (el) return el;
    el = document.createElement('div');
    el.id = 'entrancedCommandBanner';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    const label = document.createElement('span'); // Small persistent condition label matching the game's ordinary HUD typography.
    label.className = 'entranced-command-label';
    label.textContent = 'ENTRANCED';
    const command = document.createElement('span'); // Large action phrase updated live when the controlling lich swaps Approach/Flee.
    command.className = 'entranced-command-action';
    el.append(label, command);
    document.body.appendChild(el);
    return el;
  }

  function updateCommandBanner() {
    const el = ensureCommandBanner(); // Player-only readable instruction; enemy Entranced state still runs with no banner.
    if (!el || !deps?.player) return;
    const amount = window.ResourceSystem?.getAffliction?.(deps.player, 'entrancedHealth') || 0; // Health-ring buildup determines visibility.
    const state = deps.player._entrancedCommandState; // Latest lich reference supplies name/current command.
    if (!(amount > 0) || !state?.source || !isLiveActor(state.source)) {
      el.classList.remove('visible', 'approach', 'flee', 'grace');
      return;
    }
    const command = state.source._lichCommand === 'flee' ? 'flee' : 'approach';
    const grace = entrancedGraceDisplay(state);
    const action = el.querySelector('.entranced-command-action');
    if (action) {
      if (grace?.phase === 'announce') action.textContent = `${state.source.name || 'The enemy'} commands you to ${command}`;
      else if (grace?.phase === 'countdown') action.textContent = String(grace.countdown);
      else action.textContent = command === 'flee' ? `FLEE FROM ${state.source.name || 'THE LICH'}` : `APPROACH ${state.source.name || 'THE LICH'}`;
    }
    el.classList.toggle('approach', command === 'approach');
    el.classList.toggle('flee', command === 'flee');
    el.classList.toggle('grace', !!grace);
    el.classList.add('visible');
  }

  function commandHudColor(command) {
    const cssVar = command === 'flee' ? '--danger' : '--accent'; // Exact semantic colors already used by the on-screen FLEE/APPROACH text.
    const fallback = command === 'flee' ? '#ff8060' : '#f9e28a'; // Mirrors style.css so non-DOM tests/tools still get the same palette.
    if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return fallback;
    return getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim() || fallback;
  }

  function commandAuraPalette(source) {
    const command = source?._lichCommand === 'flee' ? 'flee' : 'approach'; // The controller's live tactical command is the single color authority.
    const color = commandHudColor(command);
    if (typeof THREE === 'undefined') return { command, color, bright: color };
    const bright = `#${new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.34).getHexString()}`; // Brighter same-hue flame tips improve readability without inventing another semantic color.
    return { command, color, bright };
  }

  function ensureEntrancerEdgeAura() {
    if (typeof document === 'undefined') return null;
    let el = document.getElementById('entrancedCommandEdgeAura'); // Singleton full-screen edge cue shared by every Kanthic controller handoff.
    if (el) return el;
    el = document.createElement('div');
    el.id = 'entrancedCommandEdgeAura';
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
    return el;
  }

  function controllerBehindCamera(source) {
    const camera = deps?.getActiveCamera?.(); // Shared gameplay camera authority supplied through the same combat dependency bag as ranged targeting.
    const avatar = source?.avatarRef?.group;
    if (!camera || !avatar || typeof THREE === 'undefined') return false;
    const cameraPosition = camera.getWorldPosition?.(new THREE.Vector3()) || camera.position?.clone?.();
    const sourcePosition = avatar.getWorldPosition?.(new THREE.Vector3()) || avatar.position?.clone?.();
    if (!cameraPosition || !sourcePosition) return false;
    const forward = camera.getWorldDirection?.(new THREE.Vector3());
    if (!forward) return false;
    const toSource = sourcePosition.sub(cameraPosition);
    if (toSource.lengthSq() < 1e-8) return false;
    return forward.dot(toSource.normalize()) < 0; // Negative camera-forward dot means the controlling lich is literally behind the current view plane.
  }

  function updateEntrancerEdgeAura(source, command, behind) {
    const el = ensureEntrancerEdgeAura();
    if (!el) return;
    el.classList.toggle('approach', command === 'approach');
    el.classList.toggle('flee', command === 'flee');
    el.classList.toggle('visible', !!behind);
    el.dataset.controllerId = source?.id || '';
  }

  function hideEntrancerEdgeAura() {
    const el = typeof document !== 'undefined' ? document.getElementById('entrancedCommandEdgeAura') : null;
    if (!el) return;
    el.classList.remove('visible', 'approach', 'flee');
    el.dataset.controllerId = '';
    entrancerBehindCamera = false;
    entrancerAuraCommand = null;
  }

  function entrancedMarkerColor() {
    const raw = window.ResourceRings?.AFFLICTION_COLORS?.entrancedHealth ?? 0xb746d9; // Exact resource-ring palette entry keeps the owner marker visually tied to Entranced Health.
    return window.ResourceRings?.neonizeColor?.(raw) ?? raw; // Same vivid color treatment used by affliction-colored lunge/projectile trails.
  }

  function buildEntrancerMarker(scene) {
    if (!scene || typeof THREE === 'undefined') return null;
    const outer = ENTRANCER_RING_OUTER_RADIUS; // Permanent ownership ring outer radius at exactly 2× the lunge reference.
    const inner = Math.max(0.01, outer - ENTRANCER_RING_THICKNESS); // Doubled line width without changing the requested outer size.
    const color = entrancedMarkerColor(); // Shared Entranced palette color used by both steady and burst rings.
    const baseMaterial = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.52, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, fog: false,
    }); // Same additive/fog-free ground-ring material vocabulary as the actual lunge trail, held faint between bursts.
    const pulseMaterial = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.8, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, fog: false,
    }); // Matches the actual lunge stamp's additive, fog-free 0.8-opacity material before the once-per-second expansion/fade.
    const base = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 24), baseMaterial); // Stable doubled ring around the controlling lich.
    const pulse = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 24), pulseMaterial); // Same geometry expands/fades explosively once per second.
    for (const mesh of [base, pulse]) {
      mesh.rotation.x = -Math.PI / 2;
      mesh.renderOrder = 6;
    }
    pulse.position.y = 0.003; // Tiny separation avoids z-fighting between the steady ring and burst at pulse start.
    const group = new THREE.Group();
    group.name = 'entranced_controller_ring';
    group.add(base, pulse);
    group.userData.baseRing = base; // Used by the update path to keep a faint steady ownership indicator.
    group.userData.pulseRing = pulse; // Used by the one-second expansion/fade animation.
    scene.add(group);
    return group;
  }

  function colorCssHex(colorValue) {
    if (typeof THREE === 'undefined') return '#b746d9';
    return `#${new THREE.Color(colorValue).getHexString()}`; // AuthoredFurniture emitters accept CSS colors, while ResourceRings stores numeric colors.
  }

  function buildEntrancerAura(source) {
    const avatar = source?.avatarRef?.group; // Avatar-local parenting keeps the fire column on the controlling lich's body at every terrain height.
    const authored = window.AuthoredFurniture; // Existing furniture particle renderer is also used by Burning Health; no second custom particle engine.
    if (!avatar || !authored?.createEmitterVisual || typeof THREE === 'undefined') return null;
    const anchor = new THREE.Group(); // Separate disposable child prevents the emitter from mutating avatar-owned userData/parts.
    anchor.name = 'entranced_controller_aura';
    const halfHeight = Math.max(0.25, Number(source.halfHeight) || Number(source.avatarRef?.modelHeight) / 2 || 0.45); // Used to start flames just above the feet.
    anchor.position.y = -halfHeight + 0.06;
    avatar.add(anchor);
    const palette = commandAuraPalette(source); // World fire uses the exact same semantic Approach/Flee color as the HUD text.
    const emitter = {
      id: 'entranced_controller_fire',
      name: 'Entranced Controller Aura',
      type: 'fire', enabled: true,
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      radius: Math.max(0.34, Number(source.avatarRef?.modelWidth) * 0.42 || 0.42),
      size: 0.24,
      rate: 92,
      lifetime: 1.02,
      speed: Math.max(0.92, halfHeight * 1.9),
      spread: 0.46,
      gravity: -0.06,
      colorA: palette.bright,
      colorB: palette.color,
    }; // Deliberately larger/denser than the ordinary campfire-derived Burning Health emitter so the controller reads at character height.
    const visual = authored.createEmitterVisual(anchor, emitter, ENTRANCER_AURA_MAX_PARTICLES);
    if (!visual) {
      avatar.remove(anchor);
      return null;
    }
    entrancerAuraAnchor = anchor;
    entrancerAuraVisual = visual;
    return visual;
  }

  function disposeEntrancerAura() {
    entrancerAuraVisual?.dispose?.();
    entrancerAuraVisual = null;
    entrancerAuraAnchor?.parent?.remove?.(entrancerAuraAnchor);
    entrancerAuraAnchor = null;
  }

  function disposeEntrancerMarker() {
    if (entrancerMarker) disposeObject3D(entrancerMarker);
    entrancerMarker = null;
    disposeEntrancerAura();
    hideEntrancerEdgeAura();
    entrancerMarkerSource = null;
  }

  function updateEntrancerMarker(dt = 0) {
    const player = deps?.player; // Only the lich currently controlling the player receives this world-space owner marker.
    const amount = player ? (window.ResourceSystem?.getAffliction?.(player, 'entrancedHealth') || 0) : 0; // Marker/aura exist only while Entranced buildup is actually present.
    const source = player?._entrancedCommandState?.source || null; // Latest applicant is the referential owner and therefore the only marked lich.
    if (!(amount > 0) || !isArena() || !isLiveActor(source) || source.lichType !== 'kanthic') {
      disposeEntrancerMarker();
      return;
    }
    if (!entrancerMarker || entrancerMarkerSource !== source || entrancerMarker.parent !== source.scene) {
      disposeEntrancerMarker();
      entrancerMarker = buildEntrancerMarker(source.scene);
      entrancerMarkerSource = source; // Aura can still identify the source even if the optional ground-ring scene mesh could not be constructed.
      buildEntrancerAura(source);
    } else if (!entrancerAuraVisual) {
      buildEntrancerAura(source); // Late-loaded AuthoredFurniture can attach the body-height cue without waiting for Entranced to be reapplied.
    }
    const palette = commandAuraPalette(source); // Command can flip while the same Entranced application remains, so recolor every live update rather than only at emitter construction.
    entrancerAuraCommand = palette.command;
    entrancerBehindCamera = controllerBehindCamera(source);
    updateEntrancerEdgeAura(source, palette.command, entrancerBehindCamera);
    if (entrancerAuraVisual) {
      const phase = (performance.now() % ENTRANCER_RING_PULSE_MS) / ENTRANCER_RING_PULSE_MS; // Shared one-second phase gives the fire a subtle synchronized surge with the ground pulse.
      const surge = phase < ENTRANCER_RING_BURST_FRACTION ? 1.32 : 1;
      entrancerAuraVisual.update?.(Math.max(0, Number(dt) || 0), true, {
        rate: 92 * surge,
        size: 0.24 * (0.94 + 0.06 * surge),
        colorA: palette.bright,
        colorB: palette.color,
      }); // Approach uses --accent; Flee uses --danger, exactly matching the HUD action text.
    }
    if (!entrancerMarker) return;
    const groundY = groundYAt(source, source.x, source.y); // Marker follows the controller across arena ramps/slabs rather than assuming flat world zero.
    entrancerMarker.position.set(source.x / deps.TILE, groundY + 0.035, source.y / deps.TILE);
    const phase = (performance.now() % ENTRANCER_RING_PULSE_MS) / ENTRANCER_RING_PULSE_MS; // Stable one-second clock; no accumulated timer drift.
    const burst = Math.min(1, phase / ENTRANCER_RING_BURST_FRACTION); // 0→1 only during the short explosive portion of each cycle.
    const pulseActive = phase < ENTRANCER_RING_BURST_FRACTION; // Remaining cycle leaves only the faint ownership ring visible.
    const eased = 1 - Math.pow(1 - burst, 3); // Fast initial acceleration gives the requested explosive rather than breathing/sine-like pulse.
    const pulse = entrancerMarker.userData.pulseRing; // Expanding high-opacity ring layered just above the steady marker.
    const base = entrancerMarker.userData.baseRing; // Continuous ring gets a tiny kick on burst onset so the whole marker feels reactive.
    if (pulse?.material) {
      const scale = 1 + eased * 1.15;
      pulse.scale.setScalar(scale);
      pulse.material.opacity = pulseActive ? Math.max(0, 0.8 * (1 - eased)) : 0;
      pulse.visible = pulseActive;
    }
    if (base?.material) {
      const kick = pulseActive ? (1 - eased) * 0.16 : 0;
      base.scale.setScalar(1 + kick);
      base.material.opacity = 0.42 + (pulseActive ? (1 - eased) * 0.28 : 0);
    }
  }

  function updatePuddles(dt) {
    for (const puddle of [...puddles]) {
      puddle.ageS += dt;
      if (!isArena() || !isLiveActor(puddle.owner) || puddle.ageS >= PUDDLE_LIFETIME_S) {
        disposePetroleumPuddle(puddle);
        continue;
      }
      const fade = puddle.ageS > PUDDLE_LIFETIME_S - 2 ? Math.max(0, (PUDDLE_LIFETIME_S - puddle.ageS) / 2) : 1; // Last two seconds visibly evaporate instead of popping.
      if (puddle.mesh) puddle.mesh.visible = fade > 0.01; // Shared 70%-opacity material cannot be faded per instance without affecting every puddle; gameplay lifetime remains unchanged.
      puddle.tickS += dt;
      if (puddle.tickS < PUDDLE_TICK_S) continue;
      puddle.tickS %= PUDDLE_TICK_S;
      for (const actor of [deps.player, ...(deps.hostileObjects || [])]) {
        if (!isLiveActor(actor) || actor === puddle.owner) continue;
        const dist = Math.hypot(actor.x - puddle.x, actor.y - puddle.y); // Flat arena-ground radius check intentionally ignores portrait height.
        if (dist <= puddle.radiusPx) applyEntranced(actor, puddle.owner, PUDDLE_ENTRANCED_PER_TICK);
      }
    }
  }

  function updateProjectiles(dt) {
    for (const projectile of [...projectiles]) {
      if (!isArena() || !isLiveActor(projectile.owner)) { disposeProjectile(projectile); continue; }
      projectile.ageS += dt;
      projectile.prevX = projectile.x; projectile.prevY = projectile.y; projectile.prevWorldY = projectile.worldY;
      if (projectile.type === 'tothal') updateTothalSeeking(projectile, dt); // Slow fog continually curves toward a live actor instead of committing to its cast-time trajectory.
      projectile.x += projectile.vx * dt;
      projectile.y += projectile.vy * dt;
      projectile.vyWorld -= (projectile.payload.gravityWorldS2 || 0) * dt;
      projectile.worldY += projectile.vyWorld * dt;
      projectile.mesh.position.set(projectile.x / deps.TILE, projectile.worldY, projectile.y / deps.TILE);
      if (projectile.type === 'tothal') {
        const power = projectilePower(projectile); // One lifetime scalar owns size, opacity, wind strength, and eventual impact strength.
        const wiggle = projectile.payload.wiggleWorld || 0;
        projectile.mesh.position.x += Math.sin(projectile.ageS * 5.1) * wiggle;
        projectile.mesh.position.y += Math.sin(projectile.ageS * 6.7 + 0.9) * wiggle * 0.55;
        projectile.mesh.position.z += Math.cos(projectile.ageS * 4.6) * wiggle;
        projectile.mesh.scale.setScalar(Math.max(0.035, power)); // Fog ball visibly collapses toward zero across its finite lifespan.
        projectile.mesh.traverse(child => {
          if (!child.isMesh || !child.userData?.fogBasePosition) return;
          const base = child.userData.fogBasePosition;
          const phase = child.userData.fogPhase || 0;
          child.position.set(
            base.x + Math.sin(projectile.ageS * 7.3 + phase) * 0.032,
            base.y + Math.cos(projectile.ageS * 5.9 + phase * 1.7) * 0.026,
            base.z + Math.sin(projectile.ageS * 6.4 + phase * 0.7) * 0.032,
          ); // Internal lobes writhe independently while the physical collision path remains smooth and predictable.
          if (child.material) child.material.opacity = (child.userData.baseOpacity || 0.2) * Math.max(0.08, power);
        });
        updateTothalWind(projectile);
      } else {
        projectile.mesh.rotation.y += dt * 7;
        const pulse = 1 + Math.sin(projectile.ageS * 18) * 0.08; // Kanthic retains its existing viscous in-flight squash/pulse.
        projectile.mesh.scale.set(pulse, 1 / pulse, pulse);
      }

      const start = new THREE.Vector3(projectile.prevX / deps.TILE, projectile.prevWorldY, projectile.prevY / deps.TILE); // Previous 3D point for swept collision.
      const end = new THREE.Vector3(projectile.x / deps.TILE, projectile.worldY, projectile.y / deps.TILE); // Current physical 3D point; Tothal's decorative wiggle never changes collision fairness.
      const actorHit = nearestActorHit(projectile, start, end); // Nearest player/enemy body hit this step.
      const coverHit = window.NearbyVolumeCollision?.segmentHit?.(start, end, projectile.payload.radiusWorld) || null; // Existing world-volume cover collision.
      if (actorHit && (!coverHit || actorHit.t < coverHit.t)) {
        damageActor(actorHit.actor, projectile, actorHit.t);
        disposeProjectile(projectile);
        continue;
      }
      if (coverHit) {
        const impactX = projectile.prevX + (projectile.x - projectile.prevX) * coverHit.t; // Cover impact X used as Kanthic puddle center.
        const impactY = projectile.prevY + (projectile.y - projectile.prevY) * coverHit.t; // Cover impact Z-plane coordinate used as Kanthic puddle center.
        if (projectile.type === 'kanthic') makeGasolinePuddle(projectile.owner, impactX, impactY);
        disposeProjectile(projectile);
        continue;
      }
      const groundY = groundYAt(projectile.owner, projectile.x, projectile.y); // Current arena surface height for ballistic miss detection.
      if (projectile.worldY <= groundY + 0.045) {
        if (projectile.type === 'kanthic') makeGasolinePuddle(projectile.owner, projectile.x, projectile.y);
        disposeProjectile(projectile);
        continue;
      }
      if (projectile.ageS >= projectile.payload.maxAgeS) {
        if (projectile.type === 'kanthic') makeGasolinePuddle(projectile.owner, projectile.x, projectile.y);
        disposeProjectile(projectile);
      }
    }
  }

  async function summonMinion(lich) {
    if (lich._lichSummonPending || !isArena() || !window.MinionCombat?.makeEntity) return;
    const liveSummons = [...(lich._lichSummons || [])].filter(isLiveActor); // Used to enforce the per-lich live summon cap.
    lich._lichSummons = new Set(liveSummons);
    if (liveSummons.length >= SUMMON_CAP) return;
    lich._lichSummonPending = true;
    try {
      const angle = random() * Math.PI * 2; // Radial placement around the caster used for this summon.
      const dist = (deps.TILE || 64) * (0.8 + random() * 0.65); // Keeps Minions near the lich without spawning on its portrait.
      const x = lich.x + Math.cos(angle) * dist; // Summoned Minion world X.
      const y = lich.y + Math.sin(angle) * dist; // Summoned Minion world Z-plane coordinate.
      const minion = await window.MinionCombat.makeEntity({
        speciesId: 'harlyao-skeleton', name: 'Harlyao Skeleton', tier: lich.banditTier || 0,
        x, y, zoneId: lich.areaId || currentLichArea() || ARENA_ID, weaponMetalKey: 'nativeCopper',
        extra: { homeX: x, homeY: y, state: 'chase', summonedByLichId: lich.id },
      });
      if (!minion) return;
      if (!isArena() || !isLiveActor(lich)) {
        window.BanditCombat?.discardEntity?.(minion); // Full scene teardown: avatar, ground shadow, and weapon holders.
        return;
      }
      deps.hostileObjects?.add?.(minion);
      window.DevSpawner?.getArenaSpawnedCreatures?.()?.add?.(minion);
      lich._lichSummons.add(minion);
      totalSummons += 1;
      lastEvent = `summon:${lich.id || lich.name}->${minion.id || minion.name}`;
    } finally {
      lich._lichSummonPending = false;
    }
  }

  function hasDirectLineOfSight(lich, target) {
    const start = targetCenter(lich); // Caster center for the shared world-volume ray.
    const end = targetCenter(target); // Target center for the shared world-volume ray.
    return !window.NearbyVolumeCollision?.segmentHit?.(start, end, 0.05);
  }

  function updateCommand(lich, target, distPx) {
    const tile = deps.TILE || 64; // Converts tactical range thresholds to current game's pixel scale.
    const hidden = !hasDirectLineOfSight(lich, target); // Hiding/cover biases the command toward Approach so the target is urged out.
    let desired = lich._lichCommand || 'approach'; // Hysteresis preserves current command inside the neutral distance band.
    if (hidden || distPx > tile * 5.4) desired = 'approach';
    else if (distPx < tile * 3.15) desired = 'flee';
    // A command holds for its grace window (announce + countdown) plus a
    // further ENTRANCED_COMMAND_MIN_HOLD_MS before it may change; flipping
    // every few hundred ms made Kanthic commands impossible to follow.
    if (desired !== lich._lichCommand && performance.now() - (lich._lichCommandChangedAt || 0) > ENTRANCED_COMMAND_GRACE_MS + ENTRANCED_COMMAND_MIN_HOLD_MS) {
      lich._lichCommand = desired;
      lich._lichCommandChangedAt = performance.now();
      lastEvent = `command:${lich.id || lich.name}:${desired}`;
    }
  }

  function finishLichCast(lich) {
    if (!lich) return;
    lich._banditAction = null;
    lich.telegraphState = null;
    const natural = window.BanditCombat?.naturalSwing?.(lich.def) || { anim: 'thrust', pose: null }; // Returns to the same existing Light Weapon neutral used between casts.
    lich._banditSwingAnim = natural.anim;
    lich._banditSwingPose = natural.pose;
    lich._banditSwingDirSign = 1;
    lich._banditSwingPower = 1;
    lich._banditSwingPoseScale = 1;
    lich._lichCastingAbility = null;
  }

  function lichCastStep(lich, ability) {
    const steps = window.Combat?.comboData?.[LICH_CAST_COMBO_ID] || []; // Existing 1h Light Weapon thrust combo authored for ordinary player attacks.
    if (!steps.length) return { windupS: 0.16, strikeS: 0.10, anim: 'thrust', pose: null, dirSign: 1, power: 1 };
    const index = ability === 'summon'
      ? Math.min(steps.length - 1, 2) // Summon uses the longest existing light-weapon thrust for a visibly larger gesture.
      : (lich._lichCastAnimIndex || 0) % steps.length; // Projectile casts rotate through the existing combo instead of cloning one pose.
    if (ability !== 'summon') lich._lichCastAnimIndex = (index + 1) % steps.length;
    return steps[index];
  }

  function beginLichCast(lich, target, ability) {
    if (!lich || lich._banditAction || !isLiveActor(lich)) return false;
    const step = lichCastStep(lich, ability); // Existing Light Weapon attack timing/pose metadata used verbatim for the casting motion.
    const windupS = Number(step.windupS) || 0.16; // Captured once so Hronal's ground warning can be exactly 4× this cast's combined active timing.
    const strikeS = Number(step.strikeS) || 0.10; // Shared by staged animation and the Erupting Earth telegraph calculation.
    const targetX = Number(target?.x); // Target X sampled only to face the cast before its authored Windup begins.
    const targetY = Number(target?.y); // Target Z-plane coordinate sampled only to face the cast before its authored Windup begins.
    if (Number.isFinite(targetX) && Number.isFinite(targetY)) lich.facing = Math.atan2(targetY - lich.y, targetX - lich.x);
    lich.telegraphState = 'windup';
    lich._banditSwingAnim = step.anim || 'thrust';
    lich._banditSwingPose = step.pose || null;
    lich._banditSwingDirSign = step.dirSign || 1;
    lich._banditSwingPower = Number(step.power) || 1;
    lich._banditSwingPoseScale = 1;
    lich._lichCastingAbility = ability; // Mobile diagnostics distinguish projectile and summon gestures while the shared staged action is active.
    const onStrike = () => {
      lich.telegraphState = 'strike';
      if (ability === 'summon') {
        // An owner can swap summoning for raising its own fallen dead (the
        // Random Test Ruin sanctum lich raises its four coffin skeletons).
        if (lich.lichRaiseDead?.raise) { lich.lichRaiseDead.raise(lich); lastEvent = `raise:${lich.id || lich.name}`; }
        else summonMinion(lich);
      }
      else firePrimary(lich, target, { windupS, strikeS });
    };
    const begin = window.Combat?.beginStagedAction;
    if (typeof begin !== 'function') {
      onStrike(); // Defensive fallback for isolated tools/tests; gameplay always owns beginStagedAction.
      finishLichCast(lich);
      return true;
    }
    lich._banditAction = begin({
      windupS,
      strikeS,
      recoverS: 0,
      data: { isBandit: true, attacker: lich, lichCast: true, ability, comboId: LICH_CAST_COMBO_ID },
      onStrike,
      onComplete: () => finishLichCast(lich),
      onCancel: () => finishLichCast(lich),
    });
    return !!lich._banditAction;
  }

  function updateLichAI(lich, dt, target, distToTarget) {
    if (!isArena() || !isLiveActor(lich)) return { aimAngle: lich.facing || 0, moving: false, handled: true };
    target = target && Number(target.health) > 0 ? target : deps.player; // Shared hostile loop normally passes player; fallback keeps arena-spawned liches deterministic.
    if (!isLiveActor(target)) return { aimAngle: lich.facing || 0, moving: false, handled: true };
    const def = typeDef(lich.lichType); // Tradition tuning supplies preferred combat ring and cast cadence.
    const dx = target.x - lich.x; // Horizontal vector to target used for facing/movement.
    const dy = target.y - lich.y; // Z-plane vector to target used for facing/movement.
    const dist = Number.isFinite(distToTarget) ? distToTarget : Math.hypot(dx, dy); // Current distance in pixels for tactical thresholds.
    const aimAngle = Math.atan2(dy, dx); // Body facing returned to the shared hostile loop.
    updateCommand(lich, target, dist);

    lich._lichPrimaryCooldownS = Math.max(0, (lich._lichPrimaryCooldownS || 0) - dt);
    lich._lichSummonCooldownS = Math.max(0, (lich._lichSummonCooldownS || 0) - dt);
    if (lich._banditAction) {
      lich.facing = aimAngle; // Hold target facing while the existing Light Weapon Windup→Strike animation completes.
      return { aimAngle, moving: false, handled: true };
    }

    if (lich._lichSummonCooldownS <= 0 && (!lich.lichRaiseDead || lich.lichRaiseDead.canRaise?.(lich))) { // Raise-dead liches only cast when someone lies dead.
      if (beginLichCast(lich, target, 'summon')) {
        lich._lichSummonCooldownS = 12 + random() * 5;
        return { aimAngle, moving: false, handled: true };
      }
    }

    const tile = deps.TILE || 64; // Shared range unit used for desired casting ring.
    const minRange = def.preferredMinTiles * tile; // Inner edge; lich backs away if player enters it.
    const maxRange = def.preferredMaxTiles * tile; // Outer edge; lich advances if player exceeds it.
    let moving = false; // Returned to shared hostile locomotion/animation state.
    if (dist < minRange) {
      const away = aimAngle + Math.PI; // Retreat vector keeps ranged lich from face-tanking.
      moving = !!deps.moveCreatureToward?.(lich, lich.x + Math.cos(away) * tile * 1.5, lich.y + Math.sin(away) * tile * 1.5, lich.def.chaseSpeed, dt);
    } else if (dist > maxRange) {
      moving = !!deps.moveCreatureToward?.(lich, target.x, target.y, lich.def.chaseSpeed, dt);
    } else if (lich._lichPrimaryCooldownS > 0.4) {
      const side = (lich.id?.length || 1) % 2 ? 1 : -1; // Stable per-entity strafe side avoids random frame-to-frame shivering.
      const strafeAngle = aimAngle + side * Math.PI / 2; // Gentle casting-ring movement while waiting on cooldown.
      moving = !!deps.moveCreatureToward?.(lich, lich.x + Math.cos(strafeAngle) * tile * 0.55, lich.y + Math.sin(strafeAngle) * tile * 0.55, lich.def.moveSpeed * 0.55, dt);
    }

    if (lich._lichPrimaryCooldownS <= 0 && dist <= tile * 9.5) {
      lich.facing = aimAngle;
      if (beginLichCast(lich, target, 'primary')) lich._lichPrimaryCooldownS = def.castCooldownS;
    }
    return { aimAngle, moving, handled: true };
  }

  function updateLichHoverPresentation(lich, dt) {
    if (!lich || (lich.enemyClass !== CLASS_ID && !lich.isHarlyaoLich)) return;
    const baseGroundLift = Number(lich._lichBaseGroundLift) || Number(lich.halfHeight) || Number(lich.avatarRef?.modelHeight) * 0.5 || 0.45; // Grounded baseline remains the collision/simulation origin.
    const legs = lich.avatarRef?.legs; // Existing two-bone procedural leg handle attached by BanditCombat's humanoid portrait builder.
    const hovering = isArena() && isLiveActor(lich) && !lich.prone; // Knockdown explicitly brings a lich back to ground instead of ragdolling in midair.
    legs?.setHoverMode?.(hovering);
    if (!hovering) {
      lich.groundLift = baseGroundLift;
      lich._lichHoverOffsetWorld = 0;
      return;
    }
    const modelHeight = Math.max(0.1, Number(lich.avatarRef?.modelHeight) || Number(lich.avatarRef?.group?.userData?.portraitModelHeight) || baseGroundLift * 2); // Rendered portrait height drives both lift and bob scale.
    lich._lichHoverClockS = (Number(lich._lichHoverClockS) || 0) + Math.max(0, Number(dt) || 0);
    const hoverHeight = Math.max(HOVER_HEIGHT_MIN_WORLD, modelHeight * HOVER_HEIGHT_MODEL_FRACTION); // Main static separation above ordinary ground-following minions.
    const bobAmplitude = modelHeight * HOVER_BOB_MODEL_FRACTION; // Gentle secondary float, deliberately much smaller than the main lift.
    const bob = Math.sin((lich._lichHoverClockS / HOVER_BOB_PERIOD_S) * Math.PI * 2) * bobAmplitude;
    lich._lichHoverOffsetWorld = hoverHeight + bob;
    lich.groundLift = baseGroundLift + lich._lichHoverOffsetWorld; // Existing creature renderer applies this presentation lift without changing X/Z AI/collision.
  }

  function updateRuntime(dt) {
    if (!(dt > 0)) return;
    if (!isArena()) {
      for (const projectile of [...projectiles]) disposeProjectile(projectile); // Custom spell objects never survive a Testing Arena transition.
      for (const erupt of [...eruptions]) disposeHronalEruption(erupt); // Overlapping Erupting Earth warnings/lava are arena-local scene state.
      for (const puddle of [...puddles]) disposePetroleumPuddle(puddle); // Petroleum hazards are arena-local scene state.
      if (deps?.player) {
        clearGooSlowNow(deps.player);
        clearEntrancedNow(deps.player);
      }
      for (const actor of deps?.hostileObjects || []) {
        if (actor?.enemyClass === CLASS_ID || actor?.isHarlyaoLich) updateLichHoverPresentation(actor, dt); // Leaving the arena restores the grounded baseline and disables dangling hover.
        clearGooSlowNow(actor);
        clearEntrancedNow(actor);
      }
      updateCommandBanner();
      updateEntrancerMarker(dt);
      return;
    }
    updateProjectiles(dt);
    updateEruptions(dt);
    updatePuddles(dt);
    if (deps?.player) {
      clearExpiredSlow(deps.player);
      updateEntrancedTarget(deps.player, dt);
    }
    for (const actor of deps?.hostileObjects || []) {
      if (actor?.enemyClass === CLASS_ID || actor?.isHarlyaoLich) updateLichHoverPresentation(actor, dt); // Hover remains updated even if prone logic bypasses the lich AI for this frame.
      clearExpiredSlow(actor);
      updateEntrancedTarget(actor, dt);
    }
    updateCommandBanner();
    updateEntrancerMarker(dt);
  }

  function installWrappers() {
    if (wrappersInstalled) return true;
    const BanditCombat = window.BanditCombat; // Shared humanoid constructor/AI API this class extends.
    const RangedWeapons = window.RangedWeapons; // Existing gameplay update cadence used for custom projectile/puddle simulation.
    if (!BanditCombat?.init || !BanditCombat?.updateCombatAI || !RangedWeapons?.update) return false;

    const baseInit = BanditCombat.init.bind(BanditCombat); // Preserves all original Bandit dependency setup before storing the same deps here.
    BanditCombat.init = function harlyaoLichBanditInit(injectedDeps) {
      deps = injectedDeps;
      return baseInit(injectedDeps);
    };

    const baseAI = BanditCombat.updateCombatAI.bind(BanditCombat); // Ordinary Bandit/Minion AI remains byte-for-byte routed through its original function.
    BanditCombat.updateCombatAI = function harlyaoLichCombatAI(entity, dt, target, dist) {
      if (entity?.enemyClass === CLASS_ID || entity?.isHarlyaoLich) return updateLichAI(entity, dt, target, dist);
      return baseAI(entity, dt, target, dist);
    };

    if (typeof BanditCombat.updateToolMesh === 'function') {
      const baseToolMeshUpdate = BanditCombat.updateToolMesh.bind(BanditCombat); // Preserves EnemyWeaponStances/player-parity Light Weapon pose preparation before hand placement.
      BanditCombat.updateToolMesh = function harlyaoLichToolMesh(entity, ...args) {
        const result = baseToolMeshUpdate(entity, ...args);
        if (entity?.enemyClass === CLASS_ID || entity?.isHarlyaoLich) syncLichCastHand(entity); // Right hand follows the invisible weapon object through the existing attack animation.
        return result;
      };
    }

    const baseRangedUpdate = RangedWeapons.update.bind(RangedWeapons); // Custom spell simulation runs once per normal gameplay frame, never from a second animation loop.
    RangedWeapons.update = function harlyaoLichRangedUpdate(dt) {
      const result = baseRangedUpdate(dt);
      updateRuntime(Number(dt) || 0);
      return result;
    };

    if (window.Combat?.getMovementSpeedMul && !window.Combat.getMovementSpeedMul.__harlyaoLichWrapped) {
      const baseMoveMul = window.Combat.getMovementSpeedMul.bind(window.Combat); // Composes Kanthic player slow with Blink Dodge/clothing/alchemy wrappers instead of replacing them.
      const wrappedMoveMul = function harlyaoLichPlayerMoveMul() {
        return baseMoveMul() * slowMultiplier(deps?.player);
      };
      wrappedMoveMul.__harlyaoLichWrapped = true;
      wrappedMoveMul.__harlyaoLichOriginal = baseMoveMul;
      window.Combat.getMovementSpeedMul = wrappedMoveMul;
    }

    wrappersInstalled = true;
    return true;
  }

  function debugSnapshot() {
    const liches = [...(deps?.hostileObjects || [])].filter(actor => actor?.enemyClass === CLASS_ID && actor.health > 0); // Live arena lich list used for mobile diagnostics.
    const playerEntranced = deps?.player ? (window.ResourceSystem?.getAffliction?.(deps.player, 'entrancedHealth') || 0) : 0; // Current player buildup for one-line verification.
    const playerCommandState = deps?.player?._entrancedCommandState || null; // Used to expose countdown/action bookkeeping without desktop devtools.
    const grace = entrancedGraceDisplay(playerCommandState);
    return {
      classId: CLASS_ID, arenaOnly: ARENA_ID, wrappersInstalled,
      activeLiches: liches.map(lich => ({ id: lich.id, type: lich.lichType, dye: lich.lichDyeId, resolvedDyes: lich.avatarRef?.resolvedRosterDyes || null, command: lich._lichCommand, casting: lich._lichCastingAbility || null, hovering: !!lich.avatarRef?.legs?.isHoverMode?.(), hoverOffset: Number(lich._lichHoverOffsetWorld) || 0, handRig: !!handRigForLich(lich), emptyLightWeapon: !!lich._lichCastWeaponSocket, primaryCd: lich._lichPrimaryCooldownS, summonCd: lich._lichSummonCooldownS, summons: [...(lich._lichSummons || [])].filter(isLiveActor).length })),
      projectiles: projectiles.size,
      tothalFogOrbs: [...projectiles].filter(projectile => projectile.type === 'tothal').length,
      eruptions: eruptions.size,
      hronalStoneInstances: [...eruptions].reduce((sum, erupt) => sum + (erupt.particles?.length || 0), 0), // On-demand diagnostic proves the bounded instanced stone load across overlapping warnings.
      puddles: puddles.size, totalPuddles, totalSummons,
      playerEntranced, playerCommand: playerCommandState?.source?._lichCommand || null,
      playerEntrancerId: playerCommandState?.source?.id || null,
      playerCommandGrace: grace ? { phase: grace.phase, countdown: grace.countdown, remainingMs: Math.max(0, playerCommandState.graceUntil - performance.now()) } : null,
      playerEntrancedManeuver: playerCommandState?.activeManeuver?.kind || playerCommandState?.suppressManeuverUntilEnd || null,
      liveEntrancedApplicators: liveEntrancedApplicators().length,
      entrancerMarker: entrancerMarkerSource ? { sourceId: entrancerMarkerSource.id || null, ringVisible: !!entrancerMarker?.visible, auraVisible: !!entrancerAuraVisual, auraCommand: entrancerAuraCommand, behindCamera: entrancerBehindCamera } : null,
      playerGooSlow: deps?.player?._kanthicGooSlow ? { stacks: deps.player._kanthicGooSlow.stacks, remainingMs: Math.max(0, deps.player._kanthicGooSlow.until - performance.now()) } : null,
      lastEvent,
    };
  }

  window.HarlyaoLichCombat = {
    CLASS_ID, ARENA_ID, TYPE_ORDER, TYPE_DEFS,
    allowArea: areaId => { if (areaId) allowedAreas.add(String(areaId)); }, // Opt another area in (e.g. the Random Test Ruin's boss sanctum).
    disallowArea: areaId => { if (areaId && areaId !== ARENA_ID) allowedAreas.delete(String(areaId)); },
    installWrappers, makeEntity, rosterFor, rollDye,
    updateLichAI, applyEntranced, addGooSlow, clearExpiredSlow, makeGasolinePuddle, makeEruptingEarth,
    debugSnapshot,
    formatDebug() {
      const d = debugSnapshot(); // Compact status line intended for Pixel Probe/mobile-copyable diagnostics.
      const hover = d.activeLiches.filter(lich => lich.hovering).map(lich => `${lich.id || lich.type}:${lich.hoverOffset.toFixed?.(2) || lich.hoverOffset}`).join(',') || '-'; // Compact mobile-readable proof that active liches are using airborne presentation.
      const hands = d.activeLiches.map(lich => `${lich.id || lich.type}:${lich.handRig ? 'hands' : 'NO-HANDS'}`).join(',') || '-'; // Exposes the exact rig-attachment failure class without requiring desktop devtools.
      const dyes = d.activeLiches.map(lich => `${lich.id || lich.type}:${Object.entries(lich.resolvedDyes || {}).map(([slot, rec]) => `${slot}=${rec?.dyeId || '?'}`).join('+') || 'NO-DYES'}`).join(',') || '-'; // Confirms world-raster dye reconciliation independently from loot metadata.
      return `Harlyao Liches: live=${d.activeLiches.length} hover=${hover} hands=${hands} dyes=${dyes} projectiles=${d.projectiles}/fog=${d.tothalFogOrbs} earth=${d.eruptions} puddles=${d.puddles} summons=${d.totalSummons} entranced=${d.playerEntranced.toFixed?.(1) || d.playerEntranced} command=${d.playerCommand || '-'} grace=${d.playerCommandGrace ? (d.playerCommandGrace.countdown || d.playerCommandGrace.phase) : '-'} move=${d.playerEntrancedManeuver || '-'} appliers=${d.liveEntrancedApplicators} controller=${d.playerEntrancerId || '-'} marker=${d.entrancerMarker?.ringVisible ? 'ring' : '-'}+${d.entrancerMarker?.auraVisible ? `aura:${d.entrancerMarker.auraCommand || '?'}` : '-'} edge=${d.entrancerMarker?.behindCamera ? 'behind' : '-'} goo=${d.playerGooSlow?.stacks || 0} last=${d.lastEvent}`;
    },
  };
  window.__lichDebug = { snapshot: debugSnapshot }; // Console-independent API also consumed by the existing mobile debug surfaces/tests.

  installWrappers();
})();
