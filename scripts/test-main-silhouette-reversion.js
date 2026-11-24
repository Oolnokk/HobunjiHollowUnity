'use strict';
// Reversion point: PR #2037, commit 4cfb39c (adult silhouettes matched main using split body/leg scale).
// The later 65%-head, feet-height goal, Mao'ao-shift, and world enlargement settings must NOT survive.
const assert=require('node:assert/strict'); // Exact canonical silhouettes and adult-only restore behavior.
const fs=require('node:fs'); // Check production files, rather than a test-only reimplementation.
const vm=require('node:vm'); // Run the browser configuration/restore in isolation.

const defaults=fs.readFileSync('docs/config/character-rig-scale-defaults.js','utf8'); // Repo-backed authored adult defaults.
const runtime=fs.readFileSync('docs/js/character-rig-scale.js','utf8'); // New controls continue to use original old-main widths/heights.
const editor=fs.readFileSync('docs/js/character-scale-comparison.js','utf8'); // Restore action for old local saved values.

const exact=Object.freeze({ // Pinned historical x, y, leg, head, offset from commit 4cfb39c; not recalculated from today's branch.
  'tletingan::male':[.85,.85,.85,.8,0],
  'tletingan::female':[.915,.89,.89,.8823529411764706,0],
  'nuhongan::male':[.68,.6375,.6375,.8,0],
  'nuhongan::female':[.732,.6675,.6675,.8823529411764706,0],
  'longoran::male':[1.05,2,2,.9647,-.055],
  'longoran::female':[1.130294117647059,2.0941176470588236,2.0941176470588236,1.0640073529411764,-.055],
  'engh-sho::male':[.8,.845,.845,.7894736842105263,0],
  'engh-sho::female':[.795,.81,.81,.7894736842105263,0],
  'harlyao::male':[.96,1.014,1.014,.9473684210526315,0],
  'harlyao::female':[.954,.972,.972,.9473684210526315,0],
  'mao-ao::male':[.81675,1.089,1.089,.726,0],
  'mao-ao::female':[.895,.94,.94,.7813,0],
  'kenkari::male':[1.225,1.225,1.225,1,0],
  'kenkari::female':[1.1,1.1,1.1,1,0],
  'mashtzarr::male':[.955,1.255,1.255,.9856,-.095],
  'mashtzarr::female':[1.01,.99,.99,.8475,-.02],
  'mammakhbuur::male':[.96,1.69,1.69,.9771,-.095],
  'mammakhbuur::female':[1.0153,1.3331,1.3331,.8402,-.02],
});
const app={SCRATCHBONES_CONFIG:{game:{assets:{pngPlaneAvatar:{proceduralFeet:{footScale:{}}}}}},
  HOBUNJI_ATTACHMENT_RIG_PROFILES:{characters:{}}, HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS:{},
  location:{pathname:'/game/'},setInterval(fn){fn();return 1;},clearInterval(){}};
app.window=app;
vm.runInNewContext(defaults,app);
const cfg=app.HobunjiCharacterRigScaleDefaults;
assert(cfg && cfg.version>=34,'new default version avoids a stale cached imported scale bundle');
assert.deepEqual(Object.keys(cfg.values).sort(),Object.keys(exact).sort(),'exactly the 18 old-main canonical adult profiles');
for(const [id,expected] of Object.entries(exact)){
  const actual=cfg.values[id];
  assert.deepEqual([actual.x,actual.y,actual.legLength,actual.head,actual.offsetY],expected,
    id+' exactly matches original main silhouette values');
}
assert.equal(cfg.scaleFor('rakakoan','male').x,exact['kenkari::male'][0],'old canonical aliases retain their original main transforms');
assert.equal(cfg.scaleFor('ghoul','female').y,exact['mao-ao::female'][1],'old Mao-ao transform aliases remain');
assert.equal(cfg.scaleFor('mao-ao','male').head,.726,'later raw-65 head default is fully reverted');
assert.equal(cfg.maoaoFootScale.male,1.3125,'original main Mao-ao male foot factor restored');
assert.equal(cfg.maoaoFootScale.female,1.28125,'original main Mao-ao female foot factor restored');
assert.equal(app.SCRATCHBONES_CONFIG.game.assets.pngPlaneAvatar.proceduralFeet.footScale['mao-ao'].male,1.3125,
  'default foot runtime is immediately updated even before UI loads');
assert.equal(cfg.worldHeightCalibration,undefined,'global 6ft3 enlargement no longer shifts every character');
assert.equal(cfg.maleHeightFeet,undefined,'no later male-height targets override old silhouettes');
assert.equal(cfg.femaleVisibleHeightRatio,undefined,'no 93%-female height rule overwrites main');
assert.equal(cfg.rawHeadScale,undefined,'no later blanket 65% head target');
assert.equal(cfg.maoaoRelativeShift,undefined,'no later uploaded Maoao-relative width and limb deltas');
assert.equal(cfg.applyApprovedScaleDefaultsToProfiles,undefined,'no startup profile mutation reapplies the abandoned values');

