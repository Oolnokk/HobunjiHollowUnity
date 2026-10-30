// Emissive glow orbs: the hazy glowing circles of the Tothal Blizzard enchantment, drawn ABOVE the day/night darkness, weather tint
// and fog so they pierce all of it. They belong to fake-light sources (userData.emissiveOrb, e.g. a Maskbound mask's eye glow); the
// source's ordinary fake-light aura is untouched and keeps surrounding the orb.
//
// The darkness tint, fog and light holes all live on the 2D lighting canvas, so anything drawn on a canvas stacked above it with an
// additive composite is unaffected by them. The game uses its own top canvas redrawn every browser frame (the lighting canvas is
// redrawn at a lower cadence); isolated viewports (Enemy Loadout Workshop) call drawOrbs() after their own lighting pass.
(function (global) {
  'use strict';

  const SCHEDULER_ID = 'emissive-light-orbs';
  const ORB_WORLD_RADIUS = 0.085; // Core orb radius in world units; the halo reaches about 2x this.

  const smoothstep = (edge0, edge1, value) => {
    const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  };

  // Lights flagged as emissive (the registry's own scene membership/visibility rules apply).
  function collect(scene) {
    const registry = global.FurnitureLightRegistry;
    if (!registry?.list || !scene) return [];
    return registry.list(scene).filter(light => light.userData?.emissiveOrb);
  }

  function worldAxis(object, column, target) {
    const e = object.matrixWorld.elements;
    target.x = e[column * 4]; target.y = e[column * 4 + 1]; target.z = e[column * 4 + 2];
    const length = Math.hypot(target.x, target.y, target.z) || 1;
    target.x /= length; target.y /= length; target.z /= length;
    return target;
  }

  const scratch = { position: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 }, right: { x: 1, y: 0, z: 0 }, camera: { x: 0, y: 0, z: 0 } };

  function colorOf(light) {
    const c = light.color || { r: 1, g: 1, b: 1 };
    return { r: Math.round(c.r * 255), g: Math.round(c.g * 255), b: Math.round(c.b * 255) };
  }

  function drawGlowCircle(ctx, x, y, radius, rgb, alpha) {
    const { r, g, b } = rgb;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(255,255,255,${alpha})`); // Hot white core.
    gradient.addColorStop(0.28, `rgba(${Math.min(255, r + 70)},${Math.min(255, g + 70)},${Math.min(255, b + 70)},${alpha * 0.82})`);
    gradient.addColorStop(0.62, `rgba(${r},${g},${b},${alpha * 0.3})`);
    gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawSparkle(ctx, x, y, radius, rgb, alpha, spin) {
    ctx.strokeStyle = `rgba(${Math.min(255, rgb.r + 90)},${Math.min(255, rgb.g + 90)},${Math.min(255, rgb.b + 90)},${alpha})`;
    ctx.lineWidth = Math.max(1, radius * 0.06);
    ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) { // Same three crossing strokes as the blizzard orb sprite.
      const angle = spin + i * Math.PI / 3;
      const dx = Math.cos(angle) * radius * 0.62, dy = Math.sin(angle) * radius * 0.62;
      ctx.beginPath(); ctx.moveTo(x - dx, y - dy); ctx.lineTo(x + dx, y + dy); ctx.stroke();
    }
  }

  // Draws every emissive light with additive blending onto ctx (already scaled to CSS pixels). projection needs worldToOverlay(x,y,z)
  // -> {x,y,visible} and a camera; opts.alpha scales everything (scene fades).
  function drawOrbs(ctx, projection, lights, timeMs = performance.now(), opts = {}) {
    if (!ctx || !projection?.worldToOverlay || !projection.camera || !lights?.length) return 0;
    const master = opts.alpha == null ? 1 : Math.max(0, Math.min(1, opts.alpha));
    if (master <= 0.002) return 0;
    const camera = projection.camera;
    camera.updateMatrixWorld?.();
    worldAxis(camera, 0, scratch.right);
    scratch.camera.x = camera.matrixWorld.elements[12]; scratch.camera.y = camera.matrixWorld.elements[13]; scratch.camera.z = camera.matrixWorld.elements[14];
    const seconds = timeMs / 1000;
    let drawn = 0;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const light of lights) {
      light.updateWorldMatrix?.(true, false);
      const e = light.matrixWorld.elements;
      const px = e[12], py = e[13], pz = e[14];
      // Only while the glowing face is toward the camera: the eye is painted on the front plane, so it must not shine through the skull.
      const faceNode = light.parent || light;
      faceNode.updateWorldMatrix?.(true, false);
      worldAxis(faceNode, 2, scratch.normal);
      const tx = scratch.camera.x - px, ty = scratch.camera.y - py, tz = scratch.camera.z - pz;
      const toCamera = Math.hypot(tx, ty, tz) || 1;
      const facing = (scratch.normal.x * tx + scratch.normal.y * ty + scratch.normal.z * tz) / toCamera;
      const visibility = smoothstep(-0.05, 0.3, facing) * master;
      if (visibility <= 0.01) continue;
      const centre = projection.worldToOverlay(px, py, pz);
      if (!centre?.visible) continue;
      const orbWorld = (Number(light.userData.emissiveOrb?.radius) || ORB_WORLD_RADIUS);
      const edge = projection.worldToOverlay(px + scratch.right.x * orbWorld, py + scratch.right.y * orbWorld, pz + scratch.right.z * orbWorld);
      const radius = Math.max(4, Math.hypot(edge.x - centre.x, edge.y - centre.y));
      const rgb = colorOf(light);
      const pulse = 0.86 + 0.14 * Math.sin(seconds * 2.3 + px * 7);
      drawGlowCircle(ctx, centre.x, centre.y, radius * 2.0 * pulse, rgb, 0.55 * visibility); // Soft outer halo.
      drawGlowCircle(ctx, centre.x, centre.y, radius * pulse, rgb, 0.95 * visibility); // Bright core orb.
      drawSparkle(ctx, centre.x, centre.y, radius * 1.15, rgb, 0.22 * visibility, seconds * 0.6); // Faint crossing strokes only; the glowing circles carry the look.
      drawn++;
    }
    ctx.restore();
    return drawn;
  }

  // ── Game overlay ──────────────────────────────────────────────────────
  let overlay = null; // { canvas, ctx, getProjection, getScene, getSceneFade }

  function ensureCanvas() {
    if (overlay.canvas) return overlay.canvas;
    const lighting = document.getElementById('lightingCanvas');
    if (!lighting?.parentNode) return null;
    const canvas = document.createElement('canvas');
    canvas.id = 'emissiveOrbCanvas';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:4;'; // One above the lighting canvas (z-index 3).
    lighting.parentNode.insertBefore(canvas, lighting.nextSibling);
    overlay.canvas = canvas;
    overlay.ctx = canvas.getContext('2d');
    return canvas;
  }

  function frame() {
    if (!overlay) return;
    const projection = overlay.getProjection?.();
    const scene = overlay.getScene?.();
    const lights = projection && scene ? collect(scene) : [];
    if (!lights.length && !overlay.canvas) return; // Nothing emissive has ever existed: do not create or touch a canvas.
    const canvas = ensureCanvas();
    if (!canvas) return;
    const rect = projection?.getThreeRect?.();
    if (rect?.width > 0) {
      const lighting = document.getElementById('lightingCanvas'); // Match the lighting canvas's backing size so both layers share one pixel grid.
      const wantW = lighting?.width || Math.round(rect.width * (global.devicePixelRatio || 1));
      const wantH = lighting?.height || Math.round(rect.height * (global.devicePixelRatio || 1));
      if (canvas.width !== wantW || canvas.height !== wantH) { canvas.width = wantW; canvas.height = wantH; }
      overlay.ctx.setTransform(canvas.width / rect.width, 0, 0, canvas.height / rect.height, 0, 0);
      overlay.ctx.clearRect(0, 0, rect.width, rect.height);
    }
    if (!lights.length) return;
    const fade = 1 - Math.max(0, Math.min(1, Number(projection.getSceneTransAlpha?.()) || 0)); // Scene fades-to-black take the glow with them.
    drawOrbs(overlay.ctx, projection, lights, performance.now(), { alpha: fade });
  }

  function installGameOverlay(options = {}) {
    if (overlay) return false;
    overlay = { canvas: null, ctx: null, getProjection: options.getProjection, getScene: options.getScene };
    global.RuntimeFrameScheduler?.register(SCHEDULER_ID, frame, {
      phase: 'post-game',
      owner: 'EmissiveLightOrbs',
      description: 'Draws emissive glow orbs above the lighting/fog canvas every browser frame.',
    });
    return true;
  }

  global.EmissiveLightOrbs = { collect, drawOrbs, installGameOverlay, orbWorldRadius: ORB_WORLD_RADIUS, _frame: frame };
})(window);
