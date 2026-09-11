// Animal NPC appearance extension for Hobunji Character Studio.
// Keeps creature form/genotype authoring in the existing NPC appearance JSON
// while reusing the breeding palette + genotype shape and creature sprite assets.
(function () {
  'use strict';

  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (!/\/tools\/character-studio\//.test(location.pathname || '')) return;

  const MODULE_SCRIPT_URL = document.currentScript?.src || ''; // Used to resolve docs-relative creature assets from the nested Character Studio path.
  const DOCS_BASE_URL = MODULE_SCRIPT_URL ? new URL('../', MODULE_SCRIPT_URL).href : '../../'; // Used by the standalone editor compositor for masks and creature sprites.
  const LEGACY_ANIMAL_NPCS = Object.freeze({ banubu: 'grehlr', hiki_hiki: 'drenkirra', hikihiki: 'drenkirra' }); // Used to migrate the two existing animal NPCs into explicit appearance data.
  const FALLBACK_PATTERNS = Object.freeze({
    'gar-wolf': ['colorpoint', 'foxtail', 'mitts'],
    'dabinggi-hound': ['mitts', 'spectacles', 'stripes'],
    grehlr: ['mitts', 'spectacles', 'coloredstripe'],
    drenkirra: ['bodystripes', 'spectacles'],
  }); // Used only until creature-genetics.js finishes loading in this standalone tool.
  const PATTERN_PALETTE_RULES = Object.freeze({
    grehlr: Object.freeze({ coloredstripe: Object.freeze({ minLightnessColorId: 'fawn' }) }),
  }); // Mirrors creature-genetics.js so editor choices obey the same pattern-specific breeding constraints.
  const ANIMAL_META = Object.freeze({
    grehlr: { label: 'Grehlr', prefix: 'grehlr', base: 'grehlr_idle.png', eyes: 'grehlr_eye.png' },
    drenkirra: { label: 'Drenkirra', prefix: 'drnk', base: 'drenkirra_idle.png', eyes: 'drenkirra_eye.png' },
    'gar-wolf': { label: 'Gar-wolf', prefix: 'gw', base: 'gar-wolf_idle.png', eyes: 'gar-wolf_eye.png' },
    'dabinggi-hound': { label: 'Dabinggi-hound', prefix: 'dh', base: 'dabinggi-hound_idle.png', eyes: 'dabinggi-hound_eye.png' },
    uumkaoii: { label: "Uumkao'ii", prefix: 'uum', base: "uumkao'ii.png", singleFrame: true },
  }); // Used for species buttons and the editor-only fallback compositor.
  const debugState = {
    installed: false,
    target: 'player',
    npcId: null,
    npcName: null,
    kind: null,
    lastAction: 'boot',
    lastRender: null,
    lastError: null,
  }; // Shown in the on-page debug readout so mobile testing does not require DevTools.

  let card = null; // Injected Animal NPC card used by syncUi().
  let controls = null; // Container repainted whenever the selected NPC/genotype changes.
  let debugEl = null; // Mobile-visible debug line updated with the latest animal appearance state.
  let lastSyncSignature = ''; // Prevents the polling bridge from rebuilding unchanged editor controls.
  let maskPromise = null; // Caches decoded creature base masks used by the standalone editor preview.
  const imageCache = new Map(); // Caches creature sprite/pattern image requests within Character Studio.
  const recolorCache = new Map(); // Caches recolored source canvases keyed by URL+color.

  function $(id) { return document.getElementById(id); }
  function esc(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function normalizeNpcKey(value) {
    return String(value || '').trim().toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }
  function normalizeKind(value) {
    return String(value || '').trim().toLowerCase().replace(/_/g, '-');
  }
  function title(value) {
    return String(value || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
  function currentNpcIdentity() {
    return { id: $('npcId')?.value || '', name: $('npcName')?.value || '' };
  }
  function isNpcTarget() {
    const applyButton = $('applyNpcBtn'); // Existing Character Studio state flag: enabled only while the Appearance tab is targeting an NPC.
    return !!applyButton && !applyButton.disabled;
  }
  function parseAppearance() {
    try {
      const raw = $('appearanceJson')?.value || '{}'; // Raw editor JSON is the bridge to the Character Studio's closed-over working state.
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
      debugState.lastError = `appearance JSON: ${error.message}`;
      return {};
    }
  }
  function explicitKind(appearance) {
    if (!appearance || appearance.avatarType === 'person') return null;
    const kind = normalizeKind(appearance.creatureKind || appearance.animalKind); // Explicit animal kind stored in the shared appearance payload.
    return kind || (appearance.avatarType === 'animal' ? 'grehlr' : null);
  }
  function legacyKindForCurrentNpc() {
    const identity = currentNpcIdentity(); // Current DB fields identify legacy Banubu/Hiki-hiki records even before explicit animal fields exist.
    return LEGACY_ANIMAL_NPCS[normalizeNpcKey(identity.id)] || LEGACY_ANIMAL_NPCS[normalizeNpcKey(identity.name)] || null;
  }
  function activeKind(appearance = parseAppearance()) {
    return explicitKind(appearance) || (isNpcTarget() ? legacyKindForCurrentNpc() : null);
  }
  function isAnimalAppearance(appearance = parseAppearance()) {
    return !!activeKind(appearance) && appearance.avatarType !== 'person';
  }
  function hexRgb(hex) {
    const match = String(hex || '').trim().match(/^#?([0-9a-f]{6})$/i);
    if (!match) return null;
    const value = Number.parseInt(match[1], 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  }
  function rgbToLabLightness(rgb) {
    if (!rgb) return -Infinity;
    const linear = component => {
      const value = component / 255;
      return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
    };
    const r = linear(rgb[0]), g = linear(rgb[1]), b = linear(rgb[2]);
    const y = (r * 0.2126729 + g * 0.7151522 + b * 0.072175) / 1.0;
    const e = 216 / 24389, k = 24389 / 27;
    const fy = y > e ? Math.cbrt(y) : (k * y + 16) / 116;
    return 116 * fy - 16;
  }
  function hexToHsv(hex) {
    const rgb = hexRgb(hex);
    if (!rgb) return null;
    let [r, g, b] = rgb.map(value => value / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
    let h = 0;
    if (delta) {
      if (max === r) h = ((g - b) / delta) % 6;
      else if (max === g) h = (b - r) / delta + 2;
      else h = (r - g) / delta + 4;
      h /= 6;
      if (h < 0) h += 1;
    }
    return [h, max === 0 ? 0 : delta / max, max];
  }
  function paletteFor(kind, patternId = null) {
    const palettes = window.SCRATCHBONES_CONFIG?.game?.creatureGenetics?.palettes || {}; // Same palette object consumed by creature-genetics.js during buying, wild rolls, and breeding.
    const selected = palettes[kind] || palettes.default || [];
    const entries = Array.isArray(selected) ? selected.filter(entry => entry?.hex) : [];
    const rule = PATTERN_PALETTE_RULES[kind]?.[patternId] || null; // Pattern-specific restrictions mirror breeding's _patternPalette().
    if (!rule?.minLightnessColorId || !entries.length) return entries;
    const threshold = entries.find(entry => entry.id === rule.minLightnessColorId);
    if (!threshold) return entries;
    const minimumLightness = rgbToLabLightness(hexRgb(threshold.hex)); // Same CIE-Lab L* threshold used by creature-genetics.js.
    const filtered = entries.filter(entry => rgbToLabLightness(hexRgb(entry.hex)) >= minimumLightness);
    return filtered.length ? filtered : entries;
  }
  function normalizedPaletteColor(color, palette) {
    if (!Array.isArray(palette) || !palette.length) return color || null;
    const normalized = String(color || '').toLowerCase();
    const exact = palette.find(entry => String(entry.hex || '').toLowerCase() === normalized);
    if (exact) return exact.hex;
    const source = hexToHsv(color);
    if (!source) return palette[0].hex;
    let best = palette[0], bestScore = Infinity;
    for (const entry of palette) {
      const candidate = hexToHsv(entry.hex);
      if (!candidate) continue;
      let hueDistance = Math.abs(source[0] - candidate[0]);
      hueDistance = Math.min(hueDistance, 1 - hueDistance);
      const score = hueDistance * hueDistance * 2.5 + Math.pow(source[1] - candidate[1], 2); // Same nearest-palette metric as creature-genetics.js.
      if (score < bestScore) { bestScore = score; best = entry; }
    }
    return best.hex;
  }
  function patternIdsFor(kind) {
    const authored = window.CreatureGenetics?.PATTERN_DEFS?.[kind]; // Preferred source of truth from the breeding module when available.
    return Array.isArray(authored) ? authored : (FALLBACK_PATTERNS[kind] || []);
  }
  function defaultAnimalGenotype(kind) {
    const palette = paletteFor(kind); // Supplies breeding-authored colors for initial editable genotype fields.
    const firstColor = palette[0]?.hex || '#8c7a66'; // Used as the default base/fur region color.
    const secondColor = palette[1]?.hex || firstColor; // Used as the default optional-pattern/secondary-region fallback color.
    if (kind === 'uumkaoii') {
      return {
        fur: { color: firstColor, copies: 2, inheritance: 'dominant' },
        plates: { color: secondColor, copies: 2, inheritance: 'dominant' },
        sizeClass: 'medium',
      };
    }
    const genotype = { base: { color: firstColor, copies: 2, inheritance: 'dominant' }, sizeClass: 'medium' }; // Exact base/pattern object shape expected by CreatureGeneticsRender and breeding records.
    for (const patternId of patternIdsFor(kind)) {
      const patternPalette = paletteFor(kind, patternId); // Applies breeding's pattern-specific palette rules to authored defaults too.
      const patternColor = patternPalette[1]?.hex || patternPalette[0]?.hex || secondColor;
      genotype[patternId] = { color: patternColor, copies: 0, inheritance: 'dominant', enabled: false };
    }
    return genotype;
  }
  function normalizeGenotype(kind, source) {
    const genotype = source && typeof source === 'object' ? clone(source) : defaultAnimalGenotype(kind); // Editable copy prevents UI mutations from sharing nested objects with imported JSON.
    const defaults = defaultAnimalGenotype(kind); // Supplies missing legacy/imported fields without rerolling any authored values.
    genotype.sizeClass = ['small', 'medium', 'large'].includes(genotype.sizeClass) ? genotype.sizeClass : (defaults.sizeClass || 'medium');
    if (kind === 'uumkaoii') {
      for (const region of ['fur', 'plates']) genotype[region] = { ...(defaults[region] || {}), ...(genotype[region] || {}), copies: 2, inheritance: 'dominant' };
      return genotype;
    }
    genotype.base = { ...defaults.base, ...(genotype.base || {}), copies: 2, inheritance: 'dominant' };
    for (const patternId of patternIdsFor(kind)) {
      const layer = { ...(defaults[patternId] || {}), ...(genotype[patternId] || {}) }; // Normalized layer feeds both UI toggles and runtime compositor.
      const enabled = layer.enabled !== false && Number(layer.copies) > 0; // Breeding renderer treats copies>0 plus non-false enabled as expressed.
      layer.color = normalizedPaletteColor(layer.color, paletteFor(kind, patternId)); // Invalid imported colors are snapped into the same legal breeding palette for this pattern.
      genotype[patternId] = { ...layer, copies: enabled ? Math.max(1, Number(layer.copies) || 1) : 0, inheritance: layer.inheritance || 'dominant', enabled };
    }
    return genotype;
  }
  function animalizedAppearance(source, kind) {
    const appearance = { ...(source || {}) }; // Preserves dormant human fields so switching back to Person is lossless.
    appearance.avatarType = 'animal';
    appearance.creatureKind = kind;
    appearance.creatureGenotype = normalizeGenotype(kind, appearance.creatureGenotype || appearance.genotype);
    delete appearance.animalKind;
    delete appearance.genotype;
    return appearance;
  }

  function writeAppearance(nextAppearance, action) {
    const textarea = $('appearanceJson'); // Existing raw appearance field is the authoritative path into read() and the selected NPC database record.
    if (!textarea) return false;
    textarea.value = JSON.stringify(nextAppearance, null, 2);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    debugState.lastAction = action || 'appearance updated';
    debugState.lastError = null;
    window.__characterStudioAnimalAppearance = clone(nextAppearance); // Read by preview hooks for scratch canvases that do not carry NPC ids.
    const editButton = $('editAvatarBtn'); // Reloads the studio's private `work` object from the just-updated NPC record.
    if (isNpcTarget() && editButton) setTimeout(() => editButton.click(), 0);
    setTimeout(() => syncUi(true), 0);
    return true;
  }

  function setAnimalMode(enabled) {
    if (!isNpcTarget()) return;
    const appearance = parseAppearance(); // Current payload is modified in place only through a cloned object below.
    if (!enabled) {
      writeAppearance({ ...appearance, avatarType: 'person' }, 'switched to person');
      return;
    }
    const kind = activeKind(appearance) || 'grehlr'; // Grehlr is the neutral first animal option and Banubu's current authored kind.
    writeAppearance(animalizedAppearance(appearance, kind), `switched to animal (${kind})`);
  }
  function setAnimalKind(kind) {
    if (!isNpcTarget() || !ANIMAL_META[kind]) return;
    const appearance = parseAppearance(); // Existing dormant human fields are preserved while the animal kind/genotype is replaced.
    const previousKind = explicitKind(appearance); // Used to retain genotype only when the selected animal species did not change.
    const next = { ...appearance, avatarType: 'animal', creatureKind: kind };
    next.creatureGenotype = previousKind === kind
      ? normalizeGenotype(kind, appearance.creatureGenotype || appearance.genotype)
      : defaultAnimalGenotype(kind);
    delete next.animalKind;
    delete next.genotype;
    writeAppearance(next, `animal kind → ${kind}`);
  }
  function updateGenotype(mutator, action) {
    if (!isNpcTarget()) return;
    const appearance = parseAppearance(); // Source appearance is copied so the DB update remains one atomic JSON mutation.
    const kind = activeKind(appearance);
    if (!kind) return;
    const genotype = normalizeGenotype(kind, appearance.creatureGenotype || appearance.genotype); // Same object shape breeding stores on animals.
    mutator(genotype);
    writeAppearance({ ...appearance, avatarType: 'animal', creatureKind: kind, creatureGenotype: normalizeGenotype(kind, genotype) }, action); // Re-normalize after mutations so pattern-specific palette rules cannot be bypassed.
  }

  function swatchButtons(kind, layerId, selectedColor) {
    const palette = paletteFor(kind, layerId); // Exact breeding palette for this specific base/region/pattern layer, including Grehlr colored-stripe restrictions.
    return palette.map(entry => {
      const active = String(entry.hex).toLowerCase() === String(selectedColor || '').toLowerCase(); // Marks the currently authored allele color.
      return `<button type="button" class="colorSwatch animalNpcColor ${active ? 'swatchActive' : ''}" data-layer="${esc(layerId)}" data-color="${esc(entry.hex)}" title="${esc(entry.name || entry.id || entry.hex)}" style="background:${esc(entry.hex)}"></button>`;
    }).join('');
  }
  function renderAnimalControls(kind, appearance) {
    if (!controls) return;
    const genotype = normalizeGenotype(kind, appearance.creatureGenotype || appearance.genotype); // Normalized view prevents malformed imported JSON from breaking controls.
    const speciesButtons = Object.entries(ANIMAL_META).map(([id, meta]) =>
      `<button type="button" class="selBtn animalNpcSpecies ${id === kind ? 'selected' : ''}" data-kind="${esc(id)}">${esc(meta.label)}</button>`
    ).join('');
    let geneticsHtml = '';
    if (kind === 'uumkaoii') {
      geneticsHtml = ['fur', 'plates'].map(region => `
        <div class="hr"></div>
        <div class="cosmeticRow" style="align-items:flex-start">
          <div class="cosmeticLabel">${esc(title(region))}</div>
          <div class="selGroup" style="flex:1">${swatchButtons(kind, region, genotype[region]?.color)}</div>
        </div>`).join('');
    } else {
      geneticsHtml = `
        <div class="hr"></div>
        <div class="cosmeticRow" style="align-items:flex-start">
          <div class="cosmeticLabel">Base coat</div>
          <div class="selGroup" style="flex:1">${swatchButtons(kind, 'base', genotype.base?.color)}</div>
        </div>`;
      for (const patternId of patternIdsFor(kind)) {
        const layer = genotype[patternId] || {}; // Supplies toggle/color state for this breeding-authored pattern allele.
        geneticsHtml += `
          <div class="hr"></div>
          <div class="row" style="justify-content:space-between;align-items:center">
            <label style="margin:0;display:flex;align-items:center;gap:7px;color:var(--text)">
              <input type="checkbox" class="animalNpcPatternToggle" data-pattern="${esc(patternId)}" ${layer.enabled && Number(layer.copies) > 0 ? 'checked' : ''} style="width:auto">
              ${esc(title(patternId))}
            </label>
            <span class="sectionTag">breeding pattern</span>
          </div>
          <div class="selGroup" style="margin-top:7px">${swatchButtons(kind, patternId, layer.color)}</div>`;
      }
    }
    controls.innerHTML = `
      <div class="help" style="margin-bottom:7px">Animal species</div>
      <div class="selGroup">${speciesButtons}</div>
      ${geneticsHtml}
      <div class="row" style="margin-top:10px">
        <button type="button" id="animalNpcResetCoat" class="secondary">Reset coat</button>
        <button type="button" id="animalNpcCopyJson" class="secondary">Copy animal JSON</button>
      </div>`;

    controls.querySelectorAll('.animalNpcSpecies').forEach(button => {
      button.addEventListener('click', () => setAnimalKind(button.dataset.kind));
    });
    controls.querySelectorAll('.animalNpcColor').forEach(button => {
      button.addEventListener('click', () => {
        const layerId = button.dataset.layer; // Identifies base/pattern/dual-region allele being recolored.
        const color = button.dataset.color; // Exact palette hex persisted into creatureGenotype.
        updateGenotype(genotypeDraft => {
          if (layerId === 'base') genotypeDraft.base = { ...(genotypeDraft.base || {}), color, copies: 2, inheritance: 'dominant' };
          else genotypeDraft[layerId] = { ...(genotypeDraft[layerId] || {}), color };
        }, `${layerId} color → ${color}`);
      });
    });
    controls.querySelectorAll('.animalNpcPatternToggle').forEach(input => {
      input.addEventListener('change', () => {
        const patternId = input.dataset.pattern; // Identifies the optional breeding pattern being expressed/hidden.
        updateGenotype(genotypeDraft => {
          const layer = { ...(genotypeDraft[patternId] || {}) }; // Updated allele keeps its selected color/inheritance while expression changes.
          layer.enabled = input.checked;
          layer.copies = input.checked ? Math.max(1, Number(layer.copies) || 1) : 0;
          layer.inheritance = layer.inheritance || 'dominant';
          genotypeDraft[patternId] = layer;
        }, `${patternId} ${input.checked ? 'enabled' : 'disabled'}`);
      });
    });
    controls.querySelector('#animalNpcResetCoat')?.addEventListener('click', () => {
      const appearanceNow = parseAppearance(); // Preserves non-animal appearance fields while resetting only the selected animal genotype.
      writeAppearance({ ...appearanceNow, avatarType: 'animal', creatureKind: kind, creatureGenotype: defaultAnimalGenotype(kind) }, `reset ${kind} coat`);
    });
    controls.querySelector('#animalNpcCopyJson')?.addEventListener('click', async () => {
      const payload = { creatureKind: kind, creatureGenotype: normalizeGenotype(kind, parseAppearance().creatureGenotype) }; // Compact authoring payload useful for mobile bug reports.
      try {
        await navigator.clipboard?.writeText(JSON.stringify(payload, null, 2));
        debugState.lastAction = 'copied animal JSON';
      } catch (error) {
        debugState.lastError = `copy failed: ${error.message}`;
      }
      refreshDebug();
    });
  }

  function findHumanCards() {
    const apRight = $('apRight'); // Existing appearance editor column whose person-only cards are hidden in animal mode.
    return {
      species: $('speciesControls')?.closest('.card') || null,
      cosmetics: $('cosmeticControls')?.closest('.card') || null,
      colors: $('colorPickerSection')?.closest('.card') || null,
      collections: $('collectionsControls')?.closest('.card') || null,
      apRight,
    };
  }
  function refreshDebug() {
    if (!debugEl) return;
    const snapshot = {
      target: debugState.target,
      npc: debugState.npcId || null,
      kind: debugState.kind || null,
      action: debugState.lastAction,
      render: debugState.lastRender,
      error: debugState.lastError,
    }; // Minimal on-page snapshot keeps mobile diagnostics readable.
    debugEl.textContent = `Debug: ${JSON.stringify(snapshot)}`;
    window.__animalNpcAppearanceDebug = { ...debugState, appearance: isNpcTarget() ? clone(parseAppearance()) : null };
  }
  function ensureCard() {
    if (card?.isConnected) return true;
    const parts = findHumanCards(); // Places animal form controls immediately before the existing Species & gender card.
    if (!parts.apRight || !parts.species) return false;
    card = document.createElement('div');
    card.id = 'animalNpcAppearanceCard';
    card.className = 'card section';
    card.style.cssText = '--sec:#f59e0b;--secBg:rgba(245,158,11,.10)';
    card.innerHTML = `
      <div class="sectionTitle"><b>Character form</b><span class="sectionTag">person · animal</span></div>
      <div class="selGroup" id="animalNpcFormButtons">
        <button type="button" id="animalNpcPersonBtn" class="selBtn">Person</button>
        <button type="button" id="animalNpcAnimalBtn" class="selBtn">Animal</button>
      </div>
      <div class="help" id="animalNpcModeHelp" style="margin-top:7px"></div>
      <div id="animalNpcGeneticsControls" style="margin-top:9px"></div>
      <div class="help" id="animalNpcDebug" style="margin-top:10px;word-break:break-word"></div>`;
    parts.apRight.insertBefore(card, parts.species);
    controls = card.querySelector('#animalNpcGeneticsControls');
    debugEl = card.querySelector('#animalNpcDebug');
    card.querySelector('#animalNpcPersonBtn')?.addEventListener('click', () => setAnimalMode(false));
    card.querySelector('#animalNpcAnimalBtn')?.addEventListener('click', () => setAnimalMode(true));
    return true;
  }

  function migrateLegacyAnimalNpc() {
    if (!isNpcTarget()) return false;
    const appearance = parseAppearance(); // Legacy records currently have ordinary human appearance fields and no animal discriminator.
    if (appearance.avatarType === 'person' || explicitKind(appearance)) return false;
    const kind = legacyKindForCurrentNpc(); // Banubu/Hiki-hiki compatibility mapping becomes explicit once the NPC is edited.
    if (!kind) return false;
    writeAppearance(animalizedAppearance(appearance, kind), `migrated legacy ${kind} NPC`);
    return true;
  }

  function syncUi(force = false) {
    if (!ensureCard()) return;
    if (migrateLegacyAnimalNpc()) return;
    const appearance = parseAppearance(); // Current selected NPC appearance determines whether person-only cards are visible.
    const animal = isNpcTarget() && isAnimalAppearance(appearance);
    const identity = currentNpcIdentity(); // Used for debug/status and signature de-duplication.
    const kind = animal ? activeKind(appearance) : null;
    const signature = JSON.stringify([isNpcTarget(), identity.id, identity.name, animal, kind, animal ? appearance.creatureGenotype : null]); // Prevents idle polling from touching DOM when nothing changed.
    if (!force && signature === lastSyncSignature) return;
    lastSyncSignature = signature;

    debugState.target = isNpcTarget() ? 'npc' : 'player';
    debugState.npcId = isNpcTarget() ? identity.id : null;
    debugState.npcName = isNpcTarget() ? identity.name : null;
    debugState.kind = kind;
    if (animal) window.__characterStudioAnimalAppearance = clone(appearance);
    else window.__characterStudioAnimalAppearance = null;

    const personButton = card.querySelector('#animalNpcPersonBtn'); // Existing form toggle styled to reflect current person/animal mode.
    const animalButton = card.querySelector('#animalNpcAnimalBtn'); // Disabled for the player because this feature intentionally targets NPC authoring only.
    personButton?.classList.toggle('selected', !animal);
    animalButton?.classList.toggle('selected', animal);
    if (animalButton) animalButton.disabled = !isNpcTarget();
    const help = card.querySelector('#animalNpcModeHelp'); // Explains why the Animal form button is unavailable while editing the player.
    if (help) help.textContent = isNpcTarget()
      ? 'Animal NPCs use the same creature genotype colors and pattern layers as breeding.'
      : 'Animal form is NPC-only; select an NPC in the database and edit its appearance.';
    if (controls) controls.style.display = animal ? '' : 'none';

    const parts = findHumanCards(); // Person-only appearance sections are hidden rather than destroyed so switching modes preserves all authored human values.
    for (const humanCard of [parts.species, parts.cosmetics, parts.colors, parts.collections]) {
      if (humanCard) humanCard.style.display = animal ? 'none' : '';
    }
    if (animal && kind) renderAnimalControls(kind, appearance);
    refreshDebug();
  }

  function docsUrl(path) { return new URL(path, DOCS_BASE_URL).href; }
  function speciesMeta(kind) {
    const live = window.CreatureGeneticsRender?.SPECIES?.[kind]; // Runtime metadata wins when the canonical breeding renderer happens to be loaded in the tool.
    if (live) return live;
    const fallback = ANIMAL_META[kind];
    if (!fallback) return null;
    return {
      prefix: fallback.prefix,
      singleFrame: !!fallback.singleFrame,
      base: { idle: `assets/creaturesprites/${fallback.base}` },
      patterns: kind === 'uumkaoii' ? ['fur', 'plates'] : patternIdsFor(kind),
      ...(fallback.eyes ? { eyes: { open: `assets/creaturesprites/${fallback.eyes}` } } : {}),
    };
  }
  function patternUrl(kind, patternId) {
    const meta = speciesMeta(kind); // Supplies the same filename prefix convention used by CreatureGeneticsRender.
    if (!meta) return null;
    return meta.singleFrame
      ? docsUrl(`assets/creaturesprites/patterns/${meta.prefix}_${patternId}.png`)
      : docsUrl(`assets/creaturesprites/patterns/${meta.prefix}_${patternId}_idle.png`);
  }
  function loadImage(url) {
    if (imageCache.has(url)) return imageCache.get(url);
    const request = new Promise((resolve, reject) => {
      const image = new Image(); // Used as the source for standalone editor recolor/composite passes.
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Failed to load ${url}`));
      image.src = url;
    }).catch(error => { imageCache.delete(url); throw error; });
    imageCache.set(url, request);
    return request;
  }
  function makeCanvas(width, height) {
    const canvas = document.createElement('canvas'); // Scratch surface used by base/pattern recolor passes before fitting into studio preview canvases.
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  function decodeMask(encoded) {
    if (!encoded || encoded.encoding !== 'selected-pixel-index-runs-v1') return null;
    const data = new Uint8Array(Number(encoded.width) * Number(encoded.height)); // Boolean region mask selecting recolorable base-coat pixels.
    for (let i = 0; i + 1 < (encoded.runs || []).length; i += 2) {
      const start = Number(encoded.runs[i]); // First selected pixel index in this RLE span.
      const length = Number(encoded.runs[i + 1]); // Number of consecutive selected pixels in this RLE span.
      if (Number.isInteger(start) && Number.isInteger(length) && start >= 0 && length >= 0 && start + length <= data.length) data.fill(1, start, start + length);
    }
    return { width: Number(encoded.width), height: Number(encoded.height), data };
  }
  function loadMasks() {
    if (maskPromise) return maskPromise;
    maskPromise = fetch(docsUrl('config/creature-base-masks.json')).then(response => {
      if (!response.ok) throw new Error(`mask HTTP ${response.status}`);
      return response.json();
    }).then(raw => {
      const decoded = {}; // Decoded masks keyed by creature kind/frame for fast repeated preview recolors.
      for (const [kind, frames] of Object.entries(raw || {})) {
        decoded[kind] = {};
        for (const [frame, encoded] of Object.entries(frames || {})) decoded[kind][frame] = decodeMask(encoded);
      }
      return decoded;
    }).catch(error => {
      debugState.lastError = `mask load: ${error.message}`;
      return {};
    });
    return maskPromise;
  }
  function hexToRgb(hex) {
    const normalized = String(hex || '#888888').replace('#', ''); // Parsed breeding palette color used by shade-fill tinting.
    const value = Number.parseInt(normalized.padEnd(6, '0').slice(0, 6), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  }
  function shadeFillConfig() {
    const cfg = window.SCRATCHBONES_CONFIG?.game?.portrait?.tinting || {}; // Same tunables used by CreatureGeneticsRender and portrait shade-fill.
    return {
      shadowFloor: Number.isFinite(Number(cfg.shadowFloor)) ? Number(cfg.shadowFloor) : 0.18,
      highlightBoost: Number.isFinite(Number(cfg.highlightBoost)) ? Number(cfg.highlightBoost) : 1.18,
      neutralLuminance: Number.isFinite(Number(cfg.neutralLuminance)) ? Number(cfg.neutralLuminance) : 0.55,
      gamma: Number.isFinite(Number(cfg.gamma)) && Number(cfg.gamma) > 0 ? Number(cfg.gamma) : 1,
      preserveNearBlackOutlines: cfg.preserveNearBlackOutlines !== false,
      outlineThreshold: Number.isFinite(Number(cfg.outlineThreshold)) ? Number(cfg.outlineThreshold) : 0.08,
    };
  }
  function recolorPixels(pixels, targetRgb, predicate) {
    const cfg = shadeFillConfig(); // Keeps standalone tool tint behavior aligned with the canonical creature renderer.
    const neutral = Math.max(0.0001, cfg.neutralLuminance); // Normalizes source luminance into the configured shade-fill range.
    for (let i = 0; i < pixels.length; i += 4) {
      if (!pixels[i + 3] || (predicate && !predicate(i))) continue;
      const luminance = (0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]) / 255; // Source shading retained while hue changes.
      if (cfg.preserveNearBlackOutlines && luminance <= cfg.outlineThreshold) continue;
      const normalized = Math.pow(Math.max(0, luminance) / neutral, cfg.gamma); // Gamma-adjusted shade factor matching CreatureGeneticsRender.
      const shade = Math.max(cfg.shadowFloor, Math.min(cfg.highlightBoost, normalized)); // Prevents authored shadows/highlights from collapsing.
      pixels[i] = Math.max(0, Math.min(255, Math.round(targetRgb[0] * shade)));
      pixels[i + 1] = Math.max(0, Math.min(255, Math.round(targetRgb[1] * shade)));
      pixels[i + 2] = Math.max(0, Math.min(255, Math.round(targetRgb[2] * shade)));
    }
  }
  async function recoloredSource(url, color, mask) {
    const key = `${url}|${color}|${mask ? 'mask' : 'all'}`; // Reuses expensive pixel passes while users click between UI sections.
    if (recolorCache.has(key)) return recolorCache.get(key);
    const promise = (async () => {
      const image = await loadImage(url); // Original creature/base/pattern PNG from the repo.
      const canvas = makeCanvas(image.naturalWidth || image.width, image.naturalHeight || image.height); // Same dimensions preserve pixel-perfect pattern registration.
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(image, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height); // Mutable pixels passed through the game's shade-fill formula.
      recolorPixels(imageData.data, hexToRgb(color), mask ? index => !!mask.data[index / 4] : null);
      ctx.putImageData(imageData, 0, 0);
      return canvas;
    })().catch(error => { recolorCache.delete(key); throw error; });
    recolorCache.set(key, promise);
    return promise;
  }
  async function composeEditorAnimal(kind, genotype) {
    const meta = speciesMeta(kind); // Species sprite/pattern metadata matching the canonical creature compositor.
    if (!meta) return null;
    const masks = await loadMasks(); // Base-coat mask prevents tint from coloring non-fur authored regions.
    const mask = masks?.[kind]?.idle || null; // Character Studio renders the idle frame only.
    const storedBaseColor = genotype?.base?.color; // Original base allele retained for Drenkirra body-stripe color inversion.
    const stripes = genotype?.bodystripes; // Drenkirra-only pattern whose base/stripe roles intentionally swap in the runtime renderer.
    const swapDrenkirraColors = kind === 'drenkirra' && storedBaseColor && stripes?.enabled && Number(stripes.copies) > 0 && stripes.color; // Mirrors CreatureGeneticsRender's authored bodystripes rule.
    const baseColor = swapDrenkirraColors ? stripes.color : storedBaseColor; // Effective body fill for this idle composite.
    const baseUrl = docsUrl(meta.base?.idle || `assets/creaturesprites/${ANIMAL_META[kind]?.base || ''}`); // Absolute tool-safe path to the creature's idle sprite.
    const baseSource = baseColor && mask ? await recoloredSource(baseUrl, baseColor, mask) : await loadImage(baseUrl); // Recolored base or untouched source for dual-region species.
    const width = baseSource.naturalWidth || baseSource.width; // Canvas width shared by all precisely registered overlay PNGs.
    const height = baseSource.naturalHeight || baseSource.height; // Canvas height shared by all precisely registered overlay PNGs.
    const output = makeCanvas(width, height); // Final creature composite used by 2D and 3D Character Studio previews.
    const ctx = output.getContext('2d');
    ctx.drawImage(baseSource, 0, 0, width, height);
    const patternIds = kind === 'uumkaoii' ? ['fur', 'plates'] : patternIdsFor(kind); // Same visible layer order as breeding/genotype rendering.
    for (const patternId of patternIds) {
      const layer = genotype?.[patternId]; // Authored allele determines whether and how this pattern is drawn.
      if (!layer?.color || Number(layer.copies) <= 0 || layer.enabled === false) continue;
      const renderColor = swapDrenkirraColors && patternId === 'bodystripes' ? storedBaseColor : layer.color; // Mirrors Drenkirra's intentional inverted stripe colors.
      try {
        const layerCanvas = await recoloredSource(patternUrl(kind, patternId), renderColor, null); // Recolors the exact existing breeding pattern PNG.
        ctx.drawImage(layerCanvas, 0, 0, width, height);
      } catch (error) {
        debugState.lastError = `${patternId}: ${error.message}`;
      }
    }
    if (meta.eyes?.open) {
      try {
        const eye = await loadImage(docsUrl(meta.eyes.open)); // Untinted eye overlay stays above every pattern, matching CreatureGeneticsRender.
        ctx.drawImage(eye, 0, 0, width, height);
      } catch (error) {
        debugState.lastError = `eyes: ${error.message}`;
      }
    }
    return output;
  }
  function fitSourceToCanvas(source, target, options = {}) {
    if (!source || !target?.getContext) return false;
    const width = source.naturalWidth || source.width; // Source creature composite width used for aspect-preserving fit.
    const height = source.naturalHeight || source.height; // Source creature composite height used for aspect-preserving fit.
    if (!width || !height) return false;
    const ctx = target.getContext('2d');
    ctx.clearRect(0, 0, target.width, target.height);
    const padding = Math.max(2, Math.round(Math.min(target.width, target.height) * 0.04)); // Small breathing room prevents edge pixels from being clipped in card previews.
    const scale = Math.min((target.width - padding * 2) / width, (target.height - padding * 2) / height); // Contains the full animal without distortion.
    const drawWidth = width * scale; // Fitted width centered in the target canvas.
    const drawHeight = height * scale; // Fitted height centered in the target canvas.
    const x = (target.width - drawWidth) / 2; // Horizontal centering offset for the fitted creature.
    const y = (target.height - drawHeight) / 2; // Vertical centering offset for the fitted creature.
    ctx.save();
    if (options.portraitView === 'behind' || options.view === 'behind') {
      ctx.translate(target.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(source, target.width - x - drawWidth, y, drawWidth, drawHeight);
    } else {
      ctx.drawImage(source, x, y, drawWidth, drawHeight);
    }
    ctx.restore();
    return true;
  }
  async function renderStudioAnimal(target, appearance, renderOptions = {}) {
    const kind = activeKind(appearance); // Explicit current animal species selected in Character Studio.
    if (!kind) return false;
    const genotype = normalizeGenotype(kind, appearance.creatureGenotype || appearance.genotype); // Same authored genotype passed to runtime on export.
    try {
      const source = await composeEditorAnimal(kind, genotype); // Tool-safe compositor resolves assets from the module, not the nested page URL.
      const rendered = fitSourceToCanvas(source, target, renderOptions);
      debugState.lastRender = rendered ? `studio-fallback:${kind}` : `studio-fallback-failed:${kind}`;
      debugState.lastError = rendered ? debugState.lastError : 'target canvas unavailable';
      refreshDebug();
      return rendered;
    } catch (error) {
      debugState.lastError = `render ${kind}: ${error.message}`;
      debugState.lastRender = 'failed';
      refreshDebug();
      return false;
    }
  }

  function installPreviewHooks() {
    const preview = window.NpcAvatarPreview; // Shared profile/render adapter already used by Character Studio 3D and database previews.
    if (preview && !preview.__characterStudioAnimalAppearanceWrapped) {
      const originalPreviewRender = preview.renderProfileToCanvas.bind(preview); // Human/default path preserved whenever no animal appearance is active.
      preview.renderProfileToCanvas = async function renderStudioAwareProfile(canvas, profile, options = {}) {
        const profileKind = normalizeKind(profile?.creatureKind || profile?.animalKind); // Explicit animal profiles from runtime bridge/database cards.
        const profileAppearance = profileKind
          ? { ...(profile?.appearance || {}), avatarType: 'animal', creatureKind: profileKind, creatureGenotype: profile?.creatureGenotype || profile?.genotype || profile?.appearance?.creatureGenotype }
          : null; // Supplies genotype to the tool compositor for authored animal profiles.
        const scratchAppearance = !canvas?.dataset?.portraitId ? window.__characterStudioAnimalAppearance : null; // 3D scratch canvases have no NPC id, so they follow the active Appearance target.
        const appearance = profileAppearance || scratchAppearance;
        if (appearance && activeKind(appearance)) {
          const rendered = await renderStudioAnimal(canvas, appearance, options);
          if (rendered) return true;
        }
        return originalPreviewRender(canvas, profile, options);
      };
      preview.__characterStudioAnimalAppearanceWrapped = true;
    }

    if (typeof window.renderProfile === 'function' && !window.renderProfile.__characterStudioAnimalAppearanceWrapped) {
      const originalRenderProfile = window.renderProfile; // Human portrait compositor preserved for all ordinary Character Studio profiles.
      const wrapped = async function renderProfileWithAnimals(canvas, profile, options = {}) {
        const profileKind = normalizeKind(profile?.creatureKind || profile?.animalKind); // Database portraits may already carry explicit animal profile metadata.
        let appearance = profileKind
          ? { ...(profile?.appearance || {}), avatarType: 'animal', creatureKind: profileKind, creatureGenotype: profile?.creatureGenotype || profile?.genotype || profile?.appearance?.creatureGenotype }
          : null; // Reconstructed appearance drives the editor compositor.
        if (!appearance && canvas?.id === 'apCanvas') appearance = window.__characterStudioAnimalAppearance; // Main 2D preview follows the active NPC's animal authoring state.
        if (appearance && activeKind(appearance)) {
          const rendered = await renderStudioAnimal(canvas, appearance, options);
          if (rendered) return canvas;
        }
        return originalRenderProfile(canvas, profile, options);
      };
      wrapped.__characterStudioAnimalAppearanceWrapped = true;
      window.renderProfile = wrapped;
      if (window.renderPortraitProfile === originalRenderProfile) window.renderPortraitProfile = wrapped;
    }
  }

  function loadBreedingDefinitions() {
    if (window.CreatureGenetics?.PATTERN_DEFS) return Promise.resolve(true);
    return new Promise(resolve => {
      const existing = document.querySelector('script[data-character-studio-creature-genetics]'); // Avoids duplicate dynamic loads if the extension initializes twice.
      if (existing) {
        existing.addEventListener('load', () => resolve(true), { once: true });
        existing.addEventListener('error', () => resolve(false), { once: true });
        return;
      }
      const script = document.createElement('script'); // Loads only the breeding definition module; the Character Studio does not call its runtime init().
      script.dataset.characterStudioCreatureGenetics = '1';
      script.src = docsUrl('js/creature-genetics.js');
      script.onload = () => { debugState.lastAction = 'breeding pattern definitions loaded'; syncUi(true); resolve(true); };
      script.onerror = () => { debugState.lastError = 'creature-genetics.js failed to load; using fallback pattern ids'; resolve(false); };
      document.head.appendChild(script);
    });
  }

  function install() {
    if (debugState.installed) return;
    if (!ensureCard()) {
      setTimeout(install, 50);
      return;
    }
    debugState.installed = true;
    debugState.lastAction = 'installed';
    installPreviewHooks();
    loadBreedingDefinitions().catch(() => {});
    syncUi(true);
    setInterval(() => {
      installPreviewHooks(); // Covers renderProfile aliases established after this extension first executed.
      syncUi(false);
    }, 250);
  }

  window.CharacterStudioAnimalAppearance = {
    install,
    paletteFor,
    patternIdsFor,
    defaultAnimalGenotype,
    normalizeGenotype,
    renderStudioAnimal,
    patternPaletteRules: PATTERN_PALETTE_RULES,
    getDebug: () => ({ ...debugState, appearance: isNpcTarget() ? clone(parseAppearance()) : null }),
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();