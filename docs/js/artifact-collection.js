// World-owned museum progress. Inventory and enchanting remain with their existing owners.
(() => {
  'use strict';
  const LOOT_TUNING = Object.freeze({ // Single authority for chest quantity and rarity-derived prices.
    commonWeight: 35,
    commonSellPrice: 100,
    priceStep: 10,
    countsByTier: Object.freeze([
      Object.freeze({ min: 1, max: 3 }), Object.freeze({ min: 1, max: 4 }),
      Object.freeze({ min: 2, max: 5 }), Object.freeze({ min: 2, max: 6 }),
    ]),
  });
  function artifact(label, icon, tier, weight) {
    // Inverse-square-root pricing rewards rarity without making the rarest duplicate disproportionately lucrative.
    const sellPrice = Math.round(LOOT_TUNING.commonSellPrice * Math.sqrt(LOOT_TUNING.commonWeight / weight) / LOOT_TUNING.priceStep) * LOOT_TUNING.priceStep; // Used by the ordinary inventory/shipping sale paths.
    return Object.freeze({ label, icon, tier, weight, sellPrice });
  }
  const ARTIFACTS = Object.freeze({ // Weights sum to 100 once all artifacts are eligible; coins account for 78% of individual draws.
    harlyaoCopperCoin: artifact('Harlyao Copper Coin', '🪙', 1, LOOT_TUNING.commonWeight),
    harlyaoTinCoin: artifact('Harlyao Tin Coin', '🪙', 1, 25),
    harlyaoBronzeCoin: artifact('Harlyao Bronze Coin', '🪙', 2, 18),
    harlyaoAncestorStatue: artifact('Harlyao Ancestor Statue', '🗿', 2, 6),
    harlyaoSpikyBirdStatue: artifact('Spiky Bird Statue', '🐦', 3, 4),
    harlyaoOddFishApeStatue: artifact('Odd Fish-Ape Statue', '🐟', 3, 3),
    harlyaoSkeletalBeastStatue: artifact('Skeletal Beast Statue', '🦴', 4, 1),
    harlyaoGoblet: artifact('Harlyao Goblet', '🏆', 2, 8),
  });
  const UNLOCKS = Object.freeze([ // Collection milestones used by both dialogue and service guards.
    { id: 'unbind', count: 1, label: 'Weapon unbinding', text: 'Our first artifact! This gives me a reference for the old Harlyao binding rites. Bring me a bound weapon and I can release its dead owner’s claim for a fee. The weapon keeps its enchantments, and studying it teaches me how they work.' },
    { id: 'remove', count: 2, label: 'Enchantment removal', text: 'Two distinct pieces, and a useful discovery: these bindings can be unwoven separately. I can now remove a Base enchantment or a Flourish from a weapon for a small fee. Removing one leaves the other enchantments intact.' },
    { id: 'base', count: 4, label: 'Base enchanting', text: 'Four artifacts! The recurring inscriptions finally make sense. There is a private and rather serious matter we must discuss before I can offer you the ability to enchant new weapons.' },
    { id: 'flourish', count: 6, label: 'Flourish enchanting', text: 'Six artifacts reveal something more subtle: a binding can answer a particular combat action. I can now apply learned Flourishes to your weapons’ action slots. Each slot holds one Flourish, and I must have studied that enchantment in that particular slot on a relic first.' },
  ]);
  let deps = null; // Injected inventory/save/UI dependencies, never used per frame.
  let state = { donated: [], pendingUnlocks: [] }; // Cached progress for the active world only.
  let worldId = null; // Prevents progress leaking when changing worlds without reloading.
  const displays = new Set(); // Live pedestal furniture instances refreshed only on donation/load.

  function clean(raw) {
    const donated = [...new Set((Array.isArray(raw?.donated) ? raw.donated : []).filter(key => Object.hasOwn(ARTIFACTS, key)))]; // Donation order also determines the three latest displays.
    return { donated, pendingUnlocks: [...new Set((Array.isArray(raw?.pendingUnlocks) ? raw.pendingUnlocks : []).filter(id => UNLOCKS.some(u => u.id === id && donated.length >= u.count)))] };
  }
  function syncWorld(refresh = false) {
    const id = deps?.tothalWorldId?.() || null; // Read only at collection interactions/diagnostic requests.
    if (refresh || id !== worldId) {
      worldId = id;
      state = clean(window.WorldMetaStore?.loadArtifactCollection?.(id));
    }
    return state;
  }
  function value() { return syncWorld().donated.length; }
  function unlocked(id) { return UNLOCKS.some(u => u.id === id && value() >= u.count); }
  function init(injected) {
    deps = injected;
    worldId = null;
    state = { donated: [], pendingUnlocks: [] };
    for (const [key, def] of Object.entries(ARTIFACTS)) {
      deps.ITEM_DEFS[key] = { ...def, cat: 'material', tags: ['Harlyao', 'Artifact'], artifact: true, desc: 'An artifact from a Harlyao ruin. Donate one to Garanki Gabu’s collection; valuable duplicates can be sold.' };
      if (!deps.inventoryItems.some(item => item.key === key)) deps.inventoryItems.push({ key, icon: def.icon, label: def.label.toUpperCase(), max: 999 });
    }
    syncWorld();
    window.DelversGuild?.bindInventoryDeps?.(injected); // Reuses these authoritative inventory and save adapters for the Stone and key-stones.
    window.DialogueContent?.registerTreeProvider?.('garanki_gabu', () => window.DelversGuild?.dialogueTree?.() || unlockDialogue());
    window.DialogueContent?.registerNodeEnterHandler?.('garanki_gabu', node => {
      if (node?.id === 'artifact_explanation') acknowledgeUnlocks();
      window.DelversGuild?.onDialogueNode?.(node); // End-node handoff launches the private tent cutscenes after dialogue closes.
    });
  }
  function donate(key) {
    syncWorld(true);
    if (!Object.hasOwn(ARTIFACTS, key)) return { ok: false, reason: 'artifact' };
    if (state.donated.includes(key)) return { ok: false, reason: 'duplicate' };
    if (!Number.isFinite(deps?.inventory?.[key]) || deps.inventory[key] < 1) return { ok: false, reason: 'not-owned' };
    const next = clean({ donated: [...state.donated, key], pendingUnlocks: state.pendingUnlocks }); // Persist progress before consuming inventory; a failed write costs nothing.
    const newlyUnlocked = UNLOCKS.filter(u => state.donated.length < u.count && next.donated.length >= u.count);
    next.pendingUnlocks.push(...newlyUnlocked.map(u => u.id));
    if (!window.WorldMetaStore?.saveArtifactCollection?.(worldId, next)) {
      deps.showToast?.('The collection could not be saved. Your artifact has been kept.', false);
      return { ok: false, reason: 'save' };
    }
    state = next;
    deps.inventory[key] -= 1;
    deps.saveMemberWorldData?.();
    deps.buildInventoryGrid?.();
    refreshDisplays();
    deps.showToast?.(`Donated ${ARTIFACTS[key].label}. Artifact Collection: ${value()}${newlyUnlocked.length ? ' · ' + newlyUnlocked.map(u => u.label).join(', ') + ' unlocked!' : ''}`, true);
    window.HarlyaoRelics?.render?.();
    if (newlyUnlocked.some(entry => entry.id === 'base') && !window.DelversGuild?.canEnchant?.()) {
      deps.showToast?.('Garanki wishes to discuss a private matter in his tent. Visit him to learn more.', true); // Enchanting consent now belongs to the trust cutscene.
    } else if (newlyUnlocked.length) {
      window.DialogueContent?.queueConversationTree?.('garanki_gabu', unlockDialogue());
      deps.showUnlockDialogue?.();
    }
    return { ok: true, value: value(), unlocked: newlyUnlocked.map(u => u.id) };
  }
  function unlockDialogue() {
    syncWorld(true);
    const pending = UNLOCKS.filter(u => state.pendingUnlocks.includes(u.id)); // Several milestones can be explained together after recovery/import.
    if (!pending.length) return null;
    return { id: 'artifact_unlock_' + pending.map(u => u.id).join('_'), trigger: 'interact', priority: 100,
      entryNode: 'artifact_explanation', nodes: [{ id: 'artifact_explanation', type: 'text', text: pending.map(u => u.text).join('\n\n'), next: 'artifact_services' },
        { id: 'artifact_services', type: 'choice', choices: [{ label: 'Artifacts & Enchanting', actions: [{ type: 'openShop', pool: 'garankiEnchanting' }] }, { label: 'Thank you', next: null }] }] };
  }
  function acknowledgeUnlocks() {
    syncWorld();
    if (!state.pendingUnlocks.length) return;
    const next = { ...state, pendingUnlocks: [] }; // Mark heard only when the explanation actually enters the dialogue box.
    if (window.WorldMetaStore?.saveArtifactCollection?.(worldId, next)) state = next;
  }
  function rollArtifacts(tier = 1) {
    const safeTier = Math.max(1, Math.min(4, Math.round(Number(tier) || 1))); // Malformed tier inputs cannot produce an empty pool or an unbounded chest.
    const eligible = Object.entries(ARTIFACTS).filter(([, def]) => def.tier <= safeTier); // Better chests broaden the artifact pool.
    const totalWeight = eligible.reduce((sum, [, def]) => sum + def.weight, 0); // Renormalizes weights across the artifacts available at this tier.
    const range = LOOT_TUNING.countsByTier[safeTier - 1]; // Higher-tier chests may award larger batches.
    const random = () => {
      const value = Number(window.GameRandom?.random?.() ?? Math.random()); // Uses seeded loot randomness, constrained to a valid half-open interval.
      return Number.isFinite(value) ? Math.max(0, Math.min(1 - Number.EPSILON, value)) : 0;
    };
    const count = range.min + Math.floor(random() * (range.max - range.min + 1)); // Always at least one guaranteed reward.
    const gained = {}; // Independent rolls can yield different artifacts or multiple copies in the same stack.
    for (let index = 0; index < count; index++) {
      let roll = random() * totalWeight; // Weighted draw with replacement, so coins remain abundant even in larger batches.
      let selected = eligible[eligible.length - 1][0]; // Floating-point boundary fallback always grants a valid artifact.
      for (const [key, def] of eligible) {
        roll -= def.weight;
        if (roll < 0) { selected = key; break; }
      }
      gained[selected] = (gained[selected] || 0) + 1;
    }
    return gained;
  }
  function render(list, ui) {
    syncWorld(true);
    list.appendChild(ui.heading(`Artifact Collection · ${value()} / ${Object.keys(ARTIFACTS).length}`));
    list.appendChild(ui.note('Garanki accepts one of each artifact. Duplicates remain yours to sell. The three most recent donations are displayed at camp.'));
    for (const [key, def] of Object.entries(ARTIFACTS)) {
      const donated = state.donated.includes(key), qty = Number(deps?.inventory?.[key]) || 0; // Display quantity never assumes an inventory key exists.
      list.appendChild(ui.row(def.icon, def.label, `${donated ? 'Collected' : 'Not collected'} · Owned: ${qty} · Sell: ${def.sellPrice}g`, [ui.button(donated ? 'Collected' : 'Donate 1', () => donate(key), donated || qty < 1)]));
    }
    list.appendChild(ui.note(UNLOCKS.map(u => `${unlocked(u.id) ? '✓' : '🔒'} ${u.count}: ${u.label}`).join(' · ')));
    const details = document.createElement('details'); // Mobile-readable diagnostics need no console or developer mode.
    const summary = document.createElement('summary'); // Collapsed by default to keep the donation flow compact.
    summary.textContent = 'Collection diagnostics';
    const report = document.createElement('pre'); // Includes the most recent change and active-world progress.
    report.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px';
    report.textContent = JSON.stringify(debugSnapshot(), null, 2);
    details.append(summary, report); list.appendChild(details);
  }
  function refreshDisplays() {
    const recent = syncWorld(true).donated.slice(-3).reverse(); // Slot 0 shows the newest donation, followed by the previous two.
    for (const entry of displays) {
      if (!entry.group.parent) { displays.delete(entry); continue; }
      const key = recent[entry.slot];
      window.AuthoredFurniture?.setItemPlacements?.(entry.group, entry.data, key ? [{ ...entry.data.itemPlacements[0], itemKey: key, itemName: ARTIFACTS[key].label, icon: ARTIFACTS[key].icon }] : []);
    }
  }
  function attachDisplay(group, slot) {
    window.AuthoredFurniture?.load?.('artifactPedestal').then(data => {
      if (!data || !group.parent) return;
      displays.add({ group, slot, data });
      // Async fallback upgrades keep the outer furniture group stable; its meshes can live one level down.
      refreshDisplays();
    });
  }
  function debugSnapshot() { syncWorld(true); return { latestChange: 'Ruin chests award weighted batches of artifacts; coins are most common, and rarer finds sell for more.', worldId, ...syncWorld(), value: value(), unlocks: UNLOCKS.map(u => ({ id: u.id, count: u.count, unlocked: unlocked(u.id) })), displays: displays.size }; }
  window.ArtifactCollection = Object.freeze({ ARTIFACTS, LOOT_TUNING, UNLOCKS, init, value, unlocked, donate, rollArtifacts, render, attachDisplay, refreshDisplays, acknowledgeUnlocks, debugSnapshot });
})();
