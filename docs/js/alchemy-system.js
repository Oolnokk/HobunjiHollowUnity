(() => {
  'use strict';

  // Alchemy: reagent foraging, potion brewing, and the active buff/debuff
  // bar. Standard Elder-Scrolls-style setup: every reagent carries up to 3
  // named boon/bane effects, but only effects[0] is known to the player
  // from the start. Brewing 2-3 reagents at an Alchemy Table applies
  // whichever effects appear on 2+ of the chosen reagents (see
  // computeBrewEffects) and reveals ("discovers") those effects on every
  // reagent that has them. Magnitude/duration are deliberately generic
  // placeholders for most effects — only 'speed' is wired to an actual
  // stat (see getSpeedMul) since the rest of the mechanical design is
  // still open; every effect at least shows up as a named, timed
  // buff/debuff icon in the on-screen buff bar once applied.
  //
  // Extracted out of game.js following the same window.<Namespace> +
  // init(deps) pattern already used by js/bounty-board.js and
  // js/bandit-camps.js. World-side reagent plant scattering/picking
  // (buildReagentPlantMesh, scatterReagentsForZone, ensureZoneReagents,
  // etc.) stays in game.js since it's tied to Three.js zone scene
  // internals — it reads REAGENT_DEFS/reagentsForZone from here instead.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  const ALCHEMY_EFFECT_DEFS = {
    strength:   { label: 'Strength',   icon: '💪', kind: 'boon', durationS: 90, desc: 'Something in you feels sturdier.' },
    fortitude:  { label: 'Fortitude',  icon: '🛡️', kind: 'boon', durationS: 90, desc: 'You feel harder to knock down.' },
    vigor:      { label: 'Vigor',      icon: '⚡', kind: 'boon', durationS: 90, desc: 'Energy hums through your limbs.' },
    speed:      { label: 'Speed',      icon: '🏃', kind: 'boon', durationS: 60, desc: 'Your steps come lighter and faster.', speedMul: 1.35 },
    perception: { label: 'Perception', icon: '👁️', kind: 'boon', durationS: 90, desc: 'The world looks sharper somehow.' },
    clarity:    { label: 'Clarity',    icon: '🧠', kind: 'boon', durationS: 90, desc: 'Your thoughts feel clean and ordered.' },
    stupor:     { label: 'Stupor',     icon: '😵', kind: 'bane', durationS: 60, desc: 'Your head is thick and slow.' },
    weakness:   { label: 'Weakness',   icon: '🦴', kind: 'bane', durationS: 60, desc: 'Your limbs feel drained of power.' },
    frailty:    { label: 'Frailty',    icon: '💔', kind: 'bane', durationS: 60, desc: 'You feel brittle, easily hurt.' },
    clumsiness: { label: 'Clumsiness', icon: '🤕', kind: 'bane', durationS: 60, desc: 'Your hands and feet won\'t cooperate.' },
    nausea:     { label: 'Nausea',     icon: '🤢', kind: 'bane', durationS: 60, desc: 'Your stomach churns unpleasantly.' },
    dread:      { label: 'Dread',      icon: '😱', kind: 'bane', durationS: 60, desc: 'A cold unease settles over you.' },
  };

  // Reagent plants foraged from the four wilderness zones. `color` tints
  // the plant's billboard sprite — see game.js's buildReagentPlantMesh —
  // as a placeholder stand-in until each reagent gets its own model.
  const ALCHEMY_REAGENT_DEFS = {
    frostcapMoss:      { label: 'Frostcap Moss',      icon: '🥶', zone: 'map_northern_cliffs',       color: 0x9fd8e6, sellPrice: 3, effects: ['fortitude', 'weakness', 'stupor'] },
    graniteThistle:    { label: 'Granite Thistle',    icon: '🌵', zone: 'map_northern_cliffs',       color: 0x8a8a78, sellPrice: 3, effects: ['strength', 'frailty', 'clumsiness'] },
    palehartLichen:    { label: 'Palehart Lichen',    icon: '🍂', zone: 'map_northern_cliffs',       color: 0xc9c2a0, sellPrice: 3, effects: ['perception', 'dread', 'weakness'] },
    cinderveinBramble: { label: 'Cindervein Bramble', icon: '🌿', zone: 'map_northern_cliffs',       color: 0xb5493a, sellPrice: 3, effects: ['vigor', 'nausea', 'strength'] },
    shalefrondFern:    { label: 'Shalefrond Fern',    icon: '🌾', zone: 'map_northern_cliffs',       color: 0x6f8f7a, sellPrice: 3, effects: ['clarity', 'stupor', 'fortitude'] },

    mistpetalBloom:    { label: 'Mistpetal Bloom',    icon: '🌸', zone: 'map_southern_cloud_forest', color: 0xd7b7e8, sellPrice: 3, effects: ['clarity', 'dread', 'perception'] },
    duskcapMushroom:   { label: 'Duskcap Mushroom',   icon: '🍄', zone: 'map_southern_cloud_forest', color: 0x5a4a78, sellPrice: 3, effects: ['vigor', 'stupor', 'nausea'] },
    silverfernFrond:   { label: 'Silverfern Frond',   icon: '🌿', zone: 'map_southern_cloud_forest', color: 0xc8d8c0, sellPrice: 3, effects: ['perception', 'weakness', 'clarity'] },
    cloudberryVine:    { label: 'Cloudberry Vine',    icon: '🫐', zone: 'map_southern_cloud_forest', color: 0x8ec6e0, sellPrice: 3, effects: ['speed', 'clumsiness', 'vigor'] },
    hazewortSprig:     { label: 'Hazewort Sprig',     icon: '🌱', zone: 'map_southern_cloud_forest', color: 0xa0b090, sellPrice: 3, effects: ['fortitude', 'dread', 'speed'] },

    windrootBulb:      { label: 'Windroot Bulb',      icon: '🧅', zone: 'map_western_slope',         color: 0xe8d27a, sellPrice: 3, effects: ['speed', 'weakness', 'vigor'] },
    goldbrushWeed:     { label: 'Goldbrush Weed',     icon: '🌾', zone: 'map_western_slope',         color: 0xdba936, sellPrice: 3, effects: ['strength', 'clumsiness', 'fortitude'] },
    larkspurTuft:      { label: 'Larkspur Tuft',      icon: '💐', zone: 'map_western_slope',         color: 0x7fb0e0, sellPrice: 3, effects: ['perception', 'stupor', 'speed'] },
    sunbarleyHead:     { label: 'Sunbarley Head',     icon: '🌾', zone: 'map_western_slope',         color: 0xe0c95f, sellPrice: 3, effects: ['vigor', 'nausea', 'strength'] },
    thistledownCap:    { label: 'Thistledown Cap',    icon: '🌼', zone: 'map_western_slope',         color: 0xeee4c0, sellPrice: 3, effects: ['clarity', 'frailty', 'perception'] },

    bogwortLeaf:       { label: 'Bogwort Leaf',       icon: '🍃', zone: 'map_eastern_mire',          color: 0x4a6b3a, sellPrice: 3, effects: ['fortitude', 'nausea', 'strength'] },
    mireLotusBud:      { label: 'Mire Lotus Bud',     icon: '🪷', zone: 'map_eastern_mire',          color: 0xc06090, sellPrice: 3, effects: ['clarity', 'dread', 'weakness'] },
    sporeclusterCap:   { label: 'Sporecluster Cap',   icon: '🍄', zone: 'map_eastern_mire',          color: 0x6a5a3a, sellPrice: 3, effects: ['stupor', 'vigor', 'frailty'] },
    weepingReed:       { label: 'Weeping Reed',       icon: '🌾', zone: 'map_eastern_mire',          color: 0x3a5a4a, sellPrice: 3, effects: ['speed', 'weakness', 'clumsiness'] },
    muckmelonRind:     { label: 'Muckmelon Rind',     icon: '🍈', zone: 'map_eastern_mire',          color: 0x8a9a3a, sellPrice: 3, effects: ['strength', 'nausea', 'fortitude'] },
  };

  function reagentsForZone(mapId) {
    return Object.keys(ALCHEMY_REAGENT_DEFS).filter(k => ALCHEMY_REAGENT_DEFS[k].zone === mapId);
  }

  // Which of a reagent's effects[] indices the player has learned so
  // far. Index 0 is always known; 1/2 are revealed the first time a
  // brew mixes that reagent with another sharing the effect.
  const knownReagentEffects = {}; // reagentKey -> Set(effectIndex)
  function isReagentEffectKnown(reagentKey, idx) {
    if (idx === 0) return true;
    return knownReagentEffects[reagentKey]?.has(idx) || false;
  }
  function discoverReagentEffect(reagentKey, idx) {
    if (idx === 0) return;
    if (!knownReagentEffects[reagentKey]) knownReagentEffects[reagentKey] = new Set();
    knownReagentEffects[reagentKey].add(idx);
  }
  function discoveryCount() {
    return Object.values(knownReagentEffects).reduce((n, s) => n + s.size, 0);
  }

  // Sets aren't JSON-serializable, so save/restore go through plain
  // arrays — see saveMemberWorldData/spawnPlayerAvatar in game.js.
  function serializeKnownEffects() {
    const out = {};
    Object.entries(knownReagentEffects).forEach(([key, set]) => { if (set.size) out[key] = [...set]; });
    return out;
  }
  function restoreKnownEffects(saved) {
    Object.keys(knownReagentEffects).forEach(k => delete knownReagentEffects[k]);
    Object.entries(saved || {}).forEach(([key, idxs]) => {
      if (Array.isArray(idxs) && idxs.length) knownReagentEffects[key] = new Set(idxs);
    });
  }

  // Effects shared by 2+ of the given reagent keys — the classic ES rule
  // for what a brewed mixture actually does.
  function computeBrewEffects(reagentKeys) {
    const counts = {};
    for (const rk of reagentKeys) {
      const def = ALCHEMY_REAGENT_DEFS[rk];
      if (!def) continue;
      def.effects.forEach(eff => { counts[eff] = (counts[eff] || 0) + 1; });
    }
    return Object.keys(counts).filter(eff => counts[eff] >= 2);
  }

  // ── Potions (brewed, storable, drinkable from the bag anywhere) ──
  // A potion's item key is a deterministic sort of its effect list, so
  // the same combination of shared effects always stacks into the same
  // item, and — since effect ids never contain '_' — the key alone is
  // enough to recover which effects it grants after a reload, with no
  // separate persisted registry needed (see getPotionEffectsFromKey,
  // called for every saved inventory key in game.js's spawnPlayerAvatar).
  const ALCHEMY_POTION_ITEMS = {}; // itemKey -> effects[], rebuilt from the key as needed
  function potionKeyForEffects(effects) {
    return 'potion_' + [...effects].sort().join('_');
  }
  function getPotionEffectsFromKey(key) {
    if (!key.startsWith('potion_')) return null;
    const effects = key.slice('potion_'.length).split('_');
    return effects.length && effects.every(e => ALCHEMY_EFFECT_DEFS[e]) ? effects : null;
  }
  // Averages the 0xRRGGBB colors of the reagents that went into a brew —
  // the same THREE-style hex ints ALCHEMY_REAGENT_DEFS/getReagentPlantMaterial
  // already use — into one procedural potion color. Reagent keys missing a
  // color (shouldn't happen; every ALCHEMY_REAGENT_DEFS entry has one) are
  // skipped rather than treated as black, so one bad lookup can't wash the
  // mix toward zero.
  function mixReagentColors(reagentKeys) {
    let r = 0, g = 0, b = 0, n = 0;
    (reagentKeys || []).forEach(k => {
      const c = ALCHEMY_REAGENT_DEFS[k]?.color;
      if (c == null) return;
      r += (c >> 16) & 255; g += (c >> 8) & 255; b += c & 255; n++;
    });
    if (!n) return 0x8a5fb0; // generic potion purple — only hit if reagentKeys was empty/unresolvable
    return (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n);
  }

  // reagentKeys (optional): the actual ingredients brewed this time, used
  // to procedurally mix a color via mixReagentColors — see brew(). Since
  // the item key is purely the sorted effect list (so different reagent
  // combos sharing an effect set stack as the same item — see the comment
  // above ALCHEMY_POTION_ITEMS), the color is fixed at whichever combo
  // first created that effect-key item, same as its name/desc.
  function ensurePotionItemDef(effects, reagentKeys) {
    const key = potionKeyForEffects(effects);
    ALCHEMY_POTION_ITEMS[key] = effects;
    if (!deps.ITEM_DEFS[key]) {
      const names = effects.map(e => ALCHEMY_EFFECT_DEFS[e].label);
      const anyBane = effects.some(e => ALCHEMY_EFFECT_DEFS[e].kind === 'bane');
      const color = mixReagentColors(reagentKeys);
      deps.ITEM_DEFS[key] = {
        icon: '🧪',
        label: 'Potion of ' + names.join(' & '),
        cat: 'processed',
        sellPrice: 0,
        tags: ['Potion', 'Alchemy', ...(anyBane ? ['Mixed'] : [])],
        desc: 'A brewed potion. Drink it (from the Inventory panel, anywhere) to gain: ' + names.join(', ') + '.',
        color,
        spriteIcon: 'bottle_potion.png', spriteColor: color, spriteMode: 'keyed',
      };
    }
    return key;
  }

  // Consumes 1 potion and applies every effect it carries — see game.js's
  // selectInventoryItem's Drink button, the only place this is called
  // from, so it works from the Inventory panel regardless of location.
  function drinkPotion(key) {
    const effects = ALCHEMY_POTION_ITEMS[key] || getPotionEffectsFromKey(key);
    if (!effects || (deps.inventory[key] || 0) < 1) return { ok: false, message: 'No potion to drink.' };
    deps.inventory[key]--;
    deps.clampInventoryStack(key);
    effects.forEach(eff => applyEffect(eff));
    const names = effects.map(e => ALCHEMY_EFFECT_DEFS[e].label).join(', ');
    return { ok: true, message: '🧪 Drank a potion: ' + names + '.' };
  }

  // ── Active buffs/debuffs (on-screen icon strip) ──────────────────
  let activeAlchemyEffects = []; // [{ key, label, icon, kind, durationS, expiresAt }]

  function applyEffect(effectKey) {
    const def = ALCHEMY_EFFECT_DEFS[effectKey];
    if (!def) return;
    const expiresAt = performance.now() / 1000 + def.durationS;
    const existing = activeAlchemyEffects.find(e => e.key === effectKey);
    if (existing) existing.expiresAt = expiresAt; // refresh duration instead of stacking a duplicate icon
    else activeAlchemyEffects.push({ key: effectKey, label: def.label, icon: def.icon, kind: def.kind, durationS: def.durationS, expiresAt });
    refreshBuffBar();
  }

  function getSpeedMul() {
    const speedEff = activeAlchemyEffects.find(e => e.key === 'speed');
    return speedEff ? (ALCHEMY_EFFECT_DEFS.speed.speedMul || 1) : 1;
  }

  // expiresAt is measured against performance.now(), which resets to 0
  // every page load — save/restore go through remaining seconds instead.
  function serializeActiveEffects() {
    const now = performance.now() / 1000;
    return activeAlchemyEffects
      .map(e => ({ key: e.key, remainingS: e.expiresAt - now }))
      .filter(e => e.remainingS > 0);
  }
  function restoreActiveEffects(saved) {
    activeAlchemyEffects = [];
    const now = performance.now() / 1000;
    (saved || []).forEach(({ key, remainingS }) => {
      const def = ALCHEMY_EFFECT_DEFS[key];
      if (!def || !(remainingS > 0)) return;
      activeAlchemyEffects.push({ key, label: def.label, icon: def.icon, kind: def.kind, durationS: def.durationS, expiresAt: now + remainingS });
    });
    refreshBuffBar();
  }

  function update() {
    if (!activeAlchemyEffects.length) return;
    const now = performance.now() / 1000;
    const before = activeAlchemyEffects.length;
    activeAlchemyEffects = activeAlchemyEffects.filter(e => e.expiresAt > now);
    refreshBuffBar(before !== activeAlchemyEffects.length);
  }

  // Rebuilds the buff bar's DOM only when the active effect *set*
  // changes; every other call just updates each icon's countdown fill.
  let _lastBuffBarKey = '';
  function refreshBuffBar() {
    const bar = document.getElementById('buffBar');
    if (!bar) return;
    const key = activeAlchemyEffects.map(e => e.key).join(',');
    if (key !== _lastBuffBarKey) {
      _lastBuffBarKey = key;
      bar.innerHTML = activeAlchemyEffects.map(e => `
        <div class="buff-icon ${e.kind}" data-buff="${e.key}" title="${e.label}">
          <span class="buff-icon-glyph">${e.icon}</span>
          <div class="buff-icon-track"><div class="buff-icon-fill" data-fill="${e.key}"></div></div>
        </div>
      `).join('');
    }
    bar.style.display = activeAlchemyEffects.length ? 'flex' : 'none';
    const now = performance.now() / 1000;
    activeAlchemyEffects.forEach(e => {
      const fill = bar.querySelector(`.buff-icon-fill[data-fill="${e.key}"]`);
      if (!fill) return;
      const remain = Math.max(0, e.expiresAt - now);
      fill.style.width = Math.max(0, Math.min(100, (remain / e.durationS) * 100)) + '%';
    });
  }

  // ── Alchemy panel render (Alchemy Table brewing UI) ─────────────
  const ALCHEMY_MAX_REAGENTS = 3;
  let alchemySelectedReagents = []; // up to ALCHEMY_MAX_REAGENTS reagent keys, chosen from inventory

  function toggleReagent(key) {
    const i = alchemySelectedReagents.indexOf(key);
    if (i >= 0) alchemySelectedReagents.splice(i, 1);
    else if (alchemySelectedReagents.length < ALCHEMY_MAX_REAGENTS) alchemySelectedReagents.push(key);
    renderPanel();
  }

  // Consumes the selected reagents and, if they share any effects (see
  // computeBrewEffects), credits 1 storable Potion item carrying those
  // effects — drunk later from the Inventory panel (see game.js's
  // selectInventoryItem's Drink button), anywhere, not just at the table.
  function brew() {
    const keys = alchemySelectedReagents.filter(k => (deps.inventory[k] || 0) > 0);
    if (keys.length < 2) return { ok: false, message: 'Select at least 2 reagents.' };
    const effects = computeBrewEffects(keys);
    if (!effects.length) return { ok: false, message: 'No shared properties — the mixture does nothing.' };
    for (const rk of keys) {
      const def = ALCHEMY_REAGENT_DEFS[rk];
      def.effects.forEach((eff, idx) => { if (effects.includes(eff)) discoverReagentEffect(rk, idx); });
    }
    keys.forEach(k => { deps.inventory[k]--; deps.clampInventoryStack(k); });
    const potionKey = ensurePotionItemDef(effects, keys);
    deps.inventory[potionKey] = Math.min(99, (deps.inventory[potionKey] || 0) + 1);
    alchemySelectedReagents = [];
    deps.refreshItemScroll();
    const names = effects.map(e => ALCHEMY_EFFECT_DEFS[e].label).join(', ');
    return { ok: true, message: '⚗️ Brewed a Potion of ' + names + '. Drink it from your bag any time.' };
  }

  window._doBrewPotion = function () {
    const result = brew();
    deps.showToast(result.message, result.ok !== false);
    renderPanel();
    if (result.ok !== false) deps.saveMemberWorldData();
  };

  function renderPanel() {
    const list = document.getElementById('alchemyReagentList');
    const selectedEl = document.getElementById('alchemySelectedStrip');
    const previewEl = document.getElementById('alchemyEffectPreview');
    if (!list) return;
    alchemySelectedReagents = alchemySelectedReagents.filter(k => (deps.inventory[k] || 0) > 0);
    const heldReagents = Object.keys(ALCHEMY_REAGENT_DEFS).filter(k => (deps.inventory[k] || 0) > 0);
    list.innerHTML = '';
    if (!heldReagents.length) {
      list.innerHTML = '<div class="delivery-row"><span class="dr-icon">🌿</span><span class="dr-name">No reagents in your bag yet — forage them across the wilderness zones.</span><span class="dr-eta">—</span></div>';
    }
    heldReagents.forEach(key => {
      const def = ALCHEMY_REAGENT_DEFS[key];
      const selected = alchemySelectedReagents.includes(key);
      const effectsHtml = def.effects.map((eff, idx) => isReagentEffectKnown(key, idx)
        ? `<span class="alch-effect ${ALCHEMY_EFFECT_DEFS[eff].kind}">${ALCHEMY_EFFECT_DEFS[eff].icon} ${ALCHEMY_EFFECT_DEFS[eff].label}</span>`
        : `<span class="alch-effect unknown">❓ ?</span>`).join('');
      const row = document.createElement('div');
      row.className = 'shop-row alch-reagent-row' + (selected ? ' selected' : '');
      row.innerHTML = `
        <div class="sh-icon">${def.icon}</div>
        <div class="sh-info">
          <div class="sh-name">${def.label} <span class="alch-count">×${deps.inventory[key]}</span></div>
          <div class="alch-effects">${effectsHtml}</div>
        </div>
        <button class="shop-buy-btn" data-act="toggle">${selected ? 'Selected' : 'Select'}</button>
      `;
      row.querySelector('[data-act="toggle"]')?.addEventListener('click', () => toggleReagent(key));
      list.appendChild(row);
    });

    if (selectedEl) {
      selectedEl.innerHTML = alchemySelectedReagents.length
        ? alchemySelectedReagents.map(k => `<span class="alch-selected-chip">${ALCHEMY_REAGENT_DEFS[k].icon} ${ALCHEMY_REAGENT_DEFS[k].label}</span>`).join('')
        : '<span class="alch-empty-hint">Select 2–3 reagents to test for a reaction.</span>';
    }
    if (previewEl) {
      const effects = computeBrewEffects(alchemySelectedReagents);
      if (alchemySelectedReagents.length < 2) {
        previewEl.innerHTML = '';
      } else if (!effects.length) {
        previewEl.innerHTML = '<div class="alch-empty-hint">No shared properties detected.</div>';
      } else {
        previewEl.innerHTML = effects.map(eff => {
          const known = alchemySelectedReagents.some(k => {
            const idx = ALCHEMY_REAGENT_DEFS[k].effects.indexOf(eff);
            return idx >= 0 && isReagentEffectKnown(k, idx);
          });
          const def = ALCHEMY_EFFECT_DEFS[eff];
          return known
            ? `<span class="alch-effect ${def.kind}">${def.icon} ${def.label}</span>`
            : `<span class="alch-effect unknown">❓ Unknown reaction</span>`;
        }).join('');
      }
    }
    const brewBtn = document.getElementById('alchemyBrewBtn');
    if (brewBtn) brewBtn.disabled = alchemySelectedReagents.length < 2;
  }

  window.AlchemySystem = {
    init,
    EFFECT_DEFS: ALCHEMY_EFFECT_DEFS,
    REAGENT_DEFS: ALCHEMY_REAGENT_DEFS,
    POTION_ITEMS: ALCHEMY_POTION_ITEMS,
    reagentsForZone,
    isReagentEffectKnown,
    discoverReagentEffect,
    discoveryCount,
    serializeKnownEffects,
    restoreKnownEffects,
    computeBrewEffects,
    potionKeyForEffects,
    getPotionEffectsFromKey,
    ensurePotionItemDef,
    drinkPotion,
    applyEffect,
    getSpeedMul,
    serializeActiveEffects,
    restoreActiveEffects,
    update,
    renderPanel,
  };
})();
