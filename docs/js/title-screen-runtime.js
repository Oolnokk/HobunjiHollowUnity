// Startup title screen shown once per page load before the player interacts with the game.
// The title uses the same bright bronze metallic ramp as the loading-screen TankanScript treatment.
(() => {
  'use strict';

  if (window.HobunjiTitleScreen?.installed) return;

  const STYLE_ID = 'hobunjiTitleScreenStyles'; // Keeps the startup overlay stylesheet idempotent.
  const FONT_FAMILY = 'HobunjiTitleRoman'; // Separates title-screen font loading from the loading-screen FontFace name.
  const FONT_URL = 'assets/hud/KhymeryyanRomanLetters+Numbers.otf.ttf'; // Existing Khymeryyan Roman font asset.
  const EXIT_MS = 320; // Short fade used after the starting input is consumed.
  const INPUT_ARM_DELAY_MS = 450; // Used to reject navigation/carryover input immediately after page load.
  const SKY_RUNTIME_SRC = 'js/title-realtime-sky.js?v=20260921preworldsky2'; // Loads the mixed Canvas2D/compositor real-time title sky.
  const SKY_CANVAS_ID = 'hobunjiTitleSky'; // Matches the base canvas created by title-realtime-sky.js.
  const SKY_CLOUD_LAYER_ID = 'hobunjiTitleCloudLayer'; // Matches the compositor-driven cloud layer created by title-realtime-sky.js.
  const GAMEPAD_AXIS_THRESHOLD = 0.72; // Avoids ordinary stick drift counting as the requested starting input.
  const INPUT_EVENTS = Object.freeze([
    'keydown', 'keyup',
    'pointerdown', 'pointerup',
    'mousedown', 'mouseup',
    'touchstart', 'touchend',
    'click', 'contextmenu', 'wheel',
  ]); // Captured before gameplay handlers so the start input cannot leak through to the game.
  const START_EVENTS = new Set(['keydown', 'pointerdown', 'mousedown', 'touchstart']); // Only fresh press-style actions dismiss the title; click/wheel carryover is swallowed.
  const STARTUP_BGM_URL = 'assets/audio/music/bgm/bgm_remembrance.m4a'; // Remembrance begins with the title itself, before the full Music module is available.
  const STARTUP_BGM_FALLBACK_VOLUME = 0.48; // Mirrors the shared BGM default until Music adopts the element and applies live config.

  let active = true; // Remains true through the fade so follow-up key/pointer events are swallowed too.
  let starting = false; // Prevents duplicate start requests from pointerdown + mousedown + click.
  let inputArmed = false; // Used to reject carryover input until the title has actually settled on screen.
  let inputArmTimer = 0; // Owns the one-shot title-input arming delay.
  let lastStartSource = null; // Used by in-game/mobile debug output to identify the accepted start input.
  let titleSkyStarted = false; // Used by debug output to confirm the lightweight sky compositor attached.
  let titleSkyLoadError = null; // Used by debug output if the standalone sky runtime cannot load or start.
  let gameplayReady = window.__hobunjiGameStarted === true; // Used to defer pre-world sky teardown if a returning save hydrates before the title is dismissed.
  let backdropReleased = false; // Used to make the one-time pre-world sky teardown idempotent across title/gameplay races.
  let backdropReleaseReason = null; // Used by mobile-visible diagnostics to report which game-start boundary released the shared sky.
  let gamepadPollRaf = 0; // Owns the rising-edge controller check independent of the game's controller polling.
  let gamepadPollPrimed = false; // Prevents a button already held during page load from instantly skipping the title screen.
  let gamepadWasDown = false; // Tracks the previous real controller snapshot for rising-edge detection.
  let controllerGateInstalled = false; // Reported by getDebug() so controller leakage can be checked on mobile.
  let fontSettled = false; // Prevents a fallback-font flash before the local Khymeryyan Roman font resolves.
  let startupBgmAudio = null; // Owns the earliest Remembrance element until Music claims the same playhead later in boot.
  let startupBgmHandedOff = false; // Prevents both title runtime and Music from independently owning the startup soundtrack.
  let startupBgmLastPlayError = null; // Exposed in title diagnostics so autoplay-policy failures are visible without a console.

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      html.hobunji-title-active {
        background:#000;
        overflow:hidden;
        overscroll-behavior:none;
      }

      #${SKY_CANVAS_ID},
      #${SKY_CLOUD_LAYER_ID} {
        position:fixed;
        inset:0;
        width:100vw;
        height:100vh;
        display:block;
        opacity:1;
        pointer-events:none;
      }

      #${SKY_CANVAS_ID} {
        z-index:100;
        background:#000;
      }

      #${SKY_CLOUD_LAYER_ID} {
        z-index:101;
        overflow:hidden;
        contain:layout paint style;
      }

      #${SKY_CLOUD_LAYER_ID} > img {
        position:absolute;
        left:-20vw;
        height:auto;
        display:block;
        transform:translate3d(0,0,0);
        animation-name:hobunjiTitleCloudDrift;
        animation-timing-function:linear;
        animation-iteration-count:infinite;
        will-change:transform;
        user-select:none;
        -webkit-user-drag:none;
      }

      @keyframes hobunjiTitleCloudDrift {
        from { transform:translate3d(0,0,0); }
        to { transform:translate3d(140vw,0,0); }
      }

      /* The same sky becomes the shared pre-world backdrop after the title
         prompt leaves. During the title itself it must still cover every
         parser-time loader/UI surface while keeping clouds above the base
         canvas and below the prompt/logo. */
      html.hobunji-title-active #${SKY_CANVAS_ID} {
        z-index:2147483643;
      }

      html.hobunji-title-active #${SKY_CLOUD_LAYER_ID} {
        z-index:2147483644;
      }

      /* Transparent prompt layer over the lightweight sky canvas. Keeping
         ::before separate lets it use background-clip:text for the logo. */
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
        text-shadow:-1px -1px 0 rgba(0,0,0,.96),0 -1px 0 rgba(0,0,0,.96),1px -1px 0 rgba(0,0,0,.96),-1px 0 0 rgba(0,0,0,.96),1px 0 0 rgba(0,0,0,.96),-1px 1px 0 rgba(0,0,0,.96),0 1px 0 rgba(0,0,0,.96),1px 1px 0 rgba(0,0,0,.96),0 2px 8px rgba(0,0,0,.9);
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
          text-shadow:-1px -1px 0 rgba(0,0,0,.96),0 -1px 0 rgba(0,0,0,.96),1px -1px 0 rgba(0,0,0,.96),-1px 0 0 rgba(0,0,0,.96),1px 0 0 rgba(0,0,0,.96),-1px 1px 0 rgba(0,0,0,.96),0 1px 0 rgba(0,0,0,.96),1px 1px 0 rgba(0,0,0,.96),0 2px 8px rgba(0,0,0,.9);
        }
        50% {
          color:rgba(255,255,255,.94);
          text-shadow:-1px -1px 0 rgba(0,0,0,.96),0 -1px 0 rgba(0,0,0,.96),1px -1px 0 rgba(0,0,0,.96),-1px 0 0 rgba(0,0,0,.96),1px 0 0 rgba(0,0,0,.96),-1px 1px 0 rgba(0,0,0,.96),0 1px 0 rgba(0,0,0,.96),1px 1px 0 rgba(0,0,0,.96),0 2px 8px rgba(0,0,0,.9),0 0 8px rgba(255,255,255,.18);
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

  function startLoadedTitleSky() {
    if (backdropReleased) return;
    try {
      const sky = window.HobunjiTitleRealtimeSky; // Used to start the separately loaded low-cost title compositor.
      if (!sky?.start) throw new Error('title sky API unavailable after load');
      sky.start();
      titleSkyStarted = true;
      titleSkyLoadError = null;
    } catch (error) {
      titleSkyStarted = false;
      titleSkyLoadError = String(error?.message || error);
    }
  }

  function loadTitleSky() {
    if (window.HobunjiTitleRealtimeSky?.start) {
      startLoadedTitleSky();
      return;
    }
    const existing = document.querySelector?.('script[data-hobunji-title-realtime-sky]'); // Used to keep the one-time sky runtime load idempotent.
    if (existing) return;
    const script = document.createElement('script'); // Used to load the isolated canvas renderer without blocking the parser.
    script.src = SKY_RUNTIME_SRC;
    script.async = true;
    script.setAttribute?.('data-hobunji-title-realtime-sky', '1');
    script.onload = startLoadedTitleSky;
    script.onerror = () => {
      titleSkyStarted = false;
      titleSkyLoadError = 'failed to load ' + SKY_RUNTIME_SRC;
    };
    (document.head || document.documentElement).appendChild(script);
  }

  function resolvedStartupBgmUrl() {
    try { return new URL(STARTUP_BGM_URL, document.baseURI).href; }
    catch (_) { return STARTUP_BGM_URL; }
  }

  function createStartupBgmAudio() {
    if (startupBgmAudio) return startupBgmAudio;
    try {
      const snd = new Audio(resolvedStartupBgmUrl());
      snd.preload = 'auto';
      snd.loop = true;
      snd.volume = STARTUP_BGM_FALLBACK_VOLUME;
      startupBgmAudio = snd;
      try { snd.load(); } catch (_) {}
      return snd;
    } catch (error) {
      startupBgmLastPlayError = String(error?.message || error);
      return null;
    }
  }

  function tryStartStartupBgm(reason = 'title boot') {
    const snd = createStartupBgmAudio();
    if (!snd || startupBgmHandedOff || !snd.paused) return snd;
    try {
      const result = snd.play();
      Promise.resolve(result).then(() => {
        startupBgmLastPlayError = null;
      }).catch(error => {
        // Browsers normally block audible autoplay before a user gesture. Keep
        // the preloaded element alive; beginStart() retries synchronously from
        // the accepted title input, where autoplay permission can be granted.
        startupBgmLastPlayError = (error?.name || 'Error') + ': ' + (error?.message || reason);
      });
    } catch (error) {
      startupBgmLastPlayError = (error?.name || 'Error') + ': ' + (error?.message || reason);
    }
    return snd;
  }

  function claimStartupBgmAudio(expectedUrl = STARTUP_BGM_URL) {
    const snd = startupBgmAudio;
    if (!snd || startupBgmHandedOff) return null;
    let expected = expectedUrl;
    try { expected = new URL(expectedUrl, document.baseURI).href; } catch (_) {}
    if (expected && snd.src !== expected) {
      try { snd.pause(); snd.currentTime = 0; } catch (_) {}
      startupBgmHandedOff = true;
      return null;
    }
    startupBgmHandedOff = true;
    return snd;
  }

  function cancelStartupBgmAudio() {
    if (startupBgmHandedOff) return false;
    const snd = startupBgmAudio;
    startupBgmHandedOff = true;
    if (!snd) return false;
    try { snd.pause(); snd.currentTime = 0; } catch (_) {}
    return true;
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
    const face = new FontFace(FONT_FAMILY, `url('${FONT_URL}')`);
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
    const freshTrustedPress = inputArmed
      && event.isTrusted === true
      && START_EVENTS.has(event.type)
      && !(event.type === 'keydown' && event.repeat); // Used to reject synthetic/carryover clicks, wheel momentum, and held-key repeats.
    if (!starting && freshTrustedPress) beginStart(event.type);
  }

  function installEventGate() {
    for (const type of INPUT_EVENTS) {
      window.addEventListener(type, consumeEvent, { capture:true, passive:false });
    }
  }

  function armInputGate() {
    if (inputArmTimer && typeof window.clearTimeout === 'function') window.clearTimeout(inputArmTimer);
    inputArmTimer = window.setTimeout(() => {
      inputArmTimer = 0;
      if (active && !starting) inputArmed = true;
    }, INPUT_ARM_DELAY_MS); // Used to ensure a navigation tap/key cannot instantly dismiss the newly loaded title.
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
    const buttons = Array.from(gamepad.buttons || [], () => ({ pressed:false, touched:false, value:0 }));
    const axes = Array.from(gamepad.axes || [], () => 0);
    return new Proxy(gamepad, {
      get(target, property) {
        if (property === 'buttons') return buttons;
        if (property === 'axes') return axes;
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }

  function installControllerGate() {
    if (typeof navigator.getGamepads !== 'function' || navigator.getGamepads.__hobunjiTitleWrapped) return null;
    const realGetGamepads = navigator.getGamepads.bind(navigator); // Used privately to detect real controller input while gameplay sees neutral snapshots.
    const wrappedGetGamepads = function getGamepadsWithTitleGate() {
      const gamepads = realGetGamepads();
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
    let isDown = false;
    try { isDown = gamepadInputDown(realGetGamepads()); } catch (_) {}
    if (!gamepadPollPrimed) {
      gamepadPollPrimed = true;
      gamepadWasDown = isDown;
    } else {
      if (inputArmed && isDown && !gamepadWasDown && !starting) beginStart('gamepad');
      gamepadWasDown = isDown;
    }
  }

  function releaseBackdrop(reason = 'game-started') {
    if (backdropReleased) return true;
    gameplayReady = true;
    backdropReleaseReason = reason;
    if (active) return false;
    backdropReleased = true;
    document.documentElement.classList.remove('hobunji-preworld-sky-active');
    try { window.HobunjiTitleRealtimeSky?.destroy?.(); } catch (_) {}
    titleSkyStarted = false;
    return true;
  }

  function beginStart(source = 'api') {
    if (!active || starting) return false;
    starting = true;
    inputArmed = false;
    lastStartSource = source;
    if (inputArmTimer && typeof window.clearTimeout === 'function') window.clearTimeout(inputArmTimer);
    inputArmTimer = 0;
    document.documentElement.classList.add('hobunji-title-leaving');
    // This call stays inside the accepted keyboard/pointer event. If page-load
    // autoplay was blocked, the browser can now authorize Remembrance before
    // the title runtime swallows the same input from gameplay.
    tryStartStartupBgm('title input: ' + source);
    window.dispatchEvent(new CustomEvent('hobunji-title-starting', { detail:{ source } }));
    window.setTimeout(() => {
      active = false;
      starting = false;
      if (gamepadPollRaf) clearInterval(gamepadPollRaf);
      gamepadPollRaf = 0;
      removeEventGate();
      document.documentElement.classList.remove(
        'hobunji-title-active',
        'hobunji-title-font-ready',
        'hobunji-title-leaving',
      );
      window.dispatchEvent(new CustomEvent('hobunji-title-started', { detail:{ source } }));
      if (gameplayReady) releaseBackdrop(backdropReleaseReason || 'game-started-before-title-exit');
    }, EXIT_MS);
    return true;
  }

  installStyles();
  document.documentElement.classList.add('hobunji-preworld-sky-active', 'hobunji-title-active');
  tryStartStartupBgm(); // Earliest possible soundtrack start; blocked autoplay is retried by beginStart().
  loadTitleSky();
  installEventGate();
  armInputGate();
  loadTitleFont();
  const realGetGamepads = installControllerGate();
  if (realGetGamepads) gamepadPollRaf = setInterval(() => pollGamepad(realGetGamepads), 50); // A bounded wait-for-input poll; no per-frame cadence needed.

  window.HobunjiTitleScreen = Object.freeze({
    installed:true,
    isActive:() => active,
    start:() => beginStart('api'),
    releaseBackdrop,
    claimStartupBgmAudio,
    cancelStartupBgmAudio,
    getRealtimeCalendar:(date = new Date()) => window.HobunjiTitleRealtimeSky?.getRealtimeCalendar?.(date) || null,
    getDebug:() => ({
      active,
      starting,
      inputArmed,
      inputArmDelayMs: INPUT_ARM_DELAY_MS,
      lastStartSource,
      fontSettled,
      controllerGateInstalled,
      gamepadPollPrimed,
      titleSkyStarted,
      titleSkyLoadError,
      gameplayReady,
      backdropReleased,
      backdropReleaseReason,
      preworldSkyClass: document.documentElement.classList.contains?.('hobunji-preworld-sky-active') ?? false,
      startupBgmCreated: !!startupBgmAudio,
      startupBgmPlaying: !!startupBgmAudio && !startupBgmAudio.paused,
      startupBgmCurrentTime: Number(startupBgmAudio?.currentTime || 0),
      startupBgmHandedOff,
      startupBgmLastPlayError,
      titleSky: window.HobunjiTitleRealtimeSky?.getDebug?.() || null,
    }),
  });
})();
