// Replaces procedural heftroot plants with authored 2D PNG billboards.
//
// game.js still owns heftroot crop growth, tile placement, ready-state bobbing,
// and its existing three-plant cluster. This bridge only swaps the leaf/tuber
// mesh factory that each cluster member uses; needlegrain remains procedural.
(() => {
  'use strict';

  if (window.HobunjiHeftrootBillboardBridge) return;

  const THREE = window.THREE; // Used for the authored plane geometry/material and camera-facing quaternion math.
  const foliage = window.FoliageGenerator; // Used to replace only the existing heftroot mesh factory consumed by game.js.
  if (!THREE || !foliage?.buildHeftrootMesh) return;

  const BILLBOARD_PATH = 'assets/objectsprites/heftroot.png'; // Used as the planted heftroot world sprite source.
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
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), ensureMaterial()); // Used as the actual authored 2D heftroot plant.
    plane.scale.set(authoredAspect, 1, 1);
    plane.castShadow = false;
    plane.receiveShadow = false;
    plane.layers?.enable?.(1);
    plane.userData.hobunjiCropSpriteKey = 'heftroot';
    plane.userData.hobunjiHeftrootBillboard = true;
    // Keep the plane centered at local Y=0. game.js places the outer foliage
    // group at the soil surface, so the authored root sprite naturally straddles
    // that surface rather than floating above it.
    group.add(plane);
    planes.add(plane);
    return group;
  }

  const originalBuildHeftrootMesh = foliage.buildHeftrootMesh.bind(foliage); // Preserved only for diagnostics/fallback inspection; needlegrain and every other foliage builder are untouched.
  foliage.buildHeftrootMesh = function authoredHeftrootBillboardMesh() {
    return buildHeftrootBillboard();
  };

  function faceBillboards(camera) {
    if (!camera) return;
    if (typeof camera.getWorldQuaternion === 'function') camera.getWorldQuaternion(cameraWorldQ);
    else if (camera.quaternion) cameraWorldQ.copy(camera.quaternion);
    else return;

    for (const plane of planes) {
      if (!plane?.parent) {
        planes.delete(plane);
        continue;
      }
      // game.js may rotate the outer ripe-crop group. Convert the camera's
      // world quaternion into this plane's local parent space so the PNG stays
      // a true billboard even while the cluster itself rotates/bobs.
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
      faceBillboards(camera);
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
