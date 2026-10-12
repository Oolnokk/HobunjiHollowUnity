// Character/creature ground shadows: the soft dark ellipse under the player,
// NPCs and creatures. Extracted from game.js (which keeps thin wrappers with
// the same names, since many modules receive them through init deps).
// Sizes and opacity come from SCRATCHBONES_CONFIG.game.assets.pngPlaneAvatar.groundShadow.
(() => {
  'use strict';

  function config() {
    return window.SCRATCHBONES_CONFIG?.game?.assets?.pngPlaneAvatar?.groundShadow || {};
  }

  function make(name = 'character_ground_shadow') {
    const THREE = window.THREE;
    const cfg = config();
    const geo = new THREE.CircleGeometry(1, 40);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(cfg.color || '#1b1712'),
      transparent: true,
      opacity: cfg.opacity ?? 0.28,
      depthWrite: false,
    });
    const shadow = new THREE.Mesh(geo, mat);
    shadow.name = name;
    shadow.renderOrder = -1;
    window.EnvironmentSurfaceMicroPlateau?.bindGroundProjection(shadow);
    shadow.scale.set(cfg.radiusX ?? 0.34, 1, cfg.radiusZ ?? 0.22);
    return shadow;
  }

  function surfaceOffset() {
    return config().surfaceOffsetY ?? 0.018;
  }

  // Ties a creature's shadow footprint to the same modelWidth used for
  // its own hit cone/collision radius (see creatureHitboxHalfSizePx)
  // instead of the player/NPC's fixed humanoid size, so e.g. a gar-wolf
  // alpha visibly casts a bigger shadow than a dabinggi-hound. Keeps the
  // configured player shadow's X:Z squash ratio rather than introducing
  // a separate tunable.
  function creatureRadii(def, sizeScaleX = 1) {
    const cfg = config();
    const baseRadiusX = cfg.radiusX ?? 0.34;
    const baseRadiusZ = cfg.radiusZ ?? 0.22;
    const radiusX = (def.modelWidth || 2) * sizeScaleX * 0.3;
    return { radiusX, radiusZ: radiusX * (baseRadiusZ / baseRadiusX) };
  }

  window.CharacterGroundShadow = { config, make, surfaceOffset, creatureRadii };
})();
