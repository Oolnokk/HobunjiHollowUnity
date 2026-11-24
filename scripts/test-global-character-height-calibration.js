'use strict';
// Global stature calibration is a single outer parent scale, separate from the 26 Mao'ao-male-relative author profiles.
const assert = require('node:assert/strict'); // Checks reference measurements and idempotent game/editor scaling.
const fs = require('node:fs'); // Loads actual runtime/default modules and chairSimple geometry.
const vm = require('node:vm'); // Executes shared browser code without Three.js or devtools.

const defaultsSource = fs.readFileSync('docs/config/character-rig-scale-defaults.js', 'utf8'); // Mao'ao male-anchored scale map plus shared chair-based world calibration.
const scaleSource = fs.readFileSync('docs/js/character-rig-scale.js', 'utf8'); // Shared runtime applied to actual avatar parent.
const chair = JSON.parse(fs.readFileSync('docs/config/furniture-authored/chairSimple.json', 'utf8')); // Same chair used by six-foot reference line.
const height = Math.max(...chair.parts.map(part => Number(part.transform?.y) + Number(part.transform?.sy)/2));
const close=(actual,expected,label)=>assert(Math.abs(actual-expected)<1e-10,label+': '+actual+' !== '+expected); // Tolerates only harmless FP rounding.

const win = {
  SCRATCHBONES_CONFIG: { game: { assets: { pngPlaneAvatar: { worldModelWidth: 0.9, portraitScaleBySpecies: { 'mao-ao': 1 } } } } },
  HOBUNJI_ATTACHMENT_RIG_PROFILES: { characters: {} }, // Shared library is kept free of baked/incrementally inflated scale values.
  HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS: {}, // Existing mobile diagnostics can still receive runtime registration.
  ProceduralHandAttachments: { attach(_three,parent) { return { parent }; } },
  location: { pathname: '/game/' },
  clearInterval() {},
  setInterval(callback) { callback(); return 1; },
};
win.window = win;
const context = vm.createContext(win);
vm.runInContext(defaultsSource,context,{filename:'character-rig-scale-defaults.js'});
vm.runInContext(scaleSource,context,{filename:'character-rig-scale.js'});
const calibration=win.HobunjiCharacterRigScaleDefaults.worldHeightCalibration;
const api=win.HobunjiCharacterRigScale;
assert(api,'shared character scale runtime installed');
assert(calibration,'canonical world reference is available without entering the Animation Author');
assert.equal(calibration.referenceSpecies,'mao-ao');
assert.equal(calibration.referenceGender,'male');
assert.equal(calibration.targetFeet,6.25);
assert.equal(calibration.chairHeightFeet,3);
close(height,calibration.chairBackWorldHeight,'uses the authored chair top, not a separate arbitrary ruler');
close(calibration.targetWorldHeight,1.375,'6 ft 3 in in game-world units');
close(calibration.referenceUnscaledWorldHeight,.9*1.29,'edited Mao-ao male adult pre-calibration stature');
const factor=calibration.targetWorldHeight/calibration.referenceUnscaledWorldHeight;
close(api.worldVisualScale(),factor,'same uniform factor is exposed by runtime and defaults');
assert(factor>1.18&&factor<1.19,'world calibration is recalibrated from Mao-ao male 1.29 Height, not compounded with the former main baseline');

