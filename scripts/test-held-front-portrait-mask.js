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
let activePetRoot = null; // Simulates the real player's external shoulder-pet root in PlayerBodyTransformComposer.
const npc = root('npc_walker_fisher');
const npcRig = root('npc_rig',npc,{ hobunjiCharacterRigScaleRoot:true });
const bandit = root('bandit_avatar_group');
const banditHands = root('bandit_hands_pivot',bandit,{hobunjiCharacterRigScaleRoot:true});
const banditWorldHolder = root('banditToolHolder',scene,{hobunjiHeldPortraitOwner:bandit}); // Hostile held gear is a scene sibling in real combat-bandit.js.
const otherNpc = root('npc_walker_unarmed');
let weaponStencilEnabled = false; // Exercises the shipped disabled state before explicitly enabling this stencil-specific regression fixture.
const windowObject = { XrayHierarchy: { get: key => key === 'weapon.frontPlaneMask' && weaponStencilEnabled ? 'on' : 'off' },
  HobunjiSpritePngSurface: { maskAlphaTest:()=>0.35 },
  PlayerBodyTransformComposer: {getPlayerMesh:()=>player,getVisualRoots:()=>activePetRoot ? [playerHands,activePetRoot] : [playerHands]} };
const observations = []; // Snapshots only during actual mask draw.
const registeredFronts = []; // The shared private layer includes unarmed fronts, which must NEVER draw color into an owner's mask.
let failRender = false; // Simulates WebGL exceptions to verify state restoration.
const runtime = new Function('THREE','window','rawRender','registeredFronts',[
  'const PNG_OCCLUDER_LAYER=4, FRONT_PORTRAIT_STENCIL_MASK=0xFC, FRONT_PORTRAIT_MAX_OWNERS=63, FRONT_PORTRAIT_MASK=1<<24;',
  'const surfaceComposer=null;',
  'const withPortraitDrawOrder=(_r,_order,draw)=>draw();',
  'let frontRegistryReuses=0, frontCollections=0;',
  'const frontPortraitRegistry={}; const collectVisible=()=>{frontCollections++;return registeredFronts;};',
  'const suppressDraws=(objects,mask)=>{const prior=new Map(); for(const mesh of objects){prior.set(mesh,mesh.layers.mask);mesh.layers.mask &= ~mask;} return prior;};',
  'const restoreDraws=(prior)=>{for(const [mesh,mask] of prior)mesh.layers.mask=mask;};',
  'const hasLayer=(o,layer)=>!!(o.layers.mask & (1<<layer));',
  'const forEachMaterial=(materials,fn)=>{for(const m of Array.isArray(materials)?materials:[materials])if(m)fn(m);};',
  'let frontPortraitMaskPassCount=0,frontPortraitDepthFallbackPasses=0;',production,
  'return {isFrontPortraitMesh,isPortraitMaskedGear,portraitStencilOwner,actorRootForXrayMesh,assignPortraitStencilOwners,',
  'prepareFrontPortraitStencilMaterials,stampFrontPortraitStencil,stampFrontPortraitDepthFallback,preparePortraitGearStencilMaterials,',
  'prepareSubmergedOverlayStencilMaterials,restoreMaterialStates, getCount:()=>frontPortraitMaskPassCount,',
  'getDepthFallbackCount:()=>frontPortraitDepthFallbackPasses, getFrontCounts:()=>({frontRegistryReuses,frontCollections}),',
  'setPetForeground(meshes) { petForegroundStencilParts.clear(); for (const mesh of meshes) petForegroundStencilParts.add(mesh); }};',
].join('\n'))(THREE,windowObject,function(_scene,camera){
  observations.push({mask:camera.layers.mask,playerRef:playerFront.stencilRef,npcRef:npcFront.stencilRef,
    playerDraw:playerFront.stencilWrite,playerAlpha:playerFront.alphaTest,npcDraw:npcFront.stencilWrite,
    playerDepth:playerFront.depthWrite,rearDraw:playerRear.stencilWrite,
    unarmedPrivateVisible:!!(unarmedPortrait.layers.mask & camera.layers.mask),
    unarmedColorWrite:unarmedPortrait.material.colorWrite,
    depthSamples:registeredFronts.map(mesh=>({
      name:mesh.name, owner:mesh.parent?.name,
      materials:(Array.isArray(mesh.material)?mesh.material:[mesh.material]).map(material=>({
        depthWrite:material.depthWrite,colorWrite:material.colorWrite,depthTest:material.depthTest,
        alphaTest:material.alphaTest,stencilWrite:material.stencilWrite,
      })),
    }))});
  if(failRender)throw new Error('simulated draw failure');
},registeredFronts);
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
registeredFronts.push(playerPortrait,npcPortrait,unarmedPortrait,banditPortrait);
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

