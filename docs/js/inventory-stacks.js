(() => {
  'use strict';

  // Shared sizing, variant partitioning and cached animal head icons. The bag stores one count per
  // item key; STACK_SIZE is only how many units one inventory box shows —
  // anything past it spills into another box of the same item instead of
  // being refused or discarded. MAX_TOTAL is a sanity ceiling per item
  // (101 full stacks) so a runaway grant can't grow a count without bound.
  // Loaded before every module that grants items (see index.html).
  const STACK_SIZE = 99;
  const MAX_TOTAL = 9999;

  function clampTotal(value) {
    return Math.max(0, Math.min(MAX_TOTAL, Number(value) || 0));
  }

  // Splits a total into per-box counts: 250 -> [99, 99, 52].
  function stackCounts(total) {
    const count = Math.max(0, Math.floor(Number(total) || 0));
    const out = [];
    for (let left = count; left > 0; left -= STACK_SIZE) out.push(Math.min(STACK_SIZE, left));
    return out;
  }

  // Full canonical genes, rather than appearance alone: recessive alleles also split stacks.
  function genotypeKey(value) {
    if (value == null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(genotypeKey).join(',') + ']';
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + genotypeKey(value[key])).join(',') + '}';
  }

  function variants(key, total, qualityTracked = false) {
    const lineages = window.LivestockItemGenotypePersistence?.groupsFor?.(key, total); // Saved lineage groups take precedence over ordinary quality buckets.
    const groups = lineages || (qualityTracked ? window.CookingSystem?.availableQualityEntries?.(key).map(entry => ({ ...entry, variant: `stars:${entry.stars}` })) : null); // Queries happen on menu rebuild, never in the frame loop.
    return (groups || [{ count: total, variant: 'plain' }]).flatMap(group => stackCounts(group.count).map((count, index) => ({ ...group, key, count, stackId: `${key}|${group.variant}|${index}` })));
  }

  const headCache = new Map(); // Finished 96px portraits and in-flight promises shared by Pack and Nursery.
  const iconDebug = { composed: 0, hits: 0, lastError: null, latestChange: 'Genotype and star stacks; cached authored animal head icons.' }; // Readable through existing mobile diagnostics.
  function headIcon(kind, genotype) {
    const framing = window.AnimalChatheadFrame; // Shared author-tool selection box and runtime crop authority.
    if (!framing || !window.CreatureGeneticsRender?.composeFrame) return Promise.resolve(null);
    const key = kind + '|' + genotypeKey(genotype) + '|' + genotypeKey(framing.frameForKind(kind)?.frame); // Includes crop edits as well as recessive/painted genes.
    if (headCache.has(key)) { iconDebug.hits++; return headCache.get(key); }
    const request = (async () => {
      const canvas = document.createElement('canvas'); // Only allocated on cache miss; colors/patterns compose once per portrait.
      canvas.width = canvas.height = 96;
      if (!await framing.renderCreatureChathead(canvas, kind, { genotype })) return null;
      iconDebug.composed++;
      return canvas.toDataURL('image/png');
    })().catch(error => { iconDebug.lastError = String(error?.message || error); return null; }); // Keep the fallback icon if assets fail.
    headCache.set(key, request);
    request.then(url => { if (!url && headCache.get(key) === request) headCache.delete(key); });
    while (headCache.size > 128) headCache.delete(headCache.keys().next().value);
    return request;
  }

  function applyHeadIcon(element, kind, genotype, variant = 'plain') {
    if (!element || !kind) return;
    const request = kind + '|' + variant; // DOM guard also prevents stale async results from replacing a newer selection.
    if (element.dataset.animalHeadRequest === request) return;
    element.dataset.animalHeadRequest = request;
    headIcon(kind, genotype).then(url => {
      if (!url || element.dataset.animalHeadRequest !== request) return;
      element.textContent = '';
      element.style.backgroundImage = `url("${url}")`;
      element.style.backgroundSize = 'contain';
      element.style.backgroundPosition = 'center';
      element.style.backgroundRepeat = 'no-repeat';
      element.classList.add('sprited-icon');
    });
  }

  window.InventoryStacks = Object.freeze({ STACK_SIZE, MAX_TOTAL, clampTotal, stackCounts, genotypeKey, variants, headIcon, applyHeadIcon, getDebug: () => ({ ...iconDebug, cachedHeads: headCache.size }) });
})();
