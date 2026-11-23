#!/usr/bin/env node
'use strict';
// Real key-statue visual owner with only WebGL/canvas boundaries replaced by tiny
// doubles. Covers army loadout authority, Tzizkhanash carving, size, mobility,
// cleanup and late-promise cancellation without rendering an entire dungeon.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('docs/js/key-statue-figures.js','utf8');
const ancestor=fs.readFileSync('docs/js/festival-ancestor-figures.js','utf8');
const march=fs.readFileSync('docs/js/harlyao-night-march-runtime.js','utf8');
assert(ancestor.includes('createCarvedFigure')&&ancestor.includes('buildFigure(window.THREE,record,pose,String(id),stone)'),
  'Key Statue uses the shrine Tzizkhanash portrait and stone-cell renderer, not a second stone material');
assert(march.includes("window.MinionCombat.rollRoster(SPECIES_ID")&&march.includes('window.MinionCombat.defaultWeaponShapes'),
  'the ghost march supplies the two existing loadout authorities');

class Group {
  constructor(){this.isObject3D=true;this.children=[];this.parent=null;this.userData={};this.visible=true;
    this.position={set(x,y,z){Object.assign(this,{x,y,z});}};
    this.scale={setScalar(value){this.value=value;}};
  }
  add(child){child.parent=this;this.children.push(child);}
  remove(child){this.children=this.children.filter(node=>node!==child);child.parent=null;}
  traverse(fn){fn(this);for(const child of this.children)child.traverse?.(fn);}
}
class Geometry {
  clone(){return new Geometry();}
  dispose(){Geometry.disposals++;}
}
Geometry.disposals=0;
class Material {
  constructor(opts){Object.assign(this,opts);}
  dispose(){Material.disposals++;}
}
Material.disposals=0;
class Mesh extends Group {
  constructor(geometry,material){super();this.isMesh=true;this.geometry=geometry;this.material=material;
    this.rotation={x:-Math.PI/2,z:0,copy(other){this.x=other.x;this.z=other.z;}};}
}
class Bounds {
  setFromObject(object){this.root=object;this.min={x:-.5,y:-.2,z:-.1};this.max={x:.5,y:1.8,z:.1};return this;}
  getSize(out){out.x=this.max.x-this.min.x;out.y=this.max.y-this.min.y;out.z=this.max.z-this.min.z;}
}
const THREE={Group,Mesh,Box3:Bounds,Vector3:class{},CanvasTexture:class {
  constructor(canvas){this.image=canvas;}
  dispose(){this.disposed=true;}
},MeshBasicMaterial:Material,NearestFilter:'nearest',DoubleSide:'both'};
const document={createElement(name){assert.equal(name,'canvas');return {width:0,height:0,
  getContext:()=>({drawImage(){}})};}};
const rosterCalls=[]; // Proves this is the real army wardrobe family, not a custom recolor/costume table.
const artistCalls=[]; // Captures frozen pose requests and verifies disposal.
const hostileDressCalls=[]; // Checks the same pants, Temper/armor and dye finishing stages as the live Ghost Army.
const disposed=[]; // Asynchronous cancellation cannot resurrect a destroyed burden.
let textureReady=true; // Switch to missing texture to verify portrait-only failure tolerance.
let deferredFigure=null; // Simulates a portrait arriving after the statue has been recalled.
const makeFigure=()=>({model:Object.assign(new Group(),{userData:{handAttachX:-.2,handAttachY:.25}}),
  parts:{hands:{},legs:{}},stone:{width:64,height:64}});
