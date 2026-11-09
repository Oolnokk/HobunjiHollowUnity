'use strict';
// Exercise the actual Building Interior Editor's paint/move/coordinate functions
// in a headless canvas setup. A source-only assertion missed the user's bug:
// a saved inward direction could make every otherwise valid outside tile fail.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('docs/tools/building-interior-author/index.html','utf8');
assert.match(html,/<option value="">Automatic<\/option>\s*<option value="north">North ↑<\/option>/,
  'North must be a real select option, not a malformed end-tag');
assert.match(html,/<button id="toolMoveExit"/,'Move exit must be visibly selectable');
assert.match(html,/<button id="moveExitToCoords"/,'Precise coordinate placement must be available');
assert(html.includes('for(var r=1;r<rows-1;r++) for(var c=1;c<cols-1;c++) floor.push([c,r]);'),
  'new interiors must reserve a visible unpainted tile ring for outside doorway authoring');
const js=html.slice(html.indexOf('function isFloor(c,r)'),html.lastIndexOf('})(); // end IIFE'));
const extractFunction=name=>{
  const start=js.indexOf('function '+name+'(');
  assert(start!==-1,'Missing editor function '+name);
  const first=js.indexOf('{',start);
  let depth=0,end=first;
  for(;end<js.length;end++){
    if(js[end]==='{')depth++;
    if(js[end]==='}'&&!--depth)break;
  }
  assert(end<js.length,'Unterminated editor function '+name);
  return js.slice(start,end+1);
};
const inputs={
  exitDirection:{value:''},
  exitTileCol:{value:''},
  exitTileRow:{value:''},
  exitPlacementHelp:{textContent:''},
  exitCanvasStatus:{textContent:'',style:{},classList:{remove(){}}}, // Exercises the real inline feedback helper alongside placement.
};
const messages=[],calls={draw:0,preview:0,export:0,lists:0,undo:0};
const selected={id:'exit_room',label:'Bedroom',tiles:[[1,1]],direction:'east',targetMap:'map_i_hall',generateDoor:true,spawnCol:9,spawnRow:6};
const other={id:'exit_other',tiles:[[2,4]],direction:'east',targetMap:'map_i_elsewhere'};
const state={interior:{cols:8,rows:8,exits:[selected,other]},floorSet:new Set(['3,3','3,4','4,4']),activeExitId:'exit_room',tool:'moveExit'};
const listeners={};
const $=id=>id==='moveExitToCoords'?{addEventListener:(event,callback)=>{listeners[event]=callback;}}:inputs[id];
const context=vm.createContext({
  state,$,window:{__biaSelExit:function(id){state.activeExitId=id;inputs.exitDirection.value=state.interior.exits.find(e=>e.id===id).direction||'';}},log:(message,level)=>messages.push([message,level]),
  inGrid:(c,r)=>c>=0&&r>=0&&c<state.interior.cols&&r<state.interior.rows,
  drawGrid:()=>calls.draw++,rebuild3D:()=>calls.preview++,refreshExport:()=>calls.export++,
  renderExitList:()=>calls.lists++,pushUndo:()=>calls.undo++,
  gridCell:event=>({c:event.c,r:event.r}),
  setActiveFurniture:()=>{},activeFurniture:()=>[],
  furnitureOccupiesTile:()=>false,syncFloorFromSet:()=>{},
});
const sources=[
  'const EXIT_INWARD={north:[0,-1],south:[0,1],west:[-1,0],east:[1,0]};',
  extractFunction('isFloor'),
  extractFunction('reportExitPlacement'),
  extractFunction('resolveExitPlacement'),
  extractFunction('editExitAt'),
  extractFunction('gridAction'),
];
vm.runInContext(sources.join('\n'),context,{filename:'building-interior-author/exit-paint-subset.js'});
const invoke=(c,r,tool)=>{state.tool=tool;vm.runInContext('gridAction({c:'+c+',r:'+r+'})',context);};
invoke(3,5,'moveExit'); // Northward room-floor neighbor; old east-facing direction must NOT prevent the move.
assert.deepEqual(JSON.parse(JSON.stringify(selected.tiles)),[[3,5]],'clicking outside floor must relocate the exit to exactly the clicked tile');
assert.equal(selected.direction,'north','a single neighboring floor tile sets the physical door facing');
assert.equal(inputs.exitDirection.value,'north');
assert(!state.floorSet.has('3,5'),'painting a door must never paint a floor slab');
assert.equal(selected.id,'exit_room');assert.equal(selected.targetMap,'map_i_hall');
assert.equal(selected.spawnCol,9);assert.equal(selected.generateDoor,true);
assert(calls.preview>=1&&calls.export>=1&&calls.draw>=1,'paint action must rebuild visuals and export');
assert.match(inputs.exitCanvasStatus.textContent,/outside floor.*no floor tile added/i);
assert.equal(inputs.exitCanvasStatus.textContent,inputs.exitPlacementHelp.textContent);
assert.equal(inputs.exitCanvasStatus.style.color,'var(--ok)');

