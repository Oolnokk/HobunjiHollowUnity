(() => {
'use strict';

const API_POLL_MS=180; // Poll interval while the split core editor and repository assets finish loading.
const zipEncoder=new TextEncoder(); // Encodes ZIP member names and manifest text as UTF-8 bytes.
const crcTable=(()=>{
  const table=new Uint32Array(256); // Shared CRC-32 lookup table for the dependency-free ZIP writer.
  for(let n=0;n<256;n++){
    let c=n; // Builds one standard ZIP CRC-32 table entry.
    for(let k=0;k<8;k++)c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);
    table[n]=c>>>0;
  }
  return table;
})();

let api=null; // Receives the narrow deformation/source bridge exposed by the core clothing editor.
let ui=null; // Holds injected behind-sprite authoring controls.
let catalog=[]; // Current exact repository image layers available for the selected garment/body mode.
let currentSource=null; // Loaded base sprite descriptor + native canvas.
let patch=null; // Session-only corrective PNG that is composited over the current source sprite.
let patchTransform={x:0,y:0,scaleX:1,scaleY:1}; // Positions/scales cropped patches before species deformation.
let batch=[]; // Saved behind-sprite jobs for the current target species+gender.
let targetKey=''; // Detects target changes so queued jobs cannot be exported through the wrong deformation grid.
let exporting=false; // Prevents overlapping PNG/ZIP exports on slower mobile browsers.
let drag=null; // Pointer-drag state for moving a cropped patch directly in the source preview.

function waitForApi(){
  api=window.ClothingSpeciesFitTool||null;
  if(!api){setTimeout(waitForApi,API_POLL_MS);return}
  buildUi();
  refreshCatalog(true);
  setInterval(syncFromCore,API_POLL_MS*4);
}

function buildUi(){
  const section=document.createElement('section'); // Adds the intended front-art-to-behind-art workflow beside the existing editor controls.
  section.id='behindSpritePatchSection';
  section.innerHTML=`
    <h2>Behind sprite patch author</h2>
    <div class="small">Build rear-view sprites from existing front artwork. Pick a clothing or body layer, overlay a corrective PNG (for cleavage, front-only seams/details, etc.), then run the combined art through this species/gender's final 6×6 deformation.</div>
    <div class="field"><label for="behindPatchKind">Source type</label><select id="behindPatchKind"><option value="clothing">Selected clothing piece</option><option value="body">Body sprite</option></select></div>
    <div class="field"><label for="behindPatchSource">Existing source layer</label><select id="behindPatchSource"></select></div>
    <div class="field"><label for="behindPatchFile">Corrective patch PNG</label><input id="behindPatchFile" type="file" accept="image/png,.png"></div>
    <div class="row">
      <label class="small">X <input id="behindPatchX" type="number" step="1" value="0" style="width:72px"></label>
      <label class="small">Y <input id="behindPatchY" type="number" step="1" value="0" style="width:72px"></label>
    </div>
    <div class="row">
      <label class="small">Scale X <input id="behindPatchScaleX" type="number" step="0.01" min="0.01" value="1" style="width:72px"></label>
      <label class="small">Scale Y <input id="behindPatchScaleY" type="number" step="0.01" min="0.01" value="1" style="width:72px"></label>
    </div>
    <div class="row"><button id="behindPatchReset">Reset patch placement</button><button id="behindPatchFit">Fit patch canvas to base</button></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:7px">
      <div><div class="small">Source + corrective patch</div><canvas id="behindPatchSourcePreview" width="234" height="173" style="display:block;width:100%;height:auto;image-rendering:pixelated;background:#0b1018;border:1px solid #26384f;touch-action:none"></canvas></div>
      <div><div class="small">Deformed behind output</div><canvas id="behindPatchOutputPreview" width="234" height="173" style="display:block;width:100%;height:auto;image-rendering:pixelated;background:#0b1018;border:1px solid #26384f"></canvas></div>
    </div>
    <div class="row" style="margin-top:7px"><button id="behindPatchAdd">Save / replace in ZIP batch</button><button id="behindPatchPng">Export current behind PNG</button></div>
    <div class="row"><button id="behindPatchZip">Export behind sprites ZIP</button><button id="behindPatchClear">Clear ZIP batch</button></div>
    <div id="behindPatchStatus" class="importStatus">Waiting for repository assets…</div>
    <div id="behindPatchJobs" class="small" style="white-space:pre-wrap;margin-top:5px">ZIP batch: empty</div>`;

  const downloads=[...document.querySelectorAll('.controls section')].find(candidate=>candidate.querySelector('h2')?.textContent.trim()==='Downloads'); // Keeps the new workflow next to the editor's existing export controls.
  if(downloads)downloads.before(section);else document.querySelector('.controls')?.appendChild(section);

  ui={
    section,
    kind:section.querySelector('#behindPatchKind'), // Switches between the selected garment's exact image layers and Mao-ao body layers.
    source:section.querySelector('#behindPatchSource'), // Chooses the exact repository raster to patch.
    file:section.querySelector('#behindPatchFile'), // Loads one transparent corrective PNG locally.
    x:section.querySelector('#behindPatchX'),y:section.querySelector('#behindPatchY'), // Patch translation in source pixels.
    scaleX:section.querySelector('#behindPatchScaleX'),scaleY:section.querySelector('#behindPatchScaleY'), // Independent patch scale before deformation.
    reset:section.querySelector('#behindPatchReset'),fit:section.querySelector('#behindPatchFit'), // Placement shortcuts for full-canvas and cropped patches.
    sourcePreview:section.querySelector('#behindPatchSourcePreview'), // Displays the exact source raster plus corrective overlay.
    outputPreview:section.querySelector('#behindPatchOutputPreview'), // Displays the final target-species deformation.
    add:section.querySelector('#behindPatchAdd'),png:section.querySelector('#behindPatchPng'), // Saves a job or exports the current result.
    zip:section.querySelector('#behindPatchZip'),clear:section.querySelector('#behindPatchClear'), // Packages all saved jobs or empties the queue.
    status:section.querySelector('#behindPatchStatus'),jobs:section.querySelector('#behindPatchJobs') // In-tool mobile diagnostics and queue summary.
  };

  ui.kind.addEventListener('change',()=>refreshCatalog(true));
  ui.source.addEventListener('change',loadSelectedSource);
  ui.file.addEventListener('change',importPatch);
  for(const input of [ui.x,ui.y,ui.scaleX,ui.scaleY])input.addEventListener('input',readTransformAndRender);
  ui.reset.addEventListener('click',resetPatchPlacement);
  ui.fit.addEventListener('click',fitPatchToBase);
  ui.add.addEventListener('click',saveCurrentJob);
  ui.png.addEventListener('click',exportCurrentPng);
  ui.zip.addEventListener('click',exportBatchZip);
  ui.clear.addEventListener('click',clearBatch);
  ui.sourcePreview.addEventListener('pointerdown',startPatchDrag);
  ui.sourcePreview.addEventListener('pointermove',movePatchDrag);
  ui.sourcePreview.addEventListener('pointerup',endPatchDrag);
  ui.sourcePreview.addEventListener('pointercancel',endPatchDrag);
}

function coreKey(info){return `${info.targetSpecies||''}::${info.gender||''}`} // One ZIP batch may only use one species+gender deformation grid.

function syncFromCore(){
  if(!api||!ui)return;
  const info=api.getOutputInfo();
  const nextKey=coreKey(info);
  if(targetKey&&nextKey!==targetKey&&batch.length){
    batch=[]; // Prevents previously saved sprites from silently being deformed with a newly selected target grid.
    renderJobs('Target species/gender changed; cleared the ZIP batch so old jobs cannot export with the wrong fit.');
  }
  if(nextKey!==targetKey){
    targetKey=nextKey;
    refreshCatalog(false);
  }else{
    const garmentId=info.garmentId||'';
    if(ui.kind.value==='clothing'&&ui.section.dataset.garmentId!==garmentId)refreshCatalog(false);
  }
  setDisabledState();
  if(!exporting)renderStatus();
}

function refreshCatalog(forceSelect){
  if(!api||!ui)return;
  const info=api.getOutputInfo();
  targetKey=coreKey(info);
  ui.section.dataset.garmentId=info.garmentId||'';
  const prior=forceSelect?'':ui.source.value;
  catalog=(api.getBehindPatchCatalog()||[]).filter(item=>item.kind===ui.kind.value&&item.view!=='back'); // Existing dedicated rear layers are not offered as front-art sources.
  ui.source.innerHTML='';
  for(const item of catalog){
    const option=document.createElement('option'); // Shows exact layer identity and target pairing availability.
    option.value=item.id;
    option.textContent=`${item.label}${item.targetUrl?'':' • no exact target counterpart'}`;
    ui.source.appendChild(option);
  }
  if(prior&&catalog.some(item=>item.id===prior))ui.source.value=prior;
  currentSource=null;
  if(ui.source.value)loadSelectedSource();else renderPreviews();
  renderStatus();
}

async function loadSelectedSource(){
  if(!ui.source.value){currentSource=null;renderPreviews();renderStatus();return}
  setBusyStatus('Loading existing source layer…');
  try{
    currentSource=await api.loadBehindPatchSource(ui.source.value); // Loads exact source pixels through the editor's repository resolver.
    renderPreviews();
    renderStatus();
  }catch(error){
    currentSource=null;
    reportError(error);
  }
}

function loadLocalPng(file){
  return new Promise((resolve,reject)=>{
    if(!file||(!/\.png$/i.test(file.name)&&file.type!=='image/png')){reject(new Error('Corrective patch must be a PNG.'));return}
    const url=URL.createObjectURL(file); // Local patch never leaves the browser.
    const image=new Image(); // Browser decoder preserves the source alpha channel.
    image.onload=()=>{
      URL.revokeObjectURL(url);
      const canvas=document.createElement('canvas'); // Native patch pixels are retained for compositing.
      canvas.width=image.naturalWidth||image.width;canvas.height=image.naturalHeight||image.height;
      const context=canvas.getContext('2d',{alpha:true});context.imageSmoothingEnabled=false;context.drawImage(image,0,0);
      resolve({name:file.name,canvas,width:canvas.width,height:canvas.height});
    };
    image.onerror=()=>{URL.revokeObjectURL(url);reject(new Error(`Could not decode ${file.name}.`))};
    image.src=url;
  });
}

async function importPatch(){
  const file=ui.file.files?.[0]||null;
  if(!file)return;
  try{
    patch=await loadLocalPng(file); // Replaces the current corrective layer while preserving source selection.
    resetPatchPlacement(false);
    renderPreviews();
    renderStatus();
    api.logMessage(`Loaded behind-sprite corrective patch: ${file.name}`);
  }catch(error){reportError(error)}
  finally{ui.file.value=''}
}

function numeric(input,fallback){
  const value=Number(input.value);return Number.isFinite(value)?value:fallback; // Guards malformed mobile number input values.
}
function readTransformAndRender(){
  patchTransform={
    x:numeric(ui.x,0),y:numeric(ui.y,0),
    scaleX:Math.max(.01,numeric(ui.scaleX,1)),
    scaleY:Math.max(.01,numeric(ui.scaleY,1))
  };
  renderPreviews();
}
function writeTransform(){
  ui.x.value=String(roundDisplay(patchTransform.x));ui.y.value=String(roundDisplay(patchTransform.y));
  ui.scaleX.value=String(roundDisplay(patchTransform.scaleX));ui.scaleY.value=String(roundDisplay(patchTransform.scaleY));
}
function roundDisplay(value){return Math.round(value*1000)/1000}

function resetPatchPlacement(render=true){
  patchTransform={x:0,y:0,scaleX:1,scaleY:1}; // Full-canvas patches align directly with their source raster by default.
  writeTransform();
  if(render)renderPreviews();
}
function fitPatchToBase(){
  if(!patch||!currentSource)return;
  patchTransform={
    x:0,y:0,
    scaleX:currentSource.canvas.width/Math.max(1,patch.canvas.width),
    scaleY:currentSource.canvas.height/Math.max(1,patch.canvas.height)
  }; // Useful when the corrective art was authored on a differently sized full canvas.
  writeTransform();renderPreviews();
}

function composeSource(baseCanvas,patchCanvas,transform){
  const out=document.createElement('canvas'); // Combined front art + corrective overlay becomes the rear-view source before deformation.
  out.width=baseCanvas.width;out.height=baseCanvas.height;
  const context=out.getContext('2d',{alpha:true});context.imageSmoothingEnabled=false;
  context.drawImage(baseCanvas,0,0);
  if(patchCanvas){
    const width=patchCanvas.width*transform.scaleX,height=patchCanvas.height*transform.scaleY;
    context.drawImage(patchCanvas,transform.x,transform.y,width,height); // Transparent patch pixels leave the original source untouched.
  }
  return out;
}

function currentComposite(){
  if(!currentSource)return null;
  return composeSource(currentSource.canvas,patch?.canvas||null,patchTransform);
}
function currentOutput(){
  const composite=currentComposite();
  return composite?api.warpBehindPatchCanvas(composite):null; // Reuses the core final transform + 6×6 deformation instead of duplicating warp math.
}

function copyCanvasToPreview(source,target){
  if(!source){target.width=234;target.height=173;target.getContext('2d').clearRect(0,0,target.width,target.height);return}
  target.width=source.width;target.height=source.height;
  const context=target.getContext('2d',{alpha:true});context.imageSmoothingEnabled=false;context.clearRect(0,0,target.width,target.height);context.drawImage(source,0,0);
}
function renderPreviews(){
  try{
    copyCanvasToPreview(currentComposite(),ui.sourcePreview);
    copyCanvasToPreview(currentSource?currentOutput():null,ui.outputPreview);
  }catch(error){reportError(error)}
  setDisabledState();
}

function previewPointer(event){
  const rect=ui.sourcePreview.getBoundingClientRect(); // Converts CSS-scaled mobile coordinates back to native source pixels.
  return{x:(event.clientX-rect.left)*(ui.sourcePreview.width/Math.max(1,rect.width)),y:(event.clientY-rect.top)*(ui.sourcePreview.height/Math.max(1,rect.height))};
}
function startPatchDrag(event){
  if(!patch||!currentSource)return;
  const point=previewPointer(event);
  drag={x:point.x,y:point.y,startX:patchTransform.x,startY:patchTransform.y}; // Moves only the corrective patch; repository source pixels remain fixed.
  ui.sourcePreview.setPointerCapture?.(event.pointerId);event.preventDefault();
}
function movePatchDrag(event){
  if(!drag)return;
  const point=previewPointer(event);
  patchTransform.x=drag.startX+(point.x-drag.x);patchTransform.y=drag.startY+(point.y-drag.y);
  writeTransform();renderPreviews();event.preventDefault();
}
function endPatchDrag(event){
  drag=null;
  if(event?.pointerId!=null&&ui.sourcePreview.hasPointerCapture?.(event.pointerId))ui.sourcePreview.releasePointerCapture(event.pointerId);
}

function basename(path){
  return String(path||'sprite.png').replace(/[?#].*$/,'').split('/').pop()||'sprite.png'; // Extracts a safe filename from config URLs.
}
function splitExtension(name){
  const match=String(name).match(/^(.*?)(\.[^.]+)?$/);return{stem:match?.[1]||name,ext:match?.[2]||'.png'}; // Keeps PNG extension handling centralized.
}
function outputNameFor(descriptor){
  const basis=basename(descriptor.targetUrl||descriptor.sourceUrl);
  const {stem}=splitExtension(basis);
  if(descriptor.kind==='body'){
    const bodyMatch=stem.match(/^(torso|arm-L|arm-R)(_.+)$/i);
    if(bodyMatch)return `${bodyMatch[1]}-behind${bodyMatch[2]}.png`; // Mirrors the repo's existing head-behind_* naming style for new body rear art.
    return `${stem}-behind.png`;
  }
  if(/(^|[-_])front($|[-_])/i.test(stem))return `${stem.replace(/(^|[-_])front(?=$|[-_])/i,'$1back')}.png`; // Existing clothing configs commonly pair -front/-back rasters.
  return `${stem}-back.png`;
}
function outputRepoPathFor(descriptor,outputName){
  const target=descriptor.targetUrl||descriptor.sourceUrl||'';
  const normalized=String(target).replace(/^\.\//,'').replace(/^assets\//,'');
  const slash=normalized.lastIndexOf('/');
  return slash>=0?`${normalized.slice(0,slash+1)}${outputName}`:outputName; // Manifest path is relative to docs/assets when the source config uses an asset URL.
}

function cloneTransform(transform){return{x:transform.x,y:transform.y,scaleX:transform.scaleX,scaleY:transform.scaleY}}

function saveCurrentJob(){
  if(!currentSource||!patch){renderStatus('Load a corrective PNG before saving this behind sprite.');return}
  const descriptor={...currentSource.descriptor,layerPath:[...(currentSource.descriptor.layerPath||[])]}; // Snapshot survives later garment/source selection changes.
  const key=descriptor.id; // One saved job per exact source layer; saving again replaces the older patch.
  const job={
    key,
    descriptor,
    baseCanvas:currentSource.canvas,
    patchCanvas:patch.canvas,
    patchName:patch.name,
    transform:cloneTransform(patchTransform),
    outputName:outputNameFor(descriptor)
  };
  const index=batch.findIndex(item=>item.key===key);
  if(index>=0)batch[index]=job;else batch.push(job);
  renderJobs();
  renderStatus(`Saved ${job.outputName} to the ZIP batch.`);
}

function clearBatch(){
  batch=[];renderJobs();renderStatus('Cleared behind-sprite ZIP batch.'); // Does not discard the current patch or source preview.
}

function renderJobs(note=''){
  if(!ui)return;
  const lines=[`ZIP batch: ${batch.length||'empty'}`];
  for(const job of batch)lines.push(`• ${job.outputName} ← ${job.descriptor.label} + ${job.patchName}`);
  if(note)lines.push(note);
  ui.jobs.textContent=lines.join('\n');
  setDisabledState();
}

function canvasToPngBytes(canvas){
  return new Promise((resolve,reject)=>{
    canvas.toBlob(async blob=>{
      if(!blob){reject(new Error('Browser failed to encode the behind sprite as PNG.'));return}
      resolve(new Uint8Array(await blob.arrayBuffer())); // Encoded PNG bytes can be stored directly in the ZIP.
    },'image/png');
  });
}
function downloadBlob(blob,name){
  const url=URL.createObjectURL(blob); // Temporary browser-local URL triggers a normal mobile/desktop download.
  const anchor=document.createElement('a');anchor.href=url;anchor.download=name;document.body.appendChild(anchor);anchor.click();anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
}

async function exportCurrentPng(){
  if(!currentSource||!patch){renderStatus('Choose a source and corrective patch first.');return}
  try{
    const output=currentOutput();
    const blob=await new Promise((resolve,reject)=>output.toBlob(value=>value?resolve(value):reject(new Error('PNG encoding failed.')),'image/png'));
    const name=outputNameFor(currentSource.descriptor);
    downloadBlob(blob,name);
    api.logMessage(`Exported behind sprite ${name}.`);
    renderStatus(`Exported ${name}.`);
  }catch(error){reportError(error)}
}

function crc32(bytes){
  let crc=0xffffffff; // ZIP-standard CRC-32 over one stored member.
  for(let index=0;index<bytes.length;index++)crc=crcTable[(crc^bytes[index])&0xff]^(crc>>>8);
  return(crc^0xffffffff)>>>0;
}
function dosDateTime(date){
  const year=Math.max(1980,date.getFullYear()); // ZIP timestamp fields use DOS local date/time.
  return{
    time:((date.getHours()&31)<<11)|((date.getMinutes()&63)<<5)|((Math.floor(date.getSeconds()/2))&31),
    day:(((year-1980)&127)<<9)|(((date.getMonth()+1)&15)<<5)|(date.getDate()&31)
  };
}
function writeU16(view,offset,value){view.setUint16(offset,value&0xffff,true)}
function writeU32(view,offset,value){view.setUint32(offset,value>>>0,true)}
function makeLocalHeader(nameBytes,dataBytes,crc,stamp){
  const header=new Uint8Array(30+nameBytes.length); // Local file header for an uncompressed/stored member.
  const view=new DataView(header.buffer);
  writeU32(view,0,0x04034b50);writeU16(view,4,20);writeU16(view,6,0x0800);writeU16(view,8,0);
  writeU16(view,10,stamp.time);writeU16(view,12,stamp.day);writeU32(view,14,crc);
  writeU32(view,18,dataBytes.length);writeU32(view,22,dataBytes.length);writeU16(view,26,nameBytes.length);writeU16(view,28,0);
  header.set(nameBytes,30);return header;
}
function makeCentralHeader(nameBytes,dataBytes,crc,stamp,localOffset){
  const header=new Uint8Array(46+nameBytes.length); // Central-directory record pointing back to the member's local header.
  const view=new DataView(header.buffer);
  writeU32(view,0,0x02014b50);writeU16(view,4,20);writeU16(view,6,20);writeU16(view,8,0x0800);writeU16(view,10,0);
  writeU16(view,12,stamp.time);writeU16(view,14,stamp.day);writeU32(view,16,crc);
  writeU32(view,20,dataBytes.length);writeU32(view,24,dataBytes.length);writeU16(view,28,nameBytes.length);
  writeU16(view,30,0);writeU16(view,32,0);writeU16(view,34,0);writeU16(view,36,0);writeU32(view,38,0);writeU32(view,42,localOffset);
  header.set(nameBytes,46);return header;
}
function buildStoredZip(entries){
  const localParts=[],centralParts=[],stamp=dosDateTime(new Date()); // PNGs are already compressed, so store them without wasteful recompression.
  let localOffset=0,centralSize=0;
  for(const entry of entries){
    const nameBytes=zipEncoder.encode(entry.name),checksum=crc32(entry.bytes);
    const localHeader=makeLocalHeader(nameBytes,entry.bytes,checksum,stamp);
    const centralHeader=makeCentralHeader(nameBytes,entry.bytes,checksum,stamp,localOffset);
    localParts.push(localHeader,entry.bytes);centralParts.push(centralHeader);
    localOffset+=localHeader.length+entry.bytes.length;centralSize+=centralHeader.length;
  }
  const end=new Uint8Array(22); // End-of-central-directory record makes the archive readable by ordinary unzip tools.
  const view=new DataView(end.buffer);
  writeU32(view,0,0x06054b50);writeU16(view,4,0);writeU16(view,6,0);writeU16(view,8,entries.length);writeU16(view,10,entries.length);
  writeU32(view,12,centralSize);writeU32(view,16,localOffset);writeU16(view,20,0);
  return new Blob([...localParts,...centralParts,end],{type:'application/zip'});
}
function uniqueName(name,used){
  const lower=name.toLowerCase();
  if(!used.has(lower)){used.add(lower);return name}
  const {stem,ext}=splitExtension(name);
  let index=2,candidate=`${stem}_${index}${ext}`; // Avoids collisions when multiple source layers would otherwise suggest the same rear filename.
  while(used.has(candidate.toLowerCase()))candidate=`${stem}_${++index}${ext}`;
  used.add(candidate.toLowerCase());return candidate;
}

async function renderJob(job){
  const composite=composeSource(job.baseCanvas,job.patchCanvas,job.transform); // Recreates the exact source + patch snapshot saved by the user.
  return api.warpBehindPatchCanvas(composite); // Batch jobs all use the current target's final 6×6 fit.
}

async function exportBatchZip(){
  if(exporting||!batch.length)return;
  exporting=true;setDisabledState();
  const info=api.getOutputInfo();
  const entries=[],used=new Set(),manifest={
    format:'hobunji-behind-sprite-patch-batch-v1',
    exportedAt:new Date().toISOString(),
    targetSpecies:info.targetSpecies,
    gender:info.gender,
    files:[]
  }; // Manifest makes every generated raster traceable back to its exact repository source and corrective patch.
  try{
    for(let index=0;index<batch.length;index++){
      const job=batch[index];
      ui.status.textContent=`Baking ${index+1}/${batch.length}: ${job.outputName}`;
      const output=await renderJob(job);
      const bytes=await canvasToPngBytes(output);
      const finalName=uniqueName(job.outputName,used);
      entries.push({name:finalName,bytes});
      manifest.files.push({
        outputName:finalName,
        suggestedRepoPath:outputRepoPathFor(job.descriptor,finalName),
        kind:job.descriptor.kind,
        garmentId:job.descriptor.garmentId||null,
        bodyLayerId:job.descriptor.layerId||null,
        sourceUrl:job.descriptor.sourceUrl,
        targetFrontUrl:job.descriptor.targetUrl||null,
        sourceSpecies:job.descriptor.sourceSpecies,
        targetSpecies:job.descriptor.targetSpecies,
        gender:job.descriptor.gender,
        patchFile:job.patchName,
        patchTransform:job.transform
      });
    }
    const manifestBytes=zipEncoder.encode(JSON.stringify(manifest,null,2)); // JSON is stored alongside PNGs so later config wiring does not require guesswork.
    entries.push({name:'behind-sprite-manifest.json',bytes:manifestBytes});
    const zip=buildStoredZip(entries);
    const archiveName=`behind_sprites_${safeToken(info.targetSpecies)}_${safeToken(info.gender)}.zip`;
    downloadBlob(zip,archiveName);
    api.logMessage(`Exported ${batch.length} patched behind sprite${batch.length===1?'':'s'} as ${archiveName}.`);
    renderStatus(`Exported ${archiveName}.`);
  }catch(error){reportError(error)}
  finally{exporting=false;setDisabledState()}
}
function safeToken(value){return String(value||'unknown').replace(/[^a-z0-9_-]+/gi,'_').replace(/^_+|_+$/g,'')||'unknown'}

function setBusyStatus(message){if(ui)ui.status.textContent=message}
function reportError(error){
  console.error(error);
  const message=String(error?.message||error);
  if(api)api.logMessage(`Behind sprite patch error: ${message}`);
  renderStatus(`ERROR: ${message}`);
}
function renderStatus(extra=''){
  if(!ui||!api)return;
  const info=api.getOutputInfo();
  const descriptor=currentSource?.descriptor||null;
  const lines=[];
  lines.push(info.ready?`target: ${info.targetSpecies} ${info.gender} → ${info.outputWidth}×${info.outputHeight}`:'target: repository assets still loading');
  if(ui.kind.value==='clothing')lines.push(`clothing: ${info.garmentLabel||'(choose a garment above)'}`);
  lines.push(`source: ${descriptor?descriptor.sourceUrl:'—'}`);
  lines.push(`target front counterpart: ${descriptor?.targetUrl||'—'}`);
  lines.push(`patch: ${patch?`${patch.name} (${patch.width}×${patch.height})`:'—'}`);
  if(currentSource&&patch&&(patch.width!==currentSource.canvas.width||patch.height!==currentSource.canvas.height))lines.push('PATCH SIZE NOTE: patch canvas differs from the source; drag it or use Fit patch canvas to base.');
  lines.push(`ZIP batch: ${batch.length}`);
  if(extra)lines.push(extra);
  ui.status.textContent=lines.join('\n');
  setDisabledState();
}
function setDisabledState(){
  if(!ui||!api)return;
  const ready=api.getOutputInfo().ready;
  ui.kind.disabled=!ready||exporting;
  ui.source.disabled=!ready||exporting||!catalog.length;
  ui.file.disabled=!ready||exporting||!currentSource;
  for(const input of [ui.x,ui.y,ui.scaleX,ui.scaleY])input.disabled=exporting||!patch;
  ui.reset.disabled=exporting||!patch;ui.fit.disabled=exporting||!patch||!currentSource;
  ui.add.disabled=exporting||!patch||!currentSource;ui.png.disabled=exporting||!patch||!currentSource;
  ui.zip.disabled=exporting||!batch.length;ui.clear.disabled=exporting||!batch.length;
}

waitForApi();
})();
