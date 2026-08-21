'use strict';
const fs = require('fs');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '../docs/js/cloud-forest-scenery-options.js'), 'utf8');
for (const expected of [
  "TREE_WALL_KEY",
  "original generated north cliff boundary retained",
  "return treeWallEnabled() ? removeCloudForestNorthBoundaryCliffs(workspace) : workspace",
  "buildTownPathBricks(scene, zcols)",
]) {
  if (!source.includes(expected)) throw new Error(`missing boundary-mode contract: ${expected}`);
}
console.log('PASS Cloud Forest boundary mode contract: tree wall vs original cliffs + retained inclined road.');
