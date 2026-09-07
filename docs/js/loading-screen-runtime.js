// In-game loading-screen overlay. It is the first painted game surface, then
// reappears for scene/map transitions. The authored loading-screen entry owns
// the image/script composition; the prose slot is populated from the canonical
// player-facing Compendium instead of maintaining a second lore/tutorial copy.
(() => {
  'use strict';

  if (window.LoadingScreenRuntime?.installed) return;

  const CONFIG_URL = 'config/loading-screens.json';
  const COMPENDIUM_URL = 'js/compendium-ui.js?v=20260907loadingtips1';
  const LORE_FONT_URL = 'assets/hud/KhymeryyanRomanLetters+Numbers.otf.ttf';
  const TANKAN_FONT_URL = 'assets/hud/tankanscript_rotated_flipped_horiz.otf';
  const MIN_VISIBLE_MS = 3000; // Used by hide() so every boot/map loading screen remains readable for at least three seconds.
  const DEFAULT_SETTINGS = Object.freeze({
    scriptSide: 'left', imageScale: 1, panRange: 7, panSpeed: 0.055,
    manualSpeed: 150, loreSize: 19, scriptSize: 89, scriptY: 46,
    columnSpacing: -0.55, scriptScrollSpeed: 0.017,
  }); // Used for the synchronous first paint before loading-screens.json finishes fetching.
  const FALLBACK_TIPS = Object.freeze([
    'Health keeps you alive, Stamina pays for effort, and Footing keeps you upright.',
    'If an action costs more Stamina than you have, it is still allowed, but you become Exhausted and begin spending Black Stamina.',
    'Taking Footing damage can stagger you. Reaching 0 Footing puts you prone.',
    'Mastery belongs to the individual tool or weapon you use; it is separate from broad character Skills such as Combat or Farming.',
    'Combat use awards weapon Mastery when you actually kill an enemy with that weapon, and tougher enemies are worth more.',
    'A shovel gains Mastery when it exposes buried treasure, not for ordinary digging.',
    'Motes of Prowess pay for technique choices after the matching Mastery rank opens that level.',
    'Tap 1 follows your weapon\'s Combo, while Tap 2 is a selectable Quick Attack.',
    'Hold 1 accepts Offensive Holds; Hold 2 accepts Defensive or Offensive Holds.',
    'Quick Attack and Held Attack choices are remembered separately for each weapon.',
    'Ranged weapon Mastery alternates between Basic Ammo choices and Special Ammo slots.',
    'Every alchemy reagent carries one Humour, one Drive, and one Elemental Magnetism.',
  ]); // Used only before the Compendium DOM is available; each line is condensed from existing Compendium guidance.

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
    visibleSince: 0,
    progress: 0,
    progressSource: 'idle',
    requestStarted: 0,
    requestCompleted: 0,
    lastArea: null,
    areaWatchTimer: null,
    transitionHookTimer: null,
    debugTapCount: 0,
    debugTapAt: 0,
    debugVisible: false,
    activeTip: '',
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
      const script = document.createElement('script'); // Used to make the canonical Compendium definitions available to the very first loading screen.
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
#hlsScriptWords{display:flex;flex-direction:row;align-items:flex-start;justify-content:center;gap:0;width:max-content}
.hlsVerticalWord{display:flex;flex-direction:column;align-items:center;justify-content:flex-start;font-family:"TankanScript",sans-serif;line-height:.56;color:#fff;white-space:nowrap}
.hlsVerticalGlyph{display:block;width:1em;height:.56em;line-height:.56em;text-align:center}
#hlsLore{position:absolute;left:50%;bottom:max(5.5vh,28px);transform:translateX(-50%);width:min(78vw,980px);text-align:center;color:#fff;font-family:"KhymeryyanRoman",serif;line-height:1.24;text-wrap:balance;text-shadow:0 2px 8px rgba(0,0,0,.9)}
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
<div id="hlsLore"></div>
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
      lore: root.querySelector('#hlsLore'),
      percent: root.querySelector('#hlsPercent'),
      debug: root.querySelector('#hlsDebug'),
    };
    state.els.percent?.addEventListener?.('pointerup', onPercentDebugTap);
    return state.els;
  }

  function onPercentDebugTap() {
    const now = Date.now(); // Used to detect a deliberate five-tap mobile diagnostics gesture without adding permanent debug chrome.
    if (now - state.debugTapAt > 1800) state.debugTapCount = 0;
    state.debugTapAt = now;
    state.debugTapCount += 1;
    if (state.debugTapCount < 5) return;
    state.debugTapCount = 0;
    state.debugVisible = !state.debugVisible;
    updateDebugPanel();
  }

  function formatDebug() {
    const area = safeCurrentArea();
    return [
      `visible=${state.visible} generation=${state.generation}`,
      `reason=${state.reason} area=${area ?? 'unknown'}`,
      `progress=${Math.round(state.progress)} source=${state.progressSource}`,
      `requests=${state.requestCompleted}/${state.requestStarted}`,
      `visibleFor=${Math.round(state.visible ? nowMs() - state.visibleSince : 0)}ms min=${MIN_VISIBLE_MS}ms`,
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
    els.scriptWords.style.setProperty('gap', `${Number(settings.columnSpacing) || 0}em`);
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
      if (copy.length >= 20) tips.push({ key: `${title}:copy`, text: copy });
      const notes = card.querySelectorAll?.('.compendium-notes li') || [];
      for (let index = 0; index < notes.length; index++) {
        const note = compactTip(notes[index]?.textContent);
        if (note.length >= 20) tips.push({ key: `${title}:note:${index}`, text: note });
      }
    }
    return tips;
  }

  function pickTip() {
    const canonical = extractCompendiumTips();
    const pool = canonical.length
      ? canonical
      : FALLBACK_TIPS.map((text, index) => ({ key: `fallback:${index}`, text }));
    const nonRepeat = pool.length > 1 && state.lastTipKey
      ? pool.filter(tip => tip.key !== state.lastTipKey)
      : pool;
    const tip = nonRepeat[Math.floor(Math.random() * nonRepeat.length)] || pool[0] || { key: 'empty', text: '' };
    state.lastTipKey = tip.key;
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
    for (const match of String(text || '').matchAll(pattern)) {
      if (match.index > cursor) container.appendChild(document.createTextNode(String(text).slice(cursor, match.index)));
      const span = document.createElement('span');
      span.className = byTerm.get(match[0].toLowerCase()) || 'hlsSystemTerm';
      span.textContent = match[0];
      container.appendChild(span);
      cursor = match.index + match[0].length;
    }
    if (cursor < String(text || '').length) container.appendChild(document.createTextNode(String(text).slice(cursor)));
  }

  function applyEntryAndSettings(config) {
    const els = buildDom();
    const settings = { ...DEFAULT_SETTINGS, ...(config?.settings || {}) };
    const entry = pickEntry(config?.entries || []) || { image: '', script: 'HOBUNJI HOLLOW' };
    const hasImage = !!entry.image;
    els.image.style.display = hasImage ? '' : 'none';
    if (hasImage && els.image.src !== entry.image) els.image.src = entry.image;
    els.lore.style.fontSize = `${settings.loreSize}px`;
    renderRichTip(els.lore, pickTip());
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
    setProgress(22 + ratio * 66, 'network-complete');
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

  function showImmediate(reason = 'map-change') {
    const myGeneration = ++state.generation;
    if (state.hideTimer && typeof clearTimeout === 'function') clearTimeout(state.hideTimer);
    state.hideTimer = null;
    state.finalHiddenGeneration = 0;
    state.visible = true;
    state.visibleSince = nowMs();
    state.requestStarted = 0;
    state.requestCompleted = 0;
    state.reason = reason;
    const els = buildDom();
    els.root.classList.add('visible');
    renderScript(els, DEFAULT_SETTINGS, 'HOBUNJI HOLLOW');
    els.scriptViewport.style.left = '25%';
    els.scriptViewport.style.top = '46%';
    els.lore.style.fontSize = `${DEFAULT_SETTINGS.loreSize}px`;
    renderRichTip(els.lore, pickTip());
    setProgress(0, 'session-start', true);
    state.lastFrameTime = nowMs();
    if (state.motionRaf) cancelAnimationFrame(state.motionRaf);
    state.motionRaf = requestAnimationFrame(t => motionTick(t, DEFAULT_SETTINGS));
    return myGeneration;
  }

  // Shows synchronously first (so a blocking map build cannot starve the first
  // paint), then fills authored settings/canonical Compendium copy as their
  // resources resolve. The returned promise resolves after two paint frames.
  async function show(options = {}) {
    const reason = typeof options === 'string' ? options : (options?.reason || 'map-change');
    const myGeneration = showImmediate(reason);
    setProgress(4, 'overlay-visible');
    const resources = Promise.all([ensureFontsLoaded(), ensureConfigLoaded(), ensureCompendiumLoaded()]);
    await resources;
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
    if (generation !== state.generation) return;
    state.finalHiddenGeneration = generation;
    state.visible = false;
    if (state.motionRaf) { cancelAnimationFrame(state.motionRaf); state.motionRaf = null; }
    state.els?.root.classList.remove('visible');
    state.hideTimer = null;
    updateDebugPanel();
  }

  function hide(reason = 'map-ready') {
    if (!state.generation) return Promise.resolve();
    const generation = state.generation; // Used to make a delayed three-second hide harmless if a newer transition starts first.
    state.reason = reason;
    setProgress(100, 'map-ready');
    const wait = Math.max(0, MIN_VISIBLE_MS - (nowMs() - state.visibleSince));
    if (wait <= 0 || typeof setTimeout !== 'function') {
      finalizeHide(generation);
      return Promise.resolve();
    }
    if (state.hideTimer && typeof clearTimeout === 'function') clearTimeout(state.hideTimer);
    return new Promise(resolve => {
      state.hideTimer = setTimeout(() => {
        finalizeHide(generation);
        resolve();
      }, wait);
    });
  }

  function safeCurrentArea() {
    try { return window.GridTileAccessors?.getCurrentArea?.() ?? null; }
    catch (_) { return null; }
  }

  function watchAreaChanges() {
    if (state.areaWatchTimer || typeof setInterval !== 'function') return;
    state.areaWatchTimer = setInterval(() => {
      const area = safeCurrentArea();
      if (area == null) return;
      if (state.lastArea == null) { state.lastArea = area; return; }
      if (area === state.lastArea) return;
      state.lastArea = area;
      if (state.visible) return;
      show({ reason: `area-change:${area}` });
      hide('area-change-ready');
    }, 200);
  }

  function installTransitionHook() {
    if (typeof setTimeout !== 'function') return;
    let attempts = 0; // Used to retry until game.js has declared the central startSceneTransition function.
    const tryInstall = () => {
      const original = window.startSceneTransition;
      if (typeof original === 'function' && !original.__hobunjiLoadingScreenWrapped) {
        const wrapped = function loadingScreenSceneTransition(callback, ...args) {
          show({ reason: 'scene-transition' });
          const wrappedCallback = typeof callback === 'function'
            ? function (...callbackArgs) {
                let result;
                try { result = callback.apply(this, callbackArgs); }
                catch (error) { hide('scene-transition-error'); throw error; }
                Promise.resolve(result).then(
                  () => hide('scene-transition-ready'),
                  () => hide('scene-transition-error'),
                );
                return result;
              }
            : callback;
          return original.call(this, wrappedCallback, ...args);
        };
        wrapped.__hobunjiLoadingScreenWrapped = true;
        wrapped.__hobunjiLoadingScreenOriginal = original;
        window.startSceneTransition = wrapped;
        return;
      }
      attempts += 1;
      if (attempts < 240) state.transitionHookTimer = setTimeout(tryInstall, 50);
    };
    tryInstall();
  }

  function beginBootScreen() {
    if (typeof document.readyState !== 'string' || !document.body) return;
    show({ reason: 'initial-boot' });
    const completeBoot = () => hide('initial-boot-ready'); // Used by the real browser load boundary so the boot percentage reaches 100 only when page resources are done.
    if (document.readyState === 'complete') completeBoot();
    else window.addEventListener?.('load', completeBoot, { once: true });
  }

  installFetchProgressHook();
  watchAreaChanges();
  installTransitionHook();

  window.LoadingScreenRuntime = Object.freeze({
    installed: true,
    show,
    hide,
    setProgress,
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
      activeTip: state.activeTip,
      minimumVisibleMs: MIN_VISIBLE_MS,
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
