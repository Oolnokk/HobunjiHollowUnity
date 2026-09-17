'use strict';

// Two-point coarse posing is intentionally simpler than the seven-point AFTER
// editor. Start and End are direct visible endpoint targets; their displacement
// is blended linearly across the five interior points. The precise AFTER curve
// remains underneath, so this layer can coexist with hand-authored detail.
const shoulderTwoPointUi=document.createElement('div');
shoulderTwoPointUi.id='shoulderTwoPointPoseTools';
shoulderTwoPointUi.style.cssText='border-top:1px solid #353a44;padding-top:6px;display:flex;flex-direction:column;gap:5px';
shoulderTwoPointUi.innerHTML=`
  <div class="row"><button id="editShoulderTwoPoint" class="primary">Edit 2-point endpoints</button><button id="resetShoulderTwoPoint">Reset 2-point</button></div>
  <div class="hint">Two handles only: <b>Start</b> directly sets AFTER vertex 1 and <b>End</b> directly sets AFTER vertex 7. Their offsets are blended across vertices 2–6. Turn this editor off to return to all seven precise nodes; Bake into AFTER commits the visible result.</div>`;
shoulderBroadUi?.appendChild(shoulderTwoPointUi);

const editShoulderTwoPoint=$('editShoulderTwoPoint');
const resetShoulderTwoPoint=$('resetShoulderTwoPoint');
let shoulderTwoPointEditMode=false; // Interaction mode only; turning it off does not discard the coarse pose.
let shoulderTwoPointStart=null; // Absolute normalized visible target for final AFTER vertex 1.
let shoulderTwoPointEnd=null; // Absolute normalized visible target for final AFTER vertex 7.
let shoulderTwoPointDrag=''; // 'start' or 'end' while one coarse handle owns the pointer.

const effectiveShoulderAfterPointsBeforeTwoPoint=effectiveShoulderAfterPoints;
function cloneTwoPointTarget(point){return point?{x:numberOr(point.x,0),y:numberOr(point.y,0)}:null}
function shoulderTwoPointActive(){return!!(shoulderTwoPointStart&&shoulderTwoPointEnd)}
function baseAfterBeforeTwoPoint(){return effectiveShoulderAfterPointsBeforeTwoPoint()}
function ensureShoulderTwoPointTargets(){
  if(shoulderTwoPointActive())return;
  const base=baseAfterBeforeTwoPoint();
  shoulderTwoPointStart=cloneTwoPointTarget(base[0]);
  shoulderTwoPointEnd=cloneTwoPointTarget(base[SHOULDER_POINT_COUNT-1]);
}
function clearShoulderTwoPoint(redraw=true){
  shoulderTwoPointStart=null;shoulderTwoPointEnd=null;shoulderTwoPointDrag='';
  if(redraw)draw();
}
function shoulderTwoPointDeltaFor(index,basePoints=baseAfterBeforeTwoPoint()){
  if(!shoulderTwoPointActive())return{x:0,y:0};
  const last=SHOULDER_POINT_COUNT-1,t=clamp(numberOr(index,0)/last,0,1),startBase=basePoints[0],endBase=basePoints[last],startDelta={x:shoulderTwoPointStart.x-startBase.x,y:shoulderTwoPointStart.y-startBase.y},endDelta={x:shoulderTwoPointEnd.x-endBase.x,y:shoulderTwoPointEnd.y-endBase.y};
  return{x:startDelta.x+(endDelta.x-startDelta.x)*t,y:startDelta.y+(endDelta.y-startDelta.y)*t};
}

effectiveShoulderAfterPoints=function effectiveShoulderAfterPointsWithTwoPointTargets(){
  const base=baseAfterBeforeTwoPoint();
  if(!shoulderTwoPointActive())return base;
  return base.map((point,index)=>{const delta=shoulderTwoPointDeltaFor(index,base);return{x:point.x+delta.x,y:point.y+delta.y}});
};

function updateShoulderTwoPointButton(){
  editShoulderTwoPoint?.classList.toggle('active',shoulderTwoPointEditMode);
  if(editShoulderTwoPoint)editShoulderTwoPoint.textContent=shoulderTwoPointEditMode?'Finish 2-point endpoints':'Edit 2-point endpoints';
}
function setShoulderTwoPointEditMode(enabled){
  shoulderTwoPointEditMode=!!enabled;
  if(shoulderTwoPointEditMode){ensureShoulderTwoPointTargets();shoulderEditMode='after';updateShoulderUi()}
  updateShoulderTwoPointButton();draw();
}