assert.equal(runtime.isPortraitMaskedGear(playerWeapon),false, 'shipped default leaves weapon art out of the owner portrait stencil');
assert.equal(runtime.assignPortraitStencilOwners([playerWeapon],[playerPortrait],scene).gearIds.size,0,
  'no stencil owner IDs are allocated while the optional weapon mask is disabled');
weaponStencilEnabled = true; // The remainder of this fixture verifies explicitly enabled owner-portrait masking and material restoration.
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
assert.equal(observations[0].unarmedPrivateVisible,false,
  'unselected, unarmed NPC front art is excluded from the stencil render instead of being drawn again in COLOR');
assert.equal(observations[0].unarmedColorWrite,true,'the normal unarmed portrait material is never modified by another owner stencil');
assert.equal(unarmedPortrait.layers.mask & (1<<24),1<<24,'unselected actor private layer restored after stamp');
assert.equal(observations[0].playerRef,assigned.ownerIds.get(player)<<2,'player ID is live during draw');
assert.equal(observations[0].npcRef,assigned.ownerIds.get(npc)<<2,'NPC ID is live during draw');
assert.equal(observations[0].rearDraw,false,'back material is excluded during mask');
assert.equal(observations[0].playerAlpha,0.35,'no faint alpha fringe stamped');
assert.equal(camera.layers.mask,1,'camera layer mask is restored');
assert.equal(runtime.getCount(),1,'one mask pass for three different actors');
const beforeReuse=runtime.getFrontCounts();
runtime.stampFrontPortraitStencil({},scene,camera,assigned.portraits,assigned.ownerIds,null,registeredFronts);
assert.deepEqual(observations[1],observations[0],'reusing the synchronous front list produces identical stencil and draw state');
assert.deepEqual(runtime.getFrontCounts(),{frontRegistryReuses:beforeReuse.frontRegistryReuses+1,frontCollections:beforeReuse.frontCollections},'one registry collection avoided');
failRender=true;
assert.throws(()=>runtime.stampFrontPortraitStencil({},scene,camera,assigned.portraits,assigned.ownerIds),/simulated draw failure/);
assert.equal(camera.layers.mask,1,'camera restored on exception');
assert.equal(playerFront.stencilWrite,false,'material restored on exception');
assert.ok(unarmedPortrait.layers.mask & (1<<24),'unselected actor private layer restored even after a stencil render exception');
failRender=false;

// The shoulder pet is always the owner's composite portrait, but only the
// *above-owner* face (and its split half) can cover owner tools in the late stencil.
const petRoot=root('shoulder_pet',scene,{
  hobunjiShoulderPetLayering:{active:true,frontForeground:true,backForeground:false},
});
activePetRoot = petRoot; // The pet is in the owner's external root list while its own face mask must still be selective.
const petFront=mesh('npc_avatar_front_plane',mat('pet_front'),petRoot,{
  tags:{hobunjiShoulderPetStencilForeground:true},
});
const petBack=mesh('npc_avatar_back_plane',mat('pet_back'),petRoot);
const petSplitFront=mesh('shoulder_split_front',[mat('npc_avatar_skinned_front_material'),mat('split_rear')],petRoot,{
  skinned:true,tags:{hobunjiShoulderSplitOverlay:true,hobunjiPlaneFace:'front',hobunjiShoulderPetStencilForeground:true},
});
const petSplitBack=mesh('shoulder_split_back',[mat('npc_avatar_skinned_front_material'),mat('split_rear')],petRoot,{
  skinned:true,tags:{hobunjiShoulderSplitOverlay:true,hobunjiPlaneFace:'back'},
});
const bothFaces=[playerPortrait,petFront,petBack,petSplitFront,petSplitBack];
registeredFronts.push(petFront,petBack,petSplitFront,petSplitBack); // Both facing cards exist in the live registry.
runtime.setPetForeground([petFront,petSplitFront]);
assert.equal(runtime.isFrontPortraitMesh(petSplitFront),true,'active front split participates in owner mask');
assert.equal(runtime.isFrontPortraitMesh(petSplitBack),false,'background split is not a front-mask candidate');
assert.equal(runtime.portraitStencilOwner(petFront,scene),player,'front foreground shares carrier stencil owner');
assert.equal(runtime.actorRootForXrayMesh(petBack,scene)?.isPlayer,true,
  'body composer recognizes the entire attached pet as an external player visual root');
