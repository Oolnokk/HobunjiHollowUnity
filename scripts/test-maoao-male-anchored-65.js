'use strict';
// Only the uploaded Mao'ao MALE dimensions are edited; everyone of either gender inherits exactly HIS deltas.
const assert = require('node:assert/strict'); // Guards profile mathematics, legacy scale compatibility and one-time gameplay limb synchronization.
const fs = require('node:fs'); // Reads actual shipped profiles and scaling code.
const vm = require('node:vm'); // Executes the browser modules without the 3D renderer or mobile devtools.

const defaultsSource=fs.readFileSync('docs/config/character-rig-scale-defaults.js','utf8'); // Contains pinned main values and the single male anchor.
const profilesSource=fs.readFileSync('docs/config/attachment-rig-profiles.js','utf8'); // Real source portrait scales and limb anatomy.
const runtimeSource=fs.readFileSync('docs/js/character-rig-scale.js','utf8'); // Real game/editor shared visual transform.
const close=(actual,expected,label)=>assert(Math.abs(actual-expected)<1e-9,label+': '+actual+' !== '+expected); // No creeping relative errors.

const window={
  SCRATCHBONES_CONFIG:{game:{assets:{pngPlaneAvatar:{
    worldModelWidth:.9,
    portraitScaleBySpecies:{'mao-ao':1,'kenkari':.75,'engh-sho':.95,'tletingan':.85,'mashtzarr':1},
    portraitVerticalPlacement:{default:.5},
    proceduralFeet:{footScale:{default:1},legBend:{}},
  }}}},
  HOBUNJI_ATTACHMENT_RIG_PROFILES:{characters:{}},
  HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS:{},
  location:{pathname:'/game/'},
  ProceduralHandAttachments:{attach(_three,parent){return {parent};}},
  HobunjiHandModelProfiles:{
    data:{speciesScaleOverrides:{}},
    updates:0,
    mutate(update){update(this.data);this.updates++;},
  },
  setInterval(){return 1;},clearInterval(){},
}; // Deliberately stale config data; bootstrap must replace it with the approved hand/foot values.
window.window=window;
const context=vm.createContext({window,location:window.location,document:{},performance:{now:()=>0},
  setInterval:()=>1,clearInterval:()=>{}});
vm.runInContext(defaultsSource,context);
vm.runInContext(profilesSource,context);
vm.runInContext(runtimeSource,context);

