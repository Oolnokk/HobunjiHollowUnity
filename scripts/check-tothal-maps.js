#!/usr/bin/env node
// Headless check for Tothal Shift wilderness generation — generates each of
// the four wilderness zone maps from a seed (exactly what docs/game.js does
// at a Tothal Shift: a random seed and the zone's own entry side, otherwise
// the standalone tool's stock defaults, no post-processing), then folds the
// resulting Map Editor workspace through the same plateau merge math the
// game uses (docs/js/terrain-preview.js) and checks that the mesa/rock
// geometry it produces is watertight — the same class of check
// scripts/check-terrain.js runs for the authored maps. This does NOT assert
// anything about reachability: a generated map is treated exactly like an
// authored one, warts and all.
//
// Usage:
//   node scripts/check-tothal-maps.js [seedBase]
//
// seedBase defaults to a random string, so plain runs exercise fresh seeds;
// pass one for a reproducible check.
const G = require('../docs/js/wilderness-map-generator.js');
const TP = require('../docs/js/terrain-preview.js');

const seedBase = process.argv[2] || `tothal_${Math.random().toString(36).slice(2, 10)}`;
console.log(`seed base: ${seedBase}`);

let hadError = false;
const fail = msg => { console.error(`  ✗ ${msg}`); hadError = true; };

for (const zoneId of G.zoneMapIds()) {
  const seed = `${seedBase}_${zoneId}`;
  const started = Date.now();
  const ws = G.generateZoneWorkspace(zoneId, seed);
  const elapsed = Date.now() - started;
  const root = ws.maps[0];
  console.log(`\n=== ${zoneId} (${root.cols}x${root.rows}, ${elapsed} ms, ${ws.maps.length - 1} submaps, ${ws.ramps.length} ramps) ===`);

  if (ws.schema !== 'hobunji_map_editor_workspace.v1') fail(`unexpected schema ${ws.schema}`);
  if (!ws.entry) fail('no entry gate chosen');
  else console.log(`  entry: ${ws.entry.side} at (${ws.entry.col},${ws.entry.row})`);

  // Determinism: the same seed must rebuild the identical map on reload.
  const ws2 = G.generateZoneWorkspace(zoneId, seed);
  const strip = w => JSON.stringify({ ...w, generatedAt: null });
  if (strip(ws) !== strip(ws2)) fail('generation is not deterministic for identical seeds');

  // Fold through the same merge math the game uses and check mesa geometry
  // is watertight (mirrors scripts/check-terrain.js's own checks).
  let merged;
  try {
    merged = TP.buildMergedZoneGrid(ws, root.id);
  } catch (e) {
    fail(`buildMergedZoneGrid threw: ${e.message}`);
    continue;
  }
  const zGrid = TP.buildZGrid(merged.cols, merged.rows, merged.tiles);
  TP.applyRampCurtainFlags(zGrid, merged.cols, merged.rows);
  for (const mesa of merged.mesas) {
    const elevOffset = (mesa.toTier - mesa.fromTier) * TP.PLATEAU_UNIT;
    if (elevOffset <= 0) continue;
    try {
      const geo = TP.buildPlateauMesaGeometry(mesa, elevOffset, mesa.fromTier * TP.PLATEAU_UNIT, zGrid);
      if ([...geo.pos].some(v => !Number.isFinite(v))) fail(`mesa ${mesa.groupId}: non-finite vertex`);
    } catch (e) {
      fail(`mesa ${mesa.groupId} geometry threw: ${e.message}`);
    }
  }

  const typeCounts = {};
  for (let r = 0; r < merged.rows; r++) for (let c = 0; c < merged.cols; c++) {
    const t = zGrid[r][c];
    typeCounts[t.type] = (typeCounts[t.type] || 0) + 1;
  }
  console.log(`  folded tile types: ${Object.entries(typeCounts).map(([k, v]) => `${k}:${v}`).join(', ')}`);
  if (ws.warnings.length) console.log(`  generator warnings: ${ws.warnings.length}\n    ${ws.warnings.join('\n    ')}`);
}

console.log(hadError ? '\nFAILED' : '\nOK');
process.exit(hadError ? 1 : 0);
