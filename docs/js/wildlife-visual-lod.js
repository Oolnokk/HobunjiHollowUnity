(() => {
  'use strict';

  // Wildlife visual LOD — extracted out of game.js's updateHostiles, following
  // the same window.<Namespace> pattern already used by its bandit-sleep
  // sibling, js/wilderness-simulation-lod.js.
  //
  // Distant, fully calm wildlife pays no rendering/visual-rig cost: their
  // avatar, ground shadow, and any ring HUD are hidden past HIDE_TILES and
  // only shown again once the player is back within SHOW_TILES (a narrower
  // threshold than HIDE_TILES, so wildlife doesn't flicker visible/hidden at
  // one exact distance). Anything mid-combat, fleeing, mid-attack, or already
  // otherwise excluded (bandits, companions, knocked down, retreating) stays
  // fully visible regardless of distance — see canHide.
  const HIDE_TILES = 28; // Removes calm, distant wildlife from scene rendering and visual-rig updates.
  const SHOW_TILES = 24; // Nearer wake boundary so wildlife does not flicker visible/hidden at one distance.

  function canHide(c) {
    if (c.isBandit || c.isCompanion || c.prone || c._branchDefense || (c.knockbackT || 0) > 0 || (c.retreatT || 0) > 0) return false;
    if (c.state === 'chase' || c.state === 'searching' || c.state === 'patrol-chase' || c.state === 'return' || c.state === 'fleeing-low-health') return false;
    if (window.Combat?.telegraph?.isBusy(c) || window.Combat?.animalAttacks?.isBusy(c)) return false;
    return true;
  }

  // Called once per hostile per updateHostiles pass with its current distance
  // to the player (in tiles). Returns whether `c` is (now) LOD-hidden, same
  // as before extraction, so callers can gate their own AI-tick-rate
  // reduction (see FAR_WILDLIFE_AI_TICK_INTERVAL_S in game.js) on the result.
  function update(c, distanceTiles) {
    const eligible = canHide(c); // Keeps combatants, companions, and active movement states fully simulated and rendered.
    const shouldHide = eligible && window.EntityDistanceLod.isFar(!!c._wildlifeVisualLodHidden, distanceTiles, SHOW_TILES, HIDE_TILES);
    if (shouldHide === !!c._wildlifeVisualLodHidden) return shouldHide;
    c._wildlifeVisualLodHidden = shouldHide;
    if (c.avatarRef?.group) c.avatarRef.group.visible = !shouldHide && !c._denHidden;
    if (c.groundShadow) c.groundShadow.visible = !shouldHide;
    if (c._ringHud) c._ringHud.visible = !shouldHide;
    if (!shouldHide) c._wildlifeVisualLodJustWoke = true;
    return shouldHide;
  }

  window.WildlifeVisualLod = Object.freeze({ update, canHide, HIDE_TILES, SHOW_TILES });
})();
