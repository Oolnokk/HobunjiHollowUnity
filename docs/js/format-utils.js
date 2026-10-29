(() => {
  'use strict';

  // Install the startup title screen synchronously while the main game page is
  // still parsing. This keeps the black/title layer and its capture-phase input
  // gate in front of every later gameplay/UI listener without changing index.html.
  (function loadTitleScreenRuntime() {
    if (typeof document === 'undefined') return;
    const src = 'js/title-screen-runtime.js?v=20260921preworldsky2'; // Cache-busts the title runtime after the shared title/onboarding/loading sky lifecycle update.
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
    const src = 'js/entry-tunnel-door-furniture.js?v=20261028entrancewood1'; // Used by this one-time parser-synchronous companion loader.
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

  // Stable progression used to be reachable only through FarmTroughs ->
  // LivestockNursery -> install bridge. That indirect chain meant the real
  // FarmPanel could publish without StableAnimalProgression ever seeing it,
  // leaving the authored "leveling coming soon" Stable rows untouched. This
  // pre-game bootstrap is already the page's synchronous bridge host, so load
  // the farm feature bridge here as well. It installs the Stable modules and
  // captures FarmPanel's publication before game.js initializes it. The later
  // FarmTroughs bootstrap remains safe because every feature installer is
  // idempotent and the bridge deliberately tolerates a repeated handoff.
  (function loadStableAnimalFeatureBridge() {
    if (typeof document === 'undefined') return;
    const src = 'js/livestock-nursery-install-bridge.js?v=20261028hfurybridge1';
    if (document.querySelector('script[data-stable-animal-feature-bridge]')) return;
    if (document.readyState === 'loading') {
      document.write(`<script src="${src}" data-stable-animal-feature-bridge="1"><\/script>`);
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.dataset.stableAnimalFeatureBridge = '1';
    document.head.appendChild(script);
  })();

  // WallBuilder is already loaded before HousePieceGen/FormatUtils in the main
  // game page. Install base log geometry, the shared wood PNG/cap repair, then
  // the log-wall atlas bridge synchronously. WoodCutSurfaces also hooks future
  // FoliageGenerator/FoliageFurnitureRenderer publication, so the same cap fix
  // reaches direct procedural stumps and V27-authored fallen logs/stumps.
  (function loadLogWallExtension() {
    if (typeof document === 'undefined') return;
    const extensionSrc = 'js/log-wall-extension.js?v=20261023h81e6928'; // Base generated/baked log-cabin wall runtime authority.
    const woodSrc = 'js/wood-cut-surfaces.js?v=20261014woodcaps1'; // Shared wavy_surface.png bark + log.png end-cap repair across walls/stumps/logs.
    const materialsSrc = 'js/log-wall-materials.js?v=20261014logwallmat2'; // One-material PNG atlas bridge layered over generated log geometry.
    const hasExtension = !!window.LogWallExtension || !!document.querySelector('script[data-log-wall-extension]'); // Existing base bridge state used to avoid duplicate script insertion.
    const hasWood = !!window.WoodCutSurfaces || !!document.querySelector('script[data-wood-cut-surfaces]'); // Shared cap/material repair state used by game and nested tools.
    const hasMaterials = !!window.LogWallMaterials || !!document.querySelector('script[data-log-wall-materials]'); // Existing material bridge state used by parser-time and late-load paths.
    if (hasExtension && hasWood && hasMaterials) return;
    if (document.readyState === 'loading') {
      const extensionTag = hasExtension ? '' : `<script src="${extensionSrc}" data-log-wall-extension="1"><\/script>`; // Base bridge tag emitted first.
      const woodTag = hasWood ? '' : `<script src="${woodSrc}" data-wood-cut-surfaces="1"><\/script>`; // Shared wood helper emitted before dependent atlas material bridge.
      const materialsTag = hasMaterials ? '' : `<script src="${materialsSrc}" data-log-wall-materials="1"><\/script>`; // Atlas bridge emitted after base + shared wood helpers.
      document.write(`${extensionTag}${woodTag}${materialsTag}`);
      return;
    }
    const loadMaterials = () => { // Late-load helper preserving base -> shared wood -> atlas ordering.
      if (window.LogWallMaterials || document.querySelector('script[data-log-wall-materials]')) return;
      const materialScript = document.createElement('script'); // Late-loaded log-wall PNG atlas bridge.
      materialScript.src = materialsSrc;
      materialScript.dataset.logWallMaterials = '1';
      document.head.appendChild(materialScript);
    };
    const loadWood = () => { // Late-load helper installs cross-board foliage cap repair before log-wall materials.
      if (window.WoodCutSurfaces) { loadMaterials(); return; }
      if (document.querySelector('script[data-wood-cut-surfaces]')) return;
      const woodScript = document.createElement('script'); // Shared wood repair loaded before the dependent atlas layer.
      woodScript.src = woodSrc;
      woodScript.dataset.woodCutSurfaces = '1';
      woodScript.addEventListener('load', loadMaterials, { once: true });
      document.head.appendChild(woodScript);
    };
    if (window.LogWallExtension) {
      loadWood();
      return;
    }
    const script = document.createElement('script'); // Late-loaded base log extension whose load event chains shared wood + atlas layers.
    script.src = extensionSrc;
    script.dataset.logWallExtension = '1';
    script.addEventListener('load', loadWood, { once: true });
    document.head.appendChild(script);
  })();


  // Stacked architectural log walls are length-generated by FoliageGenerator.
  // This helper can load before foliage itself; it resolves that API only when
  // a house/interior actually asks it to build, after normal game boot.
  (function loadStackedLogWalls() {
    if (typeof document === 'undefined') return;
    const src = 'js/stacked-log-walls.js?v=20261023hbaf9a0b'; // Shared exact-span architecture renderer for exterior/interior log walls.
    if (window.StackedLogWalls || document.querySelector('script[data-stacked-log-walls]')) return;
    if (document.readyState === 'loading') {
      document.write(`<script src="${src}" data-stacked-log-walls="1"><\/script>`);
      return;
    }
    const script = document.createElement('script'); // Late-load fallback for nested game boot paths that import FormatUtils after parsing.
    script.src = src;
    script.dataset.stackedLogWalls = '1';
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