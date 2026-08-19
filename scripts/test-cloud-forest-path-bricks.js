'use strict';
const fs = require('fs');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '../docs/js/cloud-forest-scenery-options.js'), 'utf8');
for (const expected of [
  "wallrecipe2.json",
  "AuthoredCloudForestTownPathBricks",
  "p.y += heightAt(p.x, p.z)",
  "mesh.layers?.enable?.(OUTLINE_LAYER)",
  "DENSITY_KEEP = 0.25",
]) {
  if (!source.includes(expected)) throw new Error(`missing Cloud Forest scenery contract: ${expected}`);
}
console.log('PASS Cloud Forest scenery contract: town WallBuilder bricks follow incline; 25% outlined tree wall.');
