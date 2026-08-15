(() => {
  'use strict';

  const SEASON = { spring: 'Stormtide', summer: 'Deadgrass', fall: 'Longpour', winter: 'Coldmuck' };
  const GURUMAHI_IGNORES = [['#7d7d76',22],['#98978e',48],['#706f69',48]];
  const ROCKSCALE_IGNORES = [['#7f6e77',7],['#bababa',45]];

  const ROWS = [
    ['gurumahi_tawny','Gurumahi Tawny','gurumahi','#9b6f49',1.06,.25,'smooth',34,['farm','town'],'spring,summer,fall',['day','dusk'],'common',30],
    ['gurumahi_charcoal','Gurumahi Charcoal','gurumahi','#4e4f52',1.12,.25,'mixed',46,['town','northernCliffs'],'any',['dawn','day'],'uncommon',42],
    ['gurumahi_creamback','Gurumahi Creamback','gurumahi','#d7c39d',.98,.25,'floater',28,['farm'],'spring,summer',['dawn','day'],'common',24],
    ['gurumahi_snowmuzzle','Gurumahi Snowmuzzle','gurumahi','#c9ced1',1.03,.25,'sinker',39,['cloudForest','northernCliffs'],'winter',['day','night'],'uncommon',38],
    ['rockscale_goldplate','Rockscale Goldplate','rockscale','#c9a24f',1.14,1,'sinker',52,['town','northernCliffs'],'any',['day','dusk'],'common',48],
    ['rockscale_giltback','Rockscale Giltback','rockscale','#e0bc67',1.18,1,'mixed',56,['town','cloudForest'],'any',['dawn','day'],'common',52],
    ['rockscale_silverplate','Rockscale Silverplate','rockscale','#b9bec8',1.15,1,'smooth',50,['town','northernCliffs'],'any',['dawn','day'],'uncommon',58],
    ['rockscale_ironvein','Rockscale Ironvein','rockscale','#8e5541',1.17,1,'dart',63,['northernCliffs'],'fall,winter',['day','dusk'],'uncommon',64],
    ['rockscale_slateplate','Rockscale Slateplate','rockscale','#58616c',1.2,1,'sinker',60,['cloudForest','northernCliffs'],'any',['night'],'uncommon',66],
    ['rockscale_quartzshield','Rockscale Quartzshield','rockscale','#d8d4ca',1.1,1,'smooth',44,['farm','cloudForest'],'spring,winter',['dawn','day'],'common',44],
    ['rockscale_copperbloom','Rockscale Copperbloom','rockscale','#9a7352',1.16,1,'mixed',58,['town','cloudForest'],'summer,fall',['day','dusk'],'uncommon',61],
    ['sixfin_honeystripe','Sixfin Honeystripe','sixfin','#fff',.94,0,'mixed',36,['farm','town'],'spring,summer',['day'],'common',26,'#d7b161','#5c3520'],
    ['sixfin_coalbar','Sixfin Coalbar','sixfin','#fff',1.02,0,'dart',49,['town','northernCliffs'],'any',['dusk','night'],'uncommon',34,'#7c7366','#2f2f34'],
    ['sixfin_redlash','Sixfin Redlash','sixfin','#fff',.98,0,'mixed',41,['farm','town'],'summer,fall',['dawn','day'],'common',28,'#c7a794','#8e4938'],
    ['sixfin_mossband','Sixfin Mossband','sixfin','#fff',1.01,0,'smooth',32,['cloudForest','farm'],'spring,summer,fall',['day','dusk'],'common',27,'#94a780','#415d3e'],
    ['sixfin_azureband','Sixfin Azureband','sixfin','#fff',1.04,0,'floater',38,['cloudForest','town'],'summer',['dawn','day'],'uncommon',33,'#8ab9c8','#315d78'],
    ['sixfin_sunember','Sixfin Sunember','sixfin','#fff',.97,0,'dart',54,['town','cloudForest'],'summer,fall',['day','dusk'],'uncommon',36,'#dbc890','#b55a2c'],
    ['sixfin_milkstripe','Sixfin Milkstripe','sixfin','#fff',.92,0,'smooth',29,['farm'],'spring,winter',['dawn','day'],'common',23,'#e5dbc6','#545257'],
    ['sixfin_violetreef','Sixfin Violetreef','sixfin','#fff',1.05,0,'mixed',47,['cloudForest','town'],'any',['dusk','night'],'uncommon',35,'#ab99bf','#5a4379']
  ];

  function silhouetteAxes(species, scalar) {
    const s = Math.max(0.2, Number(scalar) || 1);
    if (species === 'gurumahi') return { x: s * 0.90, y: s * 1.15 }; // compact and thick
    if (species === 'rockscale') return { x: s * 1.22, y: s * 1.12 }; // long, eel-like, but still hefty
    return { x: s, y: s };
  }

  const FISH = Object.freeze(ROWS.map(r => {
    const axes = silhouetteAxes(r[2], r[4]);
    return {
      key:r[0], label:r[1], species:r[2], baseColor:r[3],
      minigameScale:r[4], minigameScaleX:axes.x, minigameScaleY:axes.y,
      valueBoost:r[5], fishClass:r[6], difficulty:r[7], zones:r[8],
      seasons:r[9], timesOfDay:r[10], rarity:r[11], sellPrice:r[12],
      patterns:r[13] ? { base:r[13], stripes:r[14] } : {}
    };
  }));

  const byKey = new Map(FISH.map(f => [f.key, f]));
  const imgCache = new Map();
  const canvasCache = new Map();
  const curveCache = new Map();
  const CURVE_CACHE_LIMIT = 18;
  const FISH_RING_RADIUS = 96;

  const sprite = f => f.species === 'gurumahi' ? 'fish_gurumahi.png' : f.species === 'rockscale' ? 'fish_rockscale.png' : 'fish_sixfin.png';
  const ignores = f => (f.species === 'gurumahi' ? GURUMAHI_IGNORES : f.species === 'rockscale' ? ROCKSCALE_IGNORES : []).map(([hex,sensitivity]) => ({hex,sensitivity}));
  const seasons = s => s === 'any' ? 'any' : s.split(',').map(x => SEASON[x] || x);

  function buildFishingDefs() {
    const zones = { farm:[], town:[], northernCliffs:[], cloudForest:[] };
    for (const f of FISH) {
      const d = {
        key:f.key, label:f.label, icon:'🐟', rarity:f.rarity, sellPrice:f.sellPrice,
        seasons:seasons(f.seasons), timesOfDay:[...f.timesOfDay], fishClass:f.fishClass,
        difficulty:f.difficulty, minigameScale:f.minigameScale,
        minigameScaleX:f.minigameScaleX, minigameScaleY:f.minigameScaleY
      };
      for (const zone of f.zones) zones[zone]?.push(d);
    }
    return zones;
  }

  function buildItemDefs() {
    const out = {};
    for (const f of FISH) {
      out[f.key] = {
        icon:'🐟', label:f.label, cat:'material', category:'Fish', sellPrice:f.sellPrice,
        tags:['Fish','Edible'], desc:`${f.label}, a fish found around Hobunji Hollow.`,
        spriteIcon:sprite(f), spriteColor:0xffffff, spriteMode:`fish:${f.key}`
      };
    }
    return out;
  }
  const buildBasePrices = () => Object.fromEntries(FISH.map(f => [f.key,f.sellPrice]));

  const clamp = (v,a=0,b=1) => Math.max(a,Math.min(b,v));
  function hexRgb(h) { h=String(h).replace('#',''); if(h.length===3) h=[...h].map(x=>x+x).join(''); const n=parseInt(h,16)||0; return[(n>>16)&255,(n>>8)&255,n&255]; }
  function rgbHsv(r,g,b) { r/=255;g/=255;b/=255; const M=Math.max(r,g,b),m=Math.min(r,g,b),d=M-m; let h=0;if(d){if(M===r)h=((g-b)/d+(g<b?6:0))/6;else if(M===g)h=((b-r)/d+2)/6;else h=((r-g)/d+4)/6;}return[h,M?d/M:0,M]; }
  function hsvRgb(h,s,v) { const i=Math.floor(h*6),f=h*6-i,p=v*(1-s),q=v*(1-f*s),t=v*(1-(1-f)*s);let r,g,b;switch(i%6){case 0:r=v;g=t;b=p;break;case 1:r=q;g=v;b=p;break;case 2:r=p;g=v;b=t;break;case 3:r=p;g=q;b=v;break;case 4:r=t;g=p;b=v;break;default:r=v;g=p;b=q;}return[Math.round(r*255),Math.round(g*255),Math.round(b*255)];}
  const hueDist=(a,b)=>{const d=Math.abs(a-b)%1;return Math.min(d,1-d)};
  const ignored=(r,g,b,list)=>list.some(e=>{const c=hexRgb(e.hex);return Math.hypot(r-c[0],g-c[1],b-c[2])<=e.sensitivity});
  const chroma=(r,g,b)=>{const s=r+g+b;return s?[r/s,g/s,b/s]:[1/3,1/3,1/3]};
  const cd=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);

  function rockProfile(px,list) {
    const u=[];
    for(let i=0;i<px.length;i+=4){if(!px[i+3])continue;const r=px[i],g=px[i+1],b=px[i+2];if((r===255&&g===255&&b===255)||ignored(r,g,b,list))continue;const v=rgbHsv(r,g,b)[2];if(v<=.08)continue;u.push({r,g,b,v,c:chroma(r,g,b)});}
    if(!u.length)return{enabled:false,v:1};
    const cell=.025,bins=new Map();
    for(const p of u){const k=`${Math.round(p.c[0]/cell)},${Math.round(p.c[1]/cell)}`;let q=bins.get(k);if(!q){q={n:0,sr:0,sg:0,sb:0,m:0,sv:0};bins.set(k,q)}q.n++;q.sr+=p.c[0];q.sg+=p.c[1];q.sb+=p.c[2];q.sv+=p.v;q.m=Math.max(q.m,p.v)}
    let best=null;
    for(const q of bins.values()){if(q.n<Math.max(3,u.length*.01))continue;const score=q.m*3+q.sv/q.n+Math.min(q.n,u.length*.18)/Math.max(1,u.length*.18)*.75;if(!best||score>best.score)best={...q,score}}
    if(!best)for(const q of bins.values()){const score=q.m*3+q.sv/q.n+Math.min(q.n,u.length*.18)/Math.max(1,u.length*.18)*.75;if(!best||score>best.score)best={...q,score}}
    if(!best)return{enabled:false,v:1};
    const c=[best.sr/best.n,best.sg/best.n,best.sb/best.n];let d=.065,f=u.filter(p=>cd(p.c,c)<=d);if(f.length<Math.max(8,u.length*.04)){d=.1;f=u.filter(p=>cd(p.c,c)<=d)}let hi=f[0]||u[0];for(const p of f)if(p.v>hi.v)hi=p;
    return{enabled:!!f.length,v:hi.v||1,match:(r,g,b)=>cd(chroma(r,g,b),c)<=d};
  }

  function guruProfile(px,list) {
    const bins=36,scores=new Float64Array(bins),u=[];
    for(let i=0;i<px.length;i+=4){if(!px[i+3])continue;const r=px[i],g=px[i+1],b=px[i+2];if((r===255&&g===255&&b===255)||ignored(r,g,b,list))continue;const[h,s,v]=rgbHsv(r,g,b);if(v<=.08)continue;u.push({h,s,v});if(s>=.055)scores[Math.min(bins-1,Math.floor(h*bins))]+=.25+s;}
    if(!u.length)return{enabled:false,v:1};let bi=-1,bs=0;for(let b=0;b<bins;b++){const sc=scores[(b-1+bins)%bins]*.35+scores[b]+scores[(b+1)%bins]*.35;if(sc>bs){bs=sc;bi=b}}
    if(bi<0||!bs){let hi=u[0];for(const p of u)if(p.v>hi.v)hi=p;return{enabled:false,v:hi.v||1}}
    const h=(bi+.5)/bins,d=3.25/bins,f=u.filter(p=>p.s>=.035&&hueDist(p.h,h)<=d);let hi=f[0]||u[0];for(const p of f)if(p.v>hi.v)hi=p;
    return{enabled:!!f.length,v:hi.v||1,match:(H,S)=>S>=.035&&hueDist(H,h)<=d};
  }

  function recolorBase(data,f) {
    const px=data.data,t=rgbHsv(...hexRgb(f.baseColor)),list=ignores(f),p=f.species==='rockscale'?rockProfile(px,list):guruProfile(px,list);const hi=p.v||1;
    for(let i=0;i<px.length;i+=4){if(!px[i+3])continue;const r=px[i],g=px[i+1],b=px[i+2];if((r===255&&g===255&&b===255)||ignored(r,g,b,list))continue;const[H,S,V]=rgbHsv(r,g,b);if(V<=.08)continue;if(p.enabled){const ok=p.match.length===3?p.match(r,g,b):p.match(H,S);if(!ok)continue}const[nr,ng,nb]=hsvRgb(t[0],t[1],clamp(t[2]*(V/hi)*(1+f.valueBoost)));px[i]=nr;px[i+1]=ng;px[i+2]=nb;}
  }

  function load(path) {
    if(imgCache.has(path))return imgCache.get(path);
    const p=new Promise((res,rej)=>{const i=new Image();i.crossOrigin='anonymous';i.onload=()=>res(i);i.onerror=()=>rej(new Error(`Failed fish sprite ${path}`));i.src=path});
    imgCache.set(path,p);return p;
  }

  async function layer(path,color) {
    const i=await load(path),c=document.createElement('canvas');c.width=i.naturalWidth;c.height=i.naturalHeight;const x=c.getContext('2d');x.drawImage(i,0,0);const d=x.getImageData(0,0,c.width,c.height),t=rgbHsv(...hexRgb(color));
    for(let n=0;n<d.data.length;n+=4){if(!d.data[n+3])continue;const v=rgbHsv(d.data[n],d.data[n+1],d.data[n+2])[2],[r,g,b]=hsvRgb(t[0],t[1],v);d.data[n]=r;d.data[n+1]=g;d.data[n+2]=b}x.putImageData(d,0,0);return c;
  }

  async function render(path,f) {
    const i=await load(path),c=document.createElement('canvas');c.width=i.naturalWidth;c.height=i.naturalHeight;const x=c.getContext('2d');x.drawImage(i,0,0);
    if(f.species==='sixfin'){x.drawImage(await layer('assets/objectsprites/fish_patterns/base.png',f.patterns.base),0,0,c.width,c.height);x.drawImage(await layer('assets/objectsprites/fish_patterns/stripes.png',f.patterns.stripes),0,0,c.width,c.height);}else{const d=x.getImageData(0,0,c.width,c.height);recolorBase(d,f);x.putImageData(d,0,0)}
    return c;
  }

  function getRecoloredCanvas(path,key) {
    const f=byKey.get(key);if(!f)return Promise.reject(new Error(`Unknown authored fish ${key}`));const k=`${key}|${path}`;
    if(!canvasCache.has(k))canvasCache.set(k,render(path,f).catch(e=>{canvasCache.delete(k);throw e}));return canvasCache.get(k);
  }

  let capturedFishingDeps = null;
  function wrap(api) {
    if(!api?.init||api.__fishCatalogWrapped)return api;
    const init=api.init;
    api.init=d=>{
      capturedFishingDeps={...(capturedFishingDeps||{}),...(d||{}),FISH_DEFS:buildFishingDefs()};
      return init(capturedFishingDeps);
    };
    Object.defineProperty(api,'__fishCatalogWrapped',{value:true,configurable:true});
    return api;
  }

  function hookFishing() {
    const d=Object.getOwnPropertyDescriptor(window,'Fishing');
    if(d&&!d.configurable){wrap(window.Fishing);return;}
    let cur=wrap(window.Fishing);
    Object.defineProperty(window,'Fishing',{configurable:true,enumerable:true,get:()=>cur,set:v=>{cur=wrap(v)}});
  }

  function registerItems() {
    let n=0;
    const go=()=>{if(window.ShippingPanel?.registerItemDefinitions?.(buildItemDefs(),buildBasePrices())===true){window.__farmLog?.(`[fish-catalog] registered ${FISH.length} authored fish`,'items');return}if(n++<200)setTimeout(go,50);else console.warn('[fish-catalog] item bridge unavailable')};
    go();
  }

  function configureCatchCamera() {
    const cfg=window.SCRATCHBONES_CONFIG?.game?.camera?.modes?.fishCatch;
    if(!cfg)return;
    cfg.distanceTiles=5.6;            // 7 / 1.25: 25% tighter magnification
    cfg.angleFromGroundDeg=0;        // camera is horizontally level with the displayed fish
    cfg.targetYOffsetTiles=0.9;      // held-fish/chest presentation height
  }

  function curveCacheSet(key,value) {
    curveCache.set(key,value);
    while(curveCache.size>CURVE_CACHE_LIMIT)curveCache.delete(curveCache.keys().next().value);
  }

  // Treat the already-animated straight silhouette as a waveform, then map that
  // entire local coordinate frame onto the ring. Each source slice is carried
  // to a point on the circular centerline and its x/y basis is rotated into the
  // ring tangent/normal. Because the original spline wiggle/shear is already in
  // the raster, it is preserved continuously instead of being offset after the
  // fact (which made the wiggle appear to snap as the fish rounded the ring).
  function curveSilhouetteDataUrl(sourceHref, scaleX, scaleY) {
    const sxScale=Math.max(.2,Number(scaleX)||1);
    const syScale=Math.max(.2,Number(scaleY)||1);
    const cacheKey=`${sxScale.toFixed(3)}|${syScale.toFixed(3)}|${sourceHref}`;
    if(curveCache.has(cacheKey))return Promise.resolve(curveCache.get(cacheKey));

    return new Promise((resolve,reject)=>{
      const img=new Image();
      img.onload=()=>{
        const canvas=document.createElement('canvas');
        canvas.width=img.naturalWidth;
        canvas.height=img.naturalHeight;
        const ctx=canvas.getContext('2d');
        ctx.imageSmoothingEnabled=true;

        const slices=28;
        const sw=img.naturalWidth/slices;
        const dw=canvas.width/slices;
        const centerX=canvas.width/2;
        const centerY=canvas.height/2;

        for(let i=0;i<slices;i++){
          const sourceCenter=(i+0.5)*sw;
          // Arc length is measured after the authored width scale, so a long
          // Rockscale genuinely occupies more of the ring than a compact Gurumahi.
          const arcLength=(sourceCenter-centerX)*sxScale;
          const theta=arcLength/FISH_RING_RADIUS;
          const sinT=Math.sin(theta);
          const cosT=Math.cos(theta);

          // Circle in final screen-space, converted back to the unscaled image's
          // coordinates because the SVG applies sx/sy after this raster warp.
          const arcScreenX=FISH_RING_RADIUS*sinT;
          const arcScreenY=FISH_RING_RADIUS*(1-cosT);
          const destCenterX=centerX+arcScreenX/sxScale;
          const destCenterY=centerY+arcScreenY/syScale;

          // This compensated affine basis is important when width != height:
          // after the SVG's anisotropic scale, +X lies exactly on the circle's
          // tangent and +Y exactly on its inward normal. The original animated
          // spline therefore bends with the ring rather than sliding vertically.
          const a=cosT;
          const b=sinT*sxScale/syScale;
          const c=-sinT*syScale/sxScale;
          const d=cosT;

          ctx.save();
          ctx.translate(destCenterX,destCenterY);
          ctx.transform(a,b,c,d,0,0);
          ctx.drawImage(
            img,
            i*sw,0,sw+1,img.naturalHeight,
            -dw/2-0.75,-img.naturalHeight/2,dw+1.5,img.naturalHeight
          );
          ctx.restore();
        }

        try{
          const url=canvas.toDataURL('image/png');
          curveCacheSet(cacheKey,url);
          resolve(url);
        }catch(e){reject(e);}
      };
      img.onerror=()=>reject(new Error('Failed to curve fish silhouette frame'));
      img.src=sourceHref;
    });
  }

  let observedFishImage=null, curveObserver=null;
  let lastWarpSource=null,lastWarpedHref=null;
  let warpBusy=false;
  const warpQueue=[];
  const MAX_WARP_QUEUE=3;

  function observeCurvedSilhouette(image) {
    if (image === observedFishImage) return;

    curveObserver?.disconnect();
    observedFishImage=image;
    lastWarpSource=null;
    lastWarpedHref=null;
    warpBusy=false;
    warpQueue.length=0;
    if (!image) return;

    const observe=()=>curveObserver?.observe(image,{attributes:true,attributeFilter:['href']});
    const setHrefWithoutObserving=(href)=>{
      curveObserver.disconnect();
      image.setAttribute('href',href);
      observe();
    };

    const processQueue=()=>{
      if(warpBusy||!warpQueue.length||image!==observedFishImage)return;
      const job=warpQueue.shift();
      warpBusy=true;

      curveSilhouetteDataUrl(job.source,job.sx,job.sy).then(curved=>{
        if(image!==observedFishImage)return;
        lastWarpedHref=curved;
        setHrefWithoutObserving(curved);
      }).catch(()=>{}).finally(()=>{
        warpBusy=false;
        if(image===observedFishImage&&warpQueue.length)processQueue();
      });
    };

    curveObserver=new MutationObserver(()=>{
      const state=window.Fishing?.state, fishDef=state?.fishDef;
      if(state?.phase!=='active'||!fishDef)return;
      const source=image.getAttribute('href')||'';
      if(!source.startsWith('data:image')||source===lastWarpedHref||source===lastWarpSource)return;

      const sx=Math.max(.2,Number(fishDef.minigameScaleX ?? fishDef.minigameScale ?? 1)||1);
      const sy=Math.max(.2,Number(fishDef.minigameScaleY ?? fishDef.minigameScale ?? 1)||1);
      lastWarpSource=source;

      // Preserve source-frame order. The previous generation-cancel approach
      // could discard an in-flight spline frame whenever the next 12fps texture
      // arrived, which made a smooth sine motion visibly jump ahead.
      warpQueue.push({source,sx,sy});
      if(warpQueue.length>MAX_WARP_QUEUE){
        warpQueue.splice(0,warpQueue.length-MAX_WARP_QUEUE);
      }

      // Never flash a straight frame while its curved version is being decoded.
      if(lastWarpedHref)setHrefWithoutObserving(lastWarpedHref);
      processQueue();
    });

    observe();
  }

  function presentationLoop() {
    const state=window.Fishing?.state, fishDef=state?.fishDef, image=document.getElementById('fishDeformedImage');
    observeCurvedSilhouette(image);
    if(image&&fishDef){
      const sx=Math.max(.2,Number(fishDef.minigameScaleX ?? fishDef.minigameScale ?? 1)||1);
      const sy=Math.max(.2,Number(fishDef.minigameScaleY ?? fishDef.minigameScale ?? 1)||1);
      image.style.transformBox='fill-box';
      image.style.transformOrigin='center';
      image.style.transform=`scale(${sx},${sy})`;
      if(state?.phase!=='active'&&(lastWarpSource||lastWarpedHref||warpQueue.length)){
        lastWarpSource=null;
        lastWarpedHref=null;
        warpQueue.length=0;
      }
    }
    requestAnimationFrame(presentationLoop);
  }

  window.FishCatalog={entries:FISH,get:k=>byKey.get(k)||null,buildFishingDefs,buildItemDefs,getRecoloredCanvas};
  configureCatchCamera();
  hookFishing();
  registerItems();
  requestAnimationFrame(presentationLoop);
})();