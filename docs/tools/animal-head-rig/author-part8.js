'use strict';

// Shoulder-profile finishing controls: idle-right split layers, seam-following
// spline placement, and the temporary five-species curl allowlist.
const shoulderProfileApi=window.HobunjiShoulderSplineProfiles; // Runtime-owned species/default source keeps authoring and gameplay aligned.
const shoulderCurlSpecies=new Set(shoulderProfileApi?.species||['grehlr','voorg-ass','uumkaoii','gar-wolf','dabinggi-hound']); // Only these species may author spline curl for now.
const grehlrShoulderDefaults=shoulderProfileApi?.defaultShoulderRest?.()||{
  enabled:true,useSpline:true,useRun1:false,splitFrame:true,frameShiftX:.52,
  guide:{a:{x:.5423902927484727,y:.5694472546137244},b:{x:.9999996666666666,y:.572691993389205}},
  fullRotationDeg:78,interVertexRotationDeg:1,weightFalloff:.44,
  splitRightUsesIdle:true,followFrameShiftX:true,guideFrameShiftX:.52,
};

const splitToggleLabel=shoulderRestSplitFrame?.closest?.('label'); // Anchor for the two new shoulder checkboxes.
if(splitToggleLabel){
  for(const node of Array.from(splitToggleLabel.childNodes)){
    if(node!==shoulderRestSplitFrame)node.remove();
  }
  splitToggleLabel.append(document.createTextNode(' Enable pixel split / overlap layers'));
}

splitToggleLabel?.insertAdjacentHTML('afterend',
  '<label class="row" style="justify-content:flex-start"><input id="shoulderSplitRightIdle" type="checkbox" checked> Use idle on right side instead of run1</label>'+ 
  '<label class="row" style="justify-content:flex-start"><input id="shoulderFollowFrameShiftX" type="checkbox" checked> Move spline with Frame shift X</label>'
);
const shoulderSplitRightIdle=$('shoulderSplitRightIdle'); // Chooses idle-vs-run1 source for the deformed/background side while retaining the seam.
const shoulderFollowFrameShiftX=$('shoulderFollowFrameShiftX'); // When on, seam X changes translate both A/B guide endpoints by the same X delta.
let lastShoulderFrameShift=shoulderFrameShiftValue(); // Previous seam position used to translate the guide without changing its shape.

// Let A/B remain shift-relative even when B moves slightly beyond the normalized image edge.
// Y stays normalized because seam following is X-only.
cloneShoulderGuide=function cloneShoulderGuideWithUnclampedX(guide=shoulderGuide){
  return{
    a:{x:numberOr(guide?.a?.x,.14),y:clamp01(guide?.a?.y)},
    b:{x:numberOr(guide?.b?.x,.86),y:clamp01(guide?.b?.y)},
  };
};

function currentShoulderSpecies(){return String($('animalId')?.value||state.baseRecord?.id||'').trim().toLowerCase()}
function splineAllowedForCurrentSpecies(){return shoulderCurlSpecies.has(currentShoulderSpecies())}
function cloneGrehlrShoulderDefaults(){
  const copy=JSON.parse(JSON.stringify(grehlrShoulderDefaults));
  copy.splitRightUsesIdle=true; // Temporary species defaults explicitly use idle art on both split sides.
  copy.followFrameShiftX=true;
  copy.guideFrameShiftX=numberOr(copy.frameShiftX,.52);
  return copy;
}
function updateSplineSpeciesAvailability(){
  const allowed=splineAllowedForCurrentSpecies();
  shoulderRestUseSpline.disabled=!allowed;
  if(!allowed)shoulderRestUseSpline.checked=false;
  const label=shoulderRestUseSpline.closest?.('label');
  if(label)label.title=allowed?'':'Spline curl is temporarily enabled only for Grehlr, Voorg-Ass, Uumkao’ii, Gar-wolf, and Dabinggi-hound.';
}
function shouldNeedRun1Preview(){
  return !!shoulderRestUseRun1?.checked||!!(shoulderRestSplitFrame?.checked&&!shoulderSplitRightIdle?.checked);
}

// Split layering can intentionally use idle for BOTH halves. The seam still
// separates the deformed/background pixels from the undeformed foreground pixels.
const ensureRun1BeforeIdleRight=ensureRun1Image;
ensureRun1Image=function ensureShoulderRightSource(){
  if(shoulderRestSplitFrame?.checked&&shoulderSplitRightIdle?.checked&&state.image){
    shoulderRun1Image=state.image;
    shoulderRun1Path='__shoulder_idle_right__';
    shoulderCompositeCanvas=null;
    return Promise.resolve(state.image);
  }
  return ensureRun1BeforeIdleRight();
};

const refreshBeforeIdleRight=refreshShoulderPresentation;
refreshShoulderPresentation=function refreshShoulderPresentationWithIdleRight(){
  if(shoulderRestSplitFrame?.checked&&shoulderSplitRightIdle?.checked&&state.image){
    shoulderRun1Image=state.image;
    shoulderRun1Path='__shoulder_idle_right__';
  }else if(!shouldNeedRun1Preview()&&shoulderRun1Path==='__shoulder_idle_right__'){
    clearShoulderFrameCache();
  }
  const result=refreshBeforeIdleRight();
  updateSplineSpeciesAvailability();
  return result;
};

