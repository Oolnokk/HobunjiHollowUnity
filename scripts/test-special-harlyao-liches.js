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
  load('docs/js/npc-wardrobe.js'); // The same standalone adapter now ships with the Enemy Workshop.
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
  for (const [type, sprite] of [['hronal','hskel_eyeglow_m.png'],['tothal','hskel_eyeglow_f.png']]) {
    const roster = liches.specialRoster(type);
    assert.equal(roster.appearance.bodyColors.C.hex,liches.bodyColor3For(type),'Named body color C owns the wall/eye emission color');
    const portrait = liches.decoratePortraitProfile({bodyColors:{A:{hex:'#D4D6C9'},C:{hex:'#D4D6C9'}}},roster);
    assert.ok(portrait.eyes.layers[0].url.endsWith(sprite),'Eye appearance uses the new authored Harlyao Skeleton sprite');
    assert.equal(portrait.eyes.layers[1].pixelDye.sourceHex,'#7F00FF','Same authored target hue as the binding-mask eye glow');
    assert.equal(portrait.eyes.layers[1].pixelDye.paletteColorKey,'C');
    assert.equal(portrait.eyes.layers[1].pixelDyeOnly,true);
    assert.equal(portrait.bodyColors.C.hex,liches.bodyColor3For(type),'Fixed skeleton pigment does not override named lich eye hue');
  }
  const imlaoBare=liches.decoratePortraitProfile({
    bodyColors:{C:{hex:'#D4D6C9'}},hat:{id:'randomhat'},hood:{id:'randomhood'},mask:{id:'randommask'},
    eyes:{id:'randomEyes'},upperFace:{id:'randomFace'},facialHair:{id:'randomFacialHair'}
  },liches.specialRoster('kanthic'));
  for(const slot of ['hat','hood','mask','eyes','upperFace','facialHair'])
    assert.equal(imlaoBare[slot].id,'none','Imlao must not wear any '+slot);
  assert.equal(imlaoBare.bodyColors.C.hex,liches.bodyColor3For('kanthic'));
  const incorrectlyDressed=liches.specialRoster('kanthic');
  incorrectlyDressed.equippedCosmetics.push('ragged_hood','tangedcirclet','facewrap');
  incorrectlyDressed.cosmeticSlots.ragged_hood='hood';
  incorrectlyDressed.cosmeticSlots.tangedcirclet='hat';
  incorrectlyDressed.cosmeticSlots.facewrap='mask';
  liches.applyBodyColor3ToRoster(incorrectlyDressed,'kanthic');
  assert.ok(incorrectlyDressed.equippedCosmetics.every(id=>!['ragged_hood','tangedcirclet','facewrap'].includes(id)),'General clothing overrides cannot put headwear on Imlao');
  const nanahiWorn=window.NpcWardrobe.wornClothingItemsForRecord(liches.specialRoster('tothal'),true);
  assert.equal(nanahiWorn.find(item=>item.cosmeticId==='facewrap').slot,'hood','Explicit facewrap slot must survive NPC wardrobe processing');
  const nanahiRobe=nanahiWorn.find(item=>item.cosmeticId==='tankan_bodywrap');
  assert.equal(nanahiRobe.slot,'overwear');
  assert.equal(nanahiRobe.weaving.forcedOverpassPattern.motifUrl,'assets/patterns/motif_harlyao_glyph_servitude.png');
  assert.equal(nanahiRobe.colorC.hex,liches.DATA.tothal.ink);
  const azgarlu=liches.specialRoster('hronal');
  const forgedWorn=window.NpcWardrobe.wornClothingItemsForRecord(azgarlu,true);
  const forgedPauldron=forgedWorn.find(item=>item.cosmeticId==='rounded_pauldron');
  assert.equal(forgedPauldron.temperXp,window.MetalArmorSystem.MAX_TEMPER_XP,'NPC clothing adapter must preserve forged armor Temper');
  assert.equal(forgedPauldron.smithTreatment.mode,'pattern','NPC clothing adapter must preserve smith verdigris motifs');
  assert.equal(forgedPauldron.smithTreatment.pattern.motifUrl,'assets/patterns/motif_harlyao_glyph_entropy.png');
  const imlao={avatarRef:{group:{userData:{skullPixelsTransparent:true}},headScaleJoint:{front:{scale:{set(){throw Error('Head bone must not be collapsed');}}}}}};
  liches.init(imlao,'kanthic');
  assert.equal(imlao._specialSkullTransparent,true,'Skull is transparent with a full-size articulated head');
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
  assert.equal(liches.bodyColor3For('tothal'),'#a2b3c4','Signature ink is the fallback for body C');
  rules.set({schema:rules.schema,rules:{[key]:{...docData.rules[key],dyes:{C:{'#12AABB':3,'#AABBCC':1}}}}});
  assert.equal(liches.bodyColor3For('tothal'),'#12AABB','Named Color C resolves deterministically from the authored highest-weight pool');
  const dyedRoster=liches.specialRoster('tothal');
  assert.equal(dyedRoster.appearance.bodyColors.C.hex,'#12AABB');
  assert.equal(liches.decoratePortraitProfile({bodyColors:{}},dyedRoster).bodyColors.C.hex,'#12AABB');
  rules.set(docData);
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
  assert.ok(preview.includes('js/npc-wardrobe.js'),'Workshop must load the NPC forced-overpass adapter for patterned clothing');
  assert.ok(preview.includes("key === 'warhammer_nativeCopper' ? 'assets/toolsprites/warhammer.png'"),'Workshop retains a concrete canonical warhammer sprite fallback');
  const hostileRenderer=read('docs/js/combat/combat-bandit.js');
  assert.ok(hostileRenderer.includes("roster.specialLichId === 'imlao'"),'Imlao alpha-mask must be in the shared hostile portrait builder');
  assert.ok(hostileRenderer.includes("context.globalCompositeOperation = 'destination-out'"),'Skull pixels are removed without collapsing head joints');
  assert.ok(hostileRenderer.includes('originalHeadRigFront'),'Transparent head still retains the original neck skinning source');
  const map=read('docs/js/dev-random-ruin-interior-map.js');
  assert.ok(map.includes('specialBoss:!!specialDef'),'Ruin generation must pass named-boss marker to sanctum');
  assert.ok(map.includes('specialRoster?.(theme)?.appearance?.bodyColors?.C?.hex'),'Named ruin wall ink comes from the guardian roster Body Color C');
  assert.ok(preview.includes('applyCreatureBillboardScale?.(a.group'),'Workshop scales the actual hostile avatar root like gameplay');
  assert.ok(preview.includes('referenceX') && preview.includes('referenceY'),'Workshop camera preserves a stable body-size reference across re-rolls');
  for (const filename of ['m','f'])
    assert.ok(fs.existsSync(path.join(root,'docs/assets/cosmetics/appearance/harlyao_skeleton/hskel_eyeglow_'+filename+'.png')),'New eye sprites are committed to the repo');
  const sanctum=read('docs/js/dev-random-ruin-sanctum.js');
  assert.ok(sanctum.includes('SpecialHarlyaoLiches?.onDefeat'),'Guardian death must trigger its canonical key grant');
  console.log('Named Harlyao liches + Enemy Workshop: all smoke checks passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
