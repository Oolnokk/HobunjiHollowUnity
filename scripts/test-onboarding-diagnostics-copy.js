'use strict';
const assert = require('node:assert/strict'); // Exercises clipboard success and browser fallback paths.
const fs = require('node:fs'); // Reads the actual creator function.
const vm = require('node:vm'); // Provides browser-shaped clipboard dependencies.
const source = fs.readFileSync('docs/js/onboarding-character-creation-redesign.js', 'utf8'); // Owner under test.
const selected = []; // Tracks fallback focus, selection, and copied range.
const field = { focus() { selected.push('focus'); }, select() { selected.push('select'); }, setSelectionRange(start, end) { selected.push([start, end]); } }; // Visible readonly text field.
const feedback = {}; // User-visible copy result.
let copied; // Clipboard payload captured without a real browser.
const context = { navigator: { clipboard: { async writeText(text) { copied = text; } } }, document: { execCommand: () => true } }; // Clipboard API and legacy fallback fixtures.
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('  async function copyFacingDiagnostics('), source.indexOf('  function installFacingDiagnostics(')), context);
(async () => {
  await context.copyFacingDiagnostics('diagnostics', field, feedback);
  assert.equal(copied, 'diagnostics');
  assert.equal(feedback.textContent, 'Copied diagnostics');
  assert.equal(selected.length, 0);
  context.navigator.clipboard.writeText = async () => { throw new Error('denied'); };
  await context.copyFacingDiagnostics('fallback', field, feedback);
  assert.deepEqual(selected, ['focus', 'select', [0, 8]]);
  assert.equal(feedback.textContent, 'Copied diagnostics');
  context.navigator.clipboard = undefined;
  context.document.execCommand = () => false;
  await context.copyFacingDiagnostics('fallback', field, feedback);
  assert.equal(feedback.textContent, 'Copy unavailable; diagnostics selected below');
  console.log('Creator diagnostics copy and selected-text fallback passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
