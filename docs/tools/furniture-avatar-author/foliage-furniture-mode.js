// Furniture Avatar Author: foliage-as-furniture authoring mode.
// Foliage is generated read-only by V27; only its whole transform and the
// ordinary furniture proxy/seat targets are authored here.
(() => {
'use strict';
const FF_REPO='Oolnokk/HobunjiHollowUnity'; // Used for the live foliage-authored catalog and V27 source.
const FF_BRANCH='main'; // Used so this authoring mode reads the canonical foliage definitions.
const FF_DIR='docs/config/foliage-authored'; // Used as the source catalog directory.
const FF_API=`https://api.github.com/repos/${FF_REPO}/contents/${FF_DIR}?ref=${FF_BRANCH}`; // Used to list authored foliage JSON files.
const FF_RAW=`https://raw.githubusercontent.com/${FF_REPO}/${FF_BRANCH}/`; // Used to fetch foliage JSON and V27 source.
const FF_V27='docs/references/(HA)FoliageGeneratorV27.html'; // Used to generate the exact foliage object rather than approximating it.
const FF_V27_BASE=`https://raw.githack.com/${FF_REPO}/${FF_BRANCH}/docs/references/`; // Used so V27's relative scripts/assets resolve inside srcdoc.
const FF_DEFAULT_OFFSET=window.HOBUNJI_DEFAULT_SEAT_NORMAL_OFFSET ?? 0.01; // Used for the initial authored seat target(s).
const FF_DEFAULTS=Object.freeze({ // Exact starting values supplied from the user's authored foliage-furniture exports.
  'docs/config/foliage-authored/chairstump.json':{seatCount:1,model:{x:-0.0486,y:-0.2448,z:-0.0202,rx:180,ry:-8.277,rz:180,sx:0.8922,sy:1,sz:0.9023},proxy:{x:0,y:0.2595,z:0,rx:0,ry:0,rz:0,sx:0.6114,sy:0.4799,sz:0.5896}},
  'docs/config/foliage-authored/benchlog.json':{seatCount:2,model:{x:0,y:0.2123,z:-0.3856,rx:90.212,ry:0,rz:-1.554,sx:0.9316,sy:1,sz:1},proxy:{x:0.0104,y:0.2496,z:0,rx:0,ry:0,rz:0,sx:1.9765,sy:0.428,sz:0.6711}}
});
const ff={catalog:[],sourcePath:'',sourceSha:'',sourceConfig:null,seatCount:1,model:{x:0,y:0,z:0,rx:0,ry:0,rz:0,sx:1,sy:1,sz:1},root:null,proxyId:null,generatorPromise:null,loading:false}; // Holds only foliage-mode state; ordinary furniture state remains in V58's existing `state` object.
window.__hobunjiFoliageFurniture=ff;
const fq=id=>document.getElementById(id);
const fcopy=value=>value==null?value:JSON.parse(JSON.stringify(value));
const fbase=path=>String(path||'').split('/').pop()||'';
const fstem=path=>fbase(path).replace(/\.json$/i,'');
const fnum=(id,fallback=0)=>{const v=Number(fq(id)?.value);return Number.isFinite(v)?v:fallback;};
function fstatus(message,level='info'){if(fq('ffStatus'))fq('ffStatus').textContent=message;log(`[Foliage Furniture] ${message}`,level);}
function fdefaults(path){return FF_DEFAULTS[String(path||'')]||null;}

function installFoliageUi(){
  if(fq('ffModePanel'))return;
  const host=fq('tab-parts')?.querySelector('.section')?.parentElement||fq('tab-parts'); if(!host)return;
  const panel=document.createElement('div'); panel.id='ffModePanel'; panel.className='section';
  panel.innerHTML=`<h2>Foliage Furniture</h2><div class="muted">Generate a foliage-authored object as read-only geometry, then author an invisible ordinary furniture box as its seat/collision proxy.</div>
    <div class="row"><select id="ffSource"></select></div><div class="g2"><button id="ffRefresh">Refresh Repo</button><button id="ffLoad" class="ok">Load / Rebuild</button></div>
    <hr><label>Whole foliage transform</label><div class="g3"><div><label>X</label><input id="ffX" type="number" step="0.01"></div><div><label>Y</label><input id="ffY" type="number" step="0.01"></div><div><label>Z</label><input id="ffZ" type="number" step="0.01"></div></div>
    <div class="g3"><div><label>RX°</label><input id="ffRX" type="number" step="1"></div><div><label>RY°</label><input id="ffRY" type="number" step="1"></div><div><label>RZ°</label><input id="ffRZ" type="number" step="1"></div></div>
    <div class="g3"><div><label>SX</label><input id="ffSX" type="number" step="0.01" min="0.001"></div><div><label>SY</label><input id="ffSY" type="number" step="0.01" min="0.001"></div><div><label>SZ</label><input id="ffSZ" type="number" step="0.01" min="0.001"></div></div>
    <div class="g2"><button id="ffSelectFoliage">Gizmo: Foliage</button><button id="ffResetFoliage">Reset Foliage</button></div>
    <hr><div class="g2"><button id="ffSelectProxy">Select Seat Proxy</button><button id="ffResetProxy">Reset Proxy</button></div><div class="g2"><button id="ffPreviewSeats">Show Seat Preview</button><button id="ffFrame">Frame Foliage + Seat</button></div>
    <div id="ffStatus" class="readout muted">Not loaded.</div>`;
  host.prepend(panel);
  fq('ffRefresh').onclick=()=>refreshFoliageCatalog(); fq('ffLoad').onclick=()=>loadSelectedFoliage();
  for(const id of ['ffX','ffY','ffZ','ffRX','ffRY','ffRZ','ffSX','ffSY','ffSZ'])fq(id).addEventListener('change',readFoliageFields);
  fq('ffSelectFoliage').onclick=selectFoliageGizmo; fq('ffResetFoliage').onclick=resetFoliageTransform;
  fq('ffSelectProxy').onclick=()=>{const part=state.parts.find(p=>p.id===ff.proxyId||p.foliageSeatProxy);if(part)selectObject('part',part.id,{force:true});};
  fq('ffResetProxy').onclick=resetProxy; fq('ffPreviewSeats').onclick=previewSeats; fq('ffFrame').onclick=frameFoliageFurniture;
  transform.addEventListener('objectChange',()=>{if(transform.object===ff.root)syncFoliageFromRoot();});
}

async function refreshFoliageCatalog(prefer=''){
  fstatus('Loading foliage-authored catalog…');
  try{
    const response=await fetch(FF_API,{headers:{Accept:'application/vnd.github+json'},cache:'no-store'}); if(!response.ok)throw new Error(`GitHub catalog HTTP ${response.status}`);
    const rows=await response.json(); ff.catalog=(Array.isArray(rows)?rows:[]).filter(row=>row.type==='file'&&/\.json$/i.test(row.name)).map(row=>({name:row.name,path:`${FF_DIR}/${row.name}`,sha:row.sha})).sort((a,b)=>a.name.localeCompare(b.name));
    const select=fq('ffSource'); select.innerHTML=ff.catalog.map(row=>`<option value="${row.path}">${row.name}</option>`).join('');
    const desired=prefer||ff.sourcePath||ff.catalog.find(row=>/chairstump\.json$/i.test(row.name))?.path||ff.catalog[0]?.path; if(desired)select.value=desired;
    fstatus(`${ff.catalog.length} foliage source${ff.catalog.length===1?'':'s'} found.`); return ff.catalog;
  }catch(error){fstatus(`Catalog failed: ${error.message}`,'error');return[];}
}

function v27BridgeSource(){return `(function(){window.__HOBUNJI_FF_BRIDGE__={build:function(config){applySerializableParams(JSON.parse(JSON.stringify(config||{})));Object.assign(params,{gridNetworkEnabled:false,gridPlayPreviewEnabled:false,stagePreviewEnabled:false,autoRotate:false,debugBranchLines:false,debugPrisms:false,debugPrismAxes:false});buildTree();if(!treeGroup)throw new Error('V27 did not create foliage.');scene.remove(treeGroup);var out=treeGroup;treeGroup=null;treeMesh=null;treeMat=null;vineMesh=null;vineMat=null;out.updateMatrixWorld(true);return out;}};})();`;}
async function generatorBridge(){
  if(ff.generatorPromise)return ff.generatorPromise;
  ff.generatorPromise=(async()=>{
    const response=await fetch(`${FF_RAW}${FF_V27}`,{cache:'no-store'}); if(!response.ok)throw new Error(`V27 HTTP ${response.status}`); let source=await response.text();
    source=source.replace(/<head(\s[^>]*)?>/i,m=>`${m}<base href="${FF_V27_BASE}">`);
    const marker=/\n\s*\/\/ Boot\s*\n\s*loadParamsFromLocal\(\);/; if(!marker.test(source))throw new Error('V27 boot marker not found.'); source=source.replace(marker,m=>`\n${v27BridgeSource()}${m}`);
    const frame=document.createElement('iframe'); frame.style.cssText='position:fixed;left:-10000px;top:-10000px;width:8px;height:8px;border:0;opacity:0;pointer-events:none'; document.body.appendChild(frame);
    const loaded=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('V27 iframe timed out.')),15000);frame.addEventListener('load',()=>{clearTimeout(timer);resolve();},{once:true});}); frame.srcdoc=source; await loaded;
    const started=performance.now(); while(!frame.contentWindow?.__HOBUNJI_FF_BRIDGE__){if(performance.now()-started>10000)throw new Error('V27 bridge did not initialize.');await new Promise(r=>setTimeout(r,40));}
    return frame.contentWindow.__HOBUNJI_FF_BRIDGE__;
  })().catch(error=>{ff.generatorPromise=null;throw error;}); return ff.generatorPromise;
}

