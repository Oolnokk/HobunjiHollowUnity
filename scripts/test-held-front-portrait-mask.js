// The real compositor's player/NPC portrait stencil owner behavior, with a minimal renderer.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync('docs/js/held-object-render-order.js','utf8');

function section(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'production helper section exists: ' + start);
  return source.slice(a,b);
}
const production = [
  section('  function isFrontPortraitMesh(', '  const portraitSortPoint = '),
  section('  function assignPortraitStencilOwners(', '  function isLegacyHeldPlane('),
  section('  function getSurfaceOcclusionDepthOnly(', '  function prepareNonGroundDepthMaterials('),
  section('  function prepareFrontPortraitStencilMaterials(', '  function prepareSubmergedOverlayStencilMaterials('),
  section('  function prepareSubmergedOverlayStencilMaterials(', '  function prepareOverlayCoverTintMaterials('),
  section('  function isDescendantOf(', '  function worldYOf('),
  section('  function actorRootForXrayMesh(', '  function actorXrayScope('),
].join('\n');
const THREE = { LessEqualDepth: 1, AlwaysStencilFunc: 2, NotEqualStencilFunc: 3,
  KeepStencilOp: 4, ReplaceStencilOp: 5, Matrix4: class {}, Vector3: class {} }; // Fake GL constants verify equal/not-equal and write masks; math stand-ins for module-scope scratch objects.
const scene = { isScene: true, name: 'world' }; // Owner lookup stops before the active scene.
const root = (name,parent=scene,tag={}) => ({ name, parent, userData:tag }); // Shared player/NPC hierarchy matching production actor roots.
const player = root('player_avatar');
const playerHands = root('player_hands',scene);
const npc = root('npc_walker_fisher');
const npcRig = root('npc_rig',npc,{ hobunjiCharacterRigScaleRoot:true });
const bandit = root('bandit_avatar_group');
const banditHands = root('bandit_hands_pivot',bandit,{hobunjiCharacterRigScaleRoot:true});
const banditWorldHolder = root('banditToolHolder',scene,{hobunjiHeldPortraitOwner:bandit}); // Hostile held gear is a scene sibling in real combat-bandit.js.
const otherNpc = root('npc_walker_unarmed');
const windowObject = { HobunjiSpritePngSurface: { maskAlphaTest:()=>0.35 },
  PlayerBodyTransformComposer: {getPlayerMesh:()=>player,getVisualRoots:()=>[playerHands]} };