invoke(4,5,'paintExit'); // Another opening along the same north-facing wall can be part of a two-tile doorway.
assert.deepEqual(JSON.parse(JSON.stringify(selected.tiles)),[[3,5],[4,5]],'paint adds aligned exit cells without silently relocating them');
assert(!state.floorSet.has('4,5'));
const saved=JSON.parse(JSON.stringify(state.interior));
assert.deepEqual(saved.exits[0].tiles,[[3,5],[4,5]],'saved JSON preserves outside-floor authored coordinates');

inputs.exitTileCol.value='2';inputs.exitTileRow.value='3';
const registrationStart=js.indexOf("$('moveExitToCoords').addEventListener('click',function(){");
assert(registrationStart>=0,'Coordinate move handler not wired to the button');
const registrationEnd=js.indexOf("$('delExitBtn').addEventListener",registrationStart);
assert(registrationEnd>registrationStart,'Cannot identify coordinate move handler');
vm.runInContext(js.slice(registrationStart,registrationEnd),context,{filename:'building-interior-author/numeric-move.js'});
assert.equal(typeof listeners.click,'function');
listeners.click();
assert.deepEqual(JSON.parse(JSON.stringify(selected.tiles)),[[2,3]],'numeric Move replaces exit tiles rather than appending a duplicate');
assert.equal(selected.direction,'east');
assert(!state.floorSet.has('2,3'));
assert.equal(calls.undo,1,'numeric move integrates with undo history');
assert.equal(inputs.exitTileCol.value,2);assert.equal(inputs.exitTileRow.value,3);

invoke(7,7,'moveExit'); // A blank tile without painted neighbors is not a valid doorway.
assert.deepEqual(JSON.parse(JSON.stringify(selected.tiles)),[[2,3]],'invalid click must not corrupt selected exit');
assert(messages.at(-1)[1]==='warn'&&/must touch one painted/.test(messages.at(-1)[0]));
assert.match(inputs.exitCanvasStatus.textContent,/Cannot place exit.*must touch one painted/i);
assert.equal(inputs.exitCanvasStatus.style.color,'var(--warn)');
invoke(2,4,'moveExit'); // Cannot steal another exit's location.
assert.deepEqual(JSON.parse(JSON.stringify(selected.tiles)),[[2,3]]);
assert(/Another exit already owns/.test(messages.at(-1)[0]));

state.floorSet=new Set(['2,3','3,2']); // Corner (2,2) abuts east and south floor; direction must be disambiguated.
inputs.exitDirection.value='';
selected.direction='';
invoke(2,2,'moveExit');
assert.deepEqual(JSON.parse(JSON.stringify(selected.tiles)),[[2,3]],'ambiguous corner must reject automatic orientation');
assert(/Choose its inward direction/.test(messages.at(-1)[0]));
inputs.exitDirection.value='south';
invoke(2,2,'moveExit');
assert.deepEqual(JSON.parse(JSON.stringify(selected.tiles)),[[2,2]],'manual south selection resolves a two-sided corner');
assert.equal(selected.direction,'south');

// A common single-exit map can be painted immediately after loading without first finding and clicking Edit.
state.interior.exits=[selected];
state.activeExitId=null;
state.floorSet=new Set(['4,4']);
inputs.exitDirection.value='north';
invoke(4,5,'paintExit');
assert.equal(state.activeExitId,selected.id,'Paint exit automatically selects the only available exit');
assert.deepEqual(JSON.parse(JSON.stringify(selected.tiles)),[[2,2],[4,5]],
  'painting without a prior exit selection appends to the only existing exit on the chosen floor boundary');

assert(html.includes("moveExit:'toolMoveExit'"),'canvas tool must be selectable');
assert(html.includes("'paintExit','moveExit','eraseExit'"),'drag painting must dispatch move-exit as well');
console.log('Interior Editor exit painting: click, move, orientation, corner, JSON, precise coordinates, previews and validation passed.');
