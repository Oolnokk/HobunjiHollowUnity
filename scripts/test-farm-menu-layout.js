'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const layoutSource = fs.readFileSync('docs/js/farm-menu-layout.js', 'utf8'); // Pins the Farm-tab presentation contract without duplicating runtime implementation.
const bridgeSource = fs.readFileSync('docs/js/livestock-nursery-install-bridge.js', 'utf8'); // Verifies parser-time loading stays wired through the existing farm bootstrap.

assert.match(layoutSource, /grid-template-columns:\s*minmax\(0,\s*1\.15fr\)\s+minmax\(300px,\s*\.85fr\)/, 'desktop Farm workspace uses the formerly empty right side');
assert.match(layoutSource, /@media \(max-width: 900px\)/, 'Farm workspace collapses back to one column on narrow screens');
assert.match(layoutSource, /ANIMALS_COLUMN_ID = 'farmMenuAnimalsColumn'/, 'animals and breeding have a dedicated primary column');
assert.match(layoutSource, /OPERATIONS_COLUMN_ID = 'farmMenuOperationsColumn'/, 'layout/buildings/processors share a separate facilities column');
assert.match(layoutSource, /pairButton\.parentElement !== bar\) bar\.appendChild\(pairButton\)/, 'the existing Set Breeding Pair button is promoted instead of cloned');
assert.match(layoutSource, /addButton\.parentElement !== bar\) bar\.appendChild\(addButton\)/, 'the existing Add Livestock control shares the primary animal action bar');
assert.match(layoutSource, /'Farm livestock', 'housed \/ outdoors adults'/, 'world livestock receive a clearly labeled subsection');
assert.match(layoutSource, /'Your Stable', 'breeding candidates only'/, 'personal Stable animals receive a clearly labeled breeding-only subsection');
assert.match(layoutSource, /row\.dataset\.nurseryWorldLivestockId \? worldRows : stableRows/, 'Farm-vs-Stable separation reuses the Nursery row identity contract');
assert.match(layoutSource, /nurseryFocusIndex = index/, 'controller-owned Nursery focus remembers the selected baby index');
assert.match(layoutSource, /nurseryScrollTop = scroll\.scrollTop/, 'Nursery local scroll position is remembered while navigating');
assert.match(layoutSource, /button\.focus\(\{ preventScroll: true \}\)/, 'replacement Nursery row receives focus without browser scroll snapping');
assert.match(layoutSource, /scroll\.scrollTop = nurseryScrollTop/, 'Nursery scroll position is restored after selected-state rerender');
assert.match(layoutSource, /hobunji-controller-ui-snapshot/, 'focus restoration is limited to recent controller navigation rather than hijacking pointer users');
assert.match(layoutSource, /window\.__farmMenuLayoutDebug/, 'Farm menu layout exposes an in-page diagnostic hook');

assert.match(bridgeSource, /globalKey: 'FarmMenuLayout', src: 'js\/farm-menu-layout\.js\?v=20260915farmui1'/, 'farm feature bootstrap loads the Farm menu presentation module');
assert.match(bridgeSource, /window\.FarmMenuLayout\?\.install\?\.\(\)/, 'late bootstrap path installs FarmMenuLayout as well');

console.log('Farm menu layout + Nursery controller continuity regression tests passed.');
