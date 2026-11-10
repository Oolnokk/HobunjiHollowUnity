// Index-backed cosmetic and art discovery for the mobile portrait spline author.
// Reuses docs/config/cosmetics/index.json and the exact speciesVariants + head layers
// used by portrait-utils.js. No duplicated authored option list is maintained here.
(() => {
  'use strict';

  const DOCS_ROOT = new URL('../../', document.baseURI); // Resolves ./assets/ URLs from cosmetic JSONs at docs/ rather than from the editor folder.
  const INDEX_URL = new URL('config/cosmetics/index.json', DOCS_ROOT); // The game's canonical cosmetic index.
  const PRESERVED_B = Object.freeze({ ax: -.0983, ay: -.0809, sx: 2.49, sy: 2.49 }); // Used only in the editor's 200px static reference; gameplay reads its live B preset.
  const LAYER_SIZE = 80; // Same logical portrait layer size as portrait-utils.js's default 200px canvas.
  const SLOTS = Object.freeze({ facialHair: 'Beards', hairSide: 'Right-side hair', hairSideL: 'Left-side hair' });

  const pretty = text => String(text || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
  function appearanceIdentity(entry) {
    const id = String(entry?.id || '');
    const parts = id.split('::');
    if (parts.length !== 3 || parts[0] !== 'appearance') return null;
    const match = /^(.+)_([MF])$/i.exec(parts[1]);
    if (!match) return null;
    return {
      species: match[1].toLowerCase().replace(/_/g, '-'),
      gender: match[2].toUpperCase() === 'F' ? 'female' : 'male',
      speciesLabel: match[1].replace(/_/g, '-'),
    };
  }

  function classifyStyle(config, entry) {
    const slot = String(config?.portraitSlot || config?.hairSlot || '').toLowerCase();
    if (slot === 'side-l' || slot === 'hairside-l' || slot === 'hairsidel') return 'hairSideL';
    if (slot === 'side' || slot === 'side-r' || slot === 'hairside') return 'hairSide';
    if (slot === 'facialhair' || slot === 'facial-hair') return 'facialHair';
    const name = [config?.meta?.name, config?.appearance?.originalId, entry?.id].join(' ').toLowerCase();
    const head = config?.parts?.head || {};
    const urls = [head?.image?.url, ...Object.values(head?.layers || {}).map(layer => layer?.image?.url)].join(' ').toLowerCase();
    if (/beard|moustache|mustache|stache|whisker|facialhair/.test(name + ' ' + urls)) return 'facialHair';
    return null; // Front/back-only styles are not yet compatible with a separate side-hair 3D rig.
  }

  function imageLayers(config, species, gender) {
    const variantKey = String(species) + '_' + String(gender);
    const variant = config?.speciesVariants?.[variantKey];
    const variantHead = variant?.parts?.head;
    const fallbackHead = config?.parts?.head;
    const head = (variantHead?.image || variantHead?.layers) ? variantHead : fallbackHead;
    if (!head) return [];
    const sources = head.layers ? Object.entries(head.layers) : head.image ? [['front', head]] : [];
    return sources.filter(([, layer]) => layer?.image?.url).map(([name, layer]) => ({
      name, url: layer.image.url,
      behindUrl: layer.behindImage?.url || layer.image.url, // Mirrors portrait renderer's ordinary same-art fallback where no rear variant is authored.
      rearAuthored: Boolean(layer.behindImage?.url),
      xform: layer.spriteStyle?.base?.xform?.head || layer.spriteStyle?.xform?.head || null,
    }));
  }

  function rigScope(config, species, gender) {
    const key = String(species) + '_' + String(gender);
    const variant = config?.speciesVariants?.[key];
    return variant?.parts?.head?.image || variant?.parts?.head?.layers
      ? { key, variant: true } : { key, variant: false };
  }

  function assetUrl(path) {
    // Image URLs inside cosmetic JSONs are rooted at docs/, not beside the JSON file.
    return new URL(String(path || '').replace(/^\.\//, ''), DOCS_ROOT).href;
  }

  function createCatalog(index, fetchConfig, indexUrl = INDEX_URL.href) {
    const entries = Array.isArray(index?.entries) ? index.entries : [];
    const configPromises = new Map(); // Shared fetches for the same cosmetic across gender/index entries; rejects are evicted for retry.
    const indexed = entries.map(entry => ({
      ...entry, identity: appearanceIdentity(entry),
      url: new URL(String(entry.path || ''), indexUrl).href,
    })).filter(e => e.path && e.id);
    const appearance = indexed.filter(e => e.identity);
    const generic = indexed.filter(e => !e.identity);
    function configFor(entry) {
      if (!configPromises.has(entry.url)) {
        const promise = Promise.resolve().then(() => fetchConfig(entry.url))
          .catch(error => { configPromises.delete(entry.url); throw error; });
        configPromises.set(entry.url, promise);
      }
      return configPromises.get(entry.url);
    }
    const speciesIndexUrl = new URL('../species/index.json', indexUrl).href; // Species head definitions come from the canonical species index, not inferred asset paths.
    let speciesIndexPromise = null; // One shared lookup across species/gender switches; only the selected head is fetched.
    const speciesCache = new Map(); // Cache source JSON per species while preserving the index-defined file paths.
    async function speciesDefinition(speciesId) {
      if (!speciesIndexPromise) speciesIndexPromise = Promise.resolve()
        .then(() => fetchConfig(speciesIndexUrl))
        .catch(error => { speciesIndexPromise = null; throw error; });
      const index = await speciesIndexPromise;
      const entry = (index.entries || []).find(item => item.speciesId === speciesId);
      if (!entry) throw Error('Species not found in indexed head definitions: ' + speciesId);
      const url = new URL(entry.path, speciesIndexUrl).href;
      if (!speciesCache.has(url)) speciesCache.set(url, Promise.resolve().then(() => fetchConfig(url))
        .catch(error => { speciesCache.delete(url); throw error; }));
      return speciesCache.get(url);
    }
    async function headArtwork(speciesId, gender, view = 'front', imageLoader = loadImage) {
      const def = await speciesDefinition(speciesId);
      const data = def?.[gender];
      if (!data) throw Error('No indexed ' + gender + ' head for ' + speciesId);
      const headPath = (view === 'rear' && data.behindHeadSprite) || data.headSprite;
      if (!headPath) throw Error('Head sprite not authored for ' + speciesId + ' ' + gender);
      const portraitPath = /^(?:\.\/)?assets\//i.test(headPath) || /^https?:\/\//i.test(headPath)
        ? headPath : 'assets/' + headPath.replace(/^\.\//, ''); // Species JSON headSprite is relative to assets/, unlike cosmetic JSON image.url.
      const image = await imageLoader(assetUrl(portraitPath));
      const xform = data.headXform || {};
      const sx = Number(xform.sx ?? xform.scaleX ?? .95), sy = Number(xform.sy ?? xform.scaleY ?? 1.14);
      const ax = Number(xform.ax ?? 0), ay = Number(xform.ay ?? -.1);
      const canvas = document.createElement('canvas'); // Exactly the 200px portrait coordinates used for the cosmetic and seam masks.
      canvas.width = canvas.height = 200;
      const ctx = canvas.getContext('2d');
      const h = LAYER_SIZE * sy;
      const w = (image.naturalWidth || image.width) / Math.max(1, image.naturalHeight || image.height) * LAYER_SIZE * Math.abs(sx);
      ctx.drawImage(image, 100 + ay * LAYER_SIZE - w / 2, 100 - ax * LAYER_SIZE - h / 2, w, h);
      return canvas;
    }
    function species() {
      const pairs = new Map();
      for (const e of appearance) {
        if (!pairs.has(e.identity.species)) pairs.set(e.identity.species, e.identity.speciesLabel);
      }
      return [...pairs].map(([value, label]) => ({ value, label: pretty(label) }))
        .sort((a, b) => a.label.localeCompare(b.label));
    }
    function genders(speciesId) {
      return ['male', 'female'].filter(gender => appearance.some(
        e => e.identity.species === speciesId && e.identity.gender === gender));
    }
    async function styles(speciesId, gender) {
      const relevant = appearance.filter(e => e.identity.species === speciesId && e.identity.gender === gender);
      const unique = [...new Map(relevant.map(e => [e.url, e])).values()];
      const settled = await Promise.allSettled(unique.map(async entry => {
        const config = await configFor(entry);
        const slot = classifyStyle(config, entry);
        if (!slot || !imageLayers(config, speciesId, gender).length) return null;
        return {
          entry, config, slot, key: entry.url,
          label: String(config.meta?.name || pretty(entry.id.split('::').pop())),
          scope: rigScope(config, speciesId, gender),
        };
      }));
      return {
        options: settled.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value)
          .sort((a, b) => a.label.localeCompare(b.label)),
        failures: settled.filter(r => r.status === 'rejected').length,
      };
    }
    async function hoods() {
      const settled = await Promise.allSettled(generic.map(async entry => {
        const config = await configFor(entry);
        if (String(config?.slot || '').toLowerCase() !== 'hood') return null;
        return { entry, config, key: entry.url, label: String(config.meta?.name || pretty(entry.id)) };
      }));
      return {
        options: settled.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value)
          .sort((a, b) => a.label.localeCompare(b.label)),
        failures: settled.filter(r => r.status === 'rejected').length,
      };
    }
    return { species, genders, styles, hoods, configFor, speciesDefinition, headArtwork };
  }

  async function loadIndex(fetchJson = async url => {
    const response = await fetch(url); // Same-origin static resources; GitHack commit-pinned pages fetch files from the same commit.
    if (!response.ok) throw new Error('HTTP ' + response.status + ' reading ' + url);
    return response.json();
  }, url = INDEX_URL.href) {
    return createCatalog(await fetchJson(url), fetchJson, url);
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image(); // Browser image decoder; loading each source once avoids repeated bitmap conversion during edits.
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Could not load artwork: ' + url));
      image.src = url;
    });
  }

  async function composeArtwork(config, species, gender, view = 'front', imageLoader = loadImage) {
    const layers = imageLayers(config, species, gender);
    if (!layers.length) return null;
    const sources = view === 'rear' ? layers.map(layer => layer.behindUrl) : layers.map(layer => layer.url);
    const results = await Promise.allSettled(sources.map(url => imageLoader(assetUrl(url))));
    const canvas = document.createElement('canvas'); // Full 200×200 portrait-layout reference, instead of stretching a cropped hair PNG across the editor.
    canvas.width = canvas.height = 200;
    const ctx = canvas.getContext('2d');
    let drawn = 0;
    for (let i = 0; i < results.length; i++) {
      if (results[i].status !== 'fulfilled') continue; // Bad optional art does not erase every other layer.
      const image = results[i].value, h = LAYER_SIZE * PRESERVED_B.sy;
      const w = (image.naturalWidth || image.width) / Math.max(1, image.naturalHeight || image.height) * LAYER_SIZE * PRESERVED_B.sx;
      const cx = 100 + PRESERVED_B.ay * LAYER_SIZE, cy = 100 - PRESERVED_B.ax * LAYER_SIZE;
      // Cosmetic head layers are rendered with preset B at runtime (not their old spriteStyle A transforms).
      ctx.drawImage(image, cx - w / 2, cy - h / 2, w, h);
      drawn++;
    }
    return drawn ? canvas : null;
  }

  window.PortraitSplineCatalog = {
    indexUrl: INDEX_URL.href, slots: SLOTS, appearanceIdentity, classifyStyle,
    imageLayers, rigScope, assetUrl, createCatalog, loadIndex, loadImage, composeArtwork,
  };
})();