assert.equal(runtime.portraitStencilOwner(petBack,scene),null,
  'background pet cannot inherit the owner through that external-root fallback');
let shoulderAssigned=runtime.assignPortraitStencilOwners([playerWeapon],bothFaces,scene);
assert.equal(shoulderAssigned.portraits.length,3,
  'owner tool uses player plus foreground pet front and split, never the background pet back');
assert.equal(shoulderAssigned.gearIds.get(playerWeapon),shoulderAssigned.ownerIds.get(player),
  'the carrier and selected foreground pet face use one stencil owner ID');
let petStates=runtime.prepareFrontPortraitStencilMaterials(shoulderAssigned.portraits,shoulderAssigned.ownerIds,scene);
assert.equal(petFront.material.stencilWrite,true,'foreground pet front stamps owner pixels');
assert.equal(petBack.material.stencilWrite,false,'background pet back does not stamp owner pixels');
assert.equal(petSplitFront.material[0].stencilWrite,true,'foreground split front stamps owner pixels');
assert.equal(petSplitFront.material[1].stencilWrite,true,'foreground split rear material also stamps its foreground pixels');
assert.equal(petSplitBack.material[0].stencilWrite,false,'background split never stamps owner pixels');
runtime.restoreMaterialStates(petStates);

function checkNoStencilPetDepth(expectedForeground) {
  const selected=runtime.assignPortraitStencilOwners([playerWeapon],bothFaces,scene);
  const before=observations.length;
  assert.equal(runtime.stampFrontPortraitDepthFallback({},scene,camera,selected.portraits,selected.ownerIds),true);
  assert.equal(observations.length,before+1,'one colorless owner depth draw per fallback');
  const draw=observations[before];
  const ownerFront=draw.depthSamples.find(mesh=>mesh.name==='skinned_player');
  const petMesh=name=>draw.depthSamples.find(mesh=>mesh.owner==='shoulder_pet' && mesh.name===name);
  assert.equal(draw.mask,1<<24,'fallback sees only private silhouette layer');
  assert.equal(ownerFront.materials[0].depthWrite,true,'player FRONT writes depth despite active shoulder pet');
  assert.equal(ownerFront.materials[0].colorWrite,false,'depth stamp cannot repaint front art');
  assert.equal(ownerFront.materials[0].stencilWrite,false,'fallback works without stencil');
  assert.equal(ownerFront.materials[0].alphaTest,.35,'front uses opaque PNG coverage, not its rectangle');
  assert.equal(ownerFront.materials[1].depthWrite,false,'rear half of skinned owner stays excluded');
  const foreground=petMesh(expectedForeground);
  assert.equal(foreground.materials[0].depthWrite,true,"foreground pet face adds depth to owner's silhouette");
  assert.equal(foreground.materials[0].stencilWrite,false,'foreground pet never requires a stencil for depth');
  const other=expectedForeground==='npc_avatar_front_plane'?'npc_avatar_back_plane':'npc_avatar_front_plane';
  assert.equal(petMesh(other).materials[0].depthWrite,false,'background pet face is excluded');
  assert.equal(draw.unarmedPrivateVisible,false,"other NPCs cannot contaminate owner's silhouette");
  assert.equal(playerFront.depthWrite,false,'owner front regains depth-write-free presentation');
  assert.equal(playerFront.colorWrite,true,'owner color material flags restored');
  assert.equal(camera.layers.mask,1,'fallback restores private layer state');
}
checkNoStencilPetDepth('npc_avatar_front_plane');

