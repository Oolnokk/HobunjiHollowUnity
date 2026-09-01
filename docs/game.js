    (() => {
      'use strict';

      // Gameplay-affecting randomness (creature AI decisions, pack spawns,
      // loot rolls) goes through this seedable source instead of raw
      // Math.random() ‚Äî see the window.GameRandom definition in
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
      // Calendar (lives in the menu's Calendar tab ‚Äî see #mpCalendar)
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
      const spGoldAmount = document.getElementById('spGoldAmount');
      const spItem    = document.getElementById('spItem');
      const spItemDiv = document.getElementById('spItemDiv');

      // Menu
      const menuBtn        = document.getElementById('menuBtn');
      const menuBackdrop   = document.getElementById('menuBackdrop');
      const menuPanel      = document.getElementById('menuPanel');
      // Legacy compat arrays ‚Äî empty since old .menu-tab/.menu-page elements removed
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
      // actionRows removed ‚Äî refreshActionBar now targets fixed #btnActionN elements

      // Item scroll
      const itemPrev   = document.getElementById('itemPrev');
      const itemNext   = document.getElementById('itemNext');
      const itemIcon   = document.getElementById('itemIcon');
      const itemName   = document.getElementById('itemName');
      const itemCount  = document.getElementById('itemCount');
      const itemBtnEl  = document.getElementById('itemBtn');
      const isPrevIconEl = document.getElementById('isPrevIcon');
      const isNextIconEl = document.getElementById('isNextIcon');


      // ‚îÄ‚îÄ Split layout fit ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ
      // Computes the centered 16:9 UI rect for menus/HUD scale, while letting
      // the Three.js view fill the whole screen horizontally on wide displays.
      // Gameplay edge anchors are used below by controls that should spread to thumbs/screen edges.
      function fitToAspect() {
        const W = window.innerWidth, H = window.innerHeight;
        const R = 16 / 9;
        let gw, gh, ox, oy;
        const isWide = W / H > R;
        if (isWide) {
          // Wider than 16:9 ‚Üí keep UI/menu scale centered, but do not pillarbox the 3D view.
          gh = H;           gw = Math.round(H * R);
          oy = 0;           ox = Math.round((W - gw) / 2);
        } else {
          // Taller/narrower than 16:9 ‚Üí current behavior: 16:9 game and UI rect letterboxed vertically.
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

      // ‚îÄ‚îÄ Menu open/close ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ
      let menuOpen = false;
      function openMenu(targetPanel = 'inventory') {
        menuOpen = true;
        // Release shoulder-surf's Pointer Lock (see requestShoulderSurfPointerLock
        // below) so the cursor is free to click around the menu ‚Äî it isn't
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
        // corner the open menu panel covers ‚Äî hide it immediately rather
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

      // ‚îÄ‚îÄ New panel tab switching ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ

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
      // Debug log copy-to-clipboard button ‚Äî copies whichever of the Log/
      // Pixel Probe views is currently showing (see _setDebugView below).
      const _dbgCopy = document.getElementById('debugCopyBtn');
      if (_dbgCopy) _dbgCopy.addEventListener('click', () => {
        if (document.getElementById('debugViewProbeBtn')?.classList.contains('active')) window.PixelProbe?.copyPixelProbeResult();
        else copyDebugLog();
      });
      // Debug log filter tabs ‚Äî filtering itself lives in debug.js's
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
      // (window.PixelProbe) ‚Äî see window.PixelProbe.init(...) below.

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

      // ‚îÄ‚îÄ Legend + old legend toggle removed ‚Äî handled by menu now
      // ‚îÄ‚îÄ Toast ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ
      let _toastTimer = null;
      // `silent` skips the "can't do that" error chime while still showing
      // the visual toast ‚Äî used by per-swing combat hit/miss results (combo/
      // quick attacks/Charged Breaker/basic weapon tap), which fire on
      // *every* attack and already have their own dedicated combat sfx
      // (weaponSlash/creatureClawHit).
      //
      // Deliberately no sound on ok===true here: a ding on every successful
      // action (dig, till, plant, harvest, process...) was just noise that
      // meant "you pressed something and it worked" ‚Äî no actual information
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
      // in js/audio-system.js (window.AudioSystem) ‚Äî see
      // window.AudioSystem.init(...) below for the wiring.

      // NPC dialogue CONTENT (text/token resolution, tree/pool selection,
      // typewriter, portrait rendering, choice buttons) now lives in
      // js/dialogue-content.js (window.DialogueContent) ‚Äî see
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

        // Task turn-in ‚Äî checked before everything else (including a fresh
        // request/favor ask): if this NPC posted/asked a quest that's now
        // sitting ready in the player's log, offer to hand it over right
        // here rather than piling a new ask on top of an already-completed
        // one.
        const _turnInTask = rec?.id ? window.ProceduralTasks.getTurnInReadyTaskForNpc(rec.id) : null;
        if (_turnInTask) {
          const _turnInLabel = _turnInTask.items.map(it => `${ITEM_DEFS[it.itemKey]?.label || it.itemKey} √ó${it.qty}`).join(', ');
          window.DialogueContent?.beginSyntheticChoice(rec);
          window.DialogueContent?.renderDlgNode({
            type: 'choice',
            text: `Ah ‚Äî did you bring what I asked for?`,
            choices: [
              { label: `Here's your ${_turnInLabel}.`, actions: [{ type: 'turnInTask', taskId: _turnInTask.id }] },
              { label: 'Not yet.', actions: [] },
            ],
          });
          return;
        }

        // Named quest-givers ‚Äî replaces the old bulletin board. Once a
        // request has been announced (see ProceduralTasks.
        // maybeRefreshRequestPostings, and the purple ambient greeting/
        // compass '!' that flags it before this point), the first
        // conversation after that proposes the job in the NPC's own voice.
        // Checked ahead of the generic favor ask below since a named
        // quest-giver's own request always takes priority over a random
        // favor roll.
        const _requestOffer = rec?.id ? await window.ProceduralTasks.maybeProposeRequest(rec) : null;
        if (_requestOffer) {
          window.DialogueContent?.beginSyntheticChoice(rec);
          window.DialogueContent?.renderDlgNode({
            type: 'choice',
            text: _requestOffer.askText,
            choices: [
              { label: "I'll help.", actions: [{ type: 'acceptRequest', taskId: _requestOffer.task.id }] },
              { label: 'Not right now.', actions: [{ type: 'declineRequest', taskId: _requestOffer.task.id }] },
            ],
          });
          return;
        }

        // Trusted-NPC favors ‚Äî checked ahead of every other fast-path
        // (including the merchant shop shortcuts below, so shopkeepers can
        // ask for favors too, not just villagers with an authored dialogue
        // tree) whenever the NPC currently has, or freshly rolls, a favor to
        // ask ‚Äî gated by friendship tier. Same synthetic choice-node
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
        // when the NPC happens to be caught right at their counter ‚Äî a
        // quicker single-tap route to the shop than navigating their own
        // dialogue tree. They are NOT the reliable path: that fast-path
        // condition (idle, exact station, label match) is easy to miss if
        // the NPC has stepped away or is mid-transition, which is why every
        // shopkeeper below also gets a real "openShop" choice baked into
        // their own dialogueTrees ‚Äî reachable through ordinary conversation
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

        // Jubmir the traveling trader ‚Äî unlike the General Store/Carpenter,
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
          // Resume at the normal schedule speed. Dialogue must not create a
          // temporary catch-up sprint for an NPC who was already in transit.
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

      // ‚îÄ‚îÄ Tile / crop enums (must come first ‚Äî referenced by everything below) ‚îÄ‚îÄ
      const TileType = Object.freeze({
        GRASS: 'grass', WEEDS: 'weeds', TILLED: 'tilled',
        TRENCH: 'trench', RAISED: 'raised', PADDY: 'paddy',
        ROCK: 'rock', SHRUB: 'shrub', PATH: 'path',
        RIVER: 'river', STREAM: 'stream', RAMP: 'ramp', WATERFALL: 'waterfall'
      });
      // Tile types whose own heightfield (buildTerrainTileGeo) carves a depression
      // or rise into the ground ‚Äî a plateau mesa's flat lid/skin must never also
      // render a quad over one of these, or the carved bed renders buried under it.
      const CARVED_TILE_TYPES = new Set([TileType.RIVER, TileType.STREAM, TileType.WATERFALL, TileType.TRENCH, TileType.RAISED]);
      // river/stream/waterfall are one continuous waterway ‚Äî a cell of one type
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

      // ‚îÄ‚îÄ World / physics constants ‚îÄ‚îÄ
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
      // that character's own max) ‚Äî each call site lerps between the two by
      // its own effort ratio rather than using a flat distance. Kept subtle
      // so the procedural feet carry the gait without making the whole body
      // visibly bounce at ordinary walking speed.
      const MOVE_BOB_WALK_AMP = 0.0075;
      const MOVE_BOB_RUN_AMP  = 0.015;
      const ACCEL         = 980;  // px/s¬≤; used by updateMovement() for snappier starts.
      const TURN_ACCEL    = 1320; // px/s¬≤; used when input reverses or sharply turns.
      const DECEL         = 1850; // px/s¬≤; used by updateMovement() to avoid floaty stops.
      const CARDINAL_BIAS = 0.18; // used by updateMovement(); lower keeps diagonals less sticky.
      const JOYSTICK_RADIUS = 56; // Fallback radius; updateJoystick() scales to the current viewport-anchored joystick size.
      const JOYSTICK_DEADZONE = 0.14; // used by updateJoystick() to prevent thumb drift near center.
      const JOYSTICK_RESPONSE = 0.82; // used by updateJoystick() to make small thumb motion feel responsive.
      // Floating camera-look joystick (materializes under the thumb on a
      // right-half touch ‚Äî see cameraDragRequested/updateCameraJoystick).
      // Same deadzone/response shape as the movement joystick, but the knob
      // offset drives an ongoing turn RATE for as long as it's held off
      // center, instead of the movement stick's instantaneous speed/direction.
      const CAMERA_JOYSTICK_RADIUS = 56;
      const CAMERA_JOYSTICK_DEADZONE = 0.14;
      const CAMERA_JOYSTICK_RESPONSE = 0.82;
      const CAMERA_JOYSTICK_DEG_PER_SEC = 150; // turn rate at full deflection
      const ACTION_FX_LIMIT = 90; // used by spawnActionParticles()/updateActionParticles() to cap mobile effects.
      const FLOW_SOURCE_ROW = 0;
      const DAY_LENGTH_SECONDS = 288; // 4x the original 72s ‚Äî time now runs at 25% speed
      const MORNING_HOUR = 6;
      const NIGHT_HOUR   = 22;
      // Khymeryyan civil calendar (week/month/year names + lengths) now
      // lives in js/calendar-system.js (window.CalendarSystem) ‚Äî MORNING_HOUR/
      // NIGHT_HOUR above stay here since the day/weather tick and lighting
      // code also read them, and are threaded into CalendarSystem.init(...)
      // below as deps.

      // ‚îÄ‚îÄ Modular player house ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ
      // Replaces the old singular Highland House GLB (see js/house-pieces.js,
      // window.HousePieces). The interior grid is just the farm grid at 2x
      // resolution ‚Äî every exterior farm tile a built house piece occupies
      // contributes a 2x2 interior cell block (see
      // HousePieces.computeInteriorLayout()) ‚Äî sized to the whole farm
      // rather than tightly to the current house, since the merged interior
      // grows as more pieces get built.
      const INTERIOR_COLS        = COLS * 2;
      const INTERIOR_ROWS        = ROWS * 2;
      const INTERIOR_WALL_HEIGHT = 1.75; // wall height in world units

      // ‚îÄ‚îÄ Voxel render constants ‚îÄ‚îÄ
      // Each tile is drawn as a top-down oblique voxel stack.
      // VSKEW: how many px the top-face shifts up per Z unit (isometric feel)
      // VSLICE: height of each Z-slab in screen pixels
      const VSKEW  = 8;   // px upward shift per +1 Z (raised) / downward per -1 Z (trench)
      const VSLICE = 5;   // px height of one Z level's side face

      // ‚îÄ‚îÄ Water simulation constants ‚îÄ‚îÄ
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
      const RAIN_RATE    = 0.018; // depth added per sim tick during rain (√órainStrength)

      // ‚îÄ‚îÄ Game data ‚îÄ‚îÄ
      // Regional seasons (Stormtide/Deadgrass/Longpour/Coldmuck) also moved
      // into js/calendar-system.js alongside the calendar derivations ‚Äî
      // access via window.CalendarSystem.currentSeason()/seasonForDay(day).
      // season.grassColor/grassDensity still drive the ground tile material
      // and grass billboard tufts here (see applySeasonalGrassAppearance()),
      // and season.rainChance/stormChance still drive the weather roll
      // (see chooseWeatherForDay()) ‚Äî both read the season object returned
      // by those CalendarSystem calls rather than the raw table.
      // Deadgrass rolls as low as a 6% rain chance per day and runs 8
      // weeks (56 days) straight, long enough in real time to read as "it
      // never rains anymore." chooseWeatherForDay()'s pity timer guarantees a
      // rain day whenever the drought runs past this many days, without
      // touching the per-season odds the rest of the time. Declared
      // here (rather than next to chooseWeatherForDay() itself, much further
      // down) because createInitialGrid() calls chooseWeatherForDay() during
      // startup, well before that later point in the file ‚Äî a `const` placed
      // after that call site would be in its temporal dead zone and throw.
      const RAIN_PITY_DAYS = 5;

      const cropData = {
        needlegrain:   { emoji: 'üåæ', seedKey: 'needlegrainSeeds',   cropKey: 'needlegrain',   growDays: 3, idealMin: 0.20, idealMax: 0.50, label: 'needlegrain',   tags: ['Grain', 'Dry-default crop'] },
        heftroot:      { emoji: 'üü°', seedKey: 'heftrootSeeds',      cropKey: 'heftroot',      growDays: 4, idealMin: 0.25, idealMax: 0.55, label: 'heftroot',      tags: ['Root', 'Starch'] },
        garlink:       { emoji: 'üßÑ', seedKey: 'garlinkSeeds',       cropKey: 'garlink',       growDays: 3, idealMin: 0.15, idealMax: 0.45, label: 'garlink',       tags: ['Pungent', 'Broth base'] },
        ongyums:       { emoji: 'üßÖ', seedKey: 'ongyumsSeeds',       cropKey: 'ongyums',       growDays: 3, idealMin: 0.35, idealMax: 0.70, label: 'ongyums',       tags: ['Aromatic', 'Broth base'] },
        redberries:    { emoji: 'üçì', seedKey: 'redberrySeeds',      cropKey: 'redberries',    growDays: 4, idealMin: 0.35, idealMax: 0.70, label: 'redberries',    needsAdjacentDitch: true, tags: ['Berry', 'Ditch-loving'] },
        blueberries:   { emoji: 'ü´ê', seedKey: 'blueberrySeeds',     cropKey: 'blueberries',   growDays: 4, idealMin: 0.50, idealMax: 0.85, label: 'blueberries',   needsAdjacentDitch: true, tags: ['Berry', 'Wet-loving'] },
        yellowberries: { emoji: 'üü°', seedKey: 'yellowberrySeeds',   cropKey: 'yellowberries', growDays: 4, idealMin: 0.25, idealMax: 0.60, label: 'yellowberries', needsAdjacentDitch: true, tags: ['Berry', 'Ditch-loving'] },
        whiteberries:  { emoji: '‚ö™', seedKey: 'whiteberrySeeds',    cropKey: 'whiteberries',  growDays: 4, idealMin: 0.40, idealMax: 0.75, label: 'whiteberries',  needsAdjacentDitch: true, tags: ['Berry', 'Ditch-loving'] },
        blackberries:  { emoji: '‚ö´', seedKey: 'blackberrySeeds',    cropKey: 'blackberries',  growDays: 4, idealMin: 0.45, idealMax: 0.80, label: 'blackberries',  needsAdjacentDitch: true, tags: ['Berry', 'Ditch-loving'] },
        blackMustard:  { emoji: '‚ö´', seedKey: 'blackMustardSeed',   cropKey: 'blackMustard',  growDays: 3, idealMin: 0.15, idealMax: 0.40, label: 'black mustard', tags: ['Mustard', 'Hot'] },
        greenMustard:  { emoji: 'ü•¨', seedKey: 'greenMustardSeed',   cropKey: 'greenMustard',  growDays: 3, idealMin: 0.30, idealMax: 0.65, label: 'green mustard', tags: ['Mustard', 'Fresh'] },
      };

      // Each tool gets at most 3 actions ‚Äî the action bar only has 3 tool-
      // action button slots (btnAction1-3, see refreshActionBar/applyAbt),
      // so a 4th entry here would silently never get a button at all.
      const toolActions = {
        shovel:  ['dig', 'raise', 'fill'],
        hoe:     ['till', 'smooth'],
        machete: ['cut', 'slash'],
        axe:     ['chop', 'hack'],
        // Pick is mine-only ‚Äî dig/raise/fill are the shovel's job; equip
        // the shovel slot for terrain work instead.
        pick:    ['mine'],
        harpoon: ['fish'],
        weapon:  ['cut', 'slash', 'potion_select'],
        ranged:  ['shoot', 'ammo_select', 'potion_select'],
      };

      const actionLabels = {
        dig:        ['‚õèÔ∏è', 'Dig'],
        fill:       ['üü´', 'Fill'],
        raise:      ['üü®', 'Raise'],
        lower:      ['üï≥Ô∏è', 'Lower'],
        till:       ['üü´', 'Till'],
        smooth:     ['üçÉ', 'Smooth'],
        cut:        ['üó°Ô∏è', 'Cut'],
        slash:      ['üí•', 'Slash'],
        chop:       ['ü™ì', 'Chop'],
        hack:       ['üí¢', 'Hack'],
        mine:       ['‚õèÔ∏è', 'Mine'],
        ammo_select:['üèπ', 'Ammo'],
        potion_select:['üß™', 'Potions'],
        harvest:    ['üß∫', 'Harvest'],
        fish:       ['üé£', 'Fish'],
        shoot:      ['üèπ', 'Fire / Load'],
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
        emoji: 'üßë‚Äçüåæ',
        health: 100, maxHealth: 100,
        stamina: 100, maxStamina: 100,
        // Multiplier applied to dig/fill/redig swing durations ‚Äî 1 = base speed.
        // Tools, skills, etc. can raise this later to charge through trench work faster.
        digSpeed: 1,
        invulnUntil: 0,
        dodging: false, dodgeT: 0, dodgeDirX: 0, dodgeDirY: 0, dodgeCooldownT: 0,
        knockbackT: 0, knockbackVX: 0, knockbackVY: 0,
        // Combat lunge ‚Äî a short forward step/leap layered under an attack's
        // windup/strike (combo/quick attacks/charged breaker; flurries and
        // Counter Shield's riposte don't use this). lungeStartX/Y anchor the
        // eased interpolation so partial collision blocking doesn't drift the
        // curve; lungeHopUnits/lungeHopCurrent drive an optional cosmetic
        // vertical arc (world-Y units, not pixels) for the charged breaker's leap.
        lunging: false, lungeT: 0, lungeDur: 0, lungeStartX: 0, lungeStartY: 0,
        lungeDirX: 0, lungeDirY: 0, lungeDistancePx: 0, lungeHopUnits: 0, lungeHopCurrent: 0,
        lungeHeightUnits: 1.0, // Potion/food effects can adjust the player's vertical leap budget before the next attack.
        lungeAimPitch: 0, lungeHitTest: null, // Pitch is shared by the leap, 3D cone, and trail.
        // Cliff climbing ‚Äî see startClimb()/updateMovement. A scripted crossing
        // (no stamina cost, no terrain collision) rendered as a chain of
        // staggered hops rather than a continuous slide; climbSurfaceY/
        // climbHopBounce are consumed by updatePlayerMesh for the vertical rise.
        climbing: false, climbElapsed: 0, climbHopCount: 0,
        climbStartX: 0, climbStartY: 0, climbEndX: 0, climbEndY: 0,
        climbSurfaceStartY: 0, climbSurfaceEndY: 0, climbSurfaceY: 0, climbHopBounce: 0,
        // Standing on a climbable tree branch (see climb-system.js's
        // beginOnBranch) ‚Äî onBranch holds the branch descriptor, branchT is
        // the 0..1 position along it, branchSurfaceY is that branch's own
        // height (used instead of terrain-follow while onBranch is set).
        onBranch: null, branchT: 0, branchSurfaceY: 0,
      };

      // All players present in this session ‚Äî just the local `player` today
      // (there is no networking in this repo yet). Hostile-creature target
      // acquisition reads from this list via nearestPlayer() below instead
      // of hardcoding `player` directly, so a second connected player would
      // just need to be pushed into this array for hostiles to be able to
      // notice and chase them too, with nothing in the AI itself to change.
      const players = [player];

      // Nearest live player to (x, y) ‚Äî see updateHostiles' targetPlayer.
      // Identical to hardcoding `player` while `players` has one entry.
      function nearestPlayer(x, y) {
        let best = null, bestDist = Infinity;
        for (const p of players) {
          const d = Math.hypot(p.x - x, p.y - y);
          if (d < bestDist) { best = p; bestDist = d; }
        }
        return best;
      }

      // Health/Stamina afflictions + Exhausted/black-stamina debt ‚Äî see
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
        // Editor) is the real source of truth once it's loaded ‚Äî falls back
        // to scratchbones-config.js's copy (the original, still-synchronous
        // definition) if the fetch hasn't resolved yet or failed.
        const cfg = window.__attackValuesConfig?.weaponAbilities?.[action] || combatConfig().weaponAbilities?.[action];
        if (!cfg) return null;
        // A smith-crafted verdigris weapon's damage scales with its
        // effective metal tier (see toolMetalMultiplier) ‚Äî reinforcement-
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
      const PLAYER_KNOCKBACK_PX_S = 300;
      const COMPANION_BITE_KNOCKBACK_PX_S = 280;
      const HOSTILE_BITE_KNOCKBACK_PX_S = 240;
      const PRONE_THROW_DUR_S = 0.34; // Drives the footing-break displacement channel consumed by prone player/creature updates.
      const PRONE_THROW_PLAYER_MIN_PX_S = 600; // Guarantees a readable player throw when a source supplied no ordinary knockback speed.
      const PRONE_THROW_CREATURE_MIN_PX_S = 480; // Gives animals/bandits a minimum throw at the existing hostile-bite scale.

      function applyKnockback(target, fromX, fromY, speedPxS) {
        if (target.onBranch) {
          // Knockback while standing on a branch is resolved along the
          // branch's own 1D axis instead of the usual free-plane impulse ‚Äî
          // if it doesn't push the target past either end, that's the whole
          // effect (see resolveBranchKnockback). Pushed past an end, the
          // target falls to the ground and lands hard rather than sliding ‚Äî
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
        // Getting hit always interrupts an in-progress combat lunge ‚Äî without
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
      // front=0, right=90, back=180, left=-90 ‚Äî see docs/config/animations/
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
      // target ‚Äî called from damageCreature/damagePlayer right after their
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

        // This hit emptied Footing ‚Äî go straight to the full breakThrow
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

      // Drunken movement degradation ‚Äî continuous with Footing, not a
      // discrete regular/drunken swap: read directly at updateMovement's own
      // targetSpeed/accel computation as an independent factor rather than
      // through Combat.setMovementSpeedMul, which is already a single slot
      // contested between combat-flurry.js and combat-blink-dodge.js. Scoped
      // to speed/acceleration/turn-response only for now ‚Äî see this repo's
      // procedural-animation-editor tool for the fuller regular<->drunken
      // pose-sway blend this deliberately doesn't also port onto the live
      // rig (no existing system applies an authored body-lean pose to the
      // live avatar the way this one does foot IK, and building a second
      // clip-sampling pipeline for a purely cosmetic effect isn't worth it
      // here ‚Äî a future pass can add a lightweight sinusoidal wobble on the
      // avatar root instead, scaled by the same footing-loss fraction below).
      const FOOTING_SPEED_MUL_MIN = 0.55;
      function getFootingSpeedMul(entity) {
        if (!entity || !(entity.maxFooting > 0)) return 1;
        const frac = clamp(entity.footing / entity.maxFooting, 0, 1);
        return FOOTING_SPEED_MUL_MIN + (1 - FOOTING_SPEED_MUL_MIN) * frac;
      }

      // Forced disengage-jump duration for a creature/bandit whose Footing
      // has just recovered to full after going prone ‚Äî longer than the
      // ordinary post-combo jump-back (JUMP_BACK_DUR_S, 0.4s) since this is
      // an unconditional flee, not a chained retreat between combo cycles.
      const FORCED_SOMERSAULT_RETREAT_S = 0.6;
      const SOMERSAULT_STAMINA_COST = 30;

      // Zero-Footing transition ‚Äî called only once applyHitStagger's own
      // spendFooting has already driven entity.footing to 0. Both the player
      // and any creature/bandit go fully prone here (immune to further
      // Footing loss ‚Äî see resource-system.js's spendFooting), matching each
      // other exactly; they differ only in how they LEAVE prone: the player
      // needs a dodge input once Footing is back to full (see performDodge's
      // somersault-recovery hook below), while a creature/bandit's own AI
      // does it automatically the instant its Footing reaches full ‚Äî see
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
      // to full ‚Äî forces it back into 'chase' (so updateBanditCombatAI's/
      // the plain-wildlife retreatT branch's existing jump-back movement
      // actually picks it up next frame) and spends stamina first, so an
      // already-gassed creature can overspend straight into Exhausted (see
      // resource-system.js's spendStamina -> enterExhausted) ‚Äî exhaustion
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
      // creature's movement speed while standing in a river/stream tile ‚Äî
      // see tileSpeedAt (player) and moveCreatureToward (creatures). A
      // creature/player tagged canSwim ignores this and moves at full
      // speed in water. Attacking is disallowed while swimming regardless
      // of species ‚Äî see isPlayerSwimming/isCreatureSwimming.
      const SWIM_SPEED_MUL = 0.5;
      // Same idea as SWIM_SPEED_MUL, for cliff (incline) tiles ‚Äî see
      // moveCreatureToward/isCreatureClimbing.
      const CLIMB_SPEED_MUL = 0.5;

      // Global creature database ‚Äî companions (whistle-bound) and hostiles
      // (ambient-spawned) are both built from this table. Species sizes that
      // need live tuning are sourced from scratchbones-config.js rather than
      // being duplicated as literals in this database.
      const WILDLIFE_CREATURE_MODEL_WIDTHS = window.SCRATCHBONES_CONFIG?.game?.wildlife?.creatureModelWidths || {};
      // canClimb: default false ‚Äî a creature without the tag can still enter
      // an incline (cliff wall) tile (no longer a hard block), just at
      // CLIMB_SPEED_MUL speed, same as a non-swimmer crossing water. canSwim:
      // default false ‚Äî a creature without the tag can still enter a
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
          // field ‚Äî see resource-system.js's applyDamage ‚Äî so a tamed
          // dabinggi-hound's bite/pounce afflicts Poisoned Health instead of
          // the wolves' Bleeding/Wounded.
          attackTag: 'poison',
          // Companion AI-type this species uses when summoned as an active
          // companion (see COMPANION_AI_TYPES) ‚Äî 'vigilantProtector' is
          // updateCompanions()'s existing follow/fight behavior.
          aiType: 'vigilantProtector',
          // Base sense range (tiles) for a nearby bandit camp or animal den
          // through cover/foliage ‚Äî scaled by PERCEPTION_TILES_MULTIPLIER
          // for the real in-game range (see updateCompanionPerception /
          // _companionPerceptionRangePx). A hunting dog's nose beats a farm
          // bird's (see uumkaoii's own value below); species with no
          // perceptionTiles set fall back to DEFAULT_PERCEPTION_TILES.
          perceptionTiles: 10,
          canClimb: false, canSwim: false,
          modelWidth: 1.9, tint: 0xffffff,
          // Default Size for the personal stable's mount/companion/shoulder-
          // pet gating (see CREATURE_SIZE_CLASSES/stableEntryRole) ‚Äî a rare
          // hereditary mutation can still shift an individual specimen's
          // genotype.sizeClass away from this species default on breeding.
          defaultSizeClass: 'medium',
          // How fast riding this species as a mount lets the player move
          // (px/s, same units as MOVE_SPEED ‚Äî see activeMountSpeedMul).
          // Independent per species; every stable-able species currently
          // shares this same value, deliberately well above MOVE_SPEED (238).
          mountSpeed: 340,
          sprites: {
            idle: 'assets/creaturesprites/dabinggi-hound_idle.png',
            run: ['assets/creaturesprites/dabinggi-hound_run1.png', 'assets/creaturesprites/dabinggi-hound_run2.png'],
          },
          lootPool: 'creature_dabinggi-hound',
        },
        // Uumkao'ii as an active companion ‚Äî a separate, continuous-movement
        // CREATURE_DB entry (not the tile-hopping farm-livestock system in
        // LIVESTOCK_FACTORIES/makeUumkaoiiAnimal) so a stabled Uumkao'ii can
        // be summoned via the same generic companion AI as the dabinggi-hound.
        // Routed to 'vigilantProtector' as a stand-in per design direction ‚Äî
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
          // See dabinggi-hound's matching comment ‚Äî a farm bird's senses are
          // no match for a hound's nose.
          perceptionTiles: 5,
          canClimb: false, canSwim: false,
          modelWidth: 1.6, tint: 0xffffff, lungeHeightUnits: 0.08, // Nearly grounded; high aim should shed almost all travel.
          // See dabinggi-hound's matching comment ‚Äî Uumkao'ii default large
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
          // See dabinggi-hound's attackTag comment ‚Äî gar-wolves bite/pounce
          // sharp, afflicting Bleeding Health + Wounded Stamina.
          attackTag: 'sharp',
          // Not tameable/stable-able yet, but expected to use this same
          // companion AI type long-term once that exists ‚Äî see COMPANION_AI_TYPES.
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
          // See dabinggi-hound's matching comment ‚Äî Grehlr default large
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
        // spawnPackAtDen and updateHostiles' grazing/patrol states) ‚Äî a
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
        // it (very tight leashRangePx around the nest ‚Äî otherwise plain
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
      // docs/js/combat/combat-config-loader.js's fetch resolves ‚Äî same
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
          // spawnPackAtDen) ‚Äî no longer a single fixed hostileKey, since a
          // wiped-out den's replacement pack isn't necessarily the same
          // species as the one it replaces.
          packSpecies: ['grehlr'],
          // Species pool a den's next HERD is randomly drawn from, when a den
          // rolls a herbivore population instead of a predator pack this
          // cycle (see spawnPackAtDen) ‚Äî kept as a sibling pool to packSpecies
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
          // It's a *cloud* forest ‚Äî thicker than the 0.018 every other zone
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
          // simple circle around the player ‚Äî originally paired with
          // CloudForestFog's outer mist cylinder so the ring where
          // vegetation pops in/out sat inside the mist in every direction
          // rather than just character-forward. This is now just the
          // startup default: both the live cull radius and each fog layer's
          // own radius/opacity are independently Settings-tab sliders (see
          // s_cloudForestCullRadiusTiles and CloudForestFog's setLayerRadius/
          // setLayerOpacity) ‚Äî lowered from 34 to 30 by default since the
          // full 34-tile radius was a real contributor to reported
          // choppiness in this zone. At 34, fogDensity above had already
          // made FogExp2 ~97% opaque out there, hiding the vegetation
          // pop-in; at the smaller default the pop-in ring is more likely
          // to be visible, tunable back up via the slider if that matters
          // more than the performance it costs.
          vegCullRadiusTiles: 30,
          // Previously the only zone with no packSpecies pool at all, so
          // gar-wolf (a real CREATURE_DB/DEN_MOTHER_DEFS entry ‚Äî see
          // scratchbones-config.js's wildlife.denMothers) had no zone to
          // ever spawn from, anywhere.
          packSpecies: ['gar-wolf'],
          // Drenkirra no longer den here ‚Äî nativeSpeciesFor/spawnPackAtDen
          // (via this pool) decide both a den's exterior pack and its
          // cavern Den-Mother, and drenkirra now nest on shadewood branches
          // instead (see wildlife-spawn.js's ensureCurrentZoneNestTrees),
          // so every den in this zone is a gar-wolf den.
          herbivoreSpecies: [],
          entryCol: 11, entryRow: 1,
          exitCol: 11, exitRow: 0,
          townReturnCol: 30, townReturnRow: 48,
          // No zone-specific cue pack recorded yet ‚Äî 'general' keeps this
          // zone from being dead silent (no areaBgm track exists for it
          // either) until one gets authored, same as farm/town's default.
          audioIndex: 'general',
        },
        // Western Slope/Eastern Mire have always had real authored layouts in
        // town-workspace-v1.json (unlike the two placeholder zones above), but
        // never got an EXTERIOR_ZONES entry of their own ‚Äî so their "back to
        // town" ring (which reads zdef.townReturnCol/Row, not zoneData) sent
        // the player to clamp(undefined, ...) === NaN. townReturnCol/Row below
        // are one tile inside town from that zone's own town-side transition
        // spot (spot_2vsub at col 0, row 25 / spot_d33e9 at col 59, row 25 in
        // hobunji_hollow_town.map.json). entryCol/Row/exitCol/Row match the
        // authored zone's own "To Hobunji Hollow" spot (sp_wslope_e / sp_emi_west)
        // ‚Äî one gate tile serving both directions, same as the two zones above.
        map_western_slope: {
          label: 'Western Slope',
          cols: 50, rows: 40,
          groundColor: 0x6b6a52, fogColor: 0x35342a,
          herbivoreSpecies: ['uumkaoii-wild'],
          entryCol: 48, entryRow: 20,
          exitCol: 48, exitRow: 20,
          townReturnCol: 1, townReturnRow: 25,
          // See map_southern_cloud_forest above ‚Äî no zone-specific cue pack yet.
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
          // See map_southern_cloud_forest above ‚Äî no zone-specific cue pack yet.
          audioIndex: 'general',
        },
        // Dev-only sandbox ‚Äî reachable solely through Settings' "Teleport to
        // Test Arena" button (see teleportToDevArena), never through a town
        // transition spot. No packSpecies/herbivoreSpecies pool means it never
        // spawns ambient wildlife on its own (see spawnPackAtDen's empty-pool
        // early-return) ‚Äî every creature in it comes from the dev spawn menu
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
        day: 1,            // Anan, Waxingheat 1st ‚Äî week 3 of Stormtide (its band wraps the year: 47-48, then 1-14), year 1
        time01: 0.30,      // ~10:30 AM ‚Äî mid-morning, well into a rain window
        weather: 'rain',
        isRaining: true,
        rainStrength: 2,
        nextRainWindows: [{ start: 8, end: 14, strength: 2 }],
        lastRainDay: 1      // last day a rain/storm window was scheduled ‚Äî drives the drought pity timer below
      };

      // Used by inventoryHud and planting/harvesting actions.
      // Only real starting stacks are listed; generic empty boxes are drawn by buildInventoryGrid().
      const STARTING_INVENTORY = {
        needlegrainSeeds: 6, heftrootSeeds: 4, garlinkSeeds: 4, ongyumsSeeds: 4,
        // Berry seeds are deliberately absent ‚Äî not purchasable either; all
        // 5 varieties grow wild across the wilderness zones instead (see
        // WILD_BERRY_ZONES) and have a small chance to yield a seed when
        // foraged, which is the only way to get one.
        blackMustardSeed: 3, greenMustardSeed: 3,
        uumkaoiiCrate: 1,
        barnPlanSmall: 1,
        campfireKitFurnitureBlueprint: 1, // Always-available campfire blueprint ‚Äî see DECORATIVE_FURNITURE_DEFS.campfire; blueprints are reusable (see craftFurnitureFromBlueprint), so one copy is permanent.
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

      let gearInventory = null; // Loaded from player profile ‚Äî character-scoped
      let packClothing  = [];   // Clothing items in world/pack inventory

      // Personal livestock collection ("the stable") ‚Äî character-scoped like
      // gearInventory, travels between worlds. Distinct from a farm's
      // world-scoped livestock: stable animals are companions (nameable,
      // eventually levelable), can't produce goods, and can't be placed on
      // any farm. [{ id, kind, name, genotype, aiType, level, stabledAt }]
      let stable = [];
      let activeCompanionId = null; // which stable entry (if any) is the active (medium-Size) companion
      let activeMountId = null;       // which stable entry (if any) is the active (large-Size) mount
      let activeShoulderPetId = null; // which stable entry (if any) is the active (small-Size) shoulder pet

      // Companion AI-type registry ‚Äî a small database of follow/fight
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
      // combat-progression.js) ‚Äî an edge cuts (bleed/wound/poison/infect),
      // a bludgeon crushes (bruise/wind/congeal/shatter). Defaults to
      // 'sharp' when absent (see currentWeaponDamageType() below), so only
      // the blunt outliers need to be called out.
      const TOOL_ITEM_DEFS = {
        bronzehoe:    { label: 'Bronze Hoe',    icon: 'ü™ì', sprite: 'assets/toolsprites/hoe_bronzehoe.png',        slots: ['hoe'],                    animStyle: 'chop'   },
        hatchet:      { label: 'Hatchet',       icon: 'ü™ì', sprite: 'assets/toolsprites/axe_hatchet.png',          slots: ['axe', 'weapon'],           animStyle: 'sweep',  dmgType: 'sharp' },
        // `spinning` distinguishes the harpoon-slot sprite's in-hand behavior: mace-mode items
        // twirl around their own axis through the swing (call it "spinning" rather than
        // "mace mode" since fishing hatchets or other harpoon variants may reuse the same flag),
        // while spear-mode items stay rigidly oriented like the hatchet sweep.
        fishingmace:  { label: 'Fishing Mace',  icon: 'üé£', sprite: 'assets/toolsprites/harpoon_fishingmace.png',  slots: ['harpoon', 'weapon'],        animStyle: 'sweep', spinning: true, dmgType: 'blunt'  },
        fishingspear: { label: 'Fishing Spear', icon: 'üé£', sprite: 'assets/toolsprites/harpoon_fishingspear.png', slots: ['harpoon', 'weapon'],        animStyle: 'thrust', spinning: false, dmgType: 'sharp' },
        pickshovel:   { label: 'Pick-Shovel',   icon: '‚õèÔ∏è', sprite: 'assets/toolsprites/shovel_pickshovel.png',    slots: ['shovel', 'pick', 'weapon'], animStyle: 'thrust', dmgType: 'blunt' },
        crossbow:     { label: 'Crossbow',      icon: 'üèπ', sprite: 'assets/toolsprites/ranged_crossbow.png', loadedSprite: 'assets/toolsprites/ranged_crossbow_loaded.png', slots: ['ranged'], animStyle: 'ranged', rangedType: 'crossbow' },
        scatterbow:   { label: 'Scatterbow',    icon: 'üèπ', sprite: 'assets/toolsprites/ranged_scatterbow.png', loadedSprite: 'assets/toolsprites/ranged_scatterbow_loaded.png', slots: ['ranged'], animStyle: 'ranged', rangedType: 'scatterbow' },
        // Decorative only (no `slots`, so it's never equippable/craftable ‚Äî
        // see the TOOL_ITEM_DEFS.forEach ITEM_DEFS-registration loop below,
        // which only fires for entries with a metalKey). Held by Foroji at
        // station_foroji_music (see map_hobunji_town.map.json's toolKey) so
        // he visibly has his instrument out while playing.
        kurraya:      { label: 'Kurraya',       icon: 'üéµ', sprite: 'assets/toolsprites/kurraya_front.png',        slots: [], animStyle: 'strum' },
      };

      // ‚îÄ‚îÄ Metal registry (dug-up bars, the verdigris hierarchy) ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ
      // Clean/polished target hex + verdigris hex ported from the tool-sprite
      // recolorer dev tool's METAL_PRESETS list. `tier` is null for metals
      // that don't produce a verdigris (dug up and sold, or used only for
      // cosmetic plating) ‚Äî the seven that do have tier: 1 (weakest, native
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
      // Weakest ‚Üí strongest, i.e. the hierarchy Sloomi/Kzubug craft/reinforce with.
      const VERDIGRIS_METAL_KEYS = Object.keys(METAL_DEFS)
        .filter(k => METAL_DEFS[k].tier != null)
        .sort((a, b) => METAL_DEFS[a].tier - METAL_DEFS[b].tier);

      function metalBarItemKey(metalKey) { return 'bar_' + metalKey; }

      // A tier-linear damage/efficacy scalar ‚Äî read by both weaponAbility()
      // (combat damage) and, going forward, any other tool-use "efficacy"
      // roll that wants to share the same material-tier scale.
      function metalDmgMultiplier(metalKey) {
        const tier = METAL_DEFS[metalKey]?.tier;
        return tier ? 0.85 + tier * 0.05 : 1; // tier1=0.90 ‚Ä¶ tier7=1.20
      }

      // ‚îÄ‚îÄ Tool "shapes" (the physical object) vs. metal (what it's crafted
      // from) ‚Äî TOOL_ITEM_DEFS below still keys everything by a single flat
      // itemKey (mastery, equip slots, gearInventory.tools all already work
      // that way), so a crafted tool's key is just `${shapeKey}_${metalKey}`
      // (see craftedToolItemKey) ‚Äî a brand-new key per shape+metal
      // combination, automatically getting its own independent mastery/
      // verdigris/plating/reinforcement tracking for free since all of that
      // state is already keyed by itemKey.
      const TOOL_SHAPE_DEFS = {
        hoe:          { label: 'Hoe',           icon: 'ü™ì', baseSprite: 'assets/toolsprites/hoe_bronzehoe.png',        slots: ['hoe'],                     animStyle: 'chop'   },
        hatchet:      { label: 'Hatchet',       icon: 'ü™ì', baseSprite: 'assets/toolsprites/axe_hatchet.png',          slots: ['axe', 'weapon'],           animStyle: 'sweep',  dmgType: 'sharp' },
        fishingmace:  { label: 'Fishing Mace',  icon: 'üé£', baseSprite: 'assets/toolsprites/harpoon_fishingmace.png',  slots: ['harpoon', 'weapon'],        animStyle: 'sweep', spinning: true, dmgType: 'blunt'  },
        fishingspear: { label: 'Fishing Spear', icon: 'üé£', baseSprite: 'assets/toolsprites/harpoon_fishingspear.png', slots: ['harpoon', 'weapon'],        animStyle: 'thrust', spinning: false, dmgType: 'sharp' },
        pickshovel:   { label: 'Pick-Shovel',   icon: '‚õèÔ∏è', baseSprite: 'assets/toolsprites/shovel_pickshovel.png',    slots: ['shovel', 'pick', 'weapon'], animStyle: 'thrust', dmgType: 'blunt' },
      };
      // Weapon-only shapes are intentionally separate from farming/fishing tools.
      // They still enter the shared smithing/item pipeline through HELD_SHAPE_DEFS
      // below, but future weapons no longer have to masquerade as tool definitions.
      const MELEE_WEAPON_SHAPE_DEFS = {
        bshuakauitl:  { label: "B'shuakauitl", icon: 'üó°Ô∏è', baseSprite: "assets/toolsprites/b'shuakauitl.png",       slots: ['weapon'], animStyle: 'sweep',  dmgType: 'sharp', weaponIdleClass: 'light' },
        daggerSword:  { label: 'Dagger-Sword',  icon: 'üó°Ô∏è', baseSprite: 'assets/toolsprites/dagger-sword_sweep.png', slots: ['weapon'], animStyle: 'sweep',  comboStyle: 'sweep', dmgType: 'sharp', weaponIdleClass: 'light' },
        plainsSword:  { label: 'Plains-Sword',  icon: 'üó°Ô∏è', baseSprite: 'assets/toolsprites/plains-sword.png',       slots: ['weapon'], animStyle: 'sweep',  dmgType: 'sharp', weaponIdleClass: 'heavy' },
        dagger:       { label: 'Dagger',        icon: 'üó°Ô∏è', baseSprite: 'assets/toolsprites/dagger.png',             slots: ['weapon'], animStyle: 'thrust', dmgType: 'sharp', weaponIdleClass: 'light' },
        kylie:        { label: 'Kylie',         icon: 'üó°Ô∏è', baseSprite: 'assets/toolsprites/kylie.png',              slots: ['weapon'], animStyle: 'sweep',  dmgType: 'sharp', weaponIdleClass: 'light' },
        warCleaver:   { label: 'War-Cleaver',   icon: 'üó°Ô∏è', baseSprite: 'assets/toolsprites/war-cleaver.png',        slots: ['weapon'], animStyle: 'sweep',  dmgType: 'sharp', weaponIdleClass: 'light' },
      };
      const HELD_SHAPE_DEFS = { ...TOOL_SHAPE_DEFS, ...MELEE_WEAPON_SHAPE_DEFS }; // Shared smithing/equipment catalog used by the existing generated-item pipeline.
      // Every shape is unlocked from the start ‚Äî "you unlock all the current
      // ones by default" ‚Äî this is just the set Sloomi/Kzubug's crafting
      // counter offers; it's never spent/consumed so it isn't gearInventory
      // state the way owned tools/mastery/plating are.
      const UNLOCKED_TOOL_SHAPES = Object.keys(HELD_SHAPE_DEFS);
      function craftedToolItemKey(shapeKey, metalKey) { return shapeKey + '_' + metalKey; }

      // Registers one TOOL_ITEM_DEFS entry per (shape √ó verdigris metal)
      // combination ‚Äî the original 5 hand-authored keys above (bronzehoe,
      // hatchet, fishingmace, fishingspear, pickshovel) are untouched, since
      // they're the starting bronze-age kit baked into makeDefaultGear() and
      // every existing save's mastery/equip data. `shapeKey`/`metalKey` on
      // these generated entries mark them as smith-crafted, verdigris-
      // capable tools (see toolVerdigrisFraction/toolEffectiveMetalKey).
      for (const metalKey of VERDIGRIS_METAL_KEYS) {
        for (const [shapeKey, shape] of Object.entries(HELD_SHAPE_DEFS)) {
          const itemKey = craftedToolItemKey(shapeKey, metalKey);
          TOOL_ITEM_DEFS[itemKey] = {
            label: `${METAL_DEFS[metalKey].label} ${shape.label}`,
            icon: shape.icon,
            sprite: shape.baseSprite,
            slots: shape.slots,
            animStyle: shape.animStyle,
            comboStyle: shape.comboStyle,
            dmgType: shape.dmgType,
            spinning: shape.spinning,
            weaponIdleClass: shape.weaponIdleClass,
            shapeKey, metalKey,
            itemKey, // self-reference ‚Äî lets icon rendering resolve mastery/plating without a separate key param
          };
        }
      }

      // Drives the weapon-tool loadout's Combo slot (see combat-loadout.js) ‚Äî
      // a sweep-style weapon (hatchet, fishing mace) plays the 3-Swing Combo,
      // a thrust-style weapon (fishing spear, pick-shovel) plays the 3-Poke
      // Combo. A definition may explicitly override that coupling with
      // comboStyle (the dagger-sword does), while older definitions keep using
      // animStyle. No weapon equipped falls back to the swing combo, same as
      // the legacy 'slash' action's own default.
      function currentComboAbilityId() {
        const def = TOOL_ITEM_DEFS[equipmentSlots.weapon];
        return (def?.comboStyle || def?.animStyle) === 'thrust' ? 'pokeCombo' : 'swingCombo';
      }

      // Drives which flavor of affliction options every weapon-tool ability
      // offers (see combat-progression.js) ‚Äî independent of which combo/
      // technique is equipped, since it's the physical weapon doing the
      // wounding either way.
      function currentWeaponDamageType() {
        return weaponDamageTypeForTool(equipmentSlots.weapon);
      }

      // Same as currentWeaponDamageType(), but for any tool key ‚Äî not just
      // whichever is currently equipped. combat-progression.js's per-tool
      // progression resolves a tool's own choices through its own fixed
      // dmgType even while a *different* weapon is equipped.
      function weaponDamageTypeForTool(itemKey) {
        return TOOL_ITEM_DEFS[itemKey]?.dmgType || 'sharp';
      }

      // Keys the weapon-tool loadout's per-weapon slot assignments (see
      // combat-loadout.js) ‚Äî each gear-inventory weapon remembers its own
      // Quick Attack/Held picks; 'none' is the shared fallback while no
      // weapon is equipped.
      function currentWeaponKey() {
        return equipmentSlots.weapon || 'none';
      }

      // Display label for the loadout UI's "saved for: <weapon>" note.
      function currentWeaponLabel() {
        return TOOL_ITEM_DEFS[equipmentSlots.weapon]?.label || null;
      }

      // ‚îÄ‚îÄ Tool mastery ("your trusty axe/shovel/pick/spear") ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ
      // Cumulative XP needed to reach levels 1-5 ‚Äî a tool's own affinity,
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
      // selectGearTool/selectEquipSlot, gated by s_devMode) ‚Äî jumps straight
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
      // landed a hit (see combat-*.js) ‚Äî grows whichever tool is currently
      // equipped as the weapon.
      function awardWeaponMasteryXp() {
        awardToolMasteryXp(equipmentSlots.weapon, MASTERY_XP_PER_COMBAT_HIT);
      }

      // Called from a successful hoe/shovel/axe/pick/harpoon action ‚Äî
      // ordinary tool use also builds a tool's affinity, not just combat.
      function awardToolUseMasteryXp(tool) {
        awardToolMasteryXp(equipmentSlots[tool], MASTERY_XP_PER_TOOL_USE);
      }

      // ‚îÄ‚îÄ Verdigris coverage, cosmetic plating, metal reinforcement ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ
      // Continuous with the tool's own XP total (not stepped by mastery
      // LEVEL) ‚Äî 0% verdigris at 0 XP, 100% ("maximum verdigris") exactly
      // at the mastery-5 threshold, same MASTERY_XP_THRESHOLDS toolMasteryLevel
      // already reads. Only meaningful for a smith-crafted verdigris tool
      // (TOOL_ITEM_DEFS[itemKey].metalKey set) ‚Äî anything else reads as 0.
      function toolVerdigrisFraction(itemKey) {
        if (!TOOL_ITEM_DEFS[itemKey]?.metalKey) return 0;
        const maxXp = MASTERY_XP_THRESHOLDS[MASTERY_XP_THRESHOLDS.length - 1];
        return Math.max(0, Math.min(1, toolMasteryXp(itemKey) / maxXp));
      }

      // gearInventory.toolPlating[itemKey] = { mode: 'cosmetic'|'resistant', metalKey }
      // 'cosmetic': any metal's clean color, hiding the live verdigris entirely.
      // 'resistant': the tool's OWN base metal, clean/polished ‚Äî "the same
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

      // gearInventory.toolReinforcement[itemKey] = { metalKey } ‚Äî a higher-
      // tier verdigris metal's power grafted onto this literal tool by
      // Sloomi/Kzubug's reinforcement service. The tool keeps its own base
      // metal's identity ‚Äî label, sprite recolor hue, verdigris color, and
      // mastery XP all stay keyed to itemKey exactly as before ‚Äî only its
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

      // The metal this tool actually fights/works with ‚Äî its own base metal
      // unless reinforced with something higher-tier (see above).
      function toolEffectiveMetalKey(itemKey) {
        return toolReinforcementMetal(itemKey) || TOOL_ITEM_DEFS[itemKey]?.metalKey || null;
      }
      function toolMetalMultiplier(itemKey) {
        return metalDmgMultiplier(toolEffectiveMetalKey(itemKey));
      }

      // ‚îÄ‚îÄ Motes of Prowess ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ
      // Spent on ability-upgrade choices (see combat-progression.js);
      // earned from combat (creature kills) and other future sources.
      // Placeholder tuning ‚Äî combat quests etc. are a later addition.
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

      // ‚îÄ‚îÄ Metal/verdigris tool icon recolor bridge ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ
      // A crafted verdigris tool's icon isn't a static PNG ‚Äî it's the shape's
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
          // un-recolored base sprite until now ‚Äî refresh the panels that
          // render tool sprites via <img> once the real recolor lands.
          window.EquipmentPanel.buildEquipmentSlots();
        });
        return key;
      }
      // Resolves an <img src> for a tool def ‚Äî the plain sprite path for an
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
      // ToolIconRender key for a smith-crafted verdigris tool ‚Äî see above.
      function iconSpriteSourceFor(def) {
        if (def?.metalKey && def?.itemKey) {
          const key = ensureMetalToolIconSource(def.itemKey);
          if (key) return key;
        }
        return def?.sprite || null;
      }

      // Resolved icon for a tool-select badge (the equipped item's own
      // sprite, upright and trimmed) ‚Äî falls back to `fallbackEmoji` until
      // the sprite has finished loading, or if the slot holds nothing.
      function toolSelectIconHTML(def, fallbackEmoji, cssSize) {
        const src = iconSpriteSourceFor(def);
        if (src) {
          const html = window.ToolIconRender?.getIconHTML(src, 'plain', cssSize, def.label);
          if (html) return html;
        }
        return def?.icon || fallbackEmoji;
      }

      // Resolved icon for a weapon/axe action button ‚Äî the equipped item's
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
          // flat 1.0 metalDmgMultiplier ‚Äî mid-hierarchy strength with no
          // room to grow into) ‚Äî a fresh character now genuinely starts at
          // the bottom of the smithing ladder (see toolMetalMultiplier).
          tools:    { hoe_nativeCopper: true, hatchet_nativeCopper: true, fishingmace_nativeCopper: true, fishingspear_nativeCopper: true, pickshovel_nativeCopper: true, crossbow: true, scatterbow: true },
          clothing: { hat: null, hood: null, torso: null, overwear: null },
          clothingItems: [],
          charms: [],
          whistles: [
            { id: 'whistle_bingo', creatureKey: 'dabinggi-hound', name: 'Bingo' },
          ],
          // toolMastery[itemKey] = { xp } ‚Äî each literal tool instance's own
          // affinity, gained through both combat (see awardWeaponMasteryXp)
          // and ordinary tool use (see awardToolUseMasteryXp). Its level (see
          // toolMasteryLevel()) gates which of that tool's own equipped
          // abilities' 5 upgrade levels can be chosen ‚Äî see
          // combat-progression.js.
          toolMastery: {},
          // Shared 0/8 resource spent once per special-ammo volley; weapon-
          // specific rank picks and active ammo live beside it below.
          specialAmmo: 0,
          rangedAmmoLoadouts: {},
          unlockedSpecialAmmo: ['shrapnel', 'concussive'],
          // toolPlating[itemKey] = { mode: 'cosmetic'|'resistant', metalKey } ‚Äî
          // Sloomi/Kzubug's cosmetic plating service (see setToolPlating).
          toolPlating: {},
          // toolReinforcement[itemKey] = { metalKey } ‚Äî Sloomi/Kzubug's metal
          // reinforcement service (see setToolReinforcement).
          toolReinforcement: {},
          // Spent on ability-upgrade choices (level N choice costs N motes ‚Äî
          // see combat-progression.js); earned from combat (creature kills)
          // and other future sources. Character save data, not world data.
          // No starting stipend ‚Äî a fresh character earns these through
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

      // Perk ranks are character-scoped, same as skill levels/XP above ‚Äî a
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

      // Persists the personal stable (companions) ‚Äî mirrors saveGearInventory()'s
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
      // (activeTool) ‚Äî separate from gearInventory (what's owned) above.
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

      // ‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê
      //  WORLD OBJECTS
      //  Each object has a tile position, a Three.js mesh, a label,
      //  and a getButtons(reticle) ‚Üí [{icon,label,action,style,allowed}]
      //  method. When the reticle overlaps an object, its buttons are
      //  appended to the action stack. Actions prefixed 'obj_' are
      //  routed to the object's onAction(action) handler.
      //
      //  Objects placed at startup (placeable ones coming later):
      //    ‚Ä¢ Sell Crate  (col=2, row=ROWS-3) ‚Äî orange crate
      //    ‚Ä¢ Supply Box  (col=4, row=ROWS-3) ‚Äî blue crate
      // ‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê‚ïê

      const BASE_PRICES = {
        needlegrain: 8, heftroot: 11, garlink: 7, ongyums: 7,
        redberries: 12, blueberries: 13, yellowberries: 12, whiteberries: 14, blackberries: 14,
        blackMustard: 10, greenMustard: 9,
        mulch: 2
      };

      const PROCESSING_FURNITURE_DEFS = {
        pestle: {
          itemKey: 'pestleFurniture', icon: 'ü•£', name: 'Pestle Station', method: 'mashing', color: 0x9a6a3a,
          desc: 'Placeable processor for mashing: berries into jam, mustard seed into paste, and starchy crops into mash.'
        },
        squeezer: {
          itemKey: 'squeezerFurniture', icon: 'üßÉ', name: window.HobunjiFoodProcessing?.SQUEEZING_VAT?.name || 'Squeezing Vat', method: 'squeezing', color: 0x4f9eb8,
          desc: window.HobunjiFoodProcessing?.SQUEEZING_VAT?.desc || 'Placeable vat for squeezing and pressing cooking ingredients.'
        },
        handMill: {
          itemKey: 'handMillFurniture', icon: '‚öôÔ∏è', name: 'Hand Mill', method: 'grinding', color: 0x8f8a78,
          desc: 'Placeable processor for grinding: needlegrain/heftroot into flour and mustard seed into powder.'
        },
        dryingRack: {
          itemKey: 'dryingRackFurniture', icon: '‚òÄÔ∏è', name: 'Drying Rack', method: 'drying', color: 0xcaa45e,
          desc: 'Placeable processor for drying wet/fresh ingredients. Dry-default grain/root crops are intentionally not dryable.'
        },
        smoker: {
          itemKey: 'smokerFurniture', icon: 'üí®', name: 'Smoking Hut', method: 'smoking', color: 0x5c5147,
          desc: 'Placeable processor for smoking meat, fish, and mollusks once those ingredient loops exist in the farm demo.'
        },
        agingBarrel: {
          itemKey: 'agingBarrelFurniture', icon: 'üõ¢Ô∏è', name: 'Aging Barrel', method: 'barrelAging', color: 0x7a4924,
          desc: 'Placeable processor for barrel-aging juice into wine and dew/honey-like inputs into mead later.'
        },
        agingVase: {
          itemKey: 'agingVaseFurniture', icon: 'üè∫', name: 'Aging Vase', method: 'vaseAging', color: 0xa76b47,
          desc: 'Placeable processor for vase-aging milk or curds into cheese once animal products are active.'
        },
      };

      // Every processing method a world-object furniture piece can feed a
      // held bag item into (see getProcessingOutputs) ‚Äî used by
      // isWheelEligible to keep a raw ingredient wheel-selectable even
      // though it has no standalone held-item action of its own. Derived
      // from PROCESSING_FURNITURE_DEFS so a new processor automatically
      // widens this set; 'grindingFeed' is added by hand because the feed
      // grinder (a barn fixture, see feedGrinderFurniture) predates/isn't
      // part of that table.
      const PROCESSING_METHODS = [...new Set(Object.values(PROCESSING_FURNITURE_DEFS).map(def => def.method))].concat('grindingFeed');

      // furnitureKey -> audio.objectSfx key for that machine's distinctive
      // "product's ready" cue (see makeProcessingFurniture's onAction) ‚Äî
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

      // ‚îÄ‚îÄ Decorative / interior furniture ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ
      // These are placed inside the house. Each has a GLB model in assets/models/furniture/.
      // area: 'interior' = house only, 'farm' = farm only, 'any' = either
      const DECORATIVE_FURNITURE_DEFS = {
        basicBed:      { itemKey: 'basicBedFurniture',      icon: 'üõèÔ∏è', name: 'Single Bed',          modelFile: 'basicbed_single_refined.glb',  price: 35, fw: 1, fd: 2, color: 0x8b6540, area: 'interior', desc: 'A comfortable single bed for restful sleep.' },
        doubleBed:     { itemKey: 'doubleBedFurniture',     icon: 'üõèÔ∏è', name: 'Double Bed',           modelFile: 'basicbed_double_refined.glb',  price: 55, fw: 2, fd: 2, color: 0x8b6540, area: 'interior', desc: 'A spacious double bed.' },
        bedroll:       { itemKey: 'bedrollFurniture',       icon: 'üõå', name: 'Bedroll',              modelFile: 'bedroll_folded.glb',            price: 12, fw: 1, fd: 1, color: 0x6b8c5e, area: 'interior', desc: 'A simple folded bedroll for sleeping rough.' },
        bench:         { itemKey: 'benchFurniture',         icon: 'ü™ë', name: 'Short Bench',          modelFile: 'bench_short.glb',              price: 18, fw: 2, fd: 1, color: 0x7a5c3a, area: 'interior', desc: 'A short wooden bench.', sit: true },
        bookshelf:     { itemKey: 'bookshelfFurniture',     icon: 'üìö', name: 'Bookshelf',            modelFile: 'bookshelf_low.glb',            price: 28, fw: 2, fd: 1, color: 0x6b4a28, area: 'interior', desc: 'A low bookshelf.' },
        bucket:        { itemKey: 'bucketFurniture',        icon: 'ü™£', name: 'Tin Bucket',           modelFile: 'bucket_tin.glb',               price: 8,  fw: 1, fd: 1, color: 0x888888, area: 'any',      desc: 'A utilitarian tin bucket.' },
        candleTable:   { itemKey: 'candleTableFurniture',   icon: 'üïØÔ∏è', name: 'Candle Table',         modelFile: 'candle_table.glb',             price: 15, fw: 1, fd: 1, color: 0x5a4020, area: 'interior', desc: 'Small table with a candle for warm light.', light: { color: 0xffaa44, intensity: 0.7, distance: 5, height: 0.55 } },
        chairSimple:   { itemKey: 'chairSimpleFurniture',   icon: 'ü™ë', name: 'Simple Chair',         modelFile: 'chair_simple.glb',             price: 12, fw: 1, fd: 1, color: 0x7a5c3a, area: 'interior', desc: 'A plain wooden chair.', sit: true },
        chairCushion:  { itemKey: 'chairCushionFurniture',  icon: 'ü™ë', name: 'Cushioned Chair',      modelFile: 'chair_with_blue_cushion.glb',  price: 22, fw: 1, fd: 1, color: 0x3a5c8a, area: 'interior', desc: 'A chair with a soft blue cushion.', sit: true },
        chest:         { itemKey: 'chestFurniture',         icon: 'üì¶', name: 'Storage Chest',        modelFile: 'chest_storage.glb',            price: 32, fw: 1, fd: 1, color: 0x6b4a28, area: 'interior', desc: 'Sturdy wooden chest for storage.' },
        crateStack:    { itemKey: 'crateStackFurniture',    icon: 'üì¶', name: 'Crate Stack',          modelFile: 'crate_stack.glb',              price: 14, fw: 1, fd: 1, color: 0x8a6a3a, area: 'any',      desc: 'A stack of wooden crates.' },
        copperBarrel:  { itemKey: 'copperBarrelFurniture',  icon: 'üõ¢Ô∏è', name: 'Copper Barrel',        modelFile: 'barrel_copper_hoop.glb',       price: 20, fw: 1, fd: 1, color: 0xb87333, area: 'any',      desc: 'A sturdy copper-hooped barrel.' },
        desk:          { itemKey: 'deskFurniture',          icon: '‚úçÔ∏è', name: 'Writing Desk',         modelFile: 'desk_writing.glb',             price: 38, fw: 2, fd: 1, color: 0x6b4a28, area: 'interior', desc: 'A fine writing desk with drawers.' },
        dresser:       { itemKey: 'dresserFurniture',       icon: 'üóÑÔ∏è', name: 'Low Dresser',          modelFile: 'dresser_low.glb',              price: 30, fw: 2, fd: 1, color: 0x6b4a28, area: 'interior', desc: 'A low dresser with drawers.' },
        hearth:        { itemKey: 'hearthFurniture',        icon: 'üî•', name: 'Hearth Fireplace',     modelFile: 'hearth_fireplace.glb',         price: 60, fw: 2, fd: 1, color: 0x5a4a3a, area: 'interior', desc: 'A stone fireplace for warmth and cooking.', light: { color: 0xff7722, intensity: 1.4, distance: 7, height: 0.4 }, sfxKey: 'fireplace' },
        // A portable camp, not ordinary decor ‚Äî customPlace opts it out of
        // the generic tile-grid "Place" button/canPlaceDecorativeFurnitureAt
        // path (computeActionButtons/firePendingAction give it its own
        // "Set Up Campfire" button and window.WildernessCampfire.placeFromKit
        // instead), since only one can ever be placed and it's aimed
        // anywhere in the wild rather than snapped to farm/interior tiles.
        campfire:      { itemKey: 'campfireKitFurniture',   icon: 'üî•', name: 'Campfire Kit',         price: 15, fw: 1, fd: 1, color: 0x6d3e20, area: 'any', desc: 'A portable campfire kit. Select it, aim at open ground anywhere in the wild, and use Action 1 to make camp.', customPlace: true },
        loom:          { itemKey: 'loomFurniture',          icon: 'üß∂', name: 'Small Loom',           modelFile: 'loom_small.glb',               price: 45, fw: 1, fd: 2, color: 0x8a6a3a, area: 'interior', desc: 'A small loom for weaving cloth.' },
        nightstand:    { itemKey: 'nightstandFurniture',    icon: 'üïØÔ∏è', name: 'Nightstand',           modelFile: 'nightstand.glb',               price: 18, fw: 1, fd: 1, color: 0x6b4a28, area: 'interior', desc: 'A small bedside table.', light: { color: 0xffaa44, intensity: 0.5, distance: 4, height: 0.5 } },
        rug:           { itemKey: 'rugFurniture',           icon: 'üß∂', name: 'Woven Rug',            modelFile: 'rug_woven_small.glb',          price: 22, fw: 2, fd: 2, color: 0x8a5a3a, area: 'interior', walkable: true, desc: 'A small decorative woven rug.' },
        standingLamp:  { itemKey: 'standingLampFurniture',  icon: 'üí°', name: 'Bronze Standing Lamp', modelFile: 'standing_lamp_bronze.glb',     price: 28, fw: 1, fd: 1, color: 0xb87333, area: 'interior', desc: 'A tall bronze oil lamp.', light: { color: 0xffc266, intensity: 0.9, distance: 6, height: 1.3 } },
        statue:        { itemKey: 'statueFurniture',        icon: 'üóø', name: 'Weathered Statue',     modelFile: 'statue_weathered.glb',         price: 30, fw: 1, fd: 1, color: 0x54585e, area: 'any',      desc: 'A weathered stone statue, worn by time.' },
        stool:         { itemKey: 'stoolFurniture',         icon: 'ü™ë', name: 'Round Stool',          modelFile: 'stool_round.glb',              price: 10, fw: 1, fd: 1, color: 0x7a5c3a, area: 'any',      desc: 'A simple round stool.', sit: true },
        tableLong:     { itemKey: 'tableLongFurniture',     icon: 'üçΩÔ∏è', name: 'Long Table',           modelFile: 'table_long.glb',               price: 42, fw: 4, fd: 1, color: 0x7a5c3a, area: 'interior', desc: 'A long communal dining table.' },
        tableRound:    { itemKey: 'tableRoundFurniture',    icon: 'üçΩÔ∏è', name: 'Round Table',          modelFile: 'table_round.glb',              price: 28, fw: 2, fd: 2, color: 0x7a5c3a, area: 'interior', desc: 'A round wooden dining table.' },
        tableSmall:    { itemKey: 'tableSmallFurniture',    icon: 'üçΩÔ∏è', name: 'Small Table',          modelFile: 'table_small.glb',              price: 18, fw: 1, fd: 1, color: 0x7a5c3a, area: 'interior', desc: 'A small side table.' },
        wardrobe:      { itemKey: 'wardrobeFurniture',      icon: 'üö™', name: 'Tall Wardrobe',        modelFile: 'wardrobe_tall.glb',            price: 48, fw: 2, fd: 1, color: 0x6b4a28, area: 'interior', desc: 'A tall wardrobe for clothing storage.' },
        washTub:       { itemKey: 'washTubFurniture',       icon: 'üõÅ', name: 'Copper Wash Tub',      modelFile: 'wash_tub_copper.glb',          price: 25, fw: 1, fd: 1, color: 0xb87333, area: 'any',      desc: 'A copper tub for bathing or laundry.' },
        counter:       { itemKey: 'counterFurniture',       icon: 'üè™', name: 'Shop Counter',          modelFile: 'counter_shop.glb',             price: 40, fw: 3, fd: 1, color: 0x7a5c3a, area: 'interior', desc: 'A sturdy shop counter for conducting business.' },
        // Drenkirra nests ‚Äî the bucket preset's shape, halved in height and
        // colored yellow (see procedural-furniture.js's nestRecipe). Two
        // footprints out of the same recipe: a small one for a nest lashed
        // to a climbable branch, and the existing den-nest size (2x2, same
        // as the marker _denNests previously placed by hand) for the ones
        // still found in caverns/dens for other species.
        nestBranch:    { itemKey: 'nestBranchFurniture',    icon: 'ü™∫', name: 'Branch Nest',          modelFile: 'nest_branch.glb',              price: 0,  fw: 1, fd: 1, color: 0xc9a227, area: 'any',      desc: 'A woven nest lashed to a branch.', fixture: true },
        nest:          { itemKey: 'nestFurniture',          icon: 'ü™∫', name: 'Nest',                 modelFile: 'nest_den.glb',                 price: 0,  fw: 2, fd: 2, color: 0xc9a227, area: 'any',      desc: 'A large woven nest.', fixture: true },
        // Game-authored fixtures (fixture: true) ‚Äî spawned by the game itself
        // inside specific building interiors (see BUILDING_FIXTURE_INTERACTABLES
        // below), never bought/carried by the player, so they're excluded from
        // DECORATIVE_FURNITURE_CATALOG just below. They're still ordinary
        // mapData.furniture entries otherwise: placeable, moveable and
        // duplicateable in the Interior Editor like anything else.
        alchemyTable:  { itemKey: 'alchemyTableFurniture',  icon: '‚öóÔ∏è', name: 'Alchemy Table',        price: 0,  fw: 1, fd: 1, color: 0x6b4a8a, area: 'interior', desc: 'A cauldron table for brewing potions.', fixture: true },
        bulletinBoard: { itemKey: 'bulletinBoardFurniture', icon: 'üìã', name: 'Bulletin Board',       price: 0,  fw: 1, fd: 1, color: 0x8a6a3a, area: 'interior', desc: 'A notice board for public tasks and favors.', fixture: true },
        // Barn-interior-only fixtures (see synthesizeBarnInteriorMapData) ‚Äî
        // procedurally placed the same way alchemyTable/bulletinBoard are
        // placed by an authored map, just synthesized instead of authored.
        feedGrinder:   { itemKey: 'feedGrinderFurniture',   icon: '‚öôÔ∏è', name: 'Feed Grinder',         price: 0,  fw: 1, fd: 1, color: 0x8f8a78, area: 'interior', desc: 'Grinds a held crop, raw meat, or fish into Plant/Meat Fodder for barn troughs.', fixture: true },
        trough:        { itemKey: 'troughFurniture',        icon: 'ü™£', name: 'Feed Trough',          price: 0,  fw: 1, fd: 1, color: 0x8a6a3a, area: 'interior', desc: 'Holds up to a week of feed (7 units) for one housed animal.', fixture: true },
      };

      const DECORATIVE_FURNITURE_CATALOG = Object.entries(DECORATIVE_FURNITURE_DEFS)
        .filter(([, def]) => !def.fixture)
        .map(([, def]) => ({
          key: def.itemKey, icon: def.icon, name: def.name, desc: def.desc,
          price: def.price, gives: { [def.itemKey]: 1 }, category: 'furniture'
        }));

      // ‚îÄ‚îÄ Authored furniture (docs/config/furniture-authored/*.json) ‚îÄ‚îÄ‚îÄ‚îÄ
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

      // ‚îÄ‚îÄ Furniture blueprints ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ
      // Every processing station (PROCESSING_FURNITURE_CATALOG) and
      // decorative piece (DECORATIVE_FURNITURE_CATALOG) is built from a
      // blueprint ‚Äî bought from the carpenter's shop instead of the
      // finished piece itself ‚Äî plus wood and stone gathered with the axe
      // and pick. See renderCarpenterShopPage (sells the blueprint) and
      // renderCraftingPanel/craftFurnitureFromBlueprint (builds the
      // finished item from an owned blueprint + materials, in the
      // Inventory's Crafting tab).
      function blueprintItemKey(furnitureItemKey) {
        return furnitureItemKey + 'Blueprint';
      }
      // A rough-and-ready cost curve derived from the old outright price ‚Äî
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
        // A permanent, reusable unlock (see craftFurnitureFromBlueprint ‚Äî
        // building from a blueprint only ever spends Wood/Stone, never the
        // blueprint itself), so it's priced above the finished piece's own
        // price rather than a fraction of it.
        price: Math.max(15, Math.round(item.price * 1.5)),
        craftCost: furnitureCraftCost(item.price),
        category,
      }));

      const LIVESTOCK_CATALOG = [
        { key: 'puktuk',   icon: 'üêê', name: 'Puktuk',   desc: 'Coming soon: meat, milk, and wool livestock.', price: 120, comingSoon: true },
        { key: 'nelk',     icon: 'üêî', name: 'Nelk',     desc: 'Coming soon: meat, eggs, and mayonnaise chain.', price: 90,  comingSoon: true },
        { key: 'uumkaoiiCrate', icon: 'ü¶Ü', name: 'Uumkao‚Äôii Crate', desc: 'A travel crate with one uumkao‚Äôii inside. Add it to the farm‚Äôs livestock from the Farm tab.', price: 150, gives: { uumkaoiiCrate: 1 }, category: 'livestock' },
        { key: 'nazgraku', icon: 'ü¶É', name: 'Nazgraku', desc: 'Coming soon: meat, eggs, and combat-leaning produce.', price: 160, comingSoon: true },
        { key: 'drenkirra', icon: 'ü™ø', name: 'Drenkirra', desc: 'Coming soon: meat, eggs, and agile produce.', price: 140, comingSoon: true },
        { key: 'grehlr',   icon: 'ü¶®', name: 'Grehlr',   desc: 'Coming soon: meat and denatured stink oil.', price: 130, comingSoon: true },
        { key: 'voorgAss', icon: 'ü´è', name: 'Voorg-Ass', desc: 'Coming soon: meat and white milk.', price: 135, comingSoon: true },
      ];

      const SUPPLY_CATALOG = [
        { key: 'needlegrainSeeds',   icon: 'üåæ', name: 'Needlegrain Seeds',   desc: 'Dry-default grain. Ideal water 20‚Äì50%.', price: 5, gives: { needlegrainSeeds: 3 } },
        { key: 'heftrootSeeds',      icon: 'üü°', name: 'Heftroot Seeds',      desc: 'Starchy root crop. Ideal water 25‚Äì55%.', price: 6, gives: { heftrootSeeds: 3 } },
        { key: 'garlinkSeeds',       icon: 'üßÑ', name: 'Garlink Seeds',       desc: 'Pungent broth-base crop. Ideal water 15‚Äì45%.', price: 4, gives: { garlinkSeeds: 3 } },
        { key: 'ongyumsSeeds',       icon: 'üßÖ', name: 'Ongyums Seeds',       desc: 'Aromatic crop. Ideal water 35‚Äì70%.', price: 4, gives: { ongyumsSeeds: 3 } },
        // Berry seeds are intentionally not sold ‚Äî all 5 varieties grow wild
        // across the wilderness zones instead (see WILD_BERRY_ZONES) and
        // have a small chance to yield a seed when foraged.
        { key: 'blackMustardSeed',   icon: '‚ö´', name: 'Black Mustard Seed',  desc: 'Hot mustard crop. Ideal water 15‚Äì40%.', price: 6, gives: { blackMustardSeed: 2 } },
        { key: 'greenMustardSeed',   icon: 'ü•¨', name: 'Green Mustard Seed',  desc: 'Fresh mustard crop. Ideal water 30‚Äì65%.', price: 6, gives: { greenMustardSeed: 2 } },
        { key: 'mulchBag',           icon: 'üçÇ', name: 'Mulch Bag',           desc: 'Boosts soil recovery and gives clearing material.', price: 3, gives: { mulch: 5 } },
        // Furniture (processing stations and decorative pieces) is no longer
        // mail-order-able ‚Äî see FURNITURE_BLUEPRINT_CATALOG. Blueprints are
        // bought from the carpenter's shop instead, then built yourself from
        // the Inventory's Crafting tab using wood, stone, and the blueprint.
        ...LIVESTOCK_CATALOG
      ];

      // ‚îÄ‚îÄ Named wares pools ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ
      // A dialogue tree's "openShop" action names a pool instead of a menu
      // id directly ‚Äî the indirection Creation Kit's Leveled Lists use for
      // exactly this reason: a hand-authored (or tool-authored) dialogue
      // node just says "open pool X", and X's actual UI can be whatever
      // menu currently implements it, without the tree needing to know menu
      // ids. Every pool listed here already has its own dedicated menu pane
      // + render function (see openMenu/switchMenuPanel); this registry
      // only decides which pane a pool opens. The values below are just the
      // synchronous startup default ‚Äî docs/config/shops/shop-stock.json
      // (authored via docs/tools/loot-shop-editor/) is the real source of
      // truth and overwrites this wholesale once loadLootShopConfig()
      // resolves (see _applyLoadedShopStock).
      let WARES_POOLS = {
        generalStoreWares:  { label: "Funji & Son's General Store",  menuId: 'generalStore'  },
        carpenterBarnPlans: { label: "Dzibim Khibu's Carpentry",     menuId: 'carpenterShop' },
        jubmirWares:        { label: "Jubmir's Wares",               menuId: 'jubmirShop'    },
      };

      // ‚îÄ‚îÄ General Store catalog (Funji & Son's) ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ
      // Synchronous startup default, same as WARES_POOLS above ‚Äî overwritten
      // from docs/config/shops/shop-stock.json once it loads.
      let GENERAL_STORE_CATALOG = [
        { key: 'mulchBag',      icon: 'üçÇ', name: 'Mulch Bag',      desc: 'Boosts soil recovery and clears weeds.',        price: 3,  gives: { mulch: 5 } },
        // Furniture used to be sold outright here (bucket/copperBarrel/
        // crateStack/stool/candleTable/washTub/counter) ‚Äî see
        // FURNITURE_BLUEPRINT_CATALOG. Buy the blueprint from the carpenter's
        // shop instead, then build it yourself from the Inventory's Crafting
        // tab using wood, stone, and the blueprint.
      ];

      // Synchronous startup default ‚Äî overwritten from docs/config/shops/
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
      // (window.Mounts) ‚Äî see window.Mounts.init(...) below for the wiring.
      const hostileObjects = new Set();   // Ambient-spawned hostile creatures (Gar-wolf / Gar-wolf Alpha).
      const corpseObjects = new Set();    // Creatures mid-death-lerp ('dying') or settled and lootable ('corpse').

      // Preload uumkao'ii sprite; animals check this before spawning.
      let uumkaoiiSpriteImage = null;
      { const _img = new Image(); _img.onload = () => { uumkaoiiSpriteImage = _img; }; _img.src = "assets/creaturesprites/uumkao'ii.png"; }

      // ‚îÄ‚îÄ Food processing furniture ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ
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
      // Barrel/Aging Vase ‚Äî literal aging, not an instant press) take this
      // many in-game days once started, uniformly across every recipe under
      // those two methods (existing berry Wine included) rather than some
      // outputs being instant and others delayed on the same furniture type.
      const AGING_DURATION_DAYS = 3;
      const AGING_METHODS = new Set(['barrelAging', 'vaseAging']);

      // How long an instant-process (mashing/squeezing/grinding/drying/
      // smoking) plays its processingWarp + particle burst for ‚Äî aging
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

        // ‚îÄ‚îÄ Processing VFX (docs/js/authored-furniture-runtime.js) ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ
        // Reuses whatever processingWarps/particleEmitters this piece's
        // authored data carries ‚Äî no-ops entirely for furniture keys with
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
              return [{ icon: 'ü´ó', label: `Squeezing‚Ä¶ ${seconds}s`, action: 'obj_process_' + furnitureKey, style: 'secondary', allowed: false }];
            }
            if (isAging && job) {
              const daysLeft = Math.max(0, job.readyDay - calendar.day);
              if (daysLeft > 0) {
                return [{ icon: '‚è≥', label: `Aging‚Ä¶ ${daysLeft} day${daysLeft === 1 ? '' : 's'} left`, action: 'obj_process_' + furnitureKey, style: 'secondary', allowed: false }];
              }
              const outDef = job.outputs[0];
              return [{ icon: outDef.icon, label: `Collect ${outDef.label}`, action: 'obj_process_' + furnitureKey, style: 'primary', allowed: true }];
            }
            const active = getActiveInventoryItem();
            const outputs = active ? getProcessingOutputs(def.method, active.key) : null;
            const output = outputs ? outputs[0] : null;
            return [{
              icon: output ? def.icon : '‚Ä¶',
              label: output ? processButtonLabel(def.method, active.key, output) : methodIdleLabel(def.method),
              action: 'obj_process_' + furnitureKey,
              style: output ? 'primary' : 'secondary',
              allowed: Boolean(output && (inventory[active.key] || 0) > 0),
            }];
          },
          onAction(action) {
            if (action !== 'obj_process_' + furnitureKey) return { ok: false, message: 'Unknown processor action.' };
            if (job?.kind === 'timed') return { ok: false, message: `${def.name} is still squeezing ‚Äî ${Math.max(1, Math.ceil(timedJobRemainingS()))}s left.` };
            if (isAging && job) {
              if (calendar.day < job.readyDay) return { ok: false, message: 'Still aging ‚Äî not ready yet.' };
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
        return { ok: true, message: `${PROCESSING_FURNITURE_DEFS[obj.furnitureKey]?.icon || '‚öôÔ∏è'} ${PROCESSING_FURNITURE_DEFS[obj.furnitureKey]?.name || 'Processing furniture'} moved.` };
      }

      function rotateProcessingFurniture(id, degrees = 45) {
        const obj = processingFurnitureById(id);
        if (!obj) return { ok: false, message: 'Processing furniture not found.' };
        obj.rotYDeg = ((obj.rotYDeg || 0) + degrees + 360) % 360;
        obj.mesh.rotation.y = obj.rotYDeg * Math.PI / 180;
        saveFarmLayout();
        return { ok: true, message: `${PROCESSING_FURNITURE_DEFS[obj.furnitureKey]?.icon || '‚öôÔ∏è'} ${PROCESSING_FURNITURE_DEFS[obj.furnitureKey]?.name || 'Processing furniture'} rotated 45¬∞.` };
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
        return { ok: true, message: `${def?.icon || '‚öôÔ∏è'} ${def?.name || 'Processing furniture'} returned to inventory.` };
      }

      function clearPlacedProcessingFurniture() {
        processingFurnitureObjects.forEach(obj => {
          worldObjects.delete(obj.col + ',' + obj.row);
          obj.reset && obj.reset();
        });
        processingFurnitureObjects.clear();
      }

      // Per-frame processing-station VFX (processingWarps + particleEmitters)
      // ‚Äî see makeProcessingFurniture's updateVfx. Farm-only (processingFurnitureObjects
      // only ever holds farm objects), called from the main loop alongside
      // updateDewPileMeshRotations.
      function updateProcessingFurnitureVfx(dt) {
        processingFurnitureObjects.forEach(obj => obj.update && obj.update(dt));
      }

      // ‚îÄ‚îÄ Decorative furniture (interior) ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ
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
            interactIcon: 'üò¥',
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

      // worldObjects is farm-scene-only (see its declaration) ‚Äî a sittable
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
        return { ok: true, message: `${def?.icon || 'ü™ë'} ${def?.name || 'Furniture'} moved.` };
      }

      function removeDecorativeFurniture(id) {
        const obj = interiorFurnitureObjects.find(o => o.id === id && o.area === currentArea);
        if (!obj) return { ok: false, message: 'Furniture not found.' };
        const def = DECORATIVE_FURNITURE_DEFS[obj.key];
        disposeDecorativeFurniture(obj, true);
        saveFarmLayout();
        refreshItemScroll();
        return { ok: true, message: `${def?.icon || 'ü™ë'} ${def?.name || 'Furniture'} returned to inventory.` };
      }

      function rotateDecorativeFurniture(id, degrees = 45) {
        const obj = interiorFurnitureObjects.find(o => o.id === id && o.area === currentArea);
        if (!obj) return { ok: false, message: 'Furniture not found.' };
        const nextRot = ((obj.rotYDeg || 0) + degrees + 360) % 360;
        if (!canPlaceDecorativeFurnitureAt(obj.col, obj.row, obj.id, obj.key, nextRot)) {
          return { ok: false, message: 'Cannot rotate here ‚Äî the turned furniture would overlap a wall or another item.' };
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
        return { ok: true, message: `${def?.icon || 'ü™ë'} ${def?.name || 'Furniture'} rotated 45¬∞.` };
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
      // own doubled block ‚Äî see js/house-pieces.js's demolish()) and
      // refunds each one to the farm's storage box (the same
      // _loadWorldStorage/_saveWorldStorage the Farm tab's Storage pane
      // already uses), rather than the player's personal inventory ‚Äî this
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

      // ‚îÄ‚îÄ Furniture placer ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ
      // Item key of an owned decor furniture piece armed for click-to-place
      // ‚Äî same shape as the farm editor's own brush toggle (see
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

      // ‚îÄ‚îÄ Farm editor ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ
      let farmEditMode = false;
      let farmEditBrushType = 'terrain'; // 'terrain'|'crop'|'object'|'furniture'|'decor'|'erase'
      let farmEditBrush = 'grass';
      let _editorPainting = false;

      function toggleFarmEditMode() {
        // The farm editor freely repaints tiles/crops and drops/removes
        // furniture with no per-brush permission checks, so it's gated at
        // this single entry point instead ‚Äî only the farm's owner can open it.
        if (!farmEditMode && !isFarmOwner()) {
          showToast("Only the farm's owner can use the farm editor.", false);
          return;
        }
        farmEditMode = !farmEditMode;
        const panel = document.getElementById('farmEditorPanel');
        const btn   = document.getElementById('farmEditBtn');
        if (panel) panel.style.display = farmEditMode ? 'flex' : 'none';
        if (btn)   btn.classList.toggle('fed-open', farmEditMode);
        if (farmEditMode) showToast('Farm editor active ‚Äî click tiles to paint.', true);
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

      // ‚îÄ‚îÄ Farm layout persistence ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ
      // Namespaced per world so separate worlds never bleed into each other's
      // farm. worldId isn't known until onboarding's hobunjiPlayerReady event
      // fires (after this module's synchronous init already ran once), so
      // early calls fall back to the legacy unnamespaced key ‚Äî spawnPlayerAvatar
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
          // Movable buildings ‚Äî every house piece (starter + built/
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
          // architectural features) ‚Äî independent of any one piece's
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
              // persisting real growth progress ‚Äî fall back to the previous
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
      // proper route with its own paved brick surface ‚Äî see worldRoutes).
      // That raw stub got persisted into every save the first time it ran
      // (its tile.type differs from createDayOneTile's own default, so
      // saveFarmLayout always wrote it out explicitly), so simply removing
      // the stamp from createInitialGrid doesn't clear it from saves that
      // already have it ‚Äî applyFarmLayoutToGrid would just restore it from
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
        // House pieces ‚Äî initWorldObjects() already seeded the starter piece
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
        // ‚Äî independent of any one piece's position, so restored
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
        // which always runs first (see the two call sites) ‚Äî this just builds
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
      // design intent ‚Äî "the existing livestock items, just renamed" ‚Äî
      // rather than inventing a separate egg/baby item system. All three
      // farm-deployable species (uumkao'ii, gar-wolf, dabinggi-hound) have
      // a LIVESTOCK_FACTORIES entry and go through the exact same
      // window.FarmAnimals.addFromItem ‚Üí stasis ‚Üí assignToBarn ‚Üí
      // wander/day-night-barn path ‚Äî there's nothing uumkao'ii-specific
      // about any of it. dabinggiHoundEgg has no Den-Mother source (dabinggi-
      // hound isn't a hostile wild-pack species, so it has no "-den-mother"
      // CREATURE_DB entry ‚Äî see DEN_MOTHER_ITEM_KEYS below) ‚Äî its only
      // source is Jubmir's daily trader stock (see _loadJubmirStock).
      // Kept here (not in js/farm-animals.js) since it's also read by the
      // Inventory panel outside that module.
      const LIVESTOCK_ITEM_KINDS = window.SCRATCHBONES_CONFIG?.game?.livestock?.itemKinds || {};

      // Den-Mother CREATURE_DB key -> which item her nest hands out ‚Äî read
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

      // ‚îÄ‚îÄ Chair sitting (docs/config/furniture-authored seat anchors) ‚îÄ‚îÄ
      // Same lerp-in/lerp-out shape as beginHarvestInteraction, but
      // indefinite-duration: the player stays seated (camera zoomed tight,
      // free 360¬∞ look via the 'seated' camera mode) until they explicitly
      // stand, rather than auto-releasing after a fixed timer. See
      // updateSitInteraction's early-return in the main tick and
      // computeActionButtons'/useActiveAction's top-priority sitInteraction
      // checks for the "Stand" override.
      let sitInteraction = null;
      const SIT_TRANSITION_S = 0.35; // matches HARVEST_TRANSITION_S's quick-lerp feel

      // ‚îÄ‚îÄ NPC gathering points: walk-to navigation, not teleport ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ
      // { path:[{col,row},...], npcId, label } while an auto-walk is in
      // progress toward a nearby NPC's current schedule spot, else null.
      // Player-driven the whole way ‚Äî see advancePlayerAutoWalk's use in
      // updateMovement, which feeds computed direction through the exact
      // same ix/iy ‚Üí speed/collision pipeline manual input uses, and any
      // real manual input cancels it outright rather than fighting it.
      // Tracks whether the player had real movement input last frame ‚Äî used
      // by updateMovement's stuck-recovery check to fire only on the
      // idle‚Üímoving edge (the instant a movement key/stick is first
      // pressed), not every single frame the player happens to be moving.
      let _playerWasMoving = false;
      let playerAutoWalk = null;
      const PLAYER_AUTOWALK_ARRIVE_PX = TILE * 0.35;
      const PLAYER_AUTOWALK_PATH_PADDING_TILES = 10;
      const NPC_GATHERING_NEARBY_TILES = 16; // "nearby" scope for the walk-to list ‚Äî a screen's-width-ish radius, not the whole map.

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

      // Sets a walk-to destination toward `npcId`'s current schedule spot ‚Äî
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

      // Populates the Map tab's "Nearby" list ‚Äî see nearbyNpcGatheringPoints/
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
      // relative ‚Äî see docs/js/authored-furniture-runtime.js) into this
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
        // FACING is (cos(targetAngle), sin(targetAngle)) in (X,Z) ‚Äî camera
        // needs to sit on the OPPOSITE side (the character's back), i.e. at
        // world azimuth atan2(-cos(targetAngle), -sin(targetAngle)), which
        // simplifies to 270¬∞ ‚àí targetAngle(deg).
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
          // Movement input can't actually move a seated character ‚Äî redirect
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
            // when landing back in shoulder-surf ‚Äî don't stomp that back to
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
        // neck bone exclusively (a continuous eye-contact aim at the NPC ‚Äî
        // see its own comment) ‚Äî step aside entirely rather than fighting
        // it with a second, different rotation write on the same bone.
        if (dialogueOpen) return;
        if (characterViewMode.enabled) {
          playerNeckJoint.rotation.x = characterViewMode.lockedNeckX;
          playerNeckJoint.rotation.y = characterViewMode.lockedNeckY;
          return;
        }
        // Shoulder-surf: the head locks onto the shared aim point
        // (mouseLookAngle ‚Äî see updateShoulderSurfReticleAim's screen-center
        // raycast) rather than the camera's own raw azimuth. Those two agree
        // when the camera looks straight at the player, but a horizontal
        // camera-offset slide points the camera at a spot beside the player
        // instead ‚Äî using the raycast's actual ground target keeps the head
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
        // weapon-idle-body-yaw-runtime.js) never touch it directly ‚Äî they
        // only reach playerMesh through PlayerBodyTransformComposer's
        // render-time world delta. Left out, the neck counters only the
        // pre-delta resting yaw and the head renders off-target by whatever
        // yaw the active channels are about to add.
        const composerYawDelta = window.PlayerBodyTransformComposer?.resolvedYawDeltaRad?.() || 0;
        playerNeckJoint.rotation.y = angleDiff(targetWorldYaw, playerMesh.rotation.y + composerYawDelta);
        // Purely cosmetic head nod matching the camera's own up/down tilt
        // (cameraAngleOffsetDeg ‚Äî how far the player has pitched the camera
        // off the mode's neutral framing) ‚Äî this rig has no other pitch
        // consumer, so a plain local X rotation on the neck bone (not a
        // world-yaw-style correction like above) is enough. Scaled down from
        // the camera's own pitch range since a flat cutout head tilting a
        // full ¬±45¬∞ reads as exaggerated compared to the same swing on an
        // actual 3D head.
        playerNeckJoint.rotation.x = activeCameraMode === SHOULDER_SURF_MODE
          ? THREE.MathUtils.degToRad(cameraAngleOffsetDeg) * 0.6
          : 0;
      }

      // Interactable used by both getInteriorInteractableAt (interior scene)
      // and the farm's worldObjects registration (see placeDecorativeFurniture/
      // registerSitWorldObject) ‚Äî same onAction shape either call site expects.
      function makeSitInteractable(furnitureKey, col, row, fw, fd, rotYDeg) {
        return {
          interactIcon: 'üí∫',
          interactLabel: 'Sit',
          getButtons() {
            return [{ icon: 'üí∫', label: 'Sit', action: 'obj_sit', style: 'primary', allowed: !sitInteraction }];
          },
          onAction(action) {
            if (action !== 'obj_sit' && action !== 'obj_interact') return { ok: false, message: 'Unknown action.' };
            return beginSitInteraction(furnitureKey, col, row, fw, fd, rotYDeg, 0);
          },
        };
      }

      function makeCookingInteractable() {
        return {
          interactIcon: 'üî•',
          interactLabel: 'Cook',
          getButtons() {
            return [{ icon: 'üî•', label: 'Cook', action: 'obj_cook', style: 'primary', allowed: true }];
          },
          onAction(action) {
            if (action !== 'obj_cook' && action !== 'obj_interact') return { ok: false, message: 'Unknown action.' };
            return window.CookingSystem.openAtHearth();
          },
        };
      }


      // ‚îÄ‚îÄ Companion & hostile creatures (Whistle system + Combat system) ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ
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
      // dabinggi-hound) ‚Äî mirrors _creatureTexCache's URL-keyed pattern but
      // keyed by (kind, frame, genotype signature) instead, since the actual
      // pixels come from an async canvas composite (see
      // creature-genetics-render.js) rather than a static file. While a
      // signature's compose is still in flight, callers fall back to the
      // species' plain (uncolored) sprite ‚Äî see setCreatureFrame below.
      const _genotypeTexCache = { front: new Map(), back: new Map() };
      const _genotypeTexPending = new Set();
      // Every key this function has ever logged a "kicking off compose" line
      // for ‚Äî so a creature stuck retrying every tick (see
      // updateCreatureAnimFrame's needsRetry loop) logs its request/failure
      // ONCE per (kind,frame,signature) instead of spamming the debug panel
      // every frame while it waits.
      const _genotypeTexLogged = new Set();
      // key -> performance.now() of its most recent failure ‚Äî see the
      // cooldown check in _getGenotypeTextures below.
      const _genotypeTexFailedAt = new Map();
      // Kinds confirmed to have no CreatureGeneticsRender.SPECIES entry ‚Äî
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
          window.__farmLog?.(`[genotype-render] _getGenotypeTextures(${kind},${frame}): window.CreatureGeneticsRender is not loaded ‚Äî creature-genetics-render.js failed to load or hasn't run yet`, 'warn');
          return null;
        }
        if (!genotype) return null;
        if (_genotypeUnsupportedKinds.has(kind)) return null;
        if (!renderer.SPECIES[kind]) {
          _genotypeUnsupportedKinds.add(kind);
          window.__farmLog?.(`[genotype-render] _getGenotypeTextures(${kind},${frame}): "${kind}" has no CreatureGeneticsRender.SPECIES entry ‚Äî will never render a genotype, skipping permanently instead of retrying`, 'warn');
          return null;
        }
        const sig = renderer.genotypeSignature(kind, genotype);
        const key = `${kind}|${frame}|${sig}|${blinkShut ? 'b' : 'o'}`;
        if (_genotypeTexCache.front.has(key)) {
          return { front: _genotypeTexCache.front.get(key), back: _genotypeTexCache.back.get(key) };
        }
        // A key that just failed (thrown or resolved null) gets a short
        // cooldown before it's allowed to retry ‚Äî without this, a
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
            window.__farmLog?.(`[genotype-render] _getGenotypeTextures(${kind},${frame}): cache miss, sig="${sig}" blink=${blinkShut} ‚Äî kicking off composeFrame`, 'wildlife');
          }
          renderer.composeFrame(kind, frame, genotype, blinkShut).then(canvas => {
            _genotypeTexPending.delete(key);
            if (!canvas) {
              _genotypeTexFailedAt.set(key, performance.now());
              window.__farmLog?.(`[genotype-render] _getGenotypeTextures(${kind},${frame}): composeFrame resolved null for sig="${sig}" ‚Äî falling back to plain sprite (see composeFrame's own log line just above for why)`, 'warn');
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
            window.__farmLog?.(`[genotype-render] _getGenotypeTextures(${kind},${frame}): composeFrame THREW for sig="${sig}" ‚Äî ${err?.stack || err}`, 'error');
          });
        }
        return null;
      }
      // Returns true when a real composited texture (not the plain
      // fallback) got applied ‚Äî updateCreatureAnimFrame uses this to keep
      // retrying a genotype creature's current frame every tick until its
      // specific (kind,frame,signature) compose actually finishes, instead
      // of a global "something somewhere finished" signal (the previous
      // design: a single shared generation counter bumped by ANY frame's
      // compose finishing, anywhere, for any creature ‚Äî which let a
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
      // 1375√ó600, but if the art itself doesn't reach the canvas's bottom
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

      // The prism (avatarRef.group ‚Äî see updateCreatureMesh's "Prism (group)
      // tracks the raw aim angle..." comment) keeps its true, unpadded size:
      // its floor is local Y = -halfH exactly as CREATURE_DB's modelWidth/
      // modelHeight define it, which is what places it correctly at surfY
      // and is what any future hitbox/collision use of that size would
      // expect. The correction belongs on the PLANE meshes themselves
      // (children of the prism), not on the prism's own placement: shifting
      // them down by the padding's share of modelHeight moves the art's
      // real opaque bottom onto the prism's actual floor without changing
      // the prism's own footprint at all. bottomRatio=1 (no padding) gives
      // an offset of 0 ‚Äî the plane stays exactly where it started.
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
        // New creature art is not required to use the legacy 1375√ó600 canvas.
        // Definitions with a different source canvas provide its width/height
        // ratio so the avatar plane preserves the uploaded sprite's aspect.
        const modelHeight = modelWidth * (def.spriteAspect || (600 / 1375));
        const sizeScale = window.CreatureGenetics.creatureSizeScale(creatureKey, opts.genotype); // Applies Animation Author size-class values in-world.
        const authoredGroundOffset = window.CreatureGenetics.creatureGroundOffset(creatureKey, opts.genotype); // Optional absolute floor-to-origin lift measured in Rigging; null means keep automatic half-height placement.
        const halfH = modelHeight * sizeScale.y / 2; // Existing automatic prism floor-to-origin distance, retained as the fallback and physical half-height.
        const groundLift = Number.isFinite(authoredGroundOffset) ? authoredGroundOffset : halfH; // Replaces, rather than adds to/subtracts from, the automatic terrain baseline.
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
        // creatures (gar-wolf/dabinggi-hound) ‚Äî their sprite is about to be
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
          window.__farmLog?.(`[genotype-render] makeCreatureEntity(${creatureKey}): genotype attached, genotypeKind="${genotypeKind}", ${supported ? 'SUPPORTED by CreatureGeneticsRender.SPECIES ‚Äî should recolor' : 'NOT in CreatureGeneticsRender.SPECIES ‚Äî will stay on its plain default sprite, this is expected for this species'}`, 'wildlife');
        }
        const col = clamp(Math.floor(x / TILE), 0, gridCols - 1);
        const row = clamp(Math.floor(y / TILE), 0, gridRows - 1);
        const surfY = targetGrid[row]?.[col] ? tileSurfaceYInArea(targetGrid[row][col], currentArea) : 0;
        avatarRef.group.position.set(x / TILE, surfY + groundLift, y / TILE);
        _markPngPlane(avatarRef.group);
        targetScene.add(avatarRef.group);

        // Separate top-level object (not parented under avatarRef.group) so
        // it stays flat on the ground and unaffected by the body's own
        // squash (pounce crouch) or the death ragdoll's flip rotation ‚Äî
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
          groundLift, // Floor-to-origin terrain lift: authored per species+size when present, otherwise the original half-height baseline.
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
          // Whichever entity this companion follows/defends/anchors to ‚Äî
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
        window.__farmLog?.(`[size-render] ${creatureKey}: ${sizeScale.sizeClass} at ${Math.round(sizeScale.x * 100)}% √ó ${Math.round(sizeScale.y * 100)}%`, 'wildlife');
        // Shifts the plane meshes (not the prism/group itself ‚Äî see
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

      // ‚îÄ‚îÄ Loot & Shop config (docs/config/loot/loot-pools.json,
      // docs/config/shops/shop-stock.json) ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ
      // Single source of truth for every drop table and shop's stock,
      // authored via docs/tools/loot-shop-editor/. Fetched once at startup
      // alongside every other config load; every consumer below only runs
      // in response to a later gameplay event (a creature dying, a chest
      // spawning, a shop menu opening), so by the time any of them actually
      // read _lootPools/_shopStock the fetch has long since resolved ‚Äî same
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
        // file without touching the repo copy ‚Äî falls back to a direct fetch
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
      // outside of an NPC conversation ‚Äî no relationship/encounter/station
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

      // Shared 1-5 star quality roll ‚Äî fish, harvested crops, and butchered
      // meat all use this. Weighted toward the middle (3 stars most common)
      // rather than a flat 20% each, so it doesn't feel like a coin flip;
      // otherwise deliberately simple/random for now, no per-item tuning.
      function rollItemStars(skillKey) {
        return window.SkillSystem?.rollQuality(skillKey) || 3;
      }
      function starRatingText(stars) {
        return window.SkillSystem?.starRatingText(stars) || '‚òÖ'.repeat(stars) + '‚òÜ'.repeat(5 - stars);
      }

      // Settled corpses expose the same getButtons()/onAction() shape as
      // farm world objects (see makeSellCrate) so the existing action-bar
      // wiring (getWorldObjectAt ‚Üí getButtons/onAction) can loot them with
      // no special-casing. Looting is what actually despawns the sprite.
      function makeCorpseWorldObject(c) {
        // Bandits are butchered by nobody ‚Äî they get looted instead, including
        // a guaranteed drop of everything they were wearing. Same
        // getButtons()/onAction() shape, so getCorpseObjectAt below and the
        // action bar are unaware of the difference.
        if (c.isBandit) return window.BanditCamps.makeCorpseWorldObject(c);
        return {
          id: 'corpse_' + c.id,
          type: 'creature_corpse',
          promptRoot: c.avatarRef?.group || null,
          getButtons() {
            return [{ icon: 'üçñ', label: 'Butcher ' + c.def.label, action: 'obj_loot_corpse', style: 'primary', allowed: true }];
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
              parts.push((meatStars ? starRatingText(meatStars) + ' ' : '') + itemIconForKey(key) + '√ó' + qty);
            });
            const specialAmmo = window.RangedWeapons?.rollSpecialAmmoLoot?.() || 0; // Every creature corpse gets the same high-chance shared-ammo roll as bandits.
            if (specialAmmo) parts.push(`üèπ Special Ammo√ó${specialAmmo}`);
            corpseObjects.delete(c);
            despawnCreature(c);
            return {
              ok: true,
              message: parts.length ? `Butchered the ${c.def.label}: ${parts.join(' ')}` : `Nothing usable left on the ${c.def.label}.`,
            };
          },
        };
      }

      // Zone-aware corpse lookup ‚Äî getWorldObjectAt only otherwise covers
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

      // dmgOpts: { tag: 'sharp'|'blunt'|'poison', heavy: boolean } ‚Äî routes
      // through the resource-afflictions system (bleeding/bruising/wounded
      // stamina/etc, plus the heavy-consumes-Bruised-Health bonus) instead
      // of a plain health subtraction. See docs/js/combat/resource-system.js.
      // A captain's Counter Shield guard window (see updateBanditGuardWindow/
      // fireBanditCounterRiposte, defined with the rest of the Bandit Gangs
      // ability AI) intercepts here, mirroring how the player's OWN Counter
      // Shield intercepts via window.Combat.setPlayerDamageInterceptor ‚Äî
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
          // Prowess ‚Äî spent on ability-upgrade choices (see combat-
          // progression.js). Not awarded for a downed companion.
          if (!c.isCompanion) {
            awardMotesOfProwess(MOTES_PER_KILL);
            window.SkillSystem?.award?.('combat', window.SkillSystem?.XP_GAINS?.combatKill || 8, 'defeated creature');
          }
          window.CreatureDeath.begin(c, fromX, fromY);
          return;
        }
        // Every attack staggers its target ‚Äî outright cancels whatever the
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
        // fighting even from outside its proximity trigger) ‚Äî that check
        // has been silently dead since territorial.js shipped, since
        // nothing was ever setting this field.
        c.lastAttackReceivedAt = performance.now();
        // A passive creature (drenkirra, uumkaoii-wild, etc. ‚Äî hostile:false,
        // so it never picks up player aggro at all, see updateHostiles'
        // aggro-pickup check) had no reaction to being attacked whatsoever
        // before this: knockback/stagger applied below, then it carried on
        // with whatever it was already doing ‚Äî no flee, no fight-back.
        // Reuses the exact 'fleeing-low-health' state wildlife-vs-wildlife
        // skirmishes already use (see wildlife-spawn.js's
        // applyWildlifeSkirmishDamage) ‚Äî beelines home ignoring aggro/prey
        // detection, then starts a re-aggro cooldown once settled. Excludes
        // companions (an incidental hit on a passive-type follower
        // shouldn't make it bolt) and a creature wildlife-territorial.js
        // already has actively defending its nest ‚Äî attacking a territorial
        // animal mid-fight should never make it flee instead; it's
        // supposed to protect its home, not bail the moment it takes a hit.
        const territorialPhase = c._territorialBehavior?.phase;
        if (c.def?.hostile === false && !c.isCompanion && territorialPhase !== 'warning' && territorialPhase !== 'fight') {
          // A drenkirra mid-forage or asleep is pinned to a branch ‚Äî
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
        // riposte instead of applying damage normally ‚Äî only one hold
        // ability can be active at a time, so this is a single settable slot.
        if (window.Combat?.tryInterceptPlayerDamage?.(resourceDamage.health, fromX, fromY)) return;
        _nestHoldT = 0; // getting hit interrupts a den-nest egg/baby take
        player._nestTakeActive = false;
        window.BanditCamps?.interruptTentHold(); // ...and a bandit-tent loot/burn, same reasoning
        if (window.ResourceSystem) window.ResourceSystem.applyDamage(player, resourceDamage.health, dmgOpts || {});
        else player.health = Math.max(0, player.health - resourceDamage.health);
        if (player.health > 0) {
          // Every attack staggers its target ‚Äî same interrupt-plus-knockback
          // rule as damageCreature above, mirrored onto whatever combo/quick-
          // attack/charged-breaker strike the player was mid-windup on.
          window.Combat?.cancelAllStaged?.();
          if (fromX !== undefined) applyKnockback(player, fromX, fromY, knockbackPxS);
          applyHitStagger(player, true, player.angle, player.x, player.y, fromX, fromY, resourceDamage.footing);
        }
        if (player.health <= 0) respawnPlayer();
      }

      // Closest Root Totem (see wilderness-map-generator.js's
      // placeRootTotems) to a given world position, within one zone only ‚Äî
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

      // 'cut' is the narrow precise poke (tags as a Sharp hit ‚Äî bleeding +
      // wounded stamina); 'slash' is the wide heavy sweep (tags as Blunt ‚Äî
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
          if (c._denHidden) continue; // Tucked out of sight in its den ‚Äî not actually there to hit.
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
      let gameFrameSerial = 0; // Identifies the current animation frame for shared auto-target and profiler work.
      let autoTargetCacheFrame = -1; // Prevents every hostile resource ring from repeating the same target search in one frame.
      let autoTargetCacheValue = null; // Stores the single target-selection result for autoTargetCacheFrame.
      // Melee-only auto-target toggle (see updateMeleeAutoTarget below) ‚Äî
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
      function computeAutoTarget() {
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
          return null;
        }
        const maxDist = rangedActive
          ? window.RangedWeapons?.playerLockRangePx?.(equipmentSlots.ranged) || TILE * 7
          : TILE * (Number(combatConfig().autoTargetRangeTiles) || 0);
        if (manualAutoTarget) {
          if (manualAutoTarget.health > 0 && manualAutoTarget.areaId === currentArea &&
              Math.hypot(manualAutoTarget.x - player.x, manualAutoTarget.y - player.y) <= maxDist) {
            return manualAutoTarget;
          }
          manualAutoTarget = null;
        }
        if (meleeActive && isDesktop && meleeAutoTargetOn) {
          const reacquired = desktopAutoTargetNearReticle(maxDist);
          if (reacquired) {
            manualAutoTarget = reacquired;
            meleeAutoTargetFreeAim = false;
            return reacquired;
          }
          meleeAutoTargetFreeAim = true;
          return null;
        }
        let best = null, bestDist = maxDist;
        for (const c of hostileObjects) {
          if (c.health <= 0 || c.areaId !== currentArea || c._denHidden) continue;
          const dist = Math.hypot(c.x - player.x, c.y - player.y);
          if (dist <= bestDist) { best = c; bestDist = dist; }
        }
        return best;
      }

      function invalidateAutoTargetCache() {
        autoTargetCacheFrame = -1;
      }

      function findAutoTarget() {
        if (autoTargetCacheFrame === gameFrameSerial) return autoTargetCacheValue;
        autoTargetCacheValue = computeAutoTarget();
        autoTargetCacheFrame = gameFrameSerial;
        return autoTargetCacheValue;
      }

      // Where a ranged shot currently flies, in the flat XY logical-angle
      // convention (atan2(y,x), matching player.angle/facingAngle) ‚Äî shared
      // by RangedWeapons.init's getPlayerAimAngle (below) and
      // updateToolMesh's ranged pose branch, which rotates the hands/tool
      // to face this instantly rather than waiting on the body. Shoulder-
      // surf mode always uses the raycast-derived shared aim point
      // (mouseLookAngle, same one the head/reticle use); the ordinary
      // camera falls back to whatever auto-target lock (if any) is
      // steering facing, then to plain body facing.
      function currentPlayerAimAngle() {
        if (activeCameraMode === SHOULDER_SURF_MODE) return mouseLookAngle;
        const target = findAutoTarget();
        return target ? Math.atan2(target.y - player.y, target.x - player.x) : player.angle;
      }

      // Vertical companion to currentPlayerAimAngle(), passed to RangedWeapons
      // as getPlayerAimPitch. An auto-target lock assists elevation the same
      // way it already assists heading ‚Äî aiming at the target's actual
      // rendered height rather than just its ground tile. With no lock,
      // pitch reuses the existing camera-tilt input (shift-drag or
      // shoulder-surf drag write cameraAngleOffsetDeg already) as manual
      // up/down aim, rather than inventing a second control scheme.
      const MAX_RANGED_AIM_PITCH_RAD = THREE.MathUtils.degToRad(60);
      function currentPlayerAimPitch() {
        const target = activeCameraMode === SHOULDER_SURF_MODE ? null : findAutoTarget();
        if (target) {
          const originY = activeSurfaceYAtWorld(player.x / TILE, player.y / TILE) + 0.55;
          const targetY = target.avatarRef?.group?.position?.y ?? (activeSurfaceYAtWorld(target.x / TILE, target.y / TILE) + 0.4);
          const horizDist = Math.hypot(target.x - player.x, target.y - player.y) / TILE;
          if (horizDist < 0.05) return 0;
          return clamp(Math.atan2(targetY - originY, horizDist), -MAX_RANGED_AIM_PITCH_RAD, MAX_RANGED_AIM_PITCH_RAD);
        }
        return clamp(-THREE.MathUtils.degToRad(cameraAngleOffsetDeg), -MAX_RANGED_AIM_PITCH_RAD, MAX_RANGED_AIM_PITCH_RAD);
      }

      // Shared player melee direction. A hostile under the centered reticle
      // converges from the player's body center to that same portrait Box3;
      // otherwise the camera/facing yaw and pitch remain authoritative.
      function currentPlayerMeleeAimDirection() {
        const focused = window.RangedWeapons?.focusedHostile?.(24);
        if (focused?.candidate?.data && window.Combat?.meleeAimSolution) {
          const aimed = window.Combat.meleeAimSolution(player, focused.candidate.data, currentPlayerAimAngle(), currentPlayerAimPitch());
          return { x: aimed.direction.x, y: aimed.direction.y, z: aimed.direction.z };
        }
        const cameraRay = currentPlayerInteractionRay() || currentPlayerAimRay();
        if (cameraRay?.direction) return { ...cameraRay.direction };
        const yaw = currentPlayerAimAngle();
        const pitch = currentPlayerAimPitch();
        const horizontal = Math.cos(pitch);
        return { x: Math.cos(yaw) * horizontal, y: Math.sin(pitch), z: Math.sin(yaw) * horizontal };
      }
      function currentPlayerMeleeAimPitch() {
        const direction = currentPlayerMeleeAimDirection();
        return Math.asin(clamp(Number(direction?.y) || 0, -1, 1));
      }

      // Used by updateAmbientCues() to duck exploration/dawn music during a
      // fight ‚Äî true whenever any live hostile in the player's current area
      // is actively chasing/attacking (state === 'chase'), regardless of
      // whether the player currently has a weapon out (unlike
      // findAutoTarget, which is gated on that ‚Äî a wolf mid-charge should
      // still cut the music even if the player hasn't drawn a weapon yet).
      function isPlayerInCombat() {
        for (const c of hostileObjects) {
          if (c.health > 0 && c.areaId === currentArea && c.state === 'chase') return true;
        }
        return false;
      }

      // Swap the auto-target to the CLOSEST hostile within a cone around
      // `aimAngle` (excluding whatever is currently targeted) ‚Äî the desktop
      // swap-target input (mouse/right-stick direction) and the mobile
      // swap-target stick button both drive this. If nothing qualifies in
      // that direction, the target simply stays the same (returns false;
      // manualAutoTarget is left untouched). Hardened the same way as
      // findAutoTarget ‚Äî a weapon has to actually be equipped, not just the
      // weapon tool slot selected.
      const SWAP_TARGET_HALF_CONE_RAD = Math.PI / 2;
      function swapAutoTarget(aimAngle) {
        const meleeActive = heldMode === 'tool' && activeTool === 'weapon' && !!equipmentSlots.weapon;
        const rangedActive = heldMode === 'tool' && activeTool === 'ranged' && !!equipmentSlots.ranged;
        if (!meleeActive && !rangedActive) return false;
        const current = findAutoTarget();
        const maxDist = rangedActive
          ? window.RangedWeapons?.playerLockRangePx?.(equipmentSlots.ranged) || TILE * 7
          : TILE * (Number(combatConfig().autoTargetRangeTiles) || 0);
        let best = null, bestDist = Infinity;
        for (const c of hostileObjects) {
          if (c.health <= 0 || c.areaId !== currentArea || c === current || c._denHidden) continue;
          const dx = c.x - player.x, dy = c.y - player.y;
          const dist = Math.hypot(dx, dy);
          if (dist > maxDist || dist < 0.001 || dist >= bestDist) continue;
          const angleToC = Math.atan2(dy, dx);
          if (Math.abs(angleDiff(angleToC, aimAngle)) > SWAP_TARGET_HALF_CONE_RAD) continue;
          bestDist = dist; best = c;
        }
        if (!best) return false;
        manualAutoTarget = best;
        meleeAutoTargetFreeAim = false;
        invalidateAutoTargetCache();
        return true;
      }

      // Melee-only auto-target: is the currently equipped/active tool a
      // melee weapon? (Ranged/farm tools/bare hands never engage this ‚Äî
      // ranged already went fully manual last session.)
      function meleeWeaponOut() {
        return heldMode === 'tool' && activeTool === 'weapon' && !!equipmentSlots.weapon;
      }

      // "Am I roughly looking at a targetable hostile right now" ‚Äî used
      // only to decide whether starting a melee swing should auto-engage
      // the toggle (see tryAutoEngageMeleeTarget below), not for anything
      // continuous. Reads whichever look/aim signal is actually driving
      // facing right now (shoulder-surf's camera reticle, manual mouse/
      // stick look, or plain body facing) rather than just nearest-in-
      // range regardless of where the player is pointed.
      const MELEE_AUTO_TARGET_ENGAGE_CONE_RAD = Math.PI / 4;
      function meleeAttackTargetCandidate() {
        const aimAngle = activeCameraMode === SHOULDER_SURF_MODE ? mouseLookAngle
          : controllerLookActive ? controllerLookAngle
          : (isDesktop && mouseLookActive) ? mouseLookAngle
          : player.angle;
        const maxDist = TILE * (Number(combatConfig().autoTargetRangeTiles) || 0);
        let best = null, bestDist = maxDist;
        for (const c of hostileObjects) {
          if (c.health <= 0 || c.areaId !== currentArea || c._denHidden) continue;
          const dx = c.x - player.x, dy = c.y - player.y;
          const dist = Math.hypot(dx, dy);
          if (dist > bestDist) continue;
          if (Math.abs(angleDiff(Math.atan2(dy, dx), aimAngle)) > MELEE_AUTO_TARGET_ENGAGE_CONE_RAD) continue;
          bestDist = dist; best = c;
        }
        return best;
      }

      // Turns melee auto-target on the instant an attack is thrown while
      // roughly looking at something targetable ‚Äî lets a player who's
      // never touched the toggle just swing at what they're already
      // looking at and have it pick up from there. No-ops if already on, no
      // melee weapon out, or nothing qualifies.
      function tryAutoEngageMeleeTarget() {
        if (isDesktop || meleeAutoTargetOn || !meleeWeaponOut()) return;
        const candidate = meleeAttackTargetCandidate();
        if (!candidate) return;
        manualAutoTarget = candidate;
        meleeAutoTargetOn = true;
        invalidateAutoTargetCache();
      }

      // Cycles melee auto-target's current lock among every hostile within
      // range, ordered by angle around the player ("orbitally") ‚Äî Shift+
      // wheel desktop, right-stick tilt controller, and the hidden mobile
      // joystick's left/right all drive this while a lock is already
      // active. A no-op while auto-target is off (per spec, cycling only
      // matters once there's something to cycle among) or with no
      // candidates in range.
      function cycleMeleeAutoTarget(direction) {
        if (!meleeAutoTargetOn || !meleeWeaponOut()) return;
        const maxDist = TILE * (Number(combatConfig().autoTargetRangeTiles) || 0);
        const candidates = Array.from(hostileObjects)
          .filter(c => c.health > 0 && c.areaId === currentArea && !c._denHidden && Math.hypot(c.x - player.x, c.y - player.y) <= maxDist)
          .map(c => ({ c, angle: Math.atan2(c.y - player.y, c.x - player.x) }))
          .sort((a, b) => a.angle - b.angle);
        if (!candidates.length) return;
        const current = findAutoTarget();
        let idx = candidates.findIndex(entry => entry.c === current);
        idx = idx === -1 ? 0 : (idx + direction + candidates.length) % candidates.length;
        manualAutoTarget = candidates[idx].c;
        meleeAutoTargetFreeAim = false;
        invalidateAutoTargetCache();
      }

      // Drives melee auto-target's actual aim, once per frame (see its call
      // site in gameLoop, right before updateMovement) ‚Äî by simulating
      // exactly the input a real mouse/stick would give, not a separate
      // hard override: in shoulder-surf that means smoothly turning the
      // camera itself (mouseLookAngle then follows for free via
      // updateShoulderSurfReticleAim, same as manual mouse-look/the touch
      // joystick already do); in the ordinary camera it means driving
      // mouseLookAngle/controllerLookAngle directly, exactly the values
      // manual input already feeds into updateMovement's FACING section.
      const MELEE_AUTO_TARGET_CAMERA_DEG_PER_SEC = 320;
      function updateMeleeAutoTarget(dt) {
        if (!meleeWeaponOut()) { meleeAutoTargetOn = false; return; }
        if (!meleeAutoTargetOn) return;
        const target = findAutoTarget();
        if (!target) return;
        const aimAngle = Math.atan2(target.y - player.y, target.x - player.x);
        if (activeCameraMode === SHOULDER_SURF_MODE) {
          const targetAzimuthDeg = wrapAzimuthDeg(-(aimAngle * 180 / Math.PI) - 90 - (cameraModeConfig(SHOULDER_SURF_MODE).azimuthDeg ?? 0));
          const diffDeg = angleDiff(THREE.MathUtils.degToRad(targetAzimuthDeg), THREE.MathUtils.degToRad(cameraAzimuthOffsetDeg)) * 180 / Math.PI;
          const maxStepDeg = MELEE_AUTO_TARGET_CAMERA_DEG_PER_SEC * dt;
          cameraAzimuthOffsetDeg = wrapAzimuthDeg(cameraAzimuthOffsetDeg + clamp(diffDeg, -maxStepDeg, maxStepDeg));
        } else {
          mouseLookAngle = aimAngle;
          targetAimAngle = aimAngle;
          mouseLookActive = true;
          lastMouseMoveTime = performance.now();
          controllerLookAngle = aimAngle;
          controllerLookActive = true;
        }
      }

      // Shared by hostiles, companions, and wandering creatures ‚Äî covers every
      // creature movement path with a single footstep hook.
      function tickCreatureFootsteps(c, distPx) {
        if (c.areaId !== currentArea) return; // not in the player's current area; inaudible
        if (!Number.isFinite(c.x) || !Number.isFinite(c.y)) return; // belt-and-suspenders: see moveCreatureToward/creatureCanEnterTile's own NaN guards
        if (!window.AudioSystem?.footstepAdvance(c, distPx)) return;
        const distToPlayer = Math.hypot(c.x - player.x, c.y - player.y);
        if (distToPlayer > window.AudioSystem.FOOTSTEP_EARSHOT_PX) return;
        // Linear, not squared ‚Äî squared falloff made anything past ~30% of
        // earshot drop to near-silence, which was most of the usable range.
        const falloff = Math.max(0, 1 - distToPlayer / window.AudioSystem.FOOTSTEP_EARSHOT_PX);
        const tile = window.AudioSystem?.footstepTileAt(c.areaId, c.x, c.y, c.areaGrid);
        // Whistled companions stay quiet (like the player) and unpanned ‚Äî
        // hostiles/wild creatures get the full directional treatment.
        if (c.isCompanion) { window.AudioSystem?.playFootstepSfx(c.areaId, tile, falloff * window.AudioSystem.FOOTSTEP_QUIET_SCALE); return; }
        const pan = Math.max(-1, Math.min(1, (c.x - player.x) / window.AudioSystem.FOOTSTEP_PAN_RANGE_PX));
        window.AudioSystem?.playFootstepSfx(c.areaId, tile, falloff, pan);
      }

      // Terrain/structure gate for creature movement ‚Äî unlike tileSpeedAt
      // (used by the player), cliff faces and water crossings stay soft
      // (speed penalties only, for creatures without canClimb/canSwim ‚Äî see
      // isCreatureClimbing/isCreatureSwimming and moveCreatureToward's
      // CLIMB_SPEED_MUL/SWIM_SPEED_MUL slowdowns), and scattered rock/shrub
      // terrain stays unblocked too (deliberately out of scope ‚Äî these are
      // dense enough on wilderness terrain that hard-blocking them would be
      // a much bigger wander/patrol behavior change than what was asked).
      // What this DOES now block: real structures ‚Äî farm buildings/
      // furniture/crates (worldObjects) and the house, town buildings, and
      // zone buildings/animal dens ‚Äî the same "walked straight through a
      // wall" gap the player's own tileSpeedAt never had. moveCreatureToward
      // already does axis-separated movement, so a creature blocked here
      // slides along the obstacle's edge instead of freezing, exactly like
      // the player's own wall collision.
      function creatureCanEnterTile(def, wx, wy) {
        // A NaN/Infinite coordinate compares false against every bound
        // check below (NaN is never < or >= anything), so without this it
        // would silently pass through as "allowed" and let a corrupted
        // target position get written into c.x/c.y ‚Äî from there it poisons
        // every distance calc downstream (footstep falloff, aggro range,
        // etc.), eventually crashing far away from where it actually went
        // wrong (see audio-system.js's non-finite .volume guard).
        if (!Number.isFinite(wx) || !Number.isFinite(wy)) return false;
        const aC = getActiveCols(), aR = getActiveRows();
        if (wx < 0 || wy < 0 || wx >= aC * TILE || wy >= aR * TILE) return false;
        const col = Math.floor(wx / TILE), row = Math.floor(wy / TILE);
        if (currentArea === 'farm' && (worldObjects.has(col + ',' + row) || isHouseFootprint(col, row))) return false;
        if (currentArea === 'town' && isTownBuildingCollisionTile(col, row)) return false;
        if (_isZoneArea(currentArea) && isTownBuildingCollisionTile(col, row, currentArea)) return false;
        return true;
      }

      // True while `x,y` sits in a river/stream tile and `canSwim` is
      // falsy ‚Äî shared by the player (isPlayerSwimming) and creatures
      // (isCreatureSwimming) to drive both the movement slowdown and the
      // attack lockout.
      function isSwimmingAt(x, y, canSwim, grid) {
        if (canSwim) return false;
        const g = grid || getActiveGrid();
        const col = Math.floor(x / TILE), row = Math.floor(y / TILE);
        const type = g[row]?.[col]?.type;
        return type === TileType.RIVER || type === TileType.STREAM;
      }

      // The player has no canSwim tag of their own today.
      function isPlayerSwimming() {
        return isSwimmingAt(player.x, player.y, false, getActiveGrid());
      }

      function isCreatureSwimming(c) {
        return isSwimmingAt(c.x, c.y, c.def?.canSwim, c.areaGrid);
      }

      // True while a creature without canClimb is standing on a cliff-face
      // (incline) tile ‚Äî same pattern as isCreatureSwimming, drives
      // moveCreatureToward's CLIMB_SPEED_MUL slowdown. A canClimb creature
      // scales cliffs at full speed.
      function isCreatureClimbing(c) {
        if (c.def?.canClimb) return false;
        const g = c.areaGrid || getActiveGrid();
        const col = Math.floor(c.x / TILE), row = Math.floor(c.y / TILE);
        return !!g[row]?.[col]?.incline;
      }

      function moveCreatureToward(c, tx, ty, speed, dt) {
        // A NaN/undefined target (e.g. a momentarily-gone companion master,
        // a stale reference) must never reach the position math below ‚Äî dist
        // would come out NaN, every subsequent comparison against it is
        // silently false rather than throwing, and c.x/c.y would end up
        // permanently NaN with nothing downstream ever catching it directly.
        if (!Number.isFinite(tx) || !Number.isFinite(ty)) { c.vx = 0; c.vy = 0; return false; }
        const dx = tx - c.x, dy = ty - c.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 1) { c.vx = 0; c.vy = 0; return false; }
        const directionMul = window.RangedWeapons?.movementDirectionMultiplier?.(c) || 1; // Disorient inverts normal movement AI at this shared choke point.
        const nx = dx / dist * directionMul, ny = dy / dist * directionMul;
        const baseSpeed = speed * devGlobalSpeedMul;
        const effectiveSpeed = isCreatureSwimming(c) ? baseSpeed * SWIM_SPEED_MUL : isCreatureClimbing(c) ? baseSpeed * CLIMB_SPEED_MUL : baseSpeed;
        const step = Math.min(dist, effectiveSpeed * dt);
        // Axis-separated so a creature turned back by a cliff face or river
        // slides along it instead of freezing outright (mirrors the player's
        // collision in updateMovement).
        const prevX = c.x, prevY = c.y;
        const desiredX = c.x + nx * step, desiredY = c.y + ny * step;
        if (creatureCanEnterTile(c.def, desiredX, c.y)) c.x = desiredX;
        if (creatureCanEnterTile(c.def, c.x, desiredY)) c.y = desiredY;
        const moved = Math.hypot(c.x - prevX, c.y - prevY);
        c.vx = nx * effectiveSpeed; c.vy = ny * effectiveSpeed;
        if (moved > 0) tickCreatureFootsteps(c, moved);
        return moved > 0;
      }

      // Grid-walkability predicate for TilePathfinding, expressed in tile
      // coordinates ‚Äî reuses creatureCanEnterTile at the tile's center so
      // the pathfinder's notion of "blocked" always matches what actual
      // movement will (and won't) let a creature step onto.
      function creatureTileWalkable(col, row) {
        return creatureCanEnterTile(null, (col + 0.5) * TILE, (row + 0.5) * TILE);
      }

      const CREATURE_STUCK_THRESHOLD_S = 0.6;
      const CREATURE_PATH_REPLAN_DIST_PX = TILE * 3;
      const CREATURE_PATH_SEARCH_PADDING_TILES = 6;

      // Wraps moveCreatureToward for "travel to a fixed point" behaviors ‚Äî
      // returning home, patrol legs, grazing/drinking trips, a companion
      // catching up to a far-off player ‚Äî where getting stuck against a
      // structure (now that creatureCanEnterTile actually blocks them)
      // would be a visible regression with nothing to route around it.
      // Direct combat chase/patrol-chase/wander deliberately keep calling
      // moveCreatureToward directly instead of this: its axis-separated
      // slide-along-the-wall is enough there, and rerouting mid-chase would
      // perturb the carefully-tuned attack-range triggering built around a
      // straight line to the target. Cheap in the unobstructed common case
      // ‚Äî a path is only computed once real movement stalls for
      // CREATURE_STUCK_THRESHOLD_S, then followed hop-by-hop until the
      // creature is close enough to fall back to the direct approach, the
      // real target has moved far enough to invalidate it, or it goes stale.
      function travelCreatureToward(c, tx, ty, speed, dt) {
        const dist = Math.hypot(tx - c.x, ty - c.y);
        if (dist < TILE * 0.5) { c._travelPath = null; c._travelStuckT = 0; return moveCreatureToward(c, tx, ty, speed, dt); }

        if (c._travelPath && c._travelPath.length) {
          if (!c._travelPathTarget || Math.hypot(tx - c._travelPathTarget.x, ty - c._travelPathTarget.y) > CREATURE_PATH_REPLAN_DIST_PX) {
            c._travelPath = null; // real target moved on ‚Äî stale path, fall through to a fresh attempt
          } else {
            const wp = c._travelPath[0];
            const wx = (wp.col + 0.5) * TILE, wy = (wp.row + 0.5) * TILE;
            const moving = moveCreatureToward(c, wx, wy, speed, dt);
            if (Math.hypot(c.x - wx, c.y - wy) < TILE * 0.35) c._travelPath.shift();
            return moving;
          }
        }

        const moving = moveCreatureToward(c, tx, ty, speed, dt);
        if (moving) { c._travelStuckT = 0; return moving; }
        c._travelStuckT = (c._travelStuckT || 0) + dt;
        if (c._travelStuckT < CREATURE_STUCK_THRESHOLD_S) return moving;
        c._travelStuckT = 0;
        const startCol = Math.floor(c.x / TILE), startRow = Math.floor(c.y / TILE);
        const targetCol = Math.floor(tx / TILE), targetRow = Math.floor(ty / TILE);
        const path = window.TilePathfinding?.findPath(startCol, startRow, targetCol, targetRow, creatureTileWalkable, {
          bounds: window.TilePathfinding.boxAround(startCol, startRow, targetCol, targetRow, CREATURE_PATH_SEARCH_PADDING_TILES),
        });
        if (path && path.length) { c._travelPath = path; c._travelPathTarget = { x: tx, y: ty }; }
        return moving;
      }

      function wanderTick(c, dt, anchorX, anchorY, radiusPx) {
        c.wanderT -= dt;
        if (!c.wanderTarget || c.wanderT <= 0) {
          const ang = rnd() * Math.PI * 2;
          const r = rnd() * radiusPx;
          c.wanderTarget = { x: anchorX + Math.cos(ang) * r, y: anchorY + Math.sin(ang) * r };
          c.wanderT = 1.5 + rnd() * 2;
        }
        return moveCreatureToward(c, c.wanderTarget.x, c.wanderTarget.y, c.def.moveSpeed * 0.5, dt);
      }

      // A ground companion settled near the player (see the "settle" branch
      // of updateCompanions below) used to pick its idle wander points from
      // a plain disk centered on the player ‚Äî including points arbitrarily
      // close to (or right on top of) them. This keeps that same wander
      // rhythm but samples from a donut instead: its hole is the player's
      // own "personal space" (1.5x the player's actual rendered portrait
      // width, so it scales with whatever avatar is currently equipped),
      // and its outer edge sits one more portrait-width further out, giving
      // the ring some visible thickness rather than pinning to one exact
      // distance.
      function _companionPersonalSpacePx() {
        return 1.5 * (playerAvatarModelWidth || 0.9) * TILE;
      }
      function _companionFollowWanderTick(c, dt, master) {
        c.wanderT -= dt;
        if (!c.wanderTarget || c.wanderT <= 0) {
          // Kept safely inside FOLLOW_FAR_PX (the "gone too far, catch up"
          // trigger below) so a freshly-picked wander target never sits
          // just past it and immediately yanks the companion back into
          // chase ‚Äî and the inner/outer clamps guarantee a real ring even
          // for a hypothetical unusually wide portrait.
          const maxOuterPx = FOLLOW_FAR_PX * 0.9;
          const innerPx = Math.min(_companionPersonalSpacePx(), maxOuterPx * 0.8);
          const outerPx = Math.max(innerPx + TILE * 0.2, Math.min(innerPx + (playerAvatarModelWidth || 0.9) * TILE, maxOuterPx));
          const ang = rnd() * Math.PI * 2;
          const r = innerPx + rnd() * (outerPx - innerPx);
          c.wanderTarget = { x: master.x + Math.cos(ang) * r, y: master.y + Math.sin(ang) * r };
          c.wanderT = 1.5 + rnd() * 2;
        }
        return moveCreatureToward(c, c.wanderTarget.x, c.wanderTarget.y, c.def.moveSpeed * 0.5, dt);
      }

      function updateCreatureMesh(c, dt, aimAngle) {
        const g = c.areaGrid || grid;
        const col = clamp(Math.floor(c.x / TILE), 0, (c.areaCols || COLS) - 1);
        const row = clamp(Math.floor(c.y / TILE), 0, (c.areaRows || ROWS) - 1);
        // A creature stationed onBranch (see wildlife-spawn.js's Nestmother
        // spawn) uses that branch's own height instead of terrain-follow ‚Äî
        // same override the player gets while climbing/on a branch.
        const surfY = c.onBranch ? c.branchSurfaceY : (g[row]?.[col] ? tileSurfaceYInArea(g[row][col], c.areaId) : 0);
        const grp = c.avatarRef.group;
        // scaleY (driven by attacks like Pounce, default 1) squashes the
        // sprite plane vertically around its own bottom edge rather than its
        // center ‚Äî the target height keeps the creature's feet grounded at
        // surfY instead of sinking into the floor as it crouches.
        const scaleY = c.scaleY ?? 1;
        const vocalHeadNodDeg = window.AnimalVocalizations?.headNodOffsetDeg?.(c) || 0; // Added to the live neck pose below; body scale and collision remain untouched.
        c.avatarRef?.setHeadAdditiveRotation?.(vocalHeadNodDeg);
        const meleeLeapY = c._banditLungeHopCurrent || 0; // Used by pitched enemy lunges to raise the actual rendered body/hitbox volume.
        const tx = c.x / TILE, tz = c.y / TILE, ty = surfY + (c.groundLift ?? c.halfHeight) * scaleY + meleeLeapY;
        if (c._wildlifeVisualLodJustWoke) {
          grp.position.set(tx, ty, tz);
          c._wildlifeVisualLodJustWoke = false;
        } else {
          grp.position.x += (tx - grp.position.x) * Math.min(1, dt * 10);
          grp.position.z += (tz - grp.position.z) * Math.min(1, dt * 10);
          grp.position.y += (ty - grp.position.y) * Math.min(1, dt * 7);
        }
        // Bob animation when moving ‚Äî mirrors the player's own effort-based
        // move bob (updateMovement): amplitude ramps from the calm-walking
        // baseline up to the full-effort peak as speed approaches this
        // bandit's own max (def.moveSpeed, scaled by the same
        // devGlobalSpeedMul moveCreatureToward already applies to it), not a
        // flat distance. Not applied to ordinary wildlife: an animal's plane
        // is already grounded by its own idle/run frame art ‚Äî only bandits
        // (which share the player's humanoid avatar rig) get it.
        if (c.isBandit) {
          const banditSpeed = Math.hypot(c.vx || 0, c.vy || 0);
          if (banditSpeed > 5) {
            const bobEffort = clamp(banditSpeed / ((c.def.moveSpeed || MOVE_SPEED) * devGlobalSpeedMul), 0, 1);
            grp.position.y += Math.sin(performance.now() / 120) * (MOVE_BOB_WALK_AMP + (MOVE_BOB_RUN_AMP - MOVE_BOB_WALK_AMP) * bobEffort);
          }
        }
        const breathScaleY = window.CreatureGenetics.creatureBreathScaleY(c.avatarRef, performance.now());
        window.CreatureGenetics.applyCreatureBillboardScale(grp, { x: c.visualScaleX, y: c.visualScaleY }, scaleY * breathScaleY); // Preserves both authored size axes through attack squash, plus a subtle idle breathing multiplier.
        // Tracks the body's own smoothed XZ (not the raw target, and not
        // its squash/height) so the shadow doesn't lead a fast-moving
        // creature or float with it during a pounce crouch.
        if (c.groundShadow) c.groundShadow.position.set(grp.position.x, surfY + characterGroundShadowSurfaceOffset(), grp.position.z);
        if (window.ResourceRings) {
          const ringRadius = clamp((c.visualModelWidth || c.def.modelWidth || 2) * .34, .2, 2.6);
          const ringScene = c.scene || scene;
          // Only hostiles are ever a weapon auto-target (see findAutoTarget) ‚Äî
          // a red target-lock ring renders around a hostile's resource rings
          // while it's the current target (see resource-rings.js).
          // Ranged still shows its lock unconditionally (unaffected by the
          // melee-only auto-target toggle below); melee only shows it once
          // that toggle is actually on, so the ring never lies about a hit
          // that isn't really being auto-aimed.
          const isTarget = !c.isCompanion && c === findAutoTarget()
            && (activeTool === 'ranged' || meleeAutoTargetOn);
          const ringHud = window.ResourceRings.updateRingHud(c, ringScene, ringRadius, { isTarget });
          ringHud.position.set(grp.position.x, surfY + characterGroundShadowSurfaceOffset(), grp.position.z);
        }

        // def.aimAngleOffset is a fixed correction for a creature whose avatar
        // doesn't follow buildAnimalPlaneAvatarModel's side-view plane
        // convention ‚Äî only bandits set it today (see buildBanditAvatar), and
        // it's 0/absent for every CREATURE_DB animal.
        const rawTargetRotY = -((aimAngle ?? 0) + (c.def.aimAngleOffset || 0)) + Math.PI / 2;

        // Prism (group) tracks the raw aim angle freely ‚Äî deadzone only governs
        // the interior PNG plane, not the prism's spatial orientation or the
        // movement/targeting logic that drives aimAngle.
        c.groupRot += angleDiff(rawTargetRotY, c.groupRot) * Math.min(1, dt * 10);
        grp.rotation.y = c.groupRot;

        // PNG planes get a separate deadzone from the prism, never freely
        // tracking rawTargetRotY straight through it ‚Äî exactly which of the
        // three sway/halt/snap implementations below governs that deadzone
        // is picked by CREATURE_PLANE_ROT_MODE (see its definition, up near
        // perpClamp/creatureDeadzoneTarget/creatureSnapSwayTarget) and can
        // change independently of this call site, so don't infer the active
        // behavior from this comment ‚Äî read that constant.
        c.pngRot ??= c.groupRot;
        if (window.PerpRotation.CREATURE_PLANE_ROT_MODE === 'snap') {
          const creatureIsMoving = Math.hypot(c.vx || 0, c.vy || 0) > 5;
          const { target: pngTarget, snap } = window.PerpRotation.creatureSnapSwayTarget(c.perpState, rawTargetRotY, cameraRelativeCreaturePerps(), window.PerpRotation.CREATURE_PERP_DEAD_RAD, dt, creatureIsMoving);
          if (snap) c.pngRot = pngTarget;
          else c.pngRot += angleDiff(pngTarget, c.pngRot) * Math.min(1, dt * 10);
        } else if (window.PerpRotation.CREATURE_PLANE_ROT_MODE === 'sway') {
          const creatureIsMoving = Math.hypot(c.vx || 0, c.vy || 0) > 5;
          const pngTarget = window.PerpRotation.creatureDeadzoneTarget(c.perpState, rawTargetRotY, cameraRelativeCreaturePerps(), window.PerpRotation.CREATURE_PERP_DEAD_RAD, dt, creatureIsMoving);
          c.pngRot += angleDiff(pngTarget, c.pngRot) * Math.min(1, dt * 10);
        } else { // 'halt'
          const { effectiveTarget: pngTarget, snapTo: pngSnapTo } = window.PerpRotation.perpClamp(c.perpState, rawTargetRotY, cameraRelativeCreaturePerps(), window.PerpRotation.CREATURE_PERP_DEAD_RAD);
          if (pngSnapTo !== null) c.pngRot = pngTarget;
          else c.pngRot += angleDiff(pngTarget, c.pngRot) * Math.min(1, dt * 10);
        }
        const planeDelta = c.pngRot - c.groupRot;
        if (c.avatarRef.frontPlane) c.avatarRef.frontPlane.rotation.y = planeDelta + Math.PI / 2;
        if (c.avatarRef.backPlane)  c.avatarRef.backPlane.rotation.y  = planeDelta - Math.PI / 2;
        // Only bandits carry a legsPivot/legs pair (see buildBanditAvatar) --
        // every CREATURE_DB animal leaves both undefined, so this is a no-op
        // for them. legsPivot mirrors the planes' pngRot-derived rotation
        // (unlike a plane, no extra ¬±PI/2 twist) so the legs track whichever
        // dead-zone behavior currently governs the sprite instead of the
        // prism's own free-tracking groupRot.
        if (c.avatarRef.legsPivot) c.avatarRef.legsPivot.rotation.y = planeDelta;
        if (c.avatarRef.legs) c.avatarRef.legs.update(dt, Math.hypot(c.vx || 0, c.vy || 0) / TILE, false);
        window.ImpactRagdollPlayback?.updateCreature?.(c, dt);

        if (c.hitFlashT > 0) c.hitFlashT = Math.max(0, c.hitFlashT - dt);
        // Telegraph tell (combat-enemy-telegraph.js) takes a back seat to the
        // hit flash so "you damaged it" feedback still reads clearly even if
        // a strike lands mid-windup. Resolved every frame (not just on
        // change) so the tint always reverts cleanly once both clear.
        // A genotype-bearing creature's texture is already the correct
        // per-den color (see updateCreatureAnimFrame/composeFrame below) ‚Äî
        // def.tint is a plain species-differentiation multiply that would
        // wash a correctly-composited golden/etc. texture back toward
        // whatever hardcoded tint that species variant (e.g. gar-wolf-alpha,
        // gar-wolf-den-mother) happens to have, so skip it for those and
        // fall back to white. Combat feedback (hit flash / telegraph) still
        // applies to every creature regardless of genotype.
        const desiredTint = c.hitFlashT > 0 ? 0xff5050
          : c.telegraphState === 'strike' ? 0xffffff
          : c.telegraphState === 'windup' ? 0xffc23d
          : (c.genotype ? 0xffffff : (c.def.tint || 0xffffff));
        if (c._tintHex !== desiredTint) {
          c._tintHex = desiredTint;
          // traverse rather than a direct children walk: an animal's two sprite
          // planes are the group's own children, but a bandit's portrait planes
          // sit one level down inside their pivot groups (see buildBanditAvatar),
          // and they need the hit-flash/telegraph tint just the same.
          grp.traverse(child => {
            if (child.material) child.material.color.setHex(desiredTint);
          });
        }
      }

      // Ground covered per run-cycle frame advance ‚Äî picked so a typical
      // chase-speed creature (~200px/s) cycles at roughly the old fixed
      // 0.18s/frame cadence this replaced.
      const RUN_FRAME_STRIDE_PX = 30;

      function updateCreatureAnimFrame(c, dt, moving, runInPlace = false) {
        // A genotype-bearing creature (gar-wolf/dabinggi-hound with genes ‚Äî
        // see makeCreatureEntity's opts.genotype) needs its composited
        // texture re-applied once the async compose finishes, even if the
        // frame URL string itself hasn't changed since the fallback swap ‚Äî
        // c._genotypeReadyFrames tracks which frame keys have already
        // gotten their real (non-fallback) texture applied, so a not-yet-
        // ready frame keeps retrying every tick (cheap: a cache lookup)
        // until setCreatureFrame reports success, instead of relying on
        // any global "something finished" signal that can't tell whether
        // it was actually THIS creature's THIS frame that became ready.
        // gar-wolf-alpha/gar-wolf-den-mother are separate CREATURE_DB
        // entries (different stats) but share the plain gar-wolf's sprite
        // files and pattern assets ‚Äî window.CreatureGenetics.SPECIES_ALIAS maps them back
        // to the "gar-wolf" key CreatureGeneticsRender.SPECIES actually
        // knows, otherwise composeFrame silently no-ops for them (spec not
        // found) and they'd never render a fill/pattern at all.
        const genotypeKind = c.genotype ? (window.CreatureGenetics.SPECIES_ALIAS[c.creatureKey] || c.creatureKey) : null;
        // Item 3: eyes-open/eyes-shut blinking, layered into the same
        // genotype composite pass above the eyes' own layer (see
        // composeFrame's blinkShut param) ‚Äî only meaningful for
        // genotype-bearing creatures, since a plain (no-genotype) creature
        // never goes through composeFrame at all. blinkFrameKey folds the
        // blink state into the readiness/retry bookkeeping below so a
        // blink toggle forces a re-apply even though the underlying
        // idle/run frame key hasn't changed.
        // A sleeping drenkirra (js/wildlife-cloud-forest-behavior.js's
        // beginGoToSleep/_cfDrenkirra.mode) should stay eyes-shut the whole
        // time it's asleep, not keep cycling open/closed on the normal
        // ambient blink timer ‚Äî CreatureBlink has no notion of sleep, so
        // short-circuit it here instead of teaching a shared, per-instance
        // timer about one species' mode field.
        const asleep = c._cfDrenkirra?.mode === 'sleeping';
        const blinkShut = genotypeKind ? (asleep || (window.CreatureBlink?.isShut(c, performance.now()) || false)) : false;
        // Sprite-sheet frame cycling is animal-only. A bandit's avatar is a
        // single portrait plane baked once at spawn (see buildBanditAvatar), so
        // it has no def.sprites to swap between ‚Äî it still gets every
        // position/rotation/facing update via updateCreatureMesh, just no
        // idle/run frame swap.
        if (!c.def.sprites) return;
        if (!moving) {
          const frameKey = 'idle';
          const blinkFrameKey = frameKey + (blinkShut ? ':blink' : '');
          const needsRetry = genotypeKind && !c._genotypeReadyFrames?.has(blinkFrameKey);
          if (needsRetry && !c._genotypeLogged?.has(blinkFrameKey)) {
            (c._genotypeLogged || (c._genotypeLogged = new Set())).add(blinkFrameKey);
            window.__farmLog?.(`[genotype-render] ${c.creatureKey} #${c.id}: requesting composited "${blinkFrameKey}" texture (kind=${genotypeKind})`, 'wildlife');
          }
          if (c.currentFrameUrl !== c.def.sprites.idle || c._blinkAppliedShut !== blinkShut || needsRetry) {
            const applied = setCreatureFrame(c.avatarRef, c.def.sprites.idle, genotypeKind, frameKey, c.genotype, blinkShut);
            c.currentFrameUrl = c.def.sprites.idle;
            c._blinkAppliedShut = blinkShut;
            if (genotypeKind && applied) {
              (c._genotypeReadyFrames || (c._genotypeReadyFrames = new Set())).add(blinkFrameKey);
              window.__farmLog?.(`[genotype-render] ${c.creatureKey} #${c.id}: composited "${blinkFrameKey}" texture APPLIED`, 'wildlife');
            }
          }
          // Not tracking ground covered while idle, so resuming movement
          // doesn't "catch up" on distance never actually traveled.
          c._animLastX = c.x; c._animLastY = c.y;
          return;
        }
        // The run frame is derived from actual ground covered since the last
        // call (same accumulator pattern as _footstepAdvance/tickCreatureFootsteps
        // just above), not from elapsed dt ‚Äî dt/time only measures how fast
        // *this* client's clock ran, whereas position is exactly the thing a
        // networked peer already has to agree on, so a distance-driven frame
        // index falls out of position sync for free instead of needing its
        // own state kept in lockstep.
        const movedPx = runInPlace
          ? Math.max(0, c.def.moveSpeed * 0.5 * dt)
          : Math.hypot(c.x - (c._animLastX ?? c.x), c.y - (c._animLastY ?? c.y));
        c._animLastX = c.x; c._animLastY = c.y;
        c.runFrameDistPx = (c.runFrameDistPx || 0) + movedPx;
        while (c.runFrameDistPx >= RUN_FRAME_STRIDE_PX) {
          c.runFrameDistPx -= RUN_FRAME_STRIDE_PX;
          c.runFrame = (c.runFrame + 1) % c.def.sprites.run.length;
        }
        const url = c.def.sprites.run[c.runFrame];
        const frameKey = 'run' + (c.runFrame + 1);
        const blinkFrameKey = frameKey + (blinkShut ? ':blink' : '');
        const needsRetry = genotypeKind && !c._genotypeReadyFrames?.has(blinkFrameKey);
        if (needsRetry && !c._genotypeLogged?.has(blinkFrameKey)) {
          (c._genotypeLogged || (c._genotypeLogged = new Set())).add(blinkFrameKey);
          window.__farmLog?.(`[genotype-render] ${c.creatureKey} #${c.id}: requesting composited "${blinkFrameKey}" texture (kind=${genotypeKind})`, 'wildlife');
        }
        if (c.currentFrameUrl !== url || c._blinkAppliedShut !== blinkShut || needsRetry) {
          const applied = setCreatureFrame(c.avatarRef, url, genotypeKind, frameKey, c.genotype, blinkShut);
          c.currentFrameUrl = url;
          c._blinkAppliedShut = blinkShut;
          if (genotypeKind && applied) {
            (c._genotypeReadyFrames || (c._genotypeReadyFrames = new Set())).add(blinkFrameKey);
            window.__farmLog?.(`[genotype-render] ${c.creatureKey} #${c.id}: composited "${blinkFrameKey}" texture APPLIED`, 'wildlife');
          }
        }
      }

      const JUMP_BACK_DUR_S = 0.4;
      const JUMP_BACK_SPEED = 260;

      // Bite-attack telegraph timing, ported from the sandbox's dummy AI
      // attack (its only enemy-side attack: windup 0.54s, strike 0.20s) ‚Äî
      // reused for both hostiles and companions since they share this same
      // chase-then-bite shape.
      const BITE_TELEGRAPH_WINDUP_S = 0.54;
      const BITE_TELEGRAPH_STRIKE_S = 0.20;

      // Hitbox/aim-collider geometry shared between the AI's pounce-trigger
      // check and the debug hitbox overlay ‚Äî derived from the avatar's
      // crossed-plane "prism" base (a square of side modelWidth, in tile
      // units) rather than an arbitrary radius.
      function creatureHitboxHalfSizePx(creature) {
        return (creature.visualModelWidth || creature.def?.modelWidth || 2) * TILE / 2;
      }
      // The forward aim collider a pounce-capable creature keeps pointed at
      // its target every chase frame: a rod starting at the head-side edge
      // of its hitbox and protruding 150% of the hitbox's own length beyond
      // that edge. A pounce only triggers once the target falls inside it.
      function creatureAimColliderReachPx(creature) {
        const halfSize = creatureHitboxHalfSizePx(creature);
        return halfSize + halfSize * 2 * 1.5;
      }

      // ‚îÄ‚îÄ Slottable AI behavior-stage system ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ
      //
      // A creature whose def lists behaviorStages (e.g. gar-wolf's
      // ['pounceAttempt', 'evasiveOrbit']) cycles through those named stages
      // in order, looping back to the first once the last finishes. Every
      // stage has either a fixed time limit (def below) or an "end early"
      // condition (pounceAttempt ends the instant it commits to a pounce,
      // not when the leap finishes resolving) ‚Äî whichever comes first ends
      // the stage. After ANY stage ends, every creature using this system
      // (hostile or companion) spends a fixed ~2s backing directly away from
      // its target before the next stage starts, so a hit-and-run beat
      // separates every modular stage instead of one flowing straight into
      // the next.
      const STAGE_BACKUP_S = 2;
      const STAGE_MAX_DURATION_S = { pounceAttempt: 7, evasiveOrbit: 11 };
      const EVASIVE_ORBIT_RADIUS_MUL = 1.7; // x attackRangePx ‚Äî stays just outside biting/pounce range
      // Default head-yaw turn budget for _updateCreatureHeadLookAtWorldPoint's
      // ordinary chase-correction (a deliberately modest nudge, not an
      // anatomy claim ‚Äî see png-plane-avatar.js's DEFAULT_LIMITS, which caps
      // an unauthored rig's own minDeg/maxDeg, and therefore updateHeadYaw's
      // internal clamp, at exactly this same ¬±30¬∞ for any species with no
      // custom-authored head rig).
      const CREATURE_HEAD_YAW_LIMIT_DEG = 30;

      // evasiveOrbit's own sidestep geometry (see below: an 0.8-weighted
      // tangent blended with a 0.2-weighted radial component) needs roughly
      // 76-104¬∞ of head correction to keep eye contact with the target from
      // a body actually facing its movement ‚Äî nowhere near
      // CREATURE_HEAD_YAW_LIMIT_DEG's own tighter ordinary-chase tuning
      // value, which would leave the fallback-to-facing-target case always
      // winning and no sidestep ever visible at all. 80¬∞ is a firm ceiling
      // per explicit design direction ‚Äî the closing-in case (~76¬∞) still
      // gets a genuine sidestep, while the extreme backing-off case (~104¬∞)
      // still falls back to facing the target outright.
      const EVASIVE_ORBIT_HEAD_YAW_LIMIT_DEG = 80;

      function ensureCreatureStage(c, stages) {
        if (!c._stage || c._stage.stages !== stages) {
          c._stage = { stages, idx: 0, mode: 'active', t: 0, orbitSign: rnd() < 0.5 ? -1 : 1 };
        }
        return c._stage;
      }

      function clearCreatureStage(c) { c._stage = null; }

      function beginCreatureBackup(st) {
        st.mode = 'backingUp';
        st.t = 0;
      }

      function advanceCreatureStage(st) {
        st.idx = (st.idx + 1) % st.stages.length;
        st.mode = 'active';
        st.t = 0;
        st.orbitSign = rnd() < 0.5 ? -1 : 1;
      }

      // Drives one creature's behavior-stage cycle for one frame. target is
      // whatever it's currently oriented on (the player for a hostile, its
      // chosen hostile target for a companion). attemptAttackFn(dist) is
      // called only during the 'pounceAttempt' stage and should return true
      // the instant it commits to an attack (so the stage can end early).
      // Returns { aimAngle, moving }.
      function updateCreatureBehaviorStage(c, dt, target, def, attemptAttackFn) {
        const st = ensureCreatureStage(c, def.behaviorStages);
        st.t += dt;
        const dx = target.x - c.x, dy = target.y - c.y;
        const dist = Math.hypot(dx, dy);
        const towardAngle = Math.atan2(dy, dx);

        if (st.mode === 'backingUp') {
          const awayAngle = towardAngle + Math.PI;
          const moving = moveCreatureToward(c, c.x + Math.cos(awayAngle) * TILE, c.y + Math.sin(awayAngle) * TILE, def.moveSpeed, dt);
          if (st.t >= STAGE_BACKUP_S) advanceCreatureStage(st);
          return { aimAngle: towardAngle, moving };
        }

        const stageName = st.stages[st.idx];

        if (stageName === 'pounceAttempt') {
          const moving = moveCreatureToward(c, target.x, target.y, def.chaseSpeed, dt);
          let aimAngle = towardAngle;
          const attempted = attemptAttackFn(dist);
          if (attempted) aimAngle = c.facing;
          if (attempted || st.t >= STAGE_MAX_DURATION_S.pounceAttempt) beginCreatureBackup(st);
          return { aimAngle, moving };
        }

        if (stageName === 'evasiveOrbit') {
          const orbitRadiusPx = def.attackRangePx * EVASIVE_ORBIT_RADIUS_MUL;
          // The 20%-weighted radial pull below is exactly what keeps this
          // orbit settled right at orbitRadiusPx, so a single shared
          // threshold here flips sign almost every frame as dist hovers
          // around that boundary ‚Äî and since the body-facing decision
          // further down depends on radialSign through blendAngle, every
          // flip snapped the whole body between two very different
          // orientations, reading as a violent see-saw. Sticky/hysteresis
          // state (only flips once dist clearly crosses OUT of a dead zone
          // around the boundary, not just past it) is the same anti-chatter
          // shape LEASH_REENTER_FRAC already uses above for the identical
          // "settled right on its own threshold" problem.
          const EVASIVE_ORBIT_RADIUS_HYSTERESIS_FRAC = 0.15;
          if (st.radialSign === undefined) st.radialSign = dist > orbitRadiusPx ? 1 : -1;
          if (st.radialSign > 0 && dist < orbitRadiusPx * (1 - EVASIVE_ORBIT_RADIUS_HYSTERESIS_FRAC)) st.radialSign = -1;
          else if (st.radialSign < 0 && dist > orbitRadiusPx * (1 + EVASIVE_ORBIT_RADIUS_HYSTERESIS_FRAC)) st.radialSign = 1;
          const radialSign = st.radialSign; // 1: close the gap, -1: back off
          const tangentAngle = towardAngle + st.orbitSign * Math.PI / 2;
          const blendAngle = Math.atan2(
            Math.sin(tangentAngle) * 0.8 + Math.sin(towardAngle) * radialSign * 0.2,
            Math.cos(tangentAngle) * 0.8 + Math.cos(towardAngle) * radialSign * 0.2,
          );
          const moveX = c.x + Math.cos(blendAngle) * TILE, moveY = c.y + Math.sin(blendAngle) * TILE;
          const moving = moveCreatureToward(c, moveX, moveY, def.chaseSpeed * 0.85, dt);
          if (st.t >= STAGE_MAX_DURATION_S.evasiveOrbit) beginCreatureBackup(st);
          // Body normally turns to face the direction it's actually
          // sidestepping in, same as any other moving creature ‚Äî the head
          // (see _updateCreatureHeadLookAtCombatTarget, which reads c.facing
          // as its baseline) independently tracks the target on top of that
          // within its own yaw budget. Movement itself (moveX/moveY above)
          // never changes; only which way is a real neck twist away from
          // the target decides whether the body ALSO gets to face that way.
          // When it isn't, keep the body (and so the head, trivially) facing
          // the target instead ‚Äî reads as backpedaling/strafing backward
          // rather than a body no head could actually keep up with.
          const yawNeededDeg = Math.abs(angleDiff(towardAngle, blendAngle)) * 180 / Math.PI;
          const bodyAngle = yawNeededDeg <= EVASIVE_ORBIT_HEAD_YAW_LIMIT_DEG ? blendAngle : towardAngle;
          return { aimAngle: bodyAngle, moving };
        }

        return { aimAngle: towardAngle, moving: false };
      }

      const CREATURE_RESOURCE_TICK_INTERVAL_S = 0.1; // Used to update non-player resources at 10 Hz while preserving accumulated elapsed time.
      const FAR_CREATURE_RESOURCE_TICK_INTERVAL_S = 0.5; // Used by visually sleeping wildlife that cannot currently affect the player.
      const WILDLIFE_VISUAL_LOD_HIDE_TILES = 28; // Used to remove calm, distant wildlife from scene rendering and visual-rig updates.
      const WILDLIFE_VISUAL_LOD_SHOW_TILES = 24; // Used as the nearer wake boundary so wildlife does not flicker at one distance.
      const FAR_WILDLIFE_AI_TICK_INTERVAL_S = 0.2; // Used to advance calm hidden wildlife at 5 Hz with accumulated time instead of every render frame.
      const PREDATOR_SIGHT_INTERVAL_S = 0.25; // Used to stagger predator prey-acquisition decisions instead of repeating them every frame.
      const currentHostilesFrame = []; // Reused rather than allocated for every updateHostiles frame.
      const grazingPreyByPatchFrame = new Map(); // Reuses per-patch prey buckets while the player remains in one area.
      const EMPTY_GRAZING_PREY = Object.freeze([]); // Avoids allocating an empty fallback list for predators without a matching herbivore patch.
      let grazingPreyIndexArea = null; // Clears retained patch buckets when the active area changes.

      function tickCreatureResources(c, dt, far = false) {
        const interval = far ? FAR_CREATURE_RESOURCE_TICK_INTERVAL_S : CREATURE_RESOURCE_TICK_INTERVAL_S; // Selects the active or distant maintenance cadence.
        const step = Math.max(0, Number(dt) || 0); // Accumulates real elapsed simulation time between resource-system calls.
        if (!Number.isFinite(c._resourceTickRemainingS)) c._resourceTickRemainingS = rnd() * interval;
        c._resourceTickRemainingS = Math.min(c._resourceTickRemainingS, interval) - step;
        c._resourceTickElapsedS = (c._resourceTickElapsedS || 0) + step;
        if (c._resourceTickRemainingS > 0) return;
        const elapsed = Math.min(0.75, c._resourceTickElapsedS); // Bounds recovery catch-up after stalls or background-tab pauses.
        c._resourceTickElapsedS = 0;
        c._resourceTickRemainingS = interval;
        const opts = c._resourceTickOptions || (c._resourceTickOptions = { staminaRegenPerSec: c.maxStamina * 0.25 }); // Reuses the mutable options object instead of allocating one per tick.
        opts.staminaRegenPerSec = c.maxStamina * 0.25;
        window.ResourceSystem?.tick(c, elapsed, opts);
      }

      function wildlifeVisualLodCanHide(c) {
        if (c.isBandit || c.isCompanion || c.prone || c._branchDefense || (c.knockbackT || 0) > 0 || (c.retreatT || 0) > 0) return false;
        if (c.state === 'chase' || c.state === 'patrol-chase' || c.state === 'return' || c.state === 'fleeing-low-health') return false;
        if (window.Combat?.telegraph?.isBusy(c) || window.Combat?.animalAttacks?.isBusy(c)) return false;
        return true;
      }

      function updateWildlifeVisualLod(c, distanceTiles) {
        const eligible = wildlifeVisualLodCanHide(c); // Keeps combatants, companions, and active movement states fully simulated and rendered.
        const shouldHide = eligible && (c._wildlifeVisualLodHidden // Applies the separate wake threshold as LOD hysteresis.
          ? distanceTiles > WILDLIFE_VISUAL_LOD_SHOW_TILES
          : distanceTiles >= WILDLIFE_VISUAL_LOD_HIDE_TILES);
        if (shouldHide === !!c._wildlifeVisualLodHidden) return shouldHide;
        c._wildlifeVisualLodHidden = shouldHide;
        if (c.avatarRef?.group) c.avatarRef.group.visible = !shouldHide && !c._denHidden;
        if (c.groundShadow) c.groundShadow.visible = !shouldHide;
        if (c._ringHud) c._ringHud.visible = !shouldHide;
        if (!shouldHide) c._wildlifeVisualLodJustWoke = true;
        return shouldHide;
      }

      function updateHostiles(dt) {
        currentHostilesFrame.length = 0;
        if (grazingPreyIndexArea !== currentArea) {
          grazingPreyIndexArea = currentArea;
          grazingPreyByPatchFrame.clear();
        } else {
          for (const patchPrey of grazingPreyByPatchFrame.values()) patchPrey.length = 0;
        }
        for (const c of hostileObjects) {
          if (c.health <= 0 || c.areaId !== currentArea) continue;
          currentHostilesFrame.push(c);
          if (c.def?.diet !== 'herbivore' || c.state !== 'at-station-grazing') continue;
          const patchPrey = grazingPreyByPatchFrame.get(c.grazingPatchId) || []; // Narrows predator scans to grazing herbivores at their linked patch.
          patchPrey.push(c);
          grazingPreyByPatchFrame.set(c.grazingPatchId, patchPrey);
        }
        for (const c of currentHostilesFrame) {
          // Tucked inside its den for the off-shift/overnight branch below
          // (see the denKey settle branch) ‚Äî frozen and invisible rather
          // than idling in the open, so no AI/vocalization/stamina tick
          // runs for it until its shift or the day resumes, at which point
          // it steps back out from exactly the mouth tile it went in at.
          if (c._denHidden) {
            const stillOff = c.denKey && (window.Music?.isNightTime() || window.HobunjiCloudForestWildlife?.isPackOffShift?.(c));
            if (stillOff) continue;
            c._denHidden = false;
            if (c.avatarRef?.group) c.avatarRef.group.visible = true;
          }
          const initialDistanceTiles = Math.hypot(player.x - c.x, player.y - c.y) / TILE; // Wakes a far creature immediately when the player crosses the nearer LOD boundary.
          const initiallyLodSleeping = updateWildlifeVisualLod(c, initialDistanceTiles); // Selects full-rate or accumulated coarse simulation for this frame.
          let entityDt = dt; // Carries accumulated elapsed time through the unchanged AI state machine on coarse far-wildlife ticks.
          if (initiallyLodSleeping) {
            c._farWildlifeAiAccumS = (c._farWildlifeAiAccumS || 0) + dt;
            if (c._farWildlifeAiAccumS < FAR_WILDLIFE_AI_TICK_INTERVAL_S) continue;
            entityDt = Math.min(0.6, c._farWildlifeAiAccumS);
            c._farWildlifeAiAccumS = 0;
          } else {
            c._farWildlifeAiAccumS = 0;
          }
          window.AnimalVocalizations?.tickCreature?.(c, entityDt);
          const def = c.def;
          c.attackCooldownT = Math.max(0, c.attackCooldownT - entityDt);

          // Aggro/chase locks onto whichever player is nearest at the moment
          // it's acquired (see nearestPlayer) rather than the single global
          // `player` ‚Äî with one entry in `players` today this behaves
          // identically, but a second connected player just needs to be
          // pushed into that list for hostiles to be able to notice and
          // chase them too, with nothing else here to change. The lock
          // persists for the rest of the chase so the creature doesn't
          // flicker between equally-near players every frame.
          if (c.state !== 'chase') c.targetPlayer = null;
          const targetPlayer = c.targetPlayer || nearestPlayer(c.x, c.y);
          if (window.ClimbSystem?.updateBranchDefender?.(c, entityDt, targetPlayer)) continue;
          // Cloud-forest schedule AI (js/wildlife-cloud-forest-behavior.js)
          // parks a drenkirra on a branch to forage/sleep, outside the
          // player-facing defend hop above ‚Äî same "skip ordinary ground AI
          // entirely this frame" escape hatch, gated on its own per-creature
          // marker so it never touches the Nestmother's branch-defend flow.
          if (c.onBranch && window.HobunjiCloudForestWildlife?.updateBranchDweller?.(c, entityDt)) continue;
          const dxp = targetPlayer.x - c.x, dyp = targetPlayer.y - c.y;
          const distToPlayer = Math.hypot(dxp, dyp);
          const distFromHome = Math.hypot(c.x - c.homeX, c.y - c.homeY);
          const visuallyLodSleeping = updateWildlifeVisualLod(c, distToPlayer / TILE); // Rechecks after target selection before choosing the resource cadence.
          tickCreatureResources(c, entityDt, visuallyLodSleeping);
          // A recently-fled animal gets a grace period at home before it can
          // be re-aggro'd by the player or re-picked as ambush prey (see
          // 'fleeing-low-health' below and applyWildlifeSkirmishDamage).
          const onFleeCooldown = c._fleeCooldownUntil > performance.now();
          const livestockLookCandidate = def.hostile === false
            && !onFleeCooldown
            && distToPlayer <= LIVESTOCK_LOOK_RANGE_PX;

          // distFromHome <= leashRangePx is required to re-aggro, not just
          // distToPlayer <= aggroRangePx, specifically to break a real
          // oscillation: aggroRangePx (341) is smaller than leashRangePx
          // (550), so a player following a fleeing 'return' bandit at a
          // similar pace easily keeps distToPlayer under aggroRangePx while
          // distFromHome hovers right around leashRangePx. Without this
          // check, that flips the bandit straight back to 'chase' the
          // instant it's in aggro range regardless of how far from home it
          // still is; it then walks AWAY from home chasing the player,
          // pushing distFromHome back over leashRangePx within a frame or
          // two and re-triggering 'return' -- a genuine multi-frame
          // chase<->return flicker (not the png-plane deadzone, which only
          // ever governs the interior plane split, see updateCreatureMesh).
          // 'chase' and 'return' compute totally different facing angles
          // (toward the player vs. toward home), so this reads exactly as
          // rotational flicker between two unrelated angles, and since
          // 'return' never attacks, it also reads as "won't attack either."
          //
          // That fix alone leaves a NARROWER version of the same flicker:
          // both the re-entry check above and the leave check below compare
          // distFromHome against the exact same leashRangePx value, with no
          // gap between them. A creature whose home genuinely sits close to
          // that boundary distance can drift a single tile back and forth
          // (chasing pulls it slightly farther, a moment of 'return' pulls
          // it slightly closer) and cross the SAME threshold every time --
          // re-entering chase, immediately tripping the leave check again,
          // over and over. LEASH_REENTER_FRAC creates a dead zone: leaving
          // chase still triggers at the full leashRangePx, but re-entering
          // requires being noticeably closer to home (85% of it) again, so
          // a small drift near the boundary can't flip both checks back to
          // back.
          const LEASH_REENTER_FRAC = 0.85;
          if (def.hostile !== false && c.state !== 'chase' && c.state !== 'fleeing-low-health' && !onFleeCooldown && distToPlayer <= def.aggroRangePx && distFromHome <= def.leashRangePx * LEASH_REENTER_FRAC) { c.state = 'chase'; c.targetPlayer = targetPlayer; }
          if (c.state === 'chase' && (distToPlayer > def.leashRangePx || distFromHome > def.leashRangePx)) c.state = 'return';
          if (c.state === 'return' && distFromHome < TILE * 0.6) c.state = 'idle';

          // Patrol sighting: a predator that's out patrolling its route (or
          // fallback-wandering with no route) is alert the whole time it's
          // moving, not just when parked at one spot ‚Äî checked whenever it
          // isn't already busy with the player or another skirmish. Simple
          // radius check against grazing herbivores tied to the same foliage
          // patch (no line-of-sight system exists for creature-vs-creature
          // sight today).
          const predatorAvailable = def.diet !== 'herbivore' && !onFleeCooldown
            && c.state !== 'chase' && c.state !== 'patrol-chase' && c.state !== 'return' && c.state !== 'fleeing-low-health';
          if (predatorAvailable) {
            if (!Number.isFinite(c._predatorSightT)) c._predatorSightT = rnd() * PREDATOR_SIGHT_INTERVAL_S;
            c._predatorSightT -= entityDt;
            if (c._predatorSightT <= 0) {
              c._predatorSightT = PREDATOR_SIGHT_INTERVAL_S;
              for (const prey of (grazingPreyByPatchFrame.get(c.linkedPatchId) || EMPTY_GRAZING_PREY)) {
                if (prey === c || prey.health <= 0) continue;
                const preyDx = prey.x - c.x, preyDy = prey.y - c.y; // Feeds allocation-free box and squared-radius sight checks.
                if (Math.abs(preyDx) > PATROL_SIGHT_RANGE_PX || Math.abs(preyDy) > PATROL_SIGHT_RANGE_PX) continue;
                if (preyDx * preyDx + preyDy * preyDy > PATROL_SIGHT_RANGE_PX * PATROL_SIGHT_RANGE_PX) continue;
                c.state = 'patrol-chase'; c.targetCreature = prey;
                break;
              }
            }
          }
          // Leaving chase mid-windup (player broke the leash) abandons the
          // telegraphed bite/modular attack rather than landing it from way
          // out of range.
          if (c.state !== 'chase' && window.Combat?.telegraph?.isBusy(c)) window.Combat.telegraph.cancel(c);
          if (c.state !== 'chase' && window.Combat?.animalAttacks?.isBusy(c)) window.Combat.animalAttacks.cancel(c);
          if (c.state !== 'chase') {
            clearCreatureStage(c);
            if (c.isBandit) {
              c._banditAction?.cancel(); c._banditAction = null; c.telegraphState = null; c._banditComboIndex = 0; c._banditLunging = false;
              window.BanditCombat?.restNeckLook?.(c, entityDt);
            }
          }

          let moving = false, aimAngle = c.facing || 0;
          if (c.prone) {
            // The dedicated throw channel survives the general prone-motion
            // cleanup adapters and moves through the same swept terrain test
            // as ordinary knockback. ImpactRagdollPlayback simultaneously
            // drives the quarter-turned animal/bandit breakThrow pose.
            advanceCreatureProneThrow(c, entityDt);
            if (c.footing >= c.maxFooting && !(c.proneThrowT > 0)) beginCreatureSomersaultRecovery(c, targetPlayer);
          } else if (c.knockbackT > 0) {
            // Reeling from a hit; let the impulse play out before resuming AI.
            // Per-axis canOccupyAt check (same primitive/radius convention as
            // the player's own knockback/dodge/lunge and the pounce/guard-
            // charge leaps below) so a hard shove can't punch a creature
            // through a cliff face, water, or the map edge.
            c.knockbackT = Math.max(0, c.knockbackT - entityDt);
            const nkx = c.x + c.knockbackVX * entityDt, nky = c.y + c.knockbackVY * entityDt;
            const ckSwept = sweptMove(c.x, c.y, nkx, nky, (x, y) => canOccupyAt(x, y, TILE * 0.32));
            c.x = ckSwept.x; c.y = ckSwept.y;
            if (ckSwept.blockedX) c.knockbackVX = 0;
            if (ckSwept.blockedY) c.knockbackVY = 0;
          } else if (c.state === 'fleeing-low-health') {
            // Beelines home ignoring player/prey aggro (see the guards above)
            // until it settles, then starts its re-aggro cooldown ‚Äî nothing
            // fights to the death in a wildlife skirmish (applyWildlifeSkirmishDamage).
            if (distFromHome < DEN_SETTLE_RADIUS_PX) {
              c.state = 'idle';
              c._fleeCooldownUntil = performance.now() + WILDLIFE_FLEE_REAGGRO_COOLDOWN_MS;
              aimAngle = idleCreatureAimAngle(c.groupRot);
            } else {
              moving = travelCreatureToward(c, c.homeX, c.homeY, def.chaseSpeed || def.moveSpeed, entityDt);
              if (moving) aimAngle = Math.atan2(c.homeY - c.y, c.homeX - c.x);
            }
          } else if (c.state === 'patrol-chase') {
            // A simplified creature-vs-creature chase (no telegraph/pounce
            // theatrics ‚Äî those are built around damaging the player
            // specifically) ‚Äî beelines onto the prey and lands plain bite
            // damage through applyWildlifeSkirmishDamage on cooldown.
            const prey = c.targetCreature;
            const preyGone = !prey || prey.health <= 0 || prey.areaId !== c.areaId || prey.state === 'fleeing-low-health';
            if (preyGone) {
              c.state = 'idle'; c.targetCreature = null;
            } else {
              const pdx = prey.x - c.x, pdy = prey.y - c.y;
              const pdist = Math.hypot(pdx, pdy);
              if (pdist > (def.leashRangePx || TILE * 9) || distFromHome > (def.leashRangePx || TILE * 9)) {
                c.state = 'return'; c.targetCreature = null;
              } else {
                aimAngle = Math.atan2(pdy, pdx);
                moving = moveCreatureToward(c, prey.x, prey.y, def.chaseSpeed || def.moveSpeed, entityDt);
                const triggerRangePx = def.attackRangePx || TILE * 0.85;
                if (pdist <= triggerRangePx && c.attackCooldownT <= 0) {
                  c.attackCooldownT = def.attackCooldownS || 1.0;
                  window.WildlifeSpawn.applyWildlifeSkirmishDamage(c, prey, def.attackDamage || 8);
                }
              }
            }
          } else if (c.state === 'chase') {
            aimAngle = Math.atan2(dyp, dxp);
            if (c.isBandit) {
              // Bandits fight through their own ability-driven AI (the real
              // Combo/Quick Attack/Charged Breaker/Counter Shield numbers ‚Äî
              // see updateBanditCombatAI, defined with the rest of the
              // Bandit Gangs section) instead of the plain bite-telegraph/
              // behaviorStage machinery below, which stays wildlife-only.
              const result = window.BanditCombat.updateCombatAI(c, entityDt, targetPlayer, distToPlayer);
              aimAngle = result.aimAngle;
              moving = result.moving;
            } else if (c.retreatT > 0) {
              // Jump back after landing a bite, keeping eyes on the player.
              c.retreatT = Math.max(0, c.retreatT - entityDt);
              const awayAng = Math.atan2(-dyp, -dxp);
              moving = moveCreatureToward(c, c.x + Math.cos(awayAng) * TILE, c.y + Math.sin(awayAng) * TILE, JUMP_BACK_SPEED, entityDt);
            } else if (window.Combat?.telegraph?.isBusy(c)) {
              // Stand and wind up ‚Äî the tell (game.js's tint) is the
              // player's cue to step out of attackRangePx before the strike
              // frame's range check below fires.
              window.Combat.telegraph.update(c, entityDt);
            } else if (window.Combat?.animalAttacks?.isBusy(c)) {
              // Modular named attack (e.g. Pounce) owns position, facing,
              // scale, and sprite frame for its full duration.
              window.Combat.animalAttacks.update(c, entityDt);
              aimAngle = c.facing;
            } else if (def.behaviorStages) {
              // Slottable behavior-stage cycle (Pounce attempt <-> evasive
              // orbit, separated by a backing-up beat) replaces the plain
              // chase-and-trigger logic below for any creature that lists one.
              const result = updateCreatureBehaviorStage(c, entityDt, targetPlayer, def, (dist) => {
                // Drenkirra's 'pounce' behaviorStage entry actually resolves to
                // the Caustic Pellet ranged attack (see combat-drenkirra-pellet.js's
                // attacks.start override) ‚Äî gating it by the same short melee
                // lunge reach every other pounceAttempt creature uses meant it
                // could only ever fire once it had walked up next to its target,
                // which a target up a tree (or across a gap it can't climb/cross)
                // is often never close enough for. Use the pellet's own real
                // range instead so it engages like the ranged attack it is.
                const isRangedDrenkirra = window.HobunjiDrenkirraPellet?.isDrenkirra?.(c);
                const triggerRangePx = isRangedDrenkirra
                  ? TILE * (window.HobunjiDrenkirraPellet.tuning.PROJECTILE_RANGE_TILES * 0.92)
                  : creatureAimColliderReachPx(c);
                if (dist > triggerRangePx || c.attackCooldownT > 0 || c.stamina < def.attackStaminaCost || isCreatureSwimming(c)) return false;
                window.ResourceSystem?.spendStamina(c, def.attackStaminaCost, 'creature attack');
                c.attackCooldownT = def.attackCooldownS;
                return !!(def.attacks?.length && window.Combat?.animalAttacks?.start(
                  c, def.attacks[Math.floor(rnd() * def.attacks.length)], { target: targetPlayer }
                ));
              });
              aimAngle = result.aimAngle;
              moving = result.moving;
            } else {
              moving = moveCreatureToward(c, targetPlayer.x, targetPlayer.y, def.chaseSpeed, entityDt);
              // Pounce-capable creatures commit once the target enters their
              // forward aim collider (always pointed straight at the target
              // via aimAngle above) rather than the bite's short flat range.
              const pounceCapable = def.attacks?.includes('pounce');
              const triggerRangePx = pounceCapable ? creatureAimColliderReachPx(c) : def.attackRangePx;
              if (distToPlayer <= triggerRangePx && c.attackCooldownT <= 0 && c.stamina >= def.attackStaminaCost && !isCreatureSwimming(c)) {
                window.ResourceSystem?.spendStamina(c, def.attackStaminaCost, 'creature attack');
                c.attackCooldownT = def.attackCooldownS;
                const hadNamedAttack = !!def.attacks?.length;
                const startedModular = hadNamedAttack && window.Combat?.animalAttacks?.start(
                  c, def.attacks[Math.floor(rnd() * def.attacks.length)], { target: targetPlayer }
                );
                if (startedModular) aimAngle = c.facing;
                if (!startedModular) {
                  if (hadNamedAttack) window.__farmLog?.(`[wildlife] ${c.creatureKey} (${c.id}): named attack failed to start against player (fallback: plain bite telegraph).`, 'wildlife');
                  window.Combat.telegraph.start(c, {
                    windupS: BITE_TELEGRAPH_WINDUP_S,
                    strikeS: BITE_TELEGRAPH_STRIKE_S,
                    onStrike: () => {
                      // damagePlayer/respawnPlayer are still hardwired to the
                      // single local `player` (see their definitions above) ‚Äî
                      // making a hit against an arbitrary targetPlayer
                      // actually land is the per-player-instancing work this
                      // pass deliberately doesn't take on. Harmless today
                      // since targetPlayer === player whenever `players` has
                      // one entry.
                      const attackTag = def.attackTag || 'sharp'; // Used to tint the hostile's new 3D swipe and preserve its existing affliction type.
                      const enemyAim = window.Combat?.meleeAimSolution?.(c, targetPlayer, c.facing || 0, 0);
                      const attackHalfConeRad = def.attackHalfConeRad || THREE.MathUtils.degToRad(38); // Shared by this hostile's trail and exact 3D hit test.
                      const trailColor = attackTag === 'blunt' ? 0xffaa55 : attackTag === 'toxin' || attackTag === 'poison' ? 0x78ff62 : 0xff6a6a;
                      window.Combat?.spawnMeleeTrail?.({
                        actor: c, target: targetPlayer,
                        rangePx: def.attackRangePx,
                        halfConeRad: attackHalfConeRad,
                        color: trailColor,
                      });
                      if (window.Combat?.meleeHit?.(c, targetPlayer, {
                        rangePx: def.attackRangePx,
                        halfConeRad: attackHalfConeRad,
                        direction: enemyAim?.direction,
                      })) {
                        damagePlayer(def.attackDamage, c.x, c.y, HOSTILE_BITE_KNOCKBACK_PX_S, { tag: attackTag, afflictionBonuses: window.ResourceSystem?.afflictionBonusesForTag(attackTag) });
                        window.AudioSystem?.playCreatureClawHit(c);
                      }
                      c.retreatT = JUMP_BACK_DUR_S;
                    },
                  });
                }
              }
            }
          } else if (c.state === 'return') {
            moving = travelCreatureToward(c, c.homeX, c.homeY, def.moveSpeed, entityDt);
            if (moving) aimAngle = Math.atan2(c.homeY - c.y, c.homeX - c.x);
          } else if (c.denKey && (window.Music?.isNightTime() || window.HobunjiCloudForestWildlife?.isPackOffShift?.(c))) {
            // Denned pack, off the clock ‚Äî head for the den's own mouth
            // tile (denEntranceX/Y, set at spawn from the den's
            // mouthAnchor ‚Äî see spawnPackAtDen) rather than just the
            // footprint center (homeX/Y), and disappear once there instead
            // of idling in the open, so it actually reads as "went inside"
            // rather than "stopped walking near the den." isPackOffShift
            // extends this beyond true night for cloud-forest gar-wolf packs,
            // which only hunt during their two dawn/dusk shifts (see
            // js/wildlife-cloud-forest-behavior.js) and rest the whole
            // rest of the day, not just after dark.
            const denX = c.denEntranceX ?? c.homeX, denY = c.denEntranceY ?? c.homeY;
            const distFromDenMouth = Math.hypot(c.x - denX, c.y - denY);
            if (distFromDenMouth > DEN_SETTLE_RADIUS_PX) {
              moving = travelCreatureToward(c, denX, denY, def.moveSpeed, entityDt);
              if (moving) aimAngle = Math.atan2(denY - c.y, denX - c.x);
            } else {
              c.x = denX; c.y = denY;
              c._denHidden = true;
              if (c.avatarRef?.group) c.avatarRef.group.visible = false;
              aimAngle = idleCreatureAimAngle(c.groupRot);
            }
          } else if (def.diet === 'herbivore') {
            // Active hours: a herbivore periodically breaks off grazing to
            // visit water (see assignWildlifeStation's waterTile, checked
            // against a running game-hour clock so a whole pack doesn't all
            // drink in lockstep ‚Äî patrolIndex-style stagger isn't needed here
            // since nextDrinkHour is seeded with jitter at spawn, see
            // spawnPackAtDen), otherwise travels to its assigned grazing tile
            // and settles there. Falls back to plain wander with neither
            // assigned (legacy zones without generator data).
            const nowHours = (calendar.day - 1) * 24 + window.CalendarSystem.getHour();
            if (c.nextDrinkHour == null) c.nextDrinkHour = nowHours + rnd() * WILDLIFE_DRINK_INTERVAL_HOURS;
            const wantsDrink = c.waterTile && nowHours >= c.nextDrinkHour;
            if (wantsDrink) {
              const wx = (c.waterTile.x + 0.5) * TILE, wy = (c.waterTile.y + 0.5) * TILE;
              const distToWater = Math.hypot(c.x - wx, c.y - wy);
              if (distToWater > DEN_SETTLE_RADIUS_PX) {
                c.state = 'traveling-to-drink';
                moving = travelCreatureToward(c, wx, wy, def.moveSpeed, entityDt);
                if (moving) aimAngle = Math.atan2(wy - c.y, wx - c.x);
              } else {
                c.state = 'drinking';
                aimAngle = idleCreatureAimAngle(c.groupRot);
                c._drinkT = (c._drinkT || 0) + entityDt;
                if (c._drinkT >= WILDLIFE_DRINK_DURATION_S) {
                  c._drinkT = 0;
                  c.nextDrinkHour = nowHours + WILDLIFE_DRINK_INTERVAL_HOURS;
                }
              }
            } else {
              const station = c.grazingTile;
              if (station) {
                const stationX = (station.x + 0.5) * TILE, stationY = (station.y + 0.5) * TILE;
                const distToStation = Math.hypot(c.x - stationX, c.y - stationY);
                if (distToStation > DEN_SETTLE_RADIUS_PX) {
                  c.state = 'scheduled-travel-to-station';
                  moving = travelCreatureToward(c, stationX, stationY, def.moveSpeed, entityDt);
                  if (moving) aimAngle = Math.atan2(stationY - c.y, stationX - c.x);
                } else {
                  c.state = 'at-station-grazing';
                  aimAngle = idleCreatureAimAngle(c.groupRot);
                }
              } else {
                const wanderRadiusPx = c.denKey ? DEN_PACK_WANDER_RADIUS_PX : TILE * 2.2;
                moving = wanderTick(c, entityDt, c.homeX, c.homeY, wanderRadiusPx);
                aimAngle = moving ? Math.atan2(c.vy, c.vx) : idleCreatureAimAngle(c.groupRot);
              }
            }
          } else if (c.patrolPoints && c.patrolPoints.length) {
            // Active hours: a predator loops continuously between its
            // assigned patrol waypoints (see assignWildlifeStation ‚Äî the
            // same nearby-cover points a stationary "ambush" used to camp
            // at, now walked as a route) instead of parking at one spot ‚Äî
            // the patrol-sighting check above fires the whole time it's out
            // here, whether mid-leg or paused at a waypoint.
            c.state = 'patrolling';
            const target = c.patrolPoints[(c.patrolIndex || 0) % c.patrolPoints.length];
            const targetX = (target.x + 0.5) * TILE, targetY = (target.y + 0.5) * TILE;
            const distToTarget = Math.hypot(c.x - targetX, c.y - targetY);
            if (distToTarget <= DEN_SETTLE_RADIUS_PX) {
              c.patrolIndex = ((c.patrolIndex || 0) + 1) % c.patrolPoints.length;
              aimAngle = idleCreatureAimAngle(c.groupRot);
            } else {
              moving = travelCreatureToward(c, targetX, targetY, def.moveSpeed, entityDt);
              if (moving) aimAngle = Math.atan2(targetY - c.y, targetX - c.x);
            }
          } else {
            // Pack creatures roam a wider territory around their den by day
            // than the tight loiter radius everything else uses.
            const wanderRadiusPx = c.denKey ? DEN_PACK_WANDER_RADIUS_PX : TILE * 2.2;
            moving = wanderTick(c, entityDt, c.homeX, c.homeY, wanderRadiusPx);
            // Wandering has an explicit heading; paused between legs, there's no
            // specific direction to look, so settle broadside to the camera.
            aimAngle = moving ? Math.atan2(c.vy, c.vx) : idleCreatureAimAngle(c.groupRot);
          }
          // Passive livestock keep their useful movement state, but when the
          // player comes within approach range they turn their head toward
          // the character's face. If they are settled (grazing/drinking or
          // paused between wander legs), their body also squares to that
          // face target; combat, fleeing, and patrol movement retain priority.
          // A territorially warning/fighting drenkirra (see
          // wildlife-territorial.js) is genuinely engaged in combat despite
          // its own def.hostile: false (that flag only governs ordinary
          // aggro pickup) ‚Äî route it through the same combat head-look
          // system as any other fighting creature below instead of the
          // livestock glance-at-the-player branch, which only ever nods
          // (pitch) and has no yaw tracking at all.
          const territorialActive = c._territorialBehavior?.phase === 'warning' || c._territorialBehavior?.phase === 'fight';
          if (def.hostile === false && !territorialActive) {
            const canLook = livestockLookCandidate
              && !c.prone
              && c.state !== 'return'
              && c.state !== 'patrol-chase'
              && !window.Combat?.telegraph?.isBusy(c)
              && !window.Combat?.animalAttacks?.isBusy(c);
            if (canLook) {
              const faceAimAngle = _updateCreatureLookAtFace(c, targetPlayer, entityDt);
              if (!moving) aimAngle = faceAimAngle;
            } else {
              _restoreCompanionHead(c, entityDt);
            }
          } else if (!c.isBandit) {
            // A genuinely hostile animal creature: nod its head (the
            // authored rig's Z/pitch "nod" axis, see
            // _updateCreatureHeadLookAtCombatTarget) toward whatever it's
            // currently engaged with ‚Äî the player during a chase, or the
            // grazing prey it's stalking during patrol-chase. Bandits are
            // excluded here; their own head-look (a neck yaw, not this
            // pitch rig) is driven separately by
            // combat-bandit.js's _updateBanditLookAtTarget.
            const combatTarget = c.state === 'patrol-chase' ? c.targetCreature
              : c.state === 'chase' ? c.targetPlayer
              : null;
            // evasiveOrbit's own body-facing decision (see
            // updateCreatureBehaviorStage) already checked whether this
            // wider budget reaches the target from wherever the body ends
            // up ‚Äî reuse the same figure here so the visual head yaw isn't
            // separately capped back down to the tighter ordinary-chase
            // default underneath it.
            const evasiveOrbitActive = c._stage?.mode === 'active' && c._stage.stages[c._stage.idx] === 'evasiveOrbit';
            if (combatTarget && !c.prone) _updateCreatureHeadLookAtCombatTarget(c, combatTarget, entityDt, evasiveOrbitActive ? EVASIVE_ORBIT_HEAD_YAW_LIMIT_DEG : undefined);
            else _restoreCompanionHead(c, entityDt);
          }
          c.facing = aimAngle;
          // Grehlr foraging (js/wildlife-grehlr-foraging.js) ‚Äî deliberately
          // placed after the livestock-look/combat-head-nod block above so
          // its eating-dip/fishing-lookdown head pitch wins this frame's
          // interpolation target instead of being immediately smoothed back
          // to rest by that block's own unconditional _restoreCompanionHead.
          window.HobunjiGrehlrForaging?.applyForagingPose?.(c, entityDt);
          if (c.onBranch) window.ClimbSystem?.constrainEntityToBranch?.(c);
          c.x = clamp(c.x, 0, (c.areaCols || COLS) * TILE);
          c.y = clamp(c.y, 0, (c.areaRows || ROWS) * TILE);

          // One line per AI-state transition for den-spawned wildlife (not
          // scripted combat-card creatures, which have no denKey) ‚Äî lets the
          // schedule loop (travel to station, arrive/watch/graze, ambush,
          // flee, settle) be observed purely as text via window.__farmLog's
          // debug panel or window.__wildlifeDebug.dump(), without needing to
          // watch the 3D scene.
          if (c.denKey && c.state !== c._prevAiState) {
            const tx = Math.round(c.x / TILE), ty = Math.round(c.y / TILE);
            window.__farmLog?.(`[wildlife] ${c.creatureKey} (${c.id}) den=${c.denKey}: ${c._prevAiState || '(spawn)'} -> ${c.state} @ (${tx},${ty})`, 'wildlife');
            c._prevAiState = c.state;
          }

          const skipDistantVisualUpdate = updateWildlifeVisualLod(c, Math.hypot(targetPlayer.x - c.x, targetPlayer.y - c.y) / TILE); // Wakes state-changed creatures or omits distant mesh/animation work.
          if (skipDistantVisualUpdate) continue;
          updateCreatureMesh(c, entityDt, aimAngle);
          // Runs AFTER updateCreatureMesh, not before -- during an active
          // swing, updateBanditToolMesh leans the avatar body's own rotation
          // into the same bodyYaw the weapon uses (see its own comment),
          // matching the player's updateToolMesh (playerMesh.rotation.y =
          // vŒ∏ in every branch); updateCreatureMesh would otherwise
          // overwrite that lean right back to the plain aim angle the very
          // same frame, since it always hard-sets grp.rotation.y from
          // c.groupRot. Also lets feetY read this frame's fresh avatar Y
          // position instead of last frame's.
          if (c.isBandit) { window.BanditCombat.updateToolMesh(c); window.BanditCombat.updateTrailArc(c, entityDt); }
          // A modular attack in its leap stage owns the sprite frame (locked
          // onto a non-idle pose) ‚Äî don't let the default idle/run cycling
          // stomp it back every tick.
          if (!window.Combat?.animalAttacks?.isBusy(c)) updateCreatureAnimFrame(c, entityDt, moving);
        }
      }

      const FOLLOW_FAR_PX  = TILE * 2.2;
      const FOLLOW_NEAR_PX = TILE * 1.1;
      const ALERT_RANGE_PX = TILE * 4.5;

      // Shared ground truth for where a mount saddle, shoulder-pet grip,
      // character posterior (seat), and character shoulder-perch actually sit
      // ‚Äî hand-authored in docs/tools/animation-author/index.html's Rig
      // Coordinates mode and exported to docs/config/attachment-rig-profiles.js
      // (window.HOBUNJI_ATTACHMENT_RIG_PROFILES) so the game reads the exact
      // same numbers instead of a separately-guessed approximation. Every
      // anchor's position.y is in that actor's own local frame where Y=0 is
      // its model group's own origin (the vertical center of its unscaled
      // idle sprite plane ‚Äî see buildSinglePlaneAvatarModel/
      // buildAnimalPlaneAvatarModel in png-plane-avatar.js, which both the
      // tool and the game build avatars with), so a character's and a
      // creature's anchor values are directly comparable/combinable.
      // Both caches hold the *resolved* anchor object, keyed by everything
      // its value actually depends on. That's static rig-profile data plus
      // (for the player) speciesId/gender/playerAvatarModelHeight/
      // playerToolBaseY ‚Äî and every one of those only ever changes inside
      // refreshPlayerAvatar (species/gender edits and gear/cosmetic swaps
      // all funnel through it to rebuild the avatar), which is where
      // _playerAttachmentAnchorCache gets cleared. creatureAttachmentAnchor
      // has no player-state dependency at all (pure rig-profile lookup by
      // kind), so its cache never needs invalidating. Without this, a
      // mounted rider or an active shoulder pet was re-deriving these same
      // objects (template-string key, several optional-chain lookups, a
      // fresh {x,y,z,rotationDeg} allocation) every single frame even
      // though the answer can't have changed since the last avatar rebuild.
      let _playerAttachmentAnchorCache = new Map();
      const _creatureAttachmentAnchorCache = new Map();
      function playerAttachmentAnchor(anchorName) {
        if (_playerAttachmentAnchorCache.has(anchorName)) return _playerAttachmentAnchorCache.get(anchorName);
        const result = _computePlayerAttachmentAnchor(anchorName);
        _playerAttachmentAnchorCache.set(anchorName, result);
        return result;
      }
      function _computePlayerAttachmentAnchor(anchorName) {
        const lib = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.characters;
        if (!lib) return null;
        const speciesId = _playerData?.appearance?.speciesId, gender = _playerData?.appearance?.gender;
        const rec = lib[`${speciesId}::${gender}`] || lib[`<unknown species>::${gender}`];
        const anchor = rec?.anchors?.[anchorName];
        if (!anchor) return null;
        // 'posterior' is special: docs/tools/animation-author/index.html's own
        // export always writes position.y = 0 for it and stores the real
        // per-species height as posteriorRule.heightPercentFromFloor instead (the
        // tool's own live preview recomputes from that rule ‚Äî see
        // resolvedCharacterPosteriorSnapshot in that file) ‚Äî reading
        // position.y directly here was always wrong (flat 0 for every
        // species), which is why mounting used to seat the player too high.
        // Resolve the shared floor-relative height percentage. Legacy imports
        // still fall back to their old handAttachY + height-offset rule.
        if (anchorName === 'posterior' && rec.posteriorRule) {
          const modelHeight = Number(playerAvatarModelHeight) || 0.9;
          const legacyOffset = Number(rec.posteriorRule.heightPercentOffset);
          const y = window.HOBUNJI_ATTACHMENT_RIG_MATH?.characterPosteriorY(rec.posteriorRule, modelHeight, playerToolBaseY)
            ?? ((Number.isFinite(Number(playerToolBaseY)) ? Number(playerToolBaseY) : modelHeight / 2)
              + modelHeight * (Number.isFinite(legacyOffset) ? legacyOffset : -18) / 100);
          return { x: 0, y, z: 0, rotationDeg: anchor.rotationDeg };
        }
        return Number.isFinite(anchor?.position?.y) ? { ...anchor.position, rotationDeg: anchor.rotationDeg, sourcePixel: anchor.sourcePixel ? { ...anchor.sourcePixel } : null } : null;
      }
      function creatureAttachmentAnchor(kind, anchorName, genotypeOrSizeClass = null) {
        const sizeScale = window.CreatureGenetics.creatureSizeScale(kind, genotypeOrSizeClass); // Matches anchor coordinates to the visible size class.
        const profileKind = window.CreatureGenetics.SPECIES_ALIAS[kind] || kind; // Lets creature variants share their base rig profile.
        const cacheKey = `${profileKind}::${anchorName}::${sizeScale.sizeClass}`;
        if (_creatureAttachmentAnchorCache.has(cacheKey)) return _creatureAttachmentAnchorCache.get(cacheKey);
        const anchor = window.HOBUNJI_ATTACHMENT_RIG_PROFILES?.creatures?.[profileKind]?.anchors?.[anchorName]; // Unscaled canonical rig anchor.
        const result = Number.isFinite(anchor?.position?.y) ? {
          x: (Number(anchor.position.x) || 0) * sizeScale.x,
          y: anchor.position.y * sizeScale.y,
          z: Number(anchor.position.z) || 0,
          rotationDeg: anchor.rotationDeg,
        } : null;
        _creatureAttachmentAnchorCache.set(cacheKey, result);
        return result;
      }
      function playerAttachmentAnchorY(anchorName) { return playerAttachmentAnchor(anchorName)?.y ?? null; }
      function creatureAttachmentAnchorY(kind, anchorName, genotypeOrSizeClass = null) { return creatureAttachmentAnchor(kind, anchorName, genotypeOrSizeClass)?.y ?? null; }
      // Resolves the authored shoulder attachment as a real transform instead
      // of the old yaw-only shortcut. The perch POSITION remains in the
      // player's body-local frame (it is a shoulder coordinate), while its
      // authored ROTATION is interpreted relative to the live face/neck bone.
      // This lets a perched animal turn and nod with the face without making
      // the shoulder coordinate itself orbit around the neck pivot.
      function _shoulderPetSurfaceTransform(perch, grip) {
        const rotationQuaternion = rotationDeg => { // Converts authored YXZ pitch/yaw/roll for the perch and grip composition below.
          const degrees = rotationDeg || {};
          return new THREE.Quaternion().setFromEuler(new THREE.Euler(
            THREE.MathUtils.degToRad(Number(degrees.x) || 0),
            THREE.MathUtils.degToRad(Number(degrees.y) || 0),
            THREE.MathUtils.degToRad(Number(degrees.z) || 0),
            'YXZ',
          ));
        };
        playerMesh.updateWorldMatrix?.(true, false);
        const perchFrame = window.PNGPlaneAvatar?.resolveSkinnedPixelWorldFrame?.(playerMesh, perch.sourcePixel);
        const perchWorldPosition = perchFrame?.position
          || playerMesh.localToWorld(new THREE.Vector3(perch.x || 0, perch.y || 0, perch.z || 0)); // Position always prefers the authored live-skinned pixel, independent of the rotation dropdown.
        let selectedRotationQuaternion = null; // Receives the world-space frame chosen by the Settings dropdown below.
        let resolvedRotationSource = s_shoulderPetRotationSource;
        switch (s_shoulderPetRotationSource) {
          case 'body':
            selectedRotationQuaternion = playerMesh.getWorldQuaternion(new THREE.Quaternion());
            resolvedRotationSource = 'player-body';
            break;
          case 'head': {
            const headRotationSource = playerNeckJoint?.isObject3D ? playerNeckJoint : playerMesh; // Head/neck selection falls back safely for rigid avatars.
            headRotationSource.updateWorldMatrix?.(true, false);
            selectedRotationQuaternion = headRotationSource.getWorldQuaternion(new THREE.Quaternion());
            resolvedRotationSource = headRotationSource === playerNeckJoint ? 'player-head-neck' : 'player-body-fallback-no-neck';
            break;
          }
          case 'world':
            selectedRotationQuaternion = new THREE.Quaternion();
            resolvedRotationSource = 'world-aligned';
            break;
          case 'pixel':
          default:
            selectedRotationQuaternion = perchFrame?.quaternion?.clone()
              || playerMesh.getWorldQuaternion(new THREE.Quaternion());
            resolvedRotationSource = perchFrame ? 'player-authored-skinned-surface' : 'player-body-fallback-no-skinned-frame';
            break;
        }
        if (s_invertShoulderPetRotationSource) selectedRotationQuaternion.invert();
        const perchQuaternion = rotationQuaternion(perch.rotationDeg); // Authored shoulderPerch rotational correction.
        const inverseGripQuaternion = rotationQuaternion(grip.rotationDeg).invert(); // Authored inverse shoulderGrip rotational correction.
        const worldQuaternion = selectedRotationQuaternion.clone();
        if (!s_cancelShoulderPetRotationalOffset) worldQuaternion.multiply(perchQuaternion).multiply(inverseGripQuaternion); // Optional offset cancellation keeps only the selected frame while placement still aligns the authored grip position.
        const gripWorldOffset = new THREE.Vector3(grip.x || 0, grip.y || 0, grip.z || 0).applyQuaternion(worldQuaternion); // Aligns the pet grip to the resolved perch point.
        return {
          worldPosition: perchWorldPosition.clone().sub(gripWorldOffset),
          worldQuaternion,
          perchWorldPosition: perchWorldPosition.clone(),
          gripWorldOffset: gripWorldOffset.clone(),
          rotationFrameWorldQuaternion: selectedRotationQuaternion,
          perchPositionSource: perchFrame ? 'player-authored-skinned-pixel' : 'player-body-local-fallback',
          rotationSource: resolvedRotationSource,
          requestedRotationSource: s_shoulderPetRotationSource,
          rotationSourceInverted: s_invertShoulderPetRotationSource,
          rotationalOffsetCancelled: s_cancelShoulderPetRotationalOffset,
        };
      }
      // Guessed fallbacks (species-agnostic percent-of-own-height) for the
      // rare case rig data is missing for this character/creature pairing ‚Äî
      // everything stableable today has authored data, so this is just a
      // safety net against a future species without rig coordinates yet.
      const CHAR_SHOULDER_PERCENT_FALLBACK = 0.72;
      const PET_GRIP_PERCENT_FALLBACK = 0.27;
      const MOUNT_SADDLE_PERCENT_FALLBACK = 0.68;
      // How far a companion can "smell" a still-buried treasure chest ‚Äî see
      // updateCompanions' treasure-hint branch and nearestBuriedTreasurePixelPos.
      const TREASURE_HINT_RANGE_PX = TILE * 9;
      const TREASURE_ANNOUNCE_S = 3.2; // Holds the companion player-facing for the full overhead treasure utterance and alert bark.
      const TREASURE_MARK_ARRIVAL_PX = TILE * 0.55; // Switches the lead into its stationary marking pose near the buried tile center.
      const TREASURE_MARK_HEAD_DEG = 10; // Drives authored animal head rigs downward while indicating the dig spot (this rig's own convention is negative degrees = up, positive = down ‚Äî see png-plane-avatar.js's applyDegrees).
      const LIVESTOCK_LOOK_RANGE_PX = TILE * 3.75; // Passive livestock notice the player at a short, readable approach distance.
      const PLAYER_FACE_HEIGHT_RATIO = 0.76; // Face target measured from the player's floor to the authored portrait height.
      const COMPANION_WATCH_IDLE_RATE_PER_SEC = 0.012; // Samples an infrequent spontaneous dog-stare while the player remains genuinely idle.
      const COMPANION_WATCH_IDLE_MIN_S = 3.2; // Minimum duration of the stationary player-facing idle.
      const COMPANION_WATCH_IDLE_MAX_S = 6.4; // Maximum duration of the stationary player-facing idle.
      const SHOULDER_PET_CURIOUS_BODY_LEAN_MIN_DEG = 3; // Used by _tickShoulderPetCuriosity for a readable lean that does not foreshorten the flat sprite.
      const SHOULDER_PET_CURIOUS_BODY_LEAN_MAX_DEG = 7; // Caps the in-plane body lean so the pet stays settled on its authored shoulder grip.
      const SHOULDER_PET_CURIOUS_LOOK_MIN_S = 0.65; // Brief hold after easing into the glance.
      const SHOULDER_PET_CURIOUS_LOOK_MAX_S = 1.35;
      const SHOULDER_PET_CURIOUS_WAIT_MIN_S = 3.4; // A cooldown keeps the glance spontaneous rather than constant.
      const SHOULDER_PET_CURIOUS_WAIT_MAX_S = 7.2;
      const SHOULDER_PET_CURIOUS_PITCH_DEG = 5; // Slight up/down curiosity layered onto the authored head rig where available.
      const SHOULDER_PET_CURIOUS_HEAD_TURN_MIN_DEG = 14; // A separate, clearly visible head turn keeps the body glance from reading as a whole-body pivot.
      const SHOULDER_PET_CURIOUS_HEAD_TURN_MAX_DEG = 24;
      const SHOULDER_PET_CURIOUS_TURN_SPEED_DEG = 180;

      function _companionHeadRestDeg(c) {
        return c.avatarRef?.headRig?.rig?.restDeg ?? 0;
      }

      function _fallbackCompanionHeadState(c) {
        const front = c.avatarRef?.frontPlane;
        const back = c.avatarRef?.backPlane;
        if (!front && !back) return null;
        return c._fallbackHeadPose || (c._fallbackHeadPose = {
          baseFrontX: front?.rotation?.x || 0,
          baseBackX: back?.rotation?.x || 0,
          currentDeg: 0,
        });
      }

      function _updateCompanionHeadRotation(c, targetDeg, dt) {
        if (typeof c.avatarRef?.updateHeadRotation === 'function') {
          c.avatarRef.updateHeadRotation(targetDeg, dt);
          return;
        }
        // Older saves/preview builds can still have the legacy rigid animal
        // planes. Keep their fallback pose visible rather than silently making
        // every head request a no-op until the painted rig is loaded.
        const state = _fallbackCompanionHeadState(c);
        if (!state) return;
        const step = SHOULDER_PET_CURIOUS_TURN_SPEED_DEG * Math.max(0, dt);
        state.currentDeg += clamp(targetDeg - state.currentDeg, -step, step);
        const radians = state.currentDeg * Math.PI / 180;
        if (c.avatarRef.frontPlane) c.avatarRef.frontPlane.rotation.x = state.baseFrontX + radians;
        if (c.avatarRef.backPlane) c.avatarRef.backPlane.rotation.x = state.baseBackX + radians;
      }

      function _restoreCompanionHead(c, dt) {
        _updateCompanionHeadRotation(c, _companionHeadRestDeg(c), dt);
        // Every "stop looking at X" caller below needs the yaw axis eased
        // back to center too, not just the pitch/nod ‚Äî without this, a head
        // that had turned to track a combat target or an idle scan focus
        // stayed frozen at that last yaw forever the instant its caller
        // switched to this shared rest path instead, since nothing else
        // here ever drove it back down.
        if (typeof c?.avatarRef?.updateHeadYaw === 'function') c.avatarRef.updateHeadYaw(0, dt);
        if (c) c._lookAtDebug = null;
      }

      // Look targets use the character's face, not the feet/body center. The
      // horizontal X/Z projection remains the character position in this
      // top-down world; worldY supplies the portrait face height to the
      // authored animal head bone so a nearby animal actually lifts its gaze.
      function _playerFaceTarget(master = player) {
        const isPlayer = master === player;
        const pos = isPlayer
          ? window.CreatureHeadCache.getHeadWorld(player, 'player', { x: player.x, y: player.y, mesh: playerMesh, avatarModelHeight: playerAvatarModelHeight })
          : window.CreatureHeadCache.getHeadWorld(master, 'companion-portrait');
        return { x: pos.x, y: pos.z, worldY: pos.worldY };
      }

      function _creatureHeadWorldY(c) {
        return window.CreatureHeadCache.getHeadWorld(c, 'animal')?.worldY || 0;
      }

      // Feeds docs/js/debug-hitboxes.js's "Show Interaction Raycast" debug
      // toggle ‚Äî every head-look system below records the exact head/target
      // world points it just aimed at here, in Three.js world (tile) units,
      // rather than the debug drawer trying to reverse-engineer a direction
      // out of a rotated (and, for animals, mirrored front/back) bone
      // transform. Cleared wherever the corresponding look resets to rest.
      function _setLookAtDebug(looker, targetX, targetY, targetWorldY) {
        looker._lookAtDebug = {
          head: { x: (Number(looker?.x) || 0) / TILE, y: _creatureHeadWorldY(looker), z: (Number(looker?.y) || 0) / TILE },
          target: { x: targetX / TILE, y: targetWorldY, z: targetY / TILE },
        };
      }

      function _updateCreatureLookAtFace(c, master, dt) {
        const target = _playerFaceTarget(master);
        const dx = target.x - c.x, dy = target.y - c.y;
        const horizontalPx = Math.hypot(dx, dy);
        const aimAngle = horizontalPx > 1 ? Math.atan2(dy, dx) : (c.facing || 0);
        const horizontalWorld = Math.max(0.15, horizontalPx / TILE);
        // Negated ‚Äî this rig's own convention is negative degrees = up,
        // positive = down (confirmed via the vocalization head-nod, see
        // png-plane-avatar.js's applyDegrees), the opposite of what a
        // plain atan2 of the vertical delta gives.
        const pitchDeg = -Math.atan2(target.worldY - _creatureHeadWorldY(c), horizontalWorld) * 180 / Math.PI;
        _updateCompanionHeadRotation(c, pitchDeg, dt);
        _setLookAtDebug(c, target.x, target.y, target.worldY);
        return aimAngle;
      }

      // Where a living thing's "head" is, in the raw-px + worldY convention
      // _updateCreatureHeadLookAtCombatTarget/companion horizon-scan both
      // use (see below). The player has a real authored face height
      // (_playerFaceTarget); an NPC walker has the same eye-position math
      // dialogue's eye contact uses (_dialogueEyeWorldPosition), just
      // converted out of its native tile-scale units into this function's
      // raw-px convention; any other creature (patrol-chase predator/prey,
      // a horizon-scan lock) doesn't carry anything that precise, so its
      // head is approximated as its own head-rig pivot's height, nudged 5%
      // of its own sprite width toward its face/snout (the authored sprites
      // all face the same "front" edge of their own local frame) rather
      // than sitting dead-center on the pivot.
      const COMBAT_TARGET_HEAD_SNOUT_OFFSET_FRAC = 0.05;
      function _combatTargetHeadWorld(target) {
        if (target === player) {
          const t = _playerFaceTarget(target);
          return { x: t.x, y: t.y, worldY: t.worldY };
        }
        if (target?.root?.position && Number.isFinite(Number(target?.avatarHeight))) {
          const eye = _dialogueEyeWorldPosition(target.root.position, target.avatarHeight);
          return { x: eye.x * TILE, y: eye.z * TILE, worldY: eye.y };
        }
        const modelWidth = Number(target?.def?.modelWidth) || Number(target?.visualModelWidth) || Number(target?.modelHeight) || 1.5;
        return {
          x: (Number(target?.x) || 0) - COMBAT_TARGET_HEAD_SNOUT_OFFSET_FRAC * modelWidth * TILE,
          y: Number(target?.y) || 0,
          worldY: _creatureHeadWorldY(target),
        };
      }

      // Head-nod (Z/pitch axis on the authored animal head rig) toward
      // whichever target this creature is currently engaged with in combat
      // ‚Äî see updateHostiles' hostile branch below. Mirrors
      // _updateCreatureLookAtFace's math exactly, just generalized to any
      // combat target (player or another creature) via
      // _combatTargetHeadWorld instead of always assuming the player.
      function _updateCreatureHeadLookAtCombatTarget(c, target, dt, yawLimitDeg = CREATURE_HEAD_YAW_LIMIT_DEG) {
        if (!target) {
          _restoreCompanionHead(c, dt); // Also eases yaw back to center ‚Äî see its own comment.
          return;
        }
        // Yaw here corrects for the gap between the target's exact bearing
        // and wherever this creature's body is currently facing (c.facing,
        // one frame stale here ‚Äî same convention/timing bandit's own
        // _updateBanditLookAtTarget already relies on) -- the body's own
        // camera-relative plane deadzone (CREATURE_PLANE_ROT_MODE) only
        // ever snaps to a handful of discrete facings, so without this the
        // head can visibly undershoot exactl◊owÎæõ ◊¨¢h≠µÁ]X⁄YÇà]◊‹⁄›[\î]õ›][€î€›\òŸHH	⁄XY	Œ»À»Ÿ][ô‹»õ‹›€éàŸ[X›»H]ôHúò[YH\ŸY»‹öY[ù]X⁄Y⁄›[\à]ÀÇà]◊⁄[ùô\ù⁄›[\î]õ›][€î€›\òŸHHò[ŸN»À»Ÿ][ô‹»ŸŸ€Nà[ùô\úŸ\»HŸ[X›Yõ›][€àúò[YHôYõ‹ôH]]‹ôY\ò⁄Ÿ‹ö\€€\‹⁄][€ãÇà]◊ÿÿ[òŸ[⁄›[\î]õ›][€ò[ŸôúŸ]Hò[ŸN»À»Ÿ][ô‹»ŸŸ€Nà€Z]»]]‹ôY\ò⁄Ÿ‹ö\õ›][€à€‹úôX›[€ú»⁄[Hô]Z[ö[ô»HŸ[X›Yúò[YKÇà]◊Ÿúõ€ù‹ö]Vò^Uõ›Y⁄⁄›[\î]Hò[ŸN»À»Ÿ][ô‹»ŸŸ€Nàò]‹»Húõ€ùYòXŸK[€õH^Y\à›ô\õ^HYù\àH]Çà]◊ÿòX⁄‘‹ö]Vò^Uõ›Y⁄⁄›[\î]Hò[ŸN»À»Ÿ][ô‹»ŸŸ€Nàò]‹»HòX⁄ÀYòXŸK[€õH^Y\à›ô\õ^HYù\àH]ÇÇà]‹]úöX⁄–›[Xÿ›[HH¬ÇàùZ[[SY\⁄\ 
N¬ÇàÀ»]ôYúöX⁄»›\ôòXŸH›ô\àHò\õI‹»]Yà]\»€ôH8†%ÿ[YBàÀ»X⁄ö\]YH\»H›€à]
ŸYHî]à]ôYúöX⁄»›\ôòXŸHàô[› NÇàÀ»ùZ[€òŸHH⁄\ôYôX⁄\K—”à\ôHôXYK⁄[öŸY[ô›[YûBàÀ»ÿ[Y\òH€‹úöY‹ãà€‹õõ›]\»ÿY»\ﬁ[ò⁄õ€õ›\€H]õ€›€Àÿ[YBàÀ»\»€‹õ›€îõ›]\À€»]	‹»ôXYúô\⁄[ú⁄YHHù[ä
Hô[›¬àÀ»ò]\à[àÿ\\ôYõ›ÀÇà[ú›\ôT]›\ôòXŸTôXYJ
Kù[ä

HOà¬à€€ú›ò\õTõ›]\»H€‹õõ›]\Àôö[\äàOà
ãò\ôXH	Ÿò\õI HOOH	Ÿò\õI N¬à€€ú›‹[ôQ]HHô\\ôT]‹[ôQ]J‹öY””Àì’‘Àò\õTõ›]\À	Ÿò\õI N¬àYà
‹[ôQ]JHôY⁄\›\î]úöX⁄–⁄[ö‹ 	Ÿò\õIÀÿŸ[ôK‹[ôQ]JN¬àJKòÿ]⁄
\úàOàXùY”Ÿ 	—ò\õH]úöX⁄»›\ôòXŸH\úõ‹éà	»
»\úãõY\‹ÿYŸK	›ÿ\õâ JN¬ÇàÀ»ÿ[Y\ôH
ZXYŸàH›\à⁄[ô›ÀäèÀö[ö]
ããäHÿ[»ôX\àBàÀ»õ›€HŸà\»ö[K⁄X⁄ù[à€»]JH⁄[òŸHùZ[õ‹ô\ï\úòZ[ä
BàÀ»ô[›»ôYY»][[YYX][H8†%]ô\ûH›\à\]ÿ\\ô\»ûH€‹›\ôBàÀ»
””À‘ì’‘À‹ÿŸ[ôK”ì‘ìPS’‘‹ô\€€ôU[SX]‹ô\€€ôP€YôìX]’[U\K¬àÀ»€XîõôÀ◊€X\ö”›][ôK◊Ÿ‹ò\‹–õYQŸ[ÀŸ‹ò\‹–ö[õÿ\ôX]‹◊Ÿ‹ò\‹Àÿ€[\
BàÀ»\»[ôXYHX€\ôYXõ›ôH\»⁄[ù‹à
€[\Hù[ò›[€ÇàÀ»X€\ò][€äH⁄\›YôYÿ\ô\‹»Ÿà⁄\ôH]	‹»‹ö][ãÇà⁄[ô›Àêõ‹ô\ï\úòZ[èÀö[ö]
¬à””Àì’‘Àì‘ìPS’‘ÿŸ[ôK[U\KUPUW’SíUàô\€€ôU[SX]ô\€€ôP€YôìX]€[\àXîõôŒà€XîõôÀàX\ö”›][ôNà€X\ö”›][ôKà‹ò\‹–õYQŸ[ŒàŸ‹ò\‹–õYQŸ[ÀàŸ]‹ò\‹–ö[õÿ\ôX]à

HOà‹ò\‹–ö[õÿ\ôX]àŸ]‹ò\‹—[òXõYà

HOà◊Ÿ‹ò\‹ÀàŸ]›€îÿŸ[ôNà

HOà›€îÿŸ[ôKàŸ]›€ñõ€ôNà

HOà››€ñõ€ôKàJN¬à⁄[ô›Àêõ‹ô\ï\úòZ[ãòùZ[õ‹ô\ï\úòZ[ä
N¬ÇàÀ»8• 8• Ÿ][ô‹»Xà⁄X⁄ÿõﬁ⁄\ö[ô»8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• àÿ›[Y[ùôŸ][[Y[ùûRY
	‹Ÿ][ô”›][ô\… KòY]ô[ù\›[ô\ä	ÿ⁄[ôŸIÀHOà¬à◊€›][ô\»HKù\ôŸ]ò⁄X⁄ŸY¬àJN¬àÿ›[Y[ùôŸ][[Y[ùûRY
	‹Ÿ][ô—\ÿXõR]ò^I OÀòY]ô[ù\›[ô\ä	ÿ⁄[ôŸIÀHOà¬à◊Ÿ\ÿXõR]ò^HHKù\ôŸ]ò⁄X⁄ŸY¬àJN¬àÿ›[Y[ùôŸ][[Y[ùûRY
	‹Ÿ][ô—\ÿXõT⁄›[\ëúõ€ùò^I OÀòY]ô[ù\›[ô\ä	ÿ⁄[ôŸIÀHOà¬à◊Ÿ\ÿXõT⁄›[\ëúõ€ùò^HHKù\ôŸ]ò⁄X⁄ŸY¬à\]T]^Y\ö[ô ‹]^Y\ö[ô–X›]ôK‹]^Y\ö[ô‘]
N¬àJN¬àÿ›[Y[ùôŸ][[Y[ùûRY
	‹Ÿ][ô—\ÿXõT⁄›[\êòX⁄÷ò^I OÀòY]ô[ù\›[ô\ä	ÿ⁄[ôŸIÀHOà¬à◊Ÿ\ÿXõT⁄›[\êòX⁄÷ò^HHKù\ôŸ]ò⁄X⁄ŸY¬à\]T]^Y\ö[ô ‹]^Y\ö[ô–X›]ôK‹]^Y\ö[ô‘]
N¬àJN¬àÿ›[Y[ùôŸ][[Y[ùûRY
	‹Ÿ][ô‘⁄›[\î]õ›][€î€›\òŸI OÀòY]ô[ù\›[ô\ä	ÿ⁄[ôŸIÀHOà¬à€€ú›ô\]Y\›Y€›\òŸHH›ö[ô Kù\ôŸ]ùò[YH	⁄XY	 N»À»\ŸY\ôH»ôZôX››[H‹àX[ùX[KYY]Y”Hò[Y\ÀÇà◊‹⁄›[\î]õ›][€î€›\òŸHH…‹^[	À	ÿõŸIÀ	⁄XY	À	›€‹õ	◊Kö[ò€Y\ ô\]Y\›Y€›\òŸJH»ô\]Y\›Y€›\òŸHà	⁄XY	Œ¬àJN¬àÿ›[Y[ùôŸ][[Y[ùûRY
	‹Ÿ][ô“[ùô\ù⁄›[\î]õ›][€î€›\òŸI OÀòY]ô[ù\›[ô\ä	ÿ⁄[ôŸIÀHOà¬à◊⁄[ùô\ù⁄›[\î]õ›][€î€›\òŸHHKù\ôŸ]ò⁄X⁄ŸY¬àJN¬àÿ›[Y[ùôŸ][[Y[ùûRY
	‹Ÿ][ô–ÿ[òŸ[⁄›[\î]õ›][€ò[ŸôúŸ]	 OÀòY]ô[ù\›[ô\ä	ÿ⁄[ôŸIÀHOà¬à◊ÿÿ[òŸ[⁄›[\î]õ›][€ò[ŸôúŸ]HKù\ôŸ]ò⁄X⁄ŸY¬àJN¬àÿ›[Y[ùôŸ][[Y[ùûRY
	‹Ÿ][ô—úõ€ù‹ö]Vò^Uõ›Y⁄⁄›[\î]	 OÀòY]ô[ù\›[ô\ä	ÿ⁄[ôŸIÀHOà¬à◊Ÿúõ€ù‹ö]Vò^Uõ›Y⁄⁄›[\î]HKù\ôŸ]ò⁄X⁄ŸY¬à\]T]^Y\ö[ô ‹]^Y\ö[ô–X›]ôK‹]^Y\ö[ô‘]
N¬àJN¬àÿ›[Y[ùôŸ][[Y[ùûRY
	‹Ÿ][ô–òX⁄‘‹ö]Vò^Uõ›Y⁄⁄›[\î]	 OÀòY]ô[ù\›[ô\ä	ÿ⁄[ôŸIÀHOà¬à◊ÿòX⁄‘‹ö]Vò^Uõ›Y⁄⁄›[\î]HKù\ôŸ]ò⁄X⁄ŸY¬à\]T]^Y\ö[ô ‹]^Y\ö[ô–X›]ôK‹]^Y\ö[ô‘]
N¬àJN¬àÿ›[Y[ùôŸ][[Y[ùûRY
	‹Ÿ][ô—\›][ô\… KòY]ô[ù\›[ô\ä	ÿ⁄[ôŸIÀHOà¬à◊Ÿ\›][ô\»HKù\ôŸ]ò⁄X⁄ŸY¬àJN¬àÿ›[Y[ùôŸ][[Y[ùûRY
	‹Ÿ][ô—\›][ôTŸ[ú⁄]]ö]I KòY]ô[ù\›[ô\ä	⁄[ú]	ÀHOà¬àÀ»€Y\à\»úŸ[ú⁄]]ö]Hà
Y⁄\àHÿ]⁄\»€X[\à\ÿ\ K€¬àÀ»[ùô\ù][ù»Hô\⁄€\ÿÿ[H][\Y\à\ŸYûHH⁄Y\ãÇàÀ»õ›[ô»€€YHúõ€H€€ôöYÀ€›][ôK\ô[ô\ö[ôÀöú€€à
ôXY]ôHŸôÇàÀ»€›][ôTô[ô\ö[ô–€€ôöYÀõ›ÿ\\ôY]\›[ô\ã\Ÿ]\[YK€¬àÀ»H€€ôöY»ÿY][ô»Yù\à\»⁄\ö[ô»›[ZŸ\»YôôX›
KÇà€€ú›Ÿ[ú⁄]]ö]HHù[Xô\äKù\ôŸ]ùò[YJN¬à€€ú›»Ÿ[ú⁄]]ö]SZ[ïô\⁄ÿÿ[NàÀŸ[ú⁄]]ö]SX^ô\⁄ÿÿ[NàHHH€›][ôTô[ô\ö[ô–€€ôöYÀô\YŸN¬à◊Ÿ\›][ôUô\⁄ÿÿ[HH»
»
HH H
àŸ[ú⁄]]ö]N¬àJN¬àÀ»⁄\ôYûHH⁄X⁄ÿõﬁô[›»[ôŸ]‹ò\‹’ö\⁄XõH
⁄[ô›Àó◊ÿ€[XëXùY BàÀ»€»HXY\‹Àÿ€€ú€€HŸŸ€HŸ\€â›ôYY»€X⁄»õ›Y⁄Ÿ][ô‹»8†%àÀ»ö\›X[Hô\öYûZ[ô»[ôÀŸôY]€›][ô\»YÿZ[ú›[úŸH€‹õ‹ò\‹¬àÀ»›\ù⁄\ŸHYX[ú»[ù[ô»õ‹à‹[à‹õ›[ôö\ú›Çàù[ò›[€à\Q‹ò\‹’ö\⁄XõJö\⁄XõJH¬à◊Ÿ‹ò\‹»HH]ö\⁄XõN¬à€€ú›Ÿ][ô–⁄X⁄ÿõﬁHÿ›[Y[ùôŸ][[Y[ùûRY
	‹Ÿ][ô—‹ò\‹… N¬àYà
Ÿ][ô–⁄X⁄ÿõﬁ
HŸ][ô–⁄X⁄ÿõﬁò⁄X⁄ŸYH◊Ÿ‹ò\‹Œ¬àYà
ò\õQ‹ò\‹–ö[Y\⁄
Hò\õQ‹ò\‹–ö[Y\⁄ùö\⁄XõHH◊Ÿ‹ò\‹Œ¬àYà
›€ë‹ò\‹–ö[Y\⁄
H›€ë‹ò\‹–ö[Y\⁄ùö\⁄XõHH◊Ÿ‹ò\‹Œ¬àÀ»›ôX[YYõ€ôH‹ò\‹À‹öX⁄Yõ€XYŸH‹õ›\»]ôHô[›»Z\à›€ö[ô¬àÀ»⁄[ö»‹õ›\À€»ò]ô\úŸHò]\à[à\‹›[Z[ô»\ôX›ÿŸ[ôH⁄[ô[ãÇàõ‹à
€€ú›õ€ôR[ôõ»Ÿàﬁõ€ôTÿŸ[ô\Àùò[Y\ 
JH¬àõ€ôR[ôõÀúÿŸ[ôOÀùò]ô\úŸOÀäÿöôX›Oà¬àYà
ÿöôX›ù\Ÿ\ë]OÀö\’⁄[\õô\‹—‹ò\‹–⁄[ö—‹õ›\ÿöôX›ù\Ÿ\ë]OÀö\‘öX⁄õ€XYŸPö[õÿ\ô
HÿöôX›ùö\⁄XõHH◊Ÿ‹ò\‹Œ¬àJN¬àBà⁄[ô›Àêõ‹ô\ï\úòZ[ãúŸ]‹ò\‹’ö\⁄XõJ◊Ÿ‹ò\‹ N¬àBàÿ›[Y[ùôŸ][[Y[ùûRY
	‹Ÿ][ô—‹ò\‹… KòY]ô[ù\›[ô\ä	ÿ⁄[ôŸIÀHOà\Q‹ò\‹’ö\⁄XõJKù\ôŸ]ò⁄X⁄ŸY
JN¬àÀ»⁄YQ‹ò\‹œLH›\ù»HŸ\‹⁄[€à⁄]‹ò\‹»[ôXYHŸôãÿ[YH€€ùô[ù[€ÇàÀ»\»H	››[	»õ‹òŸH\ò[HXõ›ôKÇàYà
ô]»TìŸX\ò⁄\ò[\ ÿÿ][€ãúŸX\ò⁄
KôŸ]
	⁄YQ‹ò\‹… HOOH	ÃI H\Q‹ò\‹’ö\⁄XõJò[ŸJN¬àÿ›[Y[ùôŸ][[Y[ùûRY
	‹Ÿ][ô–ö[⁄[ô	 KòY]ô[ù\›[ô\ä	ÿ⁄[ôŸIÀHOà¬à◊ÿö[⁄[ôHKù\ôŸ]ò⁄X⁄ŸY¬àJN¬àÿ›[Y[ùôŸ][[Y[ùûRY
	‹Ÿ][ô’ŸYY—	 KòY]ô[ù\›[ô\ä	ÿ⁄[ôŸIÀHOà¬à◊›ŸYY—HKù\ôŸ]ò⁄X⁄ŸY¬à‹ôXùZ[ŸYY[\ 
N¬àJN¬àÀ»€›Yõ‹ô\›\ôã]\›[ô»ŸŸ€\»8†%XX⁄ZŸ\»YôôX›[[YYX][KàÀ»õ»õ€ôHô[ÿYôYYY
ŸYH◊ÿ€›Yõ‹ô\›õŸÀ’⁄YP›[–ô—õ‹ô\›	‹¬àÀ»X€\ò][€à€€[Y[ù
KÇàÿ›[Y[ùôŸ][[Y[ùûRY
	‹Ÿ][ô–€›Yõ‹ô\›õŸ… OÀòY]ô[ù\›[ô\ä	ÿ⁄[ôŸIÀHOà¬à◊ÿ€›Yõ‹ô\›õŸ»HKù\ôŸ]ò⁄X⁄ŸY¬à⁄[ô›Àê€›Yõ‹ô\›õŸœÀúŸ][òXõY
◊ÿ€›Yõ‹ô\›õŸ N¬àÀ»€›Yõ‹ô\›õŸ»€õH›€ú»H^Y\ãXŸ[ù\ôYZ\›ﬁ[[ô\ú»8†%BàÀ»õ€ôI‹»›€àëQKëõŸ—^à
[ú⁄]HåMKúÀà]ô\ûH›\àõ€ôI‹¬àÀ»åN8†%ŸYHVTíS‘ó÷ì”ëTÀõX\‹€›]\õóÿ€›YŸõ‹ô\›	‹»õŸ—[ú⁄]BàÀ»€€[Y[ù
H\»HŸX€€ô[ô\[ô[ù^ôH€›\òŸHHŸŸ€H\ŸY¬àÀ»X]ôH[ù›X⁄Y€»\õö[ô»]ŸôàYâ›ö\⁄XõHô[[›ôHHZ\›ÇàÀ»Ÿ]]»ô\õ»⁄[àŸôà€»H⁄X⁄ÿõﬁô[[›ô\»]ô\ûHZ\›€›\òŸKàÀ»[àô\›‹ôHH]]‹ôY[ú⁄]H⁄[à€ã]ôHYàHõ€ôH^\›ÀÇà€€ú›öHHﬁõ€ôTÿŸ[ô\ÀôŸ]
	€X\‹€›]\õóÿ€›YŸõ‹ô\›	 N¬àYà
öOÀúÿŸ[ôOÀôõŸ H¬àöKúÿŸ[ôKôõŸÀô[ú⁄]HH◊ÿ€›Yõ‹ô\›õŸ»»
VTíS‘ó÷ì”ëTÀõX\‹€›]\õóÿ€›YŸõ‹ô\›ÀôõŸ—[ú⁄]Hœ»åMJHà¬àBàJN¬àÿ›[Y[ùôŸ][[Y[ùûRY
	‹Ÿ][ô–€›Yõ‹ô\›⁄YP›[	 OÀòY]ô[ù\›[ô\ä	ÿ⁄[ôŸIÀHOà¬à◊ÿ€›Yõ‹ô\›⁄YP›[HKù\ôŸ]ò⁄X⁄ŸY¬àJN¬àÿ›[Y[ùôŸ][[Y[ùûRY
	‹Ÿ][ô–€›Yõ‹ô\›ô—õ‹ô\›	 OÀòY]ô[ù\›[ô\ä	ÿ⁄[ôŸIÀHOà¬à◊ÿ€›Yõ‹ô\›ô—õ‹ô\›HKù\ôŸ]ò⁄X⁄ŸY¬àYà
⁄[ô›Àê€›Yõ‹ô\›ù[ù[YUåäH⁄[ô›Àê€›Yõ‹ô\›ù[ù[YUåãòô—õ‹ô\›[òXõYH◊ÿ€›Yõ‹ô\›ô—õ‹ô\›¬àÀ»[€»YK‹⁄›»⁄]]ô\â‹»[ôXYHùZ[\»Ÿ\‹⁄[€ã€»BàÀ»ŸŸ€H\»[ú›[ù[ú›XYŸà€õHYôôX›[ô»Hô^õ€ôHùZ[Çà€€ú›öHHﬁõ€ôTÿŸ[ô\ÀôŸ]
	€X\‹€›]\õóÿ€›YŸõ‹ô\›	 N¬àöOÀúÿŸ[ôOÀùò]ô\úŸOÀäÿöàOà»Yà
ÿöãù\Ÿ\ë]OÀò€›Yõ‹ô\›ÿŸ[ô\ûJHÿöãùö\⁄XõHH◊ÿ€›Yõ‹ô\›ô—õ‹ô\›»JN¬àJN¬àù[ò›[€à\SôX\òûUõ€[YP€€\⁄[€îŸ][ô‹ 
H¬à⁄[ô›ÀìôX\òûUõ€[YP€€\⁄[€èÀúŸ]‹[€úœÀä¬à[òXõYàÿ›[Y[ùôŸ][[Y[ùûRY
	‹Ÿ][ô’õ€[YP€€\⁄[€ìX\›\â OÀò⁄X⁄ŸYOOHò[ŸKàõ⁄ôX›[\Œàÿ›[Y[ùôŸ][[Y[ùûRY
	‹Ÿ][ô’õ€[YP€€\⁄[€îõ⁄ôX›[\… OÀò⁄X⁄ŸYOOHò[ŸKà^\ôP[Nàÿ›[Y[ùôŸ][[Y[ùûRY
	‹Ÿ][ô’õ€[YP€€\⁄[€ê[I OÀò⁄X⁄ŸYOOHò[ŸKàJN¬àBàõ‹à
€€ú›Ÿ][ô“YŸà¬à	‹Ÿ][ô’õ€[YP€€\⁄[€ìX\›\âÀà	‹Ÿ][ô’õ€[YP€€\⁄[€îõ⁄ôX›[\…Àà	‹Ÿ][ô’õ€[YP€€\⁄[€ê[IÀàJH¬àÿ›[Y[ùôŸ][[Y[ùûRY
Ÿ][ô“Y
OÀòY]ô[ù\›[ô\ä	ÿ⁄[ôŸIÀ\SôX\òûUõ€[YP€€\⁄[€îŸ][ô‹ N¬àBàÿ›[Y[ùôŸ][[Y[ùûRY
	‹Ÿ][ô–ò[ô]ÿ[\… OÀòY]ô[ù\›[ô\ä	ÿ⁄[ôŸIÀHOà¬àYà
⁄[ô›Àêò[ô]ÿ[\ H⁄[ô›Àêò[ô]ÿ[\Àòÿ[\—[òXõYHKù\ôŸ]ò⁄X⁄ŸY¬àJN¬àÀ»⁄\ôYûHH›[\òY]\»[ô[⁄^õŸÀ[^Y\à€Y\ú»ô[›Œà⁄\ô\¬àÀ»[à[ú]\O\ò[ôŸOà»H]ôHò[YHŸ]\ã‹Ÿ]\à\»]¬àÀ»Z\ôY\‹^H‹[ã[Z⁄[ô»YôôX›€àHô\ûHô^úò[YKÇàù[ò›[€à⁄\ôT€Y\ä[ú]Yò[YRY\JH¬à€€ú›[ú]Hÿ›[Y[ùôŸ][[Y[ùûRY
[ú]Y
N¬à€€ú›ò[YQ[Hÿ›[Y[ùôŸ][[Y[ùûRY
ò[YRY
N¬àYà
Z[ú]
Hô]\õé¬à[ú]òY]ô[ù\›[ô\ä	⁄[ú]	ÀHOà¬à€€ú›àHù[Xô\äKù\ôŸ]ùò[YJN¬àYà
ò[YQ[
Hò[YQ[ù^€€ù[ùH›ö[ô äN¬à\JäN¬àJN¬àBà⁄\ôT€Y\ä	‹Ÿ][ô–€›Yõ‹ô\››[òY]\…À	‹Ÿ][ô–€›Yõ‹ô\››[òY]\’ò[YIÀàOà»◊ÿ€›Yõ‹ô\››[òY]\’[\»Hé»JN¬àÀ»\ŸH€»⁄›»HâHà›Yôö^[ú›XYŸàHò]»€Y\àù[Xô\ã€¬àÀ»^Hÿ[â›⁄\ôH⁄\ôT€Y\â‹»Z[à›ö[ô äH\‹^H8†%⁄\ôYûBàÀ»[ô[ú›XYÿ[YH[ô\õZ[ô»]\õãÇà


HOà¬à€€ú›[ú]Hÿ›[Y[ùôŸ][[Y[ùûRY
	‹Ÿ][ô–€›Yõ‹ô\›òYT›\ù	 N¬à€€ú›ò[YQ[Hÿ›[Y[ùôŸ][[Y[ùûRY
	‹Ÿ][ô–€›Yõ‹ô\›òYT›\ùò[YI N¬à[ú]ÀòY]ô[ù\›[ô\ä	⁄[ú]	ÀHOà¬à€€ú›àHù[Xô\äKù\ôŸ]ùò[YJN¬àYà
ò[YQ[
Hò[YQ[ù^€€ù[ùH	›üIX¬à◊ÿ€›Yõ‹ô\›òYT›\ùúòX»Hà»L¬àJN¬àJJ
N¬à


HOà¬à€€ú›[ú]Hÿ›[Y[ùôŸ][[Y[ùûRY
	‹Ÿ][ô–€›Yõ‹ô\››][ôTòY]\… N¬à€€ú›ò[YQ[Hÿ›[Y[ùôŸ][[Y[ùûRY
	‹Ÿ][ô–€›Yõ‹ô\››][ôTòY]\’ò[YI N¬à[ú]ÀòY]ô[ù\›[ô\ä	⁄[ú]	ÀHOà¬à€€ú›àHù[Xô\äKù\ôŸ]ùò[YJN¬àYà
ò[YQ[
Hò[YQ[ù^€€ù[ùH	›üIX¬à◊ÿ€›Yõ‹ô\››][ôQúòX»Hà»L¬àJN¬àJJ
N¬à⁄\ôT€Y\ä	‹Ÿ][ô–€›Yõ‹ô\›õŸ“[õô\îòY]\…À	‹Ÿ][ô–€›Yõ‹ô\›õŸ“[õô\îòY]\’ò[YIÀàOà⁄[ô›Àê€›Yõ‹ô\›õŸœÀúŸ]^Y\îòY]\ äJN¬à⁄\ôT€Y\ä	‹Ÿ][ô–€›Yõ‹ô\›õŸ“[õô\ì‹X⁄]IÀ	‹Ÿ][ô–€›Yõ‹ô\›õŸ“[õô\ì‹X⁄]Uò[YIÀàOà⁄[ô›Àê€›Yõ‹ô\›õŸœÀúŸ]^Y\ì‹X⁄]JäJN¬à⁄\ôT€Y\ä	‹Ÿ][ô–€›Yõ‹ô\›õŸ”ZYTòY]\…À	‹Ÿ][ô–€›Yõ‹ô\›õŸ”ZYTòY]\’ò[YIÀàOà⁄[ô›Àê€›Yõ‹ô\›õŸœÀúŸ]^Y\îòY]\ KäJN¬à⁄\ôT€Y\ä	‹Ÿ][ô–€›Yõ‹ô\›õŸ”ZYS‹X⁄]IÀ	‹Ÿ][ô–€›Yõ‹ô\›õŸ”ZYS‹X⁄]Uò[YIÀàOà⁄[ô›Àê€›Yõ‹ô\›õŸœÀúŸ]^Y\ì‹X⁄]JKäJN¬à⁄\ôT€Y\ä	‹Ÿ][ô–€›Yõ‹ô\›õŸ”›]\îòY]\…À	‹Ÿ][ô–€›Yõ‹ô\›õŸ”›]\îòY]\’ò[YIÀàOà⁄[ô›Àê€›Yõ‹ô\›õŸœÀúŸ]^Y\îòY]\ ãäJN¬à⁄\ôT€Y\ä	‹Ÿ][ô–€›Yõ‹ô\›õŸ”›]\ì‹X⁄]IÀ	‹Ÿ][ô–€›Yõ‹ô\›õŸ”›]\ì‹X⁄]Uò[YIÀàOà⁄[ô›Àê€›Yõ‹ô\›õŸœÀúŸ]^Y\ì‹X⁄]JãäJN¬àÀ»\ŸYûHH[ÿö[KYúöY[ôHô\Ÿ]ù]€à»ô\›‹ôH]ô\ûH€Y\à[ÇàÀ»H€›Yõ‹ô\›\ôõ‹õX[òŸK]\›[ô»‹õ›\úõ€H]»SYò][Çà€€ú›”’Q—ì‘ëT’—Uó‘”QTó“Q»HÿöôX›ôúôY^ôJ¬à	‹Ÿ][ô–€›Yõ‹ô\››[òY]\…Àà	‹Ÿ][ô–€›Yõ‹ô\›òYT›\ù	Àà	‹Ÿ][ô–€›Yõ‹ô\››][ôTòY]\…Àà	‹Ÿ][ô–€›Yõ‹ô\›õŸ“[õô\îòY]\…Àà	‹Ÿ][ô–€›Yõ‹ô\›õŸ“[õô\ì‹X⁄]IÀà	‹Ÿ][ô–€›Yõ‹ô\›õŸ”ZYTòY]\…Àà	‹Ÿ][ô–€›Yõ‹ô\›õŸ”ZYS‹X⁄]IÀà	‹Ÿ][ô–€›Yõ‹ô\›õŸ”›]\îòY]\…Àà	‹Ÿ][ô–€›Yõ‹ô\›õŸ”›]\ì‹X⁄]IÀàJN¬àÿ›[Y[ùôŸ][[Y[ùûRY
	‹Ÿ][ô–€›Yõ‹ô\›ô\Ÿ]Yò][… OÀòY]ô[ù\›[ô\ä	ÿ€X⁄…À

HOà¬àõ‹à
€€ú›[ú]YŸà”’Q—ì‘ëT’—Uó‘”QTó“Q H¬à€€ú›[ú]Hÿ›[Y[ùôŸ][[Y[ùûRY
[ú]Y
N¬àYà
Z[ú]
H€€ù[ùYN¬à[ú]ùò[YHH[ú]ôYò][ò[YN¬à[ú]ô\‹]⁄]ô[ù
ô]»]ô[ù
	⁄[ú]	À»ùXòõ\ŒàùYHJJN¬àBàXùY”Ÿ 	–€›Yõ‹ô\›]ô[‹Y[ù€Y\ú»ô\›‹ôY»Yò][»
ôYH›[òY]\ŒàÃ[\ KâÀ	⁄[ôõ… N¬àJN¬àÀ»î»€›[ù\â‹»⁄X⁄ÿõﬁ\»›€ôY[ù\ô[HûHúÀ‹\ôõ‹õX[òŸKYXùYÀöú¬àÀ»
⁄[ô›Àî\ôîõŸö[\ãúŸ]ú—[òXõYõ›[ô[à[ú›[Ÿ][ô‹’RJH8†%àÀ»]\ŸY»[€»ôH[ô\[ô[ùH⁄\ôY\öY⁄\ôK⁄X⁄YX[ùàÀ»€»Ÿ\\ò]Húò[YH€‹»õ›Y⁄›ô\àHÿ[YHŸú–€›[ù\à[[Y[ù	‹¬àÀ»^]ô\ûH[àŸX€€ôàò]»ÿ[À›öX[ô€\À—‘HY[[‹ûK‹ô[ô\à‘BàÀ»[YH\ôH[ôXYH]òZ[XõH€ÀöXHHYòXŸ[ùî\ôõ‹õX[òŸBàÀ»õŸö[\àà⁄X⁄ÿõﬁ[ô]»›ô\õ^H
\ôî›]H[à]ö[JKÇàÿ›[Y[ùôŸ][[Y[ùûRY
	‹Ÿ][ô‘ô\€€][€â KòY]ô[ù\›[ô\ä	ÿ⁄[ôŸIÀHOà¬à◊‹ô\‘ÿÿ[HH\úŸQõÿ]
Kù\ôŸ]ùò[YJHN¬àô\⁄^ôPÿ[ùò\ 
N¬àJN¬ÇàÀ»ÿÿ[ÿ]ôHõ€\àŸ][ô‹»õ›»8†%ŸYHÿ‹À⁄úÀ€ÿÿ[\ÿ]ôKYõ€\ãöúÀÇàÀ»⁄[ô›Àìÿÿ[ÿ]ôQõ€\à›€ú»[HX›X[õ€\ãZ[ôK“[ô^Yã¬àÀ»ö[Hﬁ\›[HXÿŸ\‹»TH€‹öŒ»\»ù\›ô[ô\ú»]»›]\»[ôàÀ»⁄\ô\»Hù]€úÀÇà
ù[ò›[€à[ö]ÿÿ[ÿ]ôQõ€\îŸ][ô‹ 
H¬à€€ú›õ›»Hÿ›[Y[ùôŸ][[Y[ùûRY
	€ÿÿ[ÿ]ôQõ€\îõ›… N¬àYà
\õ›»]⁄[ô›Àìÿÿ[ÿ]ôQõ€\äHô]\õé¬à€€ú››]\—[Hÿ›[Y[ùôŸ][[Y[ùûRY
	€ÿÿ[ÿ]ôQõ€\î›]\… N¬à€€ú›⁄€‹ŸPùàHÿ›[Y[ùôŸ][[Y[ùûRY
	€ÿÿ[ÿ]ôQõ€\ê⁄€‹ŸPùâ N¬à€€ú›⁄[ôŸPùàHÿ›[Y[ùôŸ][[Y[ùûRY
	€ÿÿ[ÿ]ôQõ€\ê⁄[ôŸPùâ N¬à€€ú›ôX€€õôX›ùàHÿ›[Y[ùôŸ][[Y[ùûRY
	€ÿÿ[ÿ]ôQõ€\îôX€€õôX›ùâ N¬à€€ú›ÿ]ôSõ›–ùàHÿ›[Y[ùôŸ][[Y[ùûRY
	€ÿÿ[ÿ]ôQõ€\îÿ]ôSõ›–ùâ N¬à€€ú›ÿYùàHÿ›[Y[ùôŸ][[Y[ùûRY
	€ÿÿ[ÿ]ôQõ€\ìÿYùâ N¬Çàù[ò›[€àô[ô\ä›]\ H¬àYà
\›]\Àú›\‹ùY
H¬à›]\—[ù^€€ù[ùH	”õ››\‹ùY[à\»úõ›‹Ÿ\à
⁄õ€YK—YŸH€õJKâŒ¬àÿ⁄€‹ŸPùã⁄[ôŸPùãôX€€õôX›ùãÿ]ôSõ›–ùãÿYùóKôõ‹ëXX⁄
àOàãú›[Kô\‹^HH	€õ€ôI N¬àô]\õé¬àBà⁄€‹ŸPùãú›[Kô\‹^HH
›]\Àú›]HOOH	€õ›X€€ôöY›\ôY	»›]\Àú›]HOOH	Ÿ\úõ‹â H»	…»à	€õ€ôIŒ¬à⁄[ôŸPùãú›[Kô\‹^HH›]\Àôõ€\ìò[YH»	…»à	€õ€ôIŒ¬àôX€€õôX›ùãú›[Kô\‹^HH›]\Àú›]HOOH	€ôYYÀ\\õZ\‹⁄[€â»»	…»à	€õ€ôIŒ¬àÿ]ôSõ›–ùãú›[Kô\‹^HH›]\Àú›]HOOH	‹ôXYI»»	…»à	€õ€ôIŒ¬àÿYùãú›[Kô\‹^HH›]\Àú›]HOOH	‹ôXYI»»	…»à	€õ€ôIŒ¬àYà
›]\Àú›]HOOH	‹ôXYI H¬à€€ú›⁄[àH›]\Àõ\›ﬁ[òŸY]»ô]»]J›]\Àõ\›ﬁ[òŸY]
Kù”ÿÿ[U[YT›ö[ô 
Hà	€ô]ô\âŒ¬à›]\—[ù^€€ù[ùHÿ]ö[ô»»â‹›]\Àôõ€\ìò[Y_Hà8†%\›ﬁ[òŸY	›⁄[üKò¬àH[ŸHYà
›]\Àú›]HOOH	€ôYYÀ\\õZ\‹⁄[€â H¬à›]\—[ù^€€ù[ùHõ€\àâ‹›]\Àôõ€\ìò[Y_HàôYY»\õZ\‹⁄[€àYÿZ[à\»Ÿ\‹⁄[€ãò¬àH[ŸHYà
›]\Àú›]HOOH	Ÿ\úõ‹â H¬à›]\—[ù^€€ù[ùH	—\úõ‹éà	»
»
›]\Àõ\›\úõ‹à	›[ö€õ›€â N¬àH[ŸH¬à›]\—[ù^€€ù[ùH	”õ»õ€\à⁄‹Ÿ[àY]âŒ¬àBàBÇà⁄[ô›Àìÿÿ[ÿ]ôQõ€\ãõ€ê⁄[ôŸJô[ô\äN¬àô[ô\ä⁄[ô›Àìÿÿ[ÿ]ôQõ€\ãôŸ]›]\ 
JN¬Çà⁄€‹ŸPùãòY]ô[ù\›[ô\ä	ÿ€X⁄…À

HOà⁄[ô›Àìÿÿ[ÿ]ôQõ€\ãò⁄€‹ŸQõ€\ä
JN¬à⁄[ôŸPùãòY]ô[ù\›[ô\ä	ÿ€X⁄…À

HOà⁄[ô›Àìÿÿ[ÿ]ôQõ€\ãò⁄[ôŸQõ€\ä
JN¬àôX€€õôX›ùãòY]ô[ù\›[ô\ä	ÿ€X⁄…À

HOà⁄[ô›Àìÿÿ[ÿ]ôQõ€\ãúôX€€õôX›

JN¬àÿ]ôSõ›–ùãòY]ô[ù\›[ô\ä	ÿ€X⁄…À\ﬁ[ò»

HOà¬à€€ú››]\»H]ÿZ]⁄[ô›Àìÿÿ[ÿ]ôQõ€\ãúﬁ[ò”õ› 
N¬à⁄›’ÿ\›
›]\Àõ\›\úõ‹à»
	”ÿÿ[ÿ]ôHòZ[Yà	»
»›]\Àõ\›\úõ‹äHà	‘ÿ]ôY»ÿÿ[õ€\ãâÀ\›]\Àõ\›\úõ‹äN¬àJN¬àÿYùãòY]ô[ù\›[ô\ä	ÿ€X⁄…À\ﬁ[ò»

HOà¬àYà
X€€ôö\õJ	”ÿYHÿ]ôHúõ€H[›\àÿÿ[õ€\è»\»›ô\ù‹ö]\»[›\à›\úô[ùúõ›‹Ÿ\àÿ]ôH[ôô[ÿY»HYŸKâ JHô]\õé¬à€€ú›ô\›[H]ÿZ]⁄[ô›Àìÿÿ[ÿ]ôQõ€\ãõÿYúõ€Qõ€\ä
N¬à⁄›’ÿ\›
ô\›[õY\‹ÿYŸKô\›[õ⁄ N¬àYà
ô\›[õ⁄ Hÿÿ][€ãúô[ÿY

N¬àJN¬àJJ
N¬Çà€€ú›Ÿ][ô‘⁄›“]õﬁ\—[Hÿ›[Y[ùôŸ][[Y[ùûRY
	‹Ÿ][ô‘⁄›“]õﬁ\… N¬àŸ][ô‘⁄›“]õﬁ\—[ò⁄X⁄ŸYH◊‹⁄›“]õﬁ\Œ¬àŸ][ô‘⁄›“]õﬁ\—[òY]ô[ù\›[ô\ä	ÿ⁄[ôŸIÀHOà¬à◊‹⁄›“]õﬁ\»HKù\ôŸ]ò⁄X⁄ŸY¬àûH»ÿÿ[›‹òYŸKúŸ]][JUì÷—PïQ◊‘’‘êQ—W“—VK◊‹⁄›“]õﬁ\»»	ÃI»à	Ã	 N»Hÿ]⁄ﬂBàJN¬à€€ú›Ÿ][ô‘⁄›“[ù\òX›[€îò^Xÿ\›[Hÿ›[Y[ùôŸ][[Y[ùûRY
	‹Ÿ][ô‘⁄›“[ù\òX›[€îò^Xÿ\›	 N¬àŸ][ô‘⁄›“[ù\òX›[€îò^Xÿ\›[ò⁄X⁄ŸYH◊‹⁄›“[ù\òX›[€îò^Xÿ\›¬àŸ][ô‘⁄›“[ù\òX›[€îò^Xÿ\›[òY]ô[ù\›[ô\ä	ÿ⁄[ôŸIÀHOà¬à◊‹⁄›“[ù\òX›[€îò^Xÿ\›HKù\ôŸ]ò⁄X⁄ŸY¬àûH»ÿÿ[›‹òYŸKúŸ]][JSïTêP’S”ó‘êVW—PïQ◊‘’‘êQ—W“—VK◊‹⁄›“[ù\òX›[€îò^Xÿ\›»	ÃI»à	Ã	 N»Hÿ]⁄ﬂBàJN¬à€€ú›Ÿ][ô—]ì[ŸQ[Hÿ›[Y[ùôŸ][[Y[ùûRY
	‹Ÿ][ô—]ì[ŸI N¬à€€ú›Ÿ][ô—õ\ô‘‹ùòZ]‘õ›»Hÿ›[Y[ùôŸ][[Y[ùûRY
	‹Ÿ][ô—õ\ô‘‹ùòZ]‘õ›… N»À»]ã[€õH€YHõ‹à€€\\ö[ô»HYÿXﬁH‹ùòZ]‹öY[ù][€ãÇà€€ú›\]Q]ì€õTŸ][ô’ö\⁄Xö[]HH

HOà¬àYà
Ÿ][ô—õ\ô‘‹ùòZ]‘õ› H¬àŸ][ô—õ\ô‘‹ùòZ]‘õ›ÀöY[àH\◊Ÿ]ì[ŸN¬àŸ][ô—õ\ô‘‹ùòZ]‘õ›Àú›[Kô\‹^HH◊Ÿ]ì[ŸH»	…»à	€õ€ôIŒ¬àBàN»À»ŸY\»H‹ùòZ]€€\\ö\€€à›]Ÿà‹ô[ò\ûH^Y\àŸ][ô‹»⁄[Hô\Ÿ\ùö[ô»HXY€õ‹›XÀÇàŸ][ô—]ì[ŸQ[ò⁄X⁄ŸYH◊Ÿ]ì[ŸN¬à\]Q]ì€õTŸ][ô’ö\⁄Xö[]J
N¬àŸ][ô—]ì[ŸQ[òY]ô[ù\›[ô\ä	ÿ⁄[ôŸIÀHOà¬à◊Ÿ]ì[ŸHHKù\ôŸ]ò⁄X⁄ŸY¬àûH»ÿÿ[›‹òYŸKúŸ]][JUó”S—W‘’‘êQ—W“—VK◊Ÿ]ì[ŸH»	ÃI»à	Ã	 N»Hÿ]⁄ﬂBà\]Q]ì€õTŸ][ô’ö\⁄Xö[]J
N¬àÀ»ZŸ\»YôôX›Hô^[YHH€€	‹»][KZ[ôõ»[ô[\»‹[ôYàÀ»
Ÿ[X›ŸX\ï€€‹Ÿ[X›\]Z\€›õ›ôXY◊Ÿ]ì[ŸHúô\⁄
Hò]\ÇàÀ»[àôYY[ô»»òX⁄À‹ôK\ô[ô\à⁄X⁄]ô\à[ô[ZY⁄›\úô[ùBàÀ»ôH‹[ãÇàÀ»Hò\õHY]‹à»]à‹]€ô\à⁄X]ù]€ú»\ôH]ã[[ŸKYÿ]YàÀ»
ŸYH]ã\‹]€ô\ãöú…‹»ôYúô\⁄Y]‹êù]€ïö\⁄Xö[]JH8†%\]H[BàÀ»[[YYX][H[ú›XYŸàÿZ][ô»õ‹àHô^\ôXH⁄[ôŸKàBàÀ»ù\õö]\ôHXŸ\àù]€à⁄\ô\»]ÿ[YH€›⁄[à]à[ŸH\¬àÀ»Ÿôà
ŸYHôú\⁄YùY
K€»][€»ôYY»[à[[YYX]HôYúô\⁄Çà⁄[ô›Àë]î‹]€ô\èÀúôYúô\⁄Y]‹êù]€ïö\⁄Xö[]J
N¬à⁄[ô›Àëù\õö]\ôTXŸ\èÀúôYúô\⁄ö\⁄Xö[]J
N¬àJN¬àÀ»ﬁX€\»õ›Y⁄Hõ€ôI‹»[ú»[àH⁄YôõYõ€ã\ô\X][ô»‹ô\ÇàÀ»
\àõ€ôJH[ú›XYŸà[à[ô\[ô[ùò[ô€HX⁄»]ô\ûHô\‹»8†%àÀ»⁄]€õHH[ôù[Ÿà[ú»\àõ€ôKZ[àX]úò[ô€J
HXYH]àÀ»X\ﬁH»[ô€àHÿ[YHKLà[ú»›ô\à[ô›ô\àûH⁄[òŸKÇàÀ»ô\⁄Yôõ\»⁄[ô]ô\àH[à€›[ù⁄[ôŸ\»
KôÀàYù\àH›[àÀ»⁄Yù
K€»Hù[\[ÿ^\»ö\⁄]»]ô\ûH[à€àHX\^X›BàÀ»€òŸHôYõ‹ôH[ûHô\X]Çà€€ú›Ÿ[ï[\‹ùﬁX€HHô]»X\

N»À»õ€ôRYOà»‹ô\éàù[Xô\ñ◊KYàù[Xô\ã[ô›àù[Xô\àBàù[ò›[€à‹X⁄–ﬁX€Y[äõ€ôRY[ú H¬à]›]HHŸ[ï[\‹ùﬁX€KôŸ]
õ€ôRY
N¬àYà
\›]H›]Kõ[ô›OOH[úÀõ[ô›
H¬à€€ú›‹ô\àH[úÀõX\

ÀJHOàJN¬àõ‹à
]HH‹ô\ãõ[ô›HN»Hà»KKJH¬à€€ú›àHX]ôõ€‹äõô

H
à
H
»JJN¬à€‹ô\ñ⁄WK‹ô\ñ⁄óWHH€‹ô\ñ⁄óK‹ô\ñ⁄WWN¬àBà›]HH»‹ô\ãYà[ô›à[úÀõ[ô›N¬àŸ[ï[\‹ùﬁX€KúŸ]
õ€ôRY›]JN¬à⁄[ô›Àó◊Ÿò\õSŸœÀä›⁄[YôWH[à[\‹ùﬁX€HôXùZ[õ‹à	ﬁõ€ôRYNà	Ÿ[úÀõ[ô›H[úÀ‹ô\à…€‹ô\ãöõ⁄[ä	À	 _WX	›⁄[YôI N¬àBà€€ú›[àH[ú÷‹›]Kõ‹ô\ñ‹›]KöYWN¬à⁄[ô›Àó◊Ÿò\õSŸœÀä›⁄[YôWH[à[\‹ù	ﬁõ€ôRYNàX⁄⁄[ô»ﬁX€H€›	‹›]KöY
»_K…‹›]Kõ‹ô\ãõ[ô›HOà[à	Ÿ[ãöYX	›⁄[YôI N¬à›]KöYH
›]KöY
»JH	H›]Kõ‹ô\ãõ[ô›¬àô]\õà[é¬àBàÀ»]à€€Œàÿ\ú»H[â‹»[›]€àH’TîëSïX\€õH8†%õ¬àÀ»õ€ôK\›⁄]⁄[ôÀ⁄[òŸHHô\]Y\›\»‹X⁄YöXÿ[HôŸ\»\»X\àÀ»]ôH€ôHà
ò\õK››€ãÿùZ[[ô‹»ô]ô\àŒ»H⁄[\õô\‹»õ€ôHŸ\»€òŸBàÀ»]»›[⁄Yù\»ù[à8†%ŸYHﬁõ€ôS^[›]…»[úÿöY[
KÇàù[ò›[€à[\‹ù‘ò[ô€Q[ä
H¬àÀ»ÿ[Yúõ€H[ú⁄YHH[â‹»›€àÿ]ô\õà
\öÀõ»[ôX\ö‹À[ôàÀ»õõ»[ú»€à\»X\àXYHõ»Ÿ[úŸH\ôH⁄[òŸHHÿ]ô\õâ‹»›€ÇàÀ»ﬁõ€ôS^[›]»[ùûHŸ\€â›^\›
H8†%ô\€€ôHH^\ö[‹àõ€ôBàÀ»\»ÿ]ô\õàô[€ô‹»»
ŸYHŸ[êÿ]ô\õñõ€ôSŸäH[ôÿ\ú\ôKàÀ»[ô[ô»]H[à[›]ZŸHHõ€ôK\⁄YH]ô[›»[ú›XYŸÇàÀ»ô\]Z\ö[ô»HŸ\\ò]H^]›\ö\ú›ÇàYà
⁄\–ÿ]ô\õêùZ[[ô–\ôXJ›\úô[ù\ôXJJH¬à€€ú›õ€ôRYH⁄[ô›Àï⁄[YôT‹]€ãô[êÿ]ô\õñõ€ôSŸä›\úô[ù\ôXJN¬à€€ú›[ú»Hõ€ôRY»ﬁõ€ôS^[›]ÀôŸ]
õ€ôRY
OÀô[ú»àù[¬àYà
^õ€ôRYY[ú»Y[úÀõ[ô›
H¬à⁄›’ÿ\›
ìõ»[ú»õ›[ôõ‹à\»ù\úõ›…‹»X\àãò[ŸJN¬àô]\õé¬àBà€€ú›[àH‹X⁄–ﬁX€Y[äõ€ôRY[ú N¬à€€ú›[ò⁄‹àH[ãõ[›][ò⁄‹à»à[ãû
»
[ãù»JH»ãNà[ãûH
»
[ãöJH»àN¬à›\ùÿŸ[ôUò[ú⁄][€ä

HOà¬à€€ú›úõ€TÿŸ[ôHHÿùZ[[ô‘ÿŸ[ô\ÀôŸ]
›\úô[ù\ôXJOÀúÿŸ[ôHù[¬àYà
úõ€TÿŸ[ôJH»úõ€TÿŸ[ôKúô[[›ôJ^Y\ìY\⁄
N»úõ€TÿŸ[ôKúô[[›ôJ^Y\ë‹õ›[ô⁄Y› N»Bàÿ›\úô[ùùZ[[ô”X\YHù[¬à›\úô[ù\ôXHHõ€ôRY¬à^Y\ãûH
[ò⁄‹ãû
»çJH
àSN¬à^Y\ãûHH
[ò⁄‹ãûH
»çJH
àSN¬à^Y\ãùûH»^Y\ãùûHH¬à‹€ò\ÿ[Y\òU\ôŸ]

N¬à€€ú›‘ÿŸ[ôHHùZ[õ€ôTÿŸ[ôJõ€ôRY[ò⁄‹ãû[ò⁄‹ãûJOÀúÿŸ[ôN¬àYà
‘ÿŸ[ôJH¬à‘ÿŸ[ôKòY
^Y\ìY\⁄
N»‘ÿŸ[ôKòY
^Y\ë‹õ›[ô⁄Y› N¬à‘ÿŸ[ôKòY
€€€\äN»‘ÿŸ[ôKòY
ô]X€SY\⁄
N¬à‘ÿŸ[ôKòY
ô]X€P⁄\ò€SY\⁄
N»‘ÿŸ[ôKòY
ô]X€Tö[ô”Y\⁄
N¬à‘ÿŸ[ôKòY
ô]X€Uÿ]ûQ‹õ›\
N¬àBàôYúô\⁄X›[€êò\ä
N¬à⁄›’ÿ\›
[\‹ùY»H[à
	Ÿ[úÀõ[ô›H€à\»X\
KòùYJN¬à€‹ŸSY[ùJ
N¬àJN¬àô]\õé¬àBà€€ú›[ú»Hﬁõ€ôS^[›]ÀôŸ]
›\úô[ù\ôXJOÀô[úŒ¬àYà
Y[ú»Y[úÀõ[ô›
H¬à⁄›’ÿ\›
	”õ»[ú»€à\»X\âÀò[ŸJN¬àô]\õé¬àBà€€ú›[àH‹X⁄–ﬁX€Y[ä›\úô[ù\ôXK[ú N¬à€€ú›[ò⁄‹àH[ãõ[›][ò⁄‹à»à[ãû
»
[ãù»JH»ãNà[ãûH
»
[ãöJH»àN¬à^Y\ãûH
[ò⁄‹ãû
»çJH
àSN¬à^Y\ãûHH
[ò⁄‹ãûH
»çJH
àSN¬à^Y\ãùûH»^Y\ãùûHH¬à‹€ò\ÿ[Y\òU\ôŸ]

N¬à⁄[ô›Àï⁄[\õô\‹–⁄[ö‹œÀúö[YVõ€ôJ›\úô[ù\ôXK[ò⁄‹ãû[ò⁄‹ãûJN¬à⁄›’ÿ\›
[\‹ùY»H[à
	Ÿ[úÀõ[ô›H€à\»X\
KòùYJN¬à€‹ŸSY[ùJ
N¬àBàÿ›[Y[ùôŸ][[Y[ùûRY
	Ÿ]ï[\‹ù[êùâ OÀòY]ô[ù\›[ô\ä	ÿ€X⁄…À[\‹ù‘ò[ô€Q[äN¬ÇàÀ»⁄[YôKŸŸ[õ›\HXùY»[ô[
<'ÈÎ⁄[YôHXäHõ›»]ô\»[ÇàÀ»úÀ›⁄[YôKYXùYÀ\[ô[öú»8†%ÿ[öXH⁄[ô›Àï⁄[YôQXùY‘[ô[úô[ô\ä
KÇàÿ›[Y[ùôŸ][[Y[ùûRY
	›⁄[YôTôYúô\⁄ùâ OÀòY]ô[ù\›[ô\ä	ÿ€X⁄…À

HOà»⁄[ô›Àï⁄[YôQXùY‘[ô[úô[ô\ä
N»⁄[ô›Àï⁄[YôPôZ]ö[‹ìX\Àúô[ô\ä
N»JN¬àÿ›[Y[ùôŸ][[Y[ùûRY
	›⁄[YôT⁄Yùùâ OÀòY]ô[ù\›[ô\ä	ÿ€X⁄…À\ﬁ[ò»

HOà¬à]ÿZ]⁄X⁄’›[⁄Yù
ùYJN¬à⁄[ô›Àï⁄[YôQXùY‘[ô[úô[ô\ä
N¬àJN¬àÀ»[Yÿ]Y€»]ŸY\»€‹ö⁄[ô»X‹õ‹‹»]ô\ûHôK\ô[ô\àŸàH\›àÀ»
€€ùZ[ô\ãö[õô\íSô\XŸ[Y[ù€›[›\ù⁄\ŸHõ‹\ãXù]€ÇàÀ»\›[ô\ú»XX⁄[YJKÇàÿ›[Y[ùôŸ][[Y[ùûRY
	›⁄[YôQ[ì\›	 OÀòY]ô[ù\›[ô\ä	ÿ€X⁄…À
JHOà¬à€€ú›ùàHKù\ôŸ]ò€‹Ÿ\›
	Àù⁄[YôKY[ã][\‹ùXùâ N¬àYà
XùäHô]\õé¬à€€ú›õ€ôRYHùãô]\Ÿ]ûõ€ôK[íYHùãô]\Ÿ]ô[é¬à€€ú›[àHﬁõ€ôS^[›]ÀôŸ]
õ€ôRY
OÀô[úœÀôö[ô
OàöYOOH[íY
N¬àYà
Y[äH»⁄›’ÿ\›
	’][àõ»€ôŸ\à^\›»€àH›\úô[ùX\âÀò[ŸJN»ô]\õé»Bàÿ\ú—[ê[ò⁄‹äõ€ôRY[äN¬àJN¬àÀ»ÿ\ú»H^Y\à›òZY⁄»H‹X⁄YöX»[â‹»[›]€à]»›€ÇàÀ»õ€ôKúõ€H[û]⁄\ôH
ò\õK›€ã[õ›\àõ€ôK‹à[ú⁄YH[ûBàÀ»ùZ[[ôÀÿÿ]ô\õäH8†%\ŸYûHH⁄[YôH[ô[	‹»\ãY[à[\‹ùàÀ»ù]€ãà[õZŸH[\‹ù‘ò[ô€Q[à
⁄X⁄€õH]ô\à\ôŸ]¬àÀ»ù⁄X⁄]ô\àX\[›I‹ôH›\úô[ùH€àäK\»[ÿ^\»ô\€€ô\»BàÀ»^X›õ€ôHHX⁄ŸY[àô[€ô‹»»[ôŸ\»Hù[ÿŸ[ôH›ÿ\àÀ»Yà]	‹»õ›⁄\ôHH^Y\à[ôXYH\ÀÇàù[ò›[€àÿ\ú—[ê[ò⁄‹äõ€ôRY[äH¬à€€ú›[ò⁄‹àH[ãõ[›][ò⁄‹à»à[ãû
»
[ãù»JH»ãNà[ãûH
»
[ãöJH»àN¬à€€ú›[ôH

HOà¬à^Y\ãûH
[ò⁄‹ãû
»çJH
àSN¬à^Y\ãûHH
[ò⁄‹ãûH
»çJH
àSN¬à^Y\ãùûH»^Y\ãùûHH¬à‹€ò\ÿ[Y\òU\ôŸ]

N¬à⁄[ô›Àï⁄[\õô\‹–⁄[ö‹œÀúö[YVõ€ôJõ€ôRY[ò⁄‹ãû[ò⁄‹ãûJN¬àN¬àYà
›\úô[ù\ôXHOOHõ€ôRY
H¬à[ô

N¬à⁄›’ÿ\›
[\‹ùY»[à	Ÿ[ãöYKòùYJN¬à€‹ŸSY[ùJ
N¬àô]\õé¬àBà›\ùÿŸ[ôUò[ú⁄][€ä

HOà¬à€€ú›úõ€TÿŸ[ôHHŸ]X›]ôTÿŸ[ôJ
N¬àYà
úõ€TÿŸ[ôJH»úõ€TÿŸ[ôKúô[[›ôJ^Y\ìY\⁄
N»úõ€TÿŸ[ôKúô[[›ôJ^Y\ë‹õ›[ô⁄Y› N»BàYà
⁄\–ùZ[[ô–\ôXJ›\úô[ù\ôXJJHÿ›\úô[ùùZ[[ô”X\YHù[¬à›\úô[ù\ôXHHõ€ôRY¬à[ô

N¬à€€ú›‘ÿŸ[ôHHùZ[õ€ôTÿŸ[ôJõ€ôRY[ò⁄‹ãû[ò⁄‹ãûJOÀúÿŸ[ôN¬àYà
‘ÿŸ[ôJH¬à‘ÿŸ[ôKòY
^Y\ìY\⁄
N»‘ÿŸ[ôKòY
^Y\ë‹õ›[ô⁄Y› N¬à‘ÿŸ[ôKòY
€€€\äN»‘ÿŸ[ôKòY
ô]X€SY\⁄
N¬à‘ÿŸ[ôKòY
ô]X€P⁄\ò€SY\⁄
N»‘ÿŸ[ôKòY
ô]X€Tö[ô”Y\⁄
N¬à‘ÿŸ[ôKòY
ô]X€Uÿ]ûQ‹õ›\
N¬àBàôYúô\⁄X›[€êò\ä
N¬à⁄›’ÿ\›
[\‹ùY»[à	Ÿ[ãöYKòùYJN¬à€‹ŸSY[ùJ
N¬àJN¬àBÇàÀ»]à€€Œà\›[ô»\ô[òH[\‹ù
»‹ôX]\ôKÿò[ô]Ÿõ€XYŸBàÀ»‹]€ô\à[ô[õ›»]ô\»[àúÀŸ]ã\‹]€ô\ãöú»
⁄[ô›Àë]î‹]€ô\äBàÀ»8†%ŸYH]»[ö]
\ Hÿ[ô[›»õ‹àH⁄\ôYÿ[YKöú»›]BàÀ»]	‹»ôXYYÇÇàÀ»ò[ô]€€Xò][Ÿ»ÿ\\ôH
RK–€]YHô]öY]»€€õ›^Y\ãBàÀ»òX⁄[ô Hõ›»]ô\»[àúÀÿò[ô]X€€Xò][ŸÀöú»8†%ÿ[öXBàÀ»⁄[ô›Àêò[ô]€€Xò]ŸÀòÿ\\ôT€ò\⁄›^

HYàôYYY[Ÿ]⁄\ôKÇÇàÿ›[Y[ùôŸ][[Y[ùûRY
	Ÿ]î‹YY][€Y\â OÀòY]ô[ù\›[ô\ä	⁄[ú]	À
JHOà¬à]ë€ÿò[‹YY][H€[\
ù[Xô\äKù\ôŸ]ùò[YJHLçKÃ
H»L¬à€€ú›Xô[Hÿ›[Y[ùôŸ][[Y[ùûRY
	Ÿ]î‹YY][Xô[	 N¬àYà
Xô[
HXô[ù^€€ù[ùHX]úõ›[ô
]ë€ÿò[‹YY][
àL
H
»	…IŒ¬àJN¬ÇàÀ»⁄[ô›ÀóŸ]î‹]€ô\à[ô‹ôYúô\⁄Y]‹êù]€ïö\⁄Xö[]Hõ›»]ôH[ÇàÀ»úÀŸ]ã\‹]€ô\ãöú»
⁄[ô›Àë]î‹]€ô\äH8†%ÿ[öXBàÀ»⁄[ô›Àë]î‹]€ô\ãùŸŸ€J
KÀúôYúô\⁄Y]‹êù]€ïö\⁄Xö[]J
KÇÇàÀ»8• 8• [ãS[›\àô\›à€]À]ZŸHYŸÀÿòXûH
ŸYHŸ[ìô\›À‹[]YàÀ»[àÿYùZ[[ô‘ÿŸ[ôJH8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• à€€ú›ëT’’R—W“”‘»HN¬à]€ô\›€H¬à€€ú›€ô\›ZŸRY[Hÿ›[Y[ùôŸ][[Y[ùûRY
	€ô\›ZŸRY	 N¬à€€ú›€ô\›ZŸSXô[[Hÿ›[Y[ùôŸ][[Y[ùûRY
	€ô\›ZŸSXô[	 N¬à€€ú›€ô\›ZŸQö[[Hÿ›[Y[ùôŸ][[Y[ùûRY
	€ô\›ZŸQö[	 N¬àù[ò›[€à\‘^Y\ìôX\ë[ìô\›
ô\›
H¬à€€ú›ﬁH
ô\›ò€€
»ô\›ù»»äH
àSKﬁHH
ô\›úõ›»
»ô\›ö»äH
àSN¬àô]\õàX]ö\›
^Y\ãûHﬁ^Y\ãûHHﬁJHHSH
àKçé¬àBàù[ò›[€àZ[YYÿ]ô\õìô\›
ô\›
H¬àYà
[ô\›ô\›úô[XZ[ö[ô»HZ\‘^Y\ìôX\ë[ìô\›
ô\›
JHô]\õàù[¬à€€ú›[ù\òX›[€îò^HH›\úô[ù^Y\í[ù\òX›[€îò^J
N¬àYà
Z[ù\òX›[€îò^H]⁄[ô›Àîò[ôŸYŸX\€úœÀôõÿ›\–ÿ[ôY]\ Hô]\õàù[¬à€€ú›ﬁH
ô\›ò€€
»ô\›ù»»äH
àSKﬁHH
ô\›úõ›»
»ô\›ö»äH
àSN¬à€€ú›‹õ›[ôHHX›]ôT›\ôòXŸVP]€‹õ
ﬁ»SKﬁH»SJN¬à€€ú›[ï»HX]õX^
çKô\›ù»»äK[íHX]õX^
çKô\›ö»äN¬à€€ú›õﬁHô]»ëQKêõﬁ àô]»ëQKïôX›‹å ﬁ»SHH[ïÀ‹õ›[ôKﬁH»SHH[í
Kàô]»ëQKïôX›‹å ﬁ»SH
»[ïÀ‹õ›[ôH
»çÕKﬁH»SH
»[í
Kà
N¬à€€ú›õÿ›\»H⁄[ô›Àîò[ôŸYŸX\€úÀôõÿ›\–ÿ[ôY]\ ﬁ»\Nà	€ô\›	ÀYà›\úô[ù\ôXK]Nàô\›õﬁWKç
N¬àYà
Yõÿ›\ Hô]\õàù[¬à€€ú›‹›[HH⁄[ô›Àîò[ôŸYŸX\€úÀôõÿ›\ŸY‹›[OÀäç
N¬àYà
‹›[H	âà‹›[Kô\›[òŸU€‹õHõÿ›\Àô\›[òŸU€‹õ
»åJHô]\õàù[¬à⁄[ô›ÀëXùY“]õﬁ\œÀõõ›R[ù\òX›[€ëõÿ›\œÀäõÿ›\ N¬àô]\õàô\›¬àBàù[ò›[€à›\úô[ùZ[YYô\›

H¬à€€ú›úò[ò⁄ô\›H⁄[ô›Àê€[Xîﬁ\›[OÀôŸ]Z[YYô\›Àä
Hù[¬àYà
úò[ò⁄ô\›
Hô]\õàúò[ò⁄ô\›¬àô]\õàZ[YYÿ]ô\õìô\›
Ÿ[ìô\›ÀôŸ]
›\úô[ù\ôXJJN¬àBàù[ò›[€àôYúô\⁄[ù\òX›[€ëõÿ›\—XùY 
H¬àYà
\◊‹⁄›“[ù\òX›[€îò^Xÿ\›
Hô]\õé¬àÀ»X]⁄€€\]PX›[€êù]€ú»ö[‹ö]NàHô\››€ú»H⁄\ôY[ú]àÀ»ôYõ‹ôHúò[ò⁄€[Xö[ô»\»€€ú⁄Y\ôYÇàYà
›\úô[ùZ[YYô\›

JHô]\õé¬àYà
⁄\÷õ€ôP\ôXJ›\úô[ù\ôXJH	âà\^Y\ãò€[Xö[ô H⁄[ô›Àê€[Xîﬁ\›[OÀôŸ]€[Xï\ôŸ]Àä
N¬àBàù[ò›[€à\]Sô\›[ù\òX›[€ä
H¬à€€ú›ô\›H›\úô[ùZ[YYô\›

N¬à€€ú›Z⁄[ô»Hô\›	âàX›]ôPX›[€àOOH	€ô\››ZŸI»	âàX›[€í[›€é¬à^Y\ãó€ô\›ZŸPX›]ôHHH]Z⁄[ôŒ¬àYà
]Z⁄[ô H¬àYà
€ô\›€à
H€ô\›€H¬àYà
€ô\›ZŸRY[Àò€\‹”\›ò€€ùZ[ú 	›ö\⁄XõI JH€ô\›ZŸRY[ò€\‹”\›úô[[›ôJ	›ö\⁄XõI N¬àô]\õé¬àBà€ô\›€
œH¬àYà
€ô\›ZŸSXô[[
H€ô\›ZŸSXô[[ù^€€ù[ùHô\›õ]ôPö\ù»	’Z⁄[ô»òXûKããâ»à	’Z⁄[ô»YŸÀããâŒ¬àYà
€ô\›ZŸQö[[
H€ô\›ZŸQö[[ú›[Kù⁄YHX]õZ[äL
€ô\›€»ëT’’R—W“”‘ H
àL
H
»	…IŒ¬à€ô\›ZŸRY[Àò€\‹”\›òY
	›ö\⁄XõI N¬àYà
€ô\›€èHëT’’R—W“”‘ H¬à€ô\›€H¬à^Y\ãó€ô\›ZŸPX›]ôHHò[ŸN¬à€ô\›ZŸRY[Àò€\‹”\›úô[[›ôJ	›ö\⁄XõI N¬àô\›úô[XZ[ö[ôÀKN¬à[ùô[ù‹ûV€ô\›ö][RŸ^WHHX]õZ[äNK
[ùô[ù‹ûV€ô\›ö][RŸ^WH
H
»JN¬à⁄[ô›Àëò\õP[ö[X[Àú]Y]YR][QŸ[õ›\Jô\›ö][RŸ^Kô\›ôŸ[õ›\JN¬à€[\[ùô[ù‹ûT›X⁄ ô\›ö][RŸ^JN¬àùZ[[ùô[ù‹ûQ‹öY

N»ôYúô\⁄][Tÿ‹õ€

N»ôYúô\⁄X›[€êò\ä
N¬àÿ]ôSY[Xô\ï€‹õ]J
N¬à⁄›’ÿ\›
	⁄][RX€€ëõ‹íŸ^Jô\›ö][RŸ^J_H€⁄»	“USW—Qî÷€ô\›ö][RŸ^WOÀõXô[ô\›ö][RŸ^_I€ô\›úô[XZ[ö[ô»à»
	€ô\›úô[XZ[ö[ôﬂHYù
Xà	…ﬂXùYJN¬àBàBàù[ò›[€àŸ]ÿ[Y\òVõ€€Tÿÿ[Jò[YJH¬à€€ú›Ÿô»H\⁄›‹€€ùõ€–€€ôöY 
N¬à€€ú›Z[àHù[Xô\ãö\—ö[ö]Jù[Xô\äŸôÀù⁄Y[õ€€SZ[äJH»ù[Xô\äŸôÀù⁄Y[õ€€SZ[äHàçÕN¬à€€ú›X^Hù[Xô\ãö\—ö[ö]Jù[Xô\äŸôÀù⁄Y[õ€€SX^
JH»ù[Xô\äŸôÀù⁄Y[õ€€SX^
HàãçN¬à◊ﬁõ€€Tÿÿ[HH€[\
ù[Xô\äò[YJHKçKZ[ãX^
N¬à€€ú›õ€€TŸ][ô»Hÿ›[Y[ùôŸ][[Y[ùûRY
	‹Ÿ][ô÷õ€€I N¬àYà
õ€€TŸ][ô Hõ€€TŸ][ôÀùò[YHH›ö[ô ◊ﬁõ€€Tÿÿ[JN¬à\]Pÿ[Y\òT‹⁄][€ä
N¬àBàÿ›[Y[ùôŸ][[Y[ùûRY
	‹Ÿ][ô÷õ€€I KòY]ô[ù\›[ô\ä	ÿ⁄[ôŸIÀHOà¬àŸ]ÿ[Y\òVõ€€Tÿÿ[J\úŸQõÿ]
Kù\ôŸ]ùò[YJHKçJN¬àJN¬àÀ»⁄›[\ã\›\ôâ‹»[›\ŸK[€⁄»ÿ[ù»Ÿ[ùZ[ôHîÀ\›[Hô[]]ôH€⁄»8†%àÀ»H‘»›\ú€‹à]Ÿ[à]\›ô]ô\à[›ôH
HúôYK\õÿ[Z[ô»›\ú€‹àù[ú»›]àÀ»Ÿàÿ‹ôY[ãŸ\⁄»‹XŸH[ô[ú»]H\‹^HYŸKÿ\[ô»›»ò\ÇàÀ»[›Hÿ[à\õäH8†%€»]⁄[ù\ãSÿ⁄‹»Hÿ[ùò\»[ú›XYŸàù\›àÀ»ôXY[ô»[›ô[Y[ù÷HŸôàHö\⁄XõH›\ú€‹ãàÿ⁄ŸY‹àõ›BàÀ»[›\Ÿ[[›ôH[ô\àô[›»[ÿ^\»ôXY»[›ô[Y[ù÷HHÿ[YHÿ^N¬àÀ»ÿ⁄⁄[ô»€õH›‹»H‘»›\ú€‹àúõ€H[›ö[ôÀÿôZ[ô»ö\⁄XõH][àÀ»€»‹ŸH[\»ŸY\€€Z[ô»õ»X]\à›»ò\à‹à›»X[ûH[Y\»BàÀ»\⁄Xÿ[[›\ŸH[›ô\»[à€ôH\ôX›[€ãÇàù[ò›[€à›\ú€‹õ\‹”[›\ŸPZ[Tô\]Y\›Y

H¬àô]\õà⁄\òX›\ïöY]”[ŸKô[òXõYà
◊‹⁄›[\î›\ôà	âàX›]ôPÿ[Y\òS[ŸHOOH“’STó‘’Tëó”S—JN¬àBààù[ò›[€à⁄›[\î›\ôî⁄[ù\ìÿ⁄–X›]ôJ
H¬àô]\õàÿ›[Y[ùú⁄[ù\ìÿ⁄—[[Y[ùOOHôYP€€ùZ[ô\é¬àBàù[ò›[€àô\]Y\›⁄›[\î›\ôî⁄[ù\ìÿ⁄ 
H¬àYà
X›\ú€‹õ\‹”[›\ŸPZ[Tô\]Y\›Y

HZ\—\⁄›‹⁄›[\î›\ôî⁄[ù\ìÿ⁄–X›]ôJ
JHô]\õé¬àÀ»ÿ[àôZôX›
õ»ò[ú⁄Y[ù\Ÿ\àX›]ò][€ã‹àHúõ›‹Ÿ\â‹»›€ÇàÀ»ò]K[[Z]€àô\X]Yô\]Y\› H8†%]	‹»ö[ôKH€X⁄À]À\ô[ÿ⁄¬àÀ»[ô\àô[›»⁄]ô\»H^Y\à[õ›\à⁄[òŸKÇàûH»ôYP€€ùZ[ô\ãúô\]Y\›⁄[ù\ìÿ⁄ 
OÀòÿ]⁄Àä

HOàﬂJN»Hÿ]⁄
\úäHﬂBàBàù[ò›[€àô[X\ŸT⁄›[\î›\ôî⁄[ù\ìÿ⁄ 
H¬àYà
⁄›[\î›\ôî⁄[ù\ìÿ⁄–X›]ôJ
JH»ûH»ÿ›[Y[ùô^]⁄[ù\ìÿ⁄ 
N»Hÿ]⁄
\úäHﬂHBàBàÿ›[Y[ùôŸ][[Y[ùûRY
	‹Ÿ][ô‘⁄›[\î›\ôâ OÀòY]ô[ù\›[ô\ä	ÿ⁄[ôŸIÀHOà¬à◊‹⁄›[\î›\ôàHKù\ôŸ]ò⁄X⁄ŸY¬àÀ»€õH]ôK\›ÿ\⁄[H[à€ôHŸàH€»Z[àÿ[Y\^Hÿ[Y\òBàÀ»›]\»8†%ZYYX[Ÿ›YKŸö\⁄[ôÀ‹ŸX]Yÿ›]ÿŸ[ôKX]ôHHX›]ôBàÀ»[ŸH[€ôH[ô]]»›€à^\›[ô»ô\›‹ôH]
õ›»õ›]YàÀ»õ›Y⁄Yò][ÿ[Y\òS[ŸRŸ^J
KŸ[ù\ëYò][ÿ[Y\òS[ŸJ
JHX⁄»\àÀ»Hô]»ŸŸ€H›]Hô^[YH]ô\€€ô\»òX⁄»»ÿ[Y\^KÇàYà
X›]ôPÿ[Y\òS[ŸHOOH
ÿ[Y\òP€€ôöY 
KôYò][[ŸH	ŸYò][	 HX›]ôPÿ[Y\òS[ŸHOOH“’STó‘’Tëó”S—JH¬àX›]ôPÿ[Y\òS[ŸHHYò][ÿ[Y\òS[ŸRŸ^J
N¬àYà
X›]ôPÿ[Y\òS[ŸHOOH“’STó‘’Tëó”S—JH€ò\⁄›[\î›\ôê^ö[]]

N¬à[ŸH»ÿ[Y\òP^ö[]]ŸôúŸ]Y»H»ÿ[Y\òP[ô€SŸôúŸ]Y»H»BàBàYà
◊‹⁄›[\î›\ôäH¬àô\]Y\›⁄›[\î›\ôî⁄[ù\ìÿ⁄ 
N¬àYà
\—\⁄›‹
H⁄›’ÿ\›
	‘⁄›[\àÿ[Nà€X⁄»Hÿ[YHYà[›\ŸK[€⁄»Ÿ\€ó	›[ôÿYŸIÀùYJN¬àH[ŸHô[X\ŸT⁄›[\î›\ôî⁄[ù\ìÿ⁄ 
N¬àJN¬àÀ»ôKY[ôÿYŸHYù\àHúõ›‹Ÿ\â‹»›€à\ÿÿ\K\ô[X\Ÿ\À[ÿ⁄»ôZ]ö[‹ã‹ÇàÀ»Yù\àHŸ][ô‹»Y[ùH
ô[› H]€»Ÿà]8†%HZ[à€X⁄»€àBàÀ»ÿ[YH€‹õ\»Hÿ[YH€X⁄À]À\ô\›[YK[€⁄»€€ùô[ù[€à[‹›\⁄›‹àÀ»ÿ[Y\»⁄]⁄[ù\àÿ⁄»\ŸKÇàôYP€€ùZ[ô\ãòY]ô[ù\›[ô\ä	ÿ€X⁄…À

HOà¬àYà
›\ú€‹õ\‹”[›\ŸPZ[Tô\]Y\›Y

JHô\]Y\›⁄›[\î›\ôî⁄[ù\ìÿ⁄ 
N¬àJN¬àÀ»õ›ŸôúŸ]€Y\ú»ôXY›‹ö]H⁄X⁄]ô\à›[òŸHô\Ÿ]\»›\úô[ùBàÀ»X›]ôH
ŸYH⁄›[\î›\ôê€€Xò]›[òŸPX›]ôJ
JHò]\à[àH⁄[ô€BàÀ»õ]ò[YH8†%H\ãYúò[YHﬁ[ò»ô[›»€ò\»H€Y\à]Ÿ[àòX⁄¬àÀ»»H›\àô\Ÿ]	‹»›‹ôYù[Xô\àH[ú›[ùH›[òŸHõ\ÀàÀ»€»⁄]	‹»€àÿ‹ôY[à[ÿ^\»X]⁄\»⁄]	‹»X›X[Hö]ö[ô»BàÀ»ÿ[Y\òKÇàÿ›[Y[ùôŸ][[Y[ùûRY
	‹Ÿ][ô‘⁄›[\î›\ôìŸôúŸ]	 OÀòY]ô[ù\›[ô\ä	⁄[ú]	ÀHOà¬à€€ú›àH\úŸQõÿ]
Kù\ôŸ]ùò[YJH¬àYà
⁄›[\î›\ôê€€Xò]›[òŸPX›]ôJ
JH◊‹⁄›[\î›\ôìŸôúŸ]ÿ€€Xò]Hé»[ŸH◊‹⁄›[\î›\ôìŸôúŸ]ŸYò][Hé¬à◊‹⁄›[\î›\ôìŸôúŸ]ÿ›\úô[ùHé»À»H]ôHòY»⁄›[òX⁄»H[›\ŸH[[YYX][Kõ›X\ŸH[Çà€€ú›ò[YQ[Hÿ›[Y[ùôŸ][[Y[ùûRY
	‹Ÿ][ô‘⁄›[\î›\ôìŸôúŸ]ò[YI N¬àYà
ò[YQ[
Hò[YQ[ù^€€ù[ùHãù—ö^Y
äN¬à\]Pÿ[Y\òT‹⁄][€ä
N¬àJN¬àÿ›[Y[ùôŸ][[Y[ùûRY
	‹Ÿ][ô‘⁄›[\î›\ôìŸôúŸ]â OÀòY]ô[ù\›[ô\ä	⁄[ú]	ÀHOà¬à€€ú›àH\úŸQõÿ]
Kù\ôŸ]ùò[YJH¬àYà
⁄›[\î›\ôê€€Xò]›[òŸPX›]ôJ
JH◊‹⁄›[\î›\ôìŸôúŸ]óÿ€€Xò]Hé»[ŸH◊‹⁄›[\î›\ôìŸôúŸ]óŸYò][Hé¬à◊‹⁄›[\î›\ôìŸôúŸ]óÿ›\úô[ùHé»À»H]ôHòY»⁄›[òX⁄»H[›\ŸH[[YYX][Kõ›X\ŸH[Çà€€ú›ò[YQ[Hÿ›[Y[ùôŸ][[Y[ùûRY
	‹Ÿ][ô‘⁄›[\î›\ôìŸôúŸ]ïò[YI N¬àYà
ò[YQ[
Hò[YQ[ù^€€ù[ùHãù—ö^Y
äN¬à\]Pÿ[Y\òT‹⁄][€ä
N¬àJN¬Çàù[ò›[€àÿ[YS€‹
õ› H¬à€€ú›HX]õZ[äå
õ›»H\›[YJH»L
N¬à\›[YHHõ›Œ¬àÿ[YQúò[YTŸ\öX[
 Œ¬ÇàYà
Yÿ[YT›\ùY
H¬à⁄[ô›Àì]\⁄XœÀò]Y[—XùY 	›ÿZ][ô»õ‹àÿ[YT›\ùYôYõ‹ôH]Y[»^XòX⁄…À	ÿ]Y[À]ÿZ]Yÿ[YK\›\ùY	ÀL
N¬àô[ô\ô\ãúô[ô\äÿŸ[ôKÿ[Y\òJN¬àô\]Y\›[ö[X][€ëúò[YJÿ[YS€‹
N¬àô]\õé¬àBÇà€‹õ‹\ù[ù[YOÀù\]Jõ› N¬Çà\]TÿŸ[ôUò[ú⁄][€ä
N¬ÇàYà
⁄[ô›Àëö\⁄[ôœÀú›]OÀòX›]ôJH⁄[ô›Àëö\⁄[ôÀù\]J
N¬à⁄[ô›Àì]\⁄X”Z[öYÿ[YOÀùX⁄ 
N¬Çà⁄[ô›Àì]\⁄XœÀù\]TòZ[ê]Y[ 
N¬à⁄[ô›Àì]\⁄XœÀù\]Q^\ö[‹êô‹ 
N¬à⁄[ô›Àì]\⁄XœÀù\]Qù\õö]\ôTŸû€›\òŸ\ 
N¬à⁄[ô›Àì]\⁄XœÀù\]P[XöY[ù›Y\ 
N¬à⁄[ô›Àì]\⁄XœÀù\]S\ôQX⁄⁄[ô 
N¬à⁄[ô›Àì]\⁄XœÀõŸ–]Y[’X⁄—XY€õ‹›X‹ 
N¬ÇàYà
\]\ŸY
H¬à\]Pÿ[[ô\ä
N¬à⁄[ô›ÀïŸX]\ëñóÿYò[òŸT€[€›YY⁄[ô 
N¬à€€€ùõ€\í[ú]

N¬à\]SY[YP]]’\ôŸ]

N¬à\]S[›ô[Y[ù

N¬à€€ú›⁄[\õô\‹–⁄[ö‘\ôàH⁄[ô›Àî\ôîõŸö[\èÀòôY⁄[ä	›⁄[\õô\‹»⁄[ö‹… N»À»YX\›\ô\»⁄[ö»›ôX[Z[ôÀÿùZ[‹ZŸ\»[àH^\›[ô»[ÿö[HõŸö[\ãÇà⁄[ô›Àï⁄[\õô\‹–⁄[ö‹œÀù\]J
N¬à⁄[ô›Àî\ôîõŸö[\èÀô[ô
⁄[\õô\‹–⁄[ö‘\ôäN¬à⁄[ô›Àï⁄[\õô\‹–ÿ[\ö\ôOÀù\]Uôû

N¬à⁄[ô›Àï⁄[\õô\‹”X\ù\]QõŸ–\õ›[ô^Y\ä
N¬à\]T^Y\ïö][ 
N¬à⁄[ô›Àê[⁄[^Tﬁ\›[Kù\]J
N¬à⁄[ô›Àê[⁄[^Qõ\⁄‹œÀù\]J
N¬à⁄[ô›Àê€€⁄⁄[ô‘ﬁ\›[Kù\]J
N¬à⁄[ô›Àêõ›[ùPõÿ\ôù\]UòX⁄⁄[ô 
N¬ÇàÀ»X›]ôH€€\[ö[€ú»[ô⁄›[\à]»õ€›»H^Y\àõ›Y⁄àÀ»]ô\ûH^XXõH[ù\ö[‹ãàHùZ[[ô»›[ÿY[ô»\»õ»ôX[àÀ»\›[ò][€àÿŸ[ôHY]€»ÿZ]ôZ[ôH^\›[ô»õX⁄»ÿŸ[ôBàÀ»ò[ú⁄][€àò]\à[à‹]€ö[ô»Hõ€›Ÿ\à[ù»ÿŸ[ôX	‹¬àÀ»ò[òX⁄»[ôX]ö[ô»]\ôHYù\àHùZ[[ô»ö[ö\⁄\ÀÇà€€ú›€€\[ö[€îÿŸ[ôTôXYHHW⁄\–ùZ[[ô–\ôXJ›\úô[ù\ôXJHHWÿùZ[[ô‘ÿŸ[ô\ÀôŸ]
›\úô[ù\ôXJN»À»ÿ]\»[ô€‹àõ€›Ÿ\àÿŸ[ôH]X⁄Y[ùÇàYà
€€\[ö[€îÿŸ[ôTôXYJH¬àﬁ[ò–€€\[ö[€ëúõ€U⁄\›J
N¬à\]P€€\[ö[€ú 
N¬àBàÀ»ù[ú»[à]ô\ûH\ôXH€»[ûH\ŸHŸàH[›[ùò[ú⁄][€à\»€X\ôYàÀ»[[YYX][H€à[ù\ö[ô»[à[ù\ö[‹ãà[›[ù»ô[XZ[à^\ö[‹ã[€õKÇà⁄[ô›Àì[›[ùœÀù\]S[›[ùöYJ
N¬ÇàYà
›\úô[ù\ôXHOOH	Ÿò\õI»›\úô[ù\ôXHOOH	››€â»⁄\÷õ€ôP\ôXJ›\úô[ù\ôXJH⁄\–ÿ]ô\õêùZ[[ô–\ôXJ›\úô[ù\ôXJJH¬à⁄[ô›Àêò[ô]ÿ[\Àù\]P€€\[ö[€î\òŸ\[€ä
N¬à⁄[ô›Àêò[ô]ÿ[\Àù\]Pÿ[\ò[õô\ú 
N¬à⁄[ô›Àï⁄[YôT‹]€ãù\]R‹›[T‹]€ö[ô 
N¬à€€ú›‹›[T\ôàH⁄[ô›Àî\ôîõŸö[\èÀòôY⁄[ä	⁄‹›[\… N»À»YX\›\ô\»H€€\]H›\úô[ùX\ôXH‹›[HRH[ôö\›X[ﬁ[ò⁄õ€ö^ò][€à\‹ÀÇà\]R‹›[\ 
N¬à⁄[ô›Àî\ôîõŸö[\èÀô[ô
‹›[T\ôäN¬à⁄[ô›Àê‹ôX]\ôQX]ù\]P€‹úŸ\ 
N¬àH[ŸHYà
⁄\–ùZ[[ô–\ôXJ›\úô[ù\ôXJJH¬àÀ»‹ô[ò\ûHùZ[[ô»[ù\ö[‹ú»›[]ôHõ»⁄[‹]€úŒ»\¬àÀ»úò[ò⁄€õHŸY\»[ûH]]‹ôY[ù\ö[‹à‹›[Kÿ€‹úŸHX›]ôKÇà€€ú›‹›[T\ôàH⁄[ô›Àî\ôîõŸö[\èÀòôY⁄[ä	⁄‹›[\… N»À»\Ÿ\»Hÿ[YH[Z[ô»ùX⁄Ÿ]õ‹à]]‹ôY[ù\ö[‹à€€Xò][ùÀÇà\]R‹›[\ 
N¬à⁄[ô›Àî\ôîõŸö[\èÀô[ô
‹›[T\ôäN¬à⁄[ô›Àê‹ôX]\ôQX]ù\]P€‹úŸ\ 
N¬àBÇà⁄[ô›Àê€[Xîﬁ\›[OÀù\]Qò[[ìô\›œÀä
N¬à\]Sô\›[ù\òX›[€ä
N¬àYà
⁄\÷õ€ôP\ôXJ›\úô[ù\ôXJJH⁄[ô›Àêò[ô]ÿ[\Àù\]U[ù[ù\òX›[€ä
N¬ÇàÀ»[ù\ö[‹à^]]X›[€éà^Y\àÿ[‹»€ù»[ûH€‹â‹»^][ùXÇàÀ»ô\⁄€
ŸYHúÀ⁄›\ŸK\YXŸ\Àöú…‹»€€\]R[ù\ö[‹ì^[›]

JKÇàYà
›\úô[ù\ôXHOOH	⁄[ù\ö[‹â»	âàÿŸ[ôUò[ú—\àOOH
H¬à€€ú›P€€HX]ôõ€‹ä^Y\ãû»SJKTõ›»HX]ôõ€‹ä^Y\ãûH»SJN¬àYà
⁄[ù\ö[‹ë^][\Àö\ P€€
»	À	»
»Tõ› JH^][ù\ö[‹ä
N¬àBÇàÀ»ò[ú⁄][€à‹›»
ò\õH8°•[ù\ö[‹à8°•›€à8°•ùZ[[ô BàYà
ÿŸ[ôUò[ú—\àOOH
H⁄X⁄’ò[ú⁄][€î‹› 
N¬ÇàYà
›\úô[ù\ôXHOOH	Ÿò\õI»›\úô[ù\ôXHOOH	››€â H¬à⁄[ô›ÀïŸX]\ëñù\]Uÿ]\î\ùX€\ 
N¬à⁄[ô›ÀïŸX]\ëñù\]Tö\\ 
N¬à⁄[ô›ÀïŸX]\ëñù\]SY⁄ö[ô—õ\⁄

N¬àBàYà
›\úô[ù\ôXHOOH	Ÿò\õI H⁄[ô›Àë]’ò]Àù\]SY\⁄õ›][€ú 
N¬àYà
›\úô[ù\ôXHOOH	Ÿò\õI H\]TõÿŸ\‹⁄[ô—ù\õö]\ôUôû

N¬à\]PX›[€î\ùX€\ 
N¬à⁄[ô›Àï⁄[ôX\›\ôKù\]T‹\ö€\ 
N¬à⁄[ô›Àëö\⁄[ôœÀù\]Qû

N¬àÀ»ÿ]\à⁄[HX⁄‹»]ô\ûHKŒÿ[YKZ›\à
é\»ôX[][YJBàÀ»\Ÿ\»ÿ[YH[YH€»òZ[à[ôòZ[òYŸH\ôH€ÿ⁄ÀX€€ú⁄\›[ùà⁄[PXÿ›[][]‹à
œH»VW”Së’‘—P””ë»
à
íQ““’TàHS‘ìíSë◊“’TäN»À»ÿ[YKZ›\ú»\àŸX¬àYà
⁄[PXÿ›[][]‹àèHåLçH	âà
›\úô[ù\ôXHOOH	Ÿò\õI»›\úô[ù\ôXHOOH	››€â JH¬à⁄[PXÿ›[][]‹àOHåLçN¬àYà
›\úô[ù\ôXHOOH	Ÿò\õI H¬à⁄[ô›Àïÿ]\îﬁ\›[KúôX€€\]Uÿ]\äò[ŸJN¬àX⁄’€‹õÿöôX› 
N¬àH[ŸH¬à€€ú›””»H››€ñõ€ôOÀò€€»åì’‘»H››€ñõ€ôOÀúõ›‹»L¬à⁄[ô›Àïÿ]\îﬁ\›[KúôX€€\]Uÿ]\äò[ŸK›€ë‹öYì’‘À”” N¬àBà⁄[ô›ÀïŸX]\ëñú‹]€îö\\ 
N¬àBàBÇàÀ»8• 8• ÿ[Y\òH€[€›õ€›»8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• à€€ú›\ôŸ]‹⁄][€àHX›]ôPÿ[Y\òU\ôŸ]Àú‹⁄][€é¬à€€ú›ﬁH\ôŸ]‹⁄][€à»\ôŸ]‹⁄][€ãûà^Y\ãû»SN¬à€€ú›ﬁàH\ôŸ]‹⁄][€à»\ôŸ]‹⁄][€ãûàà^Y\ãûH»SN¬àÀ»⁄›[\ã\›\ôàòX⁄‹»HX›X[ô[ô\ôY^Y\àY\⁄ZY⁄ò]\ÇàÀ»[àò\ôH‹õ›[ôZY⁄€»Hÿ[Y\òHö\Ÿ\»[ô⁄[ö‹»[€ô»⁄]àÀ»]8†%[›[ùŸX]Yùÿ⁄Z\îŸX]⁄[öÀ›ÿ]\àõÿãŸ]Àà
ŸYHH[›ô[Y[ùàÀ»\]I‹»\ôŸ]JH[ôXYH€€\‹ŸH[ù»^Y\ìY\⁄ú‹⁄][€ãûH]ô\ûBàÀ»úò[YHôYõ‹ôH\»ù[úÀ€»[›[ù[ô»H[‹ôX]\ôH‹àÿY[ô»[ù¬àÀ»ÿ]\àÿ\úöY\»›òZY⁄õ›Y⁄»Hÿ[Y\òHõ‹àúôYKÇà€€ú›ﬁHH\ôŸ]‹⁄][€à»\ôŸ]‹⁄][€ãûBàà
X›]ôPÿ[Y\òS[ŸHOOH“’STó‘’Tëó”S—H»^Y\ìY\⁄ú‹⁄][€ãûHà‹^Y\ë‹õ›[ôJ
JN¬à€€ú›ÿ[S\úHÿ[Y\òS[ŸP€€ôöY X›]ôPÿ[Y\òS[ŸJKôõ€›”\úœ»å¬àÿ[U\ôŸ]
œH
ﬁHÿ[U\ôŸ]
H
àÿ[S\ú¬àÿ[U\ôŸ]à
œH
ﬁàHÿ[U\ôŸ]äH
àÿ[S\ú¬àÿ[U\ôŸ]H
œH
ﬁHHÿ[U\ôŸ]JH
àÿ[S\ú¬àÀ»ÿYô]Hô]à€€YHÿ[Y\òK[[ŸHò[ú⁄][€ú»
ö\⁄[ôÀH]\⁄X¬àÀ»Z[öYÿ[YKî»X[Ÿ›YK\ùô\›[ù\òX›[€úÀããäH\‹⁄Y€ÇàÀ»X›]ôPÿ[Y\òS[ŸH\ôX›Hò]\à[àõ›Y⁄àÀ»[ù\ëYò][ÿ[Y\òS[ŸJ
K€»\»ÿ]⁄\»[ûHŸà[H[ô[ô¬àÀ»›]⁄YH⁄›[\ã\›\ôà⁄[H]»⁄[ù\àÿ⁄»\»›[[8†%àÀ»⁄X\[õ›Y⁄
€ôHõ‹\ùHôXY
H»ù\›⁄X⁄»]ô\ûHúò[YHò]\ÇàÀ»[à[ù[ô»›€à]ô\ûH›X⁄ÿ[⁄]H[ô]öYX[KÇàYà
X›\ú€‹õ\‹”[›\ŸPZ[Tô\]Y\›Y

JHô[X\ŸT⁄›[\î›\ôî⁄[ù\ìÿ⁄ 
N¬àÀ»ÿ[YHô€â›[ù›€à]ô\ûH[ŸK\›⁄]⁄ÿ[⁄]HàôX\€€ö[ô»\¬àÀ»H⁄[ù\àÿ⁄»ô[X\ŸHXõ›ôH8†%[Z][H‹õ›[ô\ò^HôXY»\¬àÀ»€\ö]Húõ€HHõ‹õX[‹Y›€àöY]»ù]ù\›€⁄‹»‹õ€ô»]àÀ»⁄›[\ã\›\ôâ‹»€‹ŸH\ô\\ú€€àò[ôŸK€»ŸY\][àÿ⁄‹›\àÀ»⁄]Hÿ[Y\òH[ŸH]ô\ûHúò[YH[ú›XYÇà⁄[ô›Àí[ÿöôX›ô[ô\ì‹ô\èÀúŸ][òXõY
X›]ôPÿ[Y\òS[ŸHOOH“’STó‘’Tëó”S—JN¬àÀ»X\Ÿ\»Hÿ[Y\òI‹»X›X[ŸôúŸ]
8†)óÿ›\úô[ù
H›ÿ\ô⁄X⁄]ô\ÇàÀ»›[òŸHô\Ÿ]\Y\»öY⁄õ›»8†%]ô\ûHúò[YKõ›ù\›BàÀ»[ú›[ùH›[òŸHõ\»8†%€»ò]⁄[ôÀ‹⁄X][ô»HŸX\€à
‹à[ûBàÀ»›\à€€⁄][H›ÿ\]⁄[ôŸ\»›[òŸJHôXY»\»H€[€›àÀ»\⁄Z[ã‹[XòX⁄»[ú›XYŸàHù[\X›]àHŸôúŸ]€Y\ú…¬àÀ»\‹^YYò[YH›[ù[\»[[YYX][H€àHõ\⁄[òŸH]	‹¬àÀ»ù\›⁄›⁄[ô»⁄X⁄ô\Ÿ]	‹»ù[Xô\à\»õ›»[à⁄\ôŸKõ›BàÀ»ò[ú⁄Y[ùX\ŸY‹⁄][€ãÇàYà
X›]ôPÿ[Y\òS[ŸHOOH“’STó‘’Tëó”S—JH¬à€€ú›€€Xò]›[òŸHH⁄›[\î›\ôê€€Xò]›[òŸPX›]ôJ
N¬à€€ú›\ôŸ]H€€Xò]›[òŸH»◊‹⁄›[\î›\ôìŸôúŸ]ÿ€€Xò]à◊‹⁄›[\î›\ôìŸôúŸ]ŸYò][¬à€€ú›\ôŸ]àH€€Xò]›[òŸH»◊‹⁄›[\î›\ôìŸôúŸ]óÿ€€Xò]à◊‹⁄›[\î›\ôìŸôúŸ]óŸYò][¬à◊‹⁄›[\î›\ôìŸôúŸ]ÿ›\úô[ù
œH
\ôŸ]H◊‹⁄›[\î›\ôìŸôúŸ]ÿ›\úô[ù
H
àX]õZ[äK“’STó‘’Tëó”—ëî—U”Tî
à
N¬à◊‹⁄›[\î›\ôìŸôúŸ]óÿ›\úô[ù
œH
\ôŸ]àH◊‹⁄›[\î›\ôìŸôúŸ]óÿ›\úô[ù
H
àX]õZ[äK“’STó‘’Tëó”—ëî—U”Tî
à
N¬àYà
€€Xò]›[òŸHOOH‹⁄›[\î›\ôìŸôúŸ]€Y\ê€€Xò]
H¬à‹⁄›[\î›\ôìŸôúŸ]€Y\ê€€Xò]H€€Xò]›[òŸN¬à€€ú›[Hÿ›[Y[ùôŸ][[Y[ùûRY
	‹Ÿ][ô‘⁄›[\î›\ôìŸôúŸ]	 N¬à€€ú›ë[Hÿ›[Y[ùôŸ][[Y[ùûRY
	‹Ÿ][ô‘⁄›[\î›\ôìŸôúŸ]â N¬à€€ú›ò[[Hÿ›[Y[ùôŸ][[Y[ùûRY
	‹Ÿ][ô‘⁄›[\î›\ôìŸôúŸ]ò[YI N¬à€€ú›ïò[[Hÿ›[Y[ùôŸ][[Y[ùûRY
	‹Ÿ][ô‘⁄›[\î›\ôìŸôúŸ]ïò[YI N¬àYà
[
H[ùò[YHH\ôŸ]¬àYà
ë[
Hë[ùò[YHH\ôŸ]é¬àYà
ò[[
Hò[[ù^€€ù[ùH\ôŸ]ù—ö^Y
äN¬àYà
ïò[[
Hïò[[ù^€€ù[ùH\ôŸ]ãù—ö^Y
äN¬àBàBàÀ»õÿ][ô»ÿ[Y\òHõﬁ\›X⁄Œà[[ŸôãXŸ[ù\à€õÿà‹⁄][€àö]ô\»[ÇàÀ»€ô€⁄[ô»\õàò]H]ô\ûHúò[YKõ‹à\»€ô»\»H›X⁄\›»
ŸYBàÀ»H⁄[ù\ô›€ã‹⁄[ù\õ[›ôH[ô\ú»ô[›»]X]\öX[^ôH][ôàÀ»ö[[àÿ[Y\òRõﬁ\›X⁄÷÷JKàŸ[ãZX[»Yà€€YH›\àRH€Z[\¬àÀ»[ú]ZYZ€[ú›XYŸàX]ö[ô»Hõﬁ\›X⁄»›X⁄»€àÿ‹ôY[ãÇàYà
ÿ[Y\òQòY‘⁄[ù\íYOOHù[
H¬àYà
Xÿ[Y\òQòY–[›ŸY

JH¬àÿ[Y\òQòY‘⁄[ù\íYHù[¬àYPÿ[Y\òRõﬁ\›X⁄ 
N¬àH[ŸHYà
Y[YP]]’\ôŸ]€à	âàY[YUŸX\€ì›]

JH¬àÀ»⁄[HY[YH]]À]\ôŸ]\»ÿ⁄ŸY€ã\»ÿ[YHY[à›X⁄¬àÀ»›ÿ\»\ôŸ]»Yù‹öY⁄[ú›XYŸàõ›][ô»Hÿ[Y\òH8†%àÀ»Z⁄[à»H€€ùõ€\â‹»öY⁄\›X⁄À][ﬁX€[ôÀàYŸKBàÀ»öYŸŸ\ôYŸôàHò]»ò[YH
õ›ÿ[Y\òRõﬁ\›X⁄÷⁄X⁄\¬àÀ»[ôXYHXYõ€ôK‹ô\‹€úŸKX›\ùôYõ‹àHÿ[Y\òK\õ›]Hÿ\ŸJBàÀ»€»€ôHù[\⁄\\›]ô\⁄€ôXY»\»^X›H€ôHﬁX€BàÀ»›\Hÿ[YH\ÿ‹ô]HôY[\»H€€ùõ€\â‹»ﬁ[ù\⁄^ôYàÀ»öY⁄›X⁄”Yù‘öY⁄›X⁄‘öY⁄ù]€úÀÇà€€ú›\›HX]òXú ÿ[Y\òRõﬁ\›X⁄÷
HèH–SQTêW“ì÷T’P“◊—PQì”ëH
àé¬àYà
\›	âàWÿÿ[Y\òRõﬁ\›X⁄’\ôŸ]ﬁX€T\›
HﬁX€SY[YP]]’\ôŸ]
ÿ[Y\òRõﬁ\›X⁄÷à»HàLJN¬àÿÿ[Y\òRõﬁ\›X⁄’\ôŸ]ﬁX€T\›H\›¬àH[ŸHYà
ÿ[Y\òRõﬁ\›X⁄÷OOHÿ[Y\òRõﬁ\›X⁄÷HOOH
H¬àÿÿ[Y\òRõﬁ\›X⁄’\ôŸ]ﬁX€T\›Hò[ŸN¬à€€ú›€[\Y»Hù[Xô\ãö\—ö[ö]Jù[Xô\ä\⁄›‹€€ùõ€–€€ôöY 
Kòÿ[Y\òTõ›]P€[\Y JH»ù[Xô\ä\⁄›‹€€ùõ€–€€ôöY 
Kòÿ[Y\òTõ›]P€[\Y HàN¬àÿ[Y\òP^ö[]]ŸôúŸ]Y»HúôYTõ›]Pÿ[Y\òPX›]ôJ
Bà»‹ò\^ö[]]Y ÿ[Y\òP^ö[]]ŸôúŸ]Y»Hÿ[Y\òRõﬁ\›X⁄÷
à–SQTêW“ì÷T’P“◊—Q◊‘Tó‘—P»
à
Bàà€[\
ÿ[Y\òP^ö[]]ŸôúŸ]Y»Hÿ[Y\òRõﬁ\›X⁄÷
à–SQTêW“ì÷T’P“◊—Q◊‘Tó‘—P»
àX€[\YÀ€[\Y N¬àÀ»[ùô\ùYô[]]ôH»€à\ú‹ŸH8†%X]⁄\»H\⁄›‹àÀ»⁄YùYòYÀ‹Z[ã[[›\Ÿ[€⁄»€€ùô[ù[€àù\›ô[›»

€[›ô[Y[ùBàÀ»]⁄\»Hÿ[YHÿ^JK⁄\ôX\»Hò]»›X⁄[H\»€õÿÇàÀ»\»ùZ[úõ€HôXY»H›\àÿ^Hõ‹àô\ùXÿ[Çàÿ[Y\òP[ô€SŸôúŸ]Y»H€[\
ÿ[Y\òP[ô€SŸôúŸ]Y»
»ÿ[Y\òRõﬁ\›X⁄÷H
à–SQTêW“ì÷T’P“◊—Q◊‘Tó‘—P»
àX€[\YÀ€[\Y N¬àBàBàYà
X›]ôPÿ[Y\òS[ŸHOOH“’STó‘’Tëó”S—H	âàW‹⁄›[\î›\ôêõ€›€ò\Y
H¬à‹⁄›[\î›\ôêõ€›€ò\YHùYN¬à€ò\⁄›[\î›\ôê^ö[]]

N¬àBà\]Pÿ[Y\òT‹⁄][€ä
N¬àÀ»ôYúô\⁄\»H⁄\ôYXYÿõŸK‹ô]X€HZ[H⁄[ù]ô\ûHúò[YBàÀ»
ò]\à[à€õH€àH[›\Ÿ[[›ôK››X⁄]ô[ù
H€»][ÿ^\¬àÀ»ôYõX›»H›\úô[ùÿ[Y\òH8†%[ò€Y[ô»H‹ö^õ€ù[ŸôúŸ]€YBàÀ»8†%]ô[àYàH^Y\à\»ù\››[ô[ô»›[]ö[ô»[ôXYH\õôYàÀ»Hÿ[Y\òKà]\›ù[àYù\à\]Pÿ[Y\òT‹⁄][€ä
HXõ›ôKõ›àÀ»ôYõ‹ôK‹àHò^Xÿ\›€›[\ŸH\›úò[YI‹»›[Hÿ[Y\òBàÀ»‹⁄][€ã€‹öY[ù][€ãÇàYà
X›]ôPÿ[Y\òS[ŸHOOH“’STó‘’Tëó”S—JH\]T⁄›[\î›\ôîô]X€PZ[J
N¬ÇàÀ»õ›Y»ç“ãõ›]ô\ûHúò[YH8†%ö]ô\»HôYKYòYH\ôŸ]¬àÀ»
‹X⁄]H[ô⁄[HHôYH\»X›X[Hõÿ⁄⁄[ôÀ\‹ö]JKÇà›ôY–›[Xÿ›[H
œH¬àYà
›ôY–›[Xÿ›[HèHåM
H¬à€€ú›õ‹òŸHH›ôY–›[Xÿ›[HèHL»À»ö\ú›X⁄»Yù\àÿ‹ö\ÿYà›ôY–›[Xÿ›[HH¬à\]Võ€ôUôYŸ]][€ê›[[ô õ‹òŸJN¬àBà\]UôYQòYP[ö[X][€ä
N¬ÇàÀ»ÿ[YHÿ[Y\òKX[Y€ôYX€‹úöY‹àö\⁄Xö[]HŸŸ€Kÿ[YHõ›Kõ‹ÇàÀ»H]úöX⁄»⁄[ö‹»ùZ[€òŸHûHôY⁄\›\î]úöX⁄–⁄[ö‹»8†%ŸYBàÀ»\]T]úöX⁄–›[[ôÀÇà‹]úöX⁄–›[Xÿ›[H
œH¬àYà
‹]úöX⁄–›[Xÿ›[HèHåM
H¬à€€ú›õ‹òŸHH‹]úöX⁄–›[Xÿ›[HèHL¬à‹]úöX⁄–›[Xÿ›[HH¬àYà
‹]úöX⁄–⁄[ö”\›Àú⁄^ôJH\]T]úöX⁄–›[[ô ›\úô[ù\ôXKõ‹òŸJN¬àBÇàÀ»8• 8• ôYKöú»\]\»8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• à\]T^Y\ìY\⁄

N¬à\]S[ôŸUòZ[›[\ 
N¬àYà
\]\ŸY
H¬à€€ú›ú‘\ôàH⁄[ô›Àî\ôîõŸö[\èÀòôY⁄[ä	€ú»ÿ[Ÿ\ú… N»À»YX\›\ô\»‹õ‹‹ÀX\ôXHÿ⁄Y[H\]\»\»›\úô[ùX\ôXH‹ùòZ][YôHÿ⁄Y[[ôÀÇà\]Sú’ÿ[Ÿ\ú 
N¬à⁄[ô›Àî\ôîõŸö[\èÀô[ô
ú‘\ôäN¬à⁄[ô›Àìú—ö[ö“[ù\òX›[€èÀù\]OÀä
N¬àYà
X[Ÿ›YS‹[äHòXŸSú—X[Ÿ›YT\ùX⁄\[ù 
N¬àBàÀ»ù[àYù\àî»õ›][ôÀŸòX⁄[ô»€»[àX›]ôH[XöY[ù‹ôY][ô»ÿ[à€àÀ»]»‹XZŸ\à›ÿ\ôH[ù[ôY\ôŸ]õ‹àHô[ô\ôYúò[YKÇà[XöY[ùX[Ÿ›YTù[ù[YOÀù\]Jõ› N¬àYà
›\úô[ù\ôXHOOH	››€â H¬à⁄[ô›Àïÿ]\îﬁ\›[Kù\]U›€ïÿ]\ìY\⁄\ 
N¬à\]U›€ïôYSY⁄[ô 
N¬àBàYà
⁄\÷õ€ôP\ôXJ›\úô[ù\ôXJJH¬à⁄[ô›Àïÿ]\îﬁ\›[Kù\]Võ€ôUÿ]\ìY\⁄\ ›\úô[ù\ôXJN¬àBàÀ»€€»[ô[òY»][\»ô[ô\à[ô[ö[X]H[à]ô\ûH^XXõHX\ÇàÀ»‹ô[ò\ûH[ù\ö[‹ú»›[€Z]€€Xò]‹ô]X€H\]\»ô[›Œ»\¬àÀ»ö\›X[\‹»Ÿ\»õ›[òXõHò\õH‹à€€Xò]X›[€ú»\ôKÇà\]U€€Y\⁄

N¬àÀ»€€Xò][ô\ôŸ][ô»ô[XZ[à[Z]Y»^\ö[‹àX\»[ô[àÿ]ô\õúÀÇàYà
›\úô[ù\ôXHOOH	Ÿò\õI»›\úô[ù\ôXHOOH	››€â»⁄\÷õ€ôP\ôXJ›\úô[ù\ôXJH⁄\–ÿ]ô\õêùZ[[ô–\ôXJ›\úô[ù\ôXJJH¬à\]P€€Xò]€€ôUòZ[

N¬à\]P⁄\ôŸPX›[€ä
N¬à€€ú›€€Xò]\ôàH⁄[ô›Àî\ôîõŸö[\èÀòôY⁄[ä	ÿ€€Xò]	 N»À»YX\›\ô\»H[Ÿ[\à^Y\ã‹õ⁄ôX›[H€€Xò]\]HŸ\\ò][Húõ€H‹›[HRKÇà⁄[ô›Àê€€Xò]Àù\]J
N¬à⁄[ô›Àî\ôîõŸö[\èÀô[ô
€€Xò]\ôäN¬à\]Tô]X€SY\⁄

N¬àBà⁄[ô›Àîò[ôŸYŸX\€úœÀù\]J
N¬à\]T^Y\íXYZ[J
N»À»]\›õ€›»\]U€€Y\⁄	‹»ö[ò[õŸVX]ÀÇà›X⁄‘^Y\î‹ùòZ]YôJ
N¬à\]T⁄›[\î]Y\⁄[ä
N¬àYà
›\úô[ù\ôXHOOH	Ÿò\õI H¬à⁄[ô›Àïÿ]\îﬁ\›[Kù\]Uÿ]\ìY\⁄\ 
N¬à\]P‹õ‹Y\⁄\ 
N¬à⁄[ô›Àëò\õP[ö[X[Àù\]P[ö[X[Y\⁄\ 
N¬à\]UôYSY⁄[ô 
N¬ÇàÀ»⁄[ô[ö[X][€à€àôYŸ]][€Çà€€ú›⁄[ô[YHH\ôõ‹õX[òŸKõõ› 
H»L¬à€€ú›⁄[ô›êò\ŸHHÿ[[ô\ãö\‘òZ[ö[ô¬à»
ÿ[[ô\ãúòZ[î›ô[ô›èH»»åLàåäBààåŒ¬à€€ú›‹^Y\ïH^Y\ãû»SN¬à€€ú›‹^Y\ïàH^Y\ãûH»SN¬àõ‹à
€€ú›õHŸàôY”Y\⁄\ H¬àYà
õKõX]\öX[	âàõKõX]\öX[ù[öYõ‹õ\ H¬àõKõX]\öX[ù[öYõ‹õ\ÀùU[YKùò[YHH⁄[ô[YN¬àÀ»õﬁ[Z]Hõ€‹›€õHöYŸŸ\ú»⁄][àKåà[\Àà\ŸH⁄X\àÀ»X[ö][àôKX⁄X⁄»»⁄⁄\X]ö\›õ‹à\›[ùY\⁄\ÀÇà€€ú›YHX]òXú õKú‹⁄][€ãûH‹^Y\ï
N¬à€€ú›YàHX]òXú õKú‹⁄][€ãûàH‹^Y\ïäN¬à]õﬁ[Z]T›é¬àYà
YKç	âàYàKç
H¬à€€ú›\›HX]ö\›
YYäN¬àõﬁ[Z]T›àH\›Kåà»⁄[ô›êò\ŸH
»åLà
à
KåàH\›
H»Kåàà⁄[ô›êò\ŸN¬àH[ŸH¬àõﬁ[Z]T›àH⁄[ô›êò\ŸN¬àBàõKõX]\öX[ù[öYõ‹õ\ÀùT›ô[ô›ùò[YH
œH
õﬁ[Z]T›àHõKõX]\öX[ù[öYõ‹õ\ÀùT›ô[ô›ùò[YJH
àåMN¬àBàBà€€ú›⁄[ôÿÿ[HH⁄[ô›êò\ŸH»åŒ¬àõ‹à
€€ú››ôöHŸà›ôY—õ€XYŸPX›]ôJH¬à€€ú›ô»HôY—õ€XYŸSY\⁄\÷◊›ôöWN¬àYà
Yô»YôÀó›⁄[ô[\
H€€ù[ùYN¬àÀ»⁄⁄\õ€XYŸHŸ[›]⁄YHHÿ[Y\òHöY]»8†%]€€â›ôHö\⁄XõKÇàYà
X]òXú ôÀú‹⁄][€ãûH‹^Y\ï
HàMX]òXú ôÀú‹⁄][€ãûàH‹^Y\ïäHàLJH€€ù[ùYN¬à€€ú›[\HôÀó›⁄[ô[\
à⁄[ôÿÿ[N¬àôÀúõ›][€ãûàH[\
àX]ú⁄[ä⁄[ô[YH
àKçà
»ôÀó›⁄[ô\ŸJN¬àôÀúõ›][€ãûH[\
àçH
àX]ò€‹ ⁄[ô[YH
àKåH
»ôÀó›⁄[ô\ŸH
àKå N¬àBàYà
‹ò\‹–ö[õÿ\ôX]
H¬à‹ò\‹–ö[õÿ\ôX]ù[öYõ‹õ\ÀùU[YKùò[YHH⁄[ô[YN¬à‹ò\‹–ö[õÿ\ôX]ù[öYõ‹õ\ÀùT›ô[ô›ùò[YHH◊ÿö[⁄[ô»⁄[ô›êò\ŸHà¬àBàBàYà
›\úô[ù\ôXHOOH	››€â»	âà‹ò\‹–ö[õÿ\ôX]
H¬àÀ»›€à‹ò\‹»ö[õÿ\ô»⁄\ôHHò\õI‹»⁄[ô⁄Y\ã€X]\öX[€»ŸY\àÀ»[H›ÿ^Z[ô»€»8†%ò\õI‹»õÿ⁄»Xõ›ôH€õHù[ú»⁄[H€àHò\õKÇà€€ú›⁄[ô[YHH\ôõ‹õX[òŸKõõ› 
H»L¬à‹ò\‹–ö[õÿ\ôX]ù[öYõ‹õ\ÀùU[YKùò[YHH⁄[ô[YN¬à‹ò\‹–ö[õÿ\ôX]ù[öYõ‹õ\ÀùT›ô[ô›ùò[YHH◊ÿö[⁄[ô»
ÿ[[ô\ãö\‘òZ[ö[ô»»
ÿ[[ô\ãúòZ[î›ô[ô›èH»»åLàåäHàå Hà¬àBÇàÀ»€€ú›[ùX€‹›€‹õòZ[éàôYHUãﬁX]»\]\»ôYÿ\ô\‹»Ÿà[ú⁄]KÇà⁄[ô›ÀîòZ[î[ô\œÀù\]J
N¬àYà
◊ÿ€›Yõ‹ô\›õŸ H⁄[ô›Àê€›Yõ‹ô\›õŸœÀù\]J
N¬ÇàÀ»8• 8• ô[ô\àX›]ôHÿŸ[ôH8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• à€€ú›X›]ôTÿŸ[ôHHŸ]X›]ôTÿŸ[ôJ
N¬àYà
◊€›][ô\ H¬àÀ»€€›\à
»\[ù»[àŸôúÿ‹ôY[à\ôŸ]€»H‹›\õÿŸ\‹¬àÀ»€€\‹⁄]Hô[›»ÿ[àôXYôX[\ã\^[\Yù\ùÿ\ô»8†%àÀ»ô[ô\ö[ô»›òZY⁄»Hÿ[ùò\»€›[‹ŸH]\ùYôô\ÇàÀ»H[€Y[ùHù[ÿ‹ôY[à€€\‹⁄]H]XY›ô\ù‹ö]\»]Çàô[ô\ô\ãúŸ]ô[ô\ï\ôŸ]
€XZ[îï
N¬àô[ô\ô\ãúô[ô\äX›]ôTÿŸ[ôKÿ[Y\òJN¬ÇàÀ»ô\Ÿ\ùôHH€€›\ãŸ\ô\›[⁄[Hë»⁄[›Y]\»Y€õBàÀ»HZ\‹⁄[ô»ÿÿ€\⁄[€à\ôYYYûHõ››][ôHﬁ\›[\ÀÇàô[ô\ô\ãò]]–€X\ê€€‹àHò[ŸN¬àô[ô\ô\ãò]]–€X\ë\Hò[ŸN¬à‹ô[ô\îô‘[ôS›][ôSÿÿ€Y\ë\
X›]ôTÿŸ[ôJN¬ÇàÀ»Ÿ[X›]ôH⁄[›][ôH\‹»
^Y\ãLHÿöôX›»€õJBàX›]ôTÿŸ[ôKõ›ô\úöYSX]\öX[H⁄[›][ôSX]¬àÿ[Y\òKõ^Y\úÀúŸ]
JN¬àô[ô\ô\ãúô[ô\äX›]ôTÿŸ[ôKÿ[Y\òJN¬àÿ[Y\òKõ^Y\úÀô[òXõP[

N¬àX›]ôTÿŸ[ôKõ›ô\úöYSX]\öX[Hù[¬ÇàÀ»€€›\ôY\ôŸ]›][ôH\‹»
^Y\ãLàÿöôX›»8†%‹ôY[à[›ŸYôYõÿ⁄ŸY
BàYà
›\ôŸ]›][ôSY\⁄\Àõ[ô›à
H¬àÿŸ[ôKõ›ô\úöYSX]\öX[H›\ôŸ]›][ôP[›ŸY»\ôŸ]›][ôQ‹ôY[ìX]à\ôŸ]›][ôTôYX]¬àÿ[Y\òKõ^Y\úÀúŸ]
äN¬àô[ô\ô\ãúô[ô\äÿŸ[ôKÿ[Y\òJN¬àÿ[Y\òKõ^Y\úÀô[òXõP[

N¬àÿŸ[ôKõ›ô\úöYSX]\öX[Hù[¬àBàô[ô\ô\ãò]]–€X\ê€€‹àHùYN¬àô[ô\ô\ãò]]–€X\ë\HùYN¬ÇàÀ»ù\õö]\ôHX]\öX[RQùYôô\à
^Y\ãL»ÿöôX›»€õJH8†%ôYY»BàÀ»X]\öX[\ŸX[HYŸH]X›[€à[àH€€\‹⁄]H⁄Y\àô[›ÀÇàÀ»⁄⁄\Y[ù\ô[H⁄[H◊Ÿù\õö]\ôTŸX[S›][ô\»\»Ÿôà8†%BàÀ»€€\‹⁄]I‹»TŸX[S›][ô\”€à[öYõ‹õH[€»ô\õŸ\»]»€€ùöXù][€ÇàÀ»ôYÿ\ô\‹À€»X]ö[ô»ŸYŸRYï	‹»€€ù[ù»›[H\ôH\»ÿYôKÇàYà
◊Ÿù\õö]\ôTŸX[S›][ô\ H¬àô[ô\ô\ãúŸ]ô[ô\ï\ôŸ]
ŸYŸRYï
N¬àô[ô\ô\ãúŸ]€X\ê€€‹ä
N¬àô[ô\ô\ãò€X\äùYKùYKò[ŸJN¬àÿ[Y\òKõ^Y\úÀúŸ]
 N¬àX›]ôTÿŸ[ôKõ›ô\úöYSX]\öX[HŸù\õö]\ôRYX]¬àô[ô\ô\ãúô[ô\äX›]ôTÿŸ[ôKÿ[Y\òJN¬àX›]ôTÿŸ[ôKõ›ô\úöYSX]\öX[Hù[¬àÿ[Y\òKõ^Y\úÀô[òXõP[

N¬àBÇàÀ»\[€õH€›\òŸHõ‹àH\YYŸH]X›‹ãëÀ\[ôH]ò]\ú¬àÀ»
ŸYH€X\ö‘ô‘[ôJH[ô‹ò\‹»ö[õÿ\ô»
\Ÿ\ë]Kö\–ö[õÿ\ôàÀ»Ÿ]]‹ôX][€à€à]ô\ûH[ú›[òŸYY\⁄ùZ[úõ€HŸ‹ò\‹–õYQŸ[ BàÀ»Y[àõ‹à\»\‹»€õH€»Z\à‹ö]H›]›]⁄[›Y]\»[ôàÀ»ôX\ãYYŸK[€à]XY[ô€\»ô]ô\àôYYH]X›‹à\»ò[ŸHYŸ\ÀÇàÀ»‹Z[ã€ŸôàûHYò][⁄[òŸH]	‹»[à^òHù[ÿŸ[ôH\‹»€à‹àÀ»Ÿà]ô\û][ô»Xõ›ôKÇàYà
◊Ÿ\›][ô\ H¬à€€ú›⁄Y[ëõ‹ë\\‹»H◊N¬àX›]ôTÿŸ[ôKùò]ô\úŸJ»Oà¬àYà

Àù\Ÿ\ë]Kö\‘ô‘[ôHÀù\Ÿ\ë]Kö\–ö[õÿ\ô
H	âàÀùö\⁄XõJH¬àÀùö\⁄XõHHò[ŸN¬à⁄Y[ëõ‹ë\\‹Àú\⁄
 N¬àBàJN¬àô[ô\ô\ãúŸ]ô[ô\ï\ôŸ]
Ÿ\€õTï
N¬àX›]ôTÿŸ[ôKõ›ô\úöYSX]\öX[HŸ\€õSX]¬àô[ô\ô\ãúô[ô\äX›]ôTÿŸ[ôKÿ[Y\òJN¬àX›]ôTÿŸ[ôKõ›ô\úöYSX]\öX[Hù[¬à⁄Y[ëõ‹ë\\‹Àôõ‹ëXX⁄
»Oà»Àùö\⁄XõHHùYN»JN¬àBÇàÀ»€€\‹⁄]Nàõ[ô\Y\ÿ€€ù[ùZ]H
»ù\õö]\ôHX]\öX[\ŸX[BàÀ»›][ô\»›ô\àHô[ô\ôYÿŸ[ôK›òZY⁄»Hÿ[ùò\ÀÇàô[ô\ô\ãúŸ]ô[ô\ï\ôŸ]
ù[
N¬à‹‹›X]ù[öYõ‹õ\Àù€€‹ãùò[YHH€XZ[îïù^\ôN¬à‹‹›X]ù[öYõ‹õ\Àù\ùò[YHH◊Ÿ\›][ô\»»Ÿ\€õTïô\^\ôHà€XZ[îïô\^\ôN¬à‹‹›X]ù[öYõ‹õ\ÀùYŸRYùò[YHHŸYŸRYïù^\ôN¬à‹‹›X]ù[öYõ‹õ\ÀùYŸRY\ùò[YHHŸYŸRYïô\^\ôN¬à‹‹›X]ù[öYõ‹õ\ÀùÿŸ[ôQ\ùò[YHH€XZ[îïô\^\ôN¬à‹‹›X]ù[öYõ‹õ\ÀùPÿ[Y\òSôX\ãùò[YHHÿ[Y\òKõôX\é¬à‹‹›X]ù[öYõ‹õ\ÀùPÿ[Y\òQò\ãùò[YHHÿ[Y\òKôò\é¬à‹‹›X]ù[öYõ‹õ\ÀùQ\›][ô\”€ãùò[YHH◊Ÿ\›][ô\»»Hà¬à‹‹›X]ù[öYõ‹õ\ÀùQ\ô\⁄ÿÿ[Kùò[YHH◊Ÿ\›][ôUô\⁄ÿÿ[N¬à‹‹›X]ù[öYõ‹õ\ÀùTŸX[S›][ô\”€ãùò[YHH◊Ÿù\õö]\ôTŸX[S›][ô\»»Hà¬àô[ô\ô\ãúô[ô\ä‹‹›ÿŸ[ôK‹‹›ÿ[Y\òJN¬àH[ŸH¬àô[ô\ô\ãúŸ]ô[ô\ï\ôŸ]
ù[
N¬àô[ô\ô\ãúô[ô\äX›]ôTÿŸ[ôKÿ[Y\òJN¬àÀ»€€›\ôY\ôŸ]›][ôH\‹»
^Y\ãLàÿöôX›»8†%‹ôY[à[›ŸYôYõÿ⁄ŸY
BàYà
›\ôŸ]›][ôSY\⁄\Àõ[ô›à
H¬àô[ô\ô\ãò]]–€X\ê€€‹àHò[ŸN¬àô[ô\ô\ãò]]–€X\ë\Hò[ŸN¬àÿŸ[ôKõ›ô\úöYSX]\öX[H›\ôŸ]›][ôP[›ŸY»\ôŸ]›][ôQ‹ôY[ìX]à\ôŸ]›][ôTôYX]¬àÿ[Y\òKõ^Y\úÀúŸ]
äN¬àô[ô\ô\ãúô[ô\äÿŸ[ôKÿ[Y\òJN¬àÿ[Y\òKõ^Y\úÀô[òXõP[

N¬àÿŸ[ôKõ›ô\úöYSX]\öX[Hù[¬àô[ô\ô\ãò]]–€X\ê€€‹àHùYN¬àô[ô\ô\ãò]]–€X\ë\HùYN¬àBàBÇàÀ»8• 8• ë›ô\õ^\»
€€Xò]ŸXùYÀ€Y⁄ö[ôÀ\»Y⁄[ô H8• 8• àò]”›ô\õ^\ 
N¬à⁄[ô›ÀïŸX]\ëñôò]”Y⁄[ô”›ô\õ^J
N¬Çà⁄[ô›ÀëX[Ÿ›YP€€ù[ùÀù\]Sú—X[Ÿ›YT‹ùòZ]
õ› N¬à\]RY

N¬àô\]Y\›[ö[X][€ëúò[YJÿ[YS€‹
N¬àBÇàÀ»XùY»]õﬁÿ€€Y\à›ô\õ^H
Ÿ][ô‹»8°§à]à€€»8°§à⁄›»]õﬁ\ BàÀ»õ›»]ô\»[àúÀŸXùYÀZ]õﬁ\Àöú»8†%ÿ[öXH⁄[ô›ÀëXùY“]õﬁ\Àôò] 
KÇÇàÀ»8• 8• ë›ô\õ^Hò]»
€‹õòZ[à\»ô[ô\ôYûHòZ[î[ô\ H8• àù[ò›[€àò]”›ô\õ^\ 
H¬à€€ú›ôX›H›ôYTôX›¬à€€ú›»HôX›ù⁄YHôX›öZY⁄¬àÿ›ò€X\îôX›
À
N¬ÇàYà
›\úô[ù\ôXHOOH	⁄[ù\ö[‹â H¬àò]–X›[€î\ùX€\ 
N¬àô]\õé¬àBÇàYà
ÿ[[ô\ãö\‘òZ[ö[ô H¬à€€ú››àHÿ[[ô\ãúòZ[î›ô[ô›N¬à€€ú›\‘›‹õHH›àèHŒ¬ÇàÀ»ŸY\H⁄X\ŸX]\à[ù\ôN»[ô]öYX[›ôXZ‹»õ›»]ôH€ÇàÀ»ôYH€‹õ\‹XŸH[ô\»[àH^\›[ô»ŸXë”ô[ô\ô\ãÇàÿ›ôö[›[HH\‘›‹õH»	‹ôÿòJÃLåL
I»à	‹ôÿòJåLåJIŒ¬àÿ›ôö[ôX›
À
N¬àBÇàò]’ŸX\€ïòZ[YôôX› 
N¬àò]–X›[€ï[QYôôX› 
N¬àò]–X›[€î\ùX€\ 
N¬ÇàYà
Y⁄ö[ô–[Hà
H¬àÿ›ôö[›[HHôÿòJååççMK	€Y⁄ö[ô–[H
àåÕ_JX¬àÿ›ôö[ôX›
À
N¬àBÇà⁄[ô›ÀëXùY“]õﬁ\Àôò] 
N¬àBÇàù[ò›[€àX\ö’[Q\ùJ€€õ› H¬à⁄[ùò[Y]P‹õ‹\›

N¬àôYúô\⁄[SY\⁄
€€õ› N¬àÀ»ëSê“‘êRT—Q⁄\H\[ô»€à⁄X⁄ôZY⁄õ‹ú»⁄\ôHZ\à\K€»[ûBàÀ»⁄[ôŸH]€›[[\à‹ŸH€€õôX›[€ú»]\›[€»ôYúô\⁄‹ŸHôZY⁄õ‹úÀÇàõ‹à
€€ú›ŸÀóHŸà÷ÃLWKÃWKÀLKKÃKWJH¬à€€ú›ùH‹öY‹õ›»
»óOÀñÿ€€
»◊OÀù\N¬àYà
ùOOH[U\KïëSê“ùOOH[U\KîêRT—Q
BàôYúô\⁄[SY\⁄
€€
»Àõ›»
»äN¬àBàBÇàù[ò›[€à\]Pÿ[[ô\ä
H¬Çà€€ú›ô]ö[›\“›\àH⁄[ô›Àêÿ[[ô\îﬁ\›[KôŸ]›\ä
N¬àÿ[[ô\ãù[YLH
œH»VW”Së’‘—P””ëŒ¬àYà
ÿ[[ô\ãù[YLHèHJH¬àÿ[[ô\ãù[YLHOHN¬àYò[òŸQ^J
N¬àBà€€ú››\úô[ù›\àH⁄[ô›Àêÿ[[ô\îﬁ\›[KôŸ]›\ä
N¬àYà
X]ôõ€‹äô]ö[›\“›\äHOOHX]ôõ€‹ä›\úô[ù›\äJH¬à⁄[ô›ÀïŸX]\ëñù\]TòZ[î›]J
N¬àYà
X]ôõ€‹ä›\úô[ù›\äHOOHS‘ìíSë◊“’TäH»X⁄–‹õ‹^J
N»⁄[ô›ÀïŸX]\ëñò⁄X⁄—õ‹ìXZõ‹î›‹õJ
N»€‹õÿöôX›[‹õö[ô’X⁄ 
N»BàÀ»úôYY[ô»õŸ‹ô\‹»X⁄‹»\à[ãYÿ[YH›\à‹õ‹‹ŸY
ò]\à[ÇàÀ»€òŸH\à^JH€»HZ\â‹»ò\àö\⁄XõH‹ôY\»õ‹ùÿ\ôõ›Y⁄àÀ»H^H[ôÿ[à€€\]HH[€Y[ù]ö[Àõ›ù\›]BàÀ»ô^[‹õö[ô»8†%ŸYHò\õP[ö[X[ÀùX⁄–úôYY[ô‘õŸ‹ô\‹Àà€Y\[êôY

BàÀ»€›ô\ú»⁄]]ô\àúòX›[€àŸàH^H\»ôX[][YH]⁄⁄\ÀÇà⁄[ô›Àëò\õP[ö[X[ÀùX⁄–úôYY[ô‘õŸ‹ô\‹ 
N¬àÀ»⁄X\€òŸK\\ãZ[ãYÿ[YKZ›\àõ\⁄
ô]ô\ûHLàôX[ŸX€€ô»]BàÀ»Yò][VW”Së’‘—P””ë H€»H‹ò\⁄Ÿõ‹òŸKX€‹ŸHô]ŸY[à^BàÀ»õ€›ô\ú»›[€õH‹Ÿ\»Hô]»Z[ù]\»Ÿà[ãYÿ[YH[YBàÀ»[ú›XYŸàH⁄€HŸ\‹⁄[€à8†%ŸYH‹ÿ]ôU€‹õÿ[[ô\ãÇà‹ÿ]ôU€‹õÿ[[ô\ä
N¬àBàBÇàù[ò›[€àYò[òŸQ^J
H¬àÿ[[ô\ãô^H
œHN¬à⁄[ô›ÀïŸX]\ëñò⁄€‹ŸUŸX]\ëõ‹ë^J
N¬àX⁄–‹õ‹^J
N¬àÀ»úôYY[ô»\»X⁄ŸY›\õH
ŸYH\]Pÿ[[ô\ã‹€Y\[êôY
Kõ›àÀ»\ôH8†%ûHH[YHH^Hò]\ò[Hõ€»›ô\ã]ô\ûH€ôHŸà]¬àÀ»ÿZ⁄[ô»›\ú»\»[ôXYHôY[à‹ôY]Y[àôX[[YKÇà⁄[ô›Àëò\õP[ö[X[ÀùX⁄‘ô\€›\òŸ\ 
N¬à⁄[ô›Àëò\õP[ö[X[ÀùX⁄“X\ù 
N¬à⁄[ô›ÀîõÿŸY\ò[\⁄‹ÀõX^XôTôYúô\⁄ô\]Y\›‹›[ô‹ 
N¬à\›X›[€ìY\‹ÿYŸHH^H	ÿÿ[[ô\ãô^_HôY⁄[úŒà	ÿÿ[[ô\ãùŸX]\üKò¬à⁄X⁄’›[⁄Yù

N¬àÀ»[ûH[à⁄\Y›]⁄[òŸH]›\ùYÿZ][ô»ÿ[àõ›»ôH[›ôYòX⁄¬àÀ»[ù»8†%ŸYH[ú›\ôP›\úô[ùõ€ôQ[îX⁄‹À⁄X⁄Ÿ\»HX›X[àÀ»
^ûK›\úô[ù^õ€ôK[€õJH‹]€ö[ô»€òŸH\»ö\ô\ÀÇà⁄[ô›Àï⁄[YôT‹]€ãò€X\î[ô[ô—[îô\‹]€ä
N¬à⁄[ô›ÀîôXYŸ[ù[ùÀúô\‹]€ê[õ€ôTôXYŸ[ù 
N¬à⁄[ô›Àï⁄[ô\úöY\Àúô\‹]€ê[

N¬à⁄[ô›Àï⁄[ôX\›\ôKúô\‹]€ê[

N¬àX⁄—ô[YôYTôY‹õ››

N¬àX⁄”Z[ôYõÿ⁄‘ôY‹õ››

N¬à‹ÿ]ôU€‹õÿ[[ô\ä
N¬àBÇàÀ»€Y\[ô»[àHôY
ŸYHŸ][ù\ö[‹í[ù\òX›XõP]
H⁄⁄\»›òZY⁄¬àÀ»Hô^[‹õö[ô»ò]\à[àÿZ][ô»õ‹àÿ[[ô\ãù[YLH»‹ò\àÀ»ò]\ò[H8†%ÿ[YH^K\õ€›ô\à€‹ö»\»Yò[òŸQ^J
H
ŸX]\àô\õ€àÀ»‹õ‹‹õ›››[⁄Yù⁄X⁄À[àô\‹]€ú K\»ô\Ÿ][ô»BàÀ»€ÿ⁄»]Ÿ[à[ôô\›‹ö[ô»H^Y\ã⁄X⁄Yò[òŸQ^J
HŸ\€â›àÀ»ôYY»»⁄[òŸH]€õH]ô\àö\ô\»úõ€HHôX[[\ŸY][YH‹ò\Çàù[ò›[€à€Y\[êôY

H¬àÀ»⁄]]ô\àúòX›[€àŸàŸ^I‹»ÿZ⁄[ô»›\ú»Yâ›ôY[à^YYàÀ»õ›Y⁄Y]
[ô€»ô]ô\à€›[à›\õHúôYY[ô»X⁄»úõ€BàÀ»\]Pÿ[[ô\äHŸ]»‹ôY]Y\ôH[à€ôH[\€»HZ\ÇàÀ»õŸ‹ô\‹Ÿ\»Hÿ[YH€ôH^I‹»€‹ù⁄]\à]^Hÿ\»^YYàÀ»›][àôX[[YH‹à€\õ›Y⁄Çà€€ú›ô[XZ[ö[ô—^QúòX›[€àHX]õX^
HHÿ[[ô\ãù[YLJN¬àÿ[[ô\ãô^H
œHN¬àÿ[[ô\ãù[YLHH»À»ÿZŸH]S‘ìíSë◊“’TÇà⁄[ô›ÀïŸX]\ëñò⁄€‹ŸUŸX]\ëõ‹ë^J
N»À»[€»ô\ﬁ[ò‹»\‘òZ[ö[ôÀ‹òZ[î›ô[ô›»Hô]»›\ÇàX⁄–‹õ‹^J
N¬à⁄[ô›Àëò\õP[ö[X[ÀùX⁄–úôYY[ô‘õŸ‹ô\‹ ô[XZ[ö[ô—^QúòX›[€äN¬à⁄[ô›Àëò\õP[ö[X[ÀùX⁄‘ô\€›\òŸ\ 
N¬à⁄[ô›Àëò\õP[ö[X[ÀùX⁄“X\ù 
N¬à⁄[ô›ÀîõÿŸY\ò[\⁄‹ÀõX^XôTôYúô\⁄ô\]Y\›‹›[ô‹ 
N¬à⁄X⁄’›[⁄Yù

N¬à⁄[ô›Àï⁄[YôT‹]€ãò€X\î[ô[ô—[îô\‹]€ä
N¬à⁄[ô›ÀîôXYŸ[ù[ùÀúô\‹]€ê[õ€ôTôXYŸ[ù 
N¬à⁄[ô›Àï⁄[ôX\›\ôKúô\‹]€ê[

N¬àX⁄—ô[YôYTôY‹õ››

N¬àX⁄”Z[ôYõÿ⁄‘ôY‹õ››

N¬à^Y\ãöX[H^Y\ãõX^X[¬à^Y\ãú›[Z[òHH^Y\ãõX^›[Z[òN¬à€€ú›\Ÿ»H<'Ê-€\[ù[[‹õö[ôÀà^H	ÿÿ[[ô\ãô^_HôY⁄[úŒà	ÿÿ[[ô\ãùŸX]\üKò¬à\›X›[€ìY\‹ÿYŸHH\ŸŒ¬à‹ÿ]ôU€‹õÿ[[ô\ä
N¬àô]\õà»⁄ŒàùYKY\‹ÿYŸNà\Ÿ»N¬àBÇàÀ»ŸX]\àõ€[ô»
⁄€‹ŸUŸX]\ëõ‹ë^K›\]TòZ[î›]JHõ›»]ô\¬àÀ»[àúÀ›ŸX]\ãYûöú»8†%ÿ[öXH⁄[ô›ÀïŸX]\ëñäãÇÇàù[ò›[€àX⁄–‹õ‹^J
H¬àõ‹à
]õ›»H»õ›»ì’‘Œ»õ›   H¬àõ‹à
]€€H»€€””Œ»€€
  H¬à€€ú›[HH‹öY‹õ›◊Vÿ€€N¬àYà
][Kò‹õ‹
H€€ù[ùYN¬à€€ú›]HH‹õ‹]V›[Kò‹õ‹N¬à€€ú›][H‹õ‹‹õ››][\Y\ä[K€€õ› N¬à€€ú›]⁄›ô\‹»H]KõôYY–YòXŸ[ù]⁄	âàZ\–YòXŸ[ù]⁄
€€õ› H»	€ôYY»]⁄	»à	…Œ¬à[Kú›ô\‹»H]⁄›ô\‹»
][åMH»
[Kùÿ]\à]KöYX[Z[à»	›€»ûI»à	›ÿ]\õŸŸŸY	 Bàà][çà»
[Kùÿ]\à]KöYX[Z[à»	ŸûI»à	›€»Ÿ]	 Bàà	… N¬à[Kò‹õ‹YŸH
œH][¬à[Kò‹õ‹ôXYHH[Kò‹õ‹YŸHèH]Kô‹õ›—^\Œ¬àBàBàBÇàÀ»ô]\õú»ãåH‹õ››ò]Hò\ŸY€à›»€‹ŸH[Kùÿ]\à\»»‹õ‹YX[ò[ôÇàù[ò›[€àÿ[î[ù‹õ‹€ï[J‹õ‹[JH¬àYà
X‹õ‹]Vÿ‹õ‹JHô]\õàò[ŸN¬àô]\õà’[U\KïSQ[U\KîêRT—QKö[ò€Y\ [Kù\JH	âà][Kò‹õ‹¬àBÇàù[ò›[€à\–YòXŸ[ù]⁄
€€õ› H¬àô]\õàÿ\ô[ò[ôZY⁄õ‹ú €€õ› Kú€€YJ⁄[ùOà‹öY‹⁄[ùúõ›◊V‹⁄[ùò€€Kù\HOOH[U\KïëSê“
N¬àBÇàù[ò›[€à‹õ‹‹õ››][\Y\ä[K€€õ› H¬àYà
][Kò‹õ‹
Hô]\õà¬à€€ú›]HH‹õ‹]V›[Kò‹õ‹N¬à€€ú›»YX[Z[ãYX[X^HH]N¬à€€ú›»H[Kùÿ]\à»PV’–UTé¬à]ÿ]\ì][¬àYà
»èHYX[Z[à	âà»HYX[X^
Hÿ]\ì][HKå¬à[ŸHYà
»YX[Z[äHÿ]\ì][HX]õX^

»H
YX[Z[àHç
JH»ç
N¬à[ŸHÿ]\ì][HX]õX^


YX[X^
»ç
HH H»ç
N¬à€€ú›]⁄][H]KõôYY–YòXŸ[ù]⁄	âàZ\–YòXŸ[ù]⁄
€€õ› H»ççHàKå¬àô]\õàÿ]\ì][
à]⁄][¬àBÇàÀ»Hÿ]\à⁄[][][€à]Ÿ[à
]ô—‹öYÿ]\ì]ô[‹ôX€€\]Uÿ]\äHõ›¬àÀ»]ô\»[àúÀ›ÿ]\ã\ﬁ\›[Köú»8†%ÿ[öXH⁄[ô›Àïÿ]\îﬁ\›[KäãÇÇàù[ò›[€àô[ò⁄ôZY⁄õ‹ú €€õ› H¬àÀ»\ŸYûHÿ]\àõ›][ôŒà€›]\»ö\ú›»ô\Ÿ\ùôHHö\⁄XõHõ‹ù]À\€›]öX\ÀÇàô]\õà¬à»€€õ›Œàõ›»
»HKà»€€à€€HKõ›»Kà»€€à€€
»Kõ›»Kà»€€õ›Œàõ›»HHBàKôö[\ä\“[ú⁄YQ‹öY
N¬àBÇàù[ò›[€àÿ\ô[ò[ôZY⁄õ‹ú €€õ› H¬àô]\õà¬à»€€õ›Œàõ›»HHKà»€€à€€
»Kõ›»Kà»€€õ›Œàõ›»
»HKà»€€à€€HKõ›»BàKôö[\ä\“[ú⁄YQ‹öY
N¬àBÇàù[ò›[€à\“[ú⁄YQ‹öY
⁄[ù
H¬àô]\õà⁄[ùò€€èH	âà⁄[ùò€€””»	âà⁄[ùúõ›»èH	âà⁄[ùúõ›»ì’‘Œ¬àBÇàù[ò›[€àŸ]X›]ôU€€
€€‹»HﬂJH¬àYà
]€€X›[€ú÷›€€JHô]\õé¬àYà
X›]ôU€€OOH	‹ò[ôŸY	»	âà€€OOH	‹ò[ôŸY	 H⁄[ô›Àîò[ôŸYŸX\€úœÀòÿ[òŸ[^Y\êX›[€èÀä
N¬à[[ŸHH	›€€	Œ¬àX›]ôU€€H€€¬àYà
“QS‘”’Àö[ò€Y\ €€
JH\›[ò\õU€€H€€»À»\ôX››Ÿ^\ÀÿﬁX€[ô»]\›\]HHÿ[YHôXÿ[Y[[‹ûH\»\ò⁄Ÿ[X›[€ãÇà€€ú›X›[€ú»H€€X›[€ú÷›€€N¬àYà
XX›[€úÀö[ò€Y\ X›]ôPX›[€äJHX›]ôPX›[€àHX›[€ú÷ÃN¬à€€ú›\]Z\YH\]Z\Y[ù€›÷›€€N¬à€€ú›YàH””“USW—Qî÷Ÿ\]Z\YN¬à€€ú›ò[òX⁄“X€€àH»⁄›ô[â¯¶„˚Ó#…ÀŸNâ¸'Í§…À^Nâ¸'Í§…ÀX⁄Œâ¯¶„˚Ó#…À\ú€€éâ¸'„®…ÀŸX\€éâ¸'ÂË{Ó#…Àò[ôŸYâ¸'„ÓIÀXX⁄]Nâ¸'ÂË{Ó#…»V›€€H	¸'Â)…Œ¬à€€ú›Xô[HYèÀõXô[»⁄›ô[â‘⁄›ô[	ÀŸNâ“ŸIÀ^Nâ–^IÀX⁄Œâ‘X⁄…À\ú€€éâ“\ú€€âÀŸX\€éâ’ŸX\€âÀò[ôŸYâ‘ò[ôŸYŸX\€âÀXX⁄]Nâ’ŸX\€â»V›€€H€€¬à€€ùíX€€ãö[õô\íSH€€Ÿ[X›X€€íS
Yãò[òX⁄“X€€ã	ÃéY[I N¬à€€ùìXô[ù^€€ù[ùHXô[¬àÀ»›ÿ\ö\⁄XõH€€Y\⁄àÿöôX›ùò[Y\ €€Y\⁄X\
Kôõ‹ëXX⁄
HOà»Yà
JH€€€\ãúô[[›ôJJN»JN¬àYà
€€Y\⁄X\›€€JH€€€\ãòY
€€Y\⁄X\›€€JN¬àôYúô\⁄X›[€êò\ä
N¬àôYúô\⁄ŸX\€î›⁄]⁄ùä
N¬àÀ»‹Àú⁄[[ùàYò][ô»H€€[\›Ÿ\‹⁄[€à
ŸYBàÀ»‹]€î^Y\ê]ò]\äH⁄›[â›‹HñŸ[X›Yàÿ\›€àŸ⁄[ãÇàYà
[‹Àú⁄[[ù
H¬à€€ú›\Ÿ»H	€Xô[HŸ[X›Yò¬à\›X›[€ìY\‹ÿYŸHH\ŸŒ¬à⁄›’ÿ\›
\ŸÀùYJN¬àBàÿ]ôQ\]Z\Y[ù€› 
N¬àBÇàÀ»ŸX\€à]ZX⁄À\›⁄]⁄X€€à[ÿ^\»⁄›‹»⁄]]ô\â‹»X›X[H\]Z\Y[ÇàÀ»HŸX\€à€›
õ›ôXŸ\‹ÿ\ö[HHX›]ôH€€
H8†%]»òX›]ôH€\‹¬àÀ»
ŸŸ€Y]ô\ûHúò[YH[à\]S[›ô[Y[ù
H\»⁄]⁄›‹»H›\úô[ùàÀ»[ã€›]›]KÇàù[ò›[€àôYúô\⁄ŸX\€î›⁄]⁄ùä
H¬àYà
XùïŸX\€î›⁄]⁄X€€äHô]\õé¬à€€ú›⁄›‘ò[ôŸYHX›]ôU€€OOH	‹ò[ôŸY	Œ¬à€€ú›YàH””“USW—Qî÷‹⁄›‘ò[ôŸY»\]Z\Y[ù€›Àúò[ôŸYà\]Z\Y[ù€›ÀùŸX\€óN¬àùïŸX\€î›⁄]⁄X€€ãö[õô\íSH€€Ÿ[X›X€€íS
Yã⁄›‘ò[ôŸY»	¸'„ÓI»à	¸'ÂË{Ó#…À	ÃéY[I N¬àùïŸX\€î›⁄]⁄ÀúŸ]]öXù]J	ÿ\öXK[Xô[	À⁄›‘ò[ôŸY»	‘›⁄]⁄»ò[ôŸYŸX\€â»à	‘›⁄]⁄»Y[YHŸX\€â N¬àBÇàÀ»€ôH€€Xò]ŸŸ€NàY[Yx°•ò[ôŸYàúõ€HHò\õZ[ô»€€‹à[][HBàÀ»ö\ú›ô\‹»[ù\ú»Y[YKô\Ÿ\ùö[ô»H^\›[ô»ö[ô[ôÀÇàù[ò›[€àŸŸ€T]ZX⁄’ŸX\€î›⁄]⁄

H¬à[[ŸHH	›€€	Œ¬àYà
X›]ôU€€OOH	›ŸX\€â HŸ]X›]ôU€€
	‹ò[ôŸY	 N¬à[ŸHYà
X›]ôU€€OOH	‹ò[ôŸY	 HŸ]X›]ôU€€
	›ŸX\€â N¬à[ŸHŸ]X›]ôU€€
	›ŸX\€â N¬àBÇàÀ»€›\ú»Hö\⁄XõH€€›ŸX\€à‹àòY»][H⁄]›][ò\‹⁄Y€ö[ô»[ûBàÀ»ŸX\à€›ÀàHô[Y[Xô\ôYX›]ôU€€ÿX›]ôR][R[ô^\ôHô\›‹ôYûBàÀ»Hô^€€][K‹àŸX\€àŸ[X›[€ãÇàù[ò›[€à]]ÿ^R[\]Z\Y[ù

H¬àYà
[[ŸHOOH	€õ€ôI Hô]\õé¬à[[ŸHH	€õ€ôIŒ¬àX›]ôPX›[€àH	€õ€ôIŒ¬àX›[€í[›€àHò[ŸN¬à⁄[ô›Àê€€Xò]Àö[ú]Àòÿ[òŸ[ô\‹œÀäJN¬à⁄[ô›Àê€€Xò]Àö[ú]Àòÿ[òŸ[ô\‹œÀääN¬à⁄[ô›Àê€€Xò]Àòÿ[òŸ[[›YŸYÀä
N¬à⁄[ô›Àîò[ôŸYŸX\€úœÀòÿ[òŸ[^Y\êX›[€èÀä
N¬àÿ[òŸ[^Y\ï€€[ö[X][€ëõ‹í[ù\òX›[€ä
N¬à€€€\ãùö\⁄XõHHò[ŸN¬à[][R€\ãùö\⁄XõHHò[ŸN¬à⁄[ô›ÀóŸ\⁄›‹Ÿ[X›[€ê\òœÀò€‹ŸOÀä
N¬àôYúô\⁄X›[€êò\ä
N¬àôYúô\⁄ŸX\€î›⁄]⁄ùä
N¬à⁄›’ÿ\›
	‘]]ÿ^H[\]Z\Y[ùâÀùYJN¬àBÇàù[ò›[€àŸ]X›]ôPX›[€äX›[€äH¬àX›]ôPX›[€àHX›[€é¬àôYúô\⁄X›[€êò\ä
N¬à\ŸPX›]ôPX›[€ä
N¬àBÇàÀ»õ›€€Xò]€›»\ôH[Xô\ò][H^€YY8†%HYXÿ]Y€€Xò]àÀ»ŸŸ€H›ÿ\»ŸX\€∏°•ò[ôŸY⁄]›]][ô»Z]\à[àHò\õK]€€ﬁX€KÇà€€ú›“QS‘”’»H…‹⁄›ô[	À	⁄ŸIÀ	ÿ^IÀ	‹X⁄…À	⁄\ú€€â◊N¬ÇàÀ»8• 8• ›]\à\ò⁄8†%€€	à][H\òÀYX[8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• à¬à€€ú›⁄][PùàHÿ›[Y[ùôŸ][[Y[ùûRY
	⁄][Pùâ N¬à€€ú›Tê◊‘»HMÕKTê◊—HHMN¬à€€ú›[ÿö[P€€ùõ€»H⁄[ô›Àî–‘êU“ì”ëT◊–””ëíQœÀôÿ[YOÀõ[ÿö[P€€ùõ€»ﬂN¬à€€ú›€€ôöY›\ôYÿYôSX\ô⁄[îHù[Xô\ä[ÿö[P€€ùõ€ÀúÿYôSX\ô⁄[î
N¬à€€ú›–QëW”HHù[Xô\ãö\—ö[ö]J€€ôöY›\ôYÿYôSX\ô⁄[î
H»€€ôöY›\ôYÿYôSX\ô⁄[îà¬à€€ú›X›[€ê\ò⁄òY]\–€[\H[ÿö[P€€ùõ€ÀòX›[€ê\ò⁄ÀúòY]\–€[\ﬂN¬à€€ú››]\ê\ò⁄òY]\–€[\H[ÿö[P€€ùõ€Àõ›]\ê\ò⁄ÀúòY]\–€[\ﬂN¬Çàù[ò›[€àÿ€[\YõZ[ä»Z[îõZ[ãX^JH¬à€€ú›öY]‹‹ùZ[àHX]õZ[ä⁄[ô›Àö[õô\ï⁄Y⁄[ô›Àö[õô\íZY⁄
N¬à€€ú›€€ôöY›\ôYõZ[àHù[Xô\äõZ[äN¬à€€ú›ôYô\úôYHöY]‹‹ùZ[à
à
ù[Xô\ãö\—ö[ö]J€€ôöY›\ôYõZ[äH»€€ôöY›\ôYõZ[àà
H»L¬à€€ú››Ÿ\îHù[Xô\äZ[î
N¬à€€ú›\\îHù[Xô\äX^
N¬àYà
V‹ôYô\úôY›Ÿ\î\\îKô]ô\ûJù[Xô\ãö\—ö[ö]JJHô]\õà¬àô]\õàX]õZ[ä\\îX]õX^
›Ÿ\îôYô\úôY
JN¬àBÇàù[ò›[€à€›]\îä
H¬à€€ú›€€H\úŸQõÿ]
Ÿ]€€\]Y›[Jÿ›[Y[ùôÿ›[Y[ù[[Y[ù
KôŸ]õ‹\ùUò[YJ	ÀKX€€	 JN¬àô]\õàù[Xô\ãö\—ö[ö]J€€
H	âà€€à»€€
àLàÿ€[\YõZ[ä›]\ê\ò⁄òY]\–€[\
N¬àBàù[ò›[€à⁄[õô\îä
H¬à€€ú›€€H\úŸQõÿ]
Ÿ]€€\]Y›[Jÿ›[Y[ùôÿ›[Y[ù[[Y[ù
KôŸ]õ‹\ùUò[YJ	ÀKX€€	 JN¬àô]\õàù[Xô\ãö\—ö[ö]J€€
H	âà€€à»€€
àÀçààÿ€[\YõZ[äX›[€ê\ò⁄òY]\–€[\
N¬àBàù[ò›[€àÿ\ò‘
YÀòY]\»H€›]\îä
JH¬à€€ú›àHòY]\ÀHHY»
àX]îH»N¬àô]\õà»à⁄[ô›Àö[õô\ï⁄Y
»X]ò€‹ JH
ààH–QëW”KàNà⁄[ô›Àö[õô\íZY⁄HX]ú⁄[äJH
ààH–QëW”HN¬àBàù[ò›[€àÿ€‹õô\ê[ô JH¬àô]\õàX]ò][åäJHH⁄[ô›Àö[õô\íZY⁄
KH⁄[ô›Àö[õô\ï⁄Y
H
àN»X]îN¬àBÇà]ÿ\ò—[»H◊Kÿ\ò–ôHù[ÿ\ò”‹[àHù[ÿ\ò‘€›»H◊Kÿ\ò–X›]ôHHLN¬à]⁄[[ùûTŸ[X›‹í⁄[ôHù[»À»⁄\ôYûHŸ^Xõÿ\ôÿ€€ùõ€\ã‹⁄[ù\àY\\ú»€»⁄Y[[ú]€õ›‹»⁄X⁄[Ÿ[X›‹à›€ú»]Çà]ŸòY[ô—[»H◊N¬Çàù[ò›[€àÿ€X\ê\ò ŸY\òX⁄Ÿõ‹Hò[ŸJH¬àYà
ÿ\ò–ô	âàZŸY\òX⁄Ÿõ‹
H»ÿ\ò–ôúô[[›ôJ
N»ÿ\ò–ôHù[»Bàÿ\ò—[Àôõ‹ëXX⁄
HOàKúô[[›ôJ
JN»ÿ\ò—[»H◊N¬àŸòY[ô—[Àôõ‹ëXX⁄
HOàKúô[[›ôJ
JN»ŸòY[ô—[»H◊N¬àÿ\ò‘€›»H◊N»ÿ\ò–X›]ôHHLN»ÿ\ò”‹[àHù[¬à€€ùãú›[Kùö\⁄Xö[]HH	…Œ¬àYà
⁄][PùäH⁄][Pùãú›[Kùö\⁄Xö[]HH	…Œ¬àBÇàù[ò›[€à€Z‘€›
YÀX€€ãXô[^òKòY]\»H€›]\îä
JH¬à€€ú›Hÿ\ò‘
YÀòY]\ N¬à€€ú›[Hÿ›[Y[ùò‹ôX]Q[[Y[ù
	Ÿ]â N¬à[ò€\‹”ò[YHH	ÿ\òÀ\€›	»
»
^òH»	»	»
»^òHà	… N¬à[ú›[Kò‹‹’^H‹⁄][€éôö^Y€Yùâ‹û\›‹â‹û_\ﬁãZ[ô^ååN‹⁄[ù\ãY]ô[ùŒõõ€ôNÿ¬à[ö[õô\íSH‹[à€\‹œHò\òÀZX€€àèâ⁄X€€üO‹‹[èòà
»
Xô[»‹[à€\‹œHò\òÀ[Xô[èâ€Xô[O‹‹[èòà	… N¬àÿ›[Y[ùòõŸKò\[ô⁄[
[
N¬àÿ\ò—[Àú\⁄
[
N¬àô]\õà[¬àBÇàù[ò›[€à‹Ÿ]X›]ôJY
H¬àYà
ÿ\ò–X›]ôHOOHY
Hô]\õé¬àYà
ÿ\ò‘€›÷◊ÿ\ò–X›]ôWJHÿ\ò‘€›÷◊ÿ\ò–X›]ôWKô[ò€\‹”\›úô[[›ôJ	ÿ\òÀXX›]ôI N¬àÿ\ò–X›]ôHHY¬àYà
ÿ\ò‘€›÷⁄YJHÿ\ò‘€›÷⁄YKô[ò€\‹”\›òY
	ÿ\òÀXX›]ôI N¬àBÇàù[ò›[€à€‹[ï€€\ò 
H¬àÿ€X\ê\ò 
N»ÿ\ò”‹[àH	›€€	Œ¬àYà
⁄][PùäH⁄][Pùãú›[Kùö\⁄Xö[]HH	⁄Y[âŒ¬àÿ\ò–ôHÿ›[Y[ùò‹ôX]Q[[Y[ù
	Ÿ]â N¬àÿ\ò–ôò€\‹”ò[YHH	ÿ\òÀXòX⁄Ÿõ‹	Œ¬àÿ›[Y[ùòõŸKò\[ô⁄[
ÿ\ò–ô
N¬à€€ú›àH“QS‘”’Àõ[ô››\H
Tê◊‘»HTê◊—JH»
àHJN¬à“QS‘”’Àôõ‹ëXX⁄

€›JHOà¬à€€ú›Y»HTê◊‘»HH
à›\¬à€€ú›\HH\]Z\Y[ù€›÷‹€›KYàH\H»””“USW—Qî÷Ÿ\WHàù[¬à€€ú›ò[òX⁄“X€€àH‹⁄›ô[â¯¶„˚Ó#…ÀŸNâ¸'Í§…ÀŸX\€éâ¸'ÂË{Ó#…À^Nâ¸'Í§…ÀX⁄Œâ¯¶„˚Ó#…À\ú€€éâ¸'„®…ﬂV‹€›H	¸'Â)…Œ¬à€€ú›X€€àH€€Ÿ[X›X€€íS
Yãò[òX⁄“X€€ã	ÃKç[I N¬à€€ú›Xô[H‹⁄›ô[â‘⁄›ô[	ÀŸNâ“ŸIÀŸX\€éâ’ŸX\€âÀ^Nâ–^IÀX⁄Œâ‘X⁄…À\ú€€éâ“\ú€€âﬂV‹€›H€›¬à€€ú›[H€Z‘€›
YÀX€€ãXô[X›]ôU€€OOH€›»	ÿ\òÀXX›]ôI»à	… N¬àÿ\ò‘€›Àú\⁄
»[ô€NàYÀ[]Nà€›JN¬àYà
X›]ôU€€OOH€›
Hÿ\ò–X›]ôHHN¬àJN¬àBÇàù[ò›[€à€‹[ê[[[–\ò 
H¬à€€ú›⁄⁄XŸ\»H⁄[ô›Àîò[ôŸYŸX\€úœÀò[[[–⁄⁄XŸ\œÀä\]Z\Y[ù€›Àúò[ôŸY
H◊N¬à€€ú›X›]ôP[[[»H⁄[ô›Àîò[ôŸYŸX\€úœÀòX›]ôP[[[“YÀä\]Z\Y[ù€›Àúò[ôŸY
H	ÿò\⁄X…Œ¬à€‹[ë[ùöY\ 	ÿ[[[…À⁄⁄XŸ\ÀõX\
⁄⁄XŸHOà
¬àYà⁄⁄XŸKöYX€€éà⁄⁄XŸKöX€€ãXô[à⁄⁄XŸKò]òZ[XõH»⁄⁄XŸKõXô[à	ÿ⁄⁄XŸKõXô[H0≠»Œà\ÿXõYàX⁄⁄XŸKò]òZ[XõKX›]ôNà⁄⁄XŸKöYOOHX›]ôP[[[Àà€îŸ[X›à

HOà⁄[ô›Àîò[ôŸYŸX\€úœÀúŸ]X›]ôP[[[œÀä\]Z\Y[ù€›Àúò[ôŸY⁄⁄XŸKöY
KàJJJN»À»‹X⁄X[[[[»\Ÿ\»Hÿ[YH‹ô[ò\ûK\òY]\»\ò⁄ö[Z]]ôKÇàBÇàÀ»][]Y\»⁄Y[8†%‹[ôYûH€[ô»	ÿ…»
ŸYH\⁄›‹€Ÿ^\À¬àÀ»‹[ë\⁄›‹€\ò»ô[› Kõ‹à]ZX⁄»X›[€ú»]€â›ô[€ô»€ÇàÀ»H\ã][HX›[€àò\éàÿ\ú[ô»òX⁄»»HXŸY⁄[\õô\‹¬àÀ»ÿ[\ö\ôH‹àHò\õK]ZX⁄À\Ÿ[X›[ô»Hÿ[\ö\ôH⁄]⁄]›]àÀ»ÿ‹õ€[ô»H][H⁄Y[‹à‹òö][ô»\õ›[ôH›][€ò\ûH^Y\ãÇàù[ò›[€à€‹[ï][]Y\–\ò 
H¬àÀ»HXŸYÿ[\ö\ôHõ›»\ú⁄\›»[ôYö[ö][K[ò€Y[ô»›]⁄YBàÀ»]»›€àõ€ôH
ŸYH⁄[\õô\‹ÀXÿ[\ö\ôKöú…‹»XY\à€€[Y[ù
H8†%àÀ»Ÿ\öX[^ôJ
H\»HôŸ\»€ôH^\›[ô⁄\ôHà]Y\ûHõ‹à]¬àÀ»\“\ôJ
H€õH]ô\à[ú›Ÿ\ú»ö\»][àH’TîëSïõ€ôHã⁄X⁄àÀ»\ŸY»ôHHÿ[YH]Y\›[€àòX⁄»⁄[àX]ö[ô»\›õﬁYY]Çà€€ú›ÿ[\ö\ôHH⁄[ô›Àï⁄[\õô\‹–ÿ[\ö\ôOÀúŸ\öX[^ôOÀä
N¬à€€ú›⁄]€›[ùH[ùô[ù‹ûKòÿ[\ö\ôR⁄]ù\õö]\ôH¬à€‹[ë[ùöY\ 	›][]Y\…À¬à¬àYà	ÿ⁄\òX›\ã]öY]…ÀX€€éà	¸'‰`{Ó#…ÀXô[à⁄\òX›\ïöY]”[ŸKô[òXõY»	–⁄\òX›\àöY]Œà€â»à	–⁄\òX›\àöY]ŒàŸôâÀàX›]ôNà⁄\òX›\ïöY]”[ŸKô[òXõYà€îŸ[X›à

HOàŸ]⁄\òX›\ïöY]”[ŸJX⁄\òX›\ïöY]”[ŸKô[òXõY
KàKà¬àYà	‹ô]\õãXÿ[\	ÀX€€éà	¸'„Â{Ó#…ÀXô[àÿ[\ö\ôH»	‘ô]\õà»ÿ[\	»à	”õ»ÿ[\Ÿ]\	Àà\ÿXõYàXÿ[\ö\ôKà€îŸ[X›à

HOà¬àYà
Xÿ[\ö\ôJHô]\õé¬àYà
ÿ[\ö\ôKõX\YOOH›\úô[ù\ôXJH¬àÀ»[ôXYH[àHöY⁄õ€ôH8†%ù\›ô\‹⁄][€à€ù»H[KÇà€€ú›ô\›[H⁄[ô›Àï⁄[\õô\‹–ÿ[\ö\ôKúô]\õï–ÿ[\ö\ôJ
N¬à⁄›’ÿ\›
ô\›[õY\‹ÿYŸKô\›[õ⁄ N¬àôYúô\⁄X›[€êò\ä
N¬àH[ŸH¬àÀ»HYôô\ô[ùõ€ôH
‹àHò\õK››€ãÿHùZ[[ô H8†%ò]ô[àÀ»\ôHö\ú›[ô[ô»^X›H€àHÿ[\ö\ôI‹»›€à[BàÀ»⁄[òŸH]»ÿ]ôYﬁà\ôH\‹ŸY›òZY⁄õ›Y⁄\»BàÀ»[ùûH€€‹õ›»
ÿ[YHö\ôKX[ôYõ‹ôŸ]\ﬁ[òÀZ[ú⁄YKBàÀ»›\ùÿŸ[ôUò[ú⁄][€à]\õà\ôõ‹õUò]ô[	‹»›€à	ﬁõ€ôI¬àÀ»ÿ\ŸH\Ÿ\»õ‹à[à‹ô[ò\ûH]]‹ôYõ€ôHò[ú⁄][€äKÇà›\ùÿŸ[ôUò[ú⁄][€ä

HOà[ù\ñõ€ôJÿ[\ö\ôKõX\YX]ôõ€‹äÿ[\ö\ôKû
KX]ôõ€‹äÿ[\ö\ôKûäJJN¬àBàKàKà¬àYà	‹Ÿ[X›Z⁄]	ÀX€€éà	¸'Â)IÀXô[à⁄]€›[ùà»ÿ[\ö\ôH⁄]0Â…⁄⁄]€›[ùXà	”õ»ÿ[\ö\ôH⁄]	Àà\ÿXõYà⁄]€›[ùHà€îŸ[X›à

HOà‹Ÿ[X›[[ùô[ù‹ûRŸ^J	ÿÿ[\ö\ôR⁄]ù\õö]\ôI KàKà¬àYà	‹ô]\õãYò\õIÀX€€éà	¸'„ËIÀXô[à›\úô[ù\ôXHOOH	Ÿò\õI»»	–[ôXYH€àò\õI»à	‘ô]\õà»ò\õIÀà\ÿXõYà›\úô[ù\ôXHOOH	Ÿò\õIÀà€îŸ[X›à

HOà›\ùÿŸ[ôUò[ú⁄][€ä

HOà\ôõ‹õUò]ô[
»\ôŸ]à	Ÿò\õIÀ\ôŸ]€€àMÀ\ôŸ]õ›ŒàJJKàKàJN¬àBÇàù[ò›[€à€‹[ë[ùöY\ [ŸK[ùöY\ÀòY]\»H€›]\îä
JH¬à€€ú›ŸY\òX⁄Ÿõ‹Hõ€€X[äÿ\ò–ô	âàÿ\ò”‹[èÀú›\ù’⁄]
	Ÿ[ùöY\Œâ JN»À»ŸY\»€ôH€€ù[ù[›\»òY»[]ôH⁄[H›[€àúò[ò⁄\»[ôõ€Çàÿ€X\ê\ò ŸY\òX⁄Ÿõ‹
N»ÿ\ò”‹[àH[ùöY\Œâ€[Ÿ_X¬àYà
⁄][PùäH⁄][Pùãú›[Kùö\⁄Xö[]HH	⁄Y[âŒ¬à€€ùãú›[Kùö\⁄Xö[]HH	⁄Y[âŒ¬àYà
Wÿ\ò–ô
H¬àÿ\ò–ôHÿ›[Y[ùò‹ôX]Q[[Y[ù
	Ÿ]â N¬àÿ\ò–ôò€\‹”ò[YHH	ÿ\òÀXòX⁄Ÿõ‹	Œ¬à]⁄[ù\íYHù[»À»€ôH⁄[ù\à›€ú»Ÿ[ô\ò[[ùûKX\ò⁄ò]öYÿ][€à[ù[€€[Z]ÿÿ[òŸ[Çàÿ\ò–ôòY]ô[ù\›[ô\ä	‹⁄[ù\ô›€âÀ]ô[ùOà¬à⁄[ù\íYH]ô[ùú⁄[ù\íY¬àûH»ÿ\ò–ôúŸ]⁄[ù\êÿ\\ôJ⁄[ù\íY
N»Hÿ]⁄
\úõ‹äH» à⁄[ù\àÿ\\ôH\»[à‹[€ò[[ö[òŸ[Y[ùà
ã»Bàÿ\ò”[›ôJ]ô[ùò€Y[ù]ô[ùò€Y[ùJN¬à]ô[ùúô]ô[ùYò][

N¬àJN¬àÿ\ò–ôòY]ô[ù\›[ô\ä	‹⁄[ù\õ[›ôIÀ]ô[ùOà»Yà
]ô[ùú⁄[ù\íYOOH⁄[ù\íY
Hÿ\ò”[›ôJ]ô[ùò€Y[ù]ô[ùò€Y[ùJN»JN¬àÿ\ò–ôòY]ô[ù\›[ô\ä	‹⁄[ù\ù\	À]ô[ùOà»Yà
]ô[ùú⁄[ù\íYOOH⁄[ù\íY
H»⁄[ù\íYHù[»ÿ\ò’\

N»HJN¬àÿ\ò–ôòY]ô[ù\›[ô\ä	‹⁄[ù\òÿ[òŸ[	À]ô[ùOà»Yà
]ô[ùú⁄[ù\íYOOH⁄[ù\íY
H»⁄[ù\íYHù[»ÿ€X\ê\ò 
N»HJN¬àÿ›[Y[ùòõŸKò\[ô⁄[
ÿ\ò–ô
N¬àBà€€ú›àH[ùöY\Àõ[ô››\HààH»
Tê◊‘»HTê◊—JH»
àHJHà¬à[ùöY\Àôõ‹ëXX⁄

[ùûK[ô^
HOà¬à€€ú›Y»HTê◊‘»H[ô^
à›\¬à€€ú›^òHHŸ[ùûKòX›]ôH»	ÿ\òÀXX›]ôI»à	…À[ùûKô\ÿXõY»	ÿõÿ⁄ŸY	»à	…À[ùûKò€\‹”ò[YH	…◊Kôö[\äõ€€X[äKöõ⁄[ä	»	 N¬à€€ú›[H€Z‘€›
YÀ[ùûKöX€€ã[ùûKõXô[^òKòY]\ N¬àÿ\ò‘€›Àú\⁄
»[ô€NàYÀ[]Nà»ããô[ùûK\Nà	Ÿ[ùûI»HJN¬àYà
[ùûKòX›]ôJHÿ\ò–X›]ôHH[ô^¬àJN¬àYà
ÿ\ò–X›]ôH	âà[ùöY\Àõ[ô›
H‹Ÿ]X›]ôJX]ôõ€‹ä
[ùöY\Àõ[ô›HJH»äJN¬àBÇàù[ò›[€à‹Ÿ[X›[[ùô[ù‹ûRŸ^J][RŸ^JH¬à€€ú›[ô^HŸ][ùô[ù‹ûT›X⁄“][\ 
Kôö[ô[ô^
][HOà][KöŸ^HOOH][RŸ^JN¬àYà
[ô^
Hô]\õé¬àX›]ôR][R[ô^H[ô^¬à[[ŸHH	⁄][IŒ¬àôYúô\⁄][Tÿ‹õ€

N»ôYúô\⁄X›[€êò\ä
N¬àBÇà€€ú›’TëW—êSRSW“P””î»H»[XYŸNà	¸'Ín	À€€ùõ€à	¸'„ 	ÀŸôô[ú⁄]ôQXùYôéà	¯¶•;Ó#…ÀYô[ú⁄]ôQXùYôéà	¸'ÊË{Ó#…»N»À»õ›\ãYò[Z[HŸ[X›‹àõÿÿXù[\ûKÇàù[ò›[€àÿ›\ôP€›ô\òYŸRX€€ä€›ô\òYŸK\ôŸ[ùHùYJH¬àô]\õà‹[à€\‹œHò›\ôKYò[Z[KY‹öYèâ›⁄[ô›Àê[⁄[^Tﬁ\›[KëêSRSW”‘ëTãõX\
ò[Z[HOà¬à€€ú››]HH€›ô\òYŸVŸò[Z[WHﬂN¬à€€ú›Ÿ]ô\ö]HH›]KòX›]ôP[[›[ùèHH»	»Ÿ]ô\ôI»à›]KòX›]ôP[[›[ùà»	»X›]ôI»à	…Œ¬à€€ú›Z\‹⁄[ô»H›]Kõ›€ôY»	…»àà€\‹œHò›\ôKYò[Z[K^	‹›]Kù\ôŸ[ùZ\‹⁄[ô»	âà\ôŸ[ù»	»\ôŸ[ù	»à	…ﬂHè∞Âœÿèò¬àô]\õà‹[à€\‹œHò›\ôKYò[Z[I‹Ÿ]ô\ö]_Hà]KYò[Z[OHâŸò[Z[_Hèâ–’TëW—êSRSW“P””î÷Ÿò[Z[W_I€Z\‹⁄[ôﬂO‹‹[èò¬àJKöõ⁄[ä	… _O‹‹[èò¬àBÇàù[ò›[€à€‹[î›[€îõ€›

H¬à€‹[ë[ùöY\ 	‹›[€ã\õ€›	À¬à»Yâ€YYX⁄[ôIÀX€€éâ¯ß&âÀXô[â”YYX⁄[ôIÀ€\‹”ò[YNâ‹›[€ãXúò[ò⁄YYX⁄[ôIÀ€îŸ[X›ä
HOà€‹[î›[€êúò[ò⁄
	€YYX⁄[ôI HKà»Yâ›][]IÀX€€éâ¯¶•˚Ó#…ÀXô[â’][]IÀ€\‹”ò[YNâ‹›[€ãXúò[ò⁄][]IÀ€îŸ[X›ä
HOà€‹[î›[€êúò[ò⁄
	›][]I HKàK€›]\îä
JN¬àBÇàù[ò›[€à€‹[î›[€êúò[ò⁄
úò[ò⁄
H¬à€€ú››]HH⁄[ô›Àê[⁄[^Tﬁ\›[OÀú›[€êÿ]Y€‹ûT›]OÀä^Y\äHﬂN¬à€€ú›X[[ô»H›]KöX[[ô»ﬂK›\ô\»H›]Kò›\ô\»ﬂKùYôú»H›]KòùYôú»ﬂKõ\⁄‹»H›]Kôõ\⁄‹»ﬂN¬à€€ú›\ôŸ[ùH›]Kö[ê€€Xò]OOHò[ŸN»À»›]⁄YH€€Xò][ò]òZ[XõHX\ö‹»›^H]]YÇà€€ú›X[[ô–€\‹»H›[€ãXÿ]Y€‹ûI⁄X[[ôÀõôYYY»	…»à	»]]Y	ﬂI⁄X[[ôÀù\ôŸ[ùZ\‹⁄[ô»»[ò]òZ[XõI›\ôŸ[ù»	»\ôŸ[ù	»à	…ﬂXà	…ﬂX¬à€€ú››\ô\’\ŸYù[H
›\ô\Àù\ŸYù[][\»◊JKõ[ô›à¬à€€ú›ùYôú’\ŸYù[H
ùYôúÀù\ŸYù[][\»◊JKõ[ô›à¬à€€ú›[ùöY\»Húò[ò⁄OOH	€YYX⁄[ôI»»¬à»Yâ⁄X[[ô…ÀX€€éò<'‰¶â⁄X[[ôÀù\ôŸ[ùZ\‹⁄[ô»»	œà€\‹œHòÿ]Y€‹ûK^ôYè∞Âœÿèâ»à	…ﬂXXô[â“X[[ô…À€\‹”ò[YNöX[[ô–€\‹À\ÿXõYàJX[[ôÀõôYYY	âàX[[ôÀõ›€ôY
K€îŸ[X›ä
HOà€‹[î›[€í][\ 	⁄X[[ô… HKà»Yâ€YYX⁄[ôIÀX€€éâ¯ß&âÀXô[â”YYX⁄[ôIÀ€\‹”ò[YNâ‹›[€ãXúò[ò⁄YYX⁄[ôIÀ€îŸ[X›ó€‹[î›[€îõ€›Kà»Yâÿ›\ô\…ÀX€€éóÿ›\ôP€›ô\òYŸRX€€ä›\ô\Àò€›ô\òYŸHﬂK\ôŸ[ù
KXô[â–›\ô\…À€\‹”ò[YNò›[€ãXÿ]Y€‹ûIÿ›\ô\’\ŸYù[»	…»à	»]]Y	ﬂX\ÿXõYàX›\ô\’\ŸYù[€îŸ[X›ä
HOà€‹[î›[€í][\ 	ÿ›\ô\… HKàHà¬à»YâÿùYôú…ÀX€€éò8ß*	ÿùYôúÀõ›€ôY»	…»à	œà€\‹œHòÿ]Y€‹ûK^⁄]Hè∞ÂœÿèâﬂXXô[â–ùYôú…À€\‹”ò[YNò›[€ãXÿ]Y€‹ûIÿùYôú’\ŸYù[»	…»à	»]]Y	ﬂX\ÿXõYàXùYôú’\ŸYù[€îŸ[X›ä
HOà€‹[î›[€í][\ 	ÿùYôú… HKà»Yâ›][]IÀX€€éâ¯¶•˚Ó#…ÀXô[â’][]IÀ€\‹”ò[YNâ‹›[€ãXúò[ò⁄][]IÀ€îŸ[X›ó€‹[î›[€îõ€›Kà»YâŸõ\⁄‹…ÀX€€éò<'ÍÊIŸõ\⁄‹Àõ›€ôY»	…»à	œà€\‹œHòÿ]Y€‹ûK^⁄]Hè∞ÂœÿèâﬂXXô[â—õ\⁄‹…À€\‹”ò[YNò›[€ãXÿ]Y€‹ûIŸõ\⁄‹Àõ›€ôY»	…»à	»]]Y	ﬂX\ÿXõYàYõ\⁄‹Àõ›€ôY€îŸ[X›ä
HOà€‹[î›[€í][\ 	Ÿõ\⁄‹… HKàN¬à€‹[ë[ùöY\ ›[€ãIÿúò[ò⁄X[ùöY\À€›]\îä
JN¬àBÇàù[ò›[€à€‹[î›[€í][\ ÿ]Y€‹ûJH¬à€€ú››]HH⁄[ô›Àê[⁄[^Tﬁ\›[OÀú›[€êÿ]Y€‹ûT›]OÀä^Y\äHﬂN¬à€€ú›][\»Hÿ]Y€‹ûHOOH	⁄X[[ô…»»›]KöX[[ôœÀù\ŸYù[][\¬ààÿ]Y€‹ûHOOH	ÿ›\ô\…»»›]Kò›\ô\œÀù\ŸYù[][\¬ààÿ]Y€‹ûHOOH	ÿùYôú…»»›]KòùYôúœÀö][\»à›]Kôõ\⁄‹œÀö][\Œ¬à€€ú›][Q[ùöY\»H
][\»◊JKõX\
[ùûHOà¬à€€ú›Yö[ö][€àH[ùûKúôX⁄\H⁄[ô›Àê[⁄[^Tﬁ\›[KîëP“TW—Qî÷Ÿ[ùûKú^[ÿYúôX⁄\RYN¬à€€ú›X›]ôHHÿ]Y€‹ûHOOH	ÿùYôú…»	âà⁄[ô›Àê[⁄[^Tﬁ\›[KòX›]ôQYôôX›Àú€€YJYôôX›OàYôôX›úôX⁄\RYOOHYö[ö][€ãöY
N¬àô]\õà»Yô[ùûKö][RŸ^KX€€éôYö[ö][€ãöX€€ãXô[ò	ŸYö[ö][€ãõXô[H0Â…Ÿ[ùûKò€›[ùX€\‹”ò[YNòX›]ôO…‹ôY[ô[ù	Œâ…À\ÿXõYôò[ŸK€îŸ[X›ä
HOà‹Ÿ[X›[[ùô[ù‹ûRŸ^J[ùûKö][RŸ^JHN¬àJN¬à€€ú›ÿ[òŸ[[ùûHH»Yòÿ[òŸ[Iÿÿ]Y€‹û_XX€€éâ¯ß%IÀXô[â–ÿ[òŸ[	À€\‹”ò[YNâ‹›[€ãXÿ[òŸ[	ÀX›]ôNùùYK\ÿXõYôò[ŸK€îŸ[X›ä
HOàÿ€X\ê\ò 
HN»À»ÿÿ›\Y\»Hõÿ›\ŸYÿ]Y€‹ûI‹»õ‹õY\à[ô€H[ô€‹Ÿ\»€õH⁄[àH[Ÿ[X›‹à\»ô[X\ŸY€à]ÇàYà
ÿ]Y€‹ûHOOH	⁄X[[ô…»ÿ]Y€‹ûHOOH	ÿùYôú… H][Q[ùöY\Àù[ú⁄Yù
ÿ[òŸ[[ùûJN¬à[ŸH][Q[ùöY\Àú\⁄
ÿ[òŸ[[ùûJN¬à€‹[ë[ùöY\ ›[€ãZ][\ÀIÿÿ]Y€‹û_X][Q[ùöY\À€›]\îä
JN¬àBÇà]⁄Tÿ‹õ€H⁄Tÿ‹õ€Hù[⁄Tÿ‹õ€\àH¬à€€ú›USW’íT»HN¬Çàù[ò›[€àÿùZ[][T€› 
H¬à€€ú››X⁄‹»HŸ][ùô[ù‹ûT›X⁄“][\ 
K›[H›X⁄‹Àõ[ô›¬à€€ú›€›»H◊N¬àYà
⁄Tÿ‹õ€à
H€›Àú\⁄
»\Nâÿ\úõ›…À\éãLKX€€éâ¯•‡	ÀXô[â…»JN¬àõ‹à
]HH»HUSW’íT»	âà⁄Tÿ‹õ€
»H›[»J  Bà€›Àú\⁄
»\Nâ⁄][IÀ[ô^ó⁄Tÿ‹õ€
⁄KŸ^Nú›X⁄‹÷◊⁄Tÿ‹õ€
⁄WKöŸ^KX€€éú›X⁄‹÷◊⁄Tÿ‹õ€
⁄WKöX€€ãXô[ú›X⁄‹÷◊⁄Tÿ‹õ€
⁄WKõXô[JN¬àYà
⁄Tÿ‹õ€
»USW’íT»›[
H€›Àú\⁄
»\Nâÿ\úõ›…À\éåKX€€éâ¯•≠âÀXô[â…»JN¬à€€ú›€àH€›Àõ[ô››\H€ààH»
Tê◊‘»HTê◊—JH»
€àHJHà¬Çà€€ú›€ûRŸ^HHô]»X\
ÿ\ò‘€›ÀõX\
»Oà¬àÀô]Kù\HOOH	ÿ\úõ›…»»I‹Àô]Kô\üXàI‹Àô]Kö[ô^X¬àJJN¬à€€ú›Ÿ\Hô]»Ÿ]

Kô]‘€›»H◊N¬Çà€›Àôõ‹ëXX⁄

ÀJHOà¬à€€ú›Y»HTê◊‘»HH
à›\Hÿ\ò‘
Y N¬à€€ú›»HÀù\HOOH	ÿ\úõ›…»»I‹Àô\üXàI‹Àö[ô^X¬à€€ú›^òHHÀù\HOOH	ÿ\úõ›…»»	ÿ\òÀX\úõ›…»à
Àö[ô^OOHX›]ôR][R[ô^»	ÿ\òÀXX›]ôI»à	… N¬àYà
€ûRŸ^Kö\  JH¬à€€ú›€H€ûRŸ^KôŸ]
 N»Ÿ\òY
 N¬à€ô[ú›[KõYùHû
»	‹	Œ»€ô[ú›[Kù‹HûH
»	‹	Œ¬à€ô[ò€\‹”ò[YHH	ÿ\òÀ\€›	»
»
^òH»	»	»
»^òHà	… N¬àô]‘€›Àú\⁄
»[ô€NàYÀ[à€ô[]Nà»JN¬àH[ŸH¬à€€ú›[Hÿ›[Y[ùò‹ôX]Q[[Y[ù
	Ÿ]â N¬à[ò€\‹”ò[YHH	ÿ\òÀ\€›	»
»
^òH»	»	»
»^òHà	… N¬à[ú›[Kò‹‹’^H‹⁄][€éôö^Y€Yùâ‹û\›‹â‹û_\ﬁãZ[ô^ååN‹⁄[ù\ãY]ô[ùŒõõ€ôN€‹X⁄]Nåÿ¬à[ö[õô\íSH‹[à€\‹œHò\òÀZX€€àèâ‹ÀöX€€üO‹‹[èòà
»
ÀõXô[»‹[à€\‹œHò\òÀ[Xô[èâ‹ÀõXô[O‹‹[èòà	… N¬àÿ›[Y[ùòõŸKò\[ô⁄[
[
N¬àÿ\ò—[Àú\⁄
[
N¬àô\]Y\›[ö[X][€ëúò[YJ

HOà»[ú›[Kõ‹X⁄]HH	ÃIŒ»JN¬àô]‘€›Àú\⁄
»[ô€NàYÀ[]Nà»JN¬àBà€€ú›X€€ë[Hô]‘€›÷€ô]‘€›Àõ[ô›HWKô[ú]Y\ûTŸ[X›‹ä	Àò\òÀZX€€â N¬àYà
Àù\HOOH	⁄][I H¬à\R][T‹ö]RX€€äX€€ë[USW—Qî÷‹ÀöŸ^WKÀöŸ^JN¬àBà[ŸH€X\í][T‹ö]RX€€äX€€ë[
N¬àJN¬Çàÿ\ò‘€›Àôõ‹ëXX⁄
»Oà¬à€€ú›»HÀô]Kù\HOOH	ÿ\úõ›…»»I‹Àô]Kô\üXàI‹Àô]Kö[ô^X¬àYà
ZŸ\ö\  JH¬àÀô[ú›[Kõ‹X⁄]HH	Ã	Œ¬àÿ\ò—[»Hÿ\ò—[Àôö[\äHOàHOOHÀô[
N¬àŸòY[ô—[Àú\⁄
Àô[
N¬à€€ú›Ÿ[HÀô[¬àŸ][Y[›]


HOà»Ÿ[úô[[›ôJ
N»ŸòY[ô—[»HŸòY[ô—[Àôö[\äàOààOOHŸ[
N»KML
N¬àBàJN¬Çàÿ\ò‘€›»Hô]‘€›Œ¬àÿ\ò–X›]ôHHô]‘€›Àôö[ô[ô^
»OàÀô]Kù\HOOH	⁄][I»	âàÀô]Kö[ô^OOHX›]ôR][R[ô^
N¬àBÇàù[ò›[€à€‹[í][P\ò 
H¬àÿ€X\ê\ò 
N»ÿ\ò”‹[àH	⁄][IŒ¬à€€ùãú›[Kùö\⁄Xö[]HH	⁄Y[âŒ¬àÿ\ò–ôHÿ›[Y[ùò‹ôX]Q[[Y[ù
	Ÿ]â N¬àÿ\ò–ôò€\‹”ò[YHH	ÿ\òÀXòX⁄Ÿõ‹	Œ¬àÿ›[Y[ùòõŸKò\[ô⁄[
ÿ\ò–ô
N¬à⁄Tÿ‹õ€HX]õX^
X›]ôR][R[ô^HX]ôõ€‹äUSW’íT»»äJN¬à⁄Tÿ‹õ€\àH¬àÿùZ[][T€› 
N¬àBÇàù[ò›[€àÿ\ò”[›ôJJH¬àYà
Wÿ\ò”‹[àWÿ\ò‘€›Àõ[ô›
Hô]\õé¬à€€ú›[ô»HX]õX^
Tê◊—KX]õZ[äTê◊‘Àÿ€‹õô\ê[ô JJJN¬à]ô\›HôH[ôö[ö]N¬àÿ\ò‘€›Àôõ‹ëXX⁄

ÀJHOà»€€ú›HX]òXú Àò[ô€HH[ô N»Yà
ô
H»ôH»ô\›HN»HJN¬àYà
ÿ\ò”‹[àOOH	⁄][I H¬à€€ú›ô]—\àHÿ\ò‘€›÷ÿô\›OÀô]Kù\HOOH	ÿ\úõ›…»»ÿ\ò‘€›÷ÿô\›Kô]Kô\àà¬àYà
ô]—\àOOH⁄Tÿ‹õ€\äH¬à⁄Tÿ‹õ€\àHô]—\é¬àYà
⁄Tÿ‹õ€
H»€X\í[ù\ùò[
⁄Tÿ‹õ€
N»⁄Tÿ‹õ€Hù[»BàYà
ô]—\àOOH
H¬à⁄Tÿ‹õ€HŸ][ù\ùò[


HOà¬à⁄Tÿ‹õ€HX]õX^
X]õZ[äŸ][ùô[ù‹ûT›X⁄“][\ 
Kõ[ô›HUSW’íTÀ⁄Tÿ‹õ€
»⁄Tÿ‹õ€\äJN¬àÿùZ[][T€› 
N¬àKå
N¬àBàBàBà‹Ÿ]X›]ôJô\›
N¬àYà
ÿ\ò”‹[àOOH	Ÿ[ùöY\Œú›[€ã\õ€›	 H¬à€€ú›úò[ò⁄Hÿ\ò‘€›÷ÿô\›OÀô]KöY¬àYà
úò[ò⁄OOH	€YYX⁄[ôI»úò[ò⁄OOH	›][]I H¬à€‹[î›[€êúò[ò⁄
úò[ò⁄
N»À»òYŸ⁄[ô»›ÿ\ôH⁄YHõZYH[ôõ€»]Çàÿ\ò”[›ôJJN»À»ôKY]ò[X]HHÿ[YH€€ù[ù[›\»òY»YÿZ[ú›Hô]€H‹[]Yÿ]Y€‹ûH\ò⁄ÇàBàH[ŸHYà
ÿ\ò”‹[àOOH	Ÿ[ùöY\Œú›[€ã[YYX⁄[ôI»ÿ\ò”‹[àOOH	Ÿ[ùöY\Œú›[€ã]][]I H¬à€€ú›ÿ]Y€‹ûHHÿ\ò‘€›÷ÿô\›OÀô]N¬àYà
ÿ]Y€‹ûH	âàXÿ]Y€‹ûKô\ÿXõY	âà…⁄X[[ô…À	ÿ›\ô\…À	ÿùYôú…À	Ÿõ\⁄‹…◊Kö[ò€Y\ ÿ]Y€‹ûKöY
JH¬à€‹[î›[€í][\ ÿ]Y€‹ûKöY
N¬àÿ\ò”[›ôJJN»À»Hô\XŸ[Y[ùÿ[òŸ[ù]€àôX€€Y\»Ÿ[X›Y[[YYX][H[ô\àH[ö[ù\úù\YòYÀÇàBàBàBÇàù[ò›[€àÿ\ò’\

H¬àYà
⁄Tÿ‹õ€
H»€X\í[ù\ùò[
⁄Tÿ‹õ€
N»⁄Tÿ‹õ€Hù[»BàYà
Wÿ\ò”‹[äHô]\õé¬à€€ú›€›Hÿ\ò‘€›÷◊ÿ\ò–X›]ôWN¬àYà
ÿ\ò”‹[àOOH	›€€	»	âà€›
H¬à[[ŸHH	›€€	Œ»\›[ò\õU€€H€›ô]N¬àŸ]X›]ôU€€
€›ô]JN»À»ÿ[»ôYúô\⁄X›[€êò\à[ù\õò[BàH[ŸHYà
ÿ\ò”‹[àOOH	⁄][I»	âà€›Àô]Kù\HOOH	⁄][I H¬à[[ŸHH	⁄][IŒ¬àX›]ôR][R[ô^H€›ô]Kö[ô^¬àôYúô\⁄][Tÿ‹õ€

N»ôYúô\⁄X›[€êò\ä
N¬àH[ŸHYà
ÿ\ò”‹[èÀú›\ù’⁄]
	Ÿ[ùöY\Œâ H	âà€›	âà\€›ô]Kô\ÿXõY
H¬à€€ú›Ÿ[X›H€›ô]Kõ€îŸ[X›¬àYà
\[ŸàŸ[X›OOH	Ÿù[ò›[€â H¬à€€ú›ô]ö[›\”[ŸHHÿ\ò”‹[é»À»úò[ò⁄ÿ[òX⁄‹»ô\XŸHH›\úô[ù\ò⁄»][Hÿ[òX⁄‹»»õ›ÇàŸ[X›

N¬àYà
ÿ\ò”‹[àOOHô]ö[›\”[ŸJHô]\õé¬àBàBàÿ€X\ê\ò 
N¬àBÇà⁄[ô›ÀóŸ\⁄›‹Ÿ[X›[€ê\ò»H¬à‹[ï€€

H»Yà
ÿ\ò”‹[àOOH	›€€	 H€‹[ï€€\ò 
N»Kà‹[í][J
H»Yà
ÿ\ò”‹[àOOH	⁄][I H€‹[í][P\ò 
N»Kà‹[ê[[[ 
H»Yà
ÿ\ò”‹[àOOH	Ÿ[ùöY\Œò[[[… H€‹[ê[[[–\ò 
N»Kà‹[î›[€ú 
H»€‹[î›[€îõ€›

N»Kà‹[ï][]Y\ 
H»Yà
ÿ\ò”‹[àOOH	Ÿ[ùöY\Œù][]Y\… H€‹[ï][]Y\–\ò 
N»Kà‹[ë[ùöY\ [ŸK[ùöY\À‹[€ú»HﬂJH»€‹[ë[ùöY\ [ŸK[ùöY\À‹[€úÀúòY]\»€›]\îä
JN»KàôXÿ[\›€€

H¬à€€ú›ò[òX⁄»H“QS‘”’Àôö[ô
€›Oà\]Z\Y[ù€›÷‹€›JH“QS‘”’÷ÃN»À»[]Y⁄[ùò[Yô[Y[Xô\ôYôYô\ô[òŸ\»Y‹òYHÿYô[KÇà€€ú›ôXÿ[YH“QS‘”’Àö[ò€Y\ \›[ò\õU€€
H	âà\]Z\Y[ù€›÷€\›[ò\õU€€H»\›[ò\õU€€àò[òX⁄Œ¬à\›[ò\õU€€HôXÿ[Y¬à[[ŸHH	›€€	Œ¬àŸ]X›]ôU€€
ôXÿ[Y
N¬àô]\õàôXÿ[Y¬àKàÿ‹õ€€€
\äH¬àYà
ÿ\ò”‹[àOOH	›€€	 H€‹[ï€€\ò 
N¬à€€ú›YH“QS‘”’Àö[ô^ŸäX›]ôU€€
N¬à€€ú›ô^H
Y
»\à
»“QS‘”’Àõ[ô›
H	H“QS‘”’Àõ[ô›¬à[[ŸHH	›€€	Œ¬à\›[ò\õU€€H“QS‘”’÷€ô^N¬àŸ]X›]ôU€€
“QS‘”’÷€ô^JN¬àÿ\ò‘€›Àôõ‹ëXX⁄

ÀJHOà¬à€€ú›X›]ôHHÀô]HOOHX›]ôU€€¬àÀô[ò€\‹”\›ùŸŸ€J	ÿ\òÀXX›]ôIÀX›]ôJN¬àYà
X›]ôJHÿ\ò–X›]ôHHN¬àJN¬àKàÿ‹õ€][J\äH¬àYà
ÿ\ò”‹[àOOH	⁄][I H€‹[í][P\ò 
N¬à[[ŸHH	⁄][IŒ¬àﬁX€PX›]ôR[ùô[ù‹ûR][J\äN¬àôYúô\⁄][Tÿ‹õ€

N»ôYúô\⁄X›[€êò\ä
N¬à⁄Tÿ‹õ€HX]õX^
X]õZ[äŸ][ùô[ù‹ûT›X⁄“][\ 
Kõ[ô›HUSW’íTÀX›]ôR][R[ô^HX]ôõ€‹äUSW’íT»»äJJN¬àÿùZ[][T€› 
N¬àÿ\ò‘€›Àôõ‹ëXX⁄

ÀJHOà¬à€€ú›X›]ôHHÀô]Kù\HOOH	⁄][I»	âàÀô]Kö[ô^OOHX›]ôR][R[ô^¬àÀô[ò€\‹”\›ùŸŸ€J	ÿ\òÀXX›]ôIÀX›]ôJN¬àYà
X›]ôJHÿ\ò–X›]ôHHN¬àJN¬àKàÿ‹õ€[[[ \äH¬àYà
ÿ\ò”‹[àOOH	Ÿ[ùöY\Œò[[[… H€‹[ê[[[–\ò 
N¬à€€ú›]òZ[XõHHÿ\ò‘€›ÀõX\

€›[ô^
HOà
»€›[ô^JJKôö[\ä[ùûHOàY[ùûKú€›ô]Kô\ÿXõY
N¬àYà
X]òZ[XõKõ[ô›
Hô]\õàò[ŸN¬à]‹⁄][€àH]òZ[XõKôö[ô[ô^
[ùûHOà[ùûKö[ô^OOHÿ\ò–X›]ôJN¬à‹⁄][€àH
‹⁄][€à
»
\à»LHàJH
»]òZ[XõKõ[ô›
H	H]òZ[XõKõ[ô›¬à‹Ÿ]X›]ôJ]òZ[XõV‹‹⁄][€óKö[ô^
N»À»Y⁄Y⁄€õN»H[[ú]	‹»ô[X\ŸH€€[Z]»Ÿ]X›]ôP[[[ÀÇàô]\õàùYN¬àKàÿ‹õ€[ùöY\ \äH¬àYà
Wÿ\ò”‹[èÀú›\ù’⁄]
	Ÿ[ùöY\Œâ HWÿ\ò‘€›Àõ[ô›
Hô]\õàò[ŸN¬àYà
ÿ\ò”‹[àOOH	Ÿ[ùöY\Œú›[€ã\õ€›	 H¬à€‹[î›[€êúò[ò⁄
\à»	€YYX⁄[ôI»à	›][]I N»À»\ôX›[€à]Ÿ[à⁄€‹Ÿ\»Hö\ú›Y\ò\ò⁄Xÿ[úò[ò⁄Çàô]\õàùYN¬àBàYà
ÿ\ò”‹[àOOH	Ÿ[ùöY\Œú›[€ã[YYX⁄[ôI»ÿ\ò”‹[àOOH	Ÿ[ùöY\Œú›[€ã]][]I H¬à€€ú›ÿ]Y€‹ûRYHÿ\ò”‹[ãô[ô’⁄]
	€YYX⁄[ôI H»
\à»	⁄X[[ô…»à	ÿ›\ô\… Hà
\à»	ÿùYôú…»à	Ÿõ\⁄‹… N¬à€€ú›ÿ]Y€‹ûHHÿ\ò‘€›Àôö[ô
€›Oà€›ô]KöYOOHÿ]Y€‹ûRY
N¬àYà
ÿ]Y€‹ûH	âàXÿ]Y€‹ûKô]Kô\ÿXõY
H€‹[î›[€í][\ ÿ]Y€‹ûRY
N¬à[ŸHYà
ÿ]Y€‹ûJH‹Ÿ]X›]ôJÿ\ò‘€›Àö[ô^Ÿäÿ]Y€‹ûJJN¬àô]\õàùYN¬àBà€€ú›ô^[ô^Hÿ\ò–X›]ôH
»
\à»LHàJN¬àYà
ÿ\ò”‹[ãú›\ù’⁄]
	Ÿ[ùöY\Œú›[€ãZ][\ÀI JH¬à‹Ÿ]X›]ôJX]õX^
X]õZ[äÿ\ò‘€›Àõ[ô›HKô^[ô^
JJN»À»ö[ò[\›»›‹]ÿ[òŸ[[ú›XYŸà‹ò\[ô»\›]€àô\X]Y⁄Y[]ô[ùÀÇàH[ŸH¬à‹Ÿ]X›]ôJ
ô^[ô^
»ÿ\ò‘€›Àõ[ô›
H	Hÿ\ò‘€›Àõ[ô›
N¬àBàô]\õàùYN¬àKà[›ôT⁄[ù\äJH»ÿ\ò”[›ôJJN»Kà€€[Z]

H»ÿ\ò’\

N»Kàô[X\ŸTŸ[X›[€ä
H¬àYà
ÿ\ò”‹[èÀú›\ù’⁄]
	Ÿ[ùöY\Œú›[€ãI H	âàWÿ\ò”‹[ãú›\ù’⁄]
	Ÿ[ùöY\Œú›[€ãZ][\ÀI JHÿ€X\ê\ò 
N¬à[ŸHÿ\ò’\

N¬àKÀ»ô[X\⁄[ô»H[Ÿ[X›‹à€€[Z]»€õHH€€ò‹ô]H][Kÿ[[[»⁄⁄XŸKô]ô\àHY\ò\ò⁄Húò[ò⁄ÇàôY⁄[í[Ÿ[X›[€ä⁄[ô
H»⁄[[ùûTŸ[X›‹í⁄[ôH⁄[ôOOH	ÿ[[[…»»	ÿ[[[…»à⁄[ôOOH	‹›[€ú…»»	‹›[€ú…»àù[»Kà[ô[Ÿ[X›[€ä
H»⁄[[ùûTŸ[X›‹í⁄[ôHù[»Kà[Ÿ[X›[€í⁄[ô

H»ô]\õà⁄[[ùûTŸ[X›‹í⁄[ô»Kà€‹ŸJ
H»ÿ€X\ê\ò 
N»Kà[ùûSY[ùS‹[ä
H»ô]\õàõ€€X[äÿ\ò”‹[èÀú›\ù’⁄]
	Ÿ[ùöY\Œâ JN»Kà€€Y[ùS‹[ä
H»ô]\õàÿ\ò”‹[àOOH	›€€	Œ»BàN¬à⁄[ô›Àî⁄\ôYŸ[X›[€ê\ò⁄H⁄[ô›ÀóŸ\⁄›‹Ÿ[X›[€ê\òŒ»À»€ôH€€ôöY›\òXõH\ò⁄ô\Ÿ[ù\àõ‹à€€À⁄][\Àÿ[[[À‹›[€úÀÇàÿ›[Y[ùòY]ô[ù\›[ô\ä	⁄ÿù[ööKX[⁄[^KX⁄[ôŸIÀ

HOà¬àYà
ÿ\ò”‹[àOOH	Ÿ[ùöY\Œú›[€ã[YYX⁄[ôI H€‹[î›[€êúò[ò⁄
	€YYX⁄[ôI N¬à[ŸHYà
ÿ\ò”‹[àOOH	Ÿ[ùöY\Œú›[€ã]][]I H€‹[î›[€êúò[ò⁄
	›][]I N¬à[ŸHYà
ÿ\ò”‹[èÀú›\ù’⁄]
	Ÿ[ùöY\Œú›[€ãZ][\ÀI JH€‹[î›[€í][\ ÿ\ò”‹[ãú€XŸJ	Ÿ[ùöY\Œú›[€ãZ][\ÀIÀõ[ô›
JN¬àJN»À»ôYúô\⁄H‹[àY\ò\ò⁄H€õH⁄[à]»ô\⁄€Y€€ù^⁄[ôŸ\ÀÇÇà]›YHù[›[Hò[ŸK›[Y\àHù[›H›HH›[›ôYHò[ŸN¬à€€ùãòY]ô[ù\›[ô\ä	‹⁄[ù\ô›€âÀ]àOà¬àYà
›YOOHù[
Hô]\õé¬à›YH]ãú⁄[ù\íY»›[Hò[ŸN»›[›ôYHò[ŸN¬à›H]ãò€Y[ù»›HH]ãò€Y[ùN¬àÀ»ŸYH[ôRõﬁ\›X⁄‘⁄[ù\ë›€â‹»€€[Y[ùà[à[òÿ]Y⁄õ›»\ôBàÀ»
‹‹⁄XõHõ‹àH›X⁄›\ù[ô»ôYõ‹ôHHúõ›‹Ÿ\à€€ú⁄Y\ú»BàÀ»⁄[ù\àù[HX›]ôJH€›[⁄⁄\Hô\›Ÿà\»[ô\à[ôàÀ»X]ôH›Y›X⁄»õ€ã[ù[\õX[ô[ùHõÿ⁄⁄[ô»\»ù]€ÇàÀ»öXHH⁄[ù\ô›€à›X\ôXõ›ôKÇàûH»€€ùãúŸ]⁄[ù\êÿ\\ôJ]ãú⁄[ù\íY
N»Hÿ]⁄
\úäH» àY‹òYH‹òXŸYù[H
ã»Bà›[Y\àHŸ][Y[›]


HOà»›[HùYN»€‹[ï€€\ò 
N»KÕL
N¬à]ãúô]ô[ùYò][

N¬àJN¬à€€ùãòY]ô[ù\›[ô\ä	‹⁄[ù\õ[›ôIÀ]àOà¬àYà
]ãú⁄[ù\íYOOH›Y
Hô]\õé¬àYà
W›[›ôY	âàX]ö\›
]ãò€Y[ùH›]ãò€Y[ùHH›JHàäH›[›ôYHùYN¬àYà
ÿ\ò”‹[àOOH	›€€	 Hÿ\ò”[›ôJ]ãò€Y[ù]ãò€Y[ùJN¬àJN¬à€€ùãòY]ô[ù\›[ô\ä	‹⁄[ù\ù\	À]àOà¬àYà
]ãú⁄[ù\íYOOH›Y
Hô]\õé¬à›YHù[¬àYà
›[Y\äH»€X\ï[Y[›]
›[Y\äN»›[Y\àHù[»BàYà
ÿ\ò”‹[àOOH	›€€	 Hÿ\ò’\

N¬à[ŸHYà
W›[	âàW›[›ôY
H¬àÀ»H€€Ÿ[X›\ôXÿ[»H\›ò[Y[€€8†%[õ\‹»BàÀ»€€\»[ôXYH›][à⁄X⁄ÿ\ŸHHÿ[YH\õ›»\]Z\¬àÀ»[ú›XY
ô\X⁄[ô»Hô[[›ôYYXÿ]Y]X]ÿ^Hù]€é»ŸYBàÀ»]»X]⁄[ô»ÿ\ŸH[à][Pùâ‹»›€à⁄[ù\ù\ô[› KÇàYà
[[ŸHOOH	›€€	 H]]ÿ^R[\]Z\Y[ù

N¬à[ŸH⁄[ô›ÀóŸ\⁄›‹Ÿ[X›[€ê\òÀúôXÿ[\›€€

N¬àBà›[Hò[ŸN»›[›ôYHò[ŸN¬àJN¬à€€ùãòY]ô[ù\›[ô\ä	‹⁄[ù\òÿ[òŸ[	À]àOà¬àYà
]ãú⁄[ù\íYOOH›Y
Hô]\õé¬à›YHù[¬àYà
›[Y\äH»€X\ï[Y[›]
›[Y\äN»›[Y\àHù[»Bàÿ€X\ê\ò 
N»›[Hò[ŸN»›[›ôYHò[ŸN¬àJN¬ÇàYà
⁄][PùäH¬à]⁄TYHù[⁄R[Hò[ŸK⁄U[Y\àHù[⁄QH⁄QHH⁄S[›ôYHò[ŸN¬à⁄][PùãòY]ô[ù\›[ô\ä	‹⁄[ù\ô›€âÀ]àOà¬àYà
⁄TYOOHù[
Hô]\õé¬à⁄TYH]ãú⁄[ù\íY»⁄R[Hò[ŸN»⁄S[›ôYHò[ŸN¬à⁄QH]ãò€Y[ù»⁄QHH]ãò€Y[ùN¬àÀ»ŸYH[ôRõﬁ\›X⁄‘⁄[ù\ë›€â‹»€€[Y[ùÇàûH»⁄][PùãúŸ]⁄[ù\êÿ\\ôJ]ãú⁄[ù\íY
N»Hÿ]⁄
\úäH» àY‹òYH‹òXŸYù[H
ã»Bà⁄U[Y\àHŸ][Y[›]


HOà»⁄R[HùYN»€‹[í][P\ò 
N»KÕL
N¬à]ãúô]ô[ùYò][

N¬àJN¬à⁄][PùãòY]ô[ù\›[ô\ä	‹⁄[ù\õ[›ôIÀ]àOà¬àYà
]ãú⁄[ù\íYOOH⁄TY
Hô]\õé¬àYà
W⁄S[›ôY	âàX]ö\›
]ãò€Y[ùH⁄Q]ãò€Y[ùHH⁄QJHàäH⁄S[›ôYHùYN¬àYà
ÿ\ò”‹[àOOH	⁄][I Hÿ\ò”[›ôJ]ãò€Y[ù]ãò€Y[ùJN¬àJN¬à⁄][PùãòY]ô[ù\›[ô\ä	‹⁄[ù\ù\	À]àOà¬àYà
]ãú⁄[ù\íYOOH⁄TY
Hô]\õé¬à⁄TYHù[¬àYà
⁄U[Y\äH»€X\ï[Y[›]
⁄U[Y\äN»⁄U[Y\àHù[»BàYà
ÿ\ò”‹[àOOH	⁄][I Hÿ\ò’\

N¬à[ŸHYà
W⁄R[	âàW⁄S[›ôY
H¬àYà
[[ŸHOOH	⁄][I H¬àÀ»[à][H\»[ôXYHŸ[X›Y8†%Hÿ[YH\õ›»\]Z\¬àÀ»[ú›XY
ô\X⁄[ô»Hô[[›ôYYXÿ]Y]X]ÿ^Hù]€é¬àÀ»ŸYH]»X]⁄[ô»ÿ\ŸH[à€€ùâ‹»›€à⁄[ù\ù\Xõ›ôJKÇà]]ÿ^R[\]Z\Y[ù

N¬àH[ŸH¬àÀ»\⁄[H€[ô»H€€‹à[ôÀYúôYH8°§à›⁄]⁄»][H[ŸKÇàYà
[[ŸHOOH	›€€	»	âà“QS‘”’Àö[ò€Y\ X›]ôU€€
JH\›[ò\õU€€HX›]ôU€€¬à[[ŸHH	⁄][IŒ¬àôYúô\⁄][Tÿ‹õ€

N»ôYúô\⁄X›[€êò\ä
N¬àBàBà⁄R[Hò[ŸN»⁄S[›ôYHò[ŸN¬àJN¬à⁄][PùãòY]ô[ù\›[ô\ä	‹⁄[ù\òÿ[òŸ[	À]àOà¬àYà
]ãú⁄[ù\íYOOH⁄TY
Hô]\õé¬à⁄TYHù[¬àYà
⁄U[Y\äH»€X\ï[Y[›]
⁄U[Y\äN»⁄U[Y\àHù[»BàYà
⁄Tÿ‹õ€
H»€X\í[ù\ùò[
⁄Tÿ‹õ€
N»⁄Tÿ‹õ€Hù[»Bàÿ€X\ê\ò 
N»⁄R[Hò[ŸN»⁄S[›ôYHò[ŸN¬àJN¬àBÇàÀ»][]HY[ùHù]€éà⁄^€ô]»›]\ã\ö[ô»€€ùõ€ô\X⁄[ô»BàÀ»ô[[›ôY]X]ÿ^Hù]€â‹»€€›
ŸYHH‘‘»[ô€H€€[Y[ù€ÇàÀ»ÿùï][]SY[ùJKàõ»\ôZ]ö[‹à][[õZŸH€€ùã⁄][PùÇàÀ»Xõ›ôH8†%]€õH]ô\àŸ\»[û][ô»⁄[H[^X›HZŸHBàÀ»\⁄›‹	ÿ…»Ÿ^H\]Z]ò[[ù
ŸYH\⁄›‹€Ÿ^\Àò H8†%€»\¬àÀ»Z\úõ‹ú»Z\à€][ãYòYÀ]À\Ÿ[X›]\õàù]⁄⁄\»Z\ÇàÀ»ù⁄]Ÿ\»HZ[à\»àúò[ò⁄[ù\ô[KÇà€€ú›ùï][]SY[ùHHÿ›[Y[ùôŸ][[Y[ùûRY
	ÿùï][]SY[ùI N¬àYà
ùï][]SY[ùJH¬à]›TYHù[›R[Hò[ŸK›U[Y\àHù[¬àùï][]SY[ùKòY]ô[ù\›[ô\ä	‹⁄[ù\ô›€âÀ]àOà¬àYà
›TYOOHù[
Hô]\õé¬à›TYH]ãú⁄[ù\íY»›R[Hò[ŸN¬àûH»ùï][]SY[ùKúŸ]⁄[ù\êÿ\\ôJ]ãú⁄[ù\íY
N»Hÿ]⁄
\úäH» àY‹òYH‹òXŸYù[H
ã»Bà›U[Y\àHŸ][Y[›]


HOà»›R[HùYN»€‹[ï][]Y\–\ò 
N»KÕL
N¬à]ãúô]ô[ùYò][

N¬àJN¬àùï][]SY[ùKòY]ô[ù\›[ô\ä	‹⁄[ù\õ[›ôIÀ]àOà¬àYà
]ãú⁄[ù\íYOOH›TY
Hô]\õé¬àYà
ÿ\ò”‹[àOOH	Ÿ[ùöY\Œù][]Y\… Hÿ\ò”[›ôJ]ãò€Y[ù]ãò€Y[ùJN¬àJN¬àùï][]SY[ùKòY]ô[ù\›[ô\ä	‹⁄[ù\ù\	À]àOà¬àYà
]ãú⁄[ù\íYOOH›TY
Hô]\õé¬à›TYHù[¬àYà
›U[Y\äH»€X\ï[Y[›]
›U[Y\äN»›U[Y\àHù[»BàYà
ÿ\ò”‹[àOOH	Ÿ[ùöY\Œù][]Y\… Hÿ\ò’\

N¬à›R[Hò[ŸN¬àJN¬àùï][]SY[ùKòY]ô[ù\›[ô\ä	‹⁄[ù\òÿ[òŸ[	À]àOà¬àYà
]ãú⁄[ù\íYOOH›TY
Hô]\õé¬à›TYHù[¬àYà
›U[Y\äH»€X\ï[Y[›]
›U[Y\äN»›U[Y\àHù[»Bàÿ€X\ê\ò 
N»›R[Hò[ŸN¬àJN¬àBàBÇàÀ»8• 8• X›[€àò\à\]H8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• àÀ»8• 8• [ò[ZX»X›[€à›X⁄»8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• àÀ»€€\]\»Hù[\›Ÿàù]€ú»»⁄›À[àôXùZ[»H”Hõ›‹ÀÇàÀ»ù]€ú»\ôHX⁄ŸY[ù»õ›‹»ŸàKãKãããà
^X⁄⁄[ô KÇàÀ»XX⁄ù]€éà»X€€ãXô[X›[€ã›[K[›ŸYBÇàÀ»€[Xà\ôŸ]»\ôH\ôH]H
úò[ò⁄\–ûP\ôXH€»‹⁄][€úÀõ›BàÀ»\ãXúò[ò⁄Y\⁄[ôH8†%ôY\»\ôHò]⁄Y[ù»Y\ôŸY⁄[ö¬àÀ»Ÿ[€Y]ûJK€»H€[Xã]ôYHõ€\ôYY»]»›€à‹⁄][€ôY[ò⁄‹ÇàÀ»ò]\à[àHô]X€K][Hò[òX⁄»›\àù]€ú»⁄\ôKÇà€€ú›ÿ€[Xîõ€\[ò⁄‹àHô]»ëQKìÿöôX›—

N¬àÿ€[Xîõ€\[ò⁄‹ãõò[YHH	ÿ€[Xó‹õ€\ÿ[ò⁄‹âŒ¬Çàù[ò›[€à€€\]PX›[€êù]€ú 
H¬àÀ»⁄][ô»›ô\úöY\»]ô\ûH›\àX›[€à8†%›[ô\»H€õHÿ^H›]àÀ»ÿ[YHY\à\»ö\⁄[ôÀŸX[Ÿ›YHô[›ÀÇàYà
⁄][ù\òX›[€äH¬àô]\õàﬁ»X€€éà	¸'È„IÀXô[à	‘›[ô	ÀX›[€éà	€ÿöó‹›[ô	À›[Nà	‹ö[X\ûIÀ[›ŸYà⁄][ù\òX›[€ãú\ŸHOOH	ÿX›]ôI»WN¬àBàÀ»ö\⁄[ô»Ÿ]»]»›€à\ò»ù]€ú»[ú›XYŸàH\ú€€â‹»õ‹õX[àÀ»ëö\⁄à€ôH
⁄X⁄€›[ù\›ÿ[ôY⁄[ëö\⁄[ô–ÿ\›

HYÿZ[à[ôàÀ»⁄[[ùHô\›\ùHõ›[ô
H8†%Hõ›€KXŸ[ù\àÿX›[€îõ€\àÀ»
ŸYHô[ô\ëö\⁄[ô”›ô\õ^JHZ\úõ‹ú»\ŸH\»[à[ôõ»\‹^BàÀ»
›]\»^‹[öX»ò\ãŸ\⁄›‹Ÿ^HXô[
Kù]HX›X[àÀ»[Xã\ôXX⁄XõH\\ôŸ]€à›X⁄\»H\òÀÿ[YH\»]ô\ûBàÀ»›\à€€X›[€ãàõ›[ô»⁄›‹»ôYõ‹ôH	ÿö]I»
õ»ö]HY]¬àÀ»ôXX› K[ôõ›[ô»⁄›‹»\ö[ô»	ÿÿ]Y⁄	»
HöX›‹ûHöY]¬àÀ»\»]»›€à€€ù[ùYHù]€äKÇàYà
⁄[ô›Àëö\⁄[ôœÀú›]OÀòX›]ôJH¬à€€ú›õHH⁄[ô›Àëö\⁄[ôÀú›]N¬àYà
õKú\ŸHOOH	ÿö]I»	âàõKú\ŸHOOH	ÿX›]ôI Hô]\õà◊N¬à€€ú›õ›Y]X\öŸYHõKú\ŸHOOH	ÿö]I»õKòúöYŸKõX\öŸ\êHOHù[¬à€€ú›X€€àH]X⁄–X›[€íX€€íS
	⁄\ú€€âÀ	Ÿö\⁄	À	¸'„®… N¬àô]\õà¬à»X€€ãXô[àõ›Y]X\öŸY»	‘ôXYH\ú€€â»à	’õ›»\ú€€âÀX›[€éà	Ÿö\⁄‹ö[X\ûIÀ›[Nà	‹ö[X\ûIÀ[›ŸYàùYHKà»X€€éà	¸'„Ï˚Ó#…ÀXô[à	—⁄]ôH\	ÀX›[€éà	Ÿö\⁄ÿÿ[òŸ[	À›[Nà	‹ŸX€€ô\ûIÀ[›ŸYàùYHKàN¬àBàÀ»]\⁄X»Z[öYÿ[YH›ô\õ^H\»]»›€àù[\ÿ‹ôY[à€€ùõ€»
ŸYBàÀ»úÀ€]\⁄XÀ[Z[öYÿ[YKöú H[ôH€‹ŸHù]€à]ô\»[àH›ô\õ^BàÀ»]Ÿ[à8†%õ»X›[€ãXò\àù]€ú»[ô\õôX]]ÇàYà
⁄[ô›Àì]\⁄X”Z[öYÿ[YOÀú›]OÀòX›]ôJHô]\õà◊N¬àÀ»î»X[Ÿ›YHZŸ\»ö[‹ö]H›ô\à€€\ŸH€à›X⁄€€ùõ€»[ôZ\úõ‹ú»Hö[X\ûKXX›[€àŸ^Xõÿ\ô]ÇàYà
ôX\òûSú’ÿ[Ÿ\à	âàYò\õQY][ŸJH¬à€€ú›ùú»H€ú—X[Ÿ›YPù]€ä
WN¬àÀ»€Z]H\»[Xô\ò][H[úŸ\ùY\ôX›HYù\à[»€»]\¬àÀ»[ÿ^\»X›[€àà⁄[àZ]\àúõ€ûô]€‹ö‹»€Z]\»ôZ[ô»òXŸYÇàYà
\‘€Z]Sú“[êúõ€ûô]€‹ö‹ ôX\òûSú’ÿ[Ÿ\äJHùúÀú\⁄
€Z]Pù]€ä
JN¬àYà
\—Ÿ[ô\ò[›‹ôSú”€ë]JôX\òûSú’ÿ[Ÿ\äJHùúÀú\⁄
Ÿ[ô\ò[›‹ôPù]€ä
JN¬àYà
\–ÿ\ú[ù\ìú”€ë]JôX\òûSú’ÿ[Ÿ\äJHùúÀú\⁄
ÿ\ú[ù\êù]€ä
JN¬à€€ú››⁄Y”Ÿôô\àH⁄[ô›Àíÿù[ööQù[ö—ÿ[Y\^PúöYŸOÀôŸ]ú‘›⁄Y”Ÿôô\êX›[€èÀäôX\òûSú’ÿ[Ÿ\äN¬àYà
›⁄Y”Ÿôô\äHùúÀú\⁄
›⁄Y”Ÿôô\äN¬à€€ú›⁄YùŸôô\àH⁄[ô›Àìú—⁄Yù[ôœÀôŸ]ú—⁄YùŸôô\êX›[€èÀäôX\òûSú’ÿ[Ÿ\äN¬àYà
⁄YùŸôô\äHùúÀú\⁄
⁄YùŸôô\äN¬àÀ»ÿ\ôõÿôNà€õHôXX⁄XõH⁄[HX›X[H›[ô[ô»[à]î…‹¬àÀ»›€à€YH[ù\ö[‹à
›\úô[ù\ôXHOOH	€X\⁄W…»
»€YRY8†%Hÿ[YBàÀ»\ôXKZY€€ùô[ù[€àÿYùZ[[ô‘ÿŸ[ôK◊⁄\–ùZ[[ô–\ôXH\ŸJK€¬àÀ»]ôXY»\»ô€»õ›Y⁄Z\à[ô‹»]€YHàò]\à[àBàÀ»ù]€à]õ€›‹»[H]ô\û]⁄\ôKÇàYà
ôX\òûSú’ÿ[Ÿ\ãúôXœÀö€YRY	âà›\úô[ù\ôXHOOH	€X\⁄W…»
»ôX\òûSú’ÿ[Ÿ\ãúôXÀö€YRY	âà⁄[ô›Àìú’ÿ\ôõÿôJH¬àùúÀú\⁄
¬àX€€éà	¸'‰e…ÀàXô[à	€ôX\òûSú’ÿ[Ÿ\ãúôXÀõò[YH	’Z\âﬂI‹»ÿ\ôõÿôXàX›[€éà	€ú◊€‹[ó›ÿ\ôõÿôIÀà›[Nà	‹ŸX€€ô\ûIÀà[›ŸYàùYKà€‹õ[ù\òX›[€éàùYKàJN¬àBàô]\õàùúŒ¬àBÇàÀ»[ù\ö[‹éà^]ù]€àôX\à[ûH€‹â‹»^]ô\⁄€
»[ù\òX›ù]€àõ‹à[ù\ö[‹à€‹õÿöôX›¬àYà
›\úô[ù\ôXHOOH	⁄[ù\ö[‹â H¬à€€ú›ô]X€HHŸ]ô]X€U[J
N¬à€€ú›ôX\ë^]H⁄[ù\ö[‹ë^][\Àö\ ô]X€Kò€€
»	À	»
»ô]X€Kúõ› N¬à€€ú›ùú»H◊N¬àYà
ôX\ë^]
HùúÀú\⁄
»X€€éà	¸'Ê™âÀXô[à	—^]›\ŸIÀX›[€éà	€ÿöóŸ^]⁄›\ŸIÀ›[Nà	‹ö[X\ûIÀ[›ŸYàùYHJN¬àÀ»Ÿ][ù\ö[‹í[ù\òX›XõP]õ›Ÿ]€‹õÿöôX›]8†%€‹õÿöôX›»\¬àÀ»Hò\õHÿŸ[ôI‹»›€à€€‹ô[ò]H‹XŸH
ŸYH]»X€\ò][€äK€¬àÀ»ô]X€H€€‹ô»⁄[H›[ô[ô»[àH[ù\ö[‹àŸ\ôHôZ[ô»⁄X⁄ŸYàÀ»YÿZ[ú›ò\õK\XŸYÿöôX›»]‹ŸHÿ[YHù[Y\öX»€€‹ô[ò]\ÀÇà€€ú›SÿöàHŸ][ù\ö[‹í[ù\òX›XõP]
ô]X€Kò€€ô]X€Kúõ› N¬àYà
SÿöäHùúÀú\⁄
»X€€éàSÿöãö[ù\òX›X€€à	¸'Â%	ÀXô[àSÿöãö[ù\òX›Xô[	“[ù\òX›	ÀX›[€éà	€ÿöó⁄[ù\òX›	À›[Nà	‹ö[X\ûIÀ[›ŸYàùYHJN¬àô]\õàùúŒ¬àBÇàÀ»›€éà‹›ò[ú⁄][€ú»ZŸHö[‹ö]H
ô\]Z\ôH^X⁄][ú]
N»›\ù⁄\ŸBàÀ»ò[õ›Y⁄ô[›»€»€€À›ŸX\€ú»ô[XZ[à\ÿXõH[à›€ãÇàYà
›\úô[ù\ôXHOOH	››€â»	âà‹[ô[ô‘‹›ò[ú⁄][€äH¬à€€ú›H‹[ô[ô‘‹›ò[ú⁄][€é¬à€€ú›X€€àHù\ôŸ]OOH	ÿùZ[[ô…»»	¸'Ê™â»à	¸'„Ê	Œ¬à€€ú›Xô[HõXô[
ù\ôŸ]OOH	ÿùZ[[ô…»»	—[ù\â»à	”X]ôH›€â N¬àô]\õàﬁ»X€€ãXô[X›[€éà	›\ŸW‹‹›	À›[Nà	‹ö[X\ûIÀ[›ŸYàùYHWN¬àBÇàÀ»ùZ[[ô»[ù\ö[‹éà‹›ò[ú⁄][€ú»ô\]Z\ôH^X⁄][ú]àYà
⁄\–ùZ[[ô–\ôXJ›\úô[ù\ôXJJH¬àYà
‹[ô[ô‘‹›ò[ú⁄][€äH¬à€€ú›H‹[ô[ô‘‹›ò[ú⁄][€é¬à€€ú›X€€àHù\ôŸ]OOH	Ÿ^]ÿùZ[[ô…»»	¸'Ê™â»à	¸'Íß	Œ¬à€€ú›Xô[HõXô[
ù\ôŸ]OOH	Ÿ^]ÿùZ[[ô…»»	—^]	»à	’\ŸI N¬àô]\õàﬁ»X€€ãXô[X›[€éà	›\ŸW‹‹›	À›[Nà	‹ö[X\ûIÀ[›ŸYàùYHWN¬àBà€€ú›ô\›H›\úô[ùZ[YYô\›

N¬àYà
ô\›
H¬à€€ú›Xô[Hô\›õ]ôPö\ù»	“€»ZŸHòXûI»à	“€»ZŸHYŸ…Œ¬àô]\õàﬁ»X€€éàô\›õ]ôPö\ù»	¸'‰/â»à	¸'ÈfâÀXô[X›[€éà	€ô\››ZŸIÀ›[Nà	‹ö[X\ûIÀ[›ŸYàùYK€‹õ[ù\òX›[€éàùYKõ€\õ€›àô\›õY\⁄ù[WN¬àBàÀ»H[â‹»ÿ]ô\õà\»Hõ‹‹ÀYöY⁄\ô[òH
ŸYH⁄\–ÿ]ô\õêùZ[[ô–\ôXJH8†%àÀ»HŸX\€ã›€€€€Xõ»ù]€ú»›[ôYY»‹[]HHX›[€ÇàÀ»ò\à\ôKÿ[YH\»ò\õKﬁõ€ôH
ô[› K]ô[à›Y⁄]ô\ûH›\ÇàÀ»ùZ[[ô»[ù\ö[‹à[Xô\ò][H⁄›‹»õ€ôKà€‹õÿöôX›À‹õ‹ÀàÀ»[ôù\õö]\ôHXŸ[Y[ù€â›^\›[àHÿ]ô\õã€»\»⁄⁄\¬àÀ»›òZY⁄»H€€XX›[€ú»õÿ⁄»[ú›XYŸàò[[ô»õ›Y⁄àÀ»Hò\õKﬁõ€ôHúò[ò⁄⁄€\ÿ[KÇàYà
⁄\–ÿ]ô\õêùZ[[ô–\ôXJ›\úô[ù\ôXJH	âà[[ŸHOOH	›€€	 H¬à€€ú›ÿ]ô\õîô]X€HHŸ]ô]X€U[J
N¬à€€ú›ÿ]ô\õï[HHŸ]X›]ôQ‹öY

Vÿÿ]ô\õîô]X€Kúõ›◊OÀñÿÿ]ô\õîô]X€Kò€€N¬à€€ú›ÿ]ô\õêùú»H◊N¬à
€€X›[€ú÷ÿX›]ôU€€H◊JKôõ‹ëXX⁄

X›[€ãJHOà¬à€€ú›Ÿò[òX⁄“X€€óHHX›[€ìXô[÷ÿX›[€óN¬à€€ú›X€€àH]X⁄–X›[€íX€€íS
X›]ôU€€X›[€ãò[òX⁄“X€€äN¬à€€ú›[›ŸYHÿ[ï\ŸPX›[€äX›]ôU€€X›[€ãÿ]ô\õîô]X€Kò€€ÿ]ô\õîô]X€Kúõ› N¬àÿ]ô\õêùúÀú\⁄
¬àX€€ãXô[à€€ù^X[X›[€ìXô[
X›[€ãÿ]ô\õï[JKàX›[€ã›[NàHOOH»	‹ö[X\ûI»à	‹ŸX€€ô\ûIÀ[›ŸYàJN¬àJN¬àô]\õàÿ]ô\õêùúŒ¬àBà€€ú›îô]X€HHŸ]ô]X€U[J
N¬à€€ú›í[ù\òX›XõHHÿùZ[[ô“[ù\òX›Xõ\ÀôŸ]
›\úô[ù\ôXH
»	À	»
»îô]X€Kò€€
»	À	»
»îô]X€Kúõ› N¬àYà
í[ù\òX›XõJHô]\õàí[ù\òX›XõKôŸ]ù]€ú 
N¬àÀ»ùZ[[ô»[ù\ö[‹ú»ô]\õàX\õHXõ›ôH[ôô]ô\àôXX⁄BàÀ»ò\õKﬁõ€ôK››€à][KX€€ù^õÿ⁄»ù\ù\à›€à
][€»ô[Y\¬àÀ»€àHô]X€K›[HZ\à\»úò[ò⁄ô]ô\à€€\]\ H8†%⁄]›]àÀ»\À[Z][HX›[€ú»ZŸHX][ô»‹à^Z[ô»H›\úò^XBàÀ»⁄[[ùHYõ»ù]€à[û]⁄\ôH[ô€‹úÀõ›ù\›[àH[õãÇàÀ»Z\úõ‹ú»Hÿ[YHôYH⁄X⁄‹»[à]õÿ⁄À[àHÿ[YBàÀ»ö[‹ö]H‹ô\é»H[ù‹ŸYY\ùô[›»[HŸ\€â›\BàÀ»[ô€‹ú»€»\€â›\Xÿ]Y\ôKÇàYà
[[ŸHOOH	⁄][I H¬à€€ú›[][HHŸ]X›]ôR[ùô[ù‹ûR][J
N¬à€€ú›õ\⁄–X›[€ú»H⁄[ô›Àê[⁄[^Qõ\⁄‹œÀö[X›[€úœÀä
H◊N¬àYà
õ\⁄–X›[€úÀõ[ô›
Hô]\õàõ\⁄–X›[€úŒ¬à€€ú›€€ú›[YPX›[€àH⁄[ô›Àíÿù[ööQù[ö—ÿ[Y\^PúöYŸOÀôŸ][][PX›[€èÀä
N¬àYà
€€ú›[YPX›[€äHô]\õàÿ€€ú›[YPX›[€óN¬àYà
[][H	âàUSW—Qî÷⁄[][KöŸ^WOÀö\–€€⁄ŸYõ€Ÿ
Hô]\õàﬁ»X€€éà	¸'„lâÀXô[àX]	“USW—Qî÷⁄[][KöŸ^WKõXô[XX›[€éà	ÿ€€ú›[YWŸõ€Ÿ⁄][IÀ›[Nà	‹ö[X\ûIÀ[›ŸYà
[ùô[ù‹ûV⁄[][KöŸ^WH
HàWN¬àYà
[][H	âàUSW—Qî÷⁄[][KöŸ^WOÀö\“[ú›ù[Y[ù
Hô]\õàﬁ»X€€éà	¸'„≠IÀXô[à	‘^IÀX›[€éà	‹^W⁄[ú›ù[Y[ù	À›[Nà	‹ö[X\ûIÀ[›ŸYà
[ùô[ù‹ûV⁄[][KöŸ^WH
HàWN¬àBàô]\õà◊N¬àBÇà€€ú›ô]X€HHŸ]ô]X€U[J
N¬ÇàÀ»ò\õKﬁõ€ôNà⁄›»‹›ò[ú⁄][€àù]€à
›\ŸH[ùò[òŸK›€à^]]ÀäBàYà

›\úô[ù\ôXHOOH	Ÿò\õI»⁄\÷õ€ôP\ôXJ›\úô[ù\ôXJJH	âà‹[ô[ô‘‹›ò[ú⁄][€äH¬à€€ú›H‹[ô[ô‘‹›ò[ú⁄][€é¬à€€ú›X€€àHù\ôŸ]OOH	⁄[ù\ö[‹â»»	¸'„Ë	»àù\ôŸ]OOH	››€â»»	¸'„Ê	»à	¸'Ê™âŒ¬à€€ú›Xô[HõXô[
ù\ôŸ]OOH	⁄[ù\ö[‹â»»	—[ù\à›\ŸI»àù\ôŸ]OOH	››€â»»	”X]ôHò\õI»à	’ò]ô[	 N¬à€€ú›ùú‘‹›H◊N¬àùú‘‹›ú\⁄
»X€€ãXô[X›[€éà	›\ŸW‹‹›	À›[Nà	‹ö[X\ûIÀ[›ŸYàùYHJN¬à€€ú›ÿöåàHŸ]€‹õÿöôX›]
ô]X€Kò€€ô]X€Kúõ› N¬àYà
ÿöåäHÿöåãôŸ]ù]€ú ô]X€JKôõ‹ëXX⁄
àOàùú‘‹›ú\⁄
äJN¬àô]\õàùú‘‹›¬àBÇàÀ»Húò[ò⁄ô\›€Z[\»X›[€àH€õH⁄[H]»—õ€[YH\»[ô\ÇàÀ»HŸ[ù\ôYô]X€H[ô]»ô\›[›\à\»õ»€ôŸ\à›X\ô[ô»]Çà€€ú›õ€ôSô\›H⁄\÷õ€ôP\ôXJ›\úô[ù\ôXJH»›\úô[ùZ[YYô\›

Hàù[¬àYà
õ€ôSô\›
H¬à€€ú›Xô[Hõ€ôSô\›õ]ôPö\ù»	“€»ZŸHòXûI»à	“€»ZŸHYŸ…Œ¬àô]\õàﬁ»X€€éàõ€ôSô\›õ]ôPö\ù»	¸'‰/â»à	¸'ÈfâÀXô[X›[€éà	€ô\››ZŸIÀ›[Nà	‹ö[X\ûIÀ[›ŸYàùYK€‹õ[ù\òX›[€éàùYKõ€\õ€›àõ€ôSô\›õY\⁄ù[WN¬àBÇàÀ»ò[ô][ù»\ôHù[ù[YHõ‹»ò]\à[à€‹õÿöôX›À€»^‹ŸBàÀ»Z\à€€ù^X›[€à^X⁄]Kà⁄[ù\ã⁄Ÿ^Xõÿ\ô€»›[ôYYàÀ»H⁄\ôYX›[€í[›€àõY»€€ú›[YYûHò[ô]ÿ[\ÀÇà€€ú›ò[ô][ùX›[€àH⁄\÷õ€ôP\ôXJ›\úô[ù\ôXJBà»⁄[ô›Àêò[ô]ÿ[\œÀôŸ]ôX\òûU[ùX›[€èÀä
Bààù[¬àYà
ò[ô][ùX›[€äHô]\õàÿò[ô][ùX›[€óN¬ÇàÀ»HXŸY⁄[\õô\‹»ÿ[\ö\ôKÿ[YHù[ù[YK\õ‹]\õà\»ò[ô]àÀ»[ù»Xõ›ôH8†%ÿ[⁄[ô»\»]]»ÿ]ôK–€€⁄À–úô]»XX⁄€àZ\ÇàÀ»›€àX›[€ãXò\à€›
ô]\õà»ÿ[\]ô\»€àH][]Y\»⁄Y[àÀ»[ú›XY8†%ŸYHH	ÿ…»€ZŸ^H[ô[ô»ù\ù\à›€äKÇà€€ú›ÿ[\ö\ôPX›[€ú»H⁄\÷õ€ôP\ôXJ›\úô[ù\ôXJBà»⁄[ô›Àï⁄[\õô\‹–ÿ[\ö\ôOÀôŸ]ôX\òûPX›[€úœÀä
Bààù[¬àYà
ÿ[\ö\ôPX›[€úœÀõ[ô›
Hô]\õàÿ[\ö\ôPX›[€úŒ¬ÇàÀ»€[Xö[ô»\»›[öYŸŸ\ôYûHHõ‹ùÿ\ôŸŸH
ŸYBàÀ»\ôõ‹õP€€ù^X›[€äH€»[à]X⁄À⁄][Hô\‹»ô]ô\à‹òXú»BàÀ»ôX\òûHù[ö»ûHXÿ⁄Y[ù8†%ù]HòX⁄[ô»€[Xà\ôŸ][€»Ÿ]»BàÀ»\›Yõ€\\ôH\ô[Hõ‹à\ÿ€›ô\òXö[]K⁄[òŸHHŸŸBàÀ»öYŸŸ\à]Ÿ[à\»›\ù⁄\ŸH⁄[[ù›[ô\ÿ€›ô\òXõKÇà€€ú›[HHŸ]X›]ôQ‹öY

V‹ô]X€Kúõ›◊V‹ô]X€Kò€€N¬à€€ú›ùú»H◊N¬ÇàYà
⁄\÷õ€ôP\ôXJ›\úô[ù\ôXJH	âà\^Y\ãò€[Xö[ô H¬à€€ú›€[Xï\ôŸ]H⁄[ô›Àê€[Xîﬁ\›[OÀôŸ]€[Xï\ôŸ]Àä
N¬àYà
€[Xï\ôŸ]	âà
€[Xï\ôŸ]ù\HOOH	ÿúò[ò⁄	»€[Xï\ôŸ]ù\HOOH	ÿúò[ò⁄ù[\›€â JH¬à€€ú›úò[ò⁄H€[Xï\ôŸ]òúò[ò⁄¬à€€ú›[ò⁄‹ñHúò[ò⁄»
úò[ò⁄òò\ŸV
»úò[ò⁄ù\
H»àà^Y\ãû¬à€€ú›[ò⁄‹ñHHúò[ò⁄»
úò[ò⁄òò\ŸVH
»úò[ò⁄ù\JH»àà^Y\ãûN¬à€€ú›[ò⁄‹ï€‹õHHúò[ò⁄à»X]õX^
úò[ò⁄òò\ŸU€‹õHœ»úò[ò⁄ù\€‹õHœ»
H
»çàà
X›]ôT›\ôòXŸVP]€‹õ
^Y\ãû»SK^Y\ãûH»SJH
»KåäN¬àÿ€[Xîõ€\[ò⁄‹ãú‹⁄][€ãúŸ]
[ò⁄‹ñ»SK[ò⁄‹ï€‹õK[ò⁄‹ñH»SJN¬àùúÀú\⁄
¬àX€€éà€[Xï\ôŸ]ù\HOOH	ÿúò[ò⁄ù[\›€â»»	¸'Í†â»à	¸'ÈÂ…ÀàXô[à€[Xï\ôŸ]ù\HOOH	ÿúò[ò⁄ù[\›€â»»	–€[Xà›€â»à	–€[XàôYIÀàX›[€éà	ÿ€[Xóÿúò[ò⁄	À›[Nà	‹ŸX€€ô\ûIÀ[›ŸYàùYKà€‹õ[ù\òX›[€éàùYKõ€\õ€›àÿ€[Xîõ€\[ò⁄‹ãàJN¬àBàBÇàÀ»à€‹õÿöôX›]ô]X€H8†%]»ù]€ú»ZŸHö[‹ö]Kà›€à\¬àÀ»õ»€‹õÿöôX›»Ÿà]»›€à
ŸYH]»ôò\õK\ÿŸ[ôK[€õHà€€[Y[ùàÀ»Xõ›ôJH8†%]»ù\õö]\ôH[ù\òX›Xõ\»
⁄]XõHô[ò⁄\À]ÀäBàÀ»]ôH[àÿùZ[[ô“[ù\òX›Xõ\»[ú›XYÿ[YH\»ùZ[[ô»[ù\ö[‹úÀÇà€€ú›ÿöàH›\úô[ù\ôXHOOH	››€â¬à»ÿùZ[[ô“[ù\òX›Xõ\ÀôŸ]
	››€ã	»
»ô]X€Kò€€
»	À	»
»ô]X€Kúõ› HŸ]€‹õÿöôX›]
ô]X€Kò€€ô]X€Kúõ› BààŸ]€‹õÿöôX›]
ô]X€Kò€€ô]X€Kúõ› N¬àYà
ÿöäH¬à€€ú›ÿöêùú»HÿöãôŸ]ù]€ú ô]X€JN¬àÿöêùúÀôõ‹ëXX⁄
àOàùúÀú\⁄
äJN¬àBÇàÀ»ãà\ùô\›ÿ[YHö[‹ö]HY\à\»H€‹õÿöôX›
HôXYH‹õ‹àÀ»⁄›[ôZ]ôH^X›HZŸHX⁄⁄[ô»H⁄[\òãÿô\úûNà]òZ[XõBàÀ»\»X›[€àHôYÿ\ô\‹»Ÿà⁄]	‹»[à[›\à[ôõ›ù\›⁄[H[ÇàÀ»[ùô[ù‹ûH][H\[ú»»ôHŸ[X›Y
H8†%ô]ö[›\€H\»€õBàÀ»]ô\à\X\ôY›€à[àH][K[[ŸK[€õHŸX›[€àô[›À€»Z[Z[ô¬àÀ»]HôXYH‹õ‹⁄[H€[ô»H€€⁄›ŸYõ»X⁄»ù]€à][ÇàYà
[Kò‹õ‹
H¬à€€ú›]HH‹õ‹]V›[Kò‹õ‹N¬àùúÀú\⁄
¬àX€€éà[Kò‹õ‹ôXYH»]Kô[[⁄öHà	¸'„,IÀàXô[à[Kò‹õ‹ôXYH»	¯ß$»\ùô\›	»à	›[Kò‹õ‹H
	”X]ôõ€‹ä[Kò‹õ‹YŸJ_Y
XàX›[€éà	⁄\ùô\›	À›[Nà[Kò‹õ‹ôXYH»	⁄\ùô\›	»à	‹ŸX€€ô\ûIÀà[›ŸYà[Kò‹õ‹ôXYKàJN¬àBÇàÀ»Kà€€	‹»›€àX›[€ú»
›\ô\‹ŸY[à][H[ŸJBàYà
[[ŸHOOH	›€€	 H¬à€€ú›X›[€ú»H€€X›[€ú÷ÿX›]ôU€€H◊N¬àX›[€úÀôõ‹ëXX⁄

X›[€ãJHOà¬à€€ú›Ÿò[òX⁄“X€€óHHX›[€ìXô[÷ÿX›[€óN¬à€€ú›X€€àH]X⁄–X›[€íX€€íS
X›]ôU€€X›[€ãò[òX⁄“X€€äN¬à€€ú›[›ŸYHÿ[ï\ŸPX›[€äX›]ôU€€X›[€ãô]X€Kò€€ô]X€Kúõ› N¬àùúÀú\⁄
¬àX€€ãXô[à€€ù^X[X›[€ìXô[
X›[€ã[JKàX›[€ã›[NàHOOH»	‹ö[X\ûI»à	‹ŸX€€ô\ûIÀ[›ŸYàJN¬àJN¬àBÇàÀ»äÃÀà][H€€ù^X›[€ú»8†%€õH[à][H[ŸBàYà
[[ŸHOOH	⁄][I Hô]\õàùúŒ¬ÇàÀ»HŸ[X›Y€€ú›[XXõH\»][HX›[€àKà]»€€ôöY›\ôYö[ô[ô»›€ú¬àÀ»€€ú›[\[€é»ò]»‹XŸK—[ù\ã“[ù\òX›Ÿ^\»]ôHõ»‹X⁄X[ôZ]ö[‹ãÇà€€ú›[][HHŸ]X›]ôR[ùô[ù‹ûR][J
N¬à€€ú›õ\⁄–X›[€ú»H⁄[ô›Àê[⁄[^Qõ\⁄‹œÀö[X›[€úœÀä
H◊N¬àYà
õ\⁄–X›[€úÀõ[ô›
Hõ\⁄–X›[€úÀú€XŸJ
Kúô]ô\úŸJ
Kôõ‹ëXX⁄
X›[€àOàùúÀù[ú⁄Yù
X›[€äJN¬à€€ú›€€ú›[YPX›[€àH⁄[ô›Àíÿù[ööQù[ö—ÿ[Y\^PúöYŸOÀôŸ][][PX›[€èÀä
N¬àYà
Yõ\⁄–X›[€úÀõ[ô›	âà€€ú›[YPX›[€äHùúÀù[ú⁄Yù
€€ú›[YPX›[€äN¬à[ŸHYà
[][H	âàUSW—Qî÷⁄[][KöŸ^WOÀö\–€€⁄ŸYõ€Ÿ
HùúÀù[ú⁄Yù
»X€€éà	¸'„lâÀXô[àX]	“USW—Qî÷⁄[][KöŸ^WKõXô[XX›[€éà	ÿ€€ú›[YWŸõ€Ÿ⁄][IÀ›[Nà	‹ö[X\ûIÀ[›ŸYà
[ùô[ù‹ûV⁄[][KöŸ^WH
HàJN¬à[ŸHYà
[][H	âàUSW—Qî÷⁄[][KöŸ^WOÀö\“[ú›ù[Y[ù
HùúÀù[ú⁄Yù
»X€€éà	¸'„≠IÀXô[à	‘^IÀX›[€éà	‹^W⁄[ú›ù[Y[ù	À›[Nà	‹ö[X\ûIÀ[›ŸYà
[ùô[ù‹ûV⁄[][KöŸ^WH
HàJN¬à[ŸHYà
[][H	âà[][KöŸ^HOOH	ÿÿ[\ö\ôR⁄]ù\õö]\ôI HùúÀù[ú⁄Yù
»X€€éà	¸'Â)IÀXô[à	‘Ÿ]\ÿ[\ö\ôIÀX›[€éà	‹XŸWÿÿ[\ö\ôW⁄⁄]	À›[Nà	‹ö[X\ûIÀ[›ŸYà⁄\÷õ€ôP\ôXJ›\úô[ù\ôXJH	âà
[ùô[ù‹ûV⁄[][KöŸ^WH
HàJN¬ÇàÀ»ãà€€ù^à[ùù]€àYàŸ[X›Y][H\»HŸYY[ô[Hÿ[àXÿŸ\]à€€ú›][HHŸ]X›]ôR[ùô[ù‹ûR][J
N¬àYà
][H	âà][KúŸYYõ‹äH¬à€€ú›‹õ‹ò[YHH][KúŸYYõ‹é¬à€€ú›[ùX›H	‹[ù…»
»‹õ‹ò[YN¬à€€ú›€›[ùH[ùô[ù‹ûV⁄][KöŸ^WH¬à€€ú›ÿ[î[ùH€›[ùà	âàÿ[î[ù‹õ‹€ï[J‹õ‹ò[YK[JN¬àùúÀú\⁄
¬àX€€éà][KöX€€ãXô[à€›[ùà»[ù
	ÿ€›[ùJXà	”õ»ŸYY…ÀàX›[€éà[ùX››[Nà	‹[ù	À[›ŸYàÿ[î[ùàJN¬àBÇàYà
][JH¬à€€ú›ù\õö]\ôRŸ^HHŸ]ù\õö]\ôRŸ^PûR][RŸ^J][KöŸ^JN¬àYà
ù\õö]\ôRŸ^JH¬à€€ú›€›[ùH[ùô[ù‹ûV⁄][KöŸ^WH¬àùúÀú\⁄
¬àX€€éà][KöX€€ãàXô[à€›[ùà»XŸH
	ÿ€›[ùJXà	”õ»ù\õö]\ôIÀàX›[€éà	‹XŸW…»
»ù\õö]\ôRŸ^Kà›[Nà	‹[ù	Àà[›ŸYà€›[ùà	âàÿ[îXŸQù\õö]\ôP]
ô]X€Kò€€ô]X€Kúõ› KàJN¬àBà€€ú›X€‹íŸ^HHŸ]X€‹ò]]ôQù\õö]\ôRŸ^PûR][RŸ^J][KöŸ^JN¬àYà
X€‹íŸ^H	âàQP”‘êUUëW—ïTìíUTëW—Qî÷ŸX€‹íŸ^WOÀò›\›€TXŸJH¬à€€ú›YàHP”‘êUUëW—ïTìíUTëW—Qî÷ŸX€‹íŸ^WN¬à€€ú›€›[ùH[ùô[ù‹ûV⁄][KöŸ^WH¬à€€ú›\ôXS⁄»HYãò\ôXHOOH	ÿ[ûI»
Yãò\ôXHOOH	⁄[ù\ö[‹â»	âà›\úô[ù\ôXHOOH	⁄[ù\ö[‹â H
Yãò\ôXHOOH	Ÿò\õI»	âà›\úô[ù\ôXHOOH	Ÿò\õI N¬àùúÀú\⁄
¬àX€€éà][KöX€€ãàXô[à€›[ùà»XŸH
	ÿ€›[ùJXà	”õ»ù\õö]\ôIÀàX›[€éà	‹XŸWŸX€‹ó…»
»X€‹íŸ^Kà›[Nà	‹[ù	Àà[›ŸYà€›[ùà	âà\ôXS⁄»	âàÿ[îXŸQX€‹ò]]ôQù\õö]\ôP]
ô]X€Kò€€ô]X€Kúõ› KàJN¬àBàBÇàô]\õàùúŒ¬àBÇàÀ»ò[òX⁄»[ò⁄‹àõ‹à[ù\òX›Xõ\»⁄]›]Z\à›€àÿöôX›—à]\¬àÀ»[›ôY»HZ[YY[HôYõ‹ôHH€‹õ\‹XŸH\›\»ﬁ[ò⁄õ€ö^ôYÇà€€ú››€‹õ[ù\òX›[€îõ€\[ò⁄‹àHô]»ëQKìÿöôX›—

N»À»\ŸYûHôYúô\⁄X›[€êò\àõ‹àõ€ã[Y\⁄€‹õÿöôX›ÀÇà›€‹õ[ù\òX›[€îõ€\[ò⁄‹ãõò[YHH	›€‹õ⁄[ù\òX›[€ó‹õ€\ÿ[ò⁄‹âŒ¬ÇàÀ»òX⁄»\››]H»]õ⁄YôXùZ[[ô»H›X⁄»]ô\ûHúò[YBà]€\›ò\íŸ^HH	…Œ¬Çàù[ò›[€àôYúô\⁄X›[€êò\ä›X⁄‹»HŸ][ùô[ù‹ûT›X⁄“][\ 
JH¬à⁄[ô›Àë]î‹]€ô\ãúôYúô\⁄Y]‹êù]€ïö\⁄Xö[]J
N¬à⁄[ô›Àëù\õö]\ôTXŸ\èÀúôYúô\⁄ö\⁄Xö[]J
N¬à€€ú›ô]X€HHŸ]ô]X€U[J
N¬à€€ú›[HHŸ]X›]ôU[P]
ô]X€Kò€€ô]X€Kúõ› N¬ÇàÀ»ÿ\»ò\õK[€õH
€‹õÿöôX›»Yâ›^\›[Ÿ]⁄\ôJH8†%õ›¬àÀ»[ò€€ô][€ò[€»H€›XõH€‹úŸI‹»Y[ù]H[à[ûH\ôXH
õ€ô\¬àÀ»[ò€YY
H›[[ùò[Y]\»HÿX⁄H[ôôXùZ[»]»ù]€ãÇà€€ú›ÿöàHŸ]€‹õÿöôX›]
ô]X€Kò€€ô]X€Kúõ› N¬à€€ú›ôX\òûSú“Ÿ^HHôX\òûSú’ÿ[Ÿ\èÀúôXœÀöYôX\òûSú’ÿ[Ÿ\èÀúõ€›Àù]ZY	€õ€ôIŒ¬à€€ú›ôX\òûSú–X›]ö]RŸ^HHôX\òûSú’ÿ[Ÿ\èÀò›\úô[ùÿ⁄Y[U\ôŸ]ÀòX›]ö]H	€õ€ôIŒ¬à€€ú›ôX\òûSú‘⁄‹Ÿ^HHôX\òûSú’ÿ[Ÿ\à	âà\‘€Z]Sú“[êúõ€ûô]€‹ö‹ ôX\òûSú’ÿ[Ÿ\äH»€Z]PX›[€ä
BààôX\òûSú’ÿ[Ÿ\à	âà\—Ÿ[ô\ò[›‹ôSú”€ë]JôX\òûSú’ÿ[Ÿ\äH»Ÿ[ô\ò[›‹ôPX›[€ä
BààôX\òûSú’ÿ[Ÿ\à	âà\–ÿ\ú[ù\ìú”€ë]JôX\òûSú’ÿ[Ÿ\äH»ÿ\ú[ù\êX›[€ä
Hà	€õ€ôIŒ¬àÀ»€€ú›[XXõH€›[ù»]\›[ùò[Y]HHÿX⁄YX›[€àYù\àH\›][H\»\ŸYÇà€€ú›Ÿ[X›Y][HHŸ]X›]ôR[ùô[ù‹ûR][J›X⁄‹ N¬à€€ú›Ÿ[X›Y][RŸ^HHŸ[X›Y][OÀöŸ^H	…Œ¬à€€ú›Ÿ[X›Y][P€›[ùHŸ[X›Y][RŸ^H»
[ùô[ù‹ûV‹Ÿ[X›Y][RŸ^WH
Hà¬à€€ú›ùú»H€€\]PX›[€êù]€ú 
N¬àÀ»]ô\ûHX›[€à›\YYûH[àZ[YY€‹õÿöôX›\»H€‹õàÀ»[ù\òX›[€à]ô[àYà]»YôY]\»Hÿöó àò[Z[ô»€€ùô[ù[€ãÇà€€ú›ÿöôX›X›[€íY»Hô]»Ÿ]

ÿöèÀôŸ]ù]€úœÀäô]X€JH◊JKõX\
ù]€àOàù]€ãòX›[€äJN¬à€€ú›\’€‹õ[ù\òX›[€àHù]€àOàù]€èÀù€‹õ[ù\òX›[€Çàù]€èÀò€€ù^X[[][BàÿöôX›X›[€íYÀö\ ù]€èÀòX›[€äBàù]€èÀòX›[€àOOHú—X[Ÿ›YPX›[€ä
Bàù]€èÀòX›[€àOOH€Z]PX›[€ä
Bàù]€èÀòX›[€àOOHŸ[ô\ò[›‹ôPX›[€ä
Bàù]€èÀòX›[€àOOHÿ\ú[ù\êX›[€ä
Bàù]€èÀòX›[€àOOH	›\ŸW‹‹›	¬àù]€èÀòX›[€àOOH	€ô\››ZŸI¬àù]€èÀòX›[€àOOH	ÿò[ô]›[ù⁄[ù\òX›	¬àù]€èÀòX›[€àOOH	ÿ€[Xóÿúò[ò⁄	¬àù]€èÀòX›[€èÀú›\ù’⁄]
	€ÿöó… N¬à€€ú›[ù\òX›[€êù]€àHùúÀôö[ô
\’€‹õ[ù\òX›[€äHù[¬àYà
[ù\òX›[€êù]€äH¬à›€‹õ[ù\òX›[€îõ€\[ò⁄‹ãú‹⁄][€ãúŸ]
àô]X€Kò€€
»çKàX›]ôT›\ôòXŸVP]€‹õ
ô]X€Kò€€
»çKô]X€Kúõ›»
»çJH
»çMKàô]X€Kúõ›»
»çKà
N¬àBà€€ú›[ù\òX›[€îõ€›H[ù\òX›[€êù]€èÀúõ€\õ€›àôX\òûSú’ÿ[Ÿ\èÀúõ€›àÿöèÀúõ€\õ€›ÿöèÀúõ€›ÿöèÀô‹õ›\ÿöèÀõY\⁄à
[ù\òX›[€êù]€à»›€‹õ[ù\òX›[€îõ€\[ò⁄‹ààù[
N¬à€€ú›õ€\X›[€íY»H…ÿX›[€åIÀ	ÿX›[€åâÀ	ÿX›[€å…À	⁄[ù\òX›	◊N¬à€€ú›õ€\[ú]»HùúÀõX\

ù]€ã[ô^
HOà»À»\ŸYûHXX⁄õÿ][ô»õ›»»ô[ô\à]»ôXõ›[ô[ú][ôX]⁄[ô»\ò⁄€€‹à[ô\[ô[ùKÇà€€ú›X›[€íYHù]€ãòX›[€àOOH	ÿ€[Xóÿúò[ò⁄	»»	ŸŸŸI»à
õ€\X›[€íY÷⁄[ô^HX›[€â⁄[ô^
»_X
N»À»\ŸY»⁄›»€[XàYÿZ[ú›]»ôX[ŸŸHö[ô[ô»[ú›XYŸàX›[€àKÇà€€ú››X⁄Xô[HX›[€íYOOH	ŸŸŸI»»	—ŸŸI»àX›[€à	⁄[ô^
»_X»À»\ŸY⁄[à›X⁄€€ùõ€»]ôHõ»Ÿ^Xõÿ\ôÿ€€ùõ€\à€\Çàô]\õà¬àX›[€íYàXô[àX›[€îõ€\€\
X›[€íY›X⁄Xô[
Kà€€‹éàX›[€îõ€\€€‹äX›[€íY
KàN¬àJN¬à⁄[ô›Àï€‹õ‹\^Àúﬁ[ò“[ù\òX›[€îõ€\œÀä¬àù]€úŒàùúÀàõ€›à[ù\òX›[€îõ€›à[òXõYà[Y[ùS‹[à	âàYX[Ÿ›YS‹[à	âà\]\ŸYàÿŸ[ôNàŸ]X›]ôTÿŸ[ôJ
Kàõ€\[ú]Àà⁄›“[ú][ùŒàùYKà\’€‹õ[ù\òX›[€ãàJN¬àÀ»[ò[ZX»õ›öY\ú»
[ò€Y[ô»H\ﬁ[ò⁄õ€õ›\€HÿYY€€ú›[XXõBàÀ»úöYŸJHÿ[à⁄[ôŸHHô\€€ôY\ò⁄⁄]›]⁄[ô⁄[ô»[K⁄][H›]KÇà€€ú›X›[€êù]€íŸ^HHùúÀõX\
ù]€àOà	ÿù]€ãòX›[€üNâÿù]€ãò[›ŸYOOHò[ŸH»HàNâÿù]€ãõXô[Nâÿù]€ãú›⁄Y—úòX›[€à	…ﬂX
Köõ⁄[ä	À	 N¬àÀ»⁄[ô›Àëö\⁄[ôœÀú›]OÀú\ŸH
õ›ù\›òX›]ôJH]\›ôH[à\»Ÿ^NÇàÀ»€€\]PX›[€êù]€ú 
Hô]\õú»Yôô\ô[ùù]€àŸ]»X‹õ‹‹»BàÀ»ÿ\››ÿZ][ôÀÿö]KÿX›]ôKÿÿ]Y⁄Ÿ\]Y[òŸH
[\H[ù[	ÿö]IÀBàÀ»ö\⁄‹ö[X\ûKŸö\⁄ÿÿ[òŸ[Z\àúõ€H	ÿö]I»€ùÿ\ô
Kù]]⁄€BàÀ»Ÿ\]Y[òŸH\›X[HŸ\€â››X⁄[û][ô»[ŸHHŸ^HòX⁄‹»
ÿ[YBàÀ»[Kÿ[YH€€ÿ[YHô]X€JH8†%Ÿ^Z[ô»€àù\›òX›]ôH€›[	›ôBàÀ»ÿ]Y⁄Hô\ûHö\ú›ò[ú⁄][€à[ù»ö\⁄[ô»ù][àô]ô\ÇàÀ»ôXùZ[YÿZ[àõ‹àHô\›ŸàHõ›[ô⁄[òŸHòX›]ôH›^\»ùYBàÀ»õ›Y⁄›]à\ŸH⁄[ôŸ\»]ô\ûH›\€»][ÿ^\»õ‹òŸ\»HôXùZ[Çà€€ú›Ÿ^HH	ÿ›\úô[ù\ôX__	⁄[[Ÿ__	ÿX›]ôU€€_	ÿX›]ôR][R[ô^_	‹Ÿ[X›Y][RŸ^__	‹Ÿ[X›Y][P€›[ù_	‹ô]X€Kò€€K	‹ô]X€Kúõ›ﬂ_	›[Kù\__	›[Kò‹õ‹_	›[Kò‹õ‹ôXY__	€ÿöà»ÿöãöYà	€õ€ôIﬂ_	‹õÿŸ\‹⁄[ô—ù\õö]\ôSÿöôX›Àú⁄^ô__	ÿ[ö[X[ÿöôX›Àú⁄^ô__	◊‹[ô[ô‘‹›ò[ú⁄][€èÀöY	…ﬂ_	€ôX\òûSú“Ÿ^__	€ôX\òûSú–X›]ö]RŸ^__	€ôX\òûSú‘⁄‹Ÿ^__	›⁄[ô›Àëö\⁄[ôœÀú›]OÀú\ŸH	…ﬂ_	›⁄[ô›Àì]\⁄X”Z[öYÿ[YOÀú›]OÀòX›]ôH	…ﬂ_	ÿX›[€êù]€íŸ^_X¬à€€ú›ôYY‘ôXùZ[HŸ^HOOH€\›ò\íŸ^N¬à€\›ò\íŸ^HHŸ^N¬ÇàÀ»\]HX›]ôPX›[€à]ô[à⁄]›]”HôXùZ[à€[Xóÿúò[ò⁄àÀ»
\⁄Yö\ú›[à€€\]PX›[€êù]€ú»\ô[H»ôYYH—àÀ»õÿ][ô»€‹õ\‹XŸHõ€\›ô\àH€[XòXõHúò[ò⁄8†%ŸYH]¬àÀ»›€à€€[Y[ù
H\»^€YY›]öY⁄\ôKõ›ù\›\ö[‹ö]^ôYÇàÀ»€[Xö[ô»\»€õH]ô\à›\‹ŸY»öYŸŸ\àúõ€HHõ‹ùÿ\ôŸŸBàÀ»
ŸYH\ôõ‹õP€€ù^X›[€äKô]ô\àúõ€HX›[€àKÿH€€ô\‹»8†%àÀ»[àX\õY\àúôYô\àõ€ã\ŸX€€ô\ûKò[òX⁄»»ŸX€€ô\ûH€õHYÇàÀ»]	‹»H€€H[›ŸYX›[€ààô\ú⁄[€àŸà\»›[]H€ôBàÀ»€[Xà\ôŸ]⁄[àX›[€àH⁄[ô]ô\àõ›[ô»[ŸHÿ\»[ù\òX›XõBàÀ»
KôÀàõ»€€\]Z\Y
K⁄X⁄\»^X›HHÿ\ŸHH^Y\ÇàÀ»òX⁄[ô»HôYH\»[‹›ZŸ[H»ôH[ãÇà€€ú›€[XêùàHùúÀôö[ô
àOàãòX›[€àOOH	ÿ€[Xóÿúò[ò⁄	 N¬à€€ú›õ€ê€[Xêùú»H€[Xêùà»ùúÀôö[\äàOààOOH€[XêùäHàùúŒ¬à€€ú›ö\ú›Hõ€ê€[XêùúÀôö[ô
àOàãò[›ŸY	âàãú›[HOOH	‹ŸX€€ô\ûI Hõ€ê€[XêùúÀôö[ô
àOàãò[›ŸY
Hõ€ê€[Xêùú÷ÃN¬àYà
ö\ú›
HX›]ôPX›[€àHö\ú›òX›[€é¬àÀ»HŸŸHù]€à\»€[Xö[ô…‹»€õHôX[öYŸŸ\ã€»]	‹»BàÀ»€ôH]⁄›[ö\›X[Hÿ^H€»8†%›ÿ\»»H€[Xãÿ€[XãY›€ÇàÀ»X€€ä€Xô[⁄[HH\ôŸ]	‹»[àôXX⁄òX⁄»»HZ[àŸŸBàÀ»X€€à›\ù⁄\ŸKÇàYà
ŸŸPùäH¬à€€ú›X€€àHŸŸPùãú]Y\ûTŸ[X›‹ä	ÀòXùZX€€â KXô[HŸŸPùãú]Y\ûTŸ[X›‹ä	ÀòXù[Xô[	 N¬àYà
X€€äHX€€ãù^€€ù[ùH€[Xêùà»€[XêùãöX€€àà	¸'‰™	Œ¬àYà
Xô[
HXô[ù^€€ù[ùH€[Xêùà»€[XêùãõXô[à	—ŸŸIŒ¬àBÇàYà
[ôYY‘ôXùZ[
Hô]\õé¬ÇàÀ»‹]€€X›[€ú»úõ€H][K[›€ôY€€ú›[YK‹[ù‹XŸK⁄\ùô\›X›[€úŒ¬àÀ»€[Xóÿúò[ò⁄\»^€YYúõ€H]ô\ûH\ò⁄€›ô[›»õ‹àHÿ[YBàÀ»ôX\€€à]	‹»^€YYúõ€HX›]ôPX›[€àXõ›ôH8†%]›[›^\»[ÇàÀ»Hù[ùú»\úò^H€»H—€‹õ\‹XŸHõ€\ŸY\»€‹ö⁄[ôÀÇà€€ú›\“][Pù]€àHàOàãòX›[€àOOH	ÿ€€ú›[YW⁄[⁄][I»ãòX›[€àOOH	ÿ€€ú›[YWŸõ€Ÿ⁄][I»ãòX›[€àOOH	‹^W⁄[ú›ù[Y[ù	»ãòX›[€ãú›\ù’⁄]
	ÿ[⁄[^WŸõ\⁄◊… HãòX›[€ãú›\ù’⁄]
	‹[ù… BàãòX›[€ãú›\ù’⁄]
	‹XŸW… HãòX›[€ãú›\ù’⁄]
	‹‹]€ó… HãòX›[€àOOH	⁄\ùô\›	Œ¬à€€ú›€€ùú»Hõ€ê€[XêùúÀôö[\äàOàZ\“][Pù]€ääJN¬à€€ú›][Pùú»Hõ€ê€[XêùúÀôö[\ä\“][Pù]€äN¬Çà€€ú›T“◊“—VT»H…—IÀ	‘IÀ	—å…À	—ç	◊N¬Çàù[ò›[€à\PXù
[Yã‹öY⁄[ò[Y
H¬à€€ú›[Hÿ›[Y[ùôŸ][[Y[ùûRY
[Y
N¬àYà
Y[
Hô]\õé¬àYà
XäH»[ò€\‹”\›òY
	ÿXùZY[â N»ô]\õé»Bà[ò€\‹”\›úô[[›ôJ	ÿXùZY[â N¬à[ò€\‹”\›ùŸŸ€J	ÿõÿ⁄ŸY	ÀXãò[›ŸY
N¬à[ô]\Ÿ]òX›[€àHãòX›[€é¬à€€ú›Ÿ^PòYŸHH\—\⁄›‹	âà‹öY⁄[ò[YèH	âà‹öY⁄[ò[YT“◊“—VTÀõ[ô›à»‹[à€\‹œHòXùZŸ^Hèñ…—T“◊“—VT÷€‹öY⁄[ò[Y_WO‹‹[èòà	…Œ¬à€€ú››⁄Y–òYŸHHãú›⁄Y—úòX›[€Çà»‹[à€\‹œHò[€⁄€\›⁄YÀXòYŸHèâÿãú›⁄Y—úòX›[€üO‹‹[èòà	…Œ¬à[ö[õô\íSHŸ^PòYŸH
¬à‹[à€\‹œHòXùZX€€àèâÿãöX€€üI‹›⁄Y–òYŸ_O‹‹[èò
¬à‹[à€\‹œHòXù[Xô[èâÿãõXô[O‹‹[èò¬àYà
Y[óÿXùòY“[ö]
H¬à[óÿXùòY“[ö]HùYN¬à]‹YHù[ÿﬁHÿﬁHH‹€ÿ⁄‘àH¬à]ŸòY»Hò[ŸK‹ù[Y\àHù[‹€ÿ⁄Ÿ]Hù[¬à]ÿ⁄\ôŸQö\ôY€îô\‹»Hò[ŸN¬à]‹ô\‹‘€›Hù[»À»H‹àà⁄[HHŸX\€à€€XX›[€àù]€à\»ZY\ô\‹¬à]‹Ÿ[X›‹í€[Y\àHù[‹Ÿ[X›‹ê\ò”‹[àHò[ŸK‹Ÿ[X›‹í⁄[ôHù[»À»[[[»[ô›[€ú»õ›ô\]Z\ôHH›\›Z[ôY‹öY⁄[ò[[ú][ô€€[Z]€à]»ô[X\ŸKÇà]Ÿõ\⁄—Ÿ\›\ôHHò[ŸKŸõ\⁄–ÿ[òŸ[YHò[ŸN»À»\ŸYûH[ÿö[H€YòYÀ\ô[X\ŸHõ\⁄»Z[Z[ôÀÇà€€ú›êQ◊’ëT“HL¬àÀ»YÿXﬁHôZ]ö[‹éà€[ô ŸòYŸ⁄[ô»[àX›[€àù]€àZŸHH›X⁄»\ŸY¬àÀ»ŸY\ôKYö\ö[ô»HX›[€à]ô\ûHLå\»õ‹à\»€ô»\»]›^YY\⁄YŸôÇàÀ»Ÿ[ù\ãà\ÿXõY\à\⁄Y€à
H⁄[ô€H[[YYX]Hö\ôK[€ã]ô\⁄€X‹õ‹‹¬àÀ»ô[›»›[\[ú H8†%Ÿ\\ôKõ›[]Y[àÿ\ŸH]	‹»ÿ[ùYòX⁄ÀÇà€€ú›Pï—êQ◊‘ëTPU—íTëHHò[ŸN¬à€€ú›‹›X⁄»Hÿ›[Y[ùôŸ][[Y[ùûRY
	ÿX›[€î›X⁄… N¬Çàù[ò›[€àÿXùö\ôJ
H¬à€€ú›X›H[ô]\Ÿ]òX›[€é¬àYà
XX›[ò€\‹”\›ò€€ùZ[ú 	ÿXùZY[â JHô]\õé¬àX›]ôPX›[€àHX›¬àÀ»ò]öYÿ][€ã⁄[ù\òX›[€àX›[€ú»[ÿ^\»ö\ôN»€€X›[€ú»ô\‹X››⁄[ô»€€€›€ãÇàÀ»ö\⁄‹ö[X\ûKŸö\⁄ÿÿ[òŸ[û\\‹»]€»8†%‹X\ôö\⁄[ô»\»ô]ô\ÇàÀ»\ŸYH›⁄[ôÀ][Y\àﬁ\›[H
ŸYHö\ôQö\⁄[ô–úöYŸI‹»›€àõ›H€ÇàÀ»\ K€»ÿ][ô»H\ò»ù]€àôZ[ô]\ôH€›[ù\›YX[ÇàÀ»H›ò^HYù›ô\à€€›⁄[ô’úõ€H⁄]]ô\àÿ\»\]Z\YôYõ‹ôBàÀ»›⁄]⁄[ô»»H\ú€€à€›[⁄[[ùHX]H\à€[Xà\»BàÀ»ÿ[YH›‹ûNà]	‹»\ôHò]ô\úÿ[õ›H€€›⁄[ôÀ€»HYù›ô\ÇàÀ»€€›⁄[ô’úõ€H⁄]]ô\àÿ\»\]Z\YôYõ‹ôHÿ[⁄[ô»\»BàÀ»€Yôà⁄›[â›ôHXõH»X]H\Z]\ãÇà€€ú›\”ò]êX›[€àHX›OOHú—X[Ÿ›YPX›[€ä
HX›OOH€Z]PX›[€ä
HX›OOHŸ[ô\ò[›‹ôPX›[€ä
HX›OOHÿ\ú[ù\êX›[€ä
HX›OOH	€ú◊€Ÿôô\óÿ[€⁄€‹›⁄Y…»X›OOH	€ú◊€Ÿôô\óŸ⁄Yù	»X›OOH	€ú◊€‹[ó›ÿ\ôõÿôI»X›OOH	›\ŸW‹‹›	»X›OOH	€ÿöóŸ^]⁄›\ŸI»X›OOH	ÿ€[Xâ»X›ú›\ù’⁄]
	€ÿöó… HX›ú›\ù’⁄]
	Ÿö\⁄… N¬àÀ»ÿ[YHôX\€€ö[ô»YÿZ[àõ‹à]ô\ûH][K[[ŸHX›[€à
XŸWÿÿ[\ö\ôW⁄⁄]àÀ»€€ú›[YWŸõ€Ÿ⁄][K[ù ã[⁄[^WŸõ\⁄◊ ãããäNàõ€ôHŸà[H\ôBàÀ»€€›⁄[ô‹»Z]\ã€»HYù›ô\à€€›⁄[ô’úõ€H⁄]]ô\à€€ÿ\¬àÀ»›]ôYõ‹ôH›⁄]⁄[ô»»][H[ŸH8†%⁄X⁄\]U€€Y\⁄ô]ô\ÇàÀ»Xÿ^\»⁄[H[[ŸHOOH	⁄][I»
]X\õK\ô]\õú»ôYõ‹ôHôXX⁄[ô¬àÀ»]Ÿ⁄X H8†%€›[›\ù⁄\ŸH⁄[[ùHX]]ô\ûH][K[[ŸH\€ÇàÀ»[ÿö[H[ù[H^Y\à›⁄]⁄YòX⁄»»H€€[ô]H›[BàÀ»[Y\àù[à›]à\⁄›‹	‹»\ôX›⁄[ù\ô›€∏°§ù\ŸPX›]ôPX›[€ä
H€X⁄¬àÀ»]ô]ô\àY\»ÿ]H][⁄X⁄\»⁄H\»€õH]ô\ÇàÀ»›\ôòXŸY\»ùHù]€àŸ\€â›€‹ö»à€à›X⁄ÇàYà
\”ò]êX›[€à[[ŸHOOH	⁄][I»€€›⁄[ô’H
H\ŸPX›]ôPX›[€ä
N¬àBÇàÀ»ŸX\€à€€XX›[€àù]€ú»
›]‹€\⁄
Hõ›]H\»õ›Y⁄BàÀ»ÿY›]	‹»Xö[]H€›»[ú›XYŸàö\ö[ô»H›⁄[ô»\ôX›H8†%àÀ»]ô\ûH›\àù]€àŸY\»\⁄[ô»ÿXùö\ôJ
H[ò⁄[ôŸYÇàù[ò›[€à›ŸX\€î€›õ‹äX›
H¬àYà
X›]ôU€€OOH	›ŸX\€â»]⁄[ô›Àê€€Xò]Àö[ú]
Hô]\õàù[¬àYà
X›OOH€€X›[€úÀùŸX\€ñÃJHô]\õàN¬àYà
X›OOH€€X›[€úÀùŸX\€ñÃWJHô]\õàé¬àô]\õàù[¬àBàù[ò›[€à‹ô\€€ôQö\ôJ
H¬à€€ú›€›H›ŸX\€î€›õ‹ä[ô]\Ÿ]òX›[€äN¬àYà
€›
H»⁄[ô›Àê€€Xò]ö[ú]ôö\ôU\
€›
N»ô]\õé»BàÿXùö\ôJ
N¬àBÇà[òY]ô[ù\›[ô\ä	‹⁄[ù\ô›€âÀ]àOà¬àYà
‹YOOHù[
Hô]\õé¬à‹YH]ãú⁄[ù\íY¬àÀ»ŸYH[ôRõﬁ\›X⁄‘⁄[ù\ë›€â‹»€€[Y[ùÇàûH»[úŸ]⁄[ù\êÿ\\ôJ]ãú⁄[ù\íY
N»Hÿ]⁄
\úäH» àY‹òYH‹òXŸYù[H
ã»Bà€€ú›ôX›H[ôŸ]õ›[ô[ô–€Y[ùôX›

N¬àÿﬁHôX›õYù
»ôX›ù⁄Y»é¬àÿﬁHHôX›ù‹
»ôX›öZY⁄»é¬à‹€ÿ⁄‘àHôX›ù⁄Y
àçÃ¬àŸòY»Hò[ŸN¬à‹€ÿ⁄Ÿ]Hÿ›[Y[ùò‹ôX]Q[[Y[ù
	Ÿ]â N¬à‹€ÿ⁄Ÿ]ò€\‹”ò[YHH	ÿXù\€ÿ⁄Ÿ]	Œ¬à‹€ÿ⁄Ÿ]ú›[KõYùHÿﬁ
»	‹	Œ¬à‹€ÿ⁄Ÿ]ú›[Kù‹HÿﬁH
»	‹	Œ¬à‹€ÿ⁄Ÿ]ú›[Kù⁄YH
ôX›ù⁄Y
àãåäH
»	‹	Œ¬à‹€ÿ⁄Ÿ]ú›[KöZY⁄H
ôX›ù⁄Y
àãåäH
»	‹	Œ¬àÿ›[Y[ùòõŸKò\[ô⁄[
‹€ÿ⁄Ÿ]
N¬à[ú›[Kùò[ú⁄][€àH	€õ€ôIŒ¬à]ãúô]ô[ùYò][

N¬àÀ»€]ÀYYÀŸö[]\››\ù€àô\‹»
õ›ô[X\ŸJH€»H⁄\ôŸBàÀ»ÿ[àù[àõ‹à]»ù[\ò][€à⁄[HHù]€à›^\»[Çà€€ú›X›H[ô]\Ÿ]òX›[€é¬àÀ»€€ù[ù[›\»€‹õ[ù\òX›[€ú»\ŸHHÿ[YHô\‹À][YHŸ[X›YàÀ»X›[€à€€ùòX›\»ô[ö⁄\úòHô\›À€»Z\àúò[YH[Y\ú»ÿ[ÇàÀ»ôY⁄[à[[YYX][H[ú›XYŸàÿZ][ô»õ‹à⁄[ù\àô[X\ŸKÇàYà
X›OOH	€ô\››ZŸI»X›OOH	ÿò[ô]›[ù⁄[ù\òX›	 HX›]ôPX›[€àHX›¬àŸõ\⁄—Ÿ\›\ôHHX›OOH	ÿ[⁄[^WŸõ\⁄◊‹ö[X\ûIŒ¬àŸõ\⁄–ÿ[òŸ[YHò[ŸN¬àYà
Ÿõ\⁄—Ÿ\›\ôH	âà]⁄[ô›Àê[⁄[^Qõ\⁄‹œÀòZ[Z[ô HÿXùö\ôJ
N»À»[ÿö[Hô\‹»[ù\ú»Z[H⁄]›]€€ú›[Z[ôÀÇàYà
X›OOH	ÿ[[[◊‹Ÿ[X›	»X›OOH	‹›[€ó‹Ÿ[X›	 H¬à‹Ÿ[X›‹í⁄[ôHX›OOH	ÿ[[[◊‹Ÿ[X›	»»	ÿ[[[…»à	‹›[€ú…Œ¬à⁄[ô›ÀóŸ\⁄›‹Ÿ[X›[€ê\òœÀòôY⁄[í[Ÿ[X›[€èÀä‹Ÿ[X›‹í⁄[ô
N»À»]»H\⁄Xÿ[[›\ŸH⁄Y[ò]öYÿ]H⁄[H\»€ã\ÿ‹ôY[àù]€à›€ú»H€Çà‹Ÿ[X›‹ê\ò”‹[àHùYN»À»\ŸHX›[€ú»]ôHõ»\ôZ]ö[‹à»ô\Ÿ\ùôK€»⁄›»Z\à⁄⁄XŸ\»\»€€€à\»H[[ú]ôY⁄[úÀÇàYà
‹Ÿ[X›‹í⁄[ôOOH	ÿ[[[… H⁄[ô›ÀóŸ\⁄›‹Ÿ[X›[€ê\òœÀõ‹[ê[[[ 
N¬à[ŸH⁄[ô›ÀóŸ\⁄›‹Ÿ[X›[€ê\òœÀõ‹[î›[€ú 
N¬àBàÿ⁄\ôŸQö\ôY€îô\‹»Hõ€€X[äX›	âàY[ò€\‹”\›ò€€ùZ[ú 	ÿXùZY[â H	âà€›[›\ù⁄\ôŸJX›]ôU€€X›
JN¬àYà
ÿ⁄\ôŸQö\ôY€îô\‹ H¬àX›]ôPX›[€àHX›¬àX›[€í[›€àHùYN¬àÿXùö\ôJ
N¬àH[ŸH¬àX›[€í[›€àHùYN¬à‹ô\‹‘€›H›ŸX\€î€›õ‹äX›
N¬àYà
‹ô\‹‘€›
H»ûP]]—[ôÿYŸSY[YU\ôŸ]

N»⁄[ô›Àê€€Xò]ö[ú]úô\‹‘›\ù
‹ô\‹‘€›
N»BàBàJN¬Çà[òY]ô[ù\›[ô\ä	‹⁄[ù\õ[›ôIÀ]àOà¬àYà
]ãú⁄[ù\íYOOH‹Y
Hô]\õé¬à€€ú›H]ãò€Y[ùHÿﬁHH]ãò€Y[ùHHÿﬁN¬à€€ú›\›HX]ö\›
JN¬à€€ú›àHX]õZ[ä\›‹€ÿ⁄‘äN¬à€€ú›ûH\›àçH»»\›
ààà¬à€€ú›ûHH\›àçH»H»\›
ààà¬à[ú›[Kùò[úŸõ‹õHHò[ú€]Jÿ[ L	H
»	€û\
Kÿ[ L	H
»	€û_\
JX¬àYà
Ÿõ\⁄—Ÿ\›\ôH	âà⁄[ô›Àê[⁄[^Qõ\⁄‹œÀòZ[Z[ô H¬à⁄[ô›Àê[⁄[^Qõ\⁄‹ÀúŸ]\ôŸ]úõ€UôX›‹äKX]õZ[äK\›»X]õX^
K‹€ÿ⁄‘äJJN¬à€€ú›ÿ[òŸ[ù]€àHÀããôÿ›[Y[ùú]Y\ûTŸ[X›‹ê[
	÷Ÿ]KXX›[€èHò[⁄[^WŸõ\⁄◊ÿÿ[òŸ[óI WVÃN»À»›\úô[ù][HX›[€ààÿ[òŸ[ôY⁄[€ãÇà€€ú›ÿ[òŸ[ôX›Hÿ[òŸ[ù]€èÀôŸ]õ›[ô[ô–€Y[ùôX›

N»À»\ŸYõ‹à€€ù[ù[›\»òYÀ[›ô\àÿ[òŸ[][€ãÇàYà
ÿ[òŸ[ôX›	âà]ãò€Y[ùèHÿ[òŸ[ôX›õYù	âà]ãò€Y[ùHÿ[òŸ[ôX›úöY⁄	âà]ãò€Y[ùHèHÿ[òŸ[ôX›ù‹	âà]ãò€Y[ùHHÿ[òŸ[ôX›òõ›€JH¬àÿ[òŸ[ù]€ãò€\‹”\›òY
	Ÿõ\⁄ÀXÿ[òŸ[Z›ô\â N¬à⁄[ô›Àê[⁄[^Qõ\⁄‹Àòÿ[òŸ[Z[J
N¬àŸõ\⁄–ÿ[òŸ[YHùYN¬àBàô]\õé¬àBàYà
‹Ÿ[X›‹í⁄[ô
H¬àYà
‹Ÿ[X›‹ê\ò”‹[äH⁄[ô›ÀóŸ\⁄›‹Ÿ[X›[€ê\òœÀõ[›ôT⁄[ù\ä]ãò€Y[ù]ãò€Y[ùJN¬àô]\õé¬àBàÀ»⁄]HŸX\€à\]Z\YX›[€àù]€ú»\ôH\⁄€€õH8†%òYŸ⁄[ô¬àÀ»]\›ô]ô\àX›ZŸHH\ôX›[€ò[›X⁄À›\ù⁄\ŸHH[Xà€ÿòõ[ô¬àÀ»ZYZ€ôXY»\»[àZ[KYòYÀÿ[òŸ[»H[ô[ô»€Xö[]K[ôàÀ»ö\ô\»H\[ú›XYàò\õH€€»›[\ŸHòYÀ]ÀXZ[H\»ôYõ‹ôKÇàYà
X›]ôU€€OOH	›ŸX\€â Hô]\õé¬àYà
\›àêQ◊’ëT“
H¬à€€ú›[ô»HX]ò][åäK
N¬àòX⁄[ô–[ô€HH[ôŒ¬à\›[›ôP[ô€HH[ôŒ¬à^Y\ãò[ô€HH[ôŒ¬àÀ»X›X[Hô]\ôŸ]Hô]X€H
Ÿ]ô]X€U[J
HôXY¬àÀ»\ôŸ]Z[P[ô€Kõ›òX⁄[ô–[ô€K‹^Y\ãò[ô€H8†%ŸYH]¬àÀ»X€\ò][€äH€»\»òY»Ÿ[ùZ[ô[HZ[\»ò\õK]€€X›[€ú¬àÀ»ZŸH^H⁄‹»X⁄»Z[ôH]H‹X⁄YöX»[H€à[ÿö[KàÀ»[ú›XYŸà€õHõ›][ô»H^Y\â‹»ö\›X[òX⁄[ô»⁄[BàÀ»Hô]X€H›^\»⁄\ô]ô\àH[›ô[Y[ùõﬁ\›X⁄»\›àÀ»⁄[ùY]Çà\ôŸ]Z[P[ô€HH[ôŒ¬àYà
WŸòY H¬àŸòY»HùYN¬à‹›X⁄Àò€\‹”\›òY
	ŸòYÀXX›]ôI N¬àÀ»Z[Z[ô»ZŸ\»›ô\àö\ö[ô»úõ€H\ôH8†%\ÿ\õHH\⁄€àÀ»[Y\à€»ô[X\ŸHŸ\€â›[€»ö\ôKŸ[ô[àXö[]KÇàYà
‹ô\‹‘€›
H»⁄[ô›Àê€€Xò]ö[ú]òÿ[òŸ[ô\‹ ‹ô\‹‘€›
N»‹ô\‹‘€›Hù[»Bà‹ô\€€ôQö\ôJ
N¬àYà
Pï—êQ◊‘ëTPU—íTëJH‹ù[Y\àHŸ][ù\ùò[
‹ô\€€ôQö\ôKLå
N¬àBàBàJN¬Çàù[ò›[€àÿXù\
]äH¬àYà
]ãú⁄[ù\íYOOH‹Y
Hô]\õé¬à‹YHù[¬àX›[€í[›€àHò[ŸN¬àYà
‹Ÿ[X›‹í€[Y\äH»€X\ï[Y[›]
‹Ÿ[X›‹í€[Y\äN»‹Ÿ[X›‹í€[Y\àHù[»BàYà
‹ù[Y\äH»€X\í[ù\ùò[
‹ù[Y\äN»‹ù[Y\àHù[»Bà‹›X⁄Àò€\‹”\›úô[[›ôJ	ŸòYÀXX›]ôI N¬àYà
‹€ÿ⁄Ÿ]
H»‹€ÿ⁄Ÿ]úô[[›ôJ
N»‹€ÿ⁄Ÿ]Hù[»Bà[ú›[Kùò[ú⁄][€àH	›ò[úŸõ‹õHåM»X\ŸK[›]	Œ¬à[ú›[Kùò[úŸõ‹õHH	›ò[ú€]JL	KL	JIŒ¬àŸ][Y[›]


HOà»[ú›[Kùò[ú⁄][€àH	…Œ»[ú›[Kùò[úŸõ‹õHH	…Œ»KML
N¬àYà
‹Ÿ[X›‹í⁄[ô
H¬àYà
‹Ÿ[X›‹ê\ò”‹[äH¬àYà
]ãù\HOOH	‹⁄[ù\òÿ[òŸ[	 H⁄[ô›ÀóŸ\⁄›‹Ÿ[X›[€ê\òœÀò€‹ŸJ
N¬à[ŸH⁄[ô›ÀóŸ\⁄›‹Ÿ[X›[€ê\òœÀúô[X\ŸTŸ[X›[€ä
N¬àBàH[ŸHYà
Ÿõ\⁄—Ÿ\›\ôJH¬àYà
WŸõ\⁄–ÿ[òŸ[Y	âà⁄[ô›Àê[⁄[^Qõ\⁄‹œÀòZ[Z[ô H⁄[ô›Àê[⁄[^Qõ\⁄‹Àò€€ôö\õUõ› 
N¬àH[ŸHYà
WŸòY»	âàWÿ⁄\ôŸQö\ôY€îô\‹ H¬àYà
‹ô\‹‘€›
H⁄[ô›Àê€€Xò]ö[ú]úô\‹—[ô
‹ô\‹‘€›
N¬à[ŸHÿXùö\ôJ
N¬àBàŸòY»Hò[ŸN¬àÿ⁄\ôŸQö\ôY€îô\‹»Hò[ŸN¬à‹Ÿ[X›‹ê\ò”‹[àHò[ŸN¬àYà
‹Ÿ[X›‹í⁄[ô
H⁄[ô›ÀóŸ\⁄›‹Ÿ[X›[€ê\òœÀô[ô[Ÿ[X›[€èÀä
N¬à‹Ÿ[X›‹í⁄[ôHù[¬àÿ›[Y[ùú]Y\ûTŸ[X›‹ê[
	Àôõ\⁄ÀXÿ[òŸ[Z›ô\â Kôõ‹ëXX⁄
ù]€àOàù]€ãò€\‹”\›úô[[›ôJ	Ÿõ\⁄ÀXÿ[òŸ[Z›ô\â JN¬àŸõ\⁄—Ÿ\›\ôHHò[ŸN¬àŸõ\⁄–ÿ[òŸ[YHò[ŸN¬à‹ô\‹‘€›Hù[¬àBÇà[òY]ô[ù\›[ô\ä	‹⁄[ù\ù\	ÀÿXù\
N¬à[òY]ô[ù\›[ô\ä	‹⁄[ù\òÿ[òŸ[	ÀÿXù\
N¬àBàBÇàYà
[[ŸHOOH	⁄][I H¬àÀ»][H[ŸNà[X›[€ú»‹ôXYX‹õ‹‹»[H\ò⁄‹⁄][€ú¬àÀ»
€[Xóÿúò[ò⁄^€YY8†%ŸYHõ€ê€[Xêùú»Xõ›ôJBà\PXù
	ÿùêX›[€åIÀõ€ê€[Xêùú÷ÃKùúÀö[ô^Ÿäõ€ê€[Xêùú÷ÃJJN¬à\PXù
	ÿùêX›[€åâÀõ€ê€[Xêùú÷ÃWKùúÀö[ô^Ÿäõ€ê€[Xêùú÷ÃWJJN¬à\PXù
	ÿùêX›[€å…Àõ€ê€[Xêùú÷ÃóKùúÀö[ô^Ÿäõ€ê€[Xêùú÷ÃóJJN¬à\PXù
	ÿùí][PX›[€åIÀõ€ê€[Xêùú÷Ã◊KùúÀö[ô^Ÿäõ€ê€[Xêùú÷Ã◊JJN¬à\PXù
	ÿùí][PX›[€åâÀõ€ê€[Xêùú÷ÕKùúÀö[ô^Ÿäõ€ê€[Xêùú÷ÕJJN¬àH[ŸH¬à\PXù
	ÿùêX›[€åIÀ€€ùú÷ÃKùúÀö[ô^Ÿä€€ùú÷ÃJJN¬à\PXù
	ÿùêX›[€åâÀ€€ùú÷ÃWKùúÀö[ô^Ÿä€€ùú÷ÃWJJN¬à\PXù
	ÿùêX›[€å…À€€ùú÷ÃóKùúÀö[ô^Ÿä€€ùú÷ÃóJJN¬à\PXù
	ÿùí][PX›[€åIÀ][Pùú÷ÃKùúÀö[ô^Ÿä][Pùú÷ÃJJN¬à\PXù
	ÿùí][PX›[€åâÀ][Pùú÷ÃWKùúÀö[ô^Ÿä][Pùú÷ÃWJJN¬àBÇàYà
\—\⁄›‹
HôYúô\⁄Ÿ^RY
ùú N¬àBÇàù[ò›[€àôYúô\⁄Ÿ^RY
ùú H¬àYà
ZŸ^RY[
Hô]\õé¬à€€ú›][HHŸ]X›]ôR[ùô[ù‹ûR][J
N¬à€€ú›ô]X€HHŸ]ô]X€U[J
N¬à€€ú›[HH‹öY‹ô]X€Kúõ›◊V‹ô]X€Kò€€N¬à€€ú›ÿöàHŸ]€‹õÿöôX›]
ô]X€Kò€€ô]X€Kúõ› N¬Çà€€ú›\ù»H◊N¬ÇàÀ»€€à€€ú›Ÿ\R][HH\]Z\Y[ù€›÷ÿX›]ôU€€N¬à€€ú›Ÿ\QYàHŸ\R][H»””“USW—Qî÷◊Ÿ\R][WHàù[¬à€€ú›⁄⁄ò[òX⁄»H
»⁄›ô[ñ…¯¶„˚Ó#…À	‘⁄›ô[	◊KŸNñ…¸'Í§…À	“ŸI◊K^Nñ…¸'Í§…À	–^I◊KX⁄Œñ…¯¶„˚Ó#…À	‘X⁄…◊K\ú€€éñ…¸'„®…À	“\ú€€â◊KŸX\€éñ…¸'ÂË{Ó#…À	’ŸX\€â◊KXX⁄]Nñ…¸'ÂË{Ó#…À	’ŸX\€â◊HVÿX›]ôU€€H…¸'Â)…ÀX›]ôU€€JN¬à€€ú›€€[ôõ»H›€€Ÿ[X›X€€íS
Ÿ\QYã⁄⁄ò[òX⁄÷ÃK	ÃL‹	 KŸ\QYèÀõXô[⁄⁄ò[òX⁄÷ÃWWN¬à\ùÀú\⁄
]à€\‹œHö⁄Y‹õ›\èè‹[à€\‹œHö⁄ZŸ^HèåKÃãÃœ‹‹[èè‹[à€\‹œHö⁄]€€èâ›€€[ôõ÷Ã_H	›€€[ôõ÷ÃW_O‹‹[èèŸ]èò
N¬à\ùÀú\⁄
	œ]à€\‹œHö⁄Y]àèèŸ]èâ N¬ÇàÀ»X›[€àù]€ú»8°§àŸ^Hõ€\Œàö\ú›H‘‹XŸK—WKŸX€€ôH‘WBàùúÀôõ‹ëXX⁄

ãY
HOà¬à€€ú›Ÿ^SXô[HYOOH»	—I»àYOOHH»	‘I»àâ⁄YX¬à€€ú›õÿ⁄ŸYHXãò[›ŸY¬à\ùÀú\⁄
à]à€\‹œHö⁄Y‹õ›\èò
¬à‹[à€\‹œHö⁄ZŸ^Iÿõÿ⁄ŸY»	»à›[OHõ‹X⁄]NååÕI»à	…ﬂHèâ⁄Ÿ^SXô[O‹‹[èò
¬à‹[à€\‹œHö⁄XX›[€à	ÿãú›[_Iÿõÿ⁄ŸY»	»õÿ⁄ŸY	»à	…ﬂHèâÿãöX€€üH	ÿãõXô[O‹‹[èò
¬àŸ]èòà
N¬àJN¬Çà\ùÀú\⁄
	œ]à€\‹œHö⁄Y]àèèŸ]èâ N¬ÇàÀ»][Hÿ‹õ€àYà
][JH¬à€€ú›€›[ùH[ùô[ù‹ûV⁄][KöŸ^WH¬à\ùÀú\⁄
à]à€\‹œHö⁄Y‹õ›\èò
¬à‹[à€\‹œHö⁄ZŸ^Hèã‹‹[èè‹[à€\‹œHö⁄[Xô[èà‹‹[èò
¬à‹[à€\‹œHö⁄Z][Hèè‹[à€\‹œHö⁄Z][KZX€€àèâ⁄][KöX€€üO‹‹[èà	⁄][KõXô[H0Â…ÿ€›[ùO‹‹[èò
¬à‹[à€\‹œHö⁄[Xô[èà‹‹[èè‹[à€\‹œHö⁄ZŸ^Hèãè‹‹[èò
¬àŸ]èòà
N¬àBÇà\ùÀú\⁄
	œ]à€\‹œHö⁄Y]àèèŸ]èâ N¬ÇàÀ»[H[ôõ¬à€€ú›[T›[HH[T›[\÷›[Kù\WH[T›[\Àô‹ò\‹Œ¬à€€ú›ÿ]\î›HX]úõ›[ô

[Kùÿ]\à»PV’–UTäH
àL
N¬à\ùÀú\⁄
à]à€\‹œHö⁄Y‹õ›\èò
¬à‹[à€\‹œHö⁄[Xô[èâ›[T›[KõXô[X
¬à
ÿöà»0≠»	€ÿöãõXô[Xà	… H
¬à0≠»<'‰©…›ÿ]\î›IO‹‹[èò
¬àŸ]èòà
N¬Çà\ùÀú\⁄
	œ]à€\‹œHö⁄Y]àèèŸ]èâ N¬à\ùÀú\⁄
	œ]à€\‹œHö⁄Y‹õ›\èè‹[à€\‹œHö⁄ZŸ^Hèë\ÿœ‹‹[èè‹[à€\‹œHö⁄[Xô[èìY[ùO‹‹[èèŸ]èâ N¬ÇàŸ^RY[ö[õô\íSH\ùÀöõ⁄[ä	… N¬àYà
][JH¬à\R][T‹ö]RX€€äŸ^RY[ú]Y\ûTŸ[X›‹ä	Àö⁄Z][KZX€€â KUSW—Qî÷⁄][KöŸ^WK][KöŸ^JN¬àBàBÇàù[ò›[€à€€ù^X[X›[€ìXô[
X›[€ã[JH¬àYà
X›[€àOOH	ŸY… Hô]\õà[Kù\HOOH[U\KïëSê“»	‘ôYY…»à	—Y…Œ¬àYà
X›[€àOOH	Ÿö[	 Hô]\õà	—ö[	Œ¬àYà
X›[€àOOH	‹òZ\ŸI Hô]\õà[Kù\HOOH[U\KîêRT—Q»	”›Ÿ\â»à	‘òZ\ŸIŒ¬àYà
X›[€àOOH	›[	 Hô]\õà[Kù\HOOH[U\KïSQ»	’[ù[	»à	’[	Œ¬àYà
X›[€àOOH	‹€[€›	 Hô]\õà	‘€[€›	Œ¬àYà
X›[€àOOH	ÿ›]	 Hô]\õà	–›]	Œ¬àYà
X›[€àOOH	‹€\⁄	 Hô]\õà	‘€\⁄Â…Œ¬àYà
X›[€àOOH	ÿ⁄‹	 Hô]\õà	–⁄‹	Œ¬àYà
X›[€àOOH	⁄X⁄… Hô]\õà	“X⁄»Â…Œ¬àYà
X›[€àOOH	€Z[ôI Hô]\õà	”Z[ôIŒ¬àYà
X›[€àOOH	⁄\ùô\›	 Hô]\õà[Kò‹õ‹ôXYH»	¯ß$»\ùô\›	»à	—‹õ›⁄[ô…Œ¬àYà
X›[€àOOH	Ÿö\⁄	 Hô]\õà	—ö\⁄	Œ¬àYà
X›[€àOOH	‹⁄€›	 Hô]\õà⁄[ô›Àîò[ôŸYŸX\€úœÀú^Y\êX›[€ìXô[Àä\]Z\Y[ù€›Àúò[ôŸY
H	—ö\ôIŒ¬àYà
X›[€àOOH	ÿ[[[◊‹Ÿ[X›	 Hô]\õà⁄[ô›Àîò[ôŸYŸX\€úœÀò[[[–X›[€ìXô[Àä\]Z\Y[ù€›Àúò[ôŸY
H	–ò\⁄X»[[[…Œ¬àYà
X›[€àOOH	‹›[€ó‹Ÿ[X›	 Hô]\õà	‘›[€ú…Œ¬àYà
X›[€ãú›\ù’⁄]
	‹XŸW… JHô]\õà	‘XŸIŒ¬àYà
X›[€ãú›\ù’⁄]
	€ÿöó‹õÿŸ\‹◊… JHô]\õà	‘õÿŸ\‹…Œ¬àô]\õàX›[€é¬àBÇàÀ»8• 8• ][Hÿ‹õ€8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• à]€\›][Tÿ‹õ€Ÿ^HHù[¬àù[ò›[€àôYúô\⁄][Tÿ‹õ€
›X⁄‹»HŸ][ùô[ù‹ûT›X⁄“][\ 
JH¬à€€ú›àH›X⁄‹Àõ[ô›¬à€€ú›Pùë[H][Pùë[¬àYà
àOOH
H¬àYà
€\›][Tÿ‹õ€Ÿ^HOOH	Ÿ[\I Hô]\õé¬à€\›][Tÿ‹õ€Ÿ^HH	Ÿ[\IŒ¬à][RX€€ãù^€€ù[ùH	¯•®IŒ¬à][Sò[YKù^€€ù[ùH	—STIŒ¬à][P€›[ùù^€€ù[ùH	ÂÃ	Œ¬à][P€›[ùò€\‹”ò[YHH	⁄\ÀX€›[ù[\IŒ¬àYà
Pùë[
HPùë[ù^€€ù[ùH	¯•®IŒ¬à€€ú›ô]ë[H\‘ô]íX€€ë[¬à€€ú›ô^[H\”ô^X€€ë[¬à€X\í][T‹ö]RX€€ä][RX€€äN¬à€X\í][T‹ö]RX€€äPùë[
N¬àYà
ô]ë[
Hô]ë[ù^€€ù[ùH	¯•®IŒ¬àYà
ô^[
Hô^[ù^€€ù[ùH	¯•®IŒ¬à€X\í][T‹ö]RX€€äô]ë[
N¬à€X\í][T‹ö]RX€€äô^[
N¬àô]\õé¬àBàYà
X›]ôR][R[ô^èHäHX›]ôR][R[ô^H¬àYà
X›]ôR][R[ô^
HX›]ôR][R[ô^HàHN¬à€€ú››\úàH›X⁄‹÷ÿX›]ôR][R[ô^N¬à€€ú›ô]àH›X⁄‹÷ X›]ôR][R[ô^HH
»äH	HóN¬à€€ú›ô^H›X⁄‹÷ X›]ôR][R[ô^
»JH	HóN¬à€€ú›€›[ùH[ùô[ù‹ûVÿ›\úãöŸ^WH¬à€€ú›Ÿ^HH	ÿ›\úãöŸ^_Nâÿ€›[ùNâ‹ô]ãöŸ^_Nâ€ô^öŸ^_X¬àYà
Ÿ^HOOH€\›][Tÿ‹õ€Ÿ^JHô]\õé¬à€\›][Tÿ‹õ€Ÿ^HHŸ^N¬àÀ»›\úô[ù][Bà][RX€€ãù^€€ù[ùH›\úãöX€€é¬à][Sò[YKù^€€ù[ùH›\úãõXô[¬àYà
Pùë[
HPùë[ù^€€ù[ùH›\úãöX€€é¬à\R][T‹ö]RX€€ä][RX€€ãUSW—Qî÷ÿ›\úãöŸ^WK›\úãöŸ^JN¬à\R][T‹ö]RX€€äPùë[USW—Qî÷ÿ›\úãöŸ^WK›\úãöŸ^JN¬à][P€›[ùù^€€ù[ùH0Â…ÿ€›[ùX¬à][P€›[ùò€\‹”ò[YHH	⁄\ÀX€›[ù	»
»
€›[ùOOH»	»[\I»à	… N¬àÀ»YZ»X€€ú»
ô]ã€ô^ô]öY]‹ Bà€€ú›ô]ë[H\‘ô]íX€€ë[¬à€€ú›ô^[H\”ô^X€€ë[¬àYà
ô]ë[
H¬àô]ë[ù^€€ù[ùHô]ãöX€€é¬à\R][T‹ö]RX€€äô]ë[USW—Qî÷‹ô]ãöŸ^WKô]ãöŸ^JN¬àBàYà
ô^[
H¬àô^[ù^€€ù[ùHô^öX€€é¬à\R][T‹ö]RX€€äô^[USW—Qî÷€ô^öŸ^WKô^öŸ^JN¬àBàBà][Tô]ãòY]ô[ù\›[ô\ä	ÿ€X⁄…À

HOà¬àﬁX€PX›]ôR[ùô[ù‹ûR][JLJN¬àôYúô\⁄][Tÿ‹õ€

N¬àôYúô\⁄X›[€êò\ä
N¬àJN¬à][Sô^òY]ô[ù\›[ô\ä	ÿ€X⁄…À

HOà¬àﬁX€PX›]ôR[ùô[ù‹ûR][JJN¬àôYúô\⁄][Tÿ‹õ€

N¬àôYúô\⁄X›[€êò\ä
N¬àJN¬ÇàÀ»›]\À\[öY[»€õHX›X[H⁄[ôŸHHô]»[Y\»H
ôX[
HŸX€€ôàÀ»][‹›
ŸX\€€ã›ŸX]\ãŸ^KŸ€€€à€‹õ\›]H]ô[ùÀ[YH€òŸHBàÀ»⁄[][]YZ[ù]K€€›[K›ÿ]\à€àô]X€H‹à\]Z\⁄[ôŸ\ H8†%àÀ»\]RYù[ú»]ô\ûHúò[YK€»XX⁄öY[ÿX⁄\»]»\›]‹ö][ÇàÀ»›ö[ôÀÿ€€‹à[ô⁄⁄\»H”H‹ö]H
[ôõ‹à‹[K‹‹ÿ]\ãàÀ»H›ö[ôÀXùZ[[ô H⁄[àõ›[ô»⁄[ôŸYÇà€€ú›⁄YH»ŸX\€€éàù[ŸX]\éàù[[YNàù[^Nàù[€€àù[[Nàù[ÿ]\ï^àù[ÿ]\ê€€‹éàù[€€àù[][Nàù[N¬Çàù[ò›[€à\]RY

H¬à€€ú›ŸX\€€àH⁄[ô›Àêÿ[[ô\îﬁ\›[Kò›\úô[ùŸX\€€ä
N¬à€€ú›€ÿ⁄»Hõ‹õX]€ÿ⁄ ⁄[ô›Àêÿ[[ô\îﬁ\›[KôŸ]›\ä
JN¬ÇàÀ»ŸX\€€à
⁄[ôŸ\»€›€JBà€€ú›ŸX\€€ï^HŸX\€€ãô[[⁄öH
»	»	»
»ŸX\€€ãõò[YN¬àYà
ŸX\€€ï^OOH⁄YúŸX\€€äH»⁄YúŸX\€€àHŸX\€€ï^»‹ŸX\€€ãù^€€ù[ùHŸX\€€ï^»BÇàÀ»›\úô[ùŸX]\à
»ôX⁄\]][€àò]Bà]ŸX]\ï^ôX⁄\^¬àYà
ÿ[[ô\ãö\‘òZ[ö[ô H¬à€€ú››àHÿ[[ô\ãúòZ[î›ô[ô›¬àYà
›àèH H¬àŸX]\ï^H	¯¶‚;Ó#»›‹õIŒ¬àôX⁄\^H	¯´!˚Ó#»X]ûIŒ¬àH[ŸH¬àŸX]\ï^H	¸'„)˚Ó#»òZ[âŒ¬àÀ»êRSó‘êUH
à›à
àX⁄‹À⁄à8¢b[H\]Z]ò[[ù\‹^Bà€€ú›[Q\HH
êRSó‘êUH
à›à
àLJKù—ö^Y
JN»À»çLHX⁄‹À⁄à]ç‹À›X⁄¬àôX⁄\^H8´!˚Ó#»	€[Q\_[[K⁄ò¬àBàH[ŸH¬àŸX]\ï^Hÿ[[ô\ãùŸX]\àOOH	ÿ€X\â»»	¯¶ ;Ó#»€X\â»à	¸'„);Ó#»ûIŒ¬àôX⁄\^H	¯´!˚Ó#»õ€ôIŒ¬àBà€€ú›ŸX]\ëù[HŸX]\ï^
»	»	»
»ôX⁄\^¬àYà
ŸX]\ëù[OOH⁄YùŸX]\äH»⁄YùŸX]\àHŸX]\ëù[»‹ŸX]\ãù^€€ù[ùHŸX]\ëù[»BÇàYà
€ÿ⁄»OOH⁄Yù[YJH»⁄Yù[YHH€ÿ⁄Œ»‹[YKù^€€ù[ùH€ÿ⁄Œ»BàYà
‹^JH¬à€€ú›^U^H⁄[ô›Àêÿ[[ô\îﬁ\›[Kôõ‹õX]ÿ[[ô\ë]J
N¬àYà
^U^OOH⁄Yô^JH»⁄Yô^HH^U^»‹^Kù^€€ù[ùH^U^»BàBà€€ú›€€^H[[ŸHOOH	€õ€ôI»»	¯ß"»[ô»úôYI»à€€[[⁄öJX›]ôU€€
H
»	»	»
»X›[€ìò[YJX›]ôPX›[€äN¬àYà
€€^OOH⁄Yù€€
H»⁄Yù€€H€€^»‹€€ù^€€ù[ùH€€^»BÇàÀ»ô]X€H[H[ôõ¬à€€ú›ô]X€HHŸ]ô]X€U[J
N¬à€€ú›[HHŸ]X›]ôU[P]
ô]X€Kò€€ô]X€Kúõ› N¬à€€ú››[HH[T›[\÷›[Kù\WH[T›[\Àô‹ò\‹Œ¬à€€ú›‹õ‹›àH[Kò‹õ‹»0≠»	›[Kò‹õ‹I›[Kò‹õ‹ôXYH»	»8ß$…»à	…ﬂXà	…Œ¬à€€ú›[U^H
›\úô[ù\ôXHOOH	⁄[ù\ö[‹â»»	¸'„Ë	»à	… H
»›[KõXô[
»‹õ‹›é¬àYà
[U^OOH⁄Yù[JH»⁄Yù[HH[U^»‹[Kù^€€ù[ùH[U^»BÇà€€ú›ÿ]\î›HX]úõ›[ô

[Kùÿ]\à»PV’–UTäH
àL
N¬à€€ú›\›àH[Kùÿ]\ààåH»	›ÿ]\î›IXà	ŸûIŒ¬à€€ú›ÿ]\ï^H	¸'‰©»	»
»\›é¬àYà
ÿ]\ï^OOH⁄Yùÿ]\ï^
H»⁄Yùÿ]\ï^Hÿ]\ï^»‹ÿ]\ãù^€€ù[ùHÿ]\ï^»Bà€€ú›ÿ]\ê€€‹àHÿ]\î›à»	»Õôâ¬ààÿ]\î›à»	»ÕôXÕôå	¬ààÿ]\î›àL»	»ÿXYYI»à	»Œ	Œ¬àYà
ÿ]\ê€€‹àOOH⁄Yùÿ]\ê€€‹äH»⁄Yùÿ]\ê€€‹àHÿ]\ê€€‹é»‹ÿ]\ãú›[Kò€€‹àHÿ]\ê€€‹é»BàYà
‹€€[[›[ù	âà[ùô[ù‹ûKô€€OOH⁄Yô€€
H»⁄Yô€€H[ùô[ù‹ûKô€€»‹€€[[›[ùù^€€ù[ùH[ùô[ù‹ûKô€€»BÇàÀ»€€\]Y€òŸH[ôôXYYõ›Y⁄ô[›»[ú›XYŸà][ô¬àÀ»ôYúô\⁄][Tÿ‹õ€‹ôYúô\⁄X›[€êò\à
[ôH\⁄›‹][H[
BàÀ»XX⁄ôKYö[\ãX[ô\€‹ùH⁄€H[ùô[ù‹ûHúõ€Hÿ‹ò]⁄8†%\¬àÀ»ù[ú»]ô\ûHúò[YK[ô[ùô[ù‹ûH€€ù[ù»€â›⁄[ôŸHôX\õBàÀ»]Ÿù[ãÇà€€ú››X⁄‹»HŸ][ùô[ù‹ûT›X⁄“][\ 
N¬ÇàÀ»\⁄›‹à⁄›»X›]ôH][H[à›]\»[
][Hÿ‹õ€\»Y[äBàYà
\—\⁄›‹
H¬à€€ú›][HHŸ]X›]ôR[ùô[ù‹ûR][J›X⁄‹ N¬àYà
‹][H	âà][JH¬à‹][Kú›[Kô\‹^HH	…Œ¬à‹][Q]ãú›[Kô\‹^HH	…Œ¬à€€ú›][U^H	÷’XóH	»
»][KöX€€à
»	»	»
»][KõXô[
»	»0Â…»
»
[ùô[ù‹ûV⁄][KöŸ^WH
N¬àYà
][U^OOH⁄Yö][JH»⁄Yö][HH][U^»‹][Kù^€€ù[ùH][U^»BàBàBÇàôYúô\⁄][Tÿ‹õ€
›X⁄‹ N¬àÀ»ôYúô\⁄X›[€êò\à\»ÿ[YYù\àX›[€ú»[ô€à€€⁄][H⁄[ôŸN¬àÀ»H\ùKZŸ^H⁄X⁄»XZŸ\»]⁄X\»ÿ[\ôH€»õ‹àô]X€H\]\¬àôYúô\⁄X›[€êò\ä›X⁄‹ N¬àYà
Y[ùS‹[äH¬àÀ»ŸY\ÿ[]\‹^H]ôH⁄[HY[ùH\»‹[Çà€€ú›ŸHÿ›[Y[ùôŸ][[Y[ùûRY
	⁄[ùïÿ[][[›[ù	 N¬àYà
Ÿ
HŸù^€€ù[ùH
[ùô[ù‹ûKô€€
N¬àBàBÇàù[ò›[€à\]SY[ùP€€ù[ù

H» àô\XŸYûHùZ[[ùô[ù‹ûQ‹öY

H
ã»BÇàù[ò›[€à\]QXùY‘YŸJ
H» àXùY»[ô[ô[[›ôYúõ€HY[ùH
ã»BÇàù[ò›[€à€€[[⁄öJ€€
H¬à€€ú›\]Z\YH\]Z\Y[ù€›÷›€€N¬àYà
\]Z\Y	âà””“USW—Qî÷Ÿ\]Z\YJHô]\õà””“USW—Qî÷Ÿ\]Z\YKöX€€é¬àô]\õà»⁄›ô[â¯¶„˚Ó#…ÀŸNâ¸'Í§…À^Nâ¸'Í§…ÀX⁄Œâ¯¶„˚Ó#…À\ú€€éâ¸'„®…ÀŸX\€éâ¸'ÂË{Ó#…Àò[ôŸYâ¸'„ÓIÀXX⁄]Nâ¸'ÂË{Ó#…ÀŸYYŒâ¸'„,I»V›€€H	¯ße	Œ¬àBÇàù[ò›[€àô^òZ[ï^

H¬àYà
Xÿ[[ô\ãõô^òZ[ï⁄[ô›‹Àõ[ô›
Hô]\õà	”õ»òZ[àÿ⁄Y[YŸ^IŒ¬à€€ú››\àH⁄[ô›Àêÿ[[ô\îﬁ\›[KôŸ]›\ä
N¬à€€ú›ô^Hÿ[[ô\ãõô^òZ[ï⁄[ô›‹Àôö[ô

⁄[ô› HOà›\à⁄[ô›Àô[ô
N¬àYà
[ô^
Hô]\õà	‘òZ[à\»\‹ŸYõ‹àŸ^IŒ¬àô]\õàô^õ›»	Ÿõ‹õX]€ÿ⁄ ô^ú›\ù
_KIŸõ‹õX]€ÿ⁄ ô^ô[ô
_X¬àBÇàù[ò›[€àõ‹õX]€ÿ⁄ ›\ïò[YJH¬à€€ú››\àHX]ôõ€‹ä›\ïò[YJN¬à€€ú›Z[ù]HHX]ôõ€‹ä
›\ïò[YHH›\äH
àå»L
H
àL¬à€€ú››Yôö^H›\àèHLà»	‘I»à	–SIŒ¬à€€ú›\‹^R›\àH

›\à
»LJH	HLäH
»N¬àô]\õà	Ÿ\‹^R›\üNâ‘›ö[ô Z[ù]JKúY›\ù
ã	Ã	 _H	‹›Yôö^X¬àBÇàù[ò›[€àX›[€ë[[⁄öJX›[€äH¬àô]\õàX›[€ìXô[÷ÿX›[€óOÀñÃH	¯ße	Œ¬àBÇàù[ò›[€àX›[€ìò[YJX›[€äH¬àYà
X›[€ãú›\ù’⁄]
	‹XŸW… JHô]\õà	‘XŸIŒ¬àYà
X›[€ãú›\ù’⁄]
	€ÿöó‹õÿŸ\‹◊… JHô]\õà	‘õÿŸ\‹…Œ¬àô]\õàX›[€ìXô[÷ÿX›[€óOÀñÃWHX›[€é¬àBÇàù[ò›[€à€€ò[YJ€€
H¬à€€ú›\]Z\YH\]Z\Y[ù€›÷›€€N¬à€€ú›YàH\]Z\Y»””“USW—Qî÷Ÿ\]Z\YHàù[¬àYà
YäHô]\õà	ŸYãöX€€üH	ŸYãõXô[X¬àô]\õà»⁄›ô[â¯¶„˚Ó#»⁄›ô[	ÀŸNâ¸'Í§»ŸIÀ^Nâ¸'Í§»^IÀX⁄Œâ¯¶„˚Ó#»X⁄…À\ú€€éâ¸'„®»\ú€€âÀŸX\€éâ¸'ÂË{Ó#»ŸX\€âÀò[ôŸYâ¸'„ÓHò[ôŸYŸX\€âÀXX⁄]Nâ¸'ÂË{Ó#»ŸX\€âÀŸYYŒâ¸'„,HŸYY…»V›€€H€€¬àBÇàù[ò›[€àŸYYYò[ô€JŸYY
H¬à€€ú›HX]ú⁄[äŸYY
H
àL¬àô]\õàHX]ôõ€‹ä
N¬àBÇàù[ò›[€à[ôRõﬁ\›X⁄‘⁄[ù\ë›€ä]ô[ù
H¬à[ú]öõﬁ\›X⁄‘⁄[ù\íYH]ô[ùú⁄[ù\íY¬àÀ»Ÿ]⁄[ù\êÿ\\ôHÿ[àõ›»
ìõ»X›]ôH⁄[ù\à⁄]H⁄]ô[àYàÀ»\»õ›[ôäHYàHúõ›‹Ÿ\àŸ\€â›€€ú⁄Y\à\»⁄[ù\àù[BàÀ»X›]ôHY]8†%ŸY[à[àòX›XŸH€àH›X⁄]›\ù»⁄[HBàÀ»YŸK€^[›]\»›[Ÿ][ô»öY⁄Yù\àÿYà[òÿ]Y⁄]àÀ»^Ÿ\[€à\ŸY»Xõ‹ù\»ù[ò›[€àôYõ‹ôH\]Rõﬁ\›X⁄ 
BàÀ»ò[ã\õX[ô[ùH›ò[ô[ô»õﬁ\›X⁄‘⁄[ù\íY⁄[ùY]H⁄[ù\ÇàÀ»]€›[ô]ô\àŸ]HX]⁄[ô»⁄[ù\ù\8†%]ô\ûHôX[›X⁄àÀ»Yù\à]€›⁄[[ùHY€õ‹ôY
[ú]öõﬁ\›X⁄‘⁄[ù\íYOOBàÀ»]ô[ùú⁄[ù\íY[à[ôRõﬁ\›X⁄‘⁄[ù\ì[›ôK’\
H[ù[Hù[àÀ»YŸHô[ÿYô\Ÿ]H›]Kà⁄]›]ÿ\\ôHHõﬁ\›X⁄»›[àÀ»€‹ö‹»õ‹õX[N»H€õH‹‹»\»]HòY»⁄X⁄X]ô\¬àÀ»õﬁ\›X⁄÷õ€ôI‹»›€à”Hõ›[ô»›‹»ôZ[ô»òX⁄ŸYÇàûH»õﬁ\›X⁄÷õ€ôKúŸ]⁄[ù\êÿ\\ôJ]ô[ùú⁄[ù\íY
N»Hÿ]⁄
JH» àŸYHXõ›ôH8†%Y‹òYH‹òXŸYù[K€â›⁄⁄\\]Rõﬁ\›X⁄»
ã»Bà\]Rõﬁ\›X⁄ ]ô[ù
N¬àBÇàù[ò›[€à[ôRõﬁ\›X⁄‘⁄[ù\ì[›ôJ]ô[ù
H¬àYà
[ú]öõﬁ\›X⁄‘⁄[ù\íYOOH]ô[ùú⁄[ù\íY
Hô]\õé¬à\]Rõﬁ\›X⁄ ]ô[ù
N¬àBÇàù[ò›[€à[ôRõﬁ\›X⁄‘⁄[ù\ï\
]ô[ù
H¬àYà
[ú]öõﬁ\›X⁄‘⁄[ù\íYOOH]ô[ùú⁄[ù\íY
Hô]\õé¬à[ú]öõﬁ\›X⁄‘⁄[ù\íYHù[¬à[ú]ûH¬à[ú]ûHH¬àõﬁ\›X⁄“€õÿãú›[Kùò[úŸõ‹õHH	›ò[ú€]JML	KML	JHò[ú€]J
IŒ¬àBÇàù[ò›[€à\]Rõﬁ\›X⁄ ]ô[ù
H¬à€€ú›ôX›Hõﬁ\›X⁄÷õ€ôKôŸ]õ›[ô[ô–€Y[ùôX›

N¬à€€ú›Ÿ[ù\ñHôX›õYù
»ôX›ù⁄Y»é¬à€€ú›Ÿ[ù\ñHHôX›ù‹
»ôX›öZY⁄»é¬à€€ú›ò]÷H]ô[ùò€Y[ùHŸ[ù\ñ¬à€€ú›ò]÷HH]ô[ùò€Y[ùHHŸ[ù\ñN¬à€€ú›\›[òŸHHX]ö\›
ò]÷ò]÷JN¬à€€ú›X›]ôTòY]\»HX]õX^
ÃãX]õZ[äì÷T’P“◊‘êQUTÀôX›ù⁄Y
àçäJN»À»\ŸYô[›»»€[\€õÿàò]ô[õ‹àH›\úô[ùÿ‹ôY[ã\⁄^ôYõﬁ\›X⁄ÀÇà€€ú›[ô€HHX]ò][åäò]÷Kò]÷
N¬à€€ú›€[\YHX]õZ[ä\›[òŸKX›]ôTòY]\ N¬à€€ú›ò]”XY€ö]YHH€[\
€[\Y»X›]ôTòY]\ÀJN¬à€€ú›ô[X\YHò]”XY€ö]YHHì÷T’P“◊—PQì”ëBà»ààX]ú› 
ò]”XY€ö]YHHì÷T’P“◊—PQì”ëJH»
HHì÷T’P“◊—PQì”ëJKì÷T’P“◊‘ëT‘”î—JN¬à€€ú›€õÿñHX]ò€‹ [ô€JH
à€[\Y¬à€€ú›€õÿñHHX]ú⁄[ä[ô€JH
à€[\Y¬Çà[ú]ûHô[X\Yà»X]ò€‹ [ô€JH
àô[X\Yà¬à[ú]ûHHô[X\Yà»X]ú⁄[ä[ô€JH
àô[X\Yà¬àõﬁ\›X⁄“€õÿãú›[Kùò[úŸõ‹õHHò[ú€]JML	KML	JHò[ú€]J	⁄€õÿñ\	⁄€õÿñ_\
X¬àBÇà\ﬁ[ò»ù[ò›[€à€‹QXùY”Ÿ 
H¬à€€ú›ô]X€HHŸ]ô]X€U[J
N¬à€€ú›ö[\àH⁄[ô›Àó◊ŸXùY”Ÿ—ö[\à	ÿ[	Œ¬à€€ú›ò]”Ÿ»H⁄[ô›Àó◊Ÿò\õQXùY”Ÿ»◊N¬à€€ú›ö[\ôYŸ»H⁄[ô›Àó◊ŸXùY”Ÿ”X]⁄\—ö[\Çà»ò]”ŸÀôö[\äHOà⁄[ô›Àó◊ŸXùY”Ÿ”X]⁄\—ö[\äKö[\äJBààò]”ŸŒ¬à€€ú›[ô\»H¬à	’õ‹Xÿ[ô[ò⁄ò\õHXùY»ô\‹ù	Ààããäö[\àOOH	ÿ[	»»ÿXùY»ö[\éà	Ÿö[\üH
	Ÿö[\ôYŸÀõ[ô›K…‹ò]”ŸÀõ[ô›H[ùöY\ XHà◊JKà\Ÿ\àYŸ[ùà	€ò]öYÿ]‹ãù\Ÿ\êYŸ[ùXàöY]‹‹ùà	›⁄[ô›Àö[õô\ï⁄Y^	›⁄[ô›Àö[õô\íZY⁄XàRHôX›à	ŸŸ]€€\]Y›[Jÿ›[Y[ùôÿ›[Y[ù[[Y[ù
KôŸ]õ‹\ùUò[YJ	ÀKY›… Kùö[J
_H0Â»	ŸŸ]€€\]Y›[Jÿ›[Y[ùôÿ›[Y[ù[[Y[ù
KôŸ]õ‹\ùUò[YJ	ÀKY⁄	 Kùö[J
_H]	ŸŸ]€€\]Y›[Jÿ›[Y[ùôÿ›[Y[ù[[Y[ù
KôŸ]õ‹\ùUò[YJ	ÀK[ﬁ	 Kùö[J
_K	ŸŸ]€€\]Y›[Jÿ›[Y[ùôÿ›[Y[ù[[Y[ù
KôŸ]õ‹\ùUò[YJ	ÀK[ﬁI Kùö[J
_Xà—ôX›à	”X]úõ›[ô
ôYP€€ùZ[ô\ãôŸ]õ›[ô[ô–€Y[ùôX›

Kù⁄Y
_^	”X]úõ›[ô
ôYP€€ùZ[ô\ãôŸ]õ›[ô[ô–€Y[ùôX›

KöZY⁄
_Xàõﬁ\›X⁄»öY]‹‹ù[ò⁄‹éà	”X]úõ›[ô
õﬁ\›X⁄÷õ€ôKôŸ]õ›[ô[ô–€Y[ùôX›

KõYù
_\Yù	”X]úõ›[ô
⁄[ô›Àö[õô\íZY⁄Hõﬁ\›X⁄÷õ€ôKôŸ]õ›[ô[ô–€Y[ùôX›

Kòõ›€J_\õ›€Xà[›ô[Y[ù[ö[ôŒà‹YYI”S’ëW‘‘QQHXÿŸ[I–P–—SH\õèI’Tìó–P–—SHXŸ[I—P—SHXYõ€ôOI“ì÷T’P“◊—PQì”ë_XàX›[€àñà\ùX€\œIÿX›[€î\ùX€\Àõ[ô›H[Qõ\⁄\œIÿX›[€ï[QYôôX›Àõ[ô›H€\⁄òZ[œI›ŸX\€ïòZ[YôôX›Àõ[ô›Xàÿ[[ô\éà	›⁄[ô›Àêÿ[[ô\îﬁ\›[Kôõ‹õX]ÿ[[ô\ë]J
_H
ò]»^H	ÿÿ[[ô\ãô^_JK	Ÿõ‹õX]€ÿ⁄ ⁄[ô›Àêÿ[[ô\îﬁ\›[KôŸ]›\ä
J_K	ÿÿ[[ô\ãùŸX]\üXà€€ÿX›[€éà	›€€ò[YJX›]ôU€€
_H»	ÿX›[€ìò[YJX›]ôPX›[€ä_Xà^Y\éà	‹^Y\ãûù—ö^Y

_HI‹^Y\ãûKù—ö^Y

_Xà	ÀKKHò]»Ÿ»KKIÀàããôö[\ôYŸÀõX\
HOà…ŸKùWH…ŸKõõWH	ŸKõ\ŸﬂX
BàN¬à€€ú›^H[ô\Àöõ⁄[ä	◊â N¬àûH¬àYà
ò]öYÿ]‹ãò€\õÿ\ô	âà⁄[ô›Àö\‘ŸX›\ôP€€ù^
H¬à]ÿZ]ò]öYÿ]‹ãò€\õÿ\ôù‹ö]U^
^
N¬àH[ŸH¬à€€ú›\ôXHHÿ›[Y[ùò‹ôX]Q[[Y[ù
	›^\ôXI N¬à\ôXKùò[YHH^¬à\ôXKúŸ]]öXù]J	‹ôXY€õIÀ	… N¬à\ôXKú›[Kò‹‹’^H	‹‹⁄][€éôö^Y€YùãNNNN\	Œ¬àÿ›[Y[ùòõŸKò\[ô⁄[
\ôXJN¬à\ôXKúŸ[X›

N¬àÿ›[Y[ùô^X–€€[X[ô
	ÿ€‹I N¬à\ôXKúô[[›ôJ
N¬àBà⁄›’ÿ\›
	—XùY»Ÿ»€‹YY»€\õÿ\ôâÀùYJN¬àXùY”Ÿ 	ŸXùY»Ÿ»€‹YY»€\õÿ\ô	 N¬àHÿ]⁄
\úõ‹äH¬à⁄›’ÿ\›
	–€‹HòZ[Y8†%Ÿ»ö\⁄XõH[àXùY»XãâÀò[ŸJN¬àXùY”Ÿ €‹HXùY»Ÿ»òZ[Yà	Ÿ\úõ‹ãõY\‹ÿYŸ_X	Ÿ\úõ‹â N¬àBàBÇàù[ò›[€à€[\
ò[YKZ[ãX^
H¬àô]\õàX]õX^
Z[ãX]õZ[äX^ò[YJJN¬àBÇàù[ò›[€àõ›[ôôX›
€€ù^K⁄YZY⁄òY]\ H¬à€€ù^òôY⁄[î]

N¬à€€ù^õ[›ôU 
»òY]\ÀJN¬à€€ù^ò\ò’ 
»⁄YK
»⁄YH
»ZY⁄òY]\ N¬à€€ù^ò\ò’ 
»⁄YH
»ZY⁄H
»ZY⁄òY]\ N¬à€€ù^ò\ò’ H
»ZY⁄KòY]\ N¬à€€ù^ò\ò’ K
»⁄YKòY]\ N¬à€€ù^ò€‹ŸT]

N¬àBÇàù[ò›[€à‘ô\Ÿ]

H¬àÀ»⁄\\»H⁄€H⁄\ôYò\õH
^K›ŸX]\ãŸù\õö]\ôKÿ[ö[X[ H[ô\¬àÀ»⁄\òX›\â‹»›€à[ùô[ù‹ûHòX⁄»»^H€ôH8†%›€ô\ã[€õKÿ[YH\»BàÀ»ò\õHY]‹ã€»Hò\õZ[ôÿ[â›ùZŸHH›€ô\â‹»€ô€⁄[ô»€‹öÀÇàYà
Z\—ò\õS›€ô\ä
JH¬à⁄›’ÿ\›
ì€õHHò\õI‹»›€ô\àÿ[àô\Ÿ]Hò\õKàãò[ŸJN¬àô]\õé¬àBàÿ[[ô\ãô^HHN¬àÿ[[ô\ãù[YLHHåÃ¬àÿ[[ô\ãùŸX]\àH	‹òZ[âŒ¬àÿ[[ô\ãö\‘òZ[ö[ô»HùYN¬àÿ[[ô\ãúòZ[î›ô[ô›Hé¬àÿ[[ô\ãõô^òZ[ï⁄[ô›‹»Hﬁ»›\ùà[ôàM›ô[ô›ààWN¬àÿ[[ô\ãõ\›òZ[ë^HHN¬à‹ÿ]ôU€‹õÿ[[ô\ä
N¬àÿöôX›öŸ^\ [ùô[ù‹ûJKôõ‹ëXX⁄
Ÿ^HOà»[]H[ùô[ù‹ûV⁄Ÿ^WN»JN¬àÿöôX›ò\‹⁄Y€ä[ùô[ù‹ûK»ããî’TïSë◊“SïëSï‘ñHJN¬à€X\îXŸYõÿŸ\‹⁄[ô—ù\õö]\ôJ
N¬à€X\í[ù\ö[‹ëù\õö]\ôJ
N¬à⁄[ô›Àëò\õPùZ[[ô‹Àò€X\ê[

N»À»ôKXYYúõ€H^[›]ô[›Àÿ[YH\»ù\õö]\ôKŸX€‹à8†%H›\ŸKŸò\õH›ùX›\ô\»›\ùö]ôHHô\Ÿ]€õH^K›ŸX]\ã⁄[ùô[ù‹ûK€]ô\›ÿ⁄»»õ›à⁄[ô›Àëò\õP[ö[X[Àò€X\ê[ö[X[ÿöôX› 
N¬à‹ÿ]ôU€‹õ]ô\›ÿ⁄ ◊JN»À»ù[ò\õHô\Ÿ][€»€X\ú»ô[X\ŸY[ö[X[»úõ€HH€‹õö[Bà€X\í‹›[SÿöôX› 
N¬à\‹]€ê€€\[ö[€ú 
N¬à€‹õÿöôX›Àôõ‹ëXX⁄
»OàÀúô\Ÿ]	âàÀúô\Ÿ]

JN¬à‹öYH‹ôX]R[ö]X[‹öY

N¬à»€€ú›‹€HÿYò\õS^[›]

N»Yà
‹€
H\Qò\õS^[›]—‹öY
‹€
N»Bà^Y\ãûH””»
àSH
àçN¬à^Y\ãûHHì’‘»
àSH
àçÃé¬à^Y\ãò[ô€HHSX]îH»é¬à^Y\ãùûH»^Y\ãùûHH¬à^Y\ãöX[H^Y\ãõX^X[¬à^Y\ãú›[Z[òHH^Y\ãõX^›[Z[òN¬à^Y\ãôŸ⁄[ô»Hò[ŸN»^Y\ãôŸŸUH»^Y\ãôŸŸP€€€›€ïH»^Y\ãö[ùù[ï[ù[H¬àòX⁄[ô–[ô€HHSX]îH»é¬à\›[›ôP[ô€HHSX]îH»é¬àÿ\ô[ò[€[Y\àH¬àX›]ôR][R[ô^H¬àÀ»ô\Ÿ]\]Z\Y[ù»Yò][¬àX⁄–€›[ô»H◊N¬àÿöôX›öŸ^\ \]Z\Y[ù€› Kôõ‹ëXX⁄
»Oà»\]Z\Y[ù€›÷⁄◊HHù[»JN¬àYà
ŸX\í[ùô[ù‹ûOÀù€€œÀöŸW€ò]]ôP€‹\äH\]Z\Y[ù€›ÀöŸHH	⁄ŸW€ò]]ôP€‹\âŒ¬à[ŸHYà
ŸX\í[ùô[ù‹ûOÀù€€œÀòúõ€ûôZŸJH\]Z\Y[ù€›ÀöŸHH	ÿúõ€ûôZŸIŒ¬àYà
ŸX\í[ùô[ù‹ûOÀù€€œÀúX⁄‹⁄›ô[€ò]]ôP€‹\äH\]Z\Y[ù€›Àú⁄›ô[H	‹X⁄‹⁄›ô[€ò]]ôP€‹\âŒ¬à[ŸHYà
ŸX\í[ùô[ù‹ûOÀù€€œÀúX⁄‹⁄›ô[
H\]Z\Y[ù€›Àú⁄›ô[H	‹X⁄‹⁄›ô[	Œ¬àYà
ŸX\í[ùô[ù‹ûOÀù€€œÀö]⁄]€ò]]ôP€‹\äH\]Z\Y[ù€›ÀùŸX\€àH	⁄]⁄]€ò]]ôP€‹\âŒ¬à[ŸHYà
ŸX\í[ùô[ù‹ûOÀù€€œÀö]⁄]
H\]Z\Y[ù€›ÀùŸX\€àH	⁄]⁄]	Œ¬àYà
ŸX\í[ùô[ù‹ûOÀù€€œÀò‹õ‹‹ÿõ› H\]Z\Y[ù€›Àúò[ôŸYH	ÿ‹õ‹‹ÿõ›…Œ¬àYà
ŸX\í[ùô[ù‹ûOÀù⁄\›\œÀõ[ô›
H\]Z\Y[ù€›Àù⁄\›HHŸX\í[ùô[ù‹ûKù⁄\›\÷ÃKöY¬àôXùZ[€€Y\⁄\ 
N¬àôYúô\⁄ŸX\€î›⁄]⁄ùä
N¬àÿöôX›ùò[Y\ €€Y\⁄X\
Kôõ‹ëXX⁄
HOà»Yà
JH€€€\ãúô[[›ôJJN»JN¬àYà
€€Y\⁄X\ÿX›]ôU€€JH€€€\ãòY
€€Y\⁄X\ÿX›]ôU€€JN¬àÀ»ôKX\Hÿ]ôYõÿŸ\‹⁄[ô»ù\õö]\ôHúõ€H^[›]
‹ò]\»ŸY\Z\à›\úô[ù‹⁄][€äBàûH¬à€€ú›‹õHÿYò\õS^[›]

N¬àYà
‹õ
H¬à
‹õôù\õö]\ôH◊JKôõ‹ëXX⁄

»Ÿ^K€€õ›Àõÿãõ›QY»JHOà¬àYà
ì–—T‘“Së◊—ïTìíUTëW—Qî÷⁄Ÿ^WH	âàÿ[îXŸQù\õö]\ôP]
€€õ› JH¬à€€ú›ÿöàHXZŸTõÿŸ\‹⁄[ô—ù\õö]\ôJ€€õ›ÀŸ^Kõÿãõ›QY»
N¬àYà
ÿöäH»€‹õÿöôX›ÀúŸ]
€€
»	À	»
»õ›ÀÿöäN»õÿŸ\‹⁄[ô—ù\õö]\ôSÿöôX›ÀòY
ÿöäN»BàBàJN¬à
‹õôX€‹à◊JKôõ‹ëXX⁄

»YŸ^K€€õ›À\ôXKõ›QYÀ›€ô\îYXŸRYÿÿ[€€ÿÿ[õ›»JHOà¬à€€ú›YàHP”‘êUUëW—ïTìíUTëW—Qî÷⁄Ÿ^WN¬àYà
YYäHô]\õé¬à€€ú›X€‹ê\ôXHH\ôXH	Ÿò\õIŒ¬à€€ú››HX€‹ê\ôXHOOH	⁄[ù\ö[‹â»»[ù\ö[‹îÿŸ[ôHàÿŸ[ôN¬à€€ú›àHXZŸQX€‹ò]]ôQù\õö]\ôSY\⁄
€€õ›ÀŸ^K›X€‹ê\ôXKõ›QY»
N¬à€€ú››€ô\àHX€‹ê\ôXHOOH	⁄[ù\ö[‹â»	âà[›€ô\îYXŸRY»ù\õö]\ôS›€ô\ëöY[ €€õ› HàﬂN¬àYà
äH[ù\ö[‹ëù\õö]\ôSÿöôX›Àú\⁄
»YàY	ŸX€‹ó…»
»X]úò[ô€J
Kù‘›ö[ô ÕäKú€XŸJãL
KŸ^K€€õ›ÀàY\⁄àãõY\⁄Y⁄àãõY⁄Ÿû€›\òŸNàãúŸû€›\òŸK\ôXNàX€‹ê\ôXKõ›QYŒàõ›QY»à›€ô\îYXŸRYà›€ô\îYXŸRY›€ô\ãõ›€ô\îYXŸRYÿÿ[€€àù[Xô\ãö\—ö[ö]Jÿÿ[€€
H»ÿÿ[€€à›€ô\ãõÿÿ[€€àÿÿ[õ›Œàù[Xô\ãö\—ö[ö]Jÿÿ[õ› H»ÿÿ[õ›»à›€ô\ãõÿÿ[õ›»JN¬àYà
à	âàX€‹ê\ôXHOOH	Ÿò\õI»	âàYãú⁄]
H¬à€€ú›⁄^ôHHX€‹ò]]ôQù\õö]\ôT⁄^ôJŸ^Kõ›QY»
N¬àôY⁄\›\î⁄]€‹õÿöôX›
Ÿ^K€€õ›À⁄^ôKôùÀ⁄^ôKôôõ›QY»
N¬àBàYà
äHôY⁄\›\ê⁄Z\ìú‘›][€äŸ^K€€õ›Àõ›QY»õ‹õX[^ôSú–\ôXJX€‹ê\ôXJJN¬àJN¬à
‹õòùZ[[ô‹»◊JKôõ‹ëXX⁄
ÿ]ôYOà¬àYà
ÿ]ôYö⁄[ôOOH	ÿò\õâ»PêTìó’QTî÷‹ÿ]ôYùY\óJHô]\õé¬à€€ú›[ùûHH»Yàÿ]ôYöY⁄[ôà	ÿò\õâÀY\éàÿ]ôYùY\ã€€àÿ]ôYò€€õ›Œàÿ]ôYúõ›ÀŒàÿ]ôYù»⁄[ô›Àëò\õPùZ[[ô‹Àëì”’íSï’Ààÿ]ôYö⁄[ô›Àëò\õPùZ[[ô‹Àëì”’íSï—›YŸNàÿ]ôYú›YŸH	Ÿõ›[ô][€âÀããä\úò^Kö\–\úò^Jÿ]ôYùõ›Y⁄ H»»õ›Y⁄Œàÿ]ôYùõ›Y⁄»HàﬂJHN¬àò\õPùZ[[ô‹Àú\⁄
[ùûJN¬à⁄[ô›Àëò\õPùZ[[ô‹Àú‹]€ë[ùûJ[ùûJN¬àJN¬àBàHÿ]⁄ﬂBà\›X›[€ìY\‹ÿYŸHH	—ò\õHô\Ÿ]à›‹õ]YH8†%Y»ô[ò⁄\»»õ›]HHÿ]\ãâŒ¬à⁄›’ÿ\›
	—ò\õHô\Ÿ]»›‹õ]YKâÀùYJN¬àXùY”Ÿ 	‹õ››\Hô\Ÿ]	 N¬àôYúô\⁄X›[€êò\ä
N¬àôYúô\⁄][Tÿ‹õ€

N¬à€‹ŸSY[ùJ
N¬àBÇÇàYà
Y[ùTô\Ÿ]ùäHY[ùTô\Ÿ]ùãòY]ô[ù\›[ô\ä	ÿ€X⁄…À‘ô\Ÿ]
N¬àYà
Y[ùT]\ŸPùäHY[ùT]\ŸPùãòY]ô[ù\›[ô\ä	ÿ€X⁄…À

HOà¬à]\ŸYH\]\ŸY¬àY[ùT]\ŸPùãù^€€ù[ùH]\ŸY»	¯•≠â»à	¯£Ó	Œ¬àXùY”Ÿ ]\ŸY»	‹]\ŸY	»à	‹ô\›[YY	 N¬àJN¬Çàÿ›[Y[ùôŸ][[Y[ùûRY
	€ú—X[Ÿ›YP€€ù[ùYI OÀòY]ô[ù\›[ô\ä	ÿ€X⁄…À

HOà»Yà
X[Ÿ›YS‹[äH⁄[ô›ÀëX[Ÿ›YP€€ù[ùÀòYò[òŸSú—X[Ÿ›YJ
N»JN¬àÿ›[Y[ùôŸ][[Y[ùûRY
	€ú—X[Ÿ›YSX]ôI OÀòY]ô[ù\›[ô\ä	ÿ€X⁄…À

HOà»Yà
X[Ÿ›YS‹[äH€‹ŸSú—X[Ÿ›YJ
N»JN¬Çàõﬁ\›X⁄÷õ€ôKòY]ô[ù\›[ô\ä	‹⁄[ù\ô›€âÀ[ôRõﬁ\›X⁄‘⁄[ù\ë›€äN¬àõﬁ\›X⁄÷õ€ôKòY]ô[ù\›[ô\ä	‹⁄[ù\õ[›ôIÀ[ôRõﬁ\›X⁄‘⁄[ù\ì[›ôJN¬àõﬁ\›X⁄÷õ€ôKòY]ô[ù\›[ô\ä	‹⁄[ù\ù\	À[ôRõﬁ\›X⁄‘⁄[ù\ï\
N¬àõﬁ\›X⁄÷õ€ôKòY]ô[ù\›[ô\ä	‹⁄[ù\òÿ[òŸ[	À[ôRõﬁ\›X⁄‘⁄[ù\ï\
N¬ÇàÀ»ŸŸHù]€éàHZ[à\Ÿ⁄[ô»[àH›\úô[ùòX⁄[ô»\ôX›[€ãÇàÀ»[ÿ^\»ö\⁄XõH€à›X⁄
ŸYHŸŸŸPùà[à›[Kò‹‹ N»Y[à€õBàÀ»\ö[ô»ö\⁄[ôÀÿ[YH\»H›\à\ò»€€ùõ€ÀÇàŸŸPùèÀòY]ô[ù\›[ô\ä	‹⁄[ù\ô›€âÀ]àOà¬à]ãúô]ô[ùYò][

N¬à\ôõ‹õP€€ù^X›[€ä
N¬àJN¬ÇàÀ»ŸX\€à]ZX⁄À\›⁄]⁄ù]€éàHZ[à\ŸŸ€\»[ã€›]ŸàBàÀ»ŸX\€à€€€›
ŸYHŸŸ€T]ZX⁄’ŸX\€î›⁄]⁄
H8†%\»\»›»[›BàÀ»Ÿ]
ö[ù à€€Xò]›[òŸH»ôY⁄[à⁄]ÇàùïŸX\€î›⁄]⁄ÀòY]ô[ù\›[ô\ä	‹⁄[ù\ô›€âÀ]àOà¬à]ãúô]ô[ùYò][

N¬àŸŸ€T]ZX⁄’ŸX\€î›⁄]⁄

N¬àJN¬ÇàÀ»[ÿö[HZ\úõ‹àŸàHàŸ^H»\Y›€à	›ŸŸ€S[›[ù	»X›[€à8†%àÀ»òX›]ôH\»Ÿ\[àﬁ[ò»⁄]öYT›]H[à⁄[ô›Àì[›[ùÀù\]S[›[ùöYKÇàùêÿ[[›[ùÀòY]ô[ù\›[ô\ä	‹⁄[ù\ô›€âÀ]àOà¬à]ãúô]ô[ùYò][

N¬à⁄[ô›Àì[›[ùœÀùŸŸ€S[›[ù

N¬àJN¬ÇàÀ»Y[YH]]À]\ôŸ]	‹»⁄^›]\ã\ö[ô»ù]€éàHZ[à\ŸŸ€\»8†%àÀ»Ÿôà\õú»]€à[ôÿ⁄‹»H€‹Ÿ\›‹›[H[àò[ôŸH
õ»òX⁄[ô¬àÀ»€€ôHô\]Z\ôY[õZŸHH]X⁄À]öYŸŸ\ôY]]ÀY[ôÿYŸJK€à\õú¬àÀ»]òX⁄»ŸôãàõÀ[‹»YàY[YH\€â››]‹à
\õö[ô»€äHõ›[ô»\¬àÀ»[àò[ôŸKÇàùìY[YP]]’\ôŸ]ÀòY]ô[ù\›[ô\ä	‹⁄[ù\ô›€âÀ]àOà¬à]ãúô]ô[ùYò][

N¬àYà
[Y[YUŸX\€ì›]

JHô]\õé¬àYà
Y[YP]]’\ôŸ]€äH»Y[YP]]’\ôŸ]€àHò[ŸN»X[ùX[]]’\ôŸ]Hù[»Y[YP]]’\ôŸ]úôYPZ[HHò[ŸN»ô]\õé»Bà€€ú›\ôŸ]Hö[ô]]’\ôŸ]

N¬àYà
]\ôŸ]
Hô]\õé¬àX[ùX[]]’\ôŸ]H\ôŸ]¬àY[YP]]’\ôŸ]€àHùYN¬àY[YP]]’\ôŸ]úôYPZ[HHò[ŸN¬àJN¬ÇàÀ»›ÿ\\ôŸ]ù]€éà]»›€àYXÿ]YòYÀY\ôX›[€à›X⁄»
Ÿ\\ò]BàÀ»úõ€H\PXù

I‹»€€⁄][KXX›[€à⁄\ö[ôÀ⁄X⁄Y]»òYÀ\ô\X]àÀ»ôZ]ö[‹à\ÿXõY
Kà\⁄[ô»]›ÿ\ôH‹›[H›ÿ\»]]À]\ôŸ][ô¬àÀ»€ù»]8†%ö\ô\»€òŸH\àòYÀõ»ô\X]ôYYY⁄[òŸH]	‹»H⁄[ô€BàÀ»Ÿ[X›[€ãõ›H€€ù[ù[›\»X›[€ãÇàYà
ùî›ÿ\\ôŸ]
H¬à]‹›YHù[‹›ﬁH‹›ﬁHH‹›€ÿ⁄‘àH‹›òY»Hò[ŸK‹›€ÿ⁄Ÿ]Hù[¬à€€ú›’—êQ◊’ëT“HL¬àùî›ÿ\\ôŸ]òY]ô[ù\›[ô\ä	‹⁄[ù\ô›€âÀ]àOà¬àYà
ùî›ÿ\\ôŸ]ò€\‹”\›ò€€ùZ[ú 	ÿXùZY[â JHô]\õé¬à]ãúô]ô[ùYò][

N¬àÀ»ŸYH[ôRõﬁ\›X⁄‘⁄[ù\ë›€â‹»€€[Y[ù8†%›X\ôY\ôH€»€»BàÀ»ÿ\\ôHòZ[\ôHù\›‹Ÿ\»\»€ôH›X⁄[ú›XYŸàõ›⁄[ôÀÇàûH»ùî›ÿ\\ôŸ]úŸ]⁄[ù\êÿ\\ôOÀä]ãú⁄[ù\íY
N»Hÿ]⁄
\úäH» àY‹òYH‹òXŸYù[H
ã»Bà‹›YH]ãú⁄[ù\íY¬à€€ú›ôX›Hùî›ÿ\\ôŸ]ôŸ]õ›[ô[ô–€Y[ùôX›

N¬à‹›ﬁHôX›õYù
»ôX›ù⁄Y»é¬à‹›ﬁHHôX›ù‹
»ôX›öZY⁄»é¬à‹›€ÿ⁄‘àHôX›ù⁄Y
àçMN¬à‹›òY»Hò[ŸN¬à‹›€ÿ⁄Ÿ]Hÿ›[Y[ùò‹ôX]Q[[Y[ù
	Ÿ]â N¬à‹›€ÿ⁄Ÿ]ò€\‹”ò[YHH	ÿXù\€ÿ⁄Ÿ]	Œ¬à‹›€ÿ⁄Ÿ]ú›[KõYùH‹›ﬁ
»	‹	Œ¬à‹›€ÿ⁄Ÿ]ú›[Kù‹H‹›ﬁH
»	‹	Œ¬à‹›€ÿ⁄Ÿ]ú›[Kù⁄YH‹›€ÿ⁄Ÿ]ú›[KöZY⁄H
ôX›ù⁄Y
àãåäH
»	‹	Œ¬àÿ›[Y[ùòõŸKò\[ô⁄[
‹›€ÿ⁄Ÿ]
N¬àùî›ÿ\\ôŸ]ú›[Kùò[ú⁄][€àH	€õ€ôIŒ¬àJN¬àùî›ÿ\\ôŸ]òY]ô[ù\›[ô\ä	‹⁄[ù\õ[›ôIÀ]àOà¬àYà
]ãú⁄[ù\íYOOH‹›Y
Hô]\õé¬à€€ú›H]ãò€Y[ùH‹›ﬁHH]ãò€Y[ùHH‹›ﬁN¬à€€ú›\›HX]ö\›
JN¬à€€ú›àHX]õZ[ä\›‹›€ÿ⁄‘äN¬à€€ú›ûH\›àçH»»\›
ààà¬à€€ú›ûHH\›àçH»H»\›
ààà¬àùî›ÿ\\ôŸ]ú›[Kùò[úŸõ‹õHHò[ú€]Jÿ[ L	H
»	€û\
Kÿ[ L	H
»	€û_\
JX¬àYà
W‹›òY»	âà\›à’—êQ◊’ëT“
H¬à‹›òY»HùYN¬à›ÿ\]]’\ôŸ]
X]ò][åäK
JN¬àBàJN¬àù[ò›[€à‹›\
]äH¬àYà
]ãú⁄[ù\íYOOH‹›Y
Hô]\õé¬à‹›YHù[¬àYà
‹›€ÿ⁄Ÿ]
H»‹›€ÿ⁄Ÿ]úô[[›ôJ
N»‹›€ÿ⁄Ÿ]Hù[»Bàùî›ÿ\\ôŸ]ú›[Kùò[ú⁄][€àH	›ò[úŸõ‹õHåM»X\ŸK[›]	Œ¬àùî›ÿ\\ôŸ]ú›[Kùò[úŸõ‹õHH	›ò[ú€]JL	KL	JIŒ¬àŸ][Y[›]


HOà»ùî›ÿ\\ôŸ]ú›[Kùò[ú⁄][€àH	…Œ»ùî›ÿ\\ôŸ]ú›[Kùò[úŸõ‹õHH	…Œ»KML
N¬àYà
W‹›òY H›ÿ\]]’\ôŸ]
^Y\ãò[ô€JN¬à‹›òY»Hò[ŸN¬àBàùî›ÿ\\ôŸ]òY]ô[ù\›[ô\ä	‹⁄[ù\ù\	À‹›\
N¬àùî›ÿ\\ôŸ]òY]ô[ù\›[ô\ä	‹⁄[ù\òÿ[òŸ[	À‹›\
N¬àBÇà€€ú›\⁄›‹\⁄[ô›”\»H

HOàù[Xô\ä\⁄›‹€€ùõ€–€€ôöY 
Kù\⁄[ô›”\ HÕL¬à]\⁄›‹[ù[ù\òX›[Hò[ŸN»À»\ŸY»ô\Ÿ\ùôHH[\⁄›‹[ù\òX›ô\‹»õ‹àHôX\òûHò[ô][ù[ú›XYŸà‹[ö[ô»H€€Ÿ[X›⁄Y[Çà€€ú›\⁄›‹€Ÿ^\»H¬àNà»›€éàò[ŸK[àò[ŸK[Y\éàù[\òŒà	⁄][I»KàNà»›€éàò[ŸK[àò[ŸK[Y\éàù[\òŒà	›€€	»KàÀ»][]Y\»⁄Y[8†%[à[ùöY\»\ò»ZŸH›[€ãÿ[[[»Ÿ[X›õ›BàÀ»€€⁄][H⁄Y[€»]€€[Z]»öXHô[X\ŸTŸ[X›[€ä
Hô[›¬àÀ»
⁄X⁄]ô\à[ùûH[›\ŸKYòYÀ‹ÿ‹õ€\›Y⁄Y⁄Y
H[ú›XYŸÇàÀ»€‹ŸJ
I‹»ò[ôXYH\YY]ôKù\›\€Z\‹»àôZ]ö[‹ãÇàŒà»›€éàò[ŸK[àò[ŸK[Y\éàù[\òŒà	›][]Y\…»KàN¬àù[ò›[€à‹[ë\⁄›‹€\ò Ÿ^JH¬à€€ú››]HH\⁄›‹€Ÿ^\÷⁄Ÿ^WN¬àYà
\›]H\›]Kô›€äHô]\õé¬à›]Kö[HùYN¬àYà
›]Kò\ò»OOH	›][]Y\… H¬àÀ»ÿ[YHôX\€€ö[ô»\»€€⁄⁄[ô‘ﬁ\›[I‹»Ÿ][ù\òX›[€êõÿ⁄ŸYXõ›ôH8†%àÀ»õ»ö\⁄XõH›\ú€‹à»X⁄»HŸYŸH⁄][ô\à›\ú€‹ã[\‹»ÿ[Y\òBàÀ»⁄[ù\àÿ⁄»›\ù⁄\ŸKÇàô[X\ŸT⁄›[\î›\ôî⁄[ù\ìÿ⁄ 
N¬à⁄[ô›ÀóŸ\⁄›‹Ÿ[X›[€ê\òœÀõ‹[ï][]Y\ 
N¬àBà[ŸHYà
›]Kò\ò»OOH	⁄][I»	âàX›]ôU€€OOH	‹ò[ôŸY	 H⁄[ô›ÀóŸ\⁄›‹Ÿ[X›[€ê\òœÀõ‹[ê[[[ 
N¬à[ŸHYà
›]Kò\ò»OOH	⁄][I H⁄[ô›ÀóŸ\⁄›‹Ÿ[X›[€ê\òœÀõ‹[í][J
N¬à[ŸH⁄[ô›ÀóŸ\⁄›‹Ÿ[X›[€ê\òœÀõ‹[ï€€

N¬àBàù[ò›[€à›\ù\⁄›‹€Ÿ^JŸ^K]ô[ù
H¬à€€ú››]HH\⁄›‹€Ÿ^\÷⁄Ÿ^WN¬àYà
\›]H›]Kô›€à]ô[ùúô\X]
Hô]\õé¬à›]Kô›€àHùYN¬à›]Kö[Hò[ŸN¬à›]Kù[Y\àHŸ][Y[›]


HOà‹[ë\⁄›‹€\ò Ÿ^JK\⁄›‹\⁄[ô›”\ 
JN¬àBàù[ò›[€àö[ö\⁄\⁄›‹€Ÿ^JŸ^JH¬à€€ú››]HH\⁄›‹€Ÿ^\÷⁄Ÿ^WN¬àYà
\›]H\›]Kô›€äHô]\õàò[ŸN¬à›]Kô›€àHò[ŸN¬àYà
›]Kù[Y\äH»€X\ï[Y[›]
›]Kù[Y\äN»›]Kù[Y\àHù[»Bà€€ú›ÿ\“[H›]Kö[¬à›]Kö[Hò[ŸN¬àYà
ÿ\“[
H¬àYà
›]Kò\ò»OOH	›][]Y\… H⁄[ô›ÀóŸ\⁄›‹Ÿ[X›[€ê\òœÀúô[X\ŸTŸ[X›[€ä
N¬à[ŸHYà
›]Kò\ò»OOH	⁄][I»	âàX›]ôU€€OOH	‹ò[ôŸY	 H⁄[ô›ÀóŸ\⁄›‹Ÿ[X›[€ê\òœÀúô[X\ŸTŸ[X›[€ä
N¬à[ŸH⁄[ô›ÀóŸ\⁄›‹Ÿ[X›[€ê\òœÀò€‹ŸJ
N¬àBàYà
ÿ\“[	âà›]Kò\ò»OOH	›][]Y\…»	âà›\ú€‹õ\‹”[›\ŸPZ[Tô\]Y\›Y

JH¬àô\]Y\›⁄›[\î›\ôî⁄[ù\ìÿ⁄ 
N¬àBàô]\õàÿ\“[¬àBÇà€€ú›SîU—QêUS»H


HOà¬à€€ú›Ÿô»H⁄[ô›Àî–‘êU“ì”ëT◊–””ëíQœÀôÿ[YOÀö[ú]ﬂN¬à€€ú›X›[€ú»H\úò^Kö\–\úò^JŸôÀòX›[€ú H»ŸôÀòX›[€ú»à◊N¬àô]\õà¬à›‹òYŸRŸ^NàŸôÀú›‹òYŸRŸ^H	‹ÿ‹ò]⁄õ€ô\Àö[ú]ö[ô[ô‹ÀùåIÀàXYõ€ôNàù[Xô\äŸôÀôÿ[Y\YXYõ€ôJHåçà^\‘ô\‹’ô\⁄€àù[Xô\äŸôÀò^\‘ô\‹’ô\⁄€
HçMKàX›[€úÀà\⁄›‹àÿöôX›ôúõ€Q[ùöY\ X›[€úÀõX\
HOàÿKöYKô\⁄›‹JKôö[\ä
ÀóJHOàäJKà€€ùõ€\éàÿöôX›ôúõ€Q[ùöY\ X›[€úÀõX\
HOàÿKöYKò€€ùõ€\óJKôö[\ä
ÀóJHOàäJKà[ŸT⁄YùŒà\úò^Kö\–\úò^JŸôÀõ[ŸT⁄Yù H»ŸôÀõ[ŸT⁄Yù»à◊BàN¬àJJ
N¬à€€ú›[ú]ö[ô[ô‹»HÿY[ú]ö[ô[ô‹ 
N¬à€€ú›ÿ[Y\Y›]HH»õÿ›\ŸYàÿ›[Y[ùö\—õÿ›\ 
Kô]ö[›\Œàô]»Ÿ]

KX›]ôT⁄Yùàù[YYàò[ŸHN¬à€€ú›””ïì”Tó“SîU”‘S”î»H¬à	–ù]€å	À	–ù]€åIÀ	–ù]€åâÀ	–ù]€å…À	–ù]€ç	À	–ù]€çIÀà	”YùöYŸŸ\âÀ	‘öY⁄öYŸŸ\âÀà	–ù]€é	À	–ù]€éIÀ	–ù]€åL	À	–ù]€åLIÀà	–ù]€åLâÀ	–ù]€åL…À	–ù]€åM	À	–ù]€åMIÀà	‘öY⁄›X⁄”Yù	À	‘öY⁄›X⁄‘öY⁄	À	‘öY⁄›X⁄’\	À	‘öY⁄›X⁄—›€â¬àN¬Çàù[ò›[€àÿY[ú]ö[ô[ô‹ 
H¬àûH¬à€€ú›ÿ]ôYHî””ãú\úŸJÿÿ[›‹òYŸKôŸ]][JSîU—QêUSÀú›‹òYŸRŸ^JH	€ù[	 N¬àô]\õà¬à\⁄›‹à»ããíSîU—QêUSÀô\⁄›‹ããäÿ]ôYÀô\⁄›‹ﬂJHKà€€ùõ€\éà»ããíSîU—QêUSÀò€€ùõ€\ãããäÿ]ôYÀò€€ùõ€\àﬂJHKà[ŸT⁄YùŒà\úò^Kö\–\úò^Jÿ]ôYÀõ[ŸT⁄Yù H»ÿ]ôYõ[ŸT⁄Yù»àSîU—QêUSÀõ[ŸT⁄Yù¬àN¬àHÿ]⁄
Ÿ\úäH¬àô]\õà»\⁄›‹à»ããíSîU—QêUSÀô\⁄›‹K€€ùõ€\éà»ããíSîU—QêUSÀò€€ùõ€\àK[ŸT⁄YùŒàSîU—QêUSÀõ[ŸT⁄Yù»N¬àBàBàù[ò›[€àÿ]ôR[ú]ö[ô[ô‹ 
H¬àÿÿ[›‹òYŸKúŸ]][JSîU—QêUSÀú›‹òYŸRŸ^Kî””ãú›ö[ô⁄YûJ[ú]ö[ô[ô‹ JN¬àBàù[ò›[€àö[ô[ô–€€ôõX›
]öXŸKù]€ãX›[€íY[ŸT⁄YùHù[
H¬àYà
Xù]€äHô]\õà	…Œ¬àYà
[ŸT⁄Yù	âàù]€àOOH[ŸT⁄Yùòù]€äHô]\õà	‘⁄YùY[ú]ÿ[õõ›\ŸH]»[[ŸK\⁄Yùù]€ãâŒ¬à€€ú›ö[ô[ô‹»H[ú]ö[ô[ô‹÷Ÿ]öXŸWHﬂN¬àõ‹à
€€ú›€›\êX›[€ã›\êù]€óHŸàÿöôX›ô[ùöY\ ö[ô[ô‹ JH¬àYà
›\êX›[€àOOHX›[€íY	âà›\êù]€àOOHù]€äHô]\õà[ôXYHõ›[ô»	ÿX›[€ìXô[
›\êX›[€ä_Kò¬àBàYà
[[ŸT⁄Yù
Hô]\õà	…Œ¬àõ‹à
€€ú›€›\êù]€ã›\êX›[€óHŸàÿöôX›ô[ùöY\ [ŸT⁄Yùòö[ô[ô‹»ﬂJJH¬àYà
›\êX›[€àOOHX›[€íY	âà›\êù]€àOOHù]€äHô]\õà[ôXYHõ›[ô»	ÿX›[€ìXô[
X›[€íY
_H[à\»[ŸH⁄Yùò¬àBàô]\õà	…Œ¬àBàù[ò›[€àX›[€ìXô[
Y
H¬àô]\õàSîU—QêUSÀòX›[€úÀôö[ô
HOàKöYOOHY
OÀõXô[Y¬àBàù[ò›[€àù]€ìXô[
€ŸJH¬à€€ú›Xô[»H»YùöYŸŸ\éà	”	ÀöY⁄öYŸŸ\éà	‘ï	ÀöY⁄›X⁄”Yùà	‘î»8°§	ÀöY⁄›X⁄‘öY⁄à	‘î»8°§âÀöY⁄›X⁄’\à	‘î»8°§IÀöY⁄›X⁄—›€éà	‘î»8°§…À⁄Y[\à	’⁄Y[8°§IÀ⁄Y[›€éà	’⁄Y[8°§…»N¬àô]\õàXô[÷ÿ€ŸWH›ö[ô €ŸH	’[òõ›[ô	 Kúô\XŸJ◊íŸ^KÀ	… Kúô\XŸJ◊ëY⁄]À	… Kúô\XŸJ◊êù]€ãÀ	‘Y	 N¬àBÇàÀ»8• 8• \›]\ŸY[ú]]öXŸHòX⁄⁄[ô»8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• àÀ»õ›[ô»[ŸH[àHÿ[YHòX⁄‹»ù⁄]]öXŸH\»H^Y\àX›X[BàÀ»\⁄[ô»öY⁄õ›»à8†%\—\⁄›‹
ŸYH‹Ÿàö[JH\»H€ôK][YBàÀ»⁄[ù\éôö[ôHYYXK\]Y\ûH⁄X⁄Àõ›ôXX›]ôH»›⁄]⁄[ô»ô]ŸY[ÇàÀ»[›\ŸK›X⁄[ôHYŸŸYZ[à€€ùõ€\àZY\Ÿ\‹⁄[€ãàö]ô\¬àÀ»⁄›–X›[€îõ€\ô[›»€»]»úô\‹»à^X]⁄\»⁄]]ô\àBàÀ»^Y\à\›X›X[Hô\‹ŸYõ›ù\›Z\à]öXŸH€\‹ÀÇà]\›[ú]]öXŸHH\—\⁄›‹»	Ÿ\⁄›‹	»à	››X⁄	Œ¬à⁄[ô›ÀòY]ô[ù\›[ô\ä	‹⁄[ù\ô›€âÀ
JHOà¬àYà
Kú⁄[ù\ï\HOOH	››X⁄	 H\›[ú]]öXŸHH	››X⁄	Œ¬à[ŸHYà
Kú⁄[ù\ï\HOOH	€[›\ŸI»Kú⁄[ù\ï\HOOH	‹[â H\›[ú]]öXŸHH	Ÿ\⁄›‹	Œ¬àK»ÿ\\ôNàùYK\‹⁄]ôNàùYHJN¬à⁄[ô›ÀòY]ô[ù\›[ô\ä	⁄Ÿ^Y›€âÀ

HOà»\›[ú]]öXŸHH	Ÿ\⁄›‹	Œ»K»ÿ\\ôNàùYHJN¬àÀ»€€ùõ€\àô\‹Ÿ\»\ôHX\öŸY[à€€€ùõ€\í[ú]

H]Ÿ[à
ŸYBàÀ»ô[› K⁄[òŸH]	‹»H€õHXŸH[àX›X[ù]€ãY›€àYŸH\¬àÀ»]X›Yò]\à[àù\›€€ù[ù[›\»›X⁄»›]KÇÇàÀ»8• 8• €€ù^X[õ›€K[Ÿã\ÿ‹ôY[àX›[€àõ€\8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• àÀ»Ÿ[ô\öX»úô\‹»»»Hàõ€\⁄\ôYX‹õ‹‹»Hÿ[YH
ö\⁄[ô»\¬àÀ»Hö\ú›ÿ[\ãŸYHôY⁄[ëö\⁄[ô–ÿ\›‹ô[ô\ëö\⁄[ô”›ô\õ^JH8†%àÀ»ô\€€ô\»]»›€àŸ^Kÿù]€ã⁄X€€àXô[úõ€H\›[ú]]öXŸH€¬àÀ»ÿ[\ú»€õH]ô\à\ÿ‹öXôH
ù⁄]
àHX›[€àŸ\Àô]ô\à›»¬àÀ»öYŸŸ\à]€à[ûH\ùX›[\à]öXŸKÇà]X›[€îõ€\[»Hù[¬àù[ò›[€àùZ[X›[€îõ€\€J
H¬àYà
X›[€îõ€\[ Hô]\õé¬à€€ú›[Hÿ›[Y[ùôŸ][[Y[ùûRY
	ÿX›[€îõ€\	 N¬àYà
Y[
Hô]\õé¬àÀ»€‹õõ€\»\ŸHHÿ[YH›X⁄ŸY\›\õ›»ôX]Y[ù\»Y\ò⁄[ùàÀ»X[Ÿ›YH⁄⁄XŸ\À[ò€Y[ô»⁄[à\ôH\»€õH€ôH]òZ[XõHX›[€ãÇà[ö[õô\íSHà]à€\‹œHò\[\›èÇàù]€à€\‹œHôÀ[‹À[‹]ö\⁄XõH\]€‹õ[‹[€à\XùààYHò\ùàèèÿù]€èÇàù]€à€\‹œHôÀ[‹À[‹]ö\⁄XõH\]€‹õ[‹[€à\Xÿ[òŸ[àYHò\ÿ[òŸ[èèÿù]€èÇàŸ]èÇà]à€\‹œHò\\›]\»àYHò\›]\»èèŸ]èÇà]à€\‹œHò\\[öXÀ]‹ò\àYHò\[öX’‹ò\èè]à€\‹œHò\\[öXÀYö[àYHò\[öX—ö[èèŸ]èèŸ]èò¬àX›[€îõ€\[»H¬à[àùéàÿ›[Y[ùôŸ][[Y[ùûRY
	ÿ\ùâ Kàÿ[òŸ[àÿ›[Y[ùôŸ][[Y[ùûRY
	ÿ\ÿ[òŸ[	 Kà›]\Œàÿ›[Y[ùôŸ][[Y[ùûRY
	ÿ\›]\… Kà[öX’‹ò\àÿ›[Y[ùôŸ][[Y[ùûRY
	ÿ\[öX’‹ò\	 Kà[öX—ö[àÿ›[Y[ùôŸ][[Y[ùûRY
	ÿ\[öX—ö[	 KàN¬àBàÀ»ôX[Ÿ^Kÿù]€àXô[€à\⁄›‹ÿ€€ùõ€\ãZŸ[àúõ€HBàÀ»^Y\â‹»X›X[›\úô[ùö[ô[ô‹»
õ›ù\›HYò][ H€»BàÀ»ôXõ›[ôŸ^H⁄›‹»€‹úôX›H\ôH€Àà›X⁄\»õ»Ÿ^H»ò[YK€¬àÀ»ÿ[\ú»\‹»Hÿ[YHX€€à[ôXYH⁄›€àõ‹à]X›[€à[àBàÀ»€€\ò⁄
ŸYHKôÀàH\ú€€â‹»<'„®»ò[òX⁄»[à€‹[ï€€\ò KÇàù[ò›[€àX›[€îõ€\€\
X›[€íY›X⁄X€€äH¬àYà
\›[ú]]öXŸHOOH	ÿ€€ùõ€\â Hô]\õàù]€ìXô[
[ú]ö[ô[ô‹Àò€€ùõ€\ñÿX›[€íYJN¬àYà
\›[ú]]öXŸHOOH	››X⁄	 Hô]\õà›X⁄X€€à	¸'‰aâŒ¬àô]\õàù]€ìXô[
[ú]ö[ô[ô‹Àô\⁄›‹ÿX›[€íYJN¬àBàù[ò›[€àX›[€îõ€\€€‹äX›[€íY
H¬àô]\õà⁄[ô›ÀêX›[€ê\ò⁄€›€€‹úœÀö[ú]€€‹úœÀñÿX›[€íYH	»–éÕPÃ	Œ¬àBàù[ò›[€à⁄›–X›[€îõ€\
»X›[€íY›X⁄X€€ãô\òã€îô\‹Àÿ[òŸ[^€êÿ[òŸ[›]\’^›]\’\K[öX‘\òŸ[ùJH¬àùZ[X›[€îõ€\€J
N¬àYà
XX›[€îõ€\[ Hô]\õé¬à€€ú›€\HX›[€îõ€\€\
X›[€íY›X⁄X€€äN¬àÀ»[õô\íSõ›^€€ù[ùà›X⁄X€€àX^HôHHôX[[YœàY»
ŸYBàÀ»]X⁄–X›[€íX€€íS
H⁄[àHÿ[\àÿ[ù»\»»Z\úõ‹àBàÀ»\ò»ù]€â‹»X›X[\]Z\Y]€€‹ö]H[ú›XYŸàHZ[à[[⁄öBàÀ»8†%ÿ[\ú»€õH]ô\à\‹»›]X»]ô[‹\à›ö[ô‹»\ôKô]ô\ÇàÀ»[ùù\›Y[ú]€»\»\»ÿYôKÇàX›[€îõ€\[Àòùãö[õô\íSH\›[ú]]öXŸHOOH	››X⁄	»»	Ÿ€\H	›ô\òüXà…Ÿ€\WH	›ô\òüX¬àX›[€îõ€\[Àòùãõ€ú⁄[ù\ù\H
JHOà»Kú›‹õ‹Yÿ][€ä
N»€îô\‹œÀä
N»N¬àYà
ÿ[òŸ[^	âà€êÿ[òŸ[
H¬àX›[€îõ€\[Àòÿ[òŸ[ù^€€ù[ùHÿ[òŸ[^¬àX›[€îõ€\[Àòÿ[òŸ[ú›[Kô\‹^HH	…Œ¬àX›[€îõ€\[Àòÿ[òŸ[õ€ú⁄[ù\ù\H
JHOà»Kú›‹õ‹Yÿ][€ä
N»€êÿ[òŸ[

N»N¬àH[ŸH¬àX›[€îõ€\[Àòÿ[òŸ[ú›[Kô\‹^HH	€õ€ôIŒ¬àX›[€îõ€\[Àòÿ[òŸ[õ€ú⁄[ù\ù\Hù[¬àBàYà
›]\’^
H¬àX›[€îõ€\[Àú›]\Àù^€€ù[ùH›]\’^¬àX›[€îõ€\[Àú›]\Àò€\‹”ò[YHH	ÿ\\›]\…»
»
›]\’\H»	»	»
»›]\’\Hà	… N¬àX›[€îõ€\[Àú›]\Àú›[Kô\‹^HH	…Œ¬àH[ŸH¬àX›[€îõ€\[Àú›]\Àú›[Kô\‹^HH	€õ€ôIŒ¬àBàYà
[öX‘\òŸ[ùOHù[
H¬àX›[€îõ€\[Àú[öX’‹ò\ú›[Kô\‹^HH	…Œ¬àX›[€îõ€\[Àú[öX—ö[ú›[Kù⁄YH[öX‘\òŸ[ù
»	…IŒ¬àH[ŸH¬àX›[€îõ€\[Àú[öX’‹ò\ú›[Kô\‹^HH	€õ€ôIŒ¬àBàX›[€îõ€\[Àô[ò€\‹”\›òY
	€‹[â N¬àBàù[ò›[€àYPX›[€îõ€\

H¬àYà
XX›[€îõ€\[ Hô]\õé¬àX›[€îõ€\[Àô[ò€\‹”\›úô[[›ôJ	€‹[â N¬àX›[€îõ€\[Àòùãõ€ú⁄[ù\ù\Hù[¬àX›[€îõ€\[Àòÿ[òŸ[õ€ú⁄[ù\ù\Hù[¬àBàÀ»ô\€€ôHHX›[€à›\úô[ùHô[ô\ôY[àH\⁄Xÿ[\ò⁄ù]€ãÇàÀ»Hö\⁄XõH›X⁄»\»‹][ù»€€⁄][Hõ›‹À€»€€\]PX›[€êù]€ú 
BàÀ»[ô^\»õ›ôXŸ\‹ÿ\ö[HùêX›[€åH[û[[‹ôKÇàù[ò›[€àX›[€êù]€ëõ‹î\⁄Xÿ[€›
€›[ô^
H¬à€€ú›[Hÿ›[Y[ùôŸ][[Y[ùûRY
	ÿùêX›[€â»
»€›[ô^
N¬à€€ú›X›[€àH[Àô]\Ÿ]òX›[€é¬à€€ú›ù]€ú»H€€\]PX›[€êù]€ú 
N¬àô]\õà
X›[€à	âàù]€úÀôö[ô
àOàãòX›[€àOOHX›[€äJHù]€ú÷‹€›[ô^HWHù[¬àBàù[ò›[€àù[êX›[€êù]€ê]€›
€›[ô^
H¬à€€ú›ùàHX›[€êù]€ëõ‹î\⁄Xÿ[€›
€›[ô^
N¬àYà
Xùàùãò[›ŸYOOHò[ŸJHô]\õé¬àX›]ôPX›[€àHùãòX›[€é¬àX›[€í[›€àH€›[ô^OOHN¬à\ŸPX›]ôPX›[€ä
N¬àBàù[ò›[€àù[í[ù\òX›X›[€ä
H¬àÀ»[ù\òX›\»ô\Ÿ\ùôYõ‹à€‹õ\ôŸ]»›X⁄\»€‹úÀî‹À[ôàÀ»ù\õö]\ôKà€€›⁄[ô‹»[ô]ô\ûH[Z][HX›[€à\ŸHX›[€à€›ÀÇà€€ú›€€Ÿ]Hô]»Ÿ]
ÿöôX›ùò[Y\ €€X›[€ú Kôõ]

JN¬à€€ú›\“][PX›[€àHX›[€àOàX›[€àOOH	ÿ€€ú›[YW⁄[⁄][I»X›[€àOOH	ÿ€€ú›[YWŸõ€Ÿ⁄][I»X›[€àOOH	‹^W⁄[ú›ù[Y[ù	¬àX›[€àOOH	⁄\ùô\›	¬àX›[€ãú›\ù’⁄]
	ÿ[⁄[^WŸõ\⁄◊… Bà◊äŒú[ùﬂXŸWﬂ‹]€ó KÀù\›
X›[€äN¬à€€ú›ùàH€€\]PX›[€êù]€ú 
Kôö[ô
àOàãò[›ŸYOOHò[ŸBà	âà]€€Ÿ]ö\ ãòX›[€äH	âàZ\“][PX›[€äãòX›[€äJN¬àYà
XùäHô]\õé¬àX›]ôPX›[€àHùãòX›[€é¬à\ŸPX›]ôPX›[€ä
N¬àBàù[ò›[€àﬁX€PX›]ôU€€
[JH¬à€€ú›YH“QS‘”’Àö[ô^ŸäX›]ôU€€
N¬à€€ú›ô^H
Y
»[H
»“QS‘”’Àõ[ô›
H	H“QS‘”’Àõ[ô›¬àŸ]X›]ôU€€
“QS‘”’÷€ô^JN¬àBàÀ»X›[€åKÿX›[€åà⁄[H⁄Y[[ô»HŸX\€à€€õ›]Hõ›Y⁄àÀ»€€Xò]ö[ú]	‹»\⁄€›]HXX⁄[ôH
ŸYH€€Xò]Z[ú]öú H8†%ÿ[YBàÀ»\»H\⁄›‹[›\ŸKX€X⁄»[ô\àù\›Xõ›ôH\»ù[ò›[€à[ôXYBàÀ»Ÿ\»õ‹àù]€àÃà8†%[ú›XYŸàù[êX›[€êù]€ê]€›	‹»⁄[ô€BàÀ»[[YYX]H\ŸPX›]ôPX›[€ä
Hÿ[⁄X⁄\»õ»€€òŸ\Ÿàö[à]àÀ»[à⁄]›]\À[ûH]öXŸH⁄‹ŸHX›[€åKÿX›[€åà€Ÿ\»õ›Y⁄àÀ»ù[í[ú]X›[€à
Ÿ^Xõÿ\ô‹XŸK]ô\ûH€€ùõ€\àöYŸŸ\äH€›[àÀ»ô]ô\àöYŸŸ\àH€\€›Xö[]Nàô\‹»
ò[ô
àô[X\ŸHõ›ö\ôYàÀ»Hÿ[YH[ú›[ù\à]ô\ûH›\à€€ŸY\»]»ô]ö[›\¬àÀ»[ú›[ùYö\ôHôZ]ö[‹à[ò⁄[ôŸYÇàù[ò›[€àŸX\€êX›[€î€›
X›[€íY
H¬àYà
JX›[€íYOOH	ÿX›[€åI»X›[€íYOOH	ÿX›[€åâ JHô]\õà¬àYà
[[ŸHOOH	›€€	»X›]ôU€€OOH	›ŸX\€â»]⁄[ô›Àê€€Xò]Àö[ú]
Hô]\õà¬àô]\õàX›[€íYOOH	ÿX›[€åI»»Hàé¬àBàù[ò›[€àö\⁄XõPX›[€ì›ô\úöYQõ‹ïŸX\€î€›
X›[€íY
H¬à€€ú›€›HŸX\€êX›[€î€›
X›[€íY
N¬àYà
\€›
Hô]\õàù[¬à€€ú›ù]€àHX›[€êù]€ëõ‹î\⁄Xÿ[€›
€›
N»À»ô\Ÿ\ùôHH€‹õX€€ù^X›[€àX›X[Hô[ô\ôY[à\»\⁄Xÿ[ŸX\€à€›ÇàYà
Xù]€àù]€ãò[›ŸYOOHò[ŸHù]€ãòX›[€àOOH€€X›[€úÀùŸX\€ñ‹€›HWJHô]\õàù[¬àô]\õà»€›ù]€àN¬àBà€€ú›ö\⁄XõUŸX\€ê€€ù^ô\‹Ÿ\»Hô]»Ÿ]

N»À»\ŸY»Z\àH€€ù^›ô\úöYI‹»ô\‹À‹ô[X\ŸH⁄]›]Ÿ[ô[ô»[à[õX]⁄Yô[X\ŸH[ù»€€Xò]ö[ú]Çà€€ú›ò[ôŸY[[[–X›[€åîô\‹»H»›€éàò[ŸK[àò[ŸK[Y\éàù[\›ÿ‹õ€]àN»À»⁄\ôYŸ^Xõÿ\ôÿ€€ùõ€\à€›]Hõ‹àH‹ô[ò\ûH[[[À\Ÿ[X›[€à\ò⁄Çà€€ú››[€êX›[€å‘ô\‹»H»›€éàò[ŸK[àò[ŸK[Y\éàù[\›ÿ‹õ€]àN»À»€€X›[€à»Ÿ[X›‹àZ\úõ‹ú»Hõ‹õX[[€€⁄][H[ŸH⁄YùÇà€€ú›€€Ÿ[X›ô\‹»H»›€éàò[ŸK[àò[ŸK[Y\éàù[\›ÿ‹õ€]àN»À»‹õ‹‹ÀZ[ú]€€Ÿ[X›\⁄€\›[ò›[€ãÇàù[ò›[€à›[€îŸ[X›‹ê]òZ[XõJX›[€íY
H¬àô]\õàX›[€íYOOH	ÿX›[€å…»	âà[[ŸHOOH	›€€	»	âà
X›]ôU€€OOH	›ŸX\€â»X›]ôU€€OOH	‹ò[ôŸY	 Bà	âà€€\]PX›[€êù]€ú 
Kú€€YJù]€àOàù]€ãòX›[€àOOH	‹›[€ó‹Ÿ[X›	»	âàù]€ãò[›ŸY
N¬àBàù[ò›[€àù[í[ú]X›[€äX›[€íY\ŸHH	‹ô\‹… H¬àYà
X›[€íYOOH	›€€Ÿ[X›	 H¬àYà
\ŸHOOH	‹ô[X\ŸI H¬àYà
]€€Ÿ[X›ô\‹Àô›€äHô]\õé¬à€€Ÿ[X›ô\‹Àô›€àHò[ŸN¬àYà
€€Ÿ[X›ô\‹Àù[Y\äH»€X\ï[Y[›]
€€Ÿ[X›ô\‹Àù[Y\äN»€€Ÿ[X›ô\‹Àù[Y\àHù[»BàYà
€€Ÿ[X›ô\‹Àö[
H⁄[ô›ÀóŸ\⁄›‹Ÿ[X›[€ê\òœÀò€€[Z]

N¬à[ŸH⁄[ô›ÀóŸ\⁄›‹Ÿ[X›[€ê\òœÀúôXÿ[\›€€Àä
N¬à€€Ÿ[X›ô\‹Àö[Hò[ŸN¬àô]\õé¬àBàYà
€€Ÿ[X›ô\‹Àô›€äHô]\õé¬à€€Ÿ[X›ô\‹Àô›€àHùYN»€€Ÿ[X›ô\‹Àö[Hò[ŸN¬à€€Ÿ[X›ô\‹Àù[Y\àHŸ][Y[›]


HOà¬àYà
]€€Ÿ[X›ô\‹Àô›€äHô]\õé¬à€€Ÿ[X›ô\‹Àö[HùYN¬à⁄[ô›ÀóŸ\⁄›‹Ÿ[X›[€ê\òœÀõ‹[ï€€Àä
N¬àK\⁄›‹\⁄[ô›”\ 
JN¬àô]\õé¬àBàYà
⁄[ô›ÀóŸ\⁄›‹Ÿ[X›[€ê\òœÀù€€Y[ùS‹[èÀä
JH¬à€€ú›\’€€úõ›‹ŸPX›[€àH…ÿX›[€åIÀ	ÿX›[€åâÀ	⁄][Tô]âÀ	⁄][Sô^	À	›€€ô]âÀ	›€€ô^	◊Kö[ò€Y\ X›[€íY
N»À»Ÿ^Xõÿ\ôúõ›‹⁄[ô»Z\úõ‹ú»€€ùõ€\à›X⁄»Ÿ[X›[€à⁄[H€€Ÿ[X›\»[ÇàYà
\’€€úõ›‹ŸPX›[€à	âà\ŸHOOH	‹ô\‹… H¬àYà
X›[€íYOOH	ÿX›[€åI H⁄[ô›ÀóŸ\⁄›‹Ÿ[X›[€ê\òÀò€€[Z]

N¬à[ŸHYà
X›[€íYOOH	ÿX›[€åâ H⁄[ô›ÀóŸ\⁄›‹Ÿ[X›[€ê\òÀò€‹ŸJ
N¬à[ŸH⁄[ô›ÀóŸ\⁄›‹Ÿ[X›[€ê\òÀúÿ‹õ€€€
X›[€íYOOH	⁄][Tô]â»X›[€íYOOH	›€€ô]â»»LHàJN¬àBàYà
\’€€úõ›‹ŸPX›[€äHô]\õé¬àBàYà
›[€îŸ[X›‹ê]òZ[XõJX›[€íY
H
X›[€íYOOH	ÿX›[€å…»	âà›[€êX›[€å‘ô\‹Àô›€äJH¬àYà
\ŸHOOH	‹ô[X\ŸI H¬àYà
\›[€êX›[€å‘ô\‹Àô›€äHô]\õé¬à›[€êX›[€å‘ô\‹Àô›€àHò[ŸN¬àYà
›[€êX›[€å‘ô\‹Àù[Y\äH»€X\ï[Y[›]
›[€êX›[€å‘ô\‹Àù[Y\äN»›[€êX›[€å‘ô\‹Àù[Y\àHù[»BàYà
›[€êX›[€å‘ô\‹Àö[
H⁄[ô›ÀóŸ\⁄›‹Ÿ[X›[€ê\òœÀúô[X\ŸTŸ[X›[€ä
N¬à⁄[ô›ÀóŸ\⁄›‹Ÿ[X›[€ê\òœÀô[ô[Ÿ[X›[€èÀä
N¬à›[€êX›[€å‘ô\‹Àö[Hò[ŸN¬àô]\õé¬àBàYà
›[€êX›[€å‘ô\‹Àô›€äHô]\õé¬à›[€êX›[€å‘ô\‹Àô›€àHùYN¬à›[€êX›[€å‘ô\‹Àö[HùYN»À»›[€àŸ[X›\»^€\⁄]ô[HH[Ÿ[X›‹é»]»õ€›⁄⁄XŸ\»⁄›[ôHö\⁄XõH[[YYX][KÇà⁄[ô›ÀóŸ\⁄›‹Ÿ[X›[€ê\òœÀòôY⁄[í[Ÿ[X›[€èÀä	‹›[€ú… N¬à⁄[ô›ÀóŸ\⁄›‹Ÿ[X›[€ê\òœÀõ‹[î›[€ú 
N¬àô]\õé¬àBàYà
⁄[ô›ÀóŸ\⁄›‹Ÿ[X›[€ê\òœÀô[ùûSY[ùS‹[èÀä
H	âàJX›[€íYOOH	ÿX›[€åâ»	âàX›]ôU€€OOH	‹ò[ôŸY	»	âàò[ôŸY[[[–X›[€åîô\‹Àô›€äH	âàJX›[€íYOOH	ÿX›[€å…»	âà›[€êX›[€å‘ô\‹Àô›€äJH¬à€€ú›\‘Ÿ[X›‹êX›[€àH…ÿX›[€åIÀ	ÿX›[€åâÀ	⁄[ù\òX›	À	⁄][Tô]âÀ	⁄][Sô^	À	›€€ô]âÀ	›€€ô^	◊Kö[ò€Y\ X›[€íY
N»À»€€[[€àŸ^Xõÿ\ôÿ€€ùõ€\àŸ[X›‹àõÿÿXù[\ûKÇàYà
\‘Ÿ[X›‹êX›[€à	âà\ŸHOOH	‹ô\‹… H¬àYà
X›[€íYOOH	ÿX›[€åI»X›[€íYOOH	⁄[ù\òX›	 H⁄[ô›ÀóŸ\⁄›‹Ÿ[X›[€ê\òÀò€€[Z]

N¬à[ŸHYà
X›[€íYOOH	ÿX›[€åâ H⁄[ô›ÀóŸ\⁄›‹Ÿ[X›[€ê\òÀò€‹ŸJ
N¬à[ŸH⁄[ô›ÀóŸ\⁄›‹Ÿ[X›[€ê\òÀúÿ‹õ€[ùöY\ X›[€íYOOH	⁄][Tô]â»X›[€íYOOH	›€€ô]â»»LHàJN¬àBàYà
\‘Ÿ[X›‹êX›[€äHô]\õé¬àBàÀ»€õH€Z[HX›[€ààõ‹à[[[»Ÿ[X›[€à⁄[à[[[»\»X›X[H⁄]àÀ»HŸX€€ô\⁄Xÿ[€›\‹^\Àà€‹õX€€ù^X›[€ú»
[ò€Y[ô¬àÀ»Húõ€ûô]€‹ö‹»€Z]JHô\XŸH]€›[ô]\›ô[XZ[à\ÿXõBàÀ»]ô[à⁄[HHò[ôŸY€€\»\]Z\YÇàYà

X›[€íYOOH	ÿX›[€åâ»	âà[[ŸHOOH	›€€	»	âàX›]ôU€€OOH	‹ò[ôŸY	¬à	âàX›[€êù]€ëõ‹î\⁄Xÿ[€›
äOÀòX›[€àOOH	ÿ[[[◊‹Ÿ[X›	 Hò[ôŸY[[[–X›[€åîô\‹Àô›€äH¬àYà
\ŸHOOH	‹ô[X\ŸI H¬àYà
\ò[ôŸY[[[–X›[€åîô\‹Àô›€äHô]\õé¬àò[ôŸY[[[–X›[€åîô\‹Àô›€àHò[ŸN¬àYà
ò[ôŸY[[[–X›[€åîô\‹Àù[Y\äH»€X\ï[Y[›]
ò[ôŸY[[[–X›[€åîô\‹Àù[Y\äN»ò[ôŸY[[[–X›[€åîô\‹Àù[Y\àHù[»BàYà
ò[ôŸY[[[–X›[€åîô\‹Àö[
H⁄[ô›ÀóŸ\⁄›‹Ÿ[X›[€ê\òœÀúô[X\ŸTŸ[X›[€ä
N¬à⁄[ô›ÀóŸ\⁄›‹Ÿ[X›[€ê\òœÀô[ô[Ÿ[X›[€èÀä
N¬àò[ôŸY[[[–X›[€åîô\‹Àö[Hò[ŸN¬àô]\õé¬àBàYà
ò[ôŸY[[[–X›[€åîô\‹Àô›€äHô]\õé¬àò[ôŸY[[[–X›[€åîô\‹Àô›€àHùYN¬àò[ôŸY[[[–X›[€åîô\‹Àö[HùYN»À»[[[»Ÿ[X›ZŸ]⁄\ŸH\»õ»€€\][ô»\X›[€à⁄[Hò[ôŸY\»ò]€ãÇà⁄[ô›ÀóŸ\⁄›‹Ÿ[X›[€ê\òœÀòôY⁄[í[Ÿ[X›[€èÀä	ÿ[[[… N¬à⁄[ô›ÀóŸ\⁄›‹Ÿ[X›[€ê\òœÀõ‹[ê[[[ 
N¬àô]\õé¬àBàYà
\ŸHOOH	‹ô[X\ŸI H¬àYà
X›[€íYOOH	ÿX›[€åI HX›[€í[›€àHò[ŸN¬àYà
ö\⁄XõUŸX\€ê€€ù^ô\‹Ÿ\Àô[]JX›[€íY
JHô]\õé¬à€€ú›ô[X\ŸT€›HŸX\€êX›[€î€›
X›[€íY
N¬àYà
ô[X\ŸT€›
H⁄[ô›Àê€€Xò]ö[ú]úô\‹—[ô
ô[X\ŸT€›
N¬àô]\õé¬àBàYà
⁄[ô›Àëö\⁄[ôœÀú›]OÀòX›]ôJH¬àYà
X›[€íYOOH	⁄[ù\òX›	»X›[€íYOOH	ÿX›[€åI H⁄[ô›Àëö\⁄[ôœÀúö[X\ûPX›[€ä
N¬àô]\õé¬àBàYà
Y[ùS‹[àò\õQY][ŸJHô]\õé¬àYà
X›[€íYOOH	⁄[ù\òX›	 H»ù[í[ù\òX›X›[€ä
N»ô]\õé»Bà€€ú›ö\⁄XõS›ô\úöYHHö\⁄XõPX›[€ì›ô\úöYQõ‹ïŸX\€î€›
X›[€íY
N»À»\ŸY€»€›“\ùô\›€›\à\‹^YY€€ù^X›[€ú»›]ò[ö»HŸX\€àõ‹õX[Hõ›[ô»\»€›ÇàYà
ö\⁄XõS›ô\úöYJH¬àö\⁄XõUŸX\€ê€€ù^ô\‹Ÿ\ÀòY
X›[€íY
N¬àù[êX›[€êù]€ê]€›
ö\⁄XõS›ô\úöYKú€›
N¬àô]\õé¬àBà€€ú›ŸX\€î€›HŸX\€êX›[€î€›
X›[€íY
N¬àYà
ŸX\€î€›
H¬àYà
X›[€íYOOH	ÿX›[€åI HX›[€í[›€àHùYN¬àûP]]—[ôÿYŸSY[YU\ôŸ]

N¬à⁄[ô›Àê€€Xò]ö[ú]úô\‹‘›\ù
ŸX\€î€›
N¬àô]\õé¬àBà€€ú›X›[€î€›H◊òX›[€ä
 IÀô^X X›[€íY
N¬àYà
X›[€î€›
H»ù[êX›[€êù]€ê]€›
ù[Xô\äX›[€î€›ÃWJJN»ô]\õé»BàYà
X›[€íYOOH	ŸŸŸI H»\ôõ‹õP€€ù^X›[€ä
N»ô]\õé»BàYà
X›[€íYOOH	›ŸŸ€S[›[ù	 H»⁄[ô›Àì[›[ùœÀùŸŸ€S[›[ù

N»ô]\õé»BàYà
X›[€íYOOH	‹›ÿ\\ôŸ]	 H¬à€€ú›Z[P[ô€HH€€ùõ€\ì€⁄–X›]ôH»€€ùõ€\ì€⁄–[ô€Bàà
\—\⁄›‹	âà[›\ŸS€⁄–X›]ôJH»[›\ŸS€⁄–[ô€BààòX⁄[ô–[ô€N¬à›ÿ\]]’\ôŸ]
Z[P[ô€JN¬àô]\õé¬àBàÀ»öY⁄\›X⁄»[
€€ùõ€\à€õH8†%\⁄›‹ﬁX€\»öXH⁄Yù
¬àÀ»⁄Y[[ú›XY
H8†%HõÀ[‹[õ\‹»Y[YH]]À]\ôŸ]\»[ôXYH€ãàÀ»\àﬁX€SY[YP]]’\ôŸ]	‹»›€àÿ]KÇàYà
X›[€íYOOH	€Y[YU\ôŸ]ô]â H»ﬁX€SY[YP]]’\ôŸ]
LJN»ô]\õé»BàYà
X›[€íYOOH	€Y[YU\ôŸ]ô^	 H»ﬁX€SY[YP]]’\ôŸ]
JN»ô]\õé»BàYà
X›[€íYOOH	ÿﬁX€U€€X›[€â H¬à€€ú›X›[€ú»H€€X›[€ú÷ÿX›]ôU€€N¬à€€ú›YHX›[€úÀö[ô^ŸäX›]ôPX›[€äN¬àX›]ôPX›[€àHX›[€ú÷ Y
»JH	HX›[€úÀõ[ô›N¬àôYúô\⁄X›[€êò\ä
N¬àô]\õé¬àBàYà
X›[€íYOOH	⁄][Tô]â»X›[€íYOOH	⁄][Sô^	 H¬àﬁX€PX›]ôR[ùô[ù‹ûR][JX›[€íYOOH	⁄][Tô]â»»LHàJN¬àôYúô\⁄][Tÿ‹õ€

N»ôYúô\⁄X›[€êò\ä
N»ô]\õé¬àBàYà
X›[€íYOOH	›€€ô]â»X›[€íYOOH	›€€ô^	 H»ﬁX€PX›]ôU€€
X›[€íYOOH	›€€ô]â»»LHàJN»ô]\õé»BàYà
X›[€íYOOH	›ŸX\€î›⁄]⁄	 H»ŸŸ€T]ZX⁄’ŸX\€î›⁄]⁄

N»ô]\õé»Bà€€ú›€€H»€€Nà	‹⁄›ô[	À€€éà	⁄ŸIÀ€€à	ÿ^IÀ€€Nà	‹X⁄…À€€éà	⁄\ú€€â»VÿX›[€íYN¬àYà
€€
HŸ]X›]ôU€€
€€
N¬àBàù[ò›[€àŸ]X›[€ëõ‹êù]€ä]öXŸKù]€ã[⁄YùHù[
H¬àYà
[⁄YùÀòö[ô[ô‹œÀñÿù]€óJHô]\õà[⁄Yùòö[ô[ô‹÷ÿù]€óN¬à€€ú›ö[ô[ô‹»H[ú]ö[ô[ô‹÷Ÿ]öXŸWHﬂN¬àô]\õàÿöôX›öŸ^\ ö[ô[ô‹ Kôö[ô
X›[€íYOàö[ô[ô‹÷ÿX›[€íYHOOHù]€äHù[¬àBàù[ò›[€à€€€ùõ€\í[ú]

H¬àYà
Yÿ[Y\Y›]Kôõÿ›\ŸY
Hô]\õé¬à€€ú›Y»Hò]öYÿ]‹ãôŸ]ÿ[Y\YœÀä
H◊N¬à€€ú›YH\úò^Kôúõ€JY Kôö[ô
õ€€X[äN¬àYà
\Y
H¬àÀ»€õH€X\à[›ô[Y[ù[ú]€à[àX›X[ÿ[Y\Y\ÿ€€õôX›õ›]ô\ûBàÀ»úò[YH8†%›\ù⁄\ŸH\»›€\»H›X⁄õﬁ\›X⁄»
[ôŸ^Xõÿ\ô
H€ÇàÀ»[ûH]öXŸH⁄]õ»ÿ[Y\Y⁄X⁄\»ö\ùX[H[[ÿö[H]öXŸ\ÀÇàYà
ÿ[Y\Y›]KöYY
H»[ú]ûH»[ú]ûHH»Bàÿ[Y\Y›]KöYYHò[ŸN¬àô]\õé¬àBàÿ[Y\Y›]KöYYHùYN¬à€€ú›àHSîU—QêUSÀôXYõ€ôN¬à€€ú›^HX]òXú Yò^\÷ÃH
HèHà»Yò^\÷ÃHà¬à€€ú›^HHX]òXú Yò^\÷ÃWH
HèHà»Yò^\÷ÃWHà¬à€€ú›ûHX]òXú Yò^\÷ÃóH
HèHà»Yò^\÷ÃóHà¬à€€ú›ûHHX]òXú Yò^\÷Ã◊H
HèHà»Yò^\÷Ã◊Hà¬à[ú]ûH^»[ú]ûHH^N¬à€€ùõ€\ì€⁄–X›]ôHHX]ö\›
ûûJHèHé¬àYà
⁄[ô›ÀóŸ\⁄›‹Ÿ[X›[€ê\òœÀô[ùûSY[ùS‹[èÀä
H	âà\ò[ôŸY[[[–X›[€åîô\‹Àö[	âà\›[€êX›[€å‘ô\‹Àö[	âàX]ö\›
ûûJHèHSîU—QêUSÀò^\‘ô\‹’ô\⁄€
H¬à€€ùõ€\ì€⁄–X›]ôHHò[ŸN¬à€€ú›õ›»H\ôõ‹õX[òŸKõõ› 
N¬àYà
õ›»H
€€€ùõ€\í[ú]ó‹Ÿ[X›[€ê\ò⁄[›ôY]
HèHåå
H¬à€€€ùõ€\í[ú]ó‹Ÿ[X›[€ê\ò⁄[›ôY]Hõ›Œ¬à€€ú›^\»HX]òXú û
HèHX]òXú ûJH»ûàûN»À»€Z[ò[ùöY⁄\›X⁄»\ôX›[€àYò[òŸ\»H⁄\ôY\ò⁄Çà⁄[ô›ÀóŸ\⁄›‹Ÿ[X›[€ê\òÀúÿ‹õ€[ùöY\ ^\»»LHàJN¬àBàBàYà
⁄[ô›Àê[⁄[^Qõ\⁄‹œÀòZ[Z[ô H¬à€€ùõ€\ì€⁄–X›]ôHHò[ŸN¬à⁄[ô›Àê[⁄[^Qõ\⁄‹ÀúŸ]\ôŸ]úõ€UôX›‹äûûKX]õZ[äKX]ö\›
ûûJJJN¬àBàYà
€€ùõ€\ì€⁄–X›]ôJH¬à€€ùõ€\ì€⁄–[ô€HHX]ò][åäûKû
N¬à\ôŸ]Z[P[ô€HH€€ùõ€\ì€⁄–[ô€N¬àBàYà
ò[ôŸY[[[–X›[€åîô\‹Àö[	âàX]ö\›
ûûJHèHSîU—QêUSÀò^\‘ô\‹’ô\⁄€
H¬à€€ú›õ›»H\ôõ‹õX[òŸKõõ› 
N¬àYà
õ›»Hò[ôŸY[[[–X›[€åîô\‹Àõ\›ÿ‹õ€]èHåå
H¬àò[ôŸY[[[–X›[€åîô\‹Àõ\›ÿ‹õ€]Hõ›Œ¬à⁄[ô›ÀóŸ\⁄›‹Ÿ[X›[€ê\òœÀúÿ‹õ€[[[ 
X]òXú û
HèHX]òXú ûJH»ûàûJHèH»HàLJN¬àBàBàYà
›[€êX›[€å‘ô\‹Àö[	âàX]ö\›
ûûJHèHSîU—QêUSÀò^\‘ô\‹’ô\⁄€
H¬à€€ú›õ›»H\ôõ‹õX[òŸKõõ› 
N¬àYà
õ›»H›[€êX›[€å‘ô\‹Àõ\›ÿ‹õ€]èHåå
H¬à›[€êX›[€å‘ô\‹Àõ\›ÿ‹õ€]Hõ›Œ¬à⁄[ô›ÀóŸ\⁄›‹Ÿ[X›[€ê\òœÀúÿ‹õ€[ùöY\ 
X]òXú û
HèHX]òXú ûJH»ûàûJHèH»HàLJN¬àBàBàYà
€€Ÿ[X›ô\‹Àö[	âàX]ö\›
ûûJHèHSîU—QêUSÀò^\‘ô\‹’ô\⁄€
H¬à€€ú›õ›»H\ôõ‹õX[òŸKõõ› 
N¬àYà
õ›»H€€Ÿ[X›ô\‹Àõ\›ÿ‹õ€]èHåå
H¬à€€Ÿ[X›ô\‹Àõ\›ÿ‹õ€]Hõ›Œ¬à⁄[ô›ÀóŸ\⁄›‹Ÿ[X›[€ê\òœÀúÿ‹õ€€€

X]òXú û
HèHX]òXú ûJH»ûàûJHèH»HàLJN¬àBàBà€€ú››€àHô]»Ÿ]

N¬àYòù]€úÀôõ‹ëXX⁄

ù]€ã[ô^
HOà»Yà
ù]€èÀúô\‹ŸY
H›€ãòY
ù]€â⁄[ô^X
N»JN¬àYà

Yòù]€ú÷ÕóOÀùò[YH
HèHSîU—QêUSÀò^\‘ô\‹’ô\⁄€
H›€ãòY
	”YùöYŸŸ\â N¬àYà

Yòù]€ú÷Õ◊OÀùò[YH
HèHSîU—QêUSÀò^\‘ô\‹’ô\⁄€
H›€ãòY
	‘öY⁄öYŸŸ\â N¬à€€ú›^\‘ô\‹»HSîU—QêUSÀò^\‘ô\‹’ô\⁄€¬àYà
ûHX^\‘ô\‹ H›€ãòY
	‘öY⁄›X⁄”Yù	 N¬àYà
ûèH^\‘ô\‹ H›€ãòY
	‘öY⁄›X⁄‘öY⁄	 N¬àYà
ûHHX^\‘ô\‹ H›€ãòY
	‘öY⁄›X⁄’\	 N¬àYà
ûHèH^\‘ô\‹ H›€ãòY
	‘öY⁄›X⁄—›€â N¬àÀ»öY⁄\›X⁄»€X⁄»
ù]€åLH8†%å HŸŸ€\»Y[YH]]À]\ôŸ]àÀ»⁄[HHY[YHŸX\€à\»›]Z⁄[ô»›ô\àúõ€H]»Yò][àÀ»ŸX\€î›⁄]⁄ö[ô[ô»õ‹à^X›H]⁄[ô›»
ŸX\€î›⁄]⁄›[àÀ»€‹ö‹»õ‹õX[HHô\›ŸàH[YK[ôöXH]»›\àö[ô[ô‹À¬àÀ»HX›[€ãXò\àù]€à]ô[à[äKÇàYà
›€ãö\ 	–ù]€åLI H	âàY[YUŸX\€ì›]

JH¬àYà
Yÿ[Y\Y›]Kúô]ö[›\Àö\ 	–ù]€åLI JH¬àY[YP]]’\ôŸ]€àH[Y[YP]]’\ôŸ]€é¬àX[ùX[]]’\ôŸ]Hù[¬àY[YP]]’\ôŸ]úôYPZ[HHò[ŸN¬à⁄›’ÿ\›
Y[YP]]’\ôŸ]€à»	–]]ÀU\ôŸ]à€â»à	–]]ÀU\ôŸ]àŸôâÀY[YP]]’\ôŸ]€äN¬àBà›€ãô[]J	–ù]€åLI N¬àBà€€ú›[⁄YùH[ú]ö[ô[ô‹Àõ[ŸT⁄YùÀôö[ô
»OàÀô]öXŸHOOH	ÿ€€ùõ€\â»	âà›€ãö\ Àòù]€äJN¬àYà
[⁄Yù
H€€ùõ€\ì€⁄–X›]ôHHò[ŸN¬àõ‹à
€€ú›ù]€àŸà›€äH¬àYà
ÿ[Y\Y›]Kúô]ö[›\Àö\ ù]€äHù]€àOOH[⁄YùÀòù]€äH€€ù[ùYN¬à€€ú›X›[€íYHŸ]X›[€ëõ‹êù]€ä	ÿ€€ùõ€\âÀù]€ã[⁄Yù
N¬àYà
X›[€íY
H»\›[ú]]öXŸHH	ÿ€€ùõ€\âŒ»ù[í[ú]X›[€äX›[€íY	‹ô\‹… N»BàBàõ‹à
€€ú›ù]€àŸàÿ[Y\Y›]Kúô]ö[›\ H¬àYà
›€ãö\ ù]€äJH€€ù[ùYN¬à€€ú›X›[€íYHŸ]X›[€ëõ‹êù]€ä	ÿ€€ùõ€\âÀù]€ãÿ[Y\Y›]KòX›]ôT⁄Yù
N¬àYà
X›[€íY
Hù[í[ú]X›[€äX›[€íY	‹ô[X\ŸI N¬àBàÿ[Y\Y›]Kúô]ö[›\»H›€é¬àÿ[Y\Y›]KòX›]ôT⁄YùH[⁄Yùù[¬àBà⁄[ô›ÀòY]ô[ù\›[ô\ä	Ÿõÿ›\…À

HOà»ÿ[Y\Y›]Kôõÿ›\ŸYHùYN»JN¬à⁄[ô›ÀòY]ô[ù\›[ô\ä	ÿõ\âÀ

HOà»ÿ[Y\Y›]Kôõÿ›\ŸYHò[ŸN»ÿ[Y\Y›]Kúô]ö[›\Àò€X\ä
N»[ú]ûH»[ú]ûHH»€€ùõ€\ì€⁄–X›]ôHHò[ŸN»JN¬àÿ›[Y[ùòY]ô[ù\›[ô\ä	›ö\⁄Xö[]X⁄[ôŸIÀ

HOà»Yà
ÿ›[Y[ùöY[äH»ÿ[Y\Y›]Kôõÿ›\ŸYHò[ŸN»ÿ[Y\Y›]Kúô]ö[›\Àò€X\ä
N»[ú]ûH»[ú]ûHH»€€ùõ€\ì€⁄–X›]ôHHò[ŸN»HJN¬ÇàÀ»Ÿ][ô‹»Xâ‹»[ú]Xö[ô[ô»õ›‹»õ›»]ôH[ÇàÀ»úÀ⁄[ú]\Ÿ][ô‹À\[ô[öú»8†%ÿ[öXH⁄[ô›Àí[ú]Ÿ][ô‹‘[ô[úô[ô\ä
KÇàÀ»[ö]

IŸ\ôHò]\à[à›€à⁄]H›\à⁄[ô›Àèò[Y\‹XŸOÇàÀ»[Ÿ[\À⁄[òŸH
[õZŸH[JH\»€ôH\»ô[ô\ôY€òŸH[[YYX][BàÀ»]õ€›ò]\à[à^ö[H€àö\ú›Xà‹[ãÇàÿ›[Y[ùôŸ][[Y[ùûRY
	ÿY[ŸT⁄Yùùâ OÀòY]ô[ù\›[ô\ä	ÿ€X⁄…À

HOà»[ú]ö[ô[ô‹Àõ[ŸT⁄YùÀú\⁄
»Yà›\›€KI—]Kõõ› 
_XXô[à	–›\›€H⁄Yù	À]öXŸNà	ÿ€€ùõ€\âÀù]€éà	–ù]€ç	Àö[ô[ô‹ŒàﬂHJN»ÿ]ôR[ú]ö[ô[ô‹ 
N»⁄[ô›Àí[ú]Ÿ][ô‹‘[ô[úô[ô\ä
N»JN¬à⁄[ô›Àí[ú]Ÿ][ô‹‘[ô[Àö[ö]
¬àSîU—QêUSÀà[ú]ö[ô[ô‹Àà””ïì”Tó“SîU”‘S”îÀàù]€ìXô[àö[ô[ô–€€ôõX›àÿ]ôR[ú]ö[ô[ô‹ÀàJN¬à⁄[ô›Àí[ú]Ÿ][ô‹‘[ô[úô[ô\ä
N¬à⁄[ô›Àì]\⁄X”Z[öYÿ[YOÀúô[ô\ìõ›RŸ^TŸ][ô‹ 
N¬à⁄[ô›Àì]\⁄X”Z[öYÿ[YOÀúô[ô\î]\õìÿY›]Ÿ][ô‹ 
N¬à⁄[ô›Àì]\⁄X”Z[öYÿ[YOÀúô[ô\ëúôY\^RŸ^TŸ][ô‹ 
N¬ÇàÀ»\⁄›‹⁄Yù	‹»X[õ€Nà[
»[›\ŸH[›ô[Y[ùõ›]\»Hÿ[Y\òBàÀ»
ŸYHH[›\Ÿ[[›ôH[ô\â‹»Kú⁄YùŸ^Húò[ò⁄[ò⁄[ôŸY
K⁄[HBàÀ»€X[àT8†%ô\‹ŸY[ôô[X\ŸY⁄][àHÿ[YH\⁄[ô›»\¬àÀ»]ô\ûH›\à\⁄€Ÿ\›\ôH\ôK⁄]õ»[›\ŸH[›ô[Y[ù[ÇàÀ»ô]ŸY[à8†%ŸŸ€\»Y[YH]]À]\ôŸ][ú›XYà‹⁄YùòYŸŸY\»Ÿ]àÀ»H[ú›[ù[ûH[›\Ÿ[[›ôH]ô[ùö\ô\»⁄[H⁄Yù\»›€ÇàÀ»
ôYÿ\ô\‹»Ÿà⁄X⁄úò[ò⁄[ô\»]8†%⁄›[\ã\›\ôâ‹»›€àúôYBàÀ»[›\Ÿ[€⁄»[ò€YY
K€»H€]À\õ›]Hô]ô\àŸ]»Z\‹ôXY\»BàÀ»ŸŸ€H€àô[X\ŸKÇà]‹⁄Yù›€ê]Hù[¬à]‹⁄YùòYŸŸYHò[ŸN¬à⁄[ô›ÀòY]ô[ù\›[ô\ä	⁄Ÿ^Y›€âÀ
]ô[ù
HOà¬à€€ú›Ÿ^HH]ô[ùöŸ^Kù”›Ÿ\êÿ\ŸJ
N¬àYà
⁄[ô›Àëö\⁄[ôœÀú›]OÀòX›]ôJH¬àYà
Ÿ^HOOH	Ÿ\ÿÿ\I H»]ô[ùúô]ô[ùYò][

N»⁄[ô›Àëö\⁄[ôœÀò€‹ŸJ
N»ô]\õé»Bà€€ú›ö\⁄[ô–õ›[ôX›[€àHŸ]X›[€ëõ‹êù]€ä	Ÿ\⁄›‹	À]ô[ùò€ŸJN¬àYà
ö\⁄[ô–õ›[ôX›[€àOOH	⁄[ù\òX›	»ö\⁄[ô–õ›[ôX›[€àOOH	ÿX›[€åI»Ÿ^HOOH	»	»Ÿ^HOOH	Ÿ[ù\â H¬à]ô[ùúô]ô[ùYò][

N¬à⁄[ô›Àëö\⁄[ôœÀúö[X\ûPX›[€ä
N¬àBàô]\õé¬àBàYà
Ÿ^HOOH	Ÿ\ÿÿ\I H¬à]ô[ùúô]ô[ùYò][

N¬àÀ»õ‹õX[H[úôXX⁄XõH8†%H›ô\õ^I‹»Yúò[YH€»õÿ›\»[ôàÀ»[ô\»\ÿÿ\H]Ÿ[à
ŸYHô\]Y\›^]‹î]\ŸH[ÇàÀ»\ôK\\ôõ‹õX[òŸKö[⁄X⁄\⁄‹»úÀ€]\⁄XÀ[Z[öYÿ[YKöú»¬àÀ»€‹ŸJ
JH8†%ù]Yàõÿ›\»]ô\à[ô»òX⁄»€àH‹›YŸH⁄[BàÀ»H›ô\õ^H\»›[‹[ã\»\»Hÿ[YHò[òX⁄»ö\⁄[ô¬àÀ»\Ÿ\»Xõ›ôHò]\à[à‹[ö[ô»HY[ùH[ô\õôX]]ÇàYà
⁄[ô›Àì]\⁄X”Z[öYÿ[YOÀú›]OÀòX›]ôJH»⁄[ô›Àì]\⁄X”Z[öYÿ[YKò€‹ŸJ
N»ô]\õé»BàYà
X[Ÿ›YS‹[äH»€‹ŸSú—X[Ÿ›YJ
N»ô]\õé»BàY[ùS‹[à»€‹ŸSY[ùJ
Hà‹[ìY[ùJ
N¬àô]\õé¬àBàÀ»Xéàÿ[YHY[ùH‹[ãÿ€‹ŸH\»\ÿÿ\K⁄]›]\ÿÿ\I‹»úõ›‹Ÿ\à⁄YBàÀ»YôôX›Ÿà^][ô»ù[ÿ‹ôY[à8†%YY‹X⁄YöXÿ[H€»H^Y\à[ÇàÀ»ù[ÿ‹ôY[àŸ\€â›]ôH»õ‹›]Ÿà]ù\›»ôXX⁄HY[ùKÇàÀ»⁄Yù
’XàŸ\»Hÿ[YH
õ»\ôX›[€à»X⁄»ô]ŸY[àõ‹àHZ[ÇàÀ»‹[ãÿ€‹ŸHŸŸ€JN»][KXﬁX€[ô»[›ôY»»»Hô[›»»úôYH\àÀ»õ›ö[ô[ô‹Àà⁄⁄\Y\ö[ô»X[Ÿ›YK›H]\⁄X»Z[öYÿ[YKÿ[YBàÀ»\»\ÿÿ\K€»HY[ùHÿ[â›‹‹[à›ô\àZ]\à›ô\õ^KÇàYà
Ÿ^HOOH	›Xâ H¬à]ô[ùúô]ô[ùYò][

N¬àYà
⁄[ô›Àì]\⁄X”Z[öYÿ[YOÀú›]OÀòX›]ôHX[Ÿ›YS‹[äHô]\õé¬àY[ùS‹[à»€‹ŸSY[ùJ
Hà‹[ìY[ùJ
N¬àô]\õé¬àBàÀ»Nà⁄[\õô\‹»X\8†%€‹Ÿ\»Yà[ôXYH‹[à€àHX\Xà
Z\úõ‹ú¬àÀ»‹^I‹»ÿ[[ô\ã\⁄‹ù›]ôZ]ö[‹äK›\ù⁄\ŸH‹[úÀ‹›⁄]⁄\»»]ÇàYà
Ÿ^HOOH	€I H¬à]ô[ùúô]ô[ùYò][

N¬à€€ú›€ìX\XàHÿ›[Y[ùú]Y\ûTŸ[X›‹ä	Àõ\]XñŸ]K[\[ô[HõX\óI OÀò€\‹”\›ò€€ùZ[ú 	ÿX›]ôI N¬àYà
Y[ùS‹[à	âà€ìX\XäH€‹ŸSY[ùJ
N¬à[ŸH‹[ìY[ùJ	€X\	 N¬àô]\õé¬àBàYà
Y[ùS‹[äHô]\õé¬àYà
Ÿ^HOOH	ﬁâ H¬à]ô[ùúô]ô[ùYò][

N¬àYà
Y]ô[ùúô\X]
H]]ÿ^R[\]Z\Y[ù

N¬àô]\õé¬àBà€€ú›õ›[ô\⁄›‹X›[€àHŸ]X›[€ëõ‹êù]€ä	Ÿ\⁄›‹	À]ô[ùò€ŸJN¬àYà
õ›[ô\⁄›‹X›[€à	âàV…“Ÿ^QIÀ	“Ÿ^TIÀ	“Ÿ^P…◊Kö[ò€Y\ ]ô[ùò€ŸJJH¬à]ô[ùúô]ô[ùYò][

N¬àYà
Y]ô[ùúô\X]
Hù[í[ú]X›[€äõ›[ô\⁄›‹X›[€ã	‹ô\‹… N¬àô]\õé¬àBàYà
Ÿ^HOOH	‹⁄Yù	 H¬àYà
Y]ô[ùúô\X]
H»‹⁄Yù›€ê]H\ôõ‹õX[òŸKõõ› 
N»‹⁄YùòYŸŸYHò[ŸN»Bàô]\õé¬àBàYà
…ÿ\úõ›€Yù	À	ÿ\úõ›‹öY⁄	À	ÿ\úõ››\	À	ÿ\úõ›Ÿ›€âÀ	›…À	ÿIÀ	‹…À	Ÿ	◊Kö[ò€Y\ Ÿ^JJH¬à]ô[ùúô]ô[ùYò][

N»[ú]öŸ^\ÀòY
Ÿ^JN¬àBÇàYà
Ÿ^HOOH	ŸI H¬à]ô[ùúô]ô[ùYò][

N¬àYà
\—\⁄›‹
H¬àYà
Y]ô[ùúô\X]	âà⁄[ô›Àêò[ô]ÿ[\œÀö\”ôX\òûU[ùÀä
JH¬à\⁄›‹[ù[ù\òX›[HùYN¬àX›]ôPX›[€àH	ÿò[ô]›[ù⁄[ù\òX›	Œ¬àX›[€í[›€àHùYN¬à\ŸPX›]ôPX›[€ä
N¬àô]\õé¬àBà›\ù\⁄›‹€Ÿ^J	ŸIÀ]ô[ù
N¬àô]\õé¬àBàBàYà
Ÿ^HOOH	‹I H¬à]ô[ùúô]ô[ùYò][

N¬àYà
\—\⁄›‹
H»›\ù\⁄›‹€Ÿ^J	‹IÀ]ô[ù
N»ô]\õé»Bà€€ú›X›[€ú»H€€X›[€ú÷ÿX›]ôU€€N¬à€€ú›YHX›[€úÀö[ô^ŸäX›]ôPX›[€äN¬àX›]ôPX›[€àHX›[€ú÷ Y
»JH	HX›[€úÀõ[ô›N¬àôYúô\⁄X›[€êò\ä
N¬àô]\õé¬àBàÀ»Œà€»‹[àH][]Y\»⁄Y[
⁄\òX›\àöY]Àô]\õà»ÿ[\àÀ»]ZX⁄À\Ÿ[X›Hÿ[\ö\ôH⁄]ô]\õà»ò\õJH8†%ÿ[YH€]À[‹[ã›\YŸ\ÀBàÀ»õ›[ô»]\õà\»K‘HXõ›ôKù]\ôI‹»õ»Ÿ\\ò]H\àÀ»ôZ]ö[‹à»ò[òX⁄»»€àô[X\ŸH
ŸYHHŸ^]\[ô\äKÇàYà
Ÿ^HOOH	ÿ… H¬à]ô[ùúô]ô[ùYò][

N¬àYà
\—\⁄›‹
H»›\ù\⁄›‹€Ÿ^J	ÿ…À]ô[ù
N»ô]\õé»BàBÇàÀ»YÿXﬁH[òõ›[ôö[X\ûHŸ^\Àà€€ôöY›\ôYX›[€àö[ô[ô‹»ô]\õàXõ›ôN¬àÀ»\⁄›‹H\»[ôY\»[ù\òX›€àŸ^]\Yù\à]»€€]⁄Y[€ÇàYà
Ÿ^HOOH	»	»Ÿ^HOOH	Ÿ[ù\â»Ÿ^HOOH	ŸI H¬à]ô[ùúô]ô[ùYò][

N¬àYà
Y]ô[ùúô\X]
H¬àX›[€í[›€àHùYN¬à\ŸPX›]ôPX›[€ä
N¬àBàô]\õé¬àBÇàYà
Ÿ^HOOH	ÃI HŸ]X›]ôU€€
	‹⁄›ô[	 N¬àYà
Ÿ^HOOH	Ãâ HŸ]X›]ôU€€
	⁄ŸI N¬àYà
Ÿ^HOOH	Ã… HŸ]X›]ôU€€
	›ŸX\€â N¬àYà
Ÿ^HOOH	Õ	 HŸ]X›]ôU€€
	ÿ^I N¬àYà
Ÿ^HOOH	ÕI HŸ]X›]ôU€€
	‹X⁄… N¬àYà
Ÿ^HOOH	Õâ HŸ]X›]ôU€€
	⁄\ú€€â N¬ÇàÀ»][Hÿ‹õ€à»à‹à»»H8†%Xã‘⁄Yù
’Xà[›ôY»‹[ö[ô»BàÀ»Y[ùH
ŸYHHŸ^Y›€à[ô\àXõ›ôJH€»õ›\ôHúôYH\ôKÇàYà
Ÿ^HOOH	À	»Ÿ^HOOH	÷… H¬àﬁX€PX›]ôR[ùô[ù‹ûR][JLJN¬àôYúô\⁄][Tÿ‹õ€

N»ôYúô\⁄X›[€êò\ä
N¬àBàYà
Ÿ^HOOH	Àâ»Ÿ^HOOH	◊I H¬à]ô[ùúô]ô[ùYò][

N¬àﬁX€PX›]ôR[ùô[ù‹ûR][J]ô[ùú⁄YùŸ^H»LHàJN¬àôYúô\⁄][Tÿ‹õ€

N»ôYúô\⁄X›[€êò\ä
N¬àBÇàÀ»à€€ù^X›[€à8†%€[XúÀÿ€YôãY]ô\»Hÿ[[àH›\úô[ùàÀ»òX⁄[ô»\ôX›[€àYà€ôI‹»\ôK›\ù⁄\ŸHŸŸ\»⁄]KYúò[Y\¬àYà
Ÿ^HOOH	ﬁ	 H¬à]ô[ùúô]ô[ùYò][

N¬à\ôõ‹õP€€ù^X›[€ä
N¬àô]\õé¬àBÇàÀ»éàŸŸ€HXùY»YÀXõ€ôHö\›X[^ò][€à
\›Y⁄ÿÿ[ã⁄€ôYBàÀ»›ZY\Àÿ[YH€€‹ôYÿ\›[\»Hù\õö]\ôKX]ò]\ãX]]‹à€€àÀ»ò]‹»›ô\à]»›€àŸX]Yô]öY] Hõ‹à]ô\ûHö\⁄XõH]ò]\â‹»Y¬àÀ»öY»8†%]ãŸXY€õ‹›X»ZYõ›H^Y\ãYòX⁄[ô»YX⁄[öXÀÇàYà
Ÿ^HOOH	ÿâ H¬à]ô[ùúô]ô[ùYò][

N¬à€€ú›ô^H]⁄[ô›ÀîõÿŸY\ò[Y–[ö[X][€èÀú⁄›–õ€ô\Œ¬à⁄[ô›ÀîõÿŸY\ò[Y–[ö[X][€èÀúŸ]⁄›–õ€ô\ ô^
N¬à⁄›’ÿ\›
ô^»	”Y»õ€ô\Œà⁄›€â»à	”Y»õ€ô\ŒàY[âÀùYKò[ŸJN¬àô]\õé¬àBÇàÀ»éàﬁX€HX›]ôH€€	‹»X›[€à[ŸH
\]Z]ò[[ù»H€à[ÿö[JBàYà
Ÿ^HOOH	‹â H¬à€€ú›X›[€ú»H€€X›[€ú÷ÿX›]ôU€€N¬à€€ú›YHX›[€úÀö[ô^ŸäX›]ôPX›[€äN¬àX›]ôPX›[€àHX›[€ú÷ Y
»JH	HX›[€úÀõ[ô›N¬àôYúô\⁄X›[€êò\ä
N¬àô]\õé¬àBàJN¬Çà⁄[ô›ÀòY]ô[ù\›[ô\ä	⁄Ÿ^]\	À
]ô[ù
HOà¬à€€ú›Ÿ^HH]ô[ùöŸ^Kù”›Ÿ\êÿ\ŸJ
N¬à[ú]öŸ^\Àô[]JŸ^JN¬àÀ»Z\úõ‹ú»HŸ^Y›€à[ô\â‹»X\õHô]\õéà⁄]›]\Àô[X\⁄[ô¬àÀ»H[ù\òX›Ÿ^H
JHYù\àö\⁄[ô‘ö[X\ûPX›[€ä
H[ôXYHö\ôY€ÇàÀ»Ÿ^Y›€àô[õ›Y⁄»H	ŸI»[ô[ô»ô[›À⁄X⁄ÿ[¬àÀ»\ŸPX›]ôPX›[€ä
H8†%ôK]öYŸŸ\ö[ô»ôY⁄[ëö\⁄[ô–ÿ\›

H[ô€ÿòô\ö[ô¬àÀ»Hö[ô»Z[öYÿ[YH]ô\‹»Yù\›‹[ôYÇàYà
⁄[ô›Àëö\⁄[ôœÀú›]OÀòX›]ôJHô]\õé¬àÀ»ﬁ[[Y]öX»ô[X\ŸHõ‹à⁄]]ô\àŸ^Y›€à\‹]⁄Y\»H	‹ô\‹…»8†%àÀ»ÿ[YHö[ô[ô»€⁄›\Ÿ^€\⁄[€à\»Ÿ^Y›€àXõ›ôK€»H[ŸX\€ÇàÀ»X›[€à
KôÀà‹XŸKÿX›[€åJHX›X[HôXX⁄\»€€Xò]ö[ú]úô\‹—[ôàÀ»[ú›XYŸà€õH]ô\àö\ö[ô»\»[à[ú›[ù\Çà€€ú›õ›[ô\⁄›‹X›[€ï\HŸ]X›[€ëõ‹êù]€ä	Ÿ\⁄›‹	À]ô[ùò€ŸJN¬àYà
õ›[ô\⁄›‹X›[€ï\	âàV…“Ÿ^QIÀ	“Ÿ^TIÀ	“Ÿ^P…◊Kö[ò€Y\ ]ô[ùò€ŸJJH¬àù[í[ú]X›[€äõ›[ô\⁄›‹X›[€ï\	‹ô[X\ŸI N¬àBàYà
Ÿ^HOOH	‹⁄Yù	 H¬à€€ú›[\»H\ôõ‹õX[òŸKõõ› 
HH
‹⁄Yù›€ê]œ»
N¬àYà
[Y[ùS‹[à	âàW‹⁄YùòYŸŸY	âà[\»\⁄›‹\⁄[ô›”\ 
H	âàY[YUŸX\€ì›]

JH¬àY[YP]]’\ôŸ]€àH[Y[YP]]’\ôŸ]€é¬à⁄›’ÿ\›
Y[YP]]’\ôŸ]€à»	–]]ÀU\ôŸ]à€â»à	–]]ÀU\ôŸ]àŸôâÀY[YP]]’\ôŸ]€äN¬àBà‹⁄Yù›€ê]Hù[¬àô]\õé¬àBàYà
Ÿ^HOOH	ŸI»	âà\—\⁄›‹
H¬à]ô[ùúô]ô[ùYò][

N¬àYà
\⁄›‹[ù[ù\òX›[
H¬à\⁄›‹[ù[ù\òX›[Hò[ŸN¬àX›[€í[›€àHò[ŸN¬àô]\õé¬àBà€€ú›ÿ\“[Hö[ö\⁄\⁄›‹€Ÿ^J	ŸI N¬àYà
]ÿ\“[
Hù[í[ù\òX›X›[€ä
N¬àô]\õé¬àBàYà
Ÿ^HOOH	‹I»	âà\—\⁄›‹
H¬à]ô[ùúô]ô[ùYò][

N¬à€€ú›ÿ\“[Hö[ö\⁄\⁄›‹€Ÿ^J	‹I N¬àYà
]ÿ\“[
H¬à€€ú›ùú»H€€\]PX›[€êù]€ú 
N¬à€€ú›ŸX€€ôHùúÀôö[ô

ãJHOàHà	âàãò[›ŸY
N¬àYà
ŸX€€ô
H»X›]ôPX›[€àHŸX€€ôòX›[€é»\ŸPX›]ôPX›[€ä
N»BàBàô]\õé¬àBàYà
Ÿ^HOOH	ÿ…»	âà\—\⁄›‹
H¬à]ô[ùúô]ô[ùYò][

N¬àÀ»õ»\ò[òX⁄»8†%H][]Y\»⁄Y[€õH]ô\àŸ\»[û][ô¬àÀ»€òŸH]	‹»X›X[H‹[à
ö[ö\⁄\⁄›‹€Ÿ^I‹»›€à\òœOOI›][]Y\…¬àÀ»úò[ò⁄€€[Z]»⁄]]ô\à[ùûHÿ\»Y⁄Y⁄YöXHô[X\ŸTŸ[X›[€ä
JKÇàö[ö\⁄\⁄›‹€Ÿ^J	ÿ… N¬àô]\õé¬àBàYà
Ÿ^HOOH	»	»Ÿ^HOOH	Ÿ[ù\â»Ÿ^HOOH	ŸI HX›[€í[›€àHò[ŸN¬àJN¬ÇàÀ»ÿ‹õ€⁄Y[àJ›⁄Y[›ÿ\»][\ÀJ›⁄Y[›ÿ\»€€À›\ù⁄\ŸHõ€€\»Hÿ[Y\òKÇàù[ò›[€à[ôQÿ[YU⁄Y[
K[€õHHò[ŸJH¬àYà
Y[ùS‹[àò\õQY][ŸJHô]\õàò[ŸN¬à€€ú›\àHKô[VHà»HàLN¬àÀ»⁄Yù
›⁄Y[ﬁX€\»Y[YH]]À]\ôŸ]	‹»ÿ⁄»‹òö][H\õ›[ôBàÀ»^Y\à[ú›XYŸàõ€€Z[ô»8†%€õH€òŸHHÿ⁄»\»[ôXYHX›]ôKàÀ»ÿ[YHõõ›[ô»\[ú»Yà]	‹»Ÿôààù[HH€€ùõ€\ã€[ÿö[BàÀ»ﬁX€[ô»[ú]»õ€›ÀÇàYà
Kú⁄YùŸ^H	âàY[YP]]’\ôŸ]€à	âàY[YUŸX\€ì›]

JH¬àKúô]ô[ùYò][

N¬àﬁX€SY[YP]]’\ôŸ]
\äN¬àô]\õàùYN¬àBà€€ú›[[ùûTŸ[X›‹í⁄[ôH⁄[ô›ÀóŸ\⁄›‹Ÿ[X›[€ê\òœÀö[Ÿ[X›[€í⁄[ôÀä
N»À»[ò€Y\»Ÿ^Xõÿ\ôÿ€€ùõ€\à[ô⁄[ù\ãZ[X›[€àù]€úÀÇàYà
\—\⁄›‹	âà
›[€êX›[€å‘ô\‹Àô›€à[[ùûTŸ[X›‹í⁄[ôOOH	‹›[€ú… JH¬àKúô]ô[ùYò][

N¬àYà
›[€êX›[€å‘ô\‹Àô›€à	âà\›[€êX›[€å‘ô\‹Àö[
H¬à›[€êX›[€å‘ô\‹Àö[HùYN¬àYà
›[€êX›[€å‘ô\‹Àù[Y\äH»€X\ï[Y[›]
›[€êX›[€å‘ô\‹Àù[Y\äN»›[€êX›[€å‘ô\‹Àù[Y\àHù[»Bà⁄[ô›ÀóŸ\⁄›‹Ÿ[X›[€ê\òœÀõ‹[î›[€ú 
N¬àH[ŸHYà
]⁄[ô›ÀóŸ\⁄›‹Ÿ[X›[€ê\òœÀô[ùûSY[ùS‹[èÀä
JH¬à⁄[ô›ÀóŸ\⁄›‹Ÿ[X›[€ê\òœÀõ‹[î›[€ú 
N¬àBà⁄[ô›ÀóŸ\⁄›‹Ÿ[X›[€ê\òœÀúÿ‹õ€[ùöY\ Y\äN¬àô]\õàùYN¬àBàYà
\—\⁄›‹	âà[[ùûTŸ[X›‹í⁄[ôOOH	ÿ[[[… H¬àKúô]ô[ùYò][

N¬à⁄[ô›ÀóŸ\⁄›‹Ÿ[X›[€ê\òœÀõ‹[ê[[[ 
N¬à⁄[ô›ÀóŸ\⁄›‹Ÿ[X›[€ê\òœÀúÿ‹õ€[[[ Y\äN¬àô]\õàùYN¬àBàYà
\—\⁄›‹	âà\⁄›‹€Ÿ^\ÀúKô›€äH¬àKúô]ô[ùYò][

N¬à‹[ë\⁄›‹€\ò 	‹I N¬àYà
X›]ôU€€OOH	‹ò[ôŸY	 H⁄[ô›ÀóŸ\⁄›‹Ÿ[X›[€ê\òœÀúÿ‹õ€[[[ Y\äN¬à[ŸH⁄[ô›ÀóŸ\⁄›‹Ÿ[X›[€ê\òœÀúÿ‹õ€][JY\äN¬àô]\õàùYN¬àBàYà
\—\⁄›‹	âà\⁄›‹€Ÿ^\ÀôKô›€äH¬àKúô]ô[ùYò][

N¬à‹[ë\⁄›‹€\ò 	ŸI N¬à⁄[ô›ÀóŸ\⁄›‹Ÿ[X›[€ê\òœÀúÿ‹õ€€€
Y\äN¬àô]\õàùYN¬àBàYà
\—\⁄›‹	âà\⁄›‹€Ÿ^\ÀòÀô›€äH¬àKúô]ô[ùYò][

N¬à‹[ë\⁄›‹€\ò 	ÿ… N¬à⁄[ô›ÀóŸ\⁄›‹Ÿ[X›[€ê\òœÀúÿ‹õ€[ùöY\ Y\äN¬àô]\õàùYN¬àBàYà
[€õJHô]\õàò[ŸN¬àKúô]ô[ùYò][

N¬àÀ»H\ôX›‹à]]‹ú»]ô\ûHÿ[Y\òHôX]ŸàH›]ÿŸ[ôH
[ò€Y[ô¬àÀ»õ€€Hÿ\ôÀ›]ÿŸ[ôTô]öY]÷õ€€T\òŸ[ù
H8†%X[ùX[⁄Y[^õ€€H€›[àÀ»öY⁄]]]‹ôYúò[Z[ôÀ€»]	‹»HõÀ[‹
ù]›[€€ú›[YYàÀ»€»HYŸH]Ÿ[àŸ\€â›ÿ‹õ€
H⁄[HHô]öY]»\»X›]ôKÇàYà
›]ÿŸ[ôTô]öY]–X›]ôJHô]\õàùYN¬àYà
X[Ÿ›YVõ€€PX›]ôJ
JH¬à€€ú›Ÿ[ú⁄]]ö]HHX[Ÿ›YVõ€€P€€ôöY 
Kù⁄Y[Ÿ[ú⁄]]ö]Hœ»åMN¬àŸ]X[Ÿ›YPÿ[Y\òVõ€€T\òŸ[ù
X[Ÿ›YPÿ[Y\òVõ€€T\òŸ[ù
»
YKô[VH
àŸ[ú⁄]]ö]H
àL
JN¬àô]\õàùYN¬àBà€€ú›Ÿô»H\⁄›‹€€ùõ€–€€ôöY 
N¬à€€ú››\Hù[Xô\ãö\—ö[ö]Jù[Xô\äŸôÀù⁄Y[õ€€T›\
JH»ù[Xô\äŸôÀù⁄Y[õ€€T›\
HàåN¬àŸ]ÿ[Y\òVõ€€Tÿÿ[J◊ﬁõ€€Tÿÿ[H
»
Y\à
à›\
JN¬àô]\õàùYN¬àBà⁄[ô›ÀòY]ô[ù\›[ô\ä	›⁄Y[	À
JHOà»Yà
[ôQÿ[YU⁄Y[
KùYJJHKú›‹õ‹Yÿ][€ä
N»K»\‹⁄]ôNàò[ŸKÿ\\ôNàùYHJN¬àôYP€€ùZ[ô\ãòY]ô[ù\›[ô\ä	›⁄Y[	À
JHOà»[ôQÿ[YU⁄Y[
Kò[ŸJN»K»\‹⁄]ôNàò[ŸHJN¬Çàù[ò›[€à\]QX[Ÿ›YT[ò⁄\›[òŸJ
H¬à€€ú›⁄[ù»HÀããôX[Ÿ›YVõ€€T⁄[ù\úÀùò[Y\ 
WN¬àYà
⁄[ùÀõ[ô›äH»X[Ÿ›YT[ò⁄\›[òŸHHù[»ô]\õé»BàX[Ÿ›YT[ò⁄\›[òŸHHX]ö\›
⁄[ù÷ÃKûH⁄[ù÷ÃWKû⁄[ù÷ÃKûHH⁄[ù÷ÃWKûJN¬àBÇàôYP€€ùZ[ô\ãòY]ô[ù\›[ô\ä	‹⁄[ù\ô›€âÀ
JHOà¬àYà
YX[Ÿ›YVõ€€PX›]ôJ
HKú⁄[ù\ï\HOOH	››X⁄	 Hô]\õé¬àX[Ÿ›YVõ€€T⁄[ù\úÀúŸ]
Kú⁄[ù\íY»àKò€Y[ùNàKò€Y[ùHJN¬à\]QX[Ÿ›YT[ò⁄\›[òŸJ
N¬àJN¬àôYP€€ùZ[ô\ãòY]ô[ù\›[ô\ä	‹⁄[ù\õ[›ôIÀ
JHOà¬àYà
YX[Ÿ›YVõ€€PX›]ôJ
HKú⁄[ù\ï\HOOH	››X⁄	»YX[Ÿ›YVõ€€T⁄[ù\úÀö\ Kú⁄[ù\íY
JHô]\õé¬àX[Ÿ›YVõ€€T⁄[ù\úÀúŸ]
Kú⁄[ù\íY»àKò€Y[ùNàKò€Y[ùHJN¬à€€ú›⁄[ù»HÀããôX[Ÿ›YVõ€€T⁄[ù\úÀùò[Y\ 
WN¬àYà
⁄[ùÀõ[ô›äHô]\õé¬à€€ú›ô^\›[òŸHHX]ö\›
⁄[ù÷ÃKûH⁄[ù÷ÃWKû⁄[ù÷ÃKûHH⁄[ù÷ÃWKûJN¬àYà
X[Ÿ›YT[ò⁄\›[òŸH	âàô^\›[òŸHà
H¬à€€ú›Ÿ[ú⁄]]ö]HHX[Ÿ›YVõ€€P€€ôöY 
Kú[ò⁄Ÿ[ú⁄]]ö]Hœ»N¬àŸ]X[Ÿ›YPÿ[Y\òVõ€€T\òŸ[ù
X[Ÿ›YPÿ[Y\òVõ€€T\òŸ[ù
»

ô^\›[òŸH»X[Ÿ›YT[ò⁄\›[òŸJHHJH
àŸ[ú⁄]]ö]H
àL
N¬àBàX[Ÿ›YT[ò⁄\›[òŸHHô^\›[òŸN¬àKúô]ô[ùYò][

N¬àK»\‹⁄]ôNàò[ŸHJN¬àù[ò›[€à€X\ëX[Ÿ›YVõ€€T⁄[ù\äJH¬àX[Ÿ›YVõ€€T⁄[ù\úÀô[]JKú⁄[ù\íY
N¬à\]QX[Ÿ›YT[ò⁄\›[òŸJ
N¬àBà⁄[ô›ÀòY]ô[ù\›[ô\ä	‹⁄[ù\ù\	À€X\ëX[Ÿ›YVõ€€T⁄[ù\äN¬à⁄[ô›ÀòY]ô[ù\›[ô\ä	‹⁄[ù\òÿ[òŸ[	À€X\ëX[Ÿ›YVõ€€T⁄[ù\äN¬ÇàÀ»8• 8• ÿ[Y\òH€⁄ŒàHõÿ][ô»õﬁ\›X⁄»]X]\öX[^ô\»[ô\àBàÀ»[Xà€àHöY⁄Z[à›X⁄
[ÿö[JK⁄Yù
€[›\ŸH[›ô[Y[ù€ÇàÀ»\⁄›‹àH[ÿö[H[à\ŸY»ôHHò]»[KYòY»
ÿ[Y\òHŸôúŸ]àÀ»òX⁄ŸYNåH⁄]›Ÿ]ô\àò\àHö[ôŸ\àYò]ô[Yúõ€H]»›\ùàÀ»⁄[ù
N»]	‹»Hò]KX€€ùõ€›X⁄»õ›»[ú›XY8†%€H€õÿàŸôÇàÀ»Ÿ[ù\à[ôHÿ[Y\òHŸY\»\õö[ôÀÿ[YH\òYY€H\»H[›ô[Y[ùàÀ»õﬁ\›X⁄…‹»›€à[ò[Ÿ»›X⁄À[ôHŸ[úôK\›[ô\ôõ€⁄»›X⁄»ÇàÀ»ôZ]ö[‹à€à[ÿö[H
X]\öX[^ôK][ô\ã][Xà[ò[ZX»õﬁ\›X⁄‹ÀBàÀ»ÿ^H[‹›⁄[ã\›X⁄»[ÿö[Hÿ[Y\»[ôH€⁄»[ú]
KÇà]ÿ[Y\òQòY‘⁄[ù\íYHù[¬à]ÿ[Y\òRõﬁ\›X⁄”‹öY⁄[ñHÿ[Y\òRõﬁ\›X⁄”‹öY⁄[ñHH¬à]ÿ[Y\òRõﬁ\›X⁄÷Hÿ[Y\òRõﬁ\›X⁄÷HH»À»LKãåH\à^\À€€ú›[YY€òŸH\àúò[YH[àÿ[YS€‹à]ÿÿ[Y\òRõﬁ\›X⁄’\ôŸ]ﬁX€T\›Hò[ŸN»À»YŸKY]X››]Hõ‹àY[YH]]À]\ôŸ]ﬁX€[ôÀŸYHÿ[YS€‹	‹»õﬁ\›X⁄»€€ú›[\[€Çàù[ò›[€àÿ[Y\òQòY–[›ŸY

H¬àô]\õà[Y[ùS‹[à	âàYò\õQY][ŸH	âàYù\õö]\ôTXŸ[Y[ù\õYYŸ^H	âàYù\õö]\ôS[›ôP\õYYYà	âàYX[Ÿ›YVõ€€PX›]ôJ
H	âà]⁄[ô›Àëö\⁄[ôœÀú›]OÀòX›]ôH	âàX›]ÿŸ[ôTô]öY]–X›]ôH	âà]⁄[ô›Àî^[õÿôOÀò\õYY¬àBàÀ»]ô\ûH›\àÿ[Y\òH[ŸHùYŸ\»H€X[€⁄ÀX\õ›[ôŸôúŸ]€à‹ŸàBàÀ»ö^Yò\ŸHúò[Z[ôÀ€[\YY⁄
\⁄›‹€€ùõ€Àòÿ[Y\òTõ›]P€[\YÀàÀ»Yò][0¨Mp¨
H⁄[òŸH]	‹»YX[ù»ôHHYZÀõ›HúôYH‹òö]àŸX]YàÀ»^Y\ú»[ôH][]K]⁄Y[⁄\òX›\àöY]»Ÿ]Ÿ[ùZ[ôHÕå0¨àÀ»‹ö^õ€ù[‹òö][ú›XYÇàù[ò›[€àúôYTõ›]Pÿ[Y\òPX›]ôJ
H¬àô]\õà⁄\òX›\ïöY]”[ŸKô[òXõYÿ[Y\òS[ŸP€€ôöY X›]ôPÿ[Y\òS[ŸJKôúôYTõ›]HOOHùYN¬àBàÀ»‹ò\»[ù»
LNNH[ú›XYŸà€[\[ôÀ€»ô\X]YòY»[ú]àÀ»ŸY\»‹[õö[ô»[Hÿ^H\õ›[ôò]\à[à[õö[ô»][àYŸKÇàù[ò›[€à‹ò\^ö[]]Y Y H¬à]HY»	HÕå¬àYà
àN
HOHÕå¬àYà
HLN
H
œHÕå¬àô]\õà¬àBàÀ»öY⁄[à€õH8†%HYù[à\»H[›ô[Y[ùõﬁ\›X⁄…‹»\úö]‹ûBàÀ»
ŸYH⁄õﬁ\›X⁄÷õ€ôKõ›€K[Yù
H[ô\»ŸY\»H€»[Xú»úõ€BàÀ»]ô\àöY⁄[ô»›ô\àHÿ[YH›X⁄àH›X⁄][ô»€à[à^\›[ô¬àÀ»ù]€àô]ô\àôXX⁄\»\ôH][àù]€ú»\ôHŸ\\ò]H›ô\õZYàÀ»[[Y[ù»]ÿ]⁄Z\à›€à⁄[ù\ô›€àôYõ‹ôH]€›[ùXòõH¬àÀ»›ôYP€€ùZ[ô\ã€»õ›[ô»^òH\»ôYYY»^€YH[KÇàù[ò›[€àÿ[Y\òQòY‘ô\]Y\›Y
JH¬àô]\õàKú⁄[ù\ï\HOOH	››X⁄	»	âàKò€Y[ùèH⁄[ô›Àö[õô\ï⁄Y»é¬àBàù[ò›[€àYPÿ[Y\òRõﬁ\›X⁄ 
H¬àÿ[Y\òRõﬁ\›X⁄÷õ€ôKú›[Kô\‹^HH	€õ€ôIŒ¬àÿ[Y\òRõﬁ\›X⁄“€õÿãú›[Kùò[úŸõ‹õHH	›ò[ú€]JML	KML	JHò[ú€]J
IŒ¬àÿ[Y\òRõﬁ\›X⁄÷H¬àÿ[Y\òRõﬁ\›X⁄÷HH¬àBàôYP€€ùZ[ô\ãòY]ô[ù\›[ô\ä	‹⁄[ù\ô›€âÀ
JHOà¬àYà
Xÿ[Y\òQòY‘ô\]Y\›Y
JHXÿ[Y\òQòY–[›ŸY

JHô]\õé¬àÿ[Y\òQòY‘⁄[ù\íYHKú⁄[ù\íY¬àÿ[Y\òRõﬁ\›X⁄”‹öY⁄[ñHKò€Y[ù¬àÿ[Y\òRõﬁ\›X⁄”‹öY⁄[ñHHKò€Y[ùN¬àÿ[Y\òRõﬁ\›X⁄÷H¬àÿ[Y\òRõﬁ\›X⁄÷HH¬àÿ[Y\òRõﬁ\›X⁄÷õ€ôKú›[KõYùHKò€Y[ù
»	‹	Œ¬àÿ[Y\òRõﬁ\›X⁄÷õ€ôKú›[Kù‹HKò€Y[ùH
»	‹	Œ¬àÿ[Y\òRõﬁ\›X⁄÷õ€ôKú›[Kô\‹^HH	ÿõÿ⁄…Œ¬àÿ[Y\òRõﬁ\›X⁄“€õÿãú›[Kùò[úŸõ‹õHH	›ò[ú€]JML	KML	JHò[ú€]J
IŒ¬àÀ»ÿ[àõ›»
ìõ»X›]ôH⁄[ù\à⁄]H⁄]ô[àY\»õ›[ôäHõ‹àBàÀ»›X⁄]›\ù»ôYõ‹ôHHúõ›‹Ÿ\à€€ú⁄Y\ú»H⁄[ù\àù[BàÀ»X›]ôH8†%KôÀàöY⁄\»HYŸK€^[›]\»›[Ÿ][ô»Yù\ÇàÀ»ÿYà[òÿ]Y⁄]€›[X]ôHÿ[Y\òQòY‘⁄[ù\íY\õX[ô[ùBàÀ»›X⁄»€àH⁄[ù\à]⁄[ô]ô\àŸ]HX]⁄[ô»⁄[ù\ù\
ŸYBàÀ»HY[ùXÿ[ö^ÿ€€[Y[ù€à[ôRõﬁ\›X⁄‘⁄[ù\ë›€äK⁄[[ùBàÀ»õ‹[ô»]ô\ûHôX[ÿ[Y\òK[€⁄»òY»Yù\ùÿ\ô[ù[Hô[ÿYÇàûH»ôYP€€ùZ[ô\ãúŸ]⁄[ù\êÿ\\ôOÀäKú⁄[ù\íY
N»Hÿ]⁄
\úäH» àŸYHXõ›ôH8†%Y‹òYH‹òXŸYù[H
ã»BàJN¬àôYP€€ùZ[ô\ãòY]ô[ù\›[ô\ä	‹⁄[ù\õ[›ôIÀ
JHOà¬àYà
Kú⁄[ù\íYOOHÿ[Y\òQòY‘⁄[ù\íYXÿ[Y\òQòY–[›ŸY

JHô]\õé¬àÀ»ò\ŸH›^\»]⁄\ôHH[Xàö\ú››X⁄Y›€à8†%€õHH€õÿÇàÀ»
[ôHô\›[[ô»\õàò]JHòX⁄‹»Hö[ôŸ\àúõ€H\ôKÿ[YBàÀ»€[\ŸXYõ€ôK‹ô\‹€úŸKX›\ùôH⁄\H\»\]Rõﬁ\›X⁄ 
Hô[›ÀÇà€€ú›ò]÷HKò€Y[ùHÿ[Y\òRõﬁ\›X⁄”‹öY⁄[ñ¬à€€ú›ò]÷HHKò€Y[ùHHÿ[Y\òRõﬁ\›X⁄”‹öY⁄[ñN¬à€€ú›\›[òŸHHX]ö\›
ò]÷ò]÷JN¬à€€ú›[ô€HHX]ò][åäò]÷Kò]÷
N¬à€€ú›€[\YHX]õZ[ä\›[òŸK–SQTêW“ì÷T’P“◊‘êQUT N¬à€€ú›ò]”XY€ö]YHH€[\
€[\Y»–SQTêW“ì÷T’P“◊‘êQUTÀJN¬à€€ú›ô[X\YHò]”XY€ö]YHH–SQTêW“ì÷T’P“◊—PQì”ëBà»ààX]ú› 
ò]”XY€ö]YHH–SQTêW“ì÷T’P“◊—PQì”ëJH»
HH–SQTêW“ì÷T’P“◊—PQì”ëJK–SQTêW“ì÷T’P“◊‘ëT‘”î—JN¬àÿ[Y\òRõﬁ\›X⁄÷Hô[X\Yà»X]ò€‹ [ô€JH
àô[X\Yà¬àÿ[Y\òRõﬁ\›X⁄÷HHô[X\Yà»X]ú⁄[ä[ô€JH
àô[X\Yà¬àÿ[Y\òRõﬁ\›X⁄“€õÿãú›[Kùò[úŸõ‹õHHò[ú€]JML	KML	JHò[ú€]J	”X]ò€‹ [ô€JH
à€[\Y\	”X]ú⁄[ä[ô€JH
à€[\Y\
X¬àJN¬àù[ò›[€à€X\êÿ[Y\òQòY‘⁄[ù\äJH¬àYà
Kú⁄[ù\íYOOHÿ[Y\òQòY‘⁄[ù\íY
Hô]\õé¬àÿ[Y\òQòY‘⁄[ù\íYHù[¬àYPÿ[Y\òRõﬁ\›X⁄ 
N¬àBà⁄[ô›ÀòY]ô[ù\›[ô\ä	‹⁄[ù\ù\	À€X\êÿ[Y\òQòY‘⁄[ù\äN¬à⁄[ô›ÀòY]ô[ù\›[ô\ä	‹⁄[ù\òÿ[òŸ[	À€X\êÿ[Y\òQòY‘⁄[ù\äN¬ÇàÀ»Yù€X⁄»H€€X›[€àH
\⁄€
KöY⁄€X⁄»H€€X›[€àÇàÀ»
\⁄€
H⁄[à⁄Y[[ô»HŸX\€à€€8†%õ›]Yõ›Y⁄àÀ»€€Xò]ö[ú]€»HÿY›]	‹»Xö[]H€›»ÿ[à€Z[H[KÇàÀ»]ô\ûH›\à€€ŸY\»]»ô]ö[›\»€X⁄»ôZ]ö[‹à[ò⁄[ôŸYàYùàÀ»€X⁄»Hö[X\ûHX›[€ãöY⁄€X⁄»HŸX€€ô\ûHX›[€ãÇà€€ú›\⁄›‹ŸX\€î⁄[ù\î€›»Hô]»X\

N»À»Z\ú»XX⁄\⁄Xÿ[[›\ŸHô\‹»⁄]H€€Xò]€›ô[X\ŸYô[›ÀÇàYà
\—\⁄›‹
H¬àôYP€€ùZ[ô\ãòY]ô[ù\›[ô\ä	ÿ€€ù^Y[ùIÀ
JHOàKúô]ô[ùYò][

JN¬àôYP€€ùZ[ô\ãòY]ô[ù\›[ô\ä	‹⁄[ù\ô›€âÀ
JHOà¬àYà
Y[ùS‹[àò\õQY][ŸHKú⁄YùŸ^JHô]\õé¬àYà
[[ŸHOOH	›€€	»	âàX›]ôU€€OOH	›ŸX\€â»	âà⁄[ô›Àê€€Xò]Àö[ú]
H¬à€€ú›⁄[ù\êX›[€íYHKòù]€àOOH»	ÿX›[€åI»àKòù]€àOOHà»	ÿX›[€åâ»àù[»À»\ŸY»X\[›\ŸHô\‹Ÿ\»õ›Y⁄Hÿ[YHö\⁄XõK\€››ô\úöYH\»Ÿ^Xõÿ\ôÿ€€ùõ€\à[ú]Çà€€ú›ö\⁄XõS›ô\úöYHH⁄[ù\êX›[€íY»ö\⁄XõPX›[€ì›ô\úöYQõ‹ïŸX\€î€›
⁄[ù\êX›[€íY
Hàù[¬àYà
ö\⁄XõS›ô\úöYJH¬àö\⁄XõUŸX\€ê€€ù^ô\‹Ÿ\ÀòY
	€[›\ŸNâ»
»Kòù]€äN¬àù[êX›[€êù]€ê]€›
ö\⁄XõS›ô\úöYKú€›
N¬àô]\õé¬àBàûP]]—[ôÿYŸSY[YU\ôŸ]

N¬àYà
Kòù]€àOOH
H¬à\⁄›‹ŸX\€î⁄[ù\î€›ÀúŸ]
Kòù]€ãJN¬àX›[€í[›€àHùYN¬à⁄[ô›Àê€€Xò]ö[ú]úô\‹‘›\ù
JN¬àH[ŸHYà
Kòù]€àOOHäH¬à\⁄›‹ŸX\€î⁄[ù\î€›ÀúŸ]
Kòù]€ãäN¬à⁄[ô›Àê€€Xò]ö[ú]úô\‹‘›\ù
äN¬àBàô]\õé¬àBàYà
[[ŸHOOH	›€€	»	âàX›]ôU€€OOH	‹ò[ôŸY	»	âàKòù]€àOOHäH»ù[í[ú]X›[€ä	ÿX›[€åâÀ	‹ô\‹… N»ô]\õé»BàYà
Kòù]€àOOH
H¬àX›[€í[›€àHùYN¬à\ŸPX›]ôPX›[€ä
N¬àH[ŸHYà
Kòù]€àOOHäH¬à€€ú›ùú»H€€\]PX›[€êù]€ú 
N¬à€€ú›ŸX€€ôHùúÀôö[ô

ãJHOàHà	âàãò[›ŸY
N¬àYà
ŸX€€ô
H»X›]ôPX›[€àHŸX€€ôòX›[€é»\ŸPX›]ôPX›[€ä
N»BàBàJN¬àBàù[ò›[€àö[ö\⁄\⁄›‹[›\ŸPX›[€äJH¬àÀ»⁄[ù\àÿ⁄»ÿ[àô\‹ùH\⁄Xÿ[ô[X\ŸH\»H[›\ŸQ]ô[ù
⁄]àÀ»õ»⁄[ù\ï\JK€»XÿŸ\õ›õ‹õ\»[ôô[H€àô\‹»›€ô\ú⁄\ÇàYà
Z\—\⁄›‹
Hô]\õé¬àYà
Kú⁄[ù\ï\H	âàKú⁄[ù\ï\HOOH	€[›\ŸI Hô]\õé¬àYà
ö\⁄XõUŸX\€ê€€ù^ô\‹Ÿ\Àô[]J	€[›\ŸNâ»
»Kòù]€äJH¬àYà
Kòù]€àOOH
HX›[€í[›€àHò[ŸN¬àô]\õé¬àBà€€ú››€ôY€›H\⁄›‹ŸX\€î⁄[ù\î€›ÀôŸ]
Kòù]€äN¬àYà
›€ôY€›
H¬à\⁄›‹ŸX\€î⁄[ù\î€›Àô[]JKòù]€äN¬àYà
›€ôY€›OOHJHX›[€í[›€àHò[ŸN¬à⁄[ô›Àê€€Xò]Àö[ú]Àúô\‹—[ô
›€ôY€›
N¬àô]\õé¬àBàYà
[[ŸHOOH	›€€	»	âàX›]ôU€€OOH	›ŸX\€â»	âà⁄[ô›Àê€€Xò]Àö[ú]
H¬àYà
Kòù]€àOOH
H»X›[€í[›€àHò[ŸN»⁄[ô›Àê€€Xò]ö[ú]úô\‹—[ô
JN»Bà[ŸHYà
Kòù]€àOOHäH»⁄[ô›Àê€€Xò]ö[ú]úô\‹—[ô
äN»Bàô]\õé¬àBàYà
[[ŸHOOH	›€€	»	âàX›]ôU€€OOH	‹ò[ôŸY	»	âàKòù]€àOOHäH»ù[í[ú]X›[€ä	ÿX›[€åâÀ	‹ô[X\ŸI N»ô]\õé»BàYà
Kòù]€àOOH
HX›[€í[›€àHò[ŸN¬àBàÀ»ÿ\\ôHô[X\ŸHôYõ‹ôHX›[€ãX\ò⁄ÿòX⁄Ÿõ‹[ô\ú»ÿ[à€€ú›[YHBàÀ»[›ôYöY⁄X€X⁄»Ÿ\›\ôKà€€ù^Y[ùX\»⁄õ€Z][K”‹\òI‹»ö[ò[àÀ»]ô[ùõ‹à€€YHöY⁄YòY‹»]ô[à⁄[àZ\à‹ô[ò\ûH\]ô[ù\»‹›Çà⁄[ô›ÀòY]ô[ù\›[ô\ä	‹⁄[ù\ù\	Àö[ö\⁄\⁄›‹[›\ŸPX›[€ãùYJN¬à⁄[ô›ÀòY]ô[ù\›[ô\ä	€[›\Ÿ]\	Àö[ö\⁄\⁄›‹[›\ŸPX›[€ãùYJN¬à⁄[ô›ÀòY]ô[ù\›[ô\ä	ÿ]^€X⁄…Àö[ö\⁄\⁄›‹[›\ŸPX›[€ãùYJN¬à⁄[ô›ÀòY]ô[ù\›[ô\ä	ÿ€€ù^Y[ùIÀ
JHOà¬àYà
Z\—\⁄›‹Y\⁄›‹ŸX\€î⁄[ù\î€›Àö\ äJHô]\õé¬àKúô]ô[ùYò][

N¬àYà

ù[Xô\äKòù]€ú H	àäHOOH
Hö[ö\⁄\⁄›‹[›\ŸPX›[€äJN¬àKùYJN¬à⁄[ô›ÀòY]ô[ù\›[ô\ä	‹⁄[ù\òÿ[òŸ[	À
JHOà¬àYà
Z\—\⁄›‹
Hô]\õé¬àYà
Kú⁄[ù\ï\H	âàKú⁄[ù\ï\HOOH	€[›\ŸI Hô]\õé¬àõ‹à
€€ú›ÿù]€ã€›HŸà\⁄›‹ŸX\€î⁄[ù\î€› H¬à\⁄›‹ŸX\€î⁄[ù\î€›Àô[]Jù]€äN¬àYà
€›OOHJHX›[€í[›€àHò[ŸN¬à⁄[ô›Àê€€Xò]Àö[ú]ÀòXõ‹ùô\‹œÀä€›
N¬àBàKùYJN¬ÇàÀ»[›\ŸK[€⁄Œàò^Xÿ\››\ú€‹à€ù»‹õ›[ô[ôH»Ÿ]€‹õ‹⁄][€ÇàYà
\—\⁄›‹
H¬àôYP€€ùZ[ô\ãòY]ô[ù\›[ô\ä	€[›\Ÿ[[›ôIÀ
JHOà¬àÀ»HZ\‹⁄[ô»öY⁄Xù]€à\ÿ[à›[ôHõ›ô[àûHHù]€ú¬àÀ»ö]X\⁄»€àHô^ôX[[›\ŸH]ô[ùà[ôH›€ôY€ôYõ‹ôBàÀ»ÿ[Y\òK[€⁄»‹àZ[Z[ô»Ÿ]»H⁄[òŸH»\ŸH]]ô[ùÇàYà
\⁄›‹ŸX\€î⁄[ù\î€›Àö\ äH	âà
ù[Xô\äKòù]€ú H	àäHOOH
H¬àö[ö\⁄\⁄›‹[›\ŸPX›[€ä»ù]€éàã⁄[ù\ï\Nà	€[›\ŸI»JN¬àBàYà
\⁄›‹ŸX\€î⁄[ù\î€›Àö\ 
H	âà
ù[Xô\äKòù]€ú H	àJHOOH
H¬àö[ö\⁄\⁄›‹[›\ŸPX›[€ä»ù]€éà⁄[ù\ï\Nà	€[›\ŸI»JN¬àBàÀ»Hõÿ][ô»Y[ùH
H]\ŸK⁄[ùô[ù‹ûHY[ùH[ò€à]»[⁄[^HXãàÀ»H€€⁄⁄[ô»X\ùÿÿ[\ö\ôH[Ÿ[öXHŸ][ù\òX›[€êõÿ⁄ŸY‹ÇàÀ»H][]Y\»⁄Y[ÿ[à[ùöY\»\ò»ZŸH›[€ãÿ[[[»Ÿ[X›
H›€ú¬àÀ»H›\ú€‹à⁄[H‹[à8†%⁄]›]\À[›\ŸH[›ô[Y[ùŸ\àÀ»ö]ö[ô»òX⁄[ôÀÿÿ[Y\òHõ›][€à[ô\õôX]]öXH\»ÿ[YBàÀ»[ô\à
⁄YùYòY»[ô⁄›[\ã\›\ôâ‹»⁄[ù\àÿ⁄»ôXYàÀ»[›ô[Y[ù÷HôYÿ\ô\‹»Ÿà⁄]	‹»ö\›X[H€à‹
K€»BàÀ»ÿ[Y\òH‹[à›]úõ€H[ô\àHY[ùHH^Y\àÿ\»ûZ[ô»¬àÀ»€X⁄»[ùÀà[ùûSY[ùS‹[ä
H€›ô\ú»\ò‹»‹[ôYûH[›\ŸKXù]€ÇàÀ»òY»
⁄X⁄H\ò…‹»›€àù[\ÿ‹ôY[àòX⁄Ÿõ‹[ôXYH\€€]\¬àÀ»úõ€H\»[ô\äH\»Ÿ[\»€ô\»‹[ôYûHH[Ÿ^HZŸBàÀ»	ÿ…»ô[›»
⁄X⁄Ÿ\€â›òY»H[›\ŸHù]€ã€»õ›[ô»[ŸBàÀ»›‹»\»[ô\àúõ€Hö\ö[ô»⁄[H]	‹»\
KÇàYà
Y[ùS‹[à⁄[ô›ÀóŸ\⁄›‹Ÿ[X›[€ê\òœÀô[ùûSY[ùS‹[èÀä
JHô]\õé¬àYà
Kú⁄YùŸ^JH‹⁄YùòYŸŸYHùYN»À»\‹]X[YöY\»H›XúŸ\]Y[ù⁄Yù\ô[X\ŸHúõ€HôXY[ô»\»[à]]À]\ôŸ]\àYà
ò[ôŸY[[[–X›[€åîô\‹Àö[
H⁄[ô›ÀóŸ\⁄›‹Ÿ[X›[€ê\òœÀõ[›ôT⁄[ù\äKò€Y[ùKò€Y[ùJN¬àYà
ù\õö]\ôTXŸ[Y[ù\õYYŸ^Hù\õö]\ôS[›ôP\õYYY
Hô]\õé¬àÀ»⁄[HH^[õÿôH\»\õYY[›\ŸH[›ô[Y[ù⁄›[€õH]ô\ÇàÀ»[›ôHH›\ú€‹à›ÿ\ôH\ôŸ]^[8†%õ›õ›]HHÿ[Y\òBàÀ»
⁄Yù
ŸòYÀô[› H‹à‹[àH⁄\òX›\â‹»òX⁄[ô»öXH[›\ŸKBàÀ»€⁄»
⁄X⁄òY‹»H€YY⁄›[\à][€ô»⁄]]
KZ]\àŸÇàÀ»⁄X⁄€›[⁄YùHô\ûH[ô»ôZ[ô»Z[YY]ZYX\õÿX⁄ÇàYà
⁄[ô›Àî^[õÿôOÀò\õYY
Hô]\õé¬àÀ»\⁄›‹]]À]\ôŸ]\»[ù[ù[€ò[H€‹ŸNàZX‹õ»⁄[ù\àõ⁄\ŸH\¬àÀ»Y€õ‹ôYù][ûHôX[[›\ŸH[›ô[Y[ùô[X\Ÿ\»Hÿ[Y\òHúõ€H]¬àÀ»›\úô[ù\ôŸ]àHŸŸ€H›^\»€à€»⁄[\H[›ö[ô»Hô]X€BàÀ»òX⁄»›ô\à[à[ô[^HôXX‹]Z\ô\»]ÇàYà
\—\⁄›‹	âàY[YP]]’\ôŸ]€à	âàY[YUŸX\€ì›]

H	âÇàX]ö\›
ù[Xô\äKõ[›ô[Y[ù
Hù[Xô\äKõ[›ô[Y[ùJH
HàT“’‘–UU◊’Të—U”S’T—W–îëPR◊‘
H¬àX[ùX[]]’\ôŸ]Hù[¬àY[YP]]’\ôŸ]úôYPZ[HHùYN¬àBàÀ»⁄›[\ã\›\ôàŸ]»[›\ŸK[€⁄»ôõ‹àúôYHà\ôNàZ[à[›\ŸBàÀ»[›ô[Y[ùö]ô\»Hÿ[Y\òH^X›HZŸH⁄Yù
ŸòY»Ÿ\¬àÀ»]ô\û]⁄\ôH[ŸKõ»[ŸYöY\àŸ^HôYYY[ôúôYTõ›]Pÿ[Y\òPX›]ôJ
BàÀ»
ùYHõ‹à⁄›[\ã\›\ôâ‹»€€ôöYÀÿ[YH\»	‹ŸX]Y	 H[ôXYHXZŸ\¬àÀ»\»‹ò\[ù»Hù[Õå0¨‹òö][ú›XYŸàH\›X[0¨Mp¨YZ¬àÀ»€[\àò[»õ›Y⁄»Hò^Xÿ\›Xò\ŸYòX⁄[ôÀÿZ[Hô[›¬àÀ»›\ù⁄\ŸKÿ[YH\»][ÿ^\»\ÀÇàYà

Kú⁄YùŸ^HX›]ôPÿ[Y\òS[ŸHOOH“’STó‘’Tëó”S—JH	âàÿ[Y\òQòY–[›ŸY

JH¬à€€ú›Ÿô»H\⁄›‹€€ùõ€–€€ôöY 
N¬à€€ú›Y‘\îHù[Xô\ãö\—ö[ö]Jù[Xô\äŸôÀòÿ[Y\òTõ›]QY‘\î
JH»ù[Xô\äŸôÀòÿ[Y\òTõ›]QY‘\î
HàåMN¬à€€ú›€[\Y»Hù[Xô\ãö\—ö[ö]Jù[Xô\äŸôÀòÿ[Y\òTõ›]P€[\Y JH»ù[Xô\äŸôÀòÿ[Y\òTõ›]P€[\Y HàN¬àÿ[Y\òP^ö[]]ŸôúŸ]Y»HúôYTõ›]Pÿ[Y\òPX›]ôJ
Bà»‹ò\^ö[]]Y ÿ[Y\òP^ö[]]ŸôúŸ]Y»HKõ[›ô[Y[ù
àY‘\î
Bàà€[\
ÿ[Y\òP^ö[]]ŸôúŸ]Y»HKõ[›ô[Y[ù
àY‘\îX€[\YÀ€[\Y N¬àÿ[Y\òP[ô€SŸôúŸ]Y»H€[\
ÿ[Y\òP[ô€SŸôúŸ]Y»
»Kõ[›ô[Y[ùH
àY‘\îX€[\YÀ€[\Y N¬à\]Pÿ[Y\òT‹⁄][€ä
N¬àô]\õé¬àBÇàYà
ÿ[Y\òQòY‘⁄[ù\íYOOHù[Kú⁄YùŸ^JHô]\õé»À»⁄Yù
€[›\ŸH[›ô[Y[ù\»õ›][ô»Hÿ[Y\òKõ›Z[Z[ô¬à€€ú›ôX›HôYP€€ùZ[ô\ãôŸ]õ›[ô[ô–€Y[ùôX›

N¬à€[›\ŸSëÀûH

Kò€Y[ùHôX›õYù
H»ôX›ù⁄Y
H
ààHN¬à€[›\ŸSëÀûHHJ
Kò€Y[ùHHôX›ù‹
H»ôX›öZY⁄
H
àà
»N¬à‹ò^Xÿ\›\ãúŸ]úõ€Pÿ[Y\òJ€[›\ŸSëÀÿ[Y\òJN¬àÀ»ëQKî[ôI‹»€€ú›[ù\»Y\›[òŸKYúõ€K[‹öY⁄[à[€ô»]»õ‹õX[8†%àÀ»õ‹àH
K
Hõ‹õX[\ôH]	‹»⁄[\HY‹õ›[ôK€»H[ôBàÀ»\‹Ÿ\»õ›Y⁄H^Y\â‹»X›X[›\úô[ùZY⁄
[]ïY\ãX]ÿ\ôBàÀ»öXH‹^Y\ë‹õ›[ôJH[ú›XYŸà[ÿ^\»⁄][ô»]€‹õOLÇàŸ‹õ›[ô[ôKò€€ú›[ùHW‹^Y\ë‹õ›[ôJ
N¬àYà
‹ò^Xÿ\›\ãúò^Kö[ù\úŸX›[ôJŸ‹õ›[ô[ôK€[›\ŸU€‹õ
JH¬àYà
⁄[ô›Àê[⁄[^Qõ\⁄‹œÀòZ[Z[ô H⁄[ô›Àê[⁄[^Qõ\⁄‹ÀúŸ]\ôŸ]
€[›\ŸU€‹õû
àSK€[›\ŸU€‹õûà
àSJN»À»[›\ŸH‹õ›[ô]\ôŸ]›\ú€‹ãÇà€€ú›H€[›\ŸU€‹õûH^Y\ãû»SN¬à€€ú›àH€[›\ŸU€‹õûàH^Y\ãûH»SN¬àYà
X]ö\›
äHàå H¬àÀ»][åà[àôYKöú»éà[ô€Húõ€H
÷^\Àù]ÿ[YH\Ÿ\»Vè[õ‹ùà[›\ŸS€⁄–[ô€HHX]ò][åäã
N¬à\ôŸ]Z[P[ô€HH[›\ŸS€⁄–[ô€N¬à[›\ŸS€⁄–X›]ôHHùYN¬à\›[›\ŸS[›ôU[YHH\ôõ‹õX[òŸKõõ› 
N¬àBàBàJN¬àBàÀ»8• 8• ù\õö]\ôHXŸ\à⁄[ù\à[ô\à8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• àÀ»€X⁄À]À\XŸKÿ[YH[ù\òX›[€à[Ÿ[\»Hò\õHY]‹â‹»›€ÇàÀ»úù\⁄ô[›»
\H[K]\Y\»[[YYX][JHò]\à[àBàÀ»›ò\â‹»ô\]Z\][KZ[Hô]X€K[ù\òX›àõ›»8†%⁄X⁄ŸYö\ú›àÀ»€»[à\õYYù\õö]\ôHXŸ[Y[ù[ÿ^\»⁄[ú»›ô\àH
]ã[[ŸKBàÀ»€õK€»ò\ô[H⁄[][[ô[›\€HX›]ôJHò\õHY]‹àúù\⁄Çàù[ò›[€àù\õö]\ôTXŸ[Y[ù⁄[ù\ê\õYY

H¬àô]\õàHJù\õö]\ôTXŸ[Y[ù\õYYŸ^Hù\õö]\ôS[›ôP\õYYY
Bà	âà
›\úô[ù\ôXHOOH	Ÿò\õI»›\úô[ù\ôXHOOH	⁄[ù\ö[‹â N¬àBàôYP€€ùZ[ô\ãòY]ô[ù\›[ô\ä	‹⁄[ù\ô›€âÀ
JHOà¬àYà
Yù\õö]\ôTXŸ[Y[ù⁄[ù\ê\õYY

JHô]\õé¬àKúô]ô[ùYò][

N¬àKú›‹[[YYX]Tõ‹Yÿ][€ä
N¬àù\õö]\ôTXŸ[Y[ù⁄[ù\íYHKú⁄[ù\íY¬àûH»ôYP€€ùZ[ô\ãúŸ]⁄[ù\êÿ\\ôOÀäKú⁄[ù\íY
N»Hÿ]⁄
Ÿ\úäH» àô]öY]»›[õ€›‹»⁄]›]ÿ\\ôH
ã»Bà€€ú›[HH‹ÿ‹ôY[ï–X›]ôU[JKò€Y[ùKò€Y[ùJN¬àYà
[JH⁄›—ù\õö]\ôTXŸ[Y[ù⁄‹›
[Kò€€[Kúõ› N¬àK»ÿ\\ôNàùYHJN¬àôYP€€ùZ[ô\ãòY]ô[ù\›[ô\ä	‹⁄[ù\õ[›ôIÀ
JHOà¬àYà
Yù\õö]\ôTXŸ[Y[ù⁄[ù\ê\õYY

JHô]\õé¬àYà
Kú⁄[ù\ï\HOOH	€[›\ŸI»	âàKú⁄[ù\íYOOHù\õö]\ôTXŸ[Y[ù⁄[ù\íY
Hô]\õé¬àKúô]ô[ùYò][

N¬à€€ú›[HH‹ÿ‹ôY[ï–X›]ôU[JKò€Y[ùKò€Y[ùJN¬àYà
[JH⁄›—ù\õö]\ôTXŸ[Y[ù⁄‹›
[Kò€€[Kúõ› N¬àK»ÿ\\ôNàùYHJN¬àù[ò›[€à€€[Z]ù\õö]\ôTXŸ[Y[ù⁄[ù\äJH¬àYà
Kú⁄[ù\íYOOHù\õö]\ôTXŸ[Y[ù⁄[ù\íY
Hô]\õé¬àù\õö]\ôTXŸ[Y[ù⁄[ù\íYHù[¬àYà
Yù\õö]\ôTXŸ[Y[ù⁄[ù\ê\õYY

HYù\õö]\ôTXŸ[Y[ù⁄‹›
Hô]\õé¬àKúô]ô[ùYò][

N¬àKú›‹[[YYX]Tõ‹Yÿ][€ä
N¬à€€ú›»€€õ›»HHù\õö]\ôTXŸ[Y[ù⁄‹›¬àYà
ù\õö]\ôS[›ôP\õYYY
H¬à€€ú›ô\›[HõÿŸ\‹⁄[ô—ù\õö]\ôPûRY
ù\õö]\ôS[›ôP\õYYY
Bà»[›ôTõÿŸ\‹⁄[ô—ù\õö]\ôJù\õö]\ôS[›ôP\õYYY€€õ› Bàà[›ôQX€‹ò]]ôQù\õö]\ôJù\õö]\ôS[›ôP\õYYY€€õ› N¬à⁄›’ÿ\›
ô\›[õY\‹ÿYŸKô\›[õ⁄ N¬àYà
ô\›[õ⁄ Hù\õö]\ôS[›ôP\õYYYHù[¬àH[ŸH¬à€€ú›][RŸ^HHù\õö]\ôTXŸ[Y[ù\õYYŸ^N¬à€€ú›X€‹íŸ^HHŸ]X€‹ò]]ôQù\õö]\ôRŸ^PûR][RŸ^J][RŸ^JN¬à€€ú›õÿŸ\‹⁄[ô“Ÿ^HH›\úô[ù\ôXHOOH	Ÿò\õI»»Ÿ]ù\õö]\ôRŸ^PûR][RŸ^J][RŸ^JHàù[¬à€€ú›ô\›[HX€‹íŸ^Bà»XŸQX€‹ò]]ôQù\õö]\ôJ€€õ›ÀX€‹íŸ^JBààõÿŸ\‹⁄[ô“Ÿ^Bà»XŸTõÿŸ\‹⁄[ô—ù\õö]\ôJ€€õ›ÀõÿŸ\‹⁄[ô“Ÿ^JBàà»⁄Œàò[ŸKY\‹ÿYŸNà	—ù\õö]\ôHõ›õ›[ôâ»N¬à⁄›’ÿ\›
ô\›[õY\‹ÿYŸKô\›[õ⁄ N¬à⁄[ô›Àó◊Ÿò\õSŸœÀäŸù\õö]\ôK\XŸ\óH	‹ô\›[õ⁄»»	‹XŸY	»à	ÿõÿ⁄ŸY	ﬂH	ŸX€‹íŸ^HõÿŸ\‹⁄[ô“Ÿ^H][RŸ^_H]	ÿ›\úô[ù\ôX_H
	ÿ€€K	‹õ›ﬂJNà	‹ô\›[õY\‹ÿYŸ_Xô\›[õ⁄»»	⁄[ôõ…»à	›ÿ\õâ N¬àYà
ô\›[õ⁄»	âàõÿŸ\‹⁄[ô“Ÿ^JH¬àôYúô\⁄][Tÿ‹õ€

N¬àÿ]ôQò\õS^[›]

N¬àÿ]ôSY[Xô\ï€‹õ]J
N¬àBàYà
ô\›[õ⁄»	âà
[ùô[ù‹ûV⁄][RŸ^WH
HH
Hù\õö]\ôTXŸ[Y[ù\õYYŸ^HHù[¬àBà€X\ëù\õö]\ôTXŸ[Y[ù⁄‹›

N¬à⁄[ô›Àëù\õö]\ôTXŸ\èÀúô[ô\ä
N¬àBà⁄[ô›ÀòY]ô[ù\›[ô\ä	‹⁄[ù\ù\	À€€[Z]ù\õö]\ôTXŸ[Y[ù⁄[ù\ã»ÿ\\ôNàùYHJN¬à⁄[ô›ÀòY]ô[ù\›[ô\ä	‹⁄[ù\òÿ[òŸ[	À
JHOà¬àYà
Kú⁄[ù\íYOOHù\õö]\ôTXŸ[Y[ù⁄[ù\íY
Hô]\õé¬àù\õö]\ôTXŸ[Y[ù⁄[ù\íYHù[¬à€X\ëù\õö]\ôTXŸ[Y[ù⁄‹›

N¬àK»ÿ\\ôNàùYHJN¬ÇàÀ»8• 8• ò\õHY]‹à⁄[ù\à[ô\ú»8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• àôYP€€ùZ[ô\ãòY]ô[ù\›[ô\ä	‹⁄[ù\ô›€âÀ
JHOà¬àYà
ù\õö]\ôTXŸ[Y[ù\õYYŸ^Hù\õö]\ôS[›ôP\õYYYYò\õQY][ŸH›\úô[ù\ôXHOOH	Ÿò\õI Hô]\õé¬àKú›‹õ‹Yÿ][€ä
N¬àŸY]‹îZ[ù[ô»HùYN¬à€€ú›H‹ÿ‹ôY[ï—ò\õU[JKò€Y[ùKò€Y[ùJN¬àYà

H\Qò\õQY]úù\⁄
ò€€úõ› N¬àJN¬àôYP€€ùZ[ô\ãòY]ô[ù\›[ô\ä	‹⁄[ù\õ[›ôIÀ
JHOà¬àYà
ù\õö]\ôTXŸ[Y[ù\õYYŸ^Hù\õö]\ôS[›ôP\õYYYYò\õQY][ŸH›\úô[ù\ôXHOOH	Ÿò\õI»WŸY]‹îZ[ù[ô Hô]\õé¬àKú›‹õ‹Yÿ][€ä
N¬à€€ú›H‹ÿ‹ôY[ï—ò\õU[JKò€Y[ùKò€Y[ùJN¬àYà

H\Qò\õQY]úù\⁄
ò€€úõ› N¬àJN¬à⁄[ô›ÀòY]ô[ù\›[ô\ä	‹⁄[ù\ù\	À

HOà»ŸY]‹îZ[ù[ô»Hò[ŸN»JN¬ÇàÀ»^‹ŸHò\õHY]‹à»HS[ô[ù]€ú¬à⁄[ô›ÀóŸò\õQY]‹àH¬àŸŸ€NàŸŸ€Qò\õQY][ŸKàŸ]úù\⁄àò\õQY]‹îŸ]úù\⁄àÿ]ôNàÿ]ôQò\õS^[›]à€X\ì^[›]à

HOà¬àûH»ÿÿ[›‹òYŸKúô[[›ôR][Jò\õS^[›]Ÿ^J
JN»Hÿ]⁄ﬂBà⁄›’ÿ\›
	‘ÿ]ôY^[›]€X\ôYàô\Ÿ]Hò\õH»\KâÀùYJN¬àKàN¬ÇàÀ»PKŸ]ù€€»€⁄»õ‹àHù\õö]\ôHXŸ[Y[ù
»⁄][ô»ﬁ\›[\ÀàÀ»Z\úõ‹ö[ô»⁄[ô›ÀóŸ]î‹]€ô\ã◊Ÿò\õQY]‹àXõ›ôH8†%õ»[ãYÿ[YHRH]àÀ»»‹ò[ùù\õö]\ôH][\»\ôX›K€»\»^\›»õ‹àXY\‹À¬àÀ»€€ú€€H\›[ô»ò]\à[à\»H^Y\ãYòX⁄[ô»⁄X]Çà⁄[ô›Àó◊⁄ÿù[ööQù\õö]\ôQXùY»H¬à⁄]ôNà
][RŸ^KàHJHOà»[ùô[ù‹ûV⁄][RŸ^WHH
[ùô[ù‹ûV⁄][RŸ^WH
H
»é»KàXŸNàXŸQX€‹ò]]ôQù\õö]\ôKà⁄]àôY⁄[î⁄][ù\òX›[€ãà[ô⁄]à[ô⁄][ù\òX›[€ãàŸ]⁄]›]J
H»ô]\õà⁄][ù\òX›[€é»KàŸ]^Y\î›]J
H»ô]\õà»à^Y\ãûNà^Y\ãûK[ô€Nà^Y\ãò[ô€HN»KàŸ]ÿ[T›]J
H»ô]\õà»[ŸNàX›]ôPÿ[Y\òS[ŸK^ö[]]ŸôúŸ]YŒàÿ[Y\òP^ö[]]ŸôúŸ]YÀ‹⁄][€éà»àÿ[Y\òKú‹⁄][€ãûNàÿ[Y\òKú‹⁄][€ãûKéàÿ[Y\òKú‹⁄][€ãûàHN»Kàõ€XYŸQù\õö]\ôNà
X\YH›\úô[ù\ôXJHOà⁄[ô›Àëõ€XYŸQù\õö]\ôTù[ù[YOÀôXùY‘›]JX\Y
H◊Kà€‹õÿöôX›]àŸ]€‹õÿöôX›]àò\õU€‹õÿöôX›]à
€€õ› HOà€‹õÿöôX›ÀôŸ]
€€
»	À	»
»õ› KàX›[€êù]€úŒà

HOà€€\]PX›[€êù]€ú 
Kàú‘›][€éà
Y
HOàú‘›][€ú–ûRYôŸ]
Y
Kàú‘›][€ê€›[ùà

HOàú‘›][€ú–ûRYú⁄^ôKàú’[Uÿ[ÿXõNà
\ôXKÀäHOà\”ú’[Uÿ[ÿXõJ\ôXKÀäKàú—‹öY[P]à
\ôXKÀäHOà»€€ú›»Hú—‹öYõ‹ê\ôXJ\ôXJN»ô]\õàœÀñ‹óOÀñÿ◊Hù[»Kàò\õQ‹öY[P]à
ÀäHOà‹öYÀñ‹óOÀñÿ◊Hù[àXŸTõÿŸ\‹⁄[ôŒàXŸTõÿŸ\‹⁄[ô—ù\õö]\ôKà[›ôTõÿŸ\‹⁄[ôŒà[›ôTõÿŸ\‹⁄[ô—ù\õö]\ôKàõ›]TõÿŸ\‹⁄[ôŒàõ›]TõÿŸ\‹⁄[ô—ù\õö]\ôKàô[[›ôTõÿŸ\‹⁄[ôŒàô[[›ôTõÿŸ\‹⁄[ô—ù\õö]\ôKàŸX]Yú‹Œà

HOàú’ÿ[Ÿ\úÀôö[\ä»OàÀó‹ŸX]Y›][€íŸ^JKõX\
»Oà
»YàÀúôXœÀöY›][€íYàÀó‹ŸX]Y›][€íŸ^HJJKàX⁄’€‹õÿöôX›ôûà
€€õ›À
HOà»€€ú›»HŸ]€‹õÿöôX›]
€€õ› N»Yà
œÀù\]JHÀù\]J
N»ô]\õà»»»\’\]NàH[Àù\]HHàù[»KàÿY€‹õ]ô\›ÿ⁄Œà

HOà€ÿY€‹õ]ô\›ÿ⁄ 
Kàÿ]ôU€‹õ]ô\›ÿ⁄Œà
\›
HOà‹ÿ]ôU€‹õ]ô\›ÿ⁄ \›
Kà\‹⁄Y€ïò]à⁄[ô›Àë]’ò]Àò\‹⁄Y€ï’ò]à[ò\‹⁄Y€ïò]à⁄[ô›Àë]’ò]Àù[ò\‹⁄Y€ëúõ€Uò]àX⁄”]ô\›ÿ⁄Œà⁄[ô›Àëò\õP[ö[X[ÀùX⁄‘ô\€›\òŸ\ÀàŸ][ùô[ù‹ûNà

HOà
»ããö[ùô[ù‹ûHJKàÿYùZ[[ô‘ÿŸ[ôNà
X\Y
HOàÿYùZ[[ô‘ÿŸ[ôJX\Y
KàùZ[[ô“[ù\òX›XõP]à
X\Y€€õ› HOàÿùZ[[ô“[ù\òX›Xõ\ÀôŸ]
X\Y
»	À	»
»€€
»	À	»
»õ› KàùZ[[ô“[ù\òX›XõP€›[ùà

HOàÿùZ[[ô“[ù\òX›Xõ\Àú⁄^ôKàô[ô\ëò\õTõÿŸ\‹€‹úŒà

HOà⁄[ô›Àëò\õT[ô[úô[ô\ëò\õTõÿŸ\‹€‹ú 
Kà[ù\í[ù\ö[‹éà
YXŸRY
HOà[ù\í[ù\ö[‹äYXŸRY
Kà^][ù\ö[‹éà

HOà^][ù\ö[‹ä
KàŸ]›\úô[ù\ôXNà

HOà›\úô[ù\ôXKà[ù\ö[‹ëù\õö]\ôSÿöôX›Œà

HOà[ù\ö[‹ëù\õö]\ôSÿöôX›ÀàÿY€‹õ›‹òYŸNà

HOà€ÿY€‹õ›‹òYŸJ
KàŸ]⁄›”Y–õ€ô\Œà
äHOà⁄[ô›ÀîõÿŸY\ò[Y–[ö[X][€èÀúŸ]⁄›–õ€ô\ äKàŸ]⁄›”Y–õ€ô\ 
H»ô]\õàH]⁄[ô›ÀîõÿŸY\ò[Y–[ö[X][€èÀú⁄›–õ€ô\Œ»KàŸ]⁄][ù\òX›[€ä
H»ô]\õà⁄][ù\òX›[€é»Kà^Y\ìY‹‘ôYéà

HOà^Y\ìY‹ÀàŸ]\›][ô\‘Ÿ][ô 
H»ô]\õà◊Ÿ\›][ô\Œ»KàŸ]›][ô\‘Ÿ][ô 
H»ô]\õà◊€›][ô\Œ»KàŸ]^Y\ìôX⁄“õ⁄[ùõ›J
H»ô]\õà^Y\ìôX⁄“õ⁄[ù»^Y\ìôX⁄“õ⁄[ùúõ›][€ãûHàù[»KàŸ]^Y\ìôX⁄“õ⁄[ùõ›

H»ô]\õà^Y\ìôX⁄“õ⁄[ù»^Y\ìôX⁄“õ⁄[ùúõ›][€ãûàù[»KàŸ]^Y\ìY\⁄õ›J
H»ô]\õà^Y\ìY\⁄úõ›][€ãûN»KàŸ]^Y\ìY\⁄€‹õJ
H»ô]\õà^Y\ìY\⁄ú‹⁄][€ãûN»KàŸ]X›]ôPÿ[Y\òP^ö[]]Y 
H»ô]\õàX›]ôPÿ[Y\òP^ö[]]òY

H
àN»X]îN»KàŸ]ÿ[Y\òQòX⁄[ô–[ô€QY 
H»ô]\õàÿ[Y\òQòX⁄[ô–[ô€TòY

H
àN»X]îN»KàŸ]òX⁄[ô–[ô€QY 
H»ô]\õàòX⁄[ô–[ô€H
àN»X]îN»KàŸ]\ôŸ]Z[P[ô€QY 
H»ô]\õà\ôŸ]Z[P[ô€H
àN»X]îN»KàŸ][›\ŸS€⁄–[ô€QY 
H»ô]\õà[›\ŸS€⁄–[ô€H
àN»X]îN»KàŸ][›\ŸS€⁄–X›]ôJ
H»ô]\õà[›\ŸS€⁄–X›]ôN»KàŸ]ÿ[Y\òP[ô€SŸôúŸ]Y 
H»ô]\õàÿ[Y\òP[ô€SŸôúŸ]YŒ»KàŸ]⁄\òX›\ïöY]”[ŸJ
H»ô]\õà»ããù⁄[ô›Àí–ïSííW–“TêP’Tó’íQU◊‘’UT»N»KàŸ]⁄\òX›\ïöY]”[ŸNà
[òXõY
HOàŸ]⁄\òX›\ïöY]”[ŸJ[òXõY	ŸXùY… KàŸ]›\úô[ù^Y\êZ[P[ô€QY 
H»ô]\õà›\úô[ù^Y\êZ[P[ô€J
H
àN»X]îN»KàŸ]ò[ôŸY€€X]—Y 
H»ô]\õàŸXùY‘ò[ôŸY€€X]‘òYOOHù[»ù[àŸXùY‘ò[ôŸY€€X]‘òY
àN»X]îN»KàŸ]ò[ôŸY\”ÿYY

H»ô]\õà\]Z\Y[ù€›Àúò[ôŸY»⁄[ô›Àîò[ôŸYŸX\€úœÀö\”ÿYYÀä\]Z\Y[ù€›Àúò[ôŸY
HOOHò[ŸHàù[»KàŸ]⁄›[\î›\ôê€€Xò]›[òŸJ
H»ô]\õà⁄›[\î›\ôê€€Xò]›[òŸPX›]ôJ
N»KàŸ]⁄›[\î›\ôìŸôúŸ] 
H»ô]\õà»Yò][à◊‹⁄›[\î›\ôìŸôúŸ]ŸYò][Yò][éà◊‹⁄›[\î›\ôìŸôúŸ]óŸYò][€€Xò]à◊‹⁄›[\î›\ôìŸôúŸ]ÿ€€Xò]€€Xò]éà◊‹⁄›[\î›\ôìŸôúŸ]óÿ€€Xò]›\úô[ùà◊‹⁄›[\î›\ôìŸôúŸ]ÿ›\úô[ù›\úô[ùéà◊‹⁄›[\î›\ôìŸôúŸ]óÿ›\úô[ùN»KàŸ]Y[YP]]’\ôŸ]€ä
H»ô]\õàY[YP]]’\ôŸ]€é»KàŸ]Y[YP]]’\ôŸ]€éà
äHOà»Y[YP]]’\ôŸ]€àHH]é»KàŸ]Y[YP]]’\ôŸ]

H»€€ú›Hö[ô]]’\ôŸ]

N»ô]\õà»»àûNàûKYàöYHàù[»KàﬁX€SY[YP]]’\ôŸ]XùYŒà
\äHOàﬁX€SY[YP]]’\ôŸ]
\äKà›\úô[ù\ôXSÿÿ€\⁄[€ìY\⁄€›[ùà

HOà›\úô[ù\ôXSÿÿ€\⁄[€ìY\⁄\ 
Kõ[ô›à[ù\ñõ€ôQXùYŒà
X\Y€€õ› HOà[ù\ñõ€ôJX\Y€€õ› KàŸ]›][ô\Œà
äHOà»◊€›][ô\»HH]é»Kà^Y\ìôX⁄‘]õ›[ôõŒà

HOà¬à]]ò]\ë‹õ›\Hù[¬à^Y\ìY\⁄ùò]ô\úŸJ»Oà»Yà
Àõò[YHOOH	‹^Y\óÿ]ò]\â H]ò]\ë‹õ›\HŒ»JN¬à€€ú›öY»H]ò]\ë‹õ›\Àù\Ÿ\ë]OÀõôX⁄‘öYŒ¬àô]\õàöY»»¬à]òZ[XõNàöYÀò]òZ[XõKàôX⁄”ÿÿ[àöYÀõôX⁄”ÿÿ[à]õ›àöYÀú]õ›à[Ÿ[ZY⁄à]ò]\ë‹õ›\ù\Ÿ\ë]OÀú‹ùòZ][Ÿ[ZY⁄à[Ÿ[⁄Yà]ò]\ë‹õ›\ù\Ÿ\ë]OÀú‹ùòZ][Ÿ[⁄YàHàù[¬àKàö[ô]‘[U[\Œà

HOà¬à€€ú›õ›[ôH◊N¬àõ‹à
]àH»àì’‘Œ»ä  Hõ‹à
]»H»»””Œ»   HYà
‹öY‹óOÀñÿ◊OÀô]‘[JHõ›[ôú\⁄
»Àã€€‹éà‹öY‹óVÿ◊Kô]‘[HJN¬àô]\õàõ›[ô¬àKà›\úô[ù\ôXNà

HOà›\úô[ù\ôXKàN¬Çà⁄[ô›ÀòY]ô[ù\›[ô\ä	‹ô\⁄^ôIÀ

HOà»ö]–\‹X›

N»ô\⁄^ôPÿ[ùò\ 
N»\]Pÿ[Y\òT‹⁄][€ä
N»Yà
Y[ùS‹[äH]Y][ùô[ù‹ûT⁄^ö[ô 
N»JN¬àÀ»ÿYô]Hô]õ‹à[ûH[ùô[ù‹ûK‹X⁄»⁄[ôŸHõ›[ôXYH€›ô\ôYûH[ÇàÀ»^X⁄]ÿ]ôSY[Xô\ï€‹õ]J
Hÿ[Xõ›ôKà[€»õ\⁄\»BàÀ»[ã\õŸ‹ô\‹»[YK[ŸãY^H
Yò[òŸQ^K‹€Y\[êôY[ôXYHÿ]ôH€àZ\ÇàÀ»›€à^Hõ€›ô\úÀù]\»ÿ]⁄\»⁄]]ô\à[YLHõŸ‹ô\‹¬àÀ»\[ôY⁄[òŸHH\›€ôK€»€‹⁄[ô»ZYXYù\õõ€€àŸ\€â›õ€àÀ»òX⁄»»][‹õö[ô»ô^Ÿ\‹⁄[€äKÇàù[ò›[€àõ\⁄Ÿ\‹⁄[€î\ú⁄\›[òŸJ
H¬àûH»ÿ]ôQò\õS^[›]

N»ÿ]ôSY[Xô\ï€‹õ]J
N»‹ÿ]ôU€‹õÿ[[ô\ä
N»Hÿ]⁄ﬂBàBà⁄[ô›ÀòY]ô[ù\›[ô\ä	ÿôYõ‹ô][õÿY	Àõ\⁄Ÿ\‹⁄[€î\ú⁄\›[òŸJN¬à⁄[ô›ÀòY]ô[ù\›[ô\ä	‹YŸZYIÀõ\⁄Ÿ\‹⁄[€î\ú⁄\›[òŸJN¬Çà⁄[ô›ÀëX[Ÿ›YP€€ù[ùÀö[ö]
¬àÿ[[ô\ãàŸ]ú‘ôX€‹ôŒà

HOàú’ÿ[Ÿ\úÀõX\
»OàÀúôX Kôö[\äõ€€X[äKÀ»\ŸYûHYù\›ú—ò]õ‹â‹»›\ŸZ€›€‹ö‹XŸH‹[›ô\ãÇàŸ]›\úô[ù\ôXNà

HOà›\úô[ù\ôXKàŸ]^Y\ë]Nà

HOà‹^Y\ë]KàŸ]X[Ÿ›YS‹[éà

HOàX[Ÿ›YS‹[ãàŸ]X[Ÿ›YUÿ[Ÿ\éà

HOàŸX[Ÿ›YUÿ[Ÿ\ãàŸ]ÿ\ô\‘€€Œà

HOà–TëT◊‘””Àà›\úô[ùŸYZŸ^Sò[YNà⁄[ô›Àêÿ[[ô\îﬁ\›[Kò›\úô[ùŸYZŸ^Sò[YKà›\úô[ùŸX\€€éà⁄[ô›Àêÿ[[ô\îﬁ\›[Kò›\úô[ùŸX\€€ãàö\⁄[ô’[YSŸë^Nà

HOà⁄[ô›Àëö\⁄[ôÀù[YSŸë^J
Kàõ‹õX[^ôT›][€ìXô[àÿ[êXÿŸ\‹–€€ù[ùàŸ]]Y\››]\Àà\õí[ï\⁄Œà⁄[ô›ÀîõÿŸY\ò[\⁄‹Àù\õí[ï\⁄Àà⁄›’ÿ\›à‹[ìY[ùKà€‹ŸSú—X[Ÿ›YKàŸ]›]ÿŸ[ôTô]öY]–X›]ôNà

HOà›]ÿŸ[ôTô]öY]–X›]ôKàŸ]›]ÿŸ[ôTô]öY]–Yò[òŸNà

HOà›]ÿŸ[ôTô]öY]–Yò[òŸKàJN¬Çà⁄[ô›Àî^[õÿôOÀö[ö]
¬àô[ô\ô\ãàÿ[Y\òKà^Y\ìY\⁄à€€€\ãà€€\[ö[€ìÿöôX›Ààú’ÿ[Ÿ\úÀà^Y\ãàŸ]X›]ôTÿŸ[ôKàŸ]›\úô[ù\ôXNà

HOà›\úô[ù\ôXKàŸ]^Y\ë]Nà

HOà‹^Y\ë]KàŸ]^Y\ë‹õ›[ôNà‹^Y\ë‹õ›[ôKàŸ]^Y\ìY‹Œà

HOà^Y\ìY‹ÀàŸ]]^Y\ö[ô‘]à

HOà‹]^Y\ö[ô‘]àŸ]]^Y\ö[ô–X›]ôNà

HOà‹]^Y\ö[ô–X›]ôKàŸ]^Y\ê]ò]\ëúõ€ùX]\öX[à

HOà‹^Y\ê]ò]\ëúõ€ùX]\öX[àŸ]⁄][ù\òX›[€éà

HOà⁄][ù\òX›[€ãàŸ]ŸX]Yÿ[Y\òQXùYŒà

HOà‹ŸX]Yÿ[Y\òQXùYÀàŸ]]\ŸYà

HOà]\ŸYàŸ][ÿöôX›XùYÀàŸ]][T‹ö]RX€€ëXùYÀà“’STó‘U‘SëW‘ëSëTó”‘ëTãà^Y\ê]X⁄Y[ù[ò⁄‹ãà‹ôX]\ôP]X⁄Y[ù[ò⁄‹ãà‹[ìY[ùKà€‹ŸSY[ùKà⁄›’ÿ\›àJN¬Çà⁄[ô›Àì]\⁄XœÀö[ö]
¬àÿ[[ô\ãà^Y\ãàSKà€[\àXùY”ŸÀàŸ]›\úô[ù\ôXNà

HOà›\úô[ù\ôXKàŸ]]\ŸYà

HOà]\ŸYàŸ]ÿ[YT›\ùYà

HOàÿ[YT›\ùYàŸ]›\éà⁄[ô›Àêÿ[[ô\îﬁ\›[KôŸ]›\ãàŸ][YSŸë^Nà

HOà⁄[ô›Àëö\⁄[ôœÀù[YSŸë^OÀä
Kà›\úô[ùŸYZŸ^Sò[YNà⁄[ô›Àêÿ[[ô\îﬁ\›[Kò›\úô[ùŸYZŸ^Sò[YKà›\úô[ùŸX\€€éà⁄[ô›Àêÿ[[ô\îﬁ\›[Kò›\úô[ùŸX\€€ãà\‘^Y\í[ê€€Xò]àS‘ìíSë◊“’TãàŸ]€‹ö‹‹XŸSX\Œà

HOà›€‹ö‹‹XŸSX\Àà⁄\÷õ€ôP\ôXKà⁄\–ùZ[[ô–\ôXKàVTíS‘ó÷ì”ëTÀàJN¬Çà⁄[ô›Àê]Y[‘ﬁ\›[OÀö[ö]
¬à[U\KàSKàPV’–UTãà€[\à^Y\ãàŸ]›\úô[ù\ôXNà

HOà›\úô[ù\ôXKà⁄\–ùZ[[ô–\ôXKàú—‹öYõ‹ê\ôXKà\‘ôX[YYXQ\úõ‹éà
ããòJHOà⁄[ô›Àì]\⁄XœÀö\‘ôX[YYXQ\úõ‹äããòJKàX\ö–]Y[’\õòZ[Yà
ããòJHOà⁄[ô›Àì]\⁄XœÀõX\ö–]Y[’\õòZ[Y
ããòJKà]Y[’\õòZ[Yà
ããòJHOà⁄[ô›Àì]\⁄XœÀò]Y[’\õòZ[Y
ããòJKàJN¬Çà⁄[ô›Àê[ö[X[õÿÿ[^ò][€úœÀö[ö]
¬àò[ô€Nàõôà\’õ⁄XŸNà
 HOà⁄[ô›Àê]Y[‘ﬁ\›[OÀö\–[ö[X[õ⁄XŸOÀä Kàô[ô\ï]\ò[òŸNà
À‹ HOà⁄[ô›Àê]Y[‘ﬁ\›[OÀú^P[ö[X[õ⁄XŸU]\ò[òŸOÀäÀ‹ KàJN¬Çà⁄[ô›Àê€€Xò]Àö[ö]
¬à^Y\ãà^Y\úÀàSKà‹›[SÿöôX›Àà€€\[ö[€ìÿöôX›ÀàŸ]›\úô[ù\ôXNà

HOà›\úô[ù\ôXKàÀ»ò[YY[ö[X[õ⁄ôX›[\»\ŸHHÿ[YH]ôHôYKöú»[]ò][€à\¬àÀ»H^Y\ãÿ‹ôX]\ôHô[ô\ô\ú»€»ô[ö⁄\úòI‹»ô\ùXÿ[‹]Z[H\¬àÀ»ò\ŸY€àX›X[\ôŸ]ZY⁄õ›Hõ][ôY‹õ›[ô[ôKÇàŸ]X›‹ï€‹õNà
X›‹äHOà¬àYà
X›‹àOOH^Y\äHô]\õà^Y\ìY\⁄ú‹⁄][€ãûN¬à€€ú›]ò]\ñHHX›‹èÀò]ò]\îôYèÀô‹õ›\Àú‹⁄][€èÀûN¬àYà
ù[Xô\ãö\—ö[ö]J]ò]\ñJJHô]\õà]ò]\ñN¬àYà
ù[Xô\ãö\—ö[ö]JX›‹èÀû
H	âàù[Xô\ãö\—ö[ö]JX›‹èÀûJJHô]\õàX›]ôT›\ôòXŸVP]€‹õ
X›‹ãû»SKX›‹ãûH»SJH
»ç¬àô]\õàç¬àKà€‹õ›\ôòXŸVNà
JHOàX›]ôT›\ôòXŸVP]€‹õ
»SKH»SJKàŸ]X›]ôTÿŸ[ôKàŸ]^Y\ìY[YPZ[Q\ôX›[€éà›\úô[ù^Y\ìY[YPZ[Q\ôX›[€ãàŸ]^Y\ìY[YPZ[T]⁄à›\úô[ù^Y\ìY[YPZ[T]⁄àŸ][[ŸNà

HOà[[ŸKàŸ]X›]ôU€€à

HOàX›]ôU€€àŸ]Y[YTô]X€U\ôŸ]à

HOàö[ô]]’\ôŸ]

H⁄[ô›Àîò[ôŸYŸX\€úœÀôõÿ›\ŸY‹›[OÀäç
OÀòÿ[ôY]OÀô]Hù[à[ê€€ôKà[XYŸP‹ôX]\ôKà[XYŸT^Y\ãà\R€õÿ⁄ÿòX⁄ÀàŸX\€êXö[]Kà€€Xò]€€ôöYÀàô\€€ôUŸX\€í]à€X\ïôYŸ]][€í[ê]X⁄–€€ôKàö[ô]]’\ôŸ]àÿ[î^Y\ìÿÿ›\Kàÿ[ìÿÿ›\P]àŸ]‹ôX]\ôQúò[YKàŸ[õ›\R⁄[ôõ‹éà
 HOà
ÀôŸ[õ›\H»
⁄[ô›Àê‹ôX]\ôQŸ[ô]X‹Àî‘P“QT◊–SPT÷ÿÀò‹ôX]\ôRŸ^WHÀò‹ôX]\ôRŸ^JHàù[
Kà⁄›’ÿ\›àöYŸŸ\ïŸX\€î›⁄[ô’ö\›X[àöYŸŸ\ïŸX\€í€ö\›X[àô[X\ŸUŸX\€î›⁄[ô“€àÿ[òŸ[ŸX\€î›⁄[ô“€àôY⁄[ê€€Xò][ôŸKàŸ]€€Xò]›⁄[ô–€€ôKà‹]€êù\ú›YôôX›à^P‹ôX]\ôPò\öŒà
ããòJHOà⁄[ô›Àê]Y[‘ﬁ\›[OÀú^P‹ôX]\ôPò\ö ããòJKàô\]Y\›ôX]‹õ›€à
ÀôX\€€äHOà⁄[ô›Àê[ö[X[õÿÿ[^ò][€úœÀùôX]‹õ›€ÀäÀôX\€€äBà⁄[ô›Àê]Y[‘ﬁ\›[OÀú^P‹ôX]\ôPò\öœÀä Kà^P‹ôX]\ôP€]“]à
ããòJHOà⁄[ô›Àê]Y[‘ﬁ\›[OÀú^P‹ôX]\ôP€]“]
ããòJKà^UŸX\€î€\⁄Ÿûà
ããòJHOà⁄[ô›Àê]Y[‘ﬁ\›[OÀú^UŸX\€î€\⁄Ÿû
ããòJKà^UŸX\€í]Ÿûà
ããòJHOà⁄[ô›Àê]Y[‘ﬁ\›[OÀú^UŸX\€í]Ÿû
ããòJKà^P€›[ù\î⁄Y[õÿ⁄‘Ÿûà
ããòJHOà⁄[ô›Àê]Y[‘ﬁ\›[OÀú^P€›[ù\î⁄Y[õÿ⁄‘Ÿû
ããòJKàÀ»ò[YY[ö[X[]X⁄‹»
KôÀà›[òŸJH›€àH‹ôX]\ôI‹»‹⁄][€ÇàÀ»\ôX›Hõ‹àZ\àX\[ú›XYŸà€⁄[ô»õ›Y⁄[›ôP‹ôX]\ôU›ÿ\ôàÀ»8†%⁄]›]\À]‹õ›[ô€›ô\ôY\ö[ô»HX\ô]ô\àX⁄ŸYàÀ»Hõ€››\
ŸYH€€Xò]X[ö[X[X]X⁄‹Àöú…‹»›[òŸU\]JKÇàX⁄–‹ôX]\ôQõ€››\ÀàÀ»ÿ[YHYXH\»X⁄–‹ôX]\ôQõ€››\»ù]õ‹àH€€‹ôY€ö[€ã\ö[ô¬àÀ»[ôŸHòZ[
ŸYH‹]€ì[ôŸUòZ[›[\
H8†%›[òŸI‹»X\\‹Ÿ\»]¬àÀ»›€àY’YÀY\ö]ôYYôõX›[€êõ€ù\Ÿ\»⁄[òŸH]\»õ»\‹òYHôYBàÀ»»ôXYúõ€HHÿ^H^Y\à]X⁄‹»ÀÇàX⁄–‹ôX]\ôS[ôŸUòZ[àÀ»ÿ]\»]ô\ûHŸX\€à\⁄€Xö[]H
ŸYH€€Xò]Z[ú]öú H8†%õ¬àÀ»]X⁄⁄[ô»⁄[H›⁄[[Z[ô»[àHö]ô\ã‹›ôX[K^Y\à‹à‹ôX]\ôKÇà\‘^Y\î›⁄[[Z[ôÀàÀ»ö]ô\»HÿY›]	‹»€€Xõ»€›
\JH8†%ô]ô\à^Y\ãX⁄‹Ÿ[ãàÀ»[ÿ^\»⁄X⁄]ô\à€€Xõ»X]⁄\»H\]Z\YŸX\€â‹»›€à›⁄[ô¬àÀ»›[H
ŸYH€€Xò][ÿY›]öú…‹»€€Xõ–Xö[]RY

JKÇà›\úô[ù€€Xõ–Xö[]RYàÀ»X⁄‹»⁄X⁄YôõX›[€ã[‹[€àõ]õ‹à]ô\ûHŸX\€ã]€€Xö[]BàÀ»Ÿôô\ú»
ŸYH€€Xò]\õŸ‹ô\‹⁄[€ãöú KÇà›\úô[ùŸX\€ë[XYŸU\KàŸX\€ë[XYŸU\Qõ‹ï€€àÀ»Ÿ^\»HÿY›]	‹»\ã]ŸX\€à€›\‹⁄Y€õY[ù»
ŸYBàÀ»€€Xò][ÿY›]öú KÇà›\úô[ùŸX\€íŸ^Kà›\úô[ùŸX\€ìXô[àÀ»€€X\›\ûH
ùù\›H^K‹⁄›ô[‹X⁄À‹‹X\àäHÿ]\»⁄X⁄ŸàBàÀ»€€	‹»›€à\]Z\YXö[]Y\…»H\‹òYH]ô[»ÿ[àôH⁄‹Ÿ[é¬àÀ»[›\»Ÿàõ›Ÿ\‹»^Hõ‹àX›X[HXZ⁄[ô»]⁄⁄XŸH8†%õ›ŸYBàÀ»€€Xò]\õŸ‹ô\‹⁄[€ãöúÀÇà€€X\›\ûS]ô[à]ÿ\ôŸX\€ìX\›\ûVàŸ][›\”Ÿîõ›Ÿ\‹Àà‹[ô[›\”Ÿîõ›Ÿ\‹Àà]ÿ\ô[›\”Ÿîõ›Ÿ\‹ÀàÀ»ÿ]\»HÿY›]YŸI‹»]ã[€õHäÃH[›Hà\›ù]€à
ŸYBàÀ»€€Xò][ÿY›]]ZKöú H8†%Z\úõ‹ú»Hÿ[YH◊Ÿ]ì[ŸHŸŸ€HBàÀ»ŸX\ã]€€][H[ô[	‹»äÃHX\›\ûHàù]€à\Ÿ\ÀÇà\—]ì[ŸNà

HOà◊Ÿ]ì[ŸKàÀ»ö\ô\»HŸX\€à€€	‹»Z[à›]‹€\⁄›⁄[ô»^X›H\»]àÀ»ôZ]ôYôYõ‹ôHHÿY›]ﬁ\›[H^\›Y8†%Hò[òX⁄¬àÀ»€€Xò]Z[ú]öú»\Ÿ\»õ‹àH\€›[ù[[àXö[]H[Ÿ[BàÀ»€Z[\»]Çàö\ôSYÿXﬁUŸX\€êX›[€éà
€›[ô^
HOà¬àYà
X›]ôU€€OOH	›ŸX\€â Hô]\õé¬àX›]ôPX›[€àH€€X›[€úÀùŸX\€ñ‹€›[ô^HWN¬à\ŸPX›]ôPX›[€ä
N¬àKàJN¬Çà⁄[ô›ÀìôX\òûUõ€[YP€€\⁄[€èÀö[ö]
¬àëQKàSKà^Y\ãàŸ]X›]ôTÿŸ[ôKàŸ]›\úô[ù\ôXNà

HOà›\úô[ù\ôXKà€‹õ›\ôòXŸVNà
JHOàX›]ôT›\ôòXŸVP]€‹õ
»SKH»SJKà\–€€Xò]X›]ôNà

HOà\‘^Y\í[ê€€Xò]

Hà
[[ŸHOOH	›€€	»	âà

X›]ôU€€OOH	›ŸX\€â»	âàHY\]Z\Y[ù€›ÀùŸX\€äHà
X›]ôU€€OOH	‹ò[ôŸY	»	âàHY\]Z\Y[ù€›Àúò[ôŸY
JJKà‹[€úŒà¬à[òXõYàÿ›[Y[ùôŸ][[Y[ùûRY
	‹Ÿ][ô’õ€[YP€€\⁄[€ìX\›\â OÀò⁄X⁄ŸYOOHò[ŸKàõ⁄ôX›[\Œàÿ›[Y[ùôŸ][[Y[ùûRY
	‹Ÿ][ô’õ€[YP€€\⁄[€îõ⁄ôX›[\… OÀò⁄X⁄ŸYOOHò[ŸKà^\ôP[Nàÿ›[Y[ùôŸ][[Y[ùûRY
	‹Ÿ][ô’õ€[YP€€\⁄[€ê[I OÀò⁄X⁄ŸYOOHò[ŸKàKàXùY”ŸÀàJN¬Çà⁄[ô›Àîò[ôŸYŸX\€úœÀö[ö]
¬à^Y\ãà^Y\îòY]\ŒàVQTó‘êQUTÀàSKà‹›[SÿöôX›Ààú’ÿ[Ÿ\úÀÀ»^‹ŸY»Hò[ôŸYXùY»€ò\⁄›€»úöY[ôH‹ùòZ]]õﬁ\»ÿ[àôH[ú‹X›Y⁄]›]XZ⁄[ô»[H[XYŸH\ôŸ]ÀÇàŸ]›\úô[ù\ôXNà

HOà›\úô[ù\ôXKàŸ]X›]ôTÿŸ[ôKàÀ»ÿ[YH]ôHô[ô\ãZZY⁄€⁄›\€€Xò]ö[ö]›\Y\»õ‹àò[YYàÀ»[ö[X[õ⁄ôX›[\»
ŸYH]»›€àŸ]X›‹ï€‹õJH8†%H⁄€›\à‹ÇàÀ»\ôŸ]›[ô[ô»€€Y]⁄\ôH›\à[àõ]‹õ›[ô
HôYHúò[ò⁄
BàÀ»ö\ô\ÀŸŸ]»Z[YY]úõ€HZ\àôX[ZY⁄õ›H\úòZ[ÇàÀ»›òZY⁄ô[›»[KÇàŸ]X›‹ï€‹õNà
X›‹äHOà¬àYà
X›‹àOOH^Y\äHô]\õà^Y\ìY\⁄ú‹⁄][€ãûN¬à€€ú›]ò]\ñHHX›‹èÀò]ò]\îôYèÀô‹õ›\Àú‹⁄][€èÀûN¬àYà
ù[Xô\ãö\—ö[ö]J]ò]\ñJJHô]\õà]ò]\ñN¬àYà
ù[Xô\ãö\—ö[ö]JX›‹èÀû
H	âàù[Xô\ãö\—ö[ö]JX›‹èÀûJJHô]\õàX›]ôT›\ôòXŸVP]€‹õ
X›‹ãû»SKX›‹ãûH»SJH
»ç¬àô]\õàç¬àKàŸ]^Y\êZ[P[ô€Nà›\úô[ù^Y\êZ[P[ô€KàŸ]^Y\êZ[T]⁄à›\úô[ù^Y\êZ[T]⁄àŸ]^Y\êZ[Tò^Nà›\úô[ù^Y\êZ[Tò^KàŸ]^Y\í[ù\òX›[€îò^Nà›\úô[ù^Y\í[ù\òX›[€îò^KàŸ]^Y\ê]ò]\ë‹õ›\à

HOà¬à]]ò]\ë‹õ›\Hù[¬à^Y\ìY\⁄Àùò]ô\úŸOÀä⁄[Oà¬àYà
X]ò]\ë‹õ›\	âàù[Xô\ãö\—ö[ö]J⁄[ù\Ÿ\ë]OÀú‹ùòZ][Ÿ[ZY⁄
JH]ò]\ë‹õ›\H⁄[¬àJN¬àô]\õà]ò]\ë‹õ›\¬àKà€‹õ›\ôòXŸVNà
JHOà¬à€€ú›‹öYHŸ]X›]ôQ‹öY

N¬à€€ú›€€H€[\
X]ôõ€‹ä»SJKŸ]X›]ôP€€ 
HHJN¬à€€ú›õ›»H€[\
X]ôõ€‹äH»SJKŸ]X›]ôTõ›‹ 
HHJN¬àô]\õà‹öY‹õ›◊OÀñÿ€€H»[T›\ôòXŸVR[ê\ôXJ‹öY‹õ›◊Vÿ€€K›\úô[ù\ôXJHà¬àKàÿ[ìÿÿ›\P]à[XYŸP‹ôX]\ôKà[XYŸT^Y\ãà[ô€QYôãàÿ[Y\òTô[]]ôP‹ôX]\ôT\úÀà‹ôX]\ôT\úXYòYà⁄[ô›Àî\úõ›][€ãê‘ëPUTëW‘Tî—PQ‘êQà[ÿöôX›ô[ô\ì‹ô\éàS”–íëP’‘ëSëTó”‘ëTãàöYŸŸ\îò[ôŸYŸX\€ïö\›X[àŸ]ò[ôŸYÿYYö\›X[àôYúô\⁄X›[€êò\ãà[›ôP‹ôX]\ôU›ÿ\ôà]ÿ\ôò[ôŸYX\›\ûNà
][RŸ^JHOà]ÿ\ô€€X\›\ûV
][RŸ^KPT’TñW÷‘Tó–””PêU“U
Kà€€X\›\ûS]ô[à]êù[\€€X\›\ûS]ô[àŸ]ŸX\í[ùô[ù‹ûNà

HOàŸX\í[ùô[ù‹ûKàÿ]ôQŸX\í[ùô[ù‹ûKàŸ]\]Z\Yò[ôŸYŸ^Nà

HOà\]Z\Y[ù€›Àúò[ôŸYà\’ŸX\€êZ[Z[ôŒà

HOà[[ŸHOOH	›€€	»	âà

X›]ôU€€OOH	›ŸX\€â»	âàHY\]Z\Y[ù€›ÀùŸX\€äH
X›]ôU€€OOH	‹ò[ôŸY	»	âàHY\]Z\Y[ù€›Àúò[ôŸY
JKàŸ]Z[SXô[ò[ôŸU€‹õà

HOàX›]ôU€€OOH	‹ò[ôŸY	¬à»
⁄[ô›Àîò[ôŸYŸX\€úœÀú^Y\ìÿ⁄‘ò[ôŸTÀä\]Z\Y[ù€›Àúò[ôŸY
HSH
à H»SBààX]õX^
Àù[Xô\ä€€Xò]€€ôöY 
Kò]]’\ôŸ]ò[ôŸU[\ H
Kà⁄›’ÿ\›àò[ô€Nà

HOà⁄[ô›Àëÿ[YTò[ô€OÀúò[ô€OÀä
Hœ»X]úò[ô€J
KàŸ]\›Y[YRZY⁄õÿ⁄Œà

HOà\›Y[YRZY⁄õÿ⁄ÀàXùY”ŸÀÀ»]»Hò[ôŸY[Ÿ[Hô\‹ù]»]\›\›XõHôZ]ö[‹à[àH€ã\ÿ‹ôY[à[ÿö[HXùY»[ô[ÇàJN¬Çà⁄[ô›Àì[›[ùœÀö[ö]
¬à^Y\ãàÿŸ[ôKà€€\[ö[€ìÿöôX›ÀàŸ]›XõNà

HOà›XõKà‘ëPUTëW—ãà[ú]àùêÿ[[›[ùàSKàVQTó‘êQUTÀàêP“Së◊”TîàS’ëW‘‘QQàP–—SàP—SàS’T—W“QW”TÀà\—\⁄›‹àõôà€[\à[ô€QYôãàÿ[î^Y\ìÿÿ›\KàŸ][⁄[^T‹YY][à⁄[ô›Àê[⁄[^Tﬁ\›[KôŸ]‹YY][àŸ]Ÿ^Xõÿ\ôôX›‹ãàXZŸP‹ôX]\ôQ[ù]Kà\‹]€ê‹ôX]\ôKà[›ôP‹ôX]\ôU›ÿ\ôà\]P‹ôX]\ôSY\⁄à\]P‹ôX]\ôP[ö[Qúò[YKà[T›\ôòXŸVR[ê\ôXKà⁄\òX›\ë‹õ›[ô⁄Y›‘›\ôòXŸSŸôúŸ]àŸ]X›]ôTÿŸ[ôKàŸ]X›]ôQ‹öYàŸ]X›]ôP€€ÀàŸ]X›]ôTõ›‹Àà⁄\÷õ€ôP\ôXKà⁄\–ÿ]ô\õêùZ[[ô–\ôXKà⁄›’ÿ\›àŸ]›\úô[ù\ôXNà

HOà›\úô[ù\ôXKàŸ]X›]ôS[›[ùYà

HOàX›]ôS[›[ùYàŸ]]ë€ÿò[‹YY][à

HOà]ë€ÿò[‹YY][àŸ]òX⁄[ô–[ô€Nà

HOàòX⁄[ô–[ô€KàŸ]òX⁄[ô–[ô€Nà
äHOà»òX⁄[ô–[ô€HHé»KàŸ][›\ŸS€⁄–X›]ôNà

HOà[›\ŸS€⁄–X›]ôKàŸ][›\ŸS€⁄–X›]ôNà
äHOà»[›\ŸS€⁄–X›]ôHHé»KàŸ]€€ùõ€\ì€⁄–X›]ôNà

HOà€€ùõ€\ì€⁄–X›]ôKàŸ]€€ùõ€\ì€⁄–[ô€Nà

HOà€€ùõ€\ì€⁄–[ô€KàŸ]\›[›\ŸS[›ôU[YNà

HOà\›[›\ŸS[›ôU[YKàŸ][›\ŸS€⁄–[ô€Nà

HOà[›\ŸS€⁄–[ô€Kà\‘⁄›[\î›\ôì[ŸNà

HOàX›]ôPÿ[Y\òS[ŸHOOH“’STó‘’Tëó”S—Kàÿ[Y\òQòX⁄[ô–[ô€TòYàJN¬Çà⁄[ô›Àëö\⁄[ôœÀö[ö]
¬à€[\àŸ]X›]ôTÿŸ[ôKà›\úô[ùŸX\€€éà⁄[ô›Àêÿ[[ô\îﬁ\›[Kò›\úô[ùŸX\€€ãàŸ]›\éà⁄[ô›Àêÿ[[ô\îﬁ\›[KôŸ]›\ãàíT“—QîÀàŸ]ô]X€U[KàŸ]X›]ôU[P]à[T›\ôòXŸVR[ê\ôXKà^Y\ìY\⁄à⁄›’ÿ\›àôYúô\⁄X›[€êò\ãàYPX›[€îõ€\à⁄›–X›[€îõ€\à]X⁄–X›[€íX€€íSà€‹õ”›ô\õ^Kà[ùô[ù‹ûKà\]Z\Y[ù€›Ààõ€][T›\úÀà›\îò][ô’^àò\ôQö\⁄ŸZY⁄][\Y\éàò\ö]HOà⁄[ô›Àî⁄⁄[ﬁ\›[OÀúò\ôQö\⁄ŸZY⁄][\Y\èÀäò\ö]JHKàŸ]^Y\éà

HOà^Y\ãàôX€‹ô][T]X[]Nà
ããò\ô‹ HOà⁄[ô›Àê€€⁄⁄[ô‘ﬁ\›[OÀúôX€‹ô][T]X[]OÀäããò\ô‹ Kà]ÿ\ôö\⁄[ô÷à

HOà⁄[ô›Àî⁄⁄[ﬁ\›[OÀò]ÿ\ôÀä	Ÿö\⁄[ô…À⁄[ô›Àî⁄⁄[ﬁ\›[OÀñ—–RSîœÀôö\⁄L	ÿÿ]Y⁄ö\⁄	 Kà]ÿ\ô€€\ŸSX\›\ûVàŸ][ùô[ù‹ûT›X⁄“Ÿ^\ÀàŸ]›\úô[ù\ôXNà

HOà›\úô[ù\ôXKàŸ]ôYTôX›à

HOà›ôYTôX›àŸ]X›]ôR][R[ô^à
äHOà»X›]ôR][R[ô^Hé»KàŸ]^Y\ëòX⁄[ôŒà
äHOà»^Y\ëòX⁄[ô»Hé»KàŸ][[ŸNà
äHOà»[[ŸHHé»KàŸ]X›]ôU€€à
äHOà»X›]ôU€€Hé»KàŸ]\›X›[€ìY\‹ÿYŸNà
äHOà»\›X›[€ìY\‹ÿYŸHHé»KàŸ]ÿ[Y\òS[ŸNà

HOàX›]ôPÿ[Y\òS[ŸKàŸ]ÿ[Y\òS[ŸNà
äHOà»X›]ôPÿ[Y\òS[ŸHHé»KàŸ]ÿ[Y\òU\ôŸ]à

HOàX›]ôPÿ[Y\òU\ôŸ]àŸ]ÿ[Y\òU\ôŸ]à
äHOà»X›]ôPÿ[Y\òU\ôŸ]Hé»KàŸ]€€›⁄[ô—\éà
äHOà»€€›⁄[ô—\àHé»KàŸ]€€›⁄[ô’à
äHOà»€€›⁄[ô’Hé»KàŸ]›öZŸQö\ôYà
äHOà»›öZŸQö\ôYHé»KàŸ]ö\⁄õ›–X›]ôNà
äHOà»ö\⁄õ›–X›]ôHHé»KàJN¬Çà]€]\⁄X‘ô]êÿ[Y\òS[ŸHHù[¬à]€]\⁄X‘ô]êÿ[Y\òU\ôŸ]Hù[¬àÀ»ô\€€ô\»Hò[ô€HôX[\ôX€‹ô[ô»õ€››\Tìõ‹à⁄]]ô\à›\ôòXŸBàÀ»\»î»\»›\úô[ùH›[ô[ô»€à8†%ÿ[YH›\ôòXŸHô\€€][€ÇàÀ»›X⁄—õ€››\»\Ÿ\»õ‹àZ\àX›X[õ€›ò[»8†%\õôY[ù»[ÇàÀ»Xú€€]HTì€»]›[ÿY»€‹úôX›Húõ€H[ú⁄YHH\ôBàÀ»Z[öYÿ[YI‹»›€àYúò[YH
HYôô\ô[ùò\ŸH][ô\à\‹Ÿ]À€Z[öYÿ[Y\À KÇàÀ»\ŸY»⁄]ôH[à[XöY[ùî»\ôõ‹õX[òŸI‹»Y]õ€õ€YHHôX]]àÀ»X]⁄\»H‹õ›[ô^I‹ôHX›X[H^Z[ô»€à[ú›XYŸàBàÀ»Ÿ[ô\öX»€X⁄ÀÇàù[ò›[€àú—õ€››\ÿ[\U\õ
ú“Y
H¬à€€ú›ÿ[Ÿ\àHú’ÿ[Ÿ\úÀôö[ô
»OàÀúôXœÀöYOOHú“Y
N¬àYà
]ÿ[Ÿ\à]⁄[ô›Àê]Y[‘ﬁ\›[JHô]\õàù[¬à€€ú›ﬁHÿ[Ÿ\ãúõ€›ú‹⁄][€ãû
àSKﬁHHÿ[Ÿ\ãúõ€›ú‹⁄][€ãûà
àSN¬à€€ú›[HH⁄[ô›Àê]Y[‘ﬁ\›[Kôõ€››\[P]
ÿ[Ÿ\ãò\ôXKﬁﬁKú—‹öYõ‹ê\ôXJÿ[Ÿ\ãò\ôXJJN¬à€€ú››\ôòXŸRŸ^HH⁄[ô›Àê]Y[‘ﬁ\›[Kôõ€››\›\ôòXŸRŸ^Jÿ[Ÿ\ãò\ôXK[OÀù\Hœ»ù[
N¬à€€ú›\õ»H⁄[ô›Àê]Y[‘ﬁ\›[Kôÿ[YP]Y[–€€ôöY 
OÀôõ€››\œÀú›\ôòXŸ\œÀñ‹›\ôòXŸRŸ^WOÀù\õŒ¬àYà
]\õœÀõ[ô›
Hô]\õàù[¬à€€ú›\õH\õ÷”X]ôõ€‹äX]úò[ô€J
H
à\õÀõ[ô›
WN¬àûH»ô]\õàô]»Tì
\õÿ›[Y[ùòò\ŸUTíJKöôYé»Hÿ]⁄»ô]\õà\õ»BàBÇà⁄[ô›Àì]\⁄X”Z[öYÿ[YOÀö[ö]
¬àôYúô\⁄X›[€êò\ãàŸ]›\úô[ù\ôXNà

HOà›\úô[ù\ôXKà\›[ú›ù[Y[ù\ôõ‹õY\úÀàŸ]ú—õ€››\ÿ[\U\õàú—õ€››\ÿ[\U\õà⁄›’ÿ\›àÀ»úò[Y\»H\ôõ‹õX[òŸH[à\ô\\ú€€à
ŸYHHõ]\⁄X»àÿ[Y\òBàÀ»[ŸH[àÿ‹ò]⁄õ€ô\ÀX€€ôöYÀöú H[ú›XYŸàX]ö[ô»HYò][àÀ»ÿ[Y\òH[àXŸH8†%X]⁄\»›»ö\⁄[ôÀŸX[Ÿ›YHXX⁄Ÿ]Z\ÇàÀ»›€àúò[Z[ôÀà[àòX⁄›\[ŸHH\ôŸ]⁄]»]HZY⁄[ùàÀ»ô]ŸY[àH^Y\à[ô⁄X⁄]ô\àî»^Hõ⁄[ôY€»õ››^BàÀ»[à⁄›»[àXY‹€€»[ŸH]ù\›õ€›‹»H^Y\à\»\›X[ÇàôY⁄[ì]\⁄X–ÿ[Y\òNà
ú“Y
HOà¬à€]\⁄X‘ô]êÿ[Y\òS[ŸHHX›]ôPÿ[Y\òS[ŸN¬à€]\⁄X‘ô]êÿ[Y\òU\ôŸ]HX›]ôPÿ[Y\òU\ôŸ]¬àX›]ôPÿ[Y\òS[ŸHH	€]\⁄X…Œ¬à€€ú›ÿ[Ÿ\àHú“Y»ú’ÿ[Ÿ\úÀôö[ô
»OàÀúôXœÀöYOOHú“Y
Hàù[¬àYà
ÿ[Ÿ\èÀúõ€›
H¬à€€ú›ZYH
^Y\ãû»SH
»ÿ[Ÿ\ãúõ€›ú‹⁄][€ãû
H»é¬à€€ú›ZYàH
^Y\ãûH»SH
»ÿ[Ÿ\ãúõ€›ú‹⁄][€ãûäH»é¬àX›]ôPÿ[Y\òU\ôŸ]H»‹⁄][€éàô]»ëQKïôX›‹å ZYZYäHN¬àH[ŸH¬àX›]ôPÿ[Y\òU\ôŸ]Hù[¬àBàKà[ô]\⁄X–ÿ[Y\òNà

HOà¬àX›]ôPÿ[Y\òS[ŸHH€]\⁄X‘ô]êÿ[Y\òS[ŸHœ»	ŸYò][	Œ¬àX›]ôPÿ[Y\òU\ôŸ]H€]\⁄X‘ô]êÿ[Y\òU\ôŸ]œ»ù[¬à€]\⁄X‘ô]êÿ[Y\òS[ŸHHù[¬à€]\⁄X‘ô]êÿ[Y\òU\ôŸ]Hù[¬àKàÀ»ö]ô[àûHúÀ€]\⁄XÀ[Z[öYÿ[YKöú…‹»	‹€›[ôY[õ›I»ô[^Húõ€HZ]\ÇàÀ»H^Y\â‹»›ô\õ^HYúò[YH‹à[àî…‹»[XöY[ù\ôõ‹õX[òŸHYúò[YBàÀ»8†%ŸYH\]R[][R€\à
^Y\äH[ôH›][€ã]€€õÿ⁄¬àÀ»Xõ›ôH
î Hõ‹à⁄]X›X[H›€ú»XX⁄⁄]⁄›]KÇàöYŸŸ\î^Y\í›\úò^XU⁄]⁄à

HOà¬àYà
⁄[][T[ôOÀù\Ÿ\ë]Kö›\úò^XP\‹Ÿ[XõJHöYŸŸ\í›\úò^XU⁄]⁄
‹^Y\í›\úò^XU⁄]⁄⁄[][T[ôJN¬àKàöYŸŸ\ìú“›\úò^XU⁄]⁄à
ú“Y
HOà¬à€€ú›ÿ[Ÿ\àHú“Y»ú’ÿ[Ÿ\úÀôö[ô
»OàÀúôXœÀöYOOHú“Y
Hàù[¬àYà
ÿ[Ÿ\èÀú›][€ï€€Y\⁄Àù\Ÿ\ë]Kö›\úò^XP\‹Ÿ[XõJHöYŸŸ\í›\úò^XU⁄]⁄
ÿ[Ÿ\ãú›][€í›\úò^XU⁄]⁄ÿ[Ÿ\ãú›][€ï€€Y\⁄
N¬àKàJN¬Çà⁄[ô›Àêò[ô]€€Xò]Àö[ö]
¬àõôà€[\àXùY”ŸÀàSKàÀ»\ŸY€õHõ‹àHî⁄›»[ù\òX›[€àò^Xÿ\›àXùY»›ô\õ^I‹¬àÀ»XY]À]\ôŸ][ôH8†%Hò[ô]	‹»›€à€€Xò]RHZ[\»]ôX[àÀ»]õﬁŸ[€Y]ûH
Y[YPZ[T€€][€äKõ›\ÀÇàŸ]^Y\ëòXŸU\ôŸ]à

HOà¬à€€ú›‹»H⁄[ô›Àê‹ôX]\ôRXYÿX⁄KôŸ]XY€‹õ
^Y\ã	‹^Y\âÀ»à^Y\ãûNà^Y\ãûKY\⁄à^Y\ìY\⁄]ò]\ì[Ÿ[ZY⁄à^Y\ê]ò]\ì[Ÿ[ZY⁄JN¬àô]\õà»à‹ÀûNà‹Àûã€‹õNà‹Àù€‹õHN¬àKàVQTó‘êQUTÀàïST–êP“◊—Tó‘ÀàïST–êP“◊‘‘QQà‘’SW–íUW“”ì–“–êP“◊‘‘ÀàS‘“TW—QîÀà””‘“TW—QîÀàQSQW’—PT”ó‘“TW—QîÀàQUS—QîÀà””“USW—QîÀàëTëQ‘íT◊”QUS“—VTÀà‹òYùY€€][RŸ^KàY][Y”][\Y\ãà[XYŸT^Y\ãà[ê€€ôKà›Ÿ\[›ôKàÿ[ìÿÿ›\P]à[ô€QYôãà[›ôP‹ôX]\ôU›ÿ\ôà‹ôX]\ôPÿ[ë[ù\ï[Kà\–‹ôX]\ôT›⁄[[Z[ôÀàX⁄–‹ôX]\ôS[ôŸUòZ[àX⁄–‹ôX]\ôQõ€››\Àà‹›[SÿöôX›ÀàŸ]X›]ôTÿŸ[ôKàŸ]X›]ôQ‹öYàŸ]X›]ôP€€ÀàŸ]X›]ôTõ›‹Àà[T›\ôòXŸVR[ê\ôXKàXZŸP⁄\òX›\ë‹õ›[ô⁄Y›Àà‹ôX]\ôQ‹õ›[ô⁄Y›‘òYZKà⁄\òX›\ë‹õ›[ô⁄Y›‘›\ôòXŸSŸôúŸ]àX\ö‘ô‘[ôNà€X\ö‘ô‘[ôKàXZŸU€€[ôSY\⁄à’SW”ëUUêS‘‘—KàQòXŒà‹QòXÀàU€€X]Œà‹U€€X]ÀàP[ö[Nà‹P[ö[KàTõ€à‹Tõ€à\à›\à^\Œàﬁ^\Ààê^\Œàﬁê^\ÀàŸ]›\úô[ù\ôXNà

HOà›\úô[ù\ôXKàJN¬Çà⁄[ô›Àê‹ôX]\ôQŸ[ô]X‹œÀö[ö]
»€[\‘ëPUTëW—àJN¬Çà⁄[ô›Àê€€⁄⁄[ô‘ﬁ\›[OÀö[ö]
¬àUSW—QîÀà[ùô[ù‹ûR][\Àà[ùô[ù‹ûKà€[\[ùô[ù‹ûT›X⁄ÀàôYúô\⁄][Tÿ‹õ€àùZ[[ùô[ù‹ûQ‹öYàôYúô\⁄X›[€êò\ãà⁄›’ÿ\›àÿ]ôSY[Xô\ï€‹õ]Kàò[ô€NàõôàŸ][ù\òX›[€êõÿ⁄ŸY
õÿ⁄ŸY
H¬àY[ùS‹[àHõÿ⁄ŸY»À»\ŸY»ô]\ŸHHÿ[YI‹»^\›[ô»[›ô[Y[ùÿX›[€à[ú]ÿ]H⁄[HHŸ[ã[›€ôY€€⁄⁄[ô»[Ÿ[\»‹[ãÇàYà
õÿ⁄ŸY
H¬à^Y\ãùûH»^Y\ãùûHH»[ú]ûH»[ú]ûHH¬àÀ»ÿ[YHôX\€€ö[ô»\»‹[ìY[ùI‹»›€àÿ[à⁄]›]\ÀH^Y\ÇàÀ»[à⁄›[\ã\›\ôà[ŸHŸ]»õ»ö\⁄XõH›\ú€‹à][[ú⁄YBàÀ»\»[Ÿ[
⁄[ù\àÿ⁄»Y\»H‘»›\ú€‹à[ôŸY\¬àÀ»›ôX[Z[ô»ò]»[›ô[Y[ù÷H»ôYP€€ùZ[ô\àõ»X]\à⁄]	‹¬àÀ»ò]€à€à‹Ÿà]8†%ŸYHH[›\Ÿ[[›ôH›X\ôXõ›ôJKÇàô[X\ŸT⁄›[\î›\ôî⁄[ù\ìÿ⁄ 
N¬àBàKàJN¬Çà⁄[ô›Àî⁄⁄[ﬁ\›[OÀö[ö]
¬àò[ô€NàõôàŸ]õ€ŸYôôX››X⁄‹ŒàYôôX›Oà⁄[ô›Àê€€⁄⁄[ô‘ﬁ\›[OÀôŸ]õ€ŸYôôX››X⁄‹ YôôX›
Hàÿ]ôT⁄⁄[õŸ‹ô\‹Àà⁄›’ÿ\›àXùY”ŸÀà\—]ì[ŸNà

HOàõ€€X[ä⁄[ô›Àó◊“–ïSííW—Uó”S—JKàJN¬Çà⁄[ô›Àî\ö‘ﬁ\›[OÀö[ö]
»ÿ]ôT\ö‘õŸ‹ô\‹»JN¬Çà⁄[ô›Àê[⁄[^Tﬁ\›[OÀö[ö]
¬àUSW—QîÀà[ùô[ù‹ûKà€[\[ùô[ù‹ûT›X⁄ÀàôYúô\⁄][Tÿ‹õ€àùZ[[ùô[ù‹ûQ‹öYàôYúô\⁄X›[€êò\ãà⁄›’ÿ\›àÿ]ôSY[Xô\ï€‹õ]Kàò[ô€NàõôàŸ]^Y\éà

HOà^Y\ãàŸ]Ÿ[X›Y][RŸ^Nà

HOàŸ]X›]ôR[ùô[ù‹ûR][J
OÀöŸ^Hù[àŸ][ê€€Xò]à

HOà\‘^Y\í[ê€€Xò]

KàJN¬Çà⁄[ô›Àê[⁄[^Qõ\⁄‹œÀö[ö]
¬àëQKàSKà[ùô[ù‹ûKà€[\[ùô[ù‹ûT›X⁄ÀàŸ]^Y\éà

HOà^Y\ãàŸ]›\úô[ù\ôXNà

HOà›\úô[ù\ôXKàŸ]X›]ôTÿŸ[ôKàŸ]Z[P[ô€Nà

HOà€€ùõ€\ì€⁄–X›]ôH»€€ùõ€\ì€⁄–[ô€Hà[›\ŸS€⁄–X›]ôH»[›\ŸS€⁄–[ô€Hà\ôŸ]Z[P[ô€KàŸ]‹õ›[ôNà

HOà‹^Y\ë‹õ›[ôJ
H
»åçKàŸ]Ÿ[X›Y][RŸ^Nà

HOàŸ]X›]ôR[ùô[ù‹ûR][J
OÀöŸ^Hù[àŸ][€‹õ‹⁄][€éà

HOà¬à€€ú›‹⁄][€àHô]»ëQKïôX›‹å 
N»À»\ŸY»ô[X\ŸHHô[ô\ôYõ\⁄»úõ€HH^Y\â‹»[ôÇà[][R€\ãôŸ]€‹õ‹⁄][€ä‹⁄][€äN¬àô]\õà‹⁄][€é¬àKàŸ]‹\⁄[ù]Y\Œà
\ôXKKòY]\‘
HOà¬à€€ú›[ù]Y\»H‹^Y\ãããö‹›[SÿöôX›Àããò€€\[ö[€ìÿöôX›◊N»À»\ŸY»ô]Z[àŸ[ã\‹\⁄[ô^\›[ô»€€Xò][ù]Y\ÀÇàô]\õà[ù]Y\Àôö[\ä[ù]HOà[ù]H	âàY[ù]KóŸ[íY[à	âà
[ù]Kò\ôXRYOOH[ôYö[ôY»[ù]Kò\ôXRYOOH\ôXH	âàX]ö\›
[ù]KûH[ù]KûHHJHHòY]\‘à[ù]HOOH^Y\à	âà›\úô[ù\ôXHOOH\ôXH	âàX]ö\›
^Y\ãûH^Y\ãûHHJHHòY]\‘
JN¬àKà‹]€í[\X›ô\Ÿ[ù][€éà
»KòY]\’[\ÀYö[ö][€àJHOà¬à€€ú›€€‹àHYö[ö][€ãú\ùX€P€€‹úœÀñÃH	»ÕMYôéâŒ»À»\ŸY»ŸY\[\X›ô\Ÿ[ù][€àôX⁄\KX]]‹ôYÇà€€ú›ûH»\–€€ôNàùYKà»SKéàH»SKNà‹^Y\ë‹õ›[ôJ
H
»å[ô€Nà[ê€€ôTòYàX]îKò[ôŸU[\ŒàòY]\’[\ÀYŸNàX^YŸNàåÕ⁄ŒàùYK€€‹àN»À»\Ÿ\»Hÿ[YHõ›[ôYòYX[\\ùX€Hô[ô\ô\à\»€€Xò]—‹ôZã\›[Hù\ú›ÀÇàûú\ùX€\»HŸX\€ïòZ[\ùX€TŸYY û
N¬àŸX\€ïòZ[YôôX›Àú\⁄
û
N¬àKà›\ùõ›’⁄[ô\à

HOà»⁄[õ›–Z[UHN»Kà€€ôö\õUõ›–[ö[X][€éà

HOà»⁄[õ›–Z[UHé»Kàÿ[òŸ[õ›’⁄[ô\à

HOà»⁄[õ›–Z[UH»KàôYúô\⁄][Tÿ‹õ€àôYúô\⁄X›[€êò\ãàÿ]ôSY[Xô\ï€‹õ]KàJN¬Çà⁄[ô›Àî\úõ›][€èÀö[ö]
¬à[ô€QYôãàJN¬Çà⁄[ô›ÀëŸ[ô\ò[›‹ôOÀö[ö]
¬à[ùô[ù‹ûKà⁄›’ÿ\›àùZ[[ùô[ù‹ûQ‹öYàÿ]ôSY[Xô\ï€‹õ]KàŸ]Ÿ[ô\ò[›‹ôPÿ][ŸŒà

HOà—SëTêS‘’‘ëW––US—Àà€›⁄‹€‹õ›]Nà€€›⁄‹€‹õ›]KàŸ]›‹ôP€›[ô‘YXŸ\Œà

HOà’‘ëW–”’Së◊‘QP—TÀàŸ]Ÿ[ô\ò[›‹ôP€›[ô‘€›Œà

HOà—SëTêS‘’‘ëW–”’Së◊‘”’Ààÿ[[ô\ãà\ÿÀàŸ]X⁄–€›[ôŒà

HOàX⁄–€›[ôÀàùZ[X⁄–€›[ô‘ŸX›[€éà⁄[ô›Àë\]Z\Y[ù[ô[òùZ[X⁄–€›[ô‘ŸX›[€ãàŸYYYò[ô€Kà€›[ô‘‹ö]Qõ‹ê€‹€Y]XŒà⁄[ô›Àë\]Z\Y[ù[ô[ò€›[ô‘‹ö]Qõ‹ê€‹€Y]XÀàJN¬Çà⁄[ô›Àêÿ\ú[ù\î⁄‹Àö[ö]
¬à[ùô[ù‹ûKà⁄›’ÿ\›àùZ[[ùô[ù‹ûQ‹öYàÿ]ôSY[Xô\ï€‹õ]KàŸ]ò\õïY\úŒà

HOàêTìó’QTîÀàŸ]›\ŸTYXŸQYYŒà

HOàÿöôX›ôúõ€Q[ùöY\ ÿöôX›ô[ùöY\ ’T—W‘QP—W––US— Kôö[\ä
ÀYóJHOàYãôYY][JJKàïTìíUTëW–ìQTíSï––US—Àà€›⁄‹€‹õ›]Nà€€›⁄‹€‹õ›]Kà\ÿÀàJN¬ÇàÀ»ÿX⁄Hõ‹àHŸX]\ëñ\ÀôŸ]ù\õö]\ôSY⁄€›\òŸ\ 
Hÿ[ô[›»8†%àÀ»X€\ôY\ôH
ÿ[YKöú»ÿ€‹JHò]\à[à[ú⁄YHH\»ÿöôX›àÀ»]\ò[⁄[òŸH]ÿöôX›	‹»›€àY]Ÿ»€â›€‹ŸH›ô\àXX⁄àÀ»›\â‹»⁄Xõ[ô»Ÿ^\»Hÿ^HHZ[àÿÿ[ò\öXXõHŸ\ÀÇà]Ÿù\õö]\ôSY⁄ÿÿ[êÿX⁄HH»ÿŸ[ôNàù[ÿöúŒàù[\›ÿÿ[éàN¬Çà⁄[ô›ÀïŸX]\ëñÀö[ö]
¬àÿ[[ô\ãàŸYYYò[ô€KàŸ]‹öYà

HOà‹öYàì’‘À””Àà[U\Kà€[\à⁄›’ÿ\›àXùY”ŸÀà€‹õ”›ô\õ^Kàÿ[Y\òKà›à^Y\ãàú’ÿ[Ÿ\úÀàŸ]›\úô[ù\ôXNà

HOà›\úô[ù\ôXKàSKàŸ]Y⁄ö[ô–[Nà

HOàY⁄ö[ô–[KàŸ]Y⁄ö[ô–[Nà
äHOà»Y⁄ö[ô–[HHé»KàŸ]ÿŸ[ôUò[ú–[Nà

HOàÿŸ[ôUò[ú–[KàŸ]ôYTôX›à

HOà›ôYTôX›à⁄\–ùZ[[ô–\ôXKàŸ]X›]ôQ‹öYŸ]X›]ôP€€ÀŸ]X›]ôTõ›‹ÀàŸ]õ›⁄[ô’ô[ò⁄[\Œà

HOà⁄[ô›Àïÿ]\îﬁ\›[KôŸ]õ›⁄[ô’ô[ò⁄[\ 
KàŸ]›€ëõ›⁄[ô’ô[ò⁄[\Œà

HOà⁄[ô›Àïÿ]\îﬁ\›[KôŸ]›€ëõ›⁄[ô’ô[ò⁄[\ 
KàôYP€€ùZ[ô\ãàŸ]ÿ[Và

HOàÿ[VàŸ]ÿ[VNà

HOàÿ[VKàÀ»\ŸYûHŸX]\ëñ	‹»^Y\à[ù\õàX\⁄»»õ€›»H]ò]\â‹¬àÀ»€[€›Y€‹õ[]ò][€à[ú›XYŸàõ⁄ôX›[ô»úõ€Hõ]OLÇàŸ]^Y\ï€‹õNà

HOà^Y\ìY\⁄ú‹⁄][€ãûKàÀ»Y⁄[ô»\»ÿ[\Y]Lãù]Hù[ÿŸ[ôKùò]ô\úŸJ
H]ô\ûH€ôBàÀ»Ÿà‹ŸHX⁄‹»›[ö\⁄]»]ô\ûHõŸH[àHX›]ôHÿŸ[ôH
õ›àÀ»ù\›HY⁄ H»ö[ôH[ôù[YŸŸYù\õö]\ôSY⁄X\⁄»8†%àÀ»ôX[]õ⁄YXõH€‹›[àHX€‹ãY[úŸH\ôXH
H›Ÿàù\õö]\ôK¬àÀ»î‹À›\úòZ[à⁄[ö‹ÀKôÀàH[õäH⁄[òŸH]ÿÿ[\»⁄]›[àÀ»ÿŸ[ôH⁄^ôKõ›Y⁄€›[ùàôK\ÿÿ[õö[ô»\»›[⁄X\[ôàÀ»€‹úôX›ô\‹»X]\ú»[‹ôH[à⁄]ö[ô»€‹›ù\ù\ã€»\»€õBàÀ»õ›\»Hò]ô\úÿ[]Ÿ[à›€à»ú»
Y⁄
ú‹⁄][€ú à\ôBàÀ»ôK\ôXYúô\⁄úõ€H€‹õX]öXŸ\»]ô\ûHÿ[ôYÿ\ô\‹»8†%€õBàÀ»⁄X⁄ÿöôX›»€›[ù\»€›\òŸ\»\»ÿX⁄Y
Hò]\à[àûZ[ô»¬àÀ»òX⁄»ù\õö]\ôHY‹ô[[›ôH⁄]\»»[ùò[Y]H]ôX⁄\Ÿ[KÇàŸ]ù\õö]\ôSY⁄€›\òŸ\Œà

HOà¬à€€ú›ÿX⁄HHŸù\õö]\ôSY⁄ÿÿ[êÿX⁄N¬à€€ú›ÿŸ[ôHHŸ]X›]ôTÿŸ[ôJ
N¬à€€ú›õ›»H\ôõ‹õX[òŸKõõ› 
N¬àYà
ÿX⁄KúÿŸ[ôHOOHÿŸ[ôHõ›»HÿX⁄Kõ\›ÿÿ[àèHå
H¬à€€ú›ÿöú»H◊N¬àÿŸ[ôOÀùò]ô\úŸJÿöàOà»Yà
ÿöãö\‘⁄[ùY⁄	âàÿöãù\Ÿ\ë]OÀôù\õö]\ôSY⁄X\⁄ HÿöúÀú\⁄
ÿöäN»JN¬àÿX⁄KúÿŸ[ôHHÿŸ[ôN»ÿX⁄Kõÿöú»HÿöúŒ»ÿX⁄Kõ\›ÿÿ[àHõ›Œ¬àBà€€ú›€‹õ‹⁄][€àHô]»ëQKïôX›‹å 
N¬àô]\õà
ÿX⁄Kõÿöú»◊JKõX\
ÿöàOà¬àÿöãôŸ]€‹õ‹⁄][€ä€‹õ‹⁄][€äN¬àô]\õà¬àà€‹õ‹⁄][€ãûàNà€‹õ‹⁄][€ãûKàéà€‹õ‹⁄][€ãûãà\›[òŸNàÿöãô\›[òŸKà[ù[ú⁄]Nàÿöãö[ù[ú⁄]Kà€€‹éà¬àéàX]úõ›[ô
ÿöãò€€‹ãúà
àçMJKàŒàX]úõ›[ô
ÿöãò€€‹ãô»
àçMJKàéàX]úõ›[ô
ÿöãò€€‹ãòà
àçMJKàKàN¬àJN¬àKà\TŸX\€€ò[‹ò\‹–\X\ò[òŸKàêRSó‘UW—VTÀàJN¬Çà⁄[ô›ÀîòZ[î[ô\œÀö[ö]
¬àëQKàô[ô\ô\ãàÿ[Y\òKàÿ[[ô\ãà^Y\ãàSKàŸ]^Y\ë‹õ›[ôNà‹^Y\ë‹õ›[ôKàŸ]X›]ôTÿŸ[ôKàŸ]›\úô[ù\ôXNà

HOà›\úô[ù\ôXKà\”›]€‹ê\ôXNà

HOà›\úô[ù\ôXHOOH	Ÿò\õI»›\úô[ù\ôXHOOH	››€â»⁄\÷õ€ôP\ôXJ›\úô[ù\ôXJKàJN¬Çà⁄[ô›Àê€›Yõ‹ô\›õŸœÀö[ö]
¬àëQKà^Y\ãàSKàŸ]^Y\ë‹õ›[ôNà‹^Y\ë‹õ›[ôKàŸ]X›]ôTÿŸ[ôKà\–€›Yõ‹ô\›\ôXNà

HOà›\úô[ù\ôXHOOH	€X\‹€›]\õóÿ€›YŸõ‹ô\›	ÀàJN¬Çà⁄[ô›Àëò\õT[ô[Àö[ö]
¬àUëT’–“◊“USW““SëÀà[ùô[ù‹ûKà⁄›’ÿ\›àùZ[[ùô[ù‹ûQ‹öYàôYúô\⁄X›[€êò\ãà\—ò\õS›€ô\ãàŸ]ò\õSò[YKàŸ]ò\õSò[YKàŸ]ò\õS›€ô\ìò[YKà[U\Kà””Àì’‘ÀàŸ]‹öYà

HOà‹öYà\“›\ŸQõ€›ö[ùàõÿŸ\‹⁄[ô—ù\õö]\ôSÿöôX›Àà[ù\ö[‹ëù\õö]\ôSÿöôX›ÀàP”‘êUUëW—ïTìíUTëW—QîÀà€ÿY€‹õ]ô\›ÿ⁄Àà€‹õÿöôX›Àà[ö[X[ÿöôX›Àà\ÿÀà\—ò\õT\õZ\‹⁄[€ãàŸ]ò\õïY\úŒà

HOàêTìó’QTîÀàŸ]›\ŸTYXŸPÿ][ŸŒà

HOà’T—W‘QP—W––US—ÀàŸ]›\ŸTYXŸ\Œà

HOà›\ŸTYXŸ\ÀàXŸR›\ŸQYYà
YXŸRŸ^K€€õ› HOà⁄[ô›Àí›\ŸTYXŸ\ÀúXŸQYY
YXŸRŸ^K€€õ› KàùZ[›\ŸTYXŸNà
Y
HOà⁄[ô›Àí›\ŸTYXŸ\ÀòùZ[
Y
Kà[[€\⁄›\ŸTYXŸNà
Y
HOà⁄[ô›Àí›\ŸTYXŸ\Àô[[€\⁄
Y
Kà[›ôR›\ŸNà
€€õ› HOà⁄[ô›Àí›\ŸTYXŸ\Àõ[›ôR›\ŸJ€€õ› Kà[›ôTYXŸNà
YXŸRY€€õ› HOà⁄[ô›Àí›\ŸTYXŸ\Àõ[›ôTYXŸJYXŸRY€€õ› Kàÿ[ì[›ôTYXŸUŒà
YXŸRY€€õ› HOà⁄[ô›Àí›\ŸTYXŸ\Àòÿ[ì[›ôTYXŸU YXŸRY€€õ› Kàõ›]R›\ŸTYXŸNà
Y
HOà⁄[ô›Àí›\ŸTYXŸ\Àúõ›]TYXŸJY
Kàõ›]R›\ŸTõ€Ÿéà
Y
HOà⁄[ô›Àí›\ŸTYXŸ\Àúõ›]Tõ€Ÿê^\ Y
Kàÿ[îXŸR›\ŸQôX]\ôP]à
€€õ› HOà⁄[ô›Àí›\ŸTYXŸ\Àòÿ[îXŸQôX]\ôP]
€€õ› KàXŸR›\ŸQôX]\ôNà
€€õ›À€‹õ€‹õã\JHOà⁄[ô›Àí›\ŸTYXŸ\ÀúXŸQôX]\ôJ€€õ›À€‹õ€‹õã\JKàô[[›ôR›\ŸQôX]\ôP]à
€€õ› HOà⁄[ô›Àí›\ŸTYXŸ\Àúô[[›ôQôX]\ôP]
€€õ› KàŸ]›\ŸQö^\ôR[ùô[ù‹ûNà

HOà⁄[ô›Àí›\ŸTYXŸ\ÀôŸ]ö^\ôR[ùô[ù‹ûJ
Kà›\ŸTYXŸSXô[à
[ùûJHOà⁄[ô›Àí›\ŸTYXŸ\ÀõXô[
[ùûJKàÿŸ[ôKàŸ]ò\õPùZ[[ô‹Œà

HOàò\õPùZ[[ô‹Ààì–—T‘“Së◊—ïTìíUTëW—QîÀàQ“Së◊”QU—Ààÿ[[ô\ãàŸ]›XõNà

HOà›XõKà€ÿY€‹õúôYY[ô‘Z\úÀàÿ]ôSY[Xô\ï€‹õ]Kà‹ÿ]ôU€‹õúôYY[ô‘Z\úÀà‹ÿ]ôU€‹õ]ô\›ÿ⁄Àà€€\[ö[€êZU\Qõ‹í⁄[ôàÿ]]–\‹⁄Y€î›XõTõ€Kàÿ]ôT›XõKà››[€‹õYàYò][€‹õY[Xô\î›]Kà‹€€à€ÿY€‹õ›‹òYŸKà‹ÿ]ôU€‹õ›‹òYŸKàUSW—QîÀà]“][RŸ^Kà€[\[ùô[ù‹ûT›X⁄ÀàŸ]X›]ôS[›[ùYà

HOàX›]ôS[›[ùYàŸ]X›]ôS[›[ùYà
äHOà»X›]ôS[›[ùYHé»KàŸ]X›]ôT⁄›[\î]Yà

HOàX›]ôT⁄›[\î]YàŸ]X›]ôT⁄›[\î]Yà
äHOà»X›]ôT⁄›[\î]YHé»KàŸ]X›]ôP€€\[ö[€íYà

HOàX›]ôP€€\[ö[€íYàŸ]X›]ôP€€\[ö[€íYà
äHOà»X›]ôP€€\[ö[€íYHé»KàJN¬Çà⁄[ô›Àï\⁄‹‘[ô[Àö[ö]
¬àUSW—QîÀà\ÿÀà”PT÷ì”ëW”PëSÀàŸ]]Y\›õŸ‹ô\‹Œà

HOà]Y\›õŸ‹ô\‹Àà[ùô[ù‹ûKàJN¬Çà⁄[ô›Àî›\TYŸOÀö[ö]
¬à[ùô[ù‹ûKàŸ]›\PõﬁÿöôX›à

HOà›\PõﬁÿöôX›à’TW––US—Àà⁄›’ÿ\›àùZ[[ùô[ù‹ûQ‹öYàÿ]ôSY[Xô\ï€‹õ]KàŸ][ô[ô”‹ô\úŒà

HOà[ô[ô”‹ô\úÀàŸ][]ô\ûSŸŒà

HOà[]ô\ûSŸÀàJN¬Çà⁄[ô›Àë\]Z\Y[ù[ô[Àö[ö]
¬à[ùô[ù‹ûKà€[\[ùô[ù‹ûT›X⁄Àà\]Z\Y[ù€›Ààÿ]ôQ\]Z\Y[ù€›Àà””“USW—QîÀàŸ]ŸX\í[ùô[ù‹ûNà

HOàŸX\í[ùô[ù‹ûKàÿ]ôQŸX\í[ùô[ù‹ûKàŸ]X⁄–€›[ôŒà

HOàX⁄–€›[ôÀàŸ]X⁄–€›[ôŒà
\úäHOà»X⁄–€›[ô»H\úé»Kàÿ]ôSY[Xô\ï€‹õ]Kà⁄›’ÿ\›àôXùZ[€€Y\⁄\Àà€€Y\⁄X\à€€€\ãàŸ]X›]ôU€€à

HOàX›]ôU€€àôYúô\⁄X›[€êò\ãàŸ]X›]ôU€€à\—]ì[ŸNà

HOà◊Ÿ]ì[ŸKà€€X\›\ûS]ô[à]êù[\€€X\›\ûS]ô[àY][€€[Y‘‹òÀà\ÿÀàôYúô\⁄^Y\ê]ò]\ãàùZ[[ùô[ù‹ûQ‹öYà€X\í[ùô[ù‹ûQ]Z[à€X\í[ùîŸ[X›[€éà

HOà¬à[ùîŸ[X›YŸ^HHù[¬àÿ›[Y[ùú]Y\ûTŸ[X›‹ê[
	Àö[ùãZ][KXõﬁ	 Kôõ‹ëXX⁄
àOàãò€\‹”\›úô[[›ôJ	‹Ÿ[X›Y	 JN¬àKàŸ]X[ùX[[][Kà€X\ìX[ùX[[][KàŸ]X[ùX[[][KàJN¬ÇàÀ»î»⁄Yù[ô»
⁄[ô›Àìú—⁄Yù[ôÀŸYHúÀ€úÀY⁄Yù[ôÀöú H8†%ôXY¬àÀ»ôXX›[€ú»úõ€HXX⁄î…‹»⁄YùÀû€›ôYZŸY\€ZŸY]YHòZ]àÀ»\›Œ»€›[ô»XÿŸ\[òŸH‹X⁄YöXÿ[H\»ù\ù\àÿ]YûBàÀ»⁄[ô›Àìú’ÿ\ôõÿôH
úÀ€úÀ]ÿ\ôõÿôKöú K[ö]X[^ôYù\›ô[›ÀÇà⁄[ô›Àìú—⁄Yù[ôœÀö[ö]
¬àŸ]][QYúŒà

HOàUSW—QîÀàŸ][⁄Yù][Kà€X\ìX[ùX[[][KàŸ]ŸX\í[ùô[ù‹ûNà

HOàŸX\í[ùô[ù‹ûKàÿ]ôQŸX\í[ùô[ù‹ûKàŸ]X⁄–€›[ôŒà

HOàX⁄–€›[ôÀàŸ]X⁄–€›[ôŒà
\úäHOà»X⁄–€›[ô»H\úé»KàôYúô\⁄^Y\ê]ò]\ãà[ùô[ù‹ûKà€[\[ùô[ù‹ûT›X⁄Àà⁄›’ÿ\›àôYúô\⁄][Tÿ‹õ€àùZ[[ùô[ù‹ûQ‹öYàùZ[X⁄–€›[ô‘ŸX›[€éà

HOà⁄[ô›Àë\]Z\Y[ù[ô[ÀòùZ[X⁄–€›[ô‘ŸX›[€èÀä
KàùZ[\]Z\Y[ù€›Œà

HOà⁄[ô›Àë\]Z\Y[ù[ô[ÀòùZ[\]Z\Y[ù€›œÀä
KàôYúô\⁄X›[€êò\ãàÿ]ôSY[Xô\ï€‹õ]KàJN¬Çà⁄[ô›Àìú’ÿ\ôõÿôOÀö[ö]
¬àŸ]ŸX\í[ùô[ù‹ûNà

HOàŸX\í[ùô[ù‹ûKàÿ]ôQŸX\í[ùô[ù‹ûKà⁄›’ÿ\›àÿ]ôSY[Xô\ï€‹õ]Kàú’ÿ[Ÿ\úÀàJN¬Çà⁄[ô›Àï⁄\›Q\]Z\Àö[ö]
¬àŸ]\]Z\Y[ù€›à⁄[ô›Àë\]Z\Y[ù[ô[úŸ]\]Z\Y[ù€›àŸ]ŸX\í[ùô[ù‹ûNà

HOàŸX\í[ùô[ù‹ûKà‘ëPUTëW—ãà\]Z\Y[ù€›ÀàJN¬Çà⁄[ô›Àï⁄[YôQXùY‘[ô[Àö[ö]
¬à\ÿÀàﬁõ€ôS^[›]Àà‹›[SÿöôX›ÀàŸ]›\úô[ù\ôXNà

HOà›\úô[ù\ôXKà⁄\÷õ€ôP\ôXKàJN¬Çà⁄[ô›Àï⁄[YôPôZ]ö[‹ìX\Àö[ö]
¬àSKà[U\Kà^Y\ãà‹›[SÿöôX›Ààõ€ôS^[›]Œàﬁõ€ôS^[›]ÀàŸ]›\úô[ù\ôXNà

HOà›\úô[ù\ôXKà⁄\÷õ€ôP\ôXKàJN¬Çà⁄[ô›Àî⁄\[ô‘[ô[Àö[ö]
¬à[ùô[ù‹ûKàUSW—QîÀàêT—W‘íP—TÀàŸ]⁄\[ô–õﬁÿöôX›à

HOà⁄\[ô–õﬁÿöôX›à⁄›’ÿ\›à\—ò\õT\õZ\‹⁄[€ãà€[\[ùô[ù‹ûT›X⁄ÀàùZ[[ùô[ù‹ûQ‹öYàôYúô\⁄][Tÿ‹õ€àôYúô\⁄X›[€êò\ãàÿ]ôSY[Xô\ï€‹õ]KàJN¬Çà⁄[ô›Àê‹òYù[ô‘[ô[Àö[ö]
¬à[ùô[ù‹ûKà€[\[ùô[ù‹ûT›X⁄ÀàïTìíUTëW–ìQTíSï––US—Àà⁄›’ÿ\›àùZ[[ùô[ù‹ûQ‹öYàÿ]ôSY[Xô\ï€‹õ]Kà\ÿÀàJN¬Çà⁄[ô›Àë]î‹]€ô\èÀö[ö]
¬àŸ]›\úô[ù\ôXNà

HOà›\úô[ù\ôXKàŸ]›\úô[ù\ôXNà
äHOà»›\úô[ù\ôXHHé»KàŸ]X›]ôTÿŸ[ôKà^Y\ìY\⁄^Y\ë‹õ›[ô⁄Y›À€€€\ãô]X€SY\⁄ô]X€P⁄\ò€SY\⁄ô]X€Tö[ô”Y\⁄ô]X€Uÿ]ûQ‹õ›\à⁄\–ùZ[[ô–\ôXKàŸ]›\úô[ùùZ[[ô”X\Yà
äHOà»ÿ›\úô[ùùZ[[ô”X\YHé»Kà›\ùÿŸ[ôUò[ú⁄][€ãà^Y\ãà‹€ò\ÿ[Y\òU\ôŸ]àôYúô\⁄X›[€êò\ãà⁄›’ÿ\›à€‹ŸSY[ùKàVTíS‘ó÷ì”ëTÀàùZ[›€îÿŸ[ôKàùZ[õ€ôTÿŸ[ôKà””Àì’‘ÀSKà‘ëPUTëW—ãà\ÿÀà€[\àXZŸP‹ôX]\ôQ[ù]Kà‹›[SÿöôX›À€€\[ö[€ìÿöôX›Àà[XYŸP‹ôX]\ôKàŸ]X›]ôQ‹öYà[T›\ôòXŸVR[ê\ôXKàX\ö”›][ôNà€X\ö”›][ôKàõ€ôTÿŸ[ô\Œàﬁõ€ôTÿŸ[ô\ÀàôYQòYPX›]ôNà›ôYQòYPX›]ôKà\—ò\õS›€ô\ãàŸ]ò\õQY][ŸNà

HOàò\õQY][ŸKàŸŸ€Qò\õQY][ŸKàŸ]XùY’ŸX]\éà⁄[ô›ÀïŸX]\ëñúŸ]XùY’ŸX]\ãàŸ]XùY’ŸX]\éà⁄[ô›ÀïŸX]\ëñôŸ]XùY’ŸX]\ãàŸ]òZ[î[ôTŸ][ô‹Œà⁄[ô›ÀîòZ[î[ô\ÀôŸ]Ÿ][ô‹ÀàŸ]òZ[î[ôTŸ][ô‹Œà⁄[ô›ÀîòZ[î[ô\ÀúŸ]Ÿ][ô‹Àà\—]ì[ŸNà

HOà◊Ÿ]ì[ŸKàJN¬Çà⁄[ô›Àëù\õö]\ôTXŸ\èÀö[ö]
¬àŸ]›\úô[ù\ôXNà

HOà›\úô[ù\ôXKàŸ]X€‹ò]]ôQù\õö]\ôQYúŒà

HOàP”‘êUUëW—ïTìíUTëW—QîÀàŸ]õÿŸ\‹⁄[ô—ù\õö]\ôQYúŒà

HOàì–—T‘“Së◊—ïTìíUTëW—QîÀà[ùô[ù‹ûKà\—ò\õT\õZ\‹⁄[€ãà\õQù\õö]\ôTXŸ[Y[ùàŸ]\õYYù\õö]\ôTXŸ[Y[ùŸ^Kà\õQù\õö]\ôS[›ôKàŸ]\õYYù\õö]\ôS[›ôRYàŸ]XŸYù\õö]\ôNà

HOà¬àããö[ù\ö[‹ëù\õö]\ôSÿöôX›Àôö[\ä»OàÀò\ôXHOOH›\úô[ù\ôXJKõX\
»Oà
»ããõÀXŸ[Y[ù⁄[ôà	ŸX€‹ò]]ôI»JJKàããä›\úô[ù\ôXHOOH	Ÿò\õI»»ÀããúõÿŸ\‹⁄[ô—ù\õö]\ôSÿöôX›◊KõX\
»Oà
»ããõÀŸ^NàÀôù\õö]\ôRŸ^K\ôXNà	Ÿò\õIÀXŸ[Y[ù⁄[ôà	‹õÿŸ\‹⁄[ô…»JJHà◊JKàKàô[[›ôQù\õö]\ôNàYOàõÿŸ\‹⁄[ô—ù\õö]\ôPûRY
Y
H»ô[[›ôTõÿŸ\‹⁄[ô—ù\õö]\ôJY
Hàô[[›ôQX€‹ò]]ôQù\õö]\ôJY
Kàõ›]Qù\õö]\ôNà
YY‹ôY\ HOàõÿŸ\‹⁄[ô—ù\õö]\ôPûRY
Y
H»õ›]TõÿŸ\‹⁄[ô—ù\õö]\ôJYY‹ôY\ Hàõ›]QX€‹ò]]ôQù\õö]\ôJYY‹ôY\ Kà⁄›’ÿ\›à\ÿÀà\‘]\ŸYà

HOà]\ŸYà\—]ì[ŸNà

HOà◊Ÿ]ì[ŸKàJN¬Çà⁄[ô›Àï⁄[\õô\‹–ÿ[\ö\ôOÀö[ö]
¬àŸ]›\úô[ù\ôXNà

HOà›\úô[ù\ôXKà\÷õ€ôP\ôXNà⁄\÷õ€ôP\ôXKàŸ]X›]ôTÿŸ[ôKàŸ]^Y\éà

HOà^Y\ãàŸ]òX⁄[ô–[ô€Nà

HOàòX⁄[ô–[ô€Kà›\ôòXŸVP]àX›]ôT›\ôòXŸVP]€‹õàSKà]]‹ôYù\õö]\ôNà⁄[ô›Àê]]‹ôYù\õö]\ôKà\ú⁄\›àÿ]ôSY[Xô\ï€‹õ]Kà⁄›’ÿ\›à‹[ìY[ùKà\‘]\ŸYà

HOà]\ŸYà[ùô[ù‹ûKà€[\[ùô[ù‹ûT›X⁄ÀàùZ[[ùô[ù‹ûQ‹öYàôYúô\⁄][Tÿ‹õ€àJN¬Çà⁄[ô›Àï›€ñõ€ôPùZ[[ô‹œÀö[ö]
¬àŸ]›€ñõ€ôNà

HOà››€ñõ€ôKàXùY”ŸÀàŸ]›€îÿŸ[ôNà

HOà›€îÿŸ[ôKàŸ]›€êùZ[[ô—YúŒà

HOà››€êùZ[[ô—YúÀàŸ]›€êùZ[[ô—‹õ›\Œà

HOà››€êùZ[[ô—‹õ›\ÀàŸ]›€êùZ[[ô—‹õ›\Œà
äHOà»››€êùZ[[ô—‹õ›\»Hé»KàŸ]€‹õ›€ïò[ú⁄][€úŒà

HOà€‹õ›€ïò[ú⁄][€úÀàŸ]›€ë‹öYà

HOà›€ë‹öYà›\ŸUÿ[ùZ[\ãàSïTíS‘ó–””ÀàSïTíS‘ó‘ì’‘Àà[T›\ôòXŸVKà[U\Kàõ€ôS^[›]Œàﬁõ€ôS^[›]Ààõ€ôPùZ[[ô—‹õ›\Œàﬁõ€ôPùZ[[ô—‹õ›\Ààõ€ôPùZ[[ô‹—€ï\‹òYT[ô[ôŒàﬁõ€ôPùZ[[ô‹—€ï\‹òYT[ô[ôÀàõ€ôTÿŸ[ô\Œàﬁõ€ôTÿŸ[ô\Ààõ€ôQX€‹ëù\õö]\ôQ‹õ›\Œàﬁõ€ôQX€‹ëù\õö]\ôQ‹õ›\ÀàXZŸQX€‹ò]]ôQù\õö]\ôSY\⁄àì–—T‘“Së◊—ïTìíUTëW—QîÀàùZ[ù\õö]\ôUö\›X[àX\ö”›][ôNà€X\ö”›][ôKàX\ö—ù\õö]\ôQYŸRYà€X\ö—ù\õö]\ôQYŸRYàì‘ìPS’‘àUPUW’SíUàJN¬Çà⁄[ô›Àëõ€XYŸQù\õö]\ôTù[ù[YOÀö[ö]
¬àõ€ôS^[›]Œàﬁõ€ôS^[›]Ààõ€ôTÿŸ[ô\Œàﬁõ€ôTÿŸ[ô\Ààõ€ôQX€‹ëù\õö]\ôQ‹õ›\Œàﬁõ€ôQX€‹ëù\õö]\ôQ‹õ›\ÀàX\ö”›][ôNà€X\ö”›][ôKàX\ö—ù\õö]\ôQYŸRYà€X\ö—ù\õö]\ôQYŸRYàì‘ìPS’‘àUPUW’SíUà⁄]àôY⁄[î⁄][ù\òX›[€ãàXùY”ŸÀàJN¬Çà⁄[ô›Àï⁄[YôT‹]€èÀö[ö]
¬àSKà[U\Kàõôà⁄\÷õ€ôP\ôXKàŸ]›\úô[ù\ôXNà

HOà›\úô[ù\ôXKàò[ô€Nàõôàõ€ù\÷ZY[⁄[òŸNà⁄⁄[Oà⁄[ô›Àî⁄⁄[ﬁ\›[OÀòõ€ù\÷ZY[⁄[òŸOÀä⁄⁄[
Hà]ÿ\ôõ‹òY⁄[ô÷à

HOà⁄[ô›Àî⁄⁄[ﬁ\›[OÀò]ÿ\ôÀä	Ÿõ‹òY⁄[ô…À⁄[ô›Àî⁄⁄[ﬁ\›[OÀñ—–RSîœÀôõ‹òYŸH	‹X⁄ŸY\òâ Kà‹›[SÿöôX›ÀàVTíS‘ó÷ì”ëTÀà[XYŸP‹ôX]\ôKà‘’SW–íUW“”ì–“–êP“◊‘‘Ààõ€ôS^[›]Œàﬁõ€ôS^[›]ÀàXZŸP‹ôX]\ôQ[ù]Kà‘ëPUTëW—ãà⁄›’ÿ\›àùZ[[ô‘ÿŸ[ô\ŒàÿùZ[[ô‘ÿŸ[ô\Àà[ìô\›ŒàŸ[ìô\›ÀàŸ]›]ÿŸ[ôTô]öY]–X›]ôNà

HOà›]ÿŸ[ôTô]öY]–X›]ôKàùZ[õ€ôTÿŸ[ôKàSó”S’Tó—QîÀàSó”S’Tó“USW“—VTÀàõ€ôTÿŸ[ô\Œàﬁõ€ôTÿŸ[ô\ÀàXZŸQX€‹ò]]ôQù\õö]\ôSY\⁄àÀ»\ŸYûHúÀ›⁄[YôKX€›YYõ‹ô\›XôZ]ö[‹ãöú»õ‹à]»ÿ\ã]€€ÇàÀ»⁄Yù”—^Y\ãY\›[òŸH⁄X⁄‹»[ô]»ÿ[YKZ›\ã\ÿ⁄Y[YàÀ»úùZ]ô\‹]€ãŸX][ô»[Y\ú»8†%õ»›\à⁄[YôT‹]€à€€ú›[Y\ÇàÀ»ôYY»Z]\àŸ^KÇà^Y\ãàÿ[[ô\ãàJN¬Çà⁄[ô›Àêÿ]ô\õëŸ[ô\ò]‹èÀö[ö]
¬àVTíS‘ó÷ì”ëTÀàSó”S’Tó—QîÀàJN¬Çà⁄[ô›Àñõ€ôT]X]SY\ÿOÀö[ö]
¬àì‘ìPS’‘UPUW’SíU[U\K–TïëQ’SW’TTÀàô\€€ôU[SX]\‹XŸVõ€ôQŸ[€Y]ûKàJN¬Çà⁄[ô›Àñõ€ôU\úòZ[ëôX]\ô\œÀö[ö]
¬à[U\Kì‘ìPS’‘UPUW’SíUíUëTó’‘à\‹XŸVõ€ôQŸ[€Y]ûKô\€€ôU[SX]àX\ö’\úòZ[ëYŸRYà€X\ö’\úòZ[ëYŸRYà\úòZ[êÿ]Y€‹ûQõ‹éà›\úòZ[êÿ]Y€‹ûQõ‹ãàÿ]\ïô\ù⁄Y\ãÿ]\ëúòY‘⁄Y\ãàùZ[Y\ôŸYÿ]\ìY\⁄à⁄[ô›Àïÿ]\îﬁ\›[KòùZ[Y\ôŸYÿ]\ìY\⁄àJN¬Çà⁄[ô›Àñõ€ôQ[ï›[QôX]\ô\œÀö[ö]
¬àì‘ìPS’‘UPUW’SíU[U\Kì–“◊”S’Së–—S◊‘Tó’SKàX\ö’\úòZ[ëYŸRYà€X\ö’\úòZ[ëYŸRYà\úòZ[êÿ]Y€‹ûQõ‹éà›\úòZ[êÿ]Y€‹ûQõ‹ãàJN¬Çà⁄[ô›Àñõ€ôQ‹ò\‹–ö[õÿ\ôœÀö[ö]
¬à[U\KUPUW’SíUà‹ò\‹–õYQŸ[ŒàŸ‹ò\‹–õYQŸ[ÀàŸ]‹ò\‹–ö[õÿ\ôX]à

HOà‹ò\‹–ö[õÿ\ôX]àŸ]‹ò\‹—[òXõYà

HOà◊Ÿ‹ò\‹Ààö[ö[õÿ\ô[ú›[òŸ\ŒàŸö[ö[õÿ\ô[ú›[òŸ\ÀàXîõôŒà€XîõôÀà[T›\ôòXŸVKàJN¬Çà⁄[ô›ÀìY][‹òYù⁄‹Àö[ö]
¬à[ùô[ù‹ûKà⁄›’ÿ\›à€[\[ùô[ù‹ûT›X⁄ÀàùZ[[ùô[ù‹ûQ‹öYàùZ[\]Z\Y[ù€›Œà⁄[ô›Àë\]Z\Y[ù[ô[òùZ[\]Z\Y[ù€›Ààÿ]ôSY[Xô\ï€‹õ]Kà\ÿÀàŸ]ŸX\í[ùô[ù‹ûNà

HOàŸX\í[ùô[ù‹ûKàÿ]ôQŸX\í[ùô[ù‹ûKàY][ò\í][RŸ^Kà‹òYùY€€][RŸ^Kà€€][ôÀà€X\ï€€][ôÀàŸ]€€][ôÀà€€ôZ[ôõ‹òŸ[Y[ùY][àŸ]€€ôZ[ôõ‹òŸ[Y[ùà€€YôôX›]ôSY][Ÿ^Kà€€ô\ôY‹ö\—úòX›[€ãà€€X\›\ûS]ô[àôYúô\⁄Y][€€€‹õ^\ôKàQUS—QîÀà””“USW—QîÀàëTëQ‘íT◊”QUS“—VTÀàSì–“—Q’””‘“TTÀà””‘“TW—QîŒàS‘“TW—QîÀÀ»YÿXﬁH\[ô[òﬁHò[YHô]Z[ôYõ‹àH€Z][ô»[Ÿ[KÇàQSQW’—PT”ó‘“TW—QîÀàJN¬Çà⁄[ô›Àï⁄[\õô\‹”X\Àö[ö]
¬àﬁõ€ôS^[›]Àà›[€‹õYà››[€‹õYà›\úô[ù›[YX\ãà⁄›’ÿ\›à⁄\÷õ€ôP\ôXKàŸ]›\úô[ù\ôXNà

HOà›\úô[ù\ôXKà^Y\ãàSKàú’ÿ[Ÿ\úÀà”PT÷ì”ëW”PëSÀàJN¬Çà⁄[ô›Àï⁄[\õô\‹–⁄[ö‹œÀö[ö]
¬àŸ]›\úô[ù\ôXNà

HOà›\úô[ù\ôXKà\÷õ€ôP\ôXNà⁄\÷õ€ôP\ôXKà^Y\ãàSKàJN¬Çà⁄[ô›Àê€[Xîﬁ\›[OÀö[ö]
¬à⁄\÷õ€ôP\ôXKàŸ]›\úô[ù\ôXNà

HOà›\úô[ù\ôXKà^Y\ãà‹›[SÿöôX›Àà€€\[ö[€ìÿöôX›ÀàòX⁄[ô–ÿ\ô[ò[àŸ]X›]ôQ‹öYàŸ]X›]ôP€€ÀàŸ]X›]ôTõ›‹ÀàSKà\‘€€Yà[T›\ôòXŸVR[ê\ôXKà€[\àŸ][›[ùöYT›]Nà

HOà⁄[ô›Àì[›[ùœÀúöYT›]Hœ»	€õ€ôIÀà⁄›’ÿ\›àŸ]òX⁄[ô–[ô€Nà
äHOà»òX⁄[ô–[ô€HHé»KàŸ]\ôŸ]Z[P[ô€Nà
äHOà»\ôŸ]Z[P[ô€HHé»KàŸ]\›[›ôP[ô€Nà
äHOà»\›[›ôP[ô€HHé»KàŸ]^Y\êZ[Tò^Nà›\úô[ù^Y\êZ[Tò^KàŸ]^Y\í[ù\òX›[€îò^Nà›\úô[ù^Y\í[ù\òX›[€îò^Kà€‹õ›\ôòXŸVNà
JHOàX›]ôT›\ôòXŸVP]€‹õ
»SKH»SJKàÀ»ôXYúô\⁄[ú]ôXÿ]\ŸH^Y\ãö[ú]÷H\ôH‹ö][àYù\àBàÀ»€ãXúò[ò⁄X\õHô]\õãà⁄›[\àÿ[H\Ÿ\»H^X›ÿ[YBàÀ»ÿ[Y\òK\ô[]]ôHò[úŸõ‹õH\»‹ô[ò\ûH‹õ›[ô[›ô[Y[ùÇàŸ][›ô[Y[ù[ú]à

HOà¬à€€ú›ÿàHŸ]Ÿ^Xõÿ\ôôX›‹ä
N¬à€€ú›[›ôHHÿãòX›]ôH»»àÿãûNàÿãûHHà»à[ú]ûNà[ú]ûHN¬àYà
X›]ôPÿ[Y\òS[ŸHOOH“’STó‘’Tëó”S—H
[[›ôKû	âà[[›ôKûJJHô]\õà[›ôN¬à€€ú›Z[HHÿ[Y\òQòX⁄[ô–[ô€TòY

N¬à€€ú›⁄[àHX]ú⁄[äZ[JK€‹»HX]ò€‹ Z[JN¬àô]\õà¬àà[[›ôKû
à⁄[àH[›ôKûH
à€‹ÀàNà[›ôKû
à€‹»H[›ôKûH
à⁄[ãàN¬àKàJN¬Çà⁄[ô›Àêò[ô]€€Xò]ŸœÀö[ö]
¬à^Y\ãà€€\[ö[€ìÿöôX›Àà\ô[òT‹]€ôY‹ôX]\ô\Œà⁄[ô›Àë]î‹]€ô\ãôŸ]\ô[òT‹]€ôY‹ôX]\ô\ 
KàŸ]›\úô[ù\ôXNà

HOà›\úô[ù\ôXKàŸ]]ë€ÿò[‹YY][à

HOà]ë€ÿò[‹YY][àUó–TëSêW÷ì”ëW“Qà⁄[ô›Àë]î‹]€ô\ãëUó–TëSêW÷ì”ëW“QàSKà[ô€QYôãà⁄›’ÿ\›àJN¬Çà⁄[ô›ÀëXùY“]õﬁ\œÀö[ö]
¬àŸ]X›]ôU[P]à[T›\ôòXŸVKà›\ôòXŸVP]€‹õàX›]ôT›\ôòXŸVP]€‹õà€‹õ”›ô\õ^Kàÿ›àSKà^Y\ãà‹›[SÿöôX›Àà€€\[ö[€ìÿöôX›Ààú’ÿ[Ÿ\úÀà[ö[X[ÿöôX›ÀàŸ]›\úô[ù\ôXNà

HOà›\úô[ù\ôXKàŸ]⁄›“]õﬁ\Œà

HOà◊‹⁄›“]õﬁ\ÀàŸ]⁄›“[ù\òX›[€îò^Xÿ\›à

HOà◊‹⁄›“[ù\òX›[€îò^Xÿ\›àŸ]^Y\êZ[Tò^Nà›\úô[ù^Y\êZ[Tò^KàŸ]^Y\í[ù\òX›[€îò^Nà›\úô[ù^Y\í[ù\òX›[€îò^KàôYúô\⁄[ù\òX›[€ëõÿ›\—XùYÀà‹ôX]\ôR]õﬁ[î⁄^ôTàJN¬Çà⁄[ô›Àîô[][€ú⁄\‘[ô[Àö[ö]
¬àú’ÿ[Ÿ\úÀà\ÿÀàJN¬Çà⁄[ô›Àêÿ[[ô\îﬁ\›[OÀö[ö]
¬àS‘ìíSë◊“’TãàíQ““’Tãàÿ[[ô\ãàÿ[Ÿ^Kàÿ[[€ù]Kàÿ[ô]ì[€ùàÿ[ô^[€ùàÿ[ŸYZ‹ÀàJN¬Çà⁄[ô›ÀíùXõZ\î⁄‹Àö[ö]
¬à›[€‹õYà››[€‹õYàŸ]⁄‹›ÿ⁄Œà

HOà‹⁄‹›ÿ⁄Àà€›⁄‹€‹õ›]Nà€€›⁄‹€‹õ›]Kàÿ[[ô\ãà[ùô[ù‹ûKà⁄›’ÿ\›à\ÿÀàùZ[[ùô[ù‹ûQ‹öYàÿ]ôSY[Xô\ï€‹õ]KàJN¬Çà⁄[ô›ÀëYTﬁ\›[OÀö[ö]
¬àŸ]ŸX\í[ùô[ù‹ûNà

HOàŸX\í[ùô[ù‹ûKàÿ]ôQŸX\í[ùô[ù‹ûKàJN¬Çà⁄[ô›ÀîôXYŸ[ù[ùœÀö[ö]
¬àÿ[[ô\ãà[ùô[ù‹ûKàXùY”ŸÀàôYúô\⁄][Tÿ‹õ€à[T›\ôòXŸVR[ê\ôXKàì‘ìPS’‘à€XîõôÀà‹ŸYYúõ€T›ö[ôÀàö[ôõ€ôQõ][\U[\ÀàŸ]ôXYŸ[ù[ùX]\öX[àŸ‹ò\‹–õYQŸ[Ààﬁõ€ôTÿŸ[ô\Ààﬁõ€ôTôXYŸ[ùÿöôX›Ààﬁõ€ôTôXYŸ[ùY\⁄‹õ›\Ààﬁõ€ôTôXYŸ[ù\ú⁄\›à⁄\÷õ€ôP\ôXKàŸ]›\úô[ù\ôXNà

HOà›\úô[ù\ôXKàJN¬Çà⁄[ô›Àë]’ò]œÀö[ö]
¬à””Ààì’‘Àà[U\KàUSW—QîÀà[ùô[ù‹ûKàõÿŸ\‹⁄[ô—ù\õö]\ôSÿöôX›Ààì–—T‘“Së◊—ïTìíUTëW—QîÀàì–—T‘“Së◊‘—ñ“—VKàŸ]‹öYà

HOà‹öYàõ€][T›\úÀà›\îò][ô’^àôX€‹ô][T]X[]Nà
ããò\ô‹ HOà⁄[ô›Àê€€⁄⁄[ô‘ﬁ\›[OÀúôX€‹ô][T]X[]OÀäããò\ô‹ Kà]ÿ\ôò\õZ[ô÷à

HOà⁄[ô›Àî⁄⁄[ﬁ\›[OÀò]ÿ\ôÀä	Ÿò\õZ[ô…À⁄[ô›Àî⁄⁄[ﬁ\›[OÀñ—–RSîœÀò[ö[X[€€ŸK	ÿ€€X›Y[ö[X[€€Ÿ	 KàŸ]ÿŸ[ôNàŸ]X›]ôTÿŸ[ôKàŸ]€‹õÿöôX›]à\“›\ŸQõ€›ö[ùà[T›\ôòXŸVKà‹ôX]\ôT[ôQ‹õ›[ôŸôúŸ]àôX\ô\›[ô€P[[€ôÀàÿ[Y\òTô[]]ôT\úÀà\ú€[\à⁄[ô›Àî\úõ›][€ãú\ú€[\à[ô€QYôãà]“][RŸ^Kà[ú›\ôTõÿŸ\‹ŸY][QYãàŸ]õÿŸ\‹⁄[ô”›]]Àà\—ò\õT\õZ\‹⁄[€ãàÿY€‹õ]ô\›ÿ⁄Œà€ÿY€‹õ]ô\›ÿ⁄Ààÿ]ôU€‹õ]ô\›ÿ⁄Œà‹ÿ]ôU€‹õ]ô\›ÿ⁄Ààÿ]ôQò\õS^[›]àõôàJN¬Çà⁄[ô›Àï⁄[ô\úöY\œÀö[ö]
¬àëTîñW–””‘îÀàUSW—QîÀàì‘ìPS’‘à‹õ‹]Kà[ùô[ù‹ûKàŸ‹ò\‹–õYQŸ[Ààﬁõ€ôTÿŸ[ô\Ààﬁõ€ôPô\úûSY\⁄‹õ›\Ààﬁõ€ôPô\úûSÿöôX›Ààﬁõ€ôPô\úûT\ú⁄\›àﬁõ€ôTôXYŸ[ù\ú⁄\›àÿ[[ô\ãàXùY”ŸÀàŸ]›\úô[ù\ôXNà

HOà›\úô[ù\ôXKà\÷õ€ôP\ôXNà⁄\÷õ€ôP\ôXKà€XîõôÀà‹ŸYYúõ€T›ö[ôÀàö[ôõ€ôQõ][\U[\ÀàŸ]ôXYŸ[ù[ùX]\öX[àôYúô\⁄][Tÿ‹õ€à[T›\ôòXŸVR[ê\ôXKàJN¬Çà⁄[ô›Àï⁄[ôX\›\ôOÀö[ö]
¬àÿ[[ô\ãàõôàëTëQ‘íT◊”QUS“—VTÀàŸ]€›€€Œà

HOà€€›€€Àà€›⁄‹€‹õ›]Nà€€›⁄‹€‹õ›]KàVT’TñW—QW“USW“—VW–ñW‘””àŸ]›‹ôP€›[ô‘YXŸ\Œà

HOà’‘ëW–”’Së◊‘QP—TÀà€›[ô‘‹ö]Qõ‹ê€‹€Y]XŒà⁄[ô›Àë\]Z\Y[ù[ô[ò€›[ô‘‹ö]Qõ‹ê€‹€Y]XÀàﬁõ€ôTÿŸ[ô\Àà€XîõôÀà‹ŸYYúõ€T›ö[ôÀàﬁõ€ôTôXYŸ[ù\ú⁄\›àﬁõ€ôPô\úûT\ú⁄\›àö[ôõ€ôQõ][\U[\ÀàUPUW’SíUàì‘ìPS’‘àëSê“’‘à[U\KàY][ò\í][RŸ^Kà[ùô[ù‹ûKàUSW—QîÀàQUS—QîÀàŸ]X⁄–€›[ôŒà

HOàX⁄–€›[ôÀàﬁõ€ôUôX\›\ôSY\⁄‹õ›\Ààﬁõ€ôUôX\›\ôSÿöôX›Ààﬁõ€ôUôX\›\ôT\ú⁄\›àôYúô\⁄][Tÿ‹õ€àùZ[[ùô[ù‹ûQ‹öYàùZ[X⁄–€›[ô‘ŸX›[€éà⁄[ô›Àë\]Z\Y[ù[ô[òùZ[X⁄–€›[ô‘ŸX›[€ãàXùY”ŸÀà\÷õ€ôP\ôXNà⁄\÷õ€ôP\ôXKàŸ]›\úô[ù\ôXNà

HOà›\úô[ù\ôXKàSKà^Y\ãàX›[€î\ùX€\ÀàP’S”ó—ñ”SRUàJN¬Çà⁄[ô›Àëò\õP[ö[X[œÀö[ö]
¬à””Ààì’‘ÀàSKà[U\Kà‘ëPUTëW—ãà‘ëPUTëW‘Tî—PQ‘êQà⁄[ô›Àî\úõ›][€ãê‘ëPUTëW‘Tî—PQ‘êQàUSW—QîÀàUëT’–“◊‘ëT”’Tê—W—QîÀàUëT’–“◊‘ëT”’Tê—W’ëTêãàUëT’–“◊“USW““SëÀàUëT’–“◊—QUàUSR–S“RW—QêUS—U◊–””‘ãàUSR–S“RW—U◊–”””’”ó—VTÀà[ö[X[ÿöôX›Ààÿ[[ô\ãà[ùô[ù‹ûKà^Y\ãàÀ»ò\õH]ô\›ÿ⁄»\»]»›€à[K\‹XŸH\]H€‹€»⁄]ôH]BàÀ»ÿ[YH^X⁄]òXŸH\ôŸ]\ŸYûH€€\[ö[€ã›⁄[YôHÿ^ôKàBàÀ»‹ö^õ€ù[⁄[ù\»[àò\õH[\Œ»€‹õH\»H^Y\â‹»X›X[àÀ»€[€›Y‹ùòZ]òXŸHZY⁄ô]ô\àHôY]ÿõŸHŸ[ù\ãÇàŸ]^Y\ëòXŸU\ôŸ]à

HOà¬à€€ú›‹»H⁄[ô›Àê‹ôX]\ôRXYÿX⁄KôŸ]XY€‹õ
^Y\ã	‹^Y\âÀ»à^Y\ãûNà^Y\ãûKY\⁄à^Y\ìY\⁄]ò]\ì[Ÿ[ZY⁄à^Y\ê]ò]\ì[Ÿ[ZY⁄JN¬àô]\õà»à‹Àû»SKéà‹Àûà»SK€‹õNà‹Àù€‹õHN¬àKàÀ»î›\ôHòX⁄»Yà[›Hõÿ›\»€àZ\àXYàõ‹à]ô\›ÿ⁄ÀòX⁄ŸYûBàÀ»H^X›ÿ[YHZ[K\ò^HX]‹õ›[ô€€\[ö[€ú»\ŸH
ÿ[YKöú…‹¬àÀ»⁄\‘^Y\ëõÿ›\ŸY€íXY
KàXY€‹õ[Tÿÿ[H\¬àÀ»ﬁKüH[àò\õH[\»
ﬁäH
»ôX[ÿŸ[ôH€‹õH
JH8†%Hÿ[YBàÀ»⁄\HŸò\õP[ö[X[òXŸS€⁄»[ôXYHùZ[»õ‹à]»XùY»ò^KÇà\‘^Y\ëõÿ›\ŸY€íXYà
XY€‹õ[Tÿÿ[JHOà¬à€€ú›ò^HHÿ›\úô[ù^Y\ì€⁄‘ò^J
N¬àYà
\ò^HZXY€‹õ[Tÿÿ[JHô]\õàò[ŸN¬àô]\õà⁄[ô›Àê‹ôX]\ôRXYÿX⁄Kö\‘ò^SôX\î⁄[ù
ò^KXY€‹õ[Tÿÿ[KVQTó“PQ—ì–’T◊‘êQUT◊’”‘ì
N¬àKàÿŸ[ôKà€‹õÿöôX›Àà[ô€QYôãàÿ[Y\òP€€ôöYÀàÿ[Y\òTô[]]ôP‹ôX]\ôT\úÀàÿ[Y\òTô[]]ôT\úÀà€[\[ùô[ù‹ûT›X⁄ÀàŸ][][RŸ^Nà

HOà[[ŸHOOH	⁄][I»»Ÿ]X›]ôR[ùô[ù‹ûR][J
OÀöŸ^Hù[àù[àôYúô\⁄][Tÿ‹õ€àôYúô\⁄X›[€êò\ãàÿ]ôSY[Xô\ï€‹õ]Kà€€\[ö[€êZU\Qõ‹í⁄[ôà‹ôX]\ôP]X⁄Y[ù[ò⁄‹ãà‹ôX]\ôT[ôQ‹õ›[ôŸôúŸ]àö[ô‹[ï[SôX\êò\õéà⁄[ô›Àëò\õPùZ[[ô‹Àôö[ô‹[ï[SôX\ãàŸ]€‹õÿöôX›]à\—ò\õT\õZ\‹⁄[€ãà\‘€€YàôX\ô\›[ô€P[[€ôÀà\ú€[\à⁄[ô›Àî\úõ›][€ãú\ú€[\àô\€€ôP‹ôX]\ôQ‹õ›[ô[ò⁄‹îò][Ààõôàÿ]ôT›XõKà⁄›’ÿ\›à[T›\ôòXŸVKàÿ]]–\‹⁄Y€î›XõTõ€Kà€X\ö‘ô‘[ôKà€ÿY€‹õúôYY[ô‘Z\úÀà‹ÿ]ôU€‹õúôYY[ô‘Z\úÀàÿY€‹õ]ô\›ÿ⁄Œà€ÿY€‹õ]ô\›ÿ⁄Ààÿ]ôU€‹õ]ô\›ÿ⁄Œà‹ÿ]ôU€‹õ]ô\›ÿ⁄Ààÿ]ôQò\õS^[›]àŸ]ò\õïY\úŒà

HOàêTìó’QTîÀàŸ]^Y\ë]Nà

HOà‹^Y\ë]KàŸ]‹öYà

HOà‹öYàŸ]ò\õPùZ[[ô‹Œà

HOàò\õPùZ[[ô‹ÀàŸ]›XõNà

HOà›XõKàŸ]›\úô[ù\ôXNà

HOà›\úô[ù\ôXKàŸ]òX⁄[ô–[ô€Nà

HOàòX⁄[ô–[ô€KàŸ]òX⁄[ô–[ô€Nà
äHOà»òX⁄[ô–[ô€HHé»KàŸ]ÿ[Y\òS[ŸNà

HOàX›]ôPÿ[Y\òS[ŸKàŸ]ÿ[Y\òS[ŸNà
äHOà»X›]ôPÿ[Y\òS[ŸHHé»KàŸ]ÿ[Y\òU\ôŸ]à

HOàX›]ôPÿ[Y\òU\ôŸ]àŸ]ÿ[Y\òU\ôŸ]à
äHOà»X›]ôPÿ[Y\òU\ôŸ]Hé»KàŸ]€‹õ]ô\›ÿ⁄—úò[YPÿX⁄Nà
äHOà»›€‹õ]ô\›ÿ⁄—úò[YPÿX⁄HHé»KàôYúô\⁄õ›Y⁄ö\›X[à
ò\õíYõ›Y⁄[ô^
HOà⁄[ô›Àëò\õUõ›Y⁄ÀúôYúô\⁄ö\›X[
ò\õíYõ›Y⁄[ô^
KàJN¬Çà⁄[ô›Àëò\õUõ›Y⁄œÀö[ö]
¬àŸ]ò\õïY\úŒà

HOàêTìó’QTîÀàŸ]ò\õPùZ[[ô‹Œà

HOàò\õPùZ[[ô‹Àà[ùô[ù‹ûKàUSW—QîÀà\ÿÀà⁄›’ÿ\›àùZ[[ùô[ù‹ûQ‹öYàôYúô\⁄X›[€êò\ãàÿ]ôSY[Xô\ï€‹õ]KàÿY€‹õ]ô\›ÿ⁄Œà€ÿY€‹õ]ô\›ÿ⁄ÀàJN¬Çà⁄[ô›Àëò\õPùZ[[ô‹œÀö[ö]
¬à””Ààì’‘Àà[U\Kà[ö[X[ÿöôX›Àà€[\[ùô[ù‹ûT›X⁄ÀàXùY”ŸÀà\—ò\õT\õZ\‹⁄[€ãà[ùô[ù‹ûKàÿY›\ŸTYXŸQòXŸU^\ôNà⁄[ô›Àï›€ñõ€ôPùZ[[ô‹ÀõÿY›\ŸTYXŸQòXŸU^\ôKàX\ö’[Q\ùKà‹[ìY[ùKàôX€€\]Uÿ]\éà⁄[ô›Àïÿ]\îﬁ\›[KúôX€€\]Uÿ]\ãàÿ]ôQò\õS^[›]àÿ]ôSY[Xô\ï€‹õ]KàÿŸ[ôKà€‹õÿöôX›Àà›\ŸUÿ[ùZ[\ãàÿY€‹õ]ô\›ÿ⁄Œà€ÿY€‹õ]ô\›ÿ⁄Ààÿ]ôU€‹õ]ô\›ÿ⁄Œà‹ÿ]ôU€‹õ]ô\›ÿ⁄Àà[ù\êùZ[[ôŒà
X\Y
HOà[ù\êùZ[[ô X\Y
KàŸ]ò\õïY\úŒà

HOàêTìó’QTîÀàŸ]‹öYà

HOà‹öYàŸ]›\ŸTYXŸTôX›Œà

HOà⁄[ô›Àí›\ŸTYXŸ\ÀôŸ]YXŸTôX› 
KàŸ]ò\õPùZ[[ô‹Œà

HOàò\õPùZ[[ô‹ÀàŸ]ò\õPùZ[[ô‹Œà
äHOà»ò\õPùZ[[ô‹»Hé»KàŸ]ò\õS]ô\›ÿ⁄—õÿ›\–ò\õíYà
äHOà»Ÿò\õS]ô\›ÿ⁄—õÿ›\–ò\õíYHé»KàUSR–S“RW—U◊–”””’”ó—VTÀàJN¬Çà⁄[ô›Àí›\ŸTYXŸ\œÀö[ö]
¬à””Ààì’‘Àà[U\Kà€[\[ùô[ù‹ûT›X⁄ÀàXùY”ŸÀà\—ò\õT\õZ\‹⁄[€ãà[ùô[ù‹ûKàÿY›\ŸTYXŸQòXŸU^\ôNà⁄[ô›Àï›€ñõ€ôPùZ[[ô‹ÀõÿY›\ŸTYXŸQòXŸU^\ôKàX\ö’[Q\ùKà‹[ìY[ùKàôX€€\]Uÿ]\éà⁄[ô›Àïÿ]\îﬁ\›[KúôX€€\]Uÿ]\ãàŸ]‹öYà

HOà‹öYàÿ]ôQò\õS^[›]àÿ]ôSY[Xô\ï€‹õ]KàÿŸ[ôKà€‹õÿöôX›Àà›\ŸUÿ[ùZ[\ãà›\ùÿŸ[ôUò[ú⁄][€ãà[ù\í[ù\ö[‹ãà€îYXŸQŸ[€Y]ûP⁄[ôŸYà

HOàôXùZ[[ù\ö[‹ëŸ[€Y]ûJ
Kàò[úŸõ‹õQù\õö]\ôU⁄]›\ŸTYXŸKàôX€›ô\ëù\õö]\ôR[í[ù\ö[‹îôX›à
ÃåÀ
HOàôX€›ô\ëù\õö]\ôR[í[ù\ö[‹îôX›
ÃåÀ
KàŸ]YXŸPÿ][ŸŒà

HOà’T—W‘QP—W––US—ÀàŸ]›\ŸTYXŸ\Œà

HOà›\ŸTYXŸ\ÀàŸ]›\ŸTYXŸ\Œà
äHOà»›\ŸTYXŸ\»Hé»KàŸ]ò\õPùZ[[ô‹Œà

HOàò\õPùZ[[ô‹ÀàJN¬Çà⁄[ô›Àê‹ôX]\ôQX]Àö[ö]
¬àSKà””Ààì’‘Àà€[\àÿ[ìÿÿ›\P]à⁄\òX›\ë‹õ›[ô⁄Y›‘›\ôòXŸSŸôúŸ]à[T›\ôòXŸVR[ê\ôXKà€‹úŸSÿöôX›ÀàŸ]›\úô[ù\ôXNà

HOà›\úô[ù\ôXKàŸ]‹öYà

HOà‹öYàJN¬Çà⁄[ô›Àëò\õP‹ò]\œÀö[ö]
¬àêT—W‘íP—TÀàS‘ìíSë◊“’Tãà—S“SïTïêS“’TîÀà’TW––US—Àà[U\Kà[ùô[ù‹ûKàÿ[[ô\ãà€[\[ùô[ù‹ûT›X⁄ÀàŸ]X›]ôR[ùô[ù‹ûR][KàŸ][[ŸNà

HOà[[ŸKàÿ[î^Sú—ö[ö“[ù\òX›[€éà
ããò\ô‹ HOà⁄[ô›Àìú—ö[ö“[ù\òX›[€èÀòÿ[î^OÀäããò\ô‹ Hò[ŸKà^Sú—ö[ö“[ù\òX›[€éà
ããò\ô‹ HOà⁄[ô›Àìú—ö[ö“[ù\òX›[€èÀú^OÀäããò\ô‹ Hà][RX€€ëõ‹íŸ^KàŸ]›\éà⁄[ô›Àêÿ[[ô\îﬁ\›[KôŸ]›\ãà\—ò\õT\õZ\‹⁄[€ãà‹[ìY[ùKà⁄›’ÿ\›àÿ]ôSY[Xô\ï€‹õ]KàùZ[[ùô[ù‹ûQ‹öYàôYúô\⁄][Tÿ‹õ€àôYúô\⁄X›[€êò\ãàùZ[⁄\[ô’ò[úŸô\ïRNà

HOà⁄[ô›Àî⁄\[ô‘[ô[òùZ[

Kà[T›\ôòXŸVKàÿŸ[ôKàŸ][]ô\ûSŸŒà

HOà[]ô\ûSŸÀàŸ][ô[ô”‹ô\úŒà

HOà[ô[ô”‹ô\úÀàŸ]Y[ùS‹[éà

HOàY[ùS‹[ãàöYŸŸ\í[ö[ö–[ö[X][€ãàJN¬Çà⁄[ô›ÀîõÿŸY\ò[\⁄‹œÀö[ö]
¬àíT“—QîÀà‘ëPUTëW—ãàŸ]€›€€Œà

HOà€€›€€ÀàUSW—QîÀà€€X\›\ûS]ô[à\]Z\Y[ù€›Ààÿ[[ô\ãàŸ]]Y\››]\ÀàŸ]]Y\›õŸ‹ô\‹Œà

HOà]Y\›õŸ‹ô\‹Ààú’ÿ[Ÿ\úÀà[ùô[ù‹ûKà€[\[ùô[ù‹ûT›X⁄Àà⁄›’ÿ\›àŸ]^T\ùà^T\ùõ›ÀàŸ]^Y\ìöX⁄€ò[YNà

HOà
‹^Y\ë]H⁄[ô›Àó◊⁄ÿù[ööT^Y\îõŸö[JOÀõöX⁄€ò[YH	ŸúöY[ô	ÀàJN¬Çà⁄[ô›Àêõ›[ùPõÿ\ôÀö[ö]
¬àŸ]]Y\›õŸ‹ô\‹Œà

HOà]Y\›õŸ‹ô\‹ÀàŸ]]Y\››]\Àà⁄›’ÿ\›à[ùô[ù‹ûKàÿ[[ô\ãà”PT÷ì”ëW”PëSÀàXZŸU\⁄“Yà⁄[ô›ÀîõÿŸY\ò[\⁄‹ÀõXZŸU\⁄“YàJN¬Çà⁄[ô›Àêò[ô]ÿ[\œÀö[ö]
¬à€[\àõôàXùY”ŸÀàSKà[U\Kà–UTï–VW’TTÀàVTíS‘ó÷ì”ëTÀàì‘ìPS’‘àõ€ôS^[›]Œàﬁõ€ôS^[›]Ààõ€ôTÿŸ[ô\Œàﬁõ€ôTÿŸ[ô\ÀàôYúô\⁄õ€ôQ‹õ›[ôö\›X[ÀàX\ö”›][ôNà€X\ö”›][ôKàXZŸQX€‹ò]]ôQù\õö]\ôSY\⁄à[T›\ôòXŸVR[ê\ôXKà‹›[SÿöôX›Àà€€\[ö[€ìÿöôX›Àà€‹úŸSÿöôX›Àà\÷õ€ôP\ôXNà⁄\÷õ€ôP\ôXKà\—[îX⁄–[]ôNà⁄[ô›Àï⁄[YôT‹]€ãö\—[îX⁄–[]ôKà[íŸ^Qõ‹éà⁄[ô›Àï⁄[YôT‹]€ãô[íŸ^Qõ‹ãà^Y\ãà⁄›÷õ€ôPò[õô\ãà⁄›’ÿ\›àô\]Y\›€€\[ö[€ë\ÿ€›ô\ûNà
ÀôX\€€äHOà⁄[ô›Àê[ö[X[õÿÿ[^ò][€úœÀò€€\[ö[€ë\ÿ€›ô\ûOÀäÀôX\€€äBà⁄[ô›Àê]Y[‘ﬁ\›[OÀú^P‹ôX]\ôUôX\›\ôP[\ùÀä Kàõ€€›€€à[ùô[ù‹ûKà€[\[ùô[ù‹ûT›X⁄Àà][RX€€ëõ‹íŸ^KàôYúô\⁄][Tÿ‹õ€àùZ[[ùô[ù‹ûQ‹öYàôYúô\⁄X›[€êò\ãàÿ]ôSY[Xô\ï€‹õ]Kà\‹]€ê‹ôX]\ôKàùZ[X⁄–€›[ô‘ŸX›[€éà⁄[ô›Àë\]Z\Y[ù[ô[òùZ[X⁄–€›[ô‘ŸX›[€ãàŸ]YPÿ][ŸŒà⁄[ô›ÀëYTﬁ\›[KôŸ]ÿ][ŸÀàYU–€›[ô–€€‹éà⁄[ô›ÀëYTﬁ\›[Kù–€›[ô–€€‹ãà€›[ô‘‹ö]Qõ‹ê€‹€Y]XŒà⁄[ô›Àë\]Z\Y[ù[ô[ò€›[ô‘‹ö]Qõ‹ê€‹€Y]XÀàUó–TëSêW÷ì”ëW“Qà⁄[ô›Àë]î‹]€ô\ãëUó–TëSêW÷ì”ëW“QàX›]ôPõ›[ùQõ‹ñõ€ôNà
õ€ôRY
HOà⁄[ô›Àêõ›[ùPõÿ\ôòX›]ôPõ›[ùQõ‹ñõ€ôJõ€ôRY
KàŸ]›\úô[ù\ôXNà

HOà›\úô[ù\ôXKàŸ]X›]ôPX›[€éà

HOàX›]ôPX›[€ãàŸ]X›[€í[›€éà

HOàX›[€í[›€ãàŸ]X⁄–€›[ôŒà

HOàX⁄–€›[ôÀàŸ]›‹ôP€›[ô‘YXŸ\Œà

HOà’‘ëW–”’Së◊‘QP—TÀàJN¬àö]–\‹X›

N¬àô\⁄^ôPÿ[ùò\ 
N¬àôYúô\⁄X›[€êò\ä
N¬àôYúô\⁄][Tÿ‹õ€

N¬àûH»[ö]€‹õÿöôX› 
N»Hÿ]⁄
JH»€€ú€€Kô\úõ‹ä	⁄[ö]€‹õÿöôX›ŒâÀJN»BàÀ»\Hÿ]ôYÿöôX›‹⁄][€ú»[ôù\õö]\ôHYù\à€‹õÿöôX›»\ôH‹ôX]YàûH»\Qò\õS^[›]ÿöôX› ÿYò\õS^[›]

JN»Hÿ]⁄
JH»€€ú€€Kô\úõ‹ä	ÿ\Qò\õS^[›]ÿöôX›ŒâÀJN»BàÀ»ò[ú⁄][€à‹›»
»⁄\ôYî»õ›]\»úõ€HHX\Y]‹ÇàûH»[ö]€‹õò]ô[
ÿYò\õS^[›]

JN»Hÿ]⁄
JH»€€ú€€Kô\úõ‹ä	⁄[ö]€‹õò]ô[âÀJN»BàÀ»[ú›\ôHHò\õx°§ù›€àò[ú⁄][€à[ÿ^\»^\›»]ô[à⁄]›]X\Y]‹à]BàYà
]€‹õò[ú⁄][€úÀú€€YJOàù\ôŸ]OOH	››€â JH¬à€‹õò[ú⁄][€úÀú\⁄
»Yà	‹‹Ÿò\õW›◊››€âÀXô[à	’»›€âÀ\ôXNà	Ÿò\õIÀ€€àMÀõ›Œà\ôŸ]à	››€âÀ\ôŸ]€€àå\ôŸ]õ›ŒàJN¬àùZ[ò[ú⁄][€ìX\öŸ\ú 
N¬àBàÀ»ÿY›€à^[›]úõ€H€‹ö‹‹XŸH€€ôöY»
]]‹ö]]]ôH€›\òŸJBà⁄[ô›Àì]\⁄XœÀõÿY]Y[–›YR[ô^\ 
Kù[ä

HOà⁄[ô›Àì]\⁄XœÀúô\Ÿ][XöY[ù›YU[Y\ä
JKòÿ]⁄


HOà⁄[ô›Àì]\⁄XœÀúô\Ÿ][XöY[ù›YU[Y\ä
JN¬à€ÿY›€ëúõ€U€‹ö‹‹XŸJ
Kòÿ]⁄


HOàﬂJN¬àXùY”Ÿ 	ÿÿ[ùò\»ô\⁄^ôY‹]⁄YK\ÿ‹ôY[à^[›]X›]ôK€€ùõ€»õ›[ô[ö[X][€à€‹ô\]Y\›Y	 N¬ÇàÀ»8• 8• €òõÿ\ô[ô»ÿ]H8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• à]ÿ[YT›\ùYHò[ŸN¬à⁄[ô›Àó◊⁄ÿù[ööQÿ[YT›\ùYHò[ŸN¬Çà\ﬁ[ò»ù[ò›[€à‹]€î^Y\ê]ò]\ä^Y\ë]JH¬àÀ»ô\›‹ôH\»€‹õ	‹»ÿ]ôY]K›[YK›ŸX]\à
ŸYBàÀ»€ÿY€‹õÿ[[ô\ã◊‹ÿ]ôU€‹õÿ[[ô\äHôYõ‹ôH[û][ô»ôXY¬àÀ»ÿ[[ô\ãô^H8†%⁄X⁄’›[⁄Yù

Hô[›»\ö]ô\»H›\úô[ùàÀ»›[YX\àúõ€H]€»\»\»»[ôö\ú›‹àH⁄Yù⁄X⁄¬àÀ»ù[ú»YÿZ[ú›Hù\›\ô\Ÿ]ë^HHàYò][[ú›XYŸà⁄\ô]ô\ÇàÀ»H€‹õX›X[HYùŸôãÇà€€ú›‹ÿ]ôYÿ[[ô\àH€ÿY€‹õÿ[[ô\ä
N¬àYà
‹ÿ]ôYÿ[[ô\äHÿöôX›ò\‹⁄Y€äÿ[[ô\ã‹ÿ]ôYÿ[[ô\äN¬ÇàÀ»ö\ôKX[ôYõ‹ôŸ]àH›[⁄Yù]€‹õ›\ù
‹à€à[ûHZ\‹ŸYàÀ»YX\à⁄[òŸH\›^YY
Hÿ[àZŸHHô]»ŸX€€ô»X‹õ‹‹»[õ›\ÇàÀ»õ€ô\Àù]õ›[ô»\ôHôYY»»õÿ⁄»€à]8†%Hõ€ôH€õHôYY¬àÀ»»ôHô\⁄\YûHH[YHH^Y\àX›X[Hÿ[‹»[ù»]Çà⁄X⁄’›[⁄Yù

N¬ÇàÀ»H[Ÿ[K[]ô[[ö]Xõ›ôHÿYYHò\õH^[›]
[\Àÿ‹õ‹»[ôàÀ»ù\õö]\ôKÿ‹ò]H‹⁄][€ú H[ô\àHYÿXﬁH[õò[Y\‹XŸYŸ^K⁄[òŸBàÀ»€‹õYÿ\€â›€õ›€àY]]]⁄[ùàõ›»]^Y\ë]Kù€‹õYàÀ»\»€õ›€ãôY»ù\›]\ùYÿZ[ú›H€‹úôX›K[ò[Y\‹XŸYàÀ»\ã]€‹õŸ^H€»Ÿ\\ò]H€‹õ»ô]ô\àõYY[ù»XX⁄›\â‹»ò\õBàÀ»
Z\úõ‹ú»‘ô\Ÿ]

I‹»ôYŸ[ô\ò]K][ãX\H]\õàô[› Kàò[ú⁄][€úÀ¬àÀ»õ›]\À”î»ÿ⁄Y[\»\ôH⁄\ôY]]‹ôYX\€€ù[ùõ›\ã]€‹õàÀ»›]K€»[ö]€‹õò]ô[

H\»[Xô\ò][Hì’ôY€ôH\ôH8†%]àÀ»[ôXYHò[à€òŸH][Ÿ[H[ö][ô‹]€îÿ⁄Y[Yú‹ 
H\€â›àÀ»Y[\›[ù
]\[ô»»ú’ÿ[Ÿ\ú»⁄]õ»€X\à›\
K€»ÿ[[ô¬àÀ»]YÿZ[à€›[‹]€à]ô\ûHÿ⁄Y[Yî»HŸX€€ô[YKÇà€X\îXŸYõÿŸ\‹⁄[ô—ù\õö]\ôJ
N¬à€X\í[ù\ö[‹ëù\õö]\ôJ
N¬à⁄[ô›Àëò\õPùZ[[ô‹Àò€X\ê[

N¬àÀ»[Ÿ[H[ö]X^H]ôHXŸY›\ŸHYXŸ\»\àHYÿXﬁKZŸ^BàÀ»^[›]8†%€X\à[Hõ›»
ÿ[YH\»ò\õPùZ[[ô‹Àò€X\ê[

Hù\›àÀ»Xõ›ôJH€»Hô\Ÿ]€‹ô[›»Ÿ\€â›ÿ[úô\Ÿ]

H€àHYXŸBàÀ»\»€‹õ\€â›X›X[HX\õôY»H›\ù\àYXŸH\»ô\ŸYYYàÀ»úô\⁄öY⁄Yù\à]€‹]]»\ôYò][ôYõ‹ôH\Z[ô¬àÀ»
‹àõ›ö[ô[ô H\»€‹õ	‹»›€àÿ]ôY‹⁄][€à8†%ÿ[YHò][€ò[BàÀ»\»HŸ[‹ò]K‹›\Hõﬁô\Ÿ][[YYX][Hô[›ÀÇà⁄[ô›Àí›\ŸTYXŸ\Àò€X\ê[

N¬à€‹õÿöôX›Àôõ‹ëXX⁄
»OàÀúô\Ÿ]	âàÀúô\Ÿ]

JN¬à⁄[ô›Àí›\ŸTYXŸ\ÀúŸYY›\ù\ä’T—W‘’TïTó–””’T—W‘’TïTó‘ì’ N¬àôXùZ[[ù\ö[‹ëŸ[€Y]ûJ
N¬à‹öYH‹ôX]R[ö]X[‹öY

N¬àÀ»[Ÿ[H[ö][ôXYHX^H]ôH[›ôYH⁄\[ôÀ‹›\H‹ò]\»\àBàÀ»YÿXﬁKZŸ^H^[›]8†%][HòX⁄»»Z\à\ôYò][»ôYõ‹ôBàÀ»\Z[ô»
‹àõ›ö[ô[ô H\»€‹õ	‹»›€àÿ]ôY‹⁄][€úÀ€»BàÀ»úò[ô[ô]»€‹õÿ[â›[ö\ö][õ›\à€‹õ	‹»‹ò]HXŸ[Y[ùÇà€€ú›QêUS‘—S–‘êUW–””HãQêUS‘—S–‘êUW‘ì’»Hì’‘»HŒ¬à€€ú›QêUS‘’TW–ì÷–””HQêUS‘’TW–ì÷‘ì’»Hì’‘»HŒ¬àYà
⁄\[ô–õﬁÿöôX›	âà
⁄\[ô–õﬁÿöôX›ò€€OOHQêUS‘—S–‘êUW–””⁄\[ô–õﬁÿöôX›úõ›»OOHQêUS‘—S–‘êUW‘ì’ JH¬à€‹õÿöôX›Àô[]J⁄\[ô–õﬁÿöôX›ò€€
»	À	»
»⁄\[ô–õﬁÿöôX›úõ› N¬à€€ú›ò»H⁄[ô›Àëò\õP‹ò]\ÀõXZŸTŸ[‹ò]JQêUS‘—S–‘êUW–””QêUS‘—S–‘êUW‘ì’ N¬à⁄\[ô–õﬁÿöôX›HòŒ»€‹õÿöôX›ÀúŸ]
òÀò€€
»	À	»
»òÀúõ›Àò N¬àBàYà
›\PõﬁÿöôX›	âà
›\PõﬁÿöôX›ò€€OOHQêUS‘’TW–ì÷–””›\PõﬁÿöôX›úõ›»OOHQêUS‘’TW–ì÷‘ì’ JH¬à€‹õÿöôX›Àô[]J›\PõﬁÿöôX›ò€€
»	À	»
»›\PõﬁÿöôX›úõ› N¬à€€ú›òàH⁄[ô›Àëò\õP‹ò]\ÀõXZŸT›\Põﬁ
QêUS‘’TW–ì÷–””QêUS‘’TW–ì÷‘ì’ N¬à›\PõﬁÿöôX›Hòé»€‹õÿöôX›ÀúŸ]
òãò€€
»	À	»
»òãúõ›ÀòäN¬àBà€€ú››€‹õ^[›]HÿYò\õS^[›]

N¬àYà
›€‹õ^[›]
H\Qò\õS^[›]—‹öY
›€‹õ^[›]»ôYúô\⁄ö\›X[ŒàùYHJN¬à\Qò\õS^[›]ÿöôX› ›€‹õ^[›]
N»À»ô\‹⁄][€ú»YÿZ[àYàT»€‹õÿ]ôY›\›€H‹ò]H‹⁄][€ú¬àÀ»ŸYYH›\ù\àôY[àHò\õZ›\ŸHõ‹àHúò[ô[ô]»€‹õ8†%€Y\[êôY

BàÀ»
ŸYHŸ][ù\ö[‹í[ù\òX›XõP]
HôYY»€€Y]⁄\ôH»€Y\[ôHúô\⁄àÀ»^Y\à\»õ»ôY][H[à[ùô[ù‹ûHY]»ù^J‹XŸH€ôH[\Ÿ[ô\ÀÇàÀ»ÿ]Y€à\»€‹õ]ö[ô»õ»ÿ]ôY^[›]][€»]ô]ô\ÇàÀ»ôKX\X\ú»õ‹àHô]\õö[ô»^Y\ã[ò€Y[ô»€ôH⁄»[›ôY‹ÇàÀ»ô[[›ôYZ\à›\ù\àôY
ò\õS^[›]Ÿ^J
H\»\ã]€‹õ€»\¬àÀ»⁄X⁄»\»»\[à\ôH8†%Yù\à^Y\ë]Kù€‹õY\»€õ›€à8†%àÀ»ò]\à[à][Ÿ[H[ö]⁄\ôH]€›[ÿ]ôH[ô\àH‹õ€ôÀàÀ»õ›^Y][ò[Y\‹XŸYŸ^H[ô[àŸ]€X\ôYöY⁄òX⁄»›]ûH\¬àÀ»ÿ[YH\ã]€‹õô[ÿY
KÇàYà
W›€‹õ^[›]
H¬àûH¬àÀ»HŸ[ù\›[ú⁄YHH›\ù\àYXŸI‹»›€à›XõY[ù\ö[‹ÇàÀ»õÿ⁄»
]ÿ^Húõ€H]»€‹àô\⁄€
H8†%ŸYBàÀ»ôXùZ[[ù\ö[‹ëŸ[€Y]ûJ
K“’T—W‘’TïTó–””‘ì’»Xõ›ôKÇà€€ú›ôY€€H’T—W‘’TïTó–””
àà
»KôYõ›»H’T—W‘’TïTó‘ì’»
àà
»N¬à€€ú››\ù\êôYHXZŸQX€‹ò]]ôQù\õö]\ôSY\⁄
ôY€€ôYõ›À	ÿò\⁄X–ôY	À[ù\ö[‹îÿŸ[ôK	⁄[ù\ö[‹â N¬àYà
›\ù\êôY
H¬à[ù\ö[‹ëù\õö]\ôSÿöôX›Àú\⁄
»Yà	ŸX€‹ó‹›\ù\óÿôY	ÀŸ^Nà	ÿò\⁄X–ôY	À€€àôY€€õ›ŒàôYõ›ÀàY\⁄à›\ù\êôYõY\⁄Y⁄à›\ù\êôYõY⁄Ÿû€›\òŸNà›\ù\êôYúŸû€›\òŸK\ôXNà	⁄[ù\ö[‹âÀõ›QYŒààããôù\õö]\ôS›€ô\ëöY[ ôY€€ôYõ› HJN¬àÿ]ôQò\õS^[›]

N¬àBàHÿ]⁄
JH»€€ú€€Kô\úõ‹ä	‹›\ù\àôYŸYYâÀJN»BàBà⁄[ô›Àëò\õP[ö[X[Àúô\‹]€ï€‹õ]ô\›ÿ⁄ 
N»À»Yù\àù\õö]\ôK€»ÿÿ›\[òﬁH⁄X⁄‹»ŸYHö[ò[[H›]Bà⁄[ô›Àïÿ]\îﬁ\›[KúôX€€\]Uÿ]\äò[ŸJN¬ÇàÀ»õ€ãYŸX\à[ùô[ù‹ûH
ô\€›\òŸ\ H[ôX⁄»€›[ô»\ôH€‹õ\ÿ€‹YàÀ»\à⁄\òX›\à8†%^H›^HôZ[ô[à\»€‹õ	‹»Y[Xô\àôX€‹ôàÀ»ò]\à[àõ€›⁄[ô»H⁄\òX›\à»[õ›\à€‹õÇàÿöôX›öŸ^\ [ùô[ù‹ûJKôõ‹ëXX⁄
Ÿ^HOà»[]H[ùô[ù‹ûV⁄Ÿ^WN»JN¬àÿöôX›ò\‹⁄Y€ä[ùô[ù‹ûKÿöôX›öŸ^\ ^Y\ë]Kõõ€ëŸX\í[ùô[ù‹ûHﬂJKõ[ô›à»»ããú^Y\ë]Kõõ€ëŸX\í[ùô[ù‹ûHBàà»ããî’TïSë◊“SïëSï‘ñHJN¬àÀ»€‹õ»ÿ]ôYôYõ‹ôHHÿ[\ö\ôH⁄]õY\ö[ùõ⁄[ôYàÀ»’TïSë◊“SïëSï‘ñHô]ô\àX⁄ŸY]\8†%òX⁄Ÿö[]õ‹àúôYKàÀ»€òŸKÿ[YH\»^\›[ô»⁄\òX›\ú»Ÿ][ô»H‹õ‹‹ÿõ›À‹ÿÿ]\òõ›¬àÀ»€›»ô[›À€»]	‹»]òZ[XõH⁄]›]Hÿ\ú[ù\àö\Z]\àÿ^KÇàYà
Z[ùô[ù‹ûKòÿ[\ö\ôR⁄]ù\õö]\ôPõY\ö[ù
H[ùô[ù‹ûKòÿ[\ö\ôR⁄]ù\õö]\ôPõY\ö[ùHN¬à⁄[ô›Àíÿù[ööQù[ö—ÿ[Y\^PúöYŸOÀúô\›‹ôPõ›T›⁄Y‹œÀä^Y\ë]Kò[€⁄€õ›T›⁄Y‹ N¬à⁄[ô›Àíÿù[ööQù[ö—ÿ[Y\^PúöYŸOÀúô\›‹ôSú–[€⁄€›]OÀä^Y\ë]Kõú–[€⁄€›]JN¬à⁄[ô›Àìú’ÿ\ôõÿôOÀúô\›‹ôOÀä^Y\ë]Kõú’ÿ\ôõÿôT›]JN¬à⁄[ô›Àìú—⁄Yù[ôœÀúô\›‹ôQ\ÿ€›ô\ôYôYúœÀä^Y\ë]Kõú—\ÿ€›ô\ôY⁄YùòZ] N¬àX⁄–€›[ô»HÀããä^Y\ë]KúX⁄–€›[ô»◊JWN¬à⁄[ô›Àê€€⁄⁄[ô‘ﬁ\›[Kúô\›‹ôJ^Y\ë]Kò€€⁄⁄[ô‘›]JN¬à⁄[ô›Àî⁄⁄[ﬁ\›[Kúô\›‹ôJ^Y\ë]JN¬à⁄[ô›Àî\ö‘ﬁ\›[OÀúô\›‹ôJ^Y\ë]JN¬ÇàÀ»î»ô[][€ú⁄\À€Y[[‹ûH[ô]Y\›õŸ‹ô\‹»\ôHZŸ]⁄\ŸH€‹õ\ÿ€‹YàÀ»\à⁄\òX›\ãÇà⁄[ô›ÀëX[Ÿ›YP€€ù[ùÀõÿYú‘ô[][€ú⁄\ ^Y\ë]JN¬à]Y\›õŸ‹ô\‹»H»ããä^Y\ë]Kú]Y\›õŸ‹ô\‹»ﬂJHN¬à⁄[ô›ÀîõÿŸY\ò[\⁄‹ÀõX^XôTôYúô\⁄ô\]Y\›‹›[ô‹ 
N»À»XZŸ\»›\ôHô\]Y\›»^\›]ô[àôYõ‹ôHHö\ú›^Hõ€›ô\ÇÇàÀ»[⁄[^Nà\ÿ€›ô\ôYôXYŸ[ùYôôX›À›[XX›]ôHùYôúÀŸXùYôúÀ[ôàÀ»Ÿ^I‹»
õ›^Y]\X⁄ŸY
H⁄[\õô\‹»ôXYŸ[ùXŸ[Y[ù»8†%[àÀ»€‹õ\ÿ€‹Y\à⁄\òX›\ãÿ[YH\»HöY[»ù\›Xõ›ôKÇà⁄[ô›Àê[⁄[^Tﬁ\›[Kúô\›‹ôR€õ›€îôX⁄\\ ^Y\ë]Kò[⁄[^R€õ›€îôX⁄\\À^Y\ë]Kò[⁄[^R€õ›€ëYôôX› N¬à⁄[ô›Àê[⁄[^Tﬁ\›[Kúô\›‹ôPX›]ôQYôôX› ^Y\ë]Kò[⁄[^PX›]ôQYôôX› N¬à⁄[ô›ÀîôXYŸ[ù[ùÀúô\›‹ôVõ€ôTôXYŸ[ù›]J^Y\ë]Kò[⁄[^TôXYŸ[ù›]JN¬à⁄[ô›Àï⁄[ô\úöY\Àúô\›‹ôT›]J^Y\ë]Kù⁄[ô\úûT›]JN¬à⁄[ô›Àï⁄[ôX\›\ôKúô\›‹ôT›]J^Y\ë]Kûõ€ôUôX\›\ôT›]JN¬àô\›‹ôU⁄[\õô\‹–⁄[ö‘›]J^Y\ë]Kù⁄[\õô\‹–⁄[ö‘›]JN¬à⁄[ô›Àï⁄[\õô\‹–ÿ[\ö\ôOÀúô\›‹ôJ^Y\ë]Kù⁄[\õô\‹–ÿ[\ö\ôT›]JN¬àô\›‹ôVõ€ôQô[YôYT›]J^Y\ë]Kôô[YôYT›]JN¬àô\›‹ôVõ€ôSZ[ôYõÿ⁄‘›]J^Y\ë]KõZ[ôYõÿ⁄‘›]JN¬àÀ»›[€à][\»ù\›ô\›‹ôY[ù»[ùô[ù‹ûXXõ›ôH]ôHõ»USW—Qî¬àÀ»[ùûHY]\»YŸHÿY
USW—Qî»›\ù»[\HŸà[H]ô\ûBàÀ»Ÿ\‹⁄[€ã[õZŸHH›]X»ôXYŸ[ùŸù\õö]\ôKŸö\⁄Xõ\ H8†%ôXùZ[àÀ»XX⁄€ôI‹»\‹^K—ö[ö»Y]Y]H›òZY⁄úõ€H]»Ÿ^K⁄X⁄àÀ»]\õZ[ö\›Xÿ[H[ò€Ÿ\»]»YôôX›»
ŸYH[ú›\ôT›[€í][QYäKÇà⁄[ô›Àê[⁄[^Tﬁ\›[KõZY‹ò]SYÿXﬁT›[€í[ùô[ù‹ûJ[ùô[ù‹ûJN¬àÿöôX›öŸ^\ [ùô[ù‹ûJKôõ‹ëXX⁄
Ÿ^HOà¬à€€ú›^[ÿYH⁄[ô›Àê[⁄[^Tﬁ\›[KôŸ]›[€ëYôôX›—úõ€RŸ^JŸ^JN¬àYà
^[ÿYÀúôX⁄\RY
H⁄[ô›Àê[⁄[^Tﬁ\›[Kô[ú›\ôTôX⁄\R][QYä^[ÿYúôX⁄\RY^[ÿYú›[òﬁUY\äN¬à[ŸHYà
^[ÿYÀõYÿXﬁQYôôX› H⁄[ô›Àê[⁄[^Tﬁ\›[Kô[ú›\ôT›[€í][QYä^[ÿYõYÿXﬁQYôôX› N¬àYà
Ÿ^Kú›\ù’⁄]
	ÿ[⁄[^W‹ôX⁄\W… JH⁄[ô›Àê[⁄[^Tﬁ\›[Kô[ú›\ôTôX⁄\Tÿ‹õ€][QYäŸ^Kú€XŸJ	ÿ[⁄[^W‹ôX⁄\W…Àõ[ô›
JN¬àJN¬ÇàŸX\í[ùô[ù‹ûHH
^Y\ë]KôŸX\í[ùô[ù‹ûH	âà\[Ÿà^Y\ë]KôŸX\í[ùô[ù‹ûHOOH	€ÿöôX›	 Bà»^Y\ë]KôŸX\í[ùô[ù‹ûBààXZŸQYò][ŸX\ä
N¬àYà
YŸX\í[ùô[ù‹ûKù€€ HŸX\í[ùô[ù‹ûKù€€»HﬂN¬àÀ»^\›[ô»⁄\òX›\ú»ôXŸZ]ôHHö\ú›€»ò[ôŸYŸX\€ú»€»BàÀ»ô]»€›\»[[YYX][H\›XõH⁄]›][ùò[Y][ô»€ÿ]ô\ÀÇàŸX\í[ùô[ù‹ûKù€€Àò‹õ‹‹ÿõ›»œœHùYN¬àŸX\í[ùô[ù‹ûKù€€Àúÿÿ]\òõ›»œœHùYN¬àYà
YŸX\í[ùô[ù‹ûKò€›[ô HŸX\í[ùô[ù‹ûKò€›[ô»H»]àù[€Ÿàù[‹ú€Œàù[›ô\ùŸX\éàù[N¬àYà
YŸX\í[ùô[ù‹ûKò⁄\õ\ HŸX\í[ùô[ù‹ûKò⁄\õ\»H◊N¬àYà
YŸX\í[ùô[ù‹ûKù⁄\›\»YŸX\í[ùô[ù‹ûKù⁄\›\Àõ[ô›
H¬àŸX\í[ùô[ù‹ûKù⁄\›\»Hﬁ»Yà	›⁄\›Wÿö[ô€…À‹ôX]\ôRŸ^Nà	ŸXö[ôŸ⁄KZ›[ô	Àò[YNà	–ö[ô€…»WN¬àBàYà
YŸX\í[ùô[ù‹ûKù€€X\›\ûH\[ŸàŸX\í[ùô[ù‹ûKù€€X\›\ûHOOH	€ÿöôX›	 HŸX\í[ùô[ù‹ûKù€€X\›\ûHHﬂN¬àYà
\[ŸàŸX\í[ùô[ù‹ûKõ[›\”Ÿîõ›Ÿ\‹»OOH	€ù[Xô\â HŸX\í[ùô[ù‹ûKõ[›\”Ÿîõ›Ÿ\‹»H¬àŸX\í[ùô[ù‹ûKú‹X⁄X[[[[»HX]õX^
X]õZ[äX]ôõ€‹äù[Xô\äŸX\í[ùô[ù‹ûKú‹X⁄X[[[[ H
JJN¬àYà
YŸX\í[ùô[ù‹ûKúò[ôŸY[[[”ÿY›]»\[ŸàŸX\í[ùô[ù‹ûKúò[ôŸY[[[”ÿY›]»OOH	€ÿöôX›	 HŸX\í[ùô[ù‹ûKúò[ôŸY[[[”ÿY›]»HﬂN¬àYà
P\úò^Kö\–\úò^JŸX\í[ùô[ù‹ûKù[õÿ⁄ŸY‹X⁄X[[[[ JHŸX\í[ùô[ù‹ûKù[õÿ⁄ŸY‹X⁄X[[[[»H◊N¬àõ‹à
€€ú›[[[“YŸà…‹⁄ò\ô[	À	ÿ€€ò›\‹⁄]ôI◊JHYà
YŸX\í[ùô[ù‹ûKù[õÿ⁄ŸY‹X⁄X[[[[Àö[ò€Y\ [[[“Y
JHŸX\í[ùô[ù‹ûKù[õÿ⁄ŸY‹X⁄X[[[[Àú\⁄
[[[“Y
N¬à⁄[ô›Àë\]Z\Y[ù[ô[ô[ú›\ôQŸX\ê€›[ô–€€X›[€ä
N¬à⁄[ô›ÀëYTﬁ\›[Kô[ú›\ôP€€X›[€ä
N¬ÇàÀ»\ú€€ò[›XõH8†%ÿ[YH^ûK\ŸYY]\õà\»H⁄\›\»õÿ⁄»ù\›àÀ»Xõ›ôNàH⁄\òX›\à⁄]õ»›XõHY]Ÿ]»H›\ù\àXö[ôŸ⁄KZ›[ôàÀ»
X]⁄[ô»ŸX\í[ùô[ù‹ûKù⁄\›\…»›\ù\à⁄\›JH€»ùHXö[ôŸ⁄BàÀ»›[ô[›H›\ù⁄]\»›‹ôY[àH›XõHà€»õ‹à€ÿ]ô\»€ÀÇà›XõHH\úò^Kö\–\úò^J^Y\ë]Kú›XõJH»^Y\ë]Kú›XõKõX\
»Oà
»ããú»JJHà◊N¬àX›]ôP€€\[ö[€íYH^Y\ë]KòX›]ôP€€\[ö[€íYœ»ù[¬àX›]ôS[›[ùYH^Y\ë]KòX›]ôS[›[ùYœ»ù[¬àX›]ôT⁄›[\î]YH^Y\ë]KòX›]ôT⁄›[\î]Yœ»ù[¬àYà
\›XõKõ[ô›
H¬à€€ú››\ù\àH»Yà	‹›XõWÿö[ô€…À⁄[ôà	ŸXö[ôŸ⁄KZ›[ô	Àò[YNà	–ö[ô€…ÀŸ[õ›\Nà⁄[ô›Àê‹ôX]\ôQŸ[ô]X‹ÀõXZŸQYò][Ÿ[õ›\J	ŸXö[ôŸ⁄KZ›[ô	 KZU\Nà€€\[ö[€êZU\Qõ‹í⁄[ô
	ŸXö[ôŸ⁄KZ›[ô	 K]ô[à›XõY]à]Kõõ› 
HN¬à›XõKú\⁄
›\ù\äN¬àX›]ôP€€\[ö[€íYH›\ù\ãöY¬àBàYà
XX›]ôP€€\[ö[€íY	âà›XõKõ[ô›
HX›]ôP€€\[ö[€íYH›XõVÃKöY¬àÀ»òX⁄Ÿö[Ÿ[õ›\K[\‹»›XõH[ùöY\»úõ€H€\àÿ]ô\»
KôÀàBàÀ»›\ù\àö[ô€»ÿ]ôYôYõ‹ôH]\õàŸ[ô\»^\›Y
H€»^Hô[ô\ÇàÀ»ôX[Ÿ[ô\»[ú›XYŸàHZ[à[ò€€‹ôY‹ö]Hõ‹ô]ô\ãà[€¬àÀ»òX⁄Ÿö[»HZ\‹⁄[ô»⁄^ôH
Ÿ[õ›\Kú⁄^ôP€\‹ H€à[ùöY\»ÿ]ôYàÀ»ôYõ‹ôHH›XõI‹»[›[ùÿ€€\[ö[€ã‹⁄›[\ã\]ﬁ\›[H^\›YÇàõ‹à
€€ú›[ùûHŸà›XõJH¬àYà
Y[ùûKôŸ[õ›\H	âà
⁄[ô›Àê‹ôX]\ôQŸ[ô]X‹ÀîUTìó—Qî÷Ÿ[ùûKö⁄[ôH[ùûKö⁄[ôOOH	›][Zÿ[⁄ZI JH¬à[ùûKôŸ[õ›\HH⁄[ô›Àê‹ôX]\ôQŸ[ô]X‹ÀõXZŸQYò][Ÿ[õ›\J[ùûKö⁄[ô
N¬àBàYà
[ùûKôŸ[õ›\H	âàY[ùûKôŸ[õ›\Kú⁄^ôP€\‹ H¬à[ùûKôŸ[õ›\Kú⁄^ôP€\‹»H‘ëPUTëW—ñŸ[ùûKö⁄[ôOÀôYò][⁄^ôP€\‹»	€YY][IŒ¬àBàBàÿ]ôT›XõJ
N¬àÀ»ô\›‹ôH⁄X⁄]ô\à]\ò[€€›ŸX\€ã›⁄\›H[ú›[òŸHÿ\»\]Z\YàÀ»[àXX⁄€›\›Ÿ\‹⁄[€à
ŸYHÿ]ôQ\]Z\Y[ù€› H8†%⁄⁄\»[ûH€›àÀ»⁄‹ŸHÿ]ôY][Hõ»€ôŸ\à^\›»[à\»⁄\òX›\â‹»ŸX\í[ùô[ù‹ûBàÀ»
€€€‹›⁄[òŸK‹àHÿ]ôHúõ€HôYõ‹ôH\»öY[^\›Y
K⁄X⁄àÀ»[àò[»õ›Y⁄»H›\ù\ãYŸX\àYò][»ù\›ô[›ÀÇàYà
^Y\ë]Kô\]Z\Y[ù€›»	âà\[Ÿà^Y\ë]Kô\]Z\Y[ù€›»OOH	€ÿöôX›	 H¬àõ‹à
€€ú›‹€›][RYHŸàÿöôX›ô[ùöY\ ^Y\ë]Kô\]Z\Y[ù€› JH¬àYà
Z][RYJ€›[à\]Z\Y[ù€› JH€€ù[ùYN¬à€€ú››[›€ôYH€›OOH	›⁄\›I¬à»ŸX\í[ùô[ù‹ûKù⁄\›\Àú€€YJ»OàÀöYOOH][RY
BààHYŸX\í[ùô[ù‹ûKù€€÷⁄][RYN¬àYà
›[›€ôY
H\]Z\Y[ù€›÷‹€›HH][RY¬àBàBàÀ»Ÿ]Yò][\]Z\Y[ù€›\‹⁄Y€õY[ù¬àYà
ŸX\í[ùô[ù‹ûKù€€ÀöŸW€ò]]ôP€‹\äH\]Z\Y[ù€›ÀöŸHH\]Z\Y[ù€›ÀöŸH	⁄ŸW€ò]]ôP€‹\âŒ¬à[ŸHYà
ŸX\í[ùô[ù‹ûKù€€Àòúõ€ûôZŸJH\]Z\Y[ù€›ÀöŸHH\]Z\Y[ù€›ÀöŸH	ÿúõ€ûôZŸIŒ¬àYà
ŸX\í[ùô[ù‹ûKù€€ÀúX⁄‹⁄›ô[€ò]]ôP€‹\äH\]Z\Y[ù€›Àú⁄›ô[H\]Z\Y[ù€›Àú⁄›ô[	‹X⁄‹⁄›ô[€ò]]ôP€‹\âŒ¬à[ŸHYà
ŸX\í[ùô[ù‹ûKù€€ÀúX⁄‹⁄›ô[
H\]Z\Y[ù€›Àú⁄›ô[H\]Z\Y[ù€›Àú⁄›ô[	‹X⁄‹⁄›ô[	Œ¬àYà
ŸX\í[ùô[ù‹ûKù€€Àö]⁄]€ò]]ôP€‹\äH\]Z\Y[ù€›ÀùŸX\€àH\]Z\Y[ù€›ÀùŸX\€à	⁄]⁄]€ò]]ôP€‹\âŒ¬à[ŸHYà
ŸX\í[ùô[ù‹ûKù€€Àö]⁄]
H\]Z\Y[ù€›ÀùŸX\€àH\]Z\Y[ù€›ÀùŸX\€à	⁄]⁄]	Œ¬àYà
ŸX\í[ùô[ù‹ûKù€€Àò‹õ‹‹ÿõ› H\]Z\Y[ù€›Àúò[ôŸYH\]Z\Y[ù€›Àúò[ôŸY	ÿ‹õ‹‹ÿõ›…Œ¬àYà
ŸX\í[ùô[ù‹ûKù⁄\›\Àõ[ô›
H\]Z\Y[ù€›Àù⁄\›HH\]Z\Y[ù€›Àù⁄\›HŸX\í[ùô[ù‹ûKù⁄\›\÷ÃKöY¬àÀ»H›]ÿŸ[ôHô]öY]…‹»\[Y\ò[õŸö[Hÿ[à[ö\ö]ŸX\í[ùô[ù‹ûBàÀ»
[ô[à[ôXYKY\]Z\Y⁄\›JH›òZY⁄úõ€HHôX[ÿÿ[àÀ»ÿ]ôHöXHÿ‹À⁄[ô^ö[	‹»€òõÿ\ô[ôÀ\õŸö[H[ôŸôã[ôBàÀ»[ôHXõ›ôH]]ÀY\]Z\»H›\ù\à⁄\›Hõ‹à[ûHõŸö[H]àÀ»\»õ€ôH8†%Z]\àÿ^K[à[ö[ùö]Y€€\[ö[€à[ö[X[€›[‹]€ÇàÀ»[ô€€\]Hõ‹àÿ[Y\òHúò[Z[ô»[àHÿŸ[ôHH\ôX›‹àô]ô\ÇàÀ»]]‹ôY€ôHõ‹ãàHÿŸ[ôI‹»›€à‹ôX]\ôHX›‹ú»\ôH[òYôôX›Y¬àÀ»\»€õH€X\ú»HôX[^Y\â‹»›€à€€\[ö[€à€›ÇàYà
⁄[ô›Àó◊⁄ÿù[ööP›]ÿŸ[ôTô]öY] H\]Z\Y[ù€›Àù⁄\›HHù[¬àôXùZ[€€Y\⁄\ 
N¬àÀ»ô\›‹ôHH€€X›X[H[\›Ÿ\‹⁄[€à
ŸYHÿ]ôQ\]Z\Y[ù€› BàÀ»8†%⁄[[ù€»ô]\õö[ô»»Hÿ]ôHŸ\€â›‹HñŸ[X›Yàÿ\›ÇàYà
^Y\ë]KòX›]ôU€€	âà€€X›[€ú÷‹^Y\ë]KòX›]ôU€€JH¬àŸ]X›]ôU€€
^Y\ë]KòX›]ôU€€»⁄[[ùàùYHJN¬àH[ŸH¬àôYúô\⁄ŸX\€î›⁄]⁄ùä
N¬àÿöôX›ùò[Y\ €€Y\⁄X\
Kôõ‹ëXX⁄
HOà»Yà
JH€€€\ãúô[[›ôJJN»JN¬àYà
€€Y\⁄X\ÿX›]ôU€€JH€€€\ãòY
€€Y\⁄X\ÿX›]ôU€€JN¬àBà⁄[ô›Àë\]Z\Y[ù[ô[òùZ[\]Z\Y[ù€› 
N¬àûH¬à]ÿZ]⁄[ô›Àìú–]ò]\îô]öY]Àô[ú›\ôT‹ùòZ]€‹€Y]X‹ ¬à\‹Ÿ]ò\ŸNà	Àãÿ\‹Ÿ]À…Àà€€ôöY–ò\ŸNà	Àãÿ€€ôöYÀ…ÀàJN¬Çà]ÿZ]ôYúô\⁄^Y\ê]ò]\ä
N¬àXùY”Ÿ 	‘ë»[ôH]ò]\à]X⁄Y»^Y\ó‹õ€›	 N¬àHÿ]⁄
\úäH¬à€€ú€€Kùÿ\õä	‹‹]€î^Y\ê]ò]\àòZ[Y€€ù[ùZ[ô»⁄]›]]ò]\éâÀ\úäN¬àBàÀ»ô\›[YH›][àH⁄[\õô\‹À^X›H⁄\ôH\›Ÿ\‹⁄[€àYùŸôãàÀ»Yà]	‹»Ÿ[ùZ[ô[H⁄\ôHH^Y\àÿ\ŒàH⁄[\õô\‹»õ€ôH]àÀ»›[\»\»⁄\òX›\â‹»›€àÿ[\ö\ôH\›Xõ\⁄Y[à]
ŸYBàÀ»ÿ]ôSY[Xô\ï€‹õ]I‹»\›‹⁄][€à[ô⁄[\õô\‹–ÿ[\ö\ôKúô\›‹ôBàÀ»ù\›Xõ›ôJKàõ›[ô»[ŸH\ôH]ô\à[›ô\»H^Y\à]ÿ^Húõ€BàÀ»Hò\õI‹»ö^Yõ€›‹⁄][€ã€»⁄]›]\»H⁄[\õô\‹»ö\àÀ»[ÿ^\»ô\Ÿ]»Hò\õH€àô[ÿY8†%Hÿ[YHôX\€€àHÿ[\ö\ôBàÀ»\ŸY»ôH\›õﬁYYù\›õ‹àX]ö[ô»]»›€àX\à[Xô\ò][BàÀ»ò\úõ›Ÿ\à[àúô\›[YH[û]⁄\ôHéàò\õK››€ã⁄[ù\ö[‹ãÿùZ[[ô»[àÀ»ŸY\‹]€ö[ô»]H\›X[ò\õHYò][⁄[òŸH€õHBàÀ»⁄[\õô\‹À]⁄]X[ãXX›]ôKXÿ[\ÿ\ŸH\»X›X[HôZ[ô»\⁄ŸYõ‹ÇàÀ»\ôK[ôôKY[ù\ö[ô»HùZ[[ôÀÿÿ]ô\õã”î»ÿ⁄Y[H€€ù^úõ€BàÀ»H€€õ€›\»]»›€àôX€€ô][€ú»\»\€â›Ÿ]\»ÿ]\ŸûKÇà€€ú›€\›‹»H^Y\ë]Kõ\›‹⁄][€é¬à€€ú›‹ô\›[YPÿ[\ö\ôHH⁄[ô›Àï⁄[\õô\‹–ÿ[\ö\ôOÀúŸ\öX[^ôOÀä
N¬àYà
€\›‹»	âà⁄\÷õ€ôP\ôXJ€\›‹Àò\ôXJH	âà‹ô\›[YPÿ[\ö\ôOÀõX\YOOH€\›‹Àò\ôXBà	âàù[Xô\ãö\—ö[ö]J€\›‹Àû
H	âàù[Xô\ãö\—ö[ö]J€\›‹ÀûJJH¬à]ÿZ][ù\ñõ€ôJ€\›‹Àò\ôXKX]ôõ€‹ä€\›‹Àû»SJKX]ôõ€‹ä€\›‹ÀûH»SJJN¬àÀ»[ù\ñõ€ôH[ôXYHXŸYH^Y\à]H[HŸ[ù\àŸàBàÀ»€€‹õ›»Xõ›ôH8†%ôYö[ôH»H^X›ÿ]ôY›Xã][H‹⁄][€ã¬àÀ»òX⁄[ô»õ›»]Hõ€ôH
[ô]»ÿ[\ö\ôKöXH[ù\ñõ€ôI‹»›€ÇàÀ»€ñõ€ôQ[ù\ôYÿ[
H\»X›X[Hö[ö\⁄YùZ[[ôÀÇà^Y\ãûH€\›‹Àû»^Y\ãûHH€\›‹ÀûN¬àYà
ù[Xô\ãö\—ö[ö]J€\›‹Àò[ô€JJH»^Y\ãò[ô€HH€\›‹Àò[ô€N»òX⁄[ô–[ô€HH€\›‹Àò[ô€N»Bà‹€ò\ÿ[Y\òU\ôŸ]

N¬àBàÿ[YT›\ùYHùYN¬à⁄[ô›Àó◊⁄ÿù[ööQÿ[YT›\ùYHùYN¬àBÇàÿ›[Y[ùòY]ô[ù\›[ô\ä	⁄ÿù[ööT^Y\îôXYIÀ
JHOà¬à‹^Y\ë]HHKô]Z[¬à‹]€î^Y\ê]ò]\äKô]Z[
N¬àK»€òŸNàùYHJN¬ÇàÀ»Yà[ö]

H[ôXYHö\ôYﬁ[ò⁄õ€õ›\€H
ô]\õö[ô»^Y\à⁄]ÿÿ[›‹òYŸHõŸö[JKàÀ»◊⁄ÿù[ööT^Y\îõŸö[H\»Ÿ]ôYõ‹ôH\»\›[ô\àôY⁄\›\ôY8†%ÿ]⁄]ÿ\ŸKÇàYà
⁄[ô›Àó◊⁄ÿù[ööT^Y\îõŸö[JH¬à‹^Y\ë]HH⁄[ô›Àó◊⁄ÿù[ööT^Y\îõŸö[N¬à‹]€î^Y\ê]ò]\ä⁄[ô›Àó◊⁄ÿù[ööT^Y\îõŸö[JN¬àBÇÇàÀ»8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•dàÀ»›]ÿŸ[ôHô]öY]»[ŸBàÀ»8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• àÀ»õ€›»\»Xà⁄]Hõ›ÿ]ÿ^H⁄\òX›\ã›€‹õ
ŸYHH[õ[ôBàÀ»[ôŸôàÿ‹ö\[à[ô^ö[ù\›ôYõ‹ôHÿ‹ö\‹òœHôÿ[YKöú»èãàÀ»[ôÿ‹À›€€Àÿ›]ÿŸ[ôKY\ôX›‹ã⁄[ô^ö[	‹»îô]öY]»[àÿ[YHÇàÀ»ù]€äH[ú›XYŸàHôX[ÿ]ôK[ôô\^\»[à]]‹ôYàÀ»›]ÿŸ[ôH\⁄[ô»HëPSX[Ÿ›YHRH[ôëPSX[Ÿ›YK^õ€€Hÿ[Y\òBàÀ»ﬁ\›[H8†%õ›H\ôX›‹à€€	‹»›€àö]ò]Hô]öY]ÀÇàÀ¬àÀ»HYôô\ô[òŸ\»úõ€HHõ‹õX[€€ùô\úÿ][€à\ôH[Xô\ò]H[ôàÀ»ò\úõ›À[ô]ôHöY⁄ô^»H€ŸH^H⁄[ôŸNÇàÀ»HôY⁄[ìú—X[Ÿ›YT›Y⁄[ô»»òXŸSú—X[Ÿ›YT\ùX⁄\[ù»¬àÀ»\]Sú—X[Ÿ›YT›Y⁄[ô»
Xõ›ôJHõÀ[‹⁄[ÇàÀ»›]ÿŸ[ôTô]öY]–X›]ôH8†%H\ôX›‹à[ôXYHÿ‹ö\»]ô\ûBàÀ»\ùX⁄\[ù	‹»^X›‹⁄][€ãŸòX⁄[ô»úò[YHûHúò[YK€»BàÀ»ôX[ùÿ[»H^Y\à\»Hî»à]]À\›Y⁄[ô»€›[€õBàÀ»öY⁄][ô\ôHX^Hõ›]ô[àôHHú^Y\àà[[€ô»BàÀ»ÿŸ[ôI‹»X›‹úÀÇàÀ»HYò[òŸSú—X[Ÿ›YH
Xõ›ôJH[Yÿ]\»¬àÀ»›]ÿŸ[ôTô]öY]–Yò[òŸH8†%H\ôX›‹àÿ[‹»]»›€ÇàÀ»[›ôK›[Àÿ⁄⁄XŸKÀããà›YŸH\›õ›[à]]‹ôYX[Ÿ›YUôYKÇàÀ»Hÿ[Y\òKŸX[Ÿ›YK^õ€€H\ôŸ][ô»ô]\Ÿ\»X›]ôPÿ[Y\òU\ôŸ]àÀ»^X›H\»õ‹õX[î»X[Ÿ›YH[ôXYHŸ\»
‹[ìú—X[Ÿ›YBàÀ»Ÿ]»]»ÿ[Ÿ\ãúõ€›
H8†%]	‹»ù\›⁄[ùY]⁄X⁄]ô\ÇàÀ»›]ÿŸ[ôH\ùX⁄\[ù\»›\úô[ùH‹XZ⁄[ô»[ú›XYŸà[ÿ^\¬àÀ»ôZ[ô»ùHî»H^Y\àÿ[ŸY\Ààà]\ôŸ]\»ô]ô\ÇàÀ»HôX[⁄[ô€]€à^Y\ã‹^Y\ìY\⁄]ô[àõ‹àHî^Y\àÇàÀ»õ€HX›‹à[àHÿŸ[ôH8†%]ô\ûHX›‹ã[ò€Y[ô»]€ôK\¬àÀ»‹]€ôY\»]»›€à[ô\[ô[ù›[ôZ[à[ù]H\ôK€»\¬àÀ»ô]öY]Ÿ\àô]ô\àôXY»‹à‹ö]\»HôX[^Y\â‹»‹⁄][€ãÇàÀ»HôX[^Y\à⁄]»^X›H⁄\ô]ô\àZ\àÿ]ôHYù[KàÀ»Ÿôã\ÿ‹ôY[à[ô[ù›X⁄Yõ‹àH⁄€Hô]öY]ÀÇàÀ»8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•d8•dÇà]›]ÿŸ[ôTô]öY]–Yò[òŸHHù[»À»Ÿ]⁄[HH[Àÿ⁄⁄XŸH[ôH\»⁄›⁄[ô¬Çàù[ò›[€à›]ÿŸ[ôTô]öY]–ò[õô\ä^\—\úõ‹äH¬à][Hÿ›[Y[ùôŸ][[Y[ùûRY
	ÿ›]ÿŸ[ôTô]öY]–ò[õô\â N¬àYà
Y[
H¬à[Hÿ›[Y[ùò‹ôX]Q[[Y[ù
	Ÿ]â N¬à[öYH	ÿ›]ÿŸ[ôTô]öY]–ò[õô\âŒ¬à[ú›[Kò‹‹’^H	‹‹⁄][€éôö^Y€YùçL	N›‹åL›ò[úŸõ‹õNùò[ú€]V
ML	JNﬁãZ[ô^éNNNNN…¬à
»	‹Y[ôŒéMúÿõ‹ô\ã\òY]\ŒåLŸõ€ùçåMÃKå»ﬁ\›[K]ZKÿ[úÀ\Ÿ\öYéÿ€€‹éàŸôôé…¬à
»	ÿòX⁄Ÿ‹õ›[ôúôÿòJåMLéäNÿõ‹ô\éåú€€YŸåòçÕMNÿõﬁ\⁄Y›ŒåúNôÿòJç
N…¬à
»	Ÿ\‹^Nôõ^Ÿÿ\åLÿ[Y€ãZ][\ŒòŸ[ù\é‹⁄[ù\ãY]ô[ùŒò]]Œ…Œ¬à€€ú›Xô[Hÿ›[Y[ùò‹ôX]Q[[Y[ù
	‹‹[â N¬àXô[öYH	ÿ›]ÿŸ[ôTô]öY]–ò[õô\ìXô[	Œ¬à[ò\[ô⁄[
Xô[
N¬à€€ú›€‹ŸPùàHÿ›[Y[ùò‹ôX]Q[[Y[ù
	ÿù]€â N¬à€‹ŸPùãù^€€ù[ùH	—^]ô]öY]…Œ¬à€‹ŸPùãú›[Kò‹‹’^H	Ÿõ€ùçåLúﬁ\›[K]ZKÿ[úÀ\Ÿ\öYé‹Y[ôŒçÿõ‹ô\ã\òY]\Œçú…¬à
»	ÿõ‹ô\éå\€€YŸåòçÕMNÿòX⁄Ÿ‹õ›[ôàÃÿLòÃåéÿ€€‹éàŸôôéÿ›\ú€‹éú⁄[ù\é…Œ¬àÀ»HZ[àô[ÿY\»[õ›Y⁄»X]ôHô]öY]»[ŸH€X[õNàBàÀ»[ôŸôàŸ^H\»€ôK\⁄›
[ôXYH€€ú›[YY
H[ôH\[Y\ò[àÀ»õŸö[H€õH]ô\à]ôY[à⁄[ô›Àó◊⁄ÿù[ööT^Y\îõŸö[Kô]ô\ÇàÀ»‹ö][à»HôX[ÿù[ööT^Y\îõŸö[K⁄ÿù[ööTÿ]ôSY]HŸ^\ÀÇà€‹ŸPùãòY]ô[ù\›[ô\ä	ÿ€X⁄…À

HOàÿÿ][€ãúô[ÿY

JN¬à[ò\[ô⁄[
€‹ŸPùäN¬àÿ›[Y[ùòõŸKò\[ô⁄[
[
N¬àBà[ú›[Kòõ‹ô\ê€€‹àH\—\úõ‹à»	»Ÿçòçé	»à	»ŸåòçÕMIŒ¬àÿ›[Y[ùôŸ][[Y[ùûRY
	ÿ›]ÿŸ[ôTô]öY]–ò[õô\ìXô[	 Kù^€€ù[ùH^¬àBÇàù[ò›[€à›]ÿŸ[ôTô]öY]—òYQ[

H¬à][Hÿ›[Y[ùôŸ][[Y[ùûRY
	ÿ›]ÿŸ[ôTô]öY]—òYI N¬àYà
Y[
H¬à[Hÿ›[Y[ùò‹ôX]Q[[Y[ù
	Ÿ]â N¬à[öYH	ÿ›]ÿŸ[ôTô]öY]—òYIŒ¬à[ú›[Kò‹‹’^H	‹‹⁄][€éôö^Y⁄[úŸ]åﬁãZ[ô^éNNNNÿòX⁄Ÿ‹õ›[ôàÃ€‹X⁄]Nå…¬à
»	‹⁄[ù\ãY]ô[ùŒõõ€ôN›ò[ú⁄][€éõ‹X⁄]H\»[ôX\é…Œ¬àÿ›[Y[ùòõŸKò\[ô⁄[
[
N¬àBàô]\õà[¬àBÇà\ﬁ[ò»ù[ò›[€à›]ÿŸ[ôTô]öY]’ÿZ]õ‹ê\ôXJ\ôXK[Y[›]\ÀôYXÿ]JH¬à€€ú›⁄X⁄»HôYXÿ]H


HOàHJÿŸ[ôQõ‹ìú–\ôXJ\ôXJH	âàú—‹öYõ‹ê\ôXJ\ôXJJJN¬à€€ú››\ùH\ôõ‹õX[òŸKõõ› 
N¬à⁄[H
\ôõ‹õX[òŸKõõ› 
HH›\ù[Y[›]\ H¬àYà
⁄X⁄ 
JHô]\õàùYN¬à]ÿZ]ô]»õ€Z\ŸJàOàŸ][Y[›]
ãL
JN¬àBàô]\õàò[ŸN¬àBÇàÀ»ÿÿ[ú»HŸ[ô\ò]Y⁄[\õô\‹»õ€ôI‹»ôX[[H‹öYõ‹àH€X\ãõ]àÀ»Â⁄ôX›[ô€H»õ‹[à]]‹ôYÿŸ[ôI‹»⁄€Hÿÿ[õ€›ö[ù€ù¬àÀ»8†%ÿ[YH[K[]ô[^€\⁄[€à⁄X⁄€\›⁄[\õô\‹À[X\YŸ[ô\ò]‹ãöú…‹¬àÀ»›€à\ôXQúôYK‹ò[ô€QúôYP\ôXH\ŸH
[öYõ‹õH[]ò][€àY\ãõ»[ò€[ôK¬àÀ»ò[\›ÿ]\ã‹€€Y[\ K\»ùZ[[ôÀŸX€‹ãŸù\õö]\ôKŸ[àÿÿ›\[òﬁBàÀ»]]ôH›]⁄YHH[H‹öY]Ÿ[à
ŸYHùZ[õ€ôTÿŸ[ôH¬àÀ»‹‹]€ñõ€ôQX€‹ëù\õö]\ôH»\ôõ‹õU›[⁄Yù	‹»[úÿ
KàŸX\ò⁄\¬àÀ»›]ÿ\ô[à⁄Xû\⁄]àö[ô‹»úõ€HHõ€ôI‹»Ÿ[ù\à€»Hõ›[ô‹›\¬àÀ»ô]ô\àò\ù\àúõ€HHZYHŸàHX\[à]\»»ôKÇàù[ò›[€àö[ôõ€ôTXŸ[Y[ùõ€›ö[ù
\ôXKÀ
H¬à€€ú›öHHﬁõ€ôTÿŸ[ô\ÀôŸ]
\ôXJN¬à€€ú›‹öYHöOÀô‹öY¬àYà
Y‹öY
Hô]\õàù[¬à€€ú›€€»HöKò€€Àõ›‹»HöKúõ›‹Œ¬à€€ú›õ€ôQ]HHﬁõ€ôS^[›]ÀôŸ]
\ôXJN¬à€€ú›ÿÿ›\YYH\úò^Kôúõ€J»[ô›àõ›‹»K

HOàô]»\úò^J€€ Kôö[
ò[ŸJJN¬à€€ú›X\ö”ÿÿ›\YYH
€€õ›À›À⁄
HOà¬àõ‹à
]àHX]õX^
õ› N»àX]õZ[äõ›‹Àõ›»
»⁄
N»ä  Bàõ‹à
]»HX]õX^
€€
N»»X]õZ[ä€€À€€
»› N»   Hÿÿ›\YY‹óVÿ◊HHùYN¬àN¬àõ‹à
€€ú›àŸà
õ€ôQ]OÀòùZ[[ô‹»◊JJHX\ö”ÿÿ›\YY
ãô‹öYãô‹öYàãôõ€›ö[ù»œ»ãù»œ»Kãôõ€›ö[ùœ»ãöœ»JN¬àõ‹à
€€ú›Ÿà
õ€ôQ]OÀô[ú»◊JJHX\ö”ÿÿ›\YY
ûûKù»KöJN¬àõ‹à
€€ú›Ÿà
õ€ôQ]OÀôX€‹à◊JJHX\ö”ÿÿ›\YY
ò€€úõ›ÀKJN¬àõ‹à
€€ú›àŸà
õ€ôQ]OÀôù\õö]\ôH◊JJHX\ö”ÿÿ›\YY
ãò€€ãúõ›ÀKJN¬Çàù[ò›[€àôX›⁄ €€õ› H¬àYà
€€Hõ›»H€€
»»à€€»HHõ›»
»àõ›‹»HJHô]\õàò[ŸN»À»›^HŸôàHõ‹ô\à\úòZ[à⁄⁄\ùà][]ïY\àHù[¬àõ‹à
]àHõ›Œ»àõ›»
»»ä  H¬àõ‹à
]»H€€»»€€
»Œ»   H¬àYà
ÿÿ›\YY‹óVÿ◊JHô]\õàò[ŸN¬à€€ú›[HH‹öY‹óVÿ◊N¬àYà
][JHô]\õàò[ŸN¬àYà
[Kùÿ]\äHô]\õàò[ŸN¬àYà
[Kö[ò€[ôJHô]\õàò[ŸN¬àYà
[Kù\HOOH[U\KîêST
Hô]\õàò[ŸN¬àYà
\‘€€Y
[Kù\JJHô]\õàò[ŸN¬à€€ú›Y\àH[Kô[]ïY\à¬àYà
[]ïY\àOOHù[
H[]ïY\àHY\é¬à[ŸHYà
Y\àOOH[]ïY\äHô]\õàò[ŸN¬àBàBàô]\õàùYN¬àBÇà€€ú›Ÿ[ù\ê€€HX]ôõ€‹ä
€€»H H»äKŸ[ù\îõ›»HX]ôõ€‹ä
õ›‹»H
H»äN¬à€€ú›X^òY]\»HX]õX^
€€Àõ›‹ N¬àõ‹à
]òY]\»H»òY]\»HX^òY]\Œ»òY]\   H¬àõ‹à
]àH\òY]\Œ»àHòY]\Œ»ä  H¬àõ‹à
]»H\òY]\Œ»»HòY]\Œ»   H¬àYà
X]õX^
X]òXú äKX]òXú  JHOOHòY]\ H€€ù[ùYN»À»ö[ô»€õH8†%[ù\ö[‹à[ôXYH⁄X⁄ŸY]€X[\àòYZBà€€ú›€€HŸ[ù\ê€€
»Àõ›»HŸ[ù\îõ›»
»é¬àYà
ôX›⁄ €€õ› JHô]\õà»€€õ›»N¬àBàBàBàô]\õàù[¬àBÇàÀ»úôYYõ‹õH
ò›\›€HäHX›‹úÀ[ô[ûHX›‹à⁄‹ŸHôX[îÀÿ‹ôX]\ôBàÀ»‹]€àòZ[Yò[òX⁄»»HZ[àXŸZ€\àY\⁄8†%ÿ[YBàÀ»‹òXŸYù[YY‹òY][€à€XﬁHH›]ÿŸ[ôH\ôX›‹à€€	‹»›€ÇàÀ»›[ô[€ôHô]öY]»\Ÿ\»õ‹àHÿ[YHÿ\Ÿ\ÀÇàù[ò›[€à›]ÿŸ[ôTô]öY]”XZŸTXŸZ€\äX›‹ã\ôXK\ôŸ]ÿŸ[ôJH¬à€€ú›‹õ›\Hô]»ëQKë‹õ›\

N¬à€€ú›X]Hô]»ëQKìY\⁄[Xô\ùX]\öX[
»€€‹éàX›‹ãò€€‹à	»ÿÿÿÿÿÿ…»JN¬à€€ú›õŸHHô]»ëQKìY\⁄
ô]»ëQKêﬁ[[ô\ëŸ[€Y]ûJåçãåÀéKL
KX]
N¬àõŸKú‹⁄][€ãûHHåé
»éH»é¬à‹õ›\òY
õŸJN¬à€€ú›XYHô]»ëQKìY\⁄
ô]»ëQKî‹\ôQŸ[€Y]ûJååãLãL
KX]
N¬àXYú‹⁄][€ãûHHåé
»éH
»åN¬à‹õ›\òY
XY
N¬à€€ú››\ôñHHú‘›\ôòXŸVJ\ôXKX›‹ãù€‹õÀX›‹ãù€‹õäN¬à‹õ›\ú‹⁄][€ãúŸ]
X›‹ãù€‹õ»
»çK›\ôñKX›‹ãù€‹õà
»çJN¬à‹õ›\úõ›][€ãûHHëQKìX]][ÀôY’‘òY
X›‹ãúõ›][€à
N¬à\ôŸ]ÿŸ[ôKòY
‹õ›\
N¬àô]\õà»⁄[ôà	‹XŸZ€\âÀõ€›à‹õ›\N¬àBÇà€€ú››]ÿŸ[ôTô]öY]–[ô€U›ÿ\ôH
úõ€K HOà


X]ò][åäÀúàHúõ€KúãÀò»Húõ€Kò H
àN»X]îH
»L
H	HÕå
H
»Õå
H	HÕå¬Çàù[ò›[€à›]ÿŸ[ôTô]öY]–\T›]J[ù]K\ôXK›
H¬à€€ú››\ôñHHú‘›\ôòXŸVJ\ôXKX]úõ›[ô
›ò KX]úõ›[ô
›úäJN¬àYà
[ù]Kö⁄[ôOOH	ÿ‹ôX]\ôI H¬à€€ú›»H[ù]Kò‹ôX]\ôN¬àÀûH›ò»
àSN»ÀûHH›úà
àSN¬àÀò]ò]\îôYãô‹õ›\ú‹⁄][€ãúŸ]
›ò»
»çK›\ôñH
»
Àô‹õ›[ôYùœ»Àö[íZY⁄
K›úà
»çJN¬àÀò]ò]\îôYãô‹õ›\úõ›][€ãûHHëQKìX]][ÀôY’‘òY
›úõ›][€äN¬àÀ»ŸYY»‹õ›\õ›‹ô‘õ›»X]⁄€»›]ÿŸ[ôTõ›][€ïX⁄…‹»ö\ú›àÀ»ôX[X⁄»
ŸYHô[› H›\ù»[à[ô€QYôàŸà^X›H[ú›XYàÀ»Ÿà€[€›H›ŸY\[ô»[àúõ€H⁄\ô]ô\àXZŸP‹ôX]\ôQ[ù]I‹¬àÀ»‹õ›\õ›åYò][Yù[KÇàÀô‹õ›\õ›HÀúô‘õ›HëQKìX]][ÀôY’‘òY
›úõ›][€äN¬àÀô‹õ›[ô⁄Y›œÀú‹⁄][€ãúŸ]
›ò»
»çK›\ôñH
»⁄\òX›\ë‹õ›[ô⁄Y›‘›\ôòXŸSŸôúŸ]

K›úà
»çJN¬àÀò]ò]\îôYãô‹õ›\úÿÿ[KúŸ]ÿÿ[\ä›ú‹ŸHOOH	‹õ€ôI»»çààJN¬àH[ŸHYà
[ù]Kö⁄[ôOOH	€ú… H¬à[ù]Kùÿ[Ÿ\ãúõ›HëQKìX]][ÀôY’‘òY
›úõ›][€äN¬à[ù]Kúõ€›ú‹⁄][€ãúŸ]
›ò»
»çK›\ôñK›úà
»çJN¬à[ù]Kúõ€›úõ›][€ãûHH[ù]Kùÿ[Ÿ\ãúõ›¬à[ù]Kúõ€›úÿÿ[KúŸ]ÿÿ[\äJN¬àÀ»õ€ôH\»Hõ]‹ùòZ][ôH›€à€ù»]»òX⁄»[ú›XYŸÇàÀ»ù\›⁄ö[ö⁄[ô»H›[ô[ô»öY›\ôH8†%\»ÿ[Ÿ\à\»ÿ‹ö\YàÀ»[ù\ô[HûHH\ôX›‹à
]\ŸNí[ôö[ö]KŸYHHX›‹ã\‹]€ÇàÀ»€‹
H[ôô]ô\àX[Ÿ›YK\›YŸY
›X\ôYûH›]ÿŸ[ôTô]öY]–X›]ôBàÀ»[àôY⁄[ìú—X[Ÿ›YT›Y⁄[ôÀŸòXŸSú—X[Ÿ›YT\ùX⁄\[ù K€¬àÀ»õ›[ô»[ŸHôKX\‹Ÿ\ù»H›[ô[ô»ò[úŸõ‹õH›ô\à\»‹ŸKÇà€€ú›]ò]\ë‹õ›\H[ù]Kùÿ[Ÿ\ãò]ò]\ë‹õ›\¬àYà
]ò]\ë‹õ›\
H¬à€€ú›]ò]\íZY⁄H]ò]\ë‹õ›\ù\Ÿ\ë]OÀú‹ùòZ][Ÿ[ZY⁄N¬àYà
›ú‹ŸHOOH	‹õ€ôI H¬à]ò]\ë‹õ›\úõ›][€ãûHX]îH»é¬à]ò]\ë‹õ›\ú‹⁄][€ãûHH]ò]\íZY⁄
àåé¬àH[ŸH¬à]ò]\ë‹õ›\úõ›][€ãûH¬à]ò]\ë‹õ›\ú‹⁄][€ãûHH]ò]\íZY⁄»é¬àBàBàH[ŸH¬à[ù]Kúõ€›ú‹⁄][€ãúŸ]
›ò»
»çK›\ôñK›úà
»çJN¬à[ù]Kúõ€›úõ›][€ãûHHëQKìX]][ÀôY’‘òY
›úõ›][€äN¬à[ù]Kúõ€›úÿÿ[KúŸ]ÿÿ[\ä›ú‹ŸHOOH	‹õ€ôI»»çààJN¬àBàBÇà\ﬁ[ò»ù[ò›[€àù[ê›]ÿŸ[ôTô]öY] ^[ÿY
H¬à›]ÿŸ[ôTô]öY]–X›]ôHHùYN¬à›]ÿŸ[ôTô]öY]÷õ€€T\òŸ[ùHL¬à›]ÿŸ[ôTô]öY]–ò[õô\ä<'„´	‹^[ÿYù]H	–›]ÿŸ[ôHô]öY]…ﬂH8†%ÿY[ô¯†)òò[ŸJN¬Çà€€ú›\ôXHHõ‹õX[^ôSú–\ôXJ^[ÿYõX\Y
N¬àYà
⁄\–ùZ[[ô–\ôXJ\ôXJJH¬àûH»]ÿZ]ÿYùZ[[ô‘ÿŸ[ôJ\ôXJN»Hÿ]⁄
JH»€€ú€€Kô\úõ‹äJN»BàH[ŸHYà
\ôXHOOH	››€â»	âà]›€îÿŸ[ôJH¬àÀ»H›€â‹»[K‹õ›]H]HÿY»]]€X]Xÿ[H]õ€›àÀ»
€ÿY›€ëúõ€U€‹ö‹‹XŸH8°§à[ö]›€ïò]ô[
Kù]HX›X[—àÀ»ÿŸ[ôH
ùZ[›€îÿŸ[ôK⁄X⁄Ÿ]»›€îÿŸ[ôX
H\»õ‹õX[H€õBàÀ»ùZ[^ö[HH[€Y[ùH^Y\àö\ú›ÿ[‹»[àúõ€HHò\õBàÀ»
[ù\ï›€äKà[ù\ï›€ä
H[€»Ÿ\»[ô‹»\»ô]öY]Ÿ\à]\›àÀ»ô]ô\à»»HôX[^Y\à
[›ô\»^Y\ãûﬁK›[\¬àÀ»ò\õT^Y\îÿ]ôKõ\»›\úô[ù\ôXJH8†%ùZ[›€îÿŸ[ôJ
H]Ÿ[à\¬àÀ»H›[ô[€ôK^Y\ã][ù›X⁄Y[àŸà]€»]	‹»ÿ[YàÀ»\ôX›H\ôH[ú›XYŸà[ù\ï›€ä
KÇàûH¬àYà
]›€ë‹öY
H]ÿZ]›]ÿŸ[ôTô]öY]’ÿZ]õ‹ê\ôXJ	◊◊››€ë‹öY◊…ÀML

HOàH]›€ë‹öY
N¬àùZ[›€îÿŸ[ôJ
N¬àHÿ]⁄
JH»€€ú€€Kô\úõ‹ä	÷ÿ›]ÿŸ[ôHô]öY]◊HùZ[›€îÿŸ[ôHòZ[YâÀJN»BàH[ŸHYà
^[ÿYù⁄[\õô\‹»	âà⁄\÷õ€ôP\ôXJ\ôXJJH¬àÀ»H⁄[\õô\‹»õ€ôI‹»ôX[\úòZ[àŸ\€â›^\›[ù[HYX\õBàÀ»›[⁄YùŸ[ô\ò]\»]
\ôõ‹õU›[⁄Yù⁄X⁄ŸYŸôà]àÀ»€‹õõ€›ûH⁄X⁄’›[⁄Yù
H8†%ÿZ]õ‹à]»ö[ö\⁄[ÇàÀ»ùZ[Hõ€ôI‹»—ÿŸ[ôH[ôÿÿ[à]»X›X[[H‹öYõ‹àBàÀ»€X\ãõ]‹›»õ‹\»ÿŸ[ôI‹»⁄€Hÿÿ[õ€›ö[ù€ù¬àÀ»
ö[ôõ€ôTXŸ[Y[ùõ€›ö[ù
KàH\ôX›‹àŸ[ô»]ô\ûH⁄[ù¬àÀ»X›‹ãÿÿ[Y\òH‹⁄][€à[àÿÿ[[ãX[ò⁄‹ôY€€‹ô[ò]\»õ‹à\¬àÀ»[ŸH
ŸYHùZ[ô]öY]‘^[ÿY
HôX⁄\Ÿ[HôXÿ]\ŸH][ò⁄‹à8†%àÀ»⁄X⁄X\[ô⁄\ôH€à]8†%ÿ[à€õHôHô\€€ôY\ôKYÿZ[ú›àÀ»ôX[Ÿ[ô\ò]Y\úòZ[ãõ›]]‹ôYZXYŸà[YKÇàûH¬àYà
››[⁄Yùõ€Z\ŸJH]ÿZ]››[⁄Yùõ€Z\ŸN¬àYà
Wﬁõ€ôS^[›]Àö\ \ôXJJH¬à⁄X⁄’›[⁄Yù

N¬à]ÿZ]›]ÿŸ[ôTô]öY]’ÿZ]õ‹ê\ôXJ\ôXKå

HOàﬁõ€ôS^[›]Àö\ \ôXJJN¬àBàùZ[õ€ôTÿŸ[ôJ\ôXJN¬à€€ú›úH^[ÿYôõ€›ö[ùﬂN¬à€€ú›ù»HX]õX^
KX]òŸZ[
úù»äJKöHX]õX^
KX]òŸZ[
úöäJN¬à€€ú›[ò⁄‹àHö[ôõ€ôTXŸ[Y[ùõ€›ö[ù
\ôXKùÀö
N¬àYà
X[ò⁄‹äH¬à›]ÿŸ[ôTô]öY]–ò[õô\ä€›[õ›ö[ôH€X\à	ŸùﬂpÂ…ŸöH‹›õ‹à\»ÿŸ[ôH€àâ‹^[ÿYõX\YHãòùYJN¬à›]ÿŸ[ôTô]öY]–X›]ôHHò[ŸN¬àô]\õé¬àBà€€ú›ŸôúŸ]»H[ò⁄‹ãò€€H
úõ‹öY⁄[ê»
KŸôúŸ]àH[ò⁄‹ãúõ›»H
úõ‹öY⁄[îà
N¬àõ‹à
€€ú›HŸà
^[ÿYòX›‹ú»◊JJH¬àKù€‹õ»H
Kõ»
H
»ŸôúŸ]Œ¬àKù€‹õàH
Kõà
H
»ŸôúŸ]é¬àBàõ‹à
€€ú›»Ÿà
^[ÿYú›YŸ\»◊JJH¬àYà
Àù\HOOH	€[›ôI»	âàÀù\ôŸ]ÿÿ[
HÀù\ôŸ]€‹õH»ŒàÀù\ôŸ]ÿÿ[õ»
»ŸôúŸ]ÀéàÀù\ôŸ]ÿÿ[õà
»ŸôúŸ]ãòX⁄[ôŒàÀù\ôŸ]ÿÿ[ôòX⁄[ô»œ»ù[N¬àBàYà
^[ÿYòÿ[Y\òLŸÀõÿÿ[‹»	âà^[ÿYòÿ[Y\òLŸÀõÿÿ[\ôŸ]
H¬àÀ»ÿÿ[‹ÀûK€ÿÿ[\ôŸ]ûHŸ\ôH]]‹ôYYÿZ[ú›H\ôX›‹â‹¬àÀ»õ]OL⁄[\õô\‹»òX›XŸH‹öY
‹õ›[ôP]ô]\õú»õ‹ÇàÀ»X\Y]Kö⁄[ôOOHù⁄[\õô\‹»à8†%\ôI‹»õ»ôX[[]ò][€à¬àÀ»]]‹àYÿZ[ú›Y]
H8†%YHëPS\úòZ[â‹»[]ò][€à]àÀ»⁄\ô]ô\àHò[ú€]Yÿ[Y\òK›\ôŸ]X›X[H[ô‹àBàÀ»öY»⁄]»]H‹õ€ô»ZY⁄H[ú›[ùH[ò⁄‹à[ô¬àÀ»[û]⁄\ôHù]Hô\õÀY[]ò][€à[H
X›‹ú»€â›]ôH\¬àÀ»ùY»8†%Z\àH\»€€\]Yúô\⁄úõ€HHôX[\úòZ[à]àÀ»‹]€à[YK€õHHÿ[Y\òLŸõÿ⁄»⁄⁄\Y]
KÇà€€ú›‹÷H^[ÿYòÿ[Y\òLŸõÿÿ[‹Àû
»ŸôúŸ]À‹÷àH^[ÿYòÿ[Y\òLŸõÿÿ[‹Àûà
»ŸôúŸ]é¬à€€ú›\ôŸ]H^[ÿYòÿ[Y\òLŸõÿÿ[\ôŸ]û
»ŸôúŸ]À\ôŸ]àH^[ÿYòÿ[Y\òLŸõÿÿ[\ôŸ]ûà
»ŸôúŸ]é¬à€€ú›‹—[]ñHHú‘›\ôòXŸVJ\ôXKX]úõ›[ô
‹÷
KX]úõ›[ô
‹÷äJN¬à€€ú›\ôŸ][]ñHHú‘›\ôòXŸVJ\ôXKX]úõ›[ô
\ôŸ]
KX]úõ›[ô
\ôŸ]äJN¬à^[ÿYòÿ[Y\òLŸù€‹õ‹»H»à‹÷Nà^[ÿYòÿ[Y\òLŸõÿÿ[‹ÀûH
»‹—[]ñKéà‹÷àN¬à^[ÿYòÿ[Y\òLŸù€‹õ\ôŸ]H»à\ôŸ]Nà^[ÿYòÿ[Y\òLŸõÿÿ[\ôŸ]ûH
»\ôŸ][]ñKéà\ôŸ]àN¬àBàXùY”Ÿ ÿ›]ÿŸ[ôHô]öY]◊H⁄[\õô\‹»XŸ[Y[ùà	‹^[ÿYõX\YHõ€›ö[ù	Ÿùﬂ^	ŸöH[ò⁄‹ôY]
	ÿ[ò⁄‹ãò€€K	ÿ[ò⁄‹ãúõ›ﬂJX
N¬àHÿ]⁄
JH»€€ú€€Kô\úõ‹ä	÷ÿ›]ÿŸ[ôHô]öY]◊H⁄[\õô\‹»õ€ôHXŸ[Y[ùòZ[YâÀJN»BàBà€€ú›ôXYHH]ÿZ]›]ÿŸ[ôTô]öY]’ÿZ]õ‹ê\ôXJ\ôXKå
N¬àYà
\ôXYJH¬à›]ÿŸ[ôTô]öY]–ò[õô\ä€›[õ›ÿYX\â‹^[ÿYõX\YHàõ‹àô]öY]ÀòùYJN¬à›]ÿŸ[ôTô]öY]–X›]ôHHò[ŸN¬àô]\õé¬àBà›\úô[ù\ôXHH\ôXN»À»›⁄]⁄\»H⁄€Hÿ[YI‹»ô[ô\ãÿX›]ôK\ÿŸ[ôH\ôŸ]»H›]ÿŸ[ôI‹»X\ÇàÀ»⁄]›]\Àî»]ò]\ú»⁄[[ùHò[òX⁄»»XŸZ€\ÇàÀ»ÿ\›[\ŒàùZ[õŸö[Qúõ€Sú—^‹ù
úÀX]ò]\ã\ô]öY]À]][Àöú BàÀ»ô]\õú»ù[⁄[ô]ô\à]»[Ÿ[K[]ô[€‹€Y]X‹»ÿX⁄H\€â›àÀ»ÿYYY]à‹]€î^Y\ê]ò]\â‹»›€àõ€›][YHÿ[
ÿ[YKöú¬àÀ»åNN HòXŸ\»\»ù[ò›[€àò]\à[àô[XXõHôX][ô»]€¬àÀ»\»ÿZ]»€àHÿ[YH⁄\ôYÿX⁄K‹õ€Z\ŸH^X⁄]KÇà]ÿZ]⁄[ô›Àìú–]ò]\îô]öY]Àô[ú›\ôT‹ùòZ]€‹€Y]X‹ »\‹Ÿ]ò\ŸNà	Àãÿ\‹Ÿ]À…À€€ôöY–ò\ŸNà	Àãÿ€€ôöYÀ…»JN¬Çà€€ú›\ôŸ]ÿŸ[ôHHÿŸ[ôQõ‹ìú–\ôXJ\ôXJN¬à€€ú›\ôŸ]‹öYHú—‹öYõ‹ê\ôXJ\ôXJN¬à€€ú›\ôŸ]€€»HŸ]X›]ôP€€ 
N¬à€€ú›\ôŸ]õ›‹»HŸ]X›]ôTõ›‹ 
N¬ÇàÀ»8• 8• ÿ[Y\òNà[àô\›Xõ\⁄[ô»à[ŸHõ‹à]ô\û][ô»^Ÿ\X›]ôBàÀ»X[Ÿ›YK€€\]Yúõ€HH\ôX›‹â‹»ÿ\\ôY⁄›
[ôXYBàÀ»ô\€€ôY»€‹õ[K\‹XŸJHöXHHÿ[YBàÀ»\›[òŸKÿ[ô€Qúõ€Q‹õ›[ôYÀÿ^ö[]]Y»ò\⁄\»HôX[ö\⁄[ô¬àÀ»Z[öYÿ[YI‹»ÿ[Y\òK[[ŸH›ÿ\\Ÿ\»
ŸYH\]Pÿ[Y\òT‹⁄][€äKÇàÀ»Ÿ]\ôYõ‹ôHX›‹ú»‹]€à
ò]\à[àYù\ãúõ€HZ\ÇàÀ»[ù]Y\ H€»ÿ[Y\òKú‹⁄][€à\»[ôXYH€‹úôX›[à[YHõ‹ÇàÀ»XX⁄îÀ‹^Y\àX›‹â‹»[ö]X[‹]€àòX⁄[ô»»⁄X⁄»]Ÿ[ÇàÀ»YÿZ[ú›]
ŸYH›]ÿŸ[ôTô]öY]”ú—òX⁄[ô–⁄X][ô€Hô[› KÇà€€ú›ò\ŸQ–Ÿô»Hÿ[Y\òS[ŸP€€ôöY ÿ[Y\òP€€ôöY 
KôX[Ÿ›YS[ŸH	€ú—X[Ÿ›YI N¬à€€ú›”[ŸRŸ^HH	ÿ›]ÿŸ[ôTô]öY]—X[Ÿ›YIŒ¬à
⁄[ô›Àî–‘êU“ì”ëT◊–””ëíQÀôÿ[YKòÿ[Y\òKõ[Ÿ\»HﬂJVŸ”[ŸRŸ^WHH¬àããòò\ŸQ–ŸôÀàÀ»ôX[ÿ[Y\^I‹»[Y€ï—X[Ÿ›YT‹ùòZ]Ÿ[ù\ú»\ô€Ÿ\»BàÀ»X›X[^Y\àY\⁄\»€ôHŸà]»€»úò[Z[ô»[ò⁄‹úÀ⁄X⁄\¬àÀ»YX[ö[ô€\‹»\ôH
ôZ]\à›]ÿŸ[ôH‹XZŸ\à\»]ô\àHôX[àÀ»^Y\äH8†%ù]H[Y€õY[ù]Ÿ[à
[à^YK[]ô[⁄›[õôY¬àÀ»H‹XZŸ\â‹»›€àö\›X[Ÿ[ù\ãõ›HŸ[ô\öX»[]ò]YàÀ»õ€›ÀXÿ[Y\òI‹»⁄[ä[ô€JJô\›[òŸH€[XàXõ›ôH]
H\»^X›BàÀ»⁄]H›]ÿŸ[ôH€‹ŸK]\ÿ[ù»€À€»\»›^\»€à[ôàÀ»X[Ÿ›YT‹ùòZ]ÿ[Y\òPZ[H›Xú›]]\»H‹XZ⁄[ô»X›‹â‹»›€ÇàÀ»Ÿ[ù\à
ŸYH›]ÿŸ[ôTô]öY]‘‹XZŸ\êŸ[ù\ñJH[ú›XYŸà^Y\ìY\⁄àÀ»⁄[ô]ô\à›]ÿŸ[ôTô]öY]–X›]ôH\»Ÿ]Çà[Y€ï—X[Ÿ›YT‹ùòZ]Ÿ[ù\úŒàùYKàN¬àÀ»H‹ôX]\ôI‹»õ€›‹⁄][€à
]ò]\îôYãô‹õ›\
H[ôXYH⁄]»]]¬àÀ»›€àõŸKXŸ[ù\àZY⁄
ŸYHXZŸP‹ôX]\ôQ[ù]K›\]P‹ôX]\ôSY\⁄
KàÀ»[õZŸH[àî»ÿ[Ÿ\â‹»õ€›⁄X⁄⁄]»]‹õ›[ô]ô[8†%€»BàÀ»[X[ãX⁄\›ZZY⁄\ôŸ]SŸôúŸ][\»ú—X[Ÿ›YH[ô\»õ‹ÇàÀ»›ô\ú⁄€›»ÿ^HXõ›ôHH›À\€[ô»‹ôX]\ôHZŸHH€€ãà\¬àÀ»ò\öX[ù€⁄‹»€õH€Y⁄HXõ›ôHH‹ôX]\ôI‹»›€àŸ[ù\à[ôàÀ»⁄]»›Ÿ\ãÿ€‹Ÿ\à€»]›[ôXY»\»Hõ‹\à€‹ŸK]\Çà€€ú›”[ŸRŸ^P‹ôX]\ôHH	ÿ›]ÿŸ[ôTô]öY]—X[Ÿ›YP‹ôX]\ôIŒ¬à⁄[ô›Àî–‘êU“ì”ëT◊–””ëíQÀôÿ[YKòÿ[Y\òKõ[Ÿ\÷Ÿ”[ŸRŸ^P‹ôX]\ôWHH¬àããòò\ŸQ–ŸôÀàÀ»[€»[õôY»H‹XZŸ\â‹»›€àŸ[ù\à
ÿ[Y\òVK€€⁄÷H€€YHúõ€BàÀ»X[Ÿ›YT‹ùòZ]ÿ[Y\òPZ[Kõ›\ôŸ]SŸôúŸ][\Àÿ[ô€Hô[› H8†%àÀ»[ô€Qúõ€Q‹õ›[ôYÀŸ\›[òŸU[\»›[⁄\HH‹ö^õ€ù[àÀ»úò[Z[ô»
^ö[]]\›[òŸK⁄ZY⁄[Ÿã\⁄›ôY[
Kù\›õ»€ôŸ\ÇàÀ»Hô\ùXÿ[€[XãÇà[Y€ï—X[Ÿ›YT‹ùòZ]Ÿ[ù\úŒàùYKà\ôŸ]SŸôúŸ][\Œàåà[ô€Qúõ€Q‹õ›[ôYŒàX]õZ[äò\ŸQ–ŸôÀò[ô€Qúõ€Q‹õ›[ôY»œ»LççäKà\›[òŸU[\Œà
ò\ŸQ–ŸôÀô\›[òŸU[\»œ»çç H
àçŒàN¬Çà]YPÿ[Y\òS[ŸKYPÿ[Y\òU\ôŸ]¬àYà
^[ÿYòÿ[Y\òLŸ
H¬à€€ú›H^[ÿYòÿ[Y\òLŸù€‹õ‹ÀH^[ÿYòÿ[Y\òLŸù€‹õ\ôŸ]¬à€€ú›HûHûHHûHHûKàHûàHûé¬à€€ú›\›[òŸHHX]õX^
çKX]ö\›
KäJN¬à€€ú›[ô€Qúõ€Q‹õ›[ôY»HX]ò\⁄[ä€[\
H»\›[òŸKLKJJH
àN»X]îN¬à€€ú›^ö[]]Y»HX]ò][åääH
àN»X]îN¬à€€ú›⁄›[ŸRŸ^HH	ÿ›]ÿŸ[ôTô]öY]‘⁄›	Œ¬à⁄[ô›Àî–‘êU“ì”ëT◊–””ëíQÀôÿ[YKòÿ[Y\òKõ[Ÿ\÷‹⁄›[ŸRŸ^WHH»\›[òŸU[\Œà\›[òŸK[ô€Qúõ€Q‹õ›[ôYÀ^ö[]]YÀõ›ëYŒàãõ€›”\úàK\ôŸ]SŸôúŸ][\ŒàN¬àYPÿ[Y\òS[ŸHH⁄›[ŸRŸ^N¬àYPÿ[Y\òU\ôŸ]H»‹⁄][€éàô]»ëQKïôX›‹å ûûKûäHN¬àÿ[U\ôŸ]Hû»ÿ[U\ôŸ]HHûN»ÿ[U\ôŸ]àHûé»À»[ú›[ù›]õ›H€›»\ú[àúõ€HHò\õH‹]€ÇàH[ŸH¬à€€ú›ö\ú›X›‹àH
^[ÿYòX›‹ú»◊JVÃN¬àYPÿ[Y\òS[ŸHHÿ[Y\òP€€ôöY 
KôYò][[ŸH	ŸYò][	Œ¬àYà
ö\ú›X›‹äH¬à€€ú›ûHö\ú›X›‹ãù€‹õ»
»çKûàHö\ú›X›‹ãù€‹õà
»çKûHHú‘›\ôòXŸVJ\ôXKö\ú›X›‹ãù€‹õÀö\ú›X›‹ãù€‹õäN¬àYPÿ[Y\òU\ôŸ]H»‹⁄][€éàô]»ëQKïôX›‹å ûûKûäHN¬àÿ[U\ôŸ]Hû»ÿ[U\ôŸ]HHûN»ÿ[U\ôŸ]àHûé¬àH[ŸH¬àYPÿ[Y\òU\ôŸ]Hù[¬àBàBàX›]ôPÿ[Y\òS[ŸHHYPÿ[Y\òS[ŸN¬àX›]ôPÿ[Y\òU\ôŸ]HYPÿ[Y\òU\ôŸ]¬à\]Pÿ[Y\òT‹⁄][€ä
N¬Çà€€ú›[ù]Y\»Hô]»X\

N»À»X›‹íYOà»⁄[ôâ€ú…ﬂ	ÿ‹ôX]\ôIﬂ	‹XŸZ€\âÀõ€›ããàBàõ‹à
€€ú›X›‹àŸà
^[ÿYòX›‹ú»◊JJH¬à][ù]HHù[¬àûH¬àYà
X›‹ãõú“Y	âàX›‹ãõú‘ôX€‹ô
H¬à€€ú›ÿ[Ÿ\àH]ÿZ]XZŸSú’ÿ[Ÿ\äX›‹ãõú‘ôX€‹ô»\ôXKŒàX›‹ãù€‹õÀéàX›‹ãù€‹õàJN¬àYà
ÿ[Ÿ\äH¬àÿ[Ÿ\ãúõ›HëQKìX]][ÀôY’‘òY
X›‹ãúõ›][€à
N»À»€‹úôX›Yô[›»€òŸHX›‹î›]\Àÿ\T›]H^\›8†%ŸYHH[ö]X[\‹ŸH\‹»ôYõ‹ôHù[î›YŸBàÿ[Ÿ\ãúõ€›úõ›][€ãûHHÿ[Ÿ\ãúõ›¬àÿ[Ÿ\ãú]\ŸHH[ôö[ö]N»À»ÿ‹ö\Y[ù\ô[HûHH\ôX›‹àô[›»8†%ô]ô\àHYK›ÿ[ô\àRBà[ù]HH»⁄[ôà	€ú…Àõ€›àÿ[Ÿ\ãúõ€›ÿ[Ÿ\ãôXŒàX›‹ãõú‘ôX€‹ôõŸö[Nàÿ[Ÿ\ãúõŸö[K]ò]\ëúõ€ùÿ[ùò\Œàÿ[Ÿ\ãò]ò]\ëúõ€ùÿ[ùò\À]ò]\êòX⁄–ÿ[ùò\Œàÿ[Ÿ\ãò]ò]\êòX⁄–ÿ[ùò\»N¬àBàH[ŸHYà
X›‹ãò‹ôX]\ôU\RY	âà‘ëPUTëW—ñÿX›‹ãò‹ôX]\ôU\RYJH¬àÀ»XZŸP‹ôX]\ôQ[ù]I‹»‹õ›[ôZZY⁄€⁄›\ôXY»H€ÿò[àÀ»›\úô[ù\ôXX\ôX›Hò]\à[àZ⁄[ô»]\»[à‹[€ãàÀ»€»]	‹»õ€⁄Ÿ[ôY\ôH]ô[à›Y⁄›\úô[ù\ôXH[ôXYBàÀ»\]X[»\ôXXûH\»⁄[ù
Ÿ\^X⁄]ŸYô[ú⁄]ôH[ÇàÀ»ÿ\ŸH]\‹⁄Y€õY[ùXõ›ôH]ô\à[›ô\ KÇà€€ú›ÿ]ôY\ôXHH›\úô[ù\ôXN¬à›\úô[ù\ôXHH\ôXN¬à€€ú›‹ôX]\ôHHXZŸP‹ôX]\ôQ[ù]JX›‹ãò‹ôX]\ôU\RY
X›‹ãù€‹õ»
»çJH
àSK
X›‹ãù€‹õà
»çJH
àSK»ÿŸ[ôNà\ôŸ]ÿŸ[ôK‹öYà\ôŸ]‹öY€€Œà\ôŸ]€€Àõ›‹Œà\ôŸ]õ›‹»JN¬à›\úô[ù\ôXHHÿ]ôY\ôXN¬àYà
‹ôX]\ôJH¬à‹ôX]\ôKò]ò]\îôYãô‹õ›\úõ›][€ãûHHëQKìX]][ÀôY’‘òY
X›‹ãúõ›][€à
N¬à[ù]HH»⁄[ôà	ÿ‹ôX]\ôIÀõ€›à‹ôX]\ôKò]ò]\îôYãô‹õ›\‹ôX]\ôHN¬àBàH[ŸHYà
X›‹ãö\‘^Y\äH¬àÀ»HÿŸ[ôI‹»]]‹ôY›[ôZ[àõ‹à⁄Ÿ]ô\â‹»X›X[Hù[õö[ô¬àÀ»\»ô]öY]»8†%ùZ[õ›Y⁄H^X›ÿ[YHXZŸSú’ÿ[Ÿ\ÇàÀ»\[[ôH[àî»X›‹à\Ÿ\Àù\›ôYHﬁ[ù]X»úôX€‹ôÇàÀ»€›\òŸYúõ€HHôX[^Y\â‹»›€à\X\ò[òŸH[ú›XYŸàBàÀ»î»]Xò\ŸK€»]Ÿ]»HôX[ëÀ\[ôH]ò]\à[ú›XYŸÇàÀ»HŸ[ô\öX»XŸZ€\à]ô\ûH›\àúôYYõ‹õHX›‹àò[¬àÀ»òX⁄»ÀÇà€€ú›^Y\îõŸö[HH‹^Y\ë]H⁄[ô›Àó◊⁄ÿù[ööT^Y\îõŸö[N¬à€€ú›òZŸTôX»H¬àYà	‹^Y\âÀò[YNàX›‹ãõò[YH	‘^Y\âÀà\X\ò[òŸNà^Y\îõŸö[OÀò\X\ò[òŸKà\]Z\Y€‹€Y]X‹Œà^Y\îõŸö[OÀô\]Z\Y€‹€Y]X‹»◊Kà\YYY\Œà^Y\îõŸö[OÀò\YYY\»ﬂKàN¬à€€ú›ÿ[Ÿ\àH]ÿZ]XZŸSú’ÿ[Ÿ\äòZŸTôXÀ»\ôXKŒàX›‹ãù€‹õÀéàX›‹ãù€‹õàJN¬àYà
ÿ[Ÿ\äH¬àÿ[Ÿ\ãúõ›HëQKìX]][ÀôY’‘òY
X›‹ãúõ›][€à
N»À»€‹úôX›Yô[›»€òŸHX›‹î›]\Àÿ\T›]H^\›8†%ŸYHH[ö]X[\‹ŸH\‹»ôYõ‹ôHù[î›YŸBàÿ[Ÿ\ãúõ€›úõ›][€ãûHHÿ[Ÿ\ãúõ›¬àÿ[Ÿ\ãú]\ŸHH[ôö[ö]N¬à[ù]HH»⁄[ôà	€ú…Àõ€›àÿ[Ÿ\ãúõ€›ÿ[Ÿ\ãôXŒàòZŸTôXÀõŸö[Nàÿ[Ÿ\ãúõŸö[K]ò]\ëúõ€ùÿ[ùò\Œàÿ[Ÿ\ãò]ò]\ëúõ€ùÿ[ùò\À]ò]\êòX⁄–ÿ[ùò\Œàÿ[Ÿ\ãò]ò]\êòX⁄–ÿ[ùò\»N¬àBàBàHÿ]⁄
JH»€€ú€€Kô\úõ‹ä	÷ÿ›]ÿŸ[ôHô]öY]◊HX›‹à‹]€àòZ[Yõ‹âÀX›‹ãõò[YKJN»BàYà
Y[ù]JH[ù]HH›]ÿŸ[ôTô]öY]”XZŸTXŸZ€\äX›‹ã\ôXK\ôŸ]ÿŸ[ôJN¬à[ù]Y\ÀúŸ]
X›‹ãöY[ù]JN¬àBÇàÀ»8• 8• ›YŸH[ô⁄[ôH8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• 8• àÀ»ÿ[YH[›ôK›[Àÿ⁄⁄XŸKÿ[ö[X][€ã›\õãÿ€€Xò]ŸòYHŸ[X[ùX‹»\¬àÀ»ÿ‹À›€€Àÿ›]ÿŸ[ôKY\ôX›‹ã⁄[ô^ö[	‹»›€àô]öY]»[ô⁄[ôBàÀ»
‹ùYõ›⁄\ôY€ŸH8†%]€€ö]ô\»Hö]ò]HôYKöú¬àÀ»ÿŸ[ôK\»ö]ô\»ôX[‹]€ôY[ù]Y\»
»HôX[X[Ÿ›YHRJKàÀ»ôXY[ô»H^[ÿYH\ôX›‹à€€\»[ôXYHù[Hô\€€ôYàÀ»»€‹õ[H€€‹ô[ò]\»
ŸYH]»îô]öY]»[àÿ[YHà[ô\äKÇà€€ú›X›‹ú–ûRYHô]»X\

^[ÿYòX›‹ú»◊JKõX\
HOàÿKöYWJJN¬àÀ»]]‹ôYõ›][€ã\ŸY^X›H\»⁄]ô[à8†%õ»ÿ[Y\òK]ö\⁄Xö[]BàÀ»öX\⁄[ôÀà\»\»H⁄[ô€H€›\òŸHŸàù]õ‹à]ô\ûHX›‹â‹¬àÀ»õ›][€àúõ€H\ôH€ãŸ\[àﬁ[ò»⁄]HY\⁄€õHõ›Y⁄àÀ»\T›]K€»]ÿ[â›öYù›]Ÿàﬁ[ò»⁄]⁄]	‹»X›X[H€ÇàÀ»ÿ‹ôY[àHÿ^H€€\][ô»]⁄XŸH€›[Çà€€ú›X›‹î›]\»Hô]»X\

^[ÿYòX›‹ú»◊JKõX\
HOÇàÿKöY»ŒàKù€‹õÀéàKù€‹õãõ›][€éàKúõ›][€à‹ŸNàKú‹ŸH	‹›[ô[ô…À€€Xò]€éàò[ŸKÿ[ì‹ŸNàò[ŸHWBà
JN¬àÀ»X›‹íYOà\⁄\ôYòX⁄[ô»[àY‹ôY\Œà⁄]XX⁄X›‹à\»›\úô[ùBàÀ»ûZ[ô»»òXŸH
Ÿ]]‹]€àúõ€H]»ò]»]]‹ôYõ›][€ã[ôàÀ»⁄[ô]ô\àH\õàÿ\ô‹àH[›ôI‹»\úö]ò[òX⁄[ô»⁄]ô\»]Hô]¬àÀ»€ôJKà›]ÿŸ[ôTõ›][€ïX⁄»
ô[› H\»H€õH[ô»]]ô\ÇàÀ»\õú»\»[ù»[àX›X[Y\⁄õ›][€ã€€ù[ù[›\€Kõ‹àBàÀ»X›‹â‹»[ù\ôH[YH€àÿ‹ôY[à8†%Z\úõ‹ö[ô»›»ôX[ÿ[Y\^Hô]ô\ÇàÀ»€ò\»H›][€ò\ûHîÀÿ‹ôX]\ôI‹»òX⁄[ô»[à€ôHúò[YHZ]\à
ŸYBàÀ»òXŸSú—X[Ÿ›YT\ùX⁄\[ù…‹»ú—òXŸT^Y\ì\ú\]R‹›[\À¬àÀ»\]P€€\[ö[€ú»ÿ[[ô»\]P‹ôX]\ôSY\⁄]ô\ûHúò[YH⁄]\àBàÀ»‹ôX]\ôH\»[›ö[ô»‹à€[ô»›[
H8†%ò]\à[àHö^YBàÀ»\ò][€à€ôK\⁄›ù\õàÿ\ôà[ö[X][€à]›‹»ö]ö[ô»€òŸBàÀ»]»›€à[Y\àù[ú»›]Çà€€ú›\⁄\ôYòX⁄[ô—Y»Hô]»X\

^[ÿYòX›‹ú»◊JKõX\
HOàÿKöYKúõ›][€àJJN¬àÀ»X›‹íY»›\úô[ùH›€ö[ô»Z\à›€àõ›][€àXX⁄úò[YH8†%H[›ôBàÀ»›YŸI‹»›€à\ãYúò[YH›\\à
ÿ[Ÿ\ãõ[›ôU›ÿ\ô	‹»\ú€[\‹ÇàÀ»\]P‹ôX]\ôSY\⁄ö]ô[àûH]ôHò]ô[\ôX›[€äK‹àH€€Xò]àÀ»›YŸI‹»ôX[‹›[SÿöôX›Àÿ€€\[ö[€ìÿöôX›»RH
\]R‹›[\À¬àÀ»\]P€€\[ö[€úÀ⁄X⁄[€»ÿ[\]P‹ôX]\ôSY\⁄[\Ÿ[ô\¬àÀ»⁄]Z\à›€à⁄\ŸK]\ôŸ]Z[P[ô€JKà›]ÿŸ[ôTõ›][€ïX⁄»⁄⁄\¬àÀ»[û[€ôH[à\ôH€»]ô]ô\àöY⁄»⁄]]ô\â‹»X›]ô[Hö]ö[ô»[KÇà€€ú›^\õò[Qö]ô[êX›‹íY»Hô]»Ÿ]

N¬à€€ú››YŸ\–ûRYHô]»X\

^[ÿYú›YŸ\»◊JKõX\
»Oà‹ÀöY◊JJN¬à€€ú››YŸS‹ô\àH
^[ÿYú›YŸ\»◊JKõX\
»OàÀöY
N¬à]ù[õö[ô»HùYN¬Çà€€ú›Ÿ]ô\€€ôYô^H
›YŸRYô\]Y\›Yô^
HOà¬àYà
ô\]Y\›Yô^OOH	◊◊Ÿ[ô◊… Hô]\õàù[¬àYà
ô\]Y\›Yô^	âàô\]Y\›Yô^OOH	◊◊€ô^◊… Hô]\õà›YŸ\–ûRYö\ ô\]Y\›Yô^
H»ô\]Y\›Yô^àù[¬àô]\õà›YŸS‹ô\ñ‹›YŸS‹ô\ãö[ô^Ÿä›YŸRY
H
»WHù[¬àN¬à€€ú›[ô€U›ÿ\ô›]HH›]ÿŸ[ôTô]öY]–[ô€U›ÿ\ô¬à€€ú›ùZ[‹öY]H
›\ù€ÿ[
HOà¬à€€ú›]Hﬁ»Œà›\ùòÀéà›\ùúàWN¬à]»H›\ùòÀàH›\ùúã‹ö^õ€ù[\õàHùYN¬à⁄[H
»OOH€ÿ[ò»àOOH€ÿ[úäH¬à€€ú›ÿ[íH»OOH€ÿ[òÀÿ[ïàHàOOH€ÿ[úé¬àYà

‹ö^õ€ù[\õà	âàÿ[í
HXÿ[ïäH»
œHX]ú⁄Y€ä€ÿ[ò»H N»[ŸHà
œHX]ú⁄Y€ä€ÿ[úàHäN¬à]ú\⁄
»ÀàJN¬à‹ö^õ€ù[\õàHZ‹ö^õ€ù[\õé¬àBàô]\õà]¬àN¬à€€ú›\T›]HHX›‹íYOà»€€ú›[ù]HH[ù]Y\ÀôŸ]
X›‹íY
K›HX›‹î›]\ÀôŸ]
X›‹íY
N»Yà
[ù]H	âà›
H›]ÿŸ[ôTô]öY]–\T›]J[ù]K\ôXK›
N»N¬ÇàÀ»\ãYúò[YHò]ô[›ÿ\ôH[KXŸ[ù\à\ôŸ]ô]\⁄[ô»HôX[àÀ»ÿ[YI‹»›€àÿ€€[›[€à[ú›XYŸàH\ÿ‹ô]H‹öYZ‹›\[ô¬àÀ»\»\ŸY»Œà[àî»X›‹àöY\»H^X›ÿ[YBàÀ»ÿ[Ÿ\ãõ[›ôU›ÿ\ô

HHÿ⁄Y[Hﬁ\›[Hö]ô\»ôX[ö[YŸ\ú¬àÀ»⁄][ôH‹ôX]\ôHX›‹àöY\»[›ôP‹ôX]\ôU›ÿ\ô

H
¬àÀ»\]P‹ôX]\ôSY\⁄

K›\]P‹ôX]\ôP[ö[Qúò[YJ
H8†%Hÿ[YHö[¬àÀ»\]R‹›[\ 
Hö]ô\»⁄[‹ôX]\ô\»⁄]àHúôYYõ‹õKŸòZ[YBàÀ»‹]€àXŸZ€\àX›‹à\»õ»ôX[ﬁ\›[H»õ‹úõ›À€»]Ÿ]¬àÀ»[à€ô\››òZY⁄[[ôH\ú
ÿ[YHY‹òYKY‹òXŸYù[H€XﬁH\¬àÀ»›]ÿŸ[ôTô]öY]”XZŸTXŸZ€\à]Ÿ[äKàô]\õú»ùYH€òŸH\úö]ôYÇà€€ú›Yò[òŸPX›‹ï›ÿ\ôH
X›‹íYã‹YY][HJHOà¬à€€ú›[ù]HH[ù]Y\ÀôŸ]
X›‹íY
K›HX›‹î›]\ÀôŸ]
X›‹íY
N¬àYà
Y[ù]H\›
Hô]\õàùYN¬àYà
[ù]Kö⁄[ôOOH	€ú…»	âà[ù]Kùÿ[Ÿ\äH¬à[ù]Kùÿ[Ÿ\ãòÿ]⁄\H‹YY][»À»ô]öY]À\ÿ‹ö\Yÿ[Ÿ\ú»\ôHô]ô\àÿ⁄Y[KYö]ô[ã€»ÿ]⁄\\»úôYH»ô\\ú‹ŸH\»H‹YYX[à€€ú›\úö]ôYH[ù]Kùÿ[Ÿ\ãõ[›ôU›ÿ\ô
ã
N¬à›ò»H[ù]Kúõ€›ú‹⁄][€ãûHçN¬à›úàH[ù]Kúõ€›ú‹⁄][€ãûàHçN¬à›úõ›][€àHëQKìX]][ÀúòY—Y [ù]Kùÿ[Ÿ\ãúõ›
N¬àô]\õà\úö]ôY¬àBàYà
[ù]Kö⁄[ôOOH	ÿ‹ôX]\ôI»	âà[ù]Kò‹ôX]\ôJH¬à€€ú›»H[ù]Kò‹ôX]\ôN¬à€€ú›‹YYH
ÀôYãõ[›ôT‹YYãç
H
à‹YY][¬à€€ú›[›ö[ô»H[›ôP‹ôX]\ôU›ÿ\ô
À
àSKà
àSK‹YY
N¬à€€ú›\›HX]ö\›
ÀûH
àSKÀûHHà
àSJN¬à€€ú›Z[P[ô€HH[›ö[ô»»X]ò][åäà
àSHHÀûK
àSHHÀû
HàÀôòX⁄[ôŒ¬àÀôòX⁄[ô»HZ[P[ô€N¬à\]P‹ôX]\ôSY\⁄
ÀZ[P[ô€JN¬à\]P‹ôX]\ôP[ö[Qúò[YJÀ[›ö[ô N¬à›ò»HÀû»SHHçN¬à›úàHÀûH»SHHçN¬àÀ»›úõ›][€à\»Hô\ôX›[Ÿ[K\õ›][€àà€€ùô[ù[€à]ô\ûBàÀ»›\à‹ôX]\ôHõ›][€à]\Ÿ\»
\õàÿ\ôÀ‹]€ãBàÀ»€€	‹»›€à⁄^õ[À‹ô]öY] H8†%ì’Z[P[ô€I‹»ò]»€‹õY\ôX›[€ÇàÀ»€€ùô[ù[€à
\]P‹ôX]\ôSY\⁄[ù\õò[HX\»Z[P[ô€H¬àÀ»‹õ›\õ›öXHò]’\ôŸ]õ›HHJZ[P[ô€JH
»KÃãHôYõX›YàÀ»
õõ›
à⁄[\HŸôúŸ]ô[][€ú⁄\
KàôXY[ô»]òX⁄»úõ€HBàÀ»Y\⁄	‹»X›X[ô\›[[ô»‹õ›\õ›ŸY\»]€€ú⁄\›[ù€¬àÀ»›]ÿŸ[ôTõ›][€ïX⁄…‹»‹›X\úö]ò[ò[òX⁄»
⁄[àH[›ôH\¬àÀ»õ»]]‹ôY\úö]ò[òX⁄[ô HX⁄‹»\úõ€HHùYH›\úô[ùàÀ»òX⁄[ô»[ú›XYŸàHõ›][€àH‹ôX]\ôHô]ô\àX›X[HYÇà›úõ›][€àH

ëQKìX]][ÀúòY—Y Àô‹õ›\õ›
H	HÕå
H
»Õå
H	HÕå¬àô]\õà\›SH
àåLé¬àBà€€ú›ô]ö[›\»H»Œà›òÀéà›úàN¬à€€ú›HHçHH›òÀàHàHçHH›úé¬à€€ú›HX]ö\›
äN¬à€€ú››\HX]õX^
åKKçà
à‹YY][
à
N¬àYà
H›\
H»›ò»HHçN»›úàHàHçN»H[ŸH»›ò»
œH»
à›\»›úà
œHà»
à›\»BàYà
àåJH›úõ›][€àH[ô€U›ÿ\ô›]Jô]ö[›\À›
N¬à\T›]JX›‹íY
N¬àô]\õàH›\¬àN¬Çà€€ú›ö[ö\⁄HY\‹ÿYŸHOà¬àù[õö[ô»Hò[ŸN¬à›]ÿŸ[ôTô]öY]–X›]ôHHò[ŸN¬à›]ÿŸ[ôTô]öY]÷õ€€T\òŸ[ùHL»À»ô]ô\àXZ»[à]]‹ôYõ€€H[ù»õ‹õX[ÿ[Y\^HYù\ùÿ\ôà›]ÿŸ[ôTô]öY]—X[Ÿ›YT‹XZŸ\àHù[¬à[ù\ëYò][ÿ[Y\òS[ŸJ
N¬àX›]ôPÿ[Y\òU\ôŸ]Hù[¬à›]ÿŸ[ôTô]öY]–ò[õô\äY\‹ÿYŸH<'„´	‹^[ÿYù]H	–›]ÿŸ[ôIﬂH8†%ö[ö\⁄Yòò[ŸJN¬àN¬Çà\ﬁ[ò»ù[ò›[€à‹[ì[ôJ[ù]K‹XZŸ\ìò[YK^
H¬àX[Ÿ›YS‹[àHùYN¬àŸX[Ÿ›YUÿ[Ÿ\àH[ù]OÀö⁄[ôOOH	€ú…»»»õ€›à[ù]Kúõ€›ôXŒà[ù]KúôXÀõŸö[Nà[ù]KúõŸö[K]ò]\ëúõ€ùÿ[ùò\Œà[ù]Kò]ò]\ëúõ€ùÿ[ùò\»Hàù[¬à›]ÿŸ[ôTô]öY]—X[Ÿ›YT‹XZŸ\àH[ù]Hù[¬àX›]ôPÿ[Y\òS[ŸHH[ù]OÀö⁄[ôOOH	ÿ‹ôX]\ôI»»”[ŸRŸ^P‹ôX]\ôHà”[ŸRŸ^N¬àX›]ôPÿ[Y\òU\ôŸ]H»‹⁄][€éà
[ù]H[ù]Y\Àùò[Y\ 
Kõô^

Kùò[YJOÀúõ€›ú‹⁄][€àô]»ëQKïôX›‹å 
HN¬à€ú—X[Ÿ›YSò[YQ[ù^€€ù[ùH‹XZŸ\ìò[YN¬àYà
€ú—X[Ÿ›YRX\ù—[
H€ú—X[Ÿ›YRX\ù—[ù^€€ù[ùH	…Œ¬àÿ\ò–€€ùZ[ô\ë[Àò€\‹”\›òY
	ÿ\òÀZY[â N¬à€€ú››H€ú‘‹ùòZ]ÿ[ùò\ÀôŸ]€€ù^
	Ãô	 N¬àYà
ŸX[Ÿ›YUÿ[Ÿ\èÀúõŸö[H	âà⁄[ô›Àìú–]ò]\îô]öY] H¬à›ôö[›[HH	»ÃXåÕLéIŒ»›ôö[ôX›
€ú‘‹ùòZ]ÿ[ùò\Àù⁄Y€ú‘‹ùòZ]ÿ[ùò\ÀöZY⁄
N¬à]ÿZ]⁄[ô›ÀëX[Ÿ›YP€€ù[ùÀúô[ô\ìú—X[Ÿ›YT‹ùòZ]

N¬àH[ŸH¬à›ò€X\îôX›
€ú‘‹ùòZ]ÿ[ùò\Àù⁄Y€ú‘‹ùòZ]ÿ[ùò\ÀöZY⁄
N¬àBà€ú—X[Ÿ›YQ[ò€\‹”\›òY
	€‹[â N¬à€ú—X[Ÿ›YQ[úŸ]]öXù]J	ÿ\öXKZY[âÀ	Ÿò[ŸI N¬à⁄[ô›ÀëX[Ÿ›YP€€ù[ùÀöYP⁄⁄XŸPù]€ú 
N¬à⁄[ô›ÀëX[Ÿ›YP€€ù[ùÀúŸ]ú—X[Ÿ›YU^
^
N¬àBÇàù[ò›[€à€‹ŸS[ôJ
H¬àX[Ÿ›YS‹[àHò[ŸN¬à›]ÿŸ[ôTô]öY]–Yò[òŸHHù[¬à⁄[ô›ÀëX[Ÿ›YP€€ù[ùÀöYP⁄⁄XŸPù]€ú 
N¬à⁄[ô›Àú‹ùòZ]úôX][ô–€€\‹Ÿ\èÀò€X\ë^ô\‹⁄[€ä⁄[ô›ÀëX[Ÿ›YP€€ù[ùÀôX[Ÿ›YTŸX]Y

JN¬à⁄[ô›Àú‹ùòZ]úôX][ô–€€\‹Ÿ\èÀúŸ]Yò][^ô\‹⁄[€ä⁄[ô›ÀëX[Ÿ›YP€€ù[ùÀôX[Ÿ›YTŸX]Y

Kù[
N¬àŸX[Ÿ›YUÿ[Ÿ\àHù[¬à›]ÿŸ[ôTô]öY]—X[Ÿ›YT‹XZŸ\àHù[¬à€ú—X[Ÿ›YQ[ò€\‹”\›úô[[›ôJ	€‹[â N¬à€ú—X[Ÿ›YQ[úŸ]]öXù]J	ÿ\öXKZY[âÀ	›ùYI N¬àÿ\ò–€€ùZ[ô\ë[Àò€\‹”\›úô[[›ôJ	ÿ\òÀZY[â N¬àX›]ôPÿ[Y\òS[ŸHHYPÿ[Y\òS[ŸN¬àX›]ôPÿ[Y\òU\ôŸ]HYPÿ[Y\òU\ôŸ]¬àBÇàù[ò›[€à⁄›–⁄⁄XŸS‹[€ú ‹[€ú H¬à€€ú›‹[»HÃKãÀKóKõX\
HOàÿ›[Y[ùôŸ][[Y[ùûRY
”‹	⁄_X
JN¬à‹[Àôõ‹ëXX⁄
[Oà»Yà
Y[
Hô]\õé»€€ú›Xô[H[ú]Y\ûTŸ[X›‹ä	ÀôÀ[‹[Xô[	 N»Yà
Xô[
H»Xô[ù^€€ù[ùH	…Œ»Xô[ú›[Kôõ€ù⁄^ôHH	…Œ»H[ò€\‹”\›úô[[›ôJ	ŸÀ[‹]ö\⁄XõI N»[õ€ò€X⁄»Hù[»JN¬à‹[€úÀú€XŸJäKôõ‹ëXX⁄

‹JHOà¬à€€ú›[H‹[÷⁄WN»Yà
Y[
Hô]\õé¬à€€ú›Xô[H[ú]Y\ûTŸ[X›‹ä	ÀôÀ[‹[Xô[	 N»Yà
Xô[
HXô[ù^€€ù[ùH‹ù^	–⁄⁄XŸIŒ¬à[ò€\‹”\›òY
	ŸÀ[‹]ö\⁄XõI N¬à[õ€ò€X⁄»H

HOà»Yà
YX[Ÿ›YS‹[äHô]\õé»‹õ€ê€X⁄ 
N»N¬àJN¬à‹[Àôõ‹ëXX⁄
[Oà»Yà
[	âà[ò€\‹”\›ò€€ùZ[ú 	ŸÀ[‹]ö\⁄XõI JH⁄[ô›ÀëX[Ÿ›YP€€ù[ùÀôö]”‹[€ìXô[
[
N»JN¬à€€ú›€€ù[ùYPùàHÿ›[Y[ùôŸ][[Y[ùûRY
	€ú—X[Ÿ›YP€€ù[ùYI N¬àYà
€€ù[ùYPùäH€€ù[ùYPùãú›[Kô\‹^HH‹[€úÀõ[ô›»	€õ€ôI»à	…Œ¬àBÇàù[ò›[€à€€ù[ùYU ô^Y
H¬àYà
\ù[õö[ô Hô]\õé¬àYà
X[Ÿ›YS‹[äH€‹ŸS[ôJ
N¬àYà
[ô^Y
H»ö[ö\⁄

N»ô]\õé»Bàù[î›YŸJô^Y
N¬àBÇàù[ò›[€àù[î›YŸJ›YŸRY
H¬àYà
\ù[õö[ô Hô]\õé¬à€€ú››YŸHH›YŸ\–ûRYôŸ]
›YŸRY
N¬àYà
\›YŸJH»ö[ö\⁄
	‘ô]öY]»›‹Y8†%Hô^ÿ\ô€›[õ›ôHõ›[ôâ N»ô]\õé»Bà›]ÿŸ[ôTô]öY]–ò[õô\ä<'„´	‹^[ÿYù]H	–›]ÿŸ[ôIﬂH8†%	‹›YŸKù\_Xò[ŸJN¬ÇàYà
›YŸKù\HOOH	€[›ôI Hô]\õàù[ì[›ôJ›YŸJN¬àYà
›YŸKù\HOOH	ÿ[ö[X][€â Hô]\õàù[ê[ö[X][€ä›YŸJN¬àYà
›YŸKù\HOOH	›\õâ Hô]\õàù[ï\õä›YŸJN¬àYà
›YŸKù\HOOH	ÿ€€Xò]	 Hô]\õàù[ê€€Xò]
›YŸJN¬àYà
›YŸKù\HOOH	ŸòYI Hô]\õàù[ëòYJ›YŸJN¬àYà
›YŸKù\HOOH	ﬁõ€€I Hô]\õàù[ñõ€€J›YŸJN¬Çà€€ú›‹XZŸ\êX›‹àHX›‹ú–ûRYôŸ]
›YŸKú‹XZŸ\íY
N¬à€€ú›‹XZŸ\ë[ù]HH[ù]Y\ÀôŸ]
›YŸKú‹XZŸ\íY
N¬à€€ú›‹XZŸ\ìò[YHH‹XZŸ\êX›‹èÀõò[YH	‘€€Y[€ôIŒ¬àYà
\‹XZŸ\ë[ù]JH»€€ù[ùYU Ÿ]ô\€€ôYô^
›YŸKöY›YŸKõô^
JN»ô]\õé»BàYà
›YŸKù\HOOH	ÿ⁄⁄XŸI H¬à‹[ì[ôJ‹XZŸ\ë[ù]K‹XZŸ\ìò[YK›YŸKù^
Kù[ä

HOà¬à⁄›–⁄⁄XŸS‹[€ú 
›YŸKõ‹[€ú»◊JKõX\
»Oà
»^àÀù^€ê€X⁄Œà

HOà€€ù[ùYU Ÿ]ô\€€ôYô^
›YŸKöYÀõô^
JHJJJN¬àJN¬à›]ÿŸ[ôTô]öY]–Yò[òŸHH

HOàﬂN»À»⁄⁄XŸ\»€õH]ô\àYò[òŸHöXHZ\à›€àù]€Çàô]\õé¬àBà‹[ì[ôJ‹XZŸ\ë[ù]K‹XZŸ\ìò[YK›YŸKù^
N¬à›]ÿŸ[ôTô]öY]–Yò[òŸHH

HOà€€ù[ùYU Ÿ]ô\€€ôYô^
›YŸKöY›YŸKõô^
JN¬àBÇàù[ò›[€àù[ì[›ôJ›YŸJH¬à€€ú››HX›‹î›]\ÀôŸ]
›YŸKòX›‹íY
N¬à€€ú›€ÿ[H›YŸKù\ôŸ]€‹õ¬àYà
\›Y€ÿ[
H»€€ù[ùYU Ÿ]ô\€€ôYô^
›YŸKöY›YŸKõô^
JN»ô]\õé»Bà€€ú›‹YY][H›YŸKú‹YYOOH	‹€›…»»çàà›YŸKú‹YYOOH	Ÿò\›	»»KéHàN¬à€€ú›ÿZ]õ‹ê\úö]ò[H›YŸKùÿZ]õ‹ê\úö]ò[OOHò[ŸN¬à€€ú›H€ÿ[ò»
»çKàH€ÿ[úà
»çN¬à]\›H\ôõ‹õX[òŸKõõ› 
N¬à]\úö]ôY[ôXYHHò[ŸN¬à^\õò[Qö]ô[êX›‹íYÀòY
›YŸKòX›‹íY
N»À»Yò[òŸPX›‹ï›ÿ\ôô[›»›€ú»õ›][€à[ù[\úö]ò[à€€ú›€ê\úö]ôHH

HOà¬àYà
\úö]ôY[ôXYJHô]\õé¬à\úö]ôY[ôXYHHùYN¬à^\õò[Qö]ô[êX›‹íYÀô[]J›YŸKòX›‹íY
N¬àÀ»Yò[òŸPX›‹ï›ÿ\ô	‹»›€àò\úö]ôYàÿ]H
SJååLäH\»€‹Ÿ\ÇàÀ»[à[›ôP‹ôX]\ôU›ÿ\ô	‹»[ù\õò[€ôH
Hõ]\
K€»BàÀ»€‹Xõ›ôHÿ[à^]\ôH⁄[HH‹ôX]\ôHÿ\»›[ù\›àÀ»[ú⁄YH][õô\àô\⁄€€à]»ô\ûH\››\8†%KôKÇàÀ»›[ZY\ù[ãXﬁX€H‹ö]H
\]P‹ôX]\ôP[ö[Qúò[YI‹¬àÀ»[›ö[ôÿÿ\»›[ùYH]úò[YJKà›]ÿŸ[ôTõ›][€ïX⁄¬àÀ»
ô[› HX⁄‹»\YHúò[Z[ô»€à]»ô\ûHô^X⁄»€òŸH\¬àÀ»X›‹à\»›]Ÿà^\õò[Qö]ô[êX›‹íYÀ€»õ»^X⁄]àÀ»€X[ù\ÿ[\»ôYYY\ôHõ‹à]ÇàÀ¬àÀ»H\ôŸ]⁄[ù	‹»›€à]]‹ôY\úö]ò[òX⁄[ô»
Yà[ûJH⁄[ú¬àÀ»›ô\à⁄]]ô\à\ôX›[€àHÿ[»]Ÿ[àYùHX›‹àòX⁄[ô¬àÀ»8†%ÿ[YH\»Hï\õà[àXŸHàÿ\ôù\›öYŸŸ\ôYûH[ô[ô»€ÇàÀ»\»⁄[ùà[ôY»›]ÿŸ[ôTõ›][€ïX⁄»\»\»X›‹â‹»ô]¬àÀ»\⁄\ôYòX⁄[ô»
õ»\úö]ò[òX⁄[ô»][ù\›ŸY\»⁄]]ô\ÇàÀ»\ôX›[€àHÿ[»Yù]òX⁄[ôÀ^X›HZŸHôX[îÀ¬àÀ»‹ôX]\ôH[›ô[Y[ùŸ\ H8†%ô]ô\àõÿ⁄‹»HÿŸ[ôH€à]BàÀ»X›‹àŸY\»\õö[ô»[àHòX⁄Ÿ‹õ›[ô⁄[HHô^ÿ\ôàÀ»›\ùÀÇà\⁄\ôYòX⁄[ô—YÀúŸ]
›YŸKòX›‹íY€ÿ[ôòX⁄[ô»OHù[»€ÿ[ôòX⁄[ô»à›úõ›][€äN¬àYà
ÿZ]õ‹ê\úö]ò[
H€€ù[ùYU Ÿ]ô\€€ôYô^
›YŸKöY›YŸKõô^
JN¬àN¬à€€ú››\H

HOà¬àYà
\ù[õö[ô Hô]\õé¬à€€ú›õ›»H\ôõ‹õX[òŸKõõ› 
N¬à€€ú›HX]õZ[äåK
õ›»H\›
H»L
N¬à\›Hõ›Œ¬à€€ú›\úö]ôYHYò[òŸPX›‹ï›ÿ\ô
›YŸKòX›‹íYã‹YY][
N¬àYà
\úö]ôY
H»€ê\úö]ôJ
N»ô]\õé»Bàô\]Y\›[ö[X][€ëúò[YJ›\
N¬àN¬àô\]Y\›[ö[X][€ëúò[YJ›\
N¬àÀ»[ò⁄X⁄ŸY[àH\ôX›‹à
ïÿZ]õ‹à\úö]ò[ôYõ‹ôH€€ù[ùZ[ô»äBàÀ»8†%›\ùHô^ÿ\ô[[YYX][H⁄[H\»X›‹àŸY\¬àÀ»ÿ[⁄[ô»›ÿ\ô]»\ôŸ][àHòX⁄Ÿ‹õ›[ô
H€‹Xõ›ôBàÀ»›[ù[úÀÿ]Y€àHÿ[YHù[õö[ôÿõY»Hõÿ⁄⁄[ô»[›ôBàÀ»\Ÿ\À€»›‹[ô»Hô]öY]»ÿ[òŸ[»]Y[ùXÿ[JK€¬àÀ»Ÿ]ô\ò[X›‹ú»ÿ[àôHŸ[ùŸôà]€òŸH[ú›XYŸà€ôH]H[YKÇàYà
]ÿZ]õ‹ê\úö]ò[
H€€ù[ùYU Ÿ]ô\€€ôYô^
›YŸKöY›YŸKõô^
JN¬àBÇàù[ò›[€àù[ê[ö[X][€ä›YŸJH¬à€€ú››HX›‹î›]\ÀôŸ]
›YŸKòX›‹íY
N¬à€€ú›[ù]HH[ù]Y\ÀôŸ]
›YŸKòX›‹íY
N¬àYà
\›Y[ù]JH»€€ù[ùYU Ÿ]ô\€€ôYô^
›YŸKöY›YŸKõô^
JN»ô]\õé»Bà€€ú›€€\‹Ÿ\àH⁄[ô›Àú‹ùòZ]úôX][ô–€€\‹Ÿ\é¬à]úôX][Y\àHù[¬àYà
›YŸKò[ö[R⁄[ôOOH	Ÿ[[›I»	âà[ù]Kö⁄[ôOOH	€ú…»	âà[ù]KúõŸö[H	âà€€\‹Ÿ\äH€€\‹Ÿ\ãùöYŸŸ\ë[[›J›YŸKô[[›Sò[YJN¬àYà

›YŸKò[ö[R⁄[ôOOH	ÿúôX][ô…»›YŸKò[ö[R⁄[ôOOH	Ÿ[[›I H	âà[ù]Kö⁄[ôOOH	€ú…»	âà[ù]KúõŸö[H	âà€€\‹Ÿ\à	âà⁄[ô›Àìú–]ò]\îô]öY]»	âà⁄[ô›Àîë‘[ôP]ò]\äH¬àúôX][Y\àHŸ][ù\ùò[
\ﬁ[ò»

HOà¬àYà
\ù[õö[ô H»€X\í[ù\ùò[
úôX][Y\äN»ô]\õé»BàûH¬à]ÿZ]⁄[ô›Àìú–]ò]\îô]öY]Àúô[ô\îõŸö[U–ÿ[ùò\ [ù]Kò]ò]\ëúõ€ùÿ[ùò\À[ù]KúõŸö[K»úôX][ô–€€\‹Ÿ\éà€€\‹Ÿ\àJN¬à⁄[ô›Àîë‘[ôP]ò]\ãúôYúô\⁄⁄[ô€T[ôP]ò]\ì[Ÿ[
[ù]Kùÿ[Ÿ\ãò]ò]\ë‹õ›\[ù]Kò]ò]\ëúõ€ùÿ[ùò\ N¬àHÿ]⁄
JHﬂBàKLå
N¬àBàŸ][Y[›]


HOà¬àYà
\ù[õö[ô Hô]\õé¬àYà
úôX][Y\äH€X\í[ù\ùò[
úôX][Y\äN¬àYà
›YŸKúô\›[‹ŸHOOH	›[ò⁄[ôŸY	 H›ú‹ŸHH›YŸKúô\›[‹ŸN¬à\T›]J›YŸKòX›‹íY
N¬à€€ù[ùYU Ÿ]ô\€€ôYô^
›YŸKöY›YŸKõô^
JN¬àK
›YŸKô\ò][€à
H
àL
N¬àBÇàÀ»H\õàÿ\ôù\›[ô»›]ÿŸ[ôTõ›][€ïX⁄»
ô[› HHô]»\⁄\ôYàÀ»òX⁄[ô»8†%H€€ù[ù[›\»\ãYúò[YHX⁄Ÿ\à\»⁄]X›X[HX\Ÿ\¬àÀ»HX›‹â‹»õ›][€à›ÿ\ô]^X›HZŸHH›][€ò\ûHôX[àÀ»îÀÿ‹ôX]\ôH\õö[ô»»òXŸH€€Y][ô»
õ»[ú›[ù€ò\
KàBàÀ»ÿ\ô	‹»›€à\ò][€à\»HX⁄[ô»ôX]õ‹àHÿŸ[ôH
⁄[àHô^àÀ»ÿ\ô›\ù Kõ›H]\ò[ùÿZ][ù[H\õàö[ö\⁄\»àÿ]H8†%àÀ»ÿ[YH\»]ÿ\»ôYõ‹ôKÇàù[ò›[€àù[ï\õä›YŸJH¬à€€ú››HX›‹î›]\ÀôŸ]
›YŸKòX›‹íY
N¬àYà
\›
H»€€ù[ùYU Ÿ]ô\€€ôYô^
›YŸKöY›YŸKõô^
JN»ô]\õé»Bà]\ôŸ]Y»H›úõ›][€é¬àYà
›YŸKõ[ŸHOOH	ÿX›‹â H¬à€€ú›\ôŸ]›HX›‹î›]\ÀôŸ]
›YŸKù\ôŸ]X›‹íY
N¬àYà
\ôŸ]›
H\ôŸ]Y»H[ô€U›ÿ\ô›]J›\ôŸ]›
N¬àH[ŸH¬à\ôŸ]Y»H

X]úõ›[ô
›YŸKò[ô€JH	HÕå
H
»Õå
H	HÕå¬àBà\⁄\ôYòX⁄[ô—YÀúŸ]
›YŸKòX›‹íY\ôŸ]Y N¬àŸ][Y[›]


HOà€€ù[ùYU Ÿ]ô\€€ôYô^
›YŸKöY›YŸKõô^
JK
›YŸKô\ò][€à
H
àL
N¬àBÇàÀ»]ôH‹ôX]\ôK]úÀX‹ôX]\ôHRKY[ùXÿ[[à‹\ö]»H›]ÿŸ[ôBàÀ»\ôX›‹à€€	‹»›€à€€Xò]Xÿ\ô⁄[][][€éàH‹ôX]\ôK[[öŸYàÀ»X[YY\ùX⁄\[ù⁄\Ÿ\»HôX\ô\›€€Xò]€à\ùX⁄\[ù€àBàÀ»Yôô\ô[ùX[H⁄][àHôX[‘ëPUTëW—àYŸ‹õ»ò[ôŸK[ôàÀ»]X⁄‹»
€€€›€ãYÿ]Y[ŸJH€òŸH⁄][à]X⁄»ò[ôŸKàÿ[YBàÀ»X[H‹àõ»X[HHô]ô\àHôX]àõ€ãX‹ôX]\ôH\ùX⁄\[ù»
BàÀ»\ú€€àî»]ô\àX\öŸY€€Xò]€äH\ôHYù›][€ò\ûKÇàù[ò›[€àù[ê€€Xò]
›YŸJH¬à›YŸKú\ùX⁄\[ùÀôõ‹ëXX⁄
Oà»€€ú››HX›‹î›]\ÀôŸ]
òX›‹íY
N»Yà
›
H»›ò€€Xò]€àHò€€Xò]€é»›òÿ[ì‹ŸHHòÿ[ì‹ŸN»HJN¬ÇàÀ»ôX[‹›[Kÿ€€\[ö[€àRKõ›Hô\‹⁄ŸH⁄[][][€éàH‹›[BàÀ»‹X⁄Y\»
‘ëPUTëW—ñÀããóKö‹›[HOOHùYKKôÀàÿ\ã]€€äH\¬àÀ»YY»HôX[‹›[SÿöôX›»Ÿ][ôö]ô[àûHH^X›àÀ»ÿ[YH\]R‹›[\ 
H⁄[‹ôX]\ô\»⁄\ŸKÿ]X⁄»H^Y\ÇàÀ»⁄]àHõ€ãZ‹›[H‹X⁄Y\»
KôÀàXö[ôŸ⁄KZ›[ô
H\»YY¬àÀ»HôX[€€\[ö[€ìÿöôX›»Ÿ][ôö]ô[àûH\]P€€\[ö[€ú 
BàÀ»8†%Hÿ[YHôYô[ô⁄Ÿ]ô\â‹»ôX\ô\›‹›[SÿöôX›»»]¬àÀ»X\›\ààRHH⁄\›K\›[[[€ôY€€\[ö[€à\Ÿ\À^X⁄]H⁄[ùYàÀ»]HôX[^Y\àöXHÀõX\›\à
ŸYHHX\›\òöY[€ÇàÀ»XZŸP‹ôX]\ôQ[ù]H8†%Hù]\ôH]]‹ôYX\›\àô\⁄Y\»BàÀ»^Y\à€›[ù\›ôYY\»[ôH»X⁄»HYôô\ô[ù[ù]JKÇàÀ»õ›\ôH[ôXYHX⁄ŸY]ô\ûHúò[YHûHHXZ[àÿ[YH€‹€¬àÀ»õ›[ô»\ôHö]ô\»[HûH[ô»\»€õHôY⁄\›\úÀ¬àÀ»[úôY⁄\›\ú»[H[ô\ö‹»HôX[^Y\ãûﬁH]HÿŸ[ôI‹¬àÀ»^Y\àX›‹à€»]\ôŸ][ô»ô\€€ô\»YÿZ[ú›HöY⁄‹›àÀ»[ú›XYŸà⁄\ô]ô\àHôX[^Y\à\››€ŸÇà€€ú›€€Xò]€íY»H›YŸKú\ùX⁄\[ùÀôö[\äOàò€€Xò]€äKõX\
OàòX›‹íY
Bàôö[\äYOà»€€ú›HHX›‹ú–ûRYôŸ]
Y
N»ô]\õàH	âàKò‹ôX]\ôU\RY	âà‘ëPUTëW—ñÿKò‹ôX]\ôU\RYN»JN¬Çà€€ú›^Y\êX›‹àH
^[ÿYòX›‹ú»◊JKôö[ô
HOàKö\‘^Y\äN¬à€€ú›^Y\î›H^Y\êX›‹à»X›‹î›]\ÀôŸ]
^Y\êX›‹ãöY
Hàù[¬à€€ú›ÿ]ôY^Y\ñH^Y\ãûÿ]ôY^Y\ñHH^Y\ãûN¬àYà
^Y\î›
H»^Y\ãûH
^Y\î›ò»
»çJH
àSN»^Y\ãûHH
^Y\î›úà
»çJH
àSN»BÇà€€ú›ôY⁄\›\ôYH◊N¬àõ‹à
€€ú›X›‹íYŸà€€Xò]€íY H¬à€€ú›[ù]HH[ù]Y\ÀôŸ]
X›‹íY
N¬àYà
Y[ù]H[ù]Kö⁄[ôOOH	ÿ‹ôX]\ôI H€€ù[ùYN¬à€€ú›»H[ù]Kò‹ôX]\ôN¬àÀú›]HH	⁄YIŒ¬à^\õò[Qö]ô[êX›‹íYÀòY
X›‹íY
N»À»\]R‹›[\À›\]P€€\[ö[€ú»›€à\»‹ôX]\ôI‹»õ›][€àõ›¬àYà
ÀôYãö‹›[JH¬àÀö€YVHÀû»Àö€YVHHÀûN¬à‹›[SÿöôX›ÀòY
 N¬àôY⁄\›\ôYú\⁄
»ÀŸ]à‹›[SÿöôX›»JN¬àH[ŸH¬àÀö\–€€\[ö[€àHùYN¬àÀõX\›\àH^Y\é¬à€€\[ö[€ìÿöôX›ÀòY
 N¬àôY⁄\›\ôYú\⁄
»ÀŸ]à€€\[ö[€ìÿöôX›»JN¬àBàBÇàŸ][Y[›]


HOà¬àõ‹à
€€ú›»ÀŸ]HŸàôY⁄\›\ôY
H»Ÿ]ô[]J N»Yà
Ÿ]OOH€€\[ö[€ìÿöôX› HÀõX\›\àHù[»Bà^Y\ãûHÿ]ôY^Y\ñ»^Y\ãûHHÿ]ôY^Y\ñN¬àYà
\ù[õö[ô Hô]\õé¬àÀ»ﬁ[ò»XX⁄€€Xò][ù	‹»]]‹ôYX€€‹ô[ò]H›]Húõ€H⁄\ô]ô\ÇàÀ»HôX[RHX›X[HYù]€»Hô^›YŸH
HŸ]K—õYBàÀ»[›ôJH›\ù»úõ€H]»ùYH‹⁄][€à[ú›XYŸà€ò\[ô»òX⁄¬àÀ»»]»ôKX€€Xò]‹]€à⁄[ùàÿ[YHõ‹àõ›][€ãŸ\⁄\ôYàÀ»òX⁄[ô»8†%[ô[ô»›]ÿŸ[ôTõ›][€ïX⁄»òX⁄»€€ùõ€
]ô\›[Y\¬àÀ»ô^úò[YKõ›»]\»X›‹íY\»›]ŸÇàÀ»^\õò[Qö]ô[êX›‹íY H⁄]H‹õ€ô»\⁄\ôYòX⁄[ô»€›[àÀ»X[ö»H‹ôX]\ôH›ÿ\ô]»€ôKX€€Xò]\ôŸ]H[ú›[ùàÀ»€€Xò][ôÀÇàõ‹à
€€ú›X›‹íYŸà€€Xò]€íY H¬à€€ú›[ù]HH[ù]Y\ÀôŸ]
X›‹íY
K›HX›‹î›]\ÀôŸ]
X›‹íY
N¬à^\õò[Qö]ô[êX›‹íYÀô[]JX›‹íY
N¬àYà
[ù]OÀö⁄[ôOOH	ÿ‹ôX]\ôI»	âà›
H¬à›ò»H[ù]Kò‹ôX]\ôKû»SHHçN»›úàH[ù]Kò‹ôX]\ôKûH»SHHçN¬à›úõ›][€àHëQKìX]][ÀúòY—Y [ù]Kò‹ôX]\ôKô‹õ›\õ›
N¬à\⁄\ôYòX⁄[ô—YÀúŸ]
X›‹íY›úõ›][€äN¬àBàBà›YŸKú\ùX⁄\[ùÀôõ‹ëXX⁄
Oà»€€ú››HX›‹î›]\ÀôŸ]
òX›‹íY
N»Yà
›
H›ò€€Xò]€àHò[ŸN»JN¬à€€ú›ÿ[ì‹ŸHH›YŸKú\ùX⁄\[ùÀú€€YJOàò€€Xò]€à	âàòÿ[ì‹ŸJN¬àYà
Xÿ[ì‹ŸJH»€€ù[ùYU Ÿ]ô\€€ôYô^
›YŸKöY›YŸKõô^
JN»ô]\õé»Bà€€ú›[ûQ[ù]HH[ù]Y\ÀôŸ]
›YŸKú\ùX⁄\[ù÷ÃOÀòX›‹íY
N¬à‹[ì[ôJ[ûQ[ù]K	–€€Xò]ô\›[	À	–H⁄\òX›\àX\öŸYÿ[à‹ŸHX^H\ŸHHŸ\\ò]H‹‹»úò[ò⁄â Kù[ä

HOà¬à⁄›–⁄⁄XŸS‹[€ú ¬à»^à	”õ»‹‹…À€ê€X⁄Œà

HOà€€ù[ùYU Ÿ]ô\€€ôYô^
›YŸKöY›YŸKõô^
JHKà»^à	”‹‹»\[ú…À€ê€X⁄Œà

HOà€€ù[ùYU Ÿ]ô\€€ôYô^
›YŸKöY›YŸKõ‹‹”ô^
JHKàJN¬àJN¬à›]ÿŸ[ôTô]öY]–Yò[òŸHH

HOàﬂN¬àK
›YŸKô\ò][€à
H
àL
N¬àBÇàù[ò›[€àù[ëòYJ›YŸJH¬à€€ú›òYQ[H›]ÿŸ[ôTô]öY]—òYQ[

N¬à€€ú›\ôŸ]‹X⁄]HH›YŸKô\ôX›[€àOOH	€›]	»»Hà¬àòYQ[ú›[Kùò[ú⁄][€ë\ò][€àH	‹›YŸKô\ò][€à\ÿ¬àô\]Y\›[ö[X][€ëúò[YJ

HOà»òYQ[ú›[Kõ‹X⁄]HH›ö[ô \ôŸ]‹X⁄]JN»JN¬àŸ][Y[›]


HOà€€ù[ùYU Ÿ]ô\€€ôYô^
›YŸKöY›YŸKõô^
JK
›YŸKô\ò][€à
H
àL
N¬àBÇàÀ»€[€›H\ú»›]ÿŸ[ôTô]öY]÷õ€€T\òŸ[ù
LHHÿ\\ôYàÀ»⁄›	‹»›€à[õ[ŸYöYYúò[Z[ôÀY⁄\àH€‹Ÿ\à8†%ŸYBàÀ»\]Pÿ[Y\òT‹⁄][€â‹»›]ÿŸ[ôVõ€€S][
Húõ€H⁄\ô]ô\à]›\úô[ùBàÀ»⁄]»»›YŸKú\òŸ[ù›ô\à›YŸKô\ò][€àŸX€€ôÀö]ö[ô»BàÀ»ÿ[Y\òH]ô\ûHúò[YH[€ô»Hÿ^Hò]\à[àH⁄[ô€H[ú›[ù›]Çàù[ò›[€àù[ñõ€€J›YŸJH¬à€€ú›úõ€T\òŸ[ùH›]ÿŸ[ôTô]öY]÷õ€€T\òŸ[ù¬à€€ú›‘\òŸ[ùHX]õX^
Lù[Xô\ä›YŸKú\òŸ[ù
HL
N¬à€€ú›\ò][€ì\»HX]õX^

›YŸKô\ò][€àœ»çäH
àL
N¬à€€ú››\ùH\ôõ‹õX[òŸKõõ› 
N¬à€€ú››\H

HOà¬àYà
\ù[õö[ô Hô]\õé¬à€€ú›H\ò][€ì\»H»HàX]õZ[äK
\ôõ‹õX[òŸKõõ› 
HH›\ù
H»\ò][€ì\ N¬à›]ÿŸ[ôTô]öY]÷õ€€T\òŸ[ùHúõ€T\òŸ[ù
»
‘\òŸ[ùHúõ€T\òŸ[ù
H
à¬à\]Pÿ[Y\òT‹⁄][€ä
N¬àYà
JHô\]Y\›[ö[X][€ëúò[YJ›\
N¬à[ŸH€€ù[ùYU Ÿ]ô\€€ôYô^
›YŸKöY›YŸKõô^
JN¬àN¬à›\

N¬àBÇàÀ»X›‹ú»›\ù⁄\ŸH€õHŸ]Z\à›]H
‹⁄][€ã[ô[ûH›\ù[ô¬àÀ»‹ŸHZŸHõ€ôJH\⁄Y€ù»Z\àY\⁄Hö\ú›[YH€€YH›YŸBàÀ»\[ú»»›X⁄[H8†%[àX›‹àHÿŸ[ôHô]ô\à[›ô\»‹à[ö[X]\¬àÀ»€›[⁄]]]»ò]»‹]€àò[úŸõ‹õHõ‹ô]ô\ãà]ô\ûHX›‹â‹¬àÀ»[ö]X[]]‹ôY›]H\»\YY€òŸK\úõ€ù€»Hô\›[ô¬àÀ»õ€ôK‹õ›][€àôXY»€‹úôX›Húõ€Húò[YH€ôH
[ô€»BàÀ»‹ôX]\ôI‹»‹õ›\õ›‹ô‘õ›\ôHŸYYY»X]⁄ôYõ‹ôBàÀ»›]ÿŸ[ôTõ›][€ïX⁄…‹»ö\ú›ôX[X⁄»ô[› KÇàõ‹à
€€ú›X›‹íYŸàX›‹î›]\ÀöŸ^\ 
JH\T›]JX›‹íY
N¬ÇàÀ»€€ù[ù[›\€HX\Ÿ\»]ô\ûHX›‹â‹»õ›][€à›ÿ\ô\⁄\ôYòX⁄[ô—Y¬àÀ»
Ÿ]]‹]€àúõ€H]»ò]»]]‹ôYõ›][€ã[ô\]YûHBàÀ»\õàÿ\ô‹àH[›ôI‹»\úö]ò[òX⁄[ô K]ô\ûHúò[YKõ‹àBàÀ»X›‹â‹»[ù\ôH[YH[àHÿŸ[ôH8†%õ›Hö^YY\ò][€à€ôK\⁄›àÀ»[ö[X][€à]›‹»ö]ö[ô»€òŸHHÿ\ô	‹»›€à[Y\àù[ú»›]ÇàÀ»⁄⁄\»[û[€ôH[à^\õò[Qö]ô[êX›‹íYŒàH[›ôH›YŸI‹»›€ÇàÀ»›\\à
ÿ[Ÿ\ãõ[›ôU›ÿ\ô	‹»\ú€[\‹à\]P‹ôX]\ôSY\⁄àÀ»ö]ô[àûH]ôHò]ô[\ôX›[€äH‹àH€€Xò]›YŸI‹»ôX[àÀ»‹›[SÿöôX›Àÿ€€\[ö[€ìÿöôX›»RH[ôXYH›€ú»Z\àõ›][€ÇàÀ»]úò[YKÇà]›]ÿŸ[ôTõ›\›H\ôõ‹õX[òŸKõõ› 
N¬àù[ò›[€à›]ÿŸ[ôTõ›][€ïX⁄ 
H¬àYà
\ù[õö[ô Hô]\õé¬à€€ú›õ›»H\ôõ‹õX[òŸKõõ› 
N¬à€€ú›HX]õZ[äåK
õ›»H›]ÿŸ[ôTõ›\›
H»L
N¬à›]ÿŸ[ôTõ›\›Hõ›Œ¬àõ‹à
€€ú›ÿX›‹íY›HŸàX›‹î›]\ H¬àYà
^\õò[Qö]ô[êX›‹íYÀö\ X›‹íY
JH€€ù[ùYN¬à€€ú›[ù]HH[ù]Y\ÀôŸ]
X›‹íY
N¬àYà
Y[ù]JH€€ù[ùYN¬à€€ú›\ôŸ]Y»H\⁄\ôYòX⁄[ô—YÀôŸ]
X›‹íY
Hœ»›úõ›][€é¬àYà
[ù]Kö⁄[ôOOH	ÿ‹ôX]\ôI»	âà[ù]Kò‹ôX]\ôJH¬àÀ»H^X›ÿ[YHù[ò›[€àôX[⁄[ÿ€€\[ö[€à‹ôX]\ô\»\ôBàÀ»ö]ô[àõ›Y⁄]ô\ûHúò[YH⁄]\à[›ö[ô»‹à€[ô»›[àÀ»
ŸYH\]R‹›[\À›\]P€€\[ö[€ú Nà‹õ›\õ›X\Ÿ\¬àÀ»›ÿ\ôHò]»\ôŸ]⁄]õ»XYõ€ôHŸà]»›€ã⁄[BàÀ»H‹õ‹‹ŸY\[ôH‹ö]HŸ]»]»›€àŸ\\ò]H\ú€[\àÀ»XYõ€ôH
ÿ[Y\òTô[]]ôP‹ôX]\ôT\úÀ–‘ëPUTëW‘Tî—PQ¬àÀ»êQ
H[ù\õò[H€»]ô]ô\à€Ÿ\»YŸK[€ãÇàÀ¬àÀ»\]P‹ôX]\ôSY\⁄	‹»›€àZ[P[ô€H\ò[Y]\à\»Hò]¬àÀ»€‹õY\ôX›[€à[ô€K€€ùô\ùY[ù\õò[HöXBàÀ»ò]’\ôŸ]õ›HHJZ[P[ô€JH
»KÃà8†%HôYõX›Yô[][€ú⁄\àÀ»⁄]‹õ›\õ›õ›H⁄[\HY]]ôHŸôúŸ]à\ôŸ]Y»\ôBàÀ»\»[àHô\ôX›[Ÿ[K\õ›][€àà€€ùô[ù[€à]ô\ûH›\ÇàÀ»‹ôX]\ôHõ›][€à]\Ÿ\»[ú›XY
\õàÿ\ôÀ‹]€ãBàÀ»€€	‹»›€à⁄^õ[À‹ô]öY] K€»]\»»€»õ›Y⁄BàÀ»[ùô\úŸHŸà]ÿ[YHX\[ô»
‹ôX]\ôPZ[P[ô€Qõ‹ë‹õ›\õ›
BàÀ»»[ô‹õ›\õ›€àHX›X[]]‹ôY[ô€Hò]\à[ÇàÀ»]»Z\úõ‹ãÇà\]P‹ôX]\ôSY\⁄
[ù]Kò‹ôX]\ôK‹ôX]\ôPZ[P[ô€Qõ‹ë‹õ›\õ›
ëQKìX]][ÀôY’‘òY
\ôŸ]Y JJN¬à\]P‹ôX]\ôP[ö[Qúò[YJ[ù]Kò‹ôX]\ôKò[ŸJN¬à›úõ›][€àHëQKìX]][ÀúòY—Y [ù]Kò‹ôX]\ôKô‹õ›\õ›
N¬àH[ŸH¬àÀ»îÀ‹^Y\ã‹XŸZ€\éàHÿ[YHYHôòXŸH^Y\ààX\ŸBàÀ»ôX[›][€ò\ûHî‹»\ŸH
ŸYHòXŸSú—X[Ÿ›YT\ùX⁄\[ù…‹¬àÀ»ú—òXŸT^Y\ì\ú
H8†%Hõ]€⁄[ã\[ôH]ò]\à\»õ»YŸK[€ÇàÀ»\‹›YH»XY^õ€ôHYÿZ[ú›€»\ôI‹»õ›[ô»[ŸH\¬àÀ»ôYY»»ù[àõ›Y⁄Çà€€ú›Ÿô»Hú—X[Ÿ›YT›Y⁄[ô–€€ôöY 
N¬à€€ú››\úô[ùHëQKìX]][ÀôY’‘òY
›úõ›][€äN¬à€€ú›ô^H›\úô[ù
»[ô€QYôäëQKìX]][ÀôY’‘òY
\ôŸ]Y K›\úô[ù
H
à
ŸôÀõú—òXŸT^Y\ì\úœ»åé
N¬à›úõ›][€àHëQKìX]][ÀúòY—Y ô^
N¬à\T›]JX›‹íY
N¬àBàBàô\]Y\›[ö[X][€ëúò[YJ›]ÿŸ[ôTõ›][€ïX⁄ N¬àBà›]ÿŸ[ôTõ›][€ïX⁄ 
N¬ÇàYà
\›YŸS‹ô\ãõ[ô›
H»ö[ö\⁄
	‘ô]öY]»›‹Y8†%\»ÿŸ[ôH\»õ»ÿ\ôÀâ N»ô]\õé»Bà›]ÿŸ[ôTô]öY]–ò[õô\ä<'„´	‹^[ÿYù]H	–›]ÿŸ[ôHô]öY]…ﬂXò[ŸJN¬àù[î›YŸJ›YŸS‹ô\ñÃJN¬àBÇàYà
⁄[ô›Àó◊⁄ÿù[ööP›]ÿŸ[ôTô]öY] H¬àù[ê›]ÿŸ[ôTô]öY] ⁄[ô›Àó◊⁄ÿù[ööP›]ÿŸ[ôTô]öY] Kòÿ]⁄
\úàOà¬à€€ú€€Kô\úõ‹ä	÷ÿ›]ÿŸ[ôHô]öY]◊HòZ[Y»›\ùâÀ\úäN¬à›]ÿŸ[ôTô]öY]–X›]ôHHò[ŸN¬à›]ÿŸ[ôTô]öY]–ò[õô\ä	‘ô]öY]»òZ[Y»›\ù8†%ŸYH€€ú€€KâÀùYJN¬àJN¬àBÇàô\]Y\›[ö[X][€ëúò[YJÿ[YS€‹
N¬àJJ
N¬