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
  const worldId = () => deps?._tothalWorldId?.() || null; // Matches FarmPanel's world-scoped livestock and owner-wallet persistence.
  const characterId = () => window.FarmAnimals?.currentCharacterId?.()
    || (window.__hobunjiPlayerProfile || deps?.getPlayerData?.())?.characterId || null; // Seller identity follows the member who queued the sale.

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
    const sellerCharacterId = characterId(); // Ensures a later farmhand's collection never steals this seller's payment.
    if (!sellerCharacterId || !worldId() || !window.WorldMetaStore?.completeAnimalSales) {
      return { ok: false, message: 'World or character save is not ready for livestock sales.' };
    }

    const original = entry.pendingAnimalSale; // Restored if the world write rejects this queue change.
    entry.pendingAnimalSale = { price, queuedDay: today(), eligibleDay: today() + 1, sellerCharacterId }; // Both roster and Nursery read this single persistent marker.
    try {
      if (deps._saveWorldLivestock(records) === false) throw new Error('Livestock save rejected.');
    } catch (_) {
      if (original === undefined) delete entry.pendingAnimalSale;
      else entry.pendingAnimalSale = original;
      return { ok: false, message: 'Could not save the pending animal sale.' };
    }
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
    try {
      if (deps._saveWorldLivestock(records) === false) throw new Error('Livestock save rejected.');
    } catch (_) {
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

    const activeCharacterId = characterId(); // Used by WorldMetaStore to reconcile the active in-memory wallet with its saved member.
    const activeWorldId = worldId(); // Never collect animals belonging to a different world after character switches.
    const walletGold = Number(deps.inventory.gold || 0); // Current unsaved wallet, flushed before the atomic sale transaction.
    if (!activeCharacterId || !activeWorldId || !Number.isSafeInteger(walletGold) || walletGold < 0) {
      lastAction = 'Animal sale collection deferred: member or wallet is unavailable.';
      return { sold: 0, earned: 0 };
    }

    settling = true;
    let committed = null; // Exposes a successful atomic payment even if a later UI/receipt refresh fails.
    try {
      // Flush other gameplay inventory changes BEFORE the transactional write.
      // Removing animals first, then persisting payment, previously introduced a
      // crash window in which the original animal was gone and no gold was paid.
      if (deps.saveMemberWorldData() === false) {
        lastAction = 'Animal sale collection deferred: member save failed.';
        return { sold: 0, earned: 0 };
      }
      const commit = window.WorldMetaStore?.completeAnimalSales?.(
        activeWorldId, activeCharacterId, walletGold, today(), eligible.map(entry => entry.id)
      ); // The persisted roster, pair references and seller wallets commit in one localStorage write.
      if (!commit?.ok) {
        lastAction = 'Animal sale collection deferred: ' + (commit?.error || 'world settlement unavailable');
        return { sold: 0, earned: 0 };
      }
      if (!commit.sold.length) return { sold: 0, earned: 0 };
      committed = { sold: commit.sold.length, earned: commit.earned }; // The world write is already durable; never retry paid sales after UI exceptions.

      deps.inventory.gold = commit.currentGold; // Synchronizes only the active member; offline sellers were credited directly in the world save.
      window.FarmPanel?.onAnimalSalesCollected?.(commit.sold.map(animal => animal.id)); // Release the sold world meshes without rewriting the already-committed roster.
      window.FarmAnimals?.invalidateBreedingFollowCache?.(); // Breeding parents now reflect the atomically filtered world pair list.

      const names = commit.sold.map(entry => entry.name || entry.kind);
      const log = deps.getDeliveryLog?.();
      if (Array.isArray(log)) {
        log.unshift({ type: 'sale', text: 'Day ' + today() + ' animal collection — ' + names.join(', ') + ' = ' + commit.earned + 'g (' + reason + ')' });
        log.length = Math.min(log.length, 60);
        try {
          if (deps.saveMemberWorldData() === false) throw new Error('receipt save rejected');
        } catch (error) {
          window.__farmLog?.('Animal sale payment committed but receipt save failed: ' + String(error?.message || error), 'livestock'); // The atomic wallet payout is already safe.
        }
      }
      const amount = deps.spGold?.querySelector?.('#spGoldAmount');
      if (amount) amount.textContent = deps.inventory.gold; // Refresh gold without removing the icon/suffix.
      window.LivestockNursery?.rerollSwarm?.();
      window.FarmPanel?.render?.();
      deps.showToast?.('🐾 Animal sale collected: ' + names.length + ' animal(s), ' + commit.earned + 'g credited', true);
      lastAction = 'Collected ' + names.length + ' animals for ' + commit.earned + 'g (' + reason + ').';
      return committed;
    } catch (error) {
      lastAction = (committed ? 'Animal sale payment committed; UI refresh failed: ' : 'Animal sale collection deferred: ') + String(error?.message || error);
      window.__farmLog?.(lastAction, 'livestock'); // In-game diagnostics survive absent browser DevTools.
      return committed || { sold: 0, earned: 0 };
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
        sellerCharacterId: entry.pendingAnimalSale.sellerCharacterId || null,
      })),
    };
  }

  window.PendingAnimalSales = { init: injected => { deps = injected; }, pendingFor, queue, cancel, settle, debugSnapshot };
})();