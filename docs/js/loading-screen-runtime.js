// In-game loading-screen overlay. It is the first painted game surface, then
// reappears for world-map travel. Building entry/exit deliberately keeps the
// ordinary scene fade instead of showing this loader.
(() => {
  'use strict';

  if (window.LoadingScreenRuntime?.installed) return;

  const CONFIG_URL = 'config/loading-screens.json';
  const COMPENDIUM_URL = 'js/compendium-ui.js?v=20260907loadingtips1';
  const LORE_FONT_URL = 'assets/hud/KhymeryyanRomanLetters+Numbers.otf.ttf';
  const TANKAN_FONT_URL = 'assets/hud/tankanscript_rotated_flipped_horiz.otf';
  const MIN_VISIBLE_MS = 5000; // Used by hide() so boot/map loaders stay readable for at least five seconds.
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
    lastEntryId: null,
    lastTipKey: null,
    visible: false,
    motionRaf: null,
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
  }; // Used by rendering, transition coverage, real request progress, and the built-in mobile diagnostics panel.

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const nowMs = () => (window.performance?.now?.() ?? Date.now());

  function ensureFontsLoaded() {
    if (state.fontsPromise) return state.fontsPromise;
    if (typeof FontFace !== 'function' || !document.fonts) return Promise.resolve(false);
    state.fontsPromise = Promise.all([
      new FontFace('KhymeryyanRoman', `url('${LORE_FONT_URL}')`).load().then(font => document.fonts.add(font)).catch(() => {}),
      new FontFace('TankanScript', `url('${TANKAN_FONT_URL}')`).load().then(font => document.fonts.add(font)).catch(() => {}),
    ]).then(() => true);
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
#hobunjiLoadScreen.visible{display:block}
#hlsImage{position:absolute;left:50%;top:48%;width:auto;height:auto;max-width:78vw;max-height:70vh;object-fit:contain;transform-origin:center center;will-change:transform}
#hlsScriptViewport{position:absolute;top:46%;width:min(42vw,540px);height:min(72vh,880px);overflow:hidden;transform:translate(-50%,-50%)}
#hlsScriptFloat{position:absolute;left:50%;top:0;will-change:transform}
#hlsScriptWords{display:flex;flex-direction:row;align-items:flex-start;justify-content:center;gap:0;width:max-content;--script-column-spacing:0em}
.hlsVerticalWord + .hlsVerticalWord{margin-left:var(--script-column-spacing)}
.hlsVerticalWord{display:flex;flex-direction:column;align-items:center;justify-content:flex-start;font-family:"TankanScript",sans-serif;line-height:.56;color:#fff;white-space:nowrap}
.hlsVerticalGlyph{display:block;width:1em;height:.56em;line-height:.56em;text-align:center}
#hlsLoreBlock{position:absolute;left:50%;bottom:max(5.5vh,28px);transform:translateX(-50%);width:min(78vw,980px);text-align:center;color:#fff;font-family:"KhymeryyanRoman",serif;text-shadow:0 2px 8px rgba(0,0,0,.9)}
#hlsLoreHeader{margin:0 0 .42em;font-size:15px;line-height:1.05;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#8fd0ff;text-wrap:balance}
#hlsLore{line-height:1.24;text-wrap:balance}
#hlsPercent{position:absolute;right:max(4vw,24px);bottom:max(5.5vh,28px);color:#fff;font-family:"KhymeryyanRoman",serif;font-size:18px;line-height:1;text-shadow:0 2px 8px rgba(0,0,0,.9);pointer-events:auto;user-select:none}
#hlsDebug{display:none;position:absolute;right:max(4vw,24px);bottom:max(9vh,58px);max-width:min(84vw,440px);padding:9px 11px;border:1px solid rgba(255,255,255,.35);border-radius:7px;background:rgba(0,0,0,.82);color:#eee;font:11px/1.35 monospace;white-space:pre-wrap;text-align:left;text-shadow:none}
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
      `progress=${Math.round(state.progress)} source=${state.progressSource}`,
      `requests=${state.requestCompleted}/${state.requestStarted}`,
      `visibleFor=${Math.round(state.visible ? nowMs() - state.visibleSince : 0)}ms min=${MIN_VISIBLE_MS}ms`,
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
      if (copy.length >= 20) tips.push({ key: `${title}:copy`, title, text: copy });
      const notes = card.querySelectorAll?.('.compendium-notes li') || [];
      for (let index = 0; index < notes.length; index++) {
        const note = compactTip(notes[index]?.textContent);
        if (note.length >= 20) tips.push({ key: `${title}:note:${index}`, title, text: note });
      }
    }
    return tips;
  }

  function pickTip() {
    const canonical = extractCompendiumTips();
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
    const rules = semanticRules();
    const byTerm = new Map(rules.map(([term, className]) => [term.toLowerCase(), className]));
    const pattern = new RegExp(rules.map(([term]) => escapeRegExp(term)).join('|'), 'gi');
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

  function showImmediate(reason = 'map-change') {
    const previousGeneration = state.generation; // Used to settle any delayed hide promises superseded by a newer loading screen.
    if (state.hideTimer && typeof clearTimeout === 'function') clearTimeout(state.hideTimer);
    state.hideTimer = null;
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
    renderScript(els, DEFAULT_SETTINGS, 'HOBUNJI HOLLOW');
    els.scriptViewport.style.left = '25%';
    els.scriptViewport.style.top = '46%';
    els.lore.style.fontSize = `${DEFAULT_SETTINGS.loreSize}px`;
    renderActiveTip(els, pickTip());
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
    const reason = typeof options === 'string' ? options : (options?.reason || 'map-change');
    const myGeneration = showImmediate(reason);
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
    if (state.motionRaf) { cancelAnimationFrame(state.motionRaf); state.motionRaf = null; }
    state.els?.root.classList.remove('visible');
    state.hideTimer = null;
    resolveHideWaiters(generation);
    updateDebugPanel();
  }

  function hide(reason = 'map-ready') {
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
    setProgress,
    shouldLoadForTransition,
    installTransitionHook,
    getProgress: () => state.progress,
    getDebug: () => ({
      visible: state.visible,
      generation: state.generation,
      reason: state.reason,
      progress: state.progress,
      progressSource: state.progressSource,
      requestStarted: state.requestStarted,
      requestCompleted: state.requestCompleted,
      area: safeCurrentArea(),
      activeTipTitle: state.activeTipTitle,
      activeTip: state.activeTip,
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