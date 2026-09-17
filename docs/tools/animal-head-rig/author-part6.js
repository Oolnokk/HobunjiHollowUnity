'use strict';

// Shoulder-pet presentation is deliberately independent from the ordinary head
// pivot. The spline owns its own A/B guide, while frame presentation (idle,
// run1, or a left-idle/right-run1 composite) can be authored separately.
const shoulderRestUseSpline=$('shoulderRestUseSpline'); // Enables only the spline deformation; frame art can remain idle.
const shoulderRestUseRun1=$('shoulderRestUseRun1'); // Enables a full run1 stance without requiring spline deformation.
const shoulderRestSplitFrame=$('shoulderRestSplitFrame'); // Enables idle-left/run1-right compositing as a third frame presentation mode.
const shoulderFrameShift=$('shoulderFrameShift'); // Controls the normalized X seam used by the split-frame compositor.
const shoulderFrameShiftLabel=$('shoulderFrameShiftLabel'); // Mirrors the split seam percentage for touch/mobile editing.
const shoulderFrameShiftWrap=$('shoulderFrameShiftWrap'); // Hidden unless split-frame mode is active.
const shoulderRestBend=$('shoulderRestBend'); // Signed midpoint offset as a fraction of the authored A/B guide length.
const shoulderRestBendLabel=$('shoulderRestBendLabel'); // Mirrors the signed bend percentage.
const resetShoulderGuide=$('resetShoulderGuide'); // Restores the simple horizontal guide used by the standalone spline rigger.
let shoulderGuide={a:{x:.14,y:.46},b:{x:.86,y:.46}}; // Normalized top-left sprite coordinates; fully independent of the neck pivot.
let shoulderHandleDrag=null; // 'a', 'b', or 'bend' while a spline handle owns pointer input.
let shoulderRun1Image=null; // Cached run1 art used only for preview/composite drawing.
let shoulderRun1Path=''; // Path paired with shoulderRun1Image so record changes invalidate the cache.
let shoulderRun1Token=0; // Rejects stale asynchronous run1 loads after fast animal changes.
let shoulderCompositeCanvas=null; // Reused idle/run1 composite canvas for the current seam position.

function clamp01(value){return clamp(numberOr(value,0),0,1)}
function defaultShoulderGuide(){return{a:{x:.14,y:.46},b:{x:.86,y:.46}}}
function cloneShoulderGuide(guide=shoulderGuide){return{a:{x:clamp01(guide?.a?.x),y:clamp01(guide?.a?.y)},b:{x:clamp01(guide?.b?.x),y:clamp01(guide?.b?.y)}}}
function shoulderBendValue(){return clamp(numberOr(shoulderRestBend?.value,0)/100,-.75,.75)}
function shoulderFrameShiftValue(){return clamp(numberOr(shoulderFrameShift?.value,50)/100,0,1)}
function shoulderPresentationEnabled(){return!!(shoulderRestUseSpline?.checked||shoulderRestUseRun1?.checked||shoulderRestSplitFrame?.checked)}
function updateShoulderLabels(){
  if(shoulderRestBendLabel)shoulderRestBendLabel.textContent=`${Math.round(shoulderBendValue()*100)}%`;
  if(shoulderFrameShiftLabel)shoulderFrameShiftLabel.textContent=`${Math.round(shoulderFrameShiftValue()*100)}%`;
  shoulderFrameShiftWrap?.classList.toggle('hidden',!shoulderRestSplitFrame?.checked);
}
function currentRun1PreviewPath(){
  const run=state.baseRecord?.sprites?.run;
  if(Array.isArray(run)&&run[0])return run[0];
  if(typeof run==='string'&&run)return run;
  const id=$('animalId')?.value?.trim?.();
  return window.CreatureGeneticsRender?.SPECIES?.[id]?.base?.run1||'';
}
function clearShoulderFrameCache(){shoulderRun1Token++;shoulderRun1Image=null;shoulderRun1Path='';shoulderCompositeCanvas=null}
function ensureRun1Image(){
  const path=currentRun1PreviewPath();
  if(!path)return Promise.resolve(null);
  if(shoulderRun1Image&&shoulderRun1Path===path)return Promise.resolve(shoulderRun1Image);
  const token=++shoulderRun1Token;
  return new Promise(resolve=>{
    const image=new Image(); // Used only by the preview so the authored paint grid remains tied to the ordinary source image.
    image.decoding='async';
    image.onload=()=>{
      if(token!==shoulderRun1Token)return resolve(null);
      shoulderRun1Image=image;shoulderRun1Path=path;shoulderCompositeCanvas=null;draw();resolve(image);
    };
    image.onerror=()=>{if(token===shoulderRun1Token)setStatus(`Could not load run1 preview frame: ${path}`,false);resolve(null)};
    image.src=repoSpriteUrl(path);
  });
}
function splitPresentationCanvas(){
  if(!state.image||!shoulderRun1Image)return state.image;
  const s=sourceSize(),w=Math.max(1,s.width),h=Math.max(1,s.height);
  const canvas=shoulderCompositeCanvas||(shoulderCompositeCanvas=document.createElement('canvas'));
  if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h}
  const ctx=canvas.getContext('2d');
  ctx.clearRect(0,0,w,h);
  const cut=Math.round(w*shoulderFrameShiftValue());
  if(cut>0)ctx.drawImage(state.image,0,0,cut,h,0,0,cut,h);
  if(cut<w)ctx.drawImage(shoulderRun1Image,cut,0,w-cut,h,cut,0,w-cut,h);
  return canvas;
}
function shoulderPresentationImage(){
  if(shoulderRestSplitFrame?.checked)return shoulderRun1Image?splitPresentationCanvas():state.image;
  if(shoulderRestUseRun1?.checked)return shoulderRun1Image||state.image;
  return state.image;
}
function refreshShoulderPresentation(){
  updateShoulderLabels();shoulderCompositeCanvas=null;
  if(shoulderRestUseRun1?.checked||shoulderRestSplitFrame?.checked)ensureRun1Image();
  draw();
}

