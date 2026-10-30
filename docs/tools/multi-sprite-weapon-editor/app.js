// Multi-sprite weapon authoring in the existing Tool Hub iframe.
// Drafts never overwrite shipped definitions; exported JS replaces the committed config.
(() => {
  'use strict';
  const $ = id => document.getElementById(id); // Resolves stable Tool Hub widget IDs.
  const clone = data => JSON.parse(JSON.stringify(data)); // Separates editable drafts from the gameplay registry.
  const DEFAULTS = {
    haftAnchor: { opaque: 'top' },
    chain: { sprite: 'assets/toolsprites/hachutu_torch-flail_chain.png', top: { opaque: 'top' }, bottom: { opaque: 'bottom' }, material: 'metal' },
    head: { anchorLayer: 'handle', anchor: { opaque: 'bottom' }, layers: [] },
    motion: { lag: 0.065, idleFollow: 7, attackFollow: 15 },
  }; // Starting values match the shared runtime's unconfigured behavior.
  const DRAFT_KEY = 'hobunji.multiSpriteWeapons.draft.v1'; // Local-only editing recovery; never read by gameplay.
  const assetImages = new Map(); // Source PNG image promises reused by preview renders.
  const painted = new Map(); // Stable preview material masks by sprite, hue and oxidation setting.
  const logs = []; // Visible diagnostics available without a browser console.
  const safeNum = (v, fallback = 0, min = -1e6, max = 1e6) => {
    const n = Number(v); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
  };
  let state = clone(window.WEAPON_SPRITE_ASSEMBLY_CONFIG || { schema: 'hobunji_weapon_sprite_assemblies.v1', weapons: {} }); // Active working copy.
  let key = Object.keys(state.weapons)[0] || 'hachutuTorchFlail'; // Selected weapon and only it is mutated by editor fields.
  let tab = 'flails'; // Which of the two requested modes is visible.
  let stackTarget = 'head'; // Flail-head vs ordinary-weapon stack on the Multi-layer Parts tab.
  let selected = 0; // Selected layer index into the visible ordered stack.
  let playing = true; // Whether the isolated 2D authoring preview advances automatically.
  let progress = 0; // 0..1 representation of the preview swing cycle.
  let lastTime = performance.now(); // Delta time for the tool's isolated canvas requestAnimationFrame.
  let latestError = ''; // Last failure exposed in status and copyable diagnostics.

  function log(message, failure = false) {
    const text = new Date().toLocaleTimeString() + ' ' + message;
    logs.push(text); if (logs.length > 90) logs.shift();
    $('log').textContent = logs.join('\n');
    if (failure) latestError = message;
    $('status').textContent = message;
  }

  function assetUrl(path) {
    const raw = String(path || '').trim();
    if (!raw) return '';
    if (/^https:\/\//i.test(raw) || /^data:image\//i.test(raw)) return raw;
    if (!/^assets\/[a-z0-9_./'-]+\.(png|webp)$/i.test(raw)) return '';
    return new URL('../../' + raw, location.href).href;
  }

  function loadImage(path) {
    const url = assetUrl(path);
    if (!url) return Promise.resolve(null);
    if (!assetImages.has(url)) {
      const request = new Promise(resolve => {
        const img = new Image(); // CORS precedes src so alpha reads work through GitHack's CDN.
        img.crossOrigin = 'anonymous';
        img.onload = () => { log('Loaded ' + path); resolve(img); };
        img.onerror = () => { log('Sprite unavailable: ' + path, true); resolve(null); };
        img.src = url;
      });
      assetImages.set(url, request);
    }
    return assetImages.get(url);
  }

  function image(path) {
    const url = assetUrl(path);
    return url && imageValues.get(url) || null; // Async image values are retained separately from promises.
  }
  const imageValues = new Map(); // Resolved only PNG images, used synchronously by the canvas loop.
  function warm(path) {
    const url = assetUrl(path);
    if (!url || imageValues.has(url)) return;
    loadImage(path).then(img => { if (img) imageValues.set(url, img); });
  }

  function entry() {
    return state.weapons[key] || (state.weapons[key] = { label: key, sprite: '', layers: [] });
  }

  function ensureFlail() {
    const def = entry();
    if (!def.flail) def.flail = clone(DEFAULTS);
    if (!def.flail.chain) def.flail.chain = clone(DEFAULTS.chain);
    if (!def.flail.head) def.flail.head = clone(DEFAULTS.head);
    if (!Array.isArray(def.flail.head.layers)) def.flail.head.layers = [];
    if (!def.flail.motion) def.flail.motion = clone(DEFAULTS.motion);
    return def.flail;
  }

  function layers() {
    const def = entry();
    if (stackTarget === 'weapon') return def.layers || (def.layers = []);
    return def.flail?.head?.layers || []; // Ordinary multi-layer weapons do not silently acquire a chain.
  }

  function activeLayer() { return layers()[selected] || null; }

  function setOptions(select, values, selectedValue) {
    select.replaceChildren();
    for (const [value, name] of values) {
      const option = document.createElement('option');
      option.value = value; option.textContent = name;
      select.appendChild(option);
    }
    if (values.some(row => row[0] === selectedValue)) select.value = selectedValue;
  }

  function fillWeapons() {
    setOptions($('weapon'), Object.entries(state.weapons).map(([id, def]) => [id, def.label || id]), key);
  }

  function coordinateField(name, spec, fallback) {
    const mode = Number.isFinite(spec?.x) && Number.isFinite(spec?.y) ? 'pixel' : (spec?.opaque || fallback);
    $(name + 'Mode').value = mode;
    $(name + 'X').value = mode === 'pixel' ? spec.x : '';
    $(name + 'Y').value = mode === 'pixel' ? spec.y : '';
    $(name + 'X').disabled = mode !== 'pixel';
    $(name + 'Y').disabled = mode !== 'pixel';
  }

  function setFlailFields() {
    const def = entry(), f = def.flail ? ensureFlail() : null; // Normalize only an existing flail, never invent one for ordinary layered weapons.
    $('weaponLabel').value = def.label || key;
    $('baseSpriteGeneral').value = def.sprite || (key === 'hachutuTorchFlail' ? 'assets/toolsprites/hachutu_torch-flail_handle.png' : ''); // Ordinary layered weapons can author their original rigid sprite without enabling flails.
    $('enableFlail').textContent = f ? 'Remove flail assembly' : '+ Enable flail assembly';
    $('flailFields').hidden = !f;
    $('stackTarget').querySelector('option[value="head"]').disabled = !f;
    if (!f) { stackTarget = 'weapon'; $('stackTarget').value = 'weapon'; return; }
    $('baseSprite').value = def.sprite || (key === 'hachutuTorchFlail' ? 'assets/toolsprites/hachutu_torch-flail_handle.png' : '');
    $('chainSprite').value = f.chain.sprite || '';
    coordinateField('haft', f.haftAnchor, 'top');
    coordinateField('chainTop', f.chain.top, 'top');
    coordinateField('chainBottom', f.chain.bottom, 'bottom');
    coordinateField('head', f.head.anchor, 'bottom');
    setOptions($('headAnchorLayer'), f.head.layers.map(layer => [layer.id, layer.id]), f.head.anchorLayer);
    $('lag').value = f.motion?.lag ?? DEFAULTS.motion.lag;
    $('idleFollow').value = f.motion?.idleFollow ?? DEFAULTS.motion.idleFollow;
    $('attackFollow').value = f.motion?.attackFollow ?? DEFAULTS.motion.attackFollow;
  }

  function selectTab(value) {
    tab = value;
    $('flailsTab').hidden = tab !== 'flails'; $('layersTab').hidden = tab !== 'layers';
    document.querySelectorAll('[data-tab]').forEach(btn => btn.setAttribute('aria-selected', btn.dataset.tab === tab ? 'true' : 'false'));
  }

  function selectWeapon(next) {
    if (!state.weapons[next]) return;
    key = next; selected = 0; window.HobunjiMultiSpritePreviewRenderer?.resetEffects();
    stackTarget = entry().flail ? 'head' : 'weapon';
    $('stackTarget').value = stackTarget;
    fillWeapons(); setFlailFields(); fillLayers(); warmImages();
    log('Selected ' + (entry().label || key));
  }

  function fillLayers() {
    const all = layers();
    const list = $('layerList');
    list.replaceChildren();
    all.forEach((layer, index) => {
      const row = document.createElement('div');
      row.className = 'layer';
      const select = document.createElement('button');
      select.textContent = (index + 1) + '. ' + (layer.id || 'unnamed') + ' [' + (layer.material || 'none') + ']';
      select.className = index === selected ? 'selected' : '';
      select.onclick = () => { selected = index; fillLayers(); };
      row.appendChild(select);
      for (const [icon, delta] of [['↑', -1], ['↓', 1]]) {
        const button = document.createElement('button');
        button.textContent = icon; button.title = delta < 0 ? 'Move layer backward' : 'Move layer forward';
        button.disabled = index + delta < 0 || index + delta >= all.length;
        button.onclick = () => {
          const other = index + delta; [all[index], all[other]] = [all[other], all[index]];
          selected = other; window.HobunjiMultiSpritePreviewRenderer?.resetEffects(); fillLayers(); markChanged();
        };
        row.appendChild(button);
      }
      const remove = document.createElement('button');
      remove.textContent = '×'; remove.title = 'Remove layer';
      remove.onclick = () => {
        all.splice(index, 1); selected = Math.max(0, Math.min(index, all.length - 1));
        if (entry().flail && !all.some(x => x.id === entry().flail.head.anchorLayer)) {
          entry().flail.head.anchorLayer = all[0]?.id || '';
        }
        fillLayers(); markChanged();
      };
      row.appendChild(remove); list.appendChild(row);
    });
    $('layerFields').hidden = !all.length;
    const part = activeLayer();
    if (!part) return;
    $('layerId').value = part.id || '';
    $('layerSprite').value = part.sprite || '';
    $('layerOffsetX').value = part.offsetPx?.x ?? 0;
    $('layerOffsetY').value = part.offsetPx?.y ?? 0;
    $('material').value = ['metal','marker','none'].includes(part.material) ? part.material : 'none';
    $('vfxType').value = part.vfx?.type === 'fire' ? 'fire' : 'none';
    $('markerHex').value = part.sourceHex || '#7F00FF';
    $('ragHex').value = part.targetHex || '#E7DDC9';
    $('fireRate').value = part.vfx?.rate ?? 22;
    $('fireLife').value = part.vfx?.life ?? .65;
    $('fireSize').value = part.vfx?.size ?? .035;
    $('fireColors').value = (part.vfx?.colors || ['#FFE6A5','#FFAA3E','#FF5F20']).join(', ');
    $('fireSettings').hidden = $('vfxType').value !== 'fire';
    warmImages();
  }

  function markChanged() {
    warmImages();
    $('status').textContent = 'Unsaved changes · Export JS config to commit the recipe.';
  }

  function on(id, event, callback) { $(id).addEventListener(event, callback); }

  function writeCoordinate(name, target) {
    const mode = $(name + 'Mode').value;
    const x = $(name + 'X'), y = $(name + 'Y');
    x.disabled = y.disabled = mode !== 'pixel';
    if (mode === 'pixel') {
      target.x = safeNum(x.value, 0); target.y = safeNum(y.value, 0);
      delete target.opaque;
    } else {
      target.opaque = mode; delete target.x; delete target.y;
    }
    markChanged();
  }

  function bindInput(id, fn) { on(id, 'change', () => { fn($(id).value); markChanged(); }); }

  function installEvents() {
    document.querySelectorAll('[data-tab]').forEach(button => button.onclick = () => selectTab(button.dataset.tab));
    on('weapon', 'change', () => selectWeapon($('weapon').value));
    on('enableFlail','click', () => {
      if (entry().flail) {
        if (!confirm('Remove this weapon\'s chain and flail-head layers? Ordinary sprite layers are preserved.')) return;
        delete entry().flail;
      } else ensureFlail();
      stackTarget = entry().flail ? 'head' : 'weapon';
      $('stackTarget').value = stackTarget;
      selected = 0; setFlailFields(); fillLayers(); markChanged();
    });
    on('newWeapon', 'click', () => {
      const id = prompt('Existing TOOL_ITEM_DEFS key or held shape ID (letters and digits):', 'warhammer');
      if (!id || !/^[a-z][a-zA-Z0-9_-]{1,63}$/.test(id)) { log('Please enter a valid existing weapon key.', true); return; }
      if (!state.weapons[id]) state.weapons[id] = { label: id, sprite: '', layers: [] };
      selectWeapon(id);
    });
    bindInput('weaponLabel', value => { entry().label = value; fillWeapons(); });
    bindInput('baseSprite', value => { entry().sprite = value; $('baseSpriteGeneral').value = value; });
    bindInput('baseSpriteGeneral', value => { entry().sprite = value; $('baseSprite').value = value; });
    bindInput('chainSprite', value => { ensureFlail().chain.sprite = value; });
    const coordinates = [
      ['haft', () => ensureFlail().haftAnchor || (ensureFlail().haftAnchor = {})],
      ['chainTop', () => ensureFlail().chain.top || (ensureFlail().chain.top = {})],
      ['chainBottom', () => ensureFlail().chain.bottom || (ensureFlail().chain.bottom = {})],
      ['head', () => ensureFlail().head.anchor || (ensureFlail().head.anchor = {})],
    ];
    for (const [name, getTarget] of coordinates) {
      for (const suffix of ['Mode','X','Y']) on(name + suffix, 'change', () => writeCoordinate(name, getTarget()));
    }
    bindInput('headAnchorLayer', value => { ensureFlail().head.anchorLayer = value; });
    bindInput('lag', value => { ensureFlail().motion.lag = safeNum(value, 0.065, 0, 1); });
    bindInput('idleFollow', value => { ensureFlail().motion.idleFollow = safeNum(value, 7, 0.1, 60); });
    bindInput('attackFollow', value => { ensureFlail().motion.attackFollow = safeNum(value, 15, 0.1, 60); });
    on('stackTarget','change', () => { stackTarget = $('stackTarget').value; selected = 0; fillLayers(); });
    on('addLayer','click', () => {
      const all = layers(); const id = 'layer' + (all.length + 1);
      all.push({ id, sprite: '', material: 'none' }); selected = all.length - 1; fillLayers(); markChanged();
    });
    bindInput('layerId', value => {
      const part = activeLayer(); if (!part || !/^[a-zA-Z0-9_-]+$/.test(value)) { log('Layer ID must be alphanumeric.', true); return; }
      if (layers().some(other => other !== part && other.id === value)) { log('Layer IDs must be unique.', true); return; }
      if (entry().flail?.head.anchorLayer === part.id) entry().flail.head.anchorLayer = value;
      part.id = value; fillLayers();
    });
    bindInput('layerSprite', value => { activeLayer().sprite = value; });
    for (const axis of ['X','Y']) bindInput('layerOffset' + axis, value => {
      const part = activeLayer();
      if (!part.offsetPx) part.offsetPx = { x: 0, y: 0 };
      part.offsetPx[axis.toLowerCase()] = safeNum(value, 0);
    });
    bindInput('material', value => { activeLayer().material = value; });
    bindInput('markerHex', value => {
      const part = activeLayer(); part.sourceHex = validHex(value, '#7F00FF');
      if (part.vfx?.type === 'fire') part.vfx.sourceHex = part.sourceHex; // Dye and ember sampling always use the same authored source region.
    });
    bindInput('ragHex', value => { activeLayer().targetHex = validHex(value, '#E7DDC9'); });
    bindInput('vfxType', value => {
      const part = activeLayer();
      if (value === 'none') delete part.vfx;
      else part.vfx = { type: 'fire', sourceHex: part.sourceHex || '#7F00FF',
        rate: 22, size: .035, life: .65, speed: .12, colors: ['#FFE6A5','#FFAA3E','#FF5F20'] };
      fillLayers();
    });
    const editVfx = (name, fall, min, max) => bindInput(name, value => {
      if (activeLayer()?.vfx) activeLayer().vfx[{fireRate:'rate',fireLife:'life',fireSize:'size'}[name]] = safeNum(value, fall, min, max);
    });
    editVfx('fireRate', 22, 0, 40); editVfx('fireLife', .65, .1, 5); editVfx('fireSize', .035, .001, .5);
    bindInput('fireColors', value => {
      if (activeLayer()?.vfx) activeLayer().vfx.colors = value.split(',').map(s => s.trim()).filter(s => /^#[0-9a-f]{6}$/i.test(s));
    });
    for (const id of ['metalHex','verdigrisHex','oxidation']) on(id, 'input', () => { painted.clear(); warmImages(); });
    on('soloLayer','change', () => { window.HobunjiMultiSpritePreviewRenderer?.resetEffects(); }); // Close-up solo mode never affects the full weapon.
    on('play','click', () => { playing = !playing; $('play').textContent = playing ? '⏸ Pause' : '▶ Play'; });
    on('scrub','input', () => { progress = safeNum($('scrub').value, 0, 0, 1); playing = false; $('play').textContent = '▶ Play'; });
    on('save','click', () => {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify(state)); log('Local draft saved on this device. Export it to commit.'); }
      catch (e) { log('Local draft save failed: ' + e.message, true); }
    });
    on('reset','click', () => {
      if (!confirm('Discard local changes and restore committed weapon recipes?')) return;
      localStorage.removeItem(DRAFT_KEY); state = clone(window.WEAPON_SPRITE_ASSEMBLY_CONFIG); selectWeapon(Object.keys(state.weapons)[0]);
    });
    on('exportJson','click', () => download('weapon-sprite-assemblies.json', JSON.stringify(state, null, 2), 'application/json'));
    on('exportJs','click', () => download('weapon-sprite-assemblies.js', configJs(), 'text/javascript'));
    on('importBtn','click', () => $('importFile').click());
    on('importFile','change', async () => {
      const file = $('importFile').files?.[0]; if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (data?.schema !== 'hobunji_weapon_sprite_assemblies.v1' || !data.weapons || typeof data.weapons !== 'object' || Array.isArray(data.weapons)) throw Error('Unrecognized multi-sprite weapon JSON schema.');
        for (const weapon of Object.values(data.weapons)) {
          if (weapon.flail && (!weapon.flail.chain?.sprite || !Array.isArray(weapon.flail.head?.layers))) throw Error('Incomplete flail recipe.');
          const all = [...(weapon.layers || []), ...(weapon.flail?.head?.layers || [])];
          if (all.length > 32 || all.some(part => !part.id || !part.sprite)) throw Error('Each sprite layer needs an ID and PNG path (limit 32).');
        }
        state = clone(data); selectWeapon(Object.keys(state.weapons)[0]); log('Imported ' + file.name + ' (not yet saved to the repository).');
      } catch (error) { log('Import rejected: ' + error.message, true); }
      $('importFile').value = '';
    });
    on('copyJson','click', () => copy(JSON.stringify(state, null, 2)));
    on('copyDebug','click', () => copy(logs.join('\n') + '\n\n' + JSON.stringify({
      key, tab, stackTarget, selected, latestError,
      preview: window.HobunjiMultiSpritePreviewRenderer?.debugSnapshot(),
    }, null, 2))); // Reports measured bounds, loaded layers, and fit scale for remote mobile bug reports.
  }

  function validHex(value, fallback) { return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? value : fallback; }
  function configJs() {
    return '// Committed multi-sprite weapon registry. Generated by the Tool Hub.\nwindow.WEAPON_SPRITE_ASSEMBLY_CONFIG = Object.freeze(' + JSON.stringify(state, null, 2) + ');\n';
  }
  function download(name, text, type) {
    const blob = new Blob([text], {type}); const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = name; link.click();
    URL.revokeObjectURL(url);
    log('Exported ' + name + ' — commit this file to deploy your edits.');
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); log('Copied to clipboard.'); }
    catch (e) { log('Clipboard unavailable: use Export JSON instead.', true); }
  }

  function warmImages() {
    const def = entry(), f = def.flail;
    const sources = [def.sprite || (key === 'hachutuTorchFlail' ? 'assets/toolsprites/hachutu_torch-flail_handle.png' : '')];
    if (f) sources.push(f.chain?.sprite, ...(f.head?.layers || []).map(l => l.sprite));
    sources.push(...(def.layers || []).map(l => l.sprite));
    sources.filter(Boolean).forEach(warm);
  }

  function paintedImage(part) {
    const source = image(part?.sprite); // The preview always falls back to the authored PNG while asynchronous metal coloring finishes.
    if (!source) return null;
    if (part.material === 'marker') {
      return window.HobunjiLayeredWeaponEffects?.recolorMarker?.(
        source, part.sourceHex || '#7F00FF', part.targetHex || '#E7DDC9',
      ) || source; // The fuel's off-white cloth colors preserve the original marker-pixel fire sources.
    }
    if (part.material !== 'metal') return source; // Plain overlays are never run through verdigris.
    const targetHex = validHex($('metalHex').value, '#CD7F32');
    const verdigrisHex = validHex($('verdigrisHex').value, '#57B38B');
    const oxidationAmount = safeNum($('oxidation').value, 0.5, 0, 1);
    const cacheKey = JSON.stringify([part.sprite, targetHex, verdigrisHex, oxidationAmount]); // Shared by head and combined previews; changes in any palette control produce a new canvas.
    const cached = painted.get(cacheKey);
    if (cached) return cached.image || source;
    const recolor = window.ToolMetalRecolor?.getRecoloredCanvas;
    if (typeof recolor !== 'function') return source; // A missing optional recolorer must not blank the weapon preview.
    const result = { image: null, pending: true, error: false }; // One asynchronous request per PNG/preview palette; the two panels never duplicate it.
    painted.set(cacheKey, result);
    try {
      Promise.resolve(recolor(assetUrl(part.sprite), {
        targetHex, verdigrisHex, oxidationAmount,
      })).then(canvas => {
        result.pending = false;
        result.image = canvas || null;
      }).catch(error => {
        result.pending = false;
        result.error = true; // Keep source PNG as the fallback and do not retry/log every frame.
        log('Metal recolor failed for ' + part.sprite + ': ' + (error?.message || error), true);
      });
    } catch (error) {
      result.pending = false;
      result.error = true; // Caches a synchronous failure as well so it cannot spam the mobile log.
      log('Metal recolor failed for ' + part.sprite + ': ' + (error?.message || error), true);
    }
    return source;
  }

  function frame(now) {
    const dt = Math.max(0, Math.min(.05, (now - lastTime) / 1000)); // The same animation time powers the close-up and combined preview.
    lastTime = now;
    if (playing) { progress = (progress + dt * .65) % 1; $('scrub').value = progress; }
    const renderer = window.HobunjiMultiSpritePreviewRenderer; // Separate pure layout logic auto-fits each visible PNG stack.
    if (!renderer) {
      if (latestError !== 'Preview renderer did not load') log('Preview renderer did not load', true);
      return;
    }
    try {
      const model = renderer.modelFor(entry(), image, progress, now);
      const options = {
        dt, playing, selected, stackTarget,
        weaponKey: key, solo: $('soloLayer').checked,
        effects: window.HobunjiLayeredWeaponEffects,
      }; // Both panels share the same source assets, metal palette, and attack progress.
      renderer.drawCanvas($('headPreview'), 'head', model, image, paintedImage, options);
      renderer.drawCanvas($('preview'), 'combined', model, image, paintedImage, options);
    } catch (error) {
      const message = 'Preview: ' + (error?.message || String(error));
      if (latestError !== message) log(message, true); // Compare the exact logged value; repeated RAF errors must not flood mobile diagnostics.
    }
    requestAnimationFrame(frame); // One RAF for both canvases; none is added to the gameplay runtime.
  }

  async function suggestRepoSprites() {
    const paths = new Set(); // Suggested PNGs from committed recipes, even when offline.
    for (const def of Object.values(state.weapons)) {
      for (const path of [def.sprite, def.flail?.chain?.sprite,
        ...(def.layers || []).map(layer => layer.sprite),
        ...(def.flail?.head?.layers || []).map(layer => layer.sprite)]) {
        if (path) paths.add(path);
      }
    }
    try {
      const result = await fetch('https://api.github.com/repos/Oolnokk/HobunjiHollowUnity/contents/docs/assets/toolsprites');
      if (result.ok) {
        const files = await result.json();
        for (const file of files) {
          if (file.type === 'file' && /\.(png|webp)$/i.test(file.name)) paths.add('assets/toolsprites/' + file.name);
        }
      }
    } catch (_) { /* Committed config still provides valid source paths offline. */ }
    const list = $('repoSprites'); // Shared datalist helps mobile authors choose assets without typing full paths.
    list.replaceChildren();
    for (const path of paths) {
      const option = document.createElement('option');
      option.value = path; list.appendChild(option);
    }
  }

  function start() {
    try {
      const stored=JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
      if(stored?.schema===state.schema && stored.weapons && typeof stored.weapons==='object') {
        state=stored;log('Restored local draft. Shipped game config remains untouched.');
      }
    }catch(e){log('Draft restore failed: '+e.message,true);}
    key=Object.keys(state.weapons)[0]||key;
    selectWeapon(key);installEvents();selectTab('flails');requestAnimationFrame(frame);
    window.addEventListener('error', event => log('Browser error: ' + event.message, true)); // Visible on phones without devtools.
    window.addEventListener('unhandledrejection', event => log('Async error: ' + (event.reason?.message || event.reason), true));
    suggestRepoSprites(); // Optional repo PNG suggestions; no credentials required.
    log('Multi-sprite editor ready. Layer order and interleaved fire share the game schema.');
  }
  start();
})();
