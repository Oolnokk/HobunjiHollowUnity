(() => {
  'use strict';

  // GitHack can redirect repository image requests across origins. The title
  // skydome draws moon/cloud sprites into canvases before uploading them to
  // WebGL, so those images must opt into anonymous CORS before `src` starts
  // the request or the canvas becomes permanently tainted. Keep this guard
  // narrowly scoped to the shared sky-sprite directory; all other image loads
  // retain their existing behavior. sky-dome.js already sets crossOrigin on
  // its own Image instances, so this also makes the title bootstrap match the
  // production gameplay loader instead of introducing a second asset policy.
  (function installSkySpriteCorsGuard() {
    if (typeof HTMLImageElement === 'undefined') return;
    const prototype = HTMLImageElement.prototype; // Supplies the native image `src` accessor used by every title sky sprite.
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'src'); // Retains the browser's original getter/setter flags while wrapping only assignment.
    if (!descriptor?.set || descriptor.set.__hobunjiSkySpriteCorsGuard) return;
    const nativeSet = descriptor.set; // Used to perform the real URL assignment after the CORS mode has been selected.
    const guardedSet = function hobunjiSkySpriteCorsSrc(value) {
      const source = String(value ?? ''); // Used only to recognize the repository's authored sky-sprite asset path.
      if (source.includes('assets/sky_sprites/')) {
        try { this.crossOrigin = 'anonymous'; } catch (_) {}
      }
      return nativeSet.call(this, value);
    };
    guardedSet.__hobunjiSkySpriteCorsGuard = true;
    try {
      Object.defineProperty(prototype, 'src', { ...descriptor, set: guardedSet });
    } catch (_) {
      // If a browser exposes a non-configurable accessor, leave native loading
      // untouched; the title's existing debug state will still expose failure.
    }
  })();

  // Install the startup title screen synchronously while the main game page is
  // still parsing. This keeps the title layer and its capture-phase input gate
  // in front of every later gameplay/UI listener without changing index.html.
  (function loadTitleScreenRuntime() {
    if (typeof document === 'undefined') return;
    const src = 'js/title-screen-runtime.js?v=20260908d'; // Cache-busts the title runtime after input-gate and gameplay-speed cloud fixes.
    if (window.HobunjiTitleScreen || document.querySelector('script[data-hobunji-title-screen]')) return;
    if (document.readyState === 'loading') {
      document.write(`<script src="${src}" data-hobunji-title-screen="1"><\/script>`);
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.dataset.hobunjiTitleScreen = '1';
    document.head.appendChild(script);
  })();

  // HousePieceGen is loaded immediately before this shared pre-game helper.
  // Load the door bridge synchronously here so it can wrap both generated
  // entry tunnels and authored buildGroupFromPiece structures before game.js
  // creates any world structures.
  (function loadEntryTunnelDoorFurniture() {
    if (typeof document === 'undefined') return;
    const src = 'js/entry-tunnel-door-furniture.js?v=20260907b'; // Used by this one-time parser-synchronous companion loader.
    if (window.EntryTunnelDoorFurniture || document.querySelector('script[data-entry-tunnel-door-furniture]')) return;
    if (document.readyState === 'loading') {
      document.write(`<script src="${src}" data-entry-tunnel-door-furniture="1"><\/script>`);
      return;
    }
    const script = document.createElement('script'); // Used only when FormatUtils is loaded after initial HTML parsing.
    script.src = src;
    script.dataset.entryTunnelDoorFurniture = '1';
    document.head.appendChild(script);
  })();

  // Entry-tunnel door furniture and authored house rendering share the same
  // buildGroupFromPiece boundary. Load this immediately after the door bridge
  // so crossing authored wall quads are carved around tunnel cells before
  // WallBuilder receives them, without mutating cached source piece JSON.
  (function loadEntryTunnelWallUnmark() {
    if (typeof document === 'undefined') return;
    const src = 'js/entry-tunnel-wall-unmark.js?v=20260907c'; // Cache-busts the town-house wall-carving bridge.
    if (window.EntryTunnelWallUnmark || document.querySelector('script[data-entry-tunnel-wall-unmark]')) return;
    if (document.readyState === 'loading') {
      document.write(`<script src="${src}" data-entry-tunnel-wall-unmark="1"><\/script>`);
      return;
    }
    const script = document.createElement('script'); // Used only when FormatUtils is loaded after initial HTML parsing.
    script.src = src;
    script.dataset.entryTunnelWallUnmark = '1';
    document.head.appendChild(script);
  })();

  // Small formatting/math helpers extracted out of game.js following the
  // same window.<Namespace> + init(deps) pattern already used by
  // js/dye-system.js and js/bounty-board.js. equipmentSlots/TOOL_ITEM_DEFS/
  // actionLabels/calendar are game.js `const` objects that are only ever
  // mutated in place (never reassigned), so capturing them by reference at
  // init() time is safe — unlike gearInventory/player, which get swapped
  // out wholesale on load and need getter functions instead.
  let deps = null;
  function init(injectedDeps) { deps = injectedDeps; }

  function esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function roundRect(context, x, y, width, height, radius) {
    context.beginPath();
    context.moveTo(x + radius, y);
    context.arcTo(x + width, y, x + width, y + height, radius);
    context.arcTo(x + width, y + height, x, y + height, radius);
    context.arcTo(x, y + height, x, y, radius);
    context.arcTo(x, y, x + width, y, radius);
    context.closePath();
  }

  function formatClock(hourValue) {
    const hour = Math.floor(hourValue);
    const minute = Math.floor((hourValue - hour) * 60 / 10) * 10;
    const suffix = hour >= 12 ? 'PM' : 'AM';
    const displayHour = ((hour + 11) % 12) + 1;
    return `${displayHour}:${String(minute).padStart(2, '0')} ${suffix}`;
  }

  function seededRandom(seed) {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
  }

  function toolEmoji(tool) {
    const equipped = deps.equipmentSlots[tool];
    if (equipped && deps.TOOL_ITEM_DEFS[equipped]) return deps.TOOL_ITEM_DEFS[equipped].icon;
    return { shovel:'⛏️', hoe:'🪓', axe:'🪓', pick:'⛏️', harpoon:'🎣', weapon:'🗡️', ranged:'🏹', machete:'🗡️', seeds:'🌱' }[tool] || '❔';
  }

  function toolName(tool) {
    const equipped = deps.equipmentSlots[tool];
    const def = equipped ? deps.TOOL_ITEM_DEFS[equipped] : null;
    if (def) return `${def.icon} ${def.label}`;
    return { shovel:'⛏️ Shovel', hoe:'🪓 Hoe', axe:'🪓 Axe', pick:'⛏️ Pick', harpoon:'🎣 Harpoon', weapon:'🗡️ Weapon', ranged:'🏹 Ranged Weapon', machete:'🗡️ Weapon', seeds:'🌱 Seeds' }[tool] || tool;
  }

  function actionEmoji(action) {
    return deps.actionLabels[action]?.[0] || '❔';
  }

  function actionName(action) {
    if (action.startsWith('place_')) return 'Place';
    if (action.startsWith('obj_process_')) return 'Process';
    return deps.actionLabels[action]?.[1] || action;
  }

  function nextRainText() {
    const calendar = deps.calendar;
    if (!calendar.nextRainWindows.length) return 'No rain scheduled today';
    const hour = window.CalendarSystem.getHour();
    const next = calendar.nextRainWindows.find((w) => hour < w.end);
    if (!next) return 'Rain has passed for today';
    return `Next flow ${formatClock(next.start)}-${formatClock(next.end)}`;
  }

  window.FormatUtils = {
    init, esc, clamp, roundRect, formatClock, seededRandom,
    toolEmoji, toolName, actionEmoji, actionName, nextRainText,
  };
})();
