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
  const MAX_THROW_RADIUS_TILES = 5; // Predictable targeting clamp around the player.
  const PROJECTILE_TRAVEL_S = 0.48; // Fixed responsive travel duration.
  const RELEASE_DELAY_S = 0.28; // Authored windup→strike release point.

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
    deps.startThrowWindup?.(held.itemKey);
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
    const geometry = new THREE.SphereGeometry(0.09, 8, 6); // Small low-cost readable flask proxy.
    const color = record.definition.particleColors?.[0] || '#7eea90'; // Recipe presentation color.
    const material = new THREE.MeshBasicMaterial({ color }); // Projectile-only material.
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 35;
    deps.getActiveScene?.()?.add(mesh);
    record.mesh = mesh;
    return record;
  }

  function releaseProjectile() {
    if (!aimState || aimState.phase !== 'releasing') return false;
    const state = aimState; // Captured aim state becomes immutable projectile data.
    if ((deps.inventory?.[state.itemKey] || 0) < 1) { cancelAim(); return false; }
    deps.inventory[state.itemKey]--; deps.clampInventoryStack?.(state.itemKey); // Exactly-once consumption at authored release.
    const origin = deps.getHeldWorldPosition?.() || { x: deps.getPlayer().x / (deps.TILE || 64), y: 1, z: deps.getPlayer().y / (deps.TILE || 64) }; // Hand/source transform.
    const tile = deps.TILE || 64; // Target conversion.
    projectiles.push(makeProjectile({ itemKey: state.itemKey, payload: state.payload, definition: state.definition, area: deps.getCurrentArea?.(), t: 0, durationS: PROJECTILE_TRAVEL_S, origin: { x: origin.x, y: origin.y, z: origin.z }, target: { x: state.targetX / tile, y: deps.getGroundY?.(state.targetX, state.targetY) ?? 0.05, z: state.targetY / tile } }));
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
    lastImpact = { recipeId: projectile.definition.id, x, y, radiusTiles, affected, at: performance.now() };
    projectile.mesh?.parent?.remove?.(projectile.mesh);
    projectile.mesh?.geometry?.dispose?.(); projectile.mesh?.material?.dispose?.();
  }

  function update(dt) {
    if (aimState?.phase === 'releasing') {
      aimState.releaseT -= Math.max(0, dt); // Windup→strike release countdown.
      if (aimState.releaseT <= 0) releaseProjectile();
    }
    syncTargetRing();
    for (let index = projectiles.length - 1; index >= 0; index--) {
      const projectile = projectiles[index]; // Active deterministic flight.
      projectile.t += Math.max(0, dt);
      const ratio = Math.min(1, projectile.t / projectile.durationS); // Authoritative destination progress.
      const arc = Math.sin(Math.PI * ratio) * 0.8; // Readability-only vertical arc.
      projectile.mesh?.position.set(projectile.origin.x + (projectile.target.x - projectile.origin.x) * ratio, projectile.origin.y + (projectile.target.y - projectile.origin.y) * ratio + arc, projectile.origin.z + (projectile.target.z - projectile.origin.z) * ratio);
      projectile.mesh?.rotation.set(projectile.t * 8, 0, projectile.t * 5);
      if (ratio >= 1) { impact(projectile); projectiles.splice(index, 1); }
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
  function diagnostics() { return { aiming: !!aimState, phase: aimState?.phase || null, itemKey: aimState?.itemKey || null, target: aimState ? { x: aimState.targetX, y: aimState.targetY } : null, projectileCount: projectiles.length, lastImpact }; }

  window.AlchemyFlasks = { init, beginAim, setTarget, setTargetFromVector, cancelAim, confirmThrow, primaryAction, heldActions, update, diagnostics, get aiming() { return !!aimState; }, MAX_THROW_RADIUS_TILES };
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