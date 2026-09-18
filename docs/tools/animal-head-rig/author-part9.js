'use strict';

// Two-point coarse editing is deliberately only a view/input mode over the
// ordinary seven-point AFTER curve. It does not create a second deformation
// layer and it never moves vertices 2-6 implicitly.
const shoulderTwoPointUi=document.createElement('div');
shoulderTwoPointUi.id='shoulderTwoPointPoseTools';
shoulderTwoPointUi.style.cssText='border-top:1px solid #353a44;padding-top:6px;display:flex;flex-direction:column;gap:5px';
shoulderTwoPointUi.innerHTML=`
  <div class="row"><button id="editShoulderTwoPoint" class="primary">Edit 2-point endpoints</button></div>
  <div class="row"><button id="snapShoulderStartToShift">Snap point 1 → shift center</button><button id="snapShoulderEndToRightEdge">Snap point 2 → right-edge center</button></div>
  <div class="hint">Two handles only: <b>Point 1</b> directly edits the beginning AFTER vertex and <b>Point 2</b> directly edits the ending AFTER vertex. Vertices 2–6 are left exactly where they are. The broad rotation/bend controls remain additive above these precise points.</div>`;
shoulderBroadUi?.appendChild(shoulderTwoPointUi);

const editShoulderTwoPoint=$('editShoulderTwoPoint');
const snapShoulderStartToShift=$('snapShoulderStartToShift');
const snapShoulderEndToRightEdge=$('snapShoulderEndToRightEdge');
let shoulderTwoPointEditMode=false;
let shoulderTwoPointDrag=-1; // 0 for Start, 6 for End.

function visibleShoulderAfterPoint(index){
  const points=effectiveShoulderAfterPoints();
  return cloneShoulderPoint(points?.[index],shoulderAfterPoints?.[index]);
}

// The broad macro is editor-only displacement. Subtract it so a requested
// visible endpoint lands exactly on the user's target without baking/changing
// any of the five interior precise vertices.
function setVisibleShoulderAfterEndpoint(index,target){
  if(index!==0&&index!==SHOULDER_POINT_COUNT-1)return false;
  const delta=shoulderBroadDeltaAt(index);
  shoulderAfterPoints[index]={x:numberOr(target?.x,0)-delta.x,y:numberOr(target?.y,0)-delta.y};
  return true;
}

function updateShoulderTwoPointButton(){
  editShoulderTwoPoint?.classList.toggle('active',shoulderTwoPointEditMode);
  if(editShoulderTwoPoint)editShoulderTwoPoint.textContent=shoulderTwoPointEditMode?'Finish 2-point endpoints':'Edit 2-point endpoints';
}
function setShoulderTwoPointEditMode(enabled){
  const next=!!enabled;
  if(next&&!splineAllowedForCurrentSpecies()){
    shoulderTwoPointEditMode=false;
    shoulderTwoPointDrag=-1;
    updateShoulderTwoPointButton();
    setStatus('Two-point shoulder editing is available only for species with the shoulder spline enabled.',false);
    draw();
    return false;
  }
  shoulderTwoPointEditMode=next;
  shoulderTwoPointDrag=-1;
  if(shoulderTwoPointEditMode){
    if(!shoulderRestUseSpline.checked)shoulderRestUseSpline.checked=true;
    shoulderEditMode='after';
    updateShoulderUi();
  }
  updateShoulderTwoPointButton();
  draw();
  return shoulderTwoPointEditMode;
}

// While two-point mode owns the canvas, the ordinary seven-node hit tester
// stands down. No hidden endpoint state exists: all edits go straight into the
// same shoulderAfterPoints array used by normal precise authoring.
const shoulderPointAtPointerBeforeTwoPoint=shoulderPointAtPointer;
shoulderPointAtPointer=function shoulderPointAtPointerWithTwoPointMode(point){
  if(shoulderTwoPointEditMode)return-1;
  return shoulderPointAtPointerBeforeTwoPoint(point);
};

function twoPointHandleAtPointer(point){
  if(!shoulderTwoPointEditMode||!point||!shoulderRestUseSpline.checked)return-1;
  const s=sourceSize(),radius=Math.max(22,s.height*.045),start=visibleShoulderAfterPoint(0),end=visibleShoulderAfterPoint(SHOULDER_POINT_COUNT-1);
  const startDistance=Math.hypot(point.x-start.x*s.width,point.y-start.y*s.height);
  const endDistance=Math.hypot(point.x-end.x*s.width,point.y-end.y*s.height);
  if(startDistance>radius&&endDistance>radius)return-1;
  return startDistance<=endDistance?0:SHOULDER_POINT_COUNT-1;
}
function updateTwoPointEndpointFromEvent(event){
  if(shoulderTwoPointDrag<0)return;
  const point=shoulderBroadPointerToSource(event),s=sourceSize();
  if(!point||!s.width||!s.height)return;
  setVisibleShoulderAfterEndpoint(shoulderTwoPointDrag,{x:point.x/s.width,y:point.y/s.height});
  requestDraw();
}
paintCanvas.addEventListener('pointerdown',event=>{
  if(!shoulderTwoPointEditMode)return;
  const handle=twoPointHandleAtPointer(shoulderBroadPointerToSource(event));
  if(handle<0)return;
  checkpointHistory();
  shoulderTwoPointDrag=handle;
  paintCanvas.setPointerCapture?.(event.pointerId);
  event.preventDefault();
  event.stopImmediatePropagation();
  updateTwoPointEndpointFromEvent(event);
},true);
paintCanvas.addEventListener('pointermove',event=>{
  if(shoulderTwoPointDrag<0)return;
  event.preventDefault();
  event.stopImmediatePropagation();
  updateTwoPointEndpointFromEvent(event);
},true);
const stopTwoPointDrag=event=>{
  if(shoulderTwoPointDrag<0)return;
  shoulderTwoPointDrag=-1;
  paintCanvas.releasePointerCapture?.(event.pointerId);
  event.preventDefault();
  event.stopImmediatePropagation();
  draw();
};
paintCanvas.addEventListener('pointerup',stopTwoPointDrag,true);
paintCanvas.addEventListener('pointercancel',stopTwoPointDrag,true);

