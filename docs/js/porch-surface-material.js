// Replaces authored porch/stair/railing board faces with the Furniture + Avatar
// Author's carved_smooth wood treatment, stretched once across each authored
// quad instead of tiled by world size. Physics/elevation remain owned by
// town-player-body-elevation-bridge.js; this module changes presentation only.
(() => {
  'use strict';

  const THREE = window.THREE;
  const housePieces = window.HousePieceGen;
  if (!THREE || !housePieces?.buildGroupFromPiece || window.HobunjiPorchSurfaceMaterial?.installed) return;

  const TEXTURE_PATH = 'assets/textures/carved_smooth.png'; // Used by every porch surface instead of the legacy boards.png material.
  const WOOD_TINT = '#8b6540'; // Furniture + Avatar Author's standard wood base color, used by authored wood furniture.
  const WOOD_TINT_HEX = 0x8b6540; // Used as the immediate material fallback and texture-multiply fallback before/without shade-fill helpers.
  const PORCH_TAGS = new Set(['porch', 'porchStair', 'railing']); // Limits the replacement to the porch assembly; ordinary floor faces keep their existing material.
  const MATCH_EPSILON = 1e-4; // Used to match the generated face mesh back to the authored quad after HousePieceGen applies placement/rotation.
  const FULL_QUAD_UVS = new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]); // Used to stretch one complete PNG square over one authored surface.
  const DEBUG_ENABLED = new URLSearchParams(location.search).get('porchMatDebug') === '1'; // Used for mobile-visible render diagnostics without devtools.

  let sharedMaterial = null; // Used by all converted porch faces so one texture/tint load updates every existing building.
  let textureStatus = 'not-requested'; // Used by the debug snapshot to distinguish fallback, loaded, and failed texture states.
  let lastBuild = null; // Used by mobile diagnostics to report the most recently processed house piece.
  let totalConvertedFaces = 0; // Used by diagnostics to confirm the patch is actually finding authored porch meshes.

  function log(message, level = 'info') {
    if (!DEBUG_ENABLED) return;
    const text = `[porch-material] ${message}`;
    if (typeof window.__farmLog === 'function') window.__farmLog(text, level, 'render');
    else if (level === 'warn') console.warn(text);
    else console.debug(text);
  }

  function porchMaterial() {
    if (sharedMaterial) return sharedMaterial;
    sharedMaterial = new THREE.MeshLambertMaterial({ color: WOOD_TINT_HEX, side: THREE.DoubleSide });
    textureStatus = 'loading';
    new THREE.TextureLoader().load(TEXTURE_PATH, texture => {
      let finalTexture = texture;
      const parse = window.parseHexColor;
      const shadeFill = window.getShadeFillCanvas;
      const tintConfig = window.getPortraitTintingConfig;
      const rgb = typeof parse === 'function' ? parse(WOOD_TINT) : null;
      if (rgb && typeof shadeFill === 'function' && typeof tintConfig === 'function') {
        const canvas = shadeFill(texture.image, `${TEXTURE_PATH}|porch|${WOOD_TINT}`, {
          mode: 'shadeFill',
          rgb: [rgb.r, rgb.g, rgb.b],
          options: tintConfig(),
        });
        finalTexture = new THREE.CanvasTexture(canvas);
        sharedMaterial.color.setHex(0xffffff);
        textureStatus = 'loaded-shade-fill';
      } else {
        sharedMaterial.color.setHex(WOOD_TINT_HEX);
        textureStatus = 'loaded-color-multiply-fallback';
      }
      finalTexture.wrapS = finalTexture.wrapT = THREE.ClampToEdgeWrapping;
      finalTexture.needsUpdate = true;
      sharedMaterial.map = finalTexture;
      sharedMaterial.needsUpdate = true;
      log(`loaded ${TEXTURE_PATH} with ${WOOD_TINT} (${textureStatus})`);
    }, undefined, error => {
      textureStatus = 'load-failed';
      log(`texture load failed: ${error?.message || error || TEXTURE_PATH}`, 'warn');
    });
    return sharedMaterial;
  }

  function normalizePiece(pieceData) {
    return pieceData?.currentPiece && typeof pieceData.currentPiece === 'object'
      ? pieceData.currentPiece
      : pieceData;
  }

  // Mirrors only HousePieceGen.buildGroupFromPiece's placement transform so an
  // authored face can be matched to the mesh the existing renderer already made.
  // It never generates building geometry and therefore does not become a second
  // source of truth for porch shape or elevation.
  function transformedFaceVertices(pieceData, face, gridX, gridZ, options = {}) {
    const piece = normalizePiece(pieceData) || {};
    const cells = Array.isArray(piece?.footprint?.cells) ? piece.footprint.cells : [];
    const gridCenter = Math.floor((Number(piece.gridSize) || 18) / 2);
    const minCellX = cells.length ? Math.min(...cells.map(cell => Number(cell.x) || 0)) : gridCenter;
    const minCellZ = cells.length ? Math.min(...cells.map(cell => Number(cell.y) || 0)) : gridCenter;
    const offsetX = (Number(gridX) || 0) + (gridCenter - minCellX);
    const offsetZ = (Number(gridZ) || 0) + (gridCenter - minCellZ);
    const offsetY = Number(options.elevationY) || 0;
    const rotationDeg = Number(options.rotationDeg) || 0;
    const rotationRad = -rotationDeg * Math.PI / 180;
    const cos = rotationDeg ? Math.cos(rotationRad) : 1;
    const sin = rotationDeg ? Math.sin(rotationRad) : 0;
    let pivotX = 0;
    let pivotZ = 0;
    let translateX = 0;
    let translateZ = 0;

    if (rotationDeg) {
      const maxCellX = cells.length ? Math.max(...cells.map(cell => Number(cell.x) || 0)) : gridCenter + 3;
      const maxCellZ = cells.length ? Math.max(...cells.map(cell => Number(cell.y) || 0)) : gridCenter + 3;
      const footprintWidth = maxCellX - minCellX + 1;
      const footprintDepth = maxCellZ - minCellZ + 1;
      pivotX = (Number(gridX) || 0) + footprintWidth / 2;
      pivotZ = (Number(gridZ) || 0) + footprintDepth / 2;
      if (rotationDeg === 90 || rotationDeg === 270) {
        translateX = (footprintDepth - footprintWidth) / 2;
        translateZ = (footprintWidth - footprintDepth) / 2;
      }
    }

    return (face?.v || []).map(point => {
      let x = Number(point?.[0]) + offsetX;
      let z = Number(point?.[2]) + offsetZ;
      if (rotationDeg) {
        const px = x - pivotX;
        const pz = z - pivotZ;
        x = px * cos - pz * sin + pivotX + translateX;
        z = px * sin + pz * cos + pivotZ + translateZ;
      }
      return [x, Number(point?.[1]) + offsetY, z];
    });
  }

  function triangulatedPositions(vertices) {
    if (!Array.isArray(vertices) || vertices.length !== 4) return null;
    return [vertices[0], vertices[1], vertices[2], vertices[0], vertices[2], vertices[3]].flat();
  }

  function meshMatchesPositions(mesh, expected) {
    const position = mesh?.geometry?.getAttribute?.('position');
    if (!position || position.count !== 6 || !expected || expected.length !== 18) return false;
    for (let index = 0; index < 6; index += 1) {
      const offset = index * 3;
      if (Math.abs(position.getX(index) - expected[offset]) > MATCH_EPSILON
          || Math.abs(position.getY(index) - expected[offset + 1]) > MATCH_EPSILON
          || Math.abs(position.getZ(index) - expected[offset + 2]) > MATCH_EPSILON) return false;
    }
    return true;
  }

  function applyStretchToFaceMesh(mesh, tag) {
    const geometry = mesh?.geometry;
    if (!geometry) return false;
    geometry.setAttribute('uv', new THREE.BufferAttribute(FULL_QUAD_UVS.slice(), 2));
    mesh.material = porchMaterial();
    mesh.userData = mesh.userData || {};
    mesh.userData.hobunjiPorchSurfaceMaterial = {
      tag,
      texture: TEXTURE_PATH,
      tint: WOOD_TINT,
      mapping: 'stretch-to-authored-surface',
    };
    return true;
  }

  function applyToBuiltGroup(group, pieceData, gridX, gridZ, options = {}) {
    const piece = normalizePiece(pieceData);
    const faces = Array.isArray(piece?.base?.faces) ? piece.base.faces : [];
    const candidates = [];
    group?.traverse?.(node => { if (node?.isMesh && node.geometry) candidates.push(node); });
    const used = new Set();
    let converted = 0;
    let missing = 0;

    for (const face of faces) {
      const tag = String(face?.tag || '');
      if (!PORCH_TAGS.has(tag) || face?.extensionFace === 'floor') continue;
      const expected = triangulatedPositions(transformedFaceVertices(piece, face, gridX, gridZ, options));
      const mesh = candidates.find(candidate => !used.has(candidate) && meshMatchesPositions(candidate, expected));
      if (!mesh) {
        missing += 1;
        continue;
      }
      used.add(mesh);
      if (applyStretchToFaceMesh(mesh, tag)) converted += 1;
    }

    totalConvertedFaces += converted;
    lastBuild = {
      pieceId: piece?.id || piece?.name || null,
      gridX: Number(gridX) || 0,
      gridZ: Number(gridZ) || 0,
      rotationDeg: Number(options.rotationDeg) || 0,
      converted,
      missing,
    };
    if (converted || missing) log(`${lastBuild.pieceId || 'piece'}: ${converted} porch face(s) stretched, ${missing} unmatched`);
    return { converted, missing };
  }

  function installPatch() {
    const originalBuild = housePieces.buildGroupFromPiece;
    if (typeof originalBuild !== 'function' || originalBuild.__porchSurfaceMaterialPatched) return false;
    const wrappedBuild = function porchSurfaceMaterialBuild(...args) {
      const group = originalBuild.apply(this, args);
      try { applyToBuiltGroup(group, args[1], args[2], args[3], args[4] || {}); }
      catch (error) { log(`surface replacement failed: ${error?.message || error}`, 'warn'); }
      return group;
    };
    // Preserve compatibility/elevation wrapper markers so the existing
    // HousePieceGen wrapper chain does not reinstall itself around us later.
    Object.assign(wrappedBuild, originalBuild);
    wrappedBuild.__porchSurfaceMaterialPatched = true;
    wrappedBuild.__originalPorchSurfaceMaterialBuild = originalBuild;
    housePieces.buildGroupFromPiece = wrappedBuild;
    return true;
  }

  installPatch();

  function debugSnapshot() {
    return {
      installed: true,
      texturePath: TEXTURE_PATH,
      woodTint: WOOD_TINT,
      textureStatus,
      mapping: 'stretch-to-authored-surface',
      tags: [...PORCH_TAGS],
      totalConvertedFaces,
      lastBuild: lastBuild ? { ...lastBuild } : null,
      patchInstalled: !!housePieces.buildGroupFromPiece?.__porchSurfaceMaterialPatched,
      elevationPatchPreserved: !!housePieces.buildGroupFromPiece?.__walkableElevationPatched,
    };
  }

  window.HobunjiPorchSurfaceMaterial = Object.freeze({
    installed: true,
    texturePath: TEXTURE_PATH,
    woodTint: WOOD_TINT,
    applyToBuiltGroup,
    debugSnapshot,
  });
  window.__porchSurfaceMaterialDebug = debugSnapshot;
})();
