'use strict';

// Shoulder-pet body authoring is explicitly two-stage:
//   BEFORE / Bind = seven points fitted to the undeformed source PNG.
//   AFTER / Pose  = the same seven bind points moved into the shoulder pose.
// The runtime maps every image vertex from the curved BEFORE local frame into
// the curved AFTER local frame. Head Influence remains the competing body weight.
const shoulderRestUseSpline=$('shoulderRestUseSpline');
const shoulderRestUseRun1=$('shoulderRestUseRun1');
const shoulderRestSplitFrame=$('shoulderRestSplitFrame');
const shoulderSplitRightIdle=$('shoulderSplitRightIdle');
const shoulderFollowFrameShiftX=$('shoulderFollowFrameShiftX');
const shoulderFrameShift=$('shoulderFrameShift');
const shoulderFrameShiftLabel=$('shoulderFrameShiftLabel');
const shoulderFrameShiftWrap=$('shoulderFrameShiftWrap');
const shoulderPaintSource=$('shoulderPaintSource');
const shoulderEditBefore=$('shoulderEditBefore');
const shoulderEditAfter=$('shoulderEditAfter');
const copyShoulderBeforeToAfter=$('copyShoulderBeforeToAfter');
const resetShoulderSpline=$('resetShoulderSpline');
const shoulderSplineApi=window.AnimalShoulderSpline;
const shoulderProfileApi=window.HobunjiShoulderSplineProfiles;
const SHOULDER_POINT_COUNT=7;
const shoulderSplineSpecies=new Set(shoulderProfileApi?.species||['grehlr','voorg-ass','uumkaoii','gar-wolf','dabinggi-hound']);
let shoulderBeforePoints=linearShoulderPoints({a:{x:.52,y:.56},b:{x:1,y:.57}});
let shoulderAfterPoints=cloneShoulderPoints(shoulderBeforePoints,shoulderBeforePoints);
let shoulderEditMode='before';
let shoulderPointDrag=-1;
let shoulderRun1Image=null;
let shoulderRun1Path='';
let shoulderRun1Token=0;
let shoulderSplitLayerCache=null;
let shoulderPaintCompositeCache=null;
let lastShoulderFrameShift=.52;

