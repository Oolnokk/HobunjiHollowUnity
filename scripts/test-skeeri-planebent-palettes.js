#!/usr/bin/env node
'use strict';
// Run: node scripts/test-skeeri-planebent-palettes.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib'); // Built-in PNG inflation lets the test inspect the actual uploaded sprite pixels without browser/node modules.
const root = path.resolve(__dirname, '..'); // Game repository root for the real modules and uploaded PNG paths.
const source = fs.readFileSync(path.join(root, 'docs/js/skeeri-ruins.js'), 'utf8'); // Exercise the shipped runtime instead of copying its palette logic.
const authoredRig = JSON.parse(fs.readFileSync(path.join(root, 'docs/config/creatures/skeeri-flying-rig.json'), 'utf8')); // Original author preset remains normal Skeeri.

class Canvas {
  constructor() { this.width = 0; this.height = 0; this.pixels = null; this.ctx = null; }
  getContext() {
    if (this.ctx) return this.ctx;
    const owner = this;
    this.ctx = { filter: 'none', globalAlpha: 1,
      drawImage(image) { owner.pixels = new Uint8ClampedArray(image.pixels || image.pixelsData || owner.width * owner.height * 4); },
      getImageData() { return { data: owner.pixels ? new Uint8ClampedArray(owner.pixels) : new Uint8ClampedArray(owner.width * owner.height * 4) }; },
      putImageData(image) { owner.pixels = new Uint8ClampedArray(image.data); },
    };
    return this.ctx;
  }
}
function readRgbaPng(filename) {
  const file=fs.readFileSync(path.join(root,'docs',filename)); // Committed artist PNGs, not synthetic fixtures.
  assert.equal(file.subarray(1,4).toString('ascii'),'PNG');
  let width=0,height=0,depth=0,colorType=0;
  const compressed=[]; // IDAT chunks assembled before built-in zlib inflation.
  for(let offset=8;offset<file.length;) {
    const length=file.readUInt32BE(offset),kind=file.toString('ascii',offset+4,offset+8);
    const data=file.subarray(offset+8,offset+8+length);
    if(kind==='IHDR'){
      width=data.readUInt32BE(0);height=data.readUInt32BE(4);
      depth=data[8];colorType=data[9];
    }else if(kind==='IDAT')compressed.push(data);
    offset+=12+length;
    if(kind==='IEND')break;
  }
  assert.equal(depth,8);assert.equal(colorType,6,'authored Skeeri sprites are expected to be RGBA PNGs');
  assert(width>0&&height>0&&width*height<5000000);
  const scan=zlib.inflateSync(Buffer.concat(compressed)); // Standard lossless PNG scanline stream.
  const stride=width*4, pixels=new Uint8ClampedArray(width*height*4);
  let position=0,prior=new Uint8Array(stride);
  for(let y=0;y<height;y++) {
    const filter=scan[position++],line=new Uint8Array(stride);
    assert(filter<=4,'PNG scanline filter is supported');
    for(let i=0;i<stride;i++) {
      const left=i>=4?line[i-4]:0,up=prior[i],upperLeft=i>=4?prior[i-4]:0;
      let predictor=0;
      if(filter===1)predictor=left;
      else if(filter===2)predictor=up;
      else if(filter===3)predictor=(left+up)>>1;
      else if(filter===4){
        const guess=left+up-upperLeft,da=Math.abs(guess-left),db=Math.abs(guess-up),dc=Math.abs(guess-upperLeft);
        predictor=da<=db&&da<=dc?left:db<=dc?up:upperLeft;
      }
      line[i]=(scan[position++]+predictor)&255;
    }
    pixels.set(line,y*stride);
    prior=line;
  }
  return {width,height,naturalWidth:width,naturalHeight:height,pixels};
}

