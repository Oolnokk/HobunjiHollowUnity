'use strict';

// Broad shoulder posing sits above the precise seven-point AFTER line.
// These controls intentionally reuse the retired full/inter-vertex/falloff
// curve math, but only as an additive editor macro: exported/runtime data still
// receives ordinary explicit AFTER points and never depends on legacy fields.
const shoulderBroadUi=document.createElement('div');
shoulderBroadUi.id='shoulderBroadPoseTools';
shoulderBroadUi.style.cssText='border:1px solid #353a44;border-radius:8px;padding:7px;display:flex;flex-direction:column;gap:5px;background:#101216';
shoulderBroadUi.innerHTML=`
  <div class="row" style="justify-content:space-between"><strong>Broad AFTER pose</strong><span class="badge">additive</span></div>
  <label>Whole rotation <span id="shoulderBroadFullRotationLabel">0°</span><input id="shoulderBroadFullRotation" type="range" min="-90" max="90" step="1" value="0"></label>
  <label>Progressive / inter-vertex bend <span id="shoulderBroadInterRotationLabel">0°</span><input id="shoulderBroadInterRotation" type="range" min="-180" max="180" step="1" value="0"></label>
  <label>Root falloff <span id="shoulderBroadFalloffLabel">0%</span><input id="shoulderBroadFalloff" type="range" min="0" max="100" step="1" value="0"></label>
  <div class="row"><button id="resetShoulderBroadPose">Reset broad tools</button><button id="bakeShoulderBroadPose" class="primary">Bake into AFTER</button></div>
  <div class="hint">Use these for the large pose first. They add to—not replace—the precise AFTER nodes. Bake keeps the visible pose but turns the broad result into ordinary AFTER points for delicate node editing.</div>`;
shoulderEditAfter?.parentElement?.insertAdjacentElement('afterend',shoulderBroadUi);

const shoulderBroadFullRotation=$('shoulderBroadFullRotation');
const shoulderBroadInterRotation=$('shoulderBroadInterRotation');
const shoulderBroadFalloff=$('shoulderBroadFalloff');
const shoulderBroadFullRotationLabel=$('shoulderBroadFullRotationLabel');
const shoulderBroadInterRotationLabel=$('shoulderBroadInterRotationLabel');
const shoulderBroadFalloffLabel=$('shoulderBroadFalloffLabel');
const resetShoulderBroadPose=$('resetShoulderBroadPose');
const bakeShoulderBroadPose=$('bakeShoulderBroadPose');
const SHOULDER_BROAD_DEG=Math.PI/180;
let shoulderBroadLatestPointer=null; // Unclamped source-space pointer lets visible off-image AFTER nodes remain editable.

function shoulderBroadFullDeg(){return clamp(numberOr(shoulderBroadFullRotation?.value,0),-90,90)}
function shoulderBroadInterDeg(){return clamp(numberOr(shoulderBroadInterRotation?.value,0),-180,180)}
function shoulderBroadFalloffValue(){return clamp(numberOr(shoulderBroadFalloff?.value,0)/100,0,1)}
function shoulderBroadActive(){return Math.abs(shoulderBroadFullDeg())>.0001||Math.abs(shoulderBroadInterDeg())>.0001}
function updateShoulderBroadLabels(){
  if(shoulderBroadFullRotationLabel)shoulderBroadFullRotationLabel.textContent=`${Math.round(shoulderBroadFullDeg())}°`;
  if(shoulderBroadInterRotationLabel)shoulderBroadInterRotationLabel.textContent=`${Math.round(shoulderBroadInterDeg())}°`;
  if(shoulderBroadFalloffLabel)shoulderBroadFalloffLabel.textContent=`${Math.round(shoulderBroadFalloffValue()*100)}%`;
}
function resetShoulderBroadControls(redraw=true){
  shoulderBroadFullRotation.value='0';shoulderBroadInterRotation.value='0';shoulderBroadFalloff.value='0';updateShoulderBroadLabels();if(redraw)draw();
}

function shoulderBroadGuide(){
  const a=cloneShoulderPoint(shoulderBeforePoints?.[0],{x:.52,y:.56}),b=cloneShoulderPoint(shoulderBeforePoints?.[SHOULDER_POINT_COUNT-1],{x:1,y:.57});
  return{a,b};
}
function shoulderBroadLinearPoint(t){const g=shoulderBroadGuide(),q=clamp(numberOr(t,0),0,1);return{x:g.a.x+(g.b.x-g.a.x)*q,y:g.a.y+(g.b.y-g.a.y)*q}}

