'use strict';
// Standalone no-browser regression for the four-piece Find the Blocks lab.
// Uses tiny Three.js-compatible stubs; actual projectile, flame, movement and rendering integration
// remains covered by scripts/audit-single-room-puzzles-browser.js.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

class Object3D{
  constructor(){
    this.isObject3D=true;this.children=[];this.userData={};this.visible=true;
    this.position={x:0,y:0,z:0,set(x,y,z){this.x=x;this.y=y;this.z=z}};
    this.scale={x:1,y:1,z:1};this.rotation={x:0,y:0,z:0};
  }
  add(child){child.parent=this;this.children.push(child);}
  remove(child){this.children=this.children.filter(item=>item!==child);child.parent=null;}
  traverse(callback){callback(this);for(const child of this.children)child.traverse(callback);}
}
class Mesh extends Object3D{
  constructor(geometry,material){super();this.geometry=geometry;this.material=material;this.isMesh=true;}
}
class Material{
  constructor(options={}){
    Object.assign(this,options);
    this.color={setHex(value){this.hex=value;}};
    this.emissive={setHex(value){this.hex=value;}};
  }
}
class Geometry{}
const THREE={
  Group:Object3D,Mesh,BoxGeometry:Geometry,CylinderGeometry:Geometry,ConeGeometry:Geometry,
  MeshBasicMaterial:Material,MeshStandardMaterial:Material
}; // Stand-ins only for construction, not graphics output.
const source=fs.readFileSync(path.join(__dirname,'../docs/js/dev-ruin-find-blocks.js'),'utf8');
new vm.Script(source,{filename:'dev-ruin-find-blocks.js'}); // Catch syntax errors before running any behavioral checks.

