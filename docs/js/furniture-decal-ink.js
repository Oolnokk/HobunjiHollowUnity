// Shared furniture-decal ink effect: the editor and game use the same alpha-only tint and halo.
(() => {
  'use strict';
  if (window.FurnitureDecalInk?.installed || !window.THREE) return;
  const THREE = window.THREE;
  const HEX = /^#[0-9a-f]{6}$/i;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  function normalize(raw) {
    if (!raw || raw.enabled !== true) return null;
    const hex = String(raw.color || '').trim();
    return {
      enabled: true,
      color: HEX.test(hex) ? hex.toLowerCase() : '#ffffff',
      glowStrength: clamp(Number.isFinite(Number(raw.glowStrength)) ? Number(raw.glowStrength) : .75, 0, 1),
      glowRadius: clamp(Number.isFinite(Number(raw.glowRadius)) ? Number(raw.glowRadius) : .07, 0, .25),
    };
  }

  // Only source alpha is read: black motif ink becomes the selected colour, without a rectangle.
  function tintFromAlpha(material) {
    material.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
        #ifdef USE_MAP
          diffuseColor.a *= texture2D(map, vUv).a;
        #else
          diffuseColor.a = 0.0;
        #endif
      `);
    };
  }

  function haloFromAlpha(material, spread, expansion) {
    material.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
        #ifdef USE_MAP
          vec2 sourceUv = (vUv - vec2(0.5)) * ${expansion.toFixed(5)} + vec2(0.5);
          vec2 delta = vec2(${spread.toFixed(5)}, 0.0);
          vec2 diagonal = vec2(${(spread * Math.SQRT1_2).toFixed(5)});
          float mask = 0.0;
          // Clamp outside the PNG to transparent; texture edge-clamping must not form a box.
          #define INK_ALPHA(uv) (((uv).x < 0.0 || (uv).x > 1.0 || (uv).y < 0.0 || (uv).y > 1.0) ? 0.0 : texture2D(map, (uv)).a)
          mask += 0.10 * INK_ALPHA(sourceUv);
          mask += 0.1125 * INK_ALPHA(sourceUv + delta);
          mask += 0.1125 * INK_ALPHA(sourceUv - delta);
          mask += 0.1125 * INK_ALPHA(sourceUv + delta.yx);
          mask += 0.1125 * INK_ALPHA(sourceUv - delta.yx);
          mask += 0.1125 * INK_ALPHA(sourceUv + diagonal);
          mask += 0.1125 * INK_ALPHA(sourceUv - diagonal);
          mask += 0.1125 * INK_ALPHA(sourceUv + vec2(diagonal.x, -diagonal.y));
          mask += 0.1125 * INK_ALPHA(sourceUv + vec2(-diagonal.x, diagonal.y));
          #undef INK_ALPHA
          diffuseColor.a *= mask;
        #else
          diffuseColor.a = 0.0;
        #endif
      `);
    };
  }

  // Applies to an ordinary THREE.Mesh with a PlaneGeometry and MeshBasicMaterial.
  // The halo is a separate alpha-only child so spread extends beyond the decal's outline.
  function decorate(mesh, raw) {
    const ink = normalize(raw);
    if (!ink || !mesh?.material || !mesh?.geometry) return null;
    const material = mesh.material;
    material.color.set(ink.color);
    material.blending = THREE.NormalBlending; // Keep the authored color intact: additive core + additive halo bleaches luminous glyphs toward white.
    material.transparent = true;
    material.depthWrite = false;
    tintFromAlpha(material);
    mesh.renderOrder = 2;
    mesh.userData ||= {};
    mesh.userData.glyphInk = ink;
    if (ink.glowStrength <= 0 || ink.glowRadius <= 0) return ink;

    const expansion = 1 + ink.glowRadius * 4; // A wider quad leaves room for the blurred edges.
    const width = Math.max(.001, Number(mesh.geometry.parameters?.width) || 1);
    const height = Math.max(.001, Number(mesh.geometry.parameters?.height) || 1);
    const haloMaterial = new THREE.MeshBasicMaterial({
      color: ink.color, map: material.map || null,
      transparent: true, opacity: ink.glowStrength * .35, // Attenuated additive fringe: glow without overexposing the exact ink hue.
      depthTest: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    haloFromAlpha(haloMaterial, ink.glowRadius, expansion);
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(width * expansion, height * expansion), haloMaterial);
    halo.name = 'decal_ink_halo';
    halo.renderOrder = 1;
    halo.position.z = -0.0003; // Still in front of the authored surface, just behind the ink itself.
    halo.visible = !!material.map;
    halo.raycast = () => {};
    halo.userData.glyphInkHalo = true; // Editor cleanup and game diagnostics can identify this child.
    mesh.add(halo);
    mesh.userData.glyphInkHalo = halo;
    return ink;
  }

  function setTexture(mesh, texture) {
    if (!mesh?.material) return;
    mesh.material.map = texture || null;
    mesh.material.needsUpdate = true;
    const halo = mesh.userData?.glyphInkHalo;
    if (halo?.material) {
      halo.material.map = texture || null;
      halo.material.needsUpdate = true;
      halo.visible = !!texture;
    }
  }

  window.FurnitureDecalInk = Object.freeze({ installed: true, normalize, decorate, setTexture });
})();
