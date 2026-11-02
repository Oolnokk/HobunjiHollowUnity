// Dungeon Fire: a one-shot ranged ignition and shared fire-contact system.
// All ranged projectiles carry the same world-upright flame zone anchored to their PNG alpha.
(() => {
  'use strict';
  if (window.DungeonFire) return;

  const THREE = window.THREE;
  if (!THREE) return;

  const FLAME_HEIGHT = 1.65; // Tall world-space plume reaches ceiling-hung targets from an ordinary ranged-shot height.
  const FLAME_RADIUS = .34; // Used to widen fire contacts beyond the projectile's physical collider.
  const TARGETS = new Map(); // Registered fire-reactive ruin mechanisms, removed by each composer on teardown.
  const ACTIVE_VISUALS = new Set(); // Live per-projectile visual records; each is disposed with its ranged projectile.
  const UP = new THREE.Vector3(0, 1, 0); // Reused axis for the world-upright flame layers.
  const WORLD_POINT = new THREE.Vector3(); // Reused world position for the non-thrown projectile's alpha anchor.
  const HIT_START = new THREE.Vector3(); // Reused start anchor for the alpha-pixel flame's swept contact volume.
  const HIT_END = new THREE.Vector3(); // Reused clipped endpoint for swept fire-contact tests.
  const HIT_BOX = new THREE.Box3(); // Reused target bounds for the short list of fire-reactive mechanisms.
  const HIT_SIZE = new THREE.Vector3(); // Reused target bounds size.
  let pendingIgnition = false; // Consumed by RangedWeapons exactly once when the next player projectile is released.
  let flameArt = null; // Shared pointed-flame geometry/materials; each projectile owns only lightweight mesh instances.
  let lastEvent = 'idle'; // Exposed in the mobile diagnostic snapshot.

  function createFlameShape(width, height, bend = 0) {
    const shape = new THREE.Shape();
    shape.moveTo(-width * .5, 0);
    shape.bezierCurveTo(-width * .68, height * .18, -width * .34 + bend, height * .48, -width * .12 + bend, height * .72);
    shape.bezierCurveTo(-width * .08 + bend, height * .9, width * .08 + bend, height, width * .16 + bend, height);
    shape.bezierCurveTo(width * .12 + bend, height * .72, width * .58, height * .42, width * .5, height * .16);
    shape.bezierCurveTo(width * .39, height * .04, width * .2, 0, -width * .5, 0);
    return new THREE.ShapeGeometry(shape, 10);
  }

  function getFlameArt() {
    if (flameArt) return flameArt;
    const layers = [
      { width:.48, height:FLAME_HEIGHT, color:0xff2600, opacity:.92, bend:0 },
      { width:.32, height:FLAME_HEIGHT * .82, color:0xff8a06, opacity:.96, bend:.025 },
      { width:.17, height:FLAME_HEIGHT * .58, color:0xffef6b, opacity:.98, bend:-.018 },
    ];
    flameArt = layers.map(layer => ({
      geometry:createFlameShape(layer.width, layer.height, layer.bend),
      material:new THREE.MeshBasicMaterial({
        color:layer.color, transparent:true, opacity:layer.opacity,
        side:THREE.DoubleSide, depthWrite:false, blending:THREE.AdditiveBlending,
      }),
    }));
    return flameArt;
  }

  function createWorldFlame() {
    const group = new THREE.Group();
    group.name = 'dungeonFire_worldUprightFlame';
    group.userData.dungeonFireVisual = true;
    const art = getFlameArt();
    for (let layer = 0; layer < art.length; layer++) {
      for (let angle = 0; angle < 3; angle++) {
        const mesh = new THREE.Mesh(art[layer].geometry, art[layer].material);
        mesh.rotation.y = angle * Math.PI / 3;
        mesh.position.y = layer * .003;
        group.add(mesh);
      }
    }
    group.userData.baseRotationY = Math.random() * Math.PI * 2;
    return group;
  }

  function updateWorldFlame(state, dt) {
    const plane = state.plane;
    state.previousAnchorWorld.copy(state.anchorWorld);
    if (plane?.isObject3D && state.anchor) {
      plane.updateWorldMatrix?.(true, false);
      WORLD_POINT.set(state.anchor.x, state.anchor.y, 0);
      plane.localToWorld(WORLD_POINT);
      state.anchorWorld.copy(WORLD_POINT);
    } else {
      state.anchorWorld.copy(state.projectile.mesh.position);
    }
    state.worldFlame.position.copy(state.anchorWorld);
    state.age += dt;
    const pulse = Math.sin(state.age * 31) * .18 + Math.sin(state.age * 53 + .8) * .075;
    state.worldFlame.scale.set(1 + pulse, .9 + Math.cos(state.age * 37) * .2 + pulse * .3, 1 + Math.sin(state.age * 43) * .16);
    state.worldFlame.rotation.y = state.worldFlame.userData.baseRotationY + Math.sin(state.age * 19) * .22;
  }

  function attachProjectile(projectile) {
    if (!projectile || projectile.dungeonFire !== true || projectile._dungeonFire) return false;
    const plane = projectile.mesh?.userData?.projectilePlane || projectile.mesh?.userData?.facePivot?.children?.find?.(child => child.isMesh) || null;
    const state = {
      projectile, plane, spritePath:projectile.def?.projectileSprite || '',
      worldFlame:null, anchor:null,
      anchorWorld:projectile.mesh.position.clone(),previousAnchorWorld:projectile.mesh.position.clone(),
      age:0, disposed:false,
    };
    projectile._dungeonFire = state;
    ACTIVE_VISUALS.add(state);
    const scene = projectile.mesh?.parent;
    if (!scene) return false;
    state.worldFlame = createWorldFlame();
    scene.add(state.worldFlame);
    const alphaPromise = window.WeaponEnchantmentVFX?.opaqueAnchorForSprite?.(state.spritePath);
    Promise.resolve(alphaPromise).then(anchor => {
      if (state.disposed || projectile.dead) return;
      const resolved = anchor || (plane?.geometry?.parameters
        ? { width:1, height:1, index:0, opaquePixels:0 }
        : null);
      if (!resolved || !plane) return;
      const local = window.WeaponEnchantmentVFX?.metalPixelToLocal?.(resolved.index, resolved, plane);
      state.anchor = local ? { x:local.x, y:local.y } : { x:0, y:0 };
      lastEvent = anchor ? 'projectile fire anchored to top opaque pixel' : 'projectile fire used centre fallback';
    }).catch(() => { state.anchor = { x:0, y:0 }; });
    lastEvent = 'world-space projectile flame created';
    return true;
  }

  function updateProjectile(projectile, dt = 0) {
    const state = projectile?._dungeonFire;
    if (!state || state.disposed) return;
    const step = Math.max(0, Math.min(.05, Number(dt) || 0));
    if (state.worldFlame) updateWorldFlame(state, step);
  }

  function disposeProjectile(projectile) {
    const state = projectile?._dungeonFire;
    if (!state || state.disposed) return false;
    state.disposed = true;
    state.worldFlame?.parent?.remove(state.worldFlame);

    ACTIVE_VISUALS.delete(state);
    projectile._dungeonFire = null;
    return true;
  }

  function segmentBoxInterval(start, end, box) {
    let enter = 0, exit = 1;
    for (const axis of ['x', 'y', 'z']) {
      const delta = end[axis] - start[axis], min = box.min[axis], max = box.max[axis];
      if (Math.abs(delta) < 1e-9) {
        if (start[axis] < min || start[axis] > max) return null;
        continue;
      }
      let a = (min - start[axis]) / delta, b = (max - start[axis]) / delta;
      if (a > b) [a, b] = [b, a];
      enter = Math.max(enter, a); exit = Math.min(exit, b);
      if (enter > exit) return null;
    }
    return exit >= 0 && enter <= 1 ? Math.max(0, Math.min(1, enter)) : null;
  }

  function contactProjectile(projectile, start, end, maxT = 1, projectileRadius = 0) {
    if (!projectile?.dungeonFire || projectile.team !== 'player' || !start || !end || !TARGETS.size) return false;
    const state = projectile._dungeonFire;
    const plumeRadius = Math.max(FLAME_RADIUS, Number(projectileRadius) || 0);
    const limit = Math.max(0, Math.min(1, Number(maxT) || 0));
    const segmentStart = state?.worldFlame ? state.previousAnchorWorld : start;
    const segmentEnd = state?.worldFlame ? state.anchorWorld : end;
    HIT_START.copy(segmentStart);
    HIT_END.copy(segmentEnd).lerp(segmentStart, 1 - limit);
    let nearest = null;
    for (const target of TARGETS.values()) {
      if (target.active === false || target.isActive?.() === false || !target.object?.visible) continue;
      target.object.updateWorldMatrix?.(true, true);
      HIT_BOX.setFromObject(target.object);
      if (HIT_BOX.isEmpty()) continue;
      const padding = plumeRadius + Math.max(0, Number(target.contactPadding) || .12);
      HIT_BOX.expandByScalar(padding);
      HIT_BOX.min.y -= plumeHeight; // Expanding target bounds downward models fire rising above the projectile/alpha-pixel anchor.
      const t = segmentBoxInterval(HIT_START, HIT_END, HIT_BOX);
      if (t == null || (nearest && t >= nearest.t)) continue;
      nearest = { target, t };
    }
    if (!nearest) return false;
    const point = HIT_START.clone().lerp(HIT_END, nearest.t);
    try {
      const accepted = nearest.target.onBurn?.({
        target:nearest.target, projectile, point,
        fireKind:'world-flame',
      });
      if (accepted === false) return false;
      nearest.target.active = false;
      nearest.target.lastBurnedAt = performance.now();
      lastEvent = 'burned target: ' + nearest.target.id;
      return true;
    } catch (error) {
      console.warn('[Dungeon Fire] target ignition failed', error);
      lastEvent = 'target ignition failed: ' + nearest.target.id;
      return false;
    }
  }

  function registerTarget(target) {
    if (!target || target.id == null || !target.object?.isObject3D || typeof target.onBurn !== 'function') return false;
    const id = String(target.id);
    TARGETS.set(id, target);
    return id;
  }

  function unregisterTarget(id) {
    return TARGETS.delete(String(id));
  }

  function armNextProjectile() {
    if (!window.RangedWeapons?.equippedRangedKey?.()) return false;
    pendingIgnition = true;
    lastEvent = 'next player projectile armed';
    return true;
  }

  function consumeNextProjectile() {
    if (!pendingIgnition) return false;
    pendingIgnition = false;
    lastEvent = 'projectile ignition consumed';
    return true;
  }

  function clear() {
    for (const state of [...ACTIVE_VISUALS]) disposeProjectile(state.projectile);
    TARGETS.clear();
    pendingIgnition = false;
    lastEvent = 'cleared';
  }

  window.DungeonFire = Object.freeze({
    armNextProjectile,
    consumeNextProjectile,
    attachProjectile,
    updateProjectile,
    disposeProjectile,
    contactProjectile,
    registerTarget,
    unregisterTarget,
    clear,
    debugSnapshot:() => ({
      armed:pendingIgnition, reactiveTargets:TARGETS.size,
      activeVisuals:ACTIVE_VISUALS.size,
      thrownVisuals:[...ACTIVE_VISUALS].filter(state => state.projectile?.def?.rangedType === 'thrown').length,
      worldFlames:[...ACTIVE_VISUALS].filter(state => !!state.worldFlame).length,
      lastEvent,
    }),
    _test:Object.freeze({ segmentBoxInterval, createFlameShape }),
  });
})();
