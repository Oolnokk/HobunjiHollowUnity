'use strict';
// Tzatzul nests must use ordinary authored locale-cave map IDs and documented cavern features.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const index=require('../docs/config/locales/index.json');
const areaNames=['map_northern_cliffs','map_western_slope']; // Exactly the two eligible tall cliff areas.
const indexIds=new Set(index.locales.filter(r=>r.category==='cave_interior').map(r=>r.mapId));
for(const area of areaNames)for(let slot=0;slot<2;slot++){
 const mapId='map_i_den_tzatzul_'+area+'_'+slot;
 const locale=require('../docs/config/locales/locale_tzatzul_nest_'+area+'_'+slot+'.json');
 assert(indexIds.has(mapId),'discoverable through the existing locale cavern index');
 assert.equal(locale.cavern.mapId,mapId);
 assert.equal(locale.category,'cave_interior');
 assert.equal(locale.schema,'hobunji_locale.v1','matches the actual locale editor/runtime schema');
 assert(Object.values(locale.tiles).every(t=>t.type==='grass'),'canonical source tiles keep the cave floor material override in control');
 assert.equal(locale.cavern.surfaceMaterial,'farm-cliff');
 assert(locale.cavern.generation.sizeY>=6,'boss requires a tall roof, not the default low cave');
 assert(locale.cavern.generation.vaultCeiling,'proper enclosed cavern');
 const center=locale.cavern.features.tzatzulNest.arenaCenter;
 assert(locale.tiles[center.col+','+center.row],'walkable arena center');
 assert.equal(locale.connectors[0].targetMap,'','normal locale-cavern return exit');
 assert(locale.tiles[locale.connectors[0].col+','+locale.connectors[0].row],'exit must be on carved floor');
 assert(locale.cavern.features.tzatzulNest.wallPerches.length>=6,'mother must have far wall perches');
 assert(locale.cavern.features.tzatzulNest.stoneSpikeClusters.length>=3,'player must have multiple risk/reward spike targets');
 assert(locale.cavern.features.tzatzulNest.hatchlings.length>=2,'mother has real hatchling adds specification');
}
const supports={point:(id,x,y,worldY)=>({id,dimension:0,x,y,worldY}),register:()=>true};
const w={PerchSupport:supports};
const source=fs.readFileSync('docs/js/tzatzul-cliff-sites.js','utf8');
vm.runInNewContext(source,{window:w,Math,Map,Set,console});
for(const area of areaNames){
 const network={cols:128,rows:128,routes:[],balconies:[
  {id:'a',x:25,z:35,y:12,depth:1,normal:{x:1,z:0},base:{y:7,footprint:[[25,35]]}},
  {id:'b',x:55,z:65,y:17,depth:1,normal:{x:1,z:0},base:{y:8,footprint:[[55,65]]}}
 ]};
 const plan=w.TzatzulCliffSites.plan(area,network);
 assert.equal(plan.length,2);
 for(let slot=0;slot<2;slot++){
   assert.equal(plan[slot].caveMapId,'map_i_den_tzatzul_'+area+'_'+slot,
      'spire and authored cavern must have identical stable entry target IDs');
   assert(indexIds.has(plan[slot].caveMapId));
   assert.equal(plan[slot].climbable,false,'no climb path to guarded nest');
 }
}
console.log('Tzatzul four authored high-vault cave arenas, exact spire identities and locale loader integration PASS.');