function normalizedShoulderRest(raw){
  if(!raw)return null;
  const legacyCenter=clamp01(raw.centerV??.46),fallback={a:{x:.14,y:legacyCenter},b:{x:.86,y:legacyCenter}};
  return{
    useSpline:raw.useSpline!==undefined?!!raw.useSpline:raw.enabled===true,
    useRun1:!!raw.useRun1,
    splitFrame:!!raw.splitFrame,
    frameShiftX:clamp01(raw.frameShiftX??.5),
    guide:cloneShoulderGuide(raw.guide||fallback),
    bend:clamp(numberOr(raw.bend,0),-.75,.75),
  };
}
function applyShoulderRestConfig(raw){
  const rest=normalizedShoulderRest(raw);
  shoulderRestUseSpline.checked=!!rest?.useSpline;
  shoulderRestUseRun1.checked=!!rest?.useRun1;
  shoulderRestSplitFrame.checked=!!rest?.splitFrame;
  shoulderFrameShift.value=String(Math.round((rest?.frameShiftX??.5)*100));
  shoulderRestBend.value=String(Math.round((rest?.bend??0)*100));
  shoulderGuide=cloneShoulderGuide(rest?.guide||defaultShoulderGuide());
  updateShoulderLabels();clearShoulderFrameCache();
  if(shoulderRestUseRun1.checked||shoulderRestSplitFrame.checked)ensureRun1Image();
}

