'use strict';

// Shoulder-pet rest authoring is intentionally one tiny spline control rather
// than a second rigging tool: one checkbox + one midpoint bend. The existing
// Head Influence map automatically supplies the opposition weight.
const shoulderRestPanel=document.createElement('div'); // Holds the opt-in rest controls next to the existing live-preview controls.
shoulderRestPanel.innerHTML=`<label class="row" style="justify-content:flex-start"><input id="shoulderRestEnabled" type="checkbox"> Shoulder-pet rest body bend (preview run1 when available)</label><label>Rest midpoint bend <span id="shoulderRestBendLabel">0%</span><input id="shoulderRestBend" type="range" min="-40" max="40" step="1" value="0"></label><div class="hint">This bends only the body share along one smooth spline. Head Influence opposes it automatically: 100% Head gets 0% rest bend, 50% Head gets 50%, and Body gets 100%. Drag the diamond on the paint canvas or use the slider.</div>`;
const previewAngleControl=$('previewAngle')?.closest?.('label'); // Places the new opt-in directly beside the existing motion preview instead of adding another editor section.
previewAngleControl?.insertAdjacentElement?.('afterend',shoulderRestPanel);
const shoulderRestEnabled=$('shoulderRestEnabled'); // Author/runtime opt-in persisted inside headRig.shoulderRest.
const shoulderRestBend=$('shoulderRestBend'); // Signed midpoint displacement in percent of sprite height; positive bends upward in model space.
const shoulderRestBendLabel=$('shoulderRestBendLabel'); // Mirrors the signed slider value for touch/mobile authoring.
let shoulderRestHandleDragging=false; // Prevents the ordinary paint handler from receiving pointer events while the bend handle is being dragged.
let shoulderRestFrameSwapToken=0; // Invalidates stale asynchronous run1/idle image swaps when the checkbox changes quickly.

function shoulderRestBendValue(){return clamp(numberOr(shoulderRestBend?.value,0)/100,-.4,.4)}
function shoulderRestCenterV(){const s=sourceSize();return state.pivot&&s.height?clamp(state.pivot.y/s.height,0,1):.5}
function updateShoulderRestLabel(){if(shoulderRestBendLabel)shoulderRestBendLabel.textContent=`${Math.round(shoulderRestBendValue()*100)}%`}
function currentIdlePreviewPath(){return $('idleSprite')?.value?.trim?.()||state.baseRecord?.sprites?.idle||state.baseRecord?.textureUrl||''}
function currentRun1PreviewPath(){const run=state.baseRecord?.sprites?.run;if(Array.isArray(run)&&run[0])return run[0];if(typeof run==='string'&&run)return run;const id=$('animalId')?.value?.trim?.();return window.CreatureGeneticsRender?.SPECIES?.[id]?.base?.run1||''}

function shoulderRestSourcePoint(sourceX,sourceY,headInfluence){const s=sourceSize(),width=Math.max(1,s.width),height=Math.max(1,s.height),u=clamp(sourceX/width,0,1),centerV=shoulderRestCenterV(),centerLocalY=(.5-centerV)*height,localY=height*.5-sourceY,mid=shoulderRestBendValue()*height,tangentX=width,tangentY=4*mid*(1-2*u),tangentLength=Math.hypot(tangentX,tangentY)||1,normalX=-tangentY/tangentLength,normalY=tangentX/tangentLength,offsetY=localY-centerLocalY,targetLocalX=-width*.5+u*width+normalX*offsetY,targetLocalY=centerLocalY+4*(1-u)*u*mid+normalY*offsetY,targetSourceX=targetLocalX+width*.5,targetSourceY=height*.5-targetLocalY,bodyWeight=1-clamp(headInfluence,0,1);return{x:sourceX+(targetSourceX-sourceX)*bodyWeight,y:sourceY+(targetSourceY-sourceY)*bodyWeight}}
function shoulderRestHandlePoint(){const s=sourceSize(),centerSourceY=shoulderRestCenterV()*s.height;return{x:s.width*.5,y:centerSourceY-shoulderRestBendValue()*s.height}}

function swapShoulderRestPreviewFrame(){const desired=shoulderRestEnabled?.checked?(currentRun1PreviewPath()||currentIdlePreviewPath()):currentIdlePreviewPath();if(!desired||state.imageUrl===desired)return draw();const token=++shoulderRestFrameSwapToken,oldSize=sourceSize(),pivotNorm=state.pivot&&oldSize.width&&oldSize.height?{x:state.pivot.x/oldSize.width,y:state.pivot.y/oldSize.height}:null,image=new Image();image.decoding='async';image.onload=()=>{if(token!==shoulderRestFrameSwapToken)return;state.image=image;state.imageUrl=desired;const nextSize=sourceSize();if(pivotNorm)state.pivot={x:pivotNorm.x*nextSize.width,y:pivotNorm.y*nextSize.height};const maxR=Math.max(nextSize.width,nextSize.height);$('brushRadius').max=String(maxR);$('expandRadius').max=String(maxR);$('brushRadius').value=String(Math.min(numberOr($('brushRadius').value,40),maxR));$('expandRadius').value=String(Math.min(numberOr($('expandRadius').value,60),maxR));buildSourceSampler();resizeCanvases();draw()};image.onerror=()=>{if(token!==shoulderRestFrameSwapToken)return;setStatus(`Could not load shoulder-rest preview frame: ${desired}`,false)};image.src=repoSpriteUrl(desired)}

