// Aspect-aware framing for the deliberately very wide full-character scale lineup.
(() => {
  'use strict';
  if (!/\/tools\/animation-author\/(?:index\.html)?$/.test(location.pathname)) return;
  if (typeof frameAllAnimationActors !== 'function') return;
  if (frameAllAnimationActors.__hobunjiFullScaleAspectAware) return;
  const base = frameAllAnimationActors;
  const wrapped = function fullScaleAspectAwareFrame(view = 'angle') {
    if (document.body.dataset.animationAuthorMode !== 'scale-compare') return base(view);
    if (typeof state === 'undefined' || typeof animationAuthor === 'undefined' || !state.three?.ready) return base(view);
    const THREE = state.three.THREE;
    const camera = state.three.camera;
    if (!THREE || !camera) return base(view);
    const box = new THREE.Box3();
    for (const actor of animationAuthor.actors || []) box.expandByObject(actor.visualOffset || actor.model || actor.root);
    const chair = state.three.scene?.getObjectByName?.('FullScaleReference_chairSimple');
    if (chair) box.expandByObject(chair);
    if (box.isEmpty()) return base(view);

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const canvas = document.getElementById('view3d');
    const aspect = Math.max(0.1, Number(camera.aspect) || ((canvas?.clientWidth || 1) / Math.max(1, canvas?.clientHeight || 1)));
    const verticalFov = THREE.MathUtils.degToRad(Number(camera.fov) || 50);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);
    const halfWidth = size.x / 2 + 0.35;
    const halfHeight = size.y / 2 + 0.3;
    const byWidth = halfWidth / Math.max(0.01, Math.tan(horizontalFov / 2));
    const byHeight = halfHeight / Math.max(0.01, Math.tan(verticalFov / 2));
    const distance = Math.max(1.6, byWidth, byHeight) * 1.12 + size.z / 2;
    const target = center.clone();
    target.y = Math.max(center.y, size.y * 0.42);
    camera.position.set(center.x, target.y + Math.min(0.2, size.y * 0.08), center.z + distance);
    camera.lookAt(target);
    state.three.controls?.target.copy(target);
    state.three.controls?.update();
  };
  wrapped.__hobunjiFullScaleAspectAware = true;
  frameAllAnimationActors = wrapped;
})();
