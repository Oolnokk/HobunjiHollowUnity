'use strict';
const assert = require('node:assert/strict'); // Checks the shipped module and quest flow without an actual WebGL scene.
const fs = require('node:fs'); // Reads the authored locale definitions and unmodified production scripts.
const path = require('node:path'); // Builds paths relative to this test for CI and local npm scripts.
const vm = require('node:vm'); // Runs browser-only seasonal quest code in an isolated fake window.

const ROOT = path.join(__dirname, '..'); // Used to resolve the same files served by the game.
const Scenery = require('../docs/js/wilderness-landmark-scenery.js'); // Shared, independent year-round landmark plan used by both renderer and riddle clues.
const Riddles = require('../docs/js/locale-riddle-generator.js'); // Reusable UMD source is also valid CommonJS.
const locales = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/config/locales/index.json'), 'utf8')).locales; // All five authored targets must be indexed for Tothal Shift placement.
const ids = ['cyan', 'white', 'gold', 'amber', 'rose']; // Each target has its own standalone locale JSON and unique temple color.
function layoutFor(id, x = 23, y = 22) {
  const tiles = Array.from({ length: 70 }, () => Array.from({ length: 70 }, () => ({ type: 'grass' }))); // Seed-independent deterministic test terrain.
  const localeId = 'locale_five_blossoms_' + id; // Matches the generated instance key from production placement.
  const instance = { localeId, name: id + ' Blossom Tree', x: x - 1, y: y - 1, objects: [{ key: 'blossom-tree', x, y }] }; // Object coordinates, rather than origin, define the target location.
  return { cols: 70, rows: 70, tiles, localeInstances: [instance] };
}
for (const id of ids) {
  const entry = locales.find(x => x.id === 'locale_five_blossoms_' + id);
  assert.ok(entry, id + ' is indexed as a locale');
  const def = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/' + entry.file), 'utf8'));
  assert.equal(def.category, 'story_poi');
  assert.equal(def.objects[0].key, 'blossom-tree');
  assert.equal(def.objects[0].collision.mode, 'custom', 'tree trunk has a solid collision footprint');
  assert.ok(def.objects[0].collision.w > 0 && def.objects[0].collision.w <= 0.5, 'trunk collider stays narrower than the authored tree locale');
  assert.ok(def.placement.allowedZones.length === 1);
  assert.ok(!def.placement.allowedZones.includes('map_eastern_mire'), 'Feast blossoms must not stamp into the Eastern Mire');
  if (id === 'gold') assert.deepEqual(def.placement.allowedZones, ['map_western_slope'], 'Gold Blossom moved west but remains the third quest target');
  assert.equal(def.placement.shiftGeneratedSecret, true, 'new Tothal year hides the newly relocated target until rediscovery');
  assert.ok(Object.values(def.terrainAnchors).every(rule => rule.strength === 'preferred'), 'terrain is preferential, never mandatory');
}
let poems = 0; // Counts tested deterministic rhyme variants for regression output.
for (let i = 0; i < 400; i++) {
  const map = layoutFor('cyan', 20 + i % 28, 19 + i % 30);
  if (i % 2 === 0) map.tiles[24 + i % 20][20 + i % 28] = { type: 'river' };
  if (i % 3 === 0) map.tiles[23 + i % 20][23 + i % 28] = { type: 'path' };
  if (i % 5 === 0) map.rootTotems = [{ x: map.localeInstances[0].objects[0].x + 8, y: map.localeInstances[0].objects[0].y + 4 }];
  const options = { zoneId: 'map_northern_cliffs', layout: map, instance: map.localeInstances[0], blossomName: 'Cyan Blossom', seed: String(i) };
  const output = Riddles.generate(options);
  assert.equal(output.ok, true, 'riddle succeeds without relying on requested terrain: ' + i);
  assert.equal(Riddles.validate(output), true);
  assert.ok(output.stanzas.length <= 2, 'new poems avoid repetitive three-stanza scavenger verses');
  assert.ok(output.text.includes('Cyan Blossom'), 'final stanza names the tree');
  assert.ok(output.text.includes('Northern Cliffs'), 'first stanza names the broad zone');
  assert.equal(output.text, Riddles.generate(options).text, 'riddles stay deterministic after save/reload');
  assert.ok(output.facts.every(fact => fact.source !== 'requested-terrain'), 'poem only states verified facts');
  poems++;
}
// Riddles describe real places only: never imply a sunrise, moon phase, specific hour or countable map coordinates.
const forbiddenTiming = /\\b(?:night|tonight|daylight|morning|evening|sunrise|sunset|dusk|dawn|midnight|noon|stars|moonlight|shadows|fading light|final light)\\b/i; // The quest calendar owns the deadline; a poem never owns an hour.
const forbiddenCounting = /\\b\\d+\\s+(?:map\\s+)?tiles?\\b|\\b(?:count|measure)\\s+\\d+\\b/i; // Walking exact map-tile distances is not a treasure riddle.
for (let seed = 0; seed < 400; seed++) {
  const candidate = Riddles.generate({ zoneId:'map_northern_cliffs', layout:layoutFor('cyan'), instance:layoutFor('cyan').localeInstances[0], blossomName:'Cyan Blossom', seed:'timing-audit-'+seed });
  assert.equal(candidate.ok, true);
  assert.doesNotMatch(candidate.text, forbiddenTiming, 'random poems contain no false time-of-day conditions');
  assert.doesNotMatch(candidate.text, forbiddenCounting, 'random poems contain no numeric grid-instruction clues');
}
// Expanded ABAB bank: phonetic variety and registered-landmark specificity.
const coveredFamilies = new Set(); // Tracks exercised terminal sounds.
const coveredLandmarks = new Set(); // Tracks independently sourced scenery categories.
for (let seed = 0; seed < 1200; seed++) {
  const layout = layoutFor('cyan');
  layout.tiles[24][25] = { type:'stream' };
  layout.tiles[24][26] = { type:'path' };
  layout.tiles[25][27] = { type:'rock', rockKind:'undiggableBoulder', boulderId:'verified-rock' };
  const sample = [
    { name:'a stone cairn', kind:'stoneCairn', point:{col:30,row:25}, source:'generated-year-round-scenery' },
    { name:'a broken stone pillar', kind:'brokenPillar', point:{col:30,row:29}, source:'generated-year-round-scenery' },
    { name:'a dead tree', kind:'deadTree', point:{col:25,row:31}, source:'generated-year-round-scenery' },
    { name:'a cliff door', kind:'cliffDoor', point:{col:16,row:24}, source:'registered-cliff-door' },
    { name:'the root totem', kind:'rootTotem', point:{col:21,row:32}, source:'generated-root-totem' },
    { name:'a wild animal den', kind:'animalDen', point:{col:34,row:20}, source:'generated-animal-den' }
  ];
  const offset = seed % sample.length;
  const poem = Riddles.generate({zoneId:'map_northern_cliffs',layout,instance:layout.localeInstances[0],targetName:'Cyan Blossom',targetKind:'blossom',
    landmarks:[sample[offset],sample[(offset+1)%sample.length]],seed:'expanded-'+seed});
  assert.equal(poem.ok,true,'all expanded seeded poems rhyme: '+seed);
  assert.equal(poem.evidence.landmarkCount,2,'two distinct real landmarks can triangulate the target');
  for(const landmark of poem.facts.filter(f=>f.kind==='landmark'))coveredLandmarks.add(landmark.flavor);
  assert.ok(poem.stanzas.length<=2);
  for(const stanza of poem.stanzas){
    const endings=stanza.map(line=>line.replace(/[.,;!?]+$/,'').trim().split(/\s+/).pop().toLowerCase());
    if(stanza.length===2){
      assert.notEqual(endings[0],endings[1],'closing couplet changes its ending word');
      assert.ok(Object.values(Riddles.RHYMES).some(bank=>bank.includes(endings[0])&&bank.includes(endings[1])),'closing couplet rhymes');
    } else {
      assert.notEqual(endings[0],endings[2],'A rhyme changes its ending word');
      assert.notEqual(endings[1],endings[3],'B rhyme changes its ending word');
    }
    for(const word of endings){
      const family=Object.keys(Riddles.RHYMES).find(name=>Riddles.RHYMES[name].includes(word));
      assert.ok(family,'every terminal must be in the sound bank');
      coveredFamilies.add(family);
    }
  }
  assert.doesNotMatch(poem.text,forbiddenTiming);
  assert.doesNotMatch(poem.text,forbiddenCounting);
}
assert.equal(coveredFamilies.size,10,'all ten phonetic families exercised');
assert.ok(['stoneCairn','brokenPillar','deadTree','cliffDoor','rootTotem','animalDen'].every(kind=>coveredLandmarks.has(kind)),'all registered landmark types represented');
// Anaphora is based on physical site identity, not merely on its noun or stanza position.
const twoCairns = layoutFor('cyan', 23, 22); // Two distinct locations of one landmark type expose article ambiguity.
const cairnSites = [
  {kind:'stoneCairn',name:'a stone cairn',point:{col:15,row:20},source:'generated-year-round-scenery'},
  {kind:'stoneCairn',name:'a stone cairn',point:{col:31,row:27},source:'generated-year-round-scenery'}
]; // Both are within the genuine nearby-scene search range.
for(let seed = 0; seed < 300; seed++){
  const options={zoneId:'map_northern_cliffs',layout:twoCairns,instance:twoCairns.localeInstances[0],
    targetKind:'blossom',targetName:'Cyan Blossom',landmarks:cairnSites,seed:'cairn-articles-'+seed};
  const output=Riddles.generate(options);
  assert.equal(output.ok,true,'same-type landmarks remain rhymable');
  const references=output.facts.filter(f=>f.kind==='landmark');
  assert.equal(references.length,2,'two distinct cairns are eligible as references');
  assert.equal(references[0].flavor,'stoneCairn');
  assert.equal(references[1].flavor,'stoneCairn');
  assert.notEqual(references[0].coordinate.col,references[1].coordinate.col,'distinct sites retain distinct coordinates');
  assert.match(output.stanzas[0][2],/\b(?:a|an) (?:stone cairn|crown of stacked stones|little tower of stones|pile of weathered stones)\b/,'first cairn gets an indefinite mention');
  assert.match(output.stanzas[0][3],/\banother (?:stone cairn|crown of stacked stones|little tower of stones|pile of weathered stones)\b/,'second separate cairn uses another');
  assert.match(output.stanzas[1][0],/\b(?:the|that) (?:stone cairn|crown of stacked stones|little tower of stones|pile of weathered stones)\b/,'return to the same first or second cairn uses a definite reference');
  assert.equal(output.text,Riddles.generate(options).text,'metaphors and articles remain deterministic across reloading');
  assert.equal(Riddles.validate(output),true,'anaphora does not disturb terminal rhyme words');
}
const untypedNeighbors = layoutFor('cyan', 23, 22); // Existing authored places have arbitrary names, not predefined metaphor kinds.
untypedNeighbors.localeInstances.push(
  {localeId:'site_altar_left',name:'a ruined altar',objects:[{key:'altar',x:15,y:20}]},
  {localeId:'site_altar_right',name:'a ruined altar',objects:[{key:'altar',x:31,y:27}]}
);
const untypedPoem = Riddles.generate({zoneId:'map_northern_cliffs',layout:untypedNeighbors,
  instance:untypedNeighbors.localeInstances[0],targetKind:'blossom',targetName:'Cyan Blossom',seed:'authored-generic-anaphora'});