const previousCaptureHistoryState=captureHistoryState; // Extends ordinary paint undo/redo so the shoulder-rest checkbox/bend are not a separate irreversible workflow.
captureHistoryState=function captureHistoryStateWithShoulderRest(){return{...previousCaptureHistoryState(),shoulderRestEnabled:!!shoulderRestEnabled?.checked,shoulderRestBend:shoulderRestBendValue()}}
const previousHistorySignature=historySignature; // Includes the new authored values in history de-duplication.
historySignature=function historySignatureWithShoulderRest(snapshot){return`${previousHistorySignature(snapshot)}|r${snapshot?.shoulderRestEnabled?1:0},${numberOr(snapshot?.shoulderRestBend,0).toFixed(5)}`}
const previousRestoreHistoryState=restoreHistoryState; // Restores UI state before the existing function redraws the two canvases.
restoreHistoryState=function restoreHistoryStateWithShoulderRest(snapshot){if(snapshot&&typeof snapshot.shoulderRestEnabled==='boolean')shoulderRestEnabled.checked=snapshot.shoulderRestEnabled;if(snapshot&&Number.isFinite(Number(snapshot.shoulderRestBend)))shoulderRestBend.value=String(Math.round(clamp(Number(snapshot.shoulderRestBend),-.4,.4)*100));updateShoulderRestLabel();previousRestoreHistoryState(snapshot);swapShoulderRestPreviewFrame()}

const previousApplyRecord=applyRecord; // Loads saved shoulder-rest settings before the record's normal output/update path runs.
applyRecord=function applyRecordWithShoulderRest(record,index=-1){const rest=record?.headRig?.shoulderRest;shoulderRestEnabled.checked=!!rest?.enabled;shoulderRestBend.value=String(Math.round(clamp(numberOr(rest?.bend,0),-.4,.4)*100));updateShoulderRestLabel();return previousApplyRecord(record,index)}
const previousApplyRigToPaint=applyRigToPaint; // Handles direct rig JSON loads as well as full animal records.
applyRigToPaint=function applyRigToPaintWithShoulderRest(rig){const rest=rig?.shoulderRest;shoulderRestEnabled.checked=!!rest?.enabled;shoulderRestBend.value=String(Math.round(clamp(numberOr(rest?.bend,0),-.4,.4)*100));updateShoulderRestLabel();return previousApplyRigToPaint(rig)}

const previousNormalizedRig=normalizedRig; // Persists only one tiny descriptor; there is deliberately no extra weight map for this method.
normalizedRig=function normalizedRigWithShoulderRest(){const rig=previousNormalizedRig();if(!rig)return rig;if(shoulderRestEnabled?.checked)rig.shoulderRest={enabled:true,bend:shoulderRestBendValue(),centerV:rig.pivot?.y??shoulderRestCenterV()};else delete rig.shoulderRest;return rig}

const previousLoadImageUrl=loadImageUrl; // Selecting an authored rest rig automatically uses run1 in the rigger when that frame exists.
loadImageUrl=function loadImageUrlWithShoulderRest(url,displayPath=url){const run1=shoulderRestEnabled?.checked?currentRun1PreviewPath():'';return run1&&displayPath!==run1?previousLoadImageUrl(repoSpriteUrl(run1),run1):previousLoadImageUrl(url,displayPath)}

const previousDrawGuides=drawGuides; // Adds one visible path + one draggable midpoint without creating a separate spline editor mode.
drawGuides=function drawGuidesWithShoulderRest(fit){previousDrawGuides(fit);if(!shoulderRestEnabled?.checked||!state.image)return;const s=sourceSize(),centerY=shoulderRestCenterV()*s.height,bend=shoulderRestBendValue()*s.height,steps=32;paintCtx.save();paintCtx.translate(fit.x,fit.y);paintCtx.scale(fit.scale,fit.scale);paintCtx.strokeStyle='rgba(181,140,255,.95)';paintCtx.fillStyle='rgba(181,140,255,.95)';paintCtx.lineWidth=Math.max(1.5,2/Math.max(.001,fit.scale));paintCtx.beginPath();for(let i=0;i<=steps;i++){const u=i/steps,x=u*s.width,y=centerY-4*(1-u)*u*bend;i?paintCtx.lineTo(x,y):paintCtx.moveTo(x,y)}paintCtx.stroke();const handle=shoulderRestHandlePoint(),r=Math.max(5,8/Math.max(.001,fit.scale));paintCtx.beginPath();paintCtx.moveTo(handle.x,handle.y-r);paintCtx.lineTo(handle.x+r,handle.y);paintCtx.lineTo(handle.x,handle.y+r);paintCtx.lineTo(handle.x-r,handle.y);paintCtx.closePath();paintCtx.fill();paintCtx.restore()}

