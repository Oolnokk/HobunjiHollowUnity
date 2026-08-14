// Replaces procedural heftroot plants with one authored 2D PNG billboard per crop tile.
//
// game.js still owns heftroot crop growth, tile placement, ready-state bobbing,
// and its legacy three-plant wrapper. This bridge uses that existing builder
// seam but collapses the old three 3D sub-plants into one centered PNG plane;
// needlegrain remains fully procedural.
(() => {
  'use strict';

  if (window.HobunjiHeftrootBillboardBridge) return;

  const THREE = window.THREE; // Used for the authored plane geometry/material and camera-facing quaternion math.
  const foliage = window.FoliageGenerator; // Used to replace only the existing heftroot mesh factory consumed by game.js.
  if (!THREE || !foliage?.buildHeftrootMesh) return;

  const BILLBOARD_PATH = 'assets/objectsprites/heftroot.png'; // Used as the planted heftroot world sprite source.
  const SYNTHETIC_COL_STEP = 127; // Matches game.js's seed-only offset for the second/third legacy heftroot cluster members.
  const SYNTHETIC_ROW_STEP = 61; // Matches game.js's seed-only row offset; farm coordinates themselves are only 36x26.
  const PRIMARY_OFFSET_X = -0.20; // Matches game.js's first legacy cluster-member X offset so the single replacement plane can cancel it.
  const PRIMARY_OFFSET_Z = 0.14; // Matches game.js's first legacy cluster-member Z offset so the single replacement plane can cancel it.
  const planes = new Set(); // Used to keep every live heftroot plane facing the active camera at render time.
  const cameraWorldQ = new THREE.Quaternion(); // Reused each render to avoid allocating one camera quaternion per crop plane.
  const parentWorldQ = new THREE.Quaternion(); // Reused to convert the camera world rotation into each plane's local parent space.
  let sharedTexture = null; // Used so every planted heftroot shares one texture request/cache entry.
  let sharedMaterial = null; // Used so all heftroot billboards share one transparent unlit material.
  let authoredAspect = 1; // Used to preserve the PNG's natural width/height ratio without stretching it square.

  function applyAuthoredAspect() {
    for (const plane of planes) {
      if (!plane?.scale) continue;
      plane.scale.x = authoredAspect;
      plane.scale.y = 1;
      plane.scale.z = 1;
    }
  }

  function ensureMaterial() {
    if (sharedMaterial) return sharedMaterial;
    const loader = new THREE.TextureLoader(); // Used to load the same object-sprite asset path convention as held/inventory crop art.
    sharedTexture = loader.load(
      BILLBOARD_PATH,
      texture => {
        const width = Math.max(1, Number(texture.image?.naturalWidth || texture.image?.width) || 1); // Used to derive the authored sprite aspect once image dimensions exist.
        const height = Math.max(1, Number(texture.image?.naturalHeight || texture.image?.height) || 1); // Used with width to keep the billboard proportional.
        authoredAspect = width / height;
        if (THREE.sRGBEncoding !== undefined) texture.encoding = THREE.sRGBEncoding;
        texture.needsUpdate = true;
        applyAuthoredAspect();
      },
      undefined,
      error => window.__farmLog?.(`[crop-art] failed to load heftroot billboard: ${error?.message || error || 'unknown error'}`, 'warn'),
    );
    sharedMaterial = new THREE.MeshBasicMaterial({
      map: sharedTexture,
      color: 0xffffff,
      transparent: true,
      alphaTest: 0.04,
      side: THREE.DoubleSide,
      depthWrite: true,
    });
    return sharedMaterial;
  }

  function buildHeftrootBillboard() {
    const group = new THREE.Group(); // Used to preserve the group shape/transform contract expected by game.js's heftroot cluster builder.
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), ensureMaterial()); // Used as the single authored 2D heftroot crop visual.
    plane.scale.set(authoredAspect, 1, 1);
    plane.position.set(-PRIMARY_OFFSET_X, 0, -PRIMARY_OFFSET_Z);
    plane.castShadow = false;
    plane.receiveShadow = false;
    plane.layers?.enable?.(1);
    plane.userData.hobunjiCropSpriteKey = 'heftroot';
    plane.userData.hobunjiHeftrootBillboard = true;
    // The plane remains centered at local Y=0. game.js places the outer foliage
    // wrapper at the soil surface, so the root image naturally straddles that
    // surface instead of floating above it.
    group.add(plane);
    planes.add(plane);
    return group;
  }

  function isSyntheticClusterSeed(col, row) {
    // game.js calls buildHeftrootMesh three times per crop: the real farm tile,
    // then +127/+61 and +254/+122 solely to vary procedural RNG. Those latter
    // coordinates can never be real farm tiles (farm grid is 36x26), so return
    // empty groups for them rather than drawing duplicate copies of the PNG.
    return Number(col) >= SYNTHETIC_COL_STEP || Number(row) >= SYNTHETIC_ROW_STEP;
  }

  const originalBuildHeftrootMesh = foliage.buildHeftrootMesh.bind(foliage); // Preserved only for diagnostics/fallback inspection; needlegrain and every other foliage builder are untouched.
  foliage.buildHeftrootMesh = function authoredHeftrootBillboardMesh(_growth01, col, row) {
    if (isSyntheticClusterSeed(col, row)) return new THREE.Group();
    return buildHeftrootBillboard();
  };

  function faceBillboards(scene, camera) {
    if (!camera) return;
    if (typeof camera.getWorldQuaternion === 'function') camera.getWorldQuaternion(cameraWorldQ);
    else if (camera.quaternion) cameraWorldQ.copy(camera.quaternion);
    else return;

    for (const plane of [...planes]) {
      let root = plane; // Used to detect harvested/rebuilt crop groups that are no longer attached to the active render scene.
      while (root?.parent) root = root.parent;
      if (!plane?.parent || root !== scene) {
        planes.delete(plane);
        continue;
      }
      // game.js may rotate the outer ripe-crop group. Convert the camera's
      // world quaternion into this plane's local parent space so the PNG stays
      // a true billboard even while the crop wrapper itself rotates/bobs.
      if (typeof plane.parent.getWorldQuaternion === 'function') {
        plane.parent.getWorldQuaternion(parentWorldQ);
        plane.quaternion.copy(parentWorldQ).invert().multiply(cameraWorldQ);
      } else {
        plane.quaternion.copy(cameraWorldQ);
      }
    }
  }

  function installRenderHook() {
    const prototype = THREE.WebGLRenderer?.prototype; // Used as the shared synchronous render boundary made hookable by combat-config-loader.
    if (!prototype || prototype.__hobunjiHeftrootBillboardHooked || typeof prototype.render !== 'function') return;
    const previousRender = prototype.render; // Used to preserve crop-sprite/presentation and every earlier renderer wrapper in the chain.
    prototype.render = function heftrootBillboardRender(scene, camera, ...rest) {
      faceBillboards(scene, camera);
      return previousRender.call(this, scene, camera, ...rest);
    };
    prototype.__hobunjiHeftrootBillboardHooked = true;
  }

  installRenderHook();

  window.HobunjiHeftrootBillboardBridge = {
    getDebug: () => ({
      source: BILLBOARD_PATH,
      activePlanes: planes.size,
      aspect: authoredAspect,
      originalBuilderAvailable: typeof originalBuildHeftrootMesh === 'function',
    }),
  };
})();
