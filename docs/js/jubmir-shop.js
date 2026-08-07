(() => {
  'use strict';

  // Jubmir the traveling trader — a single daily egg for sale, world-scoped
  // (one shared roll per day, same as a real trader visiting the whole
  // village rather than each character getting an independent copy).
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

  // Jubmir sells exactly one goods entry today (a dabinggi-hound egg),
  // sourced from docs/config/shops/shop-stock.json's jubmirWares.goods —
  // the hardcoded fallback matches that file's default entry in case the
  // config hasn't loaded yet. restockDays/maxPerRestock are only
  // implemented for the "1 per day" case today (see getJubmirStock's
  // day-reset check) — a future entry wanting a longer cycle or more than
  // one unit per restock would need that check generalized.
  function _jubmirEggEntry() {
    return (deps.getShopStock().jubmirWares?.goods || []).find(e => e.key === 'dabinggiHoundEgg') || {
      key: 'dabinggiHoundEgg', icon: '🥚', name: 'Dabinggi-hound Egg',
      desc: 'A rare, non-native find. One only, restocked daily.',
      price: 200, givesGenotype: 'dabinggi-hound', restockDays: 1, maxPerRestock: 1,
    };
  }

  // Returns today's stock, rolling a fresh dabinggi-hound egg genotype the
  // first time it's checked on a new day.
  function getJubmirStock() {
    let stock = _loadJubmirStock();
    if (!stock || stock.day !== deps.calendar.day) {
      stock = { day: deps.calendar.day, genotype: window.CreatureGenetics.makeDefaultGenotype(_jubmirEggEntry().givesGenotype), purchased: false };
      _saveJubmirStock(stock);
    }
    return stock;
  }

  function buyJubmirEgg() {
    const stock = getJubmirStock();
    const entry = _jubmirEggEntry();
    if (stock.purchased) { deps.showToast("Jubmir's sold out for today — check back tomorrow.", false); return; }
    const gold = deps.inventory.gold || 0;
    if (gold < entry.price) { deps.showToast('Not enough gold.', false); return; }
    deps.inventory.gold = gold - entry.price;
    deps.inventory.dabinggiHoundEgg = Math.min(9, (deps.inventory.dabinggiHoundEgg || 0) + 1);
    window.FarmAnimals.queueItemGenotype('dabinggiHoundEgg', stock.genotype);
    stock.purchased = true;
    _saveJubmirStock(stock);
    deps.showToast(`Bought a ${entry.name} from Jubmir!`, true);
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
    const entry = _jubmirEggEntry();
    if (!window.ConditionRegistry.entryEligible(entry, deps.lootShopWorldState())) return;
    const stock = getJubmirStock();
    const row = document.createElement('div');
    row.className = 'shop-row';
    row.innerHTML = `
      <div class="sh-icon">${entry.icon}</div>
      <div class="sh-info">
        <div class="sh-name">${deps.esc(entry.name)}</div>
        <div class="sh-desc">${stock.purchased ? "Sold out — Jubmir will have another tomorrow." : entry.desc}</div>
        <div class="sh-price">${entry.price}g</div>
      </div>
      <button class="shop-buy-btn" ${stock.purchased ? 'disabled' : ''}>${stock.purchased ? 'Sold Out' : 'Buy'}</button>
    `;
    if (!stock.purchased) row.querySelector('button')?.addEventListener('click', buyJubmirEgg);
    list.appendChild(row);
  }

  window.JubmirShop = {
    init,
    render: renderJubmirShopPage,
  };
})();