// Same constant-curvature construction used by the retired fullRotationDeg /
// interVertexRotationDeg shoulder tool and by runtime's legacy migration.
function shoulderBroadLegacyCurvePoint(t){
  const g=shoulderBroadGuide(),a=g.a,b=g.b,dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);if(length<1e-7)return{x:a.x,y:a.y};
  const tx=dx/length,ty=dy/length,nx=-ty,ny=tx,q=clamp(numberOr(t,0),0,1),s=q*length,full=shoulderBroadFullDeg()*SHOULDER_BROAD_DEG,inter=shoulderBroadInterDeg()*SHOULDER_BROAD_DEG;
  let centerAlong,centerNormal;if(Math.abs(inter)<1e-7){centerAlong=s*Math.cos(full);centerNormal=s*Math.sin(full)}else{const curvature=inter/length,angle=full+inter*q;centerAlong=(Math.sin(angle)-Math.sin(full))/curvature;centerNormal=(-Math.cos(angle)+Math.cos(full))/curvature}
  return{x:a.x+tx*centerAlong+nx*centerNormal,y:a.y+ty*centerAlong+ny*centerNormal};
}
function shoulderBroadDeltaAt(index){
  const t=clamp(numberOr(index,0)/(SHOULDER_POINT_COUNT-1),0,1),linear=shoulderBroadLinearPoint(t),curved=shoulderBroadLegacyCurvePoint(t),legacyWeight=1-shoulderBroadFalloffValue()*(1-t);
  return{x:(curved.x-linear.x)*legacyWeight,y:(curved.y-linear.y)*legacyWeight};
}
function effectiveShoulderAfterPoints(){
  return Array.from({length:SHOULDER_POINT_COUNT},(_,index)=>{const base=cloneShoulderPoint(shoulderAfterPoints?.[index],shoulderBeforePoints?.[index]),delta=shoulderBroadDeltaAt(index);return{x:base.x+delta.x,y:base.y+delta.y}});
}

function bakeShoulderBroadPoseIntoAfter(){
  checkpointHistory();shoulderAfterPoints=effectiveShoulderAfterPoints();resetShoulderBroadControls(false);shoulderEditMode='after';updateShoulderUi();setStatus('Baked broad pose into the precise AFTER line. Broad tools returned to neutral.',true);draw();
}

// Saving/previewing always receives the effective explicit points. Broad tool
// values themselves are editor-only and therefore cannot create runtime drift.
const currentShoulderRestBeforeBroadPose=currentShoulderRest;
currentShoulderRest=function currentShoulderRestWithBroadPose(){const rest=currentShoulderRestBeforeBroadPose();rest.afterPoints=effectiveShoulderAfterPoints();return rest};

// Loading a saved rig starts broad tools neutral because its exact final pose is
// already represented by afterPoints.
const applyShoulderRestConfigBeforeBroadPose=applyShoulderRestConfig;
applyShoulderRestConfig=function applyShoulderRestConfigWithNeutralBroadPose(raw){resetShoulderBroadControls(false);return applyShoulderRestConfigBeforeBroadPose(raw)};

// Draw the effective AFTER curve while keeping the underlying precise point
// array untouched. Every earlier guide/separator layer therefore sees the same
// broad result that preview/export sees.
const drawGuidesBeforeBroadPose=drawGuides;
drawGuides=function drawGuidesWithBroadPose(fit){
  if(!shoulderBroadActive())return drawGuidesBeforeBroadPose(fit);const precise=shoulderAfterPoints;shoulderAfterPoints=effectiveShoulderAfterPoints();try{return drawGuidesBeforeBroadPose(fit)}finally{shoulderAfterPoints=precise}
};

function shoulderBroadPointerToSource(event){
  const fit=fitRectFor(paintCanvas),bounds=paintCanvas.getBoundingClientRect(),s=sourceSize();if(!fit||!bounds.width||!bounds.height||!s.width||!s.height)return null;
  const cx=(event.clientX-bounds.left)*paintCanvas.width/bounds.width,cy=(event.clientY-bounds.top)*paintCanvas.height/bounds.height;return{x:(cx-fit.x)/fit.scale,y:(cy-fit.y)/fit.scale};
}
function rememberShoulderBroadPointer(event){if(event.target===paintCanvas)shoulderBroadLatestPointer=shoulderBroadPointerToSource(event)}
window.addEventListener('pointerdown',rememberShoulderBroadPointer,true);window.addEventListener('pointermove',rememberShoulderBroadPointer,true);

// Precise dragging remains available while a broad macro is live: the pointer
// moves the visible effective node, and we subtract the macro delta before
// storing its underlying precise coordinate. This is the core additive rule.
shoulderPointAtPointer=function shoulderPointAtPointerWithBroadPose(fallbackPoint){
  if(!shoulderRestUseSpline.checked)return-1;const s=sourceSize(),point=shoulderBroadLatestPointer||fallbackPoint;if(!point||!s.width||!s.height)return-1;const radius=Math.max(18,s.height*.035),points=shoulderEditMode==='after'?effectiveShoulderAfterPoints():shoulderBeforePoints;let best=-1,bestDistance=Infinity;
  points.forEach((p,index)=>{const d=Math.hypot(point.x-p.x*s.width,point.y-p.y*s.height);if(d<=radius&&d<bestDistance){best=index;bestDistance=d}});return best;
};
updateShoulderPoint=function updateShoulderPointWithBroadPose(event){
  if(shoulderPointDrag<0)return;const point=shoulderBroadPointerToSource(event),s=sourceSize();if(!point||!s.width||!s.height)return;const target={x:point.x/s.width,y:point.y/s.height};if(shoulderEditMode==='after'){const delta=shoulderBroadDeltaAt(shoulderPointDrag);shoulderAfterPoints[shoulderPointDrag]={x:target.x-delta.x,y:target.y-delta.y}}else shoulderBeforePoints[shoulderPointDrag]=target;requestDraw();
};

