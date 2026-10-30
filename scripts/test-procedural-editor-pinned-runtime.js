'use strict';
// Regression: a commit-pinned walk editor must load runtime from its own revision,
// and movement gaze must have one final neck pose owner.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const editor = fs.readFileSync(path.join(__dirname, '../docs/tools/procedural-animation-editor/index.html'), 'utf8');
const start = editor.indexOf('function pinnedPreviewSource()');
const end = editor.indexOf('function validateSettings(', start);
assert(start >= 0 && end > start, 'source resolver exists');
const settingsCode = editor.slice(start, end);
const SHA = 'd03ddaad8f62f9cadf56a0bccf6325ec5e54061e';
const pinPath = '/Oolnokk/HobunjiHollowUnity/' + SHA + '/docs/tools/procedural-animation-editor/index.html';
const fields = {
  ownerInput: 'Oolnokk', repoInput: 'HobunjiHollowUnity', refInput: 'main',
  docsInput: 'docs/', dbPathInput: 'docs/config/npcs/hobunji-starter-npc-database.json',
};
const savedMain = {
  owner: 'Oolnokk', repo: 'HobunjiHollowUnity', ref: 'main',
  docsRoot: 'docs/', dbPath: fields.dbPathInput,
};
function harness(hostname, pathname, initialStorage) {
  let persisted = initialStorage === undefined ? null : JSON.stringify(initialStorage);
  const inputs = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, { value }]));
  const ctx = {
    location: { hostname, pathname, search: '?utm_source=chatgpt.com' },
    localStorage: {
      getItem: () => persisted,
      setItem: (_key, value) => { persisted = value; },
    },
    STORAGE_KEY: 'procedural-animation-test',
    $: id => inputs[id],
    ensureSlash: value => value.endsWith('/') ? value : value + '/',
    normalizePath: value => value,
  };
  const api = vm.runInNewContext(settingsCode + '\n({ pinnedPreviewSource, readSettings, writeSettings })', ctx);
  return { ...api, storage: () => JSON.parse(persisted || 'null') };
}

const pinned = harness('raw.githack.com', pinPath, savedMain);
assert.equal(pinned.pinnedPreviewSource().ref, SHA);
assert.equal(pinned.readSettings().ref, SHA, 'cached main must not fetch incompatible game scripts');
pinned.writeSettings(pinned.readSettings());
assert.equal(pinned.readSettings().ref, SHA, 'startup persistence keeps the preview source');
assert.equal(pinned.storage().explicitPreviewSource, null);

pinned.writeSettings({ ...pinned.readSettings(), ref: 'main' });
assert.equal(pinned.readSettings().ref, 'main', 'manually selected source remains supported');
assert.equal(pinned.storage().explicitPreviewSource, 'Oolnokk/HobunjiHollowUnity@' + SHA);
const reloaded = harness('raw.githack.com', pinPath, pinned.storage());
assert.equal(reloaded.readSettings().ref, 'main', 'explicit source survives runtime reload');
reloaded.writeSettings({ ...reloaded.readSettings(), ref: SHA });
assert.equal(reloaded.readSettings().ref, SHA, 'switching back to pin succeeds');
assert.equal(reloaded.storage().explicitPreviewSource, null, 'reverting clears manual override');

const otherHost = harness('example.github.io', '/other/editor/index.html', savedMain);
assert.equal(otherHost.readSettings().ref, 'main', 'non-pinned URLs keep saved source');
const otherRepo = harness('raw.githack.com', pinPath, { ...savedMain, repo: 'AnotherRepository' });
assert.equal(otherRepo.readSettings().ref, 'main', 'preview source is repo-specific');

assert(editor.includes('js/npc-movement-head-target.js'), 'shared game helper remains loaded');
assert.equal(editor.split('updatePreviewNpcMovementGaze(movingSpeed);').length - 1, 1,
  'only one final head-gaze solve runs per animation frame');
assert(!editor.includes('function updateMovementHeadPose('), 'duplicate head solver is removed');
assert(editor.includes('neck.parent.getWorldQuaternion(work.parentWorld)'), 'gaze compensates final torso pose');
assert(editor.includes('clearPreviewNpcMovementGaze(); // Gameplay ragdoll'), 'ragdoll takes priority over movement');
assert(editor.includes('clearPreviewNpcMovementGaze(); // Authored transform'), 'pose authoring takes priority over movement');

console.log('Procedural editor source: pin follows preview URL, manual overrides persist, one NPC gaze owner');
