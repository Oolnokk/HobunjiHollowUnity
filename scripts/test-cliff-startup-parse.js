#!/usr/bin/env node
'use strict';
// The browser parses each parser-ordered module in isolation; a duplicate
// const anywhere in ClimbSystem prevents it from being defined and breaks
// game.js initialization before the main loop can start.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.join(__dirname, '..'); // Resolved once so this test works from any current directory.
const source = name => fs.readFileSync(path.join(root, 'docs/js', name), 'utf8'); // Actual shipped modules are parsed, never copied snippets.
assert.doesNotThrow(() => new vm.Script(source('climb-system.js'), {filename:'climb-system.js'}),
  'ClimbSystem must parse without redeclared movement variables');

// Debug/lag sampling may execute before game.js injects its calendar.
const context = {
  console,
  window: {addEventListener() {}},
  document: {getElementById:()=>null,addEventListener(){},createElement:()=>({})},
  performance: {now:()=>0},
  navigator: {clipboard:{writeText:async()=>{}}},
};
vm.runInNewContext(source('music-system.js'), context, {filename:'music-system.js'});
assert.equal(typeof context.window.Music?.isNightTime, 'function', 'Music must install its public API');
assert.equal(context.window.Music.isNightTime(), undefined,
  'pre-game performance snapshots must not call getHour on null music dependencies');

const index = fs.readFileSync(path.join(root,'docs/index.html'),'utf8'); // Production load order, not a test-only arrangement.
for(const module of ['climb-system','music-system'])
  assert(index.includes(module+'.js?v='), module+' needs a versioned browser loader');
assert(index.indexOf('climb-system.js?v=') < index.indexOf('<script src="game.js?v='),
  'ClimbSystem must load before game.js uses getClimbTarget');
console.log('PASS startup: ClimbSystem parses, early Music diagnostics are safe, and module loaders are versioned');