function applyPart8ShoulderFields(raw){
  const fallback=cloneGrehlrShoulderDefaults();
  const useRaw=raw||fallback;
  shoulderSplitRightIdle.checked=useRaw.splitRightUsesIdle!==undefined?!!useRaw.splitRightUsesIdle:true;
  shoulderFollowFrameShiftX.checked=useRaw.followFrameShiftX!==undefined?!!useRaw.followFrameShiftX:true;
  const authoredReference=numberOr(useRaw.guideFrameShiftX,useRaw.frameShiftX??shoulderFrameShiftValue());
  const currentShift=shoulderFrameShiftValue();
  if(shoulderFollowFrameShiftX.checked&&Number.isFinite(authoredReference)){
    const delta=currentShift-authoredReference;
    if(Math.abs(delta)>1e-9){
      shoulderGuide.a.x+=delta;
      shoulderGuide.b.x+=delta;
    }
  }
  lastShoulderFrameShift=currentShift;
  if(shoulderRestSplitFrame.checked&&shoulderSplitRightIdle.checked&&state.image){
    shoulderRun1Image=state.image;
    shoulderRun1Path='__shoulder_idle_right__';
  }
  updateSplineSpeciesAvailability();
  clearShoulderSplitLayerCache();
}

const applyShoulderBeforePart8=applyShoulderRestConfig;
applyShoulderRestConfig=function applyShoulderRestConfigWithIdleRightAndFollow(raw){
  applyShoulderBeforePart8(raw);
  applyPart8ShoulderFields(raw);
  refreshShoulderPresentation();
};

const applyRecordBeforePart8=applyRecord;
applyRecord=function applyRecordWithShoulderSpeciesDefaults(record,index=-1){
  const result=applyRecordBeforePart8(record,index);
  const id=String(record?.id||$('animalId')?.value||'').toLowerCase();
  if(id==='grehlr'&&window.HobunjiGrehlrHeadRigCorrection?.authored){
    applyRigToPaint(window.HobunjiGrehlrHeadRigCorrection.authored); // The uploaded Grehlr rig is authoritative over older bestiary snapshots.
  }else if(shoulderCurlSpecies.has(id)&&!record?.headRig?.shoulderRest){
    applyShoulderRestConfig(cloneGrehlrShoulderDefaults()); // Gar/Dabinggi/Voorg/Uum temporarily inherit only Grehlr's shoulder settings.
  }
  updateSplineSpeciesAvailability();
  return result;
};

// Preserve the two new settings in undo/redo alongside the existing shoulder state.
const captureBeforePart8=captureHistoryState;
captureHistoryState=function captureHistoryStateWithShoulderSourceRules(){
  return{
    ...captureBeforePart8(),
    shoulderSplitRightIdle:!!shoulderSplitRightIdle?.checked,
    shoulderFollowFrameShiftX:!!shoulderFollowFrameShiftX?.checked,
  };
};
const signatureBeforePart8=historySignature;
historySignature=function historySignatureWithShoulderSourceRules(snapshot){
  return`${signatureBeforePart8(snapshot)}|srci${snapshot?.shoulderSplitRightIdle?1:0}|sfx${snapshot?.shoulderFollowFrameShiftX?1:0}`;
};
const restoreBeforePart8=restoreHistoryState;
restoreHistoryState=function restoreHistoryStateWithShoulderSourceRules(snapshot){
  if(snapshot&&typeof snapshot.shoulderSplitRightIdle==='boolean')shoulderSplitRightIdle.checked=snapshot.shoulderSplitRightIdle;
  if(snapshot&&typeof snapshot.shoulderFollowFrameShiftX==='boolean')shoulderFollowFrameShiftX.checked=snapshot.shoulderFollowFrameShiftX;
  const result=restoreBeforePart8(snapshot);
  lastShoulderFrameShift=shoulderFrameShiftValue();
  refreshShoulderPresentation();
  return result;
};

function supportOnlyRig(){
  return{
    enabled:true,
    coordinateSpace:'sprite-normalized-top-left',
    pivot:{x:.5,y:.5},
    weightMap:{width:2,height:2,encoding:'rle-u9',unsetValue:256,data:[4,0]},
    minDeg:-30,maxDeg:30,restDeg:0,turnSpeedDeg:120,meshResolution:48,
  };
}
function writePart8ShoulderFields(rig){
  if(!rig)return rig;
  if(!shoulderPresentationEnabled())return rig;
  const rest=rig.shoulderRest||(rig.shoulderRest={enabled:true});
  rest.enabled=true;
  rest.useSpline=!!shoulderRestUseSpline.checked&&splineAllowedForCurrentSpecies();
  rest.useRun1=!!shoulderRestUseRun1.checked;
  rest.splitFrame=!!shoulderRestSplitFrame.checked;
  rest.frameShiftX=shoulderFrameShiftValue();
  rest.guide=cloneShoulderGuide();
  rest.fullRotationDeg=shoulderFullRotationValue();
  rest.interVertexRotationDeg=shoulderInterRotationValue();
  rest.weightFalloff=shoulderWeightFalloffValue();
  rest.splitRightUsesIdle=!!shoulderSplitRightIdle.checked;
  rest.followFrameShiftX=!!shoulderFollowFrameShiftX.checked;
  rest.guideFrameShiftX=shoulderFrameShiftValue(); // Stored guide is already translated to this seam position.
  delete rest.curveFalloff;
  return rig;
}

