'use strict';
const fs = require('fs');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '../docs/js/cloud-forest-scenery-options.js'), 'utf8');
for (const expected of [
  "wallrecipe2.json",
  "AuthoredCloudForestTownPathBricks",
  "p.y += heightAt(p.x, p.z)",
  "DENSITY_KEEP = 0.25",
]) {
  if (!source.includes(expected)) throw new Error(`missing Cloud Forest scenery contract: ${expected}`);
}

// Density thinning and outline-layer tagging moved into border-terrain.js's
// instanceDenseShadewoodForest (driven by treeWallEnabled() at build time):
// once genuinely-unique procedural tree geometry gets merged into one static
// mesh per material for a real draw-call reduction, there's no per-tree
// InstancedMesh instance left to truncate or tag after the fact the way
// cloud-forest-scenery-options.js used to.
const borderSource = fs.readFileSync(path.join(__dirname, '../docs/js/border-terrain.js'), 'utf8');
for (const expected of [
  "mesh.layers?.enable?.(window.CloudForestSceneryOptions?.OUTLINE_LAYER",
  "keepFraction",
  "mergeTreeGeometriesWithTransform",
]) {
  if (!borderSource.includes(expected)) throw new Error(`missing Cloud Forest dense-forest contract in border-terrain.js: ${expected}`);
}
console.log('PASS Cloud Forest scenery contract: town WallBuilder bricks follow incline; 25% outlined tree wall merged into static draw calls.');
