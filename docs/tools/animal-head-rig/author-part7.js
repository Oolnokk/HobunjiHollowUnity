'use strict';

// Diagonal split authoring is kept as a thin layer over the BEFORE/AFTER
// shoulder workflow so frame ownership stays independent from spline editing.
const shoulderSeparatorRotation=$('shoulderSeparatorRotation');
const shoulderSeparatorRotationLabel=$('shoulderSeparatorRotationLabel');
const shoulderSeparatorRotationWrap=$('shoulderSeparatorRotationWrap');
const resetShoulderAfter=$('resetShoulderAfter');

function shoulderSeparatorRotationValue(){return clamp(numberOr(shoulderSeparatorRotation?.value,0),-90,90)}
function shoulderSeparatorRest(){const s=sourceSize();return{frameShiftX:shoulderFrameShiftValue(),separatorRotationDeg:shoulderSeparatorRotationValue(),separatorAspect:s.width&&s.height?s.width/s.height:1}}
function shoulderCellV(index,map=shoulderInfluenceMap){if(!map?.width||!map?.height)return 0;return(Math.floor(index/map.width)+.5)/map.height}

// The same signed-side test now owns shoulder-paint defaults and paint gating.
shoulderCellOnRight=function shoulderCellOnRotatedRight(index,map=shoulderInfluenceMap){
  if(!map)return false;const u=shoulderCellU(index,map),v=shoulderCellV(index,map),s=sourceSize(),aspect=s.width&&s.height?s.width/s.height:map.width/Math.max(1,map.height);
  return shoulderSplineApi?.separatorPointIsRight?.(u,v,shoulderSeparatorRest(),aspect)??(u+1e-6>=shoulderFrameShiftValue());
};

function drawSeparatorSide(ctx,image,width,height,keepRight){
  const polygon=shoulderSplineApi?.separatorPolygon?.(width,height,shoulderSeparatorRest(),keepRight);if(!polygon?.length)return;
  ctx.save();ctx.beginPath();ctx.moveTo(polygon[0].x,polygon[0].y);for(let i=1;i<polygon.length;i++)ctx.lineTo(polygon[i].x,polygon[i].y);ctx.closePath();ctx.clip();ctx.drawImage(image,0,0,width,height);ctx.restore();
}

// Split preview/composite uses the exact rotated half-plane used by gameplay.
splitLayerCanvases=function splitRotatedShoulderLayerCanvases(){
  if(!state.image)return null;const rightSource=rightShoulderSource();if(!rightSource)return null;const s=sourceSize(),w=Math.max(1,s.width),h=Math.max(1,s.height),shift=shoulderFrameShiftValue(),rotation=shoulderSeparatorRotationValue(),cached=shoulderSplitLayerCache;
  if(cached&&cached.idle===state.image&&cached.rightSource===rightSource&&cached.shift===shift&&cached.rotation===rotation&&cached.width===w&&cached.height===h)return cached;
  const left=document.createElement('canvas'),right=document.createElement('canvas');left.width=right.width=w;left.height=right.height=h;const lctx=left.getContext('2d'),rctx=right.getContext('2d');lctx.clearRect(0,0,w,h);rctx.clearRect(0,0,w,h);drawSeparatorSide(lctx,state.image,w,h,false);drawSeparatorSide(rctx,rightSource,w,h,true);
  return shoulderSplitLayerCache={idle:state.image,rightSource,shift,rotation,width:w,height:h,left,right};
};

// In Right-source mode show the actual owned half, not the full source frame.
selectedPaintSourceImage=function selectedRotatedPaintSourceImage(){
  const mode=shoulderPaintSource?.value||'left';if(mode==='right'&&shoulderRestSplitFrame?.checked)return splitLayerCanvases()?.right||rightShoulderSource()||state.image;if(mode==='right')return rightShoulderSource()||state.image;if(mode==='composite')return compositePaintSource()||state.image;return state.image;
};

// Persist separator angle/aspect with every authored shoulder rig.
const currentShoulderRestBeforeSeparator=currentShoulderRest;
currentShoulderRest=function currentShoulderRestWithSeparator(){const rest=currentShoulderRestBeforeSeparator();const s=sourceSize();rest.separatorRotationDeg=shoulderSeparatorRotationValue();rest.separatorAspect=s.width&&s.height?s.width/s.height:1;return rest};

const normalizeShoulderRestBeforeSeparator=normalizeShoulderRest;
normalizeShoulderRest=function normalizeShoulderRestWithSeparator(raw){const rest=normalizeShoulderRestBeforeSeparator(raw);if(rest){rest.separatorRotationDeg=clamp(numberOr(rest.separatorRotationDeg??raw?.separatorRotationDeg,0),-90,90);rest.separatorAspect=Math.max(.000001,numberOr(rest.separatorAspect??raw?.separatorAspect,1))}return rest};

const applyShoulderRestConfigBeforeSeparator=applyShoulderRestConfig;
applyShoulderRestConfig=function applyShoulderRestConfigWithSeparator(raw){const result=applyShoulderRestConfigBeforeSeparator(raw);const normalized=raw?normalizeShoulderRest(raw):null;if(shoulderSeparatorRotation)shoulderSeparatorRotation.value=String(Math.round(numberOr(normalized?.separatorRotationDeg,0)));if(shoulderSeparatorRotationLabel)shoulderSeparatorRotationLabel.textContent=`${Math.round(shoulderSeparatorRotationValue())}°`;clearShoulderSplitLayerCache();buildSourceSampler();draw();return result};

