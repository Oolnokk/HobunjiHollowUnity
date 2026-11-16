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
// refreshes are limited to nearby walkers (a five-tile radius), with slower
// updates outside conversational distance and one NPC composite in flight.
// The player's refresh has its own independent slot.
//
// game.js calls init(deps) once and tickNpc/tickPlayer from its frame loop.
(() => {
  'use strict';

  if (window.WorldPortraitLife) return;

  let deps = null;
  let playerLifeT = 0;
  let playerLifePending = false;
  let npcLifePending = false; // Serializes nearby NPC composites so crowded festival stations cannot launch a batch together.
  const readyNpcQueue = []; // FIFO makes a crowd take turns instead of letting the first walker in the update loop monopolize expression rendering.
  const MAX_QUEUED_NPCS = 64; // Bounds transient walker references if a festival fills the visible radius faster than expressions can composite.
  let playerCombatFrown = false; // Tracks whether the player's world portrait should use the temporary combat frown expression.
  let playerCombatExpressionVersion = 0; // Incremented whenever combat expression intent changes so an older async breathing render cannot upload over the new face.
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
  const stats = { npcRefreshes: 0, npcUploads: 0, npcStaleSkips: 0, npcDistanceSkips: 0, npcBudgetSkips: 0, playerRefreshes: 0, playerCombatExpressionChanges: 0, playerCombatCacheBuilds: 0, playerCombatCacheApplies: 0 }; // Existing on-demand snapshot includes crowd throttling without per-frame logging.

  function init(injectedDeps) { deps = injectedDeps; }

  function config() {
    const cfg = window.SCRATCHBONES_CONFIG?.game?.portrait?.worldLife || {};
    const num = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
    const farTiles = Math.min(5, Math.max(0, num(cfg.farTiles, 5))); // Nearby faces are visible while walking; cap old 12/24-tile overrides to avoid remote NPC recomposition.
    return {
      enabled: cfg.enabled !== false,
      intervalS: Math.max(0.016, num(cfg.intervalS, 0.16)),
      nearTiles: Math.min(farTiles, Math.max(0, num(cfg.nearTiles, 2))), // Conversational-distance NPCs blink at the ordinary cadence.
      farTiles,
      midIntervalMul: Math.max(1, num(cfg.midIntervalMul, 4)), // Peripheral NPCs use a quarter the refresh frequency.
    };
  }

  function tickNpc(walker, dt) {
    const cfg = config();
    if (!deps || !cfg.enabled || !walker || walker.area !== deps.getCurrentArea()) return; // No work for walkers outside the player's scene.
    if (walker._portraitLifePending || !walker.avatarGroup?.userData?.frontTexture || walker.avatarGroup.userData.namedAnimalNpc
        || !walker.avatarFrontCanvas || !walker.profile) return; // Named animals animate a different visible creature plane; their hidden NPC portrait must not use the nearby face budget.
    walker._portraitLifeT = (walker._portraitLifeT || 0) + dt;

    let interval = cfg.intervalS;
    const pos = walker.root?.position;
    const playerTile = deps.getPlayerTile();
    if (!pos || !playerTile || !Number.isFinite(pos.x) || !Number.isFinite(pos.z)
        || !Number.isFinite(playerTile.x) || !Number.isFinite(playerTile.y)) return;
    const distanceSquared = (pos.x - playerTile.x) ** 2 + (pos.z - playerTile.y) ** 2; // No square root or geometry rebuild for the proximity check.
    if (distanceSquared > cfg.farTiles ** 2) { stats.npcDistanceSkips++; return; }
    if (window.DialogueContent?.ownsWorldPortrait?.(walker)) return; // The dialogue compositor already animates the same real portrait.
    if (distanceSquared > cfg.nearTiles ** 2) interval *= cfg.midIntervalMul;
    if (walker._portraitLifeT < interval) return;
    if (!walker._portraitLifeQueued && readyNpcQueue.length < MAX_QUEUED_NPCS) {
      walker._portraitLifeQueued = true;
      readyNpcQueue.push(walker);
    }
    if (npcLifePending) { stats.npcBudgetSkips++; return; }
    let nextWalker = null; // Only launch an eligible queued walker; old area/outfit/visibility entries cannot block the queue.
    while (readyNpcQueue.length) {
      const candidate = readyNpcQueue.shift();
      candidate._portraitLifeQueued = false;
      const candidatePos = candidate.root?.position;
      const candidatePlayer = deps.getPlayerTile();
      if (candidate.area === deps.getCurrentArea() && !candidate._portraitLifePending
          && candidate.avatarGroup?.userData?.frontTexture && !candidate.avatarGroup.userData.namedAnimalNpc
          && !window.DialogueContent?.ownsWorldPortrait?.(candidate) && candidate.avatarFrontCanvas && candidate.profile
          && candidatePos && candidatePlayer
          && Number.isFinite(candidatePos.x) && Number.isFinite(candidatePos.z)
          && Number.isFinite(candidatePlayer.x) && Number.isFinite(candidatePlayer.y)
          && (candidatePos.x - candidatePlayer.x) ** 2 + (candidatePos.z - candidatePlayer.y) ** 2 <= cfg.farTiles ** 2) {
        nextWalker = candidate;
        break;
      }
    }
    if (!nextWalker) return;
    walker = nextWalker;
    const composer = window.portraitBreathingComposer;
    if (!composer || !window.NpcAvatarPreview || !window.PNGPlaneAvatar) return;
    const seatId = window.DialogueContent?.dialogueSeatId(walker) || walker.rec?.id || walker.rec?.name || 'npc';
    if (!walker._portraitLifeExpressionSet) {
      composer.setDefaultExpression(seatId, window.DialogueContent?.npcRestingExpression?.(walker.rec) || walker.profile.restingExpression || null);
      walker._portraitLifeExpressionSet = true;
    }
    if (!Number.isFinite(walker._portraitLifePhaseOffsetMs)) walker._portraitLifePhaseOffsetMs = deps.rnd() * 4000; // Different NPCs blink out of phase.

    const liveCanvas = walker.avatarFrontCanvas; // The actual in-world portrait source, not the dialogue UI or a second mesh.
    const liveGroup = walker.avatarGroup; // Reject async results if the NPC avatar is rebuilt or unloaded before completion.
    const liveProfile = walker.profile; // Outfit changes create a new profile; never restore an older face/clothing composite.
    const startingExpression = composer.getExpression?.(seatId); // A newer dialogue/emote expression must win over this in-flight render.
    walker._portraitLifeT = 0;
    walker._portraitLifePending = true;
    npcLifePending = true;
    stats.npcRefreshes++;
    try {
      const scratch = document.createElement('canvas'); // Render offscreen so an async asset load cannot partly overwrite the live portrait.
      scratch.width = liveCanvas.width;
      scratch.height = liveCanvas.height;
      Promise.resolve(window.NpcAvatarPreview.renderProfileToCanvas(scratch, liveProfile, {
        breathingComposer: composer, seatId, breathingPhaseOffsetMs: walker._portraitLifePhaseOffsetMs,
      })).then(rendered => {
        const currentPos = walker.root?.position;
        const currentPlayer = deps.getPlayerTile();
        const currentRadius = config().farTiles;
        if (rendered === false || walker.avatarGroup !== liveGroup || walker.avatarFrontCanvas !== liveCanvas
            || walker.profile !== liveProfile || walker.area !== deps.getCurrentArea()
            || liveGroup.userData.namedAnimalNpc || window.DialogueContent?.ownsWorldPortrait?.(walker)
            || !liveGroup?.userData?.frontTexture || !currentPos || !currentPlayer
            || !Number.isFinite(currentPos.x) || !Number.isFinite(currentPos.z)
            || !Number.isFinite(currentPlayer.x) || !Number.isFinite(currentPlayer.y)
            || (currentPos.x - currentPlayer.x) ** 2 + (currentPos.z - currentPlayer.y) ** 2 > currentRadius ** 2
            || composer.getExpression?.(seatId) !== startingExpression) {
          stats.npcStaleSkips++;
          return;
        }
        if (copyPortraitCanvas(liveCanvas, scratch)
            && window.PNGPlaneAvatar.refreshSinglePlaneAvatarModel(liveGroup, liveCanvas)) stats.npcUploads++;
      }).catch(() => {}).finally(() => { walker._portraitLifePending = false; npcLifePending = false; });
    } catch (_) { walker._portraitLifePending = false; npcLifePending = false; }
  }

  function copyPortraitCanvas(target, source) {
    if (!target?.getContext || !source) return false;
    const ctx = target.getContext('2d'); // Full-canvas copy keeps clothing, dyes, face, and current authored portrait composition intact.
    ctx.clearRect(0, 0, target.width, target.height);
    ctx.drawImage(source, 0, 0, target.width, target.height);
    return true;
  }

  function applyCachedPlayerCombatFrown(avatar) {
    if (!playerCombatFrown || !avatar || avatar.group?.userData?.maskboundHeadHidden || avatar.generation !== playerCombatFrownCacheGeneration || !playerCombatFrownCache) return false;
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
    if (!avatar.group?.userData?.frontTexture || avatar.group?.userData?.maskboundHeadHidden || !avatar.frontCanvas || !avatar.profile) return;
    ensurePlayerCombatFrownCache(avatar); // Warm the current outfit/species frown before combat so the first dodge/lunge ghost can carry it synchronously.
    if (!cfg.enabled || playerLifePending) return;
    playerLifeT += dt;
    if (playerLifeT < cfg.intervalS) return;
    playerLifeT = 0;
    const composer = window.portraitBreathingComposer;
    if (!composer || !window.NpcAvatarPreview || !window.PNGPlaneAvatar) return;
    const generation = avatar.generation; // A gear/cosmetic refresh mid-flight replaces the avatar; stale results are dropped below.
    const expressionVersion = playerCombatExpressionVersion; // Paired with this render so a combat-state change can invalidate its eventual texture upload.
    playerLifePending = true;
    stats.playerRefreshes++;
    window.NpcAvatarPreview.renderProfileToCanvas(avatar.frontCanvas, avatar.profile, {
      breathingComposer: composer, seatId: 'player',
    }).then(() => {
      const current = deps.getPlayerAvatar();
      if (generation !== current.generation || expressionVersion !== playerCombatExpressionVersion || current.group?.userData?.maskboundHeadHidden) return; // Stale neutral/frown canvas must never upload after combat state has flipped.
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
    playerCombatExpressionVersion += 1;
    playerCombatExpressionApplied = false;
    if (next) composer.setExpression?.('player', 'frown', COMBAT_EXPRESSION_DURATION_MS);
    else composer.clearExpression?.('player');
    stats.playerCombatExpressionChanges++;
    if (avatar) {
      ensurePlayerCombatFrownCache(avatar);
      if (next) applyCachedPlayerCombatFrown(avatar); // Ready cache makes the live player frown synchronous before Combat.update samples a ghost this frame.
    }
    playerLifeT = Infinity; // Normal portrait-life render still follows so breathing/blinking continue with the correct expression.
    if (!config().enabled) renderPlayerExpressionOnce(avatar); // Portrait life is off, so tickPlayer will never repaint; restore/apply the face with one static render.
    else if (!playerLifePending) tickPlayer(0);
    return true;
  }

  function renderPlayerExpressionOnce(avatar) {
    if (!avatar?.frontCanvas || !avatar.profile || !window.NpcAvatarPreview || !window.PNGPlaneAvatar) return;
    const generation = avatar.generation;
    const expressionVersion = playerCombatExpressionVersion;
    const scratch = document.createElement('canvas'); // Detached so a stale render never partially overwrites the live texture.
    scratch.width = avatar.frontCanvas.width;
    scratch.height = avatar.frontCanvas.height;
    window.NpcAvatarPreview.renderProfileToCanvas(scratch, avatar.profile, {
      forceEyesOpen: true,
      ...(playerCombatFrown ? { breathingComposer: COMBAT_FROWN_COMPOSER, seatId: 'player-combat-frown-cache' } : {}),
    }).then(() => {
      const current = deps?.getPlayerAvatar?.();
      if (!current || current.group?.userData?.maskboundHeadHidden || current.generation !== generation || expressionVersion !== playerCombatExpressionVersion) return;
      if (!copyPortraitCanvas(current.frontCanvas, scratch)) return;
      window.PNGPlaneAvatar.refreshSinglePlaneAvatarModel(current.group, current.frontCanvas);
      if (playerCombatFrown) playerCombatExpressionApplied = true;
    }).catch(() => {});
  }

  window.WorldPortraitLife = {
    init,
    config,
    tickNpc,
    tickPlayer,
    setPlayerCombatExpression,
    getPlayerAvatar: () => deps?.getPlayerAvatar?.() || null, // Canonical live player portrait/profile for composite grapples; no clone of game.js state.
    isPlayerCombatExpressionApplied: () => !playerCombatFrown || playerCombatExpressionApplied,
    snapshot: () => ({ ...stats, npcLifePending, npcQueueLength: readyNpcQueue.length, playerCombatFrown, playerCombatExpressionVersion, playerCombatExpressionApplied, playerCombatFrownCacheGeneration, playerCombatFrownCacheReady: !!playerCombatFrownCache, config: config() }),
  };
})();
