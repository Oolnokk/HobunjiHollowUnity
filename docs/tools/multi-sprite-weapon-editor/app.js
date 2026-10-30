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
  const alphaCache = new WeakMap(); // Opaque-PNG row scans reused during every animation frame.
  const logs = []; // Visible diagnostics available without a browser console.
  const fireParticles = []; // Tool-only flame particles, bounded and inserted after their layer.
  const imageSize = img => ({ w: img?.naturalWidth || img?.width || 1, h: img?.naturalHeight || img?.height || 1 });
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
    key = next; selected = 0; fireParticles.length = 0;
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
          selected = other; fireParticles.length = 0; fillLayers(); markChanged();
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
    bindInput('baseSprite', value => { entry().sprite = value; });
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
    on('copyDebug','click', () => copy(logs.join('\n') + '\n\n' + JSON.stringify({key,tab,stackTarget,selected,latestError}, null, 2)));
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

  function opaquePoint(img, edge) {
    if (!img) return null;
    let cached = alphaCache.get(img);
    if (!cached) { cached = {}; alphaCache.set(img, cached); }
    if (cached[edge]) return cached[edge];
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', {willReadFrequently:true});
    try {
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, w, h).data;
      for (let row = 0; row < h; row++) {
        const y = edge === 'top' ? row : h - row - 1;
        let sum = 0, count = 0;
        for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3] >= 128) { sum += x; count++; }
        if (count) return (cached[edge] = { x: sum / count, y });
      }
    } catch(e) { log('Cannot read alpha: ' + e.message, true); }
    return (cached[edge] = {x:w/2,y:edge==='top'?0:h-1});
  }
  function anchor(img, spec, fallback) {
    const size = imageSize(img); if (!img) return {x:size.w/2,y:size.h/2};
    if (Number.isFinite(spec?.x) && Number.isFinite(spec?.y)) return { x:Math.max(0,Math.min(size.w-1,spec.x)), y:Math.max(0,Math.min(size.h-1,spec.y)) };
    return opaquePoint(img, spec?.opaque || fallback);
  }

  function paintedImage(part) {
    const img = image(part.sprite); if (!img) return null;
    const target = validHex($('metalHex').value, '#CD7F32'), verdigris = validHex($('verdigrisHex').value, '#57B38B');
    const oxidation = safeNum($('oxidation').value,.5,0,1);
    if (part.material === 'marker') {
      return window.HobunjiLayeredWeaponEffects?.recolorMarker(img, part.sourceHex || '#7F00FF', part.targetHex || '#E7DDC9') || img;
    }
    if (part.material !== 'metal') return img;
    const cacheKey = part.sprite + '|' + target + '|' + verdigris + '|' + oxidation;
    let hit = painted.get(cacheKey);
    if (hit?.image) return hit.image;
    if (hit?.pending) return img;
    hit = {pending:true,image:null}; painted.set(cacheKey, hit);
    window.ToolMetalRecolor.getRecoloredCanvas(assetUrl(part.sprite), {targetHex:target,verdigrisHex:verdigris,oxidationAmount:oxidation}).then(canvas => {
      hit.image = canvas; hit.pending = false;
    }).catch(error => { hit.pending = false; log('Metal recolor: '+error.message,true); });
    return img;
  }

  function drawSprite(ctx,img,cx,cy,ppu,rotation=0,offset=null) {
    if (!img) return;
    const w = img.width, h = img.height;
    ctx.save(); ctx.translate(cx,cy); ctx.rotate(rotation);
    ctx.drawImage(img, -w*ppu/2 + (Number(offset?.x)||0)*ppu, -h*ppu/2 + (Number(offset?.y)||0)*ppu,w*ppu,h*ppu);
    ctx.restore();
  }

  function drawWeapon(ctx, dt, canvas) {
    const def = entry(), basePath = def.sprite || (key==='hachutuTorchFlail'?'assets/toolsprites/hachutu_torch-flail_handle.png':'');
    const shaft = image(basePath); const f = def.flail;
    if (!shaft) { $('status').textContent = latestError || 'Loading base sprite: ' + (basePath || '(set a PNG path)'); return; }
    const {w,h} = imageSize(shaft), ppu = Math.min(canvas.width*.23/w,canvas.height*.54/h);
    const centerX = canvas.width*.46, centerY=canvas.height*.48;
    const isSwing = progress > .001 && progress < .98;
    const shaftRotation = isSwing ? Math.sin(progress*Math.PI*2)*.32 : 0;
    const rawShaft = {sprite:basePath,material:'metal'};
    drawSprite(ctx,paintedImage(rawShaft),centerX,centerY,ppu,shaftRotation);
    // Ordinary weapons may independently layer images over their rigid base.
    for(const layer of def.layers || []) drawSprite(ctx,paintedImage(layer),centerX,centerY,ppu,shaftRotation,layer.offsetPx);
    if (!f) return;
    const chImg = image(f.chain?.sprite); if (!chImg) return;
    const hp = anchor(shaft,f.haftAnchor,'top');
    const axisX = (hp.x+0.5-w/2)*ppu, axisY=(hp.y+.5-h/2)*ppu;
    const cr=Math.cos(shaftRotation), sr=Math.sin(shaftRotation);
    const pivotX=centerX+axisX*cr-axisY*sr,pivotY=centerY+axisX*sr+axisY*cr;
    const ct=anchor(chImg,f.chain?.top,'top'),cb=anchor(chImg,f.chain?.bottom,'bottom');
    const sourceAngle=Math.atan2(cb.y-ct.y,cb.x-ct.x);
    const tilt = isSwing ? Math.sin(progress*Math.PI*2)*(0.8+safeNum(f.motion?.lag,.065,0,1)) : Math.sin(performance.now()*.0013)*.04;
    const chainAngle=Math.PI*.5+tilt;
    const chainRotation=chainAngle-sourceAngle;
    ctx.save(); ctx.translate(pivotX,pivotY); ctx.rotate(chainRotation);
    // Chain top is fixed at the scanned or explicit first opaque pixel.
    ctx.drawImage(paintedImage({...f.chain,sprite:f.chain.sprite}),-(ct.x+.5)*ppu,-(ct.y+.5)*ppu,chImg.width*ppu,chImg.height*ppu);
    ctx.restore();
    const length=Math.hypot(cb.x-ct.x,cb.y-ct.y)*ppu;
    const headX=pivotX+Math.cos(chainAngle)*length,headY=pivotY+Math.sin(chainAngle)*length;
    const parts=f.head?.layers || [];
    const contactIndex=parts.findIndex(x=>x.id===f.head.anchorLayer);
    const anchorPart=parts[Math.max(0,contactIndex)];
    const anchorImg=image(anchorPart?.sprite); if(!anchorImg)return;
    const headAnchor=anchor(anchorImg,f.head.anchor,'bottom'),hs=imageSize(anchorImg);
    const hOff=anchorPart?.offsetPx || {};
    const dx=(headAnchor.x+.5-hs.w/2+(Number(hOff.x)||0))*ppu;
    const dy=(headAnchor.y+.5-hs.h/2+(Number(hOff.y)||0))*ppu;
    const headRotation=isSwing?tilt:0;
    ctx.save(); ctx.translate(headX,headY);ctx.rotate(headRotation);ctx.translate(-dx,-dy);
    parts.forEach((part,index)=>{
      const img=paintedImage(part);
      drawSprite(ctx,img,0,0,ppu,0,part.offsetPx);
      if(part.vfx?.type==='fire') drawFire(ctx,part,image(part.sprite),ppu,dt,index);
    });
    ctx.restore();
    // Visual inspection overlay: marker at world chain joints.
    ctx.fillStyle='#83bcff';ctx.beginPath();ctx.arc(pivotX,pivotY,3,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#ffc769';ctx.beginPath();ctx.arc(headX,headY,3,0,Math.PI*2);ctx.fill();
  }

  function drawFire(ctx,part,img,ppu,dt,index) {
    if (!img) return;
    const config=part.vfx;const sources=window.HobunjiLayeredWeaponEffects?.sourcePixels(img,config.sourceHex||part.sourceHex||'#7F00FF','marker') || [];
    if (!sources.length) return;
    // Reset particles when switching layer/reordering, leaving the original PNG fully visible.
    const fireKey=key+':'+part.id+':'+index;
    for(let i=fireParticles.length-1;i>=0;i--){
      const p=fireParticles[i];if(p.key!==fireKey) continue; // Other interleaved emitters retain their own independent particle lifetimes.
      p.age+=dt;if(p.age>=p.life){fireParticles.splice(i,1);continue;}
      const t=p.age/p.life;ctx.globalAlpha=.85*Math.sin(Math.PI*t);
      ctx.fillStyle=p.color;ctx.beginPath();
      ctx.arc(p.x*ppu+Math.sin(t*9+p.phase)*ppu*3,(p.y-p.speed*p.age)*ppu,p.radius*ppu*(.6+t),0,Math.PI*2);ctx.fill();
    }
    ctx.globalAlpha=1;
    if(!playing)return;
    const max=32, rate=safeNum(config.rate,22,0,40);
    if(fireParticles.filter(p=>p.key===fireKey).length>=max || Math.random()>rate*dt) return;
    const p=sources[Math.floor(Math.random()*sources.length)];const imgSize=imageSize(img);
    fireParticles.push({
      key:fireKey,age:0,life:safeNum(config.life,.65,.1,5),phase:Math.random()*6.28,
      x:p%imgSize.w+.5-imgSize.w/2+(Number(part.offsetPx?.x)||0), // Marker source pixel in layer-center coordinates, scaled only when drawn.
      y:Math.floor(p/imgSize.w)+.5-imgSize.h/2+(Number(part.offsetPx?.y)||0),
      radius:safeNum(config.size,.035,.001,.5)*imgSize.w*.55,
      speed:imgSize.h*.12,
      color:(config.colors || ['#FFAA3E'])[Math.floor(Math.random()*(config.colors?.length||1))] || '#FFAA3E',
    });
  }

  function frame(now) {
    const dt=Math.max(0,Math.min(.05,(now-lastTime)/1000));lastTime=now;
    if(playing) { progress=(progress+dt*.65)%1;$('scrub').value=progress; }
    const canvas=$('preview'),ctx=canvas.getContext('2d');
    const width=canvas.clientWidth||900,height=canvas.clientHeight||700;
    const dpr=Math.min(2,window.devicePixelRatio||1);
    if(canvas.width!==Math.round(width*dpr)||canvas.height!==Math.round(height*dpr)){
      canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
    }
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle='#0f1b29';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.strokeStyle='#25374a';ctx.lineWidth=1;
    for(let x=0;x<canvas.width;x+=45*dpr){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,canvas.height);ctx.stroke();}
    for(let y=0;y<canvas.height;y+=45*dpr){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(canvas.width,y);ctx.stroke();}
    try{drawWeapon(ctx,dt,canvas);}catch(e){if(latestError!==e.message)log('Preview: '+e.message,true);}
    requestAnimationFrame(frame); // Explicitly isolated authoring-preview RAF; never used by gameplay runtime.
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
