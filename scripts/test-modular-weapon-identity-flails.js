'use strict';
// Browser-independent behavioral tests for the Foundry's actual naming, tool-slot and flail resolvers.
const assert = require('node:assert/strict'); // Uses Node's built-in exact assertions.
const fs = require('node:fs'); // Loads shipped gameplay/editor code without a synthetic copy of the rules.
const vm = require('node:vm'); // Runs browser globals with no DOM or graphics driver.
const window = { RuntimeFrameScheduler: { register() {} } }; // Shared authoring registry and game module namespace.
const context = vm.createContext({ window }); // Persistent VM global across all live config/module evaluations.
const load = file => vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file }); // Exact repository entrypoints.
const plain = value => JSON.parse(JSON.stringify(value)); // Compares VM-owned objects in the host realm.

load('docs/config/weapon-sprite-assemblies.js');
load('docs/config/modular-weapons.js');
load('docs/js/modular-weapon-bridge-fill.js');
load('docs/js/modular-weapons.js');
const api = window.ModularWeapons; // Live Foundry resolver under test.
const config = api.getConfig(); // Shared, committed identities (not cosmetic hardcoded test data).
const metals = { nativeCopper: { label: 'Copper' } }; // Minimal forge metal needed for naming and slot registration.
const definitions = {}; // All generated equipment records are verified below.
const shapes = { fishingmace: { animStyle: 'sweep' }, harlyaoLongsword: { animStyle: 'sweep' },
  grappleFlail: { animStyle: 'sweep' }, warhammer: { animStyle: 'sweep' } }; // Test donor metadata is independent of naming.
const item = (shaft, head) => api.itemKey(shaft, head, 'nativeCopper'); // Saved ID must remain part-based and language-independent.

assert.equal(config.shafts['fishing-mace'].label, 'Bored Wrapped Handle');
assert.equal(config.heads['fishing-mace'].label, 'Barb-flanged Mace Head');
assert.equal(config.shafts['harlyao-longsword'].label, 'Tall Crescent Hilt');
assert.equal(config.heads['harlyao-longsword'].label, 'Harlyao-style Long-blade');
assert.equal(api.weaponName('fishing-mace', 'fishing-mace', 'Copper'), 'Copper Looped Fishing Mace');
assert.equal(api.weaponName('harlyao-longsword', 'harlyao-longsword', 'Copper'),
  'Copper Crescent-hilted Long-Hilted Slicer');
assert.equal(item('fishing-mace','warhammer'), 'modular:fishing-mace:warhammer:nativeCopper');
assert.deepEqual(plain(api.decode(item('fishing-mace','warhammer'))),
  { shaft: 'fishing-mace', head: 'warhammer', metal: 'nativeCopper' });

api.registerDefinitions(definitions, shapes, metals, ['nativeCopper']);
assert.equal(definitions[item('fishing-mace','fishing-mace')].label, 'Copper Looped Fishing Mace');
assert.equal(definitions[item('harlyao-longsword','harlyao-longsword')].label,
  'Copper Crescent-hilted Long-Hilted Slicer');
assert.deepEqual(plain(definitions[item('fishing-spear', 'hatchet')].slots), ['weapon','axe'],
  'only a tool-worthy handle with an axe-capable head grants the existing axe action and mastery events');
assert.deepEqual(plain(definitions[item('dagger','hatchet')].slots), ['weapon'],
  'the same head on a non-tool-worthy hilt must not become an axe');
assert.deepEqual(plain(definitions[item('fishing-spear','pickshovel-scoop')].slots), ['weapon','shovel'],
  'tool role originates with the selected head, not the shaft donor');
assert(config.heads.hoe.toolSlots.includes('hoe'),
  'a hoe head retains its crop-harvest mastery channel when its calibration is eventually approved');

const pickFlailKey=item('grapple-flail','pick-shovel-pick'); // This exact flexible pairing changes damage; the shared Pick Head remains sharp.
assert.equal(config.heads['pick-shovel-pick'].dmgType,'sharp','normal pick head stays sharp on every rigid shaft');
assert.equal(api.isDisallowed('grapple-flail','pick-shovel-pick'),false,'Pick Head can be forged on Grapple-Flail haft');
assert.equal(definitions[pickFlailKey].dmgType,'blunt','Grapple-Flail with Pick Head actually inflicts blunt damage');
assert.equal(api.weaponDamageType('grapple-flail','pick-shovel-pick'),'blunt');
assert.equal(api.weaponDamageType('fishing-spear','pick-shovel-pick'),'sharp',
  'a different pick-head weapon retains its usual sharp damage');