// Reuses the existing textured-triangle preview. The only new step is the
// static body spline before normal head pitch is applied. Body/rest share is
// exactly 1 - base Head Influence; compression/stretch still choose the final
// head-rotation weight independently afterward.
drawDeformedPreview=function drawDeformedPreviewWithShoulderRest(){const fit=fitRectFor(previewCanvas);if(!fit||!state.image)return;previewCtx.clearRect(0,0,previewCanvas.width,previewCanvas.height);if(!state.weights||!state.pivot){previewCtx.drawImage(state.image,fit.x,fit.y,fit.width,fit.height);return}const s=sourceSize(),angleDeg=clamp(numberOr($('previewAngle').value,0),Math.min(numberOr($('minDeg').value,-30),numberOr($('maxDeg').value,30)),Math.max(numberOr($('minDeg').value,-30),numberOr($('maxDeg').value,30))),angle=angleDeg*Math.PI/180,maxDetail=clamp(Math.round(numberOr($('meshResolution').value,48)),12,72),aspect=s.width/Math.max(1,s.height),cols=aspect>=1?maxDetail:Math.max(8,Math.round(maxDetail*aspect)),rows=aspect>=1?Math.max(8,Math.round(maxDetail/aspect)):maxDetail,cw=s.width/cols,ch=s.height/rows,p=state.pivot,vertices=new Array((cols+1)*(rows+1));for(let y=0;y<=rows;y++)for(let x=0;x<=cols;x++){const u=x/cols,v=y/rows,sx=u*s.width,sy=v*s.height,base=sampleGridWeight(u,v),rested=shoulderRestEnabled?.checked?shoulderRestSourcePoint(sx,sy,base):{x:sx,y:sy},w=previewHeadWeight(u,v,angleDeg);vertices[y*(cols+1)+x]=deformedPoint(rested.x,rested.y,w,angle,p)}previewCtx.save();previewCtx.translate(fit.x,fit.y);previewCtx.scale(fit.scale,fit.scale);const overdraw=.8/Math.max(.001,fit.scale);for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){const s00={x:x*cw,y:y*ch},s10={x:(x+1)*cw,y:y*ch},s01={x:x*cw,y:(y+1)*ch},s11={x:(x+1)*cw,y:(y+1)*ch},d00=vertices[y*(cols+1)+x],d10=vertices[y*(cols+1)+x+1],d01=vertices[(y+1)*(cols+1)+x],d11=vertices[(y+1)*(cols+1)+x+1];drawTexturedTriangle(previewCtx,s00,s10,s01,d00,d10,d01,overdraw);drawTexturedTriangle(previewCtx,s10,s11,s01,d10,d11,d01,overdraw)}previewCtx.restore()}

function updateBendFromPointer(event){const p=pointerToSource(event),s=sourceSize();if(!p||!s.height)return;shoulderRestBend.value=String(Math.round(clamp((shoulderRestCenterV()*s.height-p.y)/s.height,-.4,.4)*100));updateShoulderRestLabel();requestDraw()}
paintCanvas.addEventListener('pointerdown',event=>{if(!shoulderRestEnabled?.checked||!state.image)return;const p=pointerToSource(event),h=shoulderRestHandlePoint();if(!p||Math.hypot(p.x-h.x,p.y-h.y)>Math.max(18,sourceSize().height*.04))return;checkpointHistory();shoulderRestHandleDragging=true;paintCanvas.setPointerCapture?.(event.pointerId);event.preventDefault();event.stopImmediatePropagation();updateBendFromPointer(event)},true);
paintCanvas.addEventListener('pointermove',event=>{if(!shoulderRestHandleDragging)return;event.preventDefault();event.stopImmediatePropagation();updateBendFromPointer(event)},true);
const stopShoulderRestHandle=event=>{if(!shoulderRestHandleDragging)return;shoulderRestHandleDragging=false;paintCanvas.releasePointerCapture?.(event.pointerId);event.preventDefault();event.stopImmediatePropagation();draw()};paintCanvas.addEventListener('pointerup',stopShoulderRestHandle,true);paintCanvas.addEventListener('pointercancel',stopShoulderRestHandle,true);

shoulderRestEnabled?.addEventListener('pointerdown',()=>checkpointHistory());
shoulderRestEnabled?.addEventListener('change',()=>{swapShoulderRestPreviewFrame();draw()});
shoulderRestBend?.addEventListener('pointerdown',()=>checkpointHistory());
shoulderRestBend?.addEventListener('input',()=>{updateShoulderRestLabel();draw()});
updateShoulderRestLabel();
