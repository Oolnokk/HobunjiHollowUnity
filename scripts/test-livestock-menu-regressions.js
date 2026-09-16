'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/livestock-nursery.js', 'utf8'); // Supplies the exact production helper and UI contracts under test.

function extractNamedFunction(name) {
  const signature = `function ${name}(`; // Used to locate the requested production function without copying its implementation into the test.
  const start = source.indexOf(signature); // Used as the beginning of the extracted production function.
  assert.notEqual(start, -1, `${name} exists in livestock-nursery.js`);
  const openBrace = source.indexOf('{', start); // Used to start balanced-brace scanning at the function body.
  assert.notEqual(openBrace, -1, `${name} has a function body`);
  let depth = 0; // Tracks nested blocks until the production function's closing brace is reached.
  for (let index = openBrace; index < source.length; index++) {
    const char = source[index]; // Used to advance the balanced-brace scan one source character at a time.
    if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Could not extract ${name}`);
}

const rowIdentityFunctionSource = extractNamedFunction('worldLivestockRowsById'); // Runs the real row-tagging helper rather than a test-only duplicate.
const decorateFunctionSource = extractNamedFunction('decorateLivestockList'); // Lets the test pin the caller to ID lookup instead of positional lookup.
const helperContext = { Map, String }; // Provides only the built-ins required by the extracted production helper.
vm.createContext(helperContext);
vm.runInContext(`${rowIdentityFunctionSource}\nthis.worldLivestockRowsById = worldLivestockRowsById;`, helperContext, { filename: 'livestock-nursery-row-helper.js' });

function makeRow(label) {
  return { label, dataset: {} }; // Minimal DOM-row stand-in used to verify persistent identity tags.
}

const records = [
  { id: 'adult_a', lifeStage: 'adult' },
  { id: 'baby_b', lifeStage: 'baby' },
  { id: 'adult_c', lifeStage: 'adult' },
]; // Mirrors the saved world-livestock order passed to FarmPanel.
const adultARow = makeRow('adult A'); // Represents the first world-livestock row rendered by FarmPanel.
const babyBRow = makeRow('baby B'); // Represents the Nursery baby row removed after the first decoration.
const adultCRow = makeRow('adult C'); // Represents a later adult that the old index-based pass could mistakenly remove.
const stableOneRow = makeRow('stable one'); // Represents the first personal-Stable breeding candidate rendered after world livestock.
const stableTwoRow = makeRow('stable two'); // Represents another personal-Stable breeding candidate that must remain untouched.
const visibleRows = [adultARow, babyBRow, adultCRow, stableOneRow, stableTwoRow]; // Mutable list returned by the fake Farm livestock container.
const container = {
  querySelectorAll(selector) {
    assert.equal(selector, '.farm-row.livestock-trait-row', 'row helper queries the shared livestock row selector');
    return visibleRows;
  },
}; // Minimal Farm livestock container used by the production row-identity helper.

let byId = helperContext.worldLivestockRowsById(container, records); // First pass tags only the world-livestock prefix before Nursery filtering.
assert.equal(byId.get('adult_a'), adultARow, 'first adult is bound to its saved livestock ID');
assert.equal(byId.get('baby_b'), babyBRow, 'baby is bound to its saved livestock ID before removal');
assert.equal(byId.get('adult_c'), adultCRow, 'later adult is bound to its own saved livestock ID');
assert.equal(stableOneRow.dataset.nurseryWorldLivestockId, undefined, 'personal-Stable breeding row is never tagged as world livestock');
assert.equal(stableTwoRow.dataset.nurseryWorldLivestockId, undefined, 'second personal-Stable breeding row is never tagged as world livestock');

visibleRows.splice(visibleRows.indexOf(babyBRow), 1); // Reproduces the first Nursery decoration removing its baby row from the DOM.
byId = helperContext.worldLivestockRowsById(container, records); // Reproduces the MutationObserver-driven second decoration on the shortened DOM.
assert.equal(byId.get('adult_a'), adultARow, 'repeat decoration keeps the first adult bound after a baby row disappears');
assert.equal(byId.get('adult_c'), adultCRow, 'repeat decoration keeps the later adult bound instead of shifting onto the removed baby index');
assert.equal(byId.has('baby_b'), false, 'removed Nursery baby is absent without causing positional rebinding');
assert.equal(stableOneRow.dataset.nurseryWorldLivestockId, undefined, 'repeat decoration still cannot claim the first Stable breeding row');
assert.equal(stableTwoRow.dataset.nurseryWorldLivestockId, undefined, 'repeat decoration still cannot claim the second Stable breeding row');

assert.match(decorateFunctionSource, /const rowById = worldLivestockRowsById\(container, records\)/, 'Farm decoration builds its lookup from persistent row IDs');
assert.match(decorateFunctionSource, /rowById\.get\(String\(entry\.id\)\)/, 'Farm decoration resolves each animal by saved ID');
assert.doesNotMatch(decorateFunctionSource, /records\.forEach\s*\(\s*\(entry,\s*index\)/, 'Farm decoration no longer pairs animals and rows by shifting array index');
assert.match(source, /max-height:132px;overflow-y:auto/, 'Farm Nursery baby list stays compact and scrollable');
assert.match(source, /missingRenderedAdults/, 'mobile Nursery diagnostics expose adults saved in state but absent from the rendered Farm list');
assert.match(source, /renderedStableBreedingRows/, 'mobile Nursery diagnostics report personal-Stable breeding rows separately');
assert.match(source, /barnAssignments/, 'mobile Nursery diagnostics expose saved barn occupancy groupings');

console.log('Livestock Farm/Nursery menu regression tests passed.');
