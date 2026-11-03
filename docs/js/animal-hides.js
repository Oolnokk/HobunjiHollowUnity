(() => {
  'use strict';
  if (window.AnimalHides) return;

  // Hide rarity is a view of CreatureGenetics.sellValueFor, not a second rarity roll.
  const RARITY_STARS = Object.freeze({ Common: 1, Distinctive: 2, Striking: 3, Rare: 4, Exceptional: 5 });
  const HIDE_KEYS = new Set(['garWolfHide', 'alphaGarWolfHide', 'dabinggiHoundHide', 'grehlrHide', 'drenkirraHide']); // Known butcher outputs; new species can use the same Hide suffix.
  const debug = { recorded: 0, consumed: 0, transferred: 0, lastAction: 'not used', lastKey: null, errors: [] }; // Read from Shipping Box's mobile debug panel.
  let pack = Object.create(null); // Per-unit hides carried by the current world member, parallel to the count-based inventory.
  let shipping = Object.create(null); // Hides temporarily in the Shipping Box, paired with its in-memory contents.

  function isHide(key) {
    return typeof key === 'string' && (HIDE_KEYS.has(key) || /^[a-z][a-z0-9]*Hide$/i.test(key));
  }
  function clone(value) {
    if (value == null) return null;
    try { return JSON.parse(JSON.stringify(value)); }
    catch (error) { debug.errors.push('clone: ' + String(error?.message || error)); return null; }
  }
  function count(value) { return Math.max(0, Math.floor(Number(value) || 0)); }
  function price(value, fallback = 1) {
    const amount = Number(value);
    return Number.isFinite(amount) && amount > 0 ? Math.max(1, Math.round(amount)) : Math.max(1, Math.round(Number(fallback) || 1));
  }
  function bucket(scope) { return scope === 'shipping' ? shipping : pack; }
  function signature(record) {
    return window.InventoryStacks?.genotypeKey?.(record) || JSON.stringify(record); // Exact coat/paint/quality identity; not merely the five-star tier.
  }
  function variantFor(record) { return 'hide:' + signature(record); }
  function makeRecord(key, creature, baselinePrice) {
    const rawKind = creature?.creatureKey || creature?.animalKey || creature?.kind || null; // The dead specimen supplies its actual appearance, not a newly rolled animal.
    const kind = window.CreatureGenetics?.SPECIES_ALIAS?.[rawKind] || rawKind; // Alpha and den-mother variants use their underlying coat species.
    const normalized = creature?.genotype
      ? window.CreatureGenetics?.normalizeLegacyGenotype?.(kind, creature.genotype) || creature.genotype
      : null;
    const genotype = clone(normalized); // Future fur clothing can reconstruct every visible color/pattern and optional paint layer.
    const value = genotype ? window.CreatureGenetics?.sellValueFor?.(genotype, kind) : null; // The exact existing livestock rarity/value function.
    const animalValue = Number.isFinite(Number(value?.amount)) && Number(value.amount) >= 100 ? Number(value.amount) : 100;
    const rarityTier = RARITY_STARS[value?.tier] ? value.tier : 'Common';
    const traits = genotype ? window.CreatureGenetics?.genotypeTraits?.(kind, genotype) : null;
    const appearance = {
      baseColor: genotype?.base?.color || null,
      colors: clone(traits?.colors || []) || [],
      patterns: clone((traits?.patterns || []).filter(layer => layer.enabled)) || [],
      colorPoolPaint: clone(genotype?.colorPoolPaint || null),
    }; // Display-ready visible coat summary; complete genetic/paint data also stays in genotype.
    return {
      schema: 1, itemKey: key, sourceKind: rawKind, kind, genotype, appearance,
      rarity: { tier: rarityTier, animalValue, comparison: value?.comparison || 'Plain specimen', contrastScore: Number(value?.contrastScore) || 0 },
      stars: RARITY_STARS[rarityTier],
      sellPrice: price(price(baselinePrice) * animalValue / 100),
    };
  }
  function recordFromCreature(key, creature, quantity, baselinePrice) {
    if (!isHide(key) || count(quantity) < 1) return null;
    const record = makeRecord(key, creature, baselinePrice);
    const list = pack[key] || (pack[key] = []); // One snapshot per acquired unit, even when a creature drops several hides.
    for (let i = 0; i < count(quantity); i++) list.push(clone(record));
    debug.recorded += count(quantity);
    debug.lastAction = 'butcher';
    debug.lastKey = key;
    return clone(record);
  }
  function groupsFor(key, total) {
    if (!isHide(key)) return null;
    const available = count(total); // The game's count inventory is authoritative for legacy/missing metadata.
    const records = (pack[key] || []).slice(0, available);
    const groups = new Map(); // Identical full genotypes/paint/rarity stack together, unlike merely matching stars.
    for (const record of records) {
      const variant = variantFor(record);
      const group = groups.get(variant);
      if (group) group.count++;
      else groups.set(variant, { variant, count: 1, stars: record.stars, hideRecord: clone(record) });
    }
    if (available > records.length) groups.set('hide:generic', { variant: 'hide:generic', count: available - records.length, stars: 1, hideRecord: null });
    return [...groups.values()];
  }
  function selectUnits(key, quantity, scope, baselinePrice, availableCount, variant = null) {
    if (!isHide(key)) return { ok: false, total: 0, records: [] };
    const wanted = count(quantity), available = count(availableCount);
    if (!wanted || wanted > available) return { ok: false, total: 0, records: [] };
    const list = bucket(scope)[key] || [];
    const trackedCount = Math.min(list.length, available);
    const choices = []; // Each candidate is either a saved coat or a legacy generic hide.
    for (let i = 0; i < trackedCount; i++) {
      const record = list[i];
      choices.push({ index: i, record, value: price(record?.sellPrice, baselinePrice), variant: variantFor(record) });
    }
    for (let i = trackedCount; i < available; i++) choices.push({ index: -1, record: null, value: price(baselinePrice), variant: 'hide:generic' });
    const eligible = variant == null ? choices : choices.filter(unit => unit.variant === variant);
    if (variant == null) eligible.sort((a, b) => a.value - b.value || a.index - b.index); // Sell/ship the least valuable specimens first.
    if (wanted > eligible.length) return { ok: false, total: 0, records: [] };
    const selected = eligible.slice(0, wanted);
    return { ok: true, total: selected.reduce((sum, unit) => sum + unit.value, 0), records: selected.filter(unit => unit.record).map(unit => clone(unit.record)), indices: selected.filter(unit => unit.index >= 0).map(unit => unit.index), count: wanted };
  }
  function quote(key, quantity, scope = 'pack', baselinePrice = 1, availableCount = quantity, variant = null) {
    const result = selectUnits(key, quantity, scope, baselinePrice, availableCount, variant); // Read-only price preview for the General Store.
    return { ok: result.ok, total: result.total, count: result.count || 0 };
  }
  function consume(key, quantity, scope = 'pack', baselinePrice = 1, availableCount = quantity, variant = null) {
    const selection = selectUnits(key, quantity, scope, baselinePrice, availableCount, variant);
    if (!selection.ok) return selection;
    const store = bucket(scope);
    const list = store[key] || [];
    for (const index of selection.indices.sort((a, b) => b - a)) list.splice(index, 1); // Descending indices preserve the original selected instances.
    if (!list.length) delete store[key];
    debug.consumed += selection.count;
    debug.lastAction = 'consume ' + scope;
    debug.lastKey = key;
    return selection; // Caller owns inventory-count decrement; return the exact unit sell value, without any extra star multiplier.
  }
  function transfer(key, quantity, from, to, fromCount, baselinePrice = 1) {
    if (!isHide(key) || from === to) return { ok: true, count: 0, total: 0 };
    const taken = consume(key, quantity, from, baselinePrice, fromCount);
    if (!taken.ok) return taken;
    const destination = bucket(to);
    const list = destination[key] || (destination[key] = []); // The destination's count is updated by its existing inventory code.
    taken.records.forEach(record => list.push(record));
    debug.transferred += taken.count;
    debug.consumed -= taken.count; // Moving a hide is not a sale or destruction.
    debug.lastAction = from + ' to ' + to;
    return taken;
  }
  function clearShipping() { shipping = Object.create(null); debug.lastAction = 'clear shipping'; }
  function serialize() {
    const records = {}; // World-member save payload includes the Pack's exact remaining hides, not the Shipping Box's unsaved counts.
    for (const [key, list] of Object.entries(pack)) if (isHide(key) && list.length) records[key] = clone(list);
    return { version: 1, pack: records };
  }
  function restore(data, inventory = {}) {
    pack = Object.create(null);
    shipping = Object.create(null); // The Shipping Box itself currently has no persisted contents, so never resurrect orphaned transit metadata.
    for (const [key, list] of Object.entries(data?.pack || {})) {
      if (!isHide(key) || !Array.isArray(list)) continue;
      const available = count(inventory[key]); // Never restore more records than actually owned items.
      const valid = list.slice(0, available).filter(record => record && typeof record === 'object' && record.itemKey === key && Number.isFinite(Number(record.sellPrice)));
      if (valid.length) pack[key] = clone(valid);
    }
    debug.lastAction = 'restore';
    return getDebug();
  }
  function describe(record) {
    if (!record) return 'Legacy hide; its original coat was not recorded.';
    const appearance = record.appearance || {};
    const colors = (appearance.colors || []).map(color => (color.label || color.id || 'Coat') + ' ' + (color.colorName || color.color || ''));
    const patterns = (appearance.patterns || []).map(layer => (layer.label || layer.id) + ' ' + (layer.colorName || layer.color || ''));
    const paint = appearance.colorPoolPaint ? ['custom coat paint preserved'] : [];
    return [record.rarity?.tier || 'Common', record.rarity?.comparison, ...colors, ...patterns, ...paint].filter(Boolean).join(' · ');
  }
  function getDebug() {
    const totals = state => Object.fromEntries(Object.entries(state).map(([key, list]) => [key, list.length]));
    return { ...debug, pack: totals(pack), shipping: totals(shipping), errors: debug.errors.slice(-8) };
  }
  window.AnimalHides = Object.freeze({ isHide, makeRecord, recordFromCreature, groupsFor, quote, consume, transfer, clearShipping, serialize, restore, describe, getDebug });
})();