#!/usr/bin/env python3
from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one match, found {count} for {old[:100]!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


cavern = 'docs/js/cavern-generator.js'
replace_once(
    cavern,
    "  let deps = null;\n  function init(injectedDeps) { deps = injectedDeps; }\n",
    "  let deps = null;\n  function init(injectedDeps) { deps = injectedDeps; }\n\n"
    "  function setGenerationLabel(text, huge = false) {\n"
    "    if (typeof document === 'undefined') return;\n"
    "    const label = document.querySelector('#denLoadingLabel span'); // Used by both animal dens and procedural mine floors so they share one loading overlay.\n"
    "    if (!label) return;\n"
    "    label.textContent = String(text || '');\n"
    "    label.style.fontSize = huge ? 'clamp(64px, 14vw, 160px)' : '26px';\n"
    "    label.style.fontWeight = huge ? '900' : '400';\n"
    "    label.style.lineHeight = huge ? '0.9' : 'normal';\n"
    "    label.style.letterSpacing = huge ? '0.12em' : '0.08em';\n"
    "  }\n"
)
replace_once(
    cavern,
    "  function synthesizeCavernMapData(mapId) {\n    const { floor, cols, rows, exitCol, exitRow, exitTiles, nestCol, nestRow, disconnectedFloorTilesRemoved, mesh } = generateCavernFloor(mapId);\n",
    "  function synthesizeCavernMapData(mapId) {\n    setGenerationLabel('Generating den…', false); // Reset the shared overlay after a mine visit so animal dens never inherit a stale floor title.\n    const { floor, cols, rows, exitCol, exitRow, exitTiles, nestCol, nestRow, disconnectedFloorTilesRemoved, mesh } = generateCavernFloor(mapId);\n"
)
replace_once(
    cavern,
    "    init,\n    generateCavernFloor,\n",
    "    init,\n    setGenerationLabel,\n    generateCavernFloor,\n"
)

mine = 'docs/js/town-mine.js'
replace_once(
    mine,
    "    const visitSeed = `${mapId}_visit_${visit}_${Date.now()}_${Math.floor(Math.random() * 0x7fffffff)}`; // Used so revisiting the same numbered floor rebuilds both geometry and encounters.\n    const generated = window.CavernGenerator.generateCavernFloor(`${visitSeed}_layout`, { fast: true, cache: false }); // Uses Mine Fast without retaining every regenerated visit in the Den cache.\n",
    "    const visitSeed = `${mapId}_visit_${visit}_${Date.now()}_${Math.floor(Math.random() * 0x7fffffff)}`; // Used so revisiting the same numbered floor rebuilds both geometry and encounters.\n    window.CavernGenerator.setGenerationLabel?.(`FLOOR ${floorNumber}`, true); // Used to replace the den-specific loading copy with the current mine floor in huge centered type before the synchronous carve begins.\n    const generated = window.CavernGenerator.generateCavernFloor(`${visitSeed}_layout`, { fast: true, cache: false }); // Uses Mine Fast without retaining every regenerated visit in the Den cache.\n"
)

Path('scripts/test-mine-floor-generation-title.js').write_text(r'''#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const cavern = fs.readFileSync('docs/js/cavern-generator.js', 'utf8');
const mine = fs.readFileSync('docs/js/town-mine.js', 'utf8');
assert.match(cavern, /function setGenerationLabel\(text, huge = false\)/, 'cavern generator exposes shared generation-label formatting');
assert.match(cavern, /clamp\(64px, 14vw, 160px\)/, 'mine-floor title uses oversized responsive type');
assert.match(cavern, /setGenerationLabel\('Generating den…', false\)/, 'animal dens reset the shared loading label');
assert.match(cavern, /setGenerationLabel,\s*generateCavernFloor/, 'generation-label helper is exported');
assert.match(mine, /setGenerationLabel\?\.\(`FLOOR \$\{floorNumber\}`, true\)/, 'mine floor writes its floor number before generation');
assert.ok(mine.indexOf('setGenerationLabel?.(`FLOOR ${floorNumber}`, true)') < mine.indexOf('generateCavernFloor(`${visitSeed}_layout`'), 'floor title is set before the expensive cave carve');
console.log('Mine floor generation title tests passed');
''', encoding='utf-8')

print('Applied mine floor generation title changes.')
