'use strict';

// Focused regression: Nohuknuk is one NPC, one creature-art body/neck, and two
// pairs of existing humanoid animation sockets. All material overrides are local.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const read = path => fs.readFileSync(path, 'utf8');
const assembler = read('docs/js/bipedal-monster-assembler.js');
const sidecar = JSON.parse(read('docs/config/npcs/species-overrides.json'));
const entry = sidecar.npcs.nohuknuk;
const rig = entry.bipedalMonsterRig;
const speciesIndex = JSON.parse(read('docs/config/species/index.json')); // Registered NPC species must exist before NpcAvatarPreview.randomProfile selects a fighter.
const nohuknukSpecies = JSON.parse(read('docs/config/species/nohuknuk.json'));
const studio = read('docs/tools/character-studio/index.html');
const rigMaster = read('docs/config/attachment-rig-profiles.js');
const boots = read('docs/js/attachment-rig-latest-authored-snapshot.js');
const localDb = read('docs/js/local-db-overrides.js');
const feet = read('docs/js/procedural-leg-animation.js');
const hands = read('docs/js/procedural-hand-attachments.js');
const locale = JSON.parse(read('docs/config/locales/locale_old_man_nohuknuk_shrine.json'));

assert.equal(entry.kind, 'bipedal-monster');
assert.equal(entry.species, 'nohuknuk');
assert.ok(speciesIndex.entries.some(item => item.speciesId === 'nohuknuk' && item.path === './nohuknuk.json'));
assert.equal(nohuknukSpecies.parentSpecies,'engh-sho');
assert.equal(nohuknukSpecies.npcOnly,true);
assert.ok(studio.includes('bipedal-monster-assembler.js'));

assert.equal(rig.handModel, 'primate');
assert.equal(rig.footModel, 'primate');
assert.equal(rig.uvMode, 'stretch-fit');
assert.equal(rig.materials.body.color, '#CECECE');
assert.equal(rig.materials.bone.color, '#0D0D0D');
assert.equal(rig.materials.body.texture, 'assets/textures/canvas.png');
assert.equal(rig.materials.bone.texture, 'assets/textures/canvas.png');
assert.ok(fs.existsSync('docs/' + rig.sprite));
assert.ok(fs.existsSync('docs/assets/models/hands/hand_primate.glb'));
assert.ok(fs.existsSync('docs/assets/models/feet/foot_primate.glb'));
assert.ok(fs.existsSync('docs/assets/textures/canvas.png'));
assert.ok(rigMaster.includes("masterCharacters['nohuknuk::male']"));
assert.ok(boots.includes('bipedal-monster-assembler.js'));
assert.ok(localDb.includes("override?.kind === 'bipedal-monster'"));
assert.ok(localDb.includes("npc.appearance.avatarType = 'bipedal-monster'"));
assert.ok(feet.includes('HobunjiBipedalMonsterAssembler?.materialForSpecies'));
assert.ok(hands.includes('HobunjiBipedalMonsterAssembler?.materialForSpecies'));
assert.equal(locale.npcAnchors[0].npcId, 'nohuknuk');

function glbMaterialMap(path) {
  const bytes = fs.readFileSync(path);
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
  const jsonSize = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonSize).toString('utf8').trim());
  return json.meshes.map(mesh => ({
    name: mesh.name,
    material: json.materials[mesh.primitives[0].material].name,
  }));
}
for (const kind of ['hand', 'foot']) {
  const meshes = glbMaterialMap('docs/assets/models/' + (kind === 'hand' ? 'hands/' : 'feet/') + kind + '_primate.glb');
  assert.ok(meshes.some(mesh => mesh.name.endsWith('_fur') && mesh.material === 'MAT_EyeSurface_0c0c0c'));
  assert.ok(meshes.some(mesh => mesh.name.endsWith('_claws') && mesh.material === 'MAT_None_7a4e2e'));
}

