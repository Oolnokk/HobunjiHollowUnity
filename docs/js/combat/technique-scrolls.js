// Technique Scrolls: Motes of Prowess source + unlock gate for slottable attacks.
(() => {
  'use strict';
  if (window.TechniqueScrolls) return;

  const CATS = ['quickAttack', 'defensiveHold', 'offensiveHold']; // Used to separate scroll-unlocked attacks from always-available weapon combos.
  const SCROLLS = {
    1: { key: 'techniqueScrollTier1', icon: '📜', label: 'Tier 1 Technique Scroll', desc: 'Grants 1 Mote of Prowess and may reveal a slottable technique.' },
    2: { key: 'techniqueScrollTier2', icon: '📜', label: 'Tier 2 Technique Scroll', desc: 'Grants 2 Motes of Prowess and has a better chance to reveal a slottable technique.' },
    3: { key: 'techniqueScrollTier3', icon: '📜', label: 'Tier 3 Technique Scroll', desc: 'Grants 3 Motes of Prowess and strongly favors offensive heavy techniques.' },
  }; // Used as canonical inventory metadata for the three scroll tiers.
  const SOURCE_WEIGHTS = {
    0: { 1: 80, 2: 18, 3: 2 },
    1: { 1: 60, 2: 32, 3: 8 },
    2: { 1: 35, 2: 45, 3: 20 },
    3: { 1: 18, 2: 42, 3: 40 },
  }; // Used to bias, but never determine, scroll tier from bandit/bounty tier.
  const UNLOCK_WEIGHTS = {
    1: { none: 45, quickAttack: 12, defensiveHold: 40, offensiveHold: 3 },
    2: { none: 25, quickAttack: 45, defensiveHold: 15, offensiveHold: 15 },
    3: { none: 10, quickAttack: 35, defensiveHold: 0, offensiveHold: 55 },
  }; // Used for each scroll tier's overall success chance and technique-family preference.

  let itemDeps = null; // Used for scroll inventory, selected-item actions, UI refreshes, and saves.
  let bountyDeps = null; // Used to detect the exact bounty transition that deserves a scroll reward.
  let unlocked = new Set(); // Used as the authoritative persisted set of learned slottable attacks.
  let rawList = null; // Used by scroll rolls to see locked registry entries after the public list is filtered.
  let lastEvent = null; // Used by mobile-friendly debug inspection.
  let decoratePending = false; // Used to coalesce loadout UI placeholder/status repairs after rerenders.

  function weightedPick(entries) {
    const list = entries.filter(e => Number(e.weight) > 0); // Used to remove unavailable/zero-weight outcomes before rolling.
    const total = list.reduce((sum, e) => sum + Number(e.weight), 0); // Used as the weighted roll ceiling.
    if (!total) return null;
    let roll = Math.random() * total; // Used to walk the weighted list without normalizing it first.
    for (const entry of list) { roll -= Number(entry.weight); if (roll <= 0) return entry.value; }
    return list.at(-1)?.value ?? null;
  }

  function rollScrollTier(sourceTier) {
    const tier = Math.max(0, Math.min(3, Math.floor(Number(sourceTier) || 0))); // Used to select the current 0-3 source difficulty row.
    return Number(weightedPick(Object.entries(SOURCE_WEIGHTS[tier]).map(([value, weight]) => ({ value: Number(value), weight })))) || 1;
  }

  function ability(id) { return window.Combat?.abilities?.get?.(id) || null; }
  function isTechnique(value) {
    const def = typeof value === 'string' ? ability(value) : value; // Used to accept either an ability id or registry definition.
    return !!def && CATS.includes(def.category);
  }
  function isUnlocked(id) {
    const def = ability(id); // Used to leave non-scroll combat abilities such as combos unaffected.
    return !!def && (!isTechnique(def) || unlocked.has(id));
  }
  function categoryTechniques(category) {
    return rawList ? rawList([category]).filter(isTechnique) : [];
  }
  function allTechniques() {
    const map = new Map(); // Used to deduplicate future techniques exposed through more than one category.
    CATS.forEach(cat => categoryTechniques(cat).forEach(def => map.set(def.id, def)));
    return [...map.values()];
  }

  function rollTechniqueUnlock(scrollTier) {
    const tier = Math.max(1, Math.min(3, Math.floor(Number(scrollTier) || 1))); // Used to select the requested scroll outcome row.
    const weights = UNLOCK_WEIGHTS[tier]; // Used to build the final weighted list after learned attacks are removed.
    const entries = [{ value: null, weight: weights.none }]; // Used as the explicit chance for a scroll to reveal no attack.
    CATS.forEach(category => {
      const candidates = categoryTechniques(category).filter(def => !unlocked.has(def.id)); // Used to remove already-learned attacks from the roll.
      if (!candidates.length || !weights[category]) return;
      const each = weights[category] / candidates.length; // Used to preserve the category's total probability regardless of candidate count.
      candidates.forEach(def => entries.push({ value: def.id, weight: each }));
    });
    return weightedPick(entries);
  }

  function saveUnlocks() {
    const value = [...unlocked].sort(); // Used for both the live profile and persistent character record.
    if (window.__hobunjiPlayerProfile) window.__hobunjiPlayerProfile.combatTechniqueUnlocks = value;
    try {
      const meta = JSON.parse(localStorage.getItem('hobunjiSaveMeta') || 'null'); // Used to follow combat-loadout/progression's current save path.
      const id = window.__hobunjiPlayerProfile?.characterId; // Used to target the currently loaded character only.
      const ch = (meta?.characters || []).find(entry => entry.id === id); // Used to store unlocks beside combatLoadout/abilityProgression.
      if (ch) { ch.combatTechniqueUnlocks = value; localStorage.setItem('hobunjiSaveMeta', JSON.stringify(meta)); }
    } catch (_) {}
  }
  function loadUnlocks(data) {
    const saved = Array.isArray(data?.combatTechniqueUnlocks) ? data.combatTechniqueUnlocks : []; // Used so old saves migrate to the new locked-by-default rules rather than being grandfathered.
    unlocked = new Set(saved.filter(id => typeof id === 'string' && id));
    queueDecorate();
  }
  function unlockAbility(id, source = 'Technique Scroll') {
    const def = ability(id); // Used to reject stale/non-slottable ids before they reach save data.
    if (!def || !isTechnique(def) || unlocked.has(id)) return false;
    unlocked.add(id); saveUnlocks();
    lastEvent = { type: 'unlock', id, label: def.label || id, source, at: Date.now() };
    window.__farmLog?.(`[techniques] Learned ${def.label || id} from ${source}.`, 'combat');
    window.dispatchEvent(new CustomEvent('hobunji-technique-unlocks-change', { detail: { abilityId: id, source } }));
    refreshLoadout();
    return true;
  }

  function patchLoadout() {
    const combat = window.Combat; // Used as the single registry/dispatch owner for technique gating.
    if (!combat?.abilities?.listForCategories || !combat?.loadout?.getSlot || combat.loadout.__techniqueScrollsPatched) return;
    rawList = combat.abilities.listForCategories.bind(combat.abilities);
    const getSlot = combat.loadout.getSlot.bind(combat.loadout); // Used to preserve the underlying per-weapon storage/default behavior before gating.
    const getLoadout = combat.loadout.get.bind(combat.loadout); // Used to preserve the loadout object shape while replacing gated slots.
    const setSlot = combat.loadout.setSlot.bind(combat.loadout); // Used after validating the requested technique is learned.
    const serialize = combat.loadout.serialize.bind(combat.loadout); // Used to distinguish explicit choices from legacy implicit default slots.
    combat.abilities.listForCategories = cats => rawList(cats).filter(def => !isTechnique(def) || unlocked.has(def.id));
    combat.loadout.getSlot = slot => {
      const id = getSlot(slot); // Used as the underlying stored/default candidate.
      if (slot === 'tap1') return id;
      const key = combat.deps?.currentWeaponKey?.() || 'none'; // Used to inspect this exact weapon's explicit persisted slot choices.
      if (!Object.prototype.hasOwnProperty.call(serialize()?.[key] || {}, slot)) return null;
      return isUnlocked(id) ? id : null;
    };
    combat.loadout.get = () => ({ ...getLoadout(), tap1: combat.loadout.getSlot('tap1'), tap2: combat.loadout.getSlot('tap2'), hold1: combat.loadout.getSlot('hold1'), hold2: combat.loadout.getSlot('hold2') });
    combat.loadout.setSlot = (slot, id) => slot !== 'tap1' && id && !isUnlocked(id) ? false : setSlot(slot, id);
    combat.loadout.isTechniqueUnlocked = isUnlocked;
    combat.loadout.getUnlockedTechniqueIds = () => [...unlocked].sort();
    combat.loadout.__techniqueScrollsPatched = true;
  }

  function registerItems(deps) {
    if (!deps?.ITEM_DEFS || !Array.isArray(deps.inventoryItems)) return;
    Object.entries(SCROLLS).forEach(([tierText, scroll]) => {
      const tier = Number(tierText); // Used to identify held scrolls directly from canonical item metadata.
      const old = deps.ITEM_DEFS[scroll.key] || {}; // Used to preserve future authored art/economy overrides.
      deps.ITEM_DEFS[scroll.key] = { ...old, icon: old.icon || scroll.icon, label: old.label || scroll.label, cat: old.cat || 'material', sellPrice: old.sellPrice ?? 0, tags: [...new Set([...(old.tags || []), 'Technique Scroll', 'Combat', 'Consumable'])], desc: old.desc || scroll.desc, techniqueScrollTier: tier };
      if (!deps.inventoryItems.some(entry => entry.key === scroll.key)) deps.inventoryItems.push({ key: scroll.key, icon: scroll.icon, label: scroll.label.toUpperCase(), max: 99 });
    });
    window.HobunjiInventoryActionMetadataBridge?.refresh?.();
  }
  function captureItemDeps(deps) {
    if (deps?.inventory) itemDeps = deps; // Used to retain the richest item-capable dependency bag seen during game initialization.
    registerItems(deps);
  }
  function heldScroll() {
    if (itemDeps?.getHeldMode?.() != null && itemDeps.getHeldMode() !== 'item') return null;
    const active = itemDeps?.getActiveInventoryItem?.(); // Used as the authoritative currently selected held inventory entry.
    const tier = Number(active?.techniqueScrollTier || itemDeps?.ITEM_DEFS?.[active?.key]?.techniqueScrollTier) || 0; // Used to recognize registered scrolls after inventory metadata enrichment.
    if (tier < 1 || tier > 3 || !(Number(itemDeps?.inventory?.[active?.key]) > 0)) return null;
    return { key: active.key, tier, def: itemDeps.ITEM_DEFS?.[active.key] || active };
  }
  function refreshInventory() {
    itemDeps?.refreshItemScroll?.(); itemDeps?.buildInventoryGrid?.(); itemDeps?.refreshActionBar?.(); itemDeps?.saveMemberWorldData?.();
  }
  function grantScroll(tier, source = 'Reward') {
    const safe = Math.max(1, Math.min(3, Math.floor(Number(tier) || 1))); // Used to normalize all grants to one canonical tier.
    const scroll = SCROLLS[safe]; // Used to resolve the inventory stack receiving the reward.
    if (!itemDeps?.inventory) return null;
    itemDeps.inventory[scroll.key] = Math.min(99, (Number(itemDeps.inventory[scroll.key]) || 0) + 1);
    itemDeps.clampInventoryStack?.(scroll.key); refreshInventory();
    lastEvent = { type: 'grant', tier: safe, source, at: Date.now() };
    window.__farmLog?.(`[techniques] ${source}: Tier ${safe} Technique Scroll.`, 'combat');
    return safe;
  }
  function consumeScroll() {
    const held = heldScroll(); // Used to validate the selected stack again at the moment Item Action fires.
    const awardMotes = window.Combat?.deps?.awardMotesOfProwess; // Used as the existing canonical Motes mutation/persistence path.
    if (!held || typeof awardMotes !== 'function') return false;
    itemDeps.inventory[held.key] = Math.max(0, Number(itemDeps.inventory[held.key]) - 1); itemDeps.clampInventoryStack?.(held.key);
    awardMotes(held.tier);
    const learnedId = rollTechniqueUnlock(held.tier); // Used only after already-learned attacks have been removed from the weighted list.
    const learnedDef = learnedId ? ability(learnedId) : null; // Used for player-facing reward text.
    if (learnedId) unlockAbility(learnedId, held.def.label || `Tier ${held.tier} Technique Scroll`);
    const moteText = `+${held.tier}◆ Mote${held.tier === 1 ? '' : 's'} of Prowess`;
    itemDeps.showToast?.(`${held.def.icon || '📜'} ${held.def.label}: ${moteText}. ${learnedDef ? `Learned ${learnedDef.label || learnedId}!` : 'No new technique was revealed.'}`, true);
    refreshInventory();
    lastEvent = { type: 'consume', tier: held.tier, motes: held.tier, learnedId: learnedId || null, at: Date.now() };
    return true;
  }

  function patchHeldActions(api) {
    if (!api?.getHeldItemAction || !api?.consumeHeldItem || api.__techniqueScrollsPatched) return;
    const getAction = api.getHeldItemAction.bind(api); // Used for every ordinary food/drink item after scroll detection gets first refusal.
    const consume = api.consumeHeldItem.bind(api); // Used for every ordinary food/drink consumption after scroll detection gets first refusal.
    api.getHeldItemAction = () => {
      const held = heldScroll(); // Used to expose scroll reading through the already-configurable Item Action 1 path.
      return held ? { icon: held.def.icon || '📜', label: `Read ${held.def.label}`, action: 'consume_held_item', style: 'primary', allowed: true } : getAction();
    };
    api.consumeHeldItem = () => heldScroll() ? consumeScroll() : consume();
    api.__techniqueScrollsPatched = true;
  }

  function patchCaptains(api) {
    if (!api?.makeCorpseWorldObject || api.__techniqueScrollsPatched) return;
    const make = api.makeCorpseWorldObject.bind(api); // Used to preserve normal corpse loot/clothing before adding a captain scroll.
    api.makeCorpseWorldObject = c => {
      const corpse = make(c); // Used as the canonical corpse interaction object to extend.
      if (!corpse?.onAction || c?.banditRank !== 'captain') return corpse;
      const act = corpse.onAction.bind(corpse); // Used to award only after the normal loot action succeeds.
      let paid = false; // Used to prevent duplicate scroll grants if the corpse action is replayed before despawn finishes.
      corpse.onAction = action => {
        const finish = result => {
          if (action !== 'obj_loot_corpse' || !result?.ok || paid) return result;
          const tier = grantScroll(rollScrollTier(c.banditTier), `${c.name || 'Bandit Captain'} loot`); // Used to bias the drop by actual captain difficulty tier.
          if (!tier) return result;
          paid = true;
          return { ...result, message: `${result.message || 'Looted the Bandit Captain.'} 📜 Tier ${tier} Technique Scroll×1` };
        };
        const result = act(action); // Used to remain safe if corpse actions become async later.
        return result?.then ? result.then(finish) : finish(result);
      };
      return corpse;
    };
    api.__techniqueScrollsPatched = true;
  }

  function patchBounties(api) {
    if (!api?.init || !api?.updateTracking || api.__techniqueScrollsPatched) return;
    const init = api.init.bind(api); // Used to capture bounty/inventory dependencies before normal bounty setup.
    const update = api.updateTracking.bind(api); // Used to detect one-time available-to-completed transitions after canonical gold payment.
    api.init = deps => { bountyDeps = deps; captureItemDeps(deps); return init(deps); };
    api.updateTracking = dt => {
      const before = new Map(); // Used to retain tier/name because completion clears/replaces bounty progress.
      Object.entries(bountyDeps?.getQuestProgress?.() || {}).forEach(([id, state]) => { if (state?.status === 'available' && state?.progress?.kind === 'bounty') before.set(id, { ...state.progress }); });
      const result = update(dt);
      const after = bountyDeps?.getQuestProgress?.() || {}; // Used to isolate bounties that completed on this exact tracking call.
      before.forEach((bounty, id) => {
        if (after[id]?.status !== 'completed') return;
        const tier = grantScroll(rollScrollTier(bounty.tier), `Bounty reward: ${bounty.captainName || 'Bandit Captain'}`); // Used to share the same source-tier bias rule as captain loot.
        if (tier) bountyDeps?.showToast?.(`📜 Bounty reward: Tier ${tier} Technique Scroll.`, true);
      });
      return result;
    };
    api.__techniqueScrollsPatched = true;
  }

  function futureGlobal(name, patch) {
    if (window[name]) { patch(window[name]); return; }
    const d = Object.getOwnPropertyDescriptor(window, name); // Used to preserve compatibility setters already installed by other runtime bridges.
    if (d && !d.configurable) return;
    const prevGet = d?.get, prevSet = d?.set; // Used to chain prior lazy-global behavior instead of replacing it.
    let value = d?.value; // Used only when no previous accessor owns storage.
    Object.defineProperty(window, name, { configurable: true, enumerable: d?.enumerable ?? true,
      get() { return prevGet ? prevGet.call(window) : value; },
      set(next) { if (prevSet) prevSet.call(window, next); else value = next; patch(prevGet ? prevGet.call(window) : (prevSet ? next : value)); },
    });
  }
  function hookItemInit(name) {
    futureGlobal(name, api => {
      if (!api?.init || api.__techniqueScrollItemHooked) return;
      const init = api.init.bind(api); // Used to preserve the owning system's init while capturing its item-capable dependency bag.
      api.init = (deps, ...rest) => { const result = init(deps, ...rest); captureItemDeps(deps); return result; };
      api.__techniqueScrollItemHooked = true;
    });
  }

  function refreshLoadout() {
    const tab = document.querySelector('.mp-tab[data-mpanel="loadout"]'); // Used to reuse combat-loadout-ui's own renderer after an unlock.
    if (tab && document.getElementById('combatLoadoutPane')) tab.dispatchEvent(new Event('click', { bubbles: true }));
    queueDecorate();
  }
  function queueDecorate() {
    if (decoratePending) return;
    decoratePending = true;
    requestAnimationFrame(() => { decoratePending = false; decorateLoadout(); });
  }
  function decorateLoadout() {
    const pane = document.getElementById('combatLoadoutPane'); // Used for visible learned-count guidance, empty-slot clarity, and mobile dev grants.
    if (!pane) return;
    const all = allTechniques(); // Used to calculate visible learned/total progression.
    let status = pane.querySelector('[data-technique-scroll-status]'); // Used to avoid duplicate status blocks across pane rerenders.
    if (!status) { status = document.createElement('div'); status.dataset.techniqueScrollStatus = '1'; status.className = 'loadout-slot-combo-note'; status.style.marginBottom = '8px'; pane.insertBefore(status, pane.querySelector('.loadout-slot') || null); }
    status.textContent = `${all.filter(def => unlocked.has(def.id)).length}/${all.length} slottable techniques learned · Technique Scrolls grant Motes of Prowess and may reveal new attacks.`;
    ['tap2', 'hold1', 'hold2'].forEach(slot => {
      const select = document.getElementById(`combatLoadout_${slot}`); // Used to stop the browser visually auto-selecting an unlocked attack while the actual slot is still empty.
      if (!select || window.Combat.loadout.getSlot(slot)) return;
      let option = [...select.options].find(o => o.dataset?.techniquePlaceholder);
      if (!option) { option = document.createElement('option'); option.value = ''; option.textContent = 'No technique equipped'; option.disabled = true; option.dataset.techniquePlaceholder = '1'; select.prepend(option); }
      option.selected = true;
    });
    if (window.Combat?.deps?.isDevMode?.() && !pane.querySelector('[data-technique-scroll-dev]')) {
      const row = document.createElement('div'); // Used to grant exact scroll tiers from the in-game menu on mobile without DevTools.
      row.dataset.techniqueScrollDev = '1'; row.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px';
      [1, 2, 3].forEach(tier => { const b = document.createElement('button'); b.type = 'button'; b.className = 'ii-btn'; b.textContent = `[Dev] +T${tier} Scroll`; b.addEventListener('click', () => grantScroll(tier, 'Dev loadout test')); row.appendChild(b); });
      status.after(row);
    }
  }

  patchLoadout(); patchCaptains(window.BanditCamps); patchBounties(window.BountyBoard);
  futureGlobal('HobunjiDrunkGameplayBridge', patchHeldActions);
  hookItemInit('CookingSystem'); hookItemInit('FarmCrates');
  document.addEventListener('hobunjiPlayerReady', e => loadUnlocks(e.detail));
  if (window.__hobunjiPlayerProfile) loadUnlocks(window.__hobunjiPlayerProfile);
  document.addEventListener('DOMContentLoaded', () => {
    const root = document.getElementById('combatLoadoutPane') || document.body; // Used as the narrowest stable DOM root for loadout rerender observation.
    if (root) new MutationObserver(queueDecorate).observe(root, { childList: true, subtree: true });
    queueDecorate();
  }, { once: true });

  window.TechniqueScrolls = {
    SCROLLS, SOURCE_WEIGHTS, UNLOCK_WEIGHTS, isUnlocked, unlockAbility, rollScrollTier, rollTechniqueUnlock, grantScroll, consumeScroll, consumeTechniqueScroll: consumeScroll,
    getUnlockedTechniqueIds: () => [...unlocked].sort(),
    getDebug() {
      const all = allTechniques(); // Used to expose learned/locked state and scroll inventory through existing mobile debug inspection.
      return { ready: !!itemDeps, unlocked: [...unlocked].sort(), locked: all.filter(def => !unlocked.has(def.id)).map(def => ({ id: def.id, label: def.label, category: def.category })), scrollCounts: Object.fromEntries(Object.entries(SCROLLS).map(([tier, s]) => [tier, Number(itemDeps?.inventory?.[s.key]) || 0])), lastEvent: lastEvent && { ...lastEvent } };
    },
    devGrantScroll(tier) { return window.Combat?.deps?.isDevMode?.() ? !!grantScroll(tier, 'Dev debug') : false; },
  };
})();
