(() => {
  'use strict';

  // Runtime mirror of docs/references/(HA)HobunjiFishEditorV1.html.
  // The editor remains the authoring source; this small module only adapts
  // its fish records to the game's fishing, item/economy, and sprite APIs.
  const GURUMAHI_IGNORES = Object.freeze([
    { hex: '#7d7d76', sensitivity: 22 },
    { hex: '#98978e', sensitivity: 48 },
    { hex: '#706f69', sensitivity: 48 },
  ]);
  const ROCKSCALE_IGNORES = Object.freeze([
    { hex: '#7f6e77', sensitivity: 7 },
    { hex: '#bababa', sensitivity: 45 },
  ]);

  // The standalone editor still presents familiar four-season labels.
  // Map them positionally onto Hobunji Hollow's four regional seasons.
  const SEASON_MAP = Object.freeze({
    spring: 'Stormtide',
    summer: 'Deadgrass',
    fall: 'Longpour',
    winter: 'Coldmuck',
  });

  const FISH = Object.freeze([
    {
      key: 'gurumahi_tawny', label: 'Gurumahi Tawny', species: 'gurumahi',
      sprite: 'fish_gurumahi.png', baseColor: '#9b6f49', ignoredSourceColors: GURUMAHI_IGNORES,
      minigameScale: 1.06, fishClass: 'smooth', difficulty: 34,
      zones: ['farm', 'town'], seasons: ['spring', 'summer', 'fall'], times: ['day', 'dusk'], rarity: 'common', sellPrice: 30,
    },
    {
      key: 'gurumahi_charcoal', label: 'Gurumahi Charcoal', species: 'gurumahi',
      sprite: 'fish_gurumahi.png', baseColor: '#4e4f52', ignoredSourceColors: GURUMAHI_IGNORES,
      minigameScale: 1.12, fishClass: 'mixed', difficulty: 46,
      zones: ['town', 'northernCliffs'], seasons: ['any'], times: ['dawn', 'day'], rarity: 'uncommon', sellPrice: 42,
    },
    {
      key: 'gurumahi_creamback', label: 'Gurumahi Creamback', species: 'gurumahi',
      sprite: 'fish_gurumahi.png', baseColor: '#d7c39d', ignoredSourceColors: GURUMAHI_IGNORES,
      minigameScale: 0.98, fishClass: 'floater', difficulty: 28,
      zones: ['farm'], seasons: ['spring', 'summer'], times: ['dawn', 'day'], rarity: 'common', sellPrice: 24,
    },
    {
      key: 'gurumahi_snowmuzzle', label: 'Gurumahi Snowmuzzle', species: 'gurumahi',
      sprite: 'fish_gurumahi.png', baseColor: '#c9ced1', ignoredSourceColors: GURUMAHI_IGNORES,
      minigameScale: 1.03, fishClass: 'sinker', difficulty: 39,
      zones: ['cloudForest', 'northernCliffs'], seasons: ['winter'], times: ['day', 'night'], rarity: 'uncommon', sellPrice: 38,
    },
    {
      key: 'rockscale_goldplate', label: 'Rockscale Goldplate', species: 'rockscale',
      sprite: 'fish_rockscale.png', baseColor: '#c9a24f', ignoredSourceColors: ROCKSCALE_IGNORES,
      minigameScale: 1.14, fishClass: 'sinker', difficulty: 52,
      zones: ['town', 'northernCliffs'], seasons: ['any'], times: ['day', 'dusk'], rarity: 'common', sellPrice: 48,
    },
    {
      key: 'rockscale_giltback', label: 'Rockscale Giltback', species: 'rockscale',
      sprite: 'fish_rockscale.png', baseColor: '#e0bc67', ignoredSourceColors: ROCKSCALE_IGNORES,
      minigameScale: 1.18, fishClass: 'mixed', difficulty: 56,
      zones: ['town', 'cloudForest'], seasons: ['any'], times: ['dawn', 'day'], rarity: 'common', sellPrice: 52,
    },
    {
      key: 'rockscale_silverplate', label: 'Rockscale Silverplate', species: 'rockscale',
      sprite: 'fish_rockscale.png', baseColor: '#b9bec8', ignoredSourceColors: ROCKSCALE_IGNORES,
      minigameScale: 1.15, fishClass: 'smooth', difficulty: 50,
      zones: ['town', 'northernCliffs'], seasons: ['any'], times: ['dawn', 'day'], rarity: 'uncommon', sellPrice: 58,
    },
    {
      key: 'rockscale_ironvein', label: 'Rockscale Ironvein', species: 'rockscale',
      sprite: 'fish_rockscale.png', baseColor: '#8e5541', ignoredSourceColors: ROCKSCALE_IGNORES,
      minigameScale: 1.17, fishClass: 'dart', difficulty: 63,
      zones: ['northernCliffs'], seasons: ['fall', 'winter'], times: ['day', 'dusk'], rarity: 'uncommon', sellPrice: 64,
    },
    {
      key: 'rockscale_slateplate', label: 'Rockscale Slateplate', species: 'rockscale',
      sprite: 'fish_rockscale.png', baseColor: '#58616c', ignoredSourceColors: ROCKSCALE_IGNORES,
      minigameScale: 1.20, fishClass: 'sinker', difficulty: 60,
      zones: ['cloudForest', 'northernCliffs'], seasons: ['any'], times: ['night'], rarity: 'uncommon', sellPrice: 66,
    },
    {
      key: 'rockscale_quartzshield', label: 'Rockscale Quartzshield', species: 'rockscale',
      sprite: 'fish_rockscale.png', baseColor: '#d8d4ca', ignoredSourceColors: ROCKSCALE_IGNORES,
      minigameScale: 1.10, fishClass: 'smooth', difficulty: 44,
      zones: ['farm', 'cloudForest'], seasons: ['spring', 'winter'], times: ['dawn', 'day'], rarity: 'common', sellPrice: 44,
    },
    {
      key: 'rockscale_copperbloom', label: 'Rockscale Copperbloom', species: 'rockscale',
      sprite: 'fish_rockscale.png', baseColor: '#9a7352', ignoredSourceColors: ROCKSCALE_IGNORES,
      minigameScale: 1.16, fishClass: 'mixed', difficulty: 58,
      zones: ['town', 'cloudForest'], seasons: ['summer', 'fall'], times: ['day', 'dusk'], rarity: 'uncommon', sellPrice: 61,
    },
    {
      key: 'sixfin_honeystripe', label: 'Sixfin Honeystripe', species: 'sixfin', sprite: 'fish_sixfin.png',
      overlays: { base: '#d7b161', stripes: '#5c3520' }, minigameScale: 0.94,
      fishClass: 'mixed', difficulty: 36, zones: ['farm', 'town'], seasons: ['spring', 'summer'], times: ['day'], rarity: 'common', sellPrice: 26,
    },
    {
      key: 'sixfin_coalbar', label: 'Sixfin Coalbar', species: 'sixfin', sprite: 'fish_sixfin.png',
      overlays: { base: '#7c7366', stripes: '#2f2f34' }, minigameScale: 1.02,
      fishClass: 'dart', difficulty: 49, zones: ['town', 'northernCliffs'], seasons: ['any'], times: ['dusk', 'night'], rarity: 'uncommon', sellPrice: 34,
    },
    {
      key: 'sixfin_redlash', label: 'Sixfin Redlash', species: 'sixfin', sprite: 'fish_sixfin.png',
      overlays: { base: '#c7a794', stripes: '#8e4938' }, minigameScale: 0.98,
      fishClass: 'mixed', difficulty: 41, zones: ['farm', 'town'], seasons: ['summer', 'fall'], times: ['dawn', 'day'], rarity: 'common', sellPrice: 28,
    },
    {
      key: 'sixfin_mossband', label: 'Sixfin Mossband', species: 'sixfin', sprite: 'fish_sixfin.png',
      overlays: { base: '#94a780', stripes: '#415d3e' }, minigameScale: 1.01,
      fishClass: 'smooth', difficulty: 32, zones: ['cloudForest', 'farm'], seasons: ['spring', 'summer', 'fall'], times: ['day', 'dusk'], rarity: 'common', sellPrice: 27,
    },
    {
      key: 'sixfin_azureband', label: 'Sixfin Azureband', species: 'sixfin', sprite: 'fish_sixfin.png',
      overlays: { base: '#8ab9c8', stripes: '#315d78' }, minigameScale: 1.04,
      fishClass: 'floater', difficulty: 38, zones: ['cloudForest', 'town'], seasons: ['summer'], times: ['dawn', 'day'], rarity: 'uncommon', sellPrice: 33,
    },
    {
      key: 'sixfin_sunember', label: 'Sixfin Sunember', species: 'sixfin', sprite: 'fish_sixfin.png',
      overlays: { base: '#dbc890', stripes: '#b55a2c' }, minigameScale: 0.97,
      fishClass: 'dart', difficulty: 54, zones: ['town', 'cloudForest'], seasons: ['summer', 'fall'], times: ['day', 'dusk'], rarity: 'uncommon', sellPrice: 36,
    },
    {
      key: 'sixfin_milkstripe', label: 'Sixfin Milkstripe', species: 'sixfin', sprite: 'fish_sixfin.png',
      overlays: { base: '#e5dbc6', stripes: '#545257' }, minigameScale: 0.92,
      fishClass: 'smooth', difficulty: 29, zones: ['farm'], seasons: ['spring', 'winter'], times: ['dawn', 'day'], rarity: 'common', sellPrice: 23,
    },
    {
      key: 'sixfin_violetreef', label: 'Sixfin Violetreef', species: 'sixfin', sprite: 'fish_sixfin.png',
      overlays: { base: '#ab99bf', stripes: '#5a4379' }, minigameScale: 1.05,
      fishClass: 'mixed', difficulty: 47, zones: ['cloudForest', 'town'], seasons: ['any'], times: ['dusk', 'night'], rarity: 'uncommon', sellPrice: 35,
    },
  ]);

  const byKey = new Map(FISH.map(fish => [fish.key, fish]));
  const imageCache = new Map();
  const canvasCache = new Map();

  function runtimeSeasons(seasons) {
    if (!Array.isArray(seasons) || seasons.includes('any')) return ['any'];
    return seasons.map(name => SEASON_MAP[name] || name);
  }

  function buildFishingDefs() {
    const zones = { farm: [], town: [], northernCliffs: [], cloudForest: [] };
    for (const fish of FISH) {
      const runtime = {
        key: fish.key,
        label: fish.label,
        image: `assets/objectsprites/${fish.sprite}`,
        fishClass: fish.fishClass,
        difficulty: fish.difficulty,
        seasons: runtimeSeasons(fish.seasons),
        times: [...fish.times],
        rarity: fish.rarity,
        sellPrice: fish.sellPrice,
        minigameScale: fish.minigameScale,
      };
      fish.zones.forEach(zone => zones[zone]?.push(runtime));
    }
    return zones;
  }

  function buildItemDefs() {
    const defs = {};
    for (const fish of FISH) {
      defs[fish.key] = {
        label: fish.label,
        icon: '🐟',
        cat: 'Fish',
        category: 'Fish',
        tags: ['fish', 'edible'],
        desc: `${fish.label}, an edible fish found around Hobunji Hollow.`,
        color: 0x6db6d6,
        secondary: 0x2f6f7f,
        sellPrice: fish.sellPrice,
        spriteIcon: fish.sprite,
        spriteMode: `fish:${fish.key}`,
      };
    }
    return defs;
  }

  function buildBasePrices() {
    return Object.fromEntries(FISH.map(fish => [fish.key, fish.sellPrice]));
  }

  function clamp01(value) { return Math.max(0, Math.min(1, value)); }

  function hexToRgb(hex) {
    const value = parseInt(String(hex || '#000000').replace('#', ''), 16) || 0;
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const lightness = (max + min) / 2;
    if (max === min) return [0, 0, lightness];
    const delta = max - min;
    const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    let hue;
    if (max === r) hue = (g - b) / delta + (g < b ? 6 : 0);
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    return [hue / 6, saturation, lightness];
  }

  function hueToRgb(p, q, t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }

  function hslToRgb(h, s, l) {
    if (s === 0) {
      const value = Math.round(l * 255);
      return [value, value, value];
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return [
      Math.round(hueToRgb(p, q, h + 1 / 3) * 255),
      Math.round(hueToRgb(p, q, h) * 255),
      Math.round(hueToRgb(p, q, h - 1 / 3) * 255),
    ];
  }

  function shouldIgnore(r, g, b, ignored) {
    return (ignored || []).some(entry => {
      const [ir, ig, ib] = hexToRgb(entry.hex);
      return Math.hypot(r - ir, g - ig, b - ib) <= Number(entry.sensitivity || 0);
    });
  }

  function recolorBrightnessPreserving(imageData, color, ignored = []) {
    const [tr, tg, tb] = hexToRgb(color);
    const [targetHue, targetSaturation] = rgbToHsl(tr, tg, tb);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (shouldIgnore(r, g, b, ignored)) continue;
      const [, , lightness] = rgbToHsl(r, g, b);
      // Mirrors the editor's current outline rule. White and black naturally
      // stay at their original value because source lightness is retained.
      if (lightness <= 0.08) continue;
      const [nr, ng, nb] = hslToRgb(targetHue, targetSaturation, clamp01(lightness));
      data[i] = nr; data[i + 1] = ng; data[i + 2] = nb;
    }
  }

  function loadImage(path) {
    if (imageCache.has(path)) return imageCache.get(path);
    const promise = new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Failed to load fish sprite ${path}`));
      image.src = path;
    });
    imageCache.set(path, promise);
    return promise;
  }

  async function recoloredLayer(path, color, ignored = []) {
    const image = await loadImage(path);
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    recolorBrightnessPreserving(pixels, color, ignored);
    ctx.putImageData(pixels, 0, 0);
    return canvas;
  }

  async function renderFishCanvas(spritePath, fish) {
    if (fish.species !== 'sixfin') {
      return recoloredLayer(spritePath, fish.baseColor, fish.ignoredSourceColors);
    }

    const image = await loadImage(spritePath);
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d');
    // Sixfin keeps its authored main sprite intact. Only the two masks are
    // recolored, exactly as in the editor.
    ctx.drawImage(image, 0, 0);
    const base = await recoloredLayer('assets/objectsprites/fish_patterns/base.png', fish.overlays.base);
    const stripes = await recoloredLayer('assets/objectsprites/fish_patterns/stripes.png', fish.overlays.stripes);
    ctx.drawImage(base, 0, 0, canvas.width, canvas.height);
    ctx.drawImage(stripes, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function getRecoloredCanvas(spritePath, fishKey) {
    const fish = byKey.get(fishKey);
    if (!fish) return Promise.reject(new Error(`Unknown authored fish ${fishKey}`));
    const cacheKey = `${fishKey}|${spritePath}`;
    if (!canvasCache.has(cacheKey)) {
      canvasCache.set(cacheKey, renderFishCanvas(spritePath, fish).catch(error => {
        canvasCache.delete(cacheKey);
        throw error;
      }));
    }
    return canvasCache.get(cacheKey);
  }

  function installRuntimeCatalog() {
    const shippingReady = window.ShippingPanel?.registerItemDefinitions?.(buildItemDefs(), buildBasePrices()) === true;
    if (!shippingReady || !window.Fishing?.init) return false;
    // Fishing.init merges dependencies, so this replaces only FISH_DEFS and
    // leaves the live world/input/render hooks injected by game.js untouched.
    window.Fishing.init({ FISH_DEFS: buildFishingDefs() });
    window.__farmLog?.(`[fish-catalog] installed ${FISH.length} authored fish; old fish retained as legacy save items only`, 'items');
    return true;
  }

  function keepMinigameScaleInSync() {
    const fishDef = window.Fishing?.state?.fishDef;
    const image = document.getElementById('fishDeformedImage');
    if (image) {
      const scale = Number.isFinite(Number(fishDef?.minigameScale)) ? Number(fishDef.minigameScale) : 1;
      image.style.transformBox = 'fill-box';
      image.style.transformOrigin = 'center';
      image.style.transform = `scale(${scale})`;
    }
    requestAnimationFrame(keepMinigameScaleInSync);
  }

  function installWhenGameReady() {
    let attempts = 0;
    const tryInstall = () => {
      if (installRuntimeCatalog()) return;
      if (attempts++ < 160) setTimeout(tryInstall, 50);
      else console.warn('[fish-catalog] game data hooks were not ready; catalog not installed');
    };
    tryInstall();
    // game.js is a synchronous script, so load is a reliable final pass even
    // if the async catalog module happened to arrive during game bootstrap.
    window.addEventListener('load', () => installRuntimeCatalog(), { once: true });
  }

  window.FishCatalog = {
    entries: FISH,
    get: key => byKey.get(key) || null,
    buildFishingDefs,
    buildItemDefs,
    getRecoloredCanvas,
    install: installRuntimeCatalog,
  };

  installWhenGameReady();
  requestAnimationFrame(keepMinigameScaleInSync);
})();