// Keep the whole BEFORE/AFTER rig in view, including nodes authored outside the
// source PNG. Image/source coordinates remain unchanged; only camera framing is
// widened. This is shared by paint and live-preview canvases.
const fitRectForBeforeShoulderBroadPose=fitRectFor;
fitRectFor=function fitRectForWholeShoulderPose(canvas){
  const s=sourceSize();if(!shoulderRestUseSpline?.checked||!s.width||!s.height||!canvas?.width||!canvas?.height)return fitRectForBeforeShoulderBroadPose(canvas);
  const all=[...shoulderBeforePoints,...effectiveShoulderAfterPoints()];let minX=0,minY=0,maxX=s.width,maxY=s.height;for(const p of all){minX=Math.min(minX,p.x*s.width);maxX=Math.max(maxX,p.x*s.width);minY=Math.min(minY,p.y*s.height);maxY=Math.max(maxY,p.y*s.height)}
  const extentW=Math.max(1,maxX-minX),extentH=Math.max(1,maxY-minY),pad=Math.max(s.width,s.height)*.06;minX-=pad;maxX+=pad;minY-=pad;maxY+=pad;const paddedW=maxX-minX,paddedH=maxY-minY,scale=Math.min(canvas.width/paddedW,canvas.height/paddedH);return{x:(canvas.width-paddedW*scale)/2-minX*scale,y:(canvas.height-paddedH*scale)/2-minY*scale,width:s.width*scale,height:s.height*scale,scale};
};

// Broad values participate in the same undo/redo stack as precise point edits.
const captureHistoryStateBeforeBroadPose=captureHistoryState;
captureHistoryState=function captureHistoryStateWithBroadPose(){return{...captureHistoryStateBeforeBroadPose(),shoulderBroadFullDeg:shoulderBroadFullDeg(),shoulderBroadInterDeg:shoulderBroadInterDeg(),shoulderBroadFalloff:shoulderBroadFalloffValue()}};
const historySignatureBeforeBroadPose=historySignature;
historySignature=function historySignatureWithBroadPose(snapshot){return`${historySignatureBeforeBroadPose(snapshot)}|broad${numberOr(snapshot?.shoulderBroadFullDeg,0).toFixed(2)},${numberOr(snapshot?.shoulderBroadInterDeg,0).toFixed(2)},${numberOr(snapshot?.shoulderBroadFalloff,0).toFixed(3)}`};
const restoreHistoryStateBeforeBroadPose=restoreHistoryState;
restoreHistoryState=function restoreHistoryStateWithBroadPose(snapshot){if(snapshot){shoulderBroadFullRotation.value=String(numberOr(snapshot.shoulderBroadFullDeg,0));shoulderBroadInterRotation.value=String(numberOr(snapshot.shoulderBroadInterDeg,0));shoulderBroadFalloff.value=String(Math.round(clamp(numberOr(snapshot.shoulderBroadFalloff,0),0,1)*100));updateShoulderBroadLabels()}return restoreHistoryStateBeforeBroadPose(snapshot)};

for(const control of [shoulderBroadFullRotation,shoulderBroadInterRotation,shoulderBroadFalloff]){control?.addEventListener('pointerdown',()=>checkpointHistory());control?.addEventListener('input',()=>{updateShoulderBroadLabels();draw()})}
resetShoulderBroadPose?.addEventListener('click',()=>{checkpointHistory();resetShoulderBroadControls(false);setStatus('Reset broad pose tools; precise AFTER edits were left untouched.',true);draw()});
bakeShoulderBroadPose?.addEventListener('click',bakeShoulderBroadPoseIntoAfter);
resetShoulderAfter?.addEventListener('click',()=>resetShoulderBroadControls(true));
resetShoulderSpline?.addEventListener('click',()=>resetShoulderBroadControls(true));

window.ShoulderBroadPoseTools={
  version:1,
  effectiveAfterPoints:effectiveShoulderAfterPoints,
  deltaAt:shoulderBroadDeltaAt,
  bake:bakeShoulderBroadPoseIntoAfter,
  reset:()=>resetShoulderBroadControls(true),
};
updateShoulderBroadLabels();resizeCanvases();
