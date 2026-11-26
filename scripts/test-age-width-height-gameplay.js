'use strict';
// Age authoring's width/height split must reach family records and the REAL child portrait builder.
const assert=require('node:assert/strict'); // Checks runtime configs, legacy saves, head/portrait geometry, and restore.
const fs=require('node:fs'); // Load shipped modules instead of rewriting age math in the test.
const vm=require('node:vm'); // Browser-only runtime can be inspected without Three.js.
const age=fs.readFileSync('docs/js/character-age-rig-config.js','utf8'); // Shared same-site age application bridge.
const portrait=fs.readFileSync('docs/js/png-plane-avatar.js','utf8'); // Creates child modelWidth/modelHeight and head factors.
const familySource=fs.readFileSync('docs/js/romance-family.js','utf8'); // Produces child NPC records in each growth phase.
const scaleRuntime=fs.readFileSync('docs/js/character-rig-scale.js','utf8'); // Head compensation prevents width-only distortion.

const family={phaseScales:{basket:{body:.32,head:.5,hand:1.2,foot:1.2},
  toddler:{body:.4,head:.66,hand:1,foot:1}},childLimbModifiers:{hand:1,foot:1}};
const png={childScaleMultiplier:.5,childHeadScaleMultiplier:.72}; // Existing game defaults have one body dimension.
const saved=new Map(); // Simulates real browser localStorage with controlled legacy/applied preferences.
const world={HobunjiRomanceConfig:{family},SCRATCHBONES_CONFIG:{game:{assets:{pngPlaneAvatar:png}}},
  localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)},
  console};
world.window=world;
vm.runInNewContext(age,world);
const api=world.HobunjiCharacterAgeRigConfig;
assert(api,'shared age configuration installed');
const defaults=api.repositoryDefaults();
assert.equal(defaults.baby.width,.32,'legacy baby body sets width');
assert.equal(defaults.baby.height,.32,'legacy baby body sets height');
assert.equal(defaults.child.width,.5,'legacy child width matches previous single body factor');
assert.equal(defaults.child.height,.5,'legacy child height matches previous single body factor');
assert.equal(defaults.child.head,.72,'default child head remains independently authored');
const draft=api.sanitize({baby:{width:.29,height:.38,head:.55,hand:1.4,foot:1.3},
  toddler:{body:.43,head:.64},child:{width:.51,height:.64,head:.78}});
assert.equal(draft.baby.width,.29);
assert.equal(draft.baby.height,.38);
assert.equal(draft.toddler.width,.43,'old body field migrates to width');
assert.equal(draft.toddler.height,.43,'old body field migrates to height');
const composed=api.composePreviewScale({x:1.3,y:1.7,head:.8,offsetY:-.04},draft.baby);
assert.equal(composed.x,1.3*.29,'editor preview scales Width independently');
assert.equal(composed.y,1.7*.38,'editor preview scales Height independently');
assert.equal(composed.head,.8*.55,'Head is separate from both body axes');
const applied=api.applyOnThisDevice(draft);
assert.equal(applied.baby.width,.29);
assert.equal(family.phaseScales.basket.width,.29,'family baby width reaches the game');
assert.equal(family.phaseScales.basket.height,.38,'family baby height reaches the game');
assert.equal(family.phaseScales.basket.body,.38,'legacy family consumers get height as body');
assert.equal(family.phaseScales.toddler.width,.43,'migrated toddler width reaches family');
assert.equal(png.childWidthScaleMultiplier,.51,'independent child width reaches PNGPlaneAvatar config');
assert.equal(png.childScaleMultiplier,.64,'legacy child body means vertical stature');
assert.equal(png.childHeadScaleMultiplier,.78,'child head remains independent');
assert.equal(api.snapshot().applied,true,'explicit Apply is required for gameplay changes');
const pBegin=portrait.indexOf('  function childScaleFor(options = {}) {');
const pEnd=portrait.indexOf('  function avatarScaleMultiplierFor(',pBegin);
assert(pBegin>0&&pEnd>pBegin,'actual child portrait dimension builder found');
const childFixture={cfg:()=>png,isChildAvatar:()=>true};
vm.runInNewContext(portrait.slice(pBegin,pEnd)+'\nthis.childScaleFor=childScaleFor;',childFixture);
const c=childFixture.childScaleFor({npcRecord:{isChild:true}});
assert.equal(c.width,.51,'actual PNG portrait builder reads independent child width');
assert.equal(c.height,.64,'actual PNG portrait builder reads independent child height');
assert.equal(c.body,.64,'old avatarScaleMultiplierFor remains vertical for compatibility');
assert.equal(c.head,.78,'head final size unchanged by width edit');
assert.equal(c.headFactorX,.78/.51,'head width compensates for changed child portrait width');
assert.equal(c.headFactor,.78/.64,'head height compensates for changed child portrait height');
assert.equal(c.width*c.headFactorX,c.height*c.headFactor,'head visual size matches in both axes');
assert.match(portrait,/const modelWidth = baseModelWidth \* scaleMultiplier \* \(childDimensions \? childDimensions\.width \/ childDimensions\.height : 1\)/,
  'actual modelWidth uses separate child width factor');
