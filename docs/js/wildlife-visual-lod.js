(() => {
  'use strict';
  const HIDE_TILES = 18; // Default release boundary; configured beside wake distance in scratchbones-config.js.
  const SHOW_TILES = 14; // Calm data-tracked wildlife becomes a real character within this radius.
  const STORAGE_KEY = 'hobunjiWildlifeWakeTiles'; // Settings override persists on mobile without DevTools.
  let wakeOverride = null; // Optional player-selected distance used by Settings and diagnostics.
  let deps = null; // Canonical game.js visual builders injected once; this module owns promotion/retirement decisions.
  let promotionsRemaining = 1; // Per-gameLoop allowance for calm actors; active combat bypasses it.
  let promotions = 0, retirements = 0; // On-demand mobile diagnostics, never scene traversals.
  try { const n = Number(localStorage.getItem(STORAGE_KEY)); if (n >= 8 && n <= 64) wakeOverride = n; } catch (_) {}
  function config() { return window.SCRATCHBONES_CONFIG?.game?.wildlifeStreaming || {}; }
  function wakeRadius() { return wakeOverride ?? Math.max(8, Math.min(64, Number(config().wakeRadiusTiles) || SHOW_TILES)); }
  function releaseRadius() { return Math.max(wakeRadius() + 4, Number(config().releaseRadiusTiles) || HIDE_TILES); }
  function setWakeRadius(value) {
    const n = Number(value); // Reject invalid input rather than silently disabling wildlife rendering.
    if (!Number.isFinite(n) || n < 8 || n > 64) return false;
    wakeOverride = n;
    try { localStorage.setItem(STORAGE_KEY, String(n)); } catch (_) {}
    return true;
  }
  function canHide(c) {
    if (c.health <= 0 || c.isBandit || c.isCompanion || c.prone || c._branchDefense || (c.knockbackT || 0) > 0 || (c.retreatT || 0) > 0) return false;
    if (c.state === 'chase' || c.state === 'searching' || c.state === 'patrol-chase' || c.state === 'return' || c.state === 'fleeing-low-health') return false;
    if (window.Combat?.telegraph?.isBusy(c) || window.Combat?.animalAttacks?.isBusy(c)) return false;
    return true;
  }
  function update(c, distanceTiles) {
    const eligible = canHide(c); // Companions, combat, corpses, and hit reactions always retain usable visuals.
    let shouldHide = eligible && window.EntityDistanceLod.isFar(!!c._wildlifeVisualLodHidden, distanceTiles, wakeRadius(), releaseRadius());
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
    update, canHide, setWakeRadius, wakeRadius, releaseRadius, HIDE_TILES, SHOW_TILES,
    snapshot: () => ({ wakeRadiusTiles: wakeRadius(), releaseRadiusTiles: releaseRadius(), promotions, retirements, promotionsPerFrame: Number(config().promotionsPerFrame) || 1 }),
  });
})();
