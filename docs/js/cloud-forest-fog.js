(() => {
  'use strict';

  // A handful of large, translucent white cylinders centered on the player,
  // shown only in the Southern Cloud Forest. That zone's own FogExp2 (see
  // game.js's buildZoneScene, EXTERIOR_ZONES.map_southern_cloud_forest's
  // fogDensity) already fades the whole scene toward white well before its
  // vegCullRadiusTiles — but a per-pixel exponential fog reads as flat,
  // computed haze with no real presence. These cylinders are actual
  // geometry the camera sits inside of (BackSide material, so the inward-
  // facing surface is what's lit), layered on top of the ordinary fog
  // rather than replacing it, so drifting mist patches occlude things the
  // way ground fog with real volume would. Same self-contained
  // window.<Namespace> + init(deps)/update(dt) shape as rain-planes.js.
  let deps = null;
  let group = null;
  let texture = null;
  const layers = [];

  // The innermost shell is pinned to an absolute, close-to-the-player
  // distance rather than a fraction of the outer (cull-radius-matched) one
  // below — 5 tiles puts real, textured mist geometry well inside the
  // player's immediate surroundings instead of only appearing well out
  // toward the cull edge. The middle shell keeps the same closer-in ratio
  // to the inner one it held back when both were fractions of the outer
  // radius (0.70 / 0.42 = 5/3), just re-anchored to the new inner distance.
  const INNER_RADIUS_TILES = 5;
  const MIDDLE_RADIUS_TILES = INNER_RADIUS_TILES * (0.70 / 0.42); // = 25/3 ≈ 8.33
  // radiusFrac scales the outer (cull-radius-matched) distance for the
  // outermost shell only, so it stays tied to wherever
  // updateZoneVegetationCulling's vegetation cull actually pops trees in/out
  // even if that radius is ever retuned.
  const LAYER_CONFIG = [
    { radiusTiles: INNER_RADIUS_TILES, height: 6.5, opacity: 0.14, repeatX: 5, repeatY: 1.3, driftSpeed: 0.007, spinSpeed: 0.012 },
    { radiusTiles: MIDDLE_RADIUS_TILES, height: 8.5, opacity: 0.26, repeatX: 7, repeatY: 1.7, driftSpeed: -0.005, spinSpeed: -0.008 },
    { radiusFrac: 1.00, height: 10.5, opacity: 0.46, repeatX: 9, repeatY: 2.1, driftSpeed: 0.004, spinSpeed: 0.006 },
  ];
  // Matches map_southern_cloud_forest's vegCullRadiusTiles — used only if a
  // real value can't be read from deps for some reason.
  const FALLBACK_OUTER_RADIUS_TILES = 34;

  function mulberry32(seed) {
    return () => {
      seed |= 0;
      seed = seed + 0x6D2B79F5 | 0;
      let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
      value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
  }

  // Fallback "spray paint" mist texture: soft white blotches at random
  // size/alpha. Each blob is also stamped at its wrap-around offsets so
  // RepeatWrapping tiles it around the cylinder without a hard seam.
  function createSprayTexture() {
    const THREE = deps.THREE;
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const random = mulberry32(0x666f6721);
    ctx.clearRect(0, 0, size, size);
    const stampBlob = (x, y, r, alpha) => {
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `rgba(255,255,255,${alpha})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    };
    for (let i = 0; i < 70; i++) {
      const x = random() * size, y = random() * size;
      const r = 18 + random() * 58;
      const alpha = 0.12 + random() * 0.34;
      for (const dx of [-size, 0, size]) {
        for (const dy of [-size, 0, size]) {
          if (x + dx > -r && x + dx < size + r && y + dy > -r && y + dy < size + r) stampBlob(x + dx, y + dy, r, alpha);
        }
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
  }

  // Quietly upgrades every already-built layer to a real authored asset if
  // one shows up at this path later — a 404/parse error just leaves the
  // procedural fallback in place. Called only after `layers` is populated
  // (see init) so a same-tick/cached resolve can't find it still empty.
  function upgradeTextureIfAvailable() {
    const THREE = deps.THREE;
    new THREE.TextureLoader().load(
      'assets/textures/cloud_forest_mist.png',
      loaded => {
        loaded.wrapS = loaded.wrapT = THREE.RepeatWrapping;
        loaded.minFilter = THREE.LinearFilter;
        loaded.magFilter = THREE.LinearFilter;
        for (const layer of layers) {
          layer.material.map = loaded;
          layer.material.needsUpdate = true;
        }
      },
      undefined,
      () => {},
    );
  }

  function makeLayer(config, index) {
    const THREE = deps.THREE;
    const tex = texture.clone();
    tex.image = texture.image;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(config.repeatX, config.repeatY);
    tex.offset.set(index * 0.271, index * 0.133);
    tex.needsUpdate = true;
    const material = new THREE.MeshBasicMaterial({
      map: tex,
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      side: THREE.BackSide, // camera sits inside the shell — light the inward face
      depthWrite: false,
      depthTest: true,
      fog: true,
    });
    // Unit cylinder, open-ended (no caps) — scaled per-frame to the current
    // outer radius so a live radius change (e.g. tuning vegCullRadiusTiles)
    // doesn't need geometry rebuilt.
    const geometry = new THREE.CylinderGeometry(1, 1, 1, 28, 1, true);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `cloud_forest_mist_${index}`;
    mesh.frustumCulled = false;
    mesh.renderOrder = 890 + index;
    mesh.visible = false;
    group.add(mesh);
    return { mesh, material, config };
  }

  function init(injectedDeps) {
    deps = injectedDeps;
    const THREE = deps.THREE;
    texture = createSprayTexture();
    group = new THREE.Group();
    group.name = 'cloud_forest_mist_cylinders';
    for (let i = 0; i < LAYER_CONFIG.length; i++) layers.push(makeLayer(LAYER_CONFIG[i], i));
    upgradeTextureIfAvailable();
  }

  let attachedScene = null;
  function update(dt) {
    if (!deps || !group) return;
    const active = deps.isCloudForestArea();
    const activeScene = active ? deps.getActiveScene() : null;
    if (activeScene !== attachedScene) {
      attachedScene?.remove(group);
      activeScene?.add(group);
      attachedScene = activeScene;
    }
    group.visible = active;
    if (!active) return;

    const outerRadius = deps.getCloudForestFogRadiusTiles?.() ?? FALLBACK_OUTER_RADIUS_TILES;
    const px = deps.player.x / deps.TILE, pz = deps.player.y / deps.TILE;
    const groundY = deps.getPlayerGroundY();
    const t = performance.now() / 1000;

    for (const layer of layers) {
      const { mesh, material, config } = layer;
      const radius = config.radiusTiles ?? outerRadius * config.radiusFrac;
      mesh.position.set(px, groundY + config.height * 0.5, pz);
      mesh.scale.set(radius, config.height, radius);
      mesh.rotation.y = t * config.spinSpeed;
      material.opacity = config.opacity;
      material.map.offset.x = (material.map.offset.x + dt * config.driftSpeed) % 1;
      material.map.offset.y = (material.map.offset.y + dt * config.driftSpeed * 0.6) % 1;
      mesh.visible = true;
    }
  }

  window.CloudForestFog = { init, update };
})();