class Group {
  constructor() {
    this.children = []; this.userData = {};
    this.rotation = { x: 0, y: 0, z: 0 };
    this.position = { x: 0, y: 0, z: 0, set(x,y,z) { this.x=x; this.y=y; this.z=z; } };
    this.parent = null; this.name = '';
  }
  add(child) { this.children.push(child); child.parent = this; }
  updateMatrixWorld() {}
  getWorldPosition(out) { out.x=this.position.x;out.y=this.position.y;out.z=this.position.z;return out; }
}
class Vector3 { constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;} }
const THREE = { Group, Vector3 };
const handsConfig = { models: {
  sloth: { glb:'sloth.glb',materialRoles: { Original:'body' } },
}, speciesModels:{} };
const window = {
  SCRATCHBONES_CONFIG: { game:{
    appearanceEditor:{species:{}},
    assets:{pngPlaneAvatar:{proceduralFeet:{species:{}}}},
  }},
  HobunjiHandModelProfiles: {
    data:handsConfig,
    mutate(fn){fn(this.data);},
  },
  PNGPlaneAvatar: {
    buildSinglePlaneAvatarModel(){ return { fallback: true }; },
    buildAnimalPlaneAvatarModel(_THREE, url, options){
      this.lastOptions = options;
      this.lastSpriteUrl = url;
      const group = new Group();
      // Simulate AnimalHeadRigRuntime's SkinnedMesh replacement. The stale
      // objects returned in frontPlane/backPlane must never receive callbacks.
      const oldFront = {isMesh:true,userData:{hobunjiPlaneFace:'front'}};
      const oldBack = {isMesh:true,userData:{hobunjiPlaneFace:'back'}};
      const front = {isMesh:true,userData:{hobunjiPlaneFace:'front'}};
      const back = {isMesh:true,userData:{hobunjiPlaneFace:'back'}};
      group.add(front);group.add(back);
      this.latestFront=front;this.latestBack=back;
      const ref={group,frontPlane:oldFront,backPlane:oldBack,headRig:{ available:true },
        updateHeadRotation(deg){ this.lastPitch=deg; },
        updateHeadYaw(deg){this.lastYaw=deg;},
        dispose(){this.disposeCount=(this.disposeCount||0)+1;}};
      this.latestRef=ref;
      return ref;
    },
    disposeAvatarModel(){this.fallbackDisposals=(this.fallbackDisposals||0)+1;},
  },
  NpcAvatarPreview: {
    renderProfileToCanvas(){return true;},
    buildProfileFromNpcExport(npc){return {portraitSeatId:npc.id};},
  },
  PerpRotation: {
    CREATURE_PLANE_ROT_MODE:'halt',CREATURE_PERP_DEAD_RAD:.4,
    cameraRelativeCreaturePerpsAtWorldPosition(){return [0,Math.PI/2];},
    perpClamp(_state,yaw){return {effectiveTarget:yaw+.25,snapTo:null};},
  },
};
const document = {currentScript:{src:'https://example.test/docs/js/bipedal-monster-assembler.js'}};
vm.runInNewContext(assembler, {window,document,performance:{now:()=>100},URL,console,Map,Set,Image:undefined});
const api = window.HobunjiBipedalMonsterAssembler;
assert.equal(api.type, 'bipedal-monster');
assert.equal(window.SCRATCHBONES_CONFIG.game.appearanceEditor.species.nohuknuk.parentSpecies,'engh-sho');
assert.equal(handsConfig.speciesModels.nohuknuk,'primate');
assert.equal(handsConfig.models.primate.glb,'assets/models/hands/hand_primate.glb');
assert.equal(handsConfig.models.primate.materialRoles.MAT_EyeSurface_0c0c0c,'body');
assert.equal(handsConfig.models.primate.materialRoles.MAT_None_7a4e2e,'bone');
assert.equal(window.SCRATCHBONES_CONFIG.game.assets.pngPlaneAvatar.proceduralFeet.species.nohuknuk.glb,
  'assets/models/feet/foot_primate.glb');