// Hide the five intermediate handles in this mode, but continue drawing the
// complete BEFORE and effective AFTER curves plus the rotated frame separator.
const drawGuidesBeforeTwoPoint=drawGuides;
drawGuides=function drawGuidesWithTwoPointEndpointMode(fit){
  if(!shoulderTwoPointEditMode)return drawGuidesBeforeTwoPoint(fit);
  const splineWasEnabled=shoulderRestUseSpline.checked;
  shoulderRestUseSpline.checked=false;
  try{drawGuidesBeforeTwoPoint(fit)}finally{shoulderRestUseSpline.checked=splineWasEnabled}
  if(!splineWasEnabled||!state.image)return;

  const points=effectiveShoulderAfterPoints(),s=sourceSize(),radius=Math.max(7,10/Math.max(.001,fit.scale));
  drawSplineLine(shoulderBeforePoints,fit,'rgba(115,215,255,.42)',1.5,[8,5]);
  drawSplineLine(points,fit,'rgba(181,140,255,1)',3,[]);
  paintCtx.save();
  paintCtx.translate(fit.x,fit.y);
  paintCtx.scale(fit.scale,fit.scale);
  const drawHandle=(point,label)=>{
    const x=point.x*s.width,y=point.y*s.height;
    paintCtx.fillStyle='rgba(240,200,120,.98)';
    paintCtx.beginPath();
    paintCtx.arc(x,y,radius,0,Math.PI*2);
    paintCtx.fill();
    paintCtx.fillStyle='#111';
    paintCtx.font=`${Math.max(8,radius*.95)}px system-ui`;
    paintCtx.textAlign='center';
    paintCtx.textBaseline='middle';
    paintCtx.fillText(label,x,y);
  };
  drawHandle(points[0],'1');
  drawHandle(points[SHOULDER_POINT_COUNT-1],'2');
  paintCtx.restore();
};

function prepareTwoPointSnap(){
  if(!splineAllowedForCurrentSpecies()){
    setStatus('Endpoint snaps are available only for species with the shoulder spline enabled.',false);
    return false;
  }
  checkpointHistory();
  if(!shoulderRestUseSpline.checked)shoulderRestUseSpline.checked=true;
  shoulderEditMode='after';
  shoulderTwoPointEditMode=true;
  updateShoulderUi();
  updateShoulderTwoPointButton();
  return true;
}
snapShoulderStartToShift?.addEventListener('click',()=>{
  if(!prepareTwoPointSnap())return;
  setVisibleShoulderAfterEndpoint(0,{x:shoulderFrameShiftValue(),y:.5});
  setStatus(`Snapped point 1 / beginning AFTER vertex to frame-shift center (${Math.round(shoulderFrameShiftValue()*100)}%, 50%).`,true);
  draw();
});
snapShoulderEndToRightEdge?.addEventListener('click',()=>{
  if(!prepareTwoPointSnap())return;
  setVisibleShoulderAfterEndpoint(SHOULDER_POINT_COUNT-1,{x:1,y:.5});
  setStatus("Snapped point 2 / ending AFTER vertex to the center of the right-frame PNG's right edge (100%, 50%).",true);
  draw();
});

editShoulderTwoPoint?.addEventListener('click',()=>setShoulderTwoPointEditMode(!shoulderTwoPointEditMode));
shoulderEditBefore?.addEventListener('click',()=>{
  if(!shoulderTwoPointEditMode)return;
  shoulderTwoPointEditMode=false;
  shoulderTwoPointDrag=-1;
  updateShoulderTwoPointButton();
  draw();
});
shoulderRestUseSpline?.addEventListener('change',()=>{
  if(shoulderRestUseSpline.checked||!shoulderTwoPointEditMode)return;
  shoulderTwoPointEditMode=false;
  shoulderTwoPointDrag=-1;
  updateShoulderTwoPointButton();
});

// Loading a different rig should not leave an interaction mode visually active.
const applyShoulderRestConfigBeforeTwoPoint=applyShoulderRestConfig;
applyShoulderRestConfig=function applyShoulderRestConfigAndExitTwoPoint(raw){
  shoulderTwoPointEditMode=false;
  shoulderTwoPointDrag=-1;
  updateShoulderTwoPointButton();
  return applyShoulderRestConfigBeforeTwoPoint(raw);
};

window.ShoulderTwoPointPoseTools={
  version:2,
  enabled:()=>shoulderTwoPointEditMode,
  setVisibleEndpoint:setVisibleShoulderAfterEndpoint,
  visibleStart:()=>visibleShoulderAfterPoint(0),
  visibleEnd:()=>visibleShoulderAfterPoint(SHOULDER_POINT_COUNT-1),
};
updateShoulderTwoPointButton();
