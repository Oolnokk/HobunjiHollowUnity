// Node-only regression for Shattercask placement, both attack paths,
// rubble drops and reload persistence; no DOM, WebGL or browser required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const code = fs.readFileSync(path.join(root,'docs/js/shattercasks.js'),'utf8');
const html = fs.readFileSync(path.join(root,'docs/index.html'),'utf8');
const ranged = fs.readFileSync(path.join(root,'docs/js/combat/ranged-weapons.js'),'utf8');
const devSpawner = fs.readFileSync(path.join(root,'docs/js/dev-spawner.js'),'utf8');
const asset = JSON.parse(fs.readFileSync(path.join(root,'docs/config/furniture-authored/shattercaskBlasting.json'),'utf8'));
assert.equal(asset.parts.length,3,'two-necked furniture retains all three authored pieces');
assert(asset.recognizedSurfaces.length>0,'all original surface definitions survive import');
assert(html.includes('src="js/shattercasks.js?v='),'shattercask runtime is loaded');
assert(ranged.includes('Shattercasks?.projectileHit'),'ranged projectile segment detects shattercasks');
assert(code.includes('assets/textures/boards.png')&&code.includes('assets/textures/carved_smooth.png'),'debris uses the real body and neck textures');

assert.equal(asset.particleEmitters.filter(e=>e.enabled&&e.type==='bubbles').length,2,
  'both editor-authored bubble emitters are preserved');
const firstNeck=asset.parts.find(part=>part.id==='part_mveyqf1t_9i1bs');
const secondNeck=asset.parts.find(part=>part.id==='part_mveyvcjl_p5vm5');
const [firstBubble,secondBubble]=asset.particleEmitters;
assert.equal(firstBubble.attachedPartId,firstNeck.id,'first bubble stays attached to first neck');
assert.equal(secondBubble.attachedPartId,secondNeck.id,'second bubble tracks angled second neck instead of first');
assert(Math.abs(firstBubble.position.y-(.2256*.2106/.4576))<1e-6,
  'first emitter maintains mathematically exact normalized height after neck scaling');
const oldNeck={x:.2026,y:.4632,z:.0029,angle:-11.382,sx:.2226,sy:.4083,sz:.2698};
const oldWorld={x:-.0254+.2631,y:.6333+.0015,z:0};
const a=-oldNeck.angle*Math.PI/180,dx=oldWorld.x-oldNeck.x,dy=oldWorld.y-oldNeck.y;
const oldSecondLocal={x:dx*Math.cos(a)-dy*Math.sin(a),y:dx*Math.sin(a)+dy*Math.cos(a),z:oldWorld.z-oldNeck.z};
assert(Math.abs(secondBubble.position.x-oldSecondLocal.x*secondNeck.transform.sx/oldNeck.sx)<1e-6 &&
  Math.abs(secondBubble.position.y-oldSecondLocal.y*secondNeck.transform.sy/oldNeck.sy)<1e-6 &&
  Math.abs(secondBubble.position.z-oldSecondLocal.z*secondNeck.transform.sz/oldNeck.sz)<1e-6,
  'second emitter is reprojected from its old world point into the resized and re-angled second cup');
assert(Math.abs(secondBubble.rotation.z-(-16.559-oldNeck.angle))<1e-6,
  'second emitter preserves exact relative emission direction to the tilted neck');
for(const [e,neck] of [[firstBubble,firstNeck],[secondBubble,secondNeck]])
  assert(e.position.y>0 && e.position.y<neck.transform.sy/2 && e.size<.05 && e.radius<.07,
    'each scaled bubble emitter sits just inside the correct cup mouth with matching particle size');
assert.equal(asset.carryable.enabled,true,'Shattercasks are authored as carryable world objects');
assert(asset.carryable.billboardAnchor?.position,'carryable billboard anchor is saved');
assert(asset.carryable.handTargets?.left && asset.carryable.handTargets?.right,
  'individual authored left and right grip coordinates are saved');
const actionArcCode=fs.readFileSync(path.join(root,'docs/js/action-arc-ui.js'),'utf8');
const arcCss=fs.readFileSync(path.join(root,'docs/style.css'),'utf8');
assert(actionArcCode.includes('window.Shattercasks?.toolArchTap?.()') &&
  actionArcCode.includes('heldMode: () => deps?.getHeldMode?.() ?? null') &&
  code.includes('toolArchAction()') &&
  code.includes('syncToolArchPickup();') &&
  arcCss.includes('#toolBtn.shattercask-context'),
  'Tool Select directly picks up a facing-nearby Shattercask regardless of active equipment');
