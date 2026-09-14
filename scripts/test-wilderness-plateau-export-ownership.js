'use strict';

const assert = require('node:assert/strict');
const WildernessMapGenerator = require('../docs/js/wilderness-map-generator.js');

const ZONE_ID = 'map_western_slope';
const SEEDS = [
  'wilderness_plateau_ring_export_regression',
  'ravine_probe_a',
  'ravine_probe_b',
  'ravine_probe_c',
  'terrace_cleanup_a',
  'terrace_cleanup_b',
  'terrace_cleanup_c',
  'terrace_cleanup_d'
];
const REPRO_KEYS = ['182,110', '183,110', '182,111', '183,111'];
const WATER_TYPES = new Set(['water', 'river', 'stream', 'waterfall']);

function dryEnclosedTwoByTwoHoles(root) {
  const plateauAt = (col, row) => !!root.tiles?.[`${col},${row}`]?.plateau;
  const holes = [];
  for (let row = 1; row < root.rows - 2; row++) {
    for (let col = 1; col < root.cols - 2; col++) {
      if (plateauAt(col, row) || plateauAt(col + 1, row) || plateauAt(col, row + 1) || plateauAt(col + 1, row + 1)) continue;
      let enclosed = true;
      for (let x = col - 1; x <= col + 2; x++) enclosed = enclosed && plateauAt(x, row - 1) && plateauAt(x, row + 2);
      for (let y = row; y <= row + 1; y++) enclosed = enclosed && plateauAt(col - 1, y) && plateauAt(col + 2, y);
      if (!enclosed) continue;
      const cells = [
        root.tiles?.[`${col},${row}`],
        root.tiles?.[`${col + 1},${row}`],
        root.tiles?.[`${col},${row + 1}`],
        root.tiles?.[`${col + 1},${row + 1}`]
      ];
      if (!cells.every(tile => WATER_TYPES.has(String(tile?.type || '').toLowerCase()))) {
        holes.push({ col, row, types: cells.map(tile => tile?.type || 'none') });
      }
    }
  }
  return holes;
}

let groupsChecked = 0;
let metadataOnlyChildren = 0;
for (const seed of SEEDS) {
  const workspace = WildernessMapGenerator.generateZoneWorkspace(ZONE_ID, seed);
  const root = (workspace.maps || []).find(editorMap => !editorMap.isSubmap);
  assert.ok(root, `generated workspace must contain a root map for ${seed}`);
  const childByGroupId = new Map(
    (workspace.maps || [])
      .filter(editorMap => editorMap.isSubmap && editorMap.plateauGroupId)
      .map(editorMap => [editorMap.plateauGroupId, editorMap])
  );
  const rootPlateauIds = new Set(
    Object.values(root.tiles || {}).map(tile => tile?.plateau).filter(Boolean)
  );

  for (const group of workspace.plateauGroups || []) {
    const child = childByGroupId.get(group.id);
    assert.ok(child, `plateau group ${group.id} must retain a matching child map for ${seed}`);
    assert.ok(rootPlateauIds.has(group.id), `exported plateau group ${group.id} must own parent-mask tiles for ${seed}`);
    groupsChecked++;
    if (!Object.keys(child.tiles || {}).length) {
      metadataOnlyChildren++;
      assert.equal(child.generatedMetadataOnlyPlateau, true, `empty child ${child.id} must be metadata-only for ${seed}`);
    }
  }

  const holes = dryEnclosedTwoByTwoHoles(root);
  assert.deepEqual(holes, [], `dry enclosed 2x2 ground ravines must not survive plateau export for ${seed}: ${JSON.stringify(holes.slice(0, 16))}`);

  if (seed === 'ravine_probe_c') {
    const reproGroups = new Set();
    for (const key of REPRO_KEYS) {
      const tile = root.tiles?.[key];
      assert.ok(tile?.plateau, `reproduced ravine tile ${key} must retain plateau ownership`);
      reproGroups.add(tile.plateau);
    }
    assert.equal(reproGroups.size, 1, 'the reproduced 2x2 terrace must remain one plateau group');
    const [groupId] = reproGroups;
    const child = childByGroupId.get(groupId);
    assert.ok(child, `reproduced all-ring group ${groupId} must retain a child map`);
    assert.equal(Object.keys(child.tiles || {}).length, 0, 'reproduced all-ring terrace child should remain metadata-only');
    assert.equal(child.generatedMetadataOnlyPlateau, true, 'reproduced all-ring terrace child must be marked metadata-only');
  }
}

assert.ok(groupsChecked > 0, 'Western Slope regression seeds must export plateau groups');
assert.ok(metadataOnlyChildren > 0, 'Western Slope regression seeds must exercise metadata-only plateau children');
console.log(`Wilderness plateau export ownership regression passed: ${SEEDS.length} seeds, ${groupsChecked} groups, ${metadataOnlyChildren} metadata-only children, 0 dry enclosed 2x2 ravines.`);
