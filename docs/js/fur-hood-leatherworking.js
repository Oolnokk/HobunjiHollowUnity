(function FurModule() {
  'use strict';
  if (window.FurHoodLeatherworking) return;

  const HOOD_ID = 'fur_hood'; // The one reusable cosmetic definition; literal coats are saved separately on each crafted article.
  const MANIFEST = 'config/patterns/fur-hoods.json'; // Repo-authored source of genotype motif definitions and optional animal silhouette sprites.
  const scriptUrl = document.currentScript?.src || ''; // Resolve manifest from this script, regardless of whether the game or a tool loads it.
  const manifestUrl = scriptUrl ? new URL('../' + MANIFEST, scriptUrl).href : MANIFEST;
  const fallbackManifest = { schema: 'hobunji_fur_hoods.v1', species: {} }; // A missing manifest must not destroy already-owned natural hoods.
  let manifest = fallbackManifest; // Read by every portrait/icon draw and by the dev tool after the first fetch.
  let loading = null; // Shared manifest request avoids races between loot menus, game startup, and portraits.
  let activePanel = null; // The current mobile-friendly leatherworking overlay, if open.
  let lastCraft = null; // Source quality and resulting uid for phone diagnostics.
  let lastError = null; // Human-readable failed fetch/render/craft cause for the in-game debug report.
  const copy = value => value == null ? null : JSON.parse(JSON.stringify(value));

  function normalizeKind(value) {
    const name = String(value || '').trim(); // Hide producers use canonical creature keys; aliases share the same animal coat motifs.
    const alias = window.CreatureGenetics?.SPECIES_ALIAS?.[name] || name;
    return String(alias).replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().replace(/[_\s]+/g, '-').replace(/[’']/g, '');
  }
  function colorHex(value) {
    const match = String(value || '').trim().match(/^#?([a-f0-9]{6})$/i);
    return match ? '#' + match[1].toLowerCase() : null;
  }
  async function ensureManifest() {
    if (!loading) loading = fetch(manifestUrl).then(response => {
      if (!response.ok) throw new Error('Fur-hood manifest HTTP ' + response.status);
      return response.json();
    }).then(data => {
      if (data?.schema !== 'hobunji_fur_hoods.v1' || !data.species || typeof data.species !== 'object') throw new Error('Invalid fur-hood manifest');
      manifest = data;
      return manifest;
    }).catch(error => {
      lastError = String(error?.message || error);
      loading = null;
      return manifest;
    });
    return loading;
  }
  function entryForKind(kind) {
    const normalized = normalizeKind(kind);
    return manifest.species?.[normalized] || manifest.species?.[kind] || null;
  }
  function fromHide(record) {
    if (!record?.genotype || !record?.kind) return null;
    const baseColor = colorHex(record.genotype?.base?.color || record.appearance?.baseColor);
    if (!baseColor) return null;
    return {
      version: 1,
      kind: normalizeKind(record.kind),
      sourceKind: record.sourceKind || record.kind,
      sourceItemKey: record.itemKey,
      genotype: copy(record.genotype),
      appearance: copy(record.appearance),
      baseColor,
      hideStars: Number(record.stars) || null,
    };
  }


  function expressedGenes(furHood) {
    if (!furHood) return [];
    const genome = furHood.genotype || {}; // Source genotype determines whether each natural dye gene exists and is expressed.
    const ids = window.CreatureGenetics?.PATTERN_DEFS?.[normalizeKind(furHood.kind)] || []; // Official animal-gene order is the stable color priority.
    const appearance = Array.isArray(furHood.appearance?.patterns) ? furHood.appearance.patterns : [];
    const known = [...new Set([...ids, ...appearance.map(g => g?.id), ...Object.keys(entryForKind(furHood.kind)?.patterns || {})])].filter(Boolean);
    return known.flatMap(id => {
      const gene = genome[id], trait = appearance.find(x => x?.id === id); // Old visual summaries are consulted only when genotype is missing.
      if (gene) {
        if (gene.enabled === false || (gene.copies != null && Number(gene.copies) <= 0)) return [];
      } else if (!trait?.enabled) return [];
      const color = colorHex(gene?.color || trait?.color);
      return color ? [{ geneId: id, colorHex: color }] : [];
    });
  }
  function patternColorFor(furHood, requestedGene = null) {
    const expressed = expressedGenes(furHood); // Trim and animal parts never require a painted motif PNG.
    if (requestedGene) return expressed.find(g => g.geneId === requestedGene)?.colorHex || null;
    const priority = entryForKind(furHood?.kind)?.trimGene;
    return (expressed.find(g => g.geneId === priority) || expressed[0])?.colorHex || null;
  }
  function colorForRole(furHood, role) {
    if (!furHood) return null;
    const base = colorHex(furHood.baseColor || furHood.genotype?.base?.color);
    const entry = entryForKind(furHood.kind) || {}; // Per-species artist controls select base coat or inherited pigment for each sprite.
    const mode = role === 'trim' ? 'pattern' : role === 'animalFront' ? entry.partColors?.front || 'base'
      : role === 'animalBack' ? entry.partColors?.back || 'base' : 'base';
    const gene = role === 'trim' ? entry.trimGene : role === 'animalFront' ? entry.partGenes?.front : role === 'animalBack' ? entry.partGenes?.back : null;
    return mode === 'pattern' ? (patternColorFor(furHood, gene) || base) : base;
  }
  const recoloredPartCache = new WeakMap(); // Cache small keyed Grehlr canvases against their original PNG, base shade and stripe color.
  function recolorAnimalPart(image, furHood, role) {
    if (!image || !furHood || normalizeKind(furHood.kind) !== 'grehlr' || !['animalFront','animalBack'].includes(role)) return null;
    const fill = window.ColorFill; // Existing HSV value-preserving color fill, not a new tinting algorithm.
    if (!fill?.hsvValueFillPixels || !fill?.rgbToHsv || !fill?.hueDistance) return null;
    const base = colorHex(furHood.baseColor || furHood.genotype?.base?.color);
    const stripe = patternColorFor(furHood, 'coloredstripe'); // White/gray stripe stays untouched without this exact expressed gene.
    const key = role + '|' + (base || '') + '|' + (stripe || '');
    let cache = recoloredPartCache.get(image);
    if (cache?.has(key)) return cache.get(key);
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth || image.width; canvas.height = image.naturalHeight || image.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0);
    const frame = ctx.getImageData(0,0,canvas.width,canvas.height);
    const source = new Uint8ClampedArray(frame.data); // Both region masks sample original unpainted pixels.
    const mintHue = fill.rgbToHsv(0xA3,0xC8,0x9F).h; // Mint source-key highlights and shaded companions in the authored Grehlr back.
    const isMint = i => {
      if (role !== 'animalBack' || !base || source[i+3] <= 8) return false;
      const hsv=fill.rgbToHsv(source[i],source[i+1],source[i+2]);
      return hsv.v >= 0.12 && hsv.s >= 0.10 && fill.hueDistance(hsv.h,mintHue) <= 34;
    };
    const isStripe = i => {
      if (!stripe || source[i+3] <= 8) return false;
      const r=source[i], g=source[i+1], b=source[i+2]; // Covers pure white and neutral shaded grays without catching colored mint.
      return Math.max(r,g,b)>=88 && Math.max(r,g,b)-Math.min(r,g,b)<=14;
    };
    const rgb=hex=>[parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16)];
    if (role==='animalBack' && base) fill.hsvValueFillPixels(frame.data,rgb(base),{sourceData:source,applyPredicate:isMint});
    if (stripe) fill.hsvValueFillPixels(frame.data,rgb(stripe),{sourceData:source,applyPredicate:isStripe});
    ctx.putImageData(frame,0,0);
    if(!cache){cache=new Map();recoloredPartCache.set(image,cache);}
    if(cache.size>=12)cache.clear();
    cache.set(key,canvas);
    return canvas;
  }
  function markingsFor(furHood, role = 'base') {
    if (!furHood || !['base', 'animalFront', 'animalBack'].includes(role)) return []; // The hood base and both hide-derived animal pieces share genetic markings; the separate trim does not.
    const genes = entryForKind(furHood.kind)?.patterns || {};
    const results = []; // Optional motif geometry is layered above automatic genotype color fills.
    for (const { geneId, colorHex: ink } of expressedGenes(furHood)) {
      const definition = genes[geneId];
      if (!definition?.motifPng) continue;
      const pattern = { ...(definition.settings || {}), motifUrl: definition.motifPng };
      results.push({ geneId, pattern, colorHex: ink });
    }
    return results;
  }

  function specialPartsFor(furHood, wearerSpecies = null, wearerGender = 'male') {
    const kindEntry=entryForKind(furHood?.kind); // Read species tint routing next to original authoring manifest parts.
    const partsByVariant = kindEntry?.parts || {}; // One animal can supply distinct sprite geometry for the two authored hood head-shape groups.
    const species = normalizeKind(wearerSpecies || 'tletingan');
    const fatHead = new Set(['kenkari','rakakoan','mashtzarr','mammakhbuur']); // Mirrors cosmetic-fallback-groups.json for use before the portrait registry finishes loading.
    const defaultVariant = fatHead.has(species) ? 'mashtzarr_male' : 'tletingan_male';
    const fallbackKeys = window.portraitVariantKeysForFighter?.({ speciesId: species, gender: wearerGender }, { slot: 'hood' }) || [];
    const chosenVariant = [...fallbackKeys, defaultVariant].find(key => partsByVariant[key] && typeof partsByVariant[key] === 'object') || null;
    const parts = chosenVariant ? partsByVariant[chosenVariant] : partsByVariant; // Compatibility with early manifests that authored front/back paths without wearer variants.
    return ['back', 'front'].flatMap(pos => {
      const url = parts[pos];
      if (typeof url !== 'string' || !/^(?:\.\/)?assets\/[a-z0-9_./-]+\.(?:png|webp)$/i.test(url)) return [];
      const assetUrl = String(url).replace(/^\.\//, '');
      return [{
        url: assetUrl,
        pos,
        layerName: pos === 'front' ? 'animal-front' : 'animal-back',
        role: pos === 'front' ? 'animalFront' : 'animalBack',
        paletteColorKey: 'A',
        furColorMode: kindEntry?.partColors?.[pos] || 'base', // Runtime role tint comes from source genotype, not cosmetic dyes.
        ax: 0, ay: 0, sx: 1, sy: 1, xformPreset: 'B',
      }];
    });
  }
  function hideChoices(inventory) {
    const api = window.AnimalHides;
    if (!api?.groupsFor) return [];
    const results = []; // One row per exact full-genotype inventory stack, not one row per species or rarity tier.
    for (const [key, total] of Object.entries(inventory || {})) {
      if (!api.isHide?.(key) || !(Number(total) > 0)) continue;
      for (const group of api.groupsFor(key, total) || []) {
        const furHood = fromHide(group.hideRecord);
        if (!furHood || !group.count) continue; // Legacy hides without original coats cannot invent a genotype.
        results.push({ key, variant: group.variant, count: group.count, stars: group.stars, record: group.hideRecord, furHood });
      }
    }
    return results;
  }
  function closePanel() {
    activePanel?.remove();
    activePanel = null;
  }
  function openLoom(deps, options = {}) {
    if (!deps?.inventory || !deps.getPackClothing?.() || !window.AnimalHides?.consume) {
      deps?.showToast?.('Hide inventory or Pack clothing is not ready.', false);
      return false;
    }
    closePanel();
    ensureManifest(); // Early loading is safe; the preview repeats after the manifest fetch resolves.
    const overlay = document.createElement('div');
    overlay.className = 'furhood-overlay';
    overlay.innerHTML = '<section class="furhood-dialog" role="dialog" aria-modal="true" aria-label="Loom leatherworking">' +
      '<header><h2>Leatherworking · Fur Hoods</h2><button data-action="close" aria-label="Close">✕</button></header>' +
      '<nav><button data-action="cloth">Cloth weaving</button><button class="selected" disabled>Leatherworking</button></nav>' +
      '<label>Choose an individual hide from your pack<select data-field="hide"></select></label>' +
      '<p class="furhood-help">Natural coats cannot be dyed. Only the selected hide is consumed. Expressed markings keep their genetic colors; custom dyed weaving is added later by reweaving the hood in the ordinary loom.</p>' +
      '<div class="furhood-preview"><canvas data-view="preview" width="1" height="1"></canvas></div>' +
      '<div class="furhood-row"><button data-action="view">View behind</button><button data-action="craft">Craft fur hood</button></div>' +
      '<output data-field="status" aria-live="polite"></output>' +
      '</section>';
    const style = document.createElement('style');
    style.textContent = '.furhood-overlay{position:fixed;inset:0;z-index:9005;background:#000b;display:grid;place-items:center;padding:12px}' +
      '.furhood-dialog{width:min(600px,100%);max-height:94dvh;overflow:auto;background:#14201e;color:#f4f5ed;border:1px solid #6d9986;border-radius:13px;padding:15px;font-family:system-ui}' +
      '.furhood-dialog header,.furhood-dialog nav,.furhood-row{display:flex;justify-content:space-between;gap:9px;align-items:center;flex-wrap:wrap}' +
      '.furhood-dialog h2{font-size:19px;margin:0}.furhood-dialog nav{margin:12px 0}.furhood-dialog label{display:block;font-size:13px;font-weight:700}' +
      '.furhood-dialog select{display:block;width:100%;min-height:43px;background:#091713;color:white;border:1px solid #81b09b;border-radius:7px;margin:6px 0;padding:5px}' +
      '.furhood-dialog button{background:#284f40;color:#fff;border:1px solid #699c83;border-radius:8px;min-height:43px;padding:9px 12px}' +
      '.furhood-dialog button.selected{background:#416b54}.furhood-dialog button:disabled{opacity:.6}.furhood-help{font-size:12px;line-height:1.45;color:#c2d5c8}' +
      '.furhood-preview{min-height:200px;display:grid;place-items:center;background:#101915;margin:9px 0;border:1px solid #436857}' +
      '.furhood-preview canvas{max-width:100%;max-height:280px;image-rendering:pixelated}.furhood-row button{flex:1}' +
      '.furhood-dialog output{display:block;white-space:pre-wrap;min-height:35px;font-size:12px;color:#c3e4d1;margin-top:7px}';
    overlay.appendChild(style);
    document.body.appendChild(overlay);
    activePanel = overlay;
    const select = overlay.querySelector('[data-field="hide"]');
    const status = overlay.querySelector('[data-field="status"]');
    const preview = overlay.querySelector('[data-view="preview"]');
    const choices = hideChoices(deps.inventory); // Recomputed after a craft so one-of-a-kind hides cannot be selected twice.
    let view = 'front'; // Shared with the View Behind button while this overlay is open.
    let revision = 0; // Rejects late async render completions after hide switching or panel close.
    const chosen = () => choices[Number(select.value)] || null;
    const refresh = async () => {
      const choice = chosen(), request = ++revision;
      const canvas = preview;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!choice) { status.textContent = 'No saved-genotype hides in Pack. Legacy hides without genotype cannot be used.'; return; }
      const details = choice.furHood;
      status.textContent = choice.count + ' available · ' + (choice.stars || '?') + '★ · ' + details.baseColor + ' base coat · ' + (details.appearance?.patterns?.length || 0) + ' expressed markings';
      try {
        await ensureManifest();
        const rendered = await window.ClothingWeavingSystem?.renderClothingLayers?.(HOOD_ID, {
          primaryHex: details.baseColor, secondaryHex: details.baseColor,
          furHood: details, view,
        });
        if (request !== revision || activePanel !== overlay || !rendered?.canvas) return;
        canvas.width = rendered.canvas.width;
        canvas.height = rendered.canvas.height;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(rendered.canvas, 0, 0);
      } catch (error) {
        lastError = String(error?.message || error);
        if (request === revision) status.textContent += '\nPreview: ' + lastError;
      }
    };
    choices.forEach((choice, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = choice.furHood.kind + ' · ' + choice.furHood.baseColor + ' · ' + (choice.stars || '?') + '★ · x' + choice.count;
      select.appendChild(option);
    });
    select.onchange = refresh;
    overlay.querySelector('[data-action="close"]').onclick = closePanel;
    overlay.querySelector('[data-action="cloth"]').onclick = () => {
      closePanel();
      window.ClothingWeavingSystem?.openLoom?.(null, options);
    };
    overlay.querySelector('[data-action="view"]').onclick = event => {
      view = view === 'front' ? 'behind' : 'front';
      event.target.textContent = view === 'front' ? 'View behind' : 'View front';
      refresh();
    };
    overlay.querySelector('[data-action="craft"]').onclick = () => {
      const choice = chosen();
      const current = choice && hideChoices(deps.inventory).find(x => x.key === choice.key && x.variant === choice.variant);
      const pack = deps.getPackClothing?.();
      if (!current || !Array.isArray(pack)) {
        status.textContent = 'Hide is no longer available. Reopen Leatherworking to refresh inventory.';
        return;
      }
      const source = current.record;
      const consumed = window.AnimalHides.consume(choice.key, 1, 'pack', source.sellPrice, Number(deps.inventory[choice.key]), choice.variant);
      if (!consumed.ok || !consumed.records?.length) { status.textContent = 'Hide was not consumed; inventory changed.'; return; }
      deps.inventory[choice.key] = Math.max(0, Number(deps.inventory[choice.key]) - 1);
      deps.clampInventoryStack?.(choice.key);
      const coat = fromHide(consumed.records[0]);
      const uid = 'gcloth_fur_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
      const sourceName = coat.kind.replace(/-/g, ' ');
      const entry = {
        uid, cosmeticId: HOOD_ID + '#loom:' + uid, baseCosmeticId: HOOD_ID, slot: 'hood',
        label: sourceName + ' Fur Hood', baseLabel: 'Fur Hood',
        description: 'Leatherworked from one ' + sourceName + ' hide. Natural coat and original inherited markings cannot be dyed.',
        colorA: { hex: coat.baseColor, label: 'Natural coat' },
        colorB: { hex: coat.baseColor, label: 'Natural fur trim' },
        colorC: null, articleDyeIds: [], dyeable: false,
        sellPrice: Math.max(1, Math.round(Number(source.sellPrice) * 1.5)),
        qualityStars: source.stars || 1, weaveMaterial: 'light', weightUnits: 2,
        weaving: null, furHood: coat, craftedAt: Date.now(),
      };
      pack.push(entry);
      lastCraft = { uid, sourceKey: choice.key, sourceKind: coat.kind, stars: entry.qualityStars, baseColor: coat.baseColor };
      deps.saveMemberWorldData?.();
      deps.buildInventoryGrid?.();
      window.EquipmentPanel?.buildPackClothingSection?.();
      deps.showToast?.('Crafted ' + entry.label + '; added to Pack.', true);
      closePanel();
      openLoom(deps, options);
    };
    overlay.addEventListener('pointerdown', event => { if (event.target === overlay) closePanel(); });
    refresh();
    return true;
  }
  function debugSnapshot() {
    return {
      manifestLoaded: manifest !== fallbackManifest,
      species: Object.keys(manifest.species || {}),
      leatherworkingOpen: !!activePanel?.isConnected,
      lastCraft: copy(lastCraft), lastError,
      latestChange: 'Craft natural fur hoods from exact saved-genotype hides; separate authored marking/animal-sprite registry.',
    };
  }
  window.FurHoodLeatherworking = Object.freeze({
    ensureManifest, fromHide, expressedGenes, patternColorFor, colorForRole, recolorAnimalPart, markingsFor, specialPartsFor, hideChoices, openLoom, closePanel, debugSnapshot,
  });
  ensureManifest();
})();
