// Reusable, deterministic locale riddle composer. A clue only names verified, post-generation terrain.
// No festival dependency: other quests can provide any stamped locale and a zone workspace.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LocaleRiddleGenerator = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const RHYMES = Object.freeze({ A:['stone','known','shown','alone','grown','thrown','own'], B:['near','clear','here','appear','steer'], way:['way','stray','stay','say','away'], ground:['ground','found','bound','around'], side:['guide','side','aside','abide'], place:['place','trace','grace','space','chase'], eyes:['eyes','lies','skies','prize','rise'], door:['door','more','explore','before','lore','store'], tree:['tree','see','key','free'], flow:['flow','show','know','go','grow','slow','so'] }); // Permanent terrain vocabulary: neither rhyme family implies a time of day.
  const WATER = new Set(['river', 'stream', 'water', 'lake', 'pond', 'waterfall']); // Map exports and live zones use different water tile spellings.
  const ZONES = Object.freeze({ map_northern_cliffs: 'Northern Cliffs', map_southern_cloud_forest: 'Southern Cloud Forest', map_western_slope: 'Western Slope', map_eastern_mire: 'Eastern Mire' }); // Used for the broadest first line, never inferred from requested terrain.
  const BANK = Object.freeze({
    zone: {
      A: [f => `Begin in ${f.value}, a country well known`, f => `The map names ${f.value}, marked as its own`, f => `Go into ${f.value}; let that name be known`],
      B: [f => `Make for ${f.value}; your search begins here`, f => `Let ${f.value} make the broad course clear`, f => `Seek ${f.value}, and draw the region near`]
    },
    sector: {
      A: [f => `In ${f.value}, let this bearing be known`, f => `Turn to ${f.value}, where the ground is known`, f => `Keep ${f.value} as the region shown`],
      B: [f => `Aim for ${f.value}; the bounds grow clear`, f => `Within ${f.value}, the search draws near`, f => `Find ${f.value}; let it guide where you steer`]
    },
    water: {
      A: [f => `Search ${f.value}; let the clue be known`, f => `Search ${f.value}; the water's course is known`, f => `Look ${f.value}, where a mark may be shown`],
      B: [f => `Keep ${f.value}, and the place draws near`, f => `Stand ${f.value}; the direction is clear`, f => `Look ${f.value}; your next landmark is near`]
    },
    path: {
      A: [f => `Seek ${f.value}; let that bearing be known`, f => `Look ${f.value}; let the direction be known`, f => `Seek ${f.value}, not the roadway alone`],
      B: [f => `Look ${f.value}; the way becomes clear`, f => `Keep ${f.value}, and your search draws near`, f => `Go ${f.value}; let that guide where you steer`]
    },
    landmark: {
      A: [f => `Look ${f.value}; the landmark's place is known`, f => `Seek ${f.value}; let the bearing be known`, f => `Search ${f.value}; the mark is shown`],
      B: [f => `Keep ${f.value}; the next sign is near`, f => `Stand ${f.value}, and the way grows clear`, f => `Look ${f.value}; let it guide where you steer`]
    },
    boulder: {
      A: [f => `Search ${f.value}; the boulder's shape is stone`, f => `Search ${f.value}; the rock can be known`, f => `Look ${f.value}, where rough shapes are shown`],
      B: [f => `Look ${f.value}; the rock may be near`, f => `Seek ${f.value}, and the bounds grow clear`, f => `Keep ${f.value}; that is where to steer`]
    },
    blossom: {
      A: [f => `Find ${f.value}, where bright leaves have grown`, f => `Seek ${f.value}, unlike the other trees known`, f => `At ${f.value}, the promised bloom is shown`],
      B: [f => `Look for ${f.value}; its crown shall appear`, f => `Find ${f.value}, and your answer is here`, f => `Reach ${f.value}; the goal is now clear`]
    },
    target: {
      A: [f => `Find ${f.value}; the mark is shown`, f => `Seek ${f.value}, the destination known`, f => `There waits ${f.value}, and that place alone`],
      B: [f => `Find ${f.value}; your answer is here`, f => `Look for ${f.value}; the goal is clear`, f => `Reach ${f.value}, and the end draws near`]
    }
  }); // Each verified descriptor has several interchangeable A and B lines with matching terminal sounds.


  const FAMILIES = Object.freeze(['A','B','way','ground','side','place','eyes','door','tree','flow']); // Ten deterministic phonetic families.
  const VERSE_BANK = Object.freeze({
    routeAnchor:{
      A:['Begin at {value}; the one stone known','Stand at {value}; a place alone'],
      B:['Begin at {value}; your way starts here','Stand at {value}; the marker stands clear'],
      way:['Begin at {value}; let this be your way','Start at {value}; do not stray'],
      ground:['Begin at {value}; mark this starting ground','Stand at {value}; there your path is found'],
      side:['Begin at {value}; let its marking be your guide','Start at {value}; set all other marks aside'],
      place:['Begin at {value}; this is the starting place','Stand at {value}; from here begin the chase'],
      eyes:['Begin at {value}; fix it in your eyes','Stand at {value}; a marked stone never lies'],
      door:['Begin at {value}; then seek something more','Stand at {value}; here the road opens its door'],
      tree:['Begin at {value}; its dyed rune is your key','Stand at {value}; its color you shall see'],
      flow:['Begin at {value}; then follow where to go','Start at {value}; the marked stone tells you so']
    },
    routeStep:{
      A:['From there go {value}; let the way be known','Next go {value}; let that step be shown'],
      B:['From there go {value}; the next sign is near','Next go {value}; the way becomes clear'],
      way:['From there, go {value}; follow that way','Next go {value}; do not stray'],
      ground:['From there, go {value}; reach the ground','Next go {value}; the route is found'],
      side:['From there, go {value}; let the heights be your guide','Next go {value}; keep to that side'],
      place:['From there, go {value}; find that place','Next go {value}; follow the trace'],
      eyes:['From there, go {value}; trust your eyes','Next go {value}; the next marker lies'],
      door:['From there, go {value}; look once more','Next go {value}; explore'],
      tree:['From there, go {value}; there you shall see','Next go {value}; this is your key'],
      flow:['From there, go {value}; let the water flow','Next go {value}; follow what you know']
    },
    zone:{
      way:['Let {value} be the start of your way','Begin in {value}; do not stray'],
      ground:['Within {value}, the search is bound','Seek {value}; begin on this ground'],
      side:['In {value}, let the land be your guide','Seek {value}; set other lands aside'],
      place:['Within {value} lies the sought-after place','Search {value}, the first of clues to trace'],
      eyes:['In {value}, look with searching eyes','Within {value}, the hidden answer lies'],
      door:['In {value}, begin to explore','Seek {value}; the land holds something more'],
      tree:['Search {value}; the country holds the key',"In {value}, the goal you seek you'll see"],
      flow:['Toward {value}, set your feet and go','Begin in {value}; let your knowledge grow']
    },
    bearing:{
      way:['Look {value}; let this bearing point the way','Seek {value}; do not let your steps stray','Search {value}; let that clue have its say'],
      ground:['Search {value}; a clue waits to be found','Look {value}; the bearing marks this ground','Go {value}; to this bearing you are bound'],
      side:['Look {value}; let the clue be your guide','Seek {value}; set other hints aside','Search {value}; put idle doubts aside'],
      place:['Search {value}; it helps to fix the place',"Look {value}; pursue the riddle's trace",'Seek {value}; explore the nearby space'],
      eyes:['Look {value}; let the clue direct your eyes','Search {value}; the hidden answer lies','Seek {value}; there waits the sought-for prize'],
      door:['Look {value}; then search a little more',"Seek {value}; there's ground left to explore",'Go {value}; find what the land holds in store'],
      tree:['Look {value}; this hint becomes your key',"Search {value}; there's more for you to see",'Seek {value}; let the clue set you free'],
      flow:['Search {value}; the riddle has more to show','Look {value}; follow what you know','Go {value}; let the searching onward flow']
    },
    blossom:{
      way:['Find {value}; its blossoms end your way','At {value}, the colored petals stay'],
      ground:['Find {value}; where colored blooms are found','Seek {value}; its roots hold to the ground'],
      side:['Find {value}; let its branches be your guide','Seek {value}; where colored blooms abide'],
      place:['Find {value}; the blossom marks the place','Seek {value}; where petals lend their grace'],
      eyes:['Find {value}; bright petals meet your eyes','At {value}, the hidden answer lies'],
      door:['Find {value}; the riddle asks no more','Seek {value}; here ends what you explore'],
      tree:['Find {value}, the long-sought tree','At {value}, the petals hold the key'],
      flow:['Find {value}, and let the searching go','At {value}, its blossoms tell you so']
    },
    target:{
      way:["Find {value}; you've reached the end of the way",'Seek {value}; here your footsteps may stay'],
      ground:['Find {value}; the answer has been found','Seek {value}; its place is on this ground'],
      side:['Find {value}; set other hints aside','Seek {value}; the last clue is your guide'],
      place:["Find {value}; you've reached the sought-for place",'Seek {value}; it ends your wandering chase'],
      eyes:['At {value}, the final answer lies','At {value}, the search has earned its prize'],
      door:['Seek {value}; no need to search for more','Find {value}; here ends what you explore'],
      tree:['Find {value}; let that be your key','Seek {value}; the answer you will see'],
      flow:['Find {value}; let the wandering slow','Seek {value}; the answer you will know']
    }
  }); // Universal stanza endings use facts, not fabricated structures.
  const LANDMARK_BANK = Object.freeze({
    water:{flow:['Search {value}; follow where the waters flow','Look {value}; follow what the waters show'],side:['Look {value}; let the water be your guide']},
    path:{way:['Search {value}; the trodden track defines the way','Look {value}; let the trail have its say'],side:['Seek {value}; let the footpath be your guide']},
    boulder:{A:['Search {value}; the earth holds fast to stone','Look {value}; the unyielding rock is shown'],ground:['Seek {value}; the stubborn stone marks the ground'],eyes:['Search {value}; the boulder rises before your eyes']},
    stoneCairn:{A:['Look {value}; its stacked shape is stone','Search {value}; the piled stones make their mark known'],ground:['Seek {value}; stacked stones rise from the ground'],eyes:['Seek {value}; let stacked stones guide your eyes']},
    brokenPillar:{A:['Look {value}; its fracture speaks in stone','Seek {value}; the broken masonry is shown'],ground:['Search {value}; scarred masonry marks the ground'],place:['Look {value}; shattered masonry marks the place']},
    deadTree:{tree:['Look {value}; bare branches hold the key','Seek {value}; the leafless tree is yours to see'],eyes:['Search {value}; bare branches sketch the skies'],side:['Seek {value}; let the leafless tree be your guide']},
    cliffDoor:{door:['Look {value}; stone keeps watch upon the door','Seek {value}; stone guards a way to explore'],place:['Search {value}; the cliff door marks the place'],side:['Look {value}; let the cliffside door be your guide']},
    rootTotem:{ground:['Look {value}; the carved sign marks the ground'],side:['Seek {value}; let the root totem be your guide']},
    animalDen:{B:["Look {value}; the creature's lair is near"],place:['Search {value}; the animal den marks the place'],ground:["Look {value}; that refuge marks the ground"]}
  }); // Witness-specific language only appears for measured and typed structures.
  const SIGNATURE = Object.freeze({
    water:['flow','side'],path:['way','side'],boulder:['A','ground','eyes'],
    stoneCairn:['A','ground','eyes'],brokenPillar:['A','ground','place'],deadTree:['tree','eyes','side'],
    cliffDoor:['door','place','side'],rootTotem:['ground','side'],animalDen:['B','place','ground']
  }); // Favor signature rhymes but leave variety available.

  // Countable noun phrases are seeded per physical referent, rather than per line.
  // This makes an indefinite first mention, a definite repeat, and "another" for a different site of the same type.
  const METAPHOR_NOUNS = Object.freeze({
    stoneCairn:['stone cairn','crown of stacked stones','little tower of stones','pile of weathered stones'],
    brokenPillar:['broken stone pillar','giant’s broken stone finger','shattered stone column','fractured pillar stump'],
    deadTree:['dead tree','leafless sentinel','bare-limbed tree','tree with no leaves'],
    cliffDoor:['cliff door','doorway cut into the cliff','stone-framed entrance','door in the rock face'],
    rootTotem:['root totem','carved root marker','root-shaped sentinel'],
    animalDen:['wild animal den','beast’s hollow','creature’s refuge','animal shelter'],
    boulder:['undiggable boulder','unyielding boulder','immovable rock','stone that no pick can break'],
    path:['trail','footpath','ribbon of a path','track across the ground'],
    river:['river','flowing river','ribbon of running water'],
    stream:['stream','narrow watercourse','ribbon of running water'],
    waterfall:['waterfall','falling water','cascade of water'],
    'open water':['open water','stretch of water','pool of water']
  }); // All forms remain true of their measured terrain, never hint at unobserved features.
  function referentType(fact) {
    if (fact.kind === 'landmark') return fact.flavor;
    return fact.kind === 'water' ? fact.waterType : fact.kind;
  }
  function referentPhrase(fact, seed, mentioned, mentionedTypes) {
    const type = referentType(fact), nouns = METAPHOR_NOUNS[type];
    const col = fact.coordinate?.col, row = fact.coordinate?.row;
    if (!fact.referenceName || !Number.isFinite(col) || !Number.isFinite(row)) return fact;
    const fallbackNoun = fact.kind === 'landmark' && /^(?:an?|the) /i.test(fact.referenceName)
      ? fact.referenceName.replace(/^(?:an?|the) /i, '') : null; // Authored locales may carry a countable name but no registered metaphor class.
    if (!nouns && !fallbackNoun) return fact; // Never rewrite an unidentified proper noun or free-form locale name.
    const id = type + ':' + col + ',' + row; // Same physical site retains its identifier across stanzas and saves.
    const noun = nouns ? nouns[hash(seed + '|metaphor|' + id) % nouns.length] : fallbackNoun;
    const category = nouns ? type : type + ':' + fallbackNoun.toLowerCase(); // Unknown locales share a kind only when their named noun is identical.
    const repeated = mentioned.has(id), another = !repeated && mentionedTypes.has(category);
    const firstArticle = /^an? /i.test(fact.referenceName) ? (/^[aeiou]/i.test(noun) ? 'an' : 'a') : 'the';
    const article = repeated ? (hash(seed + '|repeat|' + id) % 2 ? 'that' : 'the') : another ? 'another' : firstArticle;
    mentioned.add(id); mentionedTypes.add(category); // Recorded only when a line actually mentions this site.
    return { ...fact, value:fact.value.replace(fact.referenceName, article + ' ' + noun) };
  }

  function hash(value) {
    let n = 2166136261; // Stable choices make a saved riddle reproducible across browsers and devices.
    for (const c of String(value)) { n ^= c.charCodeAt(0); n = Math.imul(n, 16777619); }
    return n >>> 0;
  }
  const PLATEAU_UNIT = 2.5; // Matches terrain-preview's default; route language reports tiers, not invented absolute distances.
  const WATERWAY = new Set(['river','stream','waterfall']); // Only real flowing water makes a crossing clue.
  const FLAT_TILE_INDEX = new WeakMap(); // Actual runtime _zoneLayouts sometimes store flat {c,r,...} records, unlike merged Map and editor dictionaries.
  function tileAt(layout, col, row) {
    const map = layout?.maps?.find?.(m => m.id === 'map_generated_wilderness_root') || layout?.maps?.[0] || layout; // Authored generator workspace, or already folded runtime layout.
    if (col < 0 || row < 0) return null;
    const tiles = map?.tiles;
    if (Array.isArray(tiles) && Array.isArray(tiles[0])) return tiles[row]?.[col] || null;
    if (Array.isArray(tiles)) {
      let indexed = FLAT_TILE_INDEX.get(tiles);
      if (!indexed) {
        indexed = new Map(tiles.map(t => [String(t.c ?? t.col) + ',' + String(t.r ?? t.row), t]));
        FLAT_TILE_INDEX.set(tiles, indexed);
      }
      return indexed.get(`${col},${row}`) || null;
    }
    if (tiles instanceof Map || typeof tiles?.get === 'function') return tiles.get(`${col},${row}`) || null; // Tothal's real merged wilderness keeps tiles in a Map, unlike the editor's JSON dictionary.
    return tiles?.[`${col},${row}`] || null;
  }
  function dimensions(layout) {
    const map = layout?.maps?.find?.(m => m.id === 'map_generated_wilderness_root') || layout?.maps?.[0] || layout; // Coordinates in localeInstances refer to the same final-grid workspace.
    return { cols: Number(map?.cols) || 0, rows: Number(map?.rows) || 0 };
  }
  function positionOf(instance, objectKey = null) {
    const objects = instance?.objects || []; // Every quest supplies its target object key instead of teaching this reusable module about blossoms.
    const landmark = (objectKey && objects.find(o => o.key === objectKey || o.id === objectKey))
      || instance?.connectors?.[0] || objects[0] || instance; // Generic fallback favors walkable entrances and then authored objects.
    return { col: Number(landmark?.x ?? landmark?.col), row: Number(landmark?.y ?? landmark?.row) };
  }
  function sectorAt(col, row, cols, rows) {
    const x = col / cols, y = row / rows;
    const horiz = x < 1 / 3 ? 'western' : x >= 2 / 3 ? 'eastern' : '';
    const vert = y < 1 / 3 ? 'northern' : y >= 2 / 3 ? 'southern' : '';
    return vert && horiz ? `the ${vert.slice(0,-3)}${horiz.slice(0,-3)} sector` : vert ? `the ${vert} reaches` : horiz ? `the ${horiz} reaches` : 'the heart of the zone';
  }
  function relationship(point, feature, name) {
    const dx = point.col - feature.col, dy = point.row - feature.row; // Describe where to search FROM a visible feature, never where the feature lies from an unknown tree.
    const x = dx > 2 ? 'east' : dx < -2 ? 'west' : '';
    const y = dy > 2 ? 'south' : dy < -2 ? 'north' : '';
    return y || x ? `${y && x ? y + '-' + x : y || x} of ${name}` : `near ${name}`;
  }
  function nearbyEvidence(layout, point, radius = 24) {
    const size = dimensions(layout); // Limits actual map reads to the neighborhood, never an expensive full-map scan.
    const samples = []; // Candidate evidence includes only final, existing tiles and their measured distance from the tree.
    const r = Math.max(2, Math.min(48, Math.round(radius)));
    for (let y = Math.max(0, Math.floor(point.row - r)); y <= Math.min(size.rows - 1, Math.ceil(point.row + r)); y++)
      for (let x = Math.max(0, Math.floor(point.col - r)); x <= Math.min(size.cols - 1, Math.ceil(point.col + r)); x++) {
        const d = Math.hypot(x - point.col, y - point.row);
        if (d > r || d < 2) continue;
        const t = tileAt(layout, x, y);
        if (!t) continue;
        const type = String(t.type || '').toLowerCase();
        const boulder = type === 'rock' && (t.rockKind === 'undiggableBoulder' || t.generatedObjectType === 'undiggableBoulder' || !!t.boulderId); // Only genuine solid, generated boulder formations supply a stone landmark.
        if (WATER.has(type) || (Number(t.water) > 0) || t.path === true || type === 'path' || boulder)
          samples.push({ col:x, row:y, d, type: boulder ? 'boulder' : WATER.has(type) || Number(t.water) > 0 ? 'water' : 'path', waterType:type });
      }
    samples.sort((a, b) => a.d - b.d || a.row - b.row || a.col - b.col);
    return samples;
  }
  function elevationAt(layout, point) {
    const tile = tileAt(layout, Math.round(point.col),Math.round(point.row));
    if(!tile)return null;
    const tier=Number(tile.type==='ramp' ? tile.rampElevation : tile.elevTier ?? tile.elevation ?? 0);
    if(!Number.isFinite(tier))return null;
    const visual=layout?.visualHeights;
    const raw=typeof visual?.get==='function'?visual.get(Math.round(point.col)+','+Math.round(point.row)):visual?.[Math.round(point.col)+','+Math.round(point.row)];
    const subtle=Number.isFinite(Number(raw))?Number(raw)*PLATEAU_UNIT*.24:0; // Real surface height modulation; relative sign never depends on a fictional mountain.
    return tier*PLATEAU_UNIT+subtle;
  }
  function compass(from,to) {
    const dx=to.col-from.col, dy=to.row-from.row;
    const horizontal=Math.abs(dx)>=1?dx>0?'east':'west':'';
    const vertical=Math.abs(dy)>=1?dy>0?'south':'north':'';
    return vertical&&horizontal?vertical+'-'+horizontal:vertical||horizontal||'locally';
  }
  function crossingBetween(layout,from,to) {
    const dx=to.col-from.col,dy=to.row-from.row;
    const steps=Math.max(1,Math.ceil(Math.max(Math.abs(dx),Math.abs(dy))*4)); // Super-sampled straight bearing; no imagined bridge or ford.
    const crossed=[];
    for(let i=1;i<steps;i++){
      const col=Math.round(from.col+dx*i/steps),row=Math.round(from.row+dy*i/steps);
      const tile=tileAt(layout,col,row),type=String(tile?.type||'').toLowerCase();
      if(!WATERWAY.has(type)||crossed.some(x=>x.col===col&&x.row===row))continue;
      crossed.push({col,row,type,tile});
    }
    if(!crossed.length)return null;
    const river=crossed.some(x=>x.type==='river'||x.type==='waterfall'),name=river?'river':'stream';
    const length=Math.hypot(dx,dy)||1,alongX=dx/length,alongY=dy/length;
    let canyon=false;
    for(const water of crossed){
      const center=elevationAt(layout,water);
      const banks=[];
      for(const direction of [-1,1]){
        for(const distance of [1,2,3,4,5,6]){
          const col=Math.round(water.col+alongX*distance*direction),row=Math.round(water.row+alongY*distance*direction);
          const bank=tileAt(layout,col,row);
          if(!bank || WATERWAY.has(String(bank.type||'').toLowerCase()))continue;
          banks.push(elevationAt(layout,{col,row}));break; // Sample opposite dry banks across the travel direction, not downstream/upstream in the river.
        }
      }
      if(center!=null&&banks.length===2&&banks.every(y=>y!=null&&y-center>=PLATEAU_UNIT*.75)){canyon=true;break;}
    }
    return {type:name,canyon,coordinates:crossed.map(({col,row})=>({col,row}))}; // Diagnostic evidence retains the exact stamped water tiles.
  }
  function elevationProfile(layout,from,to) {
    const dx=to.col-from.col,dy=to.row-from.row;
    const steps=Math.max(1,Math.ceil(Math.max(Math.abs(dx),Math.abs(dy))*2)); // Traverse actual intermediate terrain at half-tile intervals, rather than describing only the endpoints.
    let minimum=Infinity,maximum=-Infinity;
    for(let i=0;i<=steps;i++) {
      const point={col:Math.round(from.col+dx*i/steps),row:Math.round(from.row+dy*i/steps)};
      const height=elevationAt(layout,point);
      if(height==null)continue;
      minimum=Math.min(minimum,height);maximum=Math.max(maximum,height);
    }
    return minimum===Infinity?null:{minimum,maximum};
  }
  function routeBearing(layout,from,to,place) {
    const bearing=compass(from,to),before=elevationAt(layout,from),after=elevationAt(layout,to);
    const diff=before==null||after==null?null:after-before;
    const steps=diff==null?null:Math.round(Math.abs(diff)/PLATEAU_UNIT);
    const profile=diff==null?null:elevationProfile(layout,from,to); // The path may descend into a gorge then return to the starting altitude.
    const trough=!!profile && profile.minimum < Math.min(before,after)-PLATEAU_UNIT*.5;
    const crest=!!profile && profile.maximum > Math.max(before,after)+PLATEAU_UNIT*.5;
    const crossing=crossingBetween(layout,from,to);
    let elevation;
    if(diff==null)elevation='following the visible terrain';
    else if(trough&&crest)elevation='descending through low ground and climbing over higher ground';
    else if(trough)elevation=diff>PLATEAU_UNIT*.5
      ?'descending into lower ground, then climbing to higher ground'
      :diff< -PLATEAU_UNIT*.5
        ?'descending into lower ground, then climbing partway back up'
        :'descending into lower ground, then climbing back up';
    else if(crest)elevation=diff>PLATEAU_UNIT*.5
      ?'climbing over higher ground, then descending partway'
      :diff< -PLATEAU_UNIT*.5
        ?'climbing over higher ground, then descending to lower ground'
        :'climbing over higher ground, then descending back down';
    else if(Math.abs(diff)<.35)elevation='staying on roughly level ground';
    else if(diff>0)elevation=steps>=2?'climbing '+steps+' plateau tiers':'climbing to higher ground';
    else elevation=steps>=2?'descending '+steps+' plateau tiers':'descending to lower ground';
    const water=crossing?(crossing.canyon?', crossing the '+crossing.type+' cutting a canyon':', crossing the '+crossing.type):'';
    return {description:bearing+', '+elevation+water+', toward '+place,bearing,elevation,crossing,
      altitudeProfile:profile,from:{...from},to:{...to}};
  }
  const NATURAL_START_CACHE = new WeakMap(); // Generated wilderness layouts are immutable through a Tothal cycle; forced regeneration supplies a new layout.
  function uniqueNaturalStart(layout,zoneName,allowEdgeRivers=false,generationKey='') {
    if(!layout || typeof layout!=='object')return null;
    const cached=NATURAL_START_CACHE.get(layout);
    if(cached?.generationKey===generationKey && (cached.waterfall || !allowEdgeRivers || cached.edgeScanned))return cached.waterfall||cached.edge||null;
    const {cols,rows}=dimensions(layout),seen=new Set(),falls=[];
    const valid=(col,row)=>col>=0&&row>=0&&col<cols&&row<rows;
    for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
      if(String(tileAt(layout,col,row)?.type||'')!=='waterfall'||seen.has(col+','+row))continue;
      const queue=[{col,row}],members=[];let drop=0;
      seen.add(col+','+row);
      for(let cursor=0;cursor<queue.length;cursor++){
        const item=queue[cursor],tile=tileAt(layout,item.col,item.row);
        members.push(item);
        const tier=Number(tile?.elevTier)||0;
        const waterTop=tier*PLATEAU_UNIT-.10+.015; // Same river/waterfall surface height as ZoneTerrainFeatures.renderedWaterSurfaceY.
        for(const [dx,dy] of [[0,1],[1,0],[0,-1],[-1,0]]){
          const nx=item.col+dx,ny=item.row+dy;
          if(!valid(nx,ny))continue;
          const next=tileAt(layout,nx,ny),type=String(next?.type||'');
          if(!next)continue;
          const nextTier=Number(next.elevTier)||0;
          if(nextTier!==tier){ // The real waterfall curtain renderer creates edges against dry cliffs as well as water.
            const nextTop=nextTier*PLATEAU_UNIT-(WATERWAY.has(type)?(type==='stream'?.05:.10)-.015:0);
            drop=Math.max(drop,Math.abs(waterTop-nextTop)); // Measure an actual rendered vertical sheet, not unrelated neighboring elevations.
          }
          const k=nx+','+ny;
          if(type==='waterfall'&&!seen.has(k)){seen.add(k);queue.push({col:nx,row:ny});}
        }
      }
      if(drop>=PLATEAU_UNIT*.75){
        members.sort((a,b)=>a.row-b.row||a.col-b.col);
        falls.push({point:members[0],drop}); // The waterfall is an actually rendered vertical water sheet, not merely a blue river tile.
      }
    }
    falls.sort((a,b)=>b.drop-a.drop||a.point.row-b.point.row||a.point.col-b.point.col);
    let waterfall=null,edge=null;
    if(falls.length){
      const max=falls[0].drop,tied=falls.filter(f=>Math.abs(f.drop-max)<.0001);
      const word=tied.length===1?'the tallest waterfall'
        :tied.filter(f=>f.point.row===tied[0].point.row).length===1?'the northernmost of the tallest waterfalls'
        :'the westernmost of the northernmost tallest waterfalls';
      waterfall={kind:'waterfallAnchor',unique:true,name:word+' in '+zoneName,point:falls[0].point,source:'measured-waterfall-drop'};
    }
    if(!waterfall && allowEdgeRivers){
      const borders=[
        {name:'northern',cells:Array.from({length:cols},(_,col)=>({col,row:0}))},
        {name:'eastern',cells:Array.from({length:rows},(_,row)=>({col:cols-1,row}))},
        {name:'southern',cells:Array.from({length:cols},(_,col)=>({col,row:rows-1}))},
        {name:'western',cells:Array.from({length:rows},(_,row)=>({col:0,row}))}
      ];
      for(const border of borders){
        const groups=[];let active=[];
        for(const p of [...border.cells,null]){
          const t=p?String(tileAt(layout,p.col,p.row)?.type||''):'';
          if(p&&WATERWAY.has(t)){active.push(p);continue;}
          if(active.length)groups.push(active);
          active=[];
        }
        if(groups.length!==1)continue; // Only one actual river/stream band touches this cardinal boundary.
        const group=groups[0],river=group.some(p=>String(tileAt(layout,p.col,p.row)?.type)==='river');
        edge={kind:'riverEdgeAnchor',unique:true,name:'the only '+(river?'river':'stream')+' crossing on the '+border.name+' boundary of '+zoneName,
          point:group[Math.floor(group.length/2)],source:'verified-boundary-waterway'};break;
      }
    }
    NATURAL_START_CACHE.set(layout,{waterfall,edge,edgeScanned:allowEdgeRivers,generationKey}); // At most one full-grid inspection per generated zone.
    return waterfall||edge;
  }
  function uniqueWitnessRoute({zoneId,zoneName,layout,point,goalName,landmarks,generationKey=''}) {
    const name=zoneName||ZONES[zoneId]||zoneId;
    const candidates=landmarks.filter(x=>x.kind==='witnessStone'&&x.unique===true&&x.source==='generated-year-round-scenery'
      &&Number.isFinite(x.point?.col)&&Number.isFinite(x.point?.row)&&tileAt(layout,x.point.col,x.point.row));
    const marker=uniqueNaturalStart(layout,name,false,generationKey)||(candidates.length===1?candidates[0]:null)||uniqueNaturalStart(layout,name,true,generationKey);
    if(!marker)return null; // Fall back to broad factual hints if neither a unique natural reference nor the unique dyed marker exists.
    const midpoint={col:(marker.point.col+point.col)/2,row:(marker.point.row+point.row)/2};
    const available=landmarks.filter(x=>x!==marker&&x.kind!=='witnessStone'&&x.kind!=='blossom'
      &&Number.isFinite(x.point?.col)&&Number.isFinite(x.point?.row)
      &&Math.hypot(x.point.col-point.col,x.point.row-point.row)>3
      &&Math.hypot(x.point.col-marker.point.col,x.point.row-marker.point.row)>3
      &&tileAt(layout,x.point.col,x.point.row));
    available.sort((a,b)=>{
      const da=Math.hypot(a.point.col-midpoint.col,a.point.row-midpoint.row);
      const db=Math.hypot(b.point.col-midpoint.col,b.point.row-midpoint.row);
      return da-db||a.point.row-b.point.row||a.point.col-b.point.col;
    });
    const waypoint=available.find(x=>Math.hypot(x.point.col-midpoint.col,x.point.row-midpoint.row)
      <=Math.max(8,Math.hypot(point.col-marker.point.col,point.row-marker.point.row)*.45))||null;
    const anchorName=marker.kind==='witnessStone'?'the only '+marker.dyeName+'-inscribed witness stone in '+name:marker.name;
    const route=[],facts=[{kind:'routeAnchor',value:anchorName,
      source:marker.source,coordinate:{...marker.point},unique:true,dye:marker.dyeId||null}];
    let current=marker.point;
    if(waypoint) {
      const leg=routeBearing(layout,current,waypoint.point,waypoint.name);
      route.push(leg);facts.push({kind:'routeStep',value:leg.description,source:waypoint.source,coordinate:{...waypoint.point},...leg});
      current=waypoint.point;
    }
    const final=routeBearing(layout,current,point,'the flowering tree');
    route.push(final);
    if(waypoint)facts.push({kind:'routeStep',value:final.description,source:'stamped-target-object',coordinate:{...point},...final});
    else facts[0].value+='; then go '+final.description; // A direct one-leg trip belongs in the opening couplet, never repeated as two fictional moves.
    facts.push({kind:'blossom',value:goalName,source:'stamped-target-object'});
    return {facts,route,anchor:{name:marker.name,coordinate:{...marker.point},dyeName:marker.dyeName||null,dyeId:marker.dyeId||null,kind:marker.kind,unique:true}};
  }

  function inspect({ zoneId, zoneName, layout, instance, targetObjectKey = null, targetName = null, targetKind = 'target', blossomName = null, landmarks: suppliedLandmarks = [], radius = 24, requireUniqueStart = false, terrainGenerationKey = '' } = {}) {
    const point = positionOf(instance, targetObjectKey);
    const size = dimensions(layout);
    if (!layout || !instance || !Number.isFinite(point.col) || !Number.isFinite(point.row) ||
      size.cols <= 0 || size.rows <= 0 || point.col < 0 || point.row < 0 || point.col >= size.cols || point.row >= size.rows) return { ok: false, reason: 'missing stamped locale or its final-grid map' };
    const facts = [
      { kind: 'zone', value: zoneName || ZONES[zoneId] || zoneId || 'the wilderness', source: 'zone-id' },
      { kind: 'sector', value: sectorAt(point.col, point.row, size.cols, size.rows), source: 'final-grid-coordinate' }
    ]; // Broad location is always included, even if optional terrain probes found nothing.
    const samples = nearbyEvidence(layout, point, radius);
    const water = samples.find(s => s.type === 'water');
    if (water) {
      const kind = ['river', 'stream', 'waterfall'].includes(water.waterType) ? water.waterType : 'open water';
      facts.push({ kind: 'water', waterType:kind, referenceName:'the ' + kind, value: relationship(point, water, 'the ' + kind), source: 'post-generation-water-tile', coordinate: { col: water.col, row: water.row }, distance: water.d });
    }
    const path = samples.find(s => s.type === 'path');
    if (path && path.d <= 16) facts.push({ kind: 'path', referenceName:'the trail', value: relationship(point, path, 'the trail'), source: 'post-generation-path-tile', coordinate: { col: path.col, row: path.row }, distance: path.d });
    const boulder = samples.find(s => s.type === 'boulder');
    if (boulder) facts.push({ kind:'boulder', referenceName:'the undiggable boulder', value:relationship(point,boulder,'the undiggable boulder'), source:'post-generation-boulder-tile', coordinate:{col:boulder.col,row:boulder.row}, distance:boulder.d });
    const others = (layout.localeInstances || []).filter(other => other !== instance && other.localeId !== instance.localeId && !String(other.localeId || '').startsWith('locale_five_blossoms_')); // Never give away a different blossom as a landmark.
    const landmarks = others.map(other => ({ name: other.name, point: positionOf(other), source: 'stamped-neighbor-locale', kind:'authoredLocale' })); // Already-stamped locale anchors are authoritative.
    for (const site of (layout.rootTotems || [])) landmarks.push({ name: 'the root totem', point: { col: Number(site.x), row: Number(site.y) }, source: 'generated-root-totem', kind:'rootTotem' }); // Uses the existing root-totem placement index.
    for (const site of (layout.animalDens || [])) landmarks.push({ name: 'a wild animal den', point: { col: Number(site.mouthAnchor?.x ?? site.x), row: Number(site.mouthAnchor?.y ?? site.y) }, source: 'generated-animal-den', kind:'animalDen' });
    for (const site of suppliedLandmarks) if (site?.name && site?.point) landmarks.push({ ...site,name: String(site.name), point: site.point, source: site.source || 'generated-scenery', kind: site.kind || (site.source === 'registered-cliff-door' ? 'cliffDoor' : 'authoredLocale') }); // Caller supplies only genuinely generated scenery, ruin entrances and cliff doors. // Use the visible den doorway rather than an assumed footprint center.
    const nearbyLandmarks = landmarks.filter(item => item.name && Number.isFinite(item.point.col) && Number.isFinite(item.point.row))
      .map(item => ({ ...item, d: Math.hypot(item.point.col - point.col, item.point.row - point.row) }))
      .filter(item => item.d <= Math.max(18, radius * 2) && item.d >= 5)
      .sort((a,b) => a.d - b.d || a.point.row - b.point.row || a.point.col - b.point.col);
    const chosen = []; // Two separate physical sites can triangulate a target, even when both have the same kind.
    for (const item of nearbyLandmarks) {
      if (chosen.some(prev => prev.point.col === item.point.col && prev.point.row === item.point.row)) continue; // Distinct cairns, dens, etc. are eligible even if their type matches.
      chosen.push(item);
      if (chosen.length === 2) break;
    }
    for (const item of chosen) facts.push({
      kind:'landmark', flavor:item.kind, referenceName:item.name, value:relationship(point,item.point,item.name),
      source:item.source, coordinate:{col:item.point.col,row:item.point.row}, distance:item.d
    });
    // No made-up landmarks and no literal tile counts. Sparse locations simply get a shorter, broader poem.
    const goalName=String(targetName||blossomName||instance.name||'the destination');
    facts.push({ kind: targetKind === 'blossom' || blossomName ? 'blossom' : 'target', value:goalName, source: 'stamped-target-object' }); // Subject wording belongs to the calling quest, not a hard-coded tree.
    const witness=(targetKind==='blossom'||blossomName)
      ?uniqueWitnessRoute({zoneId,zoneName,layout,point,goalName,landmarks,generationKey:String(terrainGenerationKey)})
      :null;
    if(requireUniqueStart&&!witness)return {ok:false,reason:'No uniquely verified starting landmark exists in the generated wilderness',zoneId,point};
    return { ok:true,zoneId,point,facts:witness?.facts||facts,
      evidence:{waterFound:!!water,pathFound:!!path,boulderFound:!!boulder,landmarkFound:chosen.length>0,landmarkCount:chosen.length,
        optionalTerrainFallback:!water&&!path&&!boulder&&!chosen.length,route:witness?.route||[],uniqueStart:witness?.anchor||null} };
    // Unmarked worlds retain the old conservative broad-to-narrow verse rather than claim a nonexistent natural landmark.
  }
  function rhymeOf(line) {
    const terminal = String(line).trim().replace(/[.,;!?]+$/, '').split(/\s+/).pop().toLowerCase();
    return FAMILIES.find(family => RHYMES[family].includes(terminal)) || null;
  }
  function descriptorKey(fact) { return fact.kind === 'landmark' ? fact.flavor || 'authoredLocale' : fact.kind; }
  function linesFor(fact, family) {
    const old = BANK[fact.kind]?.[family] || []; // Preserve legacy A/B descriptor choices.
    const basic = old.length ? old : VERSE_BANK[['zone','blossom','target','routeAnchor','routeStep'].includes(fact.kind) ? fact.kind : 'bearing']?.[family] || [];
    const extra = LANDMARK_BANK[descriptorKey(fact)]?.[family] || [];
    if (fact.kind === 'water' && fact.waterType === 'open water' && family === 'flow') return basic; // Ponds and lakes need not flow.
    return extra.length ? [...extra,...extra,...basic] : basic;
  }
  function lineFor(fact, family, seed, offset, previousEnding = '') {
    const lines = linesFor(fact, family);
    if (!lines.length) throw new TypeError('Unknown descriptor or rhyme: ' + fact.kind + '/' + family);
    const index = hash(seed + '|' + fact.kind + '|' + (fact.flavor || '') + '|' + fact.value + '|' + family) % lines.length;
    let fallback = '';
    for (let i = 0; i < lines.length; i++) {
      const phrase = lines[(index + offset + i) % lines.length];
      const line = typeof phrase === 'function' ? phrase(fact) : phrase.replaceAll('{value}', fact.kind === 'sector' && /^(?:Look|Search|Seek|Go) \{value\}/.test(phrase) ? 'within ' + fact.value : fact.value);
      const word = line.trim().split(/\s+/).pop().toLowerCase();
      if (!fallback) fallback = line;
      if (word !== previousEnding) return line;
    }
    return fallback;
  }
  function chooseFamily(lines, parity, exclude, seed) {
    const hinted = lines.filter((_, index) => index % 2 === parity)
      .flatMap(fact => descriptorKey(fact) === 'water' && fact.waterType === 'open water'
        ? ['side','B'] : SIGNATURE[descriptorKey(fact)] || [])
      .filter(family => family !== exclude);
    const allowed = FAMILIES.filter(family => family !== exclude);
    if (hinted.length && hash(seed + '|signature') % 4 !== 0)
      return hinted[hash(seed + '|landmark') % hinted.length];
    return allowed[hash(seed + '|all') % allowed.length];
  }
  const SCOPE_ORDER = Object.freeze({routeAnchor:-1,routeStep:1,zone:0, sector:1, water:2, path:3, boulder:4, landmark:5, blossom:6, target:6}); // The poem always guides from region through terrain and visible markers to the exact goal.
  function scopeRank(fact) { return SCOPE_ORDER[fact?.kind] ?? 5; } // Other quests' custom landmarks belong just before the target.
  function compose({ facts, seed = 'locale-riddle' } = {}) {
    if (!Array.isArray(facts) || facts.length < 2) return null;
    const ordered = facts.slice().sort((a,b) => scopeRank(a) - scopeRank(b)); // Stable sort preserves independent clues within a single scale.
    const groups = []; // Reuse the existing two-stanza ABAB/couplet structure, without reversing the search direction.
    for (let index = 0; index < ordered.length; index += 4) groups.push(ordered.slice(index, index + 4));
    if (groups.length > 1 && groups[groups.length - 1].length === 1) {
      const prior = groups[groups.length - 2];
      groups[groups.length - 1].unshift(prior[prior.length - 1]);
    }
    const mentioned = new Set(), mentionedTypes = new Set(); // Per-poem referents prevent indefinite articles from reintroducing the same object.
    return groups.map((group, stanzaIndex) => {
      const lines = group.length >= 4 ? group
        : group.length === 3 ? [group[0], group[1], group[1], group[2]]
        : group; // Repeated clues stay at the current detail level; never zoom out after reaching a more specific landmark.
      const stanzaSeed = seed + ':' + stanzaIndex;
      if (lines.length === 2) {
        const family = chooseFamily([lines[0], lines[1], lines[1], lines[0]], 0, null, stanzaSeed + '|couplet');
        const first = lineFor(referentPhrase(lines[0], seed, mentioned, mentionedTypes), family, stanzaSeed, 0);
        const firstEnding = first.trim().split(/\s+/).pop().toLowerCase();
        const last = lineFor(referentPhrase(lines[1], seed, mentioned, mentionedTypes), family, stanzaSeed, 1, firstEnding);
        return [first + ',', last + '.']; // One final rhyme instead of repeating the target and landmark.
      }
      const a = chooseFamily(lines, 0, null, stanzaSeed + '|A');
      const b = chooseFamily(lines, 1, a, stanzaSeed + '|B');
      const endings = ['', ''];
      return lines.map((fact, i) => {
        const family = i % 2 ? b : a, parity = i % 2;
        const line = lineFor(referentPhrase(fact, seed, mentioned, mentionedTypes), family, stanzaSeed, i >= 2 ? 1 : 0, endings[parity]);
        endings[parity] = line.trim().split(/\s+/).pop().toLowerCase();
        return line + (i === 3 ? '.' : i === 1 ? ';' : i === 0 || i === 2 ? ',':',');
      });
    });
  }
  function validate(result) {
    if (!result?.stanzas?.length) return false;
    return result.stanzas.every(stanza => {
      if (stanza.length !== 4 && stanza.length !== 2) return false;
      const families = stanza.map(rhymeOf);
      const endings = stanza.map(line => line.trim().replace(/[.,;!?]+$/, '').split(/\s+/).pop().toLowerCase());
      return families.every(Boolean) && (stanza.length === 2 ? families[0] === families[1] && endings[0] !== endings[1] :
        families[0] === families[2] && families[1] === families[3] && families[0] !== families[1] && endings[0] !== endings[2] && endings[1] !== endings[3]);
    });
  }
  function generate(options = {}) {
    const found = inspect(options);
    if (!found.ok) return found;
    const stanzas = compose({ facts: found.facts, seed: options.seed || `${options.zoneId}:${found.point.col}:${found.point.row}` });
    const result = { ...found, stanzas, text: stanzas.map(lines => lines.join('\n')).join('\n\n') };
    return validate(result) ? result : { ok: false, reason: 'rhyme validation failed', facts: found.facts };
  }
  return Object.freeze({ inspect, compose, generate, validate, positionOf, nearbyEvidence, RHYMES, ZONES });
});
