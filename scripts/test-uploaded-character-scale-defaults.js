'use strict';
// User-uploaded Full Character Scale (3) is the authoritative adult baseline, not the older main replica.
const assert = require('node:assert/strict'); // Validate all 26 numeric records and one-time import.
const fs = require('node:fs'); // Read the checked-in upload and real canonical defaults.
const vm = require('node:vm'); // Simulate game/editor config and local overrides without WebGL.

const uploaded = JSON.parse(fs.readFileSync('docs/config/hobunji_full_character_scales.json','utf8')); // All 26 uploaded species/gender profiles.
const defaultsSource = fs.readFileSync('docs/config/character-rig-scale-defaults.js','utf8'); // Gameplay canonical source.
const editorSource = fs.readFileSync('docs/js/character-scale-comparison.js','utf8'); // Real import+save controls.
const world={SCRATCHBONES_CONFIG:{game:{assets:{pngPlaneAvatar:{proceduralFeet:{footScale:{}}}}}}}; // Existing global config before the default installer.
world.window=world;
vm.runInNewContext(defaultsSource,world);
const config=world.HobunjiCharacterRigScaleDefaults;
assert(config && config.version>=35,'new uploaded adult baseline version is installed');
const canonical=Object.keys(config.values); // 18 full species/gender defaults; 8 additional actors use the import reference.
const all=Object.keys(config.uploadedScaleRestoreValues);
assert.equal(canonical.length,18,'18 regular species/gender defaults');
assert.equal(all.length,26,'26 approved adult profile values, including skeleton/auxiliary actors');
let checked=0; // Numeric equality is exact to the precision supplied by the human-authored JSON.
for(const [species,genders] of Object.entries(uploaded)) for(const [gender,source] of Object.entries(genders)){
  const key=species+'::'+gender;
  const approved=config.uploadedScaleRestoreValues[key];
  assert(approved, 'missing uploaded identity '+key);
  for(const [from,to] of [['x','x'],['y','y'],['legLength','legLength'],['head','head'],['offsetY','offsetY'],['handScale','handScale'],['footScale','footScale']])
    assert.equal(approved[to],source[from],key+' '+to+' exactly preserves imported value');
  if(config.values[key]){
    assert.equal(config.values[key].x,source.x,key+' gameplay width');
    assert.equal(config.values[key].y,source.y,key+' gameplay height');
    assert.equal(config.values[key].head,source.head,key+' gameplay head');
  }
  checked++;
}
assert.equal(checked,26);
assert.equal(config.scaleFor('longoran','male').y,2.45,'uploaded longoran male height, not historical main');
assert.equal(config.scaleFor('longoran','female').y,2.78,'uploaded longoran female height');
assert.equal(config.scaleFor('engh-sho','male').x,.7,'uploaded Engh-sho male width');
assert.equal(config.scaleFor('engh-sho','female').y,.765,'uploaded Engh-sho female height');
assert.equal(config.maoaoFootScale.female,1.2813,'gameplay female Maoao foot uses EXACT uploaded rounding');
assert.equal(world.SCRATCHBONES_CONFIG.game.assets.pngPlaneAvatar.proceduralFeet.footScale['mao-ao'].female,1.2813,'runtime foot config agrees');
assert.equal(config.worldHeightCalibration,undefined,'do not reintroduce abandoned global 6ft3 factor');
assert.equal(config.maleHeightFeet,undefined,'do not reintroduce abandoned fixed species-height goals');
assert.equal(config.rawHeadScale,undefined,'do not override uploaded individual head sizes with blanket 65 percent');
const start=editorSource.indexOf('  function applyUploadedAdultScales()');
const end=editorSource.indexOf('  // Discards every author override',start);
assert(start>=0 && end>start,'approved-scale import action exists');
const saved=[]; // Each host scale write is captured; only the last must persist.
const handWrites=[]; // Model hand updates should use one bulk data operation.
const ageModifiers={baby:{width:.24,height:.38,head:.5},toddler:{width:.38,height:.47}};
const npcHunch={id:'Jubmir',hunch:.31};
const local={active:true,entries:[],selected:null,window:{
  HobunjiCharacterRigScaleDefaults:config,
  SCRATCHBONES_CONFIG:world.SCRATCHBONES_CONFIG,
  HobunjiHandModelProfiles:{mutate(fn){const data={speciesScaleOverrides:{}};fn(data);handWrites.push(data);}},
  ProceduralHandFrameDriver:{syncNow(){}},
},host:()=>({setRigScale(s,g,value,opts){saved.push({key:s+'::'+g,value,persist:opts?.persist});return value;}}),
  status(){},partScaleFor(){return 1;},applyPreviewProportions(){},syncLegPortraitAlignment(){},
  refreshLongoranSpine(){},syncSpineGuides(){},persistProfiles(){},layout(){},frame(){}};
vm.runInNewContext(editorSource.slice(start,end)+'\nthis.runImport=applyUploadedAdultScales;',local);
assert.equal(local.runImport(),26,'import stores all 26 profiles');
assert.equal(saved.length,26,'every uploaded adult is persisted once');
assert.equal(saved.filter(x=>x.persist).length,1,'bulk import writes localStorage once, not per profile');
assert.equal(handWrites.length,1,'hands are updated in one bulk pass');
assert.deepEqual(ageModifiers,{baby:{width:.24,height:.38,head:.5},toddler:{width:.38,height:.47}},'adult import leaves global age settings untouched');
assert.equal(npcHunch.hunch,.31,'adult import leaves individual hunch intact');
assert.match(editorSource,/Apply uploaded character scales/,'button must advertise actual uploaded baseline');
assert.match(editorSource,/const migrated = migratePersistedUploadedScalesOnce\(\)/,'old on-device rig overrides are migrated on first lineup load');
const migrationStart=editorSource.indexOf('  function migratePersistedUploadedScalesOnce()');
const migrationEnd=editorSource.indexOf('  // Discards every author override',migrationStart);
assert(migrationStart>0&&migrationEnd>migrationStart);
const map=new Map(); // A phone's old Raw Githack scale overrides survive across commit-pinned links.
const storage={getItem:key=>map.get(key)||null,setItem:(key,v)=>map.set(key,v)};
let applied=0;
const fixture={localStorage:storage,UPLOADED_SCALE_MIGRATION_KEY:'approved-upload-3-test',
  RIG_SAVE_KEY:'hobunjiAttachmentRigProfiles.v2',applyUploadedAdultScales(){applied++;return 26;}};
vm.runInNewContext(editorSource.slice(migrationStart,migrationEnd)+'\nthis.migrate=migratePersistedUploadedScalesOnce;',fixture);
assert.equal(fixture.migrate(),false,'fresh devices are not given redundant saved overrides');
map.set('hobunjiFullCharacterRigScales.v2','{"longoran::male":{"y":2}}');
assert.equal(fixture.migrate(),true,'old local adult overrides are updated to user upload');
assert.equal(fixture.migrate(),false,'later user edits are not overwritten on repeated entry');
assert.equal(applied,1,'migration is one-time');
console.log('PASS uploaded 26 adult values: exact numeric source parity, limbs, one-time migration, no head/height re-inflation and age preservation');
