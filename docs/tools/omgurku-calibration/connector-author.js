// Two-spline Omgurku connector author: shared Pants Rig five-point editor UX.
// Source seams live on uploaded PNG; upper target is the canonical Engh-Sho
// pants waistband, lower target is an editable five-point animal-neck fit.
(() => {
'use strict';
const $=id=>document.getElementById(id);
const bridge=()=>window.HobunjiOmgurkuConnector;
const species=()=>window.HobunjiOmgurkuSpecies;
const defaults=()=>JSON.parse(JSON.stringify(bridge().defaults));
const state={settings:null,image:null,dataUrl:null,mode:'sourceTop',drag:null,dirty:false,history:[]};
const splineNames={sourceTop:'upper PNG seam',sourceBottom:'lower PNG seam',riderWaist:'rider waist',animalNeck:'animal neck'}; // User-facing names for edit feedback.
const color={sourceTop:'#adff38',sourceBottom:'#ffae52',animalNeck:'#ffae52',riderWaist:'#adff38'};
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
const arrows={}; // Current on-canvas arrow handles for pointer rotation.
const alphaCache=new WeakMap(); // Read clean PNG pixels only when the user asks to shrinkwrap.
const toolbars=[]; // Each canvas owns controls; the source canvas switches between its two seams.
const STEPS=[{label:'Fine',move:.004,scale:.01,rotate:.5},
 {label:'Medium',move:.012,scale:.03,rotate:2},{label:'Coarse',move:.04,scale:.08,rotate:6}]; // Match the Pants Rig Author's step sizes.
function pointsFor(field){return state.settings?.[field]||(field==='riderWaist'?bridge().belt():null);}
function imageFor(field){
 return field==='riderWaist'?$('portrait'):field==='animalNeck'
  ?window.HobunjiOmgurkuCalibration?.context?.()?.image:state.image;
}
function imageSize(image){return {width:image?.naturalWidth||image?.width||1,height:image?.naturalHeight||image?.height||1};}
function remember(){
 state.history.push(cpy(state.settings));
 if(state.history.length>50)state.history.shift();
}
function drawCanvas(id,image,fields){
 const canvas=$(id),g=canvas.getContext('2d'),w=canvas.width,h=canvas.height; // Guide-only canvas; shrinkwrap reads the original image instead.
 g.fillStyle='#0a1522';g.fillRect(0,0,w,h);
 for(let y=0;y<h;y+=16)for(let x=0;x<w;x+=16)if((x+y)/16%2===0){
   g.fillStyle='#ffffff08';g.fillRect(x,y,16,16);
 }
 const rect=rectFor(canvas,image); // Artwork and normalized points share this same aspect-preserving rectangle.
 if(image && (!('complete' in image)||image.complete) && (image.naturalWidth||image.width)){
   g.imageSmoothingEnabled=false;g.drawImage(image,rect.x,rect.y,rect.w,rect.h);
 }else{
   g.fillStyle='#9ab9d3';g.font='13px system-ui';
   g.fillText(id==='connectorSourceCanvas'?'Upload a transparent connector PNG':'Waiting for gameplay sprite…',12,h/2);
 }
 for(const field of fields){
   const points=pointsFor(field),shade=color[field]; // Draw all source seams with their own independent arrow.
   if(!points)continue;
   g.strokeStyle=shade;g.lineWidth=2.6;g.beginPath();
   points.forEach((pt,i)=>{const x=rect.x+pt.x*rect.w,y=rect.y+pt.y*rect.h; // Current handle position.
     if(!i)g.moveTo(x,y);else g.lineTo(x,y);
   });g.stroke();
   points.forEach((pt,i)=>{
     const x=rect.x+pt.x*rect.w,y=rect.y+pt.y*rect.h; // Node labels stay attached to the spline.
     g.fillStyle='#07141f';g.beginPath();g.arc(x,y,7,0,Math.PI*2);g.fill();
     g.strokeStyle=shade;g.lineWidth=2.7;g.stroke();
     g.font='11px system-ui';g.fillStyle='#fff';g.fillText(String(i+1),x+8,y-5);
   });
   const center=window.HobunjiPantsRig.centroid(points); // Keep the direction handle reachable even near image edges.
   const sx=rect.x+center.x*rect.w,sy=rect.y+center.y*rect.h; // True spline center for the small tether.
   const cx=clamp(sx,50,w-50),cy=clamp(sy,50,h-50); // Safe arrow origin inside the visible canvas.
   const angle=state.settings.shrinkwrapDirections[field]*Math.PI/180; // Pixel-space clockwise direction.
   const tx=cx+Math.cos(angle)*36,ty=cy+Math.sin(angle)*36; // Draggable arrow tip.
   arrows[field]={cx,cy,tx,ty};
   g.save();g.strokeStyle=shade;g.fillStyle=shade;g.lineWidth=3;
   g.setLineDash([3,4]);g.beginPath();g.moveTo(sx,sy);g.lineTo(cx,cy);g.stroke();g.setLineDash([]);
   g.beginPath();g.moveTo(cx,cy);g.lineTo(tx,ty);g.stroke();
   g.beginPath();g.moveTo(tx,ty);g.lineTo(tx-12*Math.cos(angle-.5),ty-12*Math.sin(angle-.5));
   g.lineTo(tx-12*Math.cos(angle+.5),ty-12*Math.sin(angle+.5));g.closePath();g.fill();
   g.beginPath();g.arc(tx,ty,9,0,Math.PI*2);g.stroke();g.restore();
 }
 return rect;
}
let positions={}; // Image rectangles shared with pointer hit testing.
function refresh(){
 if(!state.settings)return;
 positions.source=drawCanvas('connectorSourceCanvas',state.image,['sourceTop','sourceBottom']);
 const front=$('portrait');
 positions.rider=drawCanvas('connectorRiderCanvas',front,['riderWaist']);
 const animal=window.HobunjiOmgurkuCalibration?.context?.()?.image||null;
 positions.animal=drawCanvas('connectorAnimalCanvas',animal,['animalNeck']);
 for(const toolbar of toolbars){
   const field=toolbar.field(); // The source toolbar always edits the selected PNG seam.
   toolbar.angle.value=String(state.settings.shrinkwrapDirections[field]);
   toolbar.output.textContent=Math.round(state.settings.shrinkwrapDirections[field])+'°';
 }
 $('connectorUndo').disabled=!state.history.length;
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
function transform(field,change){
 if(!state.settings)return;
 try{
   const next=window.HobunjiPantsRig.transformSpline(pointsFor(field),change,imageSize(imageFor(field))); // Shared pixel-aware transform math.
   remember();state.settings[field]=next;apply();
   tell('Updated the whole '+splineNames[field]+' spline. Undo is available.');
 }catch(error){tell(error.message,true);}
}
function shrinkwrap(field){
 const image=imageFor(field); // Never read the guide canvas: its labels and arrows are opaque too.
 if(!image || ('complete' in image && !image.complete)){tell('Wait for the sprite or upload a PNG first.',true);return;}
 try{
   let pixels=alphaCache.get(image); // Cached until the portrait is rebuilt or a new PNG is selected.
   if(!pixels){
     const size=imageSize(image),canvas=document.createElement('canvas'); // Read the clean source at native resolution.
     canvas.width=size.width;canvas.height=size.height;
     const context=canvas.getContext('2d',{willReadFrequently:true}); // User-triggered alpha sampling.
     context.drawImage(image,0,0);pixels=context.getImageData(0,0,canvas.width,canvas.height);alphaCache.set(image,pixels);
   }
   const result=window.HobunjiPantsRig.shrinkwrapSplineToAlpha(pointsFor(field),pixels,state.settings.shrinkwrapDirections[field]); // First opaque pixels along this spline's arrow.
   if(result.hits){remember();state.settings[field]=result.points;apply();}
   tell('Shrinkwrapped '+splineNames[field]+': '+result.hits+'/5 points; '+result.misses+' missed and stayed in place.',!result.hits);
   return result;
 }catch(error){tell('Could not read sprite pixels: '+error.message,true);}
}
function installToolbar(id,field){
 const host=$(id),select=document.createElement('select'),buttons=document.createElement('div'); // Mobile-sized whole-spline controls.
 buttons.className='row';select.setAttribute('aria-label','Transform step size');
 STEPS.forEach((step,i)=>{const option=document.createElement('option');option.value=String(i);option.textContent=step.label;select.append(option);});
 host.append(select,buttons);
 const actions=[['left','←','Move left'],['right','→','Move right'],['up','↑','Move up'],['down','↓','Move down'],
  ['rotateLeft','Rotate −','Rotate anticlockwise'],['rotateRight','Rotate +','Rotate clockwise'],
  ['shrink','Scale −','Shrink whole spline'],['grow','Scale +','Grow whole spline'],
  ['narrower','Width −','Narrow spline'],['wider','Width +','Widen spline'],
  ['shorter','Height −','Flatten spline'],['taller','Height +','Increase spline height']]; // Operations apply to all five points around their shared center.
 for(const [action,text,label] of actions){
   const button=document.createElement('button'); // Explicit text and accessible label avoid ambiguous mobile icons.
   button.textContent=text;button.dataset.action=action;button.setAttribute('aria-label',label);buttons.append(button);
   button.addEventListener('click',()=>{
     const step=STEPS[Number(select.value)]||STEPS[0]; // Consistent fine/medium/coarse amounts.
     const changes={left:{dx:-step.move},right:{dx:step.move},up:{dy:-step.move},down:{dy:step.move},
      rotateLeft:{rotateDeg:-step.rotate},rotateRight:{rotateDeg:step.rotate},
      shrink:{scaleX:1-step.scale,scaleY:1-step.scale},grow:{scaleX:1+step.scale,scaleY:1+step.scale},
      narrower:{scaleX:1-step.scale},wider:{scaleX:1+step.scale},shorter:{scaleY:1-step.scale},taller:{scaleY:1+step.scale}}; // Only the selected operation is applied.
     transform(field(),changes[action]);
   });
 }
 const label=document.createElement('label'),angle=document.createElement('input'),output=document.createElement('output'); // Slider complements the draggable on-spline arrow.
 angle.type='range';angle.min='0';angle.max='359';angle.step='1';angle.setAttribute('aria-label','Shrinkwrap direction');
 label.append('Shrinkwrap direction ',output,angle);host.append(label);
 angle.addEventListener('pointerdown',()=>{if(state.settings)remember();});
 angle.addEventListener('keydown',()=>{if(state.settings)remember();});
 angle.addEventListener('input',()=>{if(state.settings){state.settings.shrinkwrapDirections[field()]=Number(angle.value);apply();}});
 const wrap=document.createElement('button'),help=document.createElement('small'); // Shrinkwrap is deliberate, so moving or aiming never snaps unexpectedly.
 wrap.textContent='Shrinkwrap along arrow';wrap.dataset.action='shrinkwrap';wrap.className='good';wrap.addEventListener('click',()=>shrinkwrap(field()));
 help.textContent='Drag the arrow tip to aim. 0° right · 90° down · 180° left · 270° up. Snaps forward to solid pixels; points already on solid artwork stay put.';help.style.display='block';help.style.marginTop='6px';host.append(wrap,help);
 toolbars.push({field,angle,output});
}
function pointerRig(canvasKey,field,rectName){
 const canvas=$(canvasKey); // Shared pointer path handles both nodes and direction arrows.
 const getCoords=event=>{
  const bound=canvas.getBoundingClientRect(),rect=positions[rectName]; // Client coordinates converted to artwork coordinates.
  const px=(event.clientX-bound.left)/bound.width*canvas.width,py=(event.clientY-bound.top)/bound.height*canvas.height; // Raw positions also allow arrow rotation beyond the artwork.
  return {x:clamp((px-rect.x)/rect.w),y:clamp((py-rect.y)/rect.h),px,py};
 };
 canvas.addEventListener('pointerdown',event=>{
  if(!state.settings || !positions[rectName] || event.button>0)return;
  const key=field==='source'?state.mode:field,points=pointsFor(key); // Rider uses the canonical belt until its first edit.
  const coords=getCoords(event),rect=positions[rectName]; // Resolve the closest node or arrow tip in visible canvas space.
  const distances=points.map(p=>Math.hypot(rect.x+p.x*rect.w-coords.px,rect.y+p.y*rect.h-coords.py)); // Pointer tolerance scales to mobile display pixels.
  const min=Math.min(...distances),limit=18*canvas.width/canvas.getBoundingClientRect().width; // Eighteen CSS pixels is touch-friendly at any canvas scale.
  const fields=field==='source'?['sourceTop','sourceBottom']:[field]; // Both PNG arrows remain directly rotatable.
  const arrowField=fields.find(name=>arrows[name] && Math.hypot(arrows[name].tx-coords.px,arrows[name].ty-coords.py)<Math.min(limit,min)); // Prefer a closer node when handles overlap.
  if(!arrowField && min>limit)return;
  remember();
  if(arrowField && field==='source')state.mode=arrowField;
  state.drag={id:event.pointerId,key:arrowField||key,index:distances.indexOf(min),canvas,arrow:!!arrowField};
  canvas.setPointerCapture(event.pointerId);event.preventDefault();
 });
 canvas.addEventListener('pointermove',event=>{
  if(!state.drag||state.drag.id!==event.pointerId||state.drag.canvas!==canvas)return;
  const coords=getCoords(event),key=state.drag.key; // Apply exactly one node edit or arrow rotation.
  if(state.drag.arrow){
    const arrow=arrows[key]; // Arrow centers stay fixed while aiming.
    state.settings.shrinkwrapDirections[key]=(Math.atan2(coords.py-arrow.cy,coords.px-arrow.cx)*180/Math.PI+360)%360;
  }else{
    state.settings[key]=pointsFor(key).map(p=>({...p}));
    state.settings[key][state.drag.index]={x:coords.x,y:coords.y};
  }
  apply();
 });
 for(const event of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(event,()=>{state.drag=null;});
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
 image.crossOrigin='anonymous'; // Uploaded artwork is later read as alpha pixels.
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
 state.settings=null;state.dirty=false;state.history=[];
 previewReady();state.dirty=true;
 refresh();
}
function previewReady(){
 alphaCache.delete($('portrait')); // The same portrait canvas receives new pixels on rebuild.
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
 installToolbar('connectorSourceTools',()=>state.mode);
 installToolbar('connectorRiderTools',()=> 'riderWaist');
 installToolbar('connectorAnimalTools',()=> 'animalNeck');
 $('connectorUndo').addEventListener('click',()=>{
   if(!state.history.length)return;
   state.settings=state.history.pop();apply();tell('Undid the last spline edit.');
 });
 $('connectorFile').addEventListener('change',async e=>{
   try{await png(e.target.files?.[0]);}catch(error){tell(error.message,true);}
   e.target.value='';
 });
 $('connectorSourceTopBtn').addEventListener('click',()=>{state.mode='sourceTop';refresh();});
 $('connectorSourceBottomBtn').addEventListener('click',()=>{state.mode='sourceBottom';refresh();});
 pointerRig('connectorSourceCanvas','source','source');
 pointerRig('connectorRiderCanvas','riderWaist','rider');
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
   state.settings=defaults();state.image=null;state.dataUrl=null;state.history=[];
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
 previewReady,importConfig,transform,shrinkwrap,
 exportConfig:()=>bridge()?.snapshot()||defaults(),
 snapshot:()=>({enabled:state.settings?.enabled===true,uploaded:!!state.dataUrl,
  top:state.settings?.sourceTop?.length||0,bottom:state.settings?.sourceBottom?.length||0,
  neck:state.settings?.animalNeck?.length||0,dirty:state.dirty,
  live:bridge()?.live?.size||0,arrows:cpy(arrows),directions:cpy(state.settings?.shrinkwrapDirections||{}),
  latestChange:'Directional pixel shrinkwrap, whole-spline transforms and flat connector ends.'})
};
hook();previewReady();
})();