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
  const WORLD_POINT = new THREE.Vector3(); // Reused world position for the non-thrown projectile's alpha anchor.
  const HIT_START = new THREE.Vector3(); // Reused start anchor for the alpha-pixel flame's swept contact volume.
  const HIT_END = new THREE.Vector3(); // Reused clipped endpoint for swept fire-contact tests.
  const HIT_BOX = new THREE.Box3(); // Reused target bounds for the short list of fire-reactive mechanisms.
  const HIT_SIZE = new THREE.Vector3(); // Reused target bounds size.
  let pendingIgnition = false; // Consumed by RangedWeapons exactly once when the next player projectile is released.
  let lastEvent = 'idle'; // Exposed in the mobile diagnostic snapshot.


  // Campfire-equivalent reference rates: yellow 12, red 12, orange 16 per second.
  const FIRE_STREAMS = Object.freeze([
    {id:'yellow',rate:18,colorA:'#fff56a',colorB:'#ffdc12'},
    {id:'red',rate:15,colorA:'#ff5225',colorB:'#e91b08'},
    {id:'orange',rate:7,colorA:'#ffab3b',colorB:'#ff740c'},
  ]); // 50% more yellow, 25% more red, orange reduced; still 40 particles/s.
  const PLUME_LIFETIME = 1.3; // Longer than regular campfire's .72 seconds.
  const PLUME_SPEED = 2.35; // World-up rise ~3 units, vs regular campfire's ~0.5.
  const HELD_REPLAY_PADDING = PLUME_SPEED * PLUME_LIFETIME + .35; // Includes the whole tall plume in the existing scissored held-object x-ray redraw.
  function createWorldFlame() {
    const group = new THREE.Group();
    group.name='dungeonFire_worldUprightFlame';
    group.userData.dungeonFireVisual=true;
    const create=window.AuthoredFurniture?.createEmitterVisual;
    const emitters=[]; // GPU particle emitters owned/disposed by the ordinary authored furniture system.
    if(typeof create==='function')for(const stream of FIRE_STREAMS){
      const record={id:'dungeon_fire_'+stream.id,name:'Dungeon Fire '+stream.id,
        type:'fire',enabled:true,position:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},
        radius:.14,size:.22,rate:stream.rate,lifetime:PLUME_LIFETIME,
        speed:PLUME_SPEED,spread:.34,gravity:-.06,colorA:stream.colorA,colorB:stream.colorB}; // Campfire emitter schema.
      const visual=create(group,record,Math.ceil(stream.rate*PLUME_LIFETIME)+3);
      if(visual){
        visual.update?.(1/stream.rate,true); // Prime a visible ignition particle in the very first frame.
        if(visual.points){
          visual.points.renderOrder=3; // Flame draws above PNG without disabling world depth.
          const overlay=window.HeldObjectRenderOrder?.HELD_OVERLAY_LAYER;
          if(Number.isInteger(overlay)&&overlay>0&&overlay<32)visual.points.layers?.enable?.(overlay);
        }
        emitters.push(visual);
      }
    }
    else lastEvent='authored fire-particle renderer unavailable';
    group.userData.fireEmitterVisuals=emitters;
    return group;
  }
  function tickWorldFlame(group,dt,age=0) {
    const pulse=Math.max(.6,1+Math.sin(age*31)*.2+Math.sin(age*53+.8)*.09); // Retains the original violent furnace flicker without scaling gameplay contact bounds.
    for(const visual of group?.userData?.fireEmitterVisuals||[])visual.update?.(dt,true,{size:.22*pulse});
  }
  function disposeWorldFlame(group) {
    for(const visual of group?.userData?.fireEmitterVisuals||[])visual.dispose?.();
    group?.parent?.remove(group);
    if(group?.userData)group.userData.fireEmitterVisuals=[];
  }
  function updateWorldFlame(state,dt) {
    const plane=state.plane;
    state.previousAnchorWorld.copy(state.anchorWorld);
    if(plane?.isObject3D&&state.anchor){
      plane.updateWorldMatrix?.(true,false);
      WORLD_POINT.set(state.anchor.x,state.anchor.y,0);
      plane.localToWorld(WORLD_POINT);
      state.anchorWorld.copy(WORLD_POINT);
    }else state.anchorWorld.copy(state.projectile.mesh.position);
    state.worldFlame.position.copy(state.anchorWorld);
    state.age+=dt;
    tickWorldFlame(state.worldFlame,dt,state.age);
  }
  function representativeMetalAnchor(mask) {
    const indices=mask?.indices;
    if(!mask||!indices?.length||!(mask.width>0)||!(mask.height>0))return null;
    let sumX=0,sumY=0;
    for(const index of indices){sumX+=index%mask.width;sumY+=Math.floor(index/mask.width);}
    const centerX=sumX/indices.length,centerY=sumY/indices.length;
    let selected=indices[0],best=Infinity;
    for(const index of indices){
      const dx=index%mask.width-centerX,dy=Math.floor(index/mask.width)-centerY;
      const distance=dx*dx+dy*dy;
      if(distance<best){best=distance;selected=index;}
    }
    return {width:mask.width,height:mask.height,index:selected,opaquePixels:mask.matchedMetalPixels||indices.length,source:'metal'};
  }

  function resolveProjectileAnchor(projectile,state) {
    const vfx=window.WeaponEnchantmentVFX;
    const opaqueFallback=()=>Promise.resolve(vfx?.opaqueAnchorForSprite?.(state.spritePath))
      .then(anchor=>anchor?{...anchor,source:'opaque'}:null);
    if(projectile.def?.rangedType!=='thrown'||typeof vfx?.metalMaskForSprite!=='function')return opaqueFallback();
    return Promise.resolve(vfx.metalMaskForSprite(state.spritePath))
      .then(representativeMetalAnchor)
      .catch(()=>null)
      .then(anchor=>anchor||opaqueFallback());
  }

  function attachProjectile(projectile) {
    if (!projectile || projectile.dungeonFire !== true || projectile._dungeonFire) return false;
    const plane = projectile.mesh?.userData?.projectilePlane || projectile.mesh?.userData?.facePivot?.children?.find?.(child => child.isMesh) || null;
    const state = {
      projectile, plane, spritePath:projectile.def?.projectileSprite || '',
      worldFlame:null, anchor:null, anchorKind:null,
      anchorWorld:projectile.mesh.position.clone(),previousAnchorWorld:projectile.mesh.position.clone(),
      age:0, disposed:false,
    };
    projectile._dungeonFire = state;
    ACTIVE_VISUALS.add(state);
    const scene = projectile.mesh?.parent;
    if (!scene) { ACTIVE_VISUALS.delete(state); projectile._dungeonFire=null; state.disposed=true; return false; }
    state.worldFlame = createWorldFlame();
    state.worldFlame.position.copy(state.anchorWorld); // Avoid a one-frame flame flash at scene origin before the source-pixel anchor resolves.
    scene.add(state.worldFlame);
    resolveProjectileAnchor(projectile,state).then(anchor => {
      if (state.disposed || projectile.dead) return;
      const resolved = anchor || (plane?.geometry?.parameters
        ? { width:1, height:1, index:0, opaquePixels:0, source:'fallback' }
        : null);
      if (!resolved || !plane) return;
      const local = window.WeaponEnchantmentVFX?.metalPixelToLocal?.(resolved.index, resolved, plane);
      state.anchor = local ? { x:local.x, y:local.y } : { x:0, y:0 };
      state.anchorKind=resolved.source||'fallback';
      lastEvent = state.anchorKind==='metal' ? 'thrown fire anchored to source metal pixels'
        : state.anchorKind==='opaque' ? 'projectile fire anchored to top opaque pixel'
        : 'projectile fire used centre fallback';
    }).catch(() => { state.anchor = { x:0, y:0 }; state.anchorKind='fallback'; });
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
    disposeWorldFlame(state.worldFlame);

    ACTIVE_VISUALS.delete(state);
    projectile._dungeonFire = null;
    return true;
  }


  let heldVisualState=null; // One charged player-held weapon; no NPC/free-floating matching gear.
  let heldRequest=0; // Invalidate late modular mask promises on holster, swap, launch or cleanup.
  function disposeHeldVisual() {
    if (!heldVisualState) return;
    heldRequest++; // Invalidate pending metal-mask resolutions only when an actual charged visual is retired.
    if (heldVisualState.plane?.userData) delete heldVisualState.plane.userData.hobunjiDungeonFireVfxPadding; // Does not touch enchantment VFX padding.
    disposeWorldFlame(heldVisualState.worldFlame);
    heldVisualState = null;
  }
  function heldRenderScene(visual) {
    let root = null; // Follows the actual hand/weapon ancestor chain to choose the scene rendered in this room.
    for (let node = visual; node; node = node.parent) {
      if (node.visible === false) return null; // A hidden toolHolder or ancestor must never leave floating flames.
      root = node;
    }
    if (!root || root === visual || typeof root.add !== 'function') return null;
    const activeScene = window.Combat?.deps?.getActiveScene?.(); // Rejects an old, detached room scene during a map transition.
    if (activeScene?.isScene && root !== activeScene) return null;
    return root;
  }

  function currentHeldSource() {
    const key = window.RangedWeapons?.equippedRangedKey?.();
    const vfx = window.WeaponEnchantmentVFX;
    const visual = key && vfx?.heldVisualForItem?.(key);
    const plane = visual?.userData?.toolPlane;
    const heldMode = window.Combat?.deps?.getHeldMode?.() ?? window.ProceduralHandAttachments?.gameDeps?.getHeldMode?.();
    const activeTool = window.Combat?.deps?.getActiveTool?.() ?? window.ProceduralHandAttachments?.gameDeps?.getActiveTool?.(); // A selected but holstered or melee-slot weapon must not show ranged fire.
    if (activeTool && activeTool !== 'ranged') return null;
    if (!key || !plane?.isObject3D || visual.visible === false || plane.visible === false || (heldMode && heldMode !== 'tool')) return null;
    const scene = heldRenderScene(visual); // The held weapon's current scene wins over an injected default farm scene.
    if (!scene) return null;
    const spritePath = vfx?.sourceSpriteForWeapon?.(key) || null; // Virtual modular composite, not the bare shaft.
    return { key, visual, plane, spritePath, scene };
  }

  function updateHeldVisual(dt = 0) {
    if (!pendingIgnition) { disposeHeldVisual(); return false; }
    const source = currentHeldSource();
    if (!source) { disposeHeldVisual(); return false; }
    let state = heldVisualState; // Retains one set of particles while the same weapon remains visible in the same room.
    if (!state || state.visual !== source.visual || state.plane !== source.plane
      || state.key !== source.key || state.spritePath !== source.spritePath || state.scene !== source.scene) {
      disposeHeldVisual();
      const worldFlame = createWorldFlame(); // One room-owned world-upright effect follows this precise player-held PNG.
      worldFlame.name = 'dungeonFire_chargedHeldWeapon';
      source.scene.add(worldFlame);
      state = { ...source, worldFlame, anchor:null, anchorKind:'pending', age:0 }; // Tracks pulsing and the modular metal pixel position.
      heldVisualState = state;
      const request = ++heldRequest, vfx = window.WeaponEnchantmentVFX; // Reject stale async masks following room or item changes.
      const task = source.spritePath && vfx?.metalMaskForSprite
        ? Promise.resolve(vfx.metalMaskForSprite(source.spritePath)).then(representativeMetalAnchor).catch(() => null)
        : Promise.resolve(null);
      task.then(anchor => {
        if (request !== heldRequest || heldVisualState !== state || !pendingIgnition) return;
        const local = anchor && vfx?.metalPixelToLocal?.(anchor.index, anchor, source.plane);
        state.anchor = local ? { x:local.x, y:local.y } : { x:0, y:0 };
        state.anchorKind = local ? 'metal' : 'center-fallback';
        lastEvent = state.key + ': charged held weapon fire (' + state.anchorKind + ')';
      });
      lastEvent = source.key + ': charged held weapon flame created';
    }
    state.plane.updateWorldMatrix?.(true, false);
    WORLD_POINT.set(state.anchor?.x || 0, state.anchor?.y || 0, 0);
    state.plane.localToWorld(WORLD_POINT);
    state.worldFlame.position.copy(WORLD_POINT);
    if (state.plane.userData) state.plane.userData.hobunjiDungeonFireVfxPadding = HELD_REPLAY_PADDING; // Kept independent of other enchantment emitters.
    const step = Math.max(0, Math.min(.05, Number(dt) || 0)); // Stable particle simulation during stalls or UI pauses.
    state.age += step;
    tickWorldFlame(state.worldFlame, step, state.age);
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
    const hits = [];
    for (const target of TARGETS.values()) {
      if (target.active === false || target.isActive?.() === false || !target.object?.visible) continue;
      target.object.updateWorldMatrix?.(true, true);
      HIT_BOX.setFromObject(target.object);
      if (HIT_BOX.isEmpty()) continue;
      const padding = plumeRadius + Math.max(0, Number(target.contactPadding) || .12);
      HIT_BOX.expandByScalar(padding);
      HIT_BOX.min.y -= FLAME_HEIGHT; // Expanding target bounds downward models fire rising above the projectile/alpha-pixel anchor.
      const t = segmentBoxInterval(HIT_START, HIT_END, HIT_BOX);
      if (t != null) hits.push({ target, t });
    }
    hits.sort((a,b)=>a.t-b.t); // A target that rejects ignition (e.g. an already-empty cleanser) must not shield the next valid mechanism along the same flame sweep.
    for (const hit of hits) {
      const target=hit.target;
      if (TARGETS.get(String(target.id))!==target || target.active===false || target.isActive?.()===false) continue;
      const point = HIT_START.clone().lerp(HIT_END, hit.t);
      try {
        const accepted = target.onBurn?.({
          target, projectile, point,
          fireKind:'world-flame',
        });
        if (accepted === false) continue;
        target.active = false;
        target.lastBurnedAt = performance.now();
        lastEvent = 'burned target: ' + target.id;
        return true;
      } catch (error) {
        console.warn('[Dungeon Fire] target ignition failed', error);
        lastEvent = 'target ignition failed: ' + target.id;
      }
    }
    return false;
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
    updateHeldVisual(1/40); // Show ignition immediately after the brazier interaction.
    return true;
  }

  function consumeNextProjectile() {
    if (!pendingIgnition) return false;
    pendingIgnition = false;
    disposeHeldVisual(); // The launched projectile now owns the fire.
    lastEvent = 'projectile ignition consumed';
    return true;
  }

  function clear() {
    for (const state of [...ACTIVE_VISUALS]) disposeProjectile(state.projectile);
    TARGETS.clear();
    pendingIgnition = false;
    disposeHeldVisual();
    lastEvent = 'cleared';
  }

  window.DungeonFire = Object.freeze({
    armNextProjectile,
    consumeNextProjectile,
    attachProjectile,
    updateHeldVisual,
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
      heldFire:!!heldVisualState,
      heldWeaponKey:heldVisualState?.key||null,
      heldAnchorKind:heldVisualState?.anchorKind||null,
      fireStreams:FIRE_STREAMS.map(stream=>({color:stream.id,rate:stream.rate})),
      anchorKinds:[...ACTIVE_VISUALS].map(state=>state.anchorKind||'pending'),
      lastEvent,
    }),
    _test:Object.freeze({ segmentBoxInterval, representativeMetalAnchor, FIRE_STREAMS, PLUME_SPEED, PLUME_LIFETIME }),
  });
})();
