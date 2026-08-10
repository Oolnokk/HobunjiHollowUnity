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
      const dodgeBtn = document.getElementById('dodgeBtn');
      const btnSwapTarget = document.getElementById('btnSwapTarget');
      const btnWeaponSwitch = document.getElementById('btnWeaponSwitch');
      const btnWeaponSwitchIcon = document.getElementById('btnWeaponSwitchIcon');
      const btnCallMount = document.getElementById('btnCallMount');

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
      const toolPicker     = document.getElementById('toolPicker');
      const toolPickBtns   = [...document.querySelectorAll('.tool-pick-btn')];
      // actionRows removed ‚Äî refreshActionBar now targets fixed #btnActionN elements

      // Item scroll
      const itemPrev   = document.getElementById('itemPrev');
      const itemNext   = document.getElementById('itemNext');
      const itemIcon   = document.getElementById('itemIcon');
      const itemName   = document.getElementById('itemName');
      const itemCount  = document.getElementById('itemCount');


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
        if (id === 'map') window.WildernessMap.renderMapPanel();
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
        // favor ask): if this NPC posted/asked a quest that's now sitting
        // ready in the player's log, offer to hand it over right here rather
        // than piling a new favor ask on top of an already-completed one.
        const _turnInTask = rec?.id ? window.ProceduralTasks.getTurnInReadyTaskForNpc(rec.id) : null;
        if (_turnInTask) {
          const _turnInDef = ITEM_DEFS[_turnInTask.itemKey];
          window.DialogueContent?.beginSyntheticChoice(rec);
          window.DialogueContent?.renderDlgNode({
            type: 'choice',
            text: `Ah ‚Äî did you bring what I asked for?`,
            choices: [
              { label: `Here's your ${_turnInDef?.label || _turnInTask.itemKey} √ó${_turnInTask.qty}.`, actions: [{ type: 'turnInTask', taskId: _turnInTask.id }] },
              { label: 'Not yet.', actions: [] },
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
        if (_dialogueWalker) {
          if (_dialogueWalker.neckJoint) _dialogueWalker.neckJoint.rotation.y = 0;
          _dialogueWalker.pause = 0;
          _dialogueWalker.catchup = 3.5;
          _dialogueWalker.catchupDur = 8;
          _dialogueWalker = null;
        }
        activeCameraMode = cameraConfig().defaultMode || 'default';
        activeCameraTarget = null;
        dialogueZoomPointers.clear();
        dialoguePinchDistance = null;
        if (dialogueZoomConfig().resetOnDialogueClose) resetDialogueCameraZoom();
        else updateDialogueZoomIndicator();
        _arcContainerEl?.classList.remove('arc-hidden');
        _npcDialogueEl.classList.remove('open');
        _npcDialogueEl.setAttribute('aria-hidden', 'true');
        saveMemberWorldData(); // persist visited-node/memory state mutated during the conversation
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
      // its own effort ratio rather than using a flat distance.
      const MOVE_BOB_WALK_AMP = 0.015;
      const MOVE_BOB_RUN_AMP  = 0.03;
      const ACCEL         = 980;  // px/s¬≤; used by updateMovement() for snappier starts.
      const TURN_ACCEL    = 1320; // px/s¬≤; used when input reverses or sharply turns.
      const DECEL         = 1850; // px/s¬≤; used by updateMovement() to avoid floaty stops.
      const CARDINAL_BIAS = 0.18; // used by updateMovement(); lower keeps diagonals less sticky.
      const JOYSTICK_RADIUS = 56; // Fallback radius; updateJoystick() scales to the current viewport-anchored joystick size.
      const JOYSTICK_DEADZONE = 0.14; // used by updateJoystick() to prevent thumb drift near center.
      const JOYSTICK_RESPONSE = 0.82; // used by updateJoystick() to make small thumb motion feel responsive.
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
      // Floor Z: RAISED=+1, GRASS/TILLED/PADDY/WEEDS=0, TRENCH=-1, ROCK/SHRUB=solid(no water)
      // Water surface = floorZ + water depth.
      const MAX_WATER    = 3.0;  // max depth in "units"
      const RAIN_RATE    = 0.018; // depth added per sim tick during rain (√órainStrength)
      const ABSORB_RATE  = {     // depth drained per tick by soil absorption
        [TileType.GRASS]:  0.012,  // doubled ‚Äî grass roots drink efficiently
        [TileType.WEEDS]:  0.008,
        [TileType.TILLED]: 0.018,  // broken soil drains fastest (no root binding)
        [TileType.RAISED]: 0.025,  // elevated ‚Äî gravity-drains quickly
        [TileType.PADDY]:  0.003,  // sealed low bowl, retains water
        [TileType.TRENCH]: 0.000,  // sealed clay ‚Äî no absorption, only flow
        [TileType.ROCK]:   0,
        [TileType.SHRUB]:  0,
        [TileType.PATH]:   0.006, // hard-packed surface drains slowly
      };
      const EVAP_RATE    = 0.002;  // evapotranspiration ‚Äî drains all tiles slowly even when dry
      const FLOW_RATE         = 0.45;  // fraction of head difference transferred per tick
      const TRENCH_FLOW_BONUS = 3.0;   // trenches pull water from neighbours faster (scaled by tile.depth)
      // West/east edges seep water in from the surrounding far terrain (instead of
      // only the south edge draining out) so a player can't starve the whole
      // irrigation system just by damming the north-south channel ‚Äî the far
      // terrain still gets in from the sides. Fraction of the gap to the far
      // terrain's level closed per tick.
      const SIDE_INFLOW_RATE  = 0.06;
      // How fast the far terrain immediately south of the map (the decorative
      // border terrain) tracks the south-edge tile's water level, per column.
      // Low = the gap a player digs at the south edge visibly continues into
      // the far terrain rather than snapping dry/wet instantly.
      const FAR_SOUTH_TRACK_RATE = 0.2;
      // Rain gradually silts trenches back in ‚Äî depth drains while raining and the
      // trench reverts to grass once fully filled. Redigging (single tap) restores depth to 1.
      const TRENCH_SILT_RATE  = 0.0006;  // depth lost per sim tick, per unit rain strength

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
        weapon:  ['cut', 'slash'],
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
        harvest:    ['üß∫', 'Harvest'],
        fish:       ['üé£', 'Fish'],
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

      // Helper: floor Z for a tile type. Trenches shallow out toward 0 as they silt up.
      function floorZ(type, depth = 1) {
        if (type === TileType.RAISED) return  1;
        if (type === TileType.TRENCH) return -clamp(depth, 0, 1);
        return 0;  // ROCK, SHRUB, and all normal tiles sit at Z=0
      }
      // Max water a tile can hold ‚Äî trenches scale down with depth as they silt in.
      function tileWaterCapacity(tile) {
        return tile.type === TileType.TRENCH ? MAX_WATER * clamp(tile.depth ?? 1, 0, 1) : MAX_WATER;
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
        lungeDirX: 0, lungeDirY: 0, lungeDistancePx: 0, lungeHopUnits: 0, lungeHopCurrent: 0, lungeHitTest: null,
        // Cliff climbing ‚Äî see startClimb()/updateMovement. A scripted crossing
        // (no stamina cost, no terrain collision) rendered as a chain of
        // staggered hops rather than a continuous slide; climbSurfaceY/
        // climbHopBounce are consumed by updatePlayerMesh for the vertical rise.
        climbing: false, climbElapsed: 0, climbHopCount: 0,
        climbStartX: 0, climbStartY: 0, climbEndX: 0, climbEndY: 0,
        climbSurfaceStartY: 0, climbSurfaceEndY: 0, climbSurfaceY: 0, climbHopBounce: 0,
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
      const PLAYER_KNOCKBACK_PX_S = 600;
      const COMPANION_BITE_KNOCKBACK_PX_S = 560;
      const HOSTILE_BITE_KNOCKBACK_PX_S = 480;

      function applyKnockback(target, fromX, fromY, speedPxS) {
        const ang = Math.atan2(target.y - fromY, target.x - fromX);
        target.knockbackT = KNOCKBACK_DUR_S;
        target.knockbackVX = Math.cos(ang) * speedPxS;
        target.knockbackVY = Math.sin(ang) * speedPxS;
        // Getting hit always interrupts an in-progress combat lunge ‚Äî without
        // this, resuming the lunge after knockback would interpolate from its
        // stale pre-knockback lungeStartX/Y and jump the player backward.
        if (target.lunging) { target.lunging = false; target.lungeHopCurrent = 0; }
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
        return {
          health: amount * healthMultiplier,
          footing: amount * footingMultiplier,
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
        if (entity.footing <= 0) { enterProneIfFootingDepleted(entity, isPlayer, direction); return; }

        const footingFrac = entity.maxFooting ? clamp(entity.footing / entity.maxFooting, 0, 1) : 1;
        const lossRange = 1 - maxDurationAtFootingFrac;
        const staggerProgress = lossRange > 0 ? clamp((1 - footingFrac) / lossRange, 0, 1) : 1;
        const durationS = baseDurationS + (maxDurationS - baseDurationS) * staggerProgress * staggerProgress;

        if (isPlayer) {
          const clip = window.ImpactBlendLibrary?.getClip('impact', direction);
          const durationMultiplier = clip?.durationSeconds > 0 ? durationS / clip.durationSeconds : 1;
          window.ImpactRagdollPlayback?.trigger('impact', direction, { durationMultiplier });
        }
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
      // No bespoke ragdoll-fall visual exists for arbitrary creature rigs the
      // way ImpactRagdollPlayback provides for the player (billboard sprite +
      // procedural legs only) ‚Äî a prone creature just holds still (see that
      // `if (c.prone)` branch pre-empting its whole AI dispatch) until it
      // springs back up.
      function enterProneIfFootingDepleted(entity, isPlayer, direction) {
        if (entity.footing > 0 || entity.prone) return;
        entity.prone = true;
        // Creatures/bandits need nothing further here ‚Äî damageCreature
        // already cancelled any in-progress bandit action before calling
        // applyHitStagger, and updateHostiles' `if (c.prone)` branch takes
        // over from here (see beginCreatureSomersaultRecovery above).
        if (!isPlayer) return;
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
          modelWidth: 1.6, tint: 0xffffff,
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
          canClimb: false, canSwim: false, modelWidth: WILDLIFE_CREATURE_MODEL_WIDTHS.drenkirra, spriteAspect: 523 / 831, tint: 0xffffff,
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
          canClimb: false, canSwim: false, modelWidth: WILDLIFE_CREATURE_MODEL_WIDTHS['drenkirra-den-mother'], spriteAspect: 523 / 831, tint: 0x789078,
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
          groundColor: 0x2d4a3a, fogColor: 0x1c2e24,
          herbivoreSpecies: ['drenkirra'],
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
      // Every shape is unlocked from the start ‚Äî "you unlock all the current
      // ones by default" ‚Äî this is just the set Sloomi/Kzubug's crafting
      // counter offers; it's never spent/consumed so it isn't gearInventory
      // state the way owned tools/mastery/plating are.
      const UNLOCKED_TOOL_SHAPES = Object.keys(TOOL_SHAPE_DEFS);
      function craftedToolItemKey(shapeKey, metalKey) { return shapeKey + '_' + metalKey; }

      // Registers one TOOL_ITEM_DEFS entry per (shape √ó verdigris metal)
      // combination ‚Äî the original 5 hand-authored keys above (bronzehoe,
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
            itemKey, // self-reference ‚Äî lets icon rendering resolve mastery/plating without a separate key param
          };
        }
      }

      // Drives the weapon-tool loadout's Combo slot (see combat-loadout.js) ‚Äî
      // a sweep-style weapon (hatchet, fishing mace) plays the 3-Swing Combo,
      // a thrust-style weapon (fishing spear, pick-shovel) plays the 3-Poke
      // Combo. No weapon equipped falls back to the swing combo, same as the
      // legacy 'slash' action's own default.
      function currentComboAbilityId() {
        const def = TOOL_ITEM_DEFS[equipmentSlots.weapon];
        return def?.animStyle === 'thrust' ? 'pokeCombo' : 'swingCombo';
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
          tools:    { hoe_nativeCopper: true, hatchet_nativeCopper: true, fishingmace_nativeCopper: true, fishingspear_nativeCopper: true, pickshovel_nativeCopper: true },
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
          itemKey: 'squeezerFurniture', icon: 'üßÉ', name: 'Hand Squeezer', method: 'squeezing', color: 0x4f9eb8,
          desc: 'Placeable processor for squeezing: berries into juice now; dews, milk-like liquids, and nut oils later.'
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
        // Game-authored fixtures (fixture: true) ‚Äî spawned by the game itself
        // inside specific building interiors (see BUILDING_FIXTURE_INTERACTABLES
        // below), never bought/carried by the player, so they're excluded from
        // DECORATIVE_FURNITURE_CATALOG just below. They're still ordinary
        // mapData.furniture entries otherwise: placeable, moveable and
        // duplicateable in the Interior Editor like anything else.
        alchemyTable:  { itemKey: 'alchemyTableFurniture',  icon: '‚öóÔ∏è', name: 'Alchemy Table',        price: 0,  fw: 1, fd: 1, color: 0x6b4a8a, area: 'interior', desc: 'A cauldron table for brewing potions.', fixture: true },
        bulletinBoard: { itemKey: 'bulletinBoardFurniture', icon: 'üìã', name: 'Bulletin Board',       price: 0,  fw: 1, fd: 1, color: 0x8a6a3a, area: 'interior', desc: 'A notice board for public tasks and favors.', fixture: true },
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
        price: Math.max(5, Math.round(item.price * 0.5)),
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

      function canPlaceFurnitureAt(col, row) {
        const tile = grid[row]?.[col];
        if (!tile || getWorldObjectAt(col, row)) return false;
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

      function makeProcessingFurniture(col, row, furnitureKey, savedJob) {
        const def = PROCESSING_FURNITURE_DEFS[furnitureKey];
        if (!def) return null;
        const mesh = buildFurnitureVisual(furnitureKey, def.color);
        mesh.position.set(col + 0.5, tileSurfaceY(grid[row][col].type), row + 0.5);
        _markOutline(mesh);
        _markFurnitureEdgeId(mesh);
        scene.add(mesh);

        const isAging = AGING_METHODS.has(def.method);
        // { outputs: [descriptor,...], readyDay } while a barrelAging/vaseAging
        // batch is aging; null when idle. Restored from a saved farm layout
        // (see saveFarmLayout/applyFarmLayoutObjects) via savedJob so an aging
        // batch survives a save/reload instead of silently vanishing.
        let job = savedJob ? { outputs: savedJob.outputs, readyDay: savedJob.readyDay } : null;

        // ‚îÄ‚îÄ Processing VFX (docs/js/authored-furniture-runtime.js) ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ
        // Reuses whatever processingWarps/particleEmitters this piece's
        // authored data carries ‚Äî no-ops entirely for furniture keys with
        // no authored data yet (AUTHORED_FURNITURE_KEYS). vfxT is this
        // object's own clock, only advanced while updateProcessingFurnitureVfx
        // actually ticks it (farm scene only), so playback never jumps on
        // a scene revisit.
        const authoredVfx = AUTHORED_FURNITURE_KEYS.has(furnitureKey) ? window.AuthoredFurniture?.peek(furnitureKey) : null;
        const emitterVisuals = (authoredVfx?.particleEmitters || []).map(e => window.AuthoredFurniture.createEmitterVisual(mesh, e));
        let vfxT = 0;
        let burstRemaining = 0;
        function vfxActive() { return (isAging && !!job) || burstRemaining > 0; }
        function triggerBurst() { if (!isAging) burstRemaining = PROCESS_BURST_S; }
        function updateVfx(dt) {
          if (!authoredVfx) return;
          vfxT += dt;
          if (burstRemaining > 0) burstRemaining = Math.max(0, burstRemaining - dt);
          const active = vfxActive();
          for (const warp of authoredVfx.processingWarps || []) {
            if (active) window.AuthoredFurniture.applyWarp(mesh, warp, vfxT);
            else window.AuthoredFurniture.resetWarp(mesh, warp);
          }
          for (const ev of emitterVisuals) ev?.update(dt, active);
        }

        return {
          id: 'processor_' + furnitureKey + '_' + col + '_' + row,
          type: 'processing_furniture', furnitureKey, method: def.method, col, row, mesh,
          label: def.icon + ' ' + def.name,
          update: updateVfx,
          triggerVfx: triggerBurst, // used by autoSqueezeDewAtVat (livestock-to-vat automation)
          getJob() { return job; }, // read by saveFarmLayout
          getButtons() {
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
            if (isAging && job) {
              if (calendar.day < job.readyDay) return { ok: false, message: 'Still aging ‚Äî not ready yet.' };
              const outputs = job.outputs;
              job = null;
              outputs.forEach(o => { ensureProcessedItemDef(o); inventory[o.key] = Math.min(99, (inventory[o.key] || 0) + 1); });
              saveFarmLayout();
              window.AudioSystem?.playObjectSfx(window.AudioSystem?.objectSfxConfig()[PROCESSING_SFX_KEY[furnitureKey]]);
              return { ok: true, message: def.icon + ' Collected ' + outputs.map(o => o.label).join(', ') + '.' };
            }
            const active = getActiveInventoryItem();
            if (!active) return { ok: false, message: def.name + ' needs an ingredient selected.' };
            const outputs = getProcessingOutputs(def.method, active.key);
            if (!outputs) return { ok: false, message: def.name + ' cannot process ' + (ITEM_DEFS[active.key]?.label || active.label) + '.' };
            if ((inventory[active.key] || 0) < 1) return { ok: false, message: 'No ' + (ITEM_DEFS[active.key]?.label || active.label) + ' left.' };
            inventory[active.key]--;
            clampInventoryStack(active.key);
            if (isAging) {
              job = { outputs, readyDay: calendar.day + AGING_DURATION_DAYS };
              saveFarmLayout();
              window.AudioSystem?.playObjectSfx(window.AudioSystem?.objectSfxConfig().processStart);
              return { ok: true, message: `${def.icon} Set ${ITEM_DEFS[active.key]?.label || active.label} to age for ${AGING_DURATION_DAYS} days.` };
            }
            outputs.forEach(o => { ensureProcessedItemDef(o); inventory[o.key] = Math.min(99, (inventory[o.key] || 0) + 1); });
            window.AudioSystem?.playObjectSfx(window.AudioSystem?.objectSfxConfig()[PROCESSING_SFX_KEY[furnitureKey]]);
            triggerBurst();
            return { ok: true, message: def.icon + ' Processed 1 ' + (ITEM_DEFS[active.key]?.label || active.label) + ' into ' + outputs.map(o => o.label).join(', ') + '.' };
          },
          reset() {
            scene.remove(mesh);
            emitterVisuals.forEach(ev => ev?.dispose());
            mesh.traverse(child => {
              if (child.geometry) child.geometry.dispose();
              if (child.material) child.material.dispose();
            });
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
        const o = interiorFurnitureObjects.find(f => f.area === 'interior' && f.col === col && f.row === row);
        if (!o) return null;
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
          return obj ? { kind: 'decorative', key: obj.key, rotYDeg: obj.rotYDeg || 0, ignoreId: obj.id } : null;
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
          ? canPlaceFurnitureAt(col, row)
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
          markTileDirty(col, row); recomputeWater(false); saveFarmLayout();
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
          markTileDirty(col, row); recomputeWater(false); saveFarmLayout();
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
                layout.tiles.push({ c, r, type: t.type, crop: t.crop || '', dewPile: t.dewPile || '' });
              }
            }
          }
          processingFurnitureObjects.forEach(obj => {
            const job = obj.getJob && obj.getJob();
            layout.furniture.push({ key: obj.furnitureKey, col: obj.col, row: obj.row, ...(job ? { job } : {}) });
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
            layout.buildings = farmBuildings.map(b => ({ id: b.id, kind: b.kind, tier: b.tier, col: b.col, row: b.row, w: b.w, h: b.h, stage: b.stage }));
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

      function applyFarmLayoutToGrid(layout) {
        if (!layout || layout.version !== 3) return;
        (layout.tiles || []).forEach(({ c, r, type, crop, dewPile }) => {
          if (grid[r]?.[c]) {
            grid[r][c].type = type;
            // Saved layouts don't persist trench depth ‚Äî restore at full depth.
            if (type === TileType.TRENCH) grid[r][c].depth = 1;
            grid[r][c].crop = crop || CropType.NONE;
            if (crop) { grid[r][c].cropAge = 50; grid[r][c].cropReady = false; }
            grid[r][c].dewPile = dewPile || null;
          }
        });
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
        (layout.furniture || []).forEach(({ key, col, row, job }) => {
          if (PROCESSING_FURNITURE_DEFS[key] && canPlaceFurnitureAt(col, row)) {
            const obj = makeProcessingFurniture(col, row, key, job);
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
          const entry = { id: saved.id, kind: 'barn', tier: saved.tier, col: saved.col, row: saved.row, w: saved.w || window.FarmBuildings.FOOTPRINT_W, h: saved.h || window.FarmBuildings.FOOTPRINT_D, stage: saved.stage || 'foundation' };
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
      const SEATED_LOOK_ROTATE_DEG_PER_SEC = 110; // movement input's rotate-the-view speed while seated (see updateSitInteraction)
      const SEATED_CAMERA_PITCH_CLAMP_DEG = 45; // up/down joystick pitch allowance while seated, matches the desktop drag default
      const SEATED_HEAD_MAX_YAW_DEG = 70; // realistic head-turn-without-body-turning range; look straight ahead past this instead of holding at the clamp (see updateSitInteraction)

      // Resolves a furniture instance's seat anchor (local, footprint-center-
      // relative ‚Äî see docs/js/authored-furniture-runtime.js) into this
      // placement's actual world position/facing. rotYDeg is the furniture's
      // own placement yaw (0 for every current player-placed decorative/
      // processing furniture path, since none of them support rotation yet).
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
          // rotation applied for rotYDeg ‚Äî every current player-placed
          // furniture path always places at rotYDeg 0 (see the comment
          // above this function), so anchor-local and world pitch/roll
          // already coincide.
          normalDeg: { x: anchor.rotationDeg.x || 0, z: anchor.rotationDeg.z || 0 },
          footprintHalfDepth: Math.max(0.05, (Number(data.footprint?.d) || 1) / 2),
          anchorZ: az,
        };
      }

      function beginSitInteraction(furnitureKey, col, row, fw, fd, rotYDeg, seatIndex) {
        if (sitInteraction || window.FarmAnimals.isHarvesting() || dialogueOpen || (window.Mounts?.rideState ?? 'none') !== 'none') return { ok: false, message: 'Cannot sit right now.' };
        const seat = resolveSeatWorldTransform(furnitureKey, col, row, fw, fd, rotYDeg, seatIndex);
        if (!seat) return { ok: false, message: 'Nowhere to sit there.' };
        const targetX = seat.x * TILE, targetY = seat.z * TILE;
        const targetAngle = seat.facingRad;
        sitInteraction = {
          furnitureKey, col, row,
          phase: 'in', t: 0,
          startX: player.x, startY: player.y, startAngle: facingAngle,
          targetX, targetY, targetAngle,
          seatWorldY: seat.y,
          seatNormalDeg: seat.normalDeg,
          seatFootprintHalfDepth: seat.footprintHalfDepth,
          seatAnchorZ: seat.anchorZ,
          prevCameraMode: activeCameraMode, prevCameraTarget: activeCameraTarget,
        };
        activeCameraMode = 'seated';
        activeCameraTarget = { position: new THREE.Vector3(seat.x, seat.y + 0.15, seat.z) };
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
          // Head-turn (not the whole body) toward wherever the camera has
          // orbited to, using the same neck-bone mechanism the animation-
          // author tool/NPC dialogue staging use (see
          // faceNpcDialogueParticipants) ‚Äî lets you inspect your own
          // character's face as you swing the camera around without the
          // body itself rotating. playerMesh.rotation.y = activeCameraAzimuthRad()
          // is exactly the sprite orientation that faces the camera (both
          // are the same THREE.js Y-rotation convention ‚Äî the plane's local
          // +Z, after that rotation, points from the character straight at
          // the camera), so the residual against the body's own CURRENT
          // rotation (whatever the dead zone has it holding at right now)
          // is exactly how far the head alone needs to turn. Only within a
          // realistic range ‚Äî past it, look straight ahead (0) rather than
          // holding at the clamp like the NPC dialogue case, so an extreme
          // camera angle just shows the back of a naturally forward-facing
          // head instead of a craned neck.
          if (playerNeckJoint) {
            const residual = angleDiff(activeCameraAzimuthRad(), playerMesh.rotation.y);
            const maxYawRad = SEATED_HEAD_MAX_YAW_DEG * Math.PI / 180;
            playerNeckJoint.rotation.y = Math.abs(residual) <= maxYawRad ? residual : 0;
          }
          return;
        }
        if (playerNeckJoint) playerNeckJoint.rotation.y = 0;
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
            activeCameraMode = s.prevCameraMode ?? (cameraConfig().defaultMode || 'default');
            activeCameraTarget = s.prevCameraTarget ?? null;
            cameraAzimuthOffsetDeg = 0;
            cameraAngleOffsetDeg = 0;
            sitInteraction = null;
          }
        }
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
      function _getGenotypeTextures(kind, frame, genotype) {
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
        const key = `${kind}|${frame}|${sig}`;
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
            window.__farmLog?.(`[genotype-render] _getGenotypeTextures(${kind},${frame}): cache miss, sig="${sig}" ‚Äî kicking off composeFrame`, 'wildlife');
          }
          renderer.composeFrame(kind, frame, genotype).then(canvas => {
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
      function setCreatureFrame(avatarRef, url, genotypeKind, frameKey, genotype) {
        const genoTex = (genotypeKind && genotype) ? _getGenotypeTextures(genotypeKind, frameKey, genotype) : null;
        const front = genoTex?.front || _getCreatureFrontTexture(url);
        const back = genoTex?.back || _getCreatureBackTexture(url);
        for (const child of avatarRef.group.children) {
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

      // Scans a species' idle sprite (cached per URL, so only the first
      // creature of each species actually pays for it) for how far down its
      // real opaque pixels extend. All these sprites are nominally
      // 1375√ó600, but if the art itself doesn't reach the canvas's bottom
      // edge (transparent padding), anchoring on the raw rectangle leaves
      // the visible creature hovering above the ground/its own shadow.
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
          const bounds = window.PNGPlaneAvatar?.scanOpaqueVerticalBoundsOfImage?.(img);
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
        const halfH = modelHeight * sizeScale.y / 2; // Keeps the scaled sprite's feet on the terrain.
        const idUniq = (performance.now() | 0) + '_' + Math.floor(Math.random() * 100000);
        const avatarRef = window.PNGPlaneAvatar.buildAnimalPlaneAvatarModel(THREE, def.sprites.idle, {
          modelWidth, modelHeight,
          name: creatureKey + '_' + idUniq,
        });
        avatarRef.frontPlane = avatarRef.group.children[0] || null;
        avatarRef.backPlane  = avatarRef.group.children[1] || null;
        avatarRef.group.scale.set(sizeScale.x, sizeScale.y, 1);
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
        avatarRef.group.position.set(x / TILE, surfY + halfH, y / TILE);
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
      function rollItemStars() {
        const weights = [1, 3, 5, 3, 1]; // stars 1..5
        const total = weights.reduce((a, b) => a + b, 0);
        let r = rnd() * total;
        for (let i = 0; i < weights.length; i++) {
          r -= weights[i];
          if (r <= 0) return i + 1;
        }
        return 3;
      }
      function starRatingText(stars) {
        return '‚òÖ'.repeat(stars) + '‚òÜ'.repeat(5 - stars);
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
              const stars = /meat/i.test(key) ? starRatingText(rollItemStars()) + ' ' : '';
              parts.push(stars + itemIconForKey(key) + '√ó' + qty);
            });
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
        const t = performance.now() / 1000;
        if (t - (c._banditLastCounterAt || -99) >= BANDIT_COUNTER_COOLDOWN_S) {
          c._banditLastCounterAt = t;
          window.BanditCombat.fireCounterRiposte(c, c.def, targetPlayer);
        }
        return amount * (1 - window.BanditCombat.GUARD_DAMAGE_ABSORB);
      }

      function damageCreature(c, amount, fromX, fromY, knockbackPxS, dmgOpts) {
        // Only the player currently ever calls damageCreature (see
        // combat-combo.js/combat-quickattacks.js/combat-charged-breaker.js/
        // combat-counter-shield.js) -- safe to assume `player` is the guarded
        // captain's riposte target without needing a passed-in attacker.
        amount = banditTryGuard(c, amount, player);
        const resourceDamage = hitResourceDamage(amount, dmgOpts);
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
          if (!c.isCompanion) awardMotesOfProwess(MOTES_PER_KILL);
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
        if (c.isBandit) { c._banditAction?.cancel(); c._banditAction = null; c.telegraphState = null; c._banditComboIndex = 0; c._banditLunging = false; }
        if (fromX !== undefined) applyKnockback(c, fromX, fromY, knockbackPxS);
        applyHitStagger(c, false, c.facing || 0, c.x, c.y, fromX, fromY, resourceDamage.footing);
      }

      function damagePlayer(amount, fromX, fromY, knockbackPxS = PLAYER_KNOCKBACK_PX_S, dmgOpts) {
        if (performance.now() < player.invulnUntil) return;
        const resourceDamage = hitResourceDamage(amount, dmgOpts);
        // Lets a held defensive ability (Counter Shield) absorb the hit and
        // riposte instead of applying damage normally ‚Äî only one hold
        // ability can be active at a time, so this is a single settable slot.
        if (window.Combat?.tryInterceptPlayerDamage?.(resourceDamage.health, fromX, fromY)) return;
        _nestHoldT = 0; // getting hit interrupts a den-nest egg/baby take
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
        const dmgOpts = action === 'slash' ? { tag: 'blunt', heavy: true } : { tag: 'sharp' };
        for (const c of hostileObjects) {
          if (c.health <= 0) continue;
          if (c.areaId !== currentArea) continue;
          if (!inCone(player.x, player.y, player.angle, c.x, c.y, abil.rangePx, abil.halfConeRad)) continue;
          damageCreature(c, abil.damage, player.x, player.y, abil.knockbackPxS, dmgOpts);
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

      // Nearest live hostile in the player's current area within lock-on range, or
      // the player's manually-swapped target if still valid, or null.
      // Hardened at the source (not left to every caller to remember): auto
      // target is only ever active while the weapon tool slot is both
      // selected AND actually has a weapon equipped in it ‚Äî every caller
      // gets this for free instead of some checking activeTool alone.
      function findAutoTarget() {
        if (activeTool !== 'weapon' || !equipmentSlots.weapon) {
          manualAutoTarget = null;
          return null;
        }
        const maxDist = TILE * (Number(combatConfig().autoTargetRangeTiles) || 0);
        if (manualAutoTarget) {
          if (manualAutoTarget.health > 0 && manualAutoTarget.areaId === currentArea &&
              Math.hypot(manualAutoTarget.x - player.x, manualAutoTarget.y - player.y) <= maxDist) {
            return manualAutoTarget;
          }
          manualAutoTarget = null;
        }
        let best = null, bestDist = maxDist;
        for (const c of hostileObjects) {
          if (c.health <= 0 || c.areaId !== currentArea) continue;
          const dist = Math.hypot(c.x - player.x, c.y - player.y);
          if (dist <= bestDist) { best = c; bestDist = dist; }
        }
        return best;
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
        if (activeTool !== 'weapon' || !equipmentSlots.weapon) return false;
        const current = findAutoTarget();
        const maxDist = TILE * (Number(combatConfig().autoTargetRangeTiles) || 0);
        let best = null, bestDist = Infinity;
        for (const c of hostileObjects) {
          if (c.health <= 0 || c.areaId !== currentArea || c === current) continue;
          const dx = c.x - player.x, dy = c.y - player.y;
          const dist = Math.hypot(dx, dy);
          if (dist > maxDist || dist < 0.001 || dist >= bestDist) continue;
          const angleToC = Math.atan2(dy, dx);
          if (Math.abs(angleDiff(angleToC, aimAngle)) > SWAP_TARGET_HALF_CONE_RAD) continue;
          bestDist = dist; best = c;
        }
        if (!best) return false;
        manualAutoTarget = best;
        return true;
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
        const nx = dx / dist, ny = dy / dist;
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

      function updateCreatureMesh(c, dt, aimAngle) {
        const g = c.areaGrid || grid;
        const col = clamp(Math.floor(c.x / TILE), 0, (c.areaCols || COLS) - 1);
        const row = clamp(Math.floor(c.y / TILE), 0, (c.areaRows || ROWS) - 1);
        const surfY = g[row]?.[col] ? tileSurfaceYInArea(g[row][col], c.areaId) : 0;
        const grp = c.avatarRef.group;
        // scaleY (driven by attacks like Pounce, default 1) squashes the
        // sprite plane vertically around its own bottom edge rather than its
        // center ‚Äî the target height keeps the creature's feet grounded at
        // surfY instead of sinking into the floor as it crouches.
        const scaleY = c.scaleY ?? 1;
        const tx = c.x / TILE, tz = c.y / TILE, ty = surfY + c.halfHeight * scaleY;
        grp.position.x += (tx - grp.position.x) * Math.min(1, dt * 10);
        grp.position.z += (tz - grp.position.z) * Math.min(1, dt * 10);
        grp.position.y += (ty - grp.position.y) * Math.min(1, dt * 7);
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
        grp.scale.x = c.visualScaleX || 1;
        grp.scale.y = (c.visualScaleY || 1) * scaleY;
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
          const isTarget = !c.isCompanion && c === findAutoTarget();
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

      function updateCreatureAnimFrame(c, dt, moving) {
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
        // Sprite-sheet frame cycling is animal-only. A bandit's avatar is a
        // single portrait plane baked once at spawn (see buildBanditAvatar), so
        // it has no def.sprites to swap between ‚Äî it still gets every
        // position/rotation/facing update via updateCreatureMesh, just no
        // idle/run frame swap.
        if (!c.def.sprites) return;
        if (!moving) {
          const frameKey = 'idle';
          const needsRetry = genotypeKind && !c._genotypeReadyFrames?.has(frameKey);
          if (needsRetry && !c._genotypeLogged?.has(frameKey)) {
            (c._genotypeLogged || (c._genotypeLogged = new Set())).add(frameKey);
            window.__farmLog?.(`[genotype-render] ${c.creatureKey} #${c.id}: requesting composited "${frameKey}" texture (kind=${genotypeKind})`, 'wildlife');
          }
          if (c.currentFrameUrl !== c.def.sprites.idle || needsRetry) {
            const applied = setCreatureFrame(c.avatarRef, c.def.sprites.idle, genotypeKind, frameKey, c.genotype);
            c.currentFrameUrl = c.def.sprites.idle;
            if (genotypeKind && applied) {
              (c._genotypeReadyFrames || (c._genotypeReadyFrames = new Set())).add(frameKey);
              window.__farmLog?.(`[genotype-render] ${c.creatureKey} #${c.id}: composited "${frameKey}" texture APPLIED`, 'wildlife');
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
        const movedPx = Math.hypot(c.x - (c._animLastX ?? c.x), c.y - (c._animLastY ?? c.y));
        c._animLastX = c.x; c._animLastY = c.y;
        c.runFrameDistPx = (c.runFrameDistPx || 0) + movedPx;
        while (c.runFrameDistPx >= RUN_FRAME_STRIDE_PX) {
          c.runFrameDistPx -= RUN_FRAME_STRIDE_PX;
          c.runFrame = (c.runFrame + 1) % c.def.sprites.run.length;
        }
        const url = c.def.sprites.run[c.runFrame];
        const frameKey = 'run' + (c.runFrame + 1);
        const needsRetry = genotypeKind && !c._genotypeReadyFrames?.has(frameKey);
        if (needsRetry && !c._genotypeLogged?.has(frameKey)) {
          (c._genotypeLogged || (c._genotypeLogged = new Set())).add(frameKey);
          window.__farmLog?.(`[genotype-render] ${c.creatureKey} #${c.id}: requesting composited "${frameKey}" texture (kind=${genotypeKind})`, 'wildlife');
        }
        if (c.currentFrameUrl !== url || needsRetry) {
          const applied = setCreatureFrame(c.avatarRef, url, genotypeKind, frameKey, c.genotype);
          c.currentFrameUrl = url;
          if (genotypeKind && applied) {
            (c._genotypeReadyFrames || (c._genotypeReadyFrames = new Set())).add(frameKey);
            window.__farmLog?.(`[genotype-render] ${c.creatureKey} #${c.id}: composited "${frameKey}" texture APPLIED`, 'wildlife');
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
          const radialSign = dist > orbitRadiusPx ? 1 : -1; // 1: close the gap, -1: back off
          const tangentAngle = towardAngle + st.orbitSign * Math.PI / 2;
          const blendAngle = Math.atan2(
            Math.sin(tangentAngle) * 0.8 + Math.sin(towardAngle) * radialSign * 0.2,
            Math.cos(tangentAngle) * 0.8 + Math.cos(towardAngle) * radialSign * 0.2,
          );
          const moveX = c.x + Math.cos(blendAngle) * TILE, moveY = c.y + Math.sin(blendAngle) * TILE;
          const moving = moveCreatureToward(c, moveX, moveY, def.chaseSpeed * 0.85, dt);
          if (st.t >= STAGE_MAX_DURATION_S.evasiveOrbit) beginCreatureBackup(st);
          return { aimAngle: towardAngle, moving };
        }

        return { aimAngle: towardAngle, moving: false };
      }

      function updateHostiles(dt) {
        for (const c of hostileObjects) {
          if (c.health <= 0) continue;
          if (c.areaId !== currentArea) continue;
          const def = c.def;
          c.attackCooldownT = Math.max(0, c.attackCooldownT - dt);
          window.ResourceSystem?.tick(c, dt, { staminaRegenPerSec: c.maxStamina * 0.25 });

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
          const dxp = targetPlayer.x - c.x, dyp = targetPlayer.y - c.y;
          const distToPlayer = Math.hypot(dxp, dyp);
          const distFromHome = Math.hypot(c.x - c.homeX, c.y - c.homeY);
          // A recently-fled animal gets a grace period at home before it can
          // be re-aggro'd by the player or re-picked as ambush prey (see
          // 'fleeing-low-health' below and applyWildlifeSkirmishDamage).
          const onFleeCooldown = c._fleeCooldownUntil > performance.now();

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
            for (const prey of hostileObjects) {
              if (prey === c || prey.health <= 0 || prey.areaId !== c.areaId) continue;
              if (prey.def?.diet !== 'herbivore' || prey.state !== 'at-station-grazing') continue;
              if (prey.grazingPatchId !== c.linkedPatchId) continue;
              if (Math.hypot(prey.x - c.x, prey.y - c.y) > PATROL_SIGHT_RANGE_PX) continue;
              c.state = 'patrol-chase'; c.targetCreature = prey;
              break;
            }
          }
          // Leaving chase mid-windup (player broke the leash) abandons the
          // telegraphed bite/modular attack rather than landing it from way
          // out of range.
          if (c.state !== 'chase' && window.Combat?.telegraph?.isBusy(c)) window.Combat.telegraph.cancel(c);
          if (c.state !== 'chase' && window.Combat?.animalAttacks?.isBusy(c)) window.Combat.animalAttacks.cancel(c);
          if (c.state !== 'chase') {
            clearCreatureStage(c);
            if (c.isBandit) { c._banditAction?.cancel(); c._banditAction = null; c.telegraphState = null; c._banditComboIndex = 0; c._banditLunging = false; }
          }

          let moving = false, aimAngle = c.facing || 0;
          if (c.prone) {
            // Zero-Footing knockdown (see enterProneIfFootingDepleted) ‚Äî the
            // same state the player goes into, just without a bespoke
            // ragdoll-fall visual (no rig/blend data for arbitrary creature
            // avatars ‚Äî see that function's comment): holds completely still,
            // immune to further Footing loss (resource-system.js's
            // spendFooting), pre-empting every other branch below (attacks,
            // telegraph, chase/return/patrol) until Footing regenerates back
            // to full, at which point its own AI immediately springs it back
            // up and away from whatever it was fighting ‚Äî see
            // beginCreatureSomersaultRecovery above.
            if (c.footing >= c.maxFooting) beginCreatureSomersaultRecovery(c, targetPlayer);
          } else if (c.knockbackT > 0) {
            // Reeling from a hit; let the impulse play out before resuming AI.
            // Per-axis canOccupyAt check (same primitive/radius convention as
            // the player's own knockback/dodge/lunge and the pounce/guard-
            // charge leaps below) so a hard shove can't punch a creature
            // through a cliff face, water, or the map edge.
            c.knockbackT = Math.max(0, c.knockbackT - dt);
            const nkx = c.x + c.knockbackVX * dt, nky = c.y + c.knockbackVY * dt;
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
              moving = travelCreatureToward(c, c.homeX, c.homeY, def.chaseSpeed || def.moveSpeed, dt);
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
                moving = moveCreatureToward(c, prey.x, prey.y, def.chaseSpeed || def.moveSpeed, dt);
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
              const result = window.BanditCombat.updateCombatAI(c, dt, targetPlayer, distToPlayer);
              aimAngle = result.aimAngle;
              moving = result.moving;
            } else if (c.retreatT > 0) {
              // Jump back after landing a bite, keeping eyes on the player.
              c.retreatT = Math.max(0, c.retreatT - dt);
              const awayAng = Math.atan2(-dyp, -dxp);
              moving = moveCreatureToward(c, c.x + Math.cos(awayAng) * TILE, c.y + Math.sin(awayAng) * TILE, JUMP_BACK_SPEED, dt);
            } else if (window.Combat?.telegraph?.isBusy(c)) {
              // Stand and wind up ‚Äî the tell (game.js's tint) is the
              // player's cue to step out of attackRangePx before the strike
              // frame's range check below fires.
              window.Combat.telegraph.update(c, dt);
            } else if (window.Combat?.animalAttacks?.isBusy(c)) {
              // Modular named attack (e.g. Pounce) owns position, facing,
              // scale, and sprite frame for its full duration.
              window.Combat.animalAttacks.update(c, dt);
              aimAngle = c.facing;
            } else if (def.behaviorStages) {
              // Slottable behavior-stage cycle (Pounce attempt <-> evasive
              // orbit, separated by a backing-up beat) replaces the plain
              // chase-and-trigger logic below for any creature that lists one.
              const result = updateCreatureBehaviorStage(c, dt, targetPlayer, def, (dist) => {
                const triggerRangePx = creatureAimColliderReachPx(c);
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
              moving = moveCreatureToward(c, targetPlayer.x, targetPlayer.y, def.chaseSpeed, dt);
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
                      if (Math.hypot(targetPlayer.x - c.x, targetPlayer.y - c.y) <= def.attackRangePx) {
                        damagePlayer(def.attackDamage, c.x, c.y, HOSTILE_BITE_KNOCKBACK_PX_S, { tag: def.attackTag || 'sharp', afflictionBonuses: window.ResourceSystem?.afflictionBonusesForTag(def.attackTag) });
                        window.AudioSystem?.playCreatureClawHit(c);
                      }
                      c.retreatT = JUMP_BACK_DUR_S;
                    },
                  });
                }
              }
            }
          } else if (c.state === 'return') {
            moving = travelCreatureToward(c, c.homeX, c.homeY, def.moveSpeed, dt);
            if (moving) aimAngle = Math.atan2(c.homeY - c.y, c.homeX - c.x);
          } else if (c.denKey && window.Music?.isNightTime()) {
            // Denned pack, off the clock ‚Äî head back to the den and settle
            // there instead of continuing to wander (see spawnPackAtDen for
            // homeX/homeY = the den's own anchor point).
            const distFromDen = Math.hypot(c.x - c.homeX, c.y - c.homeY);
            if (distFromDen > DEN_SETTLE_RADIUS_PX) {
              moving = travelCreatureToward(c, c.homeX, c.homeY, def.moveSpeed, dt);
              if (moving) aimAngle = Math.atan2(c.homeY - c.y, c.homeX - c.x);
            } else {
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
                moving = travelCreatureToward(c, wx, wy, def.moveSpeed, dt);
                if (moving) aimAngle = Math.atan2(wy - c.y, wx - c.x);
              } else {
                c.state = 'drinking';
                aimAngle = idleCreatureAimAngle(c.groupRot);
                c._drinkT = (c._drinkT || 0) + dt;
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
                  moving = travelCreatureToward(c, stationX, stationY, def.moveSpeed, dt);
                  if (moving) aimAngle = Math.atan2(stationY - c.y, stationX - c.x);
                } else {
                  c.state = 'at-station-grazing';
                  aimAngle = idleCreatureAimAngle(c.groupRot);
                }
              } else {
                const wanderRadiusPx = c.denKey ? DEN_PACK_WANDER_RADIUS_PX : TILE * 2.2;
                moving = wanderTick(c, dt, c.homeX, c.homeY, wanderRadiusPx);
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
              moving = travelCreatureToward(c, targetX, targetY, def.moveSpeed, dt);
              if (moving) aimAngle = Math.atan2(targetY - c.y, targetX - c.x);
            }
          } else {
            // Pack creatures roam a wider territory around their den by day
            // than the tight loiter radius everything else uses.
            const wanderRadiusPx = c.denKey ? DEN_PACK_WANDER_RADIUS_PX : TILE * 2.2;
            moving = wanderTick(c, dt, c.homeX, c.homeY, wanderRadiusPx);
            // Wandering has an explicit heading; paused between legs, there's no
            // specific direction to look, so settle broadside to the camera.
            aimAngle = moving ? Math.atan2(c.vy, c.vx) : idleCreatureAimAngle(c.groupRot);
          }
          c.facing = aimAngle;
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

          updateCreatureMesh(c, dt, aimAngle);
          // Runs AFTER updateCreatureMesh, not before -- during an active
          // swing, updateBanditToolMesh leans the avatar body's own rotation
          // into the same bodyYaw the weapon uses (see its own comment),
          // matching the player's updateToolMesh (playerMesh.rotation.y =
          // vŒ∏ in every branch); updateCreatureMesh would otherwise
          // overwrite that lean right back to the plain aim angle the very
          // same frame, since it always hard-sets grp.rotation.y from
          // c.groupRot. Also lets feetY read this frame's fresh avatar Y
          // position instead of last frame's.
          if (c.isBandit) { window.BanditCombat.updateToolMesh(c); window.BanditCombat.updateTrailArc(c, dt); }
          // A modular attack in its leap stage owns the sprite frame (locked
          // onto a non-idle pose) ‚Äî don't let the default idle/run cycling
          // stomp it back every tick.
          if (!window.Combat?.animalAttacks?.isBusy(c)) updateCreatureAnimFrame(c, dt, moving);
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
        // per-species height as posteriorRule.heightPercentOffset instead (the
        // tool's own live preview recomputes from that rule ‚Äî see
        // resolvedCharacterPosteriorSnapshot in that file) ‚Äî reading
        // position.y directly here was always wrong (flat 0 for every
        // species), which is why mounting used to seat the player too high.
        // Recompute the same way: handAttachY + portraitModelHeight *
        // heightPercentOffset / 100, both terms already in this same
        // floor-anchored space (see playerToolBaseY's own usage elsewhere).
        if (anchorName === 'posterior' && rec.posteriorRule) {
          const offset = Number(rec.posteriorRule.heightPercentOffset);
          const modelHeight = Number(playerAvatarModelHeight) || 0.9;
          const y = (Number(playerToolBaseY) || modelHeight / 2) + modelHeight * (Number.isFinite(offset) ? offset : -18) / 100;
          return { x: 0, y, z: 0, rotationDeg: anchor.rotationDeg };
        }
        return Number.isFinite(anchor?.position?.y) ? { ...anchor.position, rotationDeg: anchor.rotationDeg } : null;
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
      // The X/Z half of the shoulderPerch/shoulderGrip alignment math ‚Äî
      // shared by updateCompanions' shoulderPet branch (which also needs
      // dx/dz to set the pet's logical c.x/c.y and c.facing for this frame)
      // and updateShoulderPetMeshPin (a second pass that re-pins the pet's
      // RENDERED position after updatePlayerMesh ‚Äî see that function's own
      // comment for why it exists). A pure function of the player's current
      // rig anchor + facing, not of playerMesh.position itself, so it's
      // cheap (rig anchors are cached ‚Äî see playerAttachmentAnchor/
      // creatureAttachmentAnchor) and safe to call twice a frame rather than
      // needing dx/dz stashed as extra state on the creature.
      function _shoulderPetOffsetXZ(perch, grip) {
        const gripYawRad = (grip.rotationDeg?.y || 0) * Math.PI / 180;
        const invGripYaw = -gripYawRad;
        const gx = grip.x * Math.cos(invGripYaw) + (grip.z || 0) * Math.sin(invGripYaw);
        const gz = -grip.x * Math.sin(invGripYaw) + (grip.z || 0) * Math.cos(invGripYaw);
        const lx = perch.x - gx, lz = (perch.z || 0) - gz;
        const theta = playerMesh.rotation.y;
        return { dx: lx * Math.cos(theta) + lz * Math.sin(theta), dz: -lx * Math.sin(theta) + lz * Math.cos(theta), gripYawRad };
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

      // Depth-write priority between the player's own avatar and a freely-
      // roaming companion (NOT a shoulder pet ‚Äî see updatePetLayering
      // below for that, a fixed rule instead of this distance ranking) ‚Äî
      // tracked here so it can be reset once whenever nothing needs it,
      // mirroring _playerHatXrayEnabled's own reset pattern.
      let _depthPriorityFrontKey = null; // null = normal depth testing all around (nothing active to arbitrate)

      // The player's own avatar planes and a companion's are both flat,
      // alphaTest-cutout billboards ‚Äî at this camera's oblique ~33¬∞-
      // elevation angle they're genuinely tilted relative to it, so their
      // real 3D depth spans overlap across their own width and height
      // (confirmed live: even at the camera's default azimuth, the
      // player's own plane corners alone span a wider depth range than a
      // typical companion-to-player gap). A plain depth test then
      // interleaves them pixel-by-pixel instead of cleanly ordering one in
      // front of the other. A companion genuinely walks anywhere relative
      // to the player (unlike a shoulder pet, always glued to the same
      // authored offset), so there's no fixed "always in front" rule that
      // would look right in every situation ‚Äî this has to stay a live,
      // every-frame real-camera-space-distance ranking. depthTest stays on
      // for both, so real-world occlusion (trees, buildings) is untouched
      // ‚Äî opaque world geometry already finishes its own depth-writing
      // pass before either avatar (both transparent:true) ever draws, so
      // this only ever affects the two of them relative to each other.
      const _depthPriorityVec = new THREE.Vector3();
      function _cameraSpaceDistance(pos) {
        _depthPriorityVec.set(pos.x, pos.y, pos.z).applyMatrix4(camera.matrixWorldInverse);
        return -_depthPriorityVec.z;
      }
      function _playerAvatarBodyMaterials() {
        if (_playerAvatarBodyMaterialsCache) return _playerAvatarBodyMaterialsCache;
        let group = null;
        for (const child of playerMesh.children) if (child.name === 'player_avatar') { group = child; break; }
        // Not cached: mid-refreshPlayerAvatar (between the cache clear at
        // its top and its own playerMesh.add(avatarGroup) later on), the
        // avatar isn't attached yet ‚Äî caching [] here would freeze this
        // empty result in place with nothing left to invalidate it once
        // the real avatar does land.
        if (!group) return [];
        // The real front/back plane meshes sit inside a nested "assembly"
        // sub-group (see buildSinglePlaneAvatarModel's root.add(assembly)
        // in png-plane-avatar.js), not as direct children of this root ‚Äî
        // a shallow one-level scan here silently found nothing and left
        // the player's depthWrite untouched no matter what this function
        // computed, so this has to traverse the whole subtree.
        const mats = [];
        group.traverse(child => {
          if (child.isMesh && child.material && !child.name.includes('hat_xray')) mats.push(child.material);
        });
        _playerAvatarBodyMaterialsCache = mats;
        return mats;
      }
      // The hat-xray plane deliberately stays OUT of this ranking ‚Äî it's
      // still governed solely by setPlayerHatXray. That's fine: unlike
      // depthWrite (what this ranking arbitrates), which pixels ACTUALLY
      // draw hat-vs-body is settled by draw ORDER, and the hat's fixed,
      // always-nearer epsilon Z offset (see buildPlayerHatXrayOverlay)
      // keeps that order stable regardless of what the body's own
      // depthWrite is set to here.
      function _avatarDepthParticipants() {
        const list = [{ key: 'player', pos: playerMesh.position, mats: _playerAvatarBodyMaterials() }];
        for (const c of companionObjects) {
          if (c.health <= 0 || c.areaId !== currentArea) continue;
          if ((c.master || player) !== player) continue;
          // Shoulder pets are excluded here ‚Äî see updatePetLayering, which
          // arbitrates that specific relationship with a fixed rule
          // instead of a distance comparison.
          if (c.stableRole !== 'companion') continue;
          const mats = [c.avatarRef.frontPlane?.material, c.avatarRef.backPlane?.material].filter(Boolean);
          if (mats.length) list.push({ key: c.id, pos: c.avatarRef.group.position, mats });
        }
        return list;
      }
      function updateAvatarDepthPriority(active) {
        if (!active) {
          if (_depthPriorityFrontKey !== null) {
            _depthPriorityFrontKey = null;
            for (const p of _avatarDepthParticipants()) for (const m of p.mats) { m.depthWrite = true; m.needsUpdate = true; }
          }
          return;
        }
        const participants = _avatarDepthParticipants();
        if (participants.length < 2) return;
        let front = participants[0], frontDist = _cameraSpaceDistance(front.pos);
        for (let i = 1; i < participants.length; i++) {
          const d = _cameraSpaceDistance(participants[i].pos);
          if (d < frontDist) { front = participants[i]; frontDist = d; }
        }
        if (front.key === _depthPriorityFrontKey) return;
        _depthPriorityFrontKey = front.key;
        for (const p of participants) {
          const dw = p.key === front.key;
          for (const m of p.mats) { m.depthWrite = dw; m.needsUpdate = true; }
        }
      }

      // Shoulder-pet-vs-player layering: fixed, NOT distance-based. A
      // shoulder pet is always glued to the same authored offset near the
      // player's head/shoulder (see the shoulderPet branch below), so
      // unlike a companion there's a single visual relationship that's
      // always correct: the pet sits ON somebody's shoulder, so it belongs
      // in front of whichever body plane is currently facing the camera ‚Äî
      // UNLESS that's the player's own BACK (the player is facing away),
      // in which case the body itself is between the camera and the pet,
      // so the back plane has to win instead. That never depends on which
      // way the camera happens to be looking or how close the pet's
      // anchor happens to land relative to the body plane this frame ‚Äî a
      // per-frame distance comparison between two points that are always
      // glued within a few centimeters of each other is exactly what kept
      // flickering (the "winner" of two near-identical camera-space
      // distances is effectively floating-point noise from one frame to
      // the next).
      //
      // Implemented as a fixed renderOrder stack ‚Äî front body plane (2,
      // its unchanged default) < shoulder pet planes (3) < back body
      // plane (4, bumped in refreshPlayerAvatar) < back hat-xray overlay
      // (5, bumped in buildPlayerHatXrayOverlay) ‚Äî plus disabling
      // depthWrite on whichever layers could otherwise block a later one
      // via their own real (overlapping/interleaved) depth: the front
      // body plane and the pet's own planes. depthTest stays on
      // throughout, so real-world occlusion (trees, buildings) is
      // untouched; renderOrder only ever arbitrates these specific layers
      // against each other, never against the rest of the scene.
      const SHOULDER_PET_PLANE_RENDER_ORDER = 3;
      // Player back body plane's renderOrder ‚Äî bumped above the front
      // plane's unchanged default (2) and the pet's (3) in refreshPlayerAvatar,
      // so the back plane always wins whenever it's the one facing camera.
      // Declared here (rather than as a literal in refreshPlayerAvatar) so
      // buildPlayerHatXrayOverlay's back-facing hat overlay can derive its
      // own renderOrder from it and stay correctly stacked above it.
      const PLAYER_BACK_PLANE_RENDER_ORDER = 4;
      let _petLayeringActive = false;
      let _petLayeringPet = null;
      function updatePetLayering(active, pet) {
        if (active === _petLayeringActive && pet === _petLayeringPet) return;
        // A previously-arbitrated pet (deactivated, or swapped for a
        // different creature) needs its own planes restored to normal ‚Äî
        // otherwise a former shoulder pet demoted to a plain wandering
        // companion would be stuck permanently unable to write depth.
        if (_petLayeringPet && _petLayeringPet !== pet) {
          for (const m of [_petLayeringPet.avatarRef?.frontPlane?.material, _petLayeringPet.avatarRef?.backPlane?.material]) {
            if (m) { m.depthWrite = true; m.needsUpdate = true; }
          }
          for (const mesh of [_petLayeringPet.avatarRef?.frontPlane, _petLayeringPet.avatarRef?.backPlane]) {
            if (mesh) mesh.renderOrder = 2;
          }
        }
        _petLayeringActive = active;
        _petLayeringPet = active ? pet : null;
        if (_playerAvatarFrontMaterial) { _playerAvatarFrontMaterial.depthWrite = !active; _playerAvatarFrontMaterial.needsUpdate = true; }
        const petMats = active && pet ? [pet.avatarRef?.frontPlane?.material, pet.avatarRef?.backPlane?.material].filter(Boolean) : [];
        for (const m of petMats) { m.depthWrite = !active; m.needsUpdate = true; }
        if (active && pet) {
          for (const mesh of [pet.avatarRef?.frontPlane, pet.avatarRef?.backPlane]) {
            if (mesh) mesh.renderOrder = SHOULDER_PET_PLANE_RENDER_ORDER;
          }
        }
      }

      function updateCompanions(dt) {
        // Hat-xray toggle (see buildPlayerHatXrayOverlay/setPlayerHatXray):
        // on for exactly as long as the player has an actively-attached
        // shoulder pet, off otherwise, regardless of which companion (if
        // any) is in that role this frame.
        let hasActiveShoulderPetForPlayer = false;
        let activeShoulderPetCompanion = null;
        let hasActiveCompanionForPlayer = false;
        for (const c of companionObjects) {
          if (c.health <= 0 || c.areaId !== currentArea || (c.master || player) !== player) continue;
          if (c.stableRole === 'shoulderPet') { hasActiveShoulderPetForPlayer = true; activeShoulderPetCompanion = c; }
          else if (c.stableRole === 'companion') hasActiveCompanionForPlayer = true;
        }
        setPlayerHatXray(hasActiveShoulderPetForPlayer && !s_disableHatXray);
        updatePetLayering(hasActiveShoulderPetForPlayer, hasActiveShoulderPetForPlayer ? activeShoulderPetCompanion : null);
        if (!hasActiveCompanionForPlayer) updateAvatarDepthPriority(false);
        for (const c of companionObjects) {
          if (c.health <= 0) continue;
          if (c.areaId !== currentArea) continue;

          // The entity this companion follows/defends ‚Äî the real player for
          // an ordinary whistle-summoned companion, but not necessarily: see
          // the `master` field comment in makeCreatureEntity. Falls back to
          // `player` only so any pre-existing companion spawned before this
          // field existed (e.g. a save mid-load) doesn't go masterless.
          const master = c.master || player;

          if (master.climbing) {
            // Teleport-and-stick: an untagged companion can't path through an
            // incline tile on its own (see CREATURE_DB canClimb / moveCreatureToward),
            // so for the duration of the climb it just clings to its master's
            // back instead of trying to follow normally.
            const backAngle = master.angle + Math.PI;
            c.x = master.x + Math.cos(backAngle) * TILE * 0.35;
            c.y = master.y + Math.sin(backAngle) * TILE * 0.35;
            c.facing = master.angle;
            c.vx = 0; c.vy = 0;
            updateCreatureMesh(c, dt, c.facing);
            updateCreatureAnimFrame(c, dt, false);
            // Pin to the master's actual climb-blended height rather than the
            // incline tile's raw (unblended) surface ‚Äî see updatePlayerMesh.
            // (Only the real player has a climb-blended playerMesh height;
            // a non-player master would need its own mesh reference here.)
            c.avatarRef.group.position.y = playerMesh.position.y + c.halfHeight * 0.5;
            continue;
          }

          // A mount is driven entirely by updateMountRide/updateMountedMovement
          // (see the V-key/D-pad-down call-in/dismiss flow) ‚Äî it never runs
          // the fight/wander companion AI at all, so skip it here.
          if (c.stableRole === 'mount') continue;

          // A shoulder pet doesn't fight or wander off ‚Äî it stays glued to
          // its master's side, positioned/oriented so its shoulderGrip anchor
          // coincides with the character's shoulderPerch anchor exactly like
          // the animation-author tool's own live attachment (see
          // playerAttachmentAnchor/creatureAttachmentAnchor above, and
          // setActorAttachment/updateActorAttachmentAlignment in the tool ‚Äî
          // aligning shoulderGrip to shoulderPerch inverts the grip anchor's
          // FULL local transform, position AND rotation together, not just
          // its position, so a grip anchor authored with its own yaw (every
          // stableable creature's shoulderGrip carries -61¬∞) both tilts the
          // pet's own facing away from the character's and shifts where its
          // position offset lands).
          //
          // Unlike the mount seat (where posterior.x is always authored
          // centered, so a same-position glue is enough), shoulderPerch is
          // authored OFF-CENTER (it's a specific shoulder, not the spine),
          // so the combined local offset needs rotating into world space by
          // the character's actual current facing ‚Äî using
          // playerMesh.rotation.y (the real dead-zone-clamped sprite
          // rotation), not the raw look/movement angle, so the pet lines up
          // with how the sprite is actually oriented on screen. It's riding,
          // not walking, so it always stays in its idle pose regardless of
          // whether its master is currently moving.
          if (c.stableRole === 'shoulderPet') {
            c.vx = 0; c.vy = 0;
            const perch = playerAttachmentAnchor('shoulderPerch');
            const grip = creatureAttachmentAnchor(c.creatureKey, 'shoulderGrip', c.genotype);
            let dx = null, dz = null, clingDx = null, clingDz = null;
            if (perch && grip) {
              const gripYawRad = (grip.rotationDeg?.y || 0) * Math.PI / 180;
              const invGripYaw = -gripYawRad;
              const gx = grip.x * Math.cos(invGripYaw) + (grip.z || 0) * Math.sin(invGripYaw);
              const gz = -grip.x * Math.sin(invGripYaw) + (grip.z || 0) * Math.cos(invGripYaw);
              const lx = perch.x - gx, lz = (perch.z || 0) - gz;
              const theta = (master === player) ? playerMesh.rotation.y : master.angle;
              dx = lx * Math.cos(theta) + lz * Math.sin(theta);
              dz = -lx * Math.sin(theta) + lz * Math.cos(theta);
              c.x = master.x + dx * TILE;
              c.y = master.y + dz * TILE;
              c.facing = master.angle + gripYawRad;
            } else {
              const clingAngle = master.angle + Math.PI;
              clingDx = Math.cos(clingAngle) * 0.3;
              clingDz = Math.sin(clingAngle) * 0.3;
              c.x = master.x + clingDx * TILE;
              c.y = master.y + clingDz * TILE;
              c.facing = master.angle;
            }
            updateCreatureMesh(c, dt, c.facing);
            updateCreatureAnimFrame(c, dt, false);
            if (perch && grip) {
              // perch.y/grip.y are floor-relative ‚Äî the same total
              // height-above-playerMesh convention playerToolBaseY already
              // uses elsewhere ‚Äî so no additional half-height lift belongs
              // here either. X/Z are NOT pinned here (see below).
              c.avatarRef.group.position.y = playerMesh.position.y + perch.y - grip.y;
            } else {
              // No authored rig anchors for this species/creature pairing ‚Äî
              // a flat increment on top of updateCreatureMesh's own
              // terrain-based Y for this creature, unrelated to
              // playerMesh.position, so ‚Äî unlike X/Z below ‚Äî it has no
              // frame-staleness to fix and stays right here.
              c.avatarRef.group.position.y += CHAR_SHOULDER_PERCENT_FALLBACK * (playerAvatarModelHeight || 0.9) - 2 * PET_GRIP_PERCENT_FALLBACK * c.halfHeight;
            }
            // X/Z (both branches ‚Äî the fallback's clingDx/clingDz read
            // playerMesh.position exactly the same way perch/grip's dx/dz
            // do) are deliberately NOT pinned here ‚Äî see
            // updateShoulderPetMeshPin (called after updatePlayerMesh in the
            // main loop), which does it instead. History: this used to pin
            // straight to playerMesh.position (the character's own
            // already-smoothed render position) right here, instead of
            // easing in via updateCreatureMesh's generic per-creature lerp
            // (grp.position += (target - current) * dt*10) above ‚Äî that
            // lerp is tuned for a wandering animal easing toward a waypoint,
            // and a shoulder pet's target recomputed fresh every frame from
            // the player's CURRENT position just left it perpetually
            // chasing a moving target one frame behind, which read as the
            // pet visibly trailing the player and (since both avatars are
            // alphaTest cutout planes with transparent:true, so their few
            // percent of antialiased edge pixels actually alpha-blend)
            // occasionally flickering translucent where their depth
            // crossed. Pinning here fixed THAT lag, but this whole
            // companion/mount update block runs BEFORE updatePlayerMesh
            // (see the main loop ‚Äî updatePlayerMesh has to run after it, so
            // it can read this frame's freshly-resolved mount seat lift/
            // chair sink), so playerMesh.position read from here is still
            // LAST frame's value. During continuous movement
            // playerMesh.position is itself still easing toward the
            // player's actual position (see its own 0.25/frame lerp in
            // updatePlayerMesh), so pinning to a frame-stale copy of an
            // already-lagging value compounded into one more small,
            // constant frame of gap ‚Äî invisible once stationary (both
            // values settle on the same target), but a persistent slight
            // trail while moving. updateShoulderPetMeshPin re-applies this
            // same X/Z pin (for whichever branch actually applies) after
            // updatePlayerMesh has actually advanced playerMesh.position
            // for this frame, closing that last gap.
            continue;
          }

          const def = c.def;
          c.attackCooldownT = Math.max(0, c.attackCooldownT - dt);
          window.ResourceSystem?.tick(c, dt, { staminaRegenPerSec: c.maxStamina * 0.25 });

          const dxp = master.x - c.x, dyp = master.y - c.y;
          const distToMaster = Math.hypot(dxp, dyp);
          let target = null;
          for (const h of hostileObjects) {
            if (h.health <= 0) continue;
            if (h.areaId !== currentArea) continue;
            // Wild herbivores (e.g. uumkaoii-wild) live in hostileObjects too
            // (see spawnPackAtDen/EXTERIOR_ZONES.herbivoreSpecies) but never
            // fight ‚Äî companions should ignore them, not treat them as prey.
            if (h.def?.hostile === false) continue;
            if (Math.hypot(h.x - master.x, h.y - master.y) <= ALERT_RANGE_PX) { target = h; break; }
          }

          if (!target && window.Combat?.telegraph?.isBusy(c)) window.Combat.telegraph.cancel(c);
          if (!target && window.Combat?.animalAttacks?.isBusy(c)) window.Combat.animalAttacks.cancel(c);
          if (!target) c._stage = null;

          let moving = false, aimAngle = c.facing || 0;
          if (c.knockbackT > 0) {
            // Mirrors updateHostiles' knockback branch ‚Äî per-axis canOccupyAt
            // check so a companion caught by a stray hit can't get shoved
            // through solid terrain either.
            c.knockbackT = Math.max(0, c.knockbackT - dt);
            const nkx = c.x + c.knockbackVX * dt, nky = c.y + c.knockbackVY * dt;
            const ckSwept = sweptMove(c.x, c.y, nkx, nky, (x, y) => canOccupyAt(x, y, TILE * 0.32));
            c.x = ckSwept.x; c.y = ckSwept.y;
            if (ckSwept.blockedX) c.knockbackVX = 0;
            if (ckSwept.blockedY) c.knockbackVY = 0;
          } else if (target) {
            const dist = Math.hypot(target.x - c.x, target.y - c.y);
            aimAngle = Math.atan2(target.y - c.y, target.x - c.x);
            if (window.Combat?.telegraph?.isBusy(c)) {
              window.Combat.telegraph.update(c, dt);
            } else if (window.Combat?.animalAttacks?.isBusy(c)) {
              window.Combat.animalAttacks.update(c, dt);
              aimAngle = c.facing;
            } else {
              // Tamed companions cycle plain active-vs-backing-up (no
              // evasive-orbit stage ‚Äî that's wild-creature-only, see
              // updateCreatureBehaviorStage) so every attack/charge is still
              // separated from the next by the same global ~2s backup beat.
              const st = c._stage || (c._stage = { mode: 'active', t: 0 });
              st.t += dt;
              if (st.mode === 'backingUp') {
                const awayAngle = aimAngle + Math.PI;
                moving = moveCreatureToward(c, c.x + Math.cos(awayAngle) * TILE, c.y + Math.sin(awayAngle) * TILE, def.moveSpeed, dt);
                if (st.t >= STAGE_BACKUP_S) { st.mode = 'active'; st.t = 0; }
              } else {
                if (dist > def.attackRangePx * 0.8) moving = moveCreatureToward(c, target.x, target.y, def.chaseSpeed, dt);
                if (dist <= def.attackRangePx && c.attackCooldownT <= 0 && c.stamina >= def.attackStaminaCost && !isCreatureSwimming(c)) {
                  window.ResourceSystem?.spendStamina(c, def.attackStaminaCost, 'creature attack');
                  c.attackCooldownT = def.attackCooldownS;
                  // Tamed behavior: the real species attack set (e.g. Pounce)
                  // fires only once every 4 behavior actions; the other 3 use
                  // the short 0-damage/high-knockback guard charge instead.
                  c._behaviorActionCount = (c._behaviorActionCount || 0) + 1;
                  const useRealAttack = def.attacks?.length > 0 && (c._behaviorActionCount % 4 === 0);
                  const attackId = useRealAttack ? def.attacks[Math.floor(rnd() * def.attacks.length)] : 'guardCharge';
                  const startedModular = window.Combat?.animalAttacks?.start(c, attackId, { target });
                  if (startedModular) {
                    aimAngle = c.facing;
                  } else {
                    window.__farmLog?.(`[wildlife] companion ${c.creatureKey} (${c.id}): "${attackId}" failed to start against target (fallback: plain bite telegraph).`, 'wildlife');
                    window.Combat.telegraph.start(c, {
                      windupS: BITE_TELEGRAPH_WINDUP_S,
                      strikeS: BITE_TELEGRAPH_STRIKE_S,
                      onStrike: () => {
                        if (target.health > 0 && Math.hypot(target.x - c.x, target.y - c.y) <= def.attackRangePx) {
                          damageCreature(target, def.attackDamage, c.x, c.y, COMPANION_BITE_KNOCKBACK_PX_S, { tag: def.attackTag || 'sharp', afflictionBonuses: window.ResourceSystem?.afflictionBonusesForTag(def.attackTag) });
                          window.AudioSystem?.playCreatureClawHit(c);
                        }
                      },
                    });
                  }
                  st.mode = 'backingUp';
                  st.t = 0;
                }
              }
            }
          } else if (distToMaster > FOLLOW_FAR_PX) {
            moving = travelCreatureToward(c, master.x, master.y, def.chaseSpeed, dt);
            aimAngle = Math.atan2(dyp, dxp);
          } else {
            // Fable 2-style treasure hint: with nothing else to do, a
            // companion bounces toward the nearest still-buried treasure
            // chest in this zone instead of wandering aimlessly near its
            // master ‚Äî "leading you to it". Only wilderness zones carry
            // buried treasure (see _zoneTreasureObjects), so elsewhere this
            // is always a no-op and behavior is unchanged.
            const treasureHint = _isZoneArea(currentArea) ? window.WildTreasure.nearestBuriedPixelPos(currentArea, master.x, master.y) : null;
            if (treasureHint && treasureHint.dist <= TREASURE_HINT_RANGE_PX) {
              if (!c._treasureHintAnnounced) {
                c._treasureHintAnnounced = true;
                showToast(`${c.def.label} perks up, sniffing at something nearby!`, true);
              }
              moving = wanderTick(c, dt, treasureHint.x, treasureHint.y, TILE * 1.4);
            } else {
              c._treasureHintAnnounced = false;
              moving = wanderTick(c, dt, master.x, master.y, FOLLOW_NEAR_PX);
            }
            if (moving) aimAngle = Math.atan2(c.vy, c.vx);
          }
          c.facing = aimAngle;
          c.x = clamp(c.x, 0, (c.areaCols || COLS) * TILE);
          c.y = clamp(c.y, 0, (c.areaRows || ROWS) * TILE);

          updateCreatureMesh(c, dt, aimAngle);
          if (!window.Combat?.animalAttacks?.isBusy(c)) updateCreatureAnimFrame(c, dt, moving);
        }

        // Run last, after every avatar's position has actually been updated
        // for this frame (see updateAvatarDepthPriority above) ‚Äî ranking
        // stale, previous-frame positions would routinely pick the wrong
        // front-most participant. Only companions go through this live
        // ranking now ‚Äî the shoulder pet relationship is arbitrated by the
        // fixed updatePetLayering rule instead (called above, independent
        // of this frame's positions).
        if (hasActiveCompanionForPlayer) updateAvatarDepthPriority(true);
      }

      // Second pass for the real player's own shoulder pet(s), called after
      // updateToolMesh in the main loop (updateCompanions itself runs before
      // updatePlayerMesh ‚Äî see the long comment in its shoulderPet branch for
      // why that ordering is otherwise required). Waiting through tool mesh
      // animation matters because authored attack/tool poses apply bodyYaw to
      // playerMesh.rotation.y after the ordinary player update; the shoulder
      // pet must inherit that final body rotation, not the pre-swing facing.
      // Re-pins X/Z for
      // BOTH the rig-anchor (perch/grip) and no-rig-data fallback cases ‚Äî
      // both read playerMesh.position the same way, so both need this.
      // Y is only re-pinned for the perch/grip case: the fallback's Y is a
      // flat increment on top of updateCreatureMesh's own terrain-based Y
      // for this creature (not playerMesh-based), already applied once in
      // updateCompanions with nothing stale about it ‚Äî re-adding it here
      // too would double it.
      function updateShoulderPetMeshPin() {
        for (const c of companionObjects) {
          if (c.health <= 0 || c.areaId !== currentArea || c.stableRole !== 'shoulderPet') continue;
          if ((c.master || player) !== player) continue; // playerMesh only ever represents the real player
          const perch = playerAttachmentAnchor('shoulderPerch');
          const grip = creatureAttachmentAnchor(c.creatureKey, 'shoulderGrip', c.genotype);
          if (perch && grip) {
            const { dx, dz, gripYawRad } = _shoulderPetOffsetXZ(perch, grip); // Final attack-rotated attachment transform.
            c.avatarRef.group.position.x = playerMesh.position.x + dx;
            c.avatarRef.group.position.y = playerMesh.position.y + perch.y - grip.y;
            c.avatarRef.group.position.z = playerMesh.position.z + dz;
            c.avatarRef.group.rotation.y = playerMesh.rotation.y - gripYawRad;
          } else {
            // Backward local offset expressed through the avatar's final
            // THREE.js Y rotation, so fallback pets follow bodyYaw too.
            c.avatarRef.group.position.x = playerMesh.position.x - Math.sin(playerMesh.rotation.y) * 0.3;
            c.avatarRef.group.position.z = playerMesh.position.z - Math.cos(playerMesh.rotation.y) * 0.3;
            c.avatarRef.group.rotation.y = playerMesh.rotation.y;
          }
        }
      }

      // With no `master` given, clears every companion (full reset/QA use ‚Äî
      // see the farm-reset call site). Given a `master`, only despawns that
      // master's own companion, leaving any other master's companion alone ‚Äî
      // needed so two masters (e.g. two whistle-bearing entities) syncing
      // independently don't clobber each other's pet.
      function despawnCompanions(master, role = null) {
        for (const c of [...companionObjects]) {
          if (master && c.master !== master) continue;
          if (role && c.stableRole !== role) continue;
          despawnCreature(c);
          companionObjects.delete(c);
        }
      }

      // Spawns/despawns the given master's active companion/shoulder-pet (one
      // per Size-gated stable role ‚Äî see STABLE_ROLE_META) to match the
      // stable's designated active entry for each slot, or (companion slot
      // only, falling back for any legacy whistle not represented in the
      // stable) its equipped whistle. Called every playable-area frame for
      // the real player (master defaults to `player`); cheap no-op once in
      // sync. Also re-spawns into the new area's scene whenever the master
      // travels, including farmhouse and building interiors. Takes an
      // explicit `master` (rather than always reading the
      // real player) so this same function can eventually drive a second
      // companion-bearing player's companion, or an NPC's, without change ‚Äî
      // see the `master` field on the companion entity itself.
      //
      // The mount slot is deliberately NOT handled here ‚Äî a mount only ever
      // exists in the world while actively summoned/ridden/dismissing, driven
      // by toggleMount/updateMountRide (the V key / D-pad down), not kept
      // continuously in sync with the stable's active-mount pick the way
      // companion/shoulder-pet are.
      function syncCompanionFromWhistle(master = player) {
        // A cutscene preview's combat card manages companionObjects directly
        // (see runCutscenePreview/runCombat) ‚Äî this sync would otherwise
        // despawn a hound the instant it runs, since the real player's
        // active companion is always cleared during preview (see the boot
        // handoff in docs/index.html).
        if (cutscenePreviewActive) return;

        for (const role of ['companion', 'shoulderPet']) {
          const activeId = window.FarmPanel.activeStableIdForRole(role);
          // The stable is the primary source of truth for "what's my active
          // X" ‚Äî only species with a matching CREATURE_DB entry (and
          // therefore a companion AI type) can actually be summoned; a
          // stabled animal of a not-yet-companion-capable kind just means
          // nothing is spawned for that slot, rather than falling through to
          // the legacy whistle.
          const activeStabled = activeId ? stable.find(s => s.id === activeId) : null;
          const stableCompanion = (activeStabled && CREATURE_DB[activeStabled.kind])
            ? { creatureKey: activeStabled.kind, name: activeStabled.name, genotype: activeStabled.genotype }
            : null;
          // Only the companion slot honors the legacy whistle fallback ‚Äî
          // mount/shoulder-pet have no equivalent item-based summon path.
          const whistle = (role === 'companion' && !activeStabled && equipmentSlots.whistle)
            ? (gearInventory?.whistles || []).find(w => w.id === equipmentSlots.whistle)
            : null;
          const desired = stableCompanion || whistle;

          const existing = [...companionObjects].find(c => c.master === master && c.stableRole === role);
          if (!desired) {
            if (existing) despawnCompanions(master, role);
            continue;
          }
          // Swapping between two stabled specimens of the same species (e.g.
          // two differently-bred gar-wolves) still needs a respawn so the new
          // one's genotype actually renders.
          if (existing && existing.creatureKey === desired.creatureKey && existing.areaId === currentArea
            && JSON.stringify(existing.genotype || null) === JSON.stringify(desired.genotype || null)) continue;
          despawnCompanions(master, role);
          const spawnX = master.x + Math.cos(master.angle + Math.PI) * TILE * 1.4;
          const spawnY = master.y + Math.sin(master.angle + Math.PI) * TILE * 1.4;
          const companion = makeCreatureEntity(desired.creatureKey, spawnX, spawnY, {
            isCompanion: true, name: desired.name, homeX: spawnX, homeY: spawnY, state: 'idle', master, genotype: desired.genotype, stableRole: role,
          });
          if (companion) {
            companionObjects.add(companion);
            window.__farmLog?.(`[companion] spawned ${role} ${desired.creatureKey} in ${currentArea}`, 'wildlife');
          }
        }
      }

      // Mount ride logic (toggleMount, beginSummonMount/beginDismissMount,
      // updateMountRide, relocateMountForAreaChange, updateMountedMovement)
      // lives in js/mount-system.js (window.Mounts) ‚Äî see window.Mounts.init(...) below.

      function clearHostileObjects() {
        hostileObjects.forEach(c => despawnCreature(c));
        hostileObjects.clear();
      }

      // ‚îÄ‚îÄ Tothal Shift ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ
      // A yearly reroll of the seed behind all four wilderness maps (Northern
      // Cliffs, Southern Cloud Forest, Western Slope, Eastern Mire) ‚Äî in lore
      // terms, the wilderness itself reshapes at the turn of the year. This
      // reproduces exactly what the Wilderness Map Generator tool's "Export"
      // ‚Üí Map Editor's "Import" round-trip would do to a zone map: a random
      // seed and the zone's own entry side (so the gate still faces Hobunji
      // Hollow) are the only inputs, everything else is the standalone tool's
      // stock defaults, with zero post-processing ‚Äî the generator's headless
      // core (docs/js/wilderness-map-generator.js) hands its export straight
      // to the same plateau/ramp fold math the Map Editor's live preview
      // already uses (docs/js/terrain-preview.js), and the game renders it
      // exactly as it would an authored map. Little Swamp House (Leaf & Pahu's
      // House) doesn't exist in the wilderness tool's own vocabulary, so it's
      // re-attached at its original coordinates after every shift ‚Äî whatever
      // terrain the generator happened to draw there stays as-is, same as any
      // other generated tile. The Researcher's Tent used to work the same way
      // but is now a real stamped locale (see FIXED_LOCALE_LANDMARKS below)
      // so its exterior placement, and this transition into its interior, can
      // both move together each shift instead of the entrance drifting away
      // from wherever the tent itself actually got drawn.
      const TOTHAL_PRESERVED_TRANSITIONS = {
        map_eastern_mire: [{ id: 'sp_emi_swamp', label: 'Little Swamp House', col: 34, row: 29, targetMapId: 'map_i_swamp_house', targetSpotId: 'sp_swp_entry' }],
      };

      // ‚îÄ‚îÄ Locales (docs/tools/locale-editor/, docs/config/locales/) ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ
      // FIXED_LOCALE_LANDMARKS (Leaf & Pahu's House's fixed map anchor) now
      // lives in js/wilderness-map.js alongside the rest of the map system.

      // Fetched once per page load and cached -- the locale JSON files rarely
      // change mid-session, and every Tothal Shift needs the same list.
      let _localeDefsPromise = null;
      function loadStampableLocaleDefs() {
        if (_localeDefsPromise) return _localeDefsPromise;
        _localeDefsPromise = (async () => {
          // Local override (see docs/js/local-db-overrides.js): unlike the
          // single-file databases above, locale-editor's workspace holds the
          // FULL content of every locale it has loaded (not just an index),
          // so an active 'locales' override supplies already-fetched docs
          // directly and skips the index+per-file fetch below entirely.
          if (window.LocalDBOverrides?.getSourceMode() === 'local') {
            const override = window.LocalDBOverrides.getOverride('locales');
            if (override?.locales) {
              return override.locales.filter(e => e.category === 'great_fey_shrine' || e.category === 'story_poi');
            }
          }
          try {
            const idxRes = await fetch('config/locales/index.json');
            if (!idxRes.ok) throw new Error(`HTTP ${idxRes.status}`);
            const idx = await idxRes.json();
            // Great Fey shrines + the Researcher's Tent are randomly stamped
            // -- see the comment on FIXED_LOCALE_LANDMARKS above for why
            // dwellings are excluded here.
            const entries = (idx.locales || []).filter(e => e.category === 'great_fey_shrine' || e.category === 'story_poi');
            const defs = [];
            for (const entry of entries) {
              try {
                const r = await fetch(entry.file);
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                defs.push(await r.json());
              } catch (e) { debugLog(`Tothal Shift: locale load failed for ${entry.file}: ${e.message}`, 'warn'); }
            }
            return defs;
          } catch (e) {
            debugLog('Tothal Shift: locale index load failed: ' + e.message, 'warn');
            return [];
          }
        })();
        return _localeDefsPromise;
      }

      function currentTothalYear() {
        return window.CalendarSystem.yearNumber(calendar.day);
      }

      function _tothalWorldId() {
        return (window.__hobunjiPlayerProfile || _playerData)?.worldId || null;
      }

      // Reads/writes the Tothal year directly on the world's hobunjiSaveMeta
      // entry ‚Äî mirrors saveGearInventory()'s pattern of touching localStorage
      // straight from game.js rather than round-tripping through onboarding.js.
      function _loadTothalYear() {
        const worldId = _tothalWorldId();
        if (!worldId) return null;
        try {
          const meta = JSON.parse(localStorage.getItem('hobunjiSaveMeta') || 'null');
          return (meta?.worlds || []).find(w => w.id === worldId)?.lastTothalYear ?? null;
        } catch { return null; }
      }

      function _saveTothalYear(year) {
        const worldId = _tothalWorldId();
        if (!worldId) return;
        try {
          const meta = JSON.parse(localStorage.getItem('hobunjiSaveMeta') || 'null');
          const world = (meta?.worlds || []).find(w => w.id === worldId);
          if (!world) return;
          world.lastTothalYear = year;
          localStorage.setItem('hobunjiSaveMeta', JSON.stringify(meta));
        } catch {}
      }

      // ‚îÄ‚îÄ World calendar (day/time-of-day/weather) ‚Äî world-scoped like the
      // Tothal year above, not character-scoped, so every character sharing
      // a world sees the same date/time. `calendar` (declared near the top
      // of this closure) previously had no persistence at all: it's a fresh
      // in-memory object every page load, hardcoded back to Day 1, ~10:30 AM
      // ‚Äî so the date/time (and weather) silently reset every session no
      // matter how long the world had actually been played. Loaded once in
      // spawnPlayerAvatar (before checkTothalShift, since currentTothalYear()
      // reads calendar.day) and saved on every day rollover (advanceDay/
      // sleepInBed) plus on tab close, mirroring _saveTothalYear's pattern.
      function _loadWorldCalendar() {
        const worldId = _tothalWorldId();
        if (!worldId) return null;
        try {
          const meta = JSON.parse(localStorage.getItem('hobunjiSaveMeta') || 'null');
          return (meta?.worlds || []).find(w => w.id === worldId)?.calendar ?? null;
        } catch { return null; }
      }

      function _saveWorldCalendar() {
        const worldId = _tothalWorldId();
        if (!worldId) return;
        try {
          const meta = JSON.parse(localStorage.getItem('hobunjiSaveMeta') || 'null');
          const world = (meta?.worlds || []).find(w => w.id === worldId);
          if (!world) return;
          world.calendar = {
            day: calendar.day, time01: calendar.time01, weather: calendar.weather,
            isRaining: calendar.isRaining, rainStrength: calendar.rainStrength,
            nextRainWindows: calendar.nextRainWindows, lastRainDay: calendar.lastRainDay,
          };
          localStorage.setItem('hobunjiSaveMeta', JSON.stringify(meta));
        } catch {}
      }

      // ‚îÄ‚îÄ Livestock (belongs to the world itself, not any character) ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ
      // [{ id, kind, col, row, releasedAt }] ‚Äî released animals stay on the
      // farm for whoever plays this world, unlike gear/inventory which is
      // scoped to whichever character released them.
      // Set only while updateAnimalMeshes is iterating this frame's animals
      // (see below) ‚Äî every farm-animal tick() reads this at least once
      // (_farmAnimalBarnTick, plus the uumkao'ii dew check), so without a
      // cache a farm with a handful of animals was re-parsing the entire
      // save blob from localStorage hundreds of times per second, which
      // reads as the whole game freezing. Left null the rest of the time so
      // every other (infrequent ‚Äî UI clicks, day-tick) caller still always
      // gets a fresh read.
      let _worldLivestockFrameCache = null;
      function _loadWorldLivestock() {
        if (_worldLivestockFrameCache) return _worldLivestockFrameCache;
        const worldId = _tothalWorldId();
        if (!worldId) return [];
        try {
          const meta = JSON.parse(localStorage.getItem('hobunjiSaveMeta') || 'null');
          return (meta?.worlds || []).find(w => w.id === worldId)?.livestock ?? [];
        } catch { return []; }
      }

      function _saveWorldLivestock(list) {
        const worldId = _tothalWorldId();
        if (!worldId) return;
        try {
          const meta = JSON.parse(localStorage.getItem('hobunjiSaveMeta') || 'null');
          const world = (meta?.worlds || []).find(w => w.id === worldId);
          if (!world) return;
          world.livestock = list;
          localStorage.setItem('hobunjiSaveMeta', JSON.stringify(meta));
        } catch {}
      }

      // ‚îÄ‚îÄ Breeding pairs (world-scoped, same rationale as livestock) ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ
      // [{ id, parentA, parentB, startedDay, readyDay }] ‚Äî parentA/B are
      // { source: 'world'|'stable', id, characterId? } refs (see
      // js/farm-animals.js's resolveBreedingParent). Resolved by
      // window.FarmAnimals.tickBreeding() on the day-tick, same cadence as
      // crop growth.
      function _loadWorldBreedingPairs() {
        const worldId = _tothalWorldId();
        if (!worldId) return [];
        try {
          const meta = JSON.parse(localStorage.getItem('hobunjiSaveMeta') || 'null');
          return (meta?.worlds || []).find(w => w.id === worldId)?.breedingPairs ?? [];
        } catch { return []; }
      }

      function _saveWorldBreedingPairs(list) {
        const worldId = _tothalWorldId();
        if (!worldId) return;
        try {
          const meta = JSON.parse(localStorage.getItem('hobunjiSaveMeta') || 'null');
          const world = (meta?.worlds || []).find(w => w.id === worldId);
          if (!world) return;
          world.breedingPairs = list;
          localStorage.setItem('hobunjiSaveMeta', JSON.stringify(meta));
        } catch {}
      }

      // ‚îÄ‚îÄ Farm storage (single shared pool, world-scoped) ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ
      // { [itemKey]: count } ‚Äî same shape as inventory/nonGearInventory, but
      // belongs to the farm itself so any owner or storage-permitted
      // farmhand can deposit/withdraw regardless of who's currently playing.
      function _loadWorldStorage() {
        const worldId = _tothalWorldId();
        if (!worldId) return {};
        try {
          const meta = JSON.parse(localStorage.getItem('hobunjiSaveMeta') || 'null');
          return (meta?.worlds || []).find(w => w.id === worldId)?.storage ?? {};
        } catch { return {}; }
      }

      function _saveWorldStorage(store) {
        const worldId = _tothalWorldId();
        if (!worldId) return;
        try {
          const meta = JSON.parse(localStorage.getItem('hobunjiSaveMeta') || 'null');
          const world = (meta?.worlds || []).find(w => w.id === worldId);
          if (!world) return;
          world.storage = store;
          localStorage.setItem('hobunjiSaveMeta', JSON.stringify(meta));
        } catch {}
      }

      // Jubmir's daily trader stock/shop page now lives in
      // js/jubmir-shop.js (window.JubmirShop) ‚Äî see its init(deps) call
      // below for the shared game.js state it's threaded.

      // ‚îÄ‚îÄ Farm name (reuses world.label, the same field set at world
      // creation in onboarding.js) ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ
      function getFarmName() {
        const worldId = _tothalWorldId();
        if (!worldId) return _playerData?.worldLabel || 'Hobunji Hollow';
        try {
          const meta = JSON.parse(localStorage.getItem('hobunjiSaveMeta') || 'null');
          return (meta?.worlds || []).find(w => w.id === worldId)?.label || 'Hobunji Hollow';
        } catch { return 'Hobunji Hollow'; }
      }

      function setFarmName(label) {
        const worldId = _tothalWorldId();
        const trimmed = String(label || '').trim();
        if (!worldId || !trimmed) return;
        try {
          const meta = JSON.parse(localStorage.getItem('hobunjiSaveMeta') || 'null');
          const world = (meta?.worlds || []).find(w => w.id === worldId);
          if (!world) return;
          world.label = trimmed.slice(0, 40);
          localStorage.setItem('hobunjiSaveMeta', JSON.stringify(meta));
          if (_playerData) _playerData.worldLabel = world.label;
        } catch {}
      }

      // Owning character's nickname, for the Farm tab header ‚Äî looked up by
      // ownerCharacterId since livestock/world records only hold ids, not
      // display names (mirrors how char.nickname is read at save-select).
      function getFarmOwnerName() {
        const worldId = _tothalWorldId();
        try {
          const meta = JSON.parse(localStorage.getItem('hobunjiSaveMeta') || 'null');
          const world = (meta?.worlds || []).find(w => w.id === worldId);
          const owner = (meta?.characters || []).find(c => c.id === world?.ownerCharacterId);
          return owner?.nickname || 'Unknown';
        } catch { return 'Unknown'; }
      }

      // ‚îÄ‚îÄ Farm ownership / farmhand permissions ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ
      // World data (non-gear inventory, NPC relationships, quest progress)
      // stays behind in the world's per-character member record rather than
      // following the character between worlds ‚Äî the opposite of gear,
      // skills, and stats, which live on the character record and always
      // travel with them. isWorldOwner/farmhandPermissions are decided once
      // at save-select time (onboarding.js) and carried on _playerData for
      // the session; a real farmhand's grants only change between sessions
      // until networking exists to push a live update.
      // Single source of truth for the permission-key set within this file
      // (onboarding.js keeps its own copy ‚Äî the two closures share no module).
      function defaultFarmhandPermissions() {
        return { storage: false, plant: false, harvest: false, placeFurniture: false, alterFarm: false, livestock: false };
      }

      function defaultWorldMemberState() {
        return {
          nonGearInventory: {}, packClothing: [], npcRelationships: {}, questProgress: {},
          alchemyKnownEffects: {}, alchemyActiveEffects: [], alchemyReagentState: {}, wildBerryState: {},
          joinedAt: Date.now(),
        };
      }

      function isFarmOwner() {
        if (_debugFarmRoleOverride) return _debugFarmRoleOverride.isOwner;
        return _playerData ? !!_playerData.isWorldOwner : true; // no world context yet ‚Äî don't lock out solo play
      }

      function hasFarmPermission(action) {
        if (isFarmOwner()) return true;
        const perms = _debugFarmRoleOverride ? _debugFarmRoleOverride.permissions : _playerData?.farmhandPermissions;
        return !!(perms && perms[action]);
      }

      // Devtools-only role simulator so farmhand gating can be verified without
      // real multiplayer: window.__hobunjiSetFarmRole('farmhand', {plant:true})
      // or window.__hobunjiSetFarmRole('owner') to restore normal behavior.
      let _debugFarmRoleOverride = null;
      window.__hobunjiSetFarmRole = function (role, permissions) {
        if (role === 'owner') { _debugFarmRoleOverride = null; showToast('Debug: acting as farm owner.', true); return; }
        if (role === 'farmhand') {
          _debugFarmRoleOverride = {
            isOwner: false,
            permissions: { ...defaultFarmhandPermissions(), ...permissions },
          };
          showToast('Debug: acting as farmhand ' + JSON.stringify(_debugFarmRoleOverride.permissions), true);
          return;
        }
        console.warn('__hobunjiSetFarmRole: role must be "owner" or "farmhand"');
      };

      // Adds/updates a farmhand grant on the current world's save-meta record.
      // Exposed for the (future) invite/matchmaking UI and for devtools testing:
      // window.__hobunjiAddFarmhand(characterId, { storage: true }).
      window.__hobunjiAddFarmhand = function (characterId, permissions) {
        const worldId = _tothalWorldId();
        if (!worldId || !characterId) return;
        try {
          const meta = JSON.parse(localStorage.getItem('hobunjiSaveMeta') || 'null');
          const world = (meta?.worlds || []).find(w => w.id === worldId);
          if (!world) return;
          if (world.ownerCharacterId === characterId) return; // owner already has full access
          if (!world.farmhands) world.farmhands = [];
          let entry = world.farmhands.find(f => f.characterId === characterId);
          if (!entry) {
            entry = { characterId, permissions: defaultFarmhandPermissions() };
            world.farmhands.push(entry);
          }
          if (permissions) Object.assign(entry.permissions, permissions);
          if (!world.members) world.members = {};
          if (!world.members[characterId]) {
            world.members[characterId] = defaultWorldMemberState();
          }
          localStorage.setItem('hobunjiSaveMeta', JSON.stringify(meta));
        } catch {}
      };

      window.__hobunjiRemoveFarmhand = function (characterId) {
        const worldId = _tothalWorldId();
        if (!worldId || !characterId) return;
        try {
          const meta = JSON.parse(localStorage.getItem('hobunjiSaveMeta') || 'null');
          const world = (meta?.worlds || []).find(w => w.id === worldId);
          if (!world) return;
          world.farmhands = (world.farmhands || []).filter(f => f.characterId !== characterId);
          localStorage.setItem('hobunjiSaveMeta', JSON.stringify(meta));
        } catch {}
      };

      // ‚îÄ‚îÄ Per-world-per-character data (non-gear inventory, pack, NPC/quest) ‚îÄ‚îÄ
      // Mirrors saveGearInventory()'s pattern of touching hobunjiSaveMeta
      // directly, but under world.members[characterId] instead of the
      // character record ‚Äî this is the data that stays behind in the world
      // when a character leaves, rather than following them.
      function saveMemberWorldData() {
        const worldId  = _tothalWorldId();
        const charId   = (window.__hobunjiPlayerProfile || _playerData)?.characterId;
        if (!worldId || !charId) return;
        try {
          const meta  = JSON.parse(localStorage.getItem('hobunjiSaveMeta') || 'null');
          const world = (meta?.worlds || []).find(w => w.id === worldId);
          if (!world) return;
          if (!world.members) world.members = {};
          const member = world.members[charId] || (world.members[charId] = defaultWorldMemberState());
          member.nonGearInventory = { ...inventory };
          member.packClothing    = [...packClothing];
          member.npcRelationships = window.DialogueContent?.npcRelationshipsSnapshot();
          member.questProgress    = { ...questProgress };
          member.alchemyKnownEffects = window.AlchemySystem.serializeKnownEffects();
          member.alchemyActiveEffects = window.AlchemySystem.serializeActiveEffects();
          member.alchemyReagentState = window.ReagentPlants.serializeZoneReagentState();
          member.wildBerryState = window.WildBerries.serializeState();
          member.zoneTreasureState = window.WildTreasure.serializeState();
          member.felledTreeState = serializeZoneFelledTreeState();
          member.minedRockState = serializeZoneMinedRockState();
          localStorage.setItem('hobunjiSaveMeta', JSON.stringify(meta));
        } catch {}
      }

      // ‚îÄ‚îÄ Owner/farmhand content visibility ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ
      // Generic gate dialogue trees and (future) quests can tag themselves
      // with: 'owner' (world-owner/protagonist only), 'farmhand' (non-owner
      // members only), or 'any'/omitted (everyone, the default).
      function canAccessContent(visibility) {
        if (!visibility || visibility === 'any') return true;
        if (visibility === 'owner')    return isFarmOwner();
        if (visibility === 'farmhand') return !isFarmOwner();
        return true;
      }

      // ‚îÄ‚îÄ Quest progress (per world, per character) ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ‚îÄ
      // No quest content is authored yet ‚Äî this is the tracking scaffold
      // future quest-giving dialogue/hooks can call into. { [questId]:
      // { status: 'not_started'|'in_progress'|'completed', progress, completedAt } }
      let questProgress = {};

      function getQuestState(questId) {
        return questProgress[questId] || { status: 'not_started', progress: {}, completedAt: null };
      }

      function canAccessQuest(quest) {
        return canAccessContent(quest?.visibility);
      }

      function setQuestStatus(questId, status, progressPatch) {
        const st = questProgress[questId] || (questProgress[questId] = { status: 'not_started', progress: {}, completedAt: null });
        st.status = status;
        if (progressPatch) Object.assign(st.progress, progressPatch);
        if (status === 'completed' && !st.completedAt) st.completedAt = Date.now();
        saveMemberWorldData();
      }

      let _tothalShiftInFlight = false;
      // Set while a shift is running so enterZone() can wait for it instead
      // of building a zone scene from the about-to-be-replaced authored/prior
      // layout ‚Äî without this, a player who reaches a wilderness zone within
      // the first few seconds of a shift (most likely right at world start)
      // would see last year's map for that visit.
      let _tothalShiftPromise = null;
      // Whether performTothalShift has populated _zoneLayouts at least once
      // THIS PAGE LOAD. _loadTothalYear() surviving in localStorage told
      // checkTothalShift "already shifted this year, nothing to do" even on a
      // brand new session where _zoneLayouts (a plain in-memory Map) is empty
      // ‚Äî every wilderness zone silently fell back to its tiny authored
      // placeholder map until the year next changed. Gate the skip on this
      // flag too, so the first check each session always (re)builds the
      // zones ‚Äî deterministic seeding (world id + year + zone) reproduces the
      // exact same map, not a fresh reroll.
      let _tothalShiftedThisSession = false;

      // Regenerates all four wilderness zones for the given Tothal year and
      // saves that year to the world file so future checks this session skip
      // redundant rebuilds. Seeded from the world id + year + zone, so the
      // same world reliably regrows the same wilderness for that year on
      // every load. `silent` suppresses the "reshaped" toast for a same-year
      // session catch-up rebuild (nothing actually changed, just restoring
      // this session's in-memory cache) rather than a genuine new-year shift.
      async function performTothalShift(year, { silent = false } = {}) {
        if (typeof WildernessMapGenerator === 'undefined') {
          debugLog('Tothal Shift skipped: wilderness-map-generator.js not loaded', 'warn');
          return;
        }
        if (_tothalShiftInFlight) return;
        _tothalShiftInFlight = true;
        const worldId = _tothalWorldId() || 'default';
        const terrainPreview = (typeof TerrainPreview !== 'undefined') ? TerrainPreview : null;
        debugLog(`Tothal Shift: rerolling wilderness for year ${year} (world ${worldId})`);
        try {
          // Each singleton locale should exist exactly once across all four
          // zones, but generateZoneWorkspace only knows about the single zone
          // it's generating -- so the pool of locales still needing a home
          // shrinks as each zone claims one, and a zone that couldn't fit a
          // locale simply leaves it for the next zone to try.
          const localeDefs = await loadStampableLocaleDefs();
          // Warm the bandit config/locale fetches now (both are cached-promise
          // singletons) so the first wilderness visit doesn't have to wait on
          // them before it can stamp a camp. Bandit camps are NOT part of this
          // shift's stamping pass ‚Äî they're temporary locales placed at runtime
          // against the finished zone (see ensureCurrentZoneBanditCamps).
          window.BanditCombat?.loadGangConfig();
          window.BanditCombat?.loadCampLocaleDefs();
          let remainingLocales = localeDefs.slice();
          for (const zoneId of WildernessMapGenerator.zoneMapIds()) {
            const seed = `${worldId}_tothal_y${year}_${zoneId}`;
            const preserved = TOTHAL_PRESERVED_TRANSITIONS[zoneId] || [];
            let workspace;
            try {
              // Random seed, entry side set per zone ‚Äî otherwise the tool's own
              // defaults, no post-processing. This is meant to be exactly what
              // a human would get generating a map with the standalone tool and
              // importing it into the Map Editor by hand. remainingLocales are
              // the not-yet-placed locales this shift (see above).
              workspace = WildernessMapGenerator.generateZoneWorkspace(zoneId, seed, remainingLocales);
            } catch (e) {
              debugLog(`Tothal Shift: generation failed for ${zoneId}: ${e.message}`, 'warn');
              continue;
            }
            const root = workspace.maps[0];
            let merged;
            try {
              merged = terrainPreview ? terrainPreview.buildMergedZoneGrid(workspace, root.id) : null;
            } catch (e) {
              debugLog(`Tothal Shift: fold failed for ${zoneId}: ${e.message}`, 'warn');
              continue;
            }
            if (!merged) { debugLog(`Tothal Shift: no fold math available for ${zoneId}, skipping`, 'warn'); continue; }

            const localeInstances = workspace.localeInstances || [];
            if (localeInstances.length) {
              const placedIds = new Set(localeInstances.map(inst => inst.localeId));
              remainingLocales = remainingLocales.filter(l => !placedIds.has(l.id));
              debugLog(`Tothal Shift: ${zoneId} placed locale(s): ${localeInstances.map(inst => inst.localeId).join(', ')}`);
            }
            // The Researcher's Tent's exterior placement moves with the rest
            // of the terrain each shift (see stampLocales) -- its entrance
            // transition into the building interior has to follow it there
            // rather than sitting at a fixed spot the tent may no longer
            // occupy.
            const tentInstance = localeInstances.find(inst => inst.localeId === 'locale_researchers_tent');
            // The actual tent mesh (docs/config/pieces/researchers-tent.json),
            // fed through the same zoneData.buildings pipeline _spawnZoneBuildings
            // already uses for authored zone buildings -- without this, stampLocale's
            // carrier 'structure' object (only used for path-routing) never gets
            // drawn, and the spot just looks like flat ground. Rotated to face its
            // door toward the connector's side (the piece's door faces south/+Z by
            // default; each step here is a further 90¬∞ clockwise turn from there).
            const TENT_DOOR_ROTATION_BY_SIDE = { south: 0, east: 90, north: 180, west: 270 };
            const tentStructureObj = tentInstance?.objects.find(o => o.kind === 'structure');
            const tentDoorSide = tentInstance?.connectors[0]?.side || 'south';
            const tentElevTier = tentStructureObj ? (merged.tiles.get(`${tentStructureObj.x},${tentStructureObj.y}`)?.elevTier || 0) : 0;
            const tentBuilding = tentStructureObj ? [{
              id: 'bldg_researchers_tent', pieceFile: 'config/pieces/researchers-tent.json',
              gridX: tentStructureObj.x, gridZ: tentStructureObj.y,
              rotationDeg: TENT_DOOR_ROTATION_BY_SIDE[tentDoorSide] ?? 0,
              elevTier: tentElevTier, footprintW: 3, footprintD: 3,
            }] : [];
            // The locale's connector marks where the wilderness path enters
            // the *locale* (see stampLocale's pathAnchor use of it) -- it can
            // sit several tiles from the tent itself (room for a clearing/
            // desk/statues in between), so using it directly as the "enter
            // the tent" trigger tile used to put that trigger nowhere near
            // the actual door, making the transition seem unresponsive. The
            // real door tile is one step off whichever edge of the
            // structure's footprint TENT_DOOR_ROTATION_BY_SIDE turns to
            // face, so derive it from tentStructureObj's own (already
            // locale-scaled) position + size instead.
            const TENT_DOOR_TILE_OFFSET_BY_SIDE = tentStructureObj ? {
              south: { dx: Math.round(tentStructureObj.w / 2), dz: tentStructureObj.h },
              east:  { dx: tentStructureObj.w, dz: Math.round(tentStructureObj.h / 2) },
              north: { dx: Math.round(tentStructureObj.w / 2), dz: -1 },
              west:  { dx: -1, dz: Math.round(tentStructureObj.h / 2) },
            }[tentDoorSide] : null;
            const tentTransitions = (tentInstance && tentStructureObj && TENT_DOOR_TILE_OFFSET_BY_SIDE) ? [{
              id: 'sp_ncl_tent', label: "Researcher's Tent",
              col: tentStructureObj.x + TENT_DOOR_TILE_OFFSET_BY_SIDE.dx,
              row: tentStructureObj.y + TENT_DOOR_TILE_OFFSET_BY_SIDE.dz,
              target: 'building', targetMapId: 'map_i_researchers_tent',
            }] : [];
            // Garanki Gabu's desk + 3 specimen statues (locale_researchers_tent's
            // decor/prop objects) -- rendered through the same zoneData.decor
            // pipeline _spawnZoneDecorFurniture already uses, and re-registered as
            // named npcStations every shift (see hobunji-starter-npc-database.json's
            // scheduleHooks) so his schedule always finds them at their *current*
            // stamped position instead of a coordinate that stops matching once the
            // tent moves.
            const tentDecorObjs = tentInstance ? tentInstance.objects.filter(o => o.kind === 'decor' || o.kind === 'prop') : [];
            const tentDecor = tentDecorObjs.map(o => ({ col: o.x, row: o.y, key: o.key, elevTier: merged.tiles.get(`${o.x},${o.y}`)?.elevTier || 0 }));
            if (tentInstance) {
              const findObj = id => tentInstance.objects.find(o => o.id === id);
              const desk = findObj('obj_desk');
              const statues = ['obj_statue_1', 'obj_statue_2', 'obj_statue_3'].map(findObj);
              const stations = [];
              if (desk) stations.push({ id: 'station_researchers_tent_desk', label: "Garanki's Desk", area: zoneId, c: desk.x, r: desk.y, pose: 'stand' });
              statues.forEach((s, i) => { if (s) stations.push({ id: `station_researchers_tent_statue_${i + 1}`, label: `Specimen Statue ${i + 1}`, area: zoneId, c: s.x, r: s.y, pose: 'stand' }); });
              // station_researchers_tent_sleep is NOT registered here ‚Äî it lives
              // inside config/maps/map_i_researchers_tent.json's own npcStations
              // (auto-registered by loadBuildingScene once that interior loads).
              // Registering it at tentStructureObj's position, like the other
              // stations, used to put Garanki's "sleeping" rule (20:00-08:00,
              // over half the day) standing inside/behind the opaque exterior
              // tent mesh in the wilderness zone ‚Äî impossible to see or find.
              registerNpcStations(stations, zoneId);
              // Proactively warm up the tent's interior scene right now instead
              // of waiting for the player to actually walk in ‚Äî resolveNpcScheduleTarget
              // only auto-warms it lazily, the first time something asks for
              // station_researchers_tent_sleep and finds it unregistered, and that
              // warm-up is itself async. If Garanki's schedule happens to resolve
              // during the sleeping rule before either has happened (e.g. right at
              // world boot), every rule AND the defaultStationId fallback fail to
              // find that station, and resolveNpcScheduleTarget falls all the way
              // through to scheduleHooks.defaultPosition ‚Äî spawning him at that
              // arbitrary fallback tile, nowhere near the tent, until his next
              // schedule change happens to trigger a re-resolve. Loading this now
              // means the station is registered before spawnScheduledNpcs (or its
              // retry loop) ever resolves his first real target.
              loadBuildingScene('map_i_researchers_tent');
            }

            const toTownExit = workspace.entry ? { col: workspace.entry.col, row: workspace.entry.row, label: 'To Hobunji Hollow' } : null;
            // One entrance transition per den, at its mouth tile ‚Äî leads into
            // the procedurally generated cavern synthesized in-memory by
            // loadBuildingScene (see its 'map_i_den_' handling). Den ids are
            // already unique per zone (see placeAnimalDens), so the cavern
            // mapId built from zoneId+denId is stable across a session and
            // regenerates fresh whenever the zone itself reshapes.
            // targetCol/targetRow are set explicitly (the cavern's own
            // guaranteed-walkable entrance tile, from the same deterministic
            // generateCavernFloor(mapId) loadBuildingScene will call again
            // later) rather than left for enterBuilding's default
            // buildingSpawnFromExit fallback to guess ‚Äî that heuristic
            // assumes "one tile north of the exit" is walkable, true for a
            // rectangular room but not for this cavern's organic floor blob,
            // which is exactly why entering used to strand the player outside
            // the walkable area.
            const denTransitions = (workspace.animalDens || [])
              .filter(den => den.mouthAnchor)
              .map(den => {
                const cavernMapId = window.WildlifeSpawn.denCavernMapId(zoneId, den.id);
                const { exitCol, exitRow } = window.CavernGenerator.generateCavernFloor(cavernMapId);
                return {
                  id: `den_${den.id}_enter`, label: 'A dark burrow', col: den.mouthAnchor.x, row: den.mouthAnchor.y,
                  target: 'building', targetMapId: cavernMapId,
                  targetCol: exitCol, targetRow: exitRow,
                };
              });
            _zoneLayouts.set(zoneId, {
              cols: merged.cols, rows: merged.rows, tiles: [...merged.tiles.values()],
              transitions: [
                ...preserved.map(t => ({ id: t.id, label: t.label, col: t.col, row: t.row, target: 'building', targetMapId: t.targetMapId })),
                ...tentTransitions,
                ...denTransitions,
              ],
              toTownExit, mesas: merged.mesas, buildings: [...(merged.buildings || []), ...tentBuilding], decor: tentDecor, furniture: [],
              dens: workspace.animalDens || [],
              rootTotems: workspace.rootTotems || [],
              foliagePatches: workspace.foliagePatches || [],
              ambushStations: workspace.ambushStations || [],
              localeInstances,
            });
            // A reshaped zone's dens are all new ‚Äî forget any leftover pack/
            // respawn bookkeeping from the previous layout's den ids (see
            // ensureZoneDenPacks/spawnPackAtDen).
            window.WildlifeSpawn.forgetZoneDenState(zoneId);
            window.BanditCamps.forgetZoneState(zoneId);
            // Entering from town has no authored spawn coordinate of its own
            // (see EXTERIOR_ZONES' comment) ‚Äî it always falls back to
            // zdef.entryCol/Row, so keep that pinned to this shift's own entry gate.
            if (EXTERIOR_ZONES[zoneId] && workspace.entry) {
              EXTERIOR_ZONES[zoneId].entryCol = workspace.entry.col;
              EXTERIOR_ZONES[zoneId].entryRow = workspace.entry.row;
            }
            if (currentArea === zoneId) _dirtyZoneScenes.add(zoneId);
            else _disposeZoneScene(zoneId);
            debugLog(`Tothal Shift: ${zoneId} reshaped (entry ${workspace.entry?.side ?? '?'} at ${workspace.entry?.col ?? '?'},${workspace.entry?.row ?? '?'})`);
            await new Promise(resolve => setTimeout(resolve, 0)); // yield between zones
          }
          if (remainingLocales.length) {
            debugLog(`Tothal Shift: ${remainingLocales.length} locale(s) found no room in any zone this shift: ${remainingLocales.map(l => l.id).join(', ')}`, 'warn');
          }
          clearHostileObjects();
          _saveTothalYear(year);
          _tothalShiftedThisSession = true;
          if (!silent) {
            // showToast is a plain DOM update (no dependency on avatar/gameStarted
            // state), and this can legitimately finish before spawnPlayerAvatar's
            // own async avatar setup does ‚Äî always show it rather than gating on
            // gameStarted and risking the toast silently getting swallowed by that race.
            showToast('The Tothal Shift has reshaped the wilderness...', true);
          }
          debugLog(`Tothal Shift complete for year ${year}${silent ? ' (silent session catch-up)' : ''}`);
        } finally {
          _tothalShiftInFlight = false;
        }
      }

      // Called at world start and on every day advance ‚Äî a no-op unless the
      // Tothal year has actually changed since this world last shifted, this
      // is the first check this session (see _tothalShiftedThisSession), or
      // ?tothal=force is in the URL (or window.forceTothalShift() was called
      // from devtools) ‚Äî useful for testing, since a world that already
      // shifted this year otherwise stays untouched for the rest of it.
      function checkTothalShift(force = false) {
        const year = currentTothalYear();
        const forceQuery = new URLSearchParams(location.search).get('tothal') === 'force';
        const alreadyCurrent = _loadTothalYear() === year;
        if (!force && !forceQuery && _tothalShiftedThisSession && alreadyCurrent) return;
        // Same year as last save but nothing built yet this session (a fresh
        // page load) ‚Äî silently rebuild the same deterministic map instead of
        // announcing a "shift" that, from the player's perspective, never happened.
        const silent = !force && !forceQuery && alreadyCurrent;
        _tothalShiftPromise = performTothalShift(year, { silent })
          .catch(e => debugLog('Tothal Shift error: ' + e.message, 'warn'))
          .finally(() => { _tothalShiftPromise = null; });
      }
      window.forceTothalShift = () => checkTothalShift(true);

      // Wilderness fog-of-war, discovered-locale tracking, and map
      // rendering (minimap widget + full-screen Map panel) now live in
      // js/wilderness-map.js (window.WildernessMap) ‚Äî see its init(deps)
      // call below for the shared game.js state it's threaded. Kept here
      // (not moved into that module) since the Tasks panel and
      // window.BountyBoard also read it.
      const WMAP_ZONE_LABELS = {
        map_northern_cliffs: 'Northern Cliffs',
        map_southern_cloud_forest: 'Southern Cloud Forest',
        map_western_slope: 'Western Slope',
        map_eastern_mire: 'Eastern Mire',
      };

      // Devtools/QA hook for the cliff-climbing feature ‚Äî mirrors
      // window.forceTothalShift's role of poking otherwise-input-driven
      // state from a console/automated test.
      // Text-only inspection of the den/foliage-patch wildlife schedule AI ‚Äî
      // observe pathing/state decisions without watching the 3D scene. Call
      // window.__wildlifeDebug.dump() (optionally filtered to a zone) to
      // snapshot every den-spawned creature's current AI state/position/
      // target, or dumpZone(zoneId) for that zone's raw den/foliage-patch/
      // ambush-station generator data. See updateHostiles' per-transition
      // window.__farmLog line for a running text trace of the same states.
      window.__wildlifeDebug = {
        dump(zoneId) {
          const out = [];
          for (const c of hostileObjects) {
            if (!c.denKey) continue;
            if (zoneId && c.areaId !== zoneId) continue;
            out.push({
              id: c.id, creatureKey: c.creatureKey, denKey: c.denKey, areaId: c.areaId,
              state: c.state, health: c.health, maxHealth: c.maxHealth,
              tile: { x: Math.round(c.x / TILE), y: Math.round(c.y / TILE) },
              home: { x: Math.round(c.homeX / TILE), y: Math.round(c.homeY / TILE) },
              patrolPoints: c.patrolPoints || null, patrolIndex: c.patrolIndex ?? null, linkedPatchId: c.linkedPatchId || null,
              grazingTile: c.grazingTile || null, grazingPatchId: c.grazingPatchId || null,
              waterTile: c.waterTile || null, nextDrinkHour: c.nextDrinkHour ?? null,
              targetCreature: c.targetCreature?.id || null,
            });
          }
          return out;
        },
        dumpZone(zoneId) {
          const layout = _zoneLayouts.get(zoneId);
          if (!layout) return null;
          return { dens: layout.dens || [], rootTotems: layout.rootTotems || [], foliagePatches: layout.foliagePatches || [], ambushStations: layout.ambushStations || [] };
        },
        getCurrentArea: () => currentArea,
        isNightTime: (...a) => window.Music?.isNightTime(...a),
        hostileObjects,
      };

      window.__climbDebug = {
        getPlayer: () => player,
        getClimbTarget: window.ClimbSystem.getClimbTarget,
        startClimb: window.ClimbSystem.startClimb,
        getActiveGrid,
        getCurrentArea: () => currentArea,
        enterZone,
        companionObjects,
        hostileObjects,
        creatureCanEnterTile,
        CREATURE_DB,
        TileType,
        getCameraDebug: () => ({
          camPos: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
          camTarget: { x: camTargetX, y: camTargetY, z: camTargetZ },
          occlusionMeshCount: _zoneScenes.get(currentArea)?.occlusionMeshes?.length ?? null,
        }),
        occlusionSafeCameraPosition,
        updateCameraPosition,
        snapCameraTarget: _snapCameraTarget,
        isPlayerSwimming,
        isCreatureSwimming,
        tileSpeedAt,
        performContextAction,
        performDodge,
        currentComboAbilityId,
        currentWeaponDamageType,
        weaponDamageTypeForTool,
        currentWeaponKey,
        equipmentSlots,
        equipItem: window.EquipmentPanel.equipItem,
        toolMasteryLevel,
        toolMasteryXp,
        awardToolMasteryXp,
        awardWeaponMasteryXp,
        awardToolUseMasteryXp,
        getMotesOfProwess,
        awardMotesOfProwess,
        spendMotesOfProwess,
        gearInventory: () => gearInventory,
        combatSwingAfflictionIds: () => combatSwingAfflictionIds,
        combatSwingCone: () => combatSwingCone,
        toolMeshMap: () => toolMeshMap,
        toolHolder: () => toolHolder,
        updateToolMesh,
        updateCombatConeTrail,
        coneTrailLaneMeshes: () => coneTrailLaneMeshes,
        triggerWeaponSwingVisual,
        setActiveTool,
        TILE,
        enterBuilding,
        getDenNests: () => _denNests,
        getPendingSpotTransition: () => _pendingSpotTransition,
        isActionHeldDown: () => actionHeldDown,
        getNestHoldT: () => _nestHoldT,
        isPaused: () => paused,
        isGameStarted: () => gameStarted,
        isMenuOpen: () => menuOpen,
        isDialogueOpen: () => dialogueOpen,
        isFarmEditMode: () => farmEditMode,
        getBoundDesktopEnter: () => getActionForButton('desktop', 'Enter'),
        debugComputeActionButtons: () => computeActionButtons(),
        getCavernFloor: (mapId) => window.CavernGenerator.generateCavernFloor(mapId),
        exitBuilding: () => exitBuilding(),
        toolHolderParent: () => (toolHolder.parent ? (toolHolder.parent === scene ? 'farmScene' : 'otherScene') : null),
        addLivestockFromItem: (itemKey) => window.FarmAnimals.addFromItem(itemKey),
        addToStable: (itemKey) => window.FarmAnimals.addToStable(itemKey),
        getWorldLivestock: () => _loadWorldLivestock(),
        getStable: () => stable,
        animalObjects,
        getDenGenotypes: () => window.WildlifeSpawn.getDenGenotypes(),
        genotypeSignature: (kind, genotype) => window.CreatureGeneticsRender?.genotypeSignature(kind, genotype),
        setInventory: (key, n) => { inventory[key] = n; },
        getGenotypeTexCacheSize: () => _genotypeTexCache.front.size,
        getGenotypeTexCacheKeys: () => [..._genotypeTexCache.front.keys()],
        debugGetGenotypeTextures: (kind, frame, genotype) => !!_getGenotypeTextures(kind, frame, genotype),
        makeDefaultGenotype: (kind) => window.CreatureGenetics.makeDefaultGenotype(kind),
        makeCreatureEntity: (key, x, y, opts) => makeCreatureEntity(key, x, y, opts),
        getGenotypeReadyFrames: (c) => c._genotypeReadyFrames ? [...c._genotypeReadyFrames] : [],
      };

      // Ambient wildlife den spawning, per-den shared genotype rolls, and
      // wildlife-vs-wildlife skirmish damage now live in
      // js/wildlife-spawn.js (window.WildlifeSpawn) ‚Äî see its init(deps)
      // call below for the shared game.js state it's threaded. The
      // constants below stay here (not moved into that module) since
      // game.js's own updateHostiles AI loop reads them directly.
      const DEN_PACK_WANDER_RADIUS_PX = TILE * 6; // idle-state wander range while denned packs are active (isNightTime() false, see updateHostiles) ‚Äî well beyond the tight loiter radius everything else uses, so packs actually roam by day instead of pacing right next to the den.
      const DEN_SETTLE_RADIUS_PX = TILE * 0.6; // how close a denned creature has to get to homeX/homeY before it's considered "back" ‚Äî same idea as the 'return' state's TILE*0.6 threshold.
      const WILDLIFE_FLEE_REAGGRO_COOLDOWN_MS = 6000; // grace period after reaching home before a fled animal can be re-aggro'd/re-picked as prey
      const PATROL_SIGHT_RANGE_PX = TILE * 3.5; // how close a grazing herbivore has to wander for a patrolling predator to notice it
      const WILDLIFE_DRINK_INTERVAL_HOURS = 5; // how often (in continuous game hours) a herbivore needs to break off grazing to visit water
      const WILDLIFE_DRINK_DURATION_S = 4; // real seconds spent drinking once at the water's edge, before resuming its schedule


      // Bandit Gangs (config/locale loading, roster/avatar generation,
      // ability-driven combat AI, weapon visuals/trail, entity spawn) now
      // live in js/combat/combat-bandit.js (window.BanditCombat) -- see
      // window.BanditCombat.init(...) below for the wiring.

      // Bandit camps (zone adapter, tent props, camp lifecycle,
      // companion perception, corpse loot) now live in
      // js/bandit-camps.js (window.BanditCamps) -- see
      // window.BanditCamps.init(...) below for the wiring.

      function updatePlayerVitals(dt) {
        // Health/Stamina regen, Exhausted/black-stamina recovery, and every
        // affliction's own tick (bleed/poison/congealed/recovery/puke) ‚Äî
        // see docs/js/combat/resource-system.js. Passing the existing
        // per-second constants keeps un-afflicted regen feeling the same
        // as before this system existed; quiet rest now doubles it.
        const tickResult = window.ResourceSystem?.tick(player, dt, {
          staminaRegenPerSec: PLAYER_STAMINA_REGEN,
          healthRegenPerSec: PLAYER_HEALTH_REGEN,
        });
        if (tickResult?.puked) showToast('You feel queasy...', false);
        if (player.dodgeCooldownT > 0) player.dodgeCooldownT = Math.max(0, player.dodgeCooldownT - dt);
        refreshVitalsHud();
      }

      // Dodging never refuses for lack of Stamina ‚Äî overspending pushes the
      // player into Exhausted (black-stamina debt) instead, mirroring the
      // demo's "a dodge reaction can overdraw into Exhausted" rule. See
      // docs/js/combat/resource-system.js's spendStamina.
      // Dodges toward whatever direction the player is currently moving in
      // (player.inputX/Y ‚Äî this frame's raw move intent, already unit-length,
      // see updateMovement) rather than the aim direction, since a dodge is
      // an evasive step, not an attack. With no movement held, there's no
      // "current direction" to dodge in, so it falls back to backing away
      // from whatever the player's actually aiming at instead: the locked
      // auto-target if the weapon's out and one's engaged, otherwise the
      // player's own facing (player.angle, same aim used by attacks).
      // Holds the player still (physics-wise) for the whole prone duration ‚Äî
      // ImpactRagdollPlayback owns playerMesh's tilt/height and leg poses
      // directly from the separate per-frame leg-update site (guarded by its
      // own isActive() there), both during the settled hold and during the
      // recovery roll, so there's nothing else to drive here.
      function updateProneState(dt) {
        player.vx = 0; player.vy = 0;
      }

      // Somersault recovery ‚Äî the dodge input's meaning while prone (see
      // performDodge's own guard below): rolls the player back onto their
      // feet via a procedurally coded arc (docs/js/combat/impact-ragdoll-
      // playback.js's beginRecoveryArc ‚Äî no authored blend exists for this
      // transition). Requires Footing to be back to full, same eligibility a
      // prone creature's own AI waits on before it auto-recovers (see
      // updateHostiles' `if (c.prone)` branch/beginCreatureSomersaultRecovery)
      // ‚Äî the player's own recovery is just input-gated instead of automatic.
      // Returns false if not actually prone, already mid-roll, or not yet
      // eligible.
      const SOMERSAULT_RECOVERY_DUR_S = 0.5;
      function beginSomersaultRecovery() {
        if (!player.prone || player.somersaultRecovering) return false;
        if (player.footing < player.maxFooting) {
          showToast("Footing hasn't recovered enough yet.", false);
          return false;
        }
        player.somersaultRecovering = true;
        window.ImpactRagdollPlayback?.beginRecoveryArc(SOMERSAULT_RECOVERY_DUR_S, () => {
          player.prone = false;
          player.somersaultRecovering = false;
        });
        return true;
      }

      function performDodge() {
        // While prone (0 Footing ‚Äî see enterProneIfFootingDepleted), the
        // dodge button somersaults the player back to standing instead of a
        // normal evasive dodge.
        if (player.prone) return beginSomersaultRecovery();
        if (player.dodging || player.dodgeCooldownT > 0) return false;
        let dirX, dirY;
        if (player.inputStrength > 0.001) {
          dirX = player.inputX;
          dirY = player.inputY;
        } else {
          const weaponEngaged = activeTool === 'weapon' && !!equipmentSlots.weapon;
          const target = weaponEngaged ? findAutoTarget() : null;
          const aimAngle = target
            ? Math.atan2(target.y - player.y, target.x - player.x)
            : player.angle;
          dirX = -Math.cos(aimAngle);
          dirY = -Math.sin(aimAngle);
        }
        if (window.ResourceSystem) window.ResourceSystem.spendStamina(player, DODGE_STAMINA_COST, 'dodge');
        else player.stamina = Math.max(0, player.stamina - DODGE_STAMINA_COST);
        player.dodging = true;
        player.dodgeT = DODGE_DUR_S;
        player.dodgeDirX = dirX;
        player.dodgeDirY = dirY;
        player.dodgeCooldownT = DODGE_COOLDOWN_S;
        player.invulnUntil = performance.now() + DODGE_IFRAME_MS;
        return true;
      }

      // Single dedicated "context action" button ‚Äî takes a pending entrance/
      // exit spot transition when standing on one, climbs a cliff-face wall
      // when facing one, otherwise dodges evasively. Spot transitions take
      // top priority so this always works as an "unstuck" input even when
      // the primary action bar is showing something else entirely (e.g. an
      // NPC standing near a doorway hijacks the action bar into an NPC
      // dialogue button instead of the door's Exit/Enter prompt ‚Äî see
      // computeActionButtons' nearbyNpcWalker branch ‚Äî which used to leave
      // no way to actually walk through that doorway without shoving the
      // NPC out of the way first). getClimbTarget() has always been
      // direction-agnostic (it lands on whatever elevation is on the far
      // side of the wall, higher or lower ‚Äî see its own comment), so "jump
      // off a ledge" falls out of the exact same crossing for free once
      // it's reachable from here rather than only the primary action bar's
      // climb prompt. Walking/dodging straight into a river or stream to
      // start swimming needs no separate trigger of its own now that water
      // is a real (slow, non-swimmer) crossing instead of a hard block ‚Äî
      // see tileSpeedAt.
      function performContextAction() {
        if (player.climbing || player.dodging) return;
        if (_pendingSpotTransition) { startSceneTransition(() => performTravel(_pendingSpotTransition)); return; }
        const climb = window.ClimbSystem.getClimbTarget();
        if (climb) { window.ClimbSystem.startClimb(climb); return; }
        performDodge();
      }

      // Combat-ability movement: a short forward step/leap toward the aim
      // direction (player.angle), layered under an attack's own windup/
      // strike timing ‚Äî distinct from performDodge's evasive zip above.
      // distancePx is total ground covered over durationS (eased out, so it's
      // fast at first and settles in); hopUnits is an optional cosmetic
      // vertical arc peak in world-Y units for a leaping attack. hitTest
      // ({rangePx, halfConeRad}), when given, is the attack's own hit cone ‚Äî
      // updateMovement's lunge branch stops the lunge in place (instead of
      // covering the full distancePx) the instant a live hostile is inside
      // that cone, so the target is guaranteed to still be within the
      // collider at the point the lunge stops, never overshot past it.
      function beginCombatLunge(distancePx, durationS, hopUnits = 0, hitTest = null) {
        if (durationS <= 0 || distancePx <= 0) return;
        // Each combo/quick-attack/charged-breaker module tracks its own
        // "busy" gate independently, so tapping a *different* attack slot
        // while an earlier one's lunge is still in flight isn't blocked by
        // that earlier module's busyAction ‚Äî without this guard, the new
        // call would blow away the in-progress lunge's start point/progress
        // and restart from wherever the player happened to be that frame,
        // producing wildly inconsistent travel distance (sometimes almost
        // none, sometimes stacking into more than any single lunge should
        // cover). The attack's own damage/hit resolution doesn't depend on
        // this cosmetic step, so simply not layering a second lunge on top
        // of the first is enough ‚Äî the new attack still fires normally.
        if (player.lunging) return;
        player.lunging = true;
        player.lungeT = durationS;
        player.lungeDur = durationS;
        player.lungeStartX = player.x;
        player.lungeStartY = player.y;
        player.lungeDirX = Math.cos(player.angle);
        player.lungeDirY = Math.sin(player.angle);
        player.lungeDistancePx = distancePx;
        player.lungeHopUnits = hopUnits;
        player.lungeHitTest = hitTest;
      }

      // True if any live hostile in the current area is already inside the
      // given hit cone from the player's current position/facing ‚Äî used to
      // cut a combat lunge short (see beginCombatLunge/updateMovement).
      function isHostileInLungeCone(hitTest) {
        if (!hitTest) return false;
        for (const c of hostileObjects) {
          if (c.health <= 0 || c.areaId !== currentArea) continue;
          if (inCone(player.x, player.y, player.angle, c.x, c.y, hitTest.rangePx, hitTest.halfConeRad)) return true;
        }
        return false;
      }

      const _vbHealthFill  = document.getElementById('vbHealthFill');
      const _vbStaminaFill = document.getElementById('vbStaminaFill');
      const _vbFootingFill = document.getElementById('vbFootingFill');
      function refreshVitalsHud() {
        if (_vbHealthFill)  _vbHealthFill.style.width  = `${Math.max(0, Math.min(100, player.health  / player.maxHealth  * 100))}%`;
        if (_vbStaminaFill) _vbStaminaFill.style.width = `${Math.max(0, Math.min(100, player.stamina / player.maxStamina * 100))}%`;
        if (_vbFootingFill && player.maxFooting) _vbFootingFill.style.width = `${Math.max(0, Math.min(100, player.footing / player.maxFooting * 100))}%`;
      }

      // ‚îÄ‚îÄ World travel: transition spots + shared NPC routes (map editor data) ‚îÄ
      // Authored in docs/tools/map-editor and carried in hobunji_farm_layout_v3
      // as `transitions`, `routes`, and legacy `npcPaths`. area: 'farm' | 'interior'.
      let worldTransitions     = [];   // farm+interior: { id, label, area, col, row, target, targetCol, targetRow }
      let worldTownTransitions = [];   // town: same shape
      let worldRoutes          = [];   // shared routes: { id, label, area, nodes: [[c,r],...] }
      let worldTownRoutes      = [];   // town shared routes
      const npcStationsById    = new Map(); // stationId ‚Üí { id, label, area, c, r, rotY, pose, toolKey, toolIntervalSec }
      let worldNpcPaths        = [];   // legacy only: { id, label, npcId, area, nodes: [[c,r],...] }
      const routeGraphsByArea  = new Map();
      const npcWalkers         = [];
      window._npcWalkers = npcWalkers;
      // dialogueOpen/_dialogueWalker are read/written both here (camera/
      // staging code) and by js/dialogue-content.js (via deps.getDialogueOpen/
      // getDialogueWalker) ‚Äî the dialogue-flow state that module owns
      // exclusively (_dlgTree, _dialogueLines, the typewriter timer, etc.)
      // lives entirely inside it now, not here.
      let dialogueOpen       = false;
      let _dialogueWalker    = null;
      let _playerData        = null;  // set from hobunjiPlayerReady event
      let playerAvatarRefreshGeneration = 0; // Guards async avatar rebuilds from attaching stale planes.
      // The base attach point updateToolMesh hangs tools/weapons from. X is the avatar's
      // actual scanned right-arm sprite edge; Y is the avatar's actual scanned bottom-edge
      // pixel row (these are cropped bust-style portraits, so the bottom-most opaque pixel
      // is hand height, not avatarHeight/2 ‚Äî see handAttachY in png-plane-avatar.js). Both
      // vary by species and are recomputed in refreshPlayerAvatar() once the per-species
      // sprite/scale is known.
      let playerToolBaseX = -0.45, playerToolBaseY = 0.45;
      // The player's own rendered bust-portrait model height (avatarHeight in
      // refreshPlayerAvatar) ‚Äî recomputed there alongside playerToolBaseX/Y.
      // Used to place a shoulder pet / mounted seat height correctly (see
      // playerAttachmentAnchorY and the mount seat lift in updatePlayerMesh).
      let playerAvatarModelHeight = 0.9;
      // Procedural leg/foot animation handle for the player's own avatar ‚Äî
      // rebuilt in refreshPlayerAvatar (species/gender can change there),
      // driven each frame from updatePlayerMesh. See
      // docs/js/procedural-leg-animation.js.
      let playerLegs = null;
      // Head-turn bone built by buildSinglePlaneAvatarModel's neckRig option
      // (null if no neck pivot could be detected for the player's current
      // portrait) ‚Äî same mechanism the animation-author tool/NPC dialogue
      // staging uses (see faceNpcDialogueParticipants), driven here for the
      // seated look-around head-turn instead (see updateSitInteraction).
      let playerNeckJoint = null;
      // Shoulder-pet hat xray (ported from the animation-author tool's
      // setShoulderPetHatXrayV1521/buildLazyHatOverlayV1521) ‚Äî see
      // buildPlayerHatXrayOverlay/setPlayerHatXray near refreshPlayerAvatar.
      let _playerHatXrayOverlay = null; // { materials, meshes } once built for the current hat, else null.
      let _playerHatXrayEnabled = false; // Last-applied state, so setPlayerHatXray only touches materials on a real change.
      // Direct references to the player's own front/back plane materials ‚Äî
      // set in refreshPlayerAvatar. Used by updatePetLayering (near
      // updateCompanions) to toggle the front plane's depthWrite without
      // disturbing the back plane's, which _playerAvatarBodyMaterials()'s
      // combined front+back traversal can't do on its own.
      let _playerAvatarFrontMaterial = null;
      let _playerAvatarBackMaterial = null;
      // Cache for _playerAvatarBodyMaterials()'s mesh-subtree traversal ‚Äî
      // cleared in refreshPlayerAvatar (the only place the avatar's mesh
      // hierarchy is rebuilt), so a stable hierarchy isn't re-traversed
      // every frame just to find the same handful of materials Ôû4˜fÚµÎ(ö+my”C∞¢6ˆÁ7B$Tdîƒ≈ÙdƒıU$ï4Öı$U“∞¢≤Êñ”¢w&Vfñ∆≈GW&‰˜WBr¬GW#¢„“¿¢≤Êñ”¢w&Vfñ∆≈7G&ñ∂T&6≤r¬GW#¢„R“¿¢≤Êñ”¢w&Vfñ∆≈Gvó7D˜WBr¬GW#¢„#R“¿¢≤Êñ”¢w&Vfñ∆≈Gvó7D&6≤r¬GW#¢„#R“¿¢≤Êñ”¢w&Vfñ∆≈&W6WBr¬GW#¢„R“¿¢”∞¢6ˆÁ7Bdîƒ≈ıE$T‰4Öı5DtU2“≤‚‚Â$Tdîƒ≈ÙdƒıU$ï4Öı$U¬‚‚Â$Tdîƒ≈ÙdƒıU$ï4Öı$U¬‚‚Â$Tdîƒ≈ÙdƒıU$ï4Öı$U”∞†¢ÚÚfV∆∆ñÊr&V¬G&VRá6VRó46Ü˜&∆UG&VUFñ∆Rí(	B6Ü˜'Bf«W''íˆ`¢ÚÚ«FW&ÊFñÊrf˜&VÜÊBˆ&6∂ÜÊB7vñÊw2ÜV∆BFá&˜VvÇFÚFÜRVÊB¬&WW6ñÊp¢ÚÚFÜR÷V∆VR6ˆ÷&Úw2˜v‚WFÜ˜&VB5tTUıı4RávñÊF˜r‰6ˆ÷&BÁ˜6W2ífñ¢ÚÚ&Vvñ‰6Ü&vU7FvRw2˜6R'&Ê6Ç&V∆˜rñÁ7FVBˆb∆ñ‚Fˆˆ¬◊7vñÊp¢ÚÚ&2¬6ÚFÜR6Ü˜7GV∆«í∆ˆˆ∑2∆ñ∂R&˜W"vVˆ‚7vñÊr∆ÊFñÊp¢ÚÚˆ‚FÜRG'VÊ≤&FÜW"FÜ‚FÜRvVÊW&ñ26ñÊv∆R÷Üó27vVWf∆∆&6≤‡¢6ˆÁ7B4ÑııE$TUı5DtU2“≥¬”¬“Ê÷ÜFó%6ñv‚”‚á≤˜6S¢G'VR¬fóÜVE6S¢G'VR¬Fó%6ñv‚¬GW#¢„SR“íì∞†¢ÚÚ'&V∂ñÊr&ˆ6≤á6VRó4÷ñÊV&∆U&ˆ6µFñ∆Rí(	BFá&VR∆ñ‚Fá'W7B¶'2¿¢ÚÚÊ˜B4ÑııE$TUı5DtU2r«FW&ÊFñÊr7vVW˜6S¢FÜRñ6≤◊6Ü˜fV¬ó0¢ÚÚf∆óVB7ñ∂R÷f˜'v&Bñ‚FÜó26∆˜Bá6VR÷∂UFˆˆ≈∆ÊT÷W6Çw2f∆ó ¢ÚÚ˜Fñˆ‚í7V6ñfñ6∆«í6Ú÷ñÊñÊr&VG227F&&ñÊrFÜB7ñ∂Rñ‚¬Ê˜@¢ÚÚ7vñÊvñÊr‚ÜR◊7Gñ∆R˜6RFÜBv2WFÜ˜&VBf˜"&∆FVBVFvR‡¢ÚÚfóÜVE6RÜ∆ñ∂R6Ü˜í∂VW2FÜó2f«W''íB6ˆÁ7FÁB6R&Vv&F∆W70¢ÚÚˆbFñu7VVB¬vÜñ6ÇˆÊ«í66∆W2FÜR6Ü˜fV¬w2˜v‚Fñrˆfñ∆¬7vñÊw2‡¢6ˆÁ7B‘î‰Uı$Ù4µı5DtU2“≥¬¬“Ê÷ÇÇí”‚á≤Êñ”¢wFá'W7Br¬fóÜVE6S¢G'VR¬GW#¢„SR“íì∞†¢ÚÚf˜&6W27V6ñfñ27vñÊrÊñ÷Fñˆ‚GW&ñÊr6Ü&vR7FvRÜRÊr‚FÜP¢ÚÚ&WfW'6R÷ÜˆRF˜72í¬˜fW'&ñFñÊrFÜRFˆˆ¬w2Ê˜&÷¬7FófTÊñ’7Gñ∆RÇí‡¢∆WB6Ü&vTÊñ‘˜fW'&ñFR“ÁV∆√∞†¢ÚÚ6ˆ÷&B&ñ∆óGí7vñÊr˜fW'&ñFW2á6WB'íG&ñvvW%vVˆÂ7vñÊufó7V¬w0¢ÚÚ˜G2¬6∆∆VBg&ˆ“6ˆ÷&B“¢Êß2÷ˆGV∆W2í¬∂WB6W&FRg&ˆ–¢ÚÚ6Ü&vTÊñ‘˜fW'&ñFR6Úf&“Fˆˆ¬6Ü&vR÷7FñˆÁ2ÊWfW"6ˆ∆∆ñFRvóFÄ¢ÚÚFÜV“‚Êñ“ñ6∑2vÜñ6ÇˆbWFFUFˆˆƒ÷W6Çw2WÜó7FñÊrW"◊7Gñ∆R&70¢ÚÚáFá'W7B˜7vVWˆ6Ü˜í∆ó2¬&Vv&F∆W72ˆbFÜRWVóVBvVˆ‚w2˜v‡¢ÚÚFVfV«B7Gñ∆R(	BRÊr‚Vñ6≤¶"«vó2∆ó2FÜRFá'W7B&2WfV‡¢ÚÚvÜñ∆RvñV∆FñÊrFÜRÜF6ÜWB‚Fó%6ñv‚f∆ó27vVWw2&˜FFñˆ‚ÜÊ@¢ÚÚ÷ó'&˜'2FÜRvVˆ‚7&óFRíf˜"«FW&ÊFñÊrf˜&VÜÊBˆ&6∂ÜÊB6ˆ÷&¢ÚÚ7FW2‚vñÊGWg&2˜7G&ñ∂Tg&2∆WBV6Ç&ñ∆óGíw2˜v‚vñÊGW2˜7G&ñ∂U0¢ÚÚ&FñÚG&ófRÜ˜r◊V6ÇˆbFÜR6˜6÷WFñ27vñÊró27VÁBvñÊFñÊrWg0¢ÚÚ7G&ñ∂ñÊr¬ñÁ7FVBˆbˆÊRfóÜVB7∆óBf˜"WfW'íGF6≤‚˜vW"66∆W0¢ÚÚFá'W7Bw2&V6Ç˜GW&‚f˜"‚WáG&◊FV∆Vw&ÜVBfñÊó6ÜñÊrÜóB‚6∆V&V@¢ÚÚWFˆ÷Fñ6∆«íˆÊ6RFÜR7vñÊrw2Fˆˆ≈7vñÊuB'VÁ2˜WB‡¢∆WB6ˆ÷&E7vñÊtÊñ““ÁV∆√∞¢∆WB6ˆ÷&E7vñÊu6ñv‚“∞¢∆WB6ˆ÷&E7vñÊuvñÊGWg&2“„c∞¢∆WB6ˆ÷&E7vñÊu7G&ñ∂Tg&2“„#É∞¢∆WB6ˆ÷&E7vñÊu˜vW"“∞¢ÚÚG'VRvÜñ∆R6Ü&vR÷ÊB◊&V∆V6R&ñ∆óGíw2vñÊGWó2&VñÊrÜV∆B(	@¢ÚÚ6VRG&ñvvW%vVˆ‰Üˆ∆Efó7V¬Çí˜&V∆V6UvVˆÂ7vñÊtÜˆ∆BÇí&V∆˜r‡¢∆WB6ˆ÷&E7vñÊtÜV∆B“f«6S∞¢ÚÚfó6ÜñÊrw2˜v‚WVóf∆VÁBˆb6ˆ÷&E7vñÊtÜV∆BÜÜˆ∆G2FÜRÜ'ˆˆ‚@¢ÚÚóG2vñÊGWWáG&V÷RvÜñ∆RvóFñÊrˆ‚&óFRíÊ˜r∆ófW2ñ‡¢ÚÚß2ˆfó6ÜñÊr÷÷ñÊñv÷RÊß2ávñÊF˜r‰fó6ÜñÊrí(	B&VB&V∆˜rfñFÜP¢ÚÚvñÊF˜r‰fó6ÜñÊrÁ&VGï˜6RvWGFW"¬6ñÊ6RóBw2FV∆ñ&W&FV«í6W&FP¢ÚÚg&ˆ“6ˆ÷&E7vñÊtÜV∆B˜G&ñvvW%vVˆ‰Üˆ∆Efó7V¬ávÜñ6ÇˆÊ«ív˜&≤f˜ ¢ÚÚ7FófUFˆˆ¬””“wvVˆ‚rí&FÜW"FÜ‚&WW6ñÊrFÜB7ó7FV“‡¢ÚÚW"÷&ñ∆óGí˜7B◊7G&ñ∂RW6R¬ñ‚6V6ˆÊG2(	B6WBfñ˜G2ÊÜˆ∆E2ˆ‚¢ÚÚG&ñvvW%vVˆÂ7vñÊufó7V¬˜G&ñvvW%vVˆ‰Üˆ∆Efó7V¬6∆¬Ü6ˆÊfñr∂Êˆ ¢ÚÚV6Ç&ñ∆óGíw2˜v‚fñ∆R6WG2¬Ê˜B'Vñ«B÷ñ‚VÊvñÊRFVfV«Bí‚÷VÁ0¢ÚÚ'W6RFÜRˆ∆B&˜˜'FñˆÊ¬◊FÚ◊vÜBw2÷∆VgBÜˆ∆B"(	B6VRFÜRÑ`¢ÚÚ6∆7V∆Fñˆ‚ñ‚WFFUFˆˆƒ÷W6Ç&V∆˜r‡¢∆WB6ˆ÷&E7vñÊtÜˆ∆E2“∞¢ÚÚ˜FñˆÊ¬gV∆¬b÷6ÜÊÊV¬˜6Rá∂ÊWWG&¬«vñÊGW«7G&ñ∂W“¬V6Ä¢ÚÚ∑Ç«í«¢«óF6Ç«ñr∆&ˆGïñw“íWFÜ˜&VBñ‚FÜRGF6≤÷Êñ÷Fñˆ‚VFóF˜"‡¢ÚÚvÜV‚6WB¬WFFUFˆˆƒ÷W6Ç∆ñW2óBvVÊW&ñ6∆«íñÁ7FVBˆbvˆñÊp¢ÚÚFá&˜VvÇÊñ“w2&W7ˆ∂RW"◊7Gñ∆Rf˜&◊V∆(	B6VRFÜR˜6R÷G&ófV‡¢ÚÚ'&Ê6ÇBFÜRF˜ˆbWFFUFˆˆƒ÷W6Çw27Gñ∆RñbˆV«6R6Üñ‚‡¢∆WB6ˆ÷&E7vñÊu˜6R“ÁV∆√∞¢ÚÚff∆ñ7Fñˆ‚ñG2á6VR&W6˜W&6R◊7ó7FV“Êß2w2ddƒî5DîÙÂ2íFÜó27vñÊrw0¢ÚÚ&ñ∆óGí6‚7GV∆«íñÊf∆ñ7B(	B6WBfñ˜G2Êff∆ñ7Fñˆ‰ñG2ˆ‡¢ÚÚG&ñvvW%vVˆÂ7vñÊufó7V¬˜G&ñvvW%vVˆ‰Üˆ∆Efó7V¬¬6ˆ◊WFVB'íV6Ä¢ÚÚ&ñ∆óGí÷ˆGV∆Rg&ˆ“óG2˜v‚6Ü˜6V‚Ww&FW2‚G&ófW2FÜR6ˆ÷&B6ˆÊP¢ÚÚG&ñ¬w26ˆ∆˜&ñÊrá6VRWFFT6ˆ÷&D6ˆÊUG&ñ¬ì≤V◊Gí÷VÁ2∆ñ‡¢ÚÚvÜóFRG&ñ¬‡¢∆WB6ˆ÷&E7vñÊtff∆ñ7Fñˆ‰ñG2“µ”∞¢ÚÚ6ˆ◊Êñˆ‚÷f˜"6ˆ÷&E7vñÊtff∆ñ7Fñˆ‰ñG3¢∂ñC¢◊V«“¬FÜR6÷P¢ÚÚW"÷ÜóBF÷vR◊V«Fó∆ñW"÷6ˆ÷&B“¢Êß276W20¢ÚÚF÷vT7&VGW&Rw2˜G2Êff∆ñ7Fñˆ‰&ˆÁW6W2á6VR6ˆ÷&B◊&ˆw&W76ñˆ‚Êß2w0¢ÚÚvWDVffV7G2í(	B6WBfñ˜G2Êff∆ñ7FñˆÁ2∆ˆÊw6ñFRff∆ñ7Fñˆ‰ñG2‡¢ÚÚ∆WG2FÜR«VÊvRG&ñ¬á6VR7v‰«VÊvUG&ñ≈7F◊í&Ê≤&÷˜7B∆ñVB ¢ÚÚ'í7GV¬÷vÊóGVFRñÁ7FVBˆbßW7BG&VR÷∆WfV¬ñÁ6W'Fñˆ‚˜&FW"‡¢∆WB6ˆ÷&E7vñÊtff∆ñ7Fñˆ‰◊V«2“∑”∞¢ÚÚFÜRGF6≤w2˜v‚ÜóB6ˆÊRáv˜&∆B◊76R&ÊvRˆÜ∆b÷Êv∆Rˆf6ñÊrí¿¢ÚÚ6WBfñ˜G2Ê6ˆÊU&ÊvUÇˆ6ˆÊTÜ∆d6ˆÊU&Bˆ6ˆÊTÊv∆Rˆ‡¢ÚÚG&ñvvW%vVˆÂ7vñÊufó7V¬¬˜"∆FW"fñ6WD6ˆ÷&E7vñÊt6ˆÊRf˜ ¢ÚÚ&ñ∆óFñW2Ñ6Ü&vVB'&V∂W"ívÜ˜6RfñÊ¬&ÊvRó6‚wB∂Ê˜v‚VÁFñ¿¢ÚÚ&V∆V6R‚ÁV∆¬÷VÁ2FÜó27vñÊrÜ2ÊÚ6ˆÊRFÚG&ñ¬ÜRÊr‚∆ñ‡¢ÚÚf&÷ñÊrFˆˆ¬7Fñˆ‚í(	BWFFT6ˆ÷&D6ˆÊUG&ñ¬FÜV‚ÜñFW2WfW'í∆ÊR‡¢∆WB6ˆ÷&E7vñÊt6ˆÊR“ÁV∆√∞†¢gVÊ7Fñˆ‚vWDFñu7VVD◊V«Fó∆ñW"Çí∞¢&WGW&‚÷FÇÊ÷ÇÉ„¬∆ñW"ÊFñu7VVB«¬ì∞¢–†¢ÚÚ6ˆ∆∆6W2FÜR6Ü˜fV¬w26W&FRFñrÙfñ∆¬7Fñˆ‚6∆˜G2ñÁFÚˆÊP¢ÚÚ6ˆÁFWáGV¬ñÁWC¢vÜñ6ÜWfW"ˆbFÜRGvÚFÜR∆ñW"Ü26V∆V7FVB¿¢ÚÚ&W6ˆ«fRFÚvÜñ6ÜWfW"ó27GV∆«íf∆ñBf˜"FÜRF&vWFVBFñ∆R‚Fñp¢ÚÚÜñÊ6«VFñÊr&VFñvvñÊr6Ü∆∆˜rG&VÊ6ÇíF∂W2&ñ˜&óGì≤f∆¬&6≤F¢ÚÚfñ∆¬ˆÊ«ívÜV‚Fñró6‚wBf∆ñB¬íÊR‚‚«&VGí÷gV∆¬G&VÊ6Ç(	B6ÚFÜP¢ÚÚ6÷RñÁWBFñw2˜"fñ∆«2FWVÊFñÊrˆ‚vÜBw2F&vWFVB¬ˆ‚FW6∑F˜ ¢ÚÚÊB÷ˆ&ñ∆R∆ñ∂R‡¢gVÊ7Fñˆ‚&W6ˆ«fTFñtfñ∆ƒ7Fñˆ‚áFˆˆ¬¬7Fñˆ‚¬&WFñ6∆Rí∞¢ñbáFˆˆ¬”“w6Ü˜fV¬r«¬Ü7Fñˆ‚”“vFñrrbb7Fñˆ‚”“vfñ∆¬ríí&WGW&‚7Fñˆ„∞¢ñbÜ6ÂW6T7Fñˆ‚áFˆˆ¬¬vFñrr¬&WFñ6∆RÊ6ˆ¬¬&WFñ6∆RÁ&˜ríí&WGW&‚vFñrs∞¢ñbÜ6ÂW6T7Fñˆ‚áFˆˆ¬¬vfñ∆¬r¬&WFñ6∆RÊ6ˆ¬¬&WFñ6∆RÁ&˜ríí&WGW&‚vfñ∆¬s∞¢&WGW&‚7Fñˆ„∞¢–†¢ÚÚvÜWFÜW"7F'FñÊrFÜó2Fˆˆ¬ˆ7Fñˆ‚&ñváBÊ˜rv˜V∆B∂ñ6≤ˆfb◊V«Fí◊7FvP¢ÚÚ6Ü&vRÜÊWrG&VÊ6ÇFñr¬fñ∆∆ñÊrˆÊRñ‚¬˜"fV∆∆ñÊr&V¬G&VRí&FÜW ¢ÚÚFÜ‚fó&ñÊrñ÷÷VFñFV«í‚&VFñvvñÊr‚WÜó7FñÊr6Ü∆∆˜rG&VÊ6Çó2¢ÚÚÊ˜&÷¬6ñÊv∆R◊F7vñÊrñÁ7FVB‡¢gVÊ7Fñˆ‚v˜V∆E7F'D6Ü&vRáFˆˆ¬¬7Fñˆ‚í∞¢ñbáFˆˆ¬””“vÜRrbb7Fñˆ‚””“v6Ü˜rí∞¢6ˆÁ7B&WFñ6∆R“vWE&WFñ6∆UFñ∆RÇì∞¢&WGW&‚ó46Ü˜&∆UG&VUFñ∆Rá&WFñ6∆RÊ6ˆ¬¬&WFñ6∆RÁ&˜rì∞¢–¢ñbáFˆˆ¬””“wñ6≤rbb7Fñˆ‚””“v÷ñÊRrí∞¢6ˆÁ7B&WFñ6∆R“vWE&WFñ6∆UFñ∆RÇì∞¢&WGW&‚ó4÷ñÊV&∆U&ˆ6µFñ∆Rá&WFñ6∆RÊ6ˆ¬¬&WFñ6∆RÁ&˜rì∞¢–¢ñbáFˆˆ¬”“w6Ü˜fV¬r«¬Ü7Fñˆ‚”“vFñrrbb7Fñˆ‚”“vfñ∆¬ríí&WGW&‚f«6S∞¢6ˆÁ7B&WFñ6∆R“vWE&WFñ6∆UFñ∆RÇì∞¢6ˆÁ7B&W6ˆ«fVB“&W6ˆ«fTFñtfñ∆ƒ7Fñˆ‚áFˆˆ¬¬7Fñˆ‚¬&WFñ6∆Rì∞¢ñbÇ6ÂW6T7Fñˆ‚áFˆˆ¬¬&W6ˆ«fVB¬&WFñ6∆RÊ6ˆ¬¬&WFñ6∆RÁ&˜ríí&WGW&‚f«6S∞¢ñbá&W6ˆ«fVB””“vfñ∆¬rí&WGW&‚G'VS≤ÚÚ6ÂW6T7Fñˆ‚«&VGí&WVó&VB‚WÜó7FñÊrG&VÊ6Ä¢6ˆÁ7BFñ∆R“vWD7FófTw&ñBÇï∑&WFñ6∆RÁ&˜u’∑&WFñ6∆RÊ6ˆ≈”∞¢&WGW&‚Fñ∆RÁGóR”“Fñ∆UGóRÂE$T‰4É∞¢–†¢gVÊ7Fñˆ‚7F'D6Ü&vT7Fñˆ‚á&WFñ6∆R¬7FvW2í∞¢ñbÜ6Ü&vT7Fñˆ‚í&WGW&„∞¢ÚÚvÜñ6ÇvíFÜR&Vfñ∆¬f∆˜W&ó6Çw26÷W&÷f6ñÊrGW&‚6Ü˜V∆B&˜FFR(	@¢ÚÚvÜñ6ÜWfW"6ñFRˆb&f6ñÊrFÜR6÷W&"ÜÊv∆RíFÜR∆ñW"ó0¢ÚÚ7W'&VÁF«í6∆˜6W"FÚ¬6ÚFÜRGW&‚÷˜WB&VG22ÊGW&¬óf˜B‡¢6ˆÁ7BGW&‰FV«F“Êv∆TFñfbÉ¬∆ñW$f6ñÊrì∞¢6ˆÁ7B&Vfñ∆≈GW&Â6ñv‚“GW&‰FV«F””“Ú¢÷FÇÁ6ñv‚áGW&‰FV«Fì∞¢6Ü&vT7Fñˆ‚“≤6ˆ√¢&WFñ6∆RÊ6ˆ¬¬&˜s¢&WFñ6∆RÁ&˜r¬7Fñˆ„¢7FófT7Fñˆ‚¬Fˆˆ√¢7FófUFˆˆ¬¬7FvS¢¬7FvW2¬&Vfñ∆≈GW&Â6ñv‚”∞¢&Vvñ‰6Ü&vU7FvRÇì∞¢–†¢gVÊ7Fñˆ‚&Vvñ‰6Ü&vU7FvRÇí∞¢ñbÇ6Ü&vT7Fñˆ‚í&WGW&„∞¢6ˆÁ7B7FvTFVb“6Ü&vT7Fñˆ‚Á7FvW5∂6Ü&vT7Fñˆ‚Á7FvU”∞¢ÚÚFñu7VVBˆÊ«í66∆W26Ü˜fV¬Fñr÷ÊB÷fñ∆¬7FvW2(	BFÜRÜR6Ü˜Ê@¢ÚÚñ6≤÷ñÊRf«W'&ñW2á6VR4ÑııE$TUı5DtU2Ù‘î‰Uı$Ù4µı5DtU2í7vñÊr@¢ÚÚfóÜVB6R&Vv&F∆W72¬÷&∂VBfñfóÜVE6R&FÜW"FÜ‚&WW6ñÊp¢ÚÚ˜6VÊ˜rFÜB÷ñÊRw2f«W''í∆ó2∆ñ‚Fá'W7BÊñ“ñÁ7FVBˆ`¢ÚÚ˜6R÷G&ófV‚7vVW‡¢6ˆÁ7BGW"“7FvTFVbÊfóÜVE6RÚ7FvTFVbÊGW"¢7FvTFVbÊGW"ÚvWDFñu7VVD◊V«Fó∆ñW"Çì∞¢Fˆˆ≈7vñÊtGW"“GW#∞¢Fˆˆ≈7vñÊuB“GW#∞¢7G&ñ∂Tfó&VB“f«6S∞¢VÊFñÊt7Fñˆ‚“ÁV∆√∞¢ñbá7FvTFVbÁ˜6Rí∞¢ÚÚ&WW6W2FÜR÷V∆VR6ˆ÷&Úw2˜v‚WFÜ˜&VB7vVW˜6Rá6VP¢ÚÚ6ˆ÷&B÷6ˆ÷&ÚÊß2w25tTUıı4R¬Wá˜'FVB2vñÊF˜r‰6ˆ÷&BÁ˜6W2ê¢ÚÚñÁ7FVBˆb6Ü&vTÊñ‘˜fW'&ñFR&2(	B6÷R˜6R÷G&ófV‚'&Ê6Ä¢ÚÚWFFUFˆˆƒ÷W6Ç«&VGí∆ó2f˜"vVˆ‚7vñÊw2‡¢6Ü&vTÊñ‘˜fW'&ñFR“ÁV∆√∞¢6ˆ÷&E7vñÊtÊñ““w7vVWs∞¢6ˆ÷&E7vñÊu˜6R“vñÊF˜r‰6ˆ÷&CÚÁ˜6W3ÚÂ5tTUıı4R«¬ÁV∆√∞¢6ˆ÷&E7vñÊu6ñv‚“7FvTFVbÊFó%6ñv‚«¬∞¢6ˆ÷&E7vñÊuvñÊGWg&2“„##∞¢6ˆ÷&E7vñÊu7G&ñ∂Tg&2“„SS∞¢6ˆ÷&E7vñÊu˜vW"“∞¢6ˆ÷&E7vñÊtÜˆ∆E2“∞¢6ˆ÷&E7vñÊtff∆ñ7Fñˆ‰ñG2“µ”∞¢6ˆ÷&E7vñÊtff∆ñ7Fñˆ‰◊V«2“∑”∞¢“V«6R∞¢6Ü&vTÊñ‘˜fW'&ñFR“7FvTFVbÊÊñ“«¬ÁV∆√∞¢6ˆ÷&E7vñÊtÊñ““ÁV∆√∞¢6ˆ÷&E7vñÊu˜6R“ÁV∆√∞¢–¢–†¢ÚÚ∆ó2FÜRvVˆ‚w2WÜó7FñÊr&“◊7vñÊr÷W6ÇÊñ÷Fñˆ‚f˜"GW&FñˆÂ2vóFÜ˜W@¢ÚÚVWVñÊrVÊFñÊt7Fñˆ‚(	BW6VB'í6ˆ÷&B&ñ∆óGí÷ˆGV∆W2FÜB&W6ˆ«fRFÜVó ¢ÚÚ˜v‚ÜóB∆ˆvñ2ÊBßW7BvÁBFÜR∆Vv7í7vñÊrw2fó7V¬f∆˜W&ó6ÇFÚ÷F6Ç‡¢ÚÚ˜G3¢≤Êñ”¢wFá'W7Bw¬w7vVWw¬v6Ü˜r¬Fó%6ñv„¢¬”¬vñÊGWg&2¬7G&ñ∂Tg&2¬˜vW"¬Üˆ∆E2–¢ÚÚ∆WG26ˆ÷&B&ñ∆óGíñ6≤FÜRGF6≤◊6ÜRóG2Êñ÷Fñˆ‚6Ü˜V∆BW6P¢ÚÚÜñÊFWVÊFVÁBˆbFÜRWVóVBvVˆ‚w2˜v‚FVfV«B7Gñ∆Rí¬Ü˜róG2˜v‡¢ÚÚvñÊGW2˜7G&ñ∂U27∆óB÷2ˆÁFÚFÜR6˜6÷WFñ27vñÊr&2¬áFá'W7@¢ÚÚˆÊ«íí&V6Ç˜GW&‚◊V«Fó∆ñW"f˜"‚WáG&◊FV∆Vw&ÜVBfñÊó6ÜW"¬ÊB‡¢ÚÚWá∆ñ6óB˜7B◊7G&ñ∂RW6R∆VÊwFÇñ‚6V6ˆÊG2ÜÜˆ∆E2í‡¢gVÊ7Fñˆ‚G&ñvvW%vVˆÂ7vñÊufó7V¬ÜGW&FñˆÂ2¬˜G2“∑“í∞¢ñbÜ7FófUFˆˆ¬”“wvVˆ‚rí&WGW&„∞¢6ˆÁ7BvñÊGWg&2“˜G2ÁvñÊGWg&2ÛÚ„c∞¢6ˆÁ7B7G&ñ∂Tg&2“˜G2Á7G&ñ∂Tg&2ÛÚ„#É∞¢ÚÚ&ñ∆óFñW2FÜBFˆ‚wB'VFvWBFÜVó"˜v‚&WGW&‚◊FÚ÷ÊWWG&¬Fñ¿¢ÚÚá7G&ñ∂Tg&2””“(	B6Ü&vVB'&V∂W"¬f«W''í¬Vñ6≤GF6∑2¬6˜VÁFW ¢ÚÚ6ÜñV∆Bw2&ó˜7FR¬ÊBWfW'íÊˆ‚÷fñÊó6ÜW"6ˆ÷&Ú7FWív˜V∆B˜FÜW'vó6P¢ÚÚÜfR6ˆ÷&E7vñÊtÊñ“6∆V"á6VRFÜRFˆˆ≈7vñÊuB√“6ÜV6≤&V∆˜rê¢ÚÚFÜRñÁ7FÁBFÜR7G&ñ∂R∆ÊG2¬6ÊñÊr∆ñW$÷W6Ç7G&ñváBF¢ÚÚWFFU∆ñW$÷W6Çw2÷˜fV÷VÁB÷f6ñÊrFVfV«BvóFÇ¶W&ÚV6ñÊr(	BFÜP¢ÚÚñ‚÷v÷RWVóf∆VÁBˆbFÜRVFóF˜"w26÷ˆ˜FÇV6VB&WGW&‚ÊWfW ¢ÚÚ∆ññÊr‚&W6W'fR&˜˜'FñˆÊ¬Fñ¬ÜW&R6ÚWfW'í7vñÊrV6W0¢ÚÚ&6≤&Vv&F∆W72ˆbvÜBFÜR6∆∆W"'VFvWFVB¬FÜR6÷RvíÑbó0¢ÚÚWFÚ÷FW&ófVBg&ˆ“4bñ‚WFFUFˆˆƒ÷W6Ç¬vóFÜ˜WBÊVVFñÊrÁê¢ÚÚW"÷&ñ∆óGí6ÜÊvW2ñ‚FÜR6ˆ÷&B“¢Êß2fñ∆W2‚6∆∆W'2FÜB«&VGê¢ÚÚ&W6W'fVBFÜVó"˜v‚&WGW&Â2á7G&ñ∂Tg&2¬í&R∆VgBVÁF˜V6ÜVB‡¢6ˆÁ7BÜ4˜vÂ&WGW&‚“7G&ñ∂Tg&2¬„ììì∞¢6ˆÁ7B&WGW&ÂFñ≈2“Ü4˜vÂ&WGW&‚Ú¢÷FÇÊ÷ÇÉ„"¬GW&FñˆÂ2¢„3Rì∞¢ÚÚ&W6W'fR‚Wá∆ñ6óB˜7B◊7G&ñ∂RÜˆ∆BÜñbFÜó2&ñ∆óGíw26ˆÊfñr6∂V@¢ÚÚf˜"ˆÊRíˆ‚F˜ˆbvÜFWfW"vñÊGW˜7G&ñ∂R˜&WGW&‚óB«&VGê¢ÚÚ'VFvWFVB(	BFFóFófR¬&FÜW"FÜ‚6'fñÊróB˜WBˆbGW&FñˆÂ2¬6¢ÚÚFÜRvñÊGW˜7G&ñ∂R˜&WGW&‚&V¬◊v˜&∆BFñ÷ñÊw27FíWÜ7F«í0¢ÚÚWFÜ˜&VC≤FÜRW6Ró2ßW7BñÁ6W'FVB&WGvVV‚7G&ñ∂RÊB&WGW&‚‡¢6ˆÁ7BÜˆ∆E2“÷FÇÊ÷ÇÉ¬˜G2ÊÜˆ∆E2«¬ì∞¢6ˆÁ7BF˜F≈2“GW&FñˆÂ2≤&WGW&ÂFñ≈2≤Üˆ∆E3∞¢Fˆˆ≈7vñÊtGW"“÷FÇÊ÷ÇÉ„R¬F˜F≈2ì∞¢Fˆˆ≈7vñÊuB“Fˆˆ≈7vñÊtGW#∞¢7G&ñ∂Tfó&VB“f«6S∞¢VÊFñÊt7Fñˆ‚“ÁV∆√∞¢6ˆ÷&E7vñÊtÊñ““˜G2ÊÊñ“«¬ÁV∆√∞¢6ˆ÷&E7vñÊu6ñv‚“˜G2ÊFó%6ñv‚«¬∞¢6ˆ÷&E7vñÊuvñÊGWg&2“vñÊGWg&2¢GW&FñˆÂ2ÚF˜F≈3∞¢6ˆ÷&E7vñÊu7G&ñ∂Tg&2“7G&ñ∂Tg&2¢GW&FñˆÂ2ÚF˜F≈3∞¢6ˆ÷&E7vñÊu˜vW"“˜G2Á˜vW"ÛÚ∞¢6ˆ÷&E7vñÊu˜6R“˜G2Á˜6R«¬ÁV∆√∞¢6ˆ÷&E7vñÊtÜˆ∆E2“Üˆ∆E3∞¢6ˆ÷&E7vñÊtÜV∆B“f«6S∞¢6ˆ÷&E7vñÊtff∆ñ7Fñˆ‰ñG2“˜G2Êff∆ñ7Fñˆ‰ñG2«¬µ”∞¢6ˆ÷&E7vñÊtff∆ñ7Fñˆ‰◊V«2“˜G2Êff∆ñ7FñˆÁ2«¬∑”∞¢6WD6ˆ÷&E7vñÊt6ˆÊRÜ˜G2Ê6ˆÊU&ÊvUÇ¬˜G2Ê6ˆÊTÜ∆d6ˆÊU&B¬˜G2Ê6ˆÊTÊv∆Rì∞¢–†¢ÚÚ&ñ∆óFñW2vÜ˜6RfñÊ¬&ÊvRˆÊv∆Ró6‚wB∂Ê˜v‚BG&ñvvW"Fñ÷P¢ÚÚÑ6Ü&vVB'&V∂W"w26Ü&vR◊66∆VB6∆“¬FV6ñFVBB&V∆V6R&FÜW ¢ÚÚFÜ‚BFÜRÜˆ∆B◊7F'BvñÊGWí6∆¬FÜó2Fó&V7F«íˆÊ6RFÜ˜6P¢ÚÚÁV÷&W'2&R6WGF∆VBñÁ7FVBˆbvˆñÊrFá&˜VvÇG&ñvvW%vVˆÂ7vñÊufó7V¬w0¢ÚÚ˜G2‚72&ÊvUÇ”“ÁV∆¬FÚ6∆V"FÜR6ˆÊRÜÊÚG&ñ¬FÚG&rí‡¢gVÊ7Fñˆ‚6WD6ˆ÷&E7vñÊt6ˆÊRá&ÊvUÇ¬Ü∆d6ˆÊU&B¬Êv∆Rí∞¢6ˆ÷&E7vñÊt6ˆÊR“á&ÊvUÇ“ÁV∆¬ê¢Ú≤&ÊvUÇ¬Ü∆d6ˆÊU&C¢Ü∆d6ˆÊU&BÛÚ¬Êv∆S¢Êv∆RÛÚ∆ñW"ÊÊv∆R–¢¢ÁV∆√∞¢–†¢ÚÚ∆ñ∂RG&ñvvW%vVˆÂ7vñÊufó7V¬¬'WBˆÊ6RFÜRvñÊGWÜ6RfñÊó6ÜW0¢ÚÚá&ˆw&W72&V6ÜW2vñÊGWg&2íFÜR7vñÊrg&VW¶W2FÜW&R(	BÜV∆BBóG0¢ÚÚvñÊGWWáG&V÷R(	BñÁ7FVBˆb6ˆÁFñÁVñÊrñÁFÚFÜR7G&ñ∂R‚W6VB'ê¢ÚÚ6Ü&vR÷ÊB◊&V∆V6R&ñ∆óFñW2ÜRÊr‚6Ü&vVB'&V∂W"í6ÚFÜRvñÊGW ¢ÚÚ∆ó2˜WBvÜñ∆RFÜR'WGFˆ‚ó2ÜV∆BF˜v‚¬ÊÚ÷GFW"Ü˜r∆ˆÊrFÜ@¢ÚÚVÊG2W&VñÊr¬ÊB6∆¬&V∆V6UvVˆÂ7vñÊtÜˆ∆BÇíˆ‚&V∆V6RFÚ∆W@¢ÚÚFÜR«&VGí÷V∆6VB6˜VÁFF˜v‚6''í7G&ñváBˆ‚ñÁFÚFÜR7G&ñ∂RÊ@¢ÚÚ&WGW&‚Ü6W2‡¢gVÊ7Fñˆ‚G&ñvvW%vVˆ‰Üˆ∆Efó7V¬ÜGW&FñˆÂ2¬˜G2“∑“í∞¢G&ñvvW%vVˆÂ7vñÊufó7V¬ÜGW&FñˆÂ2¬˜G2ì∞¢6ˆ÷&E7vñÊtÜV∆B“G'VS∞¢–†¢gVÊ7Fñˆ‚&V∆V6UvVˆÂ7vñÊtÜˆ∆BÇí∞¢6ˆ÷&E7vñÊtÜV∆B“f«6S∞¢–†¢ÚÚ&ÊFˆÁ2ÜV∆BvñÊGWvóFÜ˜WB∆ññÊrFÜR7G&ñ∂R(	BRÊr‚FÜR'WGFˆ‡¢ÚÚv2&V∆V6VB&Vf˜&RFÜR&ñ∆óGíw2÷ñÊñ◊V“6Ü&vR‚6Ê2FÜR7vñÊp¢ÚÚ&6≤FÚóG2&W7B˜6Rá&ˆw&W72¬6÷R2FÜR7F'BˆbÁí˜FÜW ¢ÚÚ7vñÊrw2vñÊGWíñÁ7FVBˆb6''ññÊrˆ‚ñÁFÚFÜR7G&ñ∂R‡¢gVÊ7Fñˆ‚6Ê6V≈vVˆÂ7vñÊtÜˆ∆BÇí∞¢6ˆ÷&E7vñÊtÜV∆B“f«6S∞¢Fˆˆ≈7vñÊuB“∞¢–†¢gVÊ7Fñˆ‚6Ê6Vƒ6Ü&vT7Fñˆ‚Çí∞¢ñbÇ6Ü&vT7Fñˆ‚í&WGW&„∞¢6Ü&vT7Fñˆ‚“ÁV∆√∞¢Fˆˆ≈7vñÊuB“∞¢6Ü&vTÊñ‘˜fW'&ñFR“ÁV∆√∞¢–†¢gVÊ7Fñˆ‚6ˆ◊∆WFT6Ü&vT7Fñˆ‚Çí∞¢6ˆÁ7B≤6ˆ¬¬&˜r¬7Fñˆ‚¬Fˆˆ¬““6Ü&vT7Fñˆ„∞¢6Ü&vT7Fñˆ‚“ÁV∆√∞¢6Ü&vTÊñ‘˜fW'&ñFR“ÁV∆√∞¢ÚÚ&R÷6ÜV6≤W&÷ó76ñˆ‚B6ˆ◊∆WFñˆ‚FˆÚÜÊ˜BßW7BB6Ü&vR◊7F'Bíñ‡¢ÚÚ66Rf&÷ÜÊBw&ÁB6ÜÊvW2÷ñB÷6Ü&vR‡¢6ˆÁ7Bˆ6Ü&vUW&‘6FVv˜'í“f&‘7FñˆÂW&÷ó76ñˆ‰6FVv˜'íáFˆˆ¬¬7Fñˆ‚ì∞¢ñbÖˆ6Ü&vUW&‘6FVv˜'íbbÜ4f&’W&÷ó76ñˆ‚Öˆ6Ü&vUW&‘6FVv˜'ííí∞¢6ˆÁ7B◊6r“$ˆÊ«íFÜRf&“w2˜vÊW"Ü˜"w&ÁFVBf&÷ÜÊBí6‚FÚFÜBÜW&R‚#∞¢∆7D7Fñˆ‰÷W76vR“◊6s∞¢6Ü˜uFˆ7BÜ◊6r¬f«6Rì∞¢&Vg&W6Ñ7Fñˆ‰&"Çì∞¢&WGW&„∞¢–¢6ˆÁ7B&W7V«B“«î7Fñˆ‚áFˆˆ¬¬7Fñˆ‚¬6ˆ¬¬&˜rì∞¢∆7D7Fñˆ‰÷W76vR“&W7V«BÊ÷W76vS∞¢6Ü˜uFˆ7Bá&W7V«BÊ÷W76vR¬&W7V«BÊˆ≤”“f«6Rì∞¢7v‰7FñˆÂ'Fñ6∆W2Ü6ˆ¬¬&˜r¬7Fñˆ‚¬&W7V«BÊˆ≤”“f«6Rì∞¢FV'Vt∆ˆrÜG∑&W7V«BÊˆ≤Úvˆ≤r¢v&∆ˆ6∂VBw“G∂7FñˆÁ“2G∂6ˆ«“«"G∑&˜w”¢G∑&W7V«BÊ÷W76vW÷ì∞¢ñbÜ7W'&VÁD&V””“vf&“rí∞¢&V6ˆ◊WFUvFW"Üf«6Rì∞¢ÚÚ6VRFÜR÷F6ÜñÊr'&Ê6Çñ‚fó&UVÊFñÊt7Fñˆ‚(	B6ˆ◊∆WFVBFñr¢ÚÚfñ∆¬6Ü&vRÜÊWrG&VÊ6Ç¬fñ∆¬÷ñ‚íÊVVG2FÜR6÷R6fTf&‘∆ñ˜WBÇê¢ÚÚfóÇ¬˜"óBw2ßW7B26ñ∆VÁF«í∆˜7B26ñÊv∆R◊F7Fñˆ‚‡¢ñbá&W7V«BÊˆ≤”“f«6Rí≤÷&µFñ∆TFó'GíÜ6ˆ¬¬&˜rì≤6fTf&‘∆ñ˜WBÇì≤–¢“V«6RñbÖˆó5¶ˆÊT&VÜ7W'&VÁD&Víbb&W7V«BÊˆ≤”“f«6Rbb&W7V«BÁ¶ˆÊUfó7V«5WFFVBbbáFˆˆ¬””“w6Ü˜fV¬r«¬Fˆˆ¬””“wñ6≤r«¬Fˆˆ¬””“vÜˆRr«¬Fˆˆ¬””“vÜRríí∞¢ÚÚ6VRFÜR÷F6ÜñÊr'&Ê6Çñ‚fó&UVÊFñÊt7Fñˆ‚(	BFÜó2ó2FÜR6Ü&vR–¢ÚÚ7Fñˆ‚6ˆ◊∆WFñˆ‚FÇÜ'&ÊB÷ÊWrG&VÊ6ÇFñr˜"fñ∆¬÷ñ‚ó2¢ÚÚ◊V«Fí◊7FvR6Ü&vR¬Ê˜B6ñÊv∆RFí¬ÊBÊVVG2FÜR6÷RfóÇ‡¢&Vg&W6Ö¶ˆÊTw&˜VÊEfó7V«2Ü7W'&VÁD&Vì∞¢–¢ñbá&W7V«BÊˆ≤”“f«6Rí6fT÷V÷&W%v˜&∆DFFÇì∞¢&Vg&W6Ñ7Fñˆ‰&"Çì∞¢–†¢ÚÚGfÊ6W2FÜRñ‚◊&ˆw&W726Ü&vR'íˆÊR7FvRˆÊ6RóG27vñÊrfñÊó6ÜW2¿¢ÚÚ˜"6Ê6V«2óBFÜR÷ˆ÷VÁBFÜR'WGFˆ‚ó2&V∆V6VB˜"FÜRF&vWB6ÜÊvW2‡¢gVÊ7Fñˆ‚WFFT6Ü&vT7Fñˆ‚Çí∞¢ñbÇ6Ü&vT7Fñˆ‚í&WGW&„∞¢ñbÇ7Fñˆ‰ÜV∆DF˜v‚í≤6Ê6Vƒ6Ü&vT7Fñˆ‚Çì≤&WGW&„≤–¢6ˆÁ7B&WFñ6∆R“vWE&WFñ6∆UFñ∆RÇì∞¢ñbá&WFñ6∆RÊ6ˆ¬”“6Ü&vT7Fñˆ‚Ê6ˆ¬«¬&WFñ6∆RÁ&˜r”“6Ü&vT7Fñˆ‚Á&˜rí≤6Ê6Vƒ6Ü&vT7Fñˆ‚Çì≤&WGW&„≤–¢ñbáFˆˆ≈7vñÊuB‚í&WGW&„∞¢6Ü&vT7Fñˆ‚Á7FvR≤≥∞¢ñbÜ6Ü&vT7Fñˆ‚Á7FvR„“6Ü&vT7Fñˆ‚Á7FvW2Ê∆VÊwFÇí∞¢6ˆ◊∆WFT6Ü&vT7Fñˆ‚Çì∞¢“V«6R∞¢7v‰7FñˆÂ'Fñ6∆W2Ü6Ü&vT7Fñˆ‚Ê6ˆ¬¬6Ü&vT7Fñˆ‚Á&˜r¬6Ü&vT7Fñˆ‚Ê7Fñˆ‚¬G'VRì∞¢&Vvñ‰6Ü&vU7FvRÇì∞¢–¢–†¢ÚÚ)H)H&WFñ6∆R÷W6Ç)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢6ˆÁ7B&WFñ6∆T÷W6Ç“ÊWrDÖ$TR‰÷W6Çá&WFñ6∆TvVÚ¬&WFñ6∆T÷Bì∞¢66VÊRÊFBá&WFñ6∆T÷W6Çì∞¢66VÊRÊFBá&WFñ6∆T6ó&6∆T÷W6Çì∞¢66VÊRÊFBá&WFñ6∆U&ñÊt÷W6Çì∞¢66VÊRÊFBá&WFñ6∆Uvgîw&˜Wì∞†¢ÚÚ)H)HFˆˆ¬÷W6ÜW2Ö‰r7&óFR∆ÊW2í)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢ÚÚFˆˆ≈7vñÊuB6˜VÁG2F˜v‚g&ˆ“Fˆˆ≈7vñÊtGW#≤&ˆw&W72““BˆGW"É(i#(i#&2í‡¢ÚÚW"◊Fˆˆ¬7vñÊrGW&FñˆÁ3¢Fá'W7Bf7B¬6Ü˜÷VFóV“¬7vVW6∆˜r‡¢∆WBFˆˆ≈7vñÊuB“∞¢∆WBFˆˆ≈7vñÊtGW"“„##∞¢ÚÚ6WBG'VRf˜"FÜRGW&Fñˆ‚ˆbfó6ÜñÊr◊7V"Fá&˜r7vñÊr6ÚWFFUFˆˆƒ÷W6Ä¢ÚÚf∆ñW2FÜRÜ'ˆˆ‚÷W6Ç˜WBFÚFÜRvFW"Ê6Ü˜"ñÁ7FVBˆb6∆÷÷ñÊrñ‚∆6R‡¢∆WBfó6ÖFá&˜t7FófR“f«6S∞¢ÚÚgV∆¬&˜FFñˆÁ2'7ñÊÊñÊr"Ü'ˆˆ‚7&óFRÜRÊr‚FÜRfó6ÜñÊr÷6RíGvó&«2Fá&˜VvÇ˜fW ¢ÚÚˆÊR6ˆ◊∆WFR7vñÊs≤7V"÷÷ˆFRÜ'ˆˆ‚óFV◊2∆VfRFÜVó"7ñÊÊñÊvf∆rf«6R˜VÁ6WB‡¢6ˆÁ7BDÙÙ≈ı5îÂı$UdÙ≈UDîÙÂ2“"„S∞†¢ÚÚ&VfW&VÊ6RvñGFÇñ‚v˜&∆BVÊóG3≤ÜVñváBó2FW&ófVBg&ˆ“FÜRñ÷vRw27V7B&FñÚ¿¢ÚÚ÷F6ÜñÊrFÜRGFW&‚W6VB'í'Vñ∆DÊñ÷≈∆ÊTfF$÷ˆFV¬Ü÷ˆFV≈vñGFÇ9rÇ˜rí‡¢6ˆÁ7BDÙÙ≈Ù‘ÙDT≈ıtîEDÇ“„S∞†¢ÚÚ&V∆ˆBFˆˆ¬7&óFRFWáGW&W3≤6GW&RóÜV¬Fñ÷VÁ6ñˆÁ2ˆ‚∆ˆBÊB&V'Vñ∆B÷W6ÜW0¢6ˆÁ7B˜Fˆˆ≈FWÑ∆ˆFW"“ÊWrDÖ$TRÂFWáGW&T∆ˆFW"Çì∞¢6ˆÁ7BFˆˆ≈FWáGW&W2“∑”∞¢f˜"Ü6ˆÁ7B∂∂Wí¬FVe“ˆbˆ&¶V7BÊVÁG&ñW2ÖDÙÙ≈ÙïDT’ÙDTe2íí∞¢6ˆÁ7BFWÇ“˜Fˆˆ≈FWÑ∆ˆFW"Ê∆ˆBÜFVbÁ7&óFR¬áBí”‚∞¢6ˆÁ7Bñ÷r“BÊñ÷vS∞¢FVbÂˆñ÷ur“ñ÷rÊÊGW&≈vñGFÇ«¬ñ÷rÁvñGFÇ«¬∞¢FVbÂˆñ÷tÇ“ñ÷rÊÊGW&ƒÜVñváB«¬ñ÷rÊÜVñváB«¬∞¢ÚÚ&V'Vñ∆BvóFÇ6˜'&V7B7V7B&FñÚÊ˜rFÜBFñ÷VÁ6ñˆÁ2&R∂Ê˜v‡¢&V'Vñ∆EFˆˆƒ÷W6ÜW2Çì∞¢6ˆÁ7B7W"“Fˆˆƒ÷W6Ñ÷∂7FófUFˆˆ≈”∞¢ˆ&¶V7BÁf«VW2áFˆˆƒ÷W6Ñ÷íÊf˜$V6ÇÜ“”‚≤ñbÜ“íFˆˆƒÜˆ∆FW"Á&V÷˜fRÜ“ì≤“ì∞¢ñbÜ7W"íFˆˆƒÜˆ∆FW"ÊFBÜ7W"ì∞¢ÚÚ6÷óFÇ÷7&gFVBfW&Fñw&ó2Fˆˆ¬w2ñ‚÷ÜÊB÷W6Ç6Ü˜V∆B6Ü˜róG0¢ÚÚ÷WF¬˜fW&Fñw&ó2˜∆FñÊr¬Ê˜BFÜRf∆BFV¬∆6VÜˆ∆FW"'B(	@¢ÚÚ6VR&Vg&W6Ñ÷WF≈Fˆˆ≈v˜&∆EFWáGW&R‡¢ñbÜFVbÊ÷WFƒ∂Wíí&Vg&W6Ñ÷WF≈Fˆˆ≈v˜&∆EFWáGW&RÜ∂Wíì∞¢“ì∞¢FWÇÊ÷tfñ«FW"“DÖ$TR‰ÊV&W7Dfñ«FW#∞¢FWÇÊ÷ñ‰fñ«FW"“DÖ$TR‰ÊV&W7Dfñ«FW#∞¢Fˆˆ≈FWáGW&W5∂∂Wï““FWÉ∞¢–†¢ÚÚ7v27&gFVBFˆˆ¬w2ñ‚÷ÜÊB÷W6ÇFWáGW&RFÚóG27W'&VÁB÷WF¬¢ÚÚfW&Fñw&ó2˜∆FñÊr&V6ˆ∆˜"(	B6∆∆VBˆÊ6RóG2&6RFWáGW&RfñÊó6ÜW0¢ÚÚ∆ˆFñÊrá6VR&˜fRíÊBvñ‚ÁíFñ÷R6∆ˆˆ÷íÙ∑ßV'Vr6ÜÊvW2óG0¢ÚÚ∆FñÊrá6VR«î÷WF≈Fˆˆ≈∆FñÊrí‚&VñÊf˜&6V÷VÁBÊWfW"6∆«2FÜó3†¢ÚÚW"FW6ñv‚¬&VñÊf˜&6ñÊr∂VW2FÜRFˆˆ¬w2˜v‚&6R÷÷WF¬V&Ê6R‡¢gVÊ7Fñˆ‚&Vg&W6Ñ÷WF≈Fˆˆ≈v˜&∆EFWáGW&RÜóFV‘∂Wíí∞¢6ˆÁ7BFVb“DÙÙ≈ÙïDT’ÙDTe5∂óFV‘∂Wï”∞¢6ˆÁ7B˜G2“÷WF≈Fˆˆ≈&V6ˆ∆˜$˜FñˆÁ2ÜóFV‘∂Wíì∞¢6ˆÁ7BFWÇ“Fˆˆ≈FWáGW&W5∂óFV‘∂Wï”∞¢ñbÇFVcÚÁ7&óFR«¬˜G2«¬FWÇí&WGW&„∞¢vñÊF˜rÂFˆˆƒ÷WF≈&V6ˆ∆˜#ÚÊvWE&V6ˆ∆˜&VD6Áf2ÜFVbÁ7&óFR¬˜G2íÁFÜV‚Ü6Áf2”‚∞¢FWÇÊñ÷vR“6Áf3∞¢FWÇÊÊVVG5WFFR“G'VS∞¢“ì∞¢–†¢ÚÚ'Vñ∆B‰r∆ÊR÷W6Ç6ó¶VBFÚFÜR7&óFRw2óÜV¬7V7B&FñÚ‡¢ÚÚ6Ü&VB'íFÜR∆ñW"w2˜v‚WVóVB◊Fˆˆ¬÷W6Çá&V'Vñ∆EFˆˆƒ÷W6ÜW2í¬¢ÚÚ&ÊFóBw2vVˆ‚Ü÷∂T&ÊFóEFˆˆƒÜˆ∆FW"í¬ÊB‚Â2v˜&≤7FFñˆ‚w0¢ÚÚFó7∆ñVBFˆˆ¬‡¢ÚÚW6VB'í&˜FÇFˆˆ¬∆ÊW2ÊBÜV∆B&r÷óFV“∆ÊW2FÚ∂VWFÜV“&˜fP¢ÚÚ&W6˜W&6R◊&ñÊr∆ñW'2É√„ívÜñ∆R&V÷ñÊñÊr&V∆˜rfF"∆ÊW2É"≤í‡¢6ˆÁ7BÑTƒEÙÙ$§T5Eı$T‰DU%Ùı$DU"“„S∞¢gVÊ7Fñˆ‚÷∂UFˆˆ≈∆ÊT÷W6ÇÜóFV‘∂Wí¬˜G2“∑“í∞¢ñbÇóFV‘∂Wí«¬Fˆˆ≈FWáGW&W5∂óFV‘∂Wï“í&WGW&‚ÁV∆√∞¢6ˆÁ7BFVb“DÙÙ≈ÙïDT’ÙDTe5∂óFV‘∂Wï”∞¢6ˆÁ7Bñ÷ur“FVcÚÂˆñ÷ur«¬∞¢6ˆÁ7Bñ÷tÇ“FVcÚÂˆñ÷tÇ«¬∞¢6ˆÁ7B∆ÊUr“DÙÙ≈Ù‘ÙDT≈ıtîEDÉ∞¢6ˆÁ7B∆ÊTÇ“∆ÊUr¢Üñ÷tÇÚñ÷urì≤ÚÚRÊr‚CS9s#B(i"„R9r„33Ä¢6ˆÁ7Br“ÊWrDÖ$TR‰w&˜WÇì∞¢6ˆÁ7BvVÚ“ÊWrDÖ$TRÂ∆ÊTvVˆ÷WG'íá∆ÊUr¬∆ÊTÇì∞¢6ˆÁ7B÷B“ÊWrDÖ$TR‰÷W6Ñ&6ñ4÷FW&ñ¬á∞¢÷¢Fˆˆ≈FWáGW&W5∂óFV‘∂Wï“¿¢G&Á7&VÁC¢G'VR¿¢«ÜFW7C¢„Ç¿¢6ñFS¢DÖ$TR‰F˜V&∆U6ñFR¿¢“ì∞¢6ˆÁ7B∆ÊR“ÊWrDÖ$TR‰÷W6ÇÜvVÚ¬÷Bì∞¢ÚÚ«ññÊrf∆Bñ‚Ö¢¬”ì+WG2FÜR7&óFRw2F˜áFÜR'W6ñÊW72VÊBf˜ ¢ÚÚWfW'íÊ˜&÷¬Fˆˆ¬íf˜'v&BÊBóG2&˜GFˆ“áFÜRw&óVÊBí&6≤‡¢ÚÚ˜G2Êf∆ó&WfW'6W2FÜBg&ˆÁBˆ&6≤7∆óB(	BVÊBf˜"VÊB¬Ê˜B¢ÚÚ∆VgB◊&ñváB÷ó'&˜"(	B6ÚFÜRñ6≤◊6Ü˜fV¬w27ñ∂RÜWFÜ˜&VBBFÜP¢ÚÚ&˜GFˆ“ˆbFÜRÜÊF∆R¬÷VÁBFÚ&RFá'W7B&FÜW"FÜ‚7wVÊr∆ñ∂P¢ÚÚFÜR&∆FRíf6W2f˜'v&BñÁ7FVBvÜV‚'Vñ«Bf˜"FÜRñ6≤6∆˜B‡¢∆ÊRÁ&˜FFñˆ‚ÁÇ“˜G2Êf∆óÚ÷FÇÂíÚ"¢‘÷FÇÂíÚ#∞¢∆ÊRÁ&VÊFW$˜&FW"“ÑTƒEÙÙ$§T5Eı$T‰DU%Ùı$DU#∞¢rÊFBá∆ÊRì∞¢ÚÚ∂VWÜÊF∆Rˆ‚FÜR7&óFR∆ÊR6ÚWFFUFˆˆƒ÷W6Ç6‚∆ñW"FÜR7vVW7Gñ∆Rw0¢ÚÚ&∆FR◊&∆∆V¬Gvó7BÊBFÜR÷6R÷÷ˆFR'7ñÊÊñÊr"Gvó&¬ˆ‚F˜V6Çg&÷R¬FW&ófV@¢ÚÚg&ˆ“vÜñ6ÜWfW"Êñ“ó27GV∆«í∆ññÊr&FÜW"FÜ‚&∂VBñ‚W"÷óFV“ÜW&R(	B6VP¢ÚÚWFFUFˆˆƒ÷W6Çw2&6U&˜E¢f˜"váí‡¢rÁW6W$FFÁFˆˆ≈∆ÊR“∆ÊS∞¢&WGW&‚s∞¢–†¢ÚÚ'Vñ∆B˜&V'Vñ∆BFÜRFˆˆƒ÷W6Ñ÷g&ˆ“7W'&VÁF«íWVóVBóFV◊0¢6ˆÁ7BFˆˆƒ÷W6Ñ÷“∑”∞¢gVÊ7Fñˆ‚&V'Vñ∆EFˆˆƒ÷W6ÜW2Çí∞¢ÚÚ&V÷˜fRˆ∆B÷W6ÜW2g&ˆ“Üˆ∆FW ¢ˆ&¶V7BÁf«VW2áFˆˆƒ÷W6Ñ÷íÊf˜$V6ÇÜ“”‚≤ñbÜ“íFˆˆƒÜˆ∆FW"Á&V÷˜fRÜ“ì≤“ì∞¢f˜"Ü6ˆÁ7B6∆˜Bˆbˆ&¶V7BÊ∂Wó2áFˆˆƒ7FñˆÁ2íí∞¢6ˆÁ7BóFV‘∂Wí“WVó÷VÁE6∆˜G5∑6∆˜E“ÛÚÁV∆√∞¢ÚÚFÜRñ6≤6∆˜B«vó2Üˆ∆G2óG27&óFRf∆óVBá7ñ∂Rf˜'v&Bê¢ÚÚ&Vv&F∆W72ˆb7vñÊrÜ6R(	B7FFñ2ñF∆R◊˜6RFñffW&VÊ6R6Ú¢ÚÚñ6≤◊6Ü˜fV¬WVóVBñ‚&˜FÇFÜR6Ü˜fV¬ÊBñ6≤6∆˜G2BˆÊ6P¢ÚÚ7Fñ∆¬&VG22GvÚFó7FñÊ7BFˆˆ«2B&W7B¬Ê˜BßW7B÷ñB◊7vñÊr‡¢Fˆˆƒ÷W6Ñ÷∑6∆˜E““óFV‘∂WíÚ÷∂UFˆˆ≈∆ÊT÷W6ÇÜóFV‘∂Wí¬≤f∆ó¢6∆˜B””“wñ6≤r“í¢ÁV∆√∞¢–¢ÚÚ÷6ÜWFR∆ñ2(i"vVˆ‚÷W6Çf˜"∆Vv7í6ˆFRFá0¢ñbÇFˆˆƒ÷W6Ñ÷Ê÷6ÜWFRíFˆˆƒ÷W6Ñ÷Ê÷6ÜWFR“Fˆˆƒ÷W6Ñ÷ÁvVˆ„∞¢ÚÚ&R÷GF6Ç7FófRFˆˆ¿¢ñbáFˆˆƒ÷W6Ñ÷∂7FófUFˆˆ≈“íFˆˆƒÜˆ∆FW"ÊFBáFˆˆƒ÷W6Ñ÷∂7FófUFˆˆ≈“ì∞¢–†¢6ˆÁ7BFˆˆƒÜˆ∆FW"“ÊWrDÖ$TR‰w&˜WÇì∞¢66VÊRÊFBáFˆˆƒÜˆ∆FW"ì∞†¢ÚÚ)H)HÜV∆B&r÷óFV“∆ÊR)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢ÚÚvÜñ∆RÜV∆D÷ˆFR””“vóFV“rÜ‚ñÁfVÁF˜'íóFV“ó26V∆V7FVB(	BFÜR&6Ä¢ÚÚ6Ü˜w2óG2W6R7FñˆÁ2ñÁ7FVBˆbFˆˆ¬vÜVV¬í¬FÜRWVóV@¢ÚÚFˆˆ¬˜vVˆ‚÷W6Ç&˜fRó2ÜñFFV‚ÊBFÜó2∆ÊR6Ü˜w2ñÁ7FVC¢FÜP¢ÚÚ7FófR&róFV“w2ñ6ˆ‚ˆ‚6÷∆¬‰r◊7Gñ∆R∆ÊRÜV∆B∆óGF∆Rñ‡¢ÚÚg&ˆÁBˆbFÜR6ÜW7B¬6ñÊ6RFÜW6RfF'2ÜfRÊÚ&◊2FÚ7GV∆«ê¢ÚÚw&óÁóFÜñÊr‚&róFV◊2ˆÊ«í6''í‚V÷ˆ¶íñ6ˆÊÜÊÚ‰r7&óFP¢ÚÚ∆ñ∂RDÙÙ≈ÙïDT’ÙDTe2í¬6ÚFÜRñ6ˆ‚ó2&7FW&ó¶VBˆÁFÚ6Áf2ˆÊ6P¢ÚÚW"v«óÇÊB&WW6VB2FWáGW&R¬6÷RñFV2FÜRFˆˆ¬ˆfF"‰p¢ÚÚ∆ÊW2&˜fRßW7B'Vñ«Bg&ˆ“G&v‚v«óÇñÁ7FVBˆb∆ˆFVBfñ∆R‡¢6ˆÁ7BÑTƒEÙïDT’ıƒ‰UıtîEDÇ“„CS≤ÚÚ„SRˆbFÜRfF"w2„„ív˜&∆B◊VÊóB˜'G&óBvñGFÄ¢6ˆÁ7BÑTƒEÙïDT’Ùdı%t$EÙÙde4UB“„≤ÚÚV'FW"ˆbFÜR˜&ñvñÊ¬„B(	BßW7BVÊ˜VvÇ6∆V&Ê6Rg&ˆ“FÜR6ÜW7@¢ÚÚW"÷óFV“÷∂Wí˜fW'&ñFW2f˜"ÑTƒEÙïDT’ıƒ‰UıtîEDÇ(	B÷˜7Bñ6ˆÁ2&VBfñÊP¢ÚÚBFÜRFVfV«B6ó¶S≤FBVÁG&ñW2ÜW&Rf˜"˜WF∆ñW'2ÜRÊr‚FñÁíˆáVvRv«óá2í‡¢6ˆÁ7BïDT’ÙÑTƒEıƒ‰Uı44ƒR“∑”∞†¢6ˆÁ7BˆóFV‘ñ6ˆÂFWáGW&W2“∑”∞¢gVÊ7Fñˆ‚ˆvWDóFV‘ñ6ˆÂFWáGW&RÜñ6ˆ‚í∞¢ñbÖˆóFV‘ñ6ˆÂFWáGW&W5∂ñ6ˆÂ“í&WGW&‚ˆóFV‘ñ6ˆÂFWáGW&W5∂ñ6ˆÂ”∞¢6ˆÁ7B6ó¶R“#É∞¢6ˆÁ7B6Áf2“Fˆ7V÷VÁBÊ7&VFTV∆V÷VÁBÇv6Áf2rì∞¢6Áf2ÁvñGFÇ“6Áf2ÊÜVñváB“6ó¶S∞¢6ˆÁ7B7GÇ“6Áf2ÊvWD6ˆÁFWáBÇs&Brì∞¢7GÇÊfˆÁB“G¥÷FÇÁ&˜VÊBá6ó¶R¢„s"ó◊Ç$∆R6ˆ∆˜"V÷ˆ¶í"¬%6VvˆRTíV÷ˆ¶í"¬$Ê˜FÚ6ˆ∆˜"V÷ˆ¶í"«6Á2◊6W&ñf∞¢7GÇÁFWáD∆ñv‚“v6VÁFW"s∞¢7GÇÁFWáD&6V∆ñÊR“v÷ñFF∆Rs∞¢7GÇÊfñ∆≈FWáBÜñ6ˆ‚«¬~)Ÿ2r¬6ó¶RÚ"¬6ó¶R¢„Sbì∞¢6ˆÁ7BFWÇ“ÊWrDÖ$TR‰6Áf5FWáGW&RÜ6Áf2ì∞¢FWÇÊ÷tfñ«FW"“DÖ$TR‰∆ñÊV$fñ«FW#∞¢FWÇÊ÷ñ‰fñ«FW"“DÖ$TR‰∆ñÊV$fñ«FW#∞¢ˆóFV‘ñ6ˆÂFWáGW&W5∂ñ6ˆÂ““FWÉ∞¢&WGW&‚FWÉ∞¢–†¢gVÊ7Fñˆ‚÷∂TÜV∆DóFV’∆ÊT÷W6ÇÜóFV“í∞¢ñbÇóFV“í&WGW&‚ÁV∆√∞¢6ˆÁ7Br“ÑTƒEÙïDT’ıƒ‰UıtîEDÇ¢ÑïDT’ÙÑTƒEıƒ‰Uı44ƒU∂óFV“Ê∂Wï“ÛÚì∞¢6ˆÁ7BvVÚ“ÊWrDÖ$TRÂ∆ÊTvVˆ÷WG'íár¬rì∞¢6ˆÁ7B÷B“ÊWrDÖ$TR‰÷W6Ñ&6ñ4÷FW&ñ¬á∞¢÷¢ˆvWDóFV‘ñ6ˆÂFWáGW&RÜóFV“Êñ6ˆ‚í¿¢G&Á7&VÁC¢G'VR¿¢«ÜFW7C¢„R¿¢6ñFS¢DÖ$TR‰F˜V&∆U6ñFR¿¢“ì∞¢6ˆÁ7B∆ÊR“ÊWrDÖ$TR‰÷W6ÇÜvVÚ¬÷Bì∞¢∆ÊRÁ&VÊFW$˜&FW"“ÑTƒEÙÙ$§T5Eı$T‰DU%Ùı$DU#∞¢&WGW&‚∆ÊS∞¢–†¢ÚÚ6Üñ∆Bˆb∆ñW$÷W6ÇÜÊ˜B66VÊR¬VÊ∆ñ∂RFˆˆƒÜˆ∆FW"í(	BóBÜ2ÊÚ7vñÊp¢ÚÚÊñ÷Fñˆ‚¬6ÚóB6‚ßW7B&ñFR∆ˆÊrvóFÇFÜR∆ñW"w2˜6óFñˆ‚Ê@¢ÚÚf6ñÊrBfóÜVB∆ˆ6¬ˆfg6WBñÁ7FVBˆb&VñÊr&W˜6óFñˆÊVBñ‚v˜&∆@¢ÚÚ76RWfW'íg&÷R‡¢6ˆÁ7BÜV∆DóFV‘Üˆ∆FW"“ÊWrDÖ$TR‰w&˜WÇì∞¢ÜV∆DóFV‘Üˆ∆FW"Áfó6ñ&∆R“f«6S∞¢∆ñW$÷W6ÇÊFBÜÜV∆DóFV‘Üˆ∆FW"ì∞¢ˆ÷&µÊu∆ÊRÜÜV∆DóFV‘Üˆ∆FW"ì∞†¢∆WBˆÜV∆DóFV’∆ÊR“ÁV∆¬¬ˆÜV∆DóFV‘∂Wí“ÁV∆√∞¢gVÊ7Fñˆ‚WFFTÜV∆DóFV‘Üˆ∆FW"Çí∞¢6ˆÁ7BóFV““vWD7FófTñÁfVÁF˜'îóFV“Çì∞¢ñbÇóFV“í≤ÜV∆DóFV‘Üˆ∆FW"Áfó6ñ&∆R“f«6S≤&WGW&„≤–¢ñbÜóFV“Ê∂Wí”“ˆÜV∆DóFV‘∂Wíí∞¢ñbÖˆÜV∆DóFV’∆ÊRí∞¢ÜV∆DóFV‘Üˆ∆FW"Á&V÷˜fRÖˆÜV∆DóFV’∆ÊRì∞¢ˆÜV∆DóFV’∆ÊRÊvVˆ÷WG'íÊFó7˜6RÇì∞¢ˆÜV∆DóFV’∆ÊRÊ÷FW&ñ¬ÊFó7˜6RÇì∞¢–¢ˆÜV∆DóFV’∆ÊR“÷∂TÜV∆DóFV’∆ÊT÷W6ÇÜóFV“ì∞¢ˆÜV∆DóFV‘∂Wí“óFV“Ê∂Wì∞¢ñbÖˆÜV∆DóFV’∆ÊRíÜV∆DóFV‘Üˆ∆FW"ÊFBÖˆÜV∆DóFV’∆ÊRì∞¢–¢ÜV∆DóFV‘Üˆ∆FW"Á˜6óFñˆ‚Á6WBÉ¬∆ñW$óFV‘Üˆ∆Eí¬ÑTƒEÙïDT’Ùdı%t$EÙÙde4UBì∞¢ÜV∆DóFV‘Üˆ∆FW"Áfó6ñ&∆R“ˆÜV∆DóFV’∆ÊS∞¢–†¢ÚÚ&R÷∆∆ˆ6FVBˆ&¶V7G2FÚfˆñBW"÷g&÷Rt2ñ‚WFFUFˆˆƒ÷W6Ä¢6ˆÁ7B˜EW“ÊWrDÖ$TRÂfV7F˜#2É¬¬ì∞¢6ˆÁ7B˜ÑÜó2“ÊWrDÖ$TRÂfV7F˜#2É¬¬ì≤ÚÚFˆˆ¬÷∆ˆ6¬óF6ÇÜó2áFá'W7Bê¢6ˆÁ7B˜§Üó2“ÊWrDÖ$TRÂfV7F˜#2É¬¬ì≤ÚÚFˆˆ¬÷∆ˆ6¬&ˆ∆¬Üó2á˜6R÷G&ófV‚ˆÊ«íê¢6ˆÁ7B˜f2“ÊWrDÖ$TRÂVFW&Êñˆ‚Çì≤ÚÚf6ñÊrÇ≤&ˆGïñrí&˜FFñˆ‡¢6ˆÁ7B˜Êñ““ÊWrDÖ$TRÂVFW&Êñˆ‚Çì≤ÚÚÊñ÷Fñˆ‚&˜FFñˆ‡¢6ˆÁ7B˜Fˆˆ≈ñr“ÊWrDÖ$TRÂVFW&Êñˆ‚Çì≤ÚÚFˆˆ¬w2˜v‚∆ˆ6¬ñrGvó7BáFá'W7Bê¢6ˆÁ7B˜&ˆ∆¬“ÊWrDÖ$TRÂVFW&Êñˆ‚Çì≤ÚÚFˆˆ¬w2˜v‚∆ˆ6¬&ˆ∆¬Gvó7Bá˜6R÷G&ófV‚ˆÊ«íê¢6ˆÁ7B˜7tÜó2“ÊWrDÖ$TRÂfV7F˜#2Çì≤ÚÚ6Ü˜˜Fñ«BÜó2á∆ñW"&ñváBñ‚v˜&∆Bê†¢ÚÚ&W6ˆ«fRÊñ“7Gñ∆Rf˜"FÜR7FófRFˆˆ¬g&ˆ“WVóVBóFV“˜"f∆∆&6∞¢6ˆÁ7BˆÊñ’7Gñ∆Tf∆∆&6¥∆ˆvvVB“ÊWr6WBÇì∞¢gVÊ7Fñˆ‚7FófTÊñ’7Gñ∆RÇí∞¢6ˆÁ7BóFV‘∂Wí“WVó÷VÁE6∆˜G5∂7FófUFˆˆ≈“«¬WVó÷VÁE6∆˜G2ÁvVˆ„∞¢6ˆÁ7B7Gñ∆R“DÙÙ≈ÙïDT’ÙDTe5∂óFV‘∂Wï”ÚÊÊñ’7Gñ∆S∞¢ñbÇ7Gñ∆RbbˆÊñ’7Gñ∆Tf∆∆&6¥∆ˆvvVBÊÜ2ÜóFV‘∂Wííí∞¢ˆÊñ’7Gñ∆Tf∆∆&6¥∆ˆvvVBÊFBÜóFV‘∂Wíì∞¢vñÊF˜rÂıˆf&‘∆ˆsÚ‚Ü∂6ˆ÷&E“G∂óFV‘∂Wí«¬rÜÊÚóFV“íw”¢ÊÚÊñ’7Gñ∆RFVfñÊVB(i"f∆∆&6≤FÚwFá'W7Bv¬wv&‚rì∞¢–¢&WGW&‚7Gñ∆R«¬wFá'W7Bs∞¢–†¢ÚÚf˜W"◊Ü6RÊWWG&Œ(i'vñÊGW(i'7G&ñ∂^(i&Üˆ∆N(i&ÊWWG&¬ñÁFW'ˆ∆Fñˆ‚¬6Ü&VB'ê¢ÚÚWfW'í˜6R6ÜÊÊV¬Ü∆FW&¬ˆf˜'v&Bˆfg6WG2¬óF6Ç˜ñrˆ&ˆGïñrÊv∆W2í(	@¢ÚÚ÷ó'&˜'2FÜRGF6≤÷Êñ÷Fñˆ‚VFóF˜"w2˜6TBÇíˆ∆W'˜6RÇí6Úv÷RÊß2Ê@¢ÚÚFÜRVFóF˜"w2WFÜ˜&VB˜6R•4Ù‚FW67&ñ&RFÜRWÜ7B6÷R÷˜Fñˆ‚‚FÜP¢ÚÚÜˆ∆BÜ6Rá6n(i&ÜbíGvV∆«2WÜ7F«íBFÜR7G&ñ∂Rf«VR&Vf˜&RV6ñÊp¢ÚÚ&6≤FÚÊWWG&¬¬6Ú‚ñ◊7B&VG226∆V‚ÜóBñÁ7FVBˆ`¢ÚÚ6ÊñÊr7G&ñváBñÁFÚóG2&V6˜fW'í‡¢gVÊ7Fñˆ‚f˜W%Ü6T∆W'á&ˆw&W72¬vb¬6b¬Üb¬vñÊGWb¬7G&ñ∂Ub¬ÊWWG&≈b“í∞¢ñbá&ˆw&W72√“vbí&WGW&‚ÊWWG&≈b≤ávñÊGWb“ÊWWG&≈bí¢á&ˆw&W72Úvbì∞¢ñbá&ˆw&W72√“6bí&WGW&‚vñÊGWb≤á7G&ñ∂Ub“vñÊGWbí¢Çá&ˆw&W72“vbíÚá6b“vbíì∞¢ñbá&ˆw&W72√“Übí&WGW&‚7G&ñ∂Uc∞¢&WGW&‚7G&ñ∂Ub≤ÜÊWWG&≈b“7G&ñ∂Ubí¢Çá&ˆw&W72“ÜbíÚÉ„“Übíì∞¢–†¢ÚÚV6ÇFˆˆ¬7Gñ∆Rw2ÊGW&¬B◊&W7B˜6RÜFVw&VW2f˜"Êv∆R6ÜÊÊV«2í(	@¢ÚÚ◊W7B7Fíñ‚7ñÊ2vóFÇFÜRGF6≤÷Êñ÷Fñˆ‚VFóF˜"w25EîƒUÙ‰UUE$≈ıı4P¢ÚÚÜFˆ72˜Fˆˆ«2ˆGF6≤÷Êñ÷Fñˆ‚÷VFóF˜"ˆñÊFWÇÊáF÷¬í‚W6VB2FÜRf∆∆&6∞¢ÚÚÊWWG&¬f˜"FÜR˜6R÷G&ófV‚6ˆ÷&B'&Ê6Ç&V∆˜rvÜV‚7FWw2˜v‡¢ÚÚ˜6RÊÊWWG&¬FˆW6‚wB7V6ñgí6ÜÊÊV¬‡¢6ˆÁ7B5EîƒUÙ‰UUE$≈ıı4R“∞¢Fá'W7C¢≤É¢¬ì¢¬£¢¬óF6É¢„3¬ñs¢¬&ˆ∆√¢¬&ˆGïñs¢“¿¢7vVW¢≤É¢¬ì¢¬£¢„b¬óF6É¢¬ñs¢¬&ˆ∆√¢¬&ˆGïñs¢“¿¢6Ü˜¢≤É¢„2¬ì¢„3r¬£¢”„¬óF6É¢”SR¬ñs¢”sí¬&ˆ∆√¢”É"¬&ˆGïñs¢"“¿¢”∞†¢gVÊ7Fñˆ‚WFFUFˆˆƒ÷W6ÇÜGBí∞¢ÚÚvÜñ∆R&róFV“ó26V∆V7FVBÜÜV∆D÷ˆFR””“vóFV“r(	BFÜR&6Ç6Ü˜w0¢ÚÚóG2W6R7FñˆÁ2í¬6Ü˜rFÜRÜV∆B÷óFV“6ÜW7B∆ÊRñÁ7FVBˆ`¢ÚÚvÜFWfW"Fˆˆ¬˜vVˆ‚ó2WVóVC≤FÜRFˆˆ¬÷W6Ç6ˆ÷W2&6≤FÜP¢ÚÚ÷ˆ÷VÁBFÜR∆ñW"&WGW&Á2FÚFˆˆ¬÷ˆFR‡¢ñbÜÜV∆D÷ˆFR””“vóFV“rí∞¢FˆˆƒÜˆ∆FW"Áfó6ñ&∆R“f«6S∞¢WFFTÜV∆DóFV‘Üˆ∆FW"Çì∞¢&WGW&„∞¢–¢ÜV∆DóFV‘Üˆ∆FW"Áfó6ñ&∆R“f«6S∞¢ñbÇFˆˆƒ÷W6Ñ÷∂7FófUFˆˆ≈“í≤FˆˆƒÜˆ∆FW"Áfó6ñ&∆R“f«6S≤&WGW&„≤–¢FˆˆƒÜˆ∆FW"Áfó6ñ&∆R“G'VS∞†¢ÚÚW6R∆ˆvñ6¬f6ñÊrf˜"v÷R÷∆ˆvñ2fV7F˜'3≤7vVWvñ∆¬FFóFófV«í&˜FFRFÜR&ˆGí‡¢6ˆÁ7BÎÇ“∆ñW$f6ñÊs∞¢6ˆÁ7B&ñváEÇ“‘÷FÇÊ6˜2åÎÇí¬&ñváE¢“÷FÇÁ6ñ‚åÎÇì∞¢6ˆÁ7BgvEÇ“÷FÇÁ6ñ‚åÎÇí¬gvE¢“÷FÇÊ6˜2åÎÇì∞¢ÚÚG'VR∆ˆ6¬µÇ(i"v˜&∆BG&Á6f˜&“áFÜR6÷R7FÊF&BFá&VRÊß2í◊&˜FFñˆ‚FÜP¢ÚÚGF6≤÷Êñ÷Fñˆ‚VFóF˜"w2&ñr˜Fˆˆƒ&6RÜñW&&6áí∆ñW2í¬W6VB7V6ñfñ6∆«ê¢ÚÚf˜"∆6ñÊr∆ñW%Fˆˆƒ&6UÇáFÜRÜÊB÷GF6ÇˆñÁBíñ‚v˜&∆B76R(	B∂W@¢ÚÚFó7FñÊ7Bg&ˆ“&ñváEÇ˜&ñváE¢&˜fR¬vÜñ6Çó2&ñváEÇw2ÊVvFñˆ‚ÊB7Fó22÷ó0¢ÚÚ6ñÊ6RóB«6ÚfVVG2˜7tÜó2áFÜRF˜72˜&Vfñ∆¬7vñÊw2rFñ«BÜó2ì≤f∆óñÊró@¢ÚÚFÜW&Rv˜V∆B&WfW'6RFÜ˜6R«&VGí◊GVÊVB&ó6R˜6∆“Fó&V7FñˆÁ2‡¢6ˆÁ7BGF6Ö&ñváEÇ“÷FÇÊ6˜2åÎÇí¬GF6Ö&ñváE¢“‘÷FÇÁ6ñ‚åÎÇì∞†¢ÚÚ7vñÊr&ˆw&W72(i#˜fW"Fˆˆ≈7vñÊtGW"‚vÜñ∆R6ˆ÷&E7vñÊtÜV∆Bó26WB¿¢ÚÚFV6í7Fñ∆¬'VÁ2WFá&˜VvÇFÜRvñÊGWÜ6R¬FÜV‚g&VW¶W2ˆÊ6Ró@¢ÚÚ&V6ÜW2FÜRvñÊGW(i'7G&ñ∂R&˜VÊF'í(	BÜˆ∆FñÊrFÜRvñÊGW˜6Rf˜"0¢ÚÚ∆ˆÊr2FÜR&ñ∆óGí7Fó2ÜV∆B(	BVÁFñ¬&V∆V6UvVˆÂ7vñÊtÜˆ∆BÇê¢ÚÚ6∆V'2FÜRf∆rÊB∆WG2FÜR&V÷ñÊñÊr7G&ñ∂R˜&WGW&‚Fñ÷R∆í˜WB‡¢∆WB&ˆw&W72“∞¢ñbáFˆˆ≈7vñÊuB‚í∞¢ñbÜ6ˆ÷&E7vñÊtÜV∆Bí∞¢6ˆÁ7BÜˆ∆Df∆ˆ˜%B“Fˆˆ≈7vñÊtGW"¢É“6ˆ÷&E7vñÊuvñÊGWg&2ì∞¢Fˆˆ≈7vñÊuB“÷FÇÊ÷ÇÜÜˆ∆Df∆ˆ˜%B¬Fˆˆ≈7vñÊuB“GBì∞¢“V«6R∞¢Fˆˆ≈7vñÊuB“÷FÇÊ÷ÇÉ¬Fˆˆ≈7vñÊuB“GBì∞¢–¢&ˆw&W72““Fˆˆ≈7vñÊuBÚFˆˆ≈7vñÊtGW#∞¢–†¢ÚÚÜˆ∆B6ñ◊∆R&ó6VB˜V∆∆VB÷&6≤'&VGí"˜6RvÜñ∆RvóFñÊrˆ‚¢ÚÚfó6ÜñÊr&óFR(	BFV∆ñ&W&FV«í'ó76W2FÜRW"◊7Gñ∆R'&Ê6ÜW2&V∆˜p¢ÚÚñÁ7FVBˆbñÊÊñÊr&ˆw&W76BFÜVó"vñÊGWWáG&V÷S¢Fá'W7Bw0¢ÚÚvñÊGW6'&ñW2”C\+&ˆGïñrÊB7vVWw26'&ñW2◊V6Ç∆&vW ¢ÚÚˆÊRÜ&˜FÇ÷VÁB2'&ñVbG&Á6ñVÁB÷ñB◊7vñÊrí¬ÊBÜˆ∆FñÊp¢ÚÚVóFÜW"ˆbFÜ˜6RñÊFVfñÊóFV«ífó6ñ&«í&˜FFVBFÜRvÜˆ∆R6Ü&7FW ¢ÚÚvíg&ˆ“ÎÇáFÜRf6ñÊr6WB'íñ÷ñÊrBFÜRfó6ÜVBFñ∆RíñÁ7FV@¢ÚÚˆb∆VfñÊrFÜV“7V&VBWF˜v&BóB‚FÜó2˜6RˆÊ«íFñ«G2FÜP¢ÚÚFˆˆ¬óG6V∆b(	B∆ñW$÷W6ÇÁ&˜FFñˆ‚Áí7Fó2WÜ7F«íÎÇ‡¢ñbávñÊF˜r‰fó6ÜñÊsÚÁ&VGï˜6Rí∞¢∆ñW$÷W6ÇÁ&˜FFñˆ‚Áí“ÎÉ∞¢˜f2Á6WDg&ˆ‘Üó4Êv∆RÖ˜EW¬ÎÇì∞¢˜Êñ“Á6WDg&ˆ‘Üó4Êv∆RÖ˜ÑÜó2¬DÖ$TR‰÷FÖWFñ«2ÊFVuFı&BÉ„3íì∞¢FˆˆƒÜˆ∆FW"ÁVFW&Êñˆ‚Ê6˜íÖ˜f2íÊ◊V«Fó«íÖ˜Êñ“ì∞¢FˆˆƒÜˆ∆FW"Á˜6óFñˆ‚Á6WBÄ¢∆ñW$÷W6ÇÁ˜6óFñˆ‚ÁÇ≤&ñváEÇ¢∆ñW%Fˆˆƒ&6UÇ≤gvEÇ¢”„#"¿¢∆ñW$÷W6ÇÁ˜6óFñˆ‚Áí≤∆ñW%Fˆˆƒ&6Uí¿¢∆ñW$÷W6ÇÁ˜6óFñˆ‚Á¢≤&ñváE¢¢∆ñW%Fˆˆƒ&6UÇ≤gvE¢¢”„# ¢ì∞¢&WGW&„∞¢–†¢˜f2Á6WDg&ˆ‘Üó4Êv∆RÖ˜EW¬ÎÇì∞¢˜7tÜó2Á6WBá&ñváEÇ¬¬&ñváE¢ì∞†¢6ˆÁ7BÊñ““fó6ÖFá&˜t7FófRÚv6Ü˜r¢Ü6Ü&vTÊñ‘˜fW'&ñFR«¬6ˆ÷&E7vñÊtÊñ“«¬7FófTÊñ’7Gñ∆RÇíì∞¢ÚÚFˆˆ¬7FñˆÁ2∂VWFÜVó"˜&ñvñÊ¬fóÜVBbRÛ#ÇR7∆óC≤6ˆ÷&@¢ÚÚG&ñvvW'2W6RV6Ç&ñ∆óGíw2˜v‚vñÊGW2˜7G&ñ∂U2&FñÚá6WBfñ¢ÚÚG&ñvvW%vVˆÂ7vñÊufó7V¬w2˜G2í6ÚÜVfñ«í◊FV∆Vw&ÜVB7vñÊp¢ÚÚÜRÊr‚6∆VfRífó6ñ&«ívñÊG2W∆ˆÊvW"FÜ‚6Ê¶"‡¢6ˆÁ7Btb“6ˆ÷&E7vñÊtÊñ“Ú6ˆ÷&E7vñÊuvñÊGWg&2¢„c∞¢6ˆÁ7B4b“6ˆ÷&E7vñÊtÊñ“Ú6ˆ÷&E7vñÊu7G&ñ∂Tg&2¢„#É∞¢ÚÚÜˆ∆BFÜR7G&ñ∂R˜6R&Vf˜&RV6ñÊr&6≤FÚÊWWG&¬¬ñÁ7FVBˆ`¢ÚÚ6ÊñÊr7G&ñváBñÁFÚFÜR&WGW&‚∆W'‚vÜV‚‚&ñ∆óGíw26ˆÊfñp¢ÚÚ6WB‚Wá∆ñ6óBÜˆ∆E2Ü6ˆ÷&E7vñÊtÜˆ∆E2‚¬&∂VBñÁFÚFˆˆ≈7vñÊtGW ¢ÚÚ'íG&ñvvW%vVˆÂ7vñÊufó7V¬í¬W6RFÜB÷Áí&V¬6V6ˆÊG26ÚFÜP¢ÚÚW6Ró26ˆÁ6ó7FVÁB&Vv&F∆W72ˆbÜ˜r'&ñVbóG2vñÊGW˜7G&ñ∂P¢ÚÚFñ÷ñÊró3≤˜FÜW'vó6Rf∆¬&6≤FÚFÜRˆ∆B&˜˜'FñˆÊ¬◊FÚ–¢ÚÚvÜBw2÷∆VgBf˜&◊V∆ÜFñrˆfñ∆¬˜&Vfñ∆¬¬ÊBÁí6ˆ÷&B7vñÊrFÜ@¢ÚÚFñF‚wB6WBÜˆ∆E2í‡¢6ˆÁ7BÑb“Ü6ˆ÷&E7vñÊtÊñ“bb6ˆ÷&E7vñÊtÜˆ∆E2‚ê¢Ú÷FÇÊ÷ñ‚É„ìí¬4b≤6ˆ÷&E7vñÊtÜˆ∆E2ÚFˆˆ≈7vñÊtGW"ê¢¢÷FÇÊ÷ñ‚É„ìí¬4b≤É“4bí¢„2ì∞†¢ÚÚñ‚FÜR7vñÊrBóG2vñÊGWWáG&V÷RvÜñ∆RvóFñÊrˆ‚&óFR(	@¢ÚÚf˜W%Ü6T∆W'á&ˆw&W73””◊vb¬vb¬‚‚‚í«vó2&W6ˆ«fW2FÚWÜ7F«ê¢ÚÚvñÊGWb&Vv&F∆W72ˆb7Gñ∆R¬6ÚFÜó2Üˆ∆G2ÁíWVóVBÜ'ˆˆ‚w0¢ÚÚ&VGí˜6RvóFÜ˜WBÊVVFñÊr7Gñ∆R◊7V6ñfñ2˜6R6ˆ◊WFFñˆ‚ÜW&R‡¢ñbávñÊF˜r‰fó6ÜñÊsÚÁ&VGï˜6Rí&ˆw&W72“tc∞†¢ñbÜ6ˆ÷&E7vñÊtÊñ“bb6ˆ÷&E7vñÊu˜6Rí∞¢ÚÚı4R‘E$ïdT‚4Ù‘$B5tî‰r(	B∆ñW2gV∆¬r÷6ÜÊÊV¬˜6RWFÜ˜&V@¢ÚÚñ‚FÜRGF6≤÷Êñ÷Fñˆ‚VFóF˜"vVÊW&ñ6∆«í¬f˜"Áí7Gñ∆R¬FÜP¢ÚÚ6÷RvíFá'W7Bw2'&Ê6Ç&V∆˜r«&VGíFˆW2'íÜÊC¢Ç˜¢&P¢ÚÚÜÊB◊&V∆FófR∆FW&¬ˆf˜'v&Bˆfg6WG2¬íó2fW'Fñ6¬¬óF6Ç˜ñr˜&ˆ∆¿¢ÚÚ&RFÜRFˆˆ¬w2˜v‚∆ˆ6¬Fñ«B˜Gvó7B˜&ˆ∆¬¬ÊB&ˆGïñr∆ˆÊR&˜FFW0¢ÚÚFÜRvÜˆ∆R6Ü&7FW"Ü÷F6ÜñÊrFÜRVFóF˜"w2«ï˜6UFı&ñrÇíí‡¢ÚÚFó%6ñv‚÷ó'&˜'2Ç˜ñr˜&ˆ∆¬ˆ&ˆGïñr(	BWÜ7F«íFÜRVFóF˜"w2f∆ó˜6RÇê¢ÚÚ6ˆÁfVÁFñˆ‚(	B6Ú6ˆ÷&Ú7FW6‚&WW6RÊ˜FÜW"7FWw2˜6P¢ÚÚV‚÷÷ó'&˜&VB˜"÷ó'&˜&VB‚˜vW"66∆W2WfW'í6ÜÊÊV¬w2FWfñFñˆ‡¢ÚÚg&ˆ“óG2˜v‚ÊWWG&¬¬f˜"ÜVfñW"◊FV∆Vw&ÜVBfñÊó6ÜW"¿¢ÚÚvóFÜ˜WBÊVVFñÊrFVFñ6FVB&W7ˆ∂Rf˜&◊V∆W"7Gñ∆R‡¢6ˆÁ7B˜6R“6ˆ÷&E7vñÊu˜6S∞¢6ˆÁ7B7Gñ∆TÊWWG&¬“5EîƒUÙ‰UUE$≈ıı4U∂Êñ’“«¬5EîƒUÙ‰UUE$≈ıı4RÁFá'W7C∞¢6ˆÁ7BÊWWG&¬“≤‚‚Á7Gñ∆TÊWWG&¬¬‚‚‚á˜6RÊÊWWG&¬«¬∑“í”∞¢6ˆÁ7B6ñv‚“6ˆ÷&E7vñÊu6ñv„∞¢6ˆÁ7B˜vW"“6ˆ÷&E7vñÊu˜vW#∞¢6ˆÁ7B66∆R“Ü6Ç¬bí”‚ÊWWG&≈∂6Ö“≤ÇábÛÚÊWWG&≈∂6Ö“í“ÊWWG&≈∂6Ö“í¢˜vW#∞¢6ˆÁ7B6Ü‚“Ü6Ç¬÷ó'&˜"“f«6Rí”‚∞¢6ˆÁ7Br“66∆RÜ6Ç¬˜6RÁvñÊGWÚÂ∂6Ö“í¢Ü÷ó'&˜"Ú6ñv‚¢ì∞¢6ˆÁ7B2“66∆RÜ6Ç¬˜6RÁ7G&ñ∂SÚÂ∂6Ö“í¢Ü÷ó'&˜"Ú6ñv‚¢ì∞¢6ˆÁ7B‚“ÊWWG&≈∂6Ö“¢Ü÷ó'&˜"Ú6ñv‚¢ì∞¢&WGW&‚f˜W%Ü6T∆W'á&ˆw&W72¬tb¬4b¬Ñb¬r¬2¬‚ì∞¢”∞†¢6ˆÁ7BÇ“6Ü‚ÇwÇr¬G'VRì∞¢6ˆÁ7Bí“6Ü‚Çwírì∞¢6ˆÁ7B¢“6Ü‚Çw¢rì∞¢6ˆÁ7BóF6Ö&B“DÖ$TR‰÷FÖWFñ«2ÊFVuFı&BÜ6Ü‚ÇwóF6Çríì∞¢6ˆÁ7Bñu&B“DÖ$TR‰÷FÖWFñ«2ÊFVuFı&BÜ6Ü‚Çwñrr¬G'VRíì∞¢6ˆÁ7B&ˆ∆≈&B“DÖ$TR‰÷FÖWFñ«2ÊFVuFı&BÜ6Ü‚Çw&ˆ∆¬r¬G'VRíì∞¢6ˆÁ7B&ˆGïñu&B“DÖ$TR‰÷FÖWFñ«2ÊFVuFı&BÜ6Ü‚Çv&ˆGïñrr¬G'VRíì∞†¢6ˆÁ7BlÎÇ“ÎÇ≤&ˆGïñu&C∞¢6ˆÁ7Be%Ç“÷FÇÊ6˜2álÎÇí¬e%¢“‘÷FÇÁ6ñ‚álÎÇì∞¢6ˆÁ7BdeÇ“÷FÇÁ6ñ‚álÎÇí¬de¢“÷FÇÊ6˜2álÎÇì∞†¢∆ñW$÷W6ÇÁ&˜FFñˆ‚Áí“lÎÉ∞¢˜f2Á6WDg&ˆ‘Üó4Êv∆RÖ˜EW¬lÎÇì∞¢˜Fˆˆ≈ñrÁ6WDg&ˆ‘Üó4Êv∆RÖ˜EW¬ñu&Bì∞¢˜Êñ“Á6WDg&ˆ‘Üó4Êv∆RÖ˜ÑÜó2¬óF6Ö&Bì∞¢˜&ˆ∆¬Á6WDg&ˆ‘Üó4Êv∆RÖ˜§Üó2¬&ˆ∆≈&Bì∞¢FˆˆƒÜˆ∆FW"ÁVFW&Êñˆ‚Ê6˜íÖ˜f2íÊ◊V«Fó«íÖ˜Fˆˆ≈ñríÊ◊V«Fó«íÖ˜Êñ“íÊ◊V«Fó«íÖ˜&ˆ∆¬ì∞¢FˆˆƒÜˆ∆FW"Á˜6óFñˆ‚Á6WBÄ¢∆ñW$÷W6ÇÁ˜6óFñˆ‚ÁÇ≤e%Ç¢á∆ñW%Fˆˆƒ&6UÇ≤Çí≤deÇ¢¢¿¢∆ñW$÷W6ÇÁ˜6óFñˆ‚Áí≤∆ñW%Fˆˆƒ&6Uí≤í¿¢∆ñW$÷W6ÇÁ˜6óFñˆ‚Á¢≤e%¢¢á∆ñW%Fˆˆƒ&6UÇ≤Çí≤de¢¢†¢ì∞†¢“V«6RñbÜÊñ“””“wFá'W7Brí∞¢ÚÚDÖ%U5B(	BÊˆ‚÷˜fW&WáFVÊFñÊr¶"WFÜ˜&VB2gV∆¬˜6RÜ∆FW&¿¢ÚÚˆfg6WB¬f˜'v&B¶"¬óF6Ç¬Fˆˆ¬ñr¬ÊBvÜˆ∆R÷&ˆGí&ˆGïñp¢ÚÚvñÊB◊Wˆfˆ∆∆˜r◊Fá&˜VvÇí¬÷F6ÜñÊrFÜRGF6≤÷Êñ÷Fñˆ‚VFóF˜"w0¢ÚÚ˜6R66ÜV÷WÜ7F«ì¢Ç˜¢˜óF6Ç˜ñr&RÜÊB◊&V∆FófRá&V∆FófRF¢ÚÚFˆˆƒ&6Rí¬&ˆGïñr∆ˆÊR&˜FFW2FÜRvÜˆ∆R6Ü&7FW"‚6ˆ÷&B¶'0¢ÚÚV∆¬&6≤f'FÜW"FÜ‚Ê˜&÷¬Fˆˆ¬¶"Ç”„Cg2”„#"í6ÚFÜP¢ÚÚvñÊGWóG6V∆b&VG226∆V"&&˜WBFÚ7F""FV∆√≤FÜR7G&ñ∂P¢ÚÚ7Fñ∆¬'&ófW2BFÜR6÷R≥„3"WáFVÁ6ñˆ‚VóFÜW"ví‡¢ÚÚ˜vW"66∆W2&V6Ç˜GW&‚f˜"‚WáG&◊FV∆Vw&ÜVBfñÊó6ÜW"ÜRÊr‚¢ÚÚ6ˆ÷&Úw2fñÊ¬«VÊvRívóFÜ˜WBÊVVFñÊróG2˜v‚&W7ˆ∂RÊñ“'&Ê6Ç‡¢6ˆÁ7B˜vW"“6ˆ÷&E7vñÊtÊñ“Ú6ˆ÷&E7vñÊu˜vW"¢∞¢6ˆÁ7BvñÊGW&6≤“Ü6ˆ÷&E7vñÊtÊñ“Ú”„C¢”„#"í¢˜vW#∞¢6ˆÁ7B¶$ˆfb“f˜W%Ü6T∆W'á&ˆw&W72¬tb¬4b¬Ñb¬vñÊGW&6≤¬„3"¢˜vW"ì∞¢6ˆÁ7B∆FW&¬“f˜W%Ü6T∆W'á&ˆw&W72¬tb¬4b¬Ñb¬¬”„#2¢˜vW"ì∞¢ÚÚóF6Çw2ÊWWG&¬÷F6ÜW2óG2˜v‚vñÊGWf«VRÉ„3+í&FÜW"FÜ‡¢ÚÚFÜR˜FÜW"6ÜÊÊV«2rñ◊∆ñ6óB(	BFá'W7BvVˆ‚&W7G2BFÜó0¢ÚÚÜV∆B◊WFñ«B¬G&˜2FÚÊV"÷f∆B+BFÜR7G&ñ∂R¬FÜV‚V6W0¢ÚÚ&6≤FÚFÜR&W7FñÊrFñ«BñÁ7FVBˆb6ÊñÊrf∆B‡¢6ˆÁ7BóF6Ö&B“f˜W%Ü6T∆W'á&ˆw&W72¬tb¬4b¬Ñb¬DÖ$TR‰÷FÖWFñ«2ÊFVuFı&BÉ„3í¬DÖ$TR‰÷FÖWFñ«2ÊFVuFı&BÉí¬DÖ$TR‰÷FÖWFñ«2ÊFVuFı&BÉ„3íì∞¢6ˆÁ7Bñu&B“f˜W%Ü6T∆W'á&ˆw&W72¬tb¬4b¬Ñb¬¬DÖ$TR‰÷FÖWFñ«2ÊFVuFı&BÇ”CRí¢˜vW"ì∞¢6ˆÁ7B&ˆGïñu&B“f˜W%Ü6T∆W'á&ˆw&W72¬tb¬4b¬Ñb¬DÖ$TR‰÷FÖWFñ«2ÊFVuFı&BÇ”CRí¢˜vW"¬DÖ$TR‰÷FÖWFñ«2ÊFVuFı&BÉCbí¢˜vW"ì∞†¢6ˆÁ7BlÎÇ“ÎÇ≤&ˆGïñu&C∞¢6ˆÁ7Be%Ç“÷FÇÊ6˜2álÎÇí¬e%¢“‘÷FÇÁ6ñ‚álÎÇì∞¢6ˆÁ7BdeÇ“÷FÇÁ6ñ‚álÎÇí¬de¢“÷FÇÊ6˜2álÎÇì∞†¢∆ñW$÷W6ÇÁ&˜FFñˆ‚Áí“lÎÉ∞¢˜f2Á6WDg&ˆ‘Üó4Êv∆RÖ˜EW¬lÎÇì∞¢˜Fˆˆ≈ñrÁ6WDg&ˆ‘Üó4Êv∆RÖ˜EW¬ñu&Bì∞¢˜Êñ“Á6WDg&ˆ‘Üó4Êv∆RÖ˜ÑÜó2¬óF6Ö&Bì∞¢FˆˆƒÜˆ∆FW"ÁVFW&Êñˆ‚Ê6˜íÖ˜f2íÊ◊V«Fó«íÖ˜Fˆˆ≈ñríÊ◊V«Fó«íÖ˜Êñ“ì∞¢FˆˆƒÜˆ∆FW"Á˜6óFñˆ‚Á6WBÄ¢∆ñW$÷W6ÇÁ˜6óFñˆ‚ÁÇ≤e%Ç¢á∆ñW%Fˆˆƒ&6UÇ≤∆FW&¬í≤deÇ¢¶$ˆfb¿¢∆ñW$÷W6ÇÁ˜6óFñˆ‚Áí≤∆ñW%Fˆˆƒ&6Uí¿¢∆ñW$÷W6ÇÁ˜6óFñˆ‚Á¢≤e%¢¢á∆ñW%Fˆˆƒ&6UÇ≤∆FW&¬í≤de¢¢¶$ˆf`¢ì∞†¢“V«6RñbÜÊñ“””“v6Ü˜rí∞¢ÚÚ4Ñı(	BgV∆¬˜6R÷G&ófV‚7vñÊrá&ó6R(i"6∆“(i"&WGW&‚í¬WFÜ˜&V@¢ÚÚñ‚FÜRGF6≤÷Êñ÷Fñˆ‚VFóF˜"ÊB&∂VBñ‚ÜW&RWÜ7F«íFÜRvê¢ÚÚFá'W7Bw2'&Ê6Ç&˜fRFˆW3¢Ç˜í˜¢˜óF6Ç˜ñr˜&ˆ∆¬&RÜÊB◊&V∆FófP¢ÚÚá&V∆FófRFÚFˆˆƒ&6Rí¬&ˆGïñr∆ˆÊR&˜FFW2FÜRvÜˆ∆R6Ü&7FW"‡¢ÚÚ&ˆ∆¬ó2vÜB÷∂W2FÜó2&VB2&˜W"6Ü˜ÜÜVBGW&ÊVBñÁF¢ÚÚFÜR7vñÊr∆ÊRíñÁ7FVBˆbFÜRˆ∆B6ñÊv∆R÷Üó2&ó6R˜6∆“‡¢ÚÚ˜vW"66∆W2WfW'í6ÜÊÊV¬w2FWfñFñˆ‚g&ˆ“óG2˜v‚ÊWWG&¬¬ßW7@¢ÚÚ∆ñ∂RFá'W7B¬6Ú6Ü&vVB'&V∂W"w2ÜVfñW"˜fW&ÜVBávÜñ6Ç«6¢ÚÚ∆ó2FÜó2'&Ê6Ç(	B6VR6ˆ÷&B÷6Ü&vVB÷'&V∂W"Êß2íFˆW6‚wBÊVV@¢ÚÚóG2˜v‚&W7ˆ∂Rf˜&◊V∆‡¢6ˆÁ7B˜vW"“6ˆ÷&E7vñÊtÊñ“Ú6ˆ÷&E7vñÊu˜vW"¢∞¢6ˆÁ7BÊWWG&¬“≤É¢„2¬ì¢„3r¬£¢”„¬óF6É¢”SR¬ñs¢”sí¬&ˆGïñs¢"¬&ˆ∆√¢”É"”∞¢6ˆÁ7BvñÊGW“≤É¢”„Ç¬ì¢„C¬£¢”„R¬óF6É¢”cR¬ñs¢2¬&ˆGïñs¢”#í¬&ˆ∆√¢”"”∞¢6ˆÁ7B7G&ñ∂R“≤É¢¬ì¢¬£¢„"¬óF6É¢2¬ñs¢”#Ç¬&ˆGïñs¢#í¬&ˆ∆√¢”ì”∞¢6ˆÁ7B66∆R“Ü6Ç¬bí”‚ÊWWG&≈∂6Ö“≤áb“ÊWWG&≈∂6Ö“í¢˜vW#∞¢6ˆÁ7B6Ü‰∆W'“6Ç”‚f˜W%Ü6T∆W'á&ˆw&W72¬tb¬4b¬Ñb¬66∆RÜ6Ç¬vñÊGW∂6Ö“í¬66∆RÜ6Ç¬7G&ñ∂U∂6Ö“í¬ÊWWG&≈∂6Ö“ì∞†¢6ˆÁ7BÇ“6Ü‰∆W'ÇwÇrì∞¢6ˆÁ7Bí“6Ü‰∆W'Çwírì∞¢6ˆÁ7B¢“6Ü‰∆W'Çw¢rì∞¢6ˆÁ7BóF6Ö&B“DÖ$TR‰÷FÖWFñ«2ÊFVuFı&BÜ6Ü‰∆W'ÇwóF6Çríì∞¢6ˆÁ7Bñu&B“DÖ$TR‰÷FÖWFñ«2ÊFVuFı&BÜ6Ü‰∆W'Çwñrríì∞¢6ˆÁ7B&ˆ∆≈&B“DÖ$TR‰÷FÖWFñ«2ÊFVuFı&BÜ6Ü‰∆W'Çw&ˆ∆¬ríì∞¢6ˆÁ7B&ˆGïñu&B“DÖ$TR‰÷FÖWFñ«2ÊFVuFı&BÜ6Ü‰∆W'Çv&ˆGïñrríì∞†¢6ˆÁ7BlÎÇ“ÎÇ≤&ˆGïñu&C∞¢6ˆÁ7Be%Ç“÷FÇÊ6˜2álÎÇí¬e%¢“‘÷FÇÁ6ñ‚álÎÇì∞¢6ˆÁ7BdeÇ“÷FÇÁ6ñ‚álÎÇí¬de¢“÷FÇÊ6˜2álÎÇì∞†¢∆ñW$÷W6ÇÁ&˜FFñˆ‚Áí“lÎÉ∞¢˜f2Á6WDg&ˆ‘Üó4Êv∆RÖ˜EW¬lÎÇì∞¢˜Fˆˆ≈ñrÁ6WDg&ˆ‘Üó4Êv∆RÖ˜EW¬ñu&Bì∞¢˜Êñ“Á6WDg&ˆ‘Üó4Êv∆RÖ˜ÑÜó2¬óF6Ö&Bì∞¢˜&ˆ∆¬Á6WDg&ˆ‘Üó4Êv∆RÖ˜§Üó2¬&ˆ∆≈&Bì∞¢FˆˆƒÜˆ∆FW"ÁVFW&Êñˆ‚Ê6˜íÖ˜f2íÊ◊V«Fó«íÖ˜Fˆˆ≈ñríÊ◊V«Fó«íÖ˜Êñ“íÊ◊V«Fó«íÖ˜&ˆ∆¬ì∞†¢6ˆÁ7BÜÊEÇ“∆ñW$÷W6ÇÁ˜6óFñˆ‚ÁÇ≤e%Ç¢á∆ñW%Fˆˆƒ&6UÇ≤Çí≤deÇ¢£∞¢6ˆÁ7BÜÊEí“∆ñW$÷W6ÇÁ˜6óFñˆ‚Áí≤∆ñW%Fˆˆƒ&6Uí≤ì∞¢6ˆÁ7BÜÊE¢“∆ñW$÷W6ÇÁ˜6óFñˆ‚Á¢≤e%¢¢á∆ñW%Fˆˆƒ&6UÇ≤Çí≤de¢¢£∞¢ñbÜfó6ÖFá&˜t7FófRbbvñÊF˜r‰fó6ÜñÊsÚÁ7FFSÚÊÊ6Ü˜%v˜&∆Bí∞¢ÚÚ˜WBGW&ñÊrFÜR6∆“Ötn(i%4bí¬ÜV∆BBFÜRÊ6Ü˜"Fá&˜VvÇFÜP¢ÚÚÜˆ∆BÖ4n(i$Ñbí¬&6≤GW&ñÊrFÜR&WGW&‚ÑÑn(i#í‡¢∆WBG&fV√∞¢ñbá&ˆw&W72√“tbíG&fV¬“∞¢V«6Rñbá&ˆw&W72√“4bíG&fV¬“á&ˆw&W72“tbíÚÖ4b“tbì∞¢V«6Rñbá&ˆw&W72√“ÑbíG&fV¬“∞¢V«6RG&fV¬““á&ˆw&W72“ÑbíÚÉ„“Ñbì∞¢6ˆÁ7Br“vñÊF˜r‰fó6ÜñÊrÁ7FFRÊÊ6Ü˜%v˜&∆C∞¢FˆˆƒÜˆ∆FW"Á˜6óFñˆ‚Á6WBÄ¢ÜÊEÇ≤ÜrÁÇ“ÜÊEÇí¢G&fV¬¿¢ÜÊEí≤ÜrÁí“ÜÊEíí¢G&fV¬¿¢ÜÊE¢≤ÜrÁ¢“ÜÊE¢í¢G&fV¿¢ì∞¢“V«6R∞¢FˆˆƒÜˆ∆FW"Á˜6óFñˆ‚Á6WBÜÜÊEÇ¬ÜÊEí¬ÜÊE¢ì∞¢–†¢“V«6RñbÜÊñ“””“wF˜72rí∞¢ÚÚDı52(	B&WfW'6RÜˆS¢∆ñgBFÜR∆ˆBˆ‚FÜRvñÊGW¬FÜV‚ÜVfRóBW ¢ÚÚÊB&6≤˜fW"FÜR6Ü˜V∆FW"ˆ‚FÜR7G&ñ∂RFÚFá&˜rFó'B˜WB&VÜñÊBñ˜R‡¢∆WBF˜74Êv∆S∞¢ñbá&ˆw&W72√“tbí∞¢F˜74Êv∆R“”„S≤„Ç¢á&ˆw&W72Útbì≤ÚÚ∆ñgBg&ˆ“∆˜r66ˆ˜¢(â#„S(i"(â#„3 ¢“V«6Rñbá&ˆw&W72√“4bí∞¢F˜74Êv∆R“”„3"“"„cÇ¢Çá&ˆw&W72“tbíÚÖ4b“tbíì≤ÚÚÜVfRWb˜fW"FÜR6Ü˜V∆FW#¢(â#„3"(i"(â#2„ ¢“V«6R∞¢F˜74Êv∆R“”2„≤„S¢Çá&ˆw&W72“4bíÚÉ„“4bíì≤ÚÚ6WGF∆R&6≤FÚFÜR∆˜r66ˆ˜¢(â#2„(i"(â#„S ¢–¢˜Êñ“Á6WDg&ˆ‘Üó4Êv∆RÖ˜7tÜó2¬F˜74Êv∆Rì∞¢FˆˆƒÜˆ∆FW"ÁVFW&Êñˆ‚Ê◊V«Fó«ïVFW&ÊñˆÁ2Ö˜Êñ“¬˜f2ì∞¢FˆˆƒÜˆ∆FW"Á˜6óFñˆ‚Á6WBÄ¢∆ñW$÷W6ÇÁ˜6óFñˆ‚ÁÇ≤GF6Ö&ñváEÇ¢∆ñW%Fˆˆƒ&6UÇ¿¢∆ñW$÷W6ÇÁ˜6óFñˆ‚Áí≤∆ñW%Fˆˆƒ&6Uí¿¢∆ñW$÷W6ÇÁ˜6óFñˆ‚Á¢≤GF6Ö&ñváE¢¢∆ñW%Fˆˆƒ&6UÄ¢ì∞†¢“V«6RñbÜÊñ“””“w&Vfñ∆≈GW&‰˜WBrí∞¢ÚÚ$Tdîƒ¬3(	Bóf˜BWFÚC\+F˜v&BFÜR6÷W&vÜñ∆R7vñÊvñÊrFÜP¢ÚÚ&6ñ26Ü˜fV¬Fá'W7BáFÜR6÷RvñÊGW(i&¶.(i'&WGW&‚2wFá'W7Brí‡¢6ˆÁ7B6ñv‚“6Ü&vT7Fñˆ„ÚÁ&Vfñ∆≈GW&Â6ñv‚«¬∞¢6ˆÁ7B&˜DÊv∆R“&ˆw&W72√“t`¢Ú$Tdîƒ≈ıEU$ÂÙ‰tƒR¢6ñv‚¢á&ˆw&W72Útbê¢¢$Tdîƒ≈ıEU$ÂÙ‰tƒR¢6ñv„∞¢∆WB¶$ˆfc∞¢ñbá&ˆw&W72√“tbí¶$ˆfb“”„#"¢á&ˆw&W72Útbì∞¢V«6Rñbá&ˆw&W72√“4bí¶$ˆfb“”„#"≤„SB¢Çá&ˆw&W72“tbíÚÖ4b“tbíì∞¢V«6R¶$ˆfb“„3"¢É„“á&ˆw&W72“4bíÚÉ„“4bíì∞¢6ˆÁ7BlÎÇ“ÎÇ≤&˜DÊv∆S∞¢6ˆÁ7Be%Ç“÷FÇÊ6˜2álÎÇí¬e%¢“‘÷FÇÁ6ñ‚álÎÇì∞¢6ˆÁ7BdeÇ“÷FÇÁ6ñ‚álÎÇí¬de¢“÷FÇÊ6˜2álÎÇì∞¢∆ñW$÷W6ÇÁ&˜FFñˆ‚Áí“lÎÉ∞¢˜f2Á6WDg&ˆ‘Üó4Êv∆RÖ˜EW¬lÎÇì∞¢˜Êñ“Á6WDg&ˆ‘Üó4Êv∆RÖ˜7tÜó2¬„Çì∞¢FˆˆƒÜˆ∆FW"ÁVFW&Êñˆ‚Ê◊V«Fó«ïVFW&ÊñˆÁ2Ö˜Êñ“¬˜f2ì∞¢FˆˆƒÜˆ∆FW"Á˜6óFñˆ‚Á6WBÄ¢∆ñW$÷W6ÇÁ˜6óFñˆ‚ÁÇ≤e%Ç¢∆ñW%Fˆˆƒ&6UÇ≤deÇ¢¶$ˆfb¿¢∆ñW$÷W6ÇÁ˜6óFñˆ‚Áí≤∆ñW%Fˆˆƒ&6Uí¿¢∆ñW$÷W6ÇÁ˜6óFñˆ‚Á¢≤e%¢¢∆ñW%Fˆˆƒ&6UÇ≤de¢¢¶$ˆf`¢ì∞†¢“V«6RñbÜÊñ“””“w&Vfñ∆≈7G&ñ∂T&6≤rí∞¢ÚÚ$Tdîƒ¬3"(	Bóf˜B&6≤FÚf6RFÜRG&VÊ6Ç¬FÜV‚7G&ñ∂RvóFÇÊ¢ÚÚ&V6ˆñ√¢FÜR¶"Üˆ∆G2BgV∆¬WáFVÁ6ñˆ‚ñÁ7FVBˆb&WGW&ÊñÊr‡¢6ˆÁ7B6ñv‚“6Ü&vT7Fñˆ„ÚÁ&Vfñ∆≈GW&Â6ñv‚«¬∞¢∆WB&˜DÊv∆R¬¶$ˆfc∞¢ñbá&ˆw&W72√“tbí∞¢&˜DÊv∆R“$Tdîƒ≈ıEU$ÂÙ‰tƒR¢6ñv‚¢É“&ˆw&W72Útbì∞¢¶$ˆfb“”„#"¢á&ˆw&W72Útbì∞¢“V«6Rñbá&ˆw&W72√“4bí∞¢&˜DÊv∆R“∞¢¶$ˆfb“”„#"≤„SB¢Çá&ˆw&W72“tbíÚÖ4b“tbíì∞¢“V«6R∞¢&˜DÊv∆R“∞¢¶$ˆfb“„3#∞¢–¢6ˆÁ7BlÎÇ“ÎÇ≤&˜DÊv∆S∞¢6ˆÁ7Be%Ç“÷FÇÊ6˜2álÎÇí¬e%¢“‘÷FÇÁ6ñ‚álÎÇì∞¢6ˆÁ7BdeÇ“÷FÇÁ6ñ‚álÎÇí¬de¢“÷FÇÊ6˜2álÎÇì∞¢∆ñW$÷W6ÇÁ&˜FFñˆ‚Áí“lÎÉ∞¢˜f2Á6WDg&ˆ‘Üó4Êv∆RÖ˜EW¬lÎÇì∞¢˜Êñ“Á6WDg&ˆ‘Üó4Êv∆RÖ˜7tÜó2¬„Çì∞¢FˆˆƒÜˆ∆FW"ÁVFW&Êñˆ‚Ê◊V«Fó«ïVFW&ÊñˆÁ2Ö˜Êñ“¬˜f2ì∞¢FˆˆƒÜˆ∆FW"Á˜6óFñˆ‚Á6WBÄ¢∆ñW$÷W6ÇÁ˜6óFñˆ‚ÁÇ≤e%Ç¢∆ñW%Fˆˆƒ&6UÇ≤deÇ¢¶$ˆfb¿¢∆ñW$÷W6ÇÁ˜6óFñˆ‚Áí≤∆ñW%Fˆˆƒ&6Uí¿¢∆ñW$÷W6ÇÁ˜6óFñˆ‚Á¢≤e%¢¢∆ñW%Fˆˆƒ&6UÇ≤de¢¢¶$ˆf`¢ì∞†¢“V«6RñbÜÊñ“””“w&Vfñ∆≈Gvó7D˜WBr«¬Êñ“””“w&Vfñ∆≈Gvó7D&6≤rí∞¢ÚÚ$Tdîƒ¬32Ú3B(	BÜV∆BBgV∆¬WáFVÁ6ñˆ‚f6ñÊrFÜRG&VÊ6É≤FÜP¢ÚÚÉ+∆VÊwFÇ◊vó6RGvó7BóG6V∆bó2∆ñW&VBˆÁFÚ7ñÂ∆ÊR&V∆˜r‡¢∆ñW$÷W6ÇÁ&˜FFñˆ‚Áí“ÎÉ∞¢˜f2Á6WDg&ˆ‘Üó4Êv∆RÖ˜EW¬ÎÇì∞¢˜Êñ“Á6WDg&ˆ‘Üó4Êv∆RÖ˜7tÜó2¬„Çì∞¢FˆˆƒÜˆ∆FW"ÁVFW&Êñˆ‚Ê◊V«Fó«ïVFW&ÊñˆÁ2Ö˜Êñ“¬˜f2ì∞¢FˆˆƒÜˆ∆FW"Á˜6óFñˆ‚Á6WBÄ¢∆ñW$÷W6ÇÁ˜6óFñˆ‚ÁÇ≤GF6Ö&ñváEÇ¢∆ñW%Fˆˆƒ&6UÇ≤gvEÇ¢„3"¿¢∆ñW$÷W6ÇÁ˜6óFñˆ‚Áí≤∆ñW%Fˆˆƒ&6Uí¿¢∆ñW$÷W6ÇÁ˜6óFñˆ‚Á¢≤GF6Ö&ñváE¢¢∆ñW%Fˆˆƒ&6UÇ≤gvE¢¢„3 ¢ì∞†¢“V«6RñbÜÊñ“””“w&Vfñ∆≈&W6WBrí∞¢ÚÚ$Tdîƒ¬3R(	BVñ6≤7FÊ6R&W6WC¢¶"V6W2&6≤FÚÊWWG&¬‡¢6ˆÁ7B¶$ˆfb“„3"¢É„“&ˆw&W72ì∞¢∆ñW$÷W6ÇÁ&˜FFñˆ‚Áí“ÎÉ∞¢˜f2Á6WDg&ˆ‘Üó4Êv∆RÖ˜EW¬ÎÇì∞¢˜Êñ“Á6WDg&ˆ‘Üó4Êv∆RÖ˜7tÜó2¬„Çì∞¢FˆˆƒÜˆ∆FW"ÁVFW&Êñˆ‚Ê◊V«Fó«ïVFW&ÊñˆÁ2Ö˜Êñ“¬˜f2ì∞¢FˆˆƒÜˆ∆FW"Á˜6óFñˆ‚Á6WBÄ¢∆ñW$÷W6ÇÁ˜6óFñˆ‚ÁÇ≤GF6Ö&ñváEÇ¢∆ñW%Fˆˆƒ&6UÇ≤gvEÇ¢¶$ˆfb¿¢∆ñW$÷W6ÇÁ˜6óFñˆ‚Áí≤∆ñW%Fˆˆƒ&6Uí¿¢∆ñW$÷W6ÇÁ˜6óFñˆ‚Á¢≤GF6Ö&ñváE¢¢∆ñW%Fˆˆƒ&6UÇ≤gvE¢¢¶$ˆf`¢ì∞†¢“V«6R∞¢ÚÚ5tTU(	B&ˆGí&˜FFW2Fá&˜VvÇvñÊGW◊7G&ñ∂R◊&WGW&‚&3≤ÜR∆ˆ6∂VBñ‚ÜÊB‡¢ÚÚ”"„#Û"„"&B&RWÜ7F«íFÜRGF6≤÷Êñ÷Fñˆ‚÷VFóF˜"w2$ÜF6ÜWB(	@¢ÚÚ7vñÊrá7vVWí"&W6WBÇ”#b„VFVrÛ#„CñFVrí(	B6ˆ÷&Ú7FW2◊W7B÷F6Ä¢ÚÚFÜB&W6WB£¬6ÚÊÚWáG&66∆ñÊr&WñˆÊBFó%6ñv‚˜˜vW"∆ñW2ÜW&R‡¢ÚÚ6ˆ÷&B7vñÊw2«FW&ÊFRFó&V7Fñˆ‚Üf˜&VÜÊBˆ&6∂ÜÊBífñ¢ÚÚ6ˆ÷&E7vñÊu6ñv„≤˜vW"Ñ6∆VfRí66∆W2FÜRvÜˆ∆R&2f˜"ÜVfñW"fñÊó6ÜW"‡¢6ˆÁ7B7vVW6ñv‚“6ˆ÷&E7vñÊtÊñ“Ú6ˆ÷&E7vñÊu6ñv‚¢∞¢6ˆÁ7B7vVW˜vW"“6ˆ÷&E7vñÊtÊñ“Ú6ˆ÷&E7vñÊu˜vW"¢∞¢6ˆÁ7Btî‰EUÙ‰tƒR“”"„#¢7vVW˜vW"¢7vVW6ñv‚¬5E$î¥UÙ‰tƒR“"„"¢7vVW˜vW"¢7vVW6ñv„∞¢∆WB7vVWˆfc∞¢ñbá&ˆw&W72√“tbí∞¢7vVWˆfb“tî‰EUÙ‰tƒR¢á&ˆw&W72Útbì∞¢“V«6Rñbá&ˆw&W72√“4bí∞¢7vVWˆfb“tî‰EUÙ‰tƒR≤Ö5E$î¥UÙ‰tƒR“tî‰EUÙ‰tƒRí¢Çá&ˆw&W72“tbíÚÖ4b“tbíì∞¢“V«6Rñbá&ˆw&W72√“Ñbí∞¢7vVWˆfb“5E$î¥UÙ‰tƒS∞¢“V«6R∞¢7vVWˆfb“5E$î¥UÙ‰tƒR¢É„“á&ˆw&W72“ÑbíÚÉ„“Ñbíì∞¢–¢6ˆÁ7BlÎÇ“ÎÇ≤7vVWˆfc∞¢∆ñW$÷W6ÇÁ&˜FFñˆ‚Áí“lÎÉ∞¢6ˆÁ7Be%Ç“÷FÇÊ6˜2álÎÇí¬e%¢“‘÷FÇÁ6ñ‚álÎÇì∞¢6ˆÁ7BdeÇ“÷FÇÁ6ñ‚álÎÇí¬de¢“÷FÇÊ6˜2álÎÇì∞¢˜f2Á6WDg&ˆ‘Üó4Êv∆RÖ˜EW¬lÎÇì∞¢FˆˆƒÜˆ∆FW"ÁVFW&Êñˆ‚Ê6˜íÖ˜f2ì∞¢ÚÚ&6∂ÜÊB÷ó'&˜'2FÜRÜÊBGF6ÇˆñÁBFˆÚÜ÷F6ÜñÊrFÜRVFóF˜"w0¢ÚÚ$f∆ó7&˜72÷ñF∆ñÊR#¢Fˆˆƒ&6RÁÇÊVvFW2∆ˆÊrvóFÇ&ˆGïñrÊBFÜP¢ÚÚ7&óFR66∆Rí(	BG'VR÷ó'&˜"¬Ê˜BßW7BFÜR&ˆGí7ñÊÊñÊrFÜR˜FÜW"ví‡¢6ˆÁ7BÜÊEÇ“∆ñW%Fˆˆƒ&6UÇ¢7vVW6ñv„∞¢FˆˆƒÜˆ∆FW"Á˜6óFñˆ‚Á6WBÄ¢∆ñW$÷W6ÇÁ˜6óFñˆ‚ÁÇ≤e%Ç¢ÜÊEÇ≤deÇ¢„b¿¢∆ñW$÷W6ÇÁ˜6óFñˆ‚Áí≤∆ñW%Fˆˆƒ&6Uí¿¢∆ñW$÷W6ÇÁ˜6óFñˆ‚Á¢≤e%¢¢ÜÊEÇ≤de¢¢„`¢ì∞¢–†¢ÚÚ∆ñW"FÜR7&óFRw2˜v‚'7ñÊÊñÊr"Gvó&¬ˆ‚F˜ˆbvÜñ6ÜWfW"7vñÊr7Gñ∆Ró27FófR(	@¢ÚÚ÷6R÷÷ˆFRÜ'ˆˆ‚óFV◊27ñ‚Fá&˜VvÇFÜR7vñÊr¬7V"÷÷ˆFRˆÊW2Üˆ∆BFÜVó"&W7B˜6R‡¢6ˆÁ7B7ñ‰óFV‘∂Wí“WVó÷VÁE6∆˜G5∂7FófUFˆˆ≈“«¬WVó÷VÁE6∆˜G2ÁvVˆ„∞¢6ˆÁ7B7ñÂ∆ÊR“Fˆˆƒ÷W6Ñ÷∂7FófUFˆˆ≈”ÚÁW6W$FFÚÁFˆˆ≈∆ÊS∞¢ñbá7ñÂ∆ÊRí∞¢ÚÚFÜR7vVW7Gñ∆Rw2&∆FR◊&∆∆V¬¢◊Gvó7B&V∆ˆÊw2FÚvÜñ6ÜWfW"Êñ“ó27GV∆«ê¢ÚÚ∆ññÊrFÜó2g&÷R¬Ê˜BvÜñ6ÜWfW"7Gñ∆RFÜRWVóVBóFV“FVfV«G2FÚB&W7B(	@¢ÚÚ6ˆ÷&B&ñ∆óFñW26‚f˜&6RÁí7Gñ∆RˆÁFÚÁívVˆ‚ÜFá'W7B◊7Gñ∆RVñ6∞¢ÚÚGF6≤∆ñVBˆ‚FÜR7vVW◊7Gñ∆VBÜF6ÜWB¬˜"7vVW6ˆ÷&Ú7FW∆ñVBˆ‚FÜP¢ÚÚFá'W7B◊7Gñ∆VBñ6≤◊6Ü˜fV¬í¬6Ú&∂ñÊrFÜRGvó7BW"÷óFV“B÷W6Ç7&VFñˆ‚v˜Bó@¢ÚÚ&6∑v&G2ñ‚VóFÜW"Fó&V7Fñˆ‚‚FW&ófñÊróBg&ˆ“Êñ÷ÜW&R∂VW2óB6˜'&V7@¢ÚÚ&Vv&F∆W72ˆbvÜBw2WVóVBÜÊBÊGW&∆«íG&˜2FÚGW&ñÊrfó6ÖFá&˜t7FófR¿¢ÚÚ6ñÊ6RFÜB«vó2f˜&6W2Êñ“FÚv6Ü˜rí‡¢6ˆÁ7B&6U&˜E¢“Êñ“””“w7vVWrÚ‘÷FÇÂíÚ"¢∞¢ñbÜÊñ“””“w&Vfñ∆≈Gvó7D˜WBrí∞¢ÚÚ∆W'É+∆VÊwFÇ◊vó6R7ñ‚˜WB¬ñÊFWVÊFVÁBˆbÁíóFV“w2˜v‚'7ñÊÊñÊr"f∆r‡¢7ñÂ∆ÊRÁ&˜FFñˆ‚Á¢“&6U&˜E¢≤&ˆw&W72¢÷FÇÂì∞¢“V«6RñbÜÊñ“””“w&Vfñ∆≈Gvó7D&6≤rí∞¢ÚÚ&WfW'6RˆbFÜRGvó7B÷˜WC¢∆W'&6≤g&ˆ“É+FÚ+‡¢7ñÂ∆ÊRÁ&˜FFñˆ‚Á¢“&6U&˜E¢≤÷FÇÂí¢É“&ˆw&W72ì∞¢“V«6R∞¢ÚÚFÜR÷6Rw2˜v‚fó6ÜñÊr◊Fá&˜rGvó&¬ó26˜6÷WFñ2FÚFÜRÜ'ˆˆ‚67B(	@¢ÚÚóB6Ü˜V∆F‚wB«6Ú∆ñW"ˆÁFÚ6ˆ÷&B7vñÊw2vÜV‚FÜR6÷RóFV“ó0¢ÚÚWVóVBñ‚FÜRvVˆ‚6∆˜B¬˜"WfW'í6ˆ÷&Ú˜Vñ6≤÷GF6≤v˜V∆@¢ÚÚ7ñ‚∆ñ∂Rfó6ÜñÊrFá&˜rñÁ7FVBˆbfˆ∆∆˜vñÊróG2˜v‚Êñ“&2‡¢7ñÂ∆ÊRÁ&˜FFñˆ‚Á¢“ÖDÙÙ≈ÙïDT’ÙDTe5∑7ñ‰óFV‘∂Wï”ÚÁ7ñÊÊñÊrbb6ˆ÷&E7vñÊtÊñ“ê¢Ú&6U&˜E¢“&ˆw&W72¢÷FÇÂí¢"¢DÙÙ≈ı5îÂı$UdÙ≈UDîÙÂ0¢¢&6U&˜E£∞¢–¢ÚÚ&6∂ÜÊB6ˆ÷&B7vVW2÷ó'&˜"FÜRvVˆ‚7&óFRóG6V∆b¬Ê˜BßW7BFÜR7vñÊr&2‡¢7ñÂ∆ÊRÁ66∆RÁÇ“ÜÊñ“””“w7vVWrbb6ˆ÷&E7vñÊtÊñ“íÚ6ˆ÷&E7vñÊu6ñv‚¢∞¢–†¢ñbáVÊFñÊt7Fñˆ‚bb7G&ñ∂Tfó&VBbb&ˆw&W72„“4bí∞¢7G&ñ∂Tfó&VB“G'VS∞¢fó&UVÊFñÊt7Fñˆ‚Çì∞¢–¢ñbÜfó6ÖFá&˜t7FófRbbFˆˆ≈7vñÊuB√“ífó6ÖFá&˜t7FófR“f«6S∞¢ñbÜ6ˆ÷&E7vñÊtÊñ“bbFˆˆ≈7vñÊuB√“í≤6ˆ÷&E7vñÊtÊñ““ÁV∆√≤6ˆ÷&E7vñÊu˜6R“ÁV∆√≤6ˆ÷&E7vñÊtÜˆ∆E2“≤6ˆ÷&E7vñÊtff∆ñ7Fñˆ‰ñG2“µ”≤6ˆ÷&E7vñÊtff∆ñ7Fñˆ‰◊V«2“∑”≤6ˆ÷&E7vñÊt6ˆÊR“ÁV∆√≤–¢–†¢ÚÚñÊóFñ∆ó¶R÷W6Ç÷gFW"FˆˆƒÜˆ∆FW"WÜó7G0¢&V'Vñ∆EFˆˆƒ÷W6ÜW2Çì∞†††¢ÚÚ)H)H'Vñ∆B˜WFFRFñ∆R÷W6ÜW2)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H †¢ÚÚ)H)HfVvWFFñˆ‚6∆"vVˆ÷WG'í≤vñÊB6ÜFW")H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢6ˆÁ7BdTuÙÇ“„É≤ÚÚ6∆"ÜVñváBf˜"6á'V'2˜vVVG0¢6ˆÁ7BfVtvVÚ“ÊWrDÖ$TR‰&˜ÑvVˆ÷WG'íÉ„ÉÇ¬dTuÙÇ¬„ÉÇì∞†¢ÚÚvñÊBfW'FWÇ6ÜFW"(	BFó7∆6W2F˜fW'Fñ6W2Ü˜&ó¶ˆÁF∆«í'í6ñ‚áFñ÷R≤Ü6Rê¢6ˆÁ7BvñÊEfW'B“ ¢VÊñf˜&“f∆ˆBUFñ÷S∞¢VÊñf˜&“f∆ˆBUÜ6S∞¢VÊñf˜&“f∆ˆBU7G&VÊwFÉ∞¢f'ññÊrfV32dÊ˜&÷√∞¢f'ññÊrfV32efñWu˜3∞¢fˆñB÷ñ‚Çí∞¢dÊ˜&÷¬“Ê˜&÷ƒ÷G&óÇ¢Ê˜&÷√∞¢fV3Bv˜&∆E˜2“÷ˆFVƒ÷G&óÇ¢fV3Bá˜6óFñˆ‚¬„ì∞¢ÚÚˆÊ«í7víFÜRF˜Ü∆bá˜6óFñˆ‚Áí‚ê¢f∆ˆBF˜f7F˜"“÷ÇÉ„¬˜6óFñˆ‚ÁíÚGµdTuÙÇÁFÙfóÜVBÉ2ó“ì∞¢f∆ˆB7ví“6ñ‚áUFñ÷R¢„Ç≤UÜ6Rí¢U7G&VÊwFÇ¢F˜f7F˜#∞¢f∆ˆB7vì"“6˜2áUFñ÷R¢„"≤UÜ6R¢„2í¢U7G&VÊwFÇ¢„R¢F˜f7F˜#∞¢v˜&∆E˜2ÁÇ≥“7vì∞¢v˜&∆E˜2Á¢≥“7vì#∞¢fV3B◊e˜2“fñWt÷G&óÇ¢v˜&∆E˜3∞¢efñWu˜2“◊e˜2Ááó£∞¢v≈ı˜6óFñˆ‚“&ˆ¶V7Fñˆ‰÷G&óÇ¢◊e˜3∞¢–¢∞¢6ˆÁ7BvñÊDg&r“ ¢VÊñf˜&“fV32T6ˆ∆˜#∞¢f'ññÊrfV32dÊ˜&÷√∞¢f'ññÊrfV32efñWu˜3∞¢fˆñB÷ñ‚Çí∞¢fV32∆ñváDFó"“Ê˜&÷∆ó¶RáfV32É„B¬„¬„2íì∞¢f∆ˆBFñfb“÷ÇÜF˜BÜÊ˜&÷∆ó¶RádÊ˜&÷¬í¬∆ñváDFó"í¬„í¢„b≤„C∞¢v≈Ùg&t6ˆ∆˜"“fV3BáT6ˆ∆˜"¢Fñfb¬„ì∞¢–¢∞†¢ÚÚ6Ü&VBFñ÷RVÊñf˜&“(	BWFFVBWfW'íg&÷P¢6ˆÁ7BvñÊEVÊñf˜&◊2“≤UFñ÷S¢≤f«VS¢“¬UÜ6S¢≤f«VS¢“¬U7G&VÊwFÉ¢≤f«VS¢„B“¬T6ˆ∆˜#¢≤f«VS¢ÊWrDÖ$TR‰6ˆ∆˜"ÉÉ#Cv362í“”∞†¢gVÊ7Fñˆ‚÷∂UfVt÷FW&ñ¬Ü6ˆ∆˜"¬Ü6Rí∞¢&WGW&‚ÊWrDÖ$TRÂ6ÜFW$÷FW&ñ¬á∞¢VÊñf˜&◊3¢∞¢UFñ÷S¢≤f«VS¢“¿¢UÜ6S¢≤f«VS¢Ü6R“¿¢U7G&VÊwFÉ¢≤f«VS¢„B“¿¢T6ˆ∆˜#¢≤f«VS¢ÊWrDÖ$TR‰6ˆ∆˜"Ü6ˆ∆˜"í“¿¢“¿¢fW'FWÖ6ÜFW#¢vñÊEfW'B¿¢g&v÷VÁE6ÜFW#¢vñÊDg&r¿¢6ñFS¢DÖ$TR‰F˜V&∆U6ñFR¿¢“ì∞¢–†¢ÚÚG&6≤∆¬fVvWFFñˆ‚÷W6ÜW2f˜"vñÊBÊñ÷Fñˆ‡¢6ˆÁ7BfVt÷W6ÜW2“µ”∞¢ÚÚG&6≤fˆ∆ñvR÷vVÊW&F˜"w&˜W2'íFñ∆RñÊFWÇf˜"&˜FFñˆ‚÷&6VB7vê¢6ˆÁ7BfVtfˆ∆ñvT÷W6ÜW2“ÊWr'&íÖ$ıu2¢4Ù≈2íÊfñ∆¬ÜÁV∆¬ì∞¢ÚÚ7'6RñÊFWÇˆbˆ67WñVBfVtfˆ∆ñvT÷W6ÜW26∆˜G2¬∂WBñ‚7ñÊ2'í6WEfVtfˆ∆ñvT÷W6ÇÇí¿¢ÚÚ6ÚFÜRW"÷g&÷RvñÊB◊7ví∆ˆ˜ˆÊ«ífó6óG2∆ófRVÁG&ñW2ñÁ7FVBˆb∆¬ì3b6∆˜G2‡¢6ˆÁ7B˜fVtfˆ∆ñvT7FófR“ÊWr6WBÇì∞¢gVÊ7Fñˆ‚6WEfVtfˆ∆ñvT÷W6ÇÜí¬f¬í∞¢fVtfˆ∆ñvT÷W6ÜW5∂ï““f√∞¢ñbáf¬í˜fVtfˆ∆ñvT7FófRÊFBÜíì≤V«6R˜fVtfˆ∆ñvT7FófRÊFV∆WFRÜíì∞¢–†¢ÚÚ)H)Hw&72&ñ∆∆&ˆ&B7ó7FV“Üw&75ÛÁÊr7&óFW2ˆ‚u$52Fñ∆W2í)H)H)H)H)H)H)H)H)H ¢ÚÚ&VÊFW&VBfññÁ7FÊ6VD÷W6ÇÜˆÊRG&r6∆¬W"6FVv˜'ííñÁ7FVBˆbˆÊP¢ÚÚ÷W6Çó"W"&∆FR(	BBB7&˜76W29r"&∆FW2W"Fñ∆R¬W"‘÷W6Ä¢ÚÚ&ˆ6Çv˜V∆B6˜7BFVÁ2ˆbFÜ˜W6ÊG2ˆbG&r6∆«27&˜72FÜRf&“w0¢ÚÚtTTE2÷÷¶˜&óGíFVfV«BFñ∆RGFW&‚¬vÜñ6Çó2FÜR&V¬6W6Rˆb¶Ê∑ê¢ÚÚg&÷R6ñÊrGW&ñÊr÷˜fV÷VÁBÜÊ˜BFÜRW"◊Fñ∆R7VVB◊V«Fó∆ñW"í‡†¢gVÊ7Fñˆ‚ˆ÷%&Êrá6VVBí∞¢∆WB2“6VVB„„‚∞¢&WGW&‚Çí”‚∞¢2≥“ÉdC$#sîcS∞¢∆WBB“÷FÇÊñ◊V¬á2‚á2„„‚Rí¬2¬ì∞¢B„“B≤÷FÇÊñ◊V¬áB‚áB„„‚rí¬B¬cì∞¢&WGW&‚ÇáB‚áB„„‚Bíí„„‚íÚC#ìCìcs#ìc∞¢”∞¢–†¢ÚÚ6Ü&VB&∆FRvVˆ÷WG'ì¢9s∆ÊTvVˆ÷WG'íÊ6Ü˜&VBBì” ¢6ˆÁ7Bˆw&74&∆FTvVÚ“ÇÇí”‚∞¢6ˆÁ7Br“ÊWrDÖ$TRÂ∆ÊTvVˆ÷WG'íÉ¬ì∞¢rÁG&Á6∆FRÉ¬„R¬ì∞¢&WGW&‚s∞¢“íÇì∞†¢6ˆÁ7Bˆw&74&ñ∆≈fW'B“ ¢VÊñf˜&“f∆ˆBUFñ÷S∞¢VÊñf˜&“f∆ˆBU7G&VÊwFÉ∞¢f'ññÊrfV3"eWc∞¢f'ññÊrf∆ˆBe&ÊFˆ”∞¢fˆñB÷ñ‚Çí∞¢eWb“Wc∞¢6ñfFVbU4UÙîÂ5D‰4î‰p¢fV3Bv˜&∆E˜2“÷ˆFVƒ÷G&óÇ¢ñÁ7FÊ6T÷G&óÇ¢fV3Bá˜6óFñˆ‚¬„ì∞¢6V«6P¢fV3Bv˜&∆E˜2“÷ˆFVƒ÷G&óÇ¢fV3Bá˜6óFñˆ‚¬„ì∞¢6VÊFñ`¢ÚÚ7F&∆RW"÷&∆FR6WVFÚ◊&ÊFˆ“f«VRg&ˆ“óG2ÜfóÜVBíw&˜VÊ@¢ÚÚ˜6óFñˆ‚(	BW6VB'íFÜRg&v÷VÁB6ÜFW"FÚFÜñ‚FÜRGVgB6˜VÁ@¢ÚÚ6V6ˆÊ∆«íÑFVFw&72Ù6ˆ∆F◊V6≤ívóFÜ˜WBF˜V6ÜñÊrFÜRñÁ7FÊ6P¢ÚÚ'VffW"óG6V∆b¬6ÚFVÁ6óGí6‚6ÜÊvRvóFÇ6ñÊv∆RVÊñf˜&“‡¢e&ÊFˆ““g&7Bá6ñ‚ÜF˜Báv˜&∆E˜2Áá¢¬fV3"É"„ìÉìÇ¬sÇ„#32ííí¢C3sSÇ„SCS2ì∞¢f∆ˆBF˜f7F˜"“WbÁì∞¢f∆ˆBÜ6R“v˜&∆E˜2ÁÇ¢„r≤v˜&∆E˜2Á¢¢"„3∞¢f∆ˆB7ví“6ñ‚áUFñ÷R¢„Ç≤Ü6Rí¢U7G&VÊwFÇ¢F˜f7F˜#∞¢f∆ˆB7vì"“6˜2áUFñ÷R¢„"≤Ü6R¢„2í¢U7G&VÊwFÇ¢„R¢F˜f7F˜#∞¢v˜&∆E˜2ÁÇ≥“7vì∞¢v˜&∆E˜2Á¢≥“7vì#∞¢v≈ı˜6óFñˆ‚“&ˆ¶V7Fñˆ‰÷G&óÇ¢fñWt÷G&óÇ¢v˜&∆E˜3∞¢–¢∞†¢6ˆÁ7Bˆw&74&ñ∆ƒg&r“ ¢VÊñf˜&“6◊∆W#$BTw&75FWÉ∞¢VÊñf˜&“fV32UFñÁC∞¢VÊñf˜&“f∆ˆBTFVÁ6óGì∞¢f'ññÊrfV3"eWc∞¢f'ññÊrf∆ˆBe&ÊFˆ”∞¢fˆñB÷ñ‚Çí∞¢ñbáe&ÊFˆ“‚TFVÁ6óGííFó66&C∞¢fV3BFWÜV¬“FWáGW&S$BáTw&75FWÇ¬eWbì∞¢ñbáFWÜV¬Ê¬„RíFó66&C∞¢ÚÚG&VBw&75ÛÁÊr2÷ñÁB◊FˆÊVC≤FW6GW&FRÊB&R◊FñÁBFÚw&726ˆ∆˜ ¢f∆ˆB«V““F˜BáFWÜV¬Á&v"¬fV32É„#ìí¬„SÉr¬„Bíì∞¢ÚÚVÊ∆óB¬6÷R2FÜRw&˜VÊBFñ∆W2r÷W6Ñ&6ñ4÷FW&ñ¬á6VP¢ÚÚVÊ∆óDf∆ˆ˜$÷B˜Fñ∆T÷G2Êw&72í(	B&∆FW2&VBBˆÊR6ˆÁ6ó7FVÁ@¢ÚÚñÁFVB'&ñváFÊW72Fí˜"ÊñváB˜7F˜&“ñÁ7FVBˆbFñ÷÷ñÊrvóFÄ¢ÚÚ÷&ñVÁD∆ñváB˜7V‰∆ñváB¬6Ú&∆FRÊWfW"vˆW2F&∂W"FÜ‚FÜP¢ÚÚw&727W&f6RóBw27FÊFñÊrˆ‚‡¢fV32FñÁFVB“UFñÁB¢É„r≤«V“¢„Çì∞¢ÚÚG&v‚˜WF∆ñÊRóÜV«2ÜÊV"÷&∆6≤6˜W&6Rí7FíW&R&∆6≥≤FñÁBFÜR&W7@¢fV326ˆ¬“÷óÇáfV32É„í¬FñÁFVB¬6÷ˆ˜Fá7FWÉ„¬„R¬«V“íì∞¢v≈Ùg&t6ˆ∆˜"“fV3BÜ6ˆ¬¬FWÜV¬Êì∞¢–¢∞†¢6ˆÁ7Bˆw&75FñÁB“ÊWrDÖ$TR‰6ˆ∆˜"ÇíÁ6WDÖ4¬ÉÇÚ3c¬„SÇ¬„#Çì∞¢∆WBw&74&ñ∆∆&ˆ&D÷B“ÁV∆√∞¢∆WB7WGF&∆T&ñ∆∆&ˆ&Dv∆˜t÷B“ÁV∆√∞¢∆WB7WGF&∆T&ñ∆∆&ˆ&Dv∆˜t÷W6Ç“ÁV∆√∞¢ÚÚ66ÜVBw&72÷∆Vb6ñ∆Ü˜VWGFRFWáGW&R¬&WW6VBá&R◊FñÁFVBW"&VvVÁBê¢ÚÚ'ívWE&VvVÁE∆ÁD÷FW&ñ¬f˜"∆6ÜV◊í&VvVÁB∆ÁB&ñ∆∆&ˆ&G2‡¢∆WBˆw&74∆VeFWÇ“ÁV∆√∞†¢ÊWrDÖ$TRÂFWáGW&T∆ˆFW"ÇíÊ∆ˆBÇv76WG2ˆ∆VfW2ˆw&75ÛÁÊrr¬áFWÇí”‚∞¢FWÇÊ÷tfñ«FW"“DÖ$TR‰ÊV&W7Dfñ«FW#∞¢FWÇÊ÷ñ‰fñ«FW"“DÖ$TR‰ÊV&W7Dfñ«FW#∞¢ˆw&74∆VeFWÇ“FWÉ∞¢6ˆÁ7B6Ü&VEVÊñf˜&◊2“Çí”‚á∞¢Tw&75FWÉ¢≤f«VS¢FWÇ“¿¢UFñÁC¢≤f«VS¢ˆw&75FñÁB“¿¢UFñ÷S¢≤f«VS¢“¿¢U7G&VÊwFÉ¢≤f«VS¢„B“¿¢TFVÁ6óGì¢≤f«VS¢“¿¢“ì∞¢w&74&ñ∆∆&ˆ&D÷B“ÊWrDÖ$TRÂ6ÜFW$÷FW&ñ¬á∞¢VÊñf˜&◊3¢6Ü&VEVÊñf˜&◊2Çí¿¢fW'FWÖ6ÜFW#¢ˆw&74&ñ∆≈fW'B¿¢g&v÷VÁE6ÜFW#¢ˆw&74&ñ∆ƒg&r¿¢«ÜFW7C¢„R¬6ñFS¢DÖ$TR‰F˜V&∆U6ñFR¬FWFÖw&óFS¢G'VR¿¢“ì∞¢«ï6V6ˆÊƒw&74V&Ê6RÇì∞¢7WGF&∆T&ñ∆∆&ˆ&Dv∆˜t÷B“ÊWrDÖ$TRÂ6ÜFW$÷FW&ñ¬á∞¢VÊñf˜&◊3¢∞¢Tw&75FWÉ¢≤f«VS¢FWÇ“¿¢T6ˆ∆˜#¢≤f«VS¢ÊWrDÖ$TR‰6ˆ∆˜"Ü6ˆ÷&D6ˆÊfñrÇíÊ7WGF&∆UF&vWDv∆˜sÚÊ6ˆ∆˜"«¬r6fc&brí“¿¢T«Ü¢≤f«VS¢ÁV÷&W"Ü6ˆ÷&D6ˆÊfñrÇíÊ7WGF&∆UF&vWDv∆˜sÚÊ«Üí«¬„C"–¢“¿¢fW'FWÖ6ÜFW#¢ˆw&74&ñ∆≈fW'B¿¢g&v÷VÁE6ÜFW#¢ ¢VÊñf˜&“6◊∆W#$BTw&75FWÉ∞¢VÊñf˜&“fV32T6ˆ∆˜#∞¢VÊñf˜&“f∆ˆBT«Ü∞¢f'ññÊrfV3"eWc∞¢fˆñB÷ñ‚Çí∞¢fV3BFWÜV¬“FWáGW&S$BáTw&75FWÇ¬eWbì∞¢ñbáFWÜV¬Ê¬„RíFó66&C∞¢v≈Ùg&t6ˆ∆˜"“fV3BáT6ˆ∆˜"¬T«Ü¢FWÜV¬Êì∞¢–¢¿¢G&Á7&VÁC¢G'VR¬FWFÖw&óFS¢f«6R¬FWFÖFW7C¢G'VR¬&∆VÊFñÊs¢DÖ$TR‰FFóFófT&∆VÊFñÊr¬6ñFS¢DÖ$TR‰F˜V&∆U6ñFR¿¢“ì∞¢˜&V'Vñ∆Df&‘&ñ∆∆&ˆ&G2Çì∞¢ñbÖ˜F˜vÂ66VÊT'Vñ«Bí∞¢ˆ'Vñ∆EF˜v‰w&74&ñ∆∆&ˆ&G2Ö˜F˜vÂ¶ˆÊSÚÊ6ˆ«2«¬c¬˜F˜vÂ¶ˆÊSÚÁ&˜w2«¬Sì∞¢vñÊF˜r‰&˜&FW%FW'&ñ‚Ê'Vñ∆EF˜v‰&˜&FW$w&74&ñ∆∆&ˆ&G2Çì∞¢–¢“ì∞†¢ÚÚfñ∆«2B7&˜76W2É#Ç&∆FW2ív˜'FÇˆbñÁ7FÊ6R÷G&ñ6W2f˜"ˆÊRFñ∆P¢ÚÚñÁFÚ÷W6Ü7F'FñÊrB7F'DñGÜ≤&WGW&Á2FÜRÊWáBg&VRñÊFWÇ‡¢gVÊ7Fñˆ‚ˆfñ∆ƒ&ñ∆∆&ˆ&DñÁ7FÊ6W2Ü÷W6Ç¬GV÷◊í¬7F'DñGÇ¬6ˆ¬¬&˜r¬6ó¶T◊V¬¬îˆfg6WB“í∞¢6ˆÁ7B&ÊB“ˆ÷%&ÊrÇÇÜ6ˆ¬¢333r≤&˜r¢íí„„‚íì∞¢6ˆÁ7B&6Uí“Fñ∆U7W&f6UíÖFñ∆UGóR‰u$52í≤îˆfg6WC∞¢∆WBñGÇ“7F'DñGÉ∞¢f˜"Ü∆WB"“≤"¬C≤"≤≤í∞¢6ˆÁ7B˜Ç“á&ÊBÇí“„Rí¢„ì∞¢6ˆÁ7B˜¢“á&ÊBÇí“„Rí¢„ì∞¢6ˆÁ7Br“É„b≤&ÊBÇí¢„í¢6ó¶T◊V√∞¢6ˆÁ7BÇ“É„#"≤&ÊBÇí¢„Bí¢6ó¶T◊V√∞¢6ˆÁ7B&˜B“&ÊBÇí¢÷FÇÂì∞¢6ˆÁ7BÇ“6ˆ¬≤„R≤˜Ç¬¢“&˜r≤„R≤˜£∞†¢GV÷◊íÁ˜6óFñˆ‚Á6WBáÇ¬&6Uí¬¢ì∞¢GV÷◊íÁ&˜FFñˆ‚Á6WBÉ¬&˜B¬ì∞¢GV÷◊íÁ66∆RÁ6WBár¬Ç¬ì∞¢GV÷◊íÁWFFT÷G&óÇÇì∞¢÷W6ÇÁ6WD÷G&óÑBÜñGÇ≤≤¬GV÷◊íÊ÷G&óÇì∞†¢GV÷◊íÁ&˜FFñˆ‚Á6WBÉ¬&˜B≤÷FÇÂí¢„R¬ì∞¢GV÷◊íÁWFFT÷G&óÇÇì∞¢÷W6ÇÁ6WD÷G&óÑBÜñGÇ≤≤¬GV÷◊íÊ÷G&óÇì∞¢–¢&WGW&‚ñGÉ∞¢–†¢gVÊ7Fñˆ‚WFFT7WGF&∆T&ñ∆∆&ˆ&Dv∆˜rÜ6ˆ¬¬&˜r¬fó6ñ&∆Rí∞¢ñbÇ7WGF&∆T&ñ∆∆&ˆ&Dv∆˜t÷W6Ç«¬7WGF&∆T&ñ∆∆&ˆ&Dv∆˜t÷Bí&WGW&„∞¢ñbÇfó6ñ&∆R«¬6ˆ÷&D6ˆÊfñrÇíÊ7WGF&∆UF&vWDv∆˜sÚÊVÊ&∆VB””“f«6Rí∞¢7WGF&∆T&ñ∆∆&ˆ&Dv∆˜t÷W6ÇÊ6˜VÁB“∞¢&WGW&„∞¢–¢7WGF&∆T&ñ∆∆&ˆ&Dv∆˜t÷BÁVÊñf˜&◊2ÁT6ˆ∆˜"Áf«VRÁ6WBÜ6ˆ÷&D6ˆÊfñrÇíÊ7WGF&∆UF&vWDv∆˜sÚÊ6ˆ∆˜"«¬r6fc&brì∞¢7WGF&∆T&ñ∆∆&ˆ&Dv∆˜t÷BÁVÊñf˜&◊2ÁT«ÜÁf«VR“ÁV÷&W"Ü6ˆ÷&D6ˆÊfñrÇíÊ7WGF&∆UF&vWDv∆˜sÚÊ«Üí«¬„C#∞¢6ˆÁ7BGV÷◊í“ÊWrDÖ$TR‰ˆ&¶V7C4BÇì∞¢7WGF&∆T&ñ∆∆&ˆ&Dv∆˜t÷W6ÇÊ6˜VÁB“ˆfñ∆ƒ&ñ∆∆&ˆ&DñÁ7FÊ6W2Ü7WGF&∆T&ñ∆∆&ˆ&Dv∆˜t÷W6Ç¬GV÷◊í¬¬6ˆ¬¬&˜r¬"„ì∞¢7WGF&∆T&ñ∆∆&ˆ&Dv∆˜t÷W6ÇÊñÁ7FÊ6T÷G&óÇÊÊVVG5WFFR“G'VS∞¢–†¢ÚÚf&“w&72Ñu$52Fñ∆W2¬vFVB'í5ˆw&72íÊBvVVG2ÖtTTE2Fñ∆W2ñ‡¢ÚÚ÷ˆFR¬«vó2ˆ‚íV6ÇvWBˆÊRñÁ7FÊ6VD÷W6Ç6ó¶VBf˜"FÜRv˜'7B66P¢ÚÚÜWfW'íf&“Fñ∆R&VñÊrFÜBGóRí¬6ÚVFóG2ßW7B&Vfñ∆¬FÜR'VffW"Ê@¢ÚÚFßW7BÊ6˜VÁB&FÜW"FÜ‚&V7&VFñÊrFÜR÷W6Ç‡¢∆WBf&‘w&74&ñ∆ƒ÷W6Ç“ÁV∆¬¬f&’vVVD&ñ∆ƒ÷W6Ç“ÁV∆√∞¢gVÊ7Fñˆ‚ˆVÁ7W&Tf&‘&ñ∆∆&ˆ&D÷W6ÜW2Çí∞¢ñbÜf&‘w&74&ñ∆ƒ÷W6Çí&WGW&„∞¢6ˆÁ7B6“$ıu2¢4Ù≈2¢#É∞¢f&‘w&74&ñ∆ƒ÷W6Ç“ÊWrDÖ$TR‰ñÁ7FÊ6VD÷W6ÇÖˆw&74&∆FTvVÚ¬w&74&ñ∆∆&ˆ&D÷B¬6ì∞¢f&‘w&74&ñ∆ƒ÷W6ÇÊg'W7GV‘7V∆∆VB“f«6S∞¢f&‘w&74&ñ∆ƒ÷W6ÇÊ6˜VÁB“∞¢f&‘w&74&ñ∆ƒ÷W6ÇÁfó6ñ&∆R“5ˆw&73∞¢f&‘w&74&ñ∆ƒ÷W6ÇÁW6W$FFÊó4&ñ∆∆&ˆ&B“G'VS∞¢66VÊRÊFBÜf&‘w&74&ñ∆ƒ÷W6Çì∞†¢f&’vVVD&ñ∆ƒ÷W6Ç“ÊWrDÖ$TR‰ñÁ7FÊ6VD÷W6ÇÖˆw&74&∆FTvVÚ¬w&74&ñ∆∆&ˆ&D÷B¬6ì∞¢f&’vVVD&ñ∆ƒ÷W6ÇÊg'W7GV‘7V∆∆VB“f«6S∞¢f&’vVVD&ñ∆ƒ÷W6ÇÊ6˜VÁB“∞¢f&’vVVD&ñ∆ƒ÷W6ÇÁW6W$FFÊó4&ñ∆∆&ˆ&B“G'VS∞¢66VÊRÊFBÜf&’vVVD&ñ∆ƒ÷W6Çì∞†¢7WGF&∆T&ñ∆∆&ˆ&Dv∆˜t÷W6Ç“ÊWrDÖ$TR‰ñÁ7FÊ6VD÷W6ÇÖˆw&74&∆FTvVÚ¬7WGF&∆T&ñ∆∆&ˆ&Dv∆˜t÷B«¬w&74&ñ∆∆&ˆ&D÷B¬#Çì∞¢7WGF&∆T&ñ∆∆&ˆ&Dv∆˜t÷W6ÇÊg'W7GV‘7V∆∆VB“f«6S∞¢7WGF&∆T&ñ∆∆&ˆ&Dv∆˜t÷W6ÇÊ6˜VÁB“∞¢7WGF&∆T&ñ∆∆&ˆ&Dv∆˜t÷W6ÇÁW6W$FFÊó4&ñ∆∆&ˆ&B“G'VS∞¢66VÊRÊFBÜ7WGF&∆T&ñ∆∆&ˆ&Dv∆˜t÷W6Çì∞¢–†¢gVÊ7Fñˆ‚˜&V'Vñ∆Df&‘&ñ∆∆&ˆ&G2Çí∞¢ñbÇw&74&ñ∆∆&ˆ&D÷Bí&WGW&„∞¢ˆVÁ7W&Tf&‘&ñ∆∆&ˆ&D÷W6ÜW2Çì∞¢6ˆÁ7BGV÷◊í“ÊWrDÖ$TR‰ˆ&¶V7C4BÇì∞¢∆WBví“¬ví“∞¢f˜"Ü∆WB&˜r“≤&˜r¬$ıu3≤&˜r≤≤í∞¢f˜"Ü∆WB6ˆ¬“≤6ˆ¬¬4Ù≈3≤6ˆ¬≤≤í∞¢6ˆÁ7BFñ∆R“w&ñE∑&˜u’∂6ˆ≈”∞¢6ˆÁ7BFñW%í“áFñ∆RÊV∆WeFñW"«¬í¢ƒDTUıT‰ïC∞¢ñbáFñ∆RÁGóR””“Fñ∆UGóR‰u$52í∞¢ví“ˆfñ∆ƒ&ñ∆∆&ˆ&DñÁ7FÊ6W2Üf&‘w&74&ñ∆ƒ÷W6Ç¬GV÷◊í¬ví¬6ˆ¬¬&˜r¬„¬FñW%íì∞¢“V«6RñbáFñ∆RÁGóR””“Fñ∆UGóRÂtTTE2bb5˜vVVC4Bí∞¢ví“ˆfñ∆ƒ&ñ∆∆&ˆ&DñÁ7FÊ6W2Üf&’vVVD&ñ∆ƒ÷W6Ç¬GV÷◊í¬ví¬6ˆ¬¬&˜r¬"„¬FñW%íì∞¢–¢–¢–¢f&‘w&74&ñ∆ƒ÷W6ÇÊ6˜VÁB“vì∞¢f&’vVVD&ñ∆ƒ÷W6ÇÊ6˜VÁB“vì∞¢f&‘w&74&ñ∆ƒ÷W6ÇÊñÁ7FÊ6T÷G&óÇÊÊVVG5WFFR“G'VS∞¢f&’vVVD&ñ∆ƒ÷W6ÇÊñÁ7FÊ6T÷G&óÇÊÊVVG5WFFR“G'VS∞¢–†¢ÚÚF˜v‚w2w&72&ñ∆∆&ˆ&G2(	B'Vñ«BˆÊ6RvÜV‚VÁFW&ñÊrF˜v‚áF˜v‚Fñ∆W0¢ÚÚFˆ‚wBvWBFñ∆∆VBˆ6∆V&VBB'VÁFñ÷R¬6ÚÊÚW"◊Fñ∆R&V'Vñ∆BÊVVFVBí‡¢∆WBF˜v‰w&74&ñ∆ƒ÷W6Ç“ÁV∆√∞¢gVÊ7Fñˆ‚ˆ'Vñ∆EF˜v‰w&74&ñ∆∆&ˆ&G2áF6ˆ«2¬G&˜w2í∞¢ñbÇw&74&ñ∆∆&ˆ&D÷Bí&WGW&„∞¢ñbáF˜v‰w&74&ñ∆ƒ÷W6Çí≤F˜vÂ66VÊRÁ&V÷˜fRáF˜v‰w&74&ñ∆ƒ÷W6Çì≤F˜v‰w&74&ñ∆ƒ÷W6Ç“ÁV∆√≤–¢∆WB6˜VÁB“∞¢f˜"Ü∆WB&˜r“≤&˜r¬G&˜w3≤&˜r≤≤ê¢f˜"Ü∆WB6ˆ¬“≤6ˆ¬¬F6ˆ«3≤6ˆ¬≤≤ê¢ñbáF˜v‰w&ñE∑&˜u”ÚÂ∂6ˆ≈”ÚÁGóR””“Fñ∆UGóR‰u$52í6˜VÁB≤≥∞¢ñbÜ6˜VÁB””“í&WGW&„∞†¢F˜v‰w&74&ñ∆ƒ÷W6Ç“ÊWrDÖ$TR‰ñÁ7FÊ6VD÷W6ÇÖˆw&74&∆FTvVÚ¬w&74&ñ∆∆&ˆ&D÷B¬6˜VÁB¢#Çì∞¢F˜v‰w&74&ñ∆ƒ÷W6ÇÊg'W7GV‘7V∆∆VB“f«6S∞¢F˜v‰w&74&ñ∆ƒ÷W6ÇÁfó6ñ&∆R“5ˆw&73∞¢F˜v‰w&74&ñ∆ƒ÷W6ÇÁW6W$FFÊó4&ñ∆∆&ˆ&B“G'VS∞¢6ˆÁ7BGV÷◊í“ÊWrDÖ$TR‰ˆ&¶V7C4BÇì∞¢∆WBñGÇ“∞¢f˜"Ü∆WB&˜r“≤&˜r¬G&˜w3≤&˜r≤≤í∞¢f˜"Ü∆WB6ˆ¬“≤6ˆ¬¬F6ˆ«3≤6ˆ¬≤≤í∞¢6ˆÁ7BFñ∆R“F˜v‰w&ñE∑&˜u”ÚÂ∂6ˆ≈”∞¢ñbáFñ∆SÚÁGóR”“Fñ∆UGóR‰u$52í6ˆÁFñÁVS∞¢6ˆÁ7BFñW%í“áFñ∆RÊV∆WeFñW"«¬í¢ƒDTUıT‰ïC∞¢ñGÇ“ˆfñ∆ƒ&ñ∆∆&ˆ&DñÁ7FÊ6W2áF˜v‰w&74&ñ∆ƒ÷W6Ç¬GV÷◊í¬ñGÇ¬6ˆ¬¬&˜r¬„¬FñW%íì∞¢–¢–¢F˜v‰w&74&ñ∆ƒ÷W6ÇÊ6˜VÁB“ñGÉ∞¢F˜v‰w&74&ñ∆ƒ÷W6ÇÊñÁ7FÊ6T÷G&óÇÊÊVVG5WFFR“G'VS∞¢F˜vÂ66VÊRÊFBáF˜v‰w&74&ñ∆ƒ÷W6Çì∞¢–†¢gVÊ7Fñˆ‚˜&V'Vñ∆EvVVEFñ∆W2Çí∞¢f˜"Ü∆WB"“≤"¬$ıu3≤"≤≤ê¢f˜"Ü∆WB2“≤2¬4Ù≈3≤2≤≤í∞¢ñbÜw&ñE∑%’∂5“ÁGóR”“Fñ∆UGóRÂtTTE2í6ˆÁFñÁVS∞¢6ˆÁ7Bí“"¢4Ù≈2≤3∞¢ñbáFñ∆T÷W6ÜW5∂ï“í≤66VÊRÁ&V÷˜fRáFñ∆T÷W6ÜW5∂ï“ì≤Fñ∆T÷W6ÜW5∂ï““ÁV∆√≤–¢ñbáfVtfˆ∆ñvT÷W6ÜW5∂ï“í≤66VÊRÁ&V÷˜fRáfVtfˆ∆ñvT÷W6ÜW5∂ï“ì≤6WEfVtfˆ∆ñvT÷W6ÇÜí¬ÁV∆¬ì≤–¢ˆ'Vñ∆DˆÊUFñ∆T÷W6ÇÜ2¬"ì∞¢–¢˜&V'Vñ∆Df&‘&ñ∆∆&ˆ&G2Çì∞¢–†¢ÚÚ)H)H7&˜÷W6Ç7ó7FV“)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢ÚÚÊVVF∆Vw&ñ‚ÊBÜVgG&ˆ˜BW6R&ˆ6VGW&¬fˆ∆ñvRvVˆ÷WG'í‡¢ÚÚ∆¬˜FÜW"7&˜2W6R6ñ◊∆R6ˆ∆˜&VB7V&RáVÊ6ÜÊvVBí‡¢6ˆÁ7B5$ıÙ4Ùƒı%2“∞¢ÊVVF∆Vw&ñ„¢≤&ˆGì¢ÉÜ&33F¬&óS¢ÜCF3S#b¬7&˜WC¢ÉVñS3“¿¢ÜVgG&ˆ˜C¢≤&ˆGì¢Ü6cF¬&óS¢ÜcCV¬7&˜WC¢ÉvfSCR“¿¢v&∆ñÊ≥¢≤&ˆGì¢ÜCÜC#¬&óS¢Üc&VC¬7&˜WC¢ÉÜ&&cf“¿¢ˆÊwóV◊3¢≤&ˆGì¢Ü3v6B¬&óS¢ÜSñF"¬7&˜WC¢ÉÉf#ìV“¿¢&VF&W'&ñW3¢≤&ˆGì¢Ü#É6#C"¬&óS¢ÜfcFcc"¬7&˜WC¢ÉF3ñ#C2“¿¢&«VV&W'&ñW3¢≤&ˆGì¢É6Cc&3Ç¬&óS¢ÉVcÉfb¬7&˜WC¢ÉF3ñ#sB“¿¢ñV∆∆˜v&W'&ñW3¢≤&ˆGì¢ÜCf33CR¬&óS¢ÜffSÉf¬7&˜WC¢Év6ÉF"“¿¢vÜóFV&W'&ñW3¢≤&ˆGì¢ÜF6FVC"¬&óS¢Üfffffb¬7&˜WC¢ÉÜ&&cÜ“¿¢&∆6∂&W'&ñW3¢≤&ˆGì¢É6C&S"¬&óS¢És#b¬7&˜WC¢ÉFCÜF“¿¢&∆6¥◊W7F&C¢≤&ˆGì¢ÉF6#&b¬&óS¢ÉcÉ"¬7&˜WC¢ÉsÉñ#6“¿¢w&VV‰◊W7F&C¢≤&ˆGì¢ÉfFcF¬&óS¢Éñ&Ccf"¬7&˜WC¢ÉsV#ìSr“¿¢”∞¢6ˆÁ7B5$ıÙ‘Öı44ƒR“„ìc∞¢6ˆÁ7B5$ıÙ‘îÂı44ƒR“„c∞¢6ˆÁ7B7&˜÷W6ÜW2“ÊWr'&íÖ$ıu2¢4Ù≈2íÊfñ∆¬ÜÁV∆¬ì∞†¢ÚÚG&6∑2vÜñ6Çw&˜wFÇ'V6∂WBÉ(	32íV6Çfˆ∆ñvR7&˜v2'Vñ«BB¿¢ÚÚ6ÚvRˆÊ«í&V'Vñ∆BvÜV‚FÜR∆ÁB7&˜76W2Fá&W6Üˆ∆B‡¢6ˆÁ7B7&˜w&˜wFÑ'V6∂WB“ÊWr'&íÖ$ıu2¢4Ù≈2íÊfñ∆¬Ç”ì∞†¢ÚÚñÊFñ6W2ˆbFñ∆W2FÜB7W'&VÁF«íÜfR7&˜(	B&V'Vñ«B∆¶ñ«ívÜVÊWfW ¢ÚÚFñ∆R6ÜÊvW26ÚWFFT7&˜÷W6ÜW2ÇíFˆW6‚wB66‚∆¬ì3bFñ∆W2‡¢∆WBˆ7&˜Fñ∆TñÊFñ6W2“ÁV∆√∞¢gVÊ7Fñˆ‚ˆñÁf∆ñFFT7&˜∆ó7BÇí≤ˆ7&˜Fñ∆TñÊFñ6W2“ÁV∆√≤–¢gVÊ7Fñˆ‚ˆVÁ7W&T7&˜∆ó7BÇí∞¢ñbÖˆ7&˜Fñ∆TñÊFñ6W2”“ÁV∆¬í&WGW&„∞¢ˆ7&˜Fñ∆TñÊFñ6W2“µ”∞¢f˜"Ü∆WB&˜r“≤&˜r¬$ıu3≤&˜r≤≤ê¢f˜"Ü∆WB6ˆ¬“≤6ˆ¬¬4Ù≈3≤6ˆ¬≤≤ê¢ñbÜw&ñE∑&˜u’∂6ˆ≈“Ê7&˜íˆ7&˜Fñ∆TñÊFñ6W2ÁW6Çá&˜r¢4Ù≈2≤6ˆ¬ì∞¢–†¢6ˆÁ7BdÙƒîtUÙ5$ı2“ÊWr6WBÖ≤vÊVVF∆Vw&ñ‚r¬vÜVgG&ˆ˜Bu“ì∞¢6ˆÁ7Bdr“vñÊF˜r‰fˆ∆ñvTvVÊW&F˜#∞†¢gVÊ7Fñˆ‚ˆw&˜wFÑ'V6∂WBÜw&˜wFÇí∞¢ÚÚ&V'Vñ∆Bfˆ∆ñvRBBFá&W6Üˆ∆G2FÚfˆñBW"÷g&÷R&V'Vñ∆G2‡¢ñbÜw&˜wFÇ¬„Rí&WGW&‚∞¢ñbÜw&˜wFÇ¬„CRí&WGW&‚∞¢ñbÜw&˜wFÇ¬„Éí&WGW&‚#∞¢&WGW&‚3∞¢–†¢gVÊ7Fñˆ‚ˆ'Vñ∆Dfˆ∆ñvT÷W6ÇÜ7&˜¬w&˜wFÇ¬6ˆ¬¬&˜rí∞¢ñbÇdrí&WGW&‚ÁV∆√∞¢ñbÜ7&˜””“vÊVVF∆Vw&ñ‚rí&WGW&‚drÊ'Vñ∆DÊVVF∆Vw&ñ‰÷W6ÇÜw&˜wFÇ¬6ˆ¬¬&˜rì∞¢ñbÜ7&˜””“vÜVgG&ˆ˜Brí∞¢ÚÚFá&VR∆ÁG2ñ‚G&ñÊv∆R6«W7FW"¬V6ÇvóFÇVÊóVR6VVBˆfg6W@¢6ˆÁ7Bw&W"“ÊWrDÖ$TR‰w&˜WÇì∞¢6ˆÁ7Bˆfg6WG2“µ≤”„#¬¬„E“¬≥„#"¬¬„E“¬≥„¬¬”„#%’”∞¢f˜"Ü∆WBñGÇ“≤ñGÇ¬3≤ñGÇ≤≤í∞¢6ˆÁ7B∂˜Ç¬˜í¬˜•““ˆfg6WG5∂ñGÖ”∞¢6ˆÁ7B∆ÁB“drÊ'Vñ∆DÜVgG&ˆ˜D÷W6ÇÜw&˜wFÇ¬6ˆ¬≤ñGÇ¢#r¬&˜r≤ñGÇ¢cì∞¢∆ÁBÁ˜6óFñˆ‚Á6WBÜ˜Ç¬˜í¬˜¢ì∞¢∆ÁBÁ66∆RÁ6WE66∆"É„cÇì∞¢w&W"ÊFBá∆ÁBì∞¢–¢&WGW&‚w&W#∞¢–¢&WGW&‚ÁV∆√∞¢–†¢gVÊ7Fñˆ‚WFFT7&˜÷W6ÜW2Çí∞¢ˆVÁ7W&T7&˜∆ó7BÇì∞¢6ˆÁ7BˆÊ˜r“W&f˜&÷Ê6RÊÊ˜rÇì∞¢f˜"Ü6ˆÁ7Bíˆbˆ7&˜Fñ∆TñÊFñ6W2í∞¢6ˆÁ7B6ˆ¬“íR4Ù≈3∞¢6ˆÁ7B&˜r“ÜíÚ4Ù≈2í¬∞¢6ˆÁ7BFñ∆R“w&ñE∑&˜u’∂6ˆ≈”∞†¢ÚÚ7F∆RVÁG'íÜ7&˜v2Ü'fW7FVB6ñÊ6R∆7B∆ó7B&V'Vñ∆Bí(	B6∆V‚W‡¢ñbÇFñ∆RÊ7&˜í∞¢ñbÜ7&˜÷W6ÜW5∂ï“í≤66VÊRÁ&V÷˜fRÜ7&˜÷W6ÜW5∂ï“ì≤7&˜÷W6ÜW5∂ï““ÁV∆√≤–¢7&˜w&˜wFÑ'V6∂WE∂ï““”∞¢ˆñÁf∆ñFFT7&˜∆ó7BÇì∞¢6ˆÁFñÁVS∞¢–†¢6ˆÁ7BFF“7&˜FF∑Fñ∆RÊ7&˜”∞¢6ˆÁ7Bw&˜wFÇ“÷FÇÊ÷ñ‚áFñ∆RÊ7&˜vRÚFFÊw&˜tFó2¬„ì∞¢6ˆÁ7B7W&eí“Fñ∆U7W&f6UíáFñ∆RÁGóRí≤Fñ∆RÁvFW"¢tDU%ıT‰ïC∞†¢ñbÑdÙƒîtUÙ5$ı2ÊÜ2áFñ∆RÊ7&˜íí∞¢ÚÚ)H)H&ˆ6VGW&¬fˆ∆ñvR÷W6Ç)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢6ˆÁ7B'V6∂WB“ˆw&˜wFÑ'V6∂WBÜw&˜wFÇì∞¢ñbÜ7&˜÷W6ÜW5∂ï“bb7&˜w&˜wFÑ'V6∂WE∂ï“”“'V6∂WBí∞¢ÚÚw&˜wFÇ7&˜76VBFá&W6Üˆ∆B(	B&V'Vñ∆B‡¢66VÊRÁ&V÷˜fRÜ7&˜÷W6ÜW5∂ï“ì∞¢7&˜÷W6ÜW5∂ï““ÁV∆√∞¢–¢ñbÇ7&˜÷W6ÜW5∂ï“í∞¢6ˆÁ7Bw&˜W“ˆ'Vñ∆Dfˆ∆ñvT÷W6ÇáFñ∆RÊ7&˜¬w&˜wFÇ¬6ˆ¬¬&˜rì∞¢ñbÜw&˜Wí∞¢66VÊRÊFBÜw&˜Wì∞¢ˆ÷&¥˜WF∆ñÊRÜw&˜Wì∞¢7&˜÷W6ÜW5∂ï““w&˜W∞¢7&˜w&˜wFÑ'V6∂WE∂ï““'V6∂WC∞¢–¢–¢6ˆÁ7B÷W6Ç“7&˜÷W6ÜW5∂ï”∞¢ñbÇ÷W6Çí6ˆÁFñÁVS∞†¢ÚÚ66∆S¢fˆ∆ñvRw&˜W&6Ró2Bì”¬w&˜w2µí&˜WB„RVÊóG2BgV∆¬‡¢ÚÚ÷FÚFÜR6÷Rfó7V¬&ÊvR2FÜRˆ∆B&˜ÇÉ„Ç‚„„CÇí‡¢6ˆÁ7B66∆R“5$ıÙ‘îÂı44ƒR≤Ñ5$ıÙ‘Öı44ƒR“5$ıÙ‘îÂı44ƒRí¢w&˜wFÉ∞¢÷W6ÇÁ66∆RÁ6WE66∆"á66∆Rì∞†¢6ˆÁ7B&ˆ%í“Fñ∆RÊ7&˜&VGíÚ÷FÇÁ6ñ‚ÖˆÊ˜rÚS≤6ˆ¬≤&˜rí¢„#R¢∞¢÷W6ÇÁ˜6óFñˆ‚Á6WBÜ6ˆ¬≤„R¬7W&eí≤„≤&ˆ%í¬&˜r≤„Rì∞¢ñbáFñ∆RÊ7&˜&VGíí÷W6ÇÁ&˜FFñˆ‚Áí“ˆÊ˜rÚ##≤6ˆ√∞†¢“V«6R∞¢ÚÚ)H)H6ñ◊∆R6ˆ∆˜&VB7V&RÜ∆¬˜FÜW"7&˜2í)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢6ˆÁ7B6ˆ∆˜'2“5$ıÙ4Ùƒı%5∑Fñ∆RÊ7&˜“«¬5$ıÙ4Ùƒı%2Êv&∆ñÊ≥∞¢6ˆÁ7B6ó¶R“5$ıÙ‘îÂı44ƒR≤Ñ5$ıÙ‘Öı44ƒR“5$ıÙ‘îÂı44ƒRí¢w&˜wFÉ∞¢6ˆÁ7B6ˆ∆˜"“Fñ∆RÊ7&˜&VGíÚ6ˆ∆˜'2Á&óP¢¢w&˜wFÇ¬„RÚ6ˆ∆˜'2Á7&˜W@¢¢6ˆ∆˜'2Ê&ˆGì∞†¢ñbÇ7&˜÷W6ÜW5∂ï“í∞¢6ˆÁ7BvVÚ“ÊWrDÖ$TR‰&˜ÑvVˆ÷WG'íÉ¬¬ì∞¢6ˆÁ7B÷B“ÊWrDÖ$TR‰÷W6Ñ∆÷&W'D÷FW&ñ¬á≤6ˆ∆˜"“ì∞¢6ˆÁ7B÷W6Ç“ÊWrDÖ$TR‰÷W6ÇÜvVÚ¬÷Bì∞¢÷W6ÇÊ67E6ÜF˜r“G'VS∞¢66VÊRÊFBÜ÷W6Çì∞¢÷W6ÇÊ∆ñW'2ÊVÊ&∆RÉì∞¢7&˜÷W6ÜW5∂ï““÷W6É∞¢–†¢6ˆÁ7B÷W6Ç“7&˜÷W6ÜW5∂ï”∞¢÷W6ÇÊ÷FW&ñ¬Ê6ˆ∆˜"Á6WDÜWÇÜ6ˆ∆˜"ì∞¢÷W6ÇÁ66∆RÁ6WE66∆"á6ó¶Rì∞¢6ˆÁ7B&ˆ%í“Fñ∆RÊ7&˜&VGíÚ÷FÇÁ6ñ‚ÖˆÊ˜rÚS≤6ˆ¬≤&˜rí¢„2¢∞¢÷W6ÇÁ˜6óFñˆ‚Á6WBÜ6ˆ¬≤„R¬7W&eí≤6ó¶RÚ"≤„"≤&ˆ%í¬&˜r≤„Rì∞¢ñbáFñ∆RÊ7&˜&VGíí÷W6ÇÁ&˜FFñˆ‚Áí“ˆÊ˜rÚ#≤6ˆ√∞¢–¢–¢–†¢ÚÚWFFR6ñÊv∆RFñ∆R÷W6ÇÜ6∆∆VBgFW"6Ü˜fV¬7FñˆÁ2ê¢gVÊ7Fñˆ‚ˆ'Vñ∆DˆÊUFñ∆T÷W6ÇÜ6ˆ¬¬&˜rí∞¢6ˆÁ7Bí“&˜r¢4Ù≈2≤6ˆ√∞¢6ˆÁ7BFñ∆R“w&ñE∑&˜u’∂6ˆ≈”∞¢6ˆÁ7B÷B“&W6ˆ«fUFñ∆T÷BÇvf&“r¬Fñ∆RÁGóRì∞†¢ñbáFñ∆RÁGóR””“Fñ∆UGóRÂ$Ù4≤í∞¢ÚÚf∆ˆ˜"6∆"(	Bw&726ÚóB&∆VÊG2vóFÇ7W'&˜VÊFñÊrFñ∆W0¢6ˆÁ7Bf∆ˆ˜$÷W6Ç“ÊWrDÖ$TR‰÷W6ÇÜ÷∂Tf∆ˆ˜$vVÚÜ6ˆ¬¬&˜rí¬&W6ˆ«fUFñ∆T÷BÇvf&“r¬Fñ∆UGóR‰u$52íì∞¢f∆ˆ˜$÷W6ÇÊ67E6ÜF˜r“f∆ˆ˜$÷W6ÇÁ&V6VófU6ÜF˜r“G'VS∞¢f∆ˆ˜$÷W6ÇÁ˜6óFñˆ‚Á6WBÜ6ˆ¬≤„R¬‰ı$‘≈ıDı“4ƒ%ÙÇÚ"¬&˜r≤„Rì∞¢66VÊRÊFBÜf∆ˆ˜$÷W6Çì∞¢Fñ∆T÷W6ÜW5∂ï““f∆ˆ˜$÷W6É∞¢ˆ÷&µFW'&ñ‰VFvTñBÜf∆ˆ˜$÷W6Ç¬Fñ∆UGóR‰u$52ì∞¢ÚÚ∆FVR÷˜VÊC¢7FˆÊRf˜"V∆WfFVBˆ6∆ñfb6V∆«2¬w&72f˜"w&˜VÊB÷∆WfV¬&6P¢6ˆÁ7B≤7FˆÊTvVÚ¬w&74vVÚ““'Vñ∆E&ˆ6µFñ∆TvVÚÜ6ˆ¬¬&˜rì∞¢∆WB÷˜VÊE&ˆ˜B“ÁV∆√∞¢ñbá7FˆÊTvVÚí∞¢6ˆÁ7B““ÊWrDÖ$TR‰÷W6Çá7FˆÊTvVÚ¬&W6ˆ«fUFñ∆T÷BÇvf&“r¬Fñ∆UGóRÂ$Ù4≤íì∞¢“Ê67E6ÜF˜r““Á&V6VófU6ÜF˜r“G'VS∞¢“Á˜6óFñˆ‚Á6WBÜ6ˆ¬≤„R¬‰ı$‘≈ıDı¬&˜r≤„Rì∞¢66VÊRÊFBÜ“ì∞¢ˆ÷&µFW'&ñ‰VFvTñBÜ“¬Fñ∆UGóRÂ$Ù4≤ì∞¢÷˜VÊE&ˆ˜B“”∞¢–¢ñbÜw&74vVÚí∞¢6ˆÁ7B““ÊWrDÖ$TR‰÷W6ÇÜw&74vVÚ¬&W6ˆ«fUFñ∆T÷BÇvf&“r¬Fñ∆UGóR‰u$52íì∞¢“Ê67E6ÜF˜r““Á&V6VófU6ÜF˜r“G'VS∞¢“Á˜6óFñˆ‚Á6WBÜ6ˆ¬≤„R¬‰ı$‘≈ıDı¬&˜r≤„Rì∞¢66VÊRÊFBÜ“ì∞¢ˆ÷&µFW'&ñ‰VFvTñBÜ“¬Fñ∆UGóR‰u$52ì∞¢ñbÇ÷˜VÊE&ˆ˜Bí÷˜VÊE&ˆ˜B“”∞¢–¢ñbÜ÷˜VÊE&ˆ˜Bí÷˜VÊE&ˆ˜BÂ˜vñÊD◊“≤ÚÚvñÊB∆ˆ˜6∂ó2˜vñÊD◊” ¢6WEfVtfˆ∆ñvT÷W6ÇÜí¬÷˜VÊE&ˆ˜B«¬≤˜vñÊD◊¢“ì∞¢ˆ÷&¥˜WF∆ñÊRÜ÷˜VÊE&ˆ˜Bì∞¢&WGW&„∞¢–†¢ñbáFñ∆RÁGóR””“Fñ∆UGóRÂ4Ö%T"bbvñÊF˜r‰fˆ∆ñvTvVÊW&F˜"í∞¢ÚÚw&72f∆ˆ˜"6∆"VÊFW&ÊVFÇFÜR6á'V ¢6ˆÁ7Bf∆ˆ˜$÷W6Ç“ÊWrDÖ$TR‰÷W6ÇÜ÷∂Tf∆ˆ˜$vVÚÜ6ˆ¬¬&˜rí¬fVtf∆ˆ˜$÷Bì∞¢f∆ˆ˜$÷W6ÇÊ67E6ÜF˜r“f∆ˆ˜$÷W6ÇÁ&V6VófU6ÜF˜r“G'VS∞¢f∆ˆ˜$÷W6ÇÁ˜6óFñˆ‚Á6WBÜ6ˆ¬≤„R¬Fñ∆Uî6VÁFW"ÖFñ∆UGóR‰u$52í¬&˜r≤„Rì∞¢66VÊRÊFBÜf∆ˆ˜$÷W6Çì∞¢Fñ∆T÷W6ÜW5∂ï““f∆ˆ˜$÷W6É∞¢ˆ÷&µFW'&ñ‰VFvTñBÜf∆ˆ˜$÷W6Ç¬Fñ∆UGóR‰u$52ì∞†¢6ˆÁ7BfVtw&˜W“vñÊF˜r‰fˆ∆ñvTvVÊW&F˜"Ê'Vñ∆E6á'V$÷W6ÇÜ6ˆ¬¬&˜rì∞¢fVtw&˜WÂ˜vñÊEÜ6R“Ü6ˆ¬¢„r≤&˜r¢"„2íRÑ÷FÇÂí¢"ì∞¢fVtw&˜WÂ˜vñÊD◊“„c∞¢fVtw&˜WÁ66∆RÁ6WBÉ"¬"¬"ì∞¢fVtw&˜WÁ˜6óFñˆ‚Á6WBÜ6ˆ¬≤„R¬Fñ∆U7W&f6UíáFñ∆RÁGóRí¬&˜r≤„Rì∞¢66VÊRÊFBáfVtw&˜Wì∞¢6WEfVtfˆ∆ñvT÷W6ÇÜí¬fVtw&˜Wì∞¢ˆ÷&¥˜WF∆ñÊRáfVtw&˜Wì∞¢&WGW&„∞¢–†¢ñbáFñ∆RÁGóR””“Fñ∆UGóRÂtTTE2í∞¢ÚÚw&72f∆ˆ˜"6∆"VÊFW&ÊVFÄ¢6ˆÁ7Bf∆ˆ˜$÷W6Ç“ÊWrDÖ$TR‰÷W6ÇÜ÷∂Tf∆ˆ˜$vVÚÜ6ˆ¬¬&˜rí¬fVtf∆ˆ˜$÷Bì∞¢f∆ˆ˜$÷W6ÇÊ67E6ÜF˜r“f∆ˆ˜$÷W6ÇÁ&V6VófU6ÜF˜r“G'VS∞¢f∆ˆ˜$÷W6ÇÁ˜6óFñˆ‚Á6WBÜ6ˆ¬≤„R¬Fñ∆Uî6VÁFW"ÖFñ∆UGóR‰u$52í¬&˜r≤„Rì∞¢66VÊRÊFBÜf∆ˆ˜$÷W6Çì∞¢Fñ∆T÷W6ÜW5∂ï““f∆ˆ˜$÷W6É∞¢ˆ÷&µFW'&ñ‰VFvTñBÜf∆ˆ˜$÷W6Ç¬Fñ∆UGóR‰u$52ì∞†¢ñbá5˜vVVC4BbbvñÊF˜r‰fˆ∆ñvTvVÊW&F˜"í∞¢ÚÚ÷ˆFR#¢&ˆ6VGW&¬4BvVVG2¬7V&¶V7BFÚ6ÜV∆¬˜WF∆ñÊP¢6ˆÁ7BfVtw&˜W“ÊWrDÖ$TR‰w&˜WÇì∞¢fVtw&˜WÁ˜6óFñˆ‚Á6WBÜ6ˆ¬≤„R¬Fñ∆U7W&f6UíáFñ∆RÁGóRí¬&˜r≤„Rì∞¢6ˆÁ7B&Êr“ˆ÷%&ÊrÇÇÜ6ˆ¬¢333r≤&˜r¢íí„„‚íì∞¢6ˆÁ7B6˜VÁB“2≤ÇÜ6ˆ¬¢r≤&˜r¢2íR2ì≤ÚÚ>(	3R∆ÁG0¢f˜"Ü∆WB“≤¬6˜VÁC≤≤≤í∞¢6ˆÁ7Bv““vñÊF˜r‰fˆ∆ñvTvVÊW&F˜"Ê'Vñ∆EvVVG4÷W6ÇÜ6ˆ¬¢S≤¬&˜r¢S≤ì∞¢ñbáv“í∞¢v“Á˜6óFñˆ‚Á6WBÇá&ÊrÇí“„Rí¢„Ç¬¬á&ÊrÇí“„Rí¢„Çì∞¢fVtw&˜WÊFBáv“ì∞¢–¢–¢fVtw&˜WÂ˜vñÊEÜ6R“Ü6ˆ¬¢„r≤&˜r¢"„2íRÑ÷FÇÂí¢"ì∞¢fVtw&˜WÂ˜vñÊD◊“„∞¢66VÊRÊFBáfVtw&˜Wì∞¢6WEfVtfˆ∆ñvT÷W6ÇÜí¬fVtw&˜Wì∞¢ˆ÷&¥˜WF∆ñÊRáfVtw&˜Wì∞¢–¢&WGW&„∞¢–†¢ñbáFñ∆RÁGóR””“Fñ∆UGóRÂE$T‰4Ç«¬Fñ∆RÁGóR””“Fñ∆UGóRÂ$ï4TBí∞¢6ˆÁ7B≤Fó'DvVÚ¬w&74vVÚ““'Vñ∆EFW'&ñÂFñ∆TvVÚÜ6ˆ¬¬&˜r¬Fñ∆RÁGóRì∞¢∆WB&ñ÷'í“ÁV∆√∞¢ñbÜFó'DvVÚí∞¢ÚÚ&˜FÇGóW2W6RG&VÊ6Ç'&˜v‚(	B&ó6VBV'FÇó2FÜR6÷RGVr◊6ˆñ¬6ˆ∆˜W ¢6ˆÁ7B““ÊWrDÖ$TR‰÷W6ÇÜFó'DvVÚ¬&W6ˆ«fUFñ∆T÷BÇvf&“r¬Fñ∆UGóRÂE$T‰4Çíì∞¢“Ê67E6ÜF˜r““Á&V6VófU6ÜF˜r“G'VS∞¢“Á˜6óFñˆ‚Á6WBÜ6ˆ¬≤„R¬‰ı$‘≈ıDı¬&˜r≤„Rì∞¢66VÊRÊFBÜ“ì∞¢“Ê∆ñW'2ÊVÊ&∆RÉì≤ÚÚ÷FW&ñ¬G&Á6óFñˆ‚˜WF∆ñÊP¢ˆ÷&µFW'&ñ‰VFvTñBÜ“¬Fñ∆UGóRÂE$T‰4Çì∞¢&ñ÷'í“”∞¢–¢ñbÜw&74vVÚí∞¢6ˆÁ7B““ÊWrDÖ$TR‰÷W6ÇÜw&74vVÚ¬&W6ˆ«fUFñ∆T÷BÇvf&“r¬Fñ∆UGóR‰u$52íì∞¢“Ê67E6ÜF˜r““Á&V6VófU6ÜF˜r“G'VS∞¢“Á˜6óFñˆ‚Á6WBÜ6ˆ¬≤„R¬‰ı$‘≈ıDı¬&˜r≤„Rì∞¢“Â˜vñÊD◊“∞¢66VÊRÊFBÜ“ì∞¢“Ê∆ñW'2ÊVÊ&∆RÉì≤ÚÚ÷FW&ñ¬G&Á6óFñˆ‚˜WF∆ñÊP¢ˆ÷&µFW'&ñ‰VFvTñBÜ“¬Fñ∆UGóR‰u$52ì∞¢6WEfVtfˆ∆ñvT÷W6ÇÜí¬“ì∞¢ñbÇ&ñ÷'íí&ñ÷'í“”∞¢–¢Fñ∆T÷W6ÜW5∂ï““&ñ÷'ì∞¢&WGW&„∞¢–†¢ñbáFñ∆RÁGóR””“Fñ∆UGóRÂDÇí∞¢6ˆÁ7B≤FÑvVÚ¬w&74vVÚ““'Vñ∆EFÖFñ∆TvVÚÜ6ˆ¬¬&˜rì∞¢∆WB&ñ÷'í“ÁV∆√∞¢ñbáFÑvVÚí∞¢ÚÚ&VwV∆"w&˜VÊBÜw&72íVÊFW"FÜRFÇ(	BFÜRfVB'&ñ6∞¢ÚÚ7W&f6Rá6VR%FÉ¢fVB'&ñ6≤7W&f6R"Ú&Vvó7FW%FÑ'&ñ6¥6áVÊ∑0¢ÚÚf˜"vf&“rí˜fW&∆ó2˜&FñÊ'íw&˜VÊB&FÜW"FÜ‚6W&FV«í–¢ÚÚ6ˆ∆˜&VBFÇF6Ç¬6÷RG&VF÷VÁB2FÜRF˜v‚FÇ‡¢6ˆÁ7B““ÊWrDÖ$TR‰÷W6ÇáFÑvVÚ¬&W6ˆ«fUFñ∆T÷BÇvf&“r¬Fñ∆UGóR‰u$52íì∞¢“Ê67E6ÜF˜r““Á&V6VófU6ÜF˜r“G'VS∞¢“Á˜6óFñˆ‚Á6WBÜ6ˆ¬≤„R¬‰ı$‘≈ıDı¬&˜r≤„Rì∞¢ˆ÷&µFW'&ñ‰VFvTñBÜ“¬Fñ∆UGóR‰u$52ì∞¢66VÊRÊFBÜ“ì∞¢&ñ÷'í“”∞¢–¢ñbÜw&74vVÚí∞¢6ˆÁ7B““ÊWrDÖ$TR‰÷W6ÇÜw&74vVÚ¬&W6ˆ«fUFñ∆T÷BÇvf&“r¬Fñ∆UGóR‰u$52íì∞¢“Ê67E6ÜF˜r““Á&V6VófU6ÜF˜r“G'VS∞¢“Á˜6óFñˆ‚Á6WBÜ6ˆ¬≤„R¬‰ı$‘≈ıDı¬&˜r≤„Rì∞¢66VÊRÊFBÜ“ì∞¢ˆ÷&µFW'&ñ‰VFvTñBÜ“¬Fñ∆UGóR‰u$52ì∞¢ñbÇ&ñ÷'íí&ñ÷'í“”∞¢–¢Fñ∆T÷W6ÜW5∂ï““&ñ÷'ì∞¢&WGW&„∞¢–†¢∆WB÷W6É∞¢ñbáFñ∆RÁGóR””“Fñ∆UGóRÂ4Ö%T"«¬Fñ∆RÁGóR””“Fñ∆UGóRÂtTTE2í∞¢ÚÚf∆∆&6≥¢fˆ∆ñvRvVÊW&F˜"Ê˜Bfñ∆&∆P¢6ˆÁ7BÜ6R“Ü6ˆ¬¢„r≤&˜r¢"„2íRÑ÷FÇÂí¢"ì∞¢6ˆÁ7B6ˆ∆˜"“Fñ∆RÁGóR””“Fñ∆UGóRÂ4Ö%T"ÚÉ3SfS3b¢É#Cv363∞¢÷W6Ç“ÊWrDÖ$TR‰÷W6ÇáfVtvVÚ¬÷∂UfVt÷FW&ñ¬Ü6ˆ∆˜"¬Ü6Ríì∞¢fVt÷W6ÜW2ÁW6ÇÜ÷W6Çì∞¢“V«6R∞¢÷W6Ç“ÊWrDÖ$TR‰÷W6ÇáFñ∆RÁGóR””“Fñ∆UGóRÂ$Ù4≤Ú&ˆ6¥vVÚ¢÷∂Tf∆ˆ˜$vVÚÜ6ˆ¬¬&˜rí¬÷Bì∞¢–¢÷W6ÇÊ67E6ÜF˜r“÷W6ÇÁ&V6VófU6ÜF˜r“G'VS∞¢÷W6ÇÁ˜6óFñˆ‚Á6WBÜ6ˆ¬≤„R¬Fñ∆Uî6VÁFW"áFñ∆RÁGóRí¬&˜r≤„Rì∞¢66VÊRÊFBÜ÷W6Çì∞¢Fñ∆T÷W6ÜW5∂ï““÷W6É∞¢ÚÚ&ˆ6≤ÊBf∆∆&6≤fVvWFFñˆ‚vWB˜WF∆ñÊW3≤f∆Bf∆ˆ˜"Fñ∆W2FÚÊ˜B‡¢ñbáFñ∆RÁGóR””“Fñ∆UGóRÂ$Ù4≤«¬Fñ∆RÁGóR””“Fñ∆UGóRÂ4Ö%T"«¬Fñ∆RÁGóR””“Fñ∆UGóRÂtTTE2í∞¢÷W6ÇÊ∆ñW'2ÊVÊ&∆RÉì∞¢“V«6R∞¢ÚÚf∆Bw&˜VÊBFñ∆W2Üw&72˜Fñ∆∆VB˜FGí˜&ófW"˜7G&V“&VBí(	Bf∆∆&6∞¢ÚÚfˆ∆ñvR&ñ∆∆&ˆ&G2&˜fR&R6∂óVB6ñÊ6RFÜWí&V‚wBf∆Bw&˜VÊB‡¢ˆ÷&µFW'&ñ‰VFvTñBÜ÷W6Ç¬˜FW'&ñ‰6FVv˜'îf˜"áFñ∆RÁGóRíì∞¢–¢–†¢gVÊ7Fñˆ‚'Vñ∆EFñ∆T÷W6ÜW2Çí∞¢f&’vFW$÷W6Ç“ˆFó7˜6T÷W&vVEvFW$÷W6Çá66VÊR¬f&’vFW$÷W6Ç¬vf&“GñÊ÷ñ2rì∞¢˜vFW%6ñ‘Fó'Gí“G'VS∞¢f˜"Ü∆WB&˜r“≤&˜r¬$ıu3≤&˜r≤≤í∞¢f˜"Ü∆WB6ˆ¬“≤6ˆ¬¬4Ù≈3≤6ˆ¬≤≤í∞¢6ˆÁ7Bí“&˜r¢4Ù≈2≤6ˆ√∞¢ñbáFñ∆T÷W6ÜW5∂ï“í≤66VÊRÁ&V÷˜fRáFñ∆T÷W6ÜW5∂ï“ì≤Fñ∆T÷W6ÜW5∂ï““ÁV∆√≤–¢ñbÜ7&˜÷W6ÜW5∂ï“í≤66VÊRÁ&V÷˜fRÜ7&˜÷W6ÜW5∂ï“ì≤7&˜÷W6ÜW5∂ï““ÁV∆√≤–¢ñbáfVtfˆ∆ñvT÷W6ÜW5∂ï“í≤66VÊRÁ&V÷˜fRáfVtfˆ∆ñvT÷W6ÜW5∂ï“ì≤6WEfVtfˆ∆ñvT÷W6ÇÜí¬ÁV∆¬ì≤–¢7&˜w&˜wFÑ'V6∂WE∂ï““”∞¢ˆ'Vñ∆DˆÊUFñ∆T÷W6ÇÜ6ˆ¬¬&˜rì∞¢–¢–¢˜&V'Vñ∆Df&‘&ñ∆∆&ˆ&G2Çì∞¢–†¢ÚÚWFFR6ñÊv∆RFñ∆R÷W6ÇÜ6∆∆VBgFW"6Ü˜fV¬7FñˆÁ2ê¢gVÊ7Fñˆ‚&Vg&W6ÖFñ∆T÷W6ÇÜ6ˆ¬¬&˜rí∞¢6ˆÁ7Bí“&˜r¢4Ù≈2≤6ˆ√∞¢ñbáFñ∆T÷W6ÜW5∂ï“í≤66VÊRÁ&V÷˜fRáFñ∆T÷W6ÜW5∂ï“ì≤Fñ∆T÷W6ÜW5∂ï““ÁV∆√≤–¢ñbÜ7&˜÷W6ÜW5∂ï“í≤66VÊRÁ&V÷˜fRÜ7&˜÷W6ÜW5∂ï“ì≤7&˜÷W6ÜW5∂ï““ÁV∆√≤–¢ñbáfVtfˆ∆ñvT÷W6ÜW5∂ï“í≤66VÊRÁ&V÷˜fRáfVtfˆ∆ñvT÷W6ÜW5∂ï“ì≤6WEfVtfˆ∆ñvT÷W6ÇÜí¬ÁV∆¬ì≤–¢7&˜w&˜wFÑ'V6∂WE∂ï““”∞¢ˆ'Vñ∆DˆÊUFñ∆T÷W6ÇÜ6ˆ¬¬&˜rì∞¢˜&V'Vñ∆Df&‘&ñ∆∆&ˆ&G2Çì∞¢–†¢ÚÚ)H)HWFFR÷W&vVBvFW"7W&f6W2V6Çg&÷R)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢ÚÚFÜR6ñ◊V∆Fñˆ‚&V÷ñÁ2W"◊Fñ∆Rw&ñB‚FÜó26ˆ∆∆V7F˜"G&Á6∆FW2óG0¢ÚÚ7W'&VÁB7FFRñÁFÚˆÊR&F6ÇˆbÜVñváBˆFWFÇˆf∆˜rfW'Fñ6W2ˆÊ«ívÜV‚¢ÚÚ6ñ“Fñ6≤÷&∑2FÜR&VFó'Gì≤FÜR&VÊFW"f7BFÇ÷W&V«íGfÊ6W2FÜP¢ÚÚ6Ü&VBFWáGW&RVÊñf˜&“‡¢gVÊ7Fñˆ‚ˆ6ˆ∆∆V7DGñÊ÷ñ5vFW$6V∆«2áF&vWDw&ñB¬&˜w2¬6ˆ«2¬6∂óW&÷ÊVÁEvFW"í∞¢6ˆÁ7B6V∆«2“µ”≤ÚÚW6VB'íˆ'Vñ∆D÷W&vVEvFW$÷W6Çf˜"ˆÊR6ñ◊V∆Fñˆ‚6Ê6Ü˜B‡¢6ˆÁ7Bf∆˜vñÊuG&VÊ6ÜW2“µ”≤ÚÚW6VB'ívVFÜW$eÇw2G&VÊ6Ç'Fñ6∆RV÷óGFW"‡¢f˜"Ü∆WB&˜r“≤&˜r¬&˜w3≤&˜r≤≤í∞¢f˜"Ü∆WB6ˆ¬“≤6ˆ¬¬6ˆ«3≤6ˆ¬≤≤í∞¢6ˆÁ7BFñ∆R“F&vWDw&ñE∑&˜u’∂6ˆ≈”∞¢ñbÜó56ˆ∆ñBáFñ∆RÁGóRí«¬Fñ∆RÁvFW"¬„0¢«¬á6∂óW&÷ÊVÁEvFW"bbáFñ∆RÁGóR””“Fñ∆UGóRÂ$ïdU"«¬Fñ∆RÁGóR””“Fñ∆UGóRÂ5E$T“ííí∞¢Fñ∆RÂ˜t66ÜVB“f«6S∞¢6ˆÁFñÁVS∞¢–†¢ñbáFñ∆RÁGóR””“Fñ∆UGóRÂE$T‰4ÇbbFñ∆RÊf∆˜ríf∆˜vñÊuG&VÊ6ÜW2ÁW6Çá≤6ˆ¬¬&˜r“ì∞¢6ˆÁ7BFWFÑg&2“Fñ∆RÁvFW"Ú‘ÖıtDU#∞¢6ˆÁ7B7W&f6T“Fñ∆U7W&f6UíáFñ∆RÁGóRí≤Fñ∆RÁvFW"¢tDU%ıT‰ïC∞¢∆WBgÇ“¬g¢“∞¢f˜"Ü6ˆÁ7B≤F2¬G"¬Ç¬¢“ˆb∞¢≤F3¢¬G#¢¬É¢¬£¢“¿¢≤F3¢¬G#¢”¬É¢¬£¢”“¿¢≤F3¢¬G#¢¬É¢¬£¢“¿¢≤F3¢”¬G#¢¬É¢”¬£¢“¿¢“í∞¢6ˆÁ7BÊ2“6ˆ¬≤F2¬Á"“&˜r≤G#∞¢ñbÜÊ2¬«¬Ê2„“6ˆ«2«¬Á"¬«¬Á"„“&˜w2í6ˆÁFñÁVS∞¢6ˆÁ7BÊVñvÜ&˜"“F&vWDw&ñE∂Á%’∂Ê5”∞¢ñbÜó56ˆ∆ñBÜÊVñvÜ&˜"ÁGóRíí6ˆÁFñÁVS∞¢6ˆÁ7B7W&f6T"“Fñ∆U7W&f6UíÜÊVñvÜ&˜"ÁGóRí≤ÊVñvÜ&˜"ÁvFW"¢tDU%ıT‰ïC∞¢6ˆÁ7BÜVB“7W&f6T“7W&f6T#∞¢ñbÜÜVB‚„í≤gÇ≥“Ç¢ÜVC≤g¢≥“¢¢ÜVC≤–¢–¢6ˆÁ7Bf∆˜t∆VÊwFÇ“÷FÇÊáó˜BÜgÇ¬g¢ì∞¢6ˆÁ7Bf∆˜uÇ“f∆˜t∆VÊwFÇ‚„ÚgÇÚf∆˜t∆VÊwFÇ¢∞¢6ˆÁ7Bf∆˜u¢“f∆˜t∆VÊwFÇ‚„Úg¢Úf∆˜t∆VÊwFÇ¢∞¢Fñ∆RÂ˜t66ÜVB“G'VS∞¢Fñ∆RÂ˜u7W&d“7W&f6T∞¢Fñ∆RÂ˜tFWFÇ“FWFÑg&3∞¢Fñ∆RÂ˜tf∆˜tÂÇ“f∆˜uÉ∞¢Fñ∆RÂ˜tf∆˜tÂ¢“f∆˜u£∞¢6V∆«2ÁW6Çá≤6ˆ¬¬&˜r¬7W&f6Uì¢7W&f6T¬FWFÉ¢FWFÑg&2¬f∆˜uÇ¬f∆˜u¢“ì∞¢–¢–¢&WGW&‚≤6V∆«2¬f∆˜vñÊuG&VÊ6ÜW2”∞¢–†¢ÚÚFÜR6Ü∆∆˜rFV6˜&FófRVFF∆R&ˆ‚ó2«6ÚˆÊR÷W&vVBG&r6∆¬‚óG0¢ÚÚv˜&∆B◊76RUg2∂VWFÜRFñ∆VB‰r6ˆÁFñÁV˜W27&˜72FÜR∆ñ&∆R÷w&ñ@¢ÚÚ6V“vóFÜ˜WB÷∂ñÊr6W&FRFWáGW&RñÁ7FÊ6Rf˜"FÜR&ˆ‚‡¢gVÊ7Fñˆ‚ˆ'Vñ∆Df$VñfW$&ˆ‚Ü6ˆ«2¬6V’&˜r¬6˜WFÑ∆WfV¬¬66VÊTˆ&¢¬7FD∂Wíí∞¢6ˆÁ7B6V∆«2“µ”≤ÚÚW6VB'íFÜR6Ü&VB÷W&vVB◊vFW"vVˆ÷WG'í'Vñ∆FW"&V∆˜r‡¢f˜"Ü∆WB6ˆ¬“≤6ˆ¬¬6ˆ«3≤6ˆ¬≤≤í∞¢6ˆÁ7B∆WfV¬“6˜WFÑ∆WfV≈∂6ˆ≈”∞¢f˜"Ü∆WBB“≤B¬d%Ù$ÙÂı$ıu3≤B≤≤í∞¢6ˆÁ7BFWFÑg&2“∆WfV¬¢÷FÇÁ˜rÑd%Ù$ÙÂÙdƒƒÙdb¬Bì∞¢ñbÜFWFÑg&2¬„"í6ˆÁFñÁVS∞¢6ˆÁ7B7W&f6T“‰ı$‘≈ıDı≤FWFÑg&2¢tDU%ıT‰ïC∞¢6V∆«2ÁW6Çá≤6ˆ¬¬&˜s¢6V’&˜r≤B¬7W&f6Uì¢7W&f6T¬FWFÉ¢FWFÑg&2¬f∆˜uÉ¢¬f∆˜u£¢“ì∞¢–¢–¢&WGW&‚ˆ'Vñ∆D÷W&vVEvFW$÷W6Çá66VÊTˆ&¢¬6V∆«2¬∞¢Ê÷S¢7FD∂WíÁ&W∆6RÇı«2≤ˆr¬uÚrí≤uˆ÷W6Çr¬7FD∂Wí¿¢“ì∞¢–†¢gVÊ7Fñˆ‚WFFUvFW$÷W6ÜW2Çí∞¢vFW%Fñ÷R≥“„c≤ÚÚ„cg267V◊V∆Fñˆ„≤÷F6ÜW2fó7V¬7VVB&Vv&F∆W72ˆbg&÷R&FP†¢ñbÖ˜vFW%6ñ‘Fó'Gíí∞¢˜vFW%6ñ‘Fó'Gí“f«6S∞¢6ˆÁ7B6Ê6Ü˜B“ˆ6ˆ∆∆V7DGñÊ÷ñ5vFW$6V∆«2Üw&ñB¬$ıu2¬4Ù≈2¬f«6Rì∞¢ˆf∆˜vñÊuG&VÊ6ÖFñ∆W2“6Ê6Ü˜BÊf∆˜vñÊuG&VÊ6ÜW3∞¢f&’vFW$÷W6Ç“ˆFó7˜6T÷W&vVEvFW$÷W6Çá66VÊR¬f&’vFW$÷W6Ç¬vf&“GñÊ÷ñ2rì∞¢f&’vFW$÷W6Ç“ˆ'Vñ∆D÷W&vVEvFW$÷W6Çá66VÊR¬6Ê6Ü˜BÊ6V∆«2¬∞¢Ê÷S¢vf&’ˆ÷W&vVEˆGñÊ÷ñ5˜vFW"r¬7FD∂Wì¢vf&“GñÊ÷ñ2r¿¢“ì∞¢f&‘f$VñfW$÷W6Ç“ˆFó7˜6T÷W&vVEvFW$÷W6Çá66VÊR¬f&‘f$VñfW$÷W6Ç¬vf&“6˜WFÇ&ˆ‚rì∞¢f&‘f$VñfW$÷W6Ç“ˆ'Vñ∆Df$VñfW$&ˆ‚Ñ4Ù≈2¬$ıu2¬f%6˜WFÑ∆WfV¬¬66VÊR¬vf&“6˜WFÇ&ˆ‚rì∞¢–¢÷W&vVEvFW$÷FW&ñ¬ÁVÊñf˜&◊2ÁUFñ÷RÁf«VR“vFW%Fñ÷S∞¢–†¢ÚÚ6÷R2WFFUvFW$÷W6ÜW2Çí'WBf˜"FÜRF˜v‚w2FóF6ÇÖE$T‰4ÇíFñ∆W2¿¢ÚÚ6ÚF˜v‚vVFÜW"6‚fñ∆¬FÜV“vóFÇvFW"WÜ7F«í∆ñ∂Rf&“G&VÊ6ÜW2‡¢gVÊ7Fñˆ‚WFFUF˜vÂvFW$÷W6ÜW2Çí∞¢vFW%Fñ÷R≥“„c∞¢6ˆÁ7BD4Ù≈2“˜F˜vÂ¶ˆÊSÚÊ6ˆ«2«¬c¬E$ıu2“˜F˜vÂ¶ˆÊSÚÁ&˜w2«¬S∞†¢ñbÖ˜F˜vÂvFW%6ñ‘Fó'Gíí∞¢˜F˜vÂvFW%6ñ‘Fó'Gí“f«6S∞¢6ˆÁ7B6Ê6Ü˜B“ˆ6ˆ∆∆V7DGñÊ÷ñ5vFW$6V∆«2áF˜v‰w&ñB¬E$ıu2¬D4Ù≈2¬G'VRì∞¢˜F˜v‰f∆˜vñÊuG&VÊ6ÖFñ∆W2“6Ê6Ü˜BÊf∆˜vñÊuG&VÊ6ÜW3∞¢F˜vÂvFW$÷W6Ç“ˆFó7˜6T÷W&vVEvFW$÷W6ÇáF˜vÂ66VÊR¬F˜vÂvFW$÷W6Ç¬wF˜v‚GñÊ÷ñ2rì∞¢F˜vÂvFW$÷W6Ç“ˆ'Vñ∆D÷W&vVEvFW$÷W6ÇáF˜vÂ66VÊR¬6Ê6Ü˜BÊ6V∆«2¬∞¢Ê÷S¢wF˜vÂˆ÷W&vVEˆGñÊ÷ñ5˜vFW"r¬7FD∂Wì¢wF˜v‚GñÊ÷ñ2r¿¢“ì∞¢F˜v‰f$VñfW$÷W6Ç“ˆFó7˜6T÷W&vVEvFW$÷W6ÇáF˜vÂ66VÊR¬F˜v‰f$VñfW$÷W6Ç¬wF˜v‚6˜WFÇ&ˆ‚rì∞¢F˜v‰f$VñfW$÷W6Ç“ˆ'Vñ∆Df$VñfW$&ˆ‚ÖD4Ù≈2¬E$ıu2¬F˜vÂ6˜WFÑ∆WfV¬¬F˜vÂ66VÊR¬wF˜v‚6˜WFÇ&ˆ‚rì∞¢–¢÷W&vVEvFW$÷FW&ñ¬ÁVÊñf˜&◊2ÁUFñ÷RÁf«VR“vFW%Fñ÷S∞¢–†¢ÚÚÊñ÷FW2¶ˆÊRw2vFW&f∆¬7W'Fñ‚÷W6ÇÜW2íá6VP¢ÚÚ'Vñ∆EvFW&f∆ƒ7W'Fñ‰÷W6ÜW2í(	BFÜW&Rw2ÊÚW"◊Fñ∆RGñÊ÷ñ2vFW"6ñ–¢ÚÚÜW&R∆ñ∂RWFFUF˜vÂvFW$÷W6ÜW2˜WFFUvFW$÷W6ÜW2¬ßW7BFÜRUFñ÷P¢ÚÚVÊñf˜&“G&ófñÊrFÜR6ÜFW"w267&ˆ∆¬˜&ó∆R¬6ÚFÜó2ó2FÜñ‚∆ˆ˜‡¢gVÊ7Fñˆ‚WFFU¶ˆÊUvFW$÷W6ÜW2Ü÷ñBí∞¢vFW%Fñ÷R≥“„c∞¢6ˆÁ7B÷W6ÜW2“˜¶ˆÊUvFW$÷W6ÜW2ÊvWBÜ÷ñBì∞¢ñbÇ÷W6ÜW2í&WGW&„∞¢f˜"Ü6ˆÁ7Bv“ˆb÷W6ÜW2í∞¢ñbáv“Ê÷FW&ñ¬””“÷W&vVEvFW$÷FW&ñ¬í6ˆÁFñÁVS∞¢ñbáv“Ê÷FW&ñ¬ÁVÊñf˜&◊3ÚÁUFñ÷Rív“Ê÷FW&ñ¬ÁVÊñf˜&◊2ÁUFñ÷RÁf«VR“vFW%Fñ÷S∞¢–¢÷W&vVEvFW$÷FW&ñ¬ÁVÊñf˜&◊2ÁUFñ÷RÁf«VR“vFW%Fñ÷S∞¢–†¢ÚÚ)H)HWFFR∆ñW"7V&R)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢gVÊ7Fñˆ‚WFFU∆ñW$÷W6ÇÜGBí∞¢ÚÚ÷˜VÁB&ñFR7FFRÊ˜r∆ófW2ñ‚ß2ˆ÷˜VÁB◊7ó7FV“Êß2ávñÊF˜r‰÷˜VÁG2í(	@¢ÚÚ6ÜF˜vVB∆ˆ6∆«í6ÚFÜR&W7BˆbFÜó2gVÊ7Fñˆ‚á˜7GW&R˜&˜FFñˆ‡¢ÚÚ&VG2&V∆˜ríFˆW6‚wBÊVVBFÚ6ÜÊvR‡¢6ˆÁ7B÷˜VÁE&ñFU7FFR“vñÊF˜r‰÷˜VÁG3ÚÁ&ñFU7FFRÛÚvÊˆÊRs∞¢6ˆÁ7B÷˜VÁE&ñFTVÁFóGí“vñÊF˜r‰÷˜VÁG3ÚÁ&ñFTVÁFóGíÛÚÁV∆√∞¢ÚÚ6ˆÁfW'B$Bw&ñB6ˆ˜&G2FÚ4Bv˜&∆B6ˆ˜&G0¢6ˆÁ7BwÇ“∆ñW"ÁÇÚDîƒS≤ÚÚv˜&∆BÇÜ6ˆ¬ê¢6ˆÁ7Bw¢“∆ñW"ÁíÚDîƒS≤ÚÚv˜&∆B¢á&˜rê¢6ˆÁ7B6ˆ¬“6∆◊Ñ÷FÇÊf∆ˆ˜"áwÇí¬¬vWD7FófT6ˆ«2Çí”ì∞¢6ˆÁ7B&˜r“6∆◊Ñ÷FÇÊf∆ˆ˜"áw¢í¬¬vWD7FófU&˜w2Çí”ì∞¢6ˆÁ7BFñ∆R“vWD7FófUFñ∆TBÜ6ˆ¬¬&˜rì∞¢ÚÚvÜñ∆R6∆ñ÷&ñÊr¬FÜR∆ñW"ó2÷ñB÷7&˜76ñÊrFá&˜VvÇñ◊76&∆P¢ÚÚñÊ6∆ñÊRFñ∆W2(	BW6RFÜR67&óFVB7F'B”Ê∆ÊFñÊr&∆VÊBg&ˆ–¢ÚÚWFFT6∆ñ÷"ñÁ7FVBˆb&rFñ∆R∆ˆˆ∑W¬vÜñ6Çv˜V∆B˜&WGvVV‡¢ÚÚFÜR6∆ñfb&6RÊB∆FVRF˜FÜRñÁ7FÁBFÜR7&˜76ñÊrFñ∆P¢ÚÚf∆ó2á6VR7F'D6∆ñ÷"˜WFFT6∆ñ÷"í‡¢6ˆÁ7B7FÊEí“∆ñW"Ê6∆ñ÷&ñÊrÚ∆ñW"Ê6∆ñ÷%7W&f6Uê¢¢Öˆó5¶ˆÊT&VÜ7W'&VÁD&VíÚ7W&f6UîEv˜&∆BÜ7W'&VÁD&V¬wÇ¬w¢í¢Fñ∆U7W&f6Uîñ‰&VáFñ∆R¬7W'&VÁD&Víì∞†¢ÚÚ&ñFñÊr÷˜VÁB∆ñgG2FÜR&ñFW"W6ÚFÜVó"˜7FW&ñ˜"Ê6Ü˜ ¢ÚÚ6ˆñÊ6ñFW2vóFÇFÜR÷˜VÁBw26FF∆RÊ6Ü˜"á6VP¢ÚÚ∆ñW$GF6Ü÷VÁDÊ6Ü˜%íˆ7&VGW&TGF6Ü÷VÁDÊ6Ü˜%í&˜fRí(	BFÜP¢ÚÚñÁ7FÁBFÜW&Rw2ÊÚ÷˜VÁBFÚ6óBˆ‚¬6ÚFó6÷˜VÁFñÊrˆÊÚ÷÷˜VÁB∆ê¢ÚÚó26ˆ◊∆WFV«íVÊffV7FVB‡¢∆WB÷˜VÁE6VD∆ñgB“∞¢ñbÜ÷˜VÁE&ñFTVÁFóGíbb÷˜VÁE&ñFU7FFR”“w'W6ÜñÊtñ‚rbb÷˜VÁE&ñFU7FFR”“w'W6ÜñÊt˜WBrí∞¢6ˆÁ7B6FF∆Uí“7&VGW&TGF6Ü÷VÁDÊ6Ü˜%íÜ÷˜VÁE&ñFTVÁFóGíÊ7&VGW&T∂Wí¬w6FF∆Rr¬÷˜VÁE&ñFTVÁFóGíÊvVÊ˜GóRì∞¢6ˆÁ7B˜7FW&ñ˜%í“∆ñW$GF6Ü÷VÁDÊ6Ü˜%íÇw˜7FW&ñ˜"rì∞¢ÚÚ˜7FW&ñ˜%íó2f∆ˆ˜"◊&V∆FófRá6VRFÜR6Ü˜V∆FW"◊WB∆ñgB6ˆ÷÷VÁ@¢ÚÚñ‚WFFT6ˆ◊ÊñˆÁ2í(	BÊÚ6W&FRfF$ÜVñváBÛ"FW&“&V∆ˆÊw0¢ÚÚÜW&R¬6÷R2∆ñW%Fˆˆƒ&6Uíw2˜v‚W6vRV«6WvÜW&R‡¢÷˜VÁE6VD∆ñgB“á6FF∆Uí“ÁV∆¬bb˜7FW&ñ˜%í“ÁV∆¬ê¢ÚÜ÷˜VÁE&ñFTVÁFóGíÊÜ∆dÜVñváB≤6FF∆Uíí“˜7FW&ñ˜%ê¢¢‘ıTÂEı4DDƒUıU$4TÂEÙdƒƒ$4≤¢Ü÷˜VÁE&ñFTVÁFóGíÊÜ∆dÜVñváB¢"ì∞¢–†¢ÚÚ6ñÊ∑2FÜRvÜˆ∆RfF"F˜v‚F˜v&B6Üó"◊6VBÜVñváBvÜñ∆R6óGFñÊp¢ÚÚÜ÷ó'&˜'2÷˜VÁE6VD∆ñgBßW7B&˜fR¬ÊVvFófRñÁ7FVBˆb˜6óFófRí(	@¢ÚÚFÜR6VFVB∆Vr˜6Rá6VR6VFVE˜6R&V∆˜rí&VÊG2FÜR∂ÊVW2¬'W@¢ÚÚvóFÜ˜WBFÜó2FÜRF˜'6Ú7&óFRv˜V∆B7Fñ∆¬f∆ˆBBgV∆¬7FÊFñÊp¢ÚÚÜVñváB&˜fRFÜR6Üó"‚FW&ófVBg&ˆ“FÜR7GV¬6VBÊ6Ü˜"w0¢ÚÚÜVñváBg2‚FÜR∆ñW"w2˜v‚7FÊFñÊr˜7FW&ñ˜"Ê6Ü˜"¬6÷P¢ÚÚf˜&◊V∆6ÜR2÷˜VÁE6VD∆ñgB¬6ÚFñffW&VÁB6Üó"˜7Fˆˆ¬ÜVñváG0¢ÚÚ6ñÊ≤6˜'&V7F«íñÁ7FVBˆbˆÊRfóÜVBwVW72‡¢∆WB6Üó%6VE6ñÊ≤“∞¢ñbá6óDñÁFW&7Fñˆ‚bb6óDñÁFW&7Fñˆ‚ÁÜ6R”“v˜WBrí∞¢6ˆÁ7B7FÊFñÊu˜7FW&ñ˜%í“∆ñW$GF6Ü÷VÁDÊ6Ü˜%íÇw˜7FW&ñ˜"rì∞¢6Üó%6VE6ñÊ≤“7FÊFñÊu˜7FW&ñ˜%í“ÁV∆¿¢ÚÑÁV÷&W"á6óDñÁFW&7Fñˆ‚Á6VEv˜&∆Eíí«¬í“7FÊFñÊu˜7FW&ñ˜%ê¢¢”„3#≤ÚÚf∆∆&6≤ñbFÜR∆ñW"w2˜v‚˜7FW&ñ˜"Ê6Ü˜"ó6‚wB&W6ˆ«f&∆RñW@¢–†¢ÚÚ6÷ˆ˜FÇfW'Fñ6¬˜6óFñˆ‚Ü&ˆ"˜fW"vFW"¬«W26ˆ÷&B«VÊvRw0¢ÚÚ6˜6÷WFñ2∆V&2(	B6VR&Vvñ‰6ˆ÷&D«VÊvR˜∆ñW"Ê«VÊvTÜ˜7W'&VÁB(	@¢ÚÚ˜"6∆ñ÷&ñÊrÜ˜w2&˜VÊ6R¬6VR∆ñW"Ê6∆ñ÷$Ü˜&˜VÊ6Rê¢6ˆÁ7BF&vWEí“7FÊEí≤áFñ∆RÁvFW"‚„RÚFñ∆RÁvFW"¢tDU%ıT‰ïB¢„b¢í≤á∆ñW"Ê«VÊvTÜ˜7W'&VÁB«¬í≤á∆ñW"Ê6∆ñ÷$Ü˜&˜VÊ6R«¬í≤÷˜VÁE6VD∆ñgB≤6Üó%6VE6ñÊ≥∞¢∆ñW$÷W6ÇÁ˜6óFñˆ‚ÁÇ≥“áwÇ“∆ñW$÷W6ÇÁ˜6óFñˆ‚ÁÇí¢„#S∞¢∆ñW$÷W6ÇÁ˜6óFñˆ‚Á¢≥“áw¢“∆ñW$÷W6ÇÁ˜6óFñˆ‚Á¢í¢„#S∞¢∆ñW$÷W6ÇÁ˜6óFñˆ‚Áí≥“áF&vWEí“∆ñW$÷W6ÇÁ˜6óFñˆ‚Áíí¢„É∞¢∆ñW$w&˜VÊE6ÜF˜rÁ˜6óFñˆ‚Á6WBá∆ñW$÷W6ÇÁ˜6óFñˆ‚ÁÇ¬7FÊEí≤6Ü&7FW$w&˜VÊE6ÜF˜u7W&f6Tˆfg6WBÇí¬∆ñW$÷W6ÇÁ˜6óFñˆ‚Á¢ì∞¢ÚÚw&˜VÊB◊&ˆ¶V7FVBÜV«FÇı7F÷ñÊ&ñÊrÖTB(	B&W∆6W2FÜRf∆@¢ÚÚfóF«2&"á6VR7fóF«4&"ñ‚7Gñ∆RÊ772í‚6óG2ßW7B&˜fRFÜP¢ÚÚw&˜VÊB6ÜF˜r¬G&6∂ñÊrFÜR6÷R6÷ˆ˜FÜVBÖ¢‚W6W2FÜR7GV∆«ê¢ÚÚ7FófR66VÊRÜf&“˜F˜v‚ˆñÁFW&ñ˜"˜¶ˆÊRˆ'Vñ∆FñÊrí¬Ê˜BFÜR&6P¢ÚÚf&“66VÊV(	BFÜR∆ñW"÷W6ÇóG6V∆bvWG2&W&VÁFVB&WGvVV‡¢ÚÚFÜ˜6R2FÜR∆ñW"G&fV«2á6VRRÊr‚FÜRG&Á6óFñˆ‚◊7˜B6ˆFP¢ÚÚ&˜VÊBg&ˆ’66VÊRÁ&V÷˜fRá∆ñW$÷W6Çí˜Fı66VÊRÊFBá∆ñW$÷W6Çíí¬6¢ÚÚÜ&F6ˆFñÊr66VÊVÜW&R∆VgBFÜR&ñÊr&VÁFVBñÁFÚ66VÊRFÜ@¢ÚÚv6‚wBFÜRˆÊR7GV∆«í&VñÊr&VÊFW&VB‡¢ñbávñÊF˜rÂ&W6˜W&6U&ñÊw2í∞¢6ˆÁ7B&ñÊtáVB“vñÊF˜rÂ&W6˜W&6U&ñÊw2ÁWFFU&ñÊtáVBá∆ñW"¬vWD7FófU66VÊRÇí¬„c"ì∞¢&ñÊtáVBÁ˜6óFñˆ‚Á6WBá∆ñW$÷W6ÇÁ˜6óFñˆ‚ÁÇ¬7FÊEí≤6Ü&7FW$w&˜VÊE6ÜF˜u7W&f6Tˆfg6WBÇí¬∆ñW$÷W6ÇÁ˜6óFñˆ‚Á¢ì∞¢–†¢ÚÚ&˜FFRFÚf6R÷˜fV÷VÁBFó&V7Fñˆ‚vóFÇW'6∆◊ÜFVB¶ˆÊR+\+g&ˆ“V7B˜vW7Bí‡¢ÚÚ6∂óVBGW&ñÊrFÜRfó6Ç÷6F6ÇfñWs¢&Vvñ‰fó6Ñ6F6ÖfñWrñÁ2∆ñW$f6ñÊrFÚf6P¢ÚÚFÜR6÷W&¬ÊBFÜó2&V6ˆ◊WFR'VÁ2WfW'íg&÷R&Vv&F∆W72ˆbfó6ÜñÊr7FFR¬6¢ÚÚvóFÜ˜WBFÜRwV&BóBf˜VváBFÜBÊB7V‚FÜR6Ü&7FW"&6≤&˜VÊBñ÷÷VFñFV«í‡¢ñbávñÊF˜r‰fó6ÜñÊsÚÁ7FFSÚÁÜ6R””“v6VváBrí∞¢∆ñW$÷W6ÇÁ&˜FFñˆ‚Áí“∆ñW$f6ñÊs∞¢ñbá∆ñW$∆Vw3ÚÊw&˜Wí∆ñW$∆Vw2Êw&˜WÁ&˜FFñˆ‚Áí“∞¢“V«6Rñbá6óDñÁFW&7Fñˆ‚bb6óDñÁFW&7Fñˆ‚ÁÜ6R”“v˜WBrí∞¢ÚÚ6VFVC¢FÜR&ˆGí7Fó2ñÊÊVBFÚFÜR6Üó"w2˜v‚f6ñÊr(	BÊ¢ÚÚW'6∆◊ˆFVB◊¶ˆÊRG&6∂ñÊrˆbFÜR6÷W&B∆¬áVÊ∆ñ∂RFÜP¢ÚÚvVÊW&¬'&Ê6Ç&V∆˜rí¬6ñÊ6RFÜR6÷W&6‚g&VV«í˜&&óB∆¿¢ÚÚFÜRví&˜VÊBvÜñ∆R6VFVBÊBFVB¶ˆÊRFÜBw2∆∆˜vVBF¢ÚÚ6Ü6R6ˆÁFñÁV˜W6«í◊&˜FFñÊr6÷W&v˜V∆BG&rFÜRvÜˆ∆R&ˆGê¢ÚÚ&˜VÊBvóFÇóB‚ˆÊ«íFÜRÜVBó2÷VÁBFÚGW&‚2FÜR6÷W&¢ÚÚ÷˜fW2á6VRWFFU6óDñÁFW&7Fñˆ‚w2ÊV6≤÷&ˆÊRG&6∂ñÊrí(	BñÊÊñÊp¢ÚÚFÜR&ˆGíÜW&Ró2vÜB÷∂W2FÜB&6÷W&FˆW6‚wB&˜FFRñ˜W ¢ÚÚ&ˆGí"6ˆÁG&7B7GV∆«íÜˆ∆B‡¢∆ñW$f6ñÊr“÷f6ñÊtÊv∆R≤÷FÇÂíÚ#∞¢∆ñW$÷W6ÇÁ&˜FFñˆ‚Áí“∆ñW$f6ñÊs∞¢ñbá∆ñW$∆Vw3ÚÊw&˜Wí∆ñW$∆Vw2Êw&˜WÁ&˜FFñˆ‚Áí“∞¢“V«6RñbÜ÷˜VÁE&ñFTVÁFóGíbb÷˜VÁE&ñFU7FFR”“w'W6ÜñÊtñ‚rbb÷˜VÁE&ñFU7FFR”“w'W6ÜñÊt˜WBrí∞¢ÚÚv«VVBFÚ÷˜VÁBá6÷RwV&B2÷˜VÁE6VD∆ñgB&˜fRì¢G&6≤FÜP¢ÚÚ÷˜VÁBw2˜v‚‰r◊∆ÊR&˜FFñˆ‚Ü2ÁÊu&˜B¬∂WB7W'&VÁBWfW'ê¢ÚÚg&÷R'íWFFT7&VGW&T÷W6Ç(	B6VRWFFT÷˜VÁE&ñFRíñÁ7FVBˆ`¢ÚÚ'VÊÊñÊrFÜR&ñFW"w2˜v‚ñÊFWVÊFVÁBW'6∆◊ˆfbf6ñÊtÊv∆R‡¢ÚÚFÜRGvÚFVB¶ˆÊW2W6RFñffW&VÁBÊv∆R6WG2˜vñGFá2¬6Ú∆Vg@¢ÚÚñÊFWVÊFVÁB¬FÜR&ñFW"w2∆Vw2Ü6Üñ∆G&V‚ˆb∆ñW$÷W6Ç¬6VP¢ÚÚ∆Vw57W&W76VB&V∆˜rí6˜V∆BÜ«BB‚˜&ñVÁFFñˆ‚FÜBFˆW6‚w@¢ÚÚ÷F6ÇFÜR÷˜VÁBw27GV¬&VÊFW&VB6ñ∆Ü˜VWGFRÊBˆ∂RFá&˜VvÇóB‡¢∆ñW$f6ñÊr≥“Êv∆TFñfbÜ÷˜VÁE&ñFTVÁFóGíÁÊu&˜B¬∆ñW$f6ñÊrí¢„#S∞¢∆ñW$÷W6ÇÁ&˜FFñˆ‚Áí“∆ñW$f6ñÊs∞¢ñbá∆ñW$∆Vw3ÚÊw&˜Wí∆ñW$∆Vw2Êw&˜WÁ&˜FFñˆ‚Áí“∞¢“V«6R∞¢ñbÇ∆ñW"ÁW'7FFRí∆ñW"ÁW'7FFR“∑”∞¢6ˆÁ7B&uF&vWE&˜Eí“÷f6ñÊtÊv∆R≤÷FÇÂíÚ#∞¢6ˆÁ7B≤VffV7FófUF&vWC¢VfeF&vWB¬6ÊFÛ¢6ÊFÚ““vñÊF˜rÂW'&˜FFñˆ‚ÁW'6∆◊á∆ñW"ÁW'7FFR¬&uF&vWE&˜Eí¬6÷W&&V∆FófUW'2Çíì∞¢ñbá6ÊFÚ”“ÁV∆¬í∆ñW$f6ñÊr“VfeF&vWC∞¢V«6R∆ñW$f6ñÊr≥“Êv∆TFñfbáVfeF&vWB¬∆ñW$f6ñÊrí¢„É∞¢∆ñW$÷W6ÇÁ&˜FFñˆ‚Áí“∆ñW$f6ñÊs≤ÚÚFVfV«C≤7vVW'&Ê6Çñ‚WFFUFˆˆƒ÷W6Ç÷í˜fW'&ñFP¢ÚÚ∆Vw2&R‚ñÁfó6ñ&∆Rfˆ˜B◊∆6V÷VÁB&ñr¬Ê˜Bf∆B&ñ∆∆&ˆ&B(	@¢ÚÚÊˆÊRˆbFÜRf˜&W6Ü˜'FVÊñÊr&ˆ&∆V“W'6∆◊w2FVB¶ˆÊRWÜó7G0¢ÚÚFÚÜñFR∆ñW2FÚFÜV“¬6ÚFÜWí6Ü˜V∆F‚wBÜˆ∆B˜6ÊvóFÇFÜP¢ÚÚ7&óFRÜ÷˜7BÊ˜Fñ6V&∆RvÜñ∆R6VFVC¢FÜR7&óFR6‚ñ‚FÚFÜP¢ÚÚ6Üó"w2f6ñÊr˜"6Êvíg&ˆ“óB2FÜR6÷W&7vñÊw27B¢ÚÚFVB◊¶ˆÊR&˜VÊF'í¬'WBFÜR∆Vw2ÜfRÊÚ'W6ñÊW72fˆ∆∆˜vñÊp¢ÚÚFÜB6Êí‚6˜VÁFW"◊&˜FFW2FÜR∆Vr&ñrÜ6Üñ∆Bˆb∆ñW$÷W6Ç¿¢ÚÚ6VR&ˆ6VGW&¬÷∆Vr÷Êñ÷Fñˆ‚Êß2w2GF6ÇÇíí'íFÜRv&WGvVV‡¢ÚÚFÜR6∆◊VB&˜FFñˆ‚ßW7B∆ñVBÊBFÜR&rVÊ6∆◊V@¢ÚÚWVóf∆VÁB¬6ÚFÜR∆Vw2rtı$ƒB&˜FFñˆ‚«vó2G&6∑0¢ÚÚf6ñÊtÊv∆RFó&V7F«í&Vv&F∆W72ˆbvÜBFÜR7&óFRó2FˆñÊr‡¢ñbá∆ñW$∆Vw3ÚÊw&˜Wí∆ñW$∆Vw2Êw&˜WÁ&˜FFñˆ‚Áí“&uF&vWE&˜Eí“∆ñW$÷W6ÇÁ&˜FFñˆ‚Áì∞¢–†¢ÚÚ&ˆ"Êñ÷Fñˆ‚vÜV‚÷˜fñÊr(	B◊∆óGVFR&◊26ˆÁFñÁV˜W6«íg&ˆ“FÜP¢ÚÚ6∆“◊v∆∂ñÊr&6V∆ñÊRWF˜v&BFÜRgV∆¬÷Vff˜'B˜'VÊÊñÊrV≤0¢ÚÚ7W'&VÁB7VVB&ˆ6ÜW2FÜR∆ñW"w2˜v‚÷ÇGFñÊ&∆R7VV@¢ÚÚÑ‘ıdUı5TTB66∆VB'íFÜR6÷RFWdv∆ˆ&≈7VVD◊V¬FÜB«&VGê¢ÚÚv˜fW&Á2óBñ‚WFFT÷˜fV÷VÁBí¬Ê˜Bf∆BFó7FÊ6RFÜRñÁ7FÁ@¢ÚÚ÷˜fV÷VÁB7F'G2‡¢6ˆÁ7B7VVB“÷FÇÊáó˜Bá∆ñW"ÁgÇ¬∆ñW"Ágíì∞¢ñbá7VVB‚Rí∞¢6ˆÁ7B&ˆ$Vff˜'B“6∆◊á7VVBÚÑ‘ıdUı5TTB¢FWdv∆ˆ&≈7VVD◊V¬í¬¬ì∞¢∆ñW$÷W6ÇÁ˜6óFñˆ‚Áí≥“÷FÇÁ6ñ‚áW&f˜&÷Ê6RÊÊ˜rÇíÚ#í¢Ñ‘ıdUÙ$Ù%ıtƒµÙ’≤Ñ‘ıdUÙ$Ù%ı%TÂÙ’“‘ıdUÙ$Ù%ıtƒµÙ’í¢&ˆ$Vff˜'Bì∞¢–¢ÚÚ7W&W76VBÜ∆Vw27Fífó6ñ&∆R'WBßW7BÜÊr7G&ñváBF˜v‚g&ˆ–¢ÚÚFÜVó"ÜóÊ6Ü˜'2ñÁ7FVBˆbvóFñÊr¬6VR&ˆ6VGW&¬÷∆Vr–¢ÚÚÊñ÷Fñˆ‚Êß2w2˜v‚WFFRÇíívÜVÊWfW"◊V«Fí÷fF"Êñ÷Fñˆ‚ó0¢ÚÚG&ófñÊrFÜR∆ñW"w2vÜˆ∆R÷&ˆGíG&Á6f˜&“ÊBFÜR∆ñW"ó6‚w@¢ÚÚóG2Ê6Ü˜"(	B÷˜VÁFVBÜv«VVBFÚFÜR÷˜VÁBw26FF∆R¬6VP¢ÚÚ÷˜VÁE6VD∆ñgB&˜fRí˜"÷ñB∆ófW7Fˆ6≤÷Ü'fW7BñÁFW&7Fñˆ‚á6VP¢ÚÚWFFTÜ'fW7DñÁFW&7Fñˆ‚í‚6Ü˜V∆FW"WBÊWfW"6WG2VóFÜW"ˆ`¢ÚÚFÜW6S¢FÜR∆ñW"7Fó2FÜRÊ6Ü˜"ÊB∂VW2v∆∂ñÊrÊ˜&÷∆«ê¢ÚÚVÊFW&ÊVFÇóBá6VRWFFT6ˆ◊ÊñˆÁ2r6Ü˜V∆FW%WB'&Ê6Çí¬6Ú∆Vw0¢ÚÚ6ñ◊«í∂VWÊñ÷FñÊrˆfbFÜR∆ñW"w2˜v‚&V¬fV∆ˆ6óGí2W7V¬‡¢6ˆÁ7B∆Vw57W&W76VB“÷˜VÁE&ñFU7FFR”“vÊˆÊRr«¬vñÊF˜r‰f&‘Êñ÷«2Êó4Ü'fW7FñÊrÇì∞¢ÚÚ&VÁB÷∂ÊVR6VFVB˜6Rá6VR&ˆ6VGW&¬÷∆Vr÷Êñ÷Fñˆ‚Êß2w2˜v‡¢ÚÚ«ï6VFVE˜6R˜6ˆ«fU6VFVD∆Vu7W&f6Tf«W6ÇívÜñ∆R7GV∆«í6VFV@¢ÚÚñ‚6Üó"(	BfóFÜgV¬˜'BˆbFÜRgW&ÊóGW&R÷fF"÷WFÜ˜ ¢ÚÚFˆˆ¬w2˜v‚6VB◊∆ÊR◊&ˆ¶V7Fñˆ‚∆Vr6ˆ«fS¢FÜRFÜñvÇ&W7G2f«W6Ä¢ÚÚvñÁ7BFÜR6VBw2˜v‚WFÜ˜&VB7W&f6RFñ«BˆÜVñváBÊBFÜR6∆`¢ÚÚVóFÜW"6ˆÁFñÁVW2f∆B˜"G&˜27G&ñváBFÚFÜRf∆ˆ˜"FWVÊFñÊrˆ‡¢ÚÚvÜWFÜW"FÜR∂ÊVRó27Fñ∆¬˜fW"FÜR6VB¬ñÁ7FVBˆbˆÊRfóÜV@¢ÚÚf˜'v&B÷ˆfg6WBˆ&VÊB&˜Üñ÷Fñˆ‚f˜"WfW'í6Üó"‡¢6ˆÁ7B6VFVE˜6R“á6óDñÁFW&7Fñˆ‚bb6óDñÁFW&7Fñˆ‚ÁÜ6R”“v˜WBríÚ∞¢6VEì¢6óDñÁFW&7Fñˆ‚Á6VEv˜&∆Eí¿¢Ê˜&÷ƒFVs¢6óDñÁFW&7Fñˆ‚Á6VDÊ˜&÷ƒFVr¿¢fˆ˜G&ñÁDÜ∆dFWFÉ¢6óDñÁFW&7Fñˆ‚Á6VDfˆ˜G&ñÁDÜ∆dFWFÇ¿¢Ê6Ü˜%£¢6óDñÁFW&7Fñˆ‚Á6VDÊ6Ü˜%¢¿¢“¢VÊFVfñÊVC∞¢ÚÚ7FvvW"Ùfˆ˜FñÊr&vFˆ∆¬∆ñ&6≤ÜFˆ72ˆß2ˆ6ˆ÷&Bˆñ◊7B◊&vFˆ∆¬–¢ÚÚ∆ñ&6≤Êß2í˜vÁ2&˜FÇ∆Vw2ÊB∆ñW$÷W6Çw2Fñ«BˆÜVñváBf˜"0¢ÚÚ∆ˆÊr2óBw27FófRˆÜˆ∆FñÊr(	B6∂óFÜRÊ˜&÷¬vóB6ˆ«fRVÁFó&V«ê¢ÚÚ&FÜW"FÜ‚7W&W76ñÊróB¬6ñÊ6R7W&W76VB7Fñ∆¬w&óFW2¢ÚÚ7G&ñváB÷ÜÊr˜6RñÁFÚFÜR6÷R∆Vr÷6Üñ‚ˆ&¶V7G2WfW'íg&÷P¢ÚÚá6VRFÜB÷ˆGV∆Rw2˜v‚WFFRÇíí¬vÜñ6Çv˜V∆BfñváBFÜR&V6˜&FV@¢ÚÚ&vFˆ∆¬˜6RñÁ7FVBˆb7FWñÊr6ñFRf˜"óB‡¢ñbávñÊF˜r‰ñ◊7E&vFˆ∆≈∆ñ&6≥ÚÊó47FófRÇíívñÊF˜r‰ñ◊7E&vFˆ∆≈∆ñ&6≤ÁWFFRÜGBì∞¢V«6R∆ñW$∆Vw3ÚÁWFFRÜGB¬7VVBÚDîƒR¬∆Vw57W&W76VB¬6VFVE˜6Rì∞¢–†¢ÚÚ)H)HWFFR&WFñ6∆R)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢gVÊ7Fñˆ‚WFFU&WFñ6∆T÷W6ÇÇí∞¢6ˆÁ7B&WFñ6∆R“vWE&WFñ6∆UFñ∆RÇì∞¢6ˆÁ7BFñ∆R“vWD7FófTw&ñBÇï∑&WFñ6∆RÁ&˜u”ÚÂ∑&WFñ6∆RÊ6ˆ≈”∞¢ñbÇFñ∆Rí∞¢&WFñ6∆T6ó&6∆T÷W6ÇÁfó6ñ&∆R“f«6S∞¢&WFñ6∆U&ñÊt÷W6ÇÁfó6ñ&∆R“f«6S∞¢&WFñ6∆Uvgîw&˜WÁfó6ñ&∆R“f«6S∞¢6∆V%F&vWDÜñvÜ∆ñváG2Çì∞¢&WGW&„∞¢–¢6ˆÁ7B7W&eí“Fñ∆U7W&f6Uîñ‰&VáFñ∆R¬7W'&VÁD&Ví≤„¢≤áFñ∆RÁvFW"‚„"ÚFñ∆RÁvFW"¢tDU%ıT‰ïB≤„B¢ì∞¢6ˆÁ7B∆∆˜vVB“6ÂW6T7Fñˆ‚Ü7FófUFˆˆ¬¬7FófT7Fñˆ‚¬&WFñ6∆RÊ6ˆ¬¬&WFñ6∆RÁ&˜rì∞¢6ˆÁ7BB“W&f˜&÷Ê6RÊÊ˜rÇì∞¢6ˆÁ7BV«6R“≤„b¢÷FÇÁ6ñ‚áBÚ3ì∞†¢6ˆÁ7Bˆ‰f&““7W'&VÁD&V””“vf&“s∞¢6ˆÁ7BvVˆ‰WVóVB“7FófUFˆˆ¬””“wvVˆ‚s∞¢6ˆÁ7Bó4WÜ6fFR“ˆ‰f&“bbvVˆ‰WVóVBbb∆∆˜vVBbbÜ7FófT7Fñˆ‚””“vFñrr«¬7FófT7Fñˆ‚””“w&ó6Rrì∞¢6ˆÁ7Bó4ÜˆUv˜&≤“ˆ‰f&“bbvVˆ‰WVóVBbb∆∆˜vVBbb7FófUFˆˆ¬””“vÜˆRs∞¢6ˆÁ7B6Ü˜uFñ∆R“ó4WÜ6fFR«¬ó4ÜˆUv˜&≥∞¢6ˆÁ7Bó4ˆ&•F&vWB“ˆ‰f&“bb∆∆˜vVBbb6Ü˜uFñ∆RbbvVˆ‰WVóVC∞¢6ˆÁ7Bí“&WFñ6∆RÁ&˜r¢4Ù≈2≤&WFñ6∆RÊ6ˆ√∞¢6ˆÁ7B7WGF&∆UF&vWB“ˆ‰f&“bbvVˆ‰WVóVBbbáFñ∆RÁGóR””“Fñ∆UGóRÂtTTE2«¬Fñ∆RÁGóR””“Fñ∆UGóRÂ4Ö%T"«¬fVtfˆ∆ñvT÷W6ÜW5∂ï“ì∞¢6ˆÁ7Bó5vVVD&∆ˆ6≤“ˆ‰f&“bb∆∆˜vVBbb7FófUFˆˆ¬””“vÜˆRrbb7FófT7Fñˆ‚””“wFñ∆¬p¢bbáFñ∆RÁGóR””“Fñ∆UGóRÂtTTE2«¬fVtfˆ∆ñvT÷W6ÜW5∂ï“ì∞†¢ÚÚ&6RFñ∆R&˜Ä¢&WFñ6∆T÷W6ÇÁfó6ñ&∆R“vVˆ‰WVóVC∞¢&WFñ6∆T÷W6ÇÁ˜6óFñˆ‚Á6WBá&WFñ6∆RÊ6ˆ¬≤„R¬7W&eí¬&WFñ6∆RÁ&˜r≤„Rì∞¢&WFñ6∆T÷W6ÇÊ÷FW&ñ¬“6Ü˜uFñ∆RÚ&WFñ6∆TñÁFVÁ6T÷@¢¢Ü∆∆˜vVBÚ&WFñ6∆T÷B¢&WFñ6∆T&∆ˆ6∂VD÷Bì∞¢&WFñ6∆T÷W6ÇÁ66∆RÁ6WBáV«6R¬¬V«6Rì∞†¢ÚÚf∆ˆ˜"6ó&6∆R(	BFñrÚ&ó6RˆÊ«ê¢ñbÜó4WÜ6fFRí∞¢&WFñ6∆T6ó&6∆T÷W6ÇÁfó6ñ&∆R“G'VS∞¢&WFñ6∆T6ó&6∆T÷W6ÇÁ˜6óFñˆ‚Á6WBá&WFñ6∆RÊ6ˆ¬≤„R¬7W&eí≤„"¬&WFñ6∆RÁ&˜r≤„Rì∞¢6ˆÁ7B7“≤„í¢÷FÇÁ6ñ‚áBÚ#Sì∞¢&WFñ6∆T6ó&6∆T÷W6ÇÁ66∆RÁ6WBÜ7¬7¬7ì∞¢“V«6R∞¢&WFñ6∆T6ó&6∆T÷W6ÇÁfó6ñ&∆R“f«6S∞¢–†¢ÚÚvgí∆ñÊW2(	BÜˆRˆÊ«ê¢ñbÜó4ÜˆUv˜&≤í∞¢&WFñ6∆Uvgîw&˜WÁfó6ñ&∆R“G'VS∞¢&WFñ6∆Uvgîw&˜WÁ˜6óFñˆ‚Á6WBá&WFñ6∆RÊ6ˆ¬≤„R¬7W&eí≤„"¬&WFñ6∆RÁ&˜r≤„Rì∞¢6ˆÁ7Bw“≤„Ç¢÷FÇÁ6ñ‚áBÚ#sì∞¢&WFñ6∆Uvgîw&˜WÁ66∆RÁ6WBáw¬w¬wì∞¢“V«6R∞¢&WFñ6∆Uvgîw&˜WÁfó6ñ&∆R“f«6S∞¢–†¢ÚÚˆ&¶V7B˜WF∆ñÊRÜ∆ñW""íÊBf∆∆&6≤&ñÊp¢6∆V%F&vWDÜñvÜ∆ñváG2Çì∞¢ñbÜó4ˆ&•F&vWB«¬ó5vVVD&∆ˆ6≤«¬7WGF&∆UF&vWBí∞¢6ˆÁ7B÷W6ÜW2“7WGF&∆UF&vWBbbFñ∆RÁGóR””“Fñ∆UGóRÂtTTE2bb5˜vVVC4BÚµ“¢fñÊEF&vWD÷W6ÜW2á&WFñ6∆RÊ6ˆ¬¬&WFñ6∆RÁ&˜rì∞¢ñbÜ÷W6ÜW2Ê∆VÊwFÇ‚í∞¢f˜"Ü6ˆÁ7B“ˆb÷W6ÜW2í“Ê∆ñW'2ÊVÊ&∆RÉ"ì∞¢˜F&vWD˜WF∆ñÊT÷W6ÜW2“÷W6ÜW3∞¢˜F&vWD˜WF∆ñÊT∆∆˜vVB“ó4ˆ&•F&vWC∞¢WFFT7WGF&∆T&ñ∆∆&ˆ&Dv∆˜rÉ¬¬f«6Rì∞¢&WFñ6∆U&ñÊt÷W6ÇÁfó6ñ&∆R“f«6S∞¢“V«6RñbÜ7WGF&∆UF&vWBbbFñ∆RÁGóR””“Fñ∆UGóRÂtTTE2bb5˜vVVC4Bí∞¢WFFT7WGF&∆T&ñ∆∆&ˆ&Dv∆˜rá&WFñ6∆RÊ6ˆ¬¬&WFñ6∆RÁ&˜r¬G'VRì∞¢&WFñ6∆U&ñÊt÷W6ÇÁfó6ñ&∆R“f«6S∞¢“V«6R∞¢ÚÚÊÚ7V6ñfñ2÷W6Ç(	Bf∆¬&6≤FÚf∆ˆFñÊr&ñÊp¢6ˆÁ7Bv˜&∆Dˆ&¢“vWEv˜&∆Dˆ&¶V7DBá&WFñ6∆RÊ6ˆ¬¬&WFñ6∆RÁ&˜rì∞¢6ˆÁ7B&ñÊtÇ“v˜&∆Dˆ&¢Ú„ìR¢áFñ∆RÊ7&˜Ú„cR¢„CRì∞¢6ˆÁ7B&ˆ"“„b¢÷FÇÁ6ñ‚áBÚcì∞¢&WFñ6∆U&ñÊt÷W6ÇÁfó6ñ&∆R“G'VS∞¢&WFñ6∆U&ñÊt÷W6ÇÁ˜6óFñˆ‚Á6WBá&WFñ6∆RÊ6ˆ¬≤„R¬7W&eí≤&ñÊtÇ≤&ˆ"¬&WFñ6∆RÁ&˜r≤„Rì∞¢&WFñ6∆U&ñÊt÷W6ÇÁ&˜FFñˆ‚Áí“BÚ#S∞¢6ˆÁ7B'“„ì"≤„Ç¢÷FÇÁ6ñ‚áBÚSì∞¢&WFñ6∆U&ñÊt÷W6ÇÁ66∆RÁ6WBá'¬'¬'ì∞¢–¢“V«6R∞¢&WFñ6∆U&ñÊt÷W6ÇÁfó6ñ&∆R“f«6S∞¢–¢–†¢ÚÚ)H)HWFFR∆ñváFñÊrg&ˆ“Fñ÷R÷ˆb÷Fí)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢∆WBˆ∆7D∆ñváEWFFUFñ÷R“∞¢gVÊ7Fñˆ‚WFFUFá&VT∆ñváFñÊrÇí∞¢ÚÚ∆ñváFñÊr6ÜÊvW2ˆ‚s"◊6V6ˆÊBv÷RFí(	BW6ÜñÊrVÊñf˜&◊2WfW'ê¢ÚÚg&÷Rv7FW2„◊2‚Fá&˜GF∆RFÚWfW'íS◊3≤ñ◊W&6WFñ&∆R‡¢6ˆÁ7BÊ˜r“W&f˜&÷Ê6RÊÊ˜rÇì∞¢ñbÜÊ˜r“ˆ∆7D∆ñváEWFFUFñ÷R¬Sí&WGW&„∞¢ˆ∆7D∆ñváEWFFUFñ÷R“Ê˜s∞¢6ˆÁ7B≤"¬r¬"¬““vñÊF˜rÂvVFÜW$eÇÊvWD∆ñváFñÊu7FFRÇì∞¢ÚÚ÷&ñVÁC¢Fñ÷÷W"BÊñváB¬'&ñváFW"BÊˆˆ‡¢6ˆÁ7B'&ñváFÊW74◊V¬““¢„s∞¢÷&ñVÁD∆ñváBÊñÁFVÁ6óGí“„2≤'&ñváFÊW74◊V¬¢„s∞¢÷&ñVÁD∆ñváBÊ6ˆ∆˜"Á6WE$t"Ä¢á"Û#SRí¢„b≤„B¿¢ÜrÛ#SRí¢„b≤„B¿¢Ü"Û#SRí¢„b≤„@¢ì∞¢7V‰∆ñváBÊñÁFVÁ6óGí“'&ñváFÊW74◊V¬¢„#∞¢7V‰∆ñváBÊ6ˆ∆˜"Á6WE$t"á"Û#SR¢„R≤„R¬rÛ#SR¢„R≤„R¬"Û#SR¢„B≤„bì∞¢ÚÚw&72&ñ∆∆&ˆ&G2&RVÊ∆óBá6VRˆw&74&ñ∆ƒg&rí¬6÷R2FÜRw&˜VÊ@¢ÚÚFñ∆W2r÷W6Ñ&6ñ4÷FW&ñ¬áFñ∆T÷G2Êw&72í(	BÊÚFíˆÊñváBVÊñf˜&“F¢ÚÚG&ófRÜW&RÁñ÷˜&R¬6Ú&∆FW2ÊWfW"Fñ“ñÊFWVÊFVÁF«íˆbFÜP¢ÚÚw&˜VÊBFÜWíw&R7FÊFñÊrˆ‚‡¢ÚÚfˆr6ˆ∆˜W"÷F6ÜW26∑ê¢66VÊRÊ&6∂w&˜VÊBÁ6WE$t"Ä¢÷FÇÊ÷ÇÉ¬"Û#SR¢„R≤„Bí¿¢÷FÇÊ÷ÇÉ¬rÛ#SR¢„R≤„Çí¿¢÷FÇÊ÷ÇÉ¬"Û#SR¢„R≤„bê¢ì∞¢66VÊRÊfˆrÊ6ˆ∆˜"Ê6˜íá66VÊRÊ&6∂w&˜VÊBì∞¢–†¢∆WBˆ∆7EF˜v‰∆ñváEWFFUFñ÷R“∞¢gVÊ7Fñˆ‚WFFUF˜vÂFá&VT∆ñváFñÊrÇí∞¢6ˆÁ7BÊ˜r“W&f˜&÷Ê6RÊÊ˜rÇì∞¢ñbÜÊ˜r“ˆ∆7EF˜v‰∆ñváEWFFUFñ÷R¬Sí&WGW&„∞¢ˆ∆7EF˜v‰∆ñváEWFFUFñ÷R“Ê˜s∞¢6ˆÁ7B≤"¬r¬"¬““vñÊF˜rÂvVFÜW$eÇÊvWD∆ñváFñÊu7FFRÇì∞¢6ˆÁ7B'&ñváFÊW74◊V¬““¢„s∞¢F˜v‰÷&ñVÁD∆ñváBÊñÁFVÁ6óGí“„2≤'&ñváFÊW74◊V¬¢„s∞¢F˜v‰÷&ñVÁD∆ñváBÊ6ˆ∆˜"Á6WE$t"Ä¢á"Û#SRí¢„b≤„B¿¢ÜrÛ#SRí¢„b≤„B¿¢Ü"Û#SRí¢„b≤„@¢ì∞¢F˜vÂ7V‰∆ñváBÊñÁFVÁ6óGí“'&ñváFÊW74◊V¬¢„#∞¢F˜vÂ7V‰∆ñváBÊ6ˆ∆˜"Á6WE$t"á"Û#SR¢„R≤„R¬rÛ#SR¢„R≤„R¬"Û#SR¢„B≤„bì∞¢ÚÚw&72&ñ∆∆&ˆ&G2&RVÊ∆óBá6VRWFFUFá&VT∆ñváFñÊrw2÷F6ÜñÊr6ˆ÷÷VÁBí‡¢F˜vÂ66VÊRÊ&6∂w&˜VÊBÁ6WE$t"Ä¢÷FÇÊ÷ÇÉ¬"Û#SR¢„R≤„Bí¿¢÷FÇÊ÷ÇÉ¬rÛ#SR¢„R≤„Çí¿¢÷FÇÊ÷ÇÉ¬"Û#SR¢„R≤„bê¢ì∞¢F˜vÂ66VÊRÊfˆrÊ6ˆ∆˜"Ê6˜íáF˜vÂ66VÊRÊ&6∂w&˜VÊBì∞¢–†¢ÚÚ)H)H66ÜVB6ˆÁFñÊW"&V7B(	BfˆñG2&WVFVB∆ñ˜WB&Vf∆˜w2W"g&÷R)H ¢ÚÚWFFVBñ‚&W6ó¶T6Áf2Çì≤W6VB'íG&vñÊrgVÊ7FñˆÁ2ÊBv˜&∆EFÙ˜fW&∆í‡¢∆WB˜Fá&VU&V7B“≤vñGFÉ¢vñÊF˜rÊñÊÊW%vñGFÇ¬ÜVñváC¢vñÊF˜rÊñÊÊW$ÜVñváB”∞†¢ÚÚ)H)H&W6ó¶RÜÊF∆W")H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢gVÊ7Fñˆ‚&W6ó¶T6Áf2Çí∞¢6ˆÁ7BG"“÷FÇÊ÷ñ‚ávñÊF˜rÊFWfñ6UóÜV≈&FñÚ¬"ì∞¢6ˆÁ7B&V7B“Fá&VT6ˆÁFñÊW"ÊvWD&˜VÊFñÊt6∆ñVÁE&V7BÇì∞¢˜Fá&VU&V7B“&V7C∞¢6ˆÁ7Br“&V7BÁvñGFÇ«¬vñÊF˜rÊñÊÊW%vñGFÉ∞¢6ˆÁ7BÇ“&V7BÊÜVñváB«¬vñÊF˜rÊñÊÊW$ÜVñváC∞¢&VÊFW&W"Á6WEóÜV≈&FñÚÜG"¢5˜&W566∆Rì∞¢&VÊFW&W"Á6WE6ó¶Rár¬Çì∞¢6ˆÁ7B'Ve6ó¶R“&VÊFW&W"ÊvWDG&vñÊt'VffW%6ó¶RÜÊWrDÖ$TRÂfV7F˜#"Çíì∞¢˜&W6ó¶T˜WF∆ñÊUF&vWG2Ü'Ve6ó¶RÁÇ¬'Ve6ó¶RÁíì∞¢˜fW&∆î6Áf2ÁvñGFÇ“÷FÇÁ&˜VÊBár¢G"ì∞¢˜fW&∆î6Áf2ÊÜVñváB“÷FÇÁ&˜VÊBÜÇ¢G"ì∞¢ˆ7GÇÁ6WEG&Á6f˜&“ÜG"¬¬¬G"¬¬ì∞¢∆ñváFñÊt6Áf2ÁvñGFÇ“÷FÇÁ&˜VÊBár¢G"ì∞¢∆ñváFñÊt6Áf2ÊÜVñváB“÷FÇÁ&˜VÊBÜÇ¢G"ì∞¢∆7GÇÁ6WEG&Á6f˜&“ÜG"¬¬¬G"¬¬ì∞¢–†¢ÚÚ)H)Hfó7V¬fVGW&RFˆvv∆W2Ö6WGFñÊw2F"í)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢∆WB5ˆ˜WF∆ñÊW2“G'VS∞¢∆WB5ˆFWFÑ˜WF∆ñÊW2“f«6S≤ÚÚWáG&FWFÇ◊6V“˜WF∆ñÊR72(	Bˆfb'íFVfV«BÜÜVfñW"ê¢∆WB5ˆFWFÑ˜WF∆ñÊUFá&W6Ö66∆R“≤ÚÚ6VÁ6óFófóGì¢∆˜vW"“6F6ÜW26÷∆∆W"FWFÇv0¢∆WB5ˆw&72“G'VS∞¢∆WB5˜vVVC4B“f«6S≤ÚÚf«6R“÷ˆFRÜ˜fW'6ó¶VB&ñ∆∆&ˆ&G2í¬G'VR“÷ˆFR"É4Bfˆ∆ñvRê¢∆WB5ˆ&ñ∆≈vñÊB“G'VS∞¢∆WB5ˆg46˜VÁFW"“f«6S∞¢∆WB5˜&W566∆R“≤ÚÚ&VÊFW"◊&W6ˆ«WFñˆ‚66∆R∆ñVBFÚFÜR4B&VÊFW&W"w2óÜV¬&Fñ¢ÚÚFV'VrÜóF&˜Ç˜fW&∆í(	BVÊ∆ñ∂RFÜR˜FÜW"fó7V¬Fˆvv∆W2&˜fR¬óG0¢ÚÚ7FFRó266ÜVB7&˜726W76ñˆÁ2ÜóBw2FWbFˆˆ¬ñ˜Rf∆óˆ‚ˆÊ6P¢ÚÚÊBvÁBFÚ7Fíˆ‚¬Ê˜BW"◊6W76ñˆ‚fó7V¬&VfW&VÊ6Rí‡¢6ˆÁ7BÑïD$ıÖÙDT%Tuı5Dı$tUÙ¥Uí“vÜˆ'VÊ¶îFV'VtÜóF&˜ÜW2s∞¢∆WB5˜6Ü˜tÜóF&˜ÜW2“f«6S∞¢G'í≤5˜6Ü˜tÜóF&˜ÜW2“∆ˆ6≈7F˜&vRÊvWDóFV“ÑÑïD$ıÖÙDT%Tuı5Dı$tUÙ¥Uíí””“ss≤“6F6Ç∑–¢ÚÚv∆ˆ&¬FWb÷÷ˆFRf∆r(	B6÷R&f∆óˆ‚ˆÊ6R¬7Fó2ˆ‚"W'6ó7FVÊ6R0¢ÚÚ5˜6Ü˜tÜóF&˜ÜW2&˜fR‚7W'&VÁF«íˆÊ«ívFW2FÜR≥÷7FW'í'WGFˆ‚ñ‡¢ÚÚV6ÇFˆˆ¬w2óFV“÷ñÊfÚÊV¬á6VR6V∆V7DvV%Fˆˆ¬˜6V∆V7DWVó6∆˜Bí¿¢ÚÚ'WBó2ÊGW&¬Üˆ÷Rf˜"gWGW&RFWb÷ˆÊ«í6Ü˜'F7WG2FˆÚ‡¢6ˆÁ7BDUeÙ‘ÙDUı5Dı$tUÙ¥Uí“vÜˆ'VÊ¶îFWd÷ˆFRs∞¢∆WB5ˆFWd÷ˆFR“f«6S∞¢G'í≤5ˆFWd÷ˆFR“∆ˆ6≈7F˜&vRÊvWDóFV“ÑDUeÙ‘ÙDUı5Dı$tUÙ¥Uíí””“ss≤“6F6Ç∑–¢ÚÚFV'VrFˆvv∆Rf˜"FÜRG&Á6«V6VÁB◊6Ü˜V∆FW"◊WBñÁfW7FñvFñˆ‚(	Bf˜&6W0¢ÚÚ6WE∆ñW$ÜEá&íw2˜v‚vFRá6VRWFFT6ˆ◊ÊñˆÁ2íFÚ«vó2&W˜'@¢ÚÚ&ˆfb"&Vv&F∆W72ˆbvÜWFÜW"6Ü˜V∆FW"WBó27FófR¬6ÚFÜRÜ@¢ÚÚ∆ÊR∂VW2óG2Ê˜&÷¬FWFÖw&óFRÊBˆ66«VFW2WÜ7F«í∆ñ∂RÁê¢ÚÚ˜FÜW"˜VR7&óFR‚ó6ˆ∆FW2vÜWFÜW"FÜB7V6ñfñ2÷V6ÜÊó6“ó0¢ÚÚ6ˆÁG&ñ'WFñÊrFÚFÜR&W˜'FVBG&Á6«V6VÊ7í‡¢∆WB5ˆFó6&∆TÜEá&í“f«6S∞†¢6ˆÁ7Bg46˜VÁFW$V¬“Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÇvg46˜VÁFW"rì∞¢∆WBˆg4g&÷W2“¬ˆg467V““∞¢∆WBˆ÷ñÊñ÷&VG&t67V““∞¢∆WB˜FÑ'&ñ6¥7V∆ƒ67V““∞†¢'Vñ∆EFñ∆T÷W6ÜW2Çì∞†¢ÚÚfVB'&ñ6≤7W&f6R˜fW"FÜRf&“w2FÇ¬ñbóBÜ2ˆÊR(	B6÷P¢ÚÚFV6ÜÊóVR2FÜRF˜v‚FÇá6VR%FÉ¢fVB'&ñ6≤7W&f6R"&V∆˜rì†¢ÚÚ'Vñ«BˆÊ6RFÜR6Ü&VB&V6óRÙtƒ"&R&VGí¬6áVÊ∂VBÊB7V∆∆VB'ê¢ÚÚ6÷W&6˜'&ñF˜"‚v˜&∆E&˜WFW2∆ˆG27ñÊ6á&ˆÊ˜W6«íB&ˆ˜BFˆÚ¬6÷P¢ÚÚ2v˜&∆EF˜vÂ&˜WFW2¬6ÚóBw2&VBg&W6ÇñÁ6ñFRFÜRÁFÜV‚Çí&V∆˜p¢ÚÚ&FÜW"FÜ‚6GW&VBÊ˜r‡¢VÁ7W&UFÖ7W&f6U&VGíÇíÁFÜV‚ÇÇí”‚∞¢6ˆÁ7Bf&’&˜WFW2“v˜&∆E&˜WFW2Êfñ«FW"á"”‚á"Ê&V«¬vf&“rí””“vf&“rì∞¢6ˆÁ7B7∆ñÊTFF“&W&UFÖ7∆ñÊTFFÜw&ñB¬4Ù≈2¬$ıu2¬f&’&˜WFW2¬vf&“rì∞¢ñbá7∆ñÊTFFí&Vvó7FW%FÑ'&ñ6¥6áVÊ∑2Çvf&“r¬66VÊR¬7∆ñÊTFFì∞¢“íÊ6F6ÇÜW'"”‚FV'Vt∆ˆrÇtf&“FÇ'&ñ6≤7W&f6RW'&˜#¢r≤W'"Ê÷W76vR¬wv&‚ríì∞†¢ÚÚ6∆∆VBÜW&RÜÜVBˆbFÜR˜FÜW"vñÊF˜r‚£ÚÊñÊóBÇ‚‚‚í6∆«2ÊV"FÜP¢ÚÚ&˜GFˆ“ˆbFÜó2fñ∆R¬vÜñ6Ç'V‚FˆÚ∆FRí6ñÊ6R'Vñ∆D&˜&FW%FW'&ñ‚Çê¢ÚÚ&V∆˜rÊVVG2óBñ÷÷VFñFV«í(	BWfW'í˜FÜW"FWóB6GW&W2'í6∆˜7W&P¢ÚÚÑ4Ù≈2ı$ıu2˜66VÊRÙ‰ı$‘≈ıDı˜&W6ˆ«fUFñ∆T÷B˜&W6ˆ«fT6∆ñfd÷BıFñ∆UGóR¢ÚÚˆ÷%&Êrıˆ÷&¥˜WF∆ñÊRıˆw&74&∆FTvVÚˆw&74&ñ∆∆&ˆ&D÷B˜5ˆw&72ˆ6∆◊ê¢ÚÚó2«&VGíFV6∆&VB&˜fRFÜó2ˆñÁB¬˜"Ü6∆◊¬gVÊ7Fñˆ‡¢ÚÚFV6∆&Fñˆ‚íÜˆó7FVB&Vv&F∆W72ˆbvÜW&RóBw2w&óGFV‚‡¢vñÊF˜r‰&˜&FW%FW'&ñ„ÚÊñÊóBá∞¢4Ù≈2¬$ıu2¬‰ı$‘≈ıDı¬66VÊR¬Fñ∆UGóR¬ƒDTUıT‰ïB¿¢&W6ˆ«fUFñ∆T÷B¬&W6ˆ«fT6∆ñfd÷B¬6∆◊¿¢÷%&Ês¢ˆ÷%&Êr¿¢÷&¥˜WF∆ñÊS¢ˆ÷&¥˜WF∆ñÊR¿¢w&74&∆FTvVÛ¢ˆw&74&∆FTvVÚ¿¢vWDw&74&ñ∆∆&ˆ&D÷C¢Çí”‚w&74&ñ∆∆&ˆ&D÷B¿¢vWDw&74VÊ&∆VC¢Çí”‚5ˆw&72¿¢vWEF˜vÂ66VÊS¢Çí”‚F˜vÂ66VÊR¿¢vWEF˜vÂ¶ˆÊS¢Çí”‚˜F˜vÂ¶ˆÊR¿¢“ì∞¢vñÊF˜r‰&˜&FW%FW'&ñ‚Ê'Vñ∆D&˜&FW%FW'&ñ‚Çì∞†¢ÚÚ)H)H6WGFñÊw2F"6ÜV6∂&˜Çvó&ñÊr)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÇw6WGFñÊt˜WF∆ñÊW2ríÊFDWfVÁD∆ó7FVÊW"Çv6ÜÊvRr¬R”‚∞¢5ˆ˜WF∆ñÊW2“RÁF&vWBÊ6ÜV6∂VC∞¢“ì∞¢Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÇw6WGFñÊtFó6&∆TÜEá&írìÚÊFDWfVÁD∆ó7FVÊW"Çv6ÜÊvRr¬R”‚∞¢5ˆFó6&∆TÜEá&í“RÁF&vWBÊ6ÜV6∂VC∞¢“ì∞¢Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÇw6WGFñÊtFWFÑ˜WF∆ñÊW2ríÊFDWfVÁD∆ó7FVÊW"Çv6ÜÊvRr¬R”‚∞¢5ˆFWFÑ˜WF∆ñÊW2“RÁF&vWBÊ6ÜV6∂VC∞¢“ì∞¢Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÇw6WGFñÊtFWFÑ˜WF∆ñÊU6VÁ6óFófóGíríÊFDWfVÁD∆ó7FVÊW"ÇvñÁWBr¬R”‚∞¢ÚÚ6∆ñFW"ó2'6VÁ6óFófóGí"ÜÜñvÜW"“6F6ÜW26÷∆∆W"FWFÇv2í¬6¢ÚÚñÁfW'BóBñÁFÚFÜRFá&W6Üˆ∆B◊66∆R◊V«Fó∆ñW"W6VB'íFÜR6ÜFW"‡¢6ˆÁ7B6VÁ6óFófóGí“ÁV÷&W"ÜRÁF&vWBÁf«VRì∞¢5ˆFWFÑ˜WF∆ñÊUFá&W6Ö66∆R“"„≤É„#R“"„í¢6VÁ6óFófóGì∞¢“ì∞¢Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÇw6WGFñÊtw&72ríÊFDWfVÁD∆ó7FVÊW"Çv6ÜÊvRr¬R”‚∞¢5ˆw&72“RÁF&vWBÊ6ÜV6∂VC∞¢ñbÜf&‘w&74&ñ∆ƒ÷W6Çíf&‘w&74&ñ∆ƒ÷W6ÇÁfó6ñ&∆R“5ˆw&73∞¢ñbáF˜v‰w&74&ñ∆ƒ÷W6ÇíF˜v‰w&74&ñ∆ƒ÷W6ÇÁfó6ñ&∆R“5ˆw&73∞¢vñÊF˜r‰&˜&FW%FW'&ñ‚Á6WDw&75fó6ñ&∆Rá5ˆw&72ì∞¢“ì∞¢Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÇw6WGFñÊt&ñ∆≈vñÊBríÊFDWfVÁD∆ó7FVÊW"Çv6ÜÊvRr¬R”‚∞¢5ˆ&ñ∆≈vñÊB“RÁF&vWBÊ6ÜV6∂VC∞¢“ì∞¢Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÇw6WGFñÊuvVVC4BríÊFDWfVÁD∆ó7FVÊW"Çv6ÜÊvRr¬R”‚∞¢5˜vVVC4B“RÁF&vWBÊ6ÜV6∂VC∞¢˜&V'Vñ∆EvVVEFñ∆W2Çì∞¢“ì∞¢Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÇw6WGFñÊtg46˜VÁFW"ríÊFDWfVÁD∆ó7FVÊW"Çv6ÜÊvRr¬R”‚∞¢5ˆg46˜VÁFW"“RÁF&vWBÊ6ÜV6∂VC∞¢g46˜VÁFW$V¬Á7Gñ∆RÊFó7∆í“5ˆg46˜VÁFW"Úrr¢vÊˆÊRs∞¢ˆg4g&÷W2“≤ˆg467V““∞¢“ì∞¢Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÇw6WGFñÊu&W6ˆ«WFñˆ‚ríÊFDWfVÁD∆ó7FVÊW"Çv6ÜÊvRr¬R”‚∞¢5˜&W566∆R“'6Tf∆ˆBÜRÁF&vWBÁf«VRí«¬∞¢&W6ó¶T6Áf2Çì∞¢“ì∞†¢ÚÚ∆ˆ6¬6fRfˆ∆FW"6WGFñÊw2&˜r(	B6VRFˆ72ˆß2ˆ∆ˆ6¬◊6fR÷fˆ∆FW"Êß2‡¢ÚÚvñÊF˜r‰∆ˆ6≈6fTfˆ∆FW"˜vÁ2∆¬FÜR7GV¬fˆ∆FW"÷ÜÊF∆RÙñÊFWÜVDD"¢ÚÚfñ∆R7ó7FV“66W72ív˜&≥≤FÜó2ßW7B&VÊFW'2óG27FGW2Ê@¢ÚÚvó&W2FÜR'WGFˆÁ2‡¢ÜgVÊ7Fñˆ‚ñÊóD∆ˆ6≈6fTfˆ∆FW%6WGFñÊw2Çí∞¢6ˆÁ7B&˜r“Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÇv∆ˆ6≈6fTfˆ∆FW%&˜rrì∞¢ñbÇ&˜r«¬vñÊF˜r‰∆ˆ6≈6fTfˆ∆FW"í&WGW&„∞¢6ˆÁ7B7FGW4V¬“Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÇv∆ˆ6≈6fTfˆ∆FW%7FGW2rì∞¢6ˆÁ7B6Üˆ˜6T'F‚“Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÇv∆ˆ6≈6fTfˆ∆FW$6Üˆ˜6T'F‚rì∞¢6ˆÁ7B6ÜÊvT'F‚“Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÇv∆ˆ6≈6fTfˆ∆FW$6ÜÊvT'F‚rì∞¢6ˆÁ7B&V6ˆÊÊV7D'F‚“Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÇv∆ˆ6≈6fTfˆ∆FW%&V6ˆÊÊV7D'F‚rì∞¢6ˆÁ7B6fTÊ˜t'F‚“Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÇv∆ˆ6≈6fTfˆ∆FW%6fTÊ˜t'F‚rì∞¢6ˆÁ7B∆ˆD'F‚“Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÇv∆ˆ6≈6fTfˆ∆FW$∆ˆD'F‚rì∞†¢gVÊ7Fñˆ‚&VÊFW"á7FGW2í∞¢ñbÇ7FGW2Á7W˜'FVBí∞¢7FGW4V¬ÁFWáD6ˆÁFVÁB“tÊ˜B7W˜'FVBñ‚FÜó2'&˜w6W"Ñ6á&ˆ÷RÙVFvRˆÊ«íí‚s∞¢∂6Üˆ˜6T'F‚¬6ÜÊvT'F‚¬&V6ˆÊÊV7D'F‚¬6fTÊ˜t'F‚¬∆ˆD'FÂ“Êf˜$V6ÇÜ"”‚"Á7Gñ∆RÊFó7∆í“vÊˆÊRrì∞¢&WGW&„∞¢–¢6Üˆ˜6T'F‚Á7Gñ∆RÊFó7∆í“á7FGW2Á7FFR””“vÊ˜B÷6ˆÊfñwW&VBr«¬7FGW2Á7FFR””“vW'&˜"ríÚrr¢vÊˆÊRs∞¢6ÜÊvT'F‚Á7Gñ∆RÊFó7∆í“7FGW2Êfˆ∆FW$Ê÷RÚrr¢vÊˆÊRs∞¢&V6ˆÊÊV7D'F‚Á7Gñ∆RÊFó7∆í“7FGW2Á7FFR””“vÊVVG2◊W&÷ó76ñˆ‚rÚrr¢vÊˆÊRs∞¢6fTÊ˜t'F‚Á7Gñ∆RÊFó7∆í“7FGW2Á7FFR””“w&VGírÚrr¢vÊˆÊRs∞¢∆ˆD'F‚Á7Gñ∆RÊFó7∆í“7FGW2Á7FFR””“w&VGírÚrr¢vÊˆÊRs∞¢ñbá7FGW2Á7FFR””“w&VGírí∞¢6ˆÁ7BvÜV‚“7FGW2Ê∆7E7ñÊ6VDBÚÊWrFFRá7FGW2Ê∆7E7ñÊ6VDBíÁFÙ∆ˆ6∆UFñ÷U7G&ñÊrÇí¢vÊWfW"s∞¢7FGW4V¬ÁFWáD6ˆÁFVÁB“6fñÊrFÚ"G∑7FGW2Êfˆ∆FW$Ê÷W“"(	B∆7B7ñÊ6VBG∑vÜVÁ“Ê∞¢“V«6Rñbá7FGW2Á7FFR””“vÊVVG2◊W&÷ó76ñˆ‚rí∞¢7FGW4V¬ÁFWáD6ˆÁFVÁB“fˆ∆FW""G∑7FGW2Êfˆ∆FW$Ê÷W“"ÊVVG2W&÷ó76ñˆ‚vñ‚FÜó26W76ñˆ‚Ê∞¢“V«6Rñbá7FGW2Á7FFR””“vW'&˜"rí∞¢7FGW4V¬ÁFWáD6ˆÁFVÁB“tW'&˜#¢r≤á7FGW2Ê∆7DW'&˜"«¬wVÊ∂Ê˜v‚rì∞¢“V«6R∞¢7FGW4V¬ÁFWáD6ˆÁFVÁB“tÊÚfˆ∆FW"6Ü˜6V‚ñWB‚s∞¢–¢–†¢vñÊF˜r‰∆ˆ6≈6fTfˆ∆FW"Êˆ‰6ÜÊvRá&VÊFW"ì∞¢&VÊFW"ávñÊF˜r‰∆ˆ6≈6fTfˆ∆FW"ÊvWE7FGW2Çíì∞†¢6Üˆ˜6T'F‚ÊFDWfVÁD∆ó7FVÊW"Çv6∆ñ6≤r¬Çí”‚vñÊF˜r‰∆ˆ6≈6fTfˆ∆FW"Ê6Üˆ˜6Tfˆ∆FW"Çíì∞¢6ÜÊvT'F‚ÊFDWfVÁD∆ó7FVÊW"Çv6∆ñ6≤r¬Çí”‚vñÊF˜r‰∆ˆ6≈6fTfˆ∆FW"Ê6ÜÊvTfˆ∆FW"Çíì∞¢&V6ˆÊÊV7D'F‚ÊFDWfVÁD∆ó7FVÊW"Çv6∆ñ6≤r¬Çí”‚vñÊF˜r‰∆ˆ6≈6fTfˆ∆FW"Á&V6ˆÊÊV7BÇíì∞¢6fTÊ˜t'F‚ÊFDWfVÁD∆ó7FVÊW"Çv6∆ñ6≤r¬7ñÊ2Çí”‚∞¢6ˆÁ7B7FGW2“vóBvñÊF˜r‰∆ˆ6≈6fTfˆ∆FW"Á7ñÊ4Ê˜rÇì∞¢6Ü˜uFˆ7Bá7FGW2Ê∆7DW'&˜"ÚÇt∆ˆ6¬6fRfñ∆VC¢r≤7FGW2Ê∆7DW'&˜"í¢u6fVBFÚ∆ˆ6¬fˆ∆FW"‚r¬7FGW2Ê∆7DW'&˜"ì∞¢“ì∞¢∆ˆD'F‚ÊFDWfVÁD∆ó7FVÊW"Çv6∆ñ6≤r¬7ñÊ2Çí”‚∞¢ñbÇ6ˆÊfó&“Çt∆ˆBFÜR6fRg&ˆ“ñ˜W"∆ˆ6¬fˆ∆FW#ÚFÜó2˜fW'w&óFW2ñ˜W"7W'&VÁB'&˜w6W"6fRÊB&V∆ˆG2FÜRvR‚ríí&WGW&„∞¢6ˆÁ7B&W7V«B“vóBvñÊF˜r‰∆ˆ6≈6fTfˆ∆FW"Ê∆ˆDg&ˆ‘fˆ∆FW"Çì∞¢6Ü˜uFˆ7Bá&W7V«BÊ÷W76vR¬&W7V«BÊˆ≤ì∞¢ñbá&W7V«BÊˆ≤í∆ˆ6Fñˆ‚Á&V∆ˆBÇì∞¢“ì∞¢“íÇì∞†¢6ˆÁ7B6WGFñÊu6Ü˜tÜóF&˜ÜW4V¬“Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÇw6WGFñÊu6Ü˜tÜóF&˜ÜW2rì∞¢6WGFñÊu6Ü˜tÜóF&˜ÜW4V¬Ê6ÜV6∂VB“5˜6Ü˜tÜóF&˜ÜW3∞¢6WGFñÊu6Ü˜tÜóF&˜ÜW4V¬ÊFDWfVÁD∆ó7FVÊW"Çv6ÜÊvRr¬R”‚∞¢5˜6Ü˜tÜóF&˜ÜW2“RÁF&vWBÊ6ÜV6∂VC∞¢G'í≤∆ˆ6≈7F˜&vRÁ6WDóFV“ÑÑïD$ıÖÙDT%Tuı5Dı$tUÙ¥Uí¬5˜6Ü˜tÜóF&˜ÜW2Úsr¢srì≤“6F6Ç∑–¢“ì∞¢6ˆÁ7B6WGFñÊtFWd÷ˆFTV¬“Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÇw6WGFñÊtFWd÷ˆFRrì∞¢6WGFñÊtFWd÷ˆFTV¬Ê6ÜV6∂VB“5ˆFWd÷ˆFS∞¢6WGFñÊtFWd÷ˆFTV¬ÊFDWfVÁD∆ó7FVÊW"Çv6ÜÊvRr¬R”‚∞¢5ˆFWd÷ˆFR“RÁF&vWBÊ6ÜV6∂VC∞¢G'í≤∆ˆ6≈7F˜&vRÁ6WDóFV“ÑDUeÙ‘ÙDUı5Dı$tUÙ¥Uí¬5ˆFWd÷ˆFRÚsr¢srì≤“6F6Ç∑–¢ÚÚF∂W2VffV7BFÜRÊWáBFñ÷RFˆˆ¬w2óFV“÷ñÊfÚÊV¬ó2˜VÊV@¢ÚÚá6V∆V7DvV%Fˆˆ¬˜6V∆V7DWVó6∆˜B&˜FÇ&VB5ˆFWd÷ˆFRg&W6Çí&FÜW ¢ÚÚFÜ‚ÊVVFñÊrFÚG&6≤˜&R◊&VÊFW"vÜñ6ÜWfW"ÊV¬÷ñváB7W'&VÁF«ê¢ÚÚ&R˜V‚‡¢ÚÚFÜRf&“VFóF˜"ÚFWb7vÊW"6ÜVB'WGFˆÁ2&RFWb÷÷ˆFR÷vFV@¢ÚÚá6VRFWb◊7vÊW"Êß2w2&Vg&W6ÑVFóF˜$'WGFˆÂfó6ñ&ñ∆óGíí(	BWFFRFÜV–¢ÚÚñ÷÷VFñFV«íñÁ7FVBˆbvóFñÊrf˜"FÜRÊWáB&V6ÜÊvR‚FÜP¢ÚÚgW&ÊóGW&R∆6W"'WGFˆ‚6Ü&W2FÜB6÷R6∆˜BvÜV‚FWb÷ˆFRó0¢ÚÚˆfbá6VRÊg◊6ÜñgFVBí¬6ÚóB«6ÚÊVVG2‚ñ÷÷VFñFR&Vg&W6Ç‡¢vñÊF˜r‰FWe7vÊW#ÚÁ&Vg&W6ÑVFóF˜$'WGFˆÂfó6ñ&ñ∆óGíÇì∞¢vñÊF˜r‰gW&ÊóGW&U∆6W#ÚÁ&Vg&W6Öfó6ñ&ñ∆óGíÇì∞¢“ì∞¢ÚÚ7ñ6∆W2Fá&˜VvÇ¶ˆÊRw2FVÁ2ñ‚6áVff∆VB¬Êˆ‚◊&WVFñÊr˜&FW ¢ÚÚáW"¶ˆÊRíñÁ7FVBˆb‚ñÊFWVÊFVÁB&ÊFˆ“ñ6≤WfW'í&W72(	@¢ÚÚvóFÇˆÊ«íÜÊFgV¬ˆbFVÁ2W"¶ˆÊR¬∆ñ‚÷FÇÁ&ÊFˆ“Çí÷FRó@¢ÚÚV7íFÚ∆ÊBˆ‚FÜR6÷R”"FVÁ2˜fW"ÊB˜fW"'í6ÜÊ6R‡¢ÚÚ&W6áVff∆W2vÜVÊWfW"FÜRFV‚6˜VÁB6ÜÊvW2ÜRÊr‚gFW"F˜FÜ¿¢ÚÚ6ÜñgBí¬6ÚgV∆¬∆«vó2fó6óG2WfW'íFV‚ˆ‚FÜR÷WÜ7F«ê¢ÚÚˆÊ6R&Vf˜&RÁí&WVB‡¢6ˆÁ7BˆFVÂFV∆W˜'D7ñ6∆R“ÊWr÷Çì≤ÚÚ¶ˆÊTñB”‚≤˜&FW#¢ÁV÷&W%µ“¬ñGÉ¢ÁV÷&W"¬∆VÊwFÉ¢ÁV÷&W"–¢gVÊ7Fñˆ‚˜ñ6¥7ñ6∆VDFV‚á¶ˆÊTñB¬FVÁ2í∞¢∆WB7FFR“ˆFVÂFV∆W˜'D7ñ6∆RÊvWBá¶ˆÊTñBì∞¢ñbÇ7FFR«¬7FFRÊ∆VÊwFÇ”“FVÁ2Ê∆VÊwFÇí∞¢6ˆÁ7B˜&FW"“FVÁ2Ê÷ÇÖÚ¬íí”‚íì∞¢f˜"Ü∆WBí“˜&FW"Ê∆VÊwFÇ“≤í‚≤í““í∞¢6ˆÁ7B¢“÷FÇÊf∆ˆ˜"á&ÊBÇí¢Üí≤íì∞¢∂˜&FW%∂ï“¬˜&FW%∂•’““∂˜&FW%∂•“¬˜&FW%∂ï’”∞¢–¢7FFR“≤˜&FW"¬ñGÉ¢¬∆VÊwFÉ¢FVÁ2Ê∆VÊwFÇ”∞¢ˆFVÂFV∆W˜'D7ñ6∆RÁ6WBá¶ˆÊTñB¬7FFRì∞¢vñÊF˜rÂıˆf&‘∆ˆsÚ‚Ü∑vñ∆F∆ñfU“FV‚FV∆W˜'B7ñ6∆R&V'Vñ«Bf˜"G∑¶ˆÊTñG”¢G∂FVÁ2Ê∆VÊwFá“FVÁ2¬˜&FW"≤G∂˜&FW"Ê¶ˆñ‚Çr¬ró’÷¬wvñ∆F∆ñfRrì∞¢–¢6ˆÁ7BFV‚“FVÁ5∑7FFRÊ˜&FW%∑7FFRÊñGÖ’”∞¢vñÊF˜rÂıˆf&‘∆ˆsÚ‚Ü∑vñ∆F∆ñfU“FV‚FV∆W˜'BG∑¶ˆÊTñG”¢ñ6∂ñÊr7ñ6∆R6∆˜BG∑7FFRÊñGÇ≤“ÚG∑7FFRÊ˜&FW"Ê∆VÊwFá“”‚FV‚G∂FV‚ÊñG÷¬wvñ∆F∆ñfRrì∞¢7FFRÊñGÇ“á7FFRÊñGÇ≤íR7FFRÊ˜&FW"Ê∆VÊwFÉ∞¢&WGW&‚FV„∞¢–¢ÚÚFWbFˆˆ«3¢v'FÚFV‚w2÷˜WFÇˆ‚FÜR5U%$TÂB÷ˆÊ«í(	BÊ¢ÚÚ¶ˆÊR◊7vóF6ÜñÊr¬6ñÊ6RFÜR&WVW7Bó27V6ñfñ6∆«í&FˆW2FÜó2÷ ¢ÚÚÜfRˆÊR"Üf&“˜F˜v‚ˆ'Vñ∆FñÊw2ÊWfW"FÛ≤vñ∆FW&ÊW72¶ˆÊRFˆW2ˆÊ6P¢ÚÚóG2F˜FÜ¬6ÜñgBÜ2'V‚(	B6VR˜¶ˆÊT∆ñ˜WG2rFVÁ6fñV∆Bí‡¢gVÊ7Fñˆ‚FV∆W˜'EFı&ÊFˆ‘FV‚Çí∞¢ÚÚ6∆∆VBg&ˆ“ñÁ6ñFRFV‚w2˜v‚6fW&‚ÜF&≤¬ÊÚ∆ÊF÷&∑2¬Ê@¢ÚÚ&ÊÚFVÁ2ˆ‚FÜó2÷"÷FRÊÚ6VÁ6RFÜW&R6ñÊ6R6fW&‚w2˜v‡¢ÚÚ˜¶ˆÊT∆ñ˜WG2VÁG'íFˆW6‚wBWÜó7Bí(	B&W6ˆ«fRFÜRWáFW&ñ˜"¶ˆÊP¢ÚÚFÜó26fW&‚&V∆ˆÊw2FÚá6VRˆFV‰6fW&Â¶ˆÊTˆbíÊBv'FÜW&R¿¢ÚÚ∆ÊFñÊrBFV‚÷˜WFÇ∆ñ∂RFÜR¶ˆÊR◊6ñFRFÇ&V∆˜rñÁ7FVBˆ`¢ÚÚ&WVó&ñÊr6W&FRWÜóB7FWfó'7B‡¢ñbÖˆó46fW&‰'Vñ∆FñÊt&VÜ7W'&VÁD&Víí∞¢6ˆÁ7B¶ˆÊTñB“vñÊF˜rÂvñ∆F∆ñfU7v‚ÊFV‰6fW&Â¶ˆÊTˆbÜ7W'&VÁD&Vì∞¢6ˆÁ7BFVÁ2“¶ˆÊTñBÚ˜¶ˆÊT∆ñ˜WG2ÊvWBá¶ˆÊTñBìÚÊFVÁ2¢ÁV∆√∞¢ñbÇ¶ˆÊTñB«¬FVÁ2«¬FVÁ2Ê∆VÊwFÇí∞¢6Ü˜uFˆ7BÇ$ÊÚFVÁ2f˜VÊBf˜"FÜó2'W'&˜rw2÷‚"¬f«6Rì∞¢&WGW&„∞¢–¢6ˆÁ7BFV‚“˜ñ6¥7ñ6∆VDFV‚á¶ˆÊTñB¬FVÁ2ì∞¢6ˆÁ7BÊ6Ü˜"“FV‚Ê÷˜WFÑÊ6Ü˜"«¬≤É¢FV‚ÁÇ≤ÜFV‚Ár«¬íÚ"¬ì¢FV‚Áí≤ÜFV‚ÊÇ«¬íÚ"”∞¢7F'E66VÊUG&Á6óFñˆ‚ÇÇí”‚∞¢6ˆÁ7Bg&ˆ’66VÊR“ˆ'Vñ∆FñÊu66VÊW2ÊvWBÜ7W'&VÁD&VìÚÁ66VÊR«¬ÁV∆√∞¢ñbÜg&ˆ’66VÊRí≤g&ˆ’66VÊRÁ&V÷˜fRá∆ñW$÷W6Çì≤g&ˆ’66VÊRÁ&V÷˜fRá∆ñW$w&˜VÊE6ÜF˜rì≤–¢ˆ7W'&VÁD'Vñ∆FñÊt÷ñB“ÁV∆√∞¢7W'&VÁD&V“¶ˆÊTñC∞¢∆ñW"ÁÇ“ÜÊ6Ü˜"ÁÇ≤„Rí¢DîƒS∞¢∆ñW"Áí“ÜÊ6Ü˜"Áí≤„Rí¢DîƒS∞¢∆ñW"ÁgÇ“≤∆ñW"Ágí“∞¢˜6Ê6÷W&F&vWBÇì∞¢6ˆÁ7BFı66VÊR“'Vñ∆E¶ˆÊU66VÊRá¶ˆÊTñBìÚÁ66VÊS∞¢ñbáFı66VÊRí∞¢Fı66VÊRÊFBá∆ñW$÷W6Çì≤Fı66VÊRÊFBá∆ñW$w&˜VÊE6ÜF˜rì∞¢Fı66VÊRÊFBáFˆˆƒÜˆ∆FW"ì≤Fı66VÊRÊFBá&WFñ6∆T÷W6Çì∞¢Fı66VÊRÊFBá&WFñ6∆T6ó&6∆T÷W6Çì≤Fı66VÊRÊFBá&WFñ6∆U&ñÊt÷W6Çì∞¢Fı66VÊRÊFBá&WFñ6∆Uvgîw&˜Wì∞¢–¢&Vg&W6Ñ7Fñˆ‰&"Çì∞¢6Ü˜uFˆ7BÜFV∆W˜'FVBFÚFV‚ÇG∂FVÁ2Ê∆VÊwFá“ˆ‚FÜó2÷íÊ¬G'VRì∞¢6∆˜6T÷VÁRÇì∞¢“ì∞¢&WGW&„∞¢–¢6ˆÁ7BFVÁ2“˜¶ˆÊT∆ñ˜WG2ÊvWBÜ7W'&VÁD&VìÚÊFVÁ3∞¢ñbÇFVÁ2«¬FVÁ2Ê∆VÊwFÇí∞¢6Ü˜uFˆ7BÇtÊÚFVÁ2ˆ‚FÜó2÷‚r¬f«6Rì∞¢&WGW&„∞¢–¢6ˆÁ7BFV‚“˜ñ6¥7ñ6∆VDFV‚Ü7W'&VÁD&V¬FVÁ2ì∞¢6ˆÁ7BÊ6Ü˜"“FV‚Ê÷˜WFÑÊ6Ü˜"«¬≤É¢FV‚ÁÇ≤ÜFV‚Ár«¬íÚ"¬ì¢FV‚Áí≤ÜFV‚ÊÇ«¬íÚ"”∞¢∆ñW"ÁÇ“ÜÊ6Ü˜"ÁÇ≤„Rí¢DîƒS∞¢∆ñW"Áí“ÜÊ6Ü˜"Áí≤„Rí¢DîƒS∞¢∆ñW"ÁgÇ“≤∆ñW"Ágí“∞¢˜6Ê6÷W&F&vWBÇì∞¢6Ü˜uFˆ7BÜFV∆W˜'FVBFÚFV‚ÇG∂FVÁ2Ê∆VÊwFá“ˆ‚FÜó2÷íÊ¬G'VRì∞¢6∆˜6T÷VÁRÇì∞¢–¢Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÇvFWeFV∆W˜'DFV‰'F‚rìÚÊFDWfVÁD∆ó7FVÊW"Çv6∆ñ6≤r¬FV∆W˜'EFı&ÊFˆ‘FV‚ì∞†¢ÚÚvñ∆F∆ñfRˆvVÊ˜GóRFV'VrÊV¬è	˙z¬vñ∆F∆ñfRF"íÊ˜r∆ófW2ñ‡¢ÚÚß2˜vñ∆F∆ñfR÷FV'Vr◊ÊV¬Êß2(	B6∆¬fñvñÊF˜rÂvñ∆F∆ñfTFV'VuÊV¬Á&VÊFW"Çí‡¢Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÇwvñ∆F∆ñfU&Vg&W6Ñ'F‚rìÚÊFDWfVÁD∆ó7FVÊW"Çv6∆ñ6≤r¬Çí”‚vñÊF˜rÂvñ∆F∆ñfTFV'VuÊV¬Á&VÊFW"Çíì∞¢Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÇwvñ∆F∆ñfU6ÜñgD'F‚rìÚÊFDWfVÁD∆ó7FVÊW"Çv6∆ñ6≤r¬7ñÊ2Çí”‚∞¢vóB6ÜV6µF˜FÜ≈6ÜñgBáG'VRì∞¢vñÊF˜rÂvñ∆F∆ñfTFV'VuÊV¬Á&VÊFW"Çì∞¢“ì∞¢ÚÚFV∆VvFVB6ÚóB∂VW2v˜&∂ñÊr7&˜72WfW'í&R◊&VÊFW"ˆbFÜR∆ó7@¢ÚÚÜ6ˆÁFñÊW"ÊñÊÊW$ÖD‘¬&W∆6V÷VÁBv˜V∆B˜FÜW'vó6RG&˜W"÷'WGFˆ‡¢ÚÚ∆ó7FVÊW'2V6ÇFñ÷Rí‡¢Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÇwvñ∆F∆ñfTFV‰∆ó7BrìÚÊFDWfVÁD∆ó7FVÊW"Çv6∆ñ6≤r¬ÜRí”‚∞¢6ˆÁ7B'F‚“RÁF&vWBÊ6∆˜6W7BÇrÁvñ∆F∆ñfR÷FV‚◊FV∆W˜'B÷'F‚rì∞¢ñbÇ'F‚í&WGW&„∞¢6ˆÁ7B¶ˆÊTñB“'F‚ÊFF6WBÁ¶ˆÊR¬FV‰ñB“'F‚ÊFF6WBÊFV„∞¢6ˆÁ7BFV‚“˜¶ˆÊT∆ñ˜WG2ÊvWBá¶ˆÊTñBìÚÊFVÁ3ÚÊfñÊBÜB”‚BÊñB””“FV‰ñBì∞¢ñbÇFV‚í≤6Ü˜uFˆ7BÇuFÜBFV‚ÊÚ∆ˆÊvW"WÜó7G2ˆ‚FÜR7W'&VÁB÷‚r¬f«6Rì≤&WGW&„≤–¢v'FÙFV‰Ê6Ü˜"á¶ˆÊTñB¬FV‚ì∞¢“ì∞¢ÚÚv'2FÜR∆ñW"7G&ñváBFÚ7V6ñfñ2FV‚w2÷˜WFÇˆ‚óG2˜v‡¢ÚÚ¶ˆÊR¬g&ˆ“ÁóvÜW&RÜf&“¬F˜v‚¬Ê˜FÜW"¶ˆÊR¬˜"ñÁ6ñFRÁê¢ÚÚ'Vñ∆FñÊrˆ6fW&‚í(	BW6VB'íFÜRvñ∆F∆ñfRÊV¬w2W"÷FV‚FV∆W˜'@¢ÚÚ'WGFˆ‚‚VÊ∆ñ∂RFV∆W˜'EFı&ÊFˆ‘FV‚ávÜñ6ÇˆÊ«íWfW"F&vWG0¢ÚÚ'vÜñ6ÜWfW"÷ñ˜Rw&R7W'&VÁF«íˆ‚"í¬FÜó2«vó2&W6ˆ«fW2FÜP¢ÚÚWÜ7B¶ˆÊRFÜRñ6∂VBFV‚&V∆ˆÊw2FÚÊBFˆW2gV∆¬66VÊR7v ¢ÚÚñbFÜBw2Ê˜BvÜW&RFÜR∆ñW"«&VGíó2‡¢gVÊ7Fñˆ‚v'FÙFV‰Ê6Ü˜"á¶ˆÊTñB¬FV‚í∞¢6ˆÁ7BÊ6Ü˜"“FV‚Ê÷˜WFÑÊ6Ü˜"«¬≤É¢FV‚ÁÇ≤ÜFV‚Ár«¬íÚ"¬ì¢FV‚Áí≤ÜFV‚ÊÇ«¬íÚ"”∞¢6ˆÁ7B∆ÊB“Çí”‚∞¢∆ñW"ÁÇ“ÜÊ6Ü˜"ÁÇ≤„Rí¢DîƒS∞¢∆ñW"Áí“ÜÊ6Ü˜"Áí≤„Rí¢DîƒS∞¢∆ñW"ÁgÇ“≤∆ñW"Ágí“∞¢˜6Ê6÷W&F&vWBÇì∞¢”∞¢ñbÜ7W'&VÁD&V””“¶ˆÊTñBí∞¢∆ÊBÇì∞¢6Ü˜uFˆ7BÜFV∆W˜'FVBFÚFV‚G∂FV‚ÊñG“Ê¬G'VRì∞¢6∆˜6T÷VÁRÇì∞¢&WGW&„∞¢–¢7F'E66VÊUG&Á6óFñˆ‚ÇÇí”‚∞¢6ˆÁ7Bg&ˆ’66VÊR“vWD7FófU66VÊRÇì∞¢ñbÜg&ˆ’66VÊRí≤g&ˆ’66VÊRÁ&V÷˜fRá∆ñW$÷W6Çì≤g&ˆ’66VÊRÁ&V÷˜fRá∆ñW$w&˜VÊE6ÜF˜rì≤–¢ñbÖˆó4'Vñ∆FñÊt&VÜ7W'&VÁD&Vííˆ7W'&VÁD'Vñ∆FñÊt÷ñB“ÁV∆√∞¢7W'&VÁD&V“¶ˆÊTñC∞¢∆ÊBÇì∞¢6ˆÁ7BFı66VÊR“'Vñ∆E¶ˆÊU66VÊRá¶ˆÊTñBìÚÁ66VÊS∞¢ñbáFı66VÊRí∞¢Fı66VÊRÊFBá∆ñW$÷W6Çì≤Fı66VÊRÊFBá∆ñW$w&˜VÊE6ÜF˜rì∞¢Fı66VÊRÊFBáFˆˆƒÜˆ∆FW"ì≤Fı66VÊRÊFBá&WFñ6∆T÷W6Çì∞¢Fı66VÊRÊFBá&WFñ6∆T6ó&6∆T÷W6Çì≤Fı66VÊRÊFBá&WFñ6∆U&ñÊt÷W6Çì∞¢Fı66VÊRÊFBá&WFñ6∆Uvgîw&˜Wì∞¢–¢&Vg&W6Ñ7Fñˆ‰&"Çì∞¢6Ü˜uFˆ7BÜFV∆W˜'FVBFÚFV‚G∂FV‚ÊñG“Ê¬G'VRì∞¢6∆˜6T÷VÁRÇì∞¢“ì∞¢–†¢ÚÚFWbFˆˆ«3¢FW7FñÊr&VÊFV∆W˜'B≤7&VGW&Rˆ&ÊFóBˆfˆ∆ñvP¢ÚÚ7vÊW"ÊV¬Ê˜r∆ófW2ñ‚ß2ˆFWb◊7vÊW"Êß2ávñÊF˜r‰FWe7vÊW"ê¢ÚÚ(	B6VRóG2ñÊóBÜFW2í6∆¬&V∆˜rf˜"FÜR6Ü&VBv÷RÊß27FFP¢ÚÚóBw2Fá&VFVB‡†¢ÚÚ&ÊFóB6ˆ÷&B÷∆ˆr6GW&RÑíÙ6∆VFR&WfñWrFˆˆ¬¬Ê˜B∆ñW"–¢ÚÚf6ñÊríÊ˜r∆ófW2ñ‚ß2ˆ&ÊFóB÷6ˆ÷&B÷∆ˆrÊß2(	B6∆¬fñ¢ÚÚvñÊF˜r‰&ÊFóD6ˆ÷&D∆ˆrÊ6GW&U6Ê6Ü˜EFWáBÇíñbÊVVFVBV«6WvÜW&R‡†¢Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÇvFWe7VVD◊V≈6∆ñFW"rìÚÊFDWfVÁD∆ó7FVÊW"ÇvñÁWBr¬ÜRí”‚∞¢FWdv∆ˆ&≈7VVD◊V¬“6∆◊ÑÁV÷&W"ÜRÁF&vWBÁf«VRí«¬¬#R¬3íÚ∞¢6ˆÁ7B∆&V¬“Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÇvFWe7VVD◊Vƒ∆&V¬rì∞¢ñbÜ∆&V¬í∆&V¬ÁFWáD6ˆÁFVÁB“÷FÇÁ&˜VÊBÜFWdv∆ˆ&≈7VVD◊V¬¢í≤rRs∞¢“ì∞†¢ÚÚvñÊF˜rÂˆFWe7vÊW"ÊB˜&Vg&W6ÑVFóF˜$'WGFˆÂfó6ñ&ñ∆óGíÊ˜r∆ófRñ‡¢ÚÚß2ˆFWb◊7vÊW"Êß2ávñÊF˜r‰FWe7vÊW"í(	B6∆¬fñ¢ÚÚvñÊF˜r‰FWe7vÊW"ÁFˆvv∆RÇíÚÁ&Vg&W6ÑVFóF˜$'WGFˆÂfó6ñ&ñ∆óGíÇí‡†¢ÚÚ)H)HFV‚‘÷˜FÜW"ÊW7C¢Üˆ∆B◊FÚ◊F∂RVvrˆ&'íá6VRˆFV‰ÊW7G2¬˜V∆FV@¢ÚÚñ‚∆ˆD'Vñ∆FñÊu66VÊRí)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢6ˆÁ7B‰U5EıD¥UÙÑÙƒEı2“S∞¢∆WBˆÊW7DÜˆ∆EB“∞¢6ˆÁ7BˆÊW7EF∂TáVDV¬“Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÇvÊW7EF∂TáVBrì∞¢6ˆÁ7BˆÊW7EF∂T∆&VƒV¬“Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÇvÊW7EF∂T∆&V¬rì∞¢6ˆÁ7BˆÊW7EF∂Tfñ∆ƒV¬“Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÇvÊW7EF∂Tfñ∆¬rì∞¢gVÊ7Fñˆ‚ó5∆ñW$ÊV$FV‰ÊW7BÜÊW7Bí∞¢6ˆÁ7B7Ç“ÜÊW7BÊ6ˆ¬≤ÊW7BÁrÚ"í¢DîƒR¬7í“ÜÊW7BÁ&˜r≤ÊW7BÊÇÚ"í¢DîƒS∞¢&WGW&‚÷FÇÊáó˜Bá∆ñW"ÁÇ“7Ç¬∆ñW"Áí“7íí√“DîƒR¢„c∞¢–¢gVÊ7Fñˆ‚WFFTÊW7DñÁFW&7Fñˆ‚ÜGBí∞¢6ˆÁ7BÊW7B“ˆFV‰ÊW7G2ÊvWBÜ7W'&VÁD&Vì∞¢6ˆÁ7BÊV"“ÊW7BbbÊW7BÁ&V÷ñÊñÊr‚bbó5∆ñW$ÊV$FV‰ÊW7BÜÊW7Bì∞¢ñbÇÊV"«¬7Fñˆ‰ÜV∆DF˜v‚í∞¢ñbÖˆÊW7DÜˆ∆EB‚íˆÊW7DÜˆ∆EB“∞¢ñbÖˆÊW7EF∂TáVDV√ÚÊ6∆74∆ó7BÊ6ˆÁFñÁ2Çwfó6ñ&∆RrííˆÊW7EF∂TáVDV¬Ê6∆74∆ó7BÁ&V÷˜fRÇwfó6ñ&∆Rrì∞¢&WGW&„∞¢–¢ˆÊW7DÜˆ∆EB≥“GC∞¢ñbÖˆÊW7EF∂T∆&VƒV¬íˆÊW7EF∂T∆&VƒV¬ÁFWáD6ˆÁFVÁB“ÊW7BÊ∆ófT&ó'FÇÚuF∂ñÊr&'í‚‚‚r¢uF∂ñÊrVvr‚‚‚s∞¢ñbÖˆÊW7EF∂Tfñ∆ƒV¬íˆÊW7EF∂Tfñ∆ƒV¬Á7Gñ∆RÁvñGFÇ“÷FÇÊ÷ñ‚É¬ÖˆÊW7DÜˆ∆EBÚ‰U5EıD¥UÙÑÙƒEı2í¢í≤rRs∞¢ˆÊW7EF∂TáVDV√ÚÊ6∆74∆ó7BÊFBÇwfó6ñ&∆Rrì∞¢ñbÖˆÊW7DÜˆ∆EB„“‰U5EıD¥UÙÑÙƒEı2í∞¢ˆÊW7DÜˆ∆EB“∞¢ˆÊW7EF∂TáVDV√ÚÊ6∆74∆ó7BÁ&V÷˜fRÇwfó6ñ&∆Rrì∞¢ÊW7BÁ&V÷ñÊñÊr“”∞¢ñÁfVÁF˜'ï∂ÊW7BÊóFV‘∂Wï““÷FÇÊ÷ñ‚Éìí¬ÜñÁfVÁF˜'ï∂ÊW7BÊóFV‘∂Wï“«¬í≤ì∞¢vñÊF˜r‰f&‘Êñ÷«2ÁVWVTóFV‘vVÊ˜GóRÜÊW7BÊóFV‘∂Wí¬ÊW7BÊvVÊ˜GóRì∞¢6∆◊ñÁfVÁF˜'ï7F6≤ÜÊW7BÊóFV‘∂Wíì∞¢'Vñ∆DñÁfVÁF˜'îw&ñBÇì≤&Vg&W6ÑóFV’67&ˆ∆¬Çì≤&Vg&W6Ñ7Fñˆ‰&"Çì∞¢6fT÷V÷&W%v˜&∆DFFÇì∞¢6Ü˜uFˆ7BÜG∂óFV‘ñ6ˆ‰f˜$∂WíÜÊW7BÊóFV‘∂Wíó“Fˆˆ≤G¥ïDT’ÙDTe5∂ÊW7BÊóFV‘∂Wï”ÚÊ∆&V¬«¬ÊW7BÊóFV‘∂Wó“G∂ÊW7BÁ&V÷ñÊñÊr‚ÚÇG∂ÊW7BÁ&V÷ñÊñÊw“∆VgBñ¢rw÷¬G'VRì∞¢–¢–¢gVÊ7Fñˆ‚6WD6÷W&¶ˆˆ’66∆Ráf«VRí∞¢6ˆÁ7B6fr“FW6∑F˜6ˆÁG&ˆ«46ˆÊfñrÇì∞¢6ˆÁ7B÷ñ‚“ÁV÷&W"Êó4fñÊóFRÑÁV÷&W"Ü6frÁvÜVV≈¶ˆˆ‘÷ñ‚ííÚÁV÷&W"Ü6frÁvÜVV≈¶ˆˆ‘÷ñ‚í¢„sS∞¢6ˆÁ7B÷Ç“ÁV÷&W"Êó4fñÊóFRÑÁV÷&W"Ü6frÁvÜVV≈¶ˆˆ‘÷ÇííÚÁV÷&W"Ü6frÁvÜVV≈¶ˆˆ‘÷Çí¢"„S∞¢5˜¶ˆˆ’66∆R“6∆◊ÑÁV÷&W"áf«VRí«¬„R¬÷ñ‚¬÷Çì∞¢6ˆÁ7B¶ˆˆ’6WGFñÊr“Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÇw6WGFñÊu¶ˆˆ“rì∞¢ñbá¶ˆˆ’6WGFñÊrí¶ˆˆ’6WGFñÊrÁf«VR“7G&ñÊrá5˜¶ˆˆ’66∆Rì∞¢WFFT6÷W&˜6óFñˆ‚Çì∞¢–¢Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÇw6WGFñÊu¶ˆˆ“ríÊFDWfVÁD∆ó7FVÊW"Çv6ÜÊvRr¬R”‚∞¢6WD6÷W&¶ˆˆ’66∆Rá'6Tf∆ˆBÜRÁF&vWBÁf«VRí«¬„Rì∞¢“ì∞†¢gVÊ7Fñˆ‚v÷T∆ˆ˜ÜÊ˜rí∞¢6ˆÁ7BGB“÷FÇÊ÷ñ‚É„B¬ÜÊ˜r“∆7EFñ÷RíÚì∞¢∆7EFñ÷R“Ê˜s∞†¢ñbá5ˆg46˜VÁFW"í∞¢ˆg4g&÷W2≤≥∞¢ˆg467V“≥“GC∞¢ñbÖˆg467V“„“„Rí∞¢g46˜VÁFW$V¬ÁFWáD6ˆÁFVÁB“÷FÇÁ&˜VÊBÖˆg4g&÷W2Úˆg467V“í≤re2s∞¢ˆg4g&÷W2“∞¢ˆg467V““∞¢–¢–†¢ñbÇv÷U7F'FVBí∞¢vñÊF˜r‰◊W6ñ3ÚÊVFñÙFV'VrÇwvóFñÊrf˜"v÷U7F'FVB&Vf˜&RVFñÚ∆ñ&6≤r¬vVFñÚ◊vóB÷v÷R◊7F'FVBr¬Sì∞¢&VÊFW&W"Á&VÊFW"á66VÊR¬6÷W&ì∞¢&WVW7DÊñ÷Fñˆ‰g&÷RÜv÷T∆ˆ˜ì∞¢&WGW&„∞¢–†¢v˜&∆E˜W'VÁFñ÷SÚÁWFFRÜÊ˜rì∞†¢WFFU66VÊUG&Á6óFñˆ‚ÜGBì∞†¢ÚÚ÷ñÊñ÷&VG&ró2Fá&˜GF∆VB(	BóBw2‚Úá¶ˆÊRFñ∆R6˜VÁBí6Áf0¢ÚÚ&WñÁB¬6ÜV'WBˆñÁF∆W72FÚ'V‚WfW'í6ñÊv∆Rg&÷R‡¢ˆ÷ñÊñ÷&VG&t67V“≥“GC∞¢ñbÖˆ÷ñÊñ÷&VG&t67V“„“„2í∞¢ˆ÷ñÊñ÷&VG&t67V““∞¢vñÊF˜rÂvñ∆FW&ÊW74÷Á&VÊFW$÷ñÊñ÷Çì∞¢–†¢ñbávñÊF˜r‰fó6ÜñÊsÚÁ7FFSÚÊ7FófRívñÊF˜r‰fó6ÜñÊrÁWFFRÜGBì∞†¢vñÊF˜r‰◊W6ñ3ÚÁWFFU&ñ‰VFñÚÇì∞¢vñÊF˜r‰◊W6ñ3ÚÁWFFTWáFW&ñ˜$&w2Çì∞¢vñÊF˜r‰◊W6ñ3ÚÁWFFTgW&ÊóGW&U6gÖ6˜W&6W2Çì∞¢vñÊF˜r‰◊W6ñ3ÚÁWFFT÷&ñVÁD7VW2Çì∞¢vñÊF˜r‰◊W6ñ3ÚÊ∆ˆtVFñıFñ6¥FñvÊ˜7Fñ72Çì∞†¢ñbÇW6VBí∞¢WFFT6∆VÊF"ÜGBì∞¢vñÊF˜rÂvVFÜW$eÇÂˆGfÊ6U6÷ˆ˜FÜVD∆ñváFñÊrÜGBì∞¢ˆ∆ƒ6ˆÁG&ˆ∆∆W$ñÁWBÇì∞¢WFFT÷˜fV÷VÁBÜGBì∞¢vñÊF˜rÂvñ∆FW&ÊW74÷ÁWFFTfˆt&˜VÊE∆ñW"Çì∞¢WFFU∆ñW%fóF«2ÜGBì∞¢vñÊF˜r‰∆6ÜV◊ï7ó7FV“ÁWFFRÇì∞¢vñÊF˜r‰&˜VÁGî&ˆ&BÁWFFUG&6∂ñÊrÜGBì∞†¢ÚÚ7FófR6ˆ◊ÊñˆÁ2ÊB6Ü˜V∆FW"WG2fˆ∆∆˜rFÜR∆ñW"Fá&˜VvÄ¢ÚÚWfW'í∆ñ&∆RñÁFW&ñ˜"‚'Vñ∆FñÊr7Fñ∆¬∆ˆFñÊrÜ2ÊÚ&V¿¢ÚÚFW7FñÊFñˆ‚66VÊRñWB¬6ÚvóB&VÜñÊBFÜRWÜó7FñÊr&∆6≤66VÊP¢ÚÚG&Á6óFñˆ‚&FÜW"FÜ‚7vÊñÊrfˆ∆∆˜vW"ñÁFÚ66VÊVw0¢ÚÚf∆∆&6≤ÊB∆VfñÊróBFÜW&RgFW"FÜR'Vñ∆FñÊrfñÊó6ÜW2‡¢6ˆÁ7B6ˆ◊ÊñˆÂ66VÊU&VGí“ˆó4'Vñ∆FñÊt&VÜ7W'&VÁD&Ví«¬ˆ'Vñ∆FñÊu66VÊW2ÊvWBÜ7W'&VÁD&Vì≤ÚÚvFW2ñÊFˆ˜"fˆ∆∆˜vW"66VÊRGF6Ü÷VÁB‡¢ñbÜ6ˆ◊ÊñˆÂ66VÊU&VGíí∞¢7ñÊ46ˆ◊Êñˆ‰g&ˆ’vÜó7F∆RÇì∞¢WFFT6ˆ◊ÊñˆÁ2ÜGBì∞¢–¢ÚÚ'VÁ2ñ‚WfW'í&V6ÚÁíÜ6Rˆb÷˜VÁBG&Á6óFñˆ‚ó26∆V&V@¢ÚÚñ÷÷VFñFV«íˆ‚VÁFW&ñÊr‚ñÁFW&ñ˜"‚÷˜VÁG2&V÷ñ‚WáFW&ñ˜"÷ˆÊ«í‡¢vñÊF˜r‰÷˜VÁG3ÚÁWFFT÷˜VÁE&ñFRÜGBì∞†¢ñbÜ7W'&VÁD&V””“vf&“r«¬7W'&VÁD&V””“wF˜v‚r«¬ˆó5¶ˆÊT&VÜ7W'&VÁD&Ví«¬ˆó46fW&‰'Vñ∆FñÊt&VÜ7W'&VÁD&Víí∞¢vñÊF˜r‰&ÊFóD6◊2ÁWFFT6ˆ◊ÊñˆÂW&6WFñˆ‚ÜGBì∞¢vñÊF˜r‰&ÊFóD6◊2ÁWFFT6◊&ÊÊW'2ÜGBì∞¢vñÊF˜rÂvñ∆F∆ñfU7v‚ÁWFFTÜ˜7Fñ∆U7vÊñÊrÜGBì∞¢WFFTÜ˜7Fñ∆W2ÜGBì∞¢vñÊF˜r‰7&VGW&TFVFÇÁWFFT6˜'6W2ÜGBì∞¢“V«6RñbÖˆó4'Vñ∆FñÊt&VÜ7W'&VÁD&Víí∞¢ÚÚ˜&FñÊ'í'Vñ∆FñÊrñÁFW&ñ˜'27Fñ∆¬ÜfRÊÚvñ∆B7vÁ3≤FÜó0¢ÚÚ'&Ê6ÇˆÊ«í∂VW2ÁíWFÜ˜&VBñÁFW&ñ˜"Ü˜7Fñ∆Rˆ6˜'6R7FófR‡¢WFFTÜ˜7Fñ∆W2ÜGBì∞¢vñÊF˜r‰7&VGW&TFVFÇÁWFFT6˜'6W2ÜGBì∞¢–†¢ñbÖˆó4'Vñ∆FñÊt&VÜ7W'&VÁD&VííWFFTÊW7DñÁFW&7Fñˆ‚ÜGBì∞¢ñbÖˆó5¶ˆÊT&VÜ7W'&VÁD&VíívñÊF˜r‰&ÊFóD6◊2ÁWFFUFVÁDñÁFW&7Fñˆ‚ÜGBì∞†¢ÚÚñÁFW&ñ˜"WÜóBFWFV7Fñˆ„¢∆ñW"v∆∑2ˆÁFÚÁíFˆ˜"w2WÜóB÷ÁV ¢ÚÚFá&W6Üˆ∆Bá6VRß2ˆÜ˜W6R◊ñV6W2Êß2w26ˆ◊WFTñÁFW&ñ˜$∆ñ˜WBÇíí‡¢ñbÜ7W'&VÁD&V””“vñÁFW&ñ˜"rbb66VÊUG&Á4Fó"””“í∞¢6ˆÁ7Bî6ˆ¬“÷FÇÊf∆ˆ˜"á∆ñW"ÁÇÚDîƒRí¬ï&˜r“÷FÇÊf∆ˆ˜"á∆ñW"ÁíÚDîƒRì∞¢ñbÖˆñÁFW&ñ˜$WÜóEFñ∆W2ÊÜ2Üî6ˆ¬≤r¬r≤ï&˜rííWÜóDñÁFW&ñ˜"Çì∞¢–†¢ÚÚG&Á6óFñˆ‚7˜G2Üf&“(iBñÁFW&ñ˜"(iBF˜v‚(iB'Vñ∆FñÊrê¢ñbá66VÊUG&Á4Fó"””“í6ÜV6µG&Á6óFñˆÂ7˜G2Çì∞†¢ñbÜ7W'&VÁD&V””“vf&“r«¬7W'&VÁD&V””“wF˜v‚rí∞¢vFW$f∆˜uÜ6R“ávFW$f∆˜uÜ6R≤GB¢2„"íR∞¢vñÊF˜rÂvVFÜW$eÇÁWFFUvFW%'Fñ6∆W2ÜGBì∞¢vñÊF˜rÂvVFÜW$eÇÁWFFU&ó∆W2ÜGBì∞¢vñÊF˜rÂvVFÜW$eÇÁWFFT∆ñváFÊñÊtf∆6ÇÜGBì∞¢–¢ñbÜ7W'&VÁD&V””“vf&“rívñÊF˜r‰FWufG2ÁWFFT÷W6Ö&˜FFñˆÁ2ÜGBì∞¢ñbÜ7W'&VÁD&V””“vf&“ríWFFU&ˆ6W76ñÊtgW&ÊóGW&UfgÇÜGBì∞¢WFFT7FñˆÂ'Fñ6∆W2ÜGBì∞¢vñÊF˜rÂvñ∆EG&V7W&RÁWFFU7&∂∆W2ÜGBì∞¢vñÊF˜r‰fó6ÜñÊsÚÁWFFTgÇÜGBì∞¢ÚÚvFW"6ñ“Fñ6∑2WfW'íÛÇv÷R÷Ü˜W"á„ó2&V¬◊Fñ÷Rê¢ÚÚW6W2v÷RFñ÷R6Ú&ñ‚ÊBG&ñÊvR&R6∆ˆ6≤÷6ˆÁ6ó7FVÁ@¢6ñ‘67V◊V∆F˜"≥“GBÚDïÙƒT‰uDÖı4T4Ù‰E2¢Ñ‰îtÖEÙÑıU"“‘ı$‰î‰uÙÑıU"ì≤ÚÚv÷R÷Ü˜W'2W"6V0¢ñbá6ñ‘67V◊V∆F˜"„“„#RbbÜ7W'&VÁD&V””“vf&“r«¬7W'&VÁD&V””“wF˜v‚ríí∞¢6ñ‘67V◊V∆F˜"”“„#S∞¢ñbÜ7W'&VÁD&V””“vf&“rí∞¢&V6ˆ◊WFUvFW"Üf«6Rì∞¢Fñ6µv˜&∆Dˆ&¶V7G2Çì∞¢“V«6R∞¢6ˆÁ7BD4Ù≈2“˜F˜vÂ¶ˆÊSÚÊ6ˆ«2«¬c¬E$ıu2“˜F˜vÂ¶ˆÊSÚÁ&˜w2«¬S∞¢&V6ˆ◊WFUvFW"Üf«6R¬F˜v‰w&ñB¬E$ıu2¬D4Ù≈2ì∞¢–¢vñÊF˜rÂvVFÜW$eÇÁ7vÂ&ó∆W2Çì∞¢–¢–†¢ÚÚ)H)H6÷W&6÷ˆ˜FÇfˆ∆∆˜r)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢6ˆÁ7BF&vWE˜6óFñˆ‚“7FófT6÷W&F&vWCÚÁ˜6óFñˆ„∞¢6ˆÁ7BwÇ“F&vWE˜6óFñˆ‚ÚF&vWE˜6óFñˆ‚ÁÇ¢∆ñW"ÁÇÚDîƒS∞¢6ˆÁ7Bw¢“F&vWE˜6óFñˆ‚ÚF&vWE˜6óFñˆ‚Á¢¢∆ñW"ÁíÚDîƒS∞¢6ˆÁ7Bwí“F&vWE˜6óFñˆ‚ÚF&vWE˜6óFñˆ‚Áí¢˜∆ñW$w&˜VÊEíÇì∞¢6ˆÁ7B6‘∆W'“6÷W&÷ˆFT6ˆÊfñrÜ7FófT6÷W&÷ˆFRíÊfˆ∆∆˜t∆W'ÛÚ„É∞¢6’F&vWEÇ≥“áwÇ“6’F&vWEÇí¢6‘∆W'∞¢6’F&vWE¢≥“áw¢“6’F&vWE¢í¢6‘∆W'∞¢6’F&vWEí≥“áwí“6’F&vWEíí¢6‘∆W'∞¢WFFT6÷W&˜6óFñˆ‚Çì∞†¢ÚÚFá&˜GF∆VBFÚ„tá¢¬Ê˜BWfW'íg&÷R(	BG&ófW2FÜRG&VR÷fFRF&vWG0¢ÚÚÜ˜6óGíÊB¬vÜñ∆RG&VRó27GV∆«í&∆ˆ6∂ñÊr¬FWFÖw&óFRí‡¢˜fVt7V∆ƒ67V“≥“GC∞¢ñbÖ˜fVt7V∆ƒ67V“„“„Bí∞¢6ˆÁ7Bf˜&6R“˜fVt7V∆ƒ67V“„“ì≤ÚÚfó'7BFñ6≤gFW"67&óB∆ˆ@¢˜fVt7V∆ƒ67V““∞¢WFFU¶ˆÊUfVvWFFñˆ‰7V∆∆ñÊrÜf˜&6Rì∞¢–¢WFFUG&VTfFTÊñ÷Fñˆ‚ÜGBì∞†¢ÚÚ6÷R6÷W&÷∆ñvÊVB÷6˜'&ñF˜"fó6ñ&ñ∆óGíFˆvv∆R¬6÷RFá&˜GF∆R¬f˜ ¢ÚÚFÜRFÇ'&ñ6≤6áVÊ∑2'Vñ«BˆÊ6R'í&Vvó7FW%FÑ'&ñ6¥6áVÊ∑2(	B6VP¢ÚÚWFFUFÑ'&ñ6¥7V∆∆ñÊr‡¢˜FÑ'&ñ6¥7V∆ƒ67V“≥“GC∞¢ñbÖ˜FÑ'&ñ6¥7V∆ƒ67V“„“„Bí∞¢6ˆÁ7Bf˜&6R“˜FÑ'&ñ6¥7V∆ƒ67V“„“ì∞¢˜FÑ'&ñ6¥7V∆ƒ67V““∞¢ñbÖ˜FÑ'&ñ6¥6áVÊ¥∆ó7G2Á6ó¶RíWFFUFÑ'&ñ6¥7V∆∆ñÊrÜ7W'&VÁD&V¬f˜&6Rì∞¢–†¢ÚÚ)H)HFá&VRÊß2WFFW2)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢WFFU∆ñW$÷W6ÇÜGBì∞¢WFFT«VÊvUG&ñ≈7F◊2ÜGBì∞¢ñbÇW6VBí∞¢WFFTÁ5v∆∂W'2ÜGBì∞¢ñbÜFñ∆ˆwVT˜V‚íf6TÁ4Fñ∆ˆwVU'Fñ6óÁG2Çì∞¢–¢ñbÜ7W'&VÁD&V””“wF˜v‚rí∞¢WFFUF˜vÂvFW$÷W6ÜW2Çì∞¢WFFUF˜vÂFá&VT∆ñváFñÊrÇì∞¢–¢ñbÖˆó5¶ˆÊT&VÜ7W'&VÁD&Víí∞¢WFFU¶ˆÊUvFW$÷W6ÜW2Ü7W'&VÁD&Vì∞¢–¢ÚÚFÜR∆ñW"6‚vñV∆BFˆˆ«2˜vVˆÁ2˜WG6ñFRFÜRf&“FˆÚáF˜v‚¿¢ÚÚWáFW&ñ˜"¶ˆÊW2í(	B'Vñ∆FñÊw2ˆf&÷Ü˜W6RñÁFW&ñ˜"ñÁFVÁFñˆÊ∆«ê¢ÚÚWÜ6«VFRFˆˆƒÜˆ∆FW"˜&WFñ6∆R÷W6ÜW2g&ˆ“FÜVó"66VÊRw&ÇñÁ7FVB‡¢ÚÚFV‚w26fW&‚ó2FÜRˆÊR'Vñ∆FñÊrWÜ6WFñˆ„¢óBw2&˜72÷fñvá@¢ÚÚ&VÊ¬6Ú6ˆ÷&BÜ2FÚv˜&≤FÜW&RFˆÚá6VRˆó46fW&‰'Vñ∆FñÊt&Ví‡¢ñbÜ7W'&VÁD&V””“vf&“r«¬7W'&VÁD&V””“wF˜v‚r«¬ˆó5¶ˆÊT&VÜ7W'&VÁD&Ví«¬ˆó46fW&‰'Vñ∆FñÊt&VÜ7W'&VÁD&Víí∞¢WFFUFˆˆƒ÷W6ÇÜGBì∞¢WFFT6ˆ÷&D6ˆÊUG&ñ¬Çì∞¢WFFT6Ü&vT7Fñˆ‚Çì∞¢vñÊF˜r‰6ˆ÷&CÚÁWFFRÜGBì∞¢WFFU&WFñ6∆T÷W6ÇÇì∞¢–¢ÚÚ◊W7B'V‚gFW"WFFUFˆˆƒ÷W6É¢GF6≤˜Fˆˆ¬˜6W26‚&˜FFRFÜP¢ÚÚ∆ñW"w2&ˆGígFW"WFFU∆ñW$÷W6Ç¬ÊBFÜRGF6ÜVBWBÊVVG0¢ÚÚFÜBfñÊ¬G&Á6f˜&“ñ‚FÜR6÷Rg&÷R‡¢WFFU6Ü˜V∆FW%WD÷W6Öñ‚Çì∞¢ñbÜ7W'&VÁD&V””“vf&“rí∞¢WFFUvFW$÷W6ÜW2Çì∞¢WFFT7&˜÷W6ÜW2Çì∞¢vñÊF˜r‰f&‘Êñ÷«2ÁWFFTÊñ÷ƒ÷W6ÜW2ÜGBì∞¢WFFUFá&VT∆ñváFñÊrÇì∞†¢ÚÚvñÊBÊñ÷Fñˆ‚ˆ‚fVvWFFñˆ‡¢6ˆÁ7BvñÊEFñ÷R“W&f˜&÷Ê6RÊÊ˜rÇíÚ∞¢6ˆÁ7BvñÊE7G$&6R“6∆VÊF"Êó5&ñÊñÊp¢ÚÜ6∆VÊF"Á&ñÂ7G&VÊwFÇ„“2Ú„¢„bê¢¢„3∞¢6ˆÁ7B˜∆ñW%EÇ“∆ñW"ÁÇÚDîƒS∞¢6ˆÁ7B˜∆ñW%E¢“∆ñW"ÁíÚDîƒS∞¢f˜"Ü6ˆÁ7Bf“ˆbfVt÷W6ÜW2í∞¢ñbáf“Ê÷FW&ñ¬bbf“Ê÷FW&ñ¬ÁVÊñf˜&◊2í∞¢f“Ê÷FW&ñ¬ÁVÊñf˜&◊2ÁUFñ÷RÁf«VR“vñÊEFñ÷S∞¢ÚÚ&˜Üñ÷óGí&ˆ˜7BˆÊ«íG&ñvvW'2vóFÜñ‚„"Fñ∆W2‚W6R6ÜV ¢ÚÚ÷ÊÜGF‚&R÷6ÜV6≤FÚ6∂ó÷FÇÊáó˜Bf˜"Fó7FÁB÷W6ÜW2‡¢6ˆÁ7BGÇ“÷FÇÊ'2áf“Á˜6óFñˆ‚ÁÇ“˜∆ñW%EÇì∞¢6ˆÁ7BG¢“÷FÇÊ'2áf“Á˜6óFñˆ‚Á¢“˜∆ñW%E¢ì∞¢∆WB&˜Üñ÷óGï7G#∞¢ñbÜGÇ¬„BbbG¢¬„Bí∞¢6ˆÁ7BFó7B“÷FÇÊáó˜BÜGÇ¬G¢ì∞¢&˜Üñ÷óGï7G"“Fó7B¬„"ÚvñÊE7G$&6R≤„"¢É„"“Fó7BíÚ„"¢vñÊE7G$&6S∞¢“V«6R∞¢&˜Üñ÷óGï7G"“vñÊE7G$&6S∞¢–¢f“Ê÷FW&ñ¬ÁVÊñf˜&◊2ÁU7G&VÊwFÇÁf«VR≥“á&˜Üñ÷óGï7G"“f“Ê÷FW&ñ¬ÁVÊñf˜&◊2ÁU7G&VÊwFÇÁf«VRí¢„S∞¢–¢–¢6ˆÁ7BvñÊE66∆R“vñÊE7G$&6RÚ„3∞¢f˜"Ü6ˆÁ7B˜ffíˆb˜fVtfˆ∆ñvT7FófRí∞¢6ˆÁ7Bfr“fVtfˆ∆ñvT÷W6ÜW5µ˜ffï”∞¢ñbÇfr«¬frÂ˜vñÊD◊í6ˆÁFñÁVS∞¢ÚÚ6∂ófˆ∆ñvRvV∆¬˜WG6ñFRFÜR6÷W&fñWr(	BóBvˆ‚wB&Rfó6ñ&∆R‡¢ñbÑ÷FÇÊ'2ÜfrÁ˜6óFñˆ‚ÁÇ“˜∆ñW%EÇí‚B«¬÷FÇÊ'2ÜfrÁ˜6óFñˆ‚Á¢“˜∆ñW%E¢í‚í6ˆÁFñÁVS∞¢6ˆÁ7B◊“frÂ˜vñÊD◊¢vñÊE66∆S∞¢frÁ&˜FFñˆ‚Á¢“◊¢÷FÇÁ6ñ‚ávñÊEFñ÷R¢„b≤frÂ˜vñÊEÜ6Rì∞¢frÁ&˜FFñˆ‚ÁÇ“◊¢„CR¢÷FÇÊ6˜2ávñÊEFñ÷R¢„≤frÂ˜vñÊEÜ6R¢„2ì∞¢–¢ñbÜw&74&ñ∆∆&ˆ&D÷Bí∞¢w&74&ñ∆∆&ˆ&D÷BÁVÊñf˜&◊2ÁUFñ÷RÁf«VR“vñÊEFñ÷S∞¢w&74&ñ∆∆&ˆ&D÷BÁVÊñf˜&◊2ÁU7G&VÊwFÇÁf«VR“5ˆ&ñ∆≈vñÊBÚvñÊE7G$&6R¢∞¢–¢–¢ñbÜ7W'&VÁD&V””“wF˜v‚rbbw&74&ñ∆∆&ˆ&D÷Bí∞¢ÚÚF˜v‚w&72&ñ∆∆&ˆ&G26Ü&RFÜRf&“w2vñÊB6ÜFW"ˆ÷FW&ñ¬¬6Ú∂VW ¢ÚÚFÜV“7vññÊrFˆÚ(	Bf&“w2&∆ˆ6≤&˜fRˆÊ«í'VÁ2vÜñ∆Rˆ‚FÜRf&“‡¢6ˆÁ7BvñÊEFñ÷R“W&f˜&÷Ê6RÊÊ˜rÇíÚ∞¢w&74&ñ∆∆&ˆ&D÷BÁVÊñf˜&◊2ÁUFñ÷RÁf«VR“vñÊEFñ÷S∞¢w&74&ñ∆∆&ˆ&D÷BÁVÊñf˜&◊2ÁU7G&VÊwFÇÁf«VR“5ˆ&ñ∆≈vñÊBÚÜ6∆VÊF"Êó5&ñÊñÊrÚÜ6∆VÊF"Á&ñÂ7G&VÊwFÇ„“2Ú„¢„bí¢„2í¢∞¢–†¢ÚÚ6ˆÁ7FÁB÷6˜7Bv˜&∆B&ñ„¢Fá&VRUb˜ñrWFFW2&Vv&F∆W72ˆbFVÁ6óGí‡¢vñÊF˜rÂ&ñÂ∆ÊW3ÚÁWFFRÜGBì∞†¢ÚÚ)H)H&VÊFW"7FófR66VÊR)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢6ˆÁ7B7FófU66VÊR“vWD7FófU66VÊRÇì∞¢ñbá5ˆ˜WF∆ñÊW2í∞¢ÚÚ6ˆ∆˜W"≤FWFÇñÁFÚ‚ˆfg67&VV‚F&vWB6ÚFÜR˜7B◊&ˆ6W70¢ÚÚ6ˆ◊˜6óFR&V∆˜r6‚&VB&V¬W"◊óÜV¬FWFÇgFW'v&G2(	@¢ÚÚ&VÊFW&ñÊr7G&ñváBFÚFÜR6Áf2v˜V∆B∆˜6RFÜBFWFÇ'VffW ¢ÚÚFÜR÷ˆ÷VÁBFÜRgV∆«67&VV‚6ˆ◊˜6óFRVB˜fW'w&óFW2óB‡¢&VÊFW&W"Á6WE&VÊFW%F&vWBÖˆ÷ñÂ%Bì∞¢&VÊFW&W"Á&VÊFW"Ü7FófU66VÊR¬6÷W&ì∞†¢ÚÚ&W6W'fRFÜR6ˆ∆˜W"ˆFWFÇ&W7V«BvÜñ∆R‰r6ñ∆Ü˜VWGFW2FBˆÊ«ê¢ÚÚFÜR÷ó76ñÊrˆ66«W6ñˆ‚FWFÇÊVVFVB'í&˜FÇ˜WF∆ñÊR7ó7FV◊2‡¢&VÊFW&W"ÊWFÙ6∆V$6ˆ∆˜"“f«6S∞¢&VÊFW&W"ÊWFÙ6∆V$FWFÇ“f«6S∞¢˜&VÊFW%Êu∆ÊT˜WF∆ñÊTˆ66«VFW$FWFÇÜ7FófU66VÊRì∞†¢ÚÚ6V∆V7FófR6ÜV∆¬˜WF∆ñÊR72Ü∆ñW"”ˆ&¶V7G2ˆÊ«íê¢7FófU66VÊRÊ˜fW'&ñFT÷FW&ñ¬“6ÜV∆ƒ˜WF∆ñÊT÷C∞¢6÷W&Ê∆ñW'2Á6WBÉì∞¢&VÊFW&W"Á&VÊFW"Ü7FófU66VÊR¬6÷W&ì∞¢6÷W&Ê∆ñW'2ÊVÊ&∆T∆¬Çì∞¢7FófU66VÊRÊ˜fW'&ñFT÷FW&ñ¬“ÁV∆√∞†¢ÚÚ6ˆ∆˜W&VBF&vWB˜WF∆ñÊR72Ü∆ñW"”"ˆ&¶V7G2(	Bw&VV‚∆∆˜vVB¬&VB&∆ˆ6∂VBê¢ñbÖ˜F&vWD˜WF∆ñÊT÷W6ÜW2Ê∆VÊwFÇ‚í∞¢66VÊRÊ˜fW'&ñFT÷FW&ñ¬“˜F&vWD˜WF∆ñÊT∆∆˜vVBÚF&vWD˜WF∆ñÊTw&VV‰÷B¢F&vWD˜WF∆ñÊU&VD÷C∞¢6÷W&Ê∆ñW'2Á6WBÉ"ì∞¢&VÊFW&W"Á&VÊFW"á66VÊR¬6÷W&ì∞¢6÷W&Ê∆ñW'2ÊVÊ&∆T∆¬Çì∞¢66VÊRÊ˜fW'&ñFT÷FW&ñ¬“ÁV∆√∞¢–¢&VÊFW&W"ÊWFÙ6∆V$6ˆ∆˜"“G'VS∞¢&VÊFW&W"ÊWFÙ6∆V$FWFÇ“G'VS∞†¢ÚÚgW&ÊóGW&R÷FW&ñ¬‘îB'VffW"Ü∆ñW"”2ˆ&¶V7G2ˆÊ«íí(	BfVVG2FÜP¢ÚÚ÷FW&ñ¬◊6V“VFvRFWFV7Fñˆ‚ñ‚FÜR6ˆ◊˜6óFR6ÜFW"&V∆˜r‡¢&VÊFW&W"Á6WE&VÊFW%F&vWBÖˆVFvTñE%Bì∞¢&VÊFW&W"Á6WD6∆V$6ˆ∆˜"ÉÉ¬ì∞¢&VÊFW&W"Ê6∆V"áG'VR¬G'VR¬f«6Rì∞¢6÷W&Ê∆ñW'2Á6WBÉ2ì∞¢7FófU66VÊRÊ˜fW'&ñFT÷FW&ñ¬“ˆgW&ÊóGW&TñD÷C∞¢&VÊFW&W"Á&VÊFW"Ü7FófU66VÊR¬6÷W&ì∞¢7FófU66VÊRÊ˜fW'&ñFT÷FW&ñ¬“ÁV∆√∞¢6÷W&Ê∆ñW'2ÊVÊ&∆T∆¬Çì∞†¢ÚÚFWFÇ÷ˆÊ«í6˜W&6Rf˜"FÜRFWFÇ÷VFvRFWFV7F˜"¬‰r◊∆ÊRfF'0¢ÚÚá6VRˆ÷&µÊu∆ÊRíÊBw&72&ñ∆∆&ˆ&G2áW6W$FFÊó4&ñ∆∆&ˆ&B¿¢ÚÚ6WBB7&VFñˆ‚ˆ‚WfW'íñÁ7FÊ6VD÷W6Ç'Vñ«Bg&ˆ“ˆw&74&∆FTvVÚê¢ÚÚÜñFFV‚f˜"FÜó272ˆÊ«í6ÚFÜVó"7&óFR7WF˜WB6ñ∆Ü˜VWGFW2Ê@¢ÚÚÊV"÷VFvR÷ˆ‚VBÊv∆W2ÊWfW"fVVBFÜRFWFV7F˜"2f«6RVFvW2‡¢ÚÚ˜B÷ñ‚ˆˆfb'íFVfV«B6ñÊ6RóBw2‚WáG&gV∆¬66VÊR72ˆ‚F˜ ¢ÚÚˆbWfW'óFÜñÊr&˜fR‡¢ñbá5ˆFWFÑ˜WF∆ñÊW2í∞¢6ˆÁ7BˆÜñFFV‰f˜$FWFÖ72“µ”∞¢7FófU66VÊRÁG&fW'6RÜÚ”‚∞¢ñbÇÜÚÁW6W$FFÊó5Êu∆ÊR«¬ÚÁW6W$FFÊó4&ñ∆∆&ˆ&BíbbÚÁfó6ñ&∆Rí∞¢ÚÁfó6ñ&∆R“f«6S∞¢ˆÜñFFV‰f˜$FWFÖ72ÁW6ÇÜÚì∞¢–¢“ì∞¢&VÊFW&W"Á6WE&VÊFW%F&vWBÖˆFWFÑˆÊ«ï%Bì∞¢7FófU66VÊRÊ˜fW'&ñFT÷FW&ñ¬“ˆFWFÑˆÊ«î÷C∞¢&VÊFW&W"Á&VÊFW"Ü7FófU66VÊR¬6÷W&ì∞¢7FófU66VÊRÊ˜fW'&ñFT÷FW&ñ¬“ÁV∆√∞¢ˆÜñFFV‰f˜$FWFÖ72Êf˜$V6ÇÜÚ”‚≤ÚÁfó6ñ&∆R“G'VS≤“ì∞¢–†¢ÚÚ6ˆ◊˜6óFS¢&∆VÊBFWFÇ÷Fó66ˆÁFñÁVóGí≤gW&ÊóGW&R÷FW&ñ¬◊6V–¢ÚÚ˜WF∆ñÊW2˜fW"FÜR&VÊFW&VB66VÊR¬7G&ñváBFÚFÜR6Áf2‡¢&VÊFW&W"Á6WE&VÊFW%F&vWBÜÁV∆¬ì∞¢˜˜7D÷BÁVÊñf˜&◊2ÁD6ˆ∆˜"Áf«VR“ˆ÷ñÂ%BÁFWáGW&S∞¢˜˜7D÷BÁVÊñf˜&◊2ÁDFWFÇÁf«VR“5ˆFWFÑ˜WF∆ñÊW2ÚˆFWFÑˆÊ«ï%BÊFWFÖFWáGW&R¢ˆ÷ñÂ%BÊFWFÖFWáGW&S∞¢˜˜7D÷BÁVÊñf˜&◊2ÁDVFvTñBÁf«VR“ˆVFvTñE%BÁFWáGW&S∞¢˜˜7D÷BÁVÊñf˜&◊2ÁDVFvTñDFWFÇÁf«VR“ˆVFvTñE%BÊFWFÖFWáGW&S∞¢˜˜7D÷BÁVÊñf˜&◊2ÁE66VÊTFWFÇÁf«VR“ˆ÷ñÂ%BÊFWFÖFWáGW&S∞¢˜˜7D÷BÁVÊñf˜&◊2ÁT6÷W&ÊV"Áf«VR“6÷W&ÊÊV#∞¢˜˜7D÷BÁVÊñf˜&◊2ÁT6÷W&f"Áf«VR“6÷W&Êf#∞¢˜˜7D÷BÁVÊñf˜&◊2ÁTFWFÑ˜WF∆ñÊW4ˆ‚Áf«VR“5ˆFWFÑ˜WF∆ñÊW2Ú¢∞¢˜˜7D÷BÁVÊñf˜&◊2ÁTFWFÖFá&W6Ö66∆RÁf«VR“5ˆFWFÑ˜WF∆ñÊUFá&W6Ö66∆S∞¢&VÊFW&W"Á&VÊFW"Ö˜˜7E66VÊR¬˜˜7D6÷W&ì∞¢“V«6R∞¢&VÊFW&W"Á6WE&VÊFW%F&vWBÜÁV∆¬ì∞¢&VÊFW&W"Á&VÊFW"Ü7FófU66VÊR¬6÷W&ì∞¢ÚÚ6ˆ∆˜W&VBF&vWB˜WF∆ñÊR72Ü∆ñW"”"ˆ&¶V7G2(	Bw&VV‚∆∆˜vVB¬&VB&∆ˆ6∂VBê¢ñbÖ˜F&vWD˜WF∆ñÊT÷W6ÜW2Ê∆VÊwFÇ‚í∞¢&VÊFW&W"ÊWFÙ6∆V$6ˆ∆˜"“f«6S∞¢&VÊFW&W"ÊWFÙ6∆V$FWFÇ“f«6S∞¢66VÊRÊ˜fW'&ñFT÷FW&ñ¬“˜F&vWD˜WF∆ñÊT∆∆˜vVBÚF&vWD˜WF∆ñÊTw&VV‰÷B¢F&vWD˜WF∆ñÊU&VD÷C∞¢6÷W&Ê∆ñW'2Á6WBÉ"ì∞¢&VÊFW&W"Á&VÊFW"á66VÊR¬6÷W&ì∞¢6÷W&Ê∆ñW'2ÊVÊ&∆T∆¬Çì∞¢66VÊRÊ˜fW'&ñFT÷FW&ñ¬“ÁV∆√∞¢&VÊFW&W"ÊWFÙ6∆V$6ˆ∆˜"“G'VS∞¢&VÊFW&W"ÊWFÙ6∆V$FWFÇ“G'VS∞¢–¢–†¢ÚÚ)H)H$B˜fW&∆ó2Ü6ˆ÷&BˆFV'Vrˆ∆ñváFÊñÊr¬«W2∆ñváFñÊrí)H)H ¢G&t˜fW&∆ó2Çì∞¢vñÊF˜rÂvVFÜW$eÇÊG&t∆ñváFñÊt˜fW&∆íÇì∞†¢vñÊF˜r‰Fñ∆ˆwVT6ˆÁFVÁCÚÁWFFTÁ4Fñ∆ˆwVU˜'G&óBÜÊ˜rì∞¢WFFTáVBÇì∞¢&WVW7DÊñ÷Fñˆ‰g&÷RÜv÷T∆ˆ˜ì∞¢–†¢ÚÚFV'VrÜóF&˜Çˆ6ˆ∆∆ñFW"˜fW&∆íÖ6WGFñÊw2(i"FWbFˆˆ«2(i"6Ü˜rÜóF&˜ÜW2ê¢ÚÚÊ˜r∆ófW2ñ‚ß2ˆFV'Vr÷ÜóF&˜ÜW2Êß2(	B6∆¬fñvñÊF˜r‰FV'VtÜóF&˜ÜW2ÊG&rÇí‡†¢ÚÚ)H)H$B˜fW&∆íG&ráv˜&∆B&ñ‚ó2&VÊFW&VB'í&ñÂ∆ÊW2í)H ¢gVÊ7Fñˆ‚G&t˜fW&∆ó2Çí∞¢6ˆÁ7B&V7B“˜Fá&VU&V7C∞¢6ˆÁ7Br“&V7BÁvñGFÇ¬Ç“&V7BÊÜVñváC∞¢ˆ7GÇÊ6∆V%&V7BÉ¬¬r¬Çì∞†¢ñbÜ7W'&VÁD&V””“vñÁFW&ñ˜"rí∞¢G&t7FñˆÂ'Fñ6∆W2Çì∞¢&WGW&„∞¢–†¢ñbÜ6∆VÊF"Êó5&ñÊñÊrí∞¢6ˆÁ7B7G"“6∆VÊF"Á&ñÂ7G&VÊwFÇ«¬∞¢6ˆÁ7Bó57F˜&““7G"„“3∞†¢ÚÚ∂VWFÜR6ÜVvVFÜW"FñÁBÜW&S≤ñÊFófñGV¬7G&V∑2Ê˜r∆ófRˆ‡¢ÚÚFá&VRv˜&∆B◊76R∆ÊW2ñ‚FÜRWÜó7FñÊrvV$t¬&VÊFW&W"‡¢ˆ7GÇÊfñ∆≈7Gñ∆R“ó57F˜&“Úw&v&É3√S√É√„ír¢w&v&Éc√É√√„Rís∞¢ˆ7GÇÊfñ∆≈&V7BÉ¬¬r¬Çì∞¢–†¢G&t6ˆ÷&D6ˆÊU&WFñ6∆RÇì∞¢G&uvVˆÂG&ñƒVffV7G2Çì∞¢G&t7FñˆÂFñ∆TVffV7G2Çì∞¢G&t7FñˆÂ'Fñ6∆W2Çì∞†¢ñbÜ∆ñváFÊñÊt«Ü‚í∞¢ˆ7GÇÊfñ∆≈7Gñ∆R“&v&É##√#C√#SR¬G∂∆ñváFÊñÊt«Ü¢„3W“ñ∞¢ˆ7GÇÊfñ∆≈&V7BÉ¬¬r¬Çì∞¢–†¢vñÊF˜r‰FV'VtÜóF&˜ÜW2ÊG&rÇì∞¢–†¢gVÊ7Fñˆ‚÷&µFñ∆TFó'GíÜ6ˆ¬¬&˜rí∞¢ˆñÁf∆ñFFT7&˜∆ó7BÇì∞¢&Vg&W6ÖFñ∆T÷W6ÇÜ6ˆ¬¬&˜rì∞¢ÚÚE$T‰4Çı$ï4TB6ÜRFWVÊG2ˆ‚vÜñ6ÇÊVñvÜ&˜'26Ü&RFÜVó"GóR¬6ÚÁê¢ÚÚ6ÜÊvRFÜB6˜V∆B«FW"FÜ˜6R6ˆÊÊV7FñˆÁ2◊W7B«6Ú&Vg&W6ÇFÜ˜6RÊVñvÜ&˜'2‡¢f˜"Ü6ˆÁ7B∂F2¬G%“ˆbµ≥¬”“≈≥√“≈≤”√“≈≥√’“í∞¢6ˆÁ7BÁB“w&ñE∑&˜r≤G%”ÚÂ∂6ˆ¬≤F5”ÚÁGóS∞¢ñbÜÁB””“Fñ∆UGóRÂE$T‰4Ç«¬ÁB””“Fñ∆UGóRÂ$ï4TBê¢&Vg&W6ÖFñ∆T÷W6ÇÜ6ˆ¬≤F2¬&˜r≤G"ì∞¢–¢–†¢gVÊ7Fñˆ‚WFFT6∆VÊF"ÜGBí∞†¢6ˆÁ7B&Wfñ˜W4Ü˜W"“vñÊF˜r‰6∆VÊF%7ó7FV“ÊvWDÜ˜W"Çì∞¢6∆VÊF"ÁFñ÷S≥“GBÚDïÙƒT‰uDÖı4T4Ù‰E3∞¢ñbÜ6∆VÊF"ÁFñ÷S„“í∞¢6∆VÊF"ÁFñ÷S”“∞¢GfÊ6TFíÇì∞¢–¢6ˆÁ7B7W'&VÁDÜ˜W"“vñÊF˜r‰6∆VÊF%7ó7FV“ÊvWDÜ˜W"Çì∞¢ñbÑ÷FÇÊf∆ˆ˜"á&Wfñ˜W4Ü˜W"í”“÷FÇÊf∆ˆ˜"Ü7W'&VÁDÜ˜W"íí∞¢vñÊF˜rÂvVFÜW$eÇÁWFFU&ñÂ7FFRÇì∞¢ñbÑ÷FÇÊf∆ˆ˜"Ü7W'&VÁDÜ˜W"í””“‘ı$‰î‰uÙÑıU"í≤Fñ6¥7&˜FíÇì≤vñÊF˜rÂvVFÜW$eÇÊ6ÜV6¥f˜$÷¶˜%7F˜&“Çì≤v˜&∆Dˆ&¶V7D÷˜&ÊñÊuFñ6≤Çì≤–¢ÚÚ6ÜVˆÊ6R◊W"÷ñ‚÷v÷R÷Ü˜W"f«W6ÇáÊWfW'í"&V¬6V6ˆÊG2BFÜP¢ÚÚFVfV«BDïÙƒT‰uDÖı4T4Ù‰E2í6Ú7&6Çˆf˜&6R÷6∆˜6R&WGvVV‚Fê¢ÚÚ&ˆ∆∆˜fW'27Fñ∆¬ˆÊ«í∆˜6W2fWr÷ñÁWFW2ˆbñ‚÷v÷RFñ÷P¢ÚÚñÁ7FVBˆbFÜRvÜˆ∆R6W76ñˆ‚(	B6VR˜6fUv˜&∆D6∆VÊF"‡¢˜6fUv˜&∆D6∆VÊF"Çì∞¢–¢–†¢gVÊ7Fñˆ‚GfÊ6TFíÇí∞¢6∆VÊF"ÊFí≥“∞¢vñÊF˜rÂvVFÜW$eÇÊ6Üˆ˜6UvVFÜW$f˜$FíÇì∞¢Fñ6¥7&˜FíÇì∞¢vñÊF˜r‰f&‘Êñ÷«2ÁFñ6¥'&VVFñÊrÇì∞¢vñÊF˜r‰f&‘Êñ÷«2ÁFñ6µ&W6˜W&6W2Çì∞¢vñÊF˜rÂ&ˆ6VGW&≈F6∑2Ê÷ñ&U&Vg&W6Ñ&ˆ&EF6≤Çì∞¢∆7D7Fñˆ‰÷W76vR“FíG∂6∆VÊF"ÊFó“&VvñÁ3¢G∂6∆VÊF"ÁvVFÜW'“Ê∞¢6ÜV6µF˜FÜ≈6ÜñgBÇì∞¢ÚÚÁíFV‚vóVB˜WB6ñÊ6RóB7F'FVBvóFñÊr6‚Ê˜r&R÷˜fVB&6∞¢ÚÚñÁFÚ(	B6VRVÁ7W&T7W'&VÁE¶ˆÊTFVÂ6∑2¬vÜñ6ÇFˆW2FÜR7GV¿¢ÚÚÜ∆ßí¬7W'&VÁB◊¶ˆÊR÷ˆÊ«íí7vÊñÊrˆÊ6RFÜó2fó&W2‡¢vñÊF˜rÂvñ∆F∆ñfU7v‚Ê6∆V%VÊFñÊtFVÂ&W7v‚Çì∞¢vñÊF˜rÂ&VvVÁE∆ÁG2Á&W7v‰∆≈¶ˆÊU&VvVÁG2Çì∞¢vñÊF˜rÂvñ∆D&W'&ñW2Á&W7v‰∆¬Çì∞¢vñÊF˜rÂvñ∆EG&V7W&RÁ&W7v‰∆¬Çì∞¢Fñ6¥fV∆∆VEG&VU&Vw&˜wFÇÇì∞¢Fñ6¥÷ñÊVE&ˆ6µ&Vw&˜wFÇÇì∞¢˜6fUv˜&∆D6∆VÊF"Çì∞¢–†¢ÚÚ6∆VWñÊrñ‚&VBá6VRvWDñÁFW&ñ˜$ñÁFW&7F&∆TBí6∂ó27G&ñváBF¢ÚÚFÜRÊWáB÷˜&ÊñÊr&FÜW"FÜ‚vóFñÊrf˜"6∆VÊF"ÁFñ÷SFÚw& ¢ÚÚÊGW&∆«í(	B6÷RFí◊&ˆ∆∆˜fW"v˜&≤2GfÊ6TFíÇíávVFÜW"&W&ˆ∆¬¿¢ÚÚ7&˜w&˜wFÇ¬F˜FÜ¬6ÜñgB6ÜV6≤¬FV‚&W7vÁ2í¬«W2&W6WGFñÊrFÜP¢ÚÚ6∆ˆ6≤óG6V∆bÊB&W7F˜&ñÊrFÜR∆ñW"¬vÜñ6ÇGfÊ6TFíÇíFˆW6‚w@¢ÚÚÊVVBFÚFÚ6ñÊ6RóBˆÊ«íWfW"fó&W2g&ˆ“&V¬V∆6VB◊Fñ÷Rw&‡¢gVÊ7Fñˆ‚6∆VWñ‰&VBÇí∞¢6∆VÊF"ÊFí≥“∞¢6∆VÊF"ÁFñ÷S“≤ÚÚv∂RB‘ı$‰î‰uÙÑıU ¢vñÊF˜rÂvVFÜW$eÇÊ6Üˆ˜6UvVFÜW$f˜$FíÇì≤ÚÚ«6Ú&W7ñÊ72ó5&ñÊñÊr˜&ñÂ7G&VÊwFÇFÚFÜRÊWrÜ˜W ¢Fñ6¥7&˜FíÇì∞¢vñÊF˜r‰f&‘Êñ÷«2ÁFñ6¥'&VVFñÊrÇì∞¢vñÊF˜r‰f&‘Êñ÷«2ÁFñ6µ&W6˜W&6W2Çì∞¢vñÊF˜rÂ&ˆ6VGW&≈F6∑2Ê÷ñ&U&Vg&W6Ñ&ˆ&EF6≤Çì∞¢6ÜV6µF˜FÜ≈6ÜñgBÇì∞¢vñÊF˜rÂvñ∆F∆ñfU7v‚Ê6∆V%VÊFñÊtFVÂ&W7v‚Çì∞¢vñÊF˜rÂ&VvVÁE∆ÁG2Á&W7v‰∆≈¶ˆÊU&VvVÁG2Çì∞¢vñÊF˜rÂvñ∆EG&V7W&RÁ&W7v‰∆¬Çì∞¢Fñ6¥fV∆∆VEG&VU&Vw&˜wFÇÇì∞¢Fñ6¥÷ñÊVE&ˆ6µ&Vw&˜wFÇÇì∞¢∆ñW"ÊÜV«FÇ“∆ñW"Ê÷ÑÜV«FÉ∞¢∆ñW"Á7F÷ñÊ“∆ñW"Ê÷Ö7F÷ñÊ∞¢6ˆÁ7B◊6r“	˘ãB6∆WBVÁFñ¬÷˜&ÊñÊr‚FíG∂6∆VÊF"ÊFó“&VvñÁ3¢G∂6∆VÊF"ÁvVFÜW'“Ê∞¢∆7D7Fñˆ‰÷W76vR“◊6s∞¢˜6fUv˜&∆D6∆VÊF"Çì∞¢&WGW&‚≤ˆ≥¢G'VR¬÷W76vS¢◊6r”∞¢–†¢ÚÚvVFÜW"&ˆ∆∆ñÊrÜ6Üˆ˜6UvVFÜW$f˜$Fí˜WFFU&ñÂ7FFRíÊ˜r∆ófW0¢ÚÚñ‚ß2˜vVFÜW"÷gÇÊß2(	B6∆¬fñvñÊF˜rÂvVFÜW$eÇ‚¢‡†¢gVÊ7Fñˆ‚Fñ6¥7&˜FíÇí∞¢f˜"Ü∆WB&˜r“≤&˜r¬$ıu3≤&˜r≤≤í∞¢f˜"Ü∆WB6ˆ¬“≤6ˆ¬¬4Ù≈3≤6ˆ¬≤≤í∞¢6ˆÁ7BFñ∆R“w&ñE∑&˜u’∂6ˆ≈”∞¢ñbÇFñ∆RÊ7&˜í6ˆÁFñÁVS∞¢6ˆÁ7BFF“7&˜FF∑Fñ∆RÊ7&˜”∞¢6ˆÁ7B◊V¬“7&˜w&˜wFÑ◊V«Fó∆ñW"áFñ∆R¬6ˆ¬¬&˜rì∞¢6ˆÁ7BFóF6Ö7G&W72“FFÊÊVVG4F¶6VÁDFóF6ÇbbÜ4F¶6VÁDFóF6ÇÜ6ˆ¬¬&˜ríÚvÊVVG2FóF6Çr¢rs∞¢Fñ∆RÁ7G&W72“FóF6Ö7G&W72«¬Ü◊V¬¬„RÚáFñ∆RÁvFW"¬FFÊñFVƒ÷ñ‚ÚwFˆÚG'ír¢wvFW&∆ˆvvVBrê¢¢◊V¬¬„bÚáFñ∆RÁvFW"¬FFÊñFVƒ÷ñ‚ÚvG'ír¢wFˆÚvWBrê¢¢rrì∞¢Fñ∆RÊ7&˜vR≥“◊V√∞¢Fñ∆RÊ7&˜&VGí“Fñ∆RÊ7&˜vR„“FFÊw&˜tFó3∞¢–¢–¢–†¢ÚÚ&WGW&Á2‚„w&˜wFÇ&FR&6VBˆ‚Ü˜r6∆˜6RFñ∆RÁvFW"ó2FÚ7&˜ñFV¬&ÊB‡¢gVÊ7Fñˆ‚6Â∆ÁD7&˜ˆÂFñ∆RÜ7&˜¬Fñ∆Rí∞¢ñbÇ7&˜FF∂7&˜“í&WGW&‚f«6S∞¢&WGW&‚µFñ∆UGóRÂDîƒƒTB¬Fñ∆UGóRÂ$ï4TE“ÊñÊ6«VFW2áFñ∆RÁGóRíbbFñ∆RÊ7&˜∞¢–†¢gVÊ7Fñˆ‚Ü4F¶6VÁDFóF6ÇÜ6ˆ¬¬&˜rí∞¢&WGW&‚6&FñÊƒÊVñvÜ&˜'2Ü6ˆ¬¬&˜ríÁ6ˆ÷RáˆñÁB”‚w&ñE∑ˆñÁBÁ&˜u’∑ˆñÁBÊ6ˆ≈“ÁGóR””“Fñ∆UGóRÂE$T‰4Çì∞¢–†¢gVÊ7Fñˆ‚7&˜w&˜wFÑ◊V«Fó∆ñW"áFñ∆R¬6ˆ¬¬&˜rí∞¢ñbÇFñ∆RÊ7&˜í&WGW&‚∞¢6ˆÁ7BFF“7&˜FF∑Fñ∆RÊ7&˜”∞¢6ˆÁ7B≤ñFVƒ÷ñ‚¬ñFVƒ÷Ç““FF∞¢6ˆÁ7Br“Fñ∆RÁvFW"Ú‘ÖıtDU#∞¢∆WBvFW$◊V√∞¢ñbár„“ñFVƒ÷ñ‚bbr√“ñFVƒ÷ÇívFW$◊V¬“„∞¢V«6Rñbár¬ñFVƒ÷ñ‚ívFW$◊V¬“÷FÇÊ÷ÇÉ¬ár“ÜñFVƒ÷ñ‚“„BííÚ„Bì∞¢V«6RvFW$◊V¬“÷FÇÊ÷ÇÉ¬ÇÜñFVƒ÷Ç≤„Bí“ríÚ„Bì∞¢6ˆÁ7BFóF6Ñ◊V¬“FFÊÊVVG4F¶6VÁDFóF6ÇbbÜ4F¶6VÁDFóF6ÇÜ6ˆ¬¬&˜ríÚ„cR¢„∞¢&WGW&‚vFW$◊V¬¢FóF6Ñ◊V√∞¢–†¢ÚÚfW&vRvFW"g&7Fñˆ‚É‚„í7&˜72w&ñBw2Êˆ‚◊6ˆ∆ñBFñ∆W2(	BW6V@¢ÚÚ2FÜR&Ü˜rvWBó2FÜó2∆6R˜fW&∆¬"&VFñÊrFÜRf"FW'&ñ‚Ê@¢ÚÚVFvRñÊf∆˜rG&6≤‚&ófW'2˜7G&V◊2&RñÊ6«VFVBBFÜVó"ñÊÊV@¢ÚÚ‘ÖıtDU"¬6÷R2Áí˜FÜW"Fñ∆R¬6ñÊ6RFÜWíw&R&V¬vWBw&˜VÊB‡¢gVÊ7Fñˆ‚ftw&ñEvFW$∆WfV¬áF&vWDw&ñB¬&˜w2¬6ˆ«2í∞¢∆WB7V““¬‚“∞¢f˜"Ü∆WB&˜r“≤&˜r¬&˜w3≤&˜r≤≤í∞¢f˜"Ü∆WB6ˆ¬“≤6ˆ¬¬6ˆ«3≤6ˆ¬≤≤í∞¢6ˆÁ7BB“F&vWDw&ñE∑&˜u’∂6ˆ≈”∞¢ñbÜó56ˆ∆ñBáBÁGóRíí6ˆÁFñÁVS∞¢7V“≥“BÁvFW"Ú‘ÖıtDU#∞¢‚≤≥∞¢–¢–¢&WGW&‚‚Ú7V“Ú‚¢∞¢–†¢ÚÚ)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢ÚÚtDU"4î’TƒDîÙ‡¢ÚÚ÷ˆFV√¢V6ÇFñ∆RÜ2f∆ˆBvFW&“FWFÇ&˜fRóG2f∆ˆ˜"‡¢ÚÚf∆ˆ˜"£¢$ï4TC“≥¬Ê˜&÷√”¬E$T‰4É“”¬$Ù4≤ı4Ö%T#◊6ˆ∆ñBÜÊÚf∆˜rí‡¢ÚÚvFW"7W&f6R“f∆ˆ˜%¢áGóRí≤vFW"‡¢ÚÚV6Ç6ñ“Fñ6≤Ü6∆∆VBg&ˆ“v÷T∆ˆ˜ÊWfW'í„w2ì†¢ÚÚ‚&ñ‚FG2FWFÇFÚWfW'íÊˆ‚◊6ˆ∆ñBFñ∆R‡¢ÚÚ"‚6ˆñ¬'6˜'Fñˆ‚G&ñÁ26÷∆¬÷˜VÁB‡¢ÚÚ2‚7&˜72◊Fñ∆Rf∆˜s¢vFW"÷˜fW2g&ˆ“ÜñvÇ◊7W&f6RFÚ∆˜r◊7W&f6P¢ÚÚÊVñvÜ&˜W'2¬6˜WFÇ÷&ñ6VB¬Ü∆b÷FñffW&VÊ6RW"Fñ6≤‡¢ÚÚG&VÊ6ÜW2V∆¬vóFÇE$T‰4ÖÙdƒıuÙ$ÙÂU2◊V«Fó∆ñW"‡¢ÚÚB‚˜fW&f∆˜s¢ÁívFW"&˜fR‘ÖıtDU"ó26ÜVBFÚÊVñvÜ&˜W'2‡¢ÚÚVFvW3¢6˜WFÇó2'VÊˆfb˜WF∆WBÜ«vó2v2ì≤vW7BˆV7BñÁ7FVB6VW ¢ÚÚvFW"î‚g&ˆ“FÜR7W'&˜VÊFñÊrf"FW'&ñ‚¬6ÚF÷÷ñÊrFÜRÊ˜'FÇ◊6˜WFÄ¢ÚÚ6ÜÊÊV¬∆ˆÊR6‚wB7WBˆfbFÜRvÜˆ∆R÷á6VR4îDUÙî‰dƒıuı$DRí‡¢ÚÚFÜRf&“w2f"FW'&ñ‚G&6∑2FÜRF˜v‚w2˜fW&∆¬vFW"∆WfV√≤FÜP¢ÚÚF˜v‚ÜÜfñÊrÊÚW7G&V“w&ñBˆbóG2˜v‚íG&6∑2óG2˜v‚fW&vR‡¢ÚÚvÜFWfW"vFW"7GV∆«í&V6ÜW2V6Ç6˜WFÇ÷VFvR6ˆ«V÷‚«6ÚG&ófW0¢ÚÚFÜB6ˆ«V÷‚w2f"◊FW'&ñ‚∆WfV¬ßW7B7BFÜR÷w26˜WFÇVFvR¬6Ú¢ÚÚ∆ñW"÷÷FRG'ívBFÜR&˜GFˆ“&˜r6ˆÁFñÁVW2˜WBñÁFÚFÜRf ¢ÚÚFW'&ñ‚ñÁ7FVBˆb7F˜ñÊrFVBBFÜR6V“Üf%6˜WFÑ∆WfV¬˜F˜vÂ6˜WFÑ∆WfV¬í‡¢ÚÚ)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y †¢gVÊ7Fñˆ‚&V6ˆ◊WFUvFW"ÜFV6îˆÊ«í¬F&vWDw&ñB“w&ñB¬&˜w2“$ıu2¬6ˆ«2“4Ù≈2í∞¢6ˆÁ7B7G"“6∆VÊF"Á&ñÂ7G&VÊwFÇ«¬∞¢6ˆÁ7Bó5&ñÊñÊr“6∆VÊF"Êó5&ñÊñÊrbbFV6îˆÊ«ì∞¢6ˆÁ7Bó5F˜v‚“F&vWDw&ñB””“F˜v‰w&ñC∞†¢ÚÚFÜRf"FW'&ñ‚w2∆WfV¬f˜"FÜó2w&ñBw2VFvW3¢FÜRF˜v‚G&6∑2óG0¢ÚÚ˜v‚fW&vRÜóBÜ2Ê˜FÜñÊrW7G&V“ˆbóBì≤FÜRf&“G&6∑2FÜP¢ÚÚF˜v‚w2∆7B÷∂Ê˜v‚fW&vR¬6ÚFÜRF˜v‚w2vFW"6Ü˜w2W&WñˆÊBFÜP¢ÚÚf&“w2VFvW2FˆÚ‚&VB&Vf˜&R72◊WFFW2ÁóFÜñÊr¬ˆÊRFñ6≤ˆ`¢ÚÚ∆ró2ñ◊W&6WFñ&∆RBFÜó26ñ“w2„„w26FVÊ6R‡¢6ˆÁ7Bf$∆WfV¬“ó5F˜v‚Úftw&ñEvFW$∆WfV¬áF&vWDw&ñB¬&˜w2¬6ˆ«2í¢˜F˜vÂvFW$∆WfV√∞¢ñbÜó5F˜v‚í˜F˜vÂvFW$∆WfV¬“f$∆WfV√∞†¢ÚÚ72¢&ñ‚≤'6˜'Fñˆ‚≤Wf˜&Fñˆ‚≤VFvRWÜ6ÜÊvP¢f˜"Ü∆WB&˜r“≤&˜r¬&˜w3≤&˜r≤≤í∞¢f˜"Ü∆WB6ˆ¬“≤6ˆ¬¬6ˆ«3≤6ˆ¬≤≤í∞¢6ˆÁ7BB“F&vWDw&ñE∑&˜u’∂6ˆ≈”∞¢ñbÜó56ˆ∆ñBáBÁGóRíí6ˆÁFñÁVS∞¢BÊf∆˜r“f«6S∞†¢ÚÚ&ófW'2˜7G&V◊2&RW&÷ÊVÁBvFW"&ˆGí¬Ê˜B'BˆbFÜP¢ÚÚó'&ñvFñˆ‚6ñ“(	B«vó2gV∆¬¬ÊWfW"'6˜&&VBˆWf˜&FVBˆG&ñÊVB‡¢ñbáBÁGóR””“Fñ∆UGóRÂ$ïdU"«¬BÁGóR””“Fñ∆UGóRÂ5E$T“í∞¢BÁvFW"“‘ÖıtDU#∞¢6ˆÁFñÁVS∞¢–†¢ñbÜó5&ñÊñÊrí∞¢6ˆÁ7B&ñ‰◊V¬“BÁGóR””“Fñ∆UGóRÂE$T‰4ÇÚ"„ ¢¢BÁGóR””“Fñ∆UGóRÂDEíÚ„B¢„∞¢BÁvFW"≥“$îÂı$DR¢7G"¢&ñ‰◊V√∞†¢ÚÚ&ñ‚w&GV∆«í6ñ«G2G&VÊ6ÜW2&6≤ñ„≤ˆÊ6RgV∆«í6ñ«FVBFÜP¢ÚÚG&VÊ6Ç&WfW'G2FÚ∆ñ‚w&72á6ñÊv∆R◊FFñr&W7F˜&W2FWFÇFÚí‡¢ñbáBÁGóR””“Fñ∆UGóRÂE$T‰4Çí∞¢BÊFWFÇ“÷FÇÊ÷ÇÉ¬áBÊFWFÇÛÚí“E$T‰4Öı4î≈Eı$DR¢7G"ì∞¢ñbáBÊFWFÇ√“í∞¢BÁGóR“Fñ∆UGóR‰u$53≤BÊFWFÇ“∞¢ÚÚFÜó2◊WFFW2Fñ∆RÁGóR˜WG6ñFRÁíˆbFÜRÊ˜&÷¿¢ÚÚFñrˆfñ∆¬ˆ7Fñˆ‚Fá2¬vÜñ6Ç&RFÜRˆÊ«í∆6W2FÜ@¢ÚÚ˜FÜW'vó6R6∆¬÷&µFñ∆TFó'Gí(	BvóFÜ˜WBóB¬FÜRG&VÊ6Çw0¢ÚÚFó'B◊óB÷W6ÇÊBw&72&ñ∆∆&ˆ&G2f˜"FÜó2Fñ∆RÊWfW ¢ÚÚvWB&V'Vñ«BFÚ÷F6ÇFÜRÊWrGóR¬∆VfñÊr7F∆Ró@¢ÚÚ÷W6Ç6óGFñÊrVÊFW"Ü˜"w&72GVgG27&˜WFñÊrFá&˜VvÇí¢ÚÚFñ∆RFÜRFFÊ˜r6ó2ó2∆ñ‚w&72‡¢ñbÇó5F˜v‚í÷&µFñ∆TFó'GíÜ6ˆ¬¬&˜rì∞¢–¢–¢–†¢ÚÚ6ˆñ¬'6˜'Fñˆ‡¢6ˆÁ7B'6˜&"“%4ı$%ı$DU∑BÁGóU“ÛÚ„#∞¢BÁvFW"“÷FÇÊ÷ÇÉ¬BÁvFW"“'6˜&"ì∞†¢ÚÚWf˜G&Á7ó&Fñˆ‚(	B6∆˜r&6∂w&˜VÊB∆˜72ˆ‚∆¬Fñ∆W0¢BÁvFW"“÷FÇÊ÷ÇÉ¬BÁvFW"“Udı$DRì∞†¢ÚÚ6˜WFÇ÷VFvR'VÊˆfb(	B&˜GFˆ“"&˜w2G&ñ‚vw&W76ófV«íÜw&fóGí˜WF∆WBê¢ñbá&˜r„“&˜w2“"í∞¢6ˆÁ7B'VÊˆfe&FR“&˜r””“&˜w2“Ú„Ç¢„3∞¢BÁvFW"“÷FÇÊ÷ÇÉ¬BÁvFW"“'VÊˆfe&FRì∞¢–†¢ÚÚvW7BˆV7BVFvRñÊf∆˜r(	BFÜRf"FW'&ñ‚6VW2vFW"ñÁFÚFÜP¢ÚÚ6ñFR6ˆ«V÷Á2F˜v&BóG2˜v‚∆WfV¬¬VÁFW&ñÊrFÜR÷g&ˆ“FÜP¢ÚÚ6ñFW2ñÁ7FVBˆbˆÊ«íWfW"G&ñÊñÊr˜WBFÜR6˜WFÇ‡¢ñbÜ6ˆ¬””“«¬6ˆ¬””“6ˆ«2“í∞¢6ˆÁ7BF&vWB“f$∆WfV¬¢‘ÖıtDU#∞¢ñbáBÁvFW"¬F&vWBíBÁvFW"≥“áF&vWB“BÁvFW"í¢4îDUÙî‰dƒıuı$DS∞¢–†¢BÁvFW"“÷FÇÊ÷ñ‚áFñ∆UvFW$66óGíáBí¬BÁvFW"ì∞¢–¢–†¢ÚÚ72#¢7&˜72◊Fñ∆Rf∆˜r(	B&ˆ6W726˜WFé(i&Ê˜'FÇf˜"6˜WFáv&B&ñ0¢6ˆÁ7BFó'2“∞¢≤F3¢¬G#¢“¬ÚÚ6˜WFÄ¢≤F3¢¬G#¢“¬ÚÚV7@¢≤F3¢”¬G#¢“¬ÚÚvW7@¢≤F3¢¬G#¢”“¬ÚÚÊ˜'FÄ¢”∞†¢f˜"Ü∆WB&˜r“&˜w2“≤&˜r„“≤&˜r““í∞¢f˜"Ü∆WB6ˆ¬“≤6ˆ¬¬6ˆ«3≤6ˆ¬≤≤í∞¢6ˆÁ7BB“F&vWDw&ñE∑&˜u’∂6ˆ≈”∞¢ÚÚ&ófW'2˜7G&V◊2FˆÊFRÊÚvFW"FÚÊVñvÜ&˜W'2(	B6ˆÁFñÊVB&ˆGí¬ÊÚ7ñ∆∆˜fW"‡¢ñbÜó56ˆ∆ñBáBÁGóRí«¬BÁvFW"√“«¬BÁGóR””“Fñ∆UGóRÂ$ïdU"«¬BÁGóR””“Fñ∆UGóRÂ5E$T“í6ˆÁFñÁVS∞†¢∆WB7W&d“f∆ˆ˜%¢áBÁGóR¬BÊFWFÇí≤BÁvFW#∞†¢f˜"Ü6ˆÁ7B≤F2¬G"“ˆbFó'2í∞¢6ˆÁ7BÊ2“6ˆ¬≤F2¬Á"“&˜r≤G#∞¢ñbÜÊ2¬«¬Ê2„“6ˆ«2«¬Á"¬«¬Á"„“&˜w2í6ˆÁFñÁVS∞¢6ˆÁ7B‚“F&vWDw&ñE∂Á%’∂Ê5”∞¢ñbÜó56ˆ∆ñBÜ‚ÁGóRíí6ˆÁFñÁVS∞†¢6ˆÁ7B7W&d"“f∆ˆ˜%¢Ü‚ÁGóR¬‚ÊFWFÇí≤‚ÁvFW#∞¢6ˆÁ7BÜVB“7W&d“7W&d#∞¢ñbÜÜVB√“„í6ˆÁFñÁVS∞†¢ÚÚ6ñ«FVB÷ñ‚á6Ü∆∆˜ríG&VÊ6ÇV∆«2vFW"∆W72VvW&«íFÜ‚g&W6ÇˆÊR‡¢6ˆÁ7B&ˆÁW2“Ü‚ÁGóR””“Fñ∆UGóRÂE$T‰4ÇíÚE$T‰4ÖÙdƒıuÙ$ÙÂU2¢÷FÇÊ÷ÇÉ„R¬‚ÊFWFÇÛÚí¢„∞¢∆WBG&Á6fW"“÷FÇÊ÷ñ‚ÜÜVB¢dƒıuı$DR¢&ˆÁW2¢„R¬BÁvFW"ì∞¢G&Á6fW"“÷FÇÊ÷ñ‚áG&Á6fW"¬Fñ∆UvFW$66óGíÜ‚í“‚ÁvFW"ì∞¢ñbáG&Á6fW"√“í6ˆÁFñÁVS∞†¢BÁvFW"”“G&Á6fW#∞¢‚ÁvFW"≥“G&Á6fW#∞¢7W&d“f∆ˆ˜%¢áBÁGóR¬BÊFWFÇí≤BÁvFW#≤ÚÚWFFRgFW"G&Á6fW ¢ñbÜ‚ÁGóR””“Fñ∆UGóRÂE$T‰4Çí‚Êf∆˜r“G'VS∞¢ñbáBÁGóR””“Fñ∆UGóRÂE$T‰4ÇíBÊf∆˜r“G'VS∞¢ÚÚFˆ‚wB'&V≤(	B∆∆˜r◊V«Fó∆RG&Á6fW'2W"Fñ6≤f˜"f7FW"7&V@¢–¢–¢–†¢ÚÚ723¢6∆◊ ¢f˜"Ü∆WB&˜r“≤&˜r¬&˜w3≤&˜r≤≤í∞¢f˜"Ü∆WB6ˆ¬“≤6ˆ¬¬6ˆ«3≤6ˆ¬≤≤í∞¢6ˆÁ7BB“F&vWDw&ñE∑&˜u’∂6ˆ≈”∞¢BÁvFW"“6∆◊áBÁvFW"¬¬Fñ∆UvFW$66óGíáBíì∞¢–¢–†¢ÚÚ72C¢f"◊FW'&ñ‚v6ˆÁFñÁVFñˆ‚(	BV6Ç6ˆ«V÷‚w26˜WFÇ÷VFvP¢ÚÚFñ∆Rá˜7B÷f∆˜r¬6ÚóB&Vf∆V7G2ÁíW7G&V“F÷÷ñÊríV6W2FÜP¢ÚÚ÷F6ÜñÊrf"◊FW'&ñ‚6ˆ«V÷‚∆WfV¬F˜v&BóB‚∆ñW"vÜÚ&∆ˆ6∑0¢ÚÚvFW"g&ˆ“&V6ÜñÊrFÜB6ˆ«V÷‚w2&˜GFˆ“&˜rG&ófW2óG2f"◊FW'&ñ‡¢ÚÚ∆WfV¬F˜v&BFˆÚ¬6ÚFÜRG'ív∂VW2vˆñÊr7BFÜR÷VFvR‡¢∞¢6ˆÁ7B6˜WFÑ∆WfV¬“ó5F˜v‚ÚF˜vÂ6˜WFÑ∆WfV¬¢f%6˜WFÑ∆WfV√∞¢6ˆÁ7B6˜WFÖ&˜r“F&vWDw&ñE∑&˜w2“”∞¢f˜"Ü∆WB6ˆ¬“≤6ˆ¬¬6ˆ«3≤6ˆ¬≤≤í∞¢6ˆÁ7BVFvTg&2“6∆◊á6˜WFÖ&˜u∂6ˆ≈“ÁvFW"Ú‘ÖıtDU"¬¬ì∞¢6˜WFÑ∆WfV≈∂6ˆ≈“≥“ÜVFvTg&2“6˜WFÑ∆WfV≈∂6ˆ≈“í¢d%ı4ıUDÖıE$4µı$DS∞¢–¢–†¢ÚÚ6ñvÊ¬FÜR÷F6ÜñÊr÷W6ÇWFFW"FÚFÚgV∆¬&Vg&W6ÇFÜó2g&÷R‡¢ñbÜó5F˜v‚í˜F˜vÂvFW%6ñ‘Fó'Gí“G'VS∞¢V«6R˜vFW%6ñ‘Fó'Gí“G'VS∞¢–†¢gVÊ7Fñˆ‚G&VÊ6ÑÊVñvÜ&˜'2Ü6ˆ¬¬&˜rí∞¢ÚÚW6VB'ívFW"&˜WFñÊs¢6˜WFÇó2fó'7BFÚ&W6W'fRFÜRfó6ñ&∆RÊ˜'FÇ◊FÚ◊6˜WFÇ&ñ2‡¢&WGW&‚∞¢≤6ˆ¬¬&˜s¢&˜r≤“¿¢≤6ˆ√¢6ˆ¬“¬&˜r“¿¢≤6ˆ√¢6ˆ¬≤¬&˜r“¿¢≤6ˆ¬¬&˜s¢&˜r“–¢“Êfñ«FW"Üó4ñÁ6ñFTw&ñBì∞¢–†¢gVÊ7Fñˆ‚6&FñÊƒÊVñvÜ&˜'2Ü6ˆ¬¬&˜rí∞¢&WGW&‚∞¢≤6ˆ¬¬&˜s¢&˜r““¿¢≤6ˆ√¢6ˆ¬≤¬&˜r“¿¢≤6ˆ¬¬&˜s¢&˜r≤“¿¢≤6ˆ√¢6ˆ¬“¬&˜r–¢“Êfñ«FW"Üó4ñÁ6ñFTw&ñBì∞¢–†¢gVÊ7Fñˆ‚ó4ñÁ6ñFTw&ñBáˆñÁBí∞¢&WGW&‚ˆñÁBÊ6ˆ¬„“bbˆñÁBÊ6ˆ¬¬4Ù≈2bbˆñÁBÁ&˜r„“bbˆñÁBÁ&˜r¬$ıu3∞¢–†¢gVÊ7Fñˆ‚6WD7FófUFˆˆ¬áFˆˆ¬¬˜G2“∑“í∞¢ñbÇFˆˆƒ7FñˆÁ5∑Fˆˆ≈“í&WGW&„∞¢ÚÚñ6∂ñÊrFˆˆ¬Fá&˜VvÇÁíˆbFÜRÊ˜&÷¬Fá2Ü&2¬FñvóB∂Wó2¿¢ÚÚ67&ˆ∆¬ívÜñ∆RFÜRvVˆ‚Vñ6≤◊7vóF6Çó2VÊvvVB6Ê6V«2óG0¢ÚÚ'&WGW&‚FÚÇ"÷V÷˜'í(	BFÜW&Rw2Ê˜FÜñÊr6VÁ6ñ&∆R∆VgBFÚ&WGW&‚FÚ‡¢ñbáFˆˆ¬”“wvVˆ‚rívVˆÂVñ6µ7vóF6Ö6fVB“ÁV∆√∞¢7FófUFˆˆ¬“Fˆˆ√∞¢6ˆÁ7B7FñˆÁ2“Fˆˆƒ7FñˆÁ5∑Fˆˆ≈”∞¢ñbÇ7FñˆÁ2ÊñÊ6«VFW2Ü7FófT7Fñˆ‚íí7FófT7Fñˆ‚“7FñˆÁ5≥”∞¢6ˆÁ7BWVóVB“WVó÷VÁE6∆˜G5∑Fˆˆ≈”∞¢6ˆÁ7BFVb“DÙÙ≈ÙïDT’ÙDTe5∂WVóVE”∞¢6ˆÁ7Bf∆∆&6¥ñ6ˆ‚“≤6Ü˜fV√¢~)∏˛˚àÚr¬ÜˆS¢	˙©2r¬ÜS¢	˙©2r¬ñ6≥¢~)∏˛˚àÚr¬Ü'ˆˆ„¢	¯Í2r¬vVˆ„¢	˘z˚àÚr¬÷6ÜWFS¢	˘z˚àÚr’∑Fˆˆ≈“«¬	˘Jrs∞¢6ˆÁ7B∆&V¬“FVcÚÊ∆&V¬«¬≤6Ü˜fV√¢u6Ü˜fV¬r¬ÜˆS¢tÜˆRr¬ÜS¢tÜRr¬ñ6≥¢uñ6≤r¬Ü'ˆˆ„¢tÜ'ˆˆ‚r¬vVˆ„¢uvVˆ‚r¬÷6ÜWFS¢uvVˆ‚r’∑Fˆˆ≈“«¬Fˆˆ√∞¢Fˆˆƒ'F‰ñ6ˆ‚ÊñÊÊW$ÖD‘¬“Fˆˆ≈6V∆V7Dñ6ˆ‰ÖD‘¬ÜFVb¬f∆∆&6¥ñ6ˆ‚¬s„ÉVV“rì∞¢Fˆˆƒ'F‰∆&V¬ÁFWáD6ˆÁFVÁB“∆&V√∞¢Fˆˆ≈ñ6¥'FÁ2Êf˜$V6ÇÜ"”‚"Ê6∆74∆ó7BÁFˆvv∆RÇv7FófRr¬"ÊFF6WBÁFˆˆ¬””“Fˆˆ¬íì∞¢ÚÚ7vfó6ñ&∆RFˆˆ¬÷W6Ä¢ˆ&¶V7BÁf«VW2áFˆˆƒ÷W6Ñ÷íÊf˜$V6ÇÜ“”‚≤ñbÜ“íFˆˆƒÜˆ∆FW"Á&V÷˜fRÜ“ì≤“ì∞¢ñbáFˆˆƒ÷W6Ñ÷∑Fˆˆ≈“íFˆˆƒÜˆ∆FW"ÊFBáFˆˆƒ÷W6Ñ÷∑Fˆˆ≈“ì∞¢6∆˜6UFˆˆ≈ñ6∂W"Çì∞¢&Vg&W6Ñ7Fñˆ‰&"Çì∞¢&Vg&W6ÖvVˆÂ7vóF6Ñ'F‚Çì∞¢ÚÚ˜G2Á6ñ∆VÁC¢áñG&FñÊrFÜRFˆˆ¬ÜV∆B∆7B6W76ñˆ‚á6VP¢ÚÚ7vÂ∆ñW$fF"í6Ü˜V∆F‚wB˜%Ç6V∆V7FVB"Fˆ7Bˆ‚∆ˆvñ‚‡¢ñbÇ˜G2Á6ñ∆VÁBí∞¢6ˆÁ7B◊6r“G∂∆&V«“6V∆V7FVBÊ∞¢∆7D7Fñˆ‰÷W76vR“◊6s∞¢6Ü˜uFˆ7BÜ◊6r¬G'VRì∞¢–¢6fTWVó÷VÁE6∆˜G2Çì∞¢–†¢ÚÚvVˆ‚Vñ6≤◊7vóF6Çñ6ˆ‚«vó26Ü˜w2vÜFWfW"w27GV∆«íWVóVBñ‡¢ÚÚFÜRvVˆ‚6∆˜BÜÊ˜BÊV6W76&ñ«íFÜR7FófRFˆˆ¬í(	BóG2Ê7FófR6∆70¢ÚÚáFˆvv∆VBWfW'íg&÷Rñ‚WFFT÷˜fV÷VÁBíó2vÜB6Ü˜w2FÜR7W'&VÁ@¢ÚÚñ‚ˆ˜WB7FFR‡¢gVÊ7Fñˆ‚&Vg&W6ÖvVˆÂ7vóF6Ñ'F‚Çí∞¢ñbÇ'FÂvVˆÂ7vóF6Ññ6ˆ‚í&WGW&„∞¢6ˆÁ7BFVb“DÙÙ≈ÙïDT’ÙDTe5∂WVó÷VÁE6∆˜G2ÁvVˆÂ”∞¢'FÂvVˆÂ7vóF6Ññ6ˆ‚ÊñÊÊW$ÖD‘¬“Fˆˆ≈6V∆V7Dñ6ˆ‰ÖD‘¬ÜFVb¬	˘z˚àÚr¬s„ÉVV“rì∞¢–†¢ÚÚ&W72ˆÊ6S¢6Ê6Ü˜BvÜFWfW"Fˆˆ¬ˆóFV“ó27W'&VÁF«í7FófRÊBßV◊ ¢ÚÚ7G&ñváBFÚFÜRvVˆ‚6∆˜B‚&W72vñ„¢&W7F˜&RFÜB6Ê6Ü˜B‡¢ÚÚFÜó2ó2FÜRˆÊ«íFÇFÜB6WG27FófUFˆˆ¬FÚwvVˆ‚rÊ˜r(	BóBw0¢ÚÚ&VV‚&V÷˜fVBg&ˆ“tÑTT≈ı4ƒıE2áFÜR&VwV∆"Fˆˆ¬◊6V∆V7B7ñ6∆Rí‡¢gVÊ7Fñˆ‚Fˆvv∆UVñ6µvVˆÂ7vóF6ÇÇí∞¢ñbávVˆÂVñ6µ7vóF6Ö6fVBí∞¢6ˆÁ7B6fVB“vVˆÂVñ6µ7vóF6Ö6fVC∞¢vVˆÂVñ6µ7vóF6Ö6fVB“ÁV∆√∞¢ÚÚ&W7F˜&RFÜRVÊFW&«ññÊrFˆˆ¬6∆˜Bfó'7BÜñ6ˆ‚ˆ÷W6Çˆ7FñˆÁ2í¬FÜV‡¢ÚÚ&R÷VÁFW"óFV“÷ˆFRˆ‚F˜ˆbóBñbFÜBw2vÜBv27FófR‡¢6WD7FófUFˆˆ¬á6fVBÁFˆˆ¬ì∞¢ñbá6fVBÊÜV∆D÷ˆFR””“vóFV“rí∞¢ÜV∆D÷ˆFR“vóFV“s∞¢7FófTóFV‘ñÊFWÇ“6fVBÊóFV‘ñÊFWÉ∞¢&Vg&W6ÑóFV’67&ˆ∆¬Çì∞¢&Vg&W6Ñ7Fñˆ‰&"Çì∞¢“V«6R∞¢ÜV∆D÷ˆFR“wFˆˆ¬s∞¢–¢“V«6R∞¢vVˆÂVñ6µ7vóF6Ö6fVB“≤ÜV∆D÷ˆFR¬Fˆˆ√¢7FófUFˆˆ¬¬óFV‘ñÊFWÉ¢7FófTóFV‘ñÊFWÇ”∞¢ÜV∆D÷ˆFR“wFˆˆ¬s∞¢6WD7FófUFˆˆ¬ÇwvVˆ‚rì∞¢–¢–†¢gVÊ7Fñˆ‚6WD7FófT7Fñˆ‚Ü7Fñˆ‚í∞¢7FófT7Fñˆ‚“7Fñˆ„∞¢&Vg&W6Ñ7Fñˆ‰&"Çì∞¢W6T7FófT7Fñˆ‚Çì∞¢–†¢ÚÚ)H)HFˆˆ¬vÜVV¬á&Fñ¬ñ6∂W"í)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢6ˆÁ7BFˆˆ≈vÜVVƒ˜fW&∆í“Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÇwFˆˆ≈vÜVVƒ˜fW&∆írì∞¢6ˆÁ7BFˆˆ≈vÜVVƒV¬“Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÇwFˆˆ≈vÜVV¬rì∞¢ÚÚwvVˆ‚rFV∆ñ&W&FV«íWÜ6«VFVB(	BóBw2&V6Ü&∆RˆÊ«ífñFÜP¢ÚÚFVFñ6FVBvVˆ‚Vñ6≤◊7vóF6ÇáFˆvv∆UVñ6µvVˆÂ7vóF6Çí¬Ê˜BFÜP¢ÚÚ&VwV∆"Fˆˆ¬◊6V∆V7B7ñ6∆R‡¢6ˆÁ7BtÑTT≈ı4ƒıE2“≤w6Ü˜fV¬r¬vÜˆRr¬vÜRr¬wñ6≤r¬vÜ'ˆˆ‚u”∞¢6ˆÁ7BtÑTT≈ı$DïU2“s#≤ÚÚÇ(	BFó7FÊ6Rg&ˆ“6VÁFW"FÚV6Ç7ˆ∂R'WGFˆ‡†¢∆WBFˆˆ≈ñ6∂W$˜V‚“f«6S∞†¢gVÊ7Fñˆ‚˜VÂFˆˆ≈ñ6∂W"Çí∞¢Fˆˆ≈ñ6∂W$˜V‚“G'VS∞¢6ˆÁ7B&V7B“Fˆˆƒ'F‚ÊvWD&˜VÊFñÊt6∆ñVÁE&V7BÇì∞¢6ˆÁ7B7Ç“&V7BÊ∆VgB≤&V7BÁvñGFÇÚ#∞¢6ˆÁ7B7í“&V7BÁF˜≤&V7BÊÜVñváBÚ#∞†¢ÚÚ6∆◊6VÁFW"6Ú∆¬7ˆ∂R'WGFˆÁ27FígV∆«íˆ‚67&VV‡¢6ˆÁ7B÷&vñ‚“tÑTT≈ı$DïU2≤3#∞¢6ˆÁ7Bv7Ç“÷FÇÊ÷ÇÜ÷&vñ‚¬÷FÇÊ÷ñ‚ávñÊF˜rÊñÊÊW%vñGFÇ“÷&vñ‚¬7Çíì∞¢6ˆÁ7Bv7í“÷FÇÊ÷ÇÜ÷&vñ‚¬÷FÇÊ÷ñ‚ávñÊF˜rÊñÊÊW$ÜVñváB“÷&vñ‚¬7ííì∞†¢Fˆˆ≈vÜVVƒV¬ÊñÊÊW$ÖD‘¬“rs∞¢6ˆÁ7B‚“tÑTT≈ı4ƒıE2Ê∆VÊwFÉ∞¢tÑTT≈ı4ƒıE2Êf˜$V6ÇÇá6∆˜B¬íí”‚∞¢6ˆÁ7BÊv∆R“ÜíÚ‚í¢÷FÇÂí¢"“÷FÇÂíÚ#≤ÚÚ“F˜ ¢6ˆÁ7B7Ç“v7Ç≤÷FÇÊ6˜2ÜÊv∆Rí¢tÑTT≈ı$DïU3∞¢6ˆÁ7B7í“v7í≤÷FÇÁ6ñ‚ÜÊv∆Rí¢tÑTT≈ı$DïU3∞†¢6ˆÁ7BWVóVD∂Wí“WVó÷VÁE6∆˜G5∑6∆˜E”∞¢6ˆÁ7BWFVb“WVóVD∂WíÚDÙÙ≈ÙïDT’ÙDTe5∂WVóVD∂Wï“¢ÁV∆√∞¢6ˆÁ7Bñ6ˆ‚“WFVcÚÊñ6ˆ‚«¬á∑6Ü˜fV√¢~)∏˛˚àÚr∆ÜˆS¢	˙©2r«vVˆ„¢	˘z˚àÚr∆ÜS¢	˙©2r«ñ6≥¢~)∏˛˚àÚr∆Ü'ˆˆ„¢	¯Í2w“ï∑6∆˜E“«¬	˘Jrs∞¢6ˆÁ7B∆&V¬“á∑6Ü˜fV√¢u6Ü˜fV¬r∆ÜˆS¢tÜˆRr«vVˆ„¢uvVˆ‚r∆ÜS¢tÜRr«ñ6≥¢uñ6≤r∆Ü'ˆˆ„¢tÜ'ˆˆ‚w“ï∑6∆˜E“«¬6∆˜C∞†¢6ˆÁ7B7ˆ∂R“Fˆ7V÷VÁBÊ7&VFTV∆V÷VÁBÇvFóbrì∞¢7ˆ∂RÊ6∆74Ê÷R“wGr◊7ˆ∂Rs∞¢7ˆ∂RÁ7Gñ∆RÊ775FWáB“∆VgC¢G∑7á◊É∑F˜¢G∑7ó◊É∂Êñ÷Fñˆ‚÷FV∆ì¢G∂í¢„á◊6∞†¢6ˆÁ7B'F‚“Fˆ7V÷VÁBÊ7&VFTV∆V÷VÁBÇv'WGFˆ‚rì∞¢'F‚Ê6∆74Ê÷R“wGr÷'F‚r≤Ü7FófUFˆˆ¬””“6∆˜BÚr7FófRr¢rrì∞¢'F‚ÁFWáD6ˆÁFVÁB“ñ6ˆ„∞†¢6ˆÁ7B6Üó“Fˆ7V÷VÁBÊ7&VFTV∆V÷VÁBÇw7‚rì∞¢6ÜóÊ6∆74Ê÷R“wGr÷6Üós∞¢6ÜóÁFWáD6ˆÁFVÁB“∆&V√∞†¢7ˆ∂RÊVÊD6Üñ∆BÜ'F‚ì∞¢7ˆ∂RÊVÊD6Üñ∆BÜ6Üóì∞†¢6ˆÁ7Bñ6≤“Çí”‚≤6WD7FófUFˆˆ¬á6∆˜Bì≤6∆˜6UFˆˆ≈ñ6∂W"Çì≤”∞¢'F‚ÊFDWfVÁD∆ó7FVÊW"ÇwˆñÁFW'Wr¬ÜRí”‚≤RÁ7F˜&˜vFñˆ‚Çì≤ñ6≤Çì≤“ì∞†¢Fˆˆ≈vÜVVƒV¬ÊVÊD6Üñ∆Bá7ˆ∂Rì∞¢“ì∞†¢Fˆˆ≈vÜVVƒ˜fW&∆íÊ6∆74∆ó7BÊFBÇv˜V‚rì∞¢Fˆˆ≈vÜVVƒV¬Ê6∆74∆ó7BÊFBÇv˜V‚rì∞¢Fˆˆƒ'F‚Á6WDGG&ñ'WFRÇv&ñ÷WáÊFVBr¬wG'VRrì∞¢Fˆˆƒ'F‚Á7Gñ∆RÊ&˜&FW$6ˆ∆˜"“w&v&É#Cí√##b√3Ç√„bís∞¢–†¢gVÊ7Fñˆ‚6∆˜6UFˆˆ≈ñ6∂W"Çí∞¢Fˆˆ≈ñ6∂W$˜V‚“f«6S∞¢Fˆˆ≈vÜVVƒ˜fW&∆íÊ6∆74∆ó7BÁ&V÷˜fRÇv˜V‚rì∞¢Fˆˆ≈vÜVVƒV¬Ê6∆74∆ó7BÁ&V÷˜fRÇv˜V‚rì∞¢Fˆˆ≈vÜVVƒV¬ÊñÊÊW$ÖD‘¬“rs∞¢Fˆˆƒ'F‚Á6WDGG&ñ'WFRÇv&ñ÷WáÊFVBr¬vf«6Rrì∞¢Fˆˆƒ'F‚Á7Gñ∆RÊ&˜&FW$6ˆ∆˜"“rs∞¢–†¢ÚÚ)H)H˜WFW"&6Ç(	BFˆˆ¬bóFV“&2÷Fñ¬)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢∞¢6ˆÁ7BˆóFV‘'F‚“Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÇvóFV‘'F‚rì∞¢6ˆÁ7B$5ı2“sR¬$5ÙR“ìS∞¢6ˆÁ7B÷ˆ&ñ∆T6ˆÁG&ˆ«2“vñÊF˜rÂ45$D4Ñ$Ù‰U5Ù4Ù‰dîsÚÊv÷SÚÊ÷ˆ&ñ∆T6ˆÁG&ˆ«2«¬∑”∞¢6ˆÁ7B6ˆÊfñwW&VE6fT÷&vñÂÇ“ÁV÷&W"Ü÷ˆ&ñ∆T6ˆÁG&ˆ«2Á6fT÷&vñÂÇì∞¢6ˆÁ7B4dUÙ““ÁV÷&W"Êó4fñÊóFRÜ6ˆÊfñwW&VE6fT÷&vñÂÇíÚ6ˆÊfñwW&VE6fT÷&vñÂÇ¢∞¢6ˆÁ7B˜WFW$&6Ö&FóW46∆◊“÷ˆ&ñ∆T6ˆÁG&ˆ«2Ê˜WFW$&6ÉÚÁ&FóW46∆◊«¬∑”∞†¢gVÊ7Fñˆ‚ˆ6∆◊VEf÷ñ‚á≤÷ñÂÇ¬f÷ñ‚¬÷ÖÇ“í∞¢6ˆÁ7BfñWw˜'D÷ñ‚“÷FÇÊ÷ñ‚ávñÊF˜rÊñÊÊW%vñGFÇ¬vñÊF˜rÊñÊÊW$ÜVñváBì∞¢6ˆÁ7B6ˆÊfñwW&VEf÷ñ‚“ÁV÷&W"áf÷ñ‚ì∞¢6ˆÁ7B&VfW'&VEÇ“fñWw˜'D÷ñ‚¢ÑÁV÷&W"Êó4fñÊóFRÜ6ˆÊfñwW&VEf÷ñ‚íÚ6ˆÊfñwW&VEf÷ñ‚¢íÚ∞¢6ˆÁ7B∆˜vW%Ç“ÁV÷&W"Ü÷ñÂÇì∞¢6ˆÁ7BWW%Ç“ÁV÷&W"Ü÷ÖÇì∞¢ñbÇ∑&VfW'&VEÇ¬∆˜vW%Ç¬WW%Ö“ÊWfW'íÑÁV÷&W"Êó4fñÊóFRíí&WGW&‚∞¢&WGW&‚÷FÇÊ÷ñ‚áWW%Ç¬÷FÇÊ÷ÇÜ∆˜vW%Ç¬&VfW'&VEÇíì∞¢–†¢gVÊ7Fñˆ‚ˆ˜WFW%"Çí∞¢6ˆÁ7B6ˆ≈Ç“'6Tf∆ˆBÜvWD6ˆ◊WFVE7Gñ∆RÜFˆ7V÷VÁBÊFˆ7V÷VÁDV∆V÷VÁBíÊvWE&˜W'Gïf«VRÇr“÷6ˆ¬ríì∞¢&WGW&‚ÁV÷&W"Êó4fñÊóFRÜ6ˆ≈Çíbb6ˆ≈Ç‚Ú6ˆ≈Ç¢¢ˆ6∆◊VEf÷ñ‚Ü˜WFW$&6Ö&FóW46∆◊ì∞¢–¢gVÊ7Fñˆ‚ˆ&5BÜFVrí∞¢6ˆÁ7B"“ˆ˜WFW%"Çí¬“FVr¢÷FÇÂíÚÉ∞¢&WGW&‚≤É¢vñÊF˜rÊñÊÊW%vñGFÇ≤÷FÇÊ6˜2Üí¢"“4dUÙ“¿¢ì¢vñÊF˜rÊñÊÊW$ÜVñváB“÷FÇÁ6ñ‚Üí¢"“4dUÙ“”∞¢–¢gVÊ7Fñˆ‚ˆ6˜&ÊW$ÊráÇ¬íí∞¢&WGW&‚÷FÇÊF„"Ç“áí“vñÊF˜rÊñÊÊW$ÜVñváBí¬Ç“vñÊF˜rÊñÊÊW%vñGFÇí¢ÉÚ÷FÇÂì∞¢–†¢∆WBˆ&4V«2“µ“¬ˆ&4&B“ÁV∆¬¬ˆ&4˜V‚“ÁV∆¬¬ˆ&56∆˜G2“µ“¬ˆ&47FófR“”∞¢∆WBˆfFñÊtV«2“µ”∞†¢gVÊ7Fñˆ‚ˆ6∆V$&2Çí∞¢ñbÖˆ&4&Bí≤ˆ&4&BÁ&V÷˜fRÇì≤ˆ&4&B“ÁV∆√≤–¢ˆ&4V«2Êf˜$V6ÇÜR”‚RÁ&V÷˜fRÇíì≤ˆ&4V«2“µ”∞¢ˆfFñÊtV«2Êf˜$V6ÇÜR”‚RÁ&V÷˜fRÇíì≤ˆfFñÊtV«2“µ”∞¢ˆ&56∆˜G2“µ”≤ˆ&47FófR“”≤ˆ&4˜V‚“ÁV∆√∞¢Fˆˆƒ'F‚Á7Gñ∆RÁfó6ñ&ñ∆óGí“rs∞¢ñbÖˆóFV‘'F‚íˆóFV‘'F‚Á7Gñ∆RÁfó6ñ&ñ∆óGí“rs∞¢–†¢gVÊ7Fñˆ‚ˆ÷µ6∆˜BÜFVr¬ñ6ˆ‚¬∆&V¬¬WáG&í∞¢6ˆÁ7BB“ˆ&5BÜFVrì∞¢6ˆÁ7BV¬“Fˆ7V÷VÁBÊ7&VFTV∆V÷VÁBÇvFóbrì∞¢V¬Ê6∆74Ê÷R“v&2◊6∆˜Br≤ÜWáG&Úrr≤WáG&¢rrì∞¢V¬Á7Gñ∆RÊ775FWáB“˜6óFñˆ„¶fóÜVC∂∆VgC¢G∑BÁá◊É∑F˜¢G∑BÁó◊É∑¢÷ñÊFWÉ£#∑ˆñÁFW"÷WfVÁG3¶ÊˆÊS∂∞¢V¬ÊñÊÊW$ÖD‘¬“«7‚6∆73“&&2÷ñ6ˆ‚#‚G∂ñ6ˆÁ”¬˜7„Ê ¢≤Ü∆&V¬Ú«7‚6∆73“&&2÷∆&V¬#‚G∂∆&V«”¬˜7„Ê¢rrì∞¢Fˆ7V÷VÁBÊ&ˆGíÊVÊD6Üñ∆BÜV¬ì∞¢ˆ&4V«2ÁW6ÇÜV¬ì∞¢&WGW&‚V√∞¢–†¢gVÊ7Fñˆ‚˜6WD7FófRÜñGÇí∞¢ñbÖˆ&47FófR””“ñGÇí&WGW&„∞¢ñbÖˆ&56∆˜G5µˆ&47FófU“íˆ&56∆˜G5µˆ&47FófU“ÊV¬Ê6∆74∆ó7BÁ&V÷˜fRÇv&2÷7FófRrì∞¢ˆ&47FófR“ñGÉ∞¢ñbÖˆ&56∆˜G5∂ñGÖ“íˆ&56∆˜G5∂ñGÖ“ÊV¬Ê6∆74∆ó7BÊFBÇv&2÷7FófRrì∞¢–†¢gVÊ7Fñˆ‚ˆ˜VÂFˆˆƒ&2Çí∞¢ˆ6∆V$&2Çì≤ˆ&4˜V‚“wFˆˆ¬s∞¢ñbÖˆóFV‘'F‚íˆóFV‘'F‚Á7Gñ∆RÁfó6ñ&ñ∆óGí“vÜñFFV‚s∞¢ˆ&4&B“Fˆ7V÷VÁBÊ7&VFTV∆V÷VÁBÇvFóbrì∞¢ˆ&4&BÊ6∆74Ê÷R“v&2÷&6∂G&˜s∞¢Fˆ7V÷VÁBÊ&ˆGíÊVÊD6Üñ∆BÖˆ&4&Bì∞¢6ˆÁ7B‚“tÑTT≈ı4ƒıE2Ê∆VÊwFÇ¬7FW“Ñ$5ı2“$5ÙRíÚÜ‚“ì∞¢tÑTT≈ı4ƒıE2Êf˜$V6ÇÇá6∆˜B¬íí”‚∞¢6ˆÁ7BFVr“$5ı2“í¢7FW∞¢6ˆÁ7BW“WVó÷VÁE6∆˜G5∑6∆˜E“¬FVb“WÚDÙÙ≈ÙïDT’ÙDTe5∂W“¢ÁV∆√∞¢6ˆÁ7Bf∆∆&6¥ñ6ˆ‚“∑6Ü˜fV√¢~)∏˛˚àÚr∆ÜˆS¢	˙©2r«vVˆ„¢	˘z˚àÚr∆ÜS¢	˙©2r«ñ6≥¢~)∏˛˚àÚr∆Ü'ˆˆ„¢	¯Í2w’∑6∆˜E“«¬	˘Jrs∞¢6ˆÁ7Bñ6ˆ‚“Fˆˆ≈6V∆V7Dñ6ˆ‰ÖD‘¬ÜFVb¬f∆∆&6¥ñ6ˆ‚¬s„FV“rì∞¢6ˆÁ7B∆&V¬“∑6Ü˜fV√¢u6Ü˜fV¬r∆ÜˆS¢tÜˆRr«vVˆ„¢uvVˆ‚r∆ÜS¢tÜRr«ñ6≥¢uñ6≤r∆Ü'ˆˆ„¢tÜ'ˆˆ‚w’∑6∆˜E“«¬6∆˜C∞¢6ˆÁ7BV¬“ˆ÷µ6∆˜BÜFVr¬ñ6ˆ‚¬∆&V¬¬7FófUFˆˆ¬””“6∆˜BÚv&2÷7FófRr¢rrì∞¢ˆ&56∆˜G2ÁW6Çá≤Êv∆S¢FVr¬V¬¬FF¢6∆˜B“ì∞¢ñbÜ7FófUFˆˆ¬””“6∆˜Bíˆ&47FófR“ì∞¢“ì∞¢–†¢∆WBˆ∆7DÜV∆EFˆˆ¬“7FófUFˆˆ√∞¢∆WBˆï67&ˆ∆¬“¬ˆï67&ˆ∆≈B“ÁV∆¬¬ˆï67&ˆ∆ƒFó"“∞¢6ˆÁ7BïDT’ıdï2“S∞†¢gVÊ7Fñˆ‚ˆ'Vñ∆DóFV’6∆˜G2Çí∞¢6ˆÁ7B7F6∑2“vWDñÁfVÁF˜'ï7F6¥óFV◊2Çí¬F˜F¬“7F6∑2Ê∆VÊwFÉ∞¢6ˆÁ7B6∆˜G2“µ”∞¢ñbÖˆï67&ˆ∆¬‚í6∆˜G2ÁW6Çá≤GóS¢v'&˜rr¬Fó#¢”¬ñ6ˆ„¢~)xr¬∆&V√¢rr“ì∞¢f˜"Ü∆WBí“≤í¬ïDT’ıdï2bbˆï67&ˆ∆¬≤í¬F˜F√≤í≤≤ê¢6∆˜G2ÁW6Çá≤GóS¢vóFV“r¬ñÊFWÉ•ˆï67&ˆ∆¬∂í¬ñ6ˆ„ß7F6∑5µˆï67&ˆ∆¬∂ï“Êñ6ˆ‚¬∆&V√ß7F6∑5µˆï67&ˆ∆¬∂ï“Ê∆&V¬“ì∞¢ñbÖˆï67&ˆ∆¬≤ïDT’ıdï2¬F˜F¬í6∆˜G2ÁW6Çá≤GóS¢v'&˜rr¬Fó#£¬ñ6ˆ„¢~)kbr¬∆&V√¢rr“ì∞¢6ˆÁ7B6‚“6∆˜G2Ê∆VÊwFÇ¬7FW“6‚‚ÚÑ$5ı2“$5ÙRíÚá6‚“í¢∞†¢6ˆÁ7Bˆ∆D'î∂Wí“ÊWr÷Öˆ&56∆˜G2Ê÷á2”‚∞¢2ÊFFÁGóR””“v'&˜rrÚG∑2ÊFFÊFó'÷¢íG∑2ÊFFÊñÊFWá÷¬0¢“íì∞¢6ˆÁ7B∂WB“ÊWr6WBÇí¬ÊWu6∆˜G2“µ”∞†¢6∆˜G2Êf˜$V6ÇÇá2¬íí”‚∞¢6ˆÁ7BFVr“$5ı2“í¢7FW¬B“ˆ&5BÜFVrì∞¢6ˆÁ7B≤“2ÁGóR””“v'&˜rrÚG∑2ÊFó'÷¢íG∑2ÊñÊFWá÷∞¢6ˆÁ7BWáG&“2ÁGóR””“v'&˜rrÚv&2÷'&˜rr¢á2ÊñÊFWÇ””“7FófTóFV‘ñÊFWÇÚv&2÷7FófRr¢rrì∞¢ñbÜˆ∆D'î∂WíÊÜ2Ü≤íí∞¢6ˆÁ7Bˆ∆B“ˆ∆D'î∂WíÊvWBÜ≤ì≤∂WBÊFBÜ≤ì∞¢ˆ∆BÊV¬Á7Gñ∆RÊ∆VgB“BÁÇ≤wÇs≤ˆ∆BÊV¬Á7Gñ∆RÁF˜“BÁí≤wÇs∞¢ˆ∆BÊV¬Ê6∆74Ê÷R“v&2◊6∆˜Br≤ÜWáG&Úrr≤WáG&¢rrì∞¢ÊWu6∆˜G2ÁW6Çá≤Êv∆S¢FVr¬V√¢ˆ∆BÊV¬¬FF¢2“ì∞¢“V«6R∞¢6ˆÁ7BV¬“Fˆ7V÷VÁBÊ7&VFTV∆V÷VÁBÇvFóbrì∞¢V¬Ê6∆74Ê÷R“v&2◊6∆˜Br≤ÜWáG&Úrr≤WáG&¢rrì∞¢V¬Á7Gñ∆RÊ775FWáB“˜6óFñˆ„¶fóÜVC∂∆VgC¢G∑BÁá◊É∑F˜¢G∑BÁó◊É∑¢÷ñÊFWÉ£#∑ˆñÁFW"÷WfVÁG3¶ÊˆÊS∂˜6óGì£∂∞¢V¬ÊñÊÊW$ÖD‘¬“«7‚6∆73“&&2÷ñ6ˆ‚#‚G∑2Êñ6ˆÁ”¬˜7„Ê ¢≤á2Ê∆&V¬Ú«7‚6∆73“&&2÷∆&V¬#‚G∑2Ê∆&V«”¬˜7„Ê¢rrì∞¢Fˆ7V÷VÁBÊ&ˆGíÊVÊD6Üñ∆BÜV¬ì∞¢ˆ&4V«2ÁW6ÇÜV¬ì∞¢&WVW7DÊñ÷Fñˆ‰g&÷RÇÇí”‚≤V¬Á7Gñ∆RÊ˜6óGí“ss≤“ì∞¢ÊWu6∆˜G2ÁW6Çá≤Êv∆S¢FVr¬V¬¬FF¢2“ì∞¢–¢“ì∞†¢ˆ&56∆˜G2Êf˜$V6Çá2”‚∞¢6ˆÁ7B≤“2ÊFFÁGóR””“v'&˜rrÚG∑2ÊFFÊFó'÷¢íG∑2ÊFFÊñÊFWá÷∞¢ñbÇ∂WBÊÜ2Ü≤íí∞¢2ÊV¬Á7Gñ∆RÊ˜6óGí“ss∞¢ˆ&4V«2“ˆ&4V«2Êfñ«FW"ÜR”‚R”“2ÊV¬ì∞¢ˆfFñÊtV«2ÁW6Çá2ÊV¬ì∞¢6ˆÁ7BˆV¬“2ÊV√∞¢6WEFñ÷V˜WBÇÇí”‚≤ˆV¬Á&V÷˜fRÇì≤ˆfFñÊtV«2“ˆfFñÊtV«2Êfñ«FW"Üb”‚b”“ˆV¬ì≤“¬Sì∞¢–¢“ì∞†¢ˆ&56∆˜G2“ÊWu6∆˜G3∞¢ˆ&47FófR“ÊWu6∆˜G2ÊfñÊDñÊFWÇá2”‚2ÊFFÁGóR””“vóFV“rbb2ÊFFÊñÊFWÇ””“7FófTóFV‘ñÊFWÇì∞¢–†¢gVÊ7Fñˆ‚ˆ˜V‰óFV‘&2Çí∞¢ˆ6∆V$&2Çì≤ˆ&4˜V‚“vóFV“s∞¢Fˆˆƒ'F‚Á7Gñ∆RÁfó6ñ&ñ∆óGí“vÜñFFV‚s∞¢ˆ&4&B“Fˆ7V÷VÁBÊ7&VFTV∆V÷VÁBÇvFóbrì∞¢ˆ&4&BÊ6∆74Ê÷R“v&2÷&6∂G&˜s∞¢Fˆ7V÷VÁBÊ&ˆGíÊVÊD6Üñ∆BÖˆ&4&Bì∞¢ˆï67&ˆ∆¬“÷FÇÊ÷ÇÉ¬7FófTóFV‘ñÊFWÇ“÷FÇÊf∆ˆ˜"ÑïDT’ıdï2Ú"íì∞¢ˆï67&ˆ∆ƒFó"“∞¢ˆ'Vñ∆DóFV’6∆˜G2Çì∞¢–†¢gVÊ7Fñˆ‚ˆ&4÷˜fRáÇ¬íí∞¢ñbÇˆ&4˜V‚«¬ˆ&56∆˜G2Ê∆VÊwFÇí&WGW&„∞¢6ˆÁ7BÊr“÷FÇÊ÷ÇÑ$5ÙR¬÷FÇÊ÷ñ‚Ñ$5ı2¬ˆ6˜&ÊW$ÊráÇ¬íííì∞¢∆WB&W7B“¬&B“ñÊfñÊóGì∞¢ˆ&56∆˜G2Êf˜$V6ÇÇá2¬íí”‚≤6ˆÁ7BB“÷FÇÊ'2á2ÊÊv∆R“Êrì≤ñbÜB¬&Bí≤&B“C≤&W7B“ì≤““ì∞¢ñbÖˆ&4˜V‚””“vóFV“rí∞¢6ˆÁ7BÊWtFó"“ˆ&56∆˜G5∂&W7E”ÚÊFFÁGóR””“v'&˜rrÚˆ&56∆˜G5∂&W7E“ÊFFÊFó"¢∞¢ñbÜÊWtFó"”“ˆï67&ˆ∆ƒFó"í∞¢ˆï67&ˆ∆ƒFó"“ÊWtFó#∞¢ñbÖˆï67&ˆ∆≈Bí≤6∆V$ñÁFW'f¬Öˆï67&ˆ∆≈Bì≤ˆï67&ˆ∆≈B“ÁV∆√≤–¢ñbÜÊWtFó"”“í∞¢ˆï67&ˆ∆≈B“6WDñÁFW'f¬ÇÇí”‚∞¢ˆï67&ˆ∆¬“÷FÇÊ÷ÇÉ¬÷FÇÊ÷ñ‚ÜvWDñÁfVÁF˜'ï7F6¥óFV◊2ÇíÊ∆VÊwFÇ“ïDT’ıdï2¬ˆï67&ˆ∆¬≤ˆï67&ˆ∆ƒFó"íì∞¢ˆ'Vñ∆DóFV’6∆˜G2Çì∞¢“¬#ì∞¢–¢–¢–¢˜6WD7FófRÜ&W7Bì∞¢–†¢gVÊ7Fñˆ‚ˆ&5WÇí∞¢ñbÖˆï67&ˆ∆≈Bí≤6∆V$ñÁFW'f¬Öˆï67&ˆ∆≈Bì≤ˆï67&ˆ∆≈B“ÁV∆√≤–¢ñbÇˆ&4˜V‚í&WGW&„∞¢6ˆÁ7B6∆˜B“ˆ&56∆˜G5µˆ&47FófU”∞¢ñbÖˆ&4˜V‚””“wFˆˆ¬rbb6∆˜Bí∞¢ÜV∆D÷ˆFR“wFˆˆ¬s≤ˆ∆7DÜV∆EFˆˆ¬“6∆˜BÊFF∞¢6WD7FófUFˆˆ¬á6∆˜BÊFFì≤ÚÚ6∆«2&Vg&W6Ñ7Fñˆ‰&"ñÁFW&Ê∆«ê¢“V«6RñbÖˆ&4˜V‚””“vóFV“rbb6∆˜CÚÊFFÁGóR””“vóFV“rí∞¢ÜV∆D÷ˆFR“vóFV“s∞¢7FófTóFV‘ñÊFWÇ“6∆˜BÊFFÊñÊFWÉ∞¢&Vg&W6ÑóFV’67&ˆ∆¬Çì≤&Vg&W6Ñ7Fñˆ‰&"Çì∞¢–¢ˆ6∆V$&2Çì∞¢–†¢vñÊF˜rÂˆFW6∑F˜6V∆V7Fñˆ‰&2“∞¢˜VÂFˆˆ¬Çí≤ñbÖˆ&4˜V‚”“wFˆˆ¬ríˆ˜VÂFˆˆƒ&2Çì≤“¿¢˜V‰óFV“Çí≤ñbÖˆ&4˜V‚”“vóFV“ríˆ˜V‰óFV‘&2Çì≤“¿¢67&ˆ∆≈Fˆˆ¬ÜFó"í∞¢ñbÖˆ&4˜V‚”“wFˆˆ¬ríˆ˜VÂFˆˆƒ&2Çì∞¢6ˆÁ7BñGÇ“tÑTT≈ı4ƒıE2ÊñÊFWÑˆbÜ7FófUFˆˆ¬ì∞¢6ˆÁ7BÊWáB“ÜñGÇ≤Fó"≤tÑTT≈ı4ƒıE2Ê∆VÊwFÇíRtÑTT≈ı4ƒıE2Ê∆VÊwFÉ∞¢ÜV∆D÷ˆFR“wFˆˆ¬s∞¢ˆ∆7DÜV∆EFˆˆ¬“tÑTT≈ı4ƒıE5∂ÊWáE”∞¢6WD7FófUFˆˆ¬ÖtÑTT≈ı4ƒıE5∂ÊWáE“ì∞¢ˆ&56∆˜G2Êf˜$V6ÇÇá2¬íí”‚∞¢6ˆÁ7B7FófR“2ÊFF””“7FófUFˆˆ√∞¢2ÊV¬Ê6∆74∆ó7BÁFˆvv∆RÇv&2÷7FófRr¬7FófRì∞¢ñbÜ7FófRíˆ&47FófR“ì∞¢“ì∞¢“¿¢67&ˆ∆ƒóFV“ÜFó"í∞¢ñbÖˆ&4˜V‚”“vóFV“ríˆ˜V‰óFV‘&2Çì∞¢ÜV∆D÷ˆFR“vóFV“s∞¢7ñ6∆T7FófTñÁfVÁF˜'îóFV“ÜFó"ì∞¢&Vg&W6ÑóFV’67&ˆ∆¬Çì≤&Vg&W6Ñ7Fñˆ‰&"Çì∞¢ˆï67&ˆ∆¬“÷FÇÊ÷ÇÉ¬÷FÇÊ÷ñ‚ÜvWDñÁfVÁF˜'ï7F6¥óFV◊2ÇíÊ∆VÊwFÇ“ïDT’ıdï2¬7FófTóFV‘ñÊFWÇ“÷FÇÊf∆ˆ˜"ÑïDT’ıdï2Ú"ííì∞¢ˆ'Vñ∆DóFV’6∆˜G2Çì∞¢ˆ&56∆˜G2Êf˜$V6ÇÇá2¬íí”‚∞¢6ˆÁ7B7FófR“2ÊFFÁGóR””“vóFV“rbb2ÊFFÊñÊFWÇ””“7FófTóFV‘ñÊFWÉ∞¢2ÊV¬Ê6∆74∆ó7BÁFˆvv∆RÇv&2÷7FófRr¬7FófRì∞¢ñbÜ7FófRíˆ&47FófR“ì∞¢“ì∞¢“¿¢6∆˜6RÇí≤ˆ6∆V$&2Çì≤–¢”∞†¢∆WB˜EDñB“ÁV∆¬¬˜DÜV∆B“f«6R¬˜EFñ÷W"“ÁV∆¬¬˜DGÇ“¬˜DGí“¬˜D÷˜fVB“f«6S∞¢Fˆˆƒ'F‚ÊFDWfVÁD∆ó7FVÊW"ÇwˆñÁFW&F˜v‚r¬Wb”‚∞¢ñbÖ˜EDñB”“ÁV∆¬í&WGW&„∞¢˜EDñB“WbÁˆñÁFW$ñC≤˜DÜV∆B“f«6S≤˜D÷˜fVB“f«6S∞¢˜DGÇ“WbÊ6∆ñVÁEÉ≤˜DGí“WbÊ6∆ñVÁEì∞¢ÚÚ6VRÜÊF∆T¶˜ó7Fñ6µˆñÁFW$F˜v‚w26ˆ÷÷VÁC¢‚VÊ6VváBFá&˜rÜW&P¢ÚÚá˜76ñ&∆Rf˜"F˜V6Ç7F'FñÊr&Vf˜&RFÜR'&˜w6W"6ˆÁ6ñFW'2FÜP¢ÚÚˆñÁFW"gV∆«í7FófRív˜V∆B6∂óFÜR&W7BˆbFÜó2ÜÊF∆W"Ê@¢ÚÚ∆VfR˜EDñB7GV6≤Êˆ‚÷ÁV∆¬¬W&÷ÊVÁF«í&∆ˆ6∂ñÊrFÜó2'WGFˆ‡¢ÚÚfñFÜRˆñÁFW&F˜v‚wV&B&˜fR‡¢G'í≤Fˆˆƒ'F‚Á6WEˆñÁFW$6GW&RÜWbÁˆñÁFW$ñBì≤“6F6ÇÜW'"í≤Ú¢FVw&FRw&6VgV∆«í¢Ú–¢˜EFñ÷W"“6WEFñ÷V˜WBÇÇí”‚≤˜DÜV∆B“G'VS≤ˆ˜VÂFˆˆƒ&2Çì≤“¬3Sì∞¢WbÁ&WfVÁDFVfV«BÇì∞¢“ì∞¢Fˆˆƒ'F‚ÊFDWfVÁD∆ó7FVÊW"ÇwˆñÁFW&÷˜fRr¬Wb”‚∞¢ñbÜWbÁˆñÁFW$ñB”“˜EDñBí&WGW&„∞¢ñbÇ˜D÷˜fVBbb÷FÇÊáó˜BÜWbÊ6∆ñVÁEÇ“˜DGÇ¬WbÊ6∆ñVÁEí“˜DGíí‚bí˜D÷˜fVB“G'VS∞¢ñbÖˆ&4˜V‚””“wFˆˆ¬ríˆ&4÷˜fRÜWbÊ6∆ñVÁEÇ¬WbÊ6∆ñVÁEíì∞¢“ì∞¢Fˆˆƒ'F‚ÊFDWfVÁD∆ó7FVÊW"ÇwˆñÁFW'Wr¬Wb”‚∞¢ñbÜWbÁˆñÁFW$ñB”“˜EDñBí&WGW&„∞¢˜EDñB“ÁV∆√∞¢ñbÖ˜EFñ÷W"í≤6∆V%Fñ÷V˜WBÖ˜EFñ÷W"ì≤˜EFñ÷W"“ÁV∆√≤–¢ñbÖˆ&4˜V‚””“wFˆˆ¬ríˆ&5WÇì∞¢V«6RñbÇ˜DÜV∆Bbb˜D÷˜fVBbbÜV∆D÷ˆFR””“vóFV“rí∞¢ÚÚFvÜñ∆Rñ‚óFV“÷ˆFR(i"&WGW&‚FÚ∆7BÜV∆BFˆˆ¿¢ÜV∆D÷ˆFR“wFˆˆ¬s∞¢6WD7FófUFˆˆ¬Öˆ∆7DÜV∆EFˆˆ¬ì≤ÚÚ6∆«2&Vg&W6Ñ7Fñˆ‰&"ñÁFW&Ê∆«ê¢–¢˜DÜV∆B“f«6S≤˜D÷˜fVB“f«6S∞¢“ì∞¢Fˆˆƒ'F‚ÊFDWfVÁD∆ó7FVÊW"ÇwˆñÁFW&6Ê6V¬r¬Wb”‚∞¢ñbÜWbÁˆñÁFW$ñB”“˜EDñBí&WGW&„∞¢˜EDñB“ÁV∆√∞¢ñbÖ˜EFñ÷W"í≤6∆V%Fñ÷V˜WBÖ˜EFñ÷W"ì≤˜EFñ÷W"“ÁV∆√≤–¢ˆ6∆V$&2Çì≤˜DÜV∆B“f«6S≤˜D÷˜fVB“f«6S∞¢“ì∞†¢ñbÖˆóFV‘'F‚í∞¢∆WBˆïDñB“ÁV∆¬¬ˆîÜV∆B“f«6R¬ˆïFñ÷W"“ÁV∆¬¬ˆîGÇ“¬ˆîGí“¬ˆî÷˜fVB“f«6S∞¢ˆóFV‘'F‚ÊFDWfVÁD∆ó7FVÊW"ÇwˆñÁFW&F˜v‚r¬Wb”‚∞¢ñbÖˆïDñB”“ÁV∆¬í&WGW&„∞¢ˆïDñB“WbÁˆñÁFW$ñC≤ˆîÜV∆B“f«6S≤ˆî÷˜fVB“f«6S∞¢ˆîGÇ“WbÊ6∆ñVÁEÉ≤ˆîGí“WbÊ6∆ñVÁEì∞¢ÚÚ6VRÜÊF∆T¶˜ó7Fñ6µˆñÁFW$F˜v‚w26ˆ÷÷VÁB‡¢G'í≤ˆóFV‘'F‚Á6WEˆñÁFW$6GW&RÜWbÁˆñÁFW$ñBì≤“6F6ÇÜW'"í≤Ú¢FVw&FRw&6VgV∆«í¢Ú–¢ˆïFñ÷W"“6WEFñ÷V˜WBÇÇí”‚≤ˆîÜV∆B“G'VS≤ˆ˜V‰óFV‘&2Çì≤“¬3Sì∞¢WbÁ&WfVÁDFVfV«BÇì∞¢“ì∞¢ˆóFV‘'F‚ÊFDWfVÁD∆ó7FVÊW"ÇwˆñÁFW&÷˜fRr¬Wb”‚∞¢ñbÜWbÁˆñÁFW$ñB”“ˆïDñBí&WGW&„∞¢ñbÇˆî÷˜fVBbb÷FÇÊáó˜BÜWbÊ6∆ñVÁEÇ“ˆîGÇ¬WbÊ6∆ñVÁEí“ˆîGíí‚bíˆî÷˜fVB“G'VS∞¢ñbÖˆ&4˜V‚””“vóFV“ríˆ&4÷˜fRÜWbÊ6∆ñVÁEÇ¬WbÊ6∆ñVÁEíì∞¢“ì∞¢ˆóFV‘'F‚ÊFDWfVÁD∆ó7FVÊW"ÇwˆñÁFW'Wr¬Wb”‚∞¢ñbÜWbÁˆñÁFW$ñB”“ˆïDñBí&WGW&„∞¢ˆïDñB“ÁV∆√∞¢ñbÖˆïFñ÷W"í≤6∆V%Fñ÷V˜WBÖˆïFñ÷W"ì≤ˆïFñ÷W"“ÁV∆√≤–¢ñbÖˆ&4˜V‚””“vóFV“ríˆ&5WÇì∞¢V«6RñbÇˆîÜV∆Bbbˆî÷˜fVBbbÜV∆D÷ˆFR””“wFˆˆ¬rí∞¢ÚÚFvÜñ∆Rñ‚Fˆˆ¬÷ˆFR(i"7vóF6ÇFÚóFV“÷ˆFP¢ˆ∆7DÜV∆EFˆˆ¬“7FófUFˆˆ√∞¢ÜV∆D÷ˆFR“vóFV“s∞¢&Vg&W6ÑóFV’67&ˆ∆¬Çì≤&Vg&W6Ñ7Fñˆ‰&"Çì∞¢–¢ˆîÜV∆B“f«6S≤ˆî÷˜fVB“f«6S∞¢“ì∞¢ˆóFV‘'F‚ÊFDWfVÁD∆ó7FVÊW"ÇwˆñÁFW&6Ê6V¬r¬Wb”‚∞¢ñbÜWbÁˆñÁFW$ñB”“ˆïDñBí&WGW&„∞¢ˆïDñB“ÁV∆√∞¢ñbÖˆïFñ÷W"í≤6∆V%Fñ÷V˜WBÖˆïFñ÷W"ì≤ˆïFñ÷W"“ÁV∆√≤–¢ñbÖˆï67&ˆ∆≈Bí≤6∆V$ñÁFW'f¬Öˆï67&ˆ∆≈Bì≤ˆï67&ˆ∆≈B“ÁV∆√≤–¢ˆ6∆V$&2Çì≤ˆîÜV∆B“f«6S≤ˆî÷˜fVB“f«6S∞¢“ì∞¢–¢–†¢ÚÚ)H)H7Fñˆ‚&"WFFR)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢ÚÚ)H)HGñÊ÷ñ27Fñˆ‚7F6≤)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢ÚÚ6ˆ◊WFW2FÜRgV∆¬∆ó7Bˆb'WGFˆÁ2FÚ6Ü˜r¬FÜV‚&V'Vñ∆G2FÜRDÙ“&˜w2‡¢ÚÚ'WGFˆÁ2&R6∂VBñÁFÚ&˜w2ˆb¬"¬¬"‚‚‚ÜÜWÇ6∂ñÊrí‡¢ÚÚV6Ç'WGFˆ„¢≤ñ6ˆ‚¬∆&V¬¬7Fñˆ‚¬7Gñ∆R¬∆∆˜vVB–††¢gVÊ7Fñˆ‚6ˆ◊WFT7Fñˆ‰'WGFˆÁ2Çí∞¢ÚÚ6óGFñÊr˜fW'&ñFW2WfW'í˜FÜW"7Fñˆ‚(	B7FÊBó2FÜRˆÊ«íví˜WB¿¢ÚÚ6÷RFñW"2fó6ÜñÊrˆFñ∆ˆwVR&V∆˜r‡¢ñbá6óDñÁFW&7Fñˆ‚í∞¢&WGW&‚∑≤ñ6ˆ„¢	˙x“r¬∆&V√¢u7FÊBr¬7Fñˆ„¢vˆ&•˜7FÊBr¬7Gñ∆S¢w&ñ÷'ír¬∆∆˜vVC¢6óDñÁFW&7Fñˆ‚ÁÜ6R””“v7FófRr’”∞¢–¢ÚÚfó6ÜñÊrvWG2óG2˜v‚&2'WGFˆÁ2ñÁ7FVBˆbFÜRÜ'ˆˆ‚w2Ê˜&÷¿¢ÚÚ$fó6Ç"ˆÊRávÜñ6Çv˜V∆BßW7B6∆¬&Vvñ‰fó6ÜñÊt67BÇívñ‚Ê@¢ÚÚ6ñ∆VÁF«í&W7F'BFÜR&˜VÊBí(	BFÜR&˜GFˆ“÷6VÁFW"67FñˆÂ&ˆ◊@¢ÚÚá6VR&VÊFW$fó6ÜñÊt˜fW&∆íí÷ó'&˜'2FÜW6R2‚ñÊfÚFó7∆ê¢ÚÚá7FGW2FWáB˜Êñ2&"ˆFW6∑F˜∂Wí∆&V¬í¬'WBFÜR7GV¿¢ÚÚFáV÷"◊&V6Ü&∆RFF&vWBˆ‚F˜V6Çó2FÜR&2¬6÷R2WfW'ê¢ÚÚ˜FÜW"Fˆˆ¬7Fñˆ‚‚Ê˜FÜñÊr6Ü˜w2&Vf˜&Rv&óFRrÜÊÚ&óFRñWBF¢ÚÚ&V7BFÚí¬ÊBÊ˜FÜñÊr6Ü˜w2GW&ñÊrv6VváBráFÜRfñ7F˜'ífñWp¢ÚÚÜ2óG2˜v‚6ˆÁFñÁVR'WGFˆ‚í‡¢ñbávñÊF˜r‰fó6ÜñÊsÚÁ7FFSÚÊ7FófRí∞¢6ˆÁ7Bf““vñÊF˜r‰fó6ÜñÊrÁ7FFS∞¢ñbÜf“ÁÜ6R”“v&óFRrbbf“ÁÜ6R”“v7FófRrí&WGW&‚µ”∞¢6ˆÁ7BÊ˜EñWD÷&∂VB“f“ÁÜ6R””“v&óFRr«¬f“Ê'&ñFvRÊ÷&∂W$”“ÁV∆√∞¢6ˆÁ7Bñ6ˆ‚“GF6¥7Fñˆ‰ñ6ˆ‰ÖD‘¬ÇvÜ'ˆˆ‚r¬vfó6Çr¬	¯Í2rì∞¢&WGW&‚∞¢≤ñ6ˆ‚¬∆&V√¢Ê˜EñWD÷&∂VBÚu&VGíÜ'ˆˆ‚r¢uFá&˜rÜ'ˆˆ‚r¬7Fñˆ„¢vfó6Ö˜&ñ÷'ír¬7Gñ∆S¢w&ñ÷'ír¬∆∆˜vVC¢G'VR“¿¢≤ñ6ˆ„¢	¯˚>˚àÚr¬∆&V√¢tvófRWr¬7Fñˆ„¢vfó6Öˆ6Ê6V¬r¬7Gñ∆S¢w6V6ˆÊF'ír¬∆∆˜vVC¢G'VR“¿¢”∞¢–¢ÚÚÂ2Fñ∆ˆwVRF∂W2&ñ˜&óGí˜fW"Fˆˆ¬W6Rˆ‚F˜V6Ç6ˆÁG&ˆ«2ÊB÷ó'&˜'2FÜR&ñ÷'í÷7Fñˆ‚∂Wñ&ˆ&BFÇ‡¢ñbÜÊV&'îÁ5v∆∂W"bbf&‘VFóD÷ˆFRí∞¢6ˆÁ7B'FÁ2“∂Á4Fñ∆ˆwVT'WGFˆ‚Çï”∞¢ñbÜó4vVÊW&≈7F˜&TÁ4ˆ‰GWGíÜÊV&'îÁ5v∆∂W"íí'FÁ2ÁW6ÇÜvVÊW&≈7F˜&T'WGFˆ‚Çíì∞¢ñbÜó46'VÁFW$Á4ˆ‰GWGíÜÊV&'îÁ5v∆∂W"íí'FÁ2ÁW6ÇÜ6'VÁFW$'WGFˆ‚Çíì∞¢&WGW&‚'FÁ3∞¢–†¢ÚÚñÁFW&ñ˜#¢WÜóB'WGFˆ‚ÊV"ÁíFˆ˜"w2WÜóBFá&W6Üˆ∆B≤ñÁFW&7B'WGFˆ‚f˜"ñÁFW&ñ˜"v˜&∆Bˆ&¶V7G0¢ñbÜ7W'&VÁD&V””“vñÁFW&ñ˜"rí∞¢6ˆÁ7B&WFñ6∆R“vWE&WFñ6∆UFñ∆RÇì∞¢6ˆÁ7BÊV$WÜóB“ˆñÁFW&ñ˜$WÜóEFñ∆W2ÊÜ2á&WFñ6∆RÊ6ˆ¬≤r¬r≤&WFñ6∆RÁ&˜rì∞¢6ˆÁ7B'FÁ2“µ”∞¢ñbÜÊV$WÜóBí'FÁ2ÁW6Çá≤ñ6ˆ„¢	˘™¢r¬∆&V√¢tWÜóBÜ˜W6Rr¬7Fñˆ„¢vˆ&•ˆWÜóEˆÜ˜W6Rr¬7Gñ∆S¢w&ñ÷'ír¬∆∆˜vVC¢G'VR“ì∞¢ÚÚvWDñÁFW&ñ˜$ñÁFW&7F&∆TB¬Ê˜BvWEv˜&∆Dˆ&¶V7DB(	Bv˜&∆Dˆ&¶V7G2ó0¢ÚÚFÜRf&“66VÊRw2˜v‚6ˆ˜&FñÊFR76Rá6VRóG2FV6∆&Fñˆ‚í¬6¢ÚÚ&WFñ6∆R6ˆ˜&G2vÜñ∆R7FÊFñÊrñ‚FÜRñÁFW&ñ˜"vW&R&VñÊr6ÜV6∂V@¢ÚÚvñÁ7Bf&“◊∆6VBˆ&¶V7G2BFÜ˜6R6÷RÁV÷W&ñ26ˆ˜&FñÊFW2‡¢6ˆÁ7Bîˆ&¢“vWDñÁFW&ñ˜$ñÁFW&7F&∆TBá&WFñ6∆RÊ6ˆ¬¬&WFñ6∆RÁ&˜rì∞¢ñbÜîˆ&¢í'FÁ2ÁW6Çá≤ñ6ˆ„¢îˆ&¢ÊñÁFW&7Dñ6ˆ‚«¬	˘IBr¬∆&V√¢îˆ&¢ÊñÁFW&7D∆&V¬«¬tñÁFW&7Br¬7Fñˆ„¢vˆ&•ˆñÁFW&7Br¬7Gñ∆S¢w&ñ÷'ír¬∆∆˜vVC¢G'VR“ì∞¢&WGW&‚'FÁ3∞¢–†¢ÚÚF˜v„¢7˜BG&Á6óFñˆÁ2F∂R&ñ˜&óGíá&WVó&RWá∆ñ6óBñÁWBì≤˜FÜW'vó6P¢ÚÚf∆¬Fá&˜VvÇ&V∆˜r6ÚFˆˆ«2˜vVˆÁ2&V÷ñ‚W6&∆Rñ‚F˜v‚‡¢ñbÜ7W'&VÁD&V””“wF˜v‚rbb˜VÊFñÊu7˜EG&Á6óFñˆ‚í∞¢6ˆÁ7BB“˜VÊFñÊu7˜EG&Á6óFñˆ„∞¢6ˆÁ7Bñ6ˆ‚“BÁF&vWB””“v'Vñ∆FñÊrrÚ	˘™¢r¢	¯˘Çs∞¢6ˆÁ7B∆&V¬“BÊ∆&V¬«¬áBÁF&vWB””“v'Vñ∆FñÊrrÚtVÁFW"r¢t∆VfRF˜v‚rì∞¢&WGW&‚∑≤ñ6ˆ‚¬∆&V¬¬7Fñˆ„¢wW6U˜7˜Br¬7Gñ∆S¢w&ñ÷'ír¬∆∆˜vVC¢G'VR’”∞¢–†¢ÚÚ'Vñ∆FñÊrñÁFW&ñ˜#¢7˜BG&Á6óFñˆÁ2&WVó&RWá∆ñ6óBñÁW@¢ñbÖˆó4'Vñ∆FñÊt&VÜ7W'&VÁD&Víí∞¢ñbÖ˜VÊFñÊu7˜EG&Á6óFñˆ‚í∞¢6ˆÁ7BB“˜VÊFñÊu7˜EG&Á6óFñˆ„∞¢6ˆÁ7Bñ6ˆ‚“BÁF&vWB””“vWÜóEˆ'Vñ∆FñÊrrÚ	˘™¢r¢	˙©¬s∞¢6ˆÁ7B∆&V¬“BÊ∆&V¬«¬áBÁF&vWB””“vWÜóEˆ'Vñ∆FñÊrrÚtWÜóBr¢uW6Rrì∞¢&WGW&‚∑≤ñ6ˆ‚¬∆&V¬¬7Fñˆ„¢wW6U˜7˜Br¬7Gñ∆S¢w&ñ÷'ír¬∆∆˜vVC¢G'VR’”∞¢–¢6ˆÁ7BÊW7B“ˆFV‰ÊW7G2ÊvWBÜ7W'&VÁD&Vì∞¢ñbÜÊW7BbbÊW7BÁ&V÷ñÊñÊr‚bbó5∆ñW$ÊV$FV‰ÊW7BÜÊW7Bíí∞¢6ˆÁ7B∆&V¬“ÊW7BÊ∆ófT&ó'FÇÚtÜˆ∆BFÚF∂R&'ír¢tÜˆ∆BFÚF∂RVvrs∞¢&WGW&‚∑≤ñ6ˆ„¢ÊW7BÊ∆ófT&ó'FÇÚ	˘‚r¢	˙Y¢r¬∆&V¬¬7Fñˆ„¢vÊW7E˜F∂Rr¬7Gñ∆S¢w&ñ÷'ír¬∆∆˜vVC¢G'VR’”∞¢–¢ÚÚFV‚w26fW&‚ó2&˜72÷fñváB&VÊá6VRˆó46fW&‰'Vñ∆FñÊt&Ví(	@¢ÚÚFÜRvVˆ‚˜Fˆˆ¬6ˆ÷&Ú'WGFˆÁ27Fñ∆¬ÊVVBFÚ˜V∆FRFÜR7Fñˆ‡¢ÚÚ&"ÜW&R¬6÷R2f&“˜¶ˆÊRÜ&V∆˜rí¬WfV‚FÜ˜VvÇWfW'í˜FÜW ¢ÚÚ'Vñ∆FñÊrñÁFW&ñ˜"FV∆ñ&W&FV«í6Ü˜w2ÊˆÊR‚v˜&∆Bˆ&¶V7G2¬7&˜2¿¢ÚÚÊBgW&ÊóGW&R∆6V÷VÁBFˆ‚wBWÜó7Bñ‚6fW&‚¬6ÚFÜó26∂ó0¢ÚÚ7G&ñváBFÚFÜRFˆˆ¬÷7FñˆÁ2&∆ˆ6≤ñÁ7FVBˆbf∆∆ñÊrFá&˜VvÄ¢ÚÚFÜRf&“˜¶ˆÊR'&Ê6ÇvÜˆ∆W6∆R‡¢ñbÖˆó46fW&‰'Vñ∆FñÊt&VÜ7W'&VÁD&VíbbÜV∆D÷ˆFR””“wFˆˆ¬rí∞¢6ˆÁ7B6fW&Â&WFñ6∆R“vWE&WFñ6∆UFñ∆RÇì∞¢6ˆÁ7B6fW&ÂFñ∆R“vWD7FófTw&ñBÇï∂6fW&Â&WFñ6∆RÁ&˜u”ÚÂ∂6fW&Â&WFñ6∆RÊ6ˆ≈”∞¢6ˆÁ7B6fW&‰'FÁ2“µ”∞¢áFˆˆƒ7FñˆÁ5∂7FófUFˆˆ≈“«¬µ“íÊf˜$V6ÇÇÜ7Fñˆ‚¬íí”‚∞¢6ˆÁ7B∂f∆∆&6¥ñ6ˆÂ““7Fñˆ‰∆&V«5∂7FñˆÂ”∞¢6ˆÁ7Bñ6ˆ‚“GF6¥7Fñˆ‰ñ6ˆ‰ÖD‘¬Ü7FófUFˆˆ¬¬7Fñˆ‚¬f∆∆&6¥ñ6ˆ‚ì∞¢6ˆÁ7B∆∆˜vVB“6ÂW6T7Fñˆ‚Ü7FófUFˆˆ¬¬7Fñˆ‚¬6fW&Â&WFñ6∆RÊ6ˆ¬¬6fW&Â&WFñ6∆RÁ&˜rì∞¢6fW&‰'FÁ2ÁW6Çá∞¢ñ6ˆ‚¬∆&V√¢6ˆÁFWáGVƒ7Fñˆ‰∆&V¬Ü7Fñˆ‚¬6fW&ÂFñ∆Rí¿¢7Fñˆ‚¬7Gñ∆S¢í””“Úw&ñ÷'ír¢w6V6ˆÊF'ír¬∆∆˜vVB¿¢“ì∞¢“ì∞¢&WGW&‚6fW&‰'FÁ3∞¢–¢6ˆÁ7B%&WFñ6∆R“vWE&WFñ6∆UFñ∆RÇì∞¢6ˆÁ7B$ñÁFW&7F&∆R“ˆ'Vñ∆FñÊtñÁFW&7F&∆W2ÊvWBÜ7W'&VÁD&V≤r¬r≤%&WFñ6∆RÊ6ˆ¬≤r¬r≤%&WFñ6∆RÁ&˜rì∞¢ñbÜ$ñÁFW&7F&∆Rí&WGW&‚$ñÁFW&7F&∆RÊvWD'WGFˆÁ2Çì∞¢&WGW&‚µ”∞¢–†¢6ˆÁ7B&WFñ6∆R“vWE&WFñ6∆UFñ∆RÇì∞†¢ÚÚf&“˜¶ˆÊS¢6Ü˜r7˜BG&Á6óFñˆ‚'WGFˆ‚ÜÜ˜W6RVÁG&Ê6R¬F˜v‚WÜóB¬WF2‚ê¢ñbÇÜ7W'&VÁD&V””“vf&“r«¬ˆó5¶ˆÊT&VÜ7W'&VÁD&Vííbb˜VÊFñÊu7˜EG&Á6óFñˆ‚í∞¢6ˆÁ7BB“˜VÊFñÊu7˜EG&Á6óFñˆ„∞¢6ˆÁ7Bñ6ˆ‚“BÁF&vWB””“vñÁFW&ñ˜"rÚ	¯˙r¢BÁF&vWB””“wF˜v‚rÚ	¯˘Çr¢	˘™¢s∞¢6ˆÁ7B∆&V¬“BÊ∆&V¬«¬áBÁF&vWB””“vñÁFW&ñ˜"rÚtVÁFW"Ü˜W6Rr¢BÁF&vWB””“wF˜v‚rÚt∆VfRf&“r¢uG&fV¬rì∞¢6ˆÁ7B'FÁ57˜B“µ”∞¢'FÁ57˜BÁW6Çá≤ñ6ˆ‚¬∆&V¬¬7Fñˆ„¢wW6U˜7˜Br¬7Gñ∆S¢w&ñ÷'ír¬∆∆˜vVC¢G'VR“ì∞¢6ˆÁ7Bˆ&£"“vWEv˜&∆Dˆ&¶V7DBá&WFñ6∆RÊ6ˆ¬¬&WFñ6∆RÁ&˜rì∞¢ñbÜˆ&£"íˆ&£"ÊvWD'WGFˆÁ2á&WFñ6∆RíÊf˜$V6ÇÜ"”‚'FÁ57˜BÁW6ÇÜ"íì∞¢&WGW&‚'FÁ57˜C∞¢–†¢ÚÚ¶ˆÊS¢6∆ñ÷&&∆R6∆ñfbf6R7G&ñváBÜVBF∂W2&ñ˜&óGí˜fW"Fˆˆ¬W6R‡¢ñbÖˆó5¶ˆÊT&VÜ7W'&VÁD&Víbb∆ñW"Ê6∆ñ÷&ñÊrbbvñÊF˜r‰6∆ñ÷%7ó7FV“ÊvWD6∆ñ÷%F&vWBÇíí∞¢&WGW&‚∑≤ñ6ˆ„¢	˙yrr¬∆&V√¢t6∆ñ÷"r¬7Fñˆ„¢v6∆ñ÷"r¬7Gñ∆S¢w&ñ÷'ír¬∆∆˜vVC¢G'VR’”∞¢–†¢6ˆÁ7BFñ∆R“vWD7FófTw&ñBÇï∑&WFñ6∆RÁ&˜u’∑&WFñ6∆RÊ6ˆ≈”∞¢6ˆÁ7B'FÁ2“µ”∞†¢ÚÚ‚v˜&∆Bˆ&¶V7BB&WFñ6∆R(	BóG2'WGFˆÁ2F∂R&ñ˜&óGí‚F˜v‚Ü0¢ÚÚÊÚv˜&∆Dˆ&¶V7G2ˆbóG2˜v‚á6VRóG2&f&“◊66VÊR÷ˆÊ«í"6ˆ÷÷VÁ@¢ÚÚ&˜fRí(	BóG2gW&ÊóGW&RñÁFW&7F&∆W2á6óGF&∆R&VÊ6ÜW2¬WF2‚ê¢ÚÚ∆ófRñ‚ˆ'Vñ∆FñÊtñÁFW&7F&∆W2ñÁ7FVB¬6÷R2'Vñ∆FñÊrñÁFW&ñ˜'2‡¢6ˆÁ7Bˆ&¢“7W'&VÁD&V””“wF˜v‚p¢Úˆ'Vñ∆FñÊtñÁFW&7F&∆W2ÊvWBÇwF˜v‚¬r≤&WFñ6∆RÊ6ˆ¬≤r¬r≤&WFñ6∆RÁ&˜rí«¬vWEv˜&∆Dˆ&¶V7DBá&WFñ6∆RÊ6ˆ¬¬&WFñ6∆RÁ&˜rê¢¢vWEv˜&∆Dˆ&¶V7DBá&WFñ6∆RÊ6ˆ¬¬&WFñ6∆RÁ&˜rì∞¢ñbÜˆ&¢í∞¢6ˆÁ7Bˆ&§'FÁ2“ˆ&¢ÊvWD'WGFˆÁ2á&WFñ6∆Rì∞¢ˆ&§'FÁ2Êf˜$V6ÇÜ"”‚'FÁ2ÁW6ÇÜ"íì∞¢–†¢ÚÚ‚Fˆˆ¬w2˜v‚7FñˆÁ2á7W&W76VBñ‚óFV“÷ˆFRê¢ñbÜÜV∆D÷ˆFR””“wFˆˆ¬rí∞¢6ˆÁ7B7FñˆÁ2“Fˆˆƒ7FñˆÁ5∂7FófUFˆˆ≈“«¬µ”∞¢7FñˆÁ2Êf˜$V6ÇÇÜ7Fñˆ‚¬íí”‚∞¢6ˆÁ7B∂f∆∆&6¥ñ6ˆÂ““7Fñˆ‰∆&V«5∂7FñˆÂ”∞¢6ˆÁ7Bñ6ˆ‚“GF6¥7Fñˆ‰ñ6ˆ‰ÖD‘¬Ü7FófUFˆˆ¬¬7Fñˆ‚¬f∆∆&6¥ñ6ˆ‚ì∞¢6ˆÁ7B∆∆˜vVB“6ÂW6T7Fñˆ‚Ü7FófUFˆˆ¬¬7Fñˆ‚¬&WFñ6∆RÊ6ˆ¬¬&WFñ6∆RÁ&˜rì∞¢'FÁ2ÁW6Çá∞¢ñ6ˆ‚¬∆&V√¢6ˆÁFWáGVƒ7Fñˆ‰∆&V¬Ü7Fñˆ‚¬Fñ∆Rí¿¢7Fñˆ‚¬7Gñ∆S¢í””“Úw&ñ÷'ír¢w6V6ˆÊF'ír¬∆∆˜vVB¿¢“ì∞¢“ì∞¢–†¢ÚÚ"≥2‚óFV“6ˆÁFWáB7FñˆÁ2(	BˆÊ«íñ‚óFV“÷ˆFP¢ñbÜÜV∆D÷ˆFR”“vóFV“rí&WGW&‚'FÁ3∞†¢ÚÚ"‚6ˆÁFWáC¢∆ÁB'WGFˆ‚ñb6V∆V7FVBóFV“ó26VVBÊBFñ∆R6‚66WBó@¢6ˆÁ7BóFV““vWD7FófTñÁfVÁF˜'îóFV“Çì∞¢ñbÜóFV“bbóFV“Á6VVDf˜"í∞¢6ˆÁ7B7&˜Ê÷R“óFV“Á6VVDf˜#∞¢6ˆÁ7B∆ÁD7B“w∆ÁEÚr≤7&˜Ê÷S∞¢6ˆÁ7B6˜VÁB“ñÁfVÁF˜'ï∂óFV“Ê∂Wï“«¬∞¢6ˆÁ7B6Â∆ÁB“6˜VÁB‚bb6Â∆ÁD7&˜ˆÂFñ∆RÜ7&˜Ê÷R¬Fñ∆Rì∞¢'FÁ2ÁW6Çá∞¢ñ6ˆ„¢óFV“Êñ6ˆ‚¬∆&V√¢6˜VÁB‚Ú∆ÁBÇG∂6˜VÁG“ñ¢tÊÚ6VVG2r¿¢7Fñˆ„¢∆ÁD7B¬7Gñ∆S¢w∆ÁBr¬∆∆˜vVC¢6Â∆ÁB¿¢“ì∞¢–†¢ñbÜóFV“í∞¢6ˆÁ7BgW&ÊóGW&T∂Wí“vWDgW&ÊóGW&T∂Wî'îóFV‘∂WíÜóFV“Ê∂Wíì∞¢ñbÜgW&ÊóGW&T∂Wíí∞¢6ˆÁ7B6˜VÁB“ñÁfVÁF˜'ï∂óFV“Ê∂Wï“«¬∞¢'FÁ2ÁW6Çá∞¢ñ6ˆ„¢óFV“Êñ6ˆ‚¿¢∆&V√¢6˜VÁB‚Ú∆6RÇG∂6˜VÁG“ñ¢tÊÚgW&ÊóGW&Rr¿¢7Fñˆ„¢w∆6UÚr≤gW&ÊóGW&T∂Wí¿¢7Gñ∆S¢w∆ÁBr¿¢∆∆˜vVC¢6˜VÁB‚bb6Â∆6TgW&ÊóGW&TBá&WFñ6∆RÊ6ˆ¬¬&WFñ6∆RÁ&˜rí¿¢“ì∞¢–¢6ˆÁ7BFV6˜$∂Wí“vWDFV6˜&FófTgW&ÊóGW&T∂Wî'îóFV‘∂WíÜóFV“Ê∂Wíì∞¢ñbÜFV6˜$∂Wíí∞¢6ˆÁ7BFVb“DT4ı$DïdUÙeU$‰ïEU$UÙDTe5∂FV6˜$∂Wï”∞¢6ˆÁ7B6˜VÁB“ñÁfVÁF˜'ï∂óFV“Ê∂Wï“«¬∞¢6ˆÁ7B&Vˆ≤“FVbÊ&V””“vÁír«¬ÜFVbÊ&V””“vñÁFW&ñ˜"rbb7W'&VÁD&V””“vñÁFW&ñ˜"rí«¬ÜFVbÊ&V””“vf&“rbb7W'&VÁD&V””“vf&“rì∞¢'FÁ2ÁW6Çá∞¢ñ6ˆ„¢óFV“Êñ6ˆ‚¿¢∆&V√¢6˜VÁB‚Ú∆6RÇG∂6˜VÁG“ñ¢tÊÚgW&ÊóGW&Rr¿¢7Fñˆ„¢w∆6UˆFV6˜%Úr≤FV6˜$∂Wí¿¢7Gñ∆S¢w∆ÁBr¿¢∆∆˜vVC¢6˜VÁB‚bb&Vˆ≤bb6Â∆6TFV6˜&FófTgW&ÊóGW&TBá&WFñ6∆RÊ6ˆ¬¬&WFñ6∆RÁ&˜rí¿¢“ì∞¢–¢–†¢ÚÚ2‚6ˆÁFWáC¢Ü'fW7B'WGFˆ‚ñb&WFñ6∆VBFñ∆RÜ2&VGí7&˜ ¢ñbáFñ∆RÊ7&˜í∞¢6ˆÁ7BFF“7&˜FF∑Fñ∆RÊ7&˜”∞¢'FÁ2ÁW6Çá∞¢ñ6ˆ„¢Fñ∆RÊ7&˜&VGíÚFFÊV÷ˆ¶í¢	¯Àr¿¢∆&V√¢Fñ∆RÊ7&˜&VGíÚ~)…2Ü'fW7Br¢G∑Fñ∆RÊ7&˜“ÇG¥÷FÇÊf∆ˆ˜"áFñ∆RÊ7&˜vRó÷Bñ¿¢7Fñˆ„¢vÜ'fW7Br¬7Gñ∆S¢Fñ∆RÊ7&˜&VGíÚvÜ'fW7Br¢w6V6ˆÊF'ír¿¢∆∆˜vVC¢Fñ∆RÊ7&˜&VGí¿¢“ì∞¢–†¢&WGW&‚'FÁ3∞¢–†¢ÚÚG&6≤∆7B7FFRFÚfˆñB&V'Vñ∆FñÊrFÜR7F6≤WfW'íg&÷P¢∆WBˆ∆7D&$∂Wí“rs∞†¢gVÊ7Fñˆ‚&Vg&W6Ñ7Fñˆ‰&"Çí∞¢vñÊF˜r‰FWe7vÊW"Á&Vg&W6ÑVFóF˜$'WGFˆÂfó6ñ&ñ∆óGíÇì∞¢vñÊF˜r‰gW&ÊóGW&U∆6W#ÚÁ&Vg&W6Öfó6ñ&ñ∆óGíÇì∞¢6ˆÁ7B&WFñ6∆R“vWE&WFñ6∆UFñ∆RÇì∞¢6ˆÁ7BFñ∆R“vWD7FófUFñ∆TBá&WFñ6∆RÊ6ˆ¬¬&WFñ6∆RÁ&˜rì∞†¢ÚÚv2f&“÷ˆÊ«íáv˜&∆Bˆ&¶V7G2FñF‚wBWÜó7BV«6WvÜW&Rí(	BÊ˜p¢ÚÚVÊ6ˆÊFóFñˆÊ¬6Ú∆ˆ˜F&∆R6˜'6Rw2ñFVÁFóGíñ‚Áí&Vá¶ˆÊW0¢ÚÚñÊ6«VFVBí7Fñ∆¬ñÁf∆ñFFW2FÜR66ÜRÊB&V'Vñ∆G2óG2'WGFˆ‚‡¢6ˆÁ7Bˆ&¢“vWEv˜&∆Dˆ&¶V7DBá&WFñ6∆RÊ6ˆ¬¬&WFñ6∆RÁ&˜rì∞¢6ˆÁ7BÊV&'îÁ4∂Wí“ÊV&'îÁ5v∆∂W#ÚÁ&V3ÚÊñB«¬ÊV&'îÁ5v∆∂W#ÚÁ&ˆ˜CÚÁWVñB«¬vÊˆÊRs∞¢6ˆÁ7BÊV&'îÁ47FófóGî∂Wí“ÊV&'îÁ5v∆∂W#ÚÊ7W'&VÁE66ÜVGV∆UF&vWCÚÊ7FófóGí«¬vÊˆÊRs∞¢6ˆÁ7BÊV&'îÁ56Ü˜∂Wí“ÊV&'îÁ5v∆∂W"bbó4vVÊW&≈7F˜&TÁ4ˆ‰GWGíÜÊV&'îÁ5v∆∂W"íÚvVÊW&≈7F˜&T7Fñˆ‚Çê¢¢ÊV&'îÁ5v∆∂W"bbó46'VÁFW$Á4ˆ‰GWGíÜÊV&'îÁ5v∆∂W"íÚ6'VÁFW$7Fñˆ‚Çí¢vÊˆÊRs∞¢ÚÚvñÊF˜r‰fó6ÜñÊsÚÁ7FFSÚÁÜ6RÜÊ˜BßW7BÊ7FófRí◊W7B&Rñ‚FÜó2∂Wì†¢ÚÚ6ˆ◊WFT7Fñˆ‰'WGFˆÁ2Çí&WGW&Á2FñffW&VÁB'WGFˆ‚6WG27&˜72FÜP¢ÚÚ67B˜vóFñÊrˆ&óFRˆ7FófRˆ6VváB6WVVÊ6RÜV◊GíVÁFñ¬v&óFRr¬FÜP¢ÚÚfó6Ö˜&ñ÷'íˆfó6Öˆ6Ê6V¬ó"g&ˆ“v&óFRrˆÁv&Bí¬'WBFÜBvÜˆ∆P¢ÚÚ6WVVÊ6RW7V∆«íFˆW6‚wBF˜V6ÇÁóFÜñÊrV«6RFÜR∂WíG&6∑2á6÷P¢ÚÚFñ∆R¬6÷RFˆˆ¬¬6÷R&WFñ6∆Rí(	B∂WññÊrˆ‚ßW7BÊ7FófRv˜V∆BwfP¢ÚÚ6VváBFÜRfW'ífó'7BG&Á6óFñˆ‚ñÁFÚfó6ÜñÊr'WBFÜV‚ÊWfW ¢ÚÚ&V'Vñ«Bvñ‚f˜"FÜR&W7BˆbFÜR&˜VÊB¬6ñÊ6RÊ7FófR7Fó2G'VP¢ÚÚFá&˜VvÜ˜WB‚Ü6R6ÜÊvW2WfW'í7FW¬6ÚóB«vó2f˜&6W2&V'Vñ∆B‡¢6ˆÁ7B∂Wí“G∂7W'&VÁD&V◊¬G∂ÜV∆D÷ˆFW◊¬G∂7FófUFˆˆ«◊¬G∂7FófTóFV‘ñÊFWá◊¬G∑&WFñ6∆RÊ6ˆ«“¬G∑&WFñ6∆RÁ&˜w◊¬G∑Fñ∆RÁGóW◊¬G∑Fñ∆RÊ7&˜◊¬G∑Fñ∆RÊ7&˜&VGó◊¬G∂ˆ&¢Úˆ&¢ÊñB¢vÊˆÊRw◊¬G∑&ˆ6W76ñÊtgW&ÊóGW&Tˆ&¶V7G2Á6ó¶W◊¬G∂Êñ÷ƒˆ&¶V7G2Á6ó¶W◊¬Gµ˜VÊFñÊu7˜EG&Á6óFñˆ„ÚÊñB«¬rw◊¬G∂ÊV&'îÁ4∂Wó◊¬G∂ÊV&'îÁ47FófóGî∂Wó◊¬G∂ÊV&'îÁ56Ü˜∂Wó◊¬G∑vñÊF˜r‰fó6ÜñÊsÚÁ7FFSÚÁÜ6R«¬rw÷∞¢6ˆÁ7BÊVVG5&V'Vñ∆B“∂Wí”“ˆ∆7D&$∂Wì∞¢ˆ∆7D&$∂Wí“∂Wì∞†¢6ˆÁ7B'FÁ2“6ˆ◊WFT7Fñˆ‰'WGFˆÁ2Çì∞†¢ÚÚWFFR7FófT7Fñˆ‚WfV‚vóFÜ˜WBDÙ“&V'Vñ∆@¢6ˆÁ7Bfó'7B“'FÁ2ÊfñÊBÜ"”‚"Ê∆∆˜vVBí«¬'FÁ5≥”∞¢ñbÜfó'7Bí7FófT7Fñˆ‚“fó'7BÊ7Fñˆ„∞†¢ñbÇÊVVG5&V'Vñ∆Bí&WGW&„∞†¢ÚÚ7∆óBñÁFÚFˆˆ¬7FñˆÁ2ÜFñrˆfñ∆¬˜Fñ∆¬ˆ7WN(
bíg2óFV“7FñˆÁ2á∆ÁEÚ¢ˆÜ'fW7Bê¢6ˆÁ7BFˆˆƒ'FÁ2“'FÁ2Êfñ«FW"Ü"”‚"Ê7Fñˆ‚Á7F'G5vóFÇÇw∆ÁEÚríbb"Ê7Fñˆ‚Á7F'G5vóFÇÇw∆6UÚríbb"Ê7Fñˆ‚Á7F'G5vóFÇÇw7vÂÚríbb"Ê7Fñˆ‚”“vÜ'fW7Brì∞¢6ˆÁ7BóFV‘'FÁ2“'FÁ2Êfñ«FW"Ü"”‚"Ê7Fñˆ‚Á7F'G5vóFÇÇw∆ÁEÚrí«¬"Ê7Fñˆ‚Á7F'G5vóFÇÇw∆6UÚrí«¬"Ê7Fñˆ‚Á7F'G5vóFÇÇw7vÂÚrí«¬"Ê7Fñˆ‚””“vÜ'fW7Brì∞†¢6ˆÁ7BDU4µÙ¥Uï2“≤tRr¬ur¬tc2r¬tcBu”∞†¢gVÊ7Fñˆ‚«î'BÜVƒñB¬"¬˜&ñvñÊƒñGÇí∞¢6ˆÁ7BV¬“Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÜVƒñBì∞¢ñbÇV¬í&WGW&„∞¢ñbÇ"í≤V¬Ê6∆74∆ó7BÊFBÇv'B÷ÜñFFV‚rì≤&WGW&„≤–¢V¬Ê6∆74∆ó7BÁ&V÷˜fRÇv'B÷ÜñFFV‚rì∞¢V¬Ê6∆74∆ó7BÁFˆvv∆RÇv&∆ˆ6∂VBr¬"Ê∆∆˜vVBì∞¢V¬ÊFF6WBÊ7Fñˆ‚“"Ê7Fñˆ„∞¢6ˆÁ7B∂Wî&FvR“ó4FW6∑F˜bb˜&ñvñÊƒñGÇ„“bb˜&ñvñÊƒñGÇ¬DU4µÙ¥Uï2Ê∆VÊwFÄ¢Ú«7‚6∆73“&'B÷∂Wí#Â≤G¥DU4µÙ¥Uï5∂˜&ñvñÊƒñGÖ◊’”¬˜7„Ê¢rs∞¢V¬ÊñÊÊW$ÖD‘¬“∂Wî&FvR∞¢«7‚6∆73“&'B÷ñ6ˆ‚#‚G∂"Êñ6ˆÁ”¬˜7„Ê∞¢«7‚6∆73“&'B÷∆&V¬#‚G∂"Ê∆&V«”¬˜7„Ê∞¢ñbÇV¬Âˆ'DG&tñÊóBí∞¢V¬Âˆ'DG&tñÊóB“G'VS∞¢∆WB˜DñB“ÁV∆¬¬ˆ7Ç“¬ˆ7í“¬˜6ˆ6µ"“∞¢∆WBˆG&r“f«6R¬˜'Fñ÷W"“ÁV∆¬¬˜6ˆ6∂WB“ÁV∆√∞¢∆WBˆ6Ü&vTfó&VDˆÂ&W72“f«6S∞¢∆WB˜&W756∆˜B“ÁV∆√≤ÚÚ˜""vÜñ∆RvVˆ‚Fˆˆ¬÷7Fñˆ‚'WGFˆ‚ó2÷ñB◊&W70¢6ˆÁ7BE$uıDÖ$U4Ç“∞¢ÚÚ∆Vv7í&VÜfñ˜#¢Üˆ∆FñÊr∂G&vvñÊr‚7Fñˆ‚'WGFˆ‚∆ñ∂R7Fñ6≤W6VBF¢ÚÚ∂VW&R÷fó&ñÊrFÜR7Fñˆ‚WfW'í#◊2f˜"2∆ˆÊr2óB7FñVBW6ÜVBˆf`¢ÚÚ6VÁFW"‚Fó6&∆VBW"FW6ñv‚áFÜR6ñÊv∆Rñ÷÷VFñFRfó&R÷ˆ‚◊Fá&W6Üˆ∆B÷7&˜70¢ÚÚ&V∆˜r7Fñ∆¬ÜVÁ2í(	B∂WBÜW&R¬Ê˜BFV∆WFVB¬ñ‚66RóBw2vÁFVB&6≤‡¢6ˆÁ7B%EÙE$uı$UTEÙdï$R“f«6S∞¢6ˆÁ7B˜7F6≤“Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÇv7FñˆÂ7F6≤rì∞†¢gVÊ7Fñˆ‚ˆ'Dfó&RÇí∞¢6ˆÁ7B7B“V¬ÊFF6WBÊ7Fñˆ„∞¢ñbÇ7B«¬V¬Ê6∆74∆ó7BÊ6ˆÁFñÁ2Çv'B÷ÜñFFV‚ríí&WGW&„∞¢7FófT7Fñˆ‚“7C∞¢ÚÚÊfñvFñˆ‚ˆñÁFW&7Fñˆ‚7FñˆÁ2«vó2fó&S≤Fˆˆ¬7FñˆÁ2&W7V7B7vñÊr6ˆˆ∆F˜v‚‡¢ÚÚfó6Ö˜&ñ÷'íˆfó6Öˆ6Ê6V¬'ó72óBFˆÚ(	B7V&fó6ÜñÊrÜ2ÊWfW ¢ÚÚW6VBFÜR7vñÊr◊Fñ÷W"7ó7FV“á6VRfó&Tfó6ÜñÊt'&ñFvRw2˜v‚Ê˜FRˆ‡¢ÚÚFÜó2í¬6ÚvFñÊrFÜR&2'WGFˆ‚&VÜñÊBóBÜW&Rv˜V∆BßW7B÷V‡¢ÚÚ7G&í∆VgF˜fW"Fˆˆ≈7vñÊuBg&ˆ“vÜFWfW"v2WVóVB&Vf˜&P¢ÚÚ7vóF6ÜñÊrFÚFÜRÜ'ˆˆ‚6˜V∆B6ñ∆VÁF«íVBFÜRF‚6∆ñ÷"ó2FÜP¢ÚÚ6÷R7F˜'ì¢óBw2W&RG&fW'6¬¬Ê˜BFˆˆ¬7vñÊr¬6Ú∆VgF˜fW ¢ÚÚFˆˆ≈7vñÊuBg&ˆ“vÜFWfW"v2WVóVB&Vf˜&Rv∆∂ñÊrWFÚ¢ÚÚ6∆ñfb6Ü˜V∆F‚wB&R&∆RFÚVBFÜRFVóFÜW"‡¢6ˆÁ7Bó4Êd7Fñˆ‚“7B””“Á4Fñ∆ˆwVT7Fñˆ‚Çí«¬7B””“vVÊW&≈7F˜&T7Fñˆ‚Çí«¬7B””“6'VÁFW$7Fñˆ‚Çí«¬7B””“wW6U˜7˜Br«¬7B””“vˆ&•ˆWÜóEˆÜ˜W6Rr«¬7B””“v6∆ñ÷"r«¬7BÁ7F'G5vóFÇÇvˆ&•Úrí«¬7BÁ7F'G5vóFÇÇvfó6ÖÚrì∞¢ñbÜó4Êd7Fñˆ‚«¬Fˆˆ≈7vñÊuB√“íW6T7FófT7Fñˆ‚Çì∞¢–†¢ÚÚvVˆ‚Fˆˆ¬÷7Fñˆ‚'WGFˆÁ2Ü7WB˜6∆6Çí&˜WFRF2Fá&˜VvÇFÜP¢ÚÚ∆ˆF˜WBw2&ñ∆óGí6∆˜G2ñÁ7FVBˆbfó&ñÊrFÜR7vñÊrFó&V7F«í(	@¢ÚÚWfW'í˜FÜW"'WGFˆ‚∂VW2W6ñÊrˆ'Dfó&RÇíVÊ6ÜÊvVB‡¢gVÊ7Fñˆ‚˜vVˆÂ6∆˜Df˜"Ü7Bí∞¢ñbÜ7FófUFˆˆ¬”“wvVˆ‚r«¬vñÊF˜r‰6ˆ÷&CÚÊñÁWBí&WGW&‚ÁV∆√∞¢ñbÜ7B””“Fˆˆƒ7FñˆÁ2ÁvVˆÂ≥“í&WGW&‚∞¢ñbÜ7B””“Fˆˆƒ7FñˆÁ2ÁvVˆÂ≥“í&WGW&‚#∞¢&WGW&‚ÁV∆√∞¢–¢gVÊ7Fñˆ‚˜&W6ˆ«fTfó&RÇí∞¢6ˆÁ7B6∆˜B“˜vVˆÂ6∆˜Df˜"ÜV¬ÊFF6WBÊ7Fñˆ‚ì∞¢ñbá6∆˜Bí≤vñÊF˜r‰6ˆ÷&BÊñÁWBÊfó&UFá6∆˜Bì≤&WGW&„≤–¢ˆ'Dfó&RÇì∞¢–†¢V¬ÊFDWfVÁD∆ó7FVÊW"ÇwˆñÁFW&F˜v‚r¬Wb”‚∞¢ñbÖ˜DñB”“ÁV∆¬í&WGW&„∞¢˜DñB“WbÁˆñÁFW$ñC∞¢ÚÚ6VRÜÊF∆T¶˜ó7Fñ6µˆñÁFW$F˜v‚w26ˆ÷÷VÁB‡¢G'í≤V¬Á6WEˆñÁFW$6GW&RÜWbÁˆñÁFW$ñBì≤“6F6ÇÜW'"í≤Ú¢FVw&FRw&6VgV∆«í¢Ú–¢6ˆÁ7B&V7B“V¬ÊvWD&˜VÊFñÊt6∆ñVÁE&V7BÇì∞¢ˆ7Ç“&V7BÊ∆VgB≤&V7BÁvñGFÇÚ#∞¢ˆ7í“&V7BÁF˜≤&V7BÊÜVñváBÚ#∞¢˜6ˆ6µ"“&V7BÁvñGFÇ¢„s∞¢ˆG&r“f«6S∞¢˜6ˆ6∂WB“Fˆ7V÷VÁBÊ7&VFTV∆V÷VÁBÇvFóbrì∞¢˜6ˆ6∂WBÊ6∆74Ê÷R“v'B◊6ˆ6∂WBs∞¢˜6ˆ6∂WBÁ7Gñ∆RÊ∆VgB“ˆ7Ç≤wÇs∞¢˜6ˆ6∂WBÁ7Gñ∆RÁF˜“ˆ7í≤wÇs∞¢˜6ˆ6∂WBÁ7Gñ∆RÁvñGFÇ“á&V7BÁvñGFÇ¢"„"í≤wÇs∞¢˜6ˆ6∂WBÁ7Gñ∆RÊÜVñváB“á&V7BÁvñGFÇ¢"„"í≤wÇs∞¢Fˆ7V÷VÁBÊ&ˆGíÊVÊD6Üñ∆BÖ˜6ˆ6∂WBì∞¢V¬Á7Gñ∆RÁG&Á6óFñˆ‚“vÊˆÊRs∞¢WbÁ&WfVÁDFVfV«BÇì∞¢ÚÚÜˆ∆B◊FÚ÷Fñrˆfñ∆¬◊W7B7F'Bˆ‚&W72ÜÊ˜B&V∆V6Rí6ÚFÜR6Ü&vP¢ÚÚ6‚'V‚f˜"óG2gV∆¬GW&Fñˆ‚vÜñ∆RFÜR'WGFˆ‚7Fó2ÜV∆B‡¢6ˆÁ7B7B“V¬ÊFF6WBÊ7Fñˆ„∞¢ˆ6Ü&vTfó&VDˆÂ&W72“&ˆˆ∆V‚Ü7BbbV¬Ê6∆74∆ó7BÊ6ˆÁFñÁ2Çv'B÷ÜñFFV‚ríbbv˜V∆E7F'D6Ü&vRÜ7FófUFˆˆ¬¬7Bíì∞¢ñbÖˆ6Ü&vTfó&VDˆÂ&W72í∞¢7FófT7Fñˆ‚“7C∞¢7Fñˆ‰ÜV∆DF˜v‚“G'VS∞¢ˆ'Dfó&RÇì∞¢“V«6R∞¢7Fñˆ‰ÜV∆DF˜v‚“G'VS∞¢˜&W756∆˜B“˜vVˆÂ6∆˜Df˜"Ü7Bì∞¢ñbÖ˜&W756∆˜BívñÊF˜r‰6ˆ÷&BÊñÁWBÁ&W757F'BÖ˜&W756∆˜Bì∞¢–¢“ì∞†¢V¬ÊFDWfVÁD∆ó7FVÊW"ÇwˆñÁFW&÷˜fRr¬Wb”‚∞¢ñbÜWbÁˆñÁFW$ñB”“˜DñBí&WGW&„∞¢6ˆÁ7BGÇ“WbÊ6∆ñVÁEÇ“ˆ7Ç¬Gí“WbÊ6∆ñVÁEí“ˆ7ì∞¢6ˆÁ7BFó7B“÷FÇÊáó˜BÜGÇ¬Gíì∞¢6ˆÁ7B"“÷FÇÊ÷ñ‚ÜFó7B¬˜6ˆ6µ"ì∞¢6ˆÁ7BÁÇ“Fó7B‚„RÚGÇÚFó7B¢"¢∞¢6ˆÁ7BÁí“Fó7B‚„RÚGíÚFó7B¢"¢∞¢V¬Á7Gñ∆RÁG&Á6f˜&““G&Á6∆FRÜ6∆2ÉSR≤G∂Áá◊Çí¬6∆2ÉSR≤G∂Áó◊Çíñ∞¢ÚÚvóFÇvVˆ‚WVóVB¬7Fñˆ‚'WGFˆÁ2&RFˆÜˆ∆BˆÊ«í(	BG&vvñÊp¢ÚÚ◊W7BÊWfW"7B∆ñ∂RFó&V7FñˆÊ¬7Fñ6≤¬˜FÜW'vó6RFáV÷"vˆ&&∆ñÊp¢ÚÚ÷ñB÷Üˆ∆B&VG22‚ñ“÷G&r¬6Ê6V«2FÜRVÊFñÊrÜˆ∆B&ñ∆óGí¬Ê@¢ÚÚfó&W2FñÁ7FVB‚f&“Fˆˆ«27Fñ∆¬W6RG&r◊FÚ÷ñ“2&Vf˜&R‡¢ñbÜ7FófUFˆˆ¬””“wvVˆ‚rí&WGW&„∞¢ñbÜFó7B‚E$uıDÖ$U4Çí∞¢6ˆÁ7BÊr“÷FÇÊF„"ÜGí¬GÇì∞¢f6ñÊtÊv∆R“Ês∞¢∆7D÷˜fTÊv∆R“Ês∞¢∆ñW"ÊÊv∆R“Ês∞¢ÚÚ7GV∆«í&WF&vWBFÜR&WFñ6∆RÜvWE&WFñ6∆UFñ∆RÇí&VG0¢ÚÚF&vWDñ‘Êv∆R¬Ê˜Bf6ñÊtÊv∆R˜∆ñW"ÊÊv∆R(	B6VRóG0¢ÚÚFV6∆&Fñˆ‚í6ÚFÜó2G&rvVÁVñÊV«íñ◊2f&“◊Fˆˆ¬7FñˆÁ0¢ÚÚ∆ñ∂RÜR6Ü˜Úñ6≤÷ñÊRB7V6ñfñ2Fñ∆Rˆ‚÷ˆ&ñ∆R¿¢ÚÚñÁ7FVBˆbˆÊ«í&˜FFñÊrFÜR∆ñW"w2fó7V¬f6ñÊrvÜñ∆P¢ÚÚFÜR&WFñ6∆R7Fó2vÜW&WfW"FÜR÷˜fV÷VÁB¶˜ó7Fñ6≤∆7@¢ÚÚˆñÁFVBóB‡¢F&vWDñ‘Êv∆R“Ês∞¢ñbÇˆG&rí∞¢ˆG&r“G'VS∞¢˜7F6≤Ê6∆74∆ó7BÊFBÇvG&r÷7FófRrì∞¢ÚÚñ÷ñÊrF∂W2˜fW"fó&ñÊrg&ˆ“ÜW&R(	BFó6&“FÜRFˆÜˆ∆@¢ÚÚFñ÷W"6Ú&V∆V6RFˆW6‚wB«6Úfó&RˆVÊB‚&ñ∆óGí‡¢ñbÖ˜&W756∆˜Bí≤vñÊF˜r‰6ˆ÷&BÊñÁWBÊ6Ê6V≈&W72Ö˜&W756∆˜Bì≤˜&W756∆˜B“ÁV∆√≤–¢˜&W6ˆ«fTfó&RÇì∞¢ñbÑ%EÙE$uı$UTEÙdï$Rí˜'Fñ÷W"“6WDñÁFW'f¬Ö˜&W6ˆ«fTfó&R¬#ì∞¢–¢–¢“ì∞†¢gVÊ7Fñˆ‚ˆ'EWÜWbí∞¢ñbÜWbÁˆñÁFW$ñB”“˜DñBí&WGW&„∞¢˜DñB“ÁV∆√∞¢7Fñˆ‰ÜV∆DF˜v‚“f«6S∞¢ñbÖ˜'Fñ÷W"í≤6∆V$ñÁFW'f¬Ö˜'Fñ÷W"ì≤˜'Fñ÷W"“ÁV∆√≤–¢˜7F6≤Ê6∆74∆ó7BÁ&V÷˜fRÇvG&r÷7FófRrì∞¢ñbÖ˜6ˆ6∂WBí≤˜6ˆ6∂WBÁ&V÷˜fRÇì≤˜6ˆ6∂WB“ÁV∆√≤–¢V¬Á7Gñ∆RÁG&Á6óFñˆ‚“wG&Á6f˜&“„G2V6R÷˜WBs∞¢V¬Á7Gñ∆RÁG&Á6f˜&““wG&Á6∆FRÉSR¬SRís∞¢6WEFñ÷V˜WBÇÇí”‚≤V¬Á7Gñ∆RÁG&Á6óFñˆ‚“rs≤V¬Á7Gñ∆RÁG&Á6f˜&““rs≤“¬Sì∞¢ñbÇˆG&rbbˆ6Ü&vTfó&VDˆÂ&W72í∞¢ñbÖ˜&W756∆˜BívñÊF˜r‰6ˆ÷&BÊñÁWBÁ&W74VÊBÖ˜&W756∆˜Bì∞¢V«6Rˆ'Dfó&RÇì∞¢–¢ˆG&r“f«6S∞¢ˆ6Ü&vTfó&VDˆÂ&W72“f«6S∞¢˜&W756∆˜B“ÁV∆√∞¢–†¢V¬ÊFDWfVÁD∆ó7FVÊW"ÇwˆñÁFW'Wr¬ˆ'EWì∞¢V¬ÊFDWfVÁD∆ó7FVÊW"ÇwˆñÁFW&6Ê6V¬r¬ˆ'EWì∞¢–¢–†¢ñbÜÜV∆D÷ˆFR””“vóFV“rí∞¢ÚÚóFV“÷ˆFS¢∆¬7FñˆÁ27&VB7&˜72∆¬R&6Ç˜6óFñˆÁ0¢«î'BÇv'F‰7Fñˆ„r¬'FÁ5≥“¬ì∞¢«î'BÇv'F‰7Fñˆ„"r¬'FÁ5≥“¬ì∞¢«î'BÇv'F‰7Fñˆ„2r¬'FÁ5≥%“¬"ì∞¢«î'BÇv'F‰óFV‘7Fñˆ„r¬'FÁ5≥5“¬2ì∞¢«î'BÇv'F‰óFV‘7Fñˆ„"r¬'FÁ5≥E“¬Bì∞¢“V«6R∞¢«î'BÇv'F‰7Fñˆ„r¬Fˆˆƒ'FÁ5≥“¬'FÁ2ÊñÊFWÑˆbáFˆˆƒ'FÁ5≥“íì∞¢«î'BÇv'F‰7Fñˆ„"r¬Fˆˆƒ'FÁ5≥“¬'FÁ2ÊñÊFWÑˆbáFˆˆƒ'FÁ5≥“íì∞¢«î'BÇv'F‰7Fñˆ„2r¬Fˆˆƒ'FÁ5≥%“¬'FÁ2ÊñÊFWÑˆbáFˆˆƒ'FÁ5≥%“íì∞¢«î'BÇv'F‰óFV‘7Fñˆ„r¬óFV‘'FÁ5≥“¬'FÁ2ÊñÊFWÑˆbÜóFV‘'FÁ5≥“íì∞¢«î'BÇv'F‰óFV‘7Fñˆ„"r¬óFV‘'FÁ5≥“¬'FÁ2ÊñÊFWÑˆbÜóFV‘'FÁ5≥“íì∞¢–†¢ñbÜó4FW6∑F˜í&Vg&W6Ñ∂WîáVBÜ'FÁ2ì∞¢–†¢gVÊ7Fñˆ‚&Vg&W6Ñ∂WîáVBÜ'FÁ2í∞¢ñbÇ∂WîáVDV¬í&WGW&„∞¢6ˆÁ7BóFV““vWD7FófTñÁfVÁF˜'îóFV“Çì∞¢6ˆÁ7B&WFñ6∆R“vWE&WFñ6∆UFñ∆RÇì∞¢6ˆÁ7BFñ∆R“w&ñE∑&WFñ6∆RÁ&˜u’∑&WFñ6∆RÊ6ˆ≈”∞¢6ˆÁ7Bˆ&¢“vWEv˜&∆Dˆ&¶V7DBá&WFñ6∆RÊ6ˆ¬¬&WFñ6∆RÁ&˜rì∞†¢6ˆÁ7B'G2“µ”∞†¢ÚÚFˆˆ¿¢6ˆÁ7BˆWóFV““WVó÷VÁE6∆˜G5∂7FófUFˆˆ≈”∞¢6ˆÁ7BˆWFVb“ˆWóFV“ÚDÙÙ≈ÙïDT’ÙDTe5µˆWóFV’“¢ÁV∆√∞¢6ˆÁ7Bˆ∂Ñf∆∆&6≤“á≤6Ü˜fV√•≤~)∏˛˚àÚr¬u6Ü˜fV¬u“¬ÜˆS•≤	˙©2r¬tÜˆRu“¬ÜS•≤	˙©2r¬tÜRu“¬ñ6≥•≤~)∏˛˚àÚr¬uñ6≤u“¬Ü'ˆˆ„•≤	¯Í2r¬tÜ'ˆˆ‚u“¬vVˆ„•≤	˘z˚àÚr¬uvVˆ‚u“¬÷6ÜWFS•≤	˘z˚àÚr¬uvVˆ‚u“’∂7FófUFˆˆ≈“«¬≤	˘Jrr¬7FófUFˆˆ≈“ì∞¢6ˆÁ7BFˆˆƒñÊfÚ“∑Fˆˆ≈6V∆V7Dñ6ˆ‰ÖD‘¬ÖˆWFVb¬ˆ∂Ñf∆∆&6µ≥“¬s7Çrí¬ˆWFVcÚÊ∆&V¬«¬ˆ∂Ñf∆∆&6µ≥’”∞¢'G2ÁW6ÇÜ∆Fób6∆73“&∂Ç÷w&˜W#„«7‚6∆73“&∂Ç÷∂Wí#„Û"Û3¬˜7„„«7‚6∆73“&∂Ç◊Fˆˆ¬#‚G∑FˆˆƒñÊfı≥◊“G∑FˆˆƒñÊfı≥◊”¬˜7„„¬ˆFócÊì∞¢'G2ÁW6ÇÇs∆Fób6∆73“&∂Ç÷Fób#„¬ˆFóc‚rì∞†¢ÚÚ7Fñˆ‚'WGFˆÁ2(i"∂Wí&ˆ◊G3¢fó'7B“µ76RÙU“¬6V6ˆÊB“µ–¢'FÁ2Êf˜$V6ÇÇÜ"¬ñGÇí”‚∞¢6ˆÁ7B∂Wî∆&V¬“ñGÇ””“ÚtRr¢ñGÇ””“Úur¢bG∂ñGá÷∞¢6ˆÁ7B&∆ˆ6∂VB“"Ê∆∆˜vVC∞¢'G2ÁW6ÇÄ¢∆Fób6∆73“&∂Ç÷w&˜W#Ê∞¢«7‚6∆73“&∂Ç÷∂WíG∂&∆ˆ6∂VBÚr"7Gñ∆S“&˜6óGì£„3Rr¢rw“#‚G∂∂Wî∆&V«”¬˜7„Ê∞¢«7‚6∆73“&∂Ç÷7Fñˆ‚G∂"Á7Gñ∆W“G∂&∆ˆ6∂VBÚr&∆ˆ6∂VBr¢rw“#‚G∂"Êñ6ˆÁ“G∂"Ê∆&V«”¬˜7„Ê∞¢¬ˆFócÊ ¢ì∞¢“ì∞†¢'G2ÁW6ÇÇs∆Fób6∆73“&∂Ç÷Fób#„¬ˆFóc‚rì∞†¢ÚÚóFV“67&ˆ∆¿¢ñbÜóFV“í∞¢6ˆÁ7B6˜VÁB“ñÁfVÁF˜'ï∂óFV“Ê∂Wï“«¬∞¢'G2ÁW6ÇÄ¢∆Fób6∆73“&∂Ç÷w&˜W#Ê∞¢«7‚6∆73“&∂Ç÷∂Wí#‚√¬˜7„„«7‚6∆73“&∂Ç÷∆&V¬#‚¬˜7„Ê∞¢«7‚6∆73“&∂Ç÷óFV“#‚G∂óFV“Êñ6ˆÁ“G∂óFV“Ê∆&V«“9rG∂6˜VÁG”¬˜7„Ê∞¢«7‚6∆73“&∂Ç÷∆&V¬#‚¬˜7„„«7‚6∆73“&∂Ç÷∂Wí#‚„¬˜7„Ê∞¢¬ˆFócÊ ¢ì∞¢–†¢'G2ÁW6ÇÇs∆Fób6∆73“&∂Ç÷Fób#„¬ˆFóc‚rì∞†¢ÚÚFñ∆RñÊf¢6ˆÁ7BFñ∆U7Gñ∆R“Fñ∆U7Gñ∆W5∑Fñ∆RÁGóU“«¬Fñ∆U7Gñ∆W2Êw&73∞¢6ˆÁ7BvFW%7B“÷FÇÁ&˜VÊBÇáFñ∆RÁvFW"Ú‘ÖıtDU"í¢ì∞¢'G2ÁW6ÇÄ¢∆Fób6∆73“&∂Ç÷w&˜W#Ê∞¢«7‚6∆73“&∂Ç÷∆&V¬#‚G∑Fñ∆U7Gñ∆RÊ∆&V«÷∞¢Üˆ&¢Ú+rG∂ˆ&¢Ê∆&V«÷¢rrí∞¢+r	˘*rG∑vFW%7G“S¬˜7„Ê∞¢¬ˆFócÊ ¢ì∞†¢'G2ÁW6ÇÇs∆Fób6∆73“&∂Ç÷Fób#„¬ˆFóc‚rì∞¢'G2ÁW6ÇÇs∆Fób6∆73“&∂Ç÷w&˜W#„«7‚6∆73“&∂Ç÷∂Wí#‰W63¬˜7„„«7‚6∆73“&∂Ç÷∆&V¬#‰÷VÁS¬˜7„„¬ˆFóc‚rì∞†¢∂WîáVDV¬ÊñÊÊW$ÖD‘¬“'G2Ê¶ˆñ‚Çrrì∞¢–†¢gVÊ7Fñˆ‚6ˆÁFWáGVƒ7Fñˆ‰∆&V¬Ü7Fñˆ‚¬Fñ∆Rí∞¢ñbÜ7Fñˆ‚””“vFñrrí&WGW&‚Fñ∆RÁGóR””“Fñ∆UGóRÂE$T‰4ÇÚu&VFñrr¢tFñrs∞¢ñbÜ7Fñˆ‚””“vfñ∆¬rí&WGW&‚tfñ∆¬s∞¢ñbÜ7Fñˆ‚””“w&ó6Rrí&WGW&‚Fñ∆RÁGóR””“Fñ∆UGóRÂ$ï4TBÚt∆˜vW"r¢u&ó6Rs∞¢ñbÜ7Fñˆ‚””“wFñ∆¬rí&WGW&‚Fñ∆RÁGóR””“Fñ∆UGóRÂDîƒƒTBÚuVÁFñ∆¬r¢uFñ∆¬s∞¢ñbÜ7Fñˆ‚””“w6÷ˆ˜FÇrí&WGW&‚u6÷ˆ˜FÇs∞¢ñbÜ7Fñˆ‚””“v7WBrí&WGW&‚t7WBs∞¢ñbÜ7Fñˆ‚””“w6∆6Çrí&WGW&‚u6∆6Ç<9rs∞¢ñbÜ7Fñˆ‚””“v6Ü˜rí&WGW&‚t6Ü˜s∞¢ñbÜ7Fñˆ‚””“vÜ6≤rí&WGW&‚tÜ6≤<9rs∞¢ñbÜ7Fñˆ‚””“v÷ñÊRrí&WGW&‚t÷ñÊRs∞¢ñbÜ7Fñˆ‚””“vÜ'fW7Brí&WGW&‚Fñ∆RÊ7&˜&VGíÚ~)…2Ü'fW7Br¢tw&˜vñÊrs∞¢ñbÜ7Fñˆ‚””“vfó6Çrí&WGW&‚tfó6Çs∞¢ñbÜ7Fñˆ‚Á7F'G5vóFÇÇw∆6UÚríí&WGW&‚u∆6Rs∞¢ñbÜ7Fñˆ‚Á7F'G5vóFÇÇvˆ&•˜&ˆ6W75Úríí&WGW&‚u&ˆ6W72s∞¢&WGW&‚7Fñˆ„∞¢–†¢ÚÚ)H)HóFV“67&ˆ∆¬)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢gVÊ7Fñˆ‚&Vg&W6ÑóFV’67&ˆ∆¬Çí∞¢6ˆÁ7B7F6∑2“vWDñÁfVÁF˜'ï7F6¥óFV◊2Çì∞¢6ˆÁ7B‚“7F6∑2Ê∆VÊwFÉ∞¢6ˆÁ7Bî'F‰V¬“Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÇvóFV‘'F‚rì∞¢ñbÜ‚””“í∞¢óFV‘ñ6ˆ‚ÁFWáD6ˆÁFVÁB“~)js∞¢óFV‘Ê÷RÁFWáD6ˆÁFVÁB“tT’Eís∞¢óFV‘6˜VÁBÁFWáD6ˆÁFVÁB“|9ss∞¢óFV‘6˜VÁBÊ6∆74Ê÷R“vó2÷6˜VÁBV◊Gís∞¢ñbÜî'F‰V¬íî'F‰V¬ÁFWáD6ˆÁFVÁB“~)js∞¢6ˆÁ7B&WdV¬“Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÇvó5&Wdñ6ˆ‚rì∞¢6ˆÁ7BÊWáDV¬“Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÇvó4ÊWáDñ6ˆ‚rì∞¢ñbá&WdV¬í&WdV¬ÁFWáD6ˆÁFVÁB“~)js∞¢ñbÜÊWáDV¬íÊWáDV¬ÁFWáD6ˆÁFVÁB“~)js∞¢&WGW&„∞¢–¢ñbÜ7FófTóFV‘ñÊFWÇ„“‚í7FófTóFV‘ñÊFWÇ“∞¢ñbÜ7FófTóFV‘ñÊFWÇ¬í7FófTóFV‘ñÊFWÇ“‚“∞¢6ˆÁ7B7W'"“7F6∑5∂7FófTóFV‘ñÊFWÖ”∞¢6ˆÁ7B&Wb“7F6∑5≤Ü7FófTóFV‘ñÊFWÇ“≤‚íRÂ”∞¢6ˆÁ7BÊWáB“7F6∑5≤Ü7FófTóFV‘ñÊFWÇ≤íRÂ”∞¢6ˆÁ7B6˜VÁB“ñÁfVÁF˜'ï∂7W'"Ê∂Wï“«¬∞¢ÚÚ7W'&VÁBóFV–¢óFV‘ñ6ˆ‚ÁFWáD6ˆÁFVÁB“7W'"Êñ6ˆ„∞¢óFV‘Ê÷RÁFWáD6ˆÁFVÁB“7W'"Ê∆&V√∞¢ñbÜî'F‰V¬íî'F‰V¬ÁFWáD6ˆÁFVÁB“7W'"Êñ6ˆ„∞¢óFV‘6˜VÁBÁFWáD6ˆÁFVÁB“9rG∂6˜VÁG÷∞¢óFV‘6˜VÁBÊ6∆74Ê÷R“vó2÷6˜VÁBr≤Ü6˜VÁB””“ÚrV◊Gír¢rrì∞¢ÚÚVV≤ñ6ˆÁ2á&WbˆÊWáB&WfñWw2ê¢6ˆÁ7B&WdV¬“Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÇvó5&Wdñ6ˆ‚rì∞¢6ˆÁ7BÊWáDV¬“Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÇvó4ÊWáDñ6ˆ‚rì∞¢ñbá&WdV¬í&WdV¬ÁFWáD6ˆÁFVÁB“&WbÊñ6ˆ„∞¢ñbÜÊWáDV¬íÊWáDV¬ÁFWáD6ˆÁFVÁB“ÊWáBÊñ6ˆ„∞¢–¢óFV’&WbÊFDWfVÁD∆ó7FVÊW"Çv6∆ñ6≤r¬Çí”‚∞¢7ñ6∆T7FófTñÁfVÁF˜'îóFV“Ç”ì∞¢&Vg&W6ÑóFV’67&ˆ∆¬Çì∞¢&Vg&W6Ñ7Fñˆ‰&"Çì∞¢“ì∞¢óFV‘ÊWáBÊFDWfVÁD∆ó7FVÊW"Çv6∆ñ6≤r¬Çí”‚∞¢7ñ6∆T7FófTñÁfVÁF˜'îóFV“Éì∞¢&Vg&W6ÑóFV’67&ˆ∆¬Çì∞¢&Vg&W6Ñ7Fñˆ‰&"Çì∞¢“ì∞†¢gVÊ7Fñˆ‚WFFTáVBÇí∞¢6ˆÁ7B6V6ˆ‚“vñÊF˜r‰6∆VÊF%7ó7FV“Ê7W'&VÁE6V6ˆ‚Çì∞¢6ˆÁ7B6∆ˆ6≤“f˜&÷D6∆ˆ6≤ávñÊF˜r‰6∆VÊF%7ó7FV“ÊvWDÜ˜W"Çíì∞†¢ÚÚ6V6ˆ‚Ü6ÜÊvW26∆˜v«íê¢76V6ˆ‚ÁFWáD6ˆÁFVÁB“6V6ˆ‚ÊV÷ˆ¶í≤rr≤6V6ˆ‚ÊÊ÷S∞†¢ÚÚ7W'&VÁBvVFÜW"≤&V6óóFFñˆ‚&FP¢∆WBvVFÜW%FWáB¬&V6óFWáC∞¢ñbÜ6∆VÊF"Êó5&ñÊñÊrí∞¢6ˆÁ7B7G"“6∆VÊF"Á&ñÂ7G&VÊwFÉ∞¢ñbá7G"„“2í∞¢vVFÜW%FWáB“~)∏é˚àÚ7F˜&“s∞¢&V6óFWáB“~*»~˚àÚÜVgís∞¢“V«6R∞¢vVFÜW%FWáB“	¯ ~˚àÚ&ñ‚s∞¢ÚÚ$îÂı$DR¢7G"¢Fñ6∑2ˆá"(òÇ÷“WVóf∆VÁBFó7∆ê¢6ˆÁ7B÷‘W“Ö$îÂı$DR¢7G"¢SíÁFÙfóÜVBÉì≤ÚÚ„SFñ6∑2ˆá"B„w2˜Fñ6∞¢&V6óFWáB“*»~˚àÚG∂÷‘W÷÷“ˆá&∞¢–¢“V«6R∞¢vVFÜW%FWáB“6∆VÊF"ÁvVFÜW"””“v6∆V"rÚ~)à˚àÚ6∆V"r¢	¯ N˚àÚG'ís∞¢&V6óFWáB“~*»~˚àÚÊˆÊRs∞¢–¢7vVFÜW"ÁFWáD6ˆÁFVÁB“vVFÜW%FWáB≤rr≤&V6óFWáC∞†¢7Fñ÷RÁFWáD6ˆÁFVÁB“6∆ˆ6≥∞¢ñbá7Fíí7FíÁFWáD6ˆÁFVÁB“vñÊF˜r‰6∆VÊF%7ó7FV“Êf˜&÷D6∆VÊF$FFRÇì∞¢7Fˆˆ¬ÁFWáD6ˆÁFVÁB“FˆˆƒV÷ˆ¶íÜ7FófUFˆˆ¬í≤rr≤7Fñˆ‰Ê÷RÜ7FófT7Fñˆ‚ì∞†¢ÚÚ&WFñ6∆RFñ∆RñÊf¢6ˆÁ7B&WFñ6∆R“vWE&WFñ6∆UFñ∆RÇì∞¢6ˆÁ7BFñ∆R“vWD7FófUFñ∆TBá&WFñ6∆RÊ6ˆ¬¬&WFñ6∆RÁ&˜rì∞¢6ˆÁ7BE7Gñ∆R“Fñ∆U7Gñ∆W5∑Fñ∆RÁGóU“«¬Fñ∆U7Gñ∆W2Êw&73∞¢6ˆÁ7B7&˜7G"“Fñ∆RÊ7&˜Ú+rG∑Fñ∆RÊ7&˜“G∑Fñ∆RÊ7&˜&VGíÚr)…2r¢rw÷¢rs∞¢7Fñ∆RÁFWáD6ˆÁFVÁB“Ü7W'&VÁD&V””“vñÁFW&ñ˜"rÚ	¯˙r¢rrí≤E7Gñ∆RÊ∆&V¬≤7&˜7G#∞†¢6ˆÁ7BvFW%7B“÷FÇÁ&˜VÊBÇáFñ∆RÁvFW"Ú‘ÖıtDU"í¢ì∞¢6ˆÁ7BFWFÖ7G"“Fñ∆RÁvFW"‚„ÚG∑vFW%7G“V¢vG'ís∞¢7vFW"ÁFWáD6ˆÁFVÁB“	˘*rr≤FWFÖ7G#∞¢7vFW"Á7Gñ∆RÊ6ˆ∆˜"“vFW%7B‚ÉÚr3CCÉÜfbp¢¢vFW%7B‚CÚr3fV3fcp¢¢vFW%7B‚Úr6FFVRr¢r3ÉÉÇs∞¢ñbá7vˆ∆Bí7vˆ∆BÁFWáD6ˆÁFVÁB“	˘+r≤ñÁfVÁF˜'íÊvˆ∆B≤vrs∞†¢ÚÚFW6∑F˜¢6Ü˜r7FófRóFV“ñ‚7FGW2ñ∆¬ÜóFV“67&ˆ∆¬ó2ÜñFFV‚ê¢ñbÜó4FW6∑F˜í∞¢6ˆÁ7BóFV““vWD7FófTñÁfVÁF˜'îóFV“Çì∞¢6ˆÁ7B7óFV““Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÇw7óFV“rì∞¢6ˆÁ7B7óFV‘Fób“Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÇw7óFV‘Fóbrì∞¢ñbá7óFV“bbóFV“í∞¢7óFV“Á7Gñ∆RÊFó7∆í“rs∞¢7óFV‘FóbÁ7Gñ∆RÊFó7∆í“rs∞¢7óFV“ÁFWáD6ˆÁFVÁB“uµF%“r≤óFV“Êñ6ˆ‚≤rr≤óFV“Ê∆&V¬≤r9rr≤ÜñÁfVÁF˜'ï∂óFV“Ê∂Wï“«¬ì∞¢–¢–†¢&Vg&W6ÑóFV’67&ˆ∆¬Çì∞¢ÚÚ&Vg&W6Ñ7Fñˆ‰&"ó26∆∆VBgFW"7FñˆÁ2ÊBˆ‚Fˆˆ¬ˆóFV“6ÜÊvS∞¢ÚÚFÜRFó'Gí÷∂Wí6ÜV6≤÷∂W2óB6ÜVFÚ6∆¬ÜW&RFˆÚf˜"&WFñ6∆RWFFW0¢&Vg&W6Ñ7Fñˆ‰&"Çì∞¢ñbÜ÷VÁT˜V‚í∞¢ÚÚ∂VWv∆∆WBFó7∆í∆ófRvÜñ∆R÷VÁRó2˜V‡¢6ˆÁ7BvB“Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÇvñÁev∆∆WDFó7∆írì∞¢ñbávBívBÁFWáD6ˆÁFVÁB“ÜñÁfVÁF˜'íÊvˆ∆B«¬í≤vrs∞¢–¢–†¢gVÊ7Fñˆ‚WFFT÷VÁT6ˆÁFVÁBÇí≤Ú¢&W∆6VB'í'Vñ∆DñÁfVÁF˜'îw&ñBÇí¢Ú–†¢gVÊ7Fñˆ‚WFFTFV'VuvRÇí≤Ú¢FV'VrÊV¬&V÷˜fVBg&ˆ“÷VÁR¢Ú–†¢gVÊ7Fñˆ‚FˆˆƒV÷ˆ¶íáFˆˆ¬í∞¢6ˆÁ7BWVóVB“WVó÷VÁE6∆˜G5∑Fˆˆ≈”∞¢ñbÜWVóVBbbDÙÙ≈ÙïDT’ÙDTe5∂WVóVE“í&WGW&‚DÙÙ≈ÙïDT’ÙDTe5∂WVóVE“Êñ6ˆ„∞¢&WGW&‚≤6Ü˜fV√¢~)∏˛˚àÚr¬ÜˆS¢	˙©2r¬ÜS¢	˙©2r¬ñ6≥¢~)∏˛˚àÚr¬Ü'ˆˆ„¢	¯Í2r¬vVˆ„¢	˘z˚àÚr¬÷6ÜWFS¢	˘z˚àÚr¬6VVG3¢	¯Àr’∑Fˆˆ≈“«¬~)ŸBs∞¢–†¢gVÊ7Fñˆ‚ÊWáE&ñÂFWáBÇí∞¢ñbÇ6∆VÊF"ÊÊWáE&ñÂvñÊF˜w2Ê∆VÊwFÇí&WGW&‚tÊÚ&ñ‚66ÜVGV∆VBFˆFís∞¢6ˆÁ7BÜ˜W"“vñÊF˜r‰6∆VÊF%7ó7FV“ÊvWDÜ˜W"Çì∞¢6ˆÁ7BÊWáB“6∆VÊF"ÊÊWáE&ñÂvñÊF˜w2ÊfñÊBÇávñÊF˜rí”‚Ü˜W"¬vñÊF˜rÊVÊBì∞¢ñbÇÊWáBí&WGW&‚u&ñ‚Ü276VBf˜"FˆFís∞¢&WGW&‚ÊWáBf∆˜rG∂f˜&÷D6∆ˆ6≤ÜÊWáBÁ7F'Bó““G∂f˜&÷D6∆ˆ6≤ÜÊWáBÊVÊBó÷∞¢–†¢gVÊ7Fñˆ‚f˜&÷D6∆ˆ6≤ÜÜ˜W%f«VRí∞¢6ˆÁ7BÜ˜W"“÷FÇÊf∆ˆ˜"ÜÜ˜W%f«VRì∞¢6ˆÁ7B÷ñÁWFR“÷FÇÊf∆ˆ˜"ÇÜÜ˜W%f«VR“Ü˜W"í¢cÚí¢∞¢6ˆÁ7B7VffóÇ“Ü˜W"„“"Úu“r¢t“s∞¢6ˆÁ7BFó7∆îÜ˜W"“ÇÜÜ˜W"≤íR"í≤∞¢&WGW&‚G∂Fó7∆îÜ˜W'”¢Gµ7G&ñÊrÜ÷ñÁWFRíÁE7F'BÉ"¬sró“G∑7Vffóá÷∞¢–†¢gVÊ7Fñˆ‚7Fñˆ‰V÷ˆ¶íÜ7Fñˆ‚í∞¢&WGW&‚7Fñˆ‰∆&V«5∂7FñˆÂ”ÚÂ≥“«¬~)ŸBs∞¢–†¢gVÊ7Fñˆ‚7Fñˆ‰Ê÷RÜ7Fñˆ‚í∞¢ñbÜ7Fñˆ‚Á7F'G5vóFÇÇw∆6UÚríí&WGW&‚u∆6Rs∞¢ñbÜ7Fñˆ‚Á7F'G5vóFÇÇvˆ&•˜&ˆ6W75Úríí&WGW&‚u&ˆ6W72s∞¢&WGW&‚7Fñˆ‰∆&V«5∂7FñˆÂ”ÚÂ≥“«¬7Fñˆ„∞¢–†¢gVÊ7Fñˆ‚FˆˆƒÊ÷RáFˆˆ¬í∞¢6ˆÁ7BWVóVB“WVó÷VÁE6∆˜G5∑Fˆˆ≈”∞¢6ˆÁ7BFVb“WVóVBÚDÙÙ≈ÙïDT’ÙDTe5∂WVóVE“¢ÁV∆√∞¢ñbÜFVbí&WGW&‚G∂FVbÊñ6ˆÁ“G∂FVbÊ∆&V«÷∞¢&WGW&‚≤6Ü˜fV√¢~)∏˛˚àÚ6Ü˜fV¬r¬ÜˆS¢	˙©2ÜˆRr¬ÜS¢	˙©2ÜRr¬ñ6≥¢~)∏˛˚àÚñ6≤r¬Ü'ˆˆ„¢	¯Í2Ü'ˆˆ‚r¬vVˆ„¢	˘z˚àÚvVˆ‚r¬÷6ÜWFS¢	˘z˚àÚvVˆ‚r¬6VVG3¢	¯À6VVG2r’∑Fˆˆ≈“«¬Fˆˆ√∞¢–†¢gVÊ7Fñˆ‚6VVFVE&ÊFˆ“á6VVBí∞¢6ˆÁ7BÇ“÷FÇÁ6ñ‚á6VVBí¢∞¢&WGW&‚Ç“÷FÇÊf∆ˆ˜"áÇì∞¢–†¢gVÊ7Fñˆ‚ÜÊF∆T¶˜ó7Fñ6µˆñÁFW$F˜v‚ÜWfVÁBí∞¢ñÁWBÊ¶˜ó7Fñ6µˆñÁFW$ñB“WfVÁBÁˆñÁFW$ñC∞¢ÚÚ6WEˆñÁFW$6GW&R6‚Fá&˜rÇ$ÊÚ7FófRˆñÁFW"vóFÇFÜRvófV‚ñ@¢ÚÚó2f˜VÊB"íñbFÜR'&˜w6W"FˆW6‚wB6ˆÁ6ñFW"FÜó2ˆñÁFW"gV∆«ê¢ÚÚ7FófRñWB(	B6VV‚ñ‚&7Fñ6Rˆ‚F˜V6ÇFÜB7F'G2vÜñ∆RFÜP¢ÚÚvRˆ∆ñ˜WBó27Fñ∆¬6WGF∆ñÊr&ñváBgFW"∆ˆB‚VÊ6VváB¬FÜ@¢ÚÚWÜ6WFñˆ‚W6VBFÚ&˜'BFÜó2gVÊ7Fñˆ‚&Vf˜&RWFFT¶˜ó7Fñ6≤Çê¢ÚÚ&‚¬W&÷ÊVÁF«í7G&ÊFñÊr¶˜ó7Fñ6µˆñÁFW$ñBˆñÁFVBBˆñÁFW ¢ÚÚFÜBv˜V∆BÊWfW"vWB÷F6ÜñÊrˆñÁFW'W(	BWfW'í&V¬F˜V6Ä¢ÚÚgFW"FÜBv˜B6ñ∆VÁF«íñvÊ˜&VBÜñÁWBÊ¶˜ó7Fñ6µˆñÁFW$ñB”–¢ÚÚWfVÁBÁˆñÁFW$ñBñ‚ÜÊF∆T¶˜ó7Fñ6µˆñÁFW$÷˜fRıWíVÁFñ¬gV∆¿¢ÚÚvR&V∆ˆB&W6WBFÜR7FFR‚vóFÜ˜WB6GW&RFÜR¶˜ó7Fñ6≤7Fñ∆¿¢ÚÚv˜&∑2Ê˜&÷∆«ì≤FÜRˆÊ«í∆˜72ó2FÜBG&rvÜñ6Ç∆VfW0¢ÚÚ¶˜ó7Fñ6µ¶ˆÊRw2˜v‚DÙ“&˜VÊG27F˜2&VñÊrG&6∂VB‡¢G'í≤¶˜ó7Fñ6µ¶ˆÊRÁ6WEˆñÁFW$6GW&RÜWfVÁBÁˆñÁFW$ñBì≤“6F6ÇÜRí≤Ú¢6VR&˜fR(	BFVw&FRw&6VgV∆«í¬Fˆ‚wB6∂óWFFT¶˜ó7Fñ6≤¢Ú–¢WFFT¶˜ó7Fñ6≤ÜWfVÁBì∞¢–†¢gVÊ7Fñˆ‚ÜÊF∆T¶˜ó7Fñ6µˆñÁFW$÷˜fRÜWfVÁBí∞¢ñbÜñÁWBÊ¶˜ó7Fñ6µˆñÁFW$ñB”“WfVÁBÁˆñÁFW$ñBí&WGW&„∞¢WFFT¶˜ó7Fñ6≤ÜWfVÁBì∞¢–†¢gVÊ7Fñˆ‚ÜÊF∆T¶˜ó7Fñ6µˆñÁFW%WÜWfVÁBí∞¢ñbÜñÁWBÊ¶˜ó7Fñ6µˆñÁFW$ñB”“WfVÁBÁˆñÁFW$ñBí&WGW&„∞¢ñÁWBÊ¶˜ó7Fñ6µˆñÁFW$ñB“ÁV∆√∞¢ñÁWBÁÇ“∞¢ñÁWBÁí“∞¢¶˜ó7Fñ6¥∂Êˆ"Á7Gñ∆RÁG&Á6f˜&““wG&Á6∆FRÇ”SR¬”SRíG&Á6∆FRÉÇ¬Çís∞¢–†¢gVÊ7Fñˆ‚WFFT¶˜ó7Fñ6≤ÜWfVÁBí∞¢6ˆÁ7B&V7B“¶˜ó7Fñ6µ¶ˆÊRÊvWD&˜VÊFñÊt6∆ñVÁE&V7BÇì∞¢6ˆÁ7B6VÁFW%Ç“&V7BÊ∆VgB≤&V7BÁvñGFÇÚ#∞¢6ˆÁ7B6VÁFW%í“&V7BÁF˜≤&V7BÊÜVñváBÚ#∞¢6ˆÁ7B&uÇ“WfVÁBÊ6∆ñVÁEÇ“6VÁFW%É∞¢6ˆÁ7B&uí“WfVÁBÊ6∆ñVÁEí“6VÁFW%ì∞¢6ˆÁ7BFó7FÊ6R“÷FÇÊáó˜Bá&uÇ¬&uíì∞¢6ˆÁ7B7FófU&FóW2“÷FÇÊ÷ÇÉ3"¬÷FÇÊ÷ñ‚Ñ§ıï5Dî4µı$DïU2¬&V7BÁvñGFÇ¢„C"íì≤ÚÚW6VB&V∆˜rFÚ6∆◊∂Êˆ"G&fV¬f˜"FÜR7W'&VÁB67&VV‚◊6ó¶VB¶˜ó7Fñ6≤‡¢6ˆÁ7BÊv∆R“÷FÇÊF„"á&uí¬&uÇì∞¢6ˆÁ7B6∆◊VB“÷FÇÊ÷ñ‚ÜFó7FÊ6R¬7FófU&FóW2ì∞¢6ˆÁ7B&t÷vÊóGVFR“6∆◊Ü6∆◊VBÚ7FófU&FóW2¬¬ì∞¢6ˆÁ7B&V÷VB“&t÷vÊóGVFR√“§ıï5Dî4µÙDTE§Ù‰P¢Ú ¢¢÷FÇÁ˜rÇá&t÷vÊóGVFR“§ıï5Dî4µÙDTE§Ù‰RíÚÉ“§ıï5Dî4µÙDTE§Ù‰Rí¬§ıï5Dî4µı$U5ÙÂ4Rì∞¢6ˆÁ7B∂Êˆ%Ç“÷FÇÊ6˜2ÜÊv∆Rí¢6∆◊VC∞¢6ˆÁ7B∂Êˆ%í“÷FÇÁ6ñ‚ÜÊv∆Rí¢6∆◊VC∞†¢ñÁWBÁÇ“&V÷VB‚Ú÷FÇÊ6˜2ÜÊv∆Rí¢&V÷VB¢∞¢ñÁWBÁí“&V÷VB‚Ú÷FÇÁ6ñ‚ÜÊv∆Rí¢&V÷VB¢∞¢¶˜ó7Fñ6¥∂Êˆ"Á7Gñ∆RÁG&Á6f˜&““G&Á6∆FRÇ”SR¬”SRíG&Á6∆FRÇG∂∂Êˆ%á◊Ç¬G∂∂Êˆ%ó◊Çñ∞¢–†¢7ñÊ2gVÊ7Fñˆ‚6˜îFV'Vt∆ˆrÇí∞¢6ˆÁ7B&WFñ6∆R“vWE&WFñ6∆UFñ∆RÇì∞¢6ˆÁ7Bfñ«FW"“vñÊF˜rÂıˆFV'Vt∆ˆtfñ«FW"«¬v∆¬s∞¢6ˆÁ7B&t∆ˆr“vñÊF˜rÂıˆf&‘FV'Vt∆ˆr«¬µ”∞¢6ˆÁ7Bfñ«FW&VD∆ˆr“vñÊF˜rÂıˆFV'Vt∆ˆt÷F6ÜW4fñ«FW ¢Ú&t∆ˆrÊfñ«FW"ÜR”‚vñÊF˜rÂıˆFV'Vt∆ˆt÷F6ÜW4fñ«FW"ÜR¬fñ«FW"íê¢¢&t∆ˆs∞¢6ˆÁ7B∆ñÊW2“∞¢uG&˜ñ6¬G&VÊ6Çf&“FV'Vr&W˜'Br¿¢‚‚‚Üfñ«FW"”“v∆¬rÚ∂FV'Vrfñ«FW#¢G∂fñ«FW'“ÇG∂fñ«FW&VD∆ˆrÊ∆VÊwFá“ÚG∑&t∆ˆrÊ∆VÊwFá“VÁG&ñW2ñ“¢µ“í¿¢W6W"vVÁC¢G∂ÊfñvF˜"ÁW6W$vVÁG÷¿¢fñWw˜'C¢G∑vñÊF˜rÊñÊÊW%vñGFá◊ÇG∑vñÊF˜rÊñÊÊW$ÜVñváG÷¿¢Tí&V7C¢G∂vWD6ˆ◊WFVE7Gñ∆RÜFˆ7V÷VÁBÊFˆ7V÷VÁDV∆V÷VÁBíÊvWE&˜W'Gïf«VRÇr“÷wrríÁG&ñ“Çó“9rG∂vWD6ˆ◊WFVE7Gñ∆RÜFˆ7V÷VÁBÊFˆ7V÷VÁDV∆V÷VÁBíÊvWE&˜W'Gïf«VRÇr“÷vÇríÁG&ñ“Çó“BG∂vWD6ˆ◊WFVE7Gñ∆RÜFˆ7V÷VÁBÊFˆ7V÷VÁDV∆V÷VÁBíÊvWE&˜W'Gïf«VRÇr“÷˜ÇríÁG&ñ“Çó“¬G∂vWD6ˆ◊WFVE7Gñ∆RÜFˆ7V÷VÁBÊFˆ7V÷VÁDV∆V÷VÁBíÊvWE&˜W'Gïf«VRÇr“÷˜íríÁG&ñ“Çó÷¿¢4B&V7C¢G¥÷FÇÁ&˜VÊBáFá&VT6ˆÁFñÊW"ÊvWD&˜VÊFñÊt6∆ñVÁE&V7BÇíÁvñGFÇó◊ÇG¥÷FÇÁ&˜VÊBáFá&VT6ˆÁFñÊW"ÊvWD&˜VÊFñÊt6∆ñVÁE&V7BÇíÊÜVñváBó÷¿¢¶˜ó7Fñ6≤fñWw˜'BÊ6Ü˜#¢G¥÷FÇÁ&˜VÊBÜ¶˜ó7Fñ6µ¶ˆÊRÊvWD&˜VÊFñÊt6∆ñVÁE&V7BÇíÊ∆VgBó◊Ç∆VgB¬G¥÷FÇÁ&˜VÊBávñÊF˜rÊñÊÊW$ÜVñváB“¶˜ó7Fñ6µ¶ˆÊRÊvWD&˜VÊFñÊt6∆ñVÁE&V7BÇíÊ&˜GFˆ“ó◊Ç&˜GFˆ÷¿¢÷˜fV÷VÁBGVÊñÊs¢7VVC“G¥‘ıdUı5TTG“66V√“G¥44T«“GW&„“GµEU$ÂÙ44T«“FV6V√“G¥DT4T«“FVG¶ˆÊS“G¥§ıï5Dî4µÙDTE§Ù‰W÷¿¢7Fñˆ‚eÉ¢'Fñ6∆W3“G∂7FñˆÂ'Fñ6∆W2Ê∆VÊwFá“Fñ∆Tf∆6ÜW3“G∂7FñˆÂFñ∆TVffV7G2Ê∆VÊwFá“6∆6ÖG&ñ«3“G∑vVˆÂG&ñƒVffV7G2Ê∆VÊwFá÷¿¢6∆VÊF#¢G∑vñÊF˜r‰6∆VÊF%7ó7FV“Êf˜&÷D6∆VÊF$FFRÇó“á&rFíG∂6∆VÊF"ÊFó“í¬G∂f˜&÷D6∆ˆ6≤ávñÊF˜r‰6∆VÊF%7ó7FV“ÊvWDÜ˜W"Çíó“¬G∂6∆VÊF"ÁvVFÜW'÷¿¢Fˆˆ¬ˆ7Fñˆ„¢G∑FˆˆƒÊ÷RÜ7FófUFˆˆ¬ó“ÚG∂7Fñˆ‰Ê÷RÜ7FófT7Fñˆ‚ó÷¿¢∆ñW#¢ÇG∑∆ñW"ÁÇÁFÙfóÜVBÉó“íG∑∆ñW"ÁíÁFÙfóÜVBÉó÷¿¢r“““&r∆ˆr“““r¿¢‚‚Êfñ«FW&VD∆ˆrÊ÷ÜR”‚≤G∂RÁG’“≤G∂RÊ«f«’“G∂RÊ◊6w÷ê¢”∞¢6ˆÁ7BFWáB“∆ñÊW2Ê¶ˆñ‚Çu∆‚rì∞¢G'í∞¢ñbÜÊfñvF˜"Ê6∆ó&ˆ&BbbvñÊF˜rÊó56V7W&T6ˆÁFWáBí∞¢vóBÊfñvF˜"Ê6∆ó&ˆ&BÁw&óFUFWáBáFWáBì∞¢“V«6R∞¢6ˆÁ7B&V“Fˆ7V÷VÁBÊ7&VFTV∆V÷VÁBÇwFWáF&Vrì∞¢&VÁf«VR“FWáC∞¢&VÁ6WDGG&ñ'WFRÇw&VFˆÊ«ír¬rrì∞¢&VÁ7Gñ∆RÊ775FWáB“w˜6óFñˆ„¶fóÜVC∂∆VgC¢”ìììóÇs∞¢Fˆ7V÷VÁBÊ&ˆGíÊVÊD6Üñ∆BÜ&Vì∞¢&VÁ6V∆V7BÇì∞¢Fˆ7V÷VÁBÊWÜV46ˆ÷÷ÊBÇv6˜írì∞¢&VÁ&V÷˜fRÇì∞¢–¢6Ü˜uFˆ7BÇtFV'Vr∆ˆr6˜ñVBFÚ6∆ó&ˆ&B‚r¬G'VRì∞¢FV'Vt∆ˆrÇvFV'Vr∆ˆr6˜ñVBFÚ6∆ó&ˆ&Brì∞¢“6F6ÇÜW'&˜"í∞¢6Ü˜uFˆ7BÇt6˜ífñ∆VB(	B∆ˆrfó6ñ&∆Rñ‚FV'VrF"‚r¬f«6Rì∞¢FV'Vt∆ˆrÜ6˜íFV'Vr∆ˆrfñ∆VC¢G∂W'&˜"Ê÷W76vW÷¬vW'&˜"rì∞¢–¢–†¢gVÊ7Fñˆ‚6∆◊áf«VR¬÷ñ‚¬÷Çí∞¢&WGW&‚÷FÇÊ÷ÇÜ÷ñ‚¬÷FÇÊ÷ñ‚Ü÷Ç¬f«VRíì∞¢–†¢gVÊ7Fñˆ‚&˜VÊE&V7BÜ6ˆÁFWáB¬Ç¬í¬vñGFÇ¬ÜVñváB¬&FóW2í∞¢6ˆÁFWáBÊ&VvñÂFÇÇì∞¢6ˆÁFWáBÊ÷˜fUFÚáÇ≤&FóW2¬íì∞¢6ˆÁFWáBÊ&5FÚáÇ≤vñGFÇ¬í¬Ç≤vñGFÇ¬í≤ÜVñváB¬&FóW2ì∞¢6ˆÁFWáBÊ&5FÚáÇ≤vñGFÇ¬í≤ÜVñváB¬Ç¬í≤ÜVñváB¬&FóW2ì∞¢6ˆÁFWáBÊ&5FÚáÇ¬í≤ÜVñváB¬Ç¬í¬&FóW2ì∞¢6ˆÁFWáBÊ&5FÚáÇ¬í¬Ç≤vñGFÇ¬í¬&FóW2ì∞¢6ˆÁFWáBÊ6∆˜6UFÇÇì∞¢–†¢gVÊ7Fñˆ‚Fı&W6WBÇí∞¢ÚÚvóW2FÜRvÜˆ∆R6Ü&VBf&“ÜFí˜vVFÜW"ˆgW&ÊóGW&RˆÊñ÷«2íÊBFÜó0¢ÚÚ6Ü&7FW"w2˜v‚ñÁfVÁF˜'í&6≤FÚFíˆÊR(	B˜vÊW"÷ˆÊ«í¬6÷R2FÜP¢ÚÚf&“VFóF˜"¬6Úf&÷ÜÊB6‚wBÁV∂RFÜR˜vÊW"w2ˆÊvˆñÊrv˜&≤‡¢ñbÇó4f&‘˜vÊW"Çíí∞¢6Ü˜uFˆ7BÇ$ˆÊ«íFÜRf&“w2˜vÊW"6‚&W6WBFÜRf&“‚"¬f«6Rì∞¢&WGW&„∞¢–¢6∆VÊF"ÊFí“∞¢6∆VÊF"ÁFñ÷S“„3∞¢6∆VÊF"ÁvVFÜW"“w&ñ‚s∞¢6∆VÊF"Êó5&ñÊñÊr“G'VS∞¢6∆VÊF"Á&ñÂ7G&VÊwFÇ“#∞¢6∆VÊF"ÊÊWáE&ñÂvñÊF˜w2“∑≤7F'C¢Ç¬VÊC¢B¬7G&VÊwFÉ¢"’”∞¢6∆VÊF"Ê∆7E&ñ‰Fí“∞¢˜6fUv˜&∆D6∆VÊF"Çì∞¢ˆ&¶V7BÊ∂Wó2ÜñÁfVÁF˜'ííÊf˜$V6ÇÜ∂Wí”‚≤FV∆WFRñÁfVÁF˜'ï∂∂Wï”≤“ì∞¢ˆ&¶V7BÊ76ñv‚ÜñÁfVÁF˜'í¬≤‚‚Â5D%Dî‰uÙîÂdTÂDı%í“ì∞¢6∆V%∆6VE&ˆ6W76ñÊtgW&ÊóGW&RÇì∞¢6∆V$ñÁFW&ñ˜$gW&ÊóGW&RÇì∞¢vñÊF˜r‰f&‘'Vñ∆FñÊw2Ê6∆V$∆¬Çì≤ÚÚ&R÷FFVBg&ˆ“∆ñ˜WB&V∆˜r¬6÷R2gW&ÊóGW&RˆFV6˜"(	BFÜRÜ˜W6Rˆf&“7G'V7GW&W27W'fófR&W6WB¬ˆÊ«íFí˜vVFÜW"ˆñÁfVÁF˜'íˆ∆ófW7Fˆ6≤FÚÊ˜@¢vñÊF˜r‰f&‘Êñ÷«2Ê6∆V$Êñ÷ƒˆ&¶V7G2Çì∞¢˜6fUv˜&∆D∆ófW7Fˆ6≤Öµ“ì≤ÚÚgV∆¬f&“&W6WB«6Ú6∆V'2&V∆V6VBÊñ÷«2g&ˆ“FÜRv˜&∆Bfñ∆P¢6∆V$Ü˜7Fñ∆Tˆ&¶V7G2Çì∞¢FW7v‰6ˆ◊ÊñˆÁ2Çì∞¢v˜&∆Dˆ&¶V7G2Êf˜$V6ÇÜÚ”‚ÚÁ&W6WBbbÚÁ&W6WBÇíì∞¢w&ñB“7&VFTñÊóFñƒw&ñBÇì∞¢≤6ˆÁ7B˜6¬“∆ˆDf&‘∆ñ˜WBÇì≤ñbÖ˜6¬í«îf&‘∆ñ˜WEFÙw&ñBÖ˜6¬ì≤–¢∆ñW"ÁÇ“4Ù≈2¢DîƒR¢„S∞¢∆ñW"Áí“$ıu2¢DîƒR¢„s#∞¢∆ñW"ÊÊv∆R“‘÷FÇÂíÚ#∞¢∆ñW"ÁgÇ“≤∆ñW"Ágí“∞¢∆ñW"ÊÜV«FÇ“∆ñW"Ê÷ÑÜV«FÉ∞¢∆ñW"Á7F÷ñÊ“∆ñW"Ê÷Ö7F÷ñÊ∞¢∆ñW"ÊFˆFvñÊr“f«6S≤∆ñW"ÊFˆFvUB“≤∆ñW"ÊFˆFvT6ˆˆ∆F˜vÂB“≤∆ñW"ÊñÁgV∆ÂVÁFñ¬“∞¢f6ñÊtÊv∆R“‘÷FÇÂíÚ#∞¢∆7D÷˜fTÊv∆R“‘÷FÇÂíÚ#∞¢6&FñÊƒÜˆ∆EFñ÷W"“∞¢7FófTóFV‘ñÊFWÇ“∞¢ÚÚ&W6WBWVó÷VÁBFÚFVfV«G0¢6¥6∆˜FÜñÊr“µ”∞¢ˆ&¶V7BÊ∂Wó2ÜWVó÷VÁE6∆˜G2íÊf˜$V6ÇÜ≤”‚≤WVó÷VÁE6∆˜G5∂µ““ÁV∆√≤“ì∞¢ñbÜvV$ñÁfVÁF˜'ìÚÁFˆˆ«3ÚÊÜˆUˆÊFófT6˜W"íWVó÷VÁE6∆˜G2ÊÜˆR“vÜˆUˆÊFófT6˜W"s∞¢V«6RñbÜvV$ñÁfVÁF˜'ìÚÁFˆˆ«3ÚÊ'&ˆÁ¶VÜˆRíWVó÷VÁE6∆˜G2ÊÜˆR“v'&ˆÁ¶VÜˆRs∞¢ñbÜvV$ñÁfVÁF˜'ìÚÁFˆˆ«3ÚÁñ6∑6Ü˜fV≈ˆÊFófT6˜W"íWVó÷VÁE6∆˜G2Á6Ü˜fV¬“wñ6∑6Ü˜fV≈ˆÊFófT6˜W"s∞¢V«6RñbÜvV$ñÁfVÁF˜'ìÚÁFˆˆ«3ÚÁñ6∑6Ü˜fV¬íWVó÷VÁE6∆˜G2Á6Ü˜fV¬“wñ6∑6Ü˜fV¬s∞¢ñbÜvV$ñÁfVÁF˜'ìÚÁFˆˆ«3ÚÊÜF6ÜWEˆÊFófT6˜W"íWVó÷VÁE6∆˜G2ÁvVˆ‚“vÜF6ÜWEˆÊFófT6˜W"s∞¢V«6RñbÜvV$ñÁfVÁF˜'ìÚÁFˆˆ«3ÚÊÜF6ÜWBíWVó÷VÁE6∆˜G2ÁvVˆ‚“vÜF6ÜWBs∞¢ñbÜvV$ñÁfVÁF˜'ìÚÁvÜó7F∆W3ÚÊ∆VÊwFÇíWVó÷VÁE6∆˜G2ÁvÜó7F∆R“vV$ñÁfVÁF˜'íÁvÜó7F∆W5≥“ÊñC∞¢&V'Vñ∆EFˆˆƒ÷W6ÜW2Çì∞¢&Vg&W6ÖvVˆÂ7vóF6Ñ'F‚Çì∞¢ˆ&¶V7BÁf«VW2áFˆˆƒ÷W6Ñ÷íÊf˜$V6ÇÜ“”‚≤ñbÜ“íFˆˆƒÜˆ∆FW"Á&V÷˜fRÜ“ì≤“ì∞¢ñbáFˆˆƒ÷W6Ñ÷∂7FófUFˆˆ≈“íFˆˆƒÜˆ∆FW"ÊFBáFˆˆƒ÷W6Ñ÷∂7FófUFˆˆ≈“ì∞¢ÚÚ&R÷«í6fVB&ˆ6W76ñÊrgW&ÊóGW&Rg&ˆ“∆ñ˜WBÜ7&FW2∂VWFÜVó"7W'&VÁB˜6óFñˆ‚ê¢G'í∞¢6ˆÁ7B˜&¬“∆ˆDf&‘∆ñ˜WBÇì∞¢ñbÖ˜&¬í∞¢Ö˜&¬ÊgW&ÊóGW&R«¬µ“íÊf˜$V6ÇÇá≤∂Wí¬6ˆ¬¬&˜r¬¶ˆ"“í”‚∞¢ñbÖ$Ù4U54î‰uÙeU$‰ïEU$UÙDTe5∂∂Wï“bb6Â∆6TgW&ÊóGW&TBÜ6ˆ¬¬&˜ríí∞¢6ˆÁ7Bˆ&¢“÷∂U&ˆ6W76ñÊtgW&ÊóGW&RÜ6ˆ¬¬&˜r¬∂Wí¬¶ˆ"ì∞¢ñbÜˆ&¢í≤v˜&∆Dˆ&¶V7G2Á6WBÜ6ˆ¬≤r¬r≤&˜r¬ˆ&¢ì≤&ˆ6W76ñÊtgW&ÊóGW&Tˆ&¶V7G2ÊFBÜˆ&¢ì≤–¢–¢“ì∞¢Ö˜&¬ÊFV6˜"«¬µ“íÊf˜$V6ÇÇá≤ñB¬∂Wí¬6ˆ¬¬&˜r¬&V¬&˜EîFVr¬˜vÊW%ñV6TñB¬∆ˆ6ƒ6ˆ¬¬∆ˆ6≈&˜r“í”‚∞¢6ˆÁ7BFVb“DT4ı$DïdUÙeU$‰ïEU$UÙDTe5∂∂Wï”∞¢ñbÇFVbí&WGW&„∞¢6ˆÁ7BFV6˜$&V“&V«¬vf&“s∞¢6ˆÁ7BFwB“FV6˜$&V””“vñÁFW&ñ˜"rÚñÁFW&ñ˜%66VÊR¢66VÊS∞¢6ˆÁ7B"“÷∂TFV6˜&FófTgW&ÊóGW&T÷W6ÇÜ6ˆ¬¬&˜r¬∂Wí¬FwB¬FV6˜$&V¬&˜EîFVr«¬ì∞¢6ˆÁ7B˜vÊW"“FV6˜$&V””“vñÁFW&ñ˜"rbb˜vÊW%ñV6TñBÚgW&ÊóGW&T˜vÊW$fñV∆G2Ü6ˆ¬¬&˜rí¢∑”∞¢ñbá"íñÁFW&ñ˜$gW&ÊóGW&Tˆ&¶V7G2ÁW6Çá≤ñC¢ñB«¬vFV6˜%Úr≤÷FÇÁ&ÊFˆ“ÇíÁFı7G&ñÊrÉ3bíÁ6∆ñ6RÉ"¬í¬∂Wí¬6ˆ¬¬&˜r¿¢÷W6É¢"Ê÷W6Ç¬∆ñváC¢"Ê∆ñváB¬6gÖ6˜W&6S¢"Á6gÖ6˜W&6R¬&V¢FV6˜$&V¬&˜EîFVs¢&˜EîFVr«¬¿¢˜vÊW%ñV6TñC¢˜vÊW%ñV6TñB«¬˜vÊW"Ê˜vÊW%ñV6TñB¬∆ˆ6ƒ6ˆ√¢ÁV÷&W"Êó4fñÊóFRÜ∆ˆ6ƒ6ˆ¬íÚ∆ˆ6ƒ6ˆ¬¢˜vÊW"Ê∆ˆ6ƒ6ˆ¬¿¢∆ˆ6≈&˜s¢ÁV÷&W"Êó4fñÊóFRÜ∆ˆ6≈&˜ríÚ∆ˆ6≈&˜r¢˜vÊW"Ê∆ˆ6≈&˜r“ì∞¢ñbá"bbFV6˜$&V””“vf&“rbbFVbÁ6óBí∞¢6ˆÁ7B6ó¶R“FV6˜&FófTgW&ÊóGW&U6ó¶RÜ∂Wí¬&˜EîFVr«¬ì∞¢&Vvó7FW%6óEv˜&∆Dˆ&¶V7BÜ∂Wí¬6ˆ¬¬&˜r¬6ó¶RÊgr¬6ó¶RÊfB¬&˜EîFVr«¬ì∞¢–¢ñbá"í&Vvó7FW$6Üó$Á57FFñˆ‚Ü∂Wí¬6ˆ¬¬&˜r¬&˜EîFVr«¬¬Ê˜&÷∆ó¶TÁ4&VÜFV6˜$&Víì∞¢“ì∞¢Ö˜&¬Ê'Vñ∆FñÊw2«¬µ“íÊf˜$V6Çá6fVB”‚∞¢ñbá6fVBÊ∂ñÊB”“v&&‚r«¬$$ÂıDîU%5∑6fVBÁFñW%“í&WGW&„∞¢6ˆÁ7BVÁG'í“≤ñC¢6fVBÊñB¬∂ñÊC¢v&&‚r¬FñW#¢6fVBÁFñW"¬6ˆ√¢6fVBÊ6ˆ¬¬&˜s¢6fVBÁ&˜r¬s¢6fVBÁr«¬vñÊF˜r‰f&‘'Vñ∆FñÊw2‰dÙıE$îÂEır¬É¢6fVBÊÇ«¬vñÊF˜r‰f&‘'Vñ∆FñÊw2‰dÙıE$îÂEÙB¬7FvS¢6fVBÁ7FvR«¬vf˜VÊFFñˆ‚r”∞¢f&‘'Vñ∆FñÊw2ÁW6ÇÜVÁG'íì∞¢vñÊF˜r‰f&‘'Vñ∆FñÊw2Á7v‰VÁG'íÜVÁG'íì∞¢“ì∞¢–¢“6F6Ç∑–¢∆7D7Fñˆ‰÷W76vR“tf&“&W6WB‚7F˜&◊FñFR(	BFñrG&VÊ6ÜW2FÚ&˜WFRFÜRvFW"‚s∞¢6Ü˜uFˆ7BÇtf&“&W6WBFÚ7F˜&◊FñFR‚r¬G'VRì∞¢FV'Vt∆ˆrÇw&˜F˜GóR&W6WBrì∞¢&Vg&W6Ñ7Fñˆ‰&"Çì∞¢&Vg&W6ÑóFV’67&ˆ∆¬Çì∞¢6∆˜6T÷VÁRÇì∞¢–††¢ñbÜ÷VÁU&W6WD'F‚í÷VÁU&W6WD'F‚ÊFDWfVÁD∆ó7FVÊW"Çv6∆ñ6≤r¬Fı&W6WBì∞¢ñbÜ÷VÁUW6T'F‚í÷VÁUW6T'F‚ÊFDWfVÁD∆ó7FVÊW"Çv6∆ñ6≤r¬Çí”‚∞¢W6VB“W6VC∞¢÷VÁUW6T'F‚ÁFWáD6ˆÁFVÁB“W6VBÚ~)kbr¢~(˚Çs∞¢FV'Vt∆ˆráW6VBÚwW6VBr¢w&W7V÷VBrì∞¢“ì∞†¢Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÇvÁ4Fñ∆ˆwVT6ˆÁFñÁVRrìÚÊFDWfVÁD∆ó7FVÊW"Çv6∆ñ6≤r¬Çí”‚≤ñbÜFñ∆ˆwVT˜V‚ívñÊF˜r‰Fñ∆ˆwVT6ˆÁFVÁCÚÊGfÊ6TÁ4Fñ∆ˆwVRÇì≤“ì∞¢Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÇvÁ4Fñ∆ˆwVT∆VfRrìÚÊFDWfVÁD∆ó7FVÊW"Çv6∆ñ6≤r¬Çí”‚≤ñbÜFñ∆ˆwVT˜V‚í6∆˜6TÁ4Fñ∆ˆwVRÇì≤“ì∞†¢¶˜ó7Fñ6µ¶ˆÊRÊFDWfVÁD∆ó7FVÊW"ÇwˆñÁFW&F˜v‚r¬ÜÊF∆T¶˜ó7Fñ6µˆñÁFW$F˜v‚ì∞¢¶˜ó7Fñ6µ¶ˆÊRÊFDWfVÁD∆ó7FVÊW"ÇwˆñÁFW&÷˜fRr¬ÜÊF∆T¶˜ó7Fñ6µˆñÁFW$÷˜fRì∞¢¶˜ó7Fñ6µ¶ˆÊRÊFDWfVÁD∆ó7FVÊW"ÇwˆñÁFW'Wr¬ÜÊF∆T¶˜ó7Fñ6µˆñÁFW%Wì∞¢¶˜ó7Fñ6µ¶ˆÊRÊFDWfVÁD∆ó7FVÊW"ÇwˆñÁFW&6Ê6V¬r¬ÜÊF∆T¶˜ó7Fñ6µˆñÁFW%Wì∞†¢ÚÚFˆFvR'WGFˆ„¢∆ñ‚F¬FˆFvñÊrñ‚FÜR7W'&VÁBf6ñÊrFó&V7Fñˆ‚‡¢ÚÚ«vó2fó6ñ&∆Rˆ‚F˜V6Çá6VR6FˆFvT'F‚ñ‚7Gñ∆RÊ772ì≤ÜñFFV‚ˆÊ«ê¢ÚÚGW&ñÊrfó6ÜñÊr¬6÷R2FÜR˜FÜW"&26ˆÁG&ˆ«2‡¢FˆFvT'F„ÚÊFDWfVÁD∆ó7FVÊW"ÇwˆñÁFW&F˜v‚r¬Wb”‚∞¢WbÁ&WfVÁDFVfV«BÇì∞¢W&f˜&‘6ˆÁFWáD7Fñˆ‚Çì∞¢“ì∞†¢ÚÚvVˆ‚Vñ6≤◊7vóF6Ç'WGFˆ„¢∆ñ‚FFˆvv∆W2ñ‚ˆ˜WBˆbFÜP¢ÚÚvVˆ‚Fˆˆ¬6∆˜Bá6VRFˆvv∆UVñ6µvVˆÂ7vóF6Çí(	BFÜó2ó2Ü˜rñ˜P¢ÚÚvWB¶ñÁFÚ¢6ˆ÷&B7FÊ6RFÚ&Vvñ‚vóFÇ‡¢'FÂvVˆÂ7vóF6ÉÚÊFDWfVÁD∆ó7FVÊW"ÇwˆñÁFW&F˜v‚r¬Wb”‚∞¢WbÁ&WfVÁDFVfV«BÇì∞¢Fˆvv∆UVñ6µvVˆÂ7vóF6ÇÇì∞¢“ì∞†¢ÚÚ÷ˆ&ñ∆R÷ó'&˜"ˆbFÜRb∂WíÚB◊BF˜v‚wFˆvv∆T÷˜VÁBr7Fñˆ‚(	@¢ÚÚÊ7FófRó2∂WBñ‚7ñÊ2vóFÇ&ñFU7FFRñ‚vñÊF˜r‰÷˜VÁG2ÁWFFT÷˜VÁE&ñFR‡¢'F‰6∆ƒ÷˜VÁCÚÊFDWfVÁD∆ó7FVÊW"ÇwˆñÁFW&F˜v‚r¬Wb”‚∞¢WbÁ&WfVÁDFVfV«BÇì∞¢vñÊF˜r‰÷˜VÁG3ÚÁFˆvv∆T÷˜VÁBÇì∞¢“ì∞†¢ÚÚ7vF&vWB'WGFˆ„¢óG2˜v‚FVFñ6FVBG&r÷Fó&V7Fñˆ‚7Fñ6≤á6W&FP¢ÚÚg&ˆ“«î'BÇíw2Fˆˆ¬ˆóFV“÷7Fñˆ‚vó&ñÊr¬vÜñ6ÇÜBóG2G&r◊&WV@¢ÚÚ&VÜfñ˜"Fó6&∆VBí‚W6ÜñÊróBF˜v&BÜ˜7Fñ∆R7v2WFÚ◊F&vWFñÊp¢ÚÚˆÁFÚóB(	Bfó&W2ˆÊ6RW"G&r¬ÊÚ&WVBÊVVFVB6ñÊ6RóBw26ñÊv∆P¢ÚÚ6V∆V7Fñˆ‚¬Ê˜B6ˆÁFñÁV˜W27Fñˆ‚‡¢ñbÜ'FÂ7vF&vWBí∞¢∆WB˜7EDñB“ÁV∆¬¬˜7D7Ç“¬˜7D7í“¬˜7E6ˆ6µ"“¬˜7DG&r“f«6R¬˜7E6ˆ6∂WB“ÁV∆√∞¢6ˆÁ7B5EÙE$uıDÖ$U4Ç“∞¢'FÂ7vF&vWBÊFDWfVÁD∆ó7FVÊW"ÇwˆñÁFW&F˜v‚r¬Wb”‚∞¢ñbÜ'FÂ7vF&vWBÊ6∆74∆ó7BÊ6ˆÁFñÁ2Çv'B÷ÜñFFV‚ríí&WGW&„∞¢WbÁ&WfVÁDFVfV«BÇì∞¢ÚÚ6VRÜÊF∆T¶˜ó7Fñ6µˆñÁFW$F˜v‚w26ˆ÷÷VÁB(	BwV&FVBÜW&RFˆÚ6Ú¢ÚÚ6GW&Rfñ«W&RßW7B∆˜6W2FÜó2ˆÊRF˜V6ÇñÁ7FVBˆbFá&˜vñÊr‡¢G'í≤'FÂ7vF&vWBÁ6WEˆñÁFW$6GW&SÚ‚ÜWbÁˆñÁFW$ñBì≤“6F6ÇÜW'"í≤Ú¢FVw&FRw&6VgV∆«í¢Ú–¢˜7EDñB“WbÁˆñÁFW$ñC∞¢6ˆÁ7B&V7B“'FÂ7vF&vWBÊvWD&˜VÊFñÊt6∆ñVÁE&V7BÇì∞¢˜7D7Ç“&V7BÊ∆VgB≤&V7BÁvñGFÇÚ#∞¢˜7D7í“&V7BÁF˜≤&V7BÊÜVñváBÚ#∞¢˜7E6ˆ6µ"“&V7BÁvñGFÇ¢„SS∞¢˜7DG&r“f«6S∞¢˜7E6ˆ6∂WB“Fˆ7V÷VÁBÊ7&VFTV∆V÷VÁBÇvFóbrì∞¢˜7E6ˆ6∂WBÊ6∆74Ê÷R“v'B◊6ˆ6∂WBs∞¢˜7E6ˆ6∂WBÁ7Gñ∆RÊ∆VgB“˜7D7Ç≤wÇs∞¢˜7E6ˆ6∂WBÁ7Gñ∆RÁF˜“˜7D7í≤wÇs∞¢˜7E6ˆ6∂WBÁ7Gñ∆RÁvñGFÇ“˜7E6ˆ6∂WBÁ7Gñ∆RÊÜVñváB“á&V7BÁvñGFÇ¢"„"í≤wÇs∞¢Fˆ7V÷VÁBÊ&ˆGíÊVÊD6Üñ∆BÖ˜7E6ˆ6∂WBì∞¢'FÂ7vF&vWBÁ7Gñ∆RÁG&Á6óFñˆ‚“vÊˆÊRs∞¢“ì∞¢'FÂ7vF&vWBÊFDWfVÁD∆ó7FVÊW"ÇwˆñÁFW&÷˜fRr¬Wb”‚∞¢ñbÜWbÁˆñÁFW$ñB”“˜7EDñBí&WGW&„∞¢6ˆÁ7BGÇ“WbÊ6∆ñVÁEÇ“˜7D7Ç¬Gí“WbÊ6∆ñVÁEí“˜7D7ì∞¢6ˆÁ7BFó7B“÷FÇÊáó˜BÜGÇ¬Gíì∞¢6ˆÁ7B"“÷FÇÊ÷ñ‚ÜFó7B¬˜7E6ˆ6µ"ì∞¢6ˆÁ7BÁÇ“Fó7B‚„RÚGÇÚFó7B¢"¢∞¢6ˆÁ7BÁí“Fó7B‚„RÚGíÚFó7B¢"¢∞¢'FÂ7vF&vWBÁ7Gñ∆RÁG&Á6f˜&““G&Á6∆FRÜ6∆2ÉSR≤G∂Áá◊Çí¬6∆2ÉSR≤G∂Áó◊Çíñ∞¢ñbÇ˜7DG&rbbFó7B‚5EÙE$uıDÖ$U4Çí∞¢˜7DG&r“G'VS∞¢7vWFıF&vWBÑ÷FÇÊF„"ÜGí¬GÇíì∞¢–¢“ì∞¢gVÊ7Fñˆ‚˜7EWÜWbí∞¢ñbÜWbÁˆñÁFW$ñB”“˜7EDñBí&WGW&„∞¢˜7EDñB“ÁV∆√∞¢ñbÖ˜7E6ˆ6∂WBí≤˜7E6ˆ6∂WBÁ&V÷˜fRÇì≤˜7E6ˆ6∂WB“ÁV∆√≤–¢'FÂ7vF&vWBÁ7Gñ∆RÁG&Á6óFñˆ‚“wG&Á6f˜&“„G2V6R÷˜WBs∞¢'FÂ7vF&vWBÁ7Gñ∆RÁG&Á6f˜&““wG&Á6∆FRÉSR¬SRís∞¢6WEFñ÷V˜WBÇÇí”‚≤'FÂ7vF&vWBÁ7Gñ∆RÁG&Á6óFñˆ‚“rs≤'FÂ7vF&vWBÁ7Gñ∆RÁG&Á6f˜&““rs≤“¬Sì∞¢ñbÇ˜7DG&rí7vWFıF&vWBá∆ñW"ÊÊv∆Rì∞¢˜7DG&r“f«6S∞¢–¢'FÂ7vF&vWBÊFDWfVÁD∆ó7FVÊW"ÇwˆñÁFW'Wr¬˜7EWì∞¢'FÂ7vF&vWBÊFDWfVÁD∆ó7FVÊW"ÇwˆñÁFW&6Ê6V¬r¬˜7EWì∞¢–†¢6ˆÁ7BFW6∑F˜FvñÊF˜t◊2“Çí”‚ÁV÷&W"ÜFW6∑F˜6ˆÁG&ˆ«46ˆÊfñrÇíÁFvñÊF˜t◊2í«¬3S∞¢6ˆÁ7BFW6∑F˜Üˆ∆D∂Wó2“∞¢¢≤F˜v„¢f«6R¬ÜV∆C¢f«6R¬Fñ÷W#¢ÁV∆¬¬&3¢vóFV“r“¿¢S¢≤F˜v„¢f«6R¬ÜV∆C¢f«6R¬Fñ÷W#¢ÁV∆¬¬&3¢wFˆˆ¬r–¢”∞¢gVÊ7Fñˆ‚˜V‰FW6∑F˜Üˆ∆D&2Ü∂Wíí∞¢6ˆÁ7B7FFR“FW6∑F˜Üˆ∆D∂Wó5∂∂Wï”∞¢ñbÇ7FFR«¬7FFRÊF˜v‚í&WGW&„∞¢7FFRÊÜV∆B“G'VS∞¢ñbá7FFRÊ&2””“vóFV“rívñÊF˜rÂˆFW6∑F˜6V∆V7Fñˆ‰&3ÚÊ˜V‰óFV“Çì∞¢V«6RvñÊF˜rÂˆFW6∑F˜6V∆V7Fñˆ‰&3ÚÊ˜VÂFˆˆ¬Çì∞¢–¢gVÊ7Fñˆ‚7F'DFW6∑F˜Üˆ∆D∂WíÜ∂Wí¬WfVÁBí∞¢6ˆÁ7B7FFR“FW6∑F˜Üˆ∆D∂Wó5∂∂Wï”∞¢ñbÇ7FFR«¬7FFRÊF˜v‚«¬WfVÁBÁ&WVBí&WGW&„∞¢7FFRÊF˜v‚“G'VS∞¢7FFRÊÜV∆B“f«6S∞¢7FFRÁFñ÷W"“6WEFñ÷V˜WBÇÇí”‚˜V‰FW6∑F˜Üˆ∆D&2Ü∂Wíí¬FW6∑F˜FvñÊF˜t◊2Çíì∞¢–¢gVÊ7Fñˆ‚fñÊó6ÑFW6∑F˜Üˆ∆D∂WíÜ∂Wíí∞¢6ˆÁ7B7FFR“FW6∑F˜Üˆ∆D∂Wó5∂∂Wï”∞¢ñbÇ7FFR«¬7FFRÊF˜v‚í&WGW&‚f«6S∞¢7FFRÊF˜v‚“f«6S∞¢ñbá7FFRÁFñ÷W"í≤6∆V%Fñ÷V˜WBá7FFRÁFñ÷W"ì≤7FFRÁFñ÷W"“ÁV∆√≤–¢6ˆÁ7Bv4ÜV∆B“7FFRÊÜV∆C∞¢7FFRÊÜV∆B“f«6S∞¢ñbáv4ÜV∆BívñÊF˜rÂˆFW6∑F˜6V∆V7Fñˆ‰&3ÚÊ6∆˜6RÇì∞¢&WGW&‚v4ÜV∆C∞¢–†¢6ˆÁ7BîÂUEÙDTdT≈E2“ÇÇí”‚∞¢6ˆÁ7B6fr“vñÊF˜rÂ45$D4Ñ$Ù‰U5Ù4Ù‰dîsÚÊv÷SÚÊñÁWB«¬∑”∞¢6ˆÁ7B7FñˆÁ2“'&íÊó4'&íÜ6frÊ7FñˆÁ2íÚ6frÊ7FñˆÁ2¢µ”∞¢&WGW&‚∞¢7F˜&vT∂Wì¢6frÁ7F˜&vT∂Wí«¬w67&F6Ü&ˆÊW2ÊñÁWD&ñÊFñÊw2Ácr¿¢FVG¶ˆÊS¢ÁV÷&W"Ü6frÊv÷WDFVG¶ˆÊRí«¬„#B¿¢Üó5&W75Fá&W6Üˆ∆C¢ÁV÷&W"Ü6frÊÜó5&W75Fá&W6Üˆ∆Bí«¬„SR¿¢7FñˆÁ2¿¢FW6∑F˜¢ˆ&¶V7BÊg&ˆ‘VÁG&ñW2Ü7FñˆÁ2Ê÷Ü”‚∂ÊñB¬ÊFW6∑F˜“íÊfñ«FW"ÇÖ≤¬e“í”‚bíí¿¢6ˆÁG&ˆ∆∆W#¢ˆ&¶V7BÊg&ˆ‘VÁG&ñW2Ü7FñˆÁ2Ê÷Ü”‚∂ÊñB¬Ê6ˆÁG&ˆ∆∆W%“íÊfñ«FW"ÇÖ≤¬e“í”‚bíí¿¢÷ˆFU6ÜñgG3¢'&íÊó4'&íÜ6frÊ÷ˆFU6ÜñgG2íÚ6frÊ÷ˆFU6ÜñgG2¢µ–¢”∞¢“íÇì∞¢6ˆÁ7BñÁWD&ñÊFñÊw2“∆ˆDñÁWD&ñÊFñÊw2Çì∞¢6ˆÁ7Bv÷WE7FFR“≤fˆ7W6VC¢Fˆ7V÷VÁBÊÜ4fˆ7W2Çí¬&Wfñ˜W3¢ÊWr6WBÇí¬7FófU6ÜñgC¢ÁV∆¬¬ÜEC¢f«6R”∞¢6ˆÁ7B4ÙÂE$ÙƒƒU%ÙîÂUEÙıDîÙÂ2“∞¢t'WGFˆ„r¬t'WGFˆ„r¬t'WGFˆ„"r¬t'WGFˆ„2r¬t'WGFˆ„Br¬t'WGFˆ„Rr¿¢t∆VgEG&ñvvW"r¬u&ñváEG&ñvvW"r¿¢t'WGFˆ„Çr¬t'WGFˆ„ír¬t'WGFˆ„r¬t'WGFˆ„r¿¢t'WGFˆ„"r¬t'WGFˆ„2r¬t'WGFˆ„Br¬t'WGFˆ„Rr¿¢u&ñváE7Fñ6¥∆VgBr¬u&ñváE7Fñ6µ&ñváBr¬u&ñváE7Fñ6µWr¬u&ñváE7Fñ6¥F˜v‚p¢”∞†¢gVÊ7Fñˆ‚∆ˆDñÁWD&ñÊFñÊw2Çí∞¢G'í∞¢6ˆÁ7B6fVB“•4Ù‚Á'6RÜ∆ˆ6≈7F˜&vRÊvWDóFV“ÑîÂUEÙDTdT≈E2Á7F˜&vT∂Wíí«¬vÁV∆¬rì∞¢&WGW&‚∞¢FW6∑F˜¢≤‚‚‰îÂUEÙDTdT≈E2ÊFW6∑F˜¬‚‚‚á6fVCÚÊFW6∑F˜«¬∑“í“¿¢6ˆÁG&ˆ∆∆W#¢≤‚‚‰îÂUEÙDTdT≈E2Ê6ˆÁG&ˆ∆∆W"¬‚‚‚á6fVCÚÊ6ˆÁG&ˆ∆∆W"«¬∑“í“¿¢÷ˆFU6ÜñgG3¢'&íÊó4'&íá6fVCÚÊ÷ˆFU6ÜñgG2íÚ6fVBÊ÷ˆFU6ÜñgG2¢îÂUEÙDTdT≈E2Ê÷ˆFU6ÜñgG0¢”∞¢“6F6ÇÖˆW'"í∞¢&WGW&‚≤FW6∑F˜¢≤‚‚‰îÂUEÙDTdT≈E2ÊFW6∑F˜“¬6ˆÁG&ˆ∆∆W#¢≤‚‚‰îÂUEÙDTdT≈E2Ê6ˆÁG&ˆ∆∆W"“¬÷ˆFU6ÜñgG3¢îÂUEÙDTdT≈E2Ê÷ˆFU6ÜñgG2”∞¢–¢–¢gVÊ7Fñˆ‚6fTñÁWD&ñÊFñÊw2Çí∞¢∆ˆ6≈7F˜&vRÁ6WDóFV“ÑîÂUEÙDTdT≈E2Á7F˜&vT∂Wí¬•4Ù‚Á7G&ñÊvñgíÜñÁWD&ñÊFñÊw2íì∞¢–¢gVÊ7Fñˆ‚&ñÊFñÊt6ˆÊf∆ñ7BÜFWfñ6R¬'WGFˆ‚¬7Fñˆ‰ñB¬÷ˆFU6ÜñgB“ÁV∆¬í∞¢ñbÇ'WGFˆ‚í&WGW&‚rs∞¢ñbÜ÷ˆFU6ÜñgBbb'WGFˆ‚””“÷ˆFU6ÜñgBÊ'WGFˆ‚í&WGW&‚u6ÜñgFVBñÁWB6ÊÊ˜BW6RóG2ÜV∆B÷ˆFR◊6ÜñgB'WGFˆ‚‚s∞¢6ˆÁ7B&ñÊFñÊw2“ñÁWD&ñÊFñÊw5∂FWfñ6U“«¬∑”∞¢f˜"Ü6ˆÁ7B∂˜FÜW$7Fñˆ‚¬˜FÜW$'WGFˆÂ“ˆbˆ&¶V7BÊVÁG&ñW2Ü&ñÊFñÊw2íí∞¢ñbÜ˜FÜW$7Fñˆ‚”“7Fñˆ‰ñBbb˜FÜW$'WGFˆ‚””“'WGFˆ‚í&WGW&‚«&VGí&˜VÊBFÚG∂7Fñˆ‰∆&V¬Ü˜FÜW$7Fñˆ‚ó“Ê∞¢–¢ñbÇ÷ˆFU6ÜñgBí&WGW&‚rs∞¢f˜"Ü6ˆÁ7B∂˜FÜW$'WGFˆ‚¬˜FÜW$7FñˆÂ“ˆbˆ&¶V7BÊVÁG&ñW2Ü÷ˆFU6ÜñgBÊ&ñÊFñÊw2«¬∑“íí∞¢ñbÜ˜FÜW$7Fñˆ‚””“7Fñˆ‰ñBbb˜FÜW$'WGFˆ‚””“'WGFˆ‚í&WGW&‚«&VGí&˜VÊBFÚG∂7Fñˆ‰∆&V¬Ü7Fñˆ‰ñBó“ñ‚FÜó2÷ˆFR6ÜñgBÊ∞¢–¢&WGW&‚rs∞¢–¢gVÊ7Fñˆ‚7Fñˆ‰∆&V¬ÜñBí∞¢&WGW&‚îÂUEÙDTdT≈E2Ê7FñˆÁ2ÊfñÊBÜ”‚ÊñB””“ñBìÚÊ∆&V¬«¬ñC∞¢–¢gVÊ7Fñˆ‚'WGFˆ‰∆&V¬Ü6ˆFRí∞¢6ˆÁ7B∆&V«2“≤∆VgEG&ñvvW#¢t≈Br¬&ñváEG&ñvvW#¢u%Br¬&ñváE7Fñ6¥∆VgC¢u%2(ir¬&ñváE7Fñ6µ&ñváC¢u%2(i"r¬&ñváE7Fñ6µW¢u%2(ir¬&ñváE7Fñ6¥F˜v„¢u%2(i2r¬vÜVV≈W¢uvÜVV¬(ir¬vÜVVƒF˜v„¢uvÜVV¬(i2r”∞¢&WGW&‚∆&V«5∂6ˆFU“«¬7G&ñÊrÜ6ˆFR«¬uVÊ&˜VÊBríÁ&W∆6RÇı‰∂WíÚ¬rríÁ&W∆6RÇı‰FñvóBÚ¬rríÁ&W∆6RÇı‰'WGFˆ‚Ú¬uBrì∞¢–†¢ÚÚ)H)H∆7B◊W6VBñÁWBFWfñ6RG&6∂ñÊr)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢ÚÚÊ˜FÜñÊrV«6Rñ‚FÜRv÷RG&6∑2'vÜBFWfñ6Ró2FÜR∆ñW"7GV∆«ê¢ÚÚW6ñÊr&ñváBÊ˜r"(	Bó4FW6∑F˜á6VRF˜ˆbfñ∆Ríó2ˆÊR◊Fñ÷P¢ÚÚˆñÁFW#¶fñÊR÷VFñ◊VW'í6ÜV6≤¬Ê˜B&V7FófRFÚ7vóF6ÜñÊr&WGvVV‡¢ÚÚ÷˜W6R¬F˜V6Ç¬ÊB«VvvVB÷ñ‚6ˆÁG&ˆ∆∆W"÷ñB◊6W76ñˆ‚‚G&ófW0¢ÚÚ6Ü˜t7FñˆÂ&ˆ◊B&V∆˜r6ÚóG2'&W72Ç"FWáB÷F6ÜW2vÜFWfW"FÜP¢ÚÚ∆ñW"∆7B7GV∆«í&W76VB¬Ê˜BßW7BFÜVó"FWfñ6R6∆72‡¢∆WB∆7DñÁWDFWfñ6R“ó4FW6∑F˜ÚvFW6∑F˜r¢wF˜V6Çs∞¢vñÊF˜rÊFDWfVÁD∆ó7FVÊW"ÇwˆñÁFW&F˜v‚r¬ÜRí”‚∞¢ñbÜRÁˆñÁFW%GóR””“wF˜V6Çrí∆7DñÁWDFWfñ6R“wF˜V6Çs∞¢V«6RñbÜRÁˆñÁFW%GóR””“v÷˜W6Rr«¬RÁˆñÁFW%GóR””“wV‚rí∆7DñÁWDFWfñ6R“vFW6∑F˜s∞¢“¬≤6GW&S¢G'VR¬76ófS¢G'VR“ì∞¢vñÊF˜rÊFDWfVÁD∆ó7FVÊW"Çv∂WñF˜v‚r¬Çí”‚≤∆7DñÁWDFWfñ6R“vFW6∑F˜s≤“¬≤6GW&S¢G'VR“ì∞¢ÚÚ6ˆÁG&ˆ∆∆W"&W76W2&R÷&∂VBñ‚ˆ∆ƒ6ˆÁG&ˆ∆∆W$ñÁWBÇíóG6V∆bá6VP¢ÚÚ&V∆˜rí¬6ñÊ6RFÜBw2FÜRˆÊ«í∆6R‚7GV¬'WGFˆ‚÷F˜v‚VFvRó0¢ÚÚFWFV7FVB&FÜW"FÜ‚ßW7B6ˆÁFñÁV˜W27Fñ6≤7FFR‡†¢ÚÚ)H)H6ˆÁFWáGV¬&˜GFˆ“÷ˆb◊67&VV‚7Fñˆ‚&ˆ◊B)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢ÚÚvVÊW&ñ2'&W72ÇFÚFÚí"&ˆ◊B6Ü&VB7&˜72FÜRv÷RÜfó6ÜñÊró0¢ÚÚFÜRfó'7B6∆∆W"¬6VR&Vvñ‰fó6ÜñÊt67B˜&VÊFW$fó6ÜñÊt˜fW&∆íí(	@¢ÚÚ&W6ˆ«fW2óG2˜v‚∂Wíˆ'WGFˆ‚ˆñ6ˆ‚∆&V¬g&ˆ“∆7DñÁWDFWfñ6R6¢ÚÚ6∆∆W'2ˆÊ«íWfW"FW67&ñ&RßvÜB¢FÜR7Fñˆ‚FˆW2¬ÊWfW"Ü˜rF¢ÚÚG&ñvvW"óBˆ‚Áí'Fñ7V∆"FWfñ6R‡¢∆WB7FñˆÂ&ˆ◊DV«2“ÁV∆√∞¢gVÊ7Fñˆ‚'Vñ∆D7FñˆÂ&ˆ◊DFˆ“Çí∞¢ñbÜ7FñˆÂ&ˆ◊DV«2í&WGW&„∞¢6ˆÁ7BV¬“Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÇv7FñˆÂ&ˆ◊Brì∞¢ñbÇV¬í&WGW&„∞¢V¬ÊñÊÊW$ÖD‘¬“ ¢∆Fób6∆73“&◊&˜r#‡¢∆'WGFˆ‚6∆73“&÷'F‚"ñC“&'F‚#„¬ˆ'WGFˆ„‡¢∆'WGFˆ‚6∆73“&÷6Ê6V¬"ñC“&6Ê6V¬#„¬ˆ'WGFˆ„‡¢¬ˆFóc‡¢∆Fób6∆73“&◊7FGW2"ñC“&7FGW2#„¬ˆFóc‡¢∆Fób6∆73“&◊Êñ2◊w&"ñC“&Êñ5w&#„∆Fób6∆73“&◊Êñ2÷fñ∆¬"ñC“&Êñ4fñ∆¬#„¬ˆFóc„¬ˆFócÊ∞¢7FñˆÂ&ˆ◊DV«2“∞¢V¬¿¢'F„¢Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÇv'F‚rí¿¢6Ê6V√¢Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÇv6Ê6V¬rí¿¢7FGW3¢Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÇv7FGW2rí¿¢Êñ5w&¢Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÇvÊñ5w&rí¿¢Êñ4fñ∆√¢Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÇvÊñ4fñ∆¬rí¿¢”∞¢–¢ÚÚ&V¬∂Wíˆ'WGFˆ‚∆&V¬ˆ‚FW6∑F˜ˆ6ˆÁG&ˆ∆∆W"¬F∂V‚g&ˆ“FÜP¢ÚÚ∆ñW"w27GV¬7W'&VÁB&ñÊFñÊw2ÜÊ˜BßW7BFÜRFVfV«G2í6Ú¢ÚÚ&V&˜VÊB∂Wí6Ü˜w26˜'&V7F«íÜW&RFˆÚ‚F˜V6ÇÜ2ÊÚ∂WíFÚÊ÷R¬6¢ÚÚ6∆∆W'272FÜR6÷Rñ6ˆ‚«&VGí6Ü˜v‚f˜"FÜB7Fñˆ‚ñ‚FÜP¢ÚÚFˆˆ¬&6Çá6VRRÊr‚FÜRÜ'ˆˆ‚w2	¯Í2f∆∆&6≤ñ‚ˆ˜VÂFˆˆƒ&2í‡¢gVÊ7Fñˆ‚7FñˆÂ&ˆ◊Dv«óÇÜ7Fñˆ‰ñB¬F˜V6Ññ6ˆ‚í∞¢ñbÜ∆7DñÁWDFWfñ6R””“v6ˆÁG&ˆ∆∆W"rí&WGW&‚'WGFˆ‰∆&V¬ÜñÁWD&ñÊFñÊw2Ê6ˆÁG&ˆ∆∆W%∂7Fñˆ‰ñE“ì∞¢ñbÜ∆7DñÁWDFWfñ6R””“wF˜V6Çrí&WGW&‚F˜V6Ññ6ˆ‚«¬	˘bs∞¢&WGW&‚'WGFˆ‰∆&V¬ÜñÁWD&ñÊFñÊw2ÊFW6∑F˜∂7Fñˆ‰ñE“ì∞¢–¢gVÊ7Fñˆ‚6Ü˜t7FñˆÂ&ˆ◊Bá≤7Fñˆ‰ñB¬F˜V6Ññ6ˆ‚¬fW&"¬ˆÂ&W72¬6Ê6V≈FWáB¬ˆ‰6Ê6V¬¬7FGW5FWáB¬7FGW5GóR¬Êñ5W&6VÁB“í∞¢'Vñ∆D7FñˆÂ&ˆ◊DFˆ“Çì∞¢ñbÇ7FñˆÂ&ˆ◊DV«2í&WGW&„∞¢6ˆÁ7Bv«óÇ“7FñˆÂ&ˆ◊Dv«óÇÜ7Fñˆ‰ñB¬F˜V6Ññ6ˆ‚ì∞¢ÚÚñÊÊW$ÖD‘¬¬Ê˜BFWáD6ˆÁFVÁC¢F˜V6Ññ6ˆ‚÷í&R&V¬∆ñ÷s‚Frá6VP¢ÚÚGF6¥7Fñˆ‰ñ6ˆ‰ÖD‘¬ívÜV‚FÜR6∆∆W"vÁG2FÜó2FÚ÷ó'&˜"FÜP¢ÚÚ&2'WGFˆ‚w27GV¬WVóVB◊Fˆˆ¬7&óFRñÁ7FVBˆb∆ñ‚V÷ˆ¶ê¢ÚÚ(	B6∆∆W'2ˆÊ«íWfW"727FFñ2FWfV∆˜W"7G&ñÊw2ÜW&R¬ÊWfW ¢ÚÚVÁG'W7FVBñÁWB¬6ÚFÜó2ó26fR‡¢7FñˆÂ&ˆ◊DV«2Ê'F‚ÊñÊÊW$ÖD‘¬“∆7DñÁWDFWfñ6R””“wF˜V6ÇrÚG∂v«óá“G∑fW&'÷¢≤G∂v«óá’“G∑fW&'÷∞¢7FñˆÂ&ˆ◊DV«2Ê'F‚ÊˆÁˆñÁFW'W“ÜRí”‚≤RÁ7F˜&˜vFñˆ‚Çì≤ˆÂ&W73Ú‚Çì≤”∞¢ñbÜ6Ê6V≈FWáBbbˆ‰6Ê6V¬í∞¢7FñˆÂ&ˆ◊DV«2Ê6Ê6V¬ÁFWáD6ˆÁFVÁB“6Ê6V≈FWáC∞¢7FñˆÂ&ˆ◊DV«2Ê6Ê6V¬Á7Gñ∆RÊFó7∆í“rs∞¢7FñˆÂ&ˆ◊DV«2Ê6Ê6V¬ÊˆÁˆñÁFW'W“ÜRí”‚≤RÁ7F˜&˜vFñˆ‚Çì≤ˆ‰6Ê6V¬Çì≤”∞¢“V«6R∞¢7FñˆÂ&ˆ◊DV«2Ê6Ê6V¬Á7Gñ∆RÊFó7∆í“vÊˆÊRs∞¢7FñˆÂ&ˆ◊DV«2Ê6Ê6V¬ÊˆÁˆñÁFW'W“ÁV∆√∞¢–¢ñbá7FGW5FWáBí∞¢7FñˆÂ&ˆ◊DV«2Á7FGW2ÁFWáD6ˆÁFVÁB“7FGW5FWáC∞¢7FñˆÂ&ˆ◊DV«2Á7FGW2Ê6∆74Ê÷R“v◊7FGW2r≤á7FGW5GóRÚrr≤7FGW5GóR¢rrì∞¢7FñˆÂ&ˆ◊DV«2Á7FGW2Á7Gñ∆RÊFó7∆í“rs∞¢“V«6R∞¢7FñˆÂ&ˆ◊DV«2Á7FGW2Á7Gñ∆RÊFó7∆í“vÊˆÊRs∞¢–¢ñbáÊñ5W&6VÁB“ÁV∆¬í∞¢7FñˆÂ&ˆ◊DV«2ÁÊñ5w&Á7Gñ∆RÊFó7∆í“rs∞¢7FñˆÂ&ˆ◊DV«2ÁÊñ4fñ∆¬Á7Gñ∆RÁvñGFÇ“Êñ5W&6VÁB≤rRs∞¢“V«6R∞¢7FñˆÂ&ˆ◊DV«2ÁÊñ5w&Á7Gñ∆RÊFó7∆í“vÊˆÊRs∞¢–¢7FñˆÂ&ˆ◊DV«2ÊV¬Ê6∆74∆ó7BÊFBÇv˜V‚rì∞¢–¢gVÊ7Fñˆ‚ÜñFT7FñˆÂ&ˆ◊BÇí∞¢ñbÇ7FñˆÂ&ˆ◊DV«2í&WGW&„∞¢7FñˆÂ&ˆ◊DV«2ÊV¬Ê6∆74∆ó7BÁ&V÷˜fRÇv˜V‚rì∞¢7FñˆÂ&ˆ◊DV«2Ê'F‚ÊˆÁˆñÁFW'W“ÁV∆√∞¢7FñˆÂ&ˆ◊DV«2Ê6Ê6V¬ÊˆÁˆñÁFW'W“ÁV∆√∞¢–¢gVÊ7Fñˆ‚'V‰7Fñˆ‰'WGFˆ‰E6∆˜Bá6∆˜DñÊFWÇí∞¢6ˆÁ7B'F‚“6ˆ◊WFT7Fñˆ‰'WGFˆÁ2Çï∑6∆˜DñÊFWÇ“”∞¢ñbÇ'F‚í&WGW&„∞¢7FófT7Fñˆ‚“'F‚Ê7Fñˆ„∞¢7Fñˆ‰ÜV∆DF˜v‚“6∆˜DñÊFWÇ””“∞¢W6T7FófT7Fñˆ‚Çì∞¢–¢gVÊ7Fñˆ‚'V‰ñÁFW&7D7Fñˆ‚Çí∞¢ÚÚWÜ6«VFW2&rFˆˆ¬◊7vñÊr7FñˆÁ2ÜFñr˜Fñ∆¬ˆ6Ü˜ˆWF2(	BFÜ˜6R&V∆ˆÊp¢ÚÚFÚFÜRFˆˆ¬ˆóFV“7Fñˆ‚◊6∆˜B'WGFˆÁ2¬Ê˜BFÜRñÁFW&7B∂Wíˆ'WGFˆ‚í¿¢ÚÚ'WB‰ıB∆ÁEÚ˜∆6UÚˆÜ'fW7C¢FÜ˜6R&R6ˆÁFWáB7FñˆÁ2WÜ7F«ê¢ÚÚ∆ñ∂R&˜V‚FÜó2Fˆ˜""˜"'F∆≤FÚFÜó2Â2"¬ÊB∆ñW"Üˆ∆FñÊp¢ÚÚ6VVB&V6ˆÊ&«íWáV7G2FÜR6÷RñÁFW&7BñÁWBFÜBFˆW0¢ÚÚWfW'óFÜñÊrV«6RFÚ«6Ú∆ÁBóB¬ñÁ7FVBˆbˆÊ«íFÜR6W&FP¢ÚÚ&ñ÷'íFˆˆ¬ˆóFV“7Fñˆ‚'WGFˆ‚v˜&∂ñÊr‡¢6ˆÁ7BFˆˆ≈6WB“ÊWr6WBÑˆ&¶V7BÁf«VW2áFˆˆƒ7FñˆÁ2íÊf∆BÇíì∞¢6ˆÁ7B'F‚“6ˆ◊WFT7Fñˆ‰'WGFˆÁ2ÇíÊfñÊBÜ"”‚"Ê∆∆˜vVB”“f«6RbbFˆˆ≈6WBÊÜ2Ü"Ê7Fñˆ‚íì∞¢ñbÇ'F‚í&WGW&„∞¢7FófT7Fñˆ‚“'F‚Ê7Fñˆ„∞¢W6T7FófT7Fñˆ‚Çì∞¢–¢gVÊ7Fñˆ‚7ñ6∆T7FófUFˆˆ¬ÜFV«Fí∞¢6ˆÁ7BñGÇ“tÑTT≈ı4ƒıE2ÊñÊFWÑˆbÜ7FófUFˆˆ¬ì∞¢6ˆÁ7BÊWáB“ÜñGÇ≤FV«F≤tÑTT≈ı4ƒıE2Ê∆VÊwFÇíRtÑTT≈ı4ƒıE2Ê∆VÊwFÉ∞¢6WD7FófUFˆˆ¬ÖtÑTT≈ı4ƒıE5∂ÊWáE“ì∞¢–¢ÚÚ7Fñˆ„ˆ7Fñˆ„"vÜñ∆RvñV∆FñÊrFÜRvVˆ‚Fˆˆ¬&˜WFRFá&˜VvÄ¢ÚÚ6ˆ÷&BÊñÁWBw2FˆÜˆ∆B7FFR÷6ÜñÊRá6VR6ˆ÷&B÷ñÁWBÊß2í(	B6÷P¢ÚÚ2FÜRFW6∑F˜÷˜W6R÷6∆ñ6≤ÜÊF∆W"ßW7B&˜fRFÜó2gVÊ7Fñˆ‚«&VGê¢ÚÚFˆW2f˜"'WGFˆ‚Û"(	BñÁ7FVBˆb'V‰7Fñˆ‰'WGFˆ‰E6∆˜Bw26ñÊv∆P¢ÚÚñ÷÷VFñFRW6T7FófT7Fñˆ‚Çí6∆¬¬vÜñ6ÇÜ2ÊÚ6ˆÊ6WBˆb&ÜV∆B"@¢ÚÚ∆¬‚vóFÜ˜WBFÜó2¬ÁíFWfñ6RvÜ˜6R7Fñˆ„ˆ7Fñˆ„"vˆW2Fá&˜VvÄ¢ÚÚ'V‰ñÁWD7Fñˆ‚Ü∂Wñ&ˆ&B76R¬WfW'í6ˆÁG&ˆ∆∆W"G&ñvvW"í6˜V∆@¢ÚÚÊWfW"G&ñvvW"Üˆ∆B◊6∆˜B&ñ∆óGì¢&W72¶ÊB¢&V∆V6R&˜FÇfó&V@¢ÚÚFÜR6÷RñÁ7FÁBF‚WfW'í˜FÜW"Fˆˆ¬∂VW2óG2&Wfñ˜W0¢ÚÚñÁ7FÁB÷fó&R&VÜfñ˜"VÊ6ÜÊvVB‡¢gVÊ7Fñˆ‚vVˆ‰7FñˆÂ6∆˜BÜ7Fñˆ‰ñBí∞¢ñbÇÜ7Fñˆ‰ñB””“v7Fñˆ„r«¬7Fñˆ‰ñB””“v7Fñˆ„"ríí&WGW&‚∞¢ñbÜ7FófUFˆˆ¬”“wvVˆ‚r«¬vñÊF˜r‰6ˆ÷&CÚÊñÁWBí&WGW&‚∞¢&WGW&‚7Fñˆ‰ñB””“v7Fñˆ„rÚ¢#∞¢–¢gVÊ7Fñˆ‚'V‰ñÁWD7Fñˆ‚Ü7Fñˆ‰ñB¬Ü6R“w&W72rí∞¢ñbáÜ6R””“w&V∆V6Rrí∞¢ñbÜ7Fñˆ‰ñB””“v7Fñˆ„rí7Fñˆ‰ÜV∆DF˜v‚“f«6S∞¢6ˆÁ7B&V∆V6U6∆˜B“vVˆ‰7FñˆÂ6∆˜BÜ7Fñˆ‰ñBì∞¢ñbá&V∆V6U6∆˜BívñÊF˜r‰6ˆ÷&BÊñÁWBÁ&W74VÊBá&V∆V6U6∆˜Bì∞¢&WGW&„∞¢–¢ñbávñÊF˜r‰fó6ÜñÊsÚÁ7FFSÚÊ7FófRí∞¢ñbÜ7Fñˆ‰ñB””“vñÁFW&7Br«¬7Fñˆ‰ñB””“v7Fñˆ„rívñÊF˜r‰fó6ÜñÊsÚÁ&ñ÷'î7Fñˆ‚Çì∞¢&WGW&„∞¢–¢ñbÜ÷VÁT˜V‚«¬f&‘VFóD÷ˆFRí&WGW&„∞¢ñbÜ7Fñˆ‰ñB””“vñÁFW&7Brí≤'V‰ñÁFW&7D7Fñˆ‚Çì≤&WGW&„≤–¢6ˆÁ7BvVˆÂ6∆˜B“vVˆ‰7FñˆÂ6∆˜BÜ7Fñˆ‰ñBì∞¢ñbávVˆÂ6∆˜Bí∞¢ñbÜ7Fñˆ‰ñB””“v7Fñˆ„rí7Fñˆ‰ÜV∆DF˜v‚“G'VS∞¢vñÊF˜r‰6ˆ÷&BÊñÁWBÁ&W757F'BávVˆÂ6∆˜Bì∞¢&WGW&„∞¢–¢6ˆÁ7B7FñˆÂ6∆˜B“ıÊ7Fñˆ‚Ö∆B≤íBÚÊWÜV2Ü7Fñˆ‰ñBì∞¢ñbÜ7FñˆÂ6∆˜Bí≤'V‰7Fñˆ‰'WGFˆ‰E6∆˜BÑÁV÷&W"Ü7FñˆÂ6∆˜E≥“íì≤&WGW&„≤–¢ñbÜ7Fñˆ‰ñB””“vFˆFvRrí≤W&f˜&‘6ˆÁFWáD7Fñˆ‚Çì≤&WGW&„≤–¢ñbÜ7Fñˆ‰ñB””“wFˆvv∆T÷˜VÁBrí≤vñÊF˜r‰÷˜VÁG3ÚÁFˆvv∆T÷˜VÁBÇì≤&WGW&„≤–¢ñbÜ7Fñˆ‰ñB””“w7vF&vWBrí∞¢6ˆÁ7Bñ‘Êv∆R“6ˆÁG&ˆ∆∆W$∆ˆˆ¥7FófRÚ6ˆÁG&ˆ∆∆W$∆ˆˆ¥Êv∆P¢¢Üó4FW6∑F˜bb÷˜W6T∆ˆˆ¥7FófRíÚ÷˜W6T∆ˆˆ¥Êv∆P¢¢f6ñÊtÊv∆S∞¢7vWFıF&vWBÜñ‘Êv∆Rì∞¢&WGW&„∞¢–¢ñbÜ7Fñˆ‰ñB””“v7ñ6∆UFˆˆƒ7Fñˆ‚rí∞¢6ˆÁ7B7FñˆÁ2“Fˆˆƒ7FñˆÁ5∂7FófUFˆˆ≈”∞¢6ˆÁ7BñGÇ“7FñˆÁ2ÊñÊFWÑˆbÜ7FófT7Fñˆ‚ì∞¢7FófT7Fñˆ‚“7FñˆÁ5≤ÜñGÇ≤íR7FñˆÁ2Ê∆VÊwFÖ”∞¢&Vg&W6Ñ7Fñˆ‰&"Çì∞¢&WGW&„∞¢–¢ñbÜ7Fñˆ‰ñB””“vóFV’&Wbr«¬7Fñˆ‰ñB””“vóFV‘ÊWáBrí∞¢7ñ6∆T7FófTñÁfVÁF˜'îóFV“Ü7Fñˆ‰ñB””“vóFV’&WbrÚ”¢ì∞¢&Vg&W6ÑóFV’67&ˆ∆¬Çì≤&Vg&W6Ñ7Fñˆ‰&"Çì≤&WGW&„∞¢–¢ñbÜ7Fñˆ‰ñB””“wFˆˆ≈&Wbr«¬7Fñˆ‰ñB””“wFˆˆƒÊWáBrí≤7ñ6∆T7FófUFˆˆ¬Ü7Fñˆ‰ñB””“wFˆˆ≈&WbrÚ”¢ì≤&WGW&„≤–¢ñbÜ7Fñˆ‰ñB””“wvVˆÂ7vóF6Çrí≤Fˆvv∆UVñ6µvVˆÂ7vóF6ÇÇì≤&WGW&„≤–¢6ˆÁ7BFˆˆ¬“≤Fˆˆ√¢w6Ü˜fV¬r¬Fˆˆ√#¢vÜˆRr¬Fˆˆ√C¢vÜRr¬Fˆˆ√S¢wñ6≤r¬Fˆˆ√c¢vÜ'ˆˆ‚r’∂7Fñˆ‰ñE”∞¢ñbáFˆˆ¬í6WD7FófUFˆˆ¬áFˆˆ¬ì∞¢–¢gVÊ7Fñˆ‚vWD7Fñˆ‰f˜$'WGFˆ‚ÜFWfñ6R¬'WGFˆ‚¬ÜV∆E6ÜñgB“ÁV∆¬í∞¢ñbÜÜV∆E6ÜñgCÚÊ&ñÊFñÊw3ÚÂ∂'WGFˆÂ“í&WGW&‚ÜV∆E6ÜñgBÊ&ñÊFñÊw5∂'WGFˆÂ”∞¢6ˆÁ7B&ñÊFñÊw2“ñÁWD&ñÊFñÊw5∂FWfñ6U“«¬∑”∞¢&WGW&‚ˆ&¶V7BÊ∂Wó2Ü&ñÊFñÊw2íÊfñÊBÜ7Fñˆ‰ñB”‚&ñÊFñÊw5∂7Fñˆ‰ñE“””“'WGFˆ‚í«¬ÁV∆√∞¢–¢gVÊ7Fñˆ‚ˆ∆ƒ6ˆÁG&ˆ∆∆W$ñÁWBÇí∞¢ñbÇv÷WE7FFRÊfˆ7W6VBí&WGW&„∞¢6ˆÁ7BG2“ÊfñvF˜"ÊvWDv÷WG3Ú‚Çí«¬µ”∞¢6ˆÁ7BB“'&íÊg&ˆ“áG2íÊfñÊBÑ&ˆˆ∆V‚ì∞¢ñbÇBí∞¢ÚÚˆÊ«í6∆V"÷˜fV÷VÁBñÁWBˆ‚‚7GV¬v÷WBFó66ˆÊÊV7B¬Ê˜BWfW'ê¢ÚÚg&÷R(	B˜FÜW'vó6RFÜó27Fˆ◊2FÜRF˜V6Ç¶˜ó7Fñ6≤ÜÊB∂Wñ&ˆ&Bíˆ‡¢ÚÚÁíFWfñ6RvóFÇÊÚv÷WB¬vÜñ6Çó2fó'GV∆«í∆¬÷ˆ&ñ∆RFWfñ6W2‡¢ñbÜv÷WE7FFRÊÜEBí≤ñÁWBÁÇ“≤ñÁWBÁí“≤–¢v÷WE7FFRÊÜEB“f«6S∞¢&WGW&„∞¢–¢v÷WE7FFRÊÜEB“G'VS∞¢6ˆÁ7BG¢“îÂUEÙDTdT≈E2ÊFVG¶ˆÊS∞¢6ˆÁ7BÇ“÷FÇÊ'2áBÊÜW5≥“«¬í„“G¢ÚBÊÜW5≥“¢∞¢6ˆÁ7Bí“÷FÇÊ'2áBÊÜW5≥“«¬í„“G¢ÚBÊÜW5≥“¢∞¢6ˆÁ7B'Ç“÷FÇÊ'2áBÊÜW5≥%“«¬í„“G¢ÚBÊÜW5≥%“¢∞¢6ˆÁ7B'í“÷FÇÊ'2áBÊÜW5≥5“«¬í„“G¢ÚBÊÜW5≥5“¢∞¢ñÁWBÁÇ“É≤ñÁWBÁí“ì∞¢6ˆÁG&ˆ∆∆W$∆ˆˆ¥7FófR“÷FÇÊáó˜Bá'Ç¬'íí„“G£∞¢ñbÜ6ˆÁG&ˆ∆∆W$∆ˆˆ¥7FófRí∞¢6ˆÁG&ˆ∆∆W$∆ˆˆ¥Êv∆R“÷FÇÊF„"á'í¬'Çì∞¢F&vWDñ‘Êv∆R“6ˆÁG&ˆ∆∆W$∆ˆˆ¥Êv∆S∞¢–¢6ˆÁ7BF˜v‚“ÊWr6WBÇì∞¢BÊ'WGFˆÁ2Êf˜$V6ÇÇÜ'WGFˆ‚¬ñÊFWÇí”‚≤ñbÜ'WGFˆ„ÚÁ&W76VBíF˜v‚ÊFBÜ'WGFˆ‚G∂ñÊFWá÷ì≤“ì∞¢ñbÇáBÊ'WGFˆÁ5≥e”ÚÁf«VR«¬í„“îÂUEÙDTdT≈E2ÊÜó5&W75Fá&W6Üˆ∆BíF˜v‚ÊFBÇt∆VgEG&ñvvW"rì∞¢ñbÇáBÊ'WGFˆÁ5≥u”ÚÁf«VR«¬í„“îÂUEÙDTdT≈E2ÊÜó5&W75Fá&W6Üˆ∆BíF˜v‚ÊFBÇu&ñváEG&ñvvW"rì∞¢6ˆÁ7BÜó5&W72“îÂUEÙDTdT≈E2ÊÜó5&W75Fá&W6Üˆ∆C∞¢ñbá'Ç√“÷Üó5&W72íF˜v‚ÊFBÇu&ñváE7Fñ6¥∆VgBrì∞¢ñbá'Ç„“Üó5&W72íF˜v‚ÊFBÇu&ñváE7Fñ6µ&ñváBrì∞¢ñbá'í√“÷Üó5&W72íF˜v‚ÊFBÇu&ñváE7Fñ6µWrì∞¢ñbá'í„“Üó5&W72íF˜v‚ÊFBÇu&ñváE7Fñ6¥F˜v‚rì∞¢6ˆÁ7BÜV∆E6ÜñgB“ñÁWD&ñÊFñÊw2Ê÷ˆFU6ÜñgG2ÊfñÊBá2”‚2ÊFWfñ6R””“v6ˆÁG&ˆ∆∆W"rbbF˜v‚ÊÜ2á2Ê'WGFˆ‚íì∞¢ñbÜÜV∆E6ÜñgBí6ˆÁG&ˆ∆∆W$∆ˆˆ¥7FófR“f«6S∞¢f˜"Ü6ˆÁ7B'WGFˆ‚ˆbF˜v‚í∞¢ñbÜv÷WE7FFRÁ&Wfñ˜W2ÊÜ2Ü'WGFˆ‚í«¬'WGFˆ‚””“ÜV∆E6ÜñgCÚÊ'WGFˆ‚í6ˆÁFñÁVS∞¢6ˆÁ7B7Fñˆ‰ñB“vWD7Fñˆ‰f˜$'WGFˆ‚Çv6ˆÁG&ˆ∆∆W"r¬'WGFˆ‚¬ÜV∆E6ÜñgBì∞¢ñbÜ7Fñˆ‰ñBí≤∆7DñÁWDFWfñ6R“v6ˆÁG&ˆ∆∆W"s≤'V‰ñÁWD7Fñˆ‚Ü7Fñˆ‰ñB¬w&W72rì≤–¢–¢f˜"Ü6ˆÁ7B'WGFˆ‚ˆbv÷WE7FFRÁ&Wfñ˜W2í∞¢ñbÜF˜v‚ÊÜ2Ü'WGFˆ‚íí6ˆÁFñÁVS∞¢6ˆÁ7B7Fñˆ‰ñB“vWD7Fñˆ‰f˜$'WGFˆ‚Çv6ˆÁG&ˆ∆∆W"r¬'WGFˆ‚¬v÷WE7FFRÊ7FófU6ÜñgBì∞¢ñbÜ7Fñˆ‰ñBí'V‰ñÁWD7Fñˆ‚Ü7Fñˆ‰ñB¬w&V∆V6Rrì∞¢–¢v÷WE7FFRÁ&Wfñ˜W2“F˜v„∞¢v÷WE7FFRÊ7FófU6ÜñgB“ÜV∆E6ÜñgB«¬ÁV∆√∞¢–¢vñÊF˜rÊFDWfVÁD∆ó7FVÊW"Çvfˆ7W2r¬Çí”‚≤v÷WE7FFRÊfˆ7W6VB“G'VS≤“ì∞¢vñÊF˜rÊFDWfVÁD∆ó7FVÊW"Çv&«W"r¬Çí”‚≤v÷WE7FFRÊfˆ7W6VB“f«6S≤v÷WE7FFRÁ&Wfñ˜W2Ê6∆V"Çì≤ñÁWBÁÇ“≤ñÁWBÁí“≤6ˆÁG&ˆ∆∆W$∆ˆˆ¥7FófR“f«6S≤“ì∞¢Fˆ7V÷VÁBÊFDWfVÁD∆ó7FVÊW"Çwfó6ñ&ñ∆óGñ6ÜÊvRr¬Çí”‚≤ñbÜFˆ7V÷VÁBÊÜñFFV‚í≤v÷WE7FFRÊfˆ7W6VB“f«6S≤v÷WE7FFRÁ&Wfñ˜W2Ê6∆V"Çì≤ñÁWBÁÇ“≤ñÁWBÁí“≤6ˆÁG&ˆ∆∆W$∆ˆˆ¥7FófR“f«6S≤““ì∞†¢ÚÚ6WGFñÊw2F"w2ñÁWB÷&ñÊFñÊr&˜w2Ê˜r∆ófRñ‡¢ÚÚß2ˆñÁWB◊6WGFñÊw2◊ÊV¬Êß2(	B6∆¬fñvñÊF˜r‰ñÁWE6WGFñÊw5ÊV¬Á&VÊFW"Çí‡¢ÚÚñÊóBÇívBÜW&R&FÜW"FÜ‚F˜v‚vóFÇFÜR˜FÜW"vñÊF˜r„ƒÊ÷W76S‡¢ÚÚ÷ˆGV∆W2¬6ñÊ6RáVÊ∆ñ∂RFÜV“íFÜó2ˆÊRó2&VÊFW&VBˆÊ6Rñ÷÷VFñFV«ê¢ÚÚB&ˆ˜B&FÜW"FÜ‚∆¶ñ«íˆ‚fó'7BF"˜V‚‡¢Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÇvFD÷ˆFU6ÜñgD'F‚rìÚÊFDWfVÁD∆ó7FVÊW"Çv6∆ñ6≤r¬Çí”‚≤ñÁWD&ñÊFñÊw2Ê÷ˆFU6ÜñgG2ÁW6Çá≤ñC¢7W7Fˆ““G¥FFRÊÊ˜rÇó÷¬∆&V√¢t7W7Fˆ“6ÜñgBr¬FWfñ6S¢v6ˆÁG&ˆ∆∆W"r¬'WGFˆ„¢t'WGFˆ„Br¬&ñÊFñÊw3¢∑““ì≤6fTñÁWD&ñÊFñÊw2Çì≤vñÊF˜r‰ñÁWE6WGFñÊw5ÊV¬Á&VÊFW"Çì≤“ì∞¢vñÊF˜r‰ñÁWE6WGFñÊw5ÊV√ÚÊñÊóBá∞¢îÂUEÙDTdT≈E2¿¢ñÁWD&ñÊFñÊw2¿¢4ÙÂE$ÙƒƒU%ÙîÂUEÙıDîÙÂ2¿¢'WGFˆ‰∆&V¬¿¢&ñÊFñÊt6ˆÊf∆ñ7B¿¢6fTñÁWD&ñÊFñÊw2¿¢“ì∞¢vñÊF˜r‰ñÁWE6WGFñÊw5ÊV¬Á&VÊFW"Çì∞†¢vñÊF˜rÊFDWfVÁD∆ó7FVÊW"Çv∂WñF˜v‚r¬ÜWfVÁBí”‚∞¢6ˆÁ7B∂Wí“WfVÁBÊ∂WíÁFÙ∆˜vW$66RÇì∞¢ñbávñÊF˜r‰fó6ÜñÊsÚÁ7FFSÚÊ7FófRí∞¢ñbÜ∂Wí””“vW66Rrí≤WfVÁBÁ&WfVÁDFVfV«BÇì≤vñÊF˜r‰fó6ÜñÊsÚÊ6∆˜6RÇì≤&WGW&„≤–¢6ˆÁ7Bfó6ÜñÊt&˜VÊD7Fñˆ‚“vWD7Fñˆ‰f˜$'WGFˆ‚ÇvFW6∑F˜r¬WfVÁBÊ6ˆFRì∞¢ñbÜfó6ÜñÊt&˜VÊD7Fñˆ‚””“vñÁFW&7Br«¬fó6ÜñÊt&˜VÊD7Fñˆ‚””“v7Fñˆ„r«¬∂Wí””“rr«¬∂Wí””“vVÁFW"rí∞¢WfVÁBÁ&WfVÁDFVfV«BÇì∞¢vñÊF˜r‰fó6ÜñÊsÚÁ&ñ÷'î7Fñˆ‚Çì∞¢–¢&WGW&„∞¢–¢ñbÜ∂Wí””“vW66Rrí≤WfVÁBÁ&WfVÁDFVfV«BÇì≤ñbÜFñ∆ˆwVT˜V‚í≤6∆˜6TÁ4Fñ∆ˆwVRÇì≤&WGW&„≤“÷VÁT˜V‚Ú6∆˜6T÷VÁRÇí¢˜V‰÷VÁRÇì≤&WGW&„≤–¢ÚÚ”¢vñ∆FW&ÊW72÷(	B6∆˜6W2ñb«&VGí˜V‚ˆ‚FÜR÷F"Ü÷ó'&˜'0¢ÚÚ7Fíw26∆VÊF"◊6Ü˜'F7WB&VÜfñ˜"í¬˜FÜW'vó6R˜VÁ2˜7vóF6ÜW2FÚóB‡¢ñbÜ∂Wí””“v“rí∞¢WfVÁBÁ&WfVÁDFVfV«BÇì∞¢6ˆÁ7Bˆ‰÷F"“Fˆ7V÷VÁBÁVW'ï6V∆V7F˜"ÇrÊ◊◊F%∂FF÷◊ÊV√“&÷%“rìÚÊ6∆74∆ó7BÊ6ˆÁFñÁ2Çv7FófRrì∞¢ñbÜ÷VÁT˜V‚bbˆ‰÷F"í6∆˜6T÷VÁRÇì∞¢V«6R˜V‰÷VÁRÇv÷rì∞¢&WGW&„∞¢–¢ñbÜ÷VÁT˜V‚í&WGW&„∞¢6ˆÁ7B&˜VÊDFW6∑F˜7Fñˆ‚“vWD7Fñˆ‰f˜$'WGFˆ‚ÇvFW6∑F˜r¬WfVÁBÊ6ˆFRì∞¢ñbÜ&˜VÊDFW6∑F˜7Fñˆ‚bb≤t∂WîRr¬t∂Wïu“ÊñÊ6«VFW2ÜWfVÁBÊ6ˆFRíí∞¢WfVÁBÁ&WfVÁDFVfV«BÇì∞¢ñbÇWfVÁBÁ&WVBí'V‰ñÁWD7Fñˆ‚Ü&˜VÊDFW6∑F˜7Fñˆ‚¬w&W72rì∞¢&WGW&„∞¢–¢ñbÖ≤v'&˜v∆VgBr¬v'&˜w&ñváBr¬v'&˜wWr¬v'&˜vF˜v‚r¬wrr¬vr¬w2r¬vBu“ÊñÊ6«VFW2Ü∂Wííí∞¢WfVÁBÁ&WfVÁDFVfV«BÇì≤ñÁWBÊ∂Wó2ÊFBÜ∂Wíì∞¢–†¢ñbÜ∂Wí””“vRrí∞¢WfVÁBÁ&WfVÁDFVfV«BÇì∞¢ñbÜó4FW6∑F˜í≤7F'DFW6∑F˜Üˆ∆D∂WíÇvRr¬WfVÁBì≤&WGW&„≤–¢–¢ñbÜ∂Wí””“wrí∞¢WfVÁBÁ&WfVÁDFVfV«BÇì∞¢ñbÜó4FW6∑F˜í≤7F'DFW6∑F˜Üˆ∆D∂WíÇwr¬WfVÁBì≤&WGW&„≤–¢6ˆÁ7B7FñˆÁ2“Fˆˆƒ7FñˆÁ5∂7FófUFˆˆ≈”∞¢6ˆÁ7BñGÇ“7FñˆÁ2ÊñÊFWÑˆbÜ7FófT7Fñˆ‚ì∞¢7FófT7Fñˆ‚“7FñˆÁ5≤ÜñGÇ≤íR7FñˆÁ2Ê∆VÊwFÖ”∞¢&Vg&W6Ñ7Fñˆ‰&"Çì∞¢&WGW&„∞¢–†¢ÚÚ&ñ÷'í7Fñˆ„¢76R¬VÁFW"¬˜"RÑRˆÊ«íF2ˆ‚FW6∑F˜≤Üˆ∆B˜VÁ2Fˆˆ¬6V∆V7Fñˆ‚ê¢ñbÜ∂Wí””“rr«¬∂Wí””“vVÁFW"r«¬∂Wí””“vRrí∞¢WfVÁBÁ&WfVÁDFVfV«BÇì∞¢ñbÇWfVÁBÁ&WVBí∞¢7Fñˆ‰ÜV∆DF˜v‚“G'VS∞¢W6T7FófT7Fñˆ‚Çì∞¢–¢&WGW&„∞¢–†¢ñbÜ∂Wí””“srí6WD7FófUFˆˆ¬Çw6Ü˜fV¬rì∞¢ñbÜ∂Wí””“s"rí6WD7FófUFˆˆ¬ÇvÜˆRrì∞¢ñbÜ∂Wí””“s2rí6WD7FófUFˆˆ¬ÇwvVˆ‚rì∞¢ñbÜ∂Wí””“sBrí6WD7FófUFˆˆ¬ÇvÜRrì∞¢ñbÜ∂Wí””“sRrí6WD7FófUFˆˆ¬Çwñ6≤rì∞¢ñbÜ∂Wí””“sbrí6WD7FófUFˆˆ¬ÇvÜ'ˆˆ‚rì∞†¢ÚÚóFV“67&ˆ∆√¢¬Ú‚˜"F"ı6ÜñgBµF ¢ñbÜ∂Wí””“r¬rí∞¢7ñ6∆T7FófTñÁfVÁF˜'îóFV“Ç”ì∞¢&Vg&W6ÑóFV’67&ˆ∆¬Çì≤&Vg&W6Ñ7Fñˆ‰&"Çì∞¢–¢ñbÜ∂Wí””“r‚r«¬∂Wí””“wF"rí∞¢WfVÁBÁ&WfVÁDFVfV«BÇì∞¢7ñ6∆T7FófTñÁfVÁF˜'îóFV“ÜWfVÁBÁ6ÜñgD∂WíÚ”¢ì∞¢&Vg&W6ÑóFV’67&ˆ∆¬Çì≤&Vg&W6Ñ7Fñˆ‰&"Çì∞¢–†¢ÚÚÉ¢6ˆÁFWáB7Fñˆ‚(	B6∆ñ÷'2ˆ6∆ñfb÷FófW2v∆¬ñ‚FÜR7W'&VÁ@¢ÚÚf6ñÊrFó&V7Fñˆ‚ñbˆÊRw2FÜW&R¬˜FÜW'vó6RFˆFvW2vóFÇí÷g&÷W0¢ñbÜ∂Wí””“wÇrí∞¢WfVÁBÁ&WfVÁDFVfV«BÇì∞¢W&f˜&‘6ˆÁFWáD7Fñˆ‚Çì∞¢&WGW&„∞¢–†¢ÚÚ#¢Fˆvv∆RFV'Vr∆Vr÷&ˆÊRfó7V∆ó¶Fñˆ‚ÜÜó˜FÜñvÇˆ6∆bˆ∂ÊVP¢ÚÚwVñFW2¬6÷R6ˆ∆˜&VB67V∆W2FÜRgW&ÊóGW&R÷fF"÷WFÜ˜"Fˆˆ¿¢ÚÚG&w2˜fW"óG2˜v‚6VFVB&WfñWríf˜"WfW'ífó6ñ&∆RfF"w2∆Vp¢ÚÚ&ñr(	BFWbˆFñvÊ˜7Fñ2ñB¬Ê˜B∆ñW"÷f6ñÊr÷V6ÜÊñ2‡¢ñbÜ∂Wí””“v"rí∞¢WfVÁBÁ&WfVÁDFVfV«BÇì∞¢6ˆÁ7BÊWáB“vñÊF˜rÂ&ˆ6VGW&ƒ∆VtÊñ÷Fñˆ„ÚÁ6Ü˜t&ˆÊW3∞¢vñÊF˜rÂ&ˆ6VGW&ƒ∆VtÊñ÷Fñˆ„ÚÁ6WE6Ü˜t&ˆÊW2ÜÊWáBì∞¢6Ü˜uFˆ7BÜÊWáBÚt∆Vr&ˆÊW3¢6Ü˜v‚r¢t∆Vr&ˆÊW3¢ÜñFFV‚r¬G'VR¬f«6Rì∞¢&WGW&„∞¢–†¢ÚÚ#¢7ñ6∆R7FófRFˆˆ¬w27Fñˆ‚÷ˆFRÜWVóf∆VÁBFÚˆ‚÷ˆ&ñ∆Rê¢ñbÜ∂Wí””“w"rí∞¢6ˆÁ7B7FñˆÁ2“Fˆˆƒ7FñˆÁ5∂7FófUFˆˆ≈”∞¢6ˆÁ7BñGÇ“7FñˆÁ2ÊñÊFWÑˆbÜ7FófT7Fñˆ‚ì∞¢7FófT7Fñˆ‚“7FñˆÁ5≤ÜñGÇ≤íR7FñˆÁ2Ê∆VÊwFÖ”∞¢&Vg&W6Ñ7Fñˆ‰&"Çì∞¢&WGW&„∞¢–¢“ì∞†¢vñÊF˜rÊFDWfVÁD∆ó7FVÊW"Çv∂WóWr¬ÜWfVÁBí”‚∞¢6ˆÁ7B∂Wí“WfVÁBÊ∂WíÁFÙ∆˜vW$66RÇì∞¢ñÁWBÊ∂Wó2ÊFV∆WFRÜ∂Wíì∞¢ÚÚ÷ó'&˜'2FÜR∂WñF˜v‚ÜÊF∆W"w2V&«í&WGW&„¢vóFÜ˜WBFÜó2¬&V∆V6ñÊp¢ÚÚFÜRñÁFW&7B∂WíÑRígFW"fó6ÜñÊu&ñ÷'î7Fñˆ‚Çí«&VGífó&VBˆ‡¢ÚÚ∂WñF˜v‚fV∆¬Fá&˜VvÇFÚFÜRvRrÜÊF∆ñÊr&V∆˜r¬vÜñ6Ç6∆«0¢ÚÚW6T7FófT7Fñˆ‚Çí(	B&R◊G&ñvvW&ñÊr&Vvñ‰fó6ÜñÊt67BÇíÊB6∆ˆ&&W&ñÊp¢ÚÚFÜR&ñÊr÷ñÊñv÷RFÜB&W72ÜBßW7B˜VÊVB‡¢ñbávñÊF˜r‰fó6ÜñÊsÚÁ7FFSÚÊ7FófRí&WGW&„∞¢ÚÚ7ñ÷÷WG&ñ2&V∆V6Rf˜"vÜFWfW"∂WñF˜v‚Fó7F6ÜVB2w&W72r(	@¢ÚÚ6÷R&ñÊFñÊr∆ˆˆ∑WˆWÜ6«W6ñˆ‚2∂WñF˜v‚&˜fR¬6ÚÜV∆BvVˆ‡¢ÚÚ7Fñˆ‚ÜRÊr‚76Rˆ7Fñˆ„í7GV∆«í&V6ÜW26ˆ÷&BÊñÁWBÁ&W74VÊ@¢ÚÚñÁ7FVBˆbˆÊ«íWfW"fó&ñÊr2‚ñÁ7FÁBF‡¢6ˆÁ7B&˜VÊDFW6∑F˜7FñˆÂW“vWD7Fñˆ‰f˜$'WGFˆ‚ÇvFW6∑F˜r¬WfVÁBÊ6ˆFRì∞¢ñbÜ&˜VÊDFW6∑F˜7FñˆÂWbb≤t∂WîRr¬t∂Wïu“ÊñÊ6«VFW2ÜWfVÁBÊ6ˆFRíí∞¢'V‰ñÁWD7Fñˆ‚Ü&˜VÊDFW6∑F˜7FñˆÂW¬w&V∆V6Rrì∞¢–¢ñbÜ∂Wí””“vRrbbó4FW6∑F˜í∞¢WfVÁBÁ&WfVÁDFVfV«BÇì∞¢6ˆÁ7Bv4ÜV∆B“fñÊó6ÑFW6∑F˜Üˆ∆D∂WíÇvRrì∞¢ñbÇv4ÜV∆Bí≤7Fñˆ‰ÜV∆DF˜v‚“G'VS≤W6T7FófT7Fñˆ‚Çì≤7Fñˆ‰ÜV∆DF˜v‚“f«6S≤–¢&WGW&„∞¢–¢ñbÜ∂Wí””“wrbbó4FW6∑F˜í∞¢WfVÁBÁ&WfVÁDFVfV«BÇì∞¢6ˆÁ7Bv4ÜV∆B“fñÊó6ÑFW6∑F˜Üˆ∆D∂WíÇwrì∞¢ñbÇv4ÜV∆Bí∞¢6ˆÁ7B'FÁ2“6ˆ◊WFT7Fñˆ‰'WGFˆÁ2Çì∞¢6ˆÁ7B6V6ˆÊB“'FÁ2ÊfñÊBÇÜ"¬íí”‚í‚bb"Ê∆∆˜vVBì∞¢ñbá6V6ˆÊBí≤7FófT7Fñˆ‚“6V6ˆÊBÊ7Fñˆ„≤W6T7FófT7Fñˆ‚Çì≤–¢–¢&WGW&„∞¢–¢ñbÜ∂Wí””“rr«¬∂Wí””“vVÁFW"r«¬∂Wí””“vRrí7Fñˆ‰ÜV∆DF˜v‚“f«6S∞¢“ì∞†¢ÚÚ67&ˆ∆¬vÜVV√¢∑vÜVV¬7v2óFV◊2¬R∑vÜVV¬7v2Fˆˆ«2¬˜FÜW'vó6R¶ˆˆ◊2FÜR6÷W&‡¢gVÊ7Fñˆ‚ÜÊF∆Tv÷UvÜVV¬ÜR¬ÜV∆DˆÊ«í“f«6Rí∞¢ñbÜ÷VÁT˜V‚«¬f&‘VFóD÷ˆFRí&WGW&‚f«6S∞¢6ˆÁ7BFó"“RÊFV«Fí‚Ú¢”∞¢ñbÜó4FW6∑F˜bbFW6∑F˜Üˆ∆D∂Wó2ÁÊF˜v‚í∞¢RÁ&WfVÁDFVfV«BÇì∞¢˜V‰FW6∑F˜Üˆ∆D&2Çwrì∞¢vñÊF˜rÂˆFW6∑F˜6V∆V7Fñˆ‰&3ÚÁ67&ˆ∆ƒóFV“Ç÷Fó"ì∞¢&WGW&‚G'VS∞¢–¢ñbÜó4FW6∑F˜bbFW6∑F˜Üˆ∆D∂Wó2ÊRÊF˜v‚í∞¢RÁ&WfVÁDFVfV«BÇì∞¢˜V‰FW6∑F˜Üˆ∆D&2ÇvRrì∞¢vñÊF˜rÂˆFW6∑F˜6V∆V7Fñˆ‰&3ÚÁ67&ˆ∆≈Fˆˆ¬Ç÷Fó"ì∞¢&WGW&‚G'VS∞¢–¢ñbÜÜV∆DˆÊ«íí&WGW&‚f«6S∞¢RÁ&WfVÁDFVfV«BÇì∞¢ÚÚFÜRFó&V7F˜"WFÜ˜'2WfW'í6÷W&&VBˆb7WG66VÊRÜñÊ6«VFñÊp¢ÚÚ¶ˆˆ“6&G2¬7WG66VÊU&WfñWu¶ˆˆ’W&6VÁBí(	B÷ÁV¬vÜVV¬◊¶ˆˆ“v˜V∆@¢ÚÚfñváBFÜBWFÜ˜&VBg&÷ñÊr¬6ÚóBw2ÊÚ÷˜Ü'WB7Fñ∆¬6ˆÁ7V÷VB¿¢ÚÚ6ÚFÜRvRóG6V∆bFˆW6‚wB67&ˆ∆¬ívÜñ∆R&WfñWró27FófR‡¢ñbÜ7WG66VÊU&WfñWt7FófRí&WGW&‚G'VS∞¢ñbÜFñ∆ˆwVU¶ˆˆ‘7FófRÇíí∞¢6ˆÁ7B6VÁ6óFófóGí“Fñ∆ˆwVU¶ˆˆ‘6ˆÊfñrÇíÁvÜVV≈6VÁ6óFófóGíÛÚ„S∞¢6WDFñ∆ˆwVT6÷W&¶ˆˆ’W&6VÁBÜFñ∆ˆwVT6÷W&¶ˆˆ’W&6VÁB≤Ç÷RÊFV«Fí¢6VÁ6óFófóGí¢íì∞¢&WGW&‚G'VS∞¢–¢6ˆÁ7B6fr“FW6∑F˜6ˆÁG&ˆ«46ˆÊfñrÇì∞¢6ˆÁ7B7FW“ÁV÷&W"Êó4fñÊóFRÑÁV÷&W"Ü6frÁvÜVV≈¶ˆˆ’7FWííÚÁV÷&W"Ü6frÁvÜVV≈¶ˆˆ’7FWí¢„S∞¢6WD6÷W&¶ˆˆ’66∆Rá5˜¶ˆˆ’66∆R≤Ç÷Fó"¢7FWíì∞¢&WGW&‚G'VS∞¢–¢vñÊF˜rÊFDWfVÁD∆ó7FVÊW"ÇwvÜVV¬r¬ÜRí”‚≤ñbÜÜÊF∆Tv÷UvÜVV¬ÜR¬G'VRííRÁ7F˜&˜vFñˆ‚Çì≤“¬≤76ófS¢f«6R¬6GW&S¢G'VR“ì∞¢Fá&VT6ˆÁFñÊW"ÊFDWfVÁD∆ó7FVÊW"ÇwvÜVV¬r¬ÜRí”‚≤ÜÊF∆Tv÷UvÜVV¬ÜR¬f«6Rì≤“¬≤76ófS¢f«6R“ì∞†¢gVÊ7Fñˆ‚WFFTFñ∆ˆwVUñÊ6ÑFó7FÊ6RÇí∞¢6ˆÁ7BˆñÁG2“≤‚‚ÊFñ∆ˆwVU¶ˆˆ’ˆñÁFW'2Áf«VW2Çï”∞¢ñbáˆñÁG2Ê∆VÊwFÇ¬"í≤Fñ∆ˆwVUñÊ6ÑFó7FÊ6R“ÁV∆√≤&WGW&„≤–¢Fñ∆ˆwVUñÊ6ÑFó7FÊ6R“÷FÇÊáó˜BáˆñÁG5≥“ÁÇ“ˆñÁG5≥“ÁÇ¬ˆñÁG5≥“Áí“ˆñÁG5≥“Áíì∞¢–†¢Fá&VT6ˆÁFñÊW"ÊFDWfVÁD∆ó7FVÊW"ÇwˆñÁFW&F˜v‚r¬ÜRí”‚∞¢ñbÇFñ∆ˆwVU¶ˆˆ‘7FófRÇí«¬RÁˆñÁFW%GóR”“wF˜V6Çrí&WGW&„∞¢Fñ∆ˆwVU¶ˆˆ’ˆñÁFW'2Á6WBÜRÁˆñÁFW$ñB¬≤É¢RÊ6∆ñVÁEÇ¬ì¢RÊ6∆ñVÁEí“ì∞¢WFFTFñ∆ˆwVUñÊ6ÑFó7FÊ6RÇì∞¢“ì∞¢Fá&VT6ˆÁFñÊW"ÊFDWfVÁD∆ó7FVÊW"ÇwˆñÁFW&÷˜fRr¬ÜRí”‚∞¢ñbÇFñ∆ˆwVU¶ˆˆ‘7FófRÇí«¬RÁˆñÁFW%GóR”“wF˜V6Çr«¬Fñ∆ˆwVU¶ˆˆ’ˆñÁFW'2ÊÜ2ÜRÁˆñÁFW$ñBíí&WGW&„∞¢Fñ∆ˆwVU¶ˆˆ’ˆñÁFW'2Á6WBÜRÁˆñÁFW$ñB¬≤É¢RÊ6∆ñVÁEÇ¬ì¢RÊ6∆ñVÁEí“ì∞¢6ˆÁ7BˆñÁG2“≤‚‚ÊFñ∆ˆwVU¶ˆˆ’ˆñÁFW'2Áf«VW2Çï”∞¢ñbáˆñÁG2Ê∆VÊwFÇ¬"í&WGW&„∞¢6ˆÁ7BÊWáDFó7FÊ6R“÷FÇÊáó˜BáˆñÁG5≥“ÁÇ“ˆñÁG5≥“ÁÇ¬ˆñÁG5≥“Áí“ˆñÁG5≥“Áíì∞¢ñbÜFñ∆ˆwVUñÊ6ÑFó7FÊ6RbbÊWáDFó7FÊ6R‚í∞¢6ˆÁ7B6VÁ6óFófóGí“Fñ∆ˆwVU¶ˆˆ‘6ˆÊfñrÇíÁñÊ6Ö6VÁ6óFófóGíÛÚ∞¢6WDFñ∆ˆwVT6÷W&¶ˆˆ’W&6VÁBÜFñ∆ˆwVT6÷W&¶ˆˆ’W&6VÁB≤ÇÜÊWáDFó7FÊ6RÚFñ∆ˆwVUñÊ6ÑFó7FÊ6Rí“í¢6VÁ6óFófóGí¢ì∞¢–¢Fñ∆ˆwVUñÊ6ÑFó7FÊ6R“ÊWáDFó7FÊ6S∞¢RÁ&WfVÁDFVfV«BÇì∞¢“¬≤76ófS¢f«6R“ì∞¢gVÊ7Fñˆ‚6∆V$Fñ∆ˆwVU¶ˆˆ’ˆñÁFW"ÜRí∞¢Fñ∆ˆwVU¶ˆˆ’ˆñÁFW'2ÊFV∆WFRÜRÁˆñÁFW$ñBì∞¢WFFTFñ∆ˆwVUñÊ6ÑFó7FÊ6RÇì∞¢–¢vñÊF˜rÊFDWfVÁD∆ó7FVÊW"ÇwˆñÁFW'Wr¬6∆V$Fñ∆ˆwVU¶ˆˆ’ˆñÁFW"ì∞¢vñÊF˜rÊFDWfVÁD∆ó7FVÊW"ÇwˆñÁFW&6Ê6V¬r¬6∆V$Fñ∆ˆwVU¶ˆˆ’ˆñÁFW"ì∞†¢ÚÚ)H)H6÷W&G&r◊FÚ÷∆ˆˆ≥¢6ñÊv∆R÷fñÊvW"G&rˆ‚÷ˆ&ñ∆R¬6ÜñgB∂÷˜W6R÷˜fV÷VÁBˆ‚FW6∑F˜‡¢ÚÚÁVFvW2FÜR∆ˆˆ≤Êv∆Rˆ‚F˜ˆbFÜR7FófR÷ˆFRw2&6Rg&÷ñÊr¬6∆◊VBFÚFÜR6ˆÊfñwW&VB&ÊvR‡¢∆WB6÷W&G&uˆñÁFW$ñB“ÁV∆√∞¢∆WB6÷W&G&u7F'EÇ“¬6÷W&G&u7F'Eí“∞¢∆WB6÷W&G&u7F'D¶ñ◊WFÑˆfg6WB“¬6÷W&G&u7F'DÊv∆Tˆfg6WB“∞¢gVÊ7Fñˆ‚6÷W&G&t∆∆˜vVBÇí∞¢&WGW&‚÷VÁT˜V‚bbf&‘VFóD÷ˆFRbbgW&ÊóGW&U∆6V÷VÁD&÷VD∂WíbbgW&ÊóGW&T÷˜fT&÷VDñ@¢bbFñ∆ˆwVU¶ˆˆ‘7FófRÇíbbvñÊF˜r‰fó6ÜñÊsÚÁ7FFSÚÊ7FófRbb7WG66VÊU&WfñWt7FófRbbvñÊF˜rÂóÜV≈&ˆ&SÚÊ&÷VC∞¢–¢ÚÚWfW'í˜FÜW"6÷W&÷ˆFRÁVFvW26÷∆¬∆ˆˆ≤÷&˜VÊBˆfg6WBˆ‚F˜ˆb¢ÚÚfóÜVB&6Rg&÷ñÊr¬6∆◊VBFñváBÜFW6∑F˜6ˆÁG&ˆ«2Ê6÷W&&˜FFT6∆◊FVr¿¢ÚÚFVfV«B+C\+í6ñÊ6RóBw2÷VÁBFÚ&RVV≤¬Ê˜Bg&VR˜&&óB‚6VFV@¢ÚÚ∆ñW'2vWBvVÁVñÊR3c+Ü˜&ó¶ˆÁF¬˜&&óBñÁ7FVB(	B6VRFÜRw6VFVBp¢ÚÚ6÷W&÷ˆFRw2g&VU&˜FFRf∆rñ‚67&F6Ü&ˆÊW2÷6ˆÊfñrÊß2‡¢gVÊ7Fñˆ‚g&VU&˜FFT6÷W&7FófRÇí∞¢&WGW&‚6÷W&÷ˆFT6ˆÊfñrÜ7FófT6÷W&÷ˆFRíÊg&VU&˜FFR””“G'VS∞¢–¢ÚÚw&2ñÁFÚÇ”É¬É“ñÁ7FVBˆb6∆◊ñÊr¬6Ú&WVFVBG&rñÁW@¢ÚÚ∂VW27ñÊÊñÊr∆¬FÜRví&˜VÊB&FÜW"FÜ‚ñÊÊñÊrB‚VFvR‡¢gVÊ7Fñˆ‚w&¶ñ◊WFÑFVrÜFVrí∞¢∆WBB“FVrR3c∞¢ñbÜB‚ÉíB”“3c∞¢ñbÜB√“”ÉíB≥“3c∞¢&WGW&‚C∞¢–¢gVÊ7Fñˆ‚6÷W&G&u&WVW7FVBÜRí∞¢&WGW&‚RÁˆñÁFW%GóR””“wF˜V6Çs∞¢–¢Fá&VT6ˆÁFñÊW"ÊFDWfVÁD∆ó7FVÊW"ÇwˆñÁFW&F˜v‚r¬ÜRí”‚∞¢ñbÇ6÷W&G&u&WVW7FVBÜRí«¬6÷W&G&t∆∆˜vVBÇíí&WGW&„∞¢6÷W&G&uˆñÁFW$ñB“RÁˆñÁFW$ñC∞¢6÷W&G&u7F'EÇ“RÊ6∆ñVÁEÉ∞¢6÷W&G&u7F'Eí“RÊ6∆ñVÁEì∞¢6÷W&G&u7F'D¶ñ◊WFÑˆfg6WB“6÷W&¶ñ◊WFÑˆfg6WDFVs∞¢6÷W&G&u7F'DÊv∆Tˆfg6WB“6÷W&Êv∆Tˆfg6WDFVs∞¢ÚÚ6‚Fá&˜rÇ$ÊÚ7FófRˆñÁFW"vóFÇFÜRvófV‚ñBó2f˜VÊB"íf˜"¢ÚÚF˜V6ÇFÜB7F'G2&Vf˜&RFÜR'&˜w6W"6ˆÁ6ñFW'2FÜRˆñÁFW"gV∆«ê¢ÚÚ7FófR(	BRÊr‚&ñváB2FÜRvRˆ∆ñ˜WBó27Fñ∆¬6WGF∆ñÊrgFW ¢ÚÚ∆ˆB‚VÊ6VváB¬FÜBv˜V∆B∆VfR6÷W&G&uˆñÁFW$ñBW&÷ÊVÁF«ê¢ÚÚ7GV6≤ˆ‚ˆñÁFW"FÜBvñ∆¬ÊWfW"vWB÷F6ÜñÊrˆñÁFW'Wá6VP¢ÚÚFÜRñFVÁFñ6¬fóÇˆ6ˆ÷÷VÁBˆ‚ÜÊF∆T¶˜ó7Fñ6µˆñÁFW$F˜v‚í¬6ñ∆VÁF«ê¢ÚÚG&˜ñÊrWfW'í&V¬6÷W&÷∆ˆˆ≤G&rgFW'v&BVÁFñ¬&V∆ˆB‡¢G'í≤Fá&VT6ˆÁFñÊW"Á6WEˆñÁFW$6GW&SÚ‚ÜRÁˆñÁFW$ñBì≤“6F6ÇÜW'"í≤Ú¢6VR&˜fR(	BFVw&FRw&6VgV∆«í¢Ú–¢“ì∞¢Fá&VT6ˆÁFñÊW"ÊFDWfVÁD∆ó7FVÊW"ÇwˆñÁFW&÷˜fRr¬ÜRí”‚∞¢ñbÜRÁˆñÁFW$ñB”“6÷W&G&uˆñÁFW$ñB«¬6÷W&G&t∆∆˜vVBÇíí&WGW&„∞¢6ˆÁ7BGÇ“RÊ6∆ñVÁEÇ“6÷W&G&u7F'EÉ∞¢6ˆÁ7BGí“RÊ6∆ñVÁEí“6÷W&G&u7F'Eì∞¢6ˆÁ7B6fr“FW6∑F˜6ˆÁG&ˆ«46ˆÊfñrÇì∞¢6ˆÁ7BFVuW%Ç“ÁV÷&W"Êó4fñÊóFRÑÁV÷&W"Ü6frÊ6÷W&&˜FFTFVuW%ÇííÚÁV÷&W"Ü6frÊ6÷W&&˜FFTFVuW%Çí¢„S∞¢6ˆÁ7B6∆◊FVr“ÁV÷&W"Êó4fñÊóFRÑÁV÷&W"Ü6frÊ6÷W&&˜FFT6∆◊FVrííÚÁV÷&W"Ü6frÊ6÷W&&˜FFT6∆◊FVrí¢CS∞¢6÷W&¶ñ◊WFÑˆfg6WDFVr“g&VU&˜FFT6÷W&7FófRÇê¢Úw&¶ñ◊WFÑFVrÜ6÷W&G&u7F'D¶ñ◊WFÑˆfg6WB≤GÇ¢FVuW%Çê¢¢6∆◊Ü6÷W&G&u7F'D¶ñ◊WFÑˆfg6WB≤GÇ¢FVuW%Ç¬÷6∆◊FVr¬6∆◊FVrì∞¢6÷W&Êv∆Tˆfg6WDFVr“6∆◊Ü6÷W&G&u7F'DÊv∆Tˆfg6WB“Gí¢FVuW%Ç¬÷6∆◊FVr¬6∆◊FVrì∞¢WFFT6÷W&˜6óFñˆ‚Çì∞¢“ì∞¢gVÊ7Fñˆ‚6∆V$6÷W&G&uˆñÁFW"ÜRí∞¢ñbÜRÁˆñÁFW$ñB””“6÷W&G&uˆñÁFW$ñBí6÷W&G&uˆñÁFW$ñB“ÁV∆√∞¢–¢vñÊF˜rÊFDWfVÁD∆ó7FVÊW"ÇwˆñÁFW'Wr¬6∆V$6÷W&G&uˆñÁFW"ì∞¢vñÊF˜rÊFDWfVÁD∆ó7FVÊW"ÇwˆñÁFW&6Ê6V¬r¬6∆V$6÷W&G&uˆñÁFW"ì∞†¢ÚÚ∆VgB6∆ñ6≤“Fˆˆ¬7Fñˆ‚áFˆÜˆ∆Bí¬&ñváB6∆ñ6≤“Fˆˆ¬7Fñˆ‚ ¢ÚÚáFˆÜˆ∆BívÜV‚vñV∆FñÊrFÜRvVˆ‚Fˆˆ¬(	B&˜WFVBFá&˜VvÄ¢ÚÚ6ˆ÷&BÊñÁWB6ÚFÜR∆ˆF˜WBw2B&ñ∆óGí6∆˜G26‚6∆ñ“FÜV“‡¢ÚÚWfW'í˜FÜW"Fˆˆ¬∂VW2óG2&Wfñ˜W26∆ñ6≤&VÜfñ˜"VÊ6ÜÊvVC¢∆Vg@¢ÚÚ6∆ñ6≤“&ñ÷'í7Fñˆ‚¬&ñváB6∆ñ6≤“6V6ˆÊF'í7Fñˆ‚‡¢ñbÜó4FW6∑F˜í∞¢Fá&VT6ˆÁFñÊW"ÊFDWfVÁD∆ó7FVÊW"Çv6ˆÁFWáF÷VÁRr¬ÜRí”‚RÁ&WfVÁDFVfV«BÇíì∞¢Fá&VT6ˆÁFñÊW"ÊFDWfVÁD∆ó7FVÊW"ÇwˆñÁFW&F˜v‚r¬ÜRí”‚∞¢ñbÜ÷VÁT˜V‚«¬f&‘VFóD÷ˆFR«¬RÁ6ÜñgD∂Wíí&WGW&„∞¢ñbÜ7FófUFˆˆ¬””“wvVˆ‚rbbvñÊF˜r‰6ˆ÷&CÚÊñÁWBí∞¢ñbÜRÊ'WGFˆ‚””“í≤7Fñˆ‰ÜV∆DF˜v‚“G'VS≤vñÊF˜r‰6ˆ÷&BÊñÁWBÁ&W757F'BÉì≤–¢V«6RñbÜRÊ'WGFˆ‚””“"í≤vñÊF˜r‰6ˆ÷&BÊñÁWBÁ&W757F'BÉ"ì≤–¢&WGW&„∞¢–¢ñbÜRÊ'WGFˆ‚””“í∞¢7Fñˆ‰ÜV∆DF˜v‚“G'VS∞¢W6T7FófT7Fñˆ‚Çì∞¢“V«6RñbÜRÊ'WGFˆ‚””“"í∞¢6ˆÁ7B'FÁ2“6ˆ◊WFT7Fñˆ‰'WGFˆÁ2Çì∞¢6ˆÁ7B6V6ˆÊB“'FÁ2ÊfñÊBÇÜ"¬íí”‚í‚bb"Ê∆∆˜vVBì∞¢ñbá6V6ˆÊBí≤7FófT7Fñˆ‚“6V6ˆÊBÊ7Fñˆ„≤W6T7FófT7Fñˆ‚Çì≤–¢–¢“ì∞¢–¢vñÊF˜rÊFDWfVÁD∆ó7FVÊW"ÇwˆñÁFW'Wr¬ÜRí”‚∞¢ñbÜRÁˆñÁFW%GóR”“v÷˜W6Rrí&WGW&„∞¢ñbÜ7FófUFˆˆ¬””“wvVˆ‚rbbvñÊF˜r‰6ˆ÷&CÚÊñÁWBí∞¢ñbÜRÊ'WGFˆ‚””“í≤7Fñˆ‰ÜV∆DF˜v‚“f«6S≤vñÊF˜r‰6ˆ÷&BÊñÁWBÁ&W74VÊBÉì≤–¢V«6RñbÜRÊ'WGFˆ‚””“"í≤vñÊF˜r‰6ˆ÷&BÊñÁWBÁ&W74VÊBÉ"ì≤–¢&WGW&„∞¢–¢ñbÜRÊ'WGFˆ‚””“í7Fñˆ‰ÜV∆DF˜v‚“f«6S∞¢“ì∞†¢ÚÚ÷˜W6R÷∆ˆˆ≥¢&ñ67B7W'6˜"ˆÁFÚw&˜VÊB∆ÊRFÚvWBv˜&∆B˜6óFñˆ‡¢ñbÜó4FW6∑F˜í∞¢Fá&VT6ˆÁFñÊW"ÊFDWfVÁD∆ó7FVÊW"Çv÷˜W6V÷˜fRr¬ÜRí”‚∞¢ñbÜgW&ÊóGW&U∆6V÷VÁD&÷VD∂Wí«¬gW&ÊóGW&T÷˜fT&÷VDñBí&WGW&„∞¢ÚÚvÜñ∆RFÜRóÜV¬&ˆ&Ró2&÷VB¬÷˜W6R÷˜fV÷VÁB6Ü˜V∆BˆÊ«íWfW ¢ÚÚ÷˜fRFÜR7W'6˜"F˜v&BFÜRF&vWBóÜV¬(	BÊ˜B&˜FFRFÜR6÷W&¢ÚÚÖ6ÜñgB∂G&r¬&V∆˜rí˜"7ñ‚FÜR6Ü&7FW"w2f6ñÊrfñ÷˜W6R–¢ÚÚ∆ˆˆ≤ávÜñ6ÇG&w2v«VVB6Ü˜V∆FW"WB∆ˆÊrvóFÇóBí¬VóFÜW"ˆ`¢ÚÚvÜñ6Çv˜V∆B6ÜñgBFÜRfW'íFÜñÊr&VñÊrñ÷VBB÷ñB÷&ˆ6Ç‡¢ñbávñÊF˜rÂóÜV≈&ˆ&SÚÊ&÷VBí&WGW&„∞¢ñbÜRÁ6ÜñgD∂Wíbb6÷W&G&t∆∆˜vVBÇíí∞¢6ˆÁ7B6fr“FW6∑F˜6ˆÁG&ˆ«46ˆÊfñrÇì∞¢6ˆÁ7BFVuW%Ç“ÁV÷&W"Êó4fñÊóFRÑÁV÷&W"Ü6frÊ6÷W&&˜FFTFVuW%ÇííÚÁV÷&W"Ü6frÊ6÷W&&˜FFTFVuW%Çí¢„S∞¢6ˆÁ7B6∆◊FVr“ÁV÷&W"Êó4fñÊóFRÑÁV÷&W"Ü6frÊ6÷W&&˜FFT6∆◊FVrííÚÁV÷&W"Ü6frÊ6÷W&&˜FFT6∆◊FVrí¢CS∞¢6÷W&¶ñ◊WFÑˆfg6WDFVr“g&VU&˜FFT6÷W&7FófRÇê¢Úw&¶ñ◊WFÑFVrÜ6÷W&¶ñ◊WFÑˆfg6WDFVr“RÊ÷˜fV÷VÁEÇ¢FVuW%Çê¢¢6∆◊Ü6÷W&¶ñ◊WFÑˆfg6WDFVr“RÊ÷˜fV÷VÁEÇ¢FVuW%Ç¬÷6∆◊FVr¬6∆◊FVrì∞¢6÷W&Êv∆Tˆfg6WDFVr“6∆◊Ü6÷W&Êv∆Tˆfg6WDFVr≤RÊ÷˜fV÷VÁEí¢FVuW%Ç¬÷6∆◊FVr¬6∆◊FVrì∞¢WFFT6÷W&˜6óFñˆ‚Çì∞¢&WGW&„∞¢–†¢ñbÜ6÷W&G&uˆñÁFW$ñB”“ÁV∆¬«¬RÁ6ÜñgD∂Wíí&WGW&„≤ÚÚ6ÜñgB∂÷˜W6R÷˜fV÷VÁBó2&˜FFñÊrFÜR6÷W&¬Ê˜Bñ÷ñÊp¢6ˆÁ7B&V7B“Fá&VT6ˆÁFñÊW"ÊvWD&˜VÊFñÊt6∆ñVÁE&V7BÇì∞¢ˆ÷˜W6T‰D2ÁÇ“ÇÜRÊ6∆ñVÁEÇ“&V7BÊ∆VgBíÚ&V7BÁvñGFÇí¢"“∞¢ˆ÷˜W6T‰D2Áí““ÇÜRÊ6∆ñVÁEí“&V7BÁF˜íÚ&V7BÊÜVñváBí¢"≤∞¢˜&ñ67FW"Á6WDg&ˆ‘6÷W&Öˆ÷˜W6T‰D2¬6÷W&ì∞¢ÚÚDÖ$TRÂ∆ÊRw26ˆÁ7FÁBó2÷Fó7FÊ6R÷g&ˆ“÷˜&ñvñ‚∆ˆÊróG2Ê˜&÷¬(	@¢ÚÚf˜"FÜRÉ√√íÊ˜&÷¬ÜW&RFÜBw26ñ◊«í÷w&˜VÊEí¬6ÚFÜR∆ÊP¢ÚÚ76W2Fá&˜VvÇFÜR∆ñW"w27GV¬7W'&VÁBÜVñváBÜV∆WeFñW"÷v&P¢ÚÚfñ˜∆ñW$w&˜VÊEííñÁ7FVBˆb«vó26óGFñÊrBv˜&∆Bì”‡¢ˆw&˜VÊE∆ÊRÊ6ˆÁ7FÁB“’˜∆ñW$w&˜VÊEíÇì∞¢ñbÖ˜&ñ67FW"Á&íÊñÁFW'6V7E∆ÊRÖˆw&˜VÊE∆ÊR¬ˆ÷˜W6Uv˜&∆Bíí∞¢6ˆÁ7BGÇ“ˆ÷˜W6Uv˜&∆BÁÇ“∆ñW"ÁÇÚDîƒS∞¢6ˆÁ7BG¢“ˆ÷˜W6Uv˜&∆BÁ¢“∆ñW"ÁíÚDîƒS∞¢ñbÑ÷FÇÊáó˜BÜGÇ¬G¢í‚„2í∞¢ÚÚF„"ñ‚Fá&VRÊß2Ö£¢Êv∆Rg&ˆ“µÇÜó2¬'WBv÷RW6W2’£÷Ê˜'FÄ¢÷˜W6T∆ˆˆ¥Êv∆R“÷FÇÊF„"ÜG¢¬GÇì∞¢F&vWDñ‘Êv∆R“÷˜W6T∆ˆˆ¥Êv∆S∞¢÷˜W6T∆ˆˆ¥7FófR“G'VS∞¢∆7D÷˜W6T÷˜fUFñ÷R“W&f˜&÷Ê6RÊÊ˜rÇì∞¢–¢–¢“ì∞¢–¢ÚÚ)H)HgW&ÊóGW&R∆6W"ˆñÁFW"ÜÊF∆W")H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢ÚÚ6∆ñ6≤◊FÚ◊∆6R¬6÷RñÁFW&7Fñˆ‚÷ˆFV¬2FÜRf&“VFóF˜"w2˜v‡¢ÚÚ''W6Ç&V∆˜ráFFñ∆R¬óB∆ñW2ñ÷÷VFñFV«íí&FÜW"FÜ‚FÜP¢ÚÚÜ˜F&"w2&WVóóFV“¬ñ“&WFñ6∆R¬ñÁFW&7B"f∆˜r(	B6ÜV6∂VBfó'7@¢ÚÚ6Ú‚&÷VBgW&ÊóGW&R∆6V÷VÁB«vó2vñÁ2˜fW"FÜRÜFWb÷÷ˆFR–¢ÚÚˆÊ«í¬6Ú&&V«í6ñ◊V«FÊV˜W6«í7FófRíf&“VFóF˜"''W6Ç‡¢gVÊ7Fñˆ‚gW&ÊóGW&U∆6V÷VÁEˆñÁFW$&÷VBÇí∞¢&WGW&‚ÜgW&ÊóGW&U∆6V÷VÁD&÷VD∂Wí«¬gW&ÊóGW&T÷˜fT&÷VDñBê¢bbÜ7W'&VÁD&V””“vf&“r«¬7W'&VÁD&V””“vñÁFW&ñ˜"rì∞¢–¢Fá&VT6ˆÁFñÊW"ÊFDWfVÁD∆ó7FVÊW"ÇwˆñÁFW&F˜v‚r¬ÜRí”‚∞¢ñbÇgW&ÊóGW&U∆6V÷VÁEˆñÁFW$&÷VBÇíí&WGW&„∞¢RÁ&WfVÁDFVfV«BÇì∞¢RÁ7F˜ñ÷÷VFñFU&˜vFñˆ‚Çì∞¢gW&ÊóGW&U∆6V÷VÁEˆñÁFW$ñB“RÁˆñÁFW$ñC∞¢G'í≤Fá&VT6ˆÁFñÊW"Á6WEˆñÁFW$6GW&SÚ‚ÜRÁˆñÁFW$ñBì≤“6F6ÇÖˆW'"í≤Ú¢&WfñWr7Fñ∆¬fˆ∆∆˜w2vóFÜ˜WB6GW&R¢Ú–¢6ˆÁ7BFñ∆R“˜67&VVÂFÙ7FófUFñ∆RÜRÊ6∆ñVÁEÇ¬RÊ6∆ñVÁEíì∞¢ñbáFñ∆Rí6Ü˜tgW&ÊóGW&U∆6V÷VÁDvÜ˜7BáFñ∆RÊ6ˆ¬¬Fñ∆RÁ&˜rì∞¢“¬≤6GW&S¢G'VR“ì∞¢Fá&VT6ˆÁFñÊW"ÊFDWfVÁD∆ó7FVÊW"ÇwˆñÁFW&÷˜fRr¬ÜRí”‚∞¢ñbÇgW&ÊóGW&U∆6V÷VÁEˆñÁFW$&÷VBÇíí&WGW&„∞¢ñbÜRÁˆñÁFW%GóR”“v÷˜W6RrbbRÁˆñÁFW$ñB”“gW&ÊóGW&U∆6V÷VÁEˆñÁFW$ñBí&WGW&„∞¢RÁ&WfVÁDFVfV«BÇì∞¢6ˆÁ7BFñ∆R“˜67&VVÂFÙ7FófUFñ∆RÜRÊ6∆ñVÁEÇ¬RÊ6∆ñVÁEíì∞¢ñbáFñ∆Rí6Ü˜tgW&ÊóGW&U∆6V÷VÁDvÜ˜7BáFñ∆RÊ6ˆ¬¬Fñ∆RÁ&˜rì∞¢“¬≤6GW&S¢G'VR“ì∞¢gVÊ7Fñˆ‚6ˆ÷÷óDgW&ÊóGW&U∆6V÷VÁEˆñÁFW"ÜRí∞¢ñbÜRÁˆñÁFW$ñB”“gW&ÊóGW&U∆6V÷VÁEˆñÁFW$ñBí&WGW&„∞¢gW&ÊóGW&U∆6V÷VÁEˆñÁFW$ñB“ÁV∆√∞¢ñbÇgW&ÊóGW&U∆6V÷VÁEˆñÁFW$&÷VBÇí«¬gW&ÊóGW&U∆6V÷VÁDvÜ˜7Bí&WGW&„∞¢RÁ&WfVÁDFVfV«BÇì∞¢RÁ7F˜ñ÷÷VFñFU&˜vFñˆ‚Çì∞¢6ˆÁ7B≤6ˆ¬¬&˜r““gW&ÊóGW&U∆6V÷VÁDvÜ˜7C∞¢ñbÜgW&ÊóGW&T÷˜fT&÷VDñBí∞¢6ˆÁ7B&W7V«B“÷˜fTFV6˜&FófTgW&ÊóGW&RÜgW&ÊóGW&T÷˜fT&÷VDñB¬6ˆ¬¬&˜rì∞¢6Ü˜uFˆ7Bá&W7V«BÊ÷W76vR¬&W7V«BÊˆ≤ì∞¢ñbá&W7V«BÊˆ≤ígW&ÊóGW&T÷˜fT&÷VDñB“ÁV∆√∞¢“V«6R∞¢6ˆÁ7BóFV‘∂Wí“gW&ÊóGW&U∆6V÷VÁD&÷VD∂Wì∞¢6ˆÁ7BFV6˜$∂Wí“vWDFV6˜&FófTgW&ÊóGW&T∂Wî'îóFV‘∂WíÜóFV‘∂Wíì∞¢6ˆÁ7B&ˆ6W76ñÊt∂Wí“7W'&VÁD&V””“vf&“rÚvWDgW&ÊóGW&T∂Wî'îóFV‘∂WíÜóFV‘∂Wíí¢ÁV∆√∞¢6ˆÁ7B&W7V«B“FV6˜$∂Wê¢Ú∆6TFV6˜&FófTgW&ÊóGW&RÜ6ˆ¬¬&˜r¬FV6˜$∂Wíê¢¢&ˆ6W76ñÊt∂Wê¢Ú∆6U&ˆ6W76ñÊtgW&ÊóGW&RÜ6ˆ¬¬&˜r¬&ˆ6W76ñÊt∂Wíê¢¢≤ˆ≥¢f«6R¬÷W76vS¢tgW&ÊóGW&RÊ˜Bf˜VÊB‚r”∞¢6Ü˜uFˆ7Bá&W7V«BÊ÷W76vR¬&W7V«BÊˆ≤ì∞¢vñÊF˜rÂıˆf&‘∆ˆsÚ‚Ü∂gW&ÊóGW&R◊∆6W%“G∑&W7V«BÊˆ≤Úw∆6VBr¢v&∆ˆ6∂VBw“G∂FV6˜$∂Wí«¬&ˆ6W76ñÊt∂Wí«¬óFV‘∂Wó“BG∂7W'&VÁD&V“ÇG∂6ˆ«“¬G∑&˜w“ì¢G∑&W7V«BÊ÷W76vW÷¬&W7V«BÊˆ≤ÚvñÊfÚr¢wv&‚rì∞¢ñbá&W7V«BÊˆ≤bb&ˆ6W76ñÊt∂Wíí∞¢&Vg&W6ÑóFV’67&ˆ∆¬Çì∞¢6fTf&‘∆ñ˜WBÇì∞¢6fT÷V÷&W%v˜&∆DFFÇì∞¢–¢ñbá&W7V«BÊˆ≤bbÜñÁfVÁF˜'ï∂óFV‘∂Wï“«¬í√“ígW&ÊóGW&U∆6V÷VÁD&÷VD∂Wí“ÁV∆√∞¢–¢6∆V$gW&ÊóGW&U∆6V÷VÁDvÜ˜7BÇì∞¢vñÊF˜r‰gW&ÊóGW&U∆6W#ÚÁ&VÊFW"Çì∞¢–¢vñÊF˜rÊFDWfVÁD∆ó7FVÊW"ÇwˆñÁFW'Wr¬6ˆ÷÷óDgW&ÊóGW&U∆6V÷VÁEˆñÁFW"¬≤6GW&S¢G'VR“ì∞¢vñÊF˜rÊFDWfVÁD∆ó7FVÊW"ÇwˆñÁFW&6Ê6V¬r¬ÜRí”‚∞¢ñbÜRÁˆñÁFW$ñB”“gW&ÊóGW&U∆6V÷VÁEˆñÁFW$ñBí&WGW&„∞¢gW&ÊóGW&U∆6V÷VÁEˆñÁFW$ñB“ÁV∆√∞¢6∆V$gW&ÊóGW&U∆6V÷VÁDvÜ˜7BÇì∞¢“¬≤6GW&S¢G'VR“ì∞†¢ÚÚ)H)Hf&“VFóF˜"ˆñÁFW"ÜÊF∆W'2)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢Fá&VT6ˆÁFñÊW"ÊFDWfVÁD∆ó7FVÊW"ÇwˆñÁFW&F˜v‚r¬ÜRí”‚∞¢ñbÜgW&ÊóGW&U∆6V÷VÁD&÷VD∂Wí«¬gW&ÊóGW&T÷˜fT&÷VDñB«¬f&‘VFóD÷ˆFR«¬7W'&VÁD&V”“vf&“rí&WGW&„∞¢RÁ7F˜&˜vFñˆ‚Çì∞¢ˆVFóF˜%ñÁFñÊr“G'VS∞¢6ˆÁ7BB“˜67&VVÂFÙf&’Fñ∆RÜRÊ6∆ñVÁEÇ¬RÊ6∆ñVÁEíì∞¢ñbáBí«îf&‘VFóD''W6ÇáBÊ6ˆ¬¬BÁ&˜rì∞¢“ì∞¢Fá&VT6ˆÁFñÊW"ÊFDWfVÁD∆ó7FVÊW"ÇwˆñÁFW&÷˜fRr¬ÜRí”‚∞¢ñbÜgW&ÊóGW&U∆6V÷VÁD&÷VD∂Wí«¬gW&ÊóGW&T÷˜fT&÷VDñB«¬f&‘VFóD÷ˆFR«¬7W'&VÁD&V”“vf&“r«¬ˆVFóF˜%ñÁFñÊrí&WGW&„∞¢RÁ7F˜&˜vFñˆ‚Çì∞¢6ˆÁ7BB“˜67&VVÂFÙf&’Fñ∆RÜRÊ6∆ñVÁEÇ¬RÊ6∆ñVÁEíì∞¢ñbáBí«îf&‘VFóD''W6ÇáBÊ6ˆ¬¬BÁ&˜rì∞¢“ì∞¢vñÊF˜rÊFDWfVÁD∆ó7FVÊW"ÇwˆñÁFW'Wr¬Çí”‚≤ˆVFóF˜%ñÁFñÊr“f«6S≤“ì∞†¢ÚÚWá˜6Rf&“VFóF˜"FÚFÜRÖD‘¬ÊV¬'WGFˆÁ0¢vñÊF˜rÂˆf&‘VFóF˜"“∞¢Fˆvv∆S¢Fˆvv∆Tf&‘VFóD÷ˆFR¿¢6WD''W6É¢f&‘VFóF˜%6WD''W6Ç¿¢6fS¢6fTf&‘∆ñ˜WB¿¢6∆V$∆ñ˜WC¢Çí”‚∞¢G'í≤∆ˆ6≈7F˜&vRÁ&V÷˜fTóFV“Üf&‘∆ñ˜WD∂WíÇíì≤“6F6Ç∑–¢6Ü˜uFˆ7BÇu6fVB∆ñ˜WB6∆V&VB‚&W6WBFÜRf&“FÚ«í‚r¬G'VRì∞¢“¿¢”∞†¢ÚÚˆFWgFˆˆ«2Üˆˆ≤f˜"FÜRgW&ÊóGW&R∆6V÷VÁB≤6óGFñÊr7ó7FV◊2¿¢ÚÚ÷ó'&˜&ñÊrvñÊF˜rÂˆFWe7vÊW"ıˆf&‘VFóF˜"&˜fR(	BÊÚñ‚÷v÷RTíFÄ¢ÚÚFÚw&ÁBgW&ÊóGW&RóFV◊2Fó&V7F«í¬6ÚFÜó2WÜó7G2f˜"ÜVF∆W72¢ÚÚ6ˆÁ6ˆ∆RFW7FñÊr&FÜW"FÜ‚2∆ñW"÷f6ñÊr6ÜVB‡¢vñÊF˜rÂıˆÜˆ'VÊ¶îgW&ÊóGW&TFV'Vr“∞¢vófS¢ÜóFV‘∂Wí¬‚“í”‚≤ñÁfVÁF˜'ï∂óFV‘∂Wï““ÜñÁfVÁF˜'ï∂óFV‘∂Wï“«¬í≤„≤“¿¢∆6S¢∆6TFV6˜&FófTgW&ÊóGW&R¿¢6óC¢&VvñÂ6óDñÁFW&7Fñˆ‚¿¢VÊE6óC¢VÊE6óDñÁFW&7Fñˆ‚¿¢vWB6óE7FFRÇí≤&WGW&‚6óDñÁFW&7Fñˆ„≤“¿¢vWB∆ñW%7FFRÇí≤&WGW&‚≤É¢∆ñW"ÁÇ¬ì¢∆ñW"Áí¬Êv∆S¢∆ñW"ÊÊv∆R”≤“¿¢vWB6’7FFRÇí≤&WGW&‚≤÷ˆFS¢7FófT6÷W&÷ˆFR¬¶ñ◊WFÑˆfg6WDFVs¢6÷W&¶ñ◊WFÑˆfg6WDFVr¬˜6óFñˆ„¢≤É¢6÷W&Á˜6óFñˆ‚ÁÇ¬ì¢6÷W&Á˜6óFñˆ‚Áí¬£¢6÷W&Á˜6óFñˆ‚Á¢“”≤“¿¢v˜&∆Dˆ&¶V7DC¢vWEv˜&∆Dˆ&¶V7DB¿¢f&’v˜&∆Dˆ&¶V7DC¢Ü6ˆ¬¬&˜rí”‚v˜&∆Dˆ&¶V7G2ÊvWBÜ6ˆ¬≤r¬r≤&˜rí¿¢7Fñˆ‰'WGFˆÁ3¢Çí”‚6ˆ◊WFT7Fñˆ‰'WGFˆÁ2Çí¿¢Á57FFñˆ„¢ÜñBí”‚Á57FFñˆÁ4'îñBÊvWBÜñBí¿¢Á57FFñˆ‰6˜VÁC¢Çí”‚Á57FFñˆÁ4'îñBÁ6ó¶R¿¢∆6U&ˆ6W76ñÊs¢∆6U&ˆ6W76ñÊtgW&ÊóGW&R¿¢Fñ6µv˜&∆Dˆ&¶V7EfgÉ¢Ü6ˆ¬¬&˜r¬GBí”‚≤6ˆÁ7BÚ“vWEv˜&∆Dˆ&¶V7DBÜ6ˆ¬¬&˜rì≤ñbÜÛÚÁWFFRíÚÁWFFRÜGBì≤&WGW&‚ÚÚ≤Ü5WFFS¢ÚÁWFFR“¢ÁV∆√≤“¿¢∆ˆEv˜&∆D∆ófW7Fˆ6≥¢Çí”‚ˆ∆ˆEv˜&∆D∆ófW7Fˆ6≤Çí¿¢6fUv˜&∆D∆ófW7Fˆ6≥¢Ü∆ó7Bí”‚˜6fUv˜&∆D∆ófW7Fˆ6≤Ü∆ó7Bí¿¢76ñvÂfC¢vñÊF˜r‰FWufG2Ê76ñvÂFıfB¿¢VÊ76ñvÂfC¢vñÊF˜r‰FWufG2ÁVÊ76ñv‰g&ˆ’fB¿¢Fñ6¥∆ófW7Fˆ6≥¢vñÊF˜r‰f&‘Êñ÷«2ÁFñ6µ&W6˜W&6W2¿¢vWDñÁfVÁF˜'ì¢Çí”‚á≤‚‚ÊñÁfVÁF˜'í“í¿¢∆ˆD'Vñ∆FñÊu66VÊS¢Ü÷ñBí”‚∆ˆD'Vñ∆FñÊu66VÊRÜ÷ñBí¿¢'Vñ∆FñÊtñÁFW&7F&∆TC¢Ü÷ñB¬6ˆ¬¬&˜rí”‚ˆ'Vñ∆FñÊtñÁFW&7F&∆W2ÊvWBÜ÷ñB≤r¬r≤6ˆ¬≤r¬r≤&˜rí¿¢'Vñ∆FñÊtñÁFW&7F&∆T6˜VÁC¢Çí”‚ˆ'Vñ∆FñÊtñÁFW&7F&∆W2Á6ó¶R¿¢&VÊFW$f&’&ˆ6W76˜'3¢Çí”‚vñÊF˜r‰f&’ÊV¬Á&VÊFW$f&’&ˆ6W76˜'2Çí¿¢VÁFW$ñÁFW&ñ˜#¢áñV6TñBí”‚VÁFW$ñÁFW&ñ˜"áñV6TñBí¿¢WÜóDñÁFW&ñ˜#¢Çí”‚WÜóDñÁFW&ñ˜"Çí¿¢vWD7W'&VÁD&V¢Çí”‚7W'&VÁD&V¿¢ñÁFW&ñ˜$gW&ÊóGW&Tˆ&¶V7G3¢Çí”‚ñÁFW&ñ˜$gW&ÊóGW&Tˆ&¶V7G2¿¢∆ˆEv˜&∆E7F˜&vS¢Çí”‚ˆ∆ˆEv˜&∆E7F˜&vRÇí¿¢6WE6Ü˜t∆Vt&ˆÊW3¢ábí”‚vñÊF˜rÂ&ˆ6VGW&ƒ∆VtÊñ÷Fñˆ„ÚÁ6WE6Ü˜t&ˆÊW2ábí¿¢vWB6Ü˜t∆Vt&ˆÊW2Çí≤&WGW&‚vñÊF˜rÂ&ˆ6VGW&ƒ∆VtÊñ÷Fñˆ„ÚÁ6Ü˜t&ˆÊW3≤“¿¢vWB6óDñÁFW&7Fñˆ‚Çí≤&WGW&‚6óDñÁFW&7Fñˆ„≤“¿¢∆ñW$∆Vw5&Vc¢Çí”‚∆ñW$∆Vw2¿¢vWBFWFÑ˜WF∆ñÊW56WGFñÊrÇí≤&WGW&‚5ˆFWFÑ˜WF∆ñÊW3≤“¿¢vWB˜WF∆ñÊW56WGFñÊrÇí≤&WGW&‚5ˆ˜WF∆ñÊW3≤“¿¢vWB∆ñW$ÊV6¥¶ˆñÁE&˜EíÇí≤&WGW&‚∆ñW$ÊV6¥¶ˆñÁBÚ∆ñW$ÊV6¥¶ˆñÁBÁ&˜FFñˆ‚Áí¢ÁV∆√≤“¿¢vWB∆ñW$÷W6Ö&˜EíÇí≤&WGW&‚∆ñW$÷W6ÇÁ&˜FFñˆ‚Áì≤“¿¢vWB7FófT6÷W&¶ñ◊WFÑFVrÇí≤&WGW&‚7FófT6÷W&¶ñ◊WFÖ&BÇí¢ÉÚ÷FÇÂì≤“¿¢7W'&VÁD&Vˆ66«W6ñˆ‰÷W6Ñ6˜VÁC¢Çí”‚7W'&VÁD&Vˆ66«W6ñˆ‰÷W6ÜW2ÇíÊ∆VÊwFÇ¿¢VÁFW%¶ˆÊTFV'Vs¢Ü÷ñB¬6ˆ¬¬&˜rí”‚VÁFW%¶ˆÊRÜ÷ñB¬6ˆ¬¬&˜rí¿¢6WD˜WF∆ñÊW3¢ábí”‚≤5ˆ˜WF∆ñÊW2“c≤“¿¢∆ñW$ÊV6µóf˜DñÊfÛ¢Çí”‚∞¢∆WBfF$w&˜W“ÁV∆√∞¢∆ñW$÷W6ÇÁG&fW'6RÜÚ”‚≤ñbÜÚÊÊ÷R””“w∆ñW%ˆfF"rífF$w&˜W“Û≤“ì∞¢6ˆÁ7B&ñr“fF$w&˜WÚÁW6W$FFÚÊÊV6µ&ñs∞¢&WGW&‚&ñrÚ∞¢fñ∆&∆S¢&ñrÊfñ∆&∆R¿¢ÊV6¥∆ˆ6√¢&ñrÊÊV6¥∆ˆ6¬¿¢óf˜EÉ¢&ñrÁóf˜EÇ¿¢÷ˆFVƒÜVñváC¢fF$w&˜WÁW6W$FFÚÁ˜'G&óD÷ˆFVƒÜVñváB¿¢÷ˆFV≈vñGFÉ¢fF$w&˜WÁW6W$FFÚÁ˜'G&óD÷ˆFV≈vñGFÇ¿¢“¢ÁV∆√∞¢“¿¢fñÊDFWuñ∆UFñ∆W3¢Çí”‚∞¢6ˆÁ7Bf˜VÊB“µ”∞¢f˜"Ü∆WB"“≤"¬$ıu3≤"≤≤íf˜"Ü∆WB2“≤2¬4Ù≈3≤2≤≤íñbÜw&ñE∑%”ÚÂ∂5”ÚÊFWuñ∆Ríf˜VÊBÁW6Çá≤2¬"¬6ˆ∆˜#¢w&ñE∑%’∂5“ÊFWuñ∆R“ì∞¢&WGW&‚f˜VÊC∞¢“¿¢7W'&VÁD&V¢Çí”‚7W'&VÁD&V¿¢”∞†¢vñÊF˜rÊFDWfVÁD∆ó7FVÊW"Çw&W6ó¶Rr¬Çí”‚≤fóEFÙ7V7BÇì≤&W6ó¶T6Áf2Çì≤WFFT6÷W&˜6óFñˆ‚Çì≤ñbÜ÷VÁT˜V‚íVFóDñÁfVÁF˜'ï6ó¶ñÊrÇì≤“ì∞¢ÚÚ6fWGíÊWBf˜"ÁíñÁfVÁF˜'í˜6≤6ÜÊvRÊ˜B«&VGí6˜fW&VB'í‡¢ÚÚWá∆ñ6óB6fT÷V÷&W%v˜&∆DFFÇí6∆¬&˜fR‚«6Úf«W6ÜW2FÜP¢ÚÚñ‚◊&ˆw&W72Fñ÷R÷ˆb÷FíÜGfÊ6TFí˜6∆VWñ‰&VB«&VGí6fRˆ‚FÜVó ¢ÚÚ˜v‚Fí&ˆ∆∆˜fW'2¬'WBFÜó26F6ÜW2vÜFWfW"Fñ÷S&ˆw&W70¢ÚÚÜVÊVB6ñÊ6RFÜR∆7BˆÊR¬6Ú6∆˜6ñÊr÷ñB÷gFW&Êˆˆ‚FˆW6‚wB&ˆ∆¿¢ÚÚ&6≤FÚFÜB÷˜&ÊñÊrÊWáB6W76ñˆ‚í‡¢vñÊF˜rÊFDWfVÁD∆ó7FVÊW"Çv&Vf˜&WVÊ∆ˆBr¬Çí”‚≤G'í≤6fT÷V÷&W%v˜&∆DFFÇì≤˜6fUv˜&∆D6∆VÊF"Çì≤“6F6Ç∑““ì∞†¢vñÊF˜r‰Fñ∆ˆwVT6ˆÁFVÁCÚÊñÊóBá∞¢6∆VÊF"¿¢vWD7W'&VÁD&V¢Çí”‚7W'&VÁD&V¿¢vWE∆ñW$FF¢Çí”‚˜∆ñW$FF¿¢vWDFñ∆ˆwVT˜V„¢Çí”‚Fñ∆ˆwVT˜V‚¿¢vWDFñ∆ˆwVUv∆∂W#¢Çí”‚ˆFñ∆ˆwVUv∆∂W"¿¢vWEv&W5ˆˆ«3¢Çí”‚t$U5ıÙÙ≈2¿¢7W'&VÁEvVV∂FîÊ÷S¢vñÊF˜r‰6∆VÊF%7ó7FV“Ê7W'&VÁEvVV∂FîÊ÷R¿¢7W'&VÁE6V6ˆ„¢vñÊF˜r‰6∆VÊF%7ó7FV“Ê7W'&VÁE6V6ˆ‚¿¢fó6ÜñÊuFñ÷TˆdFì¢Çí”‚vñÊF˜r‰fó6ÜñÊrÁFñ÷TˆdFíÇí¿¢Ê˜&÷∆ó¶U7FFñˆ‰∆&V¬¿¢6‰66W746ˆÁFVÁB¿¢6WEVW7E7FGW2¿¢GW&‰ñÂF6≥¢vñÊF˜rÂ&ˆ6VGW&≈F6∑2ÁGW&‰ñÂF6≤¿¢6Ü˜uFˆ7B¿¢˜V‰÷VÁR¿¢6∆˜6TÁ4Fñ∆ˆwVR¿¢vWD7WG66VÊU&WfñWt7FófS¢Çí”‚7WG66VÊU&WfñWt7FófR¿¢vWD7WG66VÊU&WfñWtGfÊ6S¢Çí”‚7WG66VÊU&WfñWtGfÊ6R¿¢“ì∞†¢vñÊF˜rÂóÜV≈&ˆ&SÚÊñÊóBá∞¢&VÊFW&W"¿¢6÷W&¿¢∆ñW$÷W6Ç¿¢6ˆ◊Êñˆ‰ˆ&¶V7G2¿¢Á5v∆∂W'2¿¢∆ñW"¿¢vWD7FófU66VÊR¿¢vWD7W'&VÁD&V¢Çí”‚7W'&VÁD&V¿¢vWE∆ñW$FF¢Çí”‚˜∆ñW$FF¿¢vWE∆ñW$∆Vw3¢Çí”‚∆ñW$∆Vw2¿¢vWEWD∆ñW&ñÊuWC¢Çí”‚˜WD∆ñW&ñÊuWB¿¢vWEWD∆ñW&ñÊt7FófS¢Çí”‚˜WD∆ñW&ñÊt7FófR¿¢vWE∆ñW$fF$g&ˆÁD÷FW&ñ√¢Çí”‚˜∆ñW$fF$g&ˆÁD÷FW&ñ¬¿¢vWE6óDñÁFW&7Fñˆ„¢Çí”‚6óDñÁFW&7Fñˆ‚¿¢vWE6VFVD6÷W&FV'Vs¢Çí”‚˜6VFVD6÷W&FV'Vr¿¢vWEW6VC¢Çí”‚W6VB¿¢4ÑıTƒDU%ıUEıƒ‰Uı$T‰DU%Ùı$DU"¿¢∆ñW$GF6Ü÷VÁDÊ6Ü˜"¿¢7&VGW&TGF6Ü÷VÁDÊ6Ü˜"¿¢˜V‰÷VÁR¿¢6∆˜6T÷VÁR¿¢6Ü˜uFˆ7B¿¢“ì∞†¢vñÊF˜r‰◊W6ñ3ÚÊñÊóBá∞¢6∆VÊF"¿¢∆ñW"¿¢DîƒR¿¢6∆◊¿¢FV'Vt∆ˆr¿¢vWD7W'&VÁD&V¢Çí”‚7W'&VÁD&V¿¢vWEW6VC¢Çí”‚W6VB¿¢vWDv÷U7F'FVC¢Çí”‚v÷U7F'FVB¿¢vWDÜ˜W#¢vñÊF˜r‰6∆VÊF%7ó7FV“ÊvWDÜ˜W"¿¢ó5∆ñW$ñ‰6ˆ÷&B¿¢‘ı$‰î‰uÙÑıU"¿¢vWEv˜&∑76T÷3¢Çí”‚˜v˜&∑76T÷2¿¢ˆó5¶ˆÊT&V¿¢ˆó4'Vñ∆FñÊt&V¿¢UÖDU$îı%ı§Ù‰U2¿¢“ì∞†¢vñÊF˜r‰VFñı7ó7FV”ÚÊñÊóBá∞¢Fñ∆UGóR¿¢DîƒR¿¢‘ÖıtDU"¿¢6∆◊¿¢∆ñW"¿¢vWD7W'&VÁD&V¢Çí”‚7W'&VÁD&V¿¢ˆó4'Vñ∆FñÊt&V¿¢Á4w&ñDf˜$&V¿¢ó5&Vƒ÷VFñW'&˜#¢Ç‚‚Êí”‚vñÊF˜r‰◊W6ñ3ÚÊó5&Vƒ÷VFñW'&˜"Ç‚‚Êí¿¢÷&¥VFñıW&ƒfñ∆VC¢Ç‚‚Êí”‚vñÊF˜r‰◊W6ñ3ÚÊ÷&¥VFñıW&ƒfñ∆VBÇ‚‚Êí¿¢VFñıW&ƒfñ∆VC¢Ç‚‚Êí”‚vñÊF˜r‰◊W6ñ3ÚÊVFñıW&ƒfñ∆VBÇ‚‚Êí¿¢“ì∞†¢vñÊF˜r‰6ˆ÷&CÚÊñÊóBá∞¢∆ñW"¿¢∆ñW'2¿¢DîƒR¿¢Ü˜7Fñ∆Tˆ&¶V7G2¿¢6ˆ◊Êñˆ‰ˆ&¶V7G2¿¢vWD7W'&VÁD&V¢Çí”‚7W'&VÁD&V¿¢ñ‰6ˆÊR¿¢F÷vT7&VGW&R¿¢F÷vU∆ñW"¿¢«î∂Êˆ6∂&6≤¿¢vVˆ‰&ñ∆óGí¿¢6ˆ÷&D6ˆÊfñr¿¢&W6ˆ«fUvVˆ‰ÜóB¿¢6∆V%fVvWFFñˆ‰ñ‰GF6¥6ˆÊR¿¢fñÊDWFıF&vWB¿¢6Â∆ñW$ˆ67Wí¿¢6‰ˆ67WîB¿¢6WD7&VGW&Tg&÷R¿¢vVÊ˜GóT∂ñÊDf˜#¢Ü2í”‚Ü2ÊvVÊ˜GóRÚávñÊF˜r‰7&VGW&TvVÊWFñ72Â5T4îU5Ùƒî5∂2Ê7&VGW&T∂Wï“«¬2Ê7&VGW&T∂Wíí¢ÁV∆¬í¿¢6Ü˜uFˆ7B¿¢G&ñvvW%vVˆÂ7vñÊufó7V¬¿¢G&ñvvW%vVˆ‰Üˆ∆Efó7V¬¿¢&V∆V6UvVˆÂ7vñÊtÜˆ∆B¿¢6Ê6V≈vVˆÂ7vñÊtÜˆ∆B¿¢&Vvñ‰6ˆ÷&D«VÊvR¿¢6WD6ˆ÷&E7vñÊt6ˆÊR¿¢7v‰'W'7DVffV7B¿¢∆î7&VGW&T&&≥¢Ç‚‚Êí”‚vñÊF˜r‰VFñı7ó7FV”ÚÁ∆î7&VGW&T&&≤Ç‚‚Êí¿¢∆î7&VGW&T6∆tÜóC¢Ç‚‚Êí”‚vñÊF˜r‰VFñı7ó7FV”ÚÁ∆î7&VGW&T6∆tÜóBÇ‚‚Êí¿¢∆ïvVˆÂ6∆6Ö6gÉ¢Ç‚‚Êí”‚vñÊF˜r‰VFñı7ó7FV”ÚÁ∆ïvVˆÂ6∆6Ö6gÇÇ‚‚Êí¿¢∆ïvVˆ‰ÜóE6gÉ¢Ç‚‚Êí”‚vñÊF˜r‰VFñı7ó7FV”ÚÁ∆ïvVˆ‰ÜóE6gÇÇ‚‚Êí¿¢ÚÚÊ÷VBÊñ÷¬GF6∑2ÜRÊr‚˜VÊ6Rí˜v‚FÜR7&VGW&Rw2˜6óFñˆ‡¢ÚÚFó&V7F«íf˜"FÜVó"∆VñÁ7FVBˆbvˆñÊrFá&˜VvÇ÷˜fT7&VGW&UF˜v&@¢ÚÚ(	BvóFÜ˜WBFÜó2¬FÜBw&˜VÊB6˜fW&VBGW&ñÊrFÜR∆VÊWfW"Fñ6∂V@¢ÚÚfˆ˜G7FWá6VR6ˆ÷&B÷Êñ÷¬÷GF6∑2Êß2w2˜VÊ6UWFFRí‡¢Fñ6¥7&VGW&Tfˆ˜G7FW2¿¢ÚÚ6÷RñFV2Fñ6¥7&VGW&Tfˆ˜G7FW2'WBf˜"FÜR6ˆ∆˜&VBˆÊñˆ‚◊&ñÊp¢ÚÚ«VÊvRG&ñ¬á6VR7v‰«VÊvUG&ñ≈7F◊í(	B˜VÊ6Rw2∆V76W2óG0¢ÚÚ˜v‚F÷uFr÷FW&ófVBff∆ñ7Fñˆ‰&ˆÁW6W26ñÊ6RóBÜ2ÊÚWw&FRG&VP¢ÚÚFÚ&VBg&ˆ“FÜRví∆ñW"GF6∑2FÚ‡¢Fñ6¥7&VGW&T«VÊvUG&ñ¬¿¢ÚÚvFW2WfW'ívVˆ‚FˆÜˆ∆B&ñ∆óGíá6VR6ˆ÷&B÷ñÁWBÊß2í(	BÊ¢ÚÚGF6∂ñÊrvÜñ∆R7vñ÷÷ñÊrñ‚&ófW"˜7G&V“¬∆ñW"˜"7&VGW&R‡¢ó5∆ñW%7vñ÷÷ñÊr¿¢ÚÚG&ófW2FÜR∆ˆF˜WBw26ˆ÷&Ú6∆˜BáFí(	BÊWfW"∆ñW"÷6Ü˜6V‚¿¢ÚÚ«vó2vÜñ6ÜWfW"6ˆ÷&Ú÷F6ÜW2FÜRWVóVBvVˆ‚w2˜v‚7vñÊp¢ÚÚ7Gñ∆Rá6VR6ˆ÷&B÷∆ˆF˜WBÊß2w26ˆ÷&Ù&ñ∆óGîñBÇíí‡¢7W'&VÁD6ˆ÷&Ù&ñ∆óGîñB¿¢ÚÚñ6∑2vÜñ6Çff∆ñ7Fñˆ‚÷˜Fñˆ‚f∆f˜"WfW'ívVˆ‚◊Fˆˆ¬&ñ∆óGê¢ÚÚˆffW'2á6VR6ˆ÷&B◊&ˆw&W76ñˆ‚Êß2í‡¢7W'&VÁEvVˆ‰F÷vUGóR¿¢vVˆ‰F÷vUGóTf˜%Fˆˆ¬¿¢ÚÚ∂Wó2FÜR∆ˆF˜WBw2W"◊vVˆ‚6∆˜B76ñvÊ÷VÁG2á6VP¢ÚÚ6ˆ÷&B÷∆ˆF˜WBÊß2í‡¢7W'&VÁEvVˆ‰∂Wí¿¢7W'&VÁEvVˆ‰∆&V¬¿¢ÚÚFˆˆ¬÷7FW'íÇ'G'W7GíÜR˜6Ü˜fV¬˜ñ6≤˜7V""ívFW2vÜñ6Çˆb¢ÚÚFˆˆ¬w2˜v‚WVóVB&ñ∆óFñW2rRWw&FR∆WfV«26‚&R6Ü˜6V„∞¢ÚÚ÷˜FW2ˆb&˜vW72íf˜"7GV∆«í÷∂ñÊrFÜB6Üˆñ6R(	B&˜FÇ6VP¢ÚÚ6ˆ÷&B◊&ˆw&W76ñˆ‚Êß2‡¢Fˆˆƒ÷7FW'î∆WfV¬¿¢v&EvVˆ‰÷7FW'ïá¿¢vWD÷˜FW4ˆe&˜vW72¿¢7VÊD÷˜FW4ˆe&˜vW72¿¢v&D÷˜FW4ˆe&˜vW72¿¢ÚÚvFW2FÜR∆ˆF˜WBvRw2FWb÷ˆÊ«í"≥÷˜FR"FW7B'WGFˆ‚á6VP¢ÚÚ6ˆ÷&B÷∆ˆF˜WB◊VíÊß2í(	B÷ó'&˜'2FÜR6÷R5ˆFWd÷ˆFRFˆvv∆RFÜP¢ÚÚvV"◊Fˆˆ¬óFV“ÊV¬w2"≥÷7FW'í"'WGFˆ‚W6W2‡¢ó4FWd÷ˆFS¢Çí”‚5ˆFWd÷ˆFR¿¢ÚÚfó&W2FÜRvVˆ‚Fˆˆ¬w2∆ñ‚7WB˜6∆6Ç7vñÊrWÜ7F«í2ó@¢ÚÚ&VÜfVB&Vf˜&RFÜR∆ˆF˜WB7ó7FV“WÜó7FVB(	BFÜRf∆∆&6∞¢ÚÚ6ˆ÷&B÷ñÁWBÊß2W6W2f˜"F6∆˜BVÁFñ¬‚&ñ∆óGí÷ˆGV∆P¢ÚÚ6∆ñ◊2óB‡¢fó&T∆Vv7ïvVˆ‰7Fñˆ„¢á6∆˜DñÊFWÇí”‚∞¢ñbÜ7FófUFˆˆ¬”“wvVˆ‚rí&WGW&„∞¢7FófT7Fñˆ‚“Fˆˆƒ7FñˆÁ2ÁvVˆÂ∑6∆˜DñÊFWÇ“”∞¢W6T7FófT7Fñˆ‚Çì∞¢“¿¢“ì∞†¢vñÊF˜r‰÷˜VÁG3ÚÊñÊóBá∞¢∆ñW"¿¢66VÊR¿¢6ˆ◊Êñˆ‰ˆ&¶V7G2¿¢vWE7F&∆S¢Çí”‚7F&∆R¿¢5$TEU$UÙD"¿¢ñÁWB¿¢'F‰6∆ƒ÷˜VÁB¿¢DîƒR¿¢ƒîU%ı$DïU2¿¢d4î‰uÙƒU%¿¢‘ıdUı5TTB¿¢44T¬¿¢DT4T¬¿¢‘ıU4UÙîDƒUÙ’2¿¢ó4FW6∑F˜¿¢&ÊB¿¢6∆◊¿¢Êv∆TFñfb¿¢6Â∆ñW$ˆ67Wí¿¢vWD∆6ÜV◊ï7VVD◊V√¢vñÊF˜r‰∆6ÜV◊ï7ó7FV“ÊvWE7VVD◊V¬¿¢vWD∂Wñ&ˆ&EfV7F˜"¿¢÷∂T7&VGW&TVÁFóGí¿¢FW7v‰7&VGW&R¿¢÷˜fT7&VGW&UF˜v&B¿¢WFFT7&VGW&T÷W6Ç¿¢WFFT7&VGW&TÊñ‘g&÷R¿¢Fñ∆U7W&f6Uîñ‰&V¿¢6Ü&7FW$w&˜VÊE6ÜF˜u7W&f6Tˆfg6WB¿¢vWD7FófU66VÊR¿¢vWD7FófTw&ñB¿¢vWD7FófT6ˆ«2¿¢vWD7FófU&˜w2¿¢ˆó5¶ˆÊT&V¿¢ˆó46fW&‰'Vñ∆FñÊt&V¿¢6Ü˜uFˆ7B¿¢vWD7W'&VÁD&V¢Çí”‚7W'&VÁD&V¿¢vWD7FófT÷˜VÁDñC¢Çí”‚7FófT÷˜VÁDñB¿¢vWDFWdv∆ˆ&≈7VVD◊V√¢Çí”‚FWdv∆ˆ&≈7VVD◊V¬¿¢vWDf6ñÊtÊv∆S¢Çí”‚f6ñÊtÊv∆R¿¢6WDf6ñÊtÊv∆S¢ábí”‚≤f6ñÊtÊv∆R“c≤“¿¢vWD÷˜W6T∆ˆˆ¥7FófS¢Çí”‚÷˜W6T∆ˆˆ¥7FófR¿¢6WD÷˜W6T∆ˆˆ¥7FófS¢ábí”‚≤÷˜W6T∆ˆˆ¥7FófR“c≤“¿¢vWD6ˆÁG&ˆ∆∆W$∆ˆˆ¥7FófS¢Çí”‚6ˆÁG&ˆ∆∆W$∆ˆˆ¥7FófR¿¢vWD6ˆÁG&ˆ∆∆W$∆ˆˆ¥Êv∆S¢Çí”‚6ˆÁG&ˆ∆∆W$∆ˆˆ¥Êv∆R¿¢vWD∆7D÷˜W6T÷˜fUFñ÷S¢Çí”‚∆7D÷˜W6T÷˜fUFñ÷R¿¢vWD÷˜W6T∆ˆˆ¥Êv∆S¢Çí”‚÷˜W6T∆ˆˆ¥Êv∆R¿¢“ì∞†¢vñÊF˜r‰fó6ÜñÊsÚÊñÊóBá∞¢6∆◊¿¢vWD7FófU66VÊR¿¢7W'&VÁE6V6ˆ„¢vñÊF˜r‰6∆VÊF%7ó7FV“Ê7W'&VÁE6V6ˆ‚¿¢vWDÜ˜W#¢vñÊF˜r‰6∆VÊF%7ó7FV“ÊvWDÜ˜W"¿¢dï4ÖÙDTe2¿¢vWE&WFñ6∆UFñ∆R¿¢vWD7FófUFñ∆TB¿¢Fñ∆U7W&f6Uîñ‰&V¿¢∆ñW$÷W6Ç¿¢6Ü˜uFˆ7B¿¢&Vg&W6Ñ7Fñˆ‰&"¿¢ÜñFT7FñˆÂ&ˆ◊B¿¢6Ü˜t7FñˆÂ&ˆ◊B¿¢GF6¥7Fñˆ‰ñ6ˆ‰ÖD‘¬¿¢v˜&∆EFÙ˜fW&∆í¿¢ñÁfVÁF˜'í¿¢WVó÷VÁE6∆˜G2¿¢&ˆ∆ƒóFV’7F'2¿¢7F%&FñÊuFWáB¿¢v&EFˆˆ≈W6T÷7FW'ïá¿¢vWDñÁfVÁF˜'ï7F6¥∂Wó2¿¢vWD7W'&VÁD&V¢Çí”‚7W'&VÁD&V¿¢vWEFá&VU&V7C¢Çí”‚˜Fá&VU&V7B¿¢6WD7FófTóFV‘ñÊFWÉ¢ábí”‚≤7FófTóFV‘ñÊFWÇ“c≤“¿¢6WE∆ñW$f6ñÊs¢ábí”‚≤∆ñW$f6ñÊr“c≤“¿¢6WDÜV∆D÷ˆFS¢ábí”‚≤ÜV∆D÷ˆFR“c≤“¿¢6WD7FófUFˆˆ√¢ábí”‚≤7FófUFˆˆ¬“c≤“¿¢6WD∆7D7Fñˆ‰÷W76vS¢ábí”‚≤∆7D7Fñˆ‰÷W76vR“c≤“¿¢vWD6÷W&÷ˆFS¢Çí”‚7FófT6÷W&÷ˆFR¿¢6WD6÷W&÷ˆFS¢ábí”‚≤7FófT6÷W&÷ˆFR“c≤“¿¢vWD6÷W&F&vWC¢Çí”‚7FófT6÷W&F&vWB¿¢6WD6÷W&F&vWC¢ábí”‚≤7FófT6÷W&F&vWB“c≤“¿¢6WEFˆˆ≈7vñÊtGW#¢ábí”‚≤Fˆˆ≈7vñÊtGW"“c≤“¿¢6WEFˆˆ≈7vñÊuC¢ábí”‚≤Fˆˆ≈7vñÊuB“c≤“¿¢6WE7G&ñ∂Tfó&VC¢ábí”‚≤7G&ñ∂Tfó&VB“c≤“¿¢6WDfó6ÖFá&˜t7FófS¢ábí”‚≤fó6ÖFá&˜t7FófR“c≤“¿¢“ì∞†¢vñÊF˜r‰&ÊFóD6ˆ÷&CÚÊñÊóBá∞¢&ÊB¿¢6∆◊¿¢FV'Vt∆ˆr¿¢DîƒR¿¢ƒîU%ı$DïU2¿¢•T’Ù$4µÙEU%ı2¿¢•T’Ù$4µı5TTB¿¢Ñı5DîƒUÙ$ïDUÙ¥‰Ù4¥$4µıÖı2¿¢DÙÙ≈ı4ÑUÙDTe2¿¢‘UD≈ÙDTe2¿¢DÙÙ≈ÙïDT’ÙDTe2¿¢dU$Dîu$ï5Ù‘UD≈Ù¥Uï2¿¢7&gFVEFˆˆƒóFV‘∂Wí¿¢÷WFƒF÷t◊V«Fó∆ñW"¿¢F÷vU∆ñW"¿¢ñ‰6ˆÊR¿¢7vWD÷˜fR¿¢6‰ˆ67WîB¿¢Êv∆TFñfb¿¢÷˜fT7&VGW&UF˜v&B¿¢7&VGW&T6‰VÁFW%Fñ∆R¿¢ó47&VGW&U7vñ÷÷ñÊr¿¢Fñ6¥7&VGW&T«VÊvUG&ñ¬¿¢Fñ6¥7&VGW&Tfˆ˜G7FW2¿¢Ü˜7Fñ∆Tˆ&¶V7G2¿¢vWD7FófU66VÊR¿¢vWD7FófTw&ñB¿¢vWD7FófT6ˆ«2¿¢vWD7FófU&˜w2¿¢Fñ∆U7W&f6Uîñ‰&V¿¢÷∂T6Ü&7FW$w&˜VÊE6ÜF˜r¿¢7&VGW&Tw&˜VÊE6ÜF˜u&Fñí¿¢6Ü&7FW$w&˜VÊE6ÜF˜u7W&f6Tˆfg6WB¿¢÷&µÊu∆ÊS¢ˆ÷&µÊu∆ÊR¿¢÷∂UFˆˆ≈∆ÊT÷W6Ç¿¢5EîƒUÙ‰UUE$≈ıı4R¿¢f3¢˜f2¿¢Fˆˆ≈ñs¢˜Fˆˆ≈ñr¿¢Êñ”¢˜Êñ“¿¢&ˆ∆√¢˜&ˆ∆¬¿¢EW¢˜EW¿¢ÑÜó3¢˜ÑÜó2¿¢§Üó3¢˜§Üó2¿¢vWD7W'&VÁD&V¢Çí”‚7W'&VÁD&V¿¢“ì∞†¢vñÊF˜r‰7&VGW&TvVÊWFñ73ÚÊñÊóBá≤6∆◊¬5$TEU$UÙD"“ì∞†¢vñÊF˜r‰∆6ÜV◊ï7ó7FV”ÚÊñÊóBá∞¢ïDT’ÙDTe2¿¢ñÁfVÁF˜'í¿¢6∆◊ñÁfVÁF˜'ï7F6≤¿¢&Vg&W6ÑóFV’67&ˆ∆¬¿¢6Ü˜uFˆ7B¿¢6fT÷V÷&W%v˜&∆DFF¿¢“ì∞†¢vñÊF˜rÂW'&˜FFñˆ„ÚÊñÊóBá∞¢Êv∆TFñfb¿¢“ì∞†¢vñÊF˜r‰vVÊW&≈7F˜&SÚÊñÊóBá∞¢ñÁfVÁF˜'í¿¢6Ü˜uFˆ7B¿¢'Vñ∆DñÁfVÁF˜'îw&ñB¿¢6fT÷V÷&W%v˜&∆DFF¿¢vWDvVÊW&≈7F˜&T6F∆ˆs¢Çí”‚tT‰U$≈ı5Dı$UÙ4DƒÙr¿¢∆ˆ˜E6Ü˜v˜&∆E7FFS¢ˆ∆ˆ˜E6Ü˜v˜&∆E7FFR¿¢vWE7F˜&T6∆˜FÜñÊuñV6W3¢Çí”‚5Dı$UÙ4ƒıDÑî‰uıîT4U2¿¢vWDvVÊW&≈7F˜&T6∆˜FÜñÊu6∆˜G3¢Çí”‚tT‰U$≈ı5Dı$UÙ4ƒıDÑî‰uı4ƒıE2¿¢6∆VÊF"¿¢W62¿¢vWE6¥6∆˜FÜñÊs¢Çí”‚6¥6∆˜FÜñÊr¿¢'Vñ∆E6¥6∆˜FÜñÊu6V7Fñˆ„¢vñÊF˜r‰WVó÷VÁEÊV¬Ê'Vñ∆E6¥6∆˜FÜñÊu6V7Fñˆ‚¿¢6VVFVE&ÊFˆ“¿¢6∆˜FÜñÊu7&óFTf˜$6˜6÷WFñ3¢vñÊF˜r‰WVó÷VÁEÊV¬Ê6∆˜FÜñÊu7&óFTf˜$6˜6÷WFñ2¿¢“ì∞†¢vñÊF˜r‰6'VÁFW%6Ü˜ÚÊñÊóBá∞¢ñÁfVÁF˜'í¿¢6Ü˜uFˆ7B¿¢'Vñ∆DñÁfVÁF˜'îw&ñB¿¢6fT÷V÷&W%v˜&∆DFF¿¢vWD&&ÂFñW'3¢Çí”‚$$ÂıDîU%2¿¢vWDÜ˜W6UñV6TFVVG3¢Çí”‚ˆ&¶V7BÊg&ˆ‘VÁG&ñW2Ñˆ&¶V7BÊVÁG&ñW2ÑÑıU4UıîT4UÙ4DƒÙríÊfñ«FW"ÇÖ≤¬FVe“í”‚FVbÊFVVDóFV“íí¿¢eU$‰ïEU$UÙ$≈TU$îÂEÙ4DƒÙr¿¢∆ˆ˜E6Ü˜v˜&∆E7FFS¢ˆ∆ˆ˜E6Ü˜v˜&∆E7FFR¿¢W62¿¢“ì∞†¢vñÊF˜rÂvVFÜW$eÉÚÊñÊóBá∞¢6∆VÊF"¿¢6VVFVE&ÊFˆ“¿¢vWDw&ñC¢Çí”‚w&ñB¿¢$ıu2¬4Ù≈2¿¢Fñ∆UGóR¿¢6∆◊¿¢6Ü˜uFˆ7B¿¢FV'Vt∆ˆr¿¢v˜&∆EFÙ˜fW&∆í¿¢∆7GÇ¿¢∆ñW"¿¢Á5v∆∂W'2¿¢vWD7W'&VÁD&V¢Çí”‚7W'&VÁD&V¿¢DîƒR¿¢vWD∆ñváFÊñÊt«Ü¢Çí”‚∆ñváFÊñÊt«Ü¿¢6WD∆ñváFÊñÊt«Ü¢ábí”‚≤∆ñváFÊñÊt«Ü“c≤“¿¢vWE66VÊUG&Á4«Ü¢Çí”‚66VÊUG&Á4«Ü¿¢vWEFá&VU&V7C¢Çí”‚˜Fá&VU&V7B¿¢ˆó4'Vñ∆FñÊt&V¿¢vWD7FófTw&ñB¬vWD7FófT6ˆ«2¬vWD7FófU&˜w2¿¢vWDf∆˜vñÊuG&VÊ6ÖFñ∆W3¢Çí”‚ˆf∆˜vñÊuG&VÊ6ÖFñ∆W2¿¢vWEF˜v‰f∆˜vñÊuG&VÊ6ÖFñ∆W3¢Çí”‚˜F˜v‰f∆˜vñÊuG&VÊ6ÖFñ∆W2¿¢Fá&VT6ˆÁFñÊW"¿¢vWD6’É¢Çí”‚6’Ç¿¢vWD6’ì¢Çí”‚6’í¿¢ÚÚW6VB'ívVFÜW$eÇw2∆ñW"∆ÁFW&‚÷6≤FÚfˆ∆∆˜rFÜRfF"w0¢ÚÚ6÷ˆ˜FÜVBv˜&∆BV∆WfFñˆ‚ñÁ7FVBˆb&ˆ¶V7FñÊrg&ˆ“f∆Bì”‡¢vWE∆ñW%v˜&∆Eì¢Çí”‚∆ñW$÷W6ÇÁ˜6óFñˆ‚Áí¿¢ÚÚ∆ñváFñÊró26◊∆VBBá¢¬6Ú6ˆ∆∆V7FñÊrFÜR7FófR66VÊRw0¢ÚÚFvvVBgW&ÊóGW&R∆ñváG2ÜW&R7Fó26ÜVÊBfˆñG27F∆R6ˆ˜&G2‡¢vWDgW&ÊóGW&T∆ñváE6˜W&6W3¢Çí”‚∞¢6ˆÁ7B6˜W&6W2“µ”∞¢6ˆÁ7Bv˜&∆E˜6óFñˆ‚“ÊWrDÖ$TRÂfV7F˜#2Çì∞¢vWD7FófU66VÊRÇìÚÁG&fW'6RÜˆ&¢”‚∞¢ñbÇˆ&¢Êó5ˆñÁD∆ñváB«¬ˆ&¢ÁW6W$FFÚÊgW&ÊóGW&T∆ñváD÷6≤í&WGW&„∞¢ˆ&¢ÊvWEv˜&∆E˜6óFñˆ‚áv˜&∆E˜6óFñˆ‚ì∞¢6˜W&6W2ÁW6Çá∞¢É¢v˜&∆E˜6óFñˆ‚ÁÇ¿¢ì¢v˜&∆E˜6óFñˆ‚Áí¿¢£¢v˜&∆E˜6óFñˆ‚Á¢¿¢Fó7FÊ6S¢ˆ&¢ÊFó7FÊ6R¿¢ñÁFVÁ6óGì¢ˆ&¢ÊñÁFVÁ6óGí¿¢6ˆ∆˜#¢∞¢#¢÷FÇÁ&˜VÊBÜˆ&¢Ê6ˆ∆˜"Á"¢#SRí¿¢s¢÷FÇÁ&˜VÊBÜˆ&¢Ê6ˆ∆˜"Êr¢#SRí¿¢#¢÷FÇÁ&˜VÊBÜˆ&¢Ê6ˆ∆˜"Ê"¢#SRí¿¢“¿¢“ì∞¢“ì∞¢&WGW&‚6˜W&6W3∞¢“¿¢«ï6V6ˆÊƒw&74V&Ê6R¿¢$îÂıïEïÙDï2¿¢“ì∞†¢vñÊF˜rÂ&ñÂ∆ÊW3ÚÊñÊóBá∞¢DÖ$TR¿¢&VÊFW&W"¿¢6÷W&¿¢6∆VÊF"¿¢∆ñW"¿¢DîƒR¿¢vWE∆ñW$w&˜VÊEì¢˜∆ñW$w&˜VÊEí¿¢vWD7FófU66VÊR¿¢vWD7W'&VÁD&V¢Çí”‚7W'&VÁD&V¿¢ó4˜WFFˆ˜$&V¢Çí”‚7W'&VÁD&V””“vf&“r«¬7W'&VÁD&V””“wF˜v‚r«¬ˆó5¶ˆÊT&VÜ7W'&VÁD&Ví¿¢“ì∞†¢vñÊF˜r‰f&’ÊV√ÚÊñÊóBá∞¢ƒïdU5DÙ4µÙïDT’Ù¥î‰E2¿¢ñÁfVÁF˜'í¿¢6Ü˜uFˆ7B¿¢'Vñ∆DñÁfVÁF˜'îw&ñB¿¢&Vg&W6Ñ7Fñˆ‰&"¿¢ó4f&‘˜vÊW"¿¢vWDf&‘Ê÷R¿¢6WDf&‘Ê÷R¿¢vWDf&‘˜vÊW$Ê÷R¿¢Fñ∆UGóR¿¢4Ù≈2¬$ıu2¿¢vWDw&ñC¢Çí”‚w&ñB¿¢ó4Ü˜W6Tfˆ˜G&ñÁB¿¢&ˆ6W76ñÊtgW&ÊóGW&Tˆ&¶V7G2¿¢ñÁFW&ñ˜$gW&ÊóGW&Tˆ&¶V7G2¿¢DT4ı$DïdUÙeU$‰ïEU$UÙDTe2¿¢ˆ∆ˆEv˜&∆D∆ófW7Fˆ6≤¿¢v˜&∆Dˆ&¶V7G2¿¢Êñ÷ƒˆ&¶V7G2¿¢W62¿¢Ü4f&’W&÷ó76ñˆ‚¿¢vWD&&ÂFñW'3¢Çí”‚$$ÂıDîU%2¿¢vWDÜ˜W6UñV6T6F∆ˆs¢Çí”‚ÑıU4UıîT4UÙ4DƒÙr¿¢vWDÜ˜W6UñV6W3¢Çí”‚Ü˜W6UñV6W2¿¢∆6TÜ˜W6TFVVC¢áñV6T∂Wí¬6ˆ¬¬&˜rí”‚vñÊF˜r‰Ü˜W6UñV6W2Á∆6TFVVBáñV6T∂Wí¬6ˆ¬¬&˜rí¿¢'Vñ∆DÜ˜W6UñV6S¢ÜñBí”‚vñÊF˜r‰Ü˜W6UñV6W2Ê'Vñ∆BÜñBí¿¢FV÷ˆ∆ó6ÑÜ˜W6UñV6S¢ÜñBí”‚vñÊF˜r‰Ü˜W6UñV6W2ÊFV÷ˆ∆ó6ÇÜñBí¿¢÷˜fTÜ˜W6S¢Ü6ˆ¬¬&˜rí”‚vñÊF˜r‰Ü˜W6UñV6W2Ê÷˜fTÜ˜W6RÜ6ˆ¬¬&˜rí¿¢÷˜fUñV6S¢áñV6TñB¬6ˆ¬¬&˜rí”‚vñÊF˜r‰Ü˜W6UñV6W2Ê÷˜fUñV6RáñV6TñB¬6ˆ¬¬&˜rí¿¢6‰÷˜fUñV6UFÛ¢áñV6TñB¬6ˆ¬¬&˜rí”‚vñÊF˜r‰Ü˜W6UñV6W2Ê6‰÷˜fUñV6UFÚáñV6TñB¬6ˆ¬¬&˜rí¿¢&˜FFTÜ˜W6UñV6S¢ÜñBí”‚vñÊF˜r‰Ü˜W6UñV6W2Á&˜FFUñV6RÜñBí¿¢&˜FFTÜ˜W6U&ˆˆc¢ÜñBí”‚vñÊF˜r‰Ü˜W6UñV6W2Á&˜FFU&ˆˆdÜó2ÜñBí¿¢6Â∆6TÜ˜W6TfVGW&TC¢Ü6ˆ¬¬&˜rí”‚vñÊF˜r‰Ü˜W6UñV6W2Ê6Â∆6TfVGW&TBÜ6ˆ¬¬&˜rí¿¢∆6TÜ˜W6TfVGW&S¢Ü6ˆ¬¬&˜r¬v˜&∆EÇ¬v˜&∆E¢¬GóRí”‚vñÊF˜r‰Ü˜W6UñV6W2Á∆6TfVGW&RÜ6ˆ¬¬&˜r¬v˜&∆EÇ¬v˜&∆E¢¬GóRí¿¢&V÷˜fTÜ˜W6TfVGW&TC¢Ü6ˆ¬¬&˜rí”‚vñÊF˜r‰Ü˜W6UñV6W2Á&V÷˜fTfVGW&TBÜ6ˆ¬¬&˜rí¿¢vWDÜ˜W6TfóáGW&TñÁfVÁF˜'ì¢Çí”‚vñÊF˜r‰Ü˜W6UñV6W2ÊvWDfóáGW&TñÁfVÁF˜'íÇí¿¢Ü˜W6UñV6T∆&V√¢ÜVÁG'íí”‚vñÊF˜r‰Ü˜W6UñV6W2Ê∆&V¬ÜVÁG'íí¿¢66VÊR¿¢vWDf&‘'Vñ∆FñÊw3¢Çí”‚f&‘'Vñ∆FñÊw2¿¢$Ù4U54î‰uÙeU$‰ïEU$UÙDTe2¿¢tî‰uÙ‘UDÑÙE2¿¢6∆VÊF"¿¢vWE7F&∆S¢Çí”‚7F&∆R¿¢ˆ∆ˆEv˜&∆D'&VVFñÊuó'2¿¢6fT÷V÷&W%v˜&∆DFF¿¢˜6fUv˜&∆D'&VVFñÊuó'2¿¢˜6fUv˜&∆D∆ófW7Fˆ6≤¿¢6ˆ◊Êñˆ‰ïGóTf˜$∂ñÊB¿¢ˆWFÙ76ñvÂ7F&∆U&ˆ∆R¿¢6fU7F&∆R¿¢˜F˜FÜ≈v˜&∆DñB¿¢FVfV«Ev˜&∆D÷V÷&W%7FFR¿¢7vˆ∆B¿¢ˆ∆ˆEv˜&∆E7F˜&vR¿¢˜6fUv˜&∆E7F˜&vR¿¢ïDT’ÙDTe2¿¢FWtóFV‘∂Wí¿¢6∆◊ñÁfVÁF˜'ï7F6≤¿¢vWD7FófT÷˜VÁDñC¢Çí”‚7FófT÷˜VÁDñB¿¢6WD7FófT÷˜VÁDñC¢ábí”‚≤7FófT÷˜VÁDñB“c≤“¿¢vWD7FófU6Ü˜V∆FW%WDñC¢Çí”‚7FófU6Ü˜V∆FW%WDñB¿¢6WD7FófU6Ü˜V∆FW%WDñC¢ábí”‚≤7FófU6Ü˜V∆FW%WDñB“c≤“¿¢vWD7FófT6ˆ◊Êñˆ‰ñC¢Çí”‚7FófT6ˆ◊Êñˆ‰ñB¿¢6WD7FófT6ˆ◊Êñˆ‰ñC¢ábí”‚≤7FófT6ˆ◊Êñˆ‰ñB“c≤“¿¢“ì∞†¢vñÊF˜rÂF6∑5ÊV√ÚÊñÊóBá∞¢ïDT’ÙDTe2¿¢W62¿¢t‘ı§Ù‰UÙƒ$T≈2¿¢vWEVW7E&ˆw&W73¢Çí”‚VW7E&ˆw&W72¿¢ñÁfVÁF˜'í¿¢“ì∞†¢vñÊF˜rÂ7W«ïvSÚÊñÊóBá∞¢ñÁfVÁF˜'í¿¢vWE7W«î&˜Ñˆ&¶V7C¢Çí”‚7W«î&˜Ñˆ&¶V7B¿¢5U≈ïÙ4DƒÙr¿¢6Ü˜uFˆ7B¿¢'Vñ∆DñÁfVÁF˜'îw&ñB¿¢6fT÷V÷&W%v˜&∆DFF¿¢vWEVÊFñÊt˜&FW'3¢Çí”‚VÊFñÊt˜&FW'2¿¢vWDFV∆ófW'î∆ˆs¢Çí”‚FV∆ófW'î∆ˆr¿¢“ì∞†¢vñÊF˜r‰WVó÷VÁEÊV√ÚÊñÊóBá∞¢ñÁfVÁF˜'í¿¢6∆◊ñÁfVÁF˜'ï7F6≤¿¢WVó÷VÁE6∆˜G2¿¢6fTWVó÷VÁE6∆˜G2¿¢DÙÙ≈ÙïDT’ÙDTe2¿¢vWDvV$ñÁfVÁF˜'ì¢Çí”‚vV$ñÁfVÁF˜'í¿¢6fTvV$ñÁfVÁF˜'í¿¢vWE6¥6∆˜FÜñÊs¢Çí”‚6¥6∆˜FÜñÊr¿¢6WE6¥6∆˜FÜñÊs¢Ü'"í”‚≤6¥6∆˜FÜñÊr“'#≤“¿¢6fT÷V÷&W%v˜&∆DFF¿¢6Ü˜uFˆ7B¿¢&V'Vñ∆EFˆˆƒ÷W6ÜW2¿¢Fˆˆƒ÷W6Ñ÷¿¢FˆˆƒÜˆ∆FW"¿¢vWD7FófUFˆˆ√¢Çí”‚7FófUFˆˆ¬¿¢&Vg&W6Ñ7Fñˆ‰&"¿¢6WD7FófUFˆˆ¬¿¢ó4FWd÷ˆFS¢Çí”‚5ˆFWd÷ˆFR¿¢Fˆˆƒ÷7FW'î∆WfV¬¿¢FWd'V◊Fˆˆƒ÷7FW'î∆WfV¬¿¢÷WF≈Fˆˆƒñ÷u7&2¿¢W62¿¢&Vg&W6Ö∆ñW$fF"¿¢'Vñ∆DñÁfVÁF˜'îw&ñB¿¢6∆V$ñÁfVÁF˜'îFWFñ¬¿¢6∆V$ñÁe6V∆V7Fñˆ„¢Çí”‚∞¢ñÁe6V∆V7FVD∂Wí“ÁV∆√∞¢Fˆ7V÷VÁBÁVW'ï6V∆V7F˜$∆¬ÇrÊñÁb÷óFV“÷&˜ÇríÊf˜$V6ÇÜ"”‚"Ê6∆74∆ó7BÁ&V÷˜fRÇw6V∆V7FVBríì∞¢“¿¢“ì∞†¢vñÊF˜rÂvÜó7F∆TWVóÚÊñÊóBá∞¢6WDWVó÷VÁE6∆˜C¢vñÊF˜r‰WVó÷VÁEÊV¬Á6WDWVó÷VÁE6∆˜B¿¢vWDvV$ñÁfVÁF˜'ì¢Çí”‚vV$ñÁfVÁF˜'í¿¢5$TEU$UÙD"¿¢WVó÷VÁE6∆˜G2¿¢“ì∞†¢vñÊF˜rÂvñ∆F∆ñfTFV'VuÊV√ÚÊñÊóBá∞¢W62¿¢˜¶ˆÊT∆ñ˜WG2¿¢Ü˜7Fñ∆Tˆ&¶V7G2¿¢“ì∞†¢vñÊF˜rÂ6ÜóñÊuÊV√ÚÊñÊóBá∞¢ñÁfVÁF˜'í¿¢ïDT’ÙDTe2¿¢$4Uı$î4U2¿¢vWE6ÜóñÊt&˜Ñˆ&¶V7C¢Çí”‚6ÜóñÊt&˜Ñˆ&¶V7B¿¢6Ü˜uFˆ7B¿¢Ü4f&’W&÷ó76ñˆ‚¿¢6∆◊ñÁfVÁF˜'ï7F6≤¿¢'Vñ∆DñÁfVÁF˜'îw&ñB¿¢&Vg&W6ÑóFV’67&ˆ∆¬¿¢6fT÷V÷&W%v˜&∆DFF¿¢“ì∞†¢vñÊF˜r‰7&gFñÊuÊV√ÚÊñÊóBá∞¢ñÁfVÁF˜'í¿¢6∆◊ñÁfVÁF˜'ï7F6≤¿¢eU$‰ïEU$UÙ$≈TU$îÂEÙ4DƒÙr¿¢6Ü˜uFˆ7B¿¢'Vñ∆DñÁfVÁF˜'îw&ñB¿¢6fT÷V÷&W%v˜&∆DFF¿¢W62¿¢“ì∞†¢vñÊF˜r‰FWe7vÊW#ÚÊñÊóBá∞¢vWD7W'&VÁD&V¢Çí”‚7W'&VÁD&V¿¢6WD7W'&VÁD&V¢ábí”‚≤7W'&VÁD&V“c≤“¿¢vWD7FófU66VÊR¿¢∆ñW$÷W6Ç¬∆ñW$w&˜VÊE6ÜF˜r¬FˆˆƒÜˆ∆FW"¬&WFñ6∆T÷W6Ç¬&WFñ6∆T6ó&6∆T÷W6Ç¬&WFñ6∆U&ñÊt÷W6Ç¬&WFñ6∆Uvgîw&˜W¿¢ˆó4'Vñ∆FñÊt&V¿¢6WD7W'&VÁD'Vñ∆FñÊt÷ñC¢ábí”‚≤ˆ7W'&VÁD'Vñ∆FñÊt÷ñB“c≤“¿¢7F'E66VÊUG&Á6óFñˆ‚¿¢∆ñW"¿¢˜6Ê6÷W&F&vWB¿¢&Vg&W6Ñ7Fñˆ‰&"¿¢6Ü˜uFˆ7B¿¢6∆˜6T÷VÁR¿¢UÖDU$îı%ı§Ù‰U2¿¢'Vñ∆E¶ˆÊU66VÊR¿¢4Ù≈2¬$ıu2¬DîƒR¿¢5$TEU$UÙD"¿¢W62¿¢6∆◊¿¢÷∂T7&VGW&TVÁFóGí¿¢Ü˜7Fñ∆Tˆ&¶V7G2¬6ˆ◊Êñˆ‰ˆ&¶V7G2¿¢F÷vT7&VGW&R¿¢vWD7FófTw&ñB¿¢Fñ∆U7W&f6Uîñ‰&V¿¢÷&¥˜WF∆ñÊS¢ˆ÷&¥˜WF∆ñÊR¿¢¶ˆÊU66VÊW3¢˜¶ˆÊU66VÊW2¿¢G&VTfFT7FófS¢˜G&VTfFT7FófR¿¢ó4f&‘˜vÊW"¿¢vWDf&‘VFóD÷ˆFS¢Çí”‚f&‘VFóD÷ˆFR¿¢Fˆvv∆Tf&‘VFóD÷ˆFR¿¢6WDFV'VuvVFÜW#¢vñÊF˜rÂvVFÜW$eÇÁ6WDFV'VuvVFÜW"¿¢vWDFV'VuvVFÜW#¢vñÊF˜rÂvVFÜW$eÇÊvWDFV'VuvVFÜW"¿¢vWE&ñÂ∆ÊU6WGFñÊw3¢vñÊF˜rÂ&ñÂ∆ÊW2ÊvWE6WGFñÊw2¿¢6WE&ñÂ∆ÊU6WGFñÊw3¢vñÊF˜rÂ&ñÂ∆ÊW2Á6WE6WGFñÊw2¿¢ó4FWd÷ˆFS¢Çí”‚5ˆFWd÷ˆFR¿¢“ì∞†¢vñÊF˜r‰gW&ÊóGW&U∆6W#ÚÊñÊóBá∞¢vWD7W'&VÁD&V¢Çí”‚7W'&VÁD&V¿¢vWDFV6˜&FófTgW&ÊóGW&TFVg3¢Çí”‚DT4ı$DïdUÙeU$‰ïEU$UÙDTe2¿¢vWE&ˆ6W76ñÊtgW&ÊóGW&TFVg3¢Çí”‚$Ù4U54î‰uÙeU$‰ïEU$UÙDTe2¿¢ñÁfVÁF˜'í¿¢Ü4f&’W&÷ó76ñˆ‚¿¢&‘gW&ÊóGW&U∆6V÷VÁB¿¢vWD&÷VDgW&ÊóGW&U∆6V÷VÁD∂Wí¿¢&‘gW&ÊóGW&T÷˜fR¿¢vWD&÷VDgW&ÊóGW&T÷˜fTñB¿¢vWE∆6VDgW&ÊóGW&S¢Çí”‚ñÁFW&ñ˜$gW&ÊóGW&Tˆ&¶V7G2Êfñ«FW"ÜÚ”‚ÚÊ&V””“7W'&VÁD&Ví¿¢&V÷˜fTgW&ÊóGW&S¢&V÷˜fTFV6˜&FófTgW&ÊóGW&R¿¢&˜FFTgW&ÊóGW&S¢&˜FFTFV6˜&FófTgW&ÊóGW&R¿¢6Ü˜uFˆ7B¿¢W62¿¢ó5W6VC¢Çí”‚W6VB¿¢ó4FWd÷ˆFS¢Çí”‚5ˆFWd÷ˆFR¿¢“ì∞†¢vñÊF˜rÂF˜vÂ¶ˆÊT'Vñ∆FñÊw3ÚÊñÊóBá∞¢vWEF˜vÂ¶ˆÊS¢Çí”‚˜F˜vÂ¶ˆÊR¿¢FV'Vt∆ˆr¿¢vWEF˜vÂ66VÊS¢Çí”‚F˜vÂ66VÊR¿¢vWEF˜v‰'Vñ∆FñÊtFVg3¢Çí”‚˜F˜v‰'Vñ∆FñÊtFVg2¿¢vWEF˜v‰'Vñ∆FñÊtw&˜W3¢Çí”‚˜F˜v‰'Vñ∆FñÊtw&˜W2¿¢6WEF˜v‰'Vñ∆FñÊtw&˜W3¢ábí”‚≤˜F˜v‰'Vñ∆FñÊtw&˜W2“c≤“¿¢vWEv˜&∆EF˜vÂG&Á6óFñˆÁ3¢Çí”‚v˜&∆EF˜vÂG&Á6óFñˆÁ2¿¢vWEF˜v‰w&ñC¢Çí”‚F˜v‰w&ñB¿¢Ü˜W6Uv∆ƒ'Vñ∆FW"¿¢îÂDU$îı%Ù4Ù≈2¿¢îÂDU$îı%ı$ıu2¿¢Fñ∆U7W&f6Uí¿¢Fñ∆UGóR¿¢¶ˆÊT∆ñ˜WG3¢˜¶ˆÊT∆ñ˜WG2¿¢¶ˆÊT'Vñ∆FñÊtw&˜W3¢˜¶ˆÊT'Vñ∆FñÊtw&˜W2¿¢¶ˆÊT'Vñ∆FñÊw4v∆%Ww&FUVÊFñÊs¢˜¶ˆÊT'Vñ∆FñÊw4v∆%Ww&FUVÊFñÊr¿¢¶ˆÊU66VÊW3¢˜¶ˆÊU66VÊW2¿¢¶ˆÊTFV6˜$gW&ÊóGW&Tw&˜W3¢˜¶ˆÊTFV6˜$gW&ÊóGW&Tw&˜W2¿¢÷∂TFV6˜&FófTgW&ÊóGW&T÷W6Ç¿¢$Ù4U54î‰uÙeU$‰ïEU$UÙDTe2¿¢'Vñ∆DgW&ÊóGW&Ufó7V¬¿¢÷&¥˜WF∆ñÊS¢ˆ÷&¥˜WF∆ñÊR¿¢÷&¥gW&ÊóGW&TVFvTñC¢ˆ÷&¥gW&ÊóGW&TVFvTñB¿¢‰ı$‘≈ıDı¿¢ƒDTUıT‰ïB¿¢“ì∞†¢vñÊF˜rÂvñ∆F∆ñfU7v„ÚÊñÊóBá∞¢DîƒR¿¢Fñ∆UGóR¿¢&ÊB¿¢ˆó5¶ˆÊT&V¿¢vWD7W'&VÁD&V¢Çí”‚7W'&VÁD&V¿¢Ü˜7Fñ∆Tˆ&¶V7G2¿¢UÖDU$îı%ı§Ù‰U2¿¢F÷vT7&VGW&R¿¢Ñı5DîƒUÙ$ïDUÙ¥‰Ù4¥$4µıÖı2¿¢¶ˆÊT∆ñ˜WG3¢˜¶ˆÊT∆ñ˜WG2¿¢÷∂T7&VGW&TVÁFóGí¿¢5$TEU$UÙD"¿¢6Ü˜uFˆ7B¿¢'Vñ∆FñÊu66VÊW3¢ˆ'Vñ∆FñÊu66VÊW2¿¢FV‰ÊW7G3¢ˆFV‰ÊW7G2¿¢vWD7WG66VÊU&WfñWt7FófS¢Çí”‚7WG66VÊU&WfñWt7FófR¿¢'Vñ∆E¶ˆÊU66VÊR¿¢“ì∞†¢vñÊF˜r‰6fW&‰vVÊW&F˜#ÚÊñÊóBá∞¢UÖDU$îı%ı§Ù‰U2¿¢DTÂÙ‘ıDÑU%ÙDTe2¿¢“ì∞†¢vñÊF˜rÂ¶ˆÊU∆FVT÷W6ÚÊñÊóBá∞¢‰ı$‘≈ıDı¬ƒDTUıT‰ïB¬Fñ∆UGóR¬4%dTEıDîƒUıEïU2¿¢&W6ˆ«fUFñ∆T÷B¬Fó7∆6U¶ˆÊTvVˆ÷WG'í¿¢“ì∞†¢vñÊF˜rÂ¶ˆÊUFW'&ñ‰fVGW&W3ÚÊñÊóBá∞¢Fñ∆UGóR¬‰ı$‘≈ıDı¬ƒDTUıT‰ïB¬$ïdU%ıDı¿¢Fó7∆6U¶ˆÊTvVˆ÷WG'í¬&W6ˆ«fUFñ∆T÷B¿¢÷&µFW'&ñ‰VFvTñC¢ˆ÷&µFW'&ñ‰VFvTñB¿¢FW'&ñ‰6FVv˜'îf˜#¢˜FW'&ñ‰6FVv˜'îf˜"¿¢vFW%fW'E6ÜFW"¬vFW$g&u6ÜFW"¿¢'Vñ∆D÷W&vVEvFW$÷W6É¢ˆ'Vñ∆D÷W&vVEvFW$÷W6Ç¿¢“ì∞†¢vñÊF˜rÂ¶ˆÊTFVÂF˜FV‘fVGW&W3ÚÊñÊóBá∞¢‰ı$‘≈ıDı¬ƒDTUıT‰ïB¬Fñ∆UGóR¬$Ù4µÙ‘ıT‰EÙ4Tƒ≈5ıU%ıDîƒR¿¢÷&µFW'&ñ‰VFvTñC¢ˆ÷&µFW'&ñ‰VFvTñB¿¢FW'&ñ‰6FVv˜'îf˜#¢˜FW'&ñ‰6FVv˜'îf˜"¿¢“ì∞†¢vñÊF˜rÂ¶ˆÊTw&74&ñ∆∆&ˆ&G3ÚÊñÊóBá∞¢Fñ∆UGóR¬ƒDTUıT‰ïB¿¢w&74&∆FTvVÛ¢ˆw&74&∆FTvVÚ¿¢vWDw&74&ñ∆∆&ˆ&D÷C¢Çí”‚w&74&ñ∆∆&ˆ&D÷B¿¢vWDw&74VÊ&∆VC¢Çí”‚5ˆw&72¿¢fñ∆ƒ&ñ∆∆&ˆ&DñÁ7FÊ6W3¢ˆfñ∆ƒ&ñ∆∆&ˆ&DñÁ7FÊ6W2¿¢÷%&Ês¢ˆ÷%&Êr¿¢Fñ∆U7W&f6Uí¿¢“ì∞†¢vñÊF˜r‰÷WFƒ7&gE6Ü˜ÚÊñÊóBá∞¢ñÁfVÁF˜'í¿¢6Ü˜uFˆ7B¿¢6∆◊ñÁfVÁF˜'ï7F6≤¿¢'Vñ∆DñÁfVÁF˜'îw&ñB¿¢'Vñ∆DWVó÷VÁE6∆˜G3¢vñÊF˜r‰WVó÷VÁEÊV¬Ê'Vñ∆DWVó÷VÁE6∆˜G2¿¢6fT÷V÷&W%v˜&∆DFF¿¢W62¿¢vWDvV$ñÁfVÁF˜'ì¢Çí”‚vV$ñÁfVÁF˜'í¿¢6fTvV$ñÁfVÁF˜'í¿¢÷WFƒ&$óFV‘∂Wí¿¢7&gFVEFˆˆƒóFV‘∂Wí¿¢Fˆˆ≈∆FñÊr¿¢6∆V%Fˆˆ≈∆FñÊr¿¢6WEFˆˆ≈∆FñÊr¿¢Fˆˆ≈&VñÊf˜&6V÷VÁD÷WF¬¿¢6WEFˆˆ≈&VñÊf˜&6V÷VÁB¿¢FˆˆƒVffV7FófT÷WFƒ∂Wí¿¢Fˆˆ≈fW&Fñw&ó4g&7Fñˆ‚¿¢Fˆˆƒ÷7FW'î∆WfV¬¿¢&Vg&W6Ñ÷WF≈Fˆˆ≈v˜&∆EFWáGW&R¿¢‘UD≈ÙDTe2¿¢DÙÙ≈ÙïDT’ÙDTe2¿¢dU$Dîu$ï5Ù‘UD≈Ù¥Uï2¿¢T‰ƒÙ4¥TEıDÙÙ≈ı4ÑU2¿¢DÙÙ≈ı4ÑUÙDTe2¿¢“ì∞†¢vñÊF˜rÂvñ∆FW&ÊW74÷ÚÊñÊóBá∞¢˜¶ˆÊT∆ñ˜WG2¿¢F˜FÜ≈v˜&∆DñC¢˜F˜FÜ≈v˜&∆DñB¿¢7W'&VÁEF˜FÜ≈ñV"¿¢6Ü˜uFˆ7B¿¢ˆó5¶ˆÊT&V¿¢vWD7W'&VÁD&V¢Çí”‚7W'&VÁD&V¿¢∆ñW"¿¢DîƒR¿¢Á5v∆∂W'2¿¢t‘ı§Ù‰UÙƒ$T≈2¿¢“ì∞†¢vñÊF˜r‰6∆ñ÷%7ó7FV”ÚÊñÊóBá∞¢ˆó5¶ˆÊT&V¿¢vWD7W'&VÁD&V¢Çí”‚7W'&VÁD&V¿¢∆ñW"¿¢f6ñÊt6&FñÊ¬¿¢vWD7FófTw&ñB¿¢vWD7FófT6ˆ«2¿¢vWD7FófU&˜w2¿¢DîƒR¿¢ó56ˆ∆ñB¿¢Fñ∆U7W&f6Uîñ‰&V¿¢6∆◊¿¢6WDf6ñÊtÊv∆S¢ábí”‚≤f6ñÊtÊv∆R“c≤“¿¢6WEF&vWDñ‘Êv∆S¢ábí”‚≤F&vWDñ‘Êv∆R“c≤“¿¢6WD∆7D÷˜fTÊv∆S¢ábí”‚≤∆7D÷˜fTÊv∆R“c≤“¿¢“ì∞†¢vñÊF˜r‰&ÊFóD6ˆ÷&D∆ˆsÚÊñÊóBá∞¢∆ñW"¿¢6ˆ◊Êñˆ‰ˆ&¶V7G2¿¢&VÊ7vÊVD7&VGW&W3¢vñÊF˜r‰FWe7vÊW"ÊvWD&VÊ7vÊVD7&VGW&W2Çí¿¢vWD7W'&VÁD&V¢Çí”‚7W'&VÁD&V¿¢vWDFWdv∆ˆ&≈7VVD◊V√¢Çí”‚FWdv∆ˆ&≈7VVD◊V¬¿¢DUeÙ$T‰ı§Ù‰UÙîC¢vñÊF˜r‰FWe7vÊW"‰DUeÙ$T‰ı§Ù‰UÙîB¿¢DîƒR¿¢Êv∆TFñfb¿¢6Ü˜uFˆ7B¿¢“ì∞†¢vñÊF˜r‰FV'VtÜóF&˜ÜW3ÚÊñÊóBá∞¢vWD7FófUFñ∆TB¿¢Fñ∆U7W&f6Uí¿¢v˜&∆EFÙ˜fW&∆í¿¢ˆ7GÇ¿¢DîƒR¿¢∆ñW"¿¢Ü˜7Fñ∆Tˆ&¶V7G2¿¢6ˆ◊Êñˆ‰ˆ&¶V7G2¿¢vWD7W'&VÁD&V¢Çí”‚7W'&VÁD&V¿¢vWE6Ü˜tÜóF&˜ÜW3¢Çí”‚5˜6Ü˜tÜóF&˜ÜW2¿¢7&VGW&TÜóF&˜ÑÜ∆e6ó¶UÇ¿¢7&VGW&Tñ‘6ˆ∆∆ñFW%&V6ÖÇ¿¢6÷W&&V∆FófT7&VGW&UW'2¿¢5$TEU$UıU%ÙDTEı$C¢vñÊF˜rÂW'&˜FFñˆ‚‰5$TEU$UıU%ÙDTEı$B¿¢“ì∞†¢vñÊF˜rÂ&V∆FñˆÁ6Üó5ÊV√ÚÊñÊóBá∞¢Á5v∆∂W'2¿¢W62¿¢“ì∞†¢vñÊF˜r‰6∆VÊF%7ó7FV”ÚÊñÊóBá∞¢‘ı$‰î‰uÙÑıU"¿¢‰îtÖEÙÑıU"¿¢6∆VÊF"¿¢6≈FˆFí¿¢6ƒ÷ˆÁFÖFóF∆R¿¢6≈&Wd÷ˆÁFÇ¿¢6ƒÊWáD÷ˆÁFÇ¿¢6≈vVV∑2¿¢“ì∞†¢vñÊF˜r‰ßV&÷ó%6Ü˜ÚÊñÊóBá∞¢F˜FÜ≈v˜&∆DñC¢˜F˜FÜ≈v˜&∆DñB¿¢vWE6Ü˜7Fˆ6≥¢Çí”‚˜6Ü˜7Fˆ6≤¿¢∆ˆ˜E6Ü˜v˜&∆E7FFS¢ˆ∆ˆ˜E6Ü˜v˜&∆E7FFR¿¢6∆VÊF"¿¢ñÁfVÁF˜'í¿¢6Ü˜uFˆ7B¿¢W62¿¢'Vñ∆DñÁfVÁF˜'îw&ñB¿¢6fT÷V÷&W%v˜&∆DFF¿¢“ì∞†¢vñÊF˜r‰GñU7ó7FV”ÚÊñÊóBá∞¢vWDvV$ñÁfVÁF˜'ì¢Çí”‚vV$ñÁfVÁF˜'í¿¢6fTvV$ñÁfVÁF˜'í¿¢“ì∞†¢vñÊF˜rÂ&VvVÁE∆ÁG3ÚÊñÊóBá∞¢6∆VÊF"¿¢ñÁfVÁF˜'í¿¢FV'Vt∆ˆr¿¢&Vg&W6ÑóFV’67&ˆ∆¬¿¢Fñ∆U7W&f6Uîñ‰&V¿¢‰ı$‘≈ıDı¿¢ˆ÷%&Êr¿¢˜6VVDg&ˆ’7G&ñÊr¿¢fñÊE¶ˆÊTf∆DV◊GïFñ∆W2¿¢vWE&VvVÁE∆ÁD÷FW&ñ¬¿¢ˆw&74&∆FTvVÚ¿¢˜¶ˆÊU66VÊW2¿¢˜¶ˆÊU&VvVÁDˆ&¶V7G2¿¢˜¶ˆÊU&VvVÁD÷W6Ñw&˜W2¿¢˜¶ˆÊU&VvVÁEW'6ó7B¿¢ˆó5¶ˆÊT&V¿¢vWD7W'&VÁD&V¢Çí”‚7W'&VÁD&V¿¢“ì∞†¢vñÊF˜r‰FWufG3ÚÊñÊóBá∞¢4Ù≈2¿¢$ıu2¿¢Fñ∆UGóR¿¢ïDT’ÙDTe2¿¢ñÁfVÁF˜'í¿¢&ˆ6W76ñÊtgW&ÊóGW&Tˆ&¶V7G2¿¢$Ù4U54î‰uÙeU$‰ïEU$UÙDTe2¿¢$Ù4U54î‰uı4eÖÙ¥Uí¿¢vWDw&ñC¢Çí”‚w&ñB¿¢vWE66VÊS¢vWD7FófU66VÊR¿¢vWEv˜&∆Dˆ&¶V7DB¿¢ó4Ü˜W6Tfˆ˜G&ñÁB¿¢Fñ∆U7W&f6Uí¿¢7&VGW&U∆ÊTw&˜VÊDˆfg6WB¿¢ÊV&W7DÊv∆T÷ˆÊr¿¢6÷W&&V∆FófUW'2¿¢W'6∆◊¢vñÊF˜rÂW'&˜FFñˆ‚ÁW'6∆◊¿¢Êv∆TFñfb¿¢FWtóFV‘∂Wí¿¢VÁ7W&U&ˆ6W76VDóFV‘FVb¿¢vWE&ˆ6W76ñÊt˜WGWG2¿¢Ü4f&’W&÷ó76ñˆ‚¿¢∆ˆEv˜&∆D∆ófW7Fˆ6≥¢ˆ∆ˆEv˜&∆D∆ófW7Fˆ6≤¿¢6fUv˜&∆D∆ófW7Fˆ6≥¢˜6fUv˜&∆D∆ófW7Fˆ6≤¿¢6fTf&‘∆ñ˜WB¿¢&ÊB¿¢“ì∞†¢vñÊF˜rÂvñ∆D&W'&ñW3ÚÊñÊóBá∞¢$U%%ïÙ4Ùƒı%2¿¢ïDT’ÙDTe2¿¢‰ı$‘≈ıDı¿¢7&˜FF¿¢ñÁfVÁF˜'í¿¢ˆw&74&∆FTvVÚ¿¢˜¶ˆÊU66VÊW2¿¢˜¶ˆÊT&W''î÷W6Ñw&˜W2¿¢˜¶ˆÊT&W''îˆ&¶V7G2¿¢˜¶ˆÊT&W''ïW'6ó7B¿¢˜¶ˆÊU&VvVÁEW'6ó7B¿¢6∆VÊF"¿¢FV'Vt∆ˆr¿¢vWD7W'&VÁD&V¢Çí”‚7W'&VÁD&V¿¢ó5¶ˆÊT&V¢ˆó5¶ˆÊT&V¿¢ˆ÷%&Êr¿¢˜6VVDg&ˆ’7G&ñÊr¿¢fñÊE¶ˆÊTf∆DV◊GïFñ∆W2¿¢vWE&VvVÁE∆ÁD÷FW&ñ¬¿¢&Vg&W6ÑóFV’67&ˆ∆¬¿¢Fñ∆U7W&f6Uîñ‰&V¿¢“ì∞†¢vñÊF˜rÂvñ∆EG&V7W&SÚÊñÊóBá∞¢6∆VÊF"¿¢&ÊB¿¢dU$Dîu$ï5Ù‘UD≈Ù¥Uï2¿¢vWD∆ˆ˜Eˆˆ«3¢Çí”‚ˆ∆ˆ˜Eˆˆ«2¿¢∆ˆ˜E6Ü˜v˜&∆E7FFS¢ˆ∆ˆ˜E6Ü˜v˜&∆E7FFR¿¢’ï5DU%ïÙEîUÙïDT’Ù¥UïÙ%ïıÙÙ¬¿¢vWE7F˜&T6∆˜FÜñÊuñV6W3¢Çí”‚5Dı$UÙ4ƒıDÑî‰uıîT4U2¿¢6∆˜FÜñÊu7&óFTf˜$6˜6÷WFñ3¢vñÊF˜r‰WVó÷VÁEÊV¬Ê6∆˜FÜñÊu7&óFTf˜$6˜6÷WFñ2¿¢˜¶ˆÊU66VÊW2¿¢ˆ÷%&Êr¿¢˜6VVDg&ˆ’7G&ñÊr¿¢˜¶ˆÊU&VvVÁEW'6ó7B¿¢˜¶ˆÊT&W''ïW'6ó7B¿¢fñÊE¶ˆÊTf∆DV◊GïFñ∆W2¿¢ƒDTUıT‰ïB¿¢‰ı$‘≈ıDı¿¢E$T‰4ÖıDı¿¢Fñ∆UGóR¿¢÷WFƒ&$óFV‘∂Wí¿¢ñÁfVÁF˜'í¿¢ïDT’ÙDTe2¿¢‘UD≈ÙDTe2¿¢vWE6¥6∆˜FÜñÊs¢Çí”‚6¥6∆˜FÜñÊr¿¢˜¶ˆÊUG&V7W&T÷W6Ñw&˜W2¿¢˜¶ˆÊUG&V7W&Tˆ&¶V7G2¿¢˜¶ˆÊUG&V7W&UW'6ó7B¿¢&Vg&W6ÑóFV’67&ˆ∆¬¿¢'Vñ∆DñÁfVÁF˜'îw&ñB¿¢'Vñ∆E6¥6∆˜FÜñÊu6V7Fñˆ„¢vñÊF˜r‰WVó÷VÁEÊV¬Ê'Vñ∆E6¥6∆˜FÜñÊu6V7Fñˆ‚¿¢FV'Vt∆ˆr¿¢ó5¶ˆÊT&V¢ˆó5¶ˆÊT&V¿¢vWD7W'&VÁD&V¢Çí”‚7W'&VÁD&V¿¢DîƒR¿¢∆ñW"¿¢7FñˆÂ'Fñ6∆W2¿¢5DîÙÂÙeÖÙƒî‘ïB¿¢“ì∞†¢vñÊF˜r‰f&‘Êñ÷«3ÚÊñÊóBá∞¢4Ù≈2¿¢$ıu2¿¢DîƒR¿¢Fñ∆UGóR¿¢5$TEU$UÙD"¿¢5$TEU$UıU%ÙDTEı$C¢vñÊF˜rÂW'&˜FFñˆ‚‰5$TEU$UıU%ÙDTEı$B¿¢ïDT’ÙDTe2¿¢ƒïdU5DÙ4µı$U4ıU$4UÙDTe2¿¢ƒïdU5DÙ4µı$U4ıU$4UıdU$"¿¢ƒïdU5DÙ4µÙïDT’Ù¥î‰E2¿¢UT‘¥ÙîïÙDTdT≈EÙDUuÙ4Ùƒı"¿¢UT‘¥ÙîïÙDUuÙ4ÙÙƒDıtÂÙDï2¿¢Êñ÷ƒˆ&¶V7G2¿¢6∆VÊF"¿¢ñÁfVÁF˜'í¿¢∆ñW"¿¢66VÊR¿¢v˜&∆Dˆ&¶V7G2¿¢Êv∆TFñfb¿¢6÷W&6ˆÊfñr¿¢6÷W&&V∆FófT7&VGW&UW'2¿¢6÷W&&V∆FófUW'2¿¢6∆◊ñÁfVÁF˜'ï7F6≤¿¢6ˆ◊Êñˆ‰ïGóTf˜$∂ñÊB¿¢7&VGW&U∆ÊTw&˜VÊDˆfg6WB¿¢fñÊD˜VÂFñ∆TÊV$&&„¢vñÊF˜r‰f&‘'Vñ∆FñÊw2ÊfñÊD˜VÂFñ∆TÊV"¿¢vWEv˜&∆Dˆ&¶V7DB¿¢Ü4f&’W&÷ó76ñˆ‚¿¢ó56ˆ∆ñB¿¢ÊV&W7DÊv∆T÷ˆÊr¿¢W'6∆◊¢vñÊF˜rÂW'&˜FFñˆ‚ÁW'6∆◊¿¢&W6ˆ«fT7&VGW&Tw&˜VÊDÊ6Ü˜%&FñÚ¿¢&ÊB¿¢6fU7F&∆R¿¢6Ü˜uFˆ7B¿¢Fñ∆U7W&f6Uí¿¢ˆWFÙ76ñvÂ7F&∆U&ˆ∆R¿¢ˆ÷&µÊu∆ÊR¿¢ˆ∆ˆEv˜&∆D'&VVFñÊuó'2¿¢˜6fUv˜&∆D'&VVFñÊuó'2¿¢∆ˆEv˜&∆D∆ófW7Fˆ6≥¢ˆ∆ˆEv˜&∆D∆ófW7Fˆ6≤¿¢6fUv˜&∆D∆ófW7Fˆ6≥¢˜6fUv˜&∆D∆ófW7Fˆ6≤¿¢vWD&&ÂFñW'3¢Çí”‚$$ÂıDîU%2¿¢vWE∆ñW$FF¢Çí”‚˜∆ñW$FF¿¢vWDw&ñC¢Çí”‚w&ñB¿¢vWDf&‘'Vñ∆FñÊw3¢Çí”‚f&‘'Vñ∆FñÊw2¿¢vWE7F&∆S¢Çí”‚7F&∆R¿¢vWD7W'&VÁD&V¢Çí”‚7W'&VÁD&V¿¢vWDf6ñÊtÊv∆S¢Çí”‚f6ñÊtÊv∆R¿¢6WDf6ñÊtÊv∆S¢ábí”‚≤f6ñÊtÊv∆R“c≤“¿¢vWD6÷W&÷ˆFS¢Çí”‚7FófT6÷W&÷ˆFR¿¢6WD6÷W&÷ˆFS¢ábí”‚≤7FófT6÷W&÷ˆFR“c≤“¿¢vWD6÷W&F&vWC¢Çí”‚7FófT6÷W&F&vWB¿¢6WD6÷W&F&vWC¢ábí”‚≤7FófT6÷W&F&vWB“c≤“¿¢6WEv˜&∆D∆ófW7Fˆ6¥g&÷T66ÜS¢ábí”‚≤˜v˜&∆D∆ófW7Fˆ6¥g&÷T66ÜR“c≤“¿¢“ì∞†¢vñÊF˜r‰f&‘'Vñ∆FñÊw3ÚÊñÊóBá∞¢4Ù≈2¿¢$ıu2¿¢Fñ∆UGóR¿¢Êñ÷ƒˆ&¶V7G2¿¢6∆◊ñÁfVÁF˜'ï7F6≤¿¢FV'Vt∆ˆr¿¢Ü4f&’W&÷ó76ñˆ‚¿¢ñÁfVÁF˜'í¿¢∆ˆDÜ˜W6UñV6Tf6UFWáGW&S¢vñÊF˜rÂF˜vÂ¶ˆÊT'Vñ∆FñÊw2Ê∆ˆDÜ˜W6UñV6Tf6UFWáGW&R¿¢÷&µFñ∆TFó'Gí¿¢˜V‰÷VÁR¿¢&V6ˆ◊WFUvFW"¿¢6fTf&‘∆ñ˜WB¿¢6fT÷V÷&W%v˜&∆DFF¿¢66VÊR¿¢v˜&∆Dˆ&¶V7G2¿¢Ü˜W6Uv∆ƒ'Vñ∆FW"¿¢∆ˆEv˜&∆D∆ófW7Fˆ6≥¢ˆ∆ˆEv˜&∆D∆ófW7Fˆ6≤¿¢6fUv˜&∆D∆ófW7Fˆ6≥¢˜6fUv˜&∆D∆ófW7Fˆ6≤¿¢vWD&&ÂFñW'3¢Çí”‚$$ÂıDîU%2¿¢vWDw&ñC¢Çí”‚w&ñB¿¢vWDÜ˜W6UñV6U&V7G3¢Çí”‚vñÊF˜r‰Ü˜W6UñV6W2ÊvWEñV6U&V7G2Çí¿¢vWDf&‘'Vñ∆FñÊw3¢Çí”‚f&‘'Vñ∆FñÊw2¿¢6WDf&‘'Vñ∆FñÊw3¢ábí”‚≤f&‘'Vñ∆FñÊw2“c≤“¿¢6WDf&‘∆ófW7Fˆ6¥fˆ7W4&&‰ñC¢ábí”‚≤ˆf&‘∆ófW7Fˆ6¥fˆ7W4&&‰ñB“c≤“¿¢“ì∞†¢vñÊF˜r‰Ü˜W6UñV6W3ÚÊñÊóBá∞¢4Ù≈2¿¢$ıu2¿¢Fñ∆UGóR¿¢6∆◊ñÁfVÁF˜'ï7F6≤¿¢FV'Vt∆ˆr¿¢Ü4f&’W&÷ó76ñˆ‚¿¢ñÁfVÁF˜'í¿¢∆ˆDÜ˜W6UñV6Tf6UFWáGW&S¢vñÊF˜rÂF˜vÂ¶ˆÊT'Vñ∆FñÊw2Ê∆ˆDÜ˜W6UñV6Tf6UFWáGW&R¿¢÷&µFñ∆TFó'Gí¿¢˜V‰÷VÁR¿¢&V6ˆ◊WFUvFW"¿¢vWDw&ñC¢Çí”‚w&ñB¿¢6fTf&‘∆ñ˜WB¿¢6fT÷V÷&W%v˜&∆DFF¿¢66VÊR¿¢v˜&∆Dˆ&¶V7G2¿¢Ü˜W6Uv∆ƒ'Vñ∆FW"¿¢7F'E66VÊUG&Á6óFñˆ‚¿¢VÁFW$ñÁFW&ñ˜"¿¢ˆÂñV6TvVˆ÷WG'î6ÜÊvVC¢Çí”‚&V'Vñ∆DñÁFW&ñ˜$vVˆ÷WG'íÇí¿¢G&Á6f˜&‘gW&ÊóGW&UvóFÑÜ˜W6UñV6R¿¢&V6˜fW$gW&ÊóGW&Tñ‰ñÁFW&ñ˜%&V7C¢Ü3¬#¬r¬Çí”‚&V6˜fW$gW&ÊóGW&Tñ‰ñÁFW&ñ˜%&V7BÜ3¬#¬r¬Çí¿¢vWEñV6T6F∆ˆs¢Çí”‚ÑıU4UıîT4UÙ4DƒÙr¿¢vWDÜ˜W6UñV6W3¢Çí”‚Ü˜W6UñV6W2¿¢6WDÜ˜W6UñV6W3¢ábí”‚≤Ü˜W6UñV6W2“c≤“¿¢vWDf&‘'Vñ∆FñÊw3¢Çí”‚f&‘'Vñ∆FñÊw2¿¢“ì∞†¢vñÊF˜r‰7&VGW&TFVFÉÚÊñÊóBá∞¢DîƒR¿¢4Ù≈2¿¢$ıu2¿¢6∆◊¿¢6‰ˆ67WîB¿¢6Ü&7FW$w&˜VÊE6ÜF˜u7W&f6Tˆfg6WB¿¢Fñ∆U7W&f6Uîñ‰&V¿¢6˜'6Tˆ&¶V7G2¿¢vWD7W'&VÁD&V¢Çí”‚7W'&VÁD&V¿¢vWDw&ñC¢Çí”‚w&ñB¿¢“ì∞†¢vñÊF˜r‰f&‘7&FW3ÚÊñÊóBá∞¢$4Uı$î4U2¿¢‘ı$‰î‰uÙÑıU"¿¢4Tƒ≈ÙîÂDU%d≈ÙÑıU%2¿¢5U≈ïÙ4DƒÙr¿¢Fñ∆UGóR¿¢ñÁfVÁF˜'í¿¢6∆VÊF"¿¢6∆◊ñÁfVÁF˜'ï7F6≤¿¢vWD7FófTñÁfVÁF˜'îóFV“¿¢óFV‘ñ6ˆ‰f˜$∂Wí¿¢vWDÜ˜W#¢vñÊF˜r‰6∆VÊF%7ó7FV“ÊvWDÜ˜W"¿¢Ü4f&’W&÷ó76ñˆ‚¿¢˜V‰÷VÁR¿¢6Ü˜uFˆ7B¿¢6fT÷V÷&W%v˜&∆DFF¿¢'Vñ∆DñÁfVÁF˜'îw&ñB¿¢'Vñ∆E6ÜóñÊuG&Á6fW%Tì¢Çí”‚vñÊF˜rÂ6ÜóñÊuÊV¬Ê'Vñ∆BÇí¿¢Fñ∆U7W&f6Uí¿¢66VÊR¿¢vWDFV∆ófW'î∆ˆs¢Çí”‚FV∆ófW'î∆ˆr¿¢vWEVÊFñÊt˜&FW'3¢Çí”‚VÊFñÊt˜&FW'2¿¢vWD÷VÁT˜V„¢Çí”‚÷VÁT˜V‚¿¢“ì∞†¢vñÊF˜rÂ&ˆ6VGW&≈F6∑3ÚÊñÊóBá∞¢dï4ÖÙDTe2¿¢5$TEU$UÙD"¿¢vWD∆ˆ˜Eˆˆ«3¢Çí”‚ˆ∆ˆ˜Eˆˆ«2¿¢ïDT’ÙDTe2¿¢Fˆˆƒ÷7FW'î∆WfV¬¿¢WVó÷VÁE6∆˜G2¿¢6∆VÊF"¿¢6WEVW7E7FGW2¿¢vWEVW7E&ˆw&W73¢Çí”‚VW7E&ˆw&W72¿¢Á5v∆∂W'2¿¢ñÁfVÁF˜'í¿¢6∆◊ñÁfVÁF˜'ï7F6≤¿¢6Ü˜uFˆ7B¿¢“ì∞†¢vñÊF˜r‰&˜VÁGî&ˆ&CÚÊñÊóBá∞¢vWEVW7E&ˆw&W73¢Çí”‚VW7E&ˆw&W72¿¢6WEVW7E7FGW2¿¢6Ü˜uFˆ7B¿¢ñÁfVÁF˜'í¿¢6∆VÊF"¿¢t‘ı§Ù‰UÙƒ$T≈2¿¢÷∂UF6¥ñC¢vñÊF˜rÂ&ˆ6VGW&≈F6∑2Ê÷∂UF6¥ñB¿¢“ì∞†¢vñÊF˜r‰&ÊFóD6◊3ÚÊñÊóBá∞¢6∆◊¿¢&ÊB¿¢FV'Vt∆ˆr¿¢DîƒR¿¢Fñ∆UGóR¿¢tDU%tïıEïU2¿¢UÖDU$îı%ı§Ù‰U2¿¢‰ı$‘≈ıDı¿¢¶ˆÊT∆ñ˜WG3¢˜¶ˆÊT∆ñ˜WG2¿¢¶ˆÊU66VÊW3¢˜¶ˆÊU66VÊW2¿¢&Vg&W6Ö¶ˆÊTw&˜VÊEfó7V«2¿¢÷&¥˜WF∆ñÊS¢ˆ÷&¥˜WF∆ñÊR¿¢÷∂TFV6˜&FófTgW&ÊóGW&T÷W6Ç¿¢Fñ∆U7W&f6Uîñ‰&V¿¢Ü˜7Fñ∆Tˆ&¶V7G2¿¢6ˆ◊Êñˆ‰ˆ&¶V7G2¿¢6˜'6Tˆ&¶V7G2¿¢ó5¶ˆÊT&V¢ˆó5¶ˆÊT&V¿¢ó4FVÂ6¥∆ófS¢vñÊF˜rÂvñ∆F∆ñfU7v‚Êó4FVÂ6¥∆ófR¿¢FV‰∂Wîf˜#¢vñÊF˜rÂvñ∆F∆ñfU7v‚ÊFV‰∂Wîf˜"¿¢∆ñW"¿¢6Ü˜u¶ˆÊT&ÊÊW"¿¢6Ü˜uFˆ7B¿¢&ˆ∆ƒ∆ˆ˜Eˆˆ¬¿¢&Vg&W6ÑóFV’67&ˆ∆¬¿¢'Vñ∆DñÁfVÁF˜'îw&ñB¿¢&Vg&W6Ñ7Fñˆ‰&"¿¢6fT÷V÷&W%v˜&∆DFF¿¢FW7v‰7&VGW&R¿¢'Vñ∆E6¥6∆˜FÜñÊu6V7Fñˆ„¢vñÊF˜r‰WVó÷VÁEÊV¬Ê'Vñ∆E6¥6∆˜FÜñÊu6V7Fñˆ‚¿¢vWDGñT6F∆ˆs¢vñÊF˜r‰GñU7ó7FV“ÊvWD6F∆ˆr¿¢GñUFÙ6∆˜FÜñÊt6ˆ∆˜#¢vñÊF˜r‰GñU7ó7FV“ÁFÙ6∆˜FÜñÊt6ˆ∆˜"¿¢6∆˜FÜñÊu7&óFTf˜$6˜6÷WFñ3¢vñÊF˜r‰WVó÷VÁEÊV¬Ê6∆˜FÜñÊu7&óFTf˜$6˜6÷WFñ2¿¢DUeÙ$T‰ı§Ù‰UÙîC¢vñÊF˜r‰FWe7vÊW"‰DUeÙ$T‰ı§Ù‰UÙîB¿¢7FófT&˜VÁGîf˜%¶ˆÊS¢á¶ˆÊTñBí”‚vñÊF˜r‰&˜VÁGî&ˆ&BÊ7FófT&˜VÁGîf˜%¶ˆÊRá¶ˆÊTñBí¿¢vWD7W'&VÁD&V¢Çí”‚7W'&VÁD&V¿¢vWD7Fñˆ‰ÜV∆DF˜v„¢Çí”‚7Fñˆ‰ÜV∆DF˜v‚¿¢vWE6¥6∆˜FÜñÊs¢Çí”‚6¥6∆˜FÜñÊr¿¢vWE7F˜&T6∆˜FÜñÊuñV6W3¢Çí”‚5Dı$UÙ4ƒıDÑî‰uıîT4U2¿¢“ì∞¢fóEFÙ7V7BÇì∞¢&W6ó¶T6Áf2Çì∞¢&Vg&W6Ñ7Fñˆ‰&"Çì∞¢&Vg&W6ÑóFV’67&ˆ∆¬Çì∞¢G'í≤ñÊóEv˜&∆Dˆ&¶V7G2Çì≤“6F6ÇÜRí≤6ˆÁ6ˆ∆RÊW'&˜"ÇvñÊóEv˜&∆Dˆ&¶V7G3¢r¬Rì≤–¢ÚÚ«í6fVBˆ&¶V7B˜6óFñˆÁ2ÊBgW&ÊóGW&RgFW"v˜&∆Bˆ&¶V7G2&R7&VFV@¢G'í≤«îf&‘∆ñ˜WDˆ&¶V7G2Ü∆ˆDf&‘∆ñ˜WBÇíì≤“6F6ÇÜRí≤6ˆÁ6ˆ∆RÊW'&˜"Çv«îf&‘∆ñ˜WDˆ&¶V7G3¢r¬Rì≤–¢ÚÚG&Á6óFñˆ‚7˜G2≤6Ü&VBÂ2&˜WFW2g&ˆ“FÜR÷VFóF˜ ¢G'í≤ñÊóEv˜&∆EG&fV¬Ü∆ˆDf&‘∆ñ˜WBÇíì≤“6F6ÇÜRí≤6ˆÁ6ˆ∆RÊW'&˜"ÇvñÊóEv˜&∆EG&fV√¢r¬Rì≤–¢ÚÚVÁ7W&Rf&ﬁ(i'F˜v‚G&Á6óFñˆ‚«vó2WÜó7G2WfV‚vóFÜ˜WB÷VFóF˜"FF¢ñbÇv˜&∆EG&Á6óFñˆÁ2Á6ˆ÷RáB”‚BÁF&vWB””“wF˜v‚ríí∞¢v˜&∆EG&Á6óFñˆÁ2ÁW6Çá≤ñC¢w7ˆf&’˜Fı˜F˜v‚r¬∆&V√¢uFÚF˜v‚r¬&V¢vf&“r¬6ˆ√¢r¬&˜s¢¬F&vWC¢wF˜v‚r¬F&vWD6ˆ√¢#¬F&vWE&˜s¢CÇ“ì∞¢'Vñ∆EG&Á6óFñˆ‰÷&∂W'2Çì∞¢–¢ÚÚ∆ˆBF˜v‚∆ñ˜WBg&ˆ“v˜&∑76R6ˆÊfñrÜWFÜ˜&óFFófR6˜W&6Rê¢vñÊF˜r‰◊W6ñ3ÚÊ∆ˆDVFñÙ7VTñÊFWÜW2ÇíÁFÜV‚ÇÇí”‚vñÊF˜r‰◊W6ñ3ÚÁ&W6WD÷&ñVÁD7VUFñ÷W"ÇííÊ6F6ÇÇÇí”‚vñÊF˜r‰◊W6ñ3ÚÁ&W6WD÷&ñVÁD7VUFñ÷W"Çíì∞¢ˆ∆ˆEF˜v‰g&ˆ’v˜&∑76RÇíÊ6F6ÇÇÇí”‚∑“ì∞¢FV'Vt∆ˆrÇv6Áf2&W6ó¶VB¬7∆óBvñFR◊67&VV‚∆ñ˜WB7FófR¬6ˆÁG&ˆ«2&˜VÊB¬Êñ÷Fñˆ‚∆ˆ˜&WVW7FVBrì∞†¢ÚÚ)H)HˆÊ&ˆ&FñÊrvFR)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢∆WBv÷U7F'FVB“f«6S∞¢vñÊF˜rÂıˆÜˆ'VÊ¶îv÷U7F'FVB“f«6S∞†¢7ñÊ2gVÊ7Fñˆ‚7vÂ∆ñW$fF"á∆ñW$FFí∞¢ÚÚ&W7F˜&RFÜó2v˜&∆Bw26fVBFFR˜Fñ÷R˜vVFÜW"á6VP¢ÚÚˆ∆ˆEv˜&∆D6∆VÊF"ı˜6fUv˜&∆D6∆VÊF"í&Vf˜&RÁóFÜñÊr&VG0¢ÚÚ6∆VÊF"ÊFí(	B6ÜV6µF˜FÜ≈6ÜñgBÇí&V∆˜rFW&ófW2FÜR7W'&VÁ@¢ÚÚF˜FÜ¬ñV"g&ˆ“óB¬6ÚFÜó2Ü2FÚ∆ÊBfó'7B˜"FÜR6ÜñgB6ÜV6∞¢ÚÚ'VÁ2vñÁ7BFÜRßW7B◊&W6WB$Fí"FVfV«BñÁ7FVBˆbvÜW&WfW ¢ÚÚFÜRv˜&∆B7GV∆«í∆VgBˆfb‡¢6ˆÁ7B˜6fVD6∆VÊF"“ˆ∆ˆEv˜&∆D6∆VÊF"Çì∞¢ñbÖ˜6fVD6∆VÊF"íˆ&¶V7BÊ76ñv‚Ü6∆VÊF"¬˜6fVD6∆VÊF"ì∞†¢ÚÚfó&R÷ÊB÷f˜&vWC¢FÜRF˜FÜ¬6ÜñgBBv˜&∆B7F'BÜ˜"ˆ‚Áí÷ó76V@¢ÚÚñV"6ñÊ6R∆7B∆ñVBí6‚F∂RfWr6V6ˆÊG27&˜72∆¬f˜W ¢ÚÚ¶ˆÊW2¬'WBÊ˜FÜñÊrÜW&RÊVVG2FÚ&∆ˆ6≤ˆ‚óB(	B¶ˆÊRˆÊ«íÊVVG0¢ÚÚFÚ&R&W6ÜVB'íFÜRFñ÷RFÜR∆ñW"7GV∆«ív∆∑2ñÁFÚóB‡¢6ÜV6µF˜FÜ≈6ÜñgBÇì∞†¢ÚÚFÜR÷ˆGV∆R÷∆WfV¬ñÊóB&˜fR∆ˆFVBFÜRf&“∆ñ˜WBáFñ∆W2ˆ7&˜2Ê@¢ÚÚgW&ÊóGW&Rˆ7&FR˜6óFñˆÁ2íVÊFW"FÜR∆Vv7íVÊÊ÷W76VB∂Wí¬6ñÊ6P¢ÚÚv˜&∆DñBv6‚wB∂Ê˜v‚ñWBBFÜBˆñÁB‚Ê˜rFÜB∆ñW$FFÁv˜&∆Dñ@¢ÚÚó2∂Ê˜v‚¬&VFÚßW7BFÜB'BvñÁ7BFÜR6˜'&V7F«í÷Ê÷W76V@¢ÚÚW"◊v˜&∆B∂Wí6Ú6W&FRv˜&∆G2ÊWfW"&∆VVBñÁFÚV6Ç˜FÜW"w2f&–¢ÚÚÜ÷ó'&˜'2Fı&W6WBÇíw2&VvVÊW&FR◊FÜV‚÷«íGFW&‚&V∆˜rí‚G&Á6óFñˆÁ2¢ÚÚ&˜WFW2ÙÂ266ÜVGV∆W2&R6Ü&VBWFÜ˜&VB÷6ˆÁFVÁB¬Ê˜BW"◊v˜&∆@¢ÚÚ7FFR¬6ÚñÊóEv˜&∆EG&fV¬Çíó2FV∆ñ&W&FV«í‰ıB&VFˆÊRÜW&R(	Bó@¢ÚÚ«&VGí&‚ˆÊ6RB÷ˆGV∆RñÊóB¬ÊB7vÂ66ÜVGV∆VDÁ72Çíó6‚w@¢ÚÚñFV◊˜FVÁBÜóBVÊG2FÚÁ5v∆∂W'2vóFÇÊÚ6∆V"7FWí¬6Ú6∆∆ñÊp¢ÚÚóBvñ‚v˜V∆B7v‚WfW'í66ÜVGV∆VBÂ26V6ˆÊBFñ÷R‡¢6∆V%∆6VE&ˆ6W76ñÊtgW&ÊóGW&RÇì∞¢6∆V$ñÁFW&ñ˜$gW&ÊóGW&RÇì∞¢vñÊF˜r‰f&‘'Vñ∆FñÊw2Ê6∆V$∆¬Çì∞¢ÚÚ÷ˆGV∆RñÊóB÷íÜfR∆6VBÜ˜W6RñV6W2W"FÜR∆Vv7í÷∂Wê¢ÚÚ∆ñ˜WB(	B6∆V"FÜV“Ê˜rá6÷R2f&‘'Vñ∆FñÊw2Ê6∆V$∆¬ÇíßW7@¢ÚÚ&˜fRí6ÚFÜR&W6WB∆ˆ˜&V∆˜rFˆW6‚wB6∆¬Á&W6WBÇíˆ‚ñV6P¢ÚÚFÜó2v˜&∆BÜ6‚wB7GV∆«íV&ÊVC≤FÜR7F'FW"ñV6Ró2&W6VVFV@¢ÚÚg&W6Ç&ñváBgFW"FÜB∆ˆ˜¬BóG2Ü&BFVfV«B¬&Vf˜&R«ññÊp¢ÚÚÜ˜"Ê˜BfñÊFñÊríFÜó2v˜&∆Bw2˜v‚6fVB˜6óFñˆ‚(	B6÷R&FñˆÊ∆P¢ÚÚ2FÜR6V∆¬7&FR˜7W«í&˜Ç&W6WBñ÷÷VFñFV«í&V∆˜r‡¢vñÊF˜r‰Ü˜W6UñV6W2Ê6∆V$∆¬Çì∞¢v˜&∆Dˆ&¶V7G2Êf˜$V6ÇÜÚ”‚ÚÁ&W6WBbbÚÁ&W6WBÇíì∞¢vñÊF˜r‰Ü˜W6UñV6W2Á6VVE7F'FW"ÑÑıU4Uı5D%DU%Ù4Ù¬¬ÑıU4Uı5D%DU%ı$ırì∞¢&V'Vñ∆DñÁFW&ñ˜$vVˆ÷WG'íÇì∞¢w&ñB“7&VFTñÊóFñƒw&ñBÇì∞¢ÚÚ÷ˆGV∆RñÊóB«&VGí÷íÜfR÷˜fVBFÜR6ÜóñÊr˜7W«í7&FW2W"FÜP¢ÚÚ∆Vv7í÷∂Wí∆ñ˜WB(	BWBFÜV“&6≤FÚFÜVó"Ü&BFVfV«G2&Vf˜&P¢ÚÚ«ññÊrÜ˜"Ê˜BfñÊFñÊríFÜó2v˜&∆Bw2˜v‚6fVB˜6óFñˆÁ2¬6Ú¢ÚÚ'&ÊB÷ÊWrv˜&∆B6‚wBñÊÜW&óBÊ˜FÜW"v˜&∆Bw27&FR∆6V÷VÁB‡¢6ˆÁ7BDTdT≈Eı4Tƒ≈Ù5$DUÙ4Ù¬“"¬DTdT≈Eı4Tƒ≈Ù5$DUı$ır“$ıu2“3∞¢6ˆÁ7BDTdT≈Eı5U≈ïÙ$ıÖÙ4Ù¬“B¬DTdT≈Eı5U≈ïÙ$ıÖı$ır“$ıu2“3∞¢ñbá6ÜóñÊt&˜Ñˆ&¶V7Bbbá6ÜóñÊt&˜Ñˆ&¶V7BÊ6ˆ¬”“DTdT≈Eı4Tƒ≈Ù5$DUÙ4Ù¬«¬6ÜóñÊt&˜Ñˆ&¶V7BÁ&˜r”“DTdT≈Eı4Tƒ≈Ù5$DUı$ıríí∞¢v˜&∆Dˆ&¶V7G2ÊFV∆WFRá6ÜóñÊt&˜Ñˆ&¶V7BÊ6ˆ¬≤r¬r≤6ÜóñÊt&˜Ñˆ&¶V7BÁ&˜rì∞¢6ˆÁ7BÊ2“vñÊF˜r‰f&‘7&FW2Ê÷∂U6V∆ƒ7&FRÑDTdT≈Eı4Tƒ≈Ù5$DUÙ4Ù¬¬DTdT≈Eı4Tƒ≈Ù5$DUı$ırì∞¢6ÜóñÊt&˜Ñˆ&¶V7B“Ê3≤v˜&∆Dˆ&¶V7G2Á6WBÜÊ2Ê6ˆ¬≤r¬r≤Ê2Á&˜r¬Ê2ì∞¢–¢ñbá7W«î&˜Ñˆ&¶V7Bbbá7W«î&˜Ñˆ&¶V7BÊ6ˆ¬”“DTdT≈Eı5U≈ïÙ$ıÖÙ4Ù¬«¬7W«î&˜Ñˆ&¶V7BÁ&˜r”“DTdT≈Eı5U≈ïÙ$ıÖı$ıríí∞¢v˜&∆Dˆ&¶V7G2ÊFV∆WFRá7W«î&˜Ñˆ&¶V7BÊ6ˆ¬≤r¬r≤7W«î&˜Ñˆ&¶V7BÁ&˜rì∞¢6ˆÁ7BÊ"“vñÊF˜r‰f&‘7&FW2Ê÷∂U7W«î&˜ÇÑDTdT≈Eı5U≈ïÙ$ıÖÙ4Ù¬¬DTdT≈Eı5U≈ïÙ$ıÖı$ırì∞¢7W«î&˜Ñˆ&¶V7B“Ê#≤v˜&∆Dˆ&¶V7G2Á6WBÜÊ"Ê6ˆ¬≤r¬r≤Ê"Á&˜r¬Ê"ì∞¢–¢6ˆÁ7B˜v˜&∆D∆ñ˜WB“∆ˆDf&‘∆ñ˜WBÇì∞¢ñbÖ˜v˜&∆D∆ñ˜WBí«îf&‘∆ñ˜WEFÙw&ñBÖ˜v˜&∆D∆ñ˜WBì∞¢«îf&‘∆ñ˜WDˆ&¶V7G2Ö˜v˜&∆D∆ñ˜WBì≤ÚÚ&W˜6óFñˆÁ2vñ‚ñbDÑï2v˜&∆B6fVB7W7Fˆ“7&FR˜6óFñˆÁ0¢ÚÚ6VVB7F'FW"&VBñ‚FÜRf&÷Ü˜W6Rf˜"'&ÊB÷ÊWrv˜&∆B(	B6∆VWñ‰&VBÇê¢ÚÚá6VRvWDñÁFW&ñ˜$ñÁFW&7F&∆TBíÊVVG26ˆ÷WvÜW&RFÚ6∆VW¬ÊBg&W6Ä¢ÚÚ∆ñW"Ü2ÊÚ&VBóFV“ñ‚ñÁfVÁF˜'íñWBFÚ'Wí∑∆6RˆÊRFÜV◊6V«fW2‡¢ÚÚvFVBˆ‚FÜó2v˜&∆BÜfñÊrÊÚ6fVB∆ñ˜WBB∆¬¬6ÚóBÊWfW ¢ÚÚ&R÷V'2f˜"&WGW&ÊñÊr∆ñW"¬ñÊ6«VFñÊrˆÊRvÜÚ÷˜fVB˜ ¢ÚÚ&V÷˜fVBFÜVó"7F'FW"&VBÜf&‘∆ñ˜WD∂WíÇíó2W"◊v˜&∆B¬6ÚFÜó0¢ÚÚ6ÜV6≤Ü2FÚÜV‚ÜW&R(	BgFW"∆ñW$FFÁv˜&∆DñBó2∂Ê˜v‚(	@¢ÚÚ&FÜW"FÜ‚B÷ˆGV∆RñÊóB¬vÜW&RóBv˜V∆B6fRVÊFW"FÜRw&ˆÊr¿¢ÚÚÊ˜B◊ñWB÷Ê÷W76VB∂WíÊBFÜV‚vWB6∆V&VB&ñváB&6≤˜WB'íFÜó0¢ÚÚ6÷RW"◊v˜&∆B&V∆ˆBí‡¢ñbÇ˜v˜&∆D∆ñ˜WBí∞¢G'í∞¢ÚÚ6V∆¬ßW7BñÁ6ñFRFÜR7F'FW"ñV6Rw2˜v‚F˜V&∆VBñÁFW&ñ˜ ¢ÚÚ&∆ˆ6≤Üvíg&ˆ“óG2Fˆ˜"Fá&W6Üˆ∆Bí(	B6VP¢ÚÚ&V'Vñ∆DñÁFW&ñ˜$vVˆ÷WG'íÇíÙÑıU4Uı5D%DU%Ù4Ù¬ı$ır&˜fR‡¢6ˆÁ7B&VD6ˆ¬“ÑıU4Uı5D%DU%Ù4Ù¬¢"≤¬&VE&˜r“ÑıU4Uı5D%DU%ı$ır¢"≤∞¢6ˆÁ7B7F'FW$&VB“÷∂TFV6˜&FófTgW&ÊóGW&T÷W6ÇÜ&VD6ˆ¬¬&VE&˜r¬v&6ñ4&VBr¬ñÁFW&ñ˜%66VÊR¬vñÁFW&ñ˜"rì∞¢ñbá7F'FW$&VBí∞¢ñÁFW&ñ˜$gW&ÊóGW&Tˆ&¶V7G2ÁW6Çá≤ñC¢vFV6˜%˜7F'FW%ˆ&VBr¬∂Wì¢v&6ñ4&VBr¬6ˆ√¢&VD6ˆ¬¬&˜s¢&VE&˜r¿¢÷W6É¢7F'FW$&VBÊ÷W6Ç¬∆ñváC¢7F'FW$&VBÊ∆ñváB¬6gÖ6˜W&6S¢7F'FW$&VBÁ6gÖ6˜W&6R¬&V¢vñÁFW&ñ˜"r¬&˜EîFVs¢¿¢‚‚ÊgW&ÊóGW&T˜vÊW$fñV∆G2Ü&VD6ˆ¬¬&VE&˜rí“ì∞¢6fTf&‘∆ñ˜WBÇì∞¢–¢“6F6ÇÜRí≤6ˆÁ6ˆ∆RÊW'&˜"Çw7F'FW"&VB6VVC¢r¬Rì≤–¢–¢vñÊF˜r‰f&‘Êñ÷«2Á&W7vÂv˜&∆D∆ófW7Fˆ6≤Çì≤ÚÚgFW"gW&ÊóGW&R¬6Úˆ67WÊ7í6ÜV6∑26VRfñÊ¬Fñ∆R7FFP¢&V6ˆ◊WFUvFW"Üf«6Rì∞†¢ÚÚÊˆ‚÷vV"ñÁfVÁF˜'íá&W6˜W&6W2íÊB6≤6∆˜FÜñÊr&Rv˜&∆B◊66˜V@¢ÚÚW"6Ü&7FW"(	BFÜWí7Fí&VÜñÊBñ‚FÜó2v˜&∆Bw2÷V÷&W"&V6˜&@¢ÚÚ&FÜW"FÜ‚fˆ∆∆˜vñÊrFÜR6Ü&7FW"FÚÊ˜FÜW"v˜&∆B‡¢ˆ&¶V7BÊ∂Wó2ÜñÁfVÁF˜'ííÊf˜$V6ÇÜ∂Wí”‚≤FV∆WFRñÁfVÁF˜'ï∂∂Wï”≤“ì∞¢ˆ&¶V7BÊ76ñv‚ÜñÁfVÁF˜'í¬ˆ&¶V7BÊ∂Wó2á∆ñW$FFÊÊˆ‰vV$ñÁfVÁF˜'í«¬∑“íÊ∆VÊwFÄ¢Ú≤‚‚Á∆ñW$FFÊÊˆ‰vV$ñÁfVÁF˜'í–¢¢≤‚‚Â5D%Dî‰uÙîÂdTÂDı%í“ì∞¢6¥6∆˜FÜñÊr“≤‚‚‚á∆ñW$FFÁ6¥6∆˜FÜñÊr«¬µ“ï”∞†¢ÚÚÂ2&V∆FñˆÁ6Üó2ˆ÷V÷˜'íÊBVW7B&ˆw&W72&R∆ñ∂Wvó6Rv˜&∆B◊66˜V@¢ÚÚW"6Ü&7FW"‡¢vñÊF˜r‰Fñ∆ˆwVT6ˆÁFVÁCÚÊ∆ˆDÁ5&V∆FñˆÁ6Üó2á∆ñW$FFì∞¢VW7E&ˆw&W72“≤‚‚‚á∆ñW$FFÁVW7E&ˆw&W72«¬∑“í”∞¢vñÊF˜rÂ&ˆ6VGW&≈F6∑2Ê÷ñ&U&Vg&W6Ñ&ˆ&EF6≤Çì≤ÚÚ÷∂W27W&R&ˆ&BF6≤WÜó7G2WfV‚&Vf˜&RFÜRfó'7BFí&ˆ∆∆˜fW †¢ÚÚ∆6ÜV◊ì¢Fó66˜fW&VB&VvVÁBVffV7G2¬7Fñ∆¬÷7FófR'Vfg2ˆFV'Vfg2¬Ê@¢ÚÚFˆFíw2ÜÊ˜B◊ñWB◊ñ6∂VBívñ∆FW&ÊW72&VvVÁB∆6V÷VÁG2(	B∆¿¢ÚÚv˜&∆B◊66˜VBW"6Ü&7FW"¬6÷R2FÜRfñV∆G2ßW7B&˜fR‡¢vñÊF˜r‰∆6ÜV◊ï7ó7FV“Á&W7F˜&T∂Ê˜v‰VffV7G2á∆ñW$FFÊ∆6ÜV◊î∂Ê˜v‰VffV7G2ì∞¢vñÊF˜r‰∆6ÜV◊ï7ó7FV“Á&W7F˜&T7FófTVffV7G2á∆ñW$FFÊ∆6ÜV◊î7FófTVffV7G2ì∞¢vñÊF˜rÂ&VvVÁE∆ÁG2Á&W7F˜&U¶ˆÊU&VvVÁE7FFRá∆ñW$FFÊ∆6ÜV◊ï&VvVÁE7FFRì∞¢vñÊF˜rÂvñ∆D&W'&ñW2Á&W7F˜&U7FFRá∆ñW$FFÁvñ∆D&W''ï7FFRì∞¢vñÊF˜rÂvñ∆EG&V7W&RÁ&W7F˜&U7FFRá∆ñW$FFÁ¶ˆÊUG&V7W&U7FFRì∞¢&W7F˜&U¶ˆÊTfV∆∆VEG&VU7FFRá∆ñW$FFÊfV∆∆VEG&VU7FFRì∞¢&W7F˜&U¶ˆÊT÷ñÊVE&ˆ6µ7FFRá∆ñW$FFÊ÷ñÊVE&ˆ6µ7FFRì∞¢ÚÚ˜Fñˆ‚óFV◊2ßW7B&W7F˜&VBñÁFÚñÁfVÁF˜'ñ&˜fRÜfRÊÚïDT’ÙDTe0¢ÚÚVÁG'íñWBFÜó2vR∆ˆBÑïDT’ÙDTe27F'G2V◊GíˆbFÜV“WfW'ê¢ÚÚ6W76ñˆ‚¬VÊ∆ñ∂RFÜR7FFñ2&VvVÁBˆgW&ÊóGW&Rˆfó6ÇF&∆W2í(	B&V'Vñ∆@¢ÚÚV6ÇˆÊRw2Fó7∆íÙG&ñÊ≤÷WFFF7G&ñváBg&ˆ“óG2∂Wí¬vÜñ6Ä¢ÚÚFWFW&÷ñÊó7Fñ6∆«íVÊ6ˆFW2óG2VffV7G2á6VRVÁ7W&U˜Fñˆ‰óFV‘FVbí‡¢ˆ&¶V7BÊ∂Wó2ÜñÁfVÁF˜'ííÊf˜$V6ÇÜ∂Wí”‚∞¢6ˆÁ7BVffV7G2“vñÊF˜r‰∆6ÜV◊ï7ó7FV“ÊvWE˜Fñˆ‰VffV7G4g&ˆ‘∂WíÜ∂Wíì∞¢ñbÜVffV7G2ívñÊF˜r‰∆6ÜV◊ï7ó7FV“ÊVÁ7W&U˜Fñˆ‰óFV‘FVbÜVffV7G2ì∞¢“ì∞†¢vV$ñÁfVÁF˜'í“á∆ñW$FFÊvV$ñÁfVÁF˜'íbbGóVˆb∆ñW$FFÊvV$ñÁfVÁF˜'í””“vˆ&¶V7Brê¢Ú∆ñW$FFÊvV$ñÁfVÁF˜'ê¢¢÷∂TFVfV«DvV"Çì∞¢ñbÇvV$ñÁfVÁF˜'íÁFˆˆ«2ívV$ñÁfVÁF˜'íÁFˆˆ«2“∑”∞¢ñbÇvV$ñÁfVÁF˜'íÊ6∆˜FÜñÊrívV$ñÁfVÁF˜'íÊ6∆˜FÜñÊr“≤ÜC¢ÁV∆¬¬ÜˆˆC¢ÁV∆¬¬F˜'6Û¢ÁV∆¬¬˜fW'vV#¢ÁV∆¬”∞¢ñbÇvV$ñÁfVÁF˜'íÊ6Ü&◊2ívV$ñÁfVÁF˜'íÊ6Ü&◊2“µ”∞¢ñbÇvV$ñÁfVÁF˜'íÁvÜó7F∆W2«¬vV$ñÁfVÁF˜'íÁvÜó7F∆W2Ê∆VÊwFÇí∞¢vV$ñÁfVÁF˜'íÁvÜó7F∆W2“∑≤ñC¢wvÜó7F∆Uˆ&ñÊvÚr¬7&VGW&T∂Wì¢vF&ñÊvví÷Ü˜VÊBr¬Ê÷S¢t&ñÊvÚr’”∞¢–¢ñbÇvV$ñÁfVÁF˜'íÁFˆˆƒ÷7FW'í«¬GóVˆbvV$ñÁfVÁF˜'íÁFˆˆƒ÷7FW'í”“vˆ&¶V7BrívV$ñÁfVÁF˜'íÁFˆˆƒ÷7FW'í“∑”∞¢ñbáGóVˆbvV$ñÁfVÁF˜'íÊ÷˜FW4ˆe&˜vW72”“vÁV÷&W"rívV$ñÁfVÁF˜'íÊ÷˜FW4ˆe&˜vW72“∞¢vñÊF˜r‰WVó÷VÁEÊV¬ÊVÁ7W&TvV$6∆˜FÜñÊt6ˆ∆∆V7Fñˆ‚Çì∞¢vñÊF˜r‰GñU7ó7FV“ÊVÁ7W&T6ˆ∆∆V7Fñˆ‚Çì∞†¢ÚÚW'6ˆÊ¬7F&∆R(	B6÷R∆ßí◊6VVBGFW&‚2FÜRvÜó7F∆W2&∆ˆ6≤ßW7@¢ÚÚ&˜fS¢6Ü&7FW"vóFÇÊÚ7F&∆RñWBvWG2FÜR7F'FW"F&ñÊvví÷Ü˜VÊ@¢ÚÚÜ÷F6ÜñÊrvV$ñÁfVÁF˜'íÁvÜó7F∆W2r7F'FW"vÜó7F∆Rí6Ú'FÜRF&ñÊvvê¢ÚÚÜ˜VÊBñ˜R7F'BvóFÇó27F˜&VBñ‚FÜR7F&∆R"Üˆ∆G2f˜"ˆ∆B6fW2FˆÚ‡¢7F&∆R“'&íÊó4'&íá∆ñW$FFÁ7F&∆RíÚ∆ñW$FFÁ7F&∆RÊ÷á2”‚á≤‚‚Á2“íí¢µ”∞¢7FófT6ˆ◊Êñˆ‰ñB“∆ñW$FFÊ7FófT6ˆ◊Êñˆ‰ñBÛÚÁV∆√∞¢7FófT÷˜VÁDñB“∆ñW$FFÊ7FófT÷˜VÁDñBÛÚÁV∆√∞¢7FófU6Ü˜V∆FW%WDñB“∆ñW$FFÊ7FófU6Ü˜V∆FW%WDñBÛÚÁV∆√∞¢ñbÇ7F&∆RÊ∆VÊwFÇí∞¢6ˆÁ7B7F'FW"“≤ñC¢w7F&∆Uˆ&ñÊvÚr¬∂ñÊC¢vF&ñÊvví÷Ü˜VÊBr¬Ê÷S¢t&ñÊvÚr¬vVÊ˜GóS¢vñÊF˜r‰7&VGW&TvVÊWFñ72Ê÷∂TFVfV«DvVÊ˜GóRÇvF&ñÊvví÷Ü˜VÊBrí¬ïGóS¢6ˆ◊Êñˆ‰ïGóTf˜$∂ñÊBÇvF&ñÊvví÷Ü˜VÊBrí¬∆WfV√¢¬7F&∆VDC¢FFRÊÊ˜rÇí”∞¢7F&∆RÁW6Çá7F'FW"ì∞¢7FófT6ˆ◊Êñˆ‰ñB“7F'FW"ÊñC∞¢–¢ñbÇ7FófT6ˆ◊Êñˆ‰ñBbb7F&∆RÊ∆VÊwFÇí7FófT6ˆ◊Êñˆ‰ñB“7F&∆U≥“ÊñC∞¢ÚÚ&6∂fñ∆¬vVÊ˜GóR÷∆W727F&∆RVÁG&ñW2g&ˆ“ˆ∆FW"6fW2ÜRÊr‚¢ÚÚ7F'FW"&ñÊvÚ6fVB&Vf˜&RGFW&‚vVÊW2WÜó7FVBí6ÚFÜWí&VÊFW ¢ÚÚ&V¬vVÊW2ñÁ7FVBˆbFÜR∆ñ‚VÊ6ˆ∆˜&VB7&óFRf˜&WfW"‚«6¢ÚÚ&6∂fñ∆«2÷ó76ñÊr6ó¶RÜvVÊ˜GóRÁ6ó¶T6∆72íˆ‚VÁG&ñW26fV@¢ÚÚ&Vf˜&RFÜR7F&∆Rw2÷˜VÁBˆ6ˆ◊Êñˆ‚˜6Ü˜V∆FW"◊WB7ó7FV“WÜó7FVB‡¢f˜"Ü6ˆÁ7BVÁG'íˆb7F&∆Rí∞¢ñbÇVÁG'íÊvVÊ˜GóRbbávñÊF˜r‰7&VGW&TvVÊWFñ72ÂEDU$ÂÙDTe5∂VÁG'íÊ∂ñÊE“«¬VÁG'íÊ∂ñÊB””“wWV÷∂ˆñíríí∞¢VÁG'íÊvVÊ˜GóR“vñÊF˜r‰7&VGW&TvVÊWFñ72Ê÷∂TFVfV«DvVÊ˜GóRÜVÁG'íÊ∂ñÊBì∞¢–¢ñbÜVÁG'íÊvVÊ˜GóRbbVÁG'íÊvVÊ˜GóRÁ6ó¶T6∆72í∞¢VÁG'íÊvVÊ˜GóRÁ6ó¶T6∆72“5$TEU$UÙD%∂VÁG'íÊ∂ñÊE”ÚÊFVfV«E6ó¶T6∆72«¬v÷VFóV“s∞¢–¢–¢6fU7F&∆RÇì∞¢ÚÚ&W7F˜&RvÜñ6ÜWfW"∆óFW&¬Fˆˆ¬˜vVˆ‚˜vÜó7F∆RñÁ7FÊ6Rv2WVóV@¢ÚÚñ‚V6Ç6∆˜B∆7B6W76ñˆ‚á6VR6fTWVó÷VÁE6∆˜G2í(	B6∂ó2Áí6∆˜@¢ÚÚvÜ˜6R6fVBóFV“ÊÚ∆ˆÊvW"WÜó7G2ñ‚FÜó26Ü&7FW"w2vV$ñÁfVÁF˜'ê¢ÚÚá6ˆ∆Bˆ∆˜7B6ñÊ6R¬˜"6fRg&ˆ“&Vf˜&RFÜó2fñV∆BWÜó7FVBí¬vÜñ6Ä¢ÚÚFÜV‚f∆«2Fá&˜VvÇFÚFÜR7F'FW"÷vV"FVfV«G2ßW7B&V∆˜r‡¢ñbá∆ñW$FFÊWVó÷VÁE6∆˜G2bbGóVˆb∆ñW$FFÊWVó÷VÁE6∆˜G2””“vˆ&¶V7Brí∞¢f˜"Ü6ˆÁ7B∑6∆˜B¬óFV‘ñE“ˆbˆ&¶V7BÊVÁG&ñW2á∆ñW$FFÊWVó÷VÁE6∆˜G2íí∞¢ñbÇóFV‘ñB«¬á6∆˜Bñ‚WVó÷VÁE6∆˜G2íí6ˆÁFñÁVS∞¢6ˆÁ7B7Fñ∆ƒ˜vÊVB“6∆˜B””“wvÜó7F∆Rp¢ÚvV$ñÁfVÁF˜'íÁvÜó7F∆W2Á6ˆ÷Rár”‚rÊñB””“óFV‘ñBê¢¢vV$ñÁfVÁF˜'íÁFˆˆ«5∂óFV‘ñE”∞¢ñbá7Fñ∆ƒ˜vÊVBíWVó÷VÁE6∆˜G5∑6∆˜E““óFV‘ñC∞¢–¢–¢ÚÚ6WBFVfV«BWVó÷VÁB6∆˜B76ñvÊ÷VÁG0¢ñbÜvV$ñÁfVÁF˜'íÁFˆˆ«2ÊÜˆUˆÊFófT6˜W"íWVó÷VÁE6∆˜G2ÊÜˆR“WVó÷VÁE6∆˜G2ÊÜˆR«¬vÜˆUˆÊFófT6˜W"s∞¢V«6RñbÜvV$ñÁfVÁF˜'íÁFˆˆ«2Ê'&ˆÁ¶VÜˆRíWVó÷VÁE6∆˜G2ÊÜˆR“WVó÷VÁE6∆˜G2ÊÜˆR«¬v'&ˆÁ¶VÜˆRs∞¢ñbÜvV$ñÁfVÁF˜'íÁFˆˆ«2Áñ6∑6Ü˜fV≈ˆÊFófT6˜W"íWVó÷VÁE6∆˜G2Á6Ü˜fV¬“WVó÷VÁE6∆˜G2Á6Ü˜fV¬«¬wñ6∑6Ü˜fV≈ˆÊFófT6˜W"s∞¢V«6RñbÜvV$ñÁfVÁF˜'íÁFˆˆ«2Áñ6∑6Ü˜fV¬íWVó÷VÁE6∆˜G2Á6Ü˜fV¬“WVó÷VÁE6∆˜G2Á6Ü˜fV¬«¬wñ6∑6Ü˜fV¬s∞¢ñbÜvV$ñÁfVÁF˜'íÁFˆˆ«2ÊÜF6ÜWEˆÊFófT6˜W"íWVó÷VÁE6∆˜G2ÁvVˆ‚“WVó÷VÁE6∆˜G2ÁvVˆ‚«¬vÜF6ÜWEˆÊFófT6˜W"s∞¢V«6RñbÜvV$ñÁfVÁF˜'íÁFˆˆ«2ÊÜF6ÜWBíWVó÷VÁE6∆˜G2ÁvVˆ‚“WVó÷VÁE6∆˜G2ÁvVˆ‚«¬vÜF6ÜWBs∞¢ñbÜvV$ñÁfVÁF˜'íÁvÜó7F∆W2Ê∆VÊwFÇíWVó÷VÁE6∆˜G2ÁvÜó7F∆R“WVó÷VÁE6∆˜G2ÁvÜó7F∆R«¬vV$ñÁfVÁF˜'íÁvÜó7F∆W5≥“ÊñC∞¢ÚÚ7WG66VÊR&WfñWrw2WÜV÷W&¬&ˆfñ∆R6‚ñÊÜW&óBvV$ñÁfVÁF˜'ê¢ÚÚÜÊB‚«&VGí÷WVóVBvÜó7F∆Rí7G&ñváBg&ˆ“FÜR&V¬∆ˆ6¿¢ÚÚ6fRfñFˆ72ˆñÊFWÇÊáF÷¬w2ˆÊ&ˆ&FñÊr◊&ˆfñ∆RÜÊFˆfb¬ÊBFÜP¢ÚÚ∆ñÊR&˜fRWFÚ÷WVó2FÜR7F'FW"vÜó7F∆Rf˜"Áí&ˆfñ∆RFÜ@¢ÚÚÜ2ÊˆÊR(	BVóFÜW"ví¬‚VÊñÁfóFVB6ˆ◊Êñˆ‚Êñ÷¬v˜V∆B7v‡¢ÚÚÊB6ˆ◊WFRf˜"6÷W&g&÷ñÊrñ‚66VÊRFÜRFó&V7F˜"ÊWfW ¢ÚÚWFÜ˜&VBˆÊRf˜"‚66VÊRw2˜v‚7&VGW&R7F˜'2&RVÊffV7FVC∞¢ÚÚFÜó2ˆÊ«í6∆V'2FÜR&V¬∆ñW"w2˜v‚6ˆ◊Êñˆ‚6∆˜B‡¢ñbávñÊF˜rÂıˆÜˆ'VÊ¶î7WG66VÊU&WfñWríWVó÷VÁE6∆˜G2ÁvÜó7F∆R“ÁV∆√∞¢&V'Vñ∆EFˆˆƒ÷W6ÜW2Çì∞¢ÚÚ&W7F˜&RFÜRFˆˆ¬7GV∆«íÜV∆B∆7B6W76ñˆ‚á6VR6fTWVó÷VÁE6∆˜G2ê¢ÚÚ(	B6ñ∆VÁB6Ú&WGW&ÊñÊrFÚ6fRFˆW6‚wB˜%Ç6V∆V7FVB"Fˆ7B‡¢ñbá∆ñW$FFÊ7FófUFˆˆ¬bbFˆˆƒ7FñˆÁ5∑∆ñW$FFÊ7FófUFˆˆ≈“í∞¢6WD7FófUFˆˆ¬á∆ñW$FFÊ7FófUFˆˆ¬¬≤6ñ∆VÁC¢G'VR“ì∞¢“V«6R∞¢&Vg&W6ÖvVˆÂ7vóF6Ñ'F‚Çì∞¢ˆ&¶V7BÁf«VW2áFˆˆƒ÷W6Ñ÷íÊf˜$V6ÇÜ“”‚≤ñbÜ“íFˆˆƒÜˆ∆FW"Á&V÷˜fRÜ“ì≤“ì∞¢ñbáFˆˆƒ÷W6Ñ÷∂7FófUFˆˆ≈“íFˆˆƒÜˆ∆FW"ÊFBáFˆˆƒ÷W6Ñ÷∂7FófUFˆˆ≈“ì∞¢–¢vñÊF˜r‰WVó÷VÁEÊV¬Ê'Vñ∆DWVó÷VÁE6∆˜G2Çì∞¢G'í∞¢vóBvñÊF˜r‰Á4fF%&WfñWrÊVÁ7W&U˜'G&óD6˜6÷WFñ72á∞¢76WD&6S¢r‚ˆ76WG2Úr¿¢6ˆÊfñt&6S¢r‚ˆ6ˆÊfñrÚr¿¢“ì∞†¢vóB&Vg&W6Ö∆ñW$fF"Çì∞¢FV'Vt∆ˆrÇu‰r∆ÊRfF"GF6ÜVBFÚ∆ñW%˜&ˆ˜Brì∞¢“6F6ÇÜW'"í∞¢6ˆÁ6ˆ∆RÁv&‚Çw7vÂ∆ñW$fF"fñ∆VB¬6ˆÁFñÁVñÊrvóFÜ˜WBfF#¢r¬W'"ì∞¢–¢v÷U7F'FVB“G'VS∞¢vñÊF˜rÂıˆÜˆ'VÊ¶îv÷U7F'FVB“G'VS∞¢–†¢Fˆ7V÷VÁBÊFDWfVÁD∆ó7FVÊW"ÇvÜˆ'VÊ¶ï∆ñW%&VGír¬ÜRí”‚∞¢˜∆ñW$FF“RÊFWFñ√∞¢7vÂ∆ñW$fF"ÜRÊFWFñ¬ì∞¢“¬≤ˆÊ6S¢G'VR“ì∞†¢ÚÚñbñÊóBÇí«&VGífó&VB7ñÊ6á&ˆÊ˜W6«íá&WGW&ÊñÊr∆ñW"vóFÇ∆ˆ6≈7F˜&vR&ˆfñ∆Rí¿¢ÚÚıˆÜˆ'VÊ¶ï∆ñW%&ˆfñ∆Ró26WB&Vf˜&RFÜó2∆ó7FVÊW"&Vvó7FW&VB(	B6F6ÇFÜB66R‡¢ñbávñÊF˜rÂıˆÜˆ'VÊ¶ï∆ñW%&ˆfñ∆Rí∞¢˜∆ñW$FF“vñÊF˜rÂıˆÜˆ'VÊ¶ï∆ñW%&ˆfñ∆S∞¢7vÂ∆ñW$fF"ávñÊF˜rÂıˆÜˆ'VÊ¶ï∆ñW%&ˆfñ∆Rì∞¢–††¢ÚÚ)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y ¢ÚÚ7WG66VÊR&WfñWr÷ˆFP¢ÚÚ)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢ÚÚ&ˆ˜G2FÜó2F"vóFÇFá&˜vví6Ü&7FW"˜v˜&∆Bá6VRFÜRñÊ∆ñÊP¢ÚÚÜÊFˆfb67&óBñ‚ñÊFWÇÊáF÷¬¬ßW7B&Vf˜&R«67&óB7&3“&v÷RÊß2#‚¿¢ÚÚÊBFˆ72˜Fˆˆ«2ˆ7WG66VÊR÷Fó&V7F˜"ˆñÊFWÇÊáF÷¬w2%&WfñWrñ‚v÷R ¢ÚÚ'WGFˆ‚íñÁ7FVBˆbFÜR&V¬6fR¬ÊB&W∆ó2‚WFÜ˜&V@¢ÚÚ7WG66VÊRW6ñÊrFÜR$T¬Fñ∆ˆwVRTíÊB$T¬Fñ∆ˆwVR◊¶ˆˆ“6÷W&¢ÚÚ7ó7FV“(	BÊ˜BFÜRFó&V7F˜"Fˆˆ¬w2˜v‚&ófFR&WfñWr‡¢Ú¢ÚÚFÜRFñffW&VÊ6W2g&ˆ“Ê˜&÷¬6ˆÁfW'6Fñˆ‚&RFV∆ñ&W&FRÊ@¢ÚÚÊ'&˜r¬ÊB∆ófR&ñváBÊWáBFÚFÜR6ˆFRFÜWí6ÜÊvS†¢ÚÚ“&Vvñ‰Á4Fñ∆ˆwVU7FvñÊrÚf6TÁ4Fñ∆ˆwVU'Fñ6óÁG2¢ÚÚWFFTÁ4Fñ∆ˆwVU7FvñÊrÜ&˜fRíÊÚ÷˜vÜV‡¢ÚÚ7WG66VÊU&WfñWt7FófR(	BFÜRFó&V7F˜"«&VGí67&óG2WfW'ê¢ÚÚ'Fñ6óÁBw2WÜ7B˜6óFñˆ‚ˆf6ñÊrg&÷R'íg&÷R¬6ÚFÜP¢ÚÚ&V¬'v∆≤FÜR∆ñW"WFÚFÜRÂ2"WFÚ◊7FvñÊrv˜V∆BˆÊ«ê¢ÚÚfñváBóB¬ÊBFÜW&R÷íÊ˜BWfV‚&R'∆ñW""÷ˆÊrFÜP¢ÚÚ66VÊRw27F˜'2‡¢ÚÚ“GfÊ6TÁ4Fñ∆ˆwVRÜ&˜fRíFV∆VvFW2F¢ÚÚ7WG66VÊU&WfñWtGfÊ6R(	BFÜRFó&V7F˜"v∆∑2óG2˜v‡¢ÚÚ÷˜fR˜F∆≤ˆ6Üˆñ6RÚ‚‚‚7FvR∆ó7B¬Ê˜B‚WFÜ˜&VBFñ∆ˆwVUG&VR‡¢ÚÚ“6÷W&ˆFñ∆ˆwVR◊¶ˆˆ“F&vWFñÊr&WW6W27FófT6÷W&F&vW@¢ÚÚWÜ7F«í2Ê˜&÷¬Â2Fñ∆ˆwVR«&VGíFˆW2Ü˜V‰Á4Fñ∆ˆwVP¢ÚÚ6WG2óBFÚv∆∂W"Á&ˆ˜Bí(	BóBw2ßW7BˆñÁFVBBvÜñ6ÜWfW ¢ÚÚ7WG66VÊR'Fñ6óÁBó27W'&VÁF«í7V∂ñÊrñÁ7FVBˆb«vó0¢ÚÚ&VñÊr'FÜRÂ2FÜR∆ñW"v∆∂VBWFÚ‚"FÜBF&vWBó2ÊWfW ¢ÚÚFÜR&V¬6ñÊv∆WFˆ‚∆ñW"˜∆ñW$÷W6Ç¬WfV‚f˜"%∆ñW" ¢ÚÚ&ˆ∆R7F˜"ñ‚FÜR66VÊR(	BWfW'í7F˜"¬ñÊ6«VFñÊrFÜBˆÊR¬ó0¢ÚÚ7vÊVB2óG2˜v‚ñÊFWVÊFVÁB7FÊB÷ñ‚VÁFóGíÜW&R¬6ÚFÜó0¢ÚÚ&WfñWvW"ÊWfW"&VG2˜"w&óFW2FÜR&V¬∆ñW"w2˜6óFñˆ‚‡¢ÚÚFÜR&V¬∆ñW"6óG2WÜ7F«ívÜW&WfW"FÜVó"6fR∆VgBFÜV“¿¢ÚÚˆfb◊67&VV‚ÊBVÁF˜V6ÜVB¬f˜"FÜRvÜˆ∆R&WfñWr‡¢ÚÚ)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y)Y †¢∆WB7WG66VÊU&WfñWtGfÊ6R“ÁV∆√≤ÚÚ6WBvÜñ∆RF∆≤ˆ6Üˆñ6R∆ñÊRó26Ü˜vñÊp†¢gVÊ7Fñˆ‚7WG66VÊU&WfñWt&ÊÊW"áFWáB¬ó4W'&˜"í∞¢∆WBV¬“Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÇv7WG66VÊU&WfñWt&ÊÊW"rì∞¢ñbÇV¬í∞¢V¬“Fˆ7V÷VÁBÊ7&VFTV∆V÷VÁBÇvFóbrì∞¢V¬ÊñB“v7WG66VÊU&WfñWt&ÊÊW"s∞¢V¬Á7Gñ∆RÊ775FWáB“w˜6óFñˆ„¶fóÜVC∂∆VgC£SS∑F˜£É∑G&Á6f˜&”ßG&Á6∆FUÇÇ”SRì∑¢÷ñÊFWÉ£ììììì≤p¢≤wFFñÊs£áÇgÉ∂&˜&FW"◊&FóW3£É∂fˆÁC£cGÇÛ„27ó7FV“◊Ví«6Á2◊6W&ñc∂6ˆ∆˜#¢6ffc≤p¢≤v&6∂w&˜VÊCß&v&É#√B√¬„Ébì∂&˜&FW#£'Ç6ˆ∆ñB6c&#sSS∂&˜Ç◊6ÜF˜s£gÇáÇ&v&É√√¬„Bì≤p¢≤vFó7∆ì¶f∆WÉ∂v£É∂∆ñv‚÷óFV◊3¶6VÁFW#∑ˆñÁFW"÷WfVÁG3¶WFÛ≤s∞¢6ˆÁ7B∆&V¬“Fˆ7V÷VÁBÊ7&VFTV∆V÷VÁBÇw7‚rì∞¢∆&V¬ÊñB“v7WG66VÊU&WfñWt&ÊÊW$∆&V¬s∞¢V¬ÊVÊD6Üñ∆BÜ∆&V¬ì∞¢6ˆÁ7B6∆˜6T'F‚“Fˆ7V÷VÁBÊ7&VFTV∆V÷VÁBÇv'WGFˆ‚rì∞¢6∆˜6T'F‚ÁFWáD6ˆÁFVÁB“tWÜóB&WfñWrs∞¢6∆˜6T'F‚Á7Gñ∆RÊ775FWáB“vfˆÁC£c'Ç7ó7FV“◊Ví«6Á2◊6W&ñc∑FFñÊs£GÇáÉ∂&˜&FW"◊&FóW3£gÉ≤p¢≤v&˜&FW#£Ç6ˆ∆ñB6c&#sSS∂&6∂w&˜VÊC¢36&3##∂6ˆ∆˜#¢6ffc∂7W'6˜#ßˆñÁFW#≤s∞¢ÚÚ∆ñ‚&V∆ˆBó2VÊ˜VvÇFÚ∆VfR&WfñWr÷ˆFR6∆VÊ«ì¢FÜP¢ÚÚÜÊFˆfb∂Wíó2ˆÊR◊6Ü˜BÜ«&VGí6ˆÁ7V÷VBíÊBFÜRWÜV÷W&¿¢ÚÚ&ˆfñ∆RˆÊ«íWfW"∆ófVBñ‚vñÊF˜rÂıˆÜˆ'VÊ¶ï∆ñW%&ˆfñ∆R¬ÊWfW ¢ÚÚw&óGFV‚FÚFÜR&V¬Üˆ'VÊ¶ï∆ñW%&ˆfñ∆RˆÜˆ'VÊ¶ï6fT÷WF∂Wó2‡¢6∆˜6T'F‚ÊFDWfVÁD∆ó7FVÊW"Çv6∆ñ6≤r¬Çí”‚∆ˆ6Fñˆ‚Á&V∆ˆBÇíì∞¢V¬ÊVÊD6Üñ∆BÜ6∆˜6T'F‚ì∞¢Fˆ7V÷VÁBÊ&ˆGíÊVÊD6Üñ∆BÜV¬ì∞¢–¢V¬Á7Gñ∆RÊ&˜&FW$6ˆ∆˜"“ó4W'&˜"Úr6Ccf#cÇr¢r6c&#sSRs∞¢Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÇv7WG66VÊU&WfñWt&ÊÊW$∆&V¬ríÁFWáD6ˆÁFVÁB“FWáC∞¢–†¢gVÊ7Fñˆ‚7WG66VÊU&WfñWtfFTV¬Çí∞¢∆WBV¬“Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÇv7WG66VÊU&WfñWtfFRrì∞¢ñbÇV¬í∞¢V¬“Fˆ7V÷VÁBÊ7&VFTV∆V÷VÁBÇvFóbrì∞¢V¬ÊñB“v7WG66VÊU&WfñWtfFRs∞¢V¬Á7Gñ∆RÊ775FWáB“w˜6óFñˆ„¶fóÜVC∂ñÁ6WC£∑¢÷ñÊFWÉ£ììììÉ∂&6∂w&˜VÊC¢3∂˜6óGì£≤p¢≤wˆñÁFW"÷WfVÁG3¶ÊˆÊS∑G&Á6óFñˆ„¶˜6óGí2∆ñÊV#≤s∞¢Fˆ7V÷VÁBÊ&ˆGíÊVÊD6Üñ∆BÜV¬ì∞¢–¢&WGW&‚V√∞¢–†¢7ñÊ2gVÊ7Fñˆ‚7WG66VÊU&WfñWuvóDf˜$&VÜ&V¬Fñ÷V˜WD◊2¬&VFñ6FRí∞¢6ˆÁ7B6ÜV6≤“&VFñ6FR«¬ÇÇí”‚á66VÊTf˜$Á4&VÜ&VíbbÁ4w&ñDf˜$&VÜ&Vííì∞¢6ˆÁ7B7F'B“W&f˜&÷Ê6RÊÊ˜rÇì∞¢vÜñ∆RáW&f˜&÷Ê6RÊÊ˜rÇí“7F'B¬Fñ÷V˜WD◊2í∞¢ñbÜ6ÜV6≤Çíí&WGW&‚G'VS∞¢vóBÊWr&ˆ÷ó6Rá"”‚6WEFñ÷V˜WBá"¬íì∞¢–¢&WGW&‚f«6S∞¢–†¢ÚÚ66Á2vVÊW&FVBvñ∆FW&ÊW72¶ˆÊRw2&V¬Fñ∆Rw&ñBf˜"6∆V"¬f∆@¢ÚÚ|9vÇ&V7FÊv∆RFÚG&˜‚WFÜ˜&VB66VÊRw2vÜˆ∆R∆ˆ6¬fˆ˜G&ñÁBˆÁF¢ÚÚ(	B6÷RFñ∆R÷∆WfV¬WÜ6«W6ñˆ‚6ÜV6∂∆ó7Bvñ∆FW&ÊW72÷÷÷vVÊW&F˜"Êß2w0¢ÚÚ˜v‚&Vg&VR˜&ÊFˆ‘g&VT&VW6RáVÊñf˜&“V∆WfFñˆ‚FñW"¬ÊÚñÊ6∆ñÊR¢ÚÚ&◊˜vFW"˜6ˆ∆ñBFñ∆W2í¬«W2'Vñ∆FñÊrˆFV6˜"ˆgW&ÊóGW&RˆFV‚ˆ67WÊ7ê¢ÚÚFÜB∆ófR˜WG6ñFRFÜRFñ∆Rw&ñBóG6V∆bá6VR'Vñ∆E¶ˆÊU66VÊR¢ÚÚ˜7vÂ¶ˆÊTFV6˜$gW&ÊóGW&RÚW&f˜&’F˜FÜ≈6ÜñgBw2FVÁ6í‚6V&6ÜW0¢ÚÚ˜WGv&Bñ‚6ÜV'ó6ÜWb&ñÊw2g&ˆ“FÜR¶ˆÊRw26VÁFW"6Úf˜VÊB7˜Bó0¢ÚÚÊWfW"f'FÜW"g&ˆ“FÜR÷ñFF∆RˆbFÜR÷FÜ‚óBÜ2FÚ&R‡¢gVÊ7Fñˆ‚fñÊE¶ˆÊU∆6V÷VÁDfˆ˜G&ñÁBÜ&V¬r¬Çí∞¢6ˆÁ7B¶í“˜¶ˆÊU66VÊW2ÊvWBÜ&Vì∞¢6ˆÁ7Bw&ñB“¶ìÚÊw&ñC∞¢ñbÇw&ñBí&WGW&‚ÁV∆√∞¢6ˆÁ7B6ˆ«2“¶íÊ6ˆ«2¬&˜w2“¶íÁ&˜w3∞¢6ˆÁ7B¶ˆÊTFF“˜¶ˆÊT∆ñ˜WG2ÊvWBÜ&Vì∞¢6ˆÁ7Bˆ67WñVB“'&íÊg&ˆ“á≤∆VÊwFÉ¢&˜w2“¬Çí”‚ÊWr'&íÜ6ˆ«2íÊfñ∆¬Üf«6Ríì∞¢6ˆÁ7B÷&¥ˆ67WñVB“Ü6ˆ¬¬&˜r¬˜r¬ˆÇí”‚∞¢f˜"Ü∆WB"“÷FÇÊ÷ÇÉ¬&˜rì≤"¬÷FÇÊ÷ñ‚á&˜w2¬&˜r≤ˆÇì≤"≤≤ê¢f˜"Ü∆WB2“÷FÇÊ÷ÇÉ¬6ˆ¬ì≤2¬÷FÇÊ÷ñ‚Ü6ˆ«2¬6ˆ¬≤˜rì≤2≤≤íˆ67WñVE∑%’∂5““G'VS∞¢”∞¢f˜"Ü6ˆÁ7B"ˆbá¶ˆÊTFFÚÊ'Vñ∆FñÊw2«¬µ“íí÷&¥ˆ67WñVBÜ"Êw&ñEÇ«¬¬"Êw&ñE¢«¬¬"Êfˆ˜G&ñÁErÛÚ"ÁrÛÚ¬"Êfˆ˜G&ñÁDBÛÚ"ÊÇÛÚì∞¢f˜"Ü6ˆÁ7BBˆbá¶ˆÊTFFÚÊFVÁ2«¬µ“íí÷&¥ˆ67WñVBÜBÁÇ¬BÁí¬BÁr«¬¬BÊÇ«¬ì∞¢f˜"Ü6ˆÁ7BBˆbá¶ˆÊTFFÚÊFV6˜"«¬µ“íí÷&¥ˆ67WñVBÜBÊ6ˆ¬¬BÁ&˜r¬¬ì∞¢f˜"Ü6ˆÁ7Bbˆbá¶ˆÊTFFÚÊgW&ÊóGW&R«¬µ“íí÷&¥ˆ67WñVBÜbÊ6ˆ¬¬bÁ&˜r¬¬ì∞†¢gVÊ7Fñˆ‚&V7Dˆ≤Ü6ˆ¬¬&˜rí∞¢ñbÜ6ˆ¬¬«¬&˜r¬«¬6ˆ¬≤r‚6ˆ«2“«¬&˜r≤Ç‚&˜w2“í&WGW&‚f«6S≤ÚÚ7FíˆfbFÜR&˜&FW"FW'&ñ‚6∂ó'@¢∆WBV∆WeFñW"“ÁV∆√∞¢f˜"Ü∆WB"“&˜s≤"¬&˜r≤É≤"≤≤í∞¢f˜"Ü∆WB2“6ˆ√≤2¬6ˆ¬≤s≤2≤≤í∞¢ñbÜˆ67WñVE∑%’∂5“í&WGW&‚f«6S∞¢6ˆÁ7BFñ∆R“w&ñE∑%’∂5”∞¢ñbÇFñ∆Rí&WGW&‚f«6S∞¢ñbáFñ∆RÁvFW"í&WGW&‚f«6S∞¢ñbáFñ∆RÊñÊ6∆ñÊRí&WGW&‚f«6S∞¢ñbáFñ∆RÁGóR””“Fñ∆UGóRÂ$’í&WGW&‚f«6S∞¢ñbÜó56ˆ∆ñBáFñ∆RÁGóRíí&WGW&‚f«6S∞¢6ˆÁ7BFñW"“Fñ∆RÊV∆WeFñW"«¬∞¢ñbÜV∆WeFñW"””“ÁV∆¬íV∆WeFñW"“FñW#∞¢V«6RñbáFñW"”“V∆WeFñW"í&WGW&‚f«6S∞¢–¢–¢&WGW&‚G'VS∞¢–†¢6ˆÁ7B6VÁFW$6ˆ¬“÷FÇÊf∆ˆ˜"ÇÜ6ˆ«2“ríÚ"í¬6VÁFW%&˜r“÷FÇÊf∆ˆ˜"Çá&˜w2“ÇíÚ"ì∞¢6ˆÁ7B÷Ö&FóW2“÷FÇÊ÷ÇÜ6ˆ«2¬&˜w2ì∞¢f˜"Ü∆WB&FóW2“≤&FóW2√“÷Ö&FóW3≤&FóW2≤≤í∞¢f˜"Ü∆WBG"“◊&FóW3≤G"√“&FóW3≤G"≤≤í∞¢f˜"Ü∆WBF2“◊&FóW3≤F2√“&FóW3≤F2≤≤í∞¢ñbÑ÷FÇÊ÷ÇÑ÷FÇÊ'2ÜG"í¬÷FÇÊ'2ÜF2íí”“&FóW2í6ˆÁFñÁVS≤ÚÚ&ñÊrˆÊ«í(	BñÁFW&ñ˜"«&VGí6ÜV6∂VBB6÷∆∆W"&Fñê¢6ˆÁ7B6ˆ¬“6VÁFW$6ˆ¬≤F2¬&˜r“6VÁFW%&˜r≤G#∞¢ñbá&V7Dˆ≤Ü6ˆ¬¬&˜ríí&WGW&‚≤6ˆ¬¬&˜r”∞¢–¢–¢–¢&WGW&‚ÁV∆√∞¢–†¢ÚÚg&VVf˜&“Ç&7W7Fˆ“"í7F˜'2¬ÊBÁí7F˜"vÜ˜6R&V¬Â2ˆ7&VGW&P¢ÚÚ7v‚fñ∆VB¬f∆¬&6≤FÚ∆ñ‚∆6VÜˆ∆FW"÷W6Ç(	B6÷P¢ÚÚw&6VgV¬÷FVw&FFñˆ‚ˆ∆ñ7íFÜR7WG66VÊRFó&V7F˜"Fˆˆ¬w2˜v‡¢ÚÚ7FÊF∆ˆÊR&WfñWrW6W2f˜"FÜR6÷R66W2‡¢gVÊ7Fñˆ‚7WG66VÊU&WfñWt÷∂U∆6VÜˆ∆FW"Ü7F˜"¬&V¬F&vWE66VÊRí∞¢6ˆÁ7Bw&˜W“ÊWrDÖ$TR‰w&˜WÇì∞¢6ˆÁ7B÷B“ÊWrDÖ$TR‰÷W6Ñ∆÷&W'D÷FW&ñ¬á≤6ˆ∆˜#¢7F˜"Ê6ˆ∆˜"«¬r6666662r“ì∞¢6ˆÁ7B&ˆGí“ÊWrDÖ$TR‰÷W6ÇÜÊWrDÖ$TR‰7ñ∆ñÊFW$vVˆ÷WG'íÉ„#b¬„2¬„ÉR¬í¬÷Bì∞¢&ˆGíÁ˜6óFñˆ‚Áí“„#Ç≤„ÉRÚ#∞¢w&˜WÊFBÜ&ˆGíì∞¢6ˆÁ7BÜVB“ÊWrDÖ$TR‰÷W6ÇÜÊWrDÖ$TRÂ7ÜW&TvVˆ÷WG'íÉ„#"¬"¬í¬÷Bì∞¢ÜVBÁ˜6óFñˆ‚Áí“„#Ç≤„ÉR≤„É∞¢w&˜WÊFBÜÜVBì∞¢6ˆÁ7B7W&eí“Á57W&f6UíÜ&V¬7F˜"Áv˜&∆D2¬7F˜"Áv˜&∆E"ì∞¢w&˜WÁ˜6óFñˆ‚Á6WBÜ7F˜"Áv˜&∆D2≤„R¬7W&eí¬7F˜"Áv˜&∆E"≤„Rì∞¢w&˜WÁ&˜FFñˆ‚Áí“DÖ$TR‰÷FÖWFñ«2ÊFVuFı&BÜ7F˜"Á&˜FFñˆ‚«¬ì∞¢F&vWE66VÊRÊFBÜw&˜Wì∞¢&WGW&‚≤∂ñÊC¢w∆6VÜˆ∆FW"r¬&ˆ˜C¢w&˜W”∞¢–†¢6ˆÁ7B7WG66VÊU&WfñWtÊv∆UF˜v&B“Üg&ˆ“¬FÚí”‚ÇÇÑ÷FÇÊF„"áFÚÁ"“g&ˆ“Á"¬FÚÊ2“g&ˆ“Ê2í¢ÉÚ÷FÇÂí≤ìíR3cí≤3cíR3c∞†¢gVÊ7Fñˆ‚7WG66VÊU&WfñWt«ï7FFRÜVÁFóGí¬&V¬7Bí∞¢6ˆÁ7B7W&eí“Á57W&f6UíÜ&V¬÷FÇÁ&˜VÊBá7BÊ2í¬÷FÇÁ&˜VÊBá7BÁ"íì∞¢ñbÜVÁFóGíÊ∂ñÊB””“v7&VGW&Rrí∞¢6ˆÁ7B2“VÁFóGíÊ7&VGW&S∞¢2ÁÇ“7BÊ2¢DîƒS≤2Áí“7BÁ"¢DîƒS∞¢2ÊfF%&VbÊw&˜WÁ˜6óFñˆ‚Á6WBá7BÊ2≤„R¬7W&eí≤2ÊÜ∆dÜVñváB¬7BÁ"≤„Rì∞¢2ÊfF%&VbÊw&˜WÁ&˜FFñˆ‚Áí“DÖ$TR‰÷FÖWFñ«2ÊFVuFı&Bá7BÁ&˜FFñˆ‚ì∞¢ÚÚ6VVG2w&˜W&˜B˜Êu&˜BFÚ÷F6Ç6Ú7WG66VÊU&˜FFñˆÂFñ6≤w2fó'7@¢ÚÚ&V¬Fñ6≤á6VR&V∆˜rí7F'G2‚Êv∆TFñfbˆbWÜ7F«íñÁ7FV@¢ÚÚˆb6÷ˆ˜FÜ«í7vVWñÊrñ‚g&ˆ“vÜW&WfW"÷∂T7&VGW&TVÁFóGíw0¢ÚÚw&˜W&˜C£FVfV«B∆VgBFÜV“‡¢2Êw&˜W&˜B“2ÁÊu&˜B“DÖ$TR‰÷FÖWFñ«2ÊFVuFı&Bá7BÁ&˜FFñˆ‚ì∞¢2Êw&˜VÊE6ÜF˜sÚÁ˜6óFñˆ‚Á6WBá7BÊ2≤„R¬7W&eí≤6Ü&7FW$w&˜VÊE6ÜF˜u7W&f6Tˆfg6WBÇí¬7BÁ"≤„Rì∞¢2ÊfF%&VbÊw&˜WÁ66∆RÁ6WE66∆"á7BÁ˜6R””“w&ˆÊRrÚ„b¢ì∞¢“V«6RñbÜVÁFóGíÊ∂ñÊB””“vÁ2rí∞¢VÁFóGíÁv∆∂W"Á&˜B“DÖ$TR‰÷FÖWFñ«2ÊFVuFı&Bá7BÁ&˜FFñˆ‚ì∞¢VÁFóGíÁ&ˆ˜BÁ˜6óFñˆ‚Á6WBá7BÊ2≤„R¬7W&eí¬7BÁ"≤„Rì∞¢VÁFóGíÁ&ˆ˜BÁ&˜FFñˆ‚Áí“VÁFóGíÁv∆∂W"Á&˜C∞¢VÁFóGíÁ&ˆ˜BÁ66∆RÁ6WE66∆"Éì∞¢ÚÚ&ˆÊRFó2FÜRf∆B˜'G&óB∆ÊRF˜v‚ˆÁFÚóG2&6≤ñÁ7FVBˆ`¢ÚÚßW7B6á&ñÊ∂ñÊr7FÊFñÊrfñwW&R(	BFÜó2v∆∂W"ó267&óFV@¢ÚÚVÁFó&V«í'íFÜRFó&V7F˜"áW6S§ñÊfñÊóGí¬6VRFÜR7F˜"◊7v‡¢ÚÚ∆ˆ˜íÊBÊWfW"Fñ∆ˆwVR◊7FvVBÜwV&FVB'í7WG66VÊU&WfñWt7FófP¢ÚÚñ‚&Vvñ‰Á4Fñ∆ˆwVU7FvñÊrˆf6TÁ4Fñ∆ˆwVU'Fñ6óÁG2í¬6¢ÚÚÊ˜FÜñÊrV«6R&R÷76W'G27FÊFñÊrG&Á6f˜&“˜fW"FÜó2˜6R‡¢6ˆÁ7BfF$w&˜W“VÁFóGíÁv∆∂W"ÊfF$w&˜W∞¢ñbÜfF$w&˜Wí∞¢6ˆÁ7BfF$ÜVñváB“fF$w&˜WÁW6W$FFÚÁ˜'G&óD÷ˆFVƒÜVñváB«¬∞¢ñbá7BÁ˜6R””“w&ˆÊRrí∞¢fF$w&˜WÁ&˜FFñˆ‚ÁÇ“÷FÇÂíÚ#∞¢fF$w&˜WÁ˜6óFñˆ‚Áí“fF$ÜVñváB¢„c∞¢“V«6R∞¢fF$w&˜WÁ&˜FFñˆ‚ÁÇ“∞¢fF$w&˜WÁ˜6óFñˆ‚Áí“fF$ÜVñváBÚ#∞¢–¢–¢“V«6R∞¢VÁFóGíÁ&ˆ˜BÁ˜6óFñˆ‚Á6WBá7BÊ2≤„R¬7W&eí¬7BÁ"≤„Rì∞¢VÁFóGíÁ&ˆ˜BÁ&˜FFñˆ‚Áí“DÖ$TR‰÷FÖWFñ«2ÊFVuFı&Bá7BÁ&˜FFñˆ‚ì∞¢VÁFóGíÁ&ˆ˜BÁ66∆RÁ6WE66∆"á7BÁ˜6R””“w&ˆÊRrÚ„b¢ì∞¢–¢–†¢7ñÊ2gVÊ7Fñˆ‚'V‰7WG66VÊU&WfñWráñ∆ˆBí∞¢7WG66VÊU&WfñWt7FófR“G'VS∞¢7WG66VÊU&WfñWu¶ˆˆ’W&6VÁB“∞¢7WG66VÊU&WfñWt&ÊÊW"Ü	¯Í¬G∑ñ∆ˆBÁFóF∆R«¬t7WG66VÊR&WfñWrw“(	B∆ˆFñÊ~(
f¬f«6Rì∞†¢6ˆÁ7B&V“Ê˜&÷∆ó¶TÁ4&Váñ∆ˆBÊ÷ñBì∞¢ñbÖˆó4'Vñ∆FñÊt&VÜ&Víí∞¢G'í≤vóB∆ˆD'Vñ∆FñÊu66VÊRÜ&Vì≤“6F6ÇÜRí≤6ˆÁ6ˆ∆RÊW'&˜"ÜRì≤–¢“V«6RñbÜ&V””“wF˜v‚rbbF˜vÂ66VÊRí∞¢ÚÚFÜRF˜v‚w2Fñ∆R˜&˜WFRFF∆ˆG2WFˆ÷Fñ6∆«íB&ˆ˜@¢ÚÚÖˆ∆ˆEF˜v‰g&ˆ’v˜&∑76R(i"ñÊóEF˜vÂG&fV¬í¬'WBFÜR7GV¬4@¢ÚÚ66VÊRÜ'Vñ∆EF˜vÂ66VÊR¬vÜñ6Ç6WG2F˜vÂ66VÊVíó2Ê˜&÷∆«íˆÊ«ê¢ÚÚ'Vñ«B∆¶ñ«íFÜR÷ˆ÷VÁBFÜR∆ñW"fó'7Bv∆∑2ñ‚g&ˆ“FÜRf&–¢ÚÚÜVÁFW%F˜v‚í‚VÁFW%F˜v‚Çí«6ÚFˆW2FÜñÊw2FÜó2&WfñWvW"◊W7@¢ÚÚÊWfW"FÚFÚFÜR&V¬∆ñW"Ü÷˜fW2∆ñW"ÁÇ˜í¬7F◊0¢ÚÚf&’∆ñW%6fR¬f∆ó27W'&VÁD&Ví(	B'Vñ∆EF˜vÂ66VÊRÇíóG6V∆bó0¢ÚÚFÜR7FÊF∆ˆÊR¬∆ñW"◊VÁF˜V6ÜVBÜ∆bˆbFÜB¬6ÚóBw26∆∆V@¢ÚÚFó&V7F«íÜW&RñÁ7FVBˆbVÁFW%F˜v‚Çí‡¢G'í∞¢ñbÇF˜v‰w&ñBívóB7WG66VÊU&WfñWuvóDf˜$&VÇuı˜F˜v‰w&ñEıÚr¬S¬Çí”‚F˜v‰w&ñBì∞¢'Vñ∆EF˜vÂ66VÊRÇì∞¢“6F6ÇÜRí≤6ˆÁ6ˆ∆RÊW'&˜"Çu∂7WG66VÊR&WfñWu“'Vñ∆EF˜vÂ66VÊRfñ∆VC¢r¬Rì≤–¢“V«6Rñbáñ∆ˆBÁvñ∆FW&ÊW72bbˆó5¶ˆÊT&VÜ&Víí∞¢ÚÚvñ∆FW&ÊW72¶ˆÊRw2&V¬FW'&ñ‚FˆW6‚wBWÜó7BVÁFñ¬FÜRñV&«ê¢ÚÚF˜FÜ¬6ÜñgBvVÊW&FW2óBáW&f˜&’F˜FÜ≈6ÜñgB¬∂ñ6∂VBˆfb@¢ÚÚv˜&∆B&ˆ˜B'í6ÜV6µF˜FÜ≈6ÜñgBí(	BvóBf˜"FÜBFÚfñÊó6Ç¬FÜV‡¢ÚÚ'Vñ∆BFÜR¶ˆÊRw24B66VÊRÊB66‚óG27GV¬Fñ∆Rw&ñBf˜"¢ÚÚ6∆V"¬f∆B7˜BFÚG&˜FÜó266VÊRw2vÜˆ∆R∆ˆ6¬fˆ˜G&ñÁBˆÁF¢ÚÚÜfñÊE¶ˆÊU∆6V÷VÁDfˆ˜G&ñÁBí‚FÜRFó&V7F˜"6VÊG2WfW'íˆñÁB¢ÚÚ7F˜"ˆ6÷W&˜6óFñˆ‚ñ‚∆ˆ6¬¬V‚÷Ê6Ü˜&VB6ˆ˜&FñÊFW2f˜"FÜó0¢ÚÚ÷ˆFRá6VR'Vñ∆E&WfñWuñ∆ˆBí&V6ó6V«í&V6W6RFÜBÊ6Ü˜"(	@¢ÚÚvÜñ6Ç÷¬ÊBvÜW&Rˆ‚óB(	B6‚ˆÊ«í&R&W6ˆ«fVBÜW&R¬vñÁ7@¢ÚÚ&V¬vVÊW&FVBFW'&ñ‚¬Ê˜BWFÜ˜&VBÜVBˆbFñ÷R‡¢G'í∞¢ñbÖ˜F˜FÜ≈6ÜñgE&ˆ÷ó6RívóB˜F˜FÜ≈6ÜñgE&ˆ÷ó6S∞¢ñbÇ˜¶ˆÊT∆ñ˜WG2ÊÜ2Ü&Víí∞¢6ÜV6µF˜FÜ≈6ÜñgBÇì∞¢vóB7WG66VÊU&WfñWuvóDf˜$&VÜ&V¬#¬Çí”‚˜¶ˆÊT∆ñ˜WG2ÊÜ2Ü&Víì∞¢–¢'Vñ∆E¶ˆÊU66VÊRÜ&Vì∞¢6ˆÁ7Bg“ñ∆ˆBÊfˆ˜G&ñÁB«¬∑”∞¢6ˆÁ7Bgr“÷FÇÊ÷ÇÉ¬÷FÇÊ6Vñ¬ÜgÁr«¬bíí¬fÇ“÷FÇÊ÷ÇÉ¬÷FÇÊ6Vñ¬ÜgÊÇ«¬bíì∞¢6ˆÁ7BÊ6Ü˜"“fñÊE¶ˆÊU∆6V÷VÁDfˆ˜G&ñÁBÜ&V¬gr¬fÇì∞¢ñbÇÊ6Ü˜"í∞¢7WG66VÊU&WfñWt&ÊÊW"Ü6˜V∆BÊ˜BfñÊB6∆V"G∂gw‹9rG∂fá“7˜Bf˜"FÜó266VÊRˆ‚"G∑ñ∆ˆBÊ÷ñG“"Ê¬G'VRì∞¢7WG66VÊU&WfñWt7FófR“f«6S∞¢&WGW&„∞¢–¢6ˆÁ7Bˆfg6WD2“Ê6Ü˜"Ê6ˆ¬“ÜgÊ˜&ñvñ‰2«¬í¬ˆfg6WE"“Ê6Ü˜"Á&˜r“ÜgÊ˜&ñvñÂ"«¬ì∞¢f˜"Ü6ˆÁ7Bˆbáñ∆ˆBÊ7F˜'2«¬µ“íí∞¢Áv˜&∆D2“ÜÊ∆2«¬í≤ˆfg6WD3∞¢Áv˜&∆E"“ÜÊ«"«¬í≤ˆfg6WE#∞¢–¢f˜"Ü6ˆÁ7B2ˆbáñ∆ˆBÁ7FvW2«¬µ“íí∞¢ñbá2ÁGóR””“v÷˜fRrbb2ÁF&vWD∆ˆ6¬í2ÁF&vWEv˜&∆B“≤3¢2ÁF&vWD∆ˆ6¬Ê∆2≤ˆfg6WD2¬#¢2ÁF&vWD∆ˆ6¬Ê«"≤ˆfg6WE"¬f6ñÊs¢2ÁF&vWD∆ˆ6¬Êf6ñÊrÛÚÁV∆¬”∞¢–¢ñbáñ∆ˆBÊ6÷W&6CÚÊ∆ˆ6≈˜2bbñ∆ˆBÊ6÷W&6CÚÊ∆ˆ6≈F&vWBí∞¢ÚÚ∆ˆ6≈˜2Áíˆ∆ˆ6≈F&vWBÁívW&RWFÜ˜&VBvñÁ7BFÜRFó&V7F˜"w0¢ÚÚf∆Bì”vñ∆FW&ÊW72&7Fñ6Rw&ñBÜw&˜VÊEîB&WGW&Á2f˜ ¢ÚÚ÷÷WFÊ∂ñÊC””“'vñ∆FW&ÊW72"(	BFÜW&Rw2ÊÚ&V¬V∆WfFñˆ‚F¢ÚÚWFÜ˜"vñÁ7BñWBí(	BFBFÜR$T¬FW'&ñ‚w2V∆WfFñˆ‚@¢ÚÚvÜW&WfW"FÜRG&Á6∆FVB6÷W&˜F&vWB7GV∆«í∆ÊB¬˜"FÜP¢ÚÚ&ñr6óG2BFÜRw&ˆÊrÜVñváBFÜRñÁ7FÁBFÜRÊ6Ü˜"∆ÊG0¢ÚÚÁóvÜW&R'WB¶W&Ú÷V∆WfFñˆ‚Fñ∆RÜ7F˜'2Fˆ‚wBÜfRFÜó0¢ÚÚ'Vr(	BFÜVó"íó26ˆ◊WFVBg&W6Çg&ˆ“FÜR&V¬FW'&ñ‚@¢ÚÚ7v‚Fñ÷R¬ˆÊ«íFÜR6÷W&6B&∆ˆ6≤6∂óVBóBí‡¢6ˆÁ7B˜5Ç“ñ∆ˆBÊ6÷W&6BÊ∆ˆ6≈˜2ÁÇ≤ˆfg6WD2¬˜5¢“ñ∆ˆBÊ6÷W&6BÊ∆ˆ6≈˜2Á¢≤ˆfg6WE#∞¢6ˆÁ7BF&vWEÇ“ñ∆ˆBÊ6÷W&6BÊ∆ˆ6≈F&vWBÁÇ≤ˆfg6WD2¬F&vWE¢“ñ∆ˆBÊ6÷W&6BÊ∆ˆ6≈F&vWBÁ¢≤ˆfg6WE#∞¢6ˆÁ7B˜4V∆Weí“Á57W&f6UíÜ&V¬÷FÇÁ&˜VÊBá˜5Çí¬÷FÇÁ&˜VÊBá˜5¢íì∞¢6ˆÁ7BF&vWDV∆Weí“Á57W&f6UíÜ&V¬÷FÇÁ&˜VÊBáF&vWEÇí¬÷FÇÁ&˜VÊBáF&vWE¢íì∞¢ñ∆ˆBÊ6÷W&6BÁv˜&∆E˜2“≤É¢˜5Ç¬ì¢ñ∆ˆBÊ6÷W&6BÊ∆ˆ6≈˜2Áí≤˜4V∆Weí¬£¢˜5¢”∞¢ñ∆ˆBÊ6÷W&6BÁv˜&∆EF&vWB“≤É¢F&vWEÇ¬ì¢ñ∆ˆBÊ6÷W&6BÊ∆ˆ6≈F&vWBÁí≤F&vWDV∆Weí¬£¢F&vWE¢”∞¢–¢FV'Vt∆ˆrÜ∂7WG66VÊR&WfñWu“vñ∆FW&ÊW72∆6V÷VÁC¢G∑ñ∆ˆBÊ÷ñG“fˆ˜G&ñÁBG∂gw◊ÇG∂fá“Ê6Ü˜&VBBÇG∂Ê6Ü˜"Ê6ˆ«“¬G∂Ê6Ü˜"Á&˜w“ñì∞¢“6F6ÇÜRí≤6ˆÁ6ˆ∆RÊW'&˜"Çu∂7WG66VÊR&WfñWu“vñ∆FW&ÊW72¶ˆÊR∆6V÷VÁBfñ∆VC¢r¬Rì≤–¢–¢6ˆÁ7B&VGí“vóB7WG66VÊU&WfñWuvóDf˜$&VÜ&V¬#ì∞¢ñbÇ&VGíí∞¢7WG66VÊU&WfñWt&ÊÊW"Ü6˜V∆BÊ˜B∆ˆB÷"G∑ñ∆ˆBÊ÷ñG“"f˜"&WfñWrÊ¬G'VRì∞¢7WG66VÊU&WfñWt7FófR“f«6S∞¢&WGW&„∞¢–¢7W'&VÁD&V“&V≤ÚÚ7vóF6ÜW2FÜRvÜˆ∆Rv÷Rw2&VÊFW"ˆ7FófR◊66VÊRF&vWBFÚFÜR7WG66VÊRw2÷ †¢ÚÚvóFÜ˜WBFÜó2¬Â2fF'26ñ∆VÁF«íf∆¬&6≤FÚ∆6VÜˆ∆FW ¢ÚÚ67V∆W3¢'Vñ∆E&ˆfñ∆Tg&ˆ‘Á4Wá˜'BÜÁ2÷fF"◊&WfñWr◊WFñ«2Êß2ê¢ÚÚ&WGW&Á2ÁV∆¬vÜVÊWfW"óG2÷ˆGV∆R÷∆WfV¬6˜6÷WFñ7266ÜRÜ6‚w@¢ÚÚ∆ˆFVBñWB‚7vÂ∆ñW$fF"w2˜v‚&ˆ˜B◊Fñ÷R6∆¬Üv÷RÊß0¢ÚÚ„ìÉÉ2í&6W2FÜó2gVÊ7Fñˆ‚&FÜW"FÜ‚&V∆ñ&«í&VFñÊróB¬6¢ÚÚFÜó2vóG2ˆ‚FÜR6÷R6Ü&VB66ÜR˜&ˆ÷ó6RWá∆ñ6óF«í‡¢vóBvñÊF˜r‰Á4fF%&WfñWrÊVÁ7W&U˜'G&óD6˜6÷WFñ72á≤76WD&6S¢r‚ˆ76WG2Úr¬6ˆÊfñt&6S¢r‚ˆ6ˆÊfñrÚr“ì∞†¢6ˆÁ7BF&vWE66VÊR“66VÊTf˜$Á4&VÜ&Vì∞¢6ˆÁ7BF&vWDw&ñB“Á4w&ñDf˜$&VÜ&Vì∞¢6ˆÁ7BF&vWD6ˆ«2“vWD7FófT6ˆ«2Çì∞¢6ˆÁ7BF&vWE&˜w2“vWD7FófU&˜w2Çì∞†¢ÚÚ)H)H6÷W&¢‚&W7F&∆ó6ÜñÊr"÷ˆFRf˜"WfW'óFÜñÊrWÜ6WB7FófP¢ÚÚFñ∆ˆwVR¬6ˆ◊WFVBg&ˆ“FÜRFó&V7F˜"w26GW&VB6Ü˜BÜ«&VGê¢ÚÚ&W6ˆ«fVBFÚv˜&∆BFñ∆R◊76RífñFÜR6÷P¢ÚÚFó7FÊ6RˆÊv∆Tg&ˆ‘w&˜VÊDFVrˆ¶ñ◊WFÑFVr&6ó2FÜR&V¬fó6ÜñÊp¢ÚÚ÷ñÊñv÷Rw26÷W&÷÷ˆFR7vW6W2á6VRWFFT6÷W&˜6óFñˆ‚í‡¢ÚÚ6WBW&Vf˜&R7F˜'27v‚á&FÜW"FÜ‚gFW"¬g&ˆ“FÜVó ¢ÚÚVÁFóFñW2í6Ú6÷W&Á˜6óFñˆ‚ó2«&VGí6˜'&V7Bñ‚Fñ÷Rf˜ ¢ÚÚV6ÇÂ2˜∆ñW"7F˜"w2ñÊóFñ¬7v‚f6ñÊrFÚ6ÜV6≤óG6V∆`¢ÚÚvñÁ7BóBá6VR7WG66VÊU&WfñWtÁ4f6ñÊt6ÜVDÊv∆R&V∆˜rí‡¢6ˆÁ7B&6TF∆t6fr“6÷W&÷ˆFT6ˆÊfñrÜ6÷W&6ˆÊfñrÇíÊFñ∆ˆwVT÷ˆFR«¬vÁ4Fñ∆ˆwVRrì∞¢6ˆÁ7BF∆t÷ˆFT∂Wí“v7WG66VÊU&WfñWtFñ∆ˆwVRs∞¢ávñÊF˜rÂ45$D4Ñ$Ù‰U5Ù4Ù‰dîrÊv÷RÊ6÷W&Ê÷ˆFW2«√“∑“ï∂F∆t÷ˆFT∂Wï““∞¢‚‚Ê&6TF∆t6fr¿¢ÚÚ&V¬v÷W∆íw2∆ñvÂFÙFñ∆ˆwVU˜'G&óD6VÁFW'2Ü&F6ˆFW2FÜP¢ÚÚ7GV¬∆ñW"÷W6Ç2ˆÊRˆbóG2GvÚg&÷ñÊrÊ6Ü˜'2¬vÜñ6Çó0¢ÚÚ÷VÊñÊv∆W72ÜW&RÜÊVóFÜW"7WG66VÊR7V∂W"ó2WfW"FÜR&V¿¢ÚÚ∆ñW"í(	B'WBFÜR∆ñvÊ÷VÁBóG6V∆bÜ‚WñR÷∆WfV¬6Ü˜BñÊÊVBF¢ÚÚFÜR7V∂W"w2˜v‚fó7V¬6VÁFW"¬Ê˜BFÜRvVÊW&ñ2V∆WfFV@¢ÚÚfˆ∆∆˜r÷6÷W&w26ñ‚ÜÊv∆Rí¶Fó7FÊ6R6∆ñ÷"&˜fRóBíó2WÜ7F«ê¢ÚÚvÜB7WG66VÊR6∆˜6R◊WvÁG2FˆÚ¬6ÚFÜó27Fó2ˆ‚Ê@¢ÚÚFñ∆ˆwVU˜'G&óD6÷W&ñ“7V'7FóGWFW2FÜR7V∂ñÊr7F˜"w2˜v‡¢ÚÚ6VÁFW"á6VR7WG66VÊU&WfñWu7V∂W$6VÁFW%ííñÁ7FVBˆb∆ñW$÷W6Ä¢ÚÚvÜVÊWfW"7WG66VÊU&WfñWt7FófRó26WB‡¢∆ñvÂFÙFñ∆ˆwVU˜'G&óD6VÁFW'3¢G'VR¿¢”∞¢ÚÚ7&VGW&Rw2&ˆ˜B˜6óFñˆ‚ÜfF%&VbÊw&˜Wí«&VGí6óG2BóG0¢ÚÚ˜v‚&ˆGí÷6VÁFW"ÜVñváBá6VR÷∂T7&VGW&TVÁFóGí˜WFFT7&VGW&T÷W6Çí¿¢ÚÚVÊ∆ñ∂R‚Â2v∆∂W"w2&ˆ˜B¬vÜñ6Ç6óG2Bw&˜VÊB∆WfV¬(	B6ÚFÜP¢ÚÚáV÷‚÷6ÜW7B÷ÜVñváBF&vWEîˆfg6WEFñ∆W2Á4Fñ∆ˆwVRGVÊW2f˜ ¢ÚÚ˜fW'6Üˆ˜G2ví&˜fR∆˜r◊6«VÊr7&VGW&R∆ñ∂Rvˆ∆b‚FÜó0¢ÚÚf&ñÁB∆ˆˆ∑2ˆÊ«í6∆ñváF«í&˜fRFÜR7&VGW&Rw2˜v‚6VÁFW"Ê@¢ÚÚ6óG2∆˜vW"ˆ6∆˜6W"6ÚóB7Fñ∆¬&VG22&˜W"6∆˜6R◊W‡¢6ˆÁ7BF∆t÷ˆFT∂Wî7&VGW&R“v7WG66VÊU&WfñWtFñ∆ˆwVT7&VGW&Rs∞¢vñÊF˜rÂ45$D4Ñ$Ù‰U5Ù4Ù‰dîrÊv÷RÊ6÷W&Ê÷ˆFW5∂F∆t÷ˆFT∂Wî7&VGW&U““∞¢‚‚Ê&6TF∆t6fr¿¢ÚÚ«6ÚñÊÊVBFÚFÜR7V∂W"w2˜v‚6VÁFW"Ü6÷W&íˆ∆ˆˆµí6ˆ÷Rg&ˆ–¢ÚÚFñ∆ˆwVU˜'G&óD6÷W&ñ“¬Ê˜BF&vWEîˆfg6WEFñ∆W2ˆÊv∆R&V∆˜rí(	@¢ÚÚÊv∆Tg&ˆ‘w&˜VÊDFVrˆFó7FÊ6UFñ∆W27Fñ∆¬6ÜRFÜRÜ˜&ó¶ˆÁF¿¢ÚÚg&÷ñÊrÜ¶ñ◊WFÇFó7FÊ6RˆÜVñváB÷ˆb◊6Ü˜BfVV¬í¬ßW7BÊÚ∆ˆÊvW ¢ÚÚFÜRfW'Fñ6¬6∆ñ÷"‡¢∆ñvÂFÙFñ∆ˆwVU˜'G&óD6VÁFW'3¢G'VR¿¢F&vWEîˆfg6WEFñ∆W3¢„Ç¿¢Êv∆Tg&ˆ‘w&˜VÊDFVs¢÷FÇÊ÷ñ‚Ü&6TF∆t6frÊÊv∆Tg&ˆ‘w&˜VÊDFVrÛÚ„cB¬bí¿¢Fó7FÊ6UFñ∆W3¢Ü&6TF∆t6frÊFó7FÊ6UFñ∆W2ÛÚB„crí¢„sÇ¿¢”∞†¢∆WBñF∆T6÷W&÷ˆFR¬ñF∆T6÷W&F&vWC∞¢ñbáñ∆ˆBÊ6÷W&6Bí∞¢6ˆÁ7B“ñ∆ˆBÊ6÷W&6BÁv˜&∆E˜2¬B“ñ∆ˆBÊ6÷W&6BÁv˜&∆EF&vWC∞¢6ˆÁ7BGÇ“ÁÇ“BÁÇ¬Gí“Áí“BÁí¬G¢“Á¢“BÁ£∞¢6ˆÁ7BFó7FÊ6R“÷FÇÊ÷ÇÉ„R¬÷FÇÊáó˜BÜGÇ¬Gí¬G¢íì∞¢6ˆÁ7BÊv∆Tg&ˆ‘w&˜VÊDFVr“÷FÇÊ6ñ‚Ü6∆◊ÜGíÚFó7FÊ6R¬”¬íí¢ÉÚ÷FÇÂì∞¢6ˆÁ7B¶ñ◊WFÑFVr“÷FÇÊF„"ÜGÇ¬G¢í¢ÉÚ÷FÇÂì∞¢6ˆÁ7B6Ü˜D÷ˆFT∂Wí“v7WG66VÊU&WfñWu6Ü˜Bs∞¢vñÊF˜rÂ45$D4Ñ$Ù‰U5Ù4Ù‰dîrÊv÷RÊ6÷W&Ê÷ˆFW5∑6Ü˜D÷ˆFT∂Wï““≤Fó7FÊ6UFñ∆W3¢Fó7FÊ6R¬Êv∆Tg&ˆ‘w&˜VÊDFVr¬¶ñ◊WFÑFVr¬f˜dFVs¢C"¬fˆ∆∆˜t∆W'¢¬F&vWEîˆfg6WEFñ∆W3¢”∞¢ñF∆T6÷W&÷ˆFR“6Ü˜D÷ˆFT∂Wì∞¢ñF∆T6÷W&F&vWB“≤˜6óFñˆ„¢ÊWrDÖ$TRÂfV7F˜#2áBÁÇ¬BÁí¬BÁ¢í”∞¢6’F&vWEÇ“BÁÉ≤6’F&vWEí“BÁì≤6’F&vWE¢“BÁ£≤ÚÚñÁ7FÁB7WB¬Ê˜B6∆˜r∆W'ñ‚g&ˆ“FÜRf&“7v‡¢“V«6R∞¢6ˆÁ7Bfó'7D7F˜"“áñ∆ˆBÊ7F˜'2«¬µ“ï≥”∞¢ñF∆T6÷W&÷ˆFR“6÷W&6ˆÊfñrÇíÊFVfV«D÷ˆFR«¬vFVfV«Bs∞¢ñbÜfó'7D7F˜"í∞¢6ˆÁ7BgÇ“fó'7D7F˜"Áv˜&∆D2≤„R¬g¢“fó'7D7F˜"Áv˜&∆E"≤„R¬gí“Á57W&f6UíÜ&V¬fó'7D7F˜"Áv˜&∆D2¬fó'7D7F˜"Áv˜&∆E"ì∞¢ñF∆T6÷W&F&vWB“≤˜6óFñˆ„¢ÊWrDÖ$TRÂfV7F˜#2ÜgÇ¬gí¬g¢í”∞¢6’F&vWEÇ“gÉ≤6’F&vWEí“gì≤6’F&vWE¢“g£∞¢“V«6R∞¢ñF∆T6÷W&F&vWB“ÁV∆√∞¢–¢–¢7FófT6÷W&÷ˆFR“ñF∆T6÷W&÷ˆFS∞¢7FófT6÷W&F&vWB“ñF∆T6÷W&F&vWC∞¢WFFT6÷W&˜6óFñˆ‚Çì∞†¢6ˆÁ7BVÁFóFñW2“ÊWr÷Çì≤ÚÚ7F˜$ñB”‚≤∂ñÊC¢vÁ2w¬v7&VGW&Rw¬w∆6VÜˆ∆FW"r¬&ˆ˜B¬‚‚‚–¢f˜"Ü6ˆÁ7B7F˜"ˆbáñ∆ˆBÊ7F˜'2«¬µ“íí∞¢∆WBVÁFóGí“ÁV∆√∞¢G'í∞¢ñbÜ7F˜"ÊÁ4ñBbb7F˜"ÊÁ5&V6˜&Bí∞¢6ˆÁ7Bv∆∂W"“vóB÷∂TÁ5v∆∂W"Ü7F˜"ÊÁ5&V6˜&B¬≤&V¬3¢7F˜"Áv˜&∆D2¬#¢7F˜"Áv˜&∆E"“ì∞¢ñbáv∆∂W"í∞¢v∆∂W"Á&˜B“DÖ$TR‰÷FÖWFñ«2ÊFVuFı&BÜ7F˜"Á&˜FFñˆ‚«¬ì≤ÚÚ6˜'&V7FVB&V∆˜rˆÊ6R7F˜%7FFW2ˆ«ï7FFRWÜó7B(	B6VRFÜRñÊóFñ¬◊˜6R72&Vf˜&R'VÂ7FvP¢v∆∂W"Á&ˆ˜BÁ&˜FFñˆ‚Áí“v∆∂W"Á&˜C∞¢v∆∂W"ÁW6R“ñÊfñÊóGì≤ÚÚ67&óFVBVÁFó&V«í'íFÜRFó&V7F˜"&V∆˜r(	BÊWfW"FÜRñF∆R˜vÊFW"ê¢VÁFóGí“≤∂ñÊC¢vÁ2r¬&ˆ˜C¢v∆∂W"Á&ˆ˜B¬v∆∂W"¬&V3¢7F˜"ÊÁ5&V6˜&B¬&ˆfñ∆S¢v∆∂W"Á&ˆfñ∆R¬fF$g&ˆÁD6Áf3¢v∆∂W"ÊfF$g&ˆÁD6Áf2¬fF$&6¥6Áf3¢v∆∂W"ÊfF$&6¥6Áf2”∞¢–¢“V«6RñbÜ7F˜"Ê7&VGW&UGóTñBbb5$TEU$UÙD%∂7F˜"Ê7&VGW&UGóTñE“í∞¢ÚÚ÷∂T7&VGW&TVÁFóGíw2w&˜VÊB÷ÜVñváB∆ˆˆ∑W&VG2FÜRv∆ˆ&¿¢ÚÚ7W'&VÁD&VFó&V7F«í&FÜW"FÜ‚F∂ñÊróB2‚˜Fñˆ‚¿¢ÚÚ6ÚóBw2&ˆˆ∂VÊFVBÜW&RWfV‚FÜ˜VvÇ7W'&VÁD&V«&VGê¢ÚÚWV«2&V'íFÜó2ˆñÁBÜ∂WBWá∆ñ6óBˆFVfVÁ6ófRñ‡¢ÚÚ66RFÜB76ñvÊ÷VÁB&˜fRWfW"÷˜fW2í‡¢6ˆÁ7B6fVD&V“7W'&VÁD&V∞¢7W'&VÁD&V“&V∞¢6ˆÁ7B7&VGW&R“÷∂T7&VGW&TVÁFóGíÜ7F˜"Ê7&VGW&UGóTñB¬Ü7F˜"Áv˜&∆D2≤„Rí¢DîƒR¬Ü7F˜"Áv˜&∆E"≤„Rí¢DîƒR¬≤66VÊS¢F&vWE66VÊR¬w&ñC¢F&vWDw&ñB¬6ˆ«3¢F&vWD6ˆ«2¬&˜w3¢F&vWE&˜w2“ì∞¢7W'&VÁD&V“6fVD&V∞¢ñbÜ7&VGW&Rí∞¢7&VGW&RÊfF%&VbÊw&˜WÁ&˜FFñˆ‚Áí“DÖ$TR‰÷FÖWFñ«2ÊFVuFı&BÜ7F˜"Á&˜FFñˆ‚«¬ì∞¢VÁFóGí“≤∂ñÊC¢v7&VGW&Rr¬&ˆ˜C¢7&VGW&RÊfF%&VbÊw&˜W¬7&VGW&R”∞¢–¢“V«6RñbÜ7F˜"Êó5∆ñW"í∞¢ÚÚFÜR66VÊRw2WFÜ˜&VB7FÊB÷ñ‚f˜"vÜˆWfW"w27GV∆«í'VÊÊñÊp¢ÚÚFÜó2&WfñWr(	B'Vñ«BFá&˜VvÇFÜRWÜ7B6÷R÷∂TÁ5v∆∂W ¢ÚÚóV∆ñÊR‚Â27F˜"W6W2¬ßW7BfVB7ñÁFÜWFñ2'&V6˜&B ¢ÚÚ6˜W&6VBg&ˆ“FÜR&V¬∆ñW"w2˜v‚V&Ê6RñÁ7FVBˆbFÜP¢ÚÚÂ2FF&6R¬6ÚóBvWG2&V¬‰r◊∆ÊRfF"ñÁ7FVBˆ`¢ÚÚFÜRvVÊW&ñ2∆6VÜˆ∆FW"WfW'í˜FÜW"g&VVf˜&“7F˜"f∆«0¢ÚÚ&6≤FÚ‡¢6ˆÁ7B∆ñW%&ˆfñ∆R“˜∆ñW$FF«¬vñÊF˜rÂıˆÜˆ'VÊ¶ï∆ñW%&ˆfñ∆S∞¢6ˆÁ7Bf∂U&V2“∞¢ñC¢w∆ñW"r¬Ê÷S¢7F˜"ÊÊ÷R«¬u∆ñW"r¿¢V&Ê6S¢∆ñW%&ˆfñ∆SÚÊV&Ê6R¿¢WVóVD6˜6÷WFñ73¢∆ñW%&ˆfñ∆SÚÊWVóVD6˜6÷WFñ72«¬µ“¿¢∆ñVDGñW3¢∆ñW%&ˆfñ∆SÚÊ∆ñVDGñW2«¬∑“¿¢”∞¢6ˆÁ7Bv∆∂W"“vóB÷∂TÁ5v∆∂W"Üf∂U&V2¬≤&V¬3¢7F˜"Áv˜&∆D2¬#¢7F˜"Áv˜&∆E"“ì∞¢ñbáv∆∂W"í∞¢v∆∂W"Á&˜B“DÖ$TR‰÷FÖWFñ«2ÊFVuFı&BÜ7F˜"Á&˜FFñˆ‚«¬ì≤ÚÚ6˜'&V7FVB&V∆˜rˆÊ6R7F˜%7FFW2ˆ«ï7FFRWÜó7B(	B6VRFÜRñÊóFñ¬◊˜6R72&Vf˜&R'VÂ7FvP¢v∆∂W"Á&ˆ˜BÁ&˜FFñˆ‚Áí“v∆∂W"Á&˜C∞¢v∆∂W"ÁW6R“ñÊfñÊóGì∞¢VÁFóGí“≤∂ñÊC¢vÁ2r¬&ˆ˜C¢v∆∂W"Á&ˆ˜B¬v∆∂W"¬&V3¢f∂U&V2¬&ˆfñ∆S¢v∆∂W"Á&ˆfñ∆R¬fF$g&ˆÁD6Áf3¢v∆∂W"ÊfF$g&ˆÁD6Áf2¬fF$&6¥6Áf3¢v∆∂W"ÊfF$&6¥6Áf2”∞¢–¢–¢“6F6ÇÜRí≤6ˆÁ6ˆ∆RÊW'&˜"Çu∂7WG66VÊR&WfñWu“7F˜"7v‚fñ∆VBf˜"r¬7F˜"ÊÊ÷R¬Rì≤–¢ñbÇVÁFóGííVÁFóGí“7WG66VÊU&WfñWt÷∂U∆6VÜˆ∆FW"Ü7F˜"¬&V¬F&vWE66VÊRì∞¢VÁFóFñW2Á6WBÜ7F˜"ÊñB¬VÁFóGíì∞¢–†¢ÚÚ)H)H7FvRVÊvñÊR)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H ¢ÚÚ6÷R÷˜fR˜F∆≤ˆ6Üˆñ6RˆÊñ÷Fñˆ‚˜GW&‚ˆ6ˆ÷&BˆfFR6V÷ÁFñ720¢ÚÚFˆ72˜Fˆˆ«2ˆ7WG66VÊR÷Fó&V7F˜"ˆñÊFWÇÊáF÷¬w2˜v‚&WfñWrVÊvñÊP¢ÚÚá˜'FVB¬Ê˜B6Ü&VB6ˆFR(	BFÜBFˆˆ¬G&ófW2&ófFRFá&VRÊß0¢ÚÚ66VÊR¬FÜó2G&ófW2&V¬7vÊVBVÁFóFñW2≤FÜR&V¬Fñ∆ˆwVRTíí¿¢ÚÚ&VFñÊrñ∆ˆBFÜRFó&V7F˜"Fˆˆ¬Ü2«&VGígV∆«í&W6ˆ«fV@¢ÚÚFÚv˜&∆BFñ∆R6ˆ˜&FñÊFW2á6VRóG2%&WfñWrñ‚v÷R"ÜÊF∆W"í‡¢6ˆÁ7B7F˜'4'îñB“ÊWr÷Çáñ∆ˆBÊ7F˜'2«¬µ“íÊ÷Ü”‚∂ÊñB¬“íì∞¢ÚÚWFÜ˜&VB&˜FFñˆ‚¬W6VBWÜ7F«í2vófV‚(	BÊÚ6÷W&◊fó6ñ&ñ∆óGê¢ÚÚ&ñ6ñÊr‚FÜó2ó2FÜR6ñÊv∆R6˜W&6RˆbG'WFÇf˜"WfW'í7F˜"w0¢ÚÚ&˜FFñˆ‚g&ˆ“ÜW&Rˆ‚¬∂WBñ‚7ñÊ2vóFÇFÜR÷W6ÇˆÊ«íFá&˜VvÄ¢ÚÚ«ï7FFR¬6ÚóB6‚wBG&ñgB˜WBˆb7ñÊ2vóFÇvÜBw27GV∆«íˆ‡¢ÚÚ67&VV‚FÜRví6ˆ◊WFñÊróBGvñ6Rv˜V∆B‡¢6ˆÁ7B7F˜%7FFW2“ÊWr÷Çáñ∆ˆBÊ7F˜'2«¬µ“íÊ÷Ü”‡¢∂ÊñB¬≤3¢Áv˜&∆D2¬#¢Áv˜&∆E"¬&˜FFñˆ„¢Á&˜FFñˆ‚«¬¬˜6S¢Á˜6R«¬w7FÊFñÊrr¬6ˆ÷&Dˆ„¢f«6R¬6‰∆˜6S¢f«6R’–¢íì∞¢ÚÚ7F˜$ñB”‚FW6ó&VBf6ñÊrñ‚FVw&VW3¢vÜBV6Ç7F˜"ó27W'&VÁF«ê¢ÚÚG'ññÊrFÚf6Rá6WBB7v‚g&ˆ“óG2&rWFÜ˜&VB&˜FFñˆ‚¬Ê@¢ÚÚvÜVÊWfW"GW&‚6&B˜"÷˜fRw2'&óf¬f6ñÊrvófW2óBÊWp¢ÚÚˆÊRí‚7WG66VÊU&˜FFñˆÂFñ6≤Ü&V∆˜ríó2FÜRˆÊ«íFÜñÊrFÜBWfW ¢ÚÚGW&Á2FÜó2ñÁFÚ‚7GV¬÷W6Ç&˜FFñˆ‚¬6ˆÁFñÁV˜W6«í¬f˜"FÜP¢ÚÚ7F˜"w2VÁFó&RFñ÷Rˆ‚67&VV‚(	B÷ó'&˜&ñÊrÜ˜r&V¬v÷W∆íÊWfW ¢ÚÚ6Ê27FFñˆÊ'íÂ2ˆ7&VGW&Rw2f6ñÊrñ‚ˆÊRg&÷RVóFÜW"á6VP¢ÚÚf6TÁ4Fñ∆ˆwVU'Fñ6óÁG2w2Á4f6U∆ñW$∆W'¬WFFTÜ˜7Fñ∆W2¢ÚÚWFFT6ˆ◊ÊñˆÁ26∆∆ñÊrWFFT7&VGW&T÷W6ÇWfW'íg&÷RvÜWFÜW"¢ÚÚ7&VGW&Ró2÷˜fñÊr˜"Üˆ∆FñÊr7Fñ∆¬í(	B&FÜW"FÜ‚fóÜVB–¢ÚÚGW&Fñˆ‚ˆÊR◊6Ü˜B'GW&‚6&B"Êñ÷Fñˆ‚FÜB7F˜2G&ófñÊrˆÊ6P¢ÚÚóG2˜v‚Fñ÷W"'VÁ2˜WB‡¢6ˆÁ7BFW6ó&VDf6ñÊtFVr“ÊWr÷Çáñ∆ˆBÊ7F˜'2«¬µ“íÊ÷Ü”‚∂ÊñB¬Á&˜FFñˆ‚«¬“íì∞¢ÚÚ7F˜$ñG27W'&VÁF«í˜vÊñÊrFÜVó"˜v‚&˜FFñˆ‚V6Çg&÷R(	B÷˜fP¢ÚÚ7FvRw2˜v‚W"÷g&÷R7FWW"áv∆∂W"Ê÷˜fUF˜v&Bw2W'6∆◊¬˜ ¢ÚÚWFFT7&VGW&T÷W6ÇG&ófV‚'í∆ófRG&fV¬Fó&V7Fñˆ‚í¬˜"6ˆ÷&@¢ÚÚ7FvRw2&V¬Ü˜7Fñ∆Tˆ&¶V7G2ˆ6ˆ◊Êñˆ‰ˆ&¶V7G2íáWFFTÜ˜7Fñ∆W2¢ÚÚWFFT6ˆ◊ÊñˆÁ2¬vÜñ6Ç«6Ú6∆¬WFFT7&VGW&T÷W6ÇFÜV◊6V«fW0¢ÚÚvóFÇFÜVó"˜v‚6Ü6R◊F&vWBñ‘Êv∆Rí‚7WG66VÊU&˜FFñˆÂFñ6≤6∂ó0¢ÚÚÁñˆÊRñ‚ÜW&R6ÚóBÊWfW"fñváG2vÜFWfW"w27FófV«íG&ófñÊrFÜV“‡¢6ˆÁ7BWáFW&Ê∆«îG&ófV‰7F˜$ñG2“ÊWr6WBÇì∞¢6ˆÁ7B7FvW4'îñB“ÊWr÷Çáñ∆ˆBÁ7FvW2«¬µ“íÊ÷á2”‚∑2ÊñB¬5“íì∞¢6ˆÁ7B7FvT˜&FW"“áñ∆ˆBÁ7FvW2«¬µ“íÊ÷á2”‚2ÊñBì∞¢∆WB'VÊÊñÊr“G'VS∞†¢6ˆÁ7BvWE&W6ˆ«fVDÊWáB“á7FvTñB¬&WVW7FVDÊWáBí”‚∞¢ñbá&WVW7FVDÊWáB””“uıˆVÊEıÚrí&WGW&‚ÁV∆√∞¢ñbá&WVW7FVDÊWáBbb&WVW7FVDÊWáB”“uıˆÊWáEıÚrí&WGW&‚7FvW4'îñBÊÜ2á&WVW7FVDÊWáBíÚ&WVW7FVDÊWáB¢ÁV∆√∞¢&WGW&‚7FvT˜&FW%∑7FvT˜&FW"ÊñÊFWÑˆbá7FvTñBí≤“«¬ÁV∆√∞¢”∞¢6ˆÁ7BÊv∆UF˜v&E7FFR“7WG66VÊU&WfñWtÊv∆UF˜v&C∞¢6ˆÁ7B'Vñ∆Dw&ñEFÇ“á7F'B¬vˆ¬í”‚∞¢6ˆÁ7BFÇ“∑≤3¢7F'BÊ2¬#¢7F'BÁ"’”∞¢∆WB2“7F'BÊ2¬"“7F'BÁ"¬Ü˜&ó¶ˆÁF≈GW&‚“G'VS∞¢vÜñ∆RÜ2”“vˆ¬Ê2«¬"”“vˆ¬Á"í∞¢6ˆÁ7B6‰Ç“2”“vˆ¬Ê2¬6Âb“"”“vˆ¬Á#∞¢ñbÇÜÜ˜&ó¶ˆÁF≈GW&‚bb6‰Çí«¬6Âbí2≥“÷FÇÁ6ñv‚Üvˆ¬Ê2“2ì≤V«6R"≥“÷FÇÁ6ñv‚Üvˆ¬Á"“"ì∞¢FÇÁW6Çá≤2¬"“ì∞¢Ü˜&ó¶ˆÁF≈GW&‚“Ü˜&ó¶ˆÁF≈GW&„∞¢–¢&WGW&‚FÉ∞¢”∞¢6ˆÁ7B«ï7FFR“7F˜$ñB”‚≤6ˆÁ7BVÁFóGí“VÁFóFñW2ÊvWBÜ7F˜$ñBí¬7B“7F˜%7FFW2ÊvWBÜ7F˜$ñBì≤ñbÜVÁFóGíbb7Bí7WG66VÊU&WfñWt«ï7FFRÜVÁFóGí¬&V¬7Bì≤”∞†¢ÚÚW"÷g&÷RG&fV¬F˜v&BFñ∆R÷6VÁFW"F&vWB¬&WW6ñÊrFÜR&V¿¢ÚÚv÷Rw2˜v‚∆ˆ6ˆ÷˜Fñˆ‚ñÁ7FVBˆbFÜRFó67&WFRw&ñB÷Ü˜7FWñÊp¢ÚÚFÜó2W6VBFÚFÛ¢‚Â27F˜"&ñFW2FÜRWÜ7B6÷P¢ÚÚv∆∂W"Ê÷˜fUF˜v&BÇíFÜR66ÜVGV∆R7ó7FV“G&ófW2&V¬fñ∆∆vW'0¢ÚÚvóFÇ¬ÊB7&VGW&R7F˜"&ñFW2÷˜fT7&VGW&UF˜v&BÇí∞¢ÚÚWFFT7&VGW&T÷W6ÇÇí˜WFFT7&VGW&TÊñ‘g&÷RÇí(	BFÜR6÷RG&ñ¢ÚÚWFFTÜ˜7Fñ∆W2ÇíG&ófW2vñ∆B7&VGW&W2vóFÇ‚g&VVf˜&“ˆfñ∆VB–¢ÚÚ7v‚∆6VÜˆ∆FW"7F˜"Ü2ÊÚ&V¬7ó7FV“FÚ&˜'&˜r¬6ÚóBvWG0¢ÚÚ‚ÜˆÊW7B7G&ñváB÷∆ñÊR∆W'á6÷RFVw&FR÷w&6VgV∆«íˆ∆ñ7í0¢ÚÚ7WG66VÊU&WfñWt÷∂U∆6VÜˆ∆FW"óG6V∆bí‚&WGW&Á2G'VRˆÊ6R'&ófVB‡¢6ˆÁ7BGfÊ6T7F˜%F˜v&B“Ü7F˜$ñB¬GÇ¬G¢¬GB¬7VVD◊V¬“í”‚∞¢6ˆÁ7BVÁFóGí“VÁFóFñW2ÊvWBÜ7F˜$ñBí¬7B“7F˜%7FFW2ÊvWBÜ7F˜$ñBì∞¢ñbÇVÁFóGí«¬7Bí&WGW&‚G'VS∞¢ñbÜVÁFóGíÊ∂ñÊB””“vÁ2rbbVÁFóGíÁv∆∂W"í∞¢VÁFóGíÁv∆∂W"Ê6F6áW“7VVD◊V√≤ÚÚ&WfñWr◊67&óFVBv∆∂W'2&RÊWfW"66ÜVGV∆R÷G&ófV‚¬6Ú6F6áWó2g&VRFÚ&WW'˜6R27VVBFñ¿¢6ˆÁ7B'&ófVB“VÁFóGíÁv∆∂W"Ê÷˜fUF˜v&BáGÇ¬G¢¬GBì∞¢7BÊ2“VÁFóGíÁ&ˆ˜BÁ˜6óFñˆ‚ÁÇ“„S∞¢7BÁ"“VÁFóGíÁ&ˆ˜BÁ˜6óFñˆ‚Á¢“„S∞¢7BÁ&˜FFñˆ‚“DÖ$TR‰÷FÖWFñ«2Á&EFÙFVrÜVÁFóGíÁv∆∂W"Á&˜Bì∞¢&WGW&‚'&ófVC∞¢–¢ñbÜVÁFóGíÊ∂ñÊB””“v7&VGW&RrbbVÁFóGíÊ7&VGW&Rí∞¢6ˆÁ7B2“VÁFóGíÊ7&VGW&S∞¢6ˆÁ7B7VVB“Ü2ÊFVbÊ÷˜fU7VVB«¬"„Bí¢7VVD◊V√∞¢6ˆÁ7B÷˜fñÊr“÷˜fT7&VGW&UF˜v&BÜ2¬GÇ¢DîƒR¬G¢¢DîƒR¬7VVB¬GBì∞¢6ˆÁ7BFó7B“÷FÇÊáó˜BÜ2ÁÇ“GÇ¢DîƒR¬2Áí“G¢¢DîƒRì∞¢6ˆÁ7Bñ‘Êv∆R“÷˜fñÊrÚ÷FÇÊF„"áG¢¢DîƒR“2Áí¬GÇ¢DîƒR“2ÁÇí¢2Êf6ñÊs∞¢2Êf6ñÊr“ñ‘Êv∆S∞¢WFFT7&VGW&T÷W6ÇÜ2¬GB¬ñ‘Êv∆Rì∞¢WFFT7&VGW&TÊñ‘g&÷RÜ2¬GB¬÷˜fñÊrì∞¢7BÊ2“2ÁÇÚDîƒR“„S∞¢7BÁ"“2ÁíÚDîƒR“„S∞¢ÚÚ7BÁ&˜FFñˆ‚ó2FÜR&Fó&V7B÷ˆFV¬í◊&˜FFñˆ‚"6ˆÁfVÁFñˆ‚WfW'ê¢ÚÚ˜FÜW"7&VGW&R&˜FFñˆ‚FÇW6W2ÖGW&‚6&G2¬7v‚¬FÜP¢ÚÚFˆˆ¬w2˜v‚vó¶÷Ú˜&WfñWrí(	B‰ıBñ‘Êv∆Rw2&rv˜&∆B÷Fó&V7Fñˆ‡¢ÚÚ6ˆÁfVÁFñˆ‚áWFFT7&VGW&T÷W6ÇñÁFW&Ê∆«í÷2ñ‘Êv∆RF¢ÚÚw&˜W&˜Bfñ&uF&vWE&˜Eí““Üñ‘Êv∆Rí≤íÛ"¬&Vf∆V7FVB¿¢ÚÚ¶Ê˜B¢6ñ◊«íˆfg6WB¬&V∆FñˆÁ6Üóí‚&VFñÊróB&6≤g&ˆ“FÜP¢ÚÚ÷W6Çw27GV¬&W7V«FñÊrw&˜W&˜B∂VW2óB6ˆÁ6ó7FVÁB6¢ÚÚ7WG66VÊU&˜FFñˆÂFñ6≤w2˜7B÷'&óf¬f∆∆&6≤ávÜV‚÷˜fRÜ0¢ÚÚÊÚWFÜ˜&VB'&óf¬f6ñÊríñ6∑2Wg&ˆ“FÜRG'VR7W'&VÁ@¢ÚÚf6ñÊrñÁ7FVBˆb&˜FFñˆ‚FÜR7&VGW&RÊWfW"7GV∆«íÜB‡¢7BÁ&˜FFñˆ‚“ÇÖDÖ$TR‰÷FÖWFñ«2Á&EFÙFVrÜ2Êw&˜W&˜BíR3cí≤3cíR3c∞¢&WGW&‚Fó7B¬DîƒR¢„#∞¢–¢6ˆÁ7B&Wfñ˜W2“≤3¢7BÊ2¬#¢7BÁ"”∞¢6ˆÁ7BGÇ“GÇ“„R“7BÊ2¬G¢“G¢“„R“7BÁ#∞¢6ˆÁ7BB“÷FÇÊáó˜BÜGÇ¬G¢ì∞¢6ˆÁ7B7FW“÷FÇÊ÷ÇÉ„¬„b¢7VVD◊V¬¢GBì∞¢ñbÜB√“7FWí≤7BÊ2“GÇ“„S≤7BÁ"“G¢“„S≤“V«6R≤7BÊ2≥“GÇÚB¢7FW≤7BÁ"≥“G¢ÚB¢7FW≤–¢ñbÜB‚„í7BÁ&˜FFñˆ‚“Êv∆UF˜v&E7FFRá&Wfñ˜W2¬7Bì∞¢«ï7FFRÜ7F˜$ñBì∞¢&WGW&‚B√“7FW∞¢”∞†¢6ˆÁ7BfñÊó6Ç“÷W76vR”‚∞¢'VÊÊñÊr“f«6S∞¢7WG66VÊU&WfñWt7FófR“f«6S∞¢7WG66VÊU&WfñWu¶ˆˆ’W&6VÁB“≤ÚÚÊWfW"∆V≤‚WFÜ˜&VB¶ˆˆ“ñÁFÚÊ˜&÷¬v÷W∆ígFW'v&@¢7WG66VÊU&WfñWtFñ∆ˆwVU7V∂W"“ÁV∆√∞¢7FófT6÷W&÷ˆFR“6÷W&6ˆÊfñrÇíÊFVfV«D÷ˆFR«¬vFVfV«Bs∞¢7FófT6÷W&F&vWB“ÁV∆√∞¢7WG66VÊU&WfñWt&ÊÊW"Ü÷W76vR«¬	¯Í¬G∑ñ∆ˆBÁFóF∆R«¬t7WG66VÊRw“(	BfñÊó6ÜVBÊ¬f«6Rì∞¢”∞†¢7ñÊ2gVÊ7Fñˆ‚˜V‰∆ñÊRÜVÁFóGí¬7V∂W$Ê÷R¬FWáBí∞¢Fñ∆ˆwVT˜V‚“G'VS∞¢ˆFñ∆ˆwVUv∆∂W"“VÁFóGìÚÊ∂ñÊB””“vÁ2rÚ≤&ˆ˜C¢VÁFóGíÁ&ˆ˜B¬&V3¢VÁFóGíÁ&V2¬&ˆfñ∆S¢VÁFóGíÁ&ˆfñ∆R¬fF$g&ˆÁD6Áf3¢VÁFóGíÊfF$g&ˆÁD6Áf2“¢ÁV∆√∞¢7WG66VÊU&WfñWtFñ∆ˆwVU7V∂W"“VÁFóGí«¬ÁV∆√∞¢7FófT6÷W&÷ˆFR“VÁFóGìÚÊ∂ñÊB””“v7&VGW&RrÚF∆t÷ˆFT∂Wî7&VGW&R¢F∆t÷ˆFT∂Wì∞¢7FófT6÷W&F&vWB“≤˜6óFñˆ„¢ÜVÁFóGí«¬VÁFóFñW2Áf«VW2ÇíÊÊWáBÇíÁf«VRìÚÁ&ˆ˜BÁ˜6óFñˆ‚«¬ÊWrDÖ$TRÂfV7F˜#2Çí”∞¢ˆÁ4Fñ∆ˆwVTÊ÷TV¬ÁFWáD6ˆÁFVÁB“7V∂W$Ê÷S∞¢ñbÖˆÁ4Fñ∆ˆwVTÜV'G4V¬íˆÁ4Fñ∆ˆwVTÜV'G4V¬ÁFWáD6ˆÁFVÁB“rs∞¢ˆ&46ˆÁFñÊW$V√ÚÊ6∆74∆ó7BÊFBÇv&2÷ÜñFFV‚rì∞¢6ˆÁ7B7GÇ“ˆÁ5˜'G&óD6Áf2ÊvWD6ˆÁFWáBÇs&Brì∞¢ñbÖˆFñ∆ˆwVUv∆∂W#ÚÁ&ˆfñ∆RbbvñÊF˜r‰Á4fF%&WfñWrí∞¢7GÇÊfñ∆≈7Gñ∆R“r3#3S#ís≤7GÇÊfñ∆≈&V7BÉ¬¬ˆÁ5˜'G&óD6Áf2ÁvñGFÇ¬ˆÁ5˜'G&óD6Áf2ÊÜVñváBì∞¢vóBvñÊF˜r‰Fñ∆ˆwVT6ˆÁFVÁCÚÁ&VÊFW$Á4Fñ∆ˆwVU˜'G&óBÇì∞¢“V«6R∞¢7GÇÊ6∆V%&V7BÉ¬¬ˆÁ5˜'G&óD6Áf2ÁvñGFÇ¬ˆÁ5˜'G&óD6Áf2ÊÜVñváBì∞¢–¢ˆÁ4Fñ∆ˆwVTV¬Ê6∆74∆ó7BÊFBÇv˜V‚rì∞¢ˆÁ4Fñ∆ˆwVTV¬Á6WDGG&ñ'WFRÇv&ñ÷ÜñFFV‚r¬vf«6Rrì∞¢vñÊF˜r‰Fñ∆ˆwVT6ˆÁFVÁCÚÊÜñFT6Üˆñ6T'WGFˆÁ2Çì∞¢vñÊF˜r‰Fñ∆ˆwVT6ˆÁFVÁCÚÁ6WDÁ4Fñ∆ˆwVUFWáBáFWáBì∞¢–†¢gVÊ7Fñˆ‚6∆˜6T∆ñÊRÇí∞¢Fñ∆ˆwVT˜V‚“f«6S∞¢7WG66VÊU&WfñWtGfÊ6R“ÁV∆√∞¢vñÊF˜r‰Fñ∆ˆwVT6ˆÁFVÁCÚÊÜñFT6Üˆñ6T'WGFˆÁ2Çì∞¢vñÊF˜rÁ˜'G&óD'&VFÜñÊt6ˆ◊˜6W#ÚÊ6∆V$Wá&W76ñˆ‚ávñÊF˜r‰Fñ∆ˆwVT6ˆÁFVÁCÚÊFñ∆ˆwVU6VDñBÇíì∞¢vñÊF˜rÁ˜'G&óD'&VFÜñÊt6ˆ◊˜6W#ÚÁ6WDFVfV«DWá&W76ñˆ‚ávñÊF˜r‰Fñ∆ˆwVT6ˆÁFVÁCÚÊFñ∆ˆwVU6VDñBÇí¬ÁV∆¬ì∞¢ˆFñ∆ˆwVUv∆∂W"“ÁV∆√∞¢7WG66VÊU&WfñWtFñ∆ˆwVU7V∂W"“ÁV∆√∞¢ˆÁ4Fñ∆ˆwVTV¬Ê6∆74∆ó7BÁ&V÷˜fRÇv˜V‚rì∞¢ˆÁ4Fñ∆ˆwVTV¬Á6WDGG&ñ'WFRÇv&ñ÷ÜñFFV‚r¬wG'VRrì∞¢ˆ&46ˆÁFñÊW$V√ÚÊ6∆74∆ó7BÁ&V÷˜fRÇv&2÷ÜñFFV‚rì∞¢7FófT6÷W&÷ˆFR“ñF∆T6÷W&÷ˆFS∞¢7FófT6÷W&F&vWB“ñF∆T6÷W&F&vWC∞¢–†¢gVÊ7Fñˆ‚6Ü˜t6Üˆñ6T˜FñˆÁ2Ü˜FñˆÁ2í∞¢6ˆÁ7B˜DV«2“≥¬"¬2¬B¬R¬e“Ê÷Üí”‚Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÜF∆t˜BG∂ó÷íì∞¢˜DV«2Êf˜$V6ÇÜV¬”‚≤ñbÇV¬í&WGW&„≤6ˆÁ7B∆&V¬“V¬ÁVW'ï6V∆V7F˜"ÇrÊF∆r÷˜B÷∆&V¬rì≤ñbÜ∆&V¬í≤∆&V¬ÁFWáD6ˆÁFVÁB“rs≤∆&V¬Á7Gñ∆RÊfˆÁE6ó¶R“rs≤“V¬Ê6∆74∆ó7BÁ&V÷˜fRÇvF∆r÷˜B◊fó6ñ&∆Rrì≤V¬ÊˆÊ6∆ñ6≤“ÁV∆√≤“ì∞¢˜FñˆÁ2Á6∆ñ6RÉ¬bíÊf˜$V6ÇÇÜ˜B¬íí”‚∞¢6ˆÁ7BV¬“˜DV«5∂ï”≤ñbÇV¬í&WGW&„∞¢6ˆÁ7B∆&V¬“V¬ÁVW'ï6V∆V7F˜"ÇrÊF∆r÷˜B÷∆&V¬rì≤ñbÜ∆&V¬í∆&V¬ÁFWáD6ˆÁFVÁB“˜BÁFWáB«¬t6Üˆñ6Rs∞¢V¬Ê6∆74∆ó7BÊFBÇvF∆r÷˜B◊fó6ñ&∆Rrì∞¢V¬ÊˆÊ6∆ñ6≤“Çí”‚≤ñbÇFñ∆ˆwVT˜V‚í&WGW&„≤˜BÊˆ‰6∆ñ6≤Çì≤”∞¢“ì∞¢˜DV«2Êf˜$V6ÇÜV¬”‚≤ñbÜV¬bbV¬Ê6∆74∆ó7BÊ6ˆÁFñÁ2ÇvF∆r÷˜B◊fó6ñ&∆RríívñÊF˜r‰Fñ∆ˆwVT6ˆÁFVÁCÚÊfóDF∆t˜Fñˆ‰∆&V¬ÜV¬ì≤“ì∞¢6ˆÁ7B6ˆÁFñÁVT'F‚“Fˆ7V÷VÁBÊvWDV∆V÷VÁD'îñBÇvÁ4Fñ∆ˆwVT6ˆÁFñÁVRrì∞¢ñbÜ6ˆÁFñÁVT'F‚í6ˆÁFñÁVT'F‚Á7Gñ∆RÊFó7∆í“˜FñˆÁ2Ê∆VÊwFÇÚvÊˆÊRr¢rs∞¢–†¢gVÊ7Fñˆ‚6ˆÁFñÁVUFÚÜÊWáDñBí∞¢ñbÇ'VÊÊñÊrí&WGW&„∞¢ñbÜFñ∆ˆwVT˜V‚í6∆˜6T∆ñÊRÇì∞¢ñbÇÊWáDñBí≤fñÊó6ÇÇì≤&WGW&„≤–¢'VÂ7FvRÜÊWáDñBì∞¢–†¢gVÊ7Fñˆ‚'VÂ7FvRá7FvTñBí∞¢ñbÇ'VÊÊñÊrí&WGW&„∞¢6ˆÁ7B7FvR“7FvW4'îñBÊvWBá7FvTñBì∞¢ñbÇ7FvRí≤fñÊó6ÇÇu&WfñWr7F˜VB(	BFÜRÊWáB6&B6˜V∆BÊ˜B&Rf˜VÊB‚rì≤&WGW&„≤–¢7WG66VÊU&WfñWt&ÊÊW"Ü	¯Í¬G∑ñ∆ˆBÁFóF∆R«¬t7WG66VÊRw“(	BG∑7FvRÁGóW÷¬f«6Rì∞†¢ñbá7FvRÁGóR””“v÷˜fRrí&WGW&‚'V‰÷˜fRá7FvRì∞¢ñbá7FvRÁGóR””“vÊñ÷Fñˆ‚rí&WGW&‚'V‰Êñ÷Fñˆ‚á7FvRì∞¢ñbá7FvRÁGóR””“wGW&‚rí&WGW&‚'VÂGW&‚á7FvRì∞¢ñbá7FvRÁGóR””“v6ˆ÷&Brí&WGW&‚'V‰6ˆ÷&Bá7FvRì∞¢ñbá7FvRÁGóR””“vfFRrí&WGW&‚'V‰fFRá7FvRì∞¢ñbá7FvRÁGóR””“w¶ˆˆ“rí&WGW&‚'VÂ¶ˆˆ“á7FvRì∞†¢6ˆÁ7B7V∂W$7F˜"“7F˜'4'îñBÊvWBá7FvRÁ7V∂W$ñBì∞¢6ˆÁ7B7V∂W$VÁFóGí“VÁFóFñW2ÊvWBá7FvRÁ7V∂W$ñBì∞¢6ˆÁ7B7V∂W$Ê÷R“7V∂W$7F˜#ÚÊÊ÷R«¬u6ˆ÷VˆÊRs∞¢ñbÇ7V∂W$VÁFóGíí≤6ˆÁFñÁVUFÚÜvWE&W6ˆ«fVDÊWáBá7FvRÊñB¬7FvRÊÊWáBíì≤&WGW&„≤–¢ñbá7FvRÁGóR””“v6Üˆñ6Rrí∞¢˜V‰∆ñÊRá7V∂W$VÁFóGí¬7V∂W$Ê÷R¬7FvRÁFWáBíÁFÜV‚ÇÇí”‚∞¢6Ü˜t6Üˆñ6T˜FñˆÁ2Çá7FvRÊ˜FñˆÁ2«¬µ“íÊ÷ÜÚ”‚á≤FWáC¢ÚÁFWáB¬ˆ‰6∆ñ6≥¢Çí”‚6ˆÁFñÁVUFÚÜvWE&W6ˆ«fVDÊWáBá7FvRÊñB¬ÚÊÊWáBíí“ííì∞¢“ì∞¢7WG66VÊU&WfñWtGfÊ6R“Çí”‚∑”≤ÚÚ6Üˆñ6W2ˆÊ«íWfW"GfÊ6RfñFÜVó"˜v‚'WGFˆ‡¢&WGW&„∞¢–¢˜V‰∆ñÊRá7V∂W$VÁFóGí¬7V∂W$Ê÷R¬7FvRÁFWáBì∞¢7WG66VÊU&WfñWtGfÊ6R“Çí”‚6ˆÁFñÁVUFÚÜvWE&W6ˆ«fVDÊWáBá7FvRÊñB¬7FvRÊÊWáBíì∞¢–†¢gVÊ7Fñˆ‚'V‰÷˜fRá7FvRí∞¢6ˆÁ7B7B“7F˜%7FFW2ÊvWBá7FvRÊ7F˜$ñBì∞¢6ˆÁ7Bvˆ¬“7FvRÁF&vWEv˜&∆C∞¢ñbÇ7B«¬vˆ¬í≤6ˆÁFñÁVUFÚÜvWE&W6ˆ«fVDÊWáBá7FvRÊñB¬7FvRÊÊWáBíì≤&WGW&„≤–¢6ˆÁ7B7VVD◊V¬“7FvRÁ7VVB””“w6∆˜rrÚ„b¢7FvRÁ7VVB””“vf7BrÚ„ÉR¢∞¢6ˆÁ7BvóDf˜$'&óf¬“7FvRÁvóDf˜$'&óf¬”“f«6S∞¢6ˆÁ7BGÇ“vˆ¬Ê2≤„R¬G¢“vˆ¬Á"≤„S∞¢∆WB∆7EB“W&f˜&÷Ê6RÊÊ˜rÇì∞¢∆WB'&ófVD«&VGí“f«6S∞¢WáFW&Ê∆«îG&ófV‰7F˜$ñG2ÊFBá7FvRÊ7F˜$ñBì≤ÚÚGfÊ6T7F˜%F˜v&B&V∆˜r˜vÁ2&˜FFñˆ‚VÁFñ¬'&óf¿¢6ˆÁ7Bˆ‰'&ófR“Çí”‚∞¢ñbÜ'&ófVD«&VGíí&WGW&„∞¢'&ófVD«&VGí“G'VS∞¢WáFW&Ê∆«îG&ófV‰7F˜$ñG2ÊFV∆WFRá7FvRÊ7F˜$ñBì∞¢ÚÚGfÊ6T7F˜%F˜v&Bw2˜v‚&'&ófVB"vFRÖDîƒR£„"íó2∆ˆ˜6W ¢ÚÚFÜ‚÷˜fT7&VGW&UF˜v&Bw2ñÁFW&Ê¬ˆÊRÜf∆BÇí¬6ÚFÜP¢ÚÚ∆ˆ˜&˜fR6‚WÜóBÜW&RvÜñ∆RFÜR7&VGW&Rv27Fñ∆¬ßW7@¢ÚÚñÁ6ñFRFÜBñÊÊW"Fá&W6Üˆ∆Bˆ‚óG2fW'í∆7B7FW(	BíÊR‡¢ÚÚ7Fñ∆¬÷ñB◊'V‚÷7ñ6∆R7&óFRáWFFT7&VGW&TÊñ‘g&÷Rw0¢ÚÚ÷˜fñÊvv27Fñ∆¬G'VRFÜBg&÷Rí‚7WG66VÊU&˜FFñˆÂFñ6∞¢ÚÚÜ&V∆˜ríñ6∑2WñF∆Rg&÷ñÊrˆ‚óG2fW'íÊWáBFñ6≤ˆÊ6RFÜó0¢ÚÚ7F˜"ó2˜WBˆbWáFW&Ê∆«îG&ófV‰7F˜$ñG2¬6ÚÊÚWá∆ñ6ó@¢ÚÚ6∆VÁW6∆¬ó2ÊVVFVBÜW&Rf˜"FÜB‡¢Ú¢ÚÚFÜRF&vWBˆñÁBw2˜v‚WFÜ˜&VB'&óf¬f6ñÊrÜñbÁíívñÁ0¢ÚÚ˜fW"vÜFWfW"Fó&V7Fñˆ‚FÜRv∆≤óG6V∆b∆VgBFÜR7F˜"f6ñÊp¢ÚÚ(	B6÷R2%GW&‚ñ‚∆6R"6&B¬ßW7BG&ñvvW&VB'í∆ÊFñÊrˆ‡¢ÚÚFÜó2ˆñÁB‚ÜÊFVBFÚ7WG66VÊU&˜FFñˆÂFñ6≤2FÜó27F˜"w2ÊWp¢ÚÚFW6ó&VBf6ñÊrÜÊÚ'&óf¬f6ñÊrB∆¬ßW7B∂VW2vÜFWfW ¢ÚÚFó&V7Fñˆ‚FÜRv∆≤∆VgBóBf6ñÊr¬WÜ7F«í∆ñ∂R&V¬Â2¢ÚÚ7&VGW&R÷˜fV÷VÁBFˆW2í(	BÊWfW"&∆ˆ6∑2FÜR66VÊRˆ‚óB¬FÜP¢ÚÚ7F˜"∂VW2GW&ÊñÊrñ‚FÜR&6∂w&˜VÊBvÜñ∆RFÜRÊWáB6&@¢ÚÚ7F'G2‡¢FW6ó&VDf6ñÊtFVrÁ6WBá7FvRÊ7F˜$ñB¬vˆ¬Êf6ñÊr“ÁV∆¬Úvˆ¬Êf6ñÊr¢7BÁ&˜FFñˆ‚ì∞¢ñbávóDf˜$'&óf¬í6ˆÁFñÁVUFÚÜvWE&W6ˆ«fVDÊWáBá7FvRÊñB¬7FvRÊÊWáBíì∞¢”∞¢6ˆÁ7B7FW“Çí”‚∞¢ñbÇ'VÊÊñÊrí&WGW&„∞¢6ˆÁ7BÊ˜r“W&f˜&÷Ê6RÊÊ˜rÇì∞¢6ˆÁ7BGB“÷FÇÊ÷ñ‚É„R¬ÜÊ˜r“∆7EBíÚì∞¢∆7EB“Ê˜s∞¢6ˆÁ7B'&ófVB“GfÊ6T7F˜%F˜v&Bá7FvRÊ7F˜$ñB¬GÇ¬G¢¬GB¬7VVD◊V¬ì∞¢ñbÜ'&ófVBí≤ˆ‰'&ófRÇì≤&WGW&„≤–¢&WVW7DÊñ÷Fñˆ‰g&÷Rá7FWì∞¢”∞¢&WVW7DÊñ÷Fñˆ‰g&÷Rá7FWì∞¢ÚÚVÊ6ÜV6∂VBñ‚FÜRFó&V7F˜"Ç%vóBf˜"'&óf¬&Vf˜&R6ˆÁFñÁVñÊr"ê¢ÚÚ(	B7F'BFÜRÊWáB6&Bñ÷÷VFñFV«ívÜñ∆RFÜó27F˜"∂VW0¢ÚÚv∆∂ñÊrF˜v&BóG2F&vWBñ‚FÜR&6∂w&˜VÊBáFÜR∆ˆ˜&˜fP¢ÚÚ7Fñ∆¬'VÁ2¬vFVBˆ‚FÜR6÷R'VÊÊñÊvf∆r&∆ˆ6∂ñÊr÷˜fP¢ÚÚW6W2¬6Ú7F˜ñÊrFÜR&WfñWr6Ê6V«2óBñFVÁFñ6∆«íí¬6¢ÚÚ6WfW&¬7F˜'26‚&R6VÁBˆfbBˆÊ6RñÁ7FVBˆbˆÊRBFñ÷R‡¢ñbÇvóDf˜$'&óf¬í6ˆÁFñÁVUFÚÜvWE&W6ˆ«fVDÊWáBá7FvRÊñB¬7FvRÊÊWáBíì∞¢–†¢gVÊ7Fñˆ‚'V‰Êñ÷Fñˆ‚á7FvRí∞¢6ˆÁ7B7B“7F˜%7FFW2ÊvWBá7FvRÊ7F˜$ñBì∞¢6ˆÁ7BVÁFóGí“VÁFóFñW2ÊvWBá7FvRÊ7F˜$ñBì∞¢ñbÇ7B«¬VÁFóGíí≤6ˆÁFñÁVUFÚÜvWE&W6ˆ«fVDÊWáBá7FvRÊñB¬7FvRÊÊWáBíì≤&WGW&„≤–¢6ˆÁ7B6ˆ◊˜6W"“vñÊF˜rÁ˜'G&óD'&VFÜñÊt6ˆ◊˜6W#∞¢∆WB'&VFÖFñ÷W"“ÁV∆√∞¢ñbá7FvRÊÊñ‘∂ñÊB””“vV÷˜FRrbbVÁFóGíÊ∂ñÊB””“vÁ2rbbVÁFóGíÁ&ˆfñ∆Rbb6ˆ◊˜6W"í6ˆ◊˜6W"ÁG&ñvvW$V÷˜FRá7FvRÊV÷˜FTÊ÷Rì∞¢ñbÇá7FvRÊÊñ‘∂ñÊB””“v'&VFÜñÊrr«¬7FvRÊÊñ‘∂ñÊB””“vV÷˜FRríbbVÁFóGíÊ∂ñÊB””“vÁ2rbbVÁFóGíÁ&ˆfñ∆Rbb6ˆ◊˜6W"bbvñÊF˜r‰Á4fF%&WfñWrbbvñÊF˜rÂ‰u∆ÊTfF"í∞¢'&VFÖFñ÷W"“6WDñÁFW'f¬Ü7ñÊ2Çí”‚∞¢ñbÇ'VÊÊñÊrí≤6∆V$ñÁFW'f¬Ü'&VFÖFñ÷W"ì≤&WGW&„≤–¢G'í∞¢vóBvñÊF˜r‰Á4fF%&WfñWrÁ&VÊFW%&ˆfñ∆UFÙ6Áf2ÜVÁFóGíÊfF$g&ˆÁD6Áf2¬VÁFóGíÁ&ˆfñ∆R¬≤'&VFÜñÊt6ˆ◊˜6W#¢6ˆ◊˜6W"“ì∞¢vñÊF˜rÂ‰u∆ÊTfF"Á&Vg&W6Ö6ñÊv∆U∆ÊTfF$÷ˆFV¬ÜVÁFóGíÁv∆∂W"ÊfF$w&˜W¬VÁFóGíÊfF$g&ˆÁD6Áf2ì∞¢“6F6ÇÜRí∑–¢“¬#ì∞¢–¢6WEFñ÷V˜WBÇÇí”‚∞¢ñbÇ'VÊÊñÊrí&WGW&„∞¢ñbÜ'&VFÖFñ÷W"í6∆V$ñÁFW'f¬Ü'&VFÖFñ÷W"ì∞¢ñbá7FvRÁ&W7V«E˜6R”“wVÊ6ÜÊvVBrí7BÁ˜6R“7FvRÁ&W7V«E˜6S∞¢«ï7FFRá7FvRÊ7F˜$ñBì∞¢6ˆÁFñÁVUFÚÜvWE&W6ˆ«fVDÊWáBá7FvRÊñB¬7FvRÊÊWáBíì∞¢“¬á7FvRÊGW&Fñˆ‚«¬í¢ì∞¢–†¢ÚÚGW&‚6&BßW7BÜÊG27WG66VÊU&˜FFñˆÂFñ6≤Ü&V∆˜ríÊWrFW6ó&V@¢ÚÚf6ñÊr(	BFÜR6ˆÁFñÁV˜W2W"÷g&÷RFñ6∂W"ó2vÜB7GV∆«íV6W0¢ÚÚFÜR7F˜"w2&˜FFñˆ‚F˜v&BóB¬WÜ7F«í∆ñ∂R7FFñˆÊ'í&V¿¢ÚÚÂ2ˆ7&VGW&RGW&ÊñÊrFÚf6R6ˆ÷WFÜñÊrÜÊÚñÁ7FÁB6Êí‚FÜP¢ÚÚ6&Bw2˜v‚GW&Fñˆ‚ó26ñÊr&VBf˜"FÜR66VÊRávÜV‚FÜRÊWá@¢ÚÚ6&B7F'G2í¬Ê˜B∆óFW&¬'vóBVÁFñ¬FÜRGW&‚fñÊó6ÜW2"vFR(	@¢ÚÚ6÷R2óBv2&Vf˜&R‡¢gVÊ7Fñˆ‚'VÂGW&‚á7FvRí∞¢6ˆÁ7B7B“7F˜%7FFW2ÊvWBá7FvRÊ7F˜$ñBì∞¢ñbÇ7Bí≤6ˆÁFñÁVUFÚÜvWE&W6ˆ«fVDÊWáBá7FvRÊñB¬7FvRÊÊWáBíì≤&WGW&„≤–¢∆WBF&vWDFVr“7BÁ&˜FFñˆ„∞¢ñbá7FvRÊ÷ˆFR””“v7F˜"rí∞¢6ˆÁ7BF&vWE7B“7F˜%7FFW2ÊvWBá7FvRÁF&vWD7F˜$ñBì∞¢ñbáF&vWE7BíF&vWDFVr“Êv∆UF˜v&E7FFRá7B¬F&vWE7Bì∞¢“V«6R∞¢F&vWDFVr“ÇÑ÷FÇÁ&˜VÊBá7FvRÊÊv∆RíR3cí≤3cíR3c∞¢–¢FW6ó&VDf6ñÊtFVrÁ6WBá7FvRÊ7F˜$ñB¬F&vWDFVrì∞¢6WEFñ÷V˜WBÇÇí”‚6ˆÁFñÁVUFÚÜvWE&W6ˆ«fVDÊWáBá7FvRÊñB¬7FvRÊÊWáBíí¬á7FvRÊGW&Fñˆ‚«¬í¢ì∞¢–†¢ÚÚ∆ófR7&VGW&R◊g2÷7&VGW&Rí¬ñFVÁFñ6¬ñ‚7ó&óBFÚFÜR7WG66VÊP¢ÚÚFó&V7F˜"Fˆˆ¬w2˜v‚6ˆ÷&B÷6&B6ñ◊V∆Fñˆ„¢7&VGW&R÷∆ñÊ∂VB¿¢ÚÚFV÷VB'Fñ6óÁB6Ü6W2FÜRÊV&W7B6ˆ÷&Bˆ‚'Fñ6óÁBˆ‚¢ÚÚFñffW&VÁBFV“vóFÜñ‚FÜR&V¬5$TEU$UÙD"vw&Ú&ÊvR¬Ê@¢ÚÚGF6∑2Ü6ˆˆ∆F˜v‚÷vFVBV«6RíˆÊ6RvóFÜñ‚GF6≤&ÊvR‚6÷P¢ÚÚFV“˜"ÊÚFV““ÊWfW"Fá&VB‚Êˆ‚÷7&VGW&R'Fñ6óÁG2Ü¢ÚÚW'6ˆ‚Â2WfW"÷&∂VB6ˆ÷&Bˆ‚í&R∆VgB7FFñˆÊ'í‡¢gVÊ7Fñˆ‚'V‰6ˆ÷&Bá7FvRí∞¢7FvRÁ'Fñ6óÁG2Êf˜$V6Çá”‚≤6ˆÁ7B7B“7F˜%7FFW2ÊvWBáÊ7F˜$ñBì≤ñbá7Bí≤7BÊ6ˆ÷&Dˆ‚“Ê6ˆ÷&Dˆ„≤7BÊ6‰∆˜6R“Ê6‰∆˜6S≤““ì∞†¢ÚÚ&V¬Ü˜7Fñ∆Rˆ6ˆ◊Êñˆ‚í¬Ê˜B&W7ˆ∂R6ñ◊V∆Fñˆ„¢Ü˜7Fñ∆P¢ÚÚ7V6ñW2Ñ5$TEU$UÙD%≤‚‚Â“ÊÜ˜7Fñ∆R””“G'VR¬RÊr‚v"◊vˆ∆bíó0¢ÚÚFFVBFÚFÜR&V¬Ü˜7Fñ∆Tˆ&¶V7G26WBÊBG&ófV‚'íFÜRWÜ7@¢ÚÚ6÷RWFFTÜ˜7Fñ∆W2Çívñ∆B7&VGW&W26Ü6RˆGF6≤FÜR∆ñW ¢ÚÚvóFÇ‚Êˆ‚÷Ü˜7Fñ∆R7V6ñW2ÜRÊr‚F&ñÊvví÷Ü˜VÊBíó2FFVBF¢ÚÚFÜR&V¬6ˆ◊Êñˆ‰ˆ&¶V7G26WBÊBG&ófV‚'íWFFT6ˆ◊ÊñˆÁ2Çê¢ÚÚ(	BFÜR6÷R&FVfVÊBvÜˆWfW"w2ÊV&W7BÜ˜7Fñ∆Tˆ&¶V7G2FÚóG0¢ÚÚ÷7FW""ívÜó7F∆R◊7V÷÷ˆÊVB6ˆ◊Êñˆ‚W6W2¬Wá∆ñ6óF«íˆñÁFV@¢ÚÚBFÜR&V¬∆ñW"fñ2Ê÷7FW"á6VRFÜR÷7FW&fñV∆Bˆ‡¢ÚÚ÷∂T7&VGW&TVÁFóGí(	BgWGW&RWFÜ˜&VB÷7FW"&W6ñFW2FÜP¢ÚÚ∆ñW"v˜V∆BßW7BÊVVBFÜó2∆ñÊRFÚñ6≤FñffW&VÁBVÁFóGíí‡¢ÚÚ&˜FÇ&R«&VGíFñ6∂VBWfW'íg&÷R'íFÜR÷ñ‚v÷R∆ˆ˜¬6¢ÚÚÊ˜FÜñÊrÜW&RG&ófW2FÜV“'íÜÊC≤FÜó2ˆÊ«í&Vvó7FW'2¢ÚÚVÁ&Vvó7FW'2FÜV“ÊB&∑2FÜR&V¬∆ñW"ÁÇ˜íBFÜR66VÊRw0¢ÚÚ∆ñW"7F˜"6ÚFÜBF&vWFñÊr&W6ˆ«fW2vñÁ7BFÜR&ñváB7˜@¢ÚÚñÁ7FVBˆbvÜW&WfW"FÜR&V¬∆ñW"∆7B7FˆˆB‡¢6ˆÁ7B6ˆ÷&Dˆ‰ñG2“7FvRÁ'Fñ6óÁG2Êfñ«FW"á”‚Ê6ˆ÷&Dˆ‚íÊ÷á”‚Ê7F˜$ñBê¢Êfñ«FW"ÜñB”‚≤6ˆÁ7B“7F˜'4'îñBÊvWBÜñBì≤&WGW&‚bbÊ7&VGW&UGóTñBbb5$TEU$UÙD%∂Ê7&VGW&UGóTñE”≤“ì∞†¢6ˆÁ7B∆ñW$7F˜"“áñ∆ˆBÊ7F˜'2«¬µ“íÊfñÊBÜ”‚Êó5∆ñW"ì∞¢6ˆÁ7B∆ñW%7B“∆ñW$7F˜"Ú7F˜%7FFW2ÊvWBá∆ñW$7F˜"ÊñBí¢ÁV∆√∞¢6ˆÁ7B6fVE∆ñW%Ç“∆ñW"ÁÇ¬6fVE∆ñW%í“∆ñW"Áì∞¢ñbá∆ñW%7Bí≤∆ñW"ÁÇ“á∆ñW%7BÊ2≤„Rí¢DîƒS≤∆ñW"Áí“á∆ñW%7BÁ"≤„Rí¢DîƒS≤–†¢6ˆÁ7B&Vvó7FW&VB“µ”∞¢f˜"Ü6ˆÁ7B7F˜$ñBˆb6ˆ÷&Dˆ‰ñG2í∞¢6ˆÁ7BVÁFóGí“VÁFóFñW2ÊvWBÜ7F˜$ñBì∞¢ñbÇVÁFóGí«¬VÁFóGíÊ∂ñÊB”“v7&VGW&Rrí6ˆÁFñÁVS∞¢6ˆÁ7B2“VÁFóGíÊ7&VGW&S∞¢2Á7FFR“vñF∆Rs∞¢WáFW&Ê∆«îG&ófV‰7F˜$ñG2ÊFBÜ7F˜$ñBì≤ÚÚWFFTÜ˜7Fñ∆W2˜WFFT6ˆ◊ÊñˆÁ2˜v‚FÜó27&VGW&Rw2&˜FFñˆ‚Ê˜p¢ñbÜ2ÊFVbÊÜ˜7Fñ∆Rí∞¢2ÊÜˆ÷UÇ“2ÁÉ≤2ÊÜˆ÷Uí“2Áì∞¢Ü˜7Fñ∆Tˆ&¶V7G2ÊFBÜ2ì∞¢&Vvó7FW&VBÁW6Çá≤2¬6WC¢Ü˜7Fñ∆Tˆ&¶V7G2“ì∞¢“V«6R∞¢2Êó46ˆ◊Êñˆ‚“G'VS∞¢2Ê÷7FW"“∆ñW#∞¢6ˆ◊Êñˆ‰ˆ&¶V7G2ÊFBÜ2ì∞¢&Vvó7FW&VBÁW6Çá≤2¬6WC¢6ˆ◊Êñˆ‰ˆ&¶V7G2“ì∞¢–¢–†¢6WEFñ÷V˜WBÇÇí”‚∞¢f˜"Ü6ˆÁ7B≤2¬6WB“ˆb&Vvó7FW&VBí≤6WBÊFV∆WFRÜ2ì≤ñbá6WB””“6ˆ◊Êñˆ‰ˆ&¶V7G2í2Ê÷7FW"“ÁV∆√≤–¢∆ñW"ÁÇ“6fVE∆ñW%É≤∆ñW"Áí“6fVE∆ñW%ì∞¢ñbÇ'VÊÊñÊrí&WGW&„∞¢ÚÚ7ñÊ2V6Ç6ˆ÷&FÁBw2WFÜ˜&VB÷6ˆ˜&FñÊFR7FFRg&ˆ“vÜW&WfW ¢ÚÚFÜR&V¬í7GV∆«í∆VgBóB¬6ÚFÜRÊWáB7FvRÜ6WGF∆RÙf∆VP¢ÚÚ÷˜fRí7F'G2g&ˆ“óG2G'VR˜6óFñˆ‚ñÁ7FVBˆb6ÊñÊr&6∞¢ÚÚFÚóG2&R÷6ˆ÷&B7v‚ˆñÁB‚6÷Rf˜"&˜FFñˆ‚ˆFW6ó&V@¢ÚÚf6ñÊr(	BÜÊFñÊr7WG66VÊU&˜FFñˆÂFñ6≤&6≤6ˆÁG&ˆ¬ÜóB&W7V÷W0¢ÚÚÊWáBg&÷R¬Ê˜rFÜBFÜó27F˜$ñBó2˜WBˆ`¢ÚÚWáFW&Ê∆«îG&ófV‰7F˜$ñG2ívóFÇFÜRw&ˆÊrFW6ó&VBf6ñÊrv˜V∆@¢ÚÚñÊ≤FÜR7&VGW&RF˜v&BóG2ˆ∆B&R÷6ˆ÷&BF&vWBFÜRñÁ7FÁ@¢ÚÚ6ˆ÷&BVÊG2‡¢f˜"Ü6ˆÁ7B7F˜$ñBˆb6ˆ÷&Dˆ‰ñG2í∞¢6ˆÁ7BVÁFóGí“VÁFóFñW2ÊvWBÜ7F˜$ñBí¬7B“7F˜%7FFW2ÊvWBÜ7F˜$ñBì∞¢WáFW&Ê∆«îG&ófV‰7F˜$ñG2ÊFV∆WFRÜ7F˜$ñBì∞¢ñbÜVÁFóGìÚÊ∂ñÊB””“v7&VGW&Rrbb7Bí∞¢7BÊ2“VÁFóGíÊ7&VGW&RÁÇÚDîƒR“„S≤7BÁ"“VÁFóGíÊ7&VGW&RÁíÚDîƒR“„S∞¢7BÁ&˜FFñˆ‚“DÖ$TR‰÷FÖWFñ«2Á&EFÙFVrÜVÁFóGíÊ7&VGW&RÊw&˜W&˜Bì∞¢FW6ó&VDf6ñÊtFVrÁ6WBÜ7F˜$ñB¬7BÁ&˜FFñˆ‚ì∞¢–¢–¢7FvRÁ'Fñ6óÁG2Êf˜$V6Çá”‚≤6ˆÁ7B7B“7F˜%7FFW2ÊvWBáÊ7F˜$ñBì≤ñbá7Bí7BÊ6ˆ÷&Dˆ‚“f«6S≤“ì∞¢6ˆÁ7B6‰∆˜6R“7FvRÁ'Fñ6óÁG2Á6ˆ÷Rá”‚Ê6ˆ÷&Dˆ‚bbÊ6‰∆˜6Rì∞¢ñbÇ6‰∆˜6Rí≤6ˆÁFñÁVUFÚÜvWE&W6ˆ«fVDÊWáBá7FvRÊñB¬7FvRÊÊWáBíì≤&WGW&„≤–¢6ˆÁ7BÁîVÁFóGí“VÁFóFñW2ÊvWBá7FvRÁ'Fñ6óÁG5≥”ÚÊ7F˜$ñBì∞¢˜V‰∆ñÊRÜÁîVÁFóGí¬t6ˆ÷&B&W7V«Br¬t6Ü&7FW"÷&∂VB6‚∆˜6R÷íW6RFÜR6W&FR∆˜72'&Ê6Ç‚ríÁFÜV‚ÇÇí”‚∞¢6Ü˜t6Üˆñ6T˜FñˆÁ2Ö∞¢≤FWáC¢tÊÚ∆˜72r¬ˆ‰6∆ñ6≥¢Çí”‚6ˆÁFñÁVUFÚÜvWE&W6ˆ«fVDÊWáBá7FvRÊñB¬7FvRÊÊWáBíí“¿¢≤FWáC¢t∆˜72ÜVÁ2r¬ˆ‰6∆ñ6≥¢Çí”‚6ˆÁFñÁVUFÚÜvWE&W6ˆ«fVDÊWáBá7FvRÊñB¬7FvRÊ∆˜74ÊWáBíí“¿¢“ì∞¢“ì∞¢7WG66VÊU&WfñWtGfÊ6R“Çí”‚∑”∞¢“¬á7FvRÊGW&Fñˆ‚«¬í¢ì∞¢–†¢gVÊ7Fñˆ‚'V‰fFRá7FvRí∞¢6ˆÁ7BfFTV¬“7WG66VÊU&WfñWtfFTV¬Çì∞¢6ˆÁ7BF&vWD˜6óGí“7FvRÊFó&V7Fñˆ‚””“v˜WBrÚ¢∞¢fFTV¬Á7Gñ∆RÁG&Á6óFñˆ‰GW&Fñˆ‚“G∑7FvRÊGW&Fñˆ‚«¬◊6∞¢&WVW7DÊñ÷Fñˆ‰g&÷RÇÇí”‚≤fFTV¬Á7Gñ∆RÊ˜6óGí“7G&ñÊráF&vWD˜6óGíì≤“ì∞¢6WEFñ÷V˜WBÇÇí”‚6ˆÁFñÁVUFÚÜvWE&W6ˆ«fVDÊWáBá7FvRÊñB¬7FvRÊÊWáBíí¬á7FvRÊGW&Fñˆ‚«¬í¢ì∞¢–†¢ÚÚ6÷ˆ˜FÜ«í∆W'27WG66VÊU&WfñWu¶ˆˆ’W&6VÁBÉ“FÜR6GW&V@¢ÚÚ6Ü˜Bw2˜v‚VÊ÷ˆFñfñVBg&÷ñÊr¬ÜñvÜW"“6∆˜6W"(	B6VP¢ÚÚWFFT6÷W&˜6óFñˆ‚w27WG66VÊU¶ˆˆ‘◊V¬íg&ˆ“vÜW&WfW"óB7W'&VÁF«ê¢ÚÚ6óG2FÚ7FvRÁW&6VÁB˜fW"7FvRÊGW&Fñˆ‚6V6ˆÊG2¬G&ófñÊrFÜP¢ÚÚ6÷W&WfW'íg&÷R∆ˆÊrFÜRví&FÜW"FÜ‚6ñÊv∆RñÁ7FÁB7WB‡¢gVÊ7Fñˆ‚'VÂ¶ˆˆ“á7FvRí∞¢6ˆÁ7Bg&ˆ’W&6VÁB“7WG66VÊU&WfñWu¶ˆˆ’W&6VÁC∞¢6ˆÁ7BFıW&6VÁB“÷FÇÊ÷ÇÉ¬ÁV÷&W"á7FvRÁW&6VÁBí«¬ì∞¢6ˆÁ7BGW&Fñˆ‰◊2“÷FÇÊ÷ÇÉ¬á7FvRÊGW&Fñˆ‚ÛÚ„bí¢ì∞¢6ˆÁ7B7F'B“W&f˜&÷Ê6RÊÊ˜rÇì∞¢6ˆÁ7B7FW“Çí”‚∞¢ñbÇ'VÊÊñÊrí&WGW&„∞¢6ˆÁ7BB“GW&Fñˆ‰◊2√“Ú¢÷FÇÊ÷ñ‚É¬áW&f˜&÷Ê6RÊÊ˜rÇí“7F'BíÚGW&Fñˆ‰◊2ì∞¢7WG66VÊU&WfñWu¶ˆˆ’W&6VÁB“g&ˆ’W&6VÁB≤áFıW&6VÁB“g&ˆ’W&6VÁBí¢C∞¢WFFT6÷W&˜6óFñˆ‚Çì∞¢ñbáB¬í&WVW7DÊñ÷Fñˆ‰g&÷Rá7FWì∞¢V«6R6ˆÁFñÁVUFÚÜvWE&W6ˆ«fVDÊWáBá7FvRÊñB¬7FvRÊÊWáBíì∞¢”∞¢7FWÇì∞¢–†¢ÚÚ7F˜'2˜FÜW'vó6RˆÊ«ívWBFÜVó"7FFRá˜6óFñˆ‚¬ÊBÁí7F'FñÊp¢ÚÚ˜6R∆ñ∂R&ˆÊRíW6ÜVBˆÁFÚFÜVó"÷W6ÇFÜRfó'7BFñ÷R6ˆ÷R7FvP¢ÚÚÜVÁ2FÚF˜V6ÇFÜV“(	B‚7F˜"66VÊRÊWfW"÷˜fW2˜"Êñ÷FW0¢ÚÚv˜V∆B6óBBóG2&r7v‚G&Á6f˜&“f˜&WfW"‚WfW'í7F˜"w0¢ÚÚñÊóFñ¬WFÜ˜&VB7FFRó2∆ñVBˆÊ6R¬Wg&ˆÁB¬6Ú&W7FñÊp¢ÚÚ&ˆÊR˜&˜FFñˆ‚&VG26˜'&V7F«íg&ˆ“g&÷RˆÊRÜÊB6Ú¢ÚÚ7&VGW&Rw2w&˜W&˜B˜Êu&˜B&R6VVFVBFÚ÷F6Ç&Vf˜&P¢ÚÚ7WG66VÊU&˜FFñˆÂFñ6≤w2fó'7B&V¬Fñ6≤&V∆˜rí‡¢f˜"Ü6ˆÁ7B7F˜$ñBˆb7F˜%7FFW2Ê∂Wó2Çíí«ï7FFRÜ7F˜$ñBì∞†¢ÚÚ6ˆÁFñÁV˜W6«íV6W2WfW'í7F˜"w2&˜FFñˆ‚F˜v&BFW6ó&VDf6ñÊtFVp¢ÚÚá6WBB7v‚g&ˆ“óG2&rWFÜ˜&VB&˜FFñˆ‚¬ÊBWFFVB'í¢ÚÚGW&‚6&B˜"÷˜fRw2'&óf¬f6ñÊrí¬WfW'íg&÷R¬f˜"FÜP¢ÚÚ7F˜"w2VÁFó&RFñ÷Rñ‚FÜR66VÊR(	BÊ˜BfóÜVB÷GW&Fñˆ‚ˆÊR◊6Ü˜@¢ÚÚÊñ÷Fñˆ‚FÜB7F˜2G&ófñÊrˆÊ6R6&Bw2˜v‚Fñ÷W"'VÁ2˜WB‡¢ÚÚ6∂ó2ÁñˆÊRñ‚WáFW&Ê∆«îG&ófV‰7F˜$ñG3¢÷˜fR7FvRw2˜v‡¢ÚÚ7FWW"áv∆∂W"Ê÷˜fUF˜v&Bw2W'6∆◊¬˜"WFFT7&VGW&T÷W6Ä¢ÚÚG&ófV‚'í∆ófRG&fV¬Fó&V7Fñˆ‚í˜"6ˆ÷&B7FvRw2&V¿¢ÚÚÜ˜7Fñ∆Tˆ&¶V7G2ˆ6ˆ◊Êñˆ‰ˆ&¶V7G2í«&VGí˜vÁ2FÜVó"&˜FFñˆ‡¢ÚÚFÜBg&÷R‡¢∆WB7WG66VÊU&˜D∆7EB“W&f˜&÷Ê6RÊÊ˜rÇì∞¢gVÊ7Fñˆ‚7WG66VÊU&˜FFñˆÂFñ6≤Çí∞¢ñbÇ'VÊÊñÊrí&WGW&„∞¢6ˆÁ7BÊ˜r“W&f˜&÷Ê6RÊÊ˜rÇì∞¢6ˆÁ7BGB“÷FÇÊ÷ñ‚É„R¬ÜÊ˜r“7WG66VÊU&˜D∆7EBíÚì∞¢7WG66VÊU&˜D∆7EB“Ê˜s∞¢f˜"Ü6ˆÁ7B∂7F˜$ñB¬7E“ˆb7F˜%7FFW2í∞¢ñbÜWáFW&Ê∆«îG&ófV‰7F˜$ñG2ÊÜ2Ü7F˜$ñBíí6ˆÁFñÁVS∞¢6ˆÁ7BVÁFóGí“VÁFóFñW2ÊvWBÜ7F˜$ñBì∞¢ñbÇVÁFóGíí6ˆÁFñÁVS∞¢6ˆÁ7BF&vWDFVr“FW6ó&VDf6ñÊtFVrÊvWBÜ7F˜$ñBíÛÚ7BÁ&˜FFñˆ„∞¢ñbÜVÁFóGíÊ∂ñÊB””“v7&VGW&RrbbVÁFóGíÊ7&VGW&Rí∞¢ÚÚFÜRWÜ7B6÷RgVÊ7Fñˆ‚&V¬vñ∆Bˆ6ˆ◊Êñˆ‚7&VGW&W2&P¢ÚÚG&ófV‚Fá&˜VvÇWfW'íg&÷RvÜWFÜW"÷˜fñÊr˜"Üˆ∆FñÊr7Fñ∆¿¢ÚÚá6VRWFFTÜ˜7Fñ∆W2˜WFFT6ˆ◊ÊñˆÁ2ì¢w&˜W&˜BV6W0¢ÚÚF˜v&BFÜR&rF&vWBvóFÇÊÚFVB¶ˆÊRˆbóG2˜v‚¬vÜñ∆P¢ÚÚFÜR7&˜76VB◊∆ÊR7&óFRvWG2óG2˜v‚6W&FRW'6∆◊ ¢ÚÚFVB¶ˆÊRÜ6÷W&&V∆FófT7&VGW&UW'2Ù5$TEU$UıU%ÙDTE¢ÚÚ$BíñÁFW&Ê∆«í6ÚóBÊWfW"vˆW2VFvR÷ˆ‚‡¢Ú¢ÚÚWFFT7&VGW&T÷W6Çw2˜v‚ñ‘Êv∆R&÷WFW"ó2&p¢ÚÚv˜&∆B÷Fó&V7Fñˆ‚Êv∆R¬6ˆÁfW'FVBñÁFW&Ê∆«ífñ¢ÚÚ&uF&vWE&˜Eí““Üñ‘Êv∆Rí≤íÛ"(	B&Vf∆V7FVB&V∆FñˆÁ6Üó ¢ÚÚvóFÇw&˜W&˜B¬Ê˜B6ñ◊∆RFFóFófRˆfg6WB‚F&vWDFVrÜW&P¢ÚÚó2ñ‚FÜR&Fó&V7B÷ˆFV¬í◊&˜FFñˆ‚"6ˆÁfVÁFñˆ‚WfW'í˜FÜW ¢ÚÚ7&VGW&R&˜FFñˆ‚FÇW6W2ñÁ7FVBÖGW&‚6&G2¬7v‚¬FÜP¢ÚÚFˆˆ¬w2˜v‚vó¶÷Ú˜&WfñWrí¬6ÚóBÜ2FÚvÚFá&˜VvÇFÜP¢ÚÚñÁfW'6RˆbFÜB6÷R÷ñÊrÜ7&VGW&Tñ‘Êv∆Tf˜$w&˜W&˜Bê¢ÚÚFÚ∆ÊBw&˜W&˜Bˆ‚FÜR7GV¬WFÜ˜&VBÊv∆R&FÜW"FÜ‡¢ÚÚóG2÷ó'&˜"‡¢WFFT7&VGW&T÷W6ÇÜVÁFóGíÊ7&VGW&R¬GB¬7&VGW&Tñ‘Êv∆Tf˜$w&˜W&˜BÖDÖ$TR‰÷FÖWFñ«2ÊFVuFı&BáF&vWDFVrííì∞¢WFFT7&VGW&TÊñ‘g&÷RÜVÁFóGíÊ7&VGW&R¬GB¬f«6Rì∞¢7BÁ&˜FFñˆ‚“DÖ$TR‰÷FÖWFñ«2Á&EFÙFVrÜVÁFóGíÊ7&VGW&RÊw&˜W&˜Bì∞¢“V«6R∞¢ÚÚÂ2˜∆ñW"˜∆6VÜˆ∆FW#¢FÜR6÷RñF∆R&f6R∆ñW""V6P¢ÚÚ&V¬7FFñˆÊ'íÂ72W6Rá6VRf6TÁ4Fñ∆ˆwVU'Fñ6óÁG2w0¢ÚÚÁ4f6U∆ñW$∆W'í(	Bf∆B6ˆñ‚◊∆ÊRfF"Ü2ÊÚVFvR÷ˆ‡¢ÚÚó77VRFÚFVB◊¶ˆÊRvñÁ7B¬6ÚFÜW&Rw2Ê˜FÜñÊrV«6RFÜó0¢ÚÚÊVVG2FÚ'V‚Fá&˜VvÇ‡¢6ˆÁ7B6fr“Á4Fñ∆ˆwVU7FvñÊt6ˆÊfñrÇì∞¢6ˆÁ7B7W'&VÁB“DÖ$TR‰÷FÖWFñ«2ÊFVuFı&Bá7BÁ&˜FFñˆ‚ì∞¢6ˆÁ7BÊWáB“7W'&VÁB≤Êv∆TFñfbÖDÖ$TR‰÷FÖWFñ«2ÊFVuFı&BáF&vWDFVrí¬7W'&VÁBí¢Ü6frÊÁ4f6U∆ñW$∆W'ÛÚ„#Çì∞¢7BÁ&˜FFñˆ‚“DÖ$TR‰÷FÖWFñ«2Á&EFÙFVrÜÊWáBì∞¢«ï7FFRÜ7F˜$ñBì∞¢–¢–¢&WVW7DÊñ÷Fñˆ‰g&÷RÜ7WG66VÊU&˜FFñˆÂFñ6≤ì∞¢–¢7WG66VÊU&˜FFñˆÂFñ6≤Çì∞†¢ñbÇ7FvT˜&FW"Ê∆VÊwFÇí≤fñÊó6ÇÇu&WfñWr7F˜VB(	BFÜó266VÊRÜ2ÊÚ6&G2‚rì≤&WGW&„≤–¢7WG66VÊU&WfñWt&ÊÊW"Ü	¯Í¬G∑ñ∆ˆBÁFóF∆R«¬t7WG66VÊR&WfñWrw÷¬f«6Rì∞¢'VÂ7FvRá7FvT˜&FW%≥“ì∞¢–†¢ñbávñÊF˜rÂıˆÜˆ'VÊ¶î7WG66VÊU&WfñWrí∞¢'V‰7WG66VÊU&WfñWrávñÊF˜rÂıˆÜˆ'VÊ¶î7WG66VÊU&WfñWríÊ6F6ÇÜW'"”‚∞¢6ˆÁ6ˆ∆RÊW'&˜"Çu∂7WG66VÊR&WfñWu“fñ∆VBFÚ7F'C¢r¬W'"ì∞¢7WG66VÊU&WfñWt7FófR“f«6S∞¢7WG66VÊU&WfñWt&ÊÊW"Çu&WfñWrfñ∆VBFÚ7F'B(	B6VR6ˆÁ6ˆ∆R‚r¬G'VRì∞¢“ì∞¢–†¢&WVW7DÊñ÷Fñˆ‰g&÷RÜv÷T∆ˆ˜ì∞¢“íÇì∞