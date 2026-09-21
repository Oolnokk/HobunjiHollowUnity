(() => {
  'use strict';

  if (window.RepoPatternLibrary) return;

  const MODULE_URL = document.currentScript?.src || '';
  const DOCS_BASE = MODULE_URL ? new URL('../', MODULE_URL).href : './';
  const INDEX_PATH = 'config/patterns/index.json';
  let loadPromise = null;
  let entries = [];
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

  async function load() {
    if (loadPromise) return loadPromise;
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
    return loadPromise;
  }

  function listCached() {
    return entries.map(entry => ({
      id: entry.id,
      label: entry.label,
      name: entry.label,
      source: 'repo',
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

  function clearCache() {
    loadPromise = null;
    entries = [];
    resolvedById.clear();
    editableById.clear();
  }

  window.RepoPatternLibrary = Object.freeze({
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