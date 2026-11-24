'use strict';
// In Full Character Scale, Head 100% means the base source-PNG head's relative PIXEL size.
// Portrait-plane species scale, body X/Y, global world calibration and stored runtime values must not change that.
const assert = require('node:assert/strict'); // Checks exact model math and the two real editor input adapters.
const fs = require('node:fs'); // Loads production runtime and UI modules rather than duplicating their logic.
const vm = require('node:vm'); // Tests browser IIFE code without requiring WebGL or mobile devtools.

const rigSource = fs.readFileSync('docs/js/character-rig-scale.js','utf8'); // Parent+neck compensated scale runtime.
const defaultsSource = fs.readFileSync('docs/config/character-rig-scale-defaults.js','utf8'); // All canonical adult species/gender pairs.
const comparison = fs.readFileSync('docs/js/character-scale-comparison.js','utf8'); // True built-model multiplier and initial selection.
const guard = fs.readFileSync('docs/js/character-scale-comparison-body-input-guard.js','utf8'); // Capture-phase editor input owner.
const presentation = fs.readFileSync('docs/js/character-scale-comparison-presentation.js','utf8'); // Visible Head label/number adapter.

const world = {
  HOBUNJI_ATTACHMENT_RIG_PROFILES:{characters:{}}, HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS:{},
  SCRATCHBONES_CONFIG:{game:{assets:{pngPlaneAvatar:{worldModelWidth:.9}}}},
  ProceduralHandAttachments:{attach(_three,parent){return {parent};}},
  location:{pathname:'/game/'},
  setInterval(callback){callback();return 1;},clearInterval(){},
}; // Deliberately no THREE: canonical raw head conversion must be pure.
world.window = world;
vm.runInNewContext(defaultsSource,world);
vm.runInNewContext(rigSource,world);
const rig=world.HobunjiCharacterRigScale;
const expected=world.HobunjiCharacterRigScaleDefaults.values;
const eq=(a,b,label)=>assert(Math.abs(a-b)<1e-10, label+': '+a+' != '+b); // Exact analytic geometry, excluding only floating-point noise.

function makeParent() {
  const bone={scale:{x:1,y:1,z:1,set(x,y,z){this.x=x;this.y=y;this.z=z;}},
    position:{x:0,y:.4,z:0},updateMatrix(){}};
  const parent={isObject3D:true,scale:{x:1,y:1,z:1,set(x,y,z){this.x=x;this.y=y;this.z=z;}},
    userData:{neckRig:{available:true,neckJoint:bone},portraitModelHeight:.9},
    children:[],updateMatrix(){},updateMatrixWorld(){},traverse(fn){fn(this);}};
  return {parent,bone};
}

