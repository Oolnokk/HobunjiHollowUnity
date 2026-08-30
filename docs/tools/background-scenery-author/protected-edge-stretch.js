'use strict';

// The author does not load the gameplay HousePieces bootstrap, which normally
// brings TerrainRenderChunks/TerrainJigsawUV in synchronously. Load that shared
// terrain baker here too so the 3D author preview uses exactly the runtime UV
// code instead of maintaining a second approximation.
if (!window.TerrainJigsawUV && document.readyState === 'loading' && typeof document.write === 'function') {
  document.write('<script src="../../js/terrain-render-chunks.js?v=20260822jigsaw1"></script>');
}

(() => {
  const Core = window.BackgroundScenery;
  if (!Core || Core.__jigsawSurfaceAuthorPatch) return;

  const $ = id => document.getElementById(id);
  const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
  const finiteOr = (v,fallback) => { const n=Number(v); return Number.isFinite(n) ? n : fallback; };
  const clone = v => JSON.parse(JSON.stringify(v));
  const DEFAULTS = Object.freeze({
    schema:'hobunji_jigsaw_material_uv.v1',
    enabled:true,
    slots:Object.freeze({
      grass:Object.freeze({texture:'assets/textures/wavy_surface.png',protectedEdgePx:16,edgeWorldWidth:0.5}),
      cliff:Object.freeze({texture:'assets/textures/carved_smooth.png',protectedEdgePx:16,edgeWorldWidth:0.5}),
    }),
  });

  let activeMap = null;
  let activeConfig = null;
  let slotName = 'grass';
  let previewMode = 'compare';
  let previewImage = null;
  let previewImagePath = '';
  let loadToken = 0;

  function normalize(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const slots = src.slots && typeof src.slots === 'object' ? src.slots : {};
    const readSlot = name => {
      const d=DEFAULTS.slots[name], s=slots[name] && typeof slots[name] === 'object' ? slots[name] : {};
      return {
        texture:String(s.texture || d.texture),
        protectedEdgePx:clamp(finiteOr(s.protectedEdgePx,d.protectedEdgePx),0,256),
        edgeWorldWidth:clamp(finiteOr(s.edgeWorldWidth,d.edgeWorldWidth),0.05,8),
      };
    };
    return {schema:DEFAULTS.schema,enabled:src.enabled!==false,slots:{grass:readSlot('grass'),cliff:readSlot('cliff')}};
  }

  const originalResolveConfig = Core.resolveConfig.bind(Core);
  Core.resolveConfig = function jigsawSurfaceResolveConfig(map) {
    const cfg = originalResolveConfig(map);
    cfg.materialStretch = normalize(map?.backgroundScenery?.materialStretch);
    activeMap = map;
    activeConfig = cfg;
    queueMicrotask(syncControls);
    return cfg;
  };
  Core.__jigsawSurfaceAuthorPatch = true;

  function materialStretch() { return activeConfig?.materialStretch || null; }
  function slot() { return materialStretch()?.slots?.[slotName] || null; }
  function assetUrl(path) {
    const p=String(path||'').trim();
    if (!p) return '';
    if (/^(?:https?:|data:|blob:)/i.test(p)) return p;
    return '../../' + p.replace(/^docs\//,'').replace(/^\/+/, '');
  }

  function relabelUi() {
    const enabled=$('stretchEnabled');
    const section=enabled?.closest?.('.section');
    const h=section?.querySelector('h2');
    if(h)h.textContent='Jigsaw surface texture';
    const desc=section?.querySelector('p.muted');
    if(desc)desc.textContent='Each connected terrain surface gets one 0–1 texture domain. The source-image border band is warped onto that surface’s literal irregular perimeter; disconnected islands start a new texture domain.';
    const edgeLabel=$('stretchEdgePx')?.closest('.field')?.querySelector('label');
    if(edgeLabel)edgeLabel.textContent='Source border band (px)';
    const worldLabel=$('stretchWorldEdge')?.closest('.field')?.querySelector('label');
    if(worldLabel)worldLabel.textContent='Boundary rig depth (world units)';
    const mode=$('stretchMode');
    if(mode){
      const opts=[...mode.options];
      const compare=opts.find(o=>o.value==='compare'), protectedOpt=opts.find(o=>o.value==='protected'), heat=opts.find(o=>o.value==='heatmap');
      if(compare)compare.textContent='Texture vs jigsaw rig';
      if(protectedOpt)protectedOpt.textContent='Jigsaw rig only';
      if(heat)heat.textContent='Boundary influence map';
    }
    const tail=section?.querySelectorAll('p.muted')?.[1];
    if(tail)tail.textContent='The 2D diagram is only a topology cue. Use 3D Preview for the real connected-component bake on game BorderTerrain geometry, including concave edges and disconnected islands.';
  }

  function syncControls() {
    relabelUi();
    const m=materialStretch();
    if (!m || !$('stretchEnabled')) return;
    $('stretchEnabled').checked=!!m.enabled;
    $('stretchSlot').value=slotName;
    $('stretchMode').value=previewMode;
    const s=slot();
    $('stretchTexture').value=s.texture;
    $('stretchEdgePx').value=s.protectedEdgePx;
    $('stretchWorldEdge').value=s.edgeWorldWidth;
    loadTexture();
  }

  function updateSlot(mutator, reload=false) {
    const s=slot(); if (!s) return;
    mutator(s);
    if (reload) loadTexture(); else drawPreview();
    window.dispatchEvent(new CustomEvent('hobunji-jigsaw-author-change'));
  }

  function loadTexture() {
    const s=slot(); if (!s) return;
    const path=s.texture || '';
    if (previewImage && previewImagePath===path) { drawPreview(); return; }
    const token=++loadToken;
    previewImage=null;
    previewImagePath=path;
    drawPreview();
    if (!path) return;
    const img=new Image(); img.decoding='async';
    img.onload=()=>{ if(token!==loadToken)return; previewImage=img; drawPreview(); };
    img.onerror=()=>{ if(token!==loadToken)return; previewImage=null; drawPreview(`Could not load ${path}`); };
    img.src=assetUrl(path);
  }

  const outer=[[.08,.22],[.24,.08],[.47,.13],[.57,.05],[.83,.16],[.91,.38],[.77,.48],[.88,.69],[.72,.91],[.48,.83],[.34,.95],[.14,.79],[.22,.58],[.07,.49]];
  const hole=[[.43,.39],[.58,.34],[.67,.47],[.59,.60],[.43,.58],[.36,.48]];
  function pathPoly(c,pts,x,y,w,h){c.beginPath();pts.forEach((p,i)=>{const px=x+p[0]*w,py=y+p[1]*h;i?c.lineTo(px,py):c.moveTo(px,py);});c.closePath();}

  function drawIslandTexture(c,img,x,y,w,h) {
    c.save(); pathPoly(c,outer,x,y,w,h); pathPoly(c,hole,x,y,w,h); c.clip('evenodd');
    if(img)c.drawImage(img,x,y,w,h);else{c.fillStyle='#2f7021';c.fillRect(x,y,w,h);}
    c.restore();
  }

  function drawBoundaryInfluence(c,x,y,w,h,s) {
    c.save(); pathPoly(c,outer,x,y,w,h); pathPoly(c,hole,x,y,w,h); c.clip('evenodd');
    c.fillStyle='#b7791f';c.fillRect(x,y,w,h);
    const px=Math.max(3,Math.min(w,h)*Math.min(.18,(Number(s.edgeWorldWidth)||.5)/6));
    c.lineJoin='round';c.lineCap='round';c.lineWidth=px*2;c.strokeStyle='#2aae79';
    pathPoly(c,outer,x,y,w,h);c.stroke();pathPoly(c,hole,x,y,w,h);c.stroke();
    c.restore();
  }

  function drawPreview(errorText='') {
    const cv=$('stretchPreview'), out=$('stretchStats');
    if (!cv || !out) return;
    const r=cv.getBoundingClientRect(), dpr=Math.min(2,devicePixelRatio||1);
    const cssW=Math.max(220,Math.round(r.width||320)), cssH=Math.max(150,Math.round(r.height||190));
    if(cv.width!==Math.round(cssW*dpr)||cv.height!==Math.round(cssH*dpr)){cv.width=Math.round(cssW*dpr);cv.height=Math.round(cssH*dpr);}
    const c=cv.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,cssW,cssH);c.fillStyle='#07101a';c.fillRect(0,0,cssW,cssH);
    const s=slot();if(!activeMap||!activeConfig||!s){out.textContent='Load a map to preview jigsaw surface mapping.';return;}
    if(!previewImage){c.fillStyle='#9fb4cf';c.font='12px system-ui';c.fillText(errorText||(previewImagePath?'Loading texture…':'No texture path.'),10,24);return;}
    const pad=8,labelH=17,usableW=cssW-pad*2,boxH=cssH-labelH-pad*2;
    if(previewMode==='heatmap'){
      c.fillStyle='#edf5ff';c.font='11px system-ui';c.fillText('BOUNDARY INFLUENCE',pad,13);drawBoundaryInfluence(c,pad,labelH+pad,usableW,boxH,s);
    }else if(previewMode==='protected'){
      c.fillStyle='#edf5ff';c.font='11px system-ui';c.fillText('ONE TEXTURE · ONE IRREGULAR ISLAND',pad,13);drawIslandTexture(c,previewImage,pad,labelH+pad,usableW,boxH);
      c.strokeStyle='#34d399';c.lineWidth=2;pathPoly(c,outer,pad,labelH+pad,usableW,boxH);c.stroke();pathPoly(c,hole,pad,labelH+pad,usableW,boxH);c.stroke();
    }else{
      const half=(usableW-8)/2;
      c.fillStyle='#edf5ff';c.font='10px system-ui';c.fillText('RECTANGULAR DOMAIN',pad,13);c.drawImage(previewImage,pad,labelH+pad,half,boxH);
      c.fillText('JIGSAW DOMAIN',pad+half+8,13);drawIslandTexture(c,previewImage,pad+half+8,labelH+pad,half,boxH);
      c.strokeStyle='#34d399';c.lineWidth=1.5;pathPoly(c,outer,pad+half+8,labelH+pad,half,boxH);c.stroke();pathPoly(c,hole,pad+half+8,labelH+pad,half,boxH);c.stroke();
    }
    out.innerHTML=`${previewImage.naturalWidth}×${previewImage.naturalHeight}px source · ${s.protectedEdgePx}px border band<br>${Number(s.edgeWorldWidth).toFixed(2)}u boundary rig depth · runtime split = shared-edge connected components`;
  }

  $('stretchEnabled').onchange=()=>{const m=materialStretch();if(!m)return;m.enabled=$('stretchEnabled').checked;drawPreview();window.dispatchEvent(new CustomEvent('hobunji-jigsaw-author-change'));};
  $('stretchSlot').onchange=()=>{slotName=$('stretchSlot').value;syncControls();};
  $('stretchMode').onchange=()=>{previewMode=$('stretchMode').value;drawPreview();};
  $('stretchTexture').onchange=()=>updateSlot(s=>s.texture=$('stretchTexture').value.trim(),true);
  $('stretchEdgePx').oninput=()=>updateSlot(s=>s.protectedEdgePx=clamp(finiteOr($('stretchEdgePx').value,0),0,256));
  $('stretchWorldEdge').oninput=()=>updateSlot(s=>s.edgeWorldWidth=clamp(finiteOr($('stretchWorldEdge').value,.5),.05,8));
  $('stretchReset').onclick=()=>{const m=materialStretch();if(!m)return;m.slots[slotName]=clone(DEFAULTS.slots[slotName]);syncControls();window.dispatchEvent(new CustomEvent('hobunji-jigsaw-author-change'));};
  $('borderDepth').addEventListener('input',()=>queueMicrotask(drawPreview));
  window.addEventListener('resize',drawPreview);
  relabelUi();
})();