const artist={
  async createCarvedFigure(record,options){
    artistCalls.push({record,options});
    options.prepareProfile?.({bodyColors:{}}); // The shared Tzizkhanash builder applies the final hostile dye pass before freezing the portrait.
    return deferredFigure ? new Promise(resolve=>{deferredFigure.resolve=resolve;}) : makeFigure();
  },
  disposeFigure(figure){disposed.push(figure);figure?.model?.parent?.remove(figure.model);},
  carvedCanvas(canvas,stone){assert.equal(stone.width,64);return canvas;},
};
const window={
  THREE,GameRandom:{random:()=>.95},
  ProceduralMaskPatterns:{ready:Promise.resolve()},
  BanditCombat:{
    ensureEnemyPants(roster){hostileDressCalls.push('pants');roster.equippedCosmetics.push('pants_basic');},
    applyRosterDyesToProfile(profile,roster){hostileDressCalls.push('dyes');assert(roster.appliedDyes);profile.bodyColors.CLOTH={hex:'#bbaacc'};},
  },
  MetalArmorSystem:{
    decorateAvatarDataWithMetalArmor(roster,items){
      hostileDressCalls.push('metal');assert.equal(items.length,1);
      return {...roster,appearance:{...roster.appearance,armorRendered:true}};
    },
  },
  MinionCombat:{
    defaultWeaponShapes:['daggerSword','fishingspear','hatchet','harlyaoLongsword','harlyaoBroadsword','warhammer'],
    rollRoster(species,name,opts){rosterCalls.push([species,name,opts]);
      return {appearance:{speciesId:species,gender:opts.gender},
        equippedCosmetics:['tankan_bodywrap','bandolier1','rounded_pauldron','tangedcirclet'],appliedDyes:{CLOTH:'dye:CLOTH:muted_red_orange'},
        metalArmorItems:[{metalKey:'nativeCopper'}]};},
  },
  Combat:{deps:{craftedToolItemKey:(shape,metal)=>shape+'_'+metal,
    TOOL_ITEM_DEFS:{warhammer_nativeCopper:{sprite:'assets/toolsprites/warhammer.png'}}}},
  CharacterHeldTools:{
    makeToolPlaneMesh(){
      if(!textureReady)return null;
      const model=new Group();
      const plane=new Mesh(new Geometry(),{map:{image:{width:32,height:64}},dispose(){}});
      model.userData.toolPlane=plane;model.add(plane);return model;
    },
  },
  FestivalAncestorFigures:artist,
};
const diagnostics={warn(){}};
vm.runInNewContext(source,{window,document,console:diagnostics,Image:class {}});
(async()=>{
  const api=window.KeyStatueFigures;
  const spec=api.rollSoldier('defense:one');
  assert.equal(rosterCalls.length,1);
  assert.equal(rosterCalls[0][0],'harlyao');
  assert.equal(rosterCalls[0][2].gender,'male');
  assert.equal(rosterCalls[0][2].equipmentSpeciesId,'harlyao-skeleton',
    'the Harlyao Ghost Army uses skeleton minions for its armor, outfit, and bandolier rolls');
  assert.equal(spec.shapeKey,'warhammer','the sixth canonical marching weapon is reachable');
  assert.deepEqual(hostileDressCalls,['pants'],'the soldier receives hostile pants from the actual bandit wardrobe helper');
  assert.equal(spec.weaponKey,'warhammer_nativeCopper','real forge key, no invented weapon sprite');
  const carrier=new Group();const primitive=new Group();carrier.add(primitive);
  assert.equal(await api.decorate(carrier,spec),true,'the stone soldier replaces the primitive prop');
  assert.equal(primitive.visible,false,'the abstract key body must not show behind the soldier');
  assert.equal(carrier.children.length,2,'the physical Burden root remains intact');
  assert.equal(carrier.userData.ghostArmyStatueInfo.species,'harlyao');
  assert.equal(carrier.userData.ghostArmyStatueInfo.weaponShape,'warhammer');
  assert.equal(carrier.userData.ghostArmyStatueInfo.weaponVisible,true);
  assert.equal(artistCalls.length,1);
  assert.equal(artistCalls[0].record.appearance.armorRendered,true,'stone portrait received the same Temper/metal armor descriptors as live soldiers');
  assert.deepEqual(hostileDressCalls,['pants','metal','dyes'],'portrait uses exact hostile pants, armor and final dye finishing order');
  assert(carrier.userData.ghostArmyStatueInfo.clothing.includes('pants_basic'),'mobile figure metadata exposes the generated soldier pants');
  assert.equal(artistCalls[0].options.pose.scale,1,'render one full frozen NPC before fitting the physical statue');
  const size=carrier.userData.ghostArmyStatueInfo.size;
  assert(Math.abs(size.height-1.12)<.001&&size.width<=.56&&size.depth<=.42,
    'stone soldier plus weapon fits inside the intended original-sized statuette');
  assert.equal(carrier.children[1].children.length,2,'the stone torso and carved physical weapon are both present');
  assert.equal(api.debugSnapshot().active,1);
  api.dispose(carrier);
  assert.equal(primitive.visible,true,'the authored base remains available as emergency fallback');
  assert.equal(api.debugSnapshot().active,0);
  assert.equal(disposed.length,1,'NPC rig textures and hands/feet are explicitly released');
  assert(Geometry.disposals>0&&Material.disposals>0,'per-figure weapon resources are released');

  textureReady=false;const missing=new Group();missing.add(new Group());
  assert.equal(await api.decorate(missing,spec),true,'no weapon PNG must not block the key-statue puzzle');
  assert.equal(missing.userData.ghostArmyStatueInfo.weaponVisible,false);
  api.dispose(missing);

  textureReady=true;deferredFigure={};const removed=new Group();const old=new Group();removed.add(old);
  const pending=api.decorate(removed,spec);
  api.dispose(removed);deferredFigure.resolve(makeFigure());
  assert.equal(await pending,false,'a recalled statue may not receive a late portrait');
  assert.equal(removed.children.length,1,'no sculpture attached to the abandoned object');
  assert.equal(old.visible,true);
  assert.equal(api.debugSnapshot().active,0);
  assert(disposed.length>=3,'even a late portrait is explicitly disposed');
  console.log('key statue Ghost Army carving: shared pools, scaled frozen portrait + weapon, life cycle, missing weapon, and late cancellation PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
