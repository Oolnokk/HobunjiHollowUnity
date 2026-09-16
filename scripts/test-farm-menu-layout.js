'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const layoutSource = fs.readFileSync('docs/js/farm-menu-layout.js', 'utf8'); // Pins the Farm-tab presentation contract without duplicating runtime implementation.
const paletteSource = fs.readFileSync('docs/js/farm-glance-palette.js', 'utf8'); // Pins and exercises the Farm glance marker palette/shape contract added for map readability.
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

assert.match(paletteSource, /sell_crate:\s*'#ff8a3d'/, 'Shipping Box gets its own orange map marker instead of sharing yellow');
assert.match(paletteSource, /supply_box:\s*'#6ea8ff'/, 'Supply / Order Box gets a separate blue map marker');
assert.match(paletteSource, /livestock:\s*'#ff8fd8'/, 'live livestock get a high-contrast pink map marker');
assert.match(paletteSource, /kind === 'supply_box'[\s\S]*ctx\.arc/, 'Supply / Order Box also carries a center-dot shape cue');
assert.match(paletteSource, /drawLivestockMarker[\s\S]*ctx\.fill\(\);[\s\S]*ctx\.stroke\(\);/, 'livestock markers are outlined circles rather than another flat service-box tile');
assert.match(paletteSource, /Shipping box/, 'legend names the Shipping Box separately');
assert.match(paletteSource, /Supply \/ order box/, 'legend names the Supply / Order Box separately');
assert.match(paletteSource, /panelDeps\.worldObjects/, 'palette overlay reads the real FarmPanel world-object collection');
assert.match(paletteSource, /panelDeps\.animalObjects/, 'palette overlay reads the real live-animal collection used by the core farm map');
assert.match(paletteSource, /window\.__farmGlancePaletteDebug/, 'farm glance palette exposes an in-page diagnostic hook');

let baseRenderCalls = 0; // Used to prove the palette wrapper preserves the underlying FarmPanel render exactly once.
let currentArc = null; // Stores the current mocked canvas path until fill()/stroke() records it.
const drawOps = []; // Captures service-box and livestock draw operations for color/shape assertions.
const mockContext2d = {
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 1,
  fillRect(x, y, w, h) { drawOps.push({ type: 'fillRect', color: this.fillStyle, x, y, w, h }); },
  strokeRect(x, y, w, h) { drawOps.push({ type: 'strokeRect', color: this.strokeStyle, x, y, w, h }); },
  beginPath() { currentArc = null; },
  arc(x, y, r) { currentArc = { x, y, r }; },
  fill() { if (currentArc) drawOps.push({ type: 'fillArc', color: this.fillStyle, ...currentArc }); },
  stroke() { if (currentArc) drawOps.push({ type: 'strokeArc', color: this.strokeStyle, ...currentArc }); },
};
const mockCanvas = { // Uses a 10×10 farm on a 100×100 canvas, so each tile is exactly 10px for precise assertions.
  width: 100,
  height: 100,
  getContext(kind) { return kind === '2d' ? mockContext2d : null; },
};
const paletteFarmPanel = { // Minimal public FarmPanel seam expected by FarmGlancePalette.install().
  init(injectedDeps) { this.deps = injectedDeps; },
  render() { baseRenderCalls++; return 'base-render-result'; },
};
const paletteDocument = { // Legend is intentionally absent here; source assertions above pin legend rewriting while this mock exercises canvas behavior.
  getElementById(id) { return id === 'farmGlanceCanvas' ? mockCanvas : null; },
};
const paletteContext = { // VM context mirrors the browser globals actually used by the palette module.
  window: { FarmPanel: paletteFarmPanel },
  document: paletteDocument,
  console,
  Math,
  Number,
  Object,
  Array,
  Set,
  Map,
  String,
};
paletteContext.window.window = paletteContext.window;
vm.createContext(paletteContext);
vm.runInContext(paletteSource, paletteContext, { filename: 'farm-glance-palette.js' });
const paletteDeps = { // Two service boxes and one live animal exercise all three newly distinct markers.
  COLS: 10,
  ROWS: 10,
  worldObjects: new Map([
    ['1,1', { type: 'sell_crate' }],
    ['2,2', { type: 'supply_box' }],
  ]),
  animalObjects: new Set([{ col: 3, row: 4 }]),
};
paletteContext.window.FarmPanel.init(paletteDeps);
const paletteRenderResult = paletteContext.window.FarmPanel.render(); // Wrapped render should call the base renderer before painting overlays.
assert.equal(paletteRenderResult, 'base-render-result', 'palette wrapper preserves FarmPanel.render return values');
assert.equal(baseRenderCalls, 1, 'palette wrapper invokes the underlying FarmPanel render exactly once');
assert(drawOps.some(op => op.type === 'fillRect' && op.color === '#ff8a3d' && op.x === 10 && op.y === 10 && op.w === 10 && op.h === 10), 'Shipping Box overlay fully replaces its old yellow tile with orange');
assert(drawOps.some(op => op.type === 'fillRect' && op.color === '#6ea8ff' && op.x === 20 && op.y === 20 && op.w === 10 && op.h === 10), 'Supply / Order Box overlay fully replaces its old yellow tile with blue');
assert(drawOps.some(op => op.type === 'fillArc' && op.color === '#ff8fd8' && op.x === 35 && op.y === 45), 'live livestock render as pink circles at their real farm coordinates');
assert(drawOps.some(op => op.type === 'strokeArc' && op.color === '#2b1022' && op.x === 35 && op.y === 45), 'live livestock circles receive a dark outline for nighttime readability');
const paletteDebug = paletteContext.window.FarmGlancePalette.debugSnapshot(); // In-page diagnostic should report the same live marker set the canvas used.
assert.equal(paletteDebug.liveLivestockMarkers, 1, 'farm glance diagnostics expose the number of live livestock map markers');
assert.equal(paletteDebug.serviceCounts.shipping, 1, 'farm glance diagnostics distinguish Shipping Box markers');
assert.equal(paletteDebug.serviceCounts.supply, 1, 'farm glance diagnostics distinguish Supply / Order Box markers');

assert.match(bridgeSource, /globalKey: 'FarmMenuLayout', src: 'js\/farm-menu-layout\.js\?v=20260915farmui2'/, 'farm feature bootstrap loads the current Farm menu presentation module');
assert.match(bridgeSource, /window\.FarmMenuLayout\?\.install\?\.\(\)/, 'late bootstrap path installs FarmMenuLayout as well');
assert.match(bridgeSource, /globalKey: 'FarmGlancePalette', src: 'js\/farm-glance-palette\.js\?v=20260916palette1'/, 'farm feature bootstrap loads the distinct map-marker palette');
assert.match(bridgeSource, /window\.FarmGlancePalette\?\.install\?\.\(\)/, 'late bootstrap path installs the farm map palette as well');

console.log('Farm menu layout + Nursery controller continuity + farm glance palette regression tests passed.');
