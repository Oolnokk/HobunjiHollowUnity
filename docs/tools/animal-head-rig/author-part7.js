'use strict';

// author-part6 has to install before this so its shoulder presentation helpers
// exist. This final wrapper refreshes run1/split art only AFTER applyRecord has
// committed the new species and then adds the saved spline-weight falloff plus
// explicit split-frame preview layering.
const shoulderAwareApplyRecord=applyRecord; // Current applyRecord already restores the saved shoulder configuration.
applyRecord=function applyRecordThenRefreshShoulderFrame(record,index=-1){
  const result=shoulderAwareApplyRecord(record,index);
  clearShoulderFrameCache();
  clearShoulderSplitLayerCache();
  refreshShoulderPresentation();
  return result;
};

const materialHintNode=$('materialHint'); // Existing material-paint help; yaw uses the same Stretchability channel in both directions.
if(materialHintNode&&!materialHintNode.textContent.includes('yaw head turns'))materialHintNode.textContent+=' Stretchability also limits yaw head turns in either direction.';

// Weight falloff is a deformation-weight gradient, NOT a change to the spline's
// curvature. 0% means every body pixel receives the same spline weight; 100%
// means A starts at zero spline weight and ramps linearly to full weight at B.
const shoulderInterRotationLabelNode=shoulderInterRotation?.closest?.('label'); // Used only as the insertion anchor in the real authoring DOM.
if(shoulderInterRotationLabelNode?.insertAdjacentHTML){
  shoulderInterRotationLabelNode.insertAdjacentHTML('afterend','<label>Spline weight falloff A→B <span id="shoulderWeightFalloffLabel">0%</span><input id="shoulderWeightFalloff" type="range" min="0" max="100" step="1" value="0"></label>');
}
const shoulderWeightFalloff=$('shoulderWeightFalloff'); // Saved 0..100 spline-weight gradient.
const shoulderWeightFalloffLabel=$('shoulderWeightFalloffLabel'); // Mirrors the saved falloff percentage for touch/mouse authoring.
function shoulderWeightFalloffValue(){return clamp(numberOr(shoulderWeightFalloff?.value,0)/100,0,1)}
function splineWeightForT(t){
  const clampedT=clamp(numberOr(t,0),0,1),falloff=shoulderWeightFalloffValue();
  return clamp(1-falloff*(1-clampedT),0,1); // 100%: 0 at A, 1 at B; lower settings retain more influence near A.
}
function guideTForNormalizedPoint(u,v){
  const a=shoulderGuide.a,b=shoulderGuide.b,dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1;
  return((u-a.x)*(dx/len)+(v-a.y)*(dy/len))/len;
}

const shoulderLabelsBeforeWeightFalloff=updateShoulderLabels;
updateShoulderLabels=function updateShoulderLabelsWithWeightFalloff(){
  shoulderLabelsBeforeWeightFalloff();
  if(shoulderWeightFalloffLabel)shoulderWeightFalloffLabel.textContent=`${Math.round(shoulderWeightFalloffValue()*100)}%`;
};

const applyShoulderRestBeforeWeightFalloff=applyShoulderRestConfig;
applyShoulderRestConfig=function applyShoulderRestConfigWithWeightFalloff(raw){
  applyShoulderRestBeforeWeightFalloff(raw);
  const saved=raw?.weightFalloff??raw?.curveFalloff??0; // Migrate the short-lived, incorrectly named curveFalloff field into the intended weight meaning.
  if(shoulderWeightFalloff)shoulderWeightFalloff.value=String(Math.round(clamp(numberOr(saved,0),0,1)*100));
  updateShoulderLabels();clearShoulderSplitLayerCache();
};

const captureHistoryBeforeWeightFalloff=captureHistoryState;
captureHistoryState=function captureHistoryStateWithWeightFalloff(){
  return{...captureHistoryBeforeWeightFalloff(),shoulderWeightFalloff:shoulderWeightFalloffValue()};
};
const historySignatureBeforeWeightFalloff=historySignature;
historySignature=function historySignatureWithWeightFalloff(snapshot){
  return`${historySignatureBeforeWeightFalloff(snapshot)}|wf${numberOr(snapshot?.shoulderWeightFalloff,0).toFixed(4)}`;
};
const restoreHistoryBeforeWeightFalloff=restoreHistoryState;
restoreHistoryState=function restoreHistoryStateWithWeightFalloff(snapshot){
  if(snapshot&&Number.isFinite(Number(snapshot.shoulderWeightFalloff))&&shoulderWeightFalloff)shoulderWeightFalloff.value=String(Math.round(clamp(Number(snapshot.shoulderWeightFalloff),0,1)*100));
  const result=restoreHistoryBeforeWeightFalloff(snapshot);updateShoulderLabels();clearShoulderSplitLayerCache();return result;
};

