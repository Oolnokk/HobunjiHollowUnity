(() => {
  'use strict';

  const LOCALE_URL = 'config/locales/locale_den_mother_nest.json';
  const DEFAULT_TRANSFORM = Object.freeze({ x:0, y:0, z:0, rx:0, ry:0, rz:0, sx:1, sy:1, sz:1 });
  let locale = null;
  let encounter = null;
  let denDeps = null;
  let installed = false;
  let lastError = null;
  let lastAppliedArea = null;
  const rootState = new WeakMap();
  const nestSequences = new WeakMap();

  const finite = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
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
      ...den,
      nest: { ...(den.nest || {}), transform: normalizedTransform(den.nest?.transform) },
      motherSpawn: { ...(den.motherSpawn || {}), transform: normalizedTransform(den.motherSpawn?.transform) },
      clutchSpawns: den.clutchSpawns.map((entry, index) => ({
        id: entry?.id || `clutch_${index + 1}`,
        transform: normalizedTransform(entry?.transform),
      })),
    };
    return encounter;
  }

  const ready = fetch(LOCALE_URL)
    .then(response => {
      if (!response.ok) throw new Error(`Den locale HTTP ${response.status}`);
      return response.json();
    })
    .then(parseLocale)
    .catch(error => {
      lastError = String(error?.message || error);
      console.warn('[den-locale] locale load failed; legacy clutch layout remains active:', error);
      return null;
    });

  function decorateNest(nest) {
    if (!nest || !encounter) return nest;
    nest.localeId = locale.id;
    nest.nestFurnitureKey = encounter.nest?.furnitureKey || 'nest';
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

  function applyRootTransform(root, nest, authored) {
    if (!root || !nest || !authored) return;
    let base = rootState.get(root);
    if (!base) {
      const floorY = Number.isFinite(nest.floorY) ? nest.floorY : 0;
      base = {
        lift: root.position.y - floorY,
        scale: root.scale.clone(),
      };
      rootState.set(root, base);
    }
    const t = normalizedTransform(authored);
    const centerX = (nest.col + nest.w * 0.5) * denDeps.TILE;
    const centerZ = (nest.row + nest.h * 0.5) * denDeps.TILE;
    const floorY = Number.isFinite(nest.floorY) ? nest.floorY : 0;
    root.position.set(centerX + t.x, floorY + base.lift + t.y, centerZ + t.z);
    root.rotation.set(t.rx * Math.PI / 180, t.ry * Math.PI / 180, t.rz * Math.PI / 180, 'YXZ');
    root.scale.set(base.scale.x * t.sx, base.scale.y * t.sy, base.scale.z * t.sz);
    root.updateMatrixWorld?.(true);
  }

  function syncCurrentDen() {
    if (!denDeps || !encounter) return;
    const area = denDeps.getCurrentArea?.();
    const nest = denDeps._denNests?.get?.(area);
    const scene = denDeps._buildingScenes?.get?.(area)?.scene;
    if (!nest || !scene) return;
    decorateNest(nest);
    const roots = contentRoots(scene);
    const seq = sequenceFor(nest, roots);
    for (const root of roots) {
      const index = seq.indices.get(root);
      const authored = nest.clutchSpawnTransforms?.[index] || nest.clutchSpawnTransforms?.[index % Math.max(1, nest.clutchSpawnTransforms.length)];
      if (authored) applyRootTransform(root, nest, authored);
    }
    lastAppliedArea = area;
  }

  function installDenNestBridge() {
    if (installed || !window.DenNestSystem?.init) return;
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
        syncCurrentDen();
        return originalUpdate(dt);
      };
    }
  }

  installDenNestBridge();

  window.DenLocaleRuntime = {
    version: 1,
    ready,
    locale: () => locale,
    encounter: () => encounter,
    decorateNest,
    syncCurrentDen,
    debugSnapshot: () => ({
      installed,
      loaded: !!encounter,
      localeId: locale?.id || null,
      clutchSpawnCount: encounter?.clutchSpawns?.length || 0,
      nestFurnitureKey: encounter?.nest?.furnitureKey || null,
      motherSpawn: encounter?.motherSpawn?.transform || null,
      lastAppliedArea,
      lastError,
    }),
  };
})();
