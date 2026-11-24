// Perception/Farmwork silhouette renderer. Owns mask materials, GPU resources,
// transient layer swaps and debug readback; no gameplay registries or mode state.
(() => {
  'use strict';
  function create(THREE, COLORS) {
    const LAYER = globalThis.HobunjiRenderLayers?.PERCEPTION_MODE ?? 25; // Shares bit 25 with held-object-render-order.js's transient PORTRAIT_WATER_MASK; see js/render-layers.js.
    const maskMaterials = new WeakMap(); // source material -> Map(category -> MeshBasicMaterial)
    let maskRT = null;
    let postScene = null, postCamera = null, postMaterial = null;
    let lastRenderer = null; // Used only by explicit diagnostic mask readback.

    function sourceMap(material) {
      return material?.map || material?.uniforms?.map?.value || material?.uniforms?.tMap?.value || material?.uniforms?.uMap?.value
        || material?.uniforms?.uGrassTex?.value || null; // ReagentPlants' leaf silhouettes are custom grass shaders; preserve their texture alpha in the glow.
    }

    function maskMaterialFor(source, category, skinned, customColor = null, pairedAnimalFace = false) {
      let byCategory = maskMaterials.get(source);
      if (!byCategory) { byCategory = new Map(); maskMaterials.set(source, byCategory); }
      // Opposite-facing animal cards must keep their normal face culling even
      // in the depth-independent mask, otherwise both mirrored heads appear.
      const side = pairedAnimalFace ? (source.side ?? THREE().FrontSide) : THREE().DoubleSide; // Other targets retain their two-sided reveal.
      const key = category + ':' + (customColor || '') + (skinned ? ':s' : '') + ':' + side; // Separate colors, skinning and culling even with shared source materials.
      let mat = byCategory.get(key);
      const map = sourceMap(source);
      if (!mat) {
        mat = new (THREE().MeshBasicMaterial)({
          color: customColor || COLORS[category],
          map,
          alphaTest: map ? Math.max(0.35, Number(source?.alphaTest) || 0) : 0,
          transparent: false,
          depthTest: false, // Visible through obstacles.
          depthWrite: false,
          fog: false,
          side,
          skinning: !!skinned, // r128 needs this flag for SkinnedMesh.
          toneMapped: false,
        });
        // Flat category colour: keep only the source texture's alpha (for the
        // sprite cutout) instead of multiplying its colours in.
        mat.onBeforeCompile = shader => {
          shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>',
            '#ifdef USE_MAP\n  diffuseColor.a *= texture2D( map, vUv ).a;\n#endif');
        };
        mat.customProgramCacheKey = () => 'perception-mask';
        byCategory.set(key, mat);
      } else if (mat.map !== map) {
        // Sprite animations can swap the source's texture; follow it.
        const toggled = !mat.map !== !map;
        mat.map = map;
        mat.alphaTest = map ? Math.max(0.35, Number(source?.alphaTest) || 0) : 0;
        if (toggled) mat.needsUpdate = true;
      }
      return mat;
    }

    function maskSlot(source, category, skinned, color, pairedAnimalFace) {
      // A cached mesh may have become invisible or acquired non-rendering slots.
      // Use null for excluded slots; Three skips missing group materials.
      if (!source || source.visible === false || source.colorWrite === false || (source.transparent && source.opacity < 0.05)) return null;
      return maskMaterialFor(source, category, skinned, color, pairedAnimalFace);
    }

    // ── Rendering ────────────────────────────────────────────────────────
    function ensurePost() {
      if (postScene) return;
      const T = THREE();
      maskRT = new T.WebGLRenderTarget(1, 1, { minFilter: T.LinearFilter, magFilter: T.LinearFilter, format: T.RGBAFormat, depthBuffer: false });
      postScene = new T.Scene();
      postCamera = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      postMaterial = new T.ShaderMaterial({
        uniforms: { tMask: { value: null }, uTexel: { value: new T.Vector2(1, 1) }, uTime: { value: 0 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        // Inside a silhouette: a soft pulsing tint. Just outside: a bright
        // glow edge that fades over a few mask texels.
        fragmentShader: `
          uniform sampler2D tMask; uniform vec2 uTexel; uniform float uTime;
          varying vec2 vUv;
          void main() {
            vec4 c = texture2D(tMask, vUv);
            if (c.a > 0.5) { gl_FragColor = vec4(c.rgb, 0.34 + 0.08 * sin(uTime * 3.0)); return; }
            float best = 0.0; vec3 col = vec3(0.0);
            for (int i = 0; i < 8; i++) {
              float ang = float(i) * 0.7853982;
              vec2 dir = vec2(cos(ang), sin(ang)) * uTexel;
              for (int r = 1; r <= 3; r++) {
                vec4 s = texture2D(tMask, vUv + dir * float(r));
                float w = s.a * (r == 1 ? 1.0 : (r == 2 ? 0.85 : 0.45));
                if (w > best) { best = w; col = s.rgb; }
              }
            }
            if (best <= 0.01) discard;
            gl_FragColor = vec4(col, best);
          }
        `,
        transparent: true, depthTest: false, depthWrite: false,
      });
      const quad = new T.Mesh(new T.PlaneGeometry(2, 2), postMaterial);
      quad.frustumCulled = false;
      postScene.add(quad);
    }

    const _size = { v: null };
    const _clear = { color: null };
    const seen = new Set(); // Reused per overlay pass; cleared even when preparation or rendering fails.
    // Called by game.js's renderWorldPasses once the frame is on the canvas
    // (after the outline/painterly composite, or after the direct render with
    // outlines off), so post-processing never smears the highlight.
    function renderOverlay(renderer, scene, camera, targets) {
      if (!targets.length || !renderer || !scene || !camera) return 0;
      lastRenderer = renderer;
      ensurePost();
      const T = THREE();
      if (!_size.v) _size.v = new T.Vector2();
      if (!_clear.color) _clear.color = new T.Color();
      renderer.getDrawingBufferSize(_size.v);
      const w = Math.max(1, Math.floor(_size.v.x / 2)), h = Math.max(1, Math.floor(_size.v.y / 2));
      if (maskRT.width !== w || maskRT.height !== h) maskRT.setSize(w, h);
      postMaterial.uniforms.uTexel.value.set(1 / w, 1 / h);
      postMaterial.uniforms.uTime.value = performance.now() / 1000;

      const swapped = []; // One original state record per mesh, restored before compositing.
      const previousTarget = renderer.getRenderTarget();
      const previousAutoClear = renderer.autoClear;
      renderer.getClearColor(_clear.color);
      const previousClearAlpha = renderer.getClearAlpha();
      const previousMask = camera.layers.mask;
      const previousBackground = scene.background;
      const previousOverride = scene.overrideMaterial;
      const shadowMap = renderer.shadowMap;
      const previousShadowAuto = !!shadowMap?.autoUpdate;
      let maskStarted = false; // Renderer state is only mutated after mesh preparation succeeds.
      let maskRendered = false; // Composite only a complete mask.
      try {
        for (const target of targets) {
          for (const mesh of target.meshes || []) {
            if (!mesh.parent || seen.has(mesh)) continue;
            seen.add(mesh); // The first collected target owns the shared mesh's category.
            const original = mesh.material;
            if (!original) continue;
            const skinned = !!mesh.isSkinnedMesh;
            const face = mesh.userData?.hobunjiPlaneFace; // Survives weighted animal head-rig replacement.
            const pairedAnimalFace = face === 'front' || face === 'back';
            const replacement = Array.isArray(original)
              ? original.map(m => maskSlot(m, target.category, skinned, target.color, pairedAnimalFace))
              : maskSlot(original, target.category, skinned, target.color, pairedAnimalFace);
            if (!replacement || (Array.isArray(replacement) && !replacement.some(Boolean))) continue;
            const originalLayers = mesh.layers.mask; // Restore all layer bits exactly, including preexisting perception membership.
            const originalVisible = mesh.visible; // Distinguish authored-hidden and temporary batch-hidden meshes.
            swapped.push({ mesh, original, originalLayers, originalVisible });
            mesh.material = replacement;
            mesh.layers.enable(LAYER);
            if (originalVisible === false && mesh.userData?.hobunjiDrawProxyHidden === true) mesh.visible = true;
          }
        }
        if (!swapped.length) return 0;
        maskStarted = true;
        scene.background = null;
        scene.overrideMaterial = null;
        if (shadowMap?.enabled) shadowMap.autoUpdate = false;
        renderer.setRenderTarget(maskRT);
        renderer.setClearColor(0x000000, 0);
        renderer.clear(true, false, false);
        renderer.autoClear = false;
        camera.layers.set(LAYER);
        renderer.render(scene, camera);
        maskRendered = true;
      } finally {
        // Protect preparation as well as drawing: a material/texture failure
        // halfway through the swaps must not corrupt the normal world render.
        for (const entry of swapped) {
          entry.mesh.material = entry.original;
          entry.mesh.layers.mask = entry.originalLayers;
          entry.mesh.visible = entry.originalVisible;
        }
        seen.clear();
        if (maskStarted) {
          camera.layers.mask = previousMask;
          scene.background = previousBackground;
          scene.overrideMaterial = previousOverride;
          try {
            renderer.setClearColor(_clear.color, previousClearAlpha);
            renderer.setRenderTarget(previousTarget);
            if (maskRendered) {
              postMaterial.uniforms.tMask.value = maskRT.texture;
              renderer.render(postScene, postCamera);
            }
          } finally {
            renderer.autoClear = previousAutoClear;
            if (shadowMap) shadowMap.autoUpdate = previousShadowAuto;
            renderer.setRenderTarget(previousTarget);
          }
        }
      }
      return swapped.length;
    }

    // Dev/test only: reads back the last silhouette mask and counts covered texels by colour.
    function debugMaskCoverage(targets) {
      if (!lastRenderer || !maskRT) return null;
      const w = maskRT.width, h = maskRT.height;
      const px = new Uint8Array(w * h * 4);
      lastRenderer.readRenderTargetPixels(maskRT, 0, 0, w, h, px);
      const out = { width: w, height: h, covered: 0, byColor: {}, bbox: null };
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] < 128) continue;
        out.covered++;
        const x = (i / 4) % w, y = h - 1 - Math.floor(i / 4 / w); // Top-left origin, mask texels (half the canvas resolution).
        const bb = out.bbox || (out.bbox = { x0: x, y0: y, x1: x, y1: y });
        bb.x0 = Math.min(bb.x0, x); bb.y0 = Math.min(bb.y0, y); bb.x1 = Math.max(bb.x1, x); bb.y1 = Math.max(bb.y1, y);
        const key = `${px[i]},${px[i + 1]},${px[i + 2]}`;
        out.byColor[key] = (out.byColor[key] || 0) + 1;
      }
      out.targets = targets.map(t => ({
        category: t.category, dist: Math.round(t.dist * 10) / 10,
        meshes: (t.meshes || []).slice(0, 6).map(m => {
          const mat = Array.isArray(m.material) ? m.material[0] : m.material;
          return { type: m.type, mat: mat?.type, map: !!sourceMap(mat), alphaTest: mat?.alphaTest, attached: !!m.parent, visible: m.visible };
        }),
      }));
      return out;
    }

    return Object.freeze({ renderOverlay, debugMaskCoverage });
  }
  window.PerceptionMaskRenderer = Object.freeze({ create });
})();