function rigParent(withNeck=false){
  const neck=withNeck?{
    scale:{x:1,y:1,z:1,set(x,y,z){this.x=x;this.y=y;this.z=z;}},
    position:{x:0,y:.35,z:0},
    updateMatrix(){},
  }:null; // Real head-compensation bone in avatar's neck rig.
  return {isObject3D:true, scale:{x:1,y:1,z:1,set(x,y,z){this.x=x;this.y=y;this.z=z;}},
    userData: neck ? {neckRig:{available:true,neckJoint:neck},portraitModelHeight:.9} : {},
    children:[],updateMatrix(){},updateMatrixWorld(){},traverse(callback){callback(this);},
    neck,
  };
}
const male=win.HobunjiCharacterRigScaleDefaults.scaleFor('mao-ao','male');
close(male.y,1.29,'approved male Mao-ao Height is kept as the anchor');
close(male.x,.85,'approved male Mao-ao width is kept as the anchor');
close(male.head,.65,'male Mao-ao Head is 65% of original PNG');
const reference=rigParent(true);
assert(api.applyToParent(reference,'mao-ao','male'),'runtime applies parent scaling to normal adult');
close(reference.scale.y*.9,1.375,'adult Mao-ao male world portrait reaches nominal 6 ft 3 in');
close(reference.scale.x,male.x*factor,'Mao-ao width also grows by the SAME percentage');
close(reference.scale.z,male.x*factor,'depth grows uniformly with width');
close(reference.scale.x*reference.neck.scale.x,male.head*factor,'visible head X grows with the whole character');
close(reference.scale.y*reference.neck.scale.y,male.head*factor,'visible head Y grows with the whole character');
close(reference.userData.hobunjiCharacterRigScaleState.worldVisualScale,factor,'idempotent scaling remembers world factor separately from authored fields');

const defaults=win.HobunjiCharacterRigScaleDefaults.values;
assert.equal(Object.keys(defaults).length,26,'all 26 canonical and special scale profiles are available');
for(const [key,authored] of Object.entries(defaults)){
  const [species,gender]=key.split('::');
  const avatar=rigParent(true);
  assert(api.applyToParent(avatar,species,gender),key+' has a shared parent scale');
  close(avatar.scale.x,authored.x*factor,key+' X');
  close(avatar.scale.y,authored.y*factor,key+' Y');
  close(avatar.scale.x*avatar.neck.scale.x,authored.head*factor,key+' head X');
  close(avatar.scale.y*avatar.neck.scale.y,authored.head*factor,key+' head Y');
  close(avatar.scale.y/reference.scale.y,authored.y/male.y,key+' keeps its original relative height');
  close(avatar.scale.x/reference.scale.x,authored.x/male.x,key+' keeps its original relative width');
  const before={x:avatar.scale.x,y:avatar.scale.y,z:avatar.scale.z};
  for(let repeat=0;repeat<5;repeat++) api.applyToParent(avatar,species,gender);
  close(avatar.scale.x,before.x,key+' repeated scale X must not compound');
  close(avatar.scale.y,before.y,key+' repeated scale Y must not compound');
  close(avatar.scale.z,before.z,key+' repeated scale Z must not compound');
  api.clearFromParent(avatar);
  close(avatar.scale.x,1,key+' clear restores unscaled parent X');
  close(avatar.scale.y,1,key+' clear restores unscaled parent Y');
  close(avatar.scale.z,1,key+' clear restores unscaled parent Z');
}
const saved={x:1.2,y:.82,legLength:.75,head:.95,offsetY:-.02}; // Custom saved species and child-stage profiles must not be migrated or double-scaled.
const customized=rigParent(true);
api.applyToParent(customized,'mao-ao','male',saved);
close(customized.scale.x,saved.x*factor,'stored custom width still grows at the same rate');
close(customized.scale.y,saved.y*factor,'stored custom height still grows at the same rate');
close(customized.scale.y*customized.neck.scale.y,saved.head*factor,'saved head grows too');
const edited={...saved,x:1.4,y:1.2,legLength:1.2}; // Editing only the parent visual must not resample the IK ratio.
api.applyToParent(customized,'mao-ao','male',edited);
close(customized.scale.x,edited.x*factor,'changing an authored value does not compound the global multiplier');
close(customized.scale.y,edited.y*factor,'height edit remains stable');
api.applyToParent(customized,'mao-ao','male',{...edited,y:.25,legLength:.25});
close(customized.scale.y,.25*factor,'baby/toddler/child-sized rigs inherit the same global factor');
api.clearFromParent(customized);
close(customized.scale.y,1,'custom profile clear restores original scale');
assert.match(scaleSource,/worldVisualScale: worldMultiplier/,'runtime persists calibration only as reversible parent state');
assert.doesNotMatch(defaultsSource,/rigScaleX = [^\n]*WORLD_HEIGHT_CALIBRATION/,'global factor is NOT baked into exported authored profiles');
console.log('PASS 6ft3 calibration: chair parity, 26 profiles, corrected male/female ratios, head/body scaling, saved overrides, repeat/clear');
