// Body sink for actors that are not the local player (bandits and other BanditCombat humanoids, watchman NPCs).
//
// The player's body sink is composed by PlayerBodyTransformComposer (js/weapon-stance-drop-runtime.js). Other actors have no composer and each
// builds its body differently (an enemy is a centre-anchored group with separate plane/hand/leg pivots; an NPC walker has a floor-anchored rig
// root), so this module applies the same two halves to whichever roots the actor lists:
//   1. legs.setStanceDrop(...) raises the leg group and folds the knees (ProceduralLegAnimation), reporting the sink it really applied;
//   2. each listed visual root is lowered by that amount, as persistent state (delta-tracked, so another writer that also moves the root is
//      respected). Pants are skinned in this same frame, so they follow without any render-time patch.
// `lower` entries are { obj, factor }: factor converts the legs' local sink units into the root's own parent-frame units (1 for a child of the
// frame the legs live in; the rig scale when the root IS the scaled rig root).
(function (global) {
  'use strict';

  const APPLIED = '__hobunjiBodySinkApplied';

  function setRootSink(entry, units) {
    const obj = entry?.obj;
    if (!obj?.position) return;
    const factor = typeof entry.factor === 'function' ? entry.factor() : entry.factor;
    const next = units * (Number(factor) || 1);
    const prev = obj.userData[APPLIED] || 0;
    if (next === prev) return;
    obj.position.y -= next - prev;
    obj.userData[APPLIED] = next;
  }

  // pct: percent of the actor's model height; bodyYawDeg: the pose's body twist (picks and turns the leading leg); immediate: follow the value
  // exactly (a playing swing) instead of easing (entering/leaving a stance). Returns the sink actually applied, in legs-local units.
  function apply(actor, pct, bodyYawDeg = 0, immediate = false) {
    const legs = actor?.legs;
    if (!legs?.setStanceDrop) return 0;
    const wanted = Math.max(0, Number(pct) || 0) / 100 * (legs.modelHeight || 0);
    legs.setStanceYawDeg?.(bodyYawDeg);
    legs.setStanceDrop(wanted, immediate);
    const applied = legs.getStanceDrop();
    for (const entry of actor.lower || []) {
      if (entry?.obj) { entry.obj.userData ||= {}; setRootSink(entry, applied); }
    }
    return applied;
  }

  // Lowers nothing more and lets the legs stand again (dead, ranged mode, stance put away). The leg handle eases its own release.
  function release(actor) {
    return apply(actor, 0, 0, false);
  }

  global.ActorBodySink = { apply, release, enabled: () => global.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.proceduralFeet?.stanceDrop?.enabled !== false };
})(window);