assert.match(portrait,/const modelHeight = baseModelHeight \* scaleMultiplier/,'modelHeight stays on child height');
const fBegin=familySource.indexOf('  function phaseScaleFields(phase) {');
const fEnd=familySource.indexOf('  function childRecord(child) {',fBegin);
assert(fBegin>0&&fEnd>fBegin,'real family child record adapter found');
const familyFixture={cfg:()=>family};
vm.runInNewContext(familySource.slice(fBegin,fEnd)+'\nthis.phaseScaleFields=phaseScaleFields;',familyFixture);
const babyRecord=familyFixture.phaseScaleFields('basket');
assert.equal(babyRecord.childBodyWidthScale,.29,'family newborn NPC receives independent width');
assert.equal(babyRecord.childBodyHeightScale,.38,'family newborn NPC receives independent height');
assert.equal(babyRecord.childBodyScale,.38,'old child body record retains vertical height');
const realChild=childFixture.childScaleFor({npcRecord:{isChild:true,...babyRecord}});
assert.equal(realChild.width,.29,'portrait builder uses family record width over child config default');
assert.equal(realChild.height,.38,'portrait builder uses family record height over child config default');
assert.equal(realChild.head,.55,'portrait builder uses family record head');
assert.match(scaleRuntime,/function childHeadFactorXFor\(/,'shared head compensation reuses per-child width factor');
assert.match(scaleRuntime,/horizontalChildHead \/ verticalChildHead/,'body width is canceled on head scale bone, without stretching head');
const oldChild=childFixture.childScaleFor({npcRecord:{isChild:true,childBodyScale:.4,childHeadScale:.66}});
assert.equal(oldChild.width,.51,'nonfamily child without a width inherits applied width default');
assert.equal(oldChild.height,.4,'old child record body still overrides height');
assert.equal(oldChild.head,.66,'old record head remains authoritative');
const wideTall = { x: 2, y: 2, legLength: 3, head: .8 }; // Nominal adult height 2.5 and width 2 relative to its own source rig.
const narrowShort = { x: .5, y: .5, legLength: .5, head: .8 };
const full = { width: .6, height: .4, head: .7, widthConvergence: 1, heightConvergence: 1 };
const wide = api.resolveStageAxes(wideTall, full);
const narrow = api.resolveStageAxes(narrowShort, full);
assert.equal(wide.width, .3); assert.equal(narrow.width, 1.2);
assert.ok(Math.abs(wide.height - .16) < 1e-12); assert.equal(narrow.height, .8);
assert.equal(api.composePreviewScale(wideTall, full).head, .8 * .7, 'convergence cannot change authored age head');
const zero = api.resolveStageAxes(wideTall, { ...full, widthConvergence: 0, heightConvergence: 0 });
assert.equal(zero.width, .6); assert.equal(zero.height, .4);
api.applyOnThisDevice({ baby: full, child: full });
assert.equal(png.childWidthConvergence, 1); assert.equal(png.childHeightConvergence, 1);
assert.equal(family.phaseScales.basket.widthConvergence, 1);
childFixture.window = { HobunjiCharacterAgeRigConfig: api, HobunjiCharacterRigScale: { scaleFor: () => wideTall } };
childFixture.avatarSpeciesAndGender = () => ({ species: 'test', gender: 'male' });
const actual = childFixture.childScaleFor({ npcRecord: { isChild: true } });
assert.equal(actual.width, wide.width); assert.equal(actual.height, wide.height);
assert.equal(actual.headFactorX * actual.width, full.head);
const restored=api.restoreRepositoryOnThisDevice();
assert.equal(restored.child.width,.5,'restoring game returns prior uniform child size');
assert.equal(png.childWidthScaleMultiplier,.5,'reset also clears applied child width');
assert.equal(family.phaseScales.basket.body,.32,'reset preserves historical baby size');
assert.equal(api.snapshot().applied,false,'reset removes the game-facing age override');
console.log('PASS age Width/Height in actual game: old body migration, family NPC records, PNG model axes, head ratios, explicit apply/reset');