const previousCaptureHistoryState=captureHistoryState; // Extends paint history with every shoulder-presentation authoring value.
captureHistoryState=function captureHistoryStateWithShoulderPresentation(){return{
  ...previousCaptureHistoryState(),
  shoulderRestUseSpline:!!shoulderRestUseSpline?.checked,
  shoulderRestUseRun1:!!shoulderRestUseRun1?.checked,
  shoulderRestSplitFrame:!!shoulderRestSplitFrame?.checked,
  shoulderFrameShift:shoulderFrameShiftValue(),
  shoulderRestBend:shoulderBendValue(),
  shoulderGuide:cloneShoulderGuide(),
}}
const previousHistorySignature=historySignature;
historySignature=function historySignatureWithShoulderPresentation(snapshot){const g=snapshot?.shoulderGuide;return`${previousHistorySignature(snapshot)}|sr${snapshot?.shoulderRestUseSpline?1:0}${snapshot?.shoulderRestUseRun1?1:0}${snapshot?.shoulderRestSplitFrame?1:0},${numberOr(snapshot?.shoulderFrameShift,.5).toFixed(4)},${numberOr(snapshot?.shoulderRestBend,0).toFixed(4)},${numberOr(g?.a?.x,.14).toFixed(4)},${numberOr(g?.a?.y,.46).toFixed(4)},${numberOr(g?.b?.x,.86).toFixed(4)},${numberOr(g?.b?.y,.46).toFixed(4)}`}
const previousRestoreHistoryState=restoreHistoryState;
restoreHistoryState=function restoreHistoryStateWithShoulderPresentation(snapshot){
  if(snapshot&&typeof snapshot.shoulderRestUseSpline==='boolean')shoulderRestUseSpline.checked=snapshot.shoulderRestUseSpline;
  if(snapshot&&typeof snapshot.shoulderRestUseRun1==='boolean')shoulderRestUseRun1.checked=snapshot.shoulderRestUseRun1;
  if(snapshot&&typeof snapshot.shoulderRestSplitFrame==='boolean')shoulderRestSplitFrame.checked=snapshot.shoulderRestSplitFrame;
  if(snapshot&&Number.isFinite(Number(snapshot.shoulderFrameShift)))shoulderFrameShift.value=String(Math.round(clamp01(snapshot.shoulderFrameShift)*100));
  if(snapshot&&Number.isFinite(Number(snapshot.shoulderRestBend)))shoulderRestBend.value=String(Math.round(clamp(Number(snapshot.shoulderRestBend),-.75,.75)*100));
  if(snapshot?.shoulderGuide)shoulderGuide=cloneShoulderGuide(snapshot.shoulderGuide);
  updateShoulderLabels();previousRestoreHistoryState(snapshot);refreshShoulderPresentation();
}

const previousApplyRecord=applyRecord;
applyRecord=function applyRecordWithShoulderPresentation(record,index=-1){applyShoulderRestConfig(record?.headRig?.shoulderRest);return previousApplyRecord(record,index)}
const previousApplyRigToPaint=applyRigToPaint;
applyRigToPaint=function applyRigToPaintWithShoulderPresentation(rig){applyShoulderRestConfig(rig?.shoulderRest);return previousApplyRigToPaint(rig)}
const previousNormalizedRig=normalizedRig;
normalizedRig=function normalizedRigWithShoulderPresentation(){
  const rig=previousNormalizedRig();if(!rig)return rig;
  if(shoulderPresentationEnabled())rig.shoulderRest={
    enabled:true,
    useSpline:!!shoulderRestUseSpline.checked,
    useRun1:!!shoulderRestUseRun1.checked,
    splitFrame:!!shoulderRestSplitFrame.checked,
    frameShiftX:shoulderFrameShiftValue(),
    guide:cloneShoulderGuide(),
    bend:shoulderBendValue(),
  };else delete rig.shoulderRest;
  return rig;
}

function guidePixels(){const s=sourceSize();return{a:{x:shoulderGuide.a.x*s.width,y:shoulderGuide.a.y*s.height},b:{x:shoulderGuide.b.x*s.width,y:shoulderGuide.b.y*s.height}}}
function guideFrame(){
  const g=guidePixels(),dx=g.b.x-g.a.x,dy=g.b.y-g.a.y,len=Math.hypot(dx,dy)||1;
  return{...g,dx,dy,len,tx:dx/len,ty:dy/len,nx:-dy/len,ny:dx/len};
}
function shoulderMidHandle(){const f=guideFrame(),mid={x:(f.a.x+f.b.x)/2,y:(f.a.y+f.b.y)/2},offset=shoulderBendValue()*f.len;return{x:mid.x+f.nx*offset,y:mid.y+f.ny*offset}}
function normalizedSplinePoint(u,v){
  const rest={enabled:true,useSpline:true,guide:cloneShoulderGuide(),bend:shoulderBendValue()};
  const api=window.AnimalShoulderRest;
  if(api?.deformNormalizedPoint)return api.deformNormalizedPoint({x:u,y:v},rest);
  const a=rest.guide.a,b=rest.guide.b,dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1,len2=len*len,t=((u-a.x)*dx+(v-a.y)*dy)/len2;
  if(t<0||t>1)return{x:u,y:v};
  const tx=dx/len,ty=dy/len,nx=-ty,ny=tx,lineX=a.x+dx*t,lineY=a.y+dy*t,offset=(u-lineX)*nx+(v-lineY)*ny,midOffset=4*(1-t)*t*rest.bend*len,derivativeX=dx+nx*(4*rest.bend*len*(1-2*t)),derivativeY=dy+ny*(4*rest.bend*len*(1-2*t)),dLen=Math.hypot(derivativeX,derivativeY)||1,newNx=-derivativeY/dLen,newNy=derivativeX/dLen;
  return{x:lineX+nx*midOffset+newNx*offset,y:lineY+ny*midOffset+newNy*offset};
}
function shoulderRestSourcePoint(sourceX,sourceY,headInfluence){
  const s=sourceSize(),u=clamp01(sourceX/Math.max(1,s.width)),v=clamp01(sourceY/Math.max(1,s.height)),target=normalizedSplinePoint(u,v),bodyWeight=1-clamp(headInfluence,0,1);
  return{x:sourceX+(target.x*s.width-sourceX)*bodyWeight,y:sourceY+(target.y*s.height-sourceY)*bodyWeight};
}