assert.equal(untypedPoem.ok,true,'untyped neighbor locales are still eligible for grounded clues');
assert.match(untypedPoem.stanzas[0][2],/\ba ruined altar\b/,'first authored place stays indefinite');
assert.match(untypedPoem.stanzas[0][3],/\banother ruined altar\b/,'a second separate authored place uses another');
assert.match(untypedPoem.stanzas[1][0],/\b(?:the|that) ruined altar\b/,'return to the earlier authored landmark is definite');

const mixedTypes = layoutFor('cyan', 23, 22); // A second kind should not be misidentified as another of the first.
const mixedVerse = Riddles.generate({zoneId:'map_northern_cliffs',layout:mixedTypes,instance:mixedTypes.localeInstances[0],
  targetName:'Cyan Blossom',targetKind:'blossom',landmarks:[
    {kind:'stoneCairn',name:'a stone cairn',point:{col:15,row:20},source:'generated-year-round-scenery'},
    {kind:'deadTree',name:'a dead tree',point:{col:31,row:27},source:'generated-year-round-scenery'}
  ],seed:'two-distinct-types'});
assert.equal(mixedVerse.ok,true);
assert.doesNotMatch(mixedVerse.stanzas[0][3],/\banother\b/,'a different landmark category starts its own first mention');
const oneDen = layoutFor('cyan', 23, 22); // Previously duplicated "a wild animal den" incorrectly implied two dens.
const denPoem = Riddles.generate({zoneId:'map_northern_cliffs',layout:oneDen,instance:oneDen.localeInstances[0],
  targetName:'Cyan Blossom',targetKind:'blossom',landmarks:[
    {kind:'animalDen',name:'a wild animal den',point:{col:30,row:28},source:'generated-animal-den'},
    {kind:'deadTree',name:'a dead tree',point:{col:29,row:23},source:'generated-year-round-scenery'}
  ],seed:'single-den-anaphora'});