assert(code.includes('WorldPopupText?.setInteractionPrompts') &&
  code.includes("WorldActionInputClaims?.setClaims") &&
  !code.includes("document.createElement('button')"),
  'pickup uses the world prompt and native interaction claims instead of a standalone DOM button');
assert(asset.carryable.hitbox.enabled&&
  ['x','y','z'].every(axis=>asset.carryable.hitbox.size[axis]>0) &&
  code.includes('worldHitbox(vase)'),
  'separately sized 3D impact hitbox is serialized and used by projectile collision');
assert(code.includes('createEmitterVisual') && code.includes('emitterVisibilityElapsed'),
  'only visible charges drive their authored particle emitters');
assert(/src="js\/procedural-furniture\.js\?v=[A-Za-z0-9_-]+"/.test(html),
  'runtime receives the editor-parity curved barrel/cup geometry');
const renderer=fs.readFileSync(path.join(root,'docs/js/procedural-furniture.js'),'utf8');
assert(renderer.includes('createAuthoredVesselGeometry(part)') && renderer.includes("part.kind === 'barrel' || part.kind === 'cup'"),
  'authored open cups and curved barrels do not fall back to closed generic cylinders');
const reticle=fs.readFileSync(path.join(root,'docs/js/combat/ranged-hud-reticle.js'),'utf8');
assert(reticle.includes('FILTER_ORANGE') && reticle.includes('wouldHitShattercask'),
  'ranged reticle has orange Shattercask interception state');
assert(ranged.includes('function wouldHitShattercask()') &&
  ranged.includes("first={kind:'shattercask'"),'reticle shares projectile hit prediction');
const handDriver=fs.readFileSync(path.join(root,'docs/js/procedural-hand-frame-driver.js'),'utf8');
assert(handDriver.includes("target.mode === 'authored-world'") &&
  handDriver.includes('window.Shattercasks?.heldHandTarget'),
  'existing procedural hands accept authored world-object grip targets');
const author=fs.readFileSync(path.join(root,'docs/tools/furniture-avatar-author/carryable-objects.js'),'utf8');
const authorHtml=fs.readFileSync(path.join(root,'docs/tools/furniture-avatar-author/index.html'),'utf8');
assert(authorHtml.includes('carryable-objects.js?v=') && author.includes('billboardAnchor') &&
  author.includes('handTargets') && author.includes('exportData=function'),
  'furniture author exports invisible held-item plane anchor and both editable grip points');
assert(author.includes('id="carrySelectHitbox"') &&
  author.includes('carry_hitbox_wireframe') &&
  author.includes('carryHitboxSX')&&author.includes('carryHitboxSY')&&author.includes('carryHitboxSZ'),
  'furniture editor can display, select, translate and resize the authored hitbox');
assert(code.includes("mesh.name==='npc_avatar_back_plane'") &&
  code.includes("mesh.material[1]?.name!=='npc_avatar_skinned_back_material'") &&
  code.includes('new THREE.SkinnedMesh(mesh.geometry,[hiddenFront,rearMaterial])') &&
  code.includes('overlay.bind(mesh.skeleton,mesh.bindMatrix)') &&
  code.includes('backMaterial.visible=false') &&
  code.includes('rearMaterial.depthTest=true') &&
  code.includes('setHeldRearXray(null)') &&
  code.includes('setHeldRearXray(held); // Recheck'),
  'carrying uses one back-only skinned draw (or legacy rigid back) above the vase, while respecting world depth and restoring normal portrait state');
const png=fs.readFileSync(path.join(root,'docs/js/png-plane-avatar.js'),'utf8');
assert(png.includes("skinnedPlane.name = config.name || 'npc_avatar_skinned_plane_assembly'") &&
  png.includes('new THREE.SkinnedMesh(geometry, [frontMaterial, backMaterial])'),
  'regression covers the real player neck-rig layout, not just a rigid rear mesh');
assert(code.includes('updateShatterThrow(dt)') &&
  code.includes('Math.sin(Math.PI*ratio)') &&
  code.includes("['btnItemAction1','Throw Shattercask'") &&
  code.includes("['btnItemAction2','Set Down Shattercask'") &&
  code.includes('pointThrowFromDrag('),
  'hold-release action 1 has terrain projection and flask arc; item action 2 drops');
const flaskThrowCode=fs.readFileSync(path.join(root,'docs/js/alchemy-flasks.js'),'utf8');
assert(flaskThrowCode.includes('function flightDuration(distanceTiles)') &&
  flaskThrowCode.includes('function flightPosition(origin,target,ratio,distanceTiles,out)') &&
  code.includes('window.AlchemyFlasks?.flightDuration?.(distanceTiles)') &&
  code.includes('window.AlchemyFlasks.flightPosition('),
  'Shattercask uses the authoritative flask projectile duration and 3D flight curve');
