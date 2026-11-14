#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const read=path=>JSON.parse(fs.readFileSync(path,'utf8')); // Reads exactly the shipped authoring/runtime data.
const piece=read('docs/config/pieces/ikmc-outpost.json'); // Source of roof geometry and its native entrance.
const interior=read('docs/config/maps/map_i_ikmc_outpost.json'); // Interior-side ladder and exit.
const ladder=read('docs/config/furniture-authored/ikmcBalconyLadder.json'); // Shared authoring-driven vertical furniture.
const town=read('docs/config/maps/hobunji_hollow_town.map.json'); // Current approved 180° placement.

const global={}; // Isolated browser-global so the pure balcony generator runs without WebGL.
vm.runInNewContext(fs.readFileSync('docs/js/house-balconies.js','utf8'),{window:global});
const api=global.HouseBalconies;
assert(api?.generateFaces && api?.regenerate,'balcony generator must be available to gameplay and House Editor');
assert.equal(piece.roof.style,'flat-balcony');
assert(!piece.base.faces.some(face=>face.tag==='roof'),'all pitched/shingled roof faces must be removed');
const balcony=piece.balconies.find(record=>record.id==='ikmc_rooftop');
assert(balcony,'named IKMC rooftop balcony exists');
assert.equal(balcony.heightMode,'custom');
assert.equal(balcony.height,interior.wallHeight,'the roof top matches the ladder ceiling');
assert.equal(balcony.deckThickness,.18,'the deck underside envelopes upper logs');
assert.deepEqual(balcony.cells,piece.footprint.cells,'the elevated footprint exactly matches the cabin shell');
assert.equal(balcony.cells.length,24,'IKMC shell is 6 by 4');
assert.equal(piece.footprint.extensions.porches.length,42,'the wraparound exterior porch remains untouched');
assert.equal(piece.footprint.extensions.porchStairs.length,3,'original porch stairs remain untouched');
assert.equal(piece.footprint.extensions.railings.length,20,'original porch rails remain untouched');
const generated=piece.base.faces.filter(face=>face.balconyGenerated);
assert.equal(generated.filter(face=>face.extensionFace==='top').length,24,'walkable roof has one supported top face per shell tile');
assert(generated.filter(face=>face.extensionFace==='top').every(face=>face.v.every(vertex=>vertex[1]===interior.wallHeight)),
  'the balcony sits above the upper roof logs');
assert(generated.some(face=>face.tag==='railing'&&face.extensionFace==='rail'),'railing beams are physical modeled faces');
assert.equal(generated.filter(face=>face.tag==='doorOpening'&&face.extensionFace==='hatch').length,1,'hatch is rendered as one dark rooftop patch');
const normalized=api.normalize(piece)[0];
assert.equal(normalized.height,interior.wallHeight,'normalized custom balcony matches the ladder ceiling');
assert.equal(normalized.deckThickness,.18,'generator retains authored deck depth');
assert(generated.filter(face=>face.extensionFace==='underside').every(face=>face.v.every(v=>Math.abs(v[1]-1.57)<1e-8)),
  'underdeck sits on the rounded upper logs');
assert.equal(api.generateFaces(piece).length,generated.length,'shipped roof geometry agrees with the reusable generator');
const copied=JSON.parse(JSON.stringify(piece));
api.regenerate(copied);api.regenerate(copied);
assert.equal(copied.base.faces.filter(face=>face.balconyGenerated).length,generated.length,'regeneration is idempotent');
assert.equal(copied.base.faces.filter(face=>face.tag==='entryTunnel').length,piece.base.faces.filter(face=>face.tag==='entryTunnel').length,'roof regeneration keeps the entry tunnel');
const custom=JSON.parse(JSON.stringify(piece));
custom.balconies=[{id:'odd_l',heightMode:'custom',height:3.25,cells:[{x:9,y:9},{x:10,y:9},{x:9,y:10}],railings:true}];
custom.roof.style='flat-balcony';
const customFaces=api.generateFaces(custom);
assert.equal(customFaces.filter(face=>face.tag==='balcony'&&face.extensionFace==='top').length,3,'custom L-shaped footprint stays exact');
assert(customFaces.filter(face=>face.tag==='balcony'&&face.extensionFace==='top').every(face=>face.v.every(v=>v[1]===3.25)),
  'user-specified balcony height is applied without silently clamping to wall height');
assert(customFaces.filter(face=>face.extensionFace==='post').length>0,'perimeter has visible rail posts');

