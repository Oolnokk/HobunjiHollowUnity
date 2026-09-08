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
  const INPUT_EVENTS = Object.freeze([
    'keydown', 'keyup',
    'pointerdown', 'pointerup',
    'mousedown', 'mouseup',
    'touchstart', 'touchend',
    'click', 'contextmenu', 'wheel',
  ]); // Captured before gameplay handlers so the start input cannot leak through to the game.
  const START_EVENTS = new Set(['keydown', 'pointerdown', 'mousedown', 'touchstart', 'click', 'wheel']); // Events that can dismiss the title screen.

  let active = true; // Remains true through the fade so follow-up key/pointer events are swallowed too.
  let starting = false; // Prevents duplicate start requests from pointerdown + mousedown + click.
  let gamepadPollRaf = 0; // Owns the rising-edge controller check independent of the game's controller polling.
  let gamepadPollPrimed = false; // Prevents a button already held during page load from instantly skipping the title screen.
  let gamepadWasDown = false; // Tracks the previous real controller snapshot for rising-edge detection.
  let controllerGateInstalled = false; // Reported by getDebug() so controller leakage can be checked on mobile.
  let fontSettled = false; // Prevents a fallback-font flash before the local Khymeryyan Roman font resolves.

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

      /* Full-screen black layer + prompt. Keeping the background on ::after
         lets ::before use background-clip:text for the metallic title itself. */
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
        background:#000;
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
  installEventGate();
  loadTitleFont();
  const realGetGamepads = installControllerGate();
  if (realGetGamepads) gamepadPollRaf = requestAnimationFrame(() => pollGamepad(realGetGamepads));

  window.HobunjiTitleScreen = Object.freeze({
    installed:true,
    isActive:() => active,
    start:() => beginStart('api'),
    getDebug:() => ({ active, starting, fontSettled, controllerGateInstalled, gamepadPollPrimed }),
  });
})();
