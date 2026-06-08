    (() => {
      'use strict';

      const threeContainer = document.getElementById('threeContainer');
      const overlayCanvas  = document.getElementById('overlayCanvas');
      const octx           = overlayCanvas.getContext('2d');
      const lightingCanvas = document.getElementById('lightingCanvas');
      const lctx           = lightingCanvas.getContext('2d');
      const debugLog = window.__farmLog || ((m) => console.log(m));
      const joystickZone = document.getElementById('joystickZone');
      const joystickKnob = document.getElementById('joystickKnob');

      // Status pill
      const spTime    = document.getElementById('spTime');
      const spSeason  = document.getElementById('spSeason');
      const spWeather = document.getElementById('spWeather');
      const spTool    = document.getElementById('spTool');
      const spTile    = document.getElementById('spTile');
      const spWater   = document.getElementById('spWater');
      const spGold    = document.getElementById('spGold');

      // Menu
      const menuBtn        = document.getElementById('menuBtn');
      const menuBackdrop   = document.getElementById('menuBackdrop');
      const menuPanel      = document.getElementById('menuPanel');
      // Legacy compat arrays — empty since old .menu-tab/.menu-page elements removed
      const menuTabs       = [];
      const menuPages      = [];
      const menuPauseBtn   = document.getElementById('menuPauseBtn');
      const menuResetBtn   = document.getElementById('menuResetBtn');
      const toastEl   = document.getElementById('toast');
      const keyHudEl  = document.getElementById('keyHud');
      const isDesktop = window.matchMedia('(pointer: fine)').matches;

      // Tool select (replaces rightCluster)
      const toolSelect      = document.getElementById('toolSelect');
      const toolBtn        = document.getElementById('toolBtn');
      const toolBtnIcon    = document.getElementById('toolBtnIcon');
      const toolBtnLabel   = document.getElementById('toolBtnLabel');
      const toolPicker     = document.getElementById('toolPicker');
      const toolPickBtns   = [...document.querySelectorAll('.tool-pick-btn')];
      // actionRows removed — refreshActionBar now targets fixed #btnActionN elements

      // Item scroll
      const itemPrev   = document.getElementById('itemPrev');
      const itemNext   = document.getElementById('itemNext');
      const itemIcon   = document.getElementById('itemIcon');
      const itemName   = document.getElementById('itemName');
      const itemCount  = document.getElementById('itemCount');


      // ── Split layout fit ──────────────────────────────────────────
      // Computes the centered 16:9 UI rect for menus/HUD scale, while letting
      // the Three.js view fill the whole screen horizontally on wide displays.
      // Gameplay edge anchors are used below by controls that should spread to thumbs/screen edges.
      function fitToAspect() {
        const W = window.innerWidth, H = window.innerHeight;
        const R = 16 / 9;
        let gw, gh, ox, oy;
        const isWide = W / H > R;
        if (isWide) {
          // Wider than 16:9 → keep UI/menu scale centered, but do not pillarbox the 3D view.
          gh = H;           gw = Math.round(H * R);
          oy = 0;           ox = Math.round((W - gw) / 2);
        } else {
          // Taller/narrower than 16:9 → current behavior: 16:9 game and UI rect letterboxed vertically.
          gw = W;           gh = Math.round(W / R);
          ox = 0;           oy = Math.round((H - gh) / 2);
        }
        const col = gw / 32, row = gh / 18;
        const rs = document.documentElement.style;
        rs.setProperty('--ox',  ox  + 'px');
        rs.setProperty('--oy',  oy  + 'px');
        rs.setProperty('--gw',  gw  + 'px');
        rs.setProperty('--gh',  gh  + 'px');
        rs.setProperty('--col', col + 'px');
        rs.setProperty('--row', row + 'px');
        rs.setProperty('--play-left', '0px');
        rs.setProperty('--play-right', W + 'px');
        rs.setProperty('--play-center', Math.round(W / 2) + 'px');
        // Reposition the 3D shell. Wide displays get full viewport width; tall displays keep the old letterboxed rect.
        const gs = document.getElementById('gameShell');
        if (gs) {
          gs.style.left   = isWide ? '0px' : ox + 'px';
          gs.style.top    = isWide ? '0px' : oy + 'px';
          gs.style.width  = isWide ? W + 'px' : gw + 'px';
          gs.style.height = isWide ? H + 'px' : gh + 'px';
        }
      }

      // Run immediately so Three.js renderer gets correct initial dimensions
      fitToAspect();

      function auditInventorySizing() {
        const panel = document.getElementById('menuPanel');
        const inv = document.getElementById('mpInventory');
        const gridArea = document.querySelector('.inv-grid-area');
        const info = document.getElementById('invInfo');
        if (!panel || !inv || !gridArea || !info) return;
        const pr = panel.getBoundingClientRect();
        const gr = gridArea.getBoundingClientRect();
        const ir = info.getBoundingClientRect();
        const leakX = Math.max(0, gr.right - pr.right, ir.right - pr.right, pr.left - gr.left, pr.left - ir.left);
        const leakY = Math.max(0, gr.bottom - pr.bottom, ir.bottom - pr.bottom, pr.top - gr.top, pr.top - ir.top);
        debugLog(`inventory sizing audit: panel ${Math.round(pr.width)}x${Math.round(pr.height)} grid ${Math.round(gr.width)}x${Math.round(gr.height)} info ${Math.round(ir.width)}x${Math.round(ir.height)} leak ${Math.round(leakX)}x${Math.round(leakY)}`);
      }

      debugLog('main game script started');

      // ── Menu open/close ────────────────────────────────────
      let menuOpen = false;
      function openMenu(targetPanel = 'inventory') {
        menuOpen = true;
        menuBtn.classList.add('open');
        menuBtn.setAttribute('aria-expanded', 'true');
        menuBackdrop.classList.add('open');
        menuPanel.classList.add('open');
        paused = true;
        switchMenuPanel(targetPanel);
        buildInventoryGrid();
        if (targetPanel === 'shipping') buildShippingTransferUI();
        if (targetPanel === 'supplies') renderSupplyPage();
        auditInventorySizing();
      }
      function closeMenu() {
        menuOpen = false;
        menuBtn.classList.remove('open');
        menuBtn.setAttribute('aria-expanded', 'false');
        menuBackdrop.classList.remove('open');
        menuPanel.classList.remove('open');
        paused = false;
      }
      menuBtn.addEventListener('click', () => menuOpen ? closeMenu() : openMenu());
      menuBackdrop.addEventListener('click', closeMenu);

      // ── New panel tab switching ────────────────────────────

      function switchMenuPanel(id) {
        document.querySelectorAll('.mp-tab').forEach(t =>
          t.classList.toggle('active', t.dataset.mpanel === id));
        document.querySelectorAll('.mp-pane').forEach(p =>
          p.classList.toggle('active',
            p.id === 'mp' + id.charAt(0).toUpperCase() + id.slice(1)));
        if (id === 'inventory') buildInventoryGrid();
        if (id === 'shipping') buildShippingTransferUI();
        if (id === 'supplies') renderSupplyPage();
      }

      document.querySelectorAll('.mp-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          const id = tab.dataset.mpanel;
          switchMenuPanel(id);
        });
      });
      // Close button
      const mpClose = document.getElementById('mpClose');
      if (mpClose) mpClose.addEventListener('click', closeMenu);
      // Inventory category filter
      document.querySelectorAll('.inv-cat').forEach(btn => {
        btn.addEventListener('click', () => {
          invActiveCat = btn.dataset.cat;
          document.querySelectorAll('.inv-cat').forEach(b =>
            b.classList.toggle('active', b.dataset.cat === invActiveCat));
          buildInventoryGrid();
        });
      });


      document.querySelectorAll('.ship-cat').forEach(btn => {
        btn.addEventListener('click', () => {
          const side = btn.dataset.side;
          if (side === 'left') shippingActiveCat.left = btn.dataset.cat;
          if (side === 'right') shippingActiveCat.right = btn.dataset.cat;
          document.querySelectorAll(`.ship-cat[data-side="${side}"]`).forEach(b =>
            b.classList.toggle('active', b.dataset.cat === (side === 'left' ? shippingActiveCat.left : shippingActiveCat.right)));
          buildShippingTransferUI();
        });
      });
      const shipCloseBtn = document.getElementById('shipCloseBtn');
      if (shipCloseBtn) shipCloseBtn.addEventListener('click', closeMenu);
      const shipAmtMinus = document.getElementById('shipAmtMinus');
      const shipAmtPlus  = document.getElementById('shipAmtPlus');
      if (shipAmtMinus) shipAmtMinus.addEventListener('click', () => bumpShippingAmount(-1));
      if (shipAmtPlus)  shipAmtPlus.addEventListener('click',  () => bumpShippingAmount(1));
      const shipTransferOne = document.getElementById('shipTransferOne');
      const shipTransferHalf = document.getElementById('shipTransferHalf');
      const shipTransferStack = document.getElementById('shipTransferStack');
      if (shipTransferOne) shipTransferOne.addEventListener('click', () => transferShippingAmount(1));
      if (shipTransferHalf) shipTransferHalf.addEventListener('click', () => transferShippingAmount('half'));
      if (shipTransferStack) shipTransferStack.addEventListener('click', () => transferShippingAmount('stack'));

      // ── Legend + old legend toggle removed — handled by menu now
      // ── Toast ──────────────────────────────────────────────
      let _toastTimer = null;
      function showToast(msg, ok = true) {
        toastEl.textContent = msg;
        toastEl.className = 'show ' + (ok ? 'ok' : 'fail');
        clearTimeout(_toastTimer);
        _toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2800);
      }

      // ── Tile / crop enums (must come first — referenced by everything below) ──
      const TileType = Object.freeze({
        GRASS: 'grass', WEEDS: 'weeds', TILLED: 'tilled',
        TRENCH: 'trench', RAISED: 'raised', PADDY: 'paddy',
        ROCK: 'rock', SHRUB: 'shrub'
      });

      const CropType = Object.freeze({
        NONE: '',
        NEEDLEGRAIN: 'needlegrain', HEFTROOT: 'heftroot', GARLINK: 'garlink', ONGYUMS: 'ongyums',
        REDBERRIES: 'redberries', BLUEBERRIES: 'blueberries', YELLOWBERRIES: 'yellowberries',
        WHITEBERRIES: 'whiteberries', BLACKBERRIES: 'blackberries',
        BLACK_MUSTARD: 'blackMustard', GREEN_MUSTARD: 'greenMustard'
      });

      // ── World / physics constants ──
      const COLS = 36;
      const ROWS = 26;
      const TILE = 55;          // birds-eye tile size in px
      const PLAYER_RADIUS = 15;
      const MOVE_SPEED    = 238;  // px/s world units; used by updateMovement() target velocity.
      const ACCEL         = 980;  // px/s²; used by updateMovement() for snappier starts.
      const TURN_ACCEL    = 1320; // px/s²; used when input reverses or sharply turns.
      const DECEL         = 1850; // px/s²; used by updateMovement() to avoid floaty stops.
      const CARDINAL_BIAS = 0.18; // used by updateMovement(); lower keeps diagonals less sticky.
      const JOYSTICK_RADIUS = 56; // Fallback radius; updateJoystick() scales to the current viewport-anchored joystick size.
      const JOYSTICK_DEADZONE = 0.14; // used by updateJoystick() to prevent thumb drift near center.
      const JOYSTICK_RESPONSE = 0.82; // used by updateJoystick() to make small thumb motion feel responsive.
      const ACTION_FX_LIMIT = 90; // used by spawnActionParticles()/updateActionParticles() to cap mobile effects.
      const FLOW_SOURCE_ROW = 0;
      const DAY_LENGTH_SECONDS = 72;
      const MORNING_HOUR = 6;
      const NIGHT_HOUR   = 22;
      const SEASON_LENGTH_DAYS = 8;

      // ── Highland House — adjust these to fit the GLB and position it on the farm ──
      // Values sourced from Footprint_Highlandhouse_medium.json (footprint mapper v3)
      const HOUSE_SCALE       = 1.854;  // uniform GLB scale from mapper
      const HOUSE_ROTATION_Y  = 0;     // no rotation needed per mapper
      const HOUSE_POS_X       = 27.741; // mapper translate.x (-1.259) + editor→game offset (29)
      const HOUSE_POS_Y       = 0.915;  // mapper translate.y (ground lift)
      const HOUSE_POS_Z       = 3.662;  // mapper translate.z (-0.338) + editor→game offset (4)
      const HOUSE_COL         = 26;     // top-left column of house footprint on farm grid
      const HOUSE_ROW         = 2;      // top-left row of house footprint on farm grid
      const HOUSE_FOOTPRINT_W = 5;      // footprint width in tiles (cells x=9..13, 5 wide)
      const HOUSE_FOOTPRINT_D = 4;      // footprint depth in tiles (cells y=10..13, 4 deep)
      const DOOR_COL          = 28;     // farm grid col of door zone (mapper cell 11,14 → col 28)
      const DOOR_ROW          = 6;      // farm grid row of door zone (mapper cell 11,14 → row 6)
      // Interior dimensions from playerhouse_interior.json (house_interior_mapper.v1)
      // Layout: 6×5 main room (cols 0-5, rows 0-4) + 2-cell south corridor (cols 2-3, row 5)
      const INTERIOR_COLS        = 6;
      const INTERIOR_ROWS        = 6;
      const INTERIOR_ENTRY_COL   = 2;    // player spawns here when entering (left corridor col)
      const INTERIOR_ENTRY_ROW   = 4;    // just inside the main room, north of the corridor
      const INTERIOR_EXIT_COL    = 2;    // leftmost col of south exit corridor
      const INTERIOR_EXIT_ROW    = 5;    // row of south exit corridor
      const INTERIOR_WALL_HEIGHT = 1.75; // wall height in world units (30% shorter than original 2.5)

      // ── Voxel render constants ──
      // Each tile is drawn as a top-down oblique voxel stack.
      // VSKEW: how many px the top-face shifts up per Z unit (isometric feel)
      // VSLICE: height of each Z-slab in screen pixels
      const VSKEW  = 8;   // px upward shift per +1 Z (raised) / downward per -1 Z (trench)
      const VSLICE = 5;   // px height of one Z level's side face

      // ── Water simulation constants ──
      // Water is a float depth (0..MAX_WATER) sitting above the tile floor.
      // Floor Z: RAISED=+1, GRASS/TILLED/PADDY/WEEDS=0, TRENCH=-1, ROCK/SHRUB=solid(no water)
      // Water surface = floorZ + water depth.
      const MAX_WATER    = 3.0;  // max depth in "units"
      const RAIN_RATE    = 0.018; // depth added per sim tick during rain (×rainStrength)
      const ABSORB_RATE  = {     // depth drained per tick by soil absorption
        [TileType.GRASS]:  0.012,  // doubled — grass roots drink efficiently
        [TileType.WEEDS]:  0.008,
        [TileType.TILLED]: 0.018,  // broken soil drains fastest (no root binding)
        [TileType.RAISED]: 0.025,  // elevated — gravity-drains quickly
        [TileType.PADDY]:  0.003,  // sealed low bowl, retains water
        [TileType.TRENCH]: 0.000,  // sealed clay — no absorption, only flow
        [TileType.ROCK]:   0,
        [TileType.SHRUB]:  0,
      };
      const EVAP_RATE    = 0.002;  // evapotranspiration — drains all tiles slowly even when dry
      const FLOW_RATE         = 0.45;  // fraction of head difference transferred per tick
      const TRENCH_FLOW_BONUS = 3.0;   // trenches pull water from neighbours faster

      // ── Game data ──
      const seasons = [
        { name: 'Early Dry',   emoji: '☀️',  rainChance: 0.04, stormChance: 0.00 },
        { name: 'Late Dry',    emoji: '🌞',  rainChance: 0.08, stormChance: 0.01 },
        { name: 'First Rains', emoji: '🌦️', rainChance: 0.42, stormChance: 0.06 },
        { name: 'Wet Peak',    emoji: '⛈️', rainChance: 0.66, stormChance: 0.18 },
      ];

      const cropData = {
        needlegrain:   { emoji: '🌾', seedKey: 'needlegrainSeeds',   cropKey: 'needlegrain',   growDays: 3, idealMin: 0.20, idealMax: 0.50, label: 'needlegrain',   tags: ['Grain', 'Dry-default crop'] },
        heftroot:      { emoji: '🟡', seedKey: 'heftrootSeeds',      cropKey: 'heftroot',      growDays: 4, idealMin: 0.25, idealMax: 0.55, label: 'heftroot',      tags: ['Root', 'Starch'] },
        garlink:       { emoji: '🧄', seedKey: 'garlinkSeeds',       cropKey: 'garlink',       growDays: 3, idealMin: 0.15, idealMax: 0.45, label: 'garlink',       tags: ['Pungent', 'Broth base'] },
        ongyums:       { emoji: '🧅', seedKey: 'ongyumsSeeds',       cropKey: 'ongyums',       growDays: 3, idealMin: 0.35, idealMax: 0.70, label: 'ongyums',       tags: ['Aromatic', 'Broth base'] },
        redberries:    { emoji: '🍓', seedKey: 'redberrySeeds',      cropKey: 'redberries',    growDays: 4, idealMin: 0.35, idealMax: 0.70, label: 'redberries',    needsAdjacentDitch: true, tags: ['Berry', 'Ditch-loving'] },
        blueberries:   { emoji: '🫐', seedKey: 'blueberrySeeds',     cropKey: 'blueberries',   growDays: 4, idealMin: 0.50, idealMax: 0.85, label: 'blueberries',   needsAdjacentDitch: true, tags: ['Berry', 'Wet-loving'] },
        yellowberries: { emoji: '🟡', seedKey: 'yellowberrySeeds',   cropKey: 'yellowberries', growDays: 4, idealMin: 0.25, idealMax: 0.60, label: 'yellowberries', needsAdjacentDitch: true, tags: ['Berry', 'Ditch-loving'] },
        whiteberries:  { emoji: '⚪', seedKey: 'whiteberrySeeds',    cropKey: 'whiteberries',  growDays: 4, idealMin: 0.40, idealMax: 0.75, label: 'whiteberries',  needsAdjacentDitch: true, tags: ['Berry', 'Ditch-loving'] },
        blackberries:  { emoji: '⚫', seedKey: 'blackberrySeeds',    cropKey: 'blackberries',  growDays: 4, idealMin: 0.45, idealMax: 0.80, label: 'blackberries',  needsAdjacentDitch: true, tags: ['Berry', 'Ditch-loving'] },
        blackMustard:  { emoji: '⚫', seedKey: 'blackMustardSeed',   cropKey: 'blackMustard',  growDays: 3, idealMin: 0.15, idealMax: 0.40, label: 'black mustard', tags: ['Mustard', 'Hot'] },
        greenMustard:  { emoji: '🥬', seedKey: 'greenMustardSeed',   cropKey: 'greenMustard',  growDays: 3, idealMin: 0.30, idealMax: 0.65, label: 'green mustard', tags: ['Mustard', 'Fresh'] },
      };

      const toolActions = {
        shovel:  ['dig', 'raise', 'fill'],
        hoe:     ['till', 'smooth'],
        machete: ['cut', 'slash'],
      };

      const actionLabels = {
        dig:        ['⛏️', 'Dig'],
        fill:       ['🟫', 'Fill'],
        raise:      ['🟨', 'Raise'],
        lower:      ['🕳️', 'Lower'],
        till:       ['🟫', 'Till'],
        smooth:     ['🍃', 'Smooth'],
        cut:        ['🗡️', 'Cut'],
        slash:      ['💥', 'Slash'],
        harvest:    ['🧺', 'Harvest'],
      };

      const tileStyles = {
        grass:  { topColor: '#5ea75a', sideColor: '#3d7a3a', label: 'grass'    },
        weeds:  { topColor: '#247c3c', sideColor: '#1a5a2a', label: 'weeds'    },
        tilled: { topColor: '#8a5b34', sideColor: '#5e3e22', label: 'tilled'   },
        trench: { topColor: '#3a2510', sideColor: '#1e1206', label: 'trench'   },
        raised: { topColor: '#c39a55', sideColor: '#8a6a30', label: 'raised'   },
        paddy:  { topColor: '#6aa263', sideColor: '#458040', label: 'paddy'    },
        rock:   { topColor: '#79807c', sideColor: '#50554f', label: 'rock'     },
        shrub:  { topColor: '#356e36', sideColor: '#204d20', label: 'shrub'    },
      };

      // Helper: floor Z for a tile type
      function floorZ(type) {
        if (type === TileType.RAISED) return  1;
        if (type === TileType.TRENCH) return -1;
        return 0;  // ROCK, SHRUB, and all normal tiles sit at Z=0
      }
      // Whether a tile blocks water entirely (solid column)
      function isSolid(type) {
        return type === TileType.ROCK || type === TileType.SHRUB;
      }

      // Used by updateMovement() and drawPlayer(); rotation is free, reticle remains grid snapped.
      const player = {
        x: COLS * TILE * 0.5,
        y: ROWS * TILE * 0.72,
        angle: -Math.PI / 2,
        vx: 0, vy: 0,
        emoji: '🧑‍🌾'
      };

      // Used by input polling; supports both keyboard and touch joystick.
      const input = {
        x: 0,
        y: 0,
        keys: new Set(),
        joystickPointerId: null
      };

      // Used by calendarHud and water simulation to turn rain into an automatic timed condition.
      const calendar = {
        day: 17,           // Day 1 of "First Rains" season (season index 2 = days 17–24)
        time01: 0.30,      // ~10:30 AM — mid-morning, well into a rain window
        weather: 'rain',
        isRaining: true,
        rainStrength: 2,
        nextRainWindows: [{ start: 8, end: 14, strength: 2 }]
      };

      // Used by inventoryHud and planting/harvesting actions.
      // Only real starting stacks are listed; generic empty boxes are drawn by buildInventoryGrid().
      const STARTING_INVENTORY = {
        needlegrainSeeds: 6, heftrootSeeds: 4, garlinkSeeds: 4, ongyumsSeeds: 4,
        redberrySeeds: 3, blueberrySeeds: 3, yellowberrySeeds: 3, whiteberrySeeds: 2, blackberrySeeds: 2,
        blackMustardSeed: 3, greenMustardSeed: 3,
        uumkaoiiCrate: 1,
        gold: 40,
      };

      // Used by inventoryHud and planting/harvesting actions.
      const inventory = { ...STARTING_INVENTORY };

      // World object system handles sell+supply (see below)

      // ═══════════════════════════════════════════════════════════════
      //  WORLD OBJECTS
      //  Each object has a tile position, a Three.js mesh, a label,
      //  and a getButtons(reticle) → [{icon,label,action,style,allowed}]
      //  method. When the reticle overlaps an object, its buttons are
      //  appended to the action stack. Actions prefixed 'obj_' are
      //  routed to the object's onAction(action) handler.
      //
      //  Objects placed at startup (placeable ones coming later):
      //    • Sell Crate  (col=2, row=ROWS-3) — orange crate
      //    • Supply Box  (col=4, row=ROWS-3) — blue crate
      // ═══════════════════════════════════════════════════════════════

      const BASE_PRICES = {
        needlegrain: 8, heftroot: 11, garlink: 7, ongyums: 7,
        redberries: 12, blueberries: 13, yellowberries: 12, whiteberries: 14, blackberries: 14,
        blackMustard: 10, greenMustard: 9,
        mulch: 2
      };

      const PROCESSING_FURNITURE_DEFS = {
        pestle: {
          itemKey: 'pestleFurniture', icon: '🥣', name: 'Pestle Station', method: 'mashing', color: 0x9a6a3a,
          desc: 'Placeable processor for mashing: berries into jam, mustard seed into paste, and starchy crops into mash.'
        },
        squeezer: {
          itemKey: 'squeezerFurniture', icon: '🧃', name: 'Hand Squeezer', method: 'squeezing', color: 0x4f9eb8,
          desc: 'Placeable processor for squeezing: berries into juice now; dews, milk-like liquids, and nut oils later.'
        },
        handMill: {
          itemKey: 'handMillFurniture', icon: '⚙️', name: 'Hand Mill', method: 'grinding', color: 0x8f8a78,
          desc: 'Placeable processor for grinding: needlegrain/heftroot into flour and mustard seed into powder.'
        },
        dryingRack: {
          itemKey: 'dryingRackFurniture', icon: '☀️', name: 'Drying Rack', method: 'drying', color: 0xcaa45e,
          desc: 'Placeable processor for drying wet/fresh ingredients. Dry-default grain/root crops are intentionally not dryable.'
        },
        smoker: {
          itemKey: 'smokerFurniture', icon: '💨', name: 'Smoking Hut', method: 'smoking', color: 0x5c5147,
          desc: 'Placeable processor for smoking meat, fish, and mollusks once those ingredient loops exist in the farm demo.'
        },
        agingBarrel: {
          itemKey: 'agingBarrelFurniture', icon: '🛢️', name: 'Aging Barrel', method: 'barrelAging', color: 0x7a4924,
          desc: 'Placeable processor for barrel-aging juice into wine and dew/honey-like inputs into mead later.'
        },
        agingVase: {
          itemKey: 'agingVaseFurniture', icon: '🏺', name: 'Aging Vase', method: 'vaseAging', color: 0xa76b47,
          desc: 'Placeable processor for vase-aging milk or curds into cheese once animal products are active.'
        },
      };

      const PROCESSING_FURNITURE_CATALOG = Object.values(PROCESSING_FURNITURE_DEFS).map(def => ({
        key: def.itemKey,
        icon: def.icon,
        name: def.name,
        desc: def.desc,
        price: ({ pestle: 18, squeezer: 22, handMill: 28, dryingRack: 18, smoker: 35, agingBarrel: 42, agingVase: 38 }[Object.keys(PROCESSING_FURNITURE_DEFS).find(k => PROCESSING_FURNITURE_DEFS[k] === def)] || 25),
        gives: { [def.itemKey]: 1 },
        category: 'furniture'
      }));

      const LIVESTOCK_CATALOG = [
        { key: 'puktuk',   icon: '🐐', name: 'Puktuk',   desc: 'Coming soon: meat, milk, and wool livestock.', price: 120, comingSoon: true },
        { key: 'nelk',     icon: '🐔', name: 'Nelk',     desc: 'Coming soon: meat, eggs, and mayonnaise chain.', price: 90,  comingSoon: true },
        { key: 'uumkaoiiCrate', icon: '🦆', name: 'Uumkao’ii Crate', desc: 'A travel crate with one uumkao’ii inside. Select it in your bag and release it on any open tile.', price: 150, gives: { uumkaoiiCrate: 1 }, category: 'livestock' },
        { key: 'nazgraku', icon: '🦃', name: 'Nazgraku', desc: 'Coming soon: meat, eggs, and combat-leaning produce.', price: 160, comingSoon: true },
        { key: 'drenkirra', icon: '🪿', name: 'Drenkirra', desc: 'Coming soon: meat, eggs, and agile produce.', price: 140, comingSoon: true },
        { key: 'grehlr',   icon: '🦨', name: 'Grehlr',   desc: 'Coming soon: meat and denatured stink oil.', price: 130, comingSoon: true },
        { key: 'voorgAss', icon: '🫏', name: 'Voorg-Ass', desc: 'Coming soon: meat and white milk.', price: 135, comingSoon: true },
      ];

      const SUPPLY_CATALOG = [
        { key: 'needlegrainSeeds',   icon: '🌾', name: 'Needlegrain Seeds',   desc: 'Dry-default grain. Ideal water 20–50%.', price: 5, gives: { needlegrainSeeds: 3 } },
        { key: 'heftrootSeeds',      icon: '🟡', name: 'Heftroot Seeds',      desc: 'Starchy root crop. Ideal water 25–55%.', price: 6, gives: { heftrootSeeds: 3 } },
        { key: 'garlinkSeeds',       icon: '🧄', name: 'Garlink Seeds',       desc: 'Pungent broth-base crop. Ideal water 15–45%.', price: 4, gives: { garlinkSeeds: 3 } },
        { key: 'ongyumsSeeds',       icon: '🧅', name: 'Ongyums Seeds',       desc: 'Aromatic crop. Ideal water 35–70%.', price: 4, gives: { ongyumsSeeds: 3 } },
        { key: 'redberrySeeds',      icon: '🍓', name: 'Redberry Seeds',      desc: 'Berry crop; grows best beside ditches. Ideal water 35–70%.', price: 7, gives: { redberrySeeds: 2 } },
        { key: 'blueberrySeeds',     icon: '🫐', name: 'Blueberry Seeds',     desc: 'Wet-loving berry; grows best beside ditches. Ideal water 50–85%.', price: 8, gives: { blueberrySeeds: 2 } },
        { key: 'yellowberrySeeds',   icon: '🟡', name: 'Yellowberry Seeds',   desc: 'Berry crop; grows best beside ditches. Ideal water 25–60%.', price: 7, gives: { yellowberrySeeds: 2 } },
        { key: 'whiteberrySeeds',    icon: '⚪', name: 'Whiteberry Seeds',    desc: 'Mild berry crop; grows best beside ditches. Ideal water 40–75%.', price: 8, gives: { whiteberrySeeds: 2 } },
        { key: 'blackberrySeeds',    icon: '⚫', name: 'Blackberry Seeds',    desc: 'Dark berry crop; grows best beside ditches. Ideal water 45–80%.', price: 8, gives: { blackberrySeeds: 2 } },
        { key: 'blackMustardSeed',   icon: '⚫', name: 'Black Mustard Seed',  desc: 'Hot mustard crop. Ideal water 15–40%.', price: 6, gives: { blackMustardSeed: 2 } },
        { key: 'greenMustardSeed',   icon: '🥬', name: 'Green Mustard Seed',  desc: 'Fresh mustard crop. Ideal water 30–65%.', price: 6, gives: { greenMustardSeed: 2 } },
        { key: 'mulchBag',           icon: '🍂', name: 'Mulch Bag',           desc: 'Boosts soil recovery and gives clearing material.', price: 3, gives: { mulch: 5 } },
        ...PROCESSING_FURNITURE_CATALOG,
        ...LIVESTOCK_CATALOG
      ];

      // Pending orders: [{catalogKey, qty, arrivalDay, name}]
      let pendingOrders  = [];
      let deliveryLog    = [];
      const SELL_INTERVAL_HOURS = 4;  // sell crate empties every N game-hours

      // worldObjects: Map<"col,row", object>
      const worldObjects = new Map();
      let shippingBoxObject = null; // Used by the Shipping menu pane to read/write the active sell crate contents.
      let supplyBoxObject = null; // Used by the Supplies menu pane to read/write supply order quantities.
      const processingFurnitureObjects = new Set(); // Used by reset and debug to track player-placed processing furniture.
      const animalObjects = new Set(); // Tracks all live animal world objects for update loop and reset.

      // Preload uumkao'ii sprite; animals check this before spawning.
      let uumkaoiiSpriteImage = null;
      { const _img = new Image(); _img.onload = () => { uumkaoiiSpriteImage = _img; }; _img.src = "assets/creaturesprites/uumkao'ii.png"; }

      // ── Sell Crate ────────────────────────────────────────────────
      function makeSellCrate(col, row) {
        const bin = Object.fromEntries(Object.keys(BASE_PRICES).map(key => [key, 0]));
        let lastSellHour = getHour();

        const mat  = new THREE.MeshLambertMaterial({ color: 0xe06820 });
        const geo  = new THREE.BoxGeometry(0.7, 0.55, 0.7);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = true;
        mesh.position.set(col + 0.5, tileSurfaceY(TileType.GRASS) + 0.28, row + 0.5);
        scene.add(mesh);

        // Lid — slightly lighter, floats above when contents > 0
        const lidMat  = new THREE.MeshLambertMaterial({ color: 0xf08830 });
        const lidGeo  = new THREE.BoxGeometry(0.72, 0.08, 0.72);
        const lid     = new THREE.Mesh(lidGeo, lidMat);
        lid.castShadow = true;
        scene.add(lid);

        function totalItems() {
          return Object.values(bin).reduce((s, v) => s + v, 0);
        }
        function contentsStr() {
          const parts = Object.entries(bin)
            .filter(([,v]) => v > 0)
            .map(([k,v]) => (itemIconForKey(k) + '×' + v));
          return parts.length ? parts.join(' ') : 'Empty';
        }

        return {
          id: 'sell_crate', type: 'sell_crate', col, row, mesh, lid, contentsStr,
          label: '🟧 Shipping Box',
          getButtons(reticle) {
            const item = getActiveInventoryItem();
            const btns = [];
            // Deposit button for any sellable item in scroll
            if (item && BASE_PRICES[item.key] !== undefined) {
              const count = inventory[item.key] || 0;
              btns.push({
                icon: item.icon,
                label: count > 0 ? 'Ship ' + item.icon : 'None',
                action: 'obj_deposit',
                style: 'primary',
                allowed: count > 0,
              });
            }
            // Deposit all
            const total = totalItems();
            btns.push({ icon: '📦', label: total > 0 ? 'Open Box' : 'Shipping', action: 'obj_open_shipping', style: total > 0 ? 'secondary' : 'primary', allowed: true });
            return btns;
          },
          onAction(action) {
            if (action === 'obj_deposit') {
              const item = getActiveInventoryItem();
              if (!item || BASE_PRICES[item.key] === undefined) return { ok: false, message: 'Cannot deposit that.' };
              const qty = inventory[item.key] || 0;
              if (qty < 1) return { ok: false, message: 'No ' + item.label + ' to deposit.' };
              inventory[item.key]--;
              clampInventoryStack(item.key);
              bin[item.key] = (bin[item.key] || 0) + 1;
              return { ok: true, message: 'Deposited ' + item.icon + ' into sell crate.' };
            }
            if (action === 'obj_show_bin' || action === 'obj_open_shipping') {
              openMenu('shipping');
              return { ok: true, message: contentsStr() };
            }
            return { ok: false, message: 'Unknown action.' };
          },
          getContents() {
            return bin;
          },
          getTotalItems() {
            return totalItems();
          },
          depositItem(key, qty) {
            if (BASE_PRICES[key] === undefined) return 0;
            const moved = Math.max(0, Math.min(qty, inventory[key] || 0));
            if (moved < 1) return 0;
            inventory[key] -= moved;
            bin[key] = (bin[key] || 0) + moved;
            return moved;
          },
          withdrawItem(key, qty) {
            const moved = Math.max(0, Math.min(qty, bin[key] || 0));
            if (moved < 1) return 0;
            bin[key] -= moved;
            inventory[key] = Math.min(99, (inventory[key] || 0) + moved);
            return moved;
          },
          tick(gameHour) {
            // Sell everything every SELL_INTERVAL_HOURS
            if (gameHour - lastSellHour >= SELL_INTERVAL_HOURS && totalItems() > 0) {
              let earned = 0;
              const parts = [];
              for (const [k, v] of Object.entries(bin)) {
                if (v > 0) {
                  earned += v * (BASE_PRICES[k] || 0);
                  parts.push((itemIconForKey(k) || k) + '×' + v);
                  bin[k] = 0;
                }
              }
              inventory.gold += earned;
              lastSellHour = gameHour;
              const line = 'Day ' + calendar.day + ' — ' + parts.join(' ') + ' = ' + earned + 'g';
              deliveryLog.unshift({ type: 'sale', text: line });
              if (deliveryLog.length > 12) deliveryLog.pop();
              showToast('🟧 Sold! +' + earned + 'g', true);
              if (menuOpen) { buildInventoryGrid(); buildShippingTransferUI(); }
            }
            // Animate lid
            const h = tileSurfaceY(TileType.GRASS) + 0.56 + (totalItems() > 0 ? 0.06 : 0);
            lid.position.set(col + 0.5, h, row + 0.5);
          },
          reset() {
            Object.keys(bin).forEach(k => { bin[k] = 0; });
            lastSellHour = MORNING_HOUR;
          },
        };
      }

      // ── Supply Box ────────────────────────────────────────────────
      function makeSupplyBox(col, row) {
        const mat  = new THREE.MeshLambertMaterial({ color: 0x2060c0 });
        const geo  = new THREE.BoxGeometry(0.7, 0.55, 0.7);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = true;
        mesh.position.set(col + 0.5, tileSurfaceY(TileType.GRASS) + 0.28, row + 0.5);
        scene.add(mesh);

        const lidMat = new THREE.MeshLambertMaterial({ color: 0x4080e0 });
        const lid    = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.08, 0.72), lidMat);
        lid.position.set(col + 0.5, tileSurfaceY(TileType.GRASS) + 0.56, row + 0.5);
        scene.add(lid);

        // qty selections per catalog item
        const qtys = {};
        SUPPLY_CATALOG.forEach(it => { qtys[it.key] = 0; });

        return {
          id: 'supply_box', type: 'supply_box', col, row, mesh, lid,
          label: '📦 Supply Box',
          getButtons() {
            return [
              { icon: '📦', label: 'Order', action: 'obj_open_shop', style: 'primary', allowed: true },
            ];
          },
          onAction(action) {
            if (action === 'obj_open_shop') {
              openMenu('supplies');
              return { ok: true, message: 'Opened supply ordering.' };
            }
            if (action.startsWith('obj_buy_')) {
              const key = action.slice(8);
              const item = SUPPLY_CATALOG.find(it => it.key === key);
              if (!item) return { ok: false, message: 'Unknown item.' };
              if (item.comingSoon) return { ok: false, message: item.name + ' purchases are coming soon.' };
              const qty = qtys[key] || 0;
              if (qty < 1) return { ok: false, message: 'Select a quantity first.' };
              const cost = item.price * qty;
              if (inventory.gold < cost) return { ok: false, message: 'Not enough gold. Need ' + cost + 'g.' };
              inventory.gold -= cost;
              pendingOrders.push({ key, qty, arrivalDay: calendar.day + 1, item });
              qtys[key] = 0;
              return { ok: true, message: 'Ordered ' + qty + '× ' + item.name + ' for ' + cost + 'g. Arrives tomorrow.' };
            }
            return { ok: false, message: 'Unknown action.' };
          },
          getQtys() { return qtys; },
          reset() { Object.keys(qtys).forEach(k => { qtys[k] = 0; }); },
        };
      }

      // ── Food processing furniture ───────────────────────────────────
      function getFurnitureDefByItemKey(itemKey) {
        return Object.values(PROCESSING_FURNITURE_DEFS).find(def => def.itemKey === itemKey) || null;
      }

      function getFurnitureKeyByItemKey(itemKey) {
        const entry = Object.entries(PROCESSING_FURNITURE_DEFS).find(([, def]) => def.itemKey === itemKey);
        return entry ? entry[0] : null;
      }

      function canPlaceFurnitureAt(col, row) {
        const tile = grid[row]?.[col];
        if (!tile || getWorldObjectAt(col, row)) return false;
        if (tile.crop || tile.type === TileType.ROCK || tile.type === TileType.SHRUB || tile.type === TileType.WEEDS || tile.type === TileType.TRENCH) return false;
        return true;
      }

      function makeProcessingFurniture(col, row, furnitureKey) {
        const def = PROCESSING_FURNITURE_DEFS[furnitureKey];
        if (!def) return null;
        const mat = new THREE.MeshLambertMaterial({ color: def.color });
        const geo = new THREE.BoxGeometry(0.68, 0.46, 0.68);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = true;
        mesh.position.set(col + 0.5, tileSurfaceY(grid[row][col].type) + 0.23, row + 0.5);
        scene.add(mesh);

        const topMat = new THREE.MeshLambertMaterial({ color: 0xf0d8a0 });
        const top = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.08, 0.44), topMat);
        top.castShadow = true;
        top.position.set(col + 0.5, tileSurfaceY(grid[row][col].type) + 0.50, row + 0.5);
        scene.add(top);

        return {
          id: 'processor_' + furnitureKey + '_' + col + '_' + row,
          type: 'processing_furniture', furnitureKey, method: def.method, col, row, mesh, top,
          label: def.icon + ' ' + def.name,
          getButtons() {
            const active = getActiveInventoryItem();
            const output = active ? getProcessingOutput(def.method, active.key) : null;
            return [{
              icon: output ? def.icon : '…',
              label: output ? processButtonLabel(def.method, active.key, output) : methodIdleLabel(def.method),
              action: 'obj_process_' + furnitureKey,
              style: output ? 'primary' : 'secondary',
              allowed: Boolean(output && (inventory[active.key] || 0) > 0),
            }];
          },
          onAction(action) {
            if (action !== 'obj_process_' + furnitureKey) return { ok: false, message: 'Unknown processor action.' };
            const active = getActiveInventoryItem();
            if (!active) return { ok: false, message: def.name + ' needs an ingredient selected.' };
            const output = getProcessingOutput(def.method, active.key);
            if (!output) return { ok: false, message: def.name + ' cannot process ' + (ITEM_DEFS[active.key]?.label || active.label) + '.' };
            if ((inventory[active.key] || 0) < 1) return { ok: false, message: 'No ' + (ITEM_DEFS[active.key]?.label || active.label) + ' left.' };
            ensureProcessedItemDef(output);
            inventory[active.key]--;
            clampInventoryStack(active.key);
            inventory[output.key] = Math.min(99, (inventory[output.key] || 0) + 1);
            return { ok: true, message: def.icon + ' Processed 1 ' + (ITEM_DEFS[active.key]?.label || active.label) + ' into ' + output.label + '.' };
          },
          reset() {
            scene.remove(mesh);
            scene.remove(top);
            mesh.geometry.dispose(); mesh.material.dispose();
            top.geometry.dispose(); top.material.dispose();
          },
        };
      }

      function placeProcessingFurniture(col, row, furnitureKey) {
        const def = PROCESSING_FURNITURE_DEFS[furnitureKey];
        if (!def) return { ok: false, message: 'Unknown furniture.' };
        if (!canPlaceFurnitureAt(col, row)) return { ok: false, message: 'Place furniture on an empty grass, tilled, or raised tile.' };
        if ((inventory[def.itemKey] || 0) < 1) return { ok: false, message: 'No ' + def.name + ' in your bag.' };
        const obj = makeProcessingFurniture(col, row, furnitureKey);
        if (!obj) return { ok: false, message: 'Could not make furniture object.' };
        inventory[def.itemKey]--;
        clampInventoryStack(def.itemKey);
        worldObjects.set(col + ',' + row, obj);
        processingFurnitureObjects.add(obj);
        return { ok: true, message: 'Placed ' + def.icon + ' ' + def.name + '.' };
      }

      function clearPlacedProcessingFurniture() {
        processingFurnitureObjects.forEach(obj => {
          worldObjects.delete(obj.col + ',' + obj.row);
          obj.reset && obj.reset();
        });
        processingFurnitureObjects.clear();
      }

      // ── Animal system ─────────────────────────────────────────────
      function canSpawnAnimalAt(col, row) {
        const tile = grid[row]?.[col];
        if (!tile || getWorldObjectAt(col, row)) return false;
        if (tile.crop || isSolid(tile.type) || tile.type === TileType.TRENCH) return false;
        return true;
      }

      function makeUumkaoiiAnimal(col, row) {
        const ANIMAL_W = 1.275;
        const ANIMAL_H = ANIMAL_W * (451 / 641); // sprite is 641x451 px
        const halfH = ANIMAL_H / 2;
        const CREATURE_PERPS = [0, Math.PI];

        const avatarRef = window.PNGPlaneAvatar.buildAnimalPlaneAvatarModel(THREE, "assets/creaturesprites/uumkao'ii.png", {
          modelWidth: ANIMAL_W, modelHeight: ANIMAL_H,
          name: 'uumkaoii_' + col + '_' + row,
        });

        const initSurfY = tileSurfaceY(grid[row][col].type);
        avatarRef.group.position.set(col + 0.5, initSurfY + halfH, row + 0.5);
        avatarRef.group.rotation.y = Math.PI / 2; // start facing east
        scene.add(avatarRef.group);

        let tickCounter = 0;
        const animal = {
          id: 'uumkaoii_' + col + '_' + row + '_' + (performance.now() | 0),
          type: 'animal', animalKey: 'uumkaoii',
          col, row, targetCol: col, targetRow: row,
          wx: col + 0.5, wz: row + 0.5, wy: initSurfY + halfH,
          halfHeight: halfH, avatarRef,
          groupRot: Math.PI / 2, targetRot: Math.PI / 2,
          perpState: {},

          getButtons() {
            return [{ icon: '\u{1F986}', label: "Uumkao’ii", action: 'obj_uumkaoii_' + this.id, style: 'secondary', allowed: false }];
          },
          onAction() {
            return { ok: false, message: "The uumkao’ii ignores you." };
          },
          tick() {
            tickCounter++;
            if (tickCounter % 3 !== 0) return;
            if (Math.random() > 0.55) return;

            const dirs = [{ dc: 1, dr: 0 }, { dc: -1, dr: 0 }, { dc: 0, dr: 1 }, { dc: 0, dr: -1 }];
            for (let i = dirs.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
            }
            for (const d of dirs) {
              const nc = this.col + d.dc, nr = this.row + d.dr;
              if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue;
              if (!canSpawnAnimalAt(nc, nr)) continue;
              worldObjects.delete(this.col + ',' + this.row);
              this.col = nc; this.row = nr;
              this.targetCol = nc; this.targetRow = nr;
              worldObjects.set(nc + ',' + nr, this);
              this.targetRot = -Math.atan2(d.dr, d.dc) + Math.PI / 2;
              break;
            }
          },
          update(dt) {
            const tx = this.targetCol + 0.5, tz = this.targetRow + 0.5;
            const tile = grid[this.targetRow]?.[this.targetCol];
            const ty = tile ? tileSurfaceY(tile.type) + this.halfHeight : this.wy;
            const sp = Math.min(1, dt * 4);
            this.wx += (tx - this.wx) * sp;
            this.wz += (tz - this.wz) * sp;
            this.wy += (ty - this.wy) * sp;
            this.wy += Math.sin(performance.now() / 420 + this.targetCol * 1.3) * 0.006;
            this.avatarRef.group.position.set(this.wx, this.wy, this.wz);

            const { effectiveTarget, snapTo } = perpClamp(this.perpState, this.targetRot, CREATURE_PERPS);
            if (snapTo !== null) this.groupRot = effectiveTarget;
            else this.groupRot += angleDiff(effectiveTarget, this.groupRot) * 0.18;
            this.avatarRef.group.rotation.y = this.groupRot;
          },
          reset() {
            scene.remove(avatarRef.group);
            avatarRef.dispose();
          },
        };
        return animal;
      }

      function spawnUumkaoii(col, row) {
        if (!canSpawnAnimalAt(col, row)) return { ok: false, message: 'The uumkao\'ii can\'t be released here.' };
        if ((inventory.uumkaoiiCrate || 0) < 1) return { ok: false, message: 'No Uumkao\'ii Crate in bag.' };
        const animal = makeUumkaoiiAnimal(col, row);
        if (!animal) return { ok: false, message: 'Sprite still loading — try again in a moment.' };
        inventory.uumkaoiiCrate--;
        clampInventoryStack('uumkaoiiCrate');
        worldObjects.set(col + ',' + row, animal);
        animalObjects.add(animal);
        return { ok: true, message: "🦆 Uumkao'ii released!" };
      }

      function clearAnimalObjects() {
        animalObjects.forEach(obj => {
          worldObjects.delete(obj.col + ',' + obj.row);
          obj.reset && obj.reset();
        });
        animalObjects.clear();
      }

      function updateAnimalMeshes(dt) {
        for (const animal of animalObjects) animal.update(dt);
      }

      function processButtonLabel(methodId, inputKey, output) {
        const methodVerb = ({ mashing: 'Mash', squeezing: 'Squeeze', grinding: 'Grind', drying: 'Dry', smoking: 'Smoke', barrelAging: 'Age', vaseAging: 'Age' })[methodId] || 'Process';
        return methodVerb + ' → ' + output.icon;
      }

      function methodIdleLabel(methodId) {
        return ({
          mashing: 'Needs mashable item', squeezing: 'Needs squeezable item', grinding: 'Needs grindable item',
          drying: 'Needs wet/fresh item', smoking: 'Needs meat/fish', barrelAging: 'Needs juice/dew', vaseAging: 'Needs milk/curd'
        })[methodId] || 'Needs ingredient';
      }

      function isBerryKey(key) {
        return ['redberries', 'blueberries', 'yellowberries', 'whiteberries', 'blackberries'].includes(key);
      }

      function berryBaseName(key) {
        return ({ redberries: 'Redberry', blueberries: 'Blueberry', yellowberries: 'Yellowberry', whiteberries: 'Whiteberry', blackberries: 'Blackberry' })[key] || (ITEM_DEFS[key]?.label || key);
      }

      function getProcessingOutput(methodId, inputKey) {
        const input = ITEM_DEFS[inputKey];
        if (!input) return null;
        if (methodId === 'squeezing' && isBerryKey(inputKey)) {
          const base = berryBaseName(inputKey);
          return { key: inputKey + 'Juice', icon: '🧃', label: base + ' Juice', cat: 'processed', sellPrice: Math.max(4, (input.sellPrice || 4) + 5), tags: ['Processed', 'Juice', 'Fruit'], desc: 'Sweet liquid squeezed from ' + input.label.toLowerCase() + '.' };
        }
        if (methodId === 'mashing' && isBerryKey(inputKey)) {
          const base = berryBaseName(inputKey);
          return { key: inputKey + 'Jam', icon: input.icon, label: base + ' Jam', cat: 'processed', sellPrice: Math.max(5, (input.sellPrice || 4) + 7), tags: ['Processed', 'Jam', 'Sweet Paste'], desc: 'Thick berry preserve made at a pestle station.' };
        }
        if (methodId === 'mashing' && inputKey === 'blackMustardSeed') return { key: 'blackMustardPaste', icon: '🟤', label: 'Black Mustard Paste', cat: 'processed', sellPrice: 13, tags: ['Processed', 'Pungent Paste', 'Spice'], desc: 'Hot pungent paste made from black mustard seed.' };
        if (methodId === 'mashing' && inputKey === 'greenMustardSeed') return { key: 'greenMustardPaste', icon: '🟢', label: 'Green Mustard Paste', cat: 'processed', sellPrice: 12, tags: ['Processed', 'Pungent Paste', 'Spice'], desc: 'Fresh pungent paste made from green mustard seed.' };
        if (methodId === 'mashing' && ['heftroot', 'garlink', 'ongyums', 'blackMustard', 'greenMustard'].includes(inputKey)) return { key: inputKey + 'Mash', icon: '🥣', label: 'Mashed ' + input.label, cat: 'processed', sellPrice: Math.max(3, (input.sellPrice || 3) + 3), tags: ['Processed', 'Mash'], desc: 'Mashed crop base for future cooking recipes.' };
        if (methodId === 'grinding' && inputKey === 'needlegrain') return { key: 'needlegrainFlour', icon: '🌾', label: 'Needlegrain Flour', cat: 'processed', sellPrice: 12, tags: ['Processed', 'Flour', 'Grain'], desc: 'Ground needlegrain flour for noodles and bread.' };
        if (methodId === 'grinding' && inputKey === 'heftroot') return { key: 'heftrootFlour', icon: '🟡', label: 'Heftroot Flour', cat: 'processed', sellPrice: 15, tags: ['Processed', 'Flour', 'Starch'], desc: 'Ground heftroot flour for yellow noodles and bread.' };
        if (methodId === 'grinding' && inputKey === 'blackMustardSeed') return { key: 'blackMustardPowder', icon: '⚫', label: 'Black Mustard Powder', cat: 'processed', sellPrice: 11, tags: ['Processed', 'Powder', 'Spice'], desc: 'Ground black mustard powder.' };
        if (methodId === 'grinding' && inputKey === 'greenMustardSeed') return { key: 'greenMustardPowder', icon: '🥬', label: 'Green Mustard Powder', cat: 'processed', sellPrice: 10, tags: ['Processed', 'Powder', 'Spice'], desc: 'Ground green mustard powder.' };
        if (methodId === 'drying' && isBerryKey(inputKey)) return { key: inputKey + 'Dried', icon: input.icon, label: 'Dried ' + input.label, cat: 'processed', sellPrice: Math.max(4, (input.sellPrice || 4) + 4), tags: ['Processed', 'Dried', 'Fruit'], desc: 'Dried berries. Dry-default crops are not valid drying inputs.' };
        if (methodId === 'barrelAging' && /Juice$/.test(inputKey)) return { key: inputKey.replace(/Juice$/, 'Wine'), icon: '🍷', label: input.label.replace(/ Juice$/, ' Wine'), cat: 'processed', sellPrice: Math.max(10, (input.sellPrice || 10) + 12), tags: ['Processed', 'Wine', 'Aged'], desc: 'Barrel-aged fruit wine.' };
        return null;
      }

      function ensureProcessedItemDef(output) {
        if (ITEM_DEFS[output.key]) return;
        ITEM_DEFS[output.key] = {
          icon: output.icon,
          label: output.label,
          cat: output.cat || 'processed',
          sellPrice: output.sellPrice || 1,
          tags: output.tags || ['Processed'],
          desc: output.desc || 'Processed food item.'
        };
      }

      // ── Register world objects ─────────────────────────────────────
      function initWorldObjects() {
        const sc = makeSellCrate(2, ROWS - 3);
        const sb = makeSupplyBox(4, ROWS - 3);
        shippingBoxObject = sc;
        supplyBoxObject = sb;
        worldObjects.set(sc.col + ',' + sc.row, sc);
        worldObjects.set(sb.col + ',' + sb.row, sb);
        // Highland House door object
        const hh = makeHighlandHouse();
        worldObjects.set(hh.col + ',' + hh.row, hh);
      }

      // ── Highland House world object + GLB loader ─────────────────
      function makeHighlandHouse() {
        // Load the GLB asynchronously; show fallback box until it arrives
        const loader = new THREE.GLTFLoader();
        const footprintCenterX = HOUSE_COL + HOUSE_FOOTPRINT_W / 2;
        const footprintCenterZ = HOUSE_ROW + HOUSE_FOOTPRINT_D / 2;

        // Fallback box shown while GLB loads
        const fallbackMat  = new THREE.MeshLambertMaterial({ color: 0x7a5030 });
        const fallbackGeo  = new THREE.BoxGeometry(HOUSE_FOOTPRINT_W * 0.9, 2.0, HOUSE_FOOTPRINT_D * 0.9);
        const fallbackMesh = new THREE.Mesh(fallbackGeo, fallbackMat);
        fallbackMesh.position.set(footprintCenterX, 1.0, footprintCenterZ);
        fallbackMesh.castShadow = true;
        scene.add(fallbackMesh);

        loader.load(
          'assets/models/HighlandHouse_medium.glb',
          (gltf) => {
            scene.remove(fallbackMesh);
            fallbackGeo.dispose(); fallbackMat.dispose();
            const model = gltf.scene;
            model.scale.setScalar(HOUSE_SCALE);
            model.rotation.y = HOUSE_ROTATION_Y;
            model.position.set(HOUSE_POS_X, HOUSE_POS_Y, HOUSE_POS_Z);
            model.traverse(m => {
              if (m.isMesh) {
                m.castShadow    = true;
                m.receiveShadow = true;
                m.layers.enable(1); // shell outline
              }
            });
            scene.add(model);
            debugLog('Highland House GLB loaded');
          },
          undefined,
          (err) => { debugLog('Highland House GLB load error: ' + err); }
        );

        return {
          id: 'highland_house', type: 'highland_house',
          col: DOOR_COL, row: DOOR_ROW,
          label: '🏠 Highland House',
          getButtons() {
            return [{ icon: '🚪', label: 'Enter', action: 'obj_enter_house', style: 'primary', allowed: true }];
          },
          onAction(action) {
            if (action === 'obj_enter_house') {
              startSceneTransition(() => enterInterior());
              return { ok: true, message: 'Entering the Highland House…' };
            }
            return { ok: false, message: 'Unknown house action.' };
          },
        };
      }

      // ── Scene transition fade ─────────────────────────────────────
      function startSceneTransition(callback) {
        sceneTransAlpha = 0;
        sceneTransDir   = 1;
        sceneTransCb    = callback;
      }

      function updateSceneTransition(dt) {
        if (sceneTransDir === 0) return;
        if (sceneTransDir === 1) {
          sceneTransAlpha = Math.min(1, sceneTransAlpha + dt * 4);
          if (sceneTransAlpha >= 1 && sceneTransCb) {
            sceneTransCb();
            sceneTransCb  = null;
            sceneTransDir = -1;
          }
        } else {
          sceneTransAlpha = Math.max(0, sceneTransAlpha - dt * 2.5);
          if (sceneTransAlpha <= 0) sceneTransDir = 0;
        }
      }

      // ── Enter / exit the interior ─────────────────────────────────
      function enterInterior() {
        buildInteriorScene();  // no-op after first call
        farmPlayerSave = { x: player.x, y: player.y, angle: player.angle };
        currentArea    = 'interior';
        player.x       = (INTERIOR_ENTRY_COL + 0.5) * TILE;
        player.y       = (INTERIOR_ENTRY_ROW + 0.5) * TILE;
        player.vx      = 0;  player.vy = 0;
        facingAngle    = Math.PI / 2;   // face south (into the room)
        player.angle   = facingAngle;
        camTargetX     = player.x / TILE;
        camTargetZ     = player.y / TILE;
        // Move player mesh into interior scene
        scene.remove(playerMesh);
        scene.remove(toolHolder);
        scene.remove(reticleMesh);
        interiorScene.add(playerMesh);
        refreshActionBar();
      }

      function exitInterior() {
        if (currentArea !== 'interior') return;
        startSceneTransition(() => {
          currentArea = 'farm';
          if (farmPlayerSave) {
            player.x     = farmPlayerSave.x;
            player.y     = farmPlayerSave.y;
            player.angle = farmPlayerSave.angle;
            facingAngle  = farmPlayerSave.angle;
          }
          player.vx  = 0;  player.vy = 0;
          camTargetX = player.x / TILE;
          camTargetZ = player.y / TILE;
          // Move player mesh back to farm scene
          interiorScene.remove(playerMesh);
          scene.add(playerMesh);
          scene.add(toolHolder);
          scene.add(reticleMesh);
          refreshActionBar();
        });
      }

      function getWorldObjectAt(col, row) {
        return worldObjects.get(col + ',' + row) || null;
      }

      function worldObjectMorningTick() {
        // Deliver pending orders
        const today = calendar.day;
        const arriving = pendingOrders.filter(o => o.arrivalDay <= today);
        pendingOrders   = pendingOrders.filter(o => o.arrivalDay >  today);
        for (const o of arriving) {
          const item = o.item;
          Object.entries(item.gives).forEach(([k, v]) => {
            inventory[k] = Math.min(99, (inventory[k] || 0) + v * o.qty);
          });
          const line = 'Day ' + today + ' — ' + o.qty + '× ' + item.name + ' delivered';
          deliveryLog.unshift({ type: 'delivery', text: line });
          showToast('📦 ' + o.qty + '× ' + item.name + ' delivered!', true);
        }
        deliveryLog = deliveryLog.slice(0, 12);
        if (menuOpen) renderSupplyPage();
        // Tick sell crate clock
        worldObjects.forEach(o => o.tick && o.tick(getHour()));
      }

      function tickWorldObjects() {
        worldObjects.forEach(o => o.tick && o.tick(getHour()));
      }

      let supplyActiveCategory = 'seeds'; // Used by renderSupplyPage() to keep the longer catalog readable on mobile.

      function getSupplyItemCategory(item) {
        // Used by the supply ordering pane; avoids hard-coding future catalog rows into the UI.
        if (item.category) return item.category;
        if (item.comingSoon) return 'livestock';
        if (/Seed$|Seeds$/.test(item.key) || item.key === 'mulchBag') return 'seeds';
        return 'all';
      }

      function getSupplyCategoryLabel(category) {
        return ({ all: 'All', seeds: 'Seeds', furniture: 'Furniture', livestock: 'Livestock' })[category] || 'Supply';
      }

      function bindSupplyTabs() {
        document.querySelectorAll('.supply-tab').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.supplyCat === supplyActiveCategory);
          btn.onclick = () => {
            supplyActiveCategory = btn.dataset.supplyCat || 'seeds';
            renderSupplyPage();
          };
        });
      }

      function renderSupplyPage() {
        bindSupplyTabs();
        const sectionTitle = document.getElementById('supplySectionTitle');
        if (sectionTitle) sectionTitle.textContent = 'Supply Shop — ' + getSupplyCategoryLabel(supplyActiveCategory);
        const list = document.getElementById('supplyShopList');
        const deliveries = document.getElementById('supplyDeliveryList');
        const goldEl = document.getElementById('supplyGoldDisplay');
        if (goldEl) goldEl.innerHTML = `${inventory.gold || 0}<span class="wallet-unit">g</span>`;
        if (!list) return;
        const qtys = supplyBoxObject && supplyBoxObject.getQtys ? supplyBoxObject.getQtys() : {};
        list.innerHTML = '';
        const visibleSupplyItems = SUPPLY_CATALOG.filter(item => supplyActiveCategory === 'all' || getSupplyItemCategory(item) === supplyActiveCategory);
        visibleSupplyItems.forEach(item => {
          const qty = qtys[item.key] || 0;
          const row = document.createElement('div');
          row.className = 'shop-row' + (item.comingSoon ? ' coming-soon' : '');
          row.innerHTML = `
            <div class="sh-icon">${item.icon}</div>
            <div class="sh-info">
              <div class="sh-name">${item.name}</div>
              <div class="sh-desc">${item.desc}</div>
              <div class="sh-price">${item.comingSoon ? 'Livestock system not active yet' : item.price + 'g per order'}</div>
            </div>
            <div class="shop-qty-ctrl">
              <button class="shop-qty-btn" data-act="minus" ${item.comingSoon ? 'disabled' : ''}>−</button>
              <span class="shop-qty-val">${item.comingSoon ? '—' : qty}</span>
              <button class="shop-qty-btn" data-act="plus" ${item.comingSoon ? 'disabled' : ''}>+</button>
            </div>
            <button class="shop-buy-btn" data-act="buy" ${item.comingSoon ? 'disabled' : ''}>${item.comingSoon ? 'Soon' : 'Order'}</button>
          `;
          row.querySelector('[data-act="minus"]')?.addEventListener('click', () => {
            qtys[item.key] = Math.max(0, (qtys[item.key] || 0) - 1);
            renderSupplyPage();
          });
          row.querySelector('[data-act="plus"]')?.addEventListener('click', () => {
            qtys[item.key] = Math.min(99, (qtys[item.key] || 0) + 1);
            renderSupplyPage();
          });
          row.querySelector('[data-act="buy"]')?.addEventListener('click', () => {
            const result = supplyBoxObject ? supplyBoxObject.onAction('obj_buy_' + item.key) : { ok: false, message: 'No supply box linked.' };
            showToast(result.message, result.ok !== false);
            renderSupplyPage();
            buildInventoryGrid();
          });
          list.appendChild(row);
        });
        if (visibleSupplyItems.length === 0) {
          list.innerHTML = '<div class="delivery-row"><span class="dr-icon">📭</span><span class="dr-name">No entries in this supply category yet.</span><span class="dr-eta">—</span></div>';
        }
        if (deliveries) {
          if (pendingOrders.length === 0 && deliveryLog.length === 0) {
            deliveries.innerHTML = '<div class="delivery-row"><span class="dr-icon">📭</span><span class="dr-name">No pending deliveries or recent sales.</span><span class="dr-eta">—</span></div>';
          } else {
            const pending = pendingOrders.map(order => `<div class="delivery-row"><span class="dr-icon">${order.item.icon}</span><span class="dr-name">${order.qty}× ${order.item.name}</span><span class="dr-eta">Day ${order.arrivalDay}</span></div>`).join('');
            const history = deliveryLog.map(line => `<div class="delivery-row received"><span class="dr-icon">${line.type === 'sale' ? '🟧' : '📦'}</span><span class="dr-name">${line.text}</span><span class="dr-eta">Done</span></div>`).join('');
            deliveries.innerHTML = pending + history;
          }
        }
      }

      // ── Market page render ─────────────────────────────────────────
      function renderMarketPage() { /* market UI removed — sell from Inventory panel */ }

            // Item scroll — ordered list of scrollable inventory slots
      const inventoryItems = [
        { key: 'needlegrainSeeds',   icon: '🌾', label: 'NEEDLEGRAIN SEEDS', max: 99, seedFor: 'needlegrain' },
        { key: 'heftrootSeeds',      icon: '🟡', label: 'HEFTROOT SEEDS',    max: 99, seedFor: 'heftroot' },
        { key: 'garlinkSeeds',       icon: '🧄', label: 'GARLINK SEEDS',     max: 99, seedFor: 'garlink' },
        { key: 'ongyumsSeeds',       icon: '🧅', label: 'ONGYUMS SEEDS',     max: 99, seedFor: 'ongyums' },
        { key: 'redberrySeeds',      icon: '🍓', label: 'REDBERRY SEEDS',    max: 99, seedFor: 'redberries' },
        { key: 'blueberrySeeds',     icon: '🫐', label: 'BLUEBERRY SEEDS',   max: 99, seedFor: 'blueberries' },
        { key: 'yellowberrySeeds',   icon: '🟡', label: 'YELLOWBERRY SEEDS', max: 99, seedFor: 'yellowberries' },
        { key: 'whiteberrySeeds',    icon: '⚪', label: 'WHITEBERRY SEEDS',  max: 99, seedFor: 'whiteberries' },
        { key: 'blackberrySeeds',    icon: '⚫', label: 'BLACKBERRY SEEDS',  max: 99, seedFor: 'blackberries' },
        { key: 'blackMustardSeed',   icon: '⚫', label: 'BLACK MUSTARD SEED', max: 99, seedFor: 'blackMustard' },
        { key: 'greenMustardSeed',   icon: '🥬', label: 'GREEN MUSTARD SEED', max: 99, seedFor: 'greenMustard' },
        { key: 'needlegrain',        icon: '🌾', label: 'NEEDLEGRAIN',       max: 99 },
        { key: 'heftroot',           icon: '🟡', label: 'HEFTROOT',          max: 99 },
        { key: 'garlink',            icon: '🧄', label: 'GARLINK',           max: 99 },
        { key: 'ongyums',            icon: '🧅', label: 'ONGYUMS',           max: 99 },
        { key: 'redberries',         icon: '🍓', label: 'REDBERRIES',        max: 99 },
        { key: 'blueberries',        icon: '🫐', label: 'BLUEBERRIES',       max: 99 },
        { key: 'yellowberries',      icon: '🟡', label: 'YELLOWBERRIES',     max: 99 },
        { key: 'whiteberries',       icon: '⚪', label: 'WHITEBERRIES',      max: 99 },
        { key: 'blackberries',       icon: '⚫', label: 'BLACKBERRIES',      max: 99 },
        { key: 'blackMustard',       icon: '⚫', label: 'BLACK MUSTARD',     max: 99 },
        { key: 'greenMustard',       icon: '🥬', label: 'GREEN MUSTARD',     max: 99 },
        { key: 'mulch',              icon: '🍂', label: 'MULCH',            max: 99 },
        { key: 'uumkaoiiCrate',      icon: '🦆', label: 'UUMKAO\'II CRATE',  max: 9  },
      ];

      // ── Item definitions for Inventory panel ──────────────────────
      const ITEM_DEFS = {
        needlegrainSeeds: { icon: '🌾', label: 'Needlegrain Seeds', cat: 'seed', sellPrice: 0, tags: ['Seed', 'Plantable'], desc: 'Plants needlegrain. Dry-default grain crop; ideal water 20–50%.' },
        heftrootSeeds: { icon: '🟡', label: 'Heftroot Seeds', cat: 'seed', sellPrice: 0, tags: ['Seed', 'Plantable'], desc: 'Plants heftroot. Starchy root crop; ideal water 25–55%.' },
        garlinkSeeds: { icon: '🧄', label: 'Garlink Seeds', cat: 'seed', sellPrice: 0, tags: ['Seed', 'Plantable'], desc: 'Plants garlink. Pungent broth-base crop; ideal water 15–45%.' },
        ongyumsSeeds: { icon: '🧅', label: 'Ongyums Seeds', cat: 'seed', sellPrice: 0, tags: ['Seed', 'Plantable'], desc: 'Plants ongyums. Aromatic crop; ideal water 35–70%.' },
        redberrySeeds: { icon: '🍓', label: 'Redberry Seeds', cat: 'seed', sellPrice: 0, tags: ['Seed', 'Berry'], desc: 'Plants redberries. Berries grow best when any adjacent tile is a ditch; ideal water 35–70%.' },
        blueberrySeeds: { icon: '🫐', label: 'Blueberry Seeds', cat: 'seed', sellPrice: 0, tags: ['Seed', 'Berry'], desc: 'Plants blueberries. Berries grow best when any adjacent tile is a ditch; ideal water 50–85%.' },
        yellowberrySeeds: { icon: '🟡', label: 'Yellowberry Seeds', cat: 'seed', sellPrice: 0, tags: ['Seed', 'Berry'], desc: 'Plants yellowberries. Berries grow best when any adjacent tile is a ditch; ideal water 25–60%.' },
        whiteberrySeeds: { icon: '⚪', label: 'Whiteberry Seeds', cat: 'seed', sellPrice: 0, tags: ['Seed', 'Berry'], desc: 'Plants whiteberries. Berries grow best when any adjacent tile is a ditch; ideal water 40–75%.' },
        blackberrySeeds: { icon: '⚫', label: 'Blackberry Seeds', cat: 'seed', sellPrice: 0, tags: ['Seed', 'Berry'], desc: 'Plants blackberries. Berries grow best when any adjacent tile is a ditch; ideal water 45–80%.' },
        blackMustardSeed: { icon: '⚫', label: 'Black Mustard Seed', cat: 'seed', sellPrice: 0, tags: ['Seed', 'Mustard'], desc: 'Plants black mustard. Hot mustard crop; ideal water 15–40%.' },
        greenMustardSeed: { icon: '🥬', label: 'Green Mustard Seed', cat: 'seed', sellPrice: 0, tags: ['Seed', 'Mustard'], desc: 'Plants green mustard. Fresh mustard crop; ideal water 30–65%.' },
        needlegrain: { icon: '🌾', label: 'Needlegrain', cat: 'crop', sellPrice: 8, tags: ['Crop', 'Sellable', 'Grain'], desc: 'Dry-default grain crop from the cooking system.' },
        heftroot: { icon: '🟡', label: 'Heftroot', cat: 'crop', sellPrice: 11, tags: ['Crop', 'Sellable', 'Root'], desc: 'Starchy root crop used for heftroot flour and yellow noodles.' },
        garlink: { icon: '🧄', label: 'Garlink', cat: 'crop', sellPrice: 7, tags: ['Crop', 'Sellable', 'Pungent'], desc: 'Pungent vegetable and broth base.' },
        ongyums: { icon: '🧅', label: 'Ongyums', cat: 'crop', sellPrice: 7, tags: ['Crop', 'Sellable', 'Aromatic'], desc: 'Aromatic vegetable and broth base.' },
        redberries: { icon: '🍓', label: 'Redberries', cat: 'crop', sellPrice: 12, tags: ['Crop', 'Sellable', 'Berry'], desc: 'Berry crop. Grows well beside adjacent ditches.' },
        blueberries: { icon: '🫐', label: 'Blueberries', cat: 'crop', sellPrice: 13, tags: ['Crop', 'Sellable', 'Berry'], desc: 'Wet-loving berry crop. Grows well beside adjacent ditches.' },
        yellowberries: { icon: '🟡', label: 'Yellowberries', cat: 'crop', sellPrice: 12, tags: ['Crop', 'Sellable', 'Berry'], desc: 'Berry crop. Grows well beside adjacent ditches.' },
        whiteberries: { icon: '⚪', label: 'Whiteberries', cat: 'crop', sellPrice: 14, tags: ['Crop', 'Sellable', 'Berry'], desc: 'Mild berry crop. Grows well beside adjacent ditches.' },
        blackberries: { icon: '⚫', label: 'Blackberries', cat: 'crop', sellPrice: 14, tags: ['Crop', 'Sellable', 'Berry'], desc: 'Dark berry crop. Grows well beside adjacent ditches.' },
        blackMustard: { icon: '⚫', label: 'Black Mustard', cat: 'crop', sellPrice: 10, tags: ['Crop', 'Sellable', 'Mustard'], desc: 'Hot mustard crop. Can be processed into pungent paste later.' },
        greenMustard: { icon: '🥬', label: 'Green Mustard', cat: 'crop', sellPrice: 9, tags: ['Crop', 'Sellable', 'Mustard'], desc: 'Fresh mustard crop. Can be processed into pungent paste later.' },
        mulch: { icon: '🍂', label: 'Mulch', cat: 'material', sellPrice: 2, tags: ['Material', 'Organic'], desc: 'Organic matter from cleared vegetation. Useful by-product of land clearing.' },
        uumkaoiiCrate: { icon: '🦆', label: 'Uumkao\'ii Crate', cat: 'livestock', sellPrice: 0, tags: ['Livestock', 'Crate'], desc: 'Select this in your bag and use it while targeting an open tile to release the uumkao\'ii.' },
      };

      Object.values(PROCESSING_FURNITURE_DEFS).forEach(def => {
        // Used by inventory rendering and item scroll after furniture orders are delivered.
        if (!inventoryItems.some(item => item.key === def.itemKey)) {
          inventoryItems.push({ key: def.itemKey, icon: def.icon, label: def.name.toUpperCase(), max: 99 });
        }
        if (!ITEM_DEFS[def.itemKey]) {
          ITEM_DEFS[def.itemKey] = {
            icon: def.icon,
            label: def.name,
            cat: 'furniture',
            sellPrice: 0,
            tags: ['Furniture', 'Placeable', def.method],
            desc: def.desc
          };
        }
      });

      function itemIconForKey(key) {
        return ITEM_DEFS[key]?.icon || SUPPLY_CATALOG.find(item => item.key === key)?.icon || '□';
      }

      // ── Inventory panel state ──────────────────────────────────────
      let invSelectedKey = null;
      let invActiveCat   = 'all';
      const INVENTORY_EMPTY_SLOT_FLOOR = 42; // Used by buildInventoryGrid() so the bag reads as open generic storage.

      function getKnownItemRank(key) {
        const idx = inventoryItems.findIndex(item => item.key === key);
        return idx === -1 ? 9999 : idx;
      }

      function getInventoryStackKeys(cat = 'all') {
        // Used by inventory grid, item scroll, and shipping left panel to avoid preassigned item slots.
        return Object.keys(inventory)
          .filter(key => key !== 'gold' && ITEM_DEFS[key] && (inventory[key] || 0) > 0)
          .filter(key => cat === 'all' || ITEM_DEFS[key].cat === cat)
          .sort((a, b) => getKnownItemRank(a) - getKnownItemRank(b) || ITEM_DEFS[a].label.localeCompare(ITEM_DEFS[b].label));
      }

      function getInventoryStackItems() {
        // Used by the active item scroll; only stacks the player actually owns are selectable.
        return getInventoryStackKeys('all').map(key => inventoryItems.find(item => item.key === key) || {
          key,
          icon: ITEM_DEFS[key].icon,
          label: ITEM_DEFS[key].label.toUpperCase(),
          max: 99,
        });
      }

      function getActiveInventoryItem() {
        // Used by planting, shipping-box quick deposit, HUD, and item scroll.
        const stacks = getInventoryStackItems();
        if (stacks.length === 0) { activeItemIndex = 0; return null; }
        if (activeItemIndex >= stacks.length) activeItemIndex = 0;
        if (activeItemIndex < 0) activeItemIndex = stacks.length - 1;
        return stacks[activeItemIndex];
      }

      function cycleActiveInventoryItem(delta) {
        const stacks = getInventoryStackItems();
        if (stacks.length === 0) { activeItemIndex = 0; return null; }
        activeItemIndex = (activeItemIndex + delta + stacks.length) % stacks.length;
        return stacks[activeItemIndex];
      }

      function clampInventoryStack(key) {
        // Used after transfers/sales so zero-count stacks stop occupying item boxes.
        if (key && key !== 'gold' && inventory[key] !== undefined && inventory[key] <= 0) delete inventory[key];
      }

      let shippingSelected = { side: 'left', key: null }; // Used by the Shipping pane transfer controls.
      let shippingAmount = 1; // Used by the Shipping pane stepper and transfer buttons.
      const shippingActiveCat = { left: 'all', right: 'all' }; // Used by the Shipping pane category filters.

      function getShippingBoxContents() {
        return shippingBoxObject && shippingBoxObject.getContents ? shippingBoxObject.getContents() : {};
      }

      function getShippingKeys(side) {
        const source = side === 'right' ? getShippingBoxContents() : inventory;
        return Object.keys(ITEM_DEFS).filter(key => {
          const def = ITEM_DEFS[key];
          const cat = shippingActiveCat[side];
          if (cat !== 'all' && def.cat !== cat) return false;
          return (source[key] || 0) > 0;
        });
      }

      function getShippingCount(side, key) {
        return side === 'right' ? (getShippingBoxContents()[key] || 0) : (inventory[key] || 0);
      }

      function canShipKey(key) {
        return BASE_PRICES[key] !== undefined;
      }

      function selectShippingItem(side, key) {
        shippingSelected = { side, key };
        shippingAmount = Math.max(1, Math.min(shippingAmount, getShippingCount(side, key) || 1));
        buildShippingTransferUI();
      }

      function bumpShippingAmount(delta) {
        const key = shippingSelected.key;
        if (!key) return;
        const max = Math.max(1, getShippingCount(shippingSelected.side, key));
        shippingAmount = Math.max(1, Math.min(max, shippingAmount + delta));
        buildShippingTransferUI();
      }

      function transferShippingAmount(mode) {
        const key = shippingSelected.key;
        if (!key || !shippingBoxObject) return;
        const count = getShippingCount(shippingSelected.side, key);
        if (count < 1) return;
        let qty = shippingAmount;
        if (mode === 'half') qty = Math.max(1, Math.floor(count / 2));
        if (mode === 'stack') qty = count;
        qty = Math.max(1, Math.min(qty, count));

        let moved = 0;
        if (shippingSelected.side === 'left') {
          if (!canShipKey(key)) { showToast('That item cannot be shipped.', false); return; }
          moved = shippingBoxObject.depositItem(key, qty);
          if (moved > 0) showToast(`📦 Shipped ${moved}× ${ITEM_DEFS[key].label}`, true);
        } else {
          moved = shippingBoxObject.withdrawItem(key, qty);
          if (moved > 0) showToast(`↩ Took back ${moved}× ${ITEM_DEFS[key].label}`, true);
        }
        if (moved < 1) return;
        clampInventoryStack(key);
        const remaining = getShippingCount(shippingSelected.side, key);
        if (remaining < 1) shippingSelected.key = null;
        shippingAmount = 1;
        buildInventoryGrid();
        buildShippingTransferUI();
        refreshItemScroll();
      }

      function renderShippingGrid(side) {
        const grid = document.getElementById(side === 'left' ? 'shipLeftGrid' : 'shipRightGrid');
        if (!grid) return;
        grid.innerHTML = '';
        const keys = getShippingKeys(side);
        keys.forEach(key => {
          const def = ITEM_DEFS[key];
          const count = getShippingCount(side, key);
          const blocked = side === 'left' && !canShipKey(key);
          const slot = document.createElement('button');
          slot.className = 'ship-slot' + (shippingSelected.side === side && shippingSelected.key === key ? ' selected' : '') + (blocked ? ' blocked' : '');
          slot.dataset.side = side;
          slot.dataset.key = key;
          slot.innerHTML = `<span class="ship-slot-icon">${def.icon}</span><span class="ship-slot-count">×${count}</span>${side === 'right' ? '<span class="ship-slot-pending">BOX</span>' : ''}`;
          slot.addEventListener('click', () => selectShippingItem(side, key));
          grid.appendChild(slot);
        });
        if (keys.length === 0) {
          const empty = document.createElement('div');
          empty.className = 'ship-footer';
          empty.textContent = side === 'right' ? 'Shipping box is empty.' : 'No items in this filter.';
          grid.appendChild(empty);
        }
      }

      function buildShippingTransferUI() {
        if (!document.getElementById('mpShipping')) return;
        renderShippingGrid('left');
        renderShippingGrid('right');

        const leftStacks = Object.keys(ITEM_DEFS).filter(k => (inventory[k] || 0) > 0).length;
        const boxTotal = shippingBoxObject && shippingBoxObject.getTotalItems ? shippingBoxObject.getTotalItems() : 0;
        const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
        setText('shipLeftCap', `${leftStacks} stacks`);
        setText('shipRightCap', boxTotal > 0 ? `${boxTotal} queued` : 'Empty');

        const key = shippingSelected.key;
        const def = key ? ITEM_DEFS[key] : null;
        const count = key ? getShippingCount(shippingSelected.side, key) : 0;
        const max = Math.max(1, count);
        shippingAmount = Math.max(1, Math.min(shippingAmount, max));
        const blocked = key && shippingSelected.side === 'left' && !canShipKey(key);
        const direction = !key ? '↔' : (shippingSelected.side === 'left' ? '→ Box' : '← Bag');

        setText('shipPreviewIcon', def ? def.icon : '📦');
        setText('shipPreviewName', def ? `${def.label} ×${count}` : 'Select item');
        setText('shipDirection', blocked ? 'Blocked' : direction);
        setText('shipAmount', String(shippingAmount));
        setText('shipLeftFooter', shippingSelected.side === 'left' && def ? `${def.label} ×${count}` : 'Select a player item.');
        setText('shipRightFooter', shippingSelected.side === 'right' && def ? `${def.label} ×${count}` : 'Select a boxed item to take it back before sale.');
        setText('shipDetailIcon', def ? def.icon : '📦');
        setText('shipDetailName', def ? def.label : 'Shipping Box Transfer');
        setText('shipDetailValue', def && canShipKey(key) ? `${BASE_PRICES[key]}g each` : (def ? 'Not sellable' : '—'));
        setText('shipDetailDesc', def ? `${def.desc}${blocked ? ' This item stays in your bag because the shipping box only accepts sellable goods.' : ''}` : 'Move sellable crops and materials from the player bag into the shipping box. Select items already in the box to pull them back out before the timed sale.');
        const tags = document.getElementById('shipDetailTags');
        if (tags) tags.innerHTML = def ? def.tags.map(t => `<span class="ship-tag">${t}</span>`).join('') : '<span class="ship-tag">Player ↔ Box</span><span class="ship-tag">Instant transfer</span>';

        const hasTransfer = !!key && count > 0 && !blocked;
        ['shipAmtMinus','shipAmtPlus','shipTransferOne','shipTransferHalf','shipTransferStack'].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.disabled = !hasTransfer;
        });
        setText('shipTransferOne', shippingSelected.side === 'left' ? 'Ship 1' : 'Take 1');
        setText('shipTransferHalf', shippingSelected.side === 'left' ? 'Ship Half' : 'Take Half');
        setText('shipTransferStack', shippingSelected.side === 'left' ? 'Ship Stack' : 'Take Stack');
      }

      function clearInventoryDetail(message = '← Select an item') {
        invSelectedKey = null;
        document.querySelectorAll('.inv-item-box').forEach(b => b.classList.remove('selected'));
        const emptyEl  = document.getElementById('iiEmpty');
        const detailEl = document.getElementById('iiDetail');
        if (emptyEl) { emptyEl.style.display = ''; emptyEl.textContent = message; }
        if (detailEl) detailEl.style.display = 'none';
      }

      function buildInventoryGrid() {
        const grid = document.getElementById('invGrid');
        if (!grid) return;
        grid.innerHTML = '';
        const keys = getInventoryStackKeys(invActiveCat);
        const visibleSlotCount = Math.max(INVENTORY_EMPTY_SLOT_FLOOR, Math.ceil(Math.max(keys.length, 1) / 7) * 7);

        keys.forEach(key => {
          const def   = ITEM_DEFS[key];
          const count = inventory[key] || 0;
          const box   = document.createElement('button');
          box.className = 'inv-item-box' + (key === invSelectedKey ? ' selected' : '');
          box.dataset.key = key;
          box.innerHTML =
            `<span class="iib-icon">${def.icon}</span>` +
            `<span class="iib-count">×${count}</span>`;
          box.addEventListener('click', () => selectInventoryItem(key));
          grid.appendChild(box);
        });

        for (let i = keys.length; i < visibleSlotCount; i++) {
          const box = document.createElement('button');
          box.className = 'inv-item-box empty';
          box.type = 'button';
          box.disabled = true;
          box.setAttribute('aria-label', 'Empty inventory slot');
          grid.appendChild(box);
        }

        // Refresh wallet
        const wd = document.getElementById('invWalletDisplay');
        if (wd) wd.textContent = (inventory.gold || 0) + 'g';

        if (invSelectedKey && keys.includes(invSelectedKey)) selectInventoryItem(invSelectedKey, true);
        else clearInventoryDetail(keys.length ? '← Select an item' : 'Bag is empty');
      }

      function selectInventoryItem(key, skipGridUpdate) {
        const def   = ITEM_DEFS[key];
        const count = inventory[key] || 0;
        if (!def || count <= 0) { clearInventoryDetail('← Select an item'); return; }

        if (!skipGridUpdate) {
          invSelectedKey = key;
          document.querySelectorAll('.inv-item-box').forEach(b =>
            b.classList.toggle('selected', b.dataset.key === key));
        }

        const emptyEl  = document.getElementById('iiEmpty');
        const detailEl = document.getElementById('iiDetail');
        if (emptyEl)  emptyEl.style.display  = 'none';
        if (detailEl) detailEl.style.display  = '';

        const set = (id, val) => { const el = document.getElementById(id); if (el) el[typeof val === 'string' ? 'textContent' : 'innerHTML'] = val; };
        set('iiIcon',  def.icon);
        set('iiName',  `${def.label} ×${count}`);
        set('iiPrice', def.sellPrice > 0 ? `${def.sellPrice}g each` : '');
        set('iiTags',  def.tags.map(t => `<span class="ii-tag">${t}</span>`).join(''));
        set('iiDesc',  def.desc);

        const actEl = document.getElementById('iiActions');
        if (actEl) {
          actEl.innerHTML = '';
          function mkBtn(label, cls, fn) {
            const b = document.createElement('button');
            b.className = 'ii-btn' + (cls ? ' ' + cls : '');
            b.textContent = label; b.onclick = fn;
            actEl.appendChild(b);
          }
          if (def.sellPrice > 0 && count > 0) {
            mkBtn(`Sell All  (${count} × ${def.sellPrice}g = ${count * def.sellPrice}g)`, 'sell', () => {
              const earned = (inventory[key] || 0) * def.sellPrice;
              inventory.gold = (inventory.gold || 0) + earned;
              delete inventory[key];
              showToast(`Sold all ${def.label} for ${earned}g`, true);
              if (spGold) spGold.textContent = '💰 ' + inventory.gold + 'g';
              buildInventoryGrid(); refreshItemScroll(); refreshActionBar();
            });
            mkBtn(`Sell 1  (${def.sellPrice}g)`, 'sell', () => {
              if ((inventory[key] || 0) < 1) return;
              inventory[key]--; inventory.gold = (inventory.gold || 0) + def.sellPrice;
              clampInventoryStack(key);
              showToast(`Sold 1 ${def.label} for ${def.sellPrice}g`, true);
              if (spGold) spGold.textContent = '💰 ' + inventory.gold + 'g';
              buildInventoryGrid(); refreshItemScroll(); refreshActionBar();
            });
          }
          mkBtn('Drop  (coming soon)', '', () => showToast('Dropping items — coming soon', false));
        }
      }

      let activeItemIndex = 0;
      let grid = createInitialGrid();

      // ── Area-switching state ───────────────────────────────────────
      let currentArea     = 'farm';   // 'farm' | 'interior'
      let farmPlayerSave  = null;     // {x,y,angle} saved when entering house
      let sceneTransAlpha = 0;        // 0 = fully clear, 1 = fully black
      let sceneTransDir   = 0;        // 0=idle  1=darkening  -1=brightening
      let sceneTransCb    = null;     // fired once at peak darkness

      function getActiveCols() { return currentArea === 'interior' ? INTERIOR_COLS : COLS; }
      function getActiveRows() { return currentArea === 'interior' ? INTERIOR_ROWS : ROWS; }
      function getActiveGrid() { return currentArea === 'interior' ? interiorGrid   : grid; }
      function getActiveTileAt(col, row) {
        const g = getActiveGrid();
        return g[row]?.[col] || { type: TileType.ROCK, water: 0, crop: CropType.NONE, cropAge: 0, cropReady: false, stress: '', variation: 0 };
      }

      // Whether a farm-grid tile falls inside the house footprint
      function isHouseFootprint(col, row) {
        return col >= HOUSE_COL && col < HOUSE_COL + HOUSE_FOOTPRINT_W
            && row >= HOUSE_ROW && row < HOUSE_ROW + HOUSE_FOOTPRINT_D;
      }

      // Interior grid from playerhouse_interior.json floorCells:
      // main room cols 0-5 rows 0-4 + south corridor cols 2-3 row 5
      const interiorGrid = (() => {
        const floor = (c, r) =>
          (r <= 4 && c >= 0 && c <= 5) || (r === 5 && c >= 2 && c <= 3);
        return Array.from({ length: INTERIOR_ROWS }, (_, r) =>
          Array.from({ length: INTERIOR_COLS }, (_, c) => ({
            type: floor(c, r) ? TileType.GRASS : TileType.ROCK,
            water: 0, flow: false, crop: CropType.NONE,
            cropAge: 0, cropReady: false, stress: '', variation: 0,
          }))
        );
      })();

      let activeTool = 'shovel';
      let activeAction = 'dig';
      let lastTime = performance.now();
      let simAccumulator = 0;
      let waterFlowPhase = 0;
      let camX = COLS * TILE * 0.5, camY = ROWS * TILE * 0.72;
      let lastActionMessage = 'First Rains — dig trenches now to route the water.';
      let paused = false;

      // Facing lag: visual/reticle angle lags behind raw movement angle.
      // facingAngle is what the reticle and sprite actually use.
      // cardinalHoldTimer keeps the last cardinal locked briefly after stopping.
      let facingAngle = -Math.PI / 2;   // starts facing north
      const FACING_LERP    = 12;        // higher = snappier rotation (radians/sec effective rate)
      const CARDINAL_HOLD  = 0.13;      // seconds to hold last cardinal after input stops
      let cardinalHoldTimer = 0;
      let lastMoveAngle = -Math.PI / 2;

      // Mouse-look: on desktop, facing tracks the mouse cursor in world space.
      // After MOUSE_IDLE_MS of no mouse movement, reverts to input-direction facing.
      const MOUSE_IDLE_MS  = 1800;  // ms before reverting to input-direction mode
      let mouseLookAngle   = -Math.PI / 2;
      let mouseLookActive  = false;
      let lastMouseMoveTime = 0;
      const _raycaster     = isDesktop ? new THREE.Raycaster() : null;
      const _mouseNDC      = isDesktop ? new THREE.Vector2()   : null;
      const _groundPlane   = isDesktop ? new THREE.Plane(new THREE.Vector3(0,1,0), 0) : null;
      const _mouseWorld    = isDesktop ? new THREE.Vector3()   : null;

      // Water particle system: bubbles / foam on flowing trenches
      const waterParticles = [];
      const MAX_PARTICLES = 120;
      // Ripple rings: { x, y, age, maxAge, radius }
      const ripples = [];
      // Tool-use feedback particles; rendered in drawActionParticles() as screen-space overlays.
      const actionParticles = [];
      // Tool-use tile flashes; rendered in drawActionTileEffects() to identify the affected tile.
      const actionTileEffects = [];
      // Machete slash trails; rendered in drawWeaponTrailEffects() to show the actual cone hit area.
      const weaponTrailEffects = [];
      // Lightning flash state for storms
      let lightningAlpha = 0;

      function createInitialGrid() {
        const nextGrid = Array.from({ length: ROWS }, (_, row) => (
          Array.from({ length: COLS }, (_, col) => createDayOneTile(col, row))
        ));

        // Used to keep day-one from being visually uniform while still beginning mostly wild.
        const rocks  = [[1,1],[10,1],[15,2],[3,7],[13,9],[16,11],[20,2],[28,4],[33,1],[22,8],[30,10],[25,14],[7,18],[18,20],[31,22],[5,24],[14,16],[26,6],[32,18],[8,12]];
        const shrubs = [[6,1],[7,2],[2,4],[14,4],[4,10],[9,11],[19,3],[24,2],[29,7],[21,12],[27,15],[11,19],[23,21],[34,16],[3,22],[16,24],[12,6],[35,9],[17,13],[28,23]];
        rocks.forEach(([col, row]) => { nextGrid[row][col].type = TileType.ROCK; });
        shrubs.forEach(([col, row]) => { nextGrid[row][col].type = TileType.SHRUB; });

        // Used as a tiny player-spawn clearing so movement and the reticle are immediately readable.
        [[8, 9], [9, 9], [8, 10], [9, 10], [10, 10]].forEach(([col, row]) => {
          nextGrid[row][col].type = TileType.GRASS;
          nextGrid[row][col].crop = CropType.NONE;
        });

        chooseWeatherForDay();
        recomputeWater(false, nextGrid);
        return nextGrid;
      }

      function createDayOneTile(col, row) {
        const pattern = (col * 17 + row * 31 + col * row * 7) % 10;
        return {
          type:      pattern < 7 ? TileType.WEEDS : TileType.GRASS,
          water:     0.0,    // depth of water above floor surface (0..MAX_WATER)
          flow:      false,  // true when trench tile has active flow this tick
          crop:      CropType.NONE,
          cropAge:   0,
          cropReady: false,
          stress:    '',
          variation: pattern
        };
      }

      function updateMovement(dt) {
        const keyboardVector = getKeyboardVector();
        const usingKeyboard = keyboardVector.active;
        let ix = usingKeyboard ? keyboardVector.x : input.x;
        let iy = usingKeyboard ? keyboardVector.y : input.y;
        let inputLen = Math.hypot(ix, iy);

        // Keyboard is digital, joystick is analog. Normalize keyboard to full speed,
        // but preserve joystick throw strength so thumb distance controls walk/run.
        let inputStrength = 0;
        if (inputLen > 0.001) {
          inputStrength = usingKeyboard ? 1 : clamp(inputLen, 0, 1);
          ix /= inputLen;
          iy /= inputLen;
        }

        // ── Cardinal bias ────────────────────────────────────
        // Slightly guide near-cardinal movement without crushing diagonals.
        if (inputStrength > 0.001) {
          const ax = Math.abs(ix), ay = Math.abs(iy);
          if (ax > ay && ax > 0.001) {
            iy *= 1 - CARDINAL_BIAS * (ax - ay) / ax;
          } else if (ay > ax && ay > 0.001) {
            ix *= 1 - CARDINAL_BIAS * (ay - ax) / ay;
          }
          const biasedLen = Math.hypot(ix, iy) || 1;
          ix /= biasedLen;
          iy /= biasedLen;
        }

        // ── Tile-speed lookup ─────────────────────────────────
        const rawSpeed = tileSpeedAt(player.x, player.y);
        // If the player ever gets nudged onto an invalid edge/solid sample, keep input alive so they can step back out.
        const speedMul = rawSpeed === null ? 1 : rawSpeed;

        // ── Acceleration / deceleration ──────────────────────
        const analogEase = usingKeyboard ? 1 : (0.28 + 0.72 * inputStrength);
        const targetSpeed = MOVE_SPEED * speedMul * analogEase;
        if (inputStrength > 0.001) {
          const targetVx = ix * targetSpeed;
          const targetVy = iy * targetSpeed;
          const currentSpeed = Math.hypot(player.vx, player.vy);
          const targetDot = currentSpeed > 0.001 ? (player.vx / currentSpeed) * ix + (player.vy / currentSpeed) * iy : 1;
          const accel = targetDot < 0.35 ? TURN_ACCEL : ACCEL;
          const step = accel * dt;
          player.vx += clamp(targetVx - player.vx, -step, step);
          player.vy += clamp(targetVy - player.vy, -step, step);
        } else {
          const speed = Math.hypot(player.vx, player.vy);
          if (speed > 0) {
            const decelStep = DECEL * dt;
            const newSpeed = Math.max(0, speed - decelStep);
            const ratio = newSpeed / speed;
            player.vx *= ratio;
            player.vy *= ratio;
          }
        }

        // ── Axis-separated collision ─────────────────────────
        // Tests the player center plus a tiny radius so corners feel less snaggy.
        const minX = PLAYER_RADIUS;
        const maxX = getActiveCols() * TILE - PLAYER_RADIUS;
        const minY = PLAYER_RADIUS;
        const maxY = getActiveRows() * TILE - PLAYER_RADIUS;
        const desiredX = player.x + player.vx * dt;
        const desiredY = player.y + player.vy * dt;
        const nextX = clamp(desiredX, minX, maxX);
        const nextY = clamp(desiredY, minY, maxY);

        if (canPlayerOccupy(nextX, player.y)) { player.x = nextX; }
        else { player.vx = 0; }
        if (desiredX !== nextX) player.vx = 0;

        if (canPlayerOccupy(player.x, nextY)) { player.y = nextY; }
        else { player.vy = 0; }
        if (desiredY !== nextY) player.vy = 0;

        // ── Facing ────────────────────────────────────────────
        if (isDesktop && mouseLookActive) {
          if (performance.now() - lastMouseMoveTime > MOUSE_IDLE_MS) {
            mouseLookActive = false;
          } else {
            const diff = angleDiff(mouseLookAngle, facingAngle);
            facingAngle += diff * Math.min(1, FACING_LERP * 2.5 * dt);
            player.angle = facingAngle;
            if (inputStrength > 0.001) lastMoveAngle = Math.atan2(iy, ix);
          }
        }

        if (!mouseLookActive || !isDesktop) {
          if (inputStrength > 0.001) {
            lastMoveAngle = Math.atan2(iy, ix);
            cardinalHoldTimer = CARDINAL_HOLD;
            const diff = angleDiff(lastMoveAngle, facingAngle);
            facingAngle += diff * Math.min(1, FACING_LERP * dt);
          } else if (cardinalHoldTimer > 0) {
            cardinalHoldTimer -= dt;
            const card = nearestCardinalAngle(lastMoveAngle);
            const diff = angleDiff(card, facingAngle);
            facingAngle += diff * Math.min(1, FACING_LERP * 2 * dt);
          }
          player.angle = facingAngle;
        }

        // ── Boundary clamp ────────────────────────────────────
        player.x = clamp(player.x, PLAYER_RADIUS, getActiveCols() * TILE - PLAYER_RADIUS);
        player.y = clamp(player.y, PLAYER_RADIUS, getActiveRows() * TILE - PLAYER_RADIUS);
      }

      function canPlayerOccupy(wx, wy) {
        const r  = PLAYER_RADIUS * 0.72;
        const aC = getActiveCols(), aR = getActiveRows();
        if (wx - r < 0 || wy - r < 0 || wx + r >= aC * TILE || wy + r >= aR * TILE) return false;
        return tileSpeedAt(wx - r, wy - r) !== null
            && tileSpeedAt(wx + r, wy - r) !== null
            && tileSpeedAt(wx - r, wy + r) !== null
            && tileSpeedAt(wx + r, wy + r) !== null;
      }

      function getKeyboardVector() {
        let x = 0;
        let y = 0;
        if (input.keys.has('ArrowLeft') || input.keys.has('a')) x -= 1;
        if (input.keys.has('ArrowRight') || input.keys.has('d')) x += 1;
        if (input.keys.has('ArrowUp') || input.keys.has('w')) y -= 1;
        if (input.keys.has('ArrowDown') || input.keys.has('s')) y += 1;
        return { x, y, active: x !== 0 || y !== 0 };
      }

      function getHour() {
        return MORNING_HOUR + calendar.time01 * (NIGHT_HOUR - MORNING_HOUR);
      }

      function currentSeason() {
        const index = Math.floor((calendar.day - 1) / SEASON_LENGTH_DAYS) % seasons.length;
        return seasons[index];
      }

      function isDigRemovableVegetation(tile) {
        // Used by shovel dig so day-one overgrowth can be destroyed by digging underneath it.
        return !tile.crop && (tile.type === TileType.WEEDS || tile.type === TileType.SHRUB);
      }

      function blocksDiggingUnder(tile) {
        // Used by shovel dig to protect solid blockers and planted crops from accidental terrain edits.
        return tile.type === TileType.ROCK || Boolean(tile.crop);
      }

      function canUseAction(tool, action, col, row) {
        const tile = grid[row][col];
        if (tile.type === TileType.ROCK) return false;
        if (tool === 'shovel') {
          if (action === 'dig') {
            if (blocksDiggingUnder(tile)) return false;
            return [TileType.GRASS, TileType.TILLED, TileType.RAISED].includes(tile.type) || isDigRemovableVegetation(tile);
          }
          if (action === 'fill') return tile.type === TileType.TRENCH;
          if (action === 'raise') return [TileType.GRASS, TileType.TILLED].includes(tile.type) && !tile.crop;
        }
        if (tool === 'hoe') {
          if (action === 'till') return tile.type === TileType.GRASS && !tile.crop;
          if (action === 'smooth') return [TileType.TILLED, TileType.RAISED, TileType.PADDY].includes(tile.type) && !tile.crop;
        }
        if (tool === 'machete') {
          const targets = getMacheteTargets(col, row, action);
          return targets.some(t => {
            const targetTile = grid[t.row]?.[t.col];
            return targetTile && !targetTile.crop && (targetTile.type === TileType.WEEDS || targetTile.type === TileType.SHRUB);
          });
        }
        if (tool === 'seeds') {
          if (action === 'harvest') return Boolean(tile.crop && tile.cropReady);
          const crop = action.startsWith('plant_') ? action.slice(6) : null;
          if (!crop || tile.crop || !cropData[crop]) return false;
          if (inventory[cropData[crop].seedKey] <= 0) return false;
          return canPlantCropOnTile(crop, tile);
        }
        return false;
      }

      function plantCrop(tile, crop) {
        const data = cropData[crop];
        if (!data) return { ok: false, message: 'Unknown crop.' };
        if (inventory[data.seedKey] <= 0) return { ok: false, message: `No ${data.label} seeds left.` };
        if (tile.crop) return { ok: false, message: 'Something is already growing here.' };
        if (!canPlantCropOnTile(crop, tile))
          return { ok: false, message: 'Can only plant on tilled or raised soil.' };
        inventory[data.seedKey]--;
        clampInventoryStack(data.seedKey);
        tile.crop = crop;
        tile.cropAge = 0;
        tile.cropReady = false;
        tile.stress = '';
        const idealPct = Math.round(data.idealMin * 100) + '–' + Math.round(data.idealMax * 100);
        const ditchNote = data.needsAdjacentDitch ? ' Grows well beside adjacent ditches.' : '';
        return { ok: true, message: `Planted ${data.emoji} ${data.label}. Ideal water: ${idealPct}%.${ditchNote}` };
      }

      function harvestCrop(tile) {
        if (!tile.crop) return { ok: false, message: 'Nothing to harvest here.' };
        if (!tile.cropReady) return { ok: false, message: `${tile.crop} isn't ready yet.` };
        const data = cropData[tile.crop];
        inventory[data.cropKey] = Math.min(99, (inventory[data.cropKey] || 0) + 1);
        const msg = `Harvested ${data.emoji} ${data.label}!`;
        tile.crop = CropType.NONE;
        tile.cropAge = 0;
        tile.cropReady = false;
        tile.stress = '';
        return { ok: true, message: msg };
      }

      function getMacheteTargets(col, row, action) {
        const clampedCenter = { col: clamp(col, 0, COLS - 1), row: clamp(row, 0, ROWS - 1) };
        if (action !== 'slash') return [clampedCenter];

        // Slash uses a simple three-tile cone: the aimed tile plus its two side tiles relative to facing.
        const dir = facingCardinal(player.angle);
        const side = dir.x !== 0 ? { x: 0, y: 1 } : { x: 1, y: 0 };
        const seen = new Set();
        return [
          clampedCenter,
          { col: clampedCenter.col + side.x, row: clampedCenter.row + side.y },
          { col: clampedCenter.col - side.x, row: clampedCenter.row - side.y },
        ].filter(t => {
          if (t.col < 0 || t.col >= COLS || t.row < 0 || t.row >= ROWS) return false;
          const key = `${t.col},${t.row}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }

      function clearVegetationAt(col, row, action) {
        const targets = getMacheteTargets(col, row, action);
        let cleared = 0;
        for (const t of targets) {
          const tile = grid[t.row][t.col];
          if (!tile.crop && (tile.type === TileType.WEEDS || tile.type === TileType.SHRUB)) {
            tile.type = TileType.GRASS;
            inventory.mulch = Math.min(99, inventory.mulch + 1);
            markTileDirty(t.col, t.row);
            cleared++;
          }
        }
        return { cleared, targets };
      }

      function actionFxProfile(action, ok) {
        if (!ok) return { emoji: '×', color: '#ff8060', count: 8, spread: 0.42, lift: -0.5, ring: '#ff8060' };
        if (action === 'dig' || action === 'fill') return { emoji: '▪', color: '#8a5b34', count: 14, spread: 0.52, lift: -0.9, ring: '#c39a55' };
        if (action === 'raise') return { emoji: '▲', color: '#f0d040', count: 12, spread: 0.45, lift: -0.75, ring: '#f0d040' };
        if (action === 'paddy') return { emoji: '〜', color: '#6ec6f0', count: 14, spread: 0.50, lift: -0.65, ring: '#6ec6f0' };
        if (action === 'till' || action === 'smooth') return { emoji: '·', color: '#d2a66a', count: 12, spread: 0.42, lift: -0.65, ring: '#d2a66a' };
        if (action === 'cut' || action === 'slash') return { emoji: '✦', color: '#7fe89a', count: action === 'slash' ? 20 : 12, spread: action === 'slash' ? 0.78 : 0.48, lift: -0.8, ring: '#7fe89a' };
        if (action === 'harvest') return { emoji: '✧', color: '#f9e28a', count: 16, spread: 0.50, lift: -0.9, ring: '#f9e28a' };
        if (action.startsWith('plant')) return { emoji: '•', color: '#9ff08a', count: 11, spread: 0.36, lift: -0.55, ring: '#9ff08a' };
        if (action.startsWith('place_')) return { emoji: '◆', color: '#f9e28a', count: 12, spread: 0.42, lift: -0.65, ring: '#f9e28a' };
        if (action.startsWith('obj_process_')) return { emoji: '✧', color: '#e7b85c', count: 14, spread: 0.44, lift: -0.75, ring: '#e7b85c' };
        return { emoji: '•', color: '#f9e28a', count: 10, spread: 0.42, lift: -0.65, ring: '#f9e28a' };
      }

      function spawnActionParticles(col, row, action, ok) {
        const profile = actionFxProfile(action, ok);
        const baseY = tileSurfaceY(grid[row][col].type) + 0.16 + Math.max(0, grid[row][col].water * WATER_UNIT);
        actionTileEffects.push({ col, row, action, ok, age: 0, maxAge: ok ? 0.58 : 0.44, color: profile.ring });
        while (actionTileEffects.length > 8) actionTileEffects.shift();
        if (action === 'slash') spawnWeaponTrailEffect(col, row, ok);

        for (let i = 0; i < profile.count; i++) {
          if (actionParticles.length >= ACTION_FX_LIMIT) actionParticles.shift();
          const a = Math.random() * Math.PI * 2;
          const d = Math.random() * profile.spread;
          // Spawned in tile-local world coords; consumed by updateActionParticles()/drawActionParticles().
          actionParticles.push({
            x: col + 0.5 + Math.cos(a) * d,
            y: baseY + 0.08 + Math.random() * 0.18,
            z: row + 0.5 + Math.sin(a) * d,
            vx: Math.cos(a) * (0.35 + Math.random() * 0.9),
            vy: profile.lift - Math.random() * 0.55,
            vz: Math.sin(a) * (0.35 + Math.random() * 0.9),
            age: 0,
            maxAge: 0.42 + Math.random() * 0.26,
            size: 9 + Math.random() * 8,
            emoji: profile.emoji,
            color: profile.color,
            gravity: ok ? 1.9 : 0.35
          });
        }
      }


      function spawnWeaponTrailEffect(col, row, ok) {
        const dir = facingCardinal(player.angle);
        const side = dir.x !== 0 ? { x: 0, y: 1 } : { x: 1, y: 0 };
        const targets = getMacheteTargets(col, row, 'slash');
        const surfaceY = targets.reduce((sum, t) => sum + tileSurfaceY(grid[t.row][t.col].type), 0) / Math.max(1, targets.length);
        weaponTrailEffects.push({
          col, row, dir, side,
          age: 0,
          maxAge: ok ? 0.34 : 0.24,
          ok,
          y: surfaceY + 0.18,
        });
        while (weaponTrailEffects.length > 5) weaponTrailEffects.shift();
      }

      function slashTrailWorldPoints(fx) {
        const cx = fx.col + 0.5;
        const cz = fx.row + 0.5;
        const near = 0.02;
        const far = 1.02;
        const halfWidth = 1.35;
        return [
          { x: cx + fx.dir.x * near - fx.side.x * halfWidth, y: fx.y, z: cz + fx.dir.y * near - fx.side.y * halfWidth },
          { x: cx + fx.dir.x * far  - fx.side.x * halfWidth, y: fx.y, z: cz + fx.dir.y * far  - fx.side.y * halfWidth },
          { x: cx + fx.dir.x * (far + 0.16), y: fx.y + 0.03, z: cz + fx.dir.y * (far + 0.16) },
          { x: cx + fx.dir.x * far  + fx.side.x * halfWidth, y: fx.y, z: cz + fx.dir.y * far  + fx.side.y * halfWidth },
          { x: cx + fx.dir.x * near + fx.side.x * halfWidth, y: fx.y, z: cz + fx.dir.y * near + fx.side.y * halfWidth },
        ];
      }

      function updateActionParticles(dt) {
        for (let i = actionParticles.length - 1; i >= 0; i--) {
          const p = actionParticles[i];
          p.age += dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.z += p.vz * dt;
          p.vy += p.gravity * dt;
          if (p.age >= p.maxAge) actionParticles.splice(i, 1);
        }
        for (let i = actionTileEffects.length - 1; i >= 0; i--) {
          actionTileEffects[i].age += dt;
          if (actionTileEffects[i].age >= actionTileEffects[i].maxAge) actionTileEffects.splice(i, 1);
        }
        for (let i = weaponTrailEffects.length - 1; i >= 0; i--) {
          weaponTrailEffects[i].age += dt;
          if (weaponTrailEffects[i].age >= weaponTrailEffects[i].maxAge) weaponTrailEffects.splice(i, 1);
        }
      }

      function worldToOverlay(x, y, z) {
        const v = new THREE.Vector3(x, y, z);
        v.project(camera);
        const rect = threeContainer.getBoundingClientRect();
        return {
          x: (v.x * 0.5 + 0.5) * rect.width,
          y: (-v.y * 0.5 + 0.5) * rect.height,
          visible: v.z >= -1 && v.z <= 1
        };
      }

      function drawWeaponTrailEffects() {
        for (const fx of weaponTrailEffects) {
          const t = fx.age / fx.maxAge;
          const pts = slashTrailWorldPoints(fx).map(p => worldToOverlay(p.x, p.y, p.z));
          if (pts.some(p => !p.visible)) continue;
          const alpha = Math.max(0, 1 - t);
          octx.save();
          octx.globalAlpha = alpha * (fx.ok ? 0.44 : 0.34);
          octx.fillStyle = fx.ok ? 'rgba(127,232,154,0.34)' : 'rgba(255,128,96,0.30)';
          octx.strokeStyle = fx.ok ? '#d9ffe0' : '#ff8060';
          octx.lineWidth = fx.ok ? 4 : 3;
          octx.lineJoin = 'round';
          octx.beginPath();
          octx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length; i++) octx.lineTo(pts[i].x, pts[i].y);
          octx.closePath();
          octx.fill();
          octx.globalAlpha = alpha * 0.92;
          octx.beginPath();
          octx.moveTo(pts[1].x, pts[1].y);
          octx.quadraticCurveTo(pts[2].x, pts[2].y - 8 * alpha, pts[3].x, pts[3].y);
          octx.stroke();
          octx.restore();
        }
      }

      function drawActionTileEffects() {
        for (const fx of actionTileEffects) {
          const t = fx.age / fx.maxAge;
          const tile = grid[fx.row][fx.col];
          const y = tileSurfaceY(tile.type) + 0.06 + Math.max(0, tile.water * WATER_UNIT);
          const center = worldToOverlay(fx.col + 0.5, y + 0.02, fx.row + 0.5);
          if (!center.visible) continue;
          const east = worldToOverlay(fx.col + 1.0, y + 0.02, fx.row + 0.5);
          const north = worldToOverlay(fx.col + 0.5, y + 0.02, fx.row + 0.0);
          const radius = Math.max(12, Math.hypot(east.x - center.x, east.y - center.y, north.x - center.x, north.y - center.y) * (0.92 + t * 0.18));
          octx.save();
          octx.globalAlpha = (1 - t) * (fx.ok ? 0.85 : 0.95);
          octx.strokeStyle = fx.color;
          octx.lineWidth = fx.ok ? 3 : 4;
          octx.setLineDash(fx.ok ? [7, 5] : [3, 4]);
          octx.beginPath();
          octx.ellipse(center.x, center.y, radius, radius * 0.42, 0, 0, Math.PI * 2);
          octx.stroke();
          octx.restore();
        }
      }

      function drawActionParticles() {
        octx.save();
        octx.textAlign = 'center';
        octx.textBaseline = 'middle';
        for (const p of actionParticles) {
          const t = p.age / p.maxAge;
          const pos = worldToOverlay(p.x, p.y, p.z);
          if (!pos.visible) continue;
          octx.globalAlpha = Math.max(0, 1 - t);
          octx.font = `${Math.max(8, p.size * (1 - t * 0.35))}px 'DM Mono', monospace`;
          octx.fillStyle = p.color;
          octx.fillText(p.emoji, pos.x, pos.y);
        }
        octx.restore();
        octx.globalAlpha = 1;
      }

      function applyAction(tool, action, col, row) {
        if (!canUseAction(tool, action, col, row)) return { ok: false, message: `${actionName(action)} cannot be used on that tile.` };
        const tile = grid[row][col];

        if (tool === 'shovel') {
          const dugVegetation = action === 'dig' && isDigRemovableVegetation(tile);
          if (action === 'dig')   tile.type = TileType.TRENCH;
          if (action === 'fill')  tile.type = TileType.GRASS;
          if (action === 'raise') tile.type = TileType.RAISED;
          tile.water = 0; tile.crop = CropType.NONE; tile.cropAge = 0; tile.cropReady = false;
          const digMsg = dugVegetation ? 'Dug a trench and cleared the vegetation above it.' : `${tileStyles[tile.type].label} — ${contextualActionLabel(action, tile)}.`;
          return { ok: true, message: digMsg };
        }

        if (tool === 'hoe') {
          tile.type = action === 'till' ? TileType.TILLED : TileType.GRASS;
          if (action === 'smooth') tile.crop = CropType.NONE;
          return { ok: true, message: action === 'till' ? 'Tilled a plantable bed.' : 'Smoothed the tile back into grass.' };
        }

        if (tool === 'machete') {
          const result = clearVegetationAt(col, row, action);
          if (result.cleared <= 0) return { ok: false, message: action === 'slash' ? 'Slash cone found no overgrowth.' : 'No overgrowth to cut here.' };
          return {
            ok: true,
            message: action === 'slash'
              ? `Slashed ${result.cleared} tile${result.cleared === 1 ? '' : 's'} in the cone into mulch.`
              : 'Cut one tile of day-one overgrowth into mulch.'
          };
        }

        if (tool === 'seeds') {
          if (action === 'harvest') return harvestCrop(tile);
          const crop = action.startsWith('plant_') ? action.slice(6) : null;
          return plantCrop(tile, crop);
        }

        return { ok: false, message: 'No action handler found.' };
      }

      function useActiveAction() {
        // Per-tool swing duration: thrust fast, chop medium, sweep slow
        toolSwingDur = activeTool === 'shovel' ? 0.18
                     : activeTool === 'hoe'    ? 0.28
                     : activeTool === 'machete'? 0.32 : 0.22;
        toolSwingT = toolSwingDur;
        const reticle = getReticleTile();
        const tile    = grid[reticle.row][reticle.col];
        let result;

        // World object actions
        if (activeAction === 'obj_exit_house') {
          exitInterior();
          result = { ok: true, message: 'Stepped outside.' };
        } else if (activeAction.startsWith('obj_')) {
          const obj = getWorldObjectAt(reticle.col, reticle.row);
          result = obj ? obj.onAction(activeAction) : { ok: false, message: 'No object here.' };
        } else if (activeAction.startsWith('place_')) {
          result = placeProcessingFurniture(reticle.col, reticle.row, activeAction.slice(6));
        } else if (activeAction === 'spawn_uumkaoii') {
          result = spawnUumkaoii(reticle.col, reticle.row);
        } else if (activeAction.startsWith('plant_')) {
          result = plantCrop(tile, activeAction.slice(6));
        } else if (activeAction === 'harvest') {
          result = harvestCrop(tile);
        } else {
          result = applyAction(activeTool, activeAction, reticle.col, reticle.row);
        }
        lastActionMessage = result.message;
        showToast(result.message, result.ok !== false);
        spawnActionParticles(reticle.col, reticle.row, activeAction, result.ok !== false);
        debugLog(`${result.ok ? 'ok' : 'blocked'} ${activeAction} @ c${reticle.col},r${reticle.row}: ${result.message}`);
        recomputeWater(false);
        if (result.ok !== false) markTileDirty(reticle.col, reticle.row);
        refreshActionBar();
      }

      function getReticleTile() {
        const dir = facingCardinal(player.angle);
        // Cast a ray from the player's world position in the facing direction.
        // Using 0.7×TILE ensures we always land in the next tile regardless of
        // where within the current tile the player is standing.
        const probeX = player.x + dir.x * TILE * 0.7;
        const probeY = player.y + dir.y * TILE * 0.7;
        return {
          col: clamp(Math.floor(probeX / TILE), 0, getActiveCols() - 1),
          row: clamp(Math.floor(probeY / TILE), 0, getActiveRows() - 1),
          dir
        };
      }

      function facingCardinal(angle) {
        const x = Math.cos(angle);
        const y = Math.sin(angle);
        if (Math.abs(x) > Math.abs(y)) return { x: Math.sign(x), y: 0, name: x > 0 ? 'east' : 'west' };
        return { x: 0, y: Math.sign(y), name: y > 0 ? 'south' : 'north' };
      }

      function angleDiff(target, current) {
        let d = target - current;
        while (d >  Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        return d;
      }

      const PERP_DEAD_RAD = 30 * Math.PI / 180;

      // Keeps model rotation outside ±15° dead zones around each perp angle.
      // state: persistent object per entity (must survive across frames).
      // Returns { effectiveTarget, snapTo } where snapTo is non-null when the model
      // should teleport (raw target crossed through a perp to the far side).
      function perpClamp(state, rawTarget, perps) {
        if (!state.perpSides) state.perpSides = perps.map(() => null);
        let effectiveTarget = rawTarget;
        let snapTo = null;
        for (let i = 0; i < perps.length; i++) {
          const P = perps[i];
          const dT = angleDiff(rawTarget, P);
          if (Math.abs(dT) >= PERP_DEAD_RAD) {
            const newSide = dT > 0 ? 1 : -1;
            if (state.perpSides[i] !== null && state.perpSides[i] !== newSide) {
              snapTo = P + newSide * PERP_DEAD_RAD;
            }
            state.perpSides[i] = newSide;
          } else {
            if (state.perpSides[i] === null) state.perpSides[i] = dT >= 0 ? 1 : -1;
            effectiveTarget = P + state.perpSides[i] * PERP_DEAD_RAD;
          }
        }
        return { effectiveTarget, snapTo };
      }

      function nearestCardinalAngle(angle) {
        const cardinals = [0, Math.PI / 2, Math.PI, -Math.PI / 2]; // E S W N
        let best = cardinals[0], bestDiff = Infinity;
        for (const c of cardinals) {
          const d = Math.abs(angleDiff(c, angle));
          if (d < bestDiff) { bestDiff = d; best = c; }
        }
        return best;
      }

      function checkForMajorStorm() {
        if (calendar.weather !== 'storm') return;
        if (calendar.day === lastStormDay) return;
        // ~30% of storm days trigger a major event
        const roll = seededRandom(calendar.day * 6173 + 41);
        if (roll > 0.30) return;
        lastStormDay = calendar.day;

        let trenchesHit = 0, raisedHit = 0;
        for (let row = 0; row < ROWS; row++) {
          for (let col = 0; col < COLS; col++) {
            const tile = grid[row][col];
            const hitRoll = seededRandom(col * 17 + row * 31 + calendar.day * 7);
            if (tile.type === TileType.TRENCH && hitRoll < 0.22) {
              tile.type = TileType.GRASS; tile.water = 0.6; tile.flow = false;
              trenchesHit++;
            } else if (tile.type === TileType.RAISED && hitRoll < 0.18) {
              tile.type = TileType.TILLED; tile.water = clamp(tile.water + 0.3, 0, 1);
              raisedHit++;
            }
          }
        }

        const name = STORM_NAMES[calendar.day % STORM_NAMES.length];
        const dmgText = [
          trenchesHit > 0 ? `${trenchesHit} trench${trenchesHit > 1 ? 'es' : ''} collapsed` : null,
          raisedHit   > 0 ? `${raisedHit} raised bed${raisedHit > 1 ? 's' : ''} flattened` : null,
        ].filter(Boolean).join(', ');
        showToast(`⚡ ${name}! ${dmgText || 'No structural damage.'}`, false);
        debugLog(`major storm: ${name} — ${dmgText || 'no damage'}`);
      }

      function drawLightingOverlay() {
        const rect = threeContainer.getBoundingClientRect();
        lctx.clearRect(0, 0, rect.width, rect.height);

        if (currentArea === 'interior') {
          // Interior: no outdoor day/night overlay — just warm interior ambience
          lctx.fillStyle = 'rgba(80,40,10,0.08)';
          lctx.fillRect(0, 0, rect.width, rect.height);
          if (sceneTransAlpha > 0) {
            lctx.fillStyle = `rgba(0,0,0,${sceneTransAlpha})`;
            lctx.fillRect(0, 0, rect.width, rect.height);
          }
          return;
        }

        const { r, g, b, a } = getLightingState();
        const hour = getHour();
        const W = rect.width;
        const H = rect.height;

        // Radial gradient: slightly lighter at top (sky source), darker at edges
        const grad = lctx.createRadialGradient(W * 0.5, H * 0.1, 0, W * 0.5, H * 0.5, Math.max(W, H) * 0.7);
        grad.addColorStop(0,   `rgba(${r}, ${g}, ${b}, ${Math.max(0, a - 0.15)})`);
        grad.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, ${a})`);
        grad.addColorStop(1,   `rgba(${Math.round(r*0.6)}, ${Math.round(g*0.6)}, ${Math.round(b*0.7)}, ${Math.min(0.92, a + 0.15)})`);

        lctx.fillStyle = grad;
        lctx.fillRect(0, 0, W, H);

        // Sunrise/sunset warm glow on the horizon edge
        if (hour >= 6 && hour <= 8) {
          const sunProgress = (hour - 6) / 2;
          const sunAlpha = (1 - Math.abs(sunProgress - 0.4) * 2.5) * 0.22;
          if (sunAlpha > 0) {
            const sunGrad = lctx.createRadialGradient(W * 0.5, H * 0.05, 0, W * 0.5, H * 0.05, W * 0.55);
            sunGrad.addColorStop(0,   `rgba(255, 190, 80, ${sunAlpha})`);
            sunGrad.addColorStop(0.4, `rgba(255, 120, 40, ${sunAlpha * 0.5})`);
            sunGrad.addColorStop(1,   'rgba(255, 80, 20, 0)');
            lctx.fillStyle = sunGrad;
            lctx.fillRect(0, 0, W, H);
          }
        }
        if (hour >= 17.5 && hour <= 20) {
          const sunProgress = (hour - 17.5) / 2.5;
          const sunAlpha = Math.sin(sunProgress * Math.PI) * 0.28;
          if (sunAlpha > 0) {
            const sunGrad = lctx.createRadialGradient(W * 0.5, H * 0.08, 0, W * 0.5, H * 0.1, W * 0.6);
            sunGrad.addColorStop(0,   `rgba(255, 140, 40, ${sunAlpha})`);
            sunGrad.addColorStop(0.5, `rgba(200, 60, 20, ${sunAlpha * 0.5})`);
            sunGrad.addColorStop(1,   'rgba(120, 20, 40, 0)');
            lctx.fillStyle = sunGrad;
            lctx.fillRect(0, 0, W, H);
          }
        }

        // Night: add some subtle stars as white specks on very dark frames
        if (a > 0.55 && !calendar.isRaining) {
          const starAlpha = (a - 0.55) / 0.17;
          lctx.save();
          lctx.globalAlpha = starAlpha * 0.6;
          for (let s = 0; s < 38; s++) {
            const sx = seededRandom(s * 137) * W;
            const sy = seededRandom(s * 271) * H * 0.5;
            const sr = 0.8 + seededRandom(s * 53) * 1.2;
            const twinkle = 0.5 + 0.5 * Math.sin(performance.now() / 1000 * (0.5 + seededRandom(s * 11)) + s);
            lctx.globalAlpha = starAlpha * 0.5 * twinkle;
            lctx.fillStyle = '#ffffff';
            lctx.beginPath();
            lctx.arc(sx, sy, sr, 0, Math.PI * 2);
            lctx.fill();
          }
          lctx.restore();
        }

        // Lightning flash on lighting canvas too
        if (lightningAlpha > 0) {
          lctx.fillStyle = `rgba(220, 240, 255, ${lightningAlpha * 0.45})`;
          lctx.fillRect(0, 0, W, H);
        }

        // Scene transition fade-to-black
        if (sceneTransAlpha > 0) {
          lctx.fillStyle = `rgba(0,0,0,${sceneTransAlpha})`;
          lctx.fillRect(0, 0, W, H);
        }
      }

      function getLightingState() {
        const hour = getHour(); // 6..22
        const season = currentSeason();
        const isRaining = calendar.isRaining;
        const isStorm = isRaining && calendar.rainStrength >= 3;

        // Keyframe stops: [hour, r, g, b, alpha]
        const stops = [
          [6.0,  40,  30, 80, 0.55],  // pre-dawn: deep blue-purple
          [6.5,  220, 100, 40, 0.38], // sunrise: warm orange-red
          [7.5,  240, 160, 60, 0.22], // early morning: golden
          [9.0,  255, 230, 180, 0.08],// morning: near-clear
          [12.0, 255, 245, 210, 0.04],// noon: very clear, slight warm
          [15.0, 255, 225, 160, 0.10],// afternoon: slight golden
          [17.5, 255, 160, 60, 0.28], // late afternoon: amber
          [18.5, 220, 90,  30, 0.42], // sunset: deep orange
          [19.5, 130, 50,  80, 0.52], // dusk: purple-red
          [20.5, 30,  30,  80, 0.62], // early night: dark blue
          [22.0, 10,  10,  40, 0.72], // full night
        ];

        // Interpolate between stops
        let r = 10, g = 10, b = 40, a = 0.72;
        for (let i = 0; i < stops.length - 1; i++) {
          const [h0, r0, g0, b0, a0] = stops[i];
          const [h1, r1, g1, b1, a1] = stops[i + 1];
          if (hour >= h0 && hour <= h1) {
            const t = (hour - h0) / (h1 - h0);
            r = r0 + (r1 - r0) * t;
            g = g0 + (g1 - g0) * t;
            b = b0 + (b1 - b0) * t;
            a = a0 + (a1 - a0) * t;
            break;
          }
        }

        // Overcast weather tint on top
        if (isStorm) { r = r * 0.5 + 30 * 0.5; g = g * 0.5 + 45 * 0.5; b = b * 0.5 + 70 * 0.5; a = Math.min(0.85, a + 0.25); }
        else if (isRaining) { r = r * 0.7 + 50 * 0.3; g = g * 0.7 + 65 * 0.3; b = b * 0.7 + 90 * 0.3; a = Math.min(0.78, a + 0.12); }

        return { r: Math.round(r), g: Math.round(g), b: Math.round(b), a };
      }

      function updateWaterParticles(dt) {
        // Spawn particles on flowing trench tiles
        for (let row = 0; row < ROWS; row++) {
          for (let col = 0; col < COLS; col++) {
            const tile = grid[row][col];
            if (tile.type !== TileType.TRENCH || !tile.flow) continue;
            if (waterParticles.length < MAX_PARTICLES && Math.random() < 0.12) {
              const tx = col * TILE + 10 + Math.random() * (TILE - 20);
              const ty = row * TILE + 8 + Math.random() * (TILE - 16);
              waterParticles.push({
                wx: tx, wy: ty,
                vx: (Math.random() - 0.5) * 4,
                vy: 4 + Math.random() * 12, // flow south
                alpha: 0.7 + Math.random() * 0.3,
                radius: 1 + Math.random() * 2.5,
                life: 0,
                maxLife: 0.4 + Math.random() * 0.6,
                type: Math.random() < 0.6 ? 'bubble' : 'foam'
              });
            }
          }
        }
        // Update existing particles
        for (let i = waterParticles.length - 1; i >= 0; i--) {
          const p = waterParticles[i];
          p.wx += p.vx * dt;
          p.wy += p.vy * dt;
          p.life += dt;
          p.alpha = (1 - p.life / p.maxLife) * 0.85;
          // Kill if out of life or off a flowing trench
          const pc = Math.floor(p.wx / TILE);
          const pr = Math.floor(p.wy / TILE);
          const onFlow = pc >= 0 && pc < COLS && pr >= 0 && pr < ROWS
            && grid[pr][pc].type === TileType.TRENCH && grid[pr][pc].flow;
          if (p.life >= p.maxLife || !onFlow) waterParticles.splice(i, 1);
        }
      }

      function updateRipples(dt) {
        for (let i = ripples.length - 1; i >= 0; i--) {
          ripples[i].age += dt;
          if (ripples[i].age >= ripples[i].maxAge) ripples.splice(i, 1);
        }
      }

      function spawnRipples() {
        for (let row = 0; row < ROWS; row++) {
          for (let col = 0; col < COLS; col++) {
            const tile = grid[row][col];
            const isWet = (tile.type === TileType.PADDY && tile.water >= 0.5)
              || (tile.type !== TileType.TRENCH && tile.water >= 0.7);
            if (!isWet) continue;
            if (Math.random() < 0.22 && ripples.length < 60) {
              const rx = col * TILE + TILE * 0.3 + Math.random() * TILE * 0.4;
              const ry = row * TILE + TILE * 0.3 + Math.random() * TILE * 0.4;
              ripples.push({ x: rx, y: ry, age: 0, maxAge: 1.2 + Math.random() * 0.8 });
            }
          }
        }
        // Rain ripples: spawn within the visible viewport region
        if (calendar.isRaining) {
          const rect = threeContainer.getBoundingClientRect();
          const drops = calendar.rainStrength === 3 ? 8 : 3;
          for (let i = 0; i < drops; i++) {
            const rx = (camX - rect.width / 2) + Math.random() * rect.width;
            const ry = (camY - rect.height / 2) + Math.random() * rect.height;
            ripples.push({ x: rx, y: ry, age: 0, maxAge: 0.5 + Math.random() * 0.4 });
          }
        }
      }

      function updateLightningFlash(dt) {
        if (calendar.isRaining && calendar.rainStrength >= 3) {
          lightningTimer -= dt;
          if (lightningTimer <= 0) {
            lightningAlpha = 1.0;
            lightningTimer = 4 + Math.random() * 8;
          }
        }
        if (lightningAlpha > 0) lightningAlpha = Math.max(0, lightningAlpha - dt * 5);
      }

      function tileSpeedAt(wx, wy) {
        const aC = getActiveCols(), aR = getActiveRows();
        if (wx < 0 || wy < 0 || wx >= aC * TILE || wy >= aR * TILE) return null;
        const col  = Math.floor(wx / TILE);
        const row  = Math.floor(wy / TILE);
        const type = getActiveGrid()[row][col].type;
        if (isSolid(type)) return null;
        // Block the house footprint on the farm (player must use the door)
        if (currentArea === 'farm' && isHouseFootprint(col, row)) return null;
        return {
          [TileType.GRASS]:   1.00,
          [TileType.TILLED]:  0.85,
          [TileType.WEEDS]:   0.58,
          [TileType.RAISED]:  0.90,
          [TileType.PADDY]:   0.70,
          [TileType.TRENCH]:  0.30,
        }[type] ?? 1.00;
      }

      // ═══════════════════════════════════════════════════════════════
      //  THREE.JS RENDERER
      //  World units: 1 unit = 1 tile. X=col, Z=row, Y=height.
      //  Floor Y: RAISED=0.5, normal=0, TRENCH=-0.5
      //  Water rendered as a semi-transparent plane at floor Y + water depth.
      //  Camera: isometric-style, fixed angle, follows player smoothly.
      // ═══════════════════════════════════════════════════════════════

      // ── Three.js scene setup ──────────────────────────────────────
      const THREE_SCALE = 1.0;  // world units per tile (keep at 1)

      const scene    = new THREE.Scene();
      scene.background = new THREE.Color(0x1a2b20);
      scene.fog      = new THREE.FogExp2(0x1a2b20, 0.018);

      const threeRect = threeContainer.getBoundingClientRect();
      const renderer  = new THREE.WebGLRenderer({ antialias: true, alpha: false });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(threeRect.width || window.innerWidth, threeRect.height || window.innerHeight);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
      threeContainer.appendChild(renderer.domElement);

      // ── Interior scene (bigger-on-the-inside room) ────────────────
      const interiorScene = new THREE.Scene();
      interiorScene.background = new THREE.Color(0x000000);

      // Interior lighting — warm lantern-style
      const _intAmbient = new THREE.AmbientLight(0xffd090, 0.7);
      interiorScene.add(_intAmbient);
      const _intKey = new THREE.DirectionalLight(0xfff0cc, 0.5);
      _intKey.position.set(2, 6, 3);
      interiorScene.add(_intKey);
      const _intFill = new THREE.PointLight(0xff8833, 0.6, 12);
      _intFill.position.set(3, 1.8, 2.5);  // centre of 6×5 main room
      interiorScene.add(_intFill);

      // WallBuilder instance — loads Roughbrick1.glb eagerly in background
      const houseWallBuilder = new WallBuilder({ glbBasePath: 'assets/models/' });
      let interiorSceneBuilt = false;
      let interiorWallGroup  = null;

      houseWallBuilder.loadDefaultGlb()
        .then(() => {
          debugLog('Interior walls: Roughbrick1.glb loaded');
          if (interiorSceneBuilt && interiorWallGroup) {
            WallBuilder.disposeGroup(interiorWallGroup);
            interiorScene.remove(interiorWallGroup);
            interiorWallGroup = houseWallBuilder.build(INTERIOR_WALL_PANELS, { usePlaceholder: false, unitMult: 0.5, rockScale: 1.5, preScale: [1, 1, 0.6], brickJitter: { rotYDeg: 8, shiftU: 0.04, shiftV: 0.03 } });
            _markOutline(interiorWallGroup);
            interiorScene.add(interiorWallGroup);
            debugLog('Interior walls rebuilt with real GLB');
          }
        })
        .catch(err => debugLog('Interior walls GLB error: ' + err.message));

      // Wall panels derived from playerhouse_interior.json wallEdges, merged into rect panels.
      // Coord origin: editor cell (9,9) → interior (0,0).
      // N/S panels face along Z (rotY=0/180); W/E panels face along X (rotY=±90).
      const INTERIOR_WALL_PANELS = [
        { id: 'n_wall',  width: 6, height: INTERIOR_WALL_HEIGHT, position: [3, 0, 0],   rotationDeg: [0,   0, 0] },
        { id: 'w_wall',  width: 5, height: INTERIOR_WALL_HEIGHT, position: [0, 0, 2.5], rotationDeg: [0,  90, 0] },
        { id: 'e_wall',  width: 5, height: INTERIOR_WALL_HEIGHT, position: [6, 0, 2.5], rotationDeg: [0, -90, 0] },
        { id: 's_left',  width: 2, height: INTERIOR_WALL_HEIGHT, position: [1, 0, 5],   rotationDeg: [0, 180, 0] },
        { id: 's_right', width: 2, height: INTERIOR_WALL_HEIGHT, position: [5, 0, 5],   rotationDeg: [0, 180, 0] },
        // exit_w / exit_e / exit_s omitted — corridor entrance kept open
      ];

      // Built lazily on first entry to avoid blocking startup; called by enterInterior().
      function buildInteriorScene() {
        if (interiorSceneBuilt) return;
        interiorSceneBuilt = true;

        // Floor — boards.png if present, warm brown placeholder otherwise
        const floorMat = new THREE.MeshLambertMaterial({ color: 0x8b6914 });
        const exitMat  = new THREE.MeshLambertMaterial({ color: 0x8b1a1a });
        new THREE.TextureLoader().load(
          'assets/textures/boards.png',
          (tex) => {
            tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
            floorMat.map = tex;
            floorMat.color.set(0xffffff);
            floorMat.needsUpdate = true;
          },
          undefined,
          () => {} // missing → keep brown
        );

        // Floor tiles from JSON floorCells: main room 6×5 + south corridor 2×1
        const floorCells = [];
        for (let r = 0; r < 5; r++) for (let c = 0; c < 6; c++) floorCells.push([c, r]);
        floorCells.push([2, 5], [3, 5]);

        for (const [c, r] of floorCells) {
          const fl = new THREE.Mesh(new THREE.BoxGeometry(1, 0.1, 1), r === INTERIOR_EXIT_ROW ? exitMat : floorMat);
          fl.position.set(c + 0.5, -0.05, r + 0.5);
          fl.receiveShadow = true;
          interiorScene.add(fl);
        }

        // Instanced walls: 50% brick size, 4x density, 60% depth, micro-jitter
        interiorWallGroup = houseWallBuilder.build(INTERIOR_WALL_PANELS, { usePlaceholder: true, unitMult: 0.5, rockScale: 1.5, preScale: [1, 1, 0.6], brickJitter: { rotYDeg: 8, shiftU: 0.04, shiftV: 0.03 } });
        _markOutline(interiorWallGroup);
        interiorScene.add(interiorWallGroup);

        debugLog('buildInteriorScene complete');
      }

      // ── Inverted shell outline ────────────────────────────────────
      // Second render pass: back faces only, vertices extruded along
      // normals → solid black border on every mesh edge. No render
      // targets or screen-space sampling required.
      const shellOutlineMat = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        uniforms: {
          uThickness: { value: 0.006 },  // NDC units → constant screen-pixel width
        },
        vertexShader: `
          #ifdef USE_INSTANCING
            attribute mat4 instanceMatrix;
          #endif
          uniform float uThickness;
          void main() {
            #ifdef USE_INSTANCING
              mat4 mvMatrix = modelViewMatrix * instanceMatrix;
            #else
              mat4 mvMatrix = modelViewMatrix;
            #endif
            vec4 clip  = projectionMatrix * mvMatrix * vec4(position, 1.0);
            vec4 clipN = projectionMatrix * mvMatrix * vec4(position + normal, 1.0);

            vec2 dir = clipN.xy / clipN.w - clip.xy / clip.w;
            float len = length(dir);
            dir = (len > 1e-5) ? dir / len : vec2(0.0, 0.0);
            clip.xy    += dir * uThickness * clip.w;
            gl_Position = clip;
          }
        `,
        fragmentShader: `
          void main() {
            gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
          }
        `,
        // depthWrite off: shell only reads the scene depth, never corrupts it.
        // LessDepth: coplanar back faces (adjacent tiles share the same Z plane)
        // would pass LEQUAL and splat black everywhere — LESS rejects equal depth.
        depthWrite: false,
        depthFunc:  THREE.LessDepth,
      });

      // Enable layer 1 on a mesh (or every mesh inside a Group) so the
      // selective outline pass picks it up. Flat floor slabs, water, and
      // grass billboards stay on layer 0 only and are never outlined.
      function _markOutline(obj) {
        if (!obj || typeof obj.isMesh === 'undefined' && !obj.isGroup) return;
        if (obj.isMesh) { obj.layers.enable(1); return; }
        obj.traverse(child => { if (child.isMesh) child.layers.enable(1); });
      }

      // Camera — isometric-style: high angle, offset NW, looking SE toward map center
      const CAM_DIST   = 14;
      const CAM_ANGLE  = Math.PI / 5.5;  // ~33° from horizontal — classic 3/4 RPG tilt
      const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
      let camTargetX = COLS / 2, camTargetZ = ROWS * 0.72;

      function updateCameraPosition() {
        const tx = camTargetX, tz = camTargetZ;
        // Camera sits due south of target, elevated, looking straight north
        camera.position.set(
          tx,
          Math.sin(CAM_ANGLE) * CAM_DIST,
          tz + Math.cos(CAM_ANGLE) * CAM_DIST  // +Z = south
        );
        camera.lookAt(tx, 0, tz);
        camera.aspect = threeContainer.clientWidth / threeContainer.clientHeight;
        camera.updateProjectionMatrix();
      }
      updateCameraPosition();

      // ── Lighting ──────────────────────────────────────────────────
      const ambientLight = new THREE.AmbientLight(0xffeedd, 0.7);
      scene.add(ambientLight);
      const sunLight = new THREE.DirectionalLight(0xfff5e0, 1.1);
      sunLight.position.set(8, 16, -6);
      sunLight.castShadow = true;
      sunLight.shadow.mapSize.set(2048, 2048);
      sunLight.shadow.camera.near = 0.5;
      sunLight.shadow.camera.far  = 80;
      sunLight.shadow.camera.left = sunLight.shadow.camera.bottom = -30;
      sunLight.shadow.camera.right = sunLight.shadow.camera.top  =  30;
      scene.add(sunLight);

      // Hemisphere light for sky/ground fill
      const hemiLight = new THREE.HemisphereLight(0x88ccff, 0x3a5a30, 0.5);
      scene.add(hemiLight);

      // ── Materials ─────────────────────────────────────────────────
      const tileMats = {
        grass:  new THREE.MeshLambertMaterial({ color: new THREE.Color().setHSL(108/360, 0.58, 0.28) }),
        weeds:  new THREE.MeshLambertMaterial({ color: 0x247c3c }),
        tilled: new THREE.MeshLambertMaterial({ color: 0x8a5b34 }),
        trench: new THREE.MeshLambertMaterial({ color: 0x3a2510 }),
        raised: new THREE.MeshLambertMaterial({ color: 0xc39a55 }),
        paddy:  new THREE.MeshLambertMaterial({ color: 0x6aa263 }),
        rock:   new THREE.MeshLambertMaterial({ color: 0x79807c }),
        shrub:  new THREE.MeshLambertMaterial({ color: 0x356e36 }),
      };
      // Floor material for vegetation tiles — matches weed foliage HSL color
      const vegFloorMat = new THREE.MeshLambertMaterial({ color: new THREE.Color().setHSL(108 / 360, 0.58, 0.28) });
      // ── Water shader — flow lines + ripple rings ───────────────────
      // Each water plane gets its own ShaderMaterial instance with per-tile uniforms.
      // uFlow: vec2 flow direction (normalised), zero = still water → ripple mode
      // uDepth: 0..1 depth fraction
      // uTime: global time
      // uPhase: per-tile phase offset
      const waterVertShader = `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `;
      const waterFragShader = `
        uniform float uTime;
        uniform float uPhase;
        uniform float uDepth;     // 0..1
        uniform vec2  uFlow;      // normalised flow dir, (0,0) = still
        uniform vec3  uColor;

        varying vec2 vUv;

        float stripe(float v, float freq, float sharpness) {
          float s = fract(v * freq - uTime * 0.6 + uPhase);
          return pow(max(0.0, 1.0 - abs(s - 0.5) * sharpness), 2.5);
        }

        float ripple(vec2 uv, float t) {
          vec2 c = uv - 0.5;
          float d = length(c);
          float wave = sin(d * 18.0 - t * 2.5 + uPhase * 6.28) * 0.5 + 0.5;
          float fade = smoothstep(0.5, 0.05, d); // fade toward edges
          return wave * fade;
        }

        void main() {
          float flowLen = length(uFlow);

          float effect;
          if (flowLen > 0.1) {
            // ── Flow mode: animated lines parallel to flow direction ──
            // Project UV onto flow axis to get the "along-flow" coordinate
            vec2 flowDir = uFlow / flowLen;
            vec2 perpDir = vec2(-flowDir.y, flowDir.x);
            vec2 uvc     = vUv - 0.5;
            float along  = dot(uvc, flowDir);
            float perp   = dot(uvc, perpDir);

            // Main flow stripes — scroll along flow axis
            float lines  = stripe(along + perp * 0.15, 3.5, 6.0) * 0.7
                         + stripe(along + perp * 0.1,  5.5, 8.0) * 0.4;

            // Subtle cross-chop (perpendicular micro-ripples)
            float chop   = stripe(perp, 9.0, 10.0) * 0.2;
            effect = lines + chop;
          } else {
            // ── Still mode: expanding concentric rings ──
            float t2 = uTime * 0.8 + uPhase * 3.14;
            effect = ripple(vUv, t2) * 0.7
                   + ripple(vUv + vec2(0.25, 0.1), t2 * 1.3) * 0.35;
          }

          // Brightness of surface detail scales with depth so shallow still shows something
          float detailAlpha = mix(0.35, 0.65, uDepth) * effect;

          // Base water tint
          float baseAlpha = uDepth;  // opacity = depth fraction exactly

          vec3 surfaceColor = mix(uColor, vec3(0.85, 0.96, 1.0), effect * 0.55);
          float finalAlpha  = clamp(baseAlpha + detailAlpha, 0.0, 0.92);

          gl_FragColor = vec4(surfaceColor, finalAlpha);
        }
      `;

      function makeWaterMaterial(col, row) {
        return new THREE.ShaderMaterial({
          uniforms: {
            uTime:  { value: 0 },
            uPhase: { value: (col * 2.7 + row * 4.1) % 6.28 },
            uDepth: { value: 0 },
            uFlow:  { value: new THREE.Vector2(0, 0) },
            uColor: { value: new THREE.Color(0x14a0c8) },
          },
          vertexShader:   waterVertShader,
          fragmentShader: waterFragShader,
          transparent:    true,
          depthWrite:     false,
          side:           THREE.FrontSide,
        });
      }

      // Global water time — updated in gameLoop
      let waterTime = 0;
      const reticleMat = new THREE.MeshBasicMaterial({
        color: 0xf9e28a, wireframe: true, transparent: true, opacity: 0.85,
      });
      const reticleBlockedMat = new THREE.MeshBasicMaterial({
        color: 0xff6040, wireframe: true, transparent: true, opacity: 0.85,
      });

      // ── World Z levels (in Three.js Y units) ──────────────────────
      // Grass/tilled/weeds/paddy: top face at Y=0
      // Trench:                   top face at Y=-0.5  (dug 0.5 down)
      // Raised:                   top face at Y=+0.5  (built 0.5 up)
      // Rock:                     top face at Y=+0.75 (tall obstacle)
      // Vegetation slabs:         bottom at Y=0, top at Y=VEG_H
      //
      // Box center Y = topFaceY - boxHeight/2
      const SLAB_H     = 0.5;   // thickness of all ground slabs
      const TRENCH_TOP = -0.5;  // top surface of trench
      const NORMAL_TOP =  0.0;  // top surface of grass/tilled/etc
      const RAISED_TOP = +0.5;  // top surface of raised bed
      const ROCK_H     =  0.75; // rock block height
      const ROCK_TOP   = NORMAL_TOP + ROCK_H;

      const WATER_UNIT = SLAB_H / MAX_WATER; // world-Y per water depth unit

      // Y center of each tile's primary mesh
      function tileYCenter(type) {
        switch (type) {
          case TileType.TRENCH: return TRENCH_TOP - SLAB_H / 2;   // -0.75
          case TileType.RAISED: return RAISED_TOP - SLAB_H / 2;   // +0.25
          case TileType.ROCK:   return NORMAL_TOP + ROCK_H / 2;   // +0.375
          case TileType.SHRUB:  return NORMAL_TOP + VEG_H / 2;    // slab on surface
          case TileType.WEEDS:  return NORMAL_TOP + VEG_H / 2;
          default:              return NORMAL_TOP - SLAB_H / 2;   // -0.25 (grass/tilled/paddy)
        }
      }

      // Surface top Y for water placement and player standing
      function tileSurfaceY(type) {
        switch (type) {
          case TileType.TRENCH: return TRENCH_TOP;
          case TileType.RAISED: return RAISED_TOP;
          case TileType.ROCK:   return ROCK_TOP;
          default:              return NORMAL_TOP;
        }
      }

      // Geometry — full 1.0×1.0 footprint, no gaps
      // Per-tile floor: 2×2 top subdivisions with seam-free vertex displacement.
      // Displacement key is (round(worldX*2), round(worldZ*2)) so shared edge
      // vertices between adjacent tiles always hash to the same value.
      function makeFloorGeo(col, row) {
        const geo = new THREE.BoxGeometry(1.0, SLAB_H, 1.0, 2, 1, 2);
        const pa  = geo.attributes.position;
        const topY = SLAB_H / 2;
        for (let vi = 0; vi < pa.count; vi++) {
          if (Math.abs(pa.getY(vi) - topY) < 1e-4) {
            const kx = Math.round((col + 0.5 + pa.getX(vi)) * 2) | 0;
            const kz = Math.round((row + 0.5 + pa.getZ(vi)) * 2) | 0;
            let h = (2166136261 ^ (kx * 374761393) ^ (kz * 668265263)) >>> 0;
            h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
            pa.setY(vi, topY + (h / 4294967296 - 0.5) * 0.026);
          }
        }
        pa.needsUpdate = true;
        geo.computeVertexNormals();
        return geo;
      }

      // ── Rock tile: mini plateau heightfield (same pipeline as border terrain) ───
      // 9×9 vertex grid (0.125u steps) over a 1×1 tile. Uses seam-safe FNV hash
      // at tile edges so vertices match adjacent makeFloorGeo tiles exactly.
      function buildRockTileGeo(col, row) {
        const VERTS = 9, CELLS = 8;
        const STEP = 1.0 / CELLS;

        let _s = ((col * 374761393) ^ (row * 668265263)) >>> 0;
        const rng = () => {
          _s += 0x6D2B79F5;
          let t = Math.imul(_s ^ _s>>>15, _s|1);
          t ^= t + Math.imul(t ^ t>>>7, t|61);
          return ((t ^ t>>>14) >>> 0) / 4294967296;
        };

        // Same hash formula as makeFloorGeo — seam-safe at tile edges
        const seamDisp = (vx, vz) => {
          const kx = Math.round(vx * 2) | 0;
          const kz = Math.round(vz * 2) | 0;
          let h = (2166136261 ^ (kx * 374761393) ^ (kz * 668265263)) >>> 0;
          h = Math.imul(h ^ h>>>13, 1274126177) >>> 0;
          return (h / 4294967296 - 0.5) * 0.026;
        };

        // Finer roughness detail for the mound surface
        const roughDisp = (vx, vz) => {
          const kx = Math.round(vx * 8) | 0;
          const kz = Math.round(vz * 8) | 0;
          let h = (2166136261 ^ (kx * 374761393) ^ (kz * 668265263)) >>> 0;
          h = Math.imul(h ^ h>>>13, 1274126177) >>> 0;
          return (h / 4294967296 - 0.5) * 0.05;
        };

        const Y = new Float32Array(VERTS * VERTS);
        for (let vj = 0; vj < VERTS; vj++)
          for (let vi = 0; vi < VERTS; vi++)
            Y[vj*VERTS+vi] = seamDisp(col + vi*STEP, row + vj*STEP);

        // BFS plateau from a random interior starting cell (never touches edge cells)
        const startCi = 1 + Math.floor(rng() * (CELLS - 2));
        const startCj = 1 + Math.floor(rng() * (CELLS - 2));
        const maxSize = 6 + Math.floor(rng() * 20);
        const group = new Set([startCj * CELLS + startCi]);
        const front = [[startCi, startCj]];

        while (front.length && group.size < maxSize) {
          const fi = Math.floor(rng() * front.length);
          const [ci, cj] = front.splice(fi, 1)[0];
          for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
            const ni = ci+dc, nj = cj+dr;
            if (ni < 1 || ni > CELLS-2 || nj < 1 || nj > CELLS-2) continue;
            const nk = nj*CELLS+ni;
            if (group.has(nk)) continue;
            group.add(nk); front.push([ni, nj]);
          }
        }

        // Collect plateau vertex indices and find peak
        let maxY = -Infinity;
        const raised = new Set();
        for (const ck of group) {
          const ci = ck % CELLS, cj = (ck / CELLS) | 0;
          for (const vi of [cj*VERTS+ci, cj*VERTS+ci+1, (cj+1)*VERTS+ci, (cj+1)*VERTS+ci+1]) {
            raised.add(vi);
            if (Y[vi] > maxY) maxY = Y[vi];
          }
        }

        const PEAK = 0.32 + rng() * 0.38;
        const target = maxY + PEAK;

        // Raise plateau verts, blending to zero at tile edges
        for (const vi of raised) {
          const vix = vi % VERTS, viy = (vi / VERTS) | 0;
          const edgeDist = Math.min(vix, VERTS-1-vix, viy, VERTS-1-viy);
          const blend = Math.min(1, edgeDist / 2);
          if (blend <= 0) continue;
          const vx = col + vix*STEP, vz = row + viy*STEP;
          const h = seamDisp(vx, vz) + blend * target + roughDisp(vx, vz) * blend;
          if (h > Y[vi]) Y[vi] = h;
        }

        const positions = [];
        for (let vj = 0; vj < VERTS; vj++)
          for (let vi = 0; vi < VERTS; vi++)
            positions.push(vi*STEP - 0.5, Y[vj*VERTS+vi], vj*STEP - 0.5);

        // Split cells: stone if any corner is elevated (plateau or cliff face),
        // grass if all corners are at ground level. Threshold 0.05u sits above
        // the ±0.013u seam noise so ground cells always go green.
        const stoneIdx = [], grassIdx = [];
        for (let cj = 0; cj < CELLS; cj++)
          for (let ci = 0; ci < CELLS; ci++) {
            const v00=cj*VERTS+ci, v10=cj*VERTS+ci+1;
            const v01=(cj+1)*VERTS+ci, v11=(cj+1)*VERTS+ci+1;
            const tgt = Math.max(Y[v00], Y[v10], Y[v01], Y[v11]) > 0.05
              ? stoneIdx : grassIdx;
            tgt.push(v00, v01, v11, v00, v11, v10);
          }

        const posAttr = new THREE.Float32BufferAttribute(positions, 3);
        const makeGeo = (idx) => {
          if (!idx.length) return null;
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', posAttr);
          g.setIndex(new THREE.BufferAttribute(new Uint16Array(idx), 1));
          g.computeVertexNormals();
          return g;
        };
        return { stoneGeo: makeGeo(stoneIdx), grassGeo: makeGeo(grassIdx) };
      }

      // ── Terrain tile heightfield: TRENCH ditch and RAISED bed ──────────────────
      // Adjacency-driven shape with three refinements vs. the first version:
      //   1. PLATEAU factor expands the fully-blended interior (more plateau, less peak)
      //   2. Diagonal-corner correction fades the inner vertex of L-turns to NORMAL_TOP
      //   3. Geometry is split into dirtGeo (depressed/raised cells) and grassGeo (flat
      //      edge cells near NORMAL_TOP), mirroring the rock tile's stone/grass split.
      function buildTerrainTileGeo(col, row, type) {
        const VERTS = 9, CELLS = 8, STEP = 1.0 / CELLS;
        const BLEND_V  = 3;
        const PLATEAU  = type === TileType.RAISED ? 3.0 : 1.5;  // raised = wide flat top
        const targetDY = type === TileType.TRENCH
          ? TRENCH_TOP - NORMAL_TOP   // −0.5
          : RAISED_TOP - NORMAL_TOP;  // +0.5

        const openN = grid[row - 1]?.[col]?.type === type;
        const openS = grid[row + 1]?.[col]?.type === type;
        const openW = grid[row]?.[col - 1]?.type === type;
        const openE = grid[row]?.[col + 1]?.type === type;

        // Diagonal tiles — used to seal the inner corner of L-shaped turns
        const diagNW = grid[row-1]?.[col-1]?.type === type;
        const diagNE = grid[row-1]?.[col+1]?.type === type;
        const diagSW = grid[row+1]?.[col-1]?.type === type;
        const diagSE = grid[row+1]?.[col+1]?.type === type;

        const seamDisp = (vx, vz) => {
          const kx = Math.round(vx * 2) | 0, kz = Math.round(vz * 2) | 0;
          let h = (2166136261 ^ (kx * 374761393) ^ (kz * 668265263)) >>> 0;
          h = Math.imul(h ^ h>>>13, 1274126177) >>> 0;
          return (h / 4294967296 - 0.5) * 0.026;
        };

        const roughDisp = (vx, vz) => {
          const kx = Math.round(vx * 6) | 0, kz = Math.round(vz * 6) | 0;
          let h = (2166136261 ^ (kx * 374761393) ^ (kz * 668265263)) >>> 0;
          h = Math.imul(h ^ h>>>13, 1274126177) >>> 0;
          return (h / 4294967296 - 0.5) * 0.035;
        };

        const smooth = t => t * t * (3 - 2 * t);

        const Y = new Float32Array(VERTS * VERTS);
        for (let vj = 0; vj < VERTS; vj++) {
          for (let vi = 0; vi < VERTS; vi++) {
            const bW = openW ? 1 : smooth(Math.min(1, vi / BLEND_V));
            const bE = openE ? 1 : smooth(Math.min(1, (CELLS - vi) / BLEND_V));
            const bN = openN ? 1 : smooth(Math.min(1, vj / BLEND_V));
            const bS = openS ? 1 : smooth(Math.min(1, (CELLS - vj) / BLEND_V));

            // Diagonal correction: if both open sides share an outer (non-matching) diagonal,
            // fade the inner corner vertex back to NORMAL_TOP. Uses max() so only the exact
            // corner region (within BLEND_V steps of BOTH adjacent open edges) is affected.
            const bDiagNW = (openW && openN && !diagNW) ? smooth(Math.min(1, Math.max(vi, vj)           / BLEND_V)) : 1;
            const bDiagNE = (openE && openN && !diagNE) ? smooth(Math.min(1, Math.max(CELLS-vi, vj)     / BLEND_V)) : 1;
            const bDiagSW = (openW && openS && !diagSW) ? smooth(Math.min(1, Math.max(vi, CELLS-vj)     / BLEND_V)) : 1;
            const bDiagSE = (openE && openS && !diagSE) ? smooth(Math.min(1, Math.max(CELLS-vi, CELLS-vj) / BLEND_V)) : 1;

            const blend = Math.min(1, bW * bE * bN * bS * bDiagNW * bDiagNE * bDiagSW * bDiagSE * PLATEAU);
            const vx = col + vi * STEP, vz = row + vj * STEP;
            Y[vj * VERTS + vi] = seamDisp(vx, vz) + blend * targetDY + blend * roughDisp(vx, vz);
          }
        }

        const positions = [];
        for (let vj = 0; vj < VERTS; vj++)
          for (let vi = 0; vi < VERTS; vi++)
            positions.push(vi * STEP - 0.5, Y[vj * VERTS + vi], vj * STEP - 0.5);

        // Split cells: dirt where significantly depressed (trench) or elevated (raised);
        // grass on flat edge cells that blend back to ground level.
        const DIRT_THRESH = 0.05;
        const dirtIdx = [], grassIdx = [];
        for (let cj = 0; cj < CELLS; cj++)
          for (let ci = 0; ci < CELLS; ci++) {
            const v00=cj*VERTS+ci, v10=cj*VERTS+ci+1;
            const v01=(cj+1)*VERTS+ci, v11=(cj+1)*VERTS+ci+1;
            const y00=Y[v00], y10=Y[v10], y01=Y[v01], y11=Y[v11];
            const isDirt = type === TileType.TRENCH
              ? Math.min(y00, y10, y01, y11) < -DIRT_THRESH
              : Math.max(y00, y10, y01, y11) >  DIRT_THRESH;
            (isDirt ? dirtIdx : grassIdx).push(v00, v01, v11, v00, v11, v10);
          }

        const posAttr = new THREE.Float32BufferAttribute(positions, 3);
        const makeGeo = idx => {
          if (!idx.length) return null;
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', posAttr);
          g.setIndex(new THREE.BufferAttribute(new Uint16Array(idx), 1));
          g.computeVertexNormals();
          return g;
        };
        return { dirtGeo: makeGeo(dirtIdx), grassGeo: makeGeo(grassIdx) };
      }


      // Mirrors the procedural pipeline from HALandscapeGenV3:
      //   1) Initialize all verts at seam height (same FNV hash as makeFloorGeo)
      //   2) Rugged-plain passes: small connected-cell plateaus, low amplitude
      //   3) Cliff passes: large edge-biased plateaus, tall amplitude
      // Near-seam vertices are smoothly blended so the inner edge is gap-free.
      function buildBorderTerrain() {
        const BORDER_W   = 18;   // border tile width on each side
        const SEED       = 2026;
        const BLEND_STEPS = 8;   // seam-blend zone: 4 tiles = 8 vertex steps

        // ── Grid dims (0.5-unit vertex spacing = makeFloorGeo 2×2 subdivision) ──
        const BV  = BORDER_W * 2;
        const PVW = COLS * 2, PVH = ROWS * 2;
        const GW  = PVW + 2*BV + 1;       // 145 vertex columns
        const GH  = PVH + 2*BV + 1;       // 125 vertex rows
        const CW  = GW - 1, CH = GH - 1;

        // ── Mulberry32 RNG ─────────────────────────────────────────────────────
        let _s = SEED >>> 0;
        const rng = () => {
          _s += 0x6D2B79F5;
          let t = Math.imul(_s ^ _s>>>15, _s|1);
          t ^= t + Math.imul(t ^ t>>>7, t|61);
          return ((t ^ t>>>14) >>> 0) / 4294967296;
        };

        // ── Seam hash — exact copy of makeFloorGeo ─────────────────────────────
        const hashDisp = (vi, vj) => {
          let h = (2166136261 ^ (vi * 374761393) ^ (vj * 668265263)) >>> 0;
          h = Math.imul(h ^ h>>>13, 1274126177) >>> 0;
          return (h / 4294967296 - 0.5) * 0.026;
        };

        // Distance (in 0.5-unit vertex steps) of grid vertex (gi,gj) from playable boundary
        const vSteps = (gi, gj) => {
          const vi = gi - BV, vj = gj - BV;
          const dx = Math.max(0, -vi, vi - PVW);
          const dz = Math.max(0, -vj, vj - PVH);
          return Math.sqrt(dx*dx + dz*dz);
        };

        const isPlayable = (ci, cj) => ci>=BV && ci<BV+PVW && cj>=BV && cj<BV+PVH;

        // ── Height map initialised to exact seam heights ───────────────────────
        const Y = new Float32Array(GW * GH);
        for (let gj = 0; gj < GH; gj++)
          for (let gi = 0; gi < GW; gi++)
            Y[gj*GW+gi] = NORMAL_TOP + hashDisp(gi-BV, gj-BV);

        // ── Plateau operations ─────────────────────────────────────────────────
        const cv4 = (ci, cj) => [cj*GW+ci, cj*GW+ci+1, (cj+1)*GW+ci, (cj+1)*GW+ci+1];

        // Random-frontier connected group expansion (border cells only)
        function pickGroup(ci0, cj0, maxSz) {
          const group = [], seen = new Set([cj0*CW+ci0]);
          const front = [[ci0, cj0]];
          while (front.length && group.length < maxSz) {
            const fi = Math.floor(rng() * front.length);
            const [ci, cj] = front.splice(fi, 1)[0];
            group.push([ci, cj]);
            for (const [dc,dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
              const ni=ci+dc, nj=cj+dr;
              if (ni<0||ni>=CW||nj<0||nj>=CH) continue;
              const nk = nj*CW+ni;
              if (seen.has(nk) || isPlayable(ni,nj)) continue;
              seen.add(nk); front.push([ni,nj]);
            }
          }
          return group;
        }

        // Raise group verts to (max-in-group + amount).
        // Verts within BLEND_STEPS of the seam are blended proportionally
        // so the raised terrain ramps smoothly down to the seam edge.
        function raiseGroup(group, amount) {
          let maxY = -Infinity;
          const verts = new Set();
          for (const [ci,cj] of group)
            for (const vi of cv4(ci,cj)) { verts.add(vi); if(Y[vi]>maxY) maxY=Y[vi]; }
          const target = maxY + amount;
          for (const vi of verts) {
            const gi = vi%GW, gj = vi/GW|0;
            const st = vSteps(gi, gj);
            if (st === 0) continue;                          // seam — never touch
            const blend  = Math.min(1, st / BLEND_STEPS);   // 0→1 over 4-tile zone
            const raised = NORMAL_TOP + hashDisp(gi-BV, gj-BV) + blend*(target - NORMAL_TOP);
            if (raised > Y[vi]) Y[vi] = raised;             // plateaus only go up
          }
        }

        // Edge-biased seed cell picker (avoids playable area)
        function pickCell(outerBias) {
          const rim = BV >> 2; // outermost-quarter cells per side
          for (let attempt = 0; attempt < 300; attempt++) {
            let ci, cj;
            if (rng() < outerBias) {
              const side = Math.floor(rng() * 4);
              if (side===0) { ci=Math.floor(rng()*CW); cj=Math.floor(rng()*rim); }
              else if(side===1){ ci=Math.floor(rng()*CW); cj=(CH-1-Math.floor(rng()*rim))|0; }
              else if(side===2){ ci=Math.floor(rng()*rim); cj=Math.floor(rng()*CH); }
              else              { ci=(CW-1-Math.floor(rng()*rim))|0; cj=Math.floor(rng()*CH); }
            } else {
              ci=Math.floor(rng()*CW); cj=Math.floor(rng()*CH);
            }
            if (!isPlayable(ci,cj)) return [ci,cj];
          }
          return [0,0];
        }

        // ── Pass 1: rugged plain — small, low plateaus spread across the border ─
        for (let p = 0; p < 55; p++) {
          const [ci,cj] = pickCell(0.12);
          raiseGroup(pickGroup(ci, cj, 4 + Math.floor(rng()*18)), 0.05 + rng()*0.32);
        }

        // ── Pass 2: distant cliffs — tall, strongly edge-biased plateaus ────────
        for (let p = 0; p < 32; p++) {
          const [ci,cj] = pickCell(0.88);
          raiseGroup(pickGroup(ci, cj, 10 + Math.floor(rng()*38)), 0.9 + rng()*3.2);
        }

        // ── Pass 3: guarantee a continuous outer cliff ring ────────────────────
        // Force-raise every vertex in the outermost RIM_V steps of each side
        // so there are no skybox gaps regardless of where random groups landed.
        const RIM_V   = 20;              // ~10 tile-widths from each outer edge
        const RIM_MIN = NORMAL_TOP + 3.0;
        for (let gj = 0; gj < GH; gj++) {
          for (let gi = 0; gi < GW; gi++) {
            if (gj >= RIM_V && gj <= GH-1-RIM_V &&
                gi >= RIM_V && gi <= GW-1-RIM_V) continue; // interior — skip
            const k = gj * GW + gi;
            if (Y[k] < RIM_MIN) Y[k] = RIM_MIN;
          }
        }

        // ── Build geometry (border ring only — playable interior skipped) ───────
        const pos = new Float32Array(GW * GH * 3);
        for (let gj = 0; gj < GH; gj++)
          for (let gi = 0; gi < GW; gi++) {
            const k = gj*GW+gi;
            pos[k*3]   = (gi-BV)*0.5;
            pos[k*3+1] = Y[k];
            pos[k*3+2] = (gj-BV)*0.5;
          }

        const indices = [];
        for (let cj = 0; cj < GH-1; cj++)
          for (let ci = 0; ci < GW-1; ci++) {
            if (isPlayable(ci,cj)) continue;
            const v00=cj*GW+ci, v10=cj*GW+ci+1, v01=(cj+1)*GW+ci, v11=(cj+1)*GW+ci+1;
            indices.push(v00, v01, v11,  v00, v11, v10);
          }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setIndex(new THREE.BufferAttribute(new Uint16Array(indices), 1));
        geo.computeVertexNormals();

        const mesh = new THREE.Mesh(geo, tileMats.grass);
        mesh.receiveShadow = true;
        scene.add(mesh);

        // ── Stone cliff skin: normal-based overlay on border terrain ─────────────
        // Matches the landscape generator's rule: faces with |normal.y| < 0.75
        // (steeper than ~41° from horizontal) are stone; shallower faces are grass.
        // For a 0.5×0.5 cell the diagonal cross product has cny=0.5 always, so the
        // threshold reduces to cnx²+cnz² > 0.194 — no sqrt required.
        const cliffMat = new THREE.MeshLambertMaterial({
          color: 0x6a6460, side: THREE.DoubleSide,
          polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
        });

        function elevStoneSkin(gjMin, gjMax, giMin, giMax) {
          const positions = [], idxArr = [];
          let vi = 0;
          for (let gj = gjMin; gj < gjMax; gj++) {
            for (let gi = giMin; gi < giMax; gi++) {
              const y00=Y[gj*GW+gi],     y10=Y[gj*GW+gi+1];
              const y01=Y[(gj+1)*GW+gi], y11=Y[(gj+1)*GW+gi+1];
              // Cross product of quad diagonals (SE-NW) × (NE-SW); cny = 0.5 always.
              const cnx = -0.5 * ((y10 + y11) - (y00 + y01));
              const cnz =  0.5 * ((y10 - y01) - (y11 - y00));
              if (cnx * cnx + cnz * cnz <= 0.194) continue;  // near-horizontal → grass
              const x0=(gi-BV)*0.5, x1=x0+0.5;
              const z0=(gj-BV)*0.5, z1=z0+0.5;
              positions.push(x0,y00,z0, x1,y10,z0, x0,y01,z1, x1,y11,z1);
              idxArr.push(vi,vi+2,vi+3, vi,vi+3,vi+1); vi+=4;
            }
          }
          if (!positions.length) return;
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
          g.setIndex(new THREE.BufferAttribute(new Uint32Array(idxArr), 1));
          g.computeVertexNormals();
          scene.add(new THREE.Mesh(g, cliffMat));
        }

        // North border strip (full width)
        elevStoneSkin(0,           BV,          0,          GW - 1);
        // South border strip (full width)
        elevStoneSkin(GH - 1 - BV, GH - 1,      0,          GW - 1);
        // West border strip (middle rows — corners already covered by N/S)
        elevStoneSkin(BV,          GH - 1 - BV, 0,          BV);
        // East border strip (middle rows)
        elevStoneSkin(BV,          GH - 1 - BV, GW - 1 - BV, GW - 1);
      }

      const rockGeo   = new THREE.BoxGeometry(0.9, ROCK_H,  0.9);
      const waterGeo  = new THREE.PlaneGeometry(1.0, 1.0);
      waterGeo.rotateX(-Math.PI / 2);
      const reticleGeo = new THREE.BoxGeometry(1.0, 0.06, 1.0);

      // ── Mesh stores ───────────────────────────────────────────────
      // Tile meshes: indexed by row*COLS+col
      const tileMeshes  = new Array(ROWS * COLS).fill(null);
      const waterMeshes = new Array(ROWS * COLS).fill(null);

      // ── Player root (Group — avatar plane attached after onboarding) ─
      const playerMesh = new THREE.Group();
      playerMesh.name = 'player_root';
      scene.add(playerMesh);

      // ── Reticle mesh ──────────────────────────────────────────────
      const reticleMesh = new THREE.Mesh(reticleGeo, reticleMat);
      scene.add(reticleMesh);

      // ── Tool meshes ───────────────────────────────────────────────
      // ── Tool meshes (player cube = 0.5w × 0.65h × 0.5d, 1 tile = 1 world unit) ──
      // toolSwingT counts down from toolSwingDur; progress = 1 - t/dur (0→1→0 arc).
      // Per-tool swing durations: shovel fast jab, hoe medium chop, machete slow sweep.
      let toolSwingT   = 0;
      let toolSwingDur = 0.22; // set per-tool when swing is triggered
      const TOOL_SWING_DUR = 0.22; // fallback

      function makeToolMesh(type) {
        const g       = new THREE.Group();
        const woodMat = new THREE.MeshLambertMaterial({ color: 0x7a4a28 });
        const metalMat= new THREE.MeshLambertMaterial({ color: 0xa8aaa0 });
        const bladeMat= new THREE.MeshLambertMaterial({ color: 0xd4d4c8 });

        if (type === 'shovel') {
          // Haft: 0.5 tile (half-tile). Blade: wide flat cap at far end.
          const haft  = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.055, 0.50), woodMat);
          haft.position.set(0, 0, 0.25);
          const blade = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.065, 0.10), metalMat);
          blade.position.set(0, 0, 0.53);
          g.add(haft, blade);

        } else if (type === 'hoe') {
          // Haft: 0.5 tile. Head: horizontal cross-piece (T from above).
          const haft = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.50), woodMat);
          haft.position.set(0, 0, 0.25);
          const head = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.10, 0.055), metalMat);
          head.position.set(0, 0, 0.53);
          g.add(haft, head);

        } else if (type === 'machete') {
          // Handle: 1/8 tile = 0.125. Blade: 3/8 tile = 0.375.
          const grip  = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.085, 0.125), woodMat);
          grip.position.set(0, 0, 0.0625);
          const blade = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.055, 0.375), bladeMat);
          blade.position.set(0, 0, 0.3125);
          g.add(grip, blade);
        }

        g.traverse(m => { if (m.isMesh) m.castShadow = true; });
        return g;
      }

      const toolMeshMap = {
        shovel:  makeToolMesh('shovel'),
        hoe:     makeToolMesh('hoe'),
        machete: makeToolMesh('machete'),
      };

      const toolHolder = new THREE.Group();
      scene.add(toolHolder);
      toolHolder.add(toolMeshMap.shovel);

      // Pre-allocated objects to avoid per-frame GC in updateToolMesh
      const _tUp    = new THREE.Vector3(0, 1, 0);
      const _qFac   = new THREE.Quaternion();  // facing rotation
      const _qAnim  = new THREE.Quaternion();  // animation rotation
      const _swAxis = new THREE.Vector3();     // chop axis (player right in world)

      function updateToolMesh(dt) {
        if (!toolMeshMap[activeTool]) { toolHolder.visible = false; return; }
        toolHolder.visible = true;

        // θ = playerMesh.rotation.y (smooth-lerped facing angle)
        // facing dir in world  = (sin θ,  0, cos θ)
        // player right in world = cross(facing, up) = (-cos θ, 0, sin θ)
        const θ     = playerMesh.rotation.y;
        const rightX = -Math.cos(θ),  rightZ =  Math.sin(θ);
        const fwdX   =  Math.sin(θ),  fwdZ   =  Math.cos(θ);

        // Swing progress 0→1→0 over toolSwingDur
        let progress = 0;
        if (toolSwingT > 0) {
          toolSwingT = Math.max(0, toolSwingT - dt);
          progress   = 1 - toolSwingT / toolSwingDur;
        }
        const swing = Math.sin(progress * Math.PI); // 0 → 1 at mid → 0

        // qFac: facing quaternion (world-Y rotation to match player direction)
        _qFac.setFromAxisAngle(_tUp, θ);
        // _swAxis: player's right-side axis = the chop/tilt axis
        _swAxis.set(rightX, 0, rightZ);

        if (activeTool === 'shovel') {
          // THRUST — hold level with slight downward tilt; translate forward on use.
          // _qAnim rotates around player's right axis in world space (tilt only, no swing).
          _qAnim.setFromAxisAngle(_swAxis, 0.18); // constant slight downward tilt
          toolHolder.quaternion.multiplyQuaternions(_qAnim, _qFac);
          // Forward lunge: translate along facing direction
          toolHolder.position.set(
            playerMesh.position.x + rightX * 0.28 + fwdX * swing * 0.32,
            playerMesh.position.y + 0.05,
            playerMesh.position.z + rightZ * 0.28 + fwdZ * swing * 0.32
          );

        } else if (activeTool === 'hoe') {
          // CHOP — raised high at rest (positive angle = tip up), slams down on use.
          // multiplyQuaternions(qAnim, qFac): first face direction, then tilt in world space
          // around player's right axis => tilt is always relative to facing direction.
          const chopAngle = 0.82 - swing * (Math.PI * 0.84);
          _qAnim.setFromAxisAngle(_swAxis, chopAngle);
          toolHolder.quaternion.multiplyQuaternions(_qAnim, _qFac);
          toolHolder.position.set(
            playerMesh.position.x + rightX * 0.28,
            playerMesh.position.y + 0.05,
            playerMesh.position.z + rightZ * 0.28
          );

        } else if (activeTool === 'machete') {
          // SWEEP — horizontal right-to-left arc around world Y.
          // sweepOff adds extra Y rotation: +0.55 = cocked right, -1.00 = swept left.
          // multiplyQuaternions(qAnim, qFac): qAnim rotates around world Y by sweepOff,
          // which is additive to θ, keeping sweep relative to current facing direction.
          const sweepOff = 0.55 - swing * 1.55;
          _qAnim.setFromAxisAngle(_tUp, sweepOff);
          toolHolder.quaternion.multiplyQuaternions(_qAnim, _qFac);
          toolHolder.position.set(
            playerMesh.position.x + rightX * 0.20 + fwdX * 0.16,
            playerMesh.position.y + 0.05,
            playerMesh.position.z + rightZ * 0.20 + fwdZ * 0.16
          );
        }
      }



      // ── Build/update tile meshes ───────────────────────────────────

      // ── Vegetation slab geometry + wind shader ────────────────────
      const VEG_H = 0.18;  // slab height for shrubs/weeds
      const vegGeo = new THREE.BoxGeometry(0.88, VEG_H, 0.88);

      // Wind vertex shader — displaces top vertices horizontally by sin(time + phase)
      const windVert = `
        uniform float uTime;
        uniform float uPhase;
        uniform float uStrength;
        varying vec3 vNormal;
        varying vec3 vViewPos;
        void main() {
          vNormal = normalMatrix * normal;
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          // Only sway the top half (position.y > 0)
          float topFactor = max(0.0, position.y / ${VEG_H.toFixed(3)});
          float sway = sin(uTime * 1.8 + uPhase) * uStrength * topFactor;
          float sway2 = cos(uTime * 1.2 + uPhase * 1.3) * uStrength * 0.5 * topFactor;
          worldPos.x += sway;
          worldPos.z += sway2;
          vec4 mvPos = viewMatrix * worldPos;
          vViewPos = mvPos.xyz;
          gl_Position = projectionMatrix * mvPos;
        }
      `;
      const windFrag = `
        uniform vec3 uColor;
        varying vec3 vNormal;
        varying vec3 vViewPos;
        void main() {
          vec3 lightDir = normalize(vec3(0.4, 1.0, 0.3));
          float diff = max(dot(normalize(vNormal), lightDir), 0.0) * 0.6 + 0.4;
          gl_FragColor = vec4(uColor * diff, 1.0);
        }
      `;

      // Shared time uniform — updated every frame
      const windUniforms = { uTime: { value: 0 }, uPhase: { value: 0 }, uStrength: { value: 0.04 }, uColor: { value: new THREE.Color(0x247c3c) } };

      function makeVegMaterial(color, phase) {
        return new THREE.ShaderMaterial({
          uniforms: {
            uTime:     { value: 0 },
            uPhase:    { value: phase },
            uStrength: { value: 0.04 },
            uColor:    { value: new THREE.Color(color) },
          },
          vertexShader:   windVert,
          fragmentShader: windFrag,
          side: THREE.DoubleSide,
        });
      }

      // Track all vegetation meshes for wind animation
      const vegMeshes = [];
      // Track foliage-generator groups by tile index for rotation-based sway
      const vegFoliageMeshes = new Array(ROWS * COLS).fill(null);

      // ── Grass billboard system (grass_1.png sprites on GRASS tiles) ─────────
      const grassBillboardGroups = new Array(ROWS * COLS).fill(null);

      function _mbRng(seed) {
        let s = seed >>> 0;
        return () => {
          s += 0x6D2B79F5;
          let t = Math.imul(s ^ (s >>> 15), s | 1);
          t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      }

      // Shared blade geometry: 1×1 PlaneGeometry anchored at Y=0
      const _grassBladeGeo = (() => {
        const g = new THREE.PlaneGeometry(1, 1);
        g.translate(0, 0.5, 0);
        return g;
      })();

      const _grassBillVert = `
        uniform float uTime;
        uniform float uStrength;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          float topFactor = uv.y;
          float phase = worldPos.x * 1.7 + worldPos.z * 2.3;
          float sway  = sin(uTime * 1.8 + phase) * uStrength * topFactor;
          float sway2 = cos(uTime * 1.2 + phase * 1.3) * uStrength * 0.5 * topFactor;
          worldPos.x += sway;
          worldPos.z += sway2;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `;

      const _grassBillFrag = `
        uniform sampler2D uGrassTex;
        uniform vec3 uTint;
        varying vec2 vUv;
        void main() {
          vec4 texel = texture2D(uGrassTex, vUv);
          if (texel.a < 0.5) discard;
          // Treat grass_1.png as mint-toned; desaturate and re-tint to grass color
          float lum = dot(texel.rgb, vec3(0.299, 0.587, 0.114));
          vec3 tinted = uTint * (0.7 + lum * 0.8);
          // Drawn outline pixels (near-black source) stay pure black; tint the rest
          vec3 col = mix(vec3(0.0), tinted, smoothstep(0.0, 0.15, lum));
          gl_FragColor = vec4(col, texel.a);
        }
      `;

      const _grassTint = new THREE.Color().setHSL(108 / 360, 0.58, 0.28);
      let grassBillboardMat = null;

      new THREE.TextureLoader().load('assets/leaves/grass_1.png', (tex) => {
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;
        const sharedUniforms = () => ({
          uGrassTex: { value: tex },
          uTint:     { value: _grassTint },
          uTime:     { value: 0 },
          uStrength: { value: 0.04 },
        });
        grassBillboardMat = new THREE.ShaderMaterial({
          uniforms:       sharedUniforms(),
          vertexShader:   _grassBillVert,
          fragmentShader: _grassBillFrag,
          alphaTest: 0.5, side: THREE.DoubleSide, depthWrite: true,
        });
        // Spawn billboards on GRASS tiles; for WEEDS tiles in Mode A, build now
        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            if (grid[r][c].type === TileType.GRASS) {
              _buildGrassBillboardsForTile(c, r);
            } else if (grid[r][c].type === TileType.WEEDS && !s_weed3D) {
              const i = r * COLS + c;
              if (vegFoliageMeshes[i]) { scene.remove(vegFoliageMeshes[i]); vegFoliageMeshes[i] = null; }
              const grp = _buildWeedBillboardGroup(c, r);
              if (grp) { scene.add(grp); vegFoliageMeshes[i] = grp; }
            }
          }
        }
      });

      function _buildGrassBillboardsForTile(col, row) {
        if (!grassBillboardMat) return;
        const i = row * COLS + col;
        if (grassBillboardGroups[i]) return;
        if (grid[row][col].type !== TileType.GRASS) return;

        const group = new THREE.Group();
        const rand  = _mbRng(((col * 31337 + row * 1009) >>> 0));
        const baseY = tileSurfaceY(TileType.GRASS);

        for (let b = 0; b < 14; b++) {
          const ox  = (rand() - 0.5) * 0.9;
          const oz  = (rand() - 0.5) * 0.9;
          const w   = 0.16 + rand() * 0.10;
          const h   = 0.22 + rand() * 0.14;
          const rot = rand() * Math.PI;

          const cross = new THREE.Group();
          cross.position.set(col + 0.5 + ox, baseY, row + 0.5 + oz);

          const m1 = new THREE.Mesh(_grassBladeGeo, grassBillboardMat);
          m1.scale.set(w, h, 1);
          m1.rotation.y = rot;
          cross.add(m1);

          const m2 = new THREE.Mesh(_grassBladeGeo, grassBillboardMat);
          m2.scale.set(w, h, 1);
          m2.rotation.y = rot + Math.PI * 0.5;
          cross.add(m2);

          group.add(cross);
        }

        group.visible = s_grass;
        scene.add(group);
        grassBillboardGroups[i] = group;
      }

      function _clearGrassBillboards(col, row) {
        const i = row * COLS + col;
        if (grassBillboardGroups[i]) {
          scene.remove(grassBillboardGroups[i]);
          grassBillboardGroups[i] = null;
        }
      }

      // Mode A weeds: oversized grass billboards (2× blade size), same cross
      // layout as GRASS tiles but larger — no outline, no 3D foliage.
      function _buildWeedBillboardGroup(col, row) {
        if (!grassBillboardMat) return null;
        const rand  = _mbRng(((col * 31337 + row * 1009) >>> 0));
        const baseY = tileSurfaceY(TileType.GRASS);

        const group = new THREE.Group();
        for (let b = 0; b < 14; b++) {
          const ox  = (rand() - 0.5) * 0.9;
          const oz  = (rand() - 0.5) * 0.9;
          const w   = 0.32 + rand() * 0.20;  // 2× grass width
          const h   = 0.44 + rand() * 0.28;  // 2× grass height
          const rot = rand() * Math.PI;

          const cross = new THREE.Group();
          cross.position.set(col + 0.5 + ox, baseY, row + 0.5 + oz);

          const m1 = new THREE.Mesh(_grassBladeGeo, grassBillboardMat);
          m1.scale.set(w, h, 1);
          m1.rotation.y = rot;
          cross.add(m1);

          const m2 = new THREE.Mesh(_grassBladeGeo, grassBillboardMat);
          m2.scale.set(w, h, 1);
          m2.rotation.y = rot + Math.PI * 0.5;
          cross.add(m2);

          group.add(cross);
        }
        group._windAmp = 0;
        return group;
      }

      function _rebuildWeedTiles() {
        for (let r = 0; r < ROWS; r++)
          for (let c = 0; c < COLS; c++)
            if (grid[r][c].type === TileType.WEEDS)
              refreshTileMesh(c, r);
      }

      // ── Crop mesh system ──────────────────────────────────────────
      // Needlegrain and heftroot use procedural foliage geometry.
      // All other crops use a simple colored cube (unchanged).
      const CROP_COLORS = {
        needlegrain:   { body: 0x8bc34a, ripe: 0xd4c526, sprout: 0x5a9e30 },
        heftroot:      { body: 0xcaa64a, ripe: 0xf0d15a, sprout: 0x7fae45 },
        garlink:       { body: 0xd8d0b0, ripe: 0xf2ead0, sprout: 0x8bbf6a },
        ongyums:       { body: 0xc07a3d, ripe: 0xe09a4b, sprout: 0x86b95a },
        redberries:    { body: 0xb83b42, ripe: 0xff4f62, sprout: 0x4c9b43 },
        blueberries:   { body: 0x3d62c8, ripe: 0x5f80ff, sprout: 0x4c9b74 },
        yellowberries: { body: 0xd6c345, ripe: 0xffe86a, sprout: 0x7ca84b },
        whiteberries:  { body: 0xdcded2, ripe: 0xffffff, sprout: 0x8bbf8a },
        blackberries:  { body: 0x3d2a52, ripe: 0x17121f, sprout: 0x4d8a4a },
        blackMustard:  { body: 0x4a3b2f, ripe: 0x1f1812, sprout: 0x789b3a },
        greenMustard:  { body: 0x6da64a, ripe: 0x9bd66b, sprout: 0x75b957 },
      };
      const CROP_MAX_SCALE = 0.96;
      const CROP_MIN_SCALE = 0.16;
      const cropMeshes = new Array(ROWS * COLS).fill(null);

      // Tracks which growth bucket (0–3) each foliage crop was built at,
      // so we only rebuild when the plant crosses a threshold.
      const cropGrowthBucket = new Array(ROWS * COLS).fill(-1);

      const FOLIAGE_CROPS = new Set(['needlegrain', 'heftroot']);
      const FG = window.FoliageGenerator;

      function _growthBucket(growth) {
        // Rebuild foliage at 4 thresholds to avoid per-frame rebuilds.
        if (growth < 0.15) return 0;
        if (growth < 0.45) return 1;
        if (growth < 0.80) return 2;
        return 3;
      }

      function _buildFoliageMesh(crop, growth, col, row) {
        if (!FG) return null;
        if (crop === 'needlegrain') return FG.buildNeedlegrainMesh(growth, col, row);
        if (crop === 'heftroot') {
          // Three plants in a triangle cluster, each with a unique seed offset
          const wrapper = new THREE.Group();
          const offsets = [[-0.20, 0, 0.14], [0.22, 0, 0.14], [0.0, 0, -0.22]];
          for (let idx = 0; idx < 3; idx++) {
            const [ox, oy, oz] = offsets[idx];
            const plant = FG.buildHeftrootMesh(growth, col + idx * 127, row + idx * 61);
            plant.position.set(ox, oy, oz);
            plant.scale.setScalar(0.68);
            wrapper.add(plant);
          }
          return wrapper;
        }
        return null;
      }

      function updateCropMeshes() {
        for (let row = 0; row < ROWS; row++) {
          for (let col = 0; col < COLS; col++) {
            const i    = row * COLS + col;
            const tile = grid[row][col];

            if (!tile.crop) {
              if (cropMeshes[i]) { scene.remove(cropMeshes[i]); cropMeshes[i] = null; }
              cropGrowthBucket[i] = -1;
              continue;
            }

            const data   = cropData[tile.crop];
            const growth = Math.min(tile.cropAge / data.growDays, 1.0);
            const surfY  = tileSurfaceY(tile.type) + tile.water * WATER_UNIT;

            if (FOLIAGE_CROPS.has(tile.crop)) {
              // ── Procedural foliage mesh ──────────────────────────────
              const bucket = _growthBucket(growth);
              if (cropMeshes[i] && cropGrowthBucket[i] !== bucket) {
                // Growth crossed a threshold — rebuild.
                scene.remove(cropMeshes[i]);
                cropMeshes[i] = null;
              }
              if (!cropMeshes[i]) {
                const group = _buildFoliageMesh(tile.crop, growth, col, row);
                if (group) {
                  scene.add(group);
                  _markOutline(group);
                  cropMeshes[i]       = group;
                  cropGrowthBucket[i] = bucket;
                }
              }
              const mesh = cropMeshes[i];
              if (!mesh) continue;

              // Scale: foliage group base is at y=0, grows +Y about 0.5 units at full.
              // Map to the same visual range as the old box (0.08..0.48).
              const scale = CROP_MIN_SCALE + (CROP_MAX_SCALE - CROP_MIN_SCALE) * growth;
              mesh.scale.setScalar(scale);

              const bobY = tile.cropReady ? Math.sin(performance.now() / 500 + col + row) * 0.025 : 0;
              mesh.position.set(col + 0.5, surfY + 0.01 + bobY, row + 0.5);
              if (tile.cropReady) mesh.rotation.y = performance.now() / 2200 + col;

            } else {
              // ── Simple colored cube (all other crops) ────────────────
              const colors = CROP_COLORS[tile.crop] || CROP_COLORS.garlink;
              const size   = CROP_MIN_SCALE + (CROP_MAX_SCALE - CROP_MIN_SCALE) * growth;
              const color  = tile.cropReady ? colors.ripe
                           : growth < 0.15  ? colors.sprout
                           : colors.body;

              if (!cropMeshes[i]) {
                const geo  = new THREE.BoxGeometry(1, 1, 1);
                const mat  = new THREE.MeshLambertMaterial({ color });
                const mesh = new THREE.Mesh(geo, mat);
                mesh.castShadow = true;
                scene.add(mesh);
                mesh.layers.enable(1);
                cropMeshes[i] = mesh;
              }

              const mesh = cropMeshes[i];
              mesh.material.color.setHex(color);
              mesh.scale.setScalar(size);
              const bobY = tile.cropReady ? Math.sin(performance.now() / 500 + col + row) * 0.03 : 0;
              mesh.position.set(col + 0.5, surfY + size / 2 + 0.02 + bobY, row + 0.5);
              if (tile.cropReady) mesh.rotation.y = performance.now() / 1200 + col;
            }
          }
        }
      }

      // Update a single tile mesh (called after shovel actions)
      function _buildOneTileMesh(col, row) {
        const i    = row * COLS + col;
        const tile = grid[row][col];
        const mat  = tileMats[tile.type] || tileMats.grass;

        if (tile.type === TileType.ROCK) {
          // Floor slab — grass so it blends with surrounding tiles
          const floorMesh = new THREE.Mesh(makeFloorGeo(col, row), tileMats.grass);
          floorMesh.castShadow = floorMesh.receiveShadow = true;
          floorMesh.position.set(col + 0.5, NORMAL_TOP - SLAB_H / 2, row + 0.5);
          scene.add(floorMesh);
          tileMeshes[i] = floorMesh;
          // Plateau mound: stone for elevated/cliff cells, grass for ground-level base
          const { stoneGeo, grassGeo } = buildRockTileGeo(col, row);
          let moundRoot = null;
          if (stoneGeo) {
            const m = new THREE.Mesh(stoneGeo, tileMats.rock);
            m.castShadow = m.receiveShadow = true;
            m.position.set(col + 0.5, NORMAL_TOP, row + 0.5);
            scene.add(m);
            moundRoot = m;
          }
          if (grassGeo) {
            const m = new THREE.Mesh(grassGeo, tileMats.grass);
            m.castShadow = m.receiveShadow = true;
            m.position.set(col + 0.5, NORMAL_TOP, row + 0.5);
            scene.add(m);
            if (!moundRoot) moundRoot = m;
          }
          if (moundRoot) moundRoot._windAmp = 0;  // wind loop skips _windAmp=0
          vegFoliageMeshes[i] = moundRoot || { _windAmp: 0 };
          _markOutline(moundRoot);
          return;
        }

        if (tile.type === TileType.SHRUB && window.FoliageGenerator) {
          // Grass floor slab underneath the shrub
          const floorMesh = new THREE.Mesh(makeFloorGeo(col, row), vegFloorMat);
          floorMesh.castShadow = floorMesh.receiveShadow = true;
          floorMesh.position.set(col + 0.5, tileYCenter(TileType.GRASS), row + 0.5);
          scene.add(floorMesh);
          tileMeshes[i] = floorMesh;

          const vegGroup = window.FoliageGenerator.buildShrubMesh(col, row);
          vegGroup._windPhase = (col * 1.7 + row * 2.3) % (Math.PI * 2);
          vegGroup._windAmp   = 0.06;
          vegGroup.scale.set(2, 2, 2);
          vegGroup.position.set(col + 0.5, tileSurfaceY(tile.type), row + 0.5);
          scene.add(vegGroup);
          vegFoliageMeshes[i] = vegGroup;
          _markOutline(vegGroup);
          return;
        }

        if (tile.type === TileType.WEEDS) {
          // Grass floor slab underneath
          const floorMesh = new THREE.Mesh(makeFloorGeo(col, row), vegFloorMat);
          floorMesh.castShadow = floorMesh.receiveShadow = true;
          floorMesh.position.set(col + 0.5, tileYCenter(TileType.GRASS), row + 0.5);
          scene.add(floorMesh);
          tileMeshes[i] = floorMesh;

          if (!s_weed3D) {
            // Mode A: oversized grass billboards (deferred if texture not yet loaded)
            const grp = _buildWeedBillboardGroup(col, row);
            if (grp) { scene.add(grp); vegFoliageMeshes[i] = grp; }
          } else if (window.FoliageGenerator) {
            // Mode B: procedural 3D weeds, subject to shell outline
            const vegGroup = new THREE.Group();
            vegGroup.position.set(col + 0.5, tileSurfaceY(tile.type), row + 0.5);
            const rng   = _mbRng(((col * 31337 + row * 1009) >>> 0));
            const count = 3 + ((col * 7 + row * 13) % 3);  // 3–5 plants
            for (let p = 0; p < count; p++) {
              const wm = window.FoliageGenerator.buildWeedsMesh(col * 50 + p, row * 50 + p);
              if (wm) {
                wm.position.set((rng() - 0.5) * 0.8, 0, (rng() - 0.5) * 0.8);
                vegGroup.add(wm);
              }
            }
            vegGroup._windPhase = (col * 1.7 + row * 2.3) % (Math.PI * 2);
            vegGroup._windAmp   = 0.10;
            scene.add(vegGroup);
            vegFoliageMeshes[i] = vegGroup;
            _markOutline(vegGroup);
          }
          return;
        }

        if (tile.type === TileType.TRENCH || tile.type === TileType.RAISED) {
          const { dirtGeo, grassGeo } = buildTerrainTileGeo(col, row, tile.type);
          let primary = null;
          if (dirtGeo) {
            // Both types use trench brown — raised earth is the same dug-soil colour
            const m = new THREE.Mesh(dirtGeo, tileMats.trench);
            m.castShadow = m.receiveShadow = true;
            m.position.set(col + 0.5, NORMAL_TOP, row + 0.5);
            scene.add(m);
            m.layers.enable(1);  // material transition outline
            primary = m;
          }
          if (grassGeo) {
            const m = new THREE.Mesh(grassGeo, tileMats.grass);
            m.castShadow = m.receiveShadow = true;
            m.position.set(col + 0.5, NORMAL_TOP, row + 0.5);
            m._windAmp = 0;
            scene.add(m);
            m.layers.enable(1);  // material transition outline
            vegFoliageMeshes[i] = m;
            if (!primary) primary = m;
          }
          tileMeshes[i] = primary;
          return;
        }

        let mesh;
        if (tile.type === TileType.SHRUB || tile.type === TileType.WEEDS) {
          // Fallback: foliage generator not available
          const phase = (col * 1.7 + row * 2.3) % (Math.PI * 2);
          const color = tile.type === TileType.SHRUB ? 0x356e36 : 0x247c3c;
          mesh = new THREE.Mesh(vegGeo, makeVegMaterial(color, phase));
          vegMeshes.push(mesh);
        } else {
          mesh = new THREE.Mesh(tile.type === TileType.ROCK ? rockGeo : makeFloorGeo(col, row), mat);
        }
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.position.set(col + 0.5, tileYCenter(tile.type), row + 0.5);
        scene.add(mesh);
        tileMeshes[i] = mesh;
        // Rock and fallback vegetation get outlines; flat floor tiles do not.
        if (tile.type === TileType.ROCK || tile.type === TileType.SHRUB || tile.type === TileType.WEEDS) {
          mesh.layers.enable(1);
        }
        if (tile.type === TileType.GRASS) _buildGrassBillboardsForTile(col, row);
      }

      function buildTileMeshes() {
        for (let row = 0; row < ROWS; row++) {
          for (let col = 0; col < COLS; col++) {
            const i = row * COLS + col;
            if (tileMeshes[i])          { scene.remove(tileMeshes[i]);          tileMeshes[i]          = null; }
            if (waterMeshes[i])         { scene.remove(waterMeshes[i]);         waterMeshes[i]         = null; }
            if (cropMeshes[i])          { scene.remove(cropMeshes[i]);          cropMeshes[i]          = null; }
            if (vegFoliageMeshes[i])    { scene.remove(vegFoliageMeshes[i]);    vegFoliageMeshes[i]    = null; }
            if (grassBillboardGroups[i]){ scene.remove(grassBillboardGroups[i]); grassBillboardGroups[i] = null; }
            cropGrowthBucket[i] = -1;
            _buildOneTileMesh(col, row);
          }
        }
      }

      // Update a single tile mesh (called after shovel actions)
      function refreshTileMesh(col, row) {
        const i = row * COLS + col;
        if (tileMeshes[i])          { scene.remove(tileMeshes[i]);          tileMeshes[i]          = null; }
        if (waterMeshes[i])         { scene.remove(waterMeshes[i]);         waterMeshes[i]         = null; }
        if (cropMeshes[i])          { scene.remove(cropMeshes[i]);          cropMeshes[i]          = null; }
        if (vegFoliageMeshes[i])    { scene.remove(vegFoliageMeshes[i]);    vegFoliageMeshes[i]    = null; }
        _clearGrassBillboards(col, row);
        cropGrowthBucket[i] = -1;
        _buildOneTileMesh(col, row);
      }

      // ── Update water meshes each frame ─────────────────────────────
      function updateWaterMeshes() {
        waterTime += 0.016; // ~60fps accumulation; matches visual speed regardless of frame rate
        for (let row = 0; row < ROWS; row++) {
          for (let col = 0; col < COLS; col++) {
            const i    = row * COLS + col;
            const tile = grid[row][col];

            if (isSolid(tile.type) || tile.water < 0.003) {
              if (waterMeshes[i]) { scene.remove(waterMeshes[i]); waterMeshes[i] = null; }
              continue;
            }

            const depthFrac = tile.water / MAX_WATER;
            const surfaceA  = tileSurfaceY(tile.type) + tile.water * WATER_UNIT;

            // ── Compute flow direction from surface-height gradient ──
            // Check each cardinal neighbour: flow goes toward lowest surface
            let fx = 0, fz = 0;
            const nbrs = [
              { dc:  0, dr:  1, ax: 0, az:  1 },
              { dc:  0, dr: -1, ax: 0, az: -1 },
              { dc:  1, dr:  0, ax: 1, az:  0 },
              { dc: -1, dr:  0, ax: -1,az:  0 },
            ];
            for (const { dc, dr, ax, az } of nbrs) {
              const nc = col + dc, nr = row + dr;
              if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue;
              const nt = grid[nr][nc];
              if (isSolid(nt.type)) continue;
              const surfB = tileSurfaceY(nt.type) + nt.water * WATER_UNIT;
              const head  = surfaceA - surfB;
              if (head > 0.01) { fx += ax * head; fz += az * head; }
            }
            const flowLen = Math.hypot(fx, fz);
            const flowNX  = flowLen > 0.001 ? fx / flowLen : 0;
            const flowNZ  = flowLen > 0.001 ? fz / flowLen : 0;

            // Colour: pale cyan → deep blue with depth
            const r = clamp(180 - depthFrac * 160, 20, 180) / 255;
            const g = clamp(220 - depthFrac * 100, 100, 220) / 255;
            const b = 1.0;

            if (!waterMeshes[i]) {
              const wm = new THREE.Mesh(waterGeo, makeWaterMaterial(col, row));
              wm.receiveShadow = false;
              scene.add(wm);
              waterMeshes[i] = wm;
            }
            const wm = waterMeshes[i];
            wm.position.set(col + 0.5, surfaceA + 0.015, row + 0.5);

            // Update shader uniforms
            const u = wm.material.uniforms;
            u.uTime.value  = waterTime;
            u.uDepth.value = depthFrac;
            u.uFlow.value.set(flowNX, flowNZ);
            u.uColor.value.setRGB(r, g, b);
          }
        }
      }

      // ── Update player cube ────────────────────────────────────────
      function updatePlayerMesh(dt) {
        // Convert 2D grid coords to 3D world coords
        const wx = player.x / TILE;  // world X (col)
        const wz = player.y / TILE;  // world Z (row)
        const col = clamp(Math.floor(wx), 0, getActiveCols()-1);
        const row = clamp(Math.floor(wz), 0, getActiveRows()-1);
        const tile = getActiveTileAt(col, row);
        const standY = tileSurfaceY(tile.type);

        // Smooth vertical position (bob over water)
        const targetY = standY + (tile.water > 0.05 ? tile.water * WATER_UNIT * 0.6 : 0);
        playerMesh.position.x += (wx - playerMesh.position.x) * 0.25;
        playerMesh.position.z += (wz - playerMesh.position.z) * 0.25;
        playerMesh.position.y += (targetY - playerMesh.position.y) * 0.18;

        // Rotate to face movement direction with perp clamp (dead zone ±15° from east/west).
        if (!player.perpState) player.perpState = {};
        const rawTargetRotY = -facingAngle + Math.PI / 2;
        const { effectiveTarget: pEffTarget, snapTo: pSnapTo } = perpClamp(player.perpState, rawTargetRotY, [Math.PI / 2, -Math.PI / 2]);
        if (pSnapTo !== null) playerMesh.rotation.y = pEffTarget;
        else playerMesh.rotation.y += angleDiff(pEffTarget, playerMesh.rotation.y) * 0.18;

        // Bob animation when moving
        const speed = Math.hypot(player.vx, player.vy);
        if (speed > 5) {
          playerMesh.position.y += Math.sin(performance.now() / 120) * 0.03;
        }
      }

      // ── Update reticle ────────────────────────────────────────────
      function updateReticleMesh() {
        const reticle  = getReticleTile();
        const tile     = grid[reticle.row][reticle.col];
        const surfY    = tileSurfaceY(tile.type) + 0.01
                       + (tile.water > 0.02 ? tile.water * WATER_UNIT + 0.04 : 0);
        const allowed  = canUseAction(activeTool, activeAction, reticle.col, reticle.row);
        reticleMesh.position.set(reticle.col + 0.5, surfY, reticle.row + 0.5);
        reticleMesh.material = allowed ? reticleMat : reticleBlockedMat;
        // Pulse scale
        const pulse = 1 + 0.06 * Math.sin(performance.now() / 300);
        reticleMesh.scale.set(pulse, 1, pulse);
      }

      // ── Update lighting from time-of-day ──────────────────────────
      function updateThreeLighting() {
        const { r, g, b, a } = getLightingState();
        // Ambient: dimmer at night, brighter at noon
        const brightnessMul = 1 - a * 0.7;
        ambientLight.intensity = 0.3 + brightnessMul * 0.7;
        ambientLight.color.setRGB(
          (r/255) * 0.6 + 0.4,
          (g/255) * 0.6 + 0.4,
          (b/255) * 0.6 + 0.4
        );
        sunLight.intensity = brightnessMul * 1.2;
        sunLight.color.setRGB(r/255 * 0.5 + 0.5, g/255 * 0.5 + 0.5, b/255 * 0.4 + 0.6);
        // Fog colour matches sky
        scene.background.setRGB(
          Math.max(0, r/255 * 0.15 + 0.04),
          Math.max(0, g/255 * 0.15 + 0.08),
          Math.max(0, b/255 * 0.15 + 0.06)
        );
        scene.fog.color.copy(scene.background);
      }

      // ── Resize handler ────────────────────────────────────────────
      function resizeCanvas() {
        const dpr  = Math.min(window.devicePixelRatio, 2);
        const rect = threeContainer.getBoundingClientRect();
        const w = rect.width  || window.innerWidth;
        const h = rect.height || window.innerHeight;
        renderer.setSize(w, h);
        overlayCanvas.width  = Math.round(w * dpr);
        overlayCanvas.height = Math.round(h * dpr);
        octx.setTransform(dpr, 0, 0, dpr, 0, 0);
        lightingCanvas.width  = Math.round(w * dpr);
        lightingCanvas.height = Math.round(h * dpr);
        lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }

      // ── Visual feature toggles (Settings tab) ────────────────────
      let s_outlines  = true;
      let s_grass     = false;
      let s_weed3D    = false;  // false = Mode A (oversized billboards), true = Mode B (3D foliage)
      let s_billWind  = true;

      buildTileMeshes();
      buildBorderTerrain();

      // ── Settings tab checkbox wiring ──────────────────────────────
      document.getElementById('settingOutlines').addEventListener('change', e => {
        s_outlines = e.target.checked;
      });
      document.getElementById('settingGrass').addEventListener('change', e => {
        s_grass = e.target.checked;
        for (const g of grassBillboardGroups) if (g) g.visible = s_grass;
      });
      document.getElementById('settingBillWind').addEventListener('change', e => {
        s_billWind = e.target.checked;
      });
      document.getElementById('settingWeed3D').addEventListener('change', e => {
        s_weed3D = e.target.checked;
        _rebuildWeedTiles();
      });

      function gameLoop(now) {
        const dt = Math.min(0.04, (now - lastTime) / 1000);
        lastTime = now;

        if (!gameStarted) {
          renderer.render(scene, camera);
          requestAnimationFrame(gameLoop);
          return;
        }

        updateSceneTransition(dt);

        if (!paused) {
          updateCalendar(dt);
          updateMovement(dt);

          // Interior exit detection: player walks south through exit door
          if (currentArea === 'interior' && sceneTransDir === 0) {
            const iyTile = player.y / TILE;
            const ixTile = player.x / TILE;
            if (iyTile > INTERIOR_EXIT_ROW + 0.4 && ixTile > INTERIOR_EXIT_COL - 0.2 && ixTile < INTERIOR_EXIT_COL + 2.2) {
              exitInterior();
            }
          }

          if (currentArea === 'farm') {
            waterFlowPhase = (waterFlowPhase + dt * 3.2) % 1;
            updateWaterParticles(dt);
            updateRipples(dt);
            updateLightningFlash(dt);
          }
          updateActionParticles(dt);
          // Water sim ticks every 1/8 game-hour (~9s real-time)
          // Uses game time so rain and drainage are clock-consistent
          simAccumulator += dt / DAY_LENGTH_SECONDS * (NIGHT_HOUR - MORNING_HOUR); // game-hours per sec
          if (simAccumulator >= 0.125 && currentArea === 'farm') {
            simAccumulator -= 0.125;
            recomputeWater(false);
            spawnRipples();
            tickWorldObjects();
          }
        }

        // ── Camera smooth follow ─────────────────────────────────
        const wx = player.x / TILE, wz = player.y / TILE;
        camTargetX += (wx - camTargetX) * 0.08;
        camTargetZ += (wz - camTargetZ) * 0.08;
        updateCameraPosition();

        // ── Three.js updates ─────────────────────────────────────
        updatePlayerMesh(dt);
        if (currentArea === 'farm') {
          updateWaterMeshes();
          updateCropMeshes();
          updateAnimalMeshes(dt);
          updateToolMesh(dt);
          updateReticleMesh();
          updateThreeLighting();

          // Wind animation on vegetation
          const windTime = performance.now() / 1000;
          const windStrBase = calendar.isRaining
            ? (calendar.rainStrength >= 3 ? 0.10 : 0.06)
            : 0.03;
          for (const vm of vegMeshes) {
            if (vm.material && vm.material.uniforms) {
              vm.material.uniforms.uTime.value = windTime;
              const dx = vm.position.x - player.x / TILE;
              const dz = vm.position.z - player.y / TILE;
              const dist = Math.hypot(dx, dz);
              const proximityStr = dist < 1.2 ? windStrBase + 0.12 * (1.2 - dist) / 1.2 : windStrBase;
              vm.material.uniforms.uStrength.value += (proximityStr - vm.material.uniforms.uStrength.value) * 0.15;
            }
          }
          const windScale = windStrBase / 0.03;
          for (const fg of vegFoliageMeshes) {
            if (!fg || !fg._windAmp) continue;
            const amp = fg._windAmp * windScale;
            fg.rotation.z = amp * Math.sin(windTime * 1.6 + fg._windPhase);
            fg.rotation.x = amp * 0.45 * Math.cos(windTime * 1.1 + fg._windPhase * 1.3);
          }
          if (grassBillboardMat) {
            grassBillboardMat.uniforms.uTime.value     = windTime;
            grassBillboardMat.uniforms.uStrength.value = s_billWind ? windStrBase : 0;
          }
        }

        // ── Render active scene ──────────────────────────────────
        const activeScene = currentArea === 'interior' ? interiorScene : scene;
        renderer.render(activeScene, camera);
        // Selective shell outline pass (layer-1 objects only)
        if (s_outlines) {
          const _outlineScene = currentArea === 'interior' ? interiorScene : scene;
          renderer.autoClearColor = false;
          renderer.autoClearDepth = false;
          _outlineScene.overrideMaterial = shellOutlineMat;
          camera.layers.set(1);
          renderer.render(_outlineScene, camera);
          camera.layers.enableAll();
          _outlineScene.overrideMaterial = null;
          renderer.autoClearColor = true;
          renderer.autoClearDepth = true;
        }

        // ── 2D overlays (rain, lighting) ─────────────────────────
        drawOverlays();
        drawLightingOverlay();

        updateHud();
        requestAnimationFrame(gameLoop);
      }

      // ── 2D overlay draw (rain curtain + ripples on overlay canvas) ─
      function drawOverlays() {
        const rect = threeContainer.getBoundingClientRect();
        const W = rect.width, H = rect.height;
        octx.clearRect(0, 0, W, H);

        if (currentArea === 'interior') {
          drawActionParticles();
          return;
        }

        if (calendar.isRaining) {
          const str = calendar.rainStrength || 1;
          const isStorm = str >= 3;
          const t = waterFlowPhase;

          // Mist
          octx.fillStyle = isStorm ? 'rgba(30,50,80,0.10)' : 'rgba(60,80,100,0.05)';
          octx.fillRect(0, 0, W, H);

          const layers = isStorm
            ? [{a:0.14,w:1.0,sp:22,len:22,spd:1.0,sl:-9},{a:0.22,w:1.5,sp:14,len:30,spd:1.5,sl:-12}]
            : [{a:0.07,w:0.8,sp:28,len:16,spd:0.7,sl:-6},{a:0.12,w:1.2,sp:20,len:22,spd:1.0,sl:-9}];

          for (const l of layers) {
            octx.globalAlpha = l.a;
            octx.strokeStyle = '#cce8ff';
            octx.lineWidth = l.w;
            const ph = (t * l.spd * 40) % l.sp;
            for (let gx = -40; gx < W+60; gx += l.sp) {
              for (let gy = -60; gy < H+80; gy += l.sp*2.2) {
                const rx = gx + ((gy/11) % l.sp);
                const ry = (gy + ph) % (H+80) - 40;
                octx.beginPath(); octx.moveTo(rx, ry); octx.lineTo(rx+l.sl, ry+l.len); octx.stroke();
              }
            }
          }
          octx.globalAlpha = 1;
        }

        drawWeaponTrailEffects();
        drawActionTileEffects();
        drawActionParticles();

        if (lightningAlpha > 0) {
          octx.fillStyle = `rgba(220,240,255,${lightningAlpha * 0.35})`;
          octx.fillRect(0, 0, W, H);
        }
      }

      function markTileDirty(col, row) {
        refreshTileMesh(col, row);
        // TRENCH/RAISED shape depends on which neighbors share their type, so any
        // change that could alter those connections must also refresh those neighbors.
        for (const [dc, dr] of [[0,-1],[0,1],[-1,0],[1,0]]) {
          const nt = grid[row + dr]?.[col + dc]?.type;
          if (nt === TileType.TRENCH || nt === TileType.RAISED)
            refreshTileMesh(col + dc, row + dr);
        }
      }

      function updateCalendar(dt) {

        const previousHour = getHour();
        calendar.time01 += dt / DAY_LENGTH_SECONDS;
        if (calendar.time01 >= 1) {
          calendar.time01 -= 1;
          advanceDay();
        }
        const currentHour = getHour();
        if (Math.floor(previousHour) !== Math.floor(currentHour)) {
          updateRainState();
          if (Math.floor(currentHour) === MORNING_HOUR) { tickCropDay(); checkForMajorStorm(); worldObjectMorningTick(); }
        }
      }

      function advanceDay() {
        calendar.day += 1;
        chooseWeatherForDay();
        tickCropDay();
        lastActionMessage = `Day ${calendar.day} begins: ${calendar.weather}.`;
      }

      function chooseWeatherForDay() {
        const season = currentSeason();
        const seed = seededRandom(calendar.day * 991 + season.name.length * 37);
        const stormRoll = seededRandom(calendar.day * 373 + 11);
        const hasStorm = stormRoll < season.stormChance;
        const hasRain = hasStorm || seed < season.rainChance;
        calendar.weather = hasStorm ? 'storm' : hasRain ? 'rain' : 'clear';
        calendar.nextRainWindows = [];

        if (hasStorm) {
          calendar.nextRainWindows.push({ start: 11, end: 17, strength: 3 });
          calendar.nextRainWindows.push({ start: 19, end: 21, strength: 2 });
        } else if (hasRain) {
          const start = 8 + Math.floor(seededRandom(calendar.day * 157) * 6);
          calendar.nextRainWindows.push({ start, end: start + 5, strength: 2 });
        }
        updateRainState();
      }

      function updateRainState() {
        const hour = getHour();
        const activeWindow = calendar.nextRainWindows.find((window) => hour >= window.start && hour < window.end);
        calendar.isRaining = Boolean(activeWindow);
        calendar.rainStrength = activeWindow ? activeWindow.strength : 0;
      }

      function tickCropDay() {
        for (let row = 0; row < ROWS; row++) {
          for (let col = 0; col < COLS; col++) {
            const tile = grid[row][col];
            if (!tile.crop) continue;
            const data = cropData[tile.crop];
            const mul = cropGrowthMultiplier(tile, col, row);
            const ditchStress = data.needsAdjacentDitch && !hasAdjacentDitch(col, row) ? 'needs ditch' : '';
            tile.stress = ditchStress || (mul < 0.15 ? (tile.water < data.idealMin ? 'too dry' : 'waterlogged')
                        : mul < 0.6  ? (tile.water < data.idealMin ? 'dry'     : 'too wet')
                        : '');
            tile.cropAge += mul;
            tile.cropReady = tile.cropAge >= data.growDays;
          }
        }
      }

      // Returns 0..1 growth rate based on how close tile.water is to crop ideal band.
      function canPlantCropOnTile(crop, tile) {
        if (!cropData[crop]) return false;
        return [TileType.TILLED, TileType.RAISED].includes(tile.type) && !tile.crop;
      }

      function hasAdjacentDitch(col, row) {
        return cardinalNeighbors(col, row).some(point => grid[point.row][point.col].type === TileType.TRENCH);
      }

      function cropGrowthMultiplier(tile, col, row) {
        if (!tile.crop) return 0;
        const data = cropData[tile.crop];
        const { idealMin, idealMax } = data;
        const w = tile.water / MAX_WATER;
        let waterMul;
        if (w >= idealMin && w <= idealMax) waterMul = 1.0;
        else if (w < idealMin) waterMul = Math.max(0, (w - (idealMin - 0.4)) / 0.4);
        else waterMul = Math.max(0, ((idealMax + 0.4) - w) / 0.4);
        const ditchMul = data.needsAdjacentDitch && !hasAdjacentDitch(col, row) ? 0.65 : 1.0;
        return waterMul * ditchMul;
      }

      // ═══════════════════════════════════════════════════════════════
      //  WATER SIMULATION
      //  Model: each tile has a float `water` = depth above its floor.
      //  Floor Z: RAISED=+1, normal=0, TRENCH=-1, ROCK/SHRUB=solid (no flow).
      //  Water surface = floorZ(type) + water.
      //  Each sim tick (called from gameLoop ~every 0.7s):
      //    1. Rain adds depth to every non-solid tile.
      //    2. Soil absorption drains a small amount.
      //    3. Cross-tile flow: water moves from high-surface to low-surface
      //       neighbours, south-biased, half-difference per tick.
      //       Trenches pull with TRENCH_FLOW_BONUS multiplier.
      //    4. Overflow: any water above MAX_WATER is shed to neighbours.
      // ═══════════════════════════════════════════════════════════════

      function recomputeWater(decayOnly, targetGrid = grid) {
        const str = calendar.rainStrength || 1;
        const isRaining = calendar.isRaining && !decayOnly;

        // Pass 1: rain + absorption + evaporation + south-edge runoff
        for (let row = 0; row < ROWS; row++) {
          for (let col = 0; col < COLS; col++) {
            const t = targetGrid[row][col];
            if (isSolid(t.type)) continue;
            t.flow = false;

            if (isRaining) {
              const rainMul = t.type === TileType.TRENCH ? 2.0
                            : t.type === TileType.PADDY  ? 1.4 : 1.0;
              t.water += RAIN_RATE * str * rainMul;
            }

            // Soil absorption
            const absorb = ABSORB_RATE[t.type] ?? 0.012;
            t.water = Math.max(0, t.water - absorb);

            // Evapotranspiration — slow background loss on all tiles
            t.water = Math.max(0, t.water - EVAP_RATE);

            // South-edge runoff — bottom 2 rows drain aggressively (gravity outlet)
            if (row >= ROWS - 2) {
              const runoffRate = row === ROWS - 1 ? 0.08 : 0.03;
              t.water = Math.max(0, t.water - runoffRate);
            }

            t.water = Math.min(MAX_WATER, t.water);
          }
        }

        // Pass 2: cross-tile flow — process south→north for southward bias
        const dirs = [
          { dc:  0, dr:  1 },  // south
          { dc:  1, dr:  0 },  // east
          { dc: -1, dr:  0 },  // west
          { dc:  0, dr: -1 },  // north
        ];

        for (let row = ROWS - 1; row >= 0; row--) {
          for (let col = 0; col < COLS; col++) {
            const t = targetGrid[row][col];
            if (isSolid(t.type) || t.water <= 0) continue;

            let surfA = floorZ(t.type) + t.water;

            for (const { dc, dr } of dirs) {
              const nc = col + dc, nr = row + dr;
              if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue;
              const n = targetGrid[nr][nc];
              if (isSolid(n.type)) continue;

              const surfB = floorZ(n.type) + n.water;
              const head  = surfA - surfB;
              if (head <= 0.001) continue;

              const bonus = (n.type === TileType.TRENCH) ? TRENCH_FLOW_BONUS : 1.0;
              let transfer = Math.min(head * FLOW_RATE * bonus * 0.5, t.water);
              transfer = Math.min(transfer, MAX_WATER - n.water);
              if (transfer <= 0) continue;

              t.water -= transfer;
              n.water += transfer;
              surfA = floorZ(t.type) + t.water; // update after transfer
              if (n.type === TileType.TRENCH) n.flow = true;
              if (t.type === TileType.TRENCH) t.flow = true;
              // Don't break — allow multiple transfers per tick for faster spread
            }
          }
        }

        // Pass 3: clamp
        for (let row = 0; row < ROWS; row++) {
          for (let col = 0; col < COLS; col++) {
            const t = targetGrid[row][col];
            t.water = clamp(t.water, 0, MAX_WATER);
          }
        }
      }

      function trenchNeighbors(col, row) {
        // Used by water routing: south is first to preserve the visible north-to-south bias.
        return [
          { col, row: row + 1 },
          { col: col - 1, row },
          { col: col + 1, row },
          { col, row: row - 1 }
        ].filter(isInsideGrid);
      }

      function cardinalNeighbors(col, row) {
        return [
          { col, row: row - 1 },
          { col: col + 1, row },
          { col, row: row + 1 },
          { col: col - 1, row }
        ].filter(isInsideGrid);
      }

      function isInsideGrid(point) {
        return point.col >= 0 && point.col < COLS && point.row >= 0 && point.row < ROWS;
      }

      function setActiveTool(tool) {
        activeTool = tool;
        const actions = toolActions[tool];
        if (!actions.includes(activeAction)) activeAction = actions[0];
        const info = { shovel:['🥄','Shovel'], hoe:['🪓','Hoe'], machete:['🗡️','Blade'] }[tool] || ['🔧',tool];
        toolBtnIcon.textContent  = info[0];
        toolBtnLabel.textContent = info[1];
        toolPickBtns.forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
        // Swap visible tool mesh
        Object.values(toolMeshMap).forEach(m => toolHolder.remove(m));
        if (toolMeshMap[tool]) toolHolder.add(toolMeshMap[tool]);
        closeToolPicker();
        refreshActionBar();
        const msg = `${toolName(tool)} selected.`;
        lastActionMessage = msg;
        showToast(msg, true);
      }

      function setActiveAction(action) {
        activeAction = action;
        refreshActionBar();
        useActiveAction();
      }

      // ── Tool picker open/close ─────────────────────────────
      let toolPickerOpen = false;
      function openToolPicker() {
        toolPickerOpen = true;
        toolPicker.classList.add('open');
        toolBtn.setAttribute('aria-expanded', 'true');
        toolBtn.style.borderColor = 'rgba(249,226,138,0.6)';
      }
      function closeToolPicker() {
        toolPickerOpen = false;
        toolPicker.classList.remove('open');
        toolBtn.setAttribute('aria-expanded', 'false');
        toolBtn.style.borderColor = '';
      }
      toolBtn.addEventListener('click', () => toolPickerOpen ? closeToolPicker() : openToolPicker());
      toolPickBtns.forEach(b => b.addEventListener('click', () => setActiveTool(b.dataset.tool)));
      document.addEventListener('pointerdown', (e) => {
        if (toolPickerOpen && !toolSelect.contains(e.target)) closeToolPicker();
      }, { capture: true });

      // ── Action bar update ──────────────────────────────────
      // ── Dynamic action stack ────────────────────────────────────────
      // Computes the full list of buttons to show, then rebuilds the DOM rows.
      // Buttons are packed into rows of 1, 2, 1, 2... (hex packing).
      // Each button: { icon, label, action, style, allowed }


      function computeActionButtons() {
        // Interior: only show exit button near the south door
        if (currentArea === 'interior') {
          const reticle = getReticleTile();
          const nearExit = reticle.row >= INTERIOR_EXIT_ROW && reticle.col >= INTERIOR_EXIT_COL && reticle.col < INTERIOR_EXIT_COL + 2;
          return nearExit
            ? [{ icon: '🚪', label: 'Exit House', action: 'obj_exit_house', style: 'primary', allowed: true }]
            : [];
        }

        const reticle = getReticleTile();
        const tile    = grid[reticle.row][reticle.col];
        const btns    = [];

        // 0. World object at reticle — its buttons take priority
        const obj = getWorldObjectAt(reticle.col, reticle.row);
        if (obj) {
          const objBtns = obj.getButtons(reticle);
          objBtns.forEach(b => btns.push(b));
        }

        // 1. Tool's own actions
        const actions = toolActions[activeTool] || [];
        actions.forEach((action, i) => {
          const [icon] = actionLabels[action];
          const allowed = canUseAction(activeTool, action, reticle.col, reticle.row);
          btns.push({
            icon, label: contextualActionLabel(action, tile),
            action, style: i === 0 ? 'primary' : 'secondary', allowed,
          });
        });

        // 2. Context: Plant button if selected item is a seed and tile can accept it
        const item = getActiveInventoryItem();
        if (item && item.seedFor) {
          const cropName  = item.seedFor;
          const plantAct  = 'plant_' + cropName;
          const count     = inventory[item.key] || 0;
          const canPlant  = count > 0 && canPlantCropOnTile(cropName, tile);
          btns.push({
            icon: item.icon, label: count > 0 ? `Plant (${count})` : 'No seeds',
            action: plantAct, style: 'plant', allowed: canPlant,
          });
        }

        if (item) {
          const furnitureKey = getFurnitureKeyByItemKey(item.key);
          if (furnitureKey) {
            const count = inventory[item.key] || 0;
            btns.push({
              icon: item.icon,
              label: count > 0 ? `Place (${count})` : 'No furniture',
              action: 'place_' + furnitureKey,
              style: 'plant',
              allowed: count > 0 && canPlaceFurnitureAt(reticle.col, reticle.row),
            });
          }
          if (item.key === 'uumkaoiiCrate') {
            const count = inventory.uumkaoiiCrate || 0;
            btns.push({
              icon: '🦆',
              label: count > 0 ? `Release (${count})` : 'No crate',
              action: 'spawn_uumkaoii',
              style: 'plant',
              allowed: count > 0 && canSpawnAnimalAt(reticle.col, reticle.row),
            });
          }
        }

        // 3. Context: Harvest button if reticled tile has a ready crop
        if (tile.crop) {
          const data = cropData[tile.crop];
          btns.push({
            icon: tile.cropReady ? data.emoji : '🌱',
            label: tile.cropReady ? '✓ Harvest' : `${tile.crop} (${Math.floor(tile.cropAge)}d)`,
            action: 'harvest', style: tile.cropReady ? 'harvest' : 'secondary',
            allowed: tile.cropReady,
          });
        }

        return btns;
      }

      // Track last state to avoid rebuilding the stack every frame
      let _lastBarKey = '';

      function refreshActionBar() {
        const reticle = getReticleTile();
        const tile    = getActiveTileAt(reticle.col, reticle.row);

        const obj = currentArea === 'farm' ? getWorldObjectAt(reticle.col, reticle.row) : null;
        const key = `${currentArea}|${activeTool}|${activeItemIndex}|${reticle.col},${reticle.row}|${tile.type}|${tile.crop}|${tile.cropReady}|${obj ? obj.id : 'none'}|${processingFurnitureObjects.size}|${animalObjects.size}`;
        const needsRebuild = key !== _lastBarKey;
        _lastBarKey = key;

        const btns = computeActionButtons();

        // Update activeAction even without DOM rebuild
        const first = btns.find(b => b.allowed) || btns[0];
        if (first) activeAction = first.action;

        if (!needsRebuild) return;

        // Split into tool actions (dig/fill/till/cut…) vs item actions (plant_*/harvest)
        const toolBtns = btns.filter(b => !b.action.startsWith('plant_') && !b.action.startsWith('place_') && !b.action.startsWith('spawn_') && b.action !== 'harvest');
        const itemBtns = btns.filter(b =>  b.action.startsWith('plant_') || b.action.startsWith('place_') || b.action.startsWith('spawn_') || b.action === 'harvest');

        const DESK_KEYS = ['E', 'Q', 'F3', 'F4'];

        function applyAbt(elId, b, originalIdx) {
          const el = document.getElementById(elId);
          if (!el) return;
          if (!b) { el.classList.add('abt-hidden'); return; }
          el.classList.remove('abt-hidden');
          el.classList.toggle('blocked', !b.allowed);
          el.dataset.action = b.action;
          const keyBadge = isDesktop && originalIdx >= 0 && originalIdx < DESK_KEYS.length
            ? `<span class="abt-key">[${DESK_KEYS[originalIdx]}]</span>` : '';
          el.innerHTML = keyBadge +
            `<span class="abt-icon">${b.icon}</span>` +
            `<span class="abt-label">${b.label}</span>`;
          el.onclick = () => { activeAction = b.action; useActiveAction(); };
        }

        applyAbt('btnAction1',    toolBtns[0], btns.indexOf(toolBtns[0]));
        applyAbt('btnAction2',    toolBtns[1], btns.indexOf(toolBtns[1]));
        applyAbt('btnAction3',    toolBtns[2], btns.indexOf(toolBtns[2]));
        applyAbt('btnItemAction1', itemBtns[0], btns.indexOf(itemBtns[0]));
        applyAbt('btnItemAction2', itemBtns[1], btns.indexOf(itemBtns[1]));

        if (isDesktop) refreshKeyHud(btns);
      }

      function refreshKeyHud(btns) {
        if (!keyHudEl) return;
        const item = getActiveInventoryItem();
        const reticle = getReticleTile();
        const tile = grid[reticle.row][reticle.col];
        const obj  = getWorldObjectAt(reticle.col, reticle.row);

        const parts = [];

        // Tool
        const toolInfo = { shovel:['🥄','Shovel'], hoe:['🪓','Hoe'], machete:['🗡️','Blade'] }[activeTool] || ['🔧', activeTool];
        parts.push(`<div class="kh-group"><span class="kh-key">1/2/3</span><span class="kh-tool">${toolInfo[0]} ${toolInfo[1]}</span></div>`);
        parts.push('<div class="kh-div"></div>');

        // Action buttons → key prompts: first = [Space/E], second = [Q]
        btns.forEach((b, idx) => {
          const keyLabel = idx === 0 ? 'E' : idx === 1 ? 'Q' : `F${idx}`;
          const blocked  = !b.allowed;
          parts.push(
            `<div class="kh-group">` +
            `<span class="kh-key${blocked ? '" style="opacity:0.35' : ''}">${keyLabel}</span>` +
            `<span class="kh-action ${b.style}${blocked ? ' blocked' : ''}">${b.icon} ${b.label}</span>` +
            `</div>`
          );
        });

        parts.push('<div class="kh-div"></div>');

        // Item scroll
        if (item) {
          const count = inventory[item.key] || 0;
          parts.push(
            `<div class="kh-group">` +
            `<span class="kh-key">,</span><span class="kh-label"> </span>` +
            `<span class="kh-item">${item.icon} ${item.label} ×${count}</span>` +
            `<span class="kh-label"> </span><span class="kh-key">.</span>` +
            `</div>`
          );
        }

        parts.push('<div class="kh-div"></div>');

        // Tile info
        const tileStyle = tileStyles[tile.type] || tileStyles.grass;
        const waterPct  = Math.round((tile.water / MAX_WATER) * 100);
        parts.push(
          `<div class="kh-group">` +
          `<span class="kh-label">${tileStyle.label}` +
          (obj ? ` · ${obj.label}` : '') +
          ` · 💧${waterPct}%</span>` +
          `</div>`
        );

        parts.push('<div class="kh-div"></div>');
        parts.push('<div class="kh-group"><span class="kh-key">Esc</span><span class="kh-label">Menu</span></div>');

        keyHudEl.innerHTML = parts.join('');
      }

      function contextualActionLabel(action, tile) {
        if (action === 'dig')   return tile.type === TileType.TRENCH ? 'Unfill' : 'Dig';
        if (action === 'fill')  return 'Fill';
        if (action === 'raise') return tile.type === TileType.RAISED ? 'Lower' : 'Raise';
        if (action === 'till')  return tile.type === TileType.TILLED ? 'Untill' : 'Till';
        if (action === 'smooth') return 'Smooth';
        if (action === 'cut')   return 'Cut';
        if (action === 'slash') return 'Slash 3×';
        if (action === 'harvest') return tile.cropReady ? '✓ Harvest' : 'Growing';
        if (action.startsWith('place_')) return 'Place';
        if (action.startsWith('obj_process_')) return 'Process';
        return action;
      }

      // ── Item scroll ────────────────────────────────────────
      function refreshItemScroll() {
        const stacks = getInventoryStackItems();
        const n = stacks.length;
        if (n === 0) {
          itemIcon.textContent  = '□';
          itemName.textContent  = 'EMPTY';
          itemCount.textContent = '×0';
          itemCount.className   = 'is-count empty';
          const prevEl = document.getElementById('isPrevIcon');
          const nextEl = document.getElementById('isNextIcon');
          if (prevEl) prevEl.textContent = '□';
          if (nextEl) nextEl.textContent = '□';
          return;
        }
        if (activeItemIndex >= n) activeItemIndex = 0;
        if (activeItemIndex < 0) activeItemIndex = n - 1;
        const curr = stacks[activeItemIndex];
        const prev = stacks[(activeItemIndex - 1 + n) % n];
        const next = stacks[(activeItemIndex + 1) % n];
        const count = inventory[curr.key] || 0;
        // Current item
        itemIcon.textContent  = curr.icon;
        itemName.textContent  = curr.label;
        itemCount.textContent = `×${count}`;
        itemCount.className   = 'is-count' + (count === 0 ? ' empty' : '');
        // Peek icons (prev/next previews)
        const prevEl = document.getElementById('isPrevIcon');
        const nextEl = document.getElementById('isNextIcon');
        if (prevEl) prevEl.textContent = prev.icon;
        if (nextEl) nextEl.textContent = next.icon;
      }
      itemPrev.addEventListener('click', () => {
        cycleActiveInventoryItem(-1);
        refreshItemScroll();
        refreshActionBar();
      });
      itemNext.addEventListener('click', () => {
        cycleActiveInventoryItem(1);
        refreshItemScroll();
        refreshActionBar();
      });

      function updateHud() {
        const season = currentSeason();
        const clock  = formatClock(getHour());

        // Season (changes slowly)
        spSeason.textContent = season.emoji + ' ' + season.name;

        // Current weather + precipitation rate
        let weatherText, precipText;
        if (calendar.isRaining) {
          const str = calendar.rainStrength;
          if (str >= 3) {
            weatherText = '⛈️ Storm';
            precipText  = '⬇️ heavy';
          } else {
            weatherText = '🌧️ Rain';
            // RAIN_RATE * str * ticks/hr ≈ mm equivalent display
            const mmEq  = (RAIN_RATE * str * 51).toFixed(1); // ~51 ticks/hr at 0.7s/tick
            precipText  = `⬇️ ${mmEq}mm/hr`;
          }
        } else {
          weatherText = calendar.weather === 'clear' ? '☀️ Clear' : '🌤️ Dry';
          precipText  = '⬇️ none';
        }
        spWeather.textContent = weatherText + ' ' + precipText;

        spTime.textContent = clock;
        spTool.textContent = toolEmoji(activeTool) + ' ' + actionName(activeAction);

        // Reticle tile info
        const reticle  = getReticleTile();
        const tile     = getActiveTileAt(reticle.col, reticle.row);
        const tStyle   = tileStyles[tile.type] || tileStyles.grass;
        const cropStr  = tile.crop ? ` · ${tile.crop}${tile.cropReady ? ' ✓' : ''}` : '';
        spTile.textContent = (currentArea === 'interior' ? '🏠 ' : '') + tStyle.label + cropStr;

        const waterPct = Math.round((tile.water / MAX_WATER) * 100);
        const depthStr = tile.water > 0.01 ? `${waterPct}%` : 'dry';
        spWater.textContent  = '💧 ' + depthStr;
        spWater.style.color  = waterPct > 80 ? '#4488ff'
                             : waterPct > 40 ? '#6ec6f0'
                             : waterPct > 10 ? '#aaddee' : '#888';
        if (spGold) spGold.textContent = '💰 ' + inventory.gold + 'g';

        // Desktop: show active item in status pill (item scroll is hidden)
        if (isDesktop) {
          const item = getActiveInventoryItem();
          const spItem = document.getElementById('spItem');
          const spItemDiv = document.getElementById('spItemDiv');
          if (spItem && item) {
            spItem.style.display = '';
            spItemDiv.style.display = '';
            spItem.textContent = '[Tab] ' + item.icon + ' ' + item.label + ' ×' + (inventory[item.key] || 0);
          }
        }

        refreshItemScroll();
        // refreshActionBar is called after actions and on tool/item change;
        // the dirty-key check makes it cheap to call here too for reticle updates
        refreshActionBar();
        if (menuOpen) {
          // Keep wallet display live while menu is open
          const wd = document.getElementById('invWalletDisplay');
          if (wd) wd.textContent = (inventory.gold || 0) + 'g';
        }
      }

      function updateMenuContent() { /* replaced by buildInventoryGrid() */ }

      function updateDebugPage() { /* debug panel removed from menu */ }

      function toolEmoji(tool) {
        return { shovel: '🥄', hoe: '🪓', machete: '🗡️', seeds: '🌱' }[tool] || '❔';
      }

      function nextRainText() {
        if (!calendar.nextRainWindows.length) return 'No rain scheduled today';
        const hour = getHour();
        const next = calendar.nextRainWindows.find((window) => hour < window.end);
        if (!next) return 'Rain has passed for today';
        return `Next flow ${formatClock(next.start)}-${formatClock(next.end)}`;
      }

      function formatClock(hourValue) {
        const hour = Math.floor(hourValue);
        const minute = Math.floor((hourValue - hour) * 60 / 10) * 10;
        const suffix = hour >= 12 ? 'PM' : 'AM';
        const displayHour = ((hour + 11) % 12) + 1;
        return `${displayHour}:${String(minute).padStart(2, '0')} ${suffix}`;
      }

      function actionEmoji(action) {
        return actionLabels[action]?.[0] || '❔';
      }

      function actionName(action) {
        if (action.startsWith('place_')) return 'Place';
        if (action.startsWith('obj_process_')) return 'Process';
        return actionLabels[action]?.[1] || action;
      }

      function toolName(tool) {
        return { shovel: '🥄 Shovel', hoe: '🪓 Hoe', machete: '🗡️ Machete', seeds: '🌱 Seeds' }[tool] || tool;
      }

      function seededRandom(seed) {
        const x = Math.sin(seed) * 10000;
        return x - Math.floor(x);
      }

      function handleJoystickPointerDown(event) {
        input.joystickPointerId = event.pointerId;
        joystickZone.setPointerCapture(event.pointerId);
        updateJoystick(event);
      }

      function handleJoystickPointerMove(event) {
        if (input.joystickPointerId !== event.pointerId) return;
        updateJoystick(event);
      }

      function handleJoystickPointerUp(event) {
        if (input.joystickPointerId !== event.pointerId) return;
        input.joystickPointerId = null;
        input.x = 0;
        input.y = 0;
        joystickKnob.style.transform = 'translate(-50%,-50%) translate(0px, 0px)';
      }

      function updateJoystick(event) {
        const rect = joystickZone.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const rawX = event.clientX - centerX;
        const rawY = event.clientY - centerY;
        const distance = Math.hypot(rawX, rawY);
        const activeRadius = Math.max(32, Math.min(JOYSTICK_RADIUS, rect.width * 0.42)); // Used below to clamp knob travel for the current screen-sized joystick.
        const angle = Math.atan2(rawY, rawX);
        const clamped = Math.min(distance, activeRadius);
        const rawMagnitude = clamp(clamped / activeRadius, 0, 1);
        const remapped = rawMagnitude <= JOYSTICK_DEADZONE
          ? 0
          : Math.pow((rawMagnitude - JOYSTICK_DEADZONE) / (1 - JOYSTICK_DEADZONE), JOYSTICK_RESPONSE);
        const knobX = Math.cos(angle) * clamped;
        const knobY = Math.sin(angle) * clamped;

        input.x = remapped > 0 ? Math.cos(angle) * remapped : 0;
        input.y = remapped > 0 ? Math.sin(angle) * remapped : 0;
        joystickKnob.style.transform = `translate(-50%,-50%) translate(${knobX}px, ${knobY}px)`;
      }

      async function copyDebugLog() {
        const reticle = getReticleTile();
        const lines = [
          'Tropical Trench Farm Debug Report',
          `User agent: ${navigator.userAgent}`,
          `Viewport: ${window.innerWidth}x${window.innerHeight}`,
          `UI rect: ${getComputedStyle(document.documentElement).getPropertyValue('--gw').trim()} × ${getComputedStyle(document.documentElement).getPropertyValue('--gh').trim()} at ${getComputedStyle(document.documentElement).getPropertyValue('--ox').trim()}, ${getComputedStyle(document.documentElement).getPropertyValue('--oy').trim()}`,
          `3D rect: ${Math.round(threeContainer.getBoundingClientRect().width)}x${Math.round(threeContainer.getBoundingClientRect().height)}`,
          `Joystick viewport anchor: ${Math.round(joystickZone.getBoundingClientRect().left)}px left, ${Math.round(window.innerHeight - joystickZone.getBoundingClientRect().bottom)}px bottom`,
          `Movement tuning: speed=${MOVE_SPEED} accel=${ACCEL} turn=${TURN_ACCEL} decel=${DECEL} deadzone=${JOYSTICK_DEADZONE}`,
          `Action FX: particles=${actionParticles.length} tileFlashes=${actionTileEffects.length} slashTrails=${weaponTrailEffects.length}`,
          `Calendar: ${currentSeason().name} Day ${calendar.day}, ${formatClock(getHour())}, ${calendar.weather}`,
          `Tool/action: ${toolName(activeTool)} / ${actionName(activeAction)}`,
          `Player: x${player.x.toFixed(0)} y${player.y.toFixed(0)}`,
          '--- raw log ---',
          ...(window.__farmDebugLog || [])
        ];
        const text = lines.join('\n');
        try {
          if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
          } else {
            const area = document.createElement('textarea');
            area.value = text;
            area.setAttribute('readonly', '');
            area.style.cssText = 'position:fixed;left:-9999px';
            document.body.appendChild(area);
            area.select();
            document.execCommand('copy');
            area.remove();
          }
          showToast('Debug log copied to clipboard.', true);
          debugLog('debug log copied to clipboard');
        } catch (error) {
          showToast('Copy failed — log visible in Debug tab.', false);
          debugLog(`copy debug log failed: ${error.message}`, 'error');
        }
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

      function doReset() {
        calendar.day = 17;
        calendar.time01 = 0.30;
        calendar.weather = 'rain';
        calendar.isRaining = true;
        calendar.rainStrength = 2;
        calendar.nextRainWindows = [{ start: 8, end: 14, strength: 2 }];
        Object.keys(inventory).forEach(key => { delete inventory[key]; });
        Object.assign(inventory, { ...STARTING_INVENTORY });
        clearPlacedProcessingFurniture();
        clearAnimalObjects();
        worldObjects.forEach(o => o.reset && o.reset());
        grid = createInitialGrid();
        player.x = COLS * TILE * 0.5;
        player.y = ROWS * TILE * 0.72;
        player.angle = -Math.PI / 2;
        player.vx = 0; player.vy = 0;
        facingAngle = -Math.PI / 2;
        lastMoveAngle = -Math.PI / 2;
        cardinalHoldTimer = 0;
        activeItemIndex = 0;
        lastActionMessage = 'Farm reset. First Rains — dig trenches to route the water.';
        showToast('Farm reset to First Rains.', true);
        debugLog('prototype reset');
        refreshActionBar();
        refreshItemScroll();
        closeMenu();
      }


      if (menuResetBtn) menuResetBtn.addEventListener('click', doReset);
      if (menuPauseBtn) menuPauseBtn.addEventListener('click', () => {
        paused = !paused;
        menuPauseBtn.textContent = paused ? '▶' : '⏸';
        debugLog(paused ? 'paused' : 'resumed');
      });

      joystickZone.addEventListener('pointerdown', handleJoystickPointerDown);
      joystickZone.addEventListener('pointermove', handleJoystickPointerMove);
      joystickZone.addEventListener('pointerup', handleJoystickPointerUp);
      joystickZone.addEventListener('pointercancel', handleJoystickPointerUp);

      window.addEventListener('keydown', (event) => {
        const key = event.key.toLowerCase();
        if (key === 'escape') { event.preventDefault(); menuOpen ? closeMenu() : openMenu(); return; }
        if (menuOpen) return;
        if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'w', 'a', 's', 'd'].includes(key)) {
          event.preventDefault(); input.keys.add(key);
        }

        // Primary action: Space, Enter, or E
        if (key === ' ' || key === 'enter' || key === 'e') {
          event.preventDefault();
          useActiveAction();
          return;
        }

        // Secondary action: Q fires second button on desktop, cycles tool action on touch
        if (key === 'q') {
          if (isDesktop) {
            const btns = computeActionButtons();
            const second = btns.find((b, i) => i > 0 && b.allowed);
            if (second) { activeAction = second.action; useActiveAction(); }
          } else {
            const actions = toolActions[activeTool];
            const idx = actions.indexOf(activeAction);
            activeAction = actions[(idx + 1) % actions.length];
            refreshActionBar();
          }
          return;
        }

        if (key === '1') setActiveTool('shovel');
        if (key === '2') setActiveTool('hoe');
        if (key === '3') setActiveTool('machete');

        // Item scroll: , / . or Tab/Shift+Tab
        if (key === ',' || key === 'shift') {
          cycleActiveInventoryItem(-1);
          refreshItemScroll(); refreshActionBar();
        }
        if (key === '.' || key === 'tab') {
          event.preventDefault();
          cycleActiveInventoryItem(1);
          refreshItemScroll(); refreshActionBar();
        }
      });

      window.addEventListener('keyup', (event) => input.keys.delete(event.key.toLowerCase()));

      // Mouse-look: raycast cursor onto ground plane to get world position
      if (isDesktop) {
        threeContainer.addEventListener('mousemove', (e) => {
          const rect = threeContainer.getBoundingClientRect();
          _mouseNDC.x =  ((e.clientX - rect.left)  / rect.width)  * 2 - 1;
          _mouseNDC.y = -((e.clientY - rect.top)   / rect.height) * 2 + 1;
          _raycaster.setFromCamera(_mouseNDC, camera);
          if (_raycaster.ray.intersectPlane(_groundPlane, _mouseWorld)) {
            const dx = _mouseWorld.x - player.x / TILE;
            const dz = _mouseWorld.z - player.y / TILE;
            if (Math.hypot(dx, dz) > 0.3) {
              // atan2 in Three.js XZ: angle from +X axis, but game uses -Z=north
              mouseLookAngle = Math.atan2(dz, dx);
              mouseLookActive = true;
              lastMouseMoveTime = performance.now();
            }
          }
        });
      }
      window.addEventListener('resize', () => { fitToAspect(); resizeCanvas(); updateCameraPosition(); if (menuOpen) auditInventorySizing(); });
      fitToAspect();
      resizeCanvas();
      refreshActionBar();
      refreshItemScroll();
      try { initWorldObjects(); } catch(e) { console.error('initWorldObjects:', e); }
      debugLog('canvas resized, split wide-screen layout active, controls bound, animation loop requested');

      // ── Onboarding gate ────────────────────────────────────────────
      let gameStarted = false;

      async function spawnPlayerAvatar(playerData) {
        try {
          await window.NpcAvatarPreview.ensurePortraitCosmetics({
            assetBase: './assets/',
            configBase: './config/',
          });

          const profile = window.NpcAvatarPreview.buildProfileFromNpcExport(playerData);
          if (!profile) { gameStarted = true; return; }

          const MODEL_W = 0.9; // 0.75 * 1.2
          // portrait-utils.js uses PORTRAIT_CW/CH = 200 for all layer offsets;
          // rendering to any other size shifts off-center sprites.
          const PORTRAIT_SIZE = 200;

          const frontCanvas = document.createElement('canvas');
          frontCanvas.width = frontCanvas.height = PORTRAIT_SIZE;
          await window.NpcAvatarPreview.renderProfileToCanvas(frontCanvas, profile);

          const backCanvas = document.createElement('canvas');
          backCanvas.width = backCanvas.height = PORTRAIT_SIZE;
          await window.NpcAvatarPreview.renderProfileToCanvas(backCanvas, profile, { portraitView: 'behind' });

          const MODEL_H = MODEL_W * (PORTRAIT_SIZE / PORTRAIT_SIZE); // square canvas
          const avatarGroup = window.PNGPlaneAvatar.buildSinglePlaneAvatarModel(
            THREE, frontCanvas,
            { backCanvas, modelWidth: MODEL_W, modelHeight: MODEL_H, anchorZ: 0, alphaTest: 0.01 }
          );
          avatarGroup.name = 'player_avatar';
          // PlaneGeometry is origin-centered; lift by half height so bottom = tile surface
          avatarGroup.position.set(0, MODEL_H / 2, 0);
          playerMesh.add(avatarGroup);
          debugLog('PNG plane avatar attached to player_root');
        } catch (err) {
          console.warn('spawnPlayerAvatar failed, continuing without avatar:', err);
        }
        gameStarted = true;
      }

      document.addEventListener('hobunjiPlayerReady', (e) => {
        spawnPlayerAvatar(e.detail);
      }, { once: true });

      // If init() already fired synchronously (returning player with localStorage profile),
      // __hobunjiPlayerProfile is set before this listener registered — catch that case.
      if (window.__hobunjiPlayerProfile) {
        spawnPlayerAvatar(window.__hobunjiPlayerProfile);
      }

      requestAnimationFrame(gameLoop);
    })();