assert.equal(definitions[item('fishing-spear','pick-shovel-pick')].dmgType,'sharp',
  'pre-generated Foundry equipment definitions do not inherit the flail override');
const pickOnRope=api.flailRecipe('grapple-flail','pick-shovel-pick');
assert(pickOnRope?.flail,'newly approved pick pairing has a complete moving rope and head');
assert.equal(pickOnRope.flail.head.visualTransform.flipY,true,
  'user-authored flipY follows the hanging head in the real flail assembly');
assert.equal(pickOnRope.flail.chain.mountLengthPx,843.75,'head flips never change rope length');
for(const [key,field,value] of [
  ['pickshovel-scoop','scaleX',0.8],['plains-blade','scaleY',0.4],
  ['porakaneki-greatclub','scaleY',0.75]
]) assert.equal(api.flailRecipe('grapple-flail',key).flail.head.visualTransform[field],value,
  key+' authored nonuniform pair scale is used by the complete flail rig');
assert.deepEqual(plain(api.flailRecipe('grapple-flail','fishing-spear').flail.head.anchor),{x:209,y:925});
assert.deepEqual(plain(api.flailRecipe('grapple-flail','harlyao-broadsword').flail.head.anchor),{x:200,y:675});
const savedPick=plain(config); // Temporary saved draft probes validator without changing any shared head.
savedPick.shafts['grapple-flail'].overrides['pick-shovel-pick']={
  ...savedPick.shafts['grapple-flail'].overrides['pick-shovel-pick'],
  flipX:true,scaleX:1.25,scaleY:0.55,rotation:33,x:12,y:-18,flailHeadScale:1.2,dmgType:'blunt'
};
api.replace(savedPick);
const editedPick=api.flailRecipe('grapple-flail','pick-shovel-pick').flail.head;
assert.deepEqual(plain(editedPick.visualTransform),
  {scaleX:1.25,scaleY:0.55,flipX:true,flipY:true,x:12,y:-18,rotation:33},
  'ALL saved pair transforms reach the rendered hanging head, not just uniform scale');
assert.equal(editedPick.scale,1.2);
assert.equal(api.weaponDamageType('grapple-flail','pick-shovel-pick'),'blunt');
assert.deepEqual(plain(api.getConfig().heads['pick-shovel-pick'].mount),
  plain(config.heads['pick-shovel-pick'].mount),'flail authoring must not change shared rigid pick geometry');
api.replace(plain(config)); // Subsequent tests retain the committed catalog.


const authoredFlailShafts = { // Exact five shaft-side rope and aperture choices from the user's November 9 export.
  'fishing-mace':{start:[193,850],end:[0,325],offset:[0,20],size:[27,27]},
  'fishing-spear':{start:[210,830],end:[17,209],offset:[0,10],size:[22,22]},
  'warhammer':{start:[207,952],end:[14,275],offset:[0,0],size:[35,35]},
  'hatchet':{start:[198,1004],end:[5,479],offset:[0,20],size:[27,27]},
  'pick-shovel':{start:[198,803],end:[2.842170943040401e-14,150],offset:[0,0],size:[27,27]}
};
for (const [shaftKey, expected] of Object.entries(authoredFlailShafts)) {
  const shaft=config.shafts[shaftKey],rope=shaft.mounts.find(line=>line.type==='rope'),hole=shaft.bores[0];
  assert.deepEqual(plain([rope.start.x,rope.start.y]),expected.start,shaftKey+': uploaded rope origin');
  assert.deepEqual(plain([rope.end.x,rope.end.y]),expected.end,shaftKey+': uploaded rope tip');
  assert.deepEqual(plain([hole.offsetX,hole.offsetY]),expected.offset,shaftKey+': exact bore offset');
  assert.deepEqual(plain([hole.rx*2,hole.ry*2]),expected.size,shaftKey+': opening size');
  assert.equal(api.isDisallowed(shaftKey,'grapple-flail'),false,shaftKey+': chosen Grapple Hook haft stays allowed');
}
assert.equal(config.shafts.hatchet.mounts.find(line=>line.type==='eye').start.x,206,
  'artist adjusted the rope origin only; a shifted rigid hatchet sleeve must NOT leak into other weapons');
assert.equal(config.shafts['plains-sword'].mounts[0].type,'tang',
  'the Plains-sword keeps its canonical main-branch tang mount; old uploaded eye data is not imported');
