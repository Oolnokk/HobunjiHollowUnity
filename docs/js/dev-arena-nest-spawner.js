(() => {
  'use strict';

  if (window.DevArenaNestSpawner?.version >= 1) return;

  const VERSION = 2;
  const ARENA_ID = 'map_dev_arena';
  const DEFAULT_CLUTCH = 3;
  const NEST_COLOR = 0x7a5b3a;

  let denDeps = null;
  let devDeps = null;
  let currentNest = null;
  let currentNestMesh = null;
  let serial = 0;

  function toast(message, ok = true) {
    const showToast = denDeps?.showToast || devDeps?.showToast;
    showToast?.(message, ok);
  }

  function disposeObject(root) {
    if (!root) return;
    root.parent?.remove?.(root);
    root.traverse?.(child => {
      child.geometry?.dispose?.();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        if (!material) continue;
        material.map?.dispose?.();
        material.dispose?.();
      }
    });
  }

  function liveBirthForItem(itemKey) {
    const label = denDeps?.ITEM_DEFS?.[itemKey]?.label || '';
    return !/egg/i.test(`${itemKey} ${label}`);
  }

  function animalKindForItem(itemKey) {
    const configured = window.SCRATCHBONES_CONFIG?.game?.livestock?.itemKinds?.[itemKey];
    if (configured) return configured;
    const motherDefs = Object.values(window.SCRATCHBONES_CONFIG?.game?.wildlife?.denMothers || {});
    const mother = motherDefs.find(def => def?.nestItemKey === itemKey);
    const motherKind = mother?.creatureKey || null;
    return window.CreatureGenetics?.SPECIES_ALIAS?.[motherKind] || motherKind;
  }

  function genotypeForItem(itemKey) {
    if (!liveBirthForItem(itemKey)) return null;
    const kind = animalKindForItem(itemKey);
    if (!kind) return null;
    try {
      return window.CreatureGenetics?.makeDefaultGenotype?.(kind) || null;
    } catch (_) {
      return null;
    }
  }

  function buildNestMesh(nest) {
    const scene = denDeps?.getActiveScene?.();
    if (!scene) return null;
    const cx = nest.col + nest.w / 2;
    const cz = nest.row + nest.h / 2;
    const y = Number(denDeps?.activeSurfaceYAtWorld?.(cx, cz)) || 0;
    let mesh = window.ProceduralFurniture?.buildFurnitureGroup?.('nest', NEST_COLOR) || null;
    if (!mesh && window.THREE) {
      mesh = new THREE.Group();
      const torus = new THREE.Mesh(
        new THREE.TorusGeometry(0.72, 0.17, 8, 24),
        new THREE.MeshBasicMaterial({ color: NEST_COLOR })
      );
      torus.rotation.x = Math.PI / 2;
      mesh.add(torus);
    }
    if (!mesh) return null;
    mesh.name = `dev_arena_nest_${nest.id}`;
    mesh.userData.devArenaNest = true;
    mesh.position.set(cx, y, cz);
    scene.add(mesh);
    return mesh;
  }

  function clearNest({ quiet = false } = {}) {
    if (denDeps?._denNests && currentNest && denDeps._denNests.get(ARENA_ID) === currentNest) {
      denDeps._denNests.delete(ARENA_ID);
    }
    disposeObject(currentNestMesh);
    currentNestMesh = null;
    currentNest = null;
    try { window.DenNestSystem?.debugSnapshot?.(); } catch (_) {}
    refreshStatus();
    if (!quiet) toast('Cleared the Testing Arena nest.', true);
  }

  function spawnNest(itemKey) {
    if (!denDeps?._denNests || !denDeps?.player || !denDeps?.TILE) {
      toast('Nest spawner is still waiting for DenNestSystem initialization.', false);
      return null;
    }
    if (denDeps.getCurrentArea?.() !== ARENA_ID) {
      toast('Enter the Testing Arena before spawning a nest.', false);
      return null;
    }
    if (!itemKey) return null;

    clearNest({ quiet: true });

    const tileX = denDeps.player.x / denDeps.TILE;
    const tileZ = denDeps.player.y / denDeps.TILE;
    const col = Math.floor(tileX + 2.5);
    const row = Math.floor(tileZ - 1);
    const nest = {
      id: `dev-arena:${++serial}`,
      areaId: ARENA_ID,
      col,
      row,
      w: 2,
      h: 2,
      itemKey,
      liveBirth: liveBirthForItem(itemKey),
      remaining: DEFAULT_CLUTCH,
      genotype: genotypeForItem(itemKey),
      devArenaTestNest: true,
    };

    denDeps._denNests.set(ARENA_ID, nest);
    currentNest = nest;
    currentNestMesh = buildNestMesh(nest);

    let snapshot = null;
    try { snapshot = window.DenNestSystem?.debugSnapshot?.() || null; }
    catch (error) {
      window.__farmLog?.(`[dev-arena-nest] initial nest sync failed: ${error?.stack || error}`, 'error');
    }

    const label = denDeps.ITEM_DEFS?.[itemKey]?.label || itemKey;
    const kindLabel = nest.liveBirth ? 'baby' : 'egg';
    window.__farmLog?.(`[dev-arena-nest] spawned ${label} nest at ${col},${row} with ${DEFAULT_CLUTCH} ${kindLabel}s; rendered=${snapshot?.renderedContents ?? 'pending'}`, 'wildlife');
    toast(`Spawned ${label} nest (${DEFAULT_CLUTCH} ${kindLabel}${DEFAULT_CLUTCH === 1 ? '' : 's'}).`, true);
    refreshStatus();
    return nest;
  }

  function availableNestItems() {
    const defs = Object.values(window.SCRATCHBONES_CONFIG?.game?.wildlife?.denMothers || {});
    const keys = [];
    for (const def of defs) {
      const key = def?.nestItemKey;
      if (key && !keys.includes(key)) keys.push(key);
    }
    for (const fallback of ['puktukBaby', 'uumkaoiiEgg']) {
      if ((denDeps?.ITEM_DEFS?.[fallback] || window.SCRATCHBONES_CONFIG?.game?.livestock?.itemKinds?.[fallback]) && !keys.includes(fallback)) keys.push(fallback);
    }
    return keys;
  }

  function refreshStatus() {
    const status = document.getElementById('devArenaNestStatus');
    if (!status) return;
    if (!currentNest) {
      status.textContent = 'No test nest spawned.';
      return;
    }
    let snapshot = null;
    try { snapshot = window.DenNestSystem?.debugSnapshot?.() || null; } catch (_) {}
    const label = denDeps?.ITEM_DEFS?.[currentNest.itemKey]?.label || currentNest.itemKey;
    status.textContent = `${label}: remaining ${currentNest.remaining}; visible ${snapshot?.renderedContents ?? 'pending'}; last error ${snapshot?.lastError || 'none'}.`;
  }

  function ensureControls() {
    const panel = document.getElementById('devSpawnPanel');
    if (!panel || document.getElementById('devArenaNestSpawnerSection')) return;

    const section = document.createElement('div');
    section.className = 'fed-section';
    section.id = 'devArenaNestSpawnerSection';
    section.innerHTML = `
      <div class="fed-label">Nest Test Spawner — uses the real den nest record, renderer, and take interaction</div>
      <div class="fed-grid" id="devArenaNestSpawnGrid"></div>
      <div class="fed-actions">
        <button type="button" class="fed-action-btn fed-danger" id="devArenaNestClearBtn">🧹 Clear Test Nest</button>
      </div>
      <div class="fed-label" id="devArenaNestStatus">No test nest spawned.</div>`;
    panel.appendChild(section);

    const grid = section.querySelector('#devArenaNestSpawnGrid');
    for (const itemKey of availableNestItems()) {
      const def = denDeps?.ITEM_DEFS?.[itemKey] || {};
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'fed-btn';
      button.dataset.nestItem = itemKey;
      button.textContent = `${liveBirthForItem(itemKey) ? '🍼' : '🥚'} ${def.label || itemKey}`;
      grid?.appendChild(button);
    }

    grid?.addEventListener('click', event => {
      const button = event.target.closest('[data-nest-item]');
      if (button) spawnNest(button.dataset.nestItem);
    });
    section.querySelector('#devArenaNestClearBtn')?.addEventListener('click', () => clearNest());
    refreshStatus();
  }

  function patchDenNestSystem(api) {
    if (!api?.init || api.__devArenaNestSpawnerPatched) return api;
    const originalInit = api.init;
    api.init = function devArenaNestAwareInit(injectedDeps) {
      denDeps = injectedDeps;
      const result = originalInit.call(this, injectedDeps);
      queueMicrotask(() => { ensureControls(); refreshStatus(); });
      return result;
    };
    api.__devArenaNestSpawnerPatched = true;
    return api;
  }

  function patchDevSpawner(api) {
    if (!api || api.__devArenaNestSpawnerPatched) return api;
    if (typeof api.init === 'function') {
      const originalInit = api.init;
      api.init = function devArenaNestSpawnerInit(injectedDeps) {
        devDeps = injectedDeps;
        const result = originalInit.call(this, injectedDeps);
        queueMicrotask(ensureControls);
        return result;
      };
    }
    if (typeof api.toggle === 'function') {
      const originalToggle = api.toggle;
      api.toggle = function devArenaNestSpawnerToggle(...args) {
        ensureControls();
        const result = originalToggle.apply(this, args);
        refreshStatus();
        return result;
      };
    }
    api.__devArenaNestSpawnerPatched = true;
    return api;
  }

  function patchGlobal(name, patcher) {
    const current = window[name];
    if (current) {
      patcher(current);
      return;
    }
    const descriptor = Object.getOwnPropertyDescriptor(window, name);
    if (descriptor && descriptor.configurable === false) return;

    // Several gameplay modules observe late-created globals such as DevSpawner.
    // Never replace their accessor: chain it, then patch the value that the prior
    // getter/setter resolved. Replacing that chain used to disconnect
    // PlayerBodyAttachmentBridge, leaving procedural hands without toolHolder deps.
    const previousGet = descriptor?.get;
    const previousSet = descriptor?.set;
    let stored = descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')
      ? descriptor.value
      : undefined;

    Object.defineProperty(window, name, {
      configurable: true,
      enumerable: descriptor?.enumerable ?? true,
      get() {
        return previousGet ? previousGet.call(window) : stored;
      },
      set(value) {
        if (previousSet) previousSet.call(window, value);
        else stored = value;
        const resolved = previousGet ? previousGet.call(window) : stored;
        patcher(resolved || value);
      },
    });
  }

  patchGlobal('DenNestSystem', patchDenNestSystem);
  patchGlobal('DevSpawner', patchDevSpawner);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { ensureControls(); refreshStatus(); }, { once: true });
  } else {
    queueMicrotask(() => { ensureControls(); refreshStatus(); });
  }

  window.DevArenaNestSpawner = {
    version: VERSION,
    spawnNest,
    clearNest,
    availableNestItems,
    debugSnapshot: () => ({
      arena: ARENA_ID,
      initialized: !!denDeps,
      currentItemKey: currentNest?.itemKey || null,
      currentRemaining: currentNest?.remaining ?? null,
      hasNestMesh: !!currentNestMesh,
      nestRenderer: (() => {
        try { return window.DenNestSystem?.debugSnapshot?.() || null; }
        catch (error) { return { error: String(error?.message || error) }; }
      })(),
    }),
  };
})();
