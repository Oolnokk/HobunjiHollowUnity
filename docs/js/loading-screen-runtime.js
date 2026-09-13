// In-game loading-screen overlay. It is the first painted game surface, then
// reappears for world-map travel. Building entry/exit deliberately keeps the
// ordinary scene fade instead of showing this loader.
(() => {
  'use strict';

  if (window.LoadingScreenRuntime?.installed) return;

  const CONFIG_URL = 'config/loading-screens.json';
  const COMPENDIUM_URL = 'js/compendium-ui.js?v=20260907loadingtips1';
  const SKY_BACKDROP_URL = 'js/loading-screen-sky-backdrop.js?v=20260913e';
  const LORE_FONT_URL = 'assets/hud/KhymeryyanRomanLetters+Numbers.otf.ttf';
  const TANKAN_FONT_URL = 'assets/hud/tankanscript_rotated_flipped_horiz.otf';
  const MIN_VISIBLE_MS = 5000; // Used by hide() so boot/map loaders stay readable for at least five seconds.
  const TIP_ROTATE_MS = 10000; // Used by startTipRotation() so long loading screens show a fresh tip every ten seconds.
  const BUILDING_AREA_RE = /^(?:interior|map_i_)/i; // Used only as a fallback until the canonical building-area accessor is initialized.
  const BUILDING_CALL_RE = /\b(?:enterBuilding|enterInterior|exitBuilding|leaveBuilding|exitInterior|leaveInterior)\b/i; // Used to suppress explicit building entry/exit callbacks.
  const MAP_CALL_RE = /\b(?:enterZone|performTravel|doTravel|setCurrentArea)\b/; // Used to recognize world-map travel callbacks before their expensive work begins.
  const DEFAULT_SETTINGS = Object.freeze({
    scriptSide: 'left', imageScale: 1, panRange: 7, panSpeed: 0.055,
    manualSpeed: 150, loreSize: 19, scriptSize: 160, scriptY: 45,
    columnSpacing: -0.56, scriptScrollSpeed: 0.03,
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
    skyBackdropPromise: null,
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
    reason: 'idle',
    tipPoolGeneration: 0,
    tipPoolCache: null,
    semanticRulesCache: null,
  }; // Used by rendering, transition coverage, real request progress, and the built-in mobile diagnostics panel.

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const nowMs = () => (window.performance?.now?.() ?? Date.now());

  function ensureSkyBackdropLoaded() {
    if (window.LoadingScreenSkyBackdrop?.installed) {
      window.LoadingScreenSkyBackdrop.redraw?.();
      return Promise.resolve(true);
    }
    if (state.skyBackdropPromise) return state.skyBackdropPromise;
    state.skyBackdropPromise = new Promise(resolve => {
      const script = document.createElement('script');
      script.src = SKY_BACKDROP_URL;
      script.async = false;
      script.dataset.hobunjiLoadingSkyRuntime = '1';
      script.onload = () => {
        const installed = !!window.LoadingScreenSkyBackdrop?.installed;
        window.LoadingScreenSkyBackdrop?.redraw?.();
        resolve(installed);
      };
      script.onerror = () => {
        state.skyBackdropPromise = null;
        try { (window.__farmLog || console.warn)(`[loading-screen] failed to load ${SKY_BACKDROP_URL}`, 'warn'); } catch (_) {}
        resolve(false);
      };
      (document.head || document.documentElement).appendChild(script);
    });
    return state.skyBackdropPromise;
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
      .catch(() => false);
    const tankanFontPromise = new FontFace('TankanScript', `url('${TANKAN_FONT_URL}')`).load()
      .then(font => { document.fonts.add(font); return true; })
      .catch(() => false)
      .then(loaded => {
        revealTankanScript();
        return loaded;
      });
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
      const script = document.createElement('script');
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
#hobunjiLoadScreen{position:fixed;inset:0;z-index:9000;background:#000;display:none;overflow:hidden;pointer-events:none;isolation:isolate}
#hobunjiLoadScreen.visible{display:block}
#hlsSkyBackdrop{position:absolute;inset:0;width:100%;height:100%;z-index:0;pointer-events:none}
#hlsImage{position:absolute;left:50%;top:48%;width:auto;height:auto;max-width:78vw;max-height:70vh;object-fit:contain;transform-origin:center center;will-change:transform;z-index:1}
#hlsScriptViewport{position:absolute;top:0;width:min(42vw,540px);height:100%;overflow:visible;transform:translateX(-50%);visibility:hidden;z-index:1}
#hobunjiLoadScreen.tankan-font-settled #hlsScriptViewport{visibility:visible}
#hlsScriptFloat{position:absolute;left:50%;top:0;will-change:transform}
#hlsScriptWords{display:flex;flex-direction:row;align-items:flex-start;justify-content:center;gap:0;width:max-content;--script-column-spacing:0em}
.hlsVerticalWord + .hlsVerticalWord{margin-left:var(--script-column-spacing)}
.hlsVerticalWord{display:flex;flex-direction:column;align-items:center;justify-content:flex-start;font-family:"TankanScript",sans-serif;line-height:.56;color:#fff;white-space:nowrap}
.hlsVerticalGlyph{display:block;width:1em;height:.56em;line-height:.56em;text-align:center}
#hlsLoreBlock{position:absolute;left:50%;bottom:max(5.5vh,28px);transform:translateX(-50%);width:min(78vw,980px);text-align:center;color:#fff;font-family:"KhymeryyanRoman",serif;text-shadow:0 2px 8px rgba(0,0,0,.9);z-index:1}
#hlsLoreHeader{margin:0 0 .42em;font-size:15px;line-height:1.05;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#8fd0ff;text-wrap:balance}
#hlsLore{line-height:1.24;text-wrap:balance}
#hlsPercent{position:absolute;right:max(4vw,24px);bottom:max(5.5vh,28px);color:#fff;font-family:"KhymeryyanRoman",serif;font-size:18px;line-height:1;text-shadow:0 2px 8px rgba(0,0,0,.9);pointer-events:auto;user-select:none;z-index:1}
#hlsDebug{display:none;position:absolute;right:max(4vw,24px);bottom:max(9vh,58px);max-width:min(84vw,440px);padding:9px 11px;border:1px solid rgba(255,255,255,.35);border-radius:7px;background:rgba(0,0,0,.82);color:#eee;font:11px/1.35 monospace;white-space:pre-wrap;text-align:left;text-shadow:none;z-index:2}
#hlsSkyDebug{z-index:2!important}
#hlsDebug.visible{display:block}
.hlsProperNoun{color:#e8c86b}
.hlsSystemTerm{color:#8fd0ff}
.hlsResourceHealth{color:#ff7777}
.hlsResourceStamina{color:#ffd76b}
.hlsResourceFooting{color:#9fd6a4}
.hlsAfflictedResource{font-weight:700;text-decoration:underline;text-decoration-style:dotted;text-underline-offset:.14em}
.hlsAttackQuick{color:#f6a65c;font-weight:700}
.hlsAttackHeld{color:#bd9cff;font-weight:700}
.hlsAttackCombo{color:#6ed0c3;font-weight:700}
.hlsAttackDefensive{color:#89b8ff;font-weight:700}
`;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.id = 'hobunjiLoadScreen';
    root.innerHTML = `
<img id="hlsImage" alt="" />
<div id="hlsScriptViewport"><div id="hlsScriptFloat"><div id="hlsScriptWords"></div></div></div>
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
    const now = Date.now();
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
      `progress=${Math.round(state.progress)} source=${state.progressSource}`,
      `requests=${state.requestCompleted}/${state.requestStarted}`,
      `skyBackdrop=${window.LoadingScreenSkyBackdrop?.installed ? 'installed' : state.skyBackdropPromise ? 'loading' : 'missing'}`,
      `tankanFont=${state.tankanFontSettled ? 'settled' : 'waiting'}`,
      `visibleFor=${Math.round(state.visible ? nowMs() - state.visibleSince : 0)}ms min=${MIN_VISIBLE_MS}ms`,
      `tipRotation=${TIP_ROTATE_MS}ms active=${!!state.tipTimer}`,
      `transitionHook=${state.transitionHookInstalled} dependencyInitHooks=${state.dependencyInitHooks}`,
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
    const source = String(text || '').trim();
    const labeledPrefix = source.match(/^([^:]{2,48}):\s+\S/);
    if (labeledPrefix) {
      const label = labeledPrefix[1].trim();
      if (!/^(?:Tags|Keywords)$/i.test(label)) return label;
    }
    const entryTitle = card.querySelector?.('.compendium-entry-title')?.textContent?.trim() || '';
    const sectionTitle = card.closest?.('.compendium-section')?.querySelector?.('.compendium-section-title')?.textContent?.trim() || '';
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
      const copyTitle = resolveCompendiumTipTitle(card, copy);
      if (copy.length >= 20) tips.push({ key: `${title}:copy`, title: copyTitle, text: copy });
      const notes = card.querySelectorAll?.('.compendium-notes li') || [];
      for (let index = 0; index < notes.length; index++) {
        const note = compactTip(notes[index]?.textContent);
        const noteTitle = resolveCompendiumTipTitle(card, note);
        if (note.length >= 20) tips.push({ key: `${title}:note:${index}`, title: noteTitle, text: note });
      }
    }
    return tips;
  }

  function invalidateTipCacheIfStale() {
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
        byTerm: new Map(rules.map(([term, className]) => [term.toLowerCase(), className])),
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
    ];

    const pane = document.querySelector?.('#mpCompendium');
    const vocabularyNodes = pane?.querySelectorAll?.('.compendium-entry-title, .compendium-section-title') || [];
    for (const node of vocabularyNodes) {
      const term = String(node?.textContent || '').trim();
      if (term.length >= 3) rules.push([term, 'hlsSystemTerm']);
    }

    const registry = window.ResourceSystem?.AFFLICTIONS || {};
    for (const definition of Object.values(registry)) {
      const name = String(definition?.name || '').trim();
      if (!name) continue;
      const resource = String(definition?.resource || '').toLowerCase();
      const resourceClass = resource === 'health' ? 'hlsResourceHealth'
        : resource === 'stamina' ? 'hlsResourceStamina'
          : resource === 'footing' ? 'hlsResourceFooting'
            : 'hlsSystemTerm';
      rules.push([name, `${resourceClass} hlsAfflictedResource`]);
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
      span.className = byTerm.get(match[0].toLowerCase()) || 'hlsSystemTerm';
      span.textContent = match[0];
      container.appendChild(span);
      cursor = match.index + match[0].length;
    }
    if (cursor < source.length) container.appendChild(document.createTextNode(source.slice(cursor)));
  }

  function renderActiveTip(els, text) {
    els.loreHeader.textContent = state.activeTipTitle || 'Compendium';
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
    const originalFetch = window.fetch.bind(window);
    const wrappedFetch = function hobunjiLoadingProgressFetch(...args) {
      const generation = state.visible ? state.generation : 0;
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
    const viewportHeight = Math.max(1, state.els.root.clientHeight || innerHeight || 1);
    const contentHeight = Math.max(1, state.els.scriptFloat.offsetHeight || 1);
    const legacyWindowHeight = Math.min(viewportHeight * 0.72, 880);
    const authoredY = clamp(Number(settings.scriptY) || 45, 0, 100) / 100;
    const anchorTop = viewportHeight * authoredY - legacyWindowHeight * 0.5;
    const travel = viewportHeight + contentHeight;
    const phaseOffset = ((viewportHeight - anchorTop) / travel) % 1;
    const travelPhase = (state.scriptScrollPhase + phaseOffset) % 1;
    const scriptY = viewportHeight - travelPhase * travel;
    state.els.scriptFloat.style.transform = `translateX(-50%) translateY(${scriptY}px)`;
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

  function showImmediate(reason = 'map-change') {
    ensureSkyBackdropLoaded();
    const previousGeneration = state.generation;
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
    state.activeTip = '';
    state.activeTipTitle = '';
    const els = buildDom();
    els.root.classList.add('visible');
    window.LoadingScreenSkyBackdrop?.redraw?.();
    renderScript(els, DEFAULT_SETTINGS, 'HOBUNJI HOLLOW');
    els.scriptViewport.style.left = '25%';
    els.lore.style.fontSize = `${DEFAULT_SETTINGS.loreSize}px`;
    renderActiveTip(els, pickTip());
    startTipRotation(myGeneration);
    setProgress(0, 'session-start', true);
    state.lastFrameTime = nowMs();
    if (state.motionRaf) cancelAnimationFrame(state.motionRaf);
    state.motionRaf = requestAnimationFrame(t => motionTick(t, DEFAULT_SETTINGS));
    return myGeneration;
  }

  async function show(options = {}) {
    const reason = typeof options === 'string' ? options : (options?.reason || 'map-change');
    const myGeneration = showImmediate(reason);
    setProgress(4, 'overlay-visible');
    await Promise.all([ensureSkyBackdropLoaded(), ensureFontsLoaded(), ensureConfigLoaded(), ensureCompendiumLoaded()]);
    if (state.generation !== myGeneration || state.finalHiddenGeneration === myGeneration) return;
    setProgress(16, 'loader-resources');
    const config = await state.configPromise;
    if (state.generation !== myGeneration || state.finalHiddenGeneration === myGeneration) return;
    const settings = applyEntryAndSettings(config);
    window.LoadingScreenSkyBackdrop?.redraw?.();
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
    if (!state.generation) return Promise.resolve();
    const generation = state.generation;
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
    if (isBuildingArea(area)) return false;
    const source = callbackSource(callback);
    if (!source || BUILDING_CALL_RE.test(source)) return false;
    return MAP_CALL_RE.test(source);
  }

  function wrapStartSceneTransition(original) {
    if (typeof original !== 'function' || original.__hobunjiLoadingScreenWrapped) return original;
    const wrapped = function loadingScreenSceneTransition(callback, ...args) {
      const useLoader = shouldLoadForTransition(callback);
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
    const seen = new Set();
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
      } catch (_) {}
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
    let attempts = 0;
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
    ensureSkyBackdropLoaded();
    show({ reason: 'initial-boot' });
    const completeBoot = () => hide('initial-boot-ready');
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
    setProgress,
    shouldLoadForTransition,
    installTransitionHook,
    ensureSkyBackdropLoaded,
    getProgress: () => state.progress,
    getDebug: () => ({
      visible: state.visible,
      generation: state.generation,
      reason: state.reason,
      progress: state.progress,
      progressSource: state.progressSource,
      requestStarted: state.requestStarted,
      requestCompleted: state.requestCompleted,
      skyBackdropInstalled: !!window.LoadingScreenSkyBackdrop?.installed,
      tankanFontSettled: state.tankanFontSettled,
      area: safeCurrentArea(),
      activeTipTitle: state.activeTipTitle,
      activeTip: state.activeTip,
      tipRotationMs: TIP_ROTATE_MS,
      tipRotationActive: !!state.tipTimer,
      minimumVisibleMs: MIN_VISIBLE_MS,
      transitionHookInstalled: state.transitionHookInstalled,
      dependencyInitHooks: state.dependencyInitHooks,
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
  const src = 'js/dev-zone-gate.js?v=20260907a';
  if (window.DevZoneGate?.installed || document.querySelector?.('script[data-dev-zone-gate]')) return;
  if (document.readyState === 'loading' && typeof document.write === 'function') {
    document.write(`<script src="${src}" data-dev-zone-gate="1"><\/script>`);
    return;
  }
  const script = document.createElement('script');
  script.src = src;
  script.dataset.devZoneGate = '1';
  (document.head || document.documentElement).appendChild(script);
})();