assert.equal(api.materialForSpecies('nohuknuk','body').color,'#CECECE');
assert.equal(api.materialForSpecies('nohuknuk','bone').color,'#0D0D0D');
assert.equal(api.materialForSpecies('engh-sho','bone'),null);

const npc={id:'nohuknuk',species:'nohuknuk',bipedalMonsterRig:rig};
const profile=window.NpcAvatarPreview.buildProfileFromNpcExport({id:'nohuknuk',appearance:{bipedalMonsterRig:rig}});
assert.equal(profile.bipedalMonsterRig?.handModel,'primate','NPC portrait retains reusable hybrid rig metadata');

const root=window.PNGPlaneAvatar.buildSinglePlaneAvatarModel(THREE,{width:200,height:200},{npcRecord:npc});
assert.equal(root.userData.bipedalMonster,true);
assert.equal(root.userData.portraitModelHeight,rig.modelHeight);
assert.equal(root.userData.neckRig.creatureHeadRig.available,true);
assert.equal(root.children.length,1,'only the creature body is assembled, no hidden humanoid portrait');
assert.ok(root.children[0].children.some(child=>child.name==='nohuknuk_creature_neck_control'));
assert.ok(window.PNGPlaneAvatar.lastSpriteUrl.endsWith('/docs/'+rig.sprite));
assert.equal(window.PNGPlaneAvatar.lastOptions.creatureId,'nohuknuk');
assert.equal(window.PNGPlaneAvatar.lastOptions.headRig.weightMap.data.length,48*48);
assert.equal(typeof window.PNGPlaneAvatar.latestFront.onBeforeRender,'function','live skinned plane gets facing callback');
assert.equal(typeof window.PNGPlaneAvatar.latestRef.frontPlane.onBeforeRender,'function','ref exposes the live mesh');

const npcRoot = new Group();npcRoot.rotation.y=.1;
const floorRig = new Group();
const walker={root:npcRoot,rec:npc,desiredRot:.9,rot:.1,_moveSpeedTiles:.3,_npcCharacterRigRoot:floorRig};
window._npcWalkers=new Map([['nohuknuk',walker]]);
root.userData.neckRig.neckJoint.rotation.x=-.3;
root.userData.neckRig.neckJoint.rotation.y=.2;
const camera={getWorldPosition(out){out.x=2;out.z=5;return out;}};
window.PNGPlaneAvatar.latestFront.onBeforeRender(null,null,camera);
assert.ok(Math.abs(floorRig.rotation.y-(.9+.25-.1))<1e-6,
  'one creature deadzone controls both body and GLB limb frame');
assert.ok(Math.abs(window.PNGPlaneAvatar.latestRef.lastPitch-(-.3*180/Math.PI))<1e-6,
  'NPC neck pitch drives painted creature head bones');
assert.ok(Math.abs(window.PNGPlaneAvatar.latestRef.lastYaw-(.2*180/Math.PI))<1e-6,
  'NPC neck yaw drives painted creature head bones');
assert.equal(root.userData.neckRig.neckJoint.parent,root.children[0]);

const other=window.PNGPlaneAvatar.buildSinglePlaneAvatarModel(THREE,{width:100},{npcRecord:{id:'regular'}});
assert.equal(other.fallback,true,'ordinary humanoids must remain on their original builder');
window.PNGPlaneAvatar.disposeAvatarModel(root);
assert.equal(window.PNGPlaneAvatar.latestRef.disposeCount,1,'animal textures and head skins release once');
assert.equal(api.diagnostics().active,0);
window.PNGPlaneAvatar.disposeAvatarModel(other);
assert.equal(window.PNGPlaneAvatar.fallbackDisposals,1,'ordinary humanoid disposal is unchanged');

console.log('bipedal-monster assembler: material roles, assets, animation parent, creature deadzones, neck, and disposal OK');
