// Harlyao Lich testing-arena enemy class.
//
// Three elemental lich traditions reuse the Harlyao Skeleton portrait/wardrobe
// and shared humanoid hostile shell, but own their spell AI/projectiles here.
// Nothing in this file spawns outside map_dev_arena.
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
  const TYPE_ORDER = Object.freeze(['tothal', 'hronal', 'kanthic']); // Stable order used by the dev-spawner buttons and diagnostics.
  const HUE_VARIANTS = Object.freeze(['pure', 'muted', 'dusty', 'dark_muted']); // Existing authored dye variants combined with each tradition's hue families.

  const TYPE_DEFS = Object.freeze({
    tothal: Object.freeze({
      id: 'tothal', label: 'Tothal Lich',
      hues: Object.freeze(['green_blue', 'blue', 'blue_indigo']),
      castCooldownS: 2.45, preferredMinTiles: 4.25, preferredMaxTiles: 7,
      projectile: Object.freeze({
        speedPxS: 670, gravityWorldS2: 0, maxAgeS: 2.2, radiusWorld: 0.16,
        damage: 5, knockbackPxS: 930, footingDamageMultiplier: 5.2,
        frostbittenFooting: 42,
      }),
    }),
    hronal: Object.freeze({
      id: 'hronal', label: 'Hronal Lich',
      hues: Object.freeze(['red', 'red_orange', 'orange', 'yellow_orange', 'yellow']),
      castCooldownS: 2.65, preferredMinTiles: 3.6, preferredMaxTiles: 6.5,
      projectile: Object.freeze({
        speedPxS: 610, gravityWorldS2: 5.5, maxAgeS: 2.7, radiusWorld: 0.15,
        damage: 9, knockbackPxS: 250, footingDamageMultiplier: 0.7,
        burningHealth: 17, shatteredStamina: 14,
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
  const projectiles = new Set(); // Live custom spell projectiles updated from the normal RangedWeapons gameplay tick.
  const puddles = new Set(); // Live Kanthic gasoline hazards updated/disposed alongside custom projectiles.
  let lastEvent = 'idle'; // Mobile-copyable diagnostic summary exposed through __lichDebug.
  let totalSummons = 0; // Session counter used only by diagnostics.
  let totalPuddles = 0; // Session counter used only by diagnostics.
  let entrancerMarker = null; // Single reusable world-space ring pair that follows whichever Kanthic lich most recently applied the player's Entranced Health.
  let entrancerMarkerSource = null; // Current referential lich owning the visible marker; changes immediately when a newer applicant takes control.
  let entrancerAuraAnchor = null; // Avatar-local anchor carrying the large Entranced fire emitter above the ground ring.
  let entrancerAuraVisual = null; // AuthoredFurniture emitter visual updated while the latest Kanthic applicant controls the player.
  let wrappersInstalled = false; // Prevents duplicate API wrapping if scripts/tools reinstall this feature.

  function random() {
    return window.GameRandom?.random?.() ?? Math.random();
  }

  function typeDef(type) {
    return TYPE_DEFS[String(type || '').toLowerCase()] || TYPE_DEFS.tothal;
  }

  function isArena() {
    return deps?.getCurrentArea?.() === ARENA_ID;
  }

  function isLiveActor(actor) {
    return !!actor && Number(actor.health) > 0 && (!actor.areaId || actor.areaId === ARENA_ID);
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
    const entity = await window.BanditCombat.makeEntity({
      ...cfg,
      speciesWeights: { 'harlyao-skeleton': 1 },
      rangedWeaponChanceByRank: { grunt: 0, lieutenant: 0, captain: 0 },
    }, 'lieutenant', tier, x, y, {
      zoneId: ARENA_ID,
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
    return deps.tileSurfaceYInArea?.(grid[row]?.[col], actor.areaId || ARENA_ID) || 0;
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
      const core = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.13, 1),
        new THREE.MeshBasicMaterial({ color: 0xaeeeff, transparent: true, opacity: 0.82, depthWrite: false })
      ); // Bright icy core used as the Blizzard Blast's readable center.
      group.add(core);
      for (let i = 0; i < 6; i++) {
        const shard = new THREE.Mesh(
          new THREE.ConeGeometry(0.025, 0.18, 4),
          new THREE.MeshBasicMaterial({ color: i % 2 ? 0xffffff : 0x72cfff, transparent: true, opacity: 0.72, depthWrite: false })
        ); // Radial ice shard gives the otherwise spherical spell a blizzard/sleet silhouette.
        const a = i / 6 * Math.PI * 2; // Even radial placement angle used only for this shard.
        shard.position.set(Math.cos(a) * 0.11, Math.sin(a * 2) * 0.05, Math.sin(a) * 0.11);
        shard.rotation.z = a;
        group.add(shard);
      }
    } else if (type === 'hronal') {
      const rock = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.145, 0),
        new THREE.MeshStandardMaterial({ color: 0x3d2419, roughness: 0.92, emissive: 0x4b1205, emissiveIntensity: 1.2 })
      ); // Dark crust of the burning rock.
      const ember = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.105, 1),
        new THREE.MeshBasicMaterial({ color: 0xff6a1a, transparent: true, opacity: 0.72, depthWrite: false })
      ); // Inner orange glow visible through/around the irregular rock.
      rock.scale.set(1.15, 0.9, 1);
      group.add(ember, rock);
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

  function firePrimary(lich, target) {
    if (!isArena() || !isLiveActor(lich) || !isLiveActor(target)) return false;
    const def = typeDef(lich.lichType); // Lich tradition selects projectile physics/payload/visual.
    const velocity = ballisticVelocity(lich, target, def.projectile); // One ballistic solution captured at cast time; no homing afterward.
    const mesh = makeSpellVisual(def.id); // Per-type procedural spell visual avoids adding un-authored sprite assets.
    mesh.position.copy(velocity.start);
    lich.scene?.add?.(mesh);
    const projectile = {
      type: def.id, owner: lich, mesh, areaId: ARENA_ID,
      x: velocity.start.x * deps.TILE, y: velocity.start.z * deps.TILE, worldY: velocity.start.y,
      prevX: velocity.start.x * deps.TILE, prevY: velocity.start.z * deps.TILE, prevWorldY: velocity.start.y,
      vx: velocity.vx, vy: velocity.vz, vyWorld: velocity.vyWorld,
      ageS: 0, payload: def.projectile,
    }; // Custom projectile record updated from RangedWeapons.update's normal gameplay cadence.
    projectiles.add(projectile);
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
    const hitX = projectile.prevX + (projectile.x - projectile.prevX) * t; // Pixel X impact origin passed to canonical knockback/damage.
    const hitY = projectile.prevY + (projectile.y - projectile.prevY) * t; // Pixel Z-plane impact origin passed to canonical knockback/damage.
    const options = { tag: projectile.type === 'hronal' ? 'fire' : 'blunt', ranged: true, footingDamageMultiplier: p.footingDamageMultiplier || 0, afflictionBonuses: {} }; // Canonical damage path still owns knockback/stagger/prone transitions.
    if (actor === deps.player) deps.damagePlayer?.(p.damage, hitX, hitY, p.knockbackPxS || 0, options);
    else deps.damageCreature?.(actor, p.damage, hitX, hitY, p.knockbackPxS || 0, { ...options, friendlyFire: true });
    const RS = window.ResourceSystem; // Central affliction authority for fixed lich payload buildup.
    if (projectile.type === 'tothal') {
      RS?.addAffliction?.(actor, 'frostbittenFooting', p.frostbittenFooting);
    } else if (projectile.type === 'hronal') {
      RS?.addAffliction?.(actor, 'burningHealth', p.burningHealth);
      RS?.addAffliction?.(actor, 'shatteredStamina', p.shatteredStamina);
    } else {
      addGooSlow(actor);
      applyEntranced(actor, projectile.owner, p.entrancedHealth);
    }
    lastEvent = `hit:${projectile.type}:${actor.id || actor.name || 'player'}`;
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
    disposeObject3D(projectile.mesh);
  }

  function makeGasolinePuddle(owner, xPx, yPx) {
    if (!isArena() || !owner?.scene) return null;
    const group = new THREE.Group(); // Root sits at the exact miss point while overlapping ellipses create an irregular petroleum footprint.
    group.name = 'kanthic_gasoline_puddle';
    const dark = new THREE.MeshBasicMaterial({ color: 0x20170d, transparent: true, opacity: 0.58, depthWrite: false, side: THREE.DoubleSide }); // Gasoline body read as wet translucent dark amber on varied arena ground.
    const amber = new THREE.MeshBasicMaterial({ color: 0x76531d, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }); // Warm reflected oil layer.
    const violet = new THREE.MeshBasicMaterial({ color: 0x745cff, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }); // Iridescent thin-film highlight.
    const lobes = [
      [0, 0, 0.72, 0.48, dark], [0.28, -0.11, 0.45, 0.31, dark], [-0.31, 0.16, 0.36, 0.28, dark],
      [0.08, 0.02, 0.63, 0.35, amber], [-0.16, -0.04, 0.46, 0.22, violet],
    ]; // Local offsets/scales produce a pooled-not-perfect-circle silhouette.
    for (const [ox, oz, sx, sz, material] of lobes) {
      const mesh = new THREE.Mesh(new THREE.CircleGeometry(1, 28), material); // Flat lobe shares the puddle lifetime/fade.
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(ox, 0, oz);
      mesh.scale.set(sx, sz, 1);
      mesh.renderOrder = 2;
      group.add(mesh);
    }
    const groundY = groundYAt(owner, xPx, yPx); // Arena terrain height ensures puddles sit on ramps/slabs rather than world zero.
    group.position.set(xPx / deps.TILE, groundY + 0.018, yPx / deps.TILE);
    owner.scene.add(group);
    const puddle = { owner, x: xPx, y: yPx, group, ageS: 0, tickS: 0, radiusPx: PUDDLE_RADIUS_TILES * deps.TILE }; // Gameplay hazard record checked independently of the decorative lobes.
    puddles.add(puddle);
    totalPuddles += 1;
    lastEvent = `puddle:${owner.id || owner.name}`;
    return puddle;
  }

  function applyEntranced(target, source, amount) {
    if (!target || !source || !(amount > 0)) return 0;
    const added = window.ResourceSystem?.addAffliction?.(target, 'entrancedHealth', amount) || 0; // Canonical ring buildup amount.
    const distance = Math.hypot((target.x || 0) - (source.x || 0), (target.y || 0) - (source.y || 0)); // Baseline used to classify next-frame movement toward/away.
    target._entrancedCommandState = {
      source, sourceId: source.id || null,
      lastX: Number(target.x) || 0, lastY: Number(target.y) || 0, lastDistance: distance,
      command: source._lichCommand || 'approach',
    }; // Latest applicant deliberately replaces any older referential lich.
    return added;
  }

  function addGooSlow(target) {
    const now = performance.now(); // Duration clock shared by player and hostile slow handling.
    const state = target._kanthicGooSlow || { stacks: 0, until: 0, baseMoveSpeed: null, baseChaseSpeed: null }; // Runtime-only stacking state; base enemy speeds are captured once.
    state.stacks = Math.min(GOO_SLOW_MAX_STACKS, state.stacks + 1);
    state.until = now + GOO_SLOW_DURATION_MS;
    if (target !== deps?.player && target.def) {
      if (!Number.isFinite(state.baseMoveSpeed)) state.baseMoveSpeed = Number(target.def.moveSpeed) || 0;
      if (!Number.isFinite(state.baseChaseSpeed)) state.baseChaseSpeed = Number(target.def.chaseSpeed) || state.baseMoveSpeed;
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
    const state = target?._kanthicGooSlow; // Captured authored enemy speeds restored exactly when the duration expires.
    if (!state || target === deps?.player || !target.def || !Number.isFinite(state.baseMoveSpeed)) return;
    const mul = slowMultiplier(target); // Current stack-derived movement multiplier.
    target.def.moveSpeed = state.baseMoveSpeed * mul;
    target.def.chaseSpeed = state.baseChaseSpeed * mul;
  }

  function clearExpiredSlow(target) {
    const state = target?._kanthicGooSlow; // Runtime record removed after restoring authored movement values.
    if (!state || state.until > performance.now()) {
      if (state && target !== deps?.player) applyEnemySlow(target);
      return;
    }
    if (target !== deps?.player && target.def && Number.isFinite(state.baseMoveSpeed)) {
      target.def.moveSpeed = state.baseMoveSpeed;
      target.def.chaseSpeed = state.baseChaseSpeed;
    }
    delete target._kanthicGooSlow;
  }

  function clearGooSlowNow(target) {
    const state = target?._kanthicGooSlow; // Immediate arena-exit cleanup restores enemy authored speeds instead of waiting for the duration clock.
    if (!state) return;
    if (target !== deps?.player && target.def && Number.isFinite(state.baseMoveSpeed)) {
      target.def.moveSpeed = state.baseMoveSpeed;
      target.def.chaseSpeed = state.baseChaseSpeed;
    }
    delete target._kanthicGooSlow;
  }

  function clearEntrancedNow(target) {
    if (!target) return;
    const amount = window.ResourceSystem?.getAffliction?.(target, 'entrancedHealth') || 0; // Current arena-only buildup cleared when its referential lich can no longer be in the active area.
    if (amount > 0) window.ResourceSystem?.removeAffliction?.(target, 'entrancedHealth', amount);
    delete target._entrancedCommandState;
  }

  function updateEntrancedTarget(target, dt) {
    const RS = window.ResourceSystem; // Central source for current buildup, removal, and damage conversion.
    const amount = RS?.getAffliction?.(target, 'entrancedHealth') || 0;
    const state = target?._entrancedCommandState; // Latest-applicant referential state installed by direct hit/puddle.
    if (!(amount > 0)) {
      if (state) delete target._entrancedCommandState;
      return;
    }
    if (!state?.source || !isLiveActor(state.source)) {
      RS?.removeAffliction?.(target, 'entrancedHealth', ENTRANCED_FAST_RECOVERY_PER_S * dt);
      return;
    }
    const source = state.source; // Live lich all movement is measured relative to this frame.
    const command = source._lichCommand || state.command || 'approach'; // AI can swap command after application; targets obey the current one immediately.
    const x = Number(target.x) || 0; // Current target X used for movement and distance deltas.
    const y = Number(target.y) || 0; // Current target Z-plane coordinate used for movement and distance deltas.
    const movedPx = Math.hypot(x - state.lastX, y - state.lastY); // Distinguishes standing still from actual commanded/sideways/opposing movement.
    const distance = Math.hypot(x - source.x, y - source.y); // Current referential distance to the latest lich.
    const distanceDelta = distance - state.lastDistance; // Positive means moving away, negative means moving closer.
    const movementEpsilon = Math.max(0.45, (deps.TILE || 64) * 0.002); // Filters animation/physics jitter so standing still is never punished.
    const moved = movedPx > movementEpsilon; // Used to select fast stillness recovery versus directional behavior.
    const wrong = moved && ((command === 'approach' && distanceDelta > movementEpsilon) || (command === 'flee' && distanceDelta < -movementEpsilon)); // Only movement directly against the command consumes buildup as damage.
    const obeying = moved && ((command === 'approach' && distanceDelta < -movementEpsilon) || (command === 'flee' && distanceDelta > movementEpsilon)); // Command-consistent movement receives fast recovery.
    if (wrong) {
      const requested = movedPx / (deps.TILE || 64) * ENTRANCED_WRONG_MOVE_DAMAGE_PER_TILE; // Distance-scaled punishment prevents frame-rate dependence.
      const consumed = Math.min(amount, requested); // Never converts more Entranced Health than currently exists.
      RS?.removeAffliction?.(target, 'entrancedHealth', consumed);
      RS?.applyHealthAfflictionDamage?.(target, consumed);
      lastEvent = `entranced-punish:${command}:${target.id || target.name || 'player'}`;
    } else {
      const rate = (!moved || obeying) ? ENTRANCED_FAST_RECOVERY_PER_S : ENTRANCED_BASE_RECOVERY_PER_S; // Standing still and obeying share the accelerated action-avoidance recovery rule.
      RS?.removeAffliction?.(target, 'entrancedHealth', rate * dt);
    }
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
      el.classList.remove('visible', 'approach', 'flee');
      return;
    }
    const command = state.source._lichCommand || state.command || 'approach'; // Live command may swap tactically while the same affliction remains.
    const action = el.querySelector('.entranced-command-action'); // Dedicated child lets condition label and command use the same two-level typography as other game HUD elements.
    if (action) action.textContent = command === 'flee' ? `FLEE FROM ${state.source.name || 'THE LICH'}` : `APPROACH ${state.source.name || 'THE LICH'}`;
    el.classList.toggle('approach', command === 'approach');
    el.classList.toggle('flee', command === 'flee');
    el.classList.add('visible');
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
    const color = entrancedMarkerColor(); // Exact Entranced affliction hue shared with health ring, lunge-color marker, and this aura.
    const bright = new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.34); // Same hue family with a brighter flame tip for legibility against dark clothing.
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
      colorA: colorCssHex(bright),
      colorB: colorCssHex(color),
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
    if (entrancerAuraVisual) {
      const phase = (performance.now() % ENTRANCER_RING_PULSE_MS) / ENTRANCER_RING_PULSE_MS; // Shared one-second phase gives the fire a subtle synchronized surge with the ground pulse.
      const surge = phase < ENTRANCER_RING_BURST_FRACTION ? 1.32 : 1;
      entrancerAuraVisual.update?.(Math.max(0, Number(dt) || 0), true, { rate: 92 * surge, size: 0.24 * (0.94 + 0.06 * surge) });
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
        puddles.delete(puddle);
        disposeObject3D(puddle.group);
        continue;
      }
      const fade = puddle.ageS > PUDDLE_LIFETIME_S - 2 ? Math.max(0, (PUDDLE_LIFETIME_S - puddle.ageS) / 2) : 1; // Last two seconds visibly evaporate instead of popping.
      puddle.group.traverse(child => { if (child.isMesh && child.material) child.material.opacity = (child.userData.baseOpacity ||= child.material.opacity) * fade; });
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
      projectile.x += projectile.vx * dt;
      projectile.y += projectile.vy * dt;
      projectile.vyWorld -= projectile.payload.gravityWorldS2 * dt;
      projectile.worldY += projectile.vyWorld * dt;
      projectile.mesh.position.set(projectile.x / deps.TILE, projectile.worldY, projectile.y / deps.TILE);
      projectile.mesh.rotation.y += dt * (projectile.type === 'kanthic' ? 7 : 10);
      if (projectile.type === 'kanthic') {
        const pulse = 1 + Math.sin(projectile.ageS * 18) * 0.08; // Small in-flight squash/pulse sells viscous wobble without deforming collision.
        projectile.mesh.scale.set(pulse, 1 / pulse, pulse);
      }

      const start = new THREE.Vector3(projectile.prevX / deps.TILE, projectile.prevWorldY, projectile.prevY / deps.TILE); // Previous 3D point for swept collision.
      const end = new THREE.Vector3(projectile.x / deps.TILE, projectile.worldY, projectile.y / deps.TILE); // Current 3D point for swept collision.
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
        x, y, zoneId: ARENA_ID, weaponMetalKey: 'nativeCopper',
        extra: { homeX: x, homeY: y, state: 'chase', summonedByLichId: lich.id },
      });
      if (!minion) return;
      if (!isArena() || !isLiveActor(lich)) {
        minion.avatarRef?.dispose?.();
        minion.groundShadow?.parent?.remove?.(minion.groundShadow);
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
    if (desired !== lich._lichCommand && performance.now() - (lich._lichCommandChangedAt || 0) > 650) {
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
      if (ability === 'summon') summonMinion(lich);
      else firePrimary(lich, target);
    };
    const begin = window.Combat?.beginStagedAction;
    if (typeof begin !== 'function') {
      onStrike(); // Defensive fallback for isolated tools/tests; gameplay always owns beginStagedAction.
      finishLichCast(lich);
      return true;
    }
    lich._banditAction = begin({
      windupS: Number(step.windupS) || 0.16,
      strikeS: Number(step.strikeS) || 0.10,
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

    if (lich._lichSummonCooldownS <= 0) {
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
      for (const puddle of [...puddles]) { puddles.delete(puddle); disposeObject3D(puddle.group); } // Gasoline hazards are arena-local scene state.
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
    return {
      classId: CLASS_ID, arenaOnly: ARENA_ID, wrappersInstalled,
      activeLiches: liches.map(lich => ({ id: lich.id, type: lich.lichType, dye: lich.lichDyeId, resolvedDyes: lich.avatarRef?.resolvedRosterDyes || null, command: lich._lichCommand, casting: lich._lichCastingAbility || null, hovering: !!lich.avatarRef?.legs?.isHoverMode?.(), hoverOffset: Number(lich._lichHoverOffsetWorld) || 0, handRig: !!handRigForLich(lich), emptyLightWeapon: !!lich._lichCastWeaponSocket, primaryCd: lich._lichPrimaryCooldownS, summonCd: lich._lichSummonCooldownS, summons: [...(lich._lichSummons || [])].filter(isLiveActor).length })),
      projectiles: projectiles.size, puddles: puddles.size, totalPuddles, totalSummons,
      playerEntranced, playerCommand: deps?.player?._entrancedCommandState?.source?._lichCommand || null,
      playerEntrancerId: deps?.player?._entrancedCommandState?.source?.id || null,
      entrancerMarker: entrancerMarkerSource ? { sourceId: entrancerMarkerSource.id || null, ringVisible: !!entrancerMarker?.visible, auraVisible: !!entrancerAuraVisual } : null,
      playerGooSlow: deps?.player?._kanthicGooSlow ? { stacks: deps.player._kanthicGooSlow.stacks, remainingMs: Math.max(0, deps.player._kanthicGooSlow.until - performance.now()) } : null,
      lastEvent,
    };
  }

  window.HarlyaoLichCombat = {
    CLASS_ID, ARENA_ID, TYPE_ORDER, TYPE_DEFS,
    installWrappers, makeEntity, rosterFor, rollDye,
    updateLichAI, applyEntranced, addGooSlow, makeGasolinePuddle,
    debugSnapshot,
    formatDebug() {
      const d = debugSnapshot(); // Compact status line intended for Pixel Probe/mobile-copyable diagnostics.
      const hover = d.activeLiches.filter(lich => lich.hovering).map(lich => `${lich.id || lich.type}:${lich.hoverOffset.toFixed?.(2) || lich.hoverOffset}`).join(',') || '-'; // Compact mobile-readable proof that active liches are using airborne presentation.
      const hands = d.activeLiches.map(lich => `${lich.id || lich.type}:${lich.handRig ? 'hands' : 'NO-HANDS'}`).join(',') || '-'; // Exposes the exact rig-attachment failure class without requiring desktop devtools.
      const dyes = d.activeLiches.map(lich => `${lich.id || lich.type}:${Object.entries(lich.resolvedDyes || {}).map(([slot, rec]) => `${slot}=${rec?.dyeId || '?'}`).join('+') || 'NO-DYES'}`).join(',') || '-'; // Confirms world-raster dye reconciliation independently from loot metadata.
      return `Harlyao Liches: live=${d.activeLiches.length} hover=${hover} hands=${hands} dyes=${dyes} projectiles=${d.projectiles} puddles=${d.puddles} summons=${d.totalSummons} entranced=${d.playerEntranced.toFixed?.(1) || d.playerEntranced} command=${d.playerCommand || '-'} controller=${d.playerEntrancerId || '-'} marker=${d.entrancerMarker?.ringVisible ? 'ring' : '-'}+${d.entrancerMarker?.auraVisible ? 'aura' : '-'} goo=${d.playerGooSlow?.stacks || 0} last=${d.lastEvent}`;
    },
  };
  window.__lichDebug = { snapshot: debugSnapshot }; // Console-independent API also consumed by the existing mobile debug surfaces/tests.

  installWrappers();
})();
