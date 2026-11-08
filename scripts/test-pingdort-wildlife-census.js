'use strict';
// Run: node scripts/test-pingdort-wildlife-census.js
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.resolve(__dirname,'../docs/js/wildlife-debug-panel.js'),'utf8');
const area='map_southern_cloud_forest';
const container={innerHTML:''}; // The actual mobile Wildlife panel target.
const document={readyState:'complete',querySelector:()=>null,
  getElementById:id=>id==='wildlifeDenList'?container:null};
const window={
  WildlifeSpawn:{getDenGenotypes:()=>new Map(),denNestCensus:()=>null,denTurnoverDebug:()=>[]},
  PingdortRegistration:{ZONES:[area,'map_eastern_mire']},
  PingdortFlocks:{debugSnapshot:()=>({eggsCollected:2,flockDeaths:1,missingShelves:0,
    habitats:[{area,liveBirds:2,nests:[{id:'cloud-nest-1',y:16.5,remaining:1,
      flockLoaded:true,deadSlots:[2]}]}]})},
  CliffRouteNetwork:{forArea:()=>({balconies:[{},{}],verification:{ok:true}})},
  CloudForestRuntimeV2:{lastKarstReport:{towers:9,clusters:4,seed:'census-test'}},
};
vm.runInNewContext(source,{window,document},{filename:'wildlife-debug-panel.js'});
window.WildlifeDebugPanel.init({getCurrentArea:()=>area,
  _isZoneArea:()=>true,esc:value=>String(value),
  isDevMode:()=>true});
window.WildlifeDebugPanel.render();
for(const fragment of ['Pingdort nests / cliff wildlife','cloud-nest-1',
  'Live birds: <b>2</b>','9 limestone pillars in 4 clusters',
  'Eggs collected: 2','flock deaths: 1','losses today 1','climb routes valid: true'])
  assert(container.innerHTML.includes(fragment),'Missing mobile census: '+fragment);
console.log('Mobile Pingdort Wildlife tab displays actual nest, mortality, elevation and karst generation PASS');
