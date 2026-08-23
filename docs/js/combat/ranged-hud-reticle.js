(() => {
  'use strict';

  if (typeof THREE === 'undefined') {
    console.error('ranged-hud-reticle.js requires THREE');
    return;
  }

  window.RangedHudReticle?.dispose?.();

  const RETICLE_URL = 'assets/hud/hud_reticle.png'; // Used by the world-space ranged HUD sight texture.
  const RETICLE_SOURCE_WIDTH_PX = 75; // Used as the authored hud_reticle.png reference width before the requested scale reduction.
  const RETICLE_SOURCE_HEIGHT_PX = 71; // Used as the authored hud_reticle.png reference height before the requested scale reduction.
  const RETICLE_SCALE = 0.75; // Used to render the reticle at 75% of its previous apparent HUD size.
  const RETICLE_WIDTH_PX = RETICLE_SOURCE_WIDTH_PX * RETICLE_SCALE; // Used to preserve a 56.25px apparent width across camera distances.
  const RETICLE_HEIGHT_PX = RETICLE_SOURCE_HEIGHT_PX * RETICLE_SCALE; // Used to preserve a 53.25px apparent height across camera distances.
  const RETICLE_FORWARD_WORLD = 0.7; // Used to hang the plane slightly beyond the player's depth on the screen-center aim ray.
  const RETICLE_PLAYER_ANCHOR_Y = 0.55; // Used to compare the ray against the same approximate height as ranged projectiles.
  const RETICLE_RENDER_ORDER = 1220; // Used to keep the spatial HUD marker above ordinary transparent world art.

  const centerNdc = new THREE.Vector2(0, 0); // Used to build the same screen-center camera ray every rendered frame.
  const centerRaycaster = new THREE.Raycaster(); // Used to string the reticle plane along the live screen-center ray.
  const playerWorld = new THREE.Vector3(); // Used to resolve the player's current world-space root position.
  const playerAnchor = new THREE.Vector3(); // Used to compare the aim ray against projectile-height space in front of the player.
  const toPlayerAnchor = new THREE.Vector3(); // Used to find the point on the camera ray nearest the player anchor.
  const reticleWorld = new THREE.Vector3(); // Used to store the reticle's current world position for rendering and debugging.

  let reticlePlane = null; // Used to reuse one THREE.PlaneGeometry mesh across frames and area changes.
  let reticleTexture = null; // Used to dispose the loaded authored texture cleanly if the helper is reloaded.
  let reticleMaterial = null; // Used to force every nontransparent authored pixel to pure white in the world-space plane.
  let activeScene = null; // Used to move the reticle plane between gameplay scenes without leaving stale copies behind.
  let lastCamera = null; // Used by manual refresh/debug snapshots between renderer calls.
  let lastRenderer = null; // Used to retain viewport sizing for constant apparent-pixel scaling.
  let lastRayDistance = null; // Used by mobile-friendly diagnostics to report where the plane hangs on the ray.
  let lastVisible = false; // Used by mobile-friendly diagnostics to report the latest rendered visibility state.
  let previousRender = null; // Used to restore THREE.WebGLRenderer.prototype.render if this helper is disposed/reloaded.
  let hookedRender = null; // Used to ensure dispose only restores the render function when this exact hook is still installed.

  function equippedRangedKey() {
    return window.RangedWeapons?.equippedRangedKey?.() || null;
  }

  function rangedWeaponDrawn() {
    const itemKey = equippedRangedKey(); // Uses the ranged subsystem's canonical equipment-slot lookup.
    const switchButton = document.getElementById('btnWeaponSwitch'); // Uses the existing combat switch's canonical in/out + melee/ranged presentation state.
    const combatWeaponOut = !!switchButton?.classList.contains('active');
    const rangedIsCurrentCombatTool = switchButton?.getAttribute('aria-label') === 'Switch to melee weapon';
    return !!itemKey && combatWeaponOut && rangedIsCurrentCombatTool;
  }

  function removeLegacyDomReticle() {
    document.getElementById('rangedHudReticle')?.remove();
  }

  function makeWhiteReticleMaterial(texture) {
    return new THREE.ShaderMaterial({
      uniforms: { map: { value: texture } },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D map;
        varying vec2 vUv;
        void main() {
          float alpha = texture2D(map, vUv).a;
          if (alpha <= 0.001) discard;
          gl_FragColor = vec4(1.0, 1.0, 1.0, alpha);
        }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
  }

  function createReticlePlane(texture) {
    reticleTexture?.dispose?.();
    reticleMaterial?.dispose?.();
    reticlePlane?.geometry?.dispose?.();
    reticlePlane?.parent?.remove?.(reticlePlane);

    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    reticleTexture = texture;
    reticleMaterial = makeWhiteReticleMaterial(texture);
    reticlePlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), reticleMaterial);
    reticlePlane.name = 'ranged_hud_reticle_plane';
    reticlePlane.visible = false;
    reticlePlane.frustumCulled = false;
    reticlePlane.renderOrder = RETICLE_RENDER_ORDER;
    reticlePlane.userData.isBillboard = true;
    reticlePlane.userData.isHudReticle = true;
  }

  function loadReticleTexture() {
    new THREE.TextureLoader().load(
      RETICLE_URL,
      texture => createReticlePlane(texture),
      undefined,
      () => console.error(`Ranged HUD reticle failed to load: ${RETICLE_URL}`),
    );
  }

  function gameplayRenderer(renderer) {
    const host = document.getElementById('threeContainer');
    const canvas = renderer?.domElement;
    return !!host && !!canvas && (canvas.parentElement === host || host.contains(canvas));
  }

  function attachToScene(scene) {
    if (!reticlePlane || !scene?.isScene) return false;
    if (activeScene !== scene || reticlePlane.parent !== scene) {
      reticlePlane.parent?.remove?.(reticlePlane);
      scene.add(reticlePlane);
      activeScene = scene;
    }
    return true;
  }

  function updateApparentScale(camera, renderer) {
    if (!reticlePlane || !camera || !renderer?.domElement) return;
    const viewportHeightPx = Math.max(1, renderer.domElement.getBoundingClientRect?.().height || renderer.domElement.clientHeight || 1); // Used to convert the requested apparent pixel size into world units.
    const distance = Math.max(0.001, camera.position.distanceTo(reticlePlane.position)); // Used to compensate perspective size attenuation at the reticle's actual depth.
    let worldPerPixel = 1 / viewportHeightPx; // Used as a safe fallback for unusual camera types.

    if (camera.isPerspectiveCamera) {
      const effectiveFovDeg = camera.getEffectiveFOV?.() || camera.fov || 42; // Used to include camera zoom in the perspective pixel-to-world conversion.
      const visibleWorldHeight = 2 * Math.tan(THREE.MathUtils.degToRad(effectiveFovDeg) * 0.5) * distance; // Used to compute the world span represented by the viewport at this depth.
      worldPerPixel = visibleWorldHeight / viewportHeightPx;
    } else if (camera.isOrthographicCamera) {
      const visibleWorldHeight = Math.abs((camera.top - camera.bottom) / (camera.zoom || 1)); // Used to keep the same apparent size if an orthographic gameplay camera is introduced.
      worldPerPixel = visibleWorldHeight / viewportHeightPx;
    }

    reticlePlane.scale.set(RETICLE_WIDTH_PX * worldPerPixel, RETICLE_HEIGHT_PX * worldPerPixel, 1);
  }

  function updateRayPosition(scene, camera, renderer) {
    if (!reticlePlane || !scene?.isScene || !camera) return false;
    const playerRoot = scene.getObjectByName?.('player_root') || null; // Uses the existing canonical player scene-root name rather than duplicating gameplay coordinates.
    if (!playerRoot) return false;

    camera.updateMatrixWorld?.(true);
    playerRoot.getWorldPosition(playerWorld);
    playerAnchor.copy(playerWorld);
    playerAnchor.y += RETICLE_PLAYER_ANCHOR_Y;

    centerRaycaster.setFromCamera(centerNdc, camera);
    const ray = centerRaycaster.ray;
    toPlayerAnchor.copy(playerAnchor).sub(ray.origin);
    const nearestPlayerDepth = toPlayerAnchor.dot(ray.direction); // Used to find where the screen-center ray passes closest to the player's projectile-height anchor.
    const nearFloor = Math.max(0.05, Number(camera.near) || 0.1) + 0.05;
    const rayDistance = Math.max(nearFloor, nearestPlayerDepth + RETICLE_FORWARD_WORLD); // Used to hang the plane a little farther down the ray than the player's depth.
    ray.at(rayDistance, reticleWorld);

    reticlePlane.position.copy(reticleWorld);
    reticlePlane.quaternion.copy(camera.quaternion);
    updateApparentScale(camera, renderer);
    lastRayDistance = rayDistance;
    return true;
  }

  function syncReticle(scene = lastCamera?.parent?.isScene ? lastCamera.parent : activeScene, camera = lastCamera, renderer = lastRenderer) {
    lastCamera = camera || lastCamera;
    lastRenderer = renderer || lastRenderer;

    if (!reticlePlane || !scene?.isScene || !camera || !renderer) {
      if (reticlePlane) reticlePlane.visible = false;
      lastVisible = false;
      return false;
    }

    if (!attachToScene(scene) || !rangedWeaponDrawn() || !updateRayPosition(scene, camera, renderer)) {
      reticlePlane.visible = false;
      lastVisible = false;
      return false;
    }

    reticlePlane.visible = true;
    lastVisible = true;
    return true;
  }

  function installRenderHook() {
    const proto = THREE.WebGLRenderer?.prototype;
    if (!proto?.render) return;
    previousRender = proto.render;
    hookedRender = function rangedHudReticleRenderHook(scene, camera) {
      if (gameplayRenderer(this)) {
        lastCamera = camera;
        lastRenderer = this;
        syncReticle(scene, camera, this);
      }
      return previousRender.apply(this, arguments);
    };
    proto.render = hookedRender;
  }

  function refresh() {
    return syncReticle(activeScene, lastCamera, lastRenderer);
  }

  function dispose() {
    const proto = THREE.WebGLRenderer?.prototype;
    if (proto && hookedRender && proto.render === hookedRender && previousRender) proto.render = previousRender;
    reticlePlane?.parent?.remove?.(reticlePlane);
    reticlePlane?.geometry?.dispose?.();
    reticleMaterial?.dispose?.();
    reticleTexture?.dispose?.();
    reticlePlane = null;
    reticleMaterial = null;
    reticleTexture = null;
    activeScene = null;
    lastVisible = false;
  }

  function init() {
    removeLegacyDomReticle();
    loadReticleTexture();
    installRenderHook();
  }

  window.RangedHudReticle = {
    refresh,
    dispose,
    snapshot: () => ({
      asset: RETICLE_URL,
      equippedRanged: equippedRangedKey(),
      drawn: rangedWeaponDrawn(),
      visible: lastVisible,
      billboardPlane: true,
      scaleFactor: RETICLE_SCALE,
      apparentSizePx: [RETICLE_WIDTH_PX, RETICLE_HEIGHT_PX],
      forwardWorld: RETICLE_FORWARD_WORLD,
      rayDistance: Number.isFinite(lastRayDistance) ? Math.round(lastRayDistance * 1000) / 1000 : null,
      worldPosition: reticlePlane ? {
        x: Math.round(reticlePlane.position.x * 1000) / 1000,
        y: Math.round(reticlePlane.position.y * 1000) / 1000,
        z: Math.round(reticlePlane.position.z * 1000) / 1000,
      } : null,
      latestChange: '75% white billboard PNG plane; visible only while ranged is drawn; hung slightly beyond player depth on the live screen-center ray.',
    }),
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
