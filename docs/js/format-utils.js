(() => {
  'use strict';

  // Install the startup title screen synchronously while the main game page is
  // still parsing. This keeps the black/title layer and its capture-phase input
  // gate in front of every later gameplay/UI listener without changing index.html.
  (function loadTitleScreenRuntime() {
    if (typeof document === 'undefined') return;
    const src = 'js/title-screen-runtime.js?v=20260908a'; // One-time parser-synchronous startup-title runtime.
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
    script.dataset.hobunjiTitleScreen = '1';
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

  // Roof climbing must see the post-entry-carve authored structure planes, but
  // must install before climb-system.js so its final wrapper can capture the
  // existing climb animation before game.js initializes it.
  (function loadRoofClimb() {
    if (typeof document === 'undefined') return;
    const src = 'js/roof-climb.js?v=20260911roofclimb5'; // Cache-busts self-healing player-proximity structural wall/roof climbing behavior.
    if (window.HobunjiRoofClimb || document.querySelector('script[data-hobunji-roof-climb]')) return;
    if (document.readyState === 'loading') {
      document.write(`<script src="${src}" data-hobunji-roof-climb="1"><\/script>`);
      return;
    }
    const script = document.createElement('script'); // Used only when FormatUtils is loaded after initial HTML parsing.
    script.src = src;
    script.dataset.hobunjiRoofClimb = '1';
    document.head.appendChild(script);
  })();

  // Final structural-surface policy sits above roof-climb.js: near-contact wall
  // gating, wall-plane-following animation, fresh-input roof movement, and
  // explicit wall/shingle visual offsets all live here. It still loads before
  // climb-system.js so it can capture the exact movement deps synchronously.
  (function loadRoofClimbSurfaceRefinement() {
    if (typeof document === 'undefined') return;
    const src = 'js/roof-climb-surface-refinement.js?v=20260912a'; // Cache-busts contact-distance, wall-angle, roof-movement, and surface-offset refinements.
    if (window.HobunjiRoofClimbSurfaceRefinement || document.querySelector('script[data-hobunji-roof-surface-refinement]')) return;
    if (document.readyState === 'loading') {
      document.write(`<script src="${src}" data-hobunji-roof-surface-refinement="1"><\/script>`);
      return;
    }
    const script = document.createElement('script'); // Used only when FormatUtils is loaded after initial HTML parsing.
    script.src = src;
    script.dataset.hobunjiRoofSurfaceRefinement = '1';
    document.head.appendChild(script);
  })();

  // Extends roof climbing with Pixel Probe diagnostics and deliberately removes
  // the old entrance-adjacency exclusion. Load immediately after roof-climb so
  // every later building spawn receives the same entrance-neutral metadata.
  (function loadRoofClimbPixelProbe() {
    if (typeof document === 'undefined') return;
    const src = 'js/roof-climb-pixel-probe.js?v=20260911roofprobe5'; // Cache-busts live-hook/popup-aware climb diagnostics and entrance-adjacency disable.
    if (window.HobunjiRoofClimbProbe || document.querySelector('script[data-hobunji-roof-climb-probe]')) return;
    if (document.readyState === 'loading') {
      document.write(`<script src="${src}" data-hobunji-roof-climb-probe="1"><\/script>`);
      return;
    }
    const script = document.createElement('script'); // Used only when FormatUtils is loaded after initial HTML parsing.
    script.src = src;
    script.dataset.hobunjiRoofClimbProbe = '1';
    document.head.appendChild(script);
  })();

  // Plateau walk-off detection needs the same fresh getMovementInput dependency
  // ClimbSystem uses, rather than player.inputX/Y from the previous movement tick.
  // Load before climb-system.js so this bridge can capture its init dependencies.
  (function loadPlateauFallLiveBridge() {
    if (typeof document === 'undefined') return;
    const src = 'js/plateau-fall-live-bridge.js?v=20260911plateaufalllive2'; // Cache-busts fallback-aware fresh-input plateau fall detection and diagnostics.
    if (window.HobunjiPlateauFallLive || document.querySelector('script[data-hobunji-plateau-fall-live]')) return;
    if (document.readyState === 'loading') {
      document.write(`<script src="${src}" data-hobunji-plateau-fall-live="1"><\/script>`);
      return;
    }
    const script = document.createElement('script'); // Used only when FormatUtils is loaded after initial HTML parsing.
    script.src = src;
    script.dataset.hobunjiPlateauFallLive = '1';
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
    context.arcTo(x, y, x + radius, y, radius);
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