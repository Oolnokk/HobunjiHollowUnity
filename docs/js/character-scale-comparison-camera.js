// Aspect-aware framing and direct tap/click picking for the deliberately wide
// full-character scale lineup.
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

  function installPicking() {
    const canvas = document.getElementById('view3d');
    if (!canvas || canvas.dataset.fullScaleRayPick === '1') return !!canvas;
    canvas.dataset.fullScaleRayPick = '1';
    let down = null;
    canvas.addEventListener('pointerdown', event => {
      if (document.body.dataset.animationAuthorMode !== 'scale-compare') return;
      down = { id: event.pointerId, x: event.clientX, y: event.clientY };
    });
    canvas.addEventListener('pointerup', event => {
      if (document.body.dataset.animationAuthorMode !== 'scale-compare' || !down || down.id !== event.pointerId) {
        down = null;
        return;
      }
      const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
      down = null;
      if (moved > 8 || typeof state === 'undefined' || typeof animationAuthor === 'undefined' || !state.three?.ready) return;
      const THREE = state.three.THREE;
      const camera = state.three.camera;
      if (!THREE || !camera) return;
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const pointer = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -(((event.clientY - rect.top) / rect.height) * 2 - 1),
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(pointer, camera);
      let best = null;
      for (const actor of animationAuthor.actors || []) {
        const target = actor.visualOffset || actor.model || actor.root;
        const hit = target ? raycaster.intersectObject(target, true)[0] : null;
        if (hit && (!best || hit.distance < best.distance)) best = { actor, distance: hit.distance };
      }
      if (best?.actor?.id) selectAnimationActor(best.actor.id);
    });
    return true;
  }

  let attempts = 0;
  const timer = setInterval(() => {
    if (installPicking() || ++attempts >= 600) clearInterval(timer);
  }, 50);
  installPicking();
})();
