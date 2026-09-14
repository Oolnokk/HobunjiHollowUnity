'use strict';

const assert = require('node:assert/strict');
const WildernessMapGenerator = require('../docs/js/wilderness-map-generator.js');

const ZONE_ID = 'map_western_slope';
const SEED = 'wilderness_plateau_ring_export_regression';

const workspace = WildernessMapGenerator.generateZoneWorkspace(ZONE_ID, SEED);
const root = (workspace.maps || []).find(editorMap => !editorMap.isSubmap);
assert.ok(root, 'generated workspace must contain a root map');

const childByGroupId = new Map(
  (workspace.maps || [])
    .filter(editorMap => editorMap.isSubmap && editorMap.plateauGroupId)
    .map(editorMap => [editorMap.plateauGroupId, editorMap])
);

const directions = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0],            [1, 0],
  [-1, 1],  [0, 1],   [1, 1]
];

function maskForGroup(groupId) {
  const mask = new Set(); // Tracks the parent-owned plateau footprint used to identify its reserved ring.
  for (const [key, tile] of Object.entries(root.tiles || {})) {
    if (tile && tile.plateau === groupId) mask.add(key);
  }
  return mask;
}

function isParentRingCell(c, r, mask) {
  for (const [dc, dr] of directions) {
    const nc = c + dc;
    const nr = r + dr;
    if (nc < 0 || nr < 0 || nc >= root.cols || nr >= root.rows) return true;
    if (!mask.has(`${nc},${nr}`)) return true;
  }
  return false;
}

let groupsChecked = 0;
let parentRingCells = 0;
let childOwnedTiles = 0;
let metadataOnlyChildren = 0;
const ringOwnershipViolations = [];

for (const group of workspace.plateauGroups || []) {
  const child = childByGroupId.get(group.id);
  assert.ok(child, `plateau group ${group.id} must retain a matching child map even when it has no interior tiles`);

  const mask = maskForGroup(group.id);
  assert.ok(mask.size > 0, `plateau group ${group.id} must own at least one parent-mask tile`);
  groupsChecked++;

  const ring = new Set(); // Tracks the group's source-style 8-neighbor ring, which must stay parent-owned.
  for (const key of mask) {
    const [c, r] = key.split(',').map(Number);
    if (isParentRingCell(c, r, mask)) ring.add(key);
  }
  parentRingCells += ring.size;

  const childKeys = Object.keys(child.tiles || {});
  childOwnedTiles += childKeys.length;
  if (!childKeys.length) {
    metadataOnlyChildren++;
    assert.equal(
      child.generatedMetadataOnlyPlateau,
      true,
      `empty plateau child ${child.id} must be explicitly retained as metadata-only`
    );
  }

  for (const key of childKeys) {
    const [c, r] = key.split(',').map(Number);
    const worldKey = `${child.anchorC + c},${child.anchorR + r}`;
    if (ring.has(worldKey)) ringOwnershipViolations.push(`${group.id}:${worldKey}`);
  }
}

assert.ok(groupsChecked > 0, 'Western Slope regression seed must export plateau groups');
assert.ok(parentRingCells > 0, 'Western Slope regression seed must contain plateau ring cells');
assert.equal(
  ringOwnershipViolations.length,
  0,
  `plateau child maps must never repaint parent-owned ring cells; violations: ${ringOwnershipViolations.slice(0, 24).join(', ')}`
);

console.log(
  `Wilderness plateau ring export regression passed: ${groupsChecked} groups, ` +
  `${parentRingCells} parent ring cells, ${childOwnedTiles} child-owned top tiles, ` +
  `${metadataOnlyChildren} metadata-only children.`
);
