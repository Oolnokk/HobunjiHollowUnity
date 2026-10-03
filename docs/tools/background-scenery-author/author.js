'use strict';
const $ = id => document.getElementById(id);
const Core = window.BackgroundScenery;
const canvas = $('canvas'), ctx = canvas.getContext('2d');
const state = { map:null, liveMapRef:null, liveMapWindow:null, scenery:null, attachments:[], selectedId:null, selectedPoint:-1, cam:{x:0,y:0,zoom:10}, drag:null, pointers:new Map(), pinch:null };
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
  state.map=normalizeMap(raw);state.liveMapRef=liveRef;state.liveMapWindow=liveWindow;
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
function fillGlobals(){const s=state.scenery;if(!s)return;for(const [id,key] of [['ridgeClearance','ridgeClearanceTiles'],['borderDepth','borderDepthTiles'],['defaultLength','defaultExtensionLengthTiles']]){$(id).value=s[key];$(id+'Out').textContent=Number(s[key]).toFixed(id==='ridgeClearance'?2:0)+'t';}$('routeShoulder').value=s.routeShoulderTiles;$('riverBank').value=s.riverBankTiles;$('riverDepth').value=s.riverChannelDepth;$('waterfallThreshold').value=s.waterfallThreshold;}
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
function fit(){if(!state.map)return;resize();const d=Number(state.scenery?.borderDepthTiles||18)+2;const rw=state.map.cols+d*2,rh=state.map.rows+d*2;const r=canvas.getBoundingClientRect();state.cam.zoom=Math.max(2,Math.min((r.width-30)/rw,(r.height-30)/rh));state.cam.x=r.width/2-(state.map.cols/2)*state.cam.zoom;state.cam.y=r.height/2-(state.map.rows/2)*state.cam.zoom;draw();}
function resize(){const r=canvas.getBoundingClientRect(),dpr=Math.min(2,devicePixelRatio||1),w=Math.max(1,Math.round(r.width*dpr)),h=Math.max(1,Math.round(r.height*dpr));if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}ctx.setTransform(dpr,0,0,dpr,0,0);}
function w2s(x,y){return{x:state.cam.x+x*state.cam.zoom,y:state.cam.y+y*state.cam.zoom};}function s2w(x,y){return{x:(x-state.cam.x)/state.cam.zoom,y:(y-state.cam.y)/state.cam.zoom};}
function tileEntries(){if(!state.map)return[];const t=state.map.tiles||{};if(Array.isArray(t))return t.map(v=>[`${v.c},${v.r}`,v]);return Object.entries(t);}
function draw(){resize();const r=canvas.getBoundingClientRect();ctx.clearRect(0,0,r.width,r.height);if(!state.map)return;const z=state.cam.zoom,m=state.map,d=Number(state.scenery.borderDepthTiles||18);
  const bg0=w2s(-d,-d),bg1=w2s(m.cols+d,m.rows+d);ctx.fillStyle='#18251f';ctx.fillRect(bg0.x,bg0.y,bg1.x-bg0.x,bg1.y-bg0.y);
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
canvas.addEventListener('pointerdown',e=>{canvas.setPointerCapture(e.pointerId);const p=pt(e);state.pointers.set(e.pointerId,p);if(state.pointers.size===2){const ar=[...state.pointers.values()],mid={x:(ar[0].x+ar[1].x)/2,y:(ar[0].y+ar[1].y)/2};state.pinch={dist:Math.hypot(ar[0].x-ar[1].x,ar[0].y-ar[1].y),zoom:state.cam.zoom,x:state.cam.x,y:state.cam.y,mid};return;}const h=hitControl(p.x,p.y);if(h!==null){const a=selected();materializePoints(a);state.selectedPoint=h;state.drag={type:'point',index:h};draw();}else state.drag={type:'pan',p,x:state.cam.x,y:state.cam.y};});
canvas.addEventListener('pointermove',e=>{const p=pt(e);state.pointers.set(e.pointerId,p);const w=s2w(p.x,p.y);$('cursor').textContent=`${w.x.toFixed(1)}, ${w.y.toFixed(1)}`;if(state.pointers.size===2&&state.pinch){const ar=[...state.pointers.values()],dist=Math.hypot(ar[0].x-ar[1].x,ar[0].y-ar[1].y),mid={x:(ar[0].x+ar[1].x)/2,y:(ar[0].y+ar[1].y)/2};const old=state.cam.zoom,nz=clamp(state.pinch.zoom*dist/Math.max(1,state.pinch.dist),2,80);const wx=(state.pinch.mid.x-state.pinch.x)/state.pinch.zoom,wy=(state.pinch.mid.y-state.pinch.y)/state.pinch.zoom;state.cam.zoom=nz;state.cam.x=mid.x-wx*nz;state.cam.y=mid.y-wy*nz;draw();return;}if(!state.drag)return;if(state.drag.type==='pan'){state.cam.x=state.drag.x+p.x-state.drag.p.x;state.cam.y=state.drag.y+p.y-state.drag.p.y;draw();}else{const a=selected(),o=overrideFor(a.id),ww=s2w(p.x,p.y);o.controlPoints[state.drag.index]=constrainPoint([Math.round(ww.x*4)/4,Math.round(ww.y*4)/4],effective(a).edge);draw();}});
function end(e){state.pointers.delete(e.pointerId);if(state.pointers.size<2)state.pinch=null;state.drag=null;}canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end);canvas.addEventListener('wheel',e=>{e.preventDefault();const p=pt(e),old=state.cam.zoom,nz=clamp(old*(e.deltaY<0?1.12:.89),2,80),w=s2w(p.x,p.y);state.cam.zoom=nz;state.cam.x=p.x-w.x*nz;state.cam.y=p.y-w.y*nz;draw();},{passive:false});
window.addEventListener('resize',draw);
for(const [id,key] of [['ridgeClearance','ridgeClearanceTiles'],['borderDepth','borderDepthTiles'],['defaultLength','defaultExtensionLengthTiles']])$(id).addEventListener('input',()=>{if(!state.scenery)return;state.scenery[key]=Number($(id).value);$(id+'Out').textContent=Number($(id).value).toFixed(id==='ridgeClearance'?2:0)+'t';draw();});
for(const [id,key] of [['routeShoulder','routeShoulderTiles'],['riverBank','riverBankTiles'],['riverDepth','riverChannelDepth'],['waterfallThreshold','waterfallThreshold']])$(id).addEventListener('change',()=>{if(!state.scenery)return;state.scenery[key]=Number($(id).value);draw();fillSelected();});
$('enabled').onchange=()=>updateOverride(o=>o.enabled=$('enabled').checked);$('edge').onchange=()=>updateOverride(o=>{o.edge=$('edge').value;delete o.controlPoints;});$('length').onchange=()=>updateOverride(o=>o.lengthTiles=Number($('length').value));$('widthScale').onchange=()=>updateOverride(o=>o.widthScale=Number($('widthScale').value));$('specialValue').onchange=()=>updateOverride((o,a)=>{if(a.kind==='river')o.bankTiles=Number($('specialValue').value);else o.shoulderTiles=Number($('specialValue').value);});$('attachRiverDepth').onchange=()=>updateOverride(o=>{const v=Number($('attachRiverDepth').value);if($('attachRiverDepth').value===''||!Number.isFinite(v))delete o.channelDepth;else o.channelDepth=v;});
$('removeOrphan').onclick=()=>{const a=selected();if(!a?.orphan)return;delete state.scenery.attachments[a.id];state.selectedId=null;syncAttachments();draw();log(`Removed stale override ${a.id}.`);};$('addPoint').onclick=addPoint;$('deletePoint').onclick=deletePoint;$('resetPoints').onclick=resetPoints;$('fitBtn').onclick=fit;$('loadLive').onclick=loadLive;$('loadTown').onclick=loadTown;$('applyBtn').onclick=applyLive;$('exportMapBtn').onclick=()=>state.map&&download(`${state.map.id||'map'}.map.json`,{...state.map,backgroundScenery:state.scenery});$('exportSceneryBtn').onclick=()=>state.scenery&&download(`${state.map?.id||'map'}.background-scenery.json`,state.scenery);$('importBtn').onclick=()=>$('importFile').click();$('importFile').onchange=async e=>{const f=e.target.files?.[0];if(!f)return;try{loadMap(JSON.parse(await f.text()),{label:f.name});}catch(err){log(`Import failed: ${err.message}`);}e.target.value='';};$('sideToggle').onclick=()=>$('side').classList.toggle('collapsed');
if(!Core){log('BackgroundScenery core unavailable: border-terrain.js did not load.');}else{const live=mapEditorAccess();if(live)loadLive();else loadTown();}