function clearFoliage(){if(ff.root){transform.detach();scene.remove(ff.root);disposeObject(ff.root);ff.root=null;}}
function normalizeFoliage(asset){asset.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(asset);if(box.isEmpty())return;const center=box.getCenter(new THREE.Vector3());asset.position.x-=center.x;asset.position.y-=box.min.y;asset.position.z-=center.z;asset.updateMatrixWorld(true);}
function applyFoliageTransform(){if(!ff.root)return;const t=ff.model;ff.root.position.set(t.x,t.y,t.z);ff.root.rotation.set(t.rx*DEG,t.ry*DEG,t.rz*DEG);ff.root.scale.set(Math.max(.001,t.sx),Math.max(.001,t.sy),Math.max(.001,t.sz));ff.root.updateMatrixWorld(true);writeFoliageFields();}
function writeFoliageFields(){for(const [id,key] of Object.entries({ffX:'x',ffY:'y',ffZ:'z',ffRX:'rx',ffRY:'ry',ffRZ:'rz',ffSX:'sx',ffSY:'sy',ffSZ:'sz'}))if(fq(id))fq(id).value=Number(ff.model[key]).toFixed(key.startsWith('r')?3:4);}
function readFoliageFields(){ff.model={x:fnum('ffX'),y:fnum('ffY'),z:fnum('ffZ'),rx:fnum('ffRX'),ry:fnum('ffRY'),rz:fnum('ffRZ'),sx:Math.max(.001,fnum('ffSX',1)),sy:Math.max(.001,fnum('ffSY',1)),sz:Math.max(.001,fnum('ffSZ',1))};applyFoliageTransform();}
function syncFoliageFromRoot(){if(!ff.root)return;ff.model={x:+ff.root.position.x.toFixed(4),y:+ff.root.position.y.toFixed(4),z:+ff.root.position.z.toFixed(4),rx:+(ff.root.rotation.x*RAD).toFixed(3),ry:+(ff.root.rotation.y*RAD).toFixed(3),rz:+(ff.root.rotation.z*RAD).toFixed(3),sx:+ff.root.scale.x.toFixed(4),sy:+ff.root.scale.y.toFixed(4),sz:+ff.root.scale.z.toFixed(4)};writeFoliageFields();}
function selectFoliageGizmo(){if(!ff.root)return;state.selectedType=null;state.selectedId=null;transform.attach(ff.root);transform.setSpace?.('world');setTransformMode('translate');}
function resetFoliageTransform(){const d=fdefaults(ff.sourcePath);ff.model=fcopy(d?.model||{x:0,y:0,z:0,rx:0,ry:0,rz:0,sx:1,sy:1,sz:1});applyFoliageTransform();}

