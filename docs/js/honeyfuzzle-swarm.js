(() => {
  'use strict';

  // Honeyfuzzle swarm renderer. A honeyfuzzle "creature" (wild, farmed or
  // companion) is one gameplay entity whose presentation is a loose swarm of
  // hummingbird-like members. Hummingbirds never perch, so there is no idle/
  // run state: members blend the three fly poses continuously, with three
  // phase-offset groups to simulate the translucent blur of hummingbird wings.
  // Members drift/roll deterministically (a pure function
  // of swarm seed + time + speed), and a per-member "lead" value makes some
  // members run ahead of the swarm's heading and others trail it.
  //
  // Cost model: one InstancedMesh (= one draw call) per swarm and a shared
  // five-cell atlas (three fly poses, tail, spectacles). The fragment shader
  // blends the wing poses and composites/tints tail BELOW body, spectacles
  // ABOVE it. Only one time uniform and the existing N pose matrices change
  // per frame; no per-member canvas or texture uploads. The avatarRef returned by buildAvatar is shaped like the one
  // PNGPlaneAvatar.buildAnimalPlaneAvatarModel returns so game.js's creature
  // loop (position/rotation/tint/dispose) drives it unchanged; frontPlane is
  // the pivot group that loop yaws toward the camera-relative facing.

  const FRAME_URLS = Object.freeze([
    'assets/creaturesprites/honeyfuzzle_fly1.png',
    'assets/creaturesprites/honeyfuzzle_fly2.png',
    'assets/creaturesprites/honeyfuzzle_fly3.png',
  ]);
  const PATTERN_URLS = Object.freeze([
    'assets/creaturesprites/patterns/honeyfuzzle_tailfeathers.png',
    'assets/creaturesprites/patterns/honeyfuzzle_spectacles.png',
  ]); // Always load the anatomical tail and optional spectacles just once for every swarm.
  const ATLAS_COLS = 3, ATLAS_ROWS = 2; // Packs five authored 478x399 sprites into 1434x798 instead of a too-wide 2390x399 mobile texture.
  const FRAME_UP = 0, FRAME_MID = 1, FRAME_DOWN = 2;
  const WING_CYCLE = Object.freeze([FRAME_UP, FRAME_MID, FRAME_DOWN, FRAME_MID]); // up -> mid -> down -> mid
  const THIRD_STEP_OFFSETS = Object.freeze([0, 1, 2]); // Each third of the swarm sits at a different point of the 4-step cycle.
  const WING_TICK_MS = 55; // Legacy wing-step helper retained for older callers/tests.
  const FLUTTER_HZ = 16; // Subtle apparent-wing opacity shimmer, not a literal resolved wingbeat; the three superposed poses imply the much faster physical flapping.
  const DEFAULT_MEMBER_COUNT = 24; // Many small members read as a swarm rather than a flock; a multiple of 3 keeps the wing-cycle thirds exactly even.
  // The new fly1/2/3 and both authored patterns are already cropped to the
  // SAME 478x399 coordinates. Cropping with the legacy 500x500 inset would
  // cut off wings and tails and even make the atlas load fail.
  const CROP = Object.freeze({ x: 0, y: 0, w: 478, h: 399 });
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

  // Bee-style motion. Each member is a darting hoverer, not a glider: it holds
  // near a point, zips to a new random point inside the cloud, holds again, and
  // faces whichever way it last darted. Every member has its own dart period and
  // phase, so at any instant some are mid-zip and some are hovering, and the cloud
  // as a whole stays put and breathes. Points come from a hash of
  // (seed, member, dart index), so the motion is deterministic and needs no state.
  const DART_MIN_S = 0.28, DART_SPAN_S = 0.5; // Per-member time between darts.
  const DART_TRAVEL_FRACTION = 0.4; // Share of each period spent moving; the rest is a hover.

  function dartPoint(seed, member, dartIndex, spread, out) {
    const salt = member * 7919 + dartIndex * 104729;
    const angle = hashUnit(seed, 1000 + salt) * TAU;
    const radius = spread * Math.pow(hashUnit(seed, 2000 + salt), 0.75); // Biased toward the middle so the cloud reads dense.
    out.x = Math.cos(angle) * radius;
    out.y = Math.sin(angle) * radius * 0.7;
    return out;
  }

  const _dartA = { x: 0, y: 0 }, _dartB = { x: 0, y: 0 };

  // Fills out = {x, y, roll, scale, flip} (pivot-local: -x is the swarm's heading,
  // y is up; flip is +1 when the member faces image-left, -1 when mirrored to face
  // right). `spread` is the cloud radius in world units, `speed01` the swarm's
  // smoothed travel speed (0 hover .. 1 full run).
  function memberPose(seed, memberIndex, count, nowMs, speed01, spread, out) {
    const i = memberIndex;
    const t = nowMs / 1000;
    const period = DART_MIN_S + DART_SPAN_S * hashUnit(seed, 100 + i);
    const phase = hashUnit(seed, 200 + i);
    const progress = t / period + phase;
    const dartIndex = Math.floor(progress);
    const f = progress - dartIndex;
    const travel = Math.min(1, f / DART_TRAVEL_FRACTION);
    const u = 1 - (1 - travel) * (1 - travel); // Fast start, soft stop: a zip then a hover.
    const breathe = 1 + 0.12 * Math.sin(t * 1.7 + hashUnit(seed, 11) * TAU); // The whole cloud slowly swells and tightens.
    dartPoint(seed, i, dartIndex, spread, _dartA);
    dartPoint(seed, i, dartIndex + 1, spread, _dartB);
    const buzz = spread * 0.035;
    const buzzW = 38 + 22 * hashUnit(seed, 300 + i), buzzP = hashUnit(seed, 400 + i) * TAU;
    // lead in [-1, 1]: >0 runs ahead of the swarm's heading, <0 trails behind it.
    const lead = hashUnit(seed, 800 + i) * 2 - 1;
    const stretch = spread * (1.0 + 0.7 * Math.abs(lead));
    const tight = 1 - Math.min(1, speed01) * 0.15; // Tighten the cloud slightly while travelling.
    out.x = (_dartA.x + (_dartB.x - _dartA.x) * u) * breathe * tight + Math.sin(t * buzzW + buzzP) * buzz
      - lead * speed01 * stretch; // -x is forward (the art faces image-left).
    out.y = (_dartA.y + (_dartB.y - _dartA.y) * u) * breathe * tight + Math.cos(t * buzzW * 0.83 + buzzP) * buzz;
    // Face the last dart's direction; a travelling swarm mostly faces forward.
    const dx = _dartB.x - _dartA.x, dy = _dartB.y - _dartA.y;
    out.flip = speed01 > 0.5 ? 1 : (dx < 0 ? 1 : -1);
    const tilt = dy / (spread * 1.4 + 1e-6) * (1 - u * u); // Nose follows the zip, then levels off while hovering.
    out.roll = -out.flip * tilt * 0.9 + Math.sin(t * 9 + buzzP) * 0.1 + out.flip * speed01 * 0.2;
    out.scale = 0.88 + hashUnit(seed, 900 + i) * 0.24;
    return out;
  }

  // ---- shared atlas (loaded once for the whole page) ----------------------

  let _atlas = null; // { canvas, texture } once ready
  let _atlasPromise = null;
  let _lastAtlasError = null; // Exposed by debugSnapshot for mobile diagnosis of failed sprite URLs or canvas initialization.
  const _pendingMaterials = new Set();
  let _linkedWildOrCompanions = 0; // Mobile diagnostics count successful actor-to-swarm genotype bindings.

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
    _atlasPromise = Promise.all([...FRAME_URLS, ...PATTERN_URLS].map(loadImage)).then(images => {
      const canvas = document.createElement('canvas');
      canvas.width = CROP.w * ATLAS_COLS;
      canvas.height = CROP.h * ATLAS_ROWS;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('honeyfuzzle atlas canvas has no 2D context');
      images.forEach((img, index) => {
        if (img.width < CROP.x + CROP.w || img.height < CROP.y + CROP.h) {
          throw new Error('honeyfuzzle sprite too small for common crop: ' + [...FRAME_URLS, ...PATTERN_URLS][index]);
        }
        // The three flight bodies occupy canvas row 1 (GPU UV bottom).
        // The tail and spectacles occupy row 0 (GPU UV top).
        const atlasCol = index < FRAME_URLS.length ? index : index - FRAME_URLS.length;
        const atlasRow = index < FRAME_URLS.length ? 1 : 0;
        ctx.drawImage(img, CROP.x, CROP.y, CROP.w, CROP.h, atlasCol * CROP.w, atlasRow * CROP.h, CROP.w, CROP.h);
      });
      const surface = window.HobunjiSpritePngSurface;
      const texture = surface?.makeCanvasTexture
        ? surface.makeCanvasTexture(THREE, canvas, 'honeyfuzzle_wing_atlas')
        : new THREE.CanvasTexture(canvas);
      _atlas = { canvas, texture };
      _lastAtlasError = null;
      for (const material of _pendingMaterials) { material.map = texture; material.needsUpdate = true; }
      _pendingMaterials.clear();
      return _atlas;
    }).catch(error => { _atlasPromise = null; _lastAtlasError = String(error?.message || error); window.__farmLog?.(`[honeyfuzzle] ${_lastAtlasError}`, 'warn'); throw error; });
    return _atlasPromise;
  }

  // Recolor and layer expression are per-swarm uniforms; all five sprites
  // stay in the shared atlas, including the always-visible tail under the
  // bird. Unexpressed tail genes use the primary body color, never vanish.
  const BODY_LUMINANCE = 0.62;
  function expressed(layer) {
    return !!layer?.color && layer.enabled !== false && (layer.copies == null || Number(layer.copies) > 0);
  }
  function appearanceColors(color, genotype) {
    const base = color || genotype?.base?.color || null;
    const tail = genotype?.tailfeathers || genotype?.tailfeather; // Accept legacy/singular authoring data without multiplying genetic slots.
    const tailColor = expressed(tail) ? tail.color : base;
    const spectaclesColor = expressed(genotype?.spectacles) ? genotype.spectacles.color : null;
    return { base, tailColor, spectaclesColor, distinctTail: expressed(tail) };
  }

  const MAP_FRAGMENT = `
#ifdef USE_MAP
  vec2 uv = vUv;
  vec4 fly1 = mapTexelToLinear( texture2D( map, uv ) );
  vec4 fly2 = mapTexelToLinear( texture2D( map, uv + vec2( 0.3333333, 0.0 ) ) );
  vec4 fly3 = mapTexelToLinear( texture2D( map, uv + vec2( 0.6666667, 0.0 ) ) );
  // Weights rotate smoothly at hummingbird speed; all three poses contribute
  // every frame. Aligned bodies stay solid, disjoint wings become soft trails.
  float phase = uWingPhase + vWingOffset * 2.0943951;
  vec3 weights = vec3( 0.4 ) + 0.16 * cos( phase + vec3( 0.0, 2.0943951, 4.1887902 ) );
  weights /= weights.x + weights.y + weights.z;
  float flyAlpha = dot( vec3( fly1.a, fly2.a, fly3.a ), weights );
  vec3 flyColor = ( fly1.rgb * fly1.a * weights.x +
                    fly2.rgb * fly2.a * weights.y +
                    fly3.rgb * fly3.a * weights.z ) / max( flyAlpha, 0.0001 );
  vec4 body = tintHoneyfuzzle( vec4( flyColor, flyAlpha ), uBody, uUse );
  vec4 tail = tintHoneyfuzzle(
    mapTexelToLinear( texture2D( map, uv + vec2( 0.0, 0.5 ) ) ), uTailColor, uTailUse );
  vec4 composed = overlayHoneyfuzzle( body, tail ); // The tail is behind all body/fly pixels.
  if ( uSpectaclesUse > 0.5 ) {
    vec4 spectacles = tintHoneyfuzzle(
      mapTexelToLinear( texture2D( map, uv + vec2( 0.3333333, 0.5 ) ) ), uSpectaclesColor, 1.0 );
    composed = overlayHoneyfuzzle( spectacles, composed );
  }
  diffuseColor *= composed;
#endif
`;

  const HONEYFUZZLE_SHADER_HELPERS = `
uniform vec3 uBody;
uniform float uUse;
uniform vec3 uTailColor;
uniform float uTailUse;
uniform vec3 uSpectaclesColor;
uniform float uSpectaclesUse;
uniform float uWingPhase;
varying float vWingOffset;
vec4 tintHoneyfuzzle( vec4 pixel, vec3 target, float enabled ) {
  if ( enabled < 0.5 ) return pixel;
  float lum = dot( pixel.rgb, vec3( 0.299, 0.587, 0.114 ) );
  float coat = smoothstep( 0.15, 0.35, lum ); // Protect outline, feet, beak and pupils.
  float ratio = lum / 0.62;
  vec3 tint = target * min( ratio, 1.0 ) +
    ( vec3( 1.0 ) - target ) * clamp( ( ratio - 1.0 ) * 0.9, 0.0, 1.0 );
  pixel.rgb = mix( pixel.rgb, max( tint, vec3( 0.09 ) ), coat );
  return pixel;
}
vec4 overlayHoneyfuzzle( vec4 foreground, vec4 background ) {
  float alpha = foreground.a + background.a * ( 1.0 - foreground.a );
  vec3 rgb = ( foreground.rgb * foreground.a +
    background.rgb * background.a * ( 1.0 - foreground.a ) ) / max( alpha, 0.0001 );
  return vec4( rgb, alpha );
}
`;

  function makeSwarmMaterial(THREE, name, colors) {
    const surface = window.HobunjiSpritePngSurface;
    const overrides = { side: THREE.DoubleSide, transparent: true, depthWrite: false, alphaTest: 0.001 }; // Ghosted wings must blend rather than mask other birds behind them.
    const material = surface?.makeMaterial
      ? surface.makeMaterial(THREE, _atlas?.texture || null, name, overrides)
      : new THREE.MeshBasicMaterial({ map: _atlas?.texture || null, ...overrides, name });
    const uniforms = {
      uBody: { value: new THREE.Color(colors.base || '#ffffff') },
      uUse: { value: colors.base ? 1 : 0 },
      uTailColor: { value: new THREE.Color(colors.tailColor || '#ffffff') },
      uTailUse: { value: colors.tailColor ? 1 : 0 },
      uSpectaclesColor: { value: new THREE.Color(colors.spectaclesColor || '#ffffff') },
      uSpectaclesUse: { value: colors.spectaclesColor ? 1 : 0 },
      uWingPhase: { value: 0 },
    }; // Updated per avatar for genetic colors/wing phase, not per bird or per canvas.
    material.userData.honeyfuzzle = uniforms;
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aFrame;\nvarying float vWingOffset;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvWingOffset = aFrame;\n#ifdef USE_UV\nvUv.xy /= vec2(3.0, 2.0);\n#endif');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + HONEYFUZZLE_SHADER_HELPERS)
        .replace('#include <map_fragment>', MAP_FRAGMENT);
    };
    material.customProgramCacheKey = () => 'honeyfuzzle_five_layer_blur_v1';
    if (!_atlas) _pendingMaterials.add(material);
    return material;
  }

  // ---- avatar --------------------------------------------------------------

  function liveCreatureForId(id) {
    const combat = window.Combat?.deps; // Existing shared combat dependency container already holds the active creature sets.
    if (!combat || id == null) return null;
    for (const set of [combat.hostileObjects, combat.companionObjects]) {
      if (!set) continue;
      for (const creature of set) if (creature?.id === id || String(creature?.id) === String(id)) return creature;
    }
    return null;
  }

  // options: { name, seed, count, modelWidth, memberWidth, color, genotype }
  // `color` is the zone/egg primary coat, and expressed genotype patterns provide their own secondary tint.
  // modelWidth is the swarm's overall footprint; memberWidth one bird's width.
  function buildAvatar(THREE, options = {}) {
    const count = Math.max(3, Math.floor(options.count || DEFAULT_MEMBER_COUNT));
    const modelWidth = options.modelWidth || 1.3;
    const memberWidth = options.memberWidth || modelWidth * 0.3;
    const seed = Number.isFinite(options.seed) ? options.seed | 0 : seedFromString(options.name);
    const spread = modelWidth * 0.3;
    const geometry = new THREE.PlaneGeometry(memberWidth, memberWidth * MEMBER_ASPECT);
    const framePhases = new Float32Array(count); // Permanent 0/1/2 member offsets stagger the wing-blur weights.
    for (let i = 0; i < count; i++) framePhases[i] = i % 3;
    const frameAttr = new THREE.InstancedBufferAttribute(framePhases, 1);
    geometry.setAttribute('aFrame', frameAttr);
    const material = makeSwarmMaterial(THREE, (options.name || 'honeyfuzzle') + '_swarm_mat', appearanceColors(options.color, options.genotype));
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

    const pose = { x: 0, y: 0, roll: 0, scale: 1, flip: 1 };
    const zStep = 0.003; // Tiny per-member depth separation so overlapping alpha-tested cards never z-fight.
    let smoothSpeed = 0, smoothSpread = 1, lastNow = 0, disposed = false;
    let baseColor = options.color || options.genotype?.base?.color || null; // The current primary dye, used when setColor() is called after spawning.
    let genotype = options.genotype || null; // Optional inherited secondary tint and spectacles; null is valid for old saves.
    let linkedCreature = null; // Used only to pick up genotype on wild/companion spawn, whose main renderer forwards color but not genes.
    let nextActorLookup = 0; // Repeated at most twice per second until the actor is visible in the shared creature sets.
    const needsActorLink = !String(options.name || '').startsWith('house_') && !genotype; // House renders pass their record directly.
    const applyColors = () => {
      const colors = appearanceColors(baseColor, genotype);
      const u = material.userData.honeyfuzzle;
      u.uUse.value = colors.base ? 1 : 0;
      u.uTailUse.value = colors.tailColor ? 1 : 0;
      u.uSpectaclesUse.value = colors.spectaclesColor ? 1 : 0;
      if (colors.base) u.uBody.value.set(colors.base);
      if (colors.tailColor) u.uTailColor.value.set(colors.tailColor);
      if (colors.spectaclesColor) u.uSpectaclesColor.value.set(colors.spectaclesColor);
    };
    const avatar = {
      group, frontPlane: pivot, backPlane: null, swarm: mesh, memberCount: count, seed,
      update(speedPxPerS, nowMs, dtSeconds, moveSpeedPx, spreadScale) {
        if (disposed) return;
        const now = Number.isFinite(nowMs) ? nowMs : performance.now();
        if (needsActorLink && !linkedCreature && now >= nextActorLookup) {
          nextActorLookup = now + 500;
          linkedCreature = liveCreatureForId(options.name);
          if (linkedCreature) {
            if (linkedCreature.swarmColor && !baseColor) baseColor = linkedCreature.swarmColor;
            genotype = linkedCreature.genotype || null;
            applyColors();
            _linkedWildOrCompanions++;
          }
        }
        if (linkedCreature && linkedCreature.genotype !== genotype) {
          genotype = linkedCreature.genotype || null;
          applyColors();
        }
        const dt = Number.isFinite(dtSeconds) ? dtSeconds : Math.max(0, (now - lastNow) / 1000);
        lastNow = now;
        const target = Math.min(1.4, (Number(speedPxPerS) || 0) / Math.max(1, Number(moveSpeedPx) || 120));
        smoothSpeed += (target - smoothSpeed) * Math.min(1, dt * 4);
        const targetSpread = Number.isFinite(spreadScale) && spreadScale > 0 ? spreadScale : 1; // Attached Swarm uses a dense cloud; ordinary flight uses the authored normal spread.
        const spreadCatchup = targetSpread < smoothSpread ? 16 : 9; // Tighten rapidly on contact, then unfurl into normal flight after detaching.
        smoothSpread += (targetSpread - smoothSpread) * Math.min(1, dt * spreadCatchup);
        material.userData.honeyfuzzle.uWingPhase.value = Math.max(0, now) * 0.001 * FLUTTER_HZ * TAU; // Fluid opacity glimmer across the three permanently superposed wing poses.
        const arr = mesh.instanceMatrix.array;
        for (let i = 0; i < count; i++) {
          memberPose(seed, i, count, now, smoothSpeed, spread * smoothSpread, pose);
          const c = Math.cos(pose.roll) * pose.scale, s = Math.sin(pose.roll) * pose.scale, o = i * 16;
          arr[o] = c * pose.flip; arr[o + 1] = s * pose.flip; arr[o + 2] = 0; arr[o + 3] = 0; // flip mirrors the member to face right
          arr[o + 4] = -s; arr[o + 5] = c; arr[o + 6] = 0; arr[o + 7] = 0;
          arr[o + 8] = 0; arr[o + 9] = 0; arr[o + 10] = pose.scale; arr[o + 11] = 0;
          arr[o + 12] = pose.x; arr[o + 13] = pose.y; arr[o + 14] = (i - count / 2) * zStep; arr[o + 15] = 1;
        }
        mesh.instanceMatrix.needsUpdate = true;
      },
      setColor(color) { baseColor = color || null; applyColors(); }, // Keeps default tail synchronized with primary color.
      setGenotype(next) { genotype = next || null; applyColors(); }, // Allows stable/wild appearance updates without rebuilding the swarm.
      dispose() {
        if (disposed) return;
        disposed = true;
        geometry.dispose();
        _pendingMaterials.delete(material);
        material.dispose(); // The shared atlas texture stays alive for the next swarm.
        mesh.dispose?.();
      },
    };
    applyColors();
    avatar.update(0, performance.now(), 0, 120); // Valid first frame before the loop's first tick.
    ensureAtlas(THREE).catch(() => {});
    return avatar;
  }

  window.HoneyfuzzleSwarm = {
    FRAME_URLS, PATTERN_URLS, ATLAS_COLS, ATLAS_ROWS, WING_CYCLE, WING_TICK_MS, FLUTTER_HZ, DEFAULT_MEMBER_COUNT, CROP,
    hashUnit, seedFromString, wingStep, memberFrame, memberPose, appearanceColors,
    buildAvatar, ensureAtlas,
    debugSnapshot: () => ({ atlasReady: !!_atlas, atlasPending: !!_atlasPromise, error: _lastAtlasError, linkedActors: _linkedWildOrCompanions, assets: [...FRAME_URLS, ...PATTERN_URLS], atlasSize: _atlas ? [_atlas.canvas.width, _atlas.canvas.height] : null }),
  };
})();
