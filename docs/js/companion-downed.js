// Downed state for the player's animal companion.
//
// A companion whose Health reaches zero is no longer killed (no corpse, no
// instant respawn beside its master): it goes DOWN and stays where it fell
// until one of these happens:
//   * its auto-revive timer runs out (60 s base, shortened by Quick Rally) and
//     it reappears at its master's side;
//   * someone holds Interact on it (js/corpse-hold-loot.js drives the timer;
//     Heel to Master / Rallying Presence shorten it) and it gets up in place;
//   * the owner respawns after dying, uses Return to Camp / Return to Farm, or
//     holds Interact on a Root Totem, which revives it and brings it to them.
//
// Downed state is keyed by the Stable entry id, not the live actor, so it
// survives area changes (a respawned actor is put straight back down) and the
// timer keeps running while the companion is not in the current area.
(() => {
  'use strict';

  const CONFIG = Object.freeze({
    autoReviveSeconds: 60,       // Base wait before a downed companion gets up by itself.
    reviveHoldSeconds: 4,        // Base held-Interact duration on the companion.
    totemHoldSeconds: 3,         // Base held-Interact duration on a Root Totem (also teleports the pet).
    reviveHealthFraction: 0.5,   // Health fraction restored on any revive.
    reviveReachTiles: 2.4,       // How close the reviver must be to the companion.
    totemReachTiles: 3,          // How close the reviver must be to a Root Totem.
    aimSlackTiles: 1.6,          // Reticle slack around the companion/totem, like the corpse hold lookup.
    downedScaleY: 0.42,          // Flattened "lying down" squash reused from the attack-crouch renderer.
    reviveInvulnSeconds: 1.5,
  });

  const downed = new Map(); // stableId -> { remainingS, totalS, name }
  let deps = null; // { player, companionObjects, getCurrentArea, TILE, showToast, updateCreatureMesh, updateCreatureAnimFrame, canOccupyAt, getRootTotems }
  let hud = null; // { root, text } created lazily.
  let hudText = ''; // Last HUD string written, so idle frames make no DOM writes.
  let lastEvent = null; // Diagnostics.

  function init(injected) { deps = injected; }

  function resilience() { return window.CompanionResilience || null; }
  function progression() { return window.StableAnimalProgression || null; }

  function isPlayerCompanion(actor) {
    if (!actor?.isCompanion || actor.stableRole !== 'companion' || actor.banditCompanion === true) return false;
    return !deps || (actor.master || deps.player) === deps.player;
  }

  function stableIdFor(actor) {
    return actor?.stableId || null;
  }

  function entryFor(stableId) {
    return stableId ? progression()?.findStableEntry?.(stableId) || null : null;
  }

  function displayName(actor, stableId) {
    return actor?.name || entryFor(stableId)?.name || 'Your companion';
  }

  function isDowned(actor) {
    return !!actor?._downed;
  }

  function hasDowned() { return downed.size > 0; }

  function effectiveMaxHealth(actor) {
    const max = window.ResourceSystem?.getEffectiveMax?.(actor, 'health');
    return Number.isFinite(max) && max > 0 ? max : Math.max(1, Number(actor?.maxHealth) || 1);
  }

  function liveDownedActors() {
    const out = [];
    if (!deps) return out;
    const area = deps.getCurrentArea();
    for (const actor of deps.companionObjects) {
      if (!actor._downed || !isPlayerCompanion(actor)) continue;
      if (actor.areaId && actor.areaId !== area) continue;
      out.push(actor);
    }
    return out;
  }

  function applyDownedPose(actor) {
    actor._downed = true;
    actor.health = 0;
    actor.vx = 0; actor.vy = 0;
    actor.knockbackT = 0; actor.prone = false;
    actor.state = 'idle';
    actor.treasureCue = null; actor.watchPlayerIdle = false;
    actor.scaleY = CONFIG.downedScaleY;
    window.Combat?.telegraph?.cancel?.(actor);
    window.Combat?.animalAttacks?.cancel?.(actor);
    window.Combat?.cancelStagedForAttacker?.(actor);
    window.AnimalVocalizations?.stopCreature?.(actor);
  }

  // Called from transitionCreatureToDeath for every lethal creature hit/tick.
  // Returns true when the creature was a player companion and is now downed
  // (the caller must skip the corpse/loot/kill-reward path).
  function tryDown(actor) {
    if (!deps || !isPlayerCompanion(actor)) return false;
    const stableId = stableIdFor(actor);
    if (!stableId) return false; // An unidentified companion cannot be tracked, so it dies the old way.
    if (actor._downed) return true;
    const entry = entryFor(stableId);
    const total = CONFIG.autoReviveSeconds * (resilience()?.autoReviveMultiplier?.(entry) ?? 1);
    downed.set(stableId, { remainingS: total, totalS: total, name: displayName(actor, stableId) });
    applyDownedPose(actor);
    lastEvent = { type: 'down', stableId, at: Date.now() };
    deps.showToast?.(`🐾 ${displayName(actor, stableId)} is down! Hold Interact beside them to revive (or they rally in ${Math.round(total)}s).`, false);
    return true;
  }

  // Called by syncCompanionFromWhistle for each freshly built companion actor.
  function onCompanionSpawned(actor) {
    const stableId = stableIdFor(actor);
    if (stableId && downed.has(stableId) && isPlayerCompanion(actor)) applyDownedPose(actor);
  }

  function spawnOffsetNearMaster(actor) {
    const master = actor.master || deps.player;
    const T = deps.TILE;
    const base = (Number(master.angle) || 0) + Math.PI;
    for (const turn of [0, 0.9, -0.9, 1.8, -1.8, Math.PI]) {
      const angle = base + turn;
      const x = master.x + Math.cos(angle) * T * 1.4, y = master.y + Math.sin(angle) * T * 1.4;
      if (!deps.canOccupyAt || deps.canOccupyAt(x, y, T * 0.32)) return { x, y };
    }
    return { x: master.x, y: master.y };
  }

  function standUp(actor, { teleport, healthFraction }) {
    delete actor._downed;
    actor.scaleY = 1;
    actor.health = Math.max(1, Math.round(effectiveMaxHealth(actor) * healthFraction));
    actor.invulnUntil = performance.now() + CONFIG.reviveInvulnSeconds * 1000;
    actor.retreatT = 0;
    actor._stage = null;
    actor._deathTransitionStarted = false;
    if (teleport) {
      const spot = spawnOffsetNearMaster(actor);
      actor.x = spot.x; actor.y = spot.y; actor.homeX = spot.x; actor.homeY = spot.y;
    }
  }

  // Revives one companion by Stable id. teleport: true brings it to its master
  // now; 'deferred' waits for the next frame (used when the owner is about to
  // be moved by a respawn/teleport that has not finished yet).
  function revive(stableId, opts = {}) {
    const healthFraction = Number.isFinite(opts.healthFraction) ? opts.healthFraction : CONFIG.reviveHealthFraction;
    const wasDowned = downed.delete(stableId);
    if (!wasDowned) return false;
    let actor = null;
    for (const candidate of deps?.companionObjects || []) {
      if (candidate._downed && candidate.stableId === stableId) { actor = candidate; break; }
    }
    if (actor) {
      standUp(actor, { teleport: opts.teleport === true, healthFraction });
      if (opts.teleport === 'deferred') actor._reviveTeleportPending = true;
      if (!opts.silent) deps.showToast?.(`🐾 ${displayName(actor, stableId)} is back on their feet.`, true);
    }
    lastEvent = { type: 'revive', stableId, reason: opts.reason || 'manual', at: Date.now() };
    return true;
  }

  function reviveAll(opts = {}) {
    let count = 0;
    for (const stableId of [...downed.keys()]) if (revive(stableId, opts)) count++;
    return count;
  }

  // Held-revive duration for this companion from this reviver. `reviver`
  // defaults to the owner; any other value counts as "someone else".
  function holdSecondsFor(stableId, base, reviver) {
    const owner = deps?.player;
    const isOwner = !reviver || reviver === owner;
    return Math.max(0.25, base * (resilience()?.reviveHoldMultiplier?.(entryFor(stableId), isOwner) ?? 1));
  }

  function reticleNear(actorX, actorY, col, row, slackTiles) {
    const T = deps.TILE;
    return Math.hypot((col + 0.5) * T - actorX, (row + 0.5) * T - actorY) <= slackTiles * T;
  }

  function findAimedDownedCompanion(col, row) {
    const T = deps.TILE, player = deps.player;
    let best = null, bestDist = Infinity;
    for (const actor of liveDownedActors()) {
      const dist = Math.hypot(actor.x - player.x, actor.y - player.y);
      if (dist > CONFIG.reviveReachTiles * T || dist >= bestDist) continue;
      if (dist > T * 1.3 && !reticleNear(actor.x, actor.y, col, row, CONFIG.aimSlackTiles)) continue;
      best = actor; bestDist = dist;
    }
    return best;
  }

  function findAimedRootTotem(col, row) {
    if (!downed.size) return null;
    const T = deps.TILE, player = deps.player;
    let best = null, bestDist = Infinity;
    for (const totem of deps.getRootTotems?.() || []) {
      const cx = (totem.x + 0.5) * T, cy = (totem.y + 0.5) * T;
      const dist = Math.hypot(cx - player.x, cy - player.y);
      if (dist > CONFIG.totemReachTiles * T || dist >= bestDist) continue;
      if (dist > T * 1.6 && !reticleNear(cx, cy, col, row, CONFIG.aimSlackTiles + 0.4)) continue;
      best = totem; bestDist = dist;
    }
    return best;
  }

  function reviverCanAct() {
    return !!deps && window.PlayerDowned?.isDowned?.() !== true && (Number(deps.player?.health) || 0) > 0;
  }

  // Interact prompt offered through the shared hold action (corpse_hold_loot).
  function getHoldButton(col, row) {
    if (!deps || !downed.size || !reviverCanAct()) return null;
    const actor = findAimedDownedCompanion(col, row);
    if (actor) return { icon: '🐾', label: `Hold to Revive ${displayName(actor, actor.stableId)}`, action: 'corpse_hold_loot', style: 'primary', allowed: true, worldInteraction: true, promptRoot: actor.avatarRef?.group || null };
    if (findAimedRootTotem(col, row)) return { icon: '🌳', label: 'Hold to Call Companion', action: 'corpse_hold_loot', style: 'primary', allowed: true, worldInteraction: true, promptRoot: null };
    return null;
  }

  // Shaped like the world object corpse-hold-loot.js drives: it calls
  // onAction('obj_loot_corpse') once holdSeconds have elapsed.
  function getHoldTarget(col, row) {
    if (!deps || !downed.size || !reviverCanAct()) return null;
    const actor = findAimedDownedCompanion(col, row);
    if (actor) {
      const stableId = actor.stableId;
      return {
        id: `companion-revive:${stableId}`, type: 'companion_revive', promptRoot: actor.avatarRef?.group || null,
        holdSeconds: holdSecondsFor(stableId, CONFIG.reviveHoldSeconds), holdLabel: `Reviving ${displayName(actor, stableId)}...`,
        onAction: () => ({ ok: revive(stableId, { reason: 'hold-revive' }), message: '' }),
      };
    }
    const totem = findAimedRootTotem(col, row);
    if (!totem) return null;
    const stableId = [...downed.keys()][0];
    return {
      id: `companion-totem:${totem.x},${totem.y}`, type: 'companion_totem_revive', promptRoot: null,
      holdSeconds: holdSecondsFor(stableId, CONFIG.totemHoldSeconds), holdLabel: 'Calling your companion...',
      onAction: () => ({ ok: reviveAll({ reason: 'root-totem', teleport: true }) > 0, message: '' }),
    };
  }

  function hudEls() {
    if (hud || typeof document === 'undefined') return hud;
    const root = document.createElement('div');
    root.id = 'companionDownedHud';
    root.style.cssText = 'position:fixed;top:72px;left:50%;transform:translateX(-50%);z-index:60;padding:4px 12px;border-radius:14px;background:rgba(20,12,12,.78);color:#ffd9c9;border:1px solid rgba(255,140,110,.55);font:700 13px system-ui,sans-serif;pointer-events:none;display:none;';
    document.body?.appendChild(root);
    hud = { root };
    return hud;
  }

  function refreshHud() {
    let text = '';
    const active = progression()?.activeEntryForRole?.('companion');
    const record = active ? downed.get(active.id) : null;
    if (record) text = `🐾 ${record.name} is down — rallies in ${Math.max(0, Math.ceil(record.remainingS))}s`;
    if (text === hudText) return;
    hudText = text;
    const els = hudEls();
    if (!els) return;
    els.root.textContent = text;
    els.root.style.display = text ? 'block' : 'none';
  }

  function tickDowned(dt) {
    for (const [stableId, record] of [...downed]) {
      const isWhistle = String(stableId).startsWith('whistle:');
      if (!isWhistle && !entryFor(stableId)) { downed.delete(stableId); continue; } // Released from the Stable while down.
      record.remainingS -= dt;
      if (record.remainingS <= 0) revive(stableId, { reason: 'auto-revive', teleport: true });
    }
  }

  function tickActors(dt) {
    for (const actor of liveDownedActors()) {
      actor.vx = 0; actor.vy = 0;
      if (actor.scaleY !== CONFIG.downedScaleY) actor.scaleY = CONFIG.downedScaleY;
      deps.updateCreatureMesh?.(actor, dt, actor.facing || 0);
      deps.updateCreatureAnimFrame?.(actor, dt, false);
    }
    for (const actor of deps.companionObjects) {
      if (!actor._reviveTeleportPending) continue;
      actor._reviveTeleportPending = false;
      if (actor._downed) continue;
      const spot = spawnOffsetNearMaster(actor);
      actor.x = spot.x; actor.y = spot.y; actor.homeX = spot.x; actor.homeY = spot.y;
    }
  }

  // Once per un-paused frame, right after updateCompanions.
  function update(dt) {
    if (!deps) return;
    resilience()?.ensureRegistered?.();
    if (downed.size) tickDowned(dt);
    tickActors(dt);
    refreshHud();
  }

  window.CompanionDowned = Object.freeze({
    CONFIG,
    init,
    update,
    tryDown,
    onCompanionSpawned,
    isDowned,
    hasDowned,
    revive,
    reviveAll,
    getHoldButton,
    getHoldTarget,
    holdSecondsFor,
    debugSnapshot: () => ({ downed: [...downed].map(([id, record]) => ({ id, ...record })), lastEvent }),
  });
})();
