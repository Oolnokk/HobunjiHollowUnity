'use strict';
// Regression: the Random Ruin badge must never multiply its text as separate
// frame clients run at different cadences or update orders.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const root = fs.readFileSync('docs/js/dev-random-ruin-interior-map.js','utf8');
const sources = [
  'docs/js/dev-random-ruin-simple-puzzles.js',
  'docs/js/dev-random-ruin-lich-themes.js',
  'docs/js/dev-random-ruin-motion-runtime.js',
  'docs/js/dev-random-ruin-prototype-hooks.js',
  'docs/js/dev-random-ruin-runtime-coverage.js'
];
const first=root.indexOf('  const BADGE_PART_ORDER=');
const last=root.indexOf('  function updateBadge(){',first);
assert.ok(first>=0 && last>first,'The actual shared badge setter must be identifiable for execution');
const source=root.slice(first,last);
const badge={textContent:'',_ruinDebugBadgeParts:null};
const document={getElementById:id=>id==='devRandomRuinBadge'?badge:null};
const api=new Function('document','devModeEnabled','let ruin={seed:7};\n'+source+'\nreturn {setDebugBadgePart};')(document,()=>true);
const expected={
  base:'map_i_dev_random_ruin · seed 7 · solvable ✓',
  hooks:' · hooks 3/1/0',
  motion:' · motion 2/5 · ladders 7',
  simple:' · simple G1 R2 T1 CP 3/4',
  lich:' · lich H P1/3 I0 C0/0 K0 sink0% hronal:pulse-1',
  coverage:' · unhandled 0 · cross-layer 2'
};
for(const [key,value] of Object.entries(expected)) assert.equal(api.setDebugBadgePart(key,value),true);
const order=['base','hooks','motion','simple','lich','coverage'];
const original=order.map(k=>expected[k]).join('');
assert.equal(badge.textContent,original,'All segments must render in one stable order');
for(let frame=0;frame<4000;frame++){
  const key=order[(frame*13+Math.floor(frame/6))%order.length];
  api.setDebugBadgePart(key,expected[key]);
  if(frame%7===0)api.setDebugBadgePart('lich',expected.lich.replace('pulse-1','pulse-'+(frame%3+1)));
  if(frame%7===1)api.setDebugBadgePart('lich',expected.lich);
  if(frame%11===0)api.setDebugBadgePart('coverage',' · unhandled '+(frame%5)+' · cross-layer 2');
  if(frame%11===1)api.setDebugBadgePart('coverage',expected.coverage);
  assert.ok(badge.textContent.length<=original.length+3,'Repeated writes may not multiply text at frame '+frame);
  for(const token of ['simple','lich','hooks','motion','cross-layer']) {
    assert.ok(badge.textContent.split(' · '+token+' ').length<=2,token+' repeated at frame '+frame);
  }
}
assert.equal(api.setDebugBadgePart('not-a-part',' injected'),false,'Only named segments may write');
assert.equal(api.setDebugBadgePart('coverage',expected.coverage),true);
assert.equal(api.setDebugBadgePart('lich',expected.lich),true);
assert.equal(badge.textContent,original,'Repeated writes must return to identical fixed-length text');
for(const path of sources){
  const source=fs.readFileSync(path,'utf8');
  assert.match(source,/setDebugBadgePart\?\.\(/,'Subsystem must send a named segment: '+path);
  assert.doesNotMatch(source,/badge\.textContent\s*=/,'Subsystem must not rewrite other diagnostics: '+path);
  assert.doesNotMatch(source,/dataset\.(?:motionBase|prototypeHookBase)/,'Subsystem must not cache entire badge: '+path);
}
assert.match(root,/badge\._ruinDebugBadgeParts=null/,'Segments must reset on ruin clear');
assert.match(root,/max-width:calc\(100vw - 20px\);max-height:3\.8em/,'Collapsed badge must fit the viewport');
assert.match(root,/min\(35vh, 250px\)/,'Expanded diagnostic panel must be height-capped');
assert.match(root,/overflowY=expanded\?'auto':'hidden'/,'Expanded diagnostic panel must be scrollable');
console.log('Ruin badge regression passed: six segment writers, 4000 interleaved updates, size caps, cleanup.');