const restores=cfg.mainSilhouetteRestoreValues; // Separate opt-in save migration covers auxiliary skeleton/bipedal identities.
assert.equal(Object.keys(restores).length,26,'one explicit old-main restore target for all 26 prior editor identities');
for(const [id,base] of Object.entries(cfg.values)){
  const restored=restores[id];
  assert.equal(restored.x,base.x,id+' explicit restore preserves old main width');
  assert.equal(restored.y,base.y,id+' explicit restore preserves old main height');
  assert.equal(restored.head,base.head,id+' explicit restore preserves old main head');
  assert.equal(restored.legLength,base.y,id+' restores original shared portrait/leg height');
  assert(Number(restored.handScale)>0 && Number(restored.footScale)>0,id+' has measured original hand/foot reference sizes');
}
assert.equal(restores['mao-ao::male'].handScale,1.1,'original Mao-ao male hand size, not the later 1.2x uploaded value');
assert.equal(restores['mao-ao::male'].footScale,1.3125,'explicit restore also corrects older local foot overrides');
assert.equal(restores['mao-ao::female'].handScale,1,'original Mao-ao female hand size, not the later 1.15x value');

vm.runInNewContext(runtime,app);
const rig=app.HobunjiCharacterRigScale;
assert.equal(rig.worldVisualScale(),1,'old-main silhouettes do not inherit the later 1.4029x outer multiplier');
assert.equal(rig.pixelHeightCorrectionFor('mao-ao','male'),1,
  'measured-crown 6ft3 correction no longer adjusts the old-main adult height');
assert.equal(rig.pixelHeightCorrectionFor('kenkari','female'),1,
  'per-species male-height goals are absent for all other adults');
assert.equal(app.HOBUNJI_ATTACHMENT_RIG_PROFILE_STATUS.mainSilhouetteParity.globalVisualScale,1,
  'mobile diagnostic reflects the restored world scale');
assert.equal(Object.keys(rig.pixelHeightCalibrationSnapshot()).length,0,'no stale painted-height target cache');

const start=editor.indexOf('  function matchMainAdultScales()');
const end=editor.indexOf('  // Discards every author override',start);
assert(start>0&&end>start,'Full Character Scale exposes an adult-only restore path');
const writes=[], feet=[], status=[],handWrites=[]; // Simulate an existing device's persisted overrides and live preview meshes.
const actor={species:'mao-ao',gender:'male',key:'mao-ao::male',
  feet:{setFootScaleMultiplier(v){feet.push(v);}},
};
const ageStages={baby:.3,toddler:.42,child:.7}; // Must remain untouched by an adult-scale rollback.
const npcAge={id:'Jubmir',hunch:.25}; // Same rule for individually authored NPC old-age hunch.
const window={HobunjiCharacterRigScaleDefaults:cfg,
  SCRATCHBONES_CONFIG:{game:{assets:{pngPlaneAvatar:{proceduralFeet:{footScale:{}}}}}},
  HobunjiHandModelProfiles:{mutate(fn){const data={speciesScaleOverrides:{}};fn(data);handWrites.push(data);}},
  ProceduralHandFrameDriver:{syncNow(){}},
};
const state={active:true,entries:[actor],selected:null,window,
  host:()=>({setRigScale(s,g,v,opts){writes.push({key:s+'::'+g,value:v,persist:opts?.persist});return v;}}),
  status:s=>status.push(s),partScaleFor:()=>1,applyPreviewProportions(){},
  syncLegPortraitAlignment(){},refreshLongoranSpine(){},syncSpineGuides(){},
  persistProfiles(){},layout(){},frame(){}};
vm.runInNewContext(editor.slice(start,end)+'\nthis.restore=matchMainAdultScales;',state);
state.restore();
assert.equal(writes.length,26,'all saved adult identities are restored');
assert.equal(writes.filter(v=>v.persist===true).length,1,'persist just once, not once per profile');
assert.equal(writes[25].persist,true,'all writes happen before one atomic persistence');
assert.equal(handWrites.length,1,'one hand-model update instead of 26 GLB reloads');
assert.equal(feet[0],1.3125,'preview feet match old main scale immediately');
assert.equal(window.SCRATCHBONES_CONFIG.game.assets.pngPlaneAvatar.proceduralFeet.footScale['mao-ao'].male,1.3125,
  'gameplay foot table also restored');
assert.equal(ageStages.baby,.3,'baby settings survive adult-only restore');
assert.equal(npcAge.hunch,.25,'per-NPC hunch survives adult-only restore');
assert.match(status[0],/Restored 26\/26 adult silhouettes to main \(4cfb39c\)/,
  'mobile status confirms exact main baseline');
assert.match(editor,/maaFullScaleMatchMainAdults[^>]+>Restore main silhouettes<\/button>/,
  'touch-friendly restore action has an unambiguous label');
console.log('PASS: old-main adult silhouettes (18 exact defaults, 26 restore profiles), no later height/65% overrides, original limbs, no global multiplier, saved-age preservation');
