(() => {
  'use strict';

  // Honeyfuzzle swarm renderer. A honeyfuzzle "creature" (wild, farmed or
  // companion) is one gameplay entity whose presentation is a loose swarm of
  // hummingbird-like members. Hummingbirds never perch, so there is no idle/
  // run state: every member always cycles
  //   wings-up -> wings-mid -> wings-down -> wings-mid -> repeat
  // on one shared tick, with the swarm split into thirds that sit at different
  // points of that cycle. Members drift/roll deterministically (a pure function
  // of swarm seed + time + speed), and a per-member "lead" value makes some
  // members run ahead of the swarm's heading and others trail it.
  //
  // Cost model: one InstancedMesh (= one draw call) per swarm, a texture atlas
  // of the three wing frames shared by every swarm, the frame chosen per
  // instance by an attribute (no per-frame texture swaps), and per-frame work
  // that is just N small matrix writes into the instance buffer with no
  // allocations. The avatarRef returned by buildAvatar is shaped like the one
  // PNGPlaneAvatar.buildAnimalPlaneAvatarModel returns so game.js's creature
  // loop (position/rotation/tint/dispose) drives it unchanged; frontPlane is
  // the pivot group that loop yaws toward the camera-relative facing.

  const FRAME_URLS = Object.freeze([
    'assets/creaturesprites/honeyfuzzle_wings-up.png',
    'assets/creaturesprites/honeyfuzzle_wings-mid.png',
    'assets/creaturesprites/honeyfuzzle_wings-down.png',
  ]);
  const FRAME_UP = 0, FRAME_MID = 1, FRAME_DOWN = 2;
  const WING_CYCLE = Object.freeze([FRAME_UP, FRAME_MID, FRAME_DOWN, FRAME_MID]); // up -> mid -> down -> mid
  const THIRD_STEP_OFFSETS = Object.freeze([0, 1, 2]); // Each third of the swarm sits at a different point of the 4-step cycle.
  const WING_TICK_MS = 70; // One shared tick for every member of every swarm (~14 wing steps/s, ~3.6 full beats/s).
  const DEFAULT_MEMBER_COUNT = 9; // Three members per cycle offset.
  // Source art is 500x500 with the bird in roughly x 75..404, y 170..451
  // across all three frames; crop to that union (plus margin) so members are
  // not mostly transparent padding.
  const CROP = Object.freeze({ x: 70, y: 160, w: 345, h: 300 });
  const MEMBER_ASPECT = CROP.h / CROP.w;

  const TAU = Math.PI * 2;
  const GOLDEN_ANGLE = 2.399963229728653;

  // ---- pure, THREE-free helpers (unit-tested headlessly) ------------------

  function hashUnit(seed, salt) { // Deterministic 0..1 value; no Math.random so a swarm looks the same every time.
    let h = (Math.imul(seed | 0, 374761393) + Math.imul(salt | 0, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  function seedFromString(text) {
    let h = 2166136261 >>> 0;
    const s = String(text || 'honeyfuzzle');
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
    return h | 0;
  }

  function wingStep(nowMs) { return Math.floor(Math.max(0, nowMs) / WING_TICK_MS); }

  function memberFrame(memberIndex, step) { // Frame index 0=up 1=mid 2=down for one member on one shared tick.
    const offset = THIRD_STEP_OFFSETS[memberIndex % THIRD_STEP_OFFSETS.length];
    return WING_CYCLE[(((step + offset) % WING_CYCLE.length) + WING_CYCLE.length) % WING_CYCLE.length];
  }

  // Fills out = {x, y, roll, scale} (pivot-local: -x is the swarm's heading,
  // y is up). `spread` is the swarm radius in world units, `speed01` the
  // swarm's smoothed travel speed (0 hover .. 1 full run).
  function memberPose(seed, memberIndex, count, nowMs, speed01, spread, out) {
    const i = memberIndex;
    const t = nowMs / 1000;
    const ang = i * GOLDEN_ANGLE + hashUnit(seed, 11) * TAU;
    const rad = spread * Math.sqrt((i + 0.5) / Math.max(1, count));
    const homeX = Math.cos(ang) * rad;
    const homeY = Math.sin(ang) * rad * 0.6;
    const w1 = 0.7 + hashUnit(seed, 100 + i) * 0.9, w2 = 0.9 + hashUnit(seed, 200 + i) * 1.1, w3 = 1.3 + hashUnit(seed, 300 + i) * 1.4;
    const p1 = hashUnit(seed, 400 + i) * TAU, p2 = hashUnit(seed, 500 + i) * TAU, p3 = hashUnit(seed, 600 + i) * TAU;
    const wander = spread * (0.28 + 0.1 * hashUnit(seed, 700 + i));
    // lead in [-1, 1]: >0 runs ahead of the swarm's heading, <0 trails behind it.
    const lead = hashUnit(seed, 800 + i) * 2 - 1;
    const spreadAlongHeading = spread * (1.0 + 0.7 * Math.abs(lead));
    const hover = 1 - Math.min(1, speed01) * 0.15; // Tighten the cloud slightly while travelling; the lead/trail stagger below does the stretching.
    out.x = (homeX + Math.sin(t * w1 + p1) * wander + Math.sin(t * w2 * 1.7 + p2) * wander * 0.35) * hover
      - lead * speed01 * spreadAlongHeading; // -x is forward (the art faces image-left).
    out.y = (homeY + Math.sin(t * w2 + p2) * wander * 0.8 + Math.sin(t * w3 * 1.3 + p3) * wander * 0.25) * hover;
    out.roll = Math.sin(t * w3 + p3) * 0.32 + speed01 * 0.28 * (0.6 + 0.4 * lead);
    out.scale = 0.88 + hashUnit(seed, 900 + i) * 0.24;
    return out;
  }

  // ---- shared atlas (loaded once for the whole page) ----------------------

  let _atlas = null; // { canvas, texture } once ready
  let _atlasPromise = null;
  const _pendingMaterials = new Set();

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous'; // Must precede src or the canvas is tainted (see AGENTS.md).
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('honeyfuzzle frame failed to load: ' + url));
      img.src = url;
    });
  }

  function ensureAtlas(THREE) {
    if (_atlas) return Promise.resolve(_atlas);
    if (_atlasPromise) return _atlasPromise;
    _atlasPromise = Promise.all(FRAME_URLS.map(loadImage)).then(images => {
      const canvas = document.createElement('canvas');
      canvas.width = CROP.w * FRAME_URLS.length;
      canvas.height = CROP.h;
      const ctx = canvas.getContext('2d');
      images.forEach((img, index) => ctx.drawImage(img, CROP.x, CROP.y, CROP.w, CROP.h, index * CROP.w, 0, CROP.w, CROP.h));
      const surface = window.HobunjiSpritePngSurface;
      const texture = surface?.makeCanvasTexture
        ? surface.makeCanvasTexture(THREE, canvas, 'honeyfuzzle_wing_atlas')
        : new THREE.CanvasTexture(canvas);
      _atlas = { canvas, texture };
      for (const material of _pendingMaterials) { material.map = texture; material.needsUpdate = true; }
      _pendingMaterials.clear();
      return _atlas;
    }).catch(error => { _atlasPromise = null; window.__farmLog?.(`[honeyfuzzle] ${error.message}`, 'warn'); throw error; });
    return _atlasPromise;
  }

  function makeSwarmMaterial(THREE, name) {
    const surface = window.HobunjiSpritePngSurface;
    const overrides = { side: THREE.DoubleSide }; // A double-sided card reads as one physical card from either camera side.
    const material = surface?.makeMaterial
      ? surface.makeMaterial(THREE, _atlas?.texture || null, name, overrides)
      : new THREE.MeshBasicMaterial({ map: _atlas?.texture || null, transparent: true, alphaTest: 0.001, side: THREE.DoubleSide, name });
    material.onBeforeCompile = shader => { // One atlas, three frames: the per-instance aFrame attribute picks a third of the texture.
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aFrame;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_UV\nvUv.x = (vUv.x + aFrame) / 3.0;\n#endif');
    };
    material.customProgramCacheKey = () => 'honeyfuzzle_swarm_atlas';
    if (!_atlas) _pendingMaterials.add(material);
    return material;
  }

  // ---- avatar --------------------------------------------------------------

  // options: { name, seed, count, modelWidth, memberWidth }
  // modelWidth is the swarm's overall footprint; memberWidth one bird's width.
  function buildAvatar(THREE, options = {}) {
    const count = Math.max(3, Math.floor(options.count || DEFAULT_MEMBER_COUNT));
    const modelWidth = options.modelWidth || 1.3;
    const memberWidth = options.memberWidth || modelWidth * 0.3;
    const seed = Number.isFinite(options.seed) ? options.seed | 0 : seedFromString(options.name);
    const spread = modelWidth * 0.34;
    const geometry = new THREE.PlaneGeometry(memberWidth, memberWidth * MEMBER_ASPECT);
    const frameAttr = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
    geometry.setAttribute('aFrame', frameAttr);
    const material = makeSwarmMaterial(THREE, (options.name || 'honeyfuzzle') + '_swarm_mat');
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false; // Members drift outside the single-plane bounding sphere.
    mesh.renderOrder = 2;
    mesh.name = (options.name || 'honeyfuzzle') + '_swarm';
    const pivot = new THREE.Group(); // Yawed by the creature loop exactly like an animal front plane.
    pivot.name = mesh.name + '_pivot';
    pivot.rotation.y = Math.PI / 2;
    pivot.position.y = Number.isFinite(options.hoverY) ? options.hoverY : 0.35; // Hummingbirds hover above the ground the creature entity stands on.
    pivot.add(mesh);
    const group = new THREE.Group();
    group.name = (options.name || 'honeyfuzzle') + '_group';
    group.add(pivot);

    const pose = { x: 0, y: 0, roll: 0, scale: 1 };
    const zStep = 0.004; // Tiny per-member depth separation so overlapping alpha-tested cards never z-fight.
    let lastStep = -1, smoothSpeed = 0, lastNow = 0, disposed = false;
    const frames = new Float32Array(count);
    const avatar = {
      group, frontPlane: pivot, backPlane: null, swarm: mesh, memberCount: count, seed,
      update(speedPxPerS, nowMs, dtSeconds, moveSpeedPx) {
        if (disposed) return;
        const now = Number.isFinite(nowMs) ? nowMs : performance.now();
        const dt = Number.isFinite(dtSeconds) ? dtSeconds : Math.max(0, (now - lastNow) / 1000);
        lastNow = now;
        const target = Math.min(1.4, (Number(speedPxPerS) || 0) / Math.max(1, Number(moveSpeedPx) || 120));
        smoothSpeed += (target - smoothSpeed) * Math.min(1, dt * 4);
        const step = wingStep(now);
        const stepChanged = step !== lastStep;
        lastStep = step;
        const arr = mesh.instanceMatrix.array;
        for (let i = 0; i < count; i++) {
          memberPose(seed, i, count, now, smoothSpeed, spread, pose);
          const c = Math.cos(pose.roll) * pose.scale, s = Math.sin(pose.roll) * pose.scale, o = i * 16;
          arr[o] = c; arr[o + 1] = s; arr[o + 2] = 0; arr[o + 3] = 0;
          arr[o + 4] = -s; arr[o + 5] = c; arr[o + 6] = 0; arr[o + 7] = 0;
          arr[o + 8] = 0; arr[o + 9] = 0; arr[o + 10] = pose.scale; arr[o + 11] = 0;
          arr[o + 12] = pose.x; arr[o + 13] = pose.y; arr[o + 14] = (i - count / 2) * zStep; arr[o + 15] = 1;
          if (stepChanged) frames[i] = memberFrame(i, step);
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (stepChanged) { frameAttr.array.set(frames); frameAttr.needsUpdate = true; }
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        geometry.dispose();
        _pendingMaterials.delete(material);
        material.dispose(); // The shared atlas texture stays alive for the next swarm.
        mesh.dispose?.();
      },
    };
    avatar.update(0, performance.now(), 0, 120); // Valid first frame before the loop's first tick.
    ensureAtlas(THREE).catch(() => {});
    return avatar;
  }

  window.HoneyfuzzleSwarm = {
    FRAME_URLS, WING_CYCLE, WING_TICK_MS, DEFAULT_MEMBER_COUNT, CROP,
    hashUnit, seedFromString, wingStep, memberFrame, memberPose,
    buildAvatar, ensureAtlas,
  };
})();