const normalizedRigBeforeWeightFalloff=normalizedRig;
normalizedRig=function normalizedRigWithWeightFalloff(){
  const rig=normalizedRigBeforeWeightFalloff();
  if(rig?.shoulderRest){
    rig.shoulderRest.weightFalloff=shoulderWeightFalloffValue(); // Persists into Copy Rig, downloads, and Save Rig for Game Preview.
    delete rig.shoulderRest.curveFalloff; // The corrected schema does not keep the misleading curvature-distribution field.
  }
  return rig;
};

// Preserve the original constant-curvature spline and apply falloff only to the
// amount a point follows it. shoulderRestSourcePoint from part6 then multiplies
// this by (1 - Head Influence), so the two weights compose exactly once each.
const normalizedSplinePointBeforeWeightFalloff=normalizedSplinePoint;
normalizedSplinePoint=function normalizedSplinePointWithWeightFalloff(u,v){
  const full=normalizedSplinePointBeforeWeightFalloff(u,v),t=guideTForNormalizedPoint(u,v);
  if(t<0||t>1)return{x:u,y:v};
  const weight=splineWeightForT(t);
  return{x:u+(full.x-u)*weight,y:v+(full.y-v)*weight};
};

checkpointOnPointer(shoulderWeightFalloff);
shoulderWeightFalloff?.addEventListener('input',()=>{updateShoulderLabels();clearShoulderSplitLayerCache();draw()});

// Split-frame preview uses two independent source layers. The deformed run1
// right side is drawn FIRST; the idle left side is drawn SECOND with no shoulder
// spline, giving gripping forequarters explicit visual priority wherever the
// hanging rear half curls back underneath them.
let shoulderSplitLayerCache=null; // {idle,run,seam,width,height,left,right}; invalidated by source/seam changes.
function clearShoulderSplitLayerCache(){shoulderSplitLayerCache=null}
function splitLayerCanvases(){
  if(!state.image||!shoulderRun1Image)return null;
  const s=sourceSize(),w=Math.max(1,s.width),h=Math.max(1,s.height),seam=Math.round(w*shoulderFrameShiftValue());
  const cached=shoulderSplitLayerCache;
  if(cached&&cached.idle===state.image&&cached.run===shoulderRun1Image&&cached.seam===seam&&cached.width===w&&cached.height===h)return cached;
  const left=document.createElement('canvas'),right=document.createElement('canvas');left.width=right.width=w;left.height=right.height=h;
  const lctx=left.getContext('2d'),rctx=right.getContext('2d');lctx.clearRect(0,0,w,h);rctx.clearRect(0,0,w,h);
  if(seam>0)lctx.drawImage(state.image,0,0,seam,h,0,0,seam,h); // Transparent to the right of the authored seam.
  if(seam<w)rctx.drawImage(shoulderRun1Image,seam,0,w-seam,h,seam,0,w-seam,h); // Transparent to the left of the seam.
  return shoulderSplitLayerCache={idle:state.image,run:shoulderRun1Image,seam,width:w,height:h,left,right};
}

const refreshShoulderPresentationBeforeLayering=refreshShoulderPresentation;
refreshShoulderPresentation=function refreshShoulderPresentationWithLayerCache(){clearShoulderSplitLayerCache();return refreshShoulderPresentationBeforeLayering()};

