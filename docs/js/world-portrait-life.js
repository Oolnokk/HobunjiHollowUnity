// World-space blink/breathing/default-expression for walking avatars,
// extracted from game.js.
//
// The dialogue/cutscene portrait canvas re-renders periodically with the
// breathing composer so it blinks/breathes and shows each NPC's authored
// restingExpression. makeNpcWalker/refreshPlayerAvatar only bake one static
// forceEyesOpen texture at spawn/gear-change, so this applies the same
// periodic-recompose idea (the cheap refreshSinglePlaneAvatarModel
// texture-only path, not a geometry rebuild) to NPC walkers and the player,
// at a coarser interval than dialogue's 120ms since many NPCs can be on
// screen at once -- and only the player's current area's walkers pay it.
//
// Each recompose is a full portrait composite plus a texture upload, so NPC
// refreshes also scale with distance from the player: full rate nearby,
// a slower rate at mid range, and none beyond farTiles (where a few-pixel
// sprite's breathing/blinking can't be seen; it resumes on approach).
//
// game.js calls init(deps) once and tickNpc/tickPlayer from its frame loop.
(() => {
  'use strict';

  if (window.WorldPortraitLife) return;

  let deps = null;
  let playerLifeT = 0;
  let playerLifePending = false;
  let playerCombatFrown = false; // Tracks whether the player's world portrait should use the temporary combat frown expression.
  let playerCombatExpressionApplied = false; // True only after the current player avatar's live texture actually contains the combat frown.
  let playerCombatFrownCache = null; // Current-generation pre-rendered frown canvas used to make combat entry synchronous when possible.
  let playerCombatFrownCachePromise = null; // In-flight cache render for the current avatar generation; prevents duplicate portrait renders every frame.
  let playerCombatFrownCacheGeneration = null; // Avatar generation paired with playerCombatFrownCache/playerCombatFrownCachePromise.
  const COMBAT_EXPRESSION_DURATION_MS = 86400000; // Long-lived temporary expression duration; combat exit clears it explicitly instead of relying on expiry.
  const COMBAT_FROWN_COMPOSER = Object.freeze({ // Static pre-bake composer; avoids mutating the live dialogue/breathing expression state while warming the combat cache.
    getExpression: () => 'frown',
    getInterpolatedPoints: () => null,
    getOverlayOnlyPoints: () => null,
    getAnimData: () => null,
  });
  const stats = { npcRefreshes: 0, npcDistanceSkips: 0, playerRefreshes: 0, playerCombatExpressionChanges: 0, playerCombatCacheBuilds: 0, playerCombatCacheApplies: 0 };

  function init(injectedDeps) { deps = injectedDeps; }

  function config() {
    const cfg = window.SCRATCHBONES_CONFIG?.game?.portrait?.worldLife || {};
    const num = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
    return {
      enabled: cfg.enabled !== false,
      intervalS: num(cfg.intervalS, 0.16),
      nearTiles: num(cfg.nearTiles, 12), // Full-rate refresh radius around the player.
      farTiles: num(cfg.farTiles, 24), // No refresh beyond this; resumes once the player is closer.
      midIntervalMul: num(cfg.midIntervalMul, 3), // Interval multiplier between nearTiles and farTiles.
    };
  }

  function tickNpc(walker, dt) {
    const cfg = config();
    if (!deps || !cfg.enabled || walker.area !== deps.getCurrentArea()) return; // Only the player's current scene pays this cost.
    if (walker._portraitLifePending || !walker.avatarGroup?.userData?.frontTexture) return;
    walker._portraitLifeT = (walker._portraitLifeT || 0) + dt;

    let interval = cfg.intervalS;
    const pos = walker.root?.position;
    const playerTile = deps.getPlayerTile();
    if (pos && playerTile) {
      const distance = Math.hypot(pos.x - playerTile.x, pos.z - playerTile.y);
      if (distance > cfg.farTiles) { stats.npcDistanceSkips++; return; }
      if (distance > cfg.nearTiles) interval *= cfg.midIntervalMul;
    }
    if (walker._portraitLifeT < interval) return;
    walker._portraitLifeT = 0;

    const composer = window.portraitBreathingComposer;
    if (!composer || !window.NpcAvatarPreview || !window.PNGPlaneAvatar) return;
    const seatId = window.DialogueContent?.dialogueSeatId(walker) || walker.rec?.id || walker.rec?.name || 'npc';
    if (!walker._portraitLifeExpressionSet) {
      // The NPC's own authored default expression (dialogue-content.js's
      // npcRestingExpression) applies here too, so a walking NPC shows the
      // same resting face dialogue gives them. Set once per walker (this
      // seatId is stable for its whole lifetime) rather than every tick.
      composer.setDefaultExpression(seatId, window.DialogueContent?.npcRestingExpression?.(walker.rec) || null);
      walker._portraitLifeExpressionSet = true;
    }
    if (!Number.isFinite(walker._portraitLifePhaseOffsetMs)) walker._portraitLifePhaseOffsetMs = deps.rnd() * 4000; // Desyncs breathing between simultaneous NPCs.
    walker._portraitLifePending = true;
    stats.npcRefreshes++;
    window.NpcAvatarPreview.renderProfileToCanvas(walker.avatarFrontCanvas, walker.profile, {
      breathingComposer: composer, seatId, breathingPhaseOffsetMs: walker._portraitLifePhaseOffsetMs,
    }).then(() => {
      window.PNGPlaneAvatar.refreshSinglePlaneAvatarModel(walker.avatarGroup, walker.avatarFrontCanvas);
    }).catch(() => {}).finally(() => { walker._portraitLifePending = false; });
  }

  function copyPortraitCanvas(target, source) {
    if (!target?.getContext || !source) return false;
    const ctx = target.getContext('2d'); // Full-canvas copy keeps clothing, dyes, face, and current authored portrait composition intact.
    ctx.clearRect(0, 0, target.width, target.height);
    ctx.drawImage(source, 0, 0, target.width, target.height);
    return true;
  }

  function applyCachedPlayerCombatFrown(avatar) {
    if (!playerCombatFrown || !avatar || avatar.generation !== playerCombatFrownCacheGeneration || !playerCombatFrownCache) return false;
    if (!copyPortraitCanvas(avatar.frontCanvas, playerCombatFrownCache)) return false;
    if (!window.PNGPlaneAvatar?.refreshSinglePlaneAvatarModel?.(avatar.group, avatar.frontCanvas)) return false;
    playerCombatExpressionApplied = true;
    stats.playerCombatCacheApplies++;
    return true;
  }

  function ensurePlayerCombatFrownCache(avatar) {
    if (!avatar?.frontCanvas || !avatar?.profile || !window.NpcAvatarPreview) return null;
    const generation = avatar.generation;
    if (playerCombatFrownCacheGeneration === generation && playerCombatFrownCache) return playerCombatFrownCache;
    if (playerCombatFrownCacheGeneration === generation && playerCombatFrownCachePromise) return null;

    playerCombatFrownCacheGeneration = generation;
    playerCombatFrownCache = null;
    playerCombatExpressionApplied = false;
    const scratch = document.createElement('canvas'); // Detached scratch means async portrait loads can never partially overwrite the live player texture.
    scratch.width = avatar.frontCanvas.width;
    scratch.height = avatar.frontCanvas.height;
    stats.playerCombatCacheBuilds++;
    playerCombatFrownCachePromise = window.NpcAvatarPreview.renderProfileToCanvas(scratch, avatar.profile, {
      forceEyesOpen: true,
      breathingComposer: COMBAT_FROWN_COMPOSER,
      seatId: 'player-combat-frown-cache',
    }).then(() => {
      const current = deps?.getPlayerAvatar?.();
      if (!current || current.generation !== generation || playerCombatFrownCacheGeneration !== generation) return null;
      playerCombatFrownCache = scratch;
      playerCombatFrownCachePromise = null;
      if (playerCombatFrown) applyCachedPlayerCombatFrown(current); // Combat may have begun while the cache was rendering; apply before the next afterimage sample.
      return scratch;
    }).catch(() => {
      if (playerCombatFrownCacheGeneration === generation) playerCombatFrownCachePromise = null;
      return null;
    });
    return null;
  }

  function tickPlayer(dt) {
    const cfg = config();
    if (!deps) return;
    const avatar = deps.getPlayerAvatar();
    if (!avatar.group?.userData?.frontTexture || !avatar.frontCanvas || !avatar.profile) return;
    ensurePlayerCombatFrownCache(avatar); // Warm the current outfit/species frown before combat so the first dodge/lunge ghost can carry it synchronously.
    if (!cfg.enabled || playerLifePending) return;
    playerLifeT += dt;
    if (playerLifeT < cfg.intervalS) return;
    playerLifeT = 0;
    const composer = window.portraitBreathingComposer;
    if (!composer || !window.NpcAvatarPreview || !window.PNGPlaneAvatar) return;
    const generation = avatar.generation; // A gear/cosmetic refresh mid-flight replaces the avatar; stale results are dropped below.
    playerLifePending = true;
    stats.playerRefreshes++;
    window.NpcAvatarPreview.renderProfileToCanvas(avatar.frontCanvas, avatar.profile, {
      breathingComposer: composer, seatId: 'player',
    }).then(() => {
      const current = deps.getPlayerAvatar();
      if (generation !== current.generation) return;
      window.PNGPlaneAvatar.refreshSinglePlaneAvatarModel(current.group, current.frontCanvas);
      if (playerCombatFrown) playerCombatExpressionApplied = true; // This completed render used the live composer, whose player seat is frowning during combat.
    }).catch(() => {}).finally(() => { playerLifePending = false; });
  }

  function setPlayerCombatExpression(active) {
    const next = !!active;
    const composer = window.portraitBreathingComposer;
    if (!composer || !deps) return false;
    const avatar = deps.getPlayerAvatar?.();
    if (playerCombatFrown === next) {
      if (next && !playerCombatExpressionApplied && avatar) {
        ensurePlayerCombatFrownCache(avatar);
        applyCachedPlayerCombatFrown(avatar);
      }
      return false;
    }
    playerCombatFrown = next;
    playerCombatExpressionApplied = false;
    if (next) composer.setExpression?.('player', 'frown', COMBAT_EXPRESSION_DURATION_MS);
    else composer.clearExpression?.('player');
    stats.playerCombatExpressionChanges++;
    if (avatar) {
      ensurePlayerCombatFrownCache(avatar);
      if (next) applyCachedPlayerCombatFrown(avatar); // Ready cache makes the live player frown synchronous before Combat.update samples a ghost this frame.
    }
    playerLifeT = Infinity; // Normal portrait-life render still follows so breathing/blinking continue with the correct expression.
    if (!playerLifePending) tickPlayer(0);
    return true;
  }

  window.WorldPortraitLife = {
    init,
    config,
    tickNpc,
    tickPlayer,
    setPlayerCombatExpression,
    isPlayerCombatExpressionApplied: () => !playerCombatFrown || playerCombatExpressionApplied,
    snapshot: () => ({ ...stats, playerCombatFrown, playerCombatExpressionApplied, playerCombatFrownCacheGeneration, playerCombatFrownCacheReady: !!playerCombatFrownCache, config: config() }),
  };
})();
