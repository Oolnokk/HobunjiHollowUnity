'use strict';
const STORAGE_KEY='hobunji_animal_head_rigs_v1'; // Shared with the game's animal head-rig runtime for same-origin testing.
const UNSET=256; // Influence: body fallback. Material channels: inherit the current Influence weight.
const GRID_MAX=128; // Default longest paint-grid dimension; enough detail for heads while keeping exported JSON compact.
const RUNTIME_RIGGER_SPECIES=Object.freeze({puktuk:Object.freeze({label:'Puktuk',baselineIds:Object.freeze(['gar-wolf']),hostile:false,diet:'predator',modelWidth:2.1,spriteAspect:0.43636}),'voorg-ass':Object.freeze({label:'Voorg-Ass',baselineIds:Object.freeze(['uumkaoii-wild','uumkaoii']),hostile:false,diet:'prey'})}); // Runtime-only species absent from the older static bestiary.
const $=id=>document.getElementById(id); // Short DOM helper used throughout the author.
const paintCanvas=$('paintCanvas'),paintCtx=paintCanvas.getContext('2d'); // Interactive undeformed authoring canvas.
const previewCanvas=$('previewCanvas'),previewCtx=previewCanvas.getContext('2d'); // Read-only live deformation preview canvas.
const state={image:null,imageUrl:'',sourceCanvas:null,sampleData:null,weights:null,compressibility:null,stretchability:null,paintLayer:'influence',target:'head',tool:'brush',dragging:false,pivot:null,cursor:null,baseRecord:{},collection:null,collectionKind:'single',selectedIndex:-1,selectRecords:[],selectCollectionIndexes:[],pendingRig:null,undoStack:[],redoStack:[]}; // Live editor state including asymmetric override maps.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)); // Shared bounds helper for image/grid/input coordinates.
const numberOr=(v,f)=>Number.isFinite(Number(v))?Number(v):f; // Numeric-input parser that rejects NaN/infinity.
const deepClone=v=>v==null?v:JSON.parse(JSON.stringify(v)); // Preserves arbitrary loaded animal fields without mutating source JSON.
const pretty=v=>JSON.stringify(v,null,2); // Canonical human-readable export formatting.
const lerp=(a,b,t)=>a+(b-a)*t; // Brush-strength interpolation used by Influence and material reduction/restore.
let drawScheduled=false; // Coalesces rapid brush pointer events so the always-live deformation preview redraws at most once per animation frame.

function setStatus(message,ok=true){const n=$('status');n.textContent=message;n.className='status '+(ok?'ok':'error')}
function sourceSize(){const i=state.image;return i?{width:i.naturalWidth||i.width,height:i.naturalHeight||i.height}:{width:0,height:0}}
function fitRectFor(canvas){const s=sourceSize();if(!s.width||!s.height||!canvas.width||!canvas.height)return null;const scale=Math.min(canvas.width/s.width,canvas.height/s.height);return{x:(canvas.width-s.width*scale)/2,y:(canvas.height-s.height*scale)/2,width:s.width*scale,height:s.height*scale,scale}}
function resizeOneCanvas(canvas){const r=canvas.getBoundingClientRect(),dpr=Math.max(1,window.devicePixelRatio||1);canvas.width=Math.max(1,Math.round(r.width*dpr));canvas.height=Math.max(1,Math.round(r.height*dpr))}
function resizeCanvases(){resizeOneCanvas(paintCanvas);resizeOneCanvas(previewCanvas);draw()}
function pointerToSource(e){const fit=fitRectFor(paintCanvas),b=paintCanvas.getBoundingClientRect(),s=sourceSize();if(!fit||!b.width||!b.height)return null;const cx=(e.clientX-b.left)*paintCanvas.width/b.width,cy=(e.clientY-b.top)*paintCanvas.height/b.height;return{x:clamp((cx-fit.x)/fit.scale,0,s.width-0.001),y:clamp((cy-fit.y)/fit.scale,0,s.height-0.001)}}
function gridDimensions(maxDim=GRID_MAX){const s=sourceSize();if(!s.width||!s.height)return{width:1,height:1};return s.width>=s.height?{width:maxDim,height:Math.max(8,Math.round(maxDim*s.height/s.width))}:{width:Math.max(8,Math.round(maxDim*s.width/s.height)),height:maxDim}}
function gridIndex(x,y){return y*state.weights.width+x}
function gridCellFromSource(p){const s=sourceSize(),w=state.weights.width,h=state.weights.height;return{x:clamp(Math.floor(p.x/s.width*w),0,w-1),y:clamp(Math.floor(p.y/s.height*h),0,h-1)}}
function gridCellCenter(x,y){const s=sourceSize(),w=state.weights.width,h=state.weights.height;return{x:(x+.5)/w*s.width,y:(y+.5)/h*s.height}}
function runtimeWeight(value){return value===UNSET?0:clamp(value,0,255)/255}
function brushStrength(){return clamp(numberOr($('brushStrength').value,100),1,100)/100}

