#!/usr/bin/env node
'use strict';

// Regression: the Animation Author blob loader must resolve creature sprites and
// base-mask JSON from its selected GitHub commit, not relative to the editor page.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const AUTHOR_PATH = 'docs/tools/animation-author/index.html'; // The editor's actual runtime preprocessor under test.
const RENDER_PATH = 'docs/js/creature-genetics-render.js'; // The unchanged gameplay compositor loaded by the editor.
const PINNED_BASE = 'https://raw.githubusercontent.com/Oolnokk/HobunjiHollowUnity/1daf9cf45df7b545efe81e8427e95a2addaed922/'; // Reproduces the SHA in the reported diagnostics.
const html = fs.readFileSync(AUTHOR_PATH, 'utf8');
const renderer = fs.readFileSync(RENDER_PATH, 'utf8');
const start = html.indexOf('function prepareRepositoryScript(');
const end = html.indexOf('\nasync function executeClassicScript(', start);
assert(start > 0 && end > start, 'find the real Animation Author preprocessor');
const prepare = vm.runInNewContext('(' + html.slice(start, end).trim() + ')', {
  CREATURE_RENDER_SCRIPT: 'js/creature-genetics-render.js',
  rawUrl: path => PINNED_BASE + path, // Represents the editor's ref-aware rawUrl helper.
  location: { href: 'https://example.invalid/docs/tools/animation-author/index.html' },
  URL,
});
const settings = { docsRoot: 'docs/' }; // Matches the actual editor repository settings.
const prepared = prepare(renderer, 'js/creature-genetics-render.js', settings);
assert(prepared.includes('const MODULE_SCRIPT_URL = ' + JSON.stringify(PINNED_BASE + RENDER_PATH)),
  'the injected module source is the chosen commit, not a blob or an editor-relative URL');
assert(!prepared.includes("fetch('config/creature-base-masks.json')"),
  'the new renderer uses docsUrl; the old fetch-replacement rule is obsolete');
assert.equal(prepare('window.sample = true;', 'js/other-script.js', settings), 'window.sample = true;',
  'other runtime scripts remain unchanged');

const CORE_END = '// Species-authored animal head weights.';
function createRenderer(source, currentScriptUrl, failFirstMask = false) {
  const urls = { masks: [], images: [] }; // Records the requested URLs for assertions without network access.
  class FakeImage {
    set src(value) {
      urls.images.push(value);
      queueMicrotask(() => this.onload?.());
    }
  }
  const context = {
    window: { __farmLog() {} },
    document: { currentScript: { src: currentScriptUrl } },
    Image: FakeImage,
    URL,
    performance: { now: () => 0 },
    fetch: async url => {
      urls.masks.push(String(url));
      if (failFirstMask && urls.masks.length === 1) return { ok: false, status: 404 };
      return { ok: true, json: async () => ({ 'gar-wolf': {} }) };
    },
  };
  const stop = source.indexOf(CORE_END);
  assert(stop > 0, 'extract actual genotype compositor without unrelated head-rig setup');
  vm.runInNewContext(source.slice(0, stop), context, { filename: RENDER_PATH });
  return { api: context.window.CreatureGeneticsRender, urls };
}

(async () => {
  const blob = createRenderer(prepared, 'blob:https://example.invalid/temporary');
  await blob.api.prewarm(['gar-wolf', 'nelk']);
  assert.deepEqual(blob.urls.masks, [PINNED_BASE + 'docs/config/creature-base-masks.json'],
    'blob execution loads the mask from the pinned revision');
  assert(blob.urls.images.some(url => url === PINNED_BASE + 'docs/assets/creaturesprites/gar-wolf_idle.png'),
    'the ordinary species sprites use the same pinned revision');
  assert(blob.urls.images.some(url => url === PINNED_BASE + 'docs/assets/creaturesprites/nelk_idle.png'),
    'full-base recolor species also resolve correctly');
  assert(blob.urls.images.every(url => url.startsWith(PINNED_BASE + 'docs/assets/')),
    'no sprite paths resolve against the editor page');

  const gameRoot = 'https://game.example/docs/';
  const native = createRenderer(renderer, gameRoot + 'js/creature-genetics-render.js');
  await native.api.prewarm(['gar-wolf']);
  assert.deepEqual(native.urls.masks, [gameRoot + 'config/creature-base-masks.json'],
    'normal game script loading retains its original docs-root behavior');
  assert(native.urls.images.some(url => url === gameRoot + 'assets/creaturesprites/gar-wolf_idle.png'));

  const retry = createRenderer(prepared, 'blob:https://example.invalid/retry', true);
  await retry.api.prewarm(['gar-wolf']);
  await retry.api.prewarm(['gar-wolf']);
  assert.equal(retry.urls.masks.length, 2, 'a failed mask response is not cached forever');
  assert(retry.urls.masks.every(url => url === PINNED_BASE + 'docs/config/creature-base-masks.json'));

  console.log('Animation Author commit-pinned creature runtime URL tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