function clamp01(value){return clamp(numberOr(value,0),0,1)}
function shoulderFrameShiftValue(){return clamp(numberOr(shoulderFrameShift?.value,52)/100,0,1)}
function cloneShoulderPoint(point,fallback={x:0,y:0}){return{x:numberOr(point?.x,fallback.x),y:numberOr(point?.y,fallback.y)}}
function linearShoulderPoints(guide){
  const a=cloneShoulderPoint(guide?.a,{x:.52,y:.56}),b=cloneShoulderPoint(guide?.b,{x:1,y:.57});
  return Array.from({length:SHOULDER_POINT_COUNT},(_,index)=>{const t=index/(SHOULDER_POINT_COUNT-1);return{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t}});
}
function cloneShoulderPoints(points,fallbackPoints){
  const fallback=Array.isArray(fallbackPoints)&&fallbackPoints.length===SHOULDER_POINT_COUNT?fallbackPoints:linearShoulderPoints({a:{x:.52,y:.56},b:{x:1,y:.57}});
  return Array.from({length:SHOULDER_POINT_COUNT},(_,index)=>cloneShoulderPoint(points?.[index],fallback[index]));
}
function currentShoulderSpecies(){return String($('animalId')?.value||state.baseRecord?.id||'').trim().toLowerCase().replace(/[’']/g,'').replace(/_/g,'-')}
function canonicalShoulderSpecies(){return shoulderProfileApi?.canonicalKind?.(currentShoulderSpecies())||currentShoulderSpecies()}
function splineAllowedForCurrentSpecies(){return shoulderSplineSpecies.has(canonicalShoulderSpecies())}
function shoulderPresentationEnabled(){return!!(shoulderRestUseSpline?.checked||shoulderRestUseRun1?.checked||shoulderRestSplitFrame?.checked)}
function activeShoulderPoints(){return shoulderEditMode==='before'?shoulderBeforePoints:shoulderAfterPoints}
function currentShoulderRest(){return{
  enabled:true,
  useSpline:!!shoulderRestUseSpline?.checked&&splineAllowedForCurrentSpecies(),
  useRun1:!!shoulderRestUseRun1?.checked,
  splitFrame:!!shoulderRestSplitFrame?.checked,
  splitRightUsesIdle:!!shoulderSplitRightIdle?.checked,
  frameShiftX:shoulderFrameShiftValue(),
  followFrameShiftX:shoulderFollowFrameShiftX?.checked!==false,
  beforePoints:cloneShoulderPoints(shoulderBeforePoints,shoulderBeforePoints),
  afterPoints:cloneShoulderPoints(shoulderAfterPoints,shoulderBeforePoints),
}}
function normalizeShoulderRest(raw){
  if(!raw)return null;
  const normalized=shoulderSplineApi?.normalizeRest?.({shoulderRest:raw});
  if(normalized)return normalized;
  const guide=raw.restGuide||raw.guide||{a:{x:.52,y:.56},b:{x:1,y:.57}},before=Array.isArray(raw.beforePoints)?raw.beforePoints:linearShoulderPoints(guide);
  return{
    enabled:raw.enabled!==false,useSpline:raw.useSpline!==undefined?!!raw.useSpline:raw.enabled===true,useRun1:!!raw.useRun1,splitFrame:!!raw.splitFrame,splitRightUsesIdle:!!raw.splitRightUsesIdle,
    frameShiftX:clamp(numberOr(raw.frameShiftX,.52),0,1),followFrameShiftX:raw.followFrameShiftX!==false,
    beforePoints:cloneShoulderPoints(before,linearShoulderPoints(guide)),afterPoints:cloneShoulderPoints(raw.afterPoints||raw.splinePoints||before,before),
  };
}
function defaultShoulderRest(){
  const profile=shoulderProfileApi?.defaultShoulderRest?.();
  return normalizeShoulderRest(profile)||normalizeShoulderRest({
    enabled:true,useSpline:true,useRun1:false,splitFrame:true,splitRightUsesIdle:true,frameShiftX:.52,followFrameShiftX:true,
    beforePoints:linearShoulderPoints({a:{x:.5423902927484727,y:.5694472546137244},b:{x:.9999996666666666,y:.572691993389205}}),
    afterPoints:[
      {x:.5423902927484727,y:.5694472546137244},{x:.579994260541451,y:.6169784772869725},{x:.6084907256392884,y:.6754227565965308},{x:.6278317471892272,y:.7447892691279848},{x:.6379693486738414,y:.8250870055447984},{x:.6388555185871044,y:.9163247704588463},{x:.6304422111109205,y:1.0185111823033606},
    ],
  });
}
function applyShoulderRestConfig(raw){
  const fallback=splineAllowedForCurrentSpecies()?defaultShoulderRest():null,rest=normalizeShoulderRest(raw)||fallback;
  shoulderRestUseSpline.checked=!!rest?.useSpline&&splineAllowedForCurrentSpecies();shoulderRestUseRun1.checked=!!rest?.useRun1;shoulderRestSplitFrame.checked=!!rest?.splitFrame;shoulderSplitRightIdle.checked=rest?.splitRightUsesIdle!==undefined?!!rest.splitRightUsesIdle:true;shoulderFollowFrameShiftX.checked=rest?.followFrameShiftX!==false;shoulderFrameShift.value=String(Math.round((rest?.frameShiftX??.52)*100));
  const fallbackBefore=linearShoulderPoints({a:{x:shoulderFrameShiftValue(),y:.56},b:{x:1,y:.57}});
  shoulderBeforePoints=cloneShoulderPoints(rest?.beforePoints,fallbackBefore);shoulderAfterPoints=cloneShoulderPoints(rest?.afterPoints,shoulderBeforePoints);lastShoulderFrameShift=shoulderFrameShiftValue();updateShoulderUi();clearShoulderFrameCache();clearShoulderSplitLayerCache();if(shouldNeedRun1Preview())ensureRun1Image();
}
function updateShoulderUi(){
  if(shoulderFrameShiftLabel)shoulderFrameShiftLabel.textContent=`${Math.round(shoulderFrameShiftValue()*100)}%`;shoulderFrameShiftWrap?.classList.toggle('hidden',!shoulderRestSplitFrame?.checked);
  const allowed=splineAllowedForCurrentSpecies();if(shoulderRestUseSpline){shoulderRestUseSpline.disabled=!allowed;if(!allowed)shoulderRestUseSpline.checked=false}
  const label=shoulderRestUseSpline?.closest?.('label');if(label)label.title=allowed?'':'Shoulder spline is currently enabled only for Grehlr, Voorg-Ass, Uumkao’ii, Gar-wolf, and Dabinggi-hound.';
  shoulderEditBefore?.classList.toggle('active',shoulderEditMode==='before');shoulderEditAfter?.classList.toggle('active',shoulderEditMode==='after');
}
function shouldNeedRun1Preview(){return!!shoulderRestUseRun1?.checked||!!((shoulderRestSplitFrame?.checked||shoulderPaintSource?.value==='right'||shoulderPaintSource?.value==='composite')&&!shoulderSplitRightIdle?.checked)}
function currentRun1PreviewPath(){const run=state.baseRecord?.sprites?.run;if(Array.isArray(run)&&run[0])return run[0];if(typeof run==='string'&&run)return run;const id=canonicalShoulderSpecies();return window.CreatureGeneticsRender?.SPECIES?.[id]?.base?.run1||''}
function clearShoulderFrameCache(){shoulderRun1Token++;shoulderRun1Image=null;shoulderRun1Path='';shoulderPaintCompositeCache=null}
function clearShoulderSplitLayerCache(){shoulderSplitLayerCache=null;shoulderPaintCompositeCache=null}
function ensureRun1Image(){
  if(shoulderSplitRightIdle?.checked&&state.image)return Promise.resolve(state.image);
  const path=currentRun1PreviewPath();if(!path)return Promise.resolve(null);if(shoulderRun1Image&&shoulderRun1Path===path)return Promise.resolve(shoulderRun1Image);const token=++shoulderRun1Token;
  return new Promise(resolve=>{const image=new Image();image.decoding='async';image.onload=()=>{if(token!==shoulderRun1Token)return resolve(null);shoulderRun1Image=image;shoulderRun1Path=path;clearShoulderSplitLayerCache();buildSourceSampler();draw();resolve(image)};image.onerror=()=>{if(token===shoulderRun1Token)setStatus(`Could not load run1 preview frame: ${path}`,false);resolve(null)};image.src=repoSpriteUrl(path)});
}
function rightShoulderSource(){return shoulderSplitRightIdle?.checked?state.image:(shoulderRun1Image||state.image)}
function splitLayerCanvases(){
  if(!state.image)return null;const rightSource=rightShoulderSource();if(!rightSource)return null;const s=sourceSize(),w=Math.max(1,s.width),h=Math.max(1,s.height),seam=Math.round(w*shoulderFrameShiftValue()),cached=shoulderSplitLayerCache;
  if(cached&&cached.idle===state.image&&cached.rightSource===rightSource&&cached.seam===seam&&cached.width===w&&cached.height===h)return cached;
  const left=document.createElement('canvas'),right=document.createElement('canvas');left.width=right.width=w;left.height=right.height=h;const lctx=left.getContext('2d'),rctx=right.getContext('2d');lctx.clearRect(0,0,w,h);rctx.clearRect(0,0,w,h);if(seam>0)lctx.drawImage(state.image,0,0,seam,h,0,0,seam,h);if(seam<w)rctx.drawImage(rightSource,seam,0,w-seam,h,seam,0,w-seam,h);return shoulderSplitLayerCache={idle:state.image,rightSource,seam,width:w,height:h,left,right};
}
function compositePaintSource(){
  const layers=splitLayerCanvases();if(!layers)return state.image;const cached=shoulderPaintCompositeCache;if(cached&&cached.left===layers.left&&cached.right===layers.right)return cached.canvas;const canvas=document.createElement('canvas');canvas.width=layers.width;canvas.height=layers.height;const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(layers.right,0,0);ctx.drawImage(layers.left,0,0);shoulderPaintCompositeCache={left:layers.left,right:layers.right,canvas};return canvas;
}
function selectedPaintSourceImage(){const mode=shoulderPaintSource?.value||'left';if(mode==='right')return rightShoulderSource()||state.image;if(mode==='composite')return compositePaintSource()||state.image;return state.image}
function refreshShoulderPresentation(){updateShoulderUi();clearShoulderSplitLayerCache();if(shouldNeedRun1Preview())ensureRun1Image();buildSourceSampler();draw()}

// Paint maps remain one canonical coordinate grid. This only changes the source
// art shown/sampled beneath it, so the right half can be painted directly.
buildSourceSampler=function buildSelectedShoulderSourceSampler(){
  if(!state.image||!state.weights)return;const image=selectedPaintSourceImage()||state.image,c=document.createElement('canvas');c.width=state.weights.width;c.height=state.weights.height;const cctx=c.getContext('2d',{willReadFrequently:true});cctx.clearRect(0,0,c.width,c.height);cctx.drawImage(image,0,0,c.width,c.height);state.sourceCanvas=c;try{state.sampleData=cctx.getImageData(0,0,c.width,c.height).data}catch(_){state.sampleData=null}
};
const drawPaintCanvasBeforeShoulderSource=drawPaintCanvas;
drawPaintCanvas=function drawPaintCanvasWithSelectedSource(){
  paintCtx.clearRect(0,0,paintCanvas.width,paintCanvas.height);if(!state.image)return;const fit=fitRectFor(paintCanvas);if(!fit)return;const image=selectedPaintSourceImage()||state.image;paintCtx.drawImage(image,fit.x,fit.y,fit.width,fit.height);drawOverlay(fit);drawGuides(fit);
};

function shoulderSplinePointAt(points,t){return shoulderSplineApi?.splinePoint?.(points,t)||points[Math.round(clamp(t,0,1)*(SHOULDER_POINT_COUNT-1))]}
function shoulderRestSourcePoint(sourceX,sourceY,headInfluence){const s=sourceSize();if(!shoulderRestUseSpline?.checked||!s.width||!s.height)return{x:sourceX,y:sourceY};const source={x:sourceX/s.width,y:sourceY/s.height},target=shoulderSplineApi?.deformWeightedPoint?.(source,headInfluence,currentShoulderRest())||source;return{x:target.x*s.width,y:target.y*s.height}}
function drawTexturedTriangleWithImage(ctx,image,s0,s1,s2,d0,d1,d2,overdraw){const denom=s0.x*(s1.y-s2.y)+s1.x*(s2.y-s0.y)+s2.x*(s0.y-s1.y);if(Math.abs(denom)<1e-8)return;const a=(d0.x*(s1.y-s2.y)+d1.x*(s2.y-s0.y)+d2.x*(s0.y-s1.y))/denom,b=(d0.y*(s1.y-s2.y)+d1.y*(s2.y-s0.y)+d2.y*(s0.y-s1.y))/denom,c=(d0.x*(s2.x-s1.x)+d1.x*(s0.x-s2.x)+d2.x*(s1.x-s0.x))/denom,d=(d0.y*(s2.x-s1.x)+d1.y*(s0.x-s2.x)+d2.y*(s1.x-s0.x))/denom,e=(d0.x*(s1.x*s2.y-s2.x*s1.y)+d1.x*(s2.x*s0.y-s0.x*s2.y)+d2.x*(s0.x*s1.y-s1.x*s0.y))/denom,f=(d0.y*(s1.x*s2.y-s2.x*s1.y)+d1.y*(s2.x*s0.y-s0.x*s2.y)+d2.y*(s0.x*s1.y-s1.x*s0.y))/denom,clip=expandTriangle(d0,d1,d2,overdraw);ctx.save();ctx.beginPath();ctx.moveTo(clip[0].x,clip[0].y);ctx.lineTo(clip[1].x,clip[1].y);ctx.lineTo(clip[2].x,clip[2].y);ctx.closePath();ctx.clip();ctx.transform(a,b,c,d,e,f);ctx.drawImage(image,0,0,sourceSize().width,sourceSize().height);ctx.restore()}
function shoulderPreviewVertices(useSpline){const s=sourceSize(),angleDeg=clamp(numberOr($('previewAngle').value,0),Math.min(numberOr($('minDeg').value,-30),numberOr($('maxDeg').value,30)),Math.max(numberOr($('minDeg').value,-30),numberOr($('maxDeg').value,30))),angle=angleDeg*Math.PI/180,maxDetail=clamp(Math.round(numberOr($('meshResolution').value,48)),12,72),aspect=s.width/Math.max(1,s.height),cols=aspect>=1?maxDetail:Math.max(8,Math.round(maxDetail*aspect)),rows=aspect>=1?Math.max(8,Math.round(maxDetail/aspect)):maxDetail,vertices=new Array((cols+1)*(rows+1)),canHead=!!(state.weights&&state.pivot),p=state.pivot;for(let y=0;y<=rows;y++)for(let x=0;x<=cols;x++){const u=x/cols,v=y/rows,sx=u*s.width,sy=v*s.height,base=state.weights?sampleGridWeight(u,v):0,rested=useSpline?shoulderRestSourcePoint(sx,sy,base):{x:sx,y:sy};vertices[y*(cols+1)+x]=canHead?deformedPoint(rested.x,rested.y,previewHeadWeight(u,v,angleDeg),angle,p):rested}return{vertices,cols,rows,cw:s.width/cols,ch:s.height/rows}}
function drawShoulderLayer(image,mesh){const{vertices,cols,rows,cw,ch}=mesh,overdraw=.8/Math.max(.001,fitRectFor(previewCanvas)?.scale||1);for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){const s00={x:x*cw,y:y*ch},s10={x:(x+1)*cw,y:y*ch},s01={x:x*cw,y:(y+1)*ch},s11={x:(x+1)*cw,y:(y+1)*ch},d00=vertices[y*(cols+1)+x],d10=vertices[y*(cols+1)+x+1],d01=vertices[(y+1)*(cols+1)+x],d11=vertices[(y+1)*(cols+1)+x+1];drawTexturedTriangleWithImage(previewCtx,image,s00,s10,s01,d00,d10,d01,overdraw);drawTexturedTriangleWithImage(previewCtx,image,s10,s11,s01,d10,d11,d01,overdraw)}}
const drawDeformedPreviewBeforeShoulder=drawDeformedPreview;
drawDeformedPreview=function drawDeformedPreviewWithBindPoseShoulder(){if(!state.image||!shoulderPresentationEnabled())return drawDeformedPreviewBeforeShoulder();const fit=fitRectFor(previewCanvas);if(!fit)return;previewCtx.clearRect(0,0,previewCanvas.width,previewCanvas.height);previewCtx.save();previewCtx.translate(fit.x,fit.y);previewCtx.scale(fit.scale,fit.scale);if(shoulderRestSplitFrame.checked){const layers=splitLayerCanvases();if(layers){drawShoulderLayer(layers.right,shoulderPreviewVertices(shoulderRestUseSpline.checked));drawShoulderLayer(layers.left,shoulderPreviewVertices(false))}else drawShoulderLayer(state.image,shoulderPreviewVertices(shoulderRestUseSpline.checked))}else{const source=shoulderRestUseRun1.checked?(shoulderRun1Image||state.image):state.image;drawShoulderLayer(source,shoulderPreviewVertices(shoulderRestUseSpline.checked))}previewCtx.restore()};

function drawSplineLine(points,fit,color,width,dash=[]){const s=sourceSize();paintCtx.save();paintCtx.translate(fit.x,fit.y);paintCtx.scale(fit.scale,fit.scale);paintCtx.strokeStyle=color;paintCtx.lineWidth=Math.max(1.2,width/Math.max(.001,fit.scale));paintCtx.setLineDash(dash.map(value=>value/Math.max(.001,fit.scale)));paintCtx.beginPath();for(let i=0;i<=80;i++){const p=shoulderSplinePointAt(points,i/80),x=p.x*s.width,y=p.y*s.height;i?paintCtx.lineTo(x,y):paintCtx.moveTo(x,y)}paintCtx.stroke();paintCtx.setLineDash([]);paintCtx.restore()}
const drawGuidesBeforeShoulder=drawGuides;
drawGuides=function drawGuidesWithBindPoseShoulder(fit){
  drawGuidesBeforeShoulder(fit);if(!state.image)return;const s=sourceSize();
  if(shoulderRestSplitFrame.checked){paintCtx.save();const seamX=fit.x+s.width*shoulderFrameShiftValue()*fit.scale;paintCtx.strokeStyle='rgba(240,200,120,.85)';paintCtx.lineWidth=Math.max(1.1,window.devicePixelRatio||1);paintCtx.setLineDash([5*(window.devicePixelRatio||1),5*(window.devicePixelRatio||1)]);paintCtx.beginPath();paintCtx.moveTo(seamX,fit.y);paintCtx.lineTo(seamX,fit.y+fit.height);paintCtx.stroke();paintCtx.restore()}
  if(!shoulderRestUseSpline.checked)return;
  drawSplineLine(shoulderBeforePoints,fit,shoulderEditMode==='before'?'rgba(115,215,255,1)':'rgba(115,215,255,.45)',shoulderEditMode==='before'?3:1.5,[8,5]);
  drawSplineLine(shoulderAfterPoints,fit,shoulderEditMode==='after'?'rgba(181,140,255,1)':'rgba(181,140,255,.5)',shoulderEditMode==='after'?3:1.7,[]);
  const points=activeShoulderPoints(),radius=Math.max(5,8/Math.max(.001,fit.scale));paintCtx.save();paintCtx.translate(fit.x,fit.y);paintCtx.scale(fit.scale,fit.scale);for(let index=0;index<SHOULDER_POINT_COUNT;index++){const p=points[index],x=p.x*s.width,y=p.y*s.height;paintCtx.fillStyle=shoulderEditMode==='before'?'rgba(115,215,255,.98)':'rgba(181,140,255,.98)';paintCtx.beginPath();paintCtx.arc(x,y,radius,0,Math.PI*2);paintCtx.fill();paintCtx.fillStyle='#111';paintCtx.font=`${Math.max(8,radius*1.05)}px system-ui`;paintCtx.textAlign='center';paintCtx.textBaseline='middle';paintCtx.fillText(String(index+1),x,y)}paintCtx.restore();
};
function shoulderPointAtPointer(point){if(!shoulderRestUseSpline.checked||!point)return-1;const s=sourceSize(),radius=Math.max(18,s.height*.035),points=activeShoulderPoints();let best=-1,bestDistance=Infinity;points.forEach((p,index)=>{const d=Math.hypot(point.x-p.x*s.width,point.y-p.y*s.height);if(d<=radius&&d<bestDistance){best=index;bestDistance=d}});return best}
function updateShoulderPoint(event){if(shoulderPointDrag<0)return;const p=pointerToSource(event),s=sourceSize();if(!p||!s.width||!s.height)return;activeShoulderPoints()[shoulderPointDrag]={x:p.x/s.width,y:p.y/s.height};requestDraw()}
paintCanvas.addEventListener('pointerdown',event=>{const handle=shoulderPointAtPointer(pointerToSource(event));if(handle<0)return;checkpointHistory();shoulderPointDrag=handle;paintCanvas.setPointerCapture?.(event.pointerId);event.preventDefault();event.stopImmediatePropagation();updateShoulderPoint(event)},true);
paintCanvas.addEventListener('pointermove',event=>{if(shoulderPointDrag<0)return;event.preventDefault();event.stopImmediatePropagation();updateShoulderPoint(event)},true);
const stopShoulderPoint=event=>{if(shoulderPointDrag<0)return;shoulderPointDrag=-1;paintCanvas.releasePointerCapture?.(event.pointerId);event.preventDefault();event.stopImmediatePropagation();draw()};paintCanvas.addEventListener('pointerup',stopShoulderPoint,true);paintCanvas.addEventListener('pointercancel',stopShoulderPoint,true);

const captureHistoryBeforeShoulder=captureHistoryState;
captureHistoryState=function captureHistoryStateWithBindPoseShoulder(){return{...captureHistoryBeforeShoulder(),shoulderRestUseSpline:!!shoulderRestUseSpline.checked,shoulderRestUseRun1:!!shoulderRestUseRun1.checked,shoulderRestSplitFrame:!!shoulderRestSplitFrame.checked,shoulderSplitRightIdle:!!shoulderSplitRightIdle.checked,shoulderFollowFrameShiftX:!!shoulderFollowFrameShiftX.checked,shoulderFrameShift:shoulderFrameShiftValue(),shoulderBeforePoints:cloneShoulderPoints(shoulderBeforePoints,shoulderBeforePoints),shoulderAfterPoints:cloneShoulderPoints(shoulderAfterPoints,shoulderBeforePoints)}};
const historySignatureBeforeShoulder=historySignature;
historySignature=function historySignatureWithBindPoseShoulder(snapshot){const sig=points=>(points||[]).map(p=>`${numberOr(p?.x,0).toFixed(4)},${numberOr(p?.y,0).toFixed(4)}`).join(';');return`${historySignatureBeforeShoulder(snapshot)}|sh${snapshot?.shoulderRestUseSpline?1:0}${snapshot?.shoulderRestUseRun1?1:0}${snapshot?.shoulderRestSplitFrame?1:0}${snapshot?.shoulderSplitRightIdle?1:0}${snapshot?.shoulderFollowFrameShiftX?1:0}|${numberOr(snapshot?.shoulderFrameShift,.52).toFixed(4)}|B${sig(snapshot?.shoulderBeforePoints)}|A${sig(snapshot?.shoulderAfterPoints)}`};
const restoreHistoryBeforeShoulder=restoreHistoryState;
restoreHistoryState=function restoreHistoryStateWithBindPoseShoulder(snapshot){if(snapshot){shoulderRestUseSpline.checked=!!snapshot.shoulderRestUseSpline;shoulderRestUseRun1.checked=!!snapshot.shoulderRestUseRun1;shoulderRestSplitFrame.checked=!!snapshot.shoulderRestSplitFrame;shoulderSplitRightIdle.checked=snapshot.shoulderSplitRightIdle!==false;shoulderFollowFrameShiftX.checked=snapshot.shoulderFollowFrameShiftX!==false;if(Number.isFinite(Number(snapshot.shoulderFrameShift)))shoulderFrameShift.value=String(Math.round(clamp(Number(snapshot.shoulderFrameShift),0,1)*100));if(snapshot.shoulderBeforePoints)shoulderBeforePoints=cloneShoulderPoints(snapshot.shoulderBeforePoints,shoulderBeforePoints);if(snapshot.shoulderAfterPoints)shoulderAfterPoints=cloneShoulderPoints(snapshot.shoulderAfterPoints,shoulderBeforePoints)}const result=restoreHistoryBeforeShoulder(snapshot);lastShoulderFrameShift=shoulderFrameShiftValue();updateShoulderUi();clearShoulderSplitLayerCache();buildSourceSampler();return result};

const applyRigToPaintBeforeShoulder=applyRigToPaint;
applyRigToPaint=function applyRigToPaintWithBindPoseShoulder(rig){const result=applyRigToPaintBeforeShoulder(rig);applyShoulderRestConfig(rig?.shoulderRest);buildSourceSampler();return result};
const applyRecordBeforeShoulder=applyRecord;
applyRecord=function applyRecordWithBindPoseShoulder(record,index=-1){const result=applyRecordBeforeShoulder(record,index);const id=String(record?.id||'').toLowerCase();if(id==='grehlr'&&window.HobunjiGrehlrHeadRigCorrection?.authored){applyRigToPaint(window.HobunjiGrehlrHeadRigCorrection.authored)}else if(splineAllowedForCurrentSpecies()&&!record?.headRig?.shoulderRest){applyShoulderRestConfig(defaultShoulderRest())}updateShoulderUi();clearShoulderFrameCache();if(shouldNeedRun1Preview())ensureRun1Image();return result};
const normalizedRigBeforeShoulder=normalizedRig;
normalizedRig=function normalizedRigWithBindPoseShoulder(){let rig=normalizedRigBeforeShoulder();if(!rig&&shoulderPresentationEnabled()&&state.image&&splineAllowedForCurrentSpecies())rig=shoulderProfileApi?.bodyOnlyRig?.()||{enabled:true,coordinateSpace:'sprite-normalized-top-left',pivot:{x:.5,y:.5},weightMap:{width:2,height:2,encoding:'rle-u9',unsetValue:256,data:[4,0]},minDeg:-30,maxDeg:30,restDeg:0,turnSpeedDeg:120,meshResolution:48};if(!rig)return rig;if(shoulderPresentationEnabled())rig.shoulderRest=currentShoulderRest();else delete rig.shoulderRest;return rig};

function moveSplineWithFrameShift(){const next=shoulderFrameShiftValue(),delta=next-lastShoulderFrameShift;if(shoulderFollowFrameShiftX.checked&&Math.abs(delta)>1e-9){for(const p of shoulderBeforePoints)p.x+=delta;for(const p of shoulderAfterPoints)p.x+=delta}lastShoulderFrameShift=next;updateShoulderUi();clearShoulderSplitLayerCache();buildSourceSampler();draw()}
shoulderFrameShift?.addEventListener('input',moveSplineWithFrameShift);
for(const control of [shoulderRestUseSpline,shoulderRestUseRun1,shoulderRestSplitFrame,shoulderSplitRightIdle,shoulderFollowFrameShiftX])control?.addEventListener('pointerdown',()=>checkpointHistory());
shoulderRestUseSpline?.addEventListener('change',refreshShoulderPresentation);
shoulderRestUseRun1?.addEventListener('change',()=>{if(shoulderRestUseRun1.checked)shoulderRestSplitFrame.checked=false;refreshShoulderPresentation()});
shoulderRestSplitFrame?.addEventListener('change',()=>{if(shoulderRestSplitFrame.checked)shoulderRestUseRun1.checked=false;refreshShoulderPresentation()});
shoulderSplitRightIdle?.addEventListener('change',()=>{clearShoulderFrameCache();refreshShoulderPresentation()});
shoulderFollowFrameShiftX?.addEventListener('change',()=>{lastShoulderFrameShift=shoulderFrameShiftValue();draw()});
shoulderPaintSource?.addEventListener('change',()=>{if(shouldNeedRun1Preview())ensureRun1Image();buildSourceSampler();draw()});
shoulderEditBefore?.addEventListener('click',()=>{shoulderEditMode='before';if(shoulderRestSplitFrame.checked)shoulderPaintSource.value='right';if(shouldNeedRun1Preview())ensureRun1Image();buildSourceSampler();updateShoulderUi();draw()});
shoulderEditAfter?.addEventListener('click',()=>{shoulderEditMode='after';updateShoulderUi();draw()});
copyShoulderBeforeToAfter?.addEventListener('click',()=>{checkpointHistory();shoulderAfterPoints=cloneShoulderPoints(shoulderBeforePoints,shoulderBeforePoints);shoulderEditMode='after';updateShoulderUi();draw()});
resetShoulderSpline?.addEventListener('click',()=>{checkpointHistory();const fallback=splineAllowedForCurrentSpecies()?defaultShoulderRest():null,before=fallback?.beforePoints||linearShoulderPoints({a:{x:shoulderFrameShiftValue(),y:.5},b:{x:1,y:.5}});shoulderBeforePoints=cloneShoulderPoints(before,before);shoulderAfterPoints=cloneShoulderPoints(fallback?.afterPoints||before,before);draw()});
$('animalId')?.addEventListener('change',()=>{updateShoulderUi();if(splineAllowedForCurrentSpecies()&&!state.baseRecord?.headRig?.shoulderRest&&!shoulderPresentationEnabled())applyShoulderRestConfig(defaultShoulderRest())});

// Keep Uumkao'ii available even though the older static bestiary does not carry it.
const runtimeRiggerSupplementsBeforeShoulder=runtimeRiggerSupplements;
runtimeRiggerSupplements=function runtimeRiggerSupplementsWithUum(repoRecords){const supplements=runtimeRiggerSupplementsBeforeShoulder(repoRecords),known=new Set([...repoRecords,...supplements].map(record=>record?.id).filter(Boolean));if(known.has('uumkaoii'))return supplements;const species=window.CreatureGeneticsRender?.SPECIES?.uumkaoii,idle=species?.base?.idle||"assets/creaturesprites/uumkao'ii.png",baseline=repoRecords.find(record=>record?.id==='uumkaoii-wild')||{},run=[species?.base?.run1,species?.base?.run2].filter(path=>path&&path!==idle);supplements.push({id:'uumkaoii',label:"Uumkao'ii",modelWidth:Math.max(.01,numberOr(baseline.modelWidth,1.275)),spriteAspect:Math.max(.01,numberOr(baseline.spriteAspect,451/641)),tint:/^#[0-9a-f]{6}$/i.test(baseline.tint||'')?baseline.tint:'#ffffff',diet:baseline.diet||'prey',hostile:false,sprites:{idle,...(run.length?{run}:{})}});return supplements};

// Save Preview keeps the round-trip guard and now verifies the bind/pose schema.
$('savePreviewRig').onclick=()=>{try{const record=buildRecord(),rig=normalizedRig();if(!record.id)throw new Error('Animal ID is required.');if(!rig)throw new Error('Paint some Head influence and set a pivot, or enable a supported shoulder spline.');const rigs=readPreviewRigs();rigs[record.id]=rig;writePreviewRigs(rigs);const stored=readPreviewRigs()?.[record.id];if(!stored||JSON.stringify(stored)!==JSON.stringify(rig))throw new Error('Preview rig write did not round-trip from browser storage.');const rest=stored.shoulderRest;if(rest?.useSpline&&(!Array.isArray(rest.beforePoints)||rest.beforePoints.length!==7||!Array.isArray(rest.afterPoints)||rest.afterPoints.length!==7))throw new Error('Preview rig lost BEFORE/AFTER spline points.');const shoulderSummary=rest?` Shoulder: ${rest.useSpline?'BEFORE→AFTER spline':'no spline'}, ${rest.splitFrame?`${rest.splitRightUsesIdle?'idle/idle':'idle/run1'} split ${Math.round(numberOr(rest.frameShiftX,.52)*100)}%`:rest.useRun1?'run1':'idle'}.`:'';setStatus(`Saved and verified preview rig for ${record.id}.${shoulderSummary} Reload/respawn that animal in the game.`,true);draw()}catch(e){setStatus(e.message||String(e),false)}};
const updateStatusBeforeShoulder=updateStatus;
updateStatus=function updateStatusWithBindPoseShoulder(){updateStatusBeforeShoulder();if(!shoulderPresentationEnabled())return;const rest=currentShoulderRest(),source=rest.splitFrame?(rest.splitRightUsesIdle?'idle-left over idle-right':'idle-left over run1-right'):(rest.useRun1?'full run1':'idle');$('status').textContent+=`\nShoulder: ${source} | spline ${rest.useSpline?'ON':'off'} | edit ${shoulderEditMode.toUpperCase()} | paint source ${(shoulderPaintSource?.value||'left').toUpperCase()} | follows seam ${rest.followFrameShiftX?'YES':'no'}`};

const materialHintNode=$('materialHint');if(materialHintNode&&!materialHintNode.textContent.includes('yaw head turns'))materialHintNode.textContent+=' Stretchability also limits yaw head turns in either direction.';

// Keep the full sprite visible. Settings, not canvases, absorb short viewport height.
function fitCanvasInsideHost(canvas){const host=canvas?.parentElement?.getBoundingClientRect?.();if(!host?.width||!host?.height)return;const source=sourceSize(),aspect=source.width>0&&source.height>0?source.width/source.height:host.width/Math.max(1,host.height);let cssWidth=host.width,cssHeight=cssWidth/Math.max(.0001,aspect);if(cssHeight>host.height){cssHeight=host.height;cssWidth=cssHeight*aspect}cssWidth=Math.max(1,cssWidth);cssHeight=Math.max(1,cssHeight);canvas.style.width=`${cssWidth}px`;canvas.style.height=`${cssHeight}px`;const dpr=Math.max(1,window.devicePixelRatio||1),pixelWidth=Math.max(1,Math.round(cssWidth*dpr)),pixelHeight=Math.max(1,Math.round(cssHeight*dpr));if(canvas.width!==pixelWidth)canvas.width=pixelWidth;if(canvas.height!==pixelHeight)canvas.height=pixelHeight}
resizeCanvases=function resizeContainedRigCanvases(){fitCanvasInsideHost(paintCanvas);fitCanvasInsideHost(previewCanvas);draw()};const containedCanvasObserver=new ResizeObserver(()=>resizeCanvases());containedCanvasObserver.observe(paintCanvas.parentElement);containedCanvasObserver.observe(previewCanvas.parentElement);window.addEventListener('resize',resizeCanvases);

applyShoulderRestConfig(state.baseRecord?.headRig?.shoulderRest||null);updateShoulderUi();resizeCanvases();
