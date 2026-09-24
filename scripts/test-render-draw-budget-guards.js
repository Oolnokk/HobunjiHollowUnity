// Guards two per-frame draw-call reductions that apply on every map/farm frame.
//
// 1. HeldObjectRenderOrder's scissored replay (depth rebuild, held overlay,
//    ground restore, foot-water composite) hides renderables whose bounds fall
//    entirely outside the scissor rectangle, so the extra passes stop
//    re-submitting the whole visible world's draw calls every frame.
// 2. Flat farm floor slabs do not cast into the sun's shadow map (they sit at
//    ground level and can only shade below it), which was ~half of the farm's
//    shadow-pass draw calls.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const held = read('docs/js/held-object-render-order.js');
const veg = read('docs/js/vegetation-crop-rendering.js');

assert.match(held, /function setReplayCullFrustum\(camera, rect, width, height\)/,
  'replay builds a sub-frustum from the scissor rectangle');
assert.match(held, /replayCulled = hideObjects\(collectReplayCulled\(scene, new Set\(scissorMeshes\)\)\)/,
  'scissored replays hide renderables outside the scissor sub-frustum, never the held/foot meshes that define it');
assert.match(held, /if \(replayCulled\) restoreVisibility\(replayCulled\);/,
  'culled renderables are restored in the replay finally block');
assert.match(held, /object\.frustumCulled === false \|\| object\.children\.length/,
  'only leaf renderables that three.js itself frustum-culls are eligible');
assert.match(held, /object\.isInstancedMesh \|\| object\.isSkinnedMesh/,
  'instanced/skinned meshes (bounded by base geometry only in r128) are never replay-culled');
assert.match(held, /setReplayCullEnabled:/, 'A/B debug switch stays exposed');

assert.match(veg, /function setFlatSlabShadowFlags\(mesh\) \{\s*mesh\.castShadow = false;\s*mesh\.receiveShadow = true;/,
  'flat floor slabs keep receiveShadow (terrain classification) but skip the shadow map');
assert.doesNotMatch(veg, /floorMesh\.castShadow = floorMesh\.receiveShadow = true/,
  'no flat slab path re-enables shadow casting');
assert.match(veg, /tile\.type === TileType\.ROCK \|\| tile\.type === TileType\.SHRUB \|\| tile\.type === TileType\.WEEDS\) mesh\.castShadow = mesh\.receiveShadow = true;/,
  'raised/fallback-vegetation tiles still cast shadows');

console.log('render draw-budget guard tests passed');