function encodeRle(values){const data=[];if(!values?.length)return data;let value=values[0],run=1;for(let i=1;i<values.length;i++){if(values[i]===value)run++;else{data.push(run,value);value=values[i];run=1}}data.push(run,value);return data}
function decodeWeightMap(raw){if(!raw||!raw.width||!raw.height)return null;const w=Math.max(1,Math.round(raw.width)),h=Math.max(1,Math.round(raw.height)),values=new Uint16Array(w*h);values.fill(UNSET);if(raw.encoding==='rle-u9'&&Array.isArray(raw.data)){let p=0;for(let i=0;i+1<raw.data.length&&p<values.length;i+=2){const run=Math.max(0,Math.round(numberOr(raw.data[i],0))),value=clamp(Math.round(numberOr(raw.data[i+1],UNSET)),0,UNSET),end=Math.min(values.length,p+run);values.fill(value,p,end);p=end}}else if(Array.isArray(raw.data)){for(let i=0;i<values.length&&i<raw.data.length;i++)values[i]=clamp(Math.round(numberOr(raw.data[i],UNSET)),0,UNSET)}else return null;return{width:w,height:h,values}}
function blankMap(width,height){const values=new Uint16Array(width*height);values.fill(UNSET);return{width,height,values}}
function alignOverrideMap(map){if(!state.weights)return null;const w=state.weights.width,h=state.weights.height;if(!map)return blankMap(w,h);if(map.width===w&&map.height===h)return map;const aligned=blankMap(w,h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const sx=Math.round((x/Math.max(1,w-1))*Math.max(0,map.width-1)),sy=Math.round((y/Math.max(1,h-1))*Math.max(0,map.height-1)),v=map.values[sy*map.width+sx];if(v!==UNSET)aligned.values[y*w+x]=v}return aligned}
function hasOverrides(map){if(!map)return false;for(const value of map.values)if(value!==UNSET)return true;return false}
function exportMap(map,optional=false){if(!map||(optional&&!hasOverrides(map)))return null;return{width:map.width,height:map.height,encoding:'rle-u9',unsetValue:UNSET,data:encodeRle(map.values)}}
function buildWeightMapExport(){return exportMap(state.weights,false)}
function activePaintMap(){return state.paintLayer==='compressibility'?state.compressibility:state.paintLayer==='stretchability'?state.stretchability:state.weights}
function snapshotMap(map){return map?{width:map.width,height:map.height,values:Array.from(map.values)}:null}
function restoreMap(snapshot){return snapshot?{width:snapshot.width,height:snapshot.height,values:Uint16Array.from(snapshot.values)}:null}
function captureHistoryState(){return{weights:snapshotMap(state.weights),compressibility:snapshotMap(state.compressibility),stretchability:snapshotMap(state.stretchability),pivot:state.pivot?{...state.pivot}:null}}
function historySignature(snapshot){const sig=m=>m?`${m.width}x${m.height}:${m.values.join(',')}`:'none';return `${sig(snapshot?.weights)}|c${sig(snapshot?.compressibility)}|s${sig(snapshot?.stretchability)}|p${snapshot?.pivot?.x??'n'},${snapshot?.pivot?.y??'n'}`}
function updateHistoryButtons(){$('undoButton').disabled=!state.undoStack.length;$('redoButton').disabled=!state.redoStack.length}
function checkpointHistory(){const snap=captureHistoryState(),last=state.undoStack[state.undoStack.length-1];if(last&&historySignature(last)===historySignature(snap))return;state.undoStack.push(snap);if(state.undoStack.length>64)state.undoStack.shift();state.redoStack.length=0;updateHistoryButtons()}
function restoreHistoryState(snapshot){if(!snapshot)return;state.weights=restoreMap(snapshot.weights);state.compressibility=restoreMap(snapshot.compressibility);state.stretchability=restoreMap(snapshot.stretchability);state.pivot=snapshot.pivot?{...snapshot.pivot}:null;if(state.weights)buildSourceSampler();updateHistoryButtons();draw()}
function undoEdit(){if(!state.undoStack.length)return;state.redoStack.push(captureHistoryState());restoreHistoryState(state.undoStack.pop());setStatus('Undid rig edit.',true)}
function redoEdit(){if(!state.redoStack.length)return;state.undoStack.push(captureHistoryState());restoreHistoryState(state.redoStack.pop());setStatus('Redid rig edit.',true)}
function resetHistory(){state.undoStack.length=0;state.redoStack.length=0;updateHistoryButtons()}

