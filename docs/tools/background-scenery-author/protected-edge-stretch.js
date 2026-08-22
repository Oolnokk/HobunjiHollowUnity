'use strict';
(() => {
  const Core = window.BackgroundScenery;
  if (!Core || Core.__protectedEdgeStretchAuthorPatch) return;

  const $ = id => document.getElementById(id);
  const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
  const finiteOr = (v,fallback) => { const n=Number(v); return Number.isFinite(n) ? n : fallback; };
  const clone = v => JSON.parse(JSON.stringify(v));
  const DEFAULTS = Object.freeze({
    schema:'hobunji_protected_material_stretch.v1',
    enabled:false,
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
        edgeWorldWidth:clamp(finiteOr(s.edgeWorldWidth,d.edgeWorldWidth),0,8),
      };
    };
    return {schema:DEFAULTS.schema,enabled:src.enabled===true,slots:{grass:readSlot('grass'),cliff:readSlot('cliff')}};
  }

  // The core resolver intentionally whitelists its v1 properties. Wrap it here
  // so this experimental authoring block survives load/export/apply without
  // changing runtime BorderTerrain behavior yet.
  const originalResolveConfig = Core.resolveConfig.bind(Core);
  Core.resolveConfig = function protectedStretchResolveConfig(map) {
    const cfg = originalResolveConfig(map);
    cfg.materialStretch = normalize(map?.backgroundScenery?.materialStretch);
    activeMap = map;
    activeConfig = cfg;
    queueMicrotask(syncControls);
    return cfg;
  };
  Core.__protectedEdgeStretchAuthorPatch = true;

  function materialStretch() { return activeConfig?.materialStretch || null; }
  function slot() { return materialStretch()?.slots?.[slotName] || null; }
  function assetUrl(path) {
    const p=String(path||'').trim();
    if (!p) return '';
    if (/^(?:https?:|data:|blob:)/i.test(p)) return p;
    return '../../' + p.replace(/^docs\//,'').replace(/^\/+/, '');
  }

  function syncControls() {
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
    if (reload) loadTexture();
    else drawPreview();
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
    const img=new Image();
    img.decoding='async';
    img.onload=()=>{ if(token!==loadToken)return; previewImage=img; drawPreview(); };
    img.onerror=()=>{ if(token!==loadToken)return; previewImage=null; drawPreview(`Could not load ${path}`); };
    img.src=assetUrl(path);
  }

  function remapCoord(t,sourceFrac,targetFrac) {
    t=clamp(t,0,1); sourceFrac=clamp(sourceFrac,0,0.49); targetFrac=clamp(targetFrac,0,0.49);
    if (sourceFrac<=1e-6 || targetFrac<=1e-6) return t;
    if (t<targetFrac) return (t/targetFrac)*sourceFrac;
    if (t>1-targetFrac) return 1-((1-t)/targetFrac)*sourceFrac;
    return sourceFrac+((t-targetFrac)/Math.max(1e-6,1-2*targetFrac))*(1-2*sourceFrac);
  }

  function drawProtectedImage(c,img,x,y,w,h,s,worldW,worldH) {
    const edgePx=clamp(Number(s.protectedEdgePx)||0,0,Math.max(0,Math.min(img.naturalWidth,img.naturalHeight)/2-1));
    const sxFrac=img.naturalWidth ? edgePx/img.naturalWidth : 0;
    const syFrac=img.naturalHeight ? edgePx/img.naturalHeight : 0;
    const txFrac=worldW ? clamp((Number(s.edgeWorldWidth)||0)/worldW,0,0.49) : 0;
    const tyFrac=worldH ? clamp((Number(s.edgeWorldWidth)||0)/worldH,0,0.49) : 0;
    const iw=Math.max(1,Math.round(w)), ih=Math.max(1,Math.round(h));
    const pass=document.createElement('canvas'); pass.width=iw; pass.height=img.naturalHeight;
    const pc=pass.getContext('2d'); pc.imageSmoothingEnabled=true;
    for(let dx=0;dx<iw;dx++){
      const t=(dx+.5)/iw, sx=remapCoord(t,sxFrac,txFrac)*img.naturalWidth;
      pc.drawImage(img,Math.max(0,Math.min(img.naturalWidth-1,sx)),0,1,img.naturalHeight,dx,0,1,img.naturalHeight);
    }
    const final=document.createElement('canvas'); final.width=iw; final.height=ih;
    const fc=final.getContext('2d'); fc.imageSmoothingEnabled=true;
    for(let dy=0;dy<ih;dy++){
      const t=(dy+.5)/ih, sy=remapCoord(t,syFrac,tyFrac)*img.naturalHeight;
      fc.drawImage(pass,0,Math.max(0,Math.min(img.naturalHeight-1,sy)),iw,1,0,dy,iw,1);
    }
    c.drawImage(final,x,y,w,h);
  }

  function stats(img,s,worldW,worldH) {
    const edgePx=Math.max(0,Math.min(Number(s.protectedEdgePx)||0,(Math.min(img.naturalWidth,img.naturalHeight)-1)/2));
    const ew=Math.max(0,Number(s.edgeWorldWidth)||0);
    const edgeScale=edgePx>0 ? ew/edgePx : 0;
    const centerW=Math.max(0,worldW-2*ew), centerH=Math.max(0,worldH-2*ew);
    const srcW=Math.max(1,img.naturalWidth-2*edgePx), srcH=Math.max(1,img.naturalHeight-2*edgePx);
    const centerScaleX=centerW/srcW, centerScaleY=centerH/srcH;
    return {
      ew, edgeScale, centerScaleX, centerScaleY,
      ratioX:edgeScale>0 ? centerScaleX/edgeScale : 0,
      ratioY:edgeScale>0 ? centerScaleY/edgeScale : 0,
    };
  }

  function drawHeatmap(c,x,y,w,h,img,s,worldW,worldH) {
    const st=stats(img,s,worldW,worldH);
    const fx=worldW ? clamp(st.ew/worldW,0,0.49) : 0;
    const fy=worldH ? clamp(st.ew/worldH,0,0.49) : 0;
    c.fillStyle='#111827'; c.fillRect(x,y,w,h);
    c.fillStyle='rgba(52,211,153,.55)';
    c.fillRect(x,y,w*fx,h); c.fillRect(x+w*(1-fx),y,w*fx,h); c.fillRect(x,y,w,h*fy); c.fillRect(x,y+h*(1-fy),w,h*fy);
    c.fillStyle='rgba(251,191,36,.48)'; c.fillRect(x+w*fx,y+h*fy,w*(1-2*fx),h*(1-2*fy));
    c.strokeStyle='rgba(255,255,255,.72)'; c.lineWidth=1; c.strokeRect(x+w*fx,y+h*fy,w*(1-2*fx),h*(1-2*fy));
    c.fillStyle='#fff'; c.font='11px system-ui'; c.fillText('protected edge',x+6,y+15); c.fillText('center absorbs stretch',x+w*fx+6,y+h*.5);
  }

  function drawPreview(errorText='') {
    const cv=$('stretchPreview'), out=$('stretchStats');
    if (!cv || !out) return;
    const r=cv.getBoundingClientRect(), dpr=Math.min(2,devicePixelRatio||1);
    const cssW=Math.max(220,Math.round(r.width||320)), cssH=Math.max(150,Math.round(r.height||190));
    if(cv.width!==Math.round(cssW*dpr)||cv.height!==Math.round(cssH*dpr)){cv.width=Math.round(cssW*dpr);cv.height=Math.round(cssH*dpr);}
    const c=cv.getContext('2d'); c.setTransform(dpr,0,0,dpr,0,0); c.clearRect(0,0,cssW,cssH); c.fillStyle='#07101a'; c.fillRect(0,0,cssW,cssH);
    const s=slot();
    if(!activeMap||!activeConfig||!s){out.textContent='Load a map to preview material stretch.';return;}
    const depth=Number(activeConfig.borderDepthTiles||18), worldW=activeMap.cols+depth*2, worldH=activeMap.rows+depth*2;
    if(!previewImage){c.fillStyle='#9fb4cf';c.font='12px system-ui';c.fillText(errorText|| (previewImagePath?'Loading texture…':'No texture path.'),10,24);out.textContent=`target ${worldW.toFixed(1)}×${worldH.toFixed(1)} world units`;return;}
    const img=previewImage, pad=8, labelH=17, usableW=cssW-pad*2;
    if(previewMode==='heatmap'){
      drawHeatmap(c,pad,labelH+pad,usableW,cssH-labelH-pad*2,img,s,worldW,worldH);
      c.fillStyle='#edf5ff'; c.font='11px system-ui'; c.fillText('LOCAL STRETCH MAP',pad,13);
    }else if(previewMode==='protected'){
      c.fillStyle='#edf5ff'; c.font='11px system-ui'; c.fillText('PROTECTED EDGE',pad,13);
      drawProtectedImage(c,img,pad,labelH+pad,usableW,cssH-labelH-pad*2,s,worldW,worldH);
    }else{
      const half=(cssH-labelH*2-pad*3)/2;
      c.fillStyle='#edf5ff'; c.font='11px system-ui'; c.fillText('ORDINARY STRETCH',pad,13);
      c.drawImage(img,pad,labelH+pad,usableW,half);
      c.fillText('PROTECTED EDGE',pad,labelH+pad+half+labelH);
      drawProtectedImage(c,img,pad,labelH*2+pad*2+half,usableW,half,s,worldW,worldH);
    }
    const st=stats(img,s,worldW,worldH);
    const edge=st.edgeScale ? `${st.edgeScale.toFixed(4)}u/px` : 'off';
    const rx=st.ratioX ? `${st.ratioX.toFixed(1)}×` : '—', ry=st.ratioY ? `${st.ratioY.toFixed(1)}×` : '—';
    out.innerHTML=`${img.naturalWidth}×${img.naturalHeight}px · target ${worldW.toFixed(1)}×${worldH.toFixed(1)}u<br>edge scale ${edge} · center/edge stretch X ${rx}, Z ${ry}`;
  }

  $('stretchEnabled').onchange=()=>{const m=materialStretch();if(!m)return;m.enabled=$('stretchEnabled').checked;drawPreview();};
  $('stretchSlot').onchange=()=>{slotName=$('stretchSlot').value;syncControls();};
  $('stretchMode').onchange=()=>{previewMode=$('stretchMode').value;drawPreview();};
  $('stretchTexture').onchange=()=>updateSlot(s=>s.texture=$('stretchTexture').value.trim(),true);
  $('stretchEdgePx').oninput=()=>updateSlot(s=>s.protectedEdgePx=clamp(finiteOr($('stretchEdgePx').value,0),0,256));
  $('stretchWorldEdge').oninput=()=>updateSlot(s=>s.edgeWorldWidth=clamp(finiteOr($('stretchWorldEdge').value,0),0,8));
  $('stretchReset').onclick=()=>{const m=materialStretch();if(!m)return;m.slots[slotName]=clone(DEFAULTS.slots[slotName]);syncControls();};
  $('borderDepth').addEventListener('input',()=>queueMicrotask(drawPreview));
  window.addEventListener('resize',drawPreview);
})();