assert.deepEqual(plain(config.heads['war-cleaver'].mount.start),{x:239,y:858},
  'the War-cleaver head rigid mounting arrow is restored from the reference');
assert.equal(Object.values(config.heads).some(head=>!head.flailAssembly&&head.flailHeadAnchor!==undefined),false,
  'old head-global flail pivot guesses have been retired; head rigs stay shared and untouched');
const original = plain(window.WEAPON_SPRITE_ASSEMBLY_CONFIG.weapons.grappleFlail); // The Tool Hub's source must not be mutated by derived weapons.
const shaftOwner = api.flailRecipe('grapple-flail','fishing-mace'); // Haft-owned rope replaces the authored head with the modular sprite.
assert(shaftOwner?.flail, 'rope-bearing shaft produces an actual flexible weapon assembly');
assert.equal(shaftOwner.flail.chain.type, 'rope');
assert.equal(shaftOwner.flail.chain.lengthPx, original.flail.chain.lengthPx);
assert.equal(shaftOwner.flail.chain.mountLengthPx, 843.75, 'new suspension line replaces only the rope reach');
assert.equal(shaftOwner.flail.chain.radiusPx, original.flail.chain.radiusPx, 'changing suspension length does not affect thickness');
assert.equal(shaftOwner.flail.chain.scaleX, original.flail.chain.scaleX, 'rope width multiplier stays authored');
assert.equal(shaftOwner.flail.head.scale, 1, 'hanging head size is independent of the rope line');
assert.equal(api.matchingMounts(config.shafts['grapple-flail'], config.heads['fishing-mace'])[0].type,'rope');
assert.equal(api.attachmentRig(config.shafts['grapple-flail'],config.heads['fishing-mace'],api.settings('grapple-flail','fishing-mace')).children[0].children.length,0,
  'a rope mount is never used as an automatic rigid-head fitting/scaling axis');
assert.equal(shaftOwner.flail.head.layers.length, 1);
assert.equal(shaftOwner.flail.head.layers[0].sprite, config.heads['fishing-mace'].sprite);
assert.equal(shaftOwner.flail.head.anchorLayer, 'modular-head');
assert.deepEqual(plain(shaftOwner.flail.head.anchor), plain(config.heads['fishing-mace'].mount.end),
  'shaft-owned flail hangs a sleeve head at its original END without changing the rigid head arrow');
assert.equal(shaftOwner.flail.head.anchorSpace, 'layer',
  'head contact is authored in the 450x1204 head sprite coordinates in both the preview and Three.js runtime');
assert.deepEqual(plain(api.flailRecipe('grapple-flail','dagger').flail.head.anchor),
  plain(config.heads.dagger.mount.start), 'tanged heads hang from their original START, not their tip');
assert.deepEqual(plain(api.flailRecipe('grapple-flail','war-cleaver').flail.head.anchor),
  plain(config.heads['war-cleaver'].mount.start), 'straight cleaver uses its actual rig start, not a stale global flailHeadAnchor');
assert.equal(shaftOwner.sprite, config.shafts['grapple-flail'].sprite);
const headOwner = api.flailRecipe('fishing-mace', 'grapple-flail'); // Head-owned rope reattaches original multilayer head to a different shaft.
assert(headOwner?.flail);
assert.equal(headOwner.flail.head.layers.length, original.flail.head.layers.length,
  'a multi-layer flexible head retains its full authored back/front render ordering');
assert.deepEqual(plain(headOwner.flail.haftAnchor), plain(config.shafts['fishing-mace'].mounts.find(m => m.type === 'rope').start),
  'head-owned flail follows the exact uploaded Bored Wrapped Handle rope mount, not its tang/eye arrows');
assert.deepEqual(plain(headOwner.flail.head.anchor), plain(original.flail.head.anchor),
  'original multi-sprite head contact is never replaced by a modular head arrow');
assert.equal(headOwner.sprite, config.shafts['fishing-mace'].sprite);
assert(Math.abs(headOwner.flail.chain.mountLengthPx - Math.hypot(193,525)) < 1e-8,
  'the uploaded Fishing Mace rope line changes connector reach, not connector width or the head');
assert.deepEqual(plain(api.matchingMounts(config.shafts['fishing-mace'],config.heads['grapple-flail'])[0].start),
  {x:193,y:850}, 'head-owned flail uses the precise authored mount point on the Fishing Mace');
