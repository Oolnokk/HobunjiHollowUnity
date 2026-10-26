(() => {
  'use strict';

  // Honeyfuzzle body colors and where each can be found.
  //
  // One broad master palette, split by region:
  //   Northern Cliffs       -> temperate bird colors (robin, bluebird, goldfinch, sparrow brown, ...)
  //   Southern Cloud Forest -> tropical bird colors (macaw, parrot, toucan, quetzal, ...)
  //   Eastern Mire          -> ominous colors: blacks, greys, whites and the darkest greens through violets
  //   Western Slope         -> no honeyfuzzles at all
  // Any other wilderness zone (arena, lab, future zones) draws from all three.
  //
  // The master palette contains every body color the existing species can have
  // (SCRATCHBONES_CONFIG.game.creatureGenetics.palettes: the shared coat palette
  // and Drenkirra's parrot palette) plus the authored bird colors below. Existing
  // species colors are sorted into a region by their HSL (see classify); the
  // authored colors name their region directly.

  const EXCLUDED_ZONES = Object.freeze(['map_western_slope']);
  const REGIONS = Object.freeze(['temperate', 'tropical', 'ominous']);
  const ZONE_REGION = Object.freeze({
    map_northern_cliffs: 'temperate',
    map_southern_cloud_forest: 'tropical',
    map_eastern_mire: 'ominous',
  });

  const AUTHORED = Object.freeze({
    temperate: Object.freeze([
      '#c8643a', // robin breast
      '#4a7fc1', // bluebird
      '#e8c02f', // goldfinch
      '#b82f35', // cardinal
      '#8b6b4a', // sparrow
      '#b9b0a0', // chickadee buff
      '#5b86b8', // jay blue
      '#e3c04a', // meadowlark
      '#e08a2c', // oriole
      '#a7835a', // wren
      '#6d7f8f', // nuthatch slate
      '#8a9a4b', // warbler olive
      '#b0919a', // dove mauve
      '#b69a74', // waxwing fawn
      '#c9a227', // yellowhammer
      '#7a5a3c', // thrush brown
    ]),
    tropical: Object.freeze([
      '#e0262b', // scarlet macaw
      '#0fa968', // quetzal emerald
      '#2a47c9', // hyacinth blue
      '#f46f8e', // flamingo
      '#9a3ee0', // bird-of-paradise violet
      '#ff4d2e', // tanager
      '#ff9f1c', // toucan orange
      '#12c2a5', // kingfisher teal
      '#d6e82a', // lorikeet lime
      '#ff3d9a', // cock-of-the-rock magenta
    ]),
    ominous: Object.freeze([
      '#0b0b0e', // pitch black
      '#1d1d22', // soot
      '#34343a', // charcoal
      '#6e6e74', // ash grey
      '#b4b4b8', // pale ash
      '#ece8e0', // bone white
      '#123a22', // darkest green
      '#0f3a3a', // darkest teal
      '#10224a', // darkest blue
      '#221a52', // darkest indigo
      '#2d1650', // darkest violet
      '#2a1030', // plum black
      '#25301a', // murk green
      '#3a2a14', // dead umber
    ]),
  });

  function hexToRgb(hex) {
    const h = String(hex).replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function hexToHsl(hex) {
    const [r, g, b] = hexToRgb(hex).map(v => v / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
    if (!d) return { h: 0, s: 0, l };
    const s = d / (1 - Math.abs(2 * l - 1));
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    return { h, s, l };
  }

  // Region for an existing species color: blacks/greys/whites and the darkest
  // greens-to-violets are ominous, vivid mid-tones are tropical, everything
  // earthy or muted is temperate.
  function classify(hex) {
    const { h, s, l } = hexToHsl(hex);
    if (l < 0.2 || l > 0.85 || s < 0.12) return 'ominous'; // Blacks, whites and greys.
    if (l < 0.32 && h >= 75 && h <= 300) return 'ominous';
    if (s >= 0.6 && l >= 0.38 && l <= 0.72) return 'tropical';
    return 'temperate';
  }

  function speciesColors() {
    const palettes = window.SCRATCHBONES_CONFIG?.game?.creatureGenetics?.palettes || {};
    const seen = new Set(), out = [];
    for (const list of Object.values(palettes)) {
      for (const entry of list || []) {
        const hex = String(entry?.hex || '').toLowerCase();
        if (/^#[0-9a-f]{6}$/.test(hex) && !seen.has(hex)) { seen.add(hex); out.push(hex); }
      }
    }
    return out;
  }

  let cache = null; // { temperate: [...], tropical: [...], ominous: [...] } built once from config.
  function regionPalettes() {
    if (cache) return cache;
    const palettes = { temperate: [], tropical: [], ominous: [] };
    for (const hex of speciesColors()) palettes[classify(hex)].push(hex);
    for (const region of REGIONS) for (const hex of AUTHORED[region]) if (!palettes[region].includes(hex)) palettes[region].push(hex);
    cache = palettes;
    return palettes;
  }

  const isExcludedZone = zoneId => EXCLUDED_ZONES.includes(zoneId);

  // Every color a honeyfuzzle can have in this zone (empty for the Western Slope).
  function zonePalette(zoneId) {
    if (isExcludedZone(zoneId)) return [];
    const palettes = regionPalettes();
    const region = ZONE_REGION[zoneId];
    return region ? palettes[region] : REGIONS.flatMap(r => palettes[r]);
  }

  function hashString(text) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
    h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13;
    return h >>> 0;
  }

  // The same stump always has the same colored swarm.
  function pickForKey(zoneId, key) {
    const palette = zonePalette(zoneId);
    return palette.length ? palette[hashString(String(key)) % palette.length] : null;
  }

  // Eggs keep their stump's color AND optional markings in the existing per-world FIFO.
  // Legacy saved entries are hex strings, while new ones include {color, genotype}.
  // The bag only counts eggs, so the FIFO survives save/reload independently.
  const EGG_QUEUE_KEY = 'hobunji_honeyfuzzle_egg_colors_v1';
  function readQueues() {
    try { return JSON.parse(localStorage.getItem(EGG_QUEUE_KEY) || '{}') || {}; } catch (_) { return {}; }
  }
  function writeQueues(queues) {
    try { localStorage.setItem(EGG_QUEUE_KEY, JSON.stringify(queues)); } catch (_) { /* storage unavailable: eggs just roll a fresh color */ }
  }
  function queueEggAppearances(worldId, entries) {
    const queues = readQueues(), id = String(worldId || 'local');
    const accepted = (Array.isArray(entries) ? entries : []).map(entry => {
      if (typeof entry === 'string') return entry; // Legacy color-only eggs remain exactly as saved.
      if (!entry || typeof entry.color !== 'string') return null;
      return { color: entry.color, genotype: entry.genotype || null }; // Preserves a harvested swarm's inherited optional markings.
    }).filter(Boolean);
    queues[id] = [...(queues[id] || []), ...accepted].slice(-99);
    writeQueues(queues);
  }
  function takeEggAppearance(worldId) {
    const queues = readQueues(), id = String(worldId || 'local');
    const stored = (queues[id] || []).shift() || null;
    if (queues[id] && !queues[id].length) delete queues[id];
    writeQueues(queues);
    if (typeof stored === 'string') return { color: stored, genotype: null }; // Backward compatibility for existing serialized egg queues.
    return stored && typeof stored.color === 'string'
      ? { color: stored.color, genotype: stored.genotype || null } : null;
  }
  function queueEggColors(worldId, colors) { queueEggAppearances(worldId, colors); } // Keeps callers and older tests working.
  function takeEggColor(worldId) { return takeEggAppearance(worldId)?.color || null; } // Legacy API still consumes one FIFO entry.

  window.HoneyfuzzleColors = {
    queueEggColors, takeEggColor, queueEggAppearances, takeEggAppearance,
    EXCLUDED_ZONES, REGIONS, ZONE_REGION, AUTHORED,
    hexToRgb, hexToHsl, classify, regionPalettes, zonePalette, isExcludedZone, pickForKey,
    resetCache: () => { cache = null; },
  };
})();
