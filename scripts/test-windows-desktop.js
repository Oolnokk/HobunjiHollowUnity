'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { GAME_URL, isGameUrl, getGameAsset, localizeGameHtml } = require('../desktop/game-protocol.cjs');

const repo = path.resolve(__dirname, '..'); // Root of the game and desktop packages.
const roots = { gameRoot: path.join(repo, 'docs'), vendorRoot: path.join(repo, 'desktop', 'vendor') }; // File-routing fixtures for the pure protocol helper.
const mapped = url => getGameAsset(url, roots);

assert.equal(GAME_URL, 'hobunji://game/index.html');
assert.equal(isGameUrl(GAME_URL), true);
assert.equal(isGameUrl('https://example.com/index.html'), false);
assert.equal(isGameUrl('hobunji://wrong/index.html'), false);
assert.equal(mapped(GAME_URL).file, path.join(repo, 'docs', 'index.html'));
assert.equal(mapped('hobunji://game/').file, path.join(repo, 'docs', 'index.html'));
assert.equal(mapped('hobunji://game/js/GLTFLoader.js?cache=sample-token').file, path.join(repo, 'docs', 'js', 'GLTFLoader.js'));
assert.equal(mapped('hobunji://game/__desktop_vendor__/three.min.js').kind, 'vendor');
assert.equal(mapped('hobunji://game/__desktop_vendor__/TransformControls.js').kind, 'vendor');

for (const value of [
  'hobunji://wrong/index.html',
  'hobunji://game/__desktop_vendor__/missing.js',
  'hobunji://game/../../secrets.txt',
  'hobunji://game/%2e%2e/%2e%2e/secrets.txt',
  'hobunji://game/assets/%5cWindows',
  'hobunji://game/%00bad',
  'https://example.com/secret',
]) assert.equal(mapped(value), null, 'Blocked unexpected path: ' + value);

const index = fs.readFileSync(path.join(roots.gameRoot, 'index.html'), 'utf8');
const localized = localizeGameHtml(index);
assert.ok(localized.includes('src="/__desktop_vendor__/three.min.js"'));
assert.ok(localized.includes('src="/__desktop_vendor__/TransformControls.js"'));
assert.ok(!localized.includes('https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'));
assert.ok(!localized.includes('https://unpkg.com/three@0.128.0/examples/js/controls/TransformControls.js'));
assert.ok(localized.includes('js/local-save-folder.js'), 'Retains existing save code');
assert.ok(localized.includes('game.js'), 'Retains original game entry point');

const manifest = JSON.parse(fs.readFileSync(path.join(repo, 'desktop', 'package.json'), 'utf8'));
assert.equal(manifest.dependencies.three, '0.128.0');
assert.equal(manifest.build.win.target, 'nsis');
assert.ok(manifest.build.extraResources.some(x => x.from === '../docs' && x.to === 'game'));
assert.ok(manifest.build.extraResources.some(x => x.to === 'vendor/three.min.js'));
assert.ok(manifest.build.extraResources.some(x => x.to === 'vendor/TransformControls.js'));
const main = fs.readFileSync(path.join(repo, 'desktop', 'main.cjs'), 'utf8');
assert.ok(main.includes('nodeIntegration: false'));
assert.ok(main.includes('contextIsolation: true'));
assert.ok(main.includes('sandbox: true'));
assert.ok(main.includes('CLOSE_SAVE_SCRIPT'));
assert.ok(main.includes('autoSyncArmed'));
console.log('Windows desktop protocol, path safety, bundled scripts, persistence and installer configuration OK');
