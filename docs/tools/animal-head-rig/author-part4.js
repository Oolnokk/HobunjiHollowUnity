function readPreviewRigs(){try{const p=JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}');return p&&typeof p==='object'&&!Array.isArray(p)?p:{}}catch(_){return{}}}
function writePreviewRigs(r){localStorage.setItem(STORAGE_KEY,JSON.stringify(r))}
function downloadJson(v,name){const blob=new Blob([pretty(v)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
async function copyText(text){try{await navigator.clipboard.writeText(text);setStatus('Copied to clipboard.',true)}catch(_){const t=document.createElement('textarea');t.value=text;document.body.appendChild(t);t.select();document.execCommand('copy');t.remove();setStatus('Copied to clipboard.',true)}}

let spriteLoadGeneration=0; // Invalidates stale idle PNG requests when the picker switches species.
const spriteLoadDebug={status:'idle',requested:null,loaded:null,lastError:null,staleCallbacks:0}; // Mobile diagnostics for the currently selected source PNG.
window.__animalHeadRigSpriteLoad=Object.freeze({debugSnapshot:()=>({...spriteLoadDebug,generation:spriteLoadGeneration})});
function invalidateLoadedSprite(){
  spriteLoadGeneration++; // A late onload/onerror from any previous source can no longer change the rigger.
  state.image=null;state.imageUrl='';state.sourceCanvas=null;state.sampleData=null;
  state.weights=null;state.compressibility=null;state.stretchability=null;state.pivot=null;
  state.cursor=null;state.dragging=false; // A prior source's paint cursor/drag must not apply to a different animal.
  spriteLoadDebug.status='idle';spriteLoadDebug.loaded=null;spriteLoadDebug.lastError=null;
  requestDraw();
}
function beginAnimalSelection(record,index=-1){
  invalidateLoadedSprite(); // Clear OLD sprite before applyRecord's shoulder/head/baby wrappers run.
  applyRecord(record,index);
  const path=record?.sprites?.idle||record?.textureUrl;
  if(path)loadImageUrl(repoSpriteUrl(path),path);
  else {
    spriteLoadDebug.status='no-sprite';
    setStatus(record?.id?'No idle sprite path for '+record.id+'. Choose image or enter a sprite path.':'Choose an animal or import a sprite.',true);
  }
}

function runtimeRiggerSupplements(repoRecords){
  const renderer=window.CreatureGeneticsRender?.SPECIES||{}; // Registered gameplay species provide their real sprite paths when available.
  const known=new Set(repoRecords.map(record=>record?.id).filter(Boolean)); // Avoid listing a bestiary species twice.
  const supplements=[]; // Runtime-only animals, including Moot, appear beside bestiary species in the painter.
  const pingdort=window.PingdortRegistration; // Read the same authored sprite and dimensions that gameplay uses.
  const runtimeSpecies=pingdort
    ? {...RUNTIME_RIGGER_SPECIES,[pingdort.KIND]:{...pingdort.PRESENTATION,baselineIds:[]}}
    : RUNTIME_RIGGER_SPECIES; // Keep the same dedupe and export handling for every runtime-only species.
  for(const [id,config] of Object.entries(runtimeSpecies)){
    if(known.has(id))continue;
    const species=renderer[id];
    const idle=species?.base?.idle||config.sprites?.idle;
    if(!idle)continue;
    const baseline=config.baselineIds.map(baselineId=>repoRecords.find(record=>record?.id===baselineId)).find(Boolean)||{};
    const run=[species?.base?.run1||config.sprites?.run?.[0],species?.base?.run2||config.sprites?.run?.[1]].filter(Boolean);
    const rig=window.HobunjiAuthoredAnimalHeadRigs?.get?.(id)||window.CreatureGeneticsRender?.headRigForKind?.(id); // Load each species' actual authored rig, never a shared default.
    supplements.push({id,label:config.label,modelWidth:Math.max(.01,numberOr(config.modelWidth,baseline.modelWidth||1)),spriteAspect:Math.max(.01,numberOr(config.spriteAspect,baseline.spriteAspect||1)),tint:/^#[0-9a-f]{6}$/i.test(baseline.tint||'')?baseline.tint:'#ffffff',diet:config.diet,hostile:config.hostile,sprites:{idle,...(run.length?{run}:{})},...(rig?{headRig:deepClone(rig)}:{})});
  }
  return supplements;
}

function applyRecord(record,index=-1){state.baseRecord=deepClone(record||{});state.selectedIndex=index;$('animalId').value=record?.id||'';$('animalLabel').value=record?.label||record?.name||'';$('modelWidth').value=numberOr(record?.modelWidth,1);$('spriteAspect').value=numberOr(record?.spriteAspect,1);$('tint').value=/^#[0-9a-f]{6}$/i.test(record?.tint||'')?record.tint:'#ffffff';$('diet').value=record?.diet||'';$('hostile').checked=!!record?.hostile;$('idleSprite').value=record?.sprites?.idle||record?.textureUrl||'';const explicit=new Set(['id','label','name','modelWidth','spriteAspect','tint','diet','hostile','sprites','textureUrl','headRig']),extras={};Object.entries(record||{}).forEach(([k,v])=>{if(!explicit.has(k))extras[k]=v});$('extraVars').value=pretty(extras);state.pendingRig=deepClone(record?.headRig||null);if(state.image&&state.pendingRig)applyRigToPaint(state.pendingRig);else if(state.image){makeBlankWeights();state.pivot=null}resetHistory();updateOutput()}
function populateAnimalSelect(records,collectionIndexes=null){state.selectRecords=records;state.selectCollectionIndexes=collectionIndexes||records.map((_,i)=>i);const s=$('animalSelect');s.innerHTML='<option value="">New / custom animal</option>';records.forEach((r,i)=>{const o=document.createElement('option');o.value=String(i);o.textContent=r.label||r.name||r.id||`Animal ${i+1}`;s.appendChild(o)})}
async function loadRepoBestiary(){try{const res=await fetch('../../config/creatures/hobunji-creature-bestiary.json',{cache:'no-store'});if(!res.ok)throw new Error(`HTTP ${res.status}`);const data=await res.json(),repoRecords=(Array.isArray(data.creatures)?data.creatures:[]).map(record=>{const rig=window.HobunjiAuthoredAnimalHeadRigs?.get?.(record?.id);return rig?{...record,headRig:deepClone(rig)}:record}),supplements=runtimeRiggerSupplements(repoRecords),records=[...repoRecords,...supplements],indexes=[...repoRecords.map((_,i)=>i),...supplements.map(()=>-1)];state.collection=data;state.collectionKind='bestiary';populateAnimalSelect(records,indexes);setStatus(`Loaded ${repoRecords.length} bestiary records${supplements.length?` + ${supplements.length} runtime species (${supplements.map(record=>record.label).join(', ')})`:''}. Choose an animal.`,true)}catch(e){setStatus(`Could not load repo bestiary: ${e.message}`,false)}}
async function loadJsonFile(file){if(!file)return;try{const data=JSON.parse(await file.text()),records=Array.isArray(data)?data:Array.isArray(data?.creatures)?data.creatures:[data];state.collection=data;state.collectionKind=Array.isArray(data)?'array':Array.isArray(data?.creatures)?'bestiary':'single';populateAnimalSelect(records);if(records.length===1){$('animalSelect').value='0';beginAnimalSelection(records[0],0)}setStatus(`Loaded ${records.length} animal record${records.length===1?'':'s'} from ${file.name}.`,true)}catch(e){setStatus(`Invalid JSON: ${e.message}`,false)}}
function repoSpriteUrl(path){const raw=String(path||'').trim();if(/^(?:https?:|blob:|data:)/i.test(raw))return raw; // Keep explicit remote and uploaded sprite URLs intact for CORS-safe loading.
const clean=raw.replace(/^\.\//,'').replace(/^\//,'');return new URL('../../'+clean,location.href).href}
function loadImageUrl(url,displayPath=url){
  invalidateLoadedSprite();
  const generation=spriteLoadGeneration; // This request alone is permitted to populate the editor after its image decodes.
  spriteLoadDebug.status='loading';spriteLoadDebug.requested=displayPath;
  const image=new Image();image.crossOrigin='anonymous'; // Pixel reads must stay CORS-safe after CDN redirects.
  image.decoding='async';
  image.onload=()=>{
    if(generation!==spriteLoadGeneration){spriteLoadDebug.staleCallbacks++;return;}
    try {
      if(!image.naturalWidth||!image.naturalHeight)throw new Error('The sprite decoded without dimensions.');
      state.image=image;state.imageUrl=displayPath;
      if(!$('spriteAspect').value||Number($('spriteAspect').value)===1)
        $('spriteAspect').value=(image.naturalHeight/image.naturalWidth).toFixed(5);
      const maxR=Math.max(image.naturalWidth,image.naturalHeight);
      $('brushRadius').max=String(maxR);$('expandRadius').max=String(maxR);
      $('brushRadius').value=String(Math.min(numberOr($('brushRadius').value,40),maxR));
      $('expandRadius').value=String(Math.min(numberOr($('expandRadius').value,60),maxR));
      if(state.pendingRig)applyRigToPaint(state.pendingRig);
      else{makeBlankWeights();state.pivot=null}
      spriteLoadDebug.status='ready';spriteLoadDebug.loaded=displayPath;spriteLoadDebug.lastError=null;
      resetHistory();resizeCanvases();draw();
    } catch(error) {
      spriteLoadDebug.status='error';spriteLoadDebug.lastError=String(error?.message||error);
      setStatus('Could not initialize sprite: '+displayPath+'\n'+spriteLoadDebug.lastError,false);
    }
  };
  image.onerror=()=>{
    if(generation!==spriteLoadGeneration){spriteLoadDebug.staleCallbacks++;return;}
    spriteLoadDebug.status='error';
    spriteLoadDebug.lastError='The image host must allow anonymous CORS so the head rigger can read pixels. If it does not, download the PNG and use Choose image.';
    setStatus('Could not load sprite: '+displayPath+'\n'+spriteLoadDebug.lastError,false);
  };
  image.src=url;
}
function loadLocalImage(file){if(!file)return;loadImageUrl(URL.createObjectURL(file),file.name)}
