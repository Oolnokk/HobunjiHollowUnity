(() => {
  'use strict';

  // Shared reversible livestock sale ledger. A sale remains on its original
  // world livestock record until the Shipping Box's next eligible collection:
  // cancellation therefore preserves identity, genetics, housing, and pairs.
  // FarmCrates owns the cutoff clock; no second timer or save format is needed.
  let deps = null; // FarmPanel.injectedDeps supplies the authoritative farm roster, wallet and save methods.
  let settling = false; // Prevents a nested shipping/Farm render from paying out a sale twice.
  let lastAction = 'No animal sales queued this session.'; // Shown in the mobile-accessible debug snapshot.

  const today = () => Math.max(1, Math.floor(Number(deps?.calendar?.day) || 1));

  function pendingFor(entry) {
    const sale = entry?.pendingAnimalSale;
    if (!sale || !Number.isSafeInteger(sale.price) || sale.price < 1
        || !Number.isSafeInteger(sale.eligibleDay) || sale.eligibleDay < 1) return null;
    return sale;
  }

  function list() {
    const records = deps?._loadWorldLivestock?.();
    return Array.isArray(records) ? records : null;
  }

  function queue(id, amount) {
    if (!deps?.hasFarmPermission?.('livestock')) return { ok: false, message: 'Livestock permission required.' };
    const records = list();
    if (!records) return { ok: false, message: 'Farm livestock is unavailable.' };
    const entry = records.find(animal => String(animal.id) === String(id));
    if (!entry) return { ok: false, message: 'That animal is no longer on the farm.' };
    if (entry.forSale) return { ok: false, message: 'Cancel the existing farmhand offer before shipping this animal.' };
    if (pendingFor(entry)) return { ok: false, message: 'That animal is already awaiting collection.' };
    const price = Number(amount);
    if (!Number.isSafeInteger(price) || price < 1) return { ok: false, message: 'Invalid animal sale price.' };

    entry.pendingAnimalSale = { price, queuedDay: today(), eligibleDay: today() + 1 }; // Both roster and Nursery read this single persistent marker.
    if (deps._saveWorldLivestock(records) === false) return { ok: false, message: 'Could not save the pending animal sale.' };
    lastAction = 'Queued ' + (entry.name || entry.kind) + ' (' + entry.id + ') for ' + price + 'g.';
    return { ok: true, amount: price, entry, message: (entry.name || 'Animal') + ' queued for ' + price + 'g. Cancel from the Farm/Nursery before collection.' };
  }

  function cancel(id) {
    if (!deps?.hasFarmPermission?.('livestock')) return { ok: false, message: 'Livestock permission required.' };
    const records = list();
    if (!records) return { ok: false, message: 'Farm livestock is unavailable.' };
    const entry = records.find(animal => String(animal.id) === String(id));
    if (!pendingFor(entry)) return { ok: false, message: 'That animal is not awaiting sale.' };
    const original = entry.pendingAnimalSale; // Roll back the in-memory change if persistence rejects the cancellation.
    delete entry.pendingAnimalSale;
    if (deps._saveWorldLivestock(records) === false) {
      entry.pendingAnimalSale = original;
      return { ok: false, message: 'Could not cancel the pending animal sale.' };
    }
    lastAction = 'Cancelled sale of ' + (entry.name || entry.kind) + ' (' + entry.id + ').';
    return { ok: true, entry, message: (entry.name || 'Animal') + ' kept on the farm. Sale cancelled.' };
  }

  function settle(reason = 'shipping collection') {
    if (settling || !deps?.inventory || typeof deps.saveMemberWorldData !== 'function') return { sold: 0, earned: 0 };
    const records = list();
    if (!records) return { sold: 0, earned: 0 };
    const eligible = records.filter(entry => {
      const sale = pendingFor(entry);
      return sale && sale.eligibleDay <= today();
    }); // Sales made after midnight cannot settle alongside the previous shipment.
    if (!eligible.length) return { sold: 0, earned: 0 };
    settling = true;
    try {
      let sold = 0;
      let earned = 0;
      const names = [];
      for (const entry of eligible) {
        // Reuse the established cleanup: persisted roster, breeding references,
        // farm collision/world object and animal mesh must all leave together.
        const removed = window.FarmPanel?.removeLivestockAndCleanup?.(entry.id);
        if (!removed) continue;
        const sale = pendingFor(removed);
        if (!sale) continue;
        earned += sale.price;
        sold++;
        names.push(removed.name || removed.kind);
      }
      if (!sold) return { sold: 0, earned: 0 };
      deps.inventory.gold = (Number(deps.inventory.gold) || 0) + earned;
      const log = deps.getDeliveryLog?.();
      if (Array.isArray(log)) {
        log.unshift({ type: 'sale', text: 'Day ' + today() + ' animal collection — ' + names.join(', ') + ' = ' + earned + 'g (' + reason + ')' });
        log.length = Math.min(log.length, 60);
      }
      deps.saveMemberWorldData();
      const amount = deps.spGold?.querySelector?.('#spGoldAmount');
      if (amount) amount.textContent = deps.inventory.gold; // Refresh gold without removing the icon/suffix.
      window.LivestockNursery?.rerollSwarm?.();
      window.FarmPanel?.render?.();
      deps.showToast?.('🐾 Animal sale collected: +' + earned + 'g', true);
      lastAction = 'Collected ' + sold + ' animals for ' + earned + 'g (' + reason + ').';
      return { sold, earned };
    } finally {
      settling = false;
    }
  }

  function debugSnapshot() {
    return {
      lastAction,
      day: today(),
      pending: (list() || []).filter(entry => pendingFor(entry)).map(entry => ({
        id: entry.id, name: entry.name, kind: entry.kind, stage: entry.lifeStage,
        price: entry.pendingAnimalSale.price, eligibleDay: entry.pendingAnimalSale.eligibleDay,
      })),
    };
  }

  window.PendingAnimalSales = { init: injected => { deps = injected; }, pendingFor, queue, cancel, settle, debugSnapshot };
})();