function seatProxy(){return state.parts.find(part=>part.id===ff.proxyId||part.foliageSeatProxy===true)||null;}
function createProxy(){
  const d=fdefaults(ff.sourcePath); if(!d)throw new Error('This source has no foliage-furniture default yet.'); beginPreset(d.seatCount===2?2:1,1);
  const part=pushPart('box',{name:`${fstem(ff.sourcePath)} Invisible Seat Proxy`,transform:fcopy(d.proxy),color:'#65e6ff',materialRole:'custom',materialTexture:null,wonkiness:0,topScaleX:1,topScaleZ:1,bottomScaleX:1,bottomScaleZ:1,surfaceOpacity:.18,foliageSeatProxy:true});
  ff.proxyId=part.id; rebuildAll(); assignTopRole(part.id,'seat',`${fstem(ff.sourcePath)} Seat`); rebuildFurnitureMeshes();
  const surface=findBestTopSurface(part.id); if(!surface)throw new Error('Could not recognize the proxy top surface.'); state.seating.surfaceId=surface.id; state.seatAnchors=[];
  const def=seatSurfaceGridDefinition(surface.id); if(def)for(let column=0;column<Math.min(d.seatCount,def.columns);column++){const anchor=seatAnchorForCell(surface.id,column,0,true);if(anchor)anchor.position.y=FF_DEFAULT_OFFSET;}
  rebuildSeatGrid(); rebuildSeatedAvatars(); renderSeatingUI(); selectObject('part',part.id,{force:true});
}
function resetProxy(){if(!ff.sourcePath)return;createProxy();frameFoliageFurniture();}
function previewSeats(){const surface=findBestTopSurface(seatProxy()?.id);if(!surface)return;state.seating.surfaceId=surface.id;clearSeatedAvatars();fillSeatCells();}
function frameFoliageFurniture(){const box=new THREE.Box3();if(ff.root)box.expandByObject(ff.root);const proxy=seatProxy()&&meshes.get(seatProxy().id);if(proxy)box.expandByObject(proxy);if(box.isEmpty())return frameFurniture();const center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3()),radius=Math.max(size.x,size.y,size.z,1);orbit?.target.copy(center);camera.position.copy(center).add(new THREE.Vector3(radius*1.7,radius*1.25,radius*2.1));camera.lookAt(center);camera.updateProjectionMatrix();}

