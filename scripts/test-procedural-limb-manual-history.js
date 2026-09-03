#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const manual = fs.readFileSync('docs/js/procedural-limb-manual-author.js', 'utf8');

assert.doesNotThrow(() => new Function(manual), 'manual IK source must parse');
assert.match(manual, /const HISTORY_LIMIT = 100;/, 'manual IK keeps bounded history');
assert.match(manual, /commitHistory\(\); \/\/ Exactly one history entry per completed gizmo drag\./, 'one completed gizmo drag creates one history step');
assert.match(manual, /state\.history\.splice\(state\.historyIndex \+ 1\)/, 'new edits after undo discard stale redo history');
assert.match(manual, /function undo\(\)/, 'manual IK exposes undo');
assert.match(manual, /function redo\(\)/, 'manual IK exposes redo');
assert.match(manual, /limbManualUndo/, 'manual IK creates a visible Undo button');
assert.match(manual, /limbManualRedo/, 'manual IK creates a visible Redo button');
assert.match(manual, /event\.ctrlKey \|\| event\.metaKey/, 'keyboard history supports Ctrl/Cmd modifiers');
assert.match(manual, /key === 'z' && !event\.shiftKey/, 'Ctrl/Cmd+Z undoes');
assert.match(manual, /\(key === 'z' && event\.shiftKey\) \|\| key === 'y'/, 'Ctrl/Cmd+Shift+Z and Ctrl+Y redo');
assert.match(manual, /isEditableTarget\(event\.target\)/, 'history shortcuts do not steal undo/redo while editing text or number controls');
assert.match(manual, /canUndo: state\.active && !state\.released/, 'undo is disabled after releasing the pose to physics');
assert.match(manual, /canRedo: state\.active && !state\.released/, 'redo is disabled after releasing the pose to physics');
assert.match(manual, /undo,\s*\n\s*redo,/, 'undo/redo are part of the reusable manual IK public API');

console.log('procedural manual IK undo/redo: PASS');
