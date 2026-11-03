'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
class Vector3{constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}clone(){return new Vector3(this.x,this.y,this.z);}}
const window={THREE:{Vector3}};
vm.runInNewContext(fs.readFileSync('docs/js/table-chair-placement.js','utf8'),{window,Map,Math,Number,Object,Array});
const api=window.TableChairPlacement;
assert.ok(api);
assert.deepEqual(JSON.parse(JSON.stringify(api.normalize({mode:'orbit',angleDeg:450,distance:.8}))),{mode:'orbit',angleDeg:90,distance:.8});
assert.equal(api.normalize({mode:'edge',side:'diagonal'}),null);
assert.deepEqual(JSON.parse(JSON.stringify(api.localPosition({mode:'orbit',angleDeg:0,distance:.5},2,2))),{x:0,z:1.5});
assert.ok(Math.abs(api.localPosition({mode:'orbit',angleDeg:90,distance:.5},2,2).x-1.5)<1e-9);
assert.deepEqual(JSON.parse(JSON.stringify(api.localPosition({mode:'edge',side:'front',along:0,distance:.25},4,2))),{x:-2,z:1.25});
assert.deepEqual(JSON.parse(JSON.stringify(api.localPosition({mode:'edge',side:'right',along:1,distance:.25},4,2))),{x:2.25,z:1});
const table={position:{x:10,y:0,z:20},rotation:{y:Math.PI/2},updateWorldMatrix(){},localToWorld(v){const c=Math.cos(this.rotation.y),s=Math.sin(this.rotation.y);return new Vector3(this.position.x+c*v.x+s*v.z,v.y,this.position.z-s*v.x+c*v.z);},getWorldPosition(){return new Vector3(this.position.x,this.position.y,this.position.z);}};
const chair={position:{x:0,y:0,z:0,set(x,y,z){this.x=x;this.y=y;this.z=z;}},rotation:{y:0},updateWorldMatrix(){}};
assert.equal(api.apply(chair,table,{mode:'orbit',angleDeg:0,distance:.5},{width:2,depth:2}),true);
assert.ok(Math.abs(chair.position.x-11.5)<1e-9);
assert.ok(Math.abs(chair.position.z-20)<1e-9);
const forward={x:Math.sin(chair.rotation.y),z:Math.cos(chair.rotation.y)},toTable={x:10-chair.position.x,z:20-chair.position.z};
assert.ok(forward.x*toTable.x+forward.z*toTable.z>0,'chair front faces table centroid');
const parent={position:{x:5,y:0,z:5},rotation:{y:Math.PI/2},updateWorldMatrix(){},worldToLocal(v){const dx=v.x-this.position.x,dz=v.z-this.position.z,c=Math.cos(this.rotation.y),s=Math.sin(this.rotation.y);return new Vector3(c*dx-s*dz,v.y-this.position.y,s*dx+c*dz);}};
const nestedChair={parent,position:{x:0,y:0,z:0,set(x,y,z){this.x=x;this.y=y;this.z=z;}},rotation:{y:0},getWorldPosition(){return new Vector3(parent.position.x,parent.position.y,parent.position.z);},updateWorldMatrix(){}};
assert.equal(api.apply(nestedChair,table,{mode:'orbit',angleDeg:0,distance:.5},{width:2,depth:2}),true);
const nestedForward={x:Math.sin(parent.rotation.y+nestedChair.rotation.y),z:Math.cos(parent.rotation.y+nestedChair.rotation.y)};
const nestedWorld={x:parent.position.x+Math.cos(parent.rotation.y)*nestedChair.position.x+Math.sin(parent.rotation.y)*nestedChair.position.z,z:parent.position.z-Math.sin(parent.rotation.y)*nestedChair.position.x+Math.cos(parent.rotation.y)*nestedChair.position.z};
assert.ok(nestedForward.x*(10-nestedWorld.x)+nestedForward.z*(20-nestedWorld.z)>0,'nested chair parent transform preserves world-facing direction');
const farm=fs.readFileSync('docs/js/farm-editor.js','utf8');
assert.match(farm,/tableAttachment: obj\.tableAttachment/);
assert.match(farm,/normalize\?\.\(tableAttachment\)/);
assert.match(farm,/npcStationId: obj\.npcStationId/);
const tableSystem=fs.readFileSync('docs/js/furniture-table-system.js','utf8');
assert.match(tableSystem,/seat\.furnitureId/);
const game=fs.readFileSync('docs/game.js','utf8');
assert.match(game,/stationId = null/);
assert.match(game,/HobunjiFurnitureTableAttachmentMoved/);
assert.match(game,/const linkedChairs =/);
const grid=fs.readFileSync('docs/js/interior-furniture-grid.js','utf8');
assert.match(grid,/isValidTableAttachment/);
const mapEditor=fs.readFileSync('docs/tools/map-editor/index.html','utf8');
assert.match(mapEditor,/id="propTableMode"/);
assert.match(mapEditor,/if\(tableAttachment\) record\.tableAttachment=tableAttachment/);
const interiorAuthor=fs.readFileSync('docs/tools/building-interior-author/index.html','utf8');
assert.match(interiorAuthor,/if\(tableAttachment\)f\.tableAttachment=tableAttachment/);
assert.match(interiorAuthor,/TableChairPlacement\?\.apply/);
// Physical collision is independent of tile occupancy.
const collisionA={x:0,z:0,width:1,depth:1,yaw:0};
assert.equal(api.overlapsFootprints(collisionA,{x:.5,z:0,width:1,depth:1,yaw:0}),true);
assert.equal(api.overlapsFootprints(collisionA,{x:1,z:0,width:1,depth:1,yaw:0}),false);
assert.equal(api.overlapsFootprints(collisionA,{x:.5,z:0,width:1,depth:1,yaw:Math.PI/4}),true);
assert.equal(api.modeForTable('tableRound'),'orbit');
assert.equal(api.modeForTable('tableLong'),'edge');

