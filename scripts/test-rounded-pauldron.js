const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const json = rel => JSON.parse(read(rel));

const cosmetic = json('docs/config/cosmetics/clothes/pauldrons/rounded_pauldron.json');
assert.equal(cosmetic.slot, 'pauldron');
assert.equal(cosmetic.tintSlot, 'PAULDRON');
assert.equal(cosmetic.meta.name, 'Rounded Pauldrons');
assert.equal(cosmetic.portraitAssets, true, 'pauldron config explicitly marks its non-/portrait/ PNG folder as portrait art');

const expected = {
  'mao-ao_male': 'rounded_pauldron_m.png',
  'mao-ao_female': 'rounded_pauldron_f.png',
  'tletingan_male': 'rounded_pauldron_tl_m.png',
  'tletingan_female': 'rounded_pauldron_tl_f.png',
  'kenkari_male': 'rounded_pauldron_kenk_m.png',
  'kenkari_female': 'rounded_pauldron_kenk_f.png',
  'engh-sho_male': 'rounded_pauldron_engh_m.png',
  'engh-sho_female': 'rounded_pauldron_engh_f.png',
  'rakakoan_male': 'rounded_pauldron_kenk_m.png',
  'rakakoan_female': 'rounded_pauldron_kenk_f.png',
  'mashtzarr_male': 'rounded_pauldron_mashtz_m.png',
  'mashtzarr_female': 'rounded_pauldron_mashtz_f.png',
};
for (const [variant, filename] of Object.entries(expected)) {
  const url = cosmetic.speciesVariants?.[variant]?.parts?.torso?.layers?.front?.image?.url;
  assert.equal(url, './assets/cosmetics/clothes/pauldrons/' + filename);
  assert(fs.existsSync(path.join(root, 'docs/assets/cosmetics/clothes/pauldrons', filename)), filename + ' exists');
}

const portraitLoader = read('docs/js/portrait-utils.js');
assert(
  portraitLoader.includes("const allowNonPortraitAssets = json.portraitAssets === true"),
  'portrait loader honors explicit portraitAssets cosmetics outside a literal /portrait/ folder'
);
assert(
  portraitLoader.includes("(!allowNonPortraitAssets && !String(imgUrl).toLowerCase().includes('/portrait/'))"),
  'body portrait extraction bypasses the legacy folder-name gate only for explicitly opted-in cosmetics'
);
for (const [variant, variantData] of Object.entries(cosmetic.speciesVariants)) {
  const imageUrl = variantData?.parts?.torso?.layers?.front?.image?.url;
  assert(imageUrl, variant + ' has a drawable portrait layer');
  assert(
    cosmetic.portraitAssets === true || String(imageUrl).toLowerCase().includes('/portrait/'),
    variant + ' survives the portrait-body asset gate'
  );
}

