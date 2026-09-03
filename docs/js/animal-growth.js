(() => {
  'use strict';
  if (window.AnimalGrowth) return;

  // Shared animal-age gate for both farm Nursery babies and personal Stable babies.
  // All tunables live here; shops own prices in shop-stock.json.
  const CONFIG = Object.freeze({
    item: Object.freeze({
      key: 'growthTonic',
      label: 'Growth Tonic',
      icon: '🌱',
      category: 'processed',
      sellPrice: 0,
      tags: Object.freeze(['Livestock', 'Animal Care']),
      description: 'Matures one baby animal into an adult. Stable babies can be grown directly when equipping them.',
      spriteIcon: 'bottle_potion.png',
      spriteColor: 0x78b85a,
    }),
    stages: Object.freeze({
      baby: 'baby',
      adult: 'adult',
      legacyStableDefault: 'adult',
      newStableDefault: 'baby',
    }),
    stable: Object.freeze({
      growAndEquipOnRoleClick: true,
    }),
  });

  let animalDeps = null; // Used for inventory, Stable persistence, and inventory UI refreshes.
  let panelDeps = null; // Used for Stable role setters and Stable panel rendering.
  let installed = false; // Used to keep all wrappers and the capture listener idempotent.
  let nurseryGrowWrapped = false; // Used to avoid wrapping LivestockNursery.growBaby more than once.
  let nurseryUiGateInstalled = false; // Used by the capture-phase gate for the Nursery's private Grow Up callback.
  let decoratingStable = false; // Used to avoid recursive Stable panel decoration.

  const original = {
    farmAnimalsInit: null,
    addToStable: null,
    farmPanelInit: null,
    stableRender: null,
    nurseryGrow: null,
  };

  const isBaby = entry => entry?.lifeStage === CONFIG.stages.baby;

  function depsForInventory() {
    return animalDeps || panelDeps;
  }

  function growthTonicCount() {
    const deps = depsForInventory();
    return Math.max(0, Number(deps?.inventory?.[CONFIG.item.key]) || 0);
  }

  function ensureItemDef(deps = depsForInventory()) {
    if (!deps?.ITEM_DEFS) return null;
    const key = CONFIG.item.key;
    if (!deps.ITEM_DEFS[key]) {
      deps.ITEM_DEFS[key] = {
        icon: CONFIG.item.icon,
        label: CONFIG.item.label,
        cat: CONFIG.item.category,
        sellPrice: CONFIG.item.sellPrice,
        tags: [...CONFIG.item.tags],
        desc: CONFIG.item.description,
        spriteIcon: CONFIG.item.spriteIcon,
        spriteColor: CONFIG.item.spriteColor,
        spriteMode: 'keyed',
      };
    }
    return key;
  }

  function saveInventorySideEffects() {
    const deps = depsForInventory();
    deps?.clampInventoryStack?.(CONFIG.item.key);
    deps?.saveMemberWorldData?.();
    deps?.buildInventoryGrid?.();
    deps?.refreshActionBar?.();
    deps?.refreshItemScroll?.();
  }

  function consumeGrowthTonic() {
    const deps = depsForInventory();
    if (!deps?.inventory || growthTonicCount() < 1) return false;
    deps.inventory[CONFIG.item.key] = growthTonicCount() - 1;
    saveInventorySideEffects();
    return true;
  }

  function stableDeps() {
    return panelDeps || animalDeps;
  }

  function activeStableIdForRole(role) {
    const deps = stableDeps();
    if (role === 'mount') return deps?.getActiveMountId?.() || null;
    if (role === 'shoulderPet') return deps?.getActiveShoulderPetId?.() || null;
    return deps?.getActiveCompanionId?.() || null;
  }

  function setActiveStableIdForRole(role, id) {
    const deps = stableDeps();
    if (role === 'mount') deps?.setActiveMountId?.(id);
    else if (role === 'shoulderPet') deps?.setActiveShoulderPetId?.(id);
    else deps?.setActiveCompanionId?.(id);
  }

  function roleForStableEntry(entry) {
    return window.CreatureGenetics?.stableEntryRole?.(entry) || 'companion';
  }

  function clearBabyFromActiveRoles(entry) {
    if (!entry?.id) return false;
    let changed = false;
    for (const role of ['mount', 'companion', 'shoulderPet']) {
      if (activeStableIdForRole(role) !== entry.id) continue;
      setActiveStableIdForRole(role, null);
      changed = true;
    }
    return changed;
  }

  function normalizeStableLifeStages() {
    const deps = stableDeps();
    const stable = deps?.getStable?.();
    if (!Array.isArray(stable)) return false;
    let changed = false;
    for (const entry of stable) {
      if (entry.lifeStage !== CONFIG.stages.baby && entry.lifeStage !== CONFIG.stages.adult) {
        entry.lifeStage = CONFIG.stages.legacyStableDefault;
        changed = true;
      }
      if (isBaby(entry) && clearBabyFromActiveRoles(entry)) changed = true;
    }
    if (changed) deps?.saveStable?.();
    return changed;
  }

  function growStableBaby(stableId, options = {}) {
    normalizeStableLifeStages();
    const deps = stableDeps();
    const entry = deps?.getStable?.()?.find?.(item => item.id === stableId);
    if (!entry || !isBaby(entry)) return { ok: false, message: 'That Stable baby was not found.' };
    if (growthTonicCount() < 1) {
      return { ok: false, message: `You need a ${CONFIG.item.label} to grow ${entry.name || 'that baby'}.` };
    }

    entry.lifeStage = CONFIG.stages.adult;
    if (!consumeGrowthTonic()) {
      entry.lifeStage = CONFIG.stages.baby;
      return { ok: false, message: `You need a ${CONFIG.item.label}.` };
    }

    if (options.equip) {
      const role = roleForStableEntry(entry);
      setActiveStableIdForRole(role, entry.id);
    }
    deps?.saveStable?.();
    window.FarmPanel?.renderStablePanel?.();
    return {
      ok: true,
      entry,
      equipped: !!options.equip,
      message: `${CONFIG.item.icon} ${entry.name || 'Your animal'} grew into an adult${options.equip ? ' and was equipped' : ''}.`,
    };
  }

  function wrapFarmAnimals(api) {
    if (!api || api.__animalGrowthWrapped) return !!api;
    api.__animalGrowthWrapped = true;

    original.farmAnimalsInit = api.init;
    if (typeof original.farmAnimalsInit === 'function') {
      api.init = function animalGrowthFarmAnimalsInit(injectedDeps, ...args) {
        const result = original.farmAnimalsInit.call(this, injectedDeps, ...args);
        animalDeps = injectedDeps;
        ensureItemDef(injectedDeps);
        normalizeStableLifeStages();
        return result;
      };
    }

    original.addToStable = api.addToStable;
    if (typeof original.addToStable === 'function') {
      api.addToStable = function animalGrowthAddToStable(...args) {
        const result = original.addToStable.apply(this, args);
        if (!result?.ok || !result.entry) return result;
        result.entry.lifeStage = CONFIG.stages.newStableDefault;
        clearBabyFromActiveRoles(result.entry);
        stableDeps()?.saveStable?.();
        return {
          ...result,
          message: `${result.entry.name || 'Animal'} added to your Stable as a baby. Use a ${CONFIG.item.label} when you want to grow it.`,
        };
      };
    }
    return true;
  }

  function sectionForStableAge(title, note) {
    const section = document.createElement('div');
    section.className = 'stable-age-section';
    const heading = document.createElement('div');
    heading.className = 'settings-section-title';
    heading.textContent = title;
    section.appendChild(heading);
    if (note) {
      const noteEl = document.createElement('div');
      noteEl.className = 'farm-note';
      noteEl.textContent = note;
      section.appendChild(noteEl);
    }
    const rows = document.createElement('div');
    rows.className = 'farm-list';
    section.appendChild(rows);
    return { section, rows };
  }

  function replaceRoleButton(row, entry) {
    const oldButton = row.querySelector('.farm-companion-btn');
    if (!oldButton) return;
    const role = roleForStableEntry(entry);
    const active = activeStableIdForRole(role) === entry.id;
    const button = oldButton.cloneNode(true);
    button.classList.toggle('active', !isBaby(entry) && active);

    if (isBaby(entry)) {
      button.title = `${CONFIG.item.label} required — grow and set as ${role === 'shoulderPet' ? 'shoulder pet' : role}.`;
      button.addEventListener('click', () => {
        const result = growStableBaby(entry.id, { equip: CONFIG.stable.growAndEquipOnRoleClick });
        stableDeps()?.showToast?.(result.message, result.ok !== false);
      });
    } else {
      button.title = active ? `Active ${role === 'shoulderPet' ? 'shoulder pet' : role}` : `Set as ${role === 'shoulderPet' ? 'shoulder pet' : role}`;
      button.addEventListener('click', () => {
        setActiveStableIdForRole(role, active ? null : entry.id);
        stableDeps()?.saveStable?.();
        window.FarmPanel?.renderStablePanel?.();
      });
    }
    oldButton.replaceWith(button);
  }

  function decorateStablePanel() {
    if (decoratingStable || typeof document === 'undefined') return;
    const list = document.getElementById('stableList');
    const deps = stableDeps();
    const stable = deps?.getStable?.();
    if (!list || !Array.isArray(stable)) return;

    normalizeStableLifeStages();
    const sourceRows = [...list.children].filter(node => node.classList?.contains('farm-row'));
    if (stable.length && sourceRows.length !== stable.length) return;

    decoratingStable = true;
    try {
      list.innerHTML = '';
      if (!stable.length) {
        list.innerHTML = '<div class="farm-note">Your Stable is empty. Add an undeployed creature item from the Inventory tab.</div>';
        return;
      }

      const babies = sectionForStableAge(
        '🐣 Baby Animals',
        `Baby Stable animals cannot be mounts, companions, or shoulder pets until you use a ${CONFIG.item.label}.`
      );
      const adults = sectionForStableAge('🐾 Adult Animals', 'Adult Stable animals can fill their normal role.');

      stable.forEach((entry, index) => {
        const row = sourceRows[index];
        if (!row) return;
        replaceRoleButton(row, entry);
        if (isBaby(entry)) {
          const value = row.querySelector('.farm-row-value');
          if (value) value.insertAdjacentHTML('afterbegin', '<strong>Baby · </strong>');
          const grow = document.createElement('button');
          grow.className = 'settings-small-btn stable-grow-btn';
          grow.textContent = `${CONFIG.item.icon} Grow Up`;
          grow.title = `${CONFIG.item.label}: ${growthTonicCount()} owned`;
          grow.addEventListener('click', () => {
            const result = growStableBaby(entry.id);
            deps?.showToast?.(result.message, result.ok !== false);
          });
          row.appendChild(grow);
          babies.rows.appendChild(row);
        } else {
          adults.rows.appendChild(row);
        }
      });

      if (!babies.rows.children.length) {
        babies.rows.innerHTML = '<div class="farm-note">No baby animals in your Stable.</div>';
      }
      if (!adults.rows.children.length) {
        adults.rows.innerHTML = '<div class="farm-note">No adult animals in your Stable.</div>';
      }
      list.appendChild(babies.section);
      list.appendChild(adults.section);
    } finally {
      decoratingStable = false;
    }
  }

  function wrapFarmPanel(api) {
    if (!api || api.__animalGrowthWrapped) return !!api;
    api.__animalGrowthWrapped = true;

    original.farmPanelInit = api.init;
    if (typeof original.farmPanelInit === 'function') {
      api.init = function animalGrowthFarmPanelInit(injectedDeps, ...args) {
        const result = original.farmPanelInit.call(this, injectedDeps, ...args);
        panelDeps = injectedDeps;
        ensureItemDef(injectedDeps);
        normalizeStableLifeStages();
        return result;
      };
    }

    original.stableRender = api.renderStablePanel;
    if (typeof original.stableRender === 'function') {
      api.renderStablePanel = function animalGrowthStableRender(...args) {
        const result = original.stableRender.apply(this, args);
        decorateStablePanel();
        return result;
      };
    }
    return true;
  }

  function wrapNurseryGrow() {
    const nursery = window.LivestockNursery;
    if (!nursery?.growBaby || nurseryGrowWrapped) return false;
    nurseryGrowWrapped = true;
    original.nurseryGrow = nursery.growBaby;
    nursery.growBaby = function growthTonicNurseryGrow(...args) {
      if (growthTonicCount() < 1) {
        return { ok: false, message: `You need a ${CONFIG.item.label} to grow a Nursery baby.` };
      }
      const result = original.nurseryGrow.apply(this, args);
      if (result?.ok) {
        consumeGrowthTonic();
        return { ...result, message: `${result.message} ${CONFIG.item.icon} Used 1 ${CONFIG.item.label}.` };
      }
      return result;
    };
    return true;
  }

  function nurseryBabyIds() {
    const babies = window.LivestockNursery?.debugSnapshot?.()?.babies || [];
    return new Set(babies.map(entry => entry.id));
  }

  // LivestockNursery's own Grow Up button closes over its private growBaby()
  // rather than calling the exported method. Capture the click before that
  // private callback: block it without tonic, or verify the baby actually
  // left the Nursery before consuming one. This keeps failures non-consuming.
  function installNurseryUiGate() {
    if (nurseryUiGateInstalled || typeof document === 'undefined') return false;
    nurseryUiGateInstalled = true;
    document.addEventListener('click', event => {
      const button = event.target?.closest?.('#livestockNurserySection button');
      if (!button || String(button.textContent || '').trim() !== 'Grow Up') return;

      if (growthTonicCount() < 1) {
        event.preventDefault();
        event.stopImmediatePropagation();
        depsForInventory()?.showToast?.(`You need a ${CONFIG.item.label} to grow a Nursery baby.`, false);
        return;
      }

      const before = nurseryBabyIds();
      queueMicrotask(() => {
        const after = nurseryBabyIds();
        const matured = [...before].some(id => !after.has(id));
        if (matured) consumeGrowthTonic();
      });
    }, true);
    return true;
  }

  function debugSnapshot() {
    normalizeStableLifeStages();
    const deps = stableDeps();
    const stable = deps?.getStable?.() || [];
    return {
      mostRecentChange: 'Growth Tonic gates farm/stable maturation; Stable is split into baby/adult groups.',
      installed,
      growthTonic: { key: CONFIG.item.key, count: growthTonicCount() },
      stableBabies: stable.filter(isBaby).map(entry => ({ id: entry.id, name: entry.name, kind: entry.kind })),
      stableAdults: stable.filter(entry => !isBaby(entry)).map(entry => ({ id: entry.id, name: entry.name, kind: entry.kind })),
      active: {
        mount: activeStableIdForRole('mount'),
        companion: activeStableIdForRole('companion'),
        shoulderPet: activeStableIdForRole('shoulderPet'),
      },
      nursery: window.LivestockNursery?.debugSnapshot?.() || null,
    };
  }

  function install() {
    wrapFarmAnimals(window.FarmAnimals);
    wrapFarmPanel(window.FarmPanel);
    wrapNurseryGrow();
    installNurseryUiGate();
    installed = true;
    return true;
  }

  window.AnimalGrowth = {
    CONFIG,
    install,
    isBaby,
    ensureItemDef,
    growthTonicCount,
    normalizeStableLifeStages,
    growStableBaby,
    debugSnapshot,
  };
  window.__animalGrowthDebug = { snapshot: debugSnapshot, growStableBaby };

  install();
})();