const normalizedRigBeforePart8=normalizedRig;
normalizedRig=function normalizedRigWithShoulderSourceRules(){
  let rig=normalizedRigBeforePart8();
  const id=currentShoulderSpecies();
  if(!rig&&shoulderCurlSpecies.has(id)&&shoulderPresentationEnabled()&&state.image){
    rig=supportOnlyRig(); // Uumkao'ii/Voorg-Ass can save a shoulder spline before they have an authored head-turn paint.
  }
  return writePart8ShoulderFields(rig);
};

// Seam-following is an authoring transform: move stored A/B by the exact same X
// delta, preserving Grehlr's authored offsets from the 52% seam.
shoulderFrameShift?.addEventListener('input',()=>{
  const next=shoulderFrameShiftValue();
  if(shoulderFollowFrameShiftX?.checked){
    const delta=next-lastShoulderFrameShift;
    shoulderGuide.a.x+=delta;
    shoulderGuide.b.x+=delta;
  }
  lastShoulderFrameShift=next;
  clearShoulderSplitLayerCache();
  draw();
});
shoulderFollowFrameShiftX?.addEventListener('change',()=>{
  checkpointHistory();
  lastShoulderFrameShift=shoulderFrameShiftValue();
  draw();
});
shoulderSplitRightIdle?.addEventListener('change',()=>{
  checkpointHistory();
  clearShoulderFrameCache();
  clearShoulderSplitLayerCache();
  if(shouldNeedRun1Preview())ensureRun1Image();
  refreshShoulderPresentation();
});
checkpointOnPointer(shoulderSplitRightIdle);
checkpointOnPointer(shoulderFollowFrameShiftX);

// A newly created eligible species starts from Grehlr's current shoulder pose.
// Non-eligible species keep the frame controls but cannot turn the spline on.
const idInput=$('animalId');
idInput?.addEventListener('change',()=>{
  updateSplineSpeciesAvailability();
  const id=currentShoulderSpecies();
  if(shoulderCurlSpecies.has(id)&&!state.baseRecord?.headRig?.shoulderRest&&!shoulderPresentationEnabled()){
    applyShoulderRestConfig(cloneGrehlrShoulderDefaults());
  }
});

const updateStatusBeforePart8=updateStatus;
updateStatus=function updateStatusWithShoulderSourceRules(){
  updateStatusBeforePart8();
  if(!shoulderPresentationEnabled())return;
  const source=shoulderRestSplitFrame.checked?(shoulderSplitRightIdle.checked?'idle-left over idle-right':'idle-left over run1-right'):(shoulderRestUseRun1.checked?'full run1':'idle');
  $('status').textContent+=` | split source ${source} | spline follows seam ${shoulderFollowFrameShiftX.checked?'YES':'no'}`;
};

// Uumkao'ii is a real livestock species but is absent from the older static bestiary.
// Surface it in the rigger using its registered genetics-renderer idle sprite.
const runtimeRiggerSupplementsBeforeUum=runtimeRiggerSupplements;
runtimeRiggerSupplements=function runtimeRiggerSupplementsWithUum(repoRecords){
  const supplements=runtimeRiggerSupplementsBeforeUum(repoRecords);
  const known=new Set([...repoRecords,...supplements].map(record=>record?.id).filter(Boolean));
  if(known.has('uumkaoii'))return supplements;
  const species=window.CreatureGeneticsRender?.SPECIES?.uumkaoii;
  const idle=species?.base?.idle;
  if(!idle)return supplements;
  const baseline=repoRecords.find(record=>record?.id==='uumkaoii-wild')||{};
  const run=[species?.base?.run1,species?.base?.run2].filter(path=>path&&path!==idle);
  supplements.push({
    id:'uumkaoii',label:"Uumkao'ii",
    modelWidth:Math.max(.01,numberOr(baseline.modelWidth,1.275)),
    spriteAspect:Math.max(.01,numberOr(baseline.spriteAspect,451/641)),
    tint:/^#[0-9a-f]{6}$/i.test(baseline.tint||'')?baseline.tint:'#ffffff',
    diet:baseline.diet||'prey',hostile:false,
    sprites:{idle,...(run.length?{run}:{})},
  });
  return supplements;
};

applyPart8ShoulderFields(state.baseRecord?.headRig?.shoulderRest||null);
updateSplineSpeciesAvailability();