assert(code.includes('beginSharedThrowVisual()') &&
  code.includes('releaseSharedThrowVisual()') &&
  code.includes('window.HeldActionAnimations?.throwFlask') &&
  code.includes('currentThrowSocketPose()') &&
  code.includes('vase.group.position.sub(base.position).applyQuaternion(delta).add(live.position)') &&
  !code.includes('vase.group.position.x=0'),
  'Shattercask follows the real animated held-item socket rather than hand-authored fake YZ-only sweep');
assert(code.includes('right.x*dx-forward.x*dy') &&
  code.includes('right.z*dx-forward.z*dy') &&
  code.includes('deltaX*heading.x+deltaZ*heading.z<.4') &&
  code.includes('dx*heading.x+dz*heading.z<.5'),
  'camera-relative drag and short/steep target clamps prevent the projectile moving behind the player');
assert(code.includes('rearHeadwearXray') &&
  code.includes('CARRIED_REAR_HEAD_RENDER_ORDER') &&
  code.includes('restoreRearHeadwear()'),
  'rear headwear/head-xray has a distinct reversible render layer above the held vessel');
assert(author.includes('id="carryShowAvatar"') && author.includes('id="carryFrameHoldingPose"'),
  'Carryable mode provides visible avatar toggle and framing controls');
assert(author.includes("renderSeatPortrait('mao-ao','male')") &&
  author.includes('buildSinglePlaneAvatarModel') &&
  author.includes('ProceduralHandAttachments?.attach?.'),
  'Carryable preview uses game avatar portrait and real procedural hand attachment models');
assert(author.includes('placeHandWorld?.(side,world') && author.includes('state.carryable.handTargets[side]') &&
  author.includes('previewActor.scale.setScalar'),
  'preview positions real hand rigs using authored hand targets and avatar-relative anchor scale');
assert(author.includes('syncHoldingPreview();') &&
  author.includes("activeEditorMode==='carry'&&previewEnabled") &&
  !author.includes('state.avatar.visible=true'),
  'avatar preview updates live only in Carryable mode without modifying exported avatar settings');
assert(asset.carryable.billboardAnchor.coordinateSpace==='posterior-relative' &&
  Object.values(asset.carryable.billboardAnchor.posteriorOffset).every(Number.isFinite),
  'Shattercask declares posterior-relative XYZ offset independently of mesh-space mounting point');
assert(['left','right'].every(side=>['x','y','z'].every(axis=>
  Number.isFinite(asset.carryable.handTargets[side].rotation[axis]))),
  'both grip frames export their own authored XYZ Euler rotations');
assert(code.includes('PlayerBodyTransformComposer?.getPosteriorY?.()') &&
  code.includes('posteriorLocal.set(') &&
  code.includes('vase.group.position.copy(posteriorLocal).add(posteriorOffset).sub(heldAnchorOffset)') &&
  code.includes('multiplyScalar(vase.group.scale.x).applyQuaternion(vase.group.quaternion)') &&
  !code.includes('vase.group.position.copy(holder.position)'),
  'runtime mounts relative to actual avatar posterior and applies XYZ plus item scale, never world drop position');
const composer=fs.readFileSync(path.join(root,'docs/js/player-body-transform-composer.js'),'utf8');
assert(composer.includes('getPosteriorY: () => playerPosteriorY'),
  'posterior mount uses the exact composer-owned anatomical pivot');
assert(author.includes('posteriorAnchorForModel(model') &&
  author.includes('characterPosteriorY?.(') &&
  author.includes('carry_reference_posterior') &&
  author.includes('carry_reference_attachment') &&
  author.includes('carryPosteriorZ') &&
  author.includes('tempOffset.copy(previewPosterior)'),
  'editor previews the same posterior-based mount with visible hip/offset guide and adjustable Z');
assert(author.includes('state.carryable.handTargets[id].rotation') &&
  author.includes("handLocalEuler.setFromQuaternion(handAbsolute,'XYZ')") &&
  author.includes("new THREE.AxesHelper(.095)") &&
  !author.includes("new THREE.SphereGeometry(.045"),
  'each grip has a local rotation gizmo rather than an unrotatable proxy sphere');
const handAttachments=fs.readFileSync(path.join(root,'docs/js/procedural-hand-attachments.js'),'utf8');
assert(handAttachments.includes('modelCalibrationForSpecies,') &&
  author.includes("modelCalibrationForSpecies?.('mao-ao','male',modelH)") &&
  handDriver.includes("if (target.mode === 'authored-world') {") &&
  handDriver.includes('scratch.authoredQuaternion.setFromEuler(scratch.authoredEuler)'),
  'editor and gameplay use shared GLB hand calibration and zero-allocation authored rotations');

