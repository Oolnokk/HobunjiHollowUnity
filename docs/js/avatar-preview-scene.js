// Shared single-avatar Three.js preview scene bootstrap.
//
// Every PNG-plane avatar editor needs the same handful of things: a
// WebGLRenderer/Scene/PerspectiveCamera/OrbitControls tuple, a couple of
// lights, an optional ground grid, and a group to hold whatever
// PNGPlaneAvatar.buildSinglePlaneAvatarModel() returns. Before this module
// existed, character-studio, world-popup-editor, and the animation editors
// each hand-rolled a near-identical copy of that setup — and diverged on the
// one thing that actually matters: which Three.js build they load.
//
// The Attack Animation Editor (the one editor whose avatar preview has
// always rendered correctly) pins the exact same Three.js build the live
// game uses. This module does the same by going through
// PNGPlaneAvatar.loadThreeModules(), which now resolves to that pinned
// build (see SCRATCHBONES_CONFIG.game.assets.pngPlaneAvatar.threeModuleUrl
// in scratchbones-config.js) — so every caller of this module automatically
// stays on the proven-working version instead of each tool guessing its own.
(function () {
  'use strict';

  function cfg() {
    return window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar || {};
  }

  // options:
  //   canvas             - required <canvas> element to render into.
  //   antialias/alpha/preserveDrawingBuffer - WebGLRenderer flags (defaults match every existing caller).
  //   backgroundColor     - THREE.Color-compatible scene background (default matches the studio tools).
  //   fovDeg              - camera vertical FOV (default from config, then 45).
  //   cameraDistance       - default distance used by the built-in front/angle/side/back presets.
  //   cameraPresets        - override the [x,y,z] camera position per named view.
  //   initialView          - view name applied once setup finishes (default 'angle').
  //   grid (bool)          - set false to skip the ground GridHelper.
  //   gridY                - grid vertical offset (default -0.55, matching the existing studio previews).
  //   controls (bool)      - set false to skip OrbitControls even if the module loaded.
  //   holderName           - name for the Group that setAvatar() populates.
  //   modelWidth/modelHeight - default square prism size passed to buildSinglePlaneAvatarModel
  //                            when setAvatar()'s own options omit it. Defaults to the game's
  //                            real avatar scale (worldModelWidth), matching what the Attack
  //                            Animation Editor previews — override per call if a tool wants the
  //                            generic design-tool scale instead.
  //   onFrame(nowMs)        - optional per-frame callback invoked before each render.
  async function create(options = {}) {
    const canvas = options.canvas;
    if (!canvas) throw new Error('AvatarPreviewScene.create requires options.canvas.');
    if (!window.PNGPlaneAvatar) throw new Error('AvatarPreviewScene requires png-plane-avatar.js to be loaded first.');

    const modules = await window.PNGPlaneAvatar.loadThreeModules();
    const THREE = modules.THREE;
    const c = cfg();

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: options.antialias ?? true,
      alpha: options.alpha ?? true,
      preserveDrawingBuffer: options.preserveDrawingBuffer ?? true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    if ('outputColorSpace' in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;
    else if ('outputEncoding' in renderer) renderer.outputEncoding = THREE.sRGBEncoding;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(options.backgroundColor ?? 0x060c14);

    const camera = new THREE.PerspectiveCamera(options.fovDeg ?? c.previewCameraFovDeg ?? 45, 1, 0.01, 100);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x182435, 1.8));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
    keyLight.position.set(2.5, 3.5, 4);
    scene.add(keyLight);

    let grid = null;
    if (options.grid !== false) {
      grid = new THREE.GridHelper(c.previewGridSize || 5, c.previewGridDivisions || 10, 0x33538a, 0x1a2638);
      grid.position.y = options.gridY ?? -0.55;
      scene.add(grid);
    }

    let controls = null;
    if (modules.OrbitControls && options.controls !== false) {
      controls = new modules.OrbitControls(camera, canvas);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.target.set(0, 0, 0);
    }

    const avatarHolder = new THREE.Group();
    avatarHolder.name = options.holderName || 'avatar_preview_holder';
    scene.add(avatarHolder);

    const defaultModelSize = Number(options.modelWidth ?? c.worldModelWidth) || 0.9;
    let model = null;

    function setAvatar(frontCanvas, avatarOptions = {}) {
      if (model) {
        avatarHolder.remove(model);
        window.PNGPlaneAvatar.disposeAvatarModel(model);
        model = null;
      }
      if (!frontCanvas) return null;
      model = window.PNGPlaneAvatar.buildSinglePlaneAvatarModel(THREE, frontCanvas, {
        modelWidth: defaultModelSize,
        modelHeight: options.modelHeight ?? defaultModelSize,
        ...avatarOptions,
      });
      avatarHolder.add(model);
      return model;
    }

    function setCameraView(view) {
      const distance = Number(options.cameraDistance ?? c.previewCameraDistance) || 3.2;
      const presets = options.cameraPresets || {
        front: [0, distance * 0.12, distance],
        angle: [distance * 0.55, distance * 0.28, distance * 0.88],
        side: [distance, distance * 0.15, 0],
        back: [0, distance * 0.12, -distance],
      };
      const p = presets[view] || presets.angle;
      camera.position.set(p[0], p[1], p[2]);
      camera.lookAt(0, 0, 0);
      controls?.target.set(0, 0, 0);
      controls?.update();
      return p;
    }

    function resize() {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }

    let ticking = false;
    function frame(now) {
      if (!ticking) return;
      controls?.update();
      options.onFrame?.(now);
      renderer.render(scene, camera);
      requestAnimationFrame(frame);
    }
    function start() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(frame);
    }
    function stop() {
      ticking = false;
    }

    function dispose() {
      stop();
      if (model) window.PNGPlaneAvatar.disposeAvatarModel(model);
      renderer.dispose();
    }

    setCameraView(options.initialView || 'angle');
    resize();

    return {
      THREE,
      OrbitControls: modules.OrbitControls,
      renderer,
      scene,
      camera,
      controls,
      avatarHolder,
      grid,
      get model() {
        return model;
      },
      setAvatar,
      setCameraView,
      resize,
      start,
      stop,
      dispose,
    };
  }

  window.AvatarPreviewScene = { create };
})();
