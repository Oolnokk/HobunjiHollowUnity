// Sprite recolor utility for authored item/object PNGs. Keyed liquid fills
// replace hue+saturation while retaining each pixel's painted HSV value and
// alpha; direct whole-sprite fills retain the animal shade-fill method.
// Three modes:
//   - "keyed": only pixels whose hue is near the placeholder green get
//     recolored, regardless of their saturation or value. Everything else
//     (glass, cork, outline...) is untouched.
//     Used by jar_liquid.png / bottle_potion.png / bottle_wine.png, whose
//     placeholder liquid fill uses exactly #9ED775 (highlight) and #698F4E
//     (shadow) plus antialiased blends between them.
//   - "dual-keyed:<rrggbb>": independently recolors the ordinary green key
//     above and the throwing-flask yellow key (#E6DD2C / #C09C09). The first
//     target comes from targetHex; the second target is encoded in the mode.
//   - "direct": every non-transparent pixel is recolored. Used by
//     pile_dew.png / cheese.png, whose entire sprite is the "thing" being
//     recolored — no separate container/outline region to preserve.
(() => {
  "use strict";

  const DEFAULT_KEY_A = [0x9E, 0xD7, 0x75];
  const DEFAULT_KEY_B = [0x69, 0x8F, 0x4E];
  const SECONDARY_KEY_A = [0xE6, 0xDD, 0x2C]; // Used by throwing_flask.png's highlighted Afflict-color region.
  const SECONDARY_KEY_B = [0xC0, 0x9C, 0x09]; // Used by throwing_flask.png's shaded Afflict-color region.
  const KEY_HUE_TOLERANCE = 35;
  const DUAL_KEY_MODE_PREFIX = 'dual-keyed:'; // Used to carry a second tint through existing spriteMode call sites.

  function colorFillApi() {
    const api = window.ColorFill;
    if (!api) throw new Error('ColorFill must load before sprite-recolor.js');
    return api;
  }

  function relativeLuminance(r, g, b) { return colorFillApi().relativeLuminance(r, g, b); }
  function rgbToHsv(r, g, b) { return colorFillApi().rgbToHsv(r, g, b); }
  function hsvToRgb(h, s, v) { return colorFillApi().hsvToRgb(h, s, v); }
  function hueDistance(a, b) { return colorFillApi().hueDistance(a, b); }

  function shadeFillConfig() {
    return colorFillApi().shadeFillConfig();
  }

  function directShadeFillPixels(data, targetRgb, predicateOrOptions = null) {
    return colorFillApi().shadeFillPixels(data, targetRgb, predicateOrOptions);
  }

  function secondaryTargetFromMode(mode, opts) {
    const explicitTarget = Number(opts?.secondaryTargetHex); // Used by direct/test callers that do not encode the second tint in spriteMode.
    if (Number.isFinite(explicitTarget)) return explicitTarget & 0xFFFFFF;
    const match = new RegExp(`^${DUAL_KEY_MODE_PREFIX}([0-9a-f]{6})$`, 'i').exec(String(mode || '')); // Used to decode item-definition spriteMode metadata.
    return match ? Number.parseInt(match[1], 16) : null;
  }

  function recolorDualKeyedPixels(data, primaryTargetHex, secondaryTargetHex, opts) {
    const primaryKeyColors = opts?.keyColors || [DEFAULT_KEY_A, DEFAULT_KEY_B]; // Used to recognize the ordinary bottle-liquid region.
    const secondaryKeyColors = opts?.secondaryKeyColors || [SECONDARY_KEY_A, SECONDARY_KEY_B]; // Used to recognize the throwing-flask Afflict region.
    const hueTolerance = Number.isFinite(Number(opts?.hueTolerance)) ? Number(opts.hueTolerance) : KEY_HUE_TOLERANCE; // Shared boundary tolerance for both authored key families.
    const primaryTarget = rgbToHsv((primaryTargetHex >> 16) & 255, (primaryTargetHex >> 8) & 255, primaryTargetHex & 255); // Used for the ordinary keyed region.
    const secondaryTarget = rgbToHsv((secondaryTargetHex >> 16) & 255, (secondaryTargetHex >> 8) & 255, secondaryTargetHex & 255); // Used for the Afflict keyed region.
    const primaryHues = primaryKeyColors.map(color => rgbToHsv(...color).h); // Used to classify antialiased green-key pixels by nearest authored hue.
    const secondaryHues = secondaryKeyColors.map(color => rgbToHsv(...color).h); // Used to classify antialiased yellow-key pixels by nearest authored hue.

    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      const source = rgbToHsv(data[i], data[i + 1], data[i + 2]); // Used to preserve the source pixel's painted value while selecting a key family.
      const primaryDistance = Math.min(...primaryHues.map(hue => hueDistance(source.h, hue))); // Used to prevent the nearby yellow key from bleeding into the green key.
      const secondaryDistance = Math.min(...secondaryHues.map(hue => hueDistance(source.h, hue))); // Used to prevent the nearby green key from bleeding into the yellow key.
      if (Math.min(primaryDistance, secondaryDistance) > hueTolerance) continue;
      const target = secondaryDistance < primaryDistance ? secondaryTarget : primaryTarget; // Used to give overlapping antialias hues to the nearest authored key family.
      const [r, g, b] = hsvToRgb(target.h, target.s, source.v); // Used to retain authored highlight/shadow value in the chosen target hue.
      data[i] = r; data[i + 1] = g; data[i + 2] = b;
    }
  }

  function recolorImageData(data, targetHex, mode, opts) {
    const tr = (targetHex >> 16) & 255, tg = (targetHex >> 8) & 255, tb = targetHex & 255;
    if (String(mode || '').startsWith('dual-keyed')) {
      const secondaryTargetHex = secondaryTargetFromMode(mode, opts); // Used to recolor throwing_flask.png's second authored liquid region.
      if (secondaryTargetHex == null) throw new Error('dual-keyed sprite recolor requires a secondary target color');
      recolorDualKeyedPixels(data, targetHex, secondaryTargetHex, opts);
      return;
    }
    if (mode === 'keyed') {
      const keyColor = opts?.keyColors?.[0] || DEFAULT_KEY_A;
      const keyHue = Number.isFinite(Number(opts?.keyHue)) ? Number(opts.keyHue) : rgbToHsv(...keyColor).h;
      const hueTolerance = Number.isFinite(Number(opts?.hueTolerance)) ? Number(opts.hueTolerance) : KEY_HUE_TOLERANCE;
      const target = rgbToHsv(tr, tg, tb);
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) continue;
        const source = rgbToHsv(data[i], data[i + 1], data[i + 2]);
        if (hueDistance(source.h, keyHue) > hueTolerance) continue;
        const [r, g, b] = hsvToRgb(target.h, target.s, source.v);
        data[i] = r; data[i + 1] = g; data[i + 2] = b;
      }
      return;
    }

    directShadeFillPixels(data, [tr, tg, tb], null);
  }

  const _imgCache = new Map();
  const _canvasCache = new Map();

  function loadImage(spritePath) {
    let img = _imgCache.get(spritePath);
    if (img) return img.__loadPromise || Promise.resolve(img);
    img = new Image();
    const p=new Promise((resolve,reject)=>{ img.onload=()=>resolve(img); img.onerror=()=>reject(new Error('Failed to load recolorable sprite '+spritePath)); });
    img.crossOrigin='anonymous';
    img.__loadPromise=p;
    img.src=spritePath;
    _imgCache.set(spritePath,img);
    return p;
  }

  // Paint separate layers instead of hue-keying the combined sprite; paper and binding
  // share coordinates but receive independent colors before they are composited.
  function tintLayer(image, tint) {
    const canvas = document.createElement('canvas'); // Shared-size tint buffer for layered authored icons.
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const ctx = canvas.getContext('2d');
    if (!ctx || !canvas.width || !canvas.height) throw new Error('Sprite layer has no usable image pixels');
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    recolorImageData(pixels.data, tint, 'direct');
    ctx.putImageData(pixels, 0, 0);
    return canvas;
  }

  function getCompositeCanvas(spritePath, targetHex, mode) {
    const binding = /^layered-scroll:([0-9a-f]{6})$/i.exec(mode); // UI slot color encoded in the item's spriteMode.
    const isSheen = mode === 'direct-sheen'; // Optional iridescence on bright Koma and comparable powders.
    if (!binding && !isSheen) return null;
    const key = 'shared-color-fill-v2|' + spritePath + '|' + mode + '|' + targetHex;
    if (_canvasCache.has(key)) return Promise.resolve(_canvasCache.get(key));
    const overlayPath = binding ? 'assets/objectsprites/scroll_binding.png' : 'assets/objectsprites/iridescent_sheen.png';
    const pending = Promise.all([loadImage(spritePath), loadImage(overlayPath)]).then(([baseImage, overlayImage]) => {
      const painted = tintLayer(baseImage, targetHex); // Scroll paper or solid powder body: color never leaks onto the second layer.
      const ctx = painted.getContext('2d');
      if (binding) {
        const color = parseInt(binding[1], 16); // Exact canonical melee action-slot tint.
        const ribbon = tintLayer(overlayImage, color);
        ctx.drawImage(ribbon, 0, 0, painted.width, painted.height);
      } else {
        ctx.save();
        ctx.globalCompositeOperation = 'source-atop'; // Sheen only colors the nontransparent object, never its transparent bounding rectangle.
        ctx.globalAlpha = 0.34;
        ctx.drawImage(overlayImage, 0, 0, painted.width, painted.height);
        ctx.restore();
      }
      window.__farmLog?.('[sprite-recolor] layered ' + spritePath + ' mode=' + mode, 'items');
      _canvasCache.set(key, painted);
      return painted;
    }).catch(error => {
      if (_canvasCache.get(key) === pending) _canvasCache.delete(key); // A temporary missing asset must be retryable on mobile.
      throw error;
    });
    _canvasCache.set(key, pending); // Share in-flight canvas work across Pack, HUD and held-item rendering.
    return pending;
  }

  function getRecoloredCanvas(spritePath, targetHex, mode, opts) {
    const composite = getCompositeCanvas(spritePath, targetHex, mode); // Separate scroll paper/binding and iridescent powder modes.
    if (composite) return composite;
    if (typeof mode === 'string' && mode.startsWith('fish:') && window.FishCatalog?.getRecoloredCanvas) return window.FishCatalog.getRecoloredCanvas(spritePath, mode.slice(5));
    const cacheKey='shared-color-fill-v2|'+spritePath+'|'+mode+'|'+targetHex;
    const cached=_canvasCache.get(cacheKey);
    if(cached)return Promise.resolve(cached);
    return loadImage(spritePath).then(img=>{
      const canvas=document.createElement('canvas'); canvas.width=img.naturalWidth; canvas.height=img.naturalHeight;
      const ctx=canvas.getContext('2d'); ctx.drawImage(img,0,0);
      const imageData=ctx.getImageData(0,0,canvas.width,canvas.height);
      recolorImageData(imageData.data,targetHex,mode,opts); ctx.putImageData(imageData,0,0);
      const fillLabel = String(mode || '').startsWith('dual-keyed') ? 'dual hue-key/value-fill' : mode === 'keyed' ? 'hue-key/value-fill' : 'animal shade-fill'; // Used by mobile/debug logs to identify the active recolor path.
      window.__farmLog?.(`[sprite-recolor] ${fillLabel} ${spritePath} -> #${targetHex.toString(16).padStart(6,'0')}`,'items');
      _canvasCache.set(cacheKey,canvas); return canvas;
    });
  }

  function parserOrderedScript(filename,datasetKey,version,alreadyLoaded){
    if(typeof document==='undefined'||alreadyLoaded?.()||document.querySelector(`script[data-${datasetKey}]`))return;
    const ownSrc=document.currentScript?.src;
    const src=ownSrc?new URL(`${filename}?v=${version}`,ownSrc).href:`js/${filename}?v=${version}`;
    if(document.readyState==='loading'){document.write(`<script src="${src}" data-${datasetKey}="true"></script>`);return;}
    const script=document.createElement('script'); script.src=src;
    script.dataset[datasetKey.replace(/-([a-z])/g,(_,ch)=>ch.toUpperCase())]='true';
    script.onerror=()=>console.warn(`[sprite-recolor] failed to load ${filename}`);
    document.head.appendChild(script);
  }

  function loadFishCatalogForGame(){
    if(typeof document==='undefined'||!document.getElementById('fishingOverlay'))return;
    parserOrderedScript('fish-catalog.js','fish-catalog','20261018h1c2396a',()=>!!window.FishCatalog);
  }
  function loadFishingEventsForGame(){
    if(typeof document==='undefined'||!document.getElementById('fishingOverlay'))return;
    parserOrderedScript('fishing-events.js','fishing-events','20261018h19942c7');
  }
  function loadAmphibiousFishingForGame(){
    if(typeof document==='undefined'||!document.getElementById('fishingOverlay'))return;
    parserOrderedScript('amphibious-fishing.js','amphibious-fishing','20261104scent1439',()=>!!window.AmphibiousFishing);
    parserOrderedScript('amphibious-fish-corpse-cleanup.js','amphibious-corpse-cleanup','20260826a');
    parserOrderedScript('fishing-presentation-debug.js','fishing-presentation-debug','20260826a',()=>!!window.FishingPresentationDebug);
  }

  window.SpriteRecolor={getRecoloredCanvas,recolorImageData,directShadeFillPixels,relativeLuminance,shadeFillConfig,DEFAULT_KEY_A,DEFAULT_KEY_B,SECONDARY_KEY_A,SECONDARY_KEY_B,KEY_HUE_TOLERANCE,DUAL_KEY_MODE_PREFIX};
  loadFishCatalogForGame();
  loadFishingEventsForGame();
  loadAmphibiousFishingForGame();
})();
