// Persists genotype-bearing livestock items (wild/Jubmir eggs and babies)
// across save/reload without changing the game's count-based inventory shape.
//
// FarmAnimals historically kept these genotypes in a private in-memory FIFO.
// This adapter takes ownership of the public queue API, stores the same FIFO on
// world.members[characterId], and injects exactly one saved genotype back into
// FarmAnimals immediately before that creature item is deployed to the Farm or
// personal Stable. Generic stack units remain generic; saved lineage entries are
// consumed FIFO as matching creature items are deployed.
(() => {
  'use strict';
  if (window.LivestockItemGenotypePersistence) return;

  const SAVE_META_KEY = 'hobunjiSaveMeta';
  const PROFILE_KEY = 'hobunjiPlayerProfile';
  const MEMBER_FIELD = 'livestockItemGenotypes';
  const INSTALL_RETRY_MS = 50;
  const INSTALL_RETRY_LIMIT = 200;

  const debug = {
    installed: false,
    installAttempts: 0,
    activeIdentity: null,
    queued: 0,
    consumed: 0,
    saves: 0,
    loads: 0,
    lastItemKey: null,
    lastAction: null,
    errors: [],
  }; // Used by mobile-safe diagnostics when console access is unavailable.

  let activeIdentity = null; // Used to prevent one character/world from reusing another's loaded lineage queue.
  let queues = Object.create(null); // Used as the in-memory mirror of the persisted per-item genotype FIFOs.
  const injectedIntoFarmAnimals = new Set(); // Used when a failed deployment leaves a seeded genotype in FarmAnimals' private queue.
  let originalQueueItemGenotype = null; // Used to seed FarmAnimals' original private FIFO only at deployment time.
  let originalAddFromItem = null; // Used by the wrapped Farm deployment path.
  let originalAddToStable = null; // Used by the wrapped Stable deployment path.

  function clonePlain(value) {
    if (value == null) return null;
    try { return JSON.parse(JSON.stringify(value)); }
    catch (error) {
      debug.errors.push('clone: ' + (error?.message || String(error)));
      return null;
    }
  }

  function storedProfile() {
    try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null'); }
    catch (_) { return null; }
  }

  function currentIds() {
    const profile = window.__hobunjiPlayerProfile || storedProfile();
    const worldId = profile?.worldId || null;
    const characterId = profile?.characterId || null;
    return { worldId, characterId, identity: worldId && characterId ? `${worldId}::${characterId}` : null };
  }

  function loadMeta() {
    try { return JSON.parse(localStorage.getItem(SAVE_META_KEY) || 'null'); }
    catch (error) {
      debug.errors.push('loadMeta: ' + (error?.message || String(error)));
      return null;
    }
  }

  function ensureLoaded() {
    const ids = currentIds();
    if (!ids.identity) return false;
    if (activeIdentity === ids.identity) return true;

    activeIdentity = ids.identity;
    debug.activeIdentity = ids.identity;
    queues = Object.create(null);
    injectedIntoFarmAnimals.clear();

    const meta = loadMeta();
    const world = (meta?.worlds || []).find(entry => entry.id === ids.worldId);
    const member = world?.members?.[ids.characterId];
    const saved = member?.[MEMBER_FIELD];
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      for (const [itemKey, list] of Object.entries(saved)) {
        if (!Array.isArray(list)) continue;
        const clean = list.map(clonePlain).filter(Boolean);
        if (clean.length) queues[itemKey] = clean;
      }
    }
    debug.loads++;
    debug.lastAction = 'load';
    return true;
  }

  function serializedQueues() {
    const out = {};
    for (const [itemKey, list] of Object.entries(queues)) {
      if (!Array.isArray(list) || !list.length) continue;
      out[itemKey] = list.map(clonePlain).filter(Boolean);
    }
    return out;
  }

  function saveQueues({ consumedItemKey = null } = {}) {
    if (!ensureLoaded()) return false;
    const ids = currentIds();
    const meta = loadMeta();
    const world = (meta?.worlds || []).find(entry => entry.id === ids.worldId);
    const member = world?.members?.[ids.characterId];
    if (!world || !member) {
      debug.errors.push('save: active world/member record missing');
      return false;
    }
    const saved = serializedQueues();
    if (Object.keys(saved).length) member[MEMBER_FIELD] = saved;
    else delete member[MEMBER_FIELD];

    // FarmAnimals consumes the live inventory unit before returning ok, but
    // its Farm/Stable deployment functions do not themselves flush the
    // character's world inventory. A lineage deployment must therefore save
    // both halves together: removing the FIFO head while leaving the saved
    // stack count untouched would resurrect a generic copy of the consumed egg
    // on reload. Acquisition sources already save their newly-added stack unit
    // immediately after queueItemGenotype, so decrementing that saved count by
    // exactly one here mirrors the successful live deployment atomically.
    if (consumedItemKey && member.nonGearInventory && typeof member.nonGearInventory === 'object') {
      const before = Math.max(0, Number(member.nonGearInventory[consumedItemKey]) || 0);
      const after = Math.max(0, before - 1);
      if (after > 0) member.nonGearInventory[consumedItemKey] = after;
      else delete member.nonGearInventory[consumedItemKey];
    }

    try {
      localStorage.setItem(SAVE_META_KEY, JSON.stringify(meta));
      debug.saves++;
      return true;
    } catch (error) {
      debug.errors.push('save: ' + (error?.message || String(error)));
      return false;
    }
  }

  function queuedCount() {
    return Object.values(queues).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0);
  }

  function queuePersistedGenotype(itemKey, genotype) {
    if (!itemKey || !genotype || !ensureLoaded()) return;
    const copy = clonePlain(genotype);
    if (!copy) return;
    (queues[itemKey] || (queues[itemKey] = [])).push(copy);
    debug.queued++;
    debug.lastItemKey = itemKey;
    debug.lastAction = 'queue';
    saveQueues();
    window.__farmLog?.(`[genotype] persisted carried lineage for ${itemKey} (${queues[itemKey].length} queued)`, 'wildlife');
  }

  function seedOriginalQueueIfNeeded(itemKey) {
    if (!ensureLoaded()) return false;
    const list = queues[itemKey];
    if (!list?.length || injectedIntoFarmAnimals.has(itemKey)) return !!list?.length;
    const copy = clonePlain(list[0]);
    if (!copy) return false;
    originalQueueItemGenotype.call(window.FarmAnimals, itemKey, copy);
    injectedIntoFarmAnimals.add(itemKey);
    debug.lastItemKey = itemKey;
    debug.lastAction = 'seed';
    return true;
  }

  function consumePersistedHead(itemKey) {
    const list = queues[itemKey];
    if (!list?.length) return;
    list.shift();
    if (!list.length) delete queues[itemKey];
    injectedIntoFarmAnimals.delete(itemKey);
    debug.consumed++;
    debug.lastItemKey = itemKey;
    debug.lastAction = 'consume';
    saveQueues({ consumedItemKey: itemKey });
    window.__farmLog?.(`[genotype] consumed persisted carried lineage for ${itemKey} (${queues[itemKey]?.length || 0} queued)`, 'wildlife');
  }

  function wrapDeployment(original, itemKey, args) {
    const hadPersisted = seedOriginalQueueIfNeeded(itemKey);
    let result;
    try {
      result = original.call(window.FarmAnimals, itemKey, ...args);
    } catch (error) {
      debug.errors.push('deploy: ' + (error?.message || String(error)));
      throw error;
    }
    // addFromItem/addToStable both validate all failure gates before they
    // consume FarmAnimals' private FIFO. Therefore a failed attempt leaves
    // the injected head in place; the Set above prevents duplicate seeding
    // on the next attempt. Only a successful deployment consumes persistence.
    if (result?.ok && hadPersisted) consumePersistedHead(itemKey);
    else if (result?.ok) injectedIntoFarmAnimals.delete(itemKey);
    return result;
  }

  function patchCompendiumPersistenceNote(root = document) {
    const nodes = root.querySelectorAll?.('.compendium-notes li') || [];
    for (const node of nodes) {
      if (!node.textContent?.startsWith('Important: the exact stolen genotype is currently carried in a same-session queue')) continue;
      node.textContent = 'The exact stolen genotype is saved with your character in this world, so saving/reloading before deploying the egg or baby preserves that bloodline.';
    }
  }

  function installCompendiumCorrection() {
    patchCompendiumPersistenceNote();
    const observer = new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          patchCompendiumPersistenceNote(node);
          if (node.matches?.('#mpCompendium, .compendium-content')) patchCompendiumPersistenceNote(node);
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function install() {
    debug.installAttempts++;
    const farmAnimals = window.FarmAnimals;
    if (!farmAnimals?.queueItemGenotype || !farmAnimals?.addFromItem || !farmAnimals?.addToStable) return false;
    if (debug.installed) return true;

    originalQueueItemGenotype = farmAnimals.queueItemGenotype;
    originalAddFromItem = farmAnimals.addFromItem;
    originalAddToStable = farmAnimals.addToStable;

    farmAnimals.queueItemGenotype = queuePersistedGenotype;
    farmAnimals.addFromItem = function persistedAddFromItem(itemKey, ...args) {
      return wrapDeployment(originalAddFromItem, itemKey, args);
    };
    farmAnimals.addToStable = function persistedAddToStable(itemKey, ...args) {
      return wrapDeployment(originalAddToStable, itemKey, args);
    };

    debug.installed = true;
    debug.lastAction = 'install';
    ensureLoaded();
    window.__farmLog?.('[genotype] durable carried-lineage persistence installed', 'wildlife');
    return true;
  }

  window.LivestockItemGenotypePersistence = {
    install,
    flush: saveQueues,
    reload() { activeIdentity = null; return ensureLoaded(); },
    getDebug() {
      ensureLoaded();
      return {
        ...debug,
        queuedNow: queuedCount(),
        queues: serializedQueues(),
        errors: [...debug.errors],
      };
    },
    formatDebug() {
      const state = this.getDebug();
      return [
        `installed: ${state.installed}`,
        `identity: ${state.activeIdentity || '(none)'}`,
        `queued lineages: ${state.queuedNow}`,
        `queued/consumed: ${state.queued}/${state.consumed}`,
        `loads/saves: ${state.loads}/${state.saves}`,
        `last: ${state.lastAction || '(none)'} ${state.lastItemKey || ''}`.trim(),
        `errors: ${state.errors.length ? state.errors.join(' | ') : 'none'}`,
      ].join('\n');
    },
  };

  installCompendiumCorrection();

  if (!install()) {
    let attempts = 0;
    const timer = setInterval(() => {
      attempts++;
      if (install() || attempts >= INSTALL_RETRY_LIMIT) clearInterval(timer);
    }, INSTALL_RETRY_MS);
    document.addEventListener('DOMContentLoaded', install, { once: true });
  }
})();
