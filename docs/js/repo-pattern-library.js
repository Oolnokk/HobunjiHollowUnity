(() => {
  'use strict';

  if (window.RepoPatternLibrary) return;

  const MODULE_URL = document.currentScript?.src || '';
  const DOCS_BASE = MODULE_URL ? new URL('../', MODULE_URL).href : './';
  const INDEX_PATH = 'config/patterns/index.json';
  const HARLYAO_RUIN_PATTERN_IDS = Object.freeze(['harlyao_glyph_entropy', 'harlyao_glyph_servitude', 'harlyao_glyph_ignorance']); // Used to restrict the current Harlyao ruin engraving pool without hiding other repo patterns.
  let loadPromise = null;
  let entries = [];
  let ruinPatternDecoratorInstalled = false; // Used to ensure the current-ruin pattern filter wraps FurniturePatternSurfaces only once.
  const resolvedById = new Map();
  const editableById = new Map();

  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const absoluteDocsUrl = path => new URL(String(path || ''), DOCS_BASE).href;

  async function fetchJson(path) {
    const response = await fetch(absoluteDocsUrl(path), { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status} loading ${path}`);
    return response.json();
  }

  function normalizeDefinition(raw, indexEntry) {
    if (!raw || typeof raw !== 'object') return null;
    const id = String(raw.id || indexEntry?.id || '').trim();
    if (!id) return null;
    const label = String(raw.name || raw.label || indexEntry?.name || id);
    const motifPng = String(raw.motifPng || raw.motif || raw.motifPath || '').trim();
    const settings = raw.settings && typeof raw.settings === 'object'
      ? clone(raw.settings)
      : raw.pattern && typeof raw.pattern === 'object'
        ? clone(raw.pattern)
        : {};
    delete settings.motifDataUrl;
    delete settings.customMotifId;
    delete settings.motifUrl;
    return {
      id,
      label,
      collectible: raw.collectible === true || indexEntry?.collectible === true, // Explicit opt-in keeps decorative clothing motifs out of ruin rewards.
      file: String(indexEntry?.file || ''),
      motifPng,
      pattern: {
        ...settings,
        repoPatternId: id,
        ...(motifPng ? { motifUrl: absoluteDocsUrl(motifPng) } : {}),
      },
      raw: clone(raw),
    };
  }

  function installHarlyaoRuinPatternPool() {
    const surfaces = window.FurniturePatternSurfaces; // Used to wrap the one production ruin-decoration entry point after that module has loaded.
    if (ruinPatternDecoratorInstalled || !surfaces?.decorateRuin) return ruinPatternDecoratorInstalled;
    const decorateRuin = surfaces.decorateRuin; // Used as the unchanged generic decorator beneath the Harlyao-only catalog scope.
    surfaces.decorateRuin = function (root, seed) {
      const allowedIds = new Set(HARLYAO_RUIN_PATTERN_IDS); // Used to admit only Entropy, Servitude and Ignorance while the current Harlyao ruin is decorated.
      const repoLibrary = window.RepoPatternLibrary; // Temporarily narrowed for the generic decorator's collectible-repo lookup.
      const playerLibrary = window.PatternLibrary; // Temporarily narrowed so built-in generic runes cannot leak into Harlyao ruins.
      const narrowedRepoLibrary = repoLibrary ? Object.freeze({ ...repoLibrary, listCached: () => repoLibrary.listCached().filter(entry => allowedIds.has(entry.id)) }) : repoLibrary; // Used only during this synchronous decoration pass.
      const narrowedPlayerLibrary = playerLibrary ? { ...playerLibrary, getCatalog: () => playerLibrary.getCatalog().filter(entry => allowedIds.has(entry.id)) } : playerLibrary; // Used only during this synchronous decoration pass.
      if (repoLibrary) window.RepoPatternLibrary = narrowedRepoLibrary;
      if (playerLibrary) window.PatternLibrary = narrowedPlayerLibrary;
      try {
        const result = decorateRuin.call(this, root, seed); // Used as the authoritative list of motifs actually assigned to this generated ruin.
        if (root?.userData) root.userData.ruinPatternPoolIds = [...HARLYAO_RUIN_PATTERN_IDS]; // Mobile/debug-visible metadata records the intended current-ruin pool.
        return result;
      } finally {
        if (repoLibrary) window.RepoPatternLibrary = repoLibrary;
        if (playerLibrary) window.PatternLibrary = playerLibrary;
      }
    };
    surfaces.decorateRuin.__harlyaoPatternPoolWrapped = true;
    ruinPatternDecoratorInstalled = true;
    return true;
  }

  async function load() {
    if (!loadPromise) {
      loadPromise = (async () => {
        const index = await fetchJson(INDEX_PATH).catch(() => ({ patterns: [] }));
        const list = Array.isArray(index?.patterns) ? index.patterns : [];
        const loaded = await Promise.all(list.map(async entry => {
          if (!entry?.file) return null;
          try {
            const raw = await fetchJson(entry.file);
            return normalizeDefinition(raw, entry);
          } catch (error) {
            console.warn('[RepoPatternLibrary] failed to load', entry.file, error);
            return null;
          }
        }));
        entries = loaded.filter(Boolean);
        resolvedById.clear();
        for (const entry of entries) resolvedById.set(entry.id, entry.pattern);
        return listCached();
      })();
    }
    const result = await loadPromise; // Used to preserve the existing load() return contract while retrying late decorator installation on every caller.
    installHarlyaoRuinPatternPool();
    return result;
  }

  function listCached() {
    return entries.map(entry => ({
      id: entry.id,
      label: entry.label,
      name: entry.label,
      source: 'repo',
      collectible: entry.collectible,
      removable: false,
      file: entry.file,
      motifPng: entry.motifPng,
    }));
  }

  function getCachedById(id) {
    const pattern = resolvedById.get(String(id || ''));
    return pattern ? clone(pattern) : null;
  }

  async function getById(id) {
    await load();
    return getCachedById(id);
  }

  function imageToDataUrl(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = image.naturalWidth || image.width || 1;
          canvas.height = image.naturalHeight || image.height || 1;
          canvas.getContext('2d').drawImage(image, 0, 0);
          resolve(canvas.toDataURL('image/png'));
        } catch (error) {
          reject(error);
        }
      };
      image.onerror = () => reject(new Error('Could not load motif PNG: ' + url));
      image.src = url;
    });
  }

  async function getEditableById(id) {
    const key = String(id || '');
    if (editableById.has(key)) return clone(editableById.get(key));
    const pattern = await getById(key);
    if (!pattern) return null;
    let editable = clone(pattern);
    if (!editable.motifDataUrl && editable.motifUrl) {
      const motifDataUrl = await imageToDataUrl(editable.motifUrl);
      editable = { ...editable, motifDataUrl };
    }
    editableById.set(key, editable);
    return clone(editable);
  }

  async function preloadEditable() {
    await load();
    await Promise.all(entries.map(entry => getEditableById(entry.id).catch(() => null)));
    return listCached();
  }

  function getCachedEditableById(id) {
    const pattern = editableById.get(String(id || ''));
    return pattern ? clone(pattern) : null;
  }

  async function exportDefinition(pattern, name = 'Untitled pattern', collectible = false) {
    const id = String(name).trim().toLowerCase().replace(/[’']/g,'').replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'') || 'untitled_pattern'; // Same repo naming convention as Pattern Editor.
    const settings = clone(pattern || {}); // Runtime references are excluded from portable settings.
    const motifDataUrl = settings.motifDataUrl || (settings.customMotifId && await window.MotifStore?.loadMotif?.(settings.customMotifId)) || (settings.motifUrl && await imageToDataUrl(settings.motifUrl)); // Export original motif ink, never the furniture's colored preview.
    if (!motifDataUrl) throw new Error('Choose or draw a pattern first.');
    for (const key of ['motifDataUrl','motifUrl','customMotifId','repoPatternId','repoPatternName']) delete settings[key];
    const motifFile = `motif_${id}.png`, jsonFile = `pattern_${id}.json`; // PNG and JSON names match the existing repository library contract.
    return {id, motifFile, jsonFile, motifDataUrl, json:{schema:'hobunji_pattern.v1',id,name,motifPng:`assets/patterns/${motifFile}`,collectible:!!collectible,settings}, indexEntry:{id,name,file:`config/patterns/${jsonFile}`,collectible:!!collectible}};
  }

  function clearCache() {
    loadPromise = null;
    entries = [];
    resolvedById.clear();
    editableById.clear();
  }

  window.RepoPatternLibrary = Object.freeze({
    exportDefinition,
    load,
    listCached,
    getById,
    getCachedById,
    getEditableById,
    getCachedEditableById,
    preloadEditable,
    absoluteDocsUrl,
    clearCache,
  });
})();