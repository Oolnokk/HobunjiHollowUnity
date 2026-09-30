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
      animStyle: 'sweep', dmgType: 'sharp', weaponIdleClass: 'heavy',
    }),
    broadsword: Object.freeze({
      label: 'Harlyao Broadsword', sprite: 'assets/toolsprites/harlyao_broadsword.png', icon: '🗡️',
      animStyle: 'sweep', dmgType: 'sharp', weaponIdleClass: 'heavy',
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
  const RELIC_TOOL_PREFIX = 'harlyaoRelic_';
  const SLOT_IDS = ['tap1', 'tap2', 'hold1', 'hold2']; // Mirrors Combat.loadout.SLOT_IDS when that module is absent (tests).

  let deps = null;

  function init(injectedDeps) {
    deps = injectedDeps;
  }

  const ES = () => window.EnchantmentSystem;
  const rnd = () => window.GameRandom?.random?.() ?? Math.random();
  const slotIds = () => window.Combat?.loadout?.SLOT_IDS || SLOT_IDS;
  const gear = () => deps?.getGearInventory?.() || null;

  function esc(text) {
    return deps?.esc ? deps.esc(text) : String(text ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  }

  let uidCounter = 0; // Distinct keys even for several relics in one millisecond.
  function newUid() {
    uidCounter = (uidCounter + 1) % 1296;
    return Date.now().toString(36) + uidCounter.toString(36).padStart(2, '0') + Math.floor(Math.random() * 1296).toString(36);
  }

  // ── Bound-relic key codec ────────────────────────────────────────
  // harlyaoBound_<shape>_<uid>_B<base-base>_F<slot.id-slot.id>
  function encodeBoundKey(relic) {
    const base = (relic.enchantments?.base || []).join('-');
    const flourishes = Object.entries(relic.enchantments?.flourishes || {}).map(([slot, id]) => `${slot}.${id}`).join('-');
    return `${BOUND_PREFIX}${relic.shape}_${relic.uid}_B${base}_F${flourishes}`;
  }

  function decodeBoundKey(key) {
    const match = /^harlyaoBound_([a-z]+)_([a-z0-9]+)_B([A-Za-z-]*)_F([A-Za-z0-9.-]*)$/.exec(String(key || ''));
    if (!match || !SHAPES[match[1]]) return null;
    const flourishes = {};
    for (const pair of match[4] ? match[4].split('-') : []) {
      const [slot, id] = pair.split('.');
      if (slot && id) flourishes[slot] = id;
    }
    const raw = { base: match[3] ? match[3].split('-') : [], flourishes };
    const enchantments = ES()?.cleanWeaponState ? ES().cleanWeaponState(raw) : raw;
    return { shape: match[1], uid: match[2], enchantments };
  }

  function isBoundKey(key) {
    return String(key || '').startsWith(BOUND_PREFIX) && !!decodeBoundKey(key);
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

  function unbindPrice(enchantments) {
    return TUNING.UNBIND_BASE_PRICE + TUNING.UNBIND_PRICE_PER_ENCHANTMENT * enchantmentCount(enchantments);
  }

  // ── Rolling ─────────────────────────────────────────────────────
  function rollEnchantments() {
    const defs = Object.values(ES()?.DEFINITIONS || {});
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
    for (const slot of slotIds()) if (rnd() < TUNING.FLOURISH_SLOT_FILL_CHANCE && flourishIds.length) flourishes[slot] = pick(flourishIds);
    // A relic is only worth unbinding if it teaches something: never roll an
    // empty one. Not every slot is filled, but at least one always is.
    if (!base.length && !Object.keys(flourishes).length) {
      if (rnd() < 0.5 && baseIds.length) base.push(pick(baseIds));
      else if (flourishIds.length) flourishes[pick(slotIds())] = pick(flourishIds);
    }
    return { base, flourishes };
  }

  function makeRelic(shape) {
    const shapes = Object.keys(SHAPES);
    return { shape: SHAPES[shape] ? shape : shapes[Math.floor(rnd() * shapes.length)], uid: newUid(), enchantments: rollEnchantments() };
  }

  // ── World-inventory (bound) side ────────────────────────────────
  function ensureBoundItemDef(key) {
    const relic = decodeBoundKey(key);
    if (!relic || !deps?.ITEM_DEFS) return null;
    const shape = SHAPES[relic.shape];
    const lines = describeEnchantments(relic.enchantments);
    deps.ITEM_DEFS[key] = {
      icon: shape.icon,
      label: `Bound ${shape.label}`,
      cat: 'material',
      sellPrice: 0,
      spriteIcon: '../toolsprites/' + shape.sprite.split('/').pop(), // applyItemSpriteIcon resolves under assets/objectsprites/.
      tags: ['Harlyao', 'Relic', 'Bound'],
      desc: `An ancient ${shape.label.replace('Harlyao ', '').toLowerCase()} still bound to its long-dead Harlyao owner — it cannot be wielded. Garanki Gabu can unbind it (${unbindPrice(relic.enchantments)}g). Enchantments: ${lines.join('; ') || 'none'}.`,
      harlyaoBoundRelic: true,
    };
    if (Array.isArray(deps.inventoryItems) && !deps.inventoryItems.some(entry => entry.key === key)) {
      deps.inventoryItems.push({ key, icon: shape.icon, label: `BOUND ${shape.label.toUpperCase()}`, max: 1 });
    }
    return deps.ITEM_DEFS[key];
  }

  function ensureInventoryItemDefs(inventory = deps?.inventory) {
    for (const key of Object.keys(inventory || {})) if (key.startsWith(BOUND_PREFIX)) ensureBoundItemDef(key);
  }

  function grantBoundRelic(relic = makeRelic()) {
    if (!deps?.inventory) return null;
    const key = encodeBoundKey(relic);
    ensureBoundItemDef(key);
    deps.inventory[key] = 1;
    deps.buildInventoryGrid?.();
    deps.saveMemberWorldData?.();
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
      .filter(key => (deps.inventory[key] || 0) > 0 && key.startsWith(BOUND_PREFIX))
      .map(key => ({ key, ...decodeBoundKey(key) }))
      .filter(entry => entry.shape);
  }

  // ── Gear (unbound) side ─────────────────────────────────────────
  function relicToolKey(relic) {
    return `${RELIC_TOOL_PREFIX}${relic.shape}_${relic.uid}`;
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

  function unbind(boundKey) {
    const relic = decodeBoundKey(boundKey);
    if (!relic || !((deps?.inventory?.[boundKey] || 0) > 0)) return { ok: false, reason: 'not-owned' };
    const price = unbindPrice(relic.enchantments);
    if (!spendGold(price)) return { ok: false, reason: 'gold', price };
    const g = gear();
    const toolKey = relicToolKey(relic);
    delete deps.inventory[boundKey];
    if (!g.harlyaoRelics || typeof g.harlyaoRelics !== 'object') g.harlyaoRelics = {};
    g.harlyaoRelics[toolKey] = { shape: relic.shape, uid: relic.uid, originalEnchantments: relic.enchantments, unboundAt: Date.now() };
    if (!g.tools) g.tools = {};
    g.tools[toolKey] = true;
    registerRelicTool(toolKey, g.harlyaoRelics[toolKey]);
    const es = ES();
    if (es) {
      es.stateFor(toolKey, true);
      for (const id of relic.enchantments.base) es.addBase(toolKey, id);
      for (const [slot, id] of Object.entries(relic.enchantments.flourishes)) es.setFlourish(toolKey, slot, id);
    }
    const learned = es?.unlockFromState?.(relic.enchantments) || [];
    deps.saveGearInventory?.();
    deps.saveMemberWorldData?.();
    deps.buildInventoryGrid?.();
    deps.buildEquipmentSlots?.();
    deps.showToast?.(`Garanki unbinds the ${SHAPES[relic.shape].label}. It's yours now${learned.length ? ` — and he has learned ${learned.join(', ')}` : ''}.`, true);
    render();
    return { ok: true, toolKey, learned, price };
  }

  function ownedWeaponKeys() {
    const g = gear();
    return Object.keys(g?.tools || {}).filter(key => g.tools[key] && deps?.TOOL_ITEM_DEFS?.[key]?.slots?.includes('weapon'));
  }

  function applyBase(weaponKey, slotIndex, id) {
    const es = ES();
    if (!es || !ownedWeaponKeys().includes(weaponKey)) return { ok: false, reason: 'weapon' };
    if (!es.isBaseUnlocked(id)) return { ok: false, reason: 'locked' };
    const current = es.stateFor(weaponKey).base;
    if (current[slotIndex] === id) return { ok: false, reason: 'unchanged' };
    if (current.includes(id)) {
      deps?.showToast?.('That weapon already carries that enchantment.', false);
      return { ok: false, reason: 'duplicate' };
    }
    if (slotIndex >= es.BASE_LIMIT) return { ok: false, reason: 'limit' };
    if (!spendGold(TUNING.APPLY_BASE_PRICE)) return { ok: false, reason: 'gold' };
    const index = Math.min(slotIndex, current.length); // Filling slot 2 while slot 1 is empty lands in slot 1.
    es.equipBase(weaponKey, index, id);
    afterEnchant(`Garanki enchants the weapon with ${es.DEFINITIONS[id].displayName}.`);
    return { ok: true };
  }

  function applyFlourish(weaponKey, slotId, id) {
    const es = ES();
    if (!es || !ownedWeaponKeys().includes(weaponKey)) return { ok: false, reason: 'weapon' };
    if (!es.isFlourishUnlocked(id, slotId)) return { ok: false, reason: 'locked' };
    if (es.flourishForSlot(slotId, weaponKey) === id) return { ok: false, reason: 'unchanged' };
    if (!spendGold(TUNING.APPLY_FLOURISH_PRICE)) return { ok: false, reason: 'gold' };
    es.setFlourish(weaponKey, slotId, id); // One Flourish per slot: this replaces whatever was there.
    afterEnchant(`Garanki binds a ${es.DEFINITIONS[id].displayName} Flourish to ${slotId.toUpperCase()}.`);
    return { ok: true };
  }

  function clearSlot(weaponKey, kind, slot) {
    const es = ES();
    if (!es || !ownedWeaponKeys().includes(weaponKey)) return { ok: false, reason: 'weapon' };
    const has = kind === 'base' ? !!es.stateFor(weaponKey).base[slot] : !!es.flourishForSlot(slot, weaponKey);
    if (!has) return { ok: false, reason: 'empty' };
    if (!spendGold(TUNING.REMOVE_PRICE)) return { ok: false, reason: 'gold' };
    if (kind === 'base') es.equipBase(weaponKey, slot, null);
    else es.setFlourish(weaponKey, slot, null);
    afterEnchant('Garanki strips the enchantment away.');
    return { ok: true };
  }

  function afterEnchant(message) {
    deps?.saveGearInventory?.();
    deps?.saveMemberWorldData?.();
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

    // Bound relics
    list.appendChild(heading('Bound Harlyao relics'));
    const bound = boundRelicsInInventory();
    if (!bound.length) list.appendChild(note('Bring Garanki a bound relic from a Harlyao ruin’s boss vault and he will break its old owner’s claim.'));
    for (const relic of bound) {
      const price = unbindPrice(relic.enchantments);
      const shape = SHAPES[relic.shape];
      list.appendChild(row(shape.icon, esc(`Bound ${shape.label}`),
        esc(describeEnchantments(relic.enchantments).join(' · ') || 'No enchantments'),
        [button(`Unbind (${price}g)`, () => unbind(relic.key), (deps.inventory.gold || 0) < price)]));
    }

    // Enchant a weapon
    list.appendChild(heading('Enchant a weapon'));
    const weapons = ownedWeaponKeys();
    if (!weapons.length) { list.appendChild(note('You own no weapons.')); return; }
    const equipped = window.Combat?.deps?.currentWeaponKey?.();
    if (!weapons.includes(selectedWeaponKey)) selectedWeaponKey = weapons.includes(equipped) ? equipped : weapons[0];
    const weaponSelect = select(weapons.map(key => ({ value: key, label: deps.TOOL_ITEM_DEFS[key]?.label || key })), selectedWeaponKey);
    weaponSelect.addEventListener('change', () => { selectedWeaponKey = weaponSelect.value; render(); });
    list.appendChild(weaponSelect);
    if (es) {
      list.appendChild(note(`Immundanity ${es.getWeaponImmundanity(selectedWeaponKey)} · Enchantment power ×${es.getEnchantmentPowerMultiplier(selectedWeaponKey).toFixed(2)} · Mastery effects ×${es.getMasteryPowerMultiplier(selectedWeaponKey).toFixed(2)}`));
    }
    const unlocked = es?.unlockedOptions?.() || { base: [], flourish: [] };
    const state = es?.stateFor?.(selectedWeaponKey) || { base: [], flourishes: {} };

    for (let i = 0; i < (es?.BASE_LIMIT || 2); i++) {
      const current = state.base[i] || '';
      const options = [{ value: '', label: '— choose a learned Base enchantment —' }]
        .concat(unlocked.base.filter(id => id === current || !state.base.includes(id)).map(id => ({ value: id, label: `${defs[id].icon || ''} ${defs[id].displayName} · ${defs[id].alignment}` })));
      const pick = select(options, current);
      const controls = [pick, button(`Apply (${TUNING.APPLY_BASE_PRICE}g)`, () => pick.value && applyBase(selectedWeaponKey, i, pick.value), !unlocked.base.length)];
      if (current) controls.push(button(`Remove (${TUNING.REMOVE_PRICE}g)`, () => clearSlot(selectedWeaponKey, 'base', i)));
      list.appendChild(row('✦', `Base Enchantment ${i + 1}`,
        esc(current ? `${defs[current].displayName} (${defs[current].alignment}) — ${defs[current].description}` : 'Empty. Applies to every qualifying hit.'), controls));
    }

    for (const slotId of slotIds()) {
      const current = state.flourishes?.[slotId] || '';
      const options = [{ value: '', label: '— choose a learned Flourish —' }]
        .concat(unlocked.flourish.filter(entry => entry.slotId === slotId).map(entry => ({ value: entry.id, label: `${defs[entry.id].icon || ''} ${defs[entry.id].displayName} · ${defs[entry.id].alignment}` })));
      const pick = select(options, current);
      const any = options.length > 1;
      const controls = [pick, button(`Apply (${TUNING.APPLY_FLOURISH_PRICE}g)`, () => pick.value && applyFlourish(selectedWeaponKey, slotId, pick.value), !any)];
      if (current) controls.push(button(`Remove (${TUNING.REMOVE_PRICE}g)`, () => clearSlot(selectedWeaponKey, 'flourish', slotId)));
      list.appendChild(row('❋', `${esc(flourishTriggerLabel(slotId, selectedWeaponKey))} Flourish`,
        esc(current ? `${defs[current].displayName} (${defs[current].alignment}) — ${defs[current].description}` : any ? 'Empty.' : `Garanki has not learned any Flourish for ${slotId.toUpperCase()} yet.`), controls));
    }

    list.appendChild(heading('What Garanki has learned'));
    const learned = [...unlocked.base.map(id => `${defs[id].displayName} (Base)`), ...unlocked.flourish.map(entry => `${defs[entry.id].displayName} (${entry.slotId.toUpperCase()} Flourish)`)];
    list.appendChild(note(learned.length ? learned.join(' · ') : 'Nothing yet — each relic you have him unbind teaches him its enchantments.'));

    if (deps.isDevMode?.()) {
      list.appendChild(heading('[Dev]'));
      list.appendChild(button('[Dev] Grant random bound relic', () => { grantBoundRelic(); render(); }));
    }
  }

  function debugSnapshot() {
    return {
      bound: boundRelicsInInventory().map(entry => ({ key: entry.key, shape: entry.shape, enchantments: entry.enchantments, price: unbindPrice(entry.enchantments) })),
      unbound: Object.keys(gear()?.harlyaoRelics || {}),
      unlocks: ES()?.unlockedOptions?.() || null,
    };
  }

  window.HarlyaoRelics = Object.freeze({
    SHAPES,
    TUNING,
    init,
    render,
    restore,
    makeRelic,
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
