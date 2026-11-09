(() => {
  'use strict';
  const HIDE_TILES = 18; // Default release boundary; configured beside wake distance in scratchbones-config.js.
  const SHOW_TILES = 14; // Calm data-tracked wildlife becomes a real character within this radius.
  const STORAGE_KEY = 'hobunjiWildlifeWakeTiles'; // Settings override persists on mobile without DevTools.
  const COMBAT_STORAGE_KEY = 'hobunjiWildlifeCombatReleaseTiles'; // Separate persisted distance for fighting animals.
  const COMBAT_RELEASE_TILES = 32; // Default: a fight this far from the player goes back to data. Configured beside the wake distance.
  const COMBAT_HYSTERESIS_TILES = 4; // A fighter that went data-only must come this far inside the release radius to get its rig back.
  let wakeOverride = null; // Optional player-selected distance used by Settings and diagnostics.
  let combatOverride = null; // Optional player-selected distance at which fighting animals stop being visible.
  let deps = null; // Canonical game.js visual builders injected once; this module owns promotion/retirement decisions.
  let promotionsRemaining = 1; // Per-gameLoop allowance for calm actors; active combat bypasses it.
  let promotions = 0, retirements = 0; // On-demand mobile diagnostics, never scene traversals.
  try { const n = Number(localStorage.getItem(STORAGE_KEY)); if (n >= 8 && n <= 64) wakeOverride = n; } catch (_) {}
  try { const n = Number(localStorage.getItem(COMBAT_STORAGE_KEY)); if (n >= 12 && n <= 96) combatOverride = n; } catch (_) {}
  function config() { return window.SCRATCHBONES_CONFIG?.game?.wildlifeStreaming || {}; }
  function wakeRadius() { return wakeOverride ?? Math.max(8, Math.min(64, Number(config().wakeRadiusTiles) || SHOW_TILES)); }
  function releaseRadius() { return Math.max(wakeRadius() + 4, Number(config().releaseRadiusTiles) || HIDE_TILES); }
  // Fighting animals stay visible out to this wider radius instead of at any distance.
  function combatReleaseRadius() {
    const configured = combatOverride ?? (Number(config().combatReleaseRadiusTiles) || COMBAT_RELEASE_TILES);
    return Math.max(releaseRadius() + COMBAT_HYSTERESIS_TILES, Math.min(96, configured)); // Never tighter than the calm radii, so a fight can't hide sooner than idle wildlife.
  }
  function combatWakeRadius() { return combatReleaseRadius() - COMBAT_HYSTERESIS_TILES; }
  function setCombatReleaseRadius(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 12 || n > 96) return false;
    combatOverride = n;
    try { localStorage.setItem(COMBAT_STORAGE_KEY, String(n)); } catch (_) {}
    return true;
  }
  function setWakeRadius(value) {
    const n = Number(value); // Reject invalid input rather than silently disabling wildlife rendering.
    if (!Number.isFinite(n) || n < 8 || n > 64) return false;
    wakeOverride = n;
    try { localStorage.setItem(STORAGE_KEY, String(n)); } catch (_) {}
    return true;
  }
  // A settled wildlife corpse has no AI, combat or animation state left, so it
  // streams like any other far actor: data stays (position, loot, genes), the
  // rig is released, and the lying pose is restored when it is promoted again.
  // Dying bodies still need their rig for the fall; bandits, companions and
  // skeletons that revive after looting never stream.
  function isStreamableCorpse(c) {
    return c.state === 'corpse' && c.health <= 0 && !!c.streamVisuals && !c.isBandit && !c.isCompanion && !c.keepCorpseAfterLoot && !c.corpseLooted && !c.isAmphibiousFishCorpse;
  }
  // Conditions that always keep a live actor's rig, at any distance.
  function alwaysVisible(c) {
    if (c.isRuinSkeeri) return true; // Ruin Skeeri roost 20+ tiles from where you stand in the shaft: streaming them to data made the bomber invisible and unsensable.
    if ((c._tzFlight?.phase && c._tzFlight.phase !== 'perched')
      || c.tzatzulCarrying || c.tzatzulCapturedBy) return true; // Preserve distant spyglass views of original airborne prey.
    if (c.isBandit || c.isCompanion || c.prone || c._branchDefense || (c.knockbackT || 0) > 0 || (c.retreatT || 0) > 0) return true;
    if (window.Combat?.telegraph?.isBusy(c) || window.Combat?.animalAttacks?.isBusy(c)) return true; // Mid-swing: finish the attack before the rig can go.
    return false;
  }
  function isFighting(c) {
    return c.state === 'chase' || c.state === 'searching' || c.state === 'patrol-chase' || c.state === 'return' || c.state === 'fleeing-low-health';
  }
  // Calm actors hide at the ordinary wake/release radii.
  function canHide(c) {
    if (c.health <= 0) return !((c._tzFlight?.phase && c._tzFlight.phase !== 'perched') || c.tzatzulCarrying || c.tzatzulCapturedBy) && isStreamableCorpse(c);
    return !alwaysVisible(c) && !isFighting(c);
  }
  // Fighting actors hide only past the (larger) combat radii.
  function canHideWhileFighting(c) {
    return c.health > 0 && isFighting(c) && !alwaysVisible(c);
  }
  function update(c, distanceTiles) {
    const eligible = canHide(c); // Companions, mid-attack actors, corpses, and hit reactions always retain usable visuals.
    const fighting = !eligible && canHideWhileFighting(c); // A fight returns to data only beyond its own, wider distance.
    let shouldHide = eligible
      ? window.EntityDistanceLod.isFar(!!c._wildlifeVisualLodHidden, distanceTiles, wakeRadius(), releaseRadius())
      : fighting && window.EntityDistanceLod.isFar(!!c._wildlifeVisualLodHidden, distanceTiles, combatWakeRadius(), combatReleaseRadius());
    if (c.streamVisuals) {
      if (!shouldHide && c._wildlifeVisualsReleased) {
        if (eligible && promotionsRemaining <= 0) shouldHide = true; // Nearby characters arrive over successive frames instead of allocating all rigs at once.
        else if (deps?.createVisuals) {
          deps.createVisuals(c);
          promotionsRemaining--;
          promotions++;
        }
      }
      if (shouldHide) {
        c._wildlifeDormantSinceMs ??= performance.now();
        const graceMs = Math.max(0, Number(config().releaseDelaySeconds) || 0) * 1000; // Optional anti-thrash grace before actual rig disposal.
        if (!c._wildlifeVisualsReleased && performance.now() - c._wildlifeDormantSinceMs >= graceMs && deps?.releaseVisuals) {
          deps.releaseVisuals(c);
          retirements++;
        }
      } else c._wildlifeDormantSinceMs = null;
    }
    if (shouldHide === !!c._wildlifeVisualLodHidden) return shouldHide;
    c._wildlifeVisualLodHidden = shouldHide;
    if (c.avatarRef?.group) c.avatarRef.group.visible = !shouldHide && !c._denHidden;
    if (c.groundShadow) c.groundShadow.visible = !shouldHide;
    if (c._ringHud) c._ringHud.visible = !shouldHide;
    if (!shouldHide) c._wildlifeVisualLodJustWoke = true;
    return shouldHide;
  }
  window.WildlifeVisualLod = Object.freeze({
    init: injected => { deps = injected; },
    beginFrame: () => { promotionsRemaining = Math.max(1, Math.min(8, Number(config().promotionsPerFrame) || 1)); },
    update, canHide, canHideWhileFighting, isStreamableCorpse, setWakeRadius, wakeRadius, releaseRadius, setCombatReleaseRadius, combatReleaseRadius, HIDE_TILES, SHOW_TILES,
    snapshot: () => ({ wakeRadiusTiles: wakeRadius(), releaseRadiusTiles: releaseRadius(), combatReleaseRadiusTiles: combatReleaseRadius(), promotions, retirements, promotionsPerFrame: Number(config().promotionsPerFrame) || 1 }),
  });
})();
