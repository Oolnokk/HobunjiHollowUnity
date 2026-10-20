'use strict';
const assert = require('node:assert/strict');
const Atlas = require('../docs/js/wilderness-archipelago.js');
const Generator = require('../docs/js/wilderness-map-generator.js');

const config = { ...Atlas.DEFAULTS, archipelagoEnabled:true };
const first = Atlas.generate(100,100,'mire-atlas-fixed-seed',config);
const again = Atlas.generate(100,100,'mire-atlas-fixed-seed',config);
assert.deepEqual(Array.from(first.land), Array.from(again.land), 'shoreline must be reproducible from seed');
assert.deepEqual(Array.from(first.elevation), Array.from(again.elevation), 'island elevations must be reproducible from seed');
assert.equal(first.stats.islandCount,config.islandCount);
assert(first.stats.skerries >= 4, 'small offshore satellite islands should survive placement');
assert(first.stats.landFraction > 0.13 && first.stats.landFraction < 0.8,
  'archipelago needs substantial open ocean as well as large playable islands');
assert(first.stats.coastlineTiles > 100, 'islands need a substantial jagged coastline');
const gateway=first.stats.entrance;
assert.equal(gateway.side,'west');
assert(first.land[gateway.row*100], 'western gateway must be on an island rather than open sea');
assert(first.stats.peakTier >= 2, 'islands must have elevated interiors beyond their low beaches');

const countComponents=(mask,w,h) => {
  const seen=new Uint8Array(mask.length);
  const groups=[];
  for(let start=0;start<mask.length;start++){
    if(!mask[start]||seen[start])continue;
    const q=[start];seen[start]=1;
    for(let i=0;i<q.length;i++){
      const n=q[i],x=n%w,y=(n-x)/w;
      for(const v of [x>0?n-1:-1,x<w-1?n+1:-1,y>0?n-w:-1,y<h-1?n+w:-1]){
        if(v>=0&&mask[v]&&!seen[v]){seen[v]=1;q.push(v);}
      }
    }
    groups.push(q.length);
  }
  return groups.sort((a,b)=>b-a);
};
const components=countComponents(first.land,100,100);
assert(components.filter(n=>n>=12).length>=3,
  'bird-eye view must show multiple separate land masses, not one continuous blob');
let seaOnFarEdge=0;
for(let row=0;row<100;row++)if(!first.land[row*100+99])seaOnFarEdge++;
assert(seaOnFarEdge>70, 'outer eastern edge should be mostly ocean');

const smaller=Atlas.generate(100,100,'mire-atlas-fixed-seed',{...config,islandSize:6});
const larger=Atlas.generate(100,100,'mire-atlas-fixed-seed',{...config,islandSize:17});
assert(larger.stats.landTiles>smaller.stats.landTiles+250,
  'island-size setting must actually increase the size of the land masses');
const smoother=Atlas.generate(100,100,'mire-atlas-fixed-seed',{...config,islandIrregularity:0,islandCoastDetail:0});
let shoreChanges=0;
for(let i=0;i<first.land.length;i++)if(first.land[i]!==smoother.land[i])shoreChanges++;
assert(shoreChanges>100, 'coastline irregularity controls must meaningfully alter island silhouettes');
const gradual=Atlas.generate(100,100,'mire-atlas-fixed-seed',{...config,islandSteepness:0.4});
const sharp=Atlas.generate(100,100,'mire-atlas-fixed-seed',{...config,islandSteepness:2.5});
const altitudeSum=z=>z.elevation.reduce((s,n)=>s+n,0);
assert(altitudeSum(sharp)>altitudeSum(gradual)+100,
  'slope steepness must noticeably change inland altitude');
const low=Atlas.generate(100,100,'mire-atlas-fixed-seed',{...config,islandHeight:2});
const high=Atlas.generate(100,100,'mire-atlas-fixed-seed',{...config,islandHeight:11});
assert(low.stats.peakTier<=2);
assert(high.stats.peakTier>low.stats.peakTier,'peak-height setting must change tallest island tiers');
assert.deepEqual(Array.from(low.land),Array.from(high.land),
  'height changes must not rearrange coastlines or relocate islands');

const zone=Generator.zoneSettings('map_eastern_mire');
assert.equal(zone.archipelagoEnabled,true, 'live Eastern Mire must use the same atlas mode');
assert.equal(zone.entrySide,'west');
assert.equal(Generator.defaultSettings().archipelagoEnabled,false,
  'other wilderness zones must not silently turn into archipelagoes');
const opts={...zone,width:62,height:62,trees:0,bushes:0,logs:0,forage:0,
  fruitBushes:0,mushrooms:0,beehives:0,ore:0,boulders:0,treasure:0,
  animalDens:0,prey:0,packPredators:0,ambushPredators:0,omnivores:0,
  structures:0,caves:0,rootTotems:0,statues:0,pillars:0,
  pathAnchors:1,ramps:9};
const workspace=Generator.generateWorkspace('eastern_mire_archipelago_regression',opts);
const root=workspace.maps.find(m=>!m.isSubmap);
assert.equal(root.cols,124);
assert.equal(root.rows,124);
assert(workspace.archipelago && root.generatedFrom.archipelago,
  'gameplay workspace and root map must preserve archipelago settings/stats');
const tiles=Object.values(root.tiles);
const sea=tiles.filter(t=>t.archipelagoSea);
const land=tiles.filter(t=>!t.archipelagoSea);
assert(sea.length>tiles.length*.2 && land.length>tiles.length*.1,
  'gameplay export must contain actual connected seawater and walkable dry island tiles');
assert(sea.every(t=>t.type==='stream' || t.type==='path'),
  'ocean must export as water tiles (or real bridges), not cosmetic blue grass');
assert(sea.every(t=>!t.generatedBorderEscarpment),
  'ocean must not be replaced by the old full-ring boundary cliff wall');
const entry=root.transitions.find(t=>t.id==='sp_generated_entry');
assert(entry,'west coast transition must remain present');
assert.equal(entry.col,0,'Mire entry should remain at the world-facing west border');
const entryTile=root.tiles[entry.col+','+entry.row];
assert(entryTile && entryTile.type==='path' && !entryTile.archipelagoSea,
  'player must enter on dry land, not water');
assert(workspace.plateauGroups.length>0,
  'real terrain tier masks must export for raised island interiors');
console.log('PASS Eastern Mire archipelago:', {
  landFraction:first.stats.landFraction,components:components.length,shoreChanges,
  peakTier:first.stats.peakTier,exportSea:sea.length,exportLand:land.length,
  exportedPlateauGroups:workspace.plateauGroups.length
});
