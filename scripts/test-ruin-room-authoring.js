'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../docs/js/dev-random-ruin-room-authoring.js'), 'utf8');
const repositoryLibrary = {
  schema:'hobunji_ruin_room_library.v1',
  templates:[],
  proceduralProfiles:[],
};
const storage = new Map();
const window = {};
const sandbox = {
  window,
  document:{
    baseURI:'https://example.test/index.html',
    currentScript:{src:'https://example.test/js/dev-random-ruin-room-authoring.js'},
  },
  fetch:async()=>({ok:true,json:async()=>repositoryLibrary}),
  localStorage:{
    getItem:key=>storage.get(key)??null,
    setItem:(key,value)=>storage.set(key,String(value)),
  },
  URL, Set, Map, WeakMap, Number, String, Math, JSON, Object, Array, Promise, console,
};
vm.runInNewContext(source,sandbox,{filename:'dev-random-ruin-room-authoring.js'});

function makeTemplate() {
  return {
    id:'ring-chamber',
    name:'Ring Chamber',
    enabled:true,
    weight:1,
    rotations:[0],
    match:{minDoors:1,maxDoors:1,roomIds:[]},
    footprint:{
      width:5,
      height:5,
      rows:['#####','##.##','##.##','##.##','#####'],
    },
    connections:[{id:'west-corridor',side:'west',offset:2.5,width:1,kind:'corridor',required:true}],
    spots:[
      {id:'plate',label:'Pressure plate',x:1,z:2,required:true,maxUses:1,allowlists:{mechanisms:[],activators:['pressurePlate'],decorations:[]}},
      {id:'door',label:'Stone door',x:3,z:2,required:true,maxUses:1,allowlists:{mechanisms:['stoneDoor'],activators:[],decorations:[]}},
    ],
    puzzleLinks:[{id:'plate-opens-door',activatorSpot:'plate',mechanismSpot:'door',relation:'activates',required:true}],
  };
}
function makeNetwork(id='room_1',width=5,height=5) {
  const floorSet=vm.runInNewContext('new Set()'); // Simulate the hidden V50 iframe's Set constructor, distinct from the parent page's realm.
  for(let z=0;z<height;z++)for(let x=0;x<width;x++)floorSet.add((10+x)+','+(10+z));
  return {
    floorSet,
    rooms:[{id,col:10,row:10,w:width,h:height,sizeClass:'small'}],
    doorways:[{axis:'x',boundary:10,center:12.5,widthCells:1,from:'hall_1',to:id}],
    entrance:null,
    cellSize:.5,
    worldWidth:40,
    worldDepth:40,
  };
}

