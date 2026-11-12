'use strict';
// A failed pattern fetch (index or one definition) must not be cached for the whole session: pets, garments and
// pants that need the pattern would stay unpatterned until reload. Runs the real module with a scripted fetch.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/repo-pattern-library.js', 'utf8');
const definition = id => ({ id, name: id, kind: 'pattern', settings: {} });
const index = { patterns: [{ id: 'a', name: 'A', file: 'config/patterns/a.json' }, { id: 'b', name: 'B', file: 'config/patterns/b.json' }] };

function makeEnvironment(script) {
  const calls = [];
  const window = { console: { ...console, warn() {} } };
  window.window = window;
  const context = {
    window, console: window.console, URL, Date, JSON, Promise, Map, Set, Object, Array, Number, String, Math,
    document: { currentScript: { src: 'https://example.test/js/repo-pattern-library.js' } },
    fetch: async (url, options) => {
      calls.push({ url: String(url), cache: options?.cache });
      const step = script(String(url), calls.length);
      if (step === 'fail') throw new Error('network down');
      return { ok: true, json: async () => step };
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'repo-pattern-library.js' });
  return { library: window.RepoPatternLibrary, calls };
}

(async () => {
  // 1. A failing definition fetch leaves a partial library, which the next caller (after the back-off) completes.
  let bFails = true;
  const first = makeEnvironment(url => url.endsWith('index.json') ? index : url.endsWith('a.json') ? definition('a') : (bFails ? 'fail' : definition('b')));
  const partial = await first.library.load();
  assert.deepEqual(partial.map(p => p.id), ['a'], 'the definition that loaded is usable while another failed');
  const immediate = await first.library.load();
  assert.deepEqual(immediate.map(p => p.id), ['a'], 'a retry straight after a failure is not refetched (back-off)');
  const callsAfterBackoff = first.calls.length;
  assert.equal(callsAfterBackoff, 3, 'index + two definitions were fetched once, and the back-off call fetched nothing');

  // 2. A failed index fetch is not cached as an empty library.
  let indexFails = true;
  const second = makeEnvironment(url => url.endsWith('index.json') ? (indexFails ? 'fail' : index) : definition(url.includes('a.json') ? 'a' : 'b'));
  assert.deepEqual(await second.library.load(), [], 'a failed index yields an empty list for now');
  indexFails = false;
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 60000; // Past the retry back-off.
    const recovered = await second.library.load();
    assert.deepEqual(recovered.map(p => p.id).sort(), ['a', 'b'], 'the library recovers on a later call instead of staying empty');
    const callCount = second.calls.length;
    await second.library.load();
    assert.equal(second.calls.length, callCount, 'a complete library is cached and not refetched');
  } finally { Date.now = realNow; }

  // 3. Fetches revalidate instead of bypassing the HTTP cache entirely.
  assert.ok(second.calls.every(call => call.cache === 'no-cache'), 'pattern fetches use no-cache (revalidate), not no-store');
  console.log('repo pattern library retry tests passed');
})().catch(error => { console.error(error); process.exit(1); });
