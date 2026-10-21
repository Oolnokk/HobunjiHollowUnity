// Two-spline Omgurku connector author: shared Pants Rig five-point editor UX.
// Source seams live on uploaded PNG; upper target is the canonical Engh-Sho
// pants waistband, lower target is an editable five-point animal-neck fit.
(() => {
'use strict';
const $=id=>document.getElementById(id);
const bridge=()=>window.HobunjiOmgurkuConnector;
const species=()=>window.HobunjiOmgurkuSpecies;
const defaults=()=>JSON.parse(JSON.stringify(bridge().defaults));
const state={settings:null,image:null,dataUrl:null,mode:'sourceTop',drag:null,dirty:false};
const color={sourceTop:'#adff38',sourceBottom:'#ffae52',animalNeck:'#ffae52'};
const clamp=(v,min=0,max=1)=>Math.max(min,Math.min(max,Number(v)||0));
const cpy=object=>JSON.parse(JSON.stringify(object));
function tell(message,bad=false){
 const e=$('connectorFeedback');e.textContent=message;e.style.color=bad?'#ffa6aa':'#75edc1';
}
function rectFor(canvas,img){
 const cw=canvas.width,ch=canvas.height;
 const w=img?.naturalWidth||img?.width||cw,h=img?.naturalHeight||img?.height||ch;
 const scale=Math.min(cw/w,ch/h);
 return {x:(cw-w*scale)/2,y:(ch-h*scale)/2,w:w*scale,h:h*scale};
}
function drawCanvas(id,image,points,extraPoints=null){
 const canvas=$(id),g=canvas.getContext('2d'),w=canvas.width,h=canvas.height;
 g.fillStyle='#0a1522';g.fillRect(0,0,w,h);
 // Transparent checkerboard; no guide pixels are written to PNG exports.
 for(let y=0;y<h;y+=16)for(let x=0;x<w;x+=16)if((x+y)/16%2===0){
   g.fillStyle='#ffffff08';g.fillRect(x,y,16,16);
 }
 const rect=rectFor(canvas,image);
 if(image && (!('complete' in image)||image.complete) && (image.naturalWidth||image.width)){g.imageSmoothingEnabled=false;g.drawImage(image,rect.x,rect.y,rect.w,rect.h);}
 if(!image){
   g.fillStyle='#9ab9d3';g.font='13px system-ui';
   g.fillText(id==='connectorSourceCanvas'?'Upload a transparent connector PNG':'Waiting for gameplay sprite…',12,h/2);
 }
 function line(arr,shade){
   if(!arr)return;
   g.strokeStyle=shade;g.lineWidth=2.6;g.beginPath();
   arr.forEach((pt,i)=>{const x=rect.x+pt.x*rect.w,y=rect.y+pt.y*rect.h;
     if(!i)g.moveTo(x,y);else g.lineTo(x,y);
   });g.stroke();
   arr.forEach((pt,i)=>{
     const x=rect.x+pt.x*rect.w,y=rect.y+pt.y*rect.h;
     g.fillStyle='#07141f';g.beginPath();g.arc(x,y,7,0,Math.PI*2);g.fill();
     g.strokeStyle=shade;g.lineWidth=2.7;g.stroke();
     g.font='11px system-ui';g.fillStyle='#fff';g.fillText(String(i+1),x+8,y-5);
   });
 }
 line(extraPoints,extraPoints?'#ffae52':null);
 line(points,extraPoints?'#adff38':color[state.mode]||'#adff38');
 return rect;
}
let positions={};
function refresh(){
 if(!state.settings)return;
 positions.source=drawCanvas('connectorSourceCanvas',state.image,
   state.settings.sourceTop,state.settings.sourceBottom);
 const front=$('portrait');
 positions.rider=drawCanvas('connectorRiderCanvas',front,bridge().belt());
 const animal=window.HobunjiOmgurkuCalibration?.context?.()?.image||null;
 positions.animal=drawCanvas('connectorAnimalCanvas',animal,state.settings.animalNeck);
 $('connectorOpacity').value=String(state.settings.opacity);
 $('connectorOpacityValue').textContent=Math.round(state.settings.opacity*100)+'%';
 $('connectorSourceTopBtn').classList.toggle('good',state.mode==='sourceTop');
 $('connectorSourceBottomBtn').classList.toggle('good',state.mode==='sourceBottom');
 $('connectorAssetStatus').textContent=state.image
   ? 'Connector PNG loaded: '+state.image.naturalWidth+' × '+state.image.naturalHeight+'; '+(state.dirty?'unsaved calibration':'ready')
   : 'No PNG uploaded. The connector remains disabled until artwork is supplied.';
}
function apply(){
 if(!state.settings)return;
 const next=cpy(state.settings);
 next.enabled=state.settings.enabled===true;
 if(state.dataUrl)next.imageDataUrl=state.dataUrl;
 const accepted=species()?.setConnector?.(next);
 if(!accepted){tell('Connector runtime is not ready yet.',true);return;}
 state.dirty=true;
 refresh();
}
function pointerRig(canvasKey,field,rectName){
 const canvas=$(canvasKey);
 const getCoords=event=>{
  const bound=canvas.getBoundingClientRect(),rect=positions[rectName];
  const cx=(event.clientX-bound.left)/bound.width*canvas.width;
  const cy=(event.clientY-bound.top)/bound.height*canvas.height;
  return {x:clamp((cx-rect.x)/rect.w),y:clamp((cy-rect.y)/rect.h),
    px:cx,py:cy};
 };
 canvas.addEventListener('pointerdown',event=>{
  if(!state.settings)return;
  const key=field==='source'?state.mode:field;
  const points=state.settings[key];if(!Array.isArray(points))return;
  const coords=getCoords(event),rect=positions[rectName];
  const distances=points.map(p=>Math.hypot((p.x-coords.x)*rect.w,(p.y-coords.y)*rect.h));
  const min=Math.min(...distances);
  if(min>32)return; // Must grab an actual control-point handle, not blank art.
  state.drag={id:event.pointerId,key,index:distances.indexOf(min),canvas};
  canvas.setPointerCapture(event.pointerId);
  event.preventDefault();
 });
 canvas.addEventListener('pointermove',event=>{
  if(!state.drag||state.drag.id!==event.pointerId||state.drag.canvas!==canvas)return;
  const coords=getCoords(event),p=state.settings[state.drag.key][state.drag.index];
  p.x=coords.x;p.y=coords.y;
  // Author controls are normalized just like the Pants Rig Author; each of
  // the five paired source nodes is an exact interpolation landmark.
  apply();
 });
 for(const event of ['pointerup','pointercancel','lostpointercapture'])
  canvas.addEventListener(event,()=>{state.drag=null;});
}
async function png(file){
 if(!file)return;
 if(file.type!=='image/png' && !file.name.toLowerCase().endsWith('.png')){
   tell('Please select a PNG image, preferably with transparency.',true);return;
 }
 if(file.size>1800000){tell('PNG exceeds 1.8 MB local-storage budget. Export a smaller lossless PNG.',true);return;}
 const url=await new Promise((resolve,reject)=>{
   const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));
   reader.onerror=reject;reader.readAsDataURL(file);
 });
 const image=new Image();
 await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error('PNG decode failed'));image.src=url;});
 if(!image.naturalWidth||!image.naturalHeight)throw Error('Empty connector image');
 if(!bridge().normalize({imageDataUrl:url}).imageDataUrl)throw Error('PNG exceeds the browser storage budget.');
 state.image=image;state.dataUrl=url;state.settings.enabled=true;
 apply();tell('Connector uploaded. Drag the two source seams and the animal-neck spline.');
}
function download(name,data,mime){
 const blob=data instanceof Blob?data:new Blob([data],{type:mime||'application/json'});
 const url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download=name;document.body.append(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),700);
}
async function importRig(file){
 if(!file)return;
 try{
   const j=JSON.parse(await file.text()),src=j.connector||j;
   if(src.schema!==bridge().schema)throw Error('Expected a hobunji.omgurku-connector.v1 rig');
   for(const key of ['sourceTop','sourceBottom','animalNeck'])
     if(!bridge().validateFivePointSpline(src[key]))throw Error('Invalid five-point '+key+' spline');
   importConfig(src);
   tell('Imported both connector source seams and animal neck fit.');
 }catch(error){tell('Import failed: '+error.message,true);}
}
function importConfig(config){
 const next=bridge().normalize(config); // Rig-only imports retain an already uploaded PNG.
 if(state.dataUrl && !next.imageDataUrl)next.imageDataUrl=state.dataUrl;
 species().setConnector(next);
 state.settings=null;state.dirty=false;
 previewReady();state.dirty=true;
 refresh();
}
function previewReady(){
 const current=bridge()?.snapshot({includeImage:true});
 if(!state.dirty && current){
   state.settings=bridge().normalize(current);
   delete state.settings.imageDataUrl; // Artwork is held separately, so dragging clones only small rig settings.
   state.dataUrl=current.imageDataUrl||null;
   const url=state.dataUrl || (current.enabled?new URL('../../'+current.assetPath,location.href).href:null); // Preview saved and authored artwork too.
   if(url && state.image?.src!==url){
     const img=new Image(); // Do not let an older PNG load overwrite a later import/reset.
     img.crossOrigin='anonymous';
     state.image=img;
     img.onload=()=>{if(state.image===img)refresh();};
     img.onerror=()=>{if(state.image===img){state.image=null;refresh();tell('Connector PNG could not load.',true);}};
     img.src=url;
   }else if(!url)state.image=null;
 }
 refresh();
}

