// Replaces procedural heftroot plants with authored 2D PNG billboards.
//
// game.js still owns heftroot crop growth, tile placement, ready-state motion,
// and its legacy three-plant triangle wrapper. This bridge now preserves all
// three of those wrapper members instead of collapsing them into one centered
// billboard, so the authored PNG follows the same clustered layout the old 3D
// heftroot meshes used.
(() => {
  'use strict';

  if (window.HobunjiHeftrootBillboardBridge) return;

  const THREE = window.THREE; // Used for the authored plane geometry/material and camera-facing quaternion math.
  const foliage = window.FoliageGenerator; // Used to replace only the existing heftroot mesh factory consumed by game.js.
  if (!THREE || !foliage?.buildHeftrootMesh) return;

  const BILLBOARD_PATH = 'assets/objectsprites/heftroot.png'; // Used as the planted heftroot world sprite source.
  const BILLBOARD_SCALE = 0.5625; // Used to make each clustered heftroot 25% smaller than the previous 0.75-scale billboard (0.75 * 0.75).
  const planes = new Set(); // Used to keep every live heftroot plane facing the active camera at render time.
  const cameraWorldQ = new THREE.Quaternion(); // Reused each render to avoid allocating one camera quaternion per crop plane.
  const parentWorldQ = new THREE.Quaternion(); // Reused to convert the camera world rotation into each plane's local parent space.
  let sharedTexture = null; // Used so every planted heftroot shares one texture request/cache entry.
  let sharedMaterial = null; // Used so all heftroot billboards share one transparent unlit material.
  let authoredAspect = 1; // Used to preserve the PNG's natural width/height ratio without stretching it square.

  function applyAuthoredAspect() {
    for (const plane of planes) {
      if (!plane?.scale) continue;
      plane.scale.x = authoredAspect * BILLBOARD_SCALE;
      plane.scale.y = BILLBOARD_SCALE;
      plane.scale.z = BILLBOARD_SCALE;
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
    const group = new THREE.Group(); // Used to preserve the group shape/transform contract expected by game.js's three-member heftroot cluster builder.
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), ensureMaterial()); // Used as one authored 2D heftroot crop visual; game.js supplies the triangle offset for this member.
    plane.scale.set(authoredAspect * BILLBOARD_SCALE, BILLBOARD_SCALE, BILLBOARD_SCALE);
    plane.position.set(0, 0, 0); // Used to retain game.js's legacy per-member triangle offsets instead of cancelling the first one back to tile center.
    plane.castShadow = false;
    plane.receiveShadow = false;
    plane.layers?.enable?.(1);
    plane.userData.hobunjiCropSpriteKey = 'heftroot';
    plane.userData.hobunjiCropRootKey = 'heftroot'; // Used by the shared crop presentation layer to anchor the outer crop wrapper to soil instead of flood-water height.
    plane.userData.hobunjiHeftrootBillboard = true;
    group.userData.hobunjiCropRootKey = 'heftroot'; // Used so presentation can discover the crop even before descending to the plane.
    // The plane remains centered at local Y=0. game.js places the outer foliage
    // wrapper at the soil/water-derived crop base; crop-billboard-presentation
    // removes the water lift immediately before draw so flooding submerges it.
    group.add(plane);
    planes.add(plane);
    return group;
  }

  const originalBuildHeftrootMesh = foliage.buildHeftrootMesh.bind(foliage); // Preserved only for diagnostics/fallback inspection; needlegrain and every other foliage builder are untouched.
  foliage.buildHeftrootMesh = function authoredHeftrootBillboardMesh(_growth01, _col, _row) {
    // game.js deliberately calls this factory three times using synthetic seed
    // coordinates. Keep all three calls visible: their parent wrapper already
    // positions them in the old 3D heftroot triangle.
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
      // world quaternion into this plane's local parent space so every member
      // of the three-plant cluster stays a true billboard.
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
      scale: BILLBOARD_SCALE,
      clusterCount: 3,
      activePlanes: planes.size,
      aspect: authoredAspect,
      originalBuilderAvailable: typeof originalBuildHeftrootMesh === 'function',
    }),
  };
})();
