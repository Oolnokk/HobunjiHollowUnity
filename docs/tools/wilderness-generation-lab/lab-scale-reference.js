(() => {
  'use strict';

  // A simple, always-present human-scale reference figure standing in the
  // preview scene, so a snow/slush depth setting can be judged by eye
  // against a known height instead of guessing whether flat-looking ground
  // is actually bare or just very shallowly covered. Not the real game
  // avatar (a 2D billboard portrait driven by game.js, not portable into
  // this standalone lab) — just a plain capsule at an approximate real
  // player height (~1.7 world units, matching this codebase's roughly
  // 1-unit-per-meter tile convention), colored to stand out against snow.
  const Preview = window.WildernessLabPreview;
  const THREE = window.THREE;
  if (!Preview || !THREE || Preview.__scaleReferenceInstalled) return;
  Preview.__scaleReferenceInstalled = true;

  const FIGURE_HEIGHT = 1.7; // Approximate real player height in world units — adjust here if this turns out to be wrong for this codebase's actual scale.
  const FIGURE_RADIUS = 0.28;
  const HEAD_RADIUS = 0.2;
  const STAND_X = 50; // Matches lab-preview.js's default controls.target/camera focus, so the figure lands on generated terrain rather than empty space.
  const STAND_Z = 50;

  let figure = null;

  function buildFigure() {
    const group = new THREE.Group();
    group.name = 'wilderness_lab_scale_reference_figure';
    const bodyHeight = FIGURE_HEIGHT - HEAD_RADIUS * 2;
    const bodyGeo = new THREE.CylinderGeometry(FIGURE_RADIUS, FIGURE_RADIUS * 0.85, bodyHeight, 16);
    // Unlit and bright so it stays clearly visible regardless of scene
    // lighting/fog, and easy to pick out against the terrain's own colors.
    const material = new THREE.MeshBasicMaterial({ color: 0xff1493 });
    const body = new THREE.Mesh(bodyGeo, material);
    body.position.y = bodyHeight / 2;
    group.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(HEAD_RADIUS, 16, 12), material);
    head.position.y = bodyHeight + HEAD_RADIUS;
    group.add(head);
    const label = document.createElement('canvas');
    label.width = 256; label.height = 64;
    const ctx = label.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 28px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`~${FIGURE_HEIGHT}u tall`, 128, 42);
    const labelSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(label), depthTest: false }));
    labelSprite.scale.set(1.1, 0.28, 1);
    labelSprite.position.y = FIGURE_HEIGHT + 0.35;
    labelSprite.renderOrder = 999;
    group.add(labelSprite);
    return group;
  }

  function isFigurePart(object) {
    let node = object;
    while (node) {
      if (node === figure) return true;
      node = node.parent;
    }
    return false;
  }

  function groundYAt(scene, x, z) {
    // Collect only real, visible meshes first rather than handing
    // raycaster.intersectObjects the raw (recursive) scene.children — this
    // lab's preview scene includes sprites/lines/helpers whose raycast()
    // implementations aren't all safe to call outside the normal render
    // loop (one threw reading matrixWorld off a null internal reference).
    const meshes = [];
    scene.traverse(node => {
      if (node?.isMesh && node.visible && !isFigurePart(node)) meshes.push(node);
    });
    const raycaster = new THREE.Raycaster();
    raycaster.set(new THREE.Vector3(x, 500, z), new THREE.Vector3(0, -1, 0));
    raycaster.far = 1000;
    let hits = [];
    try { hits = raycaster.intersectObjects(meshes, false); } catch (_) { hits = []; }
    return hits.length ? hits[0].point.y : 0;
  }

  function placeFigure() {
    try {
      const scene = [...(window.__wildernessLabScenes || [])][0];
      if (!scene) return;
      if (!figure) figure = buildFigure();
      if (figure.parent !== scene) scene.add(figure);
      const groundY = groundYAt(scene, STAND_X, STAND_Z);
      figure.position.set(STAND_X, groundY, STAND_Z);
    } catch (error) {
      console.error('[WildernessLab] scale reference figure placement failed:', error);
    }
  }

  const previousRenderWorkspace = Preview.renderWorkspace.bind(Preview);
  Preview.renderWorkspace = (...args) => {
    const result = previousRenderWorkspace(...args);
    placeFigure();
    return result;
  };

  const previousRebuildWinter = typeof Preview.rebuildWinter === 'function' ? Preview.rebuildWinter.bind(Preview) : null;
  if (previousRebuildWinter) {
    Preview.rebuildWinter = (...args) => {
      const result = previousRebuildWinter(...args);
      placeFigure();
      return result;
    };
  }
})();
