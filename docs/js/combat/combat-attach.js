// Combat attach attacks — a reusable "climb onto a target and take its place
// for a while" attack for non-player creatures (honeyfuzzle Swarm today; a
// leech, a burr, a rider... later). Registered through
// Combat.attach.register(id, config), which registers a named attack with
// Combat.animalAttacks (combat-animal-attacks.js) so creatures list it in
// CREATURE_DB[...].attacks like any other attack, and the AI loops keep
// treating the creature as busy (no wandering/chasing/animating of its own)
// until the attachment ends.
//
// An attachment has three parts, all driven by the config:
//   approach  the attacker flies/hops to its single chosen target;
//   attached  it inherits the target's place and facing, overlapping its
//             visible body center (Swarm) or riding above it (other attacks),
//             and ticks an effect onto it for durationS;
//   detach    it ends on time, or when either side dies or leaves the area, or
//             if the attacker is cancelled, and is set down beside the target.
// While attached the attacker can be configured to
//   - ignore everything its own host does to it (immuneToHost),
//   - shrug off hit stagger/knockback from everyone (staggerImmune); other
//     creatures can still damage it, which is the counterplay, and
//   - make a creature host react (hostReaction 'flail'): the host swats at
//     what is on it, which also hits whatever else stands near it.
//
// Config (all optional except label):
//   label, durationS, cooldownS, approachSpeedPxS, contactPx, approachTimeoutS,
//   tickIntervalS, tick: { damageScale, playerScale, tag, afflictionBonuses }  -> default tick
//   onTick(attacker, host, ctx)      -> replaces the default tick
//   onAttach(attacker, host), onDetach(attacker, host, reason)
//   immuneToHost, staggerImmune, maxPerHost,
//   verticalAnchor ('center' to overlap the visible body, else above the top),
//   heightAboveHost (offset from that anchor), visualSpreadScale,
//   hostReaction: { kind: 'flail', intervalS, radiusTiles, damageScale,
//                   hitsAllies, hitsOpponents }
//
// Hooks used by game.js's damage paths: Combat.attach.blocksDamage(victim,
// opts, fromX, fromY) and Combat.attach.suppressesStagger(victim).
(() => {
  'use strict';
  if (!window.Combat?.animalAttacks) { console.error('combat-attach.js requires combat-animal-attacks.js to load first'); return; }

  const configs = new Map(); // attack id -> resolved config
  const HOST_ATTACK_ORIGIN_TILES = 0.9; // An attack with no named attacker that starts this close to the host is the host's.
  const PLAYER_HEIGHT_UNITS = 1.7;

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function deps() { return window.Combat.deps; }

  function isPlayer(entity) {
    const d = deps();
    return !!entity && (entity === d.player || (d.players || []).includes(entity));
  }

  function hostHeightUnits(host) {
    if (isPlayer(host)) return PLAYER_HEIGHT_UNITS;
    const half = Number(host?.halfHeight) || 0.6;
    return half * 2 * (Number(host?.visualScaleY) || 1);
  }

  function hostAlive(host) { return !!host && (isPlayer(host) ? host.health > 0 : host.health > 0 && !host._deathTransitionStarted); }

  function sameArea(a, b) { return isPlayer(b) || !a.areaId || !b.areaId || a.areaId === b.areaId; }

  // ---- queries ---------------------------------------------------------------

  const attachmentOf = c => c?._attachment || null;
  const hostOf = c => c?._attachment?.host || null;
  const isAttached = c => !!c?._attachment && c._attachment.stage === 'attached';
  const attachersOf = host => (host?._attachedBy ? [...host._attachedBy] : []);

  // Is `opts`/the hit's origin a hit from `host`? A named attacker is exact; a
  // player hit carries no attacker (or the player itself); an unnamed hit that
  // starts on top of the host (a bite, a swat) is the host's too.
  function hitIsFromHost(host, opts, fromX, fromY) {
    const attacker = opts?.attacker || null;
    if (attacker) return attacker === host;
    if (isPlayer(host)) return true; // Player melee/ranged/potions all arrive unnamed.
    if (Number.isFinite(fromX) && Number.isFinite(fromY)) {
      return Math.hypot(fromX - host.x, fromY - host.y) <= deps().TILE * HOST_ATTACK_ORIGIN_TILES;
    }
    return false;
  }

  function blocksDamage(victim, opts, fromX, fromY) {
    const att = victim?._attachment;
    if (!att || att.stage !== 'attached' || !att.cfg.immuneToHost) return false;
    if (opts?.attachTick) return false; // Its own ticks never block themselves.
    return hitIsFromHost(att.host, opts, fromX, fromY);
  }

  function suppressesStagger(victim) {
    const att = victim?._attachment;
    return !!att && att.stage === 'attached' && !!att.cfg.staggerImmune;
  }

  // ---- ticks and reactions ---------------------------------------------------

  function defaultTick(c, host, cfg) {
    const d = deps();
    const t = cfg.tick || {};
    const tag = t.tag || c.def.attackTag || 'sharp';
    const amount = Math.max(0, (Number(c.def.attackDamage) || 0) * (t.damageScale ?? 1) * (isPlayer(host) ? (t.playerScale ?? 1) : 1)); // playerScale softens a creature's ticks against the player (a hive defender is a deterrent, not an executioner).
    const afflictionBonuses = t.afflictionBonuses || window.ResourceSystem?.afflictionBonusesForTag(tag) || null;
    const opts = { tag, afflictionBonuses, attacker: c, noStagger: true, attachTick: true, footingDamageMultiplier: 0 };
    if (isPlayer(host)) d.damagePlayer(amount, c.x, c.y, 0, opts);
    else if (c.isCompanion && window.CompanionOffense) window.CompanionOffense.damageCreature(d.damageCreature, c, host, amount, c.x, c.y, 0, opts);
    else d.damageCreature(host, amount, c.x, c.y, 0, opts);
  }

  // The host swats at what is on it. The swat is aimed at the attacker, which
  // ignores it, so the damage lands on whoever else is within reach: its own
  // allies (friendly fire) and, if configured, the attacker's side.
  function flail(c, host, react) {
    const d = deps();
    const radius = (react.radiusTiles ?? 1.4) * d.TILE;
    const amount = (Number(host.def?.attackDamage) || 4) * (react.damageScale ?? 0.8);
    const tag = host.def?.attackTag || 'blunt';
    const opts = { tag, afflictionBonuses: window.ResourceSystem?.afflictionBonusesForTag(tag), attacker: host };
    const area = host.areaId;
    const struck = [];
    const hitCreature = o => {
      if (!o || o === host || o === c || o.health <= 0 || (area && o.areaId && o.areaId !== area)) return;
      if (o._attachment?.host === host && o._attachment.stage === 'attached') return; // Other swarmers are also on the host: they ignore its swats.
      if (Math.hypot(o.x - host.x, o.y - host.y) > radius) return;
      d.damageCreature(o, amount, host.x, host.y, 260, opts);
      struck.push(o);
    };
    if (react.hitsAllies !== false) for (const o of d.hostileObjects) hitCreature(o);
    if (react.hitsOpponents) {
      for (const o of d.companionObjects) { if (o.stableRole !== 'shoulderPet') hitCreature(o); }
      for (const p of d.players || [d.player]) {
        if (p.health > 0 && Math.hypot(p.x - host.x, p.y - host.y) <= radius) { d.damagePlayer(amount, host.x, host.y, 260, opts); struck.push(p); }
      }
    }
    host.hitFlashT = Math.max(host.hitFlashT || 0, 0.12); // Visible flinch from the swat.
    window.AudioSystem?.playCreatureClawHit?.(host);
    return struck;
  }

  // ---- the registered attack -------------------------------------------------

  function attachedHostCount(host) { return host?._attachedBy ? host._attachedBy.size : 0; }

  function startAttach(c, state, ctx) {
    const cfg = state.cfg;
    const host = ctx?.target || null;
    state.host = host;
    state.stage = 'approach';
    state.t = 0;
    state.tickAcc = 0;
    state.reactAcc = 0;
    state.valid = hostAlive(host) && host !== c && attachedHostCount(host) < (cfg.maxPerHost ?? 3) && !host._attachment?.host; // Hosts can't be riders themselves, and aren't buried under riders.
    if (!state.valid) return;
    c.facing = Math.atan2(host.y - c.y, host.x - c.x);
    c._attachment = { id: state.id, cfg, host, stage: 'approach' };
    (host._attachedBy || (host._attachedBy = new Set())).add(c);
  }

  function detach(c, state, reason) {
    const d = deps();
    const att = c._attachment;
    const host = state.host;
    if (host?._attachedBy) { host._attachedBy.delete(c); if (!host._attachedBy.size) host._attachedBy = null; }
    c._attachment = null;
    c._banditLungeHopCurrent = 0;
    c._attachVisualSpread = 1;
    if (att && host && Number.isFinite(host.x)) { // Set down beside the host, never inside it.
      const angle = Math.atan2(c.y - host.y, c.x - host.x) || Math.random() * Math.PI * 2;
      const away = d.TILE * 0.9;
      for (const a of [angle, angle + 1.2, angle - 1.2, angle + Math.PI]) {
        const nx = host.x + Math.cos(a) * away, ny = host.y + Math.sin(a) * away;
        if (!d.canOccupyAt || d.canOccupyAt(nx, ny, d.TILE * 0.3)) { c.x = nx; c.y = ny; break; }
      }
    }
    c.vx = 0; c.vy = 0;
    if (state.cfg.cooldownS > 0) c.attackCooldownT = Math.max(c.attackCooldownT || 0, state.cfg.cooldownS);
    state.cfg.onDetach?.(c, host, reason);
    state.ended = reason;
  }

  // A rider rests above the host; a swarm surrounds the host's *visible*
  // body center. Resolve that height through Combat's existing world-Y hook,
  // which supports differently sized portraits, cliffs and riding.
  function syncAttachedPosition(c, host, cfg) {
    const d = deps();
    c.x = host.x; c.y = host.y;
    c.facing = Number.isFinite(host.facing) ? host.facing : (Number.isFinite(host.angle) ? host.angle : c.facing);
    c.vx = 0; c.vy = 0;
    const authoredLift = Number(c.groundLift ?? c.halfHeight); // The creature renderer's floor-to-root offset; zero is a valid authored ground lift.
    const ownLift = (Number.isFinite(authoredLift) ? authoredLift : 0.3) * (c.scaleY ?? 1); // Same baseline (and squash scale) used by updateCreatureMesh.
    if (cfg.verticalAnchor === 'center') {
      const pivotOffset = (Number(c.avatarRef?.frontPlane?.position?.y) || 0) *
        (Number(c.avatarRef?.group?.scale?.y) || 1); // Honeyfuzzle wing cloud hovers above its root; align the birds, not the root.
      const hostY = d.getActorWorldY?.(host); // Target's real rendered body center (not its physical top); missing values must not turn into 0.
      const groundY = d.worldSurfaceY?.(c.x, c.y); // Converts target center into the existing shared hop-offset slot, retaining undefined for the fallback.
      const offset = cfg.heightAboveHost ?? 0; // Centered attacks may opt into a small visual offset.
      c._banditLungeHopCurrent = Number.isFinite(hostY) && Number.isFinite(groundY)
        ? hostY + offset - groundY - ownLift - pivotOffset
        : hostHeightUnits(host) * 0.5 + offset - ownLift - pivotOffset;
      if (Number.isFinite(hostY) && c.avatarRef?.group?.position) {
        c.avatarRef.group.position.y = hostY + offset - pivotOffset; // Prevent height-lag as the target rises/falls.
      }
    } else {
      c._banditLungeHopCurrent = Math.max(0, hostHeightUnits(host) + (cfg.heightAboveHost ?? 0.1) - ownLift); // Preserve the legacy 0.1 above-head gap for other attach attacks.
    }
    c._attachVisualSpread = cfg.visualSpreadScale ?? 1;
  }

  function updateAttach(c, state, dt) {
    const d = deps();
    const cfg = state.cfg;
    const host = state.host;
    if (!state.valid) return false;
    if (!hostAlive(host) || c.health <= 0 || !sameArea(c, host)) { detach(c, state, 'host-lost'); return false; }
    state.t += dt;

    if (state.stage === 'approach') {
      const dx = host.x - c.x, dy = host.y - c.y, dist = Math.hypot(dx, dy);
      const contact = cfg.contactPx ?? d.TILE * 0.45;
      if (dist <= contact || state.t >= (cfg.approachTimeoutS ?? 0.7)) {
        state.stage = 'attached'; state.t = 0;
        c._attachment.stage = 'attached';
        syncAttachedPosition(c, host, cfg); // Overlap from the first attached frame.
        window.Combat.telegraph?.cancel?.(c);
        cfg.onAttach?.(c, host);
        return true;
      }
      const attackSpeed = c.isCompanion ? Math.max(cfg.approachSpeedPxS ?? 520, d.TILE * 2.6 / 0.12) : (cfg.approachSpeedPxS ?? 520); // Companions close quickly while keeping attach-specific hovering and host alignment.
      const step = Math.min(dist, attackSpeed * dt);
      c.x += dx / dist * step; c.y += dy / dist * step; // Attackers that attach fly/hop over small obstacles.
      c.facing = Math.atan2(dy, dx);
      return true;
    }

    // attached: occupy the host's place (including its vertical body center).
    syncAttachedPosition(c, host, cfg);

    if (state.t >= (typeof cfg.durationS === 'function' ? cfg.durationS(c, host) : (cfg.durationS ?? 5))) { detach(c, state, 'expired'); return false; }

    const interval = Math.max(0.05, cfg.tickIntervalS ?? 0.5);
    state.tickAcc += dt;
    while (state.tickAcc >= interval) {
      state.tickAcc -= interval;
      if (cfg.onTick) cfg.onTick(c, host, state); else defaultTick(c, host, cfg);
      if (!hostAlive(host)) { detach(c, state, 'host-died'); return false; }
    }

    const react = cfg.hostReaction;
    if (react && !isPlayer(host) && !host.isCompanion) {
      state.reactAcc += dt;
      const every = Math.max(0.2, react.intervalS ?? 0.9);
      if (state.reactAcc >= every) { state.reactAcc -= every; flail(c, host, react); }
    }
    return true;
  }

  function cancelAttach(c, state) {
    if (c._attachment) detach(c, state, 'cancelled');
  }

  function register(id, config) {
    const cfg = Object.freeze({ immuneToHost: true, staggerImmune: true, ...config });
    configs.set(id, cfg);
    window.Combat.animalAttacks.register(id, {
      label: cfg.label || id,
      ownsApproach: true, // Attaching animals have their own in-flight approach and must not stack a ground lunge first.
      start: (c, state, ctx) => { state.id = id; state.cfg = cfg; startAttach(c, state, ctx); },
      update: (c, state, dt) => updateAttach(c, state, dt),
      cancel: (c, state) => cancelAttach(c, state),
      isStriking: state => state?.stage === 'attached',
      isWindingUp: state => state?.stage === 'approach',
    });
    return cfg;
  }

  window.Combat.attach = { register, attachmentOf, hostOf, isAttached, attachersOf, blocksDamage, suppressesStagger, config: id => configs.get(id) || null, hitIsFromHost };

  // ── Swarm (honeyfuzzle) ──────────────────────────────────────────────
  // Picks a single target and sits on top of it. Almost no direct damage but a
  // heavy Poisoned Health buildup; immune to the swarmed target's own attacks,
  // so the target has to kill it by other means or wait it out. The swarmed
  // creature flails at it, which hurts whatever else stands near.
  // Tuning lives in window.SCRATCHBONES_CONFIG.game.combat.attach.swarm when
  // present (see applyConfig); these are the defaults.
  const SWARM_DEFAULTS = {
    label: 'Swarm',
    durationS: 6,
    cooldownS: 5,
    tickIntervalS: 0.5,
    verticalAnchor: 'center',
    heightAboveHost: 0,
    visualSpreadScale: 0.42,
    maxPerHost: 3,
    tick: { damageScale: 0.3, playerScale: 0.6, tag: 'poison', afflictionBonuses: { poisonedHealth: 3 } },
    hostReaction: { kind: 'flail', intervalS: 1.1, radiusTiles: 1.4, damageScale: 0.5, hitsAllies: true, hitsOpponents: false },
  };
  window.Combat.attach.SWARM_DEFAULTS = SWARM_DEFAULTS;
  window.Combat.attach.applyConfig = function (cfg) {
    const s = cfg?.swarm;
    if (!s) return;
    register('swarm', { ...SWARM_DEFAULTS, ...s, tick: { ...SWARM_DEFAULTS.tick, ...(s.tick || {}) }, hostReaction: s.hostReaction === null ? undefined : { ...SWARM_DEFAULTS.hostReaction, ...(s.hostReaction || {}) } });
  };
  register('swarm', SWARM_DEFAULTS);
})();
