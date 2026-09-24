// Sprite recolor utility for authored item/object PNGs. Keyed liquid fills
// replace hue+saturation while retaining each pixel's painted HSV value and
// alpha; direct whole-sprite fills retain the animal shade-fill method.
// Two modes:
//   - "keyed": only pixels whose hue is near the placeholder green get
//     recolored, regardless of their saturation or value. Everything else
//     (glass, cork, outline...) is untouched.
//     Used by jar_liquid.png / bottle_potion.png / bottle_wine.png, whose
//     placeholder liquid fill uses exactly #9ED775 (highlight) and #698F4E
//     (shadow) plus antialiased blends between them.
//   - "direct": every non-transparent pixel is recolored. Used by
//     pile_dew.png / cheese.png, whose entire sprite is the "thing" being
//     recolored — no separate container/outline region to preserve.
(() => {
  "use strict";

  const DEFAULT_KEY_A = [0x9E, 0xD7, 0x75];
  const DEFAULT_KEY_B = [0x69, 0x8F, 0x4E];
  const KEY_HUE_TOLERANCE = 35;

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

  function recolorImageData(data, targetHex, mode, opts) {
    const tr = (targetHex >> 16) & 255, tg = (targetHex >> 8) & 255, tb = targetHex & 255;
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

  function getRecoloredCanvas(spritePath, targetHex, mode, opts) {
    if (typeof mode === 'string' && mode.startsWith('fish:') && window.FishCatalog?.getRecoloredCanvas) return window.FishCatalog.getRecoloredCanvas(spritePath, mode.slice(5));
    const cacheKey='shared-color-fill-v1|'+spritePath+'|'+mode+'|'+targetHex;
    const cached=_canvasCache.get(cacheKey);
    if(cached)return Promise.resolve(cached);
    return loadImage(spritePath).then(img=>{
      const canvas=document.createElement('canvas'); canvas.width=img.naturalWidth; canvas.height=img.naturalHeight;
      const ctx=canvas.getContext('2d'); ctx.drawImage(img,0,0);
      const imageData=ctx.getImageData(0,0,canvas.width,canvas.height);
      recolorImageData(imageData.data,targetHex,mode,opts); ctx.putImageData(imageData,0,0);
      window.__farmLog?.(`[sprite-recolor] ${mode === 'keyed' ? 'hue-key/value-fill' : 'animal shade-fill'} ${spritePath} -> #${targetHex.toString(16).padStart(6,'0')}`,'items');
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
    parserOrderedScript('fish-catalog.js','fish-catalog','20260923silhouettehitbox1',()=>!!window.FishCatalog);
  }
  function loadFishingEventsForGame(){
    if(typeof document==='undefined'||!document.getElementById('fishingOverlay'))return;
    parserOrderedScript('fishing-events.js','fishing-events','20260910manuals1');
  }
  function loadAmphibiousFishingForGame(){
    if(typeof document==='undefined'||!document.getElementById('fishingOverlay'))return;
    parserOrderedScript('amphibious-fishing.js','amphibious-fishing','20260826a',()=>!!window.AmphibiousFishing);
    parserOrderedScript('amphibious-fish-corpse-cleanup.js','amphibious-corpse-cleanup','20260826a');
    parserOrderedScript('fishing-presentation-debug.js','fishing-presentation-debug','20260826a',()=>!!window.FishingPresentationDebug);
  }

  window.SpriteRecolor={getRecoloredCanvas,recolorImageData,directShadeFillPixels,relativeLuminance,shadeFillConfig,DEFAULT_KEY_A,DEFAULT_KEY_B,KEY_HUE_TOLERANCE};
  loadFishCatalogForGame();
  loadFishingEventsForGame();
  loadAmphibiousFishingForGame();
})();
