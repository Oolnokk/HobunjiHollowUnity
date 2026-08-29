// Shared per-frame "where is this creature/character's head, in world
// space" cache. Several independent systems (livestock/companion
// look-at-player, farm-animal look-at-player, combat head-nod, dialogue
// facing) each used to recompute a near-identical formula for the same
// entity, sometimes more than once in the same frame (e.g. two different
// predators both aiming at the same fleeing prey). This module computes a
// given entity's head world position once per rendered frame and hands
// every asker the same cached result — a plain rAF-driven frame counter
// invalidates the cache, so no caller has to know when "this frame" ends.
//
// Every getHeadWorld() result has the shape { x, z, worldY }: x/z are in
// the game's raw pixel/world units (the same convention game.js's own
// per-entity `x`/`y` fields use — NOT tile units, and NOT Three.js scene
// units), while worldY is a real Three.js scene-space height, ready to
// compare directly against a group's position.y. This mirrors game.js's
// pre-existing _playerFaceTarget/_creatureHeadWorldY conventions exactly,
// so callers migrating to this cache don't need to convert anything.
//
// Public API: window.CreatureHeadCache = {
//   getHeadWorld(entity, kind, ctx) -> {x, z, worldY} | null,
//   PLAYER_FACE_HEIGHT_RATIO,
// }
(() => {
  'use strict';

  // Matches game.js's own PLAYER_FACE_HEIGHT_RATIO (0.76) — kept here too
  // since this module has no access to that closure-local constant, and a
  // player/companion-portrait head estimate needs the same ratio game.js's
  // pre-existing _playerFaceTarget already used.
  const PLAYER_FACE_HEIGHT_RATIO = 0.76;

  // A rAF-driven counter, independent of any particular game loop, so this
  // module works for every caller (game.js, farm-animals.js, combat-*.js)
  // without any of them having to explicitly "tick" it.
  let frameToken = 0;
  function _tick() { frameToken++; requestAnimationFrame(_tick); }
  requestAnimationFrame(_tick);

  const _cache = new WeakMap(); // entity -> { frame, pos }

  // Wild/hostile CREATURE_DB creatures, farm livestock (farm-animals.js),
  // and shoulder pets/companions all share this same avatarRef/headRig
  // shape (see png-plane-avatar.js's buildAnimalPlaneAvatarModel +
  // applyAnimalHeadRig) — one formula covers every one of them. Mirrors
  // game.js's former _creatureHeadWorldY and farm-animals.js's former
  // _farmAnimalHeadWorldY, which were near-identical hand copies of this
  // same math.
  function _computeAnimalHeadWorld(c) {
    const group = c?.avatarRef?.group;
    if (!group) return { x: Number(c?.x) || 0, z: Number(c?.y) || 0, worldY: 0 };
    const rig = c.avatarRef?.headRig?.rig;
    const modelHeight = (Number(c.def?.modelWidth) * Number(c.def?.spriteAspect || (600 / 1375)))
      || Number(c.modelHeight)
      || Number(c.halfHeight || 0.45) * 2;
    const scaleY = Number(group.scale?.y) || 1;
    const pivotY = Number(rig?.pivot?.y);
    const pivotOffset = Number.isFinite(pivotY) ? (0.5 - pivotY) * modelHeight : modelHeight * 0.08;
    const planeOffset = Number(c.avatarRef?.frontPlane?.position?.y) || 0;
    const worldY = (Number(group.position?.y) || Number(c.wy) || 0) + (planeOffset + pivotOffset) * scaleY;
    return { x: Number(c.x) || 0, z: Number(c.y) || 0, worldY };
  }

  // ctx: { x, y, mesh, avatarModelHeight } — game.js supplies the player's
  // own globals here since they're closure-local, not properties on the
  // shared `player` object this cache keys by.
  function _computePlayerHeadWorld(ctx) {
    const modelHeight = Number(ctx?.avatarModelHeight) || 0.9;
    const floorY = Number(ctx?.mesh?.position?.y) || 0;
    return { x: Number(ctx?.x) || 0, z: Number(ctx?.y) || 0, worldY: floorY + modelHeight * PLAYER_FACE_HEIGHT_RATIO };
  }

  // A companion acting as a look-at "master" (see game.js's
  // _playerFaceTarget(master) — historically also accepted a non-player
  // companion) reads its portrait model height off the avatar group's own
  // userData instead of a def/headRig, since it's a portrait-plane avatar
  // rather than an animal-plane one.
  function _computeCompanionPortraitHeadWorld(master) {
    const modelHeight = Number(master?.avatarRef?.group?.userData?.portraitModelHeight) || Number(master?.halfHeight || 0.45) * 2;
    const floorY = (Number(master?.avatarRef?.group?.position?.y) || 0) - (Number(master?.halfHeight) || modelHeight / 2);
    return { x: Number(master?.x) || 0, z: Number(master?.y) || 0, worldY: floorY + modelHeight * PLAYER_FACE_HEIGHT_RATIO };
  }

  function getHeadWorld(entity, kind, ctx) {
    if (!entity) return null;
    const cached = _cache.get(entity);
    if (cached && cached.frame === frameToken) return cached.pos;
    let pos;
    if (kind === 'player') pos = _computePlayerHeadWorld(ctx);
    else if (kind === 'companion-portrait') pos = _computeCompanionPortraitHeadWorld(entity);
    else pos = _computeAnimalHeadWorld(entity);
    _cache.set(entity, { frame: frameToken, pos });
    return pos;
  }

  // Is `point` (a real Three.js scene-space {x,y,z} — NOT this module's own
  // raw-px getHeadWorld() convention; convert x/z by dividing by TILE
  // first) close to the given camera/aim ray? Used for "is the player
  // focusing on this creature's head" checks (see game.js's
  // currentPlayerInteractionRay/currentPlayerAimRay and their deps.get*
  // exposures) — finds the closest point on the ray ahead of its origin
  // and tests it against radiusWorld, so a creature only "notices" being
  // looked at when the aim is actually close to its head, not merely
  // somewhere in its general direction.
  function isRayNearPoint(ray, point, radiusWorld) {
    if (!ray?.origin || !ray?.direction || !point) return false;
    const ox = Number(ray.origin.x) || 0, oy = Number(ray.origin.y) || 0, oz = Number(ray.origin.z) || 0;
    let dx = Number(ray.direction.x) || 0, dy = Number(ray.direction.y) || 0, dz = Number(ray.direction.z) || 0;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return false;
    dx /= len; dy /= len; dz /= len;
    const px = (Number(point.x) || 0) - ox, py = (Number(point.y) || 0) - oy, pz = (Number(point.z) || 0) - oz;
    const t = px * dx + py * dy + pz * dz;
    if (t < 0) return false; // Head is behind the ray's origin (behind the camera) — not being looked at.
    const cx = ox + dx * t, cy = oy + dy * t, cz = oz + dz * t;
    const ddx = (Number(point.x) || 0) - cx, ddy = (Number(point.y) || 0) - cy, ddz = (Number(point.z) || 0) - cz;
    const radius = Number(radiusWorld) || 0.35;
    return (ddx * ddx + ddy * ddy + ddz * ddz) <= radius * radius;
  }

  window.CreatureHeadCache = { getHeadWorld, isRayNearPoint, PLAYER_FACE_HEIGHT_RATIO };
})();
