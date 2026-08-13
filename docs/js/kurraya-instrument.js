(() => {
  'use strict';

  // Kurraya hold assembly + reactive twitch — extracted out of game.js
  // following the same window.<Namespace> + init(deps) pattern already used
  // by js/fishing-minigame.js and js/mount-system.js.
  //
  // Ported directly from the reference mockup's authored two-plane
  // "avatarEquipmentAuthoring.kurraya" fit (EMBEDDED_FOROJI_RECORD in the
  // uploaded HAMusicMinigameV2.html — a front-view plane crossed with a
  // top-view plane, tilted together) and its note-reactive twitch
  // (triggerKurrayaGameplayTwitch/updateKurrayaGameplayTwitch) instead of a
  // plain flat billboard: front.png alone read as a static 2D cutout from
  // most angles, and an idle sine sway had nothing to do with the actual
  // music. The twitch fires per real sounded note instead (see
  // js/music-minigame.js's 'sounded-note' relay), so the instrument visibly
  // reacts to what's actually playing rather than looping on its own
  // independent clock.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  const KURRAYA_TOP_ASSET = { path: 'assets/toolsprites/kurraya_top.png', width: 318, height: 247 };
  // The front plane's own geometry/scale already comes from the caller's
  // TOOL_ITEM_DEFS.kurraya/toolTextures — only the top plane's relationship
  // to it, and the whole assembly's rest tilt, are authored data here.
  const KURRAYA_TOP_PART = {
    position: { x: 0.0005558199292840047, y: 0.43167346207010837, z: -0.155 },
    rotationDeg: { x: 90, y: -1.987846675914698e-16, z: -178.43603708156874 },
    scaleRelativeToFront: 0.46 / 0.46, // Both parts were authored at the same 0.46 plane scale — kept as an explicit ratio rather than assuming equal.
  };
  // Of the assembly's authored attachment tilt (x≈0°, y≈5.2°, z≈-72.4°),
  // Z is the one clearly off a clean 90°-multiple — chooseKurrayaTwitchAxis
  // in the reference mockup picks exactly this axis for this exact fit.
  const KURRAYA_REST_ROTATION = { x: 0, y: 5.212597280558908 * Math.PI / 180, z: -72.398815421906 * Math.PI / 180 };
  const KURRAYA_TWITCH_AXIS = 'z';

  let _kurrayaTopTexture = null;
  function kurrayaTopTexture() {
    if (_kurrayaTopTexture) return _kurrayaTopTexture;
    const THREE = deps.THREE;
    _kurrayaTopTexture = deps.toolTexLoader.load(KURRAYA_TOP_ASSET.path);
    _kurrayaTopTexture.magFilter = THREE.NearestFilter;
    _kurrayaTopTexture.minFilter = THREE.NearestFilter;
    return _kurrayaTopTexture;
  }

  // Builds the crossed front+top plane assembly at its authored rest tilt.
  // Position/scale of the outer group is left to the caller (station-tool
  // props and the player's held-item holder each have their own existing
  // hand-attachment convention); only the parts' relative geometry to each
  // other is authored here.
  function buildAssembly() {
    const THREE = deps.THREE;
    const frontTex = deps.toolTextures.kurraya;
    if (!frontTex) return null;
    const def = deps.getKurrayaDef?.();
    const frontW = deps.TOOL_MODEL_WIDTH * 0.92, frontH = frontW * ((def?._imgH || 663) / (def?._imgW || 320));
    const group = new THREE.Group();
    group.name = 'kurraya_assembly';
    const frontGeo = new THREE.PlaneGeometry(frontW, frontH);
    const frontMat = new THREE.MeshBasicMaterial({ map: frontTex, transparent: true, alphaTest: 0.05, side: THREE.DoubleSide });
    const front = new THREE.Mesh(frontGeo, frontMat);
    front.renderOrder = deps.heldObjectRenderOrder;
    group.add(front);

    const topAspect = KURRAYA_TOP_ASSET.height / KURRAYA_TOP_ASSET.width;
    const topW = frontW * KURRAYA_TOP_PART.scaleRelativeToFront;
    const topGeo = new THREE.PlaneGeometry(topW, topW * topAspect);
    const topMat = new THREE.MeshBasicMaterial({ map: kurrayaTopTexture(), transparent: true, alphaTest: 0.05, side: THREE.DoubleSide });
    const top = new THREE.Mesh(topGeo, topMat);
    top.renderOrder = deps.heldObjectRenderOrder;
    // The reference mockup builds front/top as siblings with their OWN
    // individual 0.46 mesh scale, while position lives in their shared
    // parent's un-scaled local space — so top.position is already an
    // absolute offset calibrated against that same 0.46 front scale, not a
    // fraction of frontW to be multiplied in. Converting by (frontW/0.46)
    // instead of frontW alone reproduces that reference scale exactly
    // (this fit's frontW happens to equal 0.46 already) while staying
    // correct if frontW is ever tuned differently.
    const REFERENCE_FRONT_SCALE = 0.46;
    const topPosScale = frontW / REFERENCE_FRONT_SCALE;
    top.position.set(KURRAYA_TOP_PART.position.x * topPosScale, KURRAYA_TOP_PART.position.y * topPosScale, KURRAYA_TOP_PART.position.z * topPosScale);
    top.rotation.set(
      THREE.MathUtils.degToRad(KURRAYA_TOP_PART.rotationDeg.x),
      THREE.MathUtils.degToRad(KURRAYA_TOP_PART.rotationDeg.y),
      THREE.MathUtils.degToRad(KURRAYA_TOP_PART.rotationDeg.z)
    );
    group.add(top);

    group.rotation.set(KURRAYA_REST_ROTATION.x, KURRAYA_REST_ROTATION.y, KURRAYA_REST_ROTATION.z);
    group.userData.kurrayaAssembly = true;
    return group;
  }

  // One twitch-state record per performer (the player, or a given NPC) —
  // see triggerTwitch/updateTwitch below.
  function newTwitchState() { return { active: false, axis: KURRAYA_TWITCH_AXIS, base: 0, amplitude: 0.04, startedAt: 0, durationMs: 0, phase: 0, frequency: 16 }; }

  function triggerTwitch(twitchState, group) {
    if (!group?.userData.kurrayaAssembly) return;
    const axis = twitchState.axis;
    if (twitchState.active) group.rotation[axis] = twitchState.base; // Every retrigger first returns to the exact rest angle, matching restoreKurrayaGameplayTwitch.
    else twitchState.base = KURRAYA_REST_ROTATION[axis];
    twitchState.active = true;
    twitchState.amplitude = Math.min(0.22, (Number(twitchState.amplitude) || 0.04) + 0.06 + Math.random() * 0.025);
    twitchState.startedAt = performance.now();
    twitchState.durationMs = 270 + Math.random() * 120;
    twitchState.phase = Math.random() * Math.PI * 2;
    twitchState.frequency = 16 + Math.random() * 8;
  }

  function updateTwitch(twitchState, group) {
    if (!twitchState.active || !group?.userData.kurrayaAssembly) return;
    const now = performance.now();
    const elapsed = now - twitchState.startedAt;
    const axis = twitchState.axis;
    if (elapsed >= twitchState.durationMs) {
      group.rotation[axis] = twitchState.base;
      twitchState.active = false;
      return;
    }
    const progress = elapsed / twitchState.durationMs;
    const envelope = Math.pow(1 - progress, 1.35);
    const offset = Math.sin((elapsed / 1000) * twitchState.frequency + twitchState.phase) * twitchState.amplitude * envelope;
    group.rotation[axis] = twitchState.base + offset;
  }

  window.KurrayaInstrument = { init, buildAssembly, newTwitchState, triggerTwitch, updateTwitch };
})();