const cfg=window.HobunjiCharacterRigScaleDefaults;
const runtime=window.HobunjiCharacterRigScale;
const values=cfg.values; // These are final runtime defaults, not a separate test-side reproduction.
const main=cfg.mainReferenceValues;
const shift=cfg.maoaoRelativeShift;
const maleAnchor={x:.85,y:1.29,handScale:1.2,footScale:1.05}; // Only deliberately changed profile supplied by the user.
const maleMain={x:.81675,y:1.089,handScale:1.1,footScale:1.3125}; // Exact current-main source reference.
assert.equal(Object.keys(values).length,26,'all 26 profiles in the author export are covered');
assert.equal(Object.keys(main).length,18,'original 18 main profiles remain available as an audit baseline');
assert.equal(cfg.rawHeadScale,.65,'user raw PNG Head target is 65%');
for(const axis of ['x','y','handScale','footScale']){
  const ratio=maleAnchor[axis]/maleMain[axis];
  close(shift.male[axis],ratio,'single male anchor '+axis);
  close(shift.female[axis],ratio,'female MUST use identical male anchor '+axis);
}
assert.equal(shift.male,shift.female,'there is literally one shared shift object, not a second female calculation');
for(const [key,base] of Object.entries(main)){
  const value=values[key], [species,gender]=key.split('::');
  close(value.x,base.x*shift.male.x,key+' width follows MALE shift');
  close(value.y,base.y*shift.male.y,key+' height follows MALE shift');
  close(value.legLength,value.y,key+' original leg-to-portrait ratio remains unchanged');
  close(value.offsetY,base.offsetY,key+' authored head vertical offset is preserved');
  assert(value.head>0,'every head uses nonzero internal compensator');
  assert(value.handScale>0&&value.footScale>0,'every default has complete extremities');
}
const female=values['mao-ao::female'];
close(female.x,.895*shift.male.x,'female Maoao inherits male width delta');
close(female.y,.94*shift.male.y,'female Maoao inherits male height delta');
close(female.handScale,1*shift.male.handScale,'female Maoao inherits MALE hand delta, NOT 1.15 from upload');
close(female.footScale,1.28125*shift.male.footScale,'female Maoao inherits male foot delta');
close(female.head,.65/.8,'female Maoao internal head compensates her own portrait art');
const male=values['mao-ao::male'];
for(const axis of ['x','y','handScale','footScale'])close(male[axis],maleAnchor[axis], 'edited male anchor unchanged: '+axis);
close(male.head,.65,'male Maoao raw head exactly 65%');
const portraits={
  'kenkari':.75,'tletingan':.85,'nuhongan':.85,'longoran':.85,
  'engh-sho':.95,'harlyao':.95,'harlyao-skeleton':.95,
  'mao-ao':1,'mao-ao-skeleton':1,'mashtzarr':1.18,'mammakhbuur':1.18,
  'omgurku':.95,'porakaneki':.75,
}; // Other special biped/skeleton heads use their source species plane scale, or unscaled default.
for(const [key,authored] of Object.entries(values)){
  const [species,gender]=key.split('::');
  const plane=species==='mao-ao' && gender==='female' ? .8 : portraits[species]||1;
  close(runtime.rawPngHeadScaleFor(authored.head,plane),.65,key+' displays Head 65% of raw PNG');
  const resolved=runtime.scaleFor(species,gender);
  close(resolved.x,authored.x,key+' game runtime inherited the corrected width');
  close(resolved.y,authored.y,key+' game runtime inherited the corrected height');
  close(resolved.head,authored.head,key+' game runtime inherited the correct raw-head compensator');
  close(resolved.legLength,authored.legLength,key+' game runtime inherited correct procedural leg length');
  const foot=window.SCRATCHBONES_CONFIG.game.assets.pngPlaneAvatar.proceduralFeet.footScale[species]?.[gender];
  close(foot,authored.footScale,key+' live procedural foot GLB config matches default');
  const hand=window.HobunjiHandModelProfiles.data.speciesScaleOverrides[species]?.[gender];
  close(hand,authored.handScale,key+' live hand GLB config matches default');
}
const profiles=window.HOBUNJI_ATTACHMENT_RIG_PROFILES.characters;
for(const [key,profile] of Object.entries(profiles)){
  const value=values[key];
  if(!value)continue; // Alternate aliases inherit their source species.
  close(profile.anatomy.rigScaleX,value.x,key+' profile visual width');
  close(profile.anatomy.rigScaleY,value.y,key+' profile visual height');
  close(profile.anatomy.headScale,value.head,key+' profile raw 65% Head factor');
  close(profile.anatomy.handScale,value.handScale,key+' profile hand');
  close(profile.anatomy.footScale,value.footScale,key+' profile foot');
}
const syncs=window.HobunjiHandModelProfiles.updates;
cfg.applyApprovedScaleDefaultsToProfiles();
assert.equal(window.HobunjiHandModelProfiles.updates,syncs,'repeated bootstrap does not re-mutate all hand models');
close(.9*values['mao-ao::male'].y*runtime.worldVisualScale(),1.375,'one global world factor keeps Maoao male at nominal 6ft3, no double growth');
console.log('PASS 26 profiles: same Maoao MALE shifts on every gender, Head raw 65%, saved profile/hand/foot/runtime consistency, one-time application, and 6ft3 calibration');