// Looking away swaps only the stencil faces; the owner and animation stay put.
petRoot.userData.hobunjiShoulderPetLayering.frontForeground=false;
petRoot.userData.hobunjiShoulderPetLayering.backForeground=true;
delete petFront.userData.hobunjiShoulderPetStencilForeground;
delete petSplitFront.userData.hobunjiShoulderPetStencilForeground;
petBack.userData.hobunjiShoulderPetStencilForeground=true;
petSplitBack.userData.hobunjiShoulderPetStencilForeground=true;
runtime.setPetForeground([petBack,petSplitBack]);
assert.equal(runtime.isFrontPortraitMesh(petSplitFront),false,'front split excluded when pet faces away');
assert.equal(runtime.isFrontPortraitMesh(petSplitBack),true,'back split included when pet faces away');
assert.equal(runtime.portraitStencilOwner(petFront,scene),null,
  'background pet front stays excluded despite external player-root classification');
assert.equal(runtime.portraitStencilOwner(petBack,scene),player,'foreground pet back shares carrier owner');
shoulderAssigned=runtime.assignPortraitStencilOwners([playerWeapon],bothFaces,scene);
assert.equal(shoulderAssigned.portraits.length,3,
  'owner tool uses player plus foreground pet back and split, never the background pet front');
petStates=runtime.prepareFrontPortraitStencilMaterials(shoulderAssigned.portraits,shoulderAssigned.ownerIds,scene);
assert.equal(petBack.material.stencilWrite,true,'foreground pet back stamps owner pixels');
assert.equal(petSplitBack.material[0].stencilWrite,true,'foreground back split stamps owner pixels');
assert.equal(petFront.material.stencilWrite,false,'background front cannot mask owner gear');
runtime.restoreMaterialStates(petStates);
checkNoStencilPetDepth('npc_avatar_back_plane');
assert.equal(runtime.getDepthFallbackCount(),2,'both pet stages receive actual fallback depth');

// Detached/replaced pet carries no owner's tool mask.
runtime.setPetForeground([]);
delete petBack.userData.hobunjiShoulderPetStencilForeground;
delete petSplitBack.userData.hobunjiShoulderPetStencilForeground;
petRoot.userData.hobunjiShoulderPetLayering.active=false;
activePetRoot = null; // The composer no longer registers a detached pet as an external player root.
const behindAssigned=runtime.assignPortraitStencilOwners([playerWeapon],bothFaces,scene);
assert.equal(behindAssigned.portraits.length,1,'detached pet cannot erase owner-held tool pixels');

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
const portraitOrder = new Function('THREE', 'forEachMaterial', 'xrayRule', 'window', 'isPresentationBackdrop', 'surfaceKindForObject',
  'shoulderPetPresentation', 'previouslyPresentedPet', 'shoulderPetDrawFace', 'compareShoulderPetDrawFaces', [
  section('  const portraitSortPoint = ', '  function assignPortraitStencilOwners('),
  'return { comparePortraitDraws, withPortraitDrawOrder };',
].join('\n'))({ Vector3: class {} }, (material, fn) => fn(material),
  () => 'off', {}, () => false, () => 'solid', null, null, () => null, () => 0); // Native portrait order stays unchanged unless the Dev Companion explicitly enables manual ranks.
