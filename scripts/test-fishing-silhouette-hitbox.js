const assert = require('node:assert/strict');
const fs = require('node:fs');

const fishing = fs.readFileSync('docs/js/fishing-minigame.js', 'utf8');
const catalog = fs.readFileSync('docs/js/fish-catalog.js', 'utf8');

assert.doesNotMatch(fishing, /const colliderRadius\s*=\s*14/, 'Fishing must not regress to the old fixed center-circle collider.');
assert.match(fishing, /FISH_COLLISION_SWEEP_STEP_PX\s*=\s*0\.5/, 'Spear collision must sweep densely enough to avoid tunneling through thin silhouette pixels.');
assert.match(fishing, /hasMinigameSilhouetteCollisionMask/, 'Fishing must prefer FishCatalog final-presentation alpha collision when available.');
assert.match(fishing, /rotatedX\s*=\s*cosAngle\s*\*\s*relX\s*\+\s*sinAngle\s*\*\s*relY/, 'Collision must invert the rendered fish rotation before alpha lookup.');
assert.match(fishing, /localX\s*=\s*rotatedX\s*\/\s*visibleScaleX/, 'Collision must invert the rendered turnaround mirror\/squash before alpha lookup.');
assert.match(fishing, /getMinigamePresentationScale/, 'Core fallback collision must account for authored species X\/Y minigame scale.');
assert.match(fishing, /get hitboxDebug\(\)/, 'Fishing must expose a mobile-friendly collision debug snapshot.');

assert.match(catalog, /ctx\.getImageData\(0,0,w,h\)\.data/, 'FishCatalog must capture alpha from the exact curved frame it presents.');
assert.match(catalog, /MINIGAME_COLLISION_ALPHA_THRESHOLD=24/, 'Final silhouette collision must keep the authored anti-aliased edge threshold pinned.');
assert.match(catalog, /localX\/sx\+mask\.w\*0\.5/, 'FishCatalog hit testing must invert the visible CSS width scale.');
assert.match(catalog, /localY\/sy\+mask\.h\*0\.5/, 'FishCatalog hit testing must invert the visible CSS height scale.');
assert.match(catalog, /curvedCollisionMask=nextCollisionMask/, 'The collision mask must be paired with the newly encoded curved silhouette frame.');
assert.match(catalog, /minigameSilhouetteContainsLocalPoint/, 'FishCatalog must expose the final silhouette alpha sampler to Fishing.');

console.log('Fishing silhouette hitbox regression checks passed.');
