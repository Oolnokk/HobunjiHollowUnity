// Rare high-danger bandit captain weapons. Donors and pair legality always come from
// the live cultural bandit pool and the Foundry's authored modular catalog.
(() => {
  'use strict';
  const PREFIX = 'banditModular:'; // Unique per-captain keys prevent two drops from sharing enchantments or replacing a forged weapon.
  const MIN_STARS = 5; // Camp tier is zero-based; only five-to-eight-star ordinary captains qualify.
  const BASE_IDS = Object.freeze(['burning', 'frostbitten', 'mirrored', 'livingFlame']); // Effects supported by the NPC hit event; omit player-only Living Gust.
  const FLOURISH_IDS = Object.freeze(['fury', 'moralized', 'resolve']); // Never choose Sicced (player companion target lock) or Fey magic.
  const FLOURISH_SLOTS = Object.freeze(['tap1', 'tap2', 'hold1']); // These are the NPC's real offensive Combo/Quick/Charged slots.
  const unlooted = new Map(); // Spawned captains' enchantments stay outside player gear until the corpse is searched.
  let deps = null; // HarlyaoRelics.init supplies the ordinary saved-gear, tool definition and texture services.
  let serial = 0; // Unique weapon IDs across multiple captains spawned during the same millisecond.
  const random = () => window.GameRandom?.random?.() ?? Math.random();
  const gear = () => deps?.getGearInventory?.() || null;
  const choose = (items, rng = random) => items[Math.min(items.length - 1, Math.max(0, Math.floor(rng() * items.length)))];
  const capStars = tier => Math.max(1, Math.min(8, Math.floor(Number(tier) || 0) + 1));
  const enchantmentCount = stars => Math.max(0, Math.min(5, stars - 3)); // 5★:2, 6★:3, 7★:4, 8★:5; two Base plus up to three useful offensive Flourishes.

  function rollEnchantments(stars, rng = random) {
    const definitions = window.EnchantmentSystem?.DEFINITIONS || {};
    const bases = BASE_IDS.filter(id => definitions[id]?.type === 'Base' && definitions[id]?.alignment !== 'Fey');
    const flourishes = FLOURISH_IDS.filter(id => definitions[id]?.type === 'Flourish' && definitions[id]?.alignment !== 'Fey');
    if (bases.length < 2 || flourishes.length < 3) return null; // Never silently issue fewer enchantments than the star rating promises.
    const pool = bases.slice(), base = [];
    while (base.length < 2) {
      const index = Math.min(pool.length - 1, Math.max(0, Math.floor(rng() * pool.length)));
      base.push(pool.splice(index, 1)[0]);
    }
    const available = flourishes.slice(), slots = FLOURISH_SLOTS.slice(), result = {};
    for (let i = 2; i < enchantmentCount(stars); i++) {
      const slot = slots.splice(Math.min(slots.length - 1, Math.floor(rng() * slots.length)), 1)[0];
      const id = available.splice(Math.min(available.length - 1, Math.floor(rng() * available.length)), 1)[0];
      result[slot] = id;
    }
    return { base, flourishes: result };
  }

  function rollFeyEnchantments(stars, rng = random) {
    const defs = Object.values(window.EnchantmentSystem?.DEFINITIONS || {}).filter(d=>d.alignment==='Fey');
    const bases = defs.filter(d=>d.type==='Base').map(d=>d.id); // NPC hit bridge supports the same real Fey effects as player weapons.
    const flourishes = defs.filter(d=>d.type==='Flourish').map(d=>d.id);
    const base=[], result={};
    const take = list => list.splice(Math.min(list.length-1,Math.floor(rng()*list.length)),1)[0];
    const count = Math.max(1, enchantmentCount(stars));
    while(base.length<Math.min(count,2)&&bases.length)base.push(take(bases));
    const slots=FLOURISH_SLOTS.slice();
    for(let i=base.length;i<count&&flourishes.length&&slots.length;i++)result[take(slots)]=take(flourishes);
    return base.length||Object.keys(result).length?{base,flourishes:result}:null;
  }

  function eligiblePairs(sources, catalog = window.ModularWeapons) {
    const config = catalog?.getConfig?.();
    const allowed = new Set(sources || []); // This encounter's *whole-weapon* donor pool, not the player's Foundry unlock list.
    if (!allowed.size || !config) return [];
    const pairs = [];
    for (const [shaftKey, shaft] of Object.entries(config.shafts || {})) {
      if (shaft.editorOnly || !allowed.has(shaft.sourceShape)) continue;
      for (const [headKey, head] of Object.entries(config.heads || {})) {
        if (head.editorOnly || head.craftDisabled || !allowed.has(head.sourceShape)) continue;
        if (catalog.isDisallowed(shaftKey, headKey)) continue; // Same explicit allow/disallow, mount matching and flail rules as Foundry.
        pairs.push({ shaft: shaftKey, head: headKey, donors: [shaft.sourceShape, head.sourceShape] });
      }
    }
    return pairs;
  }

  function permittedDonors(entity) {
    const fromCulturalRoll = entity?._weaponTrustCulturalLoadout?.melee?.allowed; // Exact pool chosen when the cultural wrapper ran first.
    if (Array.isArray(fromCulturalRoll) && fromCulturalRoll.length) return fromCulturalRoll;
    const species = entity?.rosterRecord?.appearance?.speciesId || null;
    const fromBridge = window.WeaponTrustBanditLoadouts?.allowedMeleeShapes?.(species); // Future cultural weapons inherit the same NPC-giver species checks.
    if (Array.isArray(fromBridge) && fromBridge.length) return fromBridge;
    const trust = window.WEAPON_TRUST_VISIT_CONFIG; // Before dialogue/giver records initialize, exclude culture-locked weapons rather than leak them.
    const locked = new Set((trust?.gifts || []).map(entry => entry.shapeKey));
    return (trust?.bandits?.weaponShapePool || []).filter(shape => !locked.has(shape));
  }

  function registerDefinition(key, record) {
    const modular = window.ModularWeapons;
    const parts = modular?.decode?.(key); // Reject forged keys, missing catalog parts and corrupted persisted records.
    if (!parts || !key.startsWith(PREFIX) || parts.shaft !== record?.shaft || parts.head !== record?.head || parts.metal !== record?.metal) return false;
    const baseKey = modular.itemKey(parts.shaft, parts.head, parts.metal); // Ordinary modular definition and sprite are the sole art/behavior authorities.
    const source = deps?.TOOL_ITEM_DEFS?.[baseKey];
    if (!source?.modular || !source.slots?.includes('weapon')) return false;
    if (!deps.TOOL_ITEM_DEFS[key]) deps.TOOL_ITEM_DEFS[key] = {
      ...source, itemKey: key, sprite: source.sprite || baseKey,
      label: (record.origin === 'Fey' ? 'Fey-touched ' : 'Captain\'s ') + String(source.label || 'Modular Weapon'),
      captainModular: true, // Looted special gear must never be confused with a newly discovered full weapon donor.
    };
    deps.ensureToolTexture?.(key);
    return true;
  }

  function restore() {
    const inventory = gear();
    if (!inventory || !deps?.TOOL_ITEM_DEFS) return 0;
    if (!inventory.captainModularWeapons || typeof inventory.captainModularWeapons !== 'object' || Array.isArray(inventory.captainModularWeapons)) inventory.captainModularWeapons = {};
    let count = 0;
    for (const [key, record] of Object.entries(inventory.captainModularWeapons)) {
      if (inventory.tools?.[key] && registerDefinition(key, record)) count++;
    }
    return count;
  }
  function init(injected) { deps = injected; return restore(); }

  function metalOf(entity, availableDeps) {
    const key = entity?.def?.weaponKey || '';
    const authored = availableDeps?.TOOL_ITEM_DEFS?.[key]?.metalKey || entity?._weaponTrustCulturalLoadout?.metalKey;
    if (authored && availableDeps?.METAL_DEFS?.[authored]) return authored;
    return Object.keys(availableDeps?.METAL_DEFS || {}).sort((a, b) => b.length - a.length)
      .find(metal => key.endsWith('_' + metal)) || null;
  }

  function replaceHolder(entity, key, d) {
    const sourceSpriteKey = d.TOOL_ITEM_DEFS?.[key]?.sprite; // Before a unique tool texture finishes loading, the already-registered ordinary modular sprite is identical.
    const mesh = d.makeToolPlaneMesh?.(key) || (sourceSpriteKey && sourceSpriteKey !== key ? d.makeToolPlaneMesh?.(sourceSpriteKey) : null); // Use the original composed visual as the safe immediate fallback.
    if (!mesh || !window.THREE?.Group || !entity.scene?.add) return false;
    const holder = new window.THREE.Group();
    holder.name = 'banditToolHolder';
    holder.add(mesh);
    holder.userData ||= {};
    holder.userData.hobunjiHeldPortraitOwner = entity.avatarRef?.group || null; // Preserve owner masking when changing a live holder.
    holder.visible = !entity._rangedMode;
    entity.scene.add(holder);
    entity._banditToolHolder?.parent?.remove?.(entity._banditToolHolder);
    entity._banditToolHolder = holder;
    entity.banditWeaponMeshAttached = true;
    const root = entity.avatarRef?.handRigAvatarRoot;
    if (root?.userData) {
      root.userData.proceduralHandToolHolder = holder; // Same-frame new holder: avoid a hand briefly reaching for the removed one.
      root.userData.proceduralHandToolKey = key;
      root.userData.proceduralHandGripContext = 'melee';
      root.userData.proceduralHandAnimationGrip = null;
    }
    return true;
  }

  function applyWeaponStats(entity, key, metal, d) {
    const def = entity.def, item = d.TOOL_ITEM_DEFS[key];
    const old = def.weaponShapeStats || { power: 1, speed: 1, range: 1, efficiency: 1 };
    const next = window.WeaponShapeStats?.forKey?.(key, item) || old; // Same shaft/head blending as the player's Foundry weapon.
    const positive = n => Number.isFinite(Number(n)) && Number(n) > 0 ? Number(n) : 1;
    def.attackDamage = Math.max(1, Math.round(def.attackDamage * positive(next.power) / positive(old.power)));
    def.attackRangePx *= positive(next.range) / positive(old.range);
    def.attackHalfConeRad = Math.min(Math.PI, def.attackHalfConeRad * positive(next.range) / positive(old.range));
    def.attackStaminaCost *= positive(old.efficiency) / positive(next.efficiency);
    // Combat-bandit prebudgets two opening attacks for ordinary fighters. Reconcile
    // that floor after the modular haft/head changes attack stamina efficiency.
    const minimumStamina = Math.ceil(def.attackStaminaCost * 2); // Prevents a 5★ captain spawning unable to afford its own first attack.
    if (Number.isFinite(minimumStamina) && minimumStamina > 0) {
      def.maxStamina = Math.max(Number(def.maxStamina) || 0, minimumStamina);
      entity.maxStamina = Math.max(Number(entity.maxStamina) || 0, def.maxStamina);
      entity.stamina = Math.max(Number(entity.stamina) || 0, entity.maxStamina); // Spawn-only adjustment, before this actor has participated in combat.
    }
    def.attackCooldownS *= positive(old.speed) / positive(next.speed);
    def.weaponShapeStats = next;
    def.weaponKey = key;
    def.weaponShapeKey = item.shapeKey;
    def.weaponMetalKey = metal;
    def.attackTag = item.dmgType || def.attackTag;
    if (def.banditAbilityLoadout) def.banditAbilityLoadout.tap1 = item.animStyle === 'thrust' ? 'pokeCombo' : 'swingCombo';
    entity._banditSwingAnim = item.animStyle === 'sweep' ? 'sweep' : 'thrust';
    entity._banditSwingPose = item.animStyle === 'sweep' ? window.Combat?.poses?.SWEEP_POSE : null;
    entity._banditRestGrip = null;
  }

  function visualFor(state, rng = random) {
    const es = window.EnchantmentSystem;
    const counts = { Tothal: 0, Hronal: 0, Kanthic: 0, Ohthic: 0 };
    for (const id of [...state.base, ...Object.values(state.flourishes)]) {
      const alignment = es?.DEFINITIONS?.[id]?.alignment;
      if (alignment === 'Fey') counts.Fey = (counts.Fey || 0) + 1;
      else if (Object.hasOwn(counts, alignment)) counts[alignment]++;
    }
    const alignments = Object.keys(counts).filter(plane => counts[plane] > 0 && window.WeaponEnchantmentVFX?.ALIGNMENTS?.[plane]);
    const alignment = choose(alignments, rng), catalog = window.WeaponEnchantmentVFX?.ALIGNMENTS?.[alignment];
    const visual = catalog ? { alignment, colorAlignment: alignment, dyeId: choose(catalog.dyeIds, rng), effectId: choose(catalog.effects, rng)?.id } : null;
    return { visual, counts };
  }

  function equip(entity, cfg, rank, tier, opts = {}, d = deps) {
    const fey = entity?.rootledootBig === true; // A Big Rootledoot gets a Fey armament at every bandit difficulty tier.
    if (!entity || entity._banditCaptainArmament || rank !== 'captain' || (!fey && (capStars(tier) < MIN_STARS
      || entity.enemyClass !== 'bandit' || entity.isMinion || cfg?._preserveMineEnemyTiers || opts?.extra?.isMineGhoul
      || opts?.defOverride?.weaponKey || window.EnemyLoadoutRules?.ruleFor?.(entity.enemyLoadoutKind)?.weapons))) return entity;
    const metal = metalOf(entity, d);
    if (!metal || !window.ModularWeapons || !d?.TOOL_ITEM_DEFS) return entity;
    const donors = permittedDonors(entity).filter(shape => !Array.isArray(cfg?.weaponShapePool) || !cfg.weaponShapePool.length || cfg.weaponShapePool.includes(shape)); // A caller's narrower complete-weapon pool also narrows both donor pieces.
    const all = eligiblePairs(donors).filter(pair => !!d.TOOL_ITEM_DEFS[window.ModularWeapons.itemKey(pair.shaft, pair.head, metal)]);
    const mixed = all.filter(pair => pair.donors[0] !== pair.donors[1]); // A true mixed found weapon when two legal donors are available.
    const choice = choose(mixed.length ? mixed : all, d.rnd || random);
    if (!choice) return entity;
    const state = fey ? rollFeyEnchantments(capStars(tier), d.rnd || random) : rollEnchantments(capStars(tier), d.rnd || random);
    if (!state) return entity;
    const uid = Date.now().toString(36) + '-' + (++serial).toString(36) + '-' + Math.floor((d.rnd || random)() * 0x10000).toString(36);
    const key = PREFIX + [choice.shaft, choice.head, metal, uid].join(':');
    const record = { ...choice, metal, uid, stars: capStars(tier), enchantments: state, ...(fey ? {origin:'Fey'} : {}) };
    if (!registerDefinition(key, record)) return entity;
    if (!replaceHolder(entity, key, d)) { delete d.TOOL_ITEM_DEFS[key]; return entity; }
    applyWeaponStats(entity, key, metal, d);
    const { visual, counts } = visualFor(state, d.rnd || random);
    entity._banditCaptainArmament = { ...record, key, visual, counts }; // The living NPC and its eventual corpse share the exact same roll.
    unlooted.set(key, state); // Only EnchantmentSystem's NPC lookup may see this until the loot transaction.
    return entity;
  }

  function unlootedEnchantmentState(key) { return unlooted.get(key) || null; }
  function emitHit(entity, target, actualDamage, slotId, metadata = {}) {
    const armament = entity?._banditCaptainArmament;
    if (!armament || !target || !window.CombatAttackEvents?.hit || !['tap1', 'tap2', 'hold1', 'hold2'].includes(slotId)) return; // Counter-ripostes also apply Base enchantments, though no NPC Flourish occupies hold2.
    const attackCategory = slotId === 'tap1' ? 'combo' : slotId === 'tap2' ? 'quickAttack' : slotId === 'hold2' ? 'defensiveHold' : 'offensiveHold';
    window.CombatAttackEvents.hit(null, {
      attacker: entity, target, weaponKey: armament.key, slotId, attackCategory,
      actualDamage: Math.max(0, Number(actualDamage) || 0),
      comboFinisher: metadata.comboFinisher === true,
      quickBonusEffectProc: metadata.quickBonusEffectProc === true,
      fullCharge: slotId === 'hold1',
    }); // Reuses real enchantment listeners on successful enemy hits; never grants player unlocks.
  }

  function tick(entity, toolDefs = deps?.TOOL_ITEM_DEFS) {
    const armament = entity?._banditCaptainArmament;
    if (!armament?.visual) return;
    if (!entity.avatarRef?.group?.parent || Number(entity.health) <= 0) {
      entity._captainEnchantmentFx?.dispose?.();
      entity._captainEnchantmentFx = null;
      return;
    }
    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0, (now - (entity._captainEnchantmentFxAt || now)) / 1000));
    entity._captainEnchantmentFxAt = now;
    if (!entity._captainEnchantmentFx && !entity._captainEnchantmentFxFailed) {
      const plane = entity._banditToolHolder?.children?.[0]?.userData?.toolPlane;
      const sprite = toolDefs?.[armament.key]?.sprite;
      if (!plane || !sprite || !window.WeaponEnchantmentVFX?.createFixedEmitter) return;
      entity._captainEnchantmentFx = window.WeaponEnchantmentVFX.createFixedEmitter(plane, { visual: armament.visual, counts: armament.counts, spritePath: sprite });
      if (!entity._captainEnchantmentFx) entity._captainEnchantmentFxFailed = true;
    }
    entity._captainEnchantmentFx?.update(dt);
  }

  function grantCorpseWeapon(entity) {
    const record = entity?._banditCaptainArmament, inventory = gear();
    if (!record || !inventory || !deps?.TOOL_ITEM_DEFS || !window.EnchantmentSystem?.cleanWeaponState) return null;
    if (!registerDefinition(record.key, record)) return null;
    inventory.tools ||= {}; inventory.toolMastery ||= {}; inventory.captainModularWeapons ||= {};
    inventory.weaponEnchantments ||= {}; inventory.weaponEnchantmentVisuals ||= {};
    const newlyOwned = !inventory.tools[record.key]; // The corpse can be searched once but repeated calls must not repeat writes.
    if (newlyOwned) {
      inventory.captainModularWeapons[record.key] = { shaft: record.shaft, head: record.head, metal: record.metal, uid: record.uid, stars: record.stars, donors: record.donors, ...(record.origin ? {origin:record.origin} : {}) };
      inventory.tools[record.key] = true;
      inventory.toolMastery[record.key] = { xp: 0 };
      inventory.weaponEnchantments[record.key] = window.EnchantmentSystem.cleanWeaponState(record.enchantments);
      if (record.visual) inventory.weaponEnchantmentVisuals[record.key] = { ...record.visual };
    }
    unlooted.delete(record.key); // Player gear is the enchantment authority from this point forward.
    entity._captainEnchantmentFx?.dispose?.();
    entity._captainEnchantmentFx = null;
    if (newlyOwned) {
      deps.saveGearInventory?.(); // Persist the new character-owned tool before the caller's deferred member/world loot save.
      deps.buildEquipmentSlots?.(); // Refresh only after a real equipment change; repeated corpse interactions stay cheap.
    }
    return deps.TOOL_ITEM_DEFS[record.key]?.label || 'Captain\'s modular weapon';
  }

  function discard(entity) {
    const record=entity?._banditCaptainArmament; // Release unclaimed unique weapon state when a Rootledoot encounter resets.
    if(!record)return;
    unlooted.delete(record.key);
    entity._captainEnchantmentFx?.dispose?.();entity._captainEnchantmentFx=null;
    if(!gear()?.tools?.[record.key]&&deps?.TOOL_ITEM_DEFS)delete deps.TOOL_ITEM_DEFS[record.key];
  }

  function patchBanditCombat() {
    const api = window.BanditCombat;
    if (!api?.makeEntity || api.makeEntity.__captainArmaments) return;
    const original = api.makeEntity.bind(api); // Compose with the cultural wrapper regardless of dynamic load order.
    const create = async function captainArmedBanditEntity(cfg, rank, tier, x, y, opts = {}) {
      const entity = await original(cfg, rank, tier, x, y, opts);
      return equip(entity, cfg, rank, tier, opts, banditDeps || deps);
    };
    create.__captainArmaments = true;
    api.makeEntity = create;
  }
  let banditDeps = null; // BanditCombat's own injected renderer/stats services are distinct from HarlyaoRelics' saved-gear services.
  function initBanditDependencies(injected) { banditDeps = injected; } // Used only when BanditCombat.init is run before HarlyaoRelics.init.
  const combat = window.BanditCombat;
  if (combat?.init && !combat.init.__captainArmaments) {
    const originalInit = combat.init.bind(combat);
    const initCombat = function captainArmamentBanditInit(injected) { initBanditDependencies(injected); return originalInit(injected); };
    initCombat.__captainArmaments = true;
    combat.init = initCombat;
  }
  patchBanditCombat();

  window.BanditCaptainArmaments = Object.freeze({
    PREFIX, MIN_STARS, capStars, enchantmentCount, rollEnchantments, eligiblePairs, permittedDonors,
    init, restore, registerDefinition, equip, grantCorpseWeapon, unlootedEnchantmentState, emitHit, tick, discard, rollFeyEnchantments,
    debugSnapshot: entity => ({ key: entity?._banditCaptainArmament?.key || null, stars: entity?._banditCaptainArmament?.stars || 0,
      donors: entity?._banditCaptainArmament?.donors || [], enchantments: entity?._banditCaptainArmament?.enchantments || null,
      registeredUnlooted: unlooted.size }), // Mobile-visible enemy inspection through the existing dev snapshot.
  });
})();