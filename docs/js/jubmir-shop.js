(() => {
  'use strict';

  // Jubmir the traveling trader — a daily egg plus one copy of each combat
  // manual, world-scoped (one shared stock record per day, like a real trader
  // visiting the whole village rather than per-character copies).
  // Extracted out of game.js following the same window.<Namespace> +
  // init(deps) pattern as its shop-panel siblings (js/bounty-board.js,
  // js/procedural-tasks.js). _tothalWorldId and _shopStock stay behind in
  // game.js on purpose — both are shared across every save-scoped shop and
  // loot-pool system, not owned by Jubmir alone — and come in through deps.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  function _loadJubmirStock() {
    const worldId = deps.tothalWorldId();
    if (!worldId) return null;
    try {
      const meta = JSON.parse(localStorage.getItem('hobunjiSaveMeta') || 'null');
      return (meta?.worlds || []).find(w => w.id === worldId)?.jubmirStock ?? null;
    } catch { return null; }
  }

  function _saveJubmirStock(stock) {
    const worldId = deps.tothalWorldId();
    if (!worldId) return;
    try {
      const meta = JSON.parse(localStorage.getItem('hobunjiSaveMeta') || 'null');
      const world = (meta?.worlds || []).find(w => w.id === worldId);
      if (!world) return;
      world.jubmirStock = stock;
      localStorage.setItem('hobunjiSaveMeta', JSON.stringify(meta));
    } catch {}
  }

  // The egg and every specific combat manual come from the same authored
  // Jubmir goods pool. The fallback only keeps the historical egg available
  // while shop-stock.json is still loading.
  function _jubmirGoods() {
    const goods = deps.getShopStock().jubmirWares?.goods; // Used as the authoritative visible stock list for this visit day.
    return Array.isArray(goods) && goods.length ? goods : [_jubmirEggEntry()];
  }
  function _jubmirEggEntry() {
    return (deps.getShopStock().jubmirWares?.goods || []).find(e => e.key === 'dabinggiHoundEgg') || {
      key: 'dabinggiHoundEgg', icon: '🥚', name: 'Dabinggi-hound Egg',
      desc: 'A rare, non-native find. One only, restocked daily.',
      price: 200, givesGenotype: 'dabinggi-hound', restockDays: 1, maxPerRestock: 1,
    };
  }

  // Returns today's stock, rolling a fresh egg genotype and resetting each
  // entry's purchase count on a new day. Legacy {genotype,purchased} saves
  // migrate without restoring an already-bought egg.
  function getJubmirStock() {
    let stock = _loadJubmirStock();
    if (!stock || stock.day !== deps.calendar.day) {
      stock = { day: deps.calendar.day, eggGenotype: window.CreatureGenetics.makeDefaultGenotype(_jubmirEggEntry().givesGenotype), purchasedByKey: {} };
      _saveJubmirStock(stock);
    } else if (!stock.purchasedByKey) {
      stock = { day: stock.day, eggGenotype: stock.eggGenotype || stock.genotype || window.CreatureGenetics.makeDefaultGenotype(_jubmirEggEntry().givesGenotype), purchasedByKey: stock.purchased ? { dabinggiHoundEgg: 1 } : {} };
      _saveJubmirStock(stock);
    }
    return stock;
  }

  function buyJubmirGood(entry) {
    const stock = getJubmirStock();
    const purchased = Number(stock.purchasedByKey[entry.key]) || 0; // Used to enforce this goods entry's authored daily stock cap.
    const maxPerRestock = Math.max(1, Number(entry.maxPerRestock) || 1); // Used as the maximum copies Jubmir carries today.
    if (purchased >= maxPerRestock) { deps.showToast("Jubmir's sold out of that for today.", false); return; }
    if (entry.abilityId && window.TechniqueScrolls?.isUnlocked?.(entry.abilityId)) { deps.showToast(`${entry.name}: you already know that technique.`, false); return; }
    const gold = deps.inventory.gold || 0;
    if (gold < entry.price) { deps.showToast('Not enough gananji.', false); return; }
    deps.inventory.gold = gold - entry.price;
    deps.inventory[entry.key] = Math.min(entry.givesGenotype ? 9 : 99, (deps.inventory[entry.key] || 0) + 1);
    if (entry.givesGenotype) window.FarmAnimals.queueItemGenotype(entry.key, stock.eggGenotype);
    stock.purchasedByKey[entry.key] = purchased + 1;
    _saveJubmirStock(stock);
    deps.showToast(`Bought ${entry.name} from Jubmir!`, true);
    renderJubmirShopPage();
    deps.buildInventoryGrid();
    deps.saveMemberWorldData();
  }

  function renderJubmirShopPage() {
    const goldEl = document.getElementById('jmGoldDisplay');
    if (goldEl) goldEl.innerHTML = `${deps.inventory.gold || 0}<span class="wallet-unit">g</span>`;
    const list = document.getElementById('jubmirShopList');
    if (!list) return;
    list.innerHTML = '';
    const stock = getJubmirStock();
    for (const entry of _jubmirGoods()) {
      if (!window.ConditionRegistry.entryEligible(entry, deps.lootShopWorldState())) continue;
      const purchased = Number(stock.purchasedByKey[entry.key]) || 0; // Used to render this entry's remaining daily stock.
      const soldOut = purchased >= Math.max(1, Number(entry.maxPerRestock) || 1); // Used to disable a depleted goods row.
      const learned = !!entry.abilityId && !!window.TechniqueScrolls?.isUnlocked?.(entry.abilityId); // Used to avoid selling a manual whose only purpose is already fulfilled.
      if (entry.abilityId) window.TechniqueScrolls?.ensureManualItemDef?.(entry.abilityId);
      const row = document.createElement('div');
      row.className = 'shop-row';
      row.innerHTML = `
        <div class="sh-icon">${entry.icon || '📦'}</div>
        <div class="sh-info">
          <div class="sh-name">${deps.esc(entry.name)}</div>
          <div class="sh-desc">${learned ? 'Already learned.' : soldOut ? 'Sold out — Jubmir will have another tomorrow.' : deps.esc(entry.desc || '')}</div>
          <div class="sh-price">${entry.price}g</div>
        </div>
        <button class="shop-buy-btn" ${soldOut || learned ? 'disabled' : ''}>${learned ? 'Learned' : soldOut ? 'Sold Out' : 'Buy'}</button>
      `;
      if (!soldOut && !learned) row.querySelector('button')?.addEventListener('click', () => buyJubmirGood(entry));
      list.appendChild(row);
    }
  }

  window.JubmirShop = {
    init,
    render: renderJubmirShopPage,
    getStock: getJubmirStock,
  };
})();
