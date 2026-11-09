// Animal-companion offensive / defensive / revival training perks.
//
// A companion that is only a damage dealer is a pet that gets downed easily
// (see companion-downed.js), so the General Companion Training tree also
// carries defensive perks, revival perks, and a Last Stand perk that pays off
// while the owner is downed (player-downed.js). This module owns those perk
// definitions and every number they produce; the systems that consume them
// (CompanionDowned, damageCreature, ResourceSystem, CompanionOffense) ask here
// instead of re-reading perk ids.
//
// Loaded by livestock-nursery-install-bridge.js right after
// stable-animal-perk-adjustments.js (which owns the base companion tree and
// replaces it wholesale), so these definitions are appended to the live tree.
(() => {
  'use strict';

  const progression = window.StableAnimalProgression;
  if (!progression || window.CompanionResilience?.installed) return;

  const PER_RANK = Object.freeze({
    damage: 0.06,           // companionClaws: +6% Health damage per rank.
    footingDamage: 0.10,    // companionStagger: +10% Footing damage per rank.
    affliction: 0.10,       // companionFester: +10% affliction buildup per rank.
    damageTaken: 0.06,      // companionHide: -6% damage taken per rank.
    maxHealth: 0.10,        // companionVigor: +10% max Health per rank.
    maxFooting: 0.10,       // companionPoise: +10% max Footing per rank.
    healthRegen: 0.15,      // companionMending: +15% Health regeneration per rank.
    autoRevive: 0.10,       // companionRally: -10% auto-revive timer per rank (5 ranks = -50%).
    ownerHold: 0.10,        // companionHeel: -10% hold to revive when its owner revives it (-50% max).
    anyoneHold: 0.10,       // companionRallyAll: -10% hold to revive from anyone, owner included (-50% max).
    lastStandDamage: 0.25,  // companionLastStand: +25% damage while the owner is downed.
    lastStandDefense: 0.15, // companionLastStand: -15% damage taken while the owner is downed.
  });
  const MIN_DAMAGE_TAKEN = 0.2; // Floor so stacked defense never makes a companion invulnerable.

  const PERK_DEFS = Object.freeze([
    { id: 'companionClaws', name: 'Sharpened Claws', maxRank: 5, desc: '+6% attack damage per rank.' },
    { id: 'companionStagger', name: 'Staggering Blows', maxRank: 5, desc: '+10% Footing damage per rank, so enemies fall prone sooner.' },
    { id: 'companionFester', name: 'Festering Wounds', maxRank: 5, desc: '+10% affliction buildup (bleeding, poison...) per rank.' },
    { id: 'companionHide', name: 'Thick Hide', maxRank: 5, desc: '-6% damage taken per rank.' },
    { id: 'companionVigor', name: 'Hardy Constitution', maxRank: 5, desc: '+10% maximum Health per rank.' },
    { id: 'companionPoise', name: 'Steady Footing', maxRank: 5, desc: '+10% maximum Footing per rank, so it is harder to knock down.' },
    { id: 'companionMending', name: 'Mending Instinct', maxRank: 5, desc: '+15% Health regeneration per rank.' },
    { id: 'companionRally', name: 'Quick Rally', maxRank: 5, desc: 'When downed, gets back up on its own 10% sooner per rank (up to 50%).' },
    { id: 'companionHeel', name: 'Heel to Master', maxRank: 5, desc: 'Your held revive on this companion is 10% faster per rank (up to 50%). Stacks with Rallying Presence.' },
    { id: 'companionRallyAll', name: 'Rallying Presence', maxRank: 5, desc: 'Anyone reviving this companion (you, other players, allies) is 10% faster per rank (up to 50%).' },
    { id: 'companionLastStand', name: 'Guardian Fury', maxRank: 3, desc: 'While you are downed: +25% damage and -15% damage taken per rank.' },
  ]);
  const PERK_IDS = new Set(PERK_DEFS.map(def => def.id));

  const unregister = []; // Provider disposers, kept so a reinstall never double-registers.
  let registered = false;

  function installPerkDefinitions() {
    const tree = progression.trees?.companion;
    if (!Array.isArray(tree)) return;
    const existing = new Set(tree.map(def => def.id));
    for (const def of PERK_DEFS) if (!existing.has(def.id)) tree.push({ ...def });
  }

  function isPlayerCompanion(actor) {
    if (!actor?.isCompanion || actor.stableRole !== 'companion' || actor.banditCompanion === true) return false;
    const player = window.Combat?.deps?.player;
    return !player || (actor.master || player) === player;
  }

  function entryForActor(actor) {
    if (!isPlayerCompanion(actor)) return null;
    const byId = actor.stableId ? progression.findStableEntry?.(actor.stableId) : null;
    return byId || progression.activeEntryForRole?.('companion') || null;
  }

  function rank(entry, id) {
    return entry ? (progression.perkRank?.(entry, id) || 0) : 0;
  }

  function ownerDowned() {
    return window.PlayerDowned?.isDowned?.() === true;
  }

  function lastStandRank(entry) {
    return ownerDowned() ? rank(entry, 'companionLastStand') : 0;
  }

  // Multiplier on Health/Footing/affliction a companion deals.
  function offenseModifiers(actor) {
    const entry = entryForActor(actor);
    if (!entry) return null;
    const lastStand = 1 + lastStandRank(entry) * PER_RANK.lastStandDamage;
    const damage = (1 + rank(entry, 'companionClaws') * PER_RANK.damage) * lastStand;
    const footing = (1 + rank(entry, 'companionStagger') * PER_RANK.footingDamage) * lastStand;
    const affliction = (1 + rank(entry, 'companionFester') * PER_RANK.affliction) * lastStand;
    return damage === 1 && footing === 1 && affliction === 1 ? null : { damage, footing, affliction };
  }

  // Multiplier on every hit the companion takes (1 = unchanged).
  function damageTakenMultiplier(actor) {
    const entry = entryForActor(actor);
    if (!entry) return 1;
    const reduction = rank(entry, 'companionHide') * PER_RANK.damageTaken + lastStandRank(entry) * PER_RANK.lastStandDefense;
    return Math.max(MIN_DAMAGE_TAKEN, 1 - reduction);
  }

  function statMultiplier(actor, key) {
    const entry = entryForActor(actor);
    if (!entry) return 1;
    if (key === 'maxHealth') return 1 + rank(entry, 'companionVigor') * PER_RANK.maxHealth;
    if (key === 'maxFooting') return 1 + rank(entry, 'companionPoise') * PER_RANK.maxFooting;
    if (key === 'healthRegen' || key === 'healthRegenInCombat') return 1 + rank(entry, 'companionMending') * PER_RANK.healthRegen;
    return 1;
  }

  // Multiplier on the seconds a downed companion waits before getting up alone.
  function autoReviveMultiplier(entry) {
    return Math.max(0.5, 1 - rank(entry, 'companionRally') * PER_RANK.autoRevive);
  }

  // Multiplier on the held-revive duration. The owner-only and anyone perks
  // multiply: both maxed leaves 0.5 * 0.5 = 25% of the base hold (75% faster).
  function reviveHoldMultiplier(entry, reviverIsOwner) {
    const anyone = Math.max(0.5, 1 - rank(entry, 'companionRallyAll') * PER_RANK.anyoneHold);
    const owner = reviverIsOwner ? Math.max(0.5, 1 - rank(entry, 'companionHeel') * PER_RANK.ownerHold) : 1;
    return anyone * owner;
  }

  // Providers register lazily: ResourceSystem / CompanionOffense can load after
  // this bridge-loaded module, so retry until both exist (cheap once done).
  function ensureRegistered() {
    if (registered) return true;
    const rs = window.ResourceSystem, offense = window.CompanionOffense;
    if (!rs?.registerStatModifierProvider || !offense?.registerProvider) return false;
    unregister.push(rs.registerStatModifierProvider((entity, key) => (entity?.isCompanion ? statMultiplier(entity, key) : 1)));
    unregister.push(offense.registerProvider('companionTraining', companion => offenseModifiers(companion)));
    registered = true;
    return true;
  }

  function install() {
    installPerkDefinitions();
    ensureRegistered();
    return window.CompanionResilience;
  }

  window.CompanionResilience = {
    installed: true,
    install,
    ensureRegistered,
    perkDefs: PERK_DEFS,
    perkIds: PERK_IDS,
    perRank: PER_RANK,
    entryForActor,
    offenseModifiers,
    damageTakenMultiplier,
    statMultiplier,
    autoReviveMultiplier,
    reviveHoldMultiplier,
    isRegistered: () => registered,
  };
  installPerkDefinitions();
  ensureRegistered();
})();
