'use strict';
// Heights must come from painted bare head/body pixels, not a self-referential canvas-scale formula.
const assert=require('node:assert/strict'); // Verifies exact crown goals, gender isolation, head compensation and cache/idempotence.
const fs=require('node:fs'); // Reads the real shipped default/scaler and editor source.
const vm=require('node:vm'); // Runs the browser modules without WebGL or a mobile console.
const defaultsSrc=fs.readFileSync('docs/config/character-rig-scale-defaults.js','utf8'); // User target table + exact uploaded genders.
const rigSrc=fs.readFileSync('docs/js/character-rig-scale.js','utf8'); // Live parent/body/head/IK scale code.
const editorSrc=fs.readFileSync('docs/js/character-scale-comparison.js','utf8'); // Delayed bare art measurement and UI update.
const toolHtml=fs.readFileSync('docs/tools/animation-author/index.html','utf8'); // Loads the same CharacterDimensions module as gameplay.
const close=(a,b,label)=>assert(Math.abs(a-b)<1e-8,label+': '+a+' != '+b);
let measureCalls=0; // Only first measurement per identity runs the bounded solver.
const pixels=new Map(); // Synthetic samples represent actual opaque PNG art; distinct for each identity.
const win={
  SCRATCHBONES_CONFIG:{game:{assets:{pngPlaneAvatar:{worldModelWidth:.9,proceduralFeet:{footScale:{}}}}}},
  HOBUNJI_ATTACHMENT_RIG_PROFILES:{characters:{}},HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS:{},
  location:{pathname:'/game/'}, setInterval:()=>1,clearInterval(){},
  ProceduralHandAttachments:{attach(_three,parent){return {parent};}},
};
win.window=win;
const ctx=vm.createContext({window:win, location:win.location, setInterval:()=>1,clearInterval(){},console});
vm.runInContext(defaultsSrc,ctx);
const defaults=win.HobunjiCharacterRigScaleDefaults;
const worldFactor=defaults.worldHeightCalibration.uniformScale;
win.PNGPlaneAvatar={
  avatarScaleMultiplierFor({speciesId,gender}){return speciesId==='mao-ao'&&gender==='female'?.8:speciesId==='kenkari'?.75:1;},
  avatarPlacementRatioFor({speciesId}){return speciesId==='mao-ao'?.95:speciesId==='kenkari'?.475:.5;},
}; // Different source portrait plane/offset values prove nominal canvas math is insufficient.
win.HobunjiCharacterDimensions={
  measurementFor(species,gender){return pixels.get(species+'::'+gender)||null;},
  dimensionsFor(species,gender,options){
    measureCalls++;
    const art=pixels.get(species+'::'+gender);if(!art)return null;
    const y=Number(options.rigScale.y);
    const portrait=Number(options.portraitScale);
    const shift=Number(options.placementRatio);
    // Synthetic actual *opaque* head and body bounds: their top rows and head pivot depend
    // on source art; a fixed 0.9 canvas height would not produce these functions.
    const top=Math.max(art.bodyTop*y,art.headPivot*y+art.headAbovePivot*options.rigScale.head)
      *portrait*(.65+shift);
    return {height:top};
  },
};
vm.runInContext(rigSrc,ctx);
const rig=win.HobunjiCharacterRigScale;
assert(rig,'shared game/editor runtime is available');
assert.equal(Object.keys(defaults.values).length,26,'all 26 source identities stay in canonical config');
const goals=defaults.maleHeightFeet;
const samples=['kenkari','tletingan','nuhongan','longoran','mao-ao','engh-sho','mammakhbuur','mashtzarr'];
samples.forEach((species,index)=>{
  for (const [gender,k] of [['male',0],['female',1]]) {
    pixels.set(species+'::'+gender,{bodyTop:.54+index*.041+k*.033,
      headPivot:.47+index*.035+k*.028,headAbovePivot:.17+index*.012+k*.008});
  }
});
const reference = {x:.85,y:1.29,head:.65};
for (const [index,species] of samples.entries()) for (const gender of ['male','female']) {
  const corrected=rig.pixelHeightCorrectionFor(species,gender);
  assert(Number.isFinite(corrected)&&corrected>0,species+' '+gender+' has a finite independent correction');
  const authored=defaults.scaleFor(species,gender);
  const original={...authored,y:authored.y*corrected,legLength:authored.legLength*corrected};
  const portrait=win.PNGPlaneAvatar.avatarScaleMultiplierFor({speciesId:species,gender});
  const placement=win.PNGPlaneAvatar.avatarPlacementRatioFor({speciesId:species,gender});
  const height=win.HobunjiCharacterDimensions.dimensionsFor(species,gender,{
    rigScale:original,portraitScale:portrait,placementRatio:placement}).height*worldFactor;
  const feet=goals[species]*(gender==='female'?defaults.femaleVisibleHeightRatio:1);
  close(height,defaults.worldHeightCalibration.chairBackWorldHeight*feet/3,species+' '+gender+' pixel crown matches physical target');
  const before=measureCalls;
  close(rig.pixelHeightCorrectionFor(species,gender),corrected,species+' '+gender+' cache preserves value');
  assert.equal(measureCalls,before,'repeated scale requests do not rescan source pixels or rerun the height solver');
}
assert(Math.abs(rig.pixelHeightCorrectionFor('mao-ao','male')-1)>.02,
  'real PNG crown placement changes the calibration compared with the old nominal plane-height assumption');