const drawDeformedPreviewBeforeLayering=drawDeformedPreview;
drawDeformedPreview=function drawDeformedPreviewWithExplicitSplitLayering(){
  if(!shoulderRestSplitFrame?.checked||!shoulderRun1Image)return drawDeformedPreviewBeforeLayering();
  const fit=fitRectFor(previewCanvas);if(!fit||!state.image)return;
  const layers=splitLayerCanvases();if(!layers)return drawDeformedPreviewBeforeLayering();
  previewCtx.clearRect(0,0,previewCanvas.width,previewCanvas.height);

  const s=sourceSize(),angleDeg=clamp(numberOr($('previewAngle').value,0),Math.min(numberOr($('minDeg').value,-30),numberOr($('maxDeg').value,30)),Math.max(numberOr($('minDeg').value,-30),numberOr($('maxDeg').value,30))),angle=angleDeg*Math.PI/180;
  const maxDetail=clamp(Math.round(numberOr($('meshResolution').value,48)),12,72),aspect=s.width/Math.max(1,s.height),cols=aspect>=1?maxDetail:Math.max(8,Math.round(maxDetail*aspect)),rows=aspect>=1?Math.max(8,Math.round(maxDetail/aspect)):maxDetail,cw=s.width/cols,ch=s.height/rows;
  const canHeadDeform=!!(state.weights&&state.pivot),p=state.pivot;
  const makeVertices=useShoulderSpline=>{
    const vertices=new Array((cols+1)*(rows+1));
    for(let y=0;y<=rows;y++)for(let x=0;x<=cols;x++){
      const u=x/cols,v=y/rows,sx=u*s.width,sy=v*s.height,base=state.weights?sampleGridWeight(u,v):0;
      const rested=useShoulderSpline&&shoulderRestUseSpline?.checked?shoulderRestSourcePoint(sx,sy,base):{x:sx,y:sy};
      vertices[y*(cols+1)+x]=canHeadDeform?deformedPoint(rested.x,rested.y,previewHeadWeight(u,v,angleDeg),angle,p):rested;
    }
    return vertices;
  };
  const rightVertices=makeVertices(true),leftVertices=makeVertices(false);
  const drawLayer=(image,vertices)=>{
    for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
      const s00={x:x*cw,y:y*ch},s10={x:(x+1)*cw,y:y*ch},s01={x:x*cw,y:(y+1)*ch},s11={x:(x+1)*cw,y:(y+1)*ch};
      const d00=vertices[y*(cols+1)+x],d10=vertices[y*(cols+1)+x+1],d01=vertices[(y+1)*(cols+1)+x],d11=vertices[(y+1)*(cols+1)+x+1];
      drawTexturedTriangleWithImage(previewCtx,image,s00,s10,s01,d00,d10,d01,.8/Math.max(.001,fit.scale));
      drawTexturedTriangleWithImage(previewCtx,image,s10,s11,s01,d10,d11,d01,.8/Math.max(.001,fit.scale));
    }
  };
  previewCtx.save();previewCtx.translate(fit.x,fit.y);previewCtx.scale(fit.scale,fit.scale);
  drawLayer(layers.right,rightVertices); // Rear/run1 layer first.
  drawLayer(layers.left,leftVertices); // Forequarters/idle layer explicitly on top.
  previewCtx.restore();
};

const updateStatusBeforeWeightFalloff=updateStatus;
updateStatus=function updateStatusWithWeightFalloff(){
  updateStatusBeforeWeightFalloff();
  if(shoulderPresentationEnabled())$('status').textContent+=` | weight falloff ${Math.round(shoulderWeightFalloffValue()*100)}%${shoulderRestSplitFrame.checked?' | idle-left over run1-right':''}`;
};

// The sticky workbench can be much wider than the vertical space available to
// each preview. Do not stretch the canvas itself to that wide/shallow grid cell:
// keep the canvas at the sprite's real aspect and let the checkerboard host take
// the spare space. This preserves the entire PNG in both views while the settings
// panel below is the part that compresses/scrolls on short screens.
function fitCanvasInsideHost(canvas){
  const host=canvas?.parentElement?.getBoundingClientRect?.(); // Available grid-cell rectangle used to contain the full sprite.
  if(!host?.width||!host?.height)return;
  const source=sourceSize();
  const aspect=source.width>0&&source.height>0?source.width/source.height:host.width/Math.max(1,host.height); // Loaded sprite aspect is authoritative once known.
  let cssWidth=host.width,cssHeight=cssWidth/Math.max(.0001,aspect);
  if(cssHeight>host.height){cssHeight=host.height;cssWidth=cssHeight*aspect}
  cssWidth=Math.max(1,cssWidth);cssHeight=Math.max(1,cssHeight);
  canvas.style.width=`${cssWidth}px`;
  canvas.style.height=`${cssHeight}px`;
  const dpr=Math.max(1,window.devicePixelRatio||1); // Backing resolution follows the contained CSS rectangle rather than the whole shallow host.
  const pixelWidth=Math.max(1,Math.round(cssWidth*dpr)),pixelHeight=Math.max(1,Math.round(cssHeight*dpr));
  if(canvas.width!==pixelWidth)canvas.width=pixelWidth;
  if(canvas.height!==pixelHeight)canvas.height=pixelHeight;
}

resizeCanvases=function resizeContainedRigCanvases(){
  fitCanvasInsideHost(paintCanvas);
  fitCanvasInsideHost(previewCanvas);
  draw();
};

// part5 already registered observers using the older resize function. Register a
// later observer as the final layout pass so any viewport/grid change is followed
// by the aspect-correct contained sizing above.
const containedCanvasObserver=new ResizeObserver(()=>resizeCanvases()); // Keeps both views fully visible when the sticky workbench changes size.
containedCanvasObserver.observe(paintCanvas.parentElement);
containedCanvasObserver.observe(previewCanvas.parentElement);
window.addEventListener('resize',resizeCanvases);
updateShoulderLabels();
resizeCanvases();
