(() => {
  'use strict';

  // Rain and Western Slope blizzard share the same plane pool and placement/update logic.
  let deps = null;
  let group = null;
  let rainSourceTexture = null;
  const blizzardSourceTextures = [];
  let attachedScene = null;
  const layers = [];
  let cameraForward = null; // Reused by update() to avoid per-frame allocation.
  let cameraEuler = null; // Supplies independently-toggleable camera X/Y/Z rotation.
  let rowTravelCoordinate = 0; // Player travel projected onto the current precipitation-row axis; preserves walking-through-row parallax while yaw rotates around the player.
  let rowLastPlayerX = null;
  let rowLastPlayerZ = null;
  let initCount = 0; // Exposed in getDebugState() to catch accidental precipitation reinitialization during store/interior transitions.

  const RAW_SPRITE_LEAN_DEG = -30; // Native procedural streak lean before correction.
  const SPRITE_PRE_ROTATION_DEG = 30; // Corrects the native sprite so neutral rain points down.
  const WESTERN_SLOPE_ID = 'map_western_slope'; // Western Slope swaps snow content into the ordinary rain planes.
  const BLIZZARD_AUDIO_RAIN_STRENGTH = 1; // Used only while mixing BGS so the blizzard gets a quiet wind bed instead of full rain-strength wind.

  const CAMERA_CONFIG = [
    { distance: 4.5, repeatX: 6.0, repeatY: 5.0, speed: 1.08, opacity: 0.20 },
    { distance: 8.0, repeatX: 9.0, repeatY: 6.8, speed: 0.78, opacity: 0.15 },
    { distance: 12.5, repeatX: 12.0, repeatY: 9.0, speed: 0.55, opacity: 0.10 },
  ];

  const BLIZZARD_PRESET = Object.freeze({
    density: 2000,
    windDirection: 250,
    windSpeed: 850,
    gravity: 70,
    gusts: 0,
    streakChance: 1,
    textureWidth: 640,
    textureHeight: 360,
    seed: 1592594996,
  }); // Matches the accepted prototype settings; only the plane content differs from rain at runtime.

  const settings = {
    mode: 'rows', // Row Bands is the production default; Arena buttons can compare both modes.
    lockRowZ: true, // Locks each experimental band to a row in the player-centered precipitation frame.
    followScreenX: true, // Slides a row band laterally within its rotated plane to keep it centered in view.
    followCameraY: true, // Slides a row band vertically along the camera's view ray.
    inheritRotationX: false, // Applies camera pitch to each plane.
    inheritRotationY: false, // Camera-sheet mode toggle; row mode always follows camera yaw as one player-centered lattice.
    inheritRotationZ: false, // Applies camera roll to each plane.
    scaleWithCameraDistance: false, // Optional old behavior; off keeps row-band depth visually legible.
    speedMultiplier: 3, // Global precipitation UV speed, exposed in the Testing Arena.
    rowSpacingTiles: 2.5, // Controls distance between precipitation bands along the camera-yaw row axis.
    frontCount: 5, // Number of nearest row bands kept active toward the camera.
    behindCount: 12, // Number of nearest row bands kept active behind the player.
  };

  function clampNumber(value, min, max, fallback) {
    value = Number(value);
    return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
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

  function isWesternSlopeBlizzardActive() {
    return Boolean(
      deps
      && deps.getCurrentArea?.() === WESTERN_SLOPE_ID
      && deps.isOutdoorArea?.()
      && deps.calendar?.isRaining
    );
  }

  function installBlizzardAudioRouting() {
    const music = window.Music;
    if (!music || music.__westernSlopeBlizzardAudioRoutingInstalled) return;
    if (typeof music.updateRainAudio !== 'function' || typeof music.updateExteriorBgs !== 'function') return;

    const priorUpdateRainAudio = music.updateRainAudio;
    const priorUpdateExteriorBgs = music.updateExteriorBgs;

    music.updateRainAudio = function (...args) {
      if (!isWesternSlopeBlizzardActive()) return priorUpdateRainAudio.apply(this, args);

      // Reuse the rain audio mixer's own fade/stop path by presenting this one
      // precipitation case as dry. This fades gentle/mid/heavy rain to zero
      // without reaching into music-system.js's private looping-BGS registry.
      const priorRaining = deps.calendar.isRaining;
      deps.calendar.isRaining = false;
      try {
        return priorUpdateRainAudio.apply(this, args);
      } finally {
        deps.calendar.isRaining = priorRaining;
      }
    };

    music.updateExteriorBgs = function (...args) {
      if (!isWesternSlopeBlizzardActive()) return priorUpdateExteriorBgs.apply(this, args);

      // The ordinary exterior mixer already owns the real wind recordings and
      // smooth BGS fades. Feed it a deliberately low weather strength so a
      // blizzard gets one subtle wind layer instead of the stronger rain mix.
      const priorRainStrength = deps.calendar.rainStrength;
      deps.calendar.rainStrength = BLIZZARD_AUDIO_RAIN_STRENGTH;
      try {
        return priorUpdateExteriorBgs.apply(this, args);
      } finally {
        deps.calendar.rainStrength = priorRainStrength;
      }
    };

    music.__westernSlopeBlizzardAudioRoutingInstalled = true;
  }

  function createRainSourceTexture() {
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

  function putSnowPixel(imageData, x, y, alpha) {
    const width = imageData.width;
    const height = imageData.height;
    x = ((x % width) + width) % width;
    y = ((y % height) + height) % height;
    const index = (y * width + x) * 4;
    const a = Math.max(imageData.data[index + 3], alpha);
    imageData.data[index] = 255;
    imageData.data[index + 1] = 255;
    imageData.data[index + 2] = 255;
    imageData.data[index + 3] = a;
  }

  function createBlizzardSourceTexture(layerIndex) {
    const THREE = deps.THREE;
    const width = BLIZZARD_PRESET.textureWidth;
    const height = BLIZZARD_PRESET.textureHeight;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(width, height);
    const random = mulberry32((BLIZZARD_PRESET.seed + layerIndex * 0x9E3779B9) >>> 0);

    // The first prototype rendered a 640x360 field of tiny, hard white pixels.
    // Split that density across the three authored depth families while keeping
    // every flake one-to-a-few literal pixels with no glow or filtering.
    const layerDensityScale = [0.46, 0.34, 0.20][layerIndex % 3];
    const referenceArea = 1280 * 720;
    const areaScale = (width * height) / referenceArea;
    const count = Math.max(1, Math.round(BLIZZARD_PRESET.density * areaScale * layerDensityScale));
    const windRadians = BLIZZARD_PRESET.windDirection * Math.PI / 180;
    const streakDX = Math.cos(windRadians);
    const streakDY = Math.sin(windRadians);
    const depthLengths = [5, 3, 2];
    const maxLength = depthLengths[layerIndex % depthLengths.length];

    for (let i = 0; i < count; i++) {
      const x = Math.floor(random() * width);
      const y = Math.floor(random() * height);
      const alpha = Math.round(155 + random() * 100);
      const length = 1 + Math.floor(random() * maxLength);
      for (let s = 0; s < length; s++) {
        const px = Math.round(x - streakDX * s);
        const py = Math.round(y - streakDY * s);
        putSnowPixel(imageData, px, py, Math.max(64, alpha - s * 26));
      }
    }

    ctx.putImageData(imageData, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
  }

  function cloneConfiguredTexture(source, config, index) {
    const THREE = deps.THREE;
    const texture = source.clone();
    texture.image = source.image;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(config.repeatX, config.repeatY);
    texture.offset.set(index * 0.173, index * 0.317);
    texture.minFilter = source.minFilter;
    texture.magFilter = source.magFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
  }

  function makeLayer(index) {
    const THREE = deps.THREE;
    const configIndex = index % CAMERA_CONFIG.length;
    const config = CAMERA_CONFIG[configIndex];
    const rainTexture = cloneConfiguredTexture(rainSourceTexture, config, index);
    const blizzardTexture = cloneConfiguredTexture(blizzardSourceTextures[configIndex], config, index);
    const material = new THREE.MeshBasicMaterial({
      map: rainTexture,
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
    return {
      mesh,
      material,
      texture: rainTexture,
      rainTexture,
      blizzardTexture,
      contentKind: 'rain',
      config,
      rowKey: null,
      currentOpacity: 0,
    };
  }

  function ensureLayerCount(count) {
    while (layers.length < count) layers.push(makeLayer(layers.length));
  }

  function setLayerContent(layer, kind) {
    if (layer.contentKind === kind) return;
    const texture = kind === 'blizzard' ? layer.blizzardTexture : layer.rainTexture;
    layer.texture = texture;
    layer.material.map = texture;
    layer.material.color.set(kind === 'blizzard' ? 0xffffff : 0xcce8ff);
    layer.material.needsUpdate = true;
    layer.contentKind = kind;
  }

  function setAllLayerContent(kind) {
    layers.forEach(layer => setLayerContent(layer, kind));
  }

  function resetRowFrameTracking() {
    rowTravelCoordinate = 0;
    rowLastPlayerX = null;
    rowLastPlayerZ = null;
  }

  function init(injectedDeps) {
    deps = injectedDeps;
    initCount++;
    if (group) {
      // Scene transitions should never rebuild the precipitation pool. Refreshing
      // deps is sufficient and avoids orphaning the old layer meshes if init is
      // accidentally reached again while entering/leaving an interior.
      installBlizzardAudioRouting();
      return;
    }
    const THREE = deps.THREE;
    rainSourceTexture = createRainSourceTexture();
    blizzardSourceTextures.length = 0;
    for (let i = 0; i < CAMERA_CONFIG.length; i++) blizzardSourceTextures.push(createBlizzardSourceTexture(i));
    cameraEuler = new THREE.Euler(0, 0, 0, 'YXZ');
    group = new THREE.Group();
    group.name = 'world_rain_planes';
    group.userData.isBillboard = true;
    ensureLayerCount(3);
    installBlizzardAudioRouting();
  }

  function advanceTexture(layer, dt, speedMultiplier) {
    // The same UV movement drives both rain and snow; Western Slope only swaps plane content.
    layer.texture.offset.y = (layer.texture.offset.y + dt * layer.config.speed * speedMultiplier) % 1;
  }

  function applyPlaneRotation(mesh, yawOverride = null) {
    mesh.rotation.set(
      settings.inheritRotationX ? cameraEuler.x : 0,
      Number.isFinite(yawOverride) ? yawOverride : (settings.inheritRotationY ? cameraEuler.y : 0),
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

  function desiredRows(playerRowCoordinate) {
    const spacing = settings.rowSpacingTiles;
    const rows = [];
    const gridPosition = playerRowCoordinate / spacing;
    const addDirection = (sign, count, side) => {
      const firstIndex = sign > 0 ? Math.floor(gridPosition) + 1 : Math.ceil(gridPosition) - 1;
      const maxDistance = Math.max(spacing, spacing * count);
      for (let i = 0; i < count; i++) {
        const rowCoordinate = (firstIndex + sign * i) * spacing;
        rows.push({
          rowCoordinate,
          side,
          distance: Math.abs(rowCoordinate - playerRowCoordinate),
          maxDistance,
          order: i,
        });
      }
    };
    // Local +Z is defined as the camera-facing direction, so "front" is always positive in this frame.
    addDirection(1, settings.frontCount, 'front');
    addDirection(-1, settings.behindCount, 'behind');
    return rows;
  }

  function assignRowLayers(assignments) {
    ensureLayerCount(Math.max(3, assignments.length));
    const unused = new Set(layers);
    const claimed = assignments.map(assignment => {
      const key = `${assignment.side}:${assignment.rowCoordinate}`;
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
    const horizontalForwardLength = Math.hypot(cameraForward.x, cameraForward.z);
    // PlaneGeometry faces +Z at yaw 0. Rotate that local +Z to point back toward
    // the camera, so the entire row lattice rotates around the player's X/Z.
    const rowYaw = horizontalForwardLength > 0.0001
      ? Math.atan2(-cameraForward.x, -cameraForward.z)
      : cameraEuler.y;
    const cosYaw = Math.cos(rowYaw);
    const sinYaw = Math.sin(rowYaw);

    // Keep the old "walking through equally spaced rows" effect. Rotation alone
    // does not change row phase; only player movement projected along the current
    // row axis advances the scalar lattice coordinate.
    if (rowLastPlayerX !== null && rowLastPlayerZ !== null) {
      const dx = playerX - rowLastPlayerX;
      const dz = playerZ - rowLastPlayerZ;
      const rowAxisX = sinYaw;
      const rowAxisZ = cosYaw;
      rowTravelCoordinate += dx * rowAxisX + dz * rowAxisZ;
    }
    rowLastPlayerX = playerX;
    rowLastPlayerZ = playerZ;

    // Transform camera X/Z into the unrotated row frame. In that frame the old
    // north/south row math remains valid and camera yaw can never make the ray
    // denominator collapse toward zero.
    const cameraDX = context.camera.position.x - playerX;
    const cameraDZ = context.camera.position.z - playerZ;
    const localCameraX = cameraDX * cosYaw - cameraDZ * sinYaw;
    const localCameraZ = cameraDX * sinYaw + cameraDZ * cosYaw;
    const localForwardX = cameraForward.x * cosYaw - cameraForward.z * sinYaw;
    const localForwardZ = cameraForward.x * sinYaw + cameraForward.z * cosYaw;

    const active = assignRowLayers(desiredRows(rowTravelCoordinate));
    const activeLayers = new Set(active.map(entry => entry.layer));
    layers.forEach(layer => { if (!activeLayers.has(layer)) layer.mesh.visible = false; });

    for (const { assignment, layer } of active) {
      const { mesh, material, config } = layer;
      const cameraRelativeDistance = config.distance;
      const localZ = settings.lockRowZ
        ? assignment.rowCoordinate - rowTravelCoordinate
        : localCameraZ + localForwardZ * cameraRelativeDistance;
      let rayDistance = Math.abs(cameraRelativeDistance);
      if (settings.lockRowZ && Math.abs(localForwardZ) > 0.001) {
        rayDistance = (localZ - localCameraZ) / localForwardZ;
      }
      const sizingDistance = Math.max(0.5, Math.abs(rayDistance));
      const scaleDistance = settings.scaleWithCameraDistance ? sizingDistance : 8;
      const viewHeight = 2 * scaleDistance * context.halfFovTan;
      const localX = settings.followScreenX
        ? localCameraX + localForwardX * rayDistance
        : 0;
      const x = playerX + localX * cosYaw + localZ * sinYaw;
      const z = playerZ - localX * sinYaw + localZ * cosYaw;
      const y = settings.followCameraY
        ? context.camera.position.y + cameraForward.y * rayDistance
        : deps.getPlayerGroundY() + viewHeight * 0.5;
      const distanceFade = Math.max(0, Math.min(1, 1 - assignment.distance / assignment.maxDistance));
      const targetOpacity = config.opacity * context.opacityMultiplier * distanceFade;
      const fadeLerp = 1 - Math.exp(-dt / 0.32);
      layer.currentOpacity += (targetOpacity - layer.currentOpacity) * fadeLerp;
      material.opacity = layer.currentOpacity;
      mesh.position.set(x, y, z);
      applyPlaneRotation(mesh, rowYaw);
      mesh.scale.set(viewHeight * context.aspect * 1.8, viewHeight * 1.8, 1);
      mesh.renderOrder = 900 + Math.max(0, 20 - Math.round(sizingDistance));
      mesh.visible = layer.currentOpacity > 0.001 || targetOpacity > 0;
      advanceTexture(layer, dt, context.speedMultiplier * settings.speedMultiplier);
    }
  }

  function hideLayers() {
    layers.forEach(layer => {
      layer.mesh.visible = false;
      layer.currentOpacity = 0;
      layer.material.opacity = 0;
      layer.rowKey = null;
    });
    resetRowFrameTracking();
  }

  function update(dt) {
    if (!deps || !group) return;
    const activeScene = deps.getActiveScene();
    const area = deps.getCurrentArea?.() ?? null;
    const precipitating = deps.isOutdoorArea() && deps.calendar.isRaining;
    const contentKind = area === WESTERN_SLOPE_ID ? 'blizzard' : 'rain';

    if (activeScene !== attachedScene) {
      attachedScene?.remove(group);
      activeScene?.add(group);
      attachedScene = activeScene;
      resetRowFrameTracking();
    }

    group.visible = precipitating;
    if (!precipitating) {
      hideLayers();
      return;
    }

    ensureLayerCount(settings.mode === 'rows' ? Math.max(3, settings.frontCount + settings.behindCount) : 3);
    setAllLayerContent(contentKind);

    const THREE = deps.THREE;
    const camera = deps.camera;
    camera.getWorldDirection(cameraForward);
    cameraEuler.setFromQuaternion(camera.quaternion, 'YXZ');
    // Both rain and Western Slope snow use this exact precipitation-rate path.
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
    const area = deps?.getCurrentArea?.() ?? null;
    const activeScene = deps?.getActiveScene?.() ?? null;
    const blizzardActive = Boolean(group?.visible && area === WESTERN_SLOPE_ID && deps?.calendar?.isRaining);
    const horizontalForwardLength = cameraForward ? Math.hypot(cameraForward.x, cameraForward.z) : 0;
    const rowYaw = horizontalForwardLength > 0.0001
      ? Math.atan2(-cameraForward.x, -cameraForward.z)
      : (cameraEuler?.y || 0);
    let precipitationGroupCount = 0;
    activeScene?.traverse?.(node => {
      if (node?.name === 'world_rain_planes') precipitationGroupCount++;
    });
    return {
      initialized: Boolean(group),
      initCount,
      repeatedInitCount: Math.max(0, initCount - 1),
      visible: Boolean(group?.visible),
      area,
      attachedScene: attachedScene?.name || attachedScene?.uuid || null,
      groupParent: group?.parent?.name || group?.parent?.uuid || null,
      precipitationGroupCount,
      strength: deps?.calendar?.rainStrength ?? 0,
      precipitationRenderer: blizzardActive ? 'rain-logic+blizzard-content' : 'rain',
      precipitationLayout: settings.mode === 'rows' ? 'player-centered-camera-yaw-rows' : 'camera-sheets',
      rowYawRadians: rowYaw,
      rowTravelCoordinate,
      layerPoolSize: layers.length,
      layerCount: layers.filter(layer => layer.mesh.visible).length,
      blizzardPreset: { ...BLIZZARD_PRESET },
      activeContent: blizzardActive ? 'blizzard' : 'rain',
      blizzardAudioRouting: Boolean(window.Music?.__westernSlopeBlizzardAudioRoutingInstalled),
      settings: getSettings(),
      renderer: deps?.renderer?.info?.render ? { ...deps.renderer.info.render } : null,
    };
  }

  window.RainPlanes = { init, update, setSettings, getSettings, getDebugState };
})();

// sky-dome.js must wrap CalendarSystem/WeatherFX/RainPlanes before game.js initializes them.
// rain-planes.js is already parser-blocking in index.html immediately before game boot, so this
// synchronous include keeps that ordering without adding another bootstrap path to the huge game.js.
if (!window.HobunjiSkyDome) {
  if (document.readyState === 'loading') document.write('<script src="js/sky-dome.js?v=20260823a"></scr' + 'ipt>');
  else {
    const skyScript = document.createElement('script'); // Used only as a late-load fallback outside the normal parser boot path.
    skyScript.src = 'js/sky-dome.js?v=20260823a';
    skyScript.async = false;
    document.head.appendChild(skyScript);
  }
}

// Three.js renders transparent objects after opaque world geometry. The sky's transparent
// cloud/celestial layers therefore need depth testing even though they never write depth;
// otherwise they would paint over buildings. This guard also keeps the skydome exterior-only.
if (window.HobunjiSkyDome && window.RainPlanes) {
  let skyDeps = null; // Captured from RainPlanes.init; used to locate the same active scene and outdoor-area state as the rain/skydome runtime.
  let guardedSkyScene = null; // Keys the cached sky root so getObjectByName never traverses a stable scene every frame.
  let guardedSkyRoot = null; // Remembers the current area scene's skydome root so material traversal only happens on scene changes.
  const priorRainInit = window.RainPlanes.init;
  const priorRainUpdate = window.RainPlanes.update;
  window.RainPlanes.init = function (injectedDeps) {
    skyDeps = injectedDeps;
    return priorRainInit.call(this, injectedDeps);
  };
  window.RainPlanes.update = function (dt) {
    const result = priorRainUpdate.call(this, dt);
    const scene = skyDeps?.getActiveScene?.() || null;
    if (scene !== guardedSkyScene || !guardedSkyRoot || guardedSkyRoot.parent !== scene) {
      guardedSkyScene = scene;
      guardedSkyRoot = scene?.getObjectByName?.('hobunji_dynamic_skydome') || null;
      if (guardedSkyRoot) {
        guardedSkyRoot.traverse(node => {
          if (node.material?.transparent) {
            node.material.depthTest = true;
            node.material.depthWrite = false;
            node.material.needsUpdate = true;
          }
        });
      }
    }
    if (guardedSkyRoot) guardedSkyRoot.visible = skyDeps.isOutdoorArea?.() !== false;
    return result;
  };
}

// The environmental surface runtime deliberately piggybacks on RainPlanes' existing
// init/update dependency boundary, just as the skydome does above. Keeping this parser-
// blocking avoids another game.js integration point while still giving snow/slush the
// live scene, current-area, season, and outdoor-state getters it needs.
if (!window.EnvironmentSurfaceRuntime) {
  if (document.readyState === 'loading') document.write('<script src="js/environment-surface-runtime.js?v=20260912a"></scr' + 'ipt>');
  else {
    const surfaceScript = document.createElement('script'); // Late-load fallback used only when rain-planes.js is evaluated after initial parsing.
    surfaceScript.src = 'js/environment-surface-runtime.js?v=20260912a';
    surfaceScript.async = false;
    document.head.appendChild(surfaceScript);
  }
}
