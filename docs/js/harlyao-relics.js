// Harlyao relic weapons + Garanki Gabu's unbinding/enchanting service.
//
// Boss-vault chests in Harlyao ruins (js/dev-random-ruin-sanctum.js →
// js/dev-random-ruin-dungeon-chests.js) can hold an ancient sword carrying a
// random, partially-filled set of enchantments. It arrives BOUND — still
// magically tied to its dead owner — as a single stack in the world-scoped
// item inventory and cannot be equipped. Garanki Gabu (researcher's tent)
// unbinds it for a fee: the sword moves into gear as a usable weapon with its
// enchantments intact, and Garanki learns each of its enchantments so he can
// apply them to any other weapon for a higher price. Base enchantments are
// learned by id; Flourishes are learned per (enchantment, loadout slot)
// permutation, so building a specific setup can take several relics.
//
// Bound relics need no side save: every fact about one is encoded in its
// inventory key (like potion keys), so the ordinary world-inventory save
// carries it and ensureInventoryItemDefs() rebuilds its ITEM_DEFS entry on
// load. Unbound relics are recorded in gearInventory.harlyaoRelics and
// re-registered into TOOL_ITEM_DEFS on load; their enchantments live in the
// same gearInventory.weaponEnchantments map every weapon uses.
(() => {
  'use strict';

  const SHAPES = Object.freeze({
    longsword: Object.freeze({
      label: 'Harlyao Longsword', sprite: 'assets/toolsprites/harlyao_longsword.png', icon: '🗡️',
      animStyle: 'sweep', dmgType: 'sharp', weaponIdleClass: 'light',
    }),
    warhammer: Object.freeze({
      label: 'Harlyao Warhammer', sprite: 'assets/toolsprites/warhammer.png', icon: '🔨',
      animStyle: 'sweep', dmgType: 'blunt', weaponIdleClass: 'heavy',
    }),
    broadsword: Object.freeze({
      label: 'Harlyao Broadsword', sprite: 'assets/toolsprites/harlyao_broadsword.png', icon: '🗡️',
      animStyle: 'sweep', dmgType: 'sharp', weaponIdleClass: 'light',
    }),
    dagger: Object.freeze({
      label: 'Fey Dagger', origin: 'Fey', shapeKey: 'dagger',
      sprite: 'assets/toolsprites/dagger.png', icon: '🗡️',
      animStyle: 'thrust', dmgType: 'sharp', weaponIdleClass: 'light',
    }),
    daggersword: Object.freeze({
      label: 'Fey Dagger-Sword', origin: 'Fey', shapeKey: 'daggerSword',
      sprite: 'assets/toolsprites/dagger-sword_sweep.png', icon: '🗡️',
      animStyle: 'sweep', dmgType: 'sharp', weaponIdleClass: 'light',
    }),
    fishingspear: Object.freeze({
      label: 'Fey Fishing Spear', origin: 'Fey', shapeKey: 'fishingspear',
      sprite: 'assets/toolsprites/harpoon_fishingspear.png', icon: '🔱',
      animStyle: 'thrust', dmgType: 'sharp', weaponIdleClass: 'light',
    }),
    hatchet: Object.freeze({
      label: 'Fey Hatchet', origin: 'Fey', shapeKey: 'hatchet',
      sprite: 'assets/toolsprites/axe_hatchet.png', icon: '🪓',
      animStyle: 'sweep', dmgType: 'sharp', weaponIdleClass: 'light',
    }),
  });

  const TUNING = Object.freeze({
    BOSS_CHEST_RELIC_CHANCE: 0.5, // Per boss-vault chest.
    BASE_SLOT_FILL_CHANCE: 0.45, // Each of the two Base slots independently.
    FLOURISH_SLOT_FILL_CHANCE: 0.30, // Each loadout slot independently.
    UNBIND_BASE_PRICE: 120, // Garanki's "fair price" to unbind any relic…
    UNBIND_PRICE_PER_ENCHANTMENT: 40, // …plus this per enchantment it carries.
    APPLY_BASE_PRICE: 450, // Applying a learned Base enchantment to another weapon.
    APPLY_FLOURISH_PRICE: 300, // Applying a learned Flourish permutation.
    REMOVE_PRICE: 40, // Clearing one enchantment slot.
  });

  const BOUND_PREFIX = 'harlyaoBound_';
  const FEY_BOUND_PREFIX = 'feyBound_'; // Boney's Fey relics are distinguishable in the inventory and never enter Harlyao boss-loot rolls.
  const RELIC_TOOL_PREFIX = 'harlyaoRelic_';
  const FEY_TOOL_PREFIX = 'feyRelic_'; // Keeps unbound Fey equipment identity separate from excavated Harlyao tools.
  const SLOT_IDS = ['tap1', 'tap2', 'hold1', 'hold2']; // Mirrors Combat.loadout.SLOT_IDS when that module is absent (tests).

  let deps = null;

  function init(injectedDeps) {
    deps = injectedDeps;
    window.FeyArmamentQuest?.bindInventoryDeps?.(injectedDeps); // Shares the actual relic/gear save seam with the Fey quest.
    window.HachutuRelics?.init?.(injectedDeps); // Share the exact gear/inventory save seam with the dev-only Hachutu weapon drop.
    window.BanditCaptainArmaments?.init?.(injectedDeps); // Restore individually enchanted captain modular drops with their original donors, without discovering smithing recipes.
  }

  const ES = () => window.EnchantmentSystem;
  const rnd = () => window.GameRandom?.random?.() ?? Math.random();
  const slotIds = () => window.Combat?.loadout?.SLOT_IDS || SLOT_IDS;
  const gear = () => deps?.getGearInventory?.() || null;
  const feyServiceUnlocked = () => window.FeyArmamentQuest?.completed?.() === true; // Garanki only agrees to pretend after the final conversation.
  const isFeyEnchantment = id => ES()?.DEFINITIONS?.[id]?.alignment === 'Fey'; // Shared by service pricing, text, and option filtering.
  const feyServicePrice = (price, isFey) => isFey ? price * 2 : price; // Garanki's extra fee applies to every Fey service, not other planar magic.
  function requireFeyQuest() {
    if (feyServiceUnlocked()) return true;
    deps?.showToast?.('Finish The Knotworked Armament before asking Garanki to handle Fey-knotwork.', false);
    return false;
  }

  function esc(text) {
    return deps?.esc ? deps.esc(text) : String(text ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  }

  let uidCounter = 0; // Distinct keys even for several relics in one millisecond.
  function newUid() {
    uidCounter = (uidCounter + 1) % 1296;
    return Date.now().toString(36) + uidCounter.toString(36).padStart(2, '0') + Math.floor(Math.random() * 1296).toString(36);
  }

  // ── Bound-relic key codec ────────────────────────────────────────
  // harlyaoBound_<shape>_<uid>_B<base-base>_F<slot.id-slot.id>[_V<alignment>.<colorAlignment>.<dye>.<effect>]
  // The optional V suffix carries a looted weapon's particle choice as indices into the enchantment VFX vocabulary (alignment/colorAlignment index
  // into EnchantmentSystem.PLANES, then the dye and effect index within that alignment), so unbinding keeps its random color and effect.
  function visualVocabulary() {
    return { planes: window.EnchantmentSystem?.PLANES || [], alignments: window.WeaponEnchantmentVFX?.ALIGNMENTS || {} };
  }
  function encodeVisual(visual) {
    const { planes, alignments } = visualVocabulary();
    const a = planes.indexOf(visual?.alignment), c = planes.indexOf(visual?.colorAlignment);
    const dye = alignments[visual?.colorAlignment]?.dyeIds?.indexOf(visual?.dyeId);
    const effect = alignments[visual?.alignment]?.effects?.findIndex(entry => entry.id === visual?.effectId);
    return a >= 0 && c >= 0 && dye >= 0 && effect >= 0 ? `_V${a}.${c}.${dye}.${effect}` : '';
  }
  function decodeVisual(a, c, dye, effect) {
    const { planes, alignments } = visualVocabulary();
    const alignment = planes[Number(a)], colorAlignment = planes[Number(c)];
    const dyeId = alignments[colorAlignment]?.dyeIds?.[Number(dye)], effectId = alignments[alignment]?.effects?.[Number(effect)]?.id;
    return dyeId && effectId ? { alignment, colorAlignment, dyeId, effectId } : null;
  }
  function encodeBoundKey(relic) {
    const base = (relic.enchantments?.base || []).join('-');
    const flourishes = Object.entries(relic.enchantments?.flourishes || {}).map(([slot, id]) => `${slot}.${id}`).join('-');
    const prefix = SHAPES[relic?.shape]?.origin === 'Fey' ? FEY_BOUND_PREFIX : BOUND_PREFIX; // The origin is an explicit, save-stable bound-key distinction.
    return `${prefix}${relic.shape}_${relic.uid}_B${base}_F${flourishes}${relic.visual ? encodeVisual(relic.visual) : ''}`;
  }

  function decodeBoundKey(key) {
    const match = /^(harlyaoBound_|feyBound_)([a-z]+)_([a-z0-9]+)_B([A-Za-z-]*)_F([A-Za-z0-9.-]*)(?:_V(\d+)\.(\d+)\.(\d+)\.(\d+))?$/.exec(String(key || ''));
    if (!match || !SHAPES[match[2]]) return null;
    const origin = match[1] === 'feyBound_' ? 'Fey' : 'Harlyao'; // Self-contained codec also works in the GH minion/ghoul isolated-serialization harness. // A malformed item cannot claim the wrong shape/origin.
    if ((SHAPES[match[2]].origin || 'Harlyao') !== origin) return null;
    const flourishes = {};
    for (const pair of match[5] ? match[5].split('-') : []) {
      const [slot, id] = pair.split('.');
      if (slot && id) flourishes[slot] = id;
    }
    const raw = { base: match[4] ? match[4].split('-') : [], flourishes };
    const enchantments = ES()?.cleanWeaponState ? ES().cleanWeaponState(raw) : raw;
    if (origin === 'Fey' && (
      enchantments.base.some(id => ES()?.DEFINITIONS?.[id]?.alignment !== 'Fey')
      || Object.values(enchantments.flourishes).some(id => ES()?.DEFINITIONS?.[id]?.alignment !== 'Fey')
    )) return null;
    const visual = match[6] != null ? decodeVisual(match[6], match[7], match[8], match[9]) : null;
    return { shape: match[2], uid: match[3], origin, enchantments, ...(visual ? { visual } : {}) };
  }

  function isBoundKey(key) {
    return !!decodeBoundKey(key); // Both Harlyao and Fey bound prefixes are validated by the same codec.
  }

  function enchantmentCount(enchantments) {
    return (enchantments?.base || []).length + Object.keys(enchantments?.flourishes || {}).length;
  }

  function describeEnchantments(enchantments) {
    const defs = ES()?.DEFINITIONS || {};
    const parts = [];
    for (const id of enchantments?.base || []) parts.push(`${defs[id]?.displayName || id} (Base · ${defs[id]?.alignment || '?'})`);
    for (const [slot, id] of Object.entries(enchantments?.flourishes || {})) parts.push(`${defs[id]?.displayName || id} (${slot.toUpperCase()} Flourish · ${defs[id]?.alignment || '?'})`);
    return parts;
  }

  function unbindPrice(enchantments, origin = 'Harlyao') {
    return feyServicePrice(TUNING.UNBIND_BASE_PRICE + TUNING.UNBIND_PRICE_PER_ENCHANTMENT * enchantmentCount(enchantments), origin === 'Fey');
  }

  // ── Rolling ─────────────────────────────────────────────────────
  function rollEnchantments(origin = 'Harlyao') {
    const defs = Object.values(ES()?.DEFINITIONS || {}).filter(def => origin === 'Fey' ? def.alignment === 'Fey' : def.alignment !== 'Fey'); // Harlyao boss-vault relics never roll Boney's Fey illusions.
    const baseIds = defs.filter(def => def.type === 'Base').map(def => def.id);
    const flourishIds = defs.filter(def => def.type === 'Flourish').map(def => def.id);
    const pick = list => list[Math.floor(rnd() * list.length)];
    const base = [];
    for (let i = 0; i < (ES()?.BASE_LIMIT || 2); i++) {
      if (rnd() >= TUNING.BASE_SLOT_FILL_CHANCE) continue;
      const options = baseIds.filter(id => !base.includes(id));
      if (options.length) base.push(pick(options));
    }
    const flourishes = {};
    const eligibleFlourishes = slot => flourishIds.filter(id => ES()?.allowsFlourishSlot?.(id, slot) !== false); // Loot never rolls an incompatible Flourish.
    for (const slot of slotIds()) {
      const eligible = eligibleFlourishes(slot);
      if (rnd() < TUNING.FLOURISH_SLOT_FILL_CHANCE && eligible.length) flourishes[slot] = pick(eligible);
    }
    // A relic is only worth unbinding if it teaches something: never roll an
    // empty one. Not every slot is filled, but at least one always is.
    if (!base.length && !Object.keys(flourishes).length) {
      if (rnd() < 0.5 && baseIds.length) base.push(pick(baseIds));
      else if (flourishIds.length) {
        const slot = pick(slotIds().filter(slot => eligibleFlourishes(slot).length));
        if (slot) flourishes[slot] = pick(eligibleFlourishes(slot));
      }
    }
    return { base, flourishes };
  }

  function makeRelic(shape, origin = 'Harlyao') {
    const shapes = Object.keys(SHAPES).filter(id => (SHAPES[id].origin || 'Harlyao') === origin); // Boss-vault and Boney shape pools never overlap.
    if (!shapes.length) return null;
    const selected = shapes.includes(shape) ? shape : shapes[Math.floor(rnd() * shapes.length)];
    return { shape: selected, origin, uid: newUid(), enchantments: rollEnchantments(origin) };
  }
  function makeFeyRelic(shape) {
    return makeRelic(shape, 'Fey'); // Boney-specific reward generator; still uses real inventory, unbinding, gear and mastery.
  }

  // ── World-inventory (bound) side ────────────────────────────────
  function ensureBoundItemDef(key) {
    if (typeof key === 'string' && key.startsWith('captainBound_')) return window.BanditCaptainArmaments?.ensureBoundItemDef?.(key) || null;
    const relic = decodeBoundKey(key);
    if (!relic || !deps?.ITEM_DEFS) return null;
    const shape = SHAPES[relic.shape];
    const lines = describeEnchantments(relic.enchantments);
    deps.ITEM_DEFS[key] = {
      icon: shape.icon,
      label: `Bound ${shape.label}`,
      cat: 'material',
      sellPrice: 90 + 30 * enchantmentCount(relic.enchantments), // Recovered bound relics can be sold without paying to unbind them.
      spriteIcon: '../toolsprites/' + shape.sprite.split('/').pop(), // applyItemSpriteIcon resolves under assets/objectsprites/.
      tags: [relic.origin || 'Harlyao', 'Relic', 'Bound'], // Distinguishes Fey treasures from ordinary ruin artifacts.
      desc: `${relic.origin === 'Fey' ? 'A Fey-touched' : 'An ancient'} ${shape.label.replace(/^Harlyao |^Fey /, '').toLowerCase()} ${relic.origin === 'Fey' ? 'whose illusions unsettle the senses' : 'still bound to its long-dead Harlyao owner'} — it cannot be wielded. Garanki Gabu can ${relic.origin === 'Fey' ? 'pretend to unbind' : 'unbind'} it (${unbindPrice(relic.enchantments, relic.origin)}g) after you meet his requirements. Enchantments: ${lines.join('; ') || 'none'}.`,
      harlyaoBoundRelic: true,
    };
    if (Array.isArray(deps.inventoryItems) && !deps.inventoryItems.some(entry => entry.key === key)) {
      deps.inventoryItems.push({ key, icon: shape.icon, label: `BOUND ${shape.label.toUpperCase()}`, max: 1 });
    }
    return deps.ITEM_DEFS[key];
  }

  function ensureInventoryItemDefs(inventory = deps?.inventory) {
    for (const key of Object.keys(inventory || {})) if (key.startsWith(BOUND_PREFIX) || key.startsWith(FEY_BOUND_PREFIX) || key.startsWith('captainBound_')) ensureBoundItemDef(key);
  }

  function grantBoundRelic(relic = makeRelic()) {
    if (!deps?.inventory || !relic || !SHAPES[relic.shape]) return null;
    const shapeOrigin = SHAPES[relic.shape].origin || 'Harlyao'; // The encoded key selects its prefix by shape, so an incompatible declared origin would be unsalvageable on reload.
    if ((relic.origin || 'Harlyao') !== shapeOrigin) return null;
    if (relic.origin === 'Fey') {
      const ids=[...(relic.enchantments?.base || []), ...Object.values(relic.enchantments?.flourishes || {})]; // Fey items cannot smuggle planar enchantments into the bound-codec.
      if (!ids.length || ids.some(id => ES()?.DEFINITIONS?.[id]?.alignment !== 'Fey')) return null;
    }
    const key = encodeBoundKey(relic);
    ensureBoundItemDef(key);
    const previousQuantity = deps.inventory[key]; // Restored if the shared bound-weapon and quest save is explicitly rejected.
    deps.inventory[key] = 1;
    const questStarted = relic.origin === 'Fey' && window.FeyArmamentQuest?.maybeStart?.({ deferSave: true, silent: true }); // Save the new quest and first Fey weapon atomically.
    deps.buildInventoryGrid?.();
    const saved = deps.saveMemberWorldData?.(); // The game's canonical member serializer returns false when persistence fails.
    if (saved === false) {
      if (previousQuantity === undefined) delete deps.inventory[key];
      else deps.inventory[key] = previousQuantity;
      if (questStarted) window.FeyArmamentQuest?.rollbackDeferredStart?.();
      deps.buildInventoryGrid?.();
      deps.showToast?.('The bound weapon could not be saved. No weapon was granted; please retry.', false);
      return null;
    }
    if (questStarted) window.FeyArmamentQuest?.notifyStarted?.();
    ES()?.logEvent?.(`Found bound ${SHAPES[relic.shape].label}: ${describeEnchantments(relic.enchantments).join(', ')}`);
    return key;
  }

  function rollBossChestRelic() {
    if (rnd() >= TUNING.BOSS_CHEST_RELIC_CHANCE) return [];
    const relic = makeRelic();
    const key = grantBoundRelic(relic);
    return key ? [`🗡️ Bound ${SHAPES[relic.shape].label}`] : [];
  }

  function boundRelicsInInventory() {
    return Object.keys(deps?.inventory || {})
      .filter(key => (deps.inventory[key] || 0) > 0 && (key.startsWith(BOUND_PREFIX) || key.startsWith(FEY_BOUND_PREFIX)))
      .map(key => ({ key, ...decodeBoundKey(key) }))
      .filter(entry => entry.shape);
  }

  // ── Gear (unbound) side ─────────────────────────────────────────
  function relicToolKey(relic) {
    return `${relic.origin === 'Fey' ? FEY_TOOL_PREFIX : RELIC_TOOL_PREFIX}${relic.shape}_${relic.uid}`;
  }

  function registerRelicTool(toolKey, record) {
    const shape = SHAPES[record?.shape];
    if (!shape || !deps?.TOOL_ITEM_DEFS) return null;
    if (!deps.TOOL_ITEM_DEFS[toolKey]) {
      deps.TOOL_ITEM_DEFS[toolKey] = {
        label: shape.label,
        icon: shape.icon,
        sprite: shape.sprite,
        slots: ['weapon'],
        animStyle: shape.animStyle,
        dmgType: shape.dmgType,
        weaponIdleClass: shape.weaponIdleClass,
        shapeKey: shape.shapeKey || (record.shape === 'warhammer' ? 'warhammer' : record.shape === 'longsword' ? 'harlyaoLongsword' : 'harlyaoBroadsword'),
        metalKey: 'tinBronze', // Uses the shared mastery-driven bronze/verdigris renderer after unbinding.
        harlyaoRelic: true,
        itemKey: toolKey,
      };
    }
    deps.ensureToolTexture?.(toolKey);
    return deps.TOOL_ITEM_DEFS[toolKey];
  }

  // Called once gearInventory is loaded (game.js hobunjiPlayerReady), before
  // equipment slots render, so a relic equipped last session is a known tool.
  function restore() {
    window.HachutuRelics?.restore?.(); // Hachutu duplicate torch definitions must exist before the loadout panel is rebuilt.
    window.BanditCaptainArmaments?.restore?.(); // Re-register character-scoped captain weapon keys AFTER saved gear is loaded; init() runs too early for that.
    const g = gear();
    if (!g) return 0;
    if (!g.harlyaoRelics || typeof g.harlyaoRelics !== 'object' || Array.isArray(g.harlyaoRelics)) g.harlyaoRelics = {};
    let count = 0;
    for (const [toolKey, record] of Object.entries(g.harlyaoRelics)) if (registerRelicTool(toolKey, record)) count++;
    ensureInventoryItemDefs();
    return count;
  }

  function spendGold(price) {
    const gold = Number(deps?.inventory?.gold) || 0;
    if (gold < price) {
      deps?.showToast?.(`Garanki wants ${price}g for that — you have ${gold}g.`, false);
      return false;
    }
    deps.inventory.gold = gold - price;
    return true;
  }

  function requireService(id) {
    if (window.DelversGuild && !window.DelversGuild.isMember()) {
      deps?.showToast?.("Join the Delver's Guild before requesting Garanki's artifact services.", false);
      return false;
    }
    if ((id === 'base' || id === 'flourish') && window.DelversGuild && !window.DelversGuild.canEnchant()) {
      deps?.showToast?.('Creating new enchantments is forbidden. Earn Garanki\'s trust and discuss it privately in his tent.', false);
      return false;
    }
    if (window.ArtifactCollection?.unlocked?.(id) === true) return true;
    const milestone = window.ArtifactCollection?.UNLOCKS?.find(entry => entry.id === id); // Same thresholds as collection UI/dialogue.
    deps?.showToast?.(`Donate ${milestone?.count || 1} different artifact${milestone?.count > 1 ? 's' : ''} to Garanki to unlock ${milestone?.label || 'this service'}.`, false);
    return false;
  }

  // ── Cursed articles (looted lich circlets) ─────────────────────────────────────────────────────────────────────────────────────────────
  const DISPEL_PRICE = 150; // Garanki's fee to lift a lich circlet's curse; same service gate as unbinding.
  function cursedCircletsInPack() {
    return (deps?.getPackClothing?.() || []).filter(item => item?.cursed?.dispelBy === 'garanki');
  }
  function dispelCurse(uid) {
    if (!requireService('unbind')) return { ok: false, reason: 'collection' };
    const item = cursedCircletsInPack().find(entry => entry.uid === uid);
    if (!item) return { ok: false, reason: 'not-owned' };
    if (!spendGold(DISPEL_PRICE)) return { ok: false, reason: 'gold' };
    const originalLabel = item.cursed.originalLabel || item.label; // Restores the pre-curse name; the article itself, pattern and all, is untouched.
    if (window.EquipmentPanel?.dispelCurse) window.EquipmentPanel.dispelCurse(item);
    else { item.label = originalLabel; delete item.cursed; }
    deps.showToast?.(`Garanki dispels the curse. The ${item.label} can be worn now.`, true);
    deps.saveMemberWorldData?.();
    deps.buildPackClothingSection?.();
    deps.buildInventoryGrid?.();
    render();
    return { ok: true };
  }

  function unbind(boundKey) {
    if (!requireService('unbind')) return { ok: false, reason: 'collection' };
    const relic = decodeBoundKey(boundKey);
    if (!relic || !((deps?.inventory?.[boundKey] || 0) > 0)) return { ok: false, reason: 'not-owned' };
    if (relic.origin === 'Fey' && !requireFeyQuest()) return { ok: false, reason: 'quest' };
    const price = unbindPrice(relic.enchantments, relic.origin); // One validated fee for the unbinding transaction.
    const g = gear();
    if (!g) return { ok: false, reason: 'gear' };
    const toolKey = relicToolKey(relic); // Stable derived key persists in character gear once the member's bound key is removed.
    const result = window.GearMemberTransaction?.run?.({
      inventoryKeys: [boundKey],
      mutate: () => {
        if (!spendGold(price)) return { ok: false, reason: 'gold', price };
        delete deps.inventory[boundKey];
        if (!g.harlyaoRelics || typeof g.harlyaoRelics !== 'object') g.harlyaoRelics = {};
        g.harlyaoRelics[toolKey] = { shape: relic.shape, origin: relic.origin, uid: relic.uid, originalEnchantments: relic.enchantments, unboundAt: Date.now() };
        if (relic.visual) { // Preserve authored particle style from looted enemy weapons.
          if (!g.weaponEnchantmentVisuals || typeof g.weaponEnchantmentVisuals !== 'object') g.weaponEnchantmentVisuals = {};
          g.weaponEnchantmentVisuals[toolKey] = { ...relic.visual };
        }
        if (!g.tools) g.tools = {};
        g.tools[toolKey] = true;
        if (!g.toolMastery) g.toolMastery = {};
        g.toolMastery[toolKey] = { xp: 0 };
        delete g.toolPlating?.[toolKey];
        const es = ES();
        if (es) {
          es.stateFor(toolKey, true);
          for (const id of relic.enchantments.base) {
            if (!es.addBase(toolKey, id, { deferSave: true })) throw new Error('Invalid bound Base enchantment');
          }
          for (const [slot, id] of Object.entries(relic.enchantments.flourishes)) {
            if (!es.setFlourish(toolKey, slot, id, { deferSave: true, importLegacySlot: true })) throw new Error('Invalid bound Flourish'); // A pre-restriction relic must unbind without discarding its saved enchantments.
          }
        }
        const learned = es?.unlockFromState?.(relic.enchantments, { deferSave: true }) || [];
        return { ok: true, toolKey, learned, price };
      },
    }) || { ok: false, reason: 'unavailable' };
    if (!result.ok) return result;
    registerRelicTool(toolKey, g.harlyaoRelics[toolKey]); // Runtime texture/definition work only after the gear/member save succeeded.
    window.WeaponTrustVisits?.syncSmithingShapeUnlocks?.();
    deps.buildInventoryGrid?.();
    deps.buildEquipmentSlots?.();
    ES()?.logEvent?.(result.learned.length ? 'Garanki learned: ' + result.learned.join(', ') : 'Garanki unbound a relic');
    deps.showToast?.(`Garanki ${relic.origin === 'Fey' ? 'pretends to unbind' : 'unbinds'} the ${SHAPES[relic.shape].label}. Its verdigris clears and its Mastery returns to 0${result.learned.length ? ` — and he has learned ${result.learned.join(', ')}` : ''}.`, true);
    render();
    return result;
  }

  function ownedWeaponKeys() {
    const g = gear();
    return Object.keys(g?.tools || {}).filter(key => g.tools[key] && deps?.TOOL_ITEM_DEFS?.[key]?.slots?.includes('weapon'));
  }

  function applyBase(weaponKey, slotIndex, id) {
    if (!requireService('base')) return { ok: false, reason: 'collection' };
    const es = ES();
    if (!es || !ownedWeaponKeys().includes(weaponKey)) return { ok: false, reason: 'weapon' };
    if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= es.BASE_LIMIT) return { ok: false, reason: 'slot' };
    if (!es.isBaseUnlocked(id)) return { ok: false, reason: 'locked' };
    if (isFeyEnchantment(id) && !requireFeyQuest()) return { ok: false, reason: 'quest' };
    const current = es.stateFor(weaponKey).base;
    if (current[slotIndex] === id) return { ok: false, reason: 'unchanged' };
    if (current.includes(id)) {
      deps?.showToast?.('That weapon already carries that enchantment.', false);
      return { ok: false, reason: 'duplicate' };
    }
    const price = feyServicePrice(TUNING.APPLY_BASE_PRICE, isFeyEnchantment(id)); // Charged once within the combined save transaction.
    const index = Math.min(slotIndex, current.length);
    const result = window.GearMemberTransaction?.run?.({
      mutate: () => {
        if (!spendGold(price)) return { ok: false, reason: 'gold', price };
        return es.equipBase(weaponKey, index, id, { deferSave: true })
          ? { ok: true, price } : { ok: false, reason: 'enchant' };
      },
    }) || { ok: false, reason: 'unavailable' };
    if (result.ok) afterEnchant(`Garanki ${isFeyEnchantment(id) ? 'pretends to enchant' : 'enchants'} the weapon with ${es.DEFINITIONS[id].displayName}.`);
    return result;
  }

  function applyFlourish(weaponKey, slotId, id) {
    if (!requireService('flourish')) return { ok: false, reason: 'collection' };
    const es = ES();
    if (!es || !ownedWeaponKeys().includes(weaponKey)) return { ok: false, reason: 'weapon' };
    if (!slotIds().includes(slotId) || es.allowsFlourishSlot?.(id, slotId) === false) return { ok: false, reason: 'slot' };
    if (!es.isFlourishUnlocked(id, slotId)) return { ok: false, reason: 'locked' };
    if (isFeyEnchantment(id) && !requireFeyQuest()) return { ok: false, reason: 'quest' };
    if (es.flourishForSlot(slotId, weaponKey) === id) return { ok: false, reason: 'unchanged' };
    const price = feyServicePrice(TUNING.APPLY_FLOURISH_PRICE, isFeyEnchantment(id)); // Same Fey fee rules as Base enchanting.
    const result = window.GearMemberTransaction?.run?.({
      mutate: () => {
        if (!spendGold(price)) return { ok: false, reason: 'gold', price };
        return es.setFlourish(weaponKey, slotId, id, { deferSave: true })
          ? { ok: true, price } : { ok: false, reason: 'enchant' };
      },
    }) || { ok: false, reason: 'unavailable' };
    if (result.ok) afterEnchant(`Garanki ${isFeyEnchantment(id) ? 'pretends to bind' : 'binds'} a ${es.DEFINITIONS[id].displayName} Flourish to ${slotId.toUpperCase()}.`);
    return result;
  }

  function clearSlot(weaponKey, kind, slot) {
    if (!requireService('remove')) return { ok: false, reason: 'collection' };
    const es = ES();
    if (!es || !ownedWeaponKeys().includes(weaponKey)) return { ok: false, reason: 'weapon' };
    if (kind !== 'base' && kind !== 'flourish') return { ok: false, reason: 'kind' };
    if (kind === 'base' ? !Number.isInteger(slot) || slot < 0 || slot >= es.BASE_LIMIT : !slotIds().includes(slot)) return { ok: false, reason: 'slot' };
    const currentId = kind === 'base' ? es.stateFor(weaponKey).base[slot] : es.flourishForSlot(slot, weaponKey);
    if (!currentId) return { ok: false, reason: 'empty' };
    if (isFeyEnchantment(currentId) && !requireFeyQuest()) return { ok: false, reason: 'quest' };
    const price = feyServicePrice(TUNING.REMOVE_PRICE, isFeyEnchantment(currentId)); // Uses the removed effect's origin rather than the weapon's origin.
    const result = window.GearMemberTransaction?.run?.({
      mutate: () => {
        if (!spendGold(price)) return { ok: false, reason: 'gold', price };
        const succeeded = kind === 'base'
          ? es.equipBase(weaponKey, slot, null, { deferSave: true })
          : es.setFlourish(weaponKey, slot, null, { deferSave: true });
        return succeeded ? { ok: true, price } : { ok: false, reason: 'enchant' };
      },
    }) || { ok: false, reason: 'unavailable' };
    if (result.ok) afterEnchant(isFeyEnchantment(currentId) ? 'Garanki pretends to strip the enchantment away.' : 'Garanki strips the enchantment away.');
    return result;
  }

  function afterEnchant(message) {
    // Gear and member inventory were already captured together in one CharacterMetaSave write.
    deps?.showToast?.(message, true);
    window.CombatLoadoutUI?.render?.();
    render();
  }

  // ── Garanki's panel (mpGarankiEnchanter) ────────────────────────
  let selectedWeaponKey = null;

  function button(label, onClick, disabled = false) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'shop-buy-btn';
    b.textContent = label;
    b.disabled = !!disabled;
    b.addEventListener('click', onClick);
    return b;
  }

  function row(iconHtml, name, desc, controls = []) {
    const el = document.createElement('div');
    el.className = 'shop-row';
    el.innerHTML = `<div class="sh-icon">${iconHtml}</div><div class="sh-info"><div class="sh-name">${name}</div><div class="sh-desc">${desc}</div></div>`;
    const box = document.createElement('div');
    box.style.cssText = 'display:flex;flex-direction:column;gap:4px;align-items:stretch;';
    controls.forEach(control => box.appendChild(control));
    if (controls.length) el.appendChild(box);
    return el;
  }

  function heading(text) {
    const el = document.createElement('div');
    el.className = 'menu-section-title';
    el.style.marginTop = '8px';
    el.textContent = text;
    return el;
  }

  function note(text) {
    const el = document.createElement('div');
    el.className = 'sh-desc';
    el.style.padding = '4px 2px';
    el.textContent = text;
    return el;
  }

  function select(options, value) {
    const el = document.createElement('select');
    el.className = 'settings-select';
    for (const option of options) {
      const o = document.createElement('option');
      o.value = option.value;
      o.textContent = option.label;
      o.selected = option.value === value;
      el.appendChild(o);
    }
    return el;
  }

  function flourishTriggerLabel(slotId, weaponKey) {
    const loadout = window.Combat?.loadout;
    const abilityId = weaponKey === window.Combat?.deps?.currentWeaponKey?.() ? loadout?.getSlot?.(slotId) : null;
    const ability = abilityId ? window.Combat?.abilities?.get?.(abilityId) : null;
    return ability?.label ? `${slotId.toUpperCase()} · ${ability.label}` : slotId.toUpperCase();
  }

  function render() {
    if (typeof document === 'undefined') return;
    const goldEl = document.getElementById('gkGoldDisplay');
    if (goldEl) goldEl.innerHTML = `${deps?.inventory?.gold || 0}<span class="wallet-unit">g</span>`;
    const list = document.getElementById('garankiEnchanterList');
    if (!list || !deps) return;
    list.innerHTML = '';
    const es = ES();
    const defs = es?.DEFINITIONS || {};

    window.TownMagicCheckpoint?.renderCustody?.(list, { heading, note, row, button, esc }); // Confiscated items stay visible first on small screens; Garanki owns the legal registration UI.
    window.ArtifactCollection?.render?.(list, { heading, note, row, button });
    // Captain registration uses Garanki's existing licensed services without requiring artifact donations.
    const captains = window.BanditCaptainArmaments;
    const captainWeapons = captains?.boundWeaponsInInventory?.() || [];
    if (captainWeapons.length) {
      list.appendChild(heading('Captain weapon registration'));
      list.appendChild(note("A Delver's Guild license permits re-registration. Garanki learns the weapon's enchantments when its binding is transferred to you."));
      for (const { boundKey, record } of captainWeapons) {
        const price = captains.registrationPrice(record);
        const feyBlocked = record.origin === 'Fey' && !feyServiceUnlocked();
        const licensed = window.DelversGuild?.isMember?.() === true;
        list.appendChild(row('🗡️', esc(captains.boundLabel(record)),
          esc(describeEnchantments(record.enchantments).join(' · ')),
          [button(feyBlocked ? 'Finish The Knotworked Armament' : !licensed ? 'Guild license required' : `Re-register (${price}g)`,
            () => captains.registerBoundWeapon(boundKey), !licensed || feyBlocked || !Number.isFinite(price) || (deps.inventory.gold || 0) < price)]));
      }
    }
    // Bound relics
    list.appendChild(heading(feyServiceUnlocked() ? 'Bound relics · Harlyao and Fey' : 'Bound relics · Harlyao'));
    if (!window.ArtifactCollection?.unlocked?.('unbind')) list.appendChild(note('Donate your first artifact to unlock weapon unbinding.'));
    const allBound = boundRelicsInInventory(); // Kept intact while the menu hides Fey origins until the investigation is complete.
    const bound = allBound.filter(relic => relic.origin !== 'Fey' || feyServiceUnlocked());
    if (!bound.length) list.appendChild(note('Bring Garanki a bound relic from a Harlyao boss vault.'));
    if (!feyServiceUnlocked() && allBound.some(relic => relic.origin === 'Fey')) list.appendChild(note('Garanki does not believe the knotworked weapon is magical. Follow The Knotworked Armament to persuade him.'));
    for (const relic of bound) {
      const price = unbindPrice(relic.enchantments, relic.origin);
      const shape = SHAPES[relic.shape];
      list.appendChild(row(shape.icon, esc(`Bound ${shape.label}`),
        esc(describeEnchantments(relic.enchantments).join(' · ') || 'No enchantments'),
        [button(`${relic.origin === 'Fey' ? 'Pretend to unbind' : 'Unbind'} (${price}g)`, () => unbind(relic.key), !window.ArtifactCollection?.unlocked?.('unbind') || (window.DelversGuild && !window.DelversGuild.isMember()) || (deps.inventory.gold || 0) < price)]));
    }

    // Cursed lich circlets
    list.appendChild(heading('Cursed circlets'));
    const cursed = cursedCircletsInPack();
    if (!cursed.length) list.appendChild(note('Bring Garanki a circlet looted from a lich. It carries a curse that keeps it from being worn until he dispels it.'));
    for (const item of cursed) {
      list.appendChild(row('👑', esc(item.label), esc('Cursed. A lich’s old claim keeps it from being worn.'),
        [button(`Dispel (${DISPEL_PRICE}g)`, () => dispelCurse(item.uid), !window.ArtifactCollection?.unlocked?.('unbind') || (window.DelversGuild && !window.DelversGuild.isMember()) || (deps.inventory.gold || 0) < DISPEL_PRICE)]));
    }

    // Enchant a weapon
    list.appendChild(heading('Enchant a weapon'));
    if (window.DelversGuild && !window.DelversGuild.canEnchant()) list.appendChild(note('New enchanting is illegal. Bring Garanki four distinct artifacts and speak with him privately at his tent to earn his trust.'));
    const weapons = ownedWeaponKeys().filter(key => feyServiceUnlocked() || (gear()?.harlyaoRelics?.[key]?.origin !== 'Fey' && gear()?.captainModularWeapons?.[key]?.origin !== 'Fey')); // Hidden Fey gear cannot enter the service panel before the dialogue unlock.
    if (!weapons.length) { list.appendChild(note('You own no weapons.')); return; }
    const equipped = window.Combat?.deps?.currentWeaponKey?.();
    if (!weapons.includes(selectedWeaponKey)) selectedWeaponKey = weapons.includes(equipped) ? equipped : weapons[0];
    const weaponSelect = select(weapons.map(key => ({ value: key, label: deps.TOOL_ITEM_DEFS[key]?.label || key })), selectedWeaponKey);
    weaponSelect.addEventListener('change', () => { selectedWeaponKey = weaponSelect.value; render(); });
    list.appendChild(weaponSelect);
    if (es) {
      list.appendChild(note(`Immundanity ${es.getWeaponImmundanity(selectedWeaponKey)} · Enchantment power ×${es.getEnchantmentPowerMultiplier(selectedWeaponKey).toFixed(2)} · Mastery effects ×${es.getMasteryPowerMultiplier(selectedWeaponKey).toFixed(2)}`));
    }
    const known = es?.unlockedOptions?.() || { base: [], flourish: [] }; // The enchantment system continues retaining learned Fey magic even while Garanki refuses it.
    const unlocked = {
      base: (known.base || []).filter(id => !isFeyEnchantment(id) || feyServiceUnlocked()),
      flourish: (known.flourish || []).filter(entry => !isFeyEnchantment(entry.id) || feyServiceUnlocked()),
    };
    const state = es?.stateFor?.(selectedWeaponKey) || { base: [], flourishes: {} };

    for (let i = 0; i < (es?.BASE_LIMIT || 2); i++) {
      const current = state.base[i] || '';
      const options = [{ value: '', label: '— choose a learned Base enchantment —' }]
        .concat(unlocked.base.filter(id => id === current || !state.base.includes(id)).map(id => ({ value: id, label: `${defs[id].icon || ''} ${defs[id].displayName} · ${defs[id].alignment}` })));
      const pick = select(options, current);
      const apply = button('Apply', () => pick.value && applyBase(selectedWeaponKey, i, pick.value), !window.ArtifactCollection?.unlocked?.('base') || (window.DelversGuild && !window.DelversGuild.canEnchant()) || !unlocked.base.length); // Label reflects the currently selected Fey/planar origin.
      const updateApplyLabel = () => { apply.textContent = `${isFeyEnchantment(pick.value) ? 'Pretend to enchant' : 'Apply'} (${feyServicePrice(TUNING.APPLY_BASE_PRICE, isFeyEnchantment(pick.value))}g)`; };
      pick.addEventListener('change', updateApplyLabel);
      updateApplyLabel();
      const controls = [pick, apply];
      if (current) controls.push(button(`${isFeyEnchantment(current) ? 'Pretend to remove' : 'Remove'} (${feyServicePrice(TUNING.REMOVE_PRICE, isFeyEnchantment(current))}g)`, () => clearSlot(selectedWeaponKey, 'base', i), !window.ArtifactCollection?.unlocked?.('remove') || (window.DelversGuild && !window.DelversGuild.isMember())));
      list.appendChild(row('✦', `Base Enchantment ${i + 1}`,
        esc(current ? `${defs[current].displayName} (${defs[current].alignment}) — ${defs[current].description}` : 'Empty. Applies to every qualifying hit.'), controls));
    }

    for (const slotId of slotIds()) {
      const current = state.flourishes?.[slotId] || '';
      const options = [{ value: '', label: '— choose a learned Flourish —' }]
        .concat(unlocked.flourish.filter(entry => entry.slotId === slotId && es?.allowsFlourishSlot?.(entry.id, slotId) !== false).map(entry => ({ value: entry.id, label: `${defs[entry.id].icon || ''} ${defs[entry.id].displayName} · ${defs[entry.id].alignment}` })));
      const pick = select(options, current);
      const any = options.length > 1;
      const apply = button('Apply', () => pick.value && applyFlourish(selectedWeaponKey, slotId, pick.value), !window.ArtifactCollection?.unlocked?.('flourish') || (window.DelversGuild && !window.DelversGuild.canEnchant()) || !any); // Fey Flourishes use the same doubled fee and pretend label as Base magic.
      const updateApplyLabel = () => { apply.textContent = `${isFeyEnchantment(pick.value) ? 'Pretend to enchant' : 'Apply'} (${feyServicePrice(TUNING.APPLY_FLOURISH_PRICE, isFeyEnchantment(pick.value))}g)`; };
      pick.addEventListener('change', updateApplyLabel);
      updateApplyLabel();
      const controls = [pick, apply];
      if (current) controls.push(button(`${isFeyEnchantment(current) ? 'Pretend to remove' : 'Remove'} (${feyServicePrice(TUNING.REMOVE_PRICE, isFeyEnchantment(current))}g)`, () => clearSlot(selectedWeaponKey, 'flourish', slotId), !window.ArtifactCollection?.unlocked?.('remove') || (window.DelversGuild && !window.DelversGuild.isMember())));
      list.appendChild(row('❋', `${esc(flourishTriggerLabel(slotId, selectedWeaponKey))} Flourish`,
        esc(current ? `${defs[current].displayName} (${defs[current].alignment}) — ${defs[current].description}` : any ? 'Empty.' : `Garanki has not learned any Flourish for ${slotId.toUpperCase()} yet.`), controls));
    }

    list.appendChild(heading('What Garanki has learned'));
    const learned = [...unlocked.base.map(id => `${defs[id].displayName} (Base)`), ...unlocked.flourish.map(entry => `${defs[entry.id].displayName} (${entry.slotId.toUpperCase()} Flourish)`)];
    list.appendChild(note(learned.length ? learned.join(' · ') : 'Nothing yet — each relic you have him unbind teaches him its enchantments.'));

    if (deps.isDevMode?.()) {
      list.appendChild(heading('[Dev]'));
      list.appendChild(button('Copy artifact/enchanting diagnostics', () => window.navigator?.clipboard?.writeText(JSON.stringify(debugSnapshot(), null, 2))));
    }
  }

  function debugSnapshot() {
    return {
      bound: boundRelicsInInventory().map(entry => ({ key: entry.key, shape: entry.shape, origin: entry.origin, enchantments: entry.enchantments, price: unbindPrice(entry.enchantments, entry.origin) })),
      boundCaptains: window.BanditCaptainArmaments?.boundWeaponsInInventory?.() || [], // Mobile diagnostics include pending registrations.
      unbound: Object.keys(gear()?.harlyaoRelics || {}),
      latestChange: 'Unbinding clears verdigris and resets Mastery to 0; bronze relics then age with their new owner.',
      unlocks: ES()?.unlockedOptions?.() || null,
      collection: window.ArtifactCollection?.debugSnapshot?.() || null,
      feyQuest: window.FeyArmamentQuest?.debugSnapshot?.() || null, // Visible through the existing mobile artifact/enchanting diagnostics.
    };
  }

  window.DevCompanion?.registerCheatPanel?.({
    id: 'relic-grants', title: 'Harlyao relics', order: 35,
    render: () => ({ actions: [{ id: 'grant', label: 'Grant random bound relic' }] }),
    onAction: action => {
      if (action !== 'grant') return { ok: false };
      return { ok: !!grantBoundRelic() };
    },
  });

  window.HarlyaoRelics = Object.freeze({
    SHAPES,
    TUNING,
    init,
    render,
    restore,
    dispelCurse,
    cursedCircletsInPack,
    DISPEL_PRICE,
    makeRelic,
    makeFeyRelic,
    rollEnchantments,
    encodeBoundKey,
    decodeBoundKey,
    isBoundKey,
    unbindPrice,
    ensureBoundItemDef,
    ensureInventoryItemDefs,
    grantBoundRelic,
    rollBossChestRelic,
    boundRelicsInInventory,
    unbind,
    applyBase,
    applyFlourish,
    clearSlot,
    ownedWeaponKeys,
    debugSnapshot,
  });
})();
