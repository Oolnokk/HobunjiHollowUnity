// Fey/creature extras layered onto CharacterStudioAnimalAppearance.
// Breeding swatches remain presets, while arbitrary hex overrides, opacity,
// and existing-hat selection live on the NPC appearance record only.
(() => {
  'use strict';
  if (typeof document === 'undefined' || !/\/tools\/character-studio\//.test(location.pathname || '')) return;

  const SCRIPT_URL = document.currentScript?.src || '';
  const DOCS_BASE = SCRIPT_URL ? new URL('../', SCRIPT_URL).href : '../../';
  const debugState = { installed: false, lastRender: null, lastAction: 'boot', lastError: null };
  const imageCache = new Map();
  const recolorCache = new Map();
  const renderEpochByCanvas = new WeakMap(); // Cancels stale async creature composites so an older full-opacity render cannot overwrite a newer one.
  let masksPromise = null;
  let hatOptionsCache = null;
  let hatOptionsPromise = null;
  let controlsSignature = ''; // Prevents the polling installer from rebuilding focused hex inputs or an open hat select every 200 ms.

  const $ = id => document.getElementById(id);
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const normalizeKind = value => String(value || '').trim().toLowerCase().replace(/_/g, '-');
  const normalizeHex = value => {
    const match = String(value || '').trim().match(/^#?([0-9a-f]{6})$/i);
    return match ? `#${match[1].toUpperCase()}` : null;
  };
  const normalizeOpacity = value => Number.isFinite(Number(value)) ? Math.max(0, Math.min(1, Number(value))) : 1;
  const esc = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const title = value => String(value || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  const FALLBACK_PATTERNS = Object.freeze({
    'gar-wolf': ['colorpoint', 'foxtail', 'mitts'],
    'dabinggi-hound': ['mitts', 'spectacles', 'stripes'],
    grehlr: ['mitts', 'spectacles', 'coloredstripe'],
    drenkirra: ['bodystripes', 'spectacles'],
  });
  const ANIMAL_META = Object.freeze({
    grehlr: { prefix: 'grehlr', base: 'grehlr_idle.png', eyes: 'grehlr_eye.png' },
    drenkirra: { prefix: 'drnk', base: 'drenkirra_idle.png', eyes: 'drenkirra_eye.png' },
    'gar-wolf': { prefix: 'gw', base: 'gar-wolf_idle.png', eyes: 'gar-wolf_eye.png' },
    'dabinggi-hound': { prefix: 'dh', base: 'dabinggi-hound_idle.png', eyes: 'dabinggi-hound_eye.png' },
    uumkaoii: { prefix: 'uum', base: "uumkao'ii.png", singleFrame: true },
  });

  function parseAppearance() {
    try {
      const value = JSON.parse($('appearanceJson')?.value || '{}');
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch (_) { return {}; }
  }

  function isNpcTarget() { return !!$('applyNpcBtn') && !$('applyNpcBtn').disabled; }
  function activeKind(appearance = parseAppearance()) { return normalizeKind(appearance.creatureKind || appearance.animalKind); }
  function isAnimal(appearance = parseAppearance()) { return isNpcTarget() && appearance.avatarType === 'animal' && !!activeKind(appearance); }

  function writeAppearance(next, action) {
    const textarea = $('appearanceJson');
    if (!textarea) return;
    controlsSignature = ''; // Allow one intentional refresh for the newly committed appearance values.
    textarea.value = JSON.stringify(next, null, 2);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    window.__characterStudioAnimalAppearance = clone(next);
    debugState.lastAction = action;
    debugState.lastError = null;
    if (isNpcTarget() && $('editAvatarBtn')) setTimeout(() => $('editAvatarBtn').click(), 0);
  }

  function patternIdsFor(kind) {
    const authored = window.CreatureGenetics?.PATTERN_DEFS?.[kind];
    return Array.isArray(authored) ? authored : (FALLBACK_PATTERNS[kind] || []);
  }

  function colorLayersFor(kind) {
    return kind === 'uumkaoii' ? ['fur', 'plates'] : ['base', ...patternIdsFor(kind)];
  }

  function genotypeWithOverrides(appearance) {
    const kind = activeKind(appearance);
    const genotype = clone(appearance.creatureGenotype || appearance.genotype || {});
    const overrides = appearance.creatureColorOverrides || {};
    for (const layerId of colorLayersFor(kind)) {
      const color = normalizeHex(overrides[layerId]);
      if (!color) continue;
      genotype[layerId] = { ...(genotype[layerId] || {}), color };
    }
    return genotype;
  }

  function setCustomColor(layerId, color) {
    const normalized = normalizeHex(color);
    if (!normalized) { debugState.lastError = `Invalid hex color: ${color}`; refreshDebug(); return; }
    const appearance = parseAppearance();
    const overrides = { ...(appearance.creatureColorOverrides || {}), [layerId]: normalized };
    const genotype = clone(appearance.creatureGenotype || {});
    genotype[layerId] = { ...(genotype[layerId] || {}), color: normalized };
    writeAppearance({ ...appearance, creatureColorOverrides: overrides, creatureGenotype: genotype }, `${layerId} custom hex → ${normalized}`);
  }

  function clearCustomColor(layerId) {
    const appearance = parseAppearance();
    if (!appearance.creatureColorOverrides?.[layerId]) return;
    const overrides = { ...appearance.creatureColorOverrides };
    delete overrides[layerId];
    const kind = activeKind(appearance);
    const normalizedGenotype = window.CharacterStudioAnimalAppearance?.normalizeGenotype
      ? window.CharacterStudioAnimalAppearance.normalizeGenotype(kind, appearance.creatureGenotype || {})
      : clone(appearance.creatureGenotype || {}); // Returning to presets also returns any custom allele color to the breeding-valid set.
    writeAppearance({ ...appearance, creatureColorOverrides: overrides, creatureGenotype: normalizedGenotype }, `${layerId} returned to breeding preset`);
  }

  async function ensureHatOptions() {
    if (hatOptionsCache) return hatOptionsCache;
    if (hatOptionsPromise) return hatOptionsPromise;
    if (!window.AnimalNpcHeadwear?.hatOptions) return [];
    hatOptionsPromise = window.AnimalNpcHeadwear.hatOptions().then(options => {
      hatOptionsCache = Array.isArray(options) ? options : [];
      hatOptionsPromise = null;
      return hatOptionsCache;
    }).catch(error => { debugState.lastError = `hat options: ${error.message}`; hatOptionsPromise = null; return []; });
    return hatOptionsPromise;
  }

  function controlsStateSignature(kind, appearance, hatOptions) {
    return JSON.stringify([
      kind,
      appearance.creatureGenotype || null,
      appearance.creatureColorOverrides || null,
      normalizeOpacity(appearance.animalOpacity),
      appearance.animalHatId || 'none',
      hatOptions.map(option => [option?.id || '', option?.label || '']),
    ]);
  }

  function injectControls(force = false) {
    const host = $('animalNpcGeneticsControls');
    const appearance = parseAppearance();
    if (!host || !isAnimal(appearance)) { controlsSignature = ''; return; }
    const kind = activeKind(appearance);
    let extras = $('animalNpcFeyExtras');
    if (!extras) {
      extras = document.createElement('div');
      extras.id = 'animalNpcFeyExtras';
      host.appendChild(extras);
    }
    const overrides = appearance.creatureColorOverrides || {};
    const opacity = normalizeOpacity(appearance.animalOpacity);
    const hatId = appearance.animalHatId || 'none';
    const hatOptions = hatOptionsCache || [];
    const signature = controlsStateSignature(kind, appearance, hatOptions);
    if (!force && extras.isConnected && signature === controlsSignature) {
      refreshDebug();
      return;
    }
    controlsSignature = signature;
    const colorRows = colorLayersFor(kind).map(layerId => {
      const current = normalizeHex(overrides[layerId]) || normalizeHex(appearance.creatureGenotype?.[layerId]?.color) || '#FFFFFF';
      return `<div class="row" style="margin-top:6px;align-items:center"><label style="flex:1;margin:0">${esc(title(layerId))} custom hex<input type="text" inputmode="text" class="animalNpcCustomHex" data-layer="${esc(layerId)}" value="${esc(current)}" placeholder="#RRGGBB" spellcheck="false" autocomplete="off"></label><button type="button" class="secondary animalNpcClearHex" data-layer="${esc(layerId)}" style="flex:0 0 auto">Use preset</button></div>`;
    }).join('');
    extras.innerHTML = `
      <div class="hr"></div>
      <div class="help"><b>Fey / custom color overrides</b><br>Breeding colors above are presets only. Each base/pattern layer has its own independent #RRGGBB override and is not clamped to animal genetics.</div>
      ${colorRows}
      <div class="hr"></div>
      <label>In-game opacity <span id="animalNpcOpacityLabel">${Math.round(opacity * 100)}%</span><input id="animalNpcOpacity" type="range" min="0" max="1" step=".01" value="${opacity}"></label>
      <div class="hr"></div>
      <label>Hat<select id="animalNpcHatSelect"><option value="none">No hat</option>${hatOptions.filter(option => option?.id && option.id !== 'none').map(option => `<option value="${esc(option.id)}" ${option.id === hatId ? 'selected' : ''}>${esc(option.label || option.id)}</option>`).join('')}</select></label>
      <div class="help">Hats use the selected creature species' attachment authored in the Animal Head Rig Painter. If no custom attachment exists yet, a fallback is derived from the painted Head region.</div>
      <div id="animalNpcFeyDebug" class="help" style="margin-top:8px;word-break:break-word"></div>`;

    extras.querySelectorAll('.animalNpcCustomHex').forEach(input => {
      input.addEventListener('change', () => setCustomColor(input.dataset.layer, input.value));
      input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); input.blur(); } });
    });
    extras.querySelectorAll('.animalNpcClearHex').forEach(button => button.addEventListener('click', () => clearCustomColor(button.dataset.layer)));
    $('animalNpcOpacity')?.addEventListener('input', () => { const value = normalizeOpacity($('animalNpcOpacity').value); $('animalNpcOpacityLabel').textContent = `${Math.round(value * 100)}%`; });
    $('animalNpcOpacity')?.addEventListener('change', () => { const appearanceNow = parseAppearance(); writeAppearance({ ...appearanceNow, animalOpacity: normalizeOpacity($('animalNpcOpacity').value) }, `opacity → ${$('animalNpcOpacity').value}`); });
    $('animalNpcHatSelect')?.addEventListener('change', () => { const appearanceNow = parseAppearance(); writeAppearance({ ...appearanceNow, animalHatId: $('animalNpcHatSelect').value || 'none' }, `hat → ${$('animalNpcHatSelect').value}`); });
    refreshDebug();
    if (!hatOptionsCache && !hatOptionsPromise) ensureHatOptions().then(() => injectControls(true));
  }

  function refreshDebug() {
    const el = $('animalNpcFeyDebug');
    if (!el) return;
    const appearance = parseAppearance();
    el.textContent = `Debug: ${JSON.stringify({ action: debugState.lastAction, render: debugState.lastRender, opacity: normalizeOpacity(appearance.animalOpacity), hat: appearance.animalHatId || 'none', overrides: appearance.creatureColorOverrides || {}, error: debugState.lastError })}`;
    window.__animalNpcFeyExtrasDebug = { ...debugState, controlsSignature, appearance: clone(appearance) };
  }

  function docsUrl(path) { return new URL(path, DOCS_BASE).href; }
  function speciesMeta(kind) {
    const live = window.CreatureGeneticsRender?.SPECIES?.[kind];
    if (live) return live;
    const fallback = ANIMAL_META[kind];
    if (!fallback) return null;
    return { prefix: fallback.prefix, singleFrame: !!fallback.singleFrame, base: { idle: `assets/creaturesprites/${fallback.base}` }, patterns: kind === 'uumkaoii' ? ['fur', 'plates'] : patternIdsFor(kind), ...(fallback.eyes ? { eyes: { open: `assets/creaturesprites/${fallback.eyes}` } } : {}) };
  }
  function patternUrl(kind, patternId) {
    const meta = speciesMeta(kind);
    return meta?.singleFrame ? docsUrl(`assets/creaturesprites/patterns/${meta.prefix}_${patternId}.png`) : docsUrl(`assets/creaturesprites/patterns/${meta.prefix}_${patternId}_idle.png`);
  }
  function loadImage(url) {
    if (imageCache.has(url)) return imageCache.get(url);
    const promise = new Promise((resolve, reject) => { const image = new Image(); image.crossOrigin = 'anonymous'; image.onload = () => resolve(image); image.onerror = () => reject(new Error(`Failed to load ${url}`)); image.src = url; }).catch(error => { imageCache.delete(url); throw error; });
    imageCache.set(url, promise); return promise;
  }
  function makeCanvas(width, height) { const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas; }
  function decodeMask(encoded) {
    if (!encoded || encoded.encoding !== 'selected-pixel-index-runs-v1') return null;
    const data = new Uint8Array(Number(encoded.width) * Number(encoded.height));
    for (let i = 0; i + 1 < (encoded.runs || []).length; i += 2) { const start = Number(encoded.runs[i]), length = Number(encoded.runs[i + 1]); if (Number.isInteger(start) && Number.isInteger(length) && start >= 0 && length >= 0 && start + length <= data.length) data.fill(1, start, start + length); }
    return { width: Number(encoded.width), height: Number(encoded.height), data };
  }
  function loadMasks() {
    if (masksPromise) return masksPromise;
    masksPromise = fetch(docsUrl('config/creature-base-masks.json')).then(response => response.json()).then(raw => { const decoded = {}; for (const [kind, frames] of Object.entries(raw || {})) { decoded[kind] = {}; for (const [frame, encoded] of Object.entries(frames || {})) decoded[kind][frame] = decodeMask(encoded); } return decoded; }).catch(() => ({}));
    return masksPromise;
  }
  function hexRgb(hex) { const value = Number.parseInt(String(hex || '#888888').replace('#', ''), 16); return [(value >> 16) & 255, (value >> 8) & 255, value & 255]; }
  function tintConfig() { const cfg = window.SCRATCHBONES_CONFIG?.game?.portrait?.tinting || {}; return { shadowFloor: Number(cfg.shadowFloor) || .18, highlightBoost: Number(cfg.highlightBoost) || 1.18, neutralLuminance: Number(cfg.neutralLuminance) || .55, gamma: Number(cfg.gamma) || 1, preserveNearBlackOutlines: cfg.preserveNearBlackOutlines !== false, outlineThreshold: Number.isFinite(Number(cfg.outlineThreshold)) ? Number(cfg.outlineThreshold) : .08 }; }
  function recolorPixels(pixels, rgb, predicate) {
    const cfg = tintConfig(), neutral = Math.max(.0001, cfg.neutralLuminance);
    for (let i = 0; i < pixels.length; i += 4) { if (!pixels[i + 3] || (predicate && !predicate(i))) continue; const lum = (.2126 * pixels[i] + .7152 * pixels[i + 1] + .0722 * pixels[i + 2]) / 255; if (cfg.preserveNearBlackOutlines && lum <= cfg.outlineThreshold) continue; const shade = Math.max(cfg.shadowFloor, Math.min(cfg.highlightBoost, Math.pow(Math.max(0, lum) / neutral, cfg.gamma))); pixels[i] = Math.round(rgb[0] * shade); pixels[i + 1] = Math.round(rgb[1] * shade); pixels[i + 2] = Math.round(rgb[2] * shade); }
  }
  async function recoloredSource(url, color, mask) {
    const key = `${url}|${color}|${mask ? 'mask' : 'all'}`; if (recolorCache.has(key)) return recolorCache.get(key);
    const promise = (async () => { const image = await loadImage(url); const canvas = makeCanvas(image.naturalWidth || image.width, image.naturalHeight || image.height), ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0); const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height); recolorPixels(imageData.data, hexRgb(color), mask ? index => !!mask.data[index / 4] : null); ctx.putImageData(imageData, 0, 0); return canvas; })();
    recolorCache.set(key, promise); return promise;
  }

  async function composeAnimal(appearance) {
    const kind = activeKind(appearance), meta = speciesMeta(kind); if (!kind || !meta) return null;
    const genotype = genotypeWithOverrides(appearance), masks = await loadMasks(), mask = masks?.[kind]?.idle || null;
    const storedBaseColor = genotype?.base?.color, stripes = genotype?.bodystripes;
    const swap = kind === 'drenkirra' && storedBaseColor && stripes?.enabled && Number(stripes.copies) > 0 && stripes.color;
    const baseColor = swap ? stripes.color : storedBaseColor;
    const baseUrl = docsUrl(meta.base?.idle || `assets/creaturesprites/${ANIMAL_META[kind]?.base || ''}`);
    const baseSource = baseColor && mask ? await recoloredSource(baseUrl, baseColor, mask) : await loadImage(baseUrl);
    const width = baseSource.naturalWidth || baseSource.width, height = baseSource.naturalHeight || baseSource.height, output = makeCanvas(width, height), ctx = output.getContext('2d'); ctx.drawImage(baseSource, 0, 0, width, height);
    for (const patternId of (kind === 'uumkaoii' ? ['fur', 'plates'] : patternIdsFor(kind))) { const layer = genotype?.[patternId]; if (!layer?.color || Number(layer.copies) <= 0 || layer.enabled === false) continue; const renderColor = swap && patternId === 'bodystripes' ? storedBaseColor : layer.color; try { ctx.drawImage(await recoloredSource(patternUrl(kind, patternId), renderColor, null), 0, 0, width, height); } catch (_) {} }
    if (meta.eyes?.open) try { ctx.drawImage(await loadImage(docsUrl(meta.eyes.open)), 0, 0, width, height); } catch (_) {}
    return window.AnimalNpcHeadwear?.composeWithHat ? window.AnimalNpcHeadwear.composeWithHat(output, kind, appearance) : output;
  }

  function fitToCanvas(source, target, appearance, options = {}) {
    if (!source || !target?.getContext) return false; const width = source.width || source.naturalWidth, height = source.height || source.naturalHeight; if (!width || !height) return false;
    const ctx = target.getContext('2d'); ctx.clearRect(0, 0, target.width, target.height); const padding = Math.max(2, Math.round(Math.min(target.width, target.height) * .04)), scale = Math.min((target.width - padding * 2) / width, (target.height - padding * 2) / height), dw = width * scale, dh = height * scale, x = (target.width - dw) / 2, y = (target.height - dh) / 2;
    ctx.save(); ctx.globalAlpha = normalizeOpacity(appearance.animalOpacity); if (options.portraitView === 'behind' || options.view === 'behind') { ctx.translate(target.width, 0); ctx.scale(-1, 1); ctx.drawImage(source, target.width - x - dw, y, dw, dh); } else ctx.drawImage(source, x, y, dw, dh); ctx.restore(); return true;
  }

  function appearanceRenderSignature(appearance) {
    return JSON.stringify([activeKind(appearance), appearance.creatureGenotype || null, appearance.creatureColorOverrides || null, normalizeOpacity(appearance.animalOpacity), appearance.animalHatId || 'none']);
  }

  async function renderAnimal(target, appearance, options = {}) {
    const epoch = (renderEpochByCanvas.get(target) || 0) + 1;
    renderEpochByCanvas.set(target, epoch);
    const startedSignature = appearanceRenderSignature(appearance);
    try {
      const source = await composeAnimal(appearance);
      if (renderEpochByCanvas.get(target) !== epoch) return true;
      const liveAppearance = target?.id === 'apCanvas' && window.__characterStudioAnimalAppearance
        ? window.__characterStudioAnimalAppearance
        : appearance;
      if (target?.id === 'apCanvas' && appearanceRenderSignature(liveAppearance) !== startedSignature) return true; // Leave the last valid frame in place; the next animation tick renders the new state.
      const ok = fitToCanvas(source, target, liveAppearance, options);
      debugState.lastRender = ok ? `fey:${activeKind(liveAppearance)}` : 'fey-failed'; debugState.lastError = ok ? null : 'canvas unavailable'; refreshDebug(); return ok;
    } catch (error) { debugState.lastError = error.message; debugState.lastRender = 'failed'; refreshDebug(); return false; }
  }

  function appearanceFromProfile(profile) {
    const kind = normalizeKind(profile?.creatureKind || profile?.animalKind); if (!kind) return null;
    return { ...(profile?.appearance || {}), avatarType: 'animal', creatureKind: kind, creatureGenotype: profile?.creatureGenotype || profile?.genotype || profile?.appearance?.creatureGenotype, animalOpacity: profile?.animalOpacity ?? profile?.appearance?.animalOpacity, animalHatId: profile?.animalHatId || profile?.appearance?.animalHatId };
  }

  function installRenderHooks() {
    const preview = window.NpcAvatarPreview;
    if (preview?.renderProfileToCanvas && !preview.renderProfileToCanvas.__animalNpcFeyExtrasWrapped) {
      const original = preview.renderProfileToCanvas;
      const wrapped = async function feyAwarePreview(canvas, profile, options = {}) { const appearance = appearanceFromProfile(profile) || (!canvas?.dataset?.portraitId ? window.__characterStudioAnimalAppearance : null); if (appearance?.avatarType === 'animal' && activeKind(appearance)) { const ok = await renderAnimal(canvas, appearance, options); if (ok) return canvas; } return original.call(preview, canvas, profile, options); };
      wrapped.__animalNpcFeyExtrasWrapped = true;
      if (original.__characterStudioAnimalAppearanceWrapped) wrapped.__characterStudioAnimalAppearanceWrapped = true; // Preserve the inner installer's marker so its 250 ms poll does not wrap this function again.
      preview.renderProfileToCanvas = wrapped;
    }
    if (typeof window.renderProfile === 'function' && !window.renderProfile.__animalNpcFeyExtrasWrapped) {
      const original = window.renderProfile;
      const wrapped = async function feyAwarePortrait(canvas, profile, options = {}) { const appearance = appearanceFromProfile(profile) || (canvas?.id === 'apCanvas' ? window.__characterStudioAnimalAppearance : null); if (appearance?.avatarType === 'animal' && activeKind(appearance)) { const ok = await renderAnimal(canvas, appearance, options); if (ok) return canvas; } return original(canvas, profile, options); };
      wrapped.__animalNpcFeyExtrasWrapped = true;
      if (original.__characterStudioAnimalAppearanceWrapped) wrapped.__characterStudioAnimalAppearanceWrapped = true; // Stops base/extras wrappers from alternately nesting forever and flashing opaque frames.
      window.renderProfile = wrapped;
      if (window.renderPortraitProfile === original) window.renderPortraitProfile = wrapped;
    }
  }

  function install() {
    if (!window.CharacterStudioAnimalAppearance || !$('appearanceJson')) return setTimeout(install, 50);
    if (!debugState.installed) {
      debugState.installed = true; debugState.lastAction = 'installed';
      document.addEventListener('click', event => { const swatch = event.target.closest?.('.animalNpcColor'); if (swatch?.dataset?.layer) clearCustomColor(swatch.dataset.layer); }, true); // Choosing a breeding swatch intentionally clears the custom override for that layer.
      ensureHatOptions().then(() => injectControls(true));
    }
    installRenderHooks(); injectControls(false); refreshDebug();
  }

  window.CharacterStudioAnimalFeyExtras = { install, normalizeHex, normalizeOpacity, genotypeWithOverrides, renderAnimal, getDebug: () => ({ ...debugState, controlsSignature, appearance: clone(parseAppearance()) }) };
  setInterval(install, 200);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true }); else install();
})();
