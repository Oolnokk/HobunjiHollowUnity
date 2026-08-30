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
  const MAX_THROW_RADIUS_TILES = 14; // Shoulder-view interaction-ray range around the player.
  const INTERACTION_RAY_MAX_DISTANCE = 36; // World-unit terrain sampling limit used by shoulder aim.
  const INTERACTION_RAY_STEP = 0.22; // Fine enough to catch narrow raised terrain without per-frame mesh raycasts.
  const PROJECTILE_MIN_TRAVEL_S = 0.42; // Near throws remain responsive.
  const PROJECTILE_MAX_TRAVEL_S = 0.9; // Distant throws remain readable without feeling sluggish.
  const RELEASE_DELAY_S = 0.28; // Authored windup→strike release point.
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

  function makeTargetRing() {
    if (targetRing || !deps?.THREE) return targetRing;
    const geometry = new deps.THREE.RingGeometry(0.2, 0.27, 40); // Readable fixed-width green ground ring.
    const material = new deps.THREE.MeshBasicMaterial({ color: 0x55ff82, transparent: true, opacity: 0.82, side: deps.THREE.DoubleSide, depthWrite: false }); // Aim-only presentation material.
    targetRing = new deps.THREE.Mesh(geometry, material);
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
    ring.position.set(aimState.targetX / tile, deps.getGroundY?.(aimState.targetX, aimState.targetY) ?? 0.025, aimState.targetY / tile);
    const radius = aimState.definition.splashRadius || window.AlchemySystem.DEFAULT_SPLASH_RADIUS_TILES; // Authored radius.
    ring.scale.setScalar(radius / 0.27);
  }

  function beginAim() {
    const held = heldPayload(); // Flask selected through the ordinary item flow.
    if (!held || aimState) return false;
    const player = deps.getPlayer?.(); // Default target origin/direction.
    const direction = deps.getAimAngle?.() ?? (Number(player?.angle) || 0); // Existing targeting language.
    const distance = 3 * (deps.TILE || 64); // Readable initial aim distance.
    aimState = { ...held, targetX: player.x + Math.cos(direction) * distance, targetY: player.y + Math.sin(direction) * distance, phase: 'aim', releaseT: 0 };
    syncShoulderRayTarget();
    deps.startThrowWindup?.(held.itemKey);
    emitSfx('aimStart', { itemKey: held.itemKey, recipeId: held.definition.id });
    syncTargetRing();
    deps.refreshActionBar?.();
    document.dispatchEvent(new CustomEvent('hobunji-alchemy-change', { detail: { type: 'flask-aim-start', itemKey: held.itemKey } }));
    return true;
  }

  function setTarget(worldX, worldY) {
    if (!aimState || aimState.phase !== 'aim') return false;
    const target = clampTarget(worldX, worldY); // Authoritative clamped ground point.
    aimState.targetX = target.x; aimState.targetY = target.y;
    syncTargetRing();
    return true;
  }

  function setTargetFromVector(dx, dy, magnitude = 1) {
    if (!aimState) return false;
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
    aimState.phase = 'releasing';
    aimState.releaseT = RELEASE_DELAY_S;
    deps.confirmThrowAnimation?.(aimState.itemKey);
    deps.refreshActionBar?.();
    return true;
  }

  function makeProjectile(record) {
    const THREE = deps.THREE; // Runtime Three namespace.
    const group = new THREE.Group(); // Luminous proxy keeps the thrown flask readable against terrain.
    const geometry = new THREE.SphereGeometry(0.095, 10, 8); // Small low-cost readable flask core.
    const color = record.definition.particleColors?.[0] || '#7eea90'; // Recipe presentation color.
    const material = new THREE.MeshBasicMaterial({ color }); // Projectile core material.
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 35;
    group.add(mesh);
    const auraGeometry = new THREE.SphereGeometry(0.16, 10, 8); // Used only by the projectile's additive glow.
    const auraMaterial = new THREE.MeshBasicMaterial({ color, transparent:true, opacity:0.28, depthWrite:false, blending:THREE.AdditiveBlending }); // Additive flight aura.
    group.add(new THREE.Mesh(auraGeometry, auraMaterial));
    deps.getActiveScene?.()?.add(group);
    record.mesh = group;
    record.disposables = [geometry, material, auraGeometry, auraMaterial]; // Released at impact with the projectile group.
    return record;
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

  function impact(projectile) {
    const tile = deps.TILE || 64; // Three-unit to gameplay-pixel conversion.
    const x = projectile.target.x * tile; // Splash center X.
    const y = projectile.target.z * tile; // Splash center Y.
    const empowerFlasksRank = window.PerkSystem?.rank('alchemy', 'empowerFlasks') || 0; // Widens the splash alongside its magnitude/batch bonuses.
    const radiusTiles = (projectile.definition.splashRadius || window.AlchemySystem.DEFAULT_SPLASH_RADIUS_TILES) * (1 + empowerFlasksRank * 0.1); // Authored radius.
    const entities = deps.getSplashEntities?.(projectile.area, x, y, radiusTiles * tile) || []; // Existing entity/friendly-fire query adapter.
    let affected = 0; // Impact diagnostic count.
    entities.forEach(entity => {
      const result = window.AlchemySystem.applyRecipeToEntity(projectile.definition.id, window.AlchemySystem.potencyMultiplier(projectile.payload.potencyTier), entity, { splash: true, potencyTier: projectile.payload.potencyTier }); // ResourceSystem-backed gameplay resolution.
      if (result.ok) affected++;
    });
    deps.spawnImpactPresentation?.({ x, y, radiusTiles, definition: projectile.definition }); // Presentation-only burst.
    spawnImpactEffect(projectile, radiusTiles);
    emitSfx('impact', { itemKey: projectile.itemKey, recipeId: projectile.definition.id, x: projectile.target.x, y: projectile.target.y, z: projectile.target.z, radiusTiles, affected });
    lastImpact = { recipeId: projectile.definition.id, x, y, radiusTiles, affected, at: performance.now() };
    projectile.mesh?.parent?.remove?.(projectile.mesh);
    projectile.disposables?.forEach(resource => resource?.dispose?.());
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
    if (aimState?.phase === 'releasing') {
      aimState.releaseT -= Math.max(0, dt); // Windup→strike release countdown.
      if (aimState.releaseT <= 0) releaseProjectile();
    }
    syncShoulderRayTarget();
    syncTargetRing();
    for (let index = projectiles.length - 1; index >= 0; index--) {
      const projectile = projectiles[index]; // Active deterministic flight.
      projectile.t += Math.max(0, dt);
      const ratio = Math.min(1, projectile.t / projectile.durationS); // Authoritative destination progress.
      const arc = Math.sin(Math.PI * ratio) * Math.min(1.65, 0.72 + projectile.distanceTiles * 0.065); // Taller arc for distant shoulder throws.
      projectile.mesh?.position.set(projectile.origin.x + (projectile.target.x - projectile.origin.x) * ratio, projectile.origin.y + (projectile.target.y - projectile.origin.y) * ratio + arc, projectile.origin.z + (projectile.target.z - projectile.origin.z) * ratio);
      projectile.mesh?.rotation.set(projectile.t * 8, 0, projectile.t * 5);
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
  function diagnostics() { return { aiming: !!aimState, phase: aimState?.phase || null, itemKey: aimState?.itemKey || null, target: aimState ? { x: aimState.targetX, y: aimState.targetY } : null, shoulderRayTargeting:!!(aimState && shoulderViewActive()), projectileCount: projectiles.length, trailCount:projectileTrails.length, impactEffectCount:impactEffects.length, lastSfxCue, lastImpact }; }

  window.AlchemyFlasks = { init, beginAim, setTarget, setTargetFromVector, cancelAim, confirmThrow, primaryAction, heldActions, update, diagnostics, SFX_CUES, get aiming() { return !!aimState; }, MAX_THROW_RADIUS_TILES };
})();

// The shared selector presentation and mobile tap-only potion navigator both
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
    const mobileTap = document.createElement('script'); // Mobile potion hierarchy uses actual circle taps; desktop/controller retain the original selector input.
    mobileTap.src = 'js/mobile-potion-category-drag.js?v=20260822d';
    mobileTap.dataset.mobilePotionCategoryDrag = '1';
    mobileTap.async = false;
    document.head.appendChild(mobileTap);
  }
}, { once:true });
