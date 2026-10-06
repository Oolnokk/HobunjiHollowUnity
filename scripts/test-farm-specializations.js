'use strict';
const assert = require('node:assert/strict'); // Behavior assertions use the actual runtime modules.
const fs = require('node:fs'); // Loads the same authored configuration as the browser.
const vm = require('node:vm'); // Isolated world with deterministic inventory/calendar/storage.
// Exercise the actual HTML/entrypoint ordering without creating a WebGL renderer.
{
 const html = fs.readFileSync('docs/index.html','utf8'); // Production page determines which farm dependencies are available before onboarding.
 const startup = { console, URL, location:{href:'https://example.test/docs/index.html'} }; // Parser-time browser globals used by the existing onboarding loader.
 startup.window = startup;
 startup.document = { currentScript:{src:'https://example.test/docs/onboarding.js'}, write(markup) { // Follow the core script generated synchronously by document.write.
   for (const match of markup.matchAll(/<script src="([^"]+)"/g)) {
     const file = new URL(match[1]).pathname.replace(/^\/docs\//,'docs/'); // Same sibling URL resolution used in deployment.
     if (file === 'docs/onboarding-core.js') vm.runInContext(fs.readFileSync(file,'utf8'), startup, {filename:file});
   }
 } };
 vm.createContext(startup);
 for (const match of html.matchAll(/<script[^>]+src="([^"]+)"/g)) {
   const file = 'docs/'+match[1].split('?')[0]; // Honor classic script order up to the onboarding entrypoint.
   if (['docs/config/farm-specializations.js','docs/js/farm-world-settings.js','docs/onboarding.js'].includes(file)) vm.runInContext(fs.readFileSync(file,'utf8'),startup,{filename:file});
   if (file === 'docs/onboarding.js') break;
 }
 assert.equal(typeof startup.HobunjiOnboarding.init,'function','onboarding initializes with farm settings already loaded');
}
const values = new Map(); // Browser localStorage stand-in shared by settings and saved state.
const inventory = { needlegrain: 8, rawMeat: 4, rawFish: 4, meal: 2 }; // Queue inputs, including invalid quantities/tags.
const itemDefs = { needlegrain: {label:'Needlegrain',tags:['Grain'],cat:'crop'}, rawMeat:{label:'Uumkao Meat',tags:['Meat'],sellPrice:8}, rawFish:{label:'Fish',tags:['Fish'],sellPrice:7}, meal:{label:'Meal',tags:['Food','Meal'],cat:'meal'} }; // Live recipe database for actual resolver execution.
const calendar = {day:1,time01:0,isRaining:false,rainStrength:1}; // World-time progression remains independent of real time.
const tileTypes = Object.fromEntries(['GRASS','TRENCH','RAISED','PADDY','TILLED','ROCK','SHRUB','RIVER','STREAM','WATERFALL','RAMP'].map(key=>[key,key.toLowerCase()])); // Matches runtime tags.
const grid = Array.from({length:20},()=>Array.from({length:20},()=>({type:'grass',water:0,depth:0,crop:''}))); // Interior test field avoids external groundwater.
const cropData = { needlegrain:{idealMin:.2,idealMax:.5,growDays:12}, garlink:{idealMin:.15,idealMax:.45}, wetCrop:{idealMin:.8,idealMax:.9} }; // Tests both overlapping and incompatible ideal water bands.
const objects = new Map(); // Shared farm multi-tile occupancy authority.
let allowed = true, season = 'Deadgrass', saves = 0; // Mutation gates and persistence evidence.
const emptyMesh = () => ({userData:{},position:{set(){}},traverse(){}}); // Rendering is exercised separately; these tests verify authoritative state.
const context = {console,Date,Math,performance:{now:()=>0},setInterval:()=>1,clearInterval(){},
  localStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)},window:{},
}; // Browser globals required by the existing modules.
context.window=context;
context.CalendarSystem={currentSeason:()=>({name:season})};
context.AuthoredFurniture={load:async()=>({parts:[]}),buildGroup:emptyMesh};
vm.createContext(context);
const load = file=>vm.runInContext(fs.readFileSync(file,'utf8'),context,{filename:file}); // Executes real source, without assertions against source text.
load('docs/config/farm-specializations.js');load('docs/js/farm-world-settings.js');load('docs/js/item-processing.js');load('docs/js/farm-production.js');load('docs/js/water-system.js');
// Day-one terrain generation supplies a provisional grid before the live grid binding exists.
context.WaterSystem.init({TileType:tileTypes,clamp:(value,min,max)=>Math.max(min,Math.min(max,value)),calendar,getGrid:()=>{throw new ReferenceError('live grid is not initialized');},getTownGrid:()=>null,ROWS:20,COLS:20,MAX_WATER:3,RAIN_RATE:.02,isSolid:()=>false,markTileDirty(){}});
assert.doesNotThrow(()=>context.WaterSystem.recomputeWater(false,grid,20,20),'startup water simulation must not request the live farm grid');
const settings=context.FarmWorldSettings, production=context.FarmProduction; // Actual exported authorities.
for(let i=0;i<100;i++) assert(!/iron/i.test(settings.randomName()),'random lore-friendly names avoid iron');
assert.equal(settings.normalize({wood:'#ff0000',stone:'#00ff00',specialization:'bogus'}).wood,'#7d7355');
const world=settings.initializeWorld({id:'world',ownerCharacterId:'owner',label:'',storage:{growthTonic:4}}, {specialization:'rancher'}); // Fresh world construction gets exactly the requested package.
assert.equal(world.storage.barnPlanMedium,undefined);assert.equal(world.storage.barnIncubatorSmallPlan,undefined);assert.equal(world.storage.voorgAssBaby,1);assert.equal(world.storage.mootBaby,1);assert.deepEqual(Array.from(world.farmStarterBuildings),['barnMedium','barnIncubatorSmall','fodderMillSmall']);
const smoke=settings.initializeWorld({id:'smoke',storage:{}},{specialization:'preserver'}); // One shared smokehouse accepts either raw meat or fish.
assert.deepEqual(Array.from(smoke.farmStarterBuildings),['smokehouseSmall','jerkyDryerSmall']);
world.farmStarterBuildings=[];values.set('hobunjiSaveMeta',JSON.stringify({worlds:[world]}));
settings.init({getPlayerData:()=>({worldId:'world'}),isFarmOwner:()=>allowed,debugLog(){},showToast(){}});
context.ItemProcessing.init({ITEM_DEFS:itemDefs,cropData,getActiveInventoryItem:()=>null});
context.FarmBuildings={canPlaceAt:(col,row,w,h,id)=>Number.isInteger(col)&&Number.isInteger(row)&&col>=0&&row>=0&&col+w<=20&&row+h<=20&&!Array.from({length:h},(_,r)=>Array.from({length:w},(_,c)=>objects.get((col+c)+','+(row+r)))).flat().some(obj=>obj&&obj.id!==id),clearFootprint(){},refreshColors(){}};
context.HousePieces={rebuildStructureMeshes(){}};
production.init({calendar,inventory,ITEM_DEFS:itemDefs,cropData,COLS:20,ROWS:20,TileType:tileTypes,MAX_WATER:3,scene:{add(){},remove(){}},worldObjects:objects,hasFarmPermission:()=>allowed,getGrid:()=>grid,surfaceY:()=>0,
  loadStorage:()=>JSON.parse(values.get('hobunjiSaveMeta')).worlds[0].storage,saveStorage:stock=>{const meta=JSON.parse(values.get('hobunjiSaveMeta'));meta.worlds[0].storage=stock;values.set('hobunjiSaveMeta',JSON.stringify(meta));},
  consumeInput:key=>{inventory[key]--;return 4;},saveFarmLayout:()=>{saves++;return true;},saveMemberWorldData(){},showToast(){},debugLog(){}});