const bldg=town.buildings.find(entry=>entry.id==='bldg_ikmc_outpost');
assert(bldg,'town still contains the same outpost');
assert.equal(bldg.rotationDeg,180,'IKMC access regression uses the actual rotated town building');
const all=piece.footprint.cells.concat(...Object.values(piece.footprint.extensions).filter(Array.isArray)); // Full-footprint placement origin.
const minX=Math.min(...all.map(c=>c.x)),minY=Math.min(...all.map(c=>c.y));
const w=Math.max(...all.map(c=>c.x))-minX+1,d=Math.max(...all.map(c=>c.y))-minY+1;
const local=balcony.access.openingTile; // The ceiling patch's tile in House Editor grid coordinates.
const roofCol=bldg.gridX+w-1-(local.x-minX),roofRow=bldg.gridZ+d-1-(local.y-minY);
assert.deepEqual([roofCol,roofRow],[7,45],'roof hatch rotates with the IKMC instead of moving to the old map coordinates');
assert.deepEqual(balcony.access.interiorTile,{col:6,row:8},'balcony entrance references the actual interior ladder tile');
const ladderPlacement=interior.furniture.find(f=>f.id===balcony.access.furnitureId);
assert(ladderPlacement && ladderPlacement.itemKey==='ikmcBalconyLadderFurniture');
assert.deepEqual([ladderPlacement.col,ladderPlacement.row],[6,8]);
const exit=interior.exits.find(e=>e.id==='exit_ikmc_roof_ladder');
assert(exit,'the interior has a climb interaction');
assert.deepEqual(exit.tiles,[[6,8]],'climbing requires the ladder tile');
assert.equal(exit.targetMap,'','interior roof access returns outside without creating another whole map');
assert.deepEqual([exit.spawnCol,exit.spawnRow],[roofCol,roofRow],'interaction exits exactly at the rotated roof hatch');
assert.equal(exit.generateDoor,false,'ladder may not generate an unrelated ordinary door');
assert.equal(interior.wallHeight,ladder.tileSpan.targetHeight,'ladder default top agrees with authored room wall/ceiling height');

assert.equal(ladder.tileSpan.axis,'y');
assert.equal(ladder.tileSpan.verticalTarget,'ceiling');
const roles=Object.groupBy ? Object.groupBy(ladder.parts,part=>part.tileSpanRole) : ladder.parts.reduce((a,p)=>(a[p.tileSpanRole]??=[]).push(p)&&a,{});
assert.equal(roles.start.length,1,'the ladder base is rigid');
assert.equal(roles.end.length,1,'the black ceiling hatch is a single rigid end piece');
assert.equal(roles.stretch.length,2,'only the side stiles physically stretch');
assert.equal(roles.follow.length,9,'the rungs move without deforming their dimensions');
for(const part of roles.stretch.concat(roles.follow)){
  assert.equal(part.tileSpanRoots.start.partId,roles.start[0].id);
  assert.equal(part.tileSpanRoots.end.partId,roles.end[0].id);
}
const game=fs.readFileSync('docs/js/town-zone-buildings.js','utf8'); // Runtime places and rotates the outgoing hatch.
const movement=fs.readFileSync('docs/js/player-jump.js','utf8'); // Height-aware walking accepts only a real interior arrival.
const support=fs.readFileSync('docs/js/town-player-body-elevation-bridge.js','utf8');
const elevationStart=support.indexOf('  function isBalconyAt('); // Test actual shipped collision logic.
const elevationEnd=support.indexOf('  function surfaceLiftAt(',elevationStart);
assert(elevationStart>=0&&elevationEnd>elevationStart,'balcony height collision helper exists');
const balconyChecks=new Function('matchingSupports',support.slice(elevationStart,elevationEnd)+';return {isBalconyAt,isAboveBalconyAt};')(
  ()=>[{kind:'balcony',bounds:{topY:interior.wallHeight}}]
);
assert.equal(balconyChecks.isBalconyAt(7.5,45.5,interior.wallHeight,'town'),true,'standing on rooftop authorizes the hatch');
assert.equal(balconyChecks.isBalconyAt(7.5,45.5,interior.wallHeight+.5,'town'),false,'being airborne above a rooftop does not authorize its hatch');
assert.equal(balconyChecks.isAboveBalconyAt(7.5,45.5,interior.wallHeight+.5,'town'),true,'jumping above rooftop remains passable');
assert.equal(balconyChecks.isAboveBalconyAt(7.5,45.5,interior.wallHeight-.5,'town'),false,'underlying walls remain solid');
assert.match(fs.readFileSync('docs/js/grid-tile-accessors.js','utf8'),/HobunjiWalkableElevation\?\.isAboveBalconyAt/,
  'town building footprint collision checks airborne balcony clearance');
assert.match(movement,/HobunjiWalkableElevation\?\.isAboveBalconyAt/,
  'jump collision fallback also checks airborne balcony clearance');
assert(movement.includes('kind: window.HobunjiWalkableElevation?.isBalconyAt?.'),'roof landing retains elevated support ownership');
const envGlobals={THREE:{},FarmPanel:{init(){}},FarmEditor:{init(){}},GridTileAccessors:{init(){}}}; // Minimal runtime init test.
vm.runInNewContext(fs.readFileSync('docs/js/interior-environment-runtime.js','utf8'),{
  window:envGlobals,location:{pathname:'/docs/index.html'},performance:{now:()=>0},
  setInterval:()=>0,clearInterval(){},console,
},{filename:'interior-environment-runtime.js'});
const registry={DECORATIVE_FURNITURE_DEFS:{},ITEM_DEFS:{}};
envGlobals.FarmPanel.init(registry);
assert.equal(registry.DECORATIVE_FURNITURE_DEFS.ikmcBalconyLadderFurniture?.procKey,'ikmcBalconyLadder',
  'the placed ladder resolves to its authored model, not a white box');
