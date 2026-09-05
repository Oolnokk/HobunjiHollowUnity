// In-game loading-screen overlay, shown whenever a zone/building scene is
// about to be built fresh (not served from cache) -- long enough to cover
// a wilderness-zone or mine-floor rebuild, and a place to surface lore.
// Content (image/lore/script per entry, plus shared composition settings)
// is authored via tools/loading-screen-editor/index.html and exported to
// config/loading-screens.json; this module only renders it.
(() => {
  'use strict';

  if (window.LoadingScreenRuntime?.installed) return;

  const CONFIG_URL = 'config/loading-screens.json';
  const LORE_FONT_URL = 'assets/hud/KhymeryyanRomanLetters+Numbers.otf.ttf';
  const TANKAN_FONT_URL = 'assets/hud/tankanscript_rotated_flipped_horiz.otf';

  const state = {
    configPromise: null,
    fontsPromise: null,
    lastEntryId: null,
    visible: false,
    motionRaf: null,
    autoPhase: Math.random() * 4,
    scriptScrollPhase: 0,
    lastFrameTime: 0,
    els: null,
    generation: 0, // Bumped by each show() call so a stale one still awaiting
                   // its fonts/config fetch (or its post-paint rAFs) can tell a
                   // newer show() has since taken over -- see show()'s call
                   // sites (e.g. enterZone/enterBuilding), several of which
                   // fire-and-forget show() right before a synchronous rebuild.
    hiddenGeneration: 0, // Set to the generation hide() most recently hid, so a
                         // stale show() can tell it was actually cancelled by a
                         // real hide() call, as opposed to merely superseded by
                         // a newer show() (which owns the overlay now and must
                         // not be hidden out from under it).
  };

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
#hlsPercent{position:absolute;right:max(4vw,24px);bottom:max(5.5vh,28px);color:#fff;font-family:"KhymeryyanRoman",serif;font-size:18px;line-height:1;text-shadow:0 2px 8px rgba(0,0,0,.9)}
`;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.id = 'hobunjiLoadScreen';
    root.innerHTML = `
<img id="hlsImage" alt="" />
<div id="hlsScriptViewport"><div id="hlsScriptFloat"><div id="hlsScriptWords"></div></div></div>
<div id="hlsLore"></div>
<div id="hlsPercent"></div>
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
    };
    return state.els;
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
    if (entries.length > 1 && state.lastEntryId) pool = entries.filter(e => e.id !== state.lastEntryId);
    const entry = pool[Math.floor(Math.random() * pool.length)];
    state.lastEntryId = entry.id;
    return entry;
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

    state.motionRaf = requestAnimationFrame(t => motionTick(t, settings));
  }

  // Shows a random entry and resolves after the browser has actually
  // painted it -- callers doing a synchronous (blocking) zone rebuild
  // right after this should await it, or the overlay would never appear
  // before the main thread gets busy. Some call sites fire-and-forget this
  // instead (enterBuilding/enterZone don't all await it) and call hide()
  // immediately afterward, well before the fonts/config fetch below can
  // possibly settle -- the generation check makes that a no-op instead of
  // painting a black overlay that hide() already fired for and nothing
  // will ever clear again.
  async function show() {
    const myGeneration = ++state.generation;
    await Promise.all([ensureFontsLoaded(), ensureConfigLoaded()]);
    if (state.generation !== myGeneration || state.hiddenGeneration === myGeneration) return; // hide() (or a newer show()) already ran
    const config = await state.configPromise;
    const els = buildDom();
    const settings = config.settings || {};
    const entry = pickEntry(config.entries || []);

    const hasImage = !!entry?.image;
    els.image.style.display = hasImage ? '' : 'none';
    if (hasImage && els.image.src !== entry.image) els.image.src = entry.image;
    els.lore.textContent = entry?.lore || '';
    els.lore.style.fontSize = `${settings.loreSize ?? 11}px`;
    els.percent.textContent = `${Math.round(Number(settings.loadPercent) || 0)}%`;
    renderScript(els, settings, entry?.script);
    els.scriptViewport.style.left = (settings.scriptSide === 'right') ? '75%' : '25%';
    els.scriptViewport.style.top = `${settings.scriptY ?? 46}%`;

    els.root.classList.add('visible');
    state.visible = true;
    state.lastFrameTime = performance.now();
    if (state.motionRaf) cancelAnimationFrame(state.motionRaf);
    state.motionRaf = requestAnimationFrame(t => motionTick(t, settings));

    // Two rAFs: the first is scheduled before the browser's next paint: the
    // second only fires after that paint has actually happened.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    // Only self-correct if hide() actually ran against this exact show() while we
    // waited on the paint -- a newer show() taking over in the meantime (without an
    // intervening hide()) now owns the overlay and must be left alone, not clobbered.
    if (state.hiddenGeneration === myGeneration) hide();
  }

  function hide() {
    state.hiddenGeneration = state.generation;
    state.visible = false;
    if (state.motionRaf) { cancelAnimationFrame(state.motionRaf); state.motionRaf = null; }
    state.els?.root.classList.remove('visible');
  }

  window.LoadingScreenRuntime = Object.freeze({ installed: true, show, hide });
})();
