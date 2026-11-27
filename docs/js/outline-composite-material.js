// Full-screen outline composite material (extracted from game.js).
// With outlines on, game.js renders the world into an offscreen target and
// this pass copies it to the canvas, optionally darkening furniture/terrain
// material-ID seams (off by default; when off every pixel takes one texture
// read). game.js owns the target, scene/camera and uniform updates:
//   const _postMat = window.OutlineCompositeMaterial.create(THREE);
(() => {
  'use strict';

  function create(THREE) {
    return new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null }, tEdgeId: { value: null },
        tEdgeIdDepth: { value: null }, tSceneDepth: { value: null },
        uTexel: { value: new THREE.Vector2(1, 1) },
        uCameraNear: { value: 0.1 }, uCameraFar: { value: 200 },
        uSeamOutlinesOn: { value: 0 },
        tShellMaskDepth: { value: null }, // Depth of only the curved, shell-tagged geometry.
        uDepthOutlinesOn: { value: 0 }, // Uniform branch: no extra samples in shell/none modes.
        uOrthographic: { value: 0 },
        uDepthFogMode: { value: 0 },
        uDepthFogColor: { value: new THREE.Color(0) },
        uDepthFogNear: { value: 0 }, uDepthFogFar: { value: 1 }, uDepthFogDensity: { value: 0 },
        // Defaults from game.js's OUTLINE_RENDERING_DEFAULTS, overwritten in
        // place once config/outline-rendering.json loads.
        uSeamColorDistThresh: { value: 0.1 },
        uSeamOcclusionTolerance: { value: 0.05 },
      },
      depthTest: false, depthWrite: false,
      vertexShader: `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
      fragmentShader: `
        uniform sampler2D tColor, tEdgeId;
        // Preserve packed-depth precision even on mobile GLSL implementations.
        uniform highp sampler2D tEdgeIdDepth, tSceneDepth;
        uniform vec2 uTexel;
        uniform float uCameraNear, uCameraFar;
        uniform float uSeamOutlinesOn;
        uniform highp sampler2D tShellMaskDepth;
        uniform float uDepthOutlinesOn, uOrthographic, uDepthFogMode;
        uniform vec3 uDepthFogColor;
        uniform float uDepthFogNear, uDepthFogFar, uDepthFogDensity;
        uniform float uSeamColorDistThresh, uSeamOcclusionTolerance;
        varying vec2 vUv;
        float linearDepth(float z) {
          if (uOrthographic > 0.5) return mix(uCameraNear, uCameraFar, z);
          float zNdc = z * 2.0 - 1.0;
          return (2.0 * uCameraNear * uCameraFar) / (uCameraFar + uCameraNear - zNdc * (uCameraFar - uCameraNear));
        }
        // Only darken a visible eligible pixel, never its untagged neighbor.
        // Matching full-scene depth rejects curves behind portraits, terrain and walls.
        float visibleCurve(float raw, float sceneRaw, float worldDepth) {
          // Both screen-mode targets use 24-bit depth. Never accept a curve
          // behind the visible scene except for a few quantization steps; the
          // old symmetric world-space tolerance let nearby furniture ink cover
          // a foreground PNG. Keep the existing tolerance for forward bias.
          if (raw >= 1.0 || raw - sceneRaw > 4.0 / 16777215.0) return 0.0;
          float maskDepth = linearDepth(raw);
          return step(abs(maskDepth - worldDepth), max(0.012, worldDepth * 0.0005));
        }
        // Raw device depth is affine over a projected planar face in both
        // camera projections. Convert the existing world-space thresholds to
        // raw depth at the center, not the other way around.
        float rawGapThreshold(float centerDepth, float worldGap) {
          if (uOrthographic > 0.5) return worldGap / (uCameraFar - uCameraNear);
          return (uCameraNear * uCameraFar / (uCameraFar - uCameraNear))
            * worldGap / (centerDepth * (centerDepth + worldGap));
        }
        float depthStepStrength(float centerRaw, float otherRaw, float oppositeRaw, float low, float high) {
          float outward = otherRaw - centerRaw;
          float residual = outward + (oppositeRaw - centerRaw);
          // Reject the planar slope and only ink the nearer side of a step.
          // A tolerance on the residual also suppresses gentle curvature.
          return smoothstep(low, high, min(outward, residual));
        }
        vec2 curveSample(vec2 uv) {
          float raw = texture2D(tShellMaskDepth, uv).r;
          // The raw depth is irrelevant to curveAxisEdges if the mask is absent.
          if (raw >= 1.0) return vec2(1.0, 0.0);
          float otherRaw = texture2D(tSceneDepth, uv).r;
          float otherDepth = linearDepth(otherRaw);
          return vec2(otherRaw, visibleCurve(raw, otherRaw, otherDepth));
        }
        vec2 curveAxisEdges(vec2 minus, vec2 plus, float centerRaw, float low, float high, bool axisInterior) {
          // A mask boundary is a silhouette even if its depth is continuous.
          vec2 edges = vec2(1.0 - minus.y, 1.0 - plus.y);
          // Clamped texture samples near the viewport boundary are not
          // symmetric; do not interpret their imbalance as a depth step.
          if (axisInterior && minus.y > 0.5 && plus.y > 0.5) {
            edges.x = depthStepStrength(centerRaw, minus.x, plus.x, low, high);
            edges.y = depthStepStrength(centerRaw, plus.x, minus.x, low, high);
          }
          return edges;
        }
        float protectThinGeometry(float left, float right, float down, float up) {
          float edge = max(max(left, right), max(down, up));
          // Opposing strokes overlap on narrow geometry. Retain some surface
          // color rather than filling its entire projected width with ink.
          float overlap = max(min(left, right), min(down, up));
          return edge * (1.0 - 0.45 * overlap);
        }
        vec3 applyScreenOutline(vec3 color) {
          float centerMask = texture2D(tShellMaskDepth, vUv).r;
          // Empty mask pixels never receive screen ink: avoid the scene-depth fetch and conversion.
          if (centerMask >= 1.0) return color;
          float centerRaw = texture2D(tSceneDepth, vUv).r;
          float centerDepth = linearDepth(centerRaw);
          if (visibleCurve(centerMask, centerRaw, centerDepth) < 0.5) return color;
          vec2 stroke = uTexel * 12.0; // Keep the same four taps and silhouette reach.
          float low = rawGapThreshold(centerDepth, max(0.105, centerDepth * 0.009));
          float high = rawGapThreshold(centerDepth, max(0.225, centerDepth * 0.018));
          vec2 margin = min(vUv, vec2(1.0) - vUv);
          vec2 horizontal = curveAxisEdges(curveSample(vUv - vec2(stroke.x, 0.0)),
            curveSample(vUv + vec2(stroke.x, 0.0)), centerRaw, low, high,
            margin.x >= stroke.x + uTexel.x * 0.5);
          vec2 vertical = curveAxisEdges(curveSample(vUv - vec2(0.0, stroke.y)),
            curveSample(vUv + vec2(0.0, stroke.y)), centerRaw, low, high,
            margin.y >= stroke.y + uTexel.y * 0.5);
          float edge = protectThinGeometry(horizontal.x, horizontal.y, vertical.x, vertical.y);
          float fog = 0.0;
          if (uDepthFogMode > 1.5) fog = 1.0 - exp(-uDepthFogDensity * uDepthFogDensity * centerDepth * centerDepth);
          else if (uDepthFogMode > 0.5) fog = smoothstep(uDepthFogNear, uDepthFogFar, centerDepth);
          return mix(color, uDepthFogColor * fog, edge);
        }
        void main() {
          vec3 color = texture2D(tColor, vUv).rgb;
          if (uDepthOutlinesOn > 0.5) color = applyScreenOutline(color);
          // Seam outlines are off by default. A uniform branch is coherent
          // across the whole draw, so every pixel then pays one texture
          // read instead of seven in this full-screen pass.
          if (uSeamOutlinesOn < 0.5) { gl_FragColor = vec4(color, 1.0); return; }

          vec4 id0 = texture2D(tEdgeId, vUv);
          if (id0.a <= 0.5) { gl_FragColor = vec4(color, 1.0); return; }
          vec4 idL = texture2D(tEdgeId, vUv - vec2(uTexel.x, 0.0));
          vec4 idR = texture2D(tEdgeId, vUv + vec2(uTexel.x, 0.0));
          vec4 idU = texture2D(tEdgeId, vUv + vec2(0.0, uTexel.y));
          vec4 idD = texture2D(tEdgeId, vUv - vec2(0.0, uTexel.y));
          float idEdge = 0.0;
          idEdge = max(idEdge, (id0.a > 0.5 && idL.a > 0.5 && distance(id0.rgb, idL.rgb) > uSeamColorDistThresh) ? 1.0 : 0.0);
          idEdge = max(idEdge, (id0.a > 0.5 && idR.a > 0.5 && distance(id0.rgb, idR.rgb) > uSeamColorDistThresh) ? 1.0 : 0.0);
          idEdge = max(idEdge, (id0.a > 0.5 && idU.a > 0.5 && distance(id0.rgb, idU.rgb) > uSeamColorDistThresh) ? 1.0 : 0.0);
          idEdge = max(idEdge, (id0.a > 0.5 && idD.a > 0.5 && distance(id0.rgb, idD.rgb) > uSeamColorDistThresh) ? 1.0 : 0.0);

          if (idEdge <= 0.0) { gl_FragColor = vec4(color, 1.0); return; }

          // Occlusion test — the ID buffer was rendered with only the
          // tagged objects in view, so it has no idea a wall or other
          // untagged object sits in front of them. Compare its own depth
          // against the real scene depth at this pixel and drop the seam
          // if something closer to the camera is actually there.
          float idDepth    = linearDepth(texture2D(tEdgeIdDepth, vUv).r);
          float sceneDepth = linearDepth(texture2D(tSceneDepth, vUv).r);
          idEdge *= step(idDepth, sceneDepth + uSeamOcclusionTolerance) * uSeamOutlinesOn;

          float edge = idEdge;
          gl_FragColor = vec4(mix(color, vec3(0.0), edge), 1.0);
        }
      `,
    });
  }

  window.OutlineCompositeMaterial = { create };
})();