const previousDrawGuides=drawGuides;
drawGuides=function drawGuidesWithIndependentShoulderSpline(fit){
  previousDrawGuides(fit);if(!shoulderRestUseSpline?.checked||!state.image)return;
  const f=guideFrame(),mid=shoulderMidHandle(),r=Math.max(5,8/Math.max(.001,fit.scale)),steps=36;
  paintCtx.save();paintCtx.translate(fit.x,fit.y);paintCtx.scale(fit.scale,fit.scale);
  paintCtx.strokeStyle='rgba(181,140,255,.62)';paintCtx.lineWidth=Math.max(1.2,1.7/Math.max(.001,fit.scale));paintCtx.setLineDash([8/Math.max(.001,fit.scale),6/Math.max(.001,fit.scale)]);paintCtx.beginPath();paintCtx.moveTo(f.a.x,f.a.y);paintCtx.lineTo(f.b.x,f.b.y);paintCtx.stroke();paintCtx.setLineDash([]);
  paintCtx.strokeStyle='rgba(181,140,255,.98)';paintCtx.lineWidth=Math.max(1.7,2.3/Math.max(.001,fit.scale));paintCtx.beginPath();for(let i=0;i<=steps;i++){const t=i/steps,p=normalizedSplinePoint(shoulderGuide.a.x+(shoulderGuide.b.x-shoulderGuide.a.x)*t,shoulderGuide.a.y+(shoulderGuide.b.y-shoulderGuide.a.y)*t),x=p.x*sourceSize().width,y=p.y*sourceSize().height;i?paintCtx.lineTo(x,y):paintCtx.moveTo(x,y)}paintCtx.stroke();
  const circle=(p,label)=>{paintCtx.fillStyle='rgba(181,140,255,.98)';paintCtx.beginPath();paintCtx.arc(p.x,p.y,r,0,Math.PI*2);paintCtx.fill();paintCtx.fillStyle='#111';paintCtx.font=`${Math.max(8,r*1.1)}px system-ui`;paintCtx.textAlign='center';paintCtx.textBaseline='middle';paintCtx.fillText(label,p.x,p.y)};circle(f.a,'A');circle(f.b,'B');
  paintCtx.fillStyle='rgba(240,200,120,.98)';paintCtx.beginPath();paintCtx.moveTo(mid.x,mid.y-r);paintCtx.lineTo(mid.x+r,mid.y);paintCtx.lineTo(mid.x,mid.y+r);paintCtx.lineTo(mid.x-r,mid.y);paintCtx.closePath();paintCtx.fill();paintCtx.restore();
}

