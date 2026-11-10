// Geometry-quality asset profiles select PRE-BAKED GLBs; never remesh in the game loop.
(function (root, factory) {
  const api = factory(root || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeometryQuality = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  const SCHEMA = 'hobunji_geometry_quality.v1';
  const TIERS = Object.freeze(['high', 'medium', 'low']);
  const STORAGE_TIER = 'hobunjiGeometryDetailTier.v1';
  const STORAGE_PROFILES = 'hobunjiGeometryQualityProfiles.v1';
  const CONFIG_URL = 'config/geometry-quality-presets.json';
  const MAX_PROFILES = 128;
  const MAX_IMPORT_BYTES = 300000;
  const VALID_MODEL_PATH = /^assets\/models\/[A-Za-z0-9_.\/-]+\.glb$/i;
  const templates = new Map(); // Canonical model source path -> selected baked variants.
  const diagnostics = { fallbackCount: 0, lastFallback: '', lastError: '', loaded: false, prebakedLoads: 0, originalLoads: 0 }; // Mobile Settings diagnostics.
  let tier = readTier(); // Player's persisted geometry detail level.
  let uiMounted = false; // Only installs the Performance settings listeners once.
  let shippedProfiles = []; // Packaged profiles, restored after clearing local imports.
  let loaderInstalled = false; // One global GLTFLoader wrapper covers authored models without duplicating per-system loading code.

  function readTier() {
    try { const value = root.localStorage?.getItem(STORAGE_TIER); return TIERS.includes(value) ? value : 'high'; }
    catch (_) { return 'high'; }
  }
  function modelPath(value) {
    if (typeof value !== 'string' || !VALID_MODEL_PATH.test(value) || value.includes('..') || value.includes('//')) return null;
    return value;
  }
  function normalizeProfile(value) {
    if (!value || typeof value !== 'object') throw new Error('Quality profile must be an object.');
    const source = modelPath(value.source);
    if (!source) throw new Error('A profile requires a safe source GLB path under assets/models/.');
    const variants = {};
    for (const name of TIERS) {
      const variant = value.variants?.[name];
      if (variant == null) continue;
      const path = modelPath(typeof variant === 'string' ? variant : variant.asset);
      if (!path) throw new Error('Invalid ' + name + ' variant GLB path for ' + source);
      variants[name] = path;
    }
    const metadata = value.metadata && typeof value.metadata === 'object'
      ? JSON.parse(JSON.stringify(value.metadata)) : {};
    return { source, variants, metadata };
  }
  function validate(data) {
    if (!data || data.schema !== SCHEMA) throw new Error('Expected schema ' + SCHEMA);
    const raw = Array.isArray(data.profiles) ? data.profiles : data.profile ? [data.profile] : null;
    if (!raw || !raw.length || raw.length > MAX_PROFILES) throw new Error('Expected between 1 and ' + MAX_PROFILES + ' quality profiles.');
    const seen = new Set();
    return raw.map(item => {
      const profile = normalizeProfile(item);
      if (seen.has(profile.source)) throw new Error('Duplicate quality profile: ' + profile.source);
      seen.add(profile.source);
      return profile;
    });
  }
  function combine(previous, next) {
    // Combining per-tier exports from the workshop must not discard earlier tiers.
    return {
      source: next.source,
      variants: { ...(previous?.variants || {}), ...next.variants },
      metadata: { ...(previous?.metadata || {}), ...(next.metadata || {}) },
    };
  }
  function merge(profiles) {
    for (const profile of profiles) templates.set(profile.source, combine(templates.get(profile.source), profile));
  }
  function readLocalProfiles() {
    try {
      const raw = root.localStorage?.getItem(STORAGE_PROFILES);
      return raw ? validate(JSON.parse(raw)) : [];
    } catch (error) { diagnostics.lastError = 'Local profiles: ' + String(error?.message || error); return []; }
  }
  const localProfiles = readLocalProfiles(); // Imported profiles override shipped entries across game sessions.
  merge(localProfiles);

  function setTier(value) {
    if (!TIERS.includes(value)) throw new Error('Unknown geometry quality: ' + value);
    tier = value;
    try { root.localStorage?.setItem(STORAGE_TIER, tier); } catch (_) {}
    updateStatus();
    return tier;
  }
  function getTier() { return tier; }
  function resolvePath(source, requestedTier = tier) {
    if (!modelPath(source) || !TIERS.includes(requestedTier)) return source;
    // When the global optimized mode is on, use baked low-detail variants
    // FIRST even if an older save still has 'High' selected. Explicit tier
    // arguments continue to honor the exact tier the caller requested.
    const globalMode = arguments.length < 2 && root.GeometryAutoLOD?.isEnabled?.();
    const effectiveTier = globalMode ? 'low' : requestedTier;
    return templates.get(source)?.variants?.[effectiveTier] || source;
  }
  function markLoadedGLB(result, wasOptimized = false) {
    // All authored GLBs (even missing-LOD fallbacks) must be distinguished
    // from procedurally-generated geometry. Only the latter is simplified
    // in an idle callback; authored meshes use precomputed files exclusively.
    const object = result?.scene || result?.scenes?.[0] || result;
    if (!object?.traverse) return result;
    if (!object.userData?.geometryQualityGLBCounted) {
      object.userData = { ...(object.userData || {}), geometryQualityGLBCounted: true };
      if (wasOptimized) diagnostics.prebakedLoads++;
      else diagnostics.originalLoads++;
      updateStatus(); // A mobile-visible count differentiates baked GLBs from session-simplified procedural geometry.
    }
    object.traverse(node => {
      if (!node.isMesh) return;
      node.userData = { ...(node.userData || {}), geometryQualityGLBSource: true };
      if (node.geometry) {
        node.geometry.userData = { ...(node.geometry.userData || {}), geometryQualityGLBSource: true,
          geometryQualityPrebakedVariant: !!wasOptimized };
      }
    });
    return result;
  }
  function installGlobalLoader() {
    if (loaderInstalled || !root.document?.getElementById?.('settingGeometryDetail')) return false;
    const klass = root.THREE?.GLTFLoader;
    if (!klass?.prototype?.load) return false;
    const previous = klass.prototype.load; // Preserve the existing loader/progress/decoder pipeline unchanged.
    klass.prototype.load = function qualityBakedGLBLoad(path, onLoad, onProgress, onError) {
      let completed = false; // A failing optimized URL must call the original callback at most once.
      const success = (gltf, optimized) => {
        if (completed) return;
        completed = true;
        onLoad?.(markLoadedGLB(gltf, optimized));
      };
      const failure = (error, preferred) => {
        if (completed) return;
        if (preferred === path) { completed = true; onError?.(error); return; }
        diagnostics.fallbackCount++;
        diagnostics.lastFallback = path + ' ← ' + preferred;
        diagnostics.lastError = String(error?.message || error);
        updateStatus();
        try {
          previous.call(this, path, gltf => success(gltf, false), onProgress, originalError => {
            if (completed) return;
            completed = true;
            onError?.(originalError);
          });
        } catch (originalError) {
          completed = true;
          onError?.(originalError);
        }
      };
      const start = () => {
        const preferred = resolvePath(path); // Re-evaluate AFTER shipped manifest is available.
        try {
          return previous.call(this, preferred, gltf => success(gltf, preferred !== path),
            onProgress, error => failure(error, preferred));
        } catch (error) { failure(error, preferred); return undefined; }
      };
      if (!diagnostics.loaded && modelPath(path)) {
        ready.then(start, error => failure(error, path)); // Wait once for packaged profiles, rather than race first model loads.
        return undefined;
      }
      return start();
    };
    loaderInstalled = true;
    updateStatus();
    return true;
  }
  async function loadWithFallback(source, loader) {
    if (typeof loader !== 'function') throw new Error('Quality loader requires a callback.');
    await ready;
    const candidate = resolvePath(source);
    if (candidate === source) return markLoadedGLB(await loader(source), false);
    try { return markLoadedGLB(await loader(candidate), candidate !== source); }
    catch (error) {
      diagnostics.fallbackCount++;
      diagnostics.lastFallback = source + ' ← ' + candidate;
      diagnostics.lastError = String(error?.message || error);
      updateStatus();
      return markLoadedGLB(await loader(source), false);
    }
  }
  function importProfiles(documentObject) {
    const incoming = validate(documentObject); // All-or-nothing validation before touching persistent settings.
    const merged = new Map(localProfiles.map(profile => [profile.source, profile]));
    for (const profile of incoming) merged.set(profile.source, combine(merged.get(profile.source), profile));
    if (merged.size > MAX_PROFILES) throw new Error('Quality profile limit exceeded.');
    const data = JSON.stringify({ schema: SCHEMA, profiles: [...merged.values()] });
    if (data.length > MAX_IMPORT_BYTES) throw new Error('Quality JSON exceeds storage budget.');
    root.localStorage?.setItem(STORAGE_PROFILES, data);
    localProfiles.length = 0;
    localProfiles.push(...merged.values());
    merge(incoming);
    diagnostics.lastError = '';
    updateStatus();
    return incoming.length;
  }
  function clearImported() {
    try { root.localStorage?.removeItem(STORAGE_PROFILES); } catch (_) {}
    localProfiles.length = 0;
    templates.clear();
    merge(shippedProfiles);
    diagnostics.lastError = '';
    updateStatus();
  }
  async function loadShipped() {
    if (typeof root.fetch !== 'function') { diagnostics.loaded = true; return; }
    try {
      const response = await root.fetch(CONFIG_URL);
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const data = await response.json();
      shippedProfiles = Array.isArray(data?.profiles) && !data.profiles.length && data.schema === SCHEMA
        ? [] : validate(data);
      templates.clear();
      merge(shippedProfiles);
      merge(localProfiles);
      diagnostics.lastError = '';
    } catch (error) {
      diagnostics.lastError = 'Packaged geometry profiles unavailable (' + String(error?.message || error) + '); using imported profiles/originals.';
    } finally {
      diagnostics.loaded = true;
      updateStatus();
    }
  }
  const ready = loadShipped(); // Initial GLB requests await this one-time quality manifest read.
  function snapshot() {
    return {
      tier, effectiveTier: root.GeometryAutoLOD?.isEnabled?.() ? 'low' : tier, loaderInstalled, loaded: diagnostics.loaded, profiles: templates.size, imported: localProfiles.length,
      prebakedLoads: diagnostics.prebakedLoads, originalLoads: diagnostics.originalLoads,
      fallbackCount: diagnostics.fallbackCount, lastFallback: diagnostics.lastFallback || null,
      lastError: diagnostics.lastError || null,
    };
  }
  function updateStatus() {
    const element = root.document?.getElementById?.('geometryQualityStatus');
    if (!element) return;
    element.textContent = (root.GeometryAutoLOD?.isEnabled?.() ? 'Global optimized (pre-baked Low variants preferred)' : tier + ' geometry') +
      ' · ' + templates.size + ' quality profiles · ' + diagnostics.prebakedLoads + ' baked models loaded · ' +
      diagnostics.fallbackCount + ' missing-variant fallbacks.' +
      (diagnostics.lastError ? ' ' + diagnostics.lastError : '') +
      ' Changes apply to newly loaded models; reload the game to update existing ones.';
  }
  function bindSettings() {
    if (uiMounted || !root.document) return;
    const select = root.document.getElementById('settingGeometryDetail');
    const input = root.document.getElementById('settingGeometryQualityImport');
    const clear = root.document.getElementById('settingGeometryQualityClear');
    if (!select || !input || !clear) return;
    uiMounted = true;
    select.value = tier;
    select.addEventListener('change', () => setTier(select.value));
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        if (file.size > MAX_IMPORT_BYTES || file.size < 2) throw new Error('Choose a JSON under ' + MAX_IMPORT_BYTES + ' bytes.');
        const count = importProfiles(JSON.parse(await file.text()));
        const status = root.document.getElementById('geometryQualityStatus');
        if (status) status.textContent = 'Imported ' + count + ' profile(s). Publish the referenced GLBs under assets/models/ and reload to activate.';
      } catch (error) { diagnostics.lastError = String(error?.message || error); updateStatus(); }
      finally { input.value = ''; }
    });
    clear.addEventListener('click', clearImported);
    installGlobalLoader();
    updateStatus();
  }
  if (root.document) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', bindSettings);
    else bindSettings();
  }
  return Object.freeze({
    SCHEMA, TIERS, CONFIG_URL, ready, modelPath, normalizeProfile, validate, importProfiles,
    clearImported, getTier, setTier, resolvePath, markLoadedGLB, installGlobalLoader, loadWithFallback, snapshot, bindSettings, refreshStatus: updateStatus,
  });
});
