    (() => {
      'use strict';

      // Gameplay-affecting randomness (creature AI decisions, pack spawns,
      // loot rolls) goes through this seedable source instead of raw
      // Math.random() — see the window.GameRandom definition in
      // resource-system.js for why. Purely cosmetic randomness (particle FX,
      // audio pitch variance) is left on Math.random().
      const rnd = () => window.GameRandom.random();

      const threeContainer = document.getElementById('threeContainer');
      const overlayCanvas  = document.getElementById('overlayCanvas');
      const octx           = overlayCanvas.getContext('2d');
      const lightingCanvas = document.getElementById('lightingCanvas');
      const lctx           = lightingCanvas.getContext('2d');
      const debugLog = window.__farmLog || ((m) => console.log(m));
      const joystickZone = document.getElementById('joystickZone');
      const joystickKnob = document.getElementById('joystickKnob');
      const cameraJoystickZone = document.getElementById('cameraJoystickZone');
      const cameraJoystickKnob = document.getElementById('cameraJoystickKnob');
      const dodgeBtn = document.getElementById('dodgeBtn');
      const btnSwapTarget = document.getElementById('btnSwapTarget');
      const btnWeaponSwitch = document.getElementById('btnWeaponSwitch');
      const btnWeaponSwitchIcon = document.getElementById('btnWeaponSwitchIcon');
      const btnCallMount = document.getElementById('btnCallMount');
      const btnMeleeAutoTarget = document.getElementById('btnMeleeAutoTarget');

      // Status pill
      const spTime    = document.getElementById('spTime');
      const spDay     = document.getElementById('spDay');
      const spSeason  = document.getElementById('spSeason');
      // Calendar (lives in the menu's Calendar tab — see #mpCalendar)
      const calToday         = document.getElementById('calToday');
      const calMonthTitle    = document.getElementById('calMonthTitle');
      const calPrevMonth     = document.getElementById('calPrevMonth');
      const calNextMonth     = document.getElementById('calNextMonth');
      const calWeeks         = document.getElementById('calWeeks');
      const spWeather = document.getElementById('spWeather');
      const spTool    = document.getElementById('spTool');
      const spTile    = document.getElementById('spTile');
      const spWater   = document.getElementById('spWater');
      const spGold    = document.getElementById('spGold');
      const spItem    = document.getElementById('spItem');
      const spItemDiv = document.getElementById('spItemDiv');

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
      const zoneBannerEl = document.getElementById('zoneBanner');
      const keyHudEl  = document.getElementById('keyHud');
      const isDesktop = window.matchMedia('(pointer: fine)').matches;
      const dialogueZoomIndicator = document.createElement('div');
      dialogueZoomIndicator.className = 'dialogue-zoom-indicator';
      dialogueZoomIndicator.setAttribute('aria-hidden', 'true');
      (document.getElementById('canvasWrap') || threeContainer).appendChild(dialogueZoomIndicator);

      // Tool select (replaces rightCluster)
      const toolSelect      = document.getElementById('toolSelect');
      const toolBtn        = document.getElementById('toolBtn');
      const toolBtnIcon    = document.getElementById('toolBtnIcon');
      const toolBtnLabel   = document.getElementById('toolBtnLabel');
      // actionRows removed — refreshActionBar now targets fixed #btnActionN elements

      // Item scroll
      const itemPrev   = document.getElementById('itemPrev');
      const itemNext   = document.getElementById('itemNext');
      const itemIcon   = document.getElementById('itemIcon');
      const itemName   = document.getElementById('itemName');
      const itemCount  = document.getElementById('itemCount');
      const itemBtnEl  = document.getElementById('itemBtn');
      const isPrevIconEl = document.getElementById('isPrevIcon');
      const isNextIconEl = document.getElementById('isNextIcon');


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
        // Release shoulder-surf's Pointer Lock (see requestShoulderSurfPointerLock
        // below) so the cursor is free to click around the menu — it isn't
        // visible/usable at all while locked.
        releaseShoulderSurfPointerLock();
        window.WorldPopupText?.clearInteractionPrompts?.();
        menuBtn.classList.add('open');
        menuBtn.setAttribute('aria-expanded', 'true');
        menuBackdrop.classList.add('open');
        menuPanel.classList.add('open');
        paused = true;
        switchMenuPanel(targetPanel);
        buildInventoryGrid();
        window.EquipmentPanel.buildEquipmentSlots();
        if (targetPanel === 'crafting') window.CraftingPanel.render();
        if (targetPanel === 'shipping') window.ShippingPanel.build();
        if (targetPanel === 'supplies') window.SupplyPage.render();
        if (targetPanel === 'generalStore') window.GeneralStore.render();
        if (targetPanel === 'carpenterShop') window.CarpenterShop.render();
        if (targetPanel === 'jubmirShop') window.JubmirShop.render();
        if (targetPanel === 'metalCraftShop') window.MetalCraftShop.render();
        if (targetPanel === 'alchemy') window.AlchemySystem.renderPanel();
        if (targetPanel === 'tasks') window.TasksPanel.render();
        if (targetPanel === 'relationships') window.RelationshipsPanel.render();
        auditInventorySizing();
        // The furniture placer button sits in the same fixed top-right
        // corner the open menu panel covers — hide it immediately rather
        // than waiting for some other trigger to call refreshActionBar.
        window.FurniturePlacer?.refreshVisibility();
      }
      function closeMenu() {
        menuOpen = false;
        menuBtn.classList.remove('open');
        menuBtn.setAttribute('aria-expanded', 'false');
        menuBackdrop.classList.remove('open');
        menuPanel.classList.remove('open');
        paused = false;
        window.FurniturePlacer?.refreshVisibility();
        // The click that closed the menu is itself a user gesture, so
        // resume shoulder-surf's Pointer Lock immediately rather than
        // waiting for a separate click on the game world.
        if (s_shoulderSurf && activeCameraMode === SHOULDER_SURF_MODE) requestShoulderSurfPointerLock();
      }
      menuBtn.addEventListener('click', () => menuOpen ? closeMenu() : openMenu());
      menuBackdrop.addEventListener('click', closeMenu);
      spDay.addEventListener('click', () => {
        const onCalendarTab = document.querySelector('.mp-tab[data-mpanel="calendar"]')?.classList.contains('active');
        if (menuOpen && onCalendarTab) closeMenu();
        else openMenu('calendar');
      });

      // ── New panel tab switching ────────────────────────────

      function switchMenuPanel(id) {
        document.querySelectorAll('.mp-tab').forEach(t =>
          t.classList.toggle('active', t.dataset.mpanel === id));
        document.querySelectorAll('.mp-pane').forEach(p =>
          p.classList.toggle('active',
            p.id === 'mp' + id.charAt(0).toUpperCase() + id.slice(1)));
        if (id === 'inventory') { buildInventoryGrid(); window.EquipmentPanel.buildEquipmentSlots(); }
        if (id === 'crafting') window.CraftingPanel.render();
        if (id === 'calendar') window.CalendarSystem.renderCalendarPanel();
        if (id === 'map') { window.WildernessMap.renderMapPanel(); renderNpcGatheringPanel(); }
        if (id === 'farm') window.FarmPanel.render();
        if (id === 'stable') window.FarmPanel.renderStablePanel();
        if (id === 'shipping') window.ShippingPanel.build();
        if (id === 'supplies') window.SupplyPage.render();
        if (id === 'generalStore') window.GeneralStore.render();
        if (id === 'carpenterShop') window.CarpenterShop.render();
        if (id === 'jubmirShop') window.JubmirShop.render();
        if (id === 'metalCraftShop') window.MetalCraftShop.render();
        if (id === 'alchemy') window.AlchemySystem.renderPanel();
        if (id === 'tasks') window.TasksPanel.render();
        if (id === 'relationships') window.RelationshipsPanel.render();
        if (id === 'debug' && window._renderDebugPanel) window._renderDebugPanel();
        if (id === 'wildlife') window.WildlifeDebugPanel.render();
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
      // Debug log clear button
      const _dbgClear = document.getElementById('debugClearBtn');
      if (_dbgClear) _dbgClear.addEventListener('click', () => {
        window.__farmDebugLog = [];
        if (window._renderDebugPanel) window._renderDebugPanel();
      });
      // Debug log copy-to-clipboard button — copies whichever of the Log/
      // Pixel Probe views is currently showing (see _setDebugView below).
      const _dbgCopy = document.getElementById('debugCopyBtn');
      if (_dbgCopy) _dbgCopy.addEventListener('click', () => {
        if (document.getElementById('debugViewProbeBtn')?.classList.contains('active')) window.PixelProbe?.copyPixelProbeResult();
        else copyDebugLog();
      });
      // Debug log filter tabs — filtering itself lives in debug.js's
      // _renderDebugPanel (window.__debugLogFilter), since that's what
      // actually owns window.__farmDebugLog and re-renders on every new
      // entry; this just switches the active tab and the visual state.
      document.querySelectorAll('.debug-filter-tab').forEach(btn => {
        btn.addEventListener('click', () => {
          window.__debugLogFilter = btn.dataset.filter;
          document.querySelectorAll('.debug-filter-tab').forEach(b => {
            const active = b === btn;
            b.classList.toggle('active', active);
            b.style.background = active ? 'rgba(106,167,255,.22)' : 'rgba(255,255,255,.08)';
            b.style.borderColor = active ? 'rgba(106,167,255,.5)' : 'rgba(255,255,255,.2)';
            b.style.color = active ? '#6aa7ff' : '#d1d5db';
          });
          if (window._renderDebugPanel) window._renderDebugPanel();
        });
      });

      // Pixel Probe (Debug tab) now lives in js/pixel-probe.js
      // (window.PixelProbe) — see window.PixelProbe.init(...) below.

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
          window.ShippingPanel.setActiveCat(side, btn.dataset.cat);
          document.querySelectorAll(`.ship-cat[data-side="${side}"]`).forEach(b =>
            b.classList.toggle('active', b.dataset.cat === window.ShippingPanel.getActiveCat(side)));
          window.ShippingPanel.build();
        });
      });
      const shipCloseBtn = document.getElementById('shipCloseBtn');
      if (shipCloseBtn) shipCloseBtn.addEventListener('click', closeMenu);
      const shipAmtMinus = document.getElementById('shipAmtMinus');
      const shipAmtPlus  = document.getElementById('shipAmtPlus');
      if (shipAmtMinus) shipAmtMinus.addEventListener('click', () => window.ShippingPanel.bumpAmount(-1));
      if (shipAmtPlus)  shipAmtPlus.addEventListener('click',  () => window.ShippingPanel.bumpAmount(1));
      const shipTransferOne = document.getElementById('shipTransferOne');
      const shipTransferHalf = document.getElementById('shipTransferHalf');
      const shipTransferStack = document.getElementById('shipTransferStack');
      if (shipTransferOne) shipTransferOne.addEventListener('click', () => window.ShippingPanel.transferAmount(1));
      if (shipTransferHalf) shipTransferHalf.addEventListener('click', () => window.ShippingPanel.transferAmount('half'));
  