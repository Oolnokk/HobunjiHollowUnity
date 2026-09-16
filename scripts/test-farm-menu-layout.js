'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const layoutSource = fs.readFileSync('docs/js/farm-menu-layout.js', 'utf8'); // Pins the Farm-tab presentation contract without duplicating runtime implementation.
const bridgeSource = fs.readFileSync('docs/js/livestock-nursery-install-bridge.js', 'utf8'); // Verifies parser-time loading stays wired through the existing farm bootstrap.

assert.match(layoutSource, /grid-template-columns:\s*minmax\(0,\s*1\.15fr\)\s+minmax\(300px,\s*\.85fr\)/, 'desktop Farm workspace uses the formerly empty right side');
assert.match(layoutSource, /#mpFarm \{\s*overflow:\s*hidden;/s, 'desktop Farm pane delegates scrolling to its full-height columns');
assert.match(layoutSource, /#mpFarm \.farm-pane \{[\s\S]*height:\s*100%;[\s\S]*min-height:\s*0;/, 'Farm pane fills the available menu body height');
assert.match(layoutSource, /#\$\{WORKSPACE_ID\} \{[\s\S]*flex:\s*1 1 auto;[\s\S]*min-height:\s*0;[\s\S]*height:\s*0;/, 'Farm workspace consumes the remaining height below the Farm header');
assert.match(layoutSource, /#\$\{ANIMALS_COLUMN_ID\}, #\$\{OPERATIONS_COLUMN_ID\} \{[\s\S]*overflow-y:\s*auto;/, 'desktop Farm columns own the vertical scroll instead of an inner roster list');
assert.match(layoutSource, /#farmLivestockList \{[\s\S]*max-height:\s*none !important;[\s\S]*overflow:\s*visible !important;/, 'livestock roster no longer inherits the old 320px nested scroller');
assert.match(layoutSource, /@media \(max-width: 900px\)/, 'Farm workspace collapses back to one column on narrow screens');
assert.match(layoutSource, /#mpFarm \{ overflow-y: auto; overflow-x: hidden; \}/, 'narrow layouts return to one ordinary pane-level scroll');
assert.match(layoutSource, /ANIMALS_COLUMN_ID = 'farmMenuAnimalsColumn'/, 'animals and breeding have a dedicated primary column');
assert.match(layoutSource, /OPERATIONS_COLUMN_ID = 'farmMenuOperationsColumn'/, 'layout/buildings/processors share a separate facilities column');
assert.match(layoutSource, /\.farm-menu-column-label \{[\s\S]*font-size:\s*16px;/, 'both Farm column headings are large enough to establish the panel hierarchy');
assert.match(layoutSource, /\.farm-menu-column-label::after \{[\s\S]*height:\s*1px;/, 'column headings carry a horizontal separator rule');
assert.match(layoutSource, /\.farm-section > \.settings-section-title \{[\s\S]*font-size:\s*14px;/, 'top-level sections in both Farm columns use larger headings');
assert.match(layoutSource, /\.farm-section > \.settings-section-title::after \{[\s\S]*height:\s*1px;/, 'top-level section headings extend into a separator rule');
assert.match(layoutSource, /\.farm-animal-divider \{[\s\S]*font-size:\s*13px;/, 'Farm livestock, Stable candidates, and active breeding subheadings are visually stronger');
assert.match(layoutSource, /\.farm-animal-divider::after \{[\s\S]*height:\s*1px;/, 'animal subsection headings also carry separator rules');
assert.match(layoutSource, /pairButton\.parentElement !== bar\) bar\.appendChild\(pairButton\)/, 'the existing Set Breeding Pair button is promoted instead of cloned');
assert.match(layoutSource, /addButton\.parentElement !== bar\) bar\.appendChild\(addButton\)/, 'the existing Add Livestock control shares the primary animal action strip');
assert.match(layoutSource, /WORLD_HEADING_ID = 'farmWorldLivestockHeading'/, 'world livestock receive a flat divider instead of a nested wrapper');
assert.match(layoutSource, /STABLE_HEADING_ID = 'farmStableBreedingHeading'/, 'personal Stable candidates receive a flat divider instead of a nested wrapper');
assert.match(layoutSource, /Direct real rows only: no nested wrappers or hidden identity sentinel/, 'Farm-vs-Stable organization explicitly keeps visible roster rows direct');
assert.match(layoutSource, /LEGACY_GROUP_IDS = \['farmWorldLivestockGroup', 'farmStableBreedingGroup'\]/, 'hot reload removes the previous nested-group presentation');
assert.match(layoutSource, /row\.dataset\.nurseryWorldLivestockId/, 'Farm-vs-Stable separation reuses the Nursery row identity contract');
assert.match(layoutSource, /WORLD_IDENTITY_SENTINEL_ID = 'farmWorldLivestockIdentitySentinel'/, 'all-baby edge protection has a dedicated hidden row identity sentinel');
assert.match(layoutSource, /needsSentinel = !hasTaggedWorldRow && rosterRows\.length > 0/, 'identity sentinel appears only when no real tagged world row survives but candidate rows remain');
assert.match(layoutSource, /sentinel\.dataset\.nurseryWorldLivestockId = '__farm_menu_identity_sentinel__'/, 'sentinel keeps repeated Nursery passes out of positional rebinding');
assert.match(layoutSource, /const alreadyOrdered = currentManaged\.length === desiredNodes\.length/, 'flat roster checks its current order before moving nodes');
assert.match(layoutSource, /if \(!alreadyOrdered\) desiredNodes\.forEach/, 'observer passes stop mutating once the flat roster order is correct');
assert.match(layoutSource, /max-height:\s*76px !important;/, 'Nursery baby viewport is much shorter than the old oversized presentation');
assert.match(layoutSource, /overflow-y:\s*scroll !important;/, 'Nursery baby viewport explicitly owns vertical scrolling');
assert.match(layoutSource, /touch-action:\s*pan-y;/, 'Nursery baby viewport accepts direct touch scrolling');
assert.match(layoutSource, /flex:\s*0 0 auto !important;/, 'Nursery baby rows cannot shrink to avoid overflow and suppress scrolling');
assert.match(layoutSource, /nurseryFocusIndex = index/, 'controller-owned Nursery focus remembers the selected baby index');
assert.match(layoutSource, /nurseryScrollTop = scroll\.scrollTop/, 'Nursery local scroll position is remembered while navigating');
assert.match(layoutSource, /button\.focus\(\{ preventScroll: true \}\)/, 'replacement Nursery row receives focus without browser scroll snapping');
assert.match(layoutSource, /controllerSnapshotHasInput/, 'controller continuity is keyed to actual controller input rather than mere controller presence');
assert.match(layoutSource, /buttonDown \|\| analog > 0\.15/, 'idle connected controllers do not keep controller continuity armed');
assert.match(layoutSource, /lastControllerInputAt = -Infinity/, 'pointer input explicitly takes ownership away from controller restoration');
assert.match(layoutSource, /window\.__farmMenuLayoutDebug/, 'Farm menu layout exposes an in-page diagnostic hook');

assert.match(bridgeSource, /globalKey: 'FarmMenuLayout', src: 'js\/farm-menu-layout\.js\?v=20260915farmui2'/, 'farm feature bootstrap loads the current Farm menu presentation module');
assert.match(bridgeSource, /window\.FarmMenuLayout\?\.install\?\.\(\)/, 'late bootstrap path installs FarmMenuLayout as well');

console.log('Farm menu layout + Nursery controller continuity regression tests passed.');