const fogged = { depthWrite: true }, nearby = { depthWrite: true };
const npcDraw = { object: { material: fogged }, groupOrder: 0, renderOrder: 2, z: .1, id: 30 };
const playerDraw = { object: { material: nearby }, groupOrder: 0, renderOrder: 4, z: .8, id: 31 };
const npcRank = { owner: { id: 1 }, depth: .7 }, playerRank = { owner: { id: 2 }, depth: .3 };
const ranks = new Map([[npcDraw.object, npcRank], [playerDraw.object, playerRank]]);
let sort = null;
const renderer = { setTransparentSort(fn) { sort = fn; } };
portraitOrder.withPortraitDrawOrder(renderer, { ranks, nearest: playerRank }, () => {
  assert.deepEqual([playerDraw,npcDraw].sort(sort), [npcDraw,playerDraw], 'actor depth wins over crossed NPC/player plane center depth and front/back draw order');
  assert.equal(fogged.depthWrite, false, 'a pants-free farther NPC still defers depth to preserve actor-root ordered portrait crossings');
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
  const unpantedClose = { object: { material: { depthWrite: true } }, groupOrder: 0, renderOrder: 2, z: .65, id: 45 }; // Close NPC with no garment keeps the original plane-crossing safeguard.
  const unpantedRank = { owner: { id: 6 }, depth: .7, close: true }; // Deliberately farther than the nearest close actor.
  const ranks3 = new Map([[farPortrait.object, farRank], [playerFront.object, midRank], [nearPortrait.object, nearRank], [unpantedClose.object, unpantedRank]]);
  const extras = new Map([[farPants.object, farRank], [playerPants.object, midRank]]);
  const sorted = [playerPants, nearPortrait, farPants, playerFront, farPortrait].sort((a, b) => portraitOrder.comparePortraitDraws(a, b, ranks3, extras));
  assert.deepEqual(sorted.map(d => d.id), [40, 41, 42, 44, 43], 'actors draw far to near; each actor\'s pants follow its own portrait');
  let sort3 = null;
  portraitOrder.withPortraitDrawOrder({ setTransparentSort(fn) { sort3 = fn; } }, { ranks: ranks3, extras, nearest: nearRank }, () => {
    assert.equal(farPortrait.object.material.depthWrite, true, 'actors outside the crossing radius keep their normal depth write');
    assert.equal(playerFront.object.material.depthWrite, true, 'the close pants wearer keeps portrait depth, shielding its solid pixels from garment bleed');
    assert.equal(unpantedClose.object.material.depthWrite, false, 'unclothed non-nearest actors still defer portrait depth for crossed-plane painter order');
    assert.equal(farPants.object.material.depthWrite, true, 'garments write depth normally, separate from the pants-to-feet adjustment');
  }, true);
  assert.equal(unpantedClose.object.material.depthWrite, true, 'temporary pantless actor depth suppression restores after the base draw');
  assert.ok(/extras\.set\(mesh, rank\)/.test(source) && /PantsGarmentRenderer\?\.liveHandles/.test(source), 'real render path ranks worn pants with their actor');
}

assert.ok(source.includes('portraitGearIds = portraitMask.gearIds'),'overlay receives actual per-owner gear lookup');
assert.ok(source.includes('stampFrontPortraitStencil(renderer, scene, camera, portraitMask.portraits, portraitMask.ownerIds, portraitOrder)'),'mask is invoked from real render path');
assert.match(source, /const needsOwnerMask = held\.some\(isPortraitMaskedGear\)/,
  'no-stencil frame with an equipped pet must not bypass the held-mask depth replay');
assert.match(source, /const portraitMask = lastFrontPortraitGearCandidates[\s\S]{0,240}assignPortraitStencilOwners/,
  'owner/pet silhouette still resolves when the stencil buffer is unavailable');
assert.match(source, /if \(!portraitGearIds && portraitMask\?\.portraits\.length[\s\S]{0,200}stampFrontPortraitDepthFallback/,
  'the no-stencil owner mask is stamped after rebuilding scene depth, before drawing weapon sprites');
assert.ok(/frontPortraitRegistry\.add\(object(?:,\s*knownScene)?\)/.test(source),'front portraits are registered automatically');
assert.match(fs.readFileSync('docs/js/combat/combat-bandit.js','utf8'),/holder\.userData\.hobunjiHeldPortraitOwner = avatarRef\.group/,'all hostile melee/ranged/flask holders receive their owner tag');
assert.match(fs.readFileSync('docs/js/npc-held-equipment-v4.js','utf8'),/hobunjiHeldPortraitOwner: state\.walker\.root/,'watchman scene-sibling holder receives its owner tag');
assert.match(fs.readFileSync('docs/js/npc-held-equipment-v4.js','utf8'),/walker\.stationToolMesh\.userData\.hobunjiHeldPortraitOwner = walker\.root/,'station tool receives its own walker owner tag');

console.log('Held front-portrait owner stencil regression: PASS');
