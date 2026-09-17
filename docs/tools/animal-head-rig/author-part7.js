'use strict';

// author-part6 has to install before this so its shoulder presentation helpers
// exist. This tiny final wrapper refreshes run1/split art only AFTER applyRecord
// has committed the newly selected record to state.baseRecord; otherwise a fast
// animal switch can briefly request the previous species' run1 frame.
const shoulderAwareApplyRecord=applyRecord; // Current applyRecord already restores the saved shoulder configuration.
applyRecord=function applyRecordThenRefreshShoulderFrame(record,index=-1){
  const result=shoulderAwareApplyRecord(record,index);
  clearShoulderFrameCache();
  refreshShoulderPresentation();
  return result;
};

const materialHintNode=$('materialHint'); // Existing material-paint help; extended here because yaw response is implemented after the base author module.
if(materialHintNode&&!materialHintNode.textContent.includes('yaw head turns'))materialHintNode.textContent+=' Stretchability also limits yaw head turns in either direction.';

// Add one compact saved curve-distribution control without making the already
// dense right-panel HTML harder to maintain. Higher falloff delays the curl
// toward guide B, letting pelvis/back-leg slices stay straighter than the tail.
const shoulderInterRotationLabelNode=shoulderInterRotation?.closest?.('label'); // Used only as the insertion anchor in the real authoring DOM.
if(shoulderInterRotationLabelNode?.insertAdjacentHTML){
  shoulderInterRotationLabelNode.insertAdjacentHTML('afterend','<label>Curve falloff toward B <span id="shoulderCurveFalloffLabel">0%</span><input id="shoulderCurveFalloff" type="range" min="0" max="100" step="1" value="0"></label>');
}
const shoulderCurveFalloff=$('shoulderCurveFalloff'); // Saved 0..100 authoring slider; 0 preserves the original even-curvature spline.
const shoulderCurveFalloffLabel=$('shoulderCurveFalloffLabel'); // Mirrors the saved falloff percentage for touch/mouse authoring.
function shoulderCurveFalloffValue(){return clamp(numberOr(shoulderCurveFalloff?.value,0)/100,0,1)}

const shoulderLabelsBeforeFalloff=updateShoulderLabels;
updateShoulderLabels=function updateShoulderLabelsWithCurveFalloff(){
  shoulderLabelsBeforeFalloff();
  if(shoulderCurveFalloffLabel)shoulderCurveFalloffLabel.textContent=`${Math.round(shoulderCurveFalloffValue()*100)}%`;
};

const applyShoulderRestBeforeFalloff=applyShoulderRestConfig;
applyShoulderRestConfig=function applyShoulderRestConfigWithCurveFalloff(raw){
  applyShoulderRestBeforeFalloff(raw);
  if(shoulderCurveFalloff)shoulderCurveFalloff.value=String(Math.round(clamp(numberOr(raw?.curveFalloff,0),0,1)*100));
  updateShoulderLabels();
};

const captureHistoryBeforeFalloff=captureHistoryState;
captureHistoryState=function captureHistoryStateWithCurveFalloff(){
  return{...captureHistoryBeforeFalloff(),shoulderCurveFalloff:shoulderCurveFalloffValue()};
};
const historySignatureBeforeFalloff=historySignature;
historySignature=function historySignatureWithCurveFalloff(snapshot){
  return`${historySignatureBeforeFalloff(snapshot)}|cf${numberOr(snapshot?.shoulderCurveFalloff,0).toFixed(4)}`;
};
const restoreHistoryBeforeFalloff=restoreHistoryState;
restoreHistoryState=function restoreHistoryStateWithCurveFalloff(snapshot){
  if(snapshot&&Number.isFinite(Number(snapshot.shoulderCurveFalloff))&&shoulderCurveFalloff)shoulderCurveFalloff.value=String(Math.round(clamp(Number(snapshot.shoulderCurveFalloff),0,1)*100));
  const result=restoreHistoryBeforeFalloff(snapshot);updateShoulderLabels();return result;
};

const normalizedRigBeforeFalloff=normalizedRig;
normalizedRig=function normalizedRigWithCurveFalloff(){
  const rig=normalizedRigBeforeFalloff();
  if(rig?.shoulderRest)rig.shoulderRest.curveFalloff=shoulderCurveFalloffValue();
  return rig;
};

const normalizedSplinePointBeforeFalloff=normalizedSplinePoint;
normalizedSplinePoint=function normalizedSplinePointWithCurveFalloff(u,v){
  const api=window.AnimalShoulderRest;
  if(api?.deformNormalizedPoint){
    return api.deformNormalizedPoint({x:u,y:v},{
      enabled:true,useSpline:true,guide:cloneShoulderGuide(),
      fullRotationDeg:shoulderFullRotationValue(),
      interVertexRotationDeg:shoulderInterRotationValue(),
      curveFalloff:shoulderCurveFalloffValue(),
    });
  }
  return normalizedSplinePointBeforeFalloff(u,v);
};

checkpointOnPointer(shoulderCurveFalloff);
shoulderCurveFalloff?.addEventListener('input',()=>{updateShoulderLabels();draw()});

const updateStatusBeforeFalloff=updateStatus;
updateStatus=function updateStatusWithCurveFalloff(){
  updateStatusBeforeFalloff();
  if(shoulderPresentationEnabled())$('status').textContent+=` | falloff ${Math.round(shoulderCurveFalloffValue()*100)}%`;
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