assert.equal(Object.keys(expected).length,18,'all canonical species/gender profiles remain present');
for (const [index,[key,authored]] of Object.entries(expected).entries()) {
  const [species,gender]=key.split('::');
  const portrait=[.55,.75,.85,.95,1,1.18,1.35,1.7][index%8]; // Includes very differently scaled species portrait planes.
  const rawPixels=12+(index*7)%62; // Different original head widths: ratios must match raw PNG side by side.
  const rawHeight=18+(index*11)%70;
  for (const factor of [1,.6,1.4]) {
    const runtime=rig.runtimeHeadScaleForRaw(factor,portrait);
    eq(rig.rawPngHeadScaleFor(runtime,portrait),factor,key+' raw head factor round-trip');
    const {parent,bone}=makeParent();
    rig.applyToParent(parent,species,gender,{...authored,head:runtime});
    const worldScale=rig.worldVisualScale(), baseWidth=.9, canvasPixels=200;
    // Each fully head-weighted pixel follows portrait plane -> parent X/Y -> compensated head bone.
    const renderedWidth=baseWidth*portrait*(rawPixels/canvasPixels)*parent.scale.x*bone.scale.x;
    const renderedHeight=baseWidth*portrait*(rawHeight/canvasPixels)*parent.scale.y*bone.scale.y;
    const expectedWidth=baseWidth*worldScale*(rawPixels/canvasPixels)*factor;
    const expectedHeight=baseWidth*worldScale*(rawHeight/canvasPixels)*factor;
    eq(renderedWidth,expectedWidth,key+' raw head width despite species portrait scale');
    eq(renderedHeight,expectedHeight,key+' raw head height despite species body height');
    eq(renderedWidth/renderedHeight,rawPixels/rawHeight,key+' original PNG head aspect ratio');
  }
}
// Actual metadata must win over an authored profile or config that differs from the built preview.
for (const [name,source,nextFn] of [
  ['guard',guard,'  function boundsFor(identity, spec)'],
  ['presentation',presentation,'  function runtimeScaleFor(identity)'],
]) {
  const begin=source.indexOf('  function portraitScaleFor(identity) {');
  const end=source.indexOf(nextFn,begin);
  assert(begin>=0 && end>begin,name+' portrait basis function exists');
  let chosen=.82, configured=.93, authored=1.37;
  const fixture={
    window:{PNGPlaneAvatar:{avatarScaleMultiplierFor:()=>configured}},
    comparisonApi:()=>({selectedKey:'kenkari::male',selectedPortraitScaleMultiplier:chosen}),
    profileFor:()=>({anatomy:{portraitScale:authored}}),
    EPSILON:1e-6,
  }; // Intentionally conflicting values ensure the real rendered portrait determines Head 100%.
  vm.runInNewContext(source.slice(begin,end)+'\nthis.getPortraitScale=portraitScaleFor;',fixture);
  eq(fixture.getPortraitScale({key:'kenkari::male',species:'kenkari',gender:'male'}),chosen,
    name+' uses actual built PNGPlaneAvatar model multiplier');
  eq(fixture.getPortraitScale({key:'mao-ao::female',species:'mao-ao',gender:'female'}),configured,
    name+' uses effective PNG renderer config if a preview is not selected');
  fixture.window.PNGPlaneAvatar=null;
  eq(fixture.getPortraitScale({key:'kenkari::male',species:'kenkari',gender:'male'}),chosen,
    name+' can still resolve the selected built preview if config is unavailable');
  eq(fixture.getPortraitScale({key:'mao-ao::female',species:'mao-ao',gender:'female'}),authored,
    name+' falls back to authored profile only without a renderer');
}
const start=guard.indexOf('  function nextScale(current,');
const stop=guard.indexOf('  function nextScalePreservingHead(',start);
assert(start>0 && stop>start,'real guarded input converter is available');
const math={window:{HobunjiCharacterRigScale:rig},clamp:(v,a,b)=>Math.min(b,Math.max(a,Number(v))),
  finitePositive:(v,f)=>Number(v)>0?Number(v):f, MIN_RUNTIME_HEAD:.1,MAX_RUNTIME_HEAD:4};
vm.runInNewContext(guard.slice(start,stop)+'\nthis.edit=nextScale;',math);
for (const portrait of [.65,.75,1,1.18,1.5]) {
  const before={x:1.65,y:.6,legLength:1.8,head:.75,offsetY:-.06,handScale:1.3,footScale:.8};
  const updated=math.edit(before,'head',100,portrait);
  eq(updated.head,1/portrait,'100% Head cancels exact portrait multiplier '+portrait);
  for (const field of ['x','y','legLength','offsetY','handScale','footScale'])
    eq(updated[field],before[field],'Head edit preserves authored '+field);
}
assert.match(comparison,/get selectedPortraitScaleMultiplier\(\)/,'editor exposes actual built portrait scale to both adapters');
assert.match(comparison,/setSliderValue\('Head', rawHead \* 100\)/,'first-selected head value is raw PNG percent, not internal scale');
assert.match(comparison,/headScaleParity: selected \?/,'mobile diagnostics expose effective relative raw Head scale');
assert.match(presentation,/HobunjiFullScaleBodyInputGuard/,'presentation fallback uses same saved profile path as capture-phase guard');
assert.match(rigSource,/rawPngHeadScaleFor,/,'runtime exposes exact unscaled raw-head conversion');
console.log('PASS 18-profile raw-PNG head parity: width/height/aspect, different body and portrait scales, actual renderer basis, UI save conversion and diagnostics');
