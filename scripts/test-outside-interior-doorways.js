'use strict';
// The physical doorway may be authored outside painted floor while its travel trigger remains on walkable floor.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('docs/js/interior-door-tiles.js','utf8');
const context={window:{}};vm.runInNewContext(source,context,{filename:'interior-door-tiles.js'});
const api=context.window.InteriorDoorTiles;
const builderContext={window:{THREE:{}},console};
vm.runInNewContext(fs.readFileSync('docs/js/interior-scene-builder.js','utf8'),builderContext,{filename:'interior-scene-builder.js'});
const builder=builderContext.window.InteriorSceneBuilder;
const floor=new Set(['1,1','2,1','3,1','1,2','2,2','3,2']);
const paired={exits:[{id:'wide',tiles:[[1,2],[2,2]],doorwayTiles:[[1,3],[2,3]],direction:'north',generateDoor:true}]};
const groups=api.doorGroupsOf(paired,floor);
assert.equal(groups.length,1,'paired exterior markers must yield one double-door frame');
assert.equal(groups[0].tiles.length,2);
const position=api.doorPosition(groups[0]);
assert.equal(position.x,2);
assert.equal(position.z,3,'door mesh must sit on southern floor boundary, not in the exit trigger tile');
assert.deepEqual(Array.from(paired.exits[0].tiles),[[1,2],[2,2]],'transition trigger coordinates never move off painted floor');
const upper=builder.buildWallPanels(floor,new Set(paired.exits[0].tiles.map(p=>p.join(','))),3.5)
  .filter(p=>p.id.includes('lintel')&&p.position[2]===3);
assert.equal(upper.length,1,'wall above the two outside doorway markers must be a continuous lintel');
assert.equal(upper[0].width,2);
assert.equal(upper[0].position[1],builder.DOORWAY_TOP_Y);
const positions=[
  {direction:'north',inside:[1,1],outside:[1,2],expected:[1.5,2]},
  {direction:'south',inside:[1,1],outside:[1,0],expected:[1.5,1]},
  {direction:'east',inside:[1,1],outside:[0,1],expected:[1,1.5]},
  {direction:'west',inside:[1,1],outside:[2,1],expected:[2,1.5]},
];
for(const sample of positions){
  const exit={id:sample.direction,tiles:[sample.inside],doorwayTiles:[sample.outside],direction:sample.direction,generateDoor:true};
  const [group]=api.doorGroupsOf({exits:[exit]},new Set([sample.inside.join(',')]));
  assert(group,'a single outside-authored doorway must still place its door');
  const p=api.doorPosition(group);
  assert.deepEqual([p.x,p.z],sample.expected, `doorway for ${sample.direction} must use the corresponding boundary plane`);
}
const legacy=api.doorGroupsOf({exits:[{id:'old',tiles:[[1,1]],direction:'north',generateDoor:true}]},new Set(['1,1']))[0];
assert.deepEqual(Object.values(api.doorPosition(legacy)),[1.5,1.5],'old in-floor exits remain in place unless explicitly exterior-authored');
const temple=JSON.parse(fs.readFileSync('docs/config/maps/map_i_temple.json','utf8'));
const templeFloor=new Set(temple.floor.map(p=>p.join(',')));
assert.equal(temple.exits.length,2);
for(const exit of temple.exits){
  assert(exit.generateDoor,'temple exits should retain authored doors');
  if(exit.doorwayTiles?.length){ // Front door still uses an external marker with an in-floor trigger.
    for(const [c,r] of exit.doorwayTiles)assert(!templeFloor.has(`${c},${r}`),'front doorway marker must be outside the painted floor');
    for(const [c,r] of exit.tiles)assert(templeFloor.has(`${c},${r}`),'front doorway keeps its original interior travel trigger');
  }else{ // Basement door is itself authored outside the floor, without moving its saved exit coordinate.
    assert.equal(exit.id,'exit_mqfk2hox');
    assert.deepEqual(exit.tiles,[[15,4]]);
    assert(!templeFloor.has('15,4'),'basement exit floor protrusion is removed');
    assert(api.insideFloorForExit(templeFloor,15,4,exit.direction),'basement exit must have an inward approach');
  }
  const g=api.doorGroupsOf({exits:[exit]},templeFloor)[0];
  assert(g,'temple doorway must resolve as a real door');
  const p=api.doorPosition(g);
  assert(Number.isInteger(p.x)||Number.isInteger(p.z),'door must align to a real wall gridline');
}
const editor=fs.readFileSync('docs/tools/building-interior-author/index.html','utf8');
assert(editor.includes('resolveExitPlacement(c,r,direction)'), 'editor must validate both painted and empty grid cells for exit authoring');
assert(editor.includes("if(!placement.onFloor){"), 'editor must infer facing from the painted floor rather than require an old saved direction');
assert(editor.includes('ez.tiles=[[c,r]]'), 'move exit tool must serialize the marker at the requested coordinates instead of adding a second exit');
assert(editor.includes("(ez.tiles||(ez.tiles=[])).push([c,r])"), 'paint exit must serialize outside positions at their authored coordinates');
assert(editor.includes('var authoredExit=exitAt[0];'), 'erasing a floor stub must retain the exit object at its authored coordinate');
assert(!editor.includes('e.tiles=e.tiles.map(function(p){return p[0]===c&&p[1]===r?[inward.col,inward.row]:p;}'), 'floor eraser must not silently move exit positions');
assert(editor.includes('InteriorDoorTiles.doorPosition(record)'), 'editor 3D preview must match game frame placement');
console.log('Outside-authored doorway anchors, inside triggers, all directions, double doors, temple and legacy parity passed.');