assert.equal(api.flailGuide('fishing-mace','grapple-flail').explicitMount,true,
  'the uploaded handle has an explicit visible connector line');
const unmappedFlail = api.flailRecipe('dagger','grapple-flail'); // Preserve old inherited-author fallback when no rope mount is present.
assert.deepEqual(plain(unmappedFlail.flail.haftAnchor),plain(original.flail.haftAnchor));
assert.equal(api.flailGuide('dagger','grapple-flail').explicitMount,false);
assert.equal(api.flailGuide('grapple-flail','fishing-mace').explicitMount,true);
assert.equal(api.flailGuide('grapple-flail','warhammer').length,843.75,
  'the visible guide ends at the same connector reach as the 3D rope');
assert.deepEqual(plain(window.WEAPON_SPRITE_ASSEMBLY_CONFIG.weapons.grappleFlail), original,
  'derived modular flails never overwrite the Tool Hub source recipe');
assert.equal(api.isDisallowed('grapple-flail', 'warhammer'), true, 'hammer-shaped heads cannot hang from the grapple shaft');
assert.equal(api.isDisallowed('dagger', 'grapple-flail'), true, 'grapple hook is restricted to five explicitly authored hafts');
assert.equal(api.isDisallowed('grapple-flail', 'grapple-flail'), true,
  'two rope-owning pieces cannot produce two overlapping pendulums');
assert.equal(api.flailRecipe('grapple-flail', 'grapple-flail'), null);
assert.equal(config.heads.dagger.weaponNames.prefix,'Gutter','uploaded head prefix/suffix forms are swapped');
assert.equal(config.heads.dagger.weaponNames.suffix,'Arrow-tipped');
assert.equal(config.shafts['fishing-spear'].nameAffix,'Leather-wrapped Pole-','uploaded naming fields are retained without importing geometry');

assert(definitions[item('grapple-flail','fishing-mace')].weaponAssembly?.flail,
  'real equipment definition hands the multi-sprite runtime a dynamic head/rope assembly');
assert(definitions[item('fishing-mace','grapple-flail')].weaponAssembly?.flail,
  'head-authored flexible assemblies reach the exact same renderer');
assert.equal(definitions[item('fishing-mace','warhammer')].weaponAssembly, undefined,
  'ordinary rigid modular weapons keep their prior baked sprite route');
const pairAuthoring = plain(config); // Only the selected flail-shaft pair may adjust this particular hanging head.
pairAuthoring.shafts['grapple-flail'].overrides['fishing-mace'].flailHeadAnchor={x:199,y:911};
pairAuthoring.shafts['grapple-flail'].overrides['fishing-mace'].flailHeadScale=1.35;
api.replace(pairAuthoring);
assert.deepEqual(plain(api.flailRecipe('grapple-flail','fishing-mace').flail.head.anchor),{x:199,y:911},
  'pair-only contact survives validation and drives the actual rendered flail head');
assert.equal(api.flailRecipe('grapple-flail','fishing-mace').flail.head.scale,1.35,
  'head scale is unique to a selected flail-shaft pairing');
assert.deepEqual(plain(api.getConfig().heads['fishing-mace'].mount),plain(config.heads['fishing-mace'].mount),
  'editing flail contact never changes the original rigid head mounting line');
assert.equal(api.flailRecipe('fishing-mace','grapple-flail').flail.head.anchorSpace, original.flail.head.anchorSpace,
  'the unrelated head-owned original Grapple Hook retains its Tool Hub anchor');
api.replace(plain(config)); // Restore committed fixture before exercising independent import migrations.

const originalMounts = plain(config.shafts['fishing-mace'].mounts); // Historical fitted-head geometry must not be replaced by a user's unrelated local draft.
const editable = plain(config); // Author edits and imported draft sanitation exercise the real replace() migration path.
editable.heads.warhammer.weaponNames = { prefix: 'Mallet Head', suffix: 'Hammer End' };
editable.heads.warhammer.toolSlots = ['axe', 'weapon', 'unknown', 'axe'];
editable.shafts.dagger.namePosition = 'suffix';
editable.shafts.dagger.nameAffix = 'on a dagger grip';
editable.shafts.dagger.toolWorthy = true;
editable.shafts['grapple-flail'].flailAssembly = null;
editable.heads['grapple-flail'].mount = { type:'weight',start:{x:77,y:81},end:{x:77,y:31} };
editable.heads['grapple-flail'].flailHeadAnchor = {x:400,y:1000}; // Legacy modular fields must have NO effect on the author's head attachment.
editable.shafts['fishing-mace'].bores = [
  {id:'bore-1',x:225,y:602,rx:12,ry:16,rotation:20,rim:5,warp:2,shade:0.75,lightX:-.6,lightY:-.8,enabled:true}
];
api.replace(editable);
assert.equal(api.weaponName('dagger','warhammer','Copper'), 'Copper Hammer End on a dagger grip');
assert.deepEqual(plain(api.getConfig().heads.warhammer.toolSlots), ['axe']);
assert.equal(api.getConfig().shafts['fishing-mace'].bores[0].rx, 12, 'bore geometry survives the shared editor draft validator');
assert.deepEqual(plain(api.flailRecipe('fishing-mace','grapple-flail').flail.head.anchor),
  plain(original.flail.head.anchor), 'modular arrow edits and old flailHeadAnchor values cannot move the authored flail head');