function test(seed){
  const fireTargets=[],projectileTargets=[],breakablePillars=[],registeredBlocks=[],surfaces=[],cleared=[],barriers=[]; // Retain the actual authored obstruction centers for a push-route audit.
  const soloGroup=new Object3D(); // Parent scene has the same lifetime as one Puzzle Lab reroll.
  let melody=null,solved=0;
  const env={
    THREE,
    DevRandomRuin:{
      registerLabPushBlock(mesh){registeredBlocks.push(mesh);return true;},
      isSlidingPushBlock(){return false;}
    },
    DevRandomRuinTileOccupancy:{
      addSolidBox(id,box,enabled){barriers.push({id,box,enabled});return true;},
      clearSolids(tag){cleared.push(tag);}
    },
    DynamicSurfaces:{
      sampleSupport(x,z){
        // The test's 24x24 room centers at 12.5: the raised source begins at (7.5,17.5).
        return x>=7.2&&x<=8.6&&z>=16&&z<=19?{y:2.52}:null;
      }
    },
    DevRandomRuinFurniturePieces:{build(){return null;}},
    DungeonFire:{
      registerTarget(target){fireTargets.push(target);return target.id;},
      unregisterTarget(id){cleared.push(id);},
      armNextProjectile(){return true;}
    },
    HronalWitchBombs:{
      registerBreakable(_stone,options){breakablePillars.push(options);return ()=>cleared.push('breakable');},
      registerDispenser(){return true;},
      unregisterDispenser(){cleared.push('dispenser');},
      dispenseFromMechanism(){return true;}
    },
    RuinLayerChallenges:{
      compose(options){
        assert.equal(options.kind,'melodyEcho');
        assert.equal(options.mapId,'map_i_dev_random_ruin','manual note events must be scoped to this ruin');
        assert.equal(options.melodySurfaces.length,2,'the song can appear on either exposed pillar face');
        const plateX=options.room.x+options.room.w/2,plateZ=options.room.z+options.room.d/2; // Both selected faces must point toward the plate.
        for(const surface of options.melodySurfaces)
          assert(Math.sin(surface.yaw)*(plateX-surface.x)+Math.cos(surface.yaw)*(plateZ-surface.z)>0);
        melody={tick(){},animate(){},dispose(){cleared.push('melody');},solve:options.onSolved};
        return melody;
      }
    }
  }; // Each seed gets fresh services, so a previous variant cannot leak state into the next one.
  vm.runInNewContext(source,env,{filename:'dev-ruin-find-blocks.js'});
  const state={controls:[]}; // The test ensures controls are removed rather than accumulating between lab rerolls.
  const kit={
    state,group:()=>soloGroup,
    disposeObject:object=>object.parent?.remove(object), // Mimics the real SimplePuzzles mesh teardown after its GPU resources are disposed.
    registerSurface:surface=>surfaces.push(surface),
    registerProjectileTarget:target=>projectileTargets.push(target),
    playerWorld:()=>({x:0,y:0,z:0}),deps:{showToast(){}}
  };
  const room=env.DevRuinFindBlocks.create({
    THREE,kit,context:{seed,ceilingY:5},room:{x:0,z:0,w:24,d:24},y:0,
    isActive:()=>true,onSolved:()=>solved++
  });
  assert.equal(room.blocks.length,4);
  assert.equal(room.plates.length,4);
  assert.equal(registeredBlocks.length,4);
  // Native block pushes are whole world-unit steps. Every plate must lie on that same lattice.
  for(const plate of room.plates){
    assert(Number.isInteger(plate.x-room.blocks[0].mesh.position.x),'Plate X matches the native sliding grid');
    assert(Number.isInteger(plate.z-room.blocks[0].mesh.position.z),'Plate Z matches the native sliding grid');
  }
  assert.equal(room.blocks[2].phase,'ready','Elevated block is pushable at spawn');
  assert.equal(room.blocks[2].mesh.userData.findBlocksCanDrop,true);
  assert.equal(surfaces.length,9,'Seven stairs, their dais and tower support are registered');
  assert.equal(room.solved,false);

  for(const kind of ['net','ice']){
    const target=fireTargets.find(item=>item.id.endsWith('-'+kind));
    assert(target,'Both ceiling mechanisms need native DungeonFire targets');
    assert.notEqual(target.onBurn(),false,'Fire must release the overhead restraint');
  }
  for(let i=0;i<100;i++)room.tick(.05);
  assert.equal(room.blocks[0].phase,'ready','Net block lands after fire');
  assert.equal(room.blocks[1].phase,'ready','Ice block lands after melting');

  const ledge=room.blocks[2];
  assert.equal(ledge.phase,'ready','On the elevated dais the block must remain pushable');
  ledge.mesh.position.x+=2; // The real V50 pusher handles this horizontal move; this tests drop resolution.
  room.tick(.05);
  assert.equal(ledge.phase,'falling','Block leaves elevated support and begins falling');
  for(let i=0;i<100;i++)room.tick(.05);
  assert.equal(ledge.phase,'ready','Block settles and re-enters the native pusher');
  assert.equal(ledge.mesh.userData.findBlocksCanDrop,false,'Grounded blocks must not keep the ledge exception');

  if(seed===0){
    assert(melody,'Melody variant must use existing ruin melody composer');
    melody.solve();for(let i=0;i<100;i++)room.tick(.05);
    assert(room.snapshot().pillarHeight<.1,'Solved flute phrase sinks the pillar');
  }else if(seed===1){
    assert.equal(projectileTargets.length,3,'Projectile variant registers three ranged targets');
    const posts=[[13.5,15.5],[15.5,13.5],[17.5,13.5]]; // The three solid blocker pillars frame the central room.
    projectileTargets.forEach((target,i)=>{
      const [px,pz]=posts[i],glyph=target.hitMesh.position;
      assert(Math.max(Math.abs(glyph.x-px),Math.abs(glyph.z-pz))>.475,
        'Projectile glyph needs a visible exposed face, not a buried stone hitbox');
      target.onHit();
    });
    for(let i=0;i<100;i++)room.tick(.05);
    assert(room.snapshot().pillarHeight<.1,'All projectile glyphs sink the pillar');
  }else{
    assert.equal(breakablePillars.length,1,'Cracked pillar must register with actual bomb explosions');
    breakablePillars[0].onBreak();
    for(let i=0;i<100;i++)room.tick(.05);
    assert.equal(room.blocks[3].phase,'ready','A witch-bomb blast frees the fourth block');
  }
  assert.equal(room.solved,false,'Release subpuzzles never bypass the final four plates');
  const free=(x,z)=>{
    if(x<.5||x>23.5||z<.5||z>23.5)return false;
    return !barriers.some(barrier=>{
      if(barrier.enabled?.()===false)return false;
      return Math.abs(x-barrier.box.cx)<barrier.box.halfX+.41
        &&Math.abs(z-barrier.box.cz)<barrier.box.halfZ+.41;
    });
  }; // Mirrors square push-block bounds and the authored pillar footprints.
  const route=(block,plate)=>{
    const start=block.mesh.position;
    const pending=[[start.x,start.z]],seen=new Set();
    while(pending.length){
      const [x,z]=pending.shift(),key=x+','+z;
      if(seen.has(key))continue;
      seen.add(key);
      if(Math.abs(x-plate.x)<.01&&Math.abs(z-plate.z)<.01)return true;
      for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
        // A push needs BOTH the target square and a free square behind the block for the player.
        if(free(x+dx,z+dz)&&free(x-dx,z-dz))pending.push([x+dx,z+dz]);
      }
    }
    return false;
  };
  const matches=(i,used)=>i===4||room.plates.some((plate,j)=>
    !(used&(1<<j))&&route(room.blocks[i],plate)&&matches(i+1,used|(1<<j)));
  assert(matches(0,0),'All four released blocks must have distinct push-reachable plate destinations');
  for(let i=0;i<4;i++){
    const b=room.blocks[i],p=room.plates[i];
    b.phase='ready';b.mesh.userData.findBlocksCanDrop=false;
    b.mesh.position.set(p.x,.41,p.z); // Place using actual grid coordinates; no synthetic solved flags.
    if(i===2){room.tick(.05);assert.equal(room.solved,false,'Three plates cannot open the gate');}
  }
  room.tick(.05);
  assert.equal(room.solved,true);
  assert.equal(solved,1,'The completion event fires only once');
  room.tick(.05);
  assert.equal(solved,1);
  room.dispose();
  assert.equal(state.controls.length,0,'No ghost interaction controls remain after reroll');
  assert(cleared.includes('find-the-blocks'),'Custom blocker footprints are released');
  assert.equal(cleared.filter(id=>id.endsWith('-net')||id.endsWith('-ice')).length,2,'Both flame targets are unregistered');
  // V50 ceiling heights vary with generated wall profiles; none of the four blocks may breach a short roof.
  const lowRoof=3.05;
  const tight=env.DevRuinFindBlocks.create({
    THREE,kit,context:{seed,ceilingY:lowRoof},room:{x:0,z:0,w:24,d:24},y:0,
    isActive:()=>true,onSolved:()=>{}
  });
  assert(tight.snapshot().stairRise<.36,'The climbing route compresses safely when the ceiling is low');
  for(const block of tight.blocks)
    assert(block.mesh.position.y+.41<=lowRoof-.17,'No block may clip through a real V50 ceiling: '+block.name);
  tight.dispose();
  assert.equal(state.controls.length,0,'A short-roof reroll must also release every control');
  return room.variant;
}
assert.deepEqual([0,1,2].map(test),['melody','projectiles','witchBomb']);
console.log('PASS Find the Blocks: 4 movable blocks, 4 plates, fire, ice, winding rise, ledge drop, 3 pillar variants, gate, cleanup');