assert.equal(denPoem.ok,true);
const denLine=denPoem.stanzas[0].find(line=>/\b(?:den|hollow|refuge|shelter)\b/i.test(line));
assert.ok(denLine,'animal den is present in the generated clue');
assert.match(denPoem.stanzas[1][0],/\b(?:the|that) (?:wild animal den|beast’s hollow|creature’s refuge|animal shelter)\b/,'revisiting a previously identified den never implies a second den');

// A navigational riddle must narrow steadily: region, sector, water/trail, boulder, local landmark, target.
// Validate stanza transitions too, especially the old seven-fact tail that jumped back from cairn to boulder.
const navigationRank = {zone:0,sector:1,water:2,path:3,boulder:4,landmark:5,blossom:6,target:6}; // Matches the public clue hierarchy, not authoring order.
const scopeMarkers = {
  zone:'REGION_MARKER',sector:'SECTOR_MARKER',water:'WATER_MARKER',path:'PATH_MARKER',
  boulder:'BOULDER_MARKER',landmark:'LANDMARK_MARKER',blossom:'BLOSSOM_MARKER'
}; // Distinct marker phrases let this test recognize the exact fact used by each generated line.
for (let length = 3; length <= 7; length++) {
  const kinds = ['zone','sector','water','path','boulder','landmark','blossom'].slice(0, length - 1).concat('blossom');
  for (let seed = 0; seed < 120; seed++) {
    const facts = kinds.map(kind => ({kind,value:scopeMarkers[kind]})).reverse(); // Intentionally unordered input.
    const stanzas = Riddles.compose({facts,seed:'navigation-order-'+length+'-'+seed});
    assert.ok(stanzas?.length && stanzas.length <= 2,'scope ordering stays within the usual poem length');
    const levels = stanzas.flat().map(line => {
      const kind = Object.keys(scopeMarkers).find(key => line.includes(scopeMarkers[key]));
      assert.ok(kind,'every line refers to a real input fact rather than imaginary terrain');
      return navigationRank[kind];
    });
    assert.equal(levels[0],0,'the wilderness region opens the poem');
    assert.equal(levels[1],1,'the regional sector follows immediately');
    assert.equal(levels[levels.length-1],6,'the named objective is always the final clue');
    assert.ok(levels.every((rank,index)=>index===0||levels[index-1]<=rank),
      'a poem may repeat the current landmark but never widen the search after narrowing it');
    assert.equal(Riddles.validate({stanzas}),true,'ordering must retain real ABAB/couplet rhymes');
  }
}
const orderedBiome = layoutFor('cyan', 23, 22); // Real inspector probe with every available level of terrain.
orderedBiome.tiles[19][19] = {type:'river'};
orderedBiome.tiles[20][20] = {type:'path'};
orderedBiome.tiles[25][25] = {type:'rock',rockKind:'undiggableBoulder',boulderId:'order-rock'};
const orderedPoem = Riddles.generate({zoneId:'map_northern_cliffs',layout:orderedBiome,instance:orderedBiome.localeInstances[0],
  targetKind:'blossom',targetName:'Cyan Blossom',seed:'full-terrain-order',landmarks:[
    {kind:'stoneCairn',name:'a stone cairn',point:{col:30,row:28}},
    {kind:'deadTree',name:'a dead tree',point:{col:16,row:26}}
  ]});
assert.equal(orderedPoem.ok,true);
assert.deepEqual(orderedPoem.facts.map(f=>f.kind),['zone','sector','water','path','boulder','landmark','landmark','blossom'],
  'runtime physical evidence is assembled from large-scale geography toward the blossom');

// Empty landscapes must never borrow a physical landmark simply to finish a rhyme.
for (let seed = 0; seed < 400; seed++) {
  const zone = layoutFor('cyan');
  const verse = Riddles.generate({zoneId:'map_northern_cliffs',layout:zone,instance:zone.localeInstances[0],
    targetKind:'blossom',targetName:'Cyan Blossom',seed:'empty-landscape-'+seed});
  assert.equal(verse.ok,true);
  assert.doesNotMatch(verse.text,/\b(?:cairn|pillar|cliff door|landmark|boulder|river|trail|animal den|root totem)\b/i,
    'no terrain-specific nouns may appear when no such feature was inspected');
}
const conciseLayout = layoutFor('cyan'); // Verified landmark-only poems should end without duplicated filler.
const concisePoem = Riddles.generate({zoneId:'map_northern_cliffs',layout:conciseLayout,instance:conciseLayout.localeInstances[0],
  targetKind:'blossom',targetName:'Cyan Blossom',landmarks:[
    {name:'a dead tree',kind:'deadTree',point:{col:30,row:28}},
    {name:'a stone cairn',kind:'stoneCairn',point:{col:15,row:26}}
  ],seed:'short-tail-regression'});
assert.equal(concisePoem.ok,true);
assert.equal(concisePoem.stanzas.length,2);
assert.equal(concisePoem.stanzas[1].length,2,'the short ending is a rhymed couplet');
assert.equal((concisePoem.text.match(/Cyan Blossom/g)||[]).length,1,'do not repeat the target in a sparse ending');
const unmarkedStrict=Riddles.generate({zoneId:'map_northern_cliffs',layout:layoutFor('cyan'),
  instance:layoutFor('cyan').localeInstances[0],targetKind:'blossom',targetName:'Cyan Blossom',requireUniqueStart:true});