assert(authorHtml.includes('config/hand-model-profiles.js') &&
  authorHtml.includes('js/procedural-hand-attachments.js') &&
  /carryable-objects\.js\?v=[A-Za-z0-9_-]+/.test(authorHtml),
  'furniture editor loads the same hand profiles and procedural hand model loader used by gameplay');

assert(authorHtml.includes("'docs/config/furniture-authored/shattercaskBlasting.json'"),
  'Shattercask is a known repository furniture entry even before GitHub tree discovery');
assert(authorHtml.includes('RAWGITHACK_BUILD_REF') &&
  authorHtml.includes("encodeURIComponent(RAWGITHACK_BUILD_REF || 'main')"),
  'furniture catalog discovers files at the active pinned build rather than always main');
assert(authorHtml.includes('authoredProject&&$(\'replaceOnRepoImport\').checked') &&
  authorHtml.includes('loadData(data); // Retain the original geometry, emitters, surfaces, and carryable anchors/grips.'),
  'repository authored furniture imports retain complete anchor/grip metadata and emitters');


assert(html.includes('id="devSpawnShattercaskBtn"'),'dev arena has a Shattercask spawn button');
assert(devSpawner.includes("window.Shattercasks.spawnRandomInDevArena()"),'arena button dispatches to the runtime');

class Vector3 {
  constructor(x=0,y=0,z=0){this.set(x,y,z);}
  set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
  setScalar(v){return this.set(v,v,v);}
  copy(v){return this.set(v.x,v.y,v.z);}
  clone(){return new Vector3(this.x,this.y,this.z);}
  add(v){this.x+=v.x;this.y+=v.y;this.z+=v.z;return this;}
  addScaledVector(v,k){this.x+=v.x*k;this.y+=v.y*k;this.z+=v.z*k;return this;}
  multiplyScalar(v){this.x*=v;this.y*=v;this.z*=v;return this;}
  lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z;}
  length(){return Math.sqrt(this.lengthSq());}
  normalize(){return this.multiplyScalar(1/(this.length()||1));}
  crossVectors(a,b){return this.set(a.y*b.z-a.z*b.y,a.z*b.x-a.x*b.z,a.x*b.y-a.y*b.x);}
  distanceTo(v){return Math.hypot(this.x-v.x,this.y-v.y,this.z-v.z);}
}
function vector() {return new Vector3();}
class Node {
  constructor(){this.children=[];this.position=vector();this.scale=vector();this.rotation=vector();this.userData={};this.parent=null;}
  add(other){this.children.push(other);other.parent=this;}
  remove(other){this.children=this.children.filter(child=>child!==other);other.parent=null;}
  traverse(callback){callback(this);for(const child of this.children)child.traverse(callback);}
  getObjectByProperty(key,value){
    if(this[key]===value)return this;
    for(const child of this.children){const match=child.getObjectByProperty(key,value);if(match)return match;}
    return null;
  }
}
class Mesh extends Node {constructor(geometry,material){super();this.geometry=geometry;this.material=material;this.isMesh=true;}}
class InstancedMesh extends Mesh {constructor(geometry,material){super(geometry,material);this.instanceMatrix={};}setMatrixAt(){}}
class Object3D extends Node {updateMatrix(){this.matrix={};}}
class Geometry {dispose(){}}
class RingGeometry extends Geometry {
  constructor(innerRadius,outerRadius,segments,radialSegments){
    super();Object.assign(this,{innerRadius,outerRadius,segments,radialSegments});
    this.heights=[0,0,0];this.samples=0;
    this.attributes={position:{count:3,getX:index=>[0,1,0][index],getY:index=>[0,0,1][index],
      setZ:(index,value)=>{this.heights[index]=value;this.samples++;}}};
  }
  computeBoundingSphere(){this.boundsUpdated=true;}
}
class Material {
  constructor(options){Object.assign(this,options);}
  clone(){return new Material({...this});}
  dispose(){}
}
class SkinnedMesh extends Mesh {
  constructor(geometry,materials){super(geometry,materials);this.isSkinnedMesh=true;this.matrix={copy(){}};this.matrixWorld={copy(){}};}
  bind(skeleton,bindMatrix){this.skeleton=skeleton;this.bindMatrix=bindMatrix;}
}
// This mock casts a ray against a small authored silhouette, not the full
// bounding volume. Production uses THREE.Mesh.raycast triangles directly.
class Raycaster {
  constructor(){this.near=0;this.far=Infinity;this.ray={origin:new Vector3(),direction:new Vector3()};}
  intersectObjects(meshes,recursive,hits){
    for(const mesh of meshes){
      const parent=mesh.parent;
      if(!mesh.geometry?.authoredMock || !parent)continue;
      const ray=this.ray,dx=ray.direction.x;
      if(Math.abs(dx)<1e-9)continue;
      const distance=(parent.position.x+mesh.position.x-ray.origin.x)/dx;
      if(distance<this.near || distance>this.far)continue;
      const y=ray.origin.y+distance*ray.direction.y-parent.position.y;
      const z=ray.origin.z+distance*ray.direction.z-parent.position.z;
      // A narrow tapered neck rising to .89, and a broader rounded body.
      const inBody=y>=.04&&y<=.57&&Math.abs(z)<.26;
      const inNeck=y>.57&&y<=.88&&Math.abs(z)<.11;
      if(inBody||inNeck)hits.push({distance,object:mesh});
    }
    hits.sort((a,b)=>a.distance-b.distance);
    return hits;
  }
}
function authoredGroup() {
  const group=new Node(),mesh=new Mesh({attributes:{position:{count:3}},authoredMock:true},new Material({visible:true}));
  group.add(mesh);
  group.userData.meshById=new Map([['silhouette',mesh]]);
  return group;
}
const THREE = {Group:Node,Mesh,SkinnedMesh,InstancedMesh,Object3D,Vector3,Raycaster,RingGeometry,
  TetrahedronGeometry:Geometry,SphereGeometry:Geometry,CylinderGeometry:Geometry,DodecahedronGeometry:Geometry,
  MeshBasicMaterial:Material,MeshLambertMaterial:Material,DoubleSide:2,AdditiveBlending:3,
  TextureLoader:class{load(){return{dispose(){}};}}};
