#!/usr/bin/env node
'use strict';
// V50 clears its cube registry when generating each story. The shipped bridge
// must restore all detached story roots, including floor zero, and dispose them.
const assert=require('node:assert/strict');
const fs=require('node:fs'); // Load the shipped bridge, not a duplicate registration implementation.
const vm=require('node:vm');
const source=fs.readFileSync('docs/tools/debris-ifier/debrisifier-v50-api.js','utf8');
const begin=source.indexOf('  function registerDetachedCubeRoots('),end=source.indexOf('  function tickRuntime(',begin);
assert(begin>=0&&end>begin,'bridge must expose its original V50 solver registration');
const linkedCubePuzzleRoots=new Set(),context={linkedCubePuzzleRoots};
vm.createContext(context);
vm.runInContext(source.slice(begin,end)+'\nthis.rebind=registerDetachedCubeRoots;',context);
const cube=name=>({name,userData:{activatorType:'linkedCubePillars',previewMotion:{type:'linkedCubePair'},interactive3D:true},parent:{},children:[]});
const first=cube('floor-zero'),middle=cube('floor-one'),last=cube('floor-two');
const wrong={userData:{activatorType:'glyphObelisk',previewMotion:{type:'rotatingObelisk'},interactive3D:true}};
const root=children=>({traverse(visit){visit(this);for(const child of children)visit(child);}});
linkedCubePuzzleRoots.add(first);linkedCubePuzzleRoots.clear(); // Original generator's next-floor reset.
linkedCubePuzzleRoots.add(middle);linkedCubePuzzleRoots.clear();
linkedCubePuzzleRoots.add(last);
const releaseFirst=context.rebind(root([first,wrong])),releaseMiddle=context.rebind(root([middle])),releaseLast=context.rebind(root([last]));
assert.equal(linkedCubePuzzleRoots.size,3,'all story cubes must animate in V50 original runtime');
assert(!linkedCubePuzzleRoots.has(wrong),'do not register unrelated activators');
releaseMiddle();assert.equal(linkedCubePuzzleRoots.size,2);
assert(linkedCubePuzzleRoots.has(first)&&linkedCubePuzzleRoots.has(last));
releaseFirst();releaseLast();releaseLast();assert.equal(linkedCubePuzzleRoots.size,0);
assert.throws(()=>context.rebind({}),/traversable/);
console.log('ok V50 solver registry: original cube actors restored on all three floors and released after teardown');
