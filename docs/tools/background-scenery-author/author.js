'use strict';
const $ = id => document.getElementById(id);
const Core = window.BackgroundScenery;
const canvas = $('canvas'), ctx = canvas.getContext('2d');
const state = { map:null, liveMapRef:null, liveMapWindow:null, scenery:null, attachments:[], selectedId:null, selectedPoint:-1, cam:{x:0,y:0,zoom:10}, drag:null, pointers:new Map(), pinch:null, horizonFieldCache:null, horizonBrushDirty:false };
const logLines=[];
function log(msg){const line=`[${new Date().toLocaleTimeString()}] ${msg}`;logLines.unshift(line);logLines.splice(80);$('debug').textContent=logLines.join('\n');}
function clone(v){return JSON.parse(JSON.stringify(v));}
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function normalizeMap(raw){
  if (!raw || typeof raw!=='object') throw new Error('Map JSON is not an object.');
  const m=clone(raw); if (!Number.isFinite(m.cols)||!Number.isFinite(m.rows)) throw new Error('Map is missing cols/rows.');
  m.routes=Array.isArray(m.routes)?m.routes:[];m.rivers=Array.isArray(m.rivers)?m.rivers:[];m.tiles=m.tiles||{};return m;
}
function sourceConfig(){return state.map?.backgroundScenery||{};}
function loadMap(raw,{liveRef=null,liveWindow=null,label='map'}={}){
  state.map=normalizeMap(raw);state.liveMapRef=liveRef;state.liveMapWindow=liveWindow;state.horizonFieldCache=null;state.horizonBrushDirty=false;
  state.scenery=Core.resolveConfig(state.map);state.map.backgroundScenery=state.scenery;syncAttachments();fillGlobals();fit();
  $('mapPill').textContent=`${state.map.name||state.map.id||label} · ${state.map.cols}×${state.map.rows}`;
  log(`Loaded ${label}: ${state.attachments.length} live edge attachment(s).`);draw();
}
function mapEditorAccess(){
  try{const frame=parent?.document?.getElementById('if-map-editor');const win=frame?.contentWindow;const bridge=win?._mapEditorBridge;const ws=bridge?.getWorkspace?.();if(!ws)return null;const map=ws.maps?.find(m=>m.id===ws.activeId)||ws.maps?.[0];return map?{map,win,ws}:null;}catch(e){return null;}
}
function loadLive(){const a=mapEditorAccess();if(!a){log('Map Editor live bridge unavailable. Open this tool from docs/tools/index.html or load a map file.');return;}loadMap(a.map,{liveRef:a.map,liveWindow:a.win,label:'Map Editor live'});}
async function loadTown(){try{const r=await fetch('../../config/maps/hobunji_hollow_town.map.json');if(!r.ok)throw new Error(`HTTP ${r.status}`);loadMap(await r.json(),{label:'repository town'});}catch(e){log(`Town load failed: ${e.message}`);}}
function syncAttachments(){
  if(!state.map)return;state.attachments=Core.collectBoundaryAttachments(state.map);
  const valid=new Set(state.attachments.map(a=>a.id));
  const saved=state.scenery.attachments||{};
  for(const [id,cfg] of Object.entries(saved)) if(!valid.has(id)) state.attachments.push({id,orphan:true,kind:'orphan',sourceLabel:id,edge:cfg.edge||'?',candidateEdges:[]});
  if(!state.attachments.some(a=>a.id===state.selectedId))state.selectedId=state.attachments.find(a=>!a.orphan)?.id||state.attachments[0]?.id||null;
  renderAttachmentList();fillSelected();
}
function selected(){return state.attachments.find(a=>a.id===state.selectedId)||null;}
function overrideFor(id,create=true){if(!state.scenery.attachments)state.scenery.attachments={};if(!state.scenery.attachments[id]&&create)state.scenery.attachments[id]={};return state.scenery.attachments[id]||null;}
function effective(a){return Core.resolveAttachmentSettings(a,state.scenery,overrideFor(a.id,false)||{});}
function renderAttachmentList(){
  $('attachCount').textContent=String(state.attachments.filter(a=>!a.orphan).length);
  $('attachList').innerHTML=state.attachments.length?state.attachments.map(a=>{
    if(a.orphan)return `<div class="attach orphan ${a.id===state.selectedId?'sel':''}" data-id="${escapeHtml(a.id)}"><div class="attachTitle">⚠ Orphaned override</div><div class="attachMeta">${escapeHtml(a.id)} · select then use Reset stale override</div></div>`;
    const e=effective(a);const icon=a.kind==='route'?'🛤':'🌊';return `<div class="attach ${a.id===state.selectedId?'sel':''}" data-id="${escapeHtml(a.id)}"><div class="attachTitle">${icon} ${escapeHtml(a.sourceLabel)} · ${escapeHtml(e.edge)}</div><div class="attachMeta">${escapeHtml(a.kind)} · node ${a.nodeIndex+1} · width ${a.width} · ${e.enabled?'enabled':'disabled'}</div></div>`;
  }).join(''):'<div class="muted">No spline control point currently touches an edge tile.</div>';
  $('attachList').querySelectorAll('.attach').forEach(el=>el.onclick=()=>{state.selectedId=el.dataset.id;state.selectedPoint=-1;renderAttachmentList();fillSelected();draw();});
  const orphan=selected()?.orphan;$('removeOrphan').style.display=orphan?'':'none';
}
function escapeHtml(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function fillGlobals(){const s=state.scenery;if(!s)return;for(const [id,key] of [['ridgeClearance','ridgeClearanceTiles'],['borderDepth','borderDepthTiles'],['defaultLength','defaultExtensionLengthTiles']]){$(id).value=s[key];$(id+'Out').textContent=Number(s[key]).toFixed(id==='ridgeClearance'?2:0)+'t';}$('routeShoulder').value=s.routeShoulderTiles;$('riverBank').value=s.riverBankTiles;$('riverDepth').value=s.riverChannelDepth;$('waterfallThreshold').value=s.waterfallThreshold;fillHorizonControls();}

function horizonTerrain(){
  const cfg=state.scenery?.horizonTerrain; // Used by all horizon controls and the 2D author overlay.
  return cfg||Core?.normalizeHorizonTerrain?.({preset:'none'},state.map?.id||'')||{enabled:false,preset:'none'};
}
function invalidateHorizonField(){state.horizonFieldCache=null;}
function currentMountainField(){
  const cfg=horizonTerrain();
  if(!state.map||!cfg.enabled||cfg.kind!=='mountainChain'||!Core?.buildMountainPlateauField)return null;
  if(!state.horizonFieldCache)state.horizonFieldCache=Core.buildMountainPlateauField(state.map.cols,state.map.rows,state.map.id||'',cfg);
  return state.horizonFieldCache;
}
function horizonBudget(cfg){
  const segments=Math.max(3,Math.round(Number(cfg?.segments)||3));
  if(cfg?.kind==='mountainChain'){
    const field=currentMountainField();
    if(!field)return{vertices:0,triangles:0,rows:2,peakCount:segments*2-1,mountainLayers:0,activeTiles:0,lockedCount:0};
    let vertices=0,triangles=0;
    for(const tier of field.tierStats){
      const w=tier.maxC-tier.minC+1,h=tier.maxR-tier.minR+1;
      vertices+=(w*2+1)*(h*2+1); // Exact BufferGeometry position count allocated by regular buildPlateauMesa for this tier bbox.
      triangles+=tier.tiles*8; // Every ordinary synthetic plateau tile contributes four half-tile quads = eight triangles.
    }
    return{
      vertices,triangles,rows:2,peakCount:field.peakCount,
      frontPeakCount:field.frontPeakCount,backPeakCount:field.backPeakCount,
      mountainLayers:field.maxTier,activeTiles:field.activeTiles,lockedCount:field.lockedCount,
      fieldCols:field.cols,fieldRows:field.rows,meshCount:field.mesas.length,
    };
  }
  const rows=4;
  return{vertices:(segments+1)*rows,triangles:segments*2*(rows-1),rows:1,peakCount:0,mountainLayers:0,activeTiles:0,lockedCount:0};
}
function fillHorizonControls(){
  if(!$('horizonPreset'))return;
  const cfg=horizonTerrain();
  const budget=horizonBudget(cfg);
  const isMountain=cfg.kind==='mountainChain';
  const granularity=Math.max(0,Math.min(100,Math.round(Number(cfg.mountainGranularity)||0)));
  const quality=Core?.mountainGranularitySettings?.(granularity)||{cols:0,rows:0,tierCap:0};
  $('horizonEnabled').checked=!!cfg.enabled;
  $('horizonPreset').value=cfg.preset||'none';
  $('horizonSide').value=cfg.side||'north';
  $('horizonHeight').value=Number(cfg.heightWorld)||0;
  $('horizonHeightStart').value=Number(cfg.heightStartWorld)||Number(cfg.heightWorld)||0;
  $('horizonHeightEnd').value=Number(cfg.heightEndWorld)||Number(cfg.heightWorld)||0;
  $('horizonDistance').value=Number(cfg.distanceWorld)||0;
  $('horizonDepth').value=Number(cfg.depthWorld)||0;
  $('horizonSpan').value=Number(cfg.spanScale)||1;
  $('horizonOverallScale').value=Number(cfg.overallScale)||1;
  $('horizonSegments').value=Math.round(Number(cfg.segments)||3);
  $('horizonGranularity').value=granularity;
  $('horizonGranularityNumber').value=granularity;
  $('horizonGranularityOut').textContent=`${granularity} / 100`;
  $('horizonGranularityHint').textContent=granularity<=10?'Very coarse / fastest':granularity<=30?'Coarse / fast':granularity<=65?'Balanced':granularity<=85?'Fine / expensive':'Maximum detail / very expensive';
  const side=cfg.side||'west';
  $('horizonHeightStartLabel').textContent=(side==='west'||side==='east')?'North / start height':'West / start height';
  $('horizonHeightEndLabel').textContent=(side==='west'||side==='east')?'South / end height':'East / end height';
  $('horizonHeightField').style.display=isMountain?'none':'';
  $('horizonMountainHeightFields').style.display=isMountain?'':'none';
  $('horizonGranularityField').style.display=isMountain?'':'none';
  $('horizonLockTools').style.display=isMountain?'':'none';
  $('horizonRandomize').style.display=isMountain?'':'none';
  $('horizonLockCount').textContent=`${budget.lockedCount||0} locked tile${budget.lockedCount===1?'':'s'}`;
  $('horizonStats').textContent=cfg.enabled
    ? `${cfg.kind==='plateau'
      ? 'Plateau'
      : `Shared plateau mountain map · granularity ${granularity}/100 → ${budget.fieldCols||quality.cols}×${budget.fieldRows||quality.rows} synthetic tiles / ${budget.mountainLayers} active of ${quality.tierCap} allowed tiers · ${budget.peakCount} generating masses → ${budget.meshCount} merged tier mesh${budget.meshCount===1?'':'es'} · north/start ${Number(cfg.heightStartWorld).toFixed(1)}u → south/end ${Number(cfg.heightEndWorld).toFixed(1)}u · seed ${cfg.mountainSeed}`} · ~${Math.round(budget.vertices).toLocaleString()} vertices / ${Math.round(budget.triangles).toLocaleString()} triangles · ${(Number(cfg.spanScale)||1).toFixed(2)}× span · ${(Number(cfg.overallScale)||1).toFixed(2)}× whole scale · ${cfg.alwaysVisible?'always submitted':'frustum culled'} · ${cfg.fogIndependent?'fog independent':'uses scene fog'}`
    : 'No colossal horizon terrain.';
}
function announceHorizonChange(reason){
  state.map.backgroundScenery=state.scenery;
  const detail={reason,horizonTerrain:clone(horizonTerrain())}; // Used by the 3D preview to rebuild from the same authored config.
  window.dispatchEvent(new CustomEvent('hobunji-background-scenery-author-change',{detail}));
}
function replaceHorizonPreset(preset,reason='horizon-preset'){
  if(!state.scenery||!state.map)return;
  const fallback=Core?.HORIZON_DEFAULT_BY_MAP?.[state.map.id]||'westernMountainChain'; // Used when enabling a map that has no canonical horizon preset.
  const requested=preset==='none'?'none':(preset||fallback); // Used to keep the explicit Clear state from falling back to a zone default.
  state.scenery.horizonTerrain=Core.normalizeHorizonTerrain({preset:requested,enabled:requested!=='none'},state.map.id);
  invalidateHorizonField();fillHorizonControls();draw();announceHorizonChange(reason);
}
function updateHorizon(mutator,reason='horizon-setting'){
  if(!state.scenery||!state.map)return;
  const current=horizonTerrain(); // Used as the immutable source for one sidebar edit.
  const fallback=Core?.HORIZON_DEFAULT_BY_MAP?.[state.map.id]||'westernMountainChain'; // Used if a disabled/empty config is edited directly.
  const draft=current.preset&&current.preset!=='none'?{...current}:{...Core.normalizeHorizonTerrain({preset:fallback},state.map.id)}; // Used as the normalized edit target.
  mutator(draft);
  state.scenery.horizonTerrain=Core.normalizeHorizonTerrain(draft,state.map.id);
  invalidateHorizonField();fillHorizonControls();draw();announceHorizonChange(reason);
}
function fillSelected(){
  const a=selected();$('editSection').style.display=a?'':'none';if(!a)return;
  const o=overrideFor(a.id,false)||{};
  if(a.orphan){$('editSection').style.display='none';return;}
  const e=effective(a);$('enabled').checked=e.enabled;$('edge').innerHTML=a.candidateEdges.map(x=>`<option ${x===e.edge?'selected':''}>${x}</option>`).join('');$('length').value=e.lengthTiles;$('widthScale').value=e.widthScale;
  const isRiver=a.kind==='river';$('specialLabel').textContent=isRiver?'Bank width':'Path shoulder';$('specialValue').value=isRiver?e.bankTiles:e.shoulderTiles;$('riverDepthField').style.display=isRiver?'':'none';$('attachRiverDepth').value=Number.isFinite(o.channelDepth)?o.channelDepth:'';
  $('inherited').innerHTML=`Source <b>${escapeHtml(a.sourceLabel)}</b><br>type: ${escapeHtml(a.sourceType)} · width: ${a.width}${a.kind==='river'?` · seed: ${a.seed}`:''}<br>attach: (${pointsFor(a)[0][0].toFixed(2)}, ${pointsFor(a)[0][1].toFixed(2)}) · tangent inherited from playable spline`;
}
function updateOverride(fn){const a=selected();if(!a||a.orphan)return;const o=overrideFor(a.id);fn(o,a);state.map.backgroundScenery=state.scenery;renderAttachmentList();fillSelected();draw();}
function pointsFor(a){return Core.buildContinuationPolyline(a,state.scenery,overrideFor(a.id,false)||{});}
function materializePoints(a){const o=overrideFor(a.id);if(!Array.isArray(o.controlPoints)||!o.controlPoints.length)o.controlPoints=pointsFor(a).slice(1).map(p=>[p[0],p[1]]);return o.controlPoints;}
function constrainPoint(p,edge){let [x,y]=p;const m=state.map;if(x>0&&x<m.cols&&y>0&&y<m.rows){if(edge==='north')y=0;else if(edge==='south')y=m.rows;else if(edge==='west')x=0;else x=m.cols;}return [x,y];}
function addPoint(){const a=selected();if(!a||a.orphan)return;const pts=materializePoints(a);const full=pointsFor(a);const last=full[full.length-1],prev=full[full.length-2]||a.position;let dx=last[0]-prev[0],dy=last[1]-prev[1],d=Math.hypot(dx,dy)||1;dx/=d;dy/=d;pts.push(constrainPoint([last[0]+dx*4,last[1]+dy*4],effective(a).edge));state.selectedPoint=pts.length-1;draw();}
function deletePoint(){const a=selected(),o=a&&overrideFor(a.id,false);if(!a||a.orphan||!o?.controlPoints?.length||state.selectedPoint<0)return;o.controlPoints.splice(state.selectedPoint,1);state.selectedPoint=Math.min(state.selectedPoint,o.controlPoints.length-1);if(!o.controlPoints.length)delete o.controlPoints;draw();}
function resetPoints(){updateOverride(o=>{delete o.controlPoints;});state.selectedPoint=-1;}
function applyLive(){if(!state.map)return;if(!state.liveMapRef){const a=mapEditorAccess();if(a&&a.map.id===state.map.id){state.liveMapRef=a.map;state.liveMapWindow=a.win;}}if(!state.liveMapRef){log('No matching live Map Editor map. Use “Map Editor Live” first.');return;}state.liveMapRef.backgroundScenery=clone(state.scenery);try{state.liveMapWindow?.saveWorkspace?.();state.liveMapWindow?.refreshPreview?.();state.liveMapWindow?.draw?.();}catch(_){}log(`Applied backgroundScenery to live map ${state.liveMapRef.id}.`);}
function download(name,obj){const blob=new Blob([JSON.stringify(obj,null,2)+'\n'],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
function fit(){
  if(!state.map)return;resize();
  const d=Number(state.scenery?.borderDepthTiles||18)+2; // Used as the ordinary procedural background margin.
  const cfg=horizonTerrain(); // Used to include the complete colossal landmark when Fit is pressed.
  const scale=cfg?.enabled?Math.max(0.25,Number(cfg.overallScale)||1):1; // Used to mirror runtime whole-landmark scaling in the author camera.
  const spanScale=cfg?.enabled?Math.max(0.25,Number(cfg.spanScale)||1):1; // Used to include extreme north/south or east/west overscan.
  const horizontal=cfg?.side==='north'||cfg?.side==='south'; // Used to decide which map axis receives the long horizon span.
  const axisLength=horizontal?state.map.cols:state.map.rows; // Used to calculate the authored long-axis extent.
  const span=cfg?.enabled?axisLength*spanScale*scale:axisLength; // Used as the complete long-axis landmark width.
  const overscan=Math.max(0,(span-axisLength)*0.5); // Used to symmetrically include landmark overhang beyond both map ends.
  const outward=cfg?.enabled?(Math.max(0,Number(cfg.distanceWorld)||0)+Math.max(0,Number(cfg.depthWorld)||0)*scale):0; // Used to include the landmark's outward depth without scaling its edge clearance.
  const left=d+(cfg?.enabled&&cfg.side==='west'?outward:0)+(cfg?.enabled&&!horizontal?overscan:0); // Used by the fitted world rectangle's west extent.
  const right=d+(cfg?.enabled&&cfg.side==='east'?outward:0)+(cfg?.enabled&&!horizontal?overscan:0); // Used by the fitted world rectangle's east extent.
  const top=d+(cfg?.enabled&&cfg.side==='north'?outward:0)+(cfg?.enabled&&horizontal?overscan:0); // Used by the fitted world rectangle's north extent.
  const bottom=d+(cfg?.enabled&&cfg.side==='south'?outward:0)+(cfg?.enabled&&horizontal?overscan:0); // Used by the fitted world rectangle's south extent.
  const rw=state.map.cols+left+right,rh=state.map.rows+top+bottom; // Used to derive the fit zoom from the true authored footprint.
  const r=canvas.getBoundingClientRect();
  state.cam.zoom=Math.max(.25,Math.min((r.width-30)/rw,(r.height-30)/rh));
  state.cam.x=r.width/2-((state.map.cols+right-left)/2)*state.cam.zoom;
  state.cam.y=r.height/2-((state.map.rows+bottom-top)/2)*state.cam.zoom;
  draw();
}
function resize(){const r=canvas.getBoundingClientRect(),dpr=Math.min(2,devicePixelRatio||1),w=Math.max(1,Math.round(r.width*dpr)),h=Math.max(1,Math.round(r.height*dpr));if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}ctx.setTransform(dpr,0,0,dpr,0,0);}
function w2s(x,y){return{x:state.cam.x+x*state.cam.zoom,y:state.cam.y+y*state.cam.zoom};}function s2w(x,y){return{x:(x-state.cam.x)/state.cam.zoom,y:(y-state.cam.y)/state.cam.zoom};}
function tileEntries(){if(!state.map)return[];const t=state.map.tiles||{};if(Array.isArray(t))return t.map(v=>[`${v.c},${v.r}`,v]);return Object.entries(t);}
function drawHorizonTerrain2d(){
  const cfg=horizonTerrain();
  if(!cfg.enabled||!state.map)return;
  const m=state.map;
  if(cfg.kind==='mountainChain'){
    const field=currentMountainField();
    if(!field)return;
    const maxTier=Math.max(1,field.maxTier);
    ctx.save();
    // Draw the exact shared synthetic map that feeds ZonePlateauMesa. Tiles
    // get darker with elevation; cyan outlines are the user's persistent locks.
    for(let r=0;r<field.rows;r++)for(let c=0;c<field.cols;c++){
      const tier=field.tiers[r*field.cols+c];
      const locked=Object.prototype.hasOwnProperty.call(cfg.lockedTiles||{},Core.mountainFieldLockKeyForCell(field,c,r));
      if(!tier&&!locked)continue;
      const quad=Core.mountainFieldCellWorldQuad(field,c,r);
      const screen=quad.map(p=>w2s(p[0],p[1]));
      const xs=screen.map(p=>p.x),ys=screen.map(p=>p.y);
      const x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
      if(tier){
        const light=Math.round(28+42*(tier/maxTier));
        ctx.fillStyle=`hsl(210 7% ${light}%)`;
        ctx.fillRect(x0,y0,Math.max(.5,x1-x0+.25),Math.max(.5,y1-y0+.25));
      }
      if(locked){
        ctx.strokeStyle='#67e8f9';
        ctx.lineWidth=Math.max(1,Math.min(3,state.cam.zoom*.08));
        ctx.strokeRect(x0+.5,y0+.5,Math.max(1,x1-x0-1),Math.max(1,y1-y0-1));
      }
    }
    const p0=Core.mountainFieldWorldPoint(field,0,0),p1=Core.mountainFieldWorldPoint(field,field.cols,field.rows);
    const s0=w2s(p0[0],p0[1]),s1=w2s(p1[0],p1[1]);
    ctx.strokeStyle='rgba(226,232,240,.85)';ctx.lineWidth=2;ctx.setLineDash([7,5]);
    ctx.strokeRect(Math.min(s0.x,s1.x),Math.min(s0.y,s1.y),Math.abs(s1.x-s0.x),Math.abs(s1.y-s0.y));ctx.setLineDash([]);
    const mid=Core.mountainFieldWorldPoint(field,field.cols/2,field.rows/2),ms=w2s(mid[0],mid[1]);
    ctx.fillStyle='#eef5ff';ctx.font='700 11px system-ui';ctx.textAlign='center';
    ctx.fillText(`SHARED PLATEAU MAP · ${field.cols}×${field.rows} · ${field.maxTier} TIERS · G${field.granularity}`,ms.x,ms.y);
    ctx.restore();
    return;
  }

  const horizontal=cfg.side==='north'||cfg.side==='south';
  const axisLength=horizontal?m.cols:m.rows;
  const overallScale=Math.max(0.25,Number(cfg.overallScale)||1);
  const span=axisLength*Math.max(0.25,Number(cfg.spanScale)||1)*overallScale;
  const start=(axisLength-span)*0.5,end=start+span;
  const near=Math.max(0,Number(cfg.distanceWorld)||0),far=near+Math.max(1,Number(cfg.depthWorld)||1)*overallScale;
  const worldPoint=(axis,out)=>{
    if(cfg.side==='north')return[axis,-out];
    if(cfg.side==='south')return[axis,m.rows+out];
    if(cfg.side==='west')return[-out,axis];
    return[m.cols+out,axis];
  };
  const corners=[worldPoint(start,near),worldPoint(end,near),worldPoint(end,far),worldPoint(start,far)];
  ctx.save();ctx.beginPath();
  corners.forEach((p,i)=>{const s=w2s(p[0],p[1]);i?ctx.lineTo(s.x,s.y):ctx.moveTo(s.x,s.y);});
  ctx.closePath();ctx.fillStyle='rgba(167,139,250,.20)';ctx.strokeStyle='rgba(196,181,253,.82)';ctx.lineWidth=2;ctx.fill();ctx.stroke();
  const mid=worldPoint((start+end)*0.5,(near+far)*0.5),ms=w2s(mid[0],mid[1]);
  ctx.fillStyle='#eef5ff';ctx.font='700 11px system-ui';ctx.textAlign='center';ctx.fillText('HUMONGOUS PLATEAU',ms.x,ms.y);ctx.restore();
}

function paintHorizonLockAtWorld(worldX,worldZ){
  const mode=$('horizonBrushMode')?.value||'pan';
  if(mode!=='lock'&&mode!=='unlock')return false;
  const field=currentMountainField();
  const lockCell=field&&Core.mountainFieldWorldToLockCell(field,worldX,worldZ);
  if(!field||!lockCell)return false;
  const radius=Math.max(1,Math.min(8,Math.round(Number($('horizonBrushRadius')?.value)||1)));
  const cfg=horizonTerrain();
  const locked={...(cfg.lockedTiles||{})};
  let changed=false;
  for(let dr=-radius+1;dr<=radius-1;dr++)for(let dc=-radius+1;dc<=radius-1;dc++){
    if(dc*dc+dr*dr>(radius-.35)*(radius-.35))continue;
    const lc=lockCell.c+dc,lr=lockCell.r+dr;
    if(lc<0||lr<0||lc>=field.lockSpaceCols||lr>=field.lockSpaceRows)continue;
    const key=`${lc},${lr}`;
    if(mode==='lock'){
      const sample=Core.mountainFieldCellForLockCell(field,lc,lr);
      const tier=field.tiers[sample.r*field.cols+sample.c];
      const value={height01:field.maxTier?Math.max(0,Math.min(1,tier/field.maxTier)):0};
      const old=locked[key];
      if(!old||typeof old!=='object'||Math.abs(Number(old.height01)-value.height01)>1e-6){locked[key]=value;changed=true;}
    }else if(Object.prototype.hasOwnProperty.call(locked,key)){delete locked[key];changed=true;}
  }
  if(!changed)return true;
  state.scenery.horizonTerrain=Core.normalizeHorizonTerrain({...cfg,lockedTiles:locked},state.map.id);
  state.map.backgroundScenery=state.scenery;
  invalidateHorizonField();
  state.horizonBrushDirty=true;
  const count=Object.keys(state.scenery.horizonTerrain.lockedTiles||{}).length;
  $('horizonLockCount').textContent=`${count} locked tile${count===1?'':'s'}`;
  draw();
  return true;
}
function draw(){resize();const r=canvas.getBoundingClientRect();ctx.clearRect(0,0,r.width,r.height);if(!state.map)return;const z=state.cam.zoom,m=state.map,d=Number(state.scenery.borderDepthTiles||18);
  const bg0=w2s(-d,-d),bg1=w2s(m.cols+d,m.rows+d);ctx.fillStyle='#18251f';ctx.fillRect(bg0.x,bg0.y,bg1.x-bg0.x,bg1.y-bg0.y);
  drawHorizonTerrain2d();
  const clear=Number(state.scenery.ridgeClearanceTiles||0);ctx.save();ctx.strokeStyle='rgba(180,190,198,.46)';ctx.lineWidth=Math.max(1,Math.min(10,(d-clear)*z));const inset=(clear+(d-clear)/2);const p0=w2s(-inset,-inset),p1=w2s(m.cols+inset,m.rows+inset);ctx.strokeRect(p0.x,p0.y,p1.x-p0.x,p1.y-p0.y);ctx.restore();
  const a=w2s(0,0),b=w2s(m.cols,m.rows);ctx.fillStyle='#254524';ctx.fillRect(a.x,a.y,b.x-a.x,b.y-a.y);
  if(z>3){for(const [key,t] of tileEntries()){let c,r0;if(Array.isArray(t)&&Number.isFinite(t.c)){c=t.c;r0=t.r;}else [c,r0]=key.split(',').map(Number);if(!Number.isFinite(c)||!Number.isFinite(r0))continue;const type=t.type||'grass';if(type!=='path'&&type!=='river'&&type!=='stream'&&type!=='waterfall')continue;const p=w2s(c,r0);ctx.fillStyle=type==='path'?'#9f8357':'#397f98';ctx.fillRect(p.x,p.y,z+0.5,z+0.5);}}
  ctx.strokeStyle='rgba(255,255,255,.5)';ctx.lineWidth=2;ctx.strokeRect(a.x,a.y,b.x-a.x,b.y-a.y);
  for(const att of state.attachments){if(att.orphan)continue;const e=effective(att);if(!e.enabled)continue;const pts=pointsFor(att);ctx.beginPath();pts.forEach((p,i)=>{const s=w2s(p[0],p[1]);i?ctx.lineTo(s.x,s.y):ctx.moveTo(s.x,s.y);});ctx.strokeStyle=att.kind==='route'?'#d8b77c':'#55b7d3';ctx.lineWidth=Math.max(2,Math.min(12,att.width*e.widthScale*z*.18));ctx.stroke();
    const hp0=pointsFor(att)[0];const hp=w2s(hp0[0],hp0[1]);ctx.beginPath();ctx.arc(hp.x,hp.y,att.id===state.selectedId?7:5,0,Math.PI*2);ctx.fillStyle='#fb7185';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=1;ctx.stroke();
    if(att.id===state.selectedId){const o=overrideFor(att.id,false);const cp=(o?.controlPoints?.length?o.controlPoints:pts.slice(1));cp.forEach((p,i)=>{const s=w2s(p[0],p[1]);ctx.beginPath();ctx.arc(s.x,s.y,i===state.selectedPoint?7:5,0,Math.PI*2);ctx.fillStyle='#6aa7ff';ctx.fill();ctx.strokeStyle='#fff';ctx.stroke();});}
  }
}
function hitControl(sx,sy){const a=selected();if(!a||a.orphan)return null;const o=overrideFor(a.id,false);const full=pointsFor(a),cp=o?.controlPoints?.length?o.controlPoints:full.slice(1);for(let i=cp.length-1;i>=0;i--){const s=w2s(cp[i][0],cp[i][1]);if(Math.hypot(sx-s.x,sy-s.y)<=12)return i;}return null;}
function pt(e){const r=canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};}
canvas.addEventListener('pointerdown',e=>{
  canvas.setPointerCapture(e.pointerId);
  const p=pt(e);state.pointers.set(e.pointerId,p);
  if(state.pointers.size===2){
    const ar=[...state.pointers.values()],mid={x:(ar[0].x+ar[1].x)/2,y:(ar[0].y+ar[1].y)/2};
    state.pinch={dist:Math.hypot(ar[0].x-ar[1].x,ar[0].y-ar[1].y),zoom:state.cam.zoom,x:state.cam.x,y:state.cam.y,mid};return;
  }
  const w=s2w(p.x,p.y);
  if(paintHorizonLockAtWorld(w.x,w.y)){state.drag={type:'horizon-brush'};return;}
  const h=hitControl(p.x,p.y);
  if(h!==null){const a=selected();materializePoints(a);state.selectedPoint=h;state.drag={type:'point',index:h};draw();}
  else state.drag={type:'pan',p,x:state.cam.x,y:state.cam.y};
});
canvas.addEventListener('pointermove',e=>{
  const p=pt(e);state.pointers.set(e.pointerId,p);const w=s2w(p.x,p.y);
  const field=currentMountainField(),cell=field&&Core.mountainFieldWorldToCell(field,w.x,w.y);
  const lockCell=field&&Core.mountainFieldWorldToLockCell(field,w.x,w.y);$('cursor').textContent=cell?`${w.x.toFixed(1)}, ${w.y.toFixed(1)} · mountain tile ${cell.c},${cell.r} · tier ${field.tiers[cell.r*field.cols+cell.c]} · lock ${lockCell.c},${lockCell.r}`:`${w.x.toFixed(1)}, ${w.y.toFixed(1)}`;
  if(state.pointers.size===2&&state.pinch){
    const ar=[...state.pointers.values()],dist=Math.hypot(ar[0].x-ar[1].x,ar[0].y-ar[1].y),mid={x:(ar[0].x+ar[1].x)/2,y:(ar[0].y+ar[1].y)/2};
    const nz=clamp(state.pinch.zoom*dist/Math.max(1,state.pinch.dist),2,80),wx=(state.pinch.mid.x-state.pinch.x)/state.pinch.zoom,wy=(state.pinch.mid.y-state.pinch.y)/state.pinch.zoom;
    state.cam.zoom=nz;state.cam.x=mid.x-wx*nz;state.cam.y=mid.y-wy*nz;draw();return;
  }
  if(!state.drag)return;
  if(state.drag.type==='horizon-brush'){paintHorizonLockAtWorld(w.x,w.y);return;}
  if(state.drag.type==='pan'){state.cam.x=state.drag.x+p.x-state.drag.p.x;state.cam.y=state.drag.y+p.y-state.drag.p.y;draw();return;}
  const a=selected(),o=overrideFor(a.id),ww=s2w(p.x,p.y);o.controlPoints[state.drag.index]=constrainPoint([Math.round(ww.x*4)/4,Math.round(ww.y*4)/4],effective(a).edge);draw();
});
function end(e){
  state.pointers.delete(e.pointerId);
  if(state.pointers.size<2)state.pinch=null;
  const wasBrush=state.drag?.type==='horizon-brush';
  state.drag=null;
  if(wasBrush&&state.horizonBrushDirty){
    state.horizonBrushDirty=false;
    fillHorizonControls();
    announceHorizonChange('horizon-lock-brush');
  }
}
canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end);
canvas.addEventListener('wheel',e=>{e.preventDefault();const p=pt(e),old=state.cam.zoom,nz=clamp(old*(e.deltaY<0?1.12:.89),2,80),w=s2w(p.x,p.y);state.cam.zoom=nz;state.cam.x=p.x-w.x*nz;state.cam.y=p.y-w.y*nz;draw();},{passive:false});
window.addEventListener('resize',draw);
for(const [id,key] of [['ridgeClearance','ridgeClearanceTiles'],['borderDepth','borderDepthTiles'],['defaultLength','defaultExtensionLengthTiles']])$(id).addEventListener('input',()=>{if(!state.scenery)return;state.scenery[key]=Number($(id).value);$(id+'Out').textContent=Number($(id).value).toFixed(id==='ridgeClearance'?2:0)+'t';draw();});
for(const [id,key] of [['routeShoulder','routeShoulderTiles'],['riverBank','riverBankTiles'],['riverDepth','riverChannelDepth'],['waterfallThreshold','waterfallThreshold']])$(id).addEventListener('change',()=>{if(!state.scenery)return;state.scenery[key]=Number($(id).value);draw();fillSelected();});
$('horizonEnabled').onchange=()=>{if($('horizonEnabled').checked){const preset=horizonTerrain().preset==='none'?(Core?.HORIZON_DEFAULT_BY_MAP?.[state.map?.id]||'westernMountainChain'):horizonTerrain().preset;replaceHorizonPreset(preset,'horizon-enabled');}else updateHorizon(o=>o.enabled=false,'horizon-enabled');};
$('horizonPreset').onchange=()=>replaceHorizonPreset($('horizonPreset').value,'horizon-preset');
$('horizonSide').onchange=()=>updateHorizon(o=>o.side=$('horizonSide').value,'horizon-side');
$('horizonHeight').onchange=()=>updateHorizon(o=>o.heightWorld=Number($('horizonHeight').value),'horizon-height');
$('horizonHeightStart').onchange=()=>updateHorizon(o=>o.heightStartWorld=Number($('horizonHeightStart').value),'horizon-height-start');
$('horizonHeightEnd').onchange=()=>updateHorizon(o=>o.heightEndWorld=Number($('horizonHeightEnd').value),'horizon-height-end');
$('horizonDistance').onchange=()=>updateHorizon(o=>o.distanceWorld=Number($('horizonDistance').value),'horizon-distance');
$('horizonDepth').onchange=()=>updateHorizon(o=>o.depthWorld=Number($('horizonDepth').value),'horizon-depth');
$('horizonSpan').onchange=()=>updateHorizon(o=>o.spanScale=Number($('horizonSpan').value),'horizon-span');
$('horizonOverallScale').onchange=()=>updateHorizon(o=>o.overallScale=Number($('horizonOverallScale').value),'horizon-overall-scale');
$('horizonSegments').onchange=()=>updateHorizon(o=>o.segments=Number($('horizonSegments').value),'horizon-segments');
const setGranularity=value=>updateHorizon(o=>o.mountainGranularity=Math.max(0,Math.min(100,Math.round(Number(value)||0))),'horizon-granularity');
$('horizonGranularity').oninput=()=>{const v=$('horizonGranularity').value;$('horizonGranularityNumber').value=v;$('horizonGranularityOut').textContent=`${v} / 100`;};
$('horizonGranularity').onchange=()=>setGranularity($('horizonGranularity').value);
$('horizonGranularityNumber').onchange=()=>setGranularity($('horizonGranularityNumber').value);
$('horizonRandomize').onclick=()=>{
  const current=horizonTerrain();
  let seed=(Math.round(Number(current.mountainSeed)||0)+1)&0x7fffffff;
  try{const a=new Uint32Array(1);crypto.getRandomValues(a);seed=a[0]&0x7fffffff;}catch(_){}
  updateHorizon(o=>{o.mountainSeed=seed;},'horizon-randomize');
  log(`Randomized shared mountain plateau map with seed ${seed}; preserved ${Object.keys(horizonTerrain().lockedTiles||{}).length} locked tile(s).`);
};
$('horizonClearLocks').onclick=()=>updateHorizon(o=>{o.lockedTiles={};},'horizon-clear-locks');
$('horizonBrushMode').onchange=()=>{state.drag=null;draw();};
$('horizonWestPreset').onclick=()=>replaceHorizonPreset('westernMountainChain','horizon-west-preset');
$('horizonNorthPreset').onclick=()=>replaceHorizonPreset('northernPlateau','horizon-north-preset');
$('horizonClear').onclick=()=>replaceHorizonPreset('none','horizon-clear');
$('enabled').onchange=()=>updateOverride(o=>o.enabled=$('enabled').checked);$('edge').onchange=()=>updateOverride(o=>{o.edge=$('edge').value;delete o.controlPoints;});$('length').onchange=()=>updateOverride(o=>o.lengthTiles=Number($('length').value));$('widthScale').onchange=()=>updateOverride(o=>o.widthScale=Number($('widthScale').value));$('specialValue').onchange=()=>updateOverride((o,a)=>{if(a.kind==='river')o.bankTiles=Number($('specialValue').value);else o.shoulderTiles=Number($('specialValue').value);});$('attachRiverDepth').onchange=()=>updateOverride(o=>{const v=Number($('attachRiverDepth').value);if($('attachRiverDepth').value===''||!Number.isFinite(v))delete o.channelDepth;else o.channelDepth=v;});
$('removeOrphan').onclick=()=>{const a=selected();if(!a?.orphan)return;delete state.scenery.attachments[a.id];state.selectedId=null;syncAttachments();draw();log(`Removed stale override ${a.id}.`);};$('addPoint').onclick=addPoint;$('deletePoint').onclick=deletePoint;$('resetPoints').onclick=resetPoints;$('fitBtn').onclick=fit;$('loadLive').onclick=loadLive;$('loadTown').onclick=loadTown;$('applyBtn').onclick=applyLive;$('exportMapBtn').onclick=()=>state.map&&download(`${state.map.id||'map'}.map.json`,{...state.map,backgroundScenery:state.scenery});$('exportSceneryBtn').onclick=()=>state.scenery&&download(`${state.map?.id||'map'}.background-scenery.json`,state.scenery);$('importBtn').onclick=()=>$('importFile').click();$('importFile').onchange=async e=>{const f=e.target.files?.[0];if(!f)return;try{loadMap(JSON.parse(await f.text()),{label:f.name});}catch(err){log(`Import failed: ${err.message}`);}e.target.value='';};$('sideToggle').onclick=()=>$('side').classList.toggle('collapsed');
if(!Core){log('BackgroundScenery core unavailable: border-terrain.js did not load.');}else{const live=mapEditorAccess();if(live)loadLive();else loadTown();}
