#!/usr/bin/env node
// Headless check for Tothal Shift wilderness generation — generates each of
// the four wilderness zone maps from a seed (exactly what docs/game.js does
// at a Tothal Shift, including the reroll-until-healthy retry), then
// validates the folded result: mesa geometry is watertight and the entry
// gate reaches a healthy share of the map.
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
  const ws = G.generateHealthyZoneWorkspace(zoneId, seed, { terrainPreview: TP });
  const elapsed = Date.now() - started;
  const root = ws.maps[0];
  console.log(`\n=== ${zoneId} (${root.cols}x${root.rows}, ${elapsed} ms, ${ws.maps.length - 1} submaps, ${ws.ramps.length} ramps) ===`);

  if (ws.schema !== 'hobunji_map_editor_workspace.v1') fail(`unexpected schema ${ws.schema}`);
  if (!ws.entry) fail('no entry gate chosen');

  // Determinism: the same seed must rebuild the identical map on reload.
  const ws2 = G.generateHealthyZoneWorkspace(zoneId, seed, { terrainPreview: TP });
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

  const assessment = ws.reachabilityAssessment;
  if (assessment) {
    console.log(`  entry (${ws.entry.col},${ws.entry.row}) side=${ws.entry.side}; reachable ${assessment.reachable}/${assessment.walkableCount} walkable tiles (${Math.round(assessment.ratio * 100)}%), attempt ${assessment.attempt + 1}`);
    if (!assessment.ok) fail(`unhealthy after retries: ${assessment.reason || 'low reachability'} (${Math.round(assessment.ratio * 100)}%)`);
  } else {
    fail('no reachability assessment produced (TerrainPreview unavailable?)');
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