assert.deepEqual(plain(api.flailRecipe('fishing-mace','grapple-flail').flail.haftAnchor),
  {x:193,y:850}, 'moving the modular head arrow cannot change the shaft-side authored rope mount');
assert.deepEqual(plain(api.resolvedBores(api.getConfig().shafts['fishing-mace'],api.getConfig().heads['grapple-flail'])
  .map(({x,y})=>({x,y}))), [{x:225,y:602}], 'old absolute bore centers migrate to connector-relative offsets without moving');
assert.equal(api.resolvedBores(api.getConfig().shafts['fishing-mace'],api.getConfig().heads.warhammer).length,0,
  'switching away from a flail head completely removes shaft bores from preview and gameplay');
assert.equal(api.cleanBores([{id:'fresh'}])[0].offsetX,0);
assert.equal(api.cleanBores([{id:'fresh'}])[0].offsetY,0);
assert.equal(api.cleanBores([{id:'fresh'}])[0].rx*2,20,'new bores are 20 pixels wide, not 40');
assert.equal(api.cleanBores([{id:'fresh'}])[0].ry*2,20,'new bores are 20 pixels tall, not 40');
assert.equal(api.cleanBores([{id:'fresh'}])[0].outline,3,'interior ink is automatically generated');
assert.deepEqual(plain(api.getConfig().shafts['fishing-mace'].mounts), originalMounts, 'bore and name edits do not modify original mounting geometry');
assert.equal(api.getConfig().shafts['grapple-flail'].flailAssembly, null,
  'author can remove an existing rope reference and return to rigid weapon behavior');
api.registerDefinitions(definitions, shapes, metals, ['nativeCopper']);
assert.deepEqual(plain(definitions[item('dagger','warhammer')].slots), ['weapon','axe']);
const oldDraft = plain(window.MODULAR_WEAPON_CONFIG); // Old browser drafts predate the new name and role metadata.
delete oldDraft.heads['fishing-mace'].weaponNames;
oldDraft.heads['fishing-mace'].label = 'Fishing Mace'; // Historical weapon label must not overwrite a newly published part label.
delete oldDraft.shafts['fishing-mace'].namePosition;
oldDraft.shafts['fishing-mace'].label = 'Fishing Mace';
api.replace(oldDraft);
assert.equal(api.getConfig().heads['fishing-mace'].label, 'Barb-flanged Mace Head');
assert.equal(api.getConfig().shafts['fishing-mace'].label, 'Bored Wrapped Handle');

// Source-art transforms and independently movable rig regions must all point to ONE actual connector.
const rigged = plain(window.MODULAR_WEAPON_CONFIG); // Use a new editable draft, leaving committed mount geometry untouched.
const riggedShaft = rigged.shafts['fishing-mace'];
riggedShaft.mounts=riggedShaft.mounts.filter(mount=>mount.type!=='rope'); // Replace the authored rope, never accumulate a second primary mount.
riggedShaft.mounts.push({ type:'rope',start:{x:210,y:900},end:{x:210,y:600} });
riggedShaft.attachmentRigTransform={scaleX:1,scaleY:1,x:15,y:25};
riggedShaft.shaftArtTransform={enabled:true,scaleX:2,scaleY:2,x:0,y:0};
riggedShaft.bores=[{id:'bore-1',offsetX:0,offsetY:0,rx:10,ry:10,outline:3,rim:5,warp:1.5,
  shade:.65,rotation:0,lightX:-.6,lightY:-.8,enabled:true}];
api.replace(rigged);
const shaftWithRig = api.getConfig().shafts['fishing-mace'];
const flexibleHead = api.getConfig().heads['grapple-flail'];
const realRope = api.flailRecipe('fishing-mace','grapple-flail');
const [relativeBore] = api.resolvedBores(shaftWithRig, flexibleHead);
const sourceGuide = api.flailGuide('fishing-mace','grapple-flail');
const renderedBore = api.duplicatePoint(relativeBore,api.shaftArtTransform(shaftWithRig));
const renderedGuide = api.duplicatePoint(sourceGuide.start,api.shaftArtTransform(shaftWithRig));
assert.deepEqual(plain(realRope.flail.haftAnchor), {x:225,y:925},
  'rig translations move the runtime rope from the original shaft point');
assert.deepEqual(plain(renderedBore),plain(realRope.flail.haftAnchor),
  'shaft-art scaling cannot detach the bored hole from its physical rope point');
assert.deepEqual(plain(renderedGuide),plain(realRope.flail.haftAnchor),
  'the visible connector guide and runtime contact remain coincident');
assert.equal(realRope.flail.chain.mountLengthPx,300,
  'only the connector reach inherits the rig transform, not the head scale');
assert.equal(realRope.flail.head.scale,1);
assert.equal(realRope.flail.chain.radiusPx,original.flail.chain.radiusPx);
assert.equal(api.resolvedBores(shaftWithRig,api.getConfig().heads.warhammer).length,0);
api.replace(plain(window.MODULAR_WEAPON_CONFIG)); // Do not leak this temporary authoring draft into later assertions.

// Existing brush helper applies live bores to fresh source pixels without accumulating damage.
const pixels = new Uint8ClampedArray(32*32*4); // Representative opaque wooden material tests shade and transparency together.
for(let i=0;i<32*32;i++){ pixels[i*4]=170;pixels[i*4+1]=150;pixels[i*4+2]=125;pixels[i*4+3]=255; }
const bore={id:'b',x:12,y:12,rx:5,ry:5,rotation:0,rim:3,outline:3,warp:1.5,shade:.8,lightX:-.6,lightY:-.8,enabled:true};
const fill=window.ModularWeaponBridgeFill; // Same pixel helper used by the existing manual bridge/smudge processing.
const cut=fill.borePixels(pixels,32,32,[bore]); // First position drills a transparent center with shaded nearby wood.
const moved=fill.borePixels(pixels,32,32,[{...bore,x:22,y:22}]); // Recalculate from original; previous hole must be fully recovered.
const alpha=(arr,x,y)=>arr[(y*32+x)*4+3];
assert.equal(alpha(cut,12,12),0);
assert.equal(alpha(moved,12,12),255,'moving a bore does not leave a permanent old cutout');
assert.equal(alpha(moved,22,22),0);
assert.equal(alpha(pixels,12,12),255,'source sprite remains pristine');
assert.equal(cut[(12*32+18)*4],0,'interior border draws the same opaque black ink as the shaft/head outline author');
assert.equal(alpha(cut,18,12),255,'the black interior outline stays ON the material; the bore center remains transparent');
assert.equal(cut[0],pixels[0], 'distant unmodified pixel is preserved');
const gameHtml = fs.readFileSync('docs/index.html', 'utf8'); // Check the runtime and modular authoring tool use the same cache-revisioned catalog.
const editorHtml = fs.readFileSync('docs/tools/modular-weapon-editor/index.html', 'utf8');
for (const id of ['head-part-label','head-name-prefix','head-name-suffix','head-tool-slots','shaft-tool-worthy',
  'shaft-name-affix','shaft-name-position','head-flail-assembly','shaft-flail-assembly','head-rope-x','head-rope-y',
  'bore-add','bore-remove','bore-drag','bore-list','bore-outline','flail-preview','mount-kind'])
  assert(editorHtml.includes('id="' + id + '"'), 'The editable modular part field must exist: ' + id);
const gameToken = gameHtml.split('config/modular-weapons.js?v=')[1]?.split('"')[0];
const editorToken = editorHtml.split('config/modular-weapons.js?v=')[1]?.split('"')[0];
assert.equal(editorToken, gameToken, 'Game and editor must share the same committed modular catalog version');
const runtimeSource = fs.readFileSync('docs/js/modular-weapons.js', 'utf8');
assert(runtimeSource.includes('if (flail) paintHaft();'),
  'moving modular flail heads must never be burned into the rigid weapon base texture');
console.log('Modular part names, tool slots, flail ownership and draft migration passed.');
