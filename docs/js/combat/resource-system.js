// Resource system — Health/Stamina afflictions + Exhausted/black-stamina
// debt, ported from the "Resource Afflictions Battle Demo" prototype into
// this game's real player/creature combat. Works directly on the flat
// health/maxHealth/stamina/maxStamina fields game.js already reads
// everywhere (player, hostiles, companions) instead of introducing a
// nested resource object, so nothing outside this file has to change how
// it reads those fields.
//
// Usage (see game.js + docs/js/combat/*.js for real call sites):
//   ResourceSystem.initEntity(entity)               — once, on spawn
//   ResourceSystem.tick(entity, dt, opts)            — every frame
//   ResourceSystem.spendStamina(entity, cost, why)   — ability costs
//   ResourceSystem.applyDamage(entity, amount, opts) — instead of raw health -=
//   ResourceSystem.spendFooting(entity, amount, why) — balance loss on a hit
//   ResourceSystem.getEffectiveMax(entity, 'health'|'stamina'|'footing')
//
// AFFLICTIONS/tuning below are intentionally config-backed the same way
// combatConfig().weaponAbilities is, so damage/recovery rates can be tuned
// without touching code — see scratchbones-config.js's
// game.combat.resourceSystem.
(() => {
  "use strict";

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const round1 = value => Math.round(value * 10) / 10;
  const nowMs = () => performance.now();

  // Seedable RNG for gameplay-affecting rolls (affliction procs, creature AI
  // decisions, pack spawns, loot quantities, etc.) — everything that two
  // peers would eventually need to agree on, as opposed to purely cosmetic
  // randomness (particle FX, audio pitch variance) which can stay on the
  // browser's own unseeded Math.random(). Not networked yet — there's no
  // networking in this repo at all today — but centralizing these rolls
  // behind one seedable source is the precondition for a future
  // authoritative host to either seed this deterministically or resolve+
  // broadcast individual rolls instead of each peer rolling independently.
  // Mulberry32: tiny, fast, statistically fine for gameplay (not
  // cryptographic).
  function mulberry32(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  let _rngSeed = (Math.random() * 0xffffffff) >>> 0;
  let _rng = mulberry32(_rngSeed);
  window.GameRandom = {
    random: () => _rng(),
    seed: (seed) => { _rngSeed = seed >>> 0; _rng = mulberry32(_rngSeed); },
    getSeed: () => _rngSeed,
  };

  // Footing (balance) lives as its own flat entity.footing/maxFooting pair,
  // set up in initEntity/tick alongside health/stamina below — it has no
  // afflictions of its own (see getRingFillFraction/spendFooting instead of
  // this AFFLICTIONS map). woundedStamina/infectedStamina/shatteredStamina/
  // windedStamina live on 'stamina'; the rest on 'health'.
  const AFFLICTIONS = {
    woundedStamina: {
      name: "Wounded Stamina", resource: "stamina", extend: "zero", priority: 55, recovers: true,
      desc: "Spent afflicted Stamina deals itself as Health damage."
    },
    bleedingHealth: {
      name: "Bleeding Health", resource: "health", extend: "currentBack", priority: 70, recovers: false,
      desc: "Ticks as Health loss during combat; while quiet/rested, the same tick heals instead."
    },
    congealedHealth: {
      name: "Congealed Health", resource: "health", extend: "zero", priority: 50, recovers: false,
      desc: "Temporarily lowers effective Health max, then recovers its own points every tick."
    },
    infectedStamina: {
      name: "Infected Stamina", resource: "stamina", extend: "zero", priority: 65, recovers: true,
      desc: "Spent like Wounded Stamina. Can cause vomiting, adding Winded Stamina and Poisoned Health."
    },
    windedStamina: {
      name: "Winded Stamina", resource: "stamina", extend: "zero", priority: 95, recovers: true,
      desc: "Lowers effective maximum Stamina and makes Exhausted easier to enter."
    },
    bruisedHealth: {
      name: "Bruised Health", resource: "health", extend: "currentBack", priority: 60, recovers: true,
      desc: "A subsequent received heavy attack deals bonus damage up to the attack's normal damage, then consumes it."
    },
    shatteredStamina: {
      name: "Shattered Stamina", resource: "stamina", extend: "zero", priority: 62, recovers: true,
      desc: "Spent afflicted Stamina applies Bleeding Health instead of direct Health damage."
    },
    poisonedHealth: {
      name: "Poisoned Health", resource: "health", extend: "currentBack", priority: 80, recovers: false,
      desc: "Ticks as Health damage over time; does not recover on its own."
    }
  };

  // Baseline afflictions a creature's plain attackTag applies (see game.js's
  // CREATURE_DB attackTag field — gar-wolves 'sharp', dabinggi-hounds
  // 'poison', Uumkao'ii 'blunt' — and combat-animal-attacks.js's Pounce/
  // Guard Charge, which both read this so every one of a species'
  // interchangeable attacks, the generic bite telegraph included, afflicts
  // consistently instead of each attack guessing its own). One straight
  // affliction per tag, at roughly the strength of the player's own first
  // (unearned) upgrade pick for that same affliction (see combat-
  // progression.js's BLEED/BRUISE/POISON) — a creature has no progression
  // tree to grow into, so it just always lands at that baseline.
  const ATTACK_TAG_AFFLICTIONS = {
    sharp:  { bleedingHealth: 0.35 },
    blunt:  { bruisedHealth: 0.5 },
    poison: { poisonedHealth: 0.28 },
  };

  function afflictionBonusesForTag(tag) {
    return ATTACK_TAG_AFFLICTIONS[tag] || null;
  }

  function defaultAfflictions() {
    const out = {};
    for (const id of Object.keys(AFFLICTIONS)) out[id] = 0;
    return out;
  }

  function resourceSystemConfig() {
    const cfg = window.SCRATCHBONES_CONFIG?.game?.combat?.resourceSystem || {};
    return {
      quietSeconds: Number(cfg.quietSeconds) || 3,
      staminaRegenPerSec: Number(cfg.staminaRegenPerSec) || 14,
      healthRegenPerSec: Number(cfg.healthRegenPerSec) || 1.2,
      afflictionRecoveryPerSec: Number(cfg.afflictionRecoveryPerSec) || 3.6,
      bleedTickPerSec: Number(cfg.bleedTickPerSec) || 5,
      poisonTickPerSec: Number(cfg.poisonTickPerSec) || 1.8,
      exhaustionRegenPerSec: Number(cfg.exhaustionRegenPerSec) || 24,
      pukeChancePerSec: cfg.pukeChancePerSec ?? 0.16,
      footingMax: Number(cfg.footingMax) || 100,
      footingRegenPerSec: Number(cfg.footingRegenPerSec) || 6,
      // How long a prone entity holds at 0 Footing (ragdoll settle + stun
      // hold, see impact-ragdoll-playback.js) before Footing starts
      // regenerating again — mirrors the authored impact clips' own
      // recoveryDelay (~1.35s) so the number reads as intentional rather
      // than arbitrary. Regen resuming is what eventually lets the player's
      // dodge input trigger the somersault recovery (see game.js's
      // performDodge/updateProneState) — prone itself only clears there.
      proneRecoveryDelayS: Number(cfg.proneRecoveryDelayS) || 1.5,
    };
  }

  function initEntity(entity) {
    entity.afflictions = { ...defaultAfflictions(), ...(entity.afflictions || {}) };
    entity.exhaustion = { active: false, blackStamina: 100, ...(entity.exhaustion || {}) };
    if (!Number.isFinite(entity.lastAttackAttemptAt)) entity.lastAttackAttemptAt = -1e9;
    if (!Number.isFinite(entity.lastAttackReceivedAt)) entity.lastAttackReceivedAt = -1e9;
    if (!Number.isFinite(entity.maxFooting)) entity.maxFooting = resourceSystemConfig().footingMax;
    if (!Number.isFinite(entity.footing)) entity.footing = entity.maxFooting;
    // prone: full-ragdoll knockdown state entered at 0 Footing (see game.js's
    // updateMovement/performDodge and impact-ragdoll-playback.js) — immune to
    // further Footing loss (spendFooting below) until the somersault recovery
    // clears it. staggered: the shared lockout combat-core.js's
    // isStaggered/beginStagger read to block starting new staged actions.
    if (entity.prone === undefined) entity.prone = false;
    entity.staggered = { active: false, direction: null, endsAt: 0, ...(entity.staggered || {}) };
    return entity;
  }

  function getAffliction(entity, id) {
    return entity.afflictions?.[id] ?? 0;
  }

  function setAffliction(entity, id, amount) {
    const def = AFFLICTIONS[id];
    if (!def) return;
    const maxAmount = def.resource === "health" ? entity.maxHealth : entity.maxStamina;
    entity.afflictions[id] = round1(clamp(amount, 0, maxAmount || 0));
  }

  function addAffliction(entity, id, amount) {
    if (!(amount > 0)) return 0;
    const before = getAffliction(entity, id);
    setAffliction(entity, id, before + amount);
    return round1(getAffliction(entity, id) - before);
  }

  function removeAffliction(entity, id, amount) {
    if (!(amount > 0)) return 0;
    const before = getAffliction(entity, id);
    setAffliction(entity, id, before - amount);
    return round1(before - getAffliction(entity, id));
  }

  function getEffectiveMax(entity, key) {
    if (key === "stamina") return clamp((entity.maxStamina || 0) - getAffliction(entity, "windedStamina"), 0, entity.maxStamina || 0);
    if (key === "health") return clamp((entity.maxHealth || 0) - getAffliction(entity, "congealedHealth"), 0, entity.maxHealth || 0);
    if (key === "footing") return entity.maxFooting || 0;
    return 0;
  }

  function enforceCaps(entity) {
    entity.health = round1(clamp(entity.health, 0, getEffectiveMax(entity, "health")));
    if (!entity.exhaustion.active) entity.stamina = round1(clamp(entity.stamina, 0, getEffectiveMax(entity, "stamina")));
    entity.exhaustion.blackStamina = round1(clamp(entity.exhaustion.blackStamina, 0, 100));
    if (Number.isFinite(entity.footing)) entity.footing = round1(clamp(entity.footing, 0, getEffectiveMax(entity, "footing")));
  }

  // Floor on how far Exhausted can slow an in-flight attack's own
  // windup/strike (and the gap before the next one — see combat-flurry.js,
  // combat-combo.js, combat-charged-breaker.js's timeScale). This used to
  // bottom out at .01 (a 100x stretch): a strike already committed right as
  // black-Stamina bottomed out could balloon its own short windup/strike
  // into 10+ seconds of still playing out — releasing the hold button stops
  // *new* strikes immediately (see combat-flurry.js's onHoldEnd) but can't
  // un-stretch one already in flight, so it read as "still attacking a long
  // while after letting go." .2 keeps the intended "grinds to a crawl"
  // feel without that runaway tail.
  const EXHAUSTION_SPEED_FLOOR = 0.2;

  function getExhaustionSpeed(entity) {
    if (!entity.exhaustion.active) return 1;
    const black = clamp(entity.exhaustion.blackStamina, 0, 100);
    if (black >= 100) return 1;
    return clamp(black / 100, EXHAUSTION_SPEED_FLOOR, 1);
  }

  // A tiny overspend (e.g. just barely tipping over your last sliver of
  // Stamina) used to produce almost no black-Stamina debt, which
  // regenerates back to 100 (see tick()'s exhaustionRegenPerSec, up to
  // 48/sec while rested) in a fraction of a second — Exhausted would clear
  // itself before the player could even perceive it, reading as "my
  // Stamina just went back to full" instead of actually entering Exhausted.
  // Flooring the debt guarantees entering Exhausted always costs a real,
  // felt recovery window regardless of how small the triggering overspend
  // was.
  const MIN_EXHAUSTION_DEBT = 20;

  function enterExhausted(entity, excessCost) {
    entity.exhaustion.active = true;
    const debt = Math.max(excessCost, MIN_EXHAUSTION_DEBT);
    entity.exhaustion.blackStamina = round1(clamp(100 - debt, 0, 100));
    entity.stamina = 0;
  }

  function clearExhaustedIfFull(entity) {
    if (!entity.exhaustion.active || entity.exhaustion.blackStamina < 100) return;
    entity.exhaustion.active = false;
    entity.exhaustion.blackStamina = 100;
    entity.stamina = getEffectiveMax(entity, "stamina");
  }

  // Overspending Stamina never blocks the action — the excess becomes
  // Exhausted black-stamina debt (see getExhaustionSpeed) instead. Callers
  // that still want a hard "too winded" refusal should keep checking
  // entity.stamina/maxStamina themselves before calling this; while
  // Exhausted, entity.stamina reads 0, so those checks keep working.
  function spendStamina(entity, amount, reason = "action") {
    entity.lastAttackAttemptAt = nowMs();
    if (!(amount > 0)) return { spent: 0, excess: 0 };

    if (entity.exhaustion.active) {
      entity.exhaustion.blackStamina = round1(clamp(entity.exhaustion.blackStamina - amount, 0, 100));
      return { spent: 0, excess: amount };
    }

    const before = entity.stamina;
    const after = clamp(before - amount, 0, entity.maxStamina || 0);
    const normalSpent = round1(before - after);
    const excess = round1(amount - normalSpent);
    entity.stamina = after;

    if (normalSpent > 0) resolveSpentAfflictions(entity, after, before);
    if (excess > 0) enterExhausted(entity, excess, reason);

    enforceCaps(entity);
    return { spent: normalSpent, excess };
  }

  // Balance loss from being hit (see game.js's damagePlayer/damageCreature,
  // which call this right after applying knockback and before starting the
  // stagger via combat-core.js's beginStagger). Unlike spendStamina there's
  // no black-debt overspend branch — Footing simply floors at 0, and hitting
  // 0 is what the caller uses as its signal to enter prone (see initEntity's
  // comment) rather than anything tracked in here. A prone entity is immune
  // to further loss until it recovers, per the feature's own rule.
  function spendFooting(entity, amount, reason = "hit") {
    if (entity.prone) return 0;
    if (!(amount > 0) || !Number.isFinite(entity.footing)) return 0;
    const before = entity.footing;
    entity.footing = round1(clamp(before - amount, 0, getEffectiveMax(entity, "footing")));
    return round1(before - entity.footing);
  }

  // Spending through the [0, afflictionAmount] band of a zero-based stamina
  // affliction triggers that affliction's on-spend effect (see AFFLICTIONS
  // docs above) proportional to how much of the band the spend crossed.
  function resolveSpentAfflictions(entity, spendEnd, spendStart) {
    const woundedOverlap = consumeZeroBasedSpend(entity, "woundedStamina", spendEnd, spendStart);
    if (woundedOverlap > 0) applyDamage(entity, woundedOverlap, { reason: "spent Wounded Stamina" });

    const infectedOverlap = consumeZeroBasedSpend(entity, "infectedStamina", spendEnd, spendStart);
    if (infectedOverlap > 0) applyDamage(entity, infectedOverlap, { reason: "spent Infected Stamina" });

    const shatteredOverlap = consumeZeroBasedSpend(entity, "shatteredStamina", spendEnd, spendStart);
    if (shatteredOverlap > 0) addAffliction(entity, "bleedingHealth", shatteredOverlap * 1.6);
  }

  function consumeZeroBasedSpend(entity, id, spendEnd, spendStart) {
    const amount = getAffliction(entity, id);
    const overlap = getRangeOverlap(spendEnd, spendStart, 0, amount);
    if (overlap <= 0) return 0;
    removeAffliction(entity, id, overlap);
    return round1(overlap);
  }

  function getRangeOverlap(aStart, aEnd, bStart, bEnd) {
    const left = Math.max(aStart, bStart);
    const right = Math.min(aEnd, bEnd);
    return round1(Math.max(0, right - left));
  }

  // Replaces a raw `entity.health -= amount`. opts.heavy consumes any
  // existing Bruised Health for bonus damage first, mirroring the demo's
  // Heavy Attack rule. opts.tag ('sharp'|'blunt'|'poison') no longer applies
  // any affliction on its own — every attack starts affliction-free; what it
  // actually inflicts comes entirely from opts.afflictionBonuses, a map of
  // {afflictionId: multiplier} the caller builds from its own chosen
  // upgrades (see combat-progression.js's getEffects()). tag is kept only
  // for the heavy-consumption rule above and any caller-side flavor (hit
  // SFX, UI labels) — it no longer implies any specific affliction. Returns
  // the actual Health lost.
  function applyDamage(entity, amount, opts = {}) {
    if (!(amount > 0)) return 0;
    entity.lastAttackReceivedAt = nowMs();

    let finalDamage = amount;
    if (opts.heavy) {
      const bonus = Math.min(getAffliction(entity, "bruisedHealth"), amount);
      if (bonus > 0) {
        removeAffliction(entity, "bruisedHealth", bonus);
        finalDamage += bonus;
      }
    }

    const before = entity.health;
    entity.health = round1(clamp(entity.health - finalDamage, 0, getEffectiveMax(entity, "health")));
    const lost = round1(before - entity.health);

    if (opts.afflictionBonuses) {
      for (const [id, mul] of Object.entries(opts.afflictionBonuses)) {
        if (AFFLICTIONS[id] && mul > 0) addAffliction(entity, id, finalDamage * mul);
      }
    }

    enforceCaps(entity);
    return lost;
  }

  function getRestInfo(entity, cfg) {
    const t = nowMs();
    const last = Math.max(entity.lastAttackAttemptAt ?? -1e9, entity.lastAttackReceivedAt ?? -1e9);
    const elapsedSeconds = (t - last) / 1000;
    return {
      rested: elapsedSeconds >= cfg.quietSeconds,
      remainingSeconds: clamp(cfg.quietSeconds - elapsedSeconds, 0, cfg.quietSeconds)
    };
  }

  // Called every frame for the player and every live creature. opts can
  // override the base regen rates (e.g. creatures keep their existing
  // species-relative stamina regen instead of the player's flat rate).
  // Returns { puked: {windedAmount, poisonAmount} | null } so a caller can
  // surface a "you feel queasy" cue for the player without this module
  // needing to know about toasts/VFX.
  function tick(entity, dt, opts = {}) {
    const cfg = resourceSystemConfig();
    const rest = getRestInfo(entity, cfg);
    const mul = rest.rested ? 2 : 1;
    const staminaRate = opts.staminaRegenPerSec ?? cfg.staminaRegenPerSec;
    const healthRate = opts.healthRegenPerSec ?? cfg.healthRegenPerSec;

    if (entity.exhaustion.active) {
      entity.exhaustion.blackStamina = round1(clamp(entity.exhaustion.blackStamina + cfg.exhaustionRegenPerSec * mul * dt, 0, 100));
      clearExhaustedIfFull(entity);
    } else {
      entity.stamina = round1(clamp(entity.stamina + staminaRate * mul * dt, 0, getEffectiveMax(entity, "stamina")));
    }

    if (entity.health > 0) entity.health = round1(clamp(entity.health + healthRate * mul * dt, 0, getEffectiveMax(entity, "health")));

    entity.proneT = entity.prone ? (entity.proneT || 0) + dt : 0;
    const footingRegenGated = entity.prone && entity.proneT < cfg.proneRecoveryDelayS;
    if (!footingRegenGated && Number.isFinite(entity.footing)) {
      const footingRate = opts.footingRegenPerSec ?? cfg.footingRegenPerSec;
      entity.footing = round1(clamp(entity.footing + footingRate * mul * dt, 0, getEffectiveMax(entity, "footing")));
    }

    resolveBleedingTick(entity, dt, rest, cfg);
    resolvePoisonTick(entity, dt, cfg);
    resolveCongealedTick(entity, dt, rest, cfg);
    resolveGenericRecovery(entity, dt, rest, cfg);
    const puked = maybeTriggerPuke(entity, dt, cfg);

    enforceCaps(entity);
    return { puked };
  }

  function resolveBleedingTick(entity, dt, rest, cfg) {
    const bleed = getAffliction(entity, "bleedingHealth");
    if (bleed <= 0) return;
    const amount = Math.min(bleed, cfg.bleedTickPerSec * dt);
    removeAffliction(entity, "bleedingHealth", amount);
    if (rest.rested) entity.health = round1(clamp(entity.health + amount, 0, getEffectiveMax(entity, "health")));
    else entity.health = round1(clamp(entity.health - amount, 0, getEffectiveMax(entity, "health")));
  }

  function resolvePoisonTick(entity, dt, cfg) {
    const poison = getAffliction(entity, "poisonedHealth");
    if (poison <= 0) return;
    const amount = Math.min(poison, cfg.poisonTickPerSec * dt);
    removeAffliction(entity, "poisonedHealth", amount);
    entity.health = round1(clamp(entity.health - amount, 0, getEffectiveMax(entity, "health")));
  }

  function resolveCongealedTick(entity, dt, rest, cfg) {
    const congealed = getAffliction(entity, "congealedHealth");
    if (congealed <= 0) return;
    const amount = Math.min(congealed, cfg.afflictionRecoveryPerSec * (rest.rested ? 2 : 1) * dt);
    removeAffliction(entity, "congealedHealth", amount);
    entity.health = round1(clamp(entity.health + amount, 0, getEffectiveMax(entity, "health")));
  }

  function resolveGenericRecovery(entity, dt, rest, cfg) {
    const amount = cfg.afflictionRecoveryPerSec * (rest.rested ? 2 : 1) * dt;
    for (const [id, def] of Object.entries(AFFLICTIONS)) {
      if (!def.recovers) continue;
      if (id === "bleedingHealth" || id === "poisonedHealth" || id === "congealedHealth") continue;
      if (getAffliction(entity, id) > 0) removeAffliction(entity, id, amount);
    }
  }

  function maybeTriggerPuke(entity, dt, cfg) {
    const infected = getAffliction(entity, "infectedStamina");
    if (infected <= 0) return null;
    const chancePerSec = clamp(cfg.pukeChancePerSec * (.35 + infected / 100), 0, .9);
    if (window.GameRandom.random() > chancePerSec * dt) return null;
    const windedAmount = round1(clamp(2 + window.GameRandom.random() * infected * .28, 1, 14));
    const poisonAmount = round1(clamp(windedAmount * .22, .2, 4));
    addAffliction(entity, "windedStamina", windedAmount);
    addAffliction(entity, "poisonedHealth", poisonAmount);
    return { windedAmount, poisonAmount };
  }

  // ── Ring-HUD support (docs/js/combat/resource-rings.js) ───────────────
  function maxFieldFor(entity, resourceKey) {
    if (resourceKey === "health") return entity.maxHealth;
    if (resourceKey === "footing") return entity.maxFooting;
    return entity.maxStamina;
  }

  function getRingFillFraction(entity, resourceKey) {
    if (resourceKey === "stamina" && entity.exhaustion.active) return clamp(entity.exhaustion.blackStamina / 100, 0, 1);
    const max = maxFieldFor(entity, resourceKey);
    return max ? clamp(entity[resourceKey] / max, 0, 1) : 0;
  }

  function getSegmentBox(entity, resourceKey, id) {
    const def = AFFLICTIONS[id];
    const max = maxFieldFor(entity, resourceKey);
    const current = resourceKey === "health" ? entity.health : entity.stamina;
    const amount = clamp(getAffliction(entity, id), 0, max || 0);
    let leftPoints = 0;
    let widthPoints = amount;

    if (def.extend === "currentBack") {
      const right = clamp(current, 0, max || 0);
      leftPoints = clamp(right - amount, 0, max || 0);
      widthPoints = clamp(right - leftPoints, 0, max || 0);
    }

    return { leftPoints, widthPoints, max: max || 0 };
  }

  window.ResourceSystem = {
    AFFLICTIONS,
    afflictionBonusesForTag,
    config: resourceSystemConfig,
    initEntity,
    getAffliction,
    addAffliction,
    removeAffliction,
    getEffectiveMax,
    getExhaustionSpeed,
    spendStamina,
    spendFooting,
    applyDamage,
    tick,
    getRestInfo,
    getRingFillFraction,
    getSegmentBox,
    enforceCaps,
  };
})();
