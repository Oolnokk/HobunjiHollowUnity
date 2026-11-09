'use strict';
// Regression: the exit's serialized tile is fixed even when its visible floor
// spur is removed. Game, editor, door geometry and wall geometry must agree.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const context={window:{THREE:{}},console};
vm.runInNewContext(fs.readFileSync('docs/js/interior-scene-builder.js','utf8'),context,{filename:'interior-scene-builder.js'});
vm.runInNewContext(fs.readFileSync('docs/js/interior-door-tiles.js','utf8'),context,{filename:'interior-door-tiles.js'});
const Walls=context.window.InteriorSceneBuilder;
const Doors=context.window.InteriorDoorTiles;
const game=fs.readFileSync('docs/game.js','utf8');
const editor=fs.readFileSync('docs/tools/building-interior-author/index.html','utf8');
assert(game.includes('cell.exitOnlyNoVisualFloor = true;'),'game must expose a traversable logical tile without creating visual floor');
assert(game.includes('insideFloorForExit?.(floorSet, transition.col, transition.row, transition.direction)'),'walkability requires a real inward floor neighbor');
assert(editor.includes('// Exit markers are allowed off floor:'),'erasing floor must preserve an authored exit');
assert(editor.includes('InteriorDoorTiles.doorPosition(record)'),'editor uses game door positioning');
assert(editor.includes('var authoredExit=exitAt[0];'), 'erasing a floor stub must retain the authored exit position');
assert(editor.includes('.concat(e.tiles||[])'), 'painting floor cannot accidentally recreate a protrusion under an outside exit');
const directions={north:[0,-1],south:[0,1],east:[1,0],west:[-1,0]};
let floorless=0,mapsChanged=0,doorsChecked=0;
for(const file of fs.readdirSync('docs/config/maps').filter(name=>/^map_i_.*\.json$/.test(name))){
  const map=JSON.parse(fs.readFileSync('docs/config/maps/'+file,'utf8'));
  const floor=new Set((map.floor||[]).map(([c,r])=>c+','+r));
  const wallHeight=Number(map.wallHeight)||1.75;
  const outsideExits=[];
  for(const exit of map.exits||[])for(const [c,r] of exit.tiles||[]){
    if(floor.has(c+','+r)){
      const adjacent=[[c-1,r],[c+1,r],[c,r-1],[c,r+1]].filter(([x,y])=>floor.has(x+','+y));
      assert(adjacent.length!==1 || exit.keepFloorKnob===true, file+': exit '+exit.id+' has an unnecessary painted one-cell floor protrusion (author the exit outside the footprint instead)');
      continue; // Broad flush-to-wall entrances and explicitly retained landing tiles still belong on the floor.
    }
    floorless++;
    outsideExits.push(exit);
    assert(directions[exit.direction],file+': floorless exit must specify its inward wall normal');
    const next=Doors.insideFloorForExit(floor,c,r,exit.direction);
    assert(next,file+': exit '+c+','+r+' must touch its intended interior floor tile');
    assert.equal(Math.abs(next.col-c)+Math.abs(next.row-r),1);
    assert(!floor.has(c+','+r),file+': no visible floor under exit');
    const neighboringFloor=[[c-1,r],[c+1,r],[c,r-1],[c,r+1]].filter(([x,y])=>floor.has(x+','+y));
    assert.equal(neighboringFloor.length,1,file+': only genuinely narrow, one-cell knobs may be removed');
    if(exit.generateDoor){
      const [group]=Doors.doorGroupsOf({exits:[exit],floor:map.floor},floor);
      assert(group,file+': floorless exit still produces a physical wooden door');
      const p=Doors.doorPosition(group);
      assert.equal(p.x,(c+next.col+1)/2,file+': door X must lie on footprint edge');
      assert.equal(p.z,(r+next.row+1)/2,file+': door Z must lie on footprint edge');
      doorsChecked++;
    }
    const panels=Walls.buildWallPanels(floor,new Set([c+','+r]),wallHeight);
    const border=panels.filter(p=>p.id.includes('lintel')&&Math.abs(p.position[1]-Walls.DOORWAY_TOP_Y)<1e-6);
    assert(border.length,file+': a physical-height wall must continue over the exit opening');
    assert(border.some(p=>Math.abs(p.position[0]-(c+next.col+1)/2)<.51&&Math.abs(p.position[2]-(r+next.row+1)/2)<.51),file+': lintel must share the door boundary');
  }
  if(outsideExits.length)mapsChanged++;
}
const temple=JSON.parse(fs.readFileSync('docs/config/maps/map_i_temple.json','utf8'));
const basement=temple.exits.find(e=>e.id==='exit_mqfk2hox');
assert.deepEqual(basement.tiles,[[15,4]],'temple basement exit authored coordinates must be unchanged');
assert(!temple.floor.some(([c,r])=>c===15&&r===4),'temple basement exit does not render a floor knob');
assert(!basement.doorwayTiles?.length,'basement exit itself is now the exterior marker');
assert(floorless>=25,'broad map sweep should actually remove obvious exit-only floor stubs');
console.log('Floorless exit stubs: '+floorless+' exit cells in '+mapsChanged+' maps checked, '+doorsChecked+' physical door frames checked.');
