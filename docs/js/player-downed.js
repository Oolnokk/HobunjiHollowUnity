// Downed ("Second Wind") state for the player.
//
// Lethal combat damage no longer kills outright: the player goes DOWN with a
// bleed-out timer. While down they can still crawl (js/player-crawl.js: a
// left-side lean crawl pulled by the left arm) and use a ranged weapon, nothing
// else. If the player or the player's animal companion kills an
// enemy before the timer runs out, the player gets back up with half Health;
// otherwise they die through the normal respawn path.
//
// Hitting an enemy with a ranged weapon while down focuses the companion on
// that enemy (CompanionDowned / updateCompanions read getFocusTarget), and the
// Guardian Fury companion perk boosts the companion for as long as this state
// lasts (CompanionResilience reads isDowned).
//
// Only combat damage (damagePlayer) and damage-over-time ticks put the player
// down. Drowning, hazards and scripted deaths still call respawnPlayer directly.
(() => {
  'use strict';

  const CONFIG = Object.freeze({
    bleedOutSeconds: 30,        // Time to land a kill before dying.
    reviveHealthFraction: 0.5,  // Health restored by Second Wind.
    hitPenaltySeconds: 2,       // Bleed-out time lost per enemy hit taken while down.
    reviveInvulnSeconds: 1.5,
    killCreditWindowMs: 8000,   // A kill counts if the player/companion last hit the enemy this recently.
    downedHealth: 1,            // Health held while down so vitals never see a "dead" player.
  });
  const SOFT_DEATH_REASONS = new Set(['resource-tick']); // handlePlayerDeath reasons that go down instead of dying (bleeding/burning/poison).

  let deps = null; // { player, showToast, die, forceRangedTool }
  let state = null; // { remainingS, totalS, focus } while down.
  let hud = null; // { root, text, fill }
  let hudKey = ''; // Last HUD text + percent written, so idle frames make no DOM writes.
  let lastEvent = null; // Diagnostics.

  function init(injected) { deps = injected; }

  function isDowned() { return !!state; }

  function now() { return performance.now(); }

  function tryDown(reason = 'damage') {
    if (!deps) return false;
    if (state) return true;
    if (window.CombatTutorial?.active?.()) return false; // The tutorial has its own reset path in respawnPlayer.
    state = { remainingS: CONFIG.bleedOutSeconds, totalS: CONFIG.bleedOutSeconds, focus: null };
    window.PlayerCrawl?.setActive(true);
    const player = deps.player;
    player.health = CONFIG.downedHealth;
    player.vx = 0; player.vy = 0;
    player.invulnUntil = 0;
    window.Combat?.cancelAllStaged?.();
    window.BandageSystem?.cancel?.('downed');
    const ride = window.Mounts?.rideState;
    if (ride === 'mounted' || ride === 'rushingIn') window.Mounts.toggleMount(); // Starts the dismount; the player cannot ride while down.
    const hasRanged = deps.forceRangedTool?.() === true;
    lastEvent = { type: 'down', reason, hasRanged, at: Date.now() };
    deps.showToast?.(hasRanged
      ? '⚠️ You are down! Crawl and shoot — a kill by you or your companion gets you back up.'
      : '⚠️ You are down with no ranged weapon! Only your companion can save you.', false);
    return true;
  }

  // handlePlayerDeath hook (vitals ticks, scripted callers). True = handled.
  function interceptDeath(reason) {
    if (!deps) return false;
    if (state) { deps.player.health = CONFIG.downedHealth; return true; } // Bleeding while down never ends the state early.
    return SOFT_DEATH_REASONS.has(reason) ? tryDown(reason) : false;
  }

  function secondWind(reason) {
    if (!state) return false;
    const player = deps.player;
    const max = window.ResourceSystem?.getEffectiveMax?.(player, 'health') || player.maxHealth || 100;
    state = null;
    window.PlayerCrawl?.setActive(false);
    player.health = Math.max(1, Math.round(max * CONFIG.reviveHealthFraction));
    player.invulnUntil = now() + CONFIG.reviveInvulnSeconds * 1000;
    lastEvent = { type: 'second-wind', reason, at: Date.now() };
    deps.showToast?.('💨 Second Wind! You get back up.', true);
    refreshHud();
    return true;
  }

  function bleedOut() {
    if (!state) return;
    state = null;
    window.PlayerCrawl?.setActive(false);
    lastEvent = { type: 'bleed-out', at: Date.now() };
    refreshHud();
    deps.die?.('bleed-out');
  }

  // damagePlayer calls this instead of applying damage while down. Each enemy
  // hit costs bleed-out time but never Health, knockback or stagger.
  function noteHitWhileDowned() {
    if (!state) return;
    state.remainingS = Math.max(0, state.remainingS - CONFIG.hitPenaltySeconds);
  }

  // damageCreature calls this for every landed hit on a non-companion, whoever
  // struck it, so the last hitter is known. friendlyFire marks actor-on-actor
  // hits (bandit/tribe/lich/predator), which never count as the player's.
  function noteTeamHit(target, dmgOpts) {
    if (!target || target.isCompanion) return;
    const attacker = dmgOpts?.attacker;
    const fromCompanion = !!dmgOpts?.fromCompanion || (attacker?.isCompanion === true && (attacker.master || deps?.player) === deps?.player);
    const fromPlayer = attacker ? attacker === deps?.player : dmgOpts?.friendlyFire !== true;
    target._lastHitByTeam = fromCompanion || fromPlayer;
    if (fromCompanion || fromPlayer) target._teamHitAt = now();
    if (state && dmgOpts?.ranged && fromPlayer && target.health > 0 && target.def?.hostile !== false) state.focus = target;
  }

  // The player (or their companion) landed the last hit, recently enough to
  // own the kill. Another actor finishing the enemy off takes the credit.
  function isTeamKill(creature) {
    if (!creature || creature.isCompanion || creature._lastHitByTeam === false) return false;
    return now() - (Number(creature._teamHitAt) || -Infinity) <= CONFIG.killCreditWindowMs;
  }

  // transitionCreatureToDeath calls this for every non-companion death.
  function noteKill(creature) {
    if (!state || !creature || creature.isCompanion) return;
    if (creature.def?.hostile === false) return; // Passive wildlife is not an enemy.
    if (!isTeamKill(creature)) return;
    secondWind('kill');
  }

  function getFocusTarget() {
    const focus = state?.focus;
    if (!focus) return null;
    if (!(focus.health > 0) || focus._deathTransitionStarted) { state.focus = null; return null; }
    return focus;
  }

  // Only the ranged weapon works while down.
  function allowsAction(heldMode, activeTool) {
    return !state || (heldMode === 'tool' && activeTool === 'ranged');
  }

  function hudEls() {
    if (hud || typeof document === 'undefined') return hud;
    const root = document.createElement('div');
    root.id = 'playerDownedHud';
    root.style.cssText = 'position:fixed;inset:0;z-index:55;pointer-events:none;display:none;box-shadow:inset 0 0 140px rgba(170,0,0,.6);';
    const panel = document.createElement('div');
    panel.style.cssText = 'position:absolute;top:22%;left:50%;transform:translateX(-50%);min-width:220px;text-align:center;padding:8px 16px;border-radius:12px;background:rgba(25,6,6,.8);border:1px solid rgba(255,90,70,.7);color:#ffd2c8;font:800 15px system-ui,sans-serif;';
    const text = document.createElement('div');
    const track = document.createElement('div');
    track.style.cssText = 'margin-top:6px;height:6px;border-radius:3px;background:rgba(255,255,255,.18);overflow:hidden;';
    const fill = document.createElement('div');
    fill.style.cssText = 'height:100%;width:100%;background:#ff5a46;';
    track.appendChild(fill);
    panel.appendChild(text);
    panel.appendChild(track);
    root.appendChild(panel);
    document.body?.appendChild(root);
    hud = { root, text, fill };
    return hud;
  }

  function refreshHud() {
    const secs = state ? Math.max(0, Math.ceil(state.remainingS)) : 0;
    const pct = state ? Math.round((state.remainingS / state.totalS) * 100) : 0;
    const key = state ? `${secs}|${pct}` : '';
    if (key === hudKey) return;
    hudKey = key;
    const els = hudEls();
    if (!els) return;
    els.root.style.display = state ? 'block' : 'none';
    if (!state) return;
    els.text.textContent = `DOWN — get a kill to rise (${secs}s)`;
    els.fill.style.width = pct + '%';
  }

  // Once per un-paused frame.
  function update(dt) {
    if (!deps || !state) { if (hudKey) refreshHud(); return; }
    const player = deps.player;
    player.health = CONFIG.downedHealth; // Regeneration and damage-over-time cannot move it while down.
    state.remainingS -= dt;
    if (state.remainingS <= 0) { bleedOut(); return; }
    refreshHud();
  }

  // Death/respawn, save load, or scripted resets clear the state silently.
  function reset() {
    state = null;
    window.PlayerCrawl?.setActive(false);
    refreshHud();
  }

  window.PlayerDowned = Object.freeze({
    CONFIG,
    init,
    update,
    isDowned,
    tryDown,
    interceptDeath,
    secondWind,
    noteHitWhileDowned,
    noteTeamHit,
    noteKill,
    isTeamKill, // Kill attribution shared with HobunjiActivityEvents.emitCreatureKilled (dates, likes).
    getFocusTarget,
    allowsAction,
    reset,
    debugSnapshot: () => ({ downed: !!state, remainingS: state?.remainingS ?? 0, focus: state?.focus?.id || null, lastEvent }),
  });
})();
