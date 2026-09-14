(() => {
  'use strict';

  const LOCALE_ID = 'locale_den_mother_nest';
  const LOCALE_URL = `config/locales/${LOCALE_ID}.json`;
  const DEFAULT_TRANSFORM = Object.freeze({ x:0, y:0, z:0, rx:0, ry:0, rz:0, sx:1, sy:1, sz:1 });
  const DEG = Math.PI / 180;
  const AUTHORED_NEST_KEYS = new Set(['nest', 'nestBranch']);
  let locale = null;
  let encounter = null;
  let denDeps = null;
  let wildlifeDeps = null;
  let installed = false;
  let wildlifeInstalled = false;
  let lastError = null;
  let lastAppliedArea = null;
  let lastMotherApplied = null;
  let lastFurnitureUpgrade = null;
  let branchSyncAt = 0;
  const rootState = new WeakMap();
  const motherState = new WeakMap();
  const nestSequences = new WeakMap();
  const cavernFurnitureState = new WeakMap();

  const finite = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function normalizedTransform(raw) {
    const t = raw || {};
    return {
      x:finite(t.x), y:finite(t.y), z:finite(t.z),
      rx:finite(t.rx), ry:finite(t.ry), rz:finite(t.rz),
      sx:finite(t.sx,1) || 1, sy:finite(t.sy,1) || 1, sz:finite(t.sz,1) || 1,
    };
  }
  function parseLocale(data) {
    const den = data?.meta?.denEncounter;
    if (!data || data.schema !== 'hobunji_locale.v1' || !den || !Array.isArray(den.clutchSpawns)) {
      throw new Error('Den locale is missing meta.denEncounter.clutchSpawns');
    }
    locale = data;
    encounter = {
      ...clone(den),
      nest: { ...(clone(den.nest) || {}), transform: normalizedTransform(den.nest?.transform) },
      motherSpawn: { ...(clone(den.motherSpawn) || {}), transform: normalizedTransform(den.motherSpawn?.transform) },
      clutchSpawns: den.clutchSpawns.map((entry, index) => ({
        ...(clone(entry) || {}),
        id: entry?.id || `clutch_${index + 1}`,
        transform: normalizedTransform(entry?.transform),
      })),
    };
    return encounter;
  }

  function localOverrideLocale() {
    try {
      if (window.LocalDBOverrides?.getSourceMode?.() !== 'local') return null;
      const override = window.LocalDBOverrides.getOverride?.('locales');
      const locales = Array.isArray(override) ? override : override?.locales;
      return Array.isArray(locales) ? locales.find(item => item?.id === LOCALE_ID) || null : null;
    } catch (_) { return null; }
  }
  function loadLocaleDocument() {
    const local = localOverrideLocale();
    if (local) return Promise.resolve(clone(local));
    return fetch(LOCALE_URL).then(response => {
      if (!response.ok) throw new Error(`Den locale HTTP ${response.status}`);
      return response.json();
    });
  }

  const ready = loadLocaleDocument()
    .then(parseLocale)
    .catch(error => {
      lastError = String(error?.message || error);
      console.warn('[den-locale] locale load failed; legacy clutch layout remains active:', error);
      return null;
    });

  function preloadAuthoredNestFurniture() {
    if (!window.AuthoredFurniture?.load) return;
    window.AuthoredFurniture.load('nest').catch?.(() => null);
    window.AuthoredFurniture.load('nestBranch').catch?.(() => null);
  }
  preloadAuthoredNestFurniture();

  function decorateNest(nest) {
    if (!nest || !encounter) return nest;
    nest.localeId = locale.id;
    nest.nestFurnitureKey = encounter.nest?.furnitureKey || 'nest';
    nest.nestFurnitureTransform = { ...encounter.nest.transform };
    nest.clutchSpawnTransforms = encounter.clutchSpawns.map(point => ({ id:point.id, ...point.transform }));
    nest.denMotherSpawnTransform = { ...encounter.motherSpawn.transform };
    return nest;
  }

  function installNestMap(map) {
    if (!map || map.__hobunjiDenLocaleWrapped) return;
    const originalSet = map.set.bind(map);
    map.set = function denLocaleMapSet(key, value) {
      return originalSet(key, decorateNest(value));
    };
    Object.defineProperty(map, '__hobunjiDenLocaleWrapped', { value:true, configurable:true });
    for (const nest of map.values()) decorateNest(nest);
  }

  function contentRoots(scene) {
    if (!scene) return [];
    const roots = [];
    for (const child of scene.children || []) {
      if (/^nest_.+_egg$/.test(child?.name || '') || /^nest_sleep_/.test(child?.name || '')) roots.push(child);
    }
    return roots;
  }

  function sequenceFor(nest, roots) {
    let seq = nestSequences.get(nest);
    if (!seq) { seq = { roots:[], indices:new WeakMap() }; nestSequences.set(nest, seq); }
    for (const root of roots) {
      if (seq.indices.has(root)) continue;
      const index = seq.roots.length;
      seq.roots.push(root);
      seq.indices.set(root, index);
    }
    return seq;
  }

  function nestCenter(nest) {
    return { x: nest.col + nest.w * 0.5, z: nest.row + nest.h * 0.5 };
  }
  function nestFloorY(nest) {
    if (Number.isFinite(Number(nest?.floorY))) return Number(nest.floorY);
    const center = nestCenter(nest);
    const surface = denDeps?.activeSurfaceYAtWorld?.(center.x, center.z);
    return Number.isFinite(Number(surface)) ? Number(surface) : 0;
  }

  function applyRootTransform(root, nest, authored) {
    if (!root || !nest || !authored) return;
    const floorY = nestFloorY(nest);
    let base = rootState.get(root);
    if (!base) {
      base = { lift:root.position.y - floorY, scale:root.scale.clone() };
      rootState.set(root, base);
    }
    const t = normalizedTransform(authored);
    const center = nestCenter(nest);
    root.position.set(center.x + t.x, floorY + base.lift + t.y, center.z + t.z);
    root.rotation.set(t.rx * DEG, t.ry * DEG, t.rz * DEG, 'YXZ');
    root.scale.set(base.scale.x * t.sx, base.scale.y * t.sy, base.scale.z * t.sz);
    root.updateMatrixWorld?.(true);
  }

  function findCurrentDenMother(area) {
    const hostiles = wildlifeDeps?.hostileObjects;
    if (!hostiles) return null;
    for (const creature of hostiles) {
      if (creature?.isDenMother && creature?.areaId === area && creature?.health !== 0) return creature;
    }
    return null;
  }
  function applyMotherTransform(mother, nest) {
    if (!mother || !nest?.denMotherSpawnTransform || !denDeps?.TILE) return false;
    const t = normalizedTransform(nest.denMotherSpawnTransform);
    const center = nestCenter(nest);
    let state = motherState.get(mother);
    const group = mother.avatarRef?.group;
    if (!state) {
      state = {
        groundLift: Number(mother.groundLift ?? mother.halfHeight) || 0,
        scale: group?.scale?.clone?.() || null,
      };
      motherState.set(mother, state);
    }
    mother.x = (center.x + t.x) * denDeps.TILE;
    mother.y = (center.z + t.z) * denDeps.TILE;
    mother.homeX = mother.x;
    mother.homeY = mother.y;
    mother.groundLift = state.groundLift + t.y;
    const ry = t.ry * DEG;
    mother.groupRot = ry;
    mother.pngRot = ry;
    mother.targetRot = ry;
    if (group) {
      group.rotation.x = t.rx * DEG;
      group.rotation.y = ry;
      group.rotation.z = t.rz * DEG;
      if (state.scale) group.scale.set(state.scale.x * t.sx, state.scale.y * t.sy, state.scale.z * t.sz);
      group.updateMatrixWorld?.(true);
    }
    lastMotherApplied = { areaId:mother.areaId || null, x:t.x, y:t.y, z:t.z, ry:t.ry };
    return true;
  }

  function disposeObject(root) {
    if (!root) return;
    root.parent?.remove?.(root);
    root.traverse?.(child => {
      child.geometry?.dispose?.();
      for (const material of (Array.isArray(child.material) ? child.material : [child.material]).filter(Boolean)) material.dispose?.();
    });
  }
  function isLegacyCavernNestMarker(child, nest) {
    if (!child?.isMesh || !child.geometry?.parameters || !child.material?.color) return false;
    const p = child.geometry.parameters;
    const center = nestCenter(nest);
    return Math.abs(Number(p.width) - 2) < .001
      && Math.abs(Number(p.height) - .12) < .001
      && Math.abs(Number(p.depth) - 2) < .001
      && child.material.color.getHex?.() === 0x3a2a1a
      && Math.abs(child.position.x - center.x) < .01
      && Math.abs(child.position.z - center.z) < .01;
  }
  function removeLegacyCavernMarker(scene, nest) {
    const marker = (scene?.children || []).find(child => isLegacyCavernNestMarker(child, nest));
    if (!marker) return false;
    disposeObject(marker);
    return true;
  }
  function applyNestFurnitureTransform(group, nest) {
    if (!group || !nest) return;
    const t = normalizedTransform(nest.nestFurnitureTransform || encounter?.nest?.transform);
    const center = nestCenter(nest);
    group.position.set(center.x + t.x, nestFloorY(nest) + t.y, center.z + t.z);
    group.rotation.set(t.rx * DEG, t.ry * DEG, t.rz * DEG, 'YXZ');
    group.scale.set(t.sx, t.sy, t.sz);
    group.updateMatrixWorld?.(true);
  }
  function ensureCavernNestFurniture(nest, scene) {
    if (!nest || !scene || !encounter || !window.AuthoredFurniture) return;
    let state = cavernFurnitureState.get(nest);
    if (state?.scene === scene && state.group?.parent === scene) {
      applyNestFurnitureTransform(state.group, nest);
      return;
    }
    if (state?.building) return;
    state = { scene, group:null, building:true };
    cavernFurnitureState.set(nest, state);
    const key = nest.nestFurnitureKey || encounter.nest?.furnitureKey || 'nest';
    Promise.resolve(window.AuthoredFurniture.load?.(key)).then(data => {
      if (!data || cavernFurnitureState.get(nest) !== state) return;
      if (state.scene !== scene) return;
      removeLegacyCavernMarker(scene, nest);
      const group = window.AuthoredFurniture.buildGroup(data, 0xc9a227);
      group.name = `den_locale_furniture_${key}`;
      group.userData.denLocaleFurniture = true;
      group.userData.denLocaleId = locale?.id || LOCALE_ID;
      scene.add(group);
      state.group = group;
      state.building = false;
      applyNestFurnitureTransform(group, nest);
      lastFurnitureUpgrade = `cavern:${key}`;
    }).catch(error => {
      state.building = false;
      lastError = String(error?.message || error);
      console.warn('[den-locale] authored cavern nest furniture failed:', error);
    });
  }

  function authoredDecorativeFurniture(original, col, row, furnitureKey, targetScene, area, rotYDeg = 0) {
    if (!AUTHORED_NEST_KEYS.has(furnitureKey) || !window.AuthoredFurniture?.peek) {
      return original?.(col, row, furnitureKey, targetScene, area, rotYDeg) || null;
    }
    const data = window.AuthoredFurniture.peek(furnitureKey);
    if (!data) return original?.(col, row, furnitureKey, targetScene, area, rotYDeg) || null;
    const w = Math.max(.01, Number(data.footprint?.w) || 1);
    const d = Math.max(.01, Number(data.footprint?.d) || 1);
    const group = window.AuthoredFurniture.buildGroup(data, 0xc9a227);
    group.name = `den_locale_furniture_${furnitureKey}`;
    group.userData.denLocaleFurniture = true;
    group.position.set(Number(col) + w * .5, 0, Number(row) + d * .5);
    group.rotation.y = finite(rotYDeg) * DEG;
    targetScene?.add?.(group);
    lastFurnitureUpgrade = `spawn:${furnitureKey}`;
    return { mesh:group, light:null, sfxSource:null, authored:true };
  }

  function upgradeBranchNestFurniture() {
    const now = performance.now?.() || Date.now();
    if (now < branchSyncAt) return;
    branchSyncAt = now + 500;
    const area = denDeps?.getCurrentArea?.();
    if (!area || !window.AuthoredFurniture?.peek?.('nestBranch')) return;
    const branches = window.ClimbSystem?.debugBranchesFor?.(area) || [];
    const data = window.AuthoredFurniture.peek('nestBranch');
    for (const branch of branches) {
      const nest = branch?.nest;
      const prior = nest?.mesh;
      if (!nest || !prior?.parent || prior.userData?.authoredFurnitureKey === 'nestBranch') continue;
      const parent = prior.parent;
      const group = window.AuthoredFurniture.buildGroup(data, 0xc9a227);
      group.name = 'den_locale_furniture_nestBranch';
      group.userData.denLocaleFurniture = true;
      group.position.copy(prior.position);
      group.rotation.copy(prior.rotation);
      group.scale.copy(prior.scale);
      parent.add(group);
      parent.remove(prior);
      nest.mesh = group;
      disposeObject(prior);
      lastFurnitureUpgrade = `branch:${area}`;
    }
  }

  function syncCurrentDen() {
    if (!denDeps || !encounter) { upgradeBranchNestFurniture(); return; }
    upgradeBranchNestFurniture();
    const area = denDeps.getCurrentArea?.();
    const nest = denDeps._denNests?.get?.(area);
    const scene = denDeps._buildingScenes?.get?.(area)?.scene;
    if (!nest || !scene) return;
    decorateNest(nest);
    ensureCavernNestFurniture(nest, scene);
    const roots = contentRoots(scene);
    const seq = sequenceFor(nest, roots);
    for (const root of roots) {
      const index = seq.indices.get(root);
      const authored = nest.clutchSpawnTransforms?.[index]
        || nest.clutchSpawnTransforms?.[index % Math.max(1, nest.clutchSpawnTransforms.length)];
      if (authored) applyRootTransform(root, nest, authored);
    }
    applyMotherTransform(findCurrentDenMother(area), nest);
    lastAppliedArea = area;
  }

  function installWildlifeBridge() {
    if (wildlifeInstalled || !window.WildlifeSpawn?.init) return false;
    wildlifeInstalled = true;
    const api = window.WildlifeSpawn;
    const originalInit = api.init.bind(api);
    api.init = function denLocaleWildlifeInit(injectedDeps) {
      wildlifeDeps = injectedDeps;
      preloadAuthoredNestFurniture();
      if (injectedDeps?.makeDecorativeFurnitureMesh && !injectedDeps.makeDecorativeFurnitureMesh.__denLocaleAuthoredNestBridge) {
        const originalFurniture = injectedDeps.makeDecorativeFurnitureMesh.bind(injectedDeps);
        const wrapped = (col, row, key, targetScene, area, rotYDeg) => authoredDecorativeFurniture(originalFurniture, col, row, key, targetScene, area, rotYDeg);
        wrapped.__denLocaleAuthoredNestBridge = true;
        injectedDeps.makeDecorativeFurnitureMesh = wrapped;
      }
      return originalInit(injectedDeps);
    };
    return true;
  }

  function installDenNestBridge() {
    if (installed || !window.DenNestSystem?.init) return false;
    installed = true;
    const api = window.DenNestSystem;
    const originalInit = api.init.bind(api);
    const originalUpdate = api.updateNestInteraction?.bind(api);
    api.init = function denLocaleInit(injectedDeps) {
      denDeps = injectedDeps;
      installNestMap(injectedDeps?._denNests);
      ready.then(() => {
        installNestMap(injectedDeps?._denNests);
        for (const nest of injectedDeps?._denNests?.values?.() || []) decorateNest(nest);
        syncCurrentDen();
      });
      return originalInit(injectedDeps);
    };
    if (originalUpdate) {
      api.updateNestInteraction = function denLocaleUpdate(dt) {
        const result = originalUpdate(dt);
        // Run after DenNestSystem's own layout pass so authored transforms are
        // authoritative for the frame rather than immediately overwritten.
        syncCurrentDen();
        return result;
      };
    }
    return true;
  }

  installWildlifeBridge();
  installDenNestBridge();

  window.DenLocaleRuntime = {
    version: 2,
    ready,
    locale: () => locale,
    encounter: () => encounter,
    decorateNest,
    syncCurrentDen,
    debugSnapshot: () => ({
      installed,
      wildlifeInstalled,
      loaded: !!encounter,
      source: localOverrideLocale() ? 'local-override' : 'repo',
      localeId: locale?.id || null,
      clutchSpawnCount: encounter?.clutchSpawns?.length || 0,
      nestFurnitureKey: encounter?.nest?.furnitureKey || null,
      nestTransform: encounter?.nest?.transform || null,
      motherSpawn: encounter?.motherSpawn?.transform || null,
      lastMotherApplied,
      lastFurnitureUpgrade,
      lastAppliedArea,
      lastError,
    }),
  };
})();
