'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const payloadDirectory = path.resolve(__dirname, '../.github/npc-station-payload');

function decodeParts(prefix) {
  const encoded = fs.readdirSync(payloadDirectory)
    .filter(name => name.startsWith(prefix))
    .sort()
    .map(name => fs.readFileSync(path.join(payloadDirectory, name), 'utf8'))
    .join('')
    .replace(/\s+/g, '');
  return Buffer.from(encoded, 'base64').toString('utf8');
}

function removeRuntimeTransportDuplicate(source) {
  const marker = 'function updateMovementHeading';
  const first = source.indexOf(marker);
  const second = first < 0 ? -1 : source.indexOf(marker, first + marker.length);
  if (second < 0) return source;
  const nextFunction = source.indexOf('function updateDebugRow', second);
  assert.ok(nextFunction >= 0, 'duplicated transport declarations must have a recognizable end');
  return source.slice(0, second) + source.slice(nextFunction);
}

const editorSource = decodeParts('editor-clean.');
const runtimeSource = removeRuntimeTransportDuplicate(decodeParts('runtime-clean.'));

new vm.Script(editorSource, { filename: 'npc-station-editor.decoded.js' });
new vm.Script(runtimeSource, { filename: 'npc-station-runtime.decoded.js' });

assert.match(editorSource, /data-area-paint/);
assert.match(editorSource, /playerMinHeartsToIgnore/);
assert.match(runtimeSource, /fallback-player-3-hearts/);
assert.match(runtimeSource, /mostRecent/);
assert.match(runtimeSource, /renderWalkerExpression/);

console.log('NPC station editor/runtime payload smoke test passed.');
