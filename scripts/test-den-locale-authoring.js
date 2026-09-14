#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const editor = fs.readFileSync(path.join(root, 'docs/tools/locale-editor/den-encounter-authoring.js'), 'utf8');
const inlineEditor = fs.readFileSync(path.join(root, 'docs/tools/locale-editor/index.html'), 'utf8');

// The inline Locale Editor owns a private ws/buildExport closure. Prove the
// den sidecar explicitly covers every user-facing path that otherwise bypasses
// its getWorkspace() composition layer.
assert.match(inlineEditor, /ws\.locales\.map\(buildExport\)/,
  'baseline Locale Editor local override path still exports its private workspace directly');
assert.match(inlineEditor, /JSON\.stringify\(buildExport\(m\), null, 2\)/,
  'baseline copy/download paths still call the private buildExport directly');

assert.match(editor, /function exportLocale\(locale\)[\s\S]*?denEncounter/,
  'sidecar owns an export document composer that includes authored den metadata');
assert.match(editor, /copyJsonBtn[\s\S]*?addEventListener\('click',[\s\S]*?stopNativeExport\(event\)[\s\S]*?mergedActiveJson\(\)/,
  'Copy JSON is intercepted before the private buildExport listener and uses merged encounter data');
assert.match(editor, /downloadJsonBtn[\s\S]*?addEventListener\('click',[\s\S]*?stopNativeExport\(event\)[\s\S]*?new Blob\(\[text\]/,
  'Download JSON is intercepted and serializes merged encounter data');
assert.match(editor, /saveLocalesOverrideBtn[\s\S]*?addEventListener\('click',[\s\S]*?stopNativeExport\(event\)[\s\S]*?workspace\?\.locales[\s\S]*?\.map\(exportLocale\)[\s\S]*?setOverride\('locales'/,
  'Save ALL as Local Override is intercepted and exports every locale through the den-aware composer');
assert.match(editor, /function stopNativeExport\(event\)[\s\S]*?stopImmediatePropagation\(\)/,
  'capture hook prevents the old bubble listener from writing a second stale export');

// Regression for the subtle locale-switch data-loss bug: once the sidecar has
// edited a locale, stale ws.meta from the inline editor must not replace it.
assert.match(editor, /function reconcileFromRawLocale\(locale\)[\s\S]*?if \(store\.byLocale\[locale\.id\]\) return store\.byLocale\[locale\.id\];/,
  'existing authored sidecar data remains authoritative when switching away and back');
assert.match(editor, /Storage\.prototype\.setItem = function denEncounterStorageSetItem[\s\S]*?mergeWorkspace\(JSON\.parse\(value\)\)/,
  'ordinary inline-editor workspace saves persist the composed encounter metadata');
assert.match(editor, /function syncJsonPreview\(\)[\s\S]*?mergedActiveJson\(\)/,
  'visible JSON preview is recomposed after inline-editor redraws');
assert.match(editor, /version: 2/,
  'reviewed editor sidecar version is exposed for diagnostics');

console.log('Den locale editor switching, copy, download, workspace persistence, and local-override export checks passed.');
