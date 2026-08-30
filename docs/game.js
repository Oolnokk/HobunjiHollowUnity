Warning: truncated output (original token count: 428865)
... 666882 bytes omitted ...

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
        if (cursorlessMouseAimRequested()) requestShoulderSurfPointerLock();
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
        if (id === 'wildlife') { window.WildlifeDebugPanel.render(); window.WildlifeBehaviorMap?.render(); }
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
      if (shipTransferStack) shipTransferStack.addEventListener('click', () => window.ShippingPanel.transferAmount('stack'));

      // ── Legend + old legend toggle removed — handled by menu now
      // ── Toast ──────────────────────────────────────────────
      let _toastTimer = null;
      // `silent` skips the "can't do that" error chime while still showing
      // the visual toast — used by per-swing combat hit/miss results (combo/
      // quick attacks/Charged Breaker/basic weapon tap), which fire on
      // *every* attack and already have their own dedicated combat sfx
      // (weaponSlash/creatureClawHit).
      //
      // Deliberately no sound on ok===true here: a ding on every successful
      // action (dig, till, plant, harvest, process...) was just noise that
      // meant "you pressed something and it worked" — no actual information
      // beyond what the player already knows from doing the thing. The
      // error chime survives because a *blocked* action is the one case
      // that's actually worth a distinct "that didn't work" cue.
      function showToast(msg, ok = true, silent = false) {
        toastEl.textContent = msg;
        toastEl.className = 'show ' + (ok ? 'ok' : 'fail');
        clearTimeout(_toastTimer);
        _toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2800);
        if (!silent && !ok) window.AudioSystem?.playObjectSfx(window.AudioSystem?.objectSfxConfig().error);
      }

      // A location title card -- fades in near the top of the screen and
      // holds, then fades out, same genre convention as an "Entering X"
      // banner. Separate from showToast (a small ok/fail status ping):
      // this holds noticeably longer (a title card is meant to be READ,
      // not just glanced at) and has no ok/fail styling since it's never
      // reporting an outcome.
      let _zoneBannerTimer = null;
      function showZoneBanner(text) {
        zoneBannerEl.textContent = text;
        zoneBannerEl.classList.add('show');
        clearTimeout(_zoneBannerTimer);
        _zoneBannerTimer = setTimeout(() => zoneBannerEl.classList.remove('show'), 4200);
      }

      // gameAudioConfig() and the whole footstep/one-shot SFX layer now live
      // in js/audio-system.js (window.AudioSystem) — see
      // window.AudioSystem.init(...) below for the wiring.

      // NPC dialogue CONTENT (text/token resolution, tree/pool selection,
      // typewriter, portrait rendering, choice buttons) now lives in
      // js/dialogue-content.js (window.DialogueContent) — see
      // window.DialogueContent.init(...) below for the wiring.
      // openNpcDialogue/closeNpcDialogue stay here since they own
      // camera/staging/save-persistence, which this module doesn't touch.
      const _npcDialogueEl      = document.getElementById('npcDialogue');
      const _npcPortraitCanvas  = document.getElementById('npcPortraitCanvas');
      const _npcDialogueNameEl  = document.getElementById('npcDialogueName');
      const _npcDialogueHeartsEl = document.getElementById('npcDialogueHearts');
      const _arcContainerEl     = document.getElementById('arcContainer');

      async function openNpcDialogue(walker) {
        const rec  = walker.rec;
        window.DialogueContent?.recordNpcMemory(rec?.id, 'talked');
        window.WorldPopupText?.clearInteractionPrompts?.();

        dialogueOpen    = true;
        _dialogueWalker = walker;
        activeCameraMode   = npcDialogueCameraMode();
        activeCameraTarget = walker.root;
        beginNpcDialogueStaging(walker);
        updateDialogueZoomIndicator();
        walker.pause = Infinity;
        _npcDialogueNameEl.textContent = rec?.name || 'Stranger';
        if (_npcDialogueHeartsEl) _npcDialogueHeartsEl.textContent = window.DialogueContent?.renderRelationshipHearts(rec);
        _arcContainerEl?.classList.add('arc-hidden');

        if (walker.profile && window.NpcAvatarPreview) {
          const ctx = _npcPortraitCanvas.getContext('2d');
          ctx.fillStyle = '#1b3529';
          ctx.fillRect(0, 0, _npcPortraitCanvas.width, _npcPortraitCanvas.height);
          await window.DialogueContent?.renderNpcDialoguePortrait();
        }

        _npcDialogueEl.classList.add('open');
        _npcDialogueEl.setAttribute('aria-hidden', 'false');

        // Task turn-in — checked before everything else (including a fresh
        // favor ask): if this NPC posted/asked a quest that's now sitting
        // ready in the player's log, offer to hand it over right here rather
        // than piling a new favor ask on top of an already-completed one.
        const _turnInTask = rec?.id ? window.ProceduralTasks.getTurnInReadyTaskForNpc(rec.id) : null;
        if (_turnInTask) {
          const _turnInDef = ITEM_DEFS[_turnInTask.itemKey];
          window.DialogueContent?.beginSyntheticChoice(rec);
          window.DialogueContent?.renderDlgNode({
            type: 'choice',
            text: `Ah — did you bring what I asked for?`,
            choices: [
              { label: `Here's your ${_turnInDef?.label || _turnInTask.itemKey} ×${_turnInTask.qty}.`, actions: [{ type: 'turnInTask', taskId: _turnInTask.id }] },
              { label: 'Not yet.', actions: [] },
            ],
          });
          return;
        }

        // Trusted-NPC favors — checked ahead of every other fast-path
        // (including the merchant shop shortcuts below, so shopkeepers can
        // ask for favors too, not just villagers with an authored dialogue
        // tree) whenever the NPC currently has, or freshly rolls, a favor to
        // ask — gated by friendship tier. Same synthetic choice-node
        // shortcut the shop fast-paths use. See maybeOfferFavor.
        const _favorTask = window.ProceduralTasks.maybeOfferFavor(rec);
        if (_favorTask) {
          window.DialogueContent?.beginSyntheticChoice(rec);
          window.DialogueContent?.renderDlgNode({
            type: 'choice',
            text: window.ProceduralTasks.favorAskLine(_favorTask),
            choices: [
              { label: "I'll help.", actions: [{ type: 'acceptFavor', taskId: _favorTask.id }] },
              { label: 'Not right now.', actions: [{ type: 'declineFavor', taskId: _favorTask.id }] },
            ],
          });
          return;
        }

        // These synthetic pre-choice screens are a fast-path shortcut for
        // when the NPC happens to be caught right at their counter — a
        // quicker single-tap route to the shop than navigating their own
        // dialogue tree. They are NOT the reliable path: that fast-path
        // condition (idle, exact station, label match) is easy to miss if
        // the NPC has stepped away or is mid-transition, which is why every
        // shopkeeper below also gets a real "openShop" choice baked into
        // their own dialogueTrees — reachable through ordinary conversation
        // any time, with no station/idle requirement at all.
        if (isGeneralStoreNpcOnDuty(walker)) {
          const cfg = generalStoreButtonConfig();
          window.DialogueContent?.beginSyntheticChoice(rec);
          window.DialogueContent?.renderDlgNode({
            type: 'choice',
            text: cfg.shopGreeting || 'What can I do for you?',
            choices: [
              { label: cfg.buyChoiceLabel || 'Buy', actions: [{ type: 'openShop', pool: 'generalStoreWares' }] },
              { label: cfg.chatChoiceLabel || 'Chat', actions: [{ type: 'startChat' }] },
            ],
          });
          return;
        }

        if (isCarpenterNpcOnDuty(walker)) {
          const cfg = carpenterButtonConfig();
          window.DialogueContent?.beginSyntheticChoice(rec);
          window.DialogueContent?.renderDlgNode({
            type: 'choice',
            text: cfg.shopGreeting || 'What can I do for you?',
            choices: [
              { label: cfg.buyChoiceLabel || 'Buy', actions: [{ type: 'openShop', pool: 'carpenterBarnPlans' }] },
              { label: cfg.chatChoiceLabel || 'Chat', actions: [{ type: 'startChat' }] },
            ],
          });
          return;
        }

        // Jubmir the traveling trader — unlike the General Store/Carpenter,
        // he isn't tied to a shop counter (he wanders per his schedule), so
        // this choice is offered any time you talk to him at all rather
        // than being station-gated. "Chat" re-enters his normal dialogue
        // tree exactly like the General Store's Chat option does.
        if (rec?.id === 'jubmir') {
          window.DialogueContent?.beginSyntheticChoice(rec);
          window.DialogueContent?.renderDlgNode({
            type: 'choice',
            text: 'What can I do for you?',
            choices: [
              { label: 'See Wares', actions: [{ type: 'openShop', pool: 'jubmirWares' }] },
              { label: 'Chat', actions: [{ type: 'startChat' }] },
            ],
          });
          return;
        }

        window.DialogueContent?.beginNpcConversation(rec);
      }

      // advanceNpcDialogue now lives in js/dialogue-content.js
      // (window.DialogueContent).

      function closeNpcDialogue() {
        dialogueOpen = false;
        window.DialogueContent?.resetDialogueState();
        window.DialogueContent?.stopNpcDialogueTypewriter(false);
        window.DialogueContent?.hideChoiceButtons();
        npcDialogueStaging = null;
        window.portraitBreathingComposer?.clearExpression(window.DialogueContent?.dialogueSeatId());
        window.portraitBreathingComposer?.setDefaultExpression(window.DialogueContent?.dialogueSeatId(), null);
        player._lookAtDebug = null;
        if (_dialogueWalker) {
          if (_dialogueWalker.neckJoint) _dialogueWalker.neckJoint.rotation.set(0, 0, 0);
          _dialogueWalker._lookAtDebug = null;
          _dialogueWalker.pause = 0;
          _dialogueWalker.catchup = 3.5;
          _dialogueWalker.catchupDur = 8;
          _dialogueWalker = null;
        }
        enterDefaultCameraMode();
        activeCameraTarget = null;
        dialogueZoomPointers.clear();
        dialoguePinchDistance = null;
        if (dialogueZoomConfig().resetOnDialogueClose) resetDialogueCameraZoom();
        else updateDialogueZoomIndicator();
        _arcContainerEl?.classList.remove('arc-hidden');
        _npcDialogueEl.classList.remove('open');
        _npcDialogueEl.setAttribute('aria-hidden', 'true');
        saveMemberWorldData(); // persist visited-node/memory state mutated during the conversation
        refreshActionBar();
      }

      // renderRelationshipHearts now lives in js/dialogue-content.js
      // (window.DialogueContent).

      // ── Tile / crop enums (must come first — referenced by everything below) ──
      const TileType = Object.freeze({
        GRASS: 'grass', WEEDS: 'weeds', TILLED: 'tilled',
        TRENCH: 'trench', RAISED: 'raised', PADDY: 'paddy',
        ROCK: 'rock', SHRUB: 'shrub', PATH: 'path',
        RIVER: 'river', STREAM: 'stream', RAMP: 'ramp', WATERFALL: 'waterfall'
      });
      // Tile types whose own heightfield (buildTerrainTileGeo) carves a depression
      // or rise into the ground — a plateau mesa's flat lid/skin must never also
      // render a quad over one of these, or the carved bed renders buried under it.
      const CARVED_TILE_TYPES = new Set([TileType.RIVER, TileType.STREAM, TileType.WATERFALL, TileType.TRENCH, TileType.RAISED]);
      // river/stream/waterfall are one continuous waterway — a cell of one type
      // bordering a cell of another in this family should blend as "open" (full
      // depth carries through) instead of tapering back to flat ground right at
      // that family-internal seam.
      const WATERWAY_TYPES = new Set([TileType.RIVER, TileType.STREAM, TileType.WATERFALL]);
      const sameWaterway = (a, b) => a === b || (WATERWAY_TYPES.has(a) && WATERWAY_TYPES.has(b));

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
      // Dev balancing knob (Testing Arena's "Base movement speed" slider) --
      // multiplies the PLAYER's own target speed (updateMovement) and every
      // creature/bandit's speed at moveCreatureToward, the single choke
      // point essentially all non-player movement (walk/chase/wander/
      // retreat) already runs through. Deliberately does NOT touch lunges
      // (beginCombatLunge/updateBanditLunge) or Pounce's leap -- those are
      // tied to a fixed ability's own windup/strike timing, not "how fast
      // does this thing walk," so scaling them would desync a swing's
      // animation from where its hit lands rather than just changing pace.
      let devGlobalSpeedMul = 0.75;
      // Move-bob distances (world Y units), shared by the player, NPC
      // walkers, and bandits: WALK is the amplitude right as a character
      // starts moving, RUN is the amplitude at full effort (current speed at
      // that character's own max) — each call site lerps between the two by
      // its own effort ratio rather than using a flat distance. Kept subtle
      // so the procedural feet carry the gait without making the whole body
      // visibly bounce at ordinary walking speed.
      const MOVE_BOB_WALK_AMP = 0.0075;
      const MOVE_BOB_RUN_AMP  = 0.015;
      const ACCEL         = 980;  // px/s²; used by updateMovement() for snappier starts.
      const TURN_ACCEL    = 1320; // px/s²; used when input reverses or sharply turns.
      const DECEL         = 1850; // px/s²; used by updateMovement() to avoid floaty stops.
      const CARDINAL_BIAS = 0.18; // used by updateMovement(); lower keeps diagonals less sticky.
      const JOYSTICK_RADIUS = 56; // Fallback radius; updateJoystick() scales to the current viewport-anchored joystick size.
      const JOYSTICK_DEADZONE = 0.14; // used by updateJoystick() to prevent thumb drift near center.
      const JOYSTICK_RESPONSE = 0.82; // used by updateJoystick() to make small thumb motion feel responsive.
      // Floating camera-look joystick (materializes under the thumb on a
      // right-half touch — see cameraDragRequested/updateCameraJoystick).
      // Same deadzone/response shape as the movement joystick, but the knob
      // offset drives an ongoing turn RATE for as long as it's held off
      // center, instead of the movement stick's instantaneous speed/direction.
      const CAMERA_JOYSTICK_RADIUS = 56;
      const CAMERA_JOYSTICK_DEADZONE = 0.14;
      const CAMERA_JOYSTICK_RESPONSE = 0.82;
      const CAMERA_JOYSTICK_DEG_PER_SEC = 150; // turn rate at full deflection
      const ACTION_FX_LIMIT = 90; // used by spawnActionParticles()/updateActionParticles() to cap mobile effects.
      const FLOW_SOURCE_ROW = 0;
      const DAY_LENGTH_SECONDS = 288; // 4x the original 72s — time now runs at 25% speed
      const MORNING_HOUR = 6;
      const NIGHT_HOUR   = 22;
      // Khymeryyan civil calendar (week/month/year names + lengths) now
      // lives in js/calendar-system.js (window.CalendarSystem) — MORNING_HOUR/
      // NIGHT_HOUR above stay here since the day/weather tick and lighting
      // code also read them, and are threaded into CalendarSystem.init(...)
      // below as deps.

      // ── Modular player house ────────────────────────────────────────
      // Replaces the old singular Highland House GLB (see js/house-pieces.js,
      // window.HousePieces). The interior grid is just the farm grid at 2x
      // resolution — every exterior farm tile a built house piece occupies
      // contributes a 2x2 interior cell block (see
      // HousePieces.computeInteriorLayout()) — sized to the whole farm
      // rather than tightly to the current house, since the merged interior
      // grows as more pieces get built.
      const INTERIOR_COLS        = COLS * 2;
      const INTERIOR_ROWS        = ROWS * 2;
      const INTERIOR_WALL_HEIGHT = 1.75; // wall height in world units

      // ── Voxel render constants ──
      // Each tile is drawn as a top-down oblique voxel stack.
      // VSKEW: how many px the top-face shifts up per Z unit (isometric feel)
      // VSLICE: height of each Z-slab in screen pixels
      const VSKEW  = 8;   // px upward shift per +1 Z (raised) / downward per -1 Z (trench)
      const VSLICE = 5;   // px height of one Z level's side face

      // ── Water simulation constants ──
      // Water is a float depth (0..MAX_WATER) sitting above the tile floor.
      // MAX_WATER/RAIN_RATE stay here (rather than moving into
      // js/water-system.js with the rest of the sim) because other game.js
      // code beyond the water sim itself reads them: the HUD precip/depth
      // readouts, the day-one farm pond init, crop water-fitness, and
      // AudioSystem's splash-sound threshold. Threaded into WaterSystem via
      // its init(deps) call below. The rest of the sim's tuning constants
      // (absorption/evaporation/flow rates, siltation, edge tracking) now
      // live in js/water-system.js, private to that module.
      const MAX_WATER    = 3.0;  // max depth in "units"
      const RAIN_RATE    = 0.018; // depth added per sim tick during rain (×rainStrength)

      // ── Game data ──
      // Regional seasons (Stormtide/Deadgrass/Longpour/Coldmuck) also moved
      // into js/calendar-system.js alongside the calendar derivations —
      // access via window.CalendarSystem.currentSeason()/seasonForDay(day).
      // season.grassColor/grassDensity still drive the ground tile material
      // and grass billboard tufts here (see applySeasonalGrassAppearance()),
      // and season.rainChance/stormChance still drive the weather roll
      // (see chooseWeatherForDay()) — both read the season object returned
      // by those CalendarSystem calls rather than the raw table.
      // Deadgrass rolls as low as a 6% rain chance per day and runs 8
      // weeks (56 days) straight, long enough in real time to read as "it
      // never rains anymore." chooseWeatherForDay()'s pity timer guarantees a
      // rain day whenever the drought runs past this many days, without
      // touching the per-season odds the rest of the time. Declared
      // here (rather than next to chooseWeatherForDay() itself, much further
      // down) because createInitialGrid() calls chooseWeatherForDay() during
      // startup, well before that later point in the file — a `const` placed
      // after that call site would be in its temporal dead zone and throw.
      const RAIN_PITY_DAYS = 5;

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

      // Each tool gets at most 3 actions — the action bar only has 3 tool-
      // action button slots (btnAction1-3, see refreshActionBar/applyAbt),
      // so a 4th entry here would silently never get a button at all.
      const toolActions = {
        shovel:  ['dig', 'raise', 'fill'],
        hoe:     ['till', 'smooth'],
        machete: ['cut', 'slash'],
        axe:     ['chop', 'hack'],
        // Pick is mine-only — dig/raise/fill are the shovel's job; equip
        // the shovel slot for terrain work instead.
        pick:    ['mine'],
        harpoon: ['fish'],
        weapon:  ['cut', 'slash', 'potion_select'],
        ranged:  ['shoot', 'ammo_select', 'potion_select'],
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
        chop:       ['🪓', 'Chop'],
        hack:       ['💢', 'Hack'],
        mine:       ['⛏️', 'Mine'],
        ammo_select:['🏹', 'Ammo'],
        potion_select:['🧪', 'Potions'],
        harvest:    ['🧺', 'Harvest'],
        fish:       ['🎣', 'Fish'],
        shoot:      ['🏹', 'Fire / Load'],
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
        path:   { topColor: '#b8956a', sideColor: '#8a6a3a', label: 'path'     },
        river:  { topColor: '#2f6fb8', sideColor: '#1f4d80', label: 'river'    },
        stream: { topColor: '#4f9bd9', sideColor: '#356f99', label: 'stream'   },
      };

      // Footstep/one-shot combat/object/creature SFX (footstepSurfaceKey,
      // playFootstepSfx, playObjectSfx, playWeaponHitSfx, etc.) now live in
      // js/audio-system.js (window.AudioSystem).

      // floorZ/tileWaterCapacity (water-sim-only helpers) now live in
      // js/water-system.js, private to that module.
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
        emoji: '🧑‍🌾',
        health: 100, maxHealth: 100,
        stamina: 100, maxStamina: 100,
        // Multiplier applied to dig/fill/redig swing durations — 1 = base speed.
        // Tools, skills, etc. can raise this later to charge through trench work faster.
        digSpeed: 1,
        invulnUntil: 0,
        dodging: false, dodgeT: 0, dodgeDirX: 0, dodgeDirY: 0, dodgeCooldownT: 0,
        knockbackT: 0, knockbackVX: 0, knockbackVY: 0,
        // Combat lunge — a short forward step/leap layered under an attack's
        // windup/strike (combo/quick attacks/charged breaker; flurries and
        // Counter Shield's riposte don't use this). lungeStartX/Y anchor the
        // eased interpolation so partial collision blocking doesn't drift the
        // curve; lungeHopUnits/lungeHopCurrent drive an optional cosmetic
        // vertical arc (world-Y units, not pixels) for the charged breaker's leap.
        lunging: false, lungeT: 0, lungeDur: 0, lungeStartX: 0, lungeStartY: 0,
        lungeDirX: 0, lungeDirY: 0, lungeDistancePx: 0, lungeHopUnits: 0, lungeHopCurrent: 0,
        lungeHeightUnits: 1.0, // Potion/food effects can adjust the player's vertical leap budget before the next attack.
        lungeAimPitch: 0, lungeHitTest: null, // Pitch is shared by the leap, 3D cone, and trail.
        // Cliff climbing — see startClimb()/updateMovement. A scripted crossing
        // (no stamina cost, no terrain collision) rendered as a chain of
        // staggered hops rather than a continuous slide; climbSurfaceY/
        // climbHopBounce are consumed by updatePlayerMesh for the vertical rise.
        climbing: false, climbElapsed: 0, climbHopCount: 0,
        climbStartX: 0, climbStartY: 0, climbEndX: 0, climbEndY: 0,
        climbSurfaceStartY: 0, climbSurfaceEndY: 0, climbSurfaceY: 0, climbHopBounce: 0,
        // Standing on a climbable tree branch (see climb-system.js's
        // beginOnBranch) — onBranch holds the branch descriptor, branchT is
        // the 0..1 position along it, branchSurfaceY is that branch's own
        // height (used instead of terrain-follow while onBranch is set).
        onBranch: null, branchT: 0, branchSurfaceY: 0,
      };

      // All players present in this session — just the local `player` today
      // (there is no networking in this repo yet). Hostile-creature target
      // acquisition reads from this list via nearestPlayer() below instead
      // of hardcoding `player` directly, so a second connected player would
      // just need to be pushed into this array for hostiles to be able to
      // notice and chase them too, with nothing in the AI itself to change.
      const players = [player];

      // Nearest live player to (x, y) — see updateHostiles' targetPlayer.
      // Identical to hardcoding `player` while `players` has one entry.
      function nearestPlayer(x, y) {
        let best = null, bestDist = Infinity;
        for (const p of players) {
          const d = Math.hypot(p.x - x, p.y - y);
          if (d < bestDist) { best = p; bestDist = d; }
        }
        return best;
      }

      // Health/Stamina afflictions + Exhausted/black-stamina debt — see
      // docs/js/combat/resource-system.js. Adds player.afflictions/
      // exhaustion/lastAttack*At without disturbing the flat health/
      // maxHealth/stamina/maxStamina fields everything else already reads.
      window.ResourceSystem?.initEntity(player);

      // Combat tuning is config-backed so tool hit cones, stamina costs, trails,
      // and combat reticles can be tuned without changing code.
      function combatConfig() {
        return window.SCRATCHBONES_CONFIG?.game?.combat || {};
      }
      function weaponAbility(action) {
        // docs/config/combat/attack-values.json (authored via the Attack
        // Editor) is the real source of truth once it's loaded — falls back
        // to scratchbones-config.js's copy (the original, still-synchronous
        // definition) if the fetch hasn't resolved yet or failed.
        const cfg = window.__attackValuesConfig?.weaponAbilities?.[action] || combatConfig().weaponAbilities?.[action];
        if (!cfg) return null;
        // A smith-crafted verdigris weapon's damage scales with its
        // effective metal tier (see toolMetalMultiplier) — reinforcement-
        // aware, so a reinforced tool fights at the reinforcing metal's
        // power even though its own base-metal identity never changes.
        const metalMul = toolMetalMultiplier(equipmentSlots.weapon);
        return {
          damage: (Number(cfg.damage) || 0) * metalMul,
          halfConeRad: (Number(cfg.halfConeDeg) || 0) * Math.PI / 180,
          rangePx: TILE * (Number(cfg.rangeTiles) || 0),
          staminaCost: Number(cfg.staminaCost) || 0,
          knockbackPxS: Number(cfg.knockbackPxS) || 0,
          trailHalfWidthTiles: Number(cfg.trailHalfWidthTiles) || 0,
          trailFarTiles: Number(cfg.trailFarTiles) || 0,
          trailMaxAgeSeconds: Number(cfg.trailMaxAgeSeconds) || 0
        };
      }

      // Z-target-style auto lock: while a hostile is this close, facing tracks
      // it instead of movement direction, so strafing/repositioning in combat
      // doesn't spin the character away from the thing it's fighting.

      // Knockback shared by all combat attacks: a short impulse that overrides
      // normal movement/AI while it decays, applied away from the attacker.
      const KNOCKBACK_DUR_S = 0.18;
      const PLAYER_KNOCKBACK_PX_S = 600;
      const COMPANION_BITE_KNOCKBACK_PX_S = 560;
      const HOSTILE_BITE_KNOCKBACK_PX_S = 480;
      const PRONE_THROW_DUR_S = 0.34; // Drives the footing-break displacement channel consumed by prone player/creature updates.
      const PRONE_THROW_PLAYER_MIN_PX_S = 600; // Guarantees a readable player throw when a source supplied no ordinary knockback speed.
      const PRONE_THROW_CREATURE_MIN_PX_S = 480; // Gives animals/bandits a minimum throw at the existing hostile-bite scale.

      function applyKnockback(target, fromX, fromY, speedPxS) {
        if (target.onBranch) {
          // Knockback while standing on a branch is resolved along the
          // branch's own 1D axis instead of the usual free-plane impulse —
          // if it doesn't push the target past either end, that's the whole
          // effect (see resolveBranchKnockback). Pushed past an end, the
          // target falls to the ground and lands hard rather than sliding —
          // a flat Footing hit instead of the velocity impulse below.
          const result = window.ClimbSystem?.resolveBranchKnockback(target, fromX, fromY, speedPxS);
          if (result?.fell) {
            // Branch falls are a real landing event: a small Health hit plus
            // a large Footing hit, with a floor of one remaining Health.
            const currentHealth = Number(target.health);
            const impactHealth = Math.min(4, Math.max(0, (Number.isFinite(currentHealth) ? currentHealth : 1) - 1));
            if (impactHealth > 0) window.ResourceSystem?.applyDamage?.(target, impactHealth, { tag: 'blunt', source: 'fell from branch' });
            window.ResourceSystem?.spendFooting?.(target, 47.5, 'fell from branch');
            if (target === player) { _nestHoldT = 0; target._nestTakeActive = false; }
            if (target.lunging) { target.lunging = false; target.lungeHopCurrent = 0; }
          }
          return;
        }
        const ang = Math.atan2(target.y - fromY, target.x - fromX);
        target.knockbackT = KNOCKBACK_DUR_S;
        target.knockbackVX = Math.cos(ang) * speedPxS;
        target.knockbackVY = Math.sin(ang) * speedPxS;
        // Getting hit always interrupts an in-progress combat lunge — without
        // this, resuming the lunge after knockback would interpolate from its
        // stale pre-knockback lungeStartX/Y and jump the player backward.
        if (target.lunging) { target.lunging = false; target.lungeHopCurrent = 0; }
      }

      function startProneThrow(entity, isPlayer, facingAngle, direction) {
        let vx = Number(entity.knockbackVX) || 0;
        let vy = Number(entity.knockbackVY) || 0;
        const minSpeed = isPlayer ? PRONE_THROW_PLAYER_MIN_PX_S : PRONE_THROW_CREATURE_MIN_PX_S;
        const existingSpeed = Math.hypot(vx, vy);
        if (existingSpeed > 1e-6) {
          const speed = Math.max(existingSpeed, minSpeed);
          vx = vx / existingSpeed * speed;
          vy = vy / existingSpeed * speed;
        } else {
          // Reconstruct the attack bearing from the classified hit pole when
          // a damage source has no conventional knockback vector.
          const attackerOffset = direction === 'right' ? Math.PI / 2
            : direction === 'left' ? -Math.PI / 2
            : direction === 'back' ? Math.PI
            : 0;
          const awayAngle = (Number(facingAngle) || 0) + attackerOffset + Math.PI;
          vx = Math.cos(awayAngle) * minSpeed;
          vy = Math.sin(awayAngle) * minSpeed;
        }
        entity.proneThrowT = PRONE_THROW_DUR_S;
        entity.proneThrowVX = vx;
        entity.proneThrowVY = vy;
      }

      // Classifies where a hit landed relative to the victim's own facing,
      // in the same front/right/back/left buckets the tool's impact/
      // breakThrow blend clips are authored against (angleConvention:
      // front=0, right=90, back=180, left=-90 — see docs/config/animations/
      // impact-blend-v3.json's own angleConvention block). fromX/fromY is
      // the attack's origin (same param every damageCreature/damagePlayer
      // caller already passes for knockback); facingAngle is player.angle
      // for the player or c.facing for a creature.
      function hitDirectionRelativeToFacing(facingAngle, victimX, victimY, fromX, fromY) {
        if (fromX === undefined) return 'front';
        const attackerAngle = Math.atan2(fromY - victimY, fromX - victimX);
        let relDeg = (attackerAngle - facingAngle) * 180 / Math.PI;
        relDeg = ((relDeg + 180) % 360 + 360) % 360 - 180; // normalize to (-180, 180]
        if (relDeg > 45 && relDeg <= 135) return 'right';
        if (relDeg > -135 && relDeg <= -45) return 'left';
        if (relDeg > 135 || relDeg <= -135) return 'back';
        return 'front';
      }

      // Splits an incoming hit into Health and Footing amounts before either
      // resource is changed. Damage-type identity travels from each attack's
      // dmgOpts.tag through damageCreature/damagePlayer to this choke point.
      // Untuned tags retain the original amount; blunt trades 25% Health
      // damage for 25% more Footing pressure via scratchbones-config.js.
      function hitResourceDamage(amount, dmgOpts) {
        const multipliers = window.SCRATCHBONES_CONFIG?.game?.combat?.stagger?.damageTypeMultipliers?.[dmgOpts?.tag] || {};
        const healthMultiplier = Number(multipliers.healthDamage ?? 1);
        const footingMultiplier = Number(multipliers.footingDamage ?? 1);
        const footingOverride = Number(dmgOpts?.footingDamageMultiplier); // Ranged projectiles pass 0 by default; selected ammo can explicitly opt back in.
        return {
          health: amount * healthMultiplier,
          footing: amount * footingMultiplier * (Number.isFinite(footingOverride) ? Math.max(0, footingOverride) : 1),
        };
      }

      // Footing loss + stagger lockout for a landed hit that didn't kill its
      // target — called from damageCreature/damagePlayer right after their
      // existing cancel-in-progress-action + knockback sequence, only when
      // the victim survived. See docs/js/combat/resource-system.js's
      // spendFooting (Footing loss, immune while prone) and combat-core.js's
      // beginStagger (the actual attack lockout, read by every combat-*.js
      // ability module's own isStaggered guard).
      //
      // Duration starts at the configured tiny baseline and rises
      // quadratically toward one second as Footing approaches 1% remaining.
      // Scaling from the post-hit Footing value makes a punch-drunk fighter's
      // stagger visibly drag without making ordinary hits one-second stuns.
      // The player's direction-matched visual clip is retimed to that exact
      // gameplay duration. Thus every direction has the same stun at a given
      // Footing level even though the authored clips have different lengths.
      function applyHitStagger(entity, isPlayer, facingAngle, victimX, victimY, fromX, fromY, footingDamage) {
        if (!window.ResourceSystem || entity.prone) return;
        const direction = hitDirectionRelativeToFacing(facingAngle, victimX, victimY, fromX, fromY);
        const staggerCfg = window.SCRATCHBONES_CONFIG?.game?.combat?.stagger || {};
        const footingLossPerDamage = Number(staggerCfg.footingLossPerDamage);
        const baseDurationS = Number(staggerCfg.baseDurationSeconds);
        const maxDurationS = Number(staggerCfg.maxDurationSeconds);
        const maxDurationAtFootingFrac = Number(staggerCfg.maxDurationAtFootingFraction);
        window.ResourceSystem.spendFooting(entity, Math.max(0, footingDamage) * footingLossPerDamage, 'hit');

        // This hit emptied Footing — go straight to the full breakThrow
        // knockdown instead of playing a regular stagger reaction that would
        // just get immediately overwritten by it.
        if (entity.footing <= 0) {
          startProneThrow(entity, isPlayer, facingAngle, direction);
          enterProneIfFootingDepleted(entity, isPlayer, direction);
          return;
        }

        const footingFrac = entity.maxFooting ? clamp(entity.footing / entity.maxFooting, 0, 1) : 1;
        const lossRange = 1 - maxDurationAtFootingFrac;
        const staggerProgress = lossRange > 0 ? clamp((1 - footingFrac) / lossRange, 0, 1) : 1;
        const durationS = baseDurationS + (maxDurationS - baseDurationS) * staggerProgress * staggerProgress;

        const visualMinDurationS = Math.max(0, Number(staggerCfg.visualMinDurationSeconds) || 0);
        const visualDurationS = Math.max(durationS, visualMinDurationS);
        const clip = window.ImpactBlendLibrary?.getClip('impact', direction);
        const durationMultiplier = clip?.durationSeconds > 0 ? visualDurationS / clip.durationSeconds : 1;
        if (isPlayer) window.ImpactRagdollPlayback?.trigger('impact', direction, { durationMultiplier });
        else window.ImpactRagdollPlayback?.triggerCreature(entity, 'impact', direction, { durationSeconds: visualDurationS });
        window.Combat?.beginStagger(entity, direction, durationS);
      }

      // Drunken movement degradation — continuous with Footing, not a
      // discrete regular/drunken swap: read directly at updateMovement's own
      // targetSpeed/accel computation as an independent factor rather than
      // through Combat.setMovementSpeedMul, which is already a single slot
      // contested between combat-flurry.js and combat-blink-dodge.js. Scoped
      // to speed/acceleration/turn-response only for now — see this repo's
      // procedural-animation-editor tool for the fuller regular<->drunken
      // pose-sway blend this deliberately doesn't also port onto the live
      // rig (no existing system applies an authored body-lean pose to the
      // live avatar the way this one does foot IK, and building a second
      // clip-sampling pipeline for a purely cosmetic effect isn't worth it
      // here — a future pass can add a lightweight sinusoidal wobble on the
      // avatar root instead, scaled by the same footing-loss fraction below).
      const FOOTING_SPEED_MUL_MIN = 0.55;
      function getFootingSpeedMul(entity) {
        if (!entity || !(entity.maxFooting > 0)) return 1;
        const frac = clamp(entity.footing / entity.maxFooting, 0, 1);
        return FOOTING_SPEED_MUL_MIN + (1 - FOOTING_SPEED_MUL_MIN) * frac;
      }

      // Forced disengage-jump duration for a creature/bandit whose Footing
      // has just recovered to full after going prone — longer than the
      // ordinary post-combo jump-back (JUMP_BACK_DUR_S, 0.4s) since this is
      // an unconditional flee, not a chained retreat between combo cycles.
      const FORCED_SOMERSAULT_RETREAT_S = 0.6;
      const SOMERSAULT_STAMINA_COST = 30;

      // Zero-Footing transition — called only once applyHitStagger's own
      // spendFooting has already driven entity.footing to 0. Both the player
      // and any creature/bandit go fully prone here (immune to further
      // Footing loss — see resource-system.js's spendFooting), matching each
      // other exactly; they differ only in how they LEAVE prone: the player
      // needs a dodge input once Footing is back to full (see performDodge's
      // somersault-recovery hook below), while a creature/bandit's own AI
      // does it automatically the instant its Footing reaches full — see
      // updateHostiles' own `if (c.prone)` branch, which calls
      // beginCreatureSomersaultRecovery below once c.footing >= c.maxFooting.
      // Creature planes use the same authored clips through
      // ImpactRagdollPlayback's quarter-turned body-only adapter; humanoid leg
      // channels remain player-only. Both kinds use a dedicated prone-throw
      // displacement so compatibility adapters can still clear stale ordinary
      // knockback without erasing the intentional knockdown launch.
      function enterProneIfFootingDepleted(entity, isPlayer, direction) {
        if (entity.footing > 0 || entity.prone) return;
        entity.prone = true;
        // damageCreature already cancelled any in-progress attack; the
        // creature playback holds its final breakThrow frame until recovery.
        if (!isPlayer) {
          window.ImpactRagdollPlayback?.triggerCreature(entity, 'breakThrow', direction, { durationMultiplier: 1 });
          return;
        }
        player.somersaultRecovering = false;
        player.vx = 0; player.vy = 0;
        window.Combat?.cancelAllStaged?.();
        window.ImpactRagdollPlayback?.trigger('breakThrow', direction, { durationMultiplier: 1 });
      }

      // Called from updateHostiles once a prone creature's Footing is back
      // to full — forces it back into 'chase' (so updateBanditCombatAI's/
      // the plain-wildlife retreatT branch's existing jump-back movement
      // actually picks it up next frame) and spends stamina first, so an
      // already-gassed creature can overspend straight into Exhausted (see
      // resource-system.js's spendStamina -> enterExhausted) — exhaustion
      // chaining falls out of that existing call for free.
      function beginCreatureSomersaultRecovery(c, targetPlayer) {
        c.prone = false;
        c.state = 'chase';
        c.targetPlayer = targetPlayer;
        window.ResourceSystem?.spendStamina(c, SOMERSAULT_STAMINA_COST, 'somersault recovery');
        c.retreatT = Math.max(c.retreatT || 0, FORCED_SOMERSAULT_RETREAT_S);
      }

      function advanceCreatureProneThrow(c, dt) {
        if (!(c.proneThrowT > 0)) return false;
        c.proneThrowT = Math.max(0, c.proneThrowT - dt);
        const nextX = c.x + (Number(c.proneThrowVX) || 0) * dt;
        const nextY = c.y + (Number(c.proneThrowVY) || 0) * dt;
        const swept = sweptMove(c.x, c.y, nextX, nextY, (x, y) => canOccupyAt(x, y, TILE * 0.32));
        c.x = swept.x; c.y = swept.y;
        if (swept.blockedX) c.proneThrowVX = 0;
        if (swept.blockedY) c.proneThrowVY = 0;
        if (c.proneThrowT <= 0) { c.proneThrowVX = 0; c.proneThrowVY = 0; }
        return true;
      }

      const PLAYER_STAMINA_REGEN = 14;   // per second
      const PLAYER_HEALTH_REGEN  = 1.2;  // per second, passive
      const DODGE_DUR_S = 0.22;
      const DODGE_SPEED_PX = 640;
      const DODGE_IFRAME_MS = 380;
      const DODGE_COOLDOWN_S = 0.6;
      const DODGE_STAMINA_COST = 18;

      // Multiplier applied to both the player's and a non-swimming
      // creature's movement speed while standing in a river/stream tile —
      // see tileSpeedAt (player) and moveCreatureToward (creatures). A
      // creature/player tagged canSwim ignores this and moves at full
      // speed in water. Attacking is disallowed while swimming regardless
      // of species — see isPlayerSwimming/isCreatureSwimming.
      const SWIM_SPEED_MUL = 0.5;
      // Same idea as SWIM_SPEED_MUL, for cliff (incline) tiles — see
      // moveCreatureToward/isCreatureClimbing.
      const CLIMB_SPEED_MUL = 0.5;

      // Global creature database — companions (whistle-bound) and hostiles
      // (ambient-spawned) are both built from this table. Species sizes that
      // need live tuning are sourced from scratchbones-config.js rather than
      // being duplicated as literals in this database.
      const WILDLIFE_CREATURE_MODEL_WIDTHS = window.SCRATCHBONES_CONFIG?.game?.wildlife?.creatureModelWidths || {};
      // canClimb: default false — a creature without the tag can still enter
      // an incline (cliff wall) tile (no longer a hard block), just at
      // CLIMB_SPEED_MUL speed, same as a non-swimmer crossing water. canSwim:
      // default false — a creature without the tag can still enter a
      // river/stream tile (it's no longer a hard block), just at
      // SWIM_SPEED_MUL speed and unable to attack while in it. See
      // moveCreatureToward/isCreatureClimbing/isCreatureSwimming.
      const CREATURE_DB = {
        'dabinggi-hound': {
          label: 'Dabinggi-hound', hostile: false,
          maxHealth: 50, maxStamina: 40,
          moveSpeed: 165, chaseSpeed: 220,
          attackDamage: 10, attackRangePx: TILE * 0.9, attackHalfConeRad: 45 * Math.PI / 180,
          attackStaminaCost: 14, attackCooldownS: 1.1,
          attacks: ['pounce'],
          // Every named/generic attack this species has access to (Pounce,
          // the plain bite telegraph, guardCharge) is tagged through this one
          // field — see resource-system.js's applyDamage — so a tamed
          // dabinggi-hound's bite/pounce afflicts Poisoned Health instead of
          // the wolves' Bleeding/Wounded.
          attackTag: 'poison',
          // Companion AI-type this species uses when summoned as an active
          // companion (see COMPANION_AI_TYPES) — 'vigilantProtector' is
          // updateCompanions()'s existing follow/fight behavior.
          aiType: 'vigilantProtector',
          // Base sense range (tiles) for a nearby bandit camp or animal den
          // through cover/foliage — scaled by PERCEPTION_TILES_MULTIPLIER
          // for the real in-game range (see updateCompanionPerception /
          // _companionPerceptionRangePx). A hunting dog's nose beats a farm
          // bird's (see uumkaoii's own value below); species with no
          // perceptionTiles set fall back to DEFAULT_PERCEPTION_TILES.
          perceptionTiles: 10,
          canClimb: false, canSwim: false,
          modelWidth: 1.9, tint: 0xffffff,
          // Default Size for the personal stable's mount/companion/shoulder-
          // pet gating (see CREATURE_SIZE_CLASSES/stableEntryRole) — a rare
          // hereditary mutation can still shift an individual specimen's
          // genotype.sizeClass away from this species default on breeding.
          defaultSizeClass: 'medium',
          // How fast riding this species as a mount lets the player move
          // (px/s, same units as MOVE_SPEED — see activeMountSpeedMul).
          // Independent per species; every stable-able species currently
          // shares this same value, deliberately well above MOVE_SPEED (238).
          mountSpeed: 340,
          sprites: {
            idle: 'assets/creaturesprites/dabinggi-hound_idle.png',
            run: ['assets/creaturesprites/dabinggi-hound_run1.png', 'assets/creaturesprites/dabinggi-hound_run2.png'],
          },
          lootPool: 'creature_dabinggi-hound',
        },
        // Uumkao'ii as an active companion — a separate, continuous-movement
        // CREATURE_DB entry (not the tile-hopping farm-livestock system in
        // LIVESTOCK_FACTORIES/makeUumkaoiiAnimal) so a stabled Uumkao'ii can
        // be summoned via the same generic companion AI as the dabinggi-hound.
        // Routed to 'vigilantProtector' as a stand-in per design direction —
        // a gentler, dedicated AI type can replace this once one exists.
        // Reuses the existing livestock sprite as-is (already the right
        // 1375x600 side-view sheet convention makeCreatureEntity expects).
        uumkaoii: {
          label: "Uumkao'ii", hostile: false,
          maxHealth: 40, maxStamina: 30,
          moveSpeed: 130, chaseSpeed: 165,
          attackDamage: 6, attackRangePx: TILE * 0.8, attackHalfConeRad: 45 * Math.PI / 180,
          attackStaminaCost: 12, attackCooldownS: 1.3,
          attacks: ['pounce'],
          attackTag: 'blunt', // a peaceable farm bird's bump/peck, not a real bite
          aiType: 'vigilantProtector',
          // See dabinggi-hound's matching comment — a farm bird's senses are
          // no match for a hound's nose.
          perceptionTiles: 5,
          canClimb: false, canSwim: false,
          modelWidth: 1.6, tint: 0xffffff, lungeHeightUnits: 0.08, // Nearly grounded; high aim should shed almost all travel.
          // See dabinggi-hound's matching comment — Uumkao'ii default large
          // (mount-eligible in the stable).
          defaultSizeClass: 'large',
          mountSpeed: 340,
          sprites: {
            idle: "assets/creaturesprites/uumkao'ii.png",
            run: ["assets/creaturesprites/uumkao'ii.png"],
          },
          lootPool: 'creature_uumkaoii',
        },
        'gar-wolf': {
          label: 'Gar-wolf', hostile: true, liveBirth: true,
          maxHealth: 38, maxStamina: 30,
          moveSpeed: 130, chaseSpeed: 195,
          attackDamage: 12, attackRangePx: TILE * 0.85, attackHalfConeRad: 42 * Math.PI / 180,
          attackStaminaCost: 12, attackCooldownS: 1.0,
          attacks: ['pounce'],
          // See dabinggi-hound's attackTag comment — gar-wolves bite/pounce
          // sharp, afflicting Bleeding Health + Wounded Stamina.
          attackTag: 'sharp',
          // Not tameable/stable-able yet, but expected to use this same
          // companion AI type long-term once that exists — see COMPANION_AI_TYPES.
          aiType: 'vigilantProtector',
          // Slottable AI behavior-stage cycle (see updateCreatureBehaviorStage):
          // try a Pounce for up to 7s (ends the moment one's attempted), then
          // (after the global ~2s backing-up stage) spend up to 11s circling
          // the target at range before cycling back to another Pounce attempt.
          behaviorStages: ['pounceAttempt', 'evasiveOrbit'],
          aggroRangePx: TILE * 6.2, leashRangePx: TILE * 9,
          canClimb: false, canSwim: false,
          modelWidth: 2.1, tint: 0xffffff,
          // See dabinggi-hound's matching comment.
          defaultSizeClass: 'medium',
          mountSpeed: 340,
          sprites: {
            idle: 'assets/creaturesprites/gar-wolf_idle.png',
            run: ['assets/creaturesprites/gar-wolf_run1.png', 'assets/creaturesprites/gar-wolf_run2.png'],
          },
          lootPool: 'creature_gar-wolf',
        },
        grehlr: {
          label: 'Grehlr', hostile: true, liveBirth: true,
          maxHealth: 52, maxStamina: 38, moveSpeed: 135, chaseSpeed: 205,
          attackDamage: 14, attackRangePx: TILE * 0.9, attackHalfConeRad: 44 * Math.PI / 180,
          attackStaminaCost: 13, attackCooldownS: 1.05,
          attacks: ['pounce'], attackTag: 'sharp', behaviorStages: ['pounceAttempt', 'evasiveOrbit'],
          aggroRangePx: TILE * 6.5, leashRangePx: TILE * 9,
          canClimb: true, canSwim: false, modelWidth: 2.2, spriteAspect: 2250 / 3000, tint: 0xffffff,
          // See dabinggi-hound's matching comment — Grehlr default large
          // (mount-eligible in the stable).
          defaultSizeClass: 'large',
          mountSpeed: 340,
          sprites: { idle: 'assets/creaturesprites/grehlr_idle.png', run: ['assets/creaturesprites/grehlr_run1.png', 'assets/creaturesprites/grehlr_run2.png'] },
          lootPool: 'creature_grehlr',
        },
        drenkirra: {
          label: 'Drenkirra', hostile: false, diet: 'herbivore', liveBirth: false,
          maxHealth: 44, maxStamina: 36, moveSpeed: 145, chaseSpeed: 210,
          attackDamage: 13, attackRangePx: TILE * 0.85, attackHalfConeRad: 43 * Math.PI / 180,
          attackStaminaCost: 12, attackCooldownS: 0.95,
          attacks: ['pounce'], attackTag: 'sharp', behaviorStages: ['pounceAttempt', 'evasiveOrbit'],
          aggroRangePx: TILE * 6, leashRangePx: TILE * 8.5,
          canClimb: false, canSwim: false, modelWidth: WILDLIFE_CREATURE_MODEL_WIDTHS.drenkirra, lungeHeightUnits: 2.4, spriteAspect: 523 / 831, tint: 0xffffff,
          // See dabinggi-hound's matching comment.
          defaultSizeClass: 'small',
          mountSpeed: 340,
          sprites: { idle: 'assets/creaturesprites/drenkirra_idle.png', run: ['assets/creaturesprites/drenkirra_run1.png', 'assets/creaturesprites/drenkirra_run2.png'] },
          lootPool: 'creature_drenkirra',
        },
        'gar-wolf-alpha': {
          label: 'Gar-wolf Alpha', hostile: true, liveBirth: true,
          maxHealth: 78, maxStamina: 46,
          moveSpeed: 140, chaseSpeed: 205,
          attackDamage: 18, attackRangePx: TILE * 0.95, attackHalfConeRad: 46 * Math.PI / 180,
          attackStaminaCost: 16, attackCooldownS: 1.0,
          attacks: ['pounce'],
          attackTag: 'sharp',
          behaviorStages: ['pounceAttempt', 'evasiveOrbit'],
          aggroRangePx: TILE * 7, leashRangePx: TILE * 10,
          canClimb: false, canSwim: false,
          modelWidth: 3.1, tint: 0xffb0a0,
          sprites: {
            idle: 'assets/creaturesprites/gar-wolf_idle.png',
            run: ['assets/creaturesprites/gar-wolf_run1.png', 'assets/creaturesprites/gar-wolf_run2.png'],
          },
          lootPool: 'creature_gar-wolf-alpha',
        },
        // A wild, huntable/fleeable herbivore for the den+foliage-patch
        // wildlife schedule AI (see EXTERIOR_ZONES.herbivoreSpecies/
        // spawnPackAtDen and updateHostiles' grazing/patrol states) — a
        // separate key from the companion `uumkaoii` above so its
        // aiType/follow fields don't leak onto a creature that never fights
        // or follows a master. `diet: 'herbivore'` is read by the patrol-
        // sighting check to find prey; no aggroRangePx/leashRangePx means it
        // never chases the player (see updateHostiles' aggro check). Not
        // connected to the farm-livestock breeding/genotype system.
        'uumkaoii-wild': {
          label: "Wild Uumkao'ii", hostile: false, diet: 'herbivore', liveBirth: false,
          maxHealth: 30, maxStamina: 20,
          moveSpeed: 110, chaseSpeed: 110,
          canClimb: false, canSwim: false,
          modelWidth: 1.6, tint: 0xffffff,
          sprites: {
            idle: "assets/creaturesprites/uumkao'ii.png",
            run: ["assets/creaturesprites/uumkao'ii.png"],
          },
          lootPool: 'creature_uumkaoii-wild',
        },
        // Den-Mother mini-bosses: one spawns per den cavern (see
        // pickDenMotherKind/loadBuildingScene's 'map_i_den_' handling),
        // guarding a 2x2 nest at the far end of the cavern and never leaving
        // it (very tight leashRangePx around the nest — otherwise plain
        // wander/chase/return like any other hostile, no schedule AI). Boosted
        // stats over the regular pack member, reused sprite with a darker
        // tint read as "bigger/tougher". `liveBirth` drives the nest's
        // "Taking Egg"/"Taking Baby" wording (see updateNestInteraction).
        'gar-wolf-den-mother': {
          label: 'Den-Mother', hostile: true, liveBirth: true,
          maxHealth: 240, maxStamina: 90,
          moveSpeed: 120, chaseSpeed: 175,
          attackDamage: 24, attackRangePx: TILE * 1.0, attackHalfConeRad: 46 * Math.PI / 180,
          attackStaminaCost: 16, attackCooldownS: 1.0,
          attacks: ['pounce'],
          attackTag: 'sharp',
          behaviorStages: ['pounceAttempt', 'evasiveOrbit'],
          aggroRangePx: TILE * 6, leashRangePx: TILE * 4.5,
          canClimb: false, canSwim: false,
          modelWidth: 3.6, tint: 0x6b4040,
          sprites: {
            idle: 'assets/creaturesprites/gar-wolf_idle.png',
            run: ['assets/creaturesprites/gar-wolf_run1.png', 'assets/creaturesprites/gar-wolf_run2.png'],
          },
          lootPool: 'creature_gar-wolf-den-mother',
        },
        'uumkaoii-wild-den-mother': {
          label: 'Den-Mother', hostile: true, liveBirth: false,
          maxHealth: 170, maxStamina: 70,
          moveSpeed: 95, chaseSpeed: 140,
          attackDamage: 17, attackRangePx: TILE * 0.9, attackHalfConeRad: 45 * Math.PI / 180,
          attackStaminaCost: 14, attackCooldownS: 1.1,
          attacks: ['pounce'],
          attackTag: 'blunt',
          aggroRangePx: TILE * 5.5, leashRangePx: TILE * 4.5,
          canClimb: false, canSwim: false,
          modelWidth: 2.8, tint: 0x8a6a3a,
          sprites: {
            idle: "assets/creaturesprites/uumkao'ii.png",
            run: ["assets/creaturesprites/uumkao'ii.png"],
          },
          lootPool: 'creature_uumkaoii-wild-den-mother',
        },
        'grehlr-den-mother': {
          label: 'Grehlr Den-Mother', hostile: true, liveBirth: true,
          maxHealth: 260, maxStamina: 95, moveSpeed: 120, chaseSpeed: 180,
          attackDamage: 26, attackRangePx: TILE, attackHalfConeRad: 46 * Math.PI / 180,
          attackStaminaCost: 17, attackCooldownS: 1.05,
          attacks: ['pounce'], attackTag: 'sharp', behaviorStages: ['pounceAttempt', 'evasiveOrbit'],
          aggroRangePx: TILE * 6, leashRangePx: TILE * 4.5,
          canClimb: true, canSwim: false, modelWidth: 3.1, spriteAspect: 2250 / 3000, tint: 0x806b74,
          sprites: { idle: 'assets/creaturesprites/grehlr_idle.png', run: ['assets/creaturesprites/grehlr_run1.png', 'assets/creaturesprites/grehlr_run2.png'] },
          lootPool: 'creature_grehlr-den-mother',
        },
        'drenkirra-den-mother': {
          label: 'Drenkirra Den-Mother', hostile: true, diet: 'herbivore', liveBirth: false,
          maxHealth: 220, maxStamina: 85, moveSpeed: 125, chaseSpeed: 185,
          attackDamage: 22, attackRangePx: TILE * 0.95, attackHalfConeRad: 45 * Math.PI / 180,
          attackStaminaCost: 15, attackCooldownS: 1.1,
          attacks: ['pounce'], attackTag: 'blunt', behaviorStages: ['pounceAttempt', 'evasiveOrbit'],
          aggroRangePx: TILE * 5.5, leashRangePx: TILE * 4.5,
          canClimb: false, canSwim: false, modelWidth: WILDLIFE_CREATURE_MODEL_WIDTHS['drenkirra-den-mother'], lungeHeightUnits: 2.8, spriteAspect: 523 / 831, tint: 0x789078,
          sprites: { idle: 'assets/creaturesprites/drenkirra_idle.png', run: ['assets/creaturesprites/drenkirra_run1.png', 'assets/creaturesprites/drenkirra_run2.png'] },
          lootPool: 'creature_drenkirra-den-mother',
        },
      };

      // Overrides CREATURE_DB's per-species attack* fields from
      // docs/config/combat/attack-values.json once
      // docs/js/combat/combat-config-loader.js's fetch resolves — same
      // synchronous-default-then-override pattern as every combat-*.js
      // module's applyXConfig, just without a dedicated module of its own
      // since CREATURE_DB lives directly in game.js. The bandit baseline
      // melee constants get the same treatment via
      // window.BanditCombat.applyBanditConfig (js/combat/combat-bandit.js
      // owns those now).
      window.__attackValuesConfigPromise?.then(cfg => {
        if (!cfg) return;
        if (cfg.creatures) {
          for (const [speciesId, def] of Object.entries(CREATURE_DB)) {
            const o = cfg.creatures[speciesId];
            if (!o) continue;
            if (o.attackDamage != null) def.attackDamage = o.attackDamage;
            if (o.attackRangeTiles != null) def.attackRangePx = TILE * o.attackRangeTiles;
            if (o.attackHalfConeDeg != null) def.attackHalfConeRad = o.attackHalfConeDeg * Math.PI / 180;
            if (o.attackStaminaCost != null) def.attackStaminaCost = o.attackStaminaCost;
            if (o.attackCooldownS != null) def.attackCooldownS = o.attackCooldownS;
            if (o.attackTag != null) def.attackTag = o.attackTag;
            if (Array.isArray(o.attacks)) def.attacks = o.attacks;
          }
        }
        window.BanditCombat?.applyBanditConfig(cfg.bandit);
      });

      // Minimal standalone exterior zones reachable from the town's pre-authored
      // "To Northern Cliffs" / "To Southern Cloud Forest" transition spots. Each
      // is a small flat all-grass map built lazily the first time it's entered;
      // this is where the ambient hostile spawns actually live now.
      const EXTERIOR_ZONES = {
        map_northern_cliffs: {
          label: 'Northern Cliffs',
          cols: 22, rows: 16,
          groundColor: 0x6b7280, fogColor: 0x3a4148,
          // Species pool a den's next pack is randomly drawn from (see
          // spawnPackAtDen) — no longer a single fixed hostileKey, since a
          // wiped-out den's replacement pack isn't necessarily the same
          // species as the one it replaces.
          packSpecies: ['grehlr'],
          // Species pool a den's next HERD is randomly drawn from, when a den
          // rolls a herbivore population instead of a predator pack this
          // cycle (see spawnPackAtDen) — kept as a sibling pool to packSpecies
          // since a den's population type is decided per spawn, not fixed.
          herbivoreSpecies: ['uumkaoii-wild'],
          entryCol: 11, entryRow: 14,
          exitCol: 11, exitRow: 15,
          townReturnCol: 30, townReturnRow: 2,
          audioIndex: 'northern_cliffs',
        },
        map_southern_cloud_forest: {
          label: 'Southern Cloud Forest',
          cols: 22, rows: 16,
          groundColor: 0x2d4a3a, fogColor: 0xffffff,
          // It's a *cloud* forest — thicker than the 0.018 every other zone
          // shares (see buildZoneScene's fogDensity fallback), and white
          // rather than every other zone's dark tint, so the mist itself
          // reads as part of the biome rather than an oversight. Layered on
          // top by CloudForestFog's player-centered mist cylinders (see
          // docs/js/cloud-forest-fog.js) for something with actual visual
          // presence, since a flat per-pixel exponential fog alone reads as
          // computed haze rather than something with real volume.
          fogDensity: 0.055,
          // updateZoneVegetationCulling uses this zone's presence here to
          // switch from the other zones' camera-forward/rear/width box to a
          // simple circle around the player — originally paired with
          // CloudForestFog's outer mist cylinder so the ring where
          // vegetation pops in/out sat inside the mist in every direction
          // rather than just character-forward. This is now just the
          // startup default: both the live cull radius and each fog layer's
          // own radius/opacity are independently Settings-tab sliders (see
          // s_cloudForestCullRadiusTiles and CloudForestFog's setLayerRadius/
          // setLayerOpacity) — lowered from 34 to 30 by default since the
          // full 34-tile radius was a real contributor to reported
          // choppiness in this zone. At 34, fogDensity above had already
          // made FogExp2 ~97% opaque out there, hiding the vegetation
          // pop-in; at the smaller default the pop-in ring is more likely
          // to be visible, tunable back up via the slider if that matters
          // more than the performance it costs.
          vegCullRadiusTiles: 30,
          // Previously the only zone with no packSpecies pool at all, so
          // gar-wolf (a real CREATURE_DB/DEN_MOTHER_DEFS entry — see
          // scratchbones-config.js's wildlife.denMothers) had no zone to
          // ever spawn from, anywhere.
          packSpecies: ['gar-wolf'],
          // Drenkirra no longer den here — nativeSpeciesFor/spawnPackAtDen
          // (via this pool) decide both a den's exterior pack and its
          // cavern Den-Mother, and drenkirra now nest on shadewood branches
          // instead (see wildlife-spawn.js's ensureCurrentZoneNestTrees),
          // so every den in this zone is a gar-wolf den.
          herbivoreSpecies: [],
          entryCol: 11, entryRow: 1,
          exitCol: 11, exitRow: 0,
          townReturnCol: 30, townReturnRow: 48,
          // No zone-specific cue pack recorded yet — 'general' keeps this
          // zone from being dead silent (no areaBgm track exists for it
          // either) until one gets authored, same as farm/town's default.
          audioIndex: 'general',
        },
        // Western Slope/Eastern Mire have always had real authored layouts in
        // town-workspace-v1.json (unlike the two placeholder zones above), but
        // never got an EXTERIOR_ZONES entry of their own — so their "back to
        // town" ring (which reads zdef.townReturnCol/Row, not zoneData) sent
        // the player to clamp(undefined, ...) === NaN. townReturnCol/Row below
        // are one tile inside town from that zone's own town-side transition
        // spot (spot_2vsub at col 0, row 25 / spot_d33e9 at col 59, row 25 in
        // hobunji_hollow_town.map.json). entryCol/Row/exitCol/Row match the
        // authored zone's own "To Hobunji Hollow" spot (sp_wslope_e / sp_emi_west)
        // — one gate tile serving both directions, same as the two zones above.
        map_western_slope: {
          label: 'Western Slope',
          cols: 50, rows: 40,
          groundColor: 0x6b6a52, fogColor: 0x35342a,
          herbivoreSpecies: ['uumkaoii-wild'],
          entryCol: 48, entryRow: 20,
          exitCol: 48, exitRow: 20,
          townReturnCol: 1, townReturnRow: 25,
          // See map_southern_cloud_forest above — no zone-specific cue pack yet.
          audioIndex: 'general',
        },
        map_eastern_mire: {
          label: 'Eastern Mire',
          cols: 50, rows: 40,
          groundColor: 0x3a4a3a, fogColor: 0x22301f,
          herbivoreSpecies: ['uumkaoii-wild'],
          entryCol: 1, entryRow: 20,
          exitCol: 1, exitRow: 20,
          townReturnCol: 58, townReturnRow: 25,
          // See map_southern_cloud_forest above — no zone-specific cue pack yet.
          audioIndex: 'general',
        },
        // Dev-only sandbox — reachable solely through Settings' "Teleport to
        // Test Arena" button (see teleportToDevArena), never through a town
        // transition spot. No packSpecies/herbivoreSpecies pool means it never
        // spawns ambient wildlife on its own (see spawnPackAtDen's empty-pool
        // early-return) — every creature in it comes from the dev spawn menu
        // that replaces the farm-editor pencil button while standing here
        // (see _refreshEditorButtonVisibility). exitCol/Row sits in a back
        // corner, well away from the entry/spawn point, purely as a walk-out
        // safety valve back to town if the Settings button is ever unreachable.
        map_dev_arena: {
          label: 'Testing Arena',
          cols: 18, rows: 18,
          groundColor: 0x55565c, fogColor: 0x24262c,
          entryCol: 9, entryRow: 9,
          exitCol: 1, exitRow: 1,
          townReturnCol: 30, townReturnRow: 2,
          audioIndex: 'general',
        },
      };
      function _isZoneArea(area) { return typeof area === 'string' && (!!EXTERIOR_ZONES[area] || _zoneLayouts.has(area)); }

      // Used by input polling; supports both keyboard and touch joystick.
      const input = {
        x: 0,
        y: 0,
        keys: new Set(),
        joystickPointerId: null
      };

      // Used by calendarHud and water simulation to turn rain into an automatic timed condition.
      const calendar = {
        day: 1,            // Anan, Waxingheat 1st — week 3 of Stormtide (its band wraps the year: 47-48, then 1-14), year 1
        time01: 0.30,      // ~10:30 AM — mid-morning, well into a rain window
        weather: 'rain',
        isRaining: true,
        rainStrength: 2,
        nextRainWindows: [{ start: 8, end: 14, strength: 2 }],
        lastRainDay: 1      // last day a rain/storm window was scheduled — drives the drought pity timer below
      };

      // Used by inventoryHud and planting/harvesting actions.
      // Only real starting stacks are listed; generic empty boxes are drawn by buildInventoryGrid().
      const STARTING_INVENTORY = {
        needlegrainSeeds: 6, heftrootSeeds: 4, garlinkSeeds: 4, ongyumsSeeds: 4,
        // Berry seeds are deliberately absent — not purchasable either; all
        // 5 varieties grow wild across the wilderness zones instead (see
        // WILD_BERRY_ZONES) and have a small chance to yield a seed when
        // foraged, which is the only way to get one.
        blackMustardSeed: 3, greenMustardSeed: 3,
        uumkaoiiCrate: 1,
        barnPlanSmall: 1,
        campfireKitFurnitureBlueprint: 1, // Always-available campfire blueprint — see DECORATIVE_FURNITURE_DEFS.campfire; blueprints are reusable (see craftFurnitureFromBlueprint), so one copy is permanent.
        gold: 40,
      };

      // Used by inventoryHud and planting/harvesting actions.
      // inventoryProxy reports live item gains and gold changes to WorldPopupText;
      // boot/save restoration is ignored until window.__hobunjiGameStarted is true.
      const inventory = new Proxy({ ...STARTING_INVENTORY }, {
        set(target, key, value) {
          const before = Number(target[key]) || 0;
          const applied = Reflect.set(target, key, value);
          const delta = (Number(value) || 0) - before;
          if (applied && delta && window.__hobunjiGameStarted && window.WorldPopupText) {
            if (key === 'gold') {
              window.WorldPopupText.queueReward('currency', `${delta > 0 ? '+' : '-'}${Math.abs(delta)}g`);
            } else if (delta > 0) {
              const def = ITEM_DEFS[key];
              window.WorldPopupText.queueReward('loot', `+${delta} ${def?.label || key}`);
            }
          }
          return applied;
        },
      });

      let gearInventory = null; // Loaded from player profile — character-scoped
      let packClothing  = [];   // Clothing items in world/pack inventory

      // Personal livestock collection ("the stable") — character-scoped like
      // gearInventory, travels between worlds. Distinct from a farm's
      // world-scoped livestock: stable animals are companions (nameable,
      // eventually levelable), can't produce goods, and can't be placed on
      // any farm. [{ id, kind, name, genotype, aiType, level, stabledAt }]
      let stable = [];
      let activeCompanionId = null; // which stable entry (if any) is the active (medium-Size) companion
      let activeMountId = null;       // which stable entry (if any) is the active (large-Size) mount
      let activeShoulderPetId = null; // which stable entry (if any) is the active (small-Size) shoulder pet

      // Companion AI-type registry — a small database of follow/fight
      // behaviors a stabled species' active-companion form can use, keyed by
      // id so multiple species can share one implementation. 'vigilantProtector'
      // wraps the dabinggi-hound's existing whistle-summon follow/fight AI
      // (see the whistle/companion system further down); Uumkao'ii is routed
      // to it as a stand-in until a more tailored AI type exists, and
      // gar-wolves are expected to just use it for the foreseeable future.
      const COMPANION_AI_TYPES = {
        vigilantProtector: { id: 'vigilantProtector', label: 'Vigilant Protector' },
      };
      const COMPANION_AI_TYPE_BY_KIND = {
        'dabinggi-hound': 'vigilantProtector',
        'gar-wolf':       'vigilantProtector',
        'uumkaoii':       'vigilantProtector', // stand-in until a dedicated AI type exists
      };
      function companionAiTypeForKind(kind) {
        return COMPANION_AI_TYPE_BY_KIND[kind] || 'vigilantProtector';
      }

      // Auto-equips a freshly-stabled entry into its Size-appropriate slot if
      // that slot is currently empty (mirrors the old "first companion is
      // automatically active" convenience, generalized to 3 slots).
      function _autoAssignStableRole(entry) {
        const role = window.CreatureGenetics.stableEntryRole(entry);
        if (role === 'mount' && !activeMountId) activeMountId = entry.id;
        else if (role === 'shoulderPet' && !activeShoulderPetId) activeShoulderPetId = entry.id;
        else if (role === 'companion' && !activeCompanionId) activeCompanionId = entry.id;
      }

      // Tool item definitions: sprite path, compatible slots, animation style
      // dmgType ('sharp'|'blunt', weapon-slot items only) picks which flavor
      // of affliction options the whole weapon-tool ability kit offers (see
      // combat-progression.js) — an edge cuts (bleed/wound/poison/infect),
      // a bludgeon crushes (bruise/wind/congeal/shatter). Defaults to
      // 'sharp' when absent (see currentWeaponDamageType() below), so only
      // the blunt outliers need to be called out.
      const TOOL_ITEM_DEFS = {
        bronzehoe:    { label: 'Bronze Hoe',    icon: '🪓', sprite: 'assets/toolsprites/hoe_bronzehoe.png',        slots: ['hoe'],                    animStyle: 'chop'   },
        hatchet:      { label: 'Hatchet',       icon: '🪓', sprite: 'assets/toolsprites/axe_hatchet.png',          slots: ['axe', 'weapon'],           animStyle: 'sweep',  dmgType: 'sharp' },
        // `spinning` distinguishes the harpoon-slot sprite's in-hand behavior: mace-mode items
        // twirl around their own axis through the swing (call it "spinning" rather than
        // "mace mode" since fishing hatchets or other harpoon variants may reuse the same flag),
        // while spear-mode items stay rigidly oriented like the hatchet sweep.
        fishingmace:  { label: 'Fishing Mace',  icon: '🎣', sprite: 'assets/toolsprites/harpoon_fishingmace.png',  slots: ['harpoon', 'weapon'],        animStyle: 'sweep', spinning: true, dmgType: 'blunt'  },
        fishingspear: { label: 'Fishing Spear', icon: '🎣', sprite: 'assets/toolsprites/harpoon_fishingspear.png', slots: ['harpoon', 'weapon'],        animStyle: 'thrust', spinning: false, dmgType: 'sharp' },
        pickshovel:   { label: 'Pick-Shovel',   icon: '⛏️', sprite: 'assets/toolsprites/shovel_pickshovel.png',    slots: ['shovel', 'pick', 'weapon'], animStyle: 'thrust', dmgType: 'blunt' },
        crossbow:     { label: 'Crossbow',      icon: '🏹', sprite: 'assets/toolsprites/ranged_crossbow.png', loadedSprite: 'assets/toolsprites/ranged_crossbow_loaded.png', slots: ['ranged'], animStyle: 'ranged', rangedType: 'crossbow' },
        scatterbow:   { label: 'Scatterbow',    icon: '🏹', sprite: 'assets/toolsprites/ranged_scatterbow.png', loadedSprite: 'assets/toolsprites/ranged_scatterbow_loaded.png', slots: ['ranged'], animStyle: 'ranged', rangedType: 'scatterbow' },
        // Decorative only (no `slots`, so it's never equippable/craftable —
        // see the TOOL_ITEM_DEFS.forEach ITEM_DEFS-registration loop below,
        // which only fires for entries with a metalKey). Held by Foroji at
        // station_foroji_music (see map_hobunji_town.map.json's toolKey) so
        // he visibly has his instrument out while playing.
        kurraya:      { label: 'Kurraya',       icon: '🎵', sprite: 'assets/toolsprites/kurraya_front.png',        slots: [], animStyle: 'strum' },
      };

      // ── Metal registry (dug-up bars, the verdigris hierarchy) ──────────
      // Clean/polished target hex + verdigris hex ported from the tool-sprite
      // recolorer dev tool's METAL_PRESETS list. `tier` is null for metals
      // that don't produce a verdigris (dug up and sold, or used only for
      // cosmetic plating) — the seven that do have tier: 1 (weakest, native
      // copper) through 7 (strongest, tumbaga) form the hierarchy Sloomi/
      // Kzubug can craft real tools from and reinforce a tool up through
      // (see toolEffectiveMetalKey). Placeholder tuning throughout.
      const METAL_DEFS = {
        nativeCopper:    { label: 'Native Copper',    hex: '#B87333', verdigrisHex: '#3FAF9F', tier: 1 },
        lowTinBronze:    { label: 'Low-Tin Bronze',   hex: '#B66A2E', verdigrisHex: '#4EAA86', tier: 2 },
        tinBronze:       { label: 'Tin Bronze',       hex: '#CD7F32', verdigrisHex: '#57B38B', tier: 3 },
        highTinBronze:   { label: 'High-Tin Bronze',  hex: '#BAA06A', verdigrisHex: '#78BFA5', tier: 4 },
        arsenicalBronze: { label: 'Arsenical Bronze', hex: '#B4A78E', verdigrisHex: '#8ABFB0', tier: 5 },
        leadedBronze:    { label: 'Leaded Bronze',    hex: '#997047', verdigrisHex: '#4E9672', tier: 6 },
        tumbaga:         { label: 'Tumbaga',           hex: '#C87A2A', verdigrisHex: '#40A88C', tier: 7 },
        tin:             { label: 'Tin',               hex: '#C8CCD0', verdigrisHex: null, tier: null },
        lead:            { label: 'Lead',              hex: '#6D7375', verdigrisHex: null, tier: null },
        silver:          { label: 'Silver',            hex: '#C0C0C0', verdigrisHex: null, tier: null },
        gold:            { label: 'Gold',              hex: '#D4AF37', verdigrisHex: null, tier: null },
        electrumGold:    { label: 'Electrum',          hex: '#DCCB71', verdigrisHex: null, tier: null },
        electrumSilver:  { label: 'Pale Electrum',     hex: '#CEC88E', verdigrisHex: null, tier: null },
        pewter:          { label: 'Early Pewter',      hex: '#AEB4B5', verdigrisHex: null, tier: null },
      };
      // Weakest → strongest, i.e. the hierarchy Sloomi/Kzubug craft/reinforce with.
      const VERDIGRIS_METAL_KEYS = Object.keys(METAL_DEFS)
        .filter(k => METAL_DEFS[k].tier != null)
        .sort((a, b) => METAL_DEFS[a].tier - METAL_DEFS[b].tier);

      function metalBarItemKey(metalKey) { return 'bar_' + metalKey; }

      // A tier-linear damage/efficacy scalar — read by both weaponAbility()
      // (combat damage) and, going forward, any other tool-use "efficacy"
      // roll that wants to share the same material-tier scale.
      function metalDmgMultiplier(metalKey) {
        const tier = METAL_DEFS[metalKey]?.tier;
        return tier ? 0.85 + tier * 0.05 : 1; // tier1=0.90 … tier7=1.20
      }

      // ── Tool "shapes" (the physical object) vs. metal (what it's crafted
      // from) — TOOL_ITEM_DEFS below still keys everything by a single flat
      // itemKey (mastery, equip slots, gearInventory.tools all already work
      // that way), so a crafted tool's key is just `${shapeKey}_${metalKey}`
      // (see craftedToolItemKey) — a brand-new key per shape+metal
      // combination, automatically getting its own independent mastery/
      // verdigris/plating/reinforcement tracking for free since all of that
      // state is already keyed by itemKey.
      const TOOL_SHAPE_DEFS = {
        hoe:          { label: 'Hoe',           icon: '🪓', baseSprite: 'assets/toolsprites/hoe_bronzehoe.png',        slots: ['hoe'],                     animStyle: 'chop'   },
        hatchet:      { label: 'Hatchet',       icon: '🪓', baseSprite: 'assets/toolsprites/axe_hatchet.png',          slots: ['axe', 'weapon'],           animStyle: 'sweep',  dmgType: 'sharp' },
        fishingmace:  { label: 'Fishing Mace',  icon: '🎣', baseSprite: 'assets/toolsprites/harpoon_fishingmace.png',  slots: ['harpoon', 'weapon'],        animStyle: 'sweep', spinning: true, dmgType: 'blunt'  },
        fishingspear: { label: 'Fishing Spear', icon: '🎣', baseSprite: 'assets/toolsprites/harpoon_fishingspear.png', slots: ['harpoon', 'weapon'],        animStyle: 'thrust', spinning: false, dmgType: 'sharp' },
        pickshovel:   { label: 'Pick-Shovel',   icon: '⛏️', baseSprite: 'assets/toolsprites/shovel_pickshovel.png',    slots: ['shovel', 'pick', 'weapon'], animStyle: 'thrust', dmgType: 'blunt' },
      };
      // Every shape is unlocked from the start — "you unlock all the current
      // ones by default" — this is just the set Sloomi/Kzubug's crafting
      // counter offers; it's never spent/consumed so it isn't gearInventory
      // state the way owned tools/mastery/plating are.
      const UNLOCKED_TOOL_SHAPES = Object.keys(TOOL_SHAPE_DEFS);
      function craftedToolItemKey(shapeKey, metalKey) { return shapeKey + '_' + metalKey; }

      // Registers one TOOL_ITEM_DEFS entry per (shape × verdigris metal)
      // combination — the original 5 hand-authored keys above (bronzehoe,
      // hatchet, fishingmace, fishingspear, pickshovel) are untouched, since
      // they're the starting bronze-age kit baked into makeDefaultGear() and
      // every existing save's mastery/equip data. `shapeKey`/`metalKey` on
      // these generated entries mark them as smith-crafted, verdigris-
      // capable tools (see toolVerdigrisFraction/toolEffectiveMetalKey).
      for (const metalKey of VERDIGRIS_METAL_KEYS) {
        for (const [shapeKey, shape] of Object.entries(TOOL_SHAPE_DEFS)) {
          const itemKey = craftedToolItemKey(shapeKey, metalKey);
          TOOL_ITEM_DEFS[itemKey] = {
            label: `${METAL_DEFS[metalKey].label} ${shape.label}`,
            icon: shape.icon,
            sprite: shape.baseSprite,
            slots: shape.slots,
            animStyle: shape.animStyle,
            dmgType: shape.dmgType,
            spinning: shape.spinning,
            shapeKey, metalKey,
            itemKey, // self-reference — lets icon rendering resolve mastery/plating without a separate key param
          };
        }
      }

      // Drives the weapon-tool loadout's Combo slot (see combat-loadout.js) —
      // a sweep-style weapon (hatchet, fishing mace) plays the 3-Swing Combo,
      // a thrust-style weapon (fishing spear, pick-shovel) plays the 3-Poke
      // Combo. No weapon equipped falls back to the swing combo, same as the
      // legacy 'slash' action's own default.
      function currentComboAbilityId() {
        const def = TOOL_ITEM_DEFS[equipmentSlots.weapon];
        return def?.animStyle === 'thrust' ? 'pokeCombo' : 'swingCombo';
      }

      // Drives which flavor of affliction options every weapon-tool ability
      // offers (see combat-progression.js) — independent of which combo/
      // technique is equipped, since it's the physical weapon doing the
      // wounding either way.
      function currentWeaponDamageType() {
        return weaponDamageTypeForTool(equipmentSlots.weapon);
      }

      // Same as currentWeaponDamageType(), but for any tool key — not just
      // whichever is currently equipped. combat-progression.js's per-tool
      // progression resolves a tool's own choices through its own fixed
      // dmgType even while a *different* weapon is equipped.
      function weaponDamageTypeForTool(itemKey) {
        return TOOL_ITEM_DEFS[itemKey]?.dmgType || 'sharp';
      }

      // Keys the weapon-tool loadout's per-weapon slot assignments (see
      // combat-loadout.js) — each gear-inventory weapon remembers its own
      // Quick Attack/Held picks; 'none' is the shared fallback while no
      // weapon is equipped.
      function currentWeaponKey() {
        return equipmentSlots.weapon || 'none';
      }

      // Display label for the loadout UI's "saved for: <weapon>" note.
      function currentWeaponLabel() {
        return TOOL_ITEM_DEFS[equipmentSlots.weapon]?.label || null;
      }

      // ── Tool mastery ("your trusty axe/shovel/pick/spear") ────────────
      // Cumulative XP needed to reach levels 1-5 — a tool's own affinity,
      // built up through both combat and ordinary tool use, entirely
      // separate from the Motes of Prowess spent on its abilities' upgrade
      // choices (see combat-progression.js). Placeholder tuning; easy to
      // rebalance later without touching the mechanism.
      const MASTERY_XP_THRESHOLDS = [40, 90, 150, 220, 300];
      const MASTERY_XP_PER_COMBAT_HIT = 2;
      const MASTERY_XP_PER_TOOL_USE = 1;

      function toolMasteryXp(itemKey) {
        return gearInventory?.toolMastery?.[itemKey]?.xp || 0;
      }

      function toolMasteryLevel(itemKey) {
        if (!itemKey || !TOOL_ITEM_DEFS[itemKey]) return 0;
        const xp = toolMasteryXp(itemKey);
        let level = 0;
        while (level < MASTERY_XP_THRESHOLDS.length && xp >= MASTERY_XP_THRESHOLDS[level]) level++;
        return level;
      }

      function awardToolMasteryXp(itemKey, amount) {
        if (!itemKey || !TOOL_ITEM_DEFS[itemKey] || !(amount > 0) || !gearInventory) return;
        if (!gearInventory.toolMastery[itemKey]) gearInventory.toolMastery[itemKey] = { xp: 0 };
        gearInventory.toolMastery[itemKey].xp += amount;
        window.WorldPopupText?.queueReward('masteryXp', `+${amount} ${TOOL_ITEM_DEFS[itemKey].label} Mastery`);
        saveGearInventory();
      }

      // Dev-mode-only test shortcut (see the "+1 Mastery" button in
      // selectGearTool/selectEquipSlot, gated by s_devMode) — jumps straight
      // to the XP threshold for the next level instead of adding an
      // arbitrary XP amount that might not actually cross it.
      function devBumpToolMasteryLevel(itemKey) {
        if (!itemKey || !TOOL_ITEM_DEFS[itemKey] || !gearInventory) return;
        const level = toolMasteryLevel(itemKey);
        if (level >= MASTERY_XP_THRESHOLDS.length) return; // already maxed
        const targetXp = MASTERY_XP_THRESHOLDS[level];
        if (!gearInventory.toolMastery[itemKey]) gearInventory.toolMastery[itemKey] = { xp: 0 };
        gearInventory.toolMastery[itemKey].xp = Math.max(gearInventory.toolMastery[itemKey].xp, targetXp);
        saveGearInventory();
      }

      // Called from every weapon-tool ability's onStrike once it's actually
      // landed a hit (see combat-*.js) — grows whichever tool is currently
      // equipped as the weapon.
      function awardWeaponMasteryXp() {
        awardToolMasteryXp(equipmentSlots.weapon, MASTERY_XP_PER_COMBAT_HIT);
      }

      // Called from a successful hoe/shovel/axe/pick/harpoon action —
      // ordinary tool use also builds a tool's affinity, not just combat.
      function awardToolUseMasteryXp(tool) {
        awardToolMasteryXp(equipmentSlots[tool], MASTERY_XP_PER_TOOL_USE);
      }

      // ── Verdigris coverage, cosmetic plating, metal reinforcement ──────
      // Continuous with the tool's own XP total (not stepped by mastery
      // LEVEL) — 0% verdigris at 0 XP, 100% ("maximum verdigris") exactly
      // at the mastery-5 threshold, same MASTERY_XP_THRESHOLDS toolMasteryLevel
      // already reads. Only meaningful for a smith-crafted verdigris tool
      // (TOOL_ITEM_DEFS[itemKey].metalKey set) — anything else reads as 0.
      function toolVerdigrisFraction(itemKey) {
        if (!TOOL_ITEM_DEFS[itemKey]?.metalKey) return 0;
        const maxXp = MASTERY_XP_THRESHOLDS[MASTERY_XP_THRESHOLDS.length - 1];
        return Math.max(0, Math.min(1, toolMasteryXp(itemKey) / maxXp));
      }

      // gearInventory.toolPlating[itemKey] = { mode: 'cosmetic'|'resistant', metalKey }
      // 'cosmetic': any metal's clean color, hiding the live verdigris entirely.
      // 'resistant': the tool's OWN base metal, clean/polished — "the same
      // metal, just not oxidized". Absent = show the live verdigris (default).
      function toolPlating(itemKey) {
        return gearInventory?.toolPlating?.[itemKey] || null;
      }
      function setToolPlating(itemKey, mode, metalKey) {
        if (!gearInventory) return;
        if (!gearInventory.toolPlating) gearInventory.toolPlating = {};
        gearInventory.toolPlating[itemKey] = { mode, metalKey };
        saveGearInventory();
      }
      function clearToolPlating(itemKey) {
        if (!gearInventory?.toolPlating) return;
        delete gearInventory.toolPlating[itemKey];
        saveGearInventory();
      }

      // gearInventory.toolReinforcement[itemKey] = { metalKey } — a higher-
      // tier verdigris metal's power grafted onto this literal tool by
      // Sloomi/Kzubug's reinforcement service. The tool keeps its own base
      // metal's identity — label, sprite recolor hue, verdigris color, and
      // mastery XP all stay keyed to itemKey exactly as before — only its
      // effective combat/tool stats borrow the reinforcing metal's tier.
      function toolReinforcementMetal(itemKey) {
        return gearInventory?.toolReinforcement?.[itemKey]?.metalKey || null;
      }
      function setToolReinforcement(itemKey, metalKey) {
        if (!gearInventory) return;
        if (!gearInventory.toolReinforcement) gearInventory.toolReinforcement = {};
        gearInventory.toolReinforcement[itemKey] = { metalKey };
        saveGearInventory();
      }

      // The metal this tool actually fights/works with — its own base metal
      // unless reinforced with something higher-tier (see above).
      function toolEffectiveMetalKey(itemKey) {
        return toolReinforcementMetal(itemKey) || TOOL_ITEM_DEFS[itemKey]?.metalKey || null;
      }
      function toolMetalMultiplier(itemKey) {
        return metalDmgMultiplier(toolEffectiveMetalKey(itemKey));
      }

      // ── Motes of Prowess ────────────────────────────────────────────
      // Spent on ability-upgrade choices (see combat-progression.js);
      // earned from combat (creature kills) and other future sources.
      // Placeholder tuning — combat quests etc. are a later addition.
      const MOTES_PER_KILL = 1;

      function getMotesOfProwess() {
        return gearInventory?.motesOfProwess || 0;
      }

      function awardMotesOfProwess(amount) {
        if (!(amount > 0) || !gearInventory) return;
        gearInventory.motesOfProwess = (gearInventory.motesOfProwess || 0) + amount;
        saveGearInventory();
      }

      // Returns false without spending anything if the player can't afford it.
      function spendMotesOfProwess(amount) {
        if (!(amount > 0) || !gearInventory) return false;
        if ((gearInventory.motesOfProwess || 0) < amount) return false;
        gearInventory.motesOfProwess -= amount;
        saveGearInventory();
        return true;
      }

      window.ToolIconRender?.warm(Object.values(TOOL_ITEM_DEFS).map(d => d.sprite));

      // ── Metal/verdigris tool icon recolor bridge ────────────────────────
      // A crafted verdigris tool's icon isn't a static PNG — it's the shape's
      // base sprite recolored to the tool's effective metal (see
      // toolEffectiveMetalKey) and oxidized to this literal tool's own
      // verdigris fraction (or its cosmetic plating, if any). ToolMetalRecolor
      // does the actual pixel work asynchronously; this just kicks it off
      // once per (itemKey, plating, verdigris-fraction) combination and
      // registers the result with ToolIconRender under a synthetic key so
      // the rest of the icon pipeline (trim/rotate/effect overlay) doesn't
      // need to know the sprite wasn't a plain file load.
      const _metalToolIconRequested = new Set();
      function metalToolRecolorOptions(itemKey) {
        const def = TOOL_ITEM_DEFS[itemKey];
        if (!def?.metalKey) return null;
        const baseMetal = METAL_DEFS[def.metalKey];
        const plating = toolPlating(itemKey);
        if (plating?.mode === 'cosmetic') {
          const platingMetal = METAL_DEFS[plating.metalKey] || baseMetal;
          return { targetHex: platingMetal.hex, verdigrisHex: null, oxidationAmount: 0 };
        }
        if (plating?.mode === 'resistant') {
          return { targetHex: baseMetal.hex, verdigrisHex: null, oxidationAmount: 0 };
        }
        return { targetHex: baseMetal.hex, verdigrisHex: baseMetal.verdigrisHex, oxidationAmount: toolVerdigrisFraction(itemKey) };
      }
      const _metalToolDataUrlCache = new Map(); // same cache key -> data URL, for plain <img src> consumers
      function metalToolCacheKey(itemKey, opts) {
        const plating = toolPlating(itemKey);
        return `toolmetal:${itemKey}:${plating ? plating.mode + ':' + plating.metalKey : 'live'}:${opts.oxidationAmount.toFixed(2)}`;
      }
      function ensureMetalToolIconSource(itemKey) {
        const def = TOOL_ITEM_DEFS[itemKey];
        const opts = metalToolRecolorOptions(itemKey);
        if (!def?.sprite || !opts) return null;
        const key = metalToolCacheKey(itemKey, opts);
        if (_metalToolIconRequested.has(key)) return key;
        _metalToolIconRequested.add(key);
        window.ToolMetalRecolor?.getRecoloredCanvas(def.sprite, opts).then(canvas => {
          window.ToolIconRender?.registerCanvasSource(key, canvas);
          try { _metalToolDataUrlCache.set(key, canvas.toDataURL('image/png')); } catch {}
          // A plain <img src> consumer (see metalToolImgSrc) was showing the
          // un-recolored base sprite until now — refresh the panels that
          // render tool sprites via <img> once the real recolor lands.
          window.EquipmentPanel.buildEquipmentSlots();
        });
        return key;
      }
      // Resolves an <img src> for a tool def — the plain sprite path for an
      // ordinary tool, or (once ready) a data URL of its metal+verdigris
      // recolor for a smith-crafted one. Falls back to the plain base
      // sprite (still teal-keyed) until the async recolor above resolves.
      function metalToolImgSrc(def) {
        if (def?.metalKey && def?.itemKey) {
          const opts = metalToolRecolorOptions(def.itemKey);
          if (opts) {
            const key = metalToolCacheKey(def.itemKey, opts);
            const cached = _metalToolDataUrlCache.get(key);
            if (cached) return cached;
            ensureMetalToolIconSource(def.itemKey);
          }
        }
        return def?.sprite || '';
      }
      // Plain sprite path for an ordinary tool, or a synthetic
      // ToolIconRender key for a smith-crafted verdigris tool — see above.
      function iconSpriteSourceFor(def) {
        if (def?.metalKey && def?.itemKey) {
          const key = ensureMetalToolIconSource(def.itemKey);
          if (key) return key;
        }
        return def?.sprite || null;
      }

      // Resolved icon for a tool-select badge (the equipped item's own
      // sprite, upright and trimmed) — falls back to `fallbackEmoji` until
      // the sprite has finished loading, or if the slot holds nothing.
      function toolSelectIconHTML(def, fallbackEmoji, cssSize) {
        const src = iconSpriteSourceFor(def);
        if (src) {
          const html = window.ToolIconRender?.getIconHTML(src, 'plain', cssSize, def.label);
          if (html) return html;
        }
        return def?.icon || fallbackEmoji;
      }

      // Resolved icon for a weapon/axe action button — the equipped item's
      // sprite rotated into a jab/sweep/chop pose with a motion-effect
      // overlay, matching that item's own animStyle (or a fixed 'chop' for
      // axe-slot actions, which always read as a chop regardless of the
      // hatchet's own weapon-mode animStyle). Falls back to the generic
      // per-action emoji until the sprite has loaded, or for tools/actions
      // this doesn't apply to (dig/till/etc.).
      function attackActionIconHTML(tool, action, fallbackEmoji) {
        const def = TOOL_ITEM_DEFS[equipmentSlots[tool]];
        if (!def?.sprite) return fallbackEmoji;
        let style = null;
        if (tool === 'axe' && (action === 'chop' || action === 'hack')) style = 'chop';
        else if (tool === 'weapon' && (action === 'cut' || action === 'slash')) {
          style = def.animStyle === 'thrust' ? 'jab' : def.animStyle === 'chop' ? 'chop' : 'sweep';
        } else if (tool === 'ranged' && action === 'shoot') {
          style = 'plain';
        } else if (tool === 'harpoon' && action === 'fish') {
          style = 'plain';
        }
        if (!style) return fallbackEmoji;
        const src = iconSpriteSourceFor(def);
        if (!src) return fallbackEmoji;
        const html = window.ToolIconRender?.getIconHTML(src, style, '1.3em', def.label + ' ' + action);
        return html || fallbackEmoji;
      }

      // Current item equipped in each tool slot (null = empty)
      const equipmentSlots = {
        hoe:     null,
        shovel:  null,
        axe:     null,
        pick:    null,
        harpoon: null,
        weapon:  null,
        ranged:  null,
        whistle: null,
      };

      function makeDefaultGear() {
        return {
          // Weakest-possible verdigris metal (see VERDIGRIS_METAL_KEYS/
          // METAL_DEFS.nativeCopper, tier 1 of 7) rather than the old
          // unscaled legacy keys (bronzehoe/hatchet/etc., which fought at a
          // flat 1.0 metalDmgMultiplier — mid-hierarchy strength with no
          // room to grow into) — a fresh character now genuinely starts at
          // the bottom of the smithing ladder (see toolMetalMultiplier).
          tools:    { hoe_nativeCopper: true, hatchet_nativeCopper: true, fishingmace_nativeCopper: true, fishingspear_nativeCopper: true, pickshovel_nativeCopper: true, crossbow: true, scatterbow: true },
          clothing: { hat: null, hood: null, torso: null, overwear: null },
          clothingItems: [],
          charms: [],
          whistles: [
            { id: 'whistle_bingo', creatureKey: 'dabinggi-hound', name: 'Bingo' },
          ],
          // toolMastery[itemKey] = { xp } — each literal tool instance's own
          // affinity, gained through both combat (see awardWeaponMasteryXp)
          // and ordinary tool use (see awardToolUseMasteryXp). Its level (see
          // toolMasteryLevel()) gates which of that tool's own equipped
          // abilities' 5 upgrade levels can be chosen — see
          // combat-progression.js.
          toolMastery: {},
          // Shared 0/8 resource spent once per special-ammo volley; weapon-
          // specific rank picks and active ammo live beside it below.
          specialAmmo: 0,
          rangedAmmoLoadouts: {},
          unlockedSpecialAmmo: ['shrapnel', 'concussive'],
          // toolPlating[itemKey] = { mode: 'cosmetic'|'resistant', metalKey } —
          // Sloomi/Kzubug's cosmetic plating service (see setToolPlating).
          toolPlating: {},
          // toolReinforcement[itemKey] = { metalKey } — Sloomi/Kzubug's metal
          // reinforcement service (see setToolReinforcement).
          toolReinforcement: {},
          // Spent on ability-upgrade choices (level N choice costs N motes —
          // see combat-progression.js); earned from combat (creature kills)
          // and other future sources. Character save data, not world data.
          // No starting stipend — a fresh character earns these through
          // play (see MOTES_PER_KILL in damageCreature's death branch).
          motesOfProwess: 0,
        };
      }

      function saveGearInventory() {
        try {
          const meta = JSON.parse(localStorage.getItem('hobunjiSaveMeta') || 'null');
          if (!meta || !window.__hobunjiPlayerProfile?.characterId) return;
          const ch = (meta.characters || []).find(c => c.id === window.__hobunjiPlayerProfile.characterId);
          if (ch) { ch.gearInventory = gearInventory; localStorage.setItem('hobunjiSaveMeta', JSON.stringify(meta)); }
        } catch {}
      }

      function saveSkillProgress(snapshot) {
        try {
          const meta = JSON.parse(localStorage.getItem('hobunjiSaveMeta') || 'null');
          if (!meta || !window.__hobunjiPlayerProfile?.characterId) return;
          const character = (meta.characters || []).find(entry => entry.id === window.__hobunjiPlayerProfile.characterId); // Used to keep skill progression character-scoped across worlds.
          if (!character) return;
          character.skillLevels = { ...snapshot.levels };
          character.skillExperience = { ...snapshot.experience };
          localStorage.setItem('hobunjiSaveMeta', JSON.stringify(meta));
          Object.assign(window.__hobunjiPlayerProfile, { skillLevels: character.skillLevels, skillExperience: character.skillExperience });
        } catch {}
      }

      // Perk ranks are character-scoped, same as skill levels/XP above — a
      // Combat/Alchemy/Foraging/Fishing perk build follows the character
      // across worlds rather than staying behind with one farm.
      function savePerkProgress(snapshot) {
        try {
          const meta = JSON.parse(localStorage.getItem('hobunjiSaveMeta') || 'null');
          if (!meta || !window.__hobunjiPlayerProfile?.characterId) return;
          const character = (meta.characters || []).find(entry => entry.id === window.__hobunjiPlayerProfile.characterId);
          if (!character) return;
          character.perkRanks = snapshot;
          localStorage.setItem('hobunjiSaveMeta', JSON.stringify(meta));
          Object.assign(window.__hobunjiPlayerProfile, { perkRanks: character.perkRanks });
        } catch {}
      }

      // Persists the personal stable (companions) — mirrors saveGearInventory()'s
      // pattern exactly, since both are character-scoped and touch hobunjiSaveMeta
      // directly rather than round-tripping through onboarding.js.
      function saveStable() {
        try {
          const meta = JSON.parse(localStorage.getItem('hobunjiSaveMeta') || 'null');
          if (!meta || !window.__hobunjiPlayerProfile?.characterId) return;
          const ch = (meta.characters || []).find(c => c.id === window.__hobunjiPlayerProfile.characterId);
          if (ch) {
            ch.stable = stable;
            ch.activeCompanionId = activeCompanionId;
            ch.activeMountId = activeMountId;
            ch.activeShoulderPetId = activeShoulderPetId;
            localStorage.setItem('hobunjiSaveMeta', JSON.stringify(meta));
          }
        } catch {}
      }

      // Persists which literal tool/weapon/whistle instance is equipped in
      // each slot (equipmentSlots) and which one is actually held right now
      // (activeTool) — separate from gearInventory (what's owned) above.
      // Mirrors saveGearInventory()'s pattern. Without this, logging back in
      // always fell back to the starter-gear defaults instead of whatever
      // was actually equipped/held last session.
      function saveEquipmentSlots() {
        try {
          const meta = JSON.parse(localStorage.getItem('hobunjiSaveMeta') || 'null');
          if (!meta || !window.__hobunjiPlayerProfile?.characterId) return;
          const ch = (meta.characters || []).find(c => c.id === window.__hobunjiPlayerProfile.characterId);
          if (ch) {
            ch.equipmentSlots = { ...equipmentSlots };
            ch.activeTool = activeTool;
            localStorage.setItem('hobunjiSaveMeta', JSON.stringify(meta));
          }
        } catch {}
      }

      function esc(s) {
        return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
      }

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
          itemKey: 'squeezerFurniture', icon: '🧃', name: window.HobunjiFoodProcessing?.SQUEEZING_VAT?.name || 'Squeezing Vat', method: 'squeezing', color: 0x4f9eb8,
          desc: window.HobunjiFoodProcessing?.SQUEEZING_VAT?.desc || 'Placeable vat for squeezing and pressing cooking ingredients.'
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

      // furnitureKey -> audio.objectSfx key for that machine's distinctive
      // "product's ready" cue (see makeProcessingFurniture's onAction) —
      // layered on top of showToast's generic confirm chime, not instead
      // of it, so a machine finishing still reads as a machine, not just
      // another ding.
      const PROCESSING_SFX_KEY = {
        pestle: 'processPestle', squeezer: 'processSqueezer', handMill: 'processHandmill',
        dryingRack: 'processDryingrack', smoker: 'processSmoker',
        agingBarrel: 'processAgingbarrel', agingVase: 'processAgingvase',
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

      // ── Decorative / interior furniture ─────────────────────────────
      // These are placed inside the house. Each has a GLB model in assets/models/furniture/.
      // area: 'interior' = house only, 'farm' = farm only, 'any' = either
      const DECORATIVE_FURNITURE_DEFS = {
        basicBed:      { itemKey: 'basicBedFurniture',      icon: '🛏️', name: 'Single Bed',          modelFile: 'basicbed_single_refined.glb',  price: 35, fw: 1, fd: 2, color: 0x8b6540, area: 'interior', desc: 'A comfortable single bed for restful sleep.' },
        doubleBed:     { itemKey: 'doubleBedFurniture',     icon: '🛏️', name: 'Double Bed',           modelFile: 'basicbed_double_refined.glb',  price: 55, fw: 2, fd: 2, color: 0x8b6540, area: 'interior', desc: 'A spacious double bed.' },
        bedroll:       { itemKey: 'bedrollFurniture',       icon: '🛌', name: 'Bedroll',              modelFile: 'bedroll_folded.glb',            price: 12, fw: 1, fd: 1, color: 0x6b8c5e, area: 'interior', desc: 'A simple folded bedroll for sleeping rough.' },
        bench:         { itemKey: 'benchFurniture',         icon: '🪑', name: 'Short Bench',          modelFile: 'bench_short.glb',              price: 18, fw: 2, fd: 1, color: 0x7a5c3a, area: 'interior', desc: 'A short wooden bench.', sit: true },
        bookshelf:     { itemKey: 'bookshelfFurniture',     icon: '📚', name: 'Bookshelf',            modelFile: 'bookshelf_low.glb',            price: 28, fw: 2, fd: 1, color: 0x6b4a28, area: 'interior', desc: 'A low bookshelf.' },
        bucket:        { itemKey: 'bucketFurniture',        icon: '🪣', name: 'Tin Bucket',           modelFile: 'bucket_tin.glb',               price: 8,  fw: 1, fd: 1, color: 0x888888, area: 'any',      desc: 'A utilitarian tin bucket.' },
        candleTable:   { itemKey: 'candleTableFurniture',   icon: '🕯️', name: 'Candle Table',         modelFile: 'candle_table.glb',             price: 15, fw: 1, fd: 1, color: 0x5a4020, area: 'interior', desc: 'Small table with a candle for warm light.', light: { color: 0xffaa44, intensity: 0.7, distance: 5, height: 0.55 } },
        chairSimple:   { itemKey: 'chairSimpleFurniture',   icon: '🪑', name: 'Simple Chair',         modelFile: 'chair_simple.glb',             price: 12, fw: 1, fd: 1, color: 0x7a5c3a, area: 'interior', desc: 'A plain wooden chair.', sit: true },
        chairCushion:  { itemKey: 'chairCushionFurniture',  icon: '🪑', name: 'Cushioned Chair',      modelFile: 'chair_with_blue_cushion.glb',  price: 22, fw: 1, fd: 1, color: 0x3a5c8a, area: 'interior', desc: 'A chair with a soft blue cushion.', sit: true },
        chest:         { itemKey: 'chestFurniture',         icon: '📦', name: 'Storage Chest',        modelFile: 'chest_storage.glb',            price: 32, fw: 1, fd: 1, color: 0x6b4a28, area: 'interior', desc: 'Sturdy wooden chest for storage.' },
        crateStack:    { itemKey: 'crateStackFurniture',    icon: '📦', name: 'Crate Stack',          modelFile: 'crate_stack.glb',              price: 14, fw: 1, fd: 1, color: 0x8a6a3a, area: 'any',      desc: 'A stack of wooden crates.' },
        copperBarrel:  { itemKey: 'copperBarrelFurniture',  icon: '🛢️', name: 'Copper Barrel',        modelFile: 'barrel_copper_hoop.glb',       price: 20, fw: 1, fd: 1, color: 0xb87333, area: 'any',      desc: 'A sturdy copper-hooped barrel.' },
        desk:          { itemKey: 'deskFurniture',          icon: '✍️', name: 'Writing Desk',         modelFile: 'desk_writing.glb',             price: 38, fw: 2, fd: 1, color: 0x6b4a28, area: 'interior', desc: 'A fine writing desk with drawers.' },
        dresser:       { itemKey: 'dresserFurniture',       icon: '🗄️', name: 'Low Dresser',          modelFile: 'dresser_low.glb',              price: 30, fw: 2, fd: 1, color: 0x6b4a28, area: 'interior', desc: 'A low dresser with drawers.' },
        hearth:        { itemKey: 'hearthFurniture',        icon: '🔥', name: 'Hearth Fireplace',     modelFile: 'hearth_fireplace.glb',         price: 60, fw: 2, fd: 1, color: 0x5a4a3a, area: 'interior', desc: 'A stone fireplace for warmth and cooking.', light: { color: 0xff7722, intensity: 1.4, distance: 7, height: 0.4 }, sfxKey: 'fireplace' },
        // A portable camp, not ordinary decor — customPlace opts it out of
        // the generic tile-grid "Place" button/canPlaceDecorativeFurnitureAt
        // path (computeActionButtons/firePendingAction give it its own
        // "Set Up Campfire" button and window.WildernessCampfire.placeFromKit
        // instead), since only one can ever be placed and it's aimed
        // anywhere in the wild rather than snapped to farm/interior tiles.
        campfire:      { itemKey: 'campfireKitFurniture',   icon: '🔥', name: 'Campfire Kit',         price: 15, fw: 1, fd: 1, color: 0x6d3e20, area: 'any', desc: 'A portable campfire kit. Select it, aim at open ground anywhere in the wild, and use Action 1 to make camp.', customPlace: true },
        loom:          { itemKey: 'loomFurniture',          icon: '🧶', name: 'Small Loom',           modelFile: 'loom_small.glb',               price: 45, fw: 1, fd: 2, color: 0x8a6a3a, area: 'interior', desc: 'A small loom for weaving cloth.' },
        nightstand:    { itemKey: 'nightstandFurniture',    icon: '🕯️', name: 'Nightstand',           modelFile: 'nightstand.glb',               price: 18, fw: 1, fd: 1, color: 0x6b4a28, area: 'interior', desc: 'A small bedside table.', light: { color: 0xffaa44, intensity: 0.5, distance: 4, height: 0.5 } },
        rug:           { itemKey: 'rugFurniture',           icon: '🧶', name: 'Woven Rug',            modelFile: 'rug_woven_small.glb',          price: 22, fw: 2, fd: 2, color: 0x8a5a3a, area: 'interior', walkable: true, desc: 'A small decorative woven rug.' },
        standingLamp:  { itemKey: 'standingLampFurniture',  icon: '💡', name: 'Bronze Standing Lamp', modelFile: 'standing_lamp_bronze.glb',     price: 28, fw: 1, fd: 1, color: 0xb87333, area: 'interior', desc: 'A tall bronze oil lamp.', light: { color: 0xffc266, intensity: 0.9, distance: 6, height: 1.3 } },
        statue:        { itemKey: 'statueFurniture',        icon: '🗿', name: 'Weathered Statue',     modelFile: 'statue_weathered.glb',         price: 30, fw: 1, fd: 1, color: 0x54585e, area: 'any',      desc: 'A weathered stone statue, worn by time.' },
        stool:         { itemKey: 'stoolFurniture',         icon: '🪑', name: 'Round Stool',          modelFile: 'stool_round.glb',              price: 10, fw: 1, fd: 1, color: 0x7a5c3a, area: 'any',      desc: 'A simple round stool.', sit: true },
        tableLong:     { itemKey: 'tableLongFurniture',     icon: '🍽️', name: 'Long Table',           modelFile: 'table_long.glb',               price: 42, fw: 4, fd: 1, color: 0x7a5c3a, area: 'interior', desc: 'A long communal dining table.' },
        tableRound:    { itemKey: 'tableRoundFurniture',    icon: '🍽️', name: 'Round Table',          modelFile: 'table_round.glb',              price: 28, fw: 2, fd: 2, color: 0x7a5c3a, area: 'interior', desc: 'A round wooden dining table.' },
        tableSmall:    { itemKey: 'tableSmallFurniture',    icon: '🍽️', name: 'Small Table',          modelFile: 'table_small.glb',              price: 18, fw: 1, fd: 1, color: 0x7a5c3a, area: 'interior', desc: 'A small side table.' },
        wardrobe:      { itemKey: 'wardrobeFurniture',      icon: '🚪', name: 'Tall Wardrobe',        modelFile: 'wardrobe_tall.glb',            price: 48, fw: 2, fd: 1, color: 0x6b4a28, area: 'interior', desc: 'A tall wardrobe for clothing storage.' },
        washTub:       { itemKey: 'washTubFurniture',       icon: '🛁', name: 'Copper Wash Tub',      modelFile: 'wash_tub_copper.glb',          price: 25, fw: 1, fd: 1, color: 0xb87333, area: 'any',      desc: 'A copper tub for bathing or laundry.' },
        counter:       { itemKey: 'counterFurniture',       icon: '🏪', name: 'Shop Counter',          modelFile: 'counter_shop.glb',             price: 40, fw: 3, fd: 1, color: 0x7a5c3a, area: 'interior', desc: 'A sturdy shop counter for conducting business.' },
        // Drenkirra nests — the bucket preset's shape, halved in height and
        // colored yellow (see procedural-furniture.js's nestRecipe). Two
        // footprints out of the same recipe: a small one for a nest lashed
        // to a climbable branch, and the existing den-nest size (2x2, same
        // as the marker _denNests previously placed by hand) for the ones
        // still found in caverns/dens for other species.
        nestBranch:    { itemKey: 'nestBranchFurniture',    icon: '🪺', name: 'Branch Nest',          modelFile: 'nest_branch.glb',              price: 0,  fw: 1, fd: 1, color: 0xc9a227, area: 'any',      desc: 'A woven nest lashed to a branch.', fixture: true },
        nest:          { itemKey: 'nestFurniture',          icon: '🪺', name: 'Nest',                 modelFile: 'nest_den.glb',                 price: 0,  fw: 2, fd: 2, color: 0xc9a227, area: 'any',      desc: 'A large woven nest.', fixture: true },
        // Game-authored fixtures (fixture: true) — spawned by the game itself
        // inside specific building interiors (see BUILDING_FIXTURE_INTERACTABLES
        // below), never bought/carried by the player, so they're excluded from
        // DECORATIVE_FURNITURE_CATALOG just below. They're still ordinary
        // mapData.furniture entries otherwise: placeable, moveable and
        // duplicateable in the Interior Editor like anything else.
        alchemyTable:  { itemKey: 'alchemyTableFurniture',  icon: '⚗️', name: 'Alchemy Table',        price: 0,  fw: 1, fd: 1, color: 0x6b4a8a, area: 'interior', desc: 'A cauldron table for brewing potions.', fixture: true },
        bulletinBoard: { itemKey: 'bulletinBoardFurniture', icon: '📋', name: 'Bulletin Board',       price: 0,  fw: 1, fd: 1, color: 0x8a6a3a, area: 'interior', desc: 'A notice board for public tasks and favors.', fixture: true },
        // Barn-interior-only fixtures (see synthesizeBarnInteriorMapData) —
        // procedurally placed the same way alchemyTable/bulletinBoard are
        // placed by an authored map, just synthesized instead of authored.
        feedGrinder:   { itemKey: 'feedGrinderFurniture',   icon: '⚙️', name: 'Feed Grinder',         price: 0,  fw: 1, fd: 1, color: 0x8f8a78, area: 'interior', desc: 'Grinds a held crop, raw meat, or fish into Plant/Meat Fodder for barn troughs.', fixture: true },
        trough:        { itemKey: 'troughFurniture',        icon: '🪣', name: 'Feed Trough',          price: 0,  fw: 1, fd: 1, color: 0x8a6a3a, area: 'interior', desc: 'Holds up to a week of feed (7 units) for one housed animal.', fixture: true },
      };

      const DECORATIVE_FURNITURE_CATALOG = Object.entries(DECORATIVE_FURNITURE_DEFS)
        .filter(([, def]) => !def.fixture)
        .map(([, def]) => ({
          key: def.itemKey, icon: def.icon, name: def.name, desc: def.desc,
          price: def.price, gives: { [def.itemKey]: 1 }, category: 'furniture'
        }));

      // ── Authored furniture (docs/config/furniture-authored/*.json) ────
      // Furniture keys with real per-piece data exported by
      // furniture-avatar-author (seat anchors, processing VFX, livestock
      // stomp points) instead of just procedural-furniture.js's crude
      // hardcoded CATALOG boxes. Kicked off once at startup so
      // AuthoredFurniture.peek() has data ready by the time a piece is
      // actually placed/rendered; buildFurnitureVisual falls back to the
      // procedural CATALOG for any key not (yet) in this list.
      const AUTHORED_FURNITURE_KEYS = new Set([
        'chairSimple', 'chairCushion', 'stool', 'bench',
        'pestle', 'squeezer', 'handMill', 'dryingRack', 'smoker', 'agingBarrel', 'agingVase',
        'basicBed', 'doubleBed', 'bedroll', 'bookshelf', 'bucket', 'candleTable',
        'chest', 'crateStack', 'copperBarrel', 'desk', 'dresser', 'hearth', 'loom',
        'nightstand', 'rug', 'standingLamp', 'statue', 'tableLong', 'tableRound',
        'tableSmall', 'wardrobe', 'washTub', 'counter', 'alchemyTable', 'bulletinBoard',
        'feedGrinder', 'trough', 'campfire',
      ]);
      for (const key of AUTHORED_FURNITURE_KEYS) window.AuthoredFurniture?.load(key);

      // Shared by makeDecorativeFurnitureMesh/makeProcessingFurniture: use the
      // richer authored geometry once it's loaded, otherwise the old crude
      // procedural stand-in (never blocks placement on the fetch completing).
      function buildFurnitureVisual(furnitureKey, color) {
        const authored = AUTHORED_FURNITURE_KEYS.has(furnitureKey) ? window.AuthoredFurniture?.peek(furnitureKey) : null;
        if (authored) return window.AuthoredFurniture.buildGroup(authored, color);
        return window.ProceduralFurniture.buildFurnitureGroup(furnitureKey, color);
      }

      // ── Furniture blueprints ────────────────────────────────────────
      // Every processing station (PROCESSING_FURNITURE_CATALOG) and
      // decorative piece (DECORATIVE_FURNITURE_CATALOG) is built from a
      // blueprint — bought from the carpenter's shop instead of the
      // finished piece itself — plus wood and stone gathered with the axe
      // and pick. See renderCarpenterShopPage (sells the blueprint) and
      // renderCraftingPanel/craftFurnitureFromBlueprint (builds the
      // finished item from an owned blueprint + materials, in the
      // Inventory's Crafting tab).
      function blueprintItemKey(furnitureItemKey) {
        return furnitureItemKey + 'Blueprint';
      }
      // A rough-and-ready cost curve derived from the old outright price —
      // about a sixth of it in wood, a tenth in stone, at least 1 of each.
      function furnitureCraftCost(price) {
        return { wood: Math.max(1, Math.round(price / 6)), stone: Math.max(1, Math.round(price / 10)) };
      }
      const FURNITURE_BLUEPRINT_CATALOG = [
        ...PROCESSING_FURNITURE_CATALOG.map(item => ({ item, category: 'processing' })),
        ...DECORATIVE_FURNITURE_CATALOG.map(item => ({ item, category: 'decorative' })),
      ].map(({ item, category }) => ({
        key: blueprintItemKey(item.key),
        furnitureKey: item.key,
        icon: item.icon,
        name: item.name,
        desc: item.desc,
        // A permanent, reusable unlock (see craftFurnitureFromBlueprint —
        // building from a blueprint only ever spends Wood/Stone, never the
        // blueprint itself), so it's priced above the finished piece's own
        // price rather than a fraction of it.
        price: Math.max(15, Math.round(item.price * 1.5)),
        craftCost: furnitureCraftCost(item.price),
        category,
      }));

      const LIVESTOCK_CATALOG = [
        { key: 'puktuk',   icon: '🐐', name: 'Puktuk',   desc: 'Coming soon: meat, milk, and wool livestock.', price: 120, comingSoon: true },
        { key: 'nelk',     icon: '🐔', name: 'Nelk',     desc: 'Coming soon: meat, eggs, and mayonnaise chain.', price: 90,  comingSoon: true },
        { key: 'uumkaoiiCrate', icon: '🦆', name: 'Uumkao’ii Crate', desc: 'A travel crate with one uumkao’ii inside. Add it to the farm’s livestock from the Farm tab.', price: 150, gives: { uumkaoiiCrate: 1 }, category: 'livestock' },
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
        // Berry seeds are intentionally not sold — all 5 varieties grow wild
        // across the wilderness zones instead (see WILD_BERRY_ZONES) and
        // have a small chance to yield a seed when foraged.
        { key: 'blackMustardSeed',   icon: '⚫', name: 'Black Mustard Seed',  desc: 'Hot mustard crop. Ideal water 15–40%.', price: 6, gives: { blackMustardSeed: 2 } },
        { key: 'greenMustardSeed',   icon: '🥬', name: 'Green Mustard Seed',  desc: 'Fresh mustard crop. Ideal water 30–65%.', price: 6, gives: { greenMustardSeed: 2 } },
        { key: 'mulchBag',           icon: '🍂', name: 'Mulch Bag',           desc: 'Boosts soil recovery and gives clearing material.', price: 3, gives: { mulch: 5 } },
        // Furniture (processing stations and decorative pieces) is no longer
        // mail-order-able — see FURNITURE_BLUEPRINT_CATALOG. Blueprints are
        // bought from the carpenter's shop instead, then built yourself from
        // the Inventory's Crafting tab using wood, stone, and the blueprint.
        ...LIVESTOCK_CATALOG
      ];

      // ── Named wares pools ───────────────────────────────────────────
      // A dialogue tree's "openShop" action names a pool instead of a menu
      // id directly — the indirection Creation Kit's Leveled Lists use for
      // exactly this reason: a hand-authored (or tool-authored) dialogue
      // node just says "open pool X", and X's actual UI can be whatever
      // menu currently implements it, without the tree needing to know menu
      // ids. Every pool listed here already has its own dedicated menu pane
      // + render function (see openMenu/switchMenuPanel); this registry
      // only decides which pane a pool opens. The values below are just the
      // synchronous startup default — docs/config/shops/shop-stock.json
      // (authored via docs/tools/loot-shop-editor/) is the real source of
      // truth and overwrites this wholesale once loadLootShopConfig()
      // resolves (see _applyLoadedShopStock).
      let WARES_POOLS = {
        generalStoreWares:  { label: "Funji & Son's General Store",  menuId: 'generalStore'  },
        carpenterBarnPlans: { label: "Dzibim Khibu's Carpentry",     menuId: 'carpenterShop' },
        jubmirWares:        { label: "Jubmir's Wares",               menuId: 'jubmirShop'    },
      };

      // ── General Store catalog (Funji & Son's) ─────────────────────
      // Synchronous startup default, same as WARES_POOLS above — overwritten
      // from docs/config/shops/shop-stock.json once it loads.
      let GENERAL_STORE_CATALOG = [
        { key: 'mulchBag',      icon: '🍂', name: 'Mulch Bag',      desc: 'Boosts soil recovery and clears weeds.',        price: 3,  gives: { mulch: 5 } },
        // Furniture used to be sold outright here (bucket/copperBarrel/
        // crateStack/stool/candleTable/washTub/counter) — see
        // FURNITURE_BLUEPRINT_CATALOG. Buy the blueprint from the carpenter's
        // shop instead, then build it yourself from the Inventory's Crafting
        // tab using wood, stone, and the blueprint.
      ];

      // Synchronous startup default — overwritten from docs/config/shops/
      // shop-stock.json's generalStoreWares.clothingRotation once it loads.
      let STORE_CLOTHING_PIECES = [
        { id: 'rugged_poncho', label: 'Rugged Poncho',        category: 'overwear', usesB: true,  price: 70 },
        { id: 'fine_poncho',   label: 'Fine Poncho',          category: 'overwear', usesB: true,  price: 80 },
        { id: 'fine_hood',     label: 'Fine Hood',            category: 'hood',     usesB: true,  price: 60 },
        { id: 'tankan_tunic',  label: 'Tankan Tunic',         category: 'torso',    usesB: false, price: 50 },
        { id: 'bandolier1',    label: 'Bandolier',            category: 'torso',    usesB: false, price: 40 },
        { id: 'appearance::hat::basic_headband',      label: 'Basic Headband',        category: 'hat', usesB: false, price: 35 },
        { id: 'appearance::hat::leather_headband',    label: 'Leather Headband',      category: 'hat', usesB: false, price: 40 },
        { id: 'appearance::hat::riverlandskasa_wide', label: 'Riverland Kasa (Wide)', category: 'hat', usesB: false, price: 45 },
      ];
      let GENERAL_STORE_CLOTHING_SLOTS = 4;

      // Daily General Store clothing rack (generateDailyClothingStock) now
      // lives in js/general-store.js alongside the rest of that shop.

      // Pending orders: [{catalogKey, qty, arrivalDay, name}]
      let pendingOrders  = [];
      let deliveryLog    = [];
      const SELL_INTERVAL_HOURS = 4;  // sell crate empties every N game-hours

      // worldObjects: Map<"col,row", object> (farm scene only)
      const worldObjects = new Map();
      // interiorWorldObjects: Map<"col,row", object> (interior scene)
      const interiorWorldObjects = new Map();
      let shippingBoxObject = null; // Used by the Shipping menu pane to read/write the active sell crate contents.
      let supplyBoxObject = null; // Used by the Supplies menu pane to read/write supply order quantities.
      const processingFurnitureObjects = new Set(); // Used by reset and debug to track player-placed processing furniture.
      const interiorFurnitureObjects = []; // Tracks decorative furniture placed inside the house.
      const animalObjects = new Set(); // Tracks all live animal world objects for update loop and reset.
      const companionObjects = new Set(); // Whistle-summoned companion creatures (0 or 1 active at a time).

      // Mount ride state/logic (toggleMount, updateMountRide,
      // updateMountedMovement, etc.) lives in js/mount-system.js
      // (window.Mounts) — see window.Mounts.init(...) below for the wiring.
      const hostileObjects = new Set();   // Ambient-spawned hostile creatures (Gar-wolf / Gar-wolf Alpha).
      const corpseObjects = new Set();    // Creatures mid-death-lerp ('dying') or settled and lootable ('corpse').

      // Preload uumkao'ii sprite; animals check this before spawning.
      let uumkaoiiSpriteImage = null;
      { const _img = new Image(); _img.onload = () => { uumkaoiiSpriteImage = _img; }; _img.src = "assets/creaturesprites/uumkao'ii.png"; }

      // ── Food processing furniture ───────────────────────────────────
      function getFurnitureDefByItemKey(itemKey) {
        return Object.values(PROCESSING_FURNITURE_DEFS).find(def => def.itemKey === itemKey) || null;
      }

      function getFurnitureKeyByItemKey(itemKey) {
        const entry = Object.entries(PROCESSING_FURNITURE_DEFS).find(([, def]) => def.itemKey === itemKey);
        return entry ? entry[0] : null;
      }

      function canPlaceFurnitureAt(col, row, ignoreObject = null) {
        const tile = grid[row]?.[col];
        const occupyingObject = getWorldObjectAt(col, row); // Ignored only while moving this exact processor.
        if (!tile || (occupyingObject && occupyingObject !== ignoreObject)) return false;
        if (tile.crop || tile.type === TileType.ROCK || tile.type === TileType.SHRUB || tile.type === TileType.WEEDS || tile.type === TileType.TRENCH) return false;
        return true;
      }

      // barrelAging/vaseAging ("long" tier, per the flavor text on Aging
      // Barrel/Aging Vase — literal aging, not an instant press) take this
      // many in-game days once started, uniformly across every recipe under
      // those two methods (existing berry Wine included) rather than some
      // outputs being instant and others delayed on the same furniture type.
      const AGING_DURATION_DAYS = 3;
      const AGING_METHODS = new Set(['barrelAging', 'vaseAging']);

      // How long an instant-process (mashing/squeezing/grinding/drying/
      // smoking) plays its processingWarp + particle burst for — aging
      // methods don't use this at all, they animate continuously for as
      // long as `job` is truthy instead (see makeProcessingFurniture's
      // vfxActive()).
      const PROCESS_BURST_S = 1.2;

      function consumeProcessingInput(inputKey) {
        const trackedStars = window.CookingSystem?.consumeBestQuality?.(inputKey, 1); // Used to consume the same quality bucket as the inventory unit.
        if (trackedStars) return trackedStars;
        inventory[inputKey]--;
        clampInventoryStack(inputKey);
        return Math.max(1, Math.min(5, Number(ITEM_DEFS[inputKey]?.cookingDefaultStars) || 3));
      }

      function addProcessedOutputs(outputs, inputStars) {
        outputs.forEach(output => {
          ensureProcessedItemDef(output);
          const previousCount = inventory[output.key] || 0; // Used to keep quality buckets aligned when an output stack is full.
          inventory[output.key] = Math.min(99, previousCount + 1);
          window.CookingSystem?.recordItemQuality?.(output.key, inputStars, inventory[output.key] - previousCount); // Used to carry the source stars through pressing, grinding, drying, and aging.
        });
      }

      function makeProcessingFurniture(col, row, furnitureKey, savedJob, rotYDeg = 0) {
        const def = PROCESSING_FURNITURE_DEFS[furnitureKey];
        if (!def) return null;
        const mesh = buildFurnitureVisual(furnitureKey, def.color);
        mesh.position.set(col + 0.5, tileSurfaceY(grid[row][col].type), row + 0.5);
        mesh.rotation.y = rotYDeg * Math.PI / 180;
        _markOutline(mesh);
        _markFurnitureEdgeId(mesh);
        scene.add(mesh);

        const isAging = AGING_METHODS.has(def.method);
        // Aging jobs use readyDay; authored real-time process jobs use readyAtMs.
        // Both are saved by the farm layout so a batch never turns back into an
        // instantaneous action (or silently vanishes) across a reload.
        let job = savedJob ? { ...savedJob, kind: savedJob.kind || (savedJob.readyDay != null ? 'aging' : null), inputStars: Number(savedJob.inputStars) || 3 } : null;

        // ── Processing VFX (docs/js/authored-furniture-runtime.js) ──────
        // Reuses whatever processingWarps/particleEmitters this piece's
        // authored data carries — no-ops entirely for furniture keys with
        // no authored data yet (AUTHORED_FURNITURE_KEYS). vfxT is this
        // object's own clock, only advanced while updateProcessingFurnitureVfx
        // actually ticks it (farm scene only), so playback never jumps on
        // a scene revisit.
        const authoredVfx = AUTHORED_FURNITURE_KEYS.has(furnitureKey) ? window.AuthoredFurniture?.peek(furnitureKey) : null;
        const processTimeline = def.method === 'squeezing' ? window.AuthoredFurniture?.primaryProcessTimeline(authoredVfx) : null; // Used to make squeezing obey its authored 12-second transfer rather than the generic burst.
        const emitterVisuals = (authoredVfx?.particleEmitters || []).map(record => ({ record, visual: window.AuthoredFurniture.createEmitterVisual(mesh, record) }));
        let vfxT = 0;
        let burstRemaining = 0;
        function vfxActive() { return (isAging && !!job) || job?.kind === 'timed' || burstRemaining > 0; }
        function triggerBurst() { if (!isAging) burstRemaining = PROCESS_BURST_S; }
        function timedJobRemainingS() { return job?.kind === 'timed' ? Math.max(0, (Number(job.readyAtMs) - Date.now()) / 1000) : 0; }
        function timelineSubstanceColor(outputs) {
          const color = outputs?.[0]?.spriteColor;
          return Number.isFinite(color) ? '#' + Number(color).toString(16).padStart(6, '0') : processTimeline?.substanceColor;
        }
        function startTimedJob(outputs, inputStars, inputLabel, source = 'manual') {
          if (!processTimeline) return { ok: false, message: `${def.name} has no authored process timeline.` };
          if (job) return { ok: false, busy: true, message: `${def.name} is already squeezing a batch.` };
          const durationS = Math.max(.1, Number(processTimeline.duration) || 12);
          job = { kind: 'timed', outputs, inputStars, inputLabel, source, durationS, readyAtMs: Date.now() + durationS * 1000, substanceColor: timelineSubstanceColor(outputs) };
          saveFarmLayout();
          window.AudioSystem?.playObjectSfx(window.AudioSystem?.objectSfxConfig().processStart);
          return { ok: true, started: true, durationS };
        }
        function finishTimedJob() {
          if (job?.kind !== 'timed') return;
          const finished = job;
          job = null;
          addProcessedOutputs(finished.outputs, finished.inputStars);
          window.FarmAnimals?.clearVatWorkerPose?.(obj.id);
          saveFarmLayout();
          saveMemberWorldData();
          refreshItemScroll(); buildInventoryGrid(); refreshActionBar();
          window.AudioSystem?.playObjectSfx(window.AudioSystem?.objectSfxConfig()[PROCESSING_SFX_KEY[furnitureKey]]);
          showToast(`${def.icon} ${finished.inputLabel || 'Batch'} finished: ${starRatingText(finished.inputStars)} ${finished.outputs.map(output => output.label).join(', ')}.`);
        }
        function updateVfx(dt) {
          if (!authoredVfx) return;
          vfxT += dt;
          if (burstRemaining > 0) burstRemaining = Math.max(0, burstRemaining - dt);
          const active = vfxActive();
          const timed = job?.kind === 'timed';
          const progress = timed ? Math.max(0, Math.min(1, 1 - timedJobRemainingS() / Math.max(.1, Number(job.durationS) || Number(processTimeline?.duration) || 12))) : 0;
          const liveTimeline = processTimeline ? { ...processTimeline, substanceColor: timed ? job.substanceColor : processTimeline.substanceColor } : null;
          const timelineState = liveTimeline ? window.AuthoredFurniture.applyProcessTimeline(mesh, authoredVfx, liveTimeline, progress) : null;
          for (const warp of authoredVfx.processingWarps || []) {
            const liveWarp = Object.assign({}, warp, timelineState?.warpOverrides?.get(warp.id));
            if (active) window.AuthoredFurniture.applyWarp(mesh, liveWarp, vfxT);
            else window.AuthoredFurniture.resetWarp(mesh, warp);
          }
          for (const entry of emitterVisuals) entry.visual?.update(dt, active, timelineState?.emitterOverrides?.get(entry.record.id));
          if (timed) {
            const stompPoint = authoredVfx.stompAttachPoints?.find(point => point.enabled !== false);
            const anchorMatrix = stompPoint && window.AuthoredFurniture.stompAttachWorldMatrix(mesh, authoredVfx, stompPoint, vfxT);
            if (anchorMatrix) window.FarmAnimals?.setVatWorkerPose?.(obj.id, anchorMatrix, stompPoint.anchorName || 'shoulderGrip');
            if (timedJobRemainingS() <= 0) finishTimedJob();
          } else {
            window.FarmAnimals?.clearVatWorkerPose?.(obj.id);
          }
        }

        const obj = {
          id: 'processor_' + furnitureKey + '_' + col + '_' + row,
          type: 'processing_furniture', furnitureKey, method: def.method, col, row, mesh, rotYDeg,
          label: def.icon + ' ' + def.name,
          update: updateVfx,
          triggerVfx: triggerBurst, // used by autoSqueezeDewAtVat (livestock-to-vat automation)
          startTimedJob({ outputs, inputStars, inputLabel, source } = {}) { return startTimedJob(outputs, inputStars, inputLabel, source); }, // Used by assigned livestock without coupling dew-vats.js to timeline internals.
          getJob() { return job; }, // read by saveFarmLayout
          getButtons() {
            if (job?.kind === 'timed') {
              const seconds = Math.max(1, Math.ceil(timedJobRemainingS()));
              return [{ icon: '🫗', label: `Squeezing… ${seconds}s`, action: 'obj_process_' + furnitureKey, style: 'secondary', allowed: false }];
            }
            if (isAging && job) {
              const daysLeft = Math.max(0, job.readyDay - calendar.day);
              if (daysLeft > 0) {
                return [{ icon: '⏳', label: `Aging… ${daysLeft} day${daysLeft === 1 ? '' : 's'} left`, action: 'obj_process_' + furnitureKey, style: 'secondary', allowed: false }];
              }
              const outDef = job.outputs[0];
              return [{ icon: outDef.icon, label: `Collect ${outDef.label}`, action: 'obj_process_' + furnitureKey, style: 'primary', allowed: true }];
            }
            const active = getActiveInventoryItem();
            const outputs = active ? getProcessingOutputs(def.method, active.key) : null;
            const output = outputs ? outputs[0] : null;
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
            if (job?.kind === 'timed') return { ok: false, message: `${def.name} is still squeezing — ${Math.max(1, Math.ceil(timedJobRemainingS()))}s left.` };
            if (isAging && job) {
              if (calendar.day < job.readyDay) return { ok: false, message: 'Still aging — not ready yet.' };
              const outputs = job.outputs;
              const inputStars = job.inputStars;
              job = null;
              addProcessedOutputs(outputs, inputStars);
              saveFarmLayout();
              window.AudioSystem?.playObjectSfx(window.AudioSystem?.objectSfxConfig()[PROCESSING_SFX_KEY[furnitureKey]]);
              return { ok: true, message: `${def.icon} Collected ${starRatingText(inputStars)} ${outputs.map(o => o.label).join(', ')}.` };
            }
            const active = getActiveInventoryItem();
            if (!active) return { ok: false, message: def.name + ' needs an ingredient selected.' };
            const outputs = getProcessingOutputs(def.method, active.key);
            if (!outputs) return { ok: false, message: def.name + ' cannot process ' + (ITEM_DEFS[active.key]?.label || active.label) + '.' };
            if ((inventory[active.key] || 0) < 1) return { ok: false, message: 'No ' + (ITEM_DEFS[active.key]?.label || active.label) + ' left.' };
            const inputStars = consumeProcessingInput(active.key); // Used to preserve the selected stack's best available quality.
            if (isAging) {
              job = { kind: 'aging', outputs, readyDay: calendar.day + AGING_DURATION_DAYS, inputStars };
              saveFarmLayout();
              window.AudioSystem?.playObjectSfx(window.AudioSystem?.objectSfxConfig().processStart);
              return { ok: true, message: `${def.icon} Set ${ITEM_DEFS[active.key]?.label || active.label} to age for ${AGING_DURATION_DAYS} days.` };
            }
            if (processTimeline) {
              const inputLabel = ITEM_DEFS[active.key]?.label || active.label;
              const started = startTimedJob(outputs, inputStars, inputLabel);
              return started.ok
                ? { ok: true, message: `${def.icon} Started squeezing 1 ${inputLabel}; the batch will finish in ${Math.round(started.durationS)} seconds.` }
                : started;
            }
            addProcessedOutputs(outputs, inputStars);
            window.AudioSystem?.playObjectSfx(window.AudioSystem?.objectSfxConfig()[PROCESSING_SFX_KEY[furnitureKey]]);
            triggerBurst();
            return { ok: true, message: `${def.icon} Processed 1 ${ITEM_DEFS[active.key]?.label || active.label} into ${starRatingText(inputStars)} ${outputs.map(o => o.label).join(', ')}.` };
          },
          reset() {
            window.FarmAnimals?.clearVatWorkerPose?.(this.id);
            scene.remove(mesh);
            emitterVisuals.forEach(entry => entry.visual?.dispose());
            mesh.traverse(child => {
              if (child.geometry) child.geometry.dispose();
              if (child.material) child.material.dispose();
            });
          },
        };
        return obj;
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

      function processingFurnitureById(id) {
        return [...processingFurnitureObjects].find(obj => obj.id === id) || null;
      }

      function moveProcessingFurniture(id, col, row) {
        const obj = processingFurnitureById(id);
        if (!obj) return { ok: false, message: 'Processing furniture not found.' };
        if (!canPlaceFurnitureAt(col, row, obj)) return { ok: false, message: 'Place furniture on an empty grass, tilled, or raised tile.' };
        const oldId = obj.id; // Used to preserve any livestock assignment attached to a moved squeezing vat.
        worldObjects.delete(obj.col + ',' + obj.row);
        obj.col = col; obj.row = row;
        obj.id = 'processor_' + obj.furnitureKey + '_' + col + '_' + row;
        obj.mesh.position.set(col + 0.5, tileSurfaceY(grid[row][col].type), row + 0.5);
        worldObjects.set(col + ',' + row, obj);
        window.DewVats?.retargetAssignments(oldId, obj.id);
        saveFarmLayout();
        return { ok: true, message: `${PROCESSING_FURNITURE_DEFS[obj.furnitureKey]?.icon || '⚙️'} ${PROCESSING_FURNITURE_DEFS[obj.furnitureKey]?.name || 'Processing furniture'} moved.` };
      }

      function rotateProcessingFurniture(id, degrees = 45) {
        const obj = processingFurnitureById(id);
        if (!obj) return { ok: false, message: 'Processing furniture not found.' };
        obj.rotYDeg = ((obj.rotYDeg || 0) + degrees + 360) % 360;
        obj.mesh.rotation.y = obj.rotYDeg * Math.PI / 180;
        saveFarmLayout();
        return { ok: true, message: `${PROCESSING_FURNITURE_DEFS[obj.furnitureKey]?.icon || '⚙️'} ${PROCESSING_FURNITURE_DEFS[obj.furnitureKey]?.name || 'Processing furniture'} rotated 45°.` };
      }

      function removeProcessingFurniture(id) {
        const obj = processingFurnitureById(id);
        if (!obj) return { ok: false, message: 'Processing furniture not found.' };
        const def = PROCESSING_FURNITURE_DEFS[obj.furnitureKey];
        if (obj.getJob?.()) return { ok: false, message: `${def?.name || 'This processor'} cannot be removed until its contents are collected.` };
        window.DewVats?.retargetAssignments(obj.id, null);
        worldObjects.delete(obj.col + ',' + obj.row);
        processingFurnitureObjects.delete(obj);
        obj.reset?.();
        if (def?.itemKey) { inventory[def.itemKey] = (inventory[def.itemKey] || 0) + 1; clampInventoryStack(def.itemKey); }
        saveFarmLayout();
        refreshItemScroll();
        return { ok: true, message: `${def?.icon || '⚙️'} ${def?.name || 'Processing furniture'} returned to inventory.` };
      }

      function clearPlacedProcessingFurniture() {
        processingFurnitureObjects.forEach(obj => {
          worldObjects.delete(obj.col + ',' + obj.row);
          obj.reset && obj.reset();
        });
        processingFurnitureObjects.clear();
      }

      // Per-frame processing-station VFX (processingWarps + particleEmitters)
      // — see makeProcessingFurniture's updateVfx. Farm-only (processingFurnitureObjects
      // only ever holds farm objects), called from the main loop alongside
      // updateDewPileMeshRotations.
      function updateProcessingFurnitureVfx(dt) {
        processingFurnitureObjects.forEach(obj => obj.update && obj.update(dt));
      }

      // ── Decorative furniture (interior) ──────────────────────────
      function getDecorativeFurnitureKeyByItemKey(itemKey) {
        const entry = Object.entries(DECORATIVE_FURNITURE_DEFS).find(([, def]) => def.itemKey === itemKey);
        return entry ? entry[0] : null;
      }

      function decorativeFurnitureSize(furnitureKey, rotYDeg = 0) {
        const def = DECORATIVE_FURNITURE_DEFS[furnitureKey];
        const baseW = def?.fw || 1, baseD = def?.fd || 1;
        const angle = (rotYDeg || 0) * Math.PI / 180;
        const cos = Math.abs(Math.cos(angle)), sin = Math.abs(Math.sin(angle));
        return {
          fw: Math.max(1, Math.ceil(baseW * cos + baseD * sin - 1e-6)),
          fd: Math.max(1, Math.ceil(baseW * sin + baseD * cos - 1e-6)),
        };
      }

      function canPlaceDecorativeFurnitureAt(col, row, ignoreId = null, furnitureKey = null, rotYDeg = 0) {
        const g = currentArea === 'interior' ? interiorGrid : grid;
        const { fw, fd } = decorativeFurnitureSize(furnitureKey, rotYDeg);
        for (let r = row; r < row + fd; r++) {
          for (let c = col; c < col + fw; c++) {
            const tile = g[r]?.[c];
            if (!tile || tile.type === TileType.ROCK) return false;
            if (currentArea === 'farm' && isHouseFootprint(c, r)) return false;
          }
        }
        return !interiorFurnitureObjects.find(o => {
          if (o.id === ignoreId || o.area !== currentArea) return false;
          const { fw: ow, fd: od } = decorativeFurnitureSize(o.key, o.rotYDeg || 0);
          return col < o.col + ow && col + fw > o.col && row < o.row + od && row + fd > o.row;
        });
      }

      function housePieceOwningInteriorCell(col, row) {
        return housePieces.find(p => p.stage === 'built'
          && col >= p.col * 2 && col < (p.col + p.w) * 2
          && row >= p.row * 2 && row < (p.row + p.h) * 2) || null;
      }

      function furnitureOwnerFields(col, row) {
        const owner = housePieceOwningInteriorCell(col, row);
        return owner ? { ownerPieceId: owner.id, localCol: col - owner.col * 2, localRow: row - owner.row * 2 } : {};
      }

      // Exact oriented-footprint collision for furniture. Placement remains
      // tile-snapped, but 45-degree rotations should not block the unused
      // corners of their larger axis-aligned placement bounds. Floor pieces
      // opt out through def.walkable (currently the woven rug).
      function decorativeFurnitureBlocksPoint(obj, x, z) {
        const def = DECORATIVE_FURNITURE_DEFS[obj.key];
        if (!def || def.walkable) return false;
        const bounds = decorativeFurnitureSize(obj.key, obj.rotYDeg || 0);
        const cx = obj.col + bounds.fw * 0.5, cz = obj.row + bounds.fd * 0.5;
        const angle = -(obj.rotYDeg || 0) * Math.PI / 180;
        const dx = x - cx, dz = z - cz;
        const localX = dx * Math.cos(angle) - dz * Math.sin(angle);
        const localZ = dx * Math.sin(angle) + dz * Math.cos(angle);
        return Math.abs(localX) < (def.fw || 1) * 0.5 && Math.abs(localZ) < (def.fd || 1) * 0.5;
      }

      function furnitureBlocksMovementAt(area, x, z) {
        if (_isZoneArea(area) && window.FoliageFurnitureRuntime?.blocksPoint(area, x, z)) return true;
        if (interiorFurnitureObjects.some(obj => obj.area === area && decorativeFurnitureBlocksPoint(obj, x, z))) return true;
        if (area === 'interior' && _derivedHearthMeshes.some(h => {
          const dx = x - h.cx, dz = z - h.cz;
          const cos = Math.cos(-h.yaw), sin = Math.sin(-h.yaw);
          const localX = dx * cos - dz * sin, localZ = dx * sin + dz * cos;
          return Math.abs(localX) < 1 && Math.abs(localZ) < 0.5;
        })) return true;
        return area === 'farm' && [...processingFurnitureObjects].some(obj =>
          x >= obj.col && x < obj.col + 1 && z >= obj.row && z < obj.row + 1);
      }

      // Which placed decorative-furniture keys the player can interact with
      // (as opposed to purely-decorative pieces like a bookshelf or chest
      // prop). Derived from the piece's key at lookup time rather than
      // baked onto each placed instance, so it applies uniformly to every
      // creation path (placing one fresh, loading a saved layout, restoring
      // on reset) with no extra bookkeeping at any of those call sites.
      function getInteriorInteractableAt(col, row) {
        const derivedHearth = _derivedHearthMeshes.find(hearth => {
          const dx = col + 0.5 - hearth.cx, dz = row + 0.5 - hearth.cz;
          const localX = dx * Math.cos(-hearth.yaw) - dz * Math.sin(-hearth.yaw); // Used to test the authored two-by-one hearth footprint in its local rotation.
          const localZ = dx * Math.sin(-hearth.yaw) + dz * Math.cos(-hearth.yaw);
          return Math.abs(localX) < 1 && Math.abs(localZ) < 0.5;
        });
        if (derivedHearth) return makeCookingInteractable();
        const o = interiorFurnitureObjects.find(f => {
          if (f.area !== 'interior') return false;
          const size = decorativeFurnitureSize(f.key, f.rotYDeg || 0); // Used to make every tile of a multi-cell hearth targetable.
          return col >= f.col && col < f.col + size.fw && row >= f.row && row < f.row + size.fd;
        });
        if (!o) return null;
        if (o.key === 'hearth') return makeCookingInteractable();
        if (o.key === 'basicBed' || o.key === 'doubleBed' || o.key === 'bedroll') {
          return {
            interactIcon: '😴',
            interactLabel: 'Sleep',
            onAction(action) {
              if (action !== 'obj_interact') return { ok: false, message: 'Unknown action.' };
              return sleepInBed();
            },
          };
        }
        const def = DECORATIVE_FURNITURE_DEFS[o.key];
        if (def?.sit) {
          const { fw, fd } = decorativeFurnitureSize(o.key, o.rotYDeg || 0);
          return makeSitInteractable(o.key, o.col, o.row, fw, fd, o.rotYDeg || 0);
        }
        return null;
      }

      // Furniture lights are tagged so WeatherFX can project their real
      // world-space positions into the same soft mask used by lanterns.
      function makeFurniturePointLight(lightDef, x, y, z) {
        const light = new THREE.PointLight(lightDef.color, lightDef.intensity, lightDef.distance);
        light.position.set(x, y, z);
        light.userData.furnitureLightMask = true;
        return light;
      }

      function makeDecorativeFurnitureMesh(col, row, furnitureKey, targetScene, area = currentArea, rotYDeg = 0) {
        const def = DECORATIVE_FURNITURE_DEFS[furnitureKey];
        if (!def) return null;
        const { fw, fd } = decorativeFurnitureSize(furnitureKey, rotYDeg);
        const group = buildFurnitureVisual(furnitureKey, def.color || 0x8b6540);
        group.position.set(col + fw * 0.5, 0, row + fd * 0.5);
        group.rotation.y = rotYDeg * Math.PI / 180;
        _markOutline(group);
        _markFurnitureEdgeId(group);
        targetScene.add(group);

        let light = null;
        if (def.light) {
          light = makeFurniturePointLight(def.light, col + fw * 0.5, def.light.height || 0.6, row + fd * 0.5);
          targetScene.add(light);
        }
        const sfxSource = window.Music?.registerFurnitureSfxSource(area, col + fw * 0.5, row + fd * 0.5, window.Music?.resolveFurnitureSfx(def));

        return { mesh: group, light, sfxSource };
      }

      // worldObjects is farm-scene-only (see its declaration) — a sittable
      // piece placed there needs its own interactable registered there too,
      // since interiorFurnitureObjects (below) only tracks the mesh/light,
      // not interaction. Interior-scene sitting instead goes through
      // getInteriorInteractableAt, which derives it from def.sit directly.
      function registerSitWorldObject(furnitureKey, col, row, fw, fd, rotYDeg) {
        worldObjects.set(col + ',' + row, Object.assign(makeSitInteractable(furnitureKey, col, row, fw, fd, rotYDeg), {
          type: 'decorative_furniture', col, row,
        }));
      }

      function placeDecorativeFurniture(col, row, furnitureKey) {
        const def = DECORATIVE_FURNITURE_DEFS[furnitureKey];
        if (!def) return { ok: false, message: 'Unknown furniture type.' };
        const isInInterior = currentArea === 'interior';
        const isOnFarm = currentArea === 'farm';
        if (def.area === 'interior' && !isInInterior) return { ok: false, message: `${def.name} must be placed inside the house.` };
        if (def.area === 'farm' && !isOnFarm) return { ok: false, message: `${def.name} must be placed on the farm.` };
        if (!canPlaceDecorativeFurnitureAt(col, row, null, furnitureKey)) return { ok: false, message: 'Cannot place furniture here.' };
        const itemKey = def.itemKey;
        if ((inventory[itemKey] || 0) < 1) return { ok: false, message: `No ${def.name} in inventory.` };
        const targetScene = isInInterior ? interiorScene : scene;
        const result = makeDecorativeFurnitureMesh(col, row, furnitureKey, targetScene, currentArea);
        if (!result) return { ok: false, message: 'Could not create furniture mesh.' };
        inventory[itemKey]--;
        clampInventoryStack(itemKey);
        const owner = isInInterior ? furnitureOwnerFields(col, row) : {};
        interiorFurnitureObjects.push({ id: 'decor_' + Math.random().toString(36).slice(2, 10), key: furnitureKey, col, row,
          mesh: result.mesh, light: result.light, sfxSource: result.sfxSource, area: currentArea, rotYDeg: 0, ...owner });
        if (isOnFarm && def.sit) registerSitWorldObject(furnitureKey, col, row, def.fw, def.fd, 0);
        registerChairNpcStation(furnitureKey, col, row, 0, normalizeNpcArea(currentArea));
        refreshItemScroll();
        saveFarmLayout();
        return { ok: true, message: `${def.icon} ${def.name} placed.` };
      }

      function disposeDecorativeFurniture(obj, refundToInventory = false) {
        const targetScene = obj.area === 'interior' ? interiorScene : scene;
        targetScene.remove(obj.mesh);
        obj.mesh?.traverse?.(child => {
          if (child.geometry) child.geometry.dispose();
          if (child.material) child.material.dispose();
        });
        if (obj.light) targetScene.remove(obj.light);
        window.Music?.unregisterFurnitureSfxSource(obj.sfxSource);
        if (obj.area === 'farm' && DECORATIVE_FURNITURE_DEFS[obj.key]?.sit) worldObjects.delete(obj.col + ',' + obj.row);
        unregisterChairNpcStation(obj.key, obj.col, obj.row, normalizeNpcArea(obj.area));
        const idx = interiorFurnitureObjects.indexOf(obj);
        if (idx >= 0) interiorFurnitureObjects.splice(idx, 1);
        if (refundToInventory) {
          const itemKey = DECORATIVE_FURNITURE_DEFS[obj.key]?.itemKey;
          if (itemKey) { inventory[itemKey] = (inventory[itemKey] || 0) + 1; clampInventoryStack(itemKey); }
        }
      }

      function moveDecorativeFurniture(id, col, row) {
        const obj = interiorFurnitureObjects.find(o => o.id === id && o.area === currentArea);
        if (!obj) return { ok: false, message: 'Furniture not found.' };
        if (!canPlaceDecorativeFurnitureAt(col, row, obj.id, obj.key, obj.rotYDeg || 0)) return { ok: false, message: 'Cannot move furniture there.' };
        const def = DECORATIVE_FURNITURE_DEFS[obj.key];
        const { fw, fd } = decorativeFurnitureSize(obj.key, obj.rotYDeg || 0);
        if (obj.area === 'farm' && def?.sit) worldObjects.delete(obj.col + ',' + obj.row);
        unregisterChairNpcStation(obj.key, obj.col, obj.row, normalizeNpcArea(obj.area));
        obj.col = col; obj.row = row;
        obj.mesh.position.set(col + fw * 0.5, 0, row + fd * 0.5);
        if (obj.light) obj.light.position.set(col + fw * 0.5, def?.light?.height || 0.6, row + fd * 0.5);
        window.Music?.unregisterFurnitureSfxSource(obj.sfxSource);
        obj.sfxSource = window.Music?.registerFurnitureSfxSource(obj.area, col + fw * 0.5, row + fd * 0.5, window.Music?.resolveFurnitureSfx(def));
        if (obj.area === 'interior') Object.assign(obj, furnitureOwnerFields(col, row));
        if (obj.area === 'farm' && def?.sit) registerSitWorldObject(obj.key, col, row, fw, fd, obj.rotYDeg || 0);
        registerChairNpcStation(obj.key, col, row, obj.rotYDeg || 0, normalizeNpcArea(obj.area));
        saveFarmLayout();
        return { ok: true, message: `${def?.icon || '🪑'} ${def?.name || 'Furniture'} moved.` };
      }

      function removeDecorativeFurniture(id) {
        const obj = interiorFurnitureObjects.find(o => o.id === id && o.area === currentArea);
        if (!obj) return { ok: false, message: 'Furniture not found.' };
        const def = DECORATIVE_FURNITURE_DEFS[obj.key];
        disposeDecorativeFurniture(obj, true);
        saveFarmLayout();
        refreshItemScroll();
        return { ok: true, message: `${def?.icon || '🪑'} ${def?.name || 'Furniture'} returned to inventory.` };
      }

      function rotateDecorativeFurniture(id, degrees = 45) {
        const obj = interiorFurnitureObjects.find(o => o.id === id && o.area === currentArea);
        if (!obj) return { ok: false, message: 'Furniture not found.' };
        const nextRot = ((obj.rotYDeg || 0) + degrees + 360) % 360;
        if (!canPlaceDecorativeFurnitureAt(obj.col, obj.row, obj.id, obj.key, nextRot)) {
          return { ok: false, message: 'Cannot rotate here — the turned furniture would overlap a wall or another item.' };
        }
        const def = DECORATIVE_FURNITURE_DEFS[obj.key];
        const { fw, fd } = decorativeFurnitureSize(obj.key, nextRot);
        unregisterChairNpcStation(obj.key, obj.col, obj.row, normalizeNpcArea(obj.area));
        if (obj.area === 'farm' && def?.sit) worldObjects.delete(obj.col + ',' + obj.row);
        obj.rotYDeg = nextRot;
        obj.mesh.rotation.y = nextRot * Math.PI / 180;
        obj.mesh.position.set(obj.col + fw * 0.5, 0, obj.row + fd * 0.5);
        if (obj.light) obj.light.position.set(obj.col + fw * 0.5, def?.light?.height || 0.6, obj.row + fd * 0.5);
        window.Music?.unregisterFurnitureSfxSource(obj.sfxSource);
        obj.sfxSource = window.Music?.registerFurnitureSfxSource(obj.area, obj.col + fw * 0.5, obj.row + fd * 0.5, window.Music?.resolveFurnitureSfx(def));
        if (obj.area === 'interior') Object.assign(obj, furnitureOwnerFields(obj.col, obj.row));
        if (obj.area === 'farm' && def?.sit) registerSitWorldObject(obj.key, obj.col, obj.row, fw, fd, nextRot);
        registerChairNpcStation(obj.key, obj.col, obj.row, nextRot, normalizeNpcArea(obj.area));
        saveFarmLayout();
        return { ok: true, message: `${def?.icon || '🪑'} ${def?.name || 'Furniture'} rotated 45°.` };
      }

      function transformFurnitureWithHousePiece(pieceId, oldRect, newRect, rotateClockwise) {
        interiorFurnitureObjects.filter(o => o.area === 'interior').forEach(obj => {
          const insideOld = obj.col >= oldRect.col * 2 && obj.col < (oldRect.col + oldRect.w) * 2
            && obj.row >= oldRect.row * 2 && obj.row < (oldRect.row + oldRect.h) * 2;
          if (obj.ownerPieceId !== pieceId && !(obj.ownerPieceId == null && insideOld)) return;
          const def = DECORATIVE_FURNITURE_DEFS[obj.key];
          const oldSize = decorativeFurnitureSize(obj.key, obj.rotYDeg || 0);
          let fw = oldSize.fw, fd = oldSize.fd;
          let localCol = Number.isFinite(obj.localCol) ? obj.localCol : obj.col - oldRect.col * 2;
          let localRow = Number.isFinite(obj.localRow) ? obj.localRow : obj.row - oldRect.row * 2;
          if (rotateClockwise) {
            const nextCol = oldRect.h * 2 - (localRow + fd);
            const nextRow = localCol;
            localCol = nextCol; localRow = nextRow;
            obj.rotYDeg = ((obj.rotYDeg || 0) + 90) % 360;
            obj.mesh.rotation.y = obj.rotYDeg * Math.PI / 180;
            const newSize = decorativeFurnitureSize(obj.key, obj.rotYDeg);
            fw = newSize.fw; fd = newSize.fd;
          }
          localCol = Math.max(0, Math.min(newRect.w * 2 - fw, localCol));
          localRow = Math.max(0, Math.min(newRect.h * 2 - fd, localRow));
          unregisterChairNpcStation(obj.key, obj.col, obj.row, normalizeNpcArea(obj.area));
          obj.ownerPieceId = pieceId; obj.localCol = localCol; obj.localRow = localRow;
          obj.col = newRect.col * 2 + localCol; obj.row = newRect.row * 2 + localRow;
          obj.mesh.position.set(obj.col + fw * 0.5, 0, obj.row + fd * 0.5);
          if (obj.light) obj.light.position.set(obj.col + fw * 0.5, def?.light?.height || 0.6, obj.row + fd * 0.5);
          window.Music?.unregisterFurnitureSfxSource(obj.sfxSource);
          obj.sfxSource = window.Music?.registerFurnitureSfxSource('interior', obj.col + fw * 0.5, obj.row + fd * 0.5, window.Music?.resolveFurnitureSfx(def));
          registerChairNpcStation(obj.key, obj.col, obj.row, obj.rotYDeg || 0, normalizeNpcArea(obj.area));
        });
      }

      function clearInteriorFurniture() {
        interiorFurnitureObjects.forEach(obj => {
          const s = obj.area === 'interior' ? interiorScene : scene;
          s.remove(obj.mesh);
          obj.mesh.traverse && obj.mesh.traverse(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
          });
          if (obj.light) s.remove(obj.light);
          window.Music?.unregisterFurnitureSfxSource(obj.sfxSource);
          if (obj.area === 'farm' && DECORATIVE_FURNITURE_DEFS[obj.key]?.sit) worldObjects.delete(obj.col + ',' + obj.row);
          unregisterChairNpcStation(obj.key, obj.col, obj.row, normalizeNpcArea(obj.area));
        });
        interiorFurnitureObjects.length = 0;
      }

      // Removes every interior-area furniture piece whose footprint
      // overlaps the given interior cell rect (a demolished house piece's
      // own doubled block — see js/house-pieces.js's demolish()) and
      // refunds each one to the farm's storage box (the same
      // _loadWorldStorage/_saveWorldStorage the Farm tab's Storage pane
      // already uses), rather than the player's personal inventory — this
      // is the literal "farm storage" the modular house feature promises.
      // Returns how many pieces were recovered.
      function recoverFurnitureInInteriorRect(c0, r0, w, h) {
        const c1 = c0 + w, r1 = r0 + h;
        const toRemove = interiorFurnitureObjects.filter(o => {
          if (o.area !== 'interior') return false;
          const { fw, fd } = decorativeFurnitureSize(o.key, o.rotYDeg || 0);
          return o.col < c1 && o.col + fw > c0 && o.row < r1 && o.row + fd > r0;
        });
        if (!toRemove.length) return 0;
        const store = _loadWorldStorage();
        toRemove.forEach(obj => {
          interiorScene.remove(obj.mesh);
          obj.mesh.traverse && obj.mesh.traverse(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
          });
          if (obj.light) interiorScene.remove(obj.light);
          window.Music?.unregisterFurnitureSfxSource(obj.sfxSource);
          unregisterChairNpcStation(obj.key, obj.col, obj.row, normalizeNpcArea(obj.area));
          const itemKey = DECORATIVE_FURNITURE_DEFS[obj.key]?.itemKey;
          if (itemKey) store[itemKey] = (store[itemKey] || 0) + 1;
          const idx = interiorFurnitureObjects.indexOf(obj);
          if (idx >= 0) interiorFurnitureObjects.splice(idx, 1);
        });
        _saveWorldStorage(store);
        return toRemove.length;
      }

      // ── Furniture placer ─────────────────────────────────────────
      // Item key of an owned decor furniture piece armed for click-to-place
      // — same shape as the farm editor's own brush toggle (see
      // farmEditMode/farmEditBrush below), just for a single furniture
      // item instead of a terrain/crop type. Set by the Furniture Placer
      // panel (js/furniture-placer.js), consumed by the pointerdown handler
      // right after the farm editor's own.
      let furniturePlacementArmedKey = null;
      let furnitureMoveArmedId = null;
      let furniturePlacementGhost = null;
      let furniturePlacementPointerId = null;
      function armFurniturePlacement(itemKey) {
        furniturePlacementArmedKey = itemKey || null;
        if (furniturePlacementArmedKey) furnitureMoveArmedId = null;
        clearFurniturePlacementGhost();
        window.FurniturePlacer?.render();
      }
      function getArmedFurniturePlacementKey() { return furniturePlacementArmedKey; }
      function armFurnitureMove(id) {
        furnitureMoveArmedId = id || null;
        if (furnitureMoveArmedId) furniturePlacementArmedKey = null;
        clearFurniturePlacementGhost();
        window.FurniturePlacer?.render();
      }
      function getArmedFurnitureMoveId() { return furnitureMoveArmedId; }

      function clearFurniturePlacementGhost() {
        if (!furniturePlacementGhost) return;
        const targetScene = furniturePlacementGhost.area === 'interior' ? interiorScene : scene;
        targetScene.remove(furniturePlacementGhost.group);
        furniturePlacementGhost.group.traverse(child => {
          if (child.geometry) child.geometry.dispose();
          if (child.material) child.material.dispose();
        });
        furniturePlacementGhost = null;
      }

      function furniturePlacementSpec() {
        if (furnitureMoveArmedId) {
          const obj = interiorFurnitureObjects.find(o => o.id === furnitureMoveArmedId && o.area === currentArea);
          if (obj) return { kind: 'decorative', key: obj.key, rotYDeg: obj.rotYDeg || 0, ignoreId: obj.id };
          const processor = currentArea === 'farm' ? processingFurnitureById(furnitureMoveArmedId) : null;
          return processor ? { kind: 'processing', key: processor.furnitureKey, rotYDeg: processor.rotYDeg || 0, ignoreId: processor.id, ignoreObject: processor } : null;
        }
        const decorativeKey = getDecorativeFurnitureKeyByItemKey(furniturePlacementArmedKey);
        if (decorativeKey) return { kind: 'decorative', key: decorativeKey, rotYDeg: 0, ignoreId: null };
        const processingKey = currentArea === 'farm' ? getFurnitureKeyByItemKey(furniturePlacementArmedKey) : null;
        return processingKey ? { kind: 'processing', key: processingKey, rotYDeg: 0, ignoreId: null } : null;
      }

      function showFurniturePlacementGhost(col, row) {
        const spec = furniturePlacementSpec();
        if (!spec) { clearFurniturePlacementGhost(); return; }
        const isProcessing = spec.kind === 'processing';
        const valid = isProcessing
          ? canPlaceFurnitureAt(col, row, spec.ignoreObject)
          : canPlaceDecorativeFurnitureAt(col, row, spec.ignoreId, spec.key, spec.rotYDeg);
        if (!furniturePlacementGhost || furniturePlacementGhost.kind !== spec.kind || furniturePlacementGhost.key !== spec.key || furniturePlacementGhost.rotYDeg !== spec.rotYDeg || furniturePlacementGhost.area !== currentArea) {
          clearFurniturePlacementGhost();
          const group = buildFurnitureVisual(spec.key, 0x5cff7a);
          const ghostMaterial = new THREE.MeshBasicMaterial({ color: 0x5cff7a, transparent: true, opacity: 0.58, depthWrite: false });
          group.traverse(child => { if (child.isMesh) child.material = ghostMaterial.clone(); });
          group.rotation.y = spec.rotYDeg * Math.PI / 180;
          group.renderOrder = 1000;
          (currentArea === 'interior' ? interiorScene : scene).add(group);
          furniturePlacementGhost = { group, kind: spec.kind, key: spec.key, rotYDeg: spec.rotYDeg, area: currentArea };
        }
        const { fw, fd } = isProcessing ? { fw: 1, fd: 1 } : decorativeFurnitureSize(spec.key, spec.rotYDeg);
        const previewY = isProcessing ? tileSurfaceY(grid[row]?.[col]?.type) : 0.04;
        furniturePlacementGhost.group.position.set(col + fw * 0.5, previewY, row + fd * 0.5);
        furniturePlacementGhost.group.visible = true;
        furniturePlacementGhost.group.traverse(child => {
          if (child.isMesh) child.material.color.set(valid ? 0x5cff7a : 0xff5555);
        });
        furniturePlacementGhost.col = col;
        furniturePlacementGhost.row = row;
        furniturePlacementGhost.valid = valid;
      }

      // ── Farm editor ───────────────────────────────────────────────
      let farmEditMode = false;
      let farmEditBrushType = 'terrain'; // 'terrain'|'crop'|'object'|'furniture'|'decor'|'erase'
      let farmEditBrush = 'grass';
      let _editorPainting = false;

      function toggleFarmEditMode() {
        // The farm editor freely repaints tiles/crops and drops/removes
        // furniture with no per-brush permission checks, so it's gated at
        // this single entry point instead — only the farm's owner can open it.
        if (!farmEditMode && !isFarmOwner()) {
          showToast("Only the farm's owner can use the farm editor.", false);
          return;
        }
        farmEditMode = !farmEditMode;
        const panel = document.getElementById('farmEditorPanel');
        const btn   = document.getElementById('farmEditBtn');
        if (panel) panel.style.display = farmEditMode ? 'flex' : 'none';
        if (btn)   btn.classList.toggle('fed-open', farmEditMode);
        if (farmEditMode) showToast('Farm editor active — click tiles to paint.', true);
      }

      function farmEditorSetBrush(type, value) {
        farmEditBrushType = type;
        farmEditBrush = value;
        document.querySelectorAll('.fed-btn').forEach(b => b.classList.remove('fed-active'));
        const sel = document.querySelector(`.fed-btn[data-btype="${type}"][data-bval="${value}"]`);
        if (sel) sel.classList.add('fed-active');
      }

      function applyFarmEditBrush(col, row) {
        if (!farmEditMode) return;
        if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return;
        if (currentArea === 'farm' && isHouseFootprint(col, row)) return;
        const tile = grid[row]?.[col];
        if (!tile) return;

        if (farmEditBrushType === 'terrain') {
          const typeMap = {
            grass: TileType.GRASS, weeds: TileType.WEEDS, rock: TileType.ROCK,
            shrub: TileType.SHRUB, tilled: TileType.TILLED, raised: TileType.RAISED, trench: TileType.TRENCH
          };
          tile.type = typeMap[farmEditBrush] ?? TileType.GRASS;
          if (tile.type === TileType.TRENCH) tile.depth = 1;
          tile.crop = CropType.NONE; tile.cropAge = 0; tile.cropReady = false;
          if (tile.dewPile) { tile.dewPile = null; window.DewVats.removeMesh(col, row); }
          markTileDirty(col, row); window.WaterSystem.recomputeWater(false); saveFarmLayout();
        } else if (farmEditBrushType === 'crop') {
          if (tile.type === TileType.ROCK || tile.type === TileType.SHRUB) tile.type = TileType.TILLED;
          if (tile.type !== TileType.TILLED && tile.type !== TileType.GRASS && tile.type !== TileType.RAISED) tile.type = TileType.TILLED;
          tile.crop = farmEditBrush; tile.cropAge = 50; tile.cropReady = false;
          markTileDirty(col, row); saveFarmLayout();
        } else if (farmEditBrushType === 'object') {
          _editorMoveObject(col, row, farmEditBrush);
        } else if (farmEditBrushType === 'furniture') {
          // Place processing furniture without consuming inventory (editor mode)
          if (!canPlaceFurnitureAt(col, row)) { showToast('Cannot place furniture here.', false); return; }
          const def = PROCESSING_FURNITURE_DEFS[farmEditBrush];
          if (!def) return;
          const obj = makeProcessingFurniture(col, row, farmEditBrush);
          if (obj) { worldObjects.set(col + ',' + row, obj); processingFurnitureObjects.add(obj); saveFarmLayout(); }
        } else if (farmEditBrushType === 'erase') {
          const obj = getWorldObjectAt(col, row);
          if (obj && obj.type === 'processing_furniture') {
            worldObjects.delete(col + ',' + row); obj.reset && obj.reset(); processingFurnitureObjects.delete(obj);
          }
          // Also remove decorative furniture at this tile
          const decIdx = interiorFurnitureObjects.findIndex(o => o.col === col && o.row === row && o.area === 'farm');
          if (decIdx >= 0) {
            const d = interiorFurnitureObjects.splice(decIdx, 1)[0];
            scene.remove(d.mesh);
            d.mesh.traverse && d.mesh.traverse(child => {
              if (child.geometry) child.geometry.dispose();
              if (child.material) child.material.dispose();
            });
            if (d.light) scene.remove(d.light);
            window.Music?.unregisterFurnitureSfxSource(d.sfxSource);
            if (DECORATIVE_FURNITURE_DEFS[d.key]?.sit) worldObjects.delete(col + ',' + row);
            unregisterChairNpcStation(d.key, col, row, 'farm');
          }
          tile.type = TileType.GRASS; tile.crop = CropType.NONE; tile.cropAge = 0; tile.cropReady = false;
          if (tile.dewPile) { tile.dewPile = null; window.DewVats.removeMesh(col, row); }
          markTileDirty(col, row); window.WaterSystem.recomputeWater(false); saveFarmLayout();
        }
      }

      function _editorMoveObject(col, row, objectType) {
        if (isHouseFootprint(col, row)) { showToast('Cannot place objects on house footprint.', false); return; }
        if (getWorldObjectAt(col, row)) { showToast('Tile already occupied.', false); return; }
        if (objectType === 'sellCrate' && shippingBoxObject) {
          const old = shippingBoxObject;
          worldObjects.delete(old.col + ',' + old.row);
          if (old.mesh) scene.remove(old.mesh);
          if (old.lid)  scene.remove(old.lid);
          const nc = window.FarmCrates.makeSellCrate(col, row);
          shippingBoxObject = nc; worldObjects.set(col + ',' + row, nc);
          saveFarmLayout(); showToast('Shipping box moved.', true);
        } else if (objectType === 'supplyBox' && supplyBoxObject) {
          const old = supplyBoxObject;
          worldObjects.delete(old.col + ',' + old.row);
          if (old.mesh) scene.remove(old.mesh);
          if (old.lid)  scene.remove(old.lid);
          const nb = window.FarmCrates.makeSupplyBox(col, row);
          supplyBoxObject = nb; worldObjects.set(col + ',' + row, nb);
          saveFarmLayout(); showToast('Supply box moved.', true);
        }
      }

      // ── Farm layout persistence ───────────────────────────────────
      // Namespaced per world so separate worlds never bleed into each other's
      // farm. worldId isn't known until onboarding's hobunjiPlayerReady event
      // fires (after this module's synchronous init already ran once), so
      // early calls fall back to the legacy unnamespaced key — spawnPlayerAvatar
      // re-reads and re-applies the correctly-namespaced layout once the real
      // worldId is known (see the resync block there).
      const FARM_LAYOUT_KEY = 'hobunji_farm_layout_v3';

      function farmLayoutKey() {
        const worldId = (window.__hobunjiPlayerProfile || _playerData)?.worldId;
        return worldId ? (FARM_LAYOUT_KEY + ':' + worldId) : FARM_LAYOUT_KEY;
      }

      function saveFarmLayout() {
        try {
          const layout = { version: 3, tiles: [], objects: {}, furniture: [], decor: [] };
          if (shippingBoxObject) layout.objects.sellCrate = [shippingBoxObject.col, shippingBoxObject.row];
          if (supplyBoxObject)   layout.objects.supplyBox = [supplyBoxObject.col, supplyBoxObject.row];
          for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
              const t = grid[r][c];
              const def = createDayOneTile(c, r);
              if (t.type !== def.type || (t.crop && t.crop !== CropType.NONE) || t.dewPile) {
                layout.tiles.push({ c, r, type: t.type, depth: t.type === TileType.TRENCH && Number.isFinite(t.depth) ? clamp(t.depth, 0, 1) : 0, crop: t.crop || '', dewPile: t.dewPile || '',
                  cropAge: t.crop && t.crop !== CropType.NONE ? t.cropAge : undefined,
                  cropReady: t.crop && t.crop !== CropType.NONE ? !!t.cropReady : undefined });
              }
            }
          }
          processingFurnitureObjects.forEach(obj => {
            const job = obj.getJob && obj.getJob();
            layout.furniture.push({ key: obj.furnitureKey, col: obj.col, row: obj.row, rotYDeg: obj.rotYDeg || 0, ...(job ? { job } : {}) });
          });
          interiorFurnitureObjects.forEach(obj => {
            layout.decor.push({ id: obj.id, key: obj.key, col: obj.col, row: obj.row, area: obj.area,
              rotYDeg: obj.rotYDeg || 0, ownerPieceId: obj.ownerPieceId || null,
              localCol: Number.isFinite(obj.localCol) ? obj.localCol : null,
              localRow: Number.isFinite(obj.localRow) ? obj.localRow : null });
          });
          // Movable buildings — every house piece (starter + built/
          // foundation deeds) and every barn (foundation or built). Added
          // as extra fields on the same version-3 shape rather than bumping
          // the version, so older saves without these fields still load fine.
          if (housePieces.length) {
            layout.housePieces = housePieces.map(p => ({
              id: p.id, pieceKey: p.pieceKey, col: p.col, row: p.row, w: p.w, h: p.h, stage: p.stage, roofAxis: p.roofAxis || null,
              features: (p.features || []).map(f => ({ id: f.id, type: f.type, lx: f.lx, ly: f.ly, side: f.side, edgeSlot: f.edgeSlot, autoGenerated: !!f.autoGenerated })),
            }));
          }
          // Manual entrances/chimneys removed or displaced by a piece's own
          // wall, recovered rather than deleted (see house-pieces.js's
          // architectural features) — independent of any one piece's
          // position, so saved at the top level, not per piece.
          const fixtureInventory = window.HousePieces.getFixtureInventory();
          if (fixtureInventory.length) layout.architecturalInventory = fixtureInventory;
          if (farmBuildings.length) {
            layout.buildings = farmBuildings.map(b => ({ id: b.id, kind: b.kind, tier: b.tier, col: b.col, row: b.row, w: b.w, h: b.h, stage: b.stage, ...(b.troughs ? { troughs: b.troughs } : {}) }));
          }
          // Preserve map-editor-authored travel data through in-game saves
          if (worldRoutes.length)      layout.routes      = worldRoutes;
          if (worldNpcPaths.length)    layout.npcPaths    = worldNpcPaths; // legacy compatibility
          if (worldTransitions.length) layout.transitions = worldTransitions;
          localStorage.setItem(farmLayoutKey(), JSON.stringify(layout));
          return true;
        } catch (error) {
          console.error('saveFarmLayout:', error);
          debugLog('Farm layout save failed: ' + (error?.message || error), 'error');
          return false;
        }
      }

      function loadFarmLayout() {
        try {
          const raw = localStorage.getItem(farmLayoutKey());
          return raw ? JSON.parse(raw) : null;
        } catch { return null; }
      }

      function applyFarmLayoutToGrid(layout, { refreshVisuals = false } = {}) {
        if (!layout || layout.version !== 3) return;
        (layout.tiles || []).forEach(({ c, r, type, depth, crop, dewPile, cropAge, cropReady }) => {
          if (grid[r]?.[c]) {
            const previousType = grid[r][c].type; // Used below to skip visual refreshes for non-terrain save data.
            const previousDepth = grid[r][c].depth; // Used below to detect restored trench-depth changes.
            grid[r][c].type = type;
            // Older layouts omit depth; treat those trenches as fully dug.
            grid[r][c].depth = type === TileType.TRENCH
              ? (Number.isFinite(depth) ? clamp(depth, 0, 1) : 1)
              : 0;
            grid[r][c].crop = crop || CropType.NONE;
            if (crop) {
              // Older layouts (and any other caller that omits cropAge) predate
              // persisting real growth progress — fall back to the previous
              // "fully grown but not yet flagged ready" placeholder, which
              // self-corrects at the next morning's tickCropDay(). A layout
              // that does carry real progress must restore it as-is: forcing
              // cropReady=false here regardless of actual state used to demote
              // an already-ripe, uncollected crop back to "growing" on every
              // reload/re-entry, silently blocking harvest until the next day.
              grid[r][c].cropAge = Number.isFinite(cropAge) ? cropAge : 50;
              grid[r][c].cropReady = Number.isFinite(cropAge) ? !!cropReady : false;
            }
            grid[r][c].dewPile = dewPile || null;
            if (refreshVisuals && (previousType !== grid[r][c].type || previousDepth !== grid[r][c].depth)) {
              markTileDirty(c, r);
            }
          }
        });
      }

      // Cleans up a legacy bug: createInitialGrid() used to stamp a hardcoded
      // 3x5 raw-tile "north exit to town" road onto every brand-new farm,
      // duplicating the real farm<->town connector (which is authored as a
      // proper route with its own paved brick surface — see worldRoutes).
      // That raw stub got persisted into every save the first time it ran
      // (its tile.type differs from createDayOneTile's own default, so
      // saveFarmLayout always wrote it out explicitly), so simply removing
      // the stamp from createInitialGrid doesn't clear it from saves that
      // already have it — applyFarmLayoutToGrid would just restore it from
      // layout.tiles again. Revert each of those exact tiles back to a
      // fresh default, but only if it still looks untouched (still a bare
      // path tile, never tilled/planted/dug), so a player who deliberately
      // built or farmed over that spot keeps whatever they made there.
      const LEGACY_FARM_ENTRANCE_PATH_TILES = [
        [16,0],[17,0],[18,0],
        [16,1],[17,1],[18,1],
        [16,2],[17,2],[18,2],
        [16,3],[17,3],[18,3],
        [16,4],[17,4],[18,4],
      ];
      function cleanupLegacyFarmEntranceRoad() {
        for (const [c, r] of LEGACY_FARM_ENTRANCE_PATH_TILES) {
          const t = grid[r]?.[c];
          if (!t || t.type !== TileType.PATH) continue;
          if (t.crop && t.crop !== CropType.NONE) continue;
          if (t.dewPile || t.depth) continue;
          const def = createDayOneTile(c, r);
          t.type = def.type;
          t.variation = def.variation;
        }
      }

      function applyFarmLayoutObjects(layout) {
        if (!layout || layout.version !== 3) return;
        if (layout.objects?.sellCrate) {
          const [c, r] = layout.objects.sellCrate;
          if (shippingBoxObject && (shippingBoxObject.col !== c || shippingBoxObject.row !== r)) {
            worldObjects.delete(shippingBoxObject.col + ',' + shippingBoxObject.row);
            shippingBoxObject.reset && shippingBoxObject.reset();
            const nc = window.FarmCrates.makeSellCrate(c, r); shippingBoxObject = nc; worldObjects.set(c + ',' + r, nc);
          }
        }
        if (layout.objects?.supplyBox) {
          const [c, r] = layout.objects.supplyBox;
          if (supplyBoxObject && (supplyBoxObject.col !== c || supplyBoxObject.row !== r)) {
            worldObjects.delete(supplyBoxObject.col + ',' + supplyBoxObject.row);
            supplyBoxObject.reset && supplyBoxObject.reset();
            const nb = window.FarmCrates.makeSupplyBox(c, r); supplyBoxObject = nb; worldObjects.set(c + ',' + r, nb);
          }
        }
        (layout.furniture || []).forEach(({ key, col, row, job, rotYDeg }) => {
          if (PROCESSING_FURNITURE_DEFS[key] && canPlaceFurnitureAt(col, row)) {
            const obj = makeProcessingFurniture(col, row, key, job, rotYDeg || 0);
            if (obj) { worldObjects.set(col + ',' + row, obj); processingFurnitureObjects.add(obj); }
          }
        });
        (layout.decor || []).forEach(({ id, key, col, row, area, rotYDeg, ownerPieceId, localCol, localRow }) => {
          const def = DECORATIVE_FURNITURE_DEFS[key];
          if (!def) return;
          const decorArea = area || 'farm';
          const targetScene = decorArea === 'interior' ? interiorScene : scene;
          const result = makeDecorativeFurnitureMesh(col, row, key, targetScene, decorArea, rotYDeg || 0);
          const owner = decorArea === 'interior' && !ownerPieceId ? furnitureOwnerFields(col, row) : {};
          if (result) interiorFurnitureObjects.push({ id: id || 'decor_' + Math.random().toString(36).slice(2, 10), key, col, row,
            mesh: result.mesh, light: result.light, sfxSource: result.sfxSource, area: decorArea, rotYDeg: rotYDeg || 0,
            ownerPieceId: ownerPieceId || owner.ownerPieceId, localCol: Number.isFinite(localCol) ? localCol : owner.localCol,
            localRow: Number.isFinite(localRow) ? localRow : owner.localRow });
          if (result && decorArea === 'farm' && def.sit) {
            const size = decorativeFurnitureSize(key, rotYDeg || 0);
            registerSitWorldObject(key, col, row, size.fw, size.fd, rotYDeg || 0);
          }
          if (result) registerChairNpcStation(key, col, row, rotYDeg || 0, normalizeNpcArea(decorArea));
        });
        // House pieces — initWorldObjects() already seeded the starter piece
        // at its hard default position before this runs. A modern save's
        // own housePieces array may have moved the starter (a legacy
        // "Move Building" save carried forward) and/or built additional
        // deed pieces; an old pre-modular-house save only ever has the
        // legacy houseCol/houseRow fields, which just repositions the
        // starter with nothing else to restore.
        let starterEntry = housePieces.find(p => p.id === 'house_starter');
        if (Array.isArray(layout.housePieces) && layout.housePieces.length) {
          const savedStarter = layout.housePieces.find(p => p.id === 'house_starter');
          if (savedStarter) {
            // Restore the saved records themselves instead of reseeding a
            // default starter pair and skipping pieceKey:'starter'. The old
            // path restored the main room but silently reset a rearranged
            // starter annex to its default position on every reload.
            window.HousePieces.clearAll();
            layout.housePieces.forEach(saved => {
              const def = saved.pieceKey === 'starter' ? HOUSE_PIECE_CATALOG.starter : HOUSE_PIECE_CATALOG[saved.pieceKey];
              if (!def || !saved.id) return;
              const entry = {
                id: saved.id, pieceKey: saved.pieceKey, col: saved.col, row: saved.row,
                w: saved.w || def.w, h: saved.h || def.h, stage: saved.stage || 'foundation',
                roofAxis: saved.roofAxis || null,
                features: Array.isArray(saved.features) ? saved.features.map(f => ({ ...f })) : [],
              };
              housePieces.push(entry);
              window.HousePieces.spawnEntry(entry);
            });
            starterEntry = housePieces.find(p => p.id === 'house_starter');
          } else {
            // Transitional saves with deeds but no explicit main-room record.
            layout.housePieces.forEach(saved => {
              if (saved.pieceKey === 'starter' || !HOUSE_PIECE_CATALOG[saved.pieceKey] || housePieces.some(p => p.id === saved.id)) return;
              const def = HOUSE_PIECE_CATALOG[saved.pieceKey];
              const entry = { id: saved.id, pieceKey: saved.pieceKey, col: saved.col, row: saved.row,
                w: saved.w || def.w, h: saved.h || def.h, stage: saved.stage || 'foundation',
                roofAxis: saved.roofAxis || null, features: saved.features || [] };
              housePieces.push(entry);
              window.HousePieces.spawnEntry(entry);
            });
          }
        } else if (Number.isFinite(layout.houseCol) && Number.isFinite(layout.houseRow) && starterEntry
                   && (layout.houseCol !== starterEntry.col || layout.houseRow !== starterEntry.row)) {
          window.HousePieces.clearAll();
          window.HousePieces.seedStarter(layout.houseCol, layout.houseRow);
        }
        // Manual entrances/chimneys recovered by removal or a wall junction
        // — independent of any one piece's position, so restored
        // unconditionally here rather than inside either branch above.
        window.HousePieces.loadFixtureInventory(layout.architecturalInventory);
        // Re-derive global furniture coordinates from the room-local values
        // only after every room has been restored. This is deliberately a
        // no-op transform: it repairs old/global coordinates while keeping
        // the saved local placement unchanged.
        housePieces.filter(p => p.stage === 'built').forEach(piece => {
          const rect = { col: piece.col, row: piece.row, w: piece.w, h: piece.h };
          transformFurnitureWithHousePiece(piece.id, rect, rect, false);
        });
        rebuildInteriorGeometry();
        (layout.buildings || []).forEach(saved => {
          if (saved.kind !== 'barn' || !BARN_TIERS[saved.tier]) return;
          if (farmBuildings.some(b => b.id === saved.id)) return;
          const entry = { id: saved.id, kind: 'barn', tier: saved.tier, col: saved.col, row: saved.row, w: saved.w || window.FarmBuildings.FOOTPRINT_W, h: saved.h || window.FarmBuildings.FOOTPRINT_D, stage: saved.stage || 'foundation', ...(Array.isArray(saved.troughs) ? { troughs: saved.troughs } : {}) };
          farmBuildings.push(entry);
          window.FarmBuildings.spawnEntry(entry);
        });
        // Tile data (grid[r][c].dewPile) is restored by applyFarmLayoutToGrid,
        // which always runs first (see the two call sites) — this just builds
        // the meshes for whatever dew piles are already sitting in the grid,
        // same two-phase split as furniture (data now, objects/meshes here).
        window.DewVats.rebuildMeshesFromGrid();
      }

      // Livestock genetics & breeding (fur-color math, pattern layers,
      // Size inheritance, sell-value scoring, crossOffspring) now live in
      // js/creature-genetics.js (window.CreatureGenetics) -- see
      // window.CreatureGenetics.init(...) below for the wiring.

      // item key -> livestock kind, for the Farm tab's "Add Livestock" flow.
      // Grows alongside js/farm-animals.js's LIVESTOCK_FACTORIES as more
      // species ship. Both new Den-Mother nest rewards (see
      // updateNestInteraction) piggyback on this exact mechanism per the
      // design intent — "the existing livestock items, just renamed" —
      // rather than inventing a separate egg/baby item system. All three
      // farm-deployable species (uumkao'ii, gar-wolf, dabinggi-hound) have
      // a LIVESTOCK_FACTORIES entry and go through the exact same
      // window.FarmAnimals.addFromItem → stasis → assignToBarn →
      // wander/day-night-barn path — there's nothing uumkao'ii-specific
      // about any of it. dabinggiHoundEgg has no Den-Mother source (dabinggi-
      // hound isn't a hostile wild-pack species, so it has no "-den-mother"
      // CREATURE_DB entry — see DEN_MOTHER_ITEM_KEYS below) — its only
      // source is Jubmir's daily trader stock (see _loadJubmirStock).
      // Kept here (not in js/farm-animals.js) since it's also read by the
      // Inventory panel outside that module.
      const LIVESTOCK_ITEM_KINDS = window.SCRATCHBONES_CONFIG?.game?.livestock?.itemKinds || {};

      // Den-Mother CREATURE_DB key -> which item her nest hands out — read
      // directly off her species (see loadBuildingScene's 'map_i_den_'
      // handling) rather than inferred from her liveBirth flag. Those
      // happen to bisect the same way today (gar-wolf-den-mother: true,
      // uumkaoii-wild-den-mother: false), which is exactly the kind of
      // coincidence that silently breaks the moment a third Den-Mother
      // species ships sharing a liveBirth value with one of these two.
      // Kept here rather than js/farm-animals.js since it's wild
      // den-mother nest logic, not livestock.
      const DEN_MOTHER_DEFS = window.SCRATCHBONES_CONFIG?.game?.wildlife?.denMothers || {};
      const DEN_MOTHER_ITEM_KEYS = Object.fromEntries(Object.values(DEN_MOTHER_DEFS).map(def => [def.creatureKey, def.nestItemKey]));

      // ── Chair sitting (docs/config/furniture-authored seat anchors) ──
      // Same lerp-in/lerp-out shape as beginHarvestInteraction, but
      // indefinite-duration: the player stays seated (camera zoomed tight,
      // free 360° look via the 'seated' camera mode) until they explicitly
      // stand, rather than auto-releasing after a fixed timer. See
      // updateSitInteraction's early-return in the main tick and
      // computeActionButtons'/useActiveAction's top-priority sitInteraction
      // checks for the "Stand" override.
      let sitInteraction = null;
      const SIT_TRANSITION_S = 0.35; // matches HARVEST_TRANSITION_S's quick-lerp feel

      // ── NPC gathering points: walk-to navigation, not teleport ─────────
      // { path:[{col,row},...], npcId, label } while an auto-walk is in
      // progress toward a nearby NPC's current schedule spot, else null.
      // Player-driven the whole way — see advancePlayerAutoWalk's use in
      // updateMovement, which feeds computed direction through the exact
      // same ix/iy → speed/collision pipeline manual input uses, and any
      // real manual input cancels it outright rather than fighting it.
      // Tracks whether the player had real movement input last frame — used
      // by updateMovement's stuck-recovery check to fire only on the
      // idle→moving edge (the instant a movement key/stick is first
      // pressed), not every single frame the player happens to be moving.
      let _playerWasMoving = false;
      let playerAutoWalk = null;
      const PLAYER_AUTOWALK_ARRIVE_PX = TILE * 0.35;
      const PLAYER_AUTOWALK_PATH_PADDING_TILES = 10;
      const NPC_GATHERING_NEARBY_TILES = 16; // "nearby" scope for the walk-to list — a screen's-width-ish radius, not the whole map.

      function nearbyNpcGatheringPoints() {
        const px = player.x / TILE, py = player.y / TILE;
        return npcWalkers
          .filter(w => w.area === currentArea && w.rec?.id && w.currentScheduleTarget)
          .map(w => {
            const target = w.currentScheduleTarget;
            const dist = Math.hypot(w.root.position.x - px, w.root.position.z - py);
            return { id: w.rec.id, name: w.rec.name || w.rec.id, activity: target.activity || '', dist };
          })
          .filter(entry => entry.dist <= NPC_GATHERING_NEARBY_TILES)
          .sort((a, b) => a.dist - b.dist);
      }

      // Sets a walk-to destination toward `npcId`'s current schedule spot —
      // a navigation target the player still walks to themselves (through
      // normal collision/speed/footsteps), not an instant teleport. Silently
      // cancels any walk already in progress if the NPC can't be reached.
      function startWalkToNpc(npcId) {
        const walker = npcWalkers.find(w => w.rec?.id === npcId && w.area === currentArea);
        const target = walker?.currentScheduleTarget;
        if (!walker || !target || !Number.isFinite(target.c) || !Number.isFinite(target.r)) {
          showToast("Can't find them right now.", false);
          playerAutoWalk = null;
          return;
        }
        const startCol = Math.floor(player.x / TILE), startRow = Math.floor(player.y / TILE);
        const path = window.TilePathfinding?.findPath(startCol, startRow, target.c, target.r,
          (c, r) => isNpcTileWalkable(currentArea, c, r),
          { bounds: window.TilePathfinding.boxAround(startCol, startRow, target.c, target.r, PLAYER_AUTOWALK_PATH_PADDING_TILES) });
        if (!path || !path.length) {
          showToast('No clear path there.', false);
          playerAutoWalk = null;
          return;
        }
        playerAutoWalk = { path, npcId, label: walker.rec?.name || 'them' };
      }

      // Advances the current auto-walk one frame and returns the unit
      // direction manual input would otherwise supply, or null once the
      // path is exhausted (also clearing playerAutoWalk itself).
      function advancePlayerAutoWalk() {
        if (!playerAutoWalk) return null;
        const wp = playerAutoWalk.path[0];
        if (!wp) { playerAutoWalk = null; return null; }
        const wx = (wp.col + 0.5) * TILE, wy = (wp.row + 0.5) * TILE;
        const dx = wx - player.x, dy = wy - player.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= PLAYER_AUTOWALK_ARRIVE_PX) {
          playerAutoWalk.path.shift();
          if (!playerAutoWalk.path.length) {
            showToast(`Arrived at ${playerAutoWalk.label}.`, true);
            playerAutoWalk = null;
            return null;
          }
          return advancePlayerAutoWalk();
        }
        return { x: dx / dist, y: dy / dist };
      }

      // Populates the Map tab's "Nearby" list — see nearbyNpcGatheringPoints/
      // startWalkToNpc above. Called on entering the Map tab; the list is a
      // one-shot snapshot rather than live-updating while the panel sits
      // open, same as the rest of the menu's tab-switch-triggered renders.
      function renderNpcGatheringPanel() {
        const listEl = document.getElementById('wmapGatheringList');
        if (!listEl) return;
        const entries = nearbyNpcGatheringPoints();
        if (!entries.length) {
          listEl.innerHTML = '<div class="wmap-gathering-empty">No one nearby right now.</div>';
          return;
        }
        listEl.innerHTML = '';
        for (const entry of entries) {
          const row = document.createElement('div');
          row.className = 'wmap-gathering-row';
          const info = document.createElement('div');
          info.className = 'wmap-gathering-info';
          const name = document.createElement('div');
          name.className = 'wmap-gathering-name';
          name.textContent = entry.name;
          info.appendChild(name);
          if (entry.activity) {
            const activity = document.createElement('div');
            activity.className = 'wmap-gathering-activity';
            activity.textContent = entry.activity;
            info.appendChild(activity);
          }
          row.appendChild(info);
          const goBtn = document.createElement('button');
          goBtn.type = 'button';
          goBtn.className = 'wmap-gathering-go';
          goBtn.textContent = 'Go';
          goBtn.addEventListener('click', () => { startWalkToNpc(entry.id); closeMenu(); });
          row.appendChild(goBtn);
          listEl.appendChild(row);
        }
      }
      const SEATED_LOOK_ROTATE_DEG_PER_SEC = 110; // movement input's rotate-the-view speed while seated (see updateSitInteraction)
      const SEATED_CAMERA_PITCH_CLAMP_DEG = 45; // up/down joystick pitch allowance while seated, matches the desktop drag default

      // Resolves a furniture instance's seat anchor (local, footprint-center-
      // relative — see docs/js/authored-furniture-runtime.js) into this
      // placement's actual world position/facing. rotYDeg is the furniture's
      // own placement yaw, including player-rotated decorative furniture and
      // processing stations.
      function resolveSeatWorldTransform(furnitureKey, col, row, fw, fd, rotYDeg, seatIndex) {
        const data = window.AuthoredFurniture?.peek(furnitureKey);
        const anchor = data && window.AuthoredFurniture.seatAnchorFor(data, seatIndex);
        if (!anchor) return null;
        const yawRad = (rotYDeg || 0) * Math.PI / 180;
        const cos = Math.cos(yawRad), sin = Math.sin(yawRad);
        const ax = anchor.position.x || 0, az = anchor.position.z || 0;
        const cx = col + (fw || 1) / 2, cz = row + (fd || 1) / 2;
        const totalYawDeg = (rotYDeg || 0) + (anchor.rotationDeg.y || 0);
        return {
          x: cx + (ax * cos + az * sin),
          y: anchor.position.y || 0,
          z: cz + (-ax * sin + az * cos),
          facingRad: Math.PI / 2 - totalYawDeg * Math.PI / 180,
          // Seat surface tilt (pitch/roll only) and footprint depth, passed
          // through to the leg rig's faithful surface-flush seated solve
          // (see procedural-leg-animation.js's applySeatedPose). Read
          // straight off the anchor's own local rotation with no further
          // rotation applied for rotYDeg. Yaw is already represented by
          // facingRad; the leg solver consumes seat-local pitch/roll.
          normalDeg: { x: anchor.rotationDeg.x || 0, z: anchor.rotationDeg.z || 0 },
          footprintHalfDepth: Math.max(0.05, (Number(data.footprint?.d) || 1) / 2),
          anchorZ: az,
        };
      }

      function beginSitInteraction(furnitureKey, col, row, fw, fd, rotYDeg, seatIndex) {
        if (sitInteraction || window.FarmAnimals.isHarvesting() || dialogueOpen || (window.Mounts?.rideState ?? 'none') !== 'none') return { ok: false, message: 'Cannot sit right now.' };
        const seat = resolveSeatWorldTransform(furnitureKey, col, row, fw, fd, rotYDeg, seatIndex);
        if (!seat) return { ok: false, message: 'Nowhere to sit there.' };
        const seatSurfaceY = activeSurfaceYAtWorld(seat.x, seat.z); // Used to lift the seated camera with zone plateau/ramp terrain.
        const seatAbsoluteWorldY = seatSurfaceY + seat.y; // Used only by world-space camera/debug consumers; seat.y stays floor-relative for anatomy.
        const targetX = seat.x * TILE, targetY = seat.z * TILE;
        const targetAngle = seat.facingRad;
        sitInteraction = {
          furnitureKey, col, row,
          phase: 'in', t: 0,
          startX: player.x, startY: player.y, startAngle: facingAngle,
          targetX, targetY, targetAngle,
          seatWorldY: seat.y,
          seatSurfaceY,
          seatAbsoluteWorldY,
          seatNormalDeg: seat.normalDeg,
          seatFootprintHalfDepth: seat.footprintHalfDepth,
          seatAnchorZ: seat.anchorZ,
          prevCameraMode: activeCameraMode, prevCameraTarget: activeCameraTarget,
        };
        activeCameraMode = 'seated';
        activeCameraTarget = { position: new THREE.Vector3(seat.x, seatAbsoluteWorldY + 0.15, seat.z) };
        // Start looking at the seated character's BACK rather than whatever
        // the 'seated' mode's base azimuth happens to be (which has no
        // relationship to which way the character is actually facing).
        // updateCameraPosition's own azimuth convention: azimuth=0 sits the
        // camera due south of the target looking north (see its comment);
        // targetAngle is in the atan2(z,x) convention facingAngle/player.angle
        // use elsewhere (0 = +X), so the world direction the character is
        // FACING is (cos(targetAngle), sin(targetAngle)) in (X,Z) — camera
        // needs to sit on the OPPOSITE side (the character's back), i.e. at
        // world azimuth atan2(-cos(targetAngle), -sin(targetAngle)), which
        // simplifies to 270° − targetAngle(deg).
        const behindAzimuthDeg = 270 - targetAngle * 180 / Math.PI;
        cameraAzimuthOffsetDeg = wrapAzimuthDeg(behindAzimuthDeg - (cameraModeConfig('seated').azimuthDeg ?? 0));
        cameraAngleOffsetDeg = 0;
        return { ok: true, message: 'You sit down.' };
      }

      function endSitInteraction() {
        if (!sitInteraction || sitInteraction.phase === 'out') return;
        sitInteraction.phase = 'out';
        sitInteraction.t = 0;
      }

      function updateSitInteraction(dt) {
        const s = sitInteraction;
        if (!s) return;
        player.vx = 0; player.vy = 0;
        if (s.phase === 'active') {
          facingAngle = s.targetAngle; player.angle = facingAngle;
          // Movement input can't actually move a seated character — redirect
          // it into rotating the free-look seated camera around them
          // instead (see the 'seated' camera mode's freeRotate), so the
          // same controls still do something useful rather than going dead
          // the instant you sit down. Same keyboard-wins-over-joystick
          // source selection as the normal movement read just above in the
          // main update loop. Sign matches the mouse-drag azimuth control
          // (dragging/looking right also decreases the offset).
          const kb = getKeyboardVector();
          const ix = kb.active ? kb.x : input.x;
          const iy = kb.active ? kb.y : input.y;
          if (Math.abs(ix) > 0.001) {
            cameraAzimuthOffsetDeg = wrapAzimuthDeg(cameraAzimuthOffsetDeg - ix * SEATED_LOOK_ROTATE_DEG_PER_SEC * dt);
          }
          if (Math.abs(iy) > 0.001) {
            cameraAngleOffsetDeg = clamp(cameraAngleOffsetDeg + iy * SEATED_LOOK_ROTATE_DEG_PER_SEC * dt, -SEATED_CAMERA_PITCH_CLAMP_DEG, SEATED_CAMERA_PITCH_CLAMP_DEG);
          }
          return;
        }
        s.t = Math.min(1, s.t + dt / SIT_TRANSITION_S);
        const e = s.t;
        const [fromX, fromY, fromAngle, toX, toY, toAngle] = s.phase === 'in'
          ? [s.startX, s.startY, s.startAngle, s.targetX, s.targetY, s.targetAngle]
          : [s.targetX, s.targetY, s.targetAngle, s.startX, s.startY, s.startAngle];
        player.x = fromX + (toX - fromX) * e;
        player.y = fromY + (toY - fromY) * e;
        facingAngle = fromAngle + angleDiff(toAngle, fromAngle) * e;
        player.angle = facingAngle;
        if (e >= 1) {
          if (s.phase === 'in') { s.phase = 'active'; s.t = 0; }
          else {
            enterDefaultCameraMode(s.prevCameraMode);
            activeCameraTarget = s.prevCameraTarget ?? null;
            // enterDefaultCameraMode already snapped these behind the player
            // when landing back in shoulder-surf — don't stomp that back to
            // due-south here too.
            if (activeCameraMode !== SHOULDER_SURF_MODE) {
              cameraAzimuthOffsetDeg = 0;
              cameraAngleOffsetDeg = 0;
            }
            sitInteraction = null;
          }
        }
      }

      // Keep the head's WORLD yaw on the player's actual look/aim direction,
      // independently of the body/avatar plane. The plane can lag behind aim
      // because of its camera-facing dead zone, and combat poses can add their
      // own bodyYaw flourish; this local neck residual counters both. Seated
      // free-look treats the orbited camera direction as the aim target.
      function updatePlayerHeadAim() {
        if (!playerNeckJoint || cutscenePreviewActive) return;
        // During dialogue, faceNpcDialogueParticipants owns the player's
        // neck bone exclusively (a continuous eye-contact aim at the NPC —
        // see its own comment) — step aside entirely rather than fighting
        // it with a second, different rotation write on the same bone.
        if (dialogueOpen) return;
        if (characterViewMode.enabled) {
          playerNeckJoint.rotation.x = characterViewMode.lockedNeckX;
          playerNeckJoint.rotation.y = characterViewMode.lockedNeckY;
          return;
        }
        // Shoulder-surf: the head locks onto the shared aim point
        // (mouseLookAngle — see updateShoulderSurfReticleAim's screen-center
        // raycast) rather than the camera's own raw azimuth. Those two agree
        // when the camera looks straight at the player, but a horizontal
        // camera-offset slide points the camera at a spot beside the player
        // instead — using the raycast's actual ground target keeps the head
        // (and the body catch-up / WASD-relative movement below, which read
        // the same value) aimed at what's really in front of the reticle
        // instead of visibly disagreeing with it. Same facingAngle-
        // convention-to-world-yaw conversion the default case below applies
        // to player.angle, just fed the shared aim angle instead.
        const targetWorldYaw = activeCameraMode === SHOULDER_SURF_MODE
          ? -mouseLookAngle + Math.PI / 2
          : sitInteraction?.phase === 'active'
            ? activeCameraAzimuthRad()
            : -player.angle + Math.PI / 2;
        // playerMesh.rotation.y is this function's only body-yaw signal, but
        // channels like weapon-idle-stance-body-yaw (see
        // weapon-idle-body-yaw-runtime.js) never touch it directly — they
        // only reach playerMesh through PlayerBodyTransformComposer's
        // render-time world delta. Left out, the neck counters only the
        // pre-delta resting yaw and the head renders off-target by whatever
        // yaw the active channels are about to add.
        const composerYawDelta = window.PlayerBodyTransformComposer?.resolvedYawDeltaRad?.() || 0;
        playerNeckJoint.rotation.y = angleDiff(targetWorldYaw, playerMesh.rotation.y + composerYawDelta);
        // Purely cosmetic head nod matching the camera's own up/down tilt
        // (cameraAngleOffsetDeg — how far the player has pitched the camera
        // off the mode's neutral framing) — this rig has no other pitch
        // consumer, so a plain local X rotation on the neck bone (not a
        // world-yaw-style correction like above) is enough. Scaled down from
        // the camera's own pitch range since a flat cutout head tilting a
        // full ±45° reads as exaggerated compared to the same swing on an
        // actual 3D head.
        playerNeckJoint.rotation.x = activeCameraMode === SHOULDER_SURF_MODE
          ? THREE.MathUtils.degToRad(cameraAngleOffsetDeg) * 0.6
          : 0;
      }

      // Interactable used by both getInteriorInteractableAt (interior scene)
      // and the farm's worldObjects registration (see placeDecorativeFurniture/
      // registerSitWorldObject) — same onAction shape either call site expects.
      function makeSitInteractable(furnitureKey, col, row, fw, fd, rotYDeg) {
        return {
          interactIcon: '💺',
          interactLabel: 'Sit',
          getButtons() {
            return [{ icon: '💺', label: 'Sit', action: 'obj_sit', style: 'primary', allowed: !sitInteraction }];
          },
          onAction(action) {
            if (action !== 'obj_sit' && action !== 'obj_interact') return { ok: false, message: 'Unknown action.' };
            return beginSitInteraction(furnitureKey, col, row, fw, fd, rotYDeg, 0);
          },
        };
      }

      function makeCookingInteractable() {
        return {
          interactIcon: '🔥',
          interactLabel: 'Cook',
          getButtons() {
            return [{ icon: '🔥', label: 'Cook', action: 'obj_cook', style: 'primary', allowed: true }];
          },
          onAction(action) {
            if (action !== 'obj_cook' && action !== 'obj_interact') return { ok: false, message: 'Unknown action.' };
            return window.CookingSystem.openAtHearth();
          },
        };
      }


      // ── Companion & hostile creatures (Whistle system + Combat system) ───────
      // Continuous pixel-space movement (unlike the tile-hopping uumkao'ii
      // above), built on the same two-plane side-view sprite avatars.

      const _creatureTexCache = { front: new Map(), back: new Map() };
      function _getCreatureFrontTexture(url) {
        if (!_creatureTexCache.front.has(url)) {
          const tex = new THREE.TextureLoader().load(url);
          tex.colorSpace = THREE.SRGBColorSpace;
          _creatureTexCache.front.set(url, tex);
        }
        return _creatureTexCache.front.get(url);
      }
      function _getCreatureBackTexture(url) {
        if (!_creatureTexCache.back.has(url)) {
          const tex = new THREE.TextureLoader().load(url);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.wrapS = THREE.RepeatWrapping;
          tex.repeat.set(-1, 1);
          tex.offset.set(1, 0);
          _creatureTexCache.back.set(url, tex);
        }
        return _creatureTexCache.back.get(url);
      }
      // Genotype-composited textures for pattern-layer livestock (gar-wolf,
      // dabinggi-hound) — mirrors _creatureTexCache's URL-keyed pattern but
      // keyed by (kind, frame, genotype signature) instead, since the actual
      // pixels come from an async canvas composite (see
      // creature-genetics-render.js) rather than a static file. While a
      // signature's compose is still in flight, callers fall back to the
      // species' plain (uncolored) sprite — see setCreatureFrame below.
      const _genotypeTexCache = { front: new Map(), back: new Map() };
      const _genotypeTexPending = new Set();
      // Every key this function has ever logged a "kicking off compose" line
      // for — so a creature stuck retrying every tick (see
      // updateCreatureAnimFrame's needsRetry loop) logs its request/failure
      // ONCE per (kind,frame,signature) instead of spamming the debug panel
      // every frame while it waits.
      const _genotypeTexLogged = new Set();
      // key -> performance.now() of its most recent failure — see the
      // cooldown check in _getGenotypeTextures below.
      const _genotypeTexFailedAt = new Map();
      // Kinds confirmed to have no CreatureGeneticsRender.SPECIES entry —
      // unlike a load failure, "this species has no cosmetic art" can never
      // resolve itself no matter how many times it's retried, so it gets
      // logged once and then permanently skipped instead of the transient-
      // failure 3s cooldown below (which would otherwise still retry it
      // forever, one full composeFrame call at a time, competing with every
      // other creature's real compose work for the same main thread).
      const _genotypeUnsupportedKinds = new Set();
      function _getGenotypeTextures(kind, frame, genotype, blinkShut = false) {
        const renderer = window.CreatureGeneticsRender;
        if (!renderer) {
          window.__farmLog?.(`[genotype-render] _getGenotypeTextures(${kind},${frame}): window.CreatureGeneticsRender is not loaded — creature-genetics-render.js failed to load or hasn't run yet`, 'warn');
          return null;
        }
        if (!genotype) return null;
        if (_genotypeUnsupportedKinds.has(kind)) return null;
        if (!renderer.SPECIES[kind]) {
          _genotypeUnsupportedKinds.add(kind);
          window.__farmLog?.(`[genotype-render] _getGenotypeTextures(${kind},${frame}): "${kind}" has no CreatureGeneticsRender.SPECIES entry — will never render a genotype, skipping permanently instead of retrying`, 'warn');
          return null;
        }
        const sig = renderer.genotypeSignature(kind, genotype);
        const key = `${kind}|${frame}|${sig}|${blinkShut ? 'b' : 'o'}`;
        if (_genotypeTexCache.front.has(key)) {
          return { front: _genotypeTexCache.front.get(key), back: _genotypeTexCache.back.get(key) };
        }
        // A key that just failed (thrown or resolved null) gets a short
        // cooldown before it's allowed to retry — without this, a
        // persistent failure (e.g. the canvas-tainting bug this logging
        // caught) re-kicks composeFrame on literally every tick forever,
        // which is both wasted work and floods the debug log with the same
        // error dozens of times a second.
        const failedAt = _genotypeTexFailedAt.get(key);
        if (failedAt && performance.now() - failedAt < 3000) return null;
        if (!_genotypeTexPending.has(key)) {
          _genotypeTexPending.add(key);
          if (!_genotypeTexLogged.has(key)) {
            _genotypeTexLogged.add(key);
            window.__farmLog?.(`[genotype-render] _getGenotypeTextures(${kind},${frame}): cache miss, sig="${sig}" blink=${blinkShut} — kicking off composeFrame`, 'wildlife');
          }
          renderer.composeFrame(kind, frame, genotype, blinkShut).then(canvas => {
            _genotypeTexPending.delete(key);
            if (!canvas) {
              _genotypeTexFailedAt.set(key, performance.now());
              window.__farmLog?.(`[genotype-render] _getGenotypeTextures(${kind},${frame}): composeFrame resolved null for sig="${sig}" — falling back to plain sprite (see composeFrame's own log line just above for why)`, 'warn');
              return;
            }
            _genotypeTexFailedAt.delete(key);
            const front = new THREE.CanvasTexture(canvas);
            front.colorSpace = THREE.SRGBColorSpace;
            const back = new THREE.CanvasTexture(canvas);
            back.colorSpace = THREE.SRGBColorSpace;
            back.wrapS = THREE.RepeatWrapping; back.repeat.set(-1, 1); back.offset.set(1, 0);
            _genotypeTexCache.front.set(key, front);
            _genotypeTexCache.back.set(key, back);
            window.__farmLog?.(`[genotype-render] _getGenotypeTextures(${kind},${frame}): composited texture cached for sig="${sig}" (canvas ${canvas.width}x${canvas.height})`, 'wildlife');
          }).catch(err => {
            _genotypeTexPending.delete(key);
            _genotypeTexFailedAt.set(key, performance.now());
            window.__farmLog?.(`[genotype-render] _getGenotypeTextures(${kind},${frame}): composeFrame THREW for sig="${sig}" — ${err?.stack || err}`, 'error');
          });
        }
        return null;
      }
      // Returns true when a real composited texture (not the plain
      // fallback) got applied — updateCreatureAnimFrame uses this to keep
      // retrying a genotype creature's current frame every tick until its
      // specific (kind,frame,signature) compose actually finishes, instead
      // of a global "something somewhere finished" signal (the previous
      // design: a single shared generation counter bumped by ANY frame's
      // compose finishing, anywhere, for any creature — which let a
      // creature get marked "up to date" the instant some unrelated
      // frame/genotype completed, permanently stranding it on the plain
      // fallback if its own specific frame wasn't ready at that exact
      // moment and nothing else ever bumped the counter again).
      function setCreatureFrame(avatarRef, url, genotypeKind, frameKey, genotype, blinkShut = false) {
        const genoTex = (genotypeKind && genotype) ? _getGenotypeTextures(genotypeKind, frameKey, genotype, blinkShut) : null;
        const front = genoTex?.front || _getCreatureFrontTexture(url);
        const back = genoTex?.back || _getCreatureBackTexture(url);
        for (const child of [avatarRef.frontPlane, avatarRef.backPlane]) {
          if (!child.material) continue;
          if (child.name.endsWith('_front_plane')) child.material.map = front;
          else if (child.name.endsWith('_back_plane')) child.material.map = back;
          else continue;
          child.material.needsUpdate = true;
        }
        return !!genoTex;
      }

      // spriteUrl -> resolved bottom-opacity ratio (0..1, see
      // creaturePlaneGroundOffset), or a Set of pending callbacks while
      // the very first scan of that species' idle sprite is still loading.
      const _creatureGroundAnchorCache = new Map();
      const CREATURE_FULL_OPAQUE_ALPHA_THRESHOLD = 254; // scanOpaqueVerticalBounds uses >, so 254 selects only alpha 255 pixels.

      // Scans a species' idle sprite (cached per URL, so only the first
      // creature of each species actually pays for it) for how far down its
      // fully opaque pixels extend. All these sprites are nominally
      // 1375×600, but if the art itself doesn't reach the canvas's bottom
      // edge (transparent padding), anchoring on the raw rectangle leaves
      // the visible creature hovering above the ground/its own shadow.
      // Using alpha 255 deliberately ignores antialiased fringe pixels that
      // would otherwise make the apparent foot line vary with faint padding.
      function resolveCreatureGroundAnchorRatio(spriteUrl, onReady) {
        const cached = _creatureGroundAnchorCache.get(spriteUrl);
        if (typeof cached === 'number') { onReady(cached); return; }
        if (cached instanceof Set) { cached.add(onReady); return; }
        const waiters = new Set([onReady]);
        _creatureGroundAnchorCache.set(spriteUrl, waiters);
        const finish = (ratio) => {
          _creatureGroundAnchorCache.set(spriteUrl, ratio);
          waiters.forEach(fn => fn(ratio));
        };
        const img = new Image();
        img.onload = () => {
          const bounds = window.PNGPlaneAvatar?.scanOpaqueVerticalBoundsOfImage?.(img, CREATURE_FULL_OPAQUE_ALPHA_THRESHOLD);
          finish(bounds ? (bounds.bottom + 1) / img.naturalHeight : 1);
        };
        img.onerror = () => finish(1);
        img.src = spriteUrl;
      }

      // The prism (avatarRef.group — see updateCreatureMesh's "Prism (group)
      // tracks the raw aim angle..." comment) keeps its true, unpadded size:
      // its floor is local Y = -halfH exactly as CREATURE_DB's modelWidth/
      // modelHeight define it, which is what places it correctly at surfY
      // and is what any future hitbox/collision use of that size would
      // expect. The correction belongs on the PLANE meshes themselves
      // (children of the prism), not on the prism's own placement: shifting
      // them down by the padding's share of modelHeight moves the art's
      // real opaque bottom onto the prism's actual floor without changing
      // the prism's own footprint at all. bottomRatio=1 (no padding) gives
      // an offset of 0 — the plane stays exactly where it started.
      function creaturePlaneGroundOffset(modelHeight, bottomRatio) {
        return -modelHeight * (1 - bottomRatio);
      }

      function makeCreatureEntity(creatureKey, x, y, opts = {}) {
        const def = CREATURE_DB[creatureKey];
        if (!def) return null;
        const { scene: optScene, grid: optGrid, cols: optCols, rows: optRows, ...restOpts } = opts;
        const targetScene = optScene || getActiveScene();
        const targetGrid  = optGrid  || getActiveGrid();
        const gridCols = optCols || getActiveCols();
        const gridRows = optRows || getActiveRows();
        const modelWidth = def.modelWidth;
        // New creature art is not required to use the legacy 1375×600 canvas.
        // Definitions with a different source canvas provide its width/height
        // ratio so the avatar plane preserves the uploaded sprite's aspect.
        const modelHeight = modelWidth * (def.spriteAspect || (600 / 1375));
        const sizeScale = window.CreatureGenetics.creatureSizeScale(creatureKey, opts.genotype); // Applies Animation Author size-class values in-world.
        const halfH = modelHeight * sizeScale.y / 2; // Keeps the scaled sprite's feet on the terrain.
        const idUniq = (performance.now() | 0) + '_' + Math.floor(Math.random() * 100000);
        const avatarRef = window.PNGPlaneAvatar.buildAnimalPlaneAvatarModel(THREE, def.sprites.idle, {
          modelWidth, modelHeight,
          name: creatureKey + '_' + idUniq,
          creatureId: creatureKey,
          headRig: window.CreatureGeneticsRender?.headRigForKind?.(creatureKey) || undefined,
        });
        avatarRef.frontPlane = avatarRef.group.children[0] || null;
        avatarRef.backPlane  = avatarRef.group.children[1] || null;
        window.CreatureGenetics.applyCreatureBillboardScale(avatarRef.group, sizeScale); // Animal planes face along group Z, so visible width cannot use group X.
        // Skip the species-differentiation tint for genotype-bearing
        // creatures (gar-wolf/dabinggi-hound) — their sprite is about to be
        // replaced by a genotype-composited texture and def.tint would
        // multiply over it, muddying the actual bred color (see the
        // matching genotype check in updateCreatureMesh's per-tick tint).
        if (def.tint && def.tint !== 0xffffff && !opts.genotype) {
          for (const child of avatarRef.group.children) {
            if (child.material) child.material.color.setHex(def.tint);
          }
        }
        if (opts.genotype) {
          const genotypeKind = window.CreatureGenetics.SPECIES_ALIAS[creatureKey] || creatureKey;
          const supported = !!window.CreatureGeneticsRender?.SPECIES?.[genotypeKind];
          window.__farmLog?.(`[genotype-render] makeCreatureEntity(${creatureKey}): genotype attached, genotypeKind="${genotypeKind}", ${supported ? 'SUPPORTED by CreatureGeneticsRender.SPECIES — should recolor' : 'NOT in CreatureGeneticsRender.SPECIES — will stay on its plain default sprite, this is expected for this species'}`, 'wildlife');
        }
        const col = clamp(Math.floor(x / TILE), 0, gridCols - 1);
        const row = clamp(Math.floor(y / TILE), 0, gridRows - 1);
        const surfY = targetGrid[row]?.[col] ? tileSurfaceYInArea(targetGrid[row][col], currentArea) : 0;
        avatarRef.group.position.set(x / TILE, surfY + halfH, y / TILE);
        _markPngPlane(avatarRef.group);
        targetScene.add(avatarRef.group);

        // Separate top-level object (not parented under avatarRef.group) so
        // it stays flat on the ground and unaffected by the body's own
        // squash (pounce crouch) or the death ragdoll's flip rotation —
        // same reasoning as the player's own playerGroundShadow.
        const groundShadow = makeCharacterGroundShadow(creatureKey + '_ground_shadow');
        const shadowRadii = creatureGroundShadowRadii(def, sizeScale.x);
        groundShadow.scale.set(shadowRadii.radiusX, 1, shadowRadii.radiusZ);
        groundShadow.position.set(x / TILE, surfY + characterGroundShadowSurfaceOffset(), y / TILE);
        targetScene.add(groundShadow);

        const creature = {
          id: creatureKey + '_' + idUniq,
          creatureKey, def, avatarRef, groundShadow,
          x, y, vx: 0, vy: 0,
          halfHeight: halfH,
          visualScaleX: sizeScale.x, // Reused whenever attack squash updates the group scale.
          visualScaleY: sizeScale.y, // Reused whenever attack squash updates the group scale.
          visualModelWidth: modelWidth * sizeScale.x, // Keeps shadows, rings, and combat reach aligned with visible width.
          health: def.maxHealth, maxHealth: def.maxHealth,
          stamina: def.maxStamina, maxStamina: def.maxStamina,
          facing: 0, groupRot: 0, pngRot: 0, perpState: {},
          scaleY: 1,
          attackCooldownT: 0, retreatT: 0, hitFlashT: 0,
          knockbackT: 0, knockbackVX: 0, knockbackVY: 0,
          runFrame: 0, runFrameDistPx: 0, currentFrameUrl: def.sprites.idle,
          isCompanion: false,
          // Whichever entity this companion follows/defends/anchors to —
          // {x, y, angle, climbing}, same shape as the real `player` object.
          // Defaults to null (hostiles/wild creatures have no master); a
          // companion always gets one passed in via opts (see
          // syncCompanionFromWhistle). Kept as a plain reference rather than
          // hardcoding `player` so a future NPC-owned companion (or a second
          // remote player's companion) can point at any qualifying entity.
          master: null,
          name: def.label,
          state: 'idle',
          wanderTarget: null, wanderT: 0,
          homeX: x, homeY: y,
          scene: targetScene, areaGrid: targetGrid, areaCols: gridCols, areaRows: gridRows, areaId: currentArea,
          ...restOpts,
        };
        window.__farmLog?.(`[size-render] ${creatureKey}: ${sizeScale.sizeClass} at ${Math.round(sizeScale.x * 100)}% × ${Math.round(sizeScale.y * 100)}%`, 'wildlife');
        // Shifts the plane meshes (not the prism/group itself — see
        // creaturePlaneGroundOffset) down once the idle sprite's real
        // opaque bottom edge is known, so the art's actual feet sit on the
        // prism's floor instead of on the raw sprite rectangle's edge.
        // Fires synchronously if this species' sprite was already scanned
        // by an earlier creature.
        resolveCreatureGroundAnchorRatio(def.sprites.idle, (bottomRatio) => {
          const offsetY = creaturePlaneGroundOffset(modelHeight, bottomRatio);
          if (avatarRef.frontPlane) avatarRef.frontPlane.position.y = offsetY;
          if (avatarRef.backPlane) avatarRef.backPlane.position.y = offsetY;
        });
        window.ResourceSystem?.initEntity(creature);
        return creature;
      }

      function despawnCreature(c) {
        (c.scene || scene).remove(c.avatarRef.group);
        c.avatarRef.dispose();
        if (c.groundShadow) {
          (c.scene || scene).remove(c.groundShadow);
          c.groundShadow.geometry.dispose();
          c.groundShadow.material.dispose();
        }
        if (c._banditToolHolder) {
          (c.scene || scene).remove(c._banditToolHolder);
          c._banditToolHolder.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
          c._banditToolHolder = null;
        }
        if (c._banditRangedToolHolder) {
          (c.scene || scene).remove(c._banditRangedToolHolder);
          c._banditRangedToolHolder.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
          c._banditRangedToolHolder = null;
        }
        if (c._banditTrailMesh) {
          (c.scene || scene).remove(c._banditTrailMesh);
          c._banditTrailMesh.geometry.dispose();
          c._banditTrailMesh.material.dispose();
          c._banditTrailMesh = null;
        }
        window.ResourceRings?.disposeRingHud(c);
      }

      // ── Loot & Shop config (docs/config/loot/loot-pools.json,
      // docs/config/shops/shop-stock.json) ────────────────────────────
      // Single source of truth for every drop table and shop's stock,
      // authored via docs/tools/loot-shop-editor/. Fetched once at startup
      // alongside every other config load; every consumer below only runs
      // in response to a later gameplay event (a creature dying, a chest
      // spawning, a shop menu opening), so by the time any of them actually
      // read _lootPools/_shopStock the fetch has long since resolved — same
      // assumption docs/game.js's other cached config loaders make (see
      // loadBanditGangConfig).
      let _lootPools = {};
      let _shopStock = {};
      let _lootShopConfigPromise = null;
      function loadLootShopConfig() {
        if (_lootShopConfigPromise) return _lootShopConfigPromise;
        // Routed through window.LocalDBOverrides.loadDatabase() (see
        // docs/js/local-db-overrides.js) so the onboarding "Database Source"
        // toggle can swap in a locally-saved loot-shop-editor edit of either
        // file without touching the repo copy — falls back to a direct fetch
        // if that module somehow isn't loaded.
        const loadOne = (id, path) => (window.LocalDBOverrides ? window.LocalDBOverrides.loadDatabase(id) : fetch(path).then(r => r.ok ? r.json() : null)).catch(() => null);
        _lootShopConfigPromise = Promise.all([
          loadOne('lootPools', 'config/loot/loot-pools.json'),
          loadOne('shopStock', 'config/shops/shop-stock.json'),
        ]).then(([lootData, shopData]) => {
          _lootPools = lootData?.pools || {};
          if (shopData?.shops) { _shopStock = shopData.shops; _applyLoadedShopStock(); }
        });
        return _lootShopConfigPromise;
      }
      loadLootShopConfig();

      // The subset of the dialogue system's shared condition axes (see
      // docs/js/condition-registry.js) that make sense for loot/shop gating
      // outside of an NPC conversation — no relationship/encounter/station
      // concept here, so those axes are simply never supplied/checked.
      function _lootShopWorldState() {
        return {
          weekdays: window.CalendarSystem.currentWeekdayName(),
          seasons: window.CalendarSystem.currentSeason().name,
          weather: calendar.weather,
          timesOfDay: window.Fishing.timeOfDay(),
          maps: currentArea,
          playerSpecies: _playerData?.appearance?.speciesId || '',
        };
      }

      // Rolls a docs/config/loot/loot-pools.json pool by id: every entry is
      // independently checked against its conditions and its own `chance`
      // (default 1 = always, matching every migrated creature/bandit table),
      // then contributes a `min..max` quantity (or a `min..max` in steps of
      // `step`, for discrete-increment rolls like the treasure chest's gold).
      function rollLootPool(poolId) {
        const pool = _lootPools[poolId];
        if (!pool) return {};
        const world = _lootShopWorldState();
        const eligible = window.ConditionRegistry.rollIndependentEligible(pool.entries || [], world);
        const gained = {};
        for (const entry of eligible) {
          if (!entry.itemKey) continue; // generator-only entries (see treasureChest) are rolled by name, not through this generic path
          const min = entry.min || 0, max = entry.max != null ? entry.max : min;
          let qty;
          if (entry.step) {
            const steps = Math.floor((max - min) / entry.step) + 1;
            qty = min + Math.floor(rnd() * steps) * entry.step;
          } else {
            qty = min + Math.floor(rnd() * (max - min + 1));
          }
          if (qty > 0) gained[entry.itemKey] = (gained[entry.itemKey] || 0) + qty;
        }
        return gained;
      }

      // Shared 1-5 star quality roll — fish, harvested crops, and butchered
      // meat all use this. Weighted toward the middle (3 stars most common)
      // rather than a flat 20% each, so it doesn't feel like a coin flip;
      // otherwise deliberately simple/random for now, no per-item tuning.
      function rollItemStars(skillKey) {
        return window.SkillSystem?.rollQuality(skillKey) || 3;
      }
      function starRatingText(stars) {
        return window.SkillSystem?.starRatingText(stars) || '★'.repeat(stars) + '☆'.repeat(5 - stars);
      }

      // Settled corpses expose the same getButtons()/onAction() shape as
      // farm world objects (see makeSellCrate) so the existing action-bar
      // wiring (getWorldObjectAt → getButtons/onAction) can loot them with
      // no special-casing. Looting is what actually despawns the sprite.
      function makeCorpseWorldObject(c) {
        // Bandits are butchered by nobody — they get looted instead, including
        // a guaranteed drop of everything they were wearing. Same
        // getButtons()/onAction() shape, so getCorpseObjectAt below and the
        // action bar are unaware of the difference.
        if (c.isBandit) return window.BanditCamps.makeCorpseWorldObject(c);
        return {
          id: 'corpse_' + c.id,
          type: 'creature_corpse',
          promptRoot: c.avatarRef?.group || null,
          getButtons() {
            return [{ icon: '🍖', label: 'Butcher ' + c.def.label, action: 'obj_loot_corpse', style: 'primary', allowed: true }];
          },
          onAction(action) {
            if (action !== 'obj_loot_corpse') return { ok: false, message: 'Unknown action.' };
            const gained = rollLootPool(c.def.lootPool);
            const parts = [];
            Object.entries(gained).forEach(([key, qty]) => {
              inventory[key] = Math.min(99, (inventory[key] || 0) + qty);
              // Meat gets a quality roll same as fish/crops; hides and other
              // butchering byproducts don't.
              const meatStars = /meat/i.test(key) ? rollItemStars('combat') : null;
              if (meatStars) window.CookingSystem.recordItemQuality(key, meatStars, qty);
              parts.push((meatStars ? starRatingText(meatStars) + ' ' : '') + itemIconForKey(key) + '×' + qty);
            });
            const specialAmmo = window.RangedWeapons?.rollSpecialAmmoLoot?.() || 0; // Every creature corpse gets the same high-chance shared-ammo roll as bandits.
            if (specialAmmo) parts.push(`🏹 Special Ammo×${specialAmmo}`);
            corpseObjects.delete(c);
            despawnCreature(c);
            return {
              ok: true,
              message: parts.length ? `Butchered the ${c.def.label}: ${parts.join(' ')}` : `Nothing usable left on the ${c.def.label}.`,
            };
          },
        };
      }

      // Zone-aware corpse lookup — getWorldObjectAt only otherwise covers
      // farm/interior, but corpses can settle in any area a creature dies in.
      function getCorpseObjectAt(col, row) {
        for (const c of corpseObjects) {
          if (c.state !== 'corpse' || c.areaId !== currentArea) continue;
          if (c.corpseCol === col && c.corpseRow === row) return makeCorpseWorldObject(c);
        }
        return null;
      }

      // The action arch can be clicked a frame after the reticle has shifted
      // off the corpse tile (especially in shoulder cam). Keep corpse loot
      // tied to the same nearby interaction target instead of dropping it on
      // a stale "No object here" result.
      function getCorpseObjectForAction(action, col, row) {
        const exact = getCorpseObjectAt(col, row);
        if (exact || action !== 'obj_loot_corpse') return exact;
        let best = null, bestDist = Infinity;
        for (const c of corpseObjects) {
          if (c.state !== 'corpse' || c.areaId !== currentArea) continue;
          const dist = Math.hypot(c.x - player.x, c.y - player.y);
          const tileGap = Math.hypot((c.corpseCol ?? col) - col, (c.corpseRow ?? row) - row);
          if (dist > TILE * 2.25 || tileGap > 1.5 || dist >= bestDist) continue;
          best = c;
          bestDist = dist;
        }
        return best ? makeCorpseWorldObject(best) : null;
      }

      // dmgOpts: { tag: 'sharp'|'blunt'|'poison', heavy: boolean } — routes
      // through the resource-afflictions system (bleeding/bruising/wounded
      // stamina/etc, plus the heavy-consumes-Bruised-Health bonus) instead
      // of a plain health subtraction. See docs/js/combat/resource-system.js.
      // A captain's Counter Shield guard window (see updateBanditGuardWindow/
      // fireBanditCounterRiposte, defined with the rest of the Bandit Gangs
      // ability AI) intercepts here, mirroring how the player's OWN Counter
      // Shield intercepts via window.Combat.setPlayerDamageInterceptor —
      // this is the mirror-image (a creature's incoming hit) rather than the
      // player's own (an outgoing one), so it lives on the damage-dealing
      // side instead. Reduces the hit rather than fully no-selling it (a
      // guarding captain still visibly flinches) and fires a real riposte on
      // its own short cooldown so it can't fire on every single frame the
      // window happens to be open.
      const BANDIT_COUNTER_COOLDOWN_S = 0.6;
      function banditTryGuard(c, amount, targetPlayer) {
        if (!c.isBandit || !(c._banditGuardUntil > performance.now())) return amount;
        window.AudioSystem?.playCounterShieldBlockSfx(c.x, c.y, c.areaId);
        const t = performance.now() / 1000;
        if (t - (c._banditLastCounterAt || -99) >= BANDIT_COUNTER_COOLDOWN_S) {
          c._banditLastCounterAt = t;
          window.BanditCombat.fireCounterRiposte(c, c.def, targetPlayer);
        }
        return amount * (1 - window.BanditCombat.GUARD_DAMAGE_ABSORB);
      }

      let lastMeleeHeightBlock = null; // Persistent mobile-readable record of the latest rejected cross-height weapon hit.
      function damageCreature(c, amount, fromX, fromY, knockbackPxS, dmgOpts) {
        // Player melee must overlap the target vertically as well as pass its
        // existing top-down cone/range test. Ranged projectiles already run
        // their own swept 3D Box3 collision and deliberately bypass this.
        const sourceNearPlayer = Number.isFinite(fromX) && Number.isFinite(fromY)
          && Math.hypot(fromX - player.x, fromY - player.y) <= TILE * 1.5;
        if (!dmgOpts?.ranged && heldMode === 'tool' && activeTool === 'weapon' && sourceNearPlayer) {
          const reach = window.RangedWeapons?.meleeReachCheck?.(player, c, 0.4);
          if (reach && !reach.reachable) {
            lastMeleeHeightBlock = {
              at: Date.now(),
              target: c.id || c.name || c.def?.id || 'hostile',
              verticalGap: Number(reach.verticalGap.toFixed(3)),
              allowance: reach.allowance,
              playerOnBranch: !!player.onBranch,
              targetOnBranch: !!c.onBranch,
            };
            window.__farmLog?.(`[combat] melee height blocked target=${lastMeleeHeightBlock.target} gap=${lastMeleeHeightBlock.verticalGap}`, 'combat');
            return false;
          }
        }
        // Only the player currently ever calls damageCreature (see
        // combat-combo.js/combat-quickattacks.js/combat-charged-breaker.js/
        // combat-counter-shield.js) -- safe to assume `player` is the guarded
        // captain's riposte target without needing a passed-in attacker.
        amount *= window.SkillSystem?.attackMultiplier?.() || 1;
        amount *= window.AlchemySystem?.getOutgoingDamageMultiplier?.() || 1;
        amount *= window.PerkSystem?.combatDamageMultiplier?.(dmgOpts) || 1; // Empower Raw Damage / Quick / Defensive / Heavy Attacks.
        amount = banditTryGuard(c, amount, player);
        window.SkillSystem?.award?.('combat', window.SkillSystem?.XP_GAINS?.combatHit || 1, 'landed hit');
        const resourceDamage = hitResourceDamage(amount, dmgOpts);
        const impactMultiplier = (window.AlchemySystem?.getFootingDamageMultiplier?.() || 1) * (1 + (window.PerkSystem?.rank('combat', 'increaseFootingDamage') || 0) * 0.1); // Potion of Impact + Increase Footing Damage perk.
        resourceDamage.footing *= impactMultiplier;
        if (window.ResourceSystem) window.ResourceSystem.applyDamage(c, resourceDamage.health, dmgOpts || {});
        else c.health = Math.max(0, c.health - resourceDamage.health);
        c.hitFlashT = 0.25;
        spawnCreatureHitSpark(c);
        if (c.health <= 0) {
          hostileObjects.delete(c);
          companionObjects.delete(c);
          // A killed wild creature is the starting source of Motes of
          // Prowess — spent on ability-upgrade choices (see combat-
          // progression.js). Not awarded for a downed companion.
          if (!c.isCompanion) {
            awardMotesOfProwess(MOTES_PER_KILL);
            window.SkillSystem?.award?.('combat', window.SkillSystem?.XP_GAINS?.combatKill || 8, 'defeated creature');
          }
          window.CreatureDeath.begin(c, fromX, fromY);
          return;
        }
        // Every attack staggers its target — outright cancels whatever the
        // creature was mid-attack on (a telegraphed bite, a named attack
        // like Pounce) rather than just pausing it through the knockback
        // freeze below and letting it resume where it left off once knockback
        // decays.
        window.Combat?.telegraph?.cancel(c);
        window.Combat?.animalAttacks?.cancel(c);
        // Getting hit breaks a bandit's in-progress ability the same way it
        // cancels any other mid-attack state above, rather than letting a
        // combo silently resume its step count once it recovers.
        if (c.isBandit) { c._banditAction?.cancel(); c._banditAction = null; window.RangedWeapons?.cancelBanditAction?.(c); c.telegraphState = null; c._banditComboIndex = 0; c._banditLunging = false; }
        // Referenced by wildlife-territorial.js's own attackedDuringWarning
        // check (an already-attacked creature escalates straight to
        // fighting even from outside its proximity trigger) — that check
        // has been silently dead since territorial.js shipped, since
        // nothing was ever setting this field.
        c.lastAttackReceivedAt = performance.now();
        // A passive creature (drenkirra, uumkaoii-wild, etc. — hostile:false,
        // so it never picks up player aggro at all, see updateHostiles'
        // aggro-pickup check) had no reaction to being attacked whatsoever
        // before this: knockback/stagger applied below, then it carried on
        // with whatever it was already doing — no flee, no fight-back.
        // Reuses the exact 'fleeing-low-health' state wildlife-vs-wildlife
        // skirmishes already use (see wildlife-spawn.js's
        // applyWildlifeSkirmishDamage) — beelines home ignoring aggro/prey
        // detection, then starts a re-aggro cooldown once settled. Excludes
        // companions (an incidental hit on a passive-type follower
        // shouldn't make it bolt) and a creature wildlife-territorial.js
        // already has actively defending its nest — attacking a territorial
        // animal mid-fight should never make it flee instead; it's
        // supposed to protect its home, not bail the moment it takes a hit.
        const territorialPhase = c._territorialBehavior?.phase;
        if (c.def?.hostile === false && !c.isCompanion && territorialPhase !== 'warning' && territorialPhase !== 'fight') {
          // A drenkirra mid-forage or asleep is pinned to a branch —
          // clear that (see wildlife-cloud-forest-behavior.js's
          // interruptForFlee) before the state flip below, or the
          // branch-pin's own per-frame early-continue in updateHostiles
          // keeps re-snapping it right back to that spot forever, never
          // actually reaching the movement this state is supposed to
          // trigger. A no-op for anything not currently on a branch.
          window.HobunjiCloudForestWildlife?.interruptForFlee?.(c);
          c.state = 'fleeing-low-health';
          c.targetCreature = null;
        }
        if (fromX !== undefined) applyKnockback(c, fromX, fromY, knockbackPxS * impactMultiplier);
        applyHitStagger(c, false, c.facing || 0, c.x, c.y, fromX, fromY, resourceDamage.footing);
      }

      function damagePlayer(amount, fromX, fromY, knockbackPxS = PLAYER_KNOCKBACK_PX_S, dmgOpts) {
        if (performance.now() < player.invulnUntil) return;
        amount *= window.SkillSystem?.damageTakenMultiplier?.() || 1;
        const resourceDamage = hitResourceDamage(amount, dmgOpts);
        // Lets a held defensive ability (Counter Shield) absorb the hit and
        // riposte instead of applying damage normally — only one hold
        // ability can be active at a time, so this is a single settable slot.
        if (window.Combat?.tryInterceptPlayerDamage?.(resourceDamage.health, fromX, fromY)) return;
        _nestHoldT = 0; // getting hit interrupts a den-nest egg/baby take
        player._nestTakeActive = false;
        window.BanditCamps?.interruptTentHold(); // ...and a bandit-tent loot/burn, same reasoning
        if (window.ResourceSystem) window.ResourceSystem.applyDamage(player, resourceDamage.health, dmgOpts || {});
        else player.health = Math.max(0, player.health - resourceDamage.health);
        if (player.health > 0) {
          // Every attack staggers its target — same interrupt-plus-knockback
          // rule as damageCreature above, mirrored onto whatever combo/quick-
          // attack/charged-breaker strike the player was mid-windup on.
          window.Combat?.cancelAllStaged?.();
          if (fromX !== undefined) applyKnockback(player, fromX, fromY, knockbackPxS);
          applyHitStagger(player, true, player.angle, player.x, player.y, fromX, fromY, resourceDamage.footing);
        }
        if (player.health <= 0) respawnPlayer();
      }

      // Closest Root Totem (see wilderness-map-generator.js's
      // placeRootTotems) to a given world position, within one zone only —
      // totems don't offer a way to reach a different zone's terrain from
      // where the player actually died, so a death is always recovered
      // within its own zone or (if that zone has none, or the player wasn't
      // in a wilderness zone at all) falls back to the farmhouse. Returns
      // the totem's pathAnchor tile ({x,y}) or null.
      function nearestRootTotemFor(zoneId, worldX, worldY) {
        const totems = _zoneLayouts.get(zoneId)?.rootTotems;
        if (!totems || !totems.length) return null;
        const px = worldX / TILE, py = worldY / TILE;
        let best = null, bestDist = Infinity;
        for (const t of totems) {
          const anchor = t.pathAnchor || t;
          const d = Math.hypot(anchor.x - px, anchor.y - py);
          if (d < bestDist) { bestDist = d; best = anchor; }
        }
        return best;
      }

      function respawnPlayer() {
        const totem = _isZoneArea(currentArea) ? nearestRootTotemFor(currentArea, player.x, player.y) : null;
        if (totem) {
          player.x = (totem.x + 0.5) * TILE;
          player.y = (totem.y + 0.5) * TILE;
          player.vx = 0; player.vy = 0;
          player.health = Math.round(player.maxHealth * 0.5);
          player.invulnUntil = performance.now() + 1000;
          _snapCameraTarget();
          showToast('You awaken at the nearest Root Totem...', false);
          return;
        }
        if (currentArea !== 'farm') _returnToFarmMeshes();
        player.x = COLS * TILE * 0.5;
        player.y = ROWS * TILE * 0.72;
        player.vx = 0; player.vy = 0;
        // Full health/stamina here specifically (unlike the Root Totem
        // branch above, which stays a 50%-health lesser convenience) --
        // dying with no totem nearby already means losing all the ground
        // you'd covered back to the farmhouse; topping off on top of that
        // punishes twice over.
        player.health = player.maxHealth;
        player.stamina = player.maxStamina;
        player.invulnUntil = performance.now() + 1000;
        _snapCameraTarget();
        showToast('You black out and stumble back to the farmhouse...', false);
      }

      // Continuous angle+range cone test (not tile based) shared by player
      // weapon swings, companion bites, and hostile bites.
      function inCone(fromX, fromY, facingAngle, toX, toY, rangePx, halfConeRad) {
        const dx = toX - fromX, dy = toY - fromY;
        const dist = Math.hypot(dx, dy);
        if (dist > rangePx) return false;
        if (dist < 1) return true;
        const angTo = Math.atan2(dy, dx);
        return Math.abs(angleDiff(angTo, facingAngle)) <= halfConeRad;
      }

      // 'cut' is the narrow precise poke (tags as a Sharp hit — bleeding +
      // wounded stamina); 'slash' is the wide heavy sweep (tags as Blunt —
      // bruising + winded stamina, and consumes the target's own Bruised
      // Health for bonus damage). See docs/js/combat/resource-system.js.
      function resolveWeaponHit(action) {
        const abil = weaponAbility(action);
        if (!abil) return { hits: 0, message: '' };
        window.ResourceSystem?.spendStamina(player, abil.staminaCost, abil.name || action);
        window.AudioSystem?.playWeaponSlashSfx();
        let hits = 0;
        let lastName = '';
        const dmgType = currentWeaponDamageType(); // Used by the legacy fallback's damage routing and matching impact family.
        const impactSize = action === 'slash' ? 'huge' : 'medium'; // The legacy wide slash is its heavy attack; the ordinary cut is neutral weight.
        const dmgOpts = action === 'slash' ? { tag: dmgType, heavy: true } : { tag: dmgType };
        for (const c of hostileObjects) {
          if (c.health <= 0) continue;
          if (c.areaId !== currentArea) continue;
          if (c._denHidden) continue; // Tucked out of sight in its den — not actually there to hit.
          if (!window.Combat?.meleeHit?.(player, c, {
            rangePx: abil.rangePx,
            halfConeRad: abil.halfConeRad,
            yaw: player.angle,
            pitch: currentPlayerMeleeAimPitch(),
          })) continue;
          damageCreature(c, abil.damage, player.x, player.y, abil.knockbackPxS, dmgOpts);
          window.AudioSystem?.playWeaponHitSfx(dmgType, c.x, c.y, c.areaId, undefined, impactSize);
          hits++;
          lastName = c.def.label;
        }
        if (hits <= 0) return { hits: 0, message: '' };
        const verb = action === 'slash' ? 'Slashed' : 'Cut';
        return { hits, message: hits > 1 ? `${verb} ${hits} creatures!` : `${verb} the ${lastName}!` };
      }

      // Player-chosen override from swapAutoTarget(), preferred over the
      // nearest-hostile default until it dies, leaves range/area, or the
      // player swaps again. Cleared automatically once invalid.
      let manualAutoTarget = null;
      // Melee-only auto-target toggle (see updateMeleeAutoTarget below) —
      // an opt-in aim assist the player switches on/off themselves (Shift-
      // tap desktop, right-stick click controller, the arch's 6th mobile
      // button), unlike the old always-on lock this replaced. Forced back
      // off the instant a melee weapon isn't actually out (see
      // meleeWeaponOut) so it never lingers into farming/ranged/bare hands.
      let meleeAutoTargetOn = false;
      let meleeAutoTargetFreeAim = false; // Mouse movement releases the lock without turning the targeting toggle off.
      const MELEE_AUTO_TARGET_RETICLE_RADIUS_WORLD = 0.48; // Small 3D radius around the centered reticle used for reacquisition.
      const DESKTOP_AUTO_TARGET_MOUSE_BREAK_PX = 2; // Ignore sub-pixel noise, but any real desktop mouse movement breaks the lock.

      // Find a hostile whose 3D portrait hitbox is close enough to the centered
      // reticle. Expanding the same hitbox used by projectiles keeps reacquisition
      // forgiving without making a target behind the player eligible.
      function desktopAutoTargetNearReticle(maxDistanceWorld) {
        const ray = currentPlayerInteractionRay();
        if (ray && window.RangedWeapons?.focusCandidates && window.RangedWeapons?.actorHitbox) {
          const candidates = Array.from(hostileObjects)
            .filter(c => c.health > 0 && c.areaId === currentArea && !c._denHidden)
            .map(c => {
              const hitbox = window.RangedWeapons.actorHitbox(c);
              return hitbox?.box ? {
                type: 'hostile',
                id: c.id,
                data: c,
                box: hitbox.box.clone().expandByScalar(MELEE_AUTO_TARGET_RETICLE_RADIUS_WORLD),
              } : null;
            })
            .filter(Boolean);
          const focus = window.RangedWeapons.focusCandidates(candidates, maxDistanceWorld / TILE);
          if (focus?.candidate?.data) return focus.candidate.data;
        }
        // Fallback for a not-yet-initialized renderer: use a small ground-space
        // cone around the current aim bearing rather than nearest hostile.
        const aim = activeCameraMode === SHOULDER_SURF_MODE ? mouseLookAngle
          : controllerLookActive ? controllerLookAngle
          : (isDesktop && mouseLookActive) ? mouseLookAngle
          : player.angle;
        const radiusPx = MELEE_AUTO_TARGET_RETICLE_RADIUS_WORLD * TILE;
        let best = null, bestDist = maxDistanceWorld;
        const fx = Math.cos(aim), fy = Math.sin(aim);
        for (const c of hostileObjects) {
          if (c.health <= 0 || c.areaId !== currentArea || c._denHidden) continue;
          const dx = c.x - player.x, dy = c.y - player.y;
          const along = dx * fx + dy * fy;
          if (along < 0 || along > bestDist) continue;
          const lateral = Math.abs(dx * fy - dy * fx);
          if (lateral > radiusPx) continue;
          const dist = Math.hypot(dx, dy);
          if (dist < bestDist) { best = c; bestDist = dist; }
        }
        return best;
      }

      // Nearest live hostile in the player's current area within lock-on range, or
      // the player's manually-swapped target if still valid, or null.
      // Desktop melee only acquires while the targeting toggle is on. Once
      // mouse-look releases a lock, it waits for the reticle to pass close to
      // another hostile before reacquiring.
      function findAutoTarget() {
        const meleeActive = heldMode === 'tool' && activeTool === 'weapon' && !!equipmentSlots.weapon;
        const rangedActive = heldMode === 'tool' && activeTool === 'ranged' && !!equipmentSlots.ranged;
        if (!meleeActive && !rangedActive) {
          manualAutoTarget = null;
          meleeAutoTargetFreeAim = false;
          return null;
        }
        if (meleeActive && isDesktop && !meleeAutoTargetOn) {
          manualAutoTarget = null;
          meleeAutoTargetFreeAim = false;
          r…122152 tokens truncated…EventListener('pointercancel', ev => {
            if (ev.pointerId !== _iPtId) return;
            _iPtId = null;
            if (_iTimer) { clearTimeout(_iTimer); _iTimer = null; }
            if (_iScrollT) { clearInterval(_iScrollT); _iScrollT = null; }
            _clearArc(); _iHeld = false; _iMoved = false;
          });
        }

        // Utility menu button: sixth/new outer-ring control, replacing the
        // removed put-away button's old slot (see the CSS angle comment on
        // #btnUtilityMenu). No tap behavior at all, unlike toolBtn/itemBtn
        // above — it only ever does anything while held, exactly like the
        // desktop 'c' key equivalent (see desktopHoldKeys.c) — so this
        // mirrors their hold-then-drag-to-select pattern but skips their
        // "what does a plain tap do" branch entirely.
        const btnUtilityMenu = document.getElementById('btnUtilityMenu');
        if (btnUtilityMenu) {
          let _uPtId = null, _uHeld = false, _uTimer = null;
          btnUtilityMenu.addEventListener('pointerdown', ev => {
            if (_uPtId !== null) return;
            _uPtId = ev.pointerId; _uHeld = false;
            try { btnUtilityMenu.setPointerCapture(ev.pointerId); } catch (err) { /* degrade gracefully */ }
            _uTimer = setTimeout(() => { _uHeld = true; _openUtilitiesArc(); }, 350);
            ev.preventDefault();
          });
          btnUtilityMenu.addEventListener('pointermove', ev => {
            if (ev.pointerId !== _uPtId) return;
            if (_arcOpen === 'entries:utilities') _arcMove(ev.clientX, ev.clientY);
          });
          btnUtilityMenu.addEventListener('pointerup', ev => {
            if (ev.pointerId !== _uPtId) return;
            _uPtId = null;
            if (_uTimer) { clearTimeout(_uTimer); _uTimer = null; }
            if (_arcOpen === 'entries:utilities') _arcUp();
            _uHeld = false;
          });
          btnUtilityMenu.addEventListener('pointercancel', ev => {
            if (ev.pointerId !== _uPtId) return;
            _uPtId = null;
            if (_uTimer) { clearTimeout(_uTimer); _uTimer = null; }
            _clearArc(); _uHeld = false;
          });
        }
      }

      // ── Action bar update ──────────────────────────────────
      // ── Dynamic action stack ────────────────────────────────────────
      // Computes the full list of buttons to show, then rebuilds the DOM rows.
      // Buttons are packed into rows of 1, 2, 1, 2... (hex packing).
      // Each button: { icon, label, action, style, allowed }

      // Climb targets are pure data (branchesByArea holds positions, not a
      // per-branch mesh handle — trees are batched into merged chunk
      // geometry), so the climb-tree prompt needs its own positioned anchor
      // rather than the reticle-tile fallback other buttons share.
      const _climbPromptAnchor = new THREE.Object3D();
      _climbPromptAnchor.name = 'climb_prompt_anchor';

      function computeActionButtons() {
        // Sitting overrides every other action — Stand is the only way out,
        // same tier as fishing/dialogue below.
        if (sitInteraction) {
          return [{ icon: '🧍', label: 'Stand', action: 'obj_stand', style: 'primary', allowed: sitInteraction.phase === 'active' }];
        }
        // Fishing gets its own arc buttons instead of the harpoon's normal
        // "Fish" one (which would just call beginFishingCast() again and
        // silently restart the round) — the bottom-center #actionPrompt
        // (see renderFishingOverlay) mirrors these as an info display
        // (status text/panic bar/desktop key label), but the actual
        // thumb-reachable tap target on touch is the arc, same as every
        // other tool action. Nothing shows before 'bite' (no bite yet to
        // react to), and nothing shows during 'caught' (the victory view
        // has its own Continue button).
        if (window.Fishing?.state?.active) {
          const fm = window.Fishing.state;
          if (fm.phase !== 'bite' && fm.phase !== 'active') return [];
          const notYetMarked = fm.phase === 'bite' || fm.bridge.markerA == null;
          const icon = attackActionIconHTML('harpoon', 'fish', '🎣');
          return [
            { icon, label: notYetMarked ? 'Ready Harpoon' : 'Throw Harpoon', action: 'fish_primary', style: 'primary', allowed: true },
            { icon: '🏳️', label: 'Give up', action: 'fish_cancel', style: 'secondary', allowed: true },
          ];
        }
        // Music minigame overlay has its own full-screen controls (see
        // js/music-minigame.js) and the close button lives in the overlay
        // itself — no action-bar buttons underneath it.
        if (window.MusicMinigame?.state?.active) return [];
        // NPC dialogue takes priority over tool use on touch controls and mirrors the primary-action keyboard path.
        if (nearbyNpcWalker && !farmEditMode) {
          const btns = [npcDialogueButton()];
          if (isGeneralStoreNpcOnDuty(nearbyNpcWalker)) btns.push(generalStoreButton());
          if (isCarpenterNpcOnDuty(nearbyNpcWalker)) btns.push(carpenterButton());
          const swigOffer = window.HobunjiDrunkGameplayBridge?.getNpcSwigOfferAction?.(nearbyNpcWalker);
          if (swigOffer) btns.push(swigOffer);
          return btns;
        }

        // Interior: exit button near any door's exit threshold + interact button for interior world objects
        if (currentArea === 'interior') {
          const reticle  = getReticleTile();
          const nearExit = _interiorExitTiles.has(reticle.col + ',' + reticle.row);
          const btns     = [];
          if (nearExit) btns.push({ icon: '🚪', label: 'Exit House', action: 'obj_exit_house', style: 'primary', allowed: true });
          // getInteriorInteractableAt, not getWorldObjectAt — worldObjects is
          // the farm scene's own coordinate space (see its declaration), so
          // reticle coords while standing in the interior were being checked
          // against farm-placed objects at those same numeric coordinates.
          const iObj = getInteriorInteractableAt(reticle.col, reticle.row);
          if (iObj) btns.push({ icon: iObj.interactIcon || '🔔', label: iObj.interactLabel || 'Interact', action: 'obj_interact', style: 'primary', allowed: true });
          return btns;
        }

        // Town: spot transitions take priority (require explicit input); otherwise
        // fall through below so tools/weapons remain usable in town.
        if (currentArea === 'town' && _pendingSpotTransition) {
          const t = _pendingSpotTransition;
          const icon = t.target === 'building' ? '🚪' : '🏘';
          const label = t.label || (t.target === 'building' ? 'Enter' : 'Leave Town');
          return [{ icon, label, action: 'use_spot', style: 'primary', allowed: true }];
        }

        // Building interior: spot transitions require explicit input
        if (_isBuildingArea(currentArea)) {
          if (_pendingSpotTransition) {
            const t = _pendingSpotTransition;
            const icon = t.target === 'exit_building' ? '🚪' : '🪜';
            const label = t.label || (t.target === 'exit_building' ? 'Exit' : 'Use');
            return [{ icon, label, action: 'use_spot', style: 'primary', allowed: true }];
          }
          const nest = currentAimedNest();
          if (nest) {
            const label = nest.liveBirth ? 'Hold to Take Baby' : 'Hold to Take Egg';
            return [{ icon: nest.liveBirth ? '🐾' : '🥚', label, action: 'nest_take', style: 'primary', allowed: true, worldInteraction: true, promptRoot: nest.mesh || null }];
          }
          // A den's cavern is a boss-fight arena (see _isCavernBuildingArea) —
          // the weapon/tool combo buttons still need to populate the action
          // bar here, same as farm/zone (below), even though every other
          // building interior deliberately shows none. World objects, crops,
          // and furniture placement don't exist in a cavern, so this skips
          // straight to the tool-actions block instead of falling through
          // the farm/zone branch wholesale.
          if (_isCavernBuildingArea(currentArea) && heldMode === 'tool') {
            const cavernReticle = getReticleTile();
            const cavernTile = getActiveGrid()[cavernReticle.row]?.[cavernReticle.col];
            const cavernBtns = [];
            (toolActions[activeTool] || []).forEach((action, i) => {
              const [fallbackIcon] = actionLabels[action];
              const icon = attackActionIconHTML(activeTool, action, fallbackIcon);
              const allowed = canUseAction(activeTool, action, cavernReticle.col, cavernReticle.row);
              cavernBtns.push({
                icon, label: contextualActionLabel(action, cavernTile),
                action, style: i === 0 ? 'primary' : 'secondary', allowed,
              });
            });
            return cavernBtns;
          }
          const bReticle = getReticleTile();
          const bInteractable = _buildingInteractables.get(currentArea + ',' + bReticle.col + ',' + bReticle.row);
          if (bInteractable) return bInteractable.getButtons();
          // Building interiors return early above and never reach the
          // farm/zone/town item-context block further down (it also relies
          // on a reticle/tile pair this branch never computes) — without
          // this, held-item actions like eating or playing a Kurraya
          // silently had no button anywhere indoors, not just in the inn.
          // Mirrors the same three checks in that block, in the same
          // priority order; the plant/seed part below them doesn't apply
          // indoors so isn't duplicated here.
          if (heldMode === 'item') {
            const heldItem = getActiveInventoryItem();
            const flaskActions = window.AlchemyFlasks?.heldActions?.() || [];
            if (flaskActions.length) return flaskActions;
            const consumeAction = window.HobunjiDrunkGameplayBridge?.getHeldItemAction?.();
            if (consumeAction) return [consumeAction];
            if (heldItem && ITEM_DEFS[heldItem.key]?.isCookedFood) return [{ icon: '🍲', label: `Eat ${ITEM_DEFS[heldItem.key].label}`, action: 'consume_food_item', style: 'primary', allowed: (inventory[heldItem.key] || 0) > 0 }];
            if (heldItem && ITEM_DEFS[heldItem.key]?.isInstrument) return [{ icon: '🎵', label: 'Play', action: 'play_instrument', style: 'primary', allowed: (inventory[heldItem.key] || 0) > 0 }];
          }
          return [];
        }

        const reticle = getReticleTile();

        // Farm/zone: show spot transition button (house entrance, town exit, etc.)
        if ((currentArea === 'farm' || _isZoneArea(currentArea)) && _pendingSpotTransition) {
          const t = _pendingSpotTransition;
          const icon = t.target === 'interior' ? '🏠' : t.target === 'town' ? '🏘' : '🚪';
          const label = t.label || (t.target === 'interior' ? 'Enter House' : t.target === 'town' ? 'Leave Farm' : 'Travel');
          const btnsSpot = [];
          btnsSpot.push({ icon, label, action: 'use_spot', style: 'primary', allowed: true });
          const obj2 = getWorldObjectAt(reticle.col, reticle.row);
          if (obj2) obj2.getButtons(reticle).forEach(b => btnsSpot.push(b));
          return btnsSpot;
        }

        // A branch nest claims Action 1 only while its 3D volume is under
        // the centered reticle and its Nestmother is no longer guarding it.
        const zoneNest = _isZoneArea(currentArea) ? currentAimedNest() : null;
        if (zoneNest) {
          const label = zoneNest.liveBirth ? 'Hold to Take Baby' : 'Hold to Take Egg';
          return [{ icon: zoneNest.liveBirth ? '🐾' : '🥚', label, action: 'nest_take', style: 'primary', allowed: true, worldInteraction: true, promptRoot: zoneNest.mesh || null }];
        }

        // Bandit tents are runtime props rather than worldObjects, so expose
        // their context action explicitly. Pointer/keyboard holds still feed
        // the shared actionHeldDown flag consumed by BanditCamps.
        const banditTentAction = _isZoneArea(currentArea)
          ? window.BanditCamps?.getNearbyTentAction?.()
          : null;
        if (banditTentAction) return [banditTentAction];

        // A placed wilderness campfire, same runtime-prop pattern as bandit
        // tents above — walking up to it puts Save/Cook/Brew each on their
        // own action-bar slot (Return to Camp lives on the utilities wheel
        // instead — see the 'c' hold-key handling further down).
        const campfireActions = _isZoneArea(currentArea)
          ? window.WildernessCampfire?.getNearbyActions?.()
          : null;
        if (campfireActions?.length) return campfireActions;

        // Climbing is still triggered by a forward dodge (see
        // performContextAction) so an attack/item press never grabs a
        // nearby trunk by accident — but a facing climb target also gets a
        // listed prompt here purely for discoverability, since the dodge
        // trigger itself is otherwise silent/undiscoverable.
        const tile    = getActiveGrid()[reticle.row][reticle.col];
        const btns    = [];

        if (_isZoneArea(currentArea) && !player.climbing) {
          const climbTarget = window.ClimbSystem?.getClimbTarget?.();
          if (climbTarget && (climbTarget.type === 'branch' || climbTarget.type === 'branchJumpDown')) {
            const branch = climbTarget.branch;
            const anchorX = branch ? (branch.baseX + branch.tipX) / 2 : player.x;
            const anchorY = branch ? (branch.baseY + branch.tipY) / 2 : player.y;
            const anchorWorldY = branch
              ? Math.max(branch.baseWorldY ?? 0, branch.tipWorldY ?? 0) + 0.4
              : (activeSurfaceYAtWorld(player.x / TILE, player.y / TILE) + 1.2);
            _climbPromptAnchor.position.set(anchorX / TILE, anchorWorldY, anchorY / TILE);
            btns.push({
              icon: climbTarget.type === 'branchJumpDown' ? '🪂' : '🧗',
              label: climbTarget.type === 'branchJumpDown' ? 'Climb Down' : 'Climb Tree',
              action: 'climb_branch', style: 'secondary', allowed: true,
              worldInteraction: true, promptRoot: _climbPromptAnchor,
            });
          }
        }

        // 0. World object at reticle — its buttons take priority. Town has
        // no worldObjects of its own (see its "farm-scene-only" comment
        // above) — its furniture interactables (sittable benches, etc.)
        // live in _buildingInteractables instead, same as building interiors.
        const obj = currentArea === 'town'
          ? _buildingInteractables.get('town,' + reticle.col + ',' + reticle.row) || getWorldObjectAt(reticle.col, reticle.row)
          : getWorldObjectAt(reticle.col, reticle.row);
        if (obj) {
          const objBtns = obj.getButtons(reticle);
          objBtns.forEach(b => btns.push(b));
        }

        // 0b. Harvest, same priority tier as a world object (a ready crop
        // should behave exactly like picking a wild herb/berry: available
        // as Action 1 regardless of what's in your hand, not just while an
        // inventory item happens to be selected) — previously this only
        // ever appeared down in the item-mode-only section below, so aiming
        // at a ready crop while holding a tool showed no pick button at all.
        if (tile.crop) {
          const data = cropData[tile.crop];
          btns.push({
            icon: tile.cropReady ? data.emoji : '🌱',
            label: tile.cropReady ? '✓ Harvest' : `${tile.crop} (${Math.floor(tile.cropAge)}d)`,
            action: 'harvest', style: tile.cropReady ? 'harvest' : 'secondary',
            allowed: tile.cropReady,
          });
        }

        // 1. Tool's own actions (suppressed in item mode)
        if (heldMode === 'tool') {
          const actions = toolActions[activeTool] || [];
          actions.forEach((action, i) => {
            const [fallbackIcon] = actionLabels[action];
            const icon = attackActionIconHTML(activeTool, action, fallbackIcon);
            const allowed = canUseAction(activeTool, action, reticle.col, reticle.row);
            btns.push({
              icon, label: contextualActionLabel(action, tile),
              action, style: i === 0 ? 'primary' : 'secondary', allowed,
            });
          });
        }

        // 2+3. Item context actions — only in item mode
        if (heldMode !== 'item') return btns;

        // A selected consumable is Item Action 1. Its configured binding owns
        // consumption; raw Space/Enter/Interact keys have no special behavior.
        const heldItem = getActiveInventoryItem();
        const flaskActions = window.AlchemyFlasks?.heldActions?.() || [];
        if (flaskActions.length) flaskActions.slice().reverse().forEach(action => btns.unshift(action));
        const consumeAction = window.HobunjiDrunkGameplayBridge?.getHeldItemAction?.();
        if (!flaskActions.length && consumeAction) btns.unshift(consumeAction);
        else if (heldItem && ITEM_DEFS[heldItem.key]?.isCookedFood) btns.unshift({ icon: '🍲', label: `Eat ${ITEM_DEFS[heldItem.key].label}`, action: 'consume_food_item', style: 'primary', allowed: (inventory[heldItem.key] || 0) > 0 });
        else if (heldItem && ITEM_DEFS[heldItem.key]?.isInstrument) btns.unshift({ icon: '🎵', label: 'Play', action: 'play_instrument', style: 'primary', allowed: (inventory[heldItem.key] || 0) > 0 });
        else if (heldItem && heldItem.key === 'campfireKitFurniture') btns.unshift({ icon: '🔥', label: 'Set Up Campfire', action: 'place_campfire_kit', style: 'primary', allowed: _isZoneArea(currentArea) && (inventory[heldItem.key] || 0) > 0 });

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
          const decorKey = getDecorativeFurnitureKeyByItemKey(item.key);
          if (decorKey && !DECORATIVE_FURNITURE_DEFS[decorKey]?.customPlace) {
            const def = DECORATIVE_FURNITURE_DEFS[decorKey];
            const count = inventory[item.key] || 0;
            const areaOk = def.area === 'any' || (def.area === 'interior' && currentArea === 'interior') || (def.area === 'farm' && currentArea === 'farm');
            btns.push({
              icon: item.icon,
              label: count > 0 ? `Place (${count})` : 'No furniture',
              action: 'place_decor_' + decorKey,
              style: 'plant',
              allowed: count > 0 && areaOk && canPlaceDecorativeFurnitureAt(reticle.col, reticle.row),
            });
          }
        }

        return btns;
      }

      // Fallback anchor for interactibles without their own Object3D. It is
      // moved to the aimed tile before the world-space list is synchronized.
      const _worldInteractionPromptAnchor = new THREE.Object3D(); // Used by refreshActionBar for non-mesh world objects.
      _worldInteractionPromptAnchor.name = 'world_interaction_prompt_anchor';

      // Track last state to avoid rebuilding the stack every frame
      let _lastBarKey = '';

      function refreshActionBar(stacks = getInventoryStackItems()) {
        window.DevSpawner.refreshEditorButtonVisibility();
        window.FurniturePlacer?.refreshVisibility();
        const reticle = getReticleTile();
        const tile    = getActiveTileAt(reticle.col, reticle.row);

        // Was farm-only (world objects didn't exist elsewhere) — now
        // unconditional so a lootable corpse's identity in any area (zones
        // included) still invalidates the cache and rebuilds its button.
        const obj = getWorldObjectAt(reticle.col, reticle.row);
        const nearbyNpcKey = nearbyNpcWalker?.rec?.id || nearbyNpcWalker?.root?.uuid || 'none';
        const nearbyNpcActivityKey = nearbyNpcWalker?.currentScheduleTarget?.activity || 'none';
        const nearbyNpcShopKey = nearbyNpcWalker && isGeneralStoreNpcOnDuty(nearbyNpcWalker) ? generalStoreAction()
          : nearbyNpcWalker && isCarpenterNpcOnDuty(nearbyNpcWalker) ? carpenterAction() : 'none';
        // Consumable counts must invalidate the cached action after the last item is used.
        const selectedItem = getActiveInventoryItem(stacks);
        const selectedItemKey = selectedItem?.key || '';
        const selectedItemCount = selectedItemKey ? (inventory[selectedItemKey] || 0) : 0;
        const btns = computeActionButtons();
        // Every action supplied by an aimed world object is a world
        // interaction even if its id predates the obj_* naming convention.
        const objectActionIds = new Set((obj?.getButtons?.(reticle) || []).map(button => button.action));
        const isWorldInteraction = button => button?.worldInteraction
          || button?.contextualHeldItem
          || objectActionIds.has(button?.action)
          || button?.action === npcDialogueAction()
          || button?.action === generalStoreAction()
          || button?.action === carpenterAction()
          || button?.action === 'use_spot'
          || button?.action === 'nest_take'
          || button?.action === 'bandit_tent_interact'
          || button?.action === 'climb_branch'
          || button?.action?.startsWith('obj_');
        const interactionButton = btns.find(isWorldInteraction) || null;
        if (interactionButton) {
          _worldInteractionPromptAnchor.position.set(
            reticle.col + 0.5,
            activeSurfaceYAtWorld(reticle.col + 0.5, reticle.row + 0.5) + 0.55,
            reticle.row + 0.5,
          );
        }
        const interactionRoot = interactionButton?.promptRoot
          || nearbyNpcWalker?.root
          || obj?.promptRoot || obj?.root || obj?.group || obj?.mesh
          || (interactionButton ? _worldInteractionPromptAnchor : null);
        const promptActionIds = ['action1', 'action2', 'action3', 'interact'];
        const promptKeys = promptActionIds.map((actionId, index) =>
          actionPromptGlyph(actionId, lastInputDevice === 'touch' ? `Action ${index + 1}` : ''));
        window.WorldPopupText?.syncInteractionPrompts?.({
          buttons: btns,
          root: interactionRoot,
          enabled: !menuOpen && !dialogueOpen && !paused,
          scene: getActiveScene(),
          promptKeys,
          showInputHints: true,
          isWorldInteraction,
        });
        // Dynamic providers (including the asynchronously loaded consumable
        // bridge) can change the resolved arch without changing tile/item state.
        const actionButtonKey = btns.map(button => `${button.action}:${button.allowed !== false ? 1 : 0}:${button.label}:${button.swigFraction || ''}`).join(',');
        // window.Fishing?.state?.phase (not just .active) must be in this key:
        // computeActionButtons() returns different button sets across the
        // cast/waiting/bite/active/caught sequence (empty until 'bite', the
        // fish_primary/fish_cancel pair from 'bite' onward), but that whole
        // sequence usually doesn't touch anything else the key tracks (same
        // tile, same tool, same reticle) — keying on just .active would've
        // caught the very first transition into fishing but then never
        // rebuilt again for the rest of the round, since .active stays true
        // throughout. Phase changes every step, so it always forces a rebuild.
        const key = `${currentArea}|${heldMode}|${activeTool}|${activeItemIndex}|${selectedItemKey}|${selectedItemCount}|${reticle.col},${reticle.row}|${tile.type}|${tile.crop}|${tile.cropReady}|${obj ? obj.id : 'none'}|${processingFurnitureObjects.size}|${animalObjects.size}|${_pendingSpotTransition?.id || ''}|${nearbyNpcKey}|${nearbyNpcActivityKey}|${nearbyNpcShopKey}|${window.Fishing?.state?.phase || ''}|${window.MusicMinigame?.state?.active || ''}|${actionButtonKey}`;
        const needsRebuild = key !== _lastBarKey;
        _lastBarKey = key;

        // Update activeAction even without DOM rebuild. climb_branch
        // (pushed first in computeActionButtons purely to feed the 3D
        // floating world-space prompt over a climbable branch — see its
        // own comment) is excluded outright here, not just deprioritized:
        // climbing is only ever supposed to trigger from a forward dodge
        // (see performContextAction), never from Action 1/a tool press —
        // an earlier "prefer non-secondary, fall back to secondary only if
        // it's the sole allowed action" version of this still let a lone
        // climb target win Action 1 whenever nothing else was interactable
        // (e.g. no tool equipped), which is exactly the case a player
        // facing a tree is most likely to be in.
        const climbBtn = btns.find(b => b.action === 'climb_branch');
        const nonClimbBtns = climbBtn ? btns.filter(b => b !== climbBtn) : btns;
        const first = nonClimbBtns.find(b => b.allowed && b.style !== 'secondary') || nonClimbBtns.find(b => b.allowed) || nonClimbBtns[0];
        if (first) activeAction = first.action;
        // The dodge button is climbing's only real trigger, so it's the
        // one that should visually say so — swaps to the climb/climb-down
        // icon+label while a target's in reach, back to the plain dodge
        // icon otherwise.
        if (dodgeBtn) {
          const icon = dodgeBtn.querySelector('.abt-icon'), label = dodgeBtn.querySelector('.abt-label');
          if (icon) icon.textContent = climbBtn ? climbBtn.icon : '💨';
          if (label) label.textContent = climbBtn ? climbBtn.label : 'Dodge';
        }

        if (!needsRebuild) return;

        // Split tool actions from item-owned consume/plant/place/harvest actions;
        // climb_branch is excluded from every arch slot below for the same
        // reason it's excluded from activeAction above — it still stays in
        // the full btns array so the 3D world-space prompt keeps working.
        const isItemButton = b => b.action === 'consume_held_item' || b.action === 'consume_food_item' || b.action === 'play_instrument' || b.action.startsWith('alchemy_flask_') || b.action.startsWith('plant_')
          || b.action.startsWith('place_') || b.action.startsWith('spawn_') || b.action === 'harvest';
        const toolBtns = nonClimbBtns.filter(b => !isItemButton(b));
        const itemBtns = nonClimbBtns.filter(isItemButton);

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
          const swigBadge = b.swigFraction
            ? `<span class="alcohol-swig-badge">${b.swigFraction}</span>` : '';
          el.innerHTML = keyBadge +
            `<span class="abt-icon">${b.icon}${swigBadge}</span>` +
            `<span class="abt-label">${b.label}</span>`;
          if (!el._abtDragInit) {
            el._abtDragInit = true;
            let _ptId = null, _cx = 0, _cy = 0, _sockR = 0;
            let _drag = false, _rtimer = null, _socket = null;
            let _chargeFiredOnPress = false;
            let _pressSlot = null; // 1 or 2 while a weapon tool-action button is mid-press
            let _selectorHoldTimer = null, _selectorArcOpen = false, _selectorKind = null; // Ammo and potions both require a sustained original input and commit on its release.
            let _flaskGesture = false, _flaskCanceled = false; // Used by mobile hold-drag-release flask aiming.
            const DRAG_THRESH = 10;
            // Legacy behavior: holding+dragging an action button like a stick used to
            // keep re-firing the action every 120ms for as long as it stayed pushed off
            // center. Disabled per design (the single immediate fire-on-threshold-cross
            // below still happens) — kept here, not deleted, in case it's wanted back.
            const ABT_DRAG_REPEAT_FIRE = false;
            const _stack = document.getElementById('actionStack');

            function _abtFire() {
              const act = el.dataset.action;
              if (!act || el.classList.contains('abt-hidden')) return;
              activeAction = act;
              // Navigation/interaction actions always fire; tool actions respect swing cooldown.
              // fish_primary/fish_cancel bypass it too — spearfishing has never
              // used the swing-timer system (see fireFishingBridge's own note on
              // this), so gating the arc button behind it here would just mean
              // a stray leftover toolSwingT from whatever was equipped before
              // switching to the harpoon could silently eat the tap. climb is the
              // same story: it's pure traversal, not a tool swing, so a leftover
              // toolSwingT from whatever was equipped before walking up to a
              // cliff shouldn't be able to eat the tap either.
              const isNavAction = act === npcDialogueAction() || act === generalStoreAction() || act === carpenterAction() || act === 'npc_offer_alcohol_swig' || act === 'use_spot' || act === 'obj_exit_house' || act === 'climb' || act.startsWith('obj_') || act.startsWith('fish_');
              // Same reasoning again for every item-mode action (place_campfire_kit,
              // consume_food_item, plant_*, alchemy_flask_*, ...): none of them are
              // tool swings either, so a leftover toolSwingT from whatever tool was
              // out before switching to item mode — which updateToolMesh never
              // decays while heldMode === 'item' (it early-returns before reaching
              // that logic) — would otherwise silently eat every item-mode tap on
              // mobile until the player switched back to a tool and let the stale
              // timer run out. Desktop's direct pointerdown→useActiveAction() click
              // path never had this gate at all, which is why this only ever
              // surfaced as "the button doesn't work" on touch.
              if (isNavAction || heldMode === 'item' || toolSwingT <= 0) useActiveAction();
            }

            // Weapon tool-action buttons (cut/slash) route taps through the
            // loadout's ability slots instead of firing the swing directly —
            // every other button keeps using _abtFire() unchanged.
            function _weaponSlotFor(act) {
              if (activeTool !== 'weapon' || !window.Combat?.input) return null;
              if (act === toolActions.weapon[0]) return 1;
              if (act === toolActions.weapon[1]) return 2;
              return null;
            }
            function _resolveFire() {
              const slot = _weaponSlotFor(el.dataset.action);
              if (slot) { window.Combat.input.fireTap(slot); return; }
              _abtFire();
            }

            el.addEventListener('pointerdown', ev => {
              if (_ptId !== null) return;
              _ptId = ev.pointerId;
              // See handleJoystickPointerDown's comment.
              try { el.setPointerCapture(ev.pointerId); } catch (err) { /* degrade gracefully */ }
              const rect = el.getBoundingClientRect();
              _cx = rect.left + rect.width / 2;
              _cy = rect.top + rect.height / 2;
              _sockR = rect.width * 0.70;
              _drag = false;
              _socket = document.createElement('div');
              _socket.className = 'abt-socket';
              _socket.style.left   = _cx + 'px';
              _socket.style.top    = _cy + 'px';
              _socket.style.width  = (rect.width * 2.2) + 'px';
              _socket.style.height = (rect.width * 2.2) + 'px';
              document.body.appendChild(_socket);
              el.style.transition = 'none';
              ev.preventDefault();
              // Hold-to-dig/fill must start on press (not release) so the charge
              // can run for its full duration while the button stays held.
              const act = el.dataset.action;
              _flaskGesture = act === 'alchemy_flask_primary';
              _flaskCanceled = false;
              if (_flaskGesture && !window.AlchemyFlasks?.aiming) _abtFire(); // Mobile press enters aim without consuming.
              if (act === 'ammo_select' || act === 'potion_select') {
                _selectorKind = act === 'ammo_select' ? 'ammo' : 'potions';
                window._desktopSelectionArc?.beginHeldSelection?.(_selectorKind); // Lets a physical mouse wheel navigate while this on-screen button owns the hold.
                _selectorArcOpen = true; // These actions have no tap behavior to preserve, so show their choices as soon as the held input begins.
                if (_selectorKind === 'ammo') window._desktopSelectionArc?.openAmmo();
                else window._desktopSelectionArc?.openPotions();
              }
              _chargeFiredOnPress = Boolean(act && !el.classList.contains('abt-hidden') && wouldStartCharge(activeTool, act));
              if (_chargeFiredOnPress) {
                activeAction = act;
                actionHeldDown = true;
                _abtFire();
              } else {
                actionHeldDown = true;
                _pressSlot = _weaponSlotFor(act);
                if (_pressSlot) { tryAutoEngageMeleeTarget(); window.Combat.input.pressStart(_pressSlot); }
              }
            });

            el.addEventListener('pointermove', ev => {
              if (ev.pointerId !== _ptId) return;
              const dx = ev.clientX - _cx, dy = ev.clientY - _cy;
              const dist = Math.hypot(dx, dy);
              const r = Math.min(dist, _sockR);
              const nx = dist > 0.5 ? dx / dist * r : 0;
              const ny = dist > 0.5 ? dy / dist * r : 0;
              el.style.transform = `translate(calc(50% + ${nx}px), calc(50% + ${ny}px))`;
              if (_flaskGesture && window.AlchemyFlasks?.aiming) {
                window.AlchemyFlasks.setTargetFromVector(dx, dy, Math.min(1, dist / Math.max(1, _sockR)));
                const cancelButton = [...document.querySelectorAll('[data-action="alchemy_flask_cancel"]')][0]; // Current Item Action 2 cancel region.
                const cancelRect = cancelButton?.getBoundingClientRect(); // Used for continuous drag-over cancellation.
                if (cancelRect && ev.clientX >= cancelRect.left && ev.clientX <= cancelRect.right && ev.clientY >= cancelRect.top && ev.clientY <= cancelRect.bottom) {
                  cancelButton.classList.add('flask-cancel-hover');
                  window.AlchemyFlasks.cancelAim();
                  _flaskCanceled = true;
                }
                return;
              }
              if (_selectorKind) {
                if (_selectorArcOpen) window._desktopSelectionArc?.movePointer(ev.clientX, ev.clientY);
                return;
              }
              // With a weapon equipped, action buttons are tap/hold only — dragging
              // must never act like a directional stick, otherwise a thumb wobbling
              // mid-hold reads as an aim-drag, cancels the pending hold ability, and
              // fires a tap instead. Farm tools still use drag-to-aim as before.
              if (activeTool === 'weapon') return;
              if (dist > DRAG_THRESH) {
                const ang = Math.atan2(dy, dx);
                facingAngle = ang;
                lastMoveAngle = ang;
                player.angle = ang;
                // Actually retarget the reticle (getReticleTile() reads
                // targetAimAngle, not facingAngle/player.angle — see its
                // declaration) so this drag genuinely aims farm-tool actions
                // like axe chop / pick mine at a specific tile on mobile,
                // instead of only rotating the player's visual facing while
                // the reticle stays wherever the movement joystick last
                // pointed it.
                targetAimAngle = ang;
                if (!_drag) {
                  _drag = true;
                  _stack.classList.add('drag-active');
                  // Aiming takes over firing from here — disarm the tap/hold
                  // timer so release doesn't also fire/end an ability.
                  if (_pressSlot) { window.Combat.input.cancelPress(_pressSlot); _pressSlot = null; }
                  _resolveFire();
                  if (ABT_DRAG_REPEAT_FIRE) _rtimer = setInterval(_resolveFire, 120);
                }
              }
            });

            function _abtUp(ev) {
              if (ev.pointerId !== _ptId) return;
              _ptId = null;
              actionHeldDown = false;
              if (_selectorHoldTimer) { clearTimeout(_selectorHoldTimer); _selectorHoldTimer = null; }
              if (_rtimer) { clearInterval(_rtimer); _rtimer = null; }
              _stack.classList.remove('drag-active');
              if (_socket) { _socket.remove(); _socket = null; }
              el.style.transition = 'transform 0.14s ease-out';
              el.style.transform  = 'translate(50%, 50%)';
              setTimeout(() => { el.style.transition = ''; el.style.transform = ''; }, 150);
              if (_selectorKind) {
                if (_selectorArcOpen) {
                  if (ev.type === 'pointercancel') window._desktopSelectionArc?.close();
                  else window._desktopSelectionArc?.releaseSelection();
                }
              } else if (_flaskGesture) {
                if (!_flaskCanceled && window.AlchemyFlasks?.aiming) window.AlchemyFlasks.confirmThrow();
              } else if (!_drag && !_chargeFiredOnPress) {
                if (_pressSlot) window.Combat.input.pressEnd(_pressSlot);
                else _abtFire();
              }
              _drag = false;
              _chargeFiredOnPress = false;
              _selectorArcOpen = false;
              if (_selectorKind) window._desktopSelectionArc?.endHeldSelection?.();
              _selectorKind = null;
              document.querySelectorAll('.flask-cancel-hover').forEach(button => button.classList.remove('flask-cancel-hover'));
              _flaskGesture = false;
              _flaskCanceled = false;
              _pressSlot = null;
            }

            el.addEventListener('pointerup', _abtUp);
            el.addEventListener('pointercancel', _abtUp);
          }
        }

        if (heldMode === 'item') {
          // Item mode: all actions spread across all 5 arch positions
          // (climb_branch excluded — see nonClimbBtns above)
          applyAbt('btnAction1',    nonClimbBtns[0], btns.indexOf(nonClimbBtns[0]));
          applyAbt('btnAction2',    nonClimbBtns[1], btns.indexOf(nonClimbBtns[1]));
          applyAbt('btnAction3',    nonClimbBtns[2], btns.indexOf(nonClimbBtns[2]));
          applyAbt('btnItemAction1', nonClimbBtns[3], btns.indexOf(nonClimbBtns[3]));
          applyAbt('btnItemAction2', nonClimbBtns[4], btns.indexOf(nonClimbBtns[4]));
        } else {
          applyAbt('btnAction1',    toolBtns[0], btns.indexOf(toolBtns[0]));
          applyAbt('btnAction2',    toolBtns[1], btns.indexOf(toolBtns[1]));
          applyAbt('btnAction3',    toolBtns[2], btns.indexOf(toolBtns[2]));
          applyAbt('btnItemAction1', itemBtns[0], btns.indexOf(itemBtns[0]));
          applyAbt('btnItemAction2', itemBtns[1], btns.indexOf(itemBtns[1]));
        }

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
        const _eqItem = equipmentSlots[activeTool];
        const _eqDef  = _eqItem ? TOOL_ITEM_DEFS[_eqItem] : null;
        const _khFallback = ({ shovel:['⛏️','Shovel'], hoe:['🪓','Hoe'], axe:['🪓','Axe'], pick:['⛏️','Pick'], harpoon:['🎣','Harpoon'], weapon:['🗡️','Weapon'], machete:['🗡️','Weapon'] }[activeTool] || ['🔧', activeTool]);
        const toolInfo = [toolSelectIconHTML(_eqDef, _khFallback[0], '13px'), _eqDef?.label || _khFallback[1]];
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
            `<span class="kh-item"><span class="kh-item-icon">${item.icon}</span> ${item.label} ×${count}</span>` +
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
        if (item) {
          applyItemSpriteIcon(keyHudEl.querySelector('.kh-item-icon'), ITEM_DEFS[item.key], item.key);
        }
      }

      function contextualActionLabel(action, tile) {
        if (action === 'dig')   return tile.type === TileType.TRENCH ? 'Redig' : 'Dig';
        if (action === 'fill')  return 'Fill';
        if (action === 'raise') return tile.type === TileType.RAISED ? 'Lower' : 'Raise';
        if (action === 'till')  return tile.type === TileType.TILLED ? 'Untill' : 'Till';
        if (action === 'smooth') return 'Smooth';
        if (action === 'cut')   return 'Cut';
        if (action === 'slash') return 'Slash 3×';
        if (action === 'chop')  return 'Chop';
        if (action === 'hack')  return 'Hack 3×';
        if (action === 'mine')  return 'Mine';
        if (action === 'harvest') return tile.cropReady ? '✓ Harvest' : 'Growing';
        if (action === 'fish') return 'Fish';
        if (action === 'shoot') return window.RangedWeapons?.playerActionLabel?.(equipmentSlots.ranged) || 'Fire';
        if (action === 'ammo_select') return window.RangedWeapons?.ammoActionLabel?.(equipmentSlots.ranged) || 'Basic Ammo';
        if (action === 'potion_select') return 'Potions';
        if (action.startsWith('place_')) return 'Place';
        if (action.startsWith('obj_process_')) return 'Process';
        return action;
      }

      // ── Item scroll ────────────────────────────────────────
      let _lastItemScrollKey = null;
      function refreshItemScroll(stacks = getInventoryStackItems()) {
        const n = stacks.length;
        const iBtnEl = itemBtnEl;
        if (n === 0) {
          if (_lastItemScrollKey === 'empty') return;
          _lastItemScrollKey = 'empty';
          itemIcon.textContent  = '□';
          itemName.textContent  = 'EMPTY';
          itemCount.textContent = '×0';
          itemCount.className   = 'is-count empty';
          if (iBtnEl) iBtnEl.textContent = '□';
          const prevEl = isPrevIconEl;
          const nextEl = isNextIconEl;
          clearItemSpriteIcon(itemIcon);
          clearItemSpriteIcon(iBtnEl);
          if (prevEl) prevEl.textContent = '□';
          if (nextEl) nextEl.textContent = '□';
          clearItemSpriteIcon(prevEl);
          clearItemSpriteIcon(nextEl);
          return;
        }
        if (activeItemIndex >= n) activeItemIndex = 0;
        if (activeItemIndex < 0) activeItemIndex = n - 1;
        const curr = stacks[activeItemIndex];
        const prev = stacks[(activeItemIndex - 1 + n) % n];
        const next = stacks[(activeItemIndex + 1) % n];
        const count = inventory[curr.key] || 0;
        const key = `${curr.key}:${count}:${prev.key}:${next.key}`;
        if (key === _lastItemScrollKey) return;
        _lastItemScrollKey = key;
        // Current item
        itemIcon.textContent  = curr.icon;
        itemName.textContent  = curr.label;
        if (iBtnEl) iBtnEl.textContent = curr.icon;
        applyItemSpriteIcon(itemIcon, ITEM_DEFS[curr.key], curr.key);
        applyItemSpriteIcon(iBtnEl, ITEM_DEFS[curr.key], curr.key);
        itemCount.textContent = `×${count}`;
        itemCount.className   = 'is-count' + (count === 0 ? ' empty' : '');
        // Peek icons (prev/next previews)
        const prevEl = isPrevIconEl;
        const nextEl = isNextIconEl;
        if (prevEl) {
          prevEl.textContent = prev.icon;
          applyItemSpriteIcon(prevEl, ITEM_DEFS[prev.key], prev.key);
        }
        if (nextEl) {
          nextEl.textContent = next.icon;
          applyItemSpriteIcon(nextEl, ITEM_DEFS[next.key], next.key);
        }
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

      // Status-pill fields only actually change a few times a (real) second
      // at most (season/weather/day/gold on world-state events, time once a
      // simulated minute, tool/tile/water on reticle or equip changes) —
      // updateHud runs every frame, so each field caches its last-written
      // string/color and skips the DOM write (and, for spTile/spWater,
      // the string-building) when nothing changed.
      const _hud = { season: null, weather: null, time: null, day: null, tool: null, tile: null, waterText: null, waterColor: null, gold: null, item: null };

      function updateHud() {
        const season = window.CalendarSystem.currentSeason();
        const clock  = formatClock(window.CalendarSystem.getHour());

        // Season (changes slowly)
        const seasonText = season.emoji + ' ' + season.name;
        if (seasonText !== _hud.season) { _hud.season = seasonText; spSeason.textContent = seasonText; }

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
        const weatherFull = weatherText + ' ' + precipText;
        if (weatherFull !== _hud.weather) { _hud.weather = weatherFull; spWeather.textContent = weatherFull; }

        if (clock !== _hud.time) { _hud.time = clock; spTime.textContent = clock; }
        if (spDay) {
          const dayText = window.CalendarSystem.formatCalendarDate();
          if (dayText !== _hud.day) { _hud.day = dayText; spDay.textContent = dayText; }
        }
        const toolText = heldMode === 'none' ? '✋ Hands free' : toolEmoji(activeTool) + ' ' + actionName(activeAction);
        if (toolText !== _hud.tool) { _hud.tool = toolText; spTool.textContent = toolText; }

        // Reticle tile info
        const reticle  = getReticleTile();
        const tile     = getActiveTileAt(reticle.col, reticle.row);
        const tStyle   = tileStyles[tile.type] || tileStyles.grass;
        const cropStr  = tile.crop ? ` · ${tile.crop}${tile.cropReady ? ' ✓' : ''}` : '';
        const tileText = (currentArea === 'interior' ? '🏠 ' : '') + tStyle.label + cropStr;
        if (tileText !== _hud.tile) { _hud.tile = tileText; spTile.textContent = tileText; }

        const waterPct = Math.round((tile.water / MAX_WATER) * 100);
        const depthStr = tile.water > 0.01 ? `${waterPct}%` : 'dry';
        const waterText = '💧 ' + depthStr;
        if (waterText !== _hud.waterText) { _hud.waterText = waterText; spWater.textContent = waterText; }
        const waterColor = waterPct > 80 ? '#4488ff'
                          : waterPct > 40 ? '#6ec6f0'
                          : waterPct > 10 ? '#aaddee' : '#888';
        if (waterColor !== _hud.waterColor) { _hud.waterColor = waterColor; spWater.style.color = waterColor; }
        if (spGold) {
          const goldText = '💰 ' + inventory.gold + 'g';
          if (goldText !== _hud.gold) { _hud.gold = goldText; spGold.textContent = goldText; }
        }

        // Computed once and threaded through below instead of letting
        // refreshItemScroll/refreshActionBar (and the desktop item pill)
        // each re-filter-and-sort the whole inventory from scratch — this
        // runs every frame, and inventory contents don't change nearly
        // that often.
        const stacks = getInventoryStackItems();

        // Desktop: show active item in status pill (item scroll is hidden)
        if (isDesktop) {
          const item = getActiveInventoryItem(stacks);
          if (spItem && item) {
            spItem.style.display = '';
            spItemDiv.style.display = '';
            const itemText = '[Tab] ' + item.icon + ' ' + item.label + ' ×' + (inventory[item.key] || 0);
            if (itemText !== _hud.item) { _hud.item = itemText; spItem.textContent = itemText; }
          }
        }

        refreshItemScroll(stacks);
        // refreshActionBar is called after actions and on tool/item change;
        // the dirty-key check makes it cheap to call here too for reticle updates
        refreshActionBar(stacks);
        if (menuOpen) {
          // Keep wallet display live while menu is open
          const wd = document.getElementById('invWalletDisplay');
          if (wd) wd.textContent = (inventory.gold || 0) + 'g';
        }
      }

      function updateMenuContent() { /* replaced by buildInventoryGrid() */ }

      function updateDebugPage() { /* debug panel removed from menu */ }

      function toolEmoji(tool) {
        const equipped = equipmentSlots[tool];
        if (equipped && TOOL_ITEM_DEFS[equipped]) return TOOL_ITEM_DEFS[equipped].icon;
        return { shovel:'⛏️', hoe:'🪓', axe:'🪓', pick:'⛏️', harpoon:'🎣', weapon:'🗡️', ranged:'🏹', machete:'🗡️', seeds:'🌱' }[tool] || '❔';
      }

      function nextRainText() {
        if (!calendar.nextRainWindows.length) return 'No rain scheduled today';
        const hour = window.CalendarSystem.getHour();
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
        const equipped = equipmentSlots[tool];
        const def = equipped ? TOOL_ITEM_DEFS[equipped] : null;
        if (def) return `${def.icon} ${def.label}`;
        return { shovel:'⛏️ Shovel', hoe:'🪓 Hoe', axe:'🪓 Axe', pick:'⛏️ Pick', harpoon:'🎣 Harpoon', weapon:'🗡️ Weapon', ranged:'🏹 Ranged Weapon', machete:'🗡️ Weapon', seeds:'🌱 Seeds' }[tool] || tool;
      }

      function seededRandom(seed) {
        const x = Math.sin(seed) * 10000;
        return x - Math.floor(x);
      }

      function handleJoystickPointerDown(event) {
        input.joystickPointerId = event.pointerId;
        // setPointerCapture can throw ("No active pointer with the given id
        // is found") if the browser doesn't consider this pointer fully
        // active yet — seen in practice on a touch that starts while the
        // page/layout is still settling right after load. Uncaught, that
        // exception used to abort this function before updateJoystick()
        // ran, permanently stranding joystickPointerId pointed at a pointer
        // that would never get a matching pointerup — every real touch
        // after that got silently ignored (input.joystickPointerId !==
        // event.pointerId in handleJoystickPointerMove/Up) until a full
        // page reload reset the state. Without capture the joystick still
        // works normally; the only loss is that a drag which leaves
        // joystickZone's own DOM bounds stops being tracked.
        try { joystickZone.setPointerCapture(event.pointerId); } catch (e) { /* see above — degrade gracefully, don't skip updateJoystick */ }
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
        const filter = window.__debugLogFilter || 'all';
        const rawLog = window.__farmDebugLog || [];
        const filteredLog = window.__debugLogMatchesFilter
          ? rawLog.filter(e => window.__debugLogMatchesFilter(e, filter))
          : rawLog;
        const lines = [
          'Tropical Trench Farm Debug Report',
          ...(filter !== 'all' ? [`Debug filter: ${filter} (${filteredLog.length}/${rawLog.length} entries)`] : []),
          `User agent: ${navigator.userAgent}`,
          `Viewport: ${window.innerWidth}x${window.innerHeight}`,
          `UI rect: ${getComputedStyle(document.documentElement).getPropertyValue('--gw').trim()} × ${getComputedStyle(document.documentElement).getPropertyValue('--gh').trim()} at ${getComputedStyle(document.documentElement).getPropertyValue('--ox').trim()}, ${getComputedStyle(document.documentElement).getPropertyValue('--oy').trim()}`,
          `3D rect: ${Math.round(threeContainer.getBoundingClientRect().width)}x${Math.round(threeContainer.getBoundingClientRect().height)}`,
          `Joystick viewport anchor: ${Math.round(joystickZone.getBoundingClientRect().left)}px left, ${Math.round(window.innerHeight - joystickZone.getBoundingClientRect().bottom)}px bottom`,
          `Movement tuning: speed=${MOVE_SPEED} accel=${ACCEL} turn=${TURN_ACCEL} decel=${DECEL} deadzone=${JOYSTICK_DEADZONE}`,
          `Action FX: particles=${actionParticles.length} tileFlashes=${actionTileEffects.length} slashTrails=${weaponTrailEffects.length}`,
          `Calendar: ${window.CalendarSystem.formatCalendarDate()} (raw day ${calendar.day}), ${formatClock(window.CalendarSystem.getHour())}, ${calendar.weather}`,
          `Tool/action: ${toolName(activeTool)} / ${actionName(activeAction)}`,
          `Player: x${player.x.toFixed(0)} y${player.y.toFixed(0)}`,
          '--- raw log ---',
          ...filteredLog.map(e => `[${e.t}] [${e.lvl}] ${e.msg}`)
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
        // Wipes the whole shared farm (day/weather/furniture/animals) and this
        // character's own inventory back to day one — owner-only, same as the
        // farm editor, so a farmhand can't nuke the owner's ongoing work.
        if (!isFarmOwner()) {
          showToast("Only the farm's owner can reset the farm.", false);
          return;
        }
        calendar.day = 1;
        calendar.time01 = 0.30;
        calendar.weather = 'rain';
        calendar.isRaining = true;
        calendar.rainStrength = 2;
        calendar.nextRainWindows = [{ start: 8, end: 14, strength: 2 }];
        calendar.lastRainDay = 1;
        _saveWorldCalendar();
        Object.keys(inventory).forEach(key => { delete inventory[key]; });
        Object.assign(inventory, { ...STARTING_INVENTORY });
        clearPlacedProcessingFurniture();
        clearInteriorFurniture();
        window.FarmBuildings.clearAll(); // re-added from layout below, same as furniture/decor — the house/farm structures survive a reset, only day/weather/inventory/livestock do not
        window.FarmAnimals.clearAnimalObjects();
        _saveWorldLivestock([]); // full farm reset also clears released animals from the world file
        clearHostileObjects();
        despawnCompanions();
        worldObjects.forEach(o => o.reset && o.reset());
        grid = createInitialGrid();
        { const _sl = loadFarmLayout(); if (_sl) applyFarmLayoutToGrid(_sl); }
        player.x = COLS * TILE * 0.5;
        player.y = ROWS * TILE * 0.72;
        player.angle = -Math.PI / 2;
        player.vx = 0; player.vy = 0;
        player.health = player.maxHealth;
        player.stamina = player.maxStamina;
        player.dodging = false; player.dodgeT = 0; player.dodgeCooldownT = 0; player.invulnUntil = 0;
        facingAngle = -Math.PI / 2;
        lastMoveAngle = -Math.PI / 2;
        cardinalHoldTimer = 0;
        activeItemIndex = 0;
        // Reset equipment to defaults
        packClothing = [];
        Object.keys(equipmentSlots).forEach(k => { equipmentSlots[k] = null; });
        if (gearInventory?.tools?.hoe_nativeCopper)      equipmentSlots.hoe    = 'hoe_nativeCopper';
        else if (gearInventory?.tools?.bronzehoe)        equipmentSlots.hoe    = 'bronzehoe';
        if (gearInventory?.tools?.pickshovel_nativeCopper) equipmentSlots.shovel = 'pickshovel_nativeCopper';
        else if (gearInventory?.tools?.pickshovel)       equipmentSlots.shovel = 'pickshovel';
        if (gearInventory?.tools?.hatchet_nativeCopper)  equipmentSlots.weapon = 'hatchet_nativeCopper';
        else if (gearInventory?.tools?.hatchet)          equipmentSlots.weapon = 'hatchet';
        if (gearInventory?.tools?.crossbow)               equipmentSlots.ranged = 'crossbow';
        if (gearInventory?.whistles?.length)  equipmentSlots.whistle = gearInventory.whistles[0].id;
        rebuildToolMeshes();
        refreshWeaponSwitchBtn();
        Object.values(toolMeshMap).forEach(m => { if (m) toolHolder.remove(m); });
        if (toolMeshMap[activeTool]) toolHolder.add(toolMeshMap[activeTool]);
        // Re-apply saved processing furniture from layout (crates keep their current position)
        try {
          const _rl = loadFarmLayout();
          if (_rl) {
            (_rl.furniture || []).forEach(({ key, col, row, job, rotYDeg }) => {
              if (PROCESSING_FURNITURE_DEFS[key] && canPlaceFurnitureAt(col, row)) {
                const obj = makeProcessingFurniture(col, row, key, job, rotYDeg || 0);
                if (obj) { worldObjects.set(col + ',' + row, obj); processingFurnitureObjects.add(obj); }
              }
            });
            (_rl.decor || []).forEach(({ id, key, col, row, area, rotYDeg, ownerPieceId, localCol, localRow }) => {
              const def = DECORATIVE_FURNITURE_DEFS[key];
              if (!def) return;
              const decorArea = area || 'farm';
              const tgt = decorArea === 'interior' ? interiorScene : scene;
              const r = makeDecorativeFurnitureMesh(col, row, key, tgt, decorArea, rotYDeg || 0);
              const owner = decorArea === 'interior' && !ownerPieceId ? furnitureOwnerFields(col, row) : {};
              if (r) interiorFurnitureObjects.push({ id: id || 'decor_' + Math.random().toString(36).slice(2, 10), key, col, row,
                mesh: r.mesh, light: r.light, sfxSource: r.sfxSource, area: decorArea, rotYDeg: rotYDeg || 0,
                ownerPieceId: ownerPieceId || owner.ownerPieceId, localCol: Number.isFinite(localCol) ? localCol : owner.localCol,
                localRow: Number.isFinite(localRow) ? localRow : owner.localRow });
              if (r && decorArea === 'farm' && def.sit) {
                const size = decorativeFurnitureSize(key, rotYDeg || 0);
                registerSitWorldObject(key, col, row, size.fw, size.fd, rotYDeg || 0);
              }
              if (r) registerChairNpcStation(key, col, row, rotYDeg || 0, normalizeNpcArea(decorArea));
            });
            (_rl.buildings || []).forEach(saved => {
              if (saved.kind !== 'barn' || !BARN_TIERS[saved.tier]) return;
              const entry = { id: saved.id, kind: 'barn', tier: saved.tier, col: saved.col, row: saved.row, w: saved.w || window.FarmBuildings.FOOTPRINT_W, h: saved.h || window.FarmBuildings.FOOTPRINT_D, stage: saved.stage || 'foundation', ...(Array.isArray(saved.troughs) ? { troughs: saved.troughs } : {}) };
              farmBuildings.push(entry);
              window.FarmBuildings.spawnEntry(entry);
            });
          }
        } catch {}
        lastActionMessage = 'Farm reset. Stormtide — dig trenches to route the water.';
        showToast('Farm reset to Stormtide.', true);
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

      document.getElementById('npcDialogueContinue')?.addEventListener('click', () => { if (dialogueOpen) window.DialogueContent?.advanceNpcDialogue(); });
      document.getElementById('npcDialogueLeave')?.addEventListener('click', () => { if (dialogueOpen) closeNpcDialogue(); });

      joystickZone.addEventListener('pointerdown', handleJoystickPointerDown);
      joystickZone.addEventListener('pointermove', handleJoystickPointerMove);
      joystickZone.addEventListener('pointerup', handleJoystickPointerUp);
      joystickZone.addEventListener('pointercancel', handleJoystickPointerUp);

      // Dodge button: a plain tap, dodging in the current facing direction.
      // Always visible on touch (see #dodgeBtn in style.css); hidden only
      // during fishing, same as the other arc controls.
      dodgeBtn?.addEventListener('pointerdown', ev => {
        ev.preventDefault();
        performContextAction();
      });

      // Weapon quick-switch button: a plain tap toggles in/out of the
      // weapon tool slot (see toggleQuickWeaponSwitch) — this is how you
      // get *into* combat stance to begin with.
      btnWeaponSwitch?.addEventListener('pointerdown', ev => {
        ev.preventDefault();
        toggleQuickWeaponSwitch();
      });

      // Mobile mirror of the V key / D-pad down 'toggleMount' action —
      // .active is kept in sync with rideState in window.Mounts.updateMountRide.
      btnCallMount?.addEventListener('pointerdown', ev => {
        ev.preventDefault();
        window.Mounts?.toggleMount();
      });

      // Melee auto-target's sixth outer-ring button: a plain tap toggles —
      // off turns it on and locks the closest hostile in range (no facing
      // cone required, unlike the attack-triggered auto-engage), on turns
      // it back off. No-ops if melee isn't out or (turning on) nothing is
      // in range.
      btnMeleeAutoTarget?.addEventListener('pointerdown', ev => {
        ev.preventDefault();
        if (!meleeWeaponOut()) return;
        if (meleeAutoTargetOn) { meleeAutoTargetOn = false; manualAutoTarget = null; meleeAutoTargetFreeAim = false; return; }
        const target = findAutoTarget();
        if (!target) return;
        manualAutoTarget = target;
        meleeAutoTargetOn = true;
        meleeAutoTargetFreeAim = false;
      });

      // Swap Target button: its own dedicated drag-direction stick (separate
      // from applyAbt()'s tool/item-action wiring, which had its drag-repeat
      // behavior disabled). Pushing it toward a hostile swaps auto-targeting
      // onto it — fires once per drag, no repeat needed since it's a single
      // selection, not a continuous action.
      if (btnSwapTarget) {
        let _stPtId = null, _stCx = 0, _stCy = 0, _stSockR = 0, _stDrag = false, _stSocket = null;
        const ST_DRAG_THRESH = 10;
        btnSwapTarget.addEventListener('pointerdown', ev => {
          if (btnSwapTarget.classList.contains('abt-hidden')) return;
          ev.preventDefault();
          // See handleJoystickPointerDown's comment — guarded here too so a
          // capture failure just loses this one touch instead of throwing.
          try { btnSwapTarget.setPointerCapture?.(ev.pointerId); } catch (err) { /* degrade gracefully */ }
          _stPtId = ev.pointerId;
          const rect = btnSwapTarget.getBoundingClientRect();
          _stCx = rect.left + rect.width / 2;
          _stCy = rect.top + rect.height / 2;
          _stSockR = rect.width * 0.55;
          _stDrag = false;
          _stSocket = document.createElement('div');
          _stSocket.className = 'abt-socket';
          _stSocket.style.left = _stCx + 'px';
          _stSocket.style.top = _stCy + 'px';
          _stSocket.style.width = _stSocket.style.height = (rect.width * 2.2) + 'px';
          document.body.appendChild(_stSocket);
          btnSwapTarget.style.transition = 'none';
        });
        btnSwapTarget.addEventListener('pointermove', ev => {
          if (ev.pointerId !== _stPtId) return;
          const dx = ev.clientX - _stCx, dy = ev.clientY - _stCy;
          const dist = Math.hypot(dx, dy);
          const r = Math.min(dist, _stSockR);
          const nx = dist > 0.5 ? dx / dist * r : 0;
          const ny = dist > 0.5 ? dy / dist * r : 0;
          btnSwapTarget.style.transform = `translate(calc(50% + ${nx}px), calc(50% + ${ny}px))`;
          if (!_stDrag && dist > ST_DRAG_THRESH) {
            _stDrag = true;
            swapAutoTarget(Math.atan2(dy, dx));
          }
        });
        function _stUp(ev) {
          if (ev.pointerId !== _stPtId) return;
          _stPtId = null;
          if (_stSocket) { _stSocket.remove(); _stSocket = null; }
          btnSwapTarget.style.transition = 'transform 0.14s ease-out';
          btnSwapTarget.style.transform = 'translate(50%, 50%)';
          setTimeout(() => { btnSwapTarget.style.transition = ''; btnSwapTarget.style.transform = ''; }, 150);
          if (!_stDrag) swapAutoTarget(player.angle);
          _stDrag = false;
        }
        btnSwapTarget.addEventListener('pointerup', _stUp);
        btnSwapTarget.addEventListener('pointercancel', _stUp);
      }

      const desktopTapWindowMs = () => Number(desktopControlsConfig().tapWindowMs) || 350;
      let desktopTentInteractHeld = false; // Used to reserve a held desktop Interact press for a nearby bandit tent instead of opening the Tool Select wheel.
      const desktopHoldKeys = {
        q: { down: false, held: false, timer: null, arc: 'item' },
        e: { down: false, held: false, timer: null, arc: 'tool' },
        // Utilities wheel — an entries arc like potion/ammo select, not a
        // tool/item wheel, so it commits via releaseSelection() below
        // (whichever entry mouse-drag/scroll last highlighted) instead of
        // close()'s "already applied live, just dismiss" behavior.
        c: { down: false, held: false, timer: null, arc: 'utilities' },
      };
      function openDesktopHoldArc(key) {
        const state = desktopHoldKeys[key];
        if (!state || !state.down) return;
        state.held = true;
        if (state.arc === 'utilities') {
          // Same reasoning as CookingSystem's setInteractionBlocked above —
          // no visible cursor to pick a wedge with under cursor-less camera
          // Pointer Lock otherwise.
          releaseShoulderSurfPointerLock();
          window._desktopSelectionArc?.openUtilities();
        }
        else if (state.arc === 'item' && activeTool === 'ranged') window._desktopSelectionArc?.openAmmo();
        else if (state.arc === 'item') window._desktopSelectionArc?.openItem();
        else window._desktopSelectionArc?.openTool();
      }
      function startDesktopHoldKey(key, event) {
        const state = desktopHoldKeys[key];
        if (!state || state.down || event.repeat) return;
        state.down = true;
        state.held = false;
        state.timer = setTimeout(() => openDesktopHoldArc(key), desktopTapWindowMs());
      }
      function finishDesktopHoldKey(key) {
        const state = desktopHoldKeys[key];
        if (!state || !state.down) return false;
        state.down = false;
        if (state.timer) { clearTimeout(state.timer); state.timer = null; }
        const wasHeld = state.held;
        state.held = false;
        if (wasHeld) {
          if (state.arc === 'utilities') window._desktopSelectionArc?.releaseSelection();
          else if (state.arc === 'item' && activeTool === 'ranged') window._desktopSelectionArc?.releaseSelection();
          else window._desktopSelectionArc?.close();
        }
        if (wasHeld && state.arc === 'utilities' && cursorlessMouseAimRequested()) {
          requestShoulderSurfPointerLock();
        }
        return wasHeld;
      }

      const INPUT_DEFAULTS = (() => {
        const cfg = window.SCRATCHBONES_CONFIG?.game?.input || {};
        const actions = Array.isArray(cfg.actions) ? cfg.actions : [];
        return {
          storageKey: cfg.storageKey || 'scratchbones.inputBindings.v1',
          deadzone: Number(cfg.gamepadDeadzone) || 0.24,
          axisPressThreshold: Number(cfg.axisPressThreshold) || 0.55,
          actions,
          desktop: Object.fromEntries(actions.map(a => [a.id, a.desktop]).filter(([, v]) => v)),
          controller: Object.fromEntries(actions.map(a => [a.id, a.controller]).filter(([, v]) => v)),
          modeShifts: Array.isArray(cfg.modeShifts) ? cfg.modeShifts : []
        };
      })();
      const inputBindings = loadInputBindings();
      const gamepadState = { focused: document.hasFocus(), previous: new Set(), activeShift: null, hadPad: false };
      const CONTROLLER_INPUT_OPTIONS = [
        'Button0', 'Button1', 'Button2', 'Button3', 'Button4', 'Button5',
        'LeftTrigger', 'RightTrigger',
        'Button8', 'Button9', 'Button10', 'Button11',
        'Button12', 'Button13', 'Button14', 'Button15',
        'RightStickLeft', 'RightStickRight', 'RightStickUp', 'RightStickDown'
      ];

      function loadInputBindings() {
        try {
          const saved = JSON.parse(localStorage.getItem(INPUT_DEFAULTS.storageKey) || 'null');
          return {
            desktop: { ...INPUT_DEFAULTS.desktop, ...(saved?.desktop || {}) },
            controller: { ...INPUT_DEFAULTS.controller, ...(saved?.controller || {}) },
            modeShifts: Array.isArray(saved?.modeShifts) ? saved.modeShifts : INPUT_DEFAULTS.modeShifts
          };
        } catch (_err) {
          return { desktop: { ...INPUT_DEFAULTS.desktop }, controller: { ...INPUT_DEFAULTS.controller }, modeShifts: INPUT_DEFAULTS.modeShifts };
        }
      }
      function saveInputBindings() {
        localStorage.setItem(INPUT_DEFAULTS.storageKey, JSON.stringify(inputBindings));
      }
      function bindingConflict(device, button, actionId, modeShift = null) {
        if (!button) return '';
        if (modeShift && button === modeShift.button) return 'Shifted input cannot use its held mode-shift button.';
        const bindings = inputBindings[device] || {};
        for (const [otherAction, otherButton] of Object.entries(bindings)) {
          if (otherAction !== actionId && otherButton === button) return `Already bound to ${actionLabel(otherAction)}.`;
        }
        if (!modeShift) return '';
        for (const [otherButton, otherAction] of Object.entries(modeShift.bindings || {})) {
          if (otherAction === actionId && otherButton === button) return `Already bound to ${actionLabel(actionId)} in this mode shift.`;
        }
        return '';
      }
      function actionLabel(id) {
        return INPUT_DEFAULTS.actions.find(a => a.id === id)?.label || id;
      }
      function buttonLabel(code) {
        const labels = { LeftTrigger: 'LT', RightTrigger: 'RT', RightStickLeft: 'RS ←', RightStickRight: 'RS →', RightStickUp: 'RS ↑', RightStickDown: 'RS ↓', WheelUp: 'Wheel ↑', WheelDown: 'Wheel ↓' };
        return labels[code] || String(code || 'Unbound').replace(/^Key/, '').replace(/^Digit/, '').replace(/^Button/, 'Pad ');
      }

      // ── Last-used input device tracking ─────────────────────────────
      // Nothing else in the game tracks "what device is the player actually
      // using right now" — isDesktop (see top of file) is a one-time
      // pointer:fine media-query check, not reactive to switching between
      // mouse, touch, and a plugged-in controller mid-session. Drives
      // showActionPrompt below so its "press X" text matches whatever the
      // player last actually pressed, not just their device class.
      let lastInputDevice = isDesktop ? 'desktop' : 'touch';
      window.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'touch') lastInputDevice = 'touch';
        else if (e.pointerType === 'mouse' || e.pointerType === 'pen') lastInputDevice = 'desktop';
      }, { capture: true, passive: true });
      window.addEventListener('keydown', () => { lastInputDevice = 'desktop'; }, { capture: true });
      // Controller presses are marked in pollControllerInput() itself (see
      // below), since that's the only place an actual button-down edge is
      // detected rather than just continuous stick state.

      // ── Contextual bottom-of-screen action prompt ───────────────────
      // Generic "press X to do Y" prompt shared across the game (fishing is
      // the first caller, see beginFishingCast/renderFishingOverlay) —
      // resolves its own key/button/icon label from lastInputDevice so
      // callers only ever describe *what* the action does, never how to
      // trigger it on any particular device.
      let actionPromptEls = null;
      function buildActionPromptDom() {
        if (actionPromptEls) return;
        const el = document.getElementById('actionPrompt');
        if (!el) return;
        // World prompts use the same stacked list-row treatment as merchant
        // dialogue choices, including when there is only one available action.
        el.innerHTML = `
          <div class="ap-list">
            <button class="dlg-opt dlg-opt-visible ap-world-option ap-btn" id="apBtn"></button>
            <button class="dlg-opt dlg-opt-visible ap-world-option ap-cancel" id="apCancel"></button>
          </div>
          <div class="ap-status" id="apStatus"></div>
          <div class="ap-panic-wrap" id="apPanicWrap"><div class="ap-panic-fill" id="apPanicFill"></div></div>`;
        actionPromptEls = {
          el,
          btn: document.getElementById('apBtn'),
          cancel: document.getElementById('apCancel'),
          status: document.getElementById('apStatus'),
          panicWrap: document.getElementById('apPanicWrap'),
          panicFill: document.getElementById('apPanicFill'),
        };
      }
      // Real key/button label on desktop/controller, taken from the
      // player's actual current bindings (not just the defaults) so a
      // rebound key shows correctly here too. Touch has no key to name, so
      // callers pass the same icon already shown for that action in the
      // tool arch (see e.g. the harpoon's 🎣 fallback in _openToolArc).
      function actionPromptGlyph(actionId, touchIcon) {
        if (lastInputDevice === 'controller') return buttonLabel(inputBindings.controller[actionId]);
        if (lastInputDevice === 'touch') return touchIcon || '👆';
        return buttonLabel(inputBindings.desktop[actionId]);
      }
      function showActionPrompt({ actionId, touchIcon, verb, onPress, cancelText, onCancel, statusText, statusType, panicPercent }) {
        buildActionPromptDom();
        if (!actionPromptEls) return;
        const glyph = actionPromptGlyph(actionId, touchIcon);
        // innerHTML, not textContent: touchIcon may be a real <img> tag (see
        // attackActionIconHTML) when the caller wants this to mirror the
        // arc button's actual equipped-tool sprite instead of a plain emoji
        // — callers only ever pass static developer strings here, never
        // untrusted input, so this is safe.
        actionPromptEls.btn.innerHTML = lastInputDevice === 'touch' ? `${glyph} ${verb}` : `[${glyph}] ${verb}`;
        actionPromptEls.btn.onpointerup = (e) => { e.stopPropagation(); onPress?.(); };
        if (cancelText && onCancel) {
          actionPromptEls.cancel.textContent = cancelText;
          actionPromptEls.cancel.style.display = '';
          actionPromptEls.cancel.onpointerup = (e) => { e.stopPropagation(); onCancel(); };
        } else {
          actionPromptEls.cancel.style.display = 'none';
          actionPromptEls.cancel.onpointerup = null;
        }
        if (statusText) {
          actionPromptEls.status.textContent = statusText;
          actionPromptEls.status.className = 'ap-status' + (statusType ? ' ' + statusType : '');
          actionPromptEls.status.style.display = '';
        } else {
          actionPromptEls.status.style.display = 'none';
        }
        if (panicPercent != null) {
          actionPromptEls.panicWrap.style.display = '';
          actionPromptEls.panicFill.style.width = panicPercent + '%';
        } else {
          actionPromptEls.panicWrap.style.display = 'none';
        }
        actionPromptEls.el.classList.add('open');
      }
      function hideActionPrompt() {
        if (!actionPromptEls) return;
        actionPromptEls.el.classList.remove('open');
        actionPromptEls.btn.onpointerup = null;
        actionPromptEls.cancel.onpointerup = null;
      }
      // Resolve the action currently rendered in the physical arch button.
      // The visible stack is split into tool/item rows, so computeActionButtons()
      // index 0 is not necessarily btnAction1 anymore.
      function actionButtonForPhysicalSlot(slotIndex) {
        const el = document.getElementById('btnAction' + slotIndex);
        const action = el?.dataset.action;
        const buttons = computeActionButtons();
        return (action && buttons.find(b => b.action === action)) || buttons[slotIndex - 1] || null;
      }
      function runActionButtonAtSlot(slotIndex) {
        const btn = actionButtonForPhysicalSlot(slotIndex);
        if (!btn || btn.allowed === false) return;
        activeAction = btn.action;
        actionHeldDown = slotIndex === 1;
        useActiveAction();
      }
      function runInteractAction() {
        // Interact is reserved for world targets such as doors, NPCs, and
        // furniture. Tool swings and every held-item action use action slots.
        const toolSet = new Set(Object.values(toolActions).flat());
        const isItemAction = action => action === 'consume_held_item' || action === 'consume_food_item' || action === 'play_instrument'
          || action === 'harvest'
          || action.startsWith('alchemy_flask_')
          || /^(?:plant_|place_|spawn_)/.test(action);
        const btn = computeActionButtons().find(b => b.allowed !== false
          && !toolSet.has(b.action) && !isItemAction(b.action));
        if (!btn) return;
        activeAction = btn.action;
        useActiveAction();
      }
      function cycleActiveTool(delta) {
        const idx = WHEEL_SLOTS.indexOf(activeTool);
        const next = (idx + delta + WHEEL_SLOTS.length) % WHEEL_SLOTS.length;
        setActiveTool(WHEEL_SLOTS[next]);
      }
      // action1/action2 while wielding the weapon tool route through
      // Combat.input's tap/hold state machine (see combat-input.js) — same
      // as the desktop mouse-click handler just above this function already
      // does for button 0/2 — instead of runActionButtonAtSlot's single
      // immediate useActiveAction() call, which has no concept of "held" at
      // all. Without this, any device whose action1/action2 goes through
      // runInputAction (keyboard Space, every controller trigger) could
      // never trigger a hold-slot ability: press *and* release both fired
      // the same instant tap. Every other tool keeps its previous
      // instant-fire behavior unchanged.
      function weaponActionSlot(actionId) {
        if (!(actionId === 'action1' || actionId === 'action2')) return 0;
        if (heldMode !== 'tool' || activeTool !== 'weapon' || !window.Combat?.input) return 0;
        return actionId === 'action1' ? 1 : 2;
      }
      function visibleActionOverrideForWeaponSlot(actionId) {
        const slot = weaponActionSlot(actionId);
        if (!slot) return null;
        const button = actionButtonForPhysicalSlot(slot); // Preserve the world-context action actually rendered in this physical weapon slot.
        if (!button || button.allowed === false || button.action === toolActions.weapon[slot - 1]) return null;
        return { slot, button };
      }
      const visibleWeaponContextPresses = new Set(); // Used to pair a context override's press/release without sending an unmatched release into Combat.input.
      const rangedAmmoAction2Press = { down: false, held: false, timer: null, lastScrollAt: 0 }; // Shared keyboard/controller hold state for the ordinary ammo-selection arch.
      const potionAction3Press = { down: false, held: false, timer: null, lastScrollAt: 0 }; // Tool Action 3 selector mirrors the normal held tool/item mode shift.
      const toolSelectPress = { down: false, held: false, timer: null, lastScrollAt: 0 }; // Cross-input Tool Select tap/hold distinction.
      function potionSelectorAvailable(actionId) {
        return actionId === 'action3' && heldMode === 'tool' && (activeTool === 'weapon' || activeTool === 'ranged')
          && computeActionButtons().some(button => button.action === 'potion_select' && button.allowed);
      }
      function runInputAction(actionId, phase = 'press') {
        if (actionId === 'toolSelect') {
          if (phase === 'release') {
            if (!toolSelectPress.down) return;
            toolSelectPress.down = false;
            if (toolSelectPress.timer) { clearTimeout(toolSelectPress.timer); toolSelectPress.timer = null; }
            if (toolSelectPress.held) window._desktopSelectionArc?.commit();
            else window._desktopSelectionArc?.recallLastTool?.();
            toolSelectPress.held = false;
            return;
          }
          if (toolSelectPress.down) return;
          toolSelectPress.down = true; toolSelectPress.held = false;
          toolSelectPress.timer = setTimeout(() => {
            if (!toolSelectPress.down) return;
            toolSelectPress.held = true;
            window._desktopSelectionArc?.openTool?.();
          }, desktopTapWindowMs());
          return;
        }
        if (window._desktopSelectionArc?.toolMenuOpen?.()) {
          const isToolBrowseAction = ['action1', 'action2', 'itemPrev', 'itemNext', 'toolPrev', 'toolNext'].includes(actionId); // Keyboard browsing mirrors controller stick selection while Tool Select is held.
          if (isToolBrowseAction && phase === 'press') {
            if (actionId === 'action1') window._desktopSelectionArc.commit();
            else if (actionId === 'action2') window._desktopSelectionArc.close();
            else window._desktopSelectionArc.scrollTool(actionId === 'itemPrev' || actionId === 'toolPrev' ? -1 : 1);
          }
          if (isToolBrowseAction) return;
        }
        if (potionSelectorAvailable(actionId) || (actionId === 'action3' && potionAction3Press.down)) {
          if (phase === 'release') {
            if (!potionAction3Press.down) return;
            potionAction3Press.down = false;
            if (potionAction3Press.timer) { clearTimeout(potionAction3Press.timer); potionAction3Press.timer = null; }
            if (potionAction3Press.held) window._desktopSelectionArc?.releaseSelection();
            window._desktopSelectionArc?.endHeldSelection?.();
            potionAction3Press.held = false;
            return;
          }
          if (potionAction3Press.down) return;
          potionAction3Press.down = true;
          potionAction3Press.held = true; // Potion Select is exclusively a held selector; its root choices should be visible immediately.
          window._desktopSelectionArc?.beginHeldSelection?.('potions');
          window._desktopSelectionArc?.openPotions();
          return;
        }
        if (window._desktopSelectionArc?.entryMenuOpen?.() && !(actionId === 'action2' && activeTool === 'ranged' && rangedAmmoAction2Press.down) && !(actionId === 'action3' && potionAction3Press.down)) {
          const isSelectorAction = ['action1', 'action2', 'interact', 'itemPrev', 'itemNext', 'toolPrev', 'toolNext'].includes(actionId); // Common keyboard/controller selector vocabulary.
          if (isSelectorAction && phase === 'press') {
            if (actionId === 'action1' || actionId === 'interact') window._desktopSelectionArc.commit();
            else if (actionId === 'action2') window._desktopSelectionArc.close();
            else window._desktopSelectionArc.scrollEntries(actionId === 'itemPrev' || actionId === 'toolPrev' ? -1 : 1);
          }
          if (isSelectorAction) return;
        }
        if (actionId === 'action2' && heldMode === 'tool' && activeTool === 'ranged') {
          if (phase === 'release') {
            if (!rangedAmmoAction2Press.down) return;
            rangedAmmoAction2Press.down = false;
            if (rangedAmmoAction2Press.timer) { clearTimeout(rangedAmmoAction2Press.timer); rangedAmmoAction2Press.timer = null; }
            if (rangedAmmoAction2Press.held) window._desktopSelectionArc?.releaseSelection();
            window._desktopSelectionArc?.endHeldSelection?.();
            rangedAmmoAction2Press.held = false;
            return;
          }
          if (rangedAmmoAction2Press.down) return;
          rangedAmmoAction2Press.down = true;
          rangedAmmoAction2Press.held = true; // Ammo Select likewise has no competing tap action while ranged is drawn.
          window._desktopSelectionArc?.beginHeldSelection?.('ammo');
          window._desktopSelectionArc?.openAmmo();
          return;
        }
        if (phase === 'release') {
          if (actionId === 'action1') actionHeldDown = false;
          if (visibleWeaponContextPresses.delete(actionId)) return;
          const releaseSlot = weaponActionSlot(actionId);
          if (releaseSlot) window.Combat.input.pressEnd(releaseSlot);
          return;
        }
        if (window.Fishing?.state?.active) {
          if (actionId === 'interact' || actionId === 'action1') window.Fishing?.primaryAction();
          return;
        }
        if (menuOpen || farmEditMode) return;
        if (actionId === 'interact') { runInteractAction(); return; }
        const visibleOverride = visibleActionOverrideForWeaponSlot(actionId); // Used so Loot/Harvest/other displayed context actions outrank the weapon normally bound to this slot.
        if (visibleOverride) {
          visibleWeaponContextPresses.add(actionId);
          runActionButtonAtSlot(visibleOverride.slot);
          return;
        }
        const weaponSlot = weaponActionSlot(actionId);
        if (weaponSlot) {
          if (actionId === 'action1') actionHeldDown = true;
          tryAutoEngageMeleeTarget();
          window.Combat.input.pressStart(weaponSlot);
          return;
        }
        const actionSlot = /^action(\d+)$/.exec(actionId);
        if (actionSlot) { runActionButtonAtSlot(Number(actionSlot[1])); return; }
        if (actionId === 'dodge') { performContextAction(); return; }
        if (actionId === 'toggleMount') { window.Mounts?.toggleMount(); return; }
        if (actionId === 'swapTarget') {
          const aimAngle = controllerLookActive ? controllerLookAngle
            : (isDesktop && mouseLookActive) ? mouseLookAngle
            : facingAngle;
          swapAutoTarget(aimAngle);
          return;
        }
        // Right-stick tilt (controller only — desktop cycles via Shift+
        // wheel instead) — a no-op unless melee auto-target is already on,
        // per cycleMeleeAutoTarget's own gate.
        if (actionId === 'meleeTargetPrev') { cycleMeleeAutoTarget(-1); return; }
        if (actionId === 'meleeTargetNext') { cycleMeleeAutoTarget(1); return; }
        if (actionId === 'cycleToolAction') {
          const actions = toolActions[activeTool];
          const idx = actions.indexOf(activeAction);
          activeAction = actions[(idx + 1) % actions.length];
          refreshActionBar();
          return;
        }
        if (actionId === 'itemPrev' || actionId === 'itemNext') {
          cycleActiveInventoryItem(actionId === 'itemPrev' ? -1 : 1);
          refreshItemScroll(); refreshActionBar(); return;
        }
        if (actionId === 'toolPrev' || actionId === 'toolNext') { cycleActiveTool(actionId === 'toolPrev' ? -1 : 1); return; }
        if (actionId === 'weaponSwitch') { toggleQuickWeaponSwitch(); return; }
        const tool = { tool1: 'shovel', tool2: 'hoe', tool4: 'axe', tool5: 'pick', tool6: 'harpoon' }[actionId];
        if (tool) setActiveTool(tool);
      }
      function getActionForButton(device, button, heldShift = null) {
        if (heldShift?.bindings?.[button]) return heldShift.bindings[button];
        const bindings = inputBindings[device] || {};
        return Object.keys(bindings).find(actionId => bindings[actionId] === button) || null;
      }
      function pollControllerInput() {
        if (!gamepadState.focused) return;
        const pads = navigator.getGamepads?.() || [];
        const pad = Array.from(pads).find(Boolean);
        if (!pad) {
          // Only clear movement input on an actual gamepad disconnect, not every
          // frame — otherwise this stomps the touch joystick (and keyboard) on
          // any device with no gamepad, which is virtually all mobile devices.
          if (gamepadState.hadPad) { input.x = 0; input.y = 0; }
          gamepadState.hadPad = false;
          return;
        }
        gamepadState.hadPad = true;
        const dz = INPUT_DEFAULTS.deadzone;
        const ax = Math.abs(pad.axes[0] || 0) >= dz ? pad.axes[0] : 0;
        const ay = Math.abs(pad.axes[1] || 0) >= dz ? pad.axes[1] : 0;
        const rx = Math.abs(pad.axes[2] || 0) >= dz ? pad.axes[2] : 0;
        const ry = Math.abs(pad.axes[3] || 0) >= dz ? pad.axes[3] : 0;
        input.x = ax; input.y = ay;
        controllerLookActive = Math.hypot(rx, ry) >= dz;
        if (window._desktopSelectionArc?.entryMenuOpen?.() && !rangedAmmoAction2Press.held && !potionAction3Press.held && Math.hypot(rx, ry) >= INPUT_DEFAULTS.axisPressThreshold) {
          controllerLookActive = false;
          const now = performance.now();
          if (now - (pollControllerInput._selectionArchMovedAt || 0) >= 220) {
            pollControllerInput._selectionArchMovedAt = now;
            const axis = Math.abs(rx) >= Math.abs(ry) ? rx : ry; // Dominant right-stick direction advances the shared arch.
            window._desktopSelectionArc.scrollEntries(axis < 0 ? -1 : 1);
          }
        }
        if (window.AlchemyFlasks?.aiming) {
          controllerLookActive = false;
          window.AlchemyFlasks.setTargetFromVector(rx, ry, Math.min(1, Math.hypot(rx, ry)));
        }
        if (controllerLookActive) {
          controllerLookAngle = Math.atan2(ry, rx);
          targetAimAngle = controllerLookAngle;
        }
        if (rangedAmmoAction2Press.held && Math.hypot(rx, ry) >= INPUT_DEFAULTS.axisPressThreshold) {
          const now = performance.now();
          if (now - rangedAmmoAction2Press.lastScrollAt >= 220) {
            rangedAmmoAction2Press.lastScrollAt = now;
            window._desktopSelectionArc?.scrollAmmo((Math.abs(rx) >= Math.abs(ry) ? rx : ry) >= 0 ? 1 : -1);
          }
        }
        if (potionAction3Press.held && Math.hypot(rx, ry) >= INPUT_DEFAULTS.axisPressThreshold) {
          const now = performance.now();
          if (now - potionAction3Press.lastScrollAt >= 220) {
            potionAction3Press.lastScrollAt = now;
            window._desktopSelectionArc?.scrollEntries((Math.abs(rx) >= Math.abs(ry) ? rx : ry) >= 0 ? 1 : -1);
          }
        }
        if (toolSelectPress.held && Math.hypot(rx, ry) >= INPUT_DEFAULTS.axisPressThreshold) {
          const now = performance.now();
          if (now - toolSelectPress.lastScrollAt >= 220) {
            toolSelectPress.lastScrollAt = now;
            window._desktopSelectionArc?.scrollTool((Math.abs(rx) >= Math.abs(ry) ? rx : ry) >= 0 ? 1 : -1);
          }
        }
        const down = new Set();
        pad.buttons.forEach((button, index) => { if (button?.pressed) down.add(`Button${index}`); });
        if ((pad.buttons[6]?.value || 0) >= INPUT_DEFAULTS.axisPressThreshold) down.add('LeftTrigger');
        if ((pad.buttons[7]?.value || 0) >= INPUT_DEFAULTS.axisPressThreshold) down.add('RightTrigger');
        const axisPress = INPUT_DEFAULTS.axisPressThreshold;
        if (rx <= -axisPress) down.add('RightStickLeft');
        if (rx >= axisPress) down.add('RightStickRight');
        if (ry <= -axisPress) down.add('RightStickUp');
        if (ry >= axisPress) down.add('RightStickDown');
        // Right-stick click (Button11 — R3) toggles melee auto-target
        // while a melee weapon is out, taking over from its default
        // weaponSwitch binding for exactly that window (weaponSwitch still
        // works normally the rest of the time, and via its other bindings/
        // the action-bar button even then).
        if (down.has('Button11') && meleeWeaponOut()) {
          if (!gamepadState.previous.has('Button11')) {
            meleeAutoTargetOn = !meleeAutoTargetOn;
            manualAutoTarget = null;
            meleeAutoTargetFreeAim = false;
            showToast(meleeAutoTargetOn ? 'Auto-Target: On' : 'Auto-Target: Off', meleeAutoTargetOn);
          }
          down.delete('Button11');
        }
        const heldShift = inputBindings.modeShifts.find(s => s.device === 'controller' && down.has(s.button));
        if (heldShift) controllerLookActive = false;
        for (const button of down) {
          if (gamepadState.previous.has(button) || button === heldShift?.button) continue;
          const actionId = getActionForButton('controller', button, heldShift);
          if (actionId) { lastInputDevice = 'controller'; runInputAction(actionId, 'press'); }
        }
        for (const button of gamepadState.previous) {
          if (down.has(button)) continue;
          const actionId = getActionForButton('controller', button, gamepadState.activeShift);
          if (actionId) runInputAction(actionId, 'release');
        }
        gamepadState.previous = down;
        gamepadState.activeShift = heldShift || null;
      }
      window.addEventListener('focus', () => { gamepadState.focused = true; });
      window.addEventListener('blur', () => { gamepadState.focused = false; gamepadState.previous.clear(); input.x = 0; input.y = 0; controllerLookActive = false; });
      document.addEventListener('visibilitychange', () => { if (document.hidden) { gamepadState.focused = false; gamepadState.previous.clear(); input.x = 0; input.y = 0; controllerLookActive = false; } });

      // Settings tab's input-binding rows now live in
      // js/input-settings-panel.js — call via window.InputSettingsPanel.render().
      // init()'d here rather than down with the other window.<Namespace>
      // modules, since (unlike them) this one is rendered once immediately
      // at boot rather than lazily on first tab open.
      document.getElementById('addModeShiftBtn')?.addEventListener('click', () => { inputBindings.modeShifts.push({ id: `custom-${Date.now()}`, label: 'Custom Shift', device: 'controller', button: 'Button4', bindings: {} }); saveInputBindings(); window.InputSettingsPanel.render(); });
      window.InputSettingsPanel?.init({
        INPUT_DEFAULTS,
        inputBindings,
        CONTROLLER_INPUT_OPTIONS,
        buttonLabel,
        bindingConflict,
        saveInputBindings,
      });
      window.InputSettingsPanel.render();
      window.MusicMinigame?.renderNoteKeySettings();
      window.MusicMinigame?.renderPatternLoadoutSettings();
      window.MusicMinigame?.renderFreeplayKeySettings();

      // Desktop Shift's dual role: held + mouse movement rotates the camera
      // (see the mousemove handler's e.shiftKey branch, unchanged), while a
      // clean TAP — pressed and released within the same tap window as
      // every other tap/hold gesture here, with no mouse movement in
      // between — toggles melee auto-target instead. _shiftDragged is set
      // the instant any mousemove event fires while Shift is down
      // (regardless of which branch handles it — shoulder-surf's own free
      // mouselook included), so a hold-to-rotate never gets misread as a
      // toggle on release.
      let _shiftDownAt = null;
      let _shiftDragged = false;
      window.addEventListener('keydown', (event) => {
        const key = event.key.toLowerCase();
        if (window.Fishing?.state?.active) {
          if (key === 'escape') { event.preventDefault(); window.Fishing?.close(); return; }
          const fishingBoundAction = getActionForButton('desktop', event.code);
          if (fishingBoundAction === 'interact' || fishingBoundAction === 'action1' || key === ' ' || key === 'enter') {
            event.preventDefault();
            window.Fishing?.primaryAction();
          }
          return;
        }
        if (key === 'escape') {
          event.preventDefault();
          // Normally unreachable — the overlay's iframe holds focus and
          // handles Escape itself (see requestExitOrPause in
          // lyre-performance.html, which asks js/music-minigame.js to
          // close()) — but if focus ever lands back on the host page while
          // the overlay is still open, this is the same fallback Fishing
          // uses above rather than opening the menu underneath it.
          if (window.MusicMinigame?.state?.active) { window.MusicMinigame.close(); return; }
          if (dialogueOpen) { closeNpcDialogue(); return; }
          menuOpen ? closeMenu() : openMenu();
          return;
        }
        // Tab: same menu open/close as Escape, without Escape's browser side
        // effect of exiting Fullscreen — added specifically so a player in
        // fullscreen doesn't have to drop out of it just to reach the menu.
        // Shift+Tab does the same (no direction to pick between for a plain
        // open/close toggle); item-cycling moved to [ / ] below to free up
        // both bindings. Skipped during dialogue/the music minigame, same
        // as Escape, so the menu can't pop open over either overlay.
        if (key === 'tab') {
          event.preventDefault();
          if (window.MusicMinigame?.state?.active || dialogueOpen) return;
          menuOpen ? closeMenu() : openMenu();
          return;
        }
        // M: wilderness map — closes if already open on the map tab (mirrors
        // spDay's calendar-shortcut behavior), otherwise opens/switches to it.
        if (key === 'm') {
          event.preventDefault();
          const onMapTab = document.querySelector('.mp-tab[data-mpanel="map"]')?.classList.contains('active');
          if (menuOpen && onMapTab) closeMenu();
          else openMenu('map');
          return;
        }
        if (menuOpen) return;
        if (key === 'z') {
          event.preventDefault();
          if (!event.repeat) putAwayHeldEquipment();
          return;
        }
        const boundDesktopAction = getActionForButton('desktop', event.code);
        if (boundDesktopAction && !['KeyE', 'KeyQ', 'KeyC'].includes(event.code)) {
          event.preventDefault();
          if (!event.repeat) runInputAction(boundDesktopAction, 'press');
          return;
        }
        if (key === 'shift') {
          if (!event.repeat) { _shiftDownAt = performance.now(); _shiftDragged = false; }
          return;
        }
        if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'w', 'a', 's', 'd'].includes(key)) {
          event.preventDefault(); input.keys.add(key);
        }

        if (key === 'e') {
          event.preventDefault();
          if (isDesktop) {
            if (!event.repeat && window.BanditCamps?.hasNearbyTent?.()) {
              desktopTentInteractHeld = true;
              actionHeldDown = true;
              return;
            }
            startDesktopHoldKey('e', event);
            return;
          }
        }
        if (key === 'q') {
          event.preventDefault();
          if (isDesktop) { startDesktopHoldKey('q', event); return; }
          const actions = toolActions[activeTool];
          const idx = actions.indexOf(activeAction);
          activeAction = actions[(idx + 1) % actions.length];
          refreshActionBar();
          return;
        }
        // C: hold to open the utilities wheel (Character View, Return to Camp,
        // quick-select a Campfire Kit, Return to Farm) — same hold-to-open/tap-does-
        // nothing pattern as E/Q above, but there's no separate tap
        // behavior to fall back to on release (see the keyup handler).
        if (key === 'c') {
          event.preventDefault();
          if (isDesktop) { startDesktopHoldKey('c', event); return; }
        }

        // Legacy unbound primary keys. Configured action bindings return above;
        // desktop E is handled as Interact on keyup after its tool-wheel hold.
        if (key === ' ' || key === 'enter' || key === 'e') {
          event.preventDefault();
          if (!event.repeat) {
            actionHeldDown = true;
            useActiveAction();
          }
          return;
        }

        if (key === '1') setActiveTool('shovel');
        if (key === '2') setActiveTool('hoe');
        if (key === '3') setActiveTool('weapon');
        if (key === '4') setActiveTool('axe');
        if (key === '5') setActiveTool('pick');
        if (key === '6') setActiveTool('harpoon');

        // Item scroll: , / . or [ / ] — Tab/Shift+Tab moved to opening the
        // menu (see the keydown handler above) so both are free here.
        if (key === ',' || key === '[') {
          cycleActiveInventoryItem(-1);
          refreshItemScroll(); refreshActionBar();
        }
        if (key === '.' || key === ']') {
          event.preventDefault();
          cycleActiveInventoryItem(event.shiftKey ? -1 : 1);
          refreshItemScroll(); refreshActionBar();
        }

        // X: context action — climbs/cliff-dives a wall in the current
        // facing direction if one's there, otherwise dodges with i-frames
        if (key === 'x') {
          event.preventDefault();
          performContextAction();
          return;
        }

        // B: toggle debug leg-bone visualization (hip/thigh/calf/knee
        // guides, same colored capsules the furniture-avatar-author tool
        // draws over its own seated preview) for every visible avatar's leg
        // rig — dev/diagnostic aid, not a player-facing mechanic.
        if (key === 'b') {
          event.preventDefault();
          const next = !window.ProceduralLegAnimation?.showBones;
          window.ProceduralLegAnimation?.setShowBones(next);
          showToast(next ? 'Leg bones: shown' : 'Leg bones: hidden', true, false);
          return;
        }

        // R: cycle active tool's action mode (equivalent to Q on mobile)
        if (key === 'r') {
          const actions = toolActions[activeTool];
          const idx = actions.indexOf(activeAction);
          activeAction = actions[(idx + 1) % actions.length];
          refreshActionBar();
          return;
        }
      });

      window.addEventListener('keyup', (event) => {
        const key = event.key.toLowerCase();
        input.keys.delete(key);
        // Mirrors the keydown handler's early return: without this, releasing
        // the interact key (E) after fishingPrimaryAction() already fired on
        // keydown fell through to the 'e' handling below, which calls
        // useActiveAction() — re-triggering beginFishingCast() and clobbering
        // the ring minigame that press had just opened.
        if (window.Fishing?.state?.active) return;
        // Symmetric release for whatever keydown dispatched as a 'press' —
        // same binding lookup/exclusion as keydown above, so a held weapon
        // action (e.g. Space/action1) actually reaches Combat.input.pressEnd
        // instead of only ever firing as an instant tap.
        const boundDesktopActionUp = getActionForButton('desktop', event.code);
        if (boundDesktopActionUp && !['KeyE', 'KeyQ', 'KeyC'].includes(event.code)) {
          runInputAction(boundDesktopActionUp, 'release');
        }
        if (key === 'shift') {
          const heldMs = performance.now() - (_shiftDownAt ?? 0);
          if (!menuOpen && !_shiftDragged && heldMs < desktopTapWindowMs() && meleeWeaponOut()) {
            meleeAutoTargetOn = !meleeAutoTargetOn;
            showToast(meleeAutoTargetOn ? 'Auto-Target: On' : 'Auto-Target: Off', meleeAutoTargetOn);
          }
          _shiftDownAt = null;
          return;
        }
        if (key === 'e' && isDesktop) {
          event.preventDefault();
          if (desktopTentInteractHeld) {
            desktopTentInteractHeld = false;
            actionHeldDown = false;
            return;
          }
          const wasHeld = finishDesktopHoldKey('e');
          if (!wasHeld) runInteractAction();
          return;
        }
        if (key === 'q' && isDesktop) {
          event.preventDefault();
          const wasHeld = finishDesktopHoldKey('q');
          if (!wasHeld) {
            const btns = computeActionButtons();
            const second = btns.find((b, i) => i > 0 && b.allowed);
            if (second) { activeAction = second.action; useActiveAction(); }
          }
          return;
        }
        if (key === 'c' && isDesktop) {
          event.preventDefault();
          // No tap fallback — the utilities wheel only ever does anything
          // once it's actually open (finishDesktopHoldKey's own arc==='utilities'
          // branch commits whatever entry was highlighted via releaseSelection()).
          finishDesktopHoldKey('c');
          return;
        }
        if (key === ' ' || key === 'enter' || key === 'e') actionHeldDown = false;
      });

      // Scroll wheel: Q+wheel swaps items, E+wheel swaps tools, otherwise zooms the camera.
      function handleGameWheel(e, heldOnly = false) {
        if (menuOpen || farmEditMode) return false;
        const dir = e.deltaY > 0 ? 1 : -1;
        // Shift+wheel cycles melee auto-target's lock orbitally around the
        // player instead of zooming — only once a lock is already active,
        // same "nothing happens if it's off" rule the controller/mobile
        // cycling inputs follow.
        if (e.shiftKey && meleeAutoTargetOn && meleeWeaponOut()) {
          e.preventDefault();
          cycleMeleeAutoTarget(dir);
          return true;
        }
        const heldEntrySelectorKind = window._desktopSelectionArc?.heldSelectionKind?.(); // Includes keyboard/controller and pointer-held action buttons.
        if (isDesktop && (potionAction3Press.down || heldEntrySelectorKind === 'potions')) {
          e.preventDefault();
          if (potionAction3Press.down && !potionAction3Press.held) {
            potionAction3Press.held = true;
            if (potionAction3Press.timer) { clearTimeout(potionAction3Press.timer); potionAction3Press.timer = null; }
            window._desktopSelectionArc?.openPotions();
          } else if (!window._desktopSelectionArc?.entryMenuOpen?.()) {
            window._desktopSelectionArc?.openPotions();
          }
          window._desktopSelectionArc?.scrollEntries(-dir);
          return true;
        }
        if (isDesktop && heldEntrySelectorKind === 'ammo') {
          e.preventDefault();
          window._desktopSelectionArc?.openAmmo();
          window._desktopSelectionArc?.scrollAmmo(-dir);
          return true;
        }
        if (isDesktop && desktopHoldKeys.q.down) {
          e.preventDefault();
          openDesktopHoldArc('q');
          if (activeTool === 'ranged') window._desktopSelectionArc?.scrollAmmo(-dir);
          else window._desktopSelectionArc?.scrollItem(-dir);
          return true;
        }
        if (isDesktop && desktopHoldKeys.e.down) {
          e.preventDefault();
          openDesktopHoldArc('e');
          window._desktopSelectionArc?.scrollTool(-dir);
          return true;
        }
        if (isDesktop && desktopHoldKeys.c.down) {
          e.preventDefault();
          openDesktopHoldArc('c');
          window._desktopSelectionArc?.scrollEntries(-dir);
          return true;
        }
        if (heldOnly) return false;
        e.preventDefault();
        // The Director authors every camera beat of a cutscene (including
        // Zoom cards, cutscenePreviewZoomPercent) — manual wheel-zoom would
        // fight that authored framing, so it's a no-op (but still consumed,
        // so the page itself doesn't scroll) while a preview is active.
        if (cutscenePreviewActive) return true;
        if (dialogueZoomActive()) {
          const sensitivity = dialogueZoomConfig().wheelSensitivity ?? 0.0015;
          setDialogueCameraZoomPercent(dialogueCameraZoomPercent + (-e.deltaY * sensitivity * 100));
          return true;
        }
        const cfg = desktopControlsConfig();
        const step = Number.isFinite(Number(cfg.wheelZoomStep)) ? Number(cfg.wheelZoomStep) : 0.05;
        setCameraZoomScale(s_zoomScale + (-dir * step));
        return true;
      }
      window.addEventListener('wheel', (e) => { if (handleGameWheel(e, true)) e.stopPropagation(); }, { passive: false, capture: true });
      threeContainer.addEventListener('wheel', (e) => { handleGameWheel(e, false); }, { passive: false });

      function updateDialoguePinchDistance() {
        const points = [...dialogueZoomPointers.values()];
        if (points.length < 2) { dialoguePinchDistance = null; return; }
        dialoguePinchDistance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      }

      threeContainer.addEventListener('pointerdown', (e) => {
        if (!dialogueZoomActive() || e.pointerType !== 'touch') return;
        dialogueZoomPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        updateDialoguePinchDistance();
      });
      threeContainer.addEventListener('pointermove', (e) => {
        if (!dialogueZoomActive() || e.pointerType !== 'touch' || !dialogueZoomPointers.has(e.pointerId)) return;
        dialogueZoomPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const points = [...dialogueZoomPointers.values()];
        if (points.length < 2) return;
        const nextDistance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
        if (dialoguePinchDistance && nextDistance > 0) {
          const sensitivity = dialogueZoomConfig().pinchSensitivity ?? 1;
          setDialogueCameraZoomPercent(dialogueCameraZoomPercent + ((nextDistance / dialoguePinchDistance) - 1) * sensitivity * 100);
        }
        dialoguePinchDistance = nextDistance;
        e.preventDefault();
      }, { passive: false });
      function clearDialogueZoomPointer(e) {
        dialogueZoomPointers.delete(e.pointerId);
        updateDialoguePinchDistance();
      }
      window.addEventListener('pointerup', clearDialogueZoomPointer);
      window.addEventListener('pointercancel', clearDialogueZoomPointer);

      // ── Camera look: a floating joystick that materializes under the
      // thumb on a right-half touch (mobile), Shift+mouse movement on
      // desktop. The mobile half used to be a raw delta-drag (camera offset
      // tracked 1:1 with however far the finger had traveled from its start
      // point); it's a rate-control stick now instead — hold the knob off
      // center and the camera keeps turning, same paradigm as the movement
      // joystick's own analog stick, and the genre-standard "look stick"
      // behavior on mobile (materialize-under-thumb dynamic joysticks, the
      // way most twin-stick mobile games handle look input).
      let cameraDragPointerId = null;
      let cameraJoystickOriginX = 0, cameraJoystickOriginY = 0;
      let cameraJoystickX = 0, cameraJoystickY = 0; // -1..1 per axis, consumed once per frame in gameLoop
      let _cameraJoystickTargetCyclePast = false; // edge-detect state for melee auto-target cycling, see gameLoop's joystick consumption
      function cameraDragAllowed() {
        return !menuOpen && !farmEditMode && !furniturePlacementArmedKey && !furnitureMoveArmedId
          && !dialogueZoomActive() && !window.Fishing?.state?.active && !cutscenePreviewActive && !window.PixelProbe?.armed;
      }
      // Every other camera mode nudges a small look-around offset on top of a
      // fixed base framing, clamped tight (desktopControls.cameraRotateClampDeg,
      // default ±45°) since it's meant to be a peek, not a free orbit. Seated
      // players and the utility-wheel Character View get genuine 360°
      // horizontal orbit instead.
      function freeRotateCameraActive() {
        return characterViewMode.enabled || cameraModeConfig(activeCameraMode).freeRotate === true;
      }
      // Wraps into (-180, 180] instead of clamping, so repeated drag input
      // keeps spinning all the way around rather than pinning at an edge.
      function wrapAzimuthDeg(deg) {
        let d = deg % 360;
        if (d > 180) d -= 360;
        if (d <= -180) d += 360;
        return d;
      }
      // Right half only — the left half is the movement joystick's territory
      // (see #joystickZone, bottom-left) and this keeps the two thumbs from
      // ever fighting over the same touch. A touch that lands on an existing
      // button never reaches here at all: buttons are separate overlaid
      // elements that catch their own pointerdown before it could bubble to
      // #threeContainer, so nothing extra is needed to exclude them.
      function cameraDragRequested(e) {
        return e.pointerType === 'touch' && e.clientX >= window.innerWidth / 2;
      }
      function hideCameraJoystick() {
        cameraJoystickZone.style.display = 'none';
        cameraJoystickKnob.style.transform = 'translate(-50%,-50%) translate(0px, 0px)';
        cameraJoystickX = 0;
        cameraJoystickY = 0;
      }
      threeContainer.addEventListener('pointerdown', (e) => {
        if (!cameraDragRequested(e) || !cameraDragAllowed()) return;
        cameraDragPointerId = e.pointerId;
        cameraJoystickOriginX = e.clientX;
        cameraJoystickOriginY = e.clientY;
        cameraJoystickX = 0;
        cameraJoystickY = 0;
        cameraJoystickZone.style.left = e.clientX + 'px';
        cameraJoystickZone.style.top = e.clientY + 'px';
        cameraJoystickZone.style.display = 'block';
        cameraJoystickKnob.style.transform = 'translate(-50%,-50%) translate(0px, 0px)';
        // Can throw ("No active pointer with the given id is found") for a
        // touch that starts before the browser considers the pointer fully
        // active — e.g. right as the page/layout is still settling after
        // load. Uncaught, that would leave cameraDragPointerId permanently
        // stuck on a pointer that will never get a matching pointerup (see
        // the identical fix/comment on handleJoystickPointerDown), silently
        // dropping every real camera-look drag afterward until a reload.
        try { threeContainer.setPointerCapture?.(e.pointerId); } catch (err) { /* see above — degrade gracefully */ }
      });
      threeContainer.addEventListener('pointermove', (e) => {
        if (e.pointerId !== cameraDragPointerId || !cameraDragAllowed()) return;
        // Base stays put where the thumb first touched down — only the knob
        // (and the resulting turn rate) tracks the finger from there, same
        // clamp/deadzone/response-curve shape as updateJoystick() below.
        const rawX = e.clientX - cameraJoystickOriginX;
        const rawY = e.clientY - cameraJoystickOriginY;
        const distance = Math.hypot(rawX, rawY);
        const angle = Math.atan2(rawY, rawX);
        const clamped = Math.min(distance, CAMERA_JOYSTICK_RADIUS);
        const rawMagnitude = clamp(clamped / CAMERA_JOYSTICK_RADIUS, 0, 1);
        const remapped = rawMagnitude <= CAMERA_JOYSTICK_DEADZONE
          ? 0
          : Math.pow((rawMagnitude - CAMERA_JOYSTICK_DEADZONE) / (1 - CAMERA_JOYSTICK_DEADZONE), CAMERA_JOYSTICK_RESPONSE);
        cameraJoystickX = remapped > 0 ? Math.cos(angle) * remapped : 0;
        cameraJoystickY = remapped > 0 ? Math.sin(angle) * remapped : 0;
        cameraJoystickKnob.style.transform = `translate(-50%,-50%) translate(${Math.cos(angle) * clamped}px, ${Math.sin(angle) * clamped}px)`;
      });
      function clearCameraDragPointer(e) {
        if (e.pointerId !== cameraDragPointerId) return;
        cameraDragPointerId = null;
        hideCameraJoystick();
      }
      window.addEventListener('pointerup', clearCameraDragPointer);
      window.addEventListener('pointercancel', clearCameraDragPointer);

      // Left click = tool action 1 (tap/hold), right click = tool action 2
      // (tap/hold) when wielding the weapon tool — routed through
      // Combat.input so the loadout's 4 ability slots can claim them.
      // Every other tool keeps its previous click behavior unchanged: left
      // click = primary action, right click = secondary action.
      if (isDesktop) {
        threeContainer.addEventListener('contextmenu', (e) => e.preventDefault());
        threeContainer.addEventListener('pointerdown', (e) => {
          if (menuOpen || farmEditMode || e.shiftKey) return;
          if (heldMode === 'tool' && activeTool === 'weapon' && window.Combat?.input) {
            const pointerActionId = e.button === 0 ? 'action1' : e.button === 2 ? 'action2' : null; // Used to map mouse presses through the same visible-slot override as keyboard/controller input.
            const visibleOverride = pointerActionId ? visibleActionOverrideForWeaponSlot(pointerActionId) : null;
            if (visibleOverride) {
              visibleWeaponContextPresses.add('mouse:' + e.button);
              runActionButtonAtSlot(visibleOverride.slot);
              return;
            }
            tryAutoEngageMeleeTarget();
            if (e.button === 0) { actionHeldDown = true; window.Combat.input.pressStart(1); }
            else if (e.button === 2) { window.Combat.input.pressStart(2); }
            return;
          }
          if (heldMode === 'tool' && activeTool === 'ranged' && e.button === 2) { runInputAction('action2', 'press'); return; }
          if (e.button === 0) {
            actionHeldDown = true;
            useActiveAction();
          } else if (e.button === 2) {
            const btns = computeActionButtons();
            const second = btns.find((b, i) => i > 0 && b.allowed);
            if (second) { activeAction = second.action; useActiveAction(); }
          }
        });
      }
      window.addEventListener('pointerup', (e) => {
        if (e.pointerType !== 'mouse') return;
        if (visibleWeaponContextPresses.delete('mouse:' + e.button)) {
          if (e.button === 0) actionHeldDown = false;
          return;
        }
        if (heldMode === 'tool' && activeTool === 'weapon' && window.Combat?.input) {
          if (e.button === 0) { actionHeldDown = false; window.Combat.input.pressEnd(1); }
          else if (e.button === 2) { window.Combat.input.pressEnd(2); }
          return;
        }
        if (heldMode === 'tool' && activeTool === 'ranged' && e.button === 2) { runInputAction('action2', 'release'); return; }
        if (e.button === 0) actionHeldDown = false;
      });

      // Mouse-look: raycast cursor onto ground plane to get world position
      if (isDesktop) {
        threeContainer.addEventListener('mousemove', (e) => {
          // A floating menu (the pause/inventory menu incl. its Alchemy tab,
          // the cooking hearth/campfire modal via setInteractionBlocked, or
          // the utilities wheel/an entries arc like potion/ammo select) owns
          // the cursor while open — without this, mouse movement kept
          // driving facing/camera rotation underneath it via this same
          // handler (Shift-drag and shoulder-surf's Pointer Lock read
          // movementX/Y regardless of what's visually on top), so the
          // camera spun out from under a menu the player was trying to
          // click into. entryMenuOpen() covers arcs opened by mouse-button
          // drag (which the arc's own full-screen backdrop already isolates
          // from this handler) as well as ones opened by a held key like
          // 'c' below (which doesn't drag a mouse button, so nothing else
          // stops this handler from firing while it's up).
          if (menuOpen || window._desktopSelectionArc?.entryMenuOpen?.()) return;
          if (e.shiftKey) _shiftDragged = true; // disqualifies a subsequent Shift-release from reading as an auto-target tap
          if (rangedAmmoAction2Press.held) window._desktopSelectionArc?.movePointer(e.clientX, e.clientY);
          if (furniturePlacementArmedKey || furnitureMoveArmedId) return;
          // While the Pixel Probe is armed, mouse movement should only ever
          // move the cursor toward the target pixel — not rotate the camera
          // (Shift+drag, below) or spin the character's facing via mouse-
          // look (which drags a glued shoulder pet along with it), either of
          // which would shift the very thing being aimed at mid-approach.
          if (window.PixelProbe?.armed) return;
          // Desktop auto-target is intentionally loose: micro pointer noise is
          // ignored, but any real mouse movement releases the camera from its
          // current target. The toggle stays on so simply moving the reticle
          // back over an enemy reacquires it.
          if (isDesktop && meleeAutoTargetOn && meleeWeaponOut() &&
              Math.hypot(Number(e.movementX) || 0, Number(e.movementY) || 0) > DESKTOP_AUTO_TARGET_MOUSE_BREAK_PX) {
            manualAutoTarget = null;
            meleeAutoTargetFreeAim = true;
          }
          // Shoulder-surf gets mouse-look "for free" here: plain mouse
          // movement drives the camera exactly like Shift+drag does
          // everywhere else, no modifier key needed, and freeRotateCameraActive()
          // (true for shoulder-surf's config, same as 'seated') already makes
          // this wrap into a full 360° orbit instead of the usual ±45° peek
          // clamp. Falls through to the raycast-based facing/aim below
          // otherwise, same as it always has.
          if ((e.shiftKey || activeCameraMode === SHOULDER_SURF_MODE) && cameraDragAllowed()) {
            const cfg = desktopControlsConfig();
            const degPerPx = Number.isFinite(Number(cfg.cameraRotateDegPerPx)) ? Number(cfg.cameraRotateDegPerPx) : 0.15;
            const clampDeg = Number.isFinite(Number(cfg.cameraRotateClampDeg)) ? Number(cfg.cameraRotateClampDeg) : 45;
            cameraAzimuthOffsetDeg = freeRotateCameraActive()
              ? wrapAzimuthDeg(cameraAzimuthOffsetDeg - e.movementX * degPerPx)
              : clamp(cameraAzimuthOffsetDeg - e.movementX * degPerPx, -clampDeg, clampDeg);
            cameraAngleOffsetDeg = clamp(cameraAngleOffsetDeg + e.movementY * degPerPx, -clampDeg, clampDeg);
            updateCameraPosition();
            return;
          }

          if (cameraDragPointerId !== null || e.shiftKey) return; // Shift+mouse movement is rotating the camera, not aiming
          const rect = threeContainer.getBoundingClientRect();
          _mouseNDC.x =  ((e.clientX - rect.left)  / rect.width)  * 2 - 1;
          _mouseNDC.y = -((e.clientY - rect.top)   / rect.height) * 2 + 1;
          _raycaster.setFromCamera(_mouseNDC, camera);
          // THREE.Plane's constant is -distance-from-origin along its normal —
          // for the (0,1,0) normal here that's simply -groundY, so the plane
          // passes through the player's actual current height (elevTier-aware
          // via _playerGroundY) instead of always sitting at world Y=0.
          _groundPlane.constant = -_playerGroundY();
          if (_raycaster.ray.intersectPlane(_groundPlane, _mouseWorld)) {
            if (window.AlchemyFlasks?.aiming) window.AlchemyFlasks.setTarget(_mouseWorld.x * TILE, _mouseWorld.z * TILE); // Mouse ground-target cursor.
            const dx = _mouseWorld.x - player.x / TILE;
            const dz = _mouseWorld.z - player.y / TILE;
            if (Math.hypot(dx, dz) > 0.3) {
              // atan2 in Three.js XZ: angle from +X axis, but game uses -Z=north
              mouseLookAngle = Math.atan2(dz, dx);
              targetAimAngle = mouseLookAngle;
              mouseLookActive = true;
              lastMouseMoveTime = performance.now();
            }
          }
        });
      }
      // ── Furniture placer pointer handler ───────────────────────────
      // Click-to-place, same interaction model as the farm editor's own
      // brush below (tap a tile, it applies immediately) rather than the
      // hotbar's "equip item, aim reticle, interact" flow — checked first
      // so an armed furniture placement always wins over the (dev-mode-
      // only, so rarely simultaneously active) farm editor brush.
      function furniturePlacementPointerArmed() {
        return !!(furniturePlacementArmedKey || furnitureMoveArmedId)
          && (currentArea === 'farm' || currentArea === 'interior');
      }
      threeContainer.addEventListener('pointerdown', (e) => {
        if (!furniturePlacementPointerArmed()) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        furniturePlacementPointerId = e.pointerId;
        try { threeContainer.setPointerCapture?.(e.pointerId); } catch (_err) { /* preview still follows without capture */ }
        const tile = _screenToActiveTile(e.clientX, e.clientY);
        if (tile) showFurniturePlacementGhost(tile.col, tile.row);
      }, { capture: true });
      threeContainer.addEventListener('pointermove', (e) => {
        if (!furniturePlacementPointerArmed()) return;
        if (e.pointerType !== 'mouse' && e.pointerId !== furniturePlacementPointerId) return;
        e.preventDefault();
        const tile = _screenToActiveTile(e.clientX, e.clientY);
        if (tile) showFurniturePlacementGhost(tile.col, tile.row);
      }, { capture: true });
      function commitFurniturePlacementPointer(e) {
        if (e.pointerId !== furniturePlacementPointerId) return;
        furniturePlacementPointerId = null;
        if (!furniturePlacementPointerArmed() || !furniturePlacementGhost) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        const { col, row } = furniturePlacementGhost;
        if (furnitureMoveArmedId) {
          const result = processingFurnitureById(furnitureMoveArmedId)
            ? moveProcessingFurniture(furnitureMoveArmedId, col, row)
            : moveDecorativeFurniture(furnitureMoveArmedId, col, row);
          showToast(result.message, result.ok);
          if (result.ok) furnitureMoveArmedId = null;
        } else {
          const itemKey = furniturePlacementArmedKey;
          const decorKey = getDecorativeFurnitureKeyByItemKey(itemKey);
          const processingKey = currentArea === 'farm' ? getFurnitureKeyByItemKey(itemKey) : null;
          const result = decorKey
            ? placeDecorativeFurniture(col, row, decorKey)
            : processingKey
              ? placeProcessingFurniture(col, row, processingKey)
              : { ok: false, message: 'Furniture not found.' };
          showToast(result.message, result.ok);
          window.__farmLog?.(`[furniture-placer] ${result.ok ? 'placed' : 'blocked'} ${decorKey || processingKey || itemKey} at ${currentArea} (${col},${row}): ${result.message}`, result.ok ? 'info' : 'warn');
          if (result.ok && processingKey) {
            refreshItemScroll();
            saveFarmLayout();
            saveMemberWorldData();
          }
          if (result.ok && (inventory[itemKey] || 0) <= 0) furniturePlacementArmedKey = null;
        }
        clearFurniturePlacementGhost();
        window.FurniturePlacer?.render();
      }
      window.addEventListener('pointerup', commitFurniturePlacementPointer, { capture: true });
      window.addEventListener('pointercancel', (e) => {
        if (e.pointerId !== furniturePlacementPointerId) return;
        furniturePlacementPointerId = null;
        clearFurniturePlacementGhost();
      }, { capture: true });

      // ── Farm editor pointer handlers ──────────────────────────────
      threeContainer.addEventListener('pointerdown', (e) => {
        if (furniturePlacementArmedKey || furnitureMoveArmedId || !farmEditMode || currentArea !== 'farm') return;
        e.stopPropagation();
        _editorPainting = true;
        const t = _screenToFarmTile(e.clientX, e.clientY);
        if (t) applyFarmEditBrush(t.col, t.row);
      });
      threeContainer.addEventListener('pointermove', (e) => {
        if (furniturePlacementArmedKey || furnitureMoveArmedId || !farmEditMode || currentArea !== 'farm' || !_editorPainting) return;
        e.stopPropagation();
        const t = _screenToFarmTile(e.clientX, e.clientY);
        if (t) applyFarmEditBrush(t.col, t.row);
      });
      window.addEventListener('pointerup', () => { _editorPainting = false; });

      // Expose farm editor to the HTML panel buttons
      window._farmEditor = {
        toggle: toggleFarmEditMode,
        setBrush: farmEditorSetBrush,
        save: saveFarmLayout,
        clearLayout: () => {
          try { localStorage.removeItem(farmLayoutKey()); } catch {}
          showToast('Saved layout cleared. Reset the farm to apply.', true);
        },
      };

      // QA/devtools hook for the furniture placement + sitting systems,
      // mirroring window._devSpawner/_farmEditor above — no in-game UI path
      // to grant furniture items directly, so this exists for headless/
      // console testing rather than as a player-facing cheat.
      window.__hobunjiFurnitureDebug = {
        give: (itemKey, n = 1) => { inventory[itemKey] = (inventory[itemKey] || 0) + n; },
        place: placeDecorativeFurniture,
        sit: beginSitInteraction,
        endSit: endSitInteraction,
        get sitState() { return sitInteraction; },
        get playerState() { return { x: player.x, y: player.y, angle: player.angle }; },
        get camState() { return { mode: activeCameraMode, azimuthOffsetDeg: cameraAzimuthOffsetDeg, position: { x: camera.position.x, y: camera.position.y, z: camera.position.z } }; },
        foliageFurniture: (mapId = currentArea) => window.FoliageFurnitureRuntime?.debugState(mapId) || [],
        worldObjectAt: getWorldObjectAt,
        farmWorldObjectAt: (col, row) => worldObjects.get(col + ',' + row),
        actionButtons: () => computeActionButtons(),
        npcStation: (id) => npcStationsById.get(id),
        npcStationCount: () => npcStationsById.size,
        npcTileWalkable: (area, c, r) => isNpcTileWalkable(area, c, r),
        npcGridTileAt: (area, c, r) => { const g = npcGridForArea(area); return g?.[r]?.[c] || null; },
        farmGridTileAt: (c, r) => grid?.[r]?.[c] || null,
        placeProcessing: placeProcessingFurniture,
        moveProcessing: moveProcessingFurniture,
        rotateProcessing: rotateProcessingFurniture,
        removeProcessing: removeProcessingFurniture,
        seatedNpcs: () => npcWalkers.filter(w => w._seatedStationKey).map(w => ({ id: w.rec?.id, stationId: w._seatedStationKey })),
        tickWorldObjectVfx: (col, row, dt) => { const o = getWorldObjectAt(col, row); if (o?.update) o.update(dt); return o ? { hasUpdate: !!o.update } : null; },
        loadWorldLivestock: () => _loadWorldLivestock(),
        saveWorldLivestock: (list) => _saveWorldLivestock(list),
        assignVat: window.DewVats.assignToVat,
        unassignVat: window.DewVats.unassignFromVat,
        tickLivestock: window.FarmAnimals.tickResources,
        getInventory: () => ({ ...inventory }),
        loadBuildingScene: (mapId) => loadBuildingScene(mapId),
        buildingInteractableAt: (mapId, col, row) => _buildingInteractables.get(mapId + ',' + col + ',' + row),
        buildingInteractableCount: () => _buildingInteractables.size,
        renderFarmProcessors: () => window.FarmPanel.renderFarmProcessors(),
        enterInterior: (pieceId) => enterInterior(pieceId),
        exitInterior: () => exitInterior(),
        getCurrentArea: () => currentArea,
        interiorFurnitureObjects: () => interiorFurnitureObjects,
        loadWorldStorage: () => _loadWorldStorage(),
        setShowLegBones: (v) => window.ProceduralLegAnimation?.setShowBones(v),
        get showLegBones() { return !!window.ProceduralLegAnimation?.showBones; },
        get sitInteraction() { return sitInteraction; },
        playerLegsRef: () => playerLegs,
        get depthOutlinesSetting() { return s_depthOutlines; },
        get outlinesSetting() { return s_outlines; },
        get playerNeckJointRotY() { return playerNeckJoint ? playerNeckJoint.rotation.y : null; },
        get playerNeckJointRotX() { return playerNeckJoint ? playerNeckJoint.rotation.x : null; },
        get playerMeshRotY() { return playerMesh.rotation.y; },
        get playerMeshWorldY() { return playerMesh.position.y; },
        get activeCameraAzimuthDeg() { return activeCameraAzimuthRad() * 180 / Math.PI; },
        get cameraFacingAngleDeg() { return cameraFacingAngleRad() * 180 / Math.PI; },
        get facingAngleDeg() { return facingAngle * 180 / Math.PI; },
        get targetAimAngleDeg() { return targetAimAngle * 180 / Math.PI; },
        get mouseLookAngleDeg() { return mouseLookAngle * 180 / Math.PI; },
        get mouseLookActive() { return mouseLookActive; },
        get cameraAngleOffsetDeg() { return cameraAngleOffsetDeg; },
        get characterViewMode() { return { ...window.HOBUNJI_CHARACTER_VIEW_STATUS }; },
        setCharacterViewMode: (enabled) => setCharacterViewMode(enabled, 'debug'),
        get currentPlayerAimAngleDeg() { return currentPlayerAimAngle() * 180 / Math.PI; },
        get rangedToolYawDeg() { return _debugRangedToolYawRad === null ? null : _debugRangedToolYawRad * 180 / Math.PI; },
        get rangedIsLoaded() { return equipmentSlots.ranged ? window.RangedWeapons?.isLoaded?.(equipmentSlots.ranged) !== false : null; },
        get shoulderSurfCombatStance() { return shoulderSurfCombatStanceActive(); },
        get shoulderSurfOffsets() { return { defaultH: s_shoulderSurfOffsetH_default, defaultV: s_shoulderSurfOffsetV_default, combatH: s_shoulderSurfOffsetH_combat, combatV: s_shoulderSurfOffsetV_combat, currentH: s_shoulderSurfOffsetH_current, currentV: s_shoulderSurfOffsetV_current }; },
        get meleeAutoTargetOn() { return meleeAutoTargetOn; },
        setMeleeAutoTargetOn: (v) => { meleeAutoTargetOn = !!v; },
        get meleeAutoTarget() { const t = findAutoTarget(); return t ? { x: t.x, y: t.y, id: t.id } : null; },
        cycleMeleeAutoTargetDebug: (dir) => cycleMeleeAutoTarget(dir),
        currentAreaOcclusionMeshCount: () => currentAreaOcclusionMeshes().length,
        enterZoneDebug: (mapId, col, row) => enterZone(mapId, col, row),
        setOutlines: (v) => { s_outlines = !!v; },
        playerNeckPivotInfo: () => {
          let avatarGroup = null;
          playerMesh.traverse(o => { if (o.name === 'player_avatar') avatarGroup = o; });
          const rig = avatarGroup?.userData?.neckRig;
          return rig ? {
            available: rig.available,
            neckLocal: rig.neckLocal,
            pivotPx: rig.pivotPx,
            modelHeight: avatarGroup.userData?.portraitModelHeight,
            modelWidth: avatarGroup.userData?.portraitModelWidth,
          } : null;
        },
        findDewPileTiles: () => {
          const found = [];
          for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (grid[r]?.[c]?.dewPile) found.push({ c, r, color: grid[r][c].dewPile });
          return found;
        },
        currentArea: () => currentArea,
      };

      window.addEventListener('resize', () => { fitToAspect(); resizeCanvas(); updateCameraPosition(); if (menuOpen) auditInventorySizing(); });
      // Safety net for any inventory/pack change not already covered by an
      // explicit saveMemberWorldData() call above. Also flushes the
      // in-progress time-of-day (advanceDay/sleepInBed already save on their
      // own day rollovers, but this catches whatever time01 progress
      // happened since the last one, so closing mid-afternoon doesn't roll
      // back to that morning next session).
      function flushSessionPersistence() {
        try { saveFarmLayout(); saveMemberWorldData(); _saveWorldCalendar(); } catch {}
      }
      window.addEventListener('beforeunload', flushSessionPersistence);
      window.addEventListener('pagehide', flushSessionPersistence);

      window.DialogueContent?.init({
        calendar,
        getCurrentArea: () => currentArea,
        getPlayerData: () => _playerData,
        getDialogueOpen: () => dialogueOpen,
        getDialogueWalker: () => _dialogueWalker,
        getWaresPools: () => WARES_POOLS,
        currentWeekdayName: window.CalendarSystem.currentWeekdayName,
        currentSeason: window.CalendarSystem.currentSeason,
        fishingTimeOfDay: () => window.Fishing.timeOfDay(),
        normalizeStationLabel,
        canAccessContent,
        setQuestStatus,
        turnInTask: window.ProceduralTasks.turnInTask,
        showToast,
        openMenu,
        closeNpcDialogue,
        getCutscenePreviewActive: () => cutscenePreviewActive,
        getCutscenePreviewAdvance: () => cutscenePreviewAdvance,
      });

      window.PixelProbe?.init({
        renderer,
        camera,
        playerMesh,
        toolHolder,
        companionObjects,
        npcWalkers,
        player,
        getActiveScene,
        getCurrentArea: () => currentArea,
        getPlayerData: () => _playerData,
        getPlayerGroundY: _playerGroundY,
        getPlayerLegs: () => playerLegs,
        getPetLayeringPet: () => _petLayeringPet,
        getPetLayeringActive: () => _petLayeringActive,
        getPlayerAvatarFrontMaterial: () => _playerAvatarFrontMaterial,
        getSitInteraction: () => sitInteraction,
        getSeatedCameraDebug: () => _seatedCameraDebug,
        getPaused: () => paused,
        getHeldObjectDebug,
        getItemSpriteIconDebug,
        SHOULDER_PET_PLANE_RENDER_ORDER,
        playerAttachmentAnchor,
        creatureAttachmentAnchor,
        openMenu,
        closeMenu,
        showToast,
      });

      window.Music?.init({
        calendar,
        player,
        TILE,
        clamp,
        debugLog,
        getCurrentArea: () => currentArea,
        getPaused: () => paused,
        getGameStarted: () => gameStarted,
        getHour: window.CalendarSystem.getHour,
        getTimeOfDay: () => window.Fishing?.timeOfDay?.(),
        currentWeekdayName: window.CalendarSystem.currentWeekdayName,
        currentSeason: window.CalendarSystem.currentSeason,
        isPlayerInCombat,
        MORNING_HOUR,
        getWorkspaceMaps: () => _workspaceMaps,
        _isZoneArea,
        _isBuildingArea,
        EXTERIOR_ZONES,
      });

      window.AudioSystem?.init({
        TileType,
        TILE,
        MAX_WATER,
        clamp,
        player,
        getCurrentArea: () => currentArea,
        _isBuildingArea,
        npcGridForArea,
        isRealMediaError: (...a) => window.Music?.isRealMediaError(...a),
        markAudioUrlFailed: (...a) => window.Music?.markAudioUrlFailed(...a),
        audioUrlFailed: (...a) => window.Music?.audioUrlFailed(...a),
      });

      window.AnimalVocalizations?.init({
        random: rnd,
        hasVoice: (c) => window.AudioSystem?.hasAnimalVoice?.(c),
        renderUtterance: (c, opts) => window.AudioSystem?.playAnimalVoiceUtterance?.(c, opts),
      });

      window.Combat?.init({
        player,
        players,
        TILE,
        hostileObjects,
        companionObjects,
        getCurrentArea: () => currentArea,
        // Named animal projectiles use the same live Three.js elevation as
        // the player/creature renderers so Drenkirra's vertical spit aim is
        // based on actual target height, not a flattened ground plane.
        getActorWorldY: (actor) => {
          if (actor === player) return playerMesh.position.y;
          const avatarY = actor?.avatarRef?.group?.position?.y;
          if (Number.isFinite(avatarY)) return avatarY;
          if (Number.isFinite(actor?.x) && Number.isFinite(actor?.y)) return activeSurfaceYAtWorld(actor.x / TILE, actor.y / TILE) + 0.4;
          return 0.4;
        },
        worldSurfaceY: (x, y) => activeSurfaceYAtWorld(x / TILE, y / TILE),
        getActiveScene,
        getPlayerMeleeAimDirection: currentPlayerMeleeAimDirection,
        getPlayerMeleeAimPitch: currentPlayerMeleeAimPitch,
        getHeldMode: () => heldMode,
        getActiveTool: () => activeTool,
        getMeleeReticleTarget: () => findAutoTarget() || window.RangedWeapons?.focusedHostile?.(24)?.candidate?.data || null,
        inCone,
        damageCreature,
        damagePlayer,
        applyKnockback,
        weaponAbility,
        combatConfig,
        resolveWeaponHit,
        clearVegetationInAttackCone,
        findAutoTarget,
        canPlayerOccupy,
        canOccupyAt,
        setCreatureFrame,
        genotypeKindFor: (c) => (c.genotype ? (window.CreatureGenetics.SPECIES_ALIAS[c.creatureKey] || c.creatureKey) : null),
        showToast,
        triggerWeaponSwingVisual,
        triggerWeaponHoldVisual,
        releaseWeaponSwingHold,
        cancelWeaponSwingHold,
        beginCombatLunge,
        setCombatSwingCone,
        spawnBurstEffect,
        playCreatureBark: (...a) => window.AudioSystem?.playCreatureBark(...a),
        requestThreatGrowl: (c, reason) => window.AnimalVocalizations?.threatGrowl?.(c, reason)
          || window.AudioSystem?.playCreatureBark?.(c),
        playCreatureClawHit: (...a) => window.AudioSystem?.playCreatureClawHit(...a),
        playWeaponSlashSfx: (...a) => window.AudioSystem?.playWeaponSlashSfx(...a),
        playWeaponHitSfx: (...a) => window.AudioSystem?.playWeaponHitSfx(...a),
        playCounterShieldBlockSfx: (...a) => window.AudioSystem?.playCounterShieldBlockSfx(...a),
        // Named animal attacks (e.g. Pounce) own the creature's position
        // directly for their leap instead of going through moveCreatureToward
        // — without this, that ground covered during the leap never ticked
        // a footstep (see combat-animal-attacks.js's pounceUpdate).
        tickCreatureFootsteps,
        // Same idea as tickCreatureFootsteps but for the colored onion-ring
        // lunge trail (see spawnLungeTrailStamp) — Pounce's leap passes its
        // own dmgTag-derived afflictionBonuses since it has no upgrade tree
        // to read from the way player attacks do.
        tickCreatureLungeTrail,
        // Gates every weapon tap/hold ability (see combat-input.js) — no
        // attacking while swimming in a river/stream, player or creature.
        isPlayerSwimming,
        // Drives the loadout's Combo slot (tap1) — never player-chosen,
        // always whichever combo matches the equipped weapon's own swing
        // style (see combat-loadout.js's comboAbilityId()).
        currentComboAbilityId,
        // Picks which affliction-option flavor every weapon-tool ability
        // offers (see combat-progression.js).
        currentWeaponDamageType,
        weaponDamageTypeForTool,
        // Keys the loadout's per-weapon slot assignments (see
        // combat-loadout.js).
        currentWeaponKey,
        currentWeaponLabel,
        // Tool mastery ("trusty axe/shovel/pick/spear") gates which of a
        // tool's own equipped abilities' 5 upgrade levels can be chosen;
        // Motes of Prowess pay for actually making that choice — both see
        // combat-progression.js.
        toolMasteryLevel,
        awardWeaponMasteryXp,
        getMotesOfProwess,
        spendMotesOfProwess,
        awardMotesOfProwess,
        // Gates the loadout page's dev-only "+1 Mote" test button (see
        // combat-loadout-ui.js) — mirrors the same s_devMode toggle the
        // gear-tool item panel's "+1 Mastery" button uses.
        isDevMode: () => s_devMode,
        // Fires the weapon tool's plain cut/slash swing exactly as it
        // behaved before the loadout system existed — the fallback
        // combat-input.js uses for a tap slot until an ability module
        // claims it.
        fireLegacyWeaponAction: (slotIndex) => {
          if (activeTool !== 'weapon') return;
          activeAction = toolActions.weapon[slotIndex - 1];
          useActiveAction();
        },
      });

      window.NearbyVolumeCollision?.init({
        THREE,
        TILE,
        player,
        getActiveScene,
        getCurrentArea: () => currentArea,
        worldSurfaceY: (x, y) => activeSurfaceYAtWorld(x / TILE, y / TILE),
        isCombatActive: () => isPlayerInCombat() ||
          (heldMode === 'tool' && ((activeTool === 'weapon' && !!equipmentSlots.weapon) ||
            (activeTool === 'ranged' && !!equipmentSlots.ranged))),
        options: {
          enabled: document.getElementById('settingVolumeCollisionMaster')?.checked !== false,
          projectiles: document.getElementById('settingVolumeCollisionProjectiles')?.checked !== false,
          textureAlpha: document.getElementById('settingVolumeCollisionAlpha')?.checked !== false,
        },
        debugLog,
      });

      window.RangedWeapons?.init({
        player,
        playerRadius: PLAYER_RADIUS,
        TILE,
        hostileObjects,
        npcWalkers, // Exposed to the ranged debug snapshot so friendly portrait hitboxes can be inspected without making them damage targets.
        getCurrentArea: () => currentArea,
        getActiveScene,
        // Same live render-height lookup Combat.init supplies for named
        // animal projectiles (see its own getActorWorldY) — a shooter or
        // target standing somewhere other than flat ground (a tree branch)
        // fires/gets aimed at from their real height, not the terrain
        // straight below them.
        getActorWorldY: (actor) => {
          if (actor === player) return playerMesh.position.y;
          const avatarY = actor?.avatarRef?.group?.position?.y;
          if (Number.isFinite(avatarY)) return avatarY;
          if (Number.isFinite(actor?.x) && Number.isFinite(actor?.y)) return activeSurfaceYAtWorld(actor.x / TILE, actor.y / TILE) + 0.4;
          return 0.4;
        },
        getPlayerAimAngle: currentPlayerAimAngle,
        getPlayerAimPitch: currentPlayerAimPitch,
        getPlayerAimRay: currentPlayerAimRay,
        getPlayerInteractionRay: currentPlayerInteractionRay,
        getPlayerAvatarGroup: () => {
          let avatarGroup = null;
          playerMesh?.traverse?.(child => {
            if (!avatarGroup && Number.isFinite(child.userData?.portraitModelHeight)) avatarGroup = child;
          });
          return avatarGroup;
        },
        worldSurfaceY: (x, y) => {
          const grid = getActiveGrid();
          const col = clamp(Math.floor(x / TILE), 0, getActiveCols() - 1);
          const row = clamp(Math.floor(y / TILE), 0, getActiveRows() - 1);
          return grid[row]?.[col] ? tileSurfaceYInArea(grid[row][col], currentArea) : 0;
        },
        canOccupyAt,
        damageCreature,
        damagePlayer,
        angleDiff,
        cameraRelativeCreaturePerps,
        creaturePerpDeadRad: window.PerpRotation.CREATURE_PERP_DEAD_RAD,
        heldObjectRenderOrder: HELD_OBJECT_RENDER_ORDER,
        triggerRangedWeaponVisual,
        setRangedLoadedVisual,
        refreshActionBar,
        moveCreatureToward,
        awardRangedMastery: (itemKey) => awardToolMasteryXp(itemKey, MASTERY_XP_PER_COMBAT_HIT),
        toolMasteryLevel,
        devBumpToolMasteryLevel,
        getGearInventory: () => gearInventory,
        saveGearInventory,
        getEquippedRangedKey: () => equipmentSlots.ranged,
        isWeaponAiming: () => heldMode === 'tool' && ((activeTool === 'weapon' && !!equipmentSlots.weapon) || (activeTool === 'ranged' && !!equipmentSlots.ranged)),
        getAimLabelRangeWorld: () => activeTool === 'ranged'
          ? (window.RangedWeapons?.playerLockRangePx?.(equipmentSlots.ranged) || TILE * 7) / TILE
          : Math.max(3, Number(combatConfig().autoTargetRangeTiles) || 4),
        showToast,
        random: () => window.GameRandom?.random?.() ?? Math.random(),
        getLastMeleeHeightBlock: () => lastMeleeHeightBlock,
        debugLog, // Lets the ranged module report its latest testable behavior in the on-screen mobile debug panel.
      });

      window.Mounts?.init({
        player,
        scene,
        companionObjects,
        getStable: () => stable,
        CREATURE_DB,
        input,
        btnCallMount,
        TILE,
        PLAYER_RADIUS,
        FACING_LERP,
        MOVE_SPEED,
        ACCEL,
        DECEL,
        MOUSE_IDLE_MS,
        isDesktop,
        rnd,
        clamp,
        angleDiff,
        canPlayerOccupy,
        getAlchemySpeedMul: window.AlchemySystem.getSpeedMul,
        getKeyboardVector,
        makeCreatureEntity,
        despawnCreature,
        moveCreatureToward,
        updateCreatureMesh,
        updateCreatureAnimFrame,
        tileSurfaceYInArea,
        characterGroundShadowSurfaceOffset,
        getActiveScene,
        getActiveGrid,
        getActiveCols,
        getActiveRows,
        _isZoneArea,
        _isCavernBuildingArea,
        showToast,
        getCurrentArea: () => currentArea,
        getActiveMountId: () => activeMountId,
        getDevGlobalSpeedMul: () => devGlobalSpeedMul,
        getFacingAngle: () => facingAngle,
        setFacingAngle: (v) => { facingAngle = v; },
        getMouseLookActive: () => mouseLookActive,
        setMouseLookActive: (v) => { mouseLookActive = v; },
        getControllerLookActive: () => controllerLookActive,
        getControllerLookAngle: () => controllerLookAngle,
        getLastMouseMoveTime: () => lastMouseMoveTime,
        getMouseLookAngle: () => mouseLookAngle,
        isShoulderSurfMode: () => activeCameraMode === SHOULDER_SURF_MODE,
        cameraFacingAngleRad,
      });

      window.Fishing?.init({
        clamp,
        getActiveScene,
        currentSeason: window.CalendarSystem.currentSeason,
        getHour: window.CalendarSystem.getHour,
        FISH_DEFS,
        getReticleTile,
        getActiveTileAt,
        tileSurfaceYInArea,
        playerMesh,
        showToast,
        refreshActionBar,
        hideActionPrompt,
        showActionPrompt,
        attackActionIconHTML,
        worldToOverlay,
        inventory,
        equipmentSlots,
        rollItemStars,
        starRatingText,
        rareFishWeightMultiplier: rarity => window.SkillSystem?.rareFishWeightMultiplier?.(rarity) || 1,
        getPlayer: () => player,
        recordItemQuality: (...args) => window.CookingSystem?.recordItemQuality?.(...args),
        awardFishingXp: () => window.SkillSystem?.award?.('fishing', window.SkillSystem?.XP_GAINS?.fish || 10, 'caught fish'),
        awardToolUseMasteryXp,
        getInventoryStackKeys,
        getCurrentArea: () => currentArea,
        getThreeRect: () => _threeRect,
        setActiveItemIndex: (v) => { activeItemIndex = v; },
        setPlayerFacing: (v) => { playerFacing = v; },
        setHeldMode: (v) => { heldMode = v; },
        setActiveTool: (v) => { activeTool = v; },
        setLastActionMessage: (v) => { lastActionMessage = v; },
        getCameraMode: () => activeCameraMode,
        setCameraMode: (v) => { activeCameraMode = v; },
        getCameraTarget: () => activeCameraTarget,
        setCameraTarget: (v) => { activeCameraTarget = v; },
        setToolSwingDur: (v) => { toolSwingDur = v; },
        setToolSwingT: (v) => { toolSwingT = v; },
        setStrikeFired: (v) => { strikeFired = v; },
        setFishThrowActive: (v) => { fishThrowActive = v; },
      });

      let _musicPrevCameraMode = null;
      let _musicPrevCameraTarget = null;
      // Resolves a random real-recording footstep URL for whatever surface
      // this NPC is currently standing on — same surface resolution
      // _tickFootsteps uses for their actual footfalls — turned into an
      // absolute URL so it still loads correctly from inside the Lyre
      // minigame's own iframe (a different base path under assets/minigames/).
      // Used to give an ambient NPC performance's metronome a beat that
      // matches the ground they're actually playing on instead of a
      // generic click.
      function npcFootstepSampleUrl(npcId) {
        const walker = npcWalkers.find(w => w.rec?.id === npcId);
        if (!walker || !window.AudioSystem) return null;
        const wx = walker.root.position.x * TILE, wy = walker.root.position.z * TILE;
        const tile = window.AudioSystem.footstepTileAt(walker.area, wx, wy, npcGridForArea(walker.area));
        const surfaceKey = window.AudioSystem.footstepSurfaceKey(walker.area, tile?.type ?? null);
        const urls = window.AudioSystem.gameAudioConfig()?.footsteps?.surfaces?.[surfaceKey]?.urls;
        if (!urls?.length) return null;
        const url = urls[Math.floor(Math.random() * urls.length)];
        try { return new URL(url, document.baseURI).href; } catch { return url; }
      }

      window.MusicMinigame?.init({
        refreshActionBar,
        getCurrentArea: () => currentArea,
        listInstrumentPerformers,
        getNpcFootstepSampleUrl: npcFootstepSampleUrl,
        showToast,
        // Frames the performance in third-person (see the "music" camera
        // mode in scratchbones-config.js) instead of leaving the default
        // camera in place — matches how fishing/dialogue each get their
        // own framing. In backup mode the target sits at the midpoint
        // between the player and whichever NPC they joined, so both stay
        // in shot; in lead/solo mode it just follows the player as usual.
        beginMusicCamera: (npcId) => {
          _musicPrevCameraMode = activeCameraMode;
          _musicPrevCameraTarget = activeCameraTarget;
          activeCameraMode = 'music';
          const walker = npcId ? npcWalkers.find(w => w.rec?.id === npcId) : null;
          if (walker?.root) {
            const midX = (player.x / TILE + walker.root.position.x) / 2;
            const midZ = (player.y / TILE + walker.root.position.z) / 2;
            activeCameraTarget = { position: new THREE.Vector3(midX, 0, midZ) };
          } else {
            activeCameraTarget = null;
          }
        },
        endMusicCamera: () => {
          activeCameraMode = _musicPrevCameraMode ?? 'default';
          activeCameraTarget = _musicPrevCameraTarget ?? null;
          _musicPrevCameraMode = null;
          _musicPrevCameraTarget = null;
        },
        // Driven by js/music-minigame.js's 'sounded-note' relay from either
        // the player's overlay iframe or an NPC's ambient performance iframe
        // — see updateHeldItemHolder (player) and the station-tool block
        // above (NPC) for what actually owns each twitch state.
        triggerPlayerKurrayaTwitch: () => {
          if (_heldItemPlane?.userData.kurrayaAssembly) triggerKurrayaTwitch(_playerKurrayaTwitch, _heldItemPlane);
        },
        triggerNpcKurrayaTwitch: (npcId) => {
          const walker = npcId ? npcWalkers.find(w => w.rec?.id === npcId) : null;
          if (walker?.stationToolMesh?.userData.kurrayaAssembly) triggerKurrayaTwitch(walker.stationKurrayaTwitch, walker.stationToolMesh);
        },
      });

      window.BanditCombat?.init({
        rnd,
        clamp,
        debugLog,
        TILE,
        // Used only for the "Show Interaction Raycast" debug overlay's
        // head-to-target line — a bandit's own combat AI aims at real
        // hitbox geometry (meleeAimSolution), not this.
        getPlayerFaceTarget: () => {
          const pos = window.CreatureHeadCache.getHeadWorld(player, 'player', { x: player.x, y: player.y, mesh: playerMesh, avatarModelHeight: playerAvatarModelHeight });
          return { x: pos.x, y: pos.z, worldY: pos.worldY };
        },
        PLAYER_RADIUS,
        JUMP_BACK_DUR_S,
        JUMP_BACK_SPEED,
        HOSTILE_BITE_KNOCKBACK_PX_S,
        TOOL_SHAPE_DEFS,
        METAL_DEFS,
        TOOL_ITEM_DEFS,
        VERDIGRIS_METAL_KEYS,
        craftedToolItemKey,
        metalDmgMultiplier,
        damagePlayer,
        inCone,
        sweptMove,
        canOccupyAt,
        angleDiff,
        moveCreatureToward,
        creatureCanEnterTile,
        isCreatureSwimming,
        tickCreatureLungeTrail,
        tickCreatureFootsteps,
        hostileObjects,
        getActiveScene,
        getActiveGrid,
        getActiveCols,
        getActiveRows,
        tileSurfaceYInArea,
        makeCharacterGroundShadow,
        creatureGroundShadowRadii,
        characterGroundShadowSurfaceOffset,
        markPngPlane: _markPngPlane,
        makeToolPlaneMesh,
        STYLE_NEUTRAL_POSE,
        qFac: _qFac,
        qToolYaw: _qToolYaw,
        qAnim: _qAnim,
        qRoll: _qRoll,
        tUp: _tUp,
        xAxis: _xAxis,
        zAxis: _zAxis,
        getCurrentArea: () => currentArea,
      });

      window.CreatureGenetics?.init({ clamp, CREATURE_DB });

      window.CookingSystem?.init({
        ITEM_DEFS,
        inventoryItems,
        inventory,
        clampInventoryStack,
        refreshItemScroll,
        buildInventoryGrid,
        refreshActionBar,
        showToast,
        saveMemberWorldData,
        random: rnd,
        setInteractionBlocked(blocked) {
          menuOpen = blocked; // Used to reuse the game's existing movement/action input gate while the self-owned cooking modal is open.
          if (blocked) {
            player.vx = 0; player.vy = 0; input.x = 0; input.y = 0;
            // Same reasoning as openMenu's own call: without this, a player
            // in shoulder-surf mode gets no visible cursor at all inside
            // this modal (Pointer Lock hides the OS cursor and keeps
            // streaming raw movementX/Y to threeContainer no matter what's
            // drawn on top of it — see the mousemove guard above).
            releaseShoulderSurfPointerLock();
          }
        },
      });

      window.SkillSystem?.init({
        random: rnd,
        getFoodEffectStacks: effect => window.CookingSystem?.getFoodEffectStacks(effect) || 0,
        saveSkillProgress,
        showToast,
        debugLog,
        isDevMode: () => Boolean(window.__HOBUNJI_DEV_MODE),
      });

      window.PerkSystem?.init({ savePerkProgress });

      window.AlchemySystem?.init({
        ITEM_DEFS,
        inventory,
        clampInventoryStack,
        refreshItemScroll,
        buildInventoryGrid,
        refreshActionBar,
        showToast,
        saveMemberWorldData,
        random: rnd,
        getPlayer: () => player,
        getSelectedItemKey: () => getActiveInventoryItem()?.key || null,
        getInCombat: () => isPlayerInCombat(),
      });

      window.AlchemyFlasks?.init({
        THREE,
        TILE,
        inventory,
        clampInventoryStack,
        getPlayer: () => player,
        getCurrentArea: () => currentArea,
        getActiveScene,
        getAimAngle: () => controllerLookActive ? controllerLookAngle : mouseLookActive ? mouseLookAngle : targetAimAngle,
        getGroundY: () => _playerGroundY() + 0.025,
        getSelectedItemKey: () => getActiveInventoryItem()?.key || null,
        getHeldWorldPosition: () => {
          const position = new THREE.Vector3(); // Used to release the rendered flask from the player's hand.
          heldItemHolder.getWorldPosition(position);
          return position;
        },
        getSplashEntities: (area, x, y, radiusPx) => {
          const entities = [player, ...hostileObjects, ...companionObjects]; // Used to retain self-splash and existing combat entities.
          return entities.filter(entity => entity && !entity._denHidden && (entity.areaId !== undefined ? entity.areaId === area && Math.hypot(entity.x - x, entity.y - y) <= radiusPx : entity === player && currentArea === area && Math.hypot(player.x - x, player.y - y) <= radiusPx));
        },
        spawnImpactPresentation: ({ x, y, radiusTiles, definition }) => {
          const color = definition.particleColors?.[0] || '#55ff82'; // Used to keep impact presentation recipe-authored.
          const fx = { isCone: true, x: x / TILE, z: y / TILE, y: _playerGroundY() + 0.08, angle: 0, halfConeRad: Math.PI, rangeTiles: radiusTiles, age: 0, maxAge: 0.34, ok: true, color }; // Uses the same bounded radial-particle renderer as combat/Grehlr-style bursts.
          fx.particles = weaponTrailParticleSeeds(fx);
          weaponTrailEffects.push(fx);
        },
        startThrowWindup: () => { _heldThrowAimT = 1; },
        confirmThrowAnimation: () => { _heldThrowAimT = 2; },
        cancelThrowWindup: () => { _heldThrowAimT = 0; },
        refreshItemScroll,
        refreshActionBar,
        saveMemberWorldData,
      });

      window.PerpRotation?.init({
        angleDiff,
      });

      window.GeneralStore?.init({
        inventory,
        showToast,
        buildInventoryGrid,
        saveMemberWorldData,
        getGeneralStoreCatalog: () => GENERAL_STORE_CATALOG,
        lootShopWorldState: _lootShopWorldState,
        getStoreClothingPieces: () => STORE_CLOTHING_PIECES,
        getGeneralStoreClothingSlots: () => GENERAL_STORE_CLOTHING_SLOTS,
        calendar,
        esc,
        getPackClothing: () => packClothing,
        buildPackClothingSection: window.EquipmentPanel.buildPackClothingSection,
        seededRandom,
        clothingSpriteForCosmetic: window.EquipmentPanel.clothingSpriteForCosmetic,
      });

      window.CarpenterShop?.init({
        inventory,
        showToast,
        buildInventoryGrid,
        saveMemberWorldData,
        getBarnTiers: () => BARN_TIERS,
        getHousePieceDeeds: () => Object.fromEntries(Object.entries(HOUSE_PIECE_CATALOG).filter(([, def]) => def.deedItem)),
        FURNITURE_BLUEPRINT_CATALOG,
        lootShopWorldState: _lootShopWorldState,
        esc,
      });

      // Cache for the WeatherFX deps.getFurnitureLightSources() call below —
      // declared here (game.js scope) rather than inside the deps object
      // literal, since that object's own methods don't close over each
      // other's sibling keys the way a plain local variable does.
      let _furnitureLightScanCache = { scene: null, objs: null, lastScan: 0 };

      window.WeatherFX?.init({
        calendar,
        seededRandom,
        getGrid: () => grid,
        ROWS, COLS,
        TileType,
        clamp,
        showToast,
        debugLog,
        worldToOverlay,
        camera,
        lctx,
        player,
        npcWalkers,
        getCurrentArea: () => currentArea,
        TILE,
        getLightningAlpha: () => lightningAlpha,
        setLightningAlpha: (v) => { lightningAlpha = v; },
        getSceneTransAlpha: () => sceneTransAlpha,
        getThreeRect: () => _threeRect,
        _isBuildingArea,
        getActiveGrid, getActiveCols, getActiveRows,
        getFlowingTrenchTiles: () => window.WaterSystem.getFlowingTrenchTiles(),
        getTownFlowingTrenchTiles: () => window.WaterSystem.getTownFlowingTrenchTiles(),
        threeContainer,
        getCamX: () => camX,
        getCamY: () => camY,
        // Used by WeatherFX's player lantern mask to follow the avatar's
        // smoothed world elevation instead of projecting from flat Y=0.
        getPlayerWorldY: () => playerMesh.position.y,
        // Lighting is sampled at 10 Hz, but a full scene.traverse() every one
        // of those ticks still visits every node in the active scene (not
        // just the lights) to find the handful tagged furnitureLightMask —
        // real, avoidable cost in a decor-dense area (a lot of furniture/
        // NPCs/terrain chunks, e.g. the inn) since it scales with total
        // scene size, not light count. Re-scanning is still cheap and
        // correctness matters more than shaving cost further, so this only
        // throttles the traversal itself down to 2s (light *positions* are
        // re-read fresh from world matrices every call regardless — only
        // which objects count as sources is cached) rather than trying to
        // track furniture add/remove sites to invalidate it precisely.
        getFurnitureLightSources: () => {
          const cache = _furnitureLightScanCache;
          const scene = getActiveScene();
          const now = performance.now();
          if (cache.scene !== scene || now - cache.lastScan >= 2000) {
            const objs = [];
            scene?.traverse(obj => { if (obj.isPointLight && obj.userData?.furnitureLightMask) objs.push(obj); });
            cache.scene = scene; cache.objs = objs; cache.lastScan = now;
          }
          const worldPosition = new THREE.Vector3();
          return (cache.objs || []).map(obj => {
            obj.getWorldPosition(worldPosition);
            return {
              x: worldPosition.x,
              y: worldPosition.y,
              z: worldPosition.z,
              distance: obj.distance,
              intensity: obj.intensity,
              color: {
                r: Math.round(obj.color.r * 255),
                g: Math.round(obj.color.g * 255),
                b: Math.round(obj.color.b * 255),
              },
            };
          });
        },
        applySeasonalGrassAppearance,
        RAIN_PITY_DAYS,
      });

      window.RainPlanes?.init({
        THREE,
        renderer,
        camera,
        calendar,
        player,
        TILE,
        getPlayerGroundY: _playerGroundY,
        getActiveScene,
        getCurrentArea: () => currentArea,
        isOutdoorArea: () => currentArea === 'farm' || currentArea === 'town' || _isZoneArea(currentArea),
      });

      window.CloudForestFog?.init({
        THREE,
        player,
        TILE,
        getPlayerGroundY: _playerGroundY,
        getActiveScene,
        isCloudForestArea: () => currentArea === 'map_southern_cloud_forest',
      });

      window.FarmPanel?.init({
        LIVESTOCK_ITEM_KINDS,
        inventory,
        showToast,
        buildInventoryGrid,
        refreshActionBar,
        isFarmOwner,
        getFarmName,
        setFarmName,
        getFarmOwnerName,
        TileType,
        COLS, ROWS,
        getGrid: () => grid,
        isHouseFootprint,
        processingFurnitureObjects,
        interiorFurnitureObjects,
        DECORATIVE_FURNITURE_DEFS,
        _loadWorldLivestock,
        worldObjects,
        animalObjects,
        esc,
        hasFarmPermission,
        getBarnTiers: () => BARN_TIERS,
        getHousePieceCatalog: () => HOUSE_PIECE_CATALOG,
        getHousePieces: () => housePieces,
        placeHouseDeed: (pieceKey, col, row) => window.HousePieces.placeDeed(pieceKey, col, row),
        buildHousePiece: (id) => window.HousePieces.build(id),
        demolishHousePiece: (id) => window.HousePieces.demolish(id),
        moveHouse: (col, row) => window.HousePieces.moveHouse(col, row),
        movePiece: (pieceId, col, row) => window.HousePieces.movePiece(pieceId, col, row),
        canMovePieceTo: (pieceId, col, row) => window.HousePieces.canMovePieceTo(pieceId, col, row),
        rotateHousePiece: (id) => window.HousePieces.rotatePiece(id),
        rotateHouseRoof: (id) => window.HousePieces.rotateRoofAxis(id),
        canPlaceHouseFeatureAt: (col, row) => window.HousePieces.canPlaceFeatureAt(col, row),
        placeHouseFeature: (col, row, worldX, worldZ, type) => window.HousePieces.placeFeature(col, row, worldX, worldZ, type),
        removeHouseFeatureAt: (col, row) => window.HousePieces.removeFeatureAt(col, row),
        getHouseFixtureInventory: () => window.HousePieces.getFixtureInventory(),
        housePieceLabel: (entry) => window.HousePieces.label(entry),
        scene,
        getFarmBuildings: () => farmBuildings,
        PROCESSING_FURNITURE_DEFS,
        AGING_METHODS,
        calendar,
        getStable: () => stable,
        _loadWorldBreedingPairs,
        saveMemberWorldData,
        _saveWorldBreedingPairs,
        _saveWorldLivestock,
        companionAiTypeForKind,
        _autoAssignStableRole,
        saveStable,
        _tothalWorldId,
        defaultWorldMemberState,
        spGold,
        _loadWorldStorage,
        _saveWorldStorage,
        ITEM_DEFS,
        dewItemKey,
        clampInventoryStack,
        getActiveMountId: () => activeMountId,
        setActiveMountId: (v) => { activeMountId = v; },
        getActiveShoulderPetId: () => activeShoulderPetId,
        setActiveShoulderPetId: (v) => { activeShoulderPetId = v; },
        getActiveCompanionId: () => activeCompanionId,
        setActiveCompanionId: (v) => { activeCompanionId = v; },
      });

      window.TasksPanel?.init({
        ITEM_DEFS,
        esc,
        WMAP_ZONE_LABELS,
        getQuestProgress: () => questProgress,
        inventory,
      });

      window.SupplyPage?.init({
        inventory,
        getSupplyBoxObject: () => supplyBoxObject,
        SUPPLY_CATALOG,
        showToast,
        buildInventoryGrid,
        saveMemberWorldData,
        getPendingOrders: () => pendingOrders,
        getDeliveryLog: () => deliveryLog,
      });

      window.EquipmentPanel?.init({
        inventory,
        clampInventoryStack,
        equipmentSlots,
        saveEquipmentSlots,
        TOOL_ITEM_DEFS,
        getGearInventory: () => gearInventory,
        saveGearInventory,
        getPackClothing: () => packClothing,
        setPackClothing: (arr) => { packClothing = arr; },
        saveMemberWorldData,
        showToast,
        rebuildToolMeshes,
        toolMeshMap,
        toolHolder,
        getActiveTool: () => activeTool,
        refreshActionBar,
        setActiveTool,
        isDevMode: () => s_devMode,
        toolMasteryLevel,
        devBumpToolMasteryLevel,
        metalToolImgSrc,
        esc,
        refreshPlayerAvatar,
        buildInventoryGrid,
        clearInventoryDetail,
        clearInvSelection: () => {
          invSelectedKey = null;
          document.querySelectorAll('.inv-item-box').forEach(b => b.classList.remove('selected'));
        },
      });

      window.WhistleEquip?.init({
        setEquipmentSlot: window.EquipmentPanel.setEquipmentSlot,
        getGearInventory: () => gearInventory,
        CREATURE_DB,
        equipmentSlots,
      });

      window.WildlifeDebugPanel?.init({
        esc,
        _zoneLayouts,
        hostileObjects,
        getCurrentArea: () => currentArea,
        _isZoneArea,
      });

      window.WildlifeBehaviorMap?.init({
        TILE,
        TileType,
        player,
        hostileObjects,
        zoneLayouts: _zoneLayouts,
        getCurrentArea: () => currentArea,
        _isZoneArea,
      });

      window.ShippingPanel?.init({
        inventory,
        ITEM_DEFS,
        BASE_PRICES,
        getShippingBoxObject: () => shippingBoxObject,
        showToast,
        hasFarmPermission,
        clampInventoryStack,
        buildInventoryGrid,
        refreshItemScroll,
        refreshActionBar,
        saveMemberWorldData,
      });

      window.CraftingPanel?.init({
        inventory,
        clampInventoryStack,
        FURNITURE_BLUEPRINT_CATALOG,
        showToast,
        buildInventoryGrid,
        saveMemberWorldData,
        esc,
      });

      window.DevSpawner?.init({
        getCurrentArea: () => currentArea,
        setCurrentArea: (v) => { currentArea = v; },
        getActiveScene,
        playerMesh, playerGroundShadow, toolHolder, reticleMesh, reticleCircleMesh, reticleRingMesh, reticleWavyGroup,
        _isBuildingArea,
        setCurrentBuildingMapId: (v) => { _currentBuildingMapId = v; },
        startSceneTransition,
        player,
        _snapCameraTarget,
        refreshActionBar,
        showToast,
        closeMenu,
        EXTERIOR_ZONES,
        buildTownScene,
        buildZoneScene,
        COLS, ROWS, TILE,
        CREATURE_DB,
        esc,
        clamp,
        makeCreatureEntity,
        hostileObjects, companionObjects,
        damageCreature,
        getActiveGrid,
        tileSurfaceYInArea,
        markOutline: _markOutline,
        zoneScenes: _zoneScenes,
        treeFadeActive: _treeFadeActive,
        isFarmOwner,
        getFarmEditMode: () => farmEditMode,
        toggleFarmEditMode,
        setDebugWeather: window.WeatherFX.setDebugWeather,
        getDebugWeather: window.WeatherFX.getDebugWeather,
        getRainPlaneSettings: window.RainPlanes.getSettings,
        setRainPlaneSettings: window.RainPlanes.setSettings,
        isDevMode: () => s_devMode,
      });

      window.FurniturePlacer?.init({
        getCurrentArea: () => currentArea,
        getDecorativeFurnitureDefs: () => DECORATIVE_FURNITURE_DEFS,
        getProcessingFurnitureDefs: () => PROCESSING_FURNITURE_DEFS,
        inventory,
        hasFarmPermission,
        armFurniturePlacement,
        getArmedFurniturePlacementKey,
        armFurnitureMove,
        getArmedFurnitureMoveId,
        getPlacedFurniture: () => [
          ...interiorFurnitureObjects.filter(o => o.area === currentArea).map(o => ({ ...o, placementKind: 'decorative' })),
          ...(currentArea === 'farm' ? [...processingFurnitureObjects].map(o => ({ ...o, key: o.furnitureKey, area: 'farm', placementKind: 'processing' })) : []),
        ],
        removeFurniture: id => processingFurnitureById(id) ? removeProcessingFurniture(id) : removeDecorativeFurniture(id),
        rotateFurniture: (id, degrees) => processingFurnitureById(id) ? rotateProcessingFurniture(id, degrees) : rotateDecorativeFurniture(id, degrees),
        showToast,
        esc,
        isPaused: () => paused,
        isDevMode: () => s_devMode,
      });

      window.WildernessCampfire?.init({
        getCurrentArea: () => currentArea,
        isZoneArea: _isZoneArea,
        getActiveScene,
        getPlayer: () => player,
        getFacingAngle: () => facingAngle,
        surfaceYAt: activeSurfaceYAtWorld,
        TILE,
        AuthoredFurniture: window.AuthoredFurniture,
        persist: saveMemberWorldData,
        showToast,
        openMenu,
        isPaused: () => paused,
        inventory,
        clampInventoryStack,
        buildInventoryGrid,
        refreshItemScroll,
      });

      window.TownZoneBuildings?.init({
        getTownZone: () => _townZone,
        debugLog,
        getTownScene: () => townScene,
        getTownBuildingDefs: () => _townBuildingDefs,
        getTownBuildingGroups: () => _townBuildingGroups,
        setTownBuildingGroups: (v) => { _townBuildingGroups = v; },
        getWorldTownTransitions: () => worldTownTransitions,
        getTownGrid: () => townGrid,
        houseWallBuilder,
        INTERIOR_COLS,
        INTERIOR_ROWS,
        tileSurfaceY,
        TileType,
        zoneLayouts: _zoneLayouts,
        zoneBuildingGroups: _zoneBuildingGroups,
        zoneBuildingsGlbUpgradePending: _zoneBuildingsGlbUpgradePending,
        zoneScenes: _zoneScenes,
        zoneDecorFurnitureGroups: _zoneDecorFurnitureGroups,
        makeDecorativeFurnitureMesh,
        PROCESSING_FURNITURE_DEFS,
        buildFurnitureVisual,
        markOutline: _markOutline,
        markFurnitureEdgeId: _markFurnitureEdgeId,
        NORMAL_TOP,
        PLATEAU_UNIT,
      });

      window.FoliageFurnitureRuntime?.init({
        zoneLayouts: _zoneLayouts,
        zoneScenes: _zoneScenes,
        zoneDecorFurnitureGroups: _zoneDecorFurnitureGroups,
        markOutline: _markOutline,
        markFurnitureEdgeId: _markFurnitureEdgeId,
        NORMAL_TOP,
        PLATEAU_UNIT,
        sit: beginSitInteraction,
        debugLog,
      });

      window.WildlifeSpawn?.init({
        TILE,
        TileType,
        rnd,
        _isZoneArea,
        getCurrentArea: () => currentArea,
        random: rnd,
        bonusYieldChance: skill => window.SkillSystem?.bonusYieldChance?.(skill) || 0,
        awardForagingXp: () => window.SkillSystem?.award?.('foraging', window.SkillSystem?.XP_GAINS?.forage || 4, 'picked herb'),
        hostileObjects,
        EXTERIOR_ZONES,
        damageCreature,
        HOSTILE_BITE_KNOCKBACK_PX_S,
        zoneLayouts: _zoneLayouts,
        makeCreatureEntity,
        CREATURE_DB,
        showToast,
        buildingScenes: _buildingScenes,
        denNests: _denNests,
        getCutscenePreviewActive: () => cutscenePreviewActive,
        buildZoneScene,
        DEN_MOTHER_DEFS,
        DEN_MOTHER_ITEM_KEYS,
        zoneScenes: _zoneScenes,
        makeDecorativeFurnitureMesh,
        // Used by js/wildlife-cloud-forest-behavior.js for its gar-wolf
        // shift/LOD player-distance checks and its game-hour-scheduled
        // fruit respawn/eating timers — no other WildlifeSpawn consumer
        // needs either today.
        player,
        calendar,
      });

      window.CavernGenerator?.init({
        EXTERIOR_ZONES,
        DEN_MOTHER_DEFS,
      });

      window.ZonePlateauMesa?.init({
        NORMAL_TOP, PLATEAU_UNIT, TileType, CARVED_TILE_TYPES,
        resolveTileMat, displaceZoneGeometry,
      });

      window.ZoneTerrainFeatures?.init({
        TileType, NORMAL_TOP, PLATEAU_UNIT, RIVER_TOP,
        displaceZoneGeometry, resolveTileMat,
        markTerrainEdgeId: _markTerrainEdgeId,
        terrainCategoryFor: _terrainCategoryFor,
        waterVertShader, waterFragShader,
        buildMergedWaterMesh: window.WaterSystem.buildMergedWaterMesh,
      });

      window.ZoneDenTotemFeatures?.init({
        NORMAL_TOP, PLATEAU_UNIT, TileType, ROCK_MOUND_CELLS_PER_TILE,
        markTerrainEdgeId: _markTerrainEdgeId,
        terrainCategoryFor: _terrainCategoryFor,
      });

      window.ZoneGrassBillboards?.init({
        TileType, PLATEAU_UNIT,
        grassBladeGeo: _grassBladeGeo,
        getGrassBillboardMat: () => grassBillboardMat,
        getGrassEnabled: () => s_grass,
        fillBillboardInstances: _fillBillboardInstances,
        mbRng: _mbRng,
        tileSurfaceY,
      });

      window.MetalCraftShop?.init({
        inventory,
        showToast,
        clampInventoryStack,
        buildInventoryGrid,
        buildEquipmentSlots: window.EquipmentPanel.buildEquipmentSlots,
        saveMemberWorldData,
        esc,
        getGearInventory: () => gearInventory,
        saveGearInventory,
        metalBarItemKey,
        craftedToolItemKey,
        toolPlating,
        clearToolPlating,
        setToolPlating,
        toolReinforcementMetal,
        setToolReinforcement,
        toolEffectiveMetalKey,
        toolVerdigrisFraction,
        toolMasteryLevel,
        refreshMetalToolWorldTexture,
        METAL_DEFS,
        TOOL_ITEM_DEFS,
        VERDIGRIS_METAL_KEYS,
        UNLOCKED_TOOL_SHAPES,
        TOOL_SHAPE_DEFS,
      });

      window.WildernessMap?.init({
        _zoneLayouts,
        tothalWorldId: _tothalWorldId,
        currentTothalYear,
        showToast,
        _isZoneArea,
        getCurrentArea: () => currentArea,
        player,
        TILE,
        npcWalkers,
        WMAP_ZONE_LABELS,
      });

      window.WildernessChunks?.init({
        getCurrentArea: () => currentArea,
        isZoneArea: _isZoneArea,
        player,
        TILE,
      });

      window.ClimbSystem?.init({
        _isZoneArea,
        getCurrentArea: () => currentArea,
        player,
        hostileObjects,
        companionObjects,
        facingCardinal,
        getActiveGrid,
        getActiveCols,
        getActiveRows,
        TILE,
        isSolid,
        tileSurfaceYInArea,
        clamp,
        getMountRideState: () => window.Mounts?.rideState ?? 'none',
        showToast,
        setFacingAngle: (v) => { facingAngle = v; },
        setTargetAimAngle: (v) => { targetAimAngle = v; },
        setLastMoveAngle: (v) => { lastMoveAngle = v; },
        getPlayerAimRay: currentPlayerAimRay,
        getPlayerInteractionRay: currentPlayerInteractionRay,
        worldSurfaceY: (x, y) => activeSurfaceYAtWorld(x / TILE, y / TILE),
        // Read fresh input because player.inputX/Y are written after the
        // on-branch early return. Shoulder cam uses the exact same
        // camera-relative transform as ordinary ground movement.
        getMovementInput: () => {
          const kb = getKeyboardVector();
          const move = kb.active ? { x: kb.x, y: kb.y } : { x: input.x, y: input.y };
          if (activeCameraMode !== SHOULDER_SURF_MODE || (!move.x && !move.y)) return move;
          const aim = cameraFacingAngleRad();
          const sin = Math.sin(aim), cos = Math.cos(aim);
          return {
            x: -move.x * sin - move.y * cos,
            y: move.x * cos - move.y * sin,
          };
        },
      });

      window.BanditCombatLog?.init({
        player,
        companionObjects,
        arenaSpawnedCreatures: window.DevSpawner.getArenaSpawnedCreatures(),
        getCurrentArea: () => currentArea,
        getDevGlobalSpeedMul: () => devGlobalSpeedMul,
        DEV_ARENA_ZONE_ID: window.DevSpawner.DEV_ARENA_ZONE_ID,
        TILE,
        angleDiff,
        showToast,
      });

      window.DebugHitboxes?.init({
        getActiveTileAt,
        tileSurfaceY,
        surfaceYAtWorld: activeSurfaceYAtWorld,
        worldToOverlay,
        octx,
        TILE,
        player,
        hostileObjects,
        companionObjects,
        npcWalkers,
        animalObjects,
        getCurrentArea: () => currentArea,
        getShowHitboxes: () => s_showHitboxes,
        getShowInteractionRaycast: () => s_showInteractionRaycast,
        getPlayerAimRay: currentPlayerAimRay,
        getPlayerInteractionRay: currentPlayerInteractionRay,
        refreshInteractionFocusDebug,
        creatureHitboxHalfSizePx,
      });

      window.RelationshipsPanel?.init({
        npcWalkers,
        esc,
      });

      window.CalendarSystem?.init({
        MORNING_HOUR,
        NIGHT_HOUR,
        calendar,
        calToday,
        calMonthTitle,
        calPrevMonth,
        calNextMonth,
        calWeeks,
      });

      window.JubmirShop?.init({
        tothalWorldId: _tothalWorldId,
        getShopStock: () => _shopStock,
        lootShopWorldState: _lootShopWorldState,
        calendar,
        inventory,
        showToast,
        esc,
        buildInventoryGrid,
        saveMemberWorldData,
      });

      window.DyeSystem?.init({
        getGearInventory: () => gearInventory,
        saveGearInventory,
      });

      window.ReagentPlants?.init({
        calendar,
        inventory,
        debugLog,
        refreshItemScroll,
        tileSurfaceYInArea,
        NORMAL_TOP,
        _mbRng,
        _seedFromString,
        findZoneFlatEmptyTiles,
        getReagentPlantMaterial,
        _grassBladeGeo,
        _zoneScenes,
        _zoneReagentObjects,
        _zoneReagentMeshGroups,
        _zoneReagentPersist,
        _isZoneArea,
        getCurrentArea: () => currentArea,
      });

      window.DewVats?.init({
        COLS,
        ROWS,
        TileType,
        ITEM_DEFS,
        inventory,
        processingFurnitureObjects,
        PROCESSING_FURNITURE_DEFS,
        PROCESSING_SFX_KEY,
        getGrid: () => grid,
        rollItemStars,
        starRatingText,
        recordItemQuality: (...args) => window.CookingSystem?.recordItemQuality?.(...args),
        awardFarmingXp: () => window.SkillSystem?.award?.('farming', window.SkillSystem?.XP_GAINS?.animalGood || 5, 'collected animal good'),
        getScene: getActiveScene,
        getWorldObjectAt,
        isHouseFootprint,
        tileSurfaceY,
        creaturePlaneGroundOffset,
        nearestAngleAmong,
        cameraRelativePerps,
        perpClamp: window.PerpRotation.perpClamp,
        angleDiff,
        dewItemKey,
        ensureProcessedItemDef,
        getProcessingOutputs,
        hasFarmPermission,
        loadWorldLivestock: _loadWorldLivestock,
        saveWorldLivestock: _saveWorldLivestock,
        saveFarmLayout,
        rnd,
      });

      window.WildBerries?.init({
        BERRY_COLORS,
        ITEM_DEFS,
        NORMAL_TOP,
        cropData,
        inventory,
        _grassBladeGeo,
        _zoneScenes,
        _zoneBerryMeshGroups,
        _zoneBerryObjects,
        _zoneBerryPersist,
        _zoneReagentPersist,
        calendar,
        debugLog,
        getCurrentArea: () => currentArea,
        isZoneArea: _isZoneArea,
        _mbRng,
        _seedFromString,
        findZoneFlatEmptyTiles,
        getReagentPlantMaterial,
        refreshItemScroll,
        tileSurfaceYInArea,
      });

      window.WildTreasure?.init({
        calendar,
        rnd,
        VERDIGRIS_METAL_KEYS,
        getLootPools: () => _lootPools,
        lootShopWorldState: _lootShopWorldState,
        MYSTERY_DYE_ITEM_KEY_BY_POOL,
        getStoreClothingPieces: () => STORE_CLOTHING_PIECES,
        clothingSpriteForCosmetic: window.EquipmentPanel.clothingSpriteForCosmetic,
        _zoneScenes,
        _mbRng,
        _seedFromString,
        _zoneReagentPersist,
        _zoneBerryPersist,
        findZoneFlatEmptyTiles,
        PLATEAU_UNIT,
        NORMAL_TOP,
        TRENCH_TOP,
        TileType,
        metalBarItemKey,
        inventory,
        ITEM_DEFS,
        METAL_DEFS,
        getPackClothing: () => packClothing,
        _zoneTreasureMeshGroups,
        _zoneTreasureObjects,
        _zoneTreasurePersist,
        refreshItemScroll,
        buildInventoryGrid,
        buildPackClothingSection: window.EquipmentPanel.buildPackClothingSection,
        debugLog,
        isZoneArea: _isZoneArea,
        getCurrentArea: () => currentArea,
        TILE,
        player,
        actionParticles,
        ACTION_FX_LIMIT,
      });

      window.FarmAnimals?.init({
        COLS,
        ROWS,
        TILE,
        TileType,
        CREATURE_DB,
        CREATURE_PERP_DEAD_RAD: window.PerpRotation.CREATURE_PERP_DEAD_RAD,
        ITEM_DEFS,
        LIVESTOCK_RESOURCE_DEFS,
        LIVESTOCK_RESOURCE_VERB,
        LIVESTOCK_ITEM_KINDS,
        LIVESTOCK_DIET,
        UUMKAOII_DEFAULT_DEW_COLOR,
        UUMKAOII_DEW_COOLDOWN_DAYS,
        animalObjects,
        calendar,
        inventory,
        player,
        // Farm livestock has its own tile-space update loop, so give it the
        // same explicit face target used by companion/wildlife gaze.  The
        // horizontal point is in farm tiles; worldY is the player's actual
        // smoothed portrait face height, never the feet/body center.
        getPlayerFaceTarget: () => {
          const pos = window.CreatureHeadCache.getHeadWorld(player, 'player', { x: player.x, y: player.y, mesh: playerMesh, avatarModelHeight: playerAvatarModelHeight });
          return { x: pos.x / TILE, z: pos.z / TILE, worldY: pos.worldY };
        },
        // "Stare back if you focus on their head" for livestock, backed by
        // the exact same aim-ray math ground companions use (game.js's
        // _isPlayerFocusedOnHead). headWorldTileScale is
        // {x, y, z} in farm tiles (x/z) + real scene worldY (y) — the same
        // shape _farmAnimalFaceLook already builds for its debug ray.
        isPlayerFocusedOnHead: (headWorldTileScale) => {
          const ray = _currentPlayerLookRay();
          if (!ray || !headWorldTileScale) return false;
          return window.CreatureHeadCache.isRayNearPoint(ray, headWorldTileScale, PLAYER_HEAD_FOCUS_RADIUS_WORLD);
        },
        scene,
        worldObjects,
        angleDiff,
        cameraConfig,
        cameraRelativeCreaturePerps,
        cameraRelativePerps,
        clampInventoryStack,
        getHeldItemKey: () => heldMode === 'item' ? getActiveInventoryItem()?.key || null : null,
        refreshItemScroll,
        refreshActionBar,
        saveMemberWorldData,
        companionAiTypeForKind,
        creatureAttachmentAnchor,
        creaturePlaneGroundOffset,
        findOpenTileNearBarn: window.FarmBuildings.findOpenTileNear,
        getWorldObjectAt,
        hasFarmPermission,
        isSolid,
        nearestAngleAmong,
        perpClamp: window.PerpRotation.perpClamp,
        resolveCreatureGroundAnchorRatio,
        rnd,
        saveStable,
        showToast,
        tileSurfaceY,
        _autoAssignStableRole,
        _markPngPlane,
        _loadWorldBreedingPairs,
        _saveWorldBreedingPairs,
        loadWorldLivestock: _loadWorldLivestock,
        saveWorldLivestock: _saveWorldLivestock,
        saveFarmLayout,
        getBarnTiers: () => BARN_TIERS,
        getPlayerData: () => _playerData,
        getGrid: () => grid,
        getFarmBuildings: () => farmBuildings,
        getStable: () => stable,
        getCurrentArea: () => currentArea,
        getFacingAngle: () => facingAngle,
        setFacingAngle: (v) => { facingAngle = v; },
        getCameraMode: () => activeCameraMode,
        setCameraMode: (v) => { activeCameraMode = v; },
        getCameraTarget: () => activeCameraTarget,
        setCameraTarget: (v) => { activeCameraTarget = v; },
        setWorldLivestockFrameCache: (v) => { _worldLivestockFrameCache = v; },
        refreshTroughVisual: (barnId, troughIndex) => window.FarmTroughs.refreshVisual(barnId, troughIndex),
      });

      window.FarmTroughs?.init({
        getBarnTiers: () => BARN_TIERS,
        getFarmBuildings: () => farmBuildings,
        inventory,
        ITEM_DEFS,
        esc,
        showToast,
        buildInventoryGrid,
        refreshActionBar,
        saveMemberWorldData,
        loadWorldLivestock: _loadWorldLivestock,
      });

      window.FarmBuildings?.init({
        COLS,
        ROWS,
        TileType,
        animalObjects,
        clampInventoryStack,
        debugLog,
        hasFarmPermission,
        inventory,
        loadHousePieceFaceTexture: window.TownZoneBuildings.loadHousePieceFaceTexture,
        markTileDirty,
        openMenu,
        recomputeWater: window.WaterSystem.recomputeWater,
        saveFarmLayout,
        saveMemberWorldData,
        scene,
        worldObjects,
        houseWallBuilder,
        loadWorldLivestock: _loadWorldLivestock,
        saveWorldLivestock: _saveWorldLivestock,
        enterBuilding: (mapId) => enterBuilding(mapId),
        getBarnTiers: () => BARN_TIERS,
        getGrid: () => grid,
        getHousePieceRects: () => window.HousePieces.getPieceRects(),
        getFarmBuildings: () => farmBuildings,
        setFarmBuildings: (v) => { farmBuildings = v; },
        setFarmLivestockFocusBarnId: (v) => { _farmLivestockFocusBarnId = v; },
        UUMKAOII_DEW_COOLDOWN_DAYS,
      });

      window.HousePieces?.init({
        COLS,
        ROWS,
        TileType,
        clampInventoryStack,
        debugLog,
        hasFarmPermission,
        inventory,
        loadHousePieceFaceTexture: window.TownZoneBuildings.loadHousePieceFaceTexture,
        markTileDirty,
        openMenu,
        recomputeWater: window.WaterSystem.recomputeWater,
        getGrid: () => grid,
        saveFarmLayout,
        saveMemberWorldData,
        scene,
        worldObjects,
        houseWallBuilder,
        startSceneTransition,
        enterInterior,
        onPieceGeometryChanged: () => rebuildInteriorGeometry(),
        transformFurnitureWithHousePiece,
        recoverFurnitureInInteriorRect: (c0, r0, w, h) => recoverFurnitureInInteriorRect(c0, r0, w, h),
        getPieceCatalog: () => HOUSE_PIECE_CATALOG,
        getHousePieces: () => housePieces,
        setHousePieces: (v) => { housePieces = v; },
        getFarmBuildings: () => farmBuildings,
      });

      window.CreatureDeath?.init({
        TILE,
        COLS,
        ROWS,
        clamp,
        canOccupyAt,
        characterGroundShadowSurfaceOffset,
        tileSurfaceYInArea,
        corpseObjects,
        getCurrentArea: () => currentArea,
        getGrid: () => grid,
      });

      window.FarmCrates?.init({
        BASE_PRICES,
        MORNING_HOUR,
        SELL_INTERVAL_HOURS,
        SUPPLY_CATALOG,
        TileType,
        inventory,
        calendar,
        clampInventoryStack,
        getActiveInventoryItem,
        getHeldMode: () => heldMode,
        canPlayNpcDrinkInteraction: (...args) => window.NpcDrinkInteraction?.canPlay?.(...args) || false,
        playNpcDrinkInteraction: (...args) => window.NpcDrinkInteraction?.play?.(...args) || 0,
        itemIconForKey,
        getHour: window.CalendarSystem.getHour,
        hasFarmPermission,
        openMenu,
        showToast,
        saveMemberWorldData,
        buildInventoryGrid,
        refreshItemScroll,
        refreshActionBar,
        buildShippingTransferUI: () => window.ShippingPanel.build(),
        tileSurfaceY,
        scene,
        getDeliveryLog: () => deliveryLog,
        getPendingOrders: () => pendingOrders,
        getMenuOpen: () => menuOpen,
        triggerHeldDrinkAnimation,
      });

      window.ProceduralTasks?.init({
        FISH_DEFS,
        CREATURE_DB,
        getLootPools: () => _lootPools,
        ITEM_DEFS,
        toolMasteryLevel,
        equipmentSlots,
        calendar,
        setQuestStatus,
        getQuestProgress: () => questProgress,
        npcWalkers,
        inventory,
        clampInventoryStack,
        showToast,
      });

      window.BountyBoard?.init({
        getQuestProgress: () => questProgress,
        setQuestStatus,
        showToast,
        inventory,
        calendar,
        WMAP_ZONE_LABELS,
        makeTaskId: window.ProceduralTasks.makeTaskId,
      });

      window.BanditCamps?.init({
        clamp,
        rnd,
        debugLog,
        TILE,
        TileType,
        WATERWAY_TYPES,
        EXTERIOR_ZONES,
        NORMAL_TOP,
        zoneLayouts: _zoneLayouts,
        zoneScenes: _zoneScenes,
        refreshZoneGroundVisuals,
        markOutline: _markOutline,
        makeDecorativeFurnitureMesh,
        tileSurfaceYInArea,
        hostileObjects,
        companionObjects,
        corpseObjects,
        isZoneArea: _isZoneArea,
        isDenPackAlive: window.WildlifeSpawn.isDenPackAlive,
        denKeyFor: window.WildlifeSpawn.denKeyFor,
        player,
        showZoneBanner,
        showToast,
        requestCompanionDiscovery: (c, reason) => window.AnimalVocalizations?.companionDiscovery?.(c, reason)
          || window.AudioSystem?.playCreatureTreasureAlert?.(c),
        rollLootPool,
        inventory,
        clampInventoryStack,
        itemIconForKey,
        refreshItemScroll,
        buildInventoryGrid,
        refreshActionBar,
        saveMemberWorldData,
        despawnCreature,
        buildPackClothingSection: window.EquipmentPanel.buildPackClothingSection,
        getDyeCatalog: window.DyeSystem.getCatalog,
        dyeToClothingColor: window.DyeSystem.toClothingColor,
        clothingSpriteForCosmetic: window.EquipmentPanel.clothingSpriteForCosmetic,
        DEV_ARENA_ZONE_ID: window.DevSpawner.DEV_ARENA_ZONE_ID,
        activeBountyForZone: (zoneId) => window.BountyBoard.activeBountyForZone(zoneId),
        getCurrentArea: () => currentArea,
        getActionHeldDown: () => actionHeldDown,
        getPackClothing: () => packClothing,
        getStoreClothingPieces: () => STORE_CLOTHING_PIECES,
      });
      fitToAspect();
      resizeCanvas();
      refreshActionBar();
      refreshItemScroll();
      try { initWorldObjects(); } catch(e) { console.error('initWorldObjects:', e); }
      // Apply saved object positions and furniture after world objects are created
      try { applyFarmLayoutObjects(loadFarmLayout()); } catch(e) { console.error('applyFarmLayoutObjects:', e); }
      // Transition spots + shared NPC routes from the map editor
      try { initWorldTravel(loadFarmLayout()); } catch(e) { console.error('initWorldTravel:', e); }
      // Ensure a farm→town transition always exists even without map editor data
      if (!worldTransitions.some(t => t.target === 'town')) {
        worldTransitions.push({ id: 'sp_farm_to_town', label: 'To Town', area: 'farm', col: 17, row: 0, target: 'town', targetCol: 20, targetRow: 48 });
        buildTransitionMarkers();
      }
      // Load town layout from workspace config (authoritative source)
      window.Music?.loadAudioCueIndexes().then(() => window.Music?.resetAmbientCueTimer()).catch(() => window.Music?.resetAmbientCueTimer());
      _loadTownFromWorkspace().catch(() => {});
      debugLog('canvas resized, split wide-screen layout active, controls bound, animation loop requested');

      // ── Onboarding gate ────────────────────────────────────────────
      let gameStarted = false;
      window.__hobunjiGameStarted = false;

      async function spawnPlayerAvatar(playerData) {
        // Restore this world's saved date/time/weather (see
        // _loadWorldCalendar/_saveWorldCalendar) before anything reads
        // calendar.day — checkTothalShift() below derives the current
        // Tothal year from it, so this has to land first or the shift check
        // runs against the just-reset "Day 1" default instead of wherever
        // the world actually left off.
        const _savedCalendar = _loadWorldCalendar();
        if (_savedCalendar) Object.assign(calendar, _savedCalendar);

        // Fire-and-forget: the Tothal Shift at world start (or on any missed
        // year since last played) can take a few seconds across all four
        // zones, but nothing here needs to block on it — a zone only needs
        // to be reshaped by the time the player actually walks into it.
        checkTothalShift();

        // The module-level init above loaded the farm layout (tiles/crops and
        // furniture/crate positions) under the legacy unnamespaced key, since
        // worldId wasn't known yet at that point. Now that playerData.worldId
        // is known, redo just that part against the correctly-namespaced
        // per-world key so separate worlds never bleed into each other's farm
        // (mirrors doReset()'s regenerate-then-apply pattern below). Transitions/
        // routes/NPC schedules are shared authored map content, not per-world
        // state, so initWorldTravel() is deliberately NOT redone here — it
        // already ran once at module init, and spawnScheduledNpcs() isn't
        // idempotent (it appends to npcWalkers with no clear step), so calling
        // it again would spawn every scheduled NPC a second time.
        clearPlacedProcessingFurniture();
        clearInteriorFurniture();
        window.FarmBuildings.clearAll();
        // Module init may have placed house pieces per the legacy-key
        // layout — clear them now (same as FarmBuildings.clearAll() just
        // above) so the reset loop below doesn't call .reset() on a piece
        // this world hasn't actually earned; the starter piece is reseeded
        // fresh right after that loop, at its hard default, before applying
        // (or not finding) this world's own saved position — same rationale
        // as the sell crate/supply box reset immediately below.
        window.HousePieces.clearAll();
        worldObjects.forEach(o => o.reset && o.reset());
        window.HousePieces.seedStarter(HOUSE_STARTER_COL, HOUSE_STARTER_ROW);
        rebuildInteriorGeometry();
        grid = createInitialGrid();
        // Module init already may have moved the shipping/supply crates per the
        // legacy-key layout — put them back to their hard defaults before
        // applying (or not finding) this world's own saved positions, so a
        // brand-new world can't inherit another world's crate placement.
        const DEFAULT_SELL_CRATE_COL = 2, DEFAULT_SELL_CRATE_ROW = ROWS - 3;
        const DEFAULT_SUPPLY_BOX_COL = 4, DEFAULT_SUPPLY_BOX_ROW = ROWS - 3;
        if (shippingBoxObject && (shippingBoxObject.col !== DEFAULT_SELL_CRATE_COL || shippingBoxObject.row !== DEFAULT_SELL_CRATE_ROW)) {
          worldObjects.delete(shippingBoxObject.col + ',' + shippingBoxObject.row);
          const nc = window.FarmCrates.makeSellCrate(DEFAULT_SELL_CRATE_COL, DEFAULT_SELL_CRATE_ROW);
          shippingBoxObject = nc; worldObjects.set(nc.col + ',' + nc.row, nc);
        }
        if (supplyBoxObject && (supplyBoxObject.col !== DEFAULT_SUPPLY_BOX_COL || supplyBoxObject.row !== DEFAULT_SUPPLY_BOX_ROW)) {
          worldObjects.delete(supplyBoxObject.col + ',' + supplyBoxObject.row);
          const nb = window.FarmCrates.makeSupplyBox(DEFAULT_SUPPLY_BOX_COL, DEFAULT_SUPPLY_BOX_ROW);
          supplyBoxObject = nb; worldObjects.set(nb.col + ',' + nb.row, nb);
        }
        const _worldLayout = loadFarmLayout();
        if (_worldLayout) applyFarmLayoutToGrid(_worldLayout, { refreshVisuals: true });
        applyFarmLayoutObjects(_worldLayout); // repositions again if THIS world saved custom crate positions
        // Seed a starter bed in the farmhouse for a brand-new world — sleepInBed()
        // (see getInteriorInteractableAt) needs somewhere to sleep, and a fresh
        // player has no bed item in inventory yet to buy+place one themselves.
        // Gated on this world having no saved layout at all, so it never
        // re-appears for a returning player, including one who moved or
        // removed their starter bed (farmLayoutKey() is per-world, so this
        // check has to happen here — after playerData.worldId is known —
        // rather than at module init, where it would save under the wrong,
        // not-yet-namespaced key and then get cleared right back out by this
        // same per-world reload).
        if (!_worldLayout) {
          try {
            // A cell just inside the starter piece's own doubled interior
            // block (away from its door threshold) — see
            // rebuildInteriorGeometry()/HOUSE_STARTER_COL/ROW above.
            const bedCol = HOUSE_STARTER_COL * 2 + 1, bedRow = HOUSE_STARTER_ROW * 2 + 1;
            const starterBed = makeDecorativeFurnitureMesh(bedCol, bedRow, 'basicBed', interiorScene, 'interior');
            if (starterBed) {
              interiorFurnitureObjects.push({ id: 'decor_starter_bed', key: 'basicBed', col: bedCol, row: bedRow,
                mesh: starterBed.mesh, light: starterBed.light, sfxSource: starterBed.sfxSource, area: 'interior', rotYDeg: 0,
                ...furnitureOwnerFields(bedCol, bedRow) });
              saveFarmLayout();
            }
          } catch (e) { console.error('starter bed seed:', e); }
        }
        window.FarmAnimals.respawnWorldLivestock(); // after furniture, so occupancy checks see final tile state
        window.WaterSystem.recomputeWater(false);

        // Non-gear inventory (resources) and pack clothing are world-scoped
        // per character — they stay behind in this world's member record
        // rather than following the character to another world.
        Object.keys(inventory).forEach(key => { delete inventory[key]; });
        Object.assign(inventory, Object.keys(playerData.nonGearInventory || {}).length
          ? { ...playerData.nonGearInventory }
          : { ...STARTING_INVENTORY });
        // Worlds saved before the Campfire Kit blueprint joined
        // STARTING_INVENTORY never picked it up — backfill it for free,
        // once, same as existing characters getting the crossbow/scatterbow
        // slots below, so it's available without a carpenter trip either way.
        if (!inventory.campfireKitFurnitureBlueprint) inventory.campfireKitFurnitureBlueprint = 1;
        window.HobunjiDrunkGameplayBridge?.restoreBottleSwigs?.(playerData.alcoholBottleSwigs);
        window.HobunjiDrunkGameplayBridge?.restoreNpcAlcoholState?.(playerData.npcAlcoholState);
        packClothing = [...(playerData.packClothing || [])];
        window.CookingSystem.restore(playerData.cookingState);
        window.SkillSystem.restore(playerData);
        window.PerkSystem?.restore(playerData);

        // NPC relationships/memory and quest progress are likewise world-scoped
        // per character.
        window.DialogueContent?.loadNpcRelationships(playerData);
        questProgress = { ...(playerData.questProgress || {}) };
        window.ProceduralTasks.maybeRefreshBoardTask(); // makes sure a board task exists even before the first day rollover

        // Alchemy: discovered reagent effects, still-active buffs/debuffs, and
        // today's (not-yet-picked) wilderness reagent placements — all
        // world-scoped per character, same as the fields just above.
        window.AlchemySystem.restoreKnownRecipes(playerData.alchemyKnownRecipes, playerData.alchemyKnownEffects);
        window.AlchemySystem.restoreActiveEffects(playerData.alchemyActiveEffects);
        window.ReagentPlants.restoreZoneReagentState(playerData.alchemyReagentState);
        window.WildBerries.restoreState(playerData.wildBerryState);
        window.WildTreasure.restoreState(playerData.zoneTreasureState);
        restoreWildernessChunkState(playerData.wildernessChunkState);
        window.WildernessCampfire?.restore(playerData.wildernessCampfireState);
        restoreZoneFelledTreeState(playerData.felledTreeState);
        restoreZoneMinedRockState(playerData.minedRockState);
        // Potion items just restored into `inventory` above have no ITEM_DEFS
        // entry yet this page load (ITEM_DEFS starts empty of them every
        // session, unlike the static reagent/furniture/fish tables) — rebuild
        // each one's display/Drink metadata straight from its key, which
        // deterministically encodes its effects (see ensurePotionItemDef).
        window.AlchemySystem.migrateLegacyPotionInventory(inventory);
        Object.keys(inventory).forEach(key => {
          const payload = window.AlchemySystem.getPotionEffectsFromKey(key);
          if (payload?.recipeId) window.AlchemySystem.ensureRecipeItemDef(payload.recipeId, payload.potencyTier);
          else if (payload?.legacyEffects) window.AlchemySystem.ensurePotionItemDef(payload.legacyEffects);
          if (key.startsWith('alchemy_recipe_')) window.AlchemySystem.ensureRecipeScrollItemDef(key.slice('alchemy_recipe_'.length));
        });

        gearInventory = (playerData.gearInventory && typeof playerData.gearInventory === 'object')
          ? playerData.gearInventory
          : makeDefaultGear();
        if (!gearInventory.tools)    gearInventory.tools    = {};
        // Existing characters receive the first two ranged weapons so the
        // new slot is immediately testable without invalidating old saves.
        gearInventory.tools.crossbow ??= true;
        gearInventory.tools.scatterbow ??= true;
        if (!gearInventory.clothing) gearInventory.clothing = { hat: null, hood: null, torso: null, overwear: null };
        if (!gearInventory.charms)   gearInventory.charms   = [];
        if (!gearInventory.whistles || !gearInventory.whistles.length) {
          gearInventory.whistles = [{ id: 'whistle_bingo', creatureKey: 'dabinggi-hound', name: 'Bingo' }];
        }
        if (!gearInventory.toolMastery || typeof gearInventory.toolMastery !== 'object') gearInventory.toolMastery = {};
        if (typeof gearInventory.motesOfProwess !== 'number') gearInventory.motesOfProwess = 0;
        gearInventory.specialAmmo = Math.max(0, Math.min(8, Math.floor(Number(gearInventory.specialAmmo) || 0)));
        if (!gearInventory.rangedAmmoLoadouts || typeof gearInventory.rangedAmmoLoadouts !== 'object') gearInventory.rangedAmmoLoadouts = {};
        if (!Array.isArray(gearInventory.unlockedSpecialAmmo)) gearInventory.unlockedSpecialAmmo = [];
        for (const ammoId of ['shrapnel', 'concussive']) if (!gearInventory.unlockedSpecialAmmo.includes(ammoId)) gearInventory.unlockedSpecialAmmo.push(ammoId);
        window.EquipmentPanel.ensureGearClothingCollection();
        window.DyeSystem.ensureCollection();

        // Personal stable — same lazy-seed pattern as the whistles block just
        // above: a character with no stable yet gets the starter dabinggi-hound
        // (matching gearInventory.whistles' starter whistle) so "the dabinggi
        // hound you start with is stored in the stable" holds for old saves too.
        stable = Array.isArray(playerData.stable) ? playerData.stable.map(s => ({ ...s })) : [];
        activeCompanionId = playerData.activeCompanionId ?? null;
        activeMountId = playerData.activeMountId ?? null;
        activeShoulderPetId = playerData.activeShoulderPetId ?? null;
        if (!stable.length) {
          const starter = { id: 'stable_bingo', kind: 'dabinggi-hound', name: 'Bingo', genotype: window.CreatureGenetics.makeDefaultGenotype('dabinggi-hound'), aiType: companionAiTypeForKind('dabinggi-hound'), level: 0, stabledAt: Date.now() };
          stable.push(starter);
          activeCompanionId = starter.id;
        }
        if (!activeCompanionId && stable.length) activeCompanionId = stable[0].id;
        // Backfill genotype-less stable entries from older saves (e.g. a
        // starter Bingo saved before pattern genes existed) so they render
        // real genes instead of the plain uncolored sprite forever. Also
        // backfills a missing Size (genotype.sizeClass) on entries saved
        // before the stable's mount/companion/shoulder-pet system existed.
        for (const entry of stable) {
          if (!entry.genotype && (window.CreatureGenetics.PATTERN_DEFS[entry.kind] || entry.kind === 'uumkaoii')) {
            entry.genotype = window.CreatureGenetics.makeDefaultGenotype(entry.kind);
          }
          if (entry.genotype && !entry.genotype.sizeClass) {
            entry.genotype.sizeClass = CREATURE_DB[entry.kind]?.defaultSizeClass || 'medium';
          }
        }
        saveStable();
        // Restore whichever literal tool/weapon/whistle instance was equipped
        // in each slot last session (see saveEquipmentSlots) — skips any slot
        // whose saved item no longer exists in this character's gearInventory
        // (sold/lost since, or a save from before this field existed), which
        // then falls through to the starter-gear defaults just below.
        if (playerData.equipmentSlots && typeof playerData.equipmentSlots === 'object') {
          for (const [slot, itemId] of Object.entries(playerData.equipmentSlots)) {
            if (!itemId || !(slot in equipmentSlots)) continue;
            const stillOwned = slot === 'whistle'
              ? gearInventory.whistles.some(w => w.id === itemId)
              : !!gearInventory.tools[itemId];
            if (stillOwned) equipmentSlots[slot] = itemId;
          }
        }
        // Set default equipment slot assignments
        if (gearInventory.tools.hoe_nativeCopper)      equipmentSlots.hoe    = equipmentSlots.hoe    || 'hoe_nativeCopper';
        else if (gearInventory.tools.bronzehoe)        equipmentSlots.hoe    = equipmentSlots.hoe    || 'bronzehoe';
        if (gearInventory.tools.pickshovel_nativeCopper) equipmentSlots.shovel = equipmentSlots.shovel || 'pickshovel_nativeCopper';
        else if (gearInventory.tools.pickshovel)       equipmentSlots.shovel = equipmentSlots.shovel || 'pickshovel';
        if (gearInventory.tools.hatchet_nativeCopper)  equipmentSlots.weapon = equipmentSlots.weapon  || 'hatchet_nativeCopper';
        else if (gearInventory.tools.hatchet)          equipmentSlots.weapon = equipmentSlots.weapon  || 'hatchet';
        if (gearInventory.tools.crossbow)               equipmentSlots.ranged = equipmentSlots.ranged || 'crossbow';
        if (gearInventory.whistles.length)  equipmentSlots.whistle = equipmentSlots.whistle || gearInventory.whistles[0].id;
        // A cutscene preview's ephemeral profile can inherit gearInventory
        // (and an already-equipped whistle) straight from the real local
        // save via docs/index.html's onboarding-profile handoff, and the
        // line above auto-equips the starter whistle for any profile that
        // has none — either way, an uninvited companion animal would spawn
        // and compete for camera framing in a scene the Director never
        // authored one for. A scene's own creature actors are unaffected;
        // this only clears the real player's own companion slot.
        if (window.__hobunjiCutscenePreview) equipmentSlots.whistle = null;
        rebuildToolMeshes();
        // Restore the tool actually held last session (see saveEquipmentSlots)
        // — silent so returning to a save doesn't pop a "X selected" toast.
        if (playerData.activeTool && toolActions[playerData.activeTool]) {
          setActiveTool(playerData.activeTool, { silent: true });
        } else {
          refreshWeaponSwitchBtn();
          Object.values(toolMeshMap).forEach(m => { if (m) toolHolder.remove(m); });
          if (toolMeshMap[activeTool]) toolHolder.add(toolMeshMap[activeTool]);
        }
        window.EquipmentPanel.buildEquipmentSlots();
        try {
          await window.NpcAvatarPreview.ensurePortraitCosmetics({
            assetBase: './assets/',
            configBase: './config/',
          });

          await refreshPlayerAvatar();
          debugLog('PNG plane avatar attached to player_root');
        } catch (err) {
          console.warn('spawnPlayerAvatar failed, continuing without avatar:', err);
        }
        // Resume out in the wilderness, exactly where last session left off,
        // if that's genuinely where the player was: a wilderness zone that
        // still has this character's own campfire established in it (see
        // saveMemberWorldData's lastPosition and WildernessCampfire.restore
        // just above). Nothing else here ever moves the player away from
        // the farm's fixed boot position, so without this a wilderness trip
        // always reset to the farm on reload — the same reason a campfire
        // used to be destroyed just for leaving its own map. Deliberately
        // narrower than "resume anywhere": farm/town/interior/building all
        // keep spawning at the usual farm default, since only the
        // wilderness-with-an-active-camp case is actually being asked for
        // here, and re-entering a building/cavern/NPC schedule context from
        // a cold boot has its own preconditions this isn't set up to satisfy.
        const _lastPos = playerData.lastPosition;
        const _resumeCampfire = window.WildernessCampfire?.serialize?.();
        if (_lastPos && _isZoneArea(_lastPos.area) && _resumeCampfire?.mapId === _lastPos.area
            && Number.isFinite(_lastPos.x) && Number.isFinite(_lastPos.y)) {
          await enterZone(_lastPos.area, Math.floor(_lastPos.x / TILE), Math.floor(_lastPos.y / TILE));
          // enterZone already placed the player at the tile center of the
          // col/row above — refine to the exact saved sub-tile position/
          // facing now that the zone (and its campfire, via enterZone's own
          // onZoneEntered call) has actually finished building.
          player.x = _lastPos.x; player.y = _lastPos.y;
          if (Number.isFinite(_lastPos.angle)) { player.angle = _lastPos.angle; facingAngle = _lastPos.angle; }
          _snapCameraTarget();
        }
        gameStarted = true;
        window.__hobunjiGameStarted = true;
      }

      document.addEventListener('hobunjiPlayerReady', (e) => {
        _playerData = e.detail;
        spawnPlayerAvatar(e.detail);
      }, { once: true });

      // If init() already fired synchronously (returning player with localStorage profile),
      // __hobunjiPlayerProfile is set before this listener registered — catch that case.
      if (window.__hobunjiPlayerProfile) {
        _playerData = window.__hobunjiPlayerProfile;
        spawnPlayerAvatar(window.__hobunjiPlayerProfile);
      }


      // ══════════════════════════════════════════════════════════════════
      //  Cutscene Preview Mode
      // ──────────────────────────────────────────────────────────────────
      //  Boots this tab with a throwaway character/world (see the inline
      //  handoff script in index.html, just before <script src="game.js">,
      //  and docs/tools/cutscene-director/index.html's "Preview in game"
      //  button) instead of the real save, and replays an authored
      //  cutscene using the REAL dialogue UI and REAL dialogue-zoom camera
      //  system — not the Director tool's own private preview.
      //
      //  The differences from a normal conversation are deliberate and
      //  narrow, and live right next to the code they change:
      //    - beginNpcDialogueStaging / faceNpcDialogueParticipants /
      //      updateNpcDialogueStaging (above) no-op when
      //      cutscenePreviewActive — the director already scripts every
      //      participant's exact position/facing frame by frame, so the
      //      real "walk the player up to the NPC" auto-staging would only
      //      fight it, and there may not even be a "player" among the
      //      scene's actors.
      //    - advanceNpcDialogue (above) delegates to
      //      cutscenePreviewAdvance — the director walks its own
      //      move/talk/choice/... stage list, not an authored dialogueTree.
      //    - Camera/dialogue-zoom targeting reuses activeCameraTarget
      //      exactly as normal NPC dialogue already does (openNpcDialogue
      //      sets it to walker.root) — it's just pointed at whichever
      //      cutscene participant is currently speaking instead of always
      //      being "the NPC the player walked up to." That target is never
      //      the real singleton player/playerMesh, even for a "Player"
      //      role actor in the scene — every actor, including that one, is
      //      spawned as its own independent stand-in entity here, so this
      //      previewer never reads or writes the real player's position.
      //      The real player sits exactly wherever their save left them,
      //      off-screen and untouched, for the whole preview.
      // ══════════════════════════════════════════════════════════════════

      let cutscenePreviewAdvance = null; // set while a talk/choice line is showing

      function cutscenePreviewBanner(text, isError) {
        let el = document.getElementById('cutscenePreviewBanner');
        if (!el) {
          el = document.createElement('div');
          el.id = 'cutscenePreviewBanner';
          el.style.cssText = 'position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:99999;'
            + 'padding:8px 16px;border-radius:10px;font:600 14px/1.3 system-ui,sans-serif;color:#fff;'
            + 'background:rgba(20,14,10,.86);border:2px solid #f2b755;box-shadow:0 6px 18px rgba(0,0,0,.4);'
            + 'display:flex;gap:10px;align-items:center;pointer-events:auto;';
          const label = document.createElement('span');
          label.id = 'cutscenePreviewBannerLabel';
          el.appendChild(label);
          const closeBtn = document.createElement('button');
          closeBtn.textContent = 'Exit preview';
          closeBtn.style.cssText = 'font:600 12px system-ui,sans-serif;padding:4px 8px;border-radius:6px;'
            + 'border:1px solid #f2b755;background:#3a2c22;color:#fff;cursor:pointer;';
          // A plain reload is enough to leave preview mode cleanly: the
          // handoff key is one-shot (already consumed) and the ephemeral
          // profile only ever lived in window.__hobunjiPlayerProfile, never
          // written to the real hobunjiPlayerProfile/hobunjiSaveMeta keys.
          closeBtn.addEventListener('click', () => location.reload());
          el.appendChild(closeBtn);
          document.body.appendChild(el);
        }
        el.style.borderColor = isError ? '#d66b68' : '#f2b755';
        document.getElementById('cutscenePreviewBannerLabel').textContent = text;
      }

      function cutscenePreviewFadeEl() {
        let el = document.getElementById('cutscenePreviewFade');
        if (!el) {
          el = document.createElement('div');
          el.id = 'cutscenePreviewFade';
          el.style.cssText = 'position:fixed;inset:0;z-index:99998;background:#000;opacity:0;'
            + 'pointer-events:none;transition:opacity 1s linear;';
          document.body.appendChild(el);
        }
        return el;
      }

      async function cutscenePreviewWaitForArea(area, timeoutMs, predicate) {
        const check = predicate || (() => !!(sceneForNpcArea(area) && npcGridForArea(area)));
        const start = performance.now();
        while (performance.now() - start < timeoutMs) {
          if (check()) return true;
          await new Promise(r => setTimeout(r, 100));
        }
        return false;
      }

      // Scans a generated wilderness zone's real tile grid for a clear, flat
      // w×h rectangle to drop an authored scene's whole local footprint onto
      // — same tile-level exclusion checklist wilderness-map-generator.js's
      // own areaFree/randomFreeArea use (uniform elevation tier, no incline/
      // ramp/water/solid tiles), plus building/decor/furniture/den occupancy
      // that live outside the tile grid itself (see buildZoneScene /
      // _spawnZoneDecorFurniture / performTothalShift's `dens`). Searches
      // outward in Chebyshev rings from the zone's center so a found spot is
      // never farther from the middle of the map than it has to be.
      function findZonePlacementFootprint(area, w, h) {
        const zi = _zoneScenes.get(area);
        const grid = zi?.grid;
        if (!grid) return null;
        const cols = zi.cols, rows = zi.rows;
        const zoneData = _zoneLayouts.get(area);
        const occupied = Array.from({ length: rows }, () => new Array(cols).fill(false));
        const markOccupied = (col, row, ow, oh) => {
          for (let r = Math.max(0, row); r < Math.min(rows, row + oh); r++)
            for (let c = Math.max(0, col); c < Math.min(cols, col + ow); c++) occupied[r][c] = true;
        };
        for (const b of (zoneData?.buildings || [])) markOccupied(b.gridX || 0, b.gridZ || 0, b.footprintW ?? b.w ?? 1, b.footprintD ?? b.h ?? 1);
        for (const d of (zoneData?.dens || [])) markOccupied(d.x, d.y, d.w || 1, d.h || 1);
        for (const d of (zoneData?.decor || [])) markOccupied(d.col, d.row, 1, 1);
        for (const f of (zoneData?.furniture || [])) markOccupied(f.col, f.row, 1, 1);

        function rectOk(col, row) {
          if (col < 1 || row < 1 || col + w > cols - 1 || row + h > rows - 1) return false; // stay off the border terrain skirt
          let elevTier = null;
          for (let r = row; r < row + h; r++) {
            for (let c = col; c < col + w; c++) {
              if (occupied[r][c]) return false;
              const tile = grid[r][c];
              if (!tile) return false;
              if (tile.water) return false;
              if (tile.incline) return false;
              if (tile.type === TileType.RAMP) return false;
              if (isSolid(tile.type)) return false;
              const tier = tile.elevTier || 0;
              if (elevTier === null) elevTier = tier;
              else if (tier !== elevTier) return false;
            }
          }
          return true;
        }

        const centerCol = Math.floor((cols - w) / 2), centerRow = Math.floor((rows - h) / 2);
        const maxRadius = Math.max(cols, rows);
        for (let radius = 0; radius <= maxRadius; radius++) {
          for (let dr = -radius; dr <= radius; dr++) {
            for (let dc = -radius; dc <= radius; dc++) {
              if (Math.max(Math.abs(dr), Math.abs(dc)) !== radius) continue; // ring only — interior already checked at smaller radii
              const col = centerCol + dc, row = centerRow + dr;
              if (rectOk(col, row)) return { col, row };
            }
          }
        }
        return null;
      }

      // Freeform ("custom") actors, and any actor whose real NPC/creature
      // spawn failed, fall back to a plain placeholder mesh — same
      // graceful-degradation policy the Cutscene Director tool's own
      // standalone preview uses for the same cases.
      function cutscenePreviewMakePlaceholder(actor, area, targetScene) {
        const group = new THREE.Group();
        const mat = new THREE.MeshLambertMaterial({ color: actor.color || '#cccccc' });
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.85, 10), mat);
        body.position.y = 0.28 + 0.85 / 2;
        group.add(body);
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), mat);
        head.position.y = 0.28 + 0.85 + 0.18;
        group.add(head);
        const surfY = npcSurfaceY(area, actor.worldC, actor.worldR);
        group.position.set(actor.worldC + 0.5, surfY, actor.worldR + 0.5);
        group.rotation.y = THREE.MathUtils.degToRad(actor.rotation || 0);
        targetScene.add(group);
        return { kind: 'placeholder', root: group };
      }

      const cutscenePreviewAngleToward = (from, to) => (((Math.atan2(to.r - from.r, to.c - from.c) * 180 / Math.PI + 90) % 360) + 360) % 360;

      function cutscenePreviewApplyState(entity, area, st) {
        const surfY = npcSurfaceY(area, Math.round(st.c), Math.round(st.r));
        if (entity.kind === 'creature') {
          const c = entity.creature;
          c.x = st.c * TILE; c.y = st.r * TILE;
          c.avatarRef.group.position.set(st.c + 0.5, surfY + c.halfHeight, st.r + 0.5);
          c.avatarRef.group.rotation.y = THREE.MathUtils.degToRad(st.rotation);
          // Seeds groupRot/pngRot to match so cutsceneRotationTick's first
          // real tick (see below) starts an angleDiff of exactly 0 instead
          // of smoothly sweeping in from wherever makeCreatureEntity's
          // groupRot:0 default left them.
          c.groupRot = c.pngRot = THREE.MathUtils.degToRad(st.rotation);
          c.groundShadow?.position.set(st.c + 0.5, surfY + characterGroundShadowSurfaceOffset(), st.r + 0.5);
          c.avatarRef.group.scale.setScalar(st.pose === 'prone' ? 0.6 : 1);
        } else if (entity.kind === 'npc') {
          entity.walker.rot = THREE.MathUtils.degToRad(st.rotation);
          entity.root.position.set(st.c + 0.5, surfY, st.r + 0.5);
          entity.root.rotation.y = entity.walker.rot;
          entity.root.scale.setScalar(1);
          // Prone tips the flat portrait plane down onto its back instead of
          // just shrinking a standing figure — this walker is scripted
          // entirely by the director (pause:Infinity, see the actor-spawn
          // loop) and never dialogue-staged (guarded by cutscenePreviewActive
          // in beginNpcDialogueStaging/faceNpcDialogueParticipants), so
          // nothing else re-asserts a standing transform over this pose.
          const avatarGroup = entity.walker.avatarGroup;
          if (avatarGroup) {
            const avatarHeight = avatarGroup.userData?.portraitModelHeight || 1;
            if (st.pose === 'prone') {
              avatarGroup.rotation.x = Math.PI / 2;
              avatarGroup.position.y = avatarHeight * 0.06;
            } else {
              avatarGroup.rotation.x = 0;
              avatarGroup.position.y = avatarHeight / 2;
            }
          }
        } else {
          entity.root.position.set(st.c + 0.5, surfY, st.r + 0.5);
          entity.root.rotation.y = THREE.MathUtils.degToRad(st.rotation);
          entity.root.scale.setScalar(st.pose === 'prone' ? 0.6 : 1);
        }
      }

      async function runCutscenePreview(payload) {
        cutscenePreviewActive = true;
        cutscenePreviewZoomPercent = 100;
        cutscenePreviewBanner(`🎬 ${payload.title || 'Cutscene Preview'} — loading…`, false);

        const area = normalizeNpcArea(payload.mapId);
        if (_isBuildingArea(area)) {
          try { await loadBuildingScene(area); } catch (e) { console.error(e); }
        } else if (area === 'town' && !townScene) {
          // The town's tile/route data loads automatically at boot
          // (_loadTownFromWorkspace → initTownTravel), but the actual 3D
          // scene (buildTownScene, which sets `townScene`) is normally only
          // built lazily the moment the player first walks in from the farm
          // (enterTown). enterTown() also does things this previewer must
          // never do to the real player (moves player.x/y, stamps
          // farmPlayerSave, flips currentArea) — buildTownScene() itself is
          // the standalone, player-untouched half of that, so it's called
          // directly here instead of enterTown().
          try {
            if (!townGrid) await cutscenePreviewWaitForArea('__townGrid__', 15000, () => !!townGrid);
            buildTownScene();
          } catch (e) { console.error('[cutscene preview] buildTownScene failed:', e); }
        } else if (payload.wilderness && _isZoneArea(area)) {
          // A wilderness zone's real terrain doesn't exist until the yearly
          // Tothal Shift generates it (performTothalShift, kicked off at
          // world boot by checkTothalShift) — wait for that to finish, then
          // build the zone's 3D scene and scan its actual tile grid for a
          // clear, flat spot to drop this scene's whole local footprint onto
          // (findZonePlacementFootprint). The Director sends every point/
          // actor/camera position in local, un-anchored coordinates for this
          // mode (see buildPreviewPayload) precisely because that anchor —
          // which map, and where on it — can only be resolved here, against
          // real generated terrain, not authored ahead of time.
          try {
            if (_tothalShiftPromise) await _tothalShiftPromise;
            if (!_zoneLayouts.has(area)) {
              checkTothalShift();
              await cutscenePreviewWaitForArea(area, 20000, () => _zoneLayouts.has(area));
            }
            buildZoneScene(area);
            const fp = payload.footprint || {};
            const fw = Math.max(1, Math.ceil(fp.w || 6)), fh = Math.max(1, Math.ceil(fp.h || 6));
            const anchor = findZonePlacementFootprint(area, fw, fh);
            if (!anchor) {
              cutscenePreviewBanner(`Could not find a clear ${fw}×${fh} spot for this scene on "${payload.mapId}".`, true);
              cutscenePreviewActive = false;
              return;
            }
            const offsetC = anchor.col - (fp.originC || 0), offsetR = anchor.row - (fp.originR || 0);
            for (const a of (payload.actors || [])) {
              a.worldC = (a.lc || 0) + offsetC;
              a.worldR = (a.lr || 0) + offsetR;
            }
            for (const s of (payload.stages || [])) {
              if (s.type === 'move' && s.targetLocal) s.targetWorld = { c: s.targetLocal.lc + offsetC, r: s.targetLocal.lr + offsetR, facing: s.targetLocal.facing ?? null };
            }
            if (payload.camera3d?.localPos && payload.camera3d?.localTarget) {
              // localPos.y/localTarget.y were authored against the Director's
              // flat y=0 wilderness practice grid (groundYAt returns 0 for
              // mapMeta.kind==="wilderness" — there's no real elevation to
              // author against yet) — add the REAL terrain's elevation at
              // wherever the translated camera/target actually land, or the
              // rig sits at the wrong height the instant the anchor lands
              // anywhere but a zero-elevation tile (actors don't have this
              // bug — their Y is computed fresh from the real terrain at
              // spawn time, only the camera3d block skipped it).
              const posX = payload.camera3d.localPos.x + offsetC, posZ = payload.camera3d.localPos.z + offsetR;
              const targetX = payload.camera3d.localTarget.x + offsetC, targetZ = payload.camera3d.localTarget.z + offsetR;
              const posElevY = npcSurfaceY(area, Math.round(posX), Math.round(posZ));
              const targetElevY = npcSurfaceY(area, Math.round(targetX), Math.round(targetZ));
              payload.camera3d.worldPos = { x: posX, y: payload.camera3d.localPos.y + posElevY, z: posZ };
              payload.camera3d.worldTarget = { x: targetX, y: payload.camera3d.localTarget.y + targetElevY, z: targetZ };
            }
            debugLog(`[cutscene preview] wilderness placement: ${payload.mapId} footprint ${fw}x${fh} anchored at (${anchor.col},${anchor.row})`);
          } catch (e) { console.error('[cutscene preview] wilderness zone placement failed:', e); }
        }
        const ready = await cutscenePreviewWaitForArea(area, 20000);
        if (!ready) {
          cutscenePreviewBanner(`Could not load map "${payload.mapId}" for preview.`, true);
          cutscenePreviewActive = false;
          return;
        }
        currentArea = area; // switches the whole game's render/active-scene target to the cutscene's map

        // Without this, NPC avatars silently fall back to placeholder
        // capsules: buildProfileFromNpcExport (npc-avatar-preview-utils.js)
        // returns null whenever its module-level cosmetics cache hasn't
        // loaded yet. spawnPlayerAvatar's own boot-time call (game.js
        // ~19883) races this function rather than reliably beating it, so
        // this waits on the same shared cache/promise explicitly.
        await window.NpcAvatarPreview.ensurePortraitCosmetics({ assetBase: './assets/', configBase: './config/' });

        const targetScene = sceneForNpcArea(area);
        const targetGrid  = npcGridForArea(area);
        const targetCols  = getActiveCols();
        const targetRows  = getActiveRows();

        // ── Camera: an "establishing" mode for everything except active
        //    dialogue, computed from the Director's captured shot (already
        //    resolved to world tile-space) via the same
        //    distance/angleFromGroundDeg/azimuthDeg basis the real fishing
        //    minigame's camera-mode swap uses (see updateCameraPosition).
        //    Set up before actors spawn (rather than after, from their
        //    entities) so camera.position is already correct in time for
        //    each NPC/player actor's initial spawn facing to check itself
        //    against it (see cutscenePreviewNpcFacingCheatAngle below).
        const baseDlgCfg = cameraModeConfig(cameraConfig().dialogueMode || 'npcDialogue');
        const dlgModeKey = 'cutscenePreviewDialogue';
        (window.SCRATCHBONES_CONFIG.game.camera.modes ||= {})[dlgModeKey] = {
          ...baseDlgCfg,
          // Real gameplay's alignToDialoguePortraitCenters hardcodes the
          // actual player mesh as one of its two framing anchors, which is
          // meaningless here (neither cutscene speaker is ever the real
          // player) — but the alignment itself (an eye-level shot pinned to
          // the speaker's own visual center, not the generic elevated
          // follow-camera's sin(angle)*distance climb above it) is exactly
          // what a cutscene close-up wants too, so this stays on and
          // dialoguePortraitCameraAim substitutes the speaking actor's own
          // center (see cutscenePreviewSpeakerCenterY) instead of playerMesh
          // whenever cutscenePreviewActive is set.
          alignToDialoguePortraitCenters: true,
        };
        // A creature's root position (avatarRef.group) already sits at its
        // own body-center height (see makeCreatureEntity/updateCreatureMesh),
        // unlike an NPC walker's root, which sits at ground level — so the
        // human-chest-height targetYOffsetTiles npcDialogue tunes for
        // overshoots way above a low-slung creature like a wolf. This
        // variant looks only slightly above the creature's own center and
        // sits lower/closer so it still reads as a proper close-up.
        const dlgModeKeyCreature = 'cutscenePreviewDialogueCreature';
        window.SCRATCHBONES_CONFIG.game.camera.modes[dlgModeKeyCreature] = {
          ...baseDlgCfg,
          // Also pinned to the speaker's own center (cameraY/lookY come from
          // dialoguePortraitCameraAim, not targetYOffsetTiles/angle below) —
          // angleFromGroundDeg/distanceTiles still shape the horizontal
          // framing (azimuth distance/height-of-shot feel), just no longer
          // the vertical climb.
          alignToDialoguePortraitCenters: true,
          targetYOffsetTiles: 0.08,
          angleFromGroundDeg: Math.min(baseDlgCfg.angleFromGroundDeg ?? 10.64, 6),
          distanceTiles: (baseDlgCfg.distanceTiles ?? 4.67) * 0.78,
        };

        let idleCameraMode, idleCameraTarget;
        if (payload.camera3d) {
          const p = payload.camera3d.worldPos, t = payload.camera3d.worldTarget;
          const dx = p.x - t.x, dy = p.y - t.y, dz = p.z - t.z;
          const distance = Math.max(0.5, Math.hypot(dx, dy, dz));
          const angleFromGroundDeg = Math.asin(clamp(dy / distance, -1, 1)) * 180 / Math.PI;
          const azimuthDeg = Math.atan2(dx, dz) * 180 / Math.PI;
          const shotModeKey = 'cutscenePreviewShot';
          window.SCRATCHBONES_CONFIG.game.camera.modes[shotModeKey] = { distanceTiles: distance, angleFromGroundDeg, azimuthDeg, fovDeg: 42, followLerp: 1, targetYOffsetTiles: 0 };
          idleCameraMode = shotModeKey;
          idleCameraTarget = { position: new THREE.Vector3(t.x, t.y, t.z) };
          camTargetX = t.x; camTargetY = t.y; camTargetZ = t.z; // instant cut, not a slow lerp in from the farm spawn
        } else {
          const firstActor = (payload.actors || [])[0];
          idleCameraMode = cameraConfig().defaultMode || 'default';
          if (firstActor) {
            const fx = firstActor.worldC + 0.5, fz = firstActor.worldR + 0.5, fy = npcSurfaceY(area, firstActor.worldC, firstActor.worldR);
            idleCameraTarget = { position: new THREE.Vector3(fx, fy, fz) };
            camTargetX = fx; camTargetY = fy; camTargetZ = fz;
          } else {
            idleCameraTarget = null;
          }
        }
        activeCameraMode = idleCameraMode;
        activeCameraTarget = idleCameraTarget;
        updateCameraPosition();

        const entities = new Map(); // actorId -> { kind:'npc'|'creature'|'placeholder', root, ... }
        for (const actor of (payload.actors || [])) {
          let entity = null;
          try {
            if (actor.npcId && actor.npcRecord) {
              const walker = await makeNpcWalker(actor.npcRecord, { area, c: actor.worldC, r: actor.worldR });
              if (walker) {
                walker.rot = THREE.MathUtils.degToRad(actor.rotation || 0); // corrected below once actorStates/applyState exist — see the initial-pose pass before runStage
                walker.root.rotation.y = walker.rot;
                walker.pause = Infinity; // scripted entirely by the director below — never the idle/wander AI
                entity = { kind: 'npc', root: walker.root, walker, rec: actor.npcRecord, profile: walker.profile, avatarFrontCanvas: walker.avatarFrontCanvas, avatarBackCanvas: walker.avatarBackCanvas };
              }
            } else if (actor.creatureTypeId && CREATURE_DB[actor.creatureTypeId]) {
              // makeCreatureEntity's ground-height lookup reads the global
              // `currentArea` directly rather than taking it as an option,
              // so it's bookended here even though currentArea already
              // equals `area` by this point (kept explicit/defensive in
              // case that assignment above ever moves).
              const savedArea = currentArea;
              currentArea = area;
              const creature = makeCreatureEntity(actor.creatureTypeId, (actor.worldC + 0.5) * TILE, (actor.worldR + 0.5) * TILE, { scene: targetScene, grid: targetGrid, cols: targetCols, rows: targetRows });
              currentArea = savedArea;
              if (creature) {
                creature.avatarRef.group.rotation.y = THREE.MathUtils.degToRad(actor.rotation || 0);
                entity = { kind: 'creature', root: creature.avatarRef.group, creature };
              }
            } else if (actor.isPlayer) {
              // The scene's authored stand-in for whoever's actually running
              // this preview — built through the exact same makeNpcWalker
              // pipeline an NPC actor uses, just fed a synthetic "record"
              // sourced from the real player's own appearance instead of the
              // NPC database, so it gets a real PNG-plane avatar instead of
              // the generic placeholder every other freeform actor falls
              // back to.
              const playerProfile = _playerData || window.__hobunjiPlayerProfile;
              const fakeRec = {
                id: 'player', name: actor.name || 'Player',
                appearance: playerProfile?.appearance,
                equippedCosmetics: playerProfile?.equippedCosmetics || [],
                appliedDyes: playerProfile?.appliedDyes || {},
              };
              const walker = await makeNpcWalker(fakeRec, { area, c: actor.worldC, r: actor.worldR });
              if (walker) {
                walker.rot = THREE.MathUtils.degToRad(actor.rotation || 0); // corrected below once actorStates/applyState exist — see the initial-pose pass before runStage
                walker.root.rotation.y = walker.rot;
                walker.pause = Infinity;
                entity = { kind: 'npc', root: walker.root, walker, rec: fakeRec, profile: walker.profile, avatarFrontCanvas: walker.avatarFrontCanvas, avatarBackCanvas: walker.avatarBackCanvas };
              }
            }
          } catch (e) { console.error('[cutscene preview] actor spawn failed for', actor.name, e); }
          if (!entity) entity = cutscenePreviewMakePlaceholder(actor, area, targetScene);
          entities.set(actor.id, entity);
        }

        // ── Stage engine ──────────────────────────────────────────────
        // Same move/talk/choice/animation/turn/combat/fade semantics as
        // docs/tools/cutscene-director/index.html's own preview engine
        // (ported, not shared code — that tool drives a private Three.js
        // scene, this drives real spawned entities + the real dialogue UI),
        // reading a payload the Director tool has already fully resolved
        // to world tile coordinates (see its "Preview in game" handler).
        const actorsById  = new Map((payload.actors || []).map(a => [a.id, a]));
        // Authored rotation, used exactly as given — no camera-visibility
        // biasing. This is the single source of truth for every actor's
        // rotation from here on, kept in sync with the mesh only through
        // applyState, so it can't drift out of sync with what's actually on
        // screen the way computing it twice would.
        const actorStates = new Map((payload.actors || []).map(a =>
          [a.id, { c: a.worldC, r: a.worldR, rotation: a.rotation || 0, pose: a.pose || 'standing', combatOn: false, canLose: false }]
        ));
        // actorId -> desired facing in degrees: what each actor is currently
        // trying to face (set at spawn from its raw authored rotation, and
        // whenever a Turn card or a move's arrival facing gives it a new
        // one). cutsceneRotationTick (below) is the only thing that ever
        // turns this into an actual mesh rotation, continuously, for the
        // actor's entire time on screen — mirroring how real gameplay never
        // snaps a stationary NPC/creature's facing in one frame either (see
        // faceNpcDialogueParticipants's npcFacePlayerLerp, updateHostiles/
        // updateCompanions calling updateCreatureMesh every frame whether a
        // creature is moving or holding still) — rather than a fixed-
        // duration one-shot "turn card" animation that stops driving once
        // its own timer runs out.
        const desiredFacingDeg = new Map((payload.actors || []).map(a => [a.id, a.rotation || 0]));
        // actorIds currently owning their own rotation each frame — a Move
        // stage's own per-frame stepper (walker.moveToward's perpClamp, or
        // updateCreatureMesh driven by live travel direction), or a Combat
        // stage's real hostileObjects/companionObjects AI (updateHostiles/
        // updateCompanions, which also call updateCreatureMesh themselves
        // with their own chase-target aimAngle). cutsceneRotationTick skips
        // anyone in here so it never fights whatever's actively driving them.
        const externallyDrivenActorIds = new Set();
        const stagesById  = new Map((payload.stages || []).map(s => [s.id, s]));
        const stageOrder  = (payload.stages || []).map(s => s.id);
        let running = true;

        const getResolvedNext = (stageId, requestedNext) => {
          if (requestedNext === '__end__') return null;
          if (requestedNext && requestedNext !== '__next__') return stagesById.has(requestedNext) ? requestedNext : null;
          return stageOrder[stageOrder.indexOf(stageId) + 1] || null;
        };
        const angleTowardState = cutscenePreviewAngleToward;
        const buildGridPath = (start, goal) => {
          const path = [{ c: start.c, r: start.r }];
          let c = start.c, r = start.r, horizontalTurn = true;
          while (c !== goal.c || r !== goal.r) {
            const canH = c !== goal.c, canV = r !== goal.r;
            if ((horizontalTurn && canH) || !canV) c += Math.sign(goal.c - c); else r += Math.sign(goal.r - r);
            path.push({ c, r });
            horizontalTurn = !horizontalTurn;
          }
          return path;
        };
        const applyState = actorId => { const entity = entities.get(actorId), st = actorStates.get(actorId); if (entity && st) cutscenePreviewApplyState(entity, area, st); };

        // Per-frame travel toward a tile-center target, reusing the real
        // game's own locomotion instead of the discrete grid-hop stepping
        // this used to do: an NPC actor rides the exact same
        // walker.moveToward() the schedule system drives real villagers
        // with, and a creature actor rides moveCreatureToward() +
        // updateCreatureMesh()/updateCreatureAnimFrame() — the same trio
        // updateHostiles() drives wild creatures with. A freeform/failed-
        // spawn placeholder actor has no real system to borrow, so it gets
        // an honest straight-line lerp (same degrade-gracefully policy as
        // cutscenePreviewMakePlaceholder itself). Returns true once arrived.
        const advanceActorToward = (actorId, tx, tz, dt, speedMul = 1) => {
          const entity = entities.get(actorId), st = actorStates.get(actorId);
          if (!entity || !st) return true;
          if (entity.kind === 'npc' && entity.walker) {
            entity.walker.catchup = speedMul; // preview-scripted walkers are never schedule-driven, so catchup is free to repurpose as a speed dial
            const arrived = entity.walker.moveToward(tx, tz, dt);
            st.c = entity.root.position.x - 0.5;
            st.r = entity.root.position.z - 0.5;
            st.rotation = THREE.MathUtils.radToDeg(entity.walker.rot);
            return arrived;
          }
          if (entity.kind === 'creature' && entity.creature) {
            const c = entity.creature;
            const speed = (c.def.moveSpeed || 2.4) * speedMul;
            const moving = moveCreatureToward(c, tx * TILE, tz * TILE, speed, dt);
            const dist = Math.hypot(c.x - tx * TILE, c.y - tz * TILE);
            const aimAngle = moving ? Math.atan2(tz * TILE - c.y, tx * TILE - c.x) : c.facing;
            c.facing = aimAngle;
            updateCreatureMesh(c, dt, aimAngle);
            updateCreatureAnimFrame(c, dt, moving);
            st.c = c.x / TILE - 0.5;
            st.r = c.y / TILE - 0.5;
            // st.rotation is the "direct model Y-rotation" convention every
            // other creature rotation path uses (Turn cards, spawn, the
            // tool's own gizmo/preview) — NOT aimAngle's raw world-direction
            // convention (updateCreatureMesh internally maps aimAngle to
            // groupRot via rawTargetRotY = -(aimAngle) + PI/2, a reflected,
            // *not* simply offset, relationship). Reading it back from the
            // mesh's actual resulting groupRot keeps it consistent so
            // cutsceneRotationTick's post-arrival fallback (when a move has
            // no authored arrival facing) picks up from the true current
            // facing instead of a rotation the creature never actually had.
            st.rotation = ((THREE.MathUtils.radToDeg(c.groupRot) % 360) + 360) % 360;
            return dist < TILE * 0.12;
          }
          const previous = { c: st.c, r: st.r };
          const dx = tx - 0.5 - st.c, dz = tz - 0.5 - st.r;
          const d = Math.hypot(dx, dz);
          const step = Math.max(0.001, 1.6 * speedMul * dt);
          if (d <= step) { st.c = tx - 0.5; st.r = tz - 0.5; } else { st.c += dx / d * step; st.r += dz / d * step; }
          if (d > 0.001) st.rotation = angleTowardState(previous, st);
          applyState(actorId);
          return d <= step;
        };

        const finish = message => {
          running = false;
          cutscenePreviewActive = false;
          cutscenePreviewZoomPercent = 100; // never leak an authored zoom into normal gameplay afterward
          cutscenePreviewDialogueSpeaker = null;
          enterDefaultCameraMode();
          activeCameraTarget = null;
          cutscenePreviewBanner(message || `🎬 ${payload.title || 'Cutscene'} — finished.`, false);
        };

        async function openLine(entity, speakerName, text) {
          dialogueOpen = true;
          _dialogueWalker = entity?.kind === 'npc' ? { root: entity.root, rec: entity.rec, profile: entity.profile, avatarFrontCanvas: entity.avatarFrontCanvas } : null;
          cutscenePreviewDialogueSpeaker = entity || null;
          activeCameraMode = entity?.kind === 'creature' ? dlgModeKeyCreature : dlgModeKey;
          activeCameraTarget = { position: (entity || entities.values().next().value)?.root.position || new THREE.Vector3() };
          _npcDialogueNameEl.textContent = speakerName;
          if (_npcDialogueHeartsEl) _npcDialogueHeartsEl.textContent = '';
          _arcContainerEl?.classList.add('arc-hidden');
          const ctx = _npcPortraitCanvas.getContext('2d');
          if (_dialogueWalker?.profile && window.NpcAvatarPreview) {
            ctx.fillStyle = '#1b3529'; ctx.fillRect(0, 0, _npcPortraitCanvas.width, _npcPortraitCanvas.height);
            await window.DialogueContent?.renderNpcDialoguePortrait();
          } else {
            ctx.clearRect(0, 0, _npcPortraitCanvas.width, _npcPortraitCanvas.height);
          }
          _npcDialogueEl.classList.add('open');
          _npcDialogueEl.setAttribute('aria-hidden', 'false');
          window.DialogueContent?.hideChoiceButtons();
          window.DialogueContent?.setNpcDialogueText(text);
        }

        function closeLine() {
          dialogueOpen = false;
          cutscenePreviewAdvance = null;
          window.DialogueContent?.hideChoiceButtons();
          window.portraitBreathingComposer?.clearExpression(window.DialogueContent?.dialogueSeatId());
          window.portraitBreathingComposer?.setDefaultExpression(window.DialogueContent?.dialogueSeatId(), null);
          _dialogueWalker = null;
          cutscenePreviewDialogueSpeaker = null;
          _npcDialogueEl.classList.remove('open');
          _npcDialogueEl.setAttribute('aria-hidden', 'true');
          _arcContainerEl?.classList.remove('arc-hidden');
          activeCameraMode = idleCameraMode;
          activeCameraTarget = idleCameraTarget;
        }

        function showChoiceOptions(options) {
          const optEls = [1, 2, 3, 4, 5, 6].map(i => document.getElementById(`dlgOpt${i}`));
          optEls.forEach(el => { if (!el) return; const label = el.querySelector('.dlg-opt-label'); if (label) { label.textContent = ''; label.style.fontSize = ''; } el.classList.remove('dlg-opt-visible'); el.onclick = null; });
          options.slice(0, 6).forEach((opt, i) => {
            const el = optEls[i]; if (!el) return;
            const label = el.querySelector('.dlg-opt-label'); if (label) label.textContent = opt.text || 'Choice';
            el.classList.add('dlg-opt-visible');
            el.onclick = () => { if (!dialogueOpen) return; opt.onClick(); };
          });
          optEls.forEach(el => { if (el && el.classList.contains('dlg-opt-visible')) window.DialogueContent?.fitDlgOptionLabel(el); });
          const continueBtn = document.getElementById('npcDialogueContinue');
          if (continueBtn) continueBtn.style.display = options.length ? 'none' : '';
        }

        function continueTo(nextId) {
          if (!running) return;
          if (dialogueOpen) closeLine();
          if (!nextId) { finish(); return; }
          runStage(nextId);
        }

        function runStage(stageId) {
          if (!running) return;
          const stage = stagesById.get(stageId);
          if (!stage) { finish('Preview stopped — the next card could not be found.'); return; }
          cutscenePreviewBanner(`🎬 ${payload.title || 'Cutscene'} — ${stage.type}`, false);

          if (stage.type === 'move') return runMove(stage);
          if (stage.type === 'animation') return runAnimation(stage);
          if (stage.type === 'turn') return runTurn(stage);
          if (stage.type === 'combat') return runCombat(stage);
          if (stage.type === 'fade') return runFade(stage);
          if (stage.type === 'zoom') return runZoom(stage);

          const speakerActor  = actorsById.get(stage.speakerId);
          const speakerEntity = entities.get(stage.speakerId);
          const speakerName   = speakerActor?.name || 'Someone';
          if (!speakerEntity) { continueTo(getResolvedNext(stage.id, stage.next)); return; }
          if (stage.type === 'choice') {
            openLine(speakerEntity, speakerName, stage.text).then(() => {
              showChoiceOptions((stage.options || []).map(o => ({ text: o.text, onClick: () => continueTo(getResolvedNext(stage.id, o.next)) })));
            });
            cutscenePreviewAdvance = () => {}; // choices only ever advance via their own button
            return;
          }
          openLine(speakerEntity, speakerName, stage.text);
          cutscenePreviewAdvance = () => continueTo(getResolvedNext(stage.id, stage.next));
        }

        function runMove(stage) {
          const st = actorStates.get(stage.actorId);
          const goal = stage.targetWorld;
          if (!st || !goal) { continueTo(getResolvedNext(stage.id, stage.next)); return; }
          const speedMul = stage.speed === 'slow' ? 0.6 : stage.speed === 'fast' ? 1.85 : 1;
          const waitForArrival = stage.waitForArrival !== false;
          const tx = goal.c + 0.5, tz = goal.r + 0.5;
          let lastT = performance.now();
          let arrivedAlready = false;
          externallyDrivenActorIds.add(stage.actorId); // advanceActorToward below owns rotation until arrival
          const onArrive = () => {
            if (arrivedAlready) return;
            arrivedAlready = true;
            externallyDrivenActorIds.delete(stage.actorId);
            // advanceActorToward's own "arrived" gate (TILE*0.12) is looser
            // than moveCreatureToward's internal one (a flat 1px), so the
            // loop above can exit here while the creature was still just
            // inside that inner threshold on its very last step — i.e.
            // still mid-run-cycle sprite (updateCreatureAnimFrame's
            // `moving` was still true that frame). cutsceneRotationTick
            // (below) picks up idle framing on its very next tick once this
            // actor is out of externallyDrivenActorIds, so no explicit
            // cleanup call is needed here for that.
            //
            // The target point's own authored arrival facing (if any) wins
            // over whatever direction the walk itself left the actor facing
            // — same as a "Turn in place" card, just triggered by landing on
            // this point. Handed to cutsceneRotationTick as this actor's new
            // desired facing (no arrival facing at all just keeps whatever
            // direction the walk left it facing, exactly like real NPC/
            // creature movement does) — never blocks the scene on it, the
            // actor keeps turning in the background while the next card
            // starts.
            desiredFacingDeg.set(stage.actorId, goal.facing != null ? goal.facing : st.rotation);
            if (waitForArrival) continueTo(getResolvedNext(stage.id, stage.next));
          };
          const step = () => {
            if (!running) return;
            const now = performance.now();
            const dt = Math.min(0.05, (now - lastT) / 1000);
            lastT = now;
            const arrived = advanceActorToward(stage.actorId, tx, tz, dt, speedMul);
            if (arrived) { onArrive(); return; }
            requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
          // Unchecked in the Director ("Wait for arrival before continuing")
          // — start the next card immediately while this actor keeps
          // walking toward its target in the background (the loop above
          // still runs, gated on the same `running` flag a blocking move
          // uses, so stopping the preview cancels it identically), so
          // several actors can be sent off at once instead of one at a time.
          if (!waitForArrival) continueTo(getResolvedNext(stage.id, stage.next));
        }

        function runAnimation(stage) {
          const st = actorStates.get(stage.actorId);
          const entity = entities.get(stage.actorId);
          if (!st || !entity) { continueTo(getResolvedNext(stage.id, stage.next)); return; }
          const composer = window.portraitBreathingComposer;
          let breathTimer = null;
          if (stage.animKind === 'emote' && entity.kind === 'npc' && entity.profile && composer) composer.triggerEmote(stage.emoteName);
          if ((stage.animKind === 'breathing' || stage.animKind === 'emote') && entity.kind === 'npc' && entity.profile && composer && window.NpcAvatarPreview && window.PNGPlaneAvatar) {
            breathTimer = setInterval(async () => {
              if (!running) { clearInterval(breathTimer); return; }
              try {
                await window.NpcAvatarPreview.renderProfileToCanvas(entity.avatarFrontCanvas, entity.profile, { breathingComposer: composer });
                window.PNGPlaneAvatar.refreshSinglePlaneAvatarModel(entity.walker.avatarGroup, entity.avatarFrontCanvas);
              } catch (e) {}
            }, 120);
          }
          setTimeout(() => {
            if (!running) return;
            if (breathTimer) clearInterval(breathTimer);
            if (stage.resultPose !== 'unchanged') st.pose = stage.resultPose;
            applyState(stage.actorId);
            continueTo(getResolvedNext(stage.id, stage.next));
          }, (stage.duration || 0) * 1000);
        }

        // A Turn card just hands cutsceneRotationTick (below) a new desired
        // facing — the continuous per-frame ticker is what actually eases
        // the actor's rotation toward it, exactly like a stationary real
        // NPC/creature turning to face something (no instant snap). The
        // card's own duration is a pacing beat for the scene (when the next
        // card starts), not a literal "wait until the turn finishes" gate —
        // same as it was before.
        function runTurn(stage) {
          const st = actorStates.get(stage.actorId);
          if (!st) { continueTo(getResolvedNext(stage.id, stage.next)); return; }
          let targetDeg = st.rotation;
          if (stage.mode === 'actor') {
            const targetSt = actorStates.get(stage.targetActorId);
            if (targetSt) targetDeg = angleTowardState(st, targetSt);
          } else {
            targetDeg = ((Math.round(stage.angle) % 360) + 360) % 360;
          }
          desiredFacingDeg.set(stage.actorId, targetDeg);
          setTimeout(() => continueTo(getResolvedNext(stage.id, stage.next)), (stage.duration || 0) * 1000);
        }

        // Live creature-vs-creature AI, identical in spirit to the Cutscene
        // Director tool's own combat-card simulation: a creature-linked,
        // teamed participant chases the nearest Combat On participant on a
        // different team within the real CREATURE_DB aggro range, and
        // attacks (cooldown-gated pulse) once within attack range. Same
        // team or no team = never a threat. Non-creature participants (a
        // person NPC ever marked Combat On) are left stationary.
        function runCombat(stage) {
          stage.participants.forEach(p => { const st = actorStates.get(p.actorId); if (st) { st.combatOn = p.combatOn; st.canLose = p.canLose; } });

          // Real hostile/companion AI, not a bespoke simulation: a hostile
          // species (CREATURE_DB[...].hostile === true, e.g. gar-wolf) is
          // added to the real hostileObjects Set and driven by the exact
          // same updateHostiles() wild creatures chase/attack the player
          // with. A non-hostile species (e.g. dabinggi-hound) is added to
          // the real companionObjects Set and driven by updateCompanions()
          // — the same "defend whoever's nearest hostileObjects to its
          // master" AI a whistle-summoned companion uses, explicitly pointed
          // at the real player via c.master (see the `master` field on
          // makeCreatureEntity — a future authored master besides the
          // player would just need this line to pick a different entity).
          // Both are already ticked every frame by the main game loop, so
          // nothing here drives them by hand; this only registers/
          // unregisters them and parks the real player.x/y at the scene's
          // Player actor so that targeting resolves against the right spot
          // instead of wherever the real player last stood.
          const combatOnIds = stage.participants.filter(p => p.combatOn).map(p => p.actorId)
            .filter(id => { const a = actorsById.get(id); return a && a.creatureTypeId && CREATURE_DB[a.creatureTypeId]; });

          const playerActor = (payload.actors || []).find(a => a.isPlayer);
          const playerSt = playerActor ? actorStates.get(playerActor.id) : null;
          const savedPlayerX = player.x, savedPlayerY = player.y;
          if (playerSt) { player.x = (playerSt.c + 0.5) * TILE; player.y = (playerSt.r + 0.5) * TILE; }

          const registered = [];
          for (const actorId of combatOnIds) {
            const entity = entities.get(actorId);
            if (!entity || entity.kind !== 'creature') continue;
            const c = entity.creature;
            c.state = 'idle';
            externallyDrivenActorIds.add(actorId); // updateHostiles/updateCompanions own this creature's rotation now
            if (c.def.hostile) {
              c.homeX = c.x; c.homeY = c.y;
              hostileObjects.add(c);
              registered.push({ c, set: hostileObjects });
            } else {
              c.isCompanion = true;
              c.master = player;
              companionObjects.add(c);
              registered.push({ c, set: companionObjects });
            }
          }

          setTimeout(() => {
            for (const { c, set } of registered) { set.delete(c); if (set === companionObjects) c.master = null; }
            player.x = savedPlayerX; player.y = savedPlayerY;
            if (!running) return;
            // Sync each combatant's authored-coordinate state from wherever
            // the real AI actually left it, so the next stage (a Settle/Flee
            // move) starts from its true position instead of snapping back
            // to its pre-combat spawn point. Same for rotation/desired
            // facing — handing cutsceneRotationTick back control (it resumes
            // next frame, now that this actorId is out of
            // externallyDrivenActorIds) with the wrong desired facing would
            // yank the creature toward its old pre-combat target the instant
            // combat ends.
            for (const actorId of combatOnIds) {
              const entity = entities.get(actorId), st = actorStates.get(actorId);
              externallyDrivenActorIds.delete(actorId);
              if (entity?.kind === 'creature' && st) {
                st.c = entity.creature.x / TILE - 0.5; st.r = entity.creature.y / TILE - 0.5;
                st.rotation = THREE.MathUtils.radToDeg(entity.creature.groupRot);
                desiredFacingDeg.set(actorId, st.rotation);
              }
            }
            stage.participants.forEach(p => { const st = actorStates.get(p.actorId); if (st) st.combatOn = false; });
            const canLose = stage.participants.some(p => p.combatOn && p.canLose);
            if (!canLose) { continueTo(getResolvedNext(stage.id, stage.next)); return; }
            const anyEntity = entities.get(stage.participants[0]?.actorId);
            openLine(anyEntity, 'Combat result', 'A character marked Can Lose may use the separate loss branch.').then(() => {
              showChoiceOptions([
                { text: 'No loss', onClick: () => continueTo(getResolvedNext(stage.id, stage.next)) },
                { text: 'Loss happens', onClick: () => continueTo(getResolvedNext(stage.id, stage.lossNext)) },
              ]);
            });
            cutscenePreviewAdvance = () => {};
          }, (stage.duration || 0) * 1000);
        }

        function runFade(stage) {
          const fadeEl = cutscenePreviewFadeEl();
          const targetOpacity = stage.direction === 'out' ? 1 : 0;
          fadeEl.style.transitionDuration = `${stage.duration || 0}s`;
          requestAnimationFrame(() => { fadeEl.style.opacity = String(targetOpacity); });
          setTimeout(() => continueTo(getResolvedNext(stage.id, stage.next)), (stage.duration || 0) * 1000);
        }

        // Smoothly lerps cutscenePreviewZoomPercent (100 = the captured
        // shot's own unmodified framing, higher = closer — see
        // updateCameraPosition's cutsceneZoomMul) from wherever it currently
        // sits to stage.percent over stage.duration seconds, driving the
        // camera every frame along the way rather than a single instant cut.
        function runZoom(stage) {
          const fromPercent = cutscenePreviewZoomPercent;
          const toPercent = Math.max(10, Number(stage.percent) || 100);
          const durationMs = Math.max(0, (stage.duration ?? 0.6) * 1000);
          const start = performance.now();
          const step = () => {
            if (!running) return;
            const t = durationMs <= 0 ? 1 : Math.min(1, (performance.now() - start) / durationMs);
            cutscenePreviewZoomPercent = fromPercent + (toPercent - fromPercent) * t;
            updateCameraPosition();
            if (t < 1) requestAnimationFrame(step);
            else continueTo(getResolvedNext(stage.id, stage.next));
          };
          step();
        }

        // Actors otherwise only get their state (position, and any starting
        // pose like Prone) pushed onto their mesh the first time some stage
        // happens to touch them — an actor a scene never moves or animates
        // would sit at its raw spawn transform forever. Every actor's
        // initial authored state is applied once, up front, so a resting
        // Prone/rotation reads correctly from frame one (and so a
        // creature's groupRot/pngRot are seeded to match before
        // cutsceneRotationTick's first real tick below).
        for (const actorId of actorStates.keys()) applyState(actorId);

        // Continuously eases every actor's rotation toward desiredFacingDeg
        // (set at spawn from its raw authored rotation, and updated by a
        // Turn card or a move's arrival facing), every frame, for the
        // actor's entire time in the scene — not a fixed-duration one-shot
        // animation that stops driving once a card's own timer runs out.
        // Skips anyone in externallyDrivenActorIds: a Move stage's own
        // stepper (walker.moveToward's perpClamp, or updateCreatureMesh
        // driven by live travel direction) or a Combat stage's real
        // hostileObjects/companionObjects AI already owns their rotation
        // that frame.
        let cutsceneRotLastT = performance.now();
        function cutsceneRotationTick() {
          if (!running) return;
          const now = performance.now();
          const dt = Math.min(0.05, (now - cutsceneRotLastT) / 1000);
          cutsceneRotLastT = now;
          for (const [actorId, st] of actorStates) {
            if (externallyDrivenActorIds.has(actorId)) continue;
            const entity = entities.get(actorId);
            if (!entity) continue;
            const targetDeg = desiredFacingDeg.get(actorId) ?? st.rotation;
            if (entity.kind === 'creature' && entity.creature) {
              // The exact same function real wild/companion creatures are
              // driven through every frame whether moving or holding still
              // (see updateHostiles/updateCompanions): groupRot eases
              // toward the raw target with no dead zone of its own, while
              // the crossed-plane sprite gets its own separate perpClamp
              // dead zone (cameraRelativeCreaturePerps/CREATURE_PERP_DEAD_
              // RAD) internally so it never goes edge-on.
              //
              // updateCreatureMesh's own aimAngle parameter is a raw
              // world-direction angle, converted internally via
              // rawTargetRotY = -(aimAngle) + PI/2 — a reflected relationship
              // with groupRot, not a simple additive offset. targetDeg here
              // is in the "direct model Y-rotation" convention every other
              // creature rotation path uses instead (Turn cards, spawn, the
              // tool's own gizmo/preview), so it has to go through the
              // inverse of that same mapping (creatureAimAngleForGroupRot)
              // to land groupRot on the actual authored angle rather than
              // its mirror.
              updateCreatureMesh(entity.creature, dt, creatureAimAngleForGroupRot(THREE.MathUtils.degToRad(targetDeg)));
              updateCreatureAnimFrame(entity.creature, dt, false);
              st.rotation = THREE.MathUtils.radToDeg(entity.creature.groupRot);
            } else {
              // NPC/player/placeholder: the same idle "face player" ease
              // real stationary NPCs use (see faceNpcDialogueParticipants's
              // npcFacePlayerLerp) — a flat coin-plane avatar has no edge-on
              // issue to dead-zone against, so there's nothing else this
              // needs to run through.
              const cfg = npcDialogueStagingConfig();
              const current = THREE.MathUtils.degToRad(st.rotation);
              const next = current + angleDiff(THREE.MathUtils.degToRad(targetDeg), current) * (cfg.npcFacePlayerLerp ?? 0.28);
              st.rotation = THREE.MathUtils.radToDeg(next);
              applyState(actorId);
            }
          }
          requestAnimationFrame(cutsceneRotationTick);
        }
        cutsceneRotationTick();

        if (!stageOrder.length) { finish('Preview stopped — this scene has no cards.'); return; }
        cutscenePreviewBanner(`🎬 ${payload.title || 'Cutscene Preview'}`, false);
        runStage(stageOrder[0]);
      }

      if (window.__hobunjiCutscenePreview) {
        runCutscenePreview(window.__hobunjiCutscenePreview).catch(err => {
          console.error('[cutscene preview] failed to start:', err);
          cutscenePreviewActive = false;
          cutscenePreviewBanner('Preview failed to start — see console.', true);
        });
      }

      requestAnimationFrame(gameLoop);
    })();
