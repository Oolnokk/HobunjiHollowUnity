// Rare high-danger bandit captain weapons. Donors and pair legality always come from
// the live cultural bandit pool and the Foundry's authored modular catalog.
(() => {
  'use strict';
  const PREFIX = 'banditModular:'; // Unique per-captain keys prevent two drops from sharing enchantments or replacing a forged weapon.
  const BOUND_PREFIX = 'captainBound_'; // Self-contained pack identity preserving the weapon and its magic through custody.
  const MIN_STARS = 5; // Camp tier is zero-based; only five-to-eight-star ordinary captains qualify.
  const BASE_IDS = Object.freeze(['burning', 'frostbitten', 'mirrored', 'livingFlame', 'stormwake', 'stonebind', 'soulweight', 'ancestralSight', 'livingGust', 'spiritHeal']); // Every non-Fey Base has a captain research source.
  const FLOURISH_IDS = Object.freeze(['fury', 'moralized', 'resolve', 'stormRenewal', 'bedrock', 'blackBargain', 'ancestralMercy', 'sicced']); // Sicced can be recovered but cannot redirect the player's companion when held by a hostile.
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
      const eligible = available.filter(id => window.EnchantmentSystem?.allowsFlourishSlot?.(id, slot) !== false); // No Fury on Held or Unshackled on Combo.
      if (!eligible.length) return null;
      const id = choose(eligible, rng);
      available.splice(available.indexOf(id), 1);
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
    for(let i=base.length;i<count&&flourishes.length&&slots.length;i++){
      const slot=take(slots),eligible=flourishes.filter(id=>window.EnchantmentSystem?.allowsFlourishSlot?.(id,slot)!==false);
      if(!eligible.length)continue;const id=take(eligible);flourishes.splice(flourishes.indexOf(id),1);result[slot]=id;
    }
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

  function isRootledootPair(shaftKey,headKey,catalog,config){
    const shaft=config?.shafts?.[shaftKey],head=config?.heads?.[headKey]; // Single eligibility predicate for normal rolls, enchanted rolls and Workshop history.
    const hachutu=/hachutu/i.test(shaftKey)||/hachutu/i.test(shaft?.sourceShape||'');
    return !!(shaft&&head&&!shaft.editorOnly&&!hachutu&&!head.editorOnly&&!head.craftDisabled&&(shaftKey==='dagger'||headKey==='porakaneki-greatclub')&&!catalog.isDisallowed(shaftKey,headKey));
  }
  function rootledootPairs(catalog=window.ModularWeapons){
    const config=catalog?.getConfig?.();if(!config)return [];
    const pairs=[];
    for(const [shaftKey,shaft] of Object.entries(config.shafts||{})){
      for(const [headKey,head] of Object.entries(config.heads||{})){
        if(!isRootledootPair(shaftKey,headKey,catalog,config))continue;
        pairs.push({shaft:shaftKey,head:headKey,donors:[shaft.sourceShape,head.sourceShape]});
      }
    }
    return pairs;
  }
  function isRootledootWeapon(key,catalog=window.ModularWeapons){
    const p=catalog?.decode?.(key);
    return !!(p&&isRootledootPair(p.shaft,p.head,catalog,catalog.getConfig?.()));
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
    const old=entity._banditToolHolder; // Replacing the original weapon must release its sprite assembly and private GPU materials.
    old?.parent?.remove?.(old);
    for(const child of old?.children||[]) window.HobunjiWeaponSpriteAssemblies?.drop?.(child);
    old?.traverse?.(object=>{
      if(!object.userData?.sharedToolGeometry)object.geometry?.dispose?.();
      if(Array.isArray(object.material))for(const material of object.material)material?.dispose?.();
      else object.material?.dispose?.();
    });
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
    if(entity&&opts.zoneId==='map_dev_arena'&&opts.previewCaptainArmament){
      entity._banditCaptainArmament=opts.previewCaptainArmament; // Workshop history retains the saved weapon and its fixed enchantment VFX instead of rerolling.
      if(entity.rootledoot)unlooted.set(opts.previewCaptainArmament.key,opts.previewCaptainArmament.enchantments);
      return entity;
    }
    const fey = entity?.rootledoot===true||entity?.rootledootBig===true; // Small/medium may be Fey-enchanted; boss always is.
    if (!entity || entity._banditCaptainArmament || (!fey&&rank !== 'captain') || (!fey && (capStars(tier) < MIN_STARS
      || entity.enemyClass !== 'bandit' || entity.isMinion || cfg?._preserveMineEnemyTiers || opts?.extra?.isMineGhoul
      || opts?.defOverride?.weaponKey || window.EnemyLoadoutRules?.ruleFor?.(entity.enemyLoadoutKind)?.weapons))) return entity;
    const metal = metalOf(entity, d);
    if (!metal || !window.ModularWeapons || !d?.TOOL_ITEM_DEFS) return entity;
    if(fey&&!entity.rootledootBig){
      if(opts.zoneId==='map_dev_arena'&&opts.defOverride?.weaponKey)return entity; // A saved ordinary modular roll remains unenchanted.
      if((d.rnd||random)()>=(rank==='lieutenant'?.5:.25))return entity; // Tuning default: 25% small, 50% medium; guaranteed boss.
    }
    const donors = fey?[]:permittedDonors(entity).filter(shape => !Array.isArray(cfg?.weaponShapePool) || !cfg.weaponShapePool.length || cfg.weaponShapePool.includes(shape)); // A caller's narrower complete-weapon pool also narrows both donor pieces.
    const all = (fey?rootledootPairs():eligiblePairs(donors)).filter(pair => !!d.TOOL_ITEM_DEFS[window.ModularWeapons.itemKey(pair.shaft, pair.head, metal)]);
    const mixed = all.filter(pair => pair.donors[0] !== pair.donors[1]); // A true mixed found weapon when two legal donors are available.
    const existing=fey?window.ModularWeapons.decode(entity.def.weaponKey):null;
    const choice = (existing&&all.find(pair=>pair.shaft===existing.shaft&&pair.head===existing.head))||choose(fey?all:(mixed.length?mixed:all),d.rnd||random);
    if (!choice) return entity;
    const rolled = fey ? rollFeyEnchantments(capStars(tier), d.rnd || random) : rollEnchantments(capStars(tier), d.rnd || random);
    if(!rolled)return entity;
    const state=window.EnchantmentSystem?.rollFormulaState?.(rolled,fey?'fey':'captain',capStars(tier),d.rnd||random)||rolled; // Stable spawn roll.
    const uid = Date.now().toString(36) + '-' + (++serial).toString(36) + '-' + Math.floor((d.rnd || random)() * 0x10000).toString(36);
    const key = PREFIX + [choice.shaft, choice.head, metal, uid].join(':');
    const record = { ...choice, metal, uid, stars: capStars(tier), enchantments: state, ...(fey ? {origin:'Fey'} : {}) };
    if (!registerDefinition(key, record)) return entity;
    if (!replaceHolder(entity, key, d)) { releaseUnownedDefinition(key,d); return entity; }
    applyWeaponStats(entity, key, metal, d);
    window.BanditCombat?.refreshEnemyCombatBuild?.(entity); // The modular head can change which combat perks the captain can actually use.
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
    if (!entity.avatarRef?.group?.parent || Number(entity.health) <= 0 || window.Combat?.shouldPresentCombatVfx?.(entity, entity.scene) === false) {
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

  // The pack key is the portable save/custody authority until ownership is transferred.
  function boundKeyFor(entity) {
    const r = entity?._banditCaptainArmament;
    if (!r?.key || !r.enchantments) return null;
    return BOUND_PREFIX + encodeURIComponent(JSON.stringify([r.key, r.stars, r.origin || 'Captain', r.enchantments, r.visual || null]));
  }

  function decodeBoundKey(key) {
    if (typeof key !== 'string' || !key.startsWith(BOUND_PREFIX)) return null;
    try {
      const payload = JSON.parse(decodeURIComponent(key.slice(BOUND_PREFIX.length)));
      if (!Array.isArray(payload) || payload.length !== 5) return null;
      const [toolKey, stars, origin, raw, visual] = payload;
      if (typeof toolKey !== 'string' || !toolKey.startsWith(PREFIX) || !Number.isInteger(stars) || stars < 1 || stars > 8 ||
          !['Captain', 'Fey'].includes(origin)) return null;
      const parts = window.ModularWeapons?.decode?.(toolKey);
      const config = window.ModularWeapons?.getConfig?.();
      const es = window.EnchantmentSystem;
      if (!parts || !config || !es?.cleanWeaponState) return null;
      const enchantments = es.cleanWeaponState(raw); // Same legacy-ID migration as equipped weapons.
      const ids = [...enchantments.base, ...Object.values(enchantments.flourishes)];
      if (!ids.length || ids.some(id => !es.DEFINITIONS?.[id] || (es.DEFINITIONS[id].alignment === 'Fey') !== (origin === 'Fey'))) return null;
      const donors = [config.shafts[parts.shaft].sourceShape, config.heads[parts.head].sourceShape]; // Derive donor identity from the catalog.
      return { ...parts, key: toolKey, uid: toolKey.split(':').pop(), stars, origin, donors, enchantments,
        ...(visual && typeof visual === 'object' && ['alignment','colorAlignment','dyeId','effectId'].every(k => typeof visual[k] === 'string')
          ? { visual: { alignment: visual.alignment, colorAlignment: visual.colorAlignment, dyeId: visual.dyeId, effectId: visual.effectId } } : {}) };
    } catch (_) { return null; }
  }

  function boundLabel(record) {
    const baseKey = window.ModularWeapons.itemKey(record.shaft, record.head, record.metal);
    return 'Bound ' + (record.origin === 'Fey' ? 'Fey-touched ' : "Captain's ") + (deps?.TOOL_ITEM_DEFS?.[baseKey]?.label || 'Modular Weapon');
  }

  function ensureBoundItemDef(key) {
    const record = decodeBoundKey(key);
    if (!record || !deps?.ITEM_DEFS) return null;
    const label = boundLabel(record);
    const defs = window.EnchantmentSystem.DEFINITIONS; // Pack detail shows the actual recovered magic before registration.
    const enchantmentLabels = [...record.enchantments.base.map(id => defs[id].displayName + ' (Base · Formula '+(record.enchantments.formulas?.[id]||1)+')'),
      ...Object.entries(record.enchantments.flourishes).map(([slot, id]) => defs[id].displayName + ' (' + slot.toUpperCase() + ' Flourish · Formula '+(record.enchantments.formulas?.[id]||1)+')')];
    const def = { label, icon: '🗡️', cat: 'material', sellPrice: 90 + 30 * (record.enchantments.base.length + Object.keys(record.enchantments.flourishes).length),
      tags: [record.origin, 'Bound'], magicalStatus: 'bound', uniqueInventoryKey: true,
      desc: 'Still bound to its former owner. It cannot be equipped until Garanki Gabu re-registers it. Registration teaches him its enchantments: ' + enchantmentLabels.join('; ') + '.' };
    deps.ITEM_DEFS[key] = def;
    if (Array.isArray(deps.inventoryItems) && !deps.inventoryItems.some(entry => entry.key === key))
      deps.inventoryItems.push({ key, icon: def.icon, label: label.toUpperCase(), max: 1 });
    return def;
  }

  function boundWeaponsInInventory() {
    return Object.keys(deps?.inventory || {}).filter(key => deps.inventory[key] > 0 && key.startsWith(BOUND_PREFIX))
      .map(boundKey => ({ boundKey, record: decodeBoundKey(boundKey) })).filter(entry => entry.record);
  }

  function grantCorpseWeapon(entity, options = {}) {
    const boundKey = boundKeyFor(entity), record = decodeBoundKey(boundKey);
    if (!record || !deps?.inventory || !ensureBoundItemDef(boundKey)) return null;
    const label = boundLabel(record);
    if (entity._captainWeaponLooted || gear()?.tools?.[record.key]) return label;
    const before = deps.inventory[boundKey];
    deps.inventory[boundKey] = 1; // No equippable weapon or learned magic exists yet.
    if (options.deferSave === true) return label; // Rootledoot caller snapshots this key in the atomic reward transaction.
    let saved = true; // A thrown storage failure must leave the loot retryable just like an explicit rejection.
    if (before !== 1) {
      try { saved = typeof deps.saveMemberWorldData === 'function' && deps.saveMemberWorldData() !== false; }
      catch (error) { saved = false; window.__farmLog?.('[captain-armaments] Bound weapon save failed: ' + String(error), 'warn'); }
    }
    if (!saved) {
      if (before === undefined) delete deps.inventory[boundKey]; else deps.inventory[boundKey] = before;
      deps.showToast?.('Could not save the bound weapon. Search the body again.', false);
      return null;
    }
    entity._captainWeaponLooted = true; // Repeated corpse reads cannot mint another copy.
    unlooted.delete(record.key);
    entity._captainEnchantmentFx?.dispose?.(); entity._captainEnchantmentFx = null;
    return label;
  }

  function registrationPrice(record) {
    return window.HarlyaoRelics?.unbindPrice?.(record.enchantments, record.origin) ?? null; // Reuse the established unbinding fee and Fey surcharge.
  }

  function registerBoundWeapon(boundKey) {
    const record = decodeBoundKey(boundKey), g = gear(), es = window.EnchantmentSystem;
    if (!record || !g || deps?.inventory?.[boundKey] !== 1 || g.tools?.[record.key]) return { ok: false, reason: 'not-owned' };
    if (window.DelversGuild?.isMember?.() !== true) return { ok: false, reason: 'license' };
    if (record.origin === 'Fey' && window.FeyArmamentQuest?.completed?.() !== true) return { ok: false, reason: 'quest' };
    const price = registrationPrice(record);
    if (!Number.isFinite(price) || price < 0 || !es?.unlockFromState) return { ok: false, reason: 'unavailable' };
    const baseKey = window.ModularWeapons.itemKey(record.shaft, record.head, record.metal);
    if (!deps.TOOL_ITEM_DEFS?.[baseKey]?.modular || !deps.TOOL_ITEM_DEFS[baseKey].slots?.includes('weapon')) return { ok: false, reason: 'invalid-weapon' };
    const result = window.GearMemberTransaction?.run?.({ inventoryKeys: [boundKey], mutate() {
      if ((Number(deps.inventory.gold) || 0) < price) return { ok: false, reason: 'gold', price };
      deps.inventory.gold = (Number(deps.inventory.gold) || 0) - price;
      delete deps.inventory[boundKey];
      g.tools ||= {}; g.toolMastery ||= {}; g.captainModularWeapons ||= {};
      g.weaponEnchantments ||= {}; g.weaponEnchantmentVisuals ||= {};
      const { shaft, head, metal, uid, stars, donors, origin } = record;
      g.captainModularWeapons[record.key] = { shaft, head, metal, uid, stars, donors, origin };
      g.tools[record.key] = true;
      g.toolMastery[record.key] = { xp: 0 };
      g.weaponEnchantments[record.key] = { base:[...record.enchantments.base], flourishes:{...record.enchantments.flourishes} }; // Research identity is consumed at registration, not an applied rank.
      if (record.visual) g.weaponEnchantmentVisuals[record.key] = record.visual;
      const learned = es.unlockFromState(record.enchantments, { deferSave: true }); // Base by ID; Flourishes by their exact slot.
      return { ok: true, toolKey: record.key, learned, price };
    } }) || { ok: false, reason: 'unavailable' };
    if (!result.ok) {
      if (result.reason === 'gold') deps.showToast?.('Garanki requires ' + price + 'g to re-register this weapon.', false);
      return result;
    }
    registerDefinition(record.key, record);
    deps.buildInventoryGrid?.(); deps.buildEquipmentSlots?.();
    es.logEvent?.(result.learned.length ? 'Garanki learned: ' + result.learned.join(', ') : 'Garanki re-registered a captain weapon');
    deps.showToast?.('Weapon re-registered to you.' + (result.learned.length ? ' Garanki learned: ' + result.learned.join(', ') : ''), true);
    window.HarlyaoRelics?.render?.();
    return result;
  }

  function releaseUnownedDefinition(key,d=deps) {
    if(!key?.startsWith(PREFIX)||gear()?.tools?.[key])return false;
    const held=window.CharacterHeldTools; // Per-item caches are public and this key belongs exclusively to the discarded rare weapon.
    const texture=held?.toolTextures?.[key];texture?.dispose?.();
    if(held?.toolTextures)delete held.toolTextures[key];
    const loaded=held?.loadedToolTextures?.[key];if(loaded!==texture)loaded?.dispose?.();
    if(held?.loadedToolTextures)delete held.loadedToolTextures[key];
    held?.modularToolGeometries?.get(key)?.dispose?.();held?.modularToolGeometries?.delete(key);
    if(d?.TOOL_ITEM_DEFS)delete d.TOOL_ITEM_DEFS[key];
    return true;
  }

  function discard(entity) {
    const record=entity?._banditCaptainArmament; // Release unclaimed unique weapon state when a Rootledoot encounter resets.
    if(!record)return;
    unlooted.delete(record.key);
    entity._captainEnchantmentFx?.dispose?.();entity._captainEnchantmentFx=null;
    releaseUnownedDefinition(record.key); // Owned loot retains its definition and cached presentation.
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
    PREFIX, MIN_STARS, capStars, enchantmentCount, rollEnchantments, eligiblePairs, rootledootPairs,isRootledootWeapon,permittedDonors,
    init, restore, registerDefinition, equip, grantCorpseWeapon, unlootedEnchantmentState, emitHit, tick, discard, rollFeyEnchantments,
    boundKeyFor, decodeBoundKey, ensureBoundItemDef, boundWeaponsInInventory, boundLabel, registrationPrice, registerBoundWeapon,
    debugSnapshot: entity => ({ key: entity?._banditCaptainArmament?.key || null, stars: entity?._banditCaptainArmament?.stars || 0,
      donors: entity?._banditCaptainArmament?.donors || [], enchantments: entity?._banditCaptainArmament?.enchantments || null,
      registeredUnlooted: unlooted.size, boundInPack: boundWeaponsInInventory().length }), // Mobile-visible enemy inspection through the existing dev snapshot.
  });
})();