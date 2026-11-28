// Trinkets + Attunement.
//
// There are no trinket "slots": every equipped trinket spends Attunement from
// one shared budget (ATTUNEMENT_CAPACITY, default 8). Any combination is
// legal while its total attunementCost fits; an equip that would exceed the
// budget is rejected and never unequips anything else.
//
// Definitions are pure data. Straightforward trinkets need no code:
//   effects.stats      multipliers read by ResourceSystem's stat-modifier
//                      provider (maxHealth, maxStamina, maxFooting,
//                      healthRegen, healthRegenInCombat, staminaRegen,
//                      footingRegen)
//   effects.perkRanks  bonus ranks in the existing Combat perk tree
//                      (js/perk-system.js) — same stat vocabulary as perks
//   effects.companion  multipliers for js/combat/companion-offense.js
//                      (damage, footing, affliction)
//   handler            optional id in SPECIAL_HANDLERS for anything the three
//                      channels above cannot express (none needed yet)
//
// Ownership lives in gearInventory (character-scoped, saved by game.js's
// saveGearInventory like every other gear record):
//   gearInventory.trinkets         [{ uid, id }]
//   gearInventory.equippedTrinkets [uid, ...]
(() => {
  'use strict';

  const ATTUNEMENT_CAPACITY = 8; // Shared budget for every equipped trinket.
  const LOOT_KEY_PREFIX = 'trinket_'; // Loot-pool itemKeys of the form trinket_<id> grant a gear trinket instead of an inventory stack.

  // attunementCost reflects broad usefulness: general-purpose power is
  // expensive, narrow/gimmicky effects are cheap. A meaningful drawback
  // discounts a comparable clean bonus unless the upside is much stronger.
  // Three town Icons (9) deliberately exceed the 8 budget.
  const DEFINITIONS = Object.freeze({
    // ── Town Icons (Funji & Son's General Store) ──────────────────────
    iconNaoung: {
      id: 'iconNaoung', displayName: "Icon of Nao'ung", icon: '🗿', attunementCost: 3,
      source: 'town', category: 'icon', price: 420,
      description: 'Maximum Health +25%. Health regenerates 2.5× faster while still in combat.',
      effects: { stats: { maxHealth: 1.25, healthRegenInCombat: 2.5 } },
    },
    iconNarShangBo: {
      id: 'iconNarShangBo', displayName: 'Icon of Nar-shang Bo', icon: '🪬', attunementCost: 3,
      source: 'town', category: 'icon', price: 420,
      description: 'Maximum Stamina +25%. Stamina regenerates 35% faster.',
      effects: { stats: { maxStamina: 1.25, staminaRegen: 1.35 } },
    },
    iconKruurenShai: {
      id: 'iconKruurenShai', displayName: 'Icon of Kruuren-shai', icon: '🗻', attunementCost: 3,
      source: 'town', category: 'icon', price: 420,
      description: 'Maximum Footing +30%. Footing recovers 50% faster.',
      effects: { stats: { maxFooting: 1.30, footingRegen: 1.50 } },
    },

    // ── Porakaneki return gifts ──────────────────────────────────────────────
    engravedWhistle: {
      id: 'engravedWhistle', displayName: 'Engraved Whistle', icon: '🪈', attunementCost: 2,
      source: 'porakaneki', category: 'companion',
      description: 'Your animal companion deals 30% more damage and builds afflictions 40% faster.',
      effects: { companion: { damage: 1.30, affliction: 1.40 } },
    },

    // ── Wilderness buried-chest curios — one simple effect per trinket ──────
    // Their cost scales with breadth/strength; more powerful finds need more Attunement.
    wanderersAnklet: {
      id: 'wanderersAnklet', displayName: "Wanderer's Anklet", icon: '🦶', attunementCost: 1,
      source: 'buriedTreasure', category: 'combat',
      description: 'Stamina regenerates 25% faster.',
      effects: { stats: { staminaRegen: 1.25 } },
    },
    herbalistsPendant: {
      id: 'herbalistsPendant', displayName: "Herbalist's Pendant", icon: '🌿', attunementCost: 1,
      source: 'buriedTreasure', category: 'combat',
      description: 'Health regenerates 40% faster.',
      effects: { stats: { healthRegen: 1.40 } },
    },
    rangersBeads: {
      id: 'rangersBeads', displayName: "Ranger's Beads", icon: '📿', attunementCost: 2,
      source: 'buriedTreasure', category: 'combat',
      description: 'Ranged weapon damage +30%.',
      effects: { stats: { rangedDamage: 1.30 } },
    },
    brawlersRing: {
      id: 'brawlersRing', displayName: "Brawler's Ring", icon: '💍', attunementCost: 2,
      source: 'buriedTreasure', category: 'combat',
      description: 'Weapon hits deal 30% more Footing damage.',
      effects: { stats: { outgoingFootingDamage: 1.30 } },
    },
    guardiansBrooch: {
      id: 'guardiansBrooch', displayName: "Guardian's Brooch", icon: '🛡️', attunementCost: 2,
      source: 'buriedTreasure', category: 'combat',
      description: 'Maximum Health +20%.',
      effects: { stats: { maxHealth: 1.20 } },
    },
    duelistsSignet: {
      id: 'duelistsSignet', displayName: "Duelist's Signet", icon: '💠', attunementCost: 3,
      source: 'buriedTreasure', category: 'combat',
      description: 'Weapon hits deal 30% more Health damage.',
      effects: { stats: { outgoingHealthDamage: 1.30 } },
    },
    wardensAmulet: {
      id: 'wardensAmulet', displayName: "Warden's Amulet", icon: '🔰', attunementCost: 3,
      source: 'buriedTreasure', category: 'combat',
      description: 'Maximum Footing +60%.',
      effects: { stats: { maxFooting: 1.60 } },
    },

    fightersBelt: {
      id: 'fightersBelt', displayName: "Fighter's Belt", icon: '🥋', attunementCost: 2,
      source: 'buriedTreasure', category: 'combat',
      description: 'Weapon attacks use 15% less Stamina.',
      effects: { stats: { attackStaminaCost: 0.85 } },
    },
    swiftbladeRing: {
      id: 'swiftbladeRing', displayName: "Swiftblade Ring", icon: '💍', attunementCost: 2,
      source: 'buriedTreasure', category: 'combat',
      description: 'Weapon attacks are 12% faster.',
      effects: { stats: { attackSpeed: 1.12 } },
    },
    defendersBrooch: {
      id: 'defendersBrooch', displayName: "Defender's Brooch", icon: '🛡️', attunementCost: 2,
      source: 'buriedTreasure', category: 'combat',
      description: 'Take 12% less Health damage.',
      effects: { stats: { incomingHealthDamage: 0.88 } },
    },
    steadfastBeads: {
      id: 'steadfastBeads', displayName: 'Steadfast Beads', icon: '📿', attunementCost: 2,
      source: 'buriedTreasure', category: 'combat',
      description: 'Take 20% less affliction buildup.',
      effects: { stats: { incomingAffliction: 0.80 } },
    },
    runnersCord: {
      id: 'runnersCord', displayName: "Runner's Cord", icon: '🪢', attunementCost: 2,
      source: 'buriedTreasure', category: 'combat',
      description: 'Maximum Stamina +20%.',
      effects: { stats: { maxStamina: 1.20 } },
    },
    masonsRing: {
      id: 'masonsRing', displayName: "Mason's Ring", icon: '💍', attunementCost: 2,
      source: 'buriedTreasure', category: 'combat',
      description: 'Footing regenerates 35% faster.',
      effects: { stats: { footingRegen: 1.35 } },
    },

    // ── Harlyao ruins (dungeon chests) — Combat perk vocabulary ───────
    // Functional names; ids are stable so display names can change freely.
    // ── Specialized combat trinkets; all modifiers are composed by the existing providers. ──
    evasion: {
      id: 'evasion', displayName: 'Evasion', icon: '💨', attunementCost: 3,
      source: 'harlyaoRuin', category: 'combat',
      description: 'Dodge travel duration and invulnerability last 15% longer.',
      effects: { stats: { dodgeEfficacy: 1.15 } },
    },
    companionPoise: {
      id: 'companionPoise', displayName: 'Companion Poise', icon: '🐾', attunementCost: 2,
      source: 'harlyaoRuin', category: 'combat',
      description: 'Your animal companion deals 40% more Footing damage.',
      effects: { companion: { footing: 1.40 } },
    },
    rapidRecovery: {
      id: 'rapidRecovery', displayName: 'Rapid Recovery', icon: '🌱', attunementCost: 3,
      source: 'harlyaoRuin', category: 'combat',
      description: 'Naturally recovering afflictions recover 40% faster (not Bleeding or Poison).',
      effects: { stats: { afflictionRecovery: 1.40 } },
    },
    unshaken: {
      id: 'unshaken', displayName: 'Unshaken', icon: '🪨', attunementCost: 2,
      source: 'harlyaoRuin', category: 'combat',
      description: 'Footing recovery begins 0.9 seconds after a hit, rather than 1.5 seconds.',
      effects: { stats: { footingRecoveryDelay: 0.60 } },
    },
    secondBreath: {
      id: 'secondBreath', displayName: 'Second Breath', icon: '🫁', attunementCost: 2,
      source: 'harlyaoRuin', category: 'combat',
      description: 'Black-Stamina Exhaustion debt recovers 35% faster; ordinary Stamina regeneration is unchanged.',
      effects: { stats: { exhaustionRecovery: 1.35 } },
    },
    counterweight: {
      id: 'counterweight', displayName: 'Counterweight', icon: '⚓', attunementCost: 2,
      source: 'harlyaoRuin', category: 'combat',
      description: 'Incoming knockback travel is reduced by 30%; Footing damage is unchanged.',
      effects: { stats: { knockbackDistance: 0.70 } },
    },
    flaskmaster: {
      id: 'flaskmaster', displayName: 'Flaskmaster', icon: '🧨', attunementCost: 3,
      source: 'harlyaoRuin', category: 'combat',
      description: 'Your thrown flasks and Shattercasks you throw, strike, or trigger through your own Shattercask chain gain 25% stronger impacts and 15% wider blast radii.',
      effects: { stats: { flaskPower: 1.25, flaskRadius: 1.15, shatterPower: 1.25, shatterRadius: 1.15 } },
    },
    // ── Double-edged combat trinkets (definitions only; no acquisition source) ──
    // Trade-offs consume 1-2 Attunement. Risky alternatives with comparable
    // upside to a clean 2-point trinket cost 1, not 2.
    unstableBalance: {
      id: 'unstableBalance', displayName: 'Unstable Balance', icon: '⚖️', attunementCost: 1,
      category: 'combat', description: 'Your weapon hits deal 25% more Footing damage, but you receive 25% more Footing damage.',
      effects: { stats: { outgoingFootingDamage: 1.25, incomingFootingDamage: 1.25 } },
    },
    glassFang: {
      id: 'glassFang', displayName: 'Glass Fang', icon: '🦷', attunementCost: 2,
      category: 'combat', description: 'Your direct weapon hits deal 40% more Health damage, but you receive 30% more Health damage.',
      effects: { stats: { outgoingHealthDamage: 1.40, incomingHealthDamage: 1.30 } },
    },
    leadKnuckles: {
      id: 'leadKnuckles', displayName: 'Lead Knuckles', icon: '✊', attunementCost: 1,
      category: 'combat', description: 'Heavy weapon hits deal 60% more Footing damage, but heavy attacks cost 50% more Stamina.',
      effects: { stats: { heavyFootingDamage: 1.60, heavyAttackStaminaCost: 1.50 } },
    },
    bloodrush: {
      id: 'bloodrush', displayName: 'Bloodrush', icon: '🩸', attunementCost: 2,
      category: 'combat', description: 'Weapon attacks are 35% faster, but attack Stamina costs are 35% higher.',
      effects: { stats: { attackSpeed: 1.35, attackStaminaCost: 1.35 } },
    },
    ironAnchor: {
      id: 'ironAnchor', displayName: 'Iron Anchor', icon: '⚓', attunementCost: 1,
      category: 'combat', description: 'Receive 60% less knockback, but dodge travel is 40% shorter (invulnerability is unchanged).',
      effects: { stats: { knockbackDistance: 0.40, dodgeTravel: 0.60 } },
    },
    hollowLungs: {
      id: 'hollowLungs', displayName: 'Hollow Lungs', icon: '🫁', attunementCost: 1,
      category: 'combat', description: 'Black-Stamina Exhaustion debt recovers 75% faster, but maximum Stamina is reduced by 25%.',
      effects: { stats: { exhaustionRecovery: 1.75, maxStamina: 0.75 } },
    },
    falseCourage: {
      id: 'falseCourage', displayName: 'False Courage', icon: '🛡️', attunementCost: 2,
      category: 'combat', description: 'Receive 40% less Health damage, but 60% more Footing damage.',
      effects: { stats: { incomingHealthDamage: 0.60, incomingFootingDamage: 1.60 } },
    },
    fracturedGuard: {
      id: 'fracturedGuard', displayName: 'Fractured Guard', icon: '🪞', attunementCost: 2,
      category: 'combat', description: 'Dodge invulnerability lasts 40% longer, but dodges cost twice as much Stamina.',
      effects: { stats: { dodgeIframe: 1.40, dodgeStaminaCost: 2.00 } },
    },
    venomousBlood: {
      id: 'venomousBlood', displayName: 'Venomous Blood', icon: '🐍', attunementCost: 2,
      category: 'combat', description: 'Your weapon hits inflict 60% more affliction buildup, but affliction buildup on you is 40% greater.',
      effects: { stats: { outgoingAffliction: 1.60, incomingAffliction: 1.40 } },
    },
    berserkersBargain: {
      id: 'berserkersBargain', displayName: "Berserker's Bargain", icon: '💀', attunementCost: 2,
      category: 'combat', description: 'Below 35% Health, your weapon hits deal 50% more damage, but you receive 50% less healing.',
      effects: { stats: { lowHealthDamage: 1.50, lowHealthHealing: 0.50 } },
    },
    shatterheart: {
      id: 'shatterheart', displayName: 'Shatterheart', icon: '💔', attunementCost: 2,
      category: 'combat', description: 'Your weapon hits deal double Health damage to prone enemies, but your Footing regenerates 40% slower.',
      effects: { stats: { proneTargetDamage: 2.00, footingRegen: 0.60 } },
    },
    deathsMomentum: {
      id: 'deathsMomentum', displayName: "Death's Momentum", icon: '🗡️', attunementCost: 2,
      category: 'combat', description: 'A credited enemy kill by you or your companion restores 40% of maximum Stamina (or 40 black-Stamina points while Exhausted), but ordinary Stamina regenerates 50% slower.',
      effects: { stats: { killStaminaRestore: 1.40, ordinaryStaminaRegen: 0.50 } },
    },
    gamblersEye: {
      id: 'gamblersEye', displayName: "The Gambler's Eye", icon: '🎯', attunementCost: 2,
      category: 'combat', description: 'Your ranged weapon projectiles deal 60% more Health damage, but travel 35% slower.',
      effects: { stats: { rangedDamage: 1.60, rangedProjectileSpeed: 0.65 } },
    },
    harlyaoReachShard: {
      id: 'harlyaoReachShard', displayName: 'Harlyao Reach Shard', icon: '🦴', attunementCost: 1,
      source: 'harlyaoRuin', category: 'combat',
      description: '+2 ranks of Increase AoE.', effects: { perkRanks: { increaseAoe: 2 } },
    },
    harlyaoStridingBone: {
      id: 'harlyaoStridingBone', displayName: 'Harlyao Striding Bone', icon: '🦴', attunementCost: 1,
      source: 'harlyaoRuin', category: 'combat',
      description: '+2 ranks of Increase Lunge Distance.', effects: { perkRanks: { increaseLungeDistance: 2 } },
    },
    harlyaoTopplingKnuckle: {
      id: 'harlyaoTopplingKnuckle', displayName: 'Harlyao Toppling Knuckle', icon: '✊', attunementCost: 2,
      source: 'harlyaoRuin', category: 'combat',
      description: '+2 ranks of Increase Footing Damage.', effects: { perkRanks: { increaseFootingDamage: 2 } },
    },
    harlyaoRootedAnklet: {
      id: 'harlyaoRootedAnklet', displayName: 'Harlyao Rooted Anklet', icon: '⚓', attunementCost: 2,
      source: 'harlyaoRuin', category: 'combat',
      description: '+2 ranks of Increase Footing Resistance.', effects: { perkRanks: { increaseFootingResistance: 2 } },
    },
    harlyaoQuickFang: {
      id: 'harlyaoQuickFang', displayName: 'Harlyao Quick Fang', icon: '🦷', attunementCost: 2,
      source: 'harlyaoRuin', category: 'combat',
      description: '+3 ranks of Empower Quick Attacks.', effects: { perkRanks: { empowerQuickAttacks: 3 } },
    },
    harlyaoCrushingWeight: {
      id: 'harlyaoCrushingWeight', displayName: 'Harlyao Crushing Weight', icon: '🪨', attunementCost: 2,
      source: 'harlyaoRuin', category: 'combat',
      description: '+3 ranks of Empower Heavy Attacks.', effects: { perkRanks: { empowerHeavyAttacks: 3 } },
    },
    harlyaoWardingPlate: {
      id: 'harlyaoWardingPlate', displayName: 'Harlyao Warding Plate', icon: '🛡️', attunementCost: 2,
      source: 'harlyaoRuin', category: 'combat',
      description: '+3 ranks of Empower Defensive Attacks.', effects: { perkRanks: { empowerDefensiveAttacks: 3 } },
    },
    harlyaoTirelessBead: {
      id: 'harlyaoTirelessBead', displayName: 'Harlyao Tireless Bead', icon: '📿', attunementCost: 3,
      source: 'harlyaoRuin', category: 'combat',
      description: '+2 ranks of Reduce Stamina Use.', effects: { perkRanks: { reduceStaminaUse: 2 } },
    },
    harlyaoAfflictionCenser: {
      id: 'harlyaoAfflictionCenser', displayName: 'Harlyao Affliction Censer', icon: '🏺', attunementCost: 3,
      source: 'harlyaoRuin', category: 'combat',
      description: '+2 ranks each of Empower Damage Effects and Empower Control Effects.',
      effects: { perkRanks: { empowerDamageEffects: 2, empowerControlEffects: 2 } },
    },
    harlyaoHexSigil: {
      id: 'harlyaoHexSigil', displayName: 'Harlyao Hex Sigil', icon: '🔯', attunementCost: 3,
      source: 'harlyaoRuin', category: 'combat',
      description: '+2 ranks each of Empower Offensive Debuffs and Empower Defensive Debuffs.',
      effects: { perkRanks: { empowerOffensiveDebuffs: 2, empowerDefensiveDebuffs: 2 } },
    },
    harlyaoBloodPact: {
      id: 'harlyaoBloodPact', displayName: 'Harlyao Blood Pact', icon: '🩸', attunementCost: 3,
      source: 'harlyaoRuin', category: 'combat',
      description: '+4 ranks of Empower Raw Damage, but Maximum Health −20%.',
      effects: { perkRanks: { empowerRawDamage: 4 }, stats: { maxHealth: 0.80 } },
    },
    harlyaoWarCrown: {
      id: 'harlyaoWarCrown', displayName: 'Harlyao War Crown', icon: '👑', attunementCost: 5,
      source: 'harlyaoRuin', category: 'combat',
      description: '+2 ranks of Empower Raw Damage and +1 rank each of Increase Health, Increase Stamina, and Increase Footing Damage.',
      effects: { perkRanks: { empowerRawDamage: 2, increaseHealth: 1, increaseStamina: 1, increaseFootingDamage: 1 } },
    },
  });

  const SPECIAL_HANDLERS = {}; // id -> { onEquip?, onUnequip? } for effects the data channels cannot express.

  let fallbackGear = null; // Isolated tests/tools without game.js.
  let initialized = false;

  function gear() {
    const g = window.Combat?.deps?.getGearInventory?.() || fallbackGear || (fallbackGear = {});
    ensureCollections(g);
    return g;
  }

  function save() {
    window.Combat?.deps?.saveGearInventory?.();
  }

  function player() {
    return window.Combat?.deps?.player || null;
  }

  function toast(message, ok) {
    (window.Combat?.deps?.showToast || window.showToast)?.(message, ok);
  }

  let uidCounter = 0; // Guarantees distinct uids for several grants within one millisecond (loot bundles).
  function newUid() {
    uidCounter = (uidCounter + 1) % 1e6;
    return 'tr_' + Date.now().toString(36) + '_' + uidCounter.toString(36) + '_' + Math.floor(Math.random() * 1e6).toString(36);
  }

  // Old saves: no trinket fields (and an always-empty legacy `charms` list).
  // Any legacy charm that names a known trinket id is carried over, never
  // dropped. Unknown/removed ids stay in the owned list untouched so a later
  // data restore can bring them back.
  function ensureCollections(g) {
    if (!g) return g;
    if (!Array.isArray(g.trinkets)) g.trinkets = [];
    if (!Array.isArray(g.equippedTrinkets)) g.equippedTrinkets = [];
    if (Array.isArray(g.charms) && g.charms.length && !g.__charmsMigrated) {
      for (const charm of g.charms) {
        const id = typeof charm === 'string' ? charm : charm?.id;
        if (DEFINITIONS[id] && !g.trinkets.some(t => t.legacyCharm === charm)) g.trinkets.push({ uid: newUid(), id, legacyCharm: typeof charm === 'string' ? charm : undefined });
      }
      g.__charmsMigrated = true;
    }
    const owned = new Set(g.trinkets.map(t => t.uid));
    g.equippedTrinkets = [...new Set(g.equippedTrinkets.filter(uid => owned.has(uid)))];
    return g;
  }

  function capacity() {
    return ATTUNEMENT_CAPACITY + Math.max(0, Number(window.LichHeartSystem?.count?.()) || 0); // Each distinct character-owned Lich-heart permanently extends the shared trinket budget by one.
  }

  function ownedEntries() {
    return gear().trinkets.map(entry => ({ ...entry, def: DEFINITIONS[entry.id] || null }));
  }

  function equippedEntries() {
    const g = gear();
    const byUid = new Map(g.trinkets.map(t => [t.uid, t]));
    return g.equippedTrinkets.map(uid => byUid.get(uid)).filter(Boolean).map(entry => ({ ...entry, def: DEFINITIONS[entry.id] || null }));
  }

  function costOf(id) {
    return Math.max(0, Number(DEFINITIONS[id]?.attunementCost) || 0);
  }

  function usedAttunement() {
    return equippedEntries().reduce((sum, entry) => sum + costOf(entry.id), 0);
  }

  function isEquipped(uid) {
    return gear().equippedTrinkets.includes(uid);
  }

  function canEquip(uid) {
    const g = gear();
    const entry = g.trinkets.find(t => t.uid === uid);
    const used = usedAttunement();
    const cap = capacity();
    if (!entry) return { ok: false, reason: 'not-owned', used, capacity: cap, cost: 0 };
    if (!DEFINITIONS[entry.id]) return { ok: false, reason: 'unknown-trinket', used, capacity: cap, cost: 0 };
    const cost = costOf(entry.id);
    if (isEquipped(uid)) return { ok: false, reason: 'already-equipped', used, capacity: cap, cost };
    if (used + cost > cap) return { ok: false, reason: 'insufficient-attunement', used, capacity: cap, cost, free: Math.max(0, cap - used) };
    return { ok: true, reason: null, used, capacity: cap, cost, after: used + cost };
  }

  function equip(uid) {
    const check = canEquip(uid);
    if (!check.ok) {
      if (check.reason === 'insufficient-attunement') {
        toast(`Insufficient Attunement: needs ${check.cost}, only ${check.free} of ${check.capacity} free.`, false);
      }
      return check;
    }
    const g = gear();
    g.equippedTrinkets.push(uid);
    const entry = g.trinkets.find(t => t.uid === uid);
    SPECIAL_HANDLERS[DEFINITIONS[entry.id]?.handler]?.onEquip?.(entry);
    save();
    afterChange();
    return { ...check, ok: true };
  }

  function unequip(uid) {
    const g = gear();
    const index = g.equippedTrinkets.indexOf(uid);
    if (index < 0) return false;
    g.equippedTrinkets.splice(index, 1);
    const entry = g.trinkets.find(t => t.uid === uid);
    if (entry) SPECIAL_HANDLERS[DEFINITIONS[entry.id]?.handler]?.onUnequip?.(entry);
    save();
    afterChange();
    return true;
  }

  function grant(id, source = 'grant') {
    if (!DEFINITIONS[id]) return null;
    const entry = { uid: newUid(), id, source };
    gear().trinkets.push(entry);
    save();
    afterChange();
    return entry.uid;
  }

  // Loot-pool bundles ({itemKey: qty}) may contain trinket_<id> keys. They
  // become gear trinkets here and are removed from the bundle so the normal
  // inventory grant never sees them. Returns display parts.
  function claimLoot(gained, source = 'loot') {
    const parts = [];
    for (const key of Object.keys(gained || {})) {
      if (!key.startsWith(LOOT_KEY_PREFIX)) continue;
      const id = key.slice(LOOT_KEY_PREFIX.length);
      const qty = Math.max(0, Math.floor(Number(gained[key]) || 0));
      delete gained[key];
      if (!DEFINITIONS[id]) continue;
      for (let i = 0; i < qty; i++) grant(id, source);
      if (qty > 0) parts.push(`${DEFINITIONS[id].icon} ${DEFINITIONS[id].displayName}${qty > 1 ? ' ×' + qty : ''} (trinket)`);
    }
    return parts;
  }

  function afterChange() {
    const p = player();
    if (p && window.ResourceSystem?.enforceCaps) window.ResourceSystem.enforceCaps(p); // A lowered maximum clamps current values through the normal cap path.
    if (typeof document !== 'undefined') {
      window.EquipmentPanel?.buildEquipmentSlots?.();
      window.PerkSystem?.render?.();
    }
  }

  // ── Effect channels ──────────────────────────────────────────────
  const MIN_STACKED_MULTIPLIER = 0.1; // Prevents additive reductions from removing all incoming damage, recovery or Stamina cost.
  function statMultiplier(entity, key) {
    if (!entity) return 1;
    if (entity !== player()) return entity._enemyTrinketStats?.[key] ?? 1; // Enemies use spawn-cached definitions; unassigned NPCs remain unchanged.
    let delta = 0; // Each trinket adds its percentage relative to baseline, not to the result of previous trinkets.
    for (const entry of equippedEntries()) {
      const value = Number(entry.def?.effects?.stats?.[key]);
      if (Number.isFinite(value) && value > 0) delta += value - 1;
    }
    return Math.max(MIN_STACKED_MULTIPLIER, 1 + delta);
  }

  function scaleEnemyHit(entity, amount, options = {}) {
    if (!entity?._enemyTrinketStats || entity === player()) return null;
    const health = statMultiplier(entity, 'outgoingHealthDamage'); // Combat damage uses the identical additive bonus as the player's stat provider.
    const footing = statMultiplier(entity, 'outgoingFootingDamage'); // Footing must not inherit an unrelated Health-only trinket bonus.
    if (health === 1 && footing === 1) return null;
    const priorFooting = Number(options.footingDamageMultiplier); // The attack's pre-existing Footing coefficient remains authoritative.
    return {
      amount: amount * health,
      options: { ...options, footingDamageMultiplier: (Number.isFinite(priorFooting) ? priorFooting : 1) * footing / health },
    };
  }

  function configureEnemy(entity, ids) {
    if (!entity || entity === player()) return [];
    const selected = []; // Exact physical trinket ids on this enemy, available to combat diagnostics.
    const byStat = Object.create(null); // Spawn-time stat deltas; the per-frame modifier provider only performs a property lookup.
    let spent = 0; // Enemies use the base 8-point budget, never the player's Lich-heart expansion.
    for (const id of Array.isArray(ids) ? ids : []) {
      const def = DEFINITIONS[id], cost = costOf(id);
      if (!def?.effects?.stats || def.effects.perkRanks || def.effects.companion || !cost || spent + cost > ATTUNEMENT_CAPACITY || selected.includes(id)) continue;
      spent += cost;
      selected.push(id);
      for (const [key, raw] of Object.entries(def.effects.stats)) {
        const value = Number(raw);
        if (Number.isFinite(value) && value > 0) byStat[key] = (byStat[key] || 0) + value - 1;
      }
    }
    entity.enemyTrinketIds = selected;
    entity._enemyTrinketStats = Object.freeze(Object.fromEntries(
      Object.entries(byStat).map(([key, delta]) => [key, Math.max(MIN_STACKED_MULTIPLIER, 1 + delta)])
    ));
    return selected;
  }

  function rollEnemyLoadout(tuning, rank, tier, random = Math.random) {
    if (!Array.isArray(tuning?.pool) || typeof random !== 'function') return [];
    const danger = Math.max(0, Math.min(7, Math.floor(Number(tier) || 0))); // The existing eight-tier enemy progression controls access to trinket combinations.
    const chance = Math.max(0, Math.min(1, (Number(tuning.chanceByRank?.[rank]) || 0) + danger * (Number(tuning.chancePerTier) || 0))); // Each rank gains trinkets as its danger tier increases.
    if (random() >= chance) return [];
    const limit = Math.max(0, Math.min(8, Math.floor(Number(tuning.maxByRank?.[rank]) || 0))); // Rarity/rank caps prevent every enemy from wearing a full 8-point build.
    const extraChance = Math.max(0, Math.min(1, (Number(tuning.extraChancePerTier) || 0) * danger)); // Additional rolls become more likely later in the wilderness.
    const pool = [...new Set(tuning.pool)].filter(id => {
      const def = DEFINITIONS[id];
      return def?.effects?.stats && !def.effects.perkRanks && !def.effects.companion && costOf(id) > 0 && costOf(id) <= ATTUNEMENT_CAPACITY;
    }); // Use the shared catalog, never copied enemy-only bonuses.
    const chosen = []; // Rolled once at spawn; no random work while the enemy fights.
    let used = 0;
    while (chosen.length < limit && pool.length && (chosen.length === 0 || random() < extraChance)) {
      const eligible = pool.filter(id => used + costOf(id) <= ATTUNEMENT_CAPACITY);
      if (!eligible.length) break;
      const id = eligible[Math.min(eligible.length - 1, Math.floor(Math.max(0, Math.min(0.999999999, Number(random()) || 0)) * eligible.length))];
      chosen.push(id);
      used += costOf(id);
      pool.splice(pool.indexOf(id), 1);
    }
    return chosen;
  }

  function perkBonusRanks(skillKey, perkId) {
    if (skillKey !== 'combat') return 0;
    let bonus = 0;
    for (const entry of equippedEntries()) bonus += Math.max(0, Number(entry.def?.effects?.perkRanks?.[perkId]) || 0);
    return bonus;
  }

  function companionModifiers() {
    const out = { damage: 1, footing: 1, affliction: 1 };
    for (const entry of equippedEntries()) {
      const c = entry.def?.effects?.companion;
      if (!c) continue;
      for (const channel of Object.keys(out)) {
        const value = Number(c[channel]);
        if (Number.isFinite(value) && value > 0) out[channel] += value - 1;
      }
    }
    for (const channel of Object.keys(out)) out[channel] = Math.max(MIN_STACKED_MULTIPLIER, out[channel]);
    return out.damage === 1 && out.footing === 1 && out.affliction === 1 ? null : out;
  }

  // ── UI ──────────────────────────────────────────────────────────
  function esc(text) {
    return String(text ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  }

  function pips(cost) {
    return '◆'.repeat(Math.max(0, cost));
  }

  function renderEquipmentSection(sec) {
    if (!sec || typeof document === 'undefined') return;
    const previousGroup = sec.querySelector?.('.gear-owned-trinkets'); // Replaced when the section is directly refreshed without rebuilding all equipment.
    previousGroup?.remove?.();
    const ownedSection = sec.querySelector?.(':scope > .gear-owned-section'); // Uses the decorated Gear inventory when it already exists.
    const group = document.createElement('div'); // Keeps every trinket row, empty state and diagnostic together for Gear layout placement.
    group.className = 'gear-owned-group gear-owned-trinkets';
    (ownedSection || sec).appendChild(group);
    const used = usedAttunement();
    const cap = capacity();
    const over = used > cap;

    const hdr = document.createElement('div');
    hdr.className = 'inv-equip-label trinket-attunement-label';
    const heartBonus = window.LichHeartSystem?.count?.() || 0; // Shows where the permanently gained capacity comes from.
    hdr.innerHTML = `Trinkets — <strong style="color:${over ? '#ff8080' : 'var(--accent, #f9e28a)'}">Attunement: ${used} / ${cap}</strong>${heartBonus ? ` <small>(+${heartBonus} Lich-heart${heartBonus === 1 ? '' : 's'})</small>` : ''}`;
    group.appendChild(hdr);
    if (over) {
      const warn = document.createElement('div');
      warn.className = 'inv-equip-empty';
      warn.textContent = 'Over the Attunement budget (older save). Nothing was removed, but you cannot equip more until you are back under the limit.';
      group.appendChild(warn);
    }

    const owned = ownedEntries();
    if (!owned.length) {
      const empty = document.createElement('div');
      empty.className = 'inv-equip-empty';
      empty.textContent = 'No trinkets yet. Icons are sold in town; Harlyao ruins and Porakaneki traders hold others.';
      group.appendChild(empty);
      return;
    }

    const list = document.createElement('div');
    list.className = 'trinket-inventory-list';
    list.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
    const equippedIds = new Set(equippedEntries().map(entry => entry.uid)); // Snapshot for sorting and rendering without repeatedly normalizing gear.
    const categoryLabels = { icon: 'Icons', companion: 'Companion', combat: 'Combat' }; // Authored categories for available trinket headings.
    const categoryLabel = entry => categoryLabels[entry.def?.category] || entry.def?.category || 'Other';
    const sorted = owned.slice().sort((a, b) =>
      Number(equippedIds.has(b.uid)) - Number(equippedIds.has(a.uid)) ||
      categoryLabel(a).localeCompare(categoryLabel(b)) ||
      costOf(a.id) - costOf(b.id) ||
      (a.def?.displayName || a.id).localeCompare(b.def?.displayName || b.id) ||
      String(a.uid).localeCompare(String(b.uid)));
    let previousHeading = null; // Insert one heading per contiguous equipped/available category.
    for (const entry of sorted) {
      const heading = equippedIds.has(entry.uid) ? 'Equipped' : 'Available — ' + categoryLabel(entry); // Keep equipped trinkets together regardless of their category.
      if (heading !== previousHeading) {
        const sectionLabel = document.createElement('div'); // Noninteractive section label; existing row buttons remain controller targets.
        sectionLabel.className = 'inv-equip-label trinket-inventory-heading';
        sectionLabel.style.cssText = 'margin:6px 0 2px;font-weight:700;';
        sectionLabel.textContent = heading;
        list.appendChild(sectionLabel);
        previousHeading = heading;
      }
      const def = entry.def;
      const equipped = equippedIds.has(entry.uid); // UI snapshot; equip() revalidates against live state on click.
      const cost = costOf(entry.id);
      const check = equipped ? null : !def ? { ok: false, reason: 'unknown-trinket' } :
        used + cost > cap ? { ok: false, reason: 'insufficient-attunement', free: Math.max(0, cap - used) } : { ok: true };
      const row = document.createElement('div');
      row.className = 'inv-equip-slot trinket-inventory-row' + (equipped ? ' active-slot occupied' : '');
      row.style.cssText = 'display:flex;flex-direction:row;align-items:center;gap:8px;padding:5px 8px;flex:0 0 auto;height:auto;box-sizing:border-box;text-align:left;justify-content:flex-start;';
      row.innerHTML = `<span style="font-size:1.4em">${def?.icon || '❔'}</span>
        <span style="flex:1;min-width:0;display:flex;flex-direction:column;">
          <span style="font-weight:600">${esc(def?.displayName || entry.id)} <span title="Attunement cost" style="opacity:.8">${pips(cost)} ${cost}</span></span>
          <span style="font-size:11px;opacity:.8">${esc(def?.description || 'Unknown trinket (kept for save compatibility).')}</span>
          ${!equipped && check && !check.ok && check.reason === 'insufficient-attunement' ? `<span style="font-size:11px;color:#ff8080">Insufficient Attunement — needs ${cost}, ${check.free} free</span>` : ''}
        </span>`;
      const button = document.createElement('button');
      button.className = 'ii-btn' + (equipped ? '' : ' equip');
      button.type = 'button';
      button.textContent = equipped ? 'Unequip' : `Equip (${cost})`;
      if (!equipped && check && !check.ok) button.disabled = true;
      button.addEventListener('click', event => {
        event.stopPropagation();
        if (equipped) unequip(entry.uid);
        else equip(entry.uid);
      });
      row.appendChild(button);
      list.appendChild(row);
    }
    group.appendChild(list);

    const details = document.createElement('details');
    details.className = 'trinket-debug';
    details.innerHTML = '<summary style="font-size:11px;opacity:.75">Trinket diagnostics</summary>';
    const pre = document.createElement('pre');
    pre.style.cssText = 'white-space:pre-wrap;font-size:10px;max-height:200px;overflow:auto;';
    pre.textContent = debugLines().join('\n');
    details.appendChild(pre);
    group.appendChild(details);
  }

  function debugLines() {
    const equipped = equippedEntries();
    const p = player();
    const lines = [`Attunement: ${usedAttunement()} / ${capacity()}`];
    for (const entry of equipped) lines.push(`• ${entry.def?.displayName || entry.id} — ${costOf(entry.id)}`);
    if (!equipped.length) lines.push('• (no trinkets equipped)');
    if (p) {
      const mods = ['maxHealth', 'maxStamina', 'maxFooting', 'healthRegen', 'healthRegenInCombat', 'staminaRegen', 'footingRegen', 'outgoingHealthDamage', 'outgoingFootingDamage', 'incomingHealthDamage', 'incomingFootingDamage', 'attackSpeed', 'attackStaminaCost', 'heavyAttackStaminaCost', 'dodgeTravel', 'dodgeIframe', 'dodgeStaminaCost', 'exhaustionRecovery', 'ordinaryStaminaRegen', 'outgoingAffliction', 'incomingAffliction', 'lowHealthDamage', 'lowHealthHealing', 'proneTargetDamage', 'killStaminaRestore', 'rangedDamage', 'rangedProjectileSpeed']
        .map(key => [key, statMultiplier(p, key)]).filter(([, v]) => v !== 1).map(([k, v]) => `${k} ×${v.toFixed(2)}`);
      if (mods.length) lines.push(`Stat mods: ${mods.join(', ')}`);
    }
    const perks = {};
    for (const entry of equipped) for (const [perk, ranks] of Object.entries(entry.def?.effects?.perkRanks || {})) perks[perk] = (perks[perk] || 0) + ranks;
    if (Object.keys(perks).length) lines.push(`Bonus perk ranks: ${Object.entries(perks).map(([k, v]) => `${k} +${v}`).join(', ')}`);
    const comp = companionModifiers();
    if (comp) lines.push(`Companion: damage ×${comp.damage.toFixed(2)}, affliction ×${comp.affliction.toFixed(2)}, footing ×${comp.footing.toFixed(2)}`);
    const doubleEdgedDebug = window.DoubleEdgedCombatTrinkets?.debugSnapshot?.(); // Makes recent weapon-hit and kill-refund attribution visible on mobile in Gear diagnostics.
    if (doubleEdgedDebug?.lastHit) {
      const hit = doubleEdgedDebug.lastHit; // Most recent wearer-attributed hit after resolving player gear.
      lines.push(`Last combat hit: Health ×${hit.damageMultiplier.toFixed(2)}, Footing ×${hit.footingMultiplier.toFixed(2)}, Affliction ×${hit.afflictionMultiplier.toFixed(2)}; heavy=${hit.heavy}, ranged=${hit.ranged}, prone=${hit.proneTarget}`);
    }
    if (doubleEdgedDebug?.lastKill) {
      const kill = doubleEdgedDebug.lastKill; // Most recent credited hostile kill with Death's Momentum equipped.
      lines.push(`Last Death's Momentum: ${kill.enemy}, ordinary +${Number(kill.restored?.stamina || 0).toFixed(1)}, black +${Number(kill.restored?.blackStamina || 0).toFixed(1)}`);
    }
    return lines;
  }

  function debugSnapshot() {
    return {
      capacity: capacity(),
      lichHeartBonus: window.LichHeartSystem?.count?.() || 0,
      used: usedAttunement(),
      equipped: equippedEntries().map(entry => ({ uid: entry.uid, id: entry.id, cost: costOf(entry.id) })),
      owned: ownedEntries().map(entry => ({ uid: entry.uid, id: entry.id, cost: costOf(entry.id) })),
      lines: debugLines(),
    };
  }

  function init() {
    if (initialized) return;
    initialized = true;
    window.DevCompanion?.registerCheatPanel?.({
      id: 'trinket-grants', title: 'Trinkets', order: 33,
      render: () => ({ actions: [{ id: 'grant', label: 'Grant trinket', reset: true,
        options: [{ value: '', label: 'Choose a trinket…' }, ...Object.values(DEFINITIONS).map(def => ({ value: def.id, label: `${def.icon} ${def.displayName} (${def.attunementCost})` }))] }] }),
      onAction: (action, { value }) => {
        if (action !== 'grant' || !DEFINITIONS[value]) return { ok: false };
        return { ok: !!grant(value, 'dev') };
      },
    });
    window.ResourceSystem?.registerStatModifierProvider?.(statMultiplier);
    window.PerkSystem?.registerBonusRankProvider?.(perkBonusRanks);
    window.CompanionOffense?.registerProvider?.('trinkets', () => companionModifiers());
  }

  window.TrinketSystem = Object.freeze({
    ATTUNEMENT_CAPACITY,
    LOOT_KEY_PREFIX,
    DEFINITIONS,
    init,
    capacity,
    costOf,
    usedAttunement,
    ownedEntries,
    equippedEntries,
    isEquipped,
    canEquip,
    equip,
    unequip,
    grant,
    claimLoot,
    statMultiplier,
    configureEnemy,
    rollEnemyLoadout,
    scaleEnemyHit,
    combatMultiplier: key => statMultiplier(player(), key), // Shared player-only combat-effect read for collision, flask, and dodge adapters.
    perkBonusRanks,
    companionModifiers,
    ensureCollections,
    renderEquipmentSection,
    debugLines,
    debugSnapshot,
    _setFallbackGear: g => { fallbackGear = g; },
  });

  init();
})();
