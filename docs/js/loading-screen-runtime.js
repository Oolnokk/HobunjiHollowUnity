// In-game loading-screen overlay. It is the first painted game surface, then
// reappears for world-map travel. Building entry/exit deliberately keeps the
// ordinary scene fade instead of showing this loader.
(() => {
  'use strict';

  if (window.LoadingScreenRuntime?.installed) return;

  const CONFIG_URL = 'config/loading-screens.json';
  const COMPENDIUM_URL = 'js/compendium-ui.js?v=20260918blackstamina1';
  const LORE_FONT_URL = 'assets/hud/KhymeryyanRomanLetters+Numbers.otf.ttf';
  const TANKAN_FONT_URL = 'assets/hud/tankanscript_rotated_flipped_horiz.otf';
  const MIN_VISIBLE_MS = 5000; // Used by hide() so boot/map loaders stay readable for at least five seconds.
  const TIP_ROTATE_MS = 10000; // Used by startTipRotation() so long loading screens show a fresh tip every ten seconds.
  const BUILDING_AREA_RE = /^(?:interior|map_i_)/i; // Used only as a fallback until the canonical building-area accessor is initialized.
  const BUILDING_CALL_RE = /\b(?:enterBuilding|enterInterior|exitBuilding|leaveBuilding|exitInterior|leaveInterior)\b/i; // Used to suppress explicit building entry/exit callbacks.
  const MAP_CALL_RE = /\b(?:enterZone|performTravel|doTravel|setCurrentArea)\b/; // Used to recognize world-map travel callbacks before their expensive work begins.
  const DEFAULT_SETTINGS = Object.freeze({
    scriptSide: 'left', imageScale: 1, panRange: 7, panSpeed: 0.055,
    manualSpeed: 150, loreSize: 19, scriptSize: 89, scriptY: 46,
    columnSpacing: -0.55, scriptScrollSpeed: 0.017,
  }); // Used for the synchronous first paint before loading-screens.json finishes fetching.
  const FALLBACK_TIPS = Object.freeze([
    { title: 'Resources', text: 'Health keeps you alive, Stamina pays for effort, and Footing keeps you upright.' },
    { title: 'Exhaustion', text: 'If an action costs more Stamina than you have, it is still allowed, but you become Exhausted and begin spending Black Stamina.' },
    { title: 'Footing', text: 'Taking Footing damage can stagger you. Reaching 0 Footing puts you prone.' },
    { title: 'Mastery', text: 'Mastery belongs to the individual tool or weapon you use; it is separate from broad character Skills such as Combat or Farming.' },
    { title: 'Combat Mastery', text: 'Combat use awards weapon Mastery when you actually kill an enemy with that weapon, and tougher enemies are worth more.' },
    { title: 'Shovel Mastery', text: 'A shovel gains Mastery when it exposes buried treasure, not for ordinary digging.' },
    { title: 'Motes of Prowess', text: 'Motes of Prowess pay for technique choices after the matching Mastery rank opens that level.' },
    { title: 'Attack Controls', text: 'Tap 1 follows your weapon\'s Combo, while Tap 2 is a selectable Quick Attack.' },
    { title: 'Attack Controls', text: 'Hold 1 accepts Offensive Holds; Hold 2 accepts Defensive or Offensive Holds.' },
    { title: 'Attack Loadouts', text: 'Quick Attack and Held Attack choices are remembered separately for each weapon.' },
    { title: 'Ranged Mastery', text: 'Ranged weapon Mastery alternates between Basic Ammo choices and Special Ammo slots.' },
    { title: 'Alchemy', text: 'Every alchemy reagent carries one Humour, one Drive, and one Elemental Magnetism.' },
  ]); // Used only before the Compendium DOM is available; each fallback carries the same feature context as its condensed guidance.

  const state = {
    configPromise: null,
    compendiumPromise: null,
    fontsPromise: null,
    tankanFontSettled: false, // Used to keep Tankan-script glyphs hidden until their font load attempt settles, preventing a fallback-font flash.
    lastEntryId: null,
    lastTipKey: null,
    visible: false,
    motionRaf: null,
    tipTimer: null, // Used by startTipRotation()/stopTipRotation() to keep exactly one ten-second tip timer alive per loading session.
    autoPhase: Math.random() * 4,
    scriptScrollPhase: 0,
    lastFrameTime: 0,
    els: null,
    generation: 0,
    finalHiddenGeneration: 0,
    hideTimer: null,
    hideWaiters: [],
    visibleSince: 0,
    progress: 0,
    progressSource: 'idle',
    requestStarted: 0,
    requestCompleted: 0,
    transitionHookTimer: null,
    transitionHookInstalled: false,
    dependencyInitHooks: 0,
    bootRetryInstalled: false,
    debugTapCount: 0,
    debugTapAt: 0,
    debugVisible: false,
    activeTip: '',
    activeTipTitle: '', // Used by the loading-screen header and diagnostics to preserve the selected Compendium feature context.
    contextText: '', // Optional transition-specific heading such as the destination mine floor, rendered above the ordinary Compendium tip.
    reason: 'idle',
    tipPoolGeneration: 0, // Generation the cached tip pool/semantic rules below were built for; a mismatch forces one rebuild per loading session instead of one every ten-second tick.
    tipPoolCache: null,
    semanticRulesCache: null,
    onboardingPresenceObserver: null, // Watches only direct body-child mount/removal so the loader never competes visually with onboarding.
    suppressedByOnboarding: false, // Exposed in mobile-visible diagnostics when the pre-world loader is intentionally hidden behind onboarding.
  }; // Used by rendering, transition coverage, real request progress, and the built-in mobile diagnostics panel.

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const nowMs = () => (window.performance?.now?.() ?? Date.now());

  function toCssHexColor(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      const normalized = value & 0xffffff; // Used to turn ResourceRings' numeric Three.js colors into six-digit CSS colors.
      return `#${normalized.toString(16).padStart(6, '0')}`;
    }
    const text = String(value || '').trim(); // Used to accept the config's canonical #rrggbb strings without changing their hue.
    if (/^#[0-9a-f]{6}$/i.test(text)) return text.toLowerCase();
    if (/^[0-9a-f]{6}$/i.test(text)) return `#${text.toLowerCase()}`;
    return '';
  }

  function visibleRingColor(value) {
    const numeric = typeof value === 'number'
      ? value
      : Number.parseInt(String(value || '').trim().replace(/^#/, ''), 16); // Used as the Three.js-compatible source color passed through the same neon transform as ring fills.
    if (!Number.isFinite(numeric)) return '';
    const neonize = window.ResourceRings?.neonizeColor; // Used to match the color players actually see after makeGlowArcMesh transforms the source palette.
    return toCssHexColor(typeof neonize === 'function' ? neonize(numeric) : numeric);
  }

  function configuredResourceColor(resource) {
    const key = String(resource || '').toLowerCase(); // Used to fall back to the exact visible base ring color when an affliction lacks a dedicated palette entry.
    return visibleRingColor(window.HOBUNJI_CONFIG?.resourceRings?.colors?.[key]);
  }

  function exactAfflictionColor(id, definition) {
    const runtimeColor = window.ResourceRings?.AFFLICTION_COLORS?.[id]; // Used first so runtime-added/overridden afflictions match the source palette the ring actually consumes.
    const configuredColor = window.HOBUNJI_CONFIG?.resourceRings?.afflictionColors?.[id]; // Used during early loading if ResourceRings is not available yet.
    return visibleRingColor(runtimeColor ?? configuredColor) || configuredResourceColor(definition?.resource);
  }

  function revealTankanScript() {
    state.tankanFontSettled = true;
    state.els?.root.classList.add('tankan-font-settled');
  }

  function ensureFontsLoaded() {
    if (state.fontsPromise) return state.fontsPromise;
    if (typeof FontFace !== 'function' || !document.fonts) {
      revealTankanScript();
      return Promise.resolve(false);
    }
    const loreFontPromise = new FontFace('KhymeryyanRoman', `url('${LORE_FONT_URL}')`).load()
      .then(font => { document.fonts.add(font); return true; })
      .catch(() => false); // Used by show() to keep its existing wait for the lore font without blocking Tankan-script reveal on it.
    const tankanFontPromise = new FontFace('TankanScript', `url('${TANKAN_FONT_URL}')`).load()
      .then(font => { document.fonts.add(font); return true; })
      .catch(() => false)
      .then(loaded => {
        revealTankanScript();
        return loaded;
      }); // Used to reveal the vertical script only after TankanScript is either loaded or has definitively failed.
    state.fontsPromise = Promise.all([loreFontPromise, tankanFontPromise])
      .then(results => results.every(Boolean));
    return state.fontsPromise;
  }

  function ensureConfigLoaded() {
    if (state.configPromise) return state.configPromise;
    state.configPromise = fetch(CONFIG_URL, { cache: 'no-store' })
      .then(response => { if (!response.ok) throw new Error(`${CONFIG_URL}: HTTP ${response.status}`); return response.json(); })
      .catch(error => {
        window.__farmLog?.(`[loading-screen] failed to load ${CONFIG_URL}: ${error.message}`, 'warn');
        return { settings: {}, entries: [] };
      });
    return state.configPromise;
  }

  function ensureCompendiumLoaded() {
    if (window.CompendiumUI) return Promise.resolve(true);
    if (state.compendiumPromise) return state.compendiumPromise;
    state.compendiumPromise = new Promise(resolve => {
      const existing = document.querySelector?.('script[data-hobunji-loading-compendium]');
      if (existing) {
        existing.addEventListener?.('load', () => resolve(!!window.CompendiumUI), { once: true });
        existing.addEventListener?.('error', () => resolve(false), { once: true });
        return;
      }
      const script = document.createElement('script'); // Used to make canonical Compendium definitions available to the first loading screen.
      script.src = COMPENDIUM_URL;
      script.async = false;
      script.dataset.hobunjiLoadingCompendium = '1';
      script.onload = () => resolve(!!window.CompendiumUI);
      script.onerror = () => resolve(false);
      (document.head || document.documentElement).appendChild(script);
    });
    return state.compendiumPromise;
  }

  function buildDom() {
    if (state.els) return state.els;
    const style = document.createElement('style');
    style.id = 'hobunjiLoadScreenStyles';
    style.textContent = `
#hobunjiLoadScreen{position:fixed;inset:0;z-index:9000;background:#000;display:none;overflow:hidden;pointer-events:none}
html.hobunji-preworld-sky-active #hobunjiLoadScreen{background:transparent}
#hobunjiLoadScreen.visible{display:block}
html.hobunji-onboarding-foreground #hobunjiLoadScreen{visibility:hidden}
#hobunjiLoadScreen.suppressed-by-onboarding{visibility:hidden}
#hlsImage{position:absolute;left:50%;top:48%;width:auto;height:auto;max-width:78vw;max-height:70vh;object-fit:contain;transform-origin:center center;will-change:transform}
#hlsScriptViewport{position:absolute;top:46%;width:min(42vw,540px);height:min(72vh,880px);overflow:hidden;transform:translate(-50%,-50%);visibility:hidden}
#hobunjiLoadScreen.tankan-font-settled #hlsScriptViewport{visibility:visible}
html.hobunji-onboarding-foreground #hlsScriptViewport{visibility:hidden!important}
#hlsScriptFloat{position:absolute;left:50%;top:0;will-change:transform}
#hlsScriptWords{display:flex;flex-direction:row;align-items:flex-start;justify-content:center;gap:0;width:max-content;--script-column-spacing:0em}
.hlsVerticalWord + .hlsVerticalWord{margin-left:var(--script-column-spacing)}
.hlsVerticalWord{display:flex;flex-direction:column;align-items:center;justify-content:flex-start;font-family:"TankanScript",sans-serif;line-height:.56;color:#fff;white-space:nowrap}
.hlsVerticalGlyph{display:block;width:1em;height:.56em;line-height:.56em;text-align:center}
#hlsContext{display:none;position:absolute;left:50%;top:max(5.5vh,28px);transform:translateX(-50%);max-width:min(84vw,920px);color:#fff;font-family:"KhymeryyanRoman",serif;font-size:clamp(28px,5vw,58px);font-weight:700;letter-spacing:.08em;text-align:center;text-transform:uppercase;text-shadow:0 2px 10px rgba(0,0,0,.95);text-wrap:balance}
#hlsLoreBlock{position:absolute;left:50%;bottom:max(5.5vh,28px);transform:translateX(-50%);width:min(78vw,980px);text-align:center;color:#fff;font-family:"KhymeryyanRoman",serif;text-shadow:0 2px 8px rgba(0,0,0,.9)}
#hlsLoreHeader{margin:0 0 .42em;font-size:15px;line-height:1.05;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#8fd0ff;text-wrap:balance}
#hlsLore{line-height:1.24;text-wrap:balance}
#hlsPercent{position:absolute;right:max(4vw,24px);bottom:max(5.5vh,28px);color:#fff;font-family:"KhymeryyanRoman",serif;font-size:18px;line-height:1;text-shadow:0 2px 8px rgba(0,0,0,.9);pointer-events:auto;user-select:none}
#hlsDebug{display:none;position:absolute;right:max(4vw,24px);bottom:max(9vh,58px);max-width:min(84vw,440px);padding:9px 11px;border:1px solid rgba(255,255,255,.35);border-radius:7px;background:rgba(0,0,0,.82);color:#eee;font:11px/1.35 monospace;white-space:pre-wrap;text-align:left;text-shadow:none}
#hlsDebug.visible{display:block}
.hlsProperNoun{color:#e8c86b}
.hlsSystemTerm{color:#8fd0ff}
.hlsResourceHealth{color:var(--hls-resource-health,#55d76f)}
.hlsResourceStamina{color:var(--hls-resource-stamina,#67b7ff)}
.hlsResourceFooting{color:var(--hls-resource-footing,#d9a441)}
.hlsAfflictedResource{font-weight:700;text-decoration:underline;text-decoration-style:dotted;text-underline-offset:.14em}
.hlsAttackQuick{color:#f6a65c;font-weight:700}
.hlsAttackHeld{color:#bd9cff;font-weight:700}
.hlsAttackCombo{color:#6ed0c3;font-weight:700}
.hlsAttackDefensive{color:#89b8ff;font-weight:700}
`;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.id = 'hobunjiLoadScreen';
    const resourceColors = window.HOBUNJI_CONFIG?.resourceRings?.colors || {}; // Used to keep ordinary resource-name highlighting synchronized with the actual ground-ring palette.
    root.style.setProperty('--hls-resource-health', visibleRingColor(resourceColors.health) || '#55d76f');
    root.style.setProperty('--hls-resource-stamina', visibleRingColor(resourceColors.stamina) || '#67b7ff');
    root.style.setProperty('--hls-resource-footing', visibleRingColor(resourceColors.footing) || '#d9a441');
    root.innerHTML = `
<img id="hlsImage" alt="" />
<div id="hlsScriptViewport"><div id="hlsScriptFloat"><div id="hlsScriptWords"></div></div></div>
<div id="hlsContext"></div>
<div id="hlsLoreBlock"><div id="hlsLoreHeader"></div><div id="hlsLore"></div></div>
<div id="hlsPercent"></div>
<div id="hlsDebug"></div>
`;
    if (state.tankanFontSettled) root.classList.add('tankan-font-settled');
    document.body.appendChild(root);

    state.els = {
      root,
      image: root.querySelector('#hlsImage'),
      scriptViewport: root.querySelector('#hlsScriptViewport'),
      scriptFloat: root.querySelector('#hlsScriptFloat'),
      scriptWords: root.querySelector('#hlsScriptWords'),
      context: root.querySelector('#hlsContext'), // Displays transition-specific progress context without replacing the rotating Compendium guidance.
      loreBlock: root.querySelector('#hlsLoreBlock'),
      loreHeader: root.querySelector('#hlsLoreHeader'),
      lore: root.querySelector('#hlsLore'),
      percent: root.querySelector('#hlsPercent'),
      debug: root.querySelector('#hlsDebug'),
    };
    state.els.percent?.addEventListener?.('pointerup', onPercentDebugTap);
    return state.els;
  }

  function onPercentDebugTap() {
    const now = Date.now(); // Used to detect a deliberate five-tap diagnostics gesture without permanent debug chrome.
    if (now - state.debugTapAt > 1800) state.debugTapCount = 0;
    state.debugTapAt = now;
    state.debugTapCount += 1;
    if (state.debugTapCount < 5) return;
    state.debugTapCount = 0;
    state.debugVisible = !state.debugVisible;
    updateDebugPanel();
  }

  function safeCurrentArea() {
    try { return window.GridTileAccessors?.getCurrentArea?.() ?? null; }
    catch (_) { return null; }
  }

  function formatDebug() {
    const area = safeCurrentArea();
    return [
      `visible=${state.visible} generation=${state.generation}`,
      `reason=${state.reason} area=${area ?? 'unknown'}`,
      `context=${state.contextText || '(none)'}`,
      `progress=${Math.round(state.progress)} source=${state.progressSource}`,
      `requests=${state.requestCompleted}/${state.requestStarted}`,
      `tankanFont=${state.tankanFontSettled ? 'settled' : 'waiting'}`,
      `visibleFor=${Math.round(state.visible ? nowMs() - state.visibleSince : 0)}ms min=${MIN_VISIBLE_MS}ms`,
      `tipRotation=${TIP_ROTATE_MS}ms active=${!!state.tipTimer}`,
      `transitionHook=${state.transitionHookInstalled} dependencyInitHooks=${state.dependencyInitHooks}`,
      `afflictionPalette=${Object.keys(window.ResourceSystem?.AFFLICTIONS || {}).filter(id => window.ResourceRings?.AFFLICTION_COLORS?.[id] != null || window.HOBUNJI_CONFIG?.resourceRings?.afflictionColors?.[id] != null).length}/${Object.keys(window.ResourceSystem?.AFFLICTIONS || {}).length}`,
      `feature=${state.activeTipTitle || '(none)'}`,
      `tip=${state.activeTip || '(none)'}`,
    ].join('\n');
  }

  function updateDebugPanel() {
    if (!state.els?.debug) return;
    state.els.debug.textContent = formatDebug();
    state.els.debug.classList.toggle?.('visible', state.debugVisible);
  }

  function renderScript(els, settings, text) {
    els.scriptWords.innerHTML = '';
    els.scriptWords.style.setProperty('--script-column-spacing', `${Number(settings.columnSpacing) || 0}em`);
    const words = String(text || '').trim().split(/\s+/).filter(Boolean);
    for (const word of words) {
      const column = document.createElement('div');
      column.className = 'hlsVerticalWord';
      column.style.fontSize = `${settings.scriptSize}px`;
      for (const char of Array.from(word)) {
        const glyph = document.createElement('span');
        glyph.className = 'hlsVerticalGlyph';
        glyph.textContent = char;
        column.appendChild(glyph);
      }
      els.scriptWords.appendChild(column);
    }
  }

  function pickEntry(entries) {
    entries = entries.filter(entry => entry.mode !== 'introduction'); // World-opening presets never appear in ordinary boot/travel rotation.
    if (!entries.length) return null;
    let pool = entries;
    if (entries.length > 1 && state.lastEntryId) pool = entries.filter(entry => entry.id !== state.lastEntryId);
    const entry = pool[Math.floor(Math.random() * pool.length)];
    state.lastEntryId = entry.id;
    return entry;
  }

  function compactTip(value) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (text.length <= 280) return text;
    const sentence = text.slice(0, 280).match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim();
    return sentence && sentence.length >= 45 ? sentence : `${text.slice(0, 276).trimEnd()}…`;
  }

  function resolveCompendiumTipTitle(card, text) {
    const source = String(text || '').trim(); // Used to detect explicit inner labels such as "Humour:" before falling back to the card hierarchy.
    const labeledPrefix = source.match(/^([^:]{2,48}):\s+\S/); // Used to promote a named child concept to the loading-screen header when the tip itself names one.
    if (labeledPrefix) {
      const label = labeledPrefix[1].trim(); // Used as the most-specific header for structured Compendium notes.
      if (!/^(?:Tags|Keywords)$/i.test(label)) return label;
    }
    const entryTitle = card.querySelector?.('.compendium-entry-title')?.textContent?.trim() || ''; // Used as the normal per-feature title when no child label is present.
    const sectionTitle = card.closest?.('.compendium-section')?.querySelector?.('.compendium-section-title')?.textContent?.trim() || ''; // Used to disambiguate broad entry names such as Fishing inside Character Skills.
    if (/^Character Skills$/i.test(sectionTitle) && entryTitle && !/\bSkill\b/i.test(entryTitle)) return `${entryTitle} Skill`;
    return entryTitle || sectionTitle || 'Compendium';
  }

  function extractCompendiumTips() {
    try { window.CompendiumUI?.install?.(); } catch (_) {}
    const pane = document.querySelector?.('#mpCompendium');
    if (!pane) return [];
    const tips = [];
    const cards = pane.querySelectorAll?.('.compendium-entry') || [];
    for (const card of cards) {
      const title = card.querySelector?.('.compendium-entry-title')?.textContent?.trim() || 'Compendium';
      if (/unavailable|diagnostic/i.test(title)) continue;
      const copy = compactTip(card.querySelector?.('.compendium-entry-copy')?.textContent);
      const copyTitle = resolveCompendiumTipTitle(card, copy); // Used so each main card tip carries the narrowest meaningful feature label.
      if (copy.length >= 20) tips.push({ key: `${title}:copy`, title: copyTitle, text: copy });
      const notes = card.querySelectorAll?.('.compendium-notes li') || [];
      for (let index = 0; index < notes.length; index++) {
        const note = compactTip(notes[index]?.textContent);
        const noteTitle = resolveCompendiumTipTitle(card, note); // Used so structured child notes can override the broader card title.
        if (note.length >= 20) tips.push({ key: `${title}:note:${index}`, title: noteTitle, text: note });
      }
    }
    return tips;
  }

  function invalidateTipCacheIfStale() {
    // The compendium/afflictions registry can't change mid-loading-screen, so
    // extractCompendiumTips()/semanticRules() only need to run once per
    // show() generation instead of once every ten-second tip-rotation tick.
    if (state.tipPoolGeneration !== state.generation) {
      state.tipPoolGeneration = state.generation;
      state.tipPoolCache = null;
      state.semanticRulesCache = null;
    }
  }

  function cachedCompendiumTips() {
    invalidateTipCacheIfStale();
    if (!state.tipPoolCache) state.tipPoolCache = extractCompendiumTips();
    return state.tipPoolCache;
  }

  function cachedSemanticIndex() {
    invalidateTipCacheIfStale();
    if (!state.semanticRulesCache) {
      const rules = semanticRules();
      state.semanticRulesCache = {
        byTerm: new Map(rules.map(([term, className, color]) => [term.toLowerCase(), { className, color }])),
        pattern: new RegExp(rules.map(([term]) => escapeRegExp(term)).join('|'), 'gi'),
      };
    }
    return state.semanticRulesCache;
  }

  function pickTip() {
    const canonical = cachedCompendiumTips();
    const pool = canonical.length
      ? canonical
      : FALLBACK_TIPS.map((tip, index) => ({ key: `fallback:${index}`, ...tip }));
    const nonRepeat = pool.length > 1 && state.lastTipKey
      ? pool.filter(tip => tip.key !== state.lastTipKey)
      : pool;
    const tip = nonRepeat[Math.floor(Math.random() * nonRepeat.length)] || pool[0] || { key: 'empty', title: 'Compendium', text: '' };
    state.lastTipKey = tip.key;
    state.activeTipTitle = tip.title || 'Compendium';
    state.activeTip = tip.text;
    return tip.text;
  }

  function semanticRules() {
    const rules = [
      ['Hobunji Hollow', 'hlsProperNoun'], ['Harugasirri Highlands', 'hlsProperNoun'],
      ['Motes of Prowess', 'hlsProperNoun'], ['Den Mother', 'hlsProperNoun'],
      ['Quick Attacks', 'hlsAttackQuick'], ['Quick Attack', 'hlsAttackQuick'],
      ['quick attacks', 'hlsAttackQuick'], ['quick attack', 'hlsAttackQuick'],
      ['Held Attacks', 'hlsAttackHeld'], ['Held Attack', 'hlsAttackHeld'],
      ['held attacks', 'hlsAttackHeld'], ['held attack', 'hlsAttackHeld'],
      ['Offensive Holds', 'hlsAttackHeld'], ['Offensive Hold', 'hlsAttackHeld'],
      ['Combos', 'hlsAttackCombo'], ['Combo', 'hlsAttackCombo'],
      ['combos', 'hlsAttackCombo'], ['combo', 'hlsAttackCombo'],
      ['Defensive Attacks', 'hlsAttackDefensive'], ['Defensive Attack', 'hlsAttackDefensive'],
      ['defensive attacks', 'hlsAttackDefensive'], ['defensive attack', 'hlsAttackDefensive'],
      ['Defensive Holds', 'hlsAttackDefensive'], ['Defensive Hold', 'hlsAttackDefensive'],
      ['Black Stamina', 'hlsResourceStamina hlsAfflictedResource'],
      ['Health', 'hlsResourceHealth'], ['Stamina', 'hlsResourceStamina'], ['Footing', 'hlsResourceFooting'],
      ['Exhaustion', 'hlsSystemTerm'], ['Exhausted', 'hlsSystemTerm'], ['Mastery', 'hlsSystemTerm'],
      ['Character Skills', 'hlsSystemTerm'], ['Combat Skill', 'hlsSystemTerm'], ['Skills', 'hlsSystemTerm'],
      ['Basic Ammo', 'hlsSystemTerm'], ['Special Ammo', 'hlsSystemTerm'], ['Loadout', 'hlsSystemTerm'],
      ['Alchemy', 'hlsSystemTerm'], ['Humour', 'hlsSystemTerm'], ['Drive', 'hlsSystemTerm'],
      ['Elemental Magnetism', 'hlsSystemTerm'], ['Magnetism', 'hlsSystemTerm'],
      ['Restore', 'hlsSystemTerm'], ['Afflict', 'hlsSystemTerm'], ['Greaten', 'hlsSystemTerm'], ['Lighten', 'hlsSystemTerm'],
    ]; // Used to color recurring Compendium vocabulary consistently across arbitrary tip text.

    const pane = document.querySelector?.('#mpCompendium');
    const vocabularyNodes = pane?.querySelectorAll?.('.compendium-entry-title, .compendium-section-title') || [];
    for (const node of vocabularyNodes) {
      const term = String(node?.textContent || '').trim();
      if (term.length >= 3) rules.push([term, 'hlsSystemTerm']);
    }

    const registry = window.ResourceSystem?.AFFLICTIONS || {};
    for (const [id, definition] of Object.entries(registry)) { // The registry id is used to resolve the exact color of the afflicted ring segment.
      const name = String(definition?.name || '').trim();
      if (!name) continue;
      const resource = String(definition?.resource || '').toLowerCase();
      const resourceClass = resource === 'health' ? 'hlsResourceHealth'
        : resource === 'stamina' ? 'hlsResourceStamina'
          : resource === 'footing' ? 'hlsResourceFooting'
            : 'hlsSystemTerm';
      const color = exactAfflictionColor(id, definition); // Used by both loading-tip headers and body copy so the affliction name matches its ring segment exactly.
      rules.push([name, `${resourceClass} hlsAfflictedResource`, color]);
    }
    return rules.sort((a, b) => b[0].length - a[0].length);
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function renderRichTip(container, text) {
    container.innerHTML = '';
    const { byTerm, pattern } = cachedSemanticIndex();
    let cursor = 0;
    const source = String(text || '');
    for (const match of source.matchAll(pattern)) {
      if (match.index > cursor) container.appendChild(document.createTextNode(source.slice(cursor, match.index)));
      const span = document.createElement('span');
      const semantic = byTerm.get(match[0].toLowerCase()); // Used to apply both the vocabulary class and an optional exact affliction color.
      span.className = semantic?.className || 'hlsSystemTerm';
      if (semantic?.color) span.style.color = semantic.color;
      span.textContent = match[0];
      container.appendChild(span);
      cursor = match.index + match[0].length;
    }
    if (cursor < source.length) container.appendChild(document.createTextNode(source.slice(cursor)));
  }

  function renderActiveTip(els, text) {
    renderRichTip(els.loreHeader, state.activeTipTitle || 'Compendium');
    renderRichTip(els.lore, text);
  }

  function stopTipRotation() {
    if (state.tipTimer && typeof clearInterval === 'function') clearInterval(state.tipTimer);
    state.tipTimer = null;
  }

  function startTipRotation(generation) {
    stopTipRotation();
    if (typeof setInterval !== 'function') return;
    state.tipTimer = setInterval(() => {
      if (!state.visible || generation !== state.generation || state.finalHiddenGeneration === generation) {
        stopTipRotation();
        return;
      }
      renderActiveTip(state.els || buildDom(), pickTip());
      updateDebugPanel();
    }, TIP_ROTATE_MS);
  }

  function applyEntryAndSettings(config) {
    const els = buildDom();
    const settings = { ...DEFAULT_SETTINGS, ...(config?.settings || {}) };
    const entry = pickEntry(config?.entries || []) || { image: '', script: 'HOBUNJI HOLLOW' };
    const hasImage = !!entry.image;
    els.image.style.display = hasImage ? '' : 'none';
    if (hasImage && els.image.src !== entry.image) els.image.src = entry.image;
    els.lore.style.fontSize = `${settings.loreSize}px`;
    renderActiveTip(els, state.activeTip || pickTip());
    renderScript(els, settings, entry.script || 'HOBUNJI HOLLOW');
    els.scriptViewport.style.left = settings.scriptSide === 'right' ? '75%' : '25%';
    els.scriptViewport.style.top = `${settings.scriptY}%`;
    return settings;
  }

  function setProgress(value, source = 'manual', allowDecrease = false) {
    const next = clamp(Number(value) || 0, 0, 100);
    state.progress = allowDecrease ? next : Math.max(state.progress, next);
    state.progressSource = source;
    if (state.els?.percent) state.els.percent.textContent = `${Math.round(state.progress)}%`;
    updateDebugPanel();
    return state.progress;
  }

  function noteRequestStart() {
    if (!state.visible) return;
    state.requestStarted += 1;
    setProgress(Math.min(82, 18 + state.requestCompleted * 6), 'network-active');
  }

  function noteRequestComplete() {
    if (!state.visible) return;
    state.requestCompleted += 1;
    const total = Math.max(1, state.requestStarted);
    const ratio = clamp(state.requestCompleted / total, 0, 1);
    const eventDrivenProgress = 22 + Math.min(62, state.requestCompleted * 5.5);
    const ratioProgress = 22 + ratio * 30;
    setProgress(Math.max(eventDrivenProgress, ratioProgress), 'network-complete');
  }

  function installFetchProgressHook() {
    if (typeof window.fetch !== 'function' || window.fetch.__hobunjiLoadingProgressWrapped) return;
    const originalFetch = window.fetch.bind(window); // Used to preserve native fetch behavior while counting requests during a visible loading session.
    const wrappedFetch = function hobunjiLoadingProgressFetch(...args) {
      const generation = state.visible ? state.generation : 0; // Used so a request started for an older screen cannot advance a newer loading session.
      if (generation) noteRequestStart();
      let request;
      try { request = originalFetch(...args); }
      catch (error) {
        if (generation && generation === state.generation) noteRequestComplete();
        throw error;
      }
      return Promise.resolve(request).then(
        response => {
          if (generation && generation === state.generation) noteRequestComplete();
          return response;
        },
        error => {
          if (generation && generation === state.generation) noteRequestComplete();
          throw error;
        },
      );
    };
    wrappedFetch.__hobunjiLoadingProgressWrapped = true;
    wrappedFetch.__hobunjiLoadingProgressOriginal = originalFetch;
    window.fetch = wrappedFetch;
  }

  function cornerPan(phase, rangePx) {
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]];
    const wrapped = ((phase % 4) + 4) % 4;
    const index = Math.floor(wrapped);
    const local = wrapped - index;
    const t = local * local * (3 - 2 * local);
    const a = corners[index], b = corners[index + 1];
    return { x: (a[0] + (b[0] - a[0]) * t) * rangePx, y: (a[1] + (b[1] - a[1]) * t) * rangePx };
  }

  function motionTick(now, settings) {
    if (!state.visible) return;
    const dt = Math.min(0.05, Math.max(0, (now - state.lastFrameTime) / 1000));
    state.lastFrameTime = now;
    state.autoPhase += dt * (Number(settings.panSpeed) || 0.055);
    const rangePx = Math.min(innerWidth, innerHeight) * ((Number(settings.panRange) || 0) / 100);
    const pan = cornerPan(state.autoPhase, rangePx);
    state.els.image.style.transform = `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${Number(settings.imageScale) || 1})`;

    state.scriptScrollPhase = (state.scriptScrollPhase + dt * (Number(settings.scriptScrollSpeed) || 0)) % 1;
    const viewportHeight = state.els.scriptViewport.clientHeight || 0;
    const contentHeight = state.els.scriptFloat.offsetHeight || 0;
    const maxScroll = Math.max(0, contentHeight - viewportHeight);
    state.els.scriptFloat.style.transform = `translateX(-50%) translateY(${-maxScroll * state.scriptScrollPhase}px)`;
    if (state.debugVisible) updateDebugPanel();
    state.motionRaf = requestAnimationFrame(t => motionTick(t, settings));
  }

  function resolveHideWaiters(generation) {
    const remaining = [];
    for (const waiter of state.hideWaiters) {
      if (waiter.generation === generation) waiter.resolve();
      else remaining.push(waiter);
    }
    state.hideWaiters = remaining;
  }

  function syncOnboardingForeground() {
    const root = state.els?.root;
    if (!root) return false;
    const preworld = document.documentElement?.classList?.contains?.('hobunji-preworld-sky-active') === true;
    const onboardingPresent = document.documentElement?.classList?.contains?.('hobunji-onboarding-foreground') === true
      || !!document.getElementById?.('ob-overlay');
    const suppress = preworld && onboardingPresent;
    state.suppressedByOnboarding = suppress;
    root.classList.toggle('suppressed-by-onboarding', suppress);
    return suppress;
  }

  function installOnboardingPresenceObserver() {
    if (state.onboardingPresenceObserver || typeof MutationObserver !== 'function' || !document.body) return;
    state.onboardingPresenceObserver = new MutationObserver(() => syncOnboardingForeground()); // Direct body children are enough because #ob-overlay itself is mounted/removed there.
    state.onboardingPresenceObserver.observe(document.body, { childList:true });
    syncOnboardingForeground();
  }

  function showImmediate(reason = 'map-change', contextText = '') {
    const previousGeneration = state.generation; // Used to settle any delayed hide promises superseded by a newer loading screen.
    if (state.hideTimer && typeof clearTimeout === 'function') clearTimeout(state.hideTimer);
    state.hideTimer = null;
    stopTipRotation();
    if (previousGeneration) resolveHideWaiters(previousGeneration);

    const myGeneration = ++state.generation;
    state.finalHiddenGeneration = 0;
    state.visible = true;
    state.visibleSince = nowMs();
    state.requestStarted = 0;
    state.requestCompleted = 0;
    state.reason = reason;
    state.contextText = String(contextText || '').trim(); // Carries a caller-authored destination label only for this loading generation.
    state.activeTip = '';
    state.activeTipTitle = '';
    const els = buildDom();
    els.root.classList.add('visible');
    els.context.textContent = state.contextText;
    els.context.style.display = state.contextText ? 'block' : 'none';
    syncOnboardingForeground();
    renderScript(els, DEFAULT_SETTINGS, 'HOBUNJI HOLLOW');
    els.scriptViewport.style.left = '25%';
    els.scriptViewport.style.top = '46%';
    els.lore.style.fontSize = `${DEFAULT_SETTINGS.loreSize}px`;
    renderActiveTip(els, pickTip());
    startTipRotation(myGeneration);
    setProgress(0, 'session-start', true);
    state.lastFrameTime = nowMs();
    if (state.motionRaf) cancelAnimationFrame(state.motionRaf);
    state.motionRaf = requestAnimationFrame(t => motionTick(t, DEFAULT_SETTINGS));
    return myGeneration;
  }

  // Shows synchronously first, then fills authored settings/canonical tip copy
  // as resources settle. Transition hooks call this BEFORE startSceneTransition
  // starts fading, so the browser gets frames to paint it before the expensive
  // world-map callback runs at the black midpoint.
  async function show(options = {}) {
    if (state.introduction) return; // The opening preset owns the foreground through map/boot loader races.
    const reason = typeof options === 'string' ? options : (options?.reason || 'map-change');
    const contextText = typeof options === 'string' ? '' : (options?.contextText || ''); // Used by mine-floor loads to identify the destination without replacing the normal loading tip.
    const myGeneration = showImmediate(reason, contextText);
    setProgress(4, 'overlay-visible');
    await Promise.all([ensureFontsLoaded(), ensureConfigLoaded(), ensureCompendiumLoaded()]);
    if (state.generation !== myGeneration || state.finalHiddenGeneration === myGeneration) return;
    setProgress(16, 'loader-resources');
    const config = await state.configPromise;
    if (state.generation !== myGeneration || state.finalHiddenGeneration === myGeneration) return;
    const settings = applyEntryAndSettings(config);
    setProgress(20, 'compendium-tip');
    if (state.motionRaf) cancelAnimationFrame(state.motionRaf);
    state.lastFrameTime = nowMs();
    state.motionRaf = requestAnimationFrame(t => motionTick(t, settings));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  function finalizeHide(generation) {
    if (generation !== state.generation) {
      resolveHideWaiters(generation);
      return;
    }
    state.finalHiddenGeneration = generation;
    state.visible = false;
    stopTipRotation();
    if (state.motionRaf) { cancelAnimationFrame(state.motionRaf); state.motionRaf = null; }
    state.els?.root.classList.remove('visible');
    state.hideTimer = null;
    resolveHideWaiters(generation);
    updateDebugPanel();
  }

  function hide(reason = 'map-ready') {
    if (state.introduction) return Promise.resolve(); // Ordinary map completion cannot dismiss a staged introduction.
    if (!state.generation) return Promise.resolve();
    const generation = state.generation; // Used to make a delayed five-second hide harmless if a newer world transition starts first.
    state.reason = reason;
    setProgress(100, 'map-ready');
    const wait = Math.max(0, MIN_VISIBLE_MS - (nowMs() - state.visibleSince));
    if (wait <= 0 || typeof setTimeout !== 'function') {
      finalizeHide(generation);
      return Promise.resolve();
    }
    if (state.hideTimer && typeof clearTimeout === 'function') clearTimeout(state.hideTimer);
    return new Promise(resolve => {
      state.hideWaiters.push({ generation, resolve });
      state.hideTimer = setTimeout(() => finalizeHide(generation), wait);
    });
  }

  async function beginIntroduction(presetId = 'world-introduction') {
    state.introduction?.cancel();
    const root = document.createElement('div'); // Introduction copy and continuation controls share white Roman text on black.
    root.id = 'introductionLoadingScreen';
    root.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:#000;color:#fff;display:flex;flex-direction:column;gap:20px;align-items:center;justify-content:center;padding:8vw;box-sizing:border-box;font:clamp(20px,4vw,38px)/1.6 KhymeryyanRoman,serif;text-align:center;white-space:pre-wrap;touch-action:manipulation';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Introduction');
    root.tabIndex = -1;
    const INTRO_FADE_MS = 900; // Used by narrative pages and Continue prompts so every opening-text change crossfades instead of snapping.
    const MIN_INTRA_SLIDE_DELAY_SECONDS = 4; // Used only by delayed text within one opening slide; ordinary page holds keep their authored durations.
    const stageText = document.createElement('div'); // Authored opening pages keep delayed lines laid out invisibly until their fade-in beat.
    stageText.style.cssText = `opacity:0;transition:opacity ${INTRO_FADE_MS}ms ease`;
    const percentText = document.createElement('div'); // Quiet progress stays at the bottom, separate from centered story copy.
    percentText.style.cssText = 'position:absolute;bottom:5vh;font-size:14px;opacity:.65';
    percentText.textContent = '0%';
    const continueButton = document.createElement('button'); // An accessible text-only prompt appears only when a fresh input can advance.
    continueButton.type = 'button';
    continueButton.textContent = 'Continue · Enter / Space · controller A';
    continueButton.disabled = true;
    continueButton.style.cssText = `position:absolute;bottom:12vh;min-height:48px;padding:10px 20px;background:transparent;color:#fff;border:0;font:18px KhymeryyanRoman,serif;cursor:pointer;opacity:0;pointer-events:none;transition:opacity ${INTRO_FADE_MS}ms ease`;
    root.append(stageText, percentText, continueButton);
    document.body.appendChild(root);
    document.body.classList?.add('introduction-loading');
    const introAudio = window.AudioSystem?.beginIntroductionMix?.(); // Foreground text owns the exclusive wind mix and releases it with the same session.
    const inputLock = window.CharacterActionLocks?.acquire?.({ owner: 'introduction-loading', participants: [{ id: 'player', channels: ['movement', 'tools', 'actions'] }] }); // Covers stage one before the Director obtains its own action lock.
    let stages = [], startedAt = 0, stageIndex = -1, pageIndex = 0, ready = false, cancelled = false; // Stage/page clocks and input gate never reuse old input.
    let continueStage = null, rejectStage = null, unsubscribe = null; // Input subscription and outstanding page wait are released on success/error.
    let pageTimers = []; // Delayed line reveals are cancelled whenever the page, session, or opening changes.
    let pageVisiblePromise = Promise.resolve(); // First-page timing starts only once the violent wind has actually begun playing.
    let rejectCancellation; // Cancellation also releases a final page still awaiting asset preparation.
    const cancellation = new Promise((_, reject) => { rejectCancellation = reject; });
    cancellation.catch(() => {});
    const stagePages = stage => Array.isArray(stage?.pages) && stage.pages.length ? stage.pages : [stage || {}]; // Keeps legacy one-page stages working while allowing several visible pages inside one loading phase.
    const clearPageTimers = () => {
      if (typeof clearTimeout === 'function') for (const timer of pageTimers) clearTimeout(timer);
      pageTimers = [];
    };
    const appendRichText = (container, value) => {
      const copy = String(value || '');
      if (!copy.includes('**') || typeof document.createTextNode !== 'function') { container.textContent = copy.replace(/\*\*/g, ''); return; }
      let cursor = 0;
      for (const match of copy.matchAll(/\*\*(.+?)\*\*/gs)) {
        if (match.index > cursor) container.appendChild(document.createTextNode(copy.slice(cursor, match.index)));
        const strong = document.createElement('strong'); // Used by authored opening copy such as “only the lost may find.”
        strong.textContent = match[1];
        container.appendChild(strong);
        cursor = match.index + match[0].length;
      }
      if (cursor < copy.length) container.appendChild(document.createTextNode(copy.slice(cursor)));
    };
    const fadeTo = (element, opacity, durationMs = INTRO_FADE_MS) => {
      element.style.opacity = String(opacity);
      if (durationMs <= 0 || typeof setTimeout !== 'function') return Promise.resolve();
      return new Promise(resolve => setTimeout(resolve, durationMs));
    };
    const renderPageCopy = page => {
      stageText.innerHTML = '';
      const base = document.createElement('span'); // The base copy stays visible while delayed spans already occupy their final layout space.
      appendRichText(base, page?.text || '');
      stageText.appendChild(base);
      const delayed = [];
      for (const reveal of Array.isArray(page?.delayedReveals) ? page.delayedReveals : []) {
        const node = document.createElement('span'); // Opacity zero preserves the final page geometry so delayed copy never shifts the centered composition.
        node.style.cssText = `opacity:0;transition:opacity ${INTRO_FADE_MS}ms ease`;
        node.setAttribute?.('aria-hidden', 'true');
        appendRichText(node, reveal?.text || '');
        stageText.appendChild(node);
        delayed.push({ reveal, node });
      }
      return delayed;
    };
    const showPage = page => {
      clearPageTimers();
      startedAt = 0;
      ready = false;
      const delayed = renderPageCopy(page);
      stageText.style.opacity = '0';
      stageText.style.color = String(page?.textColor || '#fff'); // Allows authored emphasis pages, such as the proverb, without HTML in config.
      stageText.style.fontWeight = page?.bold ? '700' : '400';
      continueButton.disabled = true;
      continueButton.style.opacity = '0';
      continueButton.style.pointerEvents = 'none';
      continueButton.setAttribute?.('aria-hidden', 'true');
      const audioGate = introAudio?.started || Promise.resolve(true); // The opening remains black until the violent wind reaches its real playing event.
      pageVisiblePromise = Promise.race([cancellation, Promise.resolve(audioGate)]).then(() => {
        if (cancelled) return;
        startedAt = nowMs();
        void stageText.offsetWidth; // Force the hidden first frame so assigning opacity 1 below reliably animates on mobile browsers.
        stageText.style.opacity = '1';
        for (const { reveal, node } of delayed) {
          const delaySeconds = Math.max(MIN_INTRA_SLIDE_DELAY_SECONDS, Number(reveal?.afterSeconds) || 0);
          const timer = setTimeout(() => {
            if (cancelled) return;
            node.setAttribute?.('aria-hidden', 'false');
            node.style.opacity = '1';
          }, delaySeconds * 1000);
          pageTimers.push(timer);
        }
      });
      state.introductionStage = stageIndex + 1;
      root.focus?.({ preventScroll: true });
    };
    const accept = event => {
      if (!ready || cancelled || !continueStage) return;
      event?.preventDefault?.(); event?.stopImmediatePropagation?.();
      ready = false;
      continueButton.disabled = true;
      continueButton.style.pointerEvents = 'none';
      continueButton.setAttribute?.('aria-hidden', 'true');
      clearPageTimers();
      const resolve = continueStage; continueStage = null; rejectStage = null;
      Promise.all([fadeTo(continueButton, 0), fadeTo(stageText, 0)]).then(resolve); // Let both prompt and current page finish fading out before the next page can replace their text.
    };
    const keydown = event => { introAudio?.retry?.(); if (['Enter', ' ', 'Space'].includes(event.key)) { event.preventDefault(); event.stopImmediatePropagation(); if (!event.repeat) accept(); } }; // Keyboard continuation matches dialogue; mobile taps the text surface.
    root.addEventListener('pointerdown', () => introAudio?.retry?.()); // Autoplay-blocked mobile audio resumes on the first trusted touch, including an early tap.
    continueButton.addEventListener('click', accept);
    document.addEventListener('keydown', keydown, true);
    unsubscribe = window.ControllerInput?.subscribe?.('introduction-loading', frame => {
      window.ControllerInput?.setOwner?.('introduction-loading');
      if (frame.pressed?.has('Button0')) { frame.pressed.delete('Button0'); accept(); }
    }, 1000);
    const waitForPageInput = async (page, requiredWork) => {
      await pageVisiblePromise; // A page's clock does not start while the screen is still waiting for audible wind.
      const authoredReveals = Array.isArray(page?.delayedReveals) ? page.delayedReveals : [];
      const delayedTail = Math.max(0, ...authoredReveals.map(reveal => Math.max(MIN_INTRA_SLIDE_DELAY_SECONDS, Number(reveal?.afterSeconds) || 0))); // Four seconds applies only to text revealed inside the current slide.
      const authoredMinimum = Math.max(0, Number(page?.minimumSeconds) || Number(stages[stageIndex]?.minimumSeconds) || 0);
      const minimumSeconds = Math.max(authoredMinimum, delayedTail + (delayedTail > 0 ? INTRO_FADE_MS / 1000 : 0)); // Continue can appear as soon as the authored page hold and final intra-slide fade are complete.
      const minimum = minimumSeconds * 1000;
      await Promise.race([cancellation, Promise.all([requiredWork, new Promise(resolve => setTimeout(resolve, Math.max(0, minimum - (nowMs() - startedAt))))])]);
      if (cancelled) throw new Error('Introduction loading cancelled');
      await new Promise((resolve, reject) => {
        continueStage = resolve; rejectStage = reject; ready = true; // Earlier taps are discarded; a fresh input is required for each visible page.
        continueButton.disabled = false;
        continueButton.style.pointerEvents = 'auto';
        continueButton.setAttribute?.('aria-hidden', 'false');
        continueButton.style.opacity = '1';
        continueButton.focus?.({ preventScroll: true });
      });
    };
    const session = {
      start(index) {
        if (cancelled) throw new Error('Introduction loading cancelled');
        stageIndex = index; pageIndex = 0;
        showPage(stagePages(stages[index])[0]);
      },
      async complete(requiredWork = Promise.resolve()) {
        const pages = stagePages(stages[stageIndex]);
        for (; pageIndex < pages.length; pageIndex += 1) {
          if (pageIndex > 0) showPage(pages[pageIndex]);
          const isLastPage = pageIndex === pages.length - 1;
          const page = pages[pageIndex];
          await waitForPageInput(page, isLastPage ? requiredWork : Promise.resolve()); // Only the last page of the loading phase inherits its asset-readiness gate.
          const afterPageSeconds = Math.max(0, Number(page?.afterPageSeconds) || 0);
          if (afterPageSeconds > 0) await Promise.race([cancellation, new Promise(resolve => setTimeout(resolve, afterPageSeconds * 1000))]); // Authored black gap between slides; currently used once after the proverb.
        }
        pageIndex = Math.max(0, pages.length - 1);
      },
      setProgress(percent) { percentText.textContent = `${Math.round(Math.max(0, Math.min(100, percent)))}%`; }, // Existing preparation owners report their actual readiness milestones.
      finish() {
        cancelled = true; ready = false; clearPageTimers();
        introAudio?.finish?.();
        document.body.classList?.remove('introduction-loading');
        document.removeEventListener('keydown', keydown, true); unsubscribe?.(); inputLock?.release?.(); root.remove();
        if (window.ControllerInput?.owner === 'introduction-loading') window.ControllerInput.setOwner('gameplay');
        if (state.introduction === session) { state.introduction = null; state.introductionStage = 0; finalizeHide(state.generation); }
      },
      cancel() { const error = new Error('Introduction loading cancelled'); rejectCancellation(error); rejectStage?.(error); session.finish(); },
      getDebug: () => ({ audio: introAudio?.debug?.(), presetId, stage: stageIndex + 1, page: pageIndex + 1, pageCount: stagePages(stages[stageIndex]).length, ready, minimumSeconds: stagePages(stages[stageIndex])[pageIndex]?.minimumSeconds ?? stages[stageIndex]?.minimumSeconds, latestChange: 'Opening narration waits for audible wind before first paint; four seconds applies only to intra-slide reveals, the proverb is bold/bronze, and its authored ten-second black inter-slide pause precedes the carriage crash.' }),
    };
    state.introduction = session; // Claim foreground synchronously before config/fonts are fetched.
    try {
      const [config] = await Promise.all([ensureConfigLoaded(), ensureFontsLoaded()]); // Font loading settles before the first opening page appears.
      stages = config.entries?.find(entry => entry.id === presetId)?.stages || [];
      if (stages.length !== 4) throw new Error('Introduction preset must contain four loading phases');
      session.start(0);
      return session;
    } catch (error) { session.cancel(); throw error; }
  }

  function callbackSource(callback) {
    try { return typeof callback === 'function' ? Function.prototype.toString.call(callback) : ''; }
    catch (_) { return ''; }
  }

  function isBuildingArea(area) {
    try {
      if (window.GridTileAccessors?.isBuildingArea?.(area)) return true;
    } catch (_) {}
    return BUILDING_AREA_RE.test(String(area || ''));
  }

  function shouldLoadForTransition(callback) {
    const area = safeCurrentArea();
    if (isBuildingArea(area)) return false; // Exiting an authored building never gets a loading screen.
    const source = callbackSource(callback);
    if (!source || BUILDING_CALL_RE.test(source)) return false; // Entering an authored building never gets a loading screen.
    return MAP_CALL_RE.test(source);
  }

  function wrapStartSceneTransition(original) {
    if (typeof original !== 'function' || original.__hobunjiLoadingScreenWrapped) return original;
    const wrapped = function loadingScreenSceneTransition(callback, ...args) {
      const useLoader = shouldLoadForTransition(callback); // Used to distinguish world-map travel from ordinary building entry/exit.
      if (!useLoader) return original.call(this, callback, ...args);

      show({ reason: 'world-map-transition' });
      const wrappedCallback = typeof callback === 'function'
        ? function (...callbackArgs) {
            let result;
            try { result = callback.apply(this, callbackArgs); }
            catch (error) { hide('world-map-transition-error'); throw error; }
            Promise.resolve(result).then(
              () => hide('world-map-transition-ready'),
              () => hide('world-map-transition-error'),
            );
            return result;
          }
        : callback;
      return original.call(this, wrappedCallback, ...args);
    };
    wrapped.__hobunjiLoadingScreenWrapped = true;
    wrapped.__hobunjiLoadingScreenOriginal = original;
    return wrapped;
  }

  function installDependencyInitHooks() {
    const seen = new Set(); // Used to avoid wrapping aliases that point at the same namespace object.
    for (const key of Object.getOwnPropertyNames(window)) {
      let namespace;
      try { namespace = window[key]; } catch (_) { continue; }
      if (!namespace || (typeof namespace !== 'object' && typeof namespace !== 'function') || seen.has(namespace)) continue;
      seen.add(namespace);
      const originalInit = namespace.init;
      if (typeof originalInit !== 'function' || originalInit.__hobunjiLoadingDepsWrapped) continue;
      try {
        const wrappedInit = function loadingScreenAwareInit(injectedDeps, ...args) {
          if (injectedDeps?.startSceneTransition && !injectedDeps.startSceneTransition.__hobunjiLoadingScreenWrapped) {
            injectedDeps.startSceneTransition = wrapStartSceneTransition(injectedDeps.startSceneTransition);
          }
          return originalInit.call(this, injectedDeps, ...args);
        };
        wrappedInit.__hobunjiLoadingDepsWrapped = true;
        namespace.init = wrappedInit;
        state.dependencyInitHooks += 1;
      } catch (_) {
        // Some third-party namespaces expose non-writable init methods; skip them.
      }
    }
  }

  function installTransitionHook() {
    const tryInstall = () => {
      const original = window.startSceneTransition;
      if (typeof original === 'function') {
        const wrapped = wrapStartSceneTransition(original);
        if (wrapped !== original || original.__hobunjiLoadingScreenWrapped) {
          window.startSceneTransition = wrapped;
          state.transitionHookInstalled = true;
          state.transitionHookTimer = null;
          updateDebugPanel();
          return true;
        }
      }
      return false;
    };

    if (tryInstall() || typeof setTimeout !== 'function') return;
    let attempts = 0; // Used only as a defensive fallback while game.js is still parser-executing.
    const retry = () => {
      if (tryInstall()) return;
      attempts += 1;
      if (attempts < 240) state.transitionHookTimer = setTimeout(retry, 50);
    };
    state.transitionHookTimer = setTimeout(retry, 0);
    if (document.readyState === 'loading') document.addEventListener?.('DOMContentLoaded', tryInstall, { once: true });
  }

  function beginBootScreen() {
    if (typeof document.readyState !== 'string') return;
    if (!document.body) {
      if (!state.bootRetryInstalled) {
        state.bootRetryInstalled = true;
        document.addEventListener?.('DOMContentLoaded', () => {
          state.bootRetryInstalled = false;
          beginBootScreen();
        }, { once: true });
      }
      return;
    }
    installOnboardingPresenceObserver();
    show({ reason: 'initial-boot' });
    const completeBoot = () => hide('initial-boot-ready'); // Used by the browser load boundary so boot reaches 100 only when page resources are done.
    if (document.readyState === 'complete') completeBoot();
    else window.addEventListener?.('load', completeBoot, { once: true });
  }

  installFetchProgressHook();
  installDependencyInitHooks();
  installTransitionHook();

  window.LoadingScreenRuntime = Object.freeze({
    installed: true,
    show,
    hide,
    beginIntroduction,
    setProgress,
    shouldLoadForTransition,
    installTransitionHook,
    getProgress: () => state.progress,
    getDebug: () => ({
      visible: state.visible,
      introduction: state.introduction?.getDebug() || null,
      generation: state.generation,
      reason: state.reason,
      progress: state.progress,
      progressSource: state.progressSource,
      requestStarted: state.requestStarted,
      requestCompleted: state.requestCompleted,
      tankanFontSettled: state.tankanFontSettled,
      area: safeCurrentArea(),
      contextText: state.contextText,
      activeTipTitle: state.activeTipTitle,
      activeTip: state.activeTip,
      tipRotationMs: TIP_ROTATE_MS,
      tipRotationActive: !!state.tipTimer,
      minimumVisibleMs: MIN_VISIBLE_MS,
      transitionHookInstalled: state.transitionHookInstalled,
      dependencyInitHooks: state.dependencyInitHooks,
      suppressedByOnboarding: state.suppressedByOnboarding,
    }),
    formatDebug,
  });

  beginBootScreen();
})();

// Parser-synchronously load the unfinished-zone gate before game.js registers
// its input handlers. Keeping the gate in its own module avoids coupling Dev Mode
// policy to loading-screen rendering while preserving the current boot manifest.
(() => {
  'use strict';
  const src = 'js/dev-zone-gate.js?v=20260907a'; // Used as the cache-busted runtime path for the Dev Mode entrance gate.
  if (window.DevZoneGate?.installed || document.querySelector?.('script[data-dev-zone-gate]')) return;
  if (document.readyState === 'loading' && typeof document.write === 'function') {
    document.write(`<script src="${src}" data-dev-zone-gate="1"><\/script>`);
    return;
  }
  const script = document.createElement('script'); // Used only if this runtime is injected after initial HTML parsing.
  script.src = src;
  script.dataset.devZoneGate = '1';
  (document.head || document.documentElement).appendChild(script);
})();
