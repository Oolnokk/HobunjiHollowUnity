'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
async function main() {
  let area = 'cliffs', active = 0, maximum = 0;
  const gates = [], calls = [];
  const source = fs.readFileSync('docs/js/combat/combat-bandit.js', 'utf8');
  const start = source.indexOf('  let characterBuildTail'), end = source.indexOf('  async function makeBanditEntity', start);
  const context = { deps: { getCurrentArea: () => area }, buildBanditAvatar: async roster => { calls.push(roster); active++; maximum = Math.max(maximum, active); await new Promise(resolve => gates.push(resolve)); active--; if (roster === 'fail') throw Error('failed portrait'); return roster; } };
  vm.runInNewContext(source.slice(start, end) + '\nthis.build = buildQueuedBanditAvatar;', context);
  const a = context.build('first', 'cliffs'), b = context.build('stale', 'cliffs');
  await Promise.resolve();
  assert.deepEqual(calls, ['first']);
  area = 'town'; gates.shift()();
  assert.equal(await a, 'first'); assert.equal(await b, null);
  assert.deepEqual(calls, ['first'], 'queued characters from the departed zone allocate no portrait');
  const failure = context.build('fail', 'town'), next = context.build('next', 'town');
  const rejected = assert.rejects(failure, /failed portrait/);
  await Promise.resolve(); gates.shift()(); await rejected;
  await Promise.resolve(); gates.shift()(); assert.equal(await next, 'next');
  assert.equal(maximum, 1, 'failed builds release the serial portrait allocation slot');

  const recolor = fs.readFileSync('docs/js/creature-genetics-render.js', 'utf8');
  const cacheContext = {};
  vm.runInNewContext(recolor.slice(recolor.indexOf('  const _recolorCache'), recolor.indexOf('  async function recoloredBase')) + '\nthis.put = rememberRecolor; this.cache = _recolorCache; this.bytes = () => recolorBytes;', cacheContext);
  const canvas = { width: 1375, height: 600 };
  for (let i = 0; i < 96; i++) cacheContext.put(String(i), Promise.resolve(canvas));
  await new Promise(setImmediate);
  assert.ok(cacheContext.bytes() <= 24 * 1024 * 1024);
  assert.ok(cacheContext.cache.size < 10, 'native canvases are bounded by bytes rather than the old 96-entry ceiling');
  assert.equal(canvas.width, 1375, 'live source canvases retain their full resolution after cache eviction');
  console.log('Character build cancellation, serial allocation, failure recovery, and native recolor byte budget passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