function buildSourceSampler(){if(!state.image||!state.weights)return;const c=document.createElement('canvas');c.width=state.weights.width;c.height=state.weights.height;const cctx=c.getContext('2d',{willReadFrequently:true});cctx.clearRect(0,0,c.width,c.height);cctx.drawImage(state.image,0,0,c.width,c.height);state.sourceCanvas=c;try{state.sampleData=cctx.getImageData(0,0,c.width,c.height).data}catch(_){state.sampleData=null}}
function makeBlankWeights(){const d=gridDimensions();state.weights=blankMap(d.width,d.height);state.compressibility=blankMap(d.width,d.height);state.stretchability=blankMap(d.width,d.height);buildSourceSampler()}
function applyRigToPaint(rig){if(!state.image)return;const decoded=decodeWeightMap(rig?.weightMap);if(decoded)state.weights=decoded;else{makeBlankWeights();if(rig?.region){const r=rig.region;for(let y=0;y<state.weights.height;y++)for(let x=0;x<state.weights.width;x++){const u=(x+.5)/state.weights.width,v=(y+.5)/state.weights.height;if(u>=numberOr(r.x,0)&&u<=numberOr(r.x,0)+numberOr(r.width,0)&&v>=numberOr(r.y,0)&&v<=numberOr(r.y,0)+numberOr(r.height,0))state.weights.values[gridIndex(x,y)]=255}}}
  state.compressibility=alignOverrideMap(decodeWeightMap(rig?.compressibilityMap));state.stretchability=alignOverrideMap(decodeWeightMap(rig?.stretchabilityMap));buildSourceSampler();state.pivot=rig?.pivot?{x:clamp(numberOr(rig.pivot.x,.5),0,1)*sourceSize().width,y:clamp(numberOr(rig.pivot.y,.5),0,1)*sourceSize().height}:null;
  $('minDeg').value=numberOr(rig?.minDeg,-30);$('restDeg').value=numberOr(rig?.restDeg,0);$('maxDeg').value=numberOr(rig?.maxDeg,30);$('turnSpeedDeg').value=Math.max(0,numberOr(rig?.turnSpeedDeg,120));$('meshResolution').value=clamp(Math.round(numberOr(rig?.meshResolution,48)),12,72);draw()}
