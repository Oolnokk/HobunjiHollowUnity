(() => {
  'use strict';

  const ASSET_BASE = './assets/sky_sprites/';
  const CLOUD_NAMES = Array.from({ length: 8 }, (_, i) => `cloud${i + 1}.png`);
  const CLOCK_OLD_TARGET_SECONDS = 672;
  const CLOCK_FULL_DAY_TARGET_SECONDS = 1008; // Used by the outer time01 accessor to preserve the existing ~42 real seconds per represented game hour across all 24 hours.
  const EXTRA_NATURAL_TIME_SCALE = CLOCK_OLD_TARGET_SECONDS / CLOCK_FULL_DAY_TARGET_SECONDS; // Applied before CalendarSystem's existing 3/7 natural-time scale so the combined scale becomes 2/7.
  const DAY_ROLLOVER_HOUR = 6;
  // Gameplay camera far=200. A camera-centered sphere larger than that gets its
  // forward cap clipped into a perfect screen-locked circle. Keep only the
  // opaque sky shell safely inside the far plane; preserve celestial distance.
  const SKY_RADIUS = 198;
  const CELESTIAL_RADIUS = 197;
  const CLOUD_RADII = [176, 184, 192];
  const CLOUD_SPEEDS = [0.0018, 0.00105, 0.00055];
  const CLOUD_COUNTS = [24, 32, 42];
  const SUN_SIZE = 22;
  const MOON_SIZE = 20;

  let deps = null;
  let weatherDeps = null;
  let activeScene = null;
  let root = null;
  let skyMaterial = null;
  let cloudGroup = null;
  let celestialGroup = null;
  let cloudBands = [];
  let sunPack = null;
  let moonPack = null;
  let sourceMoonImage = null;
  let assetsReady = false;
  let assetsLoading = false;
  let lastCloudBucket = -1;
  let lastMoonDay = -1;
  let lastLoggedHourBucket = -1;
  let clockDeps = null;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const mod = (value, modulus) => ((value % modulus) + modulus) % modulus;
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (a, b, value) => {
    const t = clamp((value - a) / Math.max(0.000001, b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };

  function debugLog(message, level = 'info') {
    const logger = deps?.debugLog || window.__farmLog || console.log;
    try { logger(`[sky] ${message}`, level); }
    catch { console.log(`[sky] ${message}`); }
  }

  function getHour() {
    const value = window.CalendarSystem?.getHour?.();
    return Number.isFinite(value) ? mod(value, 24) : 12;
  }

  function nightFactor(hour = getHour()) {
    const h = hour < 12 ? hour + 24 : hour; // Used to treat dusk→midnight→dawn as one continuous interval.
    if (h < 18) return 0;
    if (h < 20) return smoothstep(18, 20, h);
    if (h < 29) return 1;
    if (h < 31) return 1 - smoothstep(29, 31, h);
    return 0;
  }

  function currentCloudCover() {
    const calendar = deps?.calendar;
    if (!calendar) return 0.34;
    if (calendar.rainStrength >= 3 || calendar.weather === 'storm') return 1;
    if (calendar.rainStrength >= 2) return 0.78;
    if (calendar.rainStrength >= 1 || calendar.isRaining || calendar.weather === 'rain') return 0.62;
    return 0.34;
  }

  function currentCloudBucket() {
    const cover = currentCloudCover();
    return cover >= 0.9 ? 3 : cover >= 0.7 ? 2 : cover >= 0.5 ? 1 : 0;
  }

  function starVisibility() {
    const coverSuppression = 1 - clamp(currentCloudCover() * 0.78, 0, 0.82);
    const rainSuppression = deps?.calendar?.isRaining ? 0.72 : 1;
    const stormSuppression = deps?.calendar?.rainStrength >= 3 ? 0 : 1;
    return clamp(nightFactor() * coverSuppression * rainSuppression * stormSuppression, 0, 1);
  }

  function fullDayLightingState() {
    const rawHour = getHour();
    const h = rawHour < DAY_ROLLOVER_HOUR ? rawHour + 24 : rawHour; // Used to interpolate continuously across midnight toward the 06:00 rollover.
    const stops = [
      [6, 40, 30, 80, 0.55], [6.5, 220, 100, 40, 0.38], [7.5, 240, 160, 60, 0.22],
      [9, 255, 230, 180, 0.08], [12, 255, 245, 210, 0.04], [15, 255, 225, 160, 0.10],
      [17.5, 255, 160, 60, 0.28], [18.5, 220, 90, 30, 0.42], [19.5, 130, 50, 80, 0.52],
      [20.5, 30, 30, 80, 0.62], [22, 10, 10, 40, 0.72], [24, 6, 9, 25, 0.78],
      [26, 5, 8, 23, 0.80], [28, 8, 10, 30, 0.78], [29, 18, 16, 48, 0.70], [30, 40, 30, 80, 0.55],
    ];
    let r = 10, g = 10, b = 40, a = 0.72;
    for (let i = 0; i < stops.length - 1; i++) {
      const p = stops[i], q = stops[i + 1];
      if (h < p[0] || h > q[0]) continue;
      const t = (h - p[0]) / (q[0] - p[0]);
      r = lerp(p[1], q[1], t); g = lerp(p[2], q[2], t); b = lerp(p[3], q[3], t); a = lerp(p[4], q[4], t);
      break;
    }
    const raining = !!deps?.calendar?.isRaining;
    const storm = raining && deps.calendar.rainStrength >= 3;
    if (storm) { r = r * 0.5 + 15; g = g * 0.5 + 22.5; b = b * 0.5 + 35; a = Math.min(0.85, a + 0.25); }
    else if (raining) { r = r * 0.7 + 15; g = g * 0.7 + 19.5; b = b * 0.7 + 27; a = Math.min(0.78, a + 0.12); }
    return { r, g, b, a };
  }

  function sunUvForHour(hour = getHour()) {
    const h = hour < 6 ? hour + 24 : hour; // Used to keep the sun's trajectory continuous instead of snapping after 22:00.
    const t = clamp((h - 6) / 14, 0, 1);
    const altitude = Math.max(0, Math.sin(Math.PI * t));
    return { u: mod(0.76 - 0.52 * t, 1), v: clamp(0.40 + altitude * 0.48, 0.36, 0.92) };
  }

  function moonUvForHour(hour = getHour()) {
    const h = hour < 12 ? hour + 24 : hour; // Used to unwrap the 18:00→06:00 moon arc so it peaks near midnight.
    const t = clamp((h - 18) / 12, 0, 1);
    const altitude = Math.max(0, Math.sin(Math.PI * t));
    return { u: mod(0.76 - 0.52 * t, 1), v: clamp(0.40 + altitude * 0.45, 0.36, 0.89) };
  }

  function celestialOpacity(kind, hour = getHour()) {
    if (kind === 'sun') {
      const h = hour < 6 ? hour + 24 : hour;
      return clamp(smoothstep(5.7, 6.5, h) * (1 - smoothstep(18.5, 20, h)), 0, 1);
    }
    const h = hour < 12 ? hour + 24 : hour;
    return clamp(smoothstep(17.2, 19, h) * (1 - smoothstep(29, 30.7, h)), 0, 1);
  }

  function lunarDay() {
    try { return clamp(Math.round(window.CalendarSystem?.dayOfMonth?.(deps?.calendar?.day) || 14), 1, 28); }
    catch { return 14; }
  }

  function lunarProgress(day = lunarDay()) { return mod(day, 28) / 28; }
  function lunarIllumination(day = lunarDay()) { return (1 - Math.cos(lunarProgress(day) * Math.PI * 2)) * 0.5; }
  function lunarPhaseName(day = lunarDay()) {
    if (day === 28) return 'New Moon';
    if (day === 14) return 'Full Moon';
    if (day === 7) return 'First Quarter';
    if (day === 21) return 'Last Quarter';
    if (day < 7) return 'Waxing Crescent';
    if (day < 14) return 'Waxing Gibbous';
    if (day < 21) return 'Waning Gibbous';
    return 'Waning Crescent';
  }

  function uvToSphere(u, v, radius) {
    const phi = u * Math.PI * 2, theta = (1 - v) * Math.PI, st = Math.sin(theta);
    return new deps.THREE.Vector3(-Math.cos(phi) * st * radius, Math.cos(theta) * radius, Math.sin(phi) * st * radius);
  }

  function loadImage(path) {
    return new Promise((resolve, reject) => {
      const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error(`failed to load ${path}`)); image.src = path;
    });
  }

  function makeSkyMaterial() {
    const THREE = deps.THREE;
    return new THREE.ShaderMaterial({
      side: THREE.BackSide, depthTest: false, depthWrite: false, transparent: false, fog: false,
      uniforms: { uTop: { value: new THREE.Color(0x203b67) }, uMid: { value: new THREE.Color(0x5f8fb8) }, uBottom: { value: new THREE.Color(0x8b776b) }, uNight: { value: 0 }, uStars: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `
        precision highp float; uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uBottom; uniform float uNight; uniform float uStars; varying vec2 vUv;
        float hash12(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
        vec3 starField(vec2 uv){ vec2 cell=uv*vec2(190.0,108.0); vec2 id=floor(cell); vec2 gv=fract(cell)-.5; float rnd=hash12(id); float mask=step(.9785,rnd); vec2 jitter=(vec2(hash12(id+13.1),hash12(id+37.4))-.5)*.34; float d=length(gv+jitter); float core=smoothstep(.042,0.0,d); float halo=smoothstep(.17,0.0,d)*.38; float twinkle=.82+.18*sin((uv.x+uv.y+rnd)*420.0); vec3 tint=mix(vec3(.92,.96,1.0),vec3(1.0,.96,.90),hash12(id+17.2)); return tint*mask*(core+halo)*twinkle*smoothstep(.18,.34,uv.y); }
        void main(){ float upper=smoothstep(.48,.92,vUv.y); float lower=1.0-smoothstep(.16,.53,vUv.y); vec3 day=mix(uMid,uTop,upper); day=mix(day,uBottom,lower*.62); vec3 night=mix(vec3(.018,.025,.075),vec3(.035,.055,.13),smoothstep(.20,.85,vUv.y)); vec3 rgb=mix(day,night,uNight); rgb+=starField(vUv)*uStars; gl_FragColor=vec4(rgb,1.0); }`,
    });
  }

  function makeCloudMaterial(texture) {
    const THREE = deps.THREE;
    return new THREE.ShaderMaterial({
      side: THREE.BackSide, transparent: true, depthTest: false, depthWrite: false, fog: false,
      uniforms: { uMap: { value: texture }, uOffset: { value: new THREE.Vector2() }, uBrightness: { value: 1 }, uOpacity: { value: 1 }, uSunUV: { value: new THREE.Vector2() }, uSunLight: { value: 0 }, uMoonUV: { value: new THREE.Vector2() }, uMoonLight: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `
        precision highp float; uniform sampler2D uMap; uniform vec2 uOffset; uniform float uBrightness; uniform float uOpacity; uniform vec2 uSunUV; uniform float uSunLight; uniform vec2 uMoonUV; uniform float uMoonLight; varying vec2 vUv;
        float dxWrap(float a,float b){ float d=abs(a-b); return min(d,1.0-d); } float skyDist(vec2 a,vec2 b){ float dx=dxWrap(a.x,b.x); float lat=abs(a.y-.5)*3.14159265; dx*=max(.22,cos(lat)); float dy=a.y-b.y; return sqrt(dx*dx+dy*dy); }
        void main(){ vec2 sampleUv=vec2(fract(vUv.x+uOffset.x),clamp(vUv.y+uOffset.y,0.0,1.0)); vec4 tex=texture2D(uMap,sampleUv); if(tex.a<.004)discard; float sun=1.0-smoothstep(.018,.16,skyDist(vUv,uSunUV)); float moon=1.0-smoothstep(.015,.13,skyDist(vUv,uMoonUV)); vec3 rgb=tex.rgb*uBrightness; rgb+=vec3(1.0,.78,.43)*sun*uSunLight*max(tex.a,.34); rgb+=vec3(.58,.72,1.0)*moon*uMoonLight*max(tex.a,.30); gl_FragColor=vec4(rgb,tex.a*uOpacity); }`,
    });
  }

  function createCloudAtlas(images, bandIndex) {
    const canvas = document.createElement('canvas'); canvas.width = 2048; canvas.height = 1024; const ctx = canvas.getContext('2d');
    const cover = currentCloudCover(), countBoost = lerp(0.92, 2.55, cover), spread = lerp(1, 2.15, cover);
    const count = Math.max(1, Math.round(CLOUD_COUNTS[bandIndex] * countBoost));
    let seed = (0x484f4255 + bandIndex * 7919 + currentCloudBucket() * 104729) >>> 0; // Used by this band's deterministic weather-density atlas.
    const random = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    for (let i = 0; i < count; i++) {
      const image = images[Math.floor(random() * images.length)], iw = image.naturalWidth || image.width, ih = image.naturalHeight || image.height;
      const base = bandIndex === 0 ? 118 + random() * 76 : bandIndex === 1 ? 82 + random() * 60 : 56 + random() * 44;
      const size = base * lerp(0.92, 1.16, cover), w = size * spread, h = size * (ih / Math.max(1, iw));
      const x = random() * canvas.width - w * 0.5, y = canvas.height * (0.11 + Math.pow(random(), 0.72) * 0.62) - h * 0.5;
      ctx.globalAlpha = 0.68 + random() * 0.18; ctx.drawImage(image, x, y, w, h); if (x < 0) ctx.drawImage(image, x + canvas.width, y, w, h); if (x + w > canvas.width) ctx.drawImage(image, x - canvas.width, y, w, h);
    }
    ctx.globalAlpha = 1; return canvas;
  }

  function buildMoonPhaseCanvas(image, day) {
    const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
    const source = document.createElement('canvas'); source.width = width; source.height = height;
    const sctx = source.getContext('2d', { willReadFrequently: true }); sctx.drawImage(image, 0, 0, width, height);
    const input = sctx.getImageData(0, 0, width, height), rgba = input.data;
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (rgba[(y * width + x) * 4 + 3] > 8) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    if (maxX < minX) return source;
    const cx = (minX + maxX) * 0.5, cy = (minY + maxY) * 0.5, rx = Math.max(1, (maxX - minX + 1) * 0.5), ry = Math.max(1, (maxY - minY + 1) * 0.5);
    const angle = lunarProgress(day) * Math.PI * 2, sx = Math.sin(angle), sz = -Math.cos(angle);
    const lit = new Uint8Array(width * height);
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) { const i = y * width + x, a = rgba[i * 4 + 3]; if (a <= 8) continue; const nx = (x - cx) / rx, ny = (y - cy) / ry, r2 = nx * nx + ny * ny; if (r2 > 1) continue; const nz = Math.sqrt(Math.max(0, 1 - r2)); if (nx * sx + nz * sz > 0) lit[i] = 1; }
    const output = document.createElement('canvas'); output.width = width; output.height = height; const octx = output.getContext('2d', { willReadFrequently: true }), out = octx.createImageData(width, height), dst = out.data;
    for (let i = 0; i < width * height; i++) if (lit[i]) { const p = i * 4; dst[p] = rgba[p]; dst[p + 1] = rgba[p + 1]; dst[p + 2] = rgba[p + 2]; dst[p + 3] = rgba[p + 3]; }
    // Deliberately no black phase-edge stroke: the moon is a luminous body,
    // not part of the game's ink-outline language.
    octx.putImageData(out, 0, 0); return output;
  }

  function glowTexture(moon = false) {
    const THREE = deps.THREE, size = 512, canvas = document.createElement('canvas'); canvas.width = canvas.height = size; const ctx = canvas.getContext('2d');
    const rgb = moon ? [169, 201, 255] : [255, 216, 137], radial = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size * 0.49);
    radial.addColorStop(0, `rgba(${rgb.join(',')},.34)`); radial.addColorStop(.16, `rgba(${rgb.join(',')},.19)`); radial.addColorStop(.48, `rgba(${rgb.join(',')},.045)`); radial.addColorStop(1, `rgba(${rgb.join(',')},0)`); ctx.fillStyle = radial; ctx.fillRect(0, 0, size, size);
    const texture = new THREE.CanvasTexture(canvas); texture.needsUpdate = true; return texture;
  }

  function makeCelestialPack(image, kind) {
    const THREE = deps.THREE, displayImage = kind === 'moon' ? buildMoonPhaseCanvas(image, lunarDay()) : image;
    const texture = displayImage instanceof HTMLCanvasElement ? new THREE.CanvasTexture(displayImage) : new THREE.Texture(displayImage); texture.needsUpdate = true;
    const baseOptions = { map: texture, transparent: true, alphaTest: 0.015, depthTest: true, depthWrite: false, fog: false, toneMapped: false };
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial(baseOptions));
    const selfLight = new THREE.Sprite(new THREE.SpriteMaterial({ ...baseOptions, blending: THREE.AdditiveBlending }));
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(kind === 'moon'), transparent: true, depthTest: true, depthWrite: false, fog: false, toneMapped: false, blending: THREE.AdditiveBlending }));
    for (const node of [sprite, selfLight, glow]) {
      node.layers.set(0); // Explicitly exclude shell/material-ID/PNG-occluder outline passes.
      node.userData.hobunjiNoOutline = true;
      node.frustumCulled = false;
    }
    sprite.renderOrder = -900; selfLight.renderOrder = -899; glow.renderOrder = -901; celestialGroup.add(glow, sprite, selfLight); return { image: displayImage, sprite, selfLight, glow };
  }

  function disposeCelestial(pack) {
    if (!pack) return; celestialGroup.remove(pack.sprite, pack.selfLight, pack.glow);
    for (const sprite of [pack.sprite, pack.selfLight, pack.glow]) { sprite.material?.map?.dispose?.(); sprite.material?.dispose?.(); }
  }

  function rebuildMoon() {
    if (!sourceMoonImage || !celestialGroup) return; disposeCelestial(moonPack); moonPack = makeCelestialPack(sourceMoonImage, 'moon'); lastMoonDay = lunarDay();
    debugLog(`moon rebuilt: day ${lastMoonDay}/28 · ${lunarPhaseName(lastMoonDay)} · ${Math.round(lunarIllumination(lastMoonDay) * 100)}% illuminated`);
  }

  function rebuildClouds(images) {
    if (!cloudGroup || !images.length) return;
    for (const band of cloudBands) { cloudGroup.remove(band.mesh); band.mesh.geometry.dispose(); band.material.uniforms.uMap.value.dispose(); band.material.dispose(); }
    cloudBands = CLOUD_RADII.map((radius, index) => {
      const texture = new deps.THREE.CanvasTexture(createCloudAtlas(images, index)); texture.wrapS = deps.THREE.RepeatWrapping; texture.wrapT = deps.THREE.ClampToEdgeWrapping; texture.needsUpdate = true;
      const material = makeCloudMaterial(texture), mesh = new deps.THREE.Mesh(new deps.THREE.SphereGeometry(radius, 64, 36), material); mesh.frustumCulled = false; mesh.renderOrder = -800 + index; cloudGroup.add(mesh);
      return { mesh, material, speed: CLOUD_SPEEDS[index], offset: index * 0.173 };
    });
    lastCloudBucket = currentCloudBucket(); debugLog(`cloud domes rebuilt for weather bucket ${lastCloudBucket}`);
  }

  function buildRoot() {
    const THREE = deps.THREE; root = new THREE.Group(); root.name = 'hobunji_dynamic_skydome'; skyMaterial = makeSkyMaterial();
    const skyMesh = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 64, 36), skyMaterial); skyMesh.frustumCulled = false; skyMesh.renderOrder = -1000;
    cloudGroup = new THREE.Group(); cloudGroup.name = 'hobunji_cloud_domes'; celestialGroup = new THREE.Group(); celestialGroup.name = 'hobunji_celestial_sprites'; root.add(skyMesh, celestialGroup, cloudGroup);
  }

  async function loadAssets() {
    if (assetsLoading || assetsReady) return; assetsLoading = true;
    try {
      const [sun, moon, ...clouds] = await Promise.all([loadImage(`${ASSET_BASE}sun.png`), loadImage(`${ASSET_BASE}moon.png`), ...CLOUD_NAMES.map(name => loadImage(`${ASSET_BASE}${name}`))]);
      sourceMoonImage = moon; sunPack = makeCelestialPack(sun, 'sun'); moonPack = makeCelestialPack(moon, 'moon'); lastMoonDay = lunarDay(); rebuildClouds(clouds); root.userData.cloudImages = clouds; assetsReady = true;
      debugLog('runtime skydome assets ready: 3 cloud bands, luminous unoutlined sun, phase-masked luminous moon, dense halo stars');
    } catch (error) { debugLog(`asset load failed: ${error?.message || error}`, 'warn'); }
    finally { assetsLoading = false; }
  }

  function attachToScene() {
    const scene = deps?.getActiveScene?.(); if (!scene || scene === activeScene) return; activeScene?.remove(root); scene.add(root); activeScene = scene;
  }

  function updateSkyColors() {
    if (!skyMaterial) return;
    const THREE = deps.THREE, light = fullDayLightingState(), night = nightFactor(), base = new THREE.Color().setRGB(light.r / 255, light.g / 255, light.b / 255);
    skyMaterial.uniforms.uTop.value.copy(base.clone().lerp(new THREE.Color(0x315d96), 0.52 * (1 - night)));
    skyMaterial.uniforms.uMid.value.copy(base.clone().lerp(new THREE.Color(0x7da9ca), 0.62 * (1 - night)));
    skyMaterial.uniforms.uBottom.value.copy(base.clone().lerp(new THREE.Color(0xc39774), 0.34 * (1 - night)));
    skyMaterial.uniforms.uNight.value = night; skyMaterial.uniforms.uStars.value = starVisibility();
  }

  function updateCelestialPack(pack, kind, uv, opacity, illumination = 1) {
    if (!pack) return;
    const pos = uvToSphere(uv.u, uv.v, CELESTIAL_RADIUS), image = pack.image, ratio = (image.naturalWidth || image.width) / Math.max(1, image.naturalHeight || image.height);
    const h = kind === 'sun' ? SUN_SIZE : MOON_SIZE, w = h * ratio;
    const bodyLight = kind === 'sun' ? 0.72 : 0.82;
    const glowStrength = kind === 'sun' ? 0.58 : 0.52;
    const visibleIllumination = kind === 'sun' ? 1 : illumination;
    pack.sprite.position.copy(pos); pack.selfLight.position.copy(pos); pack.glow.position.copy(pos);
    pack.sprite.scale.set(w, h, 1); pack.selfLight.scale.set(w, h, 1); pack.glow.scale.set(w * (kind === 'sun' ? 5.2 : 5.8), h * (kind === 'sun' ? 5.2 : 5.8), 1);
    pack.sprite.material.opacity = opacity;
    pack.selfLight.material.opacity = clamp(opacity * visibleIllumination * bodyLight, 0, 0.96);
    pack.glow.material.opacity = clamp(opacity * visibleIllumination * glowStrength, 0, 0.78);
    if (kind === 'sun') pack.selfLight.material.color.setRGB(1, 0.88, 0.58); else pack.selfLight.material.color.setRGB(0.72, 0.84, 1);
  }

  function updateClouds(dt, sunUv, moonUv, sunOpacity, moonOpacity, moonIllumination) {
    const brightness = lerp(1.08, 0.72, currentCloudCover());
    cloudBands.forEach(band => { band.offset = mod(band.offset + dt * band.speed, 1); const u = band.material.uniforms; u.uOffset.value.set(band.offset, 0); u.uBrightness.value = brightness; u.uOpacity.value = 0.90; u.uSunUV.value.set(sunUv.u, sunUv.v); u.uSunLight.value = 1.75 * sunOpacity; u.uMoonUV.value.set(moonUv.u, moonUv.v); u.uMoonLight.value = 0.58 * moonOpacity * moonIllumination; });
  }

  function init(injectedDeps) {
    if (deps) return; deps = injectedDeps; buildRoot(); attachToScene(); loadAssets(); debugLog(`24-hour sky init · clock ${DAY_ROLLOVER_HOUR}:00→${DAY_ROLLOVER_HOUR}:00 · full moon day 14/28`);
  }

  function update(dt = 0) {
    if (!deps || !root) return; attachToScene(); root.position.copy(deps.camera.position); updateSkyColors();
    const hour = getHour(), sunUv = sunUvForHour(hour), moonUv = moonUvForHour(hour), sunOpacity = celestialOpacity('sun', hour), moonOpacity = celestialOpacity('moon', hour), moonIllumination = lunarIllumination();
    updateCelestialPack(sunPack, 'sun', sunUv, sunOpacity, 1); updateCelestialPack(moonPack, 'moon', moonUv, moonOpacity, moonIllumination); updateClouds(Math.max(0, Number(dt) || 0), sunUv, moonUv, sunOpacity, moonOpacity, moonIllumination);
    if (assetsReady && currentCloudBucket() !== lastCloudBucket) rebuildClouds(root.userData.cloudImages || []); if (assetsReady && lunarDay() !== lastMoonDay) rebuildMoon();
    const hourBucket = Math.floor(hour); if (hourBucket !== lastLoggedHourBucket && (hourBucket === 0 || hourBucket === 6 || hourBucket === 18 || hourBucket === 22)) { lastLoggedHourBucket = hourBucket; debugLog(`hour ${String(hourBucket).padStart(2, '0')}:00 · stars ${starVisibility().toFixed(2)} · moon ${lunarPhaseName()} ${Math.round(moonIllumination * 100)}%`); }
  }

  function applyPredawnLightingCorrection() {
    if (!weatherDeps?.lctx || !weatherDeps?.getThreeRect) return; const hour = getHour(); if (hour < 4.5 || hour >= 6) return;
    const strength = smoothstep(4.5, 6, hour) * 0.18; // Used to soften WeatherFX's legacy 22:00-night plateau into the new pre-dawn color ramp without replacing its lantern/light masks.
    const rect = weatherDeps.getThreeRect(), ctx = weatherDeps.lctx; ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = `rgba(80,55,105,${strength})`; ctx.fillRect(0, 0, rect.width, rect.height); ctx.restore();
  }

  function installWeatherHook() {
    if (!window.WeatherFX || window.WeatherFX.__fullDaySkyHooked) return;
    const originalInit = window.WeatherFX.init;
    const originalDraw = window.WeatherFX.drawLightingOverlay;
    const originalGetLightingState = window.WeatherFX.getLightingState;
    window.WeatherFX.init = function (injectedDeps) { weatherDeps = injectedDeps; return originalInit.call(this, injectedDeps); };
    window.WeatherFX.drawLightingOverlay = function (...args) { const result = originalDraw.apply(this, args); applyPredawnLightingCorrection(); return result; };
    window.WeatherFX.getLightingState = function () { return deps ? fullDayLightingState() : originalGetLightingState.call(this); };
    window.WeatherFX.__fullDaySkyHooked = true;
  }

  function wrapNaturalTimeAccessor(calendar) {
    const descriptor = Object.getOwnPropertyDescriptor(calendar, 'time01'); if (!descriptor?.get || !descriptor?.set || calendar.__fullDayTimeAccessor) return;
    Object.defineProperty(calendar, 'time01', { configurable: true, enumerable: true, get() { return descriptor.get.call(calendar); }, set(nextValue) { const current = descriptor.get.call(calendar), numeric = Number(nextValue); if (!Number.isFinite(numeric)) return; const delta = numeric - current; const naturalFrameWrite = window.__hobunjiGameStarted === true && delta > 0 && delta <= 0.02; descriptor.set.call(calendar, naturalFrameWrite ? current + delta * EXTRA_NATURAL_TIME_SCALE : numeric); } });
    Object.defineProperty(calendar, '__fullDayTimeAccessor', { value: true, configurable: true });
  }

  function installClockHook() {
    if (!window.CalendarSystem || window.CalendarSystem.__fullDaySkyHooked) return;
    const originalInit = window.CalendarSystem.init;
    window.CalendarSystem.init = function (injectedDeps) {
      const morningHour = Number(injectedDeps.MORNING_HOUR) || DAY_ROLLOVER_HOUR;
      injectedDeps.NIGHT_HOUR = morningHour + 24; const result = originalInit.call(this, injectedDeps); clockDeps = injectedDeps; wrapNaturalTimeAccessor(injectedDeps.calendar);
      window.CalendarSystem.getHour = function (time01 = injectedDeps.calendar.time01) { return mod(morningHour + Number(time01 || 0) * 24, 24); };
      const oldSnapshot = window.CalendarSystem.timeDebugSnapshot; if (typeof oldSnapshot === 'function') window.CalendarSystem.timeDebugSnapshot = function () { return { ...oldSnapshot.call(this), fullDayClock: true, representedHour: window.CalendarSystem.getHour(), dayRolloverHour: morningHour, effectiveDaySeconds: CLOCK_FULL_DAY_TARGET_SECONDS, naturalScale: 2 / 7 }; };
      window.CalendarSystem.constants = Object.freeze({ ...window.CalendarSystem.constants, TARGET_DAY_LENGTH_SECONDS: CLOCK_FULL_DAY_TARGET_SECONDS, FULL_DAY_CYCLE: true, DAY_ROLLOVER_HOUR: morningHour });
      const logger = window.__farmLog || console.log; try { logger(`[time] full 24-hour clock enabled: ${morningHour}:00→${morningHour}:00, effective ${CLOCK_FULL_DAY_TARGET_SECONDS}s represented day (2/7 natural scale)`, 'info'); } catch {}
      return result;
    };
    window.CalendarSystem.__fullDaySkyHooked = true;
  }

  function installRainHook() {
    if (!window.RainPlanes || window.RainPlanes.__skyDomeHooked) return;
    const originalInit = window.RainPlanes.init;
    const originalUpdate = window.RainPlanes.update;
    window.RainPlanes.init = function (injectedDeps) { const result = originalInit.call(this, injectedDeps); init(injectedDeps); return result; };
    window.RainPlanes.update = function (dt) { const result = originalUpdate.call(this, dt); update(dt); return result; };
    window.RainPlanes.__skyDomeHooked = true;
  }

  function getDebugState() {
    return { initialized: !!deps, assetsReady, activeScene: activeScene?.name || activeScene?.uuid || null, hour: getHour(), rawDay: deps?.calendar?.day ?? null, dayOfMonth: lunarDay(), moonPhase: lunarPhaseName(), moonIllumination: lunarIllumination(), stars: starVisibility(), cloudCover: currentCloudCover(), cloudBucket: currentCloudBucket(), effectiveDaySeconds: CLOCK_FULL_DAY_TARGET_SECONDS, dayRolloverHour: DAY_ROLLOVER_HOUR, clockHookReady: !!clockDeps, skyRadius: SKY_RADIUS, celestialRadius: CELESTIAL_RADIUS, cameraFar: deps?.camera?.far ?? null, oversizedCelestialGlowDisabled: false, celestialNoOutline: true };
  }

  installClockHook(); installWeatherHook(); installRainHook();
  window.HobunjiSkyDome = { init, update, getDebugState, getLightingState: fullDayLightingState, lunarIllumination, lunarPhaseName };
})();