const skillSystemSource = read('docs/js/skill-system.js');
const metalArmorSource = read('docs/js/metal-armor-system.js');
const windowStub = { InventoryStacks: require('./lib/inventory-stacks') };
const vmContext = {
  window: windowStub,
  document: { querySelector: () => null },
  console,
  setTimeout,
  clearTimeout,
  queueMicrotask,
};
vm.runInNewContext(skillSystemSource, vmContext, { filename: 'skill-system.js' });
vm.runInNewContext(metalArmorSource, vmContext, { filename: 'metal-armor-system.js' });
const ps = windowStub.MetalArmorSystem;
assert(ps, 'MetalArmorSystem exports');
assert.deepEqual(Array.from(ps.TEMPER_XP_THRESHOLDS), [40, 90, 150, 220, 300], 'Temper uses Mastery-like five-rank pacing');
assert.equal(ps.__test.temperLevelForXp(39), 0);
assert.equal(ps.__test.temperLevelForXp(40), 1);
assert.equal(ps.__test.temperLevelForXp(299), 4);
assert.equal(ps.__test.temperLevelForXp(300), 5);
assert.equal(ps.KG_PER_WEIGHT_UNIT, 0.4, '4 ordinary-wool overwear units calibrate to ~1.6 kg');
assert.equal(ps.ARMOR_BLUEPRINTS.rounded_pauldron.sourceHex, '#7DC89A', 'the first metal-armor blueprint carries its authored source palette');
const copperWeight = ps.weightForBlueprintMetal('rounded_pauldron', 'nativeCopper');
const highTinWeight = ps.weightForBlueprintMetal('rounded_pauldron', 'highTinBronze');
assert(copperWeight.massKg > 1.3 && copperWeight.massKg < 1.4, 'single copper pauldron mass stays near the density-scaled historical reference');
assert(copperWeight.weightUnits > 3.3 && copperWeight.weightUnits < 3.5, 'copper pauldron lands a little above standard torso weight');
assert(highTinWeight.weightUnits < copperWeight.weightUnits, 'alloy density changes the physical outfit weight');
assert.equal(ps.visualOptions({ blueprintId:'rounded_pauldron', metalKey:'nativeCopper', temperXp:150, smithTreatment:null }).oxidationAmount, 0.5, 'Temper drives the same continuous verdigris fraction');
assert.equal(ps.visualOptions({ blueprintId:'rounded_pauldron', metalKey:'nativeCopper', temperXp:150, smithTreatment:null }).sourceHex, '#7DC89A', 'metal recolor options carry blueprint-specific source palettes into ToolMetalRecolor');
assert(metalArmorSource.includes("window.resolvePortraitAssetUrl?.(sourceUrl)"), 'metal armor resolves portrait-relative source art before ToolMetalRecolor reads its pixels');
assert.equal(ps.visualOptions({ blueprintId:'rounded_pauldron', metalKey:'nativeCopper', temperXp:300, smithTreatment:{ mode:'resistant', metalKey:'nativeCopper' } }).oxidationAmount, 0, 'resistant smith treatment suppresses verdigris');
assert.equal(ps.visualOptions({ blueprintId:'rounded_pauldron', metalKey:'nativeCopper', temperXp:300, smithTreatment:{ mode:'cosmetic', metalKey:'gold' } }).targetHex, '#D8AA2E', 'cosmetic plating switches to the treatment metal');

const wornPauldron = {
  uid: 'gcloth_smith_temper_regression',
  cosmeticId: 'rounded_pauldron#smith:temper_regression',
  baseCosmeticId: 'rounded_pauldron',
  slot: 'pauldron',
  materialKind: 'metal',
  metalKey: 'nativeCopper',
  temperXp: 0,
};
const gear = { clothingItems: [wornPauldron], clothing: { pauldron: wornPauldron } };
let gearSaveCount = 0;
ps.init({
  getGearInventory: () => gear,
  saveGearInventory: () => { gearSaveCount++; },
  getPlayerData: () => ({ appearance: { speciesId: 'mao-ao', gender: 'male' } }),
});
assert.equal(ps.debugSnapshot().skillXpListenerInstalled, true, 'Temper subscribes to the authoritative Skill XP event stream');
assert.equal(windowStub.SkillSystem.award('mining', 20, 'Temper integration regression', false), true, 'test Skill XP award succeeds');
assert.equal(wornPauldron.temperXp, 20, 'a real SkillSystem award advances equipped metal armor Temper');
assert.equal(ps.visualOptions(wornPauldron).oxidationAmount, 0.1, '20 Temper XP is already enough to render the first visible verdigris step');
assert(gearSaveCount >= 2, 'normalization and the XP award both persist the metal-armor state');