assert.equal(registry.DECORATIVE_FURNITURE_DEFS.ikmcBalconyLadderFurniture.fw,1);
assert(registry.ITEM_DEFS.ikmcBalconyLadderFurniture,'ladder item metadata is registered');
const environmentSource=fs.readFileSync('docs/js/interior-environment-runtime.js','utf8'); // Ceiling stretch height ownership comes from the actual shared runtime.
const fitStart=environmentSource.indexOf('  function fitCeilingFurniture(');
const fitEnd=environmentSource.indexOf('  function applyEnvironmentToScene(',fitStart);
assert(fitStart>=0&&fitEnd>fitStart,'ceiling-fit function is available for an isolated regression');
const editorWindow={AuthoredFurniture:{setTileSpan(_group,height){fittedHeights.push(height);}}}; // Mock editor setup before its height override is installed.
const fittedHeights=[]; // Captures applied target heights without any WebGL or console tools.
const fitInEditor=new Function('IS_INTERIOR_EDITOR','window','buildingSceneMap','loadEnvironmentForMap','DEFAULT_WALL_HEIGHT','lastError',
  environmentSource.slice(fitStart,fitEnd)+';return fitCeilingFurniture;')(
    true,editorWindow,null,()=>Promise.resolve(null),1.75,null);
const previewLadder={userData:{authoredFurnitureData:{tileSpan:{enabled:true,axis:'y',verticalTarget:'ceiling'}}}};
fitInEditor(previewLadder);
assert.deepEqual(fittedHeights,[],'an unset editor ceiling override must not collapse the ladder to height 0.1');
editorWindow.__hobunjiInteriorWallHeightOverride=2.3;
fitInEditor(previewLadder);
assert.deepEqual(fittedHeights,[2.3],'a real editor ceiling height stretches the same ladder to the requested height');
const travelSource=fs.readFileSync('docs/game.js','utf8'); // Actual in-game roof transition permission.
const editor=fs.readFileSync('docs/tools/house-piece-author/index.html','utf8');
assert.match(game,/roofHatch|roofAccess|roofY/);
assert.match(movement,/enterRoofSupport/, 'roof access must adopt supported footing only after a confirmed interior exit');
assert.match(support,/isBalconyAt|roofHatchAt/);
assert.match(editor,/toolBalconyHatch|balconyAccessFurniture|balconyHeightMode/);
assert.match(game,/sourcePiece\?\.balconies/, 'town generation must tolerate unloaded building pieces');
assert.match(game,/transition\?\.roofAccess === true/, 'roof interactions preserve their descend labels');
assert.match(support,/extensionType === 'balcony'\) return NaN/, 'missing roof geometry cannot become an invisible support');
const gateStart=travelSource.indexOf('function canUseRoofSpot(');
const gateEnd=travelSource.indexOf('function checkTransitionSpots()',gateStart);
assert(gateStart>=0 && gateEnd>gateStart, 'both roof action paths must use one permission helper');
const actor={x:7.5,y:45.5,physicalFeetY:null,_freeJump:null}; // Simulated player below the IKMC roof hatch.
const host={HobunjiWalkableElevation:{isBalconyAt:(x,z,y,area)=>x===7.5&&z===45.5&&y===2.25&&area==='town'}}; // Current IKMC deck at 1.75 atop the test building's +0.5 terrain.
const permitted=new Function('window','player','TILE',travelSource.slice(gateStart,gateEnd)+'return canUseRoofSpot;')(host,actor,1);
const hatchTransition={roofAccess:true}; // Authored town-roof transition, rather than the front doorway.
assert.equal(permitted(hatchTransition,'town'),false,'standing beneath the hatch must not activate it');
actor._freeJump={phase:'supported'};actor.physicalFeetY=.5;
assert.equal(permitted(hatchTransition,'town'),false,'a lower porch is not the rooftop');
actor.physicalFeetY=2.25;
assert.equal(permitted(hatchTransition,'town'),true,'standing on the actual roof enables the return ladder');
assert.equal(permitted(hatchTransition,'farm'),false,'foreign areas cannot use the town roof hatch');
assert.equal(permitted({roofAccess:false},'town'),true,'ordinary doors remain unchanged');
assert.match(travelSource,/canUseRoofSpot\(x, area\)/,'spot discovery applies the height permission');
assert.match(travelSource,/if \(!canUseRoofSpot\(t, currentArea\)\) return/,'action execution checks height again');
console.log('IKMC roof balcony checks passed: shape, geometry, rails, ladder and rotated access.');