const storage = new Map();
const localStorage = {getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)};
const area='map_i_den_shattercask_test';
async function scenario(reloading=false) {
  const tiles=Array.from({length:12},()=>Array.from({length:12},()=>({type:'grass'})));
  tiles[3][5]={type:'rock',rockKind:'diggableRockOre',caveSeparator:true};
  tiles[3][6]={type:'tree',treeKind:'pine'};
  const scene=new Node();
  const player={x:3.5*64,y:3.5*64,angle:0,health:100};
  const inventory={},damage=[];
  const deps={
    TILE:64,player,inventory,TileType:{GRASS:'grass'},
    getCurrentArea:()=>area,getActiveScene:()=>scene,worldSurfaceY:()=>0,
    hostileObjects:new Set(),getPlayerMeleeAimPitch:()=>0,
    clearVegetationInAttackCone:()=>0,
    damagePlayer:(...args)=>damage.push(args),showToast(){},
  };
  const game={
    console,THREE,localStorage,__hobunjiPlayerProfile:{worldId:'regression'},
    Combat:{deps,init(){},update(){},beginStagedAction(options){return options;},
      spawnMeleeTrail(){},meleeColliderVolume(){return null;}},
    GridTileAccessors:{getActiveScene:()=>scene,getActiveGrid:()=>tiles},
    CaveSiteSystem:{__test:{plansByMapId:new Map([[area,{shattercasks:[{id:'wall-charge',col:4,row:3}]}]])}},
    AuthoredFurniture:{load:async()=>asset,buildGroup:authoredGroup},
    DevSpawner:{init(){}},ResourceSystem:{spendFooting(){}},
    AudioSystem:{playWeaponHitSfx(){}},__farmLog(){},
  };
  game.window=game;
  vm.createContext(game);
  vm.runInContext(code,game,{filename:'shattercasks.js'});
  game.Combat.update(.18);
  // Furniture loading and the async spawn's continuation run on separate
  // microtask turns in Node's vm context; yield a full event-loop turn.
  await new Promise(resolve=>setImmediate(resolve));
  const casks=game.Shattercasks.debugSnapshot();
  if(reloading) {
    assert.equal(casks.vases.length,0,'exploded charge must not respawn after reload');
    assert.equal(casks.rubble.length,1,'unlooted tree-stick pile persists');
    assert.equal(tiles[3][5].type,'grass','mineable cave wall stays broken');
    assert.equal(tiles[3][6].type,'grass','felled tree stays cleared');
    return;
  }
  assert.equal(casks.vases.length,1,'the cave wall has an intact Shattercask');
  // A projectile passes through the full height of the editor-authored neck,
  // not the former narrow .37-radius / .42-height fake target.
  const neck=game.Shattercasks.projectileHit({x:3,y:0.80,z:3.5},
    {x:5.6,y:0.80,z:3.5},.08,1,area);
  assert(neck && neck.t>=0 && neck.t<=1,'projectile intercepts the visible authored neck');
  assert.equal(game.Shattercasks.projectileHit({x:3,y:1.2,z:3.5},
    {x:5.6,y:1.2,z:3.5},.03,1,area),null,
    'the space above the modeled neck is not an explosive hit target');
  assert.equal(game.Shattercasks.projectileHit({x:3,y:.80,z:3.87},
    {x:5.6,y:.80,z:3.87},.03,1,area),null,
    'the empty space beside the narrow neck is not a mesh hit');
  const limited=game.Shattercasks.projectileHit({x:3,y:.42,z:3.5},
    {x:5.6,y:.42,z:3.5},.08,.15,area);
  assert.equal(limited,null,'cover/terrain segment limits prevent hitting mesh behind them');

  // A shot from either team uses this same swept-segment intersection.
  const hit=game.Shattercasks.projectileHit({x:3,y:.42,z:3.5},{x:5.6,y:.42,z:3.5},.08,1,area);
  assert(hit&&hit.t>0&&hit.t<1,'swept projectile crosses the vase');
  assert(game.Shattercasks.hitProjectile(hit),'projectile triggers a single detonation');
  assert.equal(damage.length,1,'player is hurt by own nearby charge');
  assert.equal(tiles[3][5].type,'grass','blast opens the mineable wall');
  assert.equal(tiles[3][6].type,'grass','blast cuts down the tree');
  assert.equal(game.Shattercasks.debugSnapshot().rubble.length,2,'rock and tree each create one loot pile');
  const drawBudget=game.Shattercasks.debugSnapshot().performance;
  assert.equal(drawBudget.activePileDrawCalls,2,'all debris uses only two instanced draw calls');
  assert.equal(drawBudget.activeDebrisInstances,8,'two piles each contain four GPU instances');
  assert.equal(drawBudget.textureBatchesCreated,1,'texture uploads and material allocation occur only once');
  player.x=5.5*64;
  assert(game.Shattercasks.interact(),'rubble is looted with one interaction');
  assert.equal(inventory.stone,3,'stone becomes actual inventory stock');
  assert.equal(inventory.pebble,2,'stone pile also gives pebbles');
  assert.equal(game.Shattercasks.debugSnapshot().rubble.length,1,'looting does not remove the other pile');
  assert.equal(game.Shattercasks.debugSnapshot().performance.activeDebrisInstances,4,
    'looting changes only instance count, not per-tile mesh ownership');
  // A second blast must reuse the first blast's geometry/textures.
  const phantom=new Node();phantom.position.set(4.5,0,3.5);
  assert(game.Shattercasks.detonate({id:'performance-repeat',mapId:area,col:4,row:3,
    group:phantom,exploded:false,carried:false},'regression'));
  assert.equal(game.Shattercasks.debugSnapshot().performance.textureBatchesCreated,1,
    'repeated explosions reuse pooled GPU source assets');
}
async function arenaScenario() {
  let currentArea='map_dev_arena',modelBuilds=0;
  let groundProjectionBinds=0; // Counts raised-surface binding of the reusable throw preview.
  const tiles=Array.from({length:9},()=>Array.from({length:9},()=>({type:'grass',water:0})));
  tiles[2][3]={type:'rock',rockKind:'diggableRockOre'};
  tiles[3][2]={type:'water',water:1};
  tiles[4][2]={type:'wall'};
  tiles[5][2]={type:'grass',solid:true};
  const activeScene=new Node();
  const player={x:4.5*64,y:4.5*64,angle:0,health:100};
  const deps={TILE:64,player,getCurrentArea:()=>currentArea,getActiveScene:()=>activeScene,
    worldSurfaceY:()=>0,hostileObjects:new Set(),showToast(){}};
  const game={console,THREE,localStorage,__hobunjiPlayerProfile:{worldId:'arena-regression'},
    EnvironmentSurfaceMicroPlateau:{bindGroundProjection(mesh){groundProjectionBinds++;mesh.userData.environmentGroundProjection=true;}},
    Combat:{deps,init(){},update(){},beginStagedAction(){},spawnMeleeTrail(){}},
    GridTileAccessors:{getActiveScene:()=>activeScene,getActiveGrid:()=>tiles,
      isTownBuildingCollisionTile:(c,r)=>c===6&&r===6},
    AuthoredFurniture:{load:async()=>asset,buildGroup:()=>{modelBuilds++;return authoredGroup();}},
    DevSpawner:{init(){}},__farmLog(){}};
  game.window=game;
  vm.createContext(game);
  vm.runInContext(code,game,{filename:'shattercasks.js'});
  for(let i=0;i<4;i++){
    const p=await game.Shattercasks.spawnRandomInDevArena();
    assert(p.col>0&&p.col<8&&p.row>0&&p.row<8,'spawn keeps clear of arena border');
    assert(![ 'rock','water','wall' ].includes(tiles[p.row][p.col].type),'spawn is on walkable ground');
    assert(!(p.col===2&&p.row===5),'solid tiles are excluded');
    assert(!(p.col===6&&p.row===6),'building-collision tiles are excluded');
    assert(!(p.col===4&&p.row===4),'spawn avoids standing on player');
    assert.equal(game.Shattercasks.debugSnapshot().vases.length,i+1,'one live Shattercask per click');
    assert.equal(activeScene.children.length,i+1,'real authored meshes appear in scene');
  }
  assert.equal(modelBuilds,4,'each explicit spawn creates one authored Shattercask');
  // Tool Select is a pickup input even with equipment out; holding the
  // physical object remaps Item Action 1/2 to charged Throw/Drop.
  const first=game.Shattercasks.debugSnapshot().vases[0];
  player.x=(first.col+.5)*64;player.y=(first.row+.5)*64;
  let heldMode='tool';
  game.ActionArcUI={heldMode:()=>heldMode};
  assert.equal(game.Shattercasks.toolArchAction(),'pickup','faced Shattercask claims Tool Select with tool equipped');
  // This game mode renders the player as ONE skinned avatar with two material
  // groups, not a separate npc_avatar_back_plane. A carry effect must isolate
  // the rear group without hiding the front or drawing through world geometry.
  const body=new Node(),portrait=new SkinnedMesh({groups:[{materialIndex:0},{materialIndex:1}]},[
    new Material({name:'npc_avatar_skinned_front_material',visible:true,depthWrite:true}),
    new Material({name:'npc_avatar_skinned_back_material',visible:true,depthTest:true,depthWrite:true})
  ]);
  portrait.name='player_skinned_plane_assembly';
  portrait.bind({bones:[]},{});
  body.add(portrait);
  const rearHeadwear=new Mesh({},new Material({depthTest:true,depthWrite:false,visible:true}));
  rearHeadwear.name='player_avatar_back_hat_xray_plane';
  rearHeadwear.renderOrder=2;
  body.add(rearHeadwear);
  game.ProceduralHandAttachments={gameDeps:{playerMesh:body}};
  assert(game.Shattercasks.toolArchTap(),'contextual tool tap picks up and stows gear');
  let rearState=game.Shattercasks.debugSnapshot().rearPortraitXray;
  assert.equal(rearState.skinnedBackOnlyPasses,1,'one skinned rear-only x-ray is generated while carrying');
  assert.equal(rearState.rearHeadwearOverlays,1,'the separately skinned back of the head is also included');
  assert.equal(rearHeadwear.renderOrder,2.6,'rear head surfaces render after the carried Shattercask');
  assert.equal(rearHeadwear.material.depthTest,true,'rear head retains normal world occlusion');
  assert.equal(portrait.material[0].visible,true,'front portrait stays unchanged');
  assert.equal(portrait.material[1].visible,false,'original rear pass is suppressed, preventing double blending');
  const rearOverlay=body.children.find(node=>node.userData?.shattercaskRearOverlay);
  assert(rearOverlay && rearOverlay.material[0].visible===false && rearOverlay.material[1].visible===true,
    'x-ray overlay draws the back PNG only, not the opposite face');
  assert.equal(rearOverlay.material[1].depthTest,true,'rear x-ray cannot pass through world terrain');
  assert.equal(rearOverlay.material[1].depthWrite,true,'rear x-ray still occludes objects behind the carrier');
  assert.equal(rearOverlay.skeleton,portrait.skeleton,'rear overlay reuses existing bones rather than a second rig');
  assert.equal(rearState.heldPartsWithoutDepthWrite,1,'only held cask mesh stops writing depth');
  // Execute the production classifier: render order 1.5 silently opts a mesh
  // into a separate post-world weapon draw, overriding portrait ordering.
  const heldRenderer=fs.readFileSync(path.join(root,'docs/js/held-object-render-order.js'),'utf8');
  const isLegacyHeldPlane=vm.runInNewContext('('+heldRenderer.match(/function isLegacyHeldPlane\(object\) \{[\s\S]*?\n  \}/)[0]+')',
    {LEGACY_HELD_RENDER_ORDER:1.5});
  assert(isLegacyHeldPlane({isMesh:true,renderOrder:1.5,userData:{}}),'fixture exercises the reserved weapon replay order');
  for(const mesh of activeScene.children.find(node=>node.userData?.shattercaskId===first.id).userData.meshById.values())
    assert.equal(isLegacyHeldPlane(mesh),false,'physical cask stays in world colour pass below rear portrait');
  // A late portrait rebuild must replace the overlay and restore the old
  // material before attaching the new skinned back on the next poll.
  const rebuilt=new SkinnedMesh(portrait.geometry,[
    new Material({name:'npc_avatar_skinned_front_material',visible:true,depthWrite:true}),
    new Material({name:'npc_avatar_skinned_back_material',visible:true,depthTest:true,depthWrite:true})
  ]);
  rebuilt.name='player_rebuilt_skinned_plane_assembly';
  rebuilt.bind(portrait.skeleton,portrait.bindMatrix);
  body.remove(portrait);body.add(rebuilt);
  game.Combat.update(.18);
  rearState=game.Shattercasks.debugSnapshot().rearPortraitXray;
  assert.equal(rearState.skinnedBackOnlyPasses,1,'avatar rebuild replaces, not duplicates, the rear x-ray');
  assert.equal(portrait.material[1].visible,true,'replaced avatar rear material is restored');
  assert.equal(rebuilt.material[1].visible,false,'new rear group owns the overlay');
  assert.equal(game.Shattercasks.toolArchAction(),null,'while carrying, Tool Select is no longer the Drop action');
  deps.getPlayerInteractionRay=()=>({origin:{x:player.x/64-2,y:1,z:player.y/64},direction:{x:1,y:-.5,z:0}});
  assert(game.Shattercasks.startShatterAim(),'Item Action 1 starts hold-to-aim for the physically carried object');
  const aimSnapshot=game.Shattercasks.debugSnapshot().throwAim;
  assert(aimSnapshot.target.x>player.x/64+1,
    'low camera angle can hit ground behind the player, but the Shattercask reticle stays forward');
  const ring=activeScene.children.find(node=>node.name==='shattercask_ground_projected_throw_reticle'); // Actual reusable aim mesh.
  assert(ring?.visible,'holding throw displays a ground preview');
  assert.equal(ring.geometry.innerRadius,0,'filled footprint includes the landing point');
  assert.equal(ring.geometry.radialSegments,6,'interior rings allow uneven ground projection');
  assert.equal(ring.scale.x,game.Shattercasks.RADIUS,'preview matches actual blast radius');
  assert.equal(ring.renderOrder,40,'preview draws above raised terrain covers like flasks');
  assert.equal(groundProjectionBinds,1,'raised-surface projection is bound once');
  deps.getGroundYAtWorld=(x,z)=>.2*x-.1*z;
  game.Combat.update(.1);
  assert(Math.abs(ring.geometry.heights[1]-.2)<1e-6,'preview outer edge follows rising terrain');
  assert(Math.abs(ring.geometry.heights[2]-.1)<1e-6,'ground rotation uses the correct Z sign');
  assert(ring.geometry.boundsUpdated,'terrain changes refresh culling bounds');
  assert.equal(game.Shattercasks.debugSnapshot().throwPreview.terrainProjected,true,'mobile diagnostics report projection');
  assert(game.Shattercasks.releaseShatterAim(),'releasing Item Action 1 starts the throw stage');
  assert.equal(ring.visible,true,'preview remains visible through release windup');
  game.Shattercasks.cancelShatterAim();
  assert.equal(ring.visible,false,'cancel hides the preview');
  assert(game.Shattercasks.drop(),'Item Action 2 drops held Shattercask');
  assert.equal(game.Shattercasks.debugSnapshot().held,null,'no ghost held charge remains');
  assert.equal(rebuilt.material[1].visible,true,'drop restores real skinned back PNG rendering');
  assert.equal(rearHeadwear.renderOrder,2,'drop restores the native rear head render order');
  assert.equal(rearHeadwear.material.depthWrite,false,'drop restores the native headwear depth semantics');
  assert.equal(body.children.filter(node=>node.userData?.shattercaskRearOverlay).length,0,
    'drop disposes the back-only overlay and detaches its render pass');
  assert.equal(game.Shattercasks.debugSnapshot().rearPortraitXray.skinnedBackOnlyPasses,0,
    'post-drop diagnostics confirm there is no leftover overlay');
  const before=game.Shattercasks.debugSnapshot().vases.length;
  currentArea='town';
  await assert.rejects(game.Shattercasks.spawnRandomInDevArena(),/Testing Arena/);
  assert.equal(game.Shattercasks.debugSnapshot().vases.length,0,'out-of-area spawn does not create a charge');
  currentArea='map_dev_arena';
  assert.equal(before,4);
  for(let r=1;r<8;r++)for(let c=1;c<8;c++)tiles[r][c]={type:'rock'};
  await assert.rejects(game.Shattercasks.spawnRandomInDevArena(),/No unoccupied walkable tile/);
  assert.equal(modelBuilds,4,'no art created for rejected requests');
}
(async()=>{
  await arenaScenario();
  await scenario(false);
  await scenario(true);
  console.log('PASS shattercasks: model silhouette raycast + 5-tile area effect + loot + reload');
})().catch(error=>{console.error(error);process.exitCode=1;});