function drawTexturedTriangleWithImage(ctx,image,s0,s1,s2,d0,d1,d2,overdraw){
  const denom=s0.x*(s1.y-s2.y)+s1.x*(s2.y-s0.y)+s2.x*(s0.y-s1.y);if(Math.abs(denom)<1e-8)return;
  const a=(d0.x*(s1.y-s2.y)+d1.x*(s2.y-s0.y)+d2.x*(s0.y-s1.y))/denom,b=(d0.y*(s1.y-s2.y)+d1.y*(s2.y-s0.y)+d2.y*(s0.y-s1.y))/denom,c=(d0.x*(s2.x-s1.x)+d1.x*(s0.x-s2.x)+d2.x*(s1.x-s0.x))/denom,d=(d0.y*(s2.x-s1.x)+d1.y*(s0.x-s2.x)+d2.y*(s1.x-s0.x))/denom,e=(d0.x*(s1.x*s2.y-s2.x*s1.y)+d1.x*(s2.x*s0.y-s0.x*s2.y)+d2.x*(s0.x*s1.y-s1.x*s0.y))/denom,f=(d0.y*(s1.x*s2.y-s2.x*s1.y)+d1.y*(s2.x*s0.y-s0.x*s2.y)+d2.y*(s0.x*s1.y-s1.x*s0.y))/denom,clip=expandTriangle(d0,d1,d2,overdraw);
  ctx.save();ctx.beginPath();ctx.moveTo(clip[0].x,clip[0].y);ctx.lineTo(clip[1].x,clip[1].y);ctx.lineTo(clip[2].x,clip[2].y);ctx.closePath();ctx.clip();ctx.transform(a,b,c,d,e,f);ctx.drawImage(image,0,0,sourceSize().width,sourceSize().height);ctx.restore();
}

drawPaintCanvas=function drawPaintCanvasWithShoulderFrame(){
  paintCtx.clearRect(0,0,paintCanvas.width,paintCanvas.height);if(!state.image)return;const fit=fitRectFor(paintCanvas);if(!fit)return;const image=shoulderPresentationImage()||state.image;paintCtx.drawImage(image,fit.x,fit.y,fit.width,fit.height);drawOverlay(fit);drawGuides(fit);
}
drawDeformedPreview=function drawDeformedPreviewWithIndependentShoulderSpline(){
  const fit=fitRectFor(previewCanvas);if(!fit||!state.image)return;const image=shoulderPresentationImage()||state.image;previewCtx.clearRect(0,0,previewCanvas.width,previewCanvas.height);
  if(!state.weights||!state.pivot){previewCtx.drawImage(image,fit.x,fit.y,fit.width,fit.height);return}
  const s=sourceSize(),angleDeg=clamp(numberOr($('previewAngle').value,0),Math.min(numberOr($('minDeg').value,-30),numberOr($('maxDeg').value,30)),Math.max(numberOr($('minDeg').value,-30),numberOr($('maxDeg').value,30))),angle=angleDeg*Math.PI/180,maxDetail=clamp(Math.round(numberOr($('meshResolution').value,48)),12,72),aspect=s.width/Math.max(1,s.height),cols=aspect>=1?maxDetail:Math.max(8,Math.round(maxDetail*aspect)),rows=aspect>=1?Math.max(8,Math.round(maxDetail/aspect)):maxDetail,cw=s.width/cols,ch=s.height/rows,p=state.pivot,vertices=new Array((cols+1)*(rows+1));
  for(let y=0;y<=rows;y++)for(let x=0;x<=cols;x++){const u=x/cols,v=y/rows,sx=u*s.width,sy=v*s.height,base=sampleGridWeight(u,v),rested=shoulderRestUseSpline?.checked?shoulderRestSourcePoint(sx,sy,base):{x:sx,y:sy},w=previewHeadWeight(u,v,angleDeg);vertices[y*(cols+1)+x]=deformedPoint(rested.x,rested.y,w,angle,p)}
  previewCtx.save();previewCtx.translate(fit.x,fit.y);previewCtx.scale(fit.scale,fit.scale);const overdraw=.8/Math.max(.001,fit.scale);
  for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){const s00={x:x*cw,y:y*ch},s10={x:(x+1)*cw,y:y*ch},s01={x:x*cw,y:(y+1)*ch},s11={x:(x+1)*cw,y:(y+1)*ch},d00=vertices[y*(cols+1)+x],d10=vertices[y*(cols+1)+x+1],d01=vertices[(y+1)*(cols+1)+x],d11=vertices[(y+1)*(cols+1)+x+1];drawTexturedTriangleWithImage(previewCtx,image,s00,s10,s01,d00,d10,d01,overdraw);drawTexturedTriangleWithImage(previewCtx,image,s10,s11,s01,d10,d11,d01,overdraw)}previewCtx.restore();
}