(async()=>{
  const api=window.DevRandomRuinRoomAuthoring;
  await api.ready;

  const validLibrary={schema:'hobunji_ruin_room_library.v1',templates:[makeTemplate()],proceduralProfiles:[]};
  const validation=api.validateLibrary(validLibrary);
  assert.deepEqual(Array.from(validation),[],'valid template, connection and puzzle link should pass validation');
  assert.equal(api.setLibrary(validLibrary).ok,true,'valid authored template should be selectable');

  const network=makeNetwork();
  const applied=api.applyToNetwork(network,{seed:'room-mask-regression'});
  assert.equal(applied.ok,true,'supported V50 room network should accept authoring');
  assert.equal(applied.applied,1,'one room should receive one plan');
  assert.equal(applied.plans[0].source,'template','matching authored template should be selected');
  assert.equal(applied.plans[0].templateId,'ring-chamber');
  assert.equal(applied.carvedCells,3,'three central room cells should be carved');
  assert.equal(network.floorSet.has('12,11'),false,'authored void should be removed from the real floor set');
  assert.equal(network.floorSet.has('10,12'),true,'the required doorway edge cell must remain walkable');
  assert.equal(network.floorSet.has('11,12'),true,'walkable footprint cells remain in the floor set');

  const widerDoorNetwork=makeNetwork('room_wider_door');
  widerDoorNetwork.doorways[0].widthCells=3;
  const widerDoorResult=api.applyToNetwork(widerDoorNetwork,{seed:'wide-door-regression'});
  assert.equal(widerDoorResult.plans[0].source,'procedural','a template with a narrower opening must be skipped');
  assert.equal(widerDoorResult.carvedCells,0,'a mismatched doorway must not carve the room');

  const plan=network.rooms[0].roomAuthoringPlan;
  const initialRequirements=api.getDiagnostics({roomAuthoringPlans:[JSON.parse(JSON.stringify(plan))]});
  assert.equal(initialRequirements.missingRequiredSpots.length,2,'required spots should be visible before anything claims them');
  assert.equal(initialRequirements.missingRequiredLinks.length,1,'required puzzle links should be visible before being composed');
  assert.ok(api.canClaimSpotForPlan(plan,'room_1','activators','pressurePlate'));
  assert.ok(api.canClaimSpotForPlan(plan,'room_1','mechanisms','stoneDoor'));
  assert.equal(api.canClaimSpotForPlan(plan,'room_1','decorations','statue'),false,'empty decoration allowlist must reject decorations');
  const mechanism=api.claimSpotForPlan(plan,'room_1','mechanisms','stoneDoor',{claimId:'test-door'});
  assert.equal(mechanism.ok,true,'mechanism allowlist should claim the door spot');
  assert.equal(mechanism.spot.id,'door');
  assert.equal(api.claimSpotForPlan(plan,'room_1','mechanisms','stoneDoor').ok,false,'maxUses should prevent duplicate claims');
  const activator=api.claimSpotForPlan(plan,'room_1','activators','pressurePlate',{claimId:'test-plate'});
  assert.equal(activator.ok,true,'activator allowlist should claim the plate spot');
  assert.equal(activator.spot.id,'plate');
  assert.equal(api.claimSpotForPlan(plan,'room_1','decorations','statue').ok,false,'disallowed category/type should be rejected');
  assert.equal(api.releaseSpotForPlan(plan,mechanism.claim),true,'a claim can be released when its module placement is rolled back');
  assert.equal(api.canClaimSpotForPlan(plan,'room_1','mechanisms','stoneDoor'),true,'released spot becomes available again');

  const diagnostics=api.getDiagnostics(network);
  assert.ok(diagnostics.claims.length>=2,'successful placement claims should be available for diagnostics');
  assert.ok(diagnostics.rejections.length>=2,'rejected placements should be recorded for diagnostics');

  const linkedNetwork=makeNetwork('room_linked');
  const linkedPlan=api.applyToNetwork(linkedNetwork,{seed:'linked-puzzle-regression'}).plans[0];
  const clonedLinkedPlan=JSON.parse(JSON.stringify(linkedPlan)); // V50 returns cloned metadata to the parent runtime; claim state must survive that boundary.
  assert.equal(api.canClaimPuzzleLinkForPlan(linkedPlan,'room_linked','stoneDoor','pressurePlate'),true,'authored relationship should preflight both named spots');
  const linkedPair=api.claimPuzzleLinkForPlan(linkedPlan,'room_linked','stoneDoor','pressurePlate',{claimId:'door-plate-pair'});
  assert.equal(linkedPair.ok,true,'authored activator/mechanism relationship should claim atomically');
  assert.equal(linkedPair.link.id,'plate-opens-door');
  assert.equal(linkedPair.mechanism.spot.id,'door');
  assert.equal(linkedPair.activator.spot.id,'plate');
  assert.equal(api.canClaimPuzzleLinkForPlan(clonedLinkedPlan,'room_linked','stoneDoor','pressurePlate'),false,'cloned metadata must see the original generation’s exhausted link and spots');
  assert.equal(api.claimPuzzleLinkForPlan(clonedLinkedPlan,'room_linked','stoneDoor','pressurePlate').ok,false,'a second runtime layer cannot claim the same authored pair');
  const clonedMetadata={roomAuthoringPlans:[clonedLinkedPlan],rooms:[{id:'room_linked',roomAuthoringPlan:clonedLinkedPlan}]};
  assert.equal(api.getDiagnostics(clonedMetadata).links.length,1,'linked pair diagnostics survive the metadata clone without duplicates');
  assert.equal(api.getDiagnostics(clonedMetadata).claims.length,2,'both linked spot claims survive the metadata clone');
  assert.equal(api.getDiagnostics(clonedMetadata).missingRequiredSpots.length,0,'required spots are satisfied by the linked puzzle');
  assert.equal(api.getDiagnostics(clonedMetadata).missingRequiredLinks.length,0,'required puzzle link is satisfied by its linked pair');

  const profileLibrary={
    schema:'hobunji_ruin_room_library.v1',
    templates:[{...makeTemplate(),id:'wrong-size',enabled:true,footprint:{width:5,height:5,rows:Array(5).fill('#####')},connections:[{id:'west',side:'west',offset:2.5,width:1,kind:'corridor'}]}],
    proceduralProfiles:[{
      id:'large-chamber',name:'Large chamber rules',enabled:true,weight:1,
      match:{minWidth:8,maxWidth:12,minHeight:8,maxHeight:12,minDoors:0,maxDoors:2,sizeClasses:['large'],roomIds:[]},
      spots:[{id:'center',label:'Center',u:.5,v:.5,allowlists:{mechanisms:['movingPlatform'],activators:['lever'],decorations:['statue']}}],
      puzzleLinks:[],
    }],
  };
  assert.deepEqual(Array.from(api.validateLibrary(profileLibrary)),[],'procedural profile should validate');
  assert.equal(api.setLibrary(profileLibrary).ok,true,'profile library should load into the runtime');
  const large=makeNetwork('room_large',8,8);
  large.rooms[0].sizeClass='large';
  large.doorways=[];
  const profileResult=api.applyToNetwork(large,{seed:'profile-regression'});
  assert.equal(profileResult.ok,true);
  assert.equal(profileResult.plans[0].source,'procedural','non-matching footprint should fall back to a procedural profile');
  assert.equal(profileResult.plans[0].profileId,'large-chamber');
  assert.equal(profileResult.plans[0].spots[0].world.x,-13,'normalized center spot should resolve from room-local coordinates and network origin');

  const weightedLibrary={
    schema:'hobunji_ruin_room_library.v1',
    templates:[{id:'weighted-template',name:'Weighted template',enabled:true,weight:0,rotations:[0],match:{minDoors:0,maxDoors:0,roomIds:[]},footprint:{width:8,height:8,rows:Array(8).fill('########')},connections:[],spots:[],puzzleLinks:[]}],
    proceduralProfiles:[{id:'weighted-profile',name:'Weighted profile',enabled:true,weight:1,match:{minWidth:8,maxWidth:8,minHeight:8,maxHeight:8,minDoors:0,maxDoors:0,sizeClasses:[],roomIds:[]},spots:[],puzzleLinks:[]}],
  };
  assert.equal(api.validateLibrary(weightedLibrary).length,0,'weighted template/profile test library should validate');
  assert.equal(api.setLibrary(weightedLibrary).ok,true);
  const weightedNetwork=makeNetwork('weighted-room',8,8);weightedNetwork.doorways=[];
  assert.equal(api.applyToNetwork(weightedNetwork,{seed:'weighted-selection'}).plans[0].source,'procedural','zero-weight authored templates yield to an enabled procedural profile');
  weightedLibrary.templates[0].weight=100;weightedLibrary.proceduralProfiles[0].weight=0;api.setLibrary(weightedLibrary);
  const authoredNetwork=makeNetwork('authored-room',8,8);authoredNetwork.doorways=[];
  assert.equal(api.applyToNetwork(authoredNetwork,{seed:'weighted-selection'}).plans[0].source,'template','a higher-weight authored template can be selected over procedural defaults');

  const invalid={schema:'hobunji_ruin_room_library.v1',templates:[{
    ...makeTemplate(),id:'disconnected',footprint:{width:3,height:3,rows:['#.#','...','#.#']},connections:[],spots:[],puzzleLinks:[],
  }],proceduralProfiles:[]};
  assert.ok(api.validateLibrary(invalid).some(message=>message.includes('connected shape')),'disconnected floor masks must be rejected');

  console.log('Ruin room authoring tests passed: template mask, doorway retention, procedural fallback, allowlists, claim limits, release and diagnostics.');
})().catch(error=>{
  console.error(error);
  process.exitCode=1;
});