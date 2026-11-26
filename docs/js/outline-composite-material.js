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
        uniform sampler2D tColor, tEdgeId, tEdgeIdDepth, tSceneDepth;
        uniform vec2 uTexel;
        uniform float uCameraNear, uCameraFar;
        uniform float uSeamOutlinesOn;
        uniform sampler2D tShellMaskDepth;
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
        float visibleCurve(vec2 uv, float worldDepth) {
          float raw = texture2D(tShellMaskDepth, uv).r;
          if (raw >= 1.0) return 0.0;
          float maskDepth = linearDepth(raw);
          return step(abs(maskDepth - worldDepth), max(0.012, worldDepth * 0.0005));
        }
        float curveEdge(vec2 uv, float centerDepth) {
          float otherDepth = linearDepth(texture2D(tSceneDepth, uv).r);
          // Inward silhouette plus strong outward depth discontinuities. Suppress
          // small depth gradients on smooth curved faces.
          float gap = smoothstep(max(0.105, centerDepth * 0.009), max(0.225, centerDepth * 0.018), otherDepth - centerDepth);
          return max(1.0 - visibleCurve(uv, otherDepth), gap);
        }
        vec3 applyScreenOutline(vec3 color) {
          float centerDepth = linearDepth(texture2D(tSceneDepth, vUv).r);
          if (visibleCurve(vUv, centerDepth) < 0.5) return color;
          vec2 stroke = uTexel * 3.0; // Three times the original one-texel inward stroke; same sample count.
          float edge = max(max(curveEdge(vUv + vec2(stroke.x, 0.0), centerDepth),
                               curveEdge(vUv - vec2(stroke.x, 0.0), centerDepth)),
                           max(curveEdge(vUv + vec2(0.0, stroke.y), centerDepth),
                               curveEdge(vUv - vec2(0.0, stroke.y), centerDepth)));
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
          vec4 idL = texture2D(tEdgeId, vUv - vec2(uTexel.x, 0.0));
          vec4 idR = texture2D(tEdgeId, vUv + vec2(uTexel.x, 0.0));
          vec4 idU = texture2D(tEdgeId, vUv + vec2(0.0, uTexel.y));
          vec4 idD = texture2D(tEdgeId, vUv - vec2(0.0, uTexel.y));
          float idEdge = 0.0;
          idEdge = max(idEdge, (id0.a > 0.5 && idL.a > 0.5 && distance(id0.rgb, idL.rgb) > uSeamColorDistThresh) ? 1.0 : 0.0);
          idEdge = max(idEdge, (id0.a > 0.5 && idR.a > 0.5 && distance(id0.rgb, idR.rgb) > uSeamColorDistThresh) ? 1.0 : 0.0);
          idEdge = max(idEdge, (id0.a > 0.5 && idU.a > 0.5 && distance(id0.rgb, idU.rgb) > uSeamColorDistThresh) ? 1.0 : 0.0);
          idEdge = max(idEdge, (id0.a > 0.5 && idD.a > 0.5 && distance(id0.rgb, idD.rgb) > uSeamColorDistThresh) ? 1.0 : 0.0);

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