function pointerHandle(p){if(!shoulderRestUseSpline?.checked||!p)return null;const f=guideFrame(),m=shoulderMidHandle(),radius=Math.max(18,sourceSize().height*.035),items=[['a',f.a],['b',f.b],['bend',m]];let best=null,bestDistance=Infinity;for(const[name,point]of items){const d=Math.hypot(p.x-point.x,p.y-point.y);if(d<=radius&&d<bestDistance){best=name;bestDistance=d}}return best}
function updateShoulderHandle(event){const p=pointerToSource(event),s=sourceSize();if(!p||!s.width||!s.height)return;if(shoulderHandleDrag==='a'||shoulderHandleDrag==='b'){shoulderGuide[shoulderHandleDrag]={x:clamp01(p.x/s.width),y:clamp01(p.y/s.height)}}else if(shoulderHandleDrag==='bend'){const f=guideFrame(),midX=(f.a.x+f.b.x)/2,midY=(f.a.y+f.b.y)/2,signed=(p.x-midX)*f.nx+(p.y-midY)*f.ny;shoulderRestBend.value=String(Math.round(clamp(signed/f.len,-.75,.75)*100));updateShoulderLabels()}requestDraw()}
paintCanvas.addEventListener('pointerdown',event=>{const p=pointerToSource(event),handle=pointerHandle(p);if(!handle)return;checkpointHistory();shoulderHandleDrag=handle;paintCanvas.setPointerCapture?.(event.pointerId);event.preventDefault();event.stopImmediatePropagation();updateShoulderHandle(event)},true);
paintCanvas.addEventListener('pointermove',event=>{if(!shoulderHandleDrag)return;event.preventDefault();event.stopImmediatePropagation();updateShoulderHandle(event)},true);
const stopShoulderHandle=event=>{if(!shoulderHandleDrag)return;shoulderHandleDrag=null;paintCanvas.releasePointerCapture?.(event.pointerId);event.preventDefault();event.stopImmediatePropagation();draw()};paintCanvas.addEventListener('pointerup',stopShoulderHandle,true);paintCanvas.addEventListener('pointercancel',stopShoulderHandle,true);

function checkpointOnPointer(control){control?.addEventListener('pointerdown',()=>checkpointHistory())}
checkpointOnPointer(shoulderRestUseSpline);checkpointOnPointer(shoulderRestUseRun1);checkpointOnPointer(shoulderRestSplitFrame);checkpointOnPointer(shoulderFrameShift);checkpointOnPointer(shoulderRestBend);
shoulderRestUseSpline?.addEventListener('change',refreshShoulderPresentation);
shoulderRestUseRun1?.addEventListener('change',()=>{if(shoulderRestUseRun1.checked)shoulderRestSplitFrame.checked=false;refreshShoulderPresentation()});
shoulderRestSplitFrame?.addEventListener('change',()=>{if(shoulderRestSplitFrame.checked)shoulderRestUseRun1.checked=false;refreshShoulderPresentation()});
shoulderFrameShift?.addEventListener('input',()=>{shoulderCompositeCanvas=null;updateShoulderLabels();draw()});
shoulderRestBend?.addEventListener('input',()=>{updateShoulderLabels();draw()});
resetShoulderGuide?.addEventListener('click',()=>{checkpointHistory();shoulderGuide=defaultShoulderGuide();shoulderRestBend.value='0';updateShoulderLabels();draw()});

const previousUpdateStatus=updateStatus;
updateStatus=function updateStatusWithShoulderPresentation(){previousUpdateStatus();if(!shoulderPresentationEnabled())return;const mode=shoulderRestSplitFrame.checked?`split idle/run1 @ ${Math.round(shoulderFrameShiftValue()*100)}%`:shoulderRestUseRun1.checked?'run1':'idle';const g=shoulderGuide;$('status').textContent+=`\nShoulder: frame ${mode} | spline ${shoulderRestUseSpline.checked?'ON':'off'} | A ${g.a.x.toFixed(3)},${g.a.y.toFixed(3)} → B ${g.b.x.toFixed(3)},${g.b.y.toFixed(3)} | bend ${Math.round(shoulderBendValue()*100)}%`}

updateShoulderLabels();