async function rebuildFoliageOnly(config){const bridge=await generatorBridge();const asset=bridge.build(fcopy(config));normalizeFoliage(asset);clearFoliage();ff.root=new THREE.Group();ff.root.name='foliage_furniture_readonly';ff.root.add(asset);scene.add(ff.root);applyFoliageTransform();}
async function loadFoliage(path,{resetProxy=true,metadata=null}={}){
  if(!path||ff.loading)return;ff.loading=true;if(fq('ffLoad'))fq('ffLoad').disabled=true;
  try{fstatus(`Loading ${fbase(path)}…`);const response=await fetch(`${FF_RAW}${path}?t=${Date.now()}`,{cache:'no-store'});if(!response.ok)throw new Error(`${fbase(path)} HTTP ${response.status}`);const config=await response.json(),entry=ff.catalog.find(row=>row.path===path),d=fdefaults(path);if(!d)throw new Error('No furniture defaults are registered for this foliage source.');
    ff.sourcePath=path;ff.sourceSha=metadata?.sourceSha||entry?.sha||'';ff.sourceConfig=config;ff.seatCount=Number(metadata?.seatCount)||d.seatCount;ff.model=fcopy(metadata?.transform||d.model);writeFoliageFields();await rebuildFoliageOnly(config);if(resetProxy)createProxy();else{ff.proxyId=metadata?.proxyPartId||state.parts.find(part=>part.foliageSeatProxy)?.id||null;const liveProxy=seatProxy();if(liveProxy){liveProxy.surfaceOpacity=.18;rebuildFurnitureMeshes();}}frameFoliageFurniture();fstatus(`${fbase(path)} ready · ${ff.seatCount} seat${ff.seatCount===1?'':'s'}.`);
  }catch(error){fstatus(`Load failed: ${error.message}`,'error');}finally{ff.loading=false;if(fq('ffLoad'))fq('ffLoad').disabled=false;}
}
function loadSelectedFoliage(){return loadFoliage(fq('ffSource')?.value);}

const originalFoliageExport=exportData;
exportData=function exportFoliageFurniture(){const data=originalFoliageExport();if(!ff.sourcePath)return data;const proxy=data.parts?.find(part=>part.id===ff.proxyId||part.foliageSeatProxy);if(proxy)proxy.surfaceOpacity=0;data.foliageFurniture={version:3,sourcePath:ff.sourcePath,sourceSha:ff.sourceSha,generatorPath:FF_V27,assetType:ff.sourceConfig?.assetType||'',seed:ff.sourceConfig?.seed||'',transform:fcopy(ff.model),proxyPartId:proxy?.id||ff.proxyId,proxyHiddenInRuntime:true,seatCount:ff.seatCount,defaultSeatNormalOffset:FF_DEFAULT_OFFSET,note:'Foliage geometry is generated from sourcePath; the authored box is an invisible seating/collision proxy.'};return data;};
const originalFoliageLoad=loadData;
loadData=function loadFoliageFurnitureProject(data){const result=originalFoliageLoad(data),meta=data?.foliageFurniture;if(meta?.sourcePath){ff.proxyId=meta.proxyPartId||state.parts.find(part=>part.foliageSeatProxy)?.id||null;ff.model=fcopy(meta.transform||ff.model);refreshFoliageCatalog(meta.sourcePath).then(()=>loadFoliage(meta.sourcePath,{resetProxy:false,metadata:meta}));}return result;};
const downloadBtn=fq('downloadJsonBtn'),originalDownload=downloadBtn?.onclick;if(downloadBtn)downloadBtn.onclick=()=>{if(!ff.sourcePath)return originalDownload?.();download(`${fstem(ff.sourcePath)}_furniture.json`,new Blob([JSON.stringify(exportData(),null,2)],{type:'application/json'}));};

(async()=>{installFoliageUi();await refreshFoliageCatalog();writeFoliageFields();fstatus('Ready. Select a foliage source and press Load / Rebuild.');})();
})();