// While this mode is active the ordinary seven-node pointer handler stands
// down completely, so the canvas genuinely presents only two editable points.
const shoulderPointAtPointerBeforeTwoPoint=shoulderPointAtPointer;
shoulderPointAtPointer=function shoulderPointAtPointerWithTwoPointMode(point){
  if(shoulderTwoPointEditMode)return-1;
  return shoulderPointAtPointerBeforeTwoPoint(point);
};

function twoPointHandleAtPointer(point){
  if(!shoulderTwoPointEditMode||!point||!shoulderRestUseSpline.checked)return'';
  ensureShoulderTwoPointTargets();
  const s=sourceSize(),radius=Math.max(22,s.height*.045),start=shoulderTwoPointStart,end=shoulderTwoPointEnd,ds=Math.hypot(point.x-start.x*s.width,point.y-start.y*s.height),de=Math.hypot(point.x-end.x*s.width,point.y-end.y*s.height);
  if(ds>radius&&de>radius)return'';
  return ds<=de?'start':'end';
}
function updateTwoPointTargetFromEvent(event){
  if(!shoulderTwoPointDrag)return;
  const point=shoulderBroadPointerToSource(event),s=sourceSize();if(!point||!s.width||!s.height)return;
  const target={x:point.x/s.width,y:point.y/s.height};
  if(shoulderTwoPointDrag==='start')shoulderTwoPointStart=target;else shoulderTwoPointEnd=target;
  requestDraw();
}
paintCanvas.addEventListener('pointerdown',event=>{
  if(!shoulderTwoPointEditMode)return;
  const point=shoulderBroadPointerToSource(event),handle=twoPointHandleAtPointer(point);if(!handle)return;
  checkpointHistory();shoulderTwoPointDrag=handle;paintCanvas.setPointerCapture?.(event.pointerId);event.preventDefault();event.stopImmediatePropagation();updateTwoPointTargetFromEvent(event);
},true);
paintCanvas.addEventListener('pointermove',event=>{if(!shoulderTwoPointDrag)return;event.preventDefault();event.stopImmediatePropagation();updateTwoPointTargetFromEvent(event)},true);
const stopTwoPointDrag=event=>{if(!shoulderTwoPointDrag)return;shoulderTwoPointDrag='';paintCanvas.releasePointerCapture?.(event.pointerId);event.preventDefault();event.stopImmediatePropagation();draw()};
paintCanvas.addEventListener('pointerup',stopTwoPointDrag,true);paintCanvas.addEventListener('pointercancel',stopTwoPointDrag,true);

// In two-point mode hide the five intermediate editing handles entirely. We
// still draw both complete curves so the user sees the resulting body shape.
const drawGuidesBeforeTwoPoint=drawGuides;
drawGuides=function drawGuidesWithTwoPointEndpointMode(fit){
  if(!shoulderTwoPointEditMode)return drawGuidesBeforeTwoPoint(fit);
  const splineWasEnabled=shoulderRestUseSpline.checked;shoulderRestUseSpline.checked=false;
  try{drawGuidesBeforeTwoPoint(fit)}finally{shoulderRestUseSpline.checked=splineWasEnabled}
  if(!splineWasEnabled||!state.image)return;
  const points=effectiveShoulderAfterPoints(),s=sourceSize(),radius=Math.max(7,10/Math.max(.001,fit.scale));
  drawSplineLine(shoulderBeforePoints,fit,'rgba(115,215,255,.42)',1.5,[8,5]);
  drawSplineLine(points,fit,'rgba(181,140,255,1)',3,[]);
  paintCtx.save();paintCtx.translate(fit.x,fit.y);paintCtx.scale(fit.scale,fit.scale);
  const handle=(p,label)=>{const x=p.x*s.width,y=p.y*s.height;paintCtx.fillStyle='rgba(240,200,120,.98)';paintCtx.beginPath();paintCtx.arc(x,y,radius,0,Math.PI*2);paintCtx.fill();paintCtx.fillStyle='#111';paintCtx.font=`${Math.max(8,radius*.95)}px system-ui`;paintCtx.textAlign='center';paintCtx.textBaseline='middle';paintCtx.fillText(label,x,y)};
  handle(points[0],'S');handle(points[SHOULDER_POINT_COUNT-1],'E');paintCtx.restore();
};

