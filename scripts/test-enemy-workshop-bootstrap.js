'use strict';
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  vm = require('node:vm');
const tick = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
(async () => {
  let queue = [];
  const hinted = []; // Actual optional nested preload hooks must not remove the readiness barrier.
  const window = { __enemyWorkshopPreloadScripts: urls => hinted.push([...urls]) };
  const document = {
    readyState: 'complete',
    currentScript: {
      src: 'https://game.test/docs/js/attachment-rig-latest-authored-snapshot.js',
    },
    createElement: () => ({}),
    head: { appendChild: (s) => queue.push(s) },
  };
  const location = {
    href: 'https://game.test/docs/tools/enemy-loadout-editor/index.html',
    pathname: '/docs/tools/enemy-loadout-editor/index.html',
  };
  vm.runInNewContext(
    fs.readFileSync(
      'docs/js/attachment-rig-latest-authored-snapshot.js',
      'utf8',
    ),
    { window, document, location, URL, console },
  );
  let done = false;
  window.HobunjiLatestAuthoredRigReady.then(() => {
    done = true;
  });
  await tick();
  assert(queue.length === 1);
  assert(hinted[0].length > 15, 'nested rig downloads are hinted together');
  queue.shift().onload();
  await tick();
  assert.equal(
    done,
    false,
    'nested rig bootstrap must not finish after its first child',
  );
  let count = 1;
  while (queue.length) {
    queue.shift().onload();
    count++;
    await tick();
  }
  await window.HobunjiLatestAuthoredRigReady;
  assert(count > 15);
  assert(done);
  queue = [];
  let resolveNested;
  const nested = new Promise((resolve) => {
    resolveNested = resolve;
  });
  window.HobunjiLatestAuthoredRigReady = nested;
  document.currentScript.src =
    'https://game.test/docs/js/held-action-animations.js';
  vm.runInNewContext(
    fs.readFileSync('docs/js/held-action-animations.js', 'utf8'),
    { window, document, location, URL, console, Promise },
  );
  await tick();
  let hit = false;
  while (queue.length) {
    const script = queue.shift();
    if (script.src.includes('/attachment-rig-latest-authored-snapshot.js')) {
      script.onload();
      hit = true;
      break;
    }
    script.onload();
    await tick();
  }
  assert(hit, 'the hand bootstrap loads the real nested rig owner');
  assert(hinted.some(urls => urls.some(url => url.includes('procedural-hand-frame-driver.js'))), 'hand scripts are preloaded without bypassing nested readiness');
  await tick();
  assert.equal(
    queue.length,
    0,
    'the hand frame driver must wait while species and mount wrappers are still loading',
  );
  resolveNested();
  await tick();
  assert(
    queue.length === 1,
    'hand dependencies resume once nested rig readiness resolves',
  );
  while (queue.length) {
    queue.shift().onload();
    await tick();
  }
  await window.HobunjiHandRuntimeReady;
  const previewSource = fs.readFileSync('docs/tools/enemy-loadout-editor/preview.js','utf8');
  const helper = previewSource.slice(previewSource.indexOf('function createScriptPreloader'),previewSource.indexOf('const copy ='));
  const links=[];const doc={baseURI:'https://game.test/docs/',createElement:()=>({}),head:{append:node=>links.push(node)}};
  const preload = new Function('URL',helper+';return createScriptPreloader;')(URL)(doc);
  preload(['js/a.js?v=1','js/b.js']);preload(['https://game.test/docs/js/a.js?v=1']);
  assert.equal(links.length,2);assert(links.every(node=>node.rel==='preload'&&node.as==='script'));
  const loaded = new Function('URL',helper+';return loadRuntimeScript;')(URL)('js/a.js?v=1',doc);
  assert.equal(links.length,3);links[2].onload();await loaded;
  // Catalog network requests start immediately, deduplicate and fan out without waiting for the large game source.
  const dataWindow={},requests=[];let finishGame;
  const response = value => ({ok:true,json:async()=>value,text:async()=>String(value)});
  const fetchData = url => {
    const key=String(url);requests.push(key);
    if(key==='game.js')return new Promise(resolve=>{finishGame=resolve;});
    if(key==='config/species/index.json')return Promise.resolve(response({entries:[{path:'a.json'},{path:'b.json'}]}));
    if(key.endsWith('/a.json'))return Promise.resolve(response({speciesId:'a'}));
    if(key.endsWith('/b.json'))return Promise.resolve(response({speciesId:'b'}));
    return Promise.resolve(response({}));
  };
  vm.runInNewContext(fs.readFileSync('docs/tools/enemy-loadout-editor/source-data.js','utf8'),{window:dataWindow,document:doc,fetch:fetchData,URL});
  const dataApi=dataWindow.EnemyLoadoutSourceData,first=dataApi.prefetch();
  assert.equal(first,dataApi.prefetch(),'same in-flight catalog reads');
  let complete=false;first.then(()=>{complete=true;});
  await tick();
  assert(requests.includes('https://game.test/docs/config/species/a.json'));
  assert(requests.includes('https://game.test/docs/config/species/b.json'));
  assert(requests.includes('config/outline-rendering.json'));
  assert.equal(complete,false,'species and outline requests do not wait for game.js');
  finishGame(response('game source'));
  const result=await first;
  assert.equal(result[5].a.speciesId,'a');assert.equal(result[5].b.speciesId,'b');
  assert.equal(first,dataApi.prefetch(),'completed catalog stays reusable');
  assert.equal(new Set(requests).size,requests.length,'no duplicate catalog requests');
  console.log(
    'Enemy workshop: one nested rig bootstrap finishes before the shared hand driver; no double compound-avatar installation',
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