const spritePixels = new Uint8ClampedArray([ // Purple eye, neutral ink, darker natural marking, light fur highlight.
  127, 0, 255, 255, 180, 170, 160, 255,
  117, 140, 111, 255, 174, 194, 166, 255,
]);
const loads = []; // Each loaded URL proves the runtime uses the new art and existing wing assembly.
class Image {
  constructor() { this.width = this.naturalWidth = 4; this.height = this.naturalHeight = 1; this.pixels = spritePixels; }
  set src(value) {
    assert.equal(this.crossOrigin, 'anonymous', 'pixel-reading images must request CORS before src');
    loads.push(value);
    this.onload();
  }
}
let captured = null; // Last renderer call allows checking the source-space masks without WebGL.
let pixelYieldChecks = 0; // Counts cooperative breaks while creating Skeeri source masks during entry.
const w = {
  PixelWorkYield: { async maybeYield() { pixelYieldChecks++; } }, // The production main-thread scheduler may yield between large native-resolution masks.
  FlyingAnimalRig: {
    normalize: x => x,
    create(settings, images) {
      captured = { settings, images };
      return {
        setPalette(body, eyes, pattern) { this.palette = { body, eyes, pattern }; return true; },
      };
    },
  },
  HarlyaoLichCombat: {TYPE_DEFS: { // Match the live tradition definition's hue bands.
    hronal:{hues:['red','orange','yellow']},
    tothal:{hues:['green_blue','blue','blue_indigo']},
    kanthic:{hues:['indigo','indigo_violet','violet'],neutralDyes:['dye:CLOTH:gray']},
  }},
  SCRATCHBONES_CONFIG:{game:{dyes:{catalog:[]}}}, // Injected dye records below prove canonical swatch reuse.
  __farmLog() {},
};
vm.runInNewContext(source, {
  window: w, Image, document: { createElement(tag) { assert.equal(tag, 'canvas'); return new Canvas(); } },
  fetch: async () => ({ ok: true, json: async () => authoredRig }),
  Promise, console,
}, { filename: 'skeeri-ruins.js' });
const api = w.SkeeriRuins;
assert(api, 'shipped Skeeri runtime exports its API');
assert.equal(typeof api.prewarm, 'function', 'ruin entry can precompute all Skeeri eye, marking and coat masks');
const shadedEyes = api.separateEyeMarker({ width:5, height:1, pixels:new Uint8ClampedArray([
  127,0,255,255, // The exact #7F00FF eye/VFX marker.
  74,0,148,255, // Dark marker shade uses the same source hue.
  150,35,180,255, // An unrelated purple accent must remain untinted.
  159,191,159,255, // Light mint fur remains on the base body.
  117,140,111,255, // Dark mint fur belongs to the separate pattern.
])});
assert.equal(shadedEyes.marked, 2, 'only the painted marker hue family is the eye');
assert.equal(shadedEyes.body.pixels[3], 0, 'eye core must not be recolored as fur');
assert.equal(shadedEyes.body.pixels[7], 0, 'dark eye shade must not be recolored as fur');
assert.equal(shadedEyes.pattern.pixels[3], 0, 'eye core must not be a dark mint marking');
assert.equal(shadedEyes.pattern.pixels[7], 0, 'dark eye shade must not be a dark mint marking');
assert.equal(shadedEyes.glow.pixels[4], 148, 'the shaded eye uses its original luminosity');
assert.equal(shadedEyes.details.pixels[11], 255, 'unrelated purple detail keeps its original color');
const creatureDb = {'gar-wolf':{lootPool:'creature_gar-wolf'}}; // The predator baseline must not leak its loot into Skeeri.
const itemDefs = {}, inventoryItems = []; // Real wildlife registration should populate the Pack and tool arch.
assert(api.register({CREATURE_DB:creatureDb,ITEM_DEFS:itemDefs,inventoryItems}));
const lootPools = JSON.parse(fs.readFileSync(path.join(root,'docs/config/loot/loot-pools.json'),'utf8')).pools;
const itemIndex = JSON.parse(fs.readFileSync(path.join(root,'docs/config/items/item-index.json'),'utf8'));
const cooking = fs.readFileSync(path.join(root,'docs/js/cooking-data.js'),'utf8');
for(const [size,minMeat,maxMeat,hides] of [['small',1,1,1],['medium',2,3,1],['large',4,6,2]]){
  const id='skeeri-'+size,pool=lootPools['creature_'+id];
  assert.equal(creatureDb[id].lootPool,'creature_'+id,'Skeeri use species-specific loot, not inherited predator drops');
  assert.equal(pool.entries.find(entry=>entry.itemKey==='skeeriMeat').min,minMeat);
  assert.equal(pool.entries.find(entry=>entry.itemKey==='skeeriMeat').max,maxMeat);
  assert.equal(pool.entries.find(entry=>entry.itemKey==='skeeriHide').min,hides);
  assert(pool.entries.every(entry=>entry.chance===1),'all sizes yield meat and hides');
}
for(const key of ['skeeriHide','skeeriMeat']){
  assert.equal(itemDefs[key].label,itemIndex[key].label,'item label matches the central index');
  assert(inventoryItems.some(item=>item.key===key),'new Skeeri items are accessible in the inventory arch');
}
assert(itemDefs.skeeriHide.tags.includes('Hide'));
assert(itemDefs.skeeriMeat.tags.includes('Meat'));
assert(cooking.includes('"skeeriMeat": {') && cooking.includes('"categories": ["meat"]'),'Skeeri meat is eligible for ordinary cooking');
assert.equal(api.SPRITES.flying, 'assets/creaturesprites/skeeri_planebent_flying.png');
assert.equal(api.SPRITES.perched, 'assets/creaturesprites/skeeri_planebent_perched.png');
assert.equal(api.SPRITES.wings, 'assets/creaturesprites/skeeri_wings.png');
for (const url of Object.values(api.SPRITES))
  assert(fs.existsSync(path.join(root, 'docs', url)), 'missing authored PNG ' + url);