// Smithing costs: inventory keys are deleted at 0, so a missing bar key must
// read as zero bars rather than NaN (NaN < cost is false and used to pass).
const smithInventory = { gold: 100 };
const smithGear = { clothingItems: [], clothing: {} };
const smithToasts = [];
ps.init({
  getGearInventory: () => smithGear,
  saveGearInventory: () => {},
  getPlayerData: () => ({ appearance: { speciesId: 'mao-ao', gender: 'male' } }),
  inventory: smithInventory,
  VERDIGRIS_METAL_KEYS: ['nativeCopper'],
  metalBarItemKey: metalKey => 'bar_' + metalKey,
  clampInventoryStack: key => { if (key !== 'gold' && smithInventory[key] <= 0) delete smithInventory[key]; },
  showToast: text => smithToasts.push(text),
});
assert.equal(ps.__test.craft('rounded_pauldron', 'nativeCopper'), false, 'smithing with no bar stack at all is refused');
assert.equal(smithInventory.gold, 100, 'a refused craft charges no gold');
assert.equal('bar_nativeCopper' in smithInventory, false, 'a refused craft never writes NaN into the bar stack');
assert.equal(smithGear.clothingItems.length, 0, 'a refused craft creates no armor');
smithInventory.bar_nativeCopper = ps.ARMOR_BLUEPRINTS.rounded_pauldron.craftBarCost || 3;
assert.equal(ps.__test.craft('rounded_pauldron', 'nativeCopper'), false, 'affordable but undiscovered armor cannot be crafted');
ps.learnBlueprints([{ cosmeticId: 'rounded_pauldron', slot: 'pauldron' }]);
assert.equal(ps.__test.craft('rounded_pauldron', 'nativeCopper'), true, 'an affordable discovered craft succeeds');
assert.equal('bar_nativeCopper' in smithInventory, false, 'spending the exact bar cost clears the stack');
const smithed = smithGear.clothingItems[0];
smithed.temperXp = ps.MAX_TEMPER_XP;
assert.equal(ps.__test.applyTreatment(smithed, 'resistant'), false, 'a treatment with no bar stack is refused');
assert.equal(smithed.smithTreatment ?? null, null, 'a refused treatment applies nothing');
smithInventory.bar_nativeCopper = 1;
assert.equal(ps.__test.applyTreatment(smithed, 'resistant'), true, 'an affordable resistant coat applies');
assert.equal('bar_nativeCopper' in smithInventory, false, 'the resistant coat spends its copper bar');
smithInventory.bar_gold = 1;
assert.equal(ps.__test.applyTreatment(smithed, 'cosmetic:gold'), true, 'a cosmetic plating can replace the coat');
assert.equal(smithInventory.bar_nativeCopper, 1, 'replacing a treatment refunds the replaced treatment bar, like clearing does');
assert.equal('bar_gold' in smithInventory, false, 'the new plating spends its own bar');

const scratchbones = read('docs/config/scratchbones-config.js');
assert.match(scratchbones, /"id": "rounded_pauldron"[^\n]*"smithOnly": true[^\n]*"dyeable": false/, 'catalog marks pauldrons smith-only and non-dyeable');
const shopPieces = json('docs/config/shops/shop-stock.json').shops.generalStoreWares.clothingRotation.pieces;
assert(!shopPieces.some(piece => piece.id === 'rounded_pauldron'), 'General Store no longer sells pauldrons');

const onboarding = read('docs/onboarding-core.js');
assert(onboarding.includes("{ key: 'pauldron', label: '🛡 Pauldrons'"), 'the pauldron slot remains an ordinary clothing category for future non-metal pieces');
assert(onboarding.includes('PAULDRON: clothDyeColor(clothDyeA)'), 'non-metal pauldrons retain the ordinary dye channel');
assert(Object.hasOwn(vm.runInNewContext('(' + /clothing: (\{[^\n]+\})/.exec(onboarding)[1] + ')'),'pauldron'), 'gear schema still owns a dedicated pauldron slot');
assert(onboarding.includes("catalog.filter(i => i.category === slot.category && !i.smithOnly)"), 'character creation can expose future non-metal pauldrons while hiding smith-only metal recipes');

const equipment = read('docs/js/equipment-panel.js');
assert(equipment.includes('MetalArmorSystem?.applyImageVisual'), 'gear icons use the shared metal/verdigris renderer');
assert(equipment.includes("item.baseCosmeticId || item.cosmeticId"), 'unique smith instance IDs resolve through the authored base cosmetic');
assert(equipment.includes("item?.dyeable !== false"), 'non-dyeable smith clothing suppresses Redye');

