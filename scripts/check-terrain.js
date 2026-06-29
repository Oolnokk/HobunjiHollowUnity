#!/usr/bin/env node
// Headless watertightness check for the Map Editor's plateau/ramp terrain
// authoring data — runs the exact same merge + heightfield geometry math the
// live 3D preview (docs/tools/map-editor) uses, without needing a browser.
//
// Usage:
//   node scripts/check-terrain.js [workspace.json] [mapId ...]
//
// With no mapId args, checks every non-submap exterior map in the workspace.
// Exits non-zero if any ERROR-severity issue is found, or if building the
// mesa/ramp geometry for any map throws or produces non-finite coordinates.
const fs = require('fs');
const path = require('path');
const TP = require('../docs/js/terrain-preview.js');

const wsPath = process.argv[2] || path.join(__dirname, '..', 'docs', 'config', 'town-workspace-v1.json');
const requestedIds = process.argv.slice(3);

const ws = JSON.parse(fs.readFileSync(wsPath, 'utf8'));
const maps = ws.maps || [];

const rootIds = requestedIds.length
  ? requestedIds
  : maps.filter(m => m.category === 'exterior' && !m.isSubmap).map(m => m.id);

let hadError = false;

for (const mapId of rootIds) {
  const map = maps.find(m => m.id === mapId);
  if (!map) {
    console.error(`✗ ${mapId}: not found in workspace`);
    hadError = true;
    continue;
  }

  console.log(`\n=== ${mapId} (${map.name || ''}) ===`);

  let merged;
  try {
    merged = TP.buildMergedZoneGrid(ws, mapId);
  } catch (e) {
    console.error(`✗ buildMergedZoneGrid threw: ${e.message}`);
    hadError = true;
    continue;
  }
  console.log(`grid ${merged.cols}x${merged.rows}, ${merged.mesas.length} plateau tier transition(s)`);

  const zGrid = TP.buildZGrid(merged.cols, merged.rows, merged.tiles);
  TP.applyRampCurtainFlags(zGrid, merged.cols, merged.rows);

  for (const mesa of merged.mesas) {
    const elevOffset = (mesa.toTier - mesa.fromTier) * TP.PLATEAU_UNIT;
    if (elevOffset <= 0) continue;
    try {
      const geo = TP.buildPlateauMesaGeometry(mesa, elevOffset, mesa.fromTier * TP.PLATEAU_UNIT, zGrid);
      const bad = [...geo.pos].some(v => !Number.isFinite(v));
      if (bad) { console.error(`✗ mesa ${mesa.groupId}: non-finite vertex coordinate`); hadError = true; }
      if (geo.idx.length === 0) { console.error(`✗ mesa ${mesa.groupId}: produced zero quads despite elevOffset > 0`); hadError = true; }
    } catch (e) {
      console.error(`✗ mesa ${mesa.groupId} geometry threw: ${e.message}`);
      hadError = true;
    }
  }
  try {
    const rampGeo = TP.buildRampMeshGeometry(zGrid, merged.cols, merged.rows);
    const curtainGeo = TP.buildRampCurtainGeometry(zGrid, merged.cols, merged.rows);
    const rockGeo = TP.buildRockFormationGeometry(merged, zGrid, merged.cols, merged.rows);
    for (const arr of [rampGeo.pos, curtainGeo.pos, rockGeo.pos]) {
      if ([...arr].some(v => !Number.isFinite(v))) { console.error(`✗ non-finite ramp/curtain/rock vertex`); hadError = true; }
    }
    for (const issue of TP.validateRockFormationGeometry(rockGeo)) {
      const marker = issue.severity === 'error' ? '✗' : issue.severity === 'warning' ? '⚠' : 'ℹ';
      console.log(`${marker} [${issue.severity}] ${issue.code}: ${issue.message}`);
      if (issue.severity === 'error') hadError = true;
    }
    console.log(`rock formation: ${rockGeo.sources.length} source span(s) → ${rockGeo.spans.length} solved edge span(s)`);
  } catch (e) {
    console.error(`✗ ramp geometry threw: ${e.message}`);
    hadError = true;
  }

  const issues = TP.validateTerrain(ws, mapId);
  if (!issues.length) {
    console.log('✓ no issues found');
  }
  for (const issue of issues) {
    const marker = issue.severity === 'error' ? '✗' : issue.severity === 'warning' ? '⚠' : 'ℹ';
    console.log(`${marker} [${issue.severity}] ${issue.code}: ${issue.message}`);
    if (issue.severity === 'error') hadError = true;
  }
}

console.log('');
if (hadError) {
  console.error('FAILED: one or more error-severity issues found.');
  process.exit(1);
}
console.log('OK: no error-severity issues found.');
