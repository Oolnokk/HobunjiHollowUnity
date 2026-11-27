#!/usr/bin/env node
// Executable production-owner regression: Tothal winds, snow surface, NPC shelter.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const load=(file,window,extras={})=>{vm.runInNewContext(fs.readFileSync('docs/js/'+file,'utf8'),
  {window,console,performance:{now:()=>0},URL,...extras},{filename:file});return window;};
const zones=['map_western_slope','map_northern_cliffs','map_southern_cloud_forest','map_eastern_mire'];
{
  let storm=0;const calendar={isRaining:true,rainStrength:3};
  const win={WeatherFX:{getProjection:()=>({calendar})},
    TothalBlizzard:{stormIntensityFor:area=>zones.includes(area)?storm:0}};
  load('weather-wind.js',win);
  const ordinary=zones.map(a=>win.WeatherWind.getStrengthForArea(a,calendar,0));
  storm=1;
  zones.forEach((area,i)=>assert(win.WeatherWind.getStrengthForArea(area,calendar,0)>ordinary[i]+.6,
    'shift storm must beat ordinary blizzard wind in '+area));
  assert(win.WeatherWind.getStrengthForArea('farm',calendar,0)<=1,'ordinary farm wind remains bounded');
}
{
  let area='map_western_slope',snow=0;
  const win={RuntimeFrameScheduler:{register(){}},GridTileAccessors:{getCurrentArea:()=>area},
    CalendarSystem:{currentSeason:()=>({name:'Stormtide'})},
    TothalBlizzard:{snowCoverageFor:()=>snow}};
  load('environment-surface-micro-plateau.js',win,{
    document:{currentScript:{src:'https://example.org/js/environment-surface-micro-plateau.js'}}});
  const surface=win.EnvironmentSurfaceMicroPlateau;
  assert(Math.abs(surface.debugSnapshot().thickness-.22)<1e-9,'ordinary slope snow');
  snow=1;
  assert(Math.abs(surface.debugSnapshot().thickness-.33)<1e-9,'slope gains 50% snow depth');
  for(const zone of zones.slice(1)){area=zone;
    assert.equal(surface.debugSnapshot().mode,'snow','temporary snow in '+zone);
    assert(Math.abs(surface.debugSnapshot().thickness-.22)<1e-9);
  }
  snow=0;
  assert.equal(surface.debugSnapshot().mode,'none','temporary snow melts completely');
  area='map_i_den_map_western_slope_test';snow=1;
  assert.equal(surface.debugSnapshot().mode,'none','interiors stay snow-free');
}
{
  let storm=.5;
  const links={town:{toArea:'map_i_house',exit:{c:9,r:10},spawn:{c:1,r:3}},
    farm:{toArea:'map_i_farmhouse',exit:{c:5,r:5},spawn:{c:1,r:4}}};
  const walkers=[
    {rec:{id:'town'},area:'town',root:{position:{x:10.5,z:10.5}}},
    {rec:{id:'farm'},area:'farm',root:{position:{x:6.5,z:5.5}}},
    {rec:{id:'idle'},area:'farm',root:{position:{x:7.5,z:5.5}}},
  ];
  const win={TothalBlizzard:{currentState:()=>({storm}),wilderness:a=>zones.includes(a)},
    WaterSystem:{isTownFloodEmergency:()=>false},
    NpcPathfinding:{areaLinksFrom:a=>links[a]?[links[a]]:[],
      findNpcAreaLink:(from,to)=>links.town.toArea===to?links.town:null},
    NpcActivityPlanner:{resolveNpcTarget:rec=>rec.id==='idle'?null:
      {area:rec.id==='town'?'town':'farm',c:rec.id==='town'?10:6,r:rec.id==='town'?10:5,activity:'errand'}},
    SCRATCHBONES_CONFIG:{game:{movement:{npc:{}}}}};
  load('npc-scheduling.js',win);
  win.NpcScheduling.init({npcWalkers:walkers,calendar:{day:28,time01:.5},
    buildingScenes:new Map([['map_i_house',{transitions:[{target:'exit_building',col:1,row:1}]}]]),
    isBuildingArea:a=>a.startsWith('map_i_'),normalizeNpcArea:a=>a||'farm',
    getCurrentArea:()=> 'farm',loadBuildingScene(){}});
  for(const w of walkers){const target=win.NpcScheduling.resolveNpcScheduleTarget(w.rec);
    assert.equal(target.tothalBlizzardShelter,true,'even unscheduled NPCs shelter');
    assert(target.area.startsWith('map_i_'),'NPC has a real indoor destination');
  }
  // Physical location must take priority over a scheduled town errand.
  const indoor={rec:{id:'town'},area:'map_i_farmhouse',root:{position:{x:2.5,z:3.5}}};
  walkers[0]=indoor;
  const far={id:'remote'};
  // Reinit also proves stale doorway and town assignments cannot outlive a world.
  win.NpcActivityPlanner.resolveNpcTarget=rec=>rec.id==='remote'
    ? {area:'map_northern_cliffs',c:4,r:4} : {area:'town',c:10,r:5};
  links.map_northern_cliffs={toArea:'map_i_den_cliff',exit:{c:5,r:5},spawn:{c:1,r:1}};
  win.NpcScheduling.init({npcWalkers:walkers,calendar:{day:28,time01:.5},
    buildingScenes:new Map([['map_i_house',{transitions:[{target:'exit_building',col:1,row:1}]}]]),
    isBuildingArea:a=>a.startsWith('map_i_'),normalizeNpcArea:a=>a||'farm',
    getCurrentArea:()=> 'farm',loadBuildingScene(){}});
  assert.equal(win.NpcScheduling.resolveNpcScheduleTarget(indoor.rec).area,'map_i_farmhouse','already indoors outside town: do not route into the storm');
  assert.equal(win.NpcScheduling.resolveNpcScheduleTarget(far).area,'map_i_den_cliff','missing walker uses the scheduled region rather than default farm');
  storm=0;
  for(const w of walkers)assert.equal(win.NpcScheduling.resolveNpcScheduleTarget(w.rec)?.tothalBlizzardShelter,
    undefined,'normal schedule resumes when the storm dissipates');
}
console.log('Tothal wind, snow cover and NPC shelter tests passed.');