assert.equal(unmarkedStrict.ok,false,'festival must fail closed instead of starting its clue at a vague or unverified marker');
assert.match(unmarkedStrict.reason,/uniquely verified starting landmark/);
const noWater = layoutFor('cyan'); // Missing preferred river may never produce a river clue.
const missing = Riddles.generate({ zoneId: 'map_northern_cliffs', layout: noWater, instance: noWater.localeInstances[0], blossomName: 'Cyan Blossom' });
assert.equal(missing.ok, true);
assert.equal(missing.evidence.waterFound, false);
assert.equal(missing.facts.filter(f => f.kind === 'distance').length, 0, 'missing landmarks must not lead to numeric tile-count instructions');
// Year-round scenery must be deterministic, terrain-safe, distinct and visible to treasure riddles.
const sceneryWorld = layoutFor('cyan', 30, 30);
const landmarks = Scenery.planForLayout('map_northern_cliffs', sceneryWorld, 'unit-world:1156');
assert.ok(landmarks.length >= 6, 'dense year-round landmarks exist across a simple exterior zone');
assert.equal(landmarks, Scenery.planForLayout('map_northern_cliffs', sceneryWorld, 'unit-world:1156'), 'zone plan is cached and unchanged on revisit');
assert.notDeepEqual(landmarks, Scenery.planForLayout('map_northern_cliffs', sceneryWorld, 'unit-world:1157'), 'new Tothal cycle moves the scenery');
for (const landmark of landmarks) {
  assert.equal(sceneryWorld.tiles[landmark.point.row][landmark.point.col].type, 'grass');
  assert.ok(Math.hypot(landmark.point.col - 30, landmark.point.row - 30) >= 6, 'authored locale clearance remains intact');
  assert.ok(['stoneCairn','brokenPillar','deadTree','witnessStone'].includes(landmark.kind));
}
const witnessSites=landmarks.filter(s=>s.kind==='witnessStone'); // The only color-marked stone is physically included in the year-round scene plan.
assert.equal(witnessSites.length,1,'the whole zone has one—and only one—uniquely dyed riddle starting rock');
assert.ok(witnessSites[0].unique && witnessSites[0].dyeId?.startsWith('dye:CLOTH:'),'witness inscription uses a named game dye');
assert.ok(/^#[0-9a-f]{6}$/i.test(witnessSites[0].ink),'marked rock has a real renderable dye hex');
const witnessVerse = Riddles.generate({ zoneId:'map_northern_cliffs',layout:sceneryWorld,instance:sceneryWorld.localeInstances[0],
  targetObjectKey:'blossom-tree',targetKind:'blossom',targetName:'Cyan Blossom',landmarks,seed:'witness-grounded-route' });
assert.equal(witnessVerse.ok,true,'unique witness route still passes strict verse rhyme checks');
assert.match(witnessVerse.text,/^(?:Begin|Start|Stand) at the only /,'the first line starts at the unique painted rock, not a vague zone or sector');
assert.ok(/north|south|east|west/.test(witnessVerse.text),'route directions contain actual cardinal bearings, including a direct first-line couplet');
assert.ok(witnessVerse.evidence.route.every(step=>/ground|climbing|descending/.test(step.elevation)),'every walking leg states its elevation change or level ground');
assert.equal(witnessVerse.evidence.uniqueStart.dyeId,witnessSites[0].dyeId,'riddle ink matches the rock painted by the scenery renderer');
assert.equal(witnessVerse.text,Riddles.generate({zoneId:'map_northern_cliffs',layout:sceneryWorld,
  instance:sceneryWorld.localeInstances[0],targetKind:'blossom',targetName:'Cyan Blossom',landmarks,seed:'witness-grounded-route'}).text,
  'inscription, route and elevation are deterministic on load');
const canyonMap=layoutFor('cyan',25,20); // A raised target lies directly across a low-tier river from the uniquely marked stone.
for(let row=0;row<canyonMap.rows;row++)for(let col=0;col<canyonMap.cols;col++)
  canyonMap.tiles[row][col].elevTier=1;
for(let row=0;row<canyonMap.rows;row++)canyonMap.tiles[row][18]={type:'river',elevTier:0};
canyonMap.tiles[20][25]={type:'grass',elevTier:2};
const fixedMarker={kind:'witnessStone',name:'the only bright violet-inscribed witness stone',dyeName:'bright violet',
  dyeId:'dye:CLOTH:bright_violet',unique:true,point:{col:10,row:20},source:'generated-year-round-scenery'}; // A physical candidate used by the pure riddle generator.
const canyonOptions={zoneId:'map_northern_cliffs',layout:canyonMap,instance:canyonMap.localeInstances[0],
  targetKind:'blossom',targetName:'Cyan Blossom',landmarks:[fixedMarker],seed:'verified-canyon'};
const canyonVerse=Riddles.generate(canyonOptions);
assert.equal(canyonVerse.ok,true,'canyon crossing can still be rhymed with a unique landmark');
assert.equal(canyonVerse.evidence.route.length,1,'the route does not invent intermediate waypoints');
assert.equal(canyonVerse.evidence.route[0].bearing,'east','the route heads east from the rock to the target');
assert.match(canyonVerse.evidence.route[0].elevation,/climbing/,'real higher target forces an upward instruction');
assert.equal(canyonVerse.evidence.route[0].crossing?.type,'river','the intervening river must be identified');
assert.equal(canyonVerse.evidence.route[0].crossing?.canyon,true,'lowered river between high banks really cuts a canyon');
assert.match(canyonVerse.text,/crossing the river cutting a canyon/,'the actual poem calls out the river and its canyon');
canyonMap.tiles[20][25].elevTier=1; // Opposite canyon banks are at equal height; the intermediate river remains one tier below.
const equalBankRoute=Riddles.generate(canyonOptions);
assert.equal(equalBankRoute.ok,true);
assert.match(equalBankRoute.evidence.route[0].elevation,/descending.*climbing/,
  'equal start/end heights must still describe the descent into and ascent out of the canyon');
assert.doesNotMatch(equalBankRoute.evidence.route[0].elevation,/roughly level ground/,
  'a valley is not level ground simply because the endpoints share a plateau tier');
assert.equal(equalBankRoute.evidence.route[0].crossing?.canyon,true);
canyonMap.tiles[20][25].elevTier=2; // Restore raised destination for the remaining no-canyon controls.
for(let row=0;row<canyonMap.rows;row++)canyonMap.tiles[row][18].elevTier=1;
const nonCanyon=Riddles.generate(canyonOptions);
assert.equal(nonCanyon.evidence.route[0].crossing?.canyon,false,'a flat river is not invented as a canyon');
assert.doesNotMatch(nonCanyon.text,/cutting a canyon/,'do not make up a canyon when the river has level banks');
for(let row=0;row<canyonMap.rows;row++)canyonMap.tiles[row][18]={type:'grass',elevTier:1};
const dryRoute=Riddles.generate(canyonOptions);
assert.equal(dryRoute.evidence.route[0].crossing,null,'dry ground cannot produce phantom river crossings');
assert.doesNotMatch(dryRoute.text,/crossing the river/,'the poem omits a river when no crossing exists');
const ridgeMap=layoutFor('cyan',25,20); // Same-height route endpoints with a real high ridgeline between them.
for(let row=0;row<ridgeMap.rows;row++)for(let col=0;col<ridgeMap.cols;col++)ridgeMap.tiles[row][col].elevTier=1;
for(let row=0;row<ridgeMap.rows;row++)ridgeMap.tiles[row][17].elevTier=3;
const ridgeRoute=Riddles.generate({...canyonOptions,layout:ridgeMap,instance:ridgeMap.localeInstances[0]});
assert.match(ridgeRoute.evidence.route[0].elevation,/climbing.*descending/,
  'a ridge on the bearing must be mentioned even when the start and destination are both lower');
const waterfallTerrain=layoutFor('cyan',27,30); // Two separate real falls of different measured vertical drops.
for(let row=0;row<waterfallTerrain.rows;row++)for(let col=0;col<waterfallTerrain.cols;col++)
  waterfallTerrain.tiles[row][col].elevTier=1;
waterfallTerrain.tiles[14][18]={type:'waterfall',elevTier:3};
waterfallTerrain.tiles[13][18]={type:'river',elevTier:1};
waterfallTerrain.tiles[19][39]={type:'waterfall',elevTier:2};
waterfallTerrain.tiles[18][39]={type:'river',elevTier:1};
const waterfallSites=Scenery.planForLayout('map_northern_cliffs',waterfallTerrain,'unit-world:waterfalls');
const waterfallVerse=Riddles.generate({zoneId:'map_northern_cliffs',layout:waterfallTerrain,instance:waterfallTerrain.localeInstances[0],
  targetKind:'blossom',targetName:'Cyan Blossom',landmarks:waterfallSites,seed:'highest-verified-waterfall'});
assert.equal(waterfallVerse.ok,true);
assert.equal(waterfallVerse.evidence.uniqueStart.kind,'waterfallAnchor','the objectively tallest waterfall outranks the dyed-rock fallback');
assert.deepEqual(waterfallVerse.evidence.uniqueStart.coordinate,{col:18,row:14},'start is the fall with the greatest actual plateau drop');
assert.match(waterfallVerse.text,/^(?:Begin|Start|Stand) at the tallest waterfall in Northern Cliffs/,'no tie exists, so tallest waterfall is a unique true landmark');
const cliffFallLayout=layoutFor('cyan',27,30); // The actual waterfall renderer also creates sheets across dry cliff-to-waterfall edges.
for(let row=0;row<cliffFallLayout.rows;row++)for(let col=0;col<cliffFallLayout.cols;col++)
  cliffFallLayout.tiles[row][col].elevTier=1;
cliffFallLayout.tiles[12][15]={type:'waterfall',elevTier:4}; // Its lower neighbors are GRASS, not river tiles.
cliffFallLayout.tiles[20][40]={type:'waterfall',elevTier:2}; // A visibly smaller waterfall for unique max-drop ranking.
const dryCliffFall=Riddles.generate({zoneId:'map_northern_cliffs',layout:cliffFallLayout,
  instance:cliffFallLayout.localeInstances[0],targetKind:'blossom',targetName:'Cyan Blossom',
  landmarks:Scenery.planForLayout('map_northern_cliffs',cliffFallLayout,'world:cliff-falls'),seed:'dry-fall-renderer-contract'});
assert.equal(dryCliffFall.ok,true);
assert.equal(dryCliffFall.evidence.uniqueStart.kind,'waterfallAnchor','real dry-cliff waterfalls qualify even with no adjacent river tile');
assert.deepEqual(dryCliffFall.evidence.uniqueStart.coordinate,{col:15,row:12},'tallest visible dry-cliff curtain wins');
const flatWaterfall=layoutFor('cyan',27,30); // A waterfall-labeled tile without a vertical curtain is not an actual visible waterfall.
flatWaterfall.tiles[12][15]={type:'waterfall',elevTier:0};
const noCurtain=Riddles.generate({zoneId:'map_northern_cliffs',layout:flatWaterfall,
  instance:flatWaterfall.localeInstances[0],targetKind:'blossom',targetName:'Cyan Blossom',
  landmarks:Scenery.planForLayout('map_northern_cliffs',flatWaterfall,'world:no-curtain'),seed:'no-curtain'});
assert.equal(noCurtain.ok,true);
assert.equal(noCurtain.evidence.uniqueStart.kind,'witnessStone',
  'a flat waterfall tile without a rendered curtain cannot outrank the visible dye-marked rock');
const edgeTerrain=layoutFor('cyan',25,20); // Without a painted marker, only one actual west-edge river opening exists.
edgeTerrain.tiles[11][0]={type:'river',elevTier:0};
edgeTerrain.tiles[12][0]={type:'river',elevTier:0};
const edgeVerse=Riddles.generate({zoneId:'map_northern_cliffs',layout:edgeTerrain,instance:edgeTerrain.localeInstances[0],
  targetKind:'blossom',targetName:'Cyan Blossom',seed:'single-western-exit'});
assert.equal(edgeVerse.ok,true);
assert.equal(edgeVerse.evidence.uniqueStart?.kind,'riverEdgeAnchor','a single cardinal river boundary crossing is an unambiguous natural anchor');
assert.match(edgeVerse.text,/western boundary/,'cardinal river boundary directions match the actual map edge');
const cliffDoorClue = Riddles.generate({
  zoneId:'map_northern_cliffs', layout:layoutFor('cyan'), instance:layoutFor('cyan').localeInstances[0],
  targetObjectKey:'blossom-tree', targetKind:'blossom', targetName:'Cyan Blossom',
  landmarks:[{name:'a cliff door', point:{col:28,row:26}, source:'registered-cliff-door'}], seed:'cliff-door-example'
});
assert.equal(cliffDoorClue.ok, true);
assert.ok(cliffDoorClue.facts.some(f=>f.source==='registered-cliff-door'), 'only a registered, physically present cliff door becomes a clue');
assert.doesNotMatch(cliffDoorClue.text, forbiddenTiming);
assert.doesNotMatch(cliffDoorClue.text, forbiddenCounting);
const withBoulder = layoutFor('cyan');
withBoulder.tiles[25][27] = { type:'rock', rockKind:'undiggableBoulder', boulderId:'rockformation1' };
const boulderClue = Riddles.generate({zoneId:'map_northern_cliffs',layout:withBoulder,instance:withBoulder.localeInstances[0],blossomName:'Cyan Blossom',seed:'rock-clue'});
assert.equal(boulderClue.ok,true);
assert.equal(boulderClue.evidence.boulderFound,true,'solid boulder silhouette is eligible as a real terrain landmark');
assert.ok(boulderClue.facts.some(f=>f.source==='post-generation-boulder-tile'));
assert.doesNotMatch(boulderClue.text, forbiddenTiming);
const withWater = layoutFor('cyan');
withWater.tiles[23][26] = { type: 'stream' };
const present = Riddles.generate({ zoneId: 'map_northern_cliffs', layout: withWater, instance: withWater.localeInstances[0], blossomName: 'Cyan Blossom' });
assert.equal(present.ok, true);
assert.equal(present.evidence.waterFound, true);
assert.ok(present.facts.some(f => f.kind === 'water'));
// The real Tothal zone fold stores tiles in a Map, not an object or 2D array.
const flat = layoutFor('cyan');
flat.tiles[22][26] = { type:'stream' };
flat.tiles = flat.tiles.flatMap((line,row)=>line.map((tile,col)=>({c:col,r:row,...tile}))); // Actual runtime _zoneLayouts also permits flat {c,r} records.
const fromFlat = Riddles.generate({zoneId:'map_northern_cliffs',layout:flat,instance:flat.localeInstances[0],blossomName:'Cyan Blossom'});
assert.equal(fromFlat.ok,true);
assert.equal(fromFlat.evidence.waterFound,true,'flat runtime tile records must expose real terrain');
const merged = layoutFor('cyan');
const target = merged.localeInstances[0];
merged.tiles[23][26] = { type: 'river' };
merged.tiles[24][25] = { type: 'path' };
merged.tiles = new Map(merged.tiles.flatMap((row, y) => row.map((tile, x) => [x + ',' + y, tile])));
const fromMap = Riddles.generate({ zoneId: 'map_northern_cliffs', layout: merged, instance: target, targetObjectKey: 'blossom-tree', blossomName: 'Cyan Blossom' });
assert.ok(fromMap.ok, 'real folded Map layout produces a clue');
assert.ok(fromMap.facts.some(f => f.kind === 'water'), 'Map-based river is not silently omitted');
assert.ok(fromMap.facts.some(f => f.kind === 'path'), 'Map-based path is not silently omitted');
const riverFact = fromMap.facts.find(f => f.kind === 'water');
assert.match(riverFact.value, /west of the river/, 'direction is expressed relative to the visible river, not the hidden tree');
const generic = { x: 1, y: 1, objects: [{ key: 'ornament', x: 2, y: 2 }, { key: 'quest-symbol', x: 20, y: 21 }] };
assert.equal(Riddles.positionOf(generic, 'quest-symbol').col, 20, 'another quest can select its own target object');
assert.equal(Riddles.positionOf(generic).col, 2, 'generic fallback does not depend on blossom-tree naming');
const genericPoem = Riddles.generate({ zoneId: 'map_northern_cliffs', layout: layoutFor('cyan'), instance: layoutFor('cyan').localeInstances[0], targetName: 'the ancient obelisk', targetKind: 'target' });
assert.equal(genericPoem.ok, true, 'a completely unrelated quest can reuse the composer');
assert.match(genericPoem.text, /the ancient obelisk/);
assert.ok(genericPoem.stanzas.length <= 2, 'nonfestival quests use the same concise stanza grouping');
assert.doesNotMatch(genericPoem.text, /blossom|petals|flower|tree/i, 'unrelated quests do not inherit festival flavor text');

let festival = true, civilYear = 1156, calendarReady = false, shiftYear = 1156, currentZone = 'town', currentTile = null, tileListener = null, saveCalls = 0, treeBuilds = 0, protectedMeshCount = 0;
const sampledHeights = []; // Checks the live tree altitude sampler's pixel-space contract, including plateau elevation. // Integration tracks world-scene foliage's shared-geometry protection. // Test calendar and movement are controlled without real-time timers.
const progress = {}; // Member-owned quest records, just like QuestProgressStore.snapshot().
const pickedItems = new Set(); // Simulates the persistent character-scoped Pack Key Items until the dedicated crown test exercises the real service.
const itemDefs = new Map(); // Verifies each picked blossom was registered as an inventory item with a year-specific key.
const actionClaims = new Map(); // Verifies the real hunt advertises native Action 3 without creating a floating button.
const zones = new Map(); // Generated zone layouts, each already containing its own real blossom locale.
const assignedZones = { cyan: 'map_northern_cliffs', white: 'map_western_slope', gold: 'map_western_slope', amber: 'map_southern_cloud_forest', rose: 'map_southern_cloud_forest' }; // Mirrors the quest adapter's five targets.
for (let i = 0; i < ids.length; i++) {
  const id = ids[i], zone = assignedZones[id];
  if (!zones.has(zone)) zones.set(zone, layoutFor(id, 15 + 14 * (i % 2), 16 + 14 * (i % 2)));
  else zones.get(zone).localeInstances.push(layoutFor(id, 48, 44).localeInstances[0]);
}
const plantedTrees = []; // Tracks final scene positions to catch accidental loss of the foliage builder's local planting offset.
const scene = { children: [], add(obj) { obj.parent = this; this.children.push(obj); plantedTrees.push(obj); }, remove(obj) { this.children = this.children.filter(x => x !== obj); obj.parent = null; } }; // Tracks visible foliage ownership/cleanup.
const world = {
  FestivalProps: { blossomWindowSwatches: [{ color:'#00ffff' }, { color:'#ff8000' }, { color:'#ffffff' }, { color:'#ffbf00' }, { color:'#ffb3b3' }] },
  LocaleRiddleGenerator: Riddles, // The festival adapter consumes the same generator loaded by the browser script group.
  CalendarSystem: { aotYearNumber: () => civilYear, isInitialized: () => calendarReady },
  FestivalCalendar: { current: () => festival ? { id: 'five_blossoms' } : null },
  QuestProgressStore: { snapshot: () => progress, setStatus(id, status, fields) { saveCalls++; progress[id] = { status, progress: { ...progress[id]?.progress, ...fields } }; return true; } },
  PlayerTileEvents: { current: () => currentTile, subscribe(listener) { tileListener = listener; return () => { if (tileListener === listener) tileListener = null; }; } },
  KeyItemSystem: { defineMany(defs) {defs.forEach(def=>itemDefs.set(def.id,def));},
    has: id => pickedItems.has(id),
    grant(id) {if(!itemDefs.has(id))return {ok:false};const granted=!pickedItems.has(id);pickedItems.add(id);return {ok:true,granted};},
    revoke(id) {const removed=pickedItems.delete(id);return {ok:true,removed};} },
  GameplayInputRouter: {setClaims(id,rows){actionClaims.set(id,rows);},clearClaims(id){actionClaims.delete(id);}},
  WildernessLandmarkScenery: {landmarksFor(zone,layout){return Scenery.planForLayout(zone,layout,'unit-world:'+shiftYear);}}, // The real hunt now uses the same dye-marked landmarks as the scene.
  DevCompanion: { registerStateProvider() {} },
  GridTileAccessors: { getActiveScene: () => scene },
  FoliageGenerator: { buildWildernessBlossomTreeMesh() { treeBuilds++; return { userData: {}, position: { y:.25, set(x,y,z) { this.x=x; this.y=y; this.z=z; } }, scale: { multiplyScalar() {} }, traverse(fn) { const mesh={geometry:{},userData:{}}; fn(mesh); if(mesh.userData.festivalSharedFoliage) protectedMeshCount++; } }; } },
  ClimbSystem: { groundYAt: (x,y) => { sampledHeights.push({x,y}); return 0; } }
};
vm.runInContext(fs.readFileSync(path.join(ROOT, 'docs/js/festival-blossom-hunt.js'), 'utf8'), vm.createContext({ window: world, console }));
const hunt = world.FestivalBlossomHunt; // Real browser namespace under test.
const deps = { TILE: 64, _zoneLayouts: zones, getCurrentArea: () => currentZone, currentTothalYear: () => shiftYear, tothalWorldId: () => 'unit-world', showToast() {} }; // Same injection shape as WildernessMap.init.
hunt.bindQuestDeps({ getQuestProgress: () => progress });
hunt.init(deps);
hunt.update();
assert.equal(Object.keys(progress).length, 0, 'calendar initialization must precede quest writes and expirations');
calendarReady = true;
hunt.update();
const questId = 'five_blossoms_wilderness_hunt:1156';
assert.equal(progress[questId]?.status, 'active', 'festival automatically starts the world-member quest');
// A dev-forced regeneration reuses the Tothal cycle but replaces the generated workspace object.
const northId = 'map_northern_cliffs'; // Only the unfinished cyan clue is active at this point.
const originalNorth = zones.get(northId); // Restore the authored sample after exercising new placements.
const firstClue = progress[questId].progress.detail; // The original saved verse must not survive a changed physical location.
const beforeForceSaves = saveCalls; // Idle checks must not trigger repeated member-save writes.
zones.set(northId, layoutFor('cyan', 48, 45));
hunt.update();
const forcedClue = progress[questId].progress.detail;
assert.notEqual(forcedClue, firstClue, 'same-cycle forced regeneration replaces the saved verse');
assert.equal(forcedClue, hunt.__test.clueFor(hunt.BLOSSOMS[0]).text, 'persisted verse describes the new generated terrain');
assert.equal(progress[questId].progress.shiftYear, shiftYear, 'rebuild does not invent a different Tothal cycle');
assert.equal(progress[questId].progress.found.length, 0, 'forced regeneration does not reset collected progress');
assert.equal(saveCalls, beforeForceSaves + 1, 'changed same-cycle terrain writes the corrected verse only once');
hunt.update();
assert.equal(saveCalls, beforeForceSaves + 1, 'unchanged layouts do not cause save spam on festival ticks');
zones.delete(northId); // During a shift, the old layout may disappear before the replacement finishes stamping.
hunt.update();
assert.equal(progress[questId].progress.detail, forcedClue, 'missing intermediate locale does not overwrite the saved verse');
assert.equal(hunt.debugSnapshot().savedClueSynced, false, 'mobile diagnostic exposes a pending regeneration');
zones.set(northId, layoutFor('cyan', 33, 45));
hunt.update();
assert.equal(progress[questId].progress.detail, hunt.__test.clueFor(hunt.BLOSSOMS[0]).text, 'recovered zone immediately refreshes persisted clue');
assert.notEqual(progress[questId].progress.detail, forcedClue, 'recovered locale no longer points to the pre-regeneration site');
zones.set(northId, originalNorth);
hunt.update();
assert.equal(progress[questId].progress.detail, firstClue, 'restored layout recreates the original deterministic verse');
assert.equal(hunt.debugSnapshot().savedClueSynced, true, 'diagnostic confirms persisted clue matches current placement');
const beforeIdenticalForce = saveCalls; // A fresh workspace with identical terrain must not write redundant progress.
zones.set(northId, layoutFor('cyan', 15, 16));
hunt.update();
assert.equal(saveCalls, beforeIdenticalForce, 'same-cycle rebuild with an identical verse avoids a disk write');
zones.set(northId, originalNorth);
hunt.update();
for (const id of ids) {
  currentZone = assignedZones[id];
  const instance = zones.get(currentZone).localeInstances.find(x => x.localeId.endsWith(id));
  const target = Riddles.positionOf(instance);
  assert.ok(tileListener, 'quest subscribes to player tile changes');
  currentTile={ area:currentZone,col:target.col,row:target.row };
  tileListener({to:currentTile});
  assert.ok(!progress[questId].progress.found.includes(id),id+' must NOT be picked merely by entering its tile');
  assert.equal(hunt.nearbyTree()?.id,id,'the real tree becomes interactable inside reach');
  const pickClaim=actionClaims.get('five-blossoms-tree')?.[0];
  assert.equal(pickClaim?.actionId,'action3',id+': pick action is assigned to the real third arch button');
  assert.equal(pickClaim?.showInArch,true,id+': pickup uses shared action-arch presentation');
  assert.equal(pickClaim?.hudIcon,'🌸',id+': the arch displays the blossom icon');
  assert.equal(hunt.pickBlossom(id),true,id+' is picked only by interacting');
  assert.ok(progress[questId].progress.found.includes(id),id+' is recorded after interaction');
  assert.equal(actionClaims.has('five-blossoms-tree'),false,id+': claiming a tree removes its native arch action until a new tree is nearby');
  assert.equal(world.KeyItemSystem.has(hunt.itemKey(id)),true,id+' is carried as a real Pack item');
  if (id === 'cyan') {
    const originalWest = zones.get('map_western_slope'); // Preserve the fixture after checking the next active riddle.
    const reshiftedWest = layoutFor('white', 37, 42); // Changes only the still-uncollected white target.
    reshiftedWest.localeInstances.push(originalWest.localeInstances.find(entry => entry.localeId.endsWith('gold')));
    zones.set('map_western_slope', reshiftedWest);
    hunt.update();
    assert.equal(progress[questId].progress.found.join(','), 'cyan', 'forced shift preserves picked blossoms');
    assert.equal(world.KeyItemSystem.has(hunt.itemKey('cyan')), true, 'forced shift preserves carried physical blossom');
    assert.equal(progress[questId].progress.detail, hunt.__test.clueFor(hunt.BLOSSOMS[1]).text, 'next saved clue uses regenerated target');
    zones.set('map_western_slope', originalWest);
    hunt.update();
  }
}
assert.equal(progress[questId].status,'active','all five physical blossoms still require Father Hunundi turn-in');
assert.equal(progress[questId].progress.found.length,5);
assert.equal(hunt.menuStatus().ready,true,'five carried items unlock Father Hunundi turn-in');
hunt.update();
assert.equal(hunt.pickBlossom('cyan'),false,'cannot pick a sixth copy of a collected tree');
world.QuestProgressStore.setStatus(questId,'completed',{crowned:true}); // Dedicated ceremony test validates the real asynchronous crown transaction.
hunt.update();
assert.equal(progress[questId].status,'completed','the crowned year does not restart its hunt');
civilYear = 1157;
festival = true;
hunt.update();
assert.equal(progress['five_blossoms_wilderness_hunt:1157']?.status, 'active');
currentZone = 'map_southern_cloud_forest';
const roseInstance = zones.get(currentZone).localeInstances.find(item => item.localeId.endsWith('rose'));
const rosePoint = Riddles.positionOf(roseInstance, 'blossom-tree');
currentTile={area:currentZone,col:rosePoint.col,row:rosePoint.row};
tileListener({to:currentTile});
assert.equal(progress['five_blossoms_wilderness_hunt:1157'].progress.found.length,0,'standing at a second-year blossom only exposes interaction');
assert.equal(hunt.pickBlossom('rose'),true);
assert.equal(progress['five_blossoms_wilderness_hunt:1157'].progress.found.join(','),'rose','a tree picked out of riddle order still counts');
assert.equal(progress['five_blossoms_wilderness_hunt:1157'].progress.target, 'cyan', 'the active riddle remains the first still-unfound blossom');
tileListener({to:currentTile});
assert.equal(hunt.pickBlossom('rose'),false,'the same tree cannot be picked twice');
assert.equal(progress['five_blossoms_wilderness_hunt:1157'].progress.found.length,1);
festival = false;
hunt.update();
assert.equal(progress['five_blossoms_wilderness_hunt:1157'].status, 'expired', 'unfinished hunt ends after festival week');
currentZone = 'map_northern_cliffs';
hunt.update();
assert.ok(hunt.debugSnapshot().displayedTrees.includes('locale_five_blossoms_cyan'), 'the tree remains a physical wilderness locale outside the festival');
assert.equal(treeBuilds, 6, 'a revisited zone receives a fresh tree instance while shared source geometry remains cached by FoliageGenerator');
assert.ok(plantedTrees.every(tree => tree.position.y === .25), 'scene placement retains the builder\'s root-level offset above the sampled floor');
const northTree = Riddles.positionOf(zones.get('map_northern_cliffs').localeInstances[0], 'blossom-tree');
assert.ok(sampledHeights.some(p => p.x === (northTree.col + .5) * deps.TILE && p.y === (northTree.row + .5) * deps.TILE), 'tree floor is sampled in pixel-space, not map-tile coordinates');
assert.equal(protectedMeshCount, treeBuilds, 'every scene-local blossom clone protects shared GPU buffers during zone disposal');
assert.ok(saveCalls >= 8, 'every explicit pick and calendar transition saved progress');
assert.ok(hunt.debugSnapshot().present.every(item => item.stamped), 'all five quest locales are visible to runtime diagnostics');
const missingZone = zones.get('map_northern_cliffs');
zones.delete('map_northern_cliffs');
festival = true;
civilYear = 1158;
hunt.update();
assert.match(hunt.menuStatus().detail, /Northern Cliffs/, 'when a zone is not generated, the quest still names the zone to search');
zones.set('map_northern_cliffs', missingZone);

// The parser must not import a second unversioned terrain matcher after its versioned script has already installed.
const temporarySource = fs.readFileSync(path.join(ROOT, 'docs/js/temporary-locales.js'), 'utf8');
const writes = []; // Captures the actual browser parser-time loader output without a DOM.
const loaderContext = { window: { LocaleTerrainPlacement: {} }, document: { currentScript: { src: 'https://example.test/js/temporary-locales.js' }, write: html => writes.push(html) }, URL };
vm.runInNewContext(temporarySource, loaderContext);
assert.equal(writes.join('').includes('locale-terrain-placement.js'), false, 'existing terrain matcher is never overwritten by an unversioned duplicate');
assert.ok(writes.join('').includes('cloud-forest-runtime.js'), 'other parser-time locale dependencies still load');

console.log('Five Blossoms hunt: ' + poems + ' seeded riddles; five stamped locales; saved progress, reward lockout and expiry checked.');