function hook(){
 $('connectorFile').addEventListener('change',async e=>{
   try{await png(e.target.files?.[0]);}catch(error){tell(error.message,true);}
   e.target.value='';
 });
 $('connectorSourceTopBtn').addEventListener('click',()=>{state.mode='sourceTop';refresh();});
 $('connectorSourceBottomBtn').addEventListener('click',()=>{state.mode='sourceBottom';refresh();});
 pointerRig('connectorSourceCanvas','source','source');
 pointerRig('connectorAnimalCanvas','animalNeck','animal');
 $('connectorOpacity').addEventListener('input',()=>{
   if(!state.settings)return;
   state.settings.opacity=clamp($('connectorOpacity').value);
   apply();
 });
 $('connectorSave').addEventListener('click',()=>{
   if(!state.settings?.enabled){tell('Upload a connector PNG before applying it.',true);return;}
   try{
     const out={...cpy(state.settings),imageDataUrl:state.dataUrl||undefined};
     species().setConnector(out,{persist:true});
     state.dirty=false;refresh();
     tell('Saved to this browser. Open this same build’s game to preview the connector.');
   }catch(error){tell('Save failed: '+error.message,true);}
 });
 $('connectorClear').addEventListener('click',()=>{
   bridge().reset();
   state.settings=defaults();state.image=null;state.dataUrl=null;
   species().setConnector(state.settings);
   state.dirty=false;refresh();
   tell('Connector hidden; local connector override cleared.');
 });
 $('connectorExport').addEventListener('click',()=>{
   const out={schema:bridge().schema,connector:bridge().snapshot()};
   download('omgurku-connector-rig.json',JSON.stringify(out,null,2)+'\n');
 });
 $('connectorDownloadPng').addEventListener('click',()=>{
   if(!state.dataUrl){tell('Upload a PNG first.',true);return;}
   const a=document.createElement('a');
   a.href=state.dataUrl;a.download='omgurku-connector.png';document.body.append(a);a.click();a.remove();
 });
 $('connectorImport').addEventListener('click',()=>$('connectorImportFile').click());
 $('connectorImportFile').addEventListener('change',e=>{
   importRig(e.target.files?.[0]);e.target.value='';
 });
}
window.HobunjiOmgurkuConnectorAuthor={
 previewReady,importConfig,
 exportConfig:()=>bridge()?.snapshot()||defaults(),
 snapshot:()=>({enabled:state.settings?.enabled===true,uploaded:!!state.dataUrl,
  top:state.settings?.sourceTop?.length||0,bottom:state.settings?.sourceBottom?.length||0,
  neck:state.settings?.animalNeck?.length||0,dirty:state.dirty,
  live:bridge()?.live?.size||0})
};
hook();previewReady();
})();