const observations = []; // Snapshots only during actual mask draw.
let failRender = false; // Simulates WebGL exceptions to verify state restoration.
const runtime = new Function('THREE','window','rawRender',[
  'const PNG_OCCLUDER_LAYER=4, FRONT_PORTRAIT_STENCIL_MASK=0xFC, FRONT_PORTRAIT_MAX_OWNERS=63, FRONT_PORTRAIT_MASK=1<<24;',
  'const surfaceComposer=null;',
  'const withPortraitDrawOrder=(_r,_order,draw)=>draw();',
  'const hasLayer=(o,layer)=>!!(o.layers.mask & (1<<layer));',
  'const forEachMaterial=(materials,fn)=>{for(const m of Array.isArray(materials)?materials:[materials])if(m)fn(m);};',
  'let frontPortraitMaskPassCount=0;',production,
  'return {isFrontPortraitMesh,isPortraitMaskedGear,portraitStencilOwner,assignPortraitStencilOwners,',
  'prepareFrontPortraitStencilMaterials,stampFrontPortraitStencil,preparePortraitGearStencilMaterials,',
  'prepareSubmergedOverlayStencilMaterials,restoreMaterialStates, getCount:()=>frontPortraitMaskPassCount};',
].join('\n'))(THREE,windowObject,function(_scene,camera){
  observations.push({mask:camera.layers.mask,playerRef:playerFront.stencilRef,npcRef:npcFront.stencilRef,
    playerDraw:playerFront.stencilWrite,playerAlpha:playerFront.alphaTest,npcDraw:npcFront.stencilWrite,
    playerDepth:playerFront.depthWrite,rearDraw:playerRear.stencilWrite});
  if(failRender)throw new Error('simulated draw failure');
});
function mat(name) {
  return {name, map:{}, colorWrite:true, depthWrite:false, depthTest:false, depthFunc:77,
    alphaTest:0.04, stencilWrite:false, stencilWriteMask:0xff, stencilFunc:99, stencilRef:6,
    stencilFuncMask:0xff, stencilFail:88, stencilZFail:88, stencilZPass:88};
}
function mesh(name,material,parent,extra={}) {
  return {name,material,parent,isMesh:true,isSkinnedMesh:!!extra.skinned,
    userData:{...extra.tags},layers:{mask:1<<4 | 1<<24}};
}
const playerFront=mat('npc_avatar_skinned_front_material');
const playerRear=mat('npc_avatar_skinned_back_material');
const playerPortrait=mesh('skinned_player',[playerFront,playerRear],player,{skinned:true});
const playerWeapon=mesh('player_tool',mat('sword'),playerHands,{tags:{hobunjiHeldObjectPlane:true}});
const npcFront=mat('npc_avatar_front_material');
const npcPortrait=mesh('npc_avatar_front_plane',npcFront,npcRig);
const npcWorldHolder = root('npc_watchman_holder',scene,{hobunjiHeldPortraitOwner:npc}); // Real watchman tools live beside, not below, walker.root.
const npcWeapon=mesh('npc_tool',mat('axe'),npcWorldHolder,{tags:{hobunjiHeldObjectPlane:true}});
const stationWorldHolder = root('npc_station_holder',scene,{hobunjiHeldPortraitOwner:npc}); // Some civilian station tools are also scene siblings.
const stationWeapon=mesh('npc_station_tool',mat('hoe'),stationWorldHolder,{tags:{hobunjiHeldObjectPlane:true}});
const unarmedPortrait=mesh('npc_avatar_front_plane',mat('npc_unarmed'),otherNpc);
const banditPortrait=mesh('npc_avatar_front_plane',mat('bandit_front'),bandit);
const banditWeapon=mesh('bandit_tool',mat('bandit_weapon'),banditWorldHolder,{tags:{hobunjiHeldObjectPlane:true}});
assert.equal(runtime.isFrontPortraitMesh(playerPortrait),true,'skinned player front recognized');
assert.equal(runtime.isFrontPortraitMesh(npcPortrait),true,'rigid NPC front recognized');
assert.equal(runtime.isFrontPortraitMesh(banditPortrait),true,'enemy front recognized');
assert.equal(runtime.isFrontPortraitMesh(mesh('npc_avatar_back_plane',mat('rear'),npc)),false,'rear plane is not a mask');

assert.equal(runtime.portraitStencilOwner(playerWeapon,scene),player,'external player hand roots resolve to the player');
assert.equal(runtime.portraitStencilOwner(playerPortrait,scene),player,'player portrait has same owner');
assert.equal(runtime.portraitStencilOwner(npcPortrait,scene),npc,'NPC nested rig resolves to walker, not inner scale pivot');
assert.equal(runtime.portraitStencilOwner(npcWeapon,scene),npc,'NPC tool matches NPC portrait');
assert.equal(runtime.portraitStencilOwner(banditPortrait,scene),bandit,'enemy front resolves to bandit avatar');
assert.equal(runtime.portraitStencilOwner(banditWeapon,scene),bandit,'scene-sibling enemy weapon resolves to its tagged avatar');

const assigned=runtime.assignPortraitStencilOwners(
  [playerWeapon,npcWeapon,banditWeapon,stationWeapon],[playerPortrait,npcPortrait,unarmedPortrait,banditPortrait],scene);
assert.equal(assigned.ownerIds.size,3,'three owners are assigned distinct IDs');
assert.equal(assigned.portraits.length,3,'unarmed NPCs do not stamp unrelated weapon silhouettes');
assert.equal(assigned.gearIds.get(playerWeapon),assigned.ownerIds.get(player),'player weapon has the player portrait ID');
assert.equal(assigned.gearIds.get(npcWeapon),assigned.ownerIds.get(npc),'NPC weapon has NPC portrait ID');
assert.equal(assigned.gearIds.get(stationWeapon),assigned.ownerIds.get(npc),'NPC station tool shares its walker portrait ID');
assert.equal(assigned.gearIds.get(banditWeapon),assigned.ownerIds.get(bandit),'bandit weapon has bandit portrait ID');
assert.ok(assigned.gearIds.get(playerWeapon)!==assigned.gearIds.get(npcWeapon),'unrelated actors never share stencil IDs');

