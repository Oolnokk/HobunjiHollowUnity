'use strict';
const assert=require('node:assert/strict'); // Checks installed sprite assets and behindImage references.
const fs=require('node:fs'); // Reads the actual committed PNGs and cosmetic JSONs.
const path=require('node:path'); // Resolves asset URLs under docs/ consistently.
const configs=[
  'config/cosmetics/basic_headband.json',
  'config/cosmetics/leather_headband.json',
  'config/cosmetics/five_blossom_crown.json',
  'config/cosmetics/clothes/hat/tangedcirclet.json'
];
const seen=new Set(); // Unique rear sprite names tested across shared species variants.
function fronts(config){
  return [config.parts.head.layers.front,
    ...Object.values(config.speciesVariants||{}).map(v=>v.parts?.head?.layers?.front).filter(Boolean)];
}
function readPng(relative){
  const bytes=fs.readFileSync(path.join('docs',relative.replace(/^\.\//,'')));
  assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a',relative+' PNG signature');
  assert.equal(bytes.readUInt32BE(16),234,relative+' native width');
  assert.equal(bytes.readUInt32BE(20),173,relative+' native height');
  assert(bytes.length>300,'Unexpectedly empty rear sprite: '+relative);
}
for(const configPath of configs){
  const config=JSON.parse(fs.readFileSync(path.join('docs',configPath),'utf8'));
  const metal=configPath.includes('tangedcirclet');
  if(metal){
    assert.equal(config.material,'metal','Circlet retains metal material');
    assert.equal(config.palette.layers.base,'A','Circlet retains live alloy color/tint');
  }
  for(const layer of fronts(config)){
    const front=layer.image?.url;
    const behind=layer.behindImage?.url;
    assert(front&&behind,'Each variant requires both front and behind art: '+configPath);
    assert(behind.includes('/clothes/hat/'),'Unexpected rear path: '+behind);
    assert(behind.endsWith(metal?'_behind_metal.png':'_behind.png'),'Wrong rear sprite class: '+behind);
    assert(!front.includes('_behind'),'Existing front PNG should not be replaced: '+front);
    readPng(behind);
    seen.add(path.basename(behind));
  }
}
assert.equal(seen.size,17,'All twelve front shape variants (incl. fitted tletingan-female and porakaneki headbands) and five metal circlet backs are present');
const source=fs.readFileSync('docs/config/scratchbones-config.js','utf8');
const circum=source.match(/"layerReplacements"\s*:\s*\[([\s\S]*?)\]\s*,\s*"body/g)?.[0]||source;
for(const filename of ['tangedcirclet_m.png','tl_tangedcirclet_m.png','kenk_tangedcirclet_m.png',
                       'kenk_tangedcirclet_f.png','mashtz_tangedcirclet_m.png']){
  const re=new RegExp('cosmetics/clothes/hat/'+filename.replace(/\./g,'\\.')+'"[\\s\\S]{0,180}?"url"\\s*:\\s*"[^"]+_behind_metal\\.png"');
  assert(re.test(circum),'Circlet rear fallback must use metal behind band for '+filename);
}
console.log('Headwear rear asset regression passed: 17 PNGs, all species variants and metallic circlet fallbacks.');