const updateShoulderUiBeforeSeparator=updateShoulderUi;
updateShoulderUi=function updateShoulderUiWithSeparator(){const result=updateShoulderUiBeforeSeparator();const split=!!shoulderRestSplitFrame?.checked;shoulderSeparatorRotationWrap?.classList.toggle('hidden',!split);if(shoulderSeparatorRotationLabel)shoulderSeparatorRotationLabel.textContent=`${Math.round(shoulderSeparatorRotationValue())}°`;return result};

// Suppress part6's vertical guide and replace it with the true rotated separator.
const drawGuidesBeforeSeparator=drawGuides;
drawGuides=function drawGuidesWithRotatedSeparator(fit){
  const wasSplit=!!shoulderRestSplitFrame?.checked;if(wasSplit)shoulderRestSplitFrame.checked=false;try{drawGuidesBeforeSeparator(fit)}finally{if(wasSplit)shoulderRestSplitFrame.checked=true}if(!wasSplit||!state.image)return;
  const s=sourceSize(),theta=shoulderSeparatorRotationValue()*Math.PI/180,cx=s.width*shoulderFrameShiftValue(),cy=s.height*.5,tx=Math.sin(theta),ty=Math.cos(theta),reach=Math.hypot(s.width,s.height)*1.5;
  paintCtx.save();paintCtx.beginPath();paintCtx.rect(fit.x,fit.y,fit.width,fit.height);paintCtx.clip();paintCtx.translate(fit.x,fit.y);paintCtx.scale(fit.scale,fit.scale);paintCtx.strokeStyle='rgba(240,200,120,.9)';paintCtx.lineWidth=Math.max(1.1,(window.devicePixelRatio||1)/Math.max(.001,fit.scale));paintCtx.setLineDash([5/Math.max(.001,fit.scale),5/Math.max(.001,fit.scale)]);paintCtx.beginPath();paintCtx.moveTo(cx-tx*reach,cy-ty*reach);paintCtx.lineTo(cx+tx*reach,cy+ty*reach);paintCtx.stroke();paintCtx.restore();
};

// Save rotation in undo/redo alongside the rest of the shoulder authoring state.
const captureHistoryStateBeforeSeparator=captureHistoryState;
captureHistoryState=function captureHistoryStateWithSeparator(){return{...captureHistoryStateBeforeSeparator(),shoulderSeparatorRotation:shoulderSeparatorRotationValue()}};
const historySignatureBeforeSeparator=historySignature;
historySignature=function historySignatureWithSeparator(snapshot){return`${historySignatureBeforeSeparator(snapshot)}|zr${numberOr(snapshot?.shoulderSeparatorRotation,0).toFixed(2)}`};
const restoreHistoryStateBeforeSeparator=restoreHistoryState;
restoreHistoryState=function restoreHistoryStateWithSeparator(snapshot){if(snapshot&&Number.isFinite(Number(snapshot.shoulderSeparatorRotation)))shoulderSeparatorRotation.value=String(snapshot.shoulderSeparatorRotation);const result=restoreHistoryStateBeforeSeparator(snapshot);updateShoulderUi();clearShoulderSplitLayerCache();buildSourceSampler();return result};

shoulderSeparatorRotation?.addEventListener('pointerdown',()=>checkpointHistory());
shoulderSeparatorRotation?.addEventListener('input',()=>{if(shoulderSeparatorRotationLabel)shoulderSeparatorRotationLabel.textContent=`${Math.round(shoulderSeparatorRotationValue())}°`;clearShoulderSplitLayerCache();buildSourceSampler();draw()});

// Dedicated semantic reset: AFTER becomes an identity copy of the current bind.
resetShoulderAfter?.addEventListener('click',()=>{checkpointHistory();shoulderAfterPoints=cloneShoulderPoints(shoulderBeforePoints,shoulderBeforePoints);shoulderEditMode='after';updateShoulderUi();setStatus('Reset AFTER line to the current BEFORE bind line.',true);draw()});

// The canvas should fill its host; fitRectFor() already contains the sprite while
// leaving checkerboard margin. This extra margin is what keeps off-image AFTER
// vertices visible instead of shrinking/cropping the actual canvas element.
fitCanvasInsideHost=function fitCanvasInsideTallerHost(canvas){const host=canvas?.parentElement?.getBoundingClientRect?.();if(!host?.width||!host?.height)return;const cssWidth=Math.max(1,host.width),cssHeight=Math.max(1,host.height);canvas.style.width=`${cssWidth}px`;canvas.style.height=`${cssHeight}px`;const dpr=Math.max(1,window.devicePixelRatio||1),pixelWidth=Math.max(1,Math.round(cssWidth*dpr)),pixelHeight=Math.max(1,Math.round(cssHeight*dpr));if(canvas.width!==pixelWidth)canvas.width=pixelWidth;if(canvas.height!==pixelHeight)canvas.height=pixelHeight};

updateShoulderUi();resizeCanvases();