// Precise interior-node dragging remains additive even while an endpoint pose
// is retained. Endpoint targets are direct by definition, so endpoint movement
// should be done with the two-point handles until that layer is baked/reset.
const updateShoulderPointBeforeTwoPoint=updateShoulderPoint;
updateShoulderPoint=function updateShoulderPointWithTwoPointCompensation(event){
  if(shoulderTwoPointEditMode||shoulderPointDrag<0)return;
  if(shoulderEditMode!=='after'||!shoulderTwoPointActive())return updateShoulderPointBeforeTwoPoint(event);
  const point=shoulderBroadPointerToSource(event),s=sourceSize();if(!point||!s.width||!s.height)return;
  const index=shoulderPointDrag,last=SHOULDER_POINT_COUNT-1;
  if(index===0||index===last){
    const target={x:point.x/s.width,y:point.y/s.height};if(index===0)shoulderTwoPointStart=target;else shoulderTwoPointEnd=target;requestDraw();return;
  }
  const final=effectiveShoulderAfterPoints(),precise=shoulderAfterPoints[index],totalDelta={x:final[index].x-precise.x,y:final[index].y-precise.y};
  shoulderAfterPoints[index]={x:point.x/s.width-totalDelta.x,y:point.y/s.height-totalDelta.y};requestDraw();
};

// Endpoint targets are editor-only. Save/export already routes through the
// effective explicit AFTER points inherited from part8.
const applyShoulderRestConfigBeforeTwoPoint=applyShoulderRestConfig;
applyShoulderRestConfig=function applyShoulderRestConfigWithoutStaleTwoPoint(raw){clearShoulderTwoPoint(false);shoulderTwoPointEditMode=false;updateShoulderTwoPointButton();return applyShoulderRestConfigBeforeTwoPoint(raw)};

const captureHistoryStateBeforeTwoPoint=captureHistoryState;
captureHistoryState=function captureHistoryStateWithTwoPointPose(){return{...captureHistoryStateBeforeTwoPoint(),shoulderTwoPointStart:cloneTwoPointTarget(shoulderTwoPointStart),shoulderTwoPointEnd:cloneTwoPointTarget(shoulderTwoPointEnd)}};
const historySignatureBeforeTwoPoint=historySignature;
historySignature=function historySignatureWithTwoPointPose(snapshot){const s=snapshot?.shoulderTwoPointStart,e=snapshot?.shoulderTwoPointEnd;return`${historySignatureBeforeTwoPoint(snapshot)}|two${s?`${numberOr(s.x,0).toFixed(4)},${numberOr(s.y,0).toFixed(4)}`:'none'}>${e?`${numberOr(e.x,0).toFixed(4)},${numberOr(e.y,0).toFixed(4)}`:'none'}`};
const restoreHistoryStateBeforeTwoPoint=restoreHistoryState;
restoreHistoryState=function restoreHistoryStateWithTwoPointPose(snapshot){shoulderTwoPointStart=cloneTwoPointTarget(snapshot?.shoulderTwoPointStart);shoulderTwoPointEnd=cloneTwoPointTarget(snapshot?.shoulderTwoPointEnd);return restoreHistoryStateBeforeTwoPoint(snapshot)};

editShoulderTwoPoint?.addEventListener('click',()=>setShoulderTwoPointEditMode(!shoulderTwoPointEditMode));
resetShoulderTwoPoint?.addEventListener('click',()=>{checkpointHistory();clearShoulderTwoPoint(false);setStatus('Reset the two-point endpoint pose; precise AFTER points and the rotation/bend macro were left untouched.',true);draw()});

// These listeners run after part8's handlers. Bake therefore sees the complete
// two-point result first, then we neutralize the editor-only endpoint targets.
bakeShoulderBroadPose?.addEventListener('click',()=>{clearShoulderTwoPoint(false);shoulderTwoPointEditMode=false;updateShoulderTwoPointButton();draw()});
resetShoulderBroadPose?.addEventListener('click',()=>{clearShoulderTwoPoint(false);draw()});
resetShoulderAfter?.addEventListener('click',()=>{clearShoulderTwoPoint(false);draw()});
resetShoulderSpline?.addEventListener('click',()=>{clearShoulderTwoPoint(false);draw()});

window.ShoulderTwoPointPoseTools={
  version:1,
  enabled:()=>shoulderTwoPointEditMode,
  active:shoulderTwoPointActive,
  effectiveAfterPoints,
  reset:()=>clearShoulderTwoPoint(true),
};
updateShoulderTwoPointButton();
