// Regression checks for the three named liches, keystone identity, and editable Enemy Workshop rules.
// Run: node scripts/test-special-harlyao-liches.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root,file),'utf8'); // Loaded by the isolated runtime checks below.
const window = {
  HobunjiCharacterRigScale: {
    scaleFor: (_,gender) => gender === 'female'
      ? {x:.954,y:.972,head:.947,offsetY:0}
      : {x:.96,y:1.014,head:.947,offsetY:0},
  },
  HarlyaoLichCombat: {
    TYPE_DEFS: {hronal:{hues:['orange']},tothal:{hues:['blue']},kanthic:{hues:['indigo']}},
    makeEntity:async options=>options,
  },
  MetalArmorSystem: {
    makeCraftedItem:(id)=>({slot:id==='rounded_pauldron'?'pauldron':'hat',baseCosmeticId:id}),
    MAX_TEMPER_XP:500,spriteForBlueprintAppearance:()=>null,
  },
};
const doc = {currentScript:{src:'https://example.test/js/combat/enemy-loadout-rules.js'},baseURI:'https://example.test/'};
const context=vm.createContext({window,document:doc,URL,console,fetch:async()=>({ok:true,json:async()=>({schema:'hobunji_enemy_loadouts.v1',rules:{}})})}); // No external requests are made by these tests.
function load(file) {vm.runInContext(read(file),context,{filename:file});}
(async()=>{
  load('docs/js/combat/enemy-loadout-rules.js');
  await window.EnemyLoadoutRules.ready;
  load('docs/js/combat/combat-special-liches.js');
  load('docs/tools/enemy-loadout-editor/source-data.js');
  const rules=window.EnemyLoadoutRules, liches=window.SpecialHarlyaoLiches;
  assert.deepEqual(Object.keys(liches.DATA).sort(),['hronal','kanthic','tothal']);
  assert.equal(liches.kindFor('hronal'),'lich:hronal:azgarlu');
  assert.equal(liches.kindFor('tothal'),'lich:tothal:nanahi');
  assert.equal(liches.kindFor('kanthic'),'lich:kanthic:imlao');
  const h=liches.rigScaleFor('hronal'),t=liches.rigScaleFor('tothal');
  assert.ok(Math.abs(h.x/.96-1.30)<.001&&Math.abs(h.y/1.014-1.20)<.001);
  assert.ok(Math.abs(t.x/.954-.8)<.001&&Math.abs(t.y/.972-1.30)<.001);
  assert.equal(liches.specialRoster('tothal').cosmeticSlots.facewrap,'hood');
  assert.ok(liches.specialRoster('hronal').equippedCosmetics.includes('rounded_pauldron'));
  assert.ok(!liches.specialRoster('kanthic').equippedCosmetics.includes('ragged_hood'));
  const key=liches.kindFor('tothal');
  const docData={schema:rules.schema,rules:{[key]:{
    bossSettings:{specialCooldownSeconds:7.2,barrageIntervalSeconds:.3},
    bossAppearance:{glyphId:'harlyao_glyph_ignorance',ink:'#a2b3c4',robeDye:'dye:CLOTH:pale_blue'},
    specialAttacks:{blizzard:false},rigScale:{y:1.4},
  }}};
  rules.set(docData);
  assert.equal(liches.settingsFor('tothal').barrageIntervalSeconds,.3);
  assert.equal(liches.defFor('tothal').glyph,'harlyao_glyph_ignorance');
  assert.equal(liches.defFor('tothal').ink,'#a2b3c4');
  assert.equal(rules.ruleFor('lich:tothal').specialAttacks?.blizzard,undefined);
  assert.throws(()=>rules.set({schema:rules.schema,rules:{[key]:{bossSettings:{chargeCount:1.5}}}}));
  assert.throws(()=>rules.set({schema:rules.schema,rules:{'lich:tothal':{bossSettings:{chargeCount:4}}}}));
  assert.throws(()=>rules.set({schema:rules.schema,rules:{[key]:{bossAppearance:{ink:'malformed'}}}}));
  rules.set(docData);
  const options=window.EnemyLoadoutSourceData.types.filter(entry=>entry.group==='Special Liches');
  assert.equal(options.length,3);
  const special=await window.EnemyLoadoutSourceData.spawn(key,2,{}, {seed:'test'});
  assert.equal(special.special,true);
  assert.equal(special.type,'tothal');
  assert.equal(special.extra.enemyLoadoutKind,key);
  const ordinary=await window.EnemyLoadoutSourceData.spawn('lich:tothal',2,{}, {seed:'test'});
  assert.notEqual(ordinary.special,true);
  const workshop=read('docs/tools/enemy-loadout-editor/app.js');
  for(const label of ['renderBossAppearance','renderBossSettings','bossAppearance','bossSettings','plasmCharge','blizzard','melee'])
    assert.ok(workshop.includes(label),'Workshop must expose '+label);
  const preview=read('docs/tools/enemy-loadout-editor/preview.js');
  assert.ok(preview.includes('js/combat/combat-special-liches.js'),'Workshop preview must load actual named-boss runtime');
  const map=read('docs/js/dev-random-ruin-interior-map.js');
  assert.ok(map.includes('specialBoss:!!specialDef'),'Ruin generation must pass named-boss marker to sanctum');
  const sanctum=read('docs/js/dev-random-ruin-sanctum.js');
  assert.ok(sanctum.includes('SpecialHarlyaoLiches?.onDefeat'),'Guardian death must trigger its canonical key grant');
  console.log('Named Harlyao liches + Enemy Workshop: all smoke checks passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
