// Startup title screen shown once per page load before the player interacts with the game.
// The title uses the same bright bronze metallic ramp as the loading-screen TankanScript treatment.
(() => {
  'use strict';

  if (window.HobunjiTitleScreen?.installed) return;

  const STYLE_ID = 'hobunjiTitleScreenStyles'; // Keeps the startup overlay stylesheet idempotent.
  const FONT_FAMILY = 'HobunjiTitleRoman'; // Separates title-screen font loading from the loading-screen FontFace name.
  const FONT_URL = 'assets/hud/KhymeryyanRomanLetters+Numbers.otf.ttf'; // Existing Khymeryyan Roman font asset.
  const EXIT_MS = 320; // Short fade used after the starting input is consumed.
  const GAMEPAD_AXIS_THRESHOLD = 0.72; // Avoids ordinary stick drift counting as the requested starting input.
  const SKY_CANVAS_ID = 'hobunjiTitleSky'; // Identifies the title-only Three.js canvas rendered beneath the logo/prompt.
  const EASTERN_TIME_ZONE = 'America/New_York'; // Supplies the project's Eastern real-world wall clock, including daylight-saving transitions.
  const KH_DAYS_PER_MONTH = 28; // Converts each mapped Khymeryyan season into its three equal civil months.
  const KH_DAYS_PER_SEASON = KH_DAYS_PER_MONTH * 3; // Scales each Southern Hemisphere Earth season to exactly 84 Khymeryyan days.
  const KH_MONTH_NAMES = Object.freeze([
    'Firstrise', 'Secondrise', 'Thirdrise',
    'Waxingheat', 'Highheat', 'Waningheat',
    'Firstfall', 'Secondfall', 'Thirdfall',
    'Shallowfrost', 'Deepfrost', 'Pouringfrost',
  ]); // Matches CalendarSystem's 12 authored 28-day civil months.
  const SKY_ASSET_BASE = 'assets/sky_sprites/'; // Reuses the exact runtime skydome sun, moon, and cloud sprite directory.
  const SKY_RADIUS = 198; // Matches sky-dome.js so the title camera is literally inside the same-sized shell.
  const CELESTIAL_RADIUS = 197; // Matches gameplay sun/moon placement just inside the opaque sky shell.
  const CLOUD_RADII = Object.freeze([176, 184, 192]); // Matches the three concentric gameplay cloud shells.
  const CLOUD_SPEEDS = Object.freeze([0.0018, 0.00105, 0.00055]); // Gives the title cloud shells the same relative drift rates as gameplay.
  const CLOUD_COUNTS = Object.freeze([24, 32, 42]); // Seeds each title cloud atlas at the same base density as gameplay.
  const CLEAR_SKY_CLOUD_COVER = 0.34; // Matches sky-dome.js's no-weather fallback cloud cover for this save-independent title view.
  const TITLE_SKY_FOV = 62; // Frames a broad inside-skydome view behind the centered title logo.
  const TITLE_PIXEL_RATIO_CAP = 1.5; // Keeps the decorative startup canvas affordable on high-DPI mobile screens.
  const INPUT_EVENTS = Object.freeze([
    'keydown', 'keyup',
    'pointerdown', 'pointerup',
    'mousedown', 'mouseup',
    'touchstart', 'touchend',
    'click', 'contextmenu', 'wheel',
  ]); // Captured before gameplay handlers so the start input cannot leak through to the game.
  const START_EVENTS = new Set(['keydown', 'pointerdown', 'mousedown', 'touchstart', 'click', 'wheel']); // Events that can dismiss the title screen.
  const easternFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: EASTERN_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }); // Converts Date.now() into stable Eastern wall-clock components before seasonal scaling.

  let active = true; // Remains true through the fade so follow-up key/pointer events are swallowed too.
  let starting = false; // Prevents duplicate start requests from pointerdown + mousedown + click.
  let gamepadPollRaf = 0; // Owns the rising-edge controller check independent of the game's controller polling.
  let gamepadPollPrimed = false; // Prevents a button already held during page load from instantly skipping the title screen.
  let gamepadWasDown = false; // Tracks the previous real controller snapshot for rising-edge detection.
  let controllerGateInstalled = false; // Reported by getDebug() so controller leakage can be checked on mobile.
  let fontSettled = false; // Prevents a fallback-font flash before the local Khymeryyan Roman font resolves.
  let titleSky = null; // Holds the disposable title-only renderer/scene state until the startup gate fades away.
  let mappedCalendarDebug = null; // Stores the latest real-time → Khymeryyan conversion for mobile-readable getDebug().
  let titleSkyError = null; // Exposes WebGL/asset setup failures without requiring browser devtools.

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const mod = (value, modulus) => ((value % modulus) + modulus) % modulus;
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (a, b, value) => {
    const t = clamp((value - a) / Math.max(0.000001, b - a), 0, 1); // Normalizes the requested interpolation interval.
    return t * t * (3 - 2 * t);
  };

  function easternWallClockParts(date = new Date()) {
    const parts = {}; // Collects Intl's named Eastern wall-clock fields for synthetic local-time arithmetic below.
    for (const part of easternFormatter.formatToParts(date)) {
      if (part.type !== 'literal') parts[part.type] = Number(part.value);
    }
    return {
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour: parts.hour,
      minute: parts.minute,
      second: parts.second,
      millisecond: date.getMilliseconds(),
    };
  }

  function wallClockMs(parts) {
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour || 0, parts.minute || 0, parts.second || 0, parts.millisecond || 0);
  }

  function mappedSeason(parts) {
    const year = parts.year; // Anchors the real Southern Hemisphere season boundaries surrounding this Eastern date.
    const month = parts.month; // Selects spring/summer/fall/winter without relying on host-locale timezone behavior.
    if (month >= 9 && month <= 11) {
      return { name: 'Spring', monthBase: 0, start: Date.UTC(year, 8, 1), end: Date.UTC(year, 11, 1) };
    }
    if (month === 12 || month <= 2) {
      const startYear = month === 12 ? year : year - 1; // Keeps the December→March summer interval continuous across New Year.
      return { name: 'Summer', monthBase: 3, start: Date.UTC(startYear, 11, 1), end: Date.UTC(startYear + 1, 2, 1) };
    }
    if (month >= 3 && month <= 5) {
      return { name: 'Fall', monthBase: 6, start: Date.UTC(year, 2, 1), end: Date.UTC(year, 5, 1) };
    }
    return { name: 'Winter', monthBase: 9, start: Date.UTC(year, 5, 1), end: Date.UTC(year, 8, 1) };
  }

  function mapRealtimeToKhymeryya(date = new Date()) {
    const eastern = easternWallClockParts(date); // Supplies the project's real-life Eastern reference time.
    const season = mappedSeason(eastern); // Supplies exact Southern Hemisphere meteorological season endpoints for scaling.
    const earthSeasonProgress = clamp((wallClockMs(eastern) - season.start) / Math.max(1, season.end - season.start), 0, 0.999999999999); // Maps this variable-length Earth season into [0,1).
    const khSeasonDays = earthSeasonProgress * KH_DAYS_PER_SEASON; // Slows the 84-day fictional season across the longer real season.
    const dayIndexInSeason = Math.floor(khSeasonDays); // Selects one of the 84 discrete Khymeryyan civil dates.
    const monthInSeason = Math.floor(dayIndexInSeason / KH_DAYS_PER_MONTH); // Selects the season's first/second/third authored month.
    const dayOfMonth = dayIndexInSeason % KH_DAYS_PER_MONTH + 1; // Converts the zero-based civil day to the displayed 1–28 date.
    const hour = (khSeasonDays - dayIndexInSeason) * 24; // Preserves the scaled fractional day as Khymeryyan time-of-day.
    const monthIndex = season.monthBase + monthInSeason; // Resolves the global 0–11 month used by CalendarSystem's authored order.
    return {
      timeZone: EASTERN_TIME_ZONE,
      eastern,
      season: season.name,
      earthSeasonProgress,
      monthIndex,
      monthName: KH_MONTH_NAMES[monthIndex],
      dayOfMonth,
      hour,
      lunarDay: dayOfMonth,
    };
  }

  function formatMappedClock(hour) {
    const totalMinutes = mod(Math.floor(hour * 60), 24 * 60); // Produces a stable debug clock without floating-point seconds noise.
    return `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
  }

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style'); // Owns the full title overlay + dedicated skydome canvas presentation.
    style.id = STYLE_ID;
    style.textContent = `
      html.hobunji-title-active {
        background:#000;
        overflow:hidden;
        overscroll-behavior:none;
      }

      #${SKY_CANVAS_ID} {
        position:fixed;
        inset:0;
        z-index:2147483644;
        width:100vw;
        height:100vh;
        display:block;
        opacity:1;
        background:#000;
        pointer-events:none;
        transition:opacity ${EXIT_MS}ms ease;
      }

      html.hobunji-title-leaving #${SKY_CANVAS_ID} {
        opacity:0;
      }

      /* Transparent prompt layer over the dedicated inside-skydome canvas.
         ::before remains free to use background-clip:text for the logo. */
      html.hobunji-title-active::after {
        content:'Press any input to start';
        position:fixed;
        inset:0;
        z-index:2147483645;
        display:flex;
        align-items:center;
        justify-content:center;
        box-sizing:border-box;
        padding-top:27vh;
        background:transparent;
        color:rgba(255,255,255,0);
        font-family:'${FONT_FAMILY}','DM Mono',monospace;
        font-size:clamp(14px,2.1vw,24px);
        line-height:1;
        letter-spacing:.12em;
        text-align:center;
        white-space:nowrap;
        text-transform:none;
        text-shadow:0 2px 8px rgba(0,0,0,.9);
        user-select:none;
        pointer-events:none;
      }

      /* Horizontal Khymeryyan Roman logo using the loading-screen Tankan
         bronze ramp, outline, shadow, and warm glow. */
      html.hobunji-title-active::before {
        content:'Hobunji Hollow';
        position:fixed;
        left:50%;
        top:47%;
        z-index:2147483646;
        transform:translate(-50%,-50%);
        width:max-content;
        max-width:92vw;
        color:#CD7F32;
        background:linear-gradient(
          180deg,
          #C27A42 0%,
          #E39A51 20%,
          #F8D493 41%,
          #FFF1CE 48%,
          #E7A35F 57%,
          #F6C77F 72%,
          #C98248 100%
        );
        -webkit-background-clip:text;
        background-clip:text;
        -webkit-text-fill-color:transparent;
        -webkit-text-stroke:3px rgba(0,0,0,.82);
        paint-order:stroke fill;
        font-family:'${FONT_FAMILY}',serif;
        font-size:clamp(42px,8.5vw,132px);
        line-height:.96;
        letter-spacing:.02em;
        text-align:center;
        white-space:nowrap;
        text-shadow:0 2px 5px rgba(0,0,0,.8);
        filter:drop-shadow(0 0 7px rgba(246,199,127,.52));
        opacity:0;
        user-select:none;
        pointer-events:none;
        transition:opacity .18s ease;
      }

      html.hobunji-title-active.hobunji-title-font-ready::before {
        opacity:1;
      }

      html.hobunji-title-active.hobunji-title-font-ready::after {
        animation:hobunjiTitlePromptFade 2.15s ease-in-out infinite;
      }

      html.hobunji-title-active.hobunji-title-leaving::before,
      html.hobunji-title-active.hobunji-title-leaving::after {
        opacity:0 !important;
        animation:none !important;
        transition:opacity ${EXIT_MS}ms ease;
      }

      @keyframes hobunjiTitlePromptFade {
        0%,100% {
          color:rgba(255,255,255,.14);
          text-shadow:0 2px 8px rgba(0,0,0,.9);
        }
        50% {
          color:rgba(255,255,255,.94);
          text-shadow:0 2px 8px rgba(0,0,0,.9),0 0 8px rgba(255,255,255,.18);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        html.hobunji-title-active.hobunji-title-font-ready::after {
          animation-duration:4s;
        }
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function nightFactor(hour) {
    const h = hour < 12 ? hour + 24 : hour; // Treats dusk→midnight→dawn as one continuous interval, matching sky-dome.js.
    if (h < 18) return 0;
    if (h < 20) return smoothstep(18, 20, h);
    if (h < 29) return 1;
    if (h < 31) return 1 - smoothstep(29, 31, h);
    return 0;
  }

  function fullDayLightingState(hour) {
    const h = hour < 6 ? hour + 24 : hour; // Unwraps midnight toward the gameplay skydome's 06:00 lighting rollover.
    const stops = [
      [6, 40, 30, 80], [6.5, 220, 100, 40], [7.5, 240, 160, 60],
      [9, 255, 230, 180], [12, 255, 245, 210], [15, 255, 225, 160],
      [17.5, 255, 160, 60], [18.5, 220, 90, 30], [19.5, 130, 50, 80],
      [20.5, 30, 30, 80], [22, 10, 10, 40], [24, 6, 9, 25],
      [26, 5, 8, 23], [28, 8, 10, 30], [29, 18, 16, 48], [30, 40, 30, 80],
    ]; // Mirrors the clear-sky RGB stops used by the gameplay skydome.
    let r = 10, g = 10, b = 40; // Holds the interpolated clear-sky lighting color used to tint the title sphere.
    for (let i = 0; i < stops.length - 1; i++) {
      const p = stops[i]; // Supplies the lower gameplay lighting stop for this title-hour interval.
      const q = stops[i + 1]; // Supplies the upper gameplay lighting stop for this title-hour interval.
      if (h < p[0] || h > q[0]) continue;
      const t = (h - p[0]) / Math.max(0.000001, q[0] - p[0]); // Interpolates between adjacent gameplay lighting stops.
      r = lerp(p[1], q[1], t);
      g = lerp(p[2], q[2], t);
      b = lerp(p[3], q[3], t);
      break;
    }
    return { r, g, b };
  }

  function createSkyMaterial(THREE) {
    return new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
      transparent: false,
      fog: false,
      uniforms: {
        uTop: { value: new THREE.Color(0x203b67) },
        uMid: { value: new THREE.Color(0x5f8fb8) },
        uBottom: { value: new THREE.Color(0x8b776b) },
        uNight: { value: 0 },
        uStars: { value: 0 },
      },
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `
        precision highp float; uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uBottom; uniform float uNight; uniform float uStars; varying vec2 vUv;
        float hash12(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
        vec3 starField(vec2 uv){ vec2 cell=uv*vec2(190.0,108.0); vec2 id=floor(cell); vec2 gv=fract(cell)-.5; float rnd=hash12(id); float mask=step(.9785,rnd); vec2 jitter=(vec2(hash12(id+13.1),hash12(id+37.4))-.5)*.34; float d=length(gv+jitter); float core=smoothstep(.042,0.0,d); float halo=smoothstep(.17,0.0,d)*.38; float twinkle=.82+.18*sin((uv.x+uv.y+rnd)*420.0); vec3 tint=mix(vec3(.92,.96,1.0),vec3(1.0,.96,.90),hash12(id+17.2)); return tint*mask*(core+halo)*twinkle*smoothstep(.18,.34,uv.y); }
        void main(){ float upper=smoothstep(.48,.92,vUv.y); float lower=1.0-smoothstep(.16,.53,vUv.y); vec3 day=mix(uMid,uTop,upper); day=mix(day,uBottom,lower*.62); vec3 night=mix(vec3(.018,.025,.075),vec3(.035,.055,.13),smoothstep(.20,.85,vUv.y)); vec3 rgb=mix(day,night,uNight); rgb+=starField(vUv)*uStars; gl_FragColor=vec4(rgb,1.0); }`,
    });
  }

  function updateSkyMaterial(THREE, material, snapshot) {
    const light = fullDayLightingState(snapshot.hour); // Mirrors the clear gameplay lighting state at the mapped Khymeryyan hour.
    const night = nightFactor(snapshot.hour); // Drives the exact gameplay day/night blend and star reveal.
    const base = new THREE.Color().setRGB(light.r / 255, light.g / 255, light.b / 255); // Seeds the three gameplay skydome gradient stops.
    material.uniforms.uTop.value.copy(base.clone().lerp(new THREE.Color(0x315d96), 0.52 * (1 - night)));
    material.uniforms.uMid.value.copy(base.clone().lerp(new THREE.Color(0x7da9ca), 0.62 * (1 - night)));
    material.uniforms.uBottom.value.copy(base.clone().lerp(new THREE.Color(0xc39774), 0.34 * (1 - night)));
    material.uniforms.uNight.value = night;
    material.uniforms.uStars.value = clamp(night * (1 - CLEAR_SKY_CLOUD_COVER * 0.78), 0, 1);
  }

  function sunUvForHour(hour) {
    const h = hour < 6 ? hour + 24 : hour; // Keeps the gameplay sun trajectory continuous across midnight.
    const t = clamp((h - 6) / 14, 0, 1); // Maps the visible 06:00→20:00 sun arc to a normalized title position.
    const altitude = Math.max(0, Math.sin(Math.PI * t)); // Raises the sun toward noon exactly like sky-dome.js.
    return { u: mod(0.76 - 0.52 * t, 1), v: clamp(0.40 + altitude * 0.48, 0.36, 0.92) };
  }

  function moonUvForHour(hour) {
    const h = hour < 12 ? hour + 24 : hour; // Unwraps the gameplay 18:00→06:00 moon arc around midnight.
    const t = clamp((h - 18) / 12, 0, 1); // Maps the visible night arc to a normalized title position.
    const altitude = Math.max(0, Math.sin(Math.PI * t)); // Raises the moon toward midnight exactly like sky-dome.js.
    return { u: mod(0.76 - 0.52 * t, 1), v: clamp(0.40 + altitude * 0.45, 0.36, 0.89) };
  }

  function celestialOpacity(kind, hour) {
    if (kind === 'sun') {
      const h = hour < 6 ? hour + 24 : hour; // Uses the same unwrapped daytime interval as the gameplay sun.
      return clamp(smoothstep(5.7, 6.5, h) * (1 - smoothstep(18.5, 20, h)), 0, 1);
    }
    const h = hour < 12 ? hour + 24 : hour; // Uses the same unwrapped nighttime interval as the gameplay moon.
    return clamp(smoothstep(17.2, 19, h) * (1 - smoothstep(29, 30.7, h)), 0, 1);
  }

  function uvToSphere(THREE, u, v, radius) {
    const phi = u * Math.PI * 2; // Converts horizontal sky UV to spherical longitude.
    const theta = (1 - v) * Math.PI; // Converts vertical sky UV to spherical colatitude.
    const sinTheta = Math.sin(theta); // Reused by X/Z conversion for the title's inside-sphere position.
    return new THREE.Vector3(-Math.cos(phi) * sinTheta * radius, Math.cos(theta) * radius, Math.sin(phi) * sinTheta * radius);
  }

  function makeImageTexture(THREE, path) {
    return new Promise((resolve, reject) => {
      const image = new Image(); // Loads the same-origin runtime sky sprite used to build the title texture.
      image.onload = () => {
        const texture = new THREE.Texture(image); // Uploads the runtime sprite to this title-only WebGL renderer.
        texture.needsUpdate = true;
        resolve({ image, texture });
      };
      image.onerror = () => reject(new Error(`failed to load ${path}`));
      image.src = path;
    });
  }

  function moonPhaseTexture(THREE, image, day) {
    const width = image.naturalWidth || image.width; // Sizes the phase canvas to the authored moon sprite's native width.
    const height = image.naturalHeight || image.height; // Sizes the phase canvas to the authored moon sprite's native height.
    const canvas = document.createElement('canvas'); // Holds a per-pixel illuminated lunar hemisphere for the mapped 28-day date.
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true }); // Reads source alpha so the crescent stays inside the authored moon silhouette.
    context.drawImage(image, 0, 0, width, height);
    try {
      const pixels = context.getImageData(0, 0, width, height); // Supplies authored moon RGBA values to the phase mask below.
      const progress = mod(day, 28) / 28; // Matches sky-dome.js: day 14 full, day 28 new.
      const phase = progress * Math.PI * 2; // Rotates the light direction once per 28-day lunar cycle.
      const lightX = Math.sin(phase); // Controls waxing/waning illumination across the visible lunar disk.
      const lightZ = -Math.cos(phase); // Makes progress 0/new dark and progress .5/full fully illuminated.
      for (let y = 0; y < height; y++) {
        const ny = ((y + 0.5) / height) * 2 - 1; // Maps this pixel to normalized lunar-disk Y.
        for (let x = 0; x < width; x++) {
          const index = (y * width + x) * 4; // Locates this pixel's alpha byte in the canvas ImageData buffer.
          if (!pixels.data[index + 3]) continue;
          const nx = ((x + 0.5) / width) * 2 - 1; // Maps this pixel to normalized lunar-disk X.
          const radiusSquared = nx * nx + ny * ny; // Rejects pixels outside the projected spherical disk even if the source has fringe alpha.
          if (radiusSquared >= 1) { pixels.data[index + 3] = 0; continue; }
          const nz = Math.sqrt(Math.max(0, 1 - radiusSquared)); // Reconstructs the visible hemisphere normal's Z component.
          const illumination = clamp((nx * lightX + nz * lightZ) * 12 + 0.5, 0, 1); // Softens the day/night terminator by roughly one source pixel band.
          pixels.data[index + 3] = Math.round(pixels.data[index + 3] * illumination);
        }
      }
      context.putImageData(pixels, 0, 0);
    } catch (_) {
      context.globalAlpha = Math.max(0.08, (1 - Math.cos(mod(day, 28) / 28 * Math.PI * 2)) * 0.5); // Safe fallback if pixel reads are unavailable.
      context.globalCompositeOperation = 'destination-in';
      context.drawImage(image, 0, 0, width, height);
    }
    const texture = new THREE.CanvasTexture(canvas); // Uploads the mapped 28-day phase to the title moon sprite.
    texture.needsUpdate = true;
    return texture;
  }

  function makeCelestialSprite(THREE, texture, size) {
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }); // Keeps the luminous title celestial sprite above only the sky shell.
    const sprite = new THREE.Sprite(material); // Faces the title camera automatically while it moves along the gameplay sky arc.
    sprite.scale.set(size, size, 1);
    return sprite;
  }

  function mulberry32(seed) {
    return () => {
      seed |= 0;
      seed = seed + 0x6D2B79F5 | 0;
      let value = Math.imul(seed ^ seed >>> 15, 1 | seed); // Advances the deterministic title cloud-atlas generator.
      value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
  }

  function createCloudAtlas(THREE, images, bandIndex) {
    const canvas = document.createElement('canvas'); // Bakes the same runtime cloud sprites into one inward-facing shell texture.
    canvas.width = 2048;
    canvas.height = 1024;
    const context = canvas.getContext('2d'); // Draws deterministic clear-weather cloud placement for this title shell.
    const random = mulberry32((0x484f4255 + bandIndex * 7919) >>> 0); // Matches the gameplay atlas's stable HOBU-derived band seed.
    const count = Math.max(1, Math.round(CLOUD_COUNTS[bandIndex] * lerp(0.92, 2.55, CLEAR_SKY_CLOUD_COVER))); // Matches gameplay's clear-sky density calculation.
    for (let i = 0; i < count; i++) {
      const image = images[Math.floor(random() * images.length) % images.length]; // Selects one of the eight authored sky cloud sprites.
      const baseWidth = lerp(150, 390, random()) * lerp(0.82, 1.18, bandIndex / Math.max(1, CLOUD_RADII.length - 1)); // Gives each shell varied but broad cloud silhouettes.
      const aspect = (image.naturalHeight || image.height || 1) / Math.max(1, image.naturalWidth || image.width || 1); // Preserves the authored cloud sprite aspect ratio.
      const width = baseWidth;
      const height = width * aspect;
      const x = random() * canvas.width;
      const y = lerp(canvas.height * 0.15, canvas.height * 0.72, random());
      context.globalAlpha = lerp(0.32, 0.72, random()) * lerp(0.86, 0.58, bandIndex / 2);
      context.drawImage(image, x - width * 0.5, y - height * 0.5, width, height);
      if (x < width * 0.5) context.drawImage(image, x - width * 0.5 + canvas.width, y - height * 0.5, width, height);
      if (x > canvas.width - width * 0.5) context.drawImage(image, x - width * 0.5 - canvas.width, y - height * 0.5, width, height);
    }
    context.globalAlpha = 1;
    const texture = new THREE.CanvasTexture(canvas); // Uploads the title cloud atlas to its matching inward-facing sphere.
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;
    return texture;
  }

  async function loadSkySprites(THREE, state) {
    const sunPack = await makeImageTexture(THREE, `${SKY_ASSET_BASE}sun.png`); // Reuses the gameplay sun sprite for the title sky.
    const moonPack = await makeImageTexture(THREE, `${SKY_ASSET_BASE}moon.png`); // Reuses the gameplay moon sprite as the source for mapped phases.
    const cloudImages = await Promise.all(Array.from({ length: 8 }, (_, index) => new Promise((resolve, reject) => {
      const image = new Image(); // Loads one authored gameplay cloud sprite for the title's three cloud shells.
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`failed to load cloud${index + 1}.png`));
      image.src = `${SKY_ASSET_BASE}cloud${index + 1}.png`;
    })));
    if (!active || state.disposed) return;

    state.sun = makeCelestialSprite(THREE, sunPack.texture, 22); // Mirrors the gameplay sun's authored world-space size.
    state.moonSource = moonPack.image; // Retains the authored moon image so a new 28-day phase can be rebuilt if the mapped date rolls over.
    state.moonDay = -1; // Forces the first animation frame to build the current mapped lunar phase.
    state.moon = makeCelestialSprite(THREE, moonPhaseTexture(THREE, state.moonSource, 14), 20); // Creates a temporary full moon until the next mapped frame replaces its phase.
    state.root.add(state.sun, state.moon);

    state.clouds = CLOUD_RADII.map((radius, index) => {
      const texture = createCloudAtlas(THREE, cloudImages, index); // Builds this shell from the same eight runtime cloud sprites.
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        side: THREE.BackSide,
        transparent: true,
        opacity: [0.72, 0.58, 0.44][index],
        depthTest: false,
        depthWrite: false,
        fog: false,
      }); // Keeps title clouds translucent and inside-facing like the gameplay cloud domes.
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), material); // Mirrors gameplay's concentric spherical cloud-shell layout.
      state.root.add(mesh);
      return { mesh, material, texture, speed: CLOUD_SPEEDS[index] };
    });
    state.assetsReady = true;
  }

  function updateCelestials(THREE, state, snapshot) {
    if (state.sun) {
      const sunUv = sunUvForHour(snapshot.hour); // Resolves gameplay-equivalent sun UV from the mapped Khymeryyan title time.
      state.sun.position.copy(uvToSphere(THREE, sunUv.u, sunUv.v, CELESTIAL_RADIUS));
      state.sun.material.opacity = celestialOpacity('sun', snapshot.hour);
      state.sun.visible = state.sun.material.opacity > 0.001;
    }
    if (state.moon) {
      if (state.moonDay !== snapshot.lunarDay && state.moonSource) {
        state.moon.material.map?.dispose?.();
        state.moon.material.map = moonPhaseTexture(THREE, state.moonSource, snapshot.lunarDay);
        state.moon.material.needsUpdate = true;
        state.moonDay = snapshot.lunarDay;
      }
      const moonUv = moonUvForHour(snapshot.hour); // Resolves gameplay-equivalent moon UV from the mapped Khymeryyan title time.
      state.moon.position.copy(uvToSphere(THREE, moonUv.u, moonUv.v, CELESTIAL_RADIUS));
      state.moon.material.opacity = celestialOpacity('moon', snapshot.hour);
      state.moon.visible = state.moon.material.opacity > 0.001;
    }
  }

  function resizeTitleSky(state) {
    const width = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1); // Supplies the title canvas's current CSS width.
    const height = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1); // Supplies the title canvas's current CSS height.
    state.renderer.setPixelRatio(Math.min(TITLE_PIXEL_RATIO_CAP, window.devicePixelRatio || 1));
    state.renderer.setSize(width, height, false);
    state.camera.aspect = width / height;
    state.camera.updateProjectionMatrix();
  }

  function destroyTitleSky() {
    const state = titleSky; // Captures the current title renderer so disposal stays safe if this function is called twice.
    if (!state) return;
    titleSky = null;
    state.disposed = true;
    if (state.raf) cancelAnimationFrame(state.raf);
    window.removeEventListener('resize', state.onResize);
    try {
      state.root.traverse(object => {
        object.geometry?.dispose?.();
        const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
        for (const material of materials) {
          material.map?.dispose?.();
          material.dispose?.();
        }
      });
      state.renderer.dispose();
    } catch (_) {}
    state.canvas.remove();
  }

  function startTitleSky() {
    const THREE = window.THREE; // Reuses the exact Three.js r128 global already loaded by docs/index.html before FormatUtils/title runtime.
    if (!THREE?.WebGLRenderer) {
      titleSkyError = 'THREE.WebGLRenderer unavailable';
      return;
    }
    const canvas = document.createElement('canvas'); // Provides a dedicated sky-only surface so no world geometry can leak behind the title.
    canvas.id = SKY_CANVAS_ID;
    canvas.setAttribute('aria-hidden', 'true');
    document.documentElement.appendChild(canvas);

    try {
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' }); // Renders only the title skydome, independent of gameplay's renderer/scene.
      renderer.setClearColor(0x000000, 1);
      const scene = new THREE.Scene(); // Contains only the inside-facing skydome, celestial sprites, and cloud shells requested for the title shot.
      const camera = new THREE.PerspectiveCamera(TITLE_SKY_FOV, 1, 0.1, 220); // Sits at the sphere center with enough far range for the 198-unit gameplay shell.
      camera.position.set(0, 0, 0);
      camera.lookAt(new THREE.Vector3(0, 22, -100));
      const root = new THREE.Group(); // Owns every title skydome element for one-step disposal after the start fade.
      const skyMaterial = createSkyMaterial(THREE); // Uses the gameplay skydome's exact gradient/star shader.
      const skyMesh = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 64, 36), skyMaterial); // Matches gameplay geometry and renders its BackSide from the center.
      skyMesh.frustumCulled = false;
      root.add(skyMesh);
      scene.add(root);

      const state = {
        canvas, renderer, scene, camera, root, skyMaterial,
        sun: null, moon: null, moonSource: null, moonDay: -1,
        clouds: [], assetsReady: false, disposed: false,
        lastFrameMs: performance.now(), raf: 0, onResize: null,
      }; // Retains all disposable renderer resources and mapped animation state for the title lifetime.
      state.onResize = () => resizeTitleSky(state);
      titleSky = state;
      resizeTitleSky(state);
      window.addEventListener('resize', state.onResize, { passive: true });
      loadSkySprites(THREE, state).catch(error => { titleSkyError = String(error?.message || error); });

      const frame = nowMs => {
        if (!active || state.disposed || titleSky !== state) return;
        const dt = Math.max(0, Math.min(0.1, (nowMs - state.lastFrameMs) / 1000)); // Caps startup-tab stalls before advancing decorative cloud drift.
        state.lastFrameMs = nowMs;
        const snapshot = mapRealtimeToKhymeryya(new Date()); // Recomputes the Eastern→Khymeryyan title sky continuously while the screen is open.
        mappedCalendarDebug = {
          timeZone: snapshot.timeZone,
          eastern: `${snapshot.eastern.year}-${String(snapshot.eastern.month).padStart(2, '0')}-${String(snapshot.eastern.day).padStart(2, '0')} ${String(snapshot.eastern.hour).padStart(2, '0')}:${String(snapshot.eastern.minute).padStart(2, '0')}:${String(snapshot.eastern.second).padStart(2, '0')}`,
          season: snapshot.season,
          month: snapshot.monthName,
          day: snapshot.dayOfMonth,
          time: formatMappedClock(snapshot.hour),
          hour: snapshot.hour,
          lunarDay: snapshot.lunarDay,
          earthSeasonProgress: snapshot.earthSeasonProgress,
        };
        updateSkyMaterial(THREE, state.skyMaterial, snapshot);
        updateCelestials(THREE, state, snapshot);
        for (const cloud of state.clouds) cloud.mesh.rotation.y = mod(cloud.mesh.rotation.y + cloud.speed * dt * 60, Math.PI * 2);
        renderer.render(scene, camera);
        state.raf = requestAnimationFrame(frame);
      };
      state.raf = requestAnimationFrame(frame);
    } catch (error) {
      titleSkyError = String(error?.message || error);
      canvas.remove();
    }
  }

  function settleFont() {
    if (fontSettled) return;
    fontSettled = true;
    document.documentElement.classList.add('hobunji-title-font-ready');
  }

  function loadTitleFont() {
    if (typeof FontFace !== 'function' || !document.fonts) {
      settleFont();
      return;
    }
    const face = new FontFace(FONT_FAMILY, `url('${FONT_URL}')`); // Loads the existing Khymeryyan Roman title face without blocking the sky canvas.
    face.load()
      .then(loadedFace => {
        document.fonts.add(loadedFace);
        settleFont();
      })
      .catch(settleFont);
    window.setTimeout(settleFont, 2500); // Fails open to the fallback face if the local font cannot resolve.
  }

  function consumeEvent(event) {
    if (!active) return;
    if (event.cancelable) event.preventDefault();
    event.stopPropagation?.();
    event.stopImmediatePropagation?.();
    if (!starting && START_EVENTS.has(event.type)) beginStart(event.type);
  }

  function installEventGate() {
    for (const type of INPUT_EVENTS) {
      window.addEventListener(type, consumeEvent, { capture:true, passive:false });
    }
  }

  function removeEventGate() {
    for (const type of INPUT_EVENTS) {
      window.removeEventListener(type, consumeEvent, { capture:true });
    }
  }

  function gamepadInputDown(gamepads) {
    for (const gamepad of Array.from(gamepads || [])) {
      if (!gamepad) continue;
      if (Array.from(gamepad.buttons || []).some(button => !!button?.pressed || Number(button?.value || 0) > 0.5)) return true;
      if (Array.from(gamepad.axes || []).some(axis => Math.abs(Number(axis || 0)) >= GAMEPAD_AXIS_THRESHOLD)) return true;
    }
    return false;
  }

  function neutralGamepad(gamepad) {
    if (!gamepad) return gamepad;
    const buttons = Array.from(gamepad.buttons || [], () => ({ pressed:false, touched:false, value:0 })); // Hides title-screen button presses from gameplay until the gate exits.
    const axes = Array.from(gamepad.axes || [], () => 0); // Hides title-screen stick input from gameplay until the gate exits.
    return new Proxy(gamepad, {
      get(target, property) {
        if (property === 'buttons') return buttons;
        if (property === 'axes') return axes;
        const value = Reflect.get(target, property, target); // Preserves all non-input Gamepad properties/methods on the wrapped snapshot.
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }

  function installControllerGate() {
    if (typeof navigator.getGamepads !== 'function' || navigator.getGamepads.__hobunjiTitleWrapped) return null;
    const realGetGamepads = navigator.getGamepads.bind(navigator); // Used privately to detect real controller input while gameplay sees neutral snapshots.
    const wrappedGetGamepads = function getGamepadsWithTitleGate() {
      const gamepads = realGetGamepads(); // Supplies the browser's real snapshots to either the title or gameplay depending on gate state.
      if (!active) return gamepads;
      return Array.from(gamepads || [], neutralGamepad);
    };
    wrappedGetGamepads.__hobunjiTitleWrapped = true;
    try {
      Object.defineProperty(navigator, 'getGamepads', { configurable:true, value:wrappedGetGamepads });
      controllerGateInstalled = true;
    } catch (_) {
      controllerGateInstalled = false;
    }
    return realGetGamepads;
  }

  function pollGamepad(realGetGamepads) {
    if (!active || typeof realGetGamepads !== 'function') return;
    let isDown = false; // Tracks whether any real controller input crosses the title-screen threshold this animation frame.
    try { isDown = gamepadInputDown(realGetGamepads()); } catch (_) {}
    if (!gamepadPollPrimed) {
      gamepadPollPrimed = true;
      gamepadWasDown = isDown;
    } else {
      if (isDown && !gamepadWasDown && !starting) beginStart('gamepad');
      gamepadWasDown = isDown;
    }
    if (active) gamepadPollRaf = requestAnimationFrame(() => pollGamepad(realGetGamepads));
  }

  function beginStart(source = 'api') {
    if (!active || starting) return false;
    starting = true;
    document.documentElement.classList.add('hobunji-title-leaving');
    window.dispatchEvent(new CustomEvent('hobunji-title-starting', { detail:{ source } }));
    window.setTimeout(() => {
      active = false;
      if (gamepadPollRaf) cancelAnimationFrame(gamepadPollRaf);
      gamepadPollRaf = 0;
      removeEventGate();
      destroyTitleSky();
      document.documentElement.classList.remove(
        'hobunji-title-active',
        'hobunji-title-font-ready',
        'hobunji-title-leaving',
      );
      window.dispatchEvent(new CustomEvent('hobunji-title-started', { detail:{ source } }));
    }, EXIT_MS);
    return true;
  }

  installStyles();
  document.documentElement.classList.add('hobunji-title-active');
  startTitleSky();
  installEventGate();
  loadTitleFont();
  const realGetGamepads = installControllerGate(); // Retains the unwrapped browser method for title-only rising-edge polling.
  if (realGetGamepads) gamepadPollRaf = requestAnimationFrame(() => pollGamepad(realGetGamepads));

  window.HobunjiTitleScreen = Object.freeze({
    installed:true,
    isActive:() => active,
    start:() => beginStart('api'),
    getRealtimeCalendar:() => mapRealtimeToKhymeryya(new Date()),
    getDebug:() => ({
      active,
      starting,
      fontSettled,
      controllerGateInstalled,
      gamepadPollPrimed,
      titleSkyReady: Boolean(titleSky && !titleSky.disposed),
      titleSkyAssetsReady: Boolean(titleSky?.assetsReady),
      titleSkyError,
      mappedCalendar: mappedCalendarDebug,
    }),
  });
})();