production.load([{id:'mill',key:'windmillSmall',col:2,row:2,queue:[],ready:[]},{id:'smokehouse',key:'smokehouseSmall',col:7,row:2},{id:'jerky',key:'jerkyDryerSmall',col:13,row:2}]);
assert.equal(objects.get('3,3').id,'mill','whole footprint is occupied');
assert.equal(production.enqueue('mill','needlegrain',3).ok,true);
assert.equal(inventory.needlegrain,5);assert.equal(production.enqueue('mill','needlegrain',1.5).ok,false);assert.equal(production.enqueue('mill','needlegrain',999).ok,false);
assert.equal(production.enqueue('smokehouse','needlegrain',1).ok,false);
assert.equal(production.enqueue('smokehouse','rawMeat',1).ok,true);assert.equal(production.enqueue('smokehouse','rawFish',1).ok,true);assert.equal(production.enqueue('jerky','rawMeat',1).ok,true);
calendar.day=2;calendar.time01=.6;production.tick();
assert.deepEqual(Array.from(production.entries()[1].ready, output=>output.key).sort(), ['rawFishSmoked','rawMeatSmoked']);
assert.equal(production.entries()[0].queue.length,0);assert.equal(production.entries()[0].ready[0].count,9);assert.equal(production.entries()[0].ready[0].stars,4);
const saved=JSON.parse(JSON.stringify(production.serialize())); // Reload a fully finished queue with its dynamic item definition.
delete itemDefs.needlegrainFlour;production.load(saved);assert.equal(itemDefs.needlegrainFlour.label,'Needlegrain Flour');
inventory.needlegrainFlour=98;assert.equal(production.collect('mill').ok,true);assert.equal(inventory.needlegrainFlour,99);assert.equal(production.entries()[0].ready[0].count,8,'full bags retain all excess output');
assert.equal(production.collect('mill').ok,false);inventory.needlegrainFlour=0;production.collect('mill');assert.equal(inventory.needlegrainFlour,8);
// Execute the facility's real menu builder and the same click handlers ControllerUI activates.
{
  class Element {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.attributes = {}; this.style = {}; this.value = ''; }
    append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); if (this.tagName === 'SELECT' && !this.value) this.value = child.value; } }
    setAttribute(name, value) { this.attributes[name] = value; }
    getAttribute(name) { return this.attributes[name] ?? null; }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); }
    click() { this.onclick?.(); }
  }
  const body = new Element('body'); // Owns dynamically opened modal roots and tracks replacement/close.
  context.document = { createElement: tag => new Element(tag), body, getElementById: id => body.children.find(child => child.id === id) || null };
  const modal = () => context.document.getElementById('farmProductionModal'); // Reads the live root after queue/collect rebuilds it.
  const controls = () => modal().children[0].children; // Mirrors native controls discovered by the shared controller navigator.
  for (const id of ['mill', 'smokehouse', 'jerky']) {
    production.open(id);
    assert.equal(modal().getAttribute('data-ctrl-panel'), '', 'every facility opts into controller focus');
    assert.equal(modal().getAttribute('role'), 'dialog');
    assert.equal(modal().getAttribute('aria-modal'), 'true');
    const select = controls().find(child => child.tagName === 'SELECT'); // Ingredient picker receives initial controller focus.
    assert.equal(select.getAttribute('data-ctrl-default'), '');
    assert.equal(select.getAttribute('aria-label'), 'Ingredient and source');
    const quantity = controls().find(child => child.tagName === 'INPUT'); // Existing navigator adjusts numbers with left/right and respects min/step.
    assert.equal(quantity.type, 'number'); assert.equal(quantity.min, '1'); assert.equal(quantity.step, '1');
    const close = controls().find(child => child.getAttribute('data-ctrl-cancel') === ''); // B invokes this same close handler.
    close.click(); assert.equal(modal(), null, 'controller cancel closes the facility root');
  }
  production.open('mill');
  const beforeQueue = inventory.needlegrain; // Confirms menu activation reaches the existing validated queue authority.
  controls().find(child => child.textContent === 'Queue').click();
  assert.equal(inventory.needlegrain, beforeQueue - 1);
  assert.equal(modal().getAttribute('data-ctrl-panel'), '', 'queue refresh retains controller ownership');
  controls().find(child => child.textContent === 'Collect goods').click();
  assert.equal(modal().getAttribute('data-ctrl-panel'), '', 'collection refresh retains controller ownership');
  controls().find(child => child.getAttribute('data-ctrl-cancel') === '').click();
}
allowed=false;assert.equal(production.enqueue('mill','needlegrain',1).ok,false);assert.equal(settings.saveColors({stone:'#88847d',wood:'#604632'}).ok,false);allowed=true;
assert.equal(settings.saveColors({stone:'#88847d',wood:'#604632'}).ok,true);assert.equal(settings.current().stone,'#88847d');
assert.equal(context.ItemProcessing.getProcessingOutputs('composting','meal')[0].key,'compostFertilizer');
assert(context.ItemProcessing.getProcessingOutputs('drying','rawMeat')[0].label.endsWith('Jerky'));
assert.equal(context.ItemProcessing.getProcessingOutputs('smoking','rawMeatSmoked'),null,'preserved products cannot loop into additional yield');
production.load([{id:'silo',key:'waterSiloSmall',col:2,row:2,water:12000}]);
grid[2][4]={type:'trench',depth:1,water:0,crop:''};grid[2][5]={type:'trench',depth:1,water:0,crop:''};grid[3][5]={type:'tilled',depth:0,water:0,crop:'needlegrain'};
grid[8][8]={type:'tilled',depth:0,water:0,crop:'needlegrain'};
assert.equal(production.connectedCrops(production.entries()[0],grid).crops.length,1);
production.irrigate(grid,calendar,0,true);assert(grid[3][5].water>=.6&&grid[3][5].water<=1.5);assert.equal(grid[8][8].water,0,'disconnected crops receive no water');
const tank=production.entries()[0];assert(tank.water<12000);const before=tank.water;grid[3][5].water=2;production.irrigate(grid,calendar,0,true);assert.equal(tank.water,before,'wet crops do not request more water');
season='Longpour';calendar.isRaining=true;tank.water=0;production.irrigate(grid,calendar,.02,true);assert(tank.water>0,'rain fills tank in the wet seasons');
season='Deadgrass';calendar.isRaining=false;tank.water=12000;grid[3][5].water=0;
context.WaterSystem.init({TileType:tileTypes,clamp:(value,min,max)=>Math.max(min,Math.min(max,value)),calendar,getGrid:()=>grid,getTownGrid:()=>null,ROWS:20,COLS:20,MAX_WATER:3,RAIN_RATE:.02,isSolid:type=>['rock','shrub'].includes(type),markTileDirty(){}});
// Exercise actual cross-tile flow, rather than asserting only that the pump changed its own tank.
for(let tick=0;tick<800;tick++)context.WaterSystem.recomputeWater(false);
assert(grid[3][5].water>.6,'actual connected trench flow sustains low-water crop beds');
assert(grid[3][5].water<1.5,'metering does not flood low-water crop beds');
assert(tank.water>0,'small tank retains water after sustained irrigation');
grid[1][5]={type:'tilled',depth:0,water:0,crop:'wetCrop'};production.irrigate(grid,calendar,0,true);assert(tank.irrigationWarning.includes('incompatible'));
assert(saves>0,'queue and tank mutations checkpoint the world layout');
for(const definition of Object.values(context.FARM_SPECIALIZATIONS_CONFIG.buildings)){
 const asset=JSON.parse(fs.readFileSync('docs/config/furniture-authored/'+definition.key+'.json'));assert.equal(asset.footprint.w,definition.w);assert(asset.parts.length>=10);
 if(definition.family.endsWith('Mill')||definition.family==='windmill')assert.equal(asset.parts.filter(part=>part.kind==='glb').length,4);
}
// Completed barn starters use the existing placement authority without consuming plans or construction materials.
{
 const records = []; // Live regular barns created by the actual starter API.
 const starterGrid = Array.from({length:50},()=>Array.from({length:60},()=>({type:'grass',crop:''}))); // Clear new-world farm.
 const starterContext = {window:{}}; // Isolated barn module with rendering stubbed at its public seam.
 vm.createContext(starterContext);
 vm.runInContext(fs.readFileSync('docs/js/farm-buildings.js','utf8'),starterContext);
 const barns = starterContext.window.FarmBuildings; // Actual placement/record authority.
 barns.init({TileType:tileTypes,COLS:60,ROWS:50,getGrid:()=>starterGrid,getHousePieceRects:()=>[],worldObjects:new Map(),getFarmBuildings:()=>records,getBarnTiers:()=>({medium:{}}),recomputeWater(){},markTileDirty(){}});
 barns.spawnEntry=()=>{};
 const starter = barns.ensureStarterBarn('medium','starter_barnMedium'); // No inventory or currency seam is supplied.
 assert.equal(starter.ok,true);assert.equal(starter.entry.stage,'built');assert.equal(starter.entry.w,4);assert.equal(starter.entry.h,5);
 assert.equal(barns.ensureStarterBarn('medium','starter_barnMedium').entry,starter.entry);assert.equal(records.length,1);
 for(const row of starterGrid)for(const tile of row)tile.type=tileTypes.TILLED;
 assert.equal(barns.ensureStarterBarn('medium','another_starter').ok,false,'blocked placement keeps grants pending rather than spawning through obstacles');
}
console.log('Farm settings, starters, queues, quality, persistence, permissions, tier assets and actual silo water flow passed.');
