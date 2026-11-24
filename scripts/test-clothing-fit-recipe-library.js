'use strict';
// The clothing fitter loads every recipe listed in docs/config/clothing-fit-recipes/index.json.
// Each must be a complete hobunji-clothing-fit-recipe-v1 (base transform + 36 local offsets).
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '../docs/config/clothing-fit-recipes');
const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
assert(Array.isArray(index.entries), 'recipe index lists entries');
const ids = new Set();
for (const entry of index.entries) {
  const file = path.join(dir, String(entry.path || '').replace(/^\.\//, ''));
  assert(fs.existsSync(file), 'missing recipe file: ' + entry.path);
  const recipe = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(recipe.format, 'hobunji-clothing-fit-recipe-v1', entry.path + ' format');
  assert.equal(recipe.id, entry.id, entry.path + ' id matches its index entry');
  assert(!ids.has(recipe.id), 'duplicate recipe id ' + recipe.id); ids.add(recipe.id);
  assert(typeof recipe.name === 'string' && recipe.name, entry.path + ' has a name');
  for (const key of ['scaleX', 'scaleY', 'translateX', 'translateY'])
    assert(Number.isFinite(recipe.transform?.[key]), entry.path + ' transform.' + key);
  assert(recipe.transform.scaleX > 0 && recipe.transform.scaleY > 0, entry.path + ' positive scale');
  assert(Array.isArray(recipe.offsets) && recipe.offsets.length === 36, entry.path + ' has 36 grid offsets');
  for (const o of recipe.offsets) assert(Number.isFinite(o.x) && Number.isFinite(o.y), entry.path + ' finite offsets');
}
for (const file of fs.readdirSync(dir).filter(name => name.endsWith('.json') && name !== 'index.json'))
  assert(index.entries.some(entry => entry.path.replace(/^\.\//, '') === file), 'recipe file not listed in index: ' + file);
console.log(`Clothing fit recipe library OK: ${index.entries.length} recipe(s).`);