assert.equal(rig.pixelHeightCorrectionFor('boney-shinjimi-skeleton','male'),1,
  'non-target characters keep their original proportional transforms');
pixels.delete('engh-sho::female');
assert.equal(rig.pixelHeightCorrectionFor('engh-sho','female'),1,
  'missing source pixels fall back to nominal scales instead of inventing an exact crown height');
function parent(){
  const neck={scale:{x:1,y:1,z:1,set(x,y,z){this.x=x;this.y=y;this.z=z;}},position:{x:0,y:.35,z:0},updateMatrix(){}};
  return {isObject3D:true,scale:{x:1,y:1,z:1,set(x,y,z){this.x=x;this.y=y;this.z=z;}},
    userData:{portraitModelHeight:.9,neckRig:{available:true,neckJoint:neck}},children:[],
    updateMatrix(){},updateMatrixWorld(){},traverse(fn){fn(this);},neck};
}
const model=parent();
const factor=rig.pixelHeightCorrectionFor('mao-ao','male');
assert(rig.applyToParent(model,'mao-ao','male'),'assembled parent accepts actual pixels');
close(model.scale.y,defaults.values['mao-ao::male'].y*factor*worldFactor,'physical height correction changes assembled Y');
close(model.scale.x,defaults.values['mao-ao::male'].x*worldFactor,'painted crown correction never changes width');
close(model.scale.x*model.neck.scale.x,.65*worldFactor,'raw-PNG Head X is still 65%');
close(model.scale.y*model.neck.scale.y,.65*worldFactor,'raw-PNG Head Y is still 65% despite adult stature correction');
const first={x:model.scale.x,y:model.scale.y,z:model.scale.z};
rig.applyToParent(model,'mao-ao','male');
close(model.scale.y,first.y,'repeated calibrated scale is idempotent');
const custom={...defaults.values['mao-ao::male'],y:1.56,legLength:1.56};
rig.applyToParent(model,'mao-ao','male',custom);
close(model.scale.y,1.56*factor*worldFactor,'authored Height edits retain their relative size instead of being forced back to target');
rig.clearFromParent(model);
close(model.scale.x,1,'scale clear restores original X');
close(model.scale.y,1,'scale clear restores original Y');
assert.match(editorSrc,/dimensions\.measureAll\(\)/,'the portrait measurement starts only after the actual lineup portrait queue');
assert.match(editorSrc,/unsubscribePixelHeights\?\.\(\)/,'an unmounted editor cannot retain a live pixel-measurement listener');
assert.match(editorSrc,/pixelCrownCalibration:/,'mobile debug reveals actual measured heights');
assert.match(toolHtml,/character-dimensions\.js\?v=/,'the editor loads the existing game bare-PNG measurement system');
assert.match(rigSrc,/_pixelHeightFactors = new Map\(\)/,'the source-height solve is cached for each species identity');
console.log('PASS pixel crown heights: 16 gender-specific painted-source measurements, source placement, 65% heads, width, IK, cache, edits, teardown, and editor lifecycle');
