(() => {
  'use strict';

  // Camera sheets and experimental map-row bands share one dynamically-sized mesh pool.
  let deps = null;
  let group = null;
  let sourceTexture = null;
  let attachedScene = null;
  const layers = [];
  let cameraForward = null; // Reused by update() to avoid per-frame allocation.
  let cameraEuler = null; // Supplies independently-toggleable camera X/Y/Z rotation.

  const RAW_SPRITE_LEAN_DEG = -30; // Native procedural streak lean before correction.
  const SPRITE_PRE_ROTATION_DEG = 30; // Corrects the native sprite so neutral rain points down.

  const CAMERA_CONFIG = [
    { distance: 4.5, repeatX: 6.0, repeatY: 5.0, speed: 1.08, opacity: 0.20 },
    { distance: 8.0, repeatX: 9.0, repeatY: 6.8, speed: 0.78, opacity: 0.15 },
    { distance: 12.5, repeatX: 12.0, repeatY: 9.0, speed: 0.55, opacity: 0.10 },
  ];
  const settings = {
    mode: 'rows', // Row Bands is the production default; Arena buttons can compare both modes.
    lockRowZ: true, // Locks each experimental band to a world-Z row.
    followScreenX: true, // Slides a row band along X to keep it centered in view.
    followCameraY: true, // Slides a row band vertically along the camera's view ray.
    inheritRotationX: false, // Applies camera pitch to each plane.
    inheritRotationY: false, // Keeps row planes world-aligned instead of inheriting camera yaw.
    inheritRotationZ: false, // Applies camera roll to each plane.
    scaleWithCameraDistance: false, // Optional old behavior; off keeps row-band depth visually legible.
    speedMultiplier: 3, // Global rain UV speed, exposed in the Testing Arena.
    rowSpacingTiles: 2.5, // Controls the world-Z distance between experimental bands.
    frontCount: 5, // Number of nearest row bands kept active toward the camera.
    behindCount: 12, // Number of nearest row bands kept active behind the player.
  };

  function clampNumber(value, min, max, fallback) {
    value = Number(value);
    return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  }

  function createSourceTexture() {
    const THREE = deps.THREE;
    cameraForward = new THREE.Vector3(0, 0, -1);
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const random = mulberry32(0x484f4255);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#d8efff';
    ctx.lineCap = 'round';
    for (let i = 0; i < 74; i++) {
      const x = random() * canvas.width;
      const y = random() * canvas.height;
      const length = 9 + random() * 27;
      const correctedAngle = (RAW_SPRITE_LEAN_DEG + SPRITE_PRE_ROTATION_DEG) * Math.PI / 180;
      ctx.globalAlpha = 0.28 + random() * 0.58;
      ctx.lineWidth = 0.65 + random() * 1.15;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.sin(correctedAngle) * length, y + Math.cos(correctedAngle) * length);
      ctx.stroke();
      if (y + Math.cos(correctedAngle) * length > canvas.height) {
        ctx.beginPath();
        ctx.moveTo(x, y - canvas.height);
        ctx.lineTo(x + Math.sin(correctedAngle) * length, y + Math.cos(correctedAngle) * length - canvas.height);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
  }

  function mulberry32(seed) {
    return () => {
      seed |= 0;
      seed = seed + 0x6D2B79F5 | 0;
      let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
      value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
  }

  function makeLayer(index) {
    const THREE = deps.THREE;
    const config = CAMERA_CONFIG[index % CAMERA_CONFIG.length];
    const texture = sourceTexture.clone();
    texture.image = sourceTexture.image;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(config.repeatX, config.repeatY);
    texture.offset.set(index * 0.173, index * 0.317);
    texture.needsUpdate = true;
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      color: 0xcce8ff,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: false,
      fog: true,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    mesh.name = `world_rain_plane_${index + 1}`;
    mesh.frustumCulled = false;
    mesh.renderOrder = 900;
    mesh.userData.isBillboard = true;
    mesh.visible = false;
    group.add(mesh);
    return { mesh, material, texture, config, rowKey: null, currentOpacity: 0 };
  }

  function ensureLayerCount(count) {
    while (layers.length < count) layers.push(makeLayer(layers.length));
  }

  function init(injectedDeps) {
    deps = injectedDeps;
    const THREE = deps.THREE;
    sourceTexture = createSourceTexture();
    cameraEuler = new THREE.Euler(0, 0, 0, 'YXZ');
    group = new THREE.Group();
    group.name = 'world_rain_planes';
    group.userData.isBillboard = true;
    ensureLayerCount(3);
  }

  function advanceTexture(layer, dt, speedMultiplier) {
    // Canvas UV origin makes positive Y offset move the drawn drops downward on screen.
    layer.texture.offset.y = (layer.texture.offset.y + dt * layer.config.speed * speedMultiplier) % 1;
  }

  function applyPlaneRotation(mesh) {
    mesh.rotation.set(
      settings.inheritRotationX ? cameraEuler.x : 0,
      settings.inheritRotationY ? cameraEuler.y : 0,
      settings.inheritRotationZ ? cameraEuler.z : 0,
      'YXZ',
    );
  }

  function updateCameraLayers(dt, context) {
    ensureLayerCount(3);
    layers.forEach((layer, index) => {
      if (index >= 3) { layer.mesh.visible = false; return; }
      const { mesh, material, config } = layer;
      const viewHeight = 2 * config.distance * context.halfFovTan;
      mesh.position.set(
        context.camera.position.x + cameraForward.x * config.distance,
        context.camera.position.y + cameraForward.y * config.distance,
        context.camera.position.z + cameraForward.z * config.distance,
      );
      applyPlaneRotation(mesh);
      mesh.scale.set(viewHeight * context.aspect * 1.8, viewHeight * 1.8, 1);
      mesh.renderOrder = 900 + (2 - index);
      material.opacity = config.opacity * context.opacityMultiplier;
      layer.currentOpacity = material.opacity;
      layer.rowKey = null;
      mesh.visible = true;
      advanceTexture(layer, dt, context.speedMultiplier * settings.speedMultiplier);
    });
  }

  function desiredRows(playerZ, towardCameraSign) {
    const spacing = settings.rowSpacingTiles;
    const rows = [];
    const gridPosition = playerZ / spacing;
    const addDirection = (sign, count, side) => {
      const firstIndex = sign > 0 ? Math.floor(gridPosition) + 1 : Math.ceil(gridPosition) - 1;
      const maxDistance = Math.max(spacing, spacing * count);
      for (let i = 0; i < count; i++) {
        const z = (firstIndex + sign * i) * spacing;
        rows.push({ z, side, distance: Math.abs(z - playerZ), maxDistance, order: i });
      }
    };
    addDirection(towardCameraSign, settings.frontCount, 'front');
    addDirection(-towardCameraSign, settings.behindCount, 'behind');
    return rows;
  }

  function assignRowLayers(assignments) {
    ensureLayerCount(Math.max(3, assignments.length));
    const unused = new Set(layers);
    const claimed = assignments.map(assignment => {
      const key = `${assignment.side}:${assignment.z}`;
      const layer = [...unused].find(candidate => candidate.rowKey === key) || null;
      if (layer) unused.delete(layer);
      return { assignment, key, layer };
    });
    for (const entry of claimed) {
      if (entry.layer) continue;
      entry.layer = unused.values().next().value;
      unused.delete(entry.layer);
      entry.layer.rowKey = entry.key;
      entry.layer.currentOpacity = 0;
      entry.layer.material.opacity = 0;
    }
    return claimed;
  }

  function updateRowLayers(dt, context) {
    const playerX = deps.player.x / deps.TILE;
    const playerZ = deps.player.y / deps.TILE;
    const towardCameraSign = Math.sign(context.camera.position.z - playerZ) || 1;
    const active = assignRowLayers(desiredRows(playerZ, towardCameraSign));
    const activeLayers = new Set(active.map(entry => entry.layer));
    layers.forEach(layer => { if (!activeLayers.has(layer)) layer.mesh.visible = false; });

    for (const { assignment, layer } of active) {
      const { mesh, material, config } = layer;
      const cameraRelativeDistance = config.distance;
      const z = settings.lockRowZ
        ? assignment.z
        : context.camera.position.z + cameraForward.z * cameraRelativeDistance;
      let rayDistance = Math.abs(cameraRelativeDistance);
      if (settings.lockRowZ && Math.abs(cameraForward.z) > 0.001) {
        rayDistance = (z - context.camera.position.z) / cameraForward.z;
      }
      const sizingDistance = Math.max(0.5, Math.abs(rayDistance));
      const scaleDistance = settings.scaleWithCameraDistance ? sizingDistance : 8;
      const viewHeight = 2 * scaleDistance * context.halfFovTan;
      const x = settings.followScreenX
        ? context.camera.position.x + cameraForward.x * rayDistance
        : playerX;
      const y = settings.followCameraY
        ? context.camera.position.y + cameraForward.y * rayDistance
        : deps.getPlayerGroundY() + viewHeight * 0.5;
      const distanceFade = Math.max(0, Math.min(1, 1 - assignment.distance / assignment.maxDistance));
      const targetOpacity = config.opacity * context.opacityMultiplier * distanceFade;
      const fadeLerp = 1 - Math.exp(-dt / 0.32);
      layer.currentOpacity += (targetOpacity - layer.currentOpacity) * fadeLerp;
      material.opacity = layer.currentOpacity;
      mesh.position.set(x, y, z);
      applyPlaneRotation(mesh);
      mesh.scale.set(viewHeight * context.aspect * 1.8, viewHeight * 1.8, 1);
      mesh.renderOrder = 900 + Math.max(0, 20 - Math.round(sizingDistance));
      mesh.visible = layer.currentOpacity > 0.001 || targetOpacity > 0;
      advanceTexture(layer, dt, context.speedMultiplier * settings.speedMultiplier);
    }
  }

  function update(dt) {
    if (!deps || !group) return;
    const activeScene = deps.getActiveScene();
    const raining = deps.isOutdoorArea() && deps.calendar.isRaining;
    if (activeScene !== attachedScene) {
      attachedScene?.remove(group);
      activeScene?.add(group);
      attachedScene = activeScene;
    }
    group.visible = raining;
    if (!raining) return;

    const THREE = deps.THREE;
    const camera = deps.camera;
    camera.getWorldDirection(cameraForward);
    cameraEuler.setFromQuaternion(camera.quaternion, 'YXZ');
    // rainStrength is the weather system's precipitation-rate value. Strength 2
    // is the normal-rain baseline; fractional/future values interpolate too.
    const precipitationRate = clampNumber(deps.calendar.rainStrength, 0.1, 6, 2);
    const precipitationRatio = precipitationRate / 2;
    const context = {
      camera,
      speedMultiplier: clampNumber(0.55 + precipitationRatio * 0.45, 0.35, 1.9, 1),
      opacityMultiplier: clampNumber(0.35 + precipitationRatio * 0.65, 0.2, 2.0, 1),
      aspect: Math.max(0.5, Number(camera.aspect) || 1),
      halfFovTan: Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5),
    };
    if (settings.mode === 'rows') updateRowLayers(dt, context);
    else updateCameraLayers(dt, context);
  }

  function setSettings(patch = {}) {
    if (patch.mode === 'camera' || patch.mode === 'rows') settings.mode = patch.mode;
    if (typeof patch.lockRowZ === 'boolean') settings.lockRowZ = patch.lockRowZ;
    if (typeof patch.followScreenX === 'boolean') settings.followScreenX = patch.followScreenX;
    if (typeof patch.followCameraY === 'boolean') settings.followCameraY = patch.followCameraY;
    if (typeof patch.inheritRotationX === 'boolean') settings.inheritRotationX = patch.inheritRotationX;
    if (typeof patch.inheritRotationY === 'boolean') settings.inheritRotationY = patch.inheritRotationY;
    if (typeof patch.inheritRotationZ === 'boolean') settings.inheritRotationZ = patch.inheritRotationZ;
    if (typeof patch.scaleWithCameraDistance === 'boolean') settings.scaleWithCameraDistance = patch.scaleWithCameraDistance;
    if ('speedMultiplier' in patch) settings.speedMultiplier = clampNumber(patch.speedMultiplier, 0.25, 12, 3);
    if ('rowSpacingTiles' in patch) settings.rowSpacingTiles = clampNumber(patch.rowSpacingTiles, 0.5, 24, 2.5);
    if ('frontCount' in patch) settings.frontCount = Math.round(clampNumber(patch.frontCount, 0, 12, 5));
    if ('behindCount' in patch) settings.behindCount = Math.round(clampNumber(patch.behindCount, 0, 12, 12));
    ensureLayerCount(Math.max(3, settings.frontCount + settings.behindCount));
    return getSettings();
  }

  function getSettings() {
    return { ...settings };
  }

  function getDebugState() {
    return {
      initialized: Boolean(group),
      visible: Boolean(group?.visible),
      area: deps?.getCurrentArea?.() ?? null,
      strength: deps?.calendar?.rainStrength ?? 0,
      layerCount: layers.filter(layer => layer.mesh.visible).length,
      settings: getSettings(),
      renderer: deps?.renderer?.info?.render ? { ...deps.renderer.info.render } : null,
    };
  }

  window.RainPlanes = { init, update, setSettings, getSettings, getDebugState };
})();
