// Deterministic aimed splash-flask projectile path. AlchemySystem owns recipe
// gameplay; this module owns aim state, target-ring presentation, travel,
// impact querying, and exactly-once inventory consumption at release.
(() => {
  'use strict';

  let deps = null; // Runtime/Three/inventory adapters injected by game.js.
  let aimState = null; // {itemKey,payload,definition,targetX,targetY,phase,releaseT}.
  const projectiles = []; // Active deterministic hand-to-ground flask flights.
  let targetRing = null; // Green ground ring shown only while aiming/releasing.
  let lastImpact = null; // Mobile-accessible impact diagnostic snapshot.
  let lastSfxCue = null; // Mobile-accessible proof that a decoupled sound cue fired.
  let lastNpcThrow = null; // Used by mobile diagnostics to inspect the most recent infinite-use enemy/NPC flask launch.
  const MAX_THROW_RADIUS_TILES = 14; // Shoulder-view interaction-ray range around the player.
  const INTERACTION_RAY_MAX_DISTANCE = 36; // World-unit terrain sampling limit used by shoulder aim.
  const INTERACTION_RAY_STEP = 0.22; // Fine enough to catch narrow raised terrain without per-frame mesh raycasts.
  const PROJECTILE_MIN_TRAVEL_S = 0.42; // Near throws remain responsive.
  const PROJECTILE_MAX_TRAVEL_S = 0.9; // Distant throws remain readable without feeling sluggish.
  const RELEASE_DELAY_S = 0.28; // Authored windup→strike release point.
  const LANDING_SHADOW_TERRAIN_STEPS = 8; // The shadow re-drapes over the terrain this many times per flight rather than every frame.
  const LANDING_SHADOW_MIN_OPACITY = 0.75; // The shared character-shadow opacity (~0.28) is too faint for a telegraph the player must read mid-fight.
  const LANDING_SHADOW_FADE_IN_S = 0.12; // Ground cue appears almost immediately at release, independent of flight length.
  const impactEffects = []; // Bounded, module-owned Three.js splash presentations.
  const projectileTrails = []; // Short luminous motes shed by active flask projectiles.
  const SFX_CUES = Object.freeze({ // Semantic placeholders; audio assets are intentionally configured outside this module.
    aimStart: 'flask_aim_start',
    release: 'flask_throw_release',
    impact: 'flask_impact',
  });

  function init(injectedDeps = {}) {
    deps = injectedDeps; // Used by every later render/gameplay operation.
  }

  function heldPayload() {
    const itemKey = deps?.getSelectedItemKey?.(); // Current ordinary held item.
    const payload = window.AlchemySystem?.POTION_ITEMS?.[itemKey] || window.AlchemySystem?.parseBrewedItemKey?.(itemKey); // Stored recipe/potency.
    const definition = payload && window.AlchemySystem?.RECIPE_DEFS?.[payload.recipeId]; // Explicit use-mode source.
    return itemKey && definition?.useMode === 'throw' && (deps?.inventory?.[itemKey] || 0) > 0 ? { itemKey, payload, definition } : null;
  }

  function clampTarget(worldX, worldY) {
    const player = deps?.getPlayer?.(); // Throw-radius origin.
    const tile = deps?.TILE || 64; // World-pixel to tile conversion.
    const dx = Number(worldX) - Number(player?.x || 0); // Requested X offset in world pixels.
    const dy = Number(worldY) - Number(player?.y || 0); // Requested Y offset in world pixels.
    const distance = Math.hypot(dx, dy); // Used to clamp without changing direction.
    const maxDistance = MAX_THROW_RADIUS_TILES * tile; // Authored maximum throw radius.
    const scale = distance > maxDistance ? maxDistance / distance : 1; // Clamp ratio.
    return { x: Number(player?.x || 0) + dx * scale, y: Number(player?.y || 0) + dy * scale };
  }

  function emitSfx(cue, context = {}) {
    const cueId = SFX_CUES[cue]; // Stable semantic ID later mapped to a real asset by game/audio config.
    if (!cueId) return false;
    const detail = { cue, cueId, ...context }; // Shared payload for the injected adapter and optional event listeners.
    lastSfxCue = { ...detail, at: performance.now() };
    deps?.emitSfxCue?.(detail);
    document.dispatchEvent(new CustomEvent('hobunji-flask-sfx', { detail }));
    return true;
  }

  function shoulderViewActive() {
    const injected = deps?.isShoulderView?.(); // Preferred explicit runtime adapter when one is provided.
    return injected == null ? window.__hobunjiFurnitureDebug?.camState?.mode === 'shoulderSurf' : !!injected; // Existing camera diagnostic keeps the module independent from game.js state.
  }

  function interactionRayGroundTarget() {
    if (!aimState || aimState.phase !== 'aim' || !shoulderViewActive()) return null;
    const ray = deps.getPlayerInteractionRay?.() || window.__hitboxDebug?.interactionRay; // Same centered ray used by shoulder-view world interaction and its debug overlay.
    if (!ray?.origin || !ray?.direction) return null;
    const origin = ray.origin; // Three.js world units.
    const direction = ray.direction; // Expected normalized Three.js direction.
    const horizontalLength = Math.hypot(Number(direction.x) || 0, Number(direction.z) || 0); // Used by the horizon fallback.
    if (horizontalLength < 0.0001) return null;
    let previous = null; // Previous above-ground sample used to refine the crossing.
    for (let distance = 0; distance <= INTERACTION_RAY_MAX_DISTANCE; distance += INTERACTION_RAY_STEP) {
      const x = Number(origin.x) + Number(direction.x) * distance; // Current ray sample in tile/world units.
      const z = Number(origin.z) + Number(direction.z) * distance; // Current ray sample in tile/world units.
      const rayY = Number(origin.y) + Number(direction.y) * distance; // Current ray height.
      const groundY = Number(deps.getGroundYAtWorld?.(x, z) ?? deps.getGroundY?.(x * (deps.TILE || 64), z * (deps.TILE || 64))); // Terrain adapter when available; current player surface is the safe flat-plane fallback.
      if (!Number.isFinite(groundY)) continue;
      if (rayY <= groundY + 0.035 && previous?.above) {
        const previousGap = Math.max(0, previous.rayY - previous.groundY); // Refines the coarse march at the surface crossing.
        const currentGap = Math.max(0, groundY - rayY); // Refines the coarse march at the surface crossing.
        const ratio = previousGap + currentGap > 0 ? previousGap / (previousGap + currentGap) : 1;
        return clampTarget((previous.x + (x - previous.x) * ratio) * (deps.TILE || 64), (previous.z + (z - previous.z) * ratio) * (deps.TILE || 64));
      }
      previous = { x, z, rayY, groundY, above: rayY > groundY + 0.035 };
    }
    // Looking at or above the horizon has no mathematical ground-plane hit.
    // Keep the crosshair useful by projecting its horizontal direction to the
    // maximum throw distance and snapping that endpoint to the live terrain.
    const player = deps.getPlayer?.();
    const tile = deps.TILE || 64;
    return clampTarget(Number(player?.x || 0) + Number(direction.x) / horizontalLength * MAX_THROW_RADIUS_TILES * tile, Number(player?.y || 0) + Number(direction.z) / horizontalLength * MAX_THROW_RADIUS_TILES * tile);
  }

  function syncShoulderRayTarget() {
    const target = interactionRayGroundTarget(); // Shoulder view owns aim continuously; top-down keeps cursor/stick input.
    if (!target) return false;
    aimState.targetX = target.x;
    aimState.targetY = target.y;
    return true;
  }

  function groundAt(x, z) {
    return Number(deps.getGroundYAtWorld?.(x, z) ?? deps.getGroundY?.(x * (deps.TILE || 64), z * (deps.TILE || 64))) || 0;
  }

  function splashRadius(definition, playerOwned = true) {
    const rank = playerOwned ? (window.PerkSystem?.rank('alchemy', 'empowerFlasks') || 0) : 0; // Shared preview/impact perk authority.
    return (definition.splashRadius || window.AlchemySystem.DEFAULT_SPLASH_RADIUS_TILES) * (1 + rank * 0.1);
  }

  function makeTargetRing() {
    if (targetRing || !deps?.THREE) return targetRing;
    const geometry = new deps.THREE.RingGeometry(0, 1, 48, 6); // Filled AoE plane with radial subdivisions for terrain projection.
    const material = new deps.THREE.MeshBasicMaterial({ color: 0x55ff82, transparent: true, opacity: 0.24, side: deps.THREE.DoubleSide, depthWrite: false }); // Aim-only presentation material.
    targetRing = new deps.THREE.Mesh(geometry, material);
    window.EnvironmentSurfaceMicroPlateau?.bindGroundProjection(targetRing);
    targetRing.rotation.x = -Math.PI / 2;
    targetRing.renderOrder = 40;
    return targetRing;
  }

  function syncTargetRing() {
    const ring = makeTargetRing(); // Lazily created aim presentation.
    if (!ring) return;
    const scene = deps.getActiveScene?.(); // Current zone/farm/building scene.
    if (ring.parent !== scene) { ring.parent?.remove?.(ring); scene?.add?.(ring); }
    ring.visible = !!aimState;
    if (!aimState) return;
    const tile = deps.TILE || 64; // World-pixel to Three-unit conversion.
    const groundY = groundAt(aimState.targetX / tile, aimState.targetY / tile); // Landing surface shared with the projectile.
    const radius = splashRadius(aimState.definition); // Preview includes the player's radius perk, just like impact.
    const changed = ring.userData?.targetX !== aimState.targetX || ring.userData?.targetY !== aimState.targetY || ring.userData?.radius !== radius || ring.userData?.groundY !== groundY; // Avoid resampling an unchanged aim plane every frame.
    ring.position.set(aimState.targetX / tile, groundY + 0.035, aimState.targetY / tile);
    ring.scale.setScalar(radius);
    if (changed) {
      const positions = ring.geometry.attributes.position; // Local XY plane rotates onto world XZ; local Z supplies terrain height.
      if (positions) {
        for (let index = 0; index < positions.count; index++) {
          positions.setZ(index, (groundAt(ring.position.x + positions.getX(index) * radius, ring.position.z - positions.getY(index) * radius) - groundY) / radius);
        }
        positions.needsUpdate = true;
        ring.geometry.computeBoundingSphere?.();
      }
      if (ring.userData) Object.assign(ring.userData, { targetX: aimState.targetX, targetY: aimState.targetY, radius, groundY });
    }
  }

  function beginAim() {
    const held = heldPayload(); // Flask selected through the ordinary item flow.
    if (!held || aimState) return false;
    const player = deps.getPlayer?.(); // Default target origin/direction.
    const direction = deps.getAimAngle?.() ?? (Number(player?.angle) || 0); // Existing targeting language.
    const distance = 3 * (deps.TILE || 64); // Readable initial aim distance.
    aimState = { ...held, area: deps.getCurrentArea?.(), targetX: player.x + Math.cos(direction) * distance, targetY: player.y + Math.sin(direction) * distance, phase: 'aim', releaseT: 0 };
    syncShoulderRayTarget();
    deps.startThrowWindup?.(held.itemKey);
    emitSfx('aimStart', { itemKey: held.itemKey, recipeId: held.definition.id });
    syncTargetRing();
    deps.refreshActionBar?.();
    document.dispatchEvent(new CustomEvent('hobunji-alchemy-change', { detail: { type: 'flask-aim-start', itemKey: held.itemKey } }));
    return true;
  }

  function setTarget(worldX, worldY) {
    if (!aimState || aimState.phase !== 'aim' || !Number.isFinite(worldX) || !Number.isFinite(worldY)) return false;
    const target = clampTarget(worldX, worldY); // Authoritative clamped ground point.
    aimState.targetX = target.x; aimState.targetY = target.y;
    syncTargetRing();
    return true;
  }

  function setTargetFromVector(dx, dy, magnitude = 1) {
    if (!aimState || ![dx, dy, magnitude].every(Number.isFinite)) return false;
    const player = deps.getPlayer?.(); // Controller/mobile cursor origin.
    const length = Math.hypot(dx, dy); // Direction normalization.
    if (length < 0.01) return true;
    const distance = Math.max(0.5, Math.min(1, magnitude)) * MAX_THROW_RADIUS_TILES * (deps.TILE || 64); // Stick/drag distance mapping.
    return setTarget(player.x + dx / length * distance, player.y + dy / length * distance);
  }

  function cancelAim() {
    if (!aimState) return false;
    const itemKey = aimState.itemKey; // Used in cancellation diagnostics.
    aimState = null;
    if (targetRing) targetRing.visible = false;
    deps.cancelThrowWindup?.();
    deps.refreshActionBar?.();
    document.dispatchEvent(new CustomEvent('hobunji-alchemy-change', { detail: { type: 'flask-aim-cancel', itemKey } }));
    return true;
  }

  function confirmThrow() {
    if (!aimState || aimState.phase !== 'aim') return false;
    syncShoulderRayTarget(); // Freeze the live camera target on release.
    aimState.phase = 'releasing';
    aimState.releaseT = RELEASE_DELAY_S;
    deps.confirmThrowAnimation?.(aimState.itemKey);
    deps.refreshActionBar?.();
    return true;
  }

  function makeProjectile(record) {
    const THREE = deps.THREE; // Runtime Three namespace.
    const group = new THREE.Group(); // Actual authored flask, with a recipe-colored glow around its silhouette.
    const itemKey = window.AlchemySystem.ensureRecipeItemDef(record.definition.id, record.payload.potencyTier); // NPC and player throws use the same bottle definition.
    const mesh = deps.makeFlaskProjectile?.(itemKey); // Reuses held-item art, including brewed ingredient colors.
    if (mesh) group.add(mesh);
    const color = record.definition.particleColors?.[0] || '#7eea90'; // Glow follows the unchanged splash palette.
    const auraGeometry = new THREE.SphereGeometry(0.22, 10, 8); // Soft additive halo behind the visible bottle.
    const auraMaterial = new THREE.MeshBasicMaterial({ color, transparent:true, opacity:0.18, depthWrite:false, blending:THREE.AdditiveBlending }); // Recipe-colored glow without a particle core.
    group.add(new THREE.Mesh(auraGeometry, auraMaterial));
    record.sprite = mesh;
    record.visual = mesh ? 'authored-flask' : 'unavailable'; // Exposed by mobile diagnostics to detect missing sprite adapters.
    deps.getActiveScene?.()?.add(group);
    record.mesh = group;
    record.disposables = [auraGeometry, auraMaterial]; // Released at impact with the projectile group.
    record.landingShadow = makeLandingShadow(record);
    return record;
  }

  // Fixed (non-tracking) ground cue for an in-flight flask: the same soft disc
  // that sits under characters, fading in at the splash radius and contracting
  // over the flight to half the player's shadow so it "lands" with the flask.
  function makeLandingShadow(record) {
    const make = window.CharacterGroundShadow?.make; // Shared character-shadow material (color/opacity from config).
    const scene = deps.getActiveScene?.();
    if (!make || !scene) return null;
    const config = window.CharacterGroundShadow.config(); // Player shadow footprint the cue shrinks toward.
    const mesh = make('flask_landing_shadow');
    const radiusTiles = splashRadius(record.definition, record.playerOwned !== false); // Same radius as the aim ring and impact query.
    const baseOpacity = Math.max(mesh.material.opacity, LANDING_SHADOW_MIN_OPACITY); // Telegraph opacity reached after the quick fade-in; never fainter than a character shadow.
    const groundY = record.target.y; // Landing surface shared with the projectile.
    mesh.material.opacity = 0;
    mesh.position.set(record.target.x, groundY + window.CharacterGroundShadow.surfaceOffset(), record.target.z);
    mesh.scale.set(radiusTiles, 1, radiusTiles);
    scene.add(mesh);
    return { mesh, baseOpacity, groundY, terrainStep: -1, startX: radiusTiles, startZ: radiusTiles, endX: (config.radiusX ?? 0.34) * 0.5, endZ: (config.radiusZ ?? 0.22) * 0.5 };
  }

  function updateLandingShadow(projectile, ratio) {
    const shadow = projectile.landingShadow; // Null when the shared shadow factory is unavailable.
    if (!shadow) return;
    const scaleX = shadow.startX + (shadow.endX - shadow.startX) * ratio; // Linear contraction spans the whole flight.
    const scaleZ = shadow.startZ + (shadow.endZ - shadow.startZ) * ratio;
    shadow.mesh.scale.set(scaleX, 1, scaleZ);
    shadow.mesh.material.opacity = shadow.baseOpacity * Math.min(1, projectile.t / LANDING_SHADOW_FADE_IN_S);
    const terrainStep = Math.floor(Math.min(1, Math.max(0, ratio)) * LANDING_SHADOW_TERRAIN_STEPS); // Sampling terrain per vertex and re-uploading the buffer every frame is wasted on a slowly contracting disc.
    if (terrainStep === shadow.terrainStep) return;
    shadow.terrainStep = terrainStep;
    const positions = shadow.mesh.geometry.attributes?.position; // Unit disc in the XZ plane; local Y carries terrain height.
    if (!positions?.setY) return;
    const centerX = projectile.target.x; // Landing point in Three units.
    const centerZ = projectile.target.z;
    for (let index = 0; index < positions.count; index++) {
      positions.setY(index, groundAt(centerX + positions.getX(index) * scaleX, centerZ + positions.getZ(index) * scaleZ) - shadow.groundY);
    }
    positions.needsUpdate = true;
  }

  function disposeLandingShadow(projectile) {
    const shadow = projectile.landingShadow;
    if (!shadow) return;
    shadow.mesh.parent?.remove?.(shadow.mesh);
    shadow.mesh.geometry?.dispose?.();
    shadow.mesh.material?.dispose?.();
    projectile.landingShadow = null;
  }

  function releaseProjectile() {
    if (!aimState || aimState.phase !== 'releasing') return false;
    const state = aimState; // Captured aim state becomes immutable projectile data.
    if ((deps.inventory?.[state.itemKey] || 0) < 1) { cancelAim(); return false; }
    deps.inventory[state.itemKey]--; deps.clampInventoryStack?.(state.itemKey); // Exactly-once consumption at authored release.
    const origin = deps.getHeldWorldPosition?.() || { x: deps.getPlayer().x / (deps.TILE || 64), y: 1, z: deps.getPlayer().y / (deps.TILE || 64) }; // Hand/source transform.
    const tile = deps.TILE || 64; // Target conversion.
    const target = { x: state.targetX / tile, y: deps.getGroundYAtWorld?.(state.targetX / tile, state.targetY / tile) ?? deps.getGroundY?.(state.targetX, state.targetY) ?? 0.05, z: state.targetY / tile }; // Terrain-aware landing point.
    const distanceTiles = Math.hypot(target.x - origin.x, target.z - origin.z); // Scales flight time/arc for the extended shoulder range.
    const durationS = Math.min(PROJECTILE_MAX_TRAVEL_S, Math.max(PROJECTILE_MIN_TRAVEL_S, PROJECTILE_MIN_TRAVEL_S + distanceTiles * 0.034)); // Readable distance-scaled travel time.
    projectiles.push(makeProjectile({ itemKey: state.itemKey, payload: state.payload, definition: state.definition, area: deps.getCurrentArea?.(), t: 0, durationS, distanceTiles, trailAccumulator:0, origin: { x: origin.x, y: origin.y, z: origin.z }, target }));
    emitSfx('release', { itemKey: state.itemKey, recipeId: state.definition.id, x: origin.x, y: origin.y, z: origin.z });
    aimState = null;
    if (targetRing) targetRing.visible = false;
    deps.refreshItemScroll?.(); deps.refreshActionBar?.(); deps.saveMemberWorldData?.();
    document.dispatchEvent(new CustomEvent('hobunji-alchemy-change', { detail: { type: 'flask-release', itemKey: state.itemKey } }));
    return true;
  }

  function throwFromEntity(sourceEntity, recipeId, potencyTier = 0, targetX = null, targetY = null) {
    const definition = window.AlchemySystem?.RECIPE_DEFS?.[recipeId]; // Used to reject non-flask recipes before creating any projectile state.
    if (!sourceEntity || definition?.useMode !== 'throw') return false;
    const tile = deps?.TILE || 64; // Shared gameplay-pixel to Three-unit conversion.
    const sourceX = Number(sourceEntity.x); // Used as the independent NPC throw origin instead of the player position.
    const sourceY = Number(sourceEntity.y); // Used as the independent NPC throw origin instead of the player position.
    const requestedX = Number(targetX); // Used to aim at the live combat target without touching player aim state.
    const requestedY = Number(targetY); // Used to aim at the live combat target without touching player aim state.
    if (![sourceX, sourceY, requestedX, requestedY].every(Number.isFinite)) return false;
    const dx = requestedX - sourceX; // Used to preserve direction when clamping an NPC throw to the ordinary flask range.
    const dy = requestedY - sourceY; // Used to preserve direction when clamping an NPC throw to the ordinary flask range.
    const distancePx = Math.hypot(dx, dy); // Used by both range clamping and distance-scaled flight timing.
    const maxDistancePx = MAX_THROW_RADIUS_TILES * tile; // NPC Flaskers intentionally obey the same physical throw ceiling as the player.
    const clampScale = distancePx > maxDistancePx && distancePx > 0 ? maxDistancePx / distancePx : 1; // Used to clamp without changing aim direction.
    const landingX = sourceX + dx * clampScale; // Final gameplay-pixel landing X.
    const landingY = sourceY + dy * clampScale; // Final gameplay-pixel landing Y.
    const sourceGroundY = Number(deps.getGroundY?.(sourceX, sourceY) ?? 0); // Used to launch from a readable chest/hand height above local terrain.
    const origin = { x: sourceX / tile, y: sourceGroundY + 1.05, z: sourceY / tile }; // NPC hand approximation; no player held-item transform is required.
    const target = {
      x: landingX / tile,
      y: deps.getGroundYAtWorld?.(landingX / tile, landingY / tile) ?? deps.getGroundY?.(landingX, landingY) ?? 0.05,
      z: landingY / tile,
    }; // Same terrain-aware landing representation as player throws.
    const distanceTiles = Math.hypot(target.x - origin.x, target.z - origin.z); // Used to share the player's readable flight-time curve.
    const durationS = Math.min(PROJECTILE_MAX_TRAVEL_S, Math.max(PROJECTILE_MIN_TRAVEL_S, PROJECTILE_MIN_TRAVEL_S + distanceTiles * 0.034)); // Same deterministic travel timing as player flasks.
    const safeTier = Math.max(0, Math.min(4, Math.floor(Number(potencyTier) || 0))); // Used to keep enemy potency inside the stored potion-tier range.
    projectiles.push(makeProjectile({
      itemKey: `npc_flask_${recipeId}_p${safeTier}`,
      payload: { recipeId, potencyTier: safeTier },
      definition,
      area: sourceEntity.areaId ?? deps.getCurrentArea?.(),
      sourceEntity,
      playerOwned: false,
      t: 0,
      durationS,
      distanceTiles,
      trailAccumulator: 0,
      origin,
      target,
    }));
    lastNpcThrow = { recipeId, potencyTier: safeTier, sourceId: sourceEntity.id || null, targetX: landingX, targetY: landingY, at: performance.now() }; // Mobile-safe proof of Flasker loadout use.
    emitSfx('release', { itemKey: `npc_flask_${recipeId}_p${safeTier}`, recipeId, x: origin.x, y: origin.y, z: origin.z, npc: true });
    return true;
  }

  function impact(projectile) {
    const tile = deps.TILE || 64; // Three-unit to gameplay-pixel conversion.
    const x = projectile.target.x * tile; // Splash center X.
    const y = projectile.target.z * tile; // Splash center Y.
    const playerOwned = projectile.playerOwned !== false; // Used to keep enemy Flaskers from borrowing the player's Empower Flasks perk.
    const radiusTiles = splashRadius(projectile.definition, playerOwned); // Same radius as the ground preview.
    const entities = deps.getSplashEntities?.(projectile.area, x, y, radiusTiles * tile) || []; // Existing entity/friendly-fire query adapter.
    let affected = 0; // Impact diagnostic count.
    entities.forEach(entity => {
      const result = window.AlchemySystem.applyRecipeToEntity(projectile.definition.id, window.AlchemySystem.potencyMultiplier(projectile.payload.potencyTier), entity, { splash: true, potencyTier: projectile.payload.potencyTier, skipEmpower: !playerOwned }); // ResourceSystem-backed gameplay resolution; NPC throws never inherit player perk magnitude.
      if (result.ok) affected++;
    });
    deps.spawnImpactPresentation?.({ x, y, radiusTiles, definition: projectile.definition }); // Presentation-only burst.
    spawnImpactEffect(projectile, radiusTiles);
    emitSfx('impact', { itemKey: projectile.itemKey, recipeId: projectile.definition.id, x: projectile.target.x, y: projectile.target.y, z: projectile.target.z, radiusTiles, affected });
    lastImpact = { recipeId: projectile.definition.id, x, y, radiusTiles, affected, at: performance.now() };
    disposeProjectile(projectile);
  }

  function disposeProjectile(projectile) {
    projectile.mesh?.parent?.remove?.(projectile.mesh);
    disposeLandingShadow(projectile);
    projectile.disposables?.forEach(resource => resource?.dispose?.());
    deps.disposeFlaskProjectile?.(projectile.sprite, projectile.mesh);
  }

  function makePointCloud(color, count, radiusTiles, verticalBias) {
    const THREE = deps.THREE; // Runtime Three namespace.
    const positions = new Float32Array(count * 3); // Updated in place for one draw call per color layer.
    const velocities = new Float32Array(count * 3); // Per-particle outward/rising motion.
    for (let index = 0; index < count; index++) {
      const angle = Math.random() * Math.PI * 2; // Radial splash direction.
      const speed = radiusTiles * (0.7 + Math.random() * 1.4); // Reaches and briefly exceeds the gameplay radius.
      positions[index * 3 + 1] = 0.04 + Math.random() * 0.16;
      velocities[index * 3] = Math.cos(angle) * speed;
      velocities[index * 3 + 1] = verticalBias + Math.random() * 2.4;
      velocities[index * 3 + 2] = Math.sin(angle) * speed;
    }
    const geometry = new THREE.BufferGeometry(); // Shared particle geometry for this color layer.
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ color, size:0.13, transparent:true, opacity:0.95, depthWrite:false, blending:THREE.AdditiveBlending, sizeAttenuation:true }); // Bright splash droplets/mist.
    return { object:new THREE.Points(geometry, material), geometry, material, velocities };
  }

  function spawnImpactEffect(projectile, radiusTiles) {
    const THREE = deps.THREE; // Runtime Three namespace.
    const scene = deps.getActiveScene?.();
    if (!scene) return false;
    const colors = projectile.definition.particleColors?.length ? projectile.definition.particleColors.slice(0, 2) : ['#55ff82', '#d9ffe2']; // Recipe-authored two-tone burst.
    const intensity = Math.max(0.8, Number(projectile.definition.particleIntensity) || 1); // Authored dramatic multiplier.
    const group = new THREE.Group(); // One removable root prevents orphaned transient meshes.
    group.position.set(projectile.target.x, projectile.target.y + 0.035, projectile.target.z);
    const clouds = colors.map((color, index) => makePointCloud(color, Math.round((30 + index * 14) * intensity), radiusTiles, index ? 0.35 : 1.15)); // Fast droplets plus slower rising mist.
    clouds.forEach(cloud => group.add(cloud.object));
    const rings = [0, 0.11, 0.22].map((delay, index) => {
      const geometry = new THREE.RingGeometry(0.86, 1, 56); // Expanding ground shock ring.
      const material = new THREE.MeshBasicMaterial({ color:colors[index % colors.length], transparent:true, opacity:0, side:THREE.DoubleSide, depthWrite:false, blending:THREE.AdditiveBlending }); // Additive shock-ring material.
      const mesh = new THREE.Mesh(geometry, material);
      window.EnvironmentSurfaceMicroPlateau?.bindGroundProjection(mesh);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = 0.012 + index * 0.008;
      group.add(mesh);
      return { mesh, geometry, material, delay };
    });
    const flashGeometry = new THREE.SphereGeometry(0.24, 14, 10); // Brief central bloom at shatter time.
    const flashMaterial = new THREE.MeshBasicMaterial({ color:colors[0], transparent:true, opacity:0.95, depthWrite:false, blending:THREE.AdditiveBlending }); // Central bloom material.
    const flash = new THREE.Mesh(flashGeometry, flashMaterial);
    flash.position.y = 0.16;
    group.add(flash);
    scene.add(group);
    impactEffects.push({ group, area:projectile.area, age:0, maxAge:1.15, radiusTiles, clouds, rings, flash, flashGeometry, flashMaterial });
    while (impactEffects.length > 6) disposeImpactEffect(impactEffects.shift());
    return true;
  }

  function disposeImpactEffect(effect) {
    effect?.group?.parent?.remove?.(effect.group);
    effect?.clouds?.forEach(cloud => { cloud.geometry?.dispose?.(); cloud.material?.dispose?.(); });
    effect?.rings?.forEach(ring => { ring.geometry?.dispose?.(); ring.material?.dispose?.(); });
    effect?.flashGeometry?.dispose?.(); effect?.flashMaterial?.dispose?.();
  }

  function spawnProjectileTrail(projectile) {
    const THREE = deps.THREE; // Runtime Three namespace.
    const geometry = new THREE.SphereGeometry(0.035, 5, 4); // Tiny low-poly trail mote.
    const color = projectile.definition.particleColors?.[1] || projectile.definition.particleColors?.[0] || '#c8ffd3'; // Secondary recipe color.
    const material = new THREE.MeshBasicMaterial({ color, transparent:true, opacity:0.7, depthWrite:false, blending:THREE.AdditiveBlending }); // Luminous trail material.
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(projectile.mesh.position);
    deps.getActiveScene?.()?.add(mesh);
    projectileTrails.push({ mesh, geometry, material, age:0, maxAge:0.32 });
    while (projectileTrails.length > 36) disposeProjectileTrail(projectileTrails.shift());
  }

  function disposeProjectileTrail(trail) {
    trail?.mesh?.parent?.remove?.(trail.mesh);
    trail?.geometry?.dispose?.(); trail?.material?.dispose?.();
  }

  function update(dt) {
    if (!Number.isFinite(dt) || dt < 0) return;
    if (aimState && (aimState.area !== deps.getCurrentArea?.() || heldPayload()?.itemKey !== aimState.itemKey)) cancelAim(); // Selection/map changes cannot release a stale held flask.
    if (aimState?.phase === 'releasing') {
      aimState.releaseT -= Math.max(0, dt); // Windup→strike release countdown.
      if (aimState.releaseT <= 0) releaseProjectile();
    }
    if (!aimState && !projectiles.length && !projectileTrails.length && !impactEffects.length) return; // Idle combat pays no flask presentation cost.
    syncShoulderRayTarget();
    syncTargetRing();
    for (let index = projectiles.length - 1; index >= 0; index--) {
      const projectile = projectiles[index]; // Active deterministic flight.
      if (deps.getCurrentArea?.() !== projectile.area) { disposeProjectile(projectile); projectiles.splice(index, 1); continue; } // Never render an old-area splash in the new scene.
      projectile.t += Math.max(0, dt);
      const ratio = Math.min(1, projectile.t / projectile.durationS); // Authoritative destination progress.
      const arc = Math.sin(Math.PI * ratio) * Math.min(1.65, 0.72 + projectile.distanceTiles * 0.065); // Taller arc for distant shoulder throws.
      projectile.mesh?.position.set(projectile.origin.x + (projectile.target.x - projectile.origin.x) * ratio, projectile.origin.y + (projectile.target.y - projectile.origin.y) * ratio + arc, projectile.origin.z + (projectile.target.z - projectile.origin.z) * ratio);
      projectile.mesh?.rotation.set(projectile.t * 8, 0, projectile.t * 5);
      updateLandingShadow(projectile, ratio);
      projectile.trailAccumulator += Math.max(0, dt);
      if (projectile.trailAccumulator >= 0.045 && ratio < 0.96) { projectile.trailAccumulator = 0; spawnProjectileTrail(projectile); }
      if (ratio >= 1) { impact(projectile); projectiles.splice(index, 1); }
    }
    for (let index = projectileTrails.length - 1; index >= 0; index--) {
      const trail = projectileTrails[index]; // Short-lived projectile trail mote.
      trail.age += Math.max(0, dt);
      trail.mesh.material.opacity = 0.7 * Math.max(0, 1 - trail.age / trail.maxAge);
      trail.mesh.scale.setScalar(1 + trail.age * 2.6);
      if (trail.age >= trail.maxAge) { disposeProjectileTrail(trail); projectileTrails.splice(index, 1); }
    }
    for (let index = impactEffects.length - 1; index >= 0; index--) {
      const effect = impactEffects[index]; // Dramatic impact presentation with bounded lifetime.
      effect.age += Math.max(0, dt);
      const t = Math.min(1, effect.age / effect.maxAge); // Normalized effect lifetime.
      effect.clouds.forEach((cloud, cloudIndex) => {
        const positions = cloud.geometry.attributes.position.array; // Mutated in place, avoiding per-frame objects.
        for (let particleIndex = 0; particleIndex < positions.length / 3; particleIndex++) {
          positions[particleIndex * 3] += cloud.velocities[particleIndex * 3] * dt;
          positions[particleIndex * 3 + 1] += cloud.velocities[particleIndex * 3 + 1] * dt;
          positions[particleIndex * 3 + 2] += cloud.velocities[particleIndex * 3 + 2] * dt;
          cloud.velocities[particleIndex * 3] *= Math.pow(0.055, dt);
          cloud.velocities[particleIndex * 3 + 1] -= (cloudIndex ? 1.3 : 5.8) * dt;
          cloud.velocities[particleIndex * 3 + 2] *= Math.pow(0.055, dt);
        }
        cloud.geometry.attributes.position.needsUpdate = true;
        cloud.material.opacity = (cloudIndex ? 0.62 : 0.95) * Math.max(0, 1 - t);
        cloud.material.size = (cloudIndex ? 0.2 : 0.13) * (1 + t * (cloudIndex ? 1.2 : 0.2));
      });
      effect.rings.forEach(ring => {
        const localT = Math.max(0, Math.min(1, (effect.age - ring.delay) / 0.55)); // Staggered triple shockwave.
        ring.mesh.visible = effect.age >= ring.delay;
        ring.mesh.scale.setScalar(effect.radiusTiles * (0.18 + localT * 0.98));
        ring.material.opacity = Math.sin(Math.PI * localT) * 0.72;
      });
      effect.flash.scale.setScalar(1 + t * effect.radiusTiles * 2.1);
      effect.flashMaterial.opacity = 0.95 * Math.max(0, 1 - t * 4.2);
      if (effect.age >= effect.maxAge || deps.getCurrentArea?.() !== effect.area) { disposeImpactEffect(effect); impactEffects.splice(index, 1); }
    }
  }

  function heldActions() {
    if (!heldPayload() && !aimState) return [];
    if (aimState) return [
      { icon: '🎯', label: aimState.phase === 'aim' ? 'Throw' : 'Releasing…', action: 'alchemy_flask_primary', style: 'primary', allowed: aimState.phase === 'aim' },
      { icon: '✕', label: 'Cancel', action: 'alchemy_flask_cancel', style: 'secondary', allowed: aimState.phase === 'aim' },
    ];
    return [{ icon: '🎯', label: 'Aim / Throw', action: 'alchemy_flask_primary', style: 'primary', allowed: true }];
  }

  function primaryAction() { return aimState ? confirmThrow() : beginAim(); }
  function diagnostics() { return { aiming: !!aimState, phase: aimState?.phase || null, itemKey: aimState?.itemKey || null, target: aimState ? { x: aimState.targetX, y: aimState.targetY } : null, latestChange:'Terrain-projected filled splash preview and authored flask projectile; existing impact particles retained.', previewRadius:aimState ? splashRadius(aimState.definition) : null, shoulderRayTargeting:!!(aimState && shoulderViewActive()), projectileCount: projectiles.length, projectileVisuals:projectiles.map(projectile => projectile.visual), trailCount:projectileTrails.length, impactEffectCount:impactEffects.length, lastNpcThrow, lastSfxCue, lastImpact }; }

  addEventListener('blur', cancelAim); // Losing input focus cancels without consuming a flask.

  window.AlchemyFlasks = { init, beginAim, setTarget, setTargetFromVector, cancelAim, confirmThrow, throwFromEntity, primaryAction, heldActions, update, diagnostics, SFX_CUES, get aiming() { return !!aimState; }, MAX_THROW_RADIUS_TILES };
})();

// The shared selector presentation and contextual Potion Select adapter both
// load after game.js has created window._desktopSelectionArc.
addEventListener('load', () => {
  if (!document.querySelector('script[data-quick-potion-arc-ui]')) {
    const presentation = document.createElement('script'); // Shared visual/radius/animation treatment for toggled selector arches.
    presentation.src = 'js/quick-potion-arc-ui.js?v=20260821a';
    presentation.dataset.quickPotionArcUi = '1';
    presentation.async = false;
    document.head.appendChild(presentation);
  }
  if (!document.querySelector('script[data-mobile-potion-category-drag]')) {
    const mobileTap = document.createElement('script'); // Loads the shared contextual Potion Select adapter once the base action arc exists.
    mobileTap.src = 'js/mobile-potion-category-drag.js?v=20260925bandagemove1';
    mobileTap.dataset.mobilePotionCategoryDrag = '1';
    mobileTap.async = false;
    document.head.appendChild(mobileTap);
  }
}, { once:true });