const portrait = read('docs/js/portrait-utils.js');
const npcPreview = read('docs/js/npc-avatar-preview-utils.js');
assert(portrait.includes('MetalArmorSystem.preparePortraitLayers'), 'portrait pixels run through the metal renderer');
assert(npcPreview.includes("applyEquip('pauldron', 'pauldron'"), 'live player/NPC profile builder carries the pauldron slot into portrait rendering');
assert(portrait.includes("json.portraitAssets === true"), 'portrait loader supports explicitly authored portrait assets outside a /portrait/ folder');
assert(portrait.includes("!allowNonPortraitAssets && !String(imgUrl).toLowerCase().includes('/portrait/')"), 'the path exception is opt-in rather than globally treating every cosmetic image as portrait art');
assert(portrait.includes("entry.tint = { mode: 'none' }"), 'finished metal pixels in any clothing group are not recolored again as cloth');
assert(portrait.includes('window.resolvePortraitAssetUrl = resolvePortraitAssetUrl'), 'portrait renderer exports its canonical asset-root resolver for material processors');
assert(portrait.includes("data:|blob:|https?:|file:"), 'portrait loader accepts recolored data/absolute URLs without prefixing the asset root');

const weaving = read('docs/js/clothing-weaving-system.js');
assert(vm.runInNewContext(/OUTFIT_WEIGHT_SLOTS = Object.freeze\((\[[^\n]+\])\)/.exec(weaving)[1]).includes('pauldron'), 'pauldron weight contributes to outfit burden');
assert(weaving.includes('MetalArmorSystem?.isMetalArmor?.(itemOrBlueprint)'), 'loom craftability rejects literal metal armor regardless of clothing slot');
assert.match(weaving, /const explicit = Number\(item\?\.weightUnits\);[\s\S]*if \(Number\.isFinite\(explicit\)/, 'explicit smith weight is honored before cloth-only fallback');

const smith = read('docs/js/metal-craft-shop.js');
assert(smith.includes('MetalArmorSystem?.renderSmithySection?.(list)'), 'smithy renders the new metal-clothing section');
assert(smith.includes('MetalArmorSystem?.init?.'), 'smithy injects existing inventory/save/avatar adapters into the generic metal-armor module');

const game = read('docs/game.js');
assert(read('docs/js/tool-mastery.js').includes("MetalArmorSystem?.awardExperience?.(amount, 'tool/weapon Mastery XP', { save: false })"), 'tool/weapon Mastery XP contributes to every equipped metal armor article');
assert(read('docs/js/mastery-policy.js').includes("MetalArmorSystem?.awardExperience?.(delta, 'tool/weapon Mastery XP', { save: false })"), 'policy-permitted Mastery awards also contribute to equipped metal armor');
assert(skillSystemSource.includes('notifyAward(skillKey, gain, reason);'), 'SkillSystem emits from the authoritative award path used by both external and internal XP grants');
assert(metalArmorSource.includes('skillSystem.onAward'), 'ordinary SkillSystem XP reaches Temper through the authoritative award event');
assert(!metalArmorSource.includes('skillSystem.award = wrapped'), 'Temper no longer relies on a public-method monkey patch that misses internal SkillSystem awards');
assert(!metalArmorSource.includes('setToolReinforcement'), 'Temper unlocks cosmetic smith treatments, not stat-changing reinforcement');
assert(!metalArmorSource.includes("item.slot === 'pauldron'"), 'metal behavior is not inferred from the pauldron slot');
assert(!fs.existsSync(path.join(root, 'docs/js/pauldron-system.js')), 'the old pauldron-specific module filename is gone');
assert.equal(ps.isMetalArmor({ slot:'pauldron', cosmeticId:'cloth_pauldron', materialKind:'cloth' }), false, 'a non-metal pauldron stays ordinary clothing');
assert.equal(ps.isMetalArmor({ slot:'pauldron', cosmeticId:'rounded_pauldron', materialKind:'cloth' }), false, 'even a registered base cosmetic is not a metal inventory item without metal material metadata');

const studio = read('docs/tools/character-studio/index.html');
assert(studio.includes("category: 'pauldron', tintKeys: ['PAULDRON']"), 'Character Studio keeps the pauldron dye channel for future non-metal pauldrons');

const index = read('docs/index.html');
const metalArmorScriptAt = index.indexOf('js/metal-armor-system.js?v='); // Version-independent ordering guards; cache-bust revisions should not invalidate them.
assert(metalArmorScriptAt > 0 && index.indexOf('js/tool-metal-recolor.js?v=') < metalArmorScriptAt, 'shared tool metal renderer loads before generic armor material bridge');
assert(metalArmorScriptAt < index.indexOf('onboarding.js?v='), 'generic metal-armor renderer loads before save/creator portraits');

const pixelProbe = read('docs/js/pixel-probe.js');
assert(pixelProbe.includes('MetalArmorSystem?.diagnosticsText?.()'), 'Pixel Probe exposes phone-copyable Temper/material/weight diagnostics');

console.log('OK: Metal armor is item/blueprint-driven across clothing slots; Rounded Pauldrons are the first smith recipe with cosmetic Temper, shared treatments, and density-derived weight.');

assert(/js\/npc-avatar-preview-utils\.js\?v=[A-Za-z0-9_.-]+/.test(index), 'live avatar profile builder cache is bumped with the pauldron integration');

const hybrid = ps.ARMOR_BLUEPRINTS.replica_bzabag_helm; // Regression contract for Hreesh's split-cloth-and-metal prize.
assert.equal(hybrid.slot,'hat');
assert.deepEqual(Array.from(hybrid.clothLayerRoles),['base']);
assert.deepEqual(Array.from(hybrid.metalLayerRoles),['trim']);
assert(hybrid.allowDuplicates && hybrid.strictAppearance,'smith duplicates do not require additional species art');
assert(ps.isMetalArmor({cosmeticId:hybrid.id,slot:'hat'}),'previously granted plain festival helmets are recognized as metal armor');
assert(!ps.isMetalPortraitLayer({materialKind:'cloth'},{blueprintId:hybrid.id}),'loom cap never gains a metal tint');
assert(ps.isMetalPortraitLayer({materialKind:'metal'},{blueprintId:hybrid.id}),'faceguard participates in metal tint');
const lw = ps.weightForBlueprintMetal(hybrid.id,'tinBronze','light'); // Both wool variants have identical faceguard weight.
const hw = ps.weightForBlueprintMetal(hybrid.id,'tinBronze','heavy');
assert.equal(Math.round((hw.weightUnits-lw.weightUnits)*100),90,'heavy cap is 0.9 weight units heavier');
assert.equal(ps.spriteForBlueprintAppearance(hybrid.id,{speciesId:'mashtzarr',gender:'female'}),null,'unillustrated players never borrow incompatible sprites');
const article = ps.__test.makeCraftedItem(hybrid.id,'tinBronze','heavy'); // Article saves one smith alloy and one independent wool class.
article.weaving={layers:{base:{pattern:{motifScale:1}}}};
const savedDye=article.colorA, savedPattern=article.weaving;
assert.equal(ps.normalizeItem(article),false,'normalization preserves a forged hybrid article');
assert.equal(article.colorA,savedDye);
assert.equal(article.weaving,savedPattern);
assert.equal(ps.visualOptions({blueprintId:hybrid.id,metalKey:'tinBronze',temperXp:300}).oxidationAmount,1,'Temper fully oxidizes the faceguard');
assert.equal(ps.visualOptions({blueprintId:hybrid.id,metalKey:'tinBronze',temperXp:300,smithTreatment:{mode:'cosmetic',metalKey:'gold'}}).oxidationAmount,0,'plating suppresses the original patina');
const prizeConfig=json('docs/config/cosmetics/clothes/hat/replica_bzabag_helm.json');
assert.equal(prizeConfig.speciesVariants.mao_ao_male?.parts?.head?.layers?.front_cap?.materialKind, undefined); // Legacy typo key must not shadow the official mao-ao variant.
const helmLayers=prizeConfig.speciesVariants['mao-ao_male'].parts.head.layers; // Ordering supplies base → trim on the same head-front plane.
assert.deepEqual(Object.keys(helmLayers),['front_cap','front'],'cap and faceguard share the front plane, behind neither head nor each other incorrectly');
assert.equal(helmLayers.front_cap.materialKind,'cloth');
assert.equal(helmLayers.front.materialKind,'metal');
assert.equal(helmLayers.front_cap.behindImage.url,helmLayers.front_cap.image.url,'cap retains exactly the same PNG in both views');
assert.equal(helmLayers.front.behindImage.url,'./assets/cosmetics/clothes/hat/headband.png','the metal faceguard has the Tanged Circlet rear-band silhouette');
assert(weaving.includes('metalItem: hybrid ? item : null'),'icon compositor uses exact plated/patinated faceguard state');
assert(weaving.includes('isReweavableClothComponent(item)'),'loom can reweave the cloth cap without adding a smith blueprint to craftables');
assert(weaving.includes('cfg?.onlyExactSpeciesVariant ? speciesVariantKeyCandidates(speciesId, gender)'),'unavailable helm variants cannot leak Mao-ao art into icons/loom previews');
assert(portrait.includes('isMetalPortraitLayer?.(entry.layer, entry.metalState) === false'),'portrait skips metal bake on cloth cap');

const prizeInventory={gold:150,bar_tinBronze:20,lightWool:2,puktukWool:3}; // Tracks exact resource spending across both smith-only wool recipes.
const prizeGear={clothingItems:[],clothing:{}}; // Stores unique instances despite identical cosmetic+metal keys.
ps.init({getGearInventory:()=>prizeGear,getPackClothing:()=>[],saveGearInventory:()=>{},saveMemberWorldData:()=>{},
 getPlayerData:()=>({appearance:{speciesId:'mao-ao',gender:'male'}}),inventory:prizeInventory,
 VERDIGRIS_METAL_KEYS:['tinBronze'],metalBarItemKey:key=>'bar_'+key,
 clampInventoryStack:key=>{if(prizeInventory[key] <= 0)delete prizeInventory[key];},showToast:()=>{}});
ps.learnBlueprints([{cosmeticId:hybrid.id,slot:'hat'}]);
assert(ps.__test.craft(hybrid.id,'tinBronze','light'),'light-wool helmet is smithed');
assert.equal(prizeInventory.lightWool,undefined,'light recipe consumes two light wool');
assert.equal(prizeInventory.puktukWool,3,'light recipe does not consume heavy wool');
assert(ps.__test.craft(hybrid.id,'tinBronze','heavy'),'heavy-wool duplicate is smithed');
assert.equal(prizeInventory.puktukWool,1,'heavy recipe consumes exactly two heavy wool');
assert.equal(prizeGear.clothingItems.length,2,'smith keeps distinct owned helmets');
assert.notEqual(prizeGear.clothingItems[0].uid,prizeGear.clothingItems[1].uid);
assert.equal(ps.__test.craft(hybrid.id,'tinBronze','unrecognized'),false,'invalid wool class is rejected');
assert.equal(ps.__test.craft(hybrid.id,'tinBronze','light'),false,'insufficient wool is rejected without charging');
assert.equal(prizeGear.clothingItems.length,2);


// Real quality-aware smithing consumes one canonical item stack and its star-quality buckets.
const trackedWoolInventory={gold:200,bar_tinBronze:12,lightWool:3,puktukWool:2}; // Shared with CookingSystem's quality consumer in this smith-only regression.
const trackedGear={clothingItems:[],clothing:{}}; // Receives new helms only after atomic wool + alloy checks.
const qualityConsumes=[]; // Confirms both wool variants use exactly the established lowest-quality consumption API.
windowStub.CookingSystem={consumeQualityByPolicy(key,amount,policy) {
  qualityConsumes.push({key,amount,policy});
  if (trackedWoolInventory[key] < amount) return null;
  trackedWoolInventory[key]-=amount;
  return {stars:2,groups:[{stars:2,amount}]};
}};
ps.init({getGearInventory:()=>trackedGear,getPackClothing:()=>[],saveGearInventory:()=>{},saveMemberWorldData:()=>{},
  getPlayerData:()=>({appearance:{speciesId:'mao-ao',gender:'male'}}),inventory:trackedWoolInventory,
  VERDIGRIS_METAL_KEYS:['tinBronze'],metalBarItemKey:key=>'bar_'+key,
  clampInventoryStack:()=>{},showToast:()=>{}});
ps.learnBlueprints([{cosmeticId:hybrid.id,slot:'hat'}]);
assert(ps.__test.craft(hybrid.id,'tinBronze','light'),'quality-tracked smithing succeeds');
assert.equal(trackedWoolInventory.lightWool,1);
assert.deepEqual(qualityConsumes[0],{key:'lightWool',amount:2,policy:'lowest'},'quality-aware smithy uses the same low-first policy as the loom');
assert(ps.__test.craft(hybrid.id,'tinBronze','heavy'),'tracked heavy wool uses its own quality bucket');
assert.deepEqual(qualityConsumes[1],{key:'puktukWool',amount:2,policy:'lowest'});
assert.equal(trackedWoolInventory.puktukWool,0);
windowStub.CookingSystem.consumeQualityByPolicy=()=>null; // Simulates an unreconciled/ineligible quality bucket despite an apparent wool count.
const barsBeforeWoolFailure=trackedWoolInventory.bar_tinBronze;
const goldBeforeWoolFailure=trackedWoolInventory.gold;
assert.equal(ps.__test.craft(hybrid.id,'tinBronze','light'),false,'failed quality consumer cannot produce a free helmet');
assert.equal(trackedWoolInventory.bar_tinBronze,barsBeforeWoolFailure,'failed wool debit charges no metal bars');
assert.equal(trackedWoolInventory.gold,goldBeforeWoolFailure,'failed wool debit charges no labor');
assert.equal(trackedGear.clothingItems.length,2,'failed debit adds no item');
delete windowStub.CookingSystem;

const zlibHelm=require('node:zlib'); // Decodes the authored PNG's raw paint palette for checking the source-keyed metal recolor.
const helmBytes=fs.readFileSync(path.join(root,"docs/assets/cosmetics/clothes/hat/replica_bzabag's_helm-faceguard_m.png"));
let posHelm=8,headerHelm=null,paletteHelm=null,alphaHelm=null;const idatHelm=[];
while(posHelm+12<=helmBytes.length){
 const size=helmBytes.readUInt32BE(posHelm),type=helmBytes.toString('ascii',posHelm+4,posHelm+8),buf=helmBytes.subarray(posHelm+8,posHelm+8+size);
 if(type==='IHDR')headerHelm={w:buf.readUInt32BE(0),h:buf.readUInt32BE(4),depth:buf[8],color:buf[9],interlace:buf[12]};
 if(type==='PLTE')paletteHelm=buf;
 if(type==='tRNS')alphaHelm=buf;
 if(type==='IDAT')idatHelm.push(buf);
 posHelm+=size+12;if(type==='IEND')break;
}
assert(headerHelm,'helm PNG header found');
const bytesPerPixelHelm=({0:1,2:3,3:1,4:2,6:4})[headerHelm.color],strideHelm=headerHelm.w*bytesPerPixelHelm;
assert.equal(headerHelm.depth,8,'helm decoder supports 8-bit PNG');assert.equal(headerHelm.interlace,0,'helm decoder supports un-interlaced PNG');
const dataHelm=zlibHelm.inflateSync(Buffer.concat(idatHelm));const histogramHelm=new Map();let offHelm=0,lastRowHelm=new Uint8Array(strideHelm);
for(let y=0;y<headerHelm.h;y++){
 const filter=dataHelm[offHelm++],row=new Uint8Array(strideHelm);for(let x=0;x<strideHelm;x++){
   const src=dataHelm[offHelm++],a=x>=bytesPerPixelHelm?row[x-bytesPerPixelHelm]:0,b=lastRowHelm[x],c=x>=bytesPerPixelHelm?lastRowHelm[x-bytesPerPixelHelm]:0;
   let value=src;
   if(filter===1)value+=a;else if(filter===2)value+=b;else if(filter===3)value+=Math.floor((a+b)/2);
   else if(filter===4){const p=a+b-c;value+=[a,b,c].sort((u,v)=>Math.abs(p-u)-Math.abs(p-v))[0];}
   else assert.equal(filter,0,'PNG filter supported');
   row[x]=value&255;
 }
 for(let x=0;x<headerHelm.w;x++){const k=x*bytesPerPixelHelm;let red,green,blue,alpha=255;
 if(headerHelm.color===6){red=row[k];green=row[k+1];blue=row[k+2];alpha=row[k+3];}
 else if(headerHelm.color===2){red=row[k];green=row[k+1];blue=row[k+2];}
 else if(headerHelm.color===3){const idx=row[k];red=paletteHelm[idx*3];green=paletteHelm[idx*3+1];blue=paletteHelm[idx*3+2];alpha=alphaHelm?.[idx]??255;}
 else if(headerHelm.color===0){red=green=blue=row[k];}
 else if(headerHelm.color===4){red=green=blue=row[k];alpha=row[k+1];}
 if(alpha<128)continue;
 const hex=[red,green,blue].map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase();
 histogramHelm.set(hex,(histogramHelm.get(hex)||0)+1);
 }
 lastRowHelm=row;
}
const topColorsHelm=[...histogramHelm].sort((a,b)=>b[1]-a[1]).slice(0,40);

const faceguardOptions=ps.visualOptions({blueprintId:hybrid.id,metalKey:'nativeCopper',temperXp:0}); // Uses production blueprint tolerance, not hand-entered test constants.
assert.equal(faceguardOptions.sourceHex,'#4F6F6C','faceguard detector matches its actual painted metal');
function hsvForHelmHex(hex) {
  const channels=[0,2,4].map(i=>parseInt(hex.replace('#','').slice(i,i+2),16)/255);
  const top=Math.max(...channels),low=Math.min(...channels),spread=top-low;
  let h=0;if(spread){if(top===channels[0])h=((channels[1]-channels[2])/spread)%6;
    else if(top===channels[1])h=(channels[2]-channels[0])/spread+2;
    else h=(channels[0]-channels[1])/spread+4;}
  return {h:(h*60+360)%360,s:top?spread/top:0};
}
function selectedForHelmMetal(hex) {
  const source=hsvForHelmHex(faceguardOptions.sourceHex),pixel=hsvForHelmHex(hex);
  const d=Math.abs(source.h-pixel.h);
  return Math.min(d,360-d)<=faceguardOptions.hueToleranceDeg
    && Math.abs(source.s-pixel.s)<=faceguardOptions.saturationTolerance;
}
assert(histogramHelm.has('2B3E3C') && histogramHelm.has('4F6F6C'),'test uses the shipped faceguard art, not an invented raster');
assert(selectedForHelmMetal('#2B3E3C') && selectedForHelmMetal('#4F6F6C'),'actual dark and highlighted metal shades are eligible for alloy tint/verdigris');
assert(!selectedForHelmMetal('#000000') && !selectedForHelmMetal('#010101'),'black ink outlines must never enter the metal recolor/verdigris mask');
assert(!selectedForHelmMetal('#020202'),'near-black ink is also excluded from oxidation and authored removal patterns');
assert([...histogramHelm].filter(([hex])=>selectedForHelmMetal('#'+hex)).reduce((sum,[,n])=>sum+n,0)>300,'metal mask includes a meaningful number of authored metal pixels');
console.log('Bzabag faceguard source-palette and black-outline preservation passed.');