assert.equal(authoredRig.flying, 'creaturesprites/skeeri_flying.png', 'normal Skeeri author preset remains untouched');
for (const theme of ['hronal', 'tothal', 'kanthic']) {
  const a = api.paletteFor(theme, 'ruin:5:bird:2');
  const b = api.paletteFor(theme, 'ruin:5:bird:2');
  assert.deepEqual(a, b, 'deterministic palette across reloads');
  assert(api.BODY_GROUPS[theme].includes(a.body), 'a natural color from the actual ruin tradition');
  assert.match(a.eyes, /^#[0-9a-f]{6}$/i);
  assert.equal(a.theme, theme);
}
assert.notEqual(api.paletteFor('hronal', 1).body, api.paletteFor('kanthic', 1).body);
assert.equal(api.paletteFor('bogus', 1).theme, 'hronal', 'unknown ruin themes have a safe fallback');
const families = w.HarlyaoLichCombat.TYPE_DEFS; // The real named-lich tradition is the source of the permitted hue suffixes.
const dyeHue=id=>String(id).replace(/^dye:CLOTH:(?:dusty|muted|dark_muted|pure|bright)_/,''); // Exact hue identity: blue_indigo is NOT the same dye family as indigo.
const catalog = w.SCRATCHBONES_CONFIG.game.dyes.catalog; // Visible swatch catalogue, not copied arbitrary RGB colors.
const hueOrder=['red','red_orange','orange','yellow_orange','yellow','yellow_green','green','green_blue','blue','blue_indigo','indigo','indigo_violet','violet']; // One dye family order for checking exactly one neighbor in either direction.
for(const [i,hue] of hueOrder.entries()){
  for(const variant of ['dusty','muted','dark_muted','pure','bright']){
    catalog.push({id:'dye:CLOTH:'+variant+'_'+hue,hex:'#'+(i+1).toString(16).padStart(2,'0')+(variant==='pure'?'ff':'77')+(variant==='bright'?'ff':'33')});
  }
}
catalog.push({id:'dye:CLOTH:gray',hex:'#808080'});
for(const [theme,def] of Object.entries(families)){
  const before=hueOrder[(hueOrder.indexOf(def.hues[0])+hueOrder.length-1)%hueOrder.length];
  const after=hueOrder[(hueOrder.indexOf(def.hues[def.hues.length-1])+1)%hueOrder.length];
  const hueAngle={red:0,red_orange:15,orange:30,yellow_orange:45,yellow:60,yellow_green:90,
    green:120,green_blue:180,blue:240,blue_indigo:255,indigo:270,indigo_violet:285,violet:300};
  const withinDrift=(hue,edge)=>Math.abs((hueAngle[hue]-hueAngle[edge]+540)%360-180)<=30;
  const outside=new Set([before,after].filter((hue,i)=>!def.hues.includes(hue)
    && withinDrift(hue,i===0?def.hues[0]:def.hues[def.hues.length-1]))); // No 60-degree jump masquerades as a slight color drift.
  const allowedFur=new Set([...def.hues,...outside]); // Actual slightly expanded fur palette.
  const forbidden=new Set([before,after].filter(hue=>!def.hues.includes(hue)&&!outside.has(hue)));
  let outsideFur=0;
  for(let index=0;index<160;index++){
    const palette=api.paletteFor(theme,'specimen:'+index);
    const body=catalog.find(dye=>dye.id===palette.bodyDyeId);
    const pattern=catalog.find(dye=>dye.id===palette.patternDyeId);
    const eye=catalog.find(dye=>dye.id===palette.eyeDyeId);
    assert(body && pattern && eye,theme+' must read the source dye catalog for all three colors');
    assert.equal(palette.body,body.hex);
    assert.equal(palette.pattern,pattern.hex);
    assert.equal(palette.eyes,eye.hex);
    assert(def.hues.includes(dyeHue(body.id)) || def.neutralDyes?.includes(body.id),
      'natural body dye belongs to the selected lich tradition');
    assert(allowedFur.has(dyeHue(pattern.id)) || def.neutralDyes?.includes(pattern.id),
      'pattern colors may use only the immediate neighboring hue or their own group');
    if(outside.has(dyeHue(pattern.id)))outsideFur++;
    assert(!forbidden.has(dyeHue(pattern.id)),
      'fur markings cannot jump across an unusually wide adjacent hue gap');
    assert(def.hues.includes(dyeHue(eye.id)),
      'uncanny eye dye belongs STRICTLY to the lich tradition, even when fur drifts');
    assert(!outside.has(dyeHue(eye.id)),
      'no eye can use a neighboring fur-only hue');
    assert.match(body.id,/:(dusty|muted|dark_muted)_|:gray$/);
    assert.match(pattern.id,/:(dusty|muted|dark_muted)_|:gray$/);
    assert.match(eye.id,/:(pure|bright)_/);
  }
  assert(outsideFur>0 && outsideFur<60, 'adjacent-hue fur markings are occasional, not universal');
}

for(const key of ['flying','perched']) {
  const sprite=readRgbaPng(api.SPRITES[key]);
  for(const [x,y] of [[0,0],[sprite.width-1,0],[0,sprite.height-1],[sprite.width-1,sprite.height-1]]) {
    const i=(y*sprite.width+x)*4;
    assert.equal(sprite.pixels[i+3],0,
      key + ' artwork has an opaque corner matte at ('+x+','+y+') RGBA='+Array.from(sprite.pixels.slice(i,i+4)).join(','));
  }
  const extracted=api.separateEyeMarker(sprite); // The REAL artist sprite, decoded from disk.
  assert(extracted.marked>15 && extracted.marked<sprite.width*sprite.height*.03,
    key+' must contain a localized purple eye marker');
  assert(extracted.patternPixels>100 && extracted.patternPixels<sprite.width*sprite.height*.50,
    key+' must contain darker fur markings, not the entire sprite or zero pixels');
  assert(extracted.pattern && extracted.glow, key+' includes both separately tintable layers');
  // Audit every actual artist pixel: mint body, mint markings, neutral details
  // and the shaded purple eye must form a disjoint, lossless source partition.
  const layers = [extracted.body.pixels, extracted.pattern.pixels,
    extracted.details?.pixels, extracted.glow.pixels].filter(Boolean); // Shared source artwork is decoded only once.
  let covered = 0, overlap = 0, missing = 0; // Renderer regression diagnostics for each real Skeeri pose.
  for (let i = 3; i < sprite.pixels.length; i += 4) {
    if (!sprite.pixels[i]) continue;
    let present = 0; // Small fixed layer count: never allocate a fresh array for millions of real PNG pixels.
    for (const layer of layers) if (layer[i] > 0) present++;
    if (!present) missing++;
    if (present > 1) overlap++;
    if (present === 1) covered++;
  }
  assert.equal(missing, 0, key+' source art has no missing coat/eye/details pixels after recolor partition');
  assert.equal(overlap, 0, key+' source art is not double-painted by eye, body or pattern');
  assert(covered > 100, key+' contains genuinely colored/outlined authored pixels');

}

(async () => {
  const palette = api.paletteFor('kanthic', 'specimen-A');
  const warming = [api.prewarm(), api.prewarm()]; // Repeated entry requests must share one decoded sprite/rig pass.
  await Promise.all(warming);
  assert.equal(pixelYieldChecks,3,'the source mask preparation offers a browser turn between flying/perched/wings passes');
  const rig = await api.createRig({ skeeriPalette: palette });
  assert.deepEqual(rig.palette, { body: palette.body, eyes: palette.eyes, pattern: palette.pattern }, 'body, eye and fur pattern use independent colors');
  assert.equal(captured.settings.flying, 'creaturesprites/skeeri_planebent_flying.png');
  assert.equal(captured.settings.perched, 'creaturesprites/skeeri_planebent_perched.png');
  assert.equal(captured.settings.wings, authoredRig.wings, 'normal Skeeri wings and hinge settings remain intact');
  assert.deepEqual(loads, [
    api.SPRITES.flying, api.SPRITES.perched, api.SPRITES.wings,
  ]);
  assert(captured.images.glowFlying && captured.images.glowPerched, 'each pose has an independent glowing eye overlay');
  assert(captured.images.patternFlying && captured.images.patternPerched, 'each pose retains its authored dark fur pattern as a separate tint layer');
  assert(captured.images.detailFlying && captured.images.detailPerched, 'both poses retain untinted accent layers');
  assert.equal(captured.images.flying.pixels[3], 0, 'marker pixels are removed from the naturally tinted body');
  assert.equal(captured.images.perched.pixels[3], 0);
  assert.equal(captured.images.flying.pixels[7], 0, 'neutral accents are removed from the dyed body');
  assert.equal(captured.images.detailFlying.pixels[7], 255, 'neutral accents remain fully opaque on their own layer');
  assert.equal(captured.images.detailFlying.pixels[4], 180, 'accent red channel is unchanged');
  assert.equal(captured.images.detailFlying.pixels[5], 170, 'accent green channel is unchanged');
  assert.equal(captured.images.flying.pixels[8], captured.images.flying.pixels[9], 'fur color channels are neutral');
  assert.equal(captured.images.flying.pixels[9], captured.images.flying.pixels[10], 'source green no longer alters the selected dye');
  assert.equal(captured.images.wings.pixels[8], captured.images.wings.pixels[9], 'wings are neutral too');
  assert.equal(captured.images.wings.pixels[9], captured.images.wings.pixels[10], 'wings do not tint through green source art');
  assert.equal(captured.images.glowFlying.pixels[3], 255, 'marked eyes appear in the independent glow mask');
  assert.equal(captured.images.glowPerched.pixels[3], 255);
  assert.equal(captured.images.patternFlying.pixels[11], 255, 'darker green fur pixels are isolated for the pattern dye');
  assert.equal(captured.images.flying.pixels[11], 0, 'dyed markings do not also render the base fur underneath');
  assert.equal(captured.images.patternFlying.pixels[8], captured.images.patternFlying.pixels[9], 'pattern mask has neutral shading');
  assert(captured.images.patternFlying.pixels[8] < 255, 'dark fur patterns retain authored shadows');
  assert.equal(captured.images.patternPerched.pixels[11], 255);
  assert.equal(captured.images.patternFlying.pixels[3], 0, 'eye markers cannot be dyed as fur patterns');
  assert.equal(captured.images.patternFlying.pixels[15], 0, 'light body pixels cannot become an unintended fur pattern');
  assert.equal(api.separateEyeMarker({ width: 4, height: 1, pixels: spritePixels }).marked, 1);
  rig.palette = null;
  rig.restoreTint();
  assert.deepEqual(rig.palette, { body: palette.body, eyes: palette.eyes, pattern: palette.pattern }, 'hit-flash restoration keeps fur and strictly in-family eye colors separate');
  assert.equal(api.debugSnapshot().eyeMarkerPixels, 2);
  assert.equal(api.debugSnapshot().furPatternPixels, 2);
  assert.equal(api.debugSnapshot().prewarmRequests, 2);
  assert.equal(api.debugSnapshot().prewarmFailures, 0);
  assert.equal(api.debugSnapshot().prewarmReady, true);
  assert.equal(pixelYieldChecks,3,'repeated entry and bird creation do not recolor the shared full-size source art');
  const ruinEntry = fs.readFileSync(path.join(root, 'docs/js/dev-random-ruin-interior-map.js'),'utf8');
  assert.match(ruinEntry, /SkeeriRuins\?\.prewarm\?\.\(\)\?\.catch\?\.\(/, 'entry starts Skeeri caching without a new per-frame scan');
  const wildlifePanel = fs.readFileSync(path.join(root, 'docs/js/wildlife-debug-panel.js'), 'utf8');
  const censusBegin = wildlifePanel.indexOf('  function renderSkeeriFlightCensus() {');
  const censusEnd = wildlifePanel.indexOf('  function renderPingdortCensus()', censusBegin);
  assert(censusBegin > 0 && censusEnd > censusBegin, 'real mobile Skeeri census remains independently testable');
  const censusContext = { window: { SkeeriRuins: { debugSnapshot: () => ({ ...api.debugSnapshot(), active: true, actors: [] }) } },
    deps: { esc: value => String(value) } }; // Simulate a present ruin; the source-art counters still come from the real renderer.
  vm.runInNewContext(wildlifePanel.slice(censusBegin, censusEnd)
    + '\nthis.census = renderSkeeriFlightCensus;', censusContext);
  const census = censusContext.census();
  assert.match(census, /Appearance preload: ready/, 'mobile Wildlife tab shows completed Skeeri source-art preload');
  assert.match(census, /ruin entries requested: 2/, 'mobile tab makes reuse of source art inspectable');
  assert.match(census, /Separated original sprite pixels: eyes 2/, 'mobile tab reports eye extraction rather than hiding mask errors');
  console.log('Planebent Skeeri authored art, shared wings, theme palettes, marked eye overlays and tint restore PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