const playerOrig={...playerFront},rearOrig={...playerRear},npcOrig={...npcFront};
const states=runtime.prepareFrontPortraitStencilMaterials(assigned.portraits,assigned.ownerIds,scene);
assert.equal(playerFront.stencilWrite,true,'front draws stencil');
assert.equal(playerRear.stencilWrite,false,'rear cannot stamp front silhouette');
assert.equal(playerFront.stencilRef,assigned.ownerIds.get(player)<<2,'player stencil records owner ID');
assert.equal(npcFront.stencilRef,assigned.ownerIds.get(npc)<<2,'NPC stencil records DIFFERENT owner ID');
assert.equal(playerFront.stencilWriteMask,0xFC,'water-tint stencil bit remains untouched');
assert.equal(playerFront.colorWrite,false,'stencil mask does not draw portrait color');
assert.equal(playerFront.depthWrite,false,'stencil mask does not rewrite world depth');
assert.equal(playerFront.depthFunc,THREE.LessEqualDepth,'portrait mask respects foreground geometry');
assert.equal(playerFront.alphaTest,0.35,'portrait cutout uses solid alpha');
runtime.restoreMaterialStates(states);
for(const [material, original] of [[playerFront,playerOrig],[playerRear,rearOrig],[npcFront,npcOrig]]) {
  for(const field of ['colorWrite','depthWrite','depthTest','depthFunc','alphaTest','stencilWrite','stencilWriteMask','stencilFunc','stencilRef','stencilFuncMask','stencilFail','stencilZFail','stencilZPass'])
    assert.equal(material[field],original[field],'restored material field '+field);
}
const camera={layers:{mask:1}};
runtime.stampFrontPortraitStencil({},scene,camera,assigned.portraits,assigned.ownerIds);
assert.equal(observations[0].mask,1<<24,'only private portrait layer is drawn');
assert.equal(observations[0].playerRef,assigned.ownerIds.get(player)<<2,'player ID is live during draw');
assert.equal(observations[0].npcRef,assigned.ownerIds.get(npc)<<2,'NPC ID is live during draw');
assert.equal(observations[0].rearDraw,false,'back material is excluded during mask');
assert.equal(observations[0].playerAlpha,0.35,'no faint alpha fringe stamped');
assert.equal(camera.layers.mask,1,'camera layer mask is restored');
assert.equal(runtime.getCount(),1,'one mask pass for three different actors');
failRender=true;
assert.throws(()=>runtime.stampFrontPortraitStencil({},scene,camera,assigned.portraits,assigned.ownerIds),/simulated draw failure/);
assert.equal(camera.layers.mask,1,'camera restored on exception');
assert.equal(playerFront.stencilWrite,false,'material restored on exception');
failRender=false;

const hand=mesh('hand',mat('hand'),playerHands,{tags:{hobunjiHeldObjectPlane:true,hobunjiProceduralHand:true}});
const foot=mesh('foot',mat('foot'),playerHands,{tags:{hobunjiHeldObjectPlane:true,hobunjiProceduralFoot:true}});
const cask=mesh('cask',mat('physical'),player,{tags:{}});
assert.equal(runtime.isPortraitMaskedGear(hand),false,'procedural hands are unmasked unless the hand rule selects them this frame');
assert.equal(runtime.isPortraitMaskedGear(foot),false,'procedural feet are unmasked');
assert.equal(runtime.isPortraitMaskedGear(cask),false,'physical carryables are unmasked');
let state=runtime.preparePortraitGearStencilMaterials([playerWeapon,npcWeapon,hand,foot,cask],assigned.gearIds);
assert.equal(playerWeapon.material.stencilFunc,THREE.NotEqualStencilFunc,'weapon draws everywhere except own portrait');
assert.equal(playerWeapon.material.stencilFuncMask,0xFC,'comparison uses owner bits only');
assert.equal(playerWeapon.material.stencilRef,assigned.gearIds.get(playerWeapon)<<2,'weapon tests OWN portrait ID');
assert.equal(playerWeapon.material.stencilWriteMask,0,'dry weapon writes no stencil');
assert.equal(hand.material.stencilWrite,false,'hand stencil remains unchanged');
assert.equal(foot.material.stencilWrite,false,'foot stencil remains unchanged');
// Simulate packed stencil comparisons: 0 and unrelated-owner portrait pixels draw; own-portrait pixels do not.
const allows=(material,pixelId)=>((pixelId<<2)&material.stencilFuncMask)!==(material.stencilRef&material.stencilFuncMask);
assert.equal(allows(playerWeapon.material,0),true,'clear background allows weapon');
assert.equal(allows(playerWeapon.material,assigned.ownerIds.get(npc)),true,'player weapon stays visible over OTHER NPC portrait');
assert.equal(allows(playerWeapon.material,assigned.ownerIds.get(player)),false,'player weapon is covered by its OWN portrait');
assert.equal(allows(npcWeapon.material,assigned.ownerIds.get(player)),true,'NPC weapon stays visible over player when in front');
assert.equal(allows(npcWeapon.material,assigned.ownerIds.get(npc)),false,'NPC weapon is covered by its own front art');
runtime.restoreMaterialStates(state);
assert.equal(playerWeapon.material.stencilFunc,99,'dry weapon material restored');

state=runtime.prepareSubmergedOverlayStencilMaterials([playerWeapon,npcWeapon,hand],1,assigned.gearIds);
assert.equal(playerWeapon.material.stencilFunc,THREE.NotEqualStencilFunc,'wet weapon tests own portrait');
assert.equal(playerWeapon.material.stencilRef,(assigned.ownerIds.get(player)<<2)|1,'wet owner and water-tint value are combined');
assert.equal(playerWeapon.material.stencilWriteMask,1,'water bit 0 is still written');
assert.equal(hand.material.stencilFunc,THREE.AlwaysStencilFunc,'wet hands retain original stencil semantics');
runtime.restoreMaterialStates(state);
state=runtime.prepareSubmergedOverlayStencilMaterials([playerWeapon],0,null);
assert.equal(playerWeapon.material.stencilFunc,THREE.AlwaysStencilFunc,'zero stencil support falls back to old water behavior');
runtime.restoreMaterialStates(state);

const overflowMeshes=[],overflowPortraits=[];
for(let i=0;i<65;i++){
  const actor=root('npc_walker_extra_'+i);
  overflowMeshes.push(mesh('blade_'+i,mat('weapon'+i),actor,{tags:{hobunjiHeldObjectPlane:true}}));
  overflowPortraits.push(mesh('npc_avatar_front_plane',mat('front'+i),actor));
}
const overflow=runtime.assignPortraitStencilOwners(overflowMeshes,overflowPortraits,scene);
assert.equal(overflow.ownerIds.size,63,'8-bit stencil owner allocation is capped');
assert.equal(overflow.portraits.length,63,'excess portraits are excluded instead of sharing wrong IDs');
assert.equal(overflow.gearIds.size,63,'excess weapons safely retain original rendering without accidental NPC masking');

// Execute the actual Three sort transaction with opposite plane-center depths.
const portraitOrder = new Function('THREE', 'forEachMaterial', 'xrayRule', 'window', 'isPresentationBackdrop', 'surfaceKindForObject', [
  section('  const portraitSortPoint = ', '  function assignPortraitStencilOwners('),
  'return { comparePortraitDraws, withPortraitDrawOrder };',
].join('\n'))({ Vector3: class {} }, (material, fn) => fn(material),
  () => 'off', {}, () => false, () => 'solid'); // Native portrait order stays unchanged unless the Dev Companion explicitly enables manual ranks.
const fogged = { depthWrite: true }, nearby = { depthWrite: true };
const npcDraw = { object: { material: fogged }, groupOrder: 0, renderOrder: 2, z: .1, id: 30 };
const playerDraw = { object: { material: nearby }, groupOrder: 0, renderOrder: 4, z: .8, id: 31 };
const npcRank = { owner: { id: 1 }, depth: .7 }, playerRank = { owner: { id: 2 }, depth: .3 };
const ranks = new Map([[npcDraw.object, npcRank], [playerDraw.object, playerRank]]);
let sort = null;
const renderer = { setTransparentSort(fn) { sort = fn; } };
portraitOrder.withPortraitDrawOrder(renderer, { ranks, nearest: playerRank }, () => {
  assert.deepEqual([playerDraw,npcDraw].sort(sort), [npcDraw,playerDraw], 'actor depth wins over crossed NPC/player plane center depth and front/back draw order');
  assert.equal(fogged.depthWrite, false, 'a farther NPC cannot punch through closer player pixels by writing real plane depth first');
  assert.equal(nearby.depthWrite, true, 'the closest portrait still contributes normal depth');
}, true);
assert.equal(sort, null);
assert.equal(fogged.depthWrite, true);
assert.throws(() => portraitOrder.withPortraitDrawOrder(renderer, { ranks, nearest: npcRank }, () => {
  assert.deepEqual([playerDraw,npcDraw].sort(sort), [npcDraw,playerDraw]);
  throw Error('interrupted portrait draw');
}, true), /interrupted portrait draw/);
assert.equal(sort, null);
assert.equal(nearby.depthWrite, true);

// Worn pants (renderOrder 28) sort with their wearer: a farther actor's garment must draw before a nearer actor's
// portrait instead of after every portrait, where it would show through any actor with no depth of its own.
{
  const farRank = { owner: { id: 5 }, depth: .9, close: false }, midRank = { owner: { id: 2 }, depth: .5, close: true }, nearRank = { owner: { id: 3 }, depth: .2, close: true };
  const farPortrait = { object: { material: { depthWrite: true } }, groupOrder: 0, renderOrder: 2, z: .9, id: 40 };
  const farPants = { object: { material: { depthWrite: true } }, groupOrder: 0, renderOrder: 28, z: .9, id: 41 };
  const playerFront = { object: { material: { depthWrite: true } }, groupOrder: 0, renderOrder: 2, z: .5, id: 42 };
  const nearPortrait = { object: { material: { depthWrite: true } }, groupOrder: 0, renderOrder: 2, z: .2, id: 43 };
  const playerPants = { object: { material: { depthWrite: true } }, groupOrder: 0, renderOrder: 28, z: .5, id: 44 };
  const ranks3 = new Map([[farPortrait.object, farRank], [playerFront.object, midRank], [nearPortrait.object, nearRank]]);
  const extras = new Map([[farPants.object, farRank], [playerPants.object, midRank]]);
  const sorted = [playerPants, nearPortrait, farPants, playerFront, farPortrait].sort((a, b) => portraitOrder.comparePortraitDraws(a, b, ranks3, extras));
  assert.deepEqual(sorted.map(d => d.id), [40, 41, 42, 44, 43], 'actors draw far to near; each actor\'s pants follow its own portrait');
  let sort3 = null;
  portraitOrder.withPortraitDrawOrder({ setTransparentSort(fn) { sort3 = fn; } }, { ranks: ranks3, extras, nearest: nearRank }, () => {
    assert.equal(farPortrait.object.material.depthWrite, true, 'actors outside the crossing radius keep their normal depth write');
    assert.equal(playerFront.object.material.depthWrite, false, 'a close non-nearest portrait still defers its depth write');
    assert.equal(farPants.object.material.depthWrite, true, 'garments are ordered, never depth-deferred');
  }, true);
  assert.ok(/extras\.set\(mesh, rank\)/.test(source) && /PantsGarmentRenderer\?\.liveHandles/.test(source), 'real render path ranks worn pants with their actor');
}

assert.ok(source.includes('portraitGearIds = portraitMask.gearIds'),'overlay receives actual per-owner gear lookup');
assert.ok(source.includes('stampFrontPortraitStencil(renderer, scene, camera, portraitMask.portraits, portraitMask.ownerIds, portraitOrder)'),'mask is invoked from real render path');
assert.ok(source.includes('frontPortraitRegistry.add(object)'),'front portraits are registered automatically');
assert.match(fs.readFileSync('docs/js/combat/combat-bandit.js','utf8'),/holder\.userData\.hobunjiHeldPortraitOwner = avatarRef\.group/,'all hostile melee/ranged/flask holders receive their owner tag');
assert.match(fs.readFileSync('docs/js/npc-held-equipment-v4.js','utf8'),/hobunjiHeldPortraitOwner: state\.walker\.root/,'watchman scene-sibling holder receives its owner tag');
assert.match(fs.readFileSync('docs/js/npc-held-equipment-v4.js','utf8'),/walker\.stationToolMesh\.userData\.hobunjiHeldPortraitOwner = walker\.root/,'station tool receives its own walker owner tag');

console.log('Held front-portrait owner stencil regression: PASS');
