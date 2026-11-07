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

function test(seed,size=24){
  const center=Math.floor(size*.5)+.5,offset=Math.max(4,Math.min(5,Math.floor(size*.29))); // Exercise both generous lab rooms and minimum-sized 18x18 shaft rooms.
  const fireTargets=[],projectileTargets=[],breakablePillars=[],registeredBlocks=[],unregisteredBlocks=[],surfaces=[],cleared=[],barriers=[]; // Retain native registration and cleanup records along with authored obstruction centers.
  const soloGroup=new Object3D(); // Parent scene has the same lifetime as one Puzzle Lab reroll.
  const subpuzzles=[]; // Every nested melody/glyph/rail challenge must be solved and disposed through its real callback seam.
  let solved=0,playerFloor=16; // Simulates transitions between independently stacked dungeon stories for height-aware blockers.
  const env={
    THREE,
    DevRandomRuin:{
      registerLabPushBlock(mesh){registeredBlocks.push(mesh);return true;},
      unregisterLabPushBlock(mesh){unregisteredBlocks.push(mesh);return true;},
      getPlayerGroundSupportY(){return playerFloor;},
      isSlidingPushBlock(){return false;}
    },
    DevRandomRuinTileOccupancy:{
      addSolidBox(id,box,enabled){barriers.push({id,box,enabled});return true;},
      clearSolids(tag){cleared.push(tag);}
    },
    DynamicSurfaces:{
      sampleSupport(x,z){
        // The elevated source support follows the same per-room offset as the real winding dais.
        return x>=center-offset-.3&&x<=center-offset+1.1&&z>=center+offset-1.5&&z<=center+offset+1.5?{y:2.52}:null;
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
    ProceduralFurniture:{
      makePartMaterial(spec){
        assert.equal(spec.materialTexture,'carved_smooth.png','Every requested authored stone material uses the dungeon texture');
        assert.equal(spec.materialLighting,'unlit','Stone follows the native ruin wall lighting');
        const textured=new Material();
        textured.userData={materialTexture:spec.materialTexture}; // Inspectable marker for geometry-specific texture coverage assertions.
        return textured;
      }
    },
    RuinLayerChallenges:{
      compose(options){
        const challenge={kind:options.kind,id:options.id,tick(){},animate(){},dispose(){cleared.push('challenge:'+options.id);},solve:options.onSolved};
        subpuzzles.push(challenge);
        return challenge;
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
    THREE,kit,context:{seed,ceilingY:5},room:{x:0,z:0,w:size,d:size},y:0,
    isActive:()=>true,onSolved:()=>solved++
  });
  assert.equal(room.blocks.length,4);
  assert.equal(room.plates.length,4);
  const named=new Map();
  soloGroup.traverse(object=>{if(object?.isMesh&&object?.name)named.set(object.name,object);});
  for(const name of ['find-block-net','find-block-inset-net','find-blocks-pressure-plate-0',
    'find-blocks-plate-frame-0','find-blocks-winding-step-0','find-blocks-high-platform',
    'find-blocks-tall-pillar','find-blocks-blocker-0','find-blocks-gate']){
    const mesh=named.get(name);
    assert(mesh,'Required gameplay mesh exists: '+name);
    assert.equal(mesh.material?.userData?.materialTexture,'carved_smooth.png',
      'All major Find the Blocks stone surfaces, plates, trim and marks must be carved smooth: '+name);
  }
  assert.notEqual(named.get('find-blocks-ice-fire-hit')?.material?.userData?.materialTexture,
    'carved_smooth.png','The invisible ice contact target must retain ice behavior rather than stone texture');
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

  const net=fireTargets.find(item=>item.id.endsWith('-net'));
  if(room.netVariant==='fire'){
    assert(net,'Burnable ceiling net uses the native DungeonFire target');
    assert.notEqual(net.onBurn(),false,'Fire must sever the ceiling net');
  }else{
    assert.equal(net,undefined,'Non-fire net variant must not expose a fake burn target');
    const netUnlock=subpuzzles.find(challenge=>challenge.id.endsWith('-net-challenge'));
    assert(netUnlock,'The ceiling net must be linked to a real reusable subpuzzle');
    assert.equal(netUnlock.kind,room.netVariant==='glyphs'?'glyphObelisk':room.netVariant==='movingTargets'?'ceilingRailTargets':'melodyEcho');
    netUnlock.solve();
  }
  const ice=fireTargets.find(item=>item.id.endsWith('-ice'));
  assert(ice,'Ceiling icicles always use the existing DungeonFire system');
  assert.notEqual(ice.onBurn(),false);
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

  if(room.variant==='melody'||room.variant==='ceilingRail'){
    const pillarUnlock=subpuzzles.find(challenge=>challenge.id.endsWith('-pillar-unlock'));
    assert(pillarUnlock,'Tall pillar must use a real native melody or moving-target challenge');
    assert.equal(pillarUnlock.kind,room.variant==='melody'?'melodyEcho':'ceilingRailTargets');
    pillarUnlock.solve();for(let i=0;i<100;i++)room.tick(.05);
    assert(room.snapshot().pillarHeight<.1,'Solving the native pillar challenge sinks the stone');
  }else if(room.variant==='projectiles'){
    assert.equal(projectileTargets.length,3,'Projectile variant registers three ranged targets');
    const posts=[[center+1,center+3],[center+3,center+1],[center+5,center+1]]; // The three solid blocker pillars frame the central room.
    projectileTargets.forEach((target,i)=>{
      const [px,pz]=posts[i],glyph=target.hitMesh.position;
      assert(Math.max(Math.abs(glyph.x-px),Math.abs(glyph.z-pz))>.475,
        'Projectile glyph needs a visible exposed face, not a buried stone hitbox');
      target.onHit();
    });
    for(let i=0;i<100;i++)room.tick(.05);
    assert(room.snapshot().pillarHeight<.1,'All projectile glyphs sink the pillar');
  }else if(room.variant==='witchBomb'){
    assert.equal(breakablePillars.length,1,'Cracked pillar must register with actual bomb explosions');
    breakablePillars[0].onBreak();
    for(let i=0;i<100;i++)room.tick(.05);
    assert.equal(room.blocks[3].phase,'ready','A witch-bomb blast frees the fourth block');
  }
  assert.equal(room.solved,false,'Release subpuzzles never bypass the final four plates');
  const free=(x,z)=>{
    if(x<.5||x>size-.5||z<.5||z>size-.5)return false;
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
  assert.equal(unregisteredBlocks.length,4,'Every movable block unregisters from the native pusher and V50 occupancy');
  assert.equal(state.controls.length,0,'No ghost interaction controls remain after reroll');
  assert(cleared.some(id=>id.startsWith('find-the-blocks:')),'The specific chamber-owned blocker footprints are released');
  assert.equal(cleared.filter(id=>id.endsWith('-ice')||id.endsWith('-net')).length,room.netVariant==='fire'?2:1,
    'Every registered flame target is unregistered, without inventing a target for other net variants');
  assert.equal(cleared.filter(id=>id.startsWith('challenge:')).length,subpuzzles.length,'All native subpuzzle hooks are disposed');
  // V50 ceiling heights vary with generated wall profiles; none of the four blocks may breach a short roof.
  const lowRoof=3.05;
  const tight=env.DevRuinFindBlocks.create({
    THREE,kit,context:{seed,ceilingY:lowRoof},room:{x:0,z:0,w:size,d:size},y:0,
    isActive:()=>true,onSolved:()=>{}
  });
  assert(tight.snapshot().stairRise<.36,'The climbing route compresses safely when the ceiling is low');
  for(const block of tight.blocks)
    assert(block.mesh.position.y+.41<=lowRoof-.17,'No block may clip through a real V50 ceiling: '+block.name);
  tight.dispose();
  assert.equal(unregisteredBlocks.length,8,'A short-roof reroll releases its own four native push blocks');
  assert.equal(state.controls.length,0,'A short-roof reroll must also release every control');
  if(seed===0){
    const elevated=[]; // Test the separate collision authority used only in layered dungeon stories.
    const wingKit={...kit,registerBlocker:blocker=>elevated.push(blocker)};
    const upper=env.DevRuinFindBlocks.create({
      THREE,kit:wingKit,context:{seed,ceilingY:20.5},room:{id:'floor1-N-room1',x:0,z:0,w:18,d:18},y:16,
      showGate:false,isActive:()=>true,onSolved:()=>{}
    });
    assert(elevated.length>=3,'Pillars and block obstacles use height-aware collision in upper stories');
    const permanent=elevated.find(item=>item.id.endsWith('normal-pillar-0')); // Must remain solid even after the external progress gate opens.
    assert(permanent&&permanent.enabled(),'The current story has physical stone columns');
    for(const obstacle of elevated){
      const mx=(obstacle.bounds.minX+obstacle.bounds.maxX)/2;
      const mz=(obstacle.bounds.minZ+obstacle.bounds.maxZ)/2;
      assert.equal(obstacle.blocksAt(mx,mz,1,null,0,{worldY:16}),true,
        'Raised stone obstacles block movement and pushes on their own story');
      assert.equal(obstacle.blocksAt(mx,mz,1,null,0,{worldY:0}),false,
        'Raised stone obstacles never produce invisible blockers at ground level');
    }
    playerFloor=0;
    assert.equal(permanent.enabled(),false,'Upper-story stone does not block actors exploring below');
    playerFloor=16;
    upper.blocks.forEach((block,i)=>{
      block.phase='ready';block.mesh.position.set(upper.plates[i].x,16+.41,upper.plates[i].z);
    });
    upper.tick(.05);
    assert.equal(upper.solved,true,'Four filled plates can complete an elevated chamber');
    assert.equal(permanent.enabled(),true,'Visible permanent stone remains solid after the wing progression gate opens');
    upper.dispose();
    assert.equal(unregisteredBlocks.length,12,'An elevated chamber unregisters its four native push blocks');
    assert.equal(state.controls.length,0,'Elevated chamber cleanup removes all interactive controls');
    const partialBefore=unregisteredBlocks.length; // A construction failure must roll back partially attached blocks and controls.
    assert.throws(()=>env.DevRuinFindBlocks.create({
      THREE,kit:{...kit,registerSurface(){throw new Error('injected-surface-failure');}},
      context:{seed,ceilingY:5},room:{id:'partial',x:0,z:0,w:18,d:18},y:0,
      isActive:()=>true,onSolved:()=>{}
    }),/injected-surface-failure/);
    assert.equal(unregisteredBlocks.length-partialBefore,3,'Three registered source blocks are released when a late climbing support fails');
    assert.equal(state.controls.length,0,'A half-built puzzle cannot leave an interactable brazier or dispenser');
  }
  return room.variant+'/'+room.netVariant;
}
const combinations=new Set(Array.from({length:16},(_,seed)=>test(seed,24)));
assert.equal(combinations.size,16,'Four independent pillar triggers and four independent net triggers must generate sixteen stable combinations');
for(let seed=0;seed<16;seed++)test(seed,18); // Minimum-sized production rooms must preserve four distinct pushable paths.
console.log('PASS Find the Blocks: 16 native mechanism combinations, 4 blocks/plates, real fire/ice/ledge, reachable push paths, scoped cleanup');
