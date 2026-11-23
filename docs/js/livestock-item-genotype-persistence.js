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
  const INSTALL_RETRY_TIMEOUT_MS = 10000; // ~200 tries at the old 50ms cadence.

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

  const groupCache = new Map(); // Invalidated only when durable lineage queues change.
  const geneKeys = new WeakMap(); // Cloned saved genotypes are immutable; serialize each once when grouping.

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
    groupCache.clear();
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
    if (!itemKey || !genotype) return; // A generic item without inherited genes has no lineage record to commit.
    if (!ensureLoaded()) return false; // A wild offspring must not be removed from its nest without a valid saved character identity.
    const copy = clonePlain(genotype); // The persisted copy is the only lineage state saved into the member record.
    if (!copy) return false;
    const list = queues[itemKey] || (queues[itemKey] = []); // Pending wild offspring remain ordered by acquisition for legacy Farm consumers.
    list.push(copy);
    groupCache.delete(itemKey);
    if (!saveQueues()) {
      list.pop(); // Undo a failed durable write so the next pickup does not acquire a phantom genetic unit.
      if (!list.length) delete queues[itemKey];
      groupCache.delete(itemKey);
      debug.errors.push('queue: failed to persist ' + itemKey + '; nest pickup may retry safely');
      debug.lastAction = 'queue-failed';
      return false;
    }
    debug.queued++;
    debug.lastItemKey = itemKey;
    debug.lastAction = 'queue';
    window.__farmLog?.('[genotype] persisted carried lineage for ' + itemKey + ' (' + list.length + ' queued)', 'wildlife');
    return true;
  }

  function acquireNestItem(itemKey, genotype, inventory, { areaId = '', liveBirth = false, remaining = 0 } = {}) {
    // One saved metadata write owns the new bag unit, its inherited bloodline, and the cave's reduced clutch.
    // Independent writes can leave a phantom baby, or duplicate an already collected one, after a quota failure.
    const liveCount = inventory?.[itemKey] ?? 0; // The live bag can change between saves, including when livestock is moved out of the Pack.
    if (!debug.installed || !ensureLoaded() || !itemKey || !inventory || typeof inventory !== 'object' ||
        !Number.isSafeInteger(liveCount) || liveCount < 0 ||
        liveCount >= (window.InventoryStacks?.MAX_TOTAL ?? Number.MAX_SAFE_INTEGER) || !Number.isSafeInteger(remaining) || remaining < 0) {
      debug.errors.push('nest-acquire: identity, installation, reward, live bag or clutch count invalid');
      return false;
    }
    const ids = currentIds(); // The active world/member identity must match the same character that owns the live bag.
    const meta = loadMeta(); // Fresh canonical save; never base this transaction on a stale cached copy.
    const world = (meta?.worlds || []).find(entry => entry.id === ids.worldId);
    const member = world?.members?.[ids.characterId];
    if (!world || !member) {
      debug.errors.push('nest-acquire: active world/member record missing');
      return false;
    }
    const copy = genotype == null ? null : clonePlain(genotype); // The exact den-family genes, if present.
    if (genotype != null && (!copy || typeof copy !== 'object')) {
      debug.errors.push('nest-acquire: invalid inherited genotype for ' + itemKey);
      return false;
    }
    const saved = serializedQueues(); // Candidate lineage queue; the live queue remains unchanged until storage succeeds.
    if (copy) (saved[itemKey] || (saved[itemKey] = [])).push(copy);
    if (Object.keys(saved).length) member[MEMBER_FIELD] = saved;
    else delete member[MEMBER_FIELD];
    member.nonGearInventory = member.nonGearInventory && typeof member.nonGearInventory === 'object'
      ? member.nonGearInventory : {};
    const nextCount = liveCount + 1; // The cave clutch comparison below guards against collecting the same baby twice.
    member.nonGearInventory[itemKey] = nextCount; // Commit the exact live bag count in the SAME metadata write as its genes.
    const isCavern = typeof areaId === 'string' && areaId.startsWith('map_i_den_'); // Cave clutch records live on the world rather than on the character.
    if (isCavern) {
      const record = world.denTurnover?.records?.find(entry => entry?.cavernMapId === areaId); // Existing cave identity is required to prevent a collected baby respawning after reload.
      if (!record) {
        debug.errors.push('nest-acquire: saved cave turnover record missing for ' + areaId);
        return false;
      }
      if (record.clutch?.itemKey && record.clutch.itemKey !== itemKey) {
        debug.errors.push('nest-acquire: saved clutch species/item does not match ' + itemKey + ' in ' + areaId);
        return false;
      }
      if (record.clutch?.remaining != null && Number(record.clutch.remaining) !== remaining + 1) {
        debug.errors.push('nest-acquire: saved clutch count mismatch in ' + areaId + ': saved=' + record.clutch.remaining + ', expected=' + (remaining + 1));
        return false;
      }
      record.clutch = {
        remaining,
        itemKey, liveBirth: !!liveBirth, genotype: copy || genotype || null,
      }; // The cave can no longer regenerate a baby whose count and lineage were committed.
    }
    try {
      localStorage.setItem(SAVE_META_KEY, JSON.stringify(meta)); // localStorage.setItem replaces the entire record or throws without replacing it.
    } catch (error) {
      debug.errors.push('nest-acquire: ' + (error?.message || String(error)));
      debug.lastAction = 'nest-acquire-failed';
      return false;
    }
    inventory[itemKey] = nextCount;
    if (copy) (queues[itemKey] || (queues[itemKey] = [])).push(copy); // Only update same-session grouping after the durable write is confirmed.
    groupCache.delete(itemKey);
    debug.queued += copy ? 1 : 0;
    debug.saves++;
    debug.lastItemKey = itemKey;
    debug.lastAction = 'nest-acquire';
    try { window.__farmLog?.('[genotype] committed den pickup for ' + itemKey + ', saved count=' + nextCount + ', cave=' + (isCavern ? areaId : 'other'), 'wildlife'); }
    catch (_) { /* A diagnostic sink must never turn an already-committed pickup into a retry. */ }
    return true;
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
    groupCache.delete(itemKey);
    if (!list.length) delete queues[itemKey];
    injectedIntoFarmAnimals.delete(itemKey);
    debug.consumed++;
    debug.lastItemKey = itemKey;
    debug.lastAction = 'consume';
    saveQueues({ consumedItemKey: itemKey });
    window.__farmLog?.(`[genotype] consumed persisted carried lineage for ${itemKey} (${queues[itemKey]?.length || 0} queued)`, 'wildlife');
  }

  function groupsFor(itemKey, total) {
    ensureLoaded();
    if (!window.SCRATCHBONES_CONFIG?.game?.livestock?.itemKinds?.[itemKey]) return null;
    const count = Math.max(0, Math.floor(Number(total) || 0)); // Bag count bounds legacy/stale metadata.
    const cached = groupCache.get(itemKey); // Reuses grouping until acquisition, deployment, or bag total changes.
    if (cached?.total === count) return cached.groups;
    const grouped = new Map(); // Same full genotype shares a stack even if property order differs.
    const list = queues[itemKey] || []; // Remaining units without metadata stay in a separate generic stack.
    for (const genotype of list.slice(0, count)) {
      let signature = geneKeys.get(genotype); // Avoid repeated serialization of painted genotype objects.
      if (!signature) { signature = window.InventoryStacks.genotypeKey(genotype); geneKeys.set(genotype, signature); }
      const group = grouped.get(signature); // Accumulates exact inherited alleles, including hidden carriers.
      if (group) group.count++;
      else grouped.set(signature, { variant: signature, genotype, count: 1 });
    }
    const groups = [...grouped.values()]; // Stable first-acquired ordering for the inventory UI.
    if (count > list.length) groups.push({ variant: 'generic', genotype: null, count: count - list.length });
    groupCache.set(itemKey, { total: count, groups });
    return groups;
  }

  function consumeVariant(itemKey, variant, availableTotal, consumeUnit) {
    if (!ensureLoaded() || typeof consumeUnit !== 'function' || typeof variant !== 'string') return { ok:false };
    const groups = groupsFor(itemKey, availableTotal); // Offerings and Farm use the same exact-genotype grouping authority.
    if (!groups?.some(group => group.variant === variant && group.count > 0) || injectedIntoFarmAnimals.has(itemKey)) return { ok:false };
    const list = queues[itemKey] || []; // Used to remove only the chosen genotype after the exact quality unit has been debited.
    const index = variant === 'generic' ? -1 : list.findIndex(gene => window.InventoryStacks.genotypeKey(gene) === variant);
    if (variant !== 'generic' && index < 0) return { ok:false };
    if (variant === 'generic' && Math.max(0,Math.floor(Number(availableTotal)||0)) <= list.length) return { ok:false };
    if (consumeUnit() !== true) return { ok:false }; // No trait metadata is lost when the inventory/quality debit fails.
    const genotype = index >= 0 ? clonePlain(list.splice(index,1)[0]) : null; // Retain the released animal's actual inherited traits for wildlife placement.
    if (!list.length) delete queues[itemKey];
    groupCache.delete(itemKey);
    debug.consumed++;
    debug.lastItemKey = itemKey;
    debug.lastAction = 'festival-offering';
    saveQueues({ consumedItemKey:itemKey }); // Saves lineage and bag count together, as existing Farm deployment does.
    return { ok:true,genotype };
  }

  function wrapDeployment(original, itemKey, args) {
    const selection = args[0]?.inventoryVariant; // Optional exact stack selected in Pack; old Farm actions retain FIFO behavior.
    if (selection != null) {
      ensureLoaded();
      const list = queues[itemKey] || []; // Validate again at activation time, after any previous menu action.
      const index = selection === 'generic' ? -1 : list.findIndex(gene => window.InventoryStacks.genotypeKey(gene) === selection);
      if (selection !== 'generic' && index < 0) return { ok: false, message: 'That animal stack is no longer available.' };
      if (injectedIntoFarmAnimals.has(itemKey)) return { ok: false, message: 'Retry the pending animal deployment first.' };
      const result = original.call(window.FarmAnimals, itemKey, { ...args[0], carriedGenotype: index < 0 ? null : clonePlain(list[index]) }, ...args.slice(1)); // Explicit null skips private FIFO for a generic unit.
      if (result?.ok) {
        if (index >= 0) list.splice(index, 1);
        if (!list.length) delete queues[itemKey];
        groupCache.delete(itemKey);
        debug.consumed++;
        saveQueues({ consumedItemKey: itemKey });
      }
      return result;
    }
    const hadPersisted = seedOriginalQueueIfNeeded(itemKey); // Compatibility for existing callers that do not select a stack.
    const result = original.call(window.FarmAnimals, itemKey, ...args);
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
    // #mpCompendium/.compendium-content only ever get inserted inside
    // #menuPanel (static markup, present from load), so watching
    // document.documentElement's entire page meant any unrelated DOM
    // insertion anywhere queued this scan for no reason.
    observer.observe(document.getElementById('menuPanel') || document.documentElement, { childList: true, subtree: true });
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
    groupsFor,
    consumeVariant,
    acquireNestItem,
    flush: saveQueues,
    reload() { activeIdentity = null; return ensureLoaded(); },
    getDebug() {
      ensureLoaded();
      const ids = currentIds(); // Identifies the saved character whose Pack count should back each retained bloodline.
      const member = (loadMeta()?.worlds || []).find(world => world.id === ids.worldId)?.members?.[ids.characterId];
      const savedBag = member?.nonGearInventory || {}; // Read-only forensic check: never mint missing babies automatically.
      const unbackedLineages = Object.fromEntries(Object.entries(queues).flatMap(([itemKey, list]) => {
        const backed = Math.max(0, Math.floor(Number(savedBag[itemKey]) || 0));
        const excess = Math.max(0, list.length - backed);
        return excess ? [[itemKey, { queuedGenes: list.length, savedInventory: backed, missingBagUnits: excess }]] : [];
      })); // Mobile Pixel Probe can identify old vanished offspring if their genotype FIFO survived.
      return {
        ...debug,
        queuedNow: queuedCount(),
        queues: serializedQueues(),
        unbackedLineages,
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
    // Same script-order race every other late-loaded module hits (FarmAnimals
    // may not be installed yet) -- retried via the shared SceneReadyPoller
    // (see its own header comment) rather than another one-off setInterval.
    window.SceneReadyPoller.pollUntilReady(install, INSTALL_RETRY_TIMEOUT_MS, INSTALL_RETRY_MS);
    document.addEventListener('DOMContentLoaded', install, { once: true });
  }
})();