// Parent changes update only its children, never NPCs belonging to unrelated furniture.
const refreshChair={
  position:new Vector3(0,0,0),rotation:{y:0},parent:{},
  getWorldPosition(){return this.position.clone();},updateWorldMatrix(){},
};
refreshChair.position.set=function(x,y,z){this.x=x;this.y=y;this.z=z;};
refreshChair.position.distanceToSquared=function(v){return (this.x-v.x)**2+(this.y-v.y)**2+(this.z-v.z)**2;};
table.parent={};
let npcMoved=0;
window.HobunjiFurnitureTableAttachmentMoved=()=>npcMoved++;
const entries=[
 {id:'table',root:table,def:{fw:2,fd:2},record:{id:'table'}},
 {id:'chair',root:refreshChair,def:{fw:1,fd:1},record:{id:'chair',tableId:'table',tableAttachment:{mode:'orbit',angleDeg:0,distance:.5}}},
];
assert.equal(api.refreshArea('interior',entries,'unrelated'),0);
assert.equal(api.refreshArea('interior',entries,'table'),1);
assert.equal(api.refreshArea('interior',entries,'table'),0);
assert.equal(npcMoved,1);
table.rotation.y+=Math.PI/2;
assert.equal(api.refreshArea('interior',entries,'table'),1);
assert.equal(npcMoved,2);
assert.equal(api.refreshArea('preview:map',entries,'table'),0);
table.rotation.y+=Math.PI/2;
assert.equal(api.refreshArea('preview:map',entries,'table'),1);
assert.equal(npcMoved,2,'preview must not touch NPC station registry');

vm.runInNewContext(fs.readFileSync('docs/js/interior-furniture-grid.js','utf8'),{window,Map,Math,Number,Object,Array,Set});
const child={id:'chair',itemKey:'chairSimpleFurniture',col:4,row:3,tableId:'table',
 tableAttachment:{mode:'orbit',angleDeg:0,distance:.5}};
const parentTable={id:'table',itemKey:'tableRoundFurniture',col:4,row:2};
const interiorGrid=window.InteriorFurnitureGrid;
assert.equal(interiorGrid.isValidTableAttachment(child,[child,parentTable]),true);
assert.deepEqual(JSON.parse(JSON.stringify(interiorGrid.mergedColliders({colliders:[],furniture:[child,parentTable]}).colliders)),[[4,2],[4,3],[5,2],[5,3]],
 'attached chair must not add a separate occupied tile');
const orphan={...child,tableId:'deleted-table'};
assert.equal(interiorGrid.isValidTableAttachment(orphan,[orphan]),false);
assert.deepEqual(JSON.parse(JSON.stringify(interiorGrid.mergedColliders({colliders:[],furniture:[orphan]}).colliders)),[[4,3]],
 'orphaned chair must regain its tile collision');
assert.ok(game.includes('Math.floor(col), tileRow = Math.floor(row)'), 'NPC navigation uses integer tiles');
assert.ok(game.includes('return furnitureId ?'), 'NPC station ids are unique by furniture instance');
assert.match(game,/nearestDetachedChairTile/,'table removal preserves attached chairs');
assert.match(game,/canKeepAttachedChairHere/,'gameplay validates attachment bounds');
const mapEditorCode=fs.readFileSync('docs/tools/map-editor/index.html','utf8');
assert.ok(mapEditorCode.includes('const previewRecord = { ...record'), 'preview uses copies');
assert.match(mapEditorCode,/id="propTableChoice"/,'Map Editor offers a native table selector');
const index=fs.readFileSync('docs/index.html','utf8');
assert.ok(index.includes('js/table-chair-placement.js?v='), 'shared module loads in game');

console.log('table-chair-placement: geometry, parent refresh, collision, NPC identity, save/restore and editor integration tests passed');
