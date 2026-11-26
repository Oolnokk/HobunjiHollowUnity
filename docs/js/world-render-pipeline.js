// World render pipeline (window.WorldRenderPipeline), extracted from game.js.
//
// This file owns WHAT IS DRAWN EACH FRAME AND IN WHICH ORDER for the gameplay
// renderer: the main colour pass, the outline passes and their materials, the
// offscreen targets, the composite, the reticle target highlight, and the list
// of render-scoped culls/batches that hide or merge objects for the duration of
// one frame. Read docs/architecture/visual-render-pipeline.md before changing
// pass order, layers or materials here.
//
// ── ONE FRAME, IN ORDER (renderFrame(now), called once per gameLoop frame) ──
//   1. Render scopes suspend, in SCOPES order (farm tile batches, zone prop
//      batches, NPC view cull, grass chunks, instanced-mesh cull, wilderness
//      distance cull). Each returns its own restore function.
//   2. RenderHooks.beginWorldFrame(): presentation hooks with scope 'frame'
//      (player body composer, crop billboards, NPC dance sway, ...) apply once
//      on the first render call below and are undone in step 9.
//   3. ActorRenderOcclusion.beginFrame(): covered/offscreen actors suppressed.
//   With outlines ON (default):
//   4. main     — activeScene -> mainRT (colour + depth/stencil). Held items,
//                 hands and feet are drawn by held-object-render-order.js's
//                 wrapper INSIDE this call (its "held replays").
//   5. pngDepth — PNG avatars' depth-only replay (layer PNG_OCCLUDER) so
//                 outlines behind sprites are hidden; then actor occlusion
//                 probes read that depth (no draw).
//   6. shell    — layer SHELL_OUTLINE with the inverted-hull material
//                 (held-object-render-order.js adds x-ray shells here).
//   7. target   — layer TARGET_HIGHLIGHT, farm scene, only with a reticle target.
//   8. mist     — Cloud Forest mist redraw over the outlines (when active).
//   9. seamId   — layer MATERIAL_SEAM_ID into edgeIdRT; off by default.
//  10. composite — mainRT -> canvas (OutlineCompositeMaterial); world text
//                 overlay is drawn by outline-render-performance.js after it.
//  11. Perception Mode overlay.
//   With outlines OFF: main pass straight to the canvas, probes, target pass,
//   Perception Mode.
//  12. finally: ActorRenderOcclusion.endFrame(), RenderHooks.endWorldFrame(),
//      scopes restore in reverse order — nothing render-only leaks into
//      gameplay, raycasts or the next frame.
//
// ── WHERE TO MAKE A VISUAL CHANGE ──
//   * Outline thickness/colours: docs/config/outline-rendering.json (applied
//     by applyOutlineRenderingConfig below, no shader recompile).
//   * Whether a mesh gets a shell outline: markShellOutline(obj) /
//     userData.noOutline. PNG planes never do (their art carries its ink).
//   * Render-time pose/transform tweaks: register a RenderHooks hook
//     (js/render-hooks.js), never wrap renderer.render.
//   * Hide/merge objects for drawing only: registerRenderScope() below.
//   * Layer numbers: js/render-layers.js (window.HobunjiRenderLayers).
//
// ── DEBUGGING ──
//   WorldRenderPipeline.snapshot()       cheap counters for the last frame.
//   WorldRenderPipeline.captureFrame()   records every native render call of
//                                        the next frame (pass, layers by name,
//                                        override material, target, draws,
//                                        triangles, ms); read lastCapture().
//   WorldRenderPipeline.setScopeEnabled(id, false) A/B one render scope.
(() => {
  'use strict';

  if (window.WorldRenderPipeline) return;

  const LAYERS = window.HobunjiRenderLayers || {};
  const SHELL_LAYER = LAYERS.SHELL_OUTLINE ?? 1;
  const TARGET_LAYER = LAYERS.TARGET_HIGHLIGHT ?? 2;
  const SEAM_ID_LAYER = LAYERS.MATERIAL_SEAM_ID ?? 3;

  let deps = null; // Set by init(); tagging helpers below work before it.
  let THREE = window.THREE;

  // ── Outline rendering tuning (config/outline-rendering.json) ──────
  // Every numeric/color knob across the three outline sources below
  // (shell, colored target highlight, furniture material-seam) is
  // overwritten in place onto the already-created materials/uniforms once
  // the config loads — rendering never blocks on the fetch.
  const OUTLINE_RENDERING_DEFAULTS = Object.freeze({
    shell: Object.freeze({ thicknessNdc: 0.006 }),
    targetHighlight: Object.freeze({ thicknessNdc: 0.009, allyColor: '#14f22e', hostileColor: '#f21f14' }),
    materialSeam: Object.freeze({ hueStep: 0.6180339887, saturation: 0.85, lightness: 0.55, colorDistanceThreshold: 0.1, occlusionToleranceDepth: 0.05 }),
  });
  let outlineRenderingConfig = {
    shell: { ...OUTLINE_RENDERING_DEFAULTS.shell },
    targetHighlight: { ...OUTLINE_RENDERING_DEFAULTS.targetHighlight },
    materialSeam: { ...OUTLINE_RENDERING_DEFAULTS.materialSeam },
  };

  // Created by init(). Names kept from game.js so its old comments still match.
  let shellOutlineMat = null;
  const DEFAULT_GENERATED_OUTLINE_MODE = 'screen'; // User-selected shipped default and settings reset authority.
  let generatedOutlineMode = DEFAULT_GENERATED_OUTLINE_MODE; // Experimental generated-outline selector; master Outlines still controls the composite.
  let shellMaskMaterial = null; // Unexpanded, front-facing geometry for the selective screen-space mode.
  let shellMaskRT = null; // Allocated only in screen-space mode, reused between frames.
  let targetOutlineGreenMat = null;
  let targetOutlineRedMat = null;
  let _furnitureIdMat = null;
  let _mainRT = null;
  let _edgeIdRT = null;
  let _postScene = null;
  let _postCamera = null;
  let _postMat = null;

  function applyOutlineRenderingConfig(raw) {
    const finiteOr = (v, fb) => Number.isFinite(Number(v)) ? Number(v) : fb;
    const hexOr = (v, fb) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.trim())) ? v.trim() : fb;
    const shell = raw?.shell || {};
    const target = raw?.targetHighlight || {};
    const seam = raw?.materialSeam || {};
    outlineRenderingConfig = {
      shell: { thicknessNdc: finiteOr(shell.thicknessNdc, OUTLINE_RENDERING_DEFAULTS.shell.thicknessNdc) },
      targetHighlight: {
        thicknessNdc: finiteOr(target.thicknessNdc, OUTLINE_RENDERING_DEFAULTS.targetHighlight.thicknessNdc),
        allyColor: hexOr(target.allyColor, OUTLINE_RENDERING_DEFAULTS.targetHighlight.allyColor),
        hostileColor: hexOr(target.hostileColor, OUTLINE_RENDERING_DEFAULTS.targetHighlight.hostileColor),
      },
      materialSeam: {
        hueStep: finiteOr(seam.hueStep, OUTLINE_RENDERING_DEFAULTS.materialSeam.hueStep),
        saturation: finiteOr(seam.saturation, OUTLINE_RENDERING_DEFAULTS.materialSeam.saturation),
        lightness: finiteOr(seam.lightness, OUTLINE_RENDERING_DEFAULTS.materialSeam.lightness),
        colorDistanceThreshold: finiteOr(seam.colorDistanceThreshold, OUTLINE_RENDERING_DEFAULTS.materialSeam.colorDistanceThreshold),
        occlusionToleranceDepth: finiteOr(seam.occlusionToleranceDepth, OUTLINE_RENDERING_DEFAULTS.materialSeam.occlusionToleranceDepth),
      },
    };
    if (!shellOutlineMat) return; // Materials not built yet; init() applies the stored config.
    // Shader source never needs recompiling: the literals are uniforms.
    shellOutlineMat.uniforms.uThickness.value = outlineRenderingConfig.shell.thicknessNdc;
    targetOutlineGreenMat.uniforms.uThickness.value = outlineRenderingConfig.targetHighlight.thicknessNdc;
    targetOutlineRedMat.uniforms.uThickness.value = outlineRenderingConfig.targetHighlight.thicknessNdc;
    try { targetOutlineGreenMat.uniforms.uColor.value.set(outlineRenderingConfig.targetHighlight.allyColor); } catch {}
    try { targetOutlineRedMat.uniforms.uColor.value.set(outlineRenderingConfig.targetHighlight.hostileColor); } catch {}
    _postMat.uniforms.uSeamColorDistThresh.value = outlineRenderingConfig.materialSeam.colorDistanceThreshold;
    _postMat.uniforms.uSeamOcclusionTolerance.value = outlineRenderingConfig.materialSeam.occlusionToleranceDepth;
  }
  function loadOutlineRenderingConfig() {
    if (typeof fetch !== 'function') return;
    fetch('config/outline-rendering.json')
      .then(r => r.ok ? r.json() : null)
      .then(cfg => { if (cfg) applyOutlineRenderingConfig(cfg); })
      .catch(() => {});
  }

  // The black inverted-hull shell outline material. A standalone factory so
  // editors (tools/enemy-loadout-editor) can build the exact live material
  // without initialising the pipeline.
  function createShellOutlineMaterial(THREE) {
    // ── Inverted shell outline ────────────────────────────────────
    // Second render pass: back faces only, vertices extruded along
    // normals → solid black border on every mesh edge. No render
    // targets or screen-space sampling required.
    return new THREE.ShaderMaterial({
      side: THREE.BackSide,
      // fog:true + the merged UniformsLib.fog entries below are the
      // standard (only) way three.js feeds a raw ShaderMaterial the
      // active scene's actual fog uniforms — refreshed automatically from
      // whichever scene is being rendered (farm's light 0.018 fog, a
      // wilderness zone's own, or the Cloud Forest's dense white one).
      // The shader below does the actual color-mix by hand rather than
      // relying on the built-in fog_vertex/fog_fragment #include chunks,
      // since those assume a varying named exactly `mvPosition`, which
      // this shader computes as `viewPos` instead.
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        { uThickness: { value: 0.006 } },  // NDC units → constant screen-pixel width
      ]),
      vertexShader: `
        // NOTE: do not redeclare "attribute mat4 instanceMatrix" here — for a
        // regular (non-Raw) ShaderMaterial, three.js's WebGLProgram already
        // injects that exact declaration into the vertex shader prefix
        // whenever USE_INSTANCING is defined. Redeclaring it is a duplicate
        // attribute and fails to compile/link, which silently dropped the
        // outline for every InstancedMesh (wall bricks) using this material.
        uniform float uThickness;
        varying float vFogDepth;
        void main() {
          #ifdef USE_INSTANCING
            mat4 mvMatrix = modelViewMatrix * instanceMatrix;
            // Wall-brick instances are only ever rotated/shifted per
            // instance, never non-uniformly scaled (see WallBuilder's
            // brickJitter), so the linear part of mvMatrix itself still
            // transforms a normal correctly here.
            vec3 viewNormal = normalize(mat3(mvMatrix) * normal);
          #else
            mat4 mvMatrix = modelViewMatrix;
            // normalMatrix (three.js's own inverse-transpose of
            // modelViewMatrix's linear part, supplied automatically) is
            // required here rather than mat3(mvMatrix) directly —
            // furniture placed in a building interior can carry a
            // non-uniform per-instance scale (see loadBuildingScene's
            // postSX/postSY/postSZ), and naively transforming a normal
            // through a non-uniformly-scaled matrix stops being
            // perpendicular to the actual scaled surface — confirmed live
            // as a rescaled interior bench's shell outline bleeding onto
            // the player sprite regardless of actual depth (not a
            // depth-test bug at all: the shell geometry itself was wrong).
            vec3 viewNormal = normalize(normalMatrix * normal);
          #endif
          vec4 viewPos = mvMatrix * vec4(position, 1.0);
          vec4 clip  = projectionMatrix * viewPos;
          vec4 clipN = projectionMatrix * (viewPos + vec4(viewNormal, 0.0));

          vec2 dir = clipN.xy / clipN.w - clip.xy / clip.w;
          float len = length(dir);
          dir = (len > 1e-5) ? dir / len : vec2(0.0, 0.0);
          clip.xy    += dir * uThickness * clip.w;
          gl_Position = clip;
          // Same depth convention THREE's own fog_vertex chunk uses (the
          // view-space position's negated Z), computed here by hand since
          // this shader's view-space variable is named viewPos, not the
          // mvPosition that chunk expects.
          vFogDepth = -viewPos.z;
        }
      `,
      fragmentShader: `
        uniform vec3 fogColor;
        #ifdef FOG_EXP2
          uniform float fogDensity;
        #else
          uniform float fogNear;
          uniform float fogFar;
        #endif
        varying float vFogDepth;
        void main() {
          vec3 outlineColor = vec3(0.0);
          #ifdef USE_FOG
            #ifdef FOG_EXP2
              float fogFactor = 1.0 - exp(- fogDensity * fogDensity * vFogDepth * vFogDepth);
            #else
              float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
            #endif
            outlineColor = mix(outlineColor, fogColor, fogFactor);
          #endif
          gl_FragColor = vec4(outlineColor, 1.0);
        }
      `,
      // depthWrite off: shell only reads the scene depth, never corrupts it.
      // LessDepth: coplanar back faces (adjacent tiles share the same Z plane)
      // would pass LEQUAL and splat black everywhere — LESS rejects equal depth.
      depthWrite: false,
      depthFunc:  THREE.LessDepth,
    });
  }

  function createOutlineMaterials() {
    shellOutlineMat = createShellOutlineMaterial(THREE);
    shellMaskMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.FrontSide, skinning: true, morphTargets: true });
    shellMaskMaterial.userData ||= {};
    shellMaskMaterial.userData.hobunjiScreenOutlineMask = true; // Existing matrix-reuse owner identifies this secondary pass.

    // Shared vertex shader used for coloured target outlines (supports instancing)
    const _targetOutlineVert = `
      // See shellOutlineMat above — three.js's own vertex-shader prefix
      // already declares "attribute mat4 instanceMatrix" under
      // USE_INSTANCING for ShaderMaterial, so it must not be redeclared here.
      uniform float uThickness;
      void main() {
        #ifdef USE_INSTANCING
          mat4 mvMatrix = modelViewMatrix * instanceMatrix;
          vec3 viewNormal = normalize(mat3(mvMatrix) * normal);
        #else
          mat4 mvMatrix = modelViewMatrix;
          // See shellOutlineMat's own comment on this same substitution —
          // required for correctness under non-uniform scale.
          vec3 viewNormal = normalize(normalMatrix * normal);
        #endif
        vec4 viewPos = mvMatrix * vec4(position, 1.0);
        vec4 clip  = projectionMatrix * viewPos;
        vec4 clipN = projectionMatrix * (viewPos + vec4(viewNormal, 0.0));
        vec2 dir = clipN.xy / clipN.w - clip.xy / clip.w;
        float len = length(dir);
        dir = (len > 1e-5) ? dir / len : vec2(0.0, 0.0);
        clip.xy += dir * uThickness * clip.w;
        gl_Position = clip;
      }
    `;
    // Thickness/colors default from OUTLINE_RENDERING_DEFAULTS above and
    // are overwritten in place once config/outline-rendering.json loads
    // (see loadOutlineRenderingConfig) — created with the built-in
    // defaults so rendering never blocks on that fetch.
    const _targetOutlineFrag = `
      uniform vec3 uColor;
      void main() { gl_FragColor = vec4(uColor, 1.0); }
    `;
    targetOutlineGreenMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { uThickness: { value: 0.009 }, uColor: { value: new THREE.Color(0x14f22e) } },
      vertexShader: _targetOutlineVert,
      fragmentShader: _targetOutlineFrag,
      depthWrite: false, depthFunc: THREE.LessDepth,
    });
    targetOutlineRedMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { uThickness: { value: 0.009 }, uColor: { value: new THREE.Color(0xf21f14) } },
      vertexShader: _targetOutlineVert,
      fragmentShader: _targetOutlineFrag,
      depthWrite: false, depthFunc: THREE.LessDepth,
    });
    // Flat-unlit material shared by every material-seam part during the
    // ID-buffer pass; each part's onBeforeRender (see stampSeamIdColor) stamps
    // its own colour into the shared uniform right before its draw call.
    _furnitureIdMat = new THREE.ShaderMaterial({
      uniforms: { uIdColor: { value: new THREE.Color(0, 0, 0) } },
      vertexShader: `
        void main() {
          #ifdef USE_INSTANCING
            gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          #else
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          #endif
        }
      `,
      fragmentShader: `
        uniform vec3 uIdColor;
        void main() { gl_FragColor = vec4(uIdColor, 1.0); }
      `,
    });
  }

  // ── Layer tagging (callable before init) ─────────────────────────────
  // Enable SHELL_OUTLINE on a mesh (or every mesh inside a Group) so the
  // shell outline pass picks it up. Flat floor slabs, water, and grass
  // billboards stay on layer 0 only and are never outlined. Meshes tagged
  // userData.noOutline (textured leaf cards — see foliage-generator.js's
  // getLeafCardMaterial usage) are skipped even inside an otherwise-outlined
  // group: the inverted-hull technique needs real volume, correct normals,
  // and a depth-writing main pass to produce a thin border. A leaf card is a
  // flat, depthWrite:false alpha-cutout plane with no computed normals, so a
  // back-facing card's shell has the card's own depth, passes LessDepth, and
  // paints its full quad solid black (the "black leaf rectangles" bug).
  function markShellOutline(obj) {
    if (!obj || typeof obj.isMesh === 'undefined' && !obj.isGroup) return;
    // PNG planes already contain their authored outline ink. Never enroll
    // them (or a parent group containing them) in the inverted-hull shell
    // pass, which is reserved for volumetric 3D geometry.
    if (obj.userData?.isPngPlane === true) return;
    if (obj.isMesh) {
      if (!obj.userData.noOutline && obj.userData.isPngPlane !== true) obj.layers.enable(SHELL_LAYER);
      return;
    }
    obj.traverse(child => {
      if (child.isMesh && !child.userData.noOutline && child.userData.isPngPlane !== true) child.layers.enable(SHELL_LAYER);
    });
  }

  // Tags a mesh for the material-seam ID pass with a fixed colour. Every
  // tagged mesh shares one material during that pass, so the renderer's
  // "material unchanged since last draw" cache would otherwise skip
  // re-uploading the uniform this hook mutates — only the first part drawn
  // each frame would reach the GPU; hence uniformsNeedUpdate.
  function stampSeamIdColor(mesh, idColor) {
    if (!mesh) return;
    mesh.layers.enable(SEAM_ID_LAYER);
    mesh.onBeforeRender = function (_renderer, _scene, _camera, _geometry, material) {
      if (!_furnitureIdMat || material !== _furnitureIdMat) return;
      _furnitureIdMat.uniforms.uIdColor.value.copy(idColor);
      _furnitureIdMat.uniformsNeedUpdate = true;
    };
  }

  // Furniture parts: every mesh child gets its own unique ID colour
  // (golden-ratio hue steps), so a seam appears wherever two differently
  // tagged meshes touch (chair leg vs seat, a GLB foot's claw vs pad).
  let _furnitureEdgeIdSeq = 0;
  function markMaterialSeamId(obj) {
    if (!obj) return;
    const apply = (m) => {
      const seamCfg = outlineRenderingConfig.materialSeam;
      const hue = (_furnitureEdgeIdSeq++ * seamCfg.hueStep) % 1;
      stampSeamIdColor(m, new (THREE || window.THREE).Color().setHSL(hue, seamCfg.saturation, seamCfg.lightness));
    };
    if (obj.isMesh) { apply(obj); return; }
    obj.traverse(child => { if (child.isMesh) apply(child); });
  }

  // ── Reticle target highlight (TARGET_HIGHLIGHT layer) ────────────────
  let targetMeshes = [];
  let targetAllowed = true;
  function setTargetHighlights(meshes, allowed) {
    clearTargetHighlights();
    targetMeshes = Array.isArray(meshes) ? meshes : [];
    targetAllowed = allowed !== false;
    for (const mesh of targetMeshes) mesh.layers.enable(TARGET_LAYER);
  }
  function clearTargetHighlights() {
    for (const mesh of targetMeshes) mesh.layers.disable(TARGET_LAYER);
    targetMeshes = [];
  }

  // ── Offscreen targets ────────────────────────────────────────────────
  // Main colour pass render target — keeps a depth texture around so the
  // composite shader can read real per-pixel scene depth.
  function makeSceneRT(w, h, needsStencil = false) {
    const rt = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, format: THREE.RGBAFormat,
      stencilBuffer: needsStencil,
    });
    rt.depthTexture = new THREE.DepthTexture(w, h);
    if (needsStencil) {
      // HeldObjectRenderOrder uses two stencil bits while rendering the
      // gameplay scene into this offscreen target: bit 1 protects held
      // weapons/hands, while bit 0 identifies feet that water may repaint.
      // A plain DepthTexture leaves WebGLRenderTarget with no stencil
      // attachment, so those masks silently cannot work while outlines are on.
      rt.depthTexture.format = THREE.DepthStencilFormat;
      rt.depthTexture.type = THREE.UnsignedInt248Type;
    }
    return rt;
  }

  function resize(pixelW, pixelH) {
    if (!_mainRT) return;
    const seamOn = !!deps.settings.seamOutlines() && window.OutlineRenderPerformance?.nonShellOutlinesSuppressed !== true; // Retired seam output cannot justify a target switch, clear or full-size ID buffer.
    _mainRT.setSize(pixelW, pixelH);
    if (shellMaskRT) shellMaskRT.setSize(pixelW, pixelH);
    // The material-ID buffer stays 1x1 while seam outlines are off.
    _edgeIdRT.setSize(seamOn ? pixelW : 1, seamOn ? pixelH : 1);
    _postMat.uniforms.uTexel.value.set(1 / pixelW, 1 / pixelH);
  }

  // ── Render scopes ────────────────────────────────────────────────────
  // Objects hidden or merged for drawing only. suspend(ctx) runs before the
  // frame's first pass and returns a restore function (or nothing); restores
  // run in reverse order in the frame's finally, before any gameplay reads
  // the scene again. Lower order suspends first.
  const scopes = [];
  function registerRenderScope(spec) {
    if (!spec?.id || typeof spec.suspend !== 'function') throw new Error('registerRenderScope needs { id, suspend }');
    if (scopes.some(scope => scope.id === spec.id)) return;
    scopes.push({ id: spec.id, owner: spec.owner || '', order: Number.isFinite(spec.order) ? spec.order : 5000, suspend: spec.suspend, enabled: true, errors: 0, lastError: null });
    scopes.sort((a, b) => a.order - b.order);
  }
  // Built-in scopes (same order and arguments game.js used to hard-code).
  // The farm's ~1,000 per-tile ground meshes draw as merged 8x8-tile batches
  // (js/farm-tile-render-batches.js); the tiles stay the authority for edits
  // and raycasts. Outside zones the same scope merges tagged static groups
  // (town NPC farm plots, authored house faces).
  registerRenderScope({ id: 'farm-tile-batches', owner: 'farm-tile-render-batches.js', order: 100,
    suspend: ctx => window.FarmTileRenderBatches?.suspendForRender?.(ctx.scene, { isZone: ctx.isZone }) });
  // Still wilderness props (tents, totems, herbs, berry bushes, camp
  // furniture, cliff-door caves) draw as merged 8x8-tile batches.
  registerRenderScope({ id: 'zone-prop-batches', owner: 'zone-prop-render-batches.js', order: 200,
    suspend: ctx => window.ZonePropRenderBatches?.suspendForRender?.(ctx.scene, { isZone: ctx.isZone }) });
  // Procedural wilderness trees/bushes the corridor cull draws (and that are
  // not fading) draw as one InstancedMesh per shared variant part.
  registerRenderScope({ id: 'wilderness-tree-instancing', owner: 'wilderness-tree-instancer.js', order: 250,
    suspend: ctx => window.WildernessTreeInstancer?.suspendForRender?.(ctx.scene, { isZone: ctx.isZone }) });
  // The Cloud Forest's dense shadewood wall: drawn, non-fading chunk parts
  // draw as one InstancedMesh per part across chunks (background scenery, so
  // never inside a held/x-ray replay).
  registerRenderScope({ id: 'dense-forest-wall-batches', owner: 'dense-forest-wall-batches.js', order: 270,
    suspend: ctx => window.DenseForestWallBatches?.suspendForRender?.(ctx.scene, { isZone: ctx.isZone, camera: ctx.camera }) });
  // Walkers have a floor-anchored root but skinned/limb children that disable
  // Three's own frustum culling: off-camera NPC visuals are suspended.
  registerRenderScope({ id: 'npc-view-cull', owner: 'npc-view-frustum-cull.js', order: 300,
    suspend: ctx => window.NpcViewFrustumCull?.suspendForRender?.(ctx.walkers, ctx.scene, ctx.camera) });
  // Instanced brick walls/paths and grass, which r128 cannot frustum-cull:
  // farm/town grass swaps to spatial chunks first, then off-camera tagged
  // instanced meshes are hidden.
  registerRenderScope({ id: 'grass-chunks', owner: 'grass-billboard-render-chunks.js', order: 400,
    suspend: ctx => window.GrassBillboardRenderChunks?.suspendForRender?.(ctx.scene) });
  // Whole far brick meshes (house walls, path chunks) draw a 12-triangle
  // octant hull of the default brick instead of its 70 triangles.
  registerRenderScope({ id: 'instanced-brick-lod', owner: 'instanced-brick-lod.js', order: 450,
    suspend: ctx => window.InstancedBrickLod?.suspendForRender?.(ctx.scene, ctx.camera) });
  registerRenderScope({ id: 'instanced-view-cull', owner: 'instanced-mesh-view-cull.js', order: 500,
    suspend: ctx => window.InstancedMeshViewCull?.suspendForRender?.(ctx.scene, ctx.camera) });
  // Static wilderness objects outside the vegetation corridor can stay
  // GPU-visible deep into the fog: far world geometry is hidden.
  registerRenderScope({ id: 'wilderness-distance-cull', owner: 'wilderness-distance-cull.js', order: 600,
    suspend: ctx => window.WildernessDistanceCull?.suspendForRender?.(ctx.scene, ctx.camera, ctx.playerTile, { isZone: ctx.isZone }) });

  function suspendScopes(ctx, restores, captureTimings = null) {
    for (const scope of scopes) {
      if (!scope.enabled) continue;
      const startedAt = captureTimings ? performance.now() : 0; // Time scope preparation only on an explicitly captured frame.
      const profiler = window.PerfProfiler; // Reuse the existing opt-in timing owner.
      const scopePerf = (window.ProbePerformanceCapture?.active || profiler?.isEnabled?.()) ? profiler?.begin('render scope: '+scope.id) : null;
      let failed = false; // Distinguish a failed scope from a no-op.
      try {
        const restore = scope.suspend(ctx);
        if (typeof restore === 'function') restores.push(restore);
      } catch (error) {
        failed = true;
        scope.errors++;
        scope.lastError = String(error?.message || error);
        if (scope.errors <= 3) console.warn(`[WorldRenderPipeline] scope ${scope.id} failed`, error);
      } finally {
        if (captureTimings) captureTimings.push({ id: scope.id, ms: Number((performance.now() - startedAt).toFixed(3)), failed });
        if (scopePerf) profiler.end(scopePerf);
      }
    }
  }
  function restoreScopes(restores) {
    for (let i = restores.length - 1; i >= 0; i--) {
      try { restores[i](); } catch (error) { console.warn('[WorldRenderPipeline] scope restore failed', error); }
    }
    restores.length = 0;
  }

  // ── Diagnostics ──────────────────────────────────────────────────────
  const stats = { frames: 0, lastFrame: null };
  let currentPass = 'idle';
  let captureArmed = false;
  let capture = null; // Last captured frame.
  let captureRecords = null;
  let captureMainCensus = null; // One draw-state graph census, after render scopes and presentation hooks.
  let captureMainCensusError = null; // Diagnostic errors must not prevent rendering.
  let captureStaticWallAudit = null; // Audit after native main matrices, before probe/auxiliary draws invalidate readiness.
  function recordPassStart(ctx) {
    const worldScene = ctx.scene === scopeCtx.scene; // Excludes other scenes and fullscreen composite.
    if (currentPass === 'main' && worldScene && ctx.camera === scopeCtx.camera && !captureMainCensus && !captureMainCensusError) {
      try { captureMainCensus = sceneMatrixCensus(ctx.scene); }
      catch (error) { captureMainCensusError = String(error?.message || error); }
    }
    // At the last capture hook before native r128 rendering, true requests a full scene matrix walk.
    return { startedAt: performance.now(), pass: currentPass, worldScene, sceneAutoUpdate: ctx.scene?.autoUpdate === true };
  }
  function recordPassEnd(ctx, state) {
    if (!captureRecords || !state) return;
    const renderer = ctx.renderer;
    const scene = ctx.scene;
    const rt = renderer.getRenderTarget?.();
    const describe = window.HobunjiRenderLayers?.describe;
    captureRecords.push({
      pass: state.pass,
      depth: ctx.depth,
      worldScene: state.worldScene,
      sceneAutoUpdate: state.sceneAutoUpdate,
      scene: scene?.name || (scene === deps?.getActiveScene?.() ? 'activeScene' : scene?.type || '?'),
      layers: describe ? describe(ctx.camera?.layers?.mask) : ctx.camera?.layers?.mask,
      override: scene?.overrideMaterial ? (scene.overrideMaterial.name || scene.overrideMaterial.type) : null,
      target: rt ? `${rt.width}x${rt.height}` : 'canvas',
      draws: renderer.info?.render?.calls ?? null,
      triangles: renderer.info?.render?.triangles ?? null,
      ms: Number((performance.now() - state.startedAt).toFixed(3)),
    });
    if (state.pass === 'main' && state.worldScene && state.sceneAutoUpdate &&
        ctx.camera === scopeCtx.camera && captureStaticWallAudit === null) {
      try {
        const owner = window.DenseForestWallBatches;
        const audit = owner?.auditStaticMatrixBranches?.(scene);
        if (audit) captureStaticWallAudit = { ...owner.staticMatrixSnapshot(), audit };
      } catch (error) { captureStaticWallAudit = { error: String(error?.message || error) }; }
    }
  }
  function captureFrame() { captureArmed = true; return true; }

  // ── The frame ─────────────────────────────────────────────────────────
  const scopeRestores = [];
  const playerTile = { x: 0, z: 0 };
  const scopeCtx = { scene: null, camera: null, isZone: false, playerTile, walkers: null, renderer: null, area: null };
  const occlusionFrame = { renderer: null, camera: null, scene: null, walkers: null, hostiles: null, area: null, playerPosition: playerTile };

  function pass(name) { currentPass = name; }

  function renderFrame(now) {
    const { renderer, camera } = deps;
    const PerfProfiler = window.PerfProfiler;
    // "Render CPU" in the overlay only shows the average cost of a single
    // renderer.render() call; outlines chain several per frame, so this
    // bucket captures the true per-frame total.
    const renderPassPerf = PerfProfiler?.begin('render passes');
    const activeScene = deps.getActiveScene();
    const area = deps.getCurrentArea();
    window.ProbePerformanceCapture?.markArea?.(area);
    const isZone = deps.isZoneArea(area);
    deps.getPlayerTile(playerTile);
    scopeCtx.scene = activeScene; scopeCtx.camera = camera; scopeCtx.isZone = isZone;
    scopeCtx.walkers = deps.npcWalkers; scopeCtx.renderer = renderer; scopeCtx.area = area;
    const outlines = !!deps.settings.outlines();
    const seamOn = !!deps.settings.seamOutlines() && window.OutlineRenderPerformance?.nonShellOutlinesSuppressed !== true; // Retired seam output cannot justify a target switch, clear or full-size ID buffer.

    let captureHookOff = null;
    if (captureArmed && window.RenderHooks?.register) {
      captureArmed = false;
      captureRecords = [];
      captureMainCensus = null;
      captureMainCensusError = null;
      captureStaticWallAudit = null;
      captureHookOff = window.RenderHooks.register({
        id: 'world-render-pipeline-capture', owner: 'world-render-pipeline.js', order: 1e9,
        before: recordPassStart, afterRender: recordPassEnd,
      });
    }
    const hooks = window.RenderHooks;
    let worldFrame = null;
    const captureTimings = captureHookOff ? [] : null; // No extra timing arrays or walks in ordinary gameplay.
    let completed = false; // Mark a failed native submission as an incomplete capture.
    suspendScopes(scopeCtx, scopeRestores, captureTimings);
    try {
      worldFrame = hooks?.beginWorldFrame?.({ renderer, scene: activeScene, camera }) || null;
      // Frame-scoped whole-actor suppression; simulation still runs before and
      // after this render. Existing frustum culling handles camera-offscreen
      // walkers; this adds covered NPCs and hostile humanoids.
      occlusionFrame.renderer = renderer; occlusionFrame.camera = camera; occlusionFrame.scene = activeScene;
      occlusionFrame.walkers = deps.npcWalkers; occlusionFrame.hostiles = deps.hostileObjects; occlusionFrame.area = area;
      window.ActorRenderOcclusion?.beginFrame?.(occlusionFrame);
      window.CloudForestFog?.prepareKanthicGlyphFrame?.(activeScene,now,camera); // Hide base-pass glow; only the occupied region receives depth-tested emission.
      if (outlines) renderOutlinedPasses(renderer, camera, activeScene, seamOn, area);
      else renderDirectPasses(renderer, camera, activeScene, area);
      completed = true;
    } finally {
      pass('cleanup');
      window.CloudForestFog?.endKanthicGlyphFrame?.(); // Restore authored visibility before resuming gameplay.
      window.ActorRenderOcclusion?.endFrame?.(); // Release all render-only hostile/NPC suppressions before resuming game systems.
      const nativeRenders = worldFrame?.renders ?? null;
      hooks?.endWorldFrame?.(); // Undo 'frame' presentation hooks (composed body, crop/NPC sway) before gameplay resumes.
      restoreScopes(scopeRestores); // Batches, culls and hidden walkers are back to their real state.
      if (captureHookOff) {
        captureHookOff();
        capture = { at: now, area, outlines, completed, passes: captureRecords, scopeTimings: captureTimings,
          mainMatrixCensus: captureMainCensus, mainMatrixCensusError: captureMainCensusError,
          mainStaticWallAudit: captureStaticWallAudit };
        captureRecords = null;
        captureMainCensus = null;
        captureMainCensusError = null;
        captureStaticWallAudit = null;
      }
      pass('idle');
      stats.frames++;
      stats.lastFrame = { area, outlines, generatedOutlineMode: outlines ? generatedOutlineMode : 'master-off', seamOutlines: seamOn, targetHighlights: targetMeshes.length, nativeRenders, scopes: scopes.filter(s => s.enabled).length };
    }
    PerfProfiler?.end(renderPassPerf);
    window.MobileRenderBudget?.sample(now, !deps.isPaused() && !window.PixelProbe?.armed);
  }

  function renderTargetPass(renderer, camera) {
    // Coloured target outline pass (TARGET_HIGHLIGHT — green allowed, red blocked).
    // Always the farm scene: targets only exist on the farm.
    const scene = deps.farmScene;
    scene.overrideMaterial = targetAllowed ? targetOutlineGreenMat : targetOutlineRedMat;
    camera.layers.set(TARGET_LAYER);
    renderer.render(scene, camera);
    camera.layers.enableAll();
    scene.overrideMaterial = null;
  }

  function setGeneratedOutlineMode(mode) {
    if (!['shell', 'screen', 'none'].includes(mode)) return generatedOutlineMode;
    generatedOutlineMode = mode;
    if (mode !== 'screen' && shellMaskRT) { shellMaskRT.dispose(); shellMaskRT = null; }
    return generatedOutlineMode;
  }

  function renderScreenOutlineMask(renderer, camera, scene) {
    // Same resolution/precision as world depth. Only shell-tagged curved surfaces
    // are submitted, without expansion or the shell X-ray depth replay.
    if (!shellMaskRT) shellMaskRT = makeSceneRT(_mainRT.width, _mainRT.height, true);
    const oldTarget = renderer.getRenderTarget();
    const oldMask = camera.layers.mask;
    const oldMaterial = scene.overrideMaterial;
    const oldBackground = scene.background;
    const oldColorClear = renderer.autoClearColor, oldDepthClear = renderer.autoClearDepth;
    const oldAutoClear = renderer.autoClear;
    try {
      renderer.setRenderTarget(shellMaskRT);
      renderer.autoClear = false;
      scene.background = null;
      renderer.clear(true, true, true);
      scene.overrideMaterial = shellMaskMaterial;
      camera.layers.set(SHELL_LAYER);
      renderer.render(scene, camera);
    } finally {
      scene.overrideMaterial = oldMaterial;
      scene.background = oldBackground;
      camera.layers.mask = oldMask;
      renderer.setRenderTarget(oldTarget);
      renderer.autoClear = oldAutoClear;
      renderer.autoClearColor = oldColorClear;
      renderer.autoClearDepth = oldDepthClear;
    }
  }

  function renderOutlinedPasses(renderer, camera, activeScene, seamOn, area) {
    const PerfProfiler = window.PerfProfiler;
    // Colour + depth into an offscreen target so the composite can read real
    // per-pixel depth — rendering straight to the canvas would lose that
    // depth buffer the moment the fullscreen composite quad overwrites it.
    pass('main');
    const rpMainPerf = PerfProfiler?.begin('render: main scene');
    renderer.setRenderTarget(_mainRT);
    renderer.render(activeScene, camera);
    PerfProfiler?.end(rpMainPerf);

    // Preserve the colour/depth result while PNG silhouettes add only the
    // missing occlusion depth needed by both outline systems.
    renderer.autoClearColor = false;
    renderer.autoClearDepth = false;
    pass('pngDepth');
    const rpPngOccluderPerf = PerfProfiler?.begin('render: png occluder depth');
    window.PngPlaneOutlineOccluder.renderDepth(activeScene);
    PerfProfiler?.end(rpPngOccluderPerf);
    pass('actorProbes');
    const actorProbePerf = PerfProfiler?.begin('render: actor occlusion probes');
    window.ActorRenderOcclusion?.probeAfterBase?.(); // Use existing world + PNG depth; no extra world redraw.
    PerfProfiler?.end(actorProbePerf);

    if (generatedOutlineMode === 'shell') {
      // Selective shell outline pass (SHELL_OUTLINE objects only).
      pass('shell');
      const rpShellPerf = PerfProfiler?.begin('render: shell outline');
      activeScene.overrideMaterial = shellOutlineMat;
      camera.layers.set(SHELL_LAYER);
      try { renderer.render(activeScene, camera); }
      finally { camera.layers.enableAll(); activeScene.overrideMaterial = null; PerfProfiler?.end(rpShellPerf); }
    } else if (generatedOutlineMode === 'screen') {
      pass('screenOutlineMask');
      const maskPerf = PerfProfiler?.begin('render: screen outline mask');
      try { renderScreenOutlineMask(renderer, camera, activeScene); }
      finally { PerfProfiler?.end(maskPerf); }
    }

    if (targetMeshes.length > 0) {
      pass('target');
      const rpTargetPerf = PerfProfiler?.begin('render: target outline');
      renderTargetPass(renderer, camera);
      PerfProfiler?.end(rpTargetPerf);
    }

    // Blend mist back over the outlines using their existing depth buffer.
    if (deps.settings.cloudForestFog() && window.CloudForestFog?.isActive?.()) {
      pass('mist');
      const rpMistPerf = PerfProfiler?.begin('render: cloud mist');
      window.CloudForestFog.renderOutlineMist(renderer, camera, activeScene);
      PerfProfiler?.end(rpMistPerf);
    }
    pass('kanthicEngraving');
    window.CloudForestFog?.renderKanthicGlyphFrame?.(renderer,camera,activeScene); // World depth is still intact in mainRT.
    renderer.autoClearColor = true;
    renderer.autoClearDepth = true;

    // Material-ID buffer (MATERIAL_SEAM_ID objects only) — feeds the seam
    // edge detection in the composite. Skipped while seam outlines are off;
    // the composite's uSeamOutlinesOn uniform also zeroes its contribution,
    // so leaving _edgeIdRT stale here is safe.
    if (seamOn) {
      pass('seamId');
      const rpSeamPerf = PerfProfiler?.begin('render: furniture seam');
      renderer.setRenderTarget(_edgeIdRT);
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, true, false);
      camera.layers.set(SEAM_ID_LAYER);
      activeScene.overrideMaterial = _furnitureIdMat;
      renderer.render(activeScene, camera);
      activeScene.overrideMaterial = null;
      camera.layers.enableAll();
      PerfProfiler?.end(rpSeamPerf);
    }

    // Composite: blend material-seam outlines over the rendered scene,
    // straight to the canvas.
    pass('composite');
    const rpCompositePerf = PerfProfiler?.begin('render: composite');
    renderer.setRenderTarget(null);
    _postMat.uniforms.tColor.value = _mainRT.texture;
    _postMat.uniforms.tEdgeId.value = _edgeIdRT.texture;
    _postMat.uniforms.tEdgeIdDepth.value = _edgeIdRT.depthTexture;
    _postMat.uniforms.tSceneDepth.value = _mainRT.depthTexture;
    _postMat.uniforms.uCameraNear.value = camera.near;
    _postMat.uniforms.uCameraFar.value = camera.far;
    _postMat.uniforms.uSeamOutlinesOn.value = seamOn ? 1 : 0;
    _postMat.uniforms.uDepthOutlinesOn.value = generatedOutlineMode === 'screen' && shellMaskRT ? 1 : 0;
    _postMat.uniforms.tShellMaskDepth.value = shellMaskRT?.depthTexture || _mainRT.depthTexture;
    _postMat.uniforms.uOrthographic.value = camera.isOrthographicCamera ? 1 : 0;
    if (generatedOutlineMode === 'screen') {
      const fog = activeScene.fog; // Fade ink towards the same scene fog as the shell shader.
      _postMat.uniforms.uDepthFogMode.value = fog?.isFogExp2 ? 2 : fog?.isFog ? 1 : 0;
      if (fog?.color) _postMat.uniforms.uDepthFogColor.value.copy(fog.color);
      _postMat.uniforms.uDepthFogNear.value = fog?.near ?? 0;
      _postMat.uniforms.uDepthFogFar.value = fog?.far ?? 1;
      _postMat.uniforms.uDepthFogDensity.value = fog?.density ?? 0;
    }
    renderer.render(_postScene, _postCamera);
    PerfProfiler?.end(rpCompositePerf);
    // Perception Mode silhouettes go on top of the finished composite so the
    // painterly/outline post-process can't smear them.
    pass('perception');
    window.PerceptionMode?.renderOverlay(renderer, activeScene, camera);
  }

  function renderDirectPasses(renderer, camera, activeScene, area) {
    const PerfProfiler = window.PerfProfiler;
    const scoreMeshes = window.PuzzleCaveEntrances?.activeScoreMeshes?.(area, activeScene); // The active cave plate owns direct-render score candidates.
    const finishScore = window.OutlineRenderPerformance?.prepareDirectScoreOverlay?.(renderer, activeScene, camera, scoreMeshes); // Keeps the glyphs out of actor probes and held-depth replay.
    let worldPresented = false; // Release the temporary layer on error without drawing an overlay over an incomplete frame.
    try {
      window.PngPlaneOutlineOccluder.prune(); // Outlines off skips the pass that otherwise compacts this registry every frame.
      pass('main');
      renderer.setRenderTarget(null);
      renderer.render(activeScene, camera);
      pass('actorProbes');
      const actorProbePerf = PerfProfiler?.begin('render: actor occlusion probes');
      window.ActorRenderOcclusion?.probeAfterBase?.(); // Same visibility checks even with all shell outlines disabled.
      PerfProfiler?.end(actorProbePerf);
      if (targetMeshes.length > 0) {
        pass('target');
        renderer.autoClearColor = false;
        renderer.autoClearDepth = false;
        renderTargetPass(renderer, camera);
        renderer.autoClearColor = true;
        renderer.autoClearDepth = true;
      }
      pass('kanthicEngraving');
      window.CloudForestFog?.renderKanthicGlyphFrame?.(renderer,camera,activeScene,true);
      worldPresented = true;
    } finally {
      finishScore?.(worldPresented);
    }
    pass('perception');
    window.PerceptionMode?.renderOverlay(renderer, activeScene, camera);
  }

  // ── init ────────────────────────────────────────────────────────────
  // deps: { THREE, renderer, camera, farmScene, getActiveScene, getCurrentArea,
  //         isZoneArea, getPlayerTile(out), npcWalkers, hostileObjects,
  //         isPaused, settings: { outlines, seamOutlines, cloudForestFog } }
  function init(injectedDeps) {
    deps = injectedDeps;
    THREE = deps.THREE || window.THREE;
    createOutlineMaterials();
    _mainRT = makeSceneRT(1, 1, true);
    // Material-ID buffer — alpha 0 means "nothing tagged here". Carries its
    // own depth texture (depth of the tagged objects only) so the composite
    // can tell whether a tagged surface is the frontmost thing at a pixel
    // before drawing its seam.
    _edgeIdRT = makeSceneRT(1, 1);
    _postScene = new THREE.Scene();
    _postScene.name = 'world_render_composite';
    _postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    _postMat = window.OutlineCompositeMaterial.create(THREE);
    _postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), _postMat));
    applyOutlineRenderingConfig(outlineRenderingConfig);
    loadOutlineRenderingConfig();
    return api;
  }

  // On-demand matrix-work census for Pixel Probe, never called by renderFrame.
  // Three r128's native updateMatrixWorld visits hidden descendants too; this
  // measures their count, not their CPU time or whether any particular node is safe to freeze.
  function sceneMatrixCensus(scene = deps?.getActiveScene?.()) {
    if (!scene?.isScene) return null;
    const totals = { nodes: 0, meshes: 0, hiddenNodes: 0, hiddenMeshes: 0, autoLocalMatrices: 0, hiddenAutoLocalMatrices: 0, renderProxyNodes: 0 };
    const groups = new Map(); // Aggregates top-level scene branches by their existing runtime category.
    function count(node, inheritedHidden, inheritedProxy, bucket) {
      const hidden = inheritedHidden || node.visible === false;
      const data = node.userData || {};
      const proxy = inheritedProxy || data.hobunjiRenderProxy === true || data.hobunjiZonePropBatchHolder === true;
      for (const target of [totals, bucket]) {
        target.nodes++;
        if (node.isMesh) target.meshes++;
        if (hidden) {
          target.hiddenNodes++;
          if (node.isMesh) target.hiddenMeshes++;
        }
        if (node.matrixAutoUpdate !== false) {
          target.autoLocalMatrices++;
          if (hidden) target.hiddenAutoLocalMatrices++;
        }
        if (proxy) target.renderProxyNodes++;
      }
      for (const child of node.children || []) count(child, hidden, proxy, bucket);
    }
    for (const root of scene.children || []) {
      const data = root.userData || {};
      const category = data.hobunjiZonePropBatchHolder ? 'prop batch holder'
        : data.denseForestWall ? 'dense forest wall'
        : data.terrainRenderChunkSource ? 'terrain chunk source'
        : data.hobunjiStaticBatchGroup ? 'static batch group'
        : data.backgroundScenery ? 'background scenery'
        : data.wildernessChunk === true || /^WildernessChunk_/i.test(root.name || '') ? 'wilderness chunk'
        : String(root.name || root.type || 'unnamed').replace(/[_-]\d+(?:[_-]\d+)*$/,'');
      let bucket = groups.get(category);
      if (!bucket) {
        bucket = { category, roots: 0, nodes: 0, meshes: 0, hiddenNodes: 0, hiddenMeshes: 0, autoLocalMatrices: 0, hiddenAutoLocalMatrices: 0, renderProxyNodes: 0 };
        groups.set(category,bucket);
      }
      bucket.roots++;
      count(root,scene.visible === false,false,bucket);
    }
    return { ...totals, rootCount: scene.children?.length || 0,
      largestBranches: [...groups.values()].sort((a,b)=>b.nodes-a.nodes).slice(0,12) };
  }

  const api = {
    init,
    renderFrame,
    sceneMatrixCensus,
    resize,
    // Tagging
    markShellOutline,
    markMaterialSeamId,
    stampSeamIdColor,
    createShellOutlineMaterial,
    // Reticle target highlight
    setTargetHighlights,
    clearTargetHighlights,
    hasTargetHighlights: () => targetMeshes.length > 0,
    // Render scopes
    registerRenderScope,
    setScopeEnabled(id, enabled) {
      const scope = scopes.find(entry => entry.id === id);
      if (scope) scope.enabled = enabled !== false;
      return !!scope;
    },
    // Read-only views for diagnostics/tests
    get materials() { return { shell: shellOutlineMat, targetAllowed: targetOutlineGreenMat, targetBlocked: targetOutlineRedMat, seamId: _furnitureIdMat, composite: _postMat }; },
    get targets() { return { main: _mainRT, seamId: _edgeIdRT }; },
    get camera() { return deps?.camera || null; }, // The gameplay camera every world pass uses (diagnostics).
    defaultGeneratedOutlineMode: DEFAULT_GENERATED_OUTLINE_MODE,
    getGeneratedOutlineMode: () => generatedOutlineMode,
    setGeneratedOutlineMode,
    getOutlineRenderingConfig: () => JSON.parse(JSON.stringify(outlineRenderingConfig)),
    applyOutlineRenderingConfig,
    currentPass: () => currentPass,
    captureFrame,
    lastCapture: () => capture,
    snapshot: () => ({
      initialized: !!deps,
      generatedOutlineMode, // Mobile diagnostics and A/B mode verification.
      frames: stats.frames,
      lastFrame: stats.lastFrame ? { ...stats.lastFrame } : null,
      scopes: scopes.map(scope => ({ id: scope.id, owner: scope.owner, order: scope.order, enabled: scope.enabled, errors: scope.errors, lastError: scope.lastError })),
      renderHooks: window.RenderHooks?.list?.() || null,
    }),
  };

  // Long-standing global used by procedural-leg-animation.js and
  // procedural-hand-attachments.js to tag meshes from outside game.js.
  window.HobunjiOutlines = { markShellOutline, markMaterialSeamId };
  window.WorldRenderPipeline = api;
})();
