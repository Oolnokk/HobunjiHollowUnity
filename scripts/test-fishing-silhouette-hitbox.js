const assert = require('node:assert/strict');
const fs = require('node:fs');

const fishing = fs.readFileSync('docs/js/fishing-minigame.js', 'utf8');
const catalog = fs.readFileSync('docs/js/fish-catalog.js', 'utf8');
const game = fs.readFileSync('docs/game.js', 'utf8');
const cameraConfig = fs.readFileSync('docs/config/scratchbones-config.js', 'utf8');

assert.doesNotMatch(fishing, /const colliderRadius\s*=\s*14/, 'Fishing must not regress to the old fixed center-circle collider.');
assert.match(fishing, /FISH_COLLISION_SWEEP_STEP_PX\s*=\s*0\.5/, 'Spear collision must sweep densely enough to avoid tunneling through thin silhouette pixels.');
assert.match(fishing, /hasMinigameSilhouetteCollisionMask/, 'Fishing must prefer FishCatalog final-presentation alpha collision when available.');
assert.match(fishing, /rotatedX\s*=\s*cosAngle\s*\*\s*relX\s*\+\s*sinAngle\s*\*\s*relY/, 'Collision must invert the rendered fish rotation before alpha lookup.');
assert.match(fishing, /localX\s*=\s*rotatedX\s*\/\s*visibleScaleX/, 'Collision must invert the rendered turnaround mirror\/squash before alpha lookup.');
assert.match(fishing, /getMinigamePresentationScale/, 'Core fallback collision must account for authored species X\/Y minigame scale.');
assert.match(fishing, /get hitboxDebug\(\)/, 'Fishing must expose a mobile-friendly collision debug snapshot.');
assert.match(fishing, /HeldActionAnimations\?\.weaponThrowSpearSpin[\s\S]*HeldActionAnimations\?\.weaponThrowSpin/, 'Fishing Spear must use the spear-specific shared throw while Fishing Mace uses the generic hatchet Spin Throw.');
assert.match(fishing, /triggerFishingWeaponVisual[\s\S]*held:\s*true[\s\S]*heldSpinBasisDeg[\s\S]*heldSpinRevolutions/, 'Fishing must hold the shared thrown-weapon Windup instead of its removed bespoke ready pose.');
assert.match(fishing, /releaseFishingWeaponHold\?\.\(\{ poseProgress \}\)/, 'The second fishing marker must release the held thrown timeline into Strike.');
assert.doesNotMatch(fishing, /fishingReadyPose|setFishThrowActive|setToolSwingDur\(0\.42\)/, 'Legacy fishing-only ready/chop animation plumbing must stay removed.');
assert.match(fishing, /FISHING_CAMERA_SIDE_TILES\s*=\s*0\.9[\s\S]*FISHING_CAMERA_BACK_TILES\s*=\s*0\.55[\s\S]*FISHING_CAMERA_RAISE_TILES\s*=\s*0\.5[\s\S]*FISHING_CAMERA_FOV_DEG\s*=\s*70/, 'Fishing camera must remain a tight side-diagonal high-FOV view with the requested half-tile world-Y lift.');
assert.match(fishing, /baselineVerticalDistance = Math\.tan\(baselineElevationRad\) \* horizontalDistance[\s\S]*raisedVerticalDistance = baselineVerticalDistance \+ FISHING_CAMERA_RAISE_TILES[\s\S]*Math\.atan2\(raisedVerticalDistance, horizontalDistance\)/, 'Fishing camera must add the 0.5-tile lift to camera Y while preserving its XZ placement.');
assert.match(fishing, /cameraX = Number\(playerPos\.x\) \+ rightX \* FISHING_CAMERA_SIDE_TILES - forwardX \* FISHING_CAMERA_BACK_TILES/, 'Fishing camera must be positioned relative to player-to-water aim rather than a fixed world azimuth.');
assert.match(fishing, /setCameraTarget\(\{ position: new THREE\.Vector3\(anchorWorld\.x, anchorWorld\.y, anchorWorld\.z\) \}\)/, 'Fishing camera must keep looking at the exact selected water anchor.');
assert.match(fishing, /aimTarget:\s*fishingMinigame\?\.anchorWorld/, 'Fishing throw animation must stay pinned to the same selected water anchor after the camera moves.');
assert.match(fishing, /get cameraDebug\(\)[\s\S]*get throwAnimationDebug\(\)/, 'Fishing must expose on-demand camera and throw-animation debug snapshots for mobile testing.');
assert.match(fishing, /getCameraOrientationOffsets\?\.\(\)[\s\S]*setCameraOrientationOffsets\?\.\(\{ azimuthDeg: 0, angleDeg: 0 \}\)[\s\S]*setCameraOrientationOffsets\?\.\(_prevCameraOffsets\)/, 'Fishing must zero inherited free-look camera offsets while active and restore them on close.');
assert.match(cameraConfig, /\"fishing\"[\s\S]{0,260}\"ignoreGlobalZoom\": true/, 'Fishing camera config must opt out of the global gameplay zoom scale.');
assert.match(game, /const ignoreGlobalZoom = modeCfg\.ignoreGlobalZoom === true[\s\S]{0,160}effectiveZoomScale = ignoreGlobalZoom \? 1 : s_zoomScale/, 'Fixed-distance camera modes must use an unscaled authored world distance.');
assert.match(game, /if \(!ignoreGlobalZoom && !cutscenePreviewActive && !dialogueZoomActive\(\)\)/, 'Canopy zoom correction must not move the fixed fishing camera off its authored diagonal position.');
assert.match(game, /cameraModeConfig\(activeCameraMode\)\.ignoreGlobalZoom === true\) return true;/, 'Wheel zoom must be consumed during fishing without changing the gameplay zoom restored afterward.');

assert.match(catalog, /ctx\.getImageData\(0,0,w,h\)\.data/, 'FishCatalog must capture alpha from the exact curved frame it presents.');
assert.match(catalog, /MINIGAME_COLLISION_ALPHA_THRESHOLD=24/, 'Final silhouette collision must keep the authored anti-aliased edge threshold pinned.');
assert.match(catalog, /localX\/sx\+mask\.w\*0\.5/, 'FishCatalog hit testing must invert the visible CSS width scale.');
assert.match(catalog, /localY\/sy\+mask\.h\*0\.5/, 'FishCatalog hit testing must invert the visible CSS height scale.');
assert.match(catalog, /curvedCollisionMask=nextCollisionMask/, 'The collision mask must be paired with the newly encoded curved silhouette frame.');
assert.match(catalog, /minigameSilhouetteContainsLocalPoint/, 'FishCatalog must expose the final silhouette alpha sampler to Fishing.');

console.log('Fishing silhouette hitbox regression